// ============================================
// CO2 PHASE EXCHANGE TESTS — атомарный фазовый переход CO2(г) ⇌ CO2(aq)
// (Stage 4.9e)
// ============================================
//
// Интеграционные проверки адаптера фазового обмена поверх атомарного
// исполнителя coupled-транзакций Stage 4.9d: единый transactionId,
// растворение/испарение по явному количеству (НЕ скорость), анти-replay,
// stale snapshot, побитовая неизменность входа при отказе, различие
// co2 и co2_aq, отсутствие фиктивных потоков/реакций, вывод обмена из
// замкнутого равновесия Stage 4.9e.
//
// ВАЖНО: все численные значения — синтетические величины фикстур
// (synthetic test fixture): НЕ данные атмосферы/океана, НЕ наблюдения
// и НЕ калибровка.

import { describe, it, expect } from 'vitest';

import {
  CO2_DISSOLUTION_PROCESS_ID,
  CO2_VOLATILISATION_PROCESS_ID,
  CO2_PHASE_EXCHANGE_TRANSFER_TOLERANCE_MOL_M2,
  CO2_PHASE_EXCHANGE_DEFINITION_PROVENANCE,
  buildCO2PhaseExchangeReactionDefinition,
  co2PhaseExchangeFromEquilibrium,
  executeCO2PhaseExchange,
  planCO2PhaseExchange,
  executeCO2PhaseExchangePrepared,
  validateCO2PhaseExchangeInput
} from '../Core/co2ExchangeExecution';
import type { CO2PhaseExchangeInput } from '../Core/co2ExchangeExecution';
import type { CO2AtmosphereOceanEquilibriumResult } from '../Core/co2Solubility';
import { buildGeochemicalSpeciesCatalog } from '../Data/geochemicalSpeciesCatalog';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { createCoreWorldState, validateWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { knownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import type { FluxTime } from '../Core/fluxLedger';

// ============================================
// ФИКСТУРЫ (synthetic test fixtures)
// ============================================

const FIXTURE_PROVENANCE = {
  sourceName: 'synthetic test fixture: Stage 4.9e (тестовые числа)',
  sourceId: 'evowars/tests/stage-4.9e/co2-exchange-fixture',
  recordId: 'synthetic-co2-exchange-fixture'
};

const AMOUNT_PROVENANCE = {
  ...FIXTURE_PROVENANCE,
  note: 'synthetic test fixture: количество обмена задано явно (равновесие/вход), НЕ измеренное и НЕ скорость'
};

/** Газовый вид co2 (легаси-газ) в тестовый каталог. */
const catalog = buildGeochemicalSpeciesCatalog();
catalog.register({
  id: 'co2',
  formula: 'CO2',
  elements: { C: 1, O: 2 },
  charge: 0,
  phase: 'gas',
  molarMassKgMol: 0.0440095,
  molarMassStatus: 'known',
  dataStatus: 'known',
  provenance: {
    sourceName: 'synthetic test fixture: газовый co2 (легаси-вид Data/gases.ts) переобъявлен для тестовой среды Stage 4.9e',
    sourceId: 'evowars/tests/stage-4.9e/co2-gas-species-fixture',
    recordId: 'co2-gas-fixture'
  }
});

function fixtureTime(): FluxTime {
  return { segmentIndex: 0, localTimeS: 100 };
}

function atmosphereReservoir(entriesOverride: Record<string, number> = {}): ReservoirRecord {
  const reservoir = createReservoir('atmosphere', 'atmospheric_column', {
    note: 'synthetic test fixture: столб газового co2, mol/m²'
  });
  return setMaterialInventory(reservoir, 'column_amount', { co2: 0.0169, ...entriesOverride });
}

function oceanReservoir(entriesOverride: Record<string, number> = {}): ReservoirRecord {
  const reservoir = createReservoir('ocean', 'ocean_surface', {
    note: 'synthetic test fixture: столбовые запасы растворённого углерода, mol/m²'
  });
  return setMaterialInventory(reservoir, 'column_amount', {
    co2_aq: 0.0012,
    hco3_aq: 0.0020,
    co3_aq: 0.0002,
    hplus_aq: 1e-8,
    oh_aq: 0.002,
    h2o_aq: 9000,
    ...entriesOverride
  });
}

function makeCore(atmosphereEntries: Record<string, number> = {}, oceanEntries: Record<string, number> = {}): CoreWorldState {
  const core = createCoreWorldState('w-co2-phase-test');
  core.bodies.push({ id: 'star', kind: 'star', properties: {} });
  core.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: { mass: knownValue(quantity(5.97e24, 'kg')) } // synthetic test fixture
  });
  core.gravity = { planet: 'star', star: null };
  core.radiationSources.push({ id: 'star-light', bodyId: 'star', kind: 'star' });
  core.reservoirs.push(
    { ...atmosphereReservoir(atmosphereEntries), bodyId: 'planet' },
    { ...oceanReservoir(oceanEntries), bodyId: 'planet' }
  );
  core.legacy = { generatorVersion: '0.3.0', seed: 'test-seed' };
  return core;
}

function exchangeInput(overrides: Partial<CO2PhaseExchangeInput> = {}): CO2PhaseExchangeInput {
  return {
    transactionId: 'tx-co2-phase-1',
    direction: 'dissolution',
    atmosphereReservoirId: 'atmosphere',
    oceanReservoirId: 'ocean',
    amountMolPerM2: 5e-5,
    amountProvenance: AMOUNT_PROVENANCE,
    time: fixtureTime(),
    ...overrides
  };
}

/** Строковый снимок произвольного объекта для побитовой проверки. */
function snapshotOf(value: unknown): string {
  return JSON.stringify(value);
}

function entriesOf(core: CoreWorldState, id: string): Record<string, number> {
  const reservoir = core.reservoirs.find((r) => r.id === id);
  return (reservoir?.material?.entries ?? {}) as Record<string, number>;
}

// ============================================
// 1. УСПЕШНОЕ ПРИМЕНЕНИЕ
// ============================================

describe('Stage 4.9e фазовый обмен: успешное применение', () => {
  it('растворение: co2 атмосферы уменьшается, co2_aq океана растёт на ту же величину (один transactionId)', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.transactionId).toBe('tx-co2-phase-1');
    expect(result.processId).toBe(CO2_DISSOLUTION_PROCESS_ID);
    expect(result.amountMolPerM2).toBe(5e-5);
    expect(entriesOf(result.core, 'atmosphere')['co2']).toBeCloseTo(0.0169 - 5e-5, 15);
    expect(entriesOf(result.core, 'ocean')['co2_aq']).toBeCloseTo(0.0012 + 5e-5, 15);
    // Побитовая неизменность входа.
    expect(snapshotOf(core)).toBe(before);
    // Затронуты только два вида; co2_aq не появился в атмосфере, co2 не появился в океане.
    expect(result.aggregatedDeltas).toHaveLength(2);
    const pairs = result.aggregatedDeltas.map((d) => d.reservoirId + '/' + d.speciesId).sort();
    expect(pairs).toEqual(['atmosphere/co2', 'ocean/co2_aq']);
    // Аудит и валидация мира.
    expect(result.audit.status).toBe('balanced');
    expect(result.audit.chargeResidual).toBe(0);
    expect(validateWorldState(result.core)).toEqual([]);
    // Журнал транзакций дополнен ровно одной транзакцией.
    expect(result.core.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-co2-phase-1']);
  });

  it('испарение: co2_aq океана уменьшается, co2 атмосферы растёт; процесс каталога — ocean_atm_exchange', () => {
    const core = makeCore();
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput({ direction: 'volatilisation', transactionId: 'tx-co2-phase-2' }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.processId).toBe(CO2_VOLATILISATION_PROCESS_ID);
    expect(entriesOf(result.core, 'ocean')['co2_aq']).toBeCloseTo(0.0012 - 5e-5, 15);
    expect(entriesOf(result.core, 'atmosphere')['co2']).toBeCloseTo(0.0169 + 5e-5, 15);
    const pairs = result.aggregatedDeltas.map((d) => d.reservoirId + '/' + d.speciesId).sort();
    expect(pairs).toEqual(['atmosphere/co2', 'ocean/co2_aq']);
  });

  it('co2 и co2_aq — разные виды: инвентари не смешиваются, записи ReactionLedger несут фазы через speciesId', () => {
    const core = makeCore();
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(entriesOf(result.core, 'ocean')['co2']).toBeUndefined();
    expect(entriesOf(result.core, 'atmosphere')['co2_aq']).toBeUndefined();
    const record = result.core.reactionLedger?.records[0];
    expect(record?.reactants[0]?.speciesId).toBe('co2');
    expect(record?.products[0]?.speciesId).toBe('co2_aq');
    expect(record?.reactants[0]?.reservoirId).toBe('atmosphere');
    expect(record?.products[0]?.reservoirId).toBe('ocean');
  });

  it('нет фиктивных потоков: reaction-механика НЕ пишет в FluxLedger', () => {
    const core = makeCore();
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.core.fluxLedger.records).toHaveLength(0);
    expect(result.core.reactionLedger?.records).toHaveLength(1);
    expect(result.core.reactionLedger?.records[0]?.geochemical?.mechanism).toBe('reaction');
    expect(result.core.reactionLedger?.records[0]?.geochemical?.processId).toBe(CO2_DISSOLUTION_PROCESS_ID);
  });

  it('последовательность растворение → испарение с тем же количеством возвращает систему к исходному распределению (сумма co2 + co2_aq сохранена)', () => {
    const core = makeCore();
    const carbonBefore = (entriesOf(core, 'atmosphere')['co2'] ?? 0) + (entriesOf(core, 'ocean')['co2_aq'] ?? 0);
    const step1 = executeCO2PhaseExchange(core, catalog, exchangeInput({ transactionId: 'tx-seq-dissolve' }));
    expect(step1.status).toBe('applied');
    if (step1.status !== 'applied') return;
    const step2 = executeCO2PhaseExchange(step1.core, catalog, exchangeInput({ transactionId: 'tx-seq-volatilise', direction: 'volatilisation' }));
    expect(step2.status).toBe('applied');
    if (step2.status !== 'applied') return;
    const carbonAfter = (entriesOf(step2.core, 'atmosphere')['co2'] ?? 0) + (entriesOf(step2.core, 'ocean')['co2_aq'] ?? 0);
    expect(carbonAfter).toBeCloseTo(carbonBefore, 15);
    expect(entriesOf(step2.core, 'atmosphere')['co2']).toBeCloseTo(0.0169, 15);
    expect(entriesOf(step2.core, 'ocean')['co2_aq']).toBeCloseTo(0.0012, 15);
    // Обе транзакции учтены анти-replay-журналом.
    expect(step2.core.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-seq-dissolve', 'tx-seq-volatilise']);
  });
});

// ============================================
// 2. ОТКАЗЫ И ПОБИТОВАЯ НЕИЗМЕННОСТЬ
// ============================================

describe('Stage 4.9e фазовый обмен: отказы без изменения входа', () => {
  it('недостаточный запас атмосферы: отрицательный финальный инвентарь отклоняется до применения', () => {
    const core = makeCore({ co2: 1e-6 });
    const before = snapshotOf(core);
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput({ amountMolPerM2: 5e-5 }));
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
    expect(result.status === 'not_applied' && (result.issues.some((i) => i.includes('отрицател')) || result.reason.includes('отрицател'))).toBe(true);
  });

  it('неизвестное количество реагента (нет co2_aq в океане при испарении): unknown != 0', () => {
    const core = makeCore();
    delete (core.reservoirs[1] as unknown as { material: { entries: Record<string, number> } }).material.entries['co2_aq'];
    const before = snapshotOf(core);
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput({ direction: 'volatilisation' }));
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
    expect(result.status === 'not_applied' && (result.issues.some((i) => i.toLowerCase().includes('неизвестно')) || ['not_verifiable', 'not_executable'].includes(result.reasonKind))).toBe(true);
  });

  it('отсутствующий резервуар отклоняется (молчаливое создание инвентаря запрещено)', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput({ oceanReservoirId: 'martian_ocean' }));
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
    expect(result.status === 'not_applied' && result.issues.some((i) => i.includes('martian_ocean'))).toBe(true);
  });

  it('нулевой, отрицательный, NaN и amounted-бесконечность — форма входа, отказ до планирования', () => {
    const core = makeCore();
    for (const [label, amount] of [
      ['zero', 0],
      ['negative', -5e-5],
      ['nan', Number.NaN],
      ['infinity', Number.POSITIVE_INFINITY]
    ] as const) {
      const result = executeCO2PhaseExchange(core, catalog, exchangeInput({ amountMolPerM2: amount, transactionId: 'tx-form-' + label }));
      expect(result.status, label).toBe('not_applied');
      expect(result.status === 'not_applied' && result.reason).toContain("форм");
    }
    expect(validateCO2PhaseExchangeInput(exchangeInput())).toEqual([]);
  });

  it('неидентифицированный provenance количества — отказ', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput({ amountProvenance: { note: 'источник не назван' } as never }));
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
    expect(result.status === 'not_applied' && result.issues.some((i) => i.toLowerCase().includes('provenance'))).toBe(true);
  });

  it('одинаковые атмосферный и океанский резервуары отклоняются: переход идёт МЕЖДУ фазами', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const result = executeCO2PhaseExchange(core, catalog, exchangeInput({ oceanReservoirId: 'atmosphere' }));
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
    expect(result.status === 'not_applied' && result.issues.some((i) => i.includes('МЕЖДУ фазами'))).toBe(true);
  });
});

// ============================================
// 3. АНТИ-REPLAY И УСТАРЕВШИЙ СНИМОК
// ============================================

describe('Stage 4.9e фазовый обмен: анти-replay, stale snapshot, план/исполнение', () => {
  it('повторный transactionId отклоняется (анти-replay), состояние неизменно', () => {
    const core = makeCore();
    const first = executeCO2PhaseExchange(core, catalog, exchangeInput());
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    const firstCore = first.core;
    const snapshotFirst = snapshotOf(firstCore);
    const second = executeCO2PhaseExchange(firstCore, catalog, exchangeInput());
    expect(second.status).toBe('not_applied');
    expect(second.status === 'not_applied' && second.reasonKind).toBe('duplicate_transaction');
    expect(snapshotOf(firstCore)).toBe(snapshotFirst);
    expect(firstCore.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-co2-phase-1']);
  });

  it('stale snapshot: план построен на состоянии A, состояние изменилось — исполнитель Stage 4.9d даёт stale_snapshot', () => {
    const core = makeCore();
    const prepared = planCO2PhaseExchange(core, catalog, exchangeInput());
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    // Состояние изменилось между планом и исполнением (замена океана).
    const mutated = makeCore({}, { co2_aq: 0.0020 });
    const beforeMutated = snapshotOf(mutated);
    const result = executeCO2PhaseExchangePrepared(mutated, catalog, prepared);
    expect(result.status).toBe('not_applied');
    expect(result.status === 'not_applied' && result.reasonKind).toBe('stale_snapshot');
    expect(snapshotOf(mutated)).toBe(beforeMutated);
    // План на исходном состоянии всё ещё исполним и применяет ровно ожидаемое.
    const fresh = executeCO2PhaseExchangePrepared(core, catalog, prepared);
    expect(fresh.status).toBe('applied');
    if (fresh.status !== 'applied') return;
    expect(entriesOf(fresh.core, 'ocean')['co2_aq']).toBeCloseTo(0.0012 + 5e-5, 15);
  });

  it('план фазового обмена не изменяет состояние; определение реакции стабильно и связано с каталогом', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const prepared = planCO2PhaseExchange(core, catalog, exchangeInput());
    expect(prepared.status).toBe('ready');
    expect(snapshotOf(core)).toBe(before);
    const definition = buildCO2PhaseExchangeReactionDefinition({
      direction: 'dissolution',
      atmosphereReservoirId: 'atmosphere',
      oceanReservoirId: 'ocean'
    });
    expect(definition.extentBasis).toBe('column_amount');
    expect(definition.processId).toBe(CO2_DISSOLUTION_PROCESS_ID);
    expect(definition.reactants[0]?.coefficient).toBe(1);
    expect(CO2_PHASE_EXCHANGE_DEFINITION_PROVENANCE.sourceId).toContain('10.1016/0304-4203');
    // Обратное направление — другой processId каталога.
    const reverse = buildCO2PhaseExchangeReactionDefinition({
      direction: 'volatilisation',
      atmosphereReservoirId: 'atmosphere',
      oceanReservoirId: 'ocean'
    });
    expect(reverse.processId).toBe(CO2_VOLATILISATION_PROCESS_ID);
    expect(reverse.products[0]?.speciesId).toBe('co2');
  });
});

// ============================================
// 4. ДЕТЕРМИНИЗМ, JSON, ВЫВОД ИЗ РАВНОВЕСИЯ
// ============================================

/**
 * Минимальный синтетический «applied»-результат замкнутого равновесия
 * (только поля, читаемые co2PhaseExchangeFromEquilibrium; все числа —
 * synthetic test fixture). Приведение через unknown: helper не читает
 * вложенные поля, а тест не обязан воспроизводить полную форму решателя.
 */
function fakeAppliedEquilibrium(carbonTransferAtmToOceanMolPerM2: number): CO2AtmosphereOceanEquilibriumResult {
  const raw = {
    status: 'applied',
    fCO2Atm: 4.0531e-4,
    pCO2Atm: 4.0531e-4,
    fugacityUnit: 'atm',
    idealGasAssumption: true,
    idealFugacityAssumption: true,
    atmosphereCO2ColumnAfterMolPerM2: 0.001,
    oceanDICMolPerKgSw: 0.002,
    oceanCO2StarMolPerKgSw: 1.15e-5,
    solve: { status: 'applied' },
    K0MolPerKgSwPerAtm: 0.0284,
    solubilityUnit: 'mol/kg-SW/atm',
    totalCarbonColumnMolPerM2: 2.151,
    carbonConservationResidualMolPerM2: 0,
    carbonConservationToleranceMolPerM2: 1e-9,
    carbonTransferAtmToOceanMolPerM2,
    equilibriumKind: 'thermodynamic_target_not_kinetics',
    provenance: {},
    warnings: []
  };
  return raw as unknown as CO2AtmosphereOceanEquilibriumResult;
}

describe('Stage 4.9e фазовый обмен: детерминизм, JSON, равновесие', () => {
  it('детерминизм: два одинаковых прогона дают одинаковые результаты', () => {
    const c1 = makeCore();
    const c2 = makeCore();
    const r1 = executeCO2PhaseExchange(c1, catalog, exchangeInput());
    const r2 = executeCO2PhaseExchange(c2, catalog, exchangeInput());
    expect(r1.status).toBe('applied');
    expect(r2.status).toBe('applied');
    if (r1.status !== 'applied' || r2.status !== 'applied') return;
    expect(snapshotOf(r1.core)).toBe(snapshotOf(r2.core));
  });

  it('JSON round-trip применённого состояния: валидация полна, анти-replay сохраняется', () => {
    const core = makeCore();
    const applied = executeCO2PhaseExchange(core, catalog, exchangeInput());
    expect(applied.status).toBe('applied');
    if (applied.status !== 'applied') return;
    const restored = JSON.parse(JSON.stringify(applied.core)) as CoreWorldState;
    expect(restored).toEqual(applied.core);
    expect(validateWorldState(restored)).toEqual([]);
    const replay = executeCO2PhaseExchange(restored, catalog, exchangeInput());
    expect(replay.status).toBe('not_applied');
    expect(replay.status === 'not_applied' && replay.reasonKind).toBe('duplicate_transaction');
    // Новая транзакция на восстановленном состоянии работает.
    const next = executeCO2PhaseExchange(restored, catalog, exchangeInput({ transactionId: 'tx-co2-phase-2', direction: 'volatilisation' }));
    expect(next.status).toBe('applied');
  });

  it('co2PhaseExchangeFromEquilibrium: перенос из синтетического равновесия даёт направление и количество', () => {
    const applied = fakeAppliedEquilibrium(7.5e-4);
    const ready = co2PhaseExchangeFromEquilibrium(applied);
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.direction).toBe('dissolution');
    expect(ready.amountMolPerM2).toBeCloseTo(7.5e-4, 18);
    expect(
      executeCO2PhaseExchange(
        makeCore({ co2: 0.0169 }, { co2_aq: 0.0012 }),
        catalog,
        exchangeInput({ transactionId: 'tx-from-equilibrium', direction: ready.direction, amountMolPerM2: Math.min(ready.amountMolPerM2, 5e-5) })
      ).status
    ).toBe('applied');
  });

  it('co2PhaseExchangeFromEquilibrium: нулевой перенос в допуске — no_transfer; несошедшееся равновесие — not_available', () => {
    const base = fakeAppliedEquilibrium(CO2_PHASE_EXCHANGE_TRANSFER_TOLERANCE_MOL_M2 / 2);
    const none = co2PhaseExchangeFromEquilibrium(base);
    expect(none.status).toBe('no_transfer');
    const unverifiable: CO2AtmosphereOceanEquilibriumResult = {
      status: 'not_verifiable',
      missingInputs: ['atmosphere (газовое состояние: температура столба газа)'],
      reason: 'температура газа не дана: глобальное равновесие не решается'
    };
    const unavailable = co2PhaseExchangeFromEquilibrium(unverifiable);
    expect(unavailable.status).toBe('not_available');
    if (unavailable.status === 'not_available') {
      expect(unavailable.issues[0]).toContain('atmosphere');
    }
    const failed: CO2AtmosphereOceanEquilibriumResult = {
      status: 'not_applied',
      reasonKind: 'no_solution',
      reason: 'равновесие ниже границы поиска, решения нет',
      issues: []
    };
    expect(co2PhaseExchangeFromEquilibrium(failed).status).toBe('not_available');
  });
});
