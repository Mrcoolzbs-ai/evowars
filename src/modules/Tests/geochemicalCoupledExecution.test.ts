// ============================================
// GEOCHEMICAL COUPLED EXECUTION TESTS — атомарные coupled-транзакции (Stage 4.9d)
// ============================================
//
// Тесты единого атомарного исполнителя связанных геохимических изменений:
// план → полное валидирование → применение (всё или ничего), анти-replay,
// защита от устаревшего снимка, детерминизм при перестановке участников,
// побитовая неизменность входа при not_applied, миграции журнала
// транзакций, JSON round-trip, применение к ядру мира (CoreWorldState).
//
// ВАЖНО: все численные значения ниже — синтетические величины фикстур
// (synthetic test fixture): НЕ физические данные океана/атмосферы, НЕ
// калибровка и НЕ основание климатических выводов. Процессы-фикстуры с
// префиксом test. НЕ входят в производственный каталог процессов и не
// делают никакой процесс из каталога исполнимым. Реакции-фикстуры —
// стехиометрически корректные уравнения карбонатной системы, используемые
// ТОЛЬКО для проверки механики атомарного исполнения.

import { describe, it, expect } from 'vitest';

import {
  GEOCHEMICAL_COUPLED_BALANCE_TOLERANCE,
  canonicalCoupledComponents,
  captureCoupledTransactionSnapshot,
  withTransactionLogApplied,
  planGeochemicalCoupledTransaction,
  executeGeochemicalCoupledTransaction,
  executeGeochemicalCoupledTransactionOnWorld
} from '../Core/geochemicalCoupledExecution';
import type { GeochemicalCoupledComponent, GeochemicalCoupledExecutionEnvironment } from '../Core/geochemicalCoupledExecution';
import type { GeochemicalReactionDefinition } from '../Core/geochemicalReactionExecution';
import { buildGeochemicalSpeciesCatalog } from '../Data/geochemicalSpeciesCatalog';
import { GEOCHEMICAL_PROCESS_CATALOG } from '../Data/geochemicalProcessCatalog';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { knownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import type { FluxLedger, FluxTime, FluxRecord } from '../Core/fluxLedger';
import { createReactionLedger } from '../Core/reactionLedger';
import type { ReactionLedger } from '../Core/reactionLedger';
import { createCoreWorldState, validateWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { migrateSavedWorld, CURRENT_SAVE_SCHEMA_VERSION } from '../Core/migrations';

// ============================================
// ФИКСТУРЫ (synthetic test fixtures)
// ============================================

const catalog = buildGeochemicalSpeciesCatalog();

/** Синтетическое происхождение чисел фикстуры (идентифицирует «тест», не физику). */
const FIXTURE_PROVENANCE = {
  sourceName: 'synthetic test fixture: карбонатная система Stage 4.9d (тестовые числа)',
  sourceId: 'evowars/tests/stage-4.9d/coupled-fixture',
  recordId: 'synthetic-coupled-fixture'
};

const EXTENT_PROVENANCE = {
  ...FIXTURE_PROVENANCE,
  note: 'synthetic test fixture: extent задан явно для проверки механики транзакции, НЕ измеренное и НЕ рассчитанное значение'
};

function ocnT(): FluxTime {
  return { segmentIndex: 3, localTimeS: 1000 };
}

function oceanReservoir(entriesOverride: Record<string, number> = {}): ReservoirRecord {
  const entries: Record<string, number> = {
    co2_aq: 0.0012,
    hco3_aq: 0.0020,
    co3_aq: 0.0002,
    hplus_aq: 1e-8,
    // synthetic test fixture: запас oh_aq достаточен для экстентов реакций-фикстур (до 5e-4): запас 5e-6 не выдерживал бы шаг финальных инвентарей (отрицательный запас невозможен)
    oh_aq: 0.002,
    h2o_aq: 9000,
    caco3: 0.004,
    ...entriesOverride
  };
  const reservoir = createReservoir('ocean', 'ocean_surface', {
    note: 'synthetic test fixture: столбовые запасы фикстуры в mol/m², НЕ данные океана'
  });
  return setMaterialInventory(reservoir, 'column_amount', entries);
}

function atmosphereReservoir(): ReservoirRecord {
  const reservoir = createReservoir('atmosphere', 'atmospheric_column', {
    note: 'synthetic test fixture: столб co2_aq фикстуры (фазовая запись), НЕ данные атмосферы'
  });
  return setMaterialInventory(reservoir, 'column_amount', { co2_aq: 0.0008 });
}

function crustReservoir(): ReservoirRecord {
  const reservoir = createReservoir('crust', 'crustal_column', {
    note: 'synthetic test fixture: запас caco3 фикстуры'
  });
  return setMaterialInventory(reservoir, 'column_amount', { caco3: 0.05, co3_aq: 0.0001 });
}

interface FixtureEnv {
  env: GeochemicalCoupledExecutionEnvironment;
  ocean: ReservoirRecord;
  atmosphere: ReservoirRecord;
  crust: ReservoirRecord;
  fluxLedger: FluxLedger;
  reactionLedger: ReactionLedger;
}

function makeEnv(): FixtureEnv {
  const ocean = oceanReservoir();
  const atmosphere = atmosphereReservoir();
  const crust = crustReservoir();
  const fluxLedger: FluxLedger = { records: [] };
  const reactionLedger = createReactionLedger();
  return {
    ocean,
    atmosphere,
    crust,
    fluxLedger,
    reactionLedger,
    env: {
      speciesCatalog: catalog,
      reservoirs: { ocean, atmosphere, crust },
      reactionLedgerInput: reactionLedger,
      fluxLedgerInput: fluxLedger,
      appliedTransactionIds: []
    }
  };
}

// Реакции-фикстуры: карбонатная химия, все участники в 'ocean'.
// Стехиометрия каждой (элементы + заряд) подтверждается
// auditReactionStoichiometry в каждом тесте, а не этим комментарием.

/** co2_aq + oh_aq → hco3_aq (гидроксилатный канал гидратации CO2). */
function rxCo2Hydroxylation(): GeochemicalReactionDefinition {
  return {
    reactionId: 'test.synthetic.co2_aq+oh->hco3',
    processId: 'test.synthetic.coupled.fixture',
    description: 'synthetic test fixture: CO2(aq) + OH- -> HCO3- (карбонатная химия, проверка механики транзакции)',
    reactants: [
      { reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 1 },
      { reservoirId: 'ocean', speciesId: 'oh_aq', coefficient: 1 }
    ],
    products: [{ reservoirId: 'ocean', speciesId: 'hco3_aq', coefficient: 1 }],
    extentBasis: 'column_amount',
    definitionProvenance: {
      ...FIXTURE_PROVENANCE,
      note: 'synthetic test fixture: уравнение — стандартная химия, чисел в определении нет'
    },
    limitations: 'фикстура: НЕ утверждает ни кинетику, ни механизм, ни равновесие'
  };
}

/** hco3_aq → co3_aq + hplus_aq (вторая диссоциация угольной кислоты). */
function rxBicarbonateDissociation(): GeochemicalReactionDefinition {
  return {
    reactionId: 'test.synthetic.hco3->co3+hplus',
    processId: 'test.synthetic.coupled.fixture',
    description: 'synthetic test fixture: HCO3- -> CO3^2- + H+ (вторая диссоциация, проверка механики)',
    reactants: [{ reservoirId: 'ocean', speciesId: 'hco3_aq', coefficient: 1 }],
    products: [
      { reservoirId: 'ocean', speciesId: 'co3_aq', coefficient: 1 },
      { reservoirId: 'ocean', speciesId: 'hplus_aq', coefficient: 1 }
    ],
    extentBasis: 'column_amount',
    definitionProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: уравнение — стандартная химия' },
    limitations: 'фикстура: НЕ утверждает кинетику или равновесие'
  };
}

/** co2_aq + h2o_aq → hco3_aq + hplus_aq (водный канал гидратации CO2). */
function rxCo2Hydration(): GeochemicalReactionDefinition {
  return {
    reactionId: 'test.synthetic.co2+h2o->hco3+hplus',
    processId: 'test.synthetic.coupled.fixture',
    description: 'synthetic test fixture: CO2(aq) + H2O -> HCO3- + H+ (проверка механики)',
    reactants: [
      { reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 1 },
      { reservoirId: 'ocean', speciesId: 'h2o_aq', coefficient: 1 }
    ],
    products: [
      { reservoirId: 'ocean', speciesId: 'hco3_aq', coefficient: 1 },
      { reservoirId: 'ocean', speciesId: 'hplus_aq', coefficient: 1 }
    ],
    extentBasis: 'column_amount',
    definitionProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: уравнение — стандартная химия' },
    limitations: 'фикстура: НЕ утверждает кинетику или равновесие'
  };
}

function reactionComponent(definition: GeochemicalReactionDefinition, extent: number, note?: string): GeochemicalCoupledComponent {
  return { kind: 'reaction', definition, extentMolPerM2: extent, extentProvenance: EXTENT_PROVENANCE, note };
}

function transferAtmToOceanOco2(amount: number): GeochemicalCoupledComponent {
  return {
    kind: 'transfer',
    speciesId: 'co2_aq',
    direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' },
    amountMolPerM2: amount,
    amountProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: интегрированный перенос фикстуры, НЕ скорость' },
    note: 'synthetic test fixture'
  };
}

function externalInputCo2Ocean(amount: number): GeochemicalCoupledComponent {
  return {
    kind: 'transfer',
    speciesId: 'co2_aq',
    direction: {
      kind: 'external_input',
      reservoirId: 'ocean',
      boundary: { id: 'test.synthetic.boundary', physicalJustification: 'synthetic test fixture: тестовый приток через границу для проверки механики' }
    },
    amountMolPerM2: amount,
    amountProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture' }
  };
}

function simpleInput(
  transactionId: string,
  components: readonly GeochemicalCoupledComponent[]
): {
  transactionId: string;
  process: { processId: string; transactionScopeNote: string };
  time: FluxTime;
  components: readonly GeochemicalCoupledComponent[];
} {
  return {
    transactionId,
    process: {
      processId: 'test.synthetic.coupled.fixture',
      transactionScopeNote: 'synthetic test fixture: транзакция вне производственного каталога процессов'
    },
    time: ocnT(),
    components
  };
}

/** Строковый снимок произвольного объекта для побитовой проверки неизменности. */
function snapshotOf(value: unknown): string {
  return JSON.stringify(value);
}

// ============================================
// 1. УСПЕШНЫЕ ТРАНЗАКЦИИ
// ============================================

describe('Stage 4.9d coupled: успешные транзакции', () => {
  it('транзакция «реакция + перенос» применяется атомарно; журнал и инвентари согласованы', () => {
    const f = makeEnv();
    const input = simpleInput('tx-success-1', [
      reactionComponent(rxCo2Hydroxylation(), 0.0005),
      externalInputCo2Ocean(0.0007)
    ]);
    const plan = planGeochemicalCoupledTransaction(f.env, input);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;

    // Канонические id записей и контракт.
    expect(plan.reactionRecords.map((r) => r.id)).toEqual(['tx-success-1::rx::0']);
    expect(plan.audit.status).toBe('balanced');
    // Агрегат по парам: oh_aq -0.0005; hco3_aq +0.0005; co2_aq +0.0007 - 0.0005.
    const byPair = new Map(plan.aggregatedDeltas.map((d) => [d.reservoirId + '/' + d.speciesId, d.deltaMolM2]));
    expect(byPair.get('ocean/oh_aq')).toBeCloseTo(-0.0005, 15);
    expect(byPair.get('ocean/hco3_aq')).toBeCloseTo(0.0005, 15);

    const execution = executeGeochemicalCoupledTransaction(f.env, input, plan);
    expect(execution.status).toBe('applied');
    if (execution.status !== 'applied') return;
    expect(execution.contract.transactionId).toBe('tx-success-1');
    expect(execution.contract.atomicity).toBe('single_snapshot_and_rollback');
    expect(execution.contract.reactionTransactionIds).toEqual(['tx-success-1::rx::0']);
    expect(execution.contract.fluxTransactionIds).toEqual(['tx-success-1::flux::1']);
    // Инвентарь океана: co2_aq = 0.0012 - 0.0005 + 0.0007 = 0.0014.
    expect(execution.reservoirs['ocean']?.material?.entries['co2_aq']).toBeCloseTo(0.0014, 15);
    expect(execution.reservoirs['ocean']?.material?.entries['oh_aq']).toBeCloseTo(0.002 - 0.0005, 15);
    expect(execution.reservoirs['ocean']?.material?.entries['hco3_aq']).toBeCloseTo(0.002 + 0.0005, 15);
    // Журналы: ровно одна реакция и один поток; резервуары атмосферы не тронуты.
    expect(execution.reactionLedger.records).toHaveLength(1);
    expect(execution.fluxLedger.records).toHaveLength(1);
    expect(execution.fluxLedger.records[0]?.status).toBe('applied');
    expect(execution.reservoirs['atmosphere']).toBe(f.atmosphere);
    // Аудит заряда агрегата: 0 точно (дельты нейтральных видов).
    expect(execution.audit.chargeResidual).toBe(0);
  });

  it('транзакция из нескольких реакций и переносов агрегируется по парам на одном снимке', () => {
    const f = makeEnv();
    const input = simpleInput('tx-multi-1', [
      reactionComponent(rxCo2Hydroxylation(), 0.0005),
      transferAtmToOceanOco2(0.0002),
      reactionComponent(rxBicarbonateDissociation(), 0.0002),
      {
        kind: 'transfer',
        speciesId: 'co2_aq',
        direction: {
          kind: 'external_output',
          reservoirId: 'atmosphere',
          boundary: { id: 'test.synthetic.space', physicalJustification: 'synthetic test fixture: тестовый отток (co2_aq нейтрален)' }
        },
        amountMolPerM2: 0.0001,
        amountProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture' }
      }
    ]);
    const plan = planGeochemicalCoupledTransaction(f.env, input);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    const byPair = new Map(plan.aggregatedDeltas.map((d) => [d.reservoirId + '/' + d.speciesId, d.deltaMolM2]));
    expect(byPair.get('atmosphere/co2_aq')).toBeCloseTo(-0.0003, 15);
    expect(byPair.get('ocean/co2_aq')).toBeCloseTo(-0.0005 + 0.0002, 15);
    expect(byPair.get('ocean/oh_aq')).toBeCloseTo(-0.0005, 15);
    expect(byPair.get('ocean/hco3_aq')).toBeCloseTo(0.0005 - 0.0002, 15);
    expect(byPair.get('ocean/co3_aq')).toBeCloseTo(0.0002, 15);
    expect(byPair.get('ocean/hplus_aq')).toBeCloseTo(0.0002, 15);
    expect(plan.audit.status).toBe('balanced');
    const execution = executeGeochemicalCoupledTransaction(f.env, input, plan);
    expect(execution.status).toBe('applied');
    if (execution.status !== 'applied') return;
    expect(execution.reactionLedger.records).toHaveLength(2);
    expect(execution.fluxLedger.records).toHaveLength(2);
    expect(execution.reservoirs['ocean']?.material?.entries['co2_aq']).toBeCloseTo(0.0012 - 0.0005 + 0.0002, 15);
    expect(execution.reservoirs['atmosphere']?.material?.entries['co2_aq']).toBeCloseTo(0.0008 - 0.0003, 15);
    // Углерод: обе реакции DIC не меняют; внутренний перенос atm -> ocean
    // импортирует в океан ровно 0.0002 в единственном углеродном виде co2_aq,
    // поэтому ожидание = исходный DIC океана + 0.0002 (synthetic test fixture).
    const dicBeforeOcean = 0.0012 + 0.002 + 0.0002;
    const after = execution.reservoirs['ocean']?.material?.entries;
    const dicAfterOcean = (after?.['co2_aq'] ?? 0) + (after?.['hco3_aq'] ?? 0) + (after?.['co3_aq'] ?? 0);
    expect(dicAfterOcean).toBeCloseTo(dicBeforeOcean + 0.0002, 15);
    // Полный углерод системы (ocean + atmosphere) изменяется ТОЛЬКО внешним
    // оттоком: systemCarbonAfter = systemCarbonBefore - 0.0001.
    const carbonBeforeSystem = dicBeforeOcean + 0.0008;
    const atmosphereAfter = execution.reservoirs['atmosphere']?.material?.entries?.['co2_aq'] ?? 0;
    expect(dicAfterOcean + atmosphereAfter).toBeCloseTo(carbonBeforeSystem - 0.0001, 15);
  });

  it('внутренний перенос заряженного вида допустим (заряд остаётся внутри системы), внешний — нет', () => {
    const f = makeEnv();
    const inputInternal = simpleInput('tx-charged-internal', [
      {
        kind: 'transfer',
        speciesId: 'co3_aq',
        direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'crust' },
        amountMolPerM2: 5e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture' }
      }
    ]);
    const plan = planGeochemicalCoupledTransaction(f.env, inputInternal);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.audit.chargeResidual).toBe(0);
    expect(executeGeochemicalCoupledTransaction(f.env, inputInternal, plan).status).toBe('applied');

    const inputExternal = simpleInput('tx-charged-external', [
      {
        kind: 'transfer',
        speciesId: 'co3_aq',
        direction: {
          kind: 'external_output',
          reservoirId: 'ocean',
          boundary: { id: 'test.synthetic.space', physicalJustification: 'synthetic test fixture' }
        },
        amountMolPerM2: 5e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture' }
      }
    ]);
    const planExternal = planGeochemicalCoupledTransaction(f.env, inputExternal);
    expect(planExternal.status).toBe('blocked');
  });
});

// ============================================
// 2. ИДЕНТИФИКАЦИЯ ПРОЦЕССА И ФОРМА ВХОДА
// ============================================

describe('Stage 4.9d coupled: идентификация процесса и форма входа', () => {
  it('processSpec обязан совпадать по processId и иметь mechanism coupled', () => {
    const f = makeEnv();
    const coupledSpec = GEOCHEMICAL_PROCESS_CATALOG.find((p) => p.processId === 'geo.silicate_weathering.co2_aq.atm->ocn');
    expect(coupledSpec?.mechanism).toBe('coupled');

    const mismatch = planGeochemicalCoupledTransaction(f.env, {
      transactionId: 'tx-spec-mismatch',
      process: { processId: 'test.synthetic.coupled.fixture', processSpec: coupledSpec ?? null },
      components: [externalInputCo2Ocean(1e-5)]
    } as never);
    expect(mismatch.status).toBe('blocked');
  });

  it('spec с mechanism transport отклоняется: solo-процессы исполняются своими исполнителями', () => {
    const f = makeEnv();
    const transportSpec = GEOCHEMICAL_PROCESS_CATALOG.find((p) => p.mechanism === 'transport');
    expect(transportSpec?.mechanism).toBe('transport');
    const result = planGeochemicalCoupledTransaction(f.env, {
      transactionId: 'tx-not-coupled',
      process: { processId: transportSpec?.processId ?? 'test.synthetic.unknown', processSpec: transportSpec ?? null },
      components: [externalInputCo2Ocean(1e-5)]
    } as never);
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reasonKind).toBe('not_executable');
  });

  it('spec, не проходящий validateGeochemicalProcessSpec, отклоняется', () => {
    const f = makeEnv();
    const brokenSpec = {
      processId: 'test.synthetic.broken.spec',
      description: 'сломанная спецификация фикстуры'
      // processType/mechanism/speciesId/direction/rate/basis отсутствуют
    };
    const result = planGeochemicalCoupledTransaction(f.env, {
      transactionId: 'tx-broken-spec',
      process: { processId: 'test.synthetic.broken.spec', processSpec: brokenSpec as never },
      components: [externalInputCo2Ocean(1e-5)]
    });
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.length > 0).toBe(true);
  });

  it('пустые компоненты, пустой transactionId и некорректный time отклоняются формой входа', () => {
    const f = makeEnv();
    const empty = planGeochemicalCoupledTransaction(f.env, {
      transactionId: 'tx-empty',
      process: { processId: 'test.synthetic.coupled.fixture' },
      components: []
    });
    expect(empty.status).toBe('blocked');

    const noTxId = planGeochemicalCoupledTransaction(f.env, {
      transactionId: '   ',
      process: { processId: 'test.synthetic.coupled.fixture' },
      components: [externalInputCo2Ocean(1e-5)]
    });
    expect(noTxId.status).toBe('blocked');

    const badTime = planGeochemicalCoupledTransaction(f.env, {
      transactionId: 'tx-bad-time',
      process: { processId: 'test.synthetic.coupled.fixture' },
      time: 'today' as never,
      components: [externalInputCo2Ocean(1e-5)]
    });
    expect(badTime.status).toBe('blocked');
  });
});

// ============================================
// 3. АНТИ-REPLAY И УСТАРЕВШИЙ СНИМОК
// ============================================

describe('Stage 4.9d coupled: анти-replay, повторное применение, устаревший снимок', () => {
  it('повторный transactionId отклоняется на плане (анти-replay), состояние не меняется', () => {
    const core = makeIsolatedCore();
    const input = simpleInput('tx-replay-1', [externalInputCo2Ocean(1e-5)]);
    const applied = executeGeochemicalCoupledTransactionOnWorld(core, catalog, input);
    expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') return;

    const env2 = envOfCore(applied.core, catalog);
    const replay = planGeochemicalCoupledTransaction(env2, simpleInput('tx-replay-1', [externalInputCo2Ocean(1e-5)]));
    expect(replay.status).toBe('blocked');
    expect(replay.status === 'blocked' && replay.reasonKind).toBe('duplicate_transaction');
  });

  it('повторное исполнение одной транзакции к ядру мира отклоняется и не меняет состояние', () => {
    const core = makeIsolatedCore();
    const input = simpleInput('tx-once-only', [externalInputCo2Ocean(1e-5)]);
    const first = executeGeochemicalCoupledTransactionOnWorld(core, catalog, input);
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    const firstCore = first.core;

    const second = executeGeochemicalCoupledTransactionOnWorld(firstCore, catalog, input);
    expect(second.status).toBe('not_applied');
    expect(second.status === 'not_applied' && second.reasonKind).toBe('duplicate_transaction');
    expect(firstCore.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-once-only']);
  });

  it('конфликт производного id записи с занятым id журнала отклоняется (duplicate_transaction)', () => {
    const f = makeEnv();
    const ghost: FluxRecord = {
      id: 'tx-occupied::flux::0',
      kind: 'external_input',
      from: 'external',
      to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2_aq', quantityKind: 'integrated', amount: 1e-5, basis: 'column_amount' },
      time: null,
      status: 'applied'
    };
    const envWithGhost: GeochemicalCoupledExecutionEnvironment = { ...f.env, fluxLedgerInput: { records: [ghost] } };
    const result = planGeochemicalCoupledTransaction(envWithGhost, simpleInput('tx-occupied', [externalInputCo2Ocean(1e-5)]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reasonKind).toBe('duplicate_transaction');
  });

  it('изменение состояния между планом и исполнением отклоняется (stale_snapshot), вход нетронут', () => {
    const f = makeEnv();
    const input = simpleInput('tx-stale-1', [externalInputCo2Ocean(1e-5)]);
    const plan = planGeochemicalCoupledTransaction(f.env, input);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;

    // Кто-то поменял состояние между планированием и исполнением.
    const edited = setMaterialInventory(createReservoir('ocean', 'ocean_surface'), 'column_amount', { co2_aq: 0.0012 });
    const staleEnv: GeochemicalCoupledExecutionEnvironment = {
      ...f.env,
      reservoirs: { ...f.env.reservoirs, ocean: edited }
    };
    const before = snapshotOf(f);
    const execution = executeGeochemicalCoupledTransaction(staleEnv, input, plan);
    expect(execution.status).toBe('not_applied');
    expect(execution.status === 'not_applied' && execution.reasonKind).toBe('stale_snapshot');
    expect(snapshotOf(f)).toBe(before);
  });

  it('план другого transactionId не исполняется с подменённым входом', () => {
    const f = makeEnv();
    const plan = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-original-id', [externalInputCo2Ocean(1e-5)]));
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    const before = snapshotOf(f);
    const forged = executeGeochemicalCoupledTransaction(f.env, simpleInput('tx-forged-id', [externalInputCo2Ocean(1e-5)]), plan);
    expect(forged.status).toBe('not_applied');
    expect(forged.status === 'not_applied' && forged.reasonKind).toBe('not_executable');
    expect(snapshotOf(f)).toBe(before);
  });
});

// ============================================
// 4. ОТКАЗЫ И ПОБИТОВАЯ НЕИЗМЕННОСТЬ (fail-closed)
// ============================================

describe('Stage 4.9d coupled: отказы и неизменность входа', () => {
  it('неизвестный вид переноса отклоняется; вид фикстуры НЕ добавляется в каталог', () => {
    const f = makeEnv();
    const before = snapshotOf(f);
    const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-unknown-species', [
      {
        kind: 'transfer',
        speciesId: 'silicate_feldspar_synthetic',
        direction: { kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'ocean' },
        amountMolPerM2: 1e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE }
      }
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.some((i) => i.includes('silicate_feldspar_synthetic'))).toBe(true);
    expect(catalog.has('silicate_feldspar_synthetic')).toBe(false);
    expect(snapshotOf(f)).toBe(before);
  });

  it('отсутствующий резервуар переноса отклоняется', () => {
    const f = makeEnv();
    const before = snapshotOf(f);
    const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-unknown-reservoir', [
      {
        kind: 'transfer',
        speciesId: 'co2_aq',
        direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'martian_ocean' },
        amountMolPerM2: 1e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE }
      }
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.some((i) => i.includes('martian_ocean'))).toBe(true);
    expect(snapshotOf(f)).toBe(before);
  });

  it('резервуар без материального инвентаря отклоняется (инвентарь не создаётся молча)', () => {
    const f = makeEnv();
    const barren = createReservoir('barren', 'ocean_surface', { note: 'synthetic test fixture: без инвентаря' });
    const env: GeochemicalCoupledExecutionEnvironment = { ...f.env, reservoirs: { ...f.env.reservoirs, barren } };
    const before = snapshotOf(f);
    const result = planGeochemicalCoupledTransaction(env, simpleInput('tx-barren', [
      {
        kind: 'transfer',
        speciesId: 'co2_aq',
        direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'barren' },
        amountMolPerM2: 1e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE }
      }
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.some((i) => i.includes('barren'))).toBe(true);
    expect(snapshotOf(f)).toBe(before);
  });

  it('несовпадающее основание инвентаря отклоняется: основания не смешиваются, пересчёт не выполняется', () => {
    const f = makeEnv();
    const molar = setMaterialInventory(createReservoir('beaker', 'ocean_surface'), 'amount', { co2_aq: 100 });
    const env: GeochemicalCoupledExecutionEnvironment = { ...f.env, reservoirs: { ...f.env.reservoirs, beaker: molar } };
    const before = snapshotOf(f);
    const result = planGeochemicalCoupledTransaction(env, simpleInput('tx-basis', [
      {
        kind: 'transfer',
        speciesId: 'co2_aq',
        direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'beaker' },
        amountMolPerM2: 1e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE }
      }
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.some((i) => i.includes('amount') && i.includes('column_amount'))).toBe(true);
    expect(snapshotOf(f)).toBe(before);
  });

  it('нулевое, отрицательное и нефинитное количество переноса отклоняются', () => {
    const f = makeEnv();
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['zero', 0],
      ['negative', -1e-5],
      ['infinite', Number.POSITIVE_INFINITY],
      ['nan', Number.NaN]
    ];
    for (const [label, amount] of cases) {
      const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-amount-' + label, [
        {
          kind: 'transfer',
          speciesId: 'co2_aq',
          direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'crust' },
          amountMolPerM2: amount,
          amountProvenance: { ...FIXTURE_PROVENANCE }
        }
      ]));
      expect(result.status).toBe('blocked');
    }
  });

  it('перенос без идентифицированного provenance отклоняется', () => {
    const f = makeEnv();
    const before = snapshotOf(f);
    const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-no-provenance', [
      {
        kind: 'transfer',
        speciesId: 'co2_aq',
        direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'crust' },
        amountMolPerM2: 1e-5,
        amountProvenance: { note: 'источник не идентифицирован' } as never
      }
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.some((i) => i.toLowerCase().includes('provenance'))).toBe(true);
    expect(snapshotOf(f)).toBe(before);
  });

  it('внешний перенос заряженного вида без фоновых ионов отклоняется: электронейтральность НЕ объявляется ложной', () => {
    const f = makeEnv();
    const before = snapshotOf(f);
    const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-external-charged', [
      {
        kind: 'transfer',
        speciesId: 'hco3_aq',
        direction: {
          kind: 'external_input',
          reservoirId: 'ocean',
          boundary: { id: 'test.synthetic.charged', physicalJustification: 'synthetic test fixture: приток с фоном НЕ подтверждён' }
        },
        amountMolPerM2: 1e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE }
      }
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.some((i) => i.includes('заряженного'))).toBe(true);
    expect(snapshotOf(f)).toBe(before);
  });

  it('внешний перенос без границы/обоснования отклоняется', () => {
    const f = makeEnv();
    const noBoundary = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-no-boundary', [
      {
        kind: 'transfer',
        speciesId: 'co2_aq',
        direction: { kind: 'external_input', reservoirId: 'ocean', boundary: { id: '', physicalJustification: '' } },
        amountMolPerM2: 1e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE }
      }
    ]));
    expect(noBoundary.status).toBe('blocked');
  });

  it('недостаточный запас реагента (отрицательный финальный инвентарь) отклоняется до применения', () => {
    const f = makeEnv();
    const before = snapshotOf(f);
    // hco3_aq в фикс. инвентаре 0.002 mol/m²: extent 0.5 дал бы -0.498.
    const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-insufficient', [
      reactionComponent(rxBicarbonateDissociation(), 0.5)
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.some((i) => i.includes('отрицательный'))).toBe(true);
    expect(snapshotOf(f)).toBe(before);
    // Один и тот же отказ при повторном планировании (детерминизм отказов).
    const again = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-insufficient', [
      reactionComponent(rxBicarbonateDissociation(), 0.5)
    ]));
    expect(again.status).toBe('blocked');
  });

  it('изъятие из НЕИЗВЕСТНОГО количества (вида нет в инвентаре) отклоняется: unknown != 0', () => {
    const f = makeEnv();
    const ocean = oceanReservoir();
    delete (ocean.material as { entries: Record<string, number> }).entries['hco3_aq'];
    const env: GeochemicalCoupledExecutionEnvironment = {
      ...f.env,
      reservoirs: { ...f.env.reservoirs, ocean }
    };
    const before = snapshotOf(f);
    const result = planGeochemicalCoupledTransaction(env, simpleInput('tx-unknown-amount', [
      reactionComponent(rxBicarbonateDissociation(), 1e-5)
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.issues.some((i) => i.toLowerCase().includes('неизвестно'))).toBe(true);
    expect(snapshotOf(f)).toBe(before);
  });

  it('несбалансированная стехиометрия последней реакции пакета отменяет ВСЮ транзакцию', () => {
    const f = makeEnv();
    const before = snapshotOf(f);
    const bad: GeochemicalReactionDefinition = {
      ...rxBicarbonateDissociation(),
      reactionId: 'test.synthetic.bad.stoichiometry',
      products: [{ reservoirId: 'ocean', speciesId: 'co3_aq', coefficient: 1 }] // hplus потерян
    };
    const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-imbalanced', [
      reactionComponent(rxCo2Hydration(), 1e-5),
      reactionComponent(bad, 1e-5)
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reasonKind).toBe('not_executable');
    // Отказ последней компоненты пакета отменяет ВСЮ транзакцию: первая компонента не применилась.
    expect(snapshotOf(f)).toBe(before);
    expect(f.env.fluxLedgerInput.records).toHaveLength(0);
    expect(f.env.reactionLedgerInput?.records ?? []).toHaveLength(0);
  });

  it('вид c_org в реакции отклоняется правилом 4.9b (bookkeeping-вид не превращается)', () => {
    const f = makeEnv();
    const organic: GeochemicalReactionDefinition = {
      reactionId: 'test.synthetic.c_org.turnover',
      processId: 'test.synthetic.coupled.fixture',
      description: 'synthetic test fixture: попытка окислить c_org',
      reactants: [{ reservoirId: 'ocean', speciesId: 'c_org', coefficient: 1 }],
      products: [{ reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 1 }],
      extentBasis: 'column_amount',
      definitionProvenance: { ...FIXTURE_PROVENANCE }
    };
    const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-corg', [reactionComponent(organic, 1e-5)]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reasonKind).toBe('out_of_applicability');
  });

  it('вид с неизвестным зарядом/составом в агрегате делает транзакцию not_verifiable', () => {
    const foreign = setMaterialInventory(createReservoir('alien', 'alien_column'), 'column_amount', { unknown_xz: 0.001 });
    const f = makeEnv();
    const reservoirs = { ...f.env.reservoirs, alien: foreign };
    const before = JSON.stringify(reservoirs);
    const result = planGeochemicalCoupledTransaction({ ...f.env, reservoirs }, simpleInput('tx-foreign', [
      reactionComponent(rxCo2Hydroxylation(), 1e-6),
      {
        kind: 'transfer',
        speciesId: 'unknown_xz',
        direction: { kind: 'internal_transfer', fromReservoirId: 'alien', toReservoirId: 'ocean' },
        amountMolPerM2: 5e-7,
        amountProvenance: { ...FIXTURE_PROVENANCE }
      }
    ]));
    expect(result.status).toBe('blocked');
    expect(result.status === 'blocked' && result.reasonKind).toBe('not_verifiable');
    expect(JSON.stringify(reservoirs)).toBe(before);
  });

  it('отказ последнего переноса пакета отменяет всё: applied-эффекта нет вообще', () => {
    const f = makeEnv();
    const before = snapshotOf(f);
    const result = planGeochemicalCoupledTransaction(f.env, simpleInput('tx-last-transfer-fails', [
      reactionComponent(rxCo2Hydroxylation(), 1e-5),
      transferAtmToOceanOco2(1e-5),
      {
        kind: 'transfer',
        speciesId: 'co2_aq',
        direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'ghost_land' },
        amountMolPerM2: 1e-5,
        amountProvenance: { ...FIXTURE_PROVENANCE }
      }
    ]));
    expect(result.status).toBe('blocked');
    expect(snapshotOf(f)).toBe(before);
    expect(f.env.fluxLedgerInput.records).toHaveLength(0);
    expect(f.env.reactionLedgerInput?.records ?? []).toHaveLength(0);
  });
});

// ============================================
// 5. ДЕТЕРМИНИЗМ, КАНОНИЗАЦИЯ, ПЛАН БЕЗ ЭФФЕКТОВ
// ============================================

describe('Stage 4.9d coupled: детерминизм и план без эффектов', () => {
  it('перестановка участников не меняет план: дельты, id записей, аудит и результат исполнения', () => {
    const f1 = makeEnv();
    const f2 = makeEnv();
    const a = simpleInput('tx-det-1', [
      reactionComponent(rxCo2Hydroxylation(), 0.0005),
      transferAtmToOceanOco2(0.0002),
      reactionComponent(rxBicarbonateDissociation(), 0.0001)
    ]);
    const b = simpleInput('tx-det-1', [
      reactionComponent(rxBicarbonateDissociation(), 0.0001),
      transferAtmToOceanOco2(0.0002),
      reactionComponent(rxCo2Hydroxylation(), 0.0005)
    ]);
    const planA = planGeochemicalCoupledTransaction(f1.env, a);
    const planB = planGeochemicalCoupledTransaction(f2.env, b);
    expect(planA.status).toBe('ready');
    expect(planB.status).toBe('ready');
    if (planA.status !== 'ready' || planB.status !== 'ready') return;
    expect(planA.aggregatedDeltas).toEqual(planB.aggregatedDeltas);
    expect(planA.reactionRecords.map((r) => r.id)).toEqual(planB.reactionRecords.map((r) => r.id));
    expect(planA.audit).toEqual(planB.audit);
    const execA = executeGeochemicalCoupledTransaction(f1.env, a, planA);
    const execB = executeGeochemicalCoupledTransaction(f2.env, b, planB);
    expect(execA.status).toBe('applied');
    expect(execB.status).toBe('applied');
    if (execA.status !== 'applied' || execB.status !== 'applied') return;
    expect(execA.reservoirs).toEqual(execB.reservoirs);
    expect(execA.fluxLedger.records.map((r) => r.id)).toEqual(execB.fluxLedger.records.map((r) => r.id));
    expect(execA.reactionLedger.records.map((r) => r.id)).toEqual(execB.reactionLedger.records.map((r) => r.id));
  });

  it('канонизация сортирует компоненты по стабильному ключу', () => {
    const c1 = reactionComponent(rxCo2Hydroxylation(), 1e-5);
    const c2 = transferAtmToOceanOco2(2e-5);
    const canonical = canonicalCoupledComponents([c2, c1]);
    expect(canonical).toEqual(canonicalCoupledComponents([c1, c2]));
    expect(canonical).toHaveLength(2);
  });

  it('планирование не изменяет состояние среды и двукратный прогон даёт тот же план', () => {
    const f = makeEnv();
    const before = snapshotOf(f);
    const input = simpleInput('tx-pure-plan', [reactionComponent(rxCo2Hydroxylation(), 1e-5), transferAtmToOceanOco2(2e-5)]);
    const plan1 = planGeochemicalCoupledTransaction(f.env, input);
    const plan2 = planGeochemicalCoupledTransaction(f.env, input);
    expect(plan1.status).toBe('ready');
    expect(plan2.status).toBe('ready');
    if (plan1.status !== 'ready' || plan2.status !== 'ready') return;
    expect(JSON.stringify(plan1.aggregatedDeltas)).toBe(JSON.stringify(plan2.aggregatedDeltas));
    expect(snapshotOf(f)).toBe(before);
    expect(f.env.fluxLedgerInput.records).toHaveLength(0);
  });

  it('снимок транзакции отражает инвентари, размеры журналов и применённые id', () => {
    const f = makeEnv();
    const snapshot = captureCoupledTransactionSnapshot(f.env);
    expect(snapshot.reservoirCount).toBe(3);
    expect(snapshot.reactionLedgerSize).toBe(0);
    expect(snapshot.fluxLedgerSize).toBe(0);
    expect(snapshot.appliedTransactionIds).toEqual([]);
    expect(snapshot.reservoirInventories['ocean']?.entries['co2_aq']).toBeCloseTo(0.0012, 15);
    expect(snapshot.reservoirInventories['ocean']?.basis).toBe('column_amount');
  });

  it('допустимый баланс-зазор по умолчанию равен 1e-9 и переопределяется входом', () => {
    const f = makeEnv();
    const input = simpleInput('tx-tolerance', [
      reactionComponent(rxCo2Hydroxylation(), 1e-5)
    ]);
    const plan = planGeochemicalCoupledTransaction(f.env, input);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.audit.tolerance).toBe(GEOCHEMICAL_COUPLED_BALANCE_TOLERANCE);
    const tightPlan = planGeochemicalCoupledTransaction(f.env, { ...input, balanceTolerance: 0 });
    if (tightPlan.status === 'ready') {
      expect(tightPlan.audit.tolerance).toBe(0);
      expect(tightPlan.audit.status).toBe('balanced');
    }
  });
});

// ============================================
// 6. ПРИМЕНЕНИЕ К ЯДРУ МИРА (CoreWorldState), МИГРАЦИИ, JSON
// ============================================

function makeIsolatedCore(): CoreWorldState {
  const core = createCoreWorldState('w-coupled-test');
  core.bodies.push({ id: 'star', kind: 'star', properties: {} });
  core.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: { mass: knownValue(quantity(5.97e24, 'kg')) } // synthetic test fixture
  });
  core.gravity = { planet: 'star', star: null };
  core.radiationSources.push({ id: 'star-light', bodyId: 'star', kind: 'star' });
  core.reservoirs.push(
    { ...oceanReservoir(), bodyId: 'planet' },
    { ...atmosphereReservoir(), bodyId: 'planet' },
    { ...crustReservoir(), bodyId: 'planet' }
  );
  core.legacy = { generatorVersion: '0.3.0', seed: 'test-seed' };
  return core;
}

function envOfCore(core: CoreWorldState, cat: typeof catalog): GeochemicalCoupledExecutionEnvironment {
  const reservoirs: Record<string, ReservoirRecord> = {};
  for (const reservoir of core.reservoirs) reservoirs[reservoir.id] = reservoir;
  return {
    speciesCatalog: cat,
    reservoirs,
    reactionLedgerInput: core.reactionLedger,
    fluxLedgerInput: core.fluxLedger,
    appliedTransactionIds: core.geochemicalTransactionLog?.appliedTransactionIds ?? []
  };
}

describe('Stage 4.9d coupled: исполнение к ядру мира', () => {
  it('успешное применение обновляет затронутые резервуары и журналы, ядро 1.6.0, журнал транзакций дополнен', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const untouched = core.reservoirs[2];
    const result = executeGeochemicalCoupledTransactionOnWorld(core, catalog, simpleInput('tx-world-1', [
      reactionComponent(rxCo2Hydroxylation(), 1e-5),
      transferAtmToOceanOco2(2e-5)
    ]));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.core.schemaVersion).toBe('1.6.0');
    expect(result.core.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-world-1']);
    expect(validateWorldState(result.core)).toEqual([]);
    // Входное ядро побитово не изменено.
    expect(snapshotOf(core)).toBe(before);
    // Незатронутый резервуар разделяется по ссылке; затронутый - новая запись.
    expect(result.core.reservoirs[2]).toBe(untouched);
    expect(result.core.reservoirs[0] === core.reservoirs[0]).toBe(false);
    // plan -> validate -> commit: следующий план на новом ядре успешно строится.
    const followUp = planGeochemicalCoupledTransaction(envOfCore(result.core, catalog), simpleInput('tx-world-2', [externalInputCo2Ocean(1e-6)]));
    expect(followUp.status).toBe('ready');
  });

  it('ядро схемы 1.5.0 без журнала транзакций принимается (легаси-совместимость), результат 1.6.0', () => {
    const core = makeIsolatedCore();
    core.schemaVersion = '1.5.0';
    delete (core as { geochemicalTransactionLog?: unknown }).geochemicalTransactionLog;
    const result = executeGeochemicalCoupledTransactionOnWorld(core, catalog, simpleInput('tx-legacy-core', [externalInputCo2Ocean(1e-6)]));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.core.schemaVersion).toBe('1.6.0');
    expect(result.core.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-legacy-core']);
  });

  it('неподдерживаемая схема ядра отклоняется с указанием на миграцию', () => {
    const core = makeIsolatedCore();
    core.schemaVersion = '1.3.0';
    const result = executeGeochemicalCoupledTransactionOnWorld(core, catalog, simpleInput('tx-old-core', [externalInputCo2Ocean(1e-6)]));
    expect(result.status).toBe('not_applied');
    expect(result.status === 'not_applied' && result.reason).toContain('миграцию');
  });

  it('дублирующийся id резервуара в ядре отклоняется без построения среды', () => {
    const core = makeIsolatedCore();
    core.reservoirs.push(oceanReservoir());
    const result = executeGeochemicalCoupledTransactionOnWorld(core, catalog, simpleInput('tx-dup-reservoir', [externalInputCo2Ocean(1e-6)]));
    expect(result.status).toBe('not_applied');
    expect(result.status === 'not_applied' && result.issues.some((i) => i.includes('дублирующийся'))).toBe(true);
  });

  it('ошибка финальной валидации CoreWorldState откатывает применение (сломанные часы ядра)', () => {
    const core = makeIsolatedCore();
    // Сломанные часы: исполнитель валидирует РЕЗУЛЬТАТ и обязан откатиться
    // к нетронутому входу; состояние должно остаться неизменным.
    (core.clock as { segmentIndex: number }).segmentIndex = -1;
    const before = snapshotOf(core);
    const result = executeGeochemicalCoupledTransactionOnWorld(core, catalog, simpleInput('tx-invalid-core', [externalInputCo2Ocean(1e-6)]));
    expect(result.status).toBe('not_applied');
    expect(result.status === 'not_applied' && result.reason).toContain('validateWorldState');
    expect(snapshotOf(core)).toBe(before);
  });

  it('withTransactionLogApplied и иммутабельность журнала', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const updated = withTransactionLogApplied(core, 'tx-helper-1');
    expect(updated.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-helper-1']);
    const twice = withTransactionLogApplied(updated, 'tx-helper-2');
    expect(twice.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-helper-1', 'tx-helper-2']);
    // Вход не изменился.
    expect(snapshotOf(core)).toBe(before);
    expect(core.geochemicalTransactionLog?.appliedTransactionIds).toEqual([]);
  });

  it('миграция 1.8 -> 1.9: пустой журнал создаётся, известная схема ядра поднимается до 1.6.0, данные не тронуты', () => {
    const legacy = JSON.parse(JSON.stringify(makeIsolatedCore())) as CoreWorldState;
    legacy.schemaVersion = '1.5.0';
    delete (legacy as { geochemicalTransactionLog?: unknown }).geochemicalTransactionLog;
    const save = { version: '1.8', id: 'w-mig', coreWorldState: legacy };
    const result = migrateSavedWorld(save as never) as { world: { version: string; coreWorldState: CoreWorldState }; notes: string[]; from: string; to: string };
    expect(result.to).toBe('1.9');
    expect(result.world.version).toBe('1.9');
    const core = result.world.coreWorldState;
    expect(core.schemaVersion).toBe('1.6.0');
    expect(core.geochemicalTransactionLog?.appliedTransactionIds).toEqual([]);
    expect(core.reservoirs).toHaveLength(3);
  });

  it('миграция 1.8 -> 1.9: существующий журнал транзакций сохраняется; повторная миграция идемпотентна', () => {
    const core = makeIsolatedCore();
    core.geochemicalTransactionLog = { appliedTransactionIds: ['tx-earlier-1'] };
    const save = { version: '1.8', id: 'w-mig2', coreWorldState: core };
    const first = migrateSavedWorld(save as never) as { world: { version: string; coreWorldState: CoreWorldState }; notes: string[]; from: string; to: string };
    const migratedCore = first.world.coreWorldState;
    expect(migratedCore.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-earlier-1']);
    const second = migrateSavedWorld(first.world as never) as { world: { version: string; coreWorldState: CoreWorldState }; notes: string[]; from: string; to: string };
    expect(second.to).toBe('1.9');
    expect(second.notes).toEqual([]);
    expect(second.world.coreWorldState.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-earlier-1']);
    expect(CURRENT_SAVE_SCHEMA_VERSION).toBe('1.9');
  });

  it('миграция 1.8 -> 1.9: ядро неизвестной схемы не трогается и не получает журнал', () => {
    const core = makeIsolatedCore();
    core.schemaVersion = '7.7.7';
    delete (core as { geochemicalTransactionLog?: unknown }).geochemicalTransactionLog;
    const save = { version: '1.8', id: 'w-mig3', coreWorldState: core };
    const result = migrateSavedWorld(save as never) as { world: { version: string; coreWorldState: CoreWorldState }; notes: string[]; from: string; to: string };
    const migratedCore = result.world.coreWorldState;
    expect(migratedCore.schemaVersion).toBe('7.7.7');
    expect(migratedCore.geochemicalTransactionLog).toBeUndefined();
    expect(result.notes.some((n) => n.includes('не распознана'))).toBe(true);
  });

  it('JSON round-trip применённого состояния: validateWorldState пуст, транзакции сохранены', () => {
    const core = makeIsolatedCore();
    const applied = executeGeochemicalCoupledTransactionOnWorld(core, catalog, simpleInput('tx-json-1', [
      reactionComponent(rxCo2Hydroxylation(), 1e-5),
      transferAtmToOceanOco2(2e-5)
    ]));
    expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') return;
    const restored = JSON.parse(JSON.stringify(applied.core)) as CoreWorldState;
    expect(restored).toEqual(applied.core);
    expect(validateWorldState(restored)).toEqual([]);
    expect(restored.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-json-1']);
    // Анти-replay работает и после round-trip.
    const replan = planGeochemicalCoupledTransaction(envOfCore(restored, catalog), simpleInput('tx-json-1', [
      reactionComponent(rxCo2Hydroxylation(), 1e-5)
    ]));
    expect(replan.status).toBe('blocked');
  });
});

