// ============================================
// CARBONATE SPECIATION EXECUTION TESTS — применение карбонатной
// специации к инвентарю океана (Stage 4.9d)
// ============================================
//
// Тесты атомарного применения результатов карбонатной специации
// Stage 4.9c к столбовым инвентарям океана: конверсия единиц только
// через явную массу водного столба, сохранение DIC, зарядовый аудит
// с фоновой компенсацией, атомарность «всё или ничего», анти-replay,
// stale snapshot, побитовая неизменность входа при отказах, JSON
// round-trip, детерминизм, миграции сохранений.
//
// ВАЖНО: все численные значения ниже — синтетические величины
// фикстур (synthetic test fixture): НЕ физические данные океана, НЕ
// калибровка и НЕ основание климатических выводов. Равновесные
// распределения заданы тестовыми числами (в производственном пути
// их даёт solveCarbonateEquilibrium Stage 4.9c); исполнитель
// равновесие НЕ решает и второй карбонатный решатель не создаётся.

import { describe, it, expect } from 'vitest';

import {
  CARBONATE_BASELINE_TOLERANCE_MOL_M2,
  CARBONATE_SPECIATION_CHARGE_TOLERANCE_MOL_PER_KG_SW,
  CARBONATE_SPECIATION_DIC_TOLERANCE_MOL_PER_KG_SW,
  CARBONATE_SPECIATION_PROCESS_ID,
  SEAWATER_COLUMN_MASS_UNIT,
  captureSpeciationTransactionSnapshot,
  executeCarbonateSpeciationExecution,
  planCarbonateSpeciationExecution
} from '../Core/carbonateSpeciationExecution';
import type {
  CarbonateSpeciationDistribution,
  CarbonateSpeciationExecutionInput,
  SeawaterColumnMass,
  StrongIonChargeCompensation
} from '../Core/carbonateSpeciationExecution';
import { buildGeochemicalSpeciesCatalog } from '../Data/geochemicalSpeciesCatalog';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { knownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { createCoreWorldState, validateWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { migrateSavedWorld, CURRENT_SAVE_SCHEMA_VERSION } from '../Core/migrations';

// ============================================
// ФИКСТУРЫ (synthetic test fixtures)
// ============================================

const catalog = buildGeochemicalSpeciesCatalog();

/** Явно заданная масса водного столба (synthetic test fixture). */
const COLUMN_MASS = 1000;

/** Синтетическое происхождение чисел фикстуры (идентифицирует «тест», не физику). */
const FIXTURE_PROVENANCE = {
  sourceName: 'synthetic test fixture: карбонатная специация Stage 4.9d (тестовые числа)',
  sourceId: 'evowars/tests/stage-4.9d/speciation-fixture',
  recordId: 'synthetic-speciation-fixture'
};

const COLUMN_MASS_PROVENANCE = {
  ...FIXTURE_PROVENANCE,
  note: 'synthetic test fixture: масса столба задана ЯВНО для проверки механики, НЕ измеренная и НЕ вычисленная из глубины величина'
};

interface DistOverrides {
  readonly phScale?: CarbonateSpeciationDistribution['phScale'];
  readonly activityModel?: CarbonateSpeciationDistribution['activityModel'];
  readonly temperatureK?: number;
  readonly salinityPSU?: number;
  readonly pressurePa?: number;
  readonly co2Star?: number;
  readonly hco3?: number;
  readonly co3?: number;
  readonly hydrogen?: number;
  readonly oh?: number | null;
}

/** Равновесное распределение (в производственном пути — результат Stage 4.9c). */
function distribution(overrides: DistOverrides = {}): CarbonateSpeciationDistribution {
  return {
    phScale: overrides.phScale ?? 'seawater',
    activityModel: overrides.activityModel ?? 'ideal_dilute',
    temperatureK: overrides.temperatureK ?? 293.15,
    salinityPSU: overrides.salinityPSU ?? 35,
    pressurePa: overrides.pressurePa ?? 101325,
    approximationKind: 'ideal_dilute',
    concentrations: {
      co2StarMolPerKgSw: overrides.co2Star ?? 1.2e-6,
      hco3MolPerKgSw: overrides.hco3 ?? 2.0e-6,
      co3MolPerKgSw: overrides.co3 ?? 2.0e-7,
      hydrogenMolPerKgSw: overrides.hydrogen ?? 1e-8,
      ohMolPerKgSw: overrides.oh === undefined ? 1e-6 : overrides.oh
    },
    provenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: распределение видов, в производстве — результат Stage 4.9c' }
  };
}

// Baseline и target при ОДНОМ DIC (3.4e-6 mol/kg-SW, synthetic test fixture):
// сдвиг распределения co2_aq → hco3_aq при изменении pH.
const BASELINE = distribution();
const TARGET = distribution({ co2Star: 1.0e-6, hco3: 2.2e-6, hydrogen: 5e-8, oh: 2e-7 });

/** Компенсация фона сильных ионов, закрывающая модельный заряд сдвига. */
function strongIonCompensationFor(
  b: CarbonateSpeciationDistribution,
  t: CarbonateSpeciationDistribution
): StrongIonChargeCompensation {
  const ohB = b.concentrations.ohMolPerKgSw ?? 0;
  const ohT = t.concentrations.ohMolPerKgSw ?? 0;
  const chargeDelta =
    (t.concentrations.hydrogenMolPerKgSw - b.concentrations.hydrogenMolPerKgSw) +
    (ohT - ohB) * -1 +
    (t.concentrations.hco3MolPerKgSw - b.concentrations.hco3MolPerKgSw) * -1 +
    (t.concentrations.co3MolPerKgSw - b.concentrations.co3MolPerKgSw) * -2;
  return {
    deltaStrongIonChargeMolPerKgSw: -chargeDelta,
    provenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: фон сильных ионов (Na+, Cl-, SO4^2-), закрывающий заряд сдвига' }
  };
}

/** Явная масса столба с provenance (synthetic test fixture). */
function columnMassFixture(value: number): SeawaterColumnMass {
  return { valueKgPerM2: value, unit: SEAWATER_COLUMN_MASS_UNIT, provenance: COLUMN_MASS_PROVENANCE };
}

/**
 * Инвентарь океана строится РОВНО из baseline × масса столба теми же
 * числами (требование согласования baseline с инвентарём).
 */
function oceanInventory(b: CarbonateSpeciationDistribution): Record<string, number> {
  return {
    co2_aq: b.concentrations.co2StarMolPerKgSw * COLUMN_MASS,
    hco3_aq: b.concentrations.hco3MolPerKgSw * COLUMN_MASS,
    co3_aq: b.concentrations.co3MolPerKgSw * COLUMN_MASS,
    hplus_aq: b.concentrations.hydrogenMolPerKgSw * COLUMN_MASS,
    oh_aq: (b.concentrations.ohMolPerKgSw ?? 0) * COLUMN_MASS,
    // synthetic test fixture: растворитель h2o_aq — НЕ переносимый запас, не меняется
    h2o_aq: 9000,
    caco3: 0.004
  };
}

function oceanReservoir(b: CarbonateSpeciationDistribution, entriesOverride: Record<string, number> = {}): ReservoirRecord {
  const reservoir = createReservoir('ocean', 'ocean_surface', {
    note: 'synthetic test fixture: столбовые запасы mol/m², построены из baseline умножить на масса столба'
  });
  return setMaterialInventory(reservoir, 'column_amount', { ...oceanInventory(b), ...entriesOverride });
}

function atmosphereReservoir(): ReservoirRecord {
  const reservoir = createReservoir('atmosphere', 'atmospheric_column', {
    note: 'synthetic test fixture: столб co2_aq вне зоны применения специации'
  });
  return setMaterialInventory(reservoir, 'column_amount', { co2_aq: 0.0008 });
}

function crustReservoir(): ReservoirRecord {
  const reservoir = createReservoir('crust', 'crustal_column', {
    note: 'synthetic test fixture: запас caco3 фикстуры'
  });
  return setMaterialInventory(reservoir, 'column_amount', { caco3: 0.05, co3_aq: 0.0001 });
}

function makeIsolatedCore(entriesOverride: Record<string, number> = {}): CoreWorldState {
  const core = createCoreWorldState('w-speciation-test');
  core.bodies.push({ id: 'star', kind: 'star', properties: {} });
  core.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: { mass: knownValue(quantity(5.97e24, 'kg')) } // synthetic test fixture
  });
  core.gravity = { planet: 'star', star: null };
  core.radiationSources.push({ id: 'star-light', bodyId: 'star', kind: 'star' });
  core.reservoirs.push(
    { ...oceanReservoir(BASELINE, entriesOverride), bodyId: 'planet' },
    { ...atmosphereReservoir(), bodyId: 'planet' },
    { ...crustReservoir(), bodyId: 'planet' }
  );
  core.legacy = { generatorVersion: '0.3.0', seed: 'test-seed' };
  return core;
}

function makeInput(transactionId: string, baseline = BASELINE, target = TARGET): CarbonateSpeciationExecutionInput {
  return {
    transactionId,
    oceanReservoirId: 'ocean',
    baseline,
    target,
    seawaterColumnMassKgPerM2: columnMassFixture(COLUMN_MASS),
    strongIonChargeCompensationMolPerKgSw: strongIonCompensationFor(baseline, target)
  };
}

/** Строковый снимок произвольного объекта для побитовой проверки неизменности. */
function snapshotOf(value: unknown): string {
  return JSON.stringify(value);
}

function expectNotApplied(
  result: { status: string; reasonKind?: string },
  kind: string
): void {
  expect(result.status).toBe('not_applied');
  if (result.reasonKind !== undefined) {
    expect(result.reasonKind).toBe(kind);
  }
}

// ============================================
// 1. ЕДИНИЦЫ И PROVENANCE
// ============================================

describe('Stage 4.9d speciation: единицы и provenance', () => {
  it('mol/kg-SW → mol/m² только через явную массу столба: все дельты равны deltaMolPerKgSw × 1000', () => {
    const core = makeIsolatedCore();
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-units-1'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.processId).toBe(CARBONATE_SPECIATION_PROCESS_ID);
    for (const d of result.deltas) {
      expect(d.deltaMolM2).toBeCloseTo(d.deltaMolPerKgSw * COLUMN_MASS, 20);
    }
    // Ожидаемые столбовые дельты фикстуры (synthetic test fixture):
    const bySpecies = new Map(result.deltas.map((d) => [d.speciesId, d.deltaMolM2] as const));
    expect(bySpecies.get('co2_aq')).toBeCloseTo(-0.0002, 15);
    expect(bySpecies.get('hco3_aq')).toBeCloseTo(0.0002, 15);
    expect(bySpecies.get('hplus_aq')).toBeCloseTo(4e-5, 15);
    expect(bySpecies.get('oh_aq')).toBeCloseTo(-8e-4, 15);
    expect(result.changedReservoirs).toEqual(['ocean']);
  });

  it('отсутствие массы водного столба — контролируемый отказ, инвентари не тронуты', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const input = { ...makeInput('tx-no-mass'), seawaterColumnMassKgPerM2: undefined as never };
    const result = executeCarbonateSpeciationExecution(core, catalog, input);
    expectNotApplied(result, 'not_executable');
    if (result.status === 'not_applied') {
      expect(result.issues.join(' ')).toContain('seawaterColumnMassKgPerM2');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('нулевая масса столба запрещена', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const result = executeCarbonateSpeciationExecution(core, catalog, {
      ...makeInput('tx-zero-mass'),
      seawaterColumnMassKgPerM2: columnMassFixture(0)
    });
    expectNotApplied(result, 'not_executable');
    expect(snapshotOf(core)).toBe(before);
  });

  it('отрицательная масса столба запрещена', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const result = executeCarbonateSpeciationExecution(core, catalog, {
      ...makeInput('tx-neg-mass'),
      seawaterColumnMassKgPerM2: columnMassFixture(-5)
    });
    expectNotApplied(result, 'not_executable');
    expect(snapshotOf(core)).toBe(before);
  });

  it('NaN и Infinity массы столба запрещены', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    for (const [label, value] of [['nan', Number.NaN], ['infinite', Number.POSITIVE_INFINITY]] as const) {
      const result = executeCarbonateSpeciationExecution(core, catalog, {
        ...makeInput('tx-bad-mass-' + label),
        seawaterColumnMassKgPerM2: columnMassFixture(value)
      });
      expect(result.status).toBe('not_applied');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('неидентифицированный provenance массы столба отклоняется', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const mass = { valueKgPerM2: COLUMN_MASS, unit: SEAWATER_COLUMN_MASS_UNIT, provenance: { note: 'источник не назван' } as never };
    const result = executeCarbonateSpeciationExecution(core, catalog, {
      ...makeInput('tx-mass-no-prov'),
      seawaterColumnMassKgPerM2: mass
    });
    expectNotApplied(result, 'not_executable');
    if (result.status === 'not_applied') {
      expect(result.issues.join(' ').toLowerCase()).toContain('provenance');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('неподходящая единица массы столба отклоняется (молчаливой конверсии нет)', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const mass = { valueKgPerM2: COLUMN_MASS, unit: 'kg/m2', provenance: COLUMN_MASS_PROVENANCE } as never;
    const result = executeCarbonateSpeciationExecution(core, catalog, {
      ...makeInput('tx-bad-unit'),
      seawaterColumnMassKgPerM2: mass
    });
    expectNotApplied(result, 'not_executable');
    if (result.status === 'not_applied') {
      expect(result.issues.join(' ')).toContain('kg/m2');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('несовместимые baseline и target (разный DIC) отклоняются: это не заданный сдвиг', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const target = distribution({ co2Star: 1.0e-6, hco3: 2.2e-6, co3: 2.5e-7, hydrogen: 5e-8, oh: 2e-7 });
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-dic-shift', BASELINE, target));
    expectNotApplied(result, 'not_executable');
    if (result.status === 'not_applied') {
      expect(result.reason).toContain('DIC');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('нефинитная концентрация в target отклоняется до пересчёта единиц', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const target = distribution({ co2Star: 1.0e-6, hco3: 2.2e-6, co3: Number.POSITIVE_INFINITY, hydrogen: 5e-8 });
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-inf-target', BASELINE, target));
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
  });
});

// ============================================
// 2. ХИМИЧЕСКИЕ ИНВАРИАНТЫ
// ============================================

describe('Stage 4.9d speciation: химические инварианты', () => {
  it('сохранение DIC: невязка mol/kg-SW в допуске 4.9c, C-невязка аудита тоже', () => {
    const core = makeIsolatedCore();
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-dic-1'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.dicAfterMolPerKgSw).toBeCloseTo(result.dicBeforeMolPerKgSw, 20);
    expect(result.dicConservationResidualMolPerKgSw).toBeLessThanOrEqual(CARBONATE_SPECIATION_DIC_TOLERANCE_MOL_PER_KG_SW);
    expect(result.dicAfterMolM2).toBeCloseTo(result.dicBeforeMolM2, 15);
    expect(result.dicConservationResidualMolM2).toBeLessThanOrEqual(CARBONATE_SPECIATION_DIC_TOLERANCE_MOL_PER_KG_SW * COLUMN_MASS);
    const cResidual = result.elementResiduals.find((e) => e.element === 'C');
    expect(cResidual?.conservationCritical).toBe(true);
    expect(Math.abs(cResidual?.residualMolM2 ?? Infinity)).toBeLessThanOrEqual(CARBONATE_SPECIATION_DIC_TOLERANCE_MOL_PER_KG_SW * COLUMN_MASS);
  });

  it('baseline, не согласованный с инвентарём, отклоняется (сдвиг hco3_aq за пределом допуска)', () => {
    const shifted = BASELINE.concentrations.hco3MolPerKgSw * COLUMN_MASS + 1e-9;
    const core = makeIsolatedCore({ hco3_aq: shifted });
    const before = snapshotOf(core);
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-baseline-off'));
    expectNotApplied(result, 'baseline_inconsistent');
    if (result.status === 'not_applied') {
      expect(result.issues.join(' ')).toContain(String(CARBONATE_BASELINE_TOLERANCE_MOL_M2));
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('запись углеродного вида отсутствует в инвентаре: unknown не равен нулю (отказ)', () => {
    const core = makeIsolatedCore();
    const entries = core.reservoirs[0]!.material!.entries as Record<string, number>;
    delete entries.hco3_aq;
    const before = snapshotOf(core);
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-missing-entry'));
    expectNotApplied(result, 'baseline_inconsistent');
    if (result.status === 'not_applied') {
      expect(result.issues.join(' ')).toContain('hco3_aq');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('финальные запасы положительны; инвентарь растворителя h2o_aq НЕ меняется', () => {
    const core = makeIsolatedCore();
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-h2o-fixed'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const after = result.oceanReservoirAfter.material!.entries as Record<string, number>;
    expect(after.co2_aq).toBeCloseTo(0.001, 15);
    expect(after.hco3_aq).toBeCloseTo(0.0022, 15);
    expect(after.co3_aq).toBeCloseTo(0.0002, 15);
    expect(after.hplus_aq).toBeCloseTo(5e-5, 15);
    expect(after.oh_aq).toBeCloseTo(2e-4, 15);
    // h2o_aq — закреплённый растворитель: не в дельтах и не изменён.
    expect(result.deltas.some((d) => d.speciesId === 'h2o_aq')).toBe(false);
    expect(after.h2o_aq).toBe(9000);
    // состав/заряд каталога не подменялись исполнителем
    expect(catalog.has('co2_aq')).toBe(true);
  });

  it('co2 (газ) не смешивается с co2_aq: затронут только резервуар океана', () => {
    const core = makeIsolatedCore();
    const atmosphereBefore = core.reservoirs[1];
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-no-co2-mix'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    for (const d of result.deltas) {
      expect(['co2_aq', 'hco3_aq', 'co3_aq', 'hplus_aq', 'oh_aq']).toContain(d.speciesId);
    }
    // Ровно 4 ненулевых дельты фикстуры; газовой записи co2 в дельтах нет по построению типа.
    expect(result.deltas).toHaveLength(4);
    // Атмосфера разделена по ссылке: на неё не было ни одной дельты.
    expect(result.core.reservoirs[1]).toBe(atmosphereBefore);
    expect(result.core.reservoirs[1]!.material!.entries).toEqual(atmosphereBefore!.material!.entries);
  });

  it('зарядовый баланс закрывается ЯВНОЙ компенсацией фона (verdict balanced)', () => {
    const core = makeIsolatedCore();
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-charge-1'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // Модельный заряд сдвига фикстуры: 6.4e-7 mol/kg-SW × 1000 (synthetic test fixture).
    expect(result.chargeAudit.modeledChargeResidualMolM2).toBeCloseTo(6.4e-4, 15);
    expect(result.chargeAudit.verdict).toBe('balanced');
    expect(Math.abs(result.chargeAudit.totalResidualMolM2)).toBeLessThanOrEqual(CARBONATE_SPECIATION_CHARGE_TOLERANCE_MOL_PER_KG_SW * COLUMN_MASS);
  });

  it('без компенсации фона применять нельзя: заряд не доказан (fail-closed)', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const input: Record<string, unknown> = { ...makeInput('tx-no-comp') };
    delete input.strongIonChargeCompensationMolPerKgSw;
    const result = executeCarbonateSpeciationExecution(core, catalog, input as never);
    expectNotApplied(result, 'not_verifiable');
    if (result.status === 'not_applied') {
      expect(result.reason).toContain('электрон');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('компенсация без идентифицированного provenance отклоняется', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const comp: StrongIonChargeCompensation = {
      deltaStrongIonChargeMolPerKgSw: strongIonCompensationFor(BASELINE, TARGET).deltaStrongIonChargeMolPerKgSw,
      provenance: { note: 'фон не назван' } as never
    };
    const result = executeCarbonateSpeciationExecution(core, catalog, { ...makeInput('tx-comp-no-prov'), strongIonChargeCompensationMolPerKgSw: comp });
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
  });

  it('OH- доступна только с одной стороны: протонный перенос недостоверен, отказ', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const baseline = distribution({ oh: null });
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-oh-one-sided', baseline, { ...TARGET }));
    expectNotApplied(result, 'not_verifiable');
    expect(snapshotOf(core)).toBe(before);
  });
});

// ============================================
// 3. АТОМАРНОСТЬ
// ============================================

describe('Stage 4.9d speciation: атомарность транзакции', () => {
  it('успешное применение всех дельт одним набором: журнал дополнен ровно одной записью', () => {
    const core = makeIsolatedCore();
    const untouchedOcean = core.reservoirs[0];
    const untouchedCrust = core.reservoirs[2];
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-atomic-1'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.core.schemaVersion).toBe('1.6.0');
    expect(result.core.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-atomic-1']);
    expect(validateWorldState(result.core)).toEqual([]);
    // Вход нетронут; незатронутые резервуары разделяются по ссылке.
    expect(core.reservoirs[0]!.material!.entries).toEqual(untouchedOcean!.material!.entries);
    expect(result.core.reservoirs[2]).toBe(untouchedCrust);
    expect(result.core.reservoirs[0] === core.reservoirs[0]).toBe(false);
  });

  it('недостаточный инвентарь недостижим при согласованном baseline: изъятие ограничено запасом', () => {
    // Физически: |delta| = |target − baseline| × M < baseline × M = запас,
    // поэтому отрицательный финал невозможен, пока baseline согласован.
    // Проверяем свойство на почти полном изъятии hco3_aq (target → 0+).
    // co2Star компенсирует изъятие hco3: DIC остаётся 3.4e-6.
    const core = makeIsolatedCore();
    const target = distribution({ co2Star: 3.2e-6 - 1e-15, hco3: 1e-15, hydrogen: 1e-8, oh: 1e-6 });
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-near-empty', BASELINE, target));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const after = result.oceanReservoirAfter.material!.entries as Record<string, number>;
    expect(after.hco3_aq).toBeGreaterThan(0);
    expect(after.hco3_aq).toBeLessThan(1e-11);
  });

  it('отсутствующий резервуар океана: инвентарь не создаётся молча', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const result = executeCarbonateSpeciationExecution(core, catalog, { ...makeInput('tx-atlantis'), oceanReservoirId: 'atlantis' });
    expectNotApplied(result, 'not_executable');
    if (result.status === 'not_applied') {
      expect(result.reason).toContain('atlantis');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('stale snapshot: изменение ядра между планом и исполнением отклоняется', () => {
    const core = makeIsolatedCore();
    const input = makeInput('tx-stale-spec-1');
    const plan = planCarbonateSpeciationExecution(core, catalog, input);
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    // Внешняя мутация состояния между планом и исполнением.
    const entries = core.reservoirs[0]!.material!.entries as Record<string, number>;
    entries.hco3_aq = entries.hco3_aq! + 1e-9;
    const execution = executeCarbonateSpeciationExecutionOnWorld(core, catalog, input, plan);
    expectNotApplied(execution, 'stale_snapshot');
    // Повторный план на новой реальности строится честно (или честно блокируется) — без авто-применения устаревшего.
    const replan = planCarbonateSpeciationExecution(core, catalog, makeInput('tx-stale-spec-2'));
    expect(['ready', 'blocked']).toContain(replan.status);
  });

  it('duplicate transactionId: повторное применение отклонено, журнал не дублируется', () => {
    const core = makeIsolatedCore();
    const input = makeInput('tx-once-spec-1');
    const first = executeCarbonateSpeciationExecution(core, catalog, input);
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    const firstCore = first.core;
    const before = snapshotOf(firstCore);
    const second = executeCarbonateSpeciationExecution(firstCore, catalog, input);
    expectNotApplied(second, 'duplicate_transaction');
    expect(snapshotOf(firstCore)).toBe(before);
    expect(firstCore.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-once-spec-1']);
  });

  it('ошибка финальной валидации CoreWorldState откатывает применение (сломанные часы)', () => {
    const core = makeIsolatedCore();
    (core.clock as { segmentIndex: number }).segmentIndex = -1;
    const before = snapshotOf(core);
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-invalid-world'));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reason).toContain('validateWorldState');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('побитовая неизменность входа при КАЖДОМ отказе (батарея причин)', () => {
    const inputs: { label: string; build: () => CarbonateSpeciationExecutionInput }[] = [
      { label: 'zero-mass', build: () => ({ ...makeInput('tx-bat-zero'), seawaterColumnMassKgPerM2: columnMassFixture(0) }) },
      { label: 'bad-unit', build: () => ({ ...makeInput('tx-bat-unit'), seawaterColumnMassKgPerM2: { valueKgPerM2: 5, unit: 'pounds', provenance: COLUMN_MASS_PROVENANCE } as never }) },
      { label: 'no-comp', build: () => {
          const x: Record<string, unknown> = { ...makeInput('tx-bat-comp') };
          delete x.strongIonChargeCompensationMolPerKgSw;
          return x as never;
        } },
      { label: 'one-sided-oh', build: () => makeInput('tx-bat-oh', BASELINE, distribution({ co2Star: 1.0e-6, hco3: 2.2e-6, hydrogen: 5e-8, oh: null })) },
      { label: 'temp-shift', build: () => makeInput('tx-bat-temp', BASELINE, distribution({ co2Star: 1.0e-6, hco3: 2.2e-6, hydrogen: 5e-8, oh: 2e-7, temperatureK: 300 })) }
    ];
    for (const spec of inputs) {
      const core = makeIsolatedCore();
      const before = snapshotOf(core);
      const result = executeCarbonateSpeciationExecution(core, catalog, spec.build());
      expect(result.status, spec.label).toBe('not_applied');
      expect(snapshotOf(core), spec.label).toBe(before);
    }
  });
});

// ============================================
// 4. УСТОЙЧИВОСТЬ: SNAPSHOT, JSON, ДЕТЕРМИНИЗМ, МИГРАЦИИ
// ============================================

describe('Stage 4.9d speciation: снимок, JSON round-trip, детерминизм', () => {
  it('снимок транзакции отражает инвентарь океана, журналы и применённые id', () => {
    const core = makeIsolatedCore();
    const snapshot = captureSpeciationTransactionSnapshot(core, 'ocean');
    expect(snapshot.oceanReservoirId).toBe('ocean');
    expect(snapshot.reservoirCount).toBe(3);
    expect(snapshot.oceanBasis).toBe('column_amount');
    expect(snapshot.oceanEntries.hco3_aq).toBeCloseTo(0.002, 15);
    expect(snapshot.fluxLedgerSize).toBe(0);
    expect(snapshot.reactionLedgerSize).toBe(0);
    expect(snapshot.appliedTransactionIds).toEqual([]);
  });

  it('JSON round-trip применённого ядра: валидно, журнал сохранён, анти-replay жив', () => {
    const core = makeIsolatedCore();
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-json-spec-1'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const restored = JSON.parse(JSON.stringify(result.core)) as CoreWorldState;
    expect(restored).toEqual(result.core);
    expect(validateWorldState(restored)).toEqual([]);
    expect(restored.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-json-spec-1']);
    const replay = executeCarbonateSpeciationExecution(restored, catalog, makeInput('tx-json-spec-1'));
    expectNotApplied(replay, 'duplicate_transaction');
  });

  it('детерминизм: два одинаковых ядра и входа дают идентичные результаты', () => {
    const coreA = makeIsolatedCore();
    const coreB = makeIsolatedCore();
    const a = executeCarbonateSpeciationExecution(coreA, catalog, makeInput('tx-det-spec'));
    const b = executeCarbonateSpeciationExecution(coreB, catalog, makeInput('tx-det-spec'));
    expect(a.status).toBe('applied');
    expect(b.status).toBe('applied');
    if (a.status !== 'applied' || b.status !== 'applied') return;
    expect(JSON.stringify(a.core)).toBe(JSON.stringify(b.core));
    expect(a.elementResiduals).toEqual(b.elementResiduals);
    expect(a.chargeAudit).toEqual(b.chargeAudit);
  });

  it('планирование чистое: ядро не меняется, повторный план идентичен', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const input = makeInput('tx-pure-plan-spec');
    const plan1 = planCarbonateSpeciationExecution(core, catalog, input);
    const plan2 = planCarbonateSpeciationExecution(core, catalog, input);
    expect(plan1.status).toBe('ready');
    expect(plan2.status).toBe('ready');
    if (plan1.status !== 'ready' || plan2.status !== 'ready') return;
    expect(JSON.stringify(plan1.deltas)).toBe(JSON.stringify(plan2.deltas));
    expect(JSON.stringify(plan1.chargeAudit)).toBe(JSON.stringify(plan2.chargeAudit));
    expect(snapshotOf(core)).toBe(before);
  });

  it('повторное применение с новым transactionId: журнал растёт, сдвиги объединяются', () => {
    const core = makeIsolatedCore();
    const first = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-seq-1'));
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    // После первого применения инвентарь совпадает с TARGET × масса столба
    // (в пределах допуска согласования), поэтому TARGET — валидный baseline.
    const secondTarget = distribution({ co2Star: 0.8e-6, hco3: 2.4e-6, hydrogen: 6e-8, oh: 1.5e-7 });
    const second = executeCarbonateSpeciationExecution(first.core, catalog, makeInput('tx-seq-2', TARGET, secondTarget));
    expect(second.status).toBe('applied');
    if (second.status !== 'applied') return;
    expect(first.core.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-seq-1']);
    expect(second.core.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-seq-1', 'tx-seq-2']);
  });

  it('несовместимые условия: activity model, pH scale, T/S/P блокируют сдвиг', () => {
    const cases: { label: string; target: CarbonateSpeciationDistribution; kind: string }[] = [
      { label: 'activity', target: { ...TARGET, activityModel: 'pitzer' as never }, kind: 'out_of_applicability' },
      { label: 'ph-scale', target: { ...TARGET, phScale: 'total' }, kind: 'out_of_applicability' },
      { label: 'temperature', target: { ...TARGET, temperatureK: 300 }, kind: 'out_of_applicability' },
      { label: 'salinity', target: { ...TARGET, salinityPSU: 36 }, kind: 'out_of_applicability' },
      { label: 'pressure', target: { ...TARGET, pressurePa: 2e5 }, kind: 'out_of_applicability' },
      { label: 'nan-salinity', target: distribution({ co2Star: 1.0e-6, hco3: 2.2e-6, hydrogen: 5e-8, salinityPSU: Number.NaN }), kind: 'not_executable' }
    ];
    for (const spec of cases) {
      const core = makeIsolatedCore();
      const before = snapshotOf(core);
      const plan = planCarbonateSpeciationExecution(core, catalog, makeInput('tx-incompat-' + spec.label, BASELINE, spec.target));
      expect(plan.status, spec.label).toBe('blocked');
      if (plan.status === 'blocked') {
        expect(plan.reasonKind, spec.label).toBe(spec.kind);
      }
      expect(snapshotOf(core), spec.label).toBe(before);
    }
  });

  it('миграция и сериализация: 1.8 → 1.9 даёт ядро, исполняемое специацией; applied-ядро идемпотентно мигрирует', () => {
    const legacy = JSON.parse(JSON.stringify(makeIsolatedCore())) as CoreWorldState;
    legacy.schemaVersion = '1.5.0';
    delete (legacy as { geochemicalTransactionLog?: unknown }).geochemicalTransactionLog;
    const save = { version: '1.8', id: 'w-mig-spec', coreWorldState: legacy };
    const migrated = migrateSavedWorld(save as never) as { world: { version: string; coreWorldState: CoreWorldState }; notes: string[]; from: string; to: string };
    expect(migrated.to).toBe('1.9');
    expect(CURRENT_SAVE_SCHEMA_VERSION).toBe('1.9');
    // Мигрированное ядро исполняет специацию без изменений фикстур.
    const result = executeCarbonateSpeciationExecution(migrated.world.coreWorldState, catalog, makeInput('tx-after-migration'));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // Применённое ядро сериализуется и повторно мигрируется без изменений.
    const save19 = { version: CURRENT_SAVE_SCHEMA_VERSION, id: 'w-applied-spec', coreWorldState: JSON.parse(JSON.stringify(result.core)) };
    const again = migrateSavedWorld(save19 as never) as { world: { version: string; coreWorldState: CoreWorldState }; notes: string[]; to: string };
    expect(again.to).toBe('1.9');
    expect(again.notes).toEqual([]);
    expect(JSON.stringify(again.world.coreWorldState)).toBe(JSON.stringify(result.core));
  });

  it('нулевая дельта (target совпадает с baseline) не регистрирует пустую транзакцию', () => {
    const core = makeIsolatedCore();
    const before = snapshotOf(core);
    const result = executeCarbonateSpeciationExecution(core, catalog, makeInput('tx-noop', BASELINE, { ...BASELINE }));
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
  });
});
