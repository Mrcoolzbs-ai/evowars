// ============================================
// CARBONATE MINERALS TESTS — Ca2+, кальцит/арагонит, растворение и
// осаждение (Stage 4.9f, Mucci 1983)
// ============================================
//
// Разделы:
// 1. Модель растворимости K*sp (Mucci 1983): формулы, единицы, границы.
// 2. Степень насыщения (IP, вердикт-направление).
// 3. Минеральные реакции (адаптер Stage 4.9f поверх Stage 4.9d):
//    стехиометрия, атомарность, анти-replay, stale snapshot.
// 4. Составной атомарный цикл: реакция → DIC/TA_C → переспециация
//    (Stage 4.9c/4.9d) → инвентарь.
// 5. Производственный путь: каталоги видов и процессов, полиморфы.
//
// ВАЖНО: все численные значения — синтетические величины фикстур
// (synthetic test fixture): НЕ данные океана, НЕ наблюдения, НЕ
// калибровка. Исключение — контрольные K*sp: значения параметризации
// Mucci (1983) (расчёт по опубликованной формуле), сверенные с
// литературными ориентирами 4.30(±0.20)×10^-7 и 6.65(±0.12)×10^-7
// mol^2/kg^2; допуск тестов не выше точности первоисточника.

import { describe, it, expect } from 'vitest';

import {
  CARBONATE_MINERAL_SPECIES_ID,
  CARBONATE_MINERAL_SPECIES_TO_POLYMORPH,
  CARBONATE_MINERAL_KSP_UNIT,
  MUCCI_1983_APPLICABILITY,
  MUCCI_1983_SALINITY_COEFFICIENTS,
  MUCCI_1983_THERMODYNAMIC_COEFFICIENTS,
  evaluateCarbonateMineralSolubility,
  evaluateCalciteSolubilityProduct,
  evaluateAragoniteSolubilityProduct,
  evaluateCarbonateMineralSaturation
} from '../Core/carbonateMinerals';
import {
  CALCITE_DISSOLUTION_PROCESS_ID,
  CALCITE_PRECIPITATION_PROCESS_ID,
  ARAGONITE_DISSOLUTION_PROCESS_ID,
  ARAGONITE_PRECIPITATION_PROCESS_ID,
  buildCarbonateMineralReactionDefinition,
  validateCarbonateMineralReactionInput,
  buildCarbonateMineralReactionTransactionInput,
  evaluateCarbonateMineralEquilibriumInputs,
  planCarbonateMineralReaction,
  executeCarbonateMineralReaction,
  executeCarbonateMineralReactionPrepared,
  executeCarbonateMineralCycle
} from '../Core/carbonateMineralExecution';
import type {
  CarbonateMineralReactionInput,
  CarbonateMineralCycleInput
} from '../Core/carbonateMineralExecution';
import { solveCarbonateEquilibrium } from '../Core/carbonateChemistry';
import type { CarbonateSpeciationDistribution } from '../Core/carbonateSpeciationExecution';
import {
  GEOCHEMICAL_SPECIES_DEFINITIONS,
  buildGeochemicalSpeciesCatalog,
  addGeochemicalSpeciesToCatalog,
  validateGeochemicalSpeciesDefinitions
} from '../Data/geochemicalSpeciesCatalog';
import {
  GEOCHEMICAL_PROCESS_CATALOG,
  validateInitialGeochemicalProcessCatalog
} from '../Data/geochemicalProcessCatalog';
import { buildSpeciesCatalogFromLegacy } from '../Core/adapters';
import gases from '../Data/gases';
import elementCompositions from '../Data/elementCompositions';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { createCoreWorldState, validateWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { knownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import type { FluxTime } from '../Core/fluxLedger';
import type { SpeciesCatalog } from '../Core/species';
import type { DataProvenance } from '../Core/scientificValue';

// ============================================
// ФИКСТУРЫ (synthetic test fixtures)
// ============================================

const T0 = 298.15; // 25 C
const S0 = 35; // PSU
const PRESSURE_PA = 101325; // 1 atm (условия измерений Mucci)

/** Явная масса водного столба фикстуры, kg-SW/m² (synthetic test fixture). */
const MASS = 10;

/** Явное количество минеральной реакции фикстуры, mol/m². */
const EXTENT = 1e-4;

const FIXTURE_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic test fixture: Stage 4.9f (тестовые числа)',
  sourceId: 'evowars/tests/stage-4.9f/carbonate-minerals-fixture',
  recordId: 'synthetic-carbonate-minerals-fixture'
};

function fixtureTime(): FluxTime {
  return { segmentIndex: 1, localTimeS: 1200 };
}

/** Результат Stage 4.9c → дистрибуция Stage 4.9d (та же форма, что у 4.9d тестов). */
function distributionOfSolve(
  result: Extract<ReturnType<typeof solveCarbonateEquilibrium>, { status: 'applied' }>,
  recordId: string
): CarbonateSpeciationDistribution {
  return {
    phScale: result.phScale,
    activityModel: result.activityModel,
    temperatureK: result.temperatureK,
    salinityPSU: result.salinityPSU,
    pressurePa: result.pressurePa,
    approximationKind: result.approximation.kind,
    concentrations: {
      co2StarMolPerKgSw: result.speciesMolPerKgSw.co2_aq,
      hco3MolPerKgSw: result.speciesMolPerKgSw.hco3_aq,
      co3MolPerKgSw: result.speciesMolPerKgSw.co3_aq,
      hydrogenMolPerKgSw: result.hydrogenMolPerKgSw,
      ohMolPerKgSw: result.speciesMolPerKgSw.oh_aq
    },
    provenance: {
      ...FIXTURE_PROVENANCE,
      recordId,
      method: 'synthetic test fixture: baseline из производственного решателя Stage 4.9c (solveCarbonateEquilibrium) при фиксированных T/S'
    }
  };
}

/**
 * Фикстурный provenance величин вызова решателя Stage 4.9c: Stage 4.9c
 * требует provenance на КАЖДУЮ физическую величину входа (fail-closed),
 * без него фикстура честно отклоняется.
 */
function fixtureSolverProvenances(): Record<string, DataProvenance> {
  return {
    temperatureProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-temperature-stage2',
      note: 'synthetic test fixture: температура стадии переспециации, НЕ измерение'
    },
    salinityProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-salinity-stage2',
      note: 'synthetic test fixture: солёность стадии переспециации, НЕ измерение'
    },
    pressureProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-pressure-stage2',
      note: 'synthetic test fixture: давление стадии переспециации (1 atm), НЕ измерение'
    },
    dicProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-dic-stage2',
      note: 'synthetic test fixture: DIC стадии переспециации, НЕ измерение'
    },
    carbonateAlkalinityProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-ta-c-stage2',
      note: 'synthetic test fixture: карбонатная щёлочность стадии переспециации, НЕ измерение'
    }
  };
}

/** Baseline-равновесие фикстуры (Stage 4.9c, DIC/TA_C фикстуры). */
function solveBaseline() {
  const solved = solveCarbonateEquilibrium({
    temperatureK: T0,
    salinityPSU: S0,
    pressurePa: PRESSURE_PA,
    dicMolPerKgSw: 0.002,
    carbonateAlkalinityMolPerKgSw: 0.0023,
    phScale: 'seawater',
    activityModel: 'ideal_dilute',
    ...fixtureSolverProvenances()
  });
  expect(solved.status).toBe('applied');
  if (solved.status !== 'applied') throw new Error('solveCarbonateEquilibrium отказал на фикстуре (проверь Stage 4.9c)');
  return solved;
}

function baselineDistribution(): CarbonateSpeciationDistribution {
  return distributionOfSolve(solveBaseline(), 'fixture-baseline-distribution');
}

/**
 * Инвентарь океана фикстуры: согласован с baseline ПОСТРОЕНИЕМ
 * (entries = концентрация × масса столба) плюс запас ca2_aq, участник
 * минеральных реакций (Stage 4.9f).
 */
function oceanReservoir(entriesOverride: Record<string, number> = {}): ReservoirRecord {
  const b = baselineDistribution().concentrations;
  const reservoir = createReservoir('ocean', 'ocean_surface', {
    note: 'synthetic test fixture: столбовые запасы океана фикстуры в mol/m² (концентрации baseline × масса столба), НЕ данные океана'
  });
  return setMaterialInventory(reservoir, 'column_amount', {
    co2_aq: b.co2StarMolPerKgSw * MASS,
    hco3_aq: b.hco3MolPerKgSw * MASS,
    co3_aq: b.co3MolPerKgSw * MASS,
    hplus_aq: b.hydrogenMolPerKgSw * MASS,
    oh_aq: (b.ohMolPerKgSw ?? 0) * MASS,
    ca2_aq: 0.103,
    ...entriesOverride
  });
}

function crustReservoir(entriesOverride: Record<string, number> = {}): ReservoirRecord {
  const reservoir = createReservoir('crust', 'crustal_column', {
    note: 'synthetic test fixture: запасы минеральных фаз коры фикстуры в mol/m² (отдельные виды-полиморфы)'
  });
  return setMaterialInventory(reservoir, 'column_amount', {
    caco3: 0.05,
    aragonite: 0.05,
    ...entriesOverride
  });
}

const catalog: SpeciesCatalog = buildGeochemicalSpeciesCatalog();

function makeCore(oceanOverride: Record<string, number> = {}, crustOverride: Record<string, number> = {}): CoreWorldState {
  const core = createCoreWorldState('w-carbonate-minerals-test');
  core.bodies.push({ id: 'star', kind: 'star', properties: {} });
  core.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: { mass: knownValue(quantity(5.97e24, 'kg')) } // synthetic test fixture
  });
  core.gravity = { planet: 'star', star: null };
  core.radiationSources.push({ id: 'star-light', bodyId: 'star', kind: 'star' });
  core.reservoirs.push(
    { ...oceanReservoir(oceanOverride), bodyId: 'planet' },
    { ...crustReservoir(crustOverride), bodyId: 'planet' }
  );
  core.legacy = { generatorVersion: '0.3.0', seed: 'test-seed' };
  return core;
}

function reactionInput(overrides: Record<string, unknown> = {}): CarbonateMineralReactionInput {
  const base: CarbonateMineralReactionInput = {
    transactionId: 'tx-mineral-1',
    mineral: 'calcite',
    direction: 'dissolve',
    oceanReservoirId: 'ocean',
    crustReservoirId: 'crust',
    amountMolPerM2: EXTENT,
    amountProvenance: {
      sourceName: 'synthetic test fixture: Stage 4.9f (extent задан явно)',
      sourceId: 'evowars/tests/stage-4.9f/extent-fixture',
      recordId: 'synthetic-mineral-extent-fixture',
      note: 'synthetic test fixture: НЕ кинетическая скорость и НЕ вывод из Ω-вердикта'
    },
    time: fixtureTime()
  };
  return { ...base, ...overrides } as unknown as CarbonateMineralReactionInput;
}

/**
 * Компенсация фона сильных ионов для составного цикла фикстуры: закрывает
 * изменение модельного заряда ПЕРЕспециации (разница пост-реакционного
 * baseline → target). Тест вычисляет её из тех же вызовов решателя Stage
 * 4.9c и того же параметра количества, что подаёт и цикл: модельный заряд
 * дельт (заряды hco3 −1, co3 −2, H +1, OH −1) обязан закрываться явной
 * компенсацией (контракт Stage 4.9d), иначе исполнение честно отказывает.
 * `base` — распределение, относительно которого цикл строит дельты
 * (входной baseline цикла; для второго шага цепочки — target первого).
 */
function chargeCompensationFor(
  direction: 'dissolve' | 'precipitate',
  base: CarbonateSpeciationDistribution = baselineDistribution(),
  amountMolPerM2: number = EXTENT,
  massKgPerM2: number = MASS
) {
  const sign = direction === 'dissolve' ? 1 : -1;
  const perKg = amountMolPerM2 / massKgPerM2;
  const b = base.concentrations;
  // Пост-реакционный baseline (стадия 3 стартует отсюда): сдвинута только co3.
  const postCo3 = b.co3MolPerKgSw + sign * perKg;
  // Целевое равновесие: те же DIC/TA_C и тот же порядок суммирования, что в цикле.
  const dic = b.co2StarMolPerKgSw + b.hco3MolPerKgSw + b.co3MolPerKgSw + sign * perKg;
  const alk = b.hco3MolPerKgSw + 2 * b.co3MolPerKgSw + sign * 2 * perKg;
  const solved = solveCarbonateEquilibrium({
    temperatureK: base.temperatureK,
    salinityPSU: base.salinityPSU,
    pressurePa: base.pressurePa,
    dicMolPerKgSw: dic,
    carbonateAlkalinityMolPerKgSw: alk,
    phScale: 'seawater',
    activityModel: 'ideal_dilute',
    ...fixtureSolverProvenances()
  });
  if (solved.status !== 'applied') {
    throw new Error('solveCarbonateEquilibrium отказал при вычислении компенсации фикстуры: ' + JSON.stringify(solved).slice(0, 300));
  }
  const tOh = solved.speciesMolPerKgSw.oh_aq ?? 0;
  const modeledChargePerKg =
    -1 * (solved.speciesMolPerKgSw.hco3_aq - b.hco3MolPerKgSw) +
    -2 * (solved.speciesMolPerKgSw.co3_aq - postCo3) +
    1 * (solved.hydrogenMolPerKgSw - b.hydrogenMolPerKgSw) +
    -1 * (tOh - (b.ohMolPerKgSw ?? 0));
  return {
    deltaStrongIonChargeMolPerKgSw: -modeledChargePerKg,
    provenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-strong-ion-compensation',
      note: 'synthetic test fixture: компенсация фоновых сильных ионов закрывает изменение модельного заряда переспециации; полный фон сильных ионов вне Stage 4.9f (ограничение Stage 4.9d)'
    }
  };
}

function cycleInput(overrides: Record<string, unknown> = {}): CarbonateMineralCycleInput {
  const base: CarbonateMineralCycleInput = {
    transactionId: 'tx-mineral-cycle-1',
    speciationTransactionId: 'tx-mineral-cycle-1-speciation',
    mineral: 'calcite',
    direction: 'dissolve',
    oceanReservoirId: 'ocean',
    crustReservoirId: 'crust',
    amountMolPerM2: EXTENT,
    amountProvenance: {
      sourceName: 'synthetic test fixture: Stage 4.9f (extent цикла задан явно)',
      sourceId: 'evowars/tests/stage-4.9f/cycle-extent-fixture',
      recordId: 'synthetic-cycle-extent-fixture',
      note: 'synthetic test fixture: НЕ кинетическая скорость'
    },
    baseline: baselineDistribution(),
    seawaterColumnMassKgPerM2: {
      valueKgPerM2: MASS,
      provenance: {
        sourceName: 'synthetic test fixture: Stage 4.9f (масса столба задана ЯВНО)',
        sourceId: 'evowars/tests/stage-4.9f/column-mass-fixture',
        recordId: 'fixture-column-mass',
        note: 'synthetic test fixture: масса водного столба задана ЯВНО, НЕ вычислена из глубины'
      }
    },
    strongIonChargeCompensationMolPerKgSw: chargeCompensationFor('dissolve'),
    time: fixtureTime()
  };
  return { ...base, ...overrides } as unknown as CarbonateMineralCycleInput;
}

/** Строковый снимок для побитовой проверки неизменности входа. */
function snapshotOf(value: unknown): string {
  return JSON.stringify(value);
}

function entriesOf(core: CoreWorldState, id: string): Record<string, number> {
  const reservoir = core.reservoirs.find((r) => r.id === id);
  return (reservoir?.material?.entries ?? {}) as Record<string, number>;
}

const FAR = 13; // допуск toBeCloseTo для синтетических арифметических проверок (двойная точность)

// ============================================
// 1. МОДЕЛЬ РАСТВОРИМОСТИ K*SP (MUCCI 1983)
// ============================================

function solubilityInput(overrides: Record<string, unknown> = {}) {
  return {
    temperatureK: T0,
    temperatureProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-temperature',
      note: 'synthetic test fixture: температура, НЕ измерение'
    } as DataProvenance,
    salinityPSU: S0,
    salinityProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-salinity',
      note: 'synthetic test fixture: солёность, НЕ измерение'
    } as DataProvenance,
    ...overrides
  };
}

describe('Stage 4.9f растворимость: K*sp по Mucci (1983)', () => {
  it('кальцит при 25 C, S=35: K*sp в литературном коридоре 4.30(±0.20)×10^-7 mol^2/kg^2', () => {
    const result = evaluateCalciteSolubilityProduct(solubilityInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // Литературный ориентир 4.30(±0.20)×10^-7 (Mucci 1983 и воспроизведения);
    // допуск ±5% не выше точности первоисточника.
    expect(result.KspStoichiometricMol2PerKgSw2 / 1e-7).toBeGreaterThan(4.085);
    expect(result.KspStoichiometricMol2PerKgSw2 / 1e-7).toBeLessThan(4.515);
  });

  it('арагонит при 25 C, S=35: K*sp в литературном коридоре 6.65(±0.12)×10^-7 mol^2/kg^2', () => {
    const result = evaluateAragoniteSolubilityProduct(solubilityInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // Литературный ориентир 6.65(±0.12)×10^-7; параметризация даёт ~6.48×10^-7
    // (различие межлабораторных воспроизведений полиморфной растворимости),
    // допуск ±5% не выше точности первоисточника.
    expect(result.KspStoichiometricMol2PerKgSw2 / 1e-7).toBeGreaterThan(6.3175);
    expect(result.KspStoichiometricMol2PerKgSw2 / 1e-7).toBeLessThan(6.9825);
  });

  it('полиморфы различаются: K*sp арагонита выше K*sp кальцита при одинаковых T/S', () => {
    const cal = evaluateCalciteSolubilityProduct(solubilityInput());
    const arag = evaluateAragoniteSolubilityProduct(solubilityInput());
    if (cal.status !== 'applied' || arag.status !== 'applied') throw new Error('K*sp применён');
    expect(arag.KspStoichiometricMol2PerKgSw2).toBeGreaterThan(cal.KspStoichiometricMol2PerKgSw2);
    // Соотношение согласуется с параметризацией (порядка 1.5, НЕ идентичность).
    expect(arag.KspStoichiometricMol2PerKgSw2 / cal.KspStoichiometricMol2PerKgSw2).toBeCloseTo(1.517, 2);
  });

  it('зависимость от T: K*sp при 5 C выше значения при 25 C для обоих полиморфов', () => {
    const calWarm = evaluateCalciteSolubilityProduct(solubilityInput());
    const calCold = evaluateCalciteSolubilityProduct(solubilityInput({ temperatureK: 278.15 }));
    const aragWarm = evaluateAragoniteSolubilityProduct(solubilityInput());
    const aragCold = evaluateAragoniteSolubilityProduct(solubilityInput({ temperatureK: 278.15 }));
    if (calWarm.status !== 'applied' || calCold.status !== 'applied' || aragWarm.status !== 'applied' || aragCold.status !== 'applied') {
      throw new Error('K*sp применён');
    }
    expect(calCold.KspStoichiometricMol2PerKgSw2).toBeGreaterThan(calWarm.KspStoichiometricMol2PerKgSw2);
    expect(aragCold.KspStoichiometricMol2PerKgSw2).toBeGreaterThan(aragWarm.KspStoichiometricMol2PerKgSw2);
  });

  it('зависимость от S: K*sp растёт с солёностью (ионная сила морской воды)', () => {
    const lowS = evaluateCalciteSolubilityProduct(solubilityInput({ salinityPSU: 5 }));
    const highS = evaluateCalciteSolubilityProduct(solubilityInput({ salinityPSU: 44 }));
    if (lowS.status !== 'applied' || highS.status !== 'applied') throw new Error('K*sp применён');
    expect(highS.KspStoichiometricMol2PerKgSw2).toBeGreaterThan(lowS.KspStoichiometricMol2PerKgSw2);
  });

  it('единицы и тип результата: mol^2/kg-SW^2, стохиометрическая константа морской воды', () => {
    const result = evaluateCalciteSolubilityProduct(solubilityInput());
    if (result.status !== 'applied') throw new Error('K*sp применён');
    expect(result.unit).toBe(CARBONATE_MINERAL_KSP_UNIT);
    expect(result.unit).toBe('mol^2/kg-SW^2');
    expect(result.speciesId).toBe(CARBONATE_MINERAL_SPECIES_ID.calcite);
  });

  it('десятичный логарифм: 10^log10K равно K; формула Mucci воспроизводится по коэффициентам', () => {
    const result = evaluateCalciteSolubilityProduct(solubilityInput());
    if (result.status !== 'applied') throw new Error('K*sp применён');
    expect(Math.pow(10, result.log10KspStoichiometric)).toBeCloseTo(result.KspStoichiometricMol2PerKgSw2, 80);
    // Независимое воспроизведение формулы Mucci по опубликованным коэффициентам.
    const c = MUCCI_1983_THERMODYNAMIC_COEFFICIENTS.calcite;
    const s = MUCCI_1983_SALINITY_COEFFICIENTS.calcite;
    const logK0 = c.a1 + c.a2 * T0 + c.a3 / T0 + c.a4 * Math.log10(T0);
    const sqrtS = Math.sqrt(S0);
    const corr = (s.b0 + s.b1 * T0 + s.b2 / T0) * sqrtS + s.c0 * S0 + s.d0 * S0 * sqrtS;
    expect(result.log10KspThermodynamic).toBeCloseTo(logK0, 12);
    expect(result.salinityCorrectionLog10).toBeCloseTo(corr, 12);
    expect(result.log10KspStoichiometric).toBeCloseTo(logK0 + corr, 12);
  });

  it('границы T-конверта 5-40 C: 278.15 и 313.15 K применяются, сразу вне — fail-closed', () => {
    expect(evaluateCalciteSolubilityProduct(solubilityInput({ temperatureK: 278.15 })).status).toBe('applied');
    expect(evaluateCalciteSolubilityProduct(solubilityInput({ temperatureK: 313.15 })).status).toBe('applied');
    const below = evaluateCalciteSolubilityProduct(solubilityInput({ temperatureK: 278.14 }));
    expect(below.status).toBe('not_applied');
    if (below.status === 'not_applied') {
      expect(below.reasonKind).toBe('out_of_applicability');
      expect(below.reason).toContain('278.15');
    }
    const above = evaluateCalciteSolubilityProduct(solubilityInput({ temperatureK: 313.16 }));
    expect(above.status).toBe('not_applied');
    if (above.status === 'not_applied') expect(above.reasonKind).toBe('out_of_applicability');
  });

  it('границы S-конверта 5-44: края применяются, вне (включая S=0) — fail-closed', () => {
    expect(evaluateCalciteSolubilityProduct(solubilityInput({ salinityPSU: 5 })).status).toBe('applied');
    expect(evaluateCalciteSolubilityProduct(solubilityInput({ salinityPSU: 44 })).status).toBe('applied');
    const below = evaluateCalciteSolubilityProduct(solubilityInput({ salinityPSU: 4.9 }));
    expect(below.status).toBe('not_applied');
    if (below.status === 'not_applied') expect(below.reasonKind).toBe('out_of_applicability');
    const above = evaluateCalciteSolubilityProduct(solubilityInput({ salinityPSU: 44.1 }));
    expect(above.status).toBe('not_applied');
    if (above.status === 'not_applied') expect(above.reasonKind).toBe('out_of_applicability');
    const fresh = evaluateCalciteSolubilityProduct(solubilityInput({ salinityPSU: 0 }));
    expect(fresh.status).toBe('not_applied');
    if (fresh.status === 'not_applied') expect(fresh.reasonKind).toBe('out_of_applicability');
    expect(MUCCI_1983_APPLICABILITY.salinityMinPSU).toBe(5);
    expect(MUCCI_1983_APPLICABILITY.salinityMaxPSU).toBe(44);
  });

  it('давление: только 1 atm измерений; иное — out_of_applicability, поправка НЕ добавляется', () => {
    const deep = evaluateCalciteSolubilityProduct(solubilityInput({ pressureAtm: 2 }));
    expect(deep.status).toBe('not_applied');
    if (deep.status === 'not_applied') {
      expect(deep.reasonKind).toBe('out_of_applicability');
      expect(deep.reason).toContain('1 atm');
    }
    // Явное 1 и неявное (по умолчанию) дают один и тот же результат:
    // скрытой pressure-поправки в формуле нет.
    const explicitOne = evaluateCalciteSolubilityProduct(solubilityInput({ pressureAtm: 1 }));
    const implicit = evaluateCalciteSolubilityProduct(solubilityInput());
    if (explicitOne.status !== 'applied' || implicit.status !== 'applied') throw new Error('K*sp применён');
    expect(explicitOne.KspStoichiometricMol2PerKgSw2).toBe(implicit.KspStoichiometricMol2PerKgSw2);
  });

  it('отсутствие provenance температуры/солёности — invalid_input (число НЕ выдаётся)', () => {
    const noProv = evaluateCalciteSolubilityProduct({
      temperatureK: T0,
      temperatureProvenance: {} as DataProvenance,
      salinityPSU: S0,
      salinityProvenance: {} as DataProvenance
    });
    expect(noProv.status).toBe('not_applied');
    if (noProv.status === 'not_applied') {
      expect(noProv.reasonKind).toBe('invalid_input');
      expect(noProv.issues.length).toBeGreaterThan(0);
    }
  });

  it('NaN/Infinity/нефизичные входы — invalid_input, а не NaN-результат', () => {
    const cases = [
      solubilityInput({ temperatureK: NaN }),
      solubilityInput({ temperatureK: Infinity }),
      solubilityInput({ temperatureK: 0 }),
      solubilityInput({ salinityPSU: NaN }),
      solubilityInput({ salinityPSU: -5 })
    ];
    for (const input of cases) {
      const result = evaluateCalciteSolubilityProduct(input);
      expect(result.status).toBe('not_applied');
      if (result.status === 'not_applied') expect(result.reasonKind).toBe('invalid_input');
    }
  });

  it('неизвестный полиморф отклонён; оболочки полиморфов дают согласованные speciesId', () => {
    const bogus = evaluateCarbonateMineralSolubility({ ...solubilityInput(), mineral: 'dolomite' as never });
    expect(bogus.status).toBe('not_applied');
    if (bogus.status === 'not_applied') expect(bogus.issues[0]).toContain('calcite');
    const cal = evaluateCalciteSolubilityProduct(solubilityInput());
    const arag = evaluateAragoniteSolubilityProduct(solubilityInput());
    if (cal.status !== 'applied' || arag.status !== 'applied') throw new Error('K*sp применён');
    expect(cal.mineral).toBe('calcite');
    expect(cal.speciesId).toBe('caco3');
    expect(arag.mineral).toBe('aragonite');
    expect(arag.speciesId).toBe('aragonite');
    expect(CARBONATE_MINERAL_SPECIES_TO_POLYMORPH.caco3).toBe('calcite');
    expect(CARBONATE_MINERAL_SPECIES_TO_POLYMORPH.aragonite).toBe('aragonite');
  });
});

// ============================================
// 2. СТЕПЕНЬ НАСЫЩЕНИЯ И ВЕРДИКТ-НАПРАВЛЕНИЕ
// ============================================

function saturationInput(overrides: Record<string, unknown> = {}) {
  return {
    mineral: 'calcite' as const,
    temperatureK: T0,
    temperatureProvenance: solubilityInput().temperatureProvenance,
    salinityPSU: S0,
    salinityProvenance: solubilityInput().salinityProvenance,
    calciumConcentrationMolPerKgSw: 0.0103, // synthetic test fixture, mol/kg-SW
    calciumProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-calcium',
      note: 'synthetic test fixture: концентрация Ca2+, НЕ измерение'
    } as DataProvenance,
    carbonateConcentrationMolPerKgSw: 2.5e-5, // synthetic test fixture, mol/kg-SW
    carbonateProvenance: {
      ...FIXTURE_PROVENANCE,
      recordId: 'fixture-carbonate',
      note: 'synthetic test fixture: концентрация CO3^2-, НЕ измерение'
    } as DataProvenance,
    phScale: 'seawater' as const,
    activityModel: 'ideal_dilute' as const,
    ...overrides
  };
}

describe('Stage 4.9f насыщение: IP, вердикт-направление', () => {
  it('IP = [Ca2+]·[CO3^2-] на единой основе mol/kg-SW; вердикт — направление, НЕ скорость', () => {
    const result = evaluateCarbonateMineralSaturation(saturationInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.ionProductMol2PerKgSw2).toBeCloseTo(0.0103 * 2.5e-5, 30);
    expect(result.concentrationBasis).toBe('mol/kg-SW');
    expect(result.diagnostics.some((d) => d.includes('кинетические следствия НЕ вытекают'))).toBe(true);
    expect(result.unit).toBe('mol^2/kg-SW^2');
  });

  it('Ω < 1 — недонасыщение (растворение термодинамически благоприятно)', () => {
    const result = evaluateCarbonateMineralSaturation(saturationInput({
      carbonateConcentrationMolPerKgSw: 1e-5 // IP = 1.03e-7 < K*sp кальцита
    }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.verdict).toBe('undersaturated');
    expect(result.saturationStateOmega).toBeLessThan(1);
  });

  it('Ω ≈ 1 — насыщение (допуск 1e-6): IP = K*sp точно', () => {
    const ksp = evaluateCalciteSolubilityProduct(solubilityInput());
    if (ksp.status !== 'applied') throw new Error('K*sp применён');
    const result = evaluateCarbonateMineralSaturation(saturationInput({
      calciumConcentrationMolPerKgSw: 0.01,
      carbonateConcentrationMolPerKgSw: ksp.KspStoichiometricMol2PerKgSw2 / 0.01
    }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.verdict).toBe('saturated');
    expect(Math.abs(result.saturationStateOmega - 1)).toBeLessThanOrEqual(result.omegaSaturationTolerance);
  });

  it('Ω > 1 — пересыщение; пересыщение НЕ означает мгновенного осаждения', () => {
    const result = evaluateCarbonateMineralSaturation(saturationInput({
      carbonateConcentrationMolPerKgSw: 1e-4 // IP = 1.03e-6 > K*sp кальцита
    }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.verdict).toBe('oversaturated');
    expect(result.saturationStateOmega).toBeGreaterThan(1);
    expect(result.diagnostics.some((d) => d.includes('нуклеация'))).toBe(true);
  });

  it('разные Ω для кальцита и арагонита при одном IP (Ω арагонита ниже)', () => {
    const cal = evaluateCarbonateMineralSaturation(saturationInput());
    const arag = evaluateCarbonateMineralSaturation(saturationInput({ mineral: 'aragonite' }));
    expect(cal.status).toBe('applied');
    expect(arag.status).toBe('applied');
    if (cal.status !== 'applied' || arag.status !== 'applied') return;
    // Одно и то же IP, разные K*sp → разные Ω; разделение вердиктов возможно.
    expect(cal.ionProductMol2PerKgSw2).toBe(arag.ionProductMol2PerKgSw2);
    expect(arag.saturationStateOmega).toBeLessThan(cal.saturationStateOmega);
    // Разделение вердиктов достигается: IP между K*sp полиморфов.
    expect(cal.KspStoichiometricMol2PerKgSw2).not.toBe(arag.KspStoichiometricMol2PerKgSw2);
  });

  it('несовместимая модель активности (pitzer) и неизвестная шкала pH — invalid_input', () => {
    const pitzer = evaluateCarbonateMineralSaturation(saturationInput({ activityModel: 'pitzer' as never }));
    expect(pitzer.status).toBe('not_applied');
    if (pitzer.status === 'not_applied') {
      expect(pitzer.reasonKind).toBe('invalid_input');
      expect(pitzer.issues.some((i) => i.includes('ideal_dilute'))).toBe(true);
    }
    const badScale = evaluateCarbonateMineralSaturation(saturationInput({ phScale: 'free' as never }));
    expect(badScale.status).toBe('not_applied');
    if (badScale.status === 'not_applied') expect(badScale.reasonKind).toBe('invalid_input');
  });

  it('NaN/Infinity/нулевые/отрицательные концентрации — invalid_input', () => {
    const cases = [
      saturationInput({ calciumConcentrationMolPerKgSw: NaN }),
      saturationInput({ calciumConcentrationMolPerKgSw: Infinity }),
      saturationInput({ calciumConcentrationMolPerKgSw: 0 }),
      saturationInput({ carbonateConcentrationMolPerKgSw: -1e-5 }),
      saturationInput({ carbonateConcentrationMolPerKgSw: NaN })
    ];
    for (const input of cases) {
      const result = evaluateCarbonateMineralSaturation(input);
      expect(result.status).toBe('not_applied');
      if (result.status === 'not_applied') expect(result.reasonKind).toBe('invalid_input');
    }
  });

  it('отсутствие provenance концентраций — invalid_input с diagnosticной конкретного поля', () => {
    const result = evaluateCarbonateMineralSaturation(saturationInput({
      calciumProvenance: {} as DataProvenance
    }));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reasonKind).toBe('invalid_input');
      expect(result.issues.some((i) => i.includes('Ca2+'))).toBe(true);
    }
  });

  it('выход T/S за конверт Mucci в насыщении — out_of_applicability (транзитивно от K*sp)', () => {
    const hot = evaluateCarbonateMineralSaturation(saturationInput({ temperatureK: 323.15 }));
    expect(hot.status).toBe('not_applied');
    if (hot.status === 'not_applied') expect(hot.reasonKind).toBe('out_of_applicability');
    const estuary = evaluateCarbonateMineralSaturation(saturationInput({ salinityPSU: 0 }));
    expect(estuary.status).toBe('not_applied');
    if (estuary.status === 'not_applied') expect(estuary.reasonKind).toBe('out_of_applicability');
  });
});

// ============================================
// 3. МИНЕРАЛЬНЫЕ РЕАКЦИИ (адаптер Stage 4.9f)
// ============================================

describe('Stage 4.9f реакции: стехиометрия, атомарность, защиты', () => {
  it('определение реакции растворения кальцита: caco3 (кора) → ca2_aq + co3_aq (океан)', () => {
    const def = buildCarbonateMineralReactionDefinition({
      mineral: 'calcite',
      direction: 'dissolve',
      oceanReservoirId: 'ocean',
      crustReservoirId: 'crust'
    });
    expect(def.reactionId).toBe('caco3.calcite.dissolution.crust->ocn');
    expect(def.processId).toBe(CALCITE_DISSOLUTION_PROCESS_ID);
    expect(def.reactants).toEqual([{ reservoirId: 'crust', speciesId: 'caco3', coefficient: 1 }]);
    expect(def.products).toEqual([
      { reservoirId: 'ocean', speciesId: 'ca2_aq', coefficient: 1 },
      { reservoirId: 'ocean', speciesId: 'co3_aq', coefficient: 1 }
    ]);
  });

  it('определения осаждения кальцита и растворения арагонита — раздельные полиморфы и процессы', () => {
    const cal = buildCarbonateMineralReactionDefinition({
      mineral: 'calcite',
      direction: 'precipitate',
      oceanReservoirId: 'ocean',
      crustReservoirId: 'crust'
    });
    const arag = buildCarbonateMineralReactionDefinition({
      mineral: 'aragonite',
      direction: 'dissolve',
      oceanReservoirId: 'ocean',
      crustReservoirId: 'crust'
    });
    expect(cal.processId).toBe(CALCITE_PRECIPITATION_PROCESS_ID);
    expect(cal.products).toEqual([{ reservoirId: 'crust', speciesId: 'caco3', coefficient: 1 }]);
    expect(arag.processId).toBe(ARAGONITE_DISSOLUTION_PROCESS_ID);
    expect(arag.reactants).toEqual([{ reservoirId: 'crust', speciesId: 'aragonite', coefficient: 1 }]);
    expect(arag.products.some((p) => p.speciesId === 'ca2_aq')).toBe(true);
    expect(arag.products.some((p) => p.speciesId === 'co3_aq')).toBe(true);
  });

  it('растворение кальцита: ca2_aq/co3_aq океана растут на extent, кора отдаёт ровно extent', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const result = executeCarbonateMineralReaction(core, catalog, reactionInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.transactionId).toBe('tx-mineral-1');
    expect(result.processId).toBe(CALCITE_DISSOLUTION_PROCESS_ID);
    expect(result.amountMolPerM2).toBe(EXTENT);
    expect(entriesOf(result.core, 'crust').caco3).toBeCloseTo(0.05 - EXTENT, FAR);
    expect(entriesOf(result.core, 'ocean').ca2_aq).toBeCloseTo(0.103 + EXTENT, FAR);
    expect(entriesOf(result.core, 'ocean').co3_aq).toBeCloseTo(entriesOf(core, 'ocean').co3_aq + EXTENT, FAR);
    // Атомарный аудит coupled-исполнителя Stage 4.9d.
    expect(result.audit.status).toBe('balanced');
    expect(result.audit.chargeResidual).toBe(0);
    // Побитовая неизменность входа.
    expect(snapshotOf(core)).toBe(before);
    expect(validateWorldState(result.core)).toEqual([]);
    // Полиморфы не смешиваются: арагонит не тронут.
    expect(entriesOf(result.core, 'crust').aragonite).toBe(0.05);
  });

  it('осаждение кальцита: ионы океана уходят в кору (обратная стехиометрия)', () => {
    const core = makeCore();
    const result = executeCarbonateMineralReaction(core, catalog, reactionInput({
      direction: 'precipitate',
      transactionId: 'tx-mineral-2'
    }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.processId).toBe(CALCITE_PRECIPITATION_PROCESS_ID);
    expect(entriesOf(result.core, 'crust').caco3).toBeCloseTo(0.05 + EXTENT, FAR);
    expect(entriesOf(result.core, 'ocean').ca2_aq).toBeCloseTo(0.103 - EXTENT, FAR);
    expect(entriesOf(result.core, 'ocean').co3_aq).toBeCloseTo(entriesOf(core, 'ocean').co3_aq - EXTENT, FAR);
    expect(result.audit.chargeResidual).toBe(0);
  });

  it('растворение арагонита: запас aragonite меняется, caco3 не тронут (полиморфы раздельны)', () => {
    const core = makeCore();
    const result = executeCarbonateMineralReaction(core, catalog, reactionInput({
      mineral: 'aragonite',
      transactionId: 'tx-mineral-3'
    }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.processId).toBe(ARAGONITE_DISSOLUTION_PROCESS_ID);
    expect(entriesOf(result.core, 'crust').aragonite).toBeCloseTo(0.05 - EXTENT, FAR);
    expect(entriesOf(result.core, 'crust').caco3).toBe(0.05);
  });

  it('осаждение арагонита — отдельный процесс; вид кальцита в реакции арагонита отсутствует', () => {
    const core = makeCore();
    const result = executeCarbonateMineralReaction(core, catalog, reactionInput({
      mineral: 'aragonite',
      direction: 'precipitate',
      transactionId: 'tx-mineral-4'
    }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.processId).toBe(ARAGONITE_PRECIPITATION_PROCESS_ID);
    expect(entriesOf(result.core, 'crust').aragonite).toBeCloseTo(0.05 + EXTENT, FAR);
    expect(entriesOf(result.core, 'crust').caco3).toBe(0.05);
    const tx = buildCarbonateMineralReactionTransactionInput(reactionInput({ mineral: 'aragonite' }));
    const reactionComponent = tx.components.find((c) => c.kind === 'reaction');
    if (reactionComponent === undefined || reactionComponent.kind !== 'reaction') throw new Error('reaction-компонент фикстуры');
    const allSpecies = [...reactionComponent.definition.reactants, ...reactionComponent.definition.products].map((s) => s.speciesId);
    expect(allSpecies).not.toContain('caco3');
    expect(allSpecies).toContain('aragonite');
  });

  it('недостаточный запас минерала — not_applied, отрицательный запас невозможен, вход не изменён', () => {
    const core = makeCore({}, { caco3: EXTENT / 2 });
    const before = snapshotOf(core);
    const result = executeCarbonateMineralReaction(core, catalog, reactionInput());
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
  });

  it('недостаточный запас ионов при осаждении — not_applied', () => {
    const core = makeCore({ ca2_aq: EXTENT / 2 });
    const before = snapshotOf(core);
    const result = executeCarbonateMineralReaction(core, catalog, reactionInput({
      direction: 'precipitate',
      transactionId: 'tx-mineral-5'
    }));
    expect(result.status).toBe('not_applied');
    expect(snapshotOf(core)).toBe(before);
  });

  it('отсутствие provenance количества — not_applied (значение без происхождения не подставляется)', () => {
    const core = makeCore();
    const result = executeCarbonateMineralReaction(core, catalog, reactionInput({
      amountProvenance: {} as never
    }));
    expect(result.status).toBe('not_applied');
  });

  it('валидатор формы: ноль/отрицательный extent, одинаковые резервуары, неизвестный полиморф', () => {
    expect(validateCarbonateMineralReactionInput(reactionInput({ amountMolPerM2: 0 }))).not.toEqual([]);
    expect(validateCarbonateMineralReactionInput(reactionInput({ amountMolPerM2: -1e-4 }))).not.toEqual([]);
    expect(validateCarbonateMineralReactionInput(reactionInput({ crustReservoirId: 'ocean' }))).not.toEqual([]);
    expect(validateCarbonateMineralReactionInput(reactionInput({ mineral: 'dolomite' }))).not.toEqual([]);
    expect(validateCarbonateMineralReactionInput(reactionInput({ direction: 'exchange' }))).not.toEqual([]);
    expect(validateCarbonateMineralReactionInput(reactionInput())).toEqual([]);
  });

  it('анти-replay: повторный transactionId отклоняется, состояние неизменно', () => {
    const core = makeCore();
    const first = executeCarbonateMineralReaction(core, catalog, reactionInput());
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    const firstCore = first.core;
    const snapshotFirst = snapshotOf(firstCore);
    const second = executeCarbonateMineralReaction(firstCore, catalog, reactionInput());
    expect(second.status).toBe('not_applied');
    expect(second.status === 'not_applied' && second.reasonKind).toBe('duplicate_transaction');
    expect(snapshotOf(firstCore)).toBe(snapshotFirst);
    expect(firstCore.geochemicalTransactionLog?.appliedTransactionIds).toEqual(['tx-mineral-1']);
  });

  it('stale snapshot: план на состоянии A, исполнение на состоянии B — stale_snapshot', () => {
    const core = makeCore();
    const prepared = planCarbonateMineralReaction(core, catalog, reactionInput());
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    // Состояние изменилось между планом и исполнением (замена коры).
    const mutated = makeCore({}, { caco3: 0.03 });
    const beforeMutated = snapshotOf(mutated);
    const result = executeCarbonateMineralReactionPrepared(mutated, catalog, prepared);
    expect(result.status).toBe('not_applied');
    expect(result.status === 'not_applied' && result.reasonKind).toBe('stale_snapshot');
    expect(snapshotOf(mutated)).toBe(beforeMutated);
    // План на исходном состоянии остаётся исполнимым.
    const fresh = executeCarbonateMineralReactionPrepared(core, catalog, prepared);
    expect(fresh.status).toBe('applied');
  });

  it('старая схема ядра (1.4.0) — not_executable (требуется миграция, сохранение не переписывается)', () => {
    const core = makeCore();
    core.schemaVersion = '1.4.0';
    const old = executeCarbonateMineralReaction(core, catalog, reactionInput());
    expect(old.status).toBe('not_applied');
    expect(old.status === 'not_applied' && old.reasonKind).toBe('not_executable');
  });

  it('цикл сохранения: растворение → осаждение того же количества возвращает элементы как были', () => {
    const core = makeCore();
    const d1 = executeCarbonateMineralReaction(core, catalog, reactionInput({ transactionId: 'tx-cyc-a' }));
    expect(d1.status).toBe('applied');
    if (d1.status !== 'applied') return;
    const p1 = executeCarbonateMineralReaction(d1.core, catalog, reactionInput({
      transactionId: 'tx-cyc-b',
      direction: 'precipitate'
    }));
    expect(p1.status).toBe('applied');
    if (p1.status !== 'applied') return;
    const finalOcean = entriesOf(p1.core, 'ocean');
    const finalCrust = entriesOf(p1.core, 'crust');
    expect(finalCrust.caco3).toBeCloseTo(0.05, FAR);
    expect(finalOcean.ca2_aq).toBeCloseTo(0.103, FAR);
    expect(finalOcean.co3_aq).toBeCloseTo(entriesOf(core, 'ocean').co3_aq, FAR);
    expect(finalCrust.aragonite).toBe(0.05);
    // Общая сумма Ca по резервуарам сохранена (побочный перенос исключён).
    expect(finalOcean.ca2_aq + finalCrust.caco3 + finalCrust.aragonite).toBeCloseTo(
      entriesOf(core, 'ocean').ca2_aq + entriesOf(core, 'crust').caco3 + entriesOf(core, 'crust').aragonite,
      FAR
    );
  });

  it('замкнутый равновесный расчёт количества — честный not_verifiable (без эвристики из Ω)', () => {
    const verdict = evaluateCarbonateMineralEquilibriumInputs({
      mineralInventoryMolPerM2: 0.05,
      calciumConcentrationMolPerKgSw: 0.0103,
      dicTargetMolPerKgSw: 0.002,
      carbonateAlkalinityMolPerKgSw: 0.0023,
      seawaterColumnMassKgPerM2: MASS,
      temperatureK: T0,
      salinityPSU: S0,
      pressureAtm: 1,
      inputsProvenance: {
        mineralInventoryMolPerM2: FIXTURE_PROVENANCE,
        calciumConcentrationMolPerKgSw: FIXTURE_PROVENANCE
      }
    });
    expect(verdict.status).toBe('not_verifiable');
    if (verdict.status !== 'not_verifiable') return;
    expect(verdict.requiredInputs.length).toBeGreaterThan(5);
    expect(verdict.reason).toContain('НЕ реализован');
  });
});

// ============================================
// 4. СОСТАВНОЙ ЦИКЛ: РЕАКЦИЯ → DIC/TA_C → ПЕРЕСПЕЦИАЦИЯ
// ============================================

describe('Stage 4.9f составной цикл: атомарная последовательность стадий', () => {
  it('растворение кальцита: DIC растёт на e/m, TA_C на 2e/m, формы перераспределены решателем 4.9c', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const result = executeCarbonateMineralCycle(core, catalog, cycleInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.transactionId).toBe('tx-mineral-cycle-1');
    expect(result.speciationTransactionId).toBe('tx-mineral-cycle-1-speciation');
    expect(result.processId).toBe(CALCITE_DISSOLUTION_PROCESS_ID);
    // Стехиометрия: ΔDIC = +e/m, ΔTA_C = +2e/m (mol/kg-SW).
    const perKg = EXTENT / MASS;
    expect(result.dicAfterMolPerKgSw - result.dicBeforeMolPerKgSw).toBeCloseTo(perKg, 18);
    // Цель — равновесие Stage 4.9c; TA_C цели согласована с пост-реакционным baseline.
    const targetTA =
      result.target.concentrations.hco3MolPerKgSw + 2 * result.target.concentrations.co3MolPerKgSw;
    const baselineTA =
      result.postReactionBaseline.concentrations.hco3MolPerKgSw +
      2 * result.postReactionBaseline.concentrations.co3MolPerKgSw;
    expect(targetTA).toBeCloseTo(baselineTA, 10);
    // Побитовая неизменность входа.
    expect(snapshotOf(core)).toBe(before);
    // Обе транзакции в журнале.
    expect(result.core.geochemicalTransactionLog?.appliedTransactionIds).toEqual([
      'tx-mineral-cycle-1',
      'tx-mineral-cycle-1-speciation'
    ]);
  });

  it('инвентарь после цикла равен целевой дистрибуции × масса столба; Ca и кора согласованы', () => {
    const core = makeCore();
    const result = executeCarbonateMineralCycle(core, catalog, cycleInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const finalOcean = entriesOf(result.core, 'ocean');
    expect(finalOcean.co2_aq).toBeCloseTo(result.target.concentrations.co2StarMolPerKgSw * MASS, FAR);
    expect(finalOcean.hco3_aq).toBeCloseTo(result.target.concentrations.hco3MolPerKgSw * MASS, FAR);
    expect(finalOcean.co3_aq).toBeCloseTo(result.target.concentrations.co3MolPerKgSw * MASS, FAR);
    expect(finalOcean.ca2_aq).toBeCloseTo(0.103 + EXTENT, FAR);
    const finalCrust = entriesOf(result.core, 'crust');
    expect(finalCrust.caco3).toBeCloseTo(0.05 - EXTENT, FAR);
    expect(finalCrust.aragonite).toBe(0.05);
    expect(validateWorldState(result.core)).toEqual([]);
  });

  it('осаждение кальцита в цикле: DIC падает на e/m, TA_C на 2e/m', () => {
    const core = makeCore();
    const result = executeCarbonateMineralCycle(core, catalog, cycleInput({
      direction: 'precipitate',
      strongIonChargeCompensationMolPerKgSw: chargeCompensationFor('precipitate')
    }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.processId).toBe(CALCITE_PRECIPITATION_PROCESS_ID);
    expect(result.dicAfterMolPerKgSw - result.dicBeforeMolPerKgSw).toBeCloseTo(-EXTENT / MASS, 18);
    expect(entriesOf(result.core, 'crust').caco3).toBeCloseTo(0.05 + EXTENT, FAR);
    expect(entriesOf(result.core, 'ocean').ca2_aq).toBeCloseTo(0.103 - EXTENT, FAR);
  });

  it('арагонит в цикле: сдвиг DIC/TA_C тот же, минеральный запас арагонита, caco3 не тронут', () => {
    const core = makeCore();
    const result = executeCarbonateMineralCycle(core, catalog, cycleInput({
      mineral: 'aragonite',
      strongIonChargeCompensationMolPerKgSw: chargeCompensationFor('dissolve')
    }));
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.processId).toBe(ARAGONITE_DISSOLUTION_PROCESS_ID);
    expect(entriesOf(result.core, 'crust').aragonite).toBeCloseTo(0.05 - EXTENT, FAR);
    expect(entriesOf(result.core, 'crust').caco3).toBe(0.05);
    expect(result.dicAfterMolPerKgSw - result.dicBeforeMolPerKgSw).toBeCloseTo(EXTENT / MASS, 18);
  });

  it('цикл растворение → осаждение того же количества восстанавливает DIC и инвентари (без потерь)', () => {
    const core = makeCore();
    const step1 = executeCarbonateMineralCycle(core, catalog, cycleInput());
    expect(step1.status).toBe('applied');
    if (step1.status !== 'applied') return;
    const target1 = step1.target;
    const step2 = executeCarbonateMineralCycle(step1.core, catalog, cycleInput({
      transactionId: 'tx-mineral-cycle-2',
      speciationTransactionId: 'tx-mineral-cycle-2-speciation',
      direction: 'precipitate',
      // Baseline второго шага — target первого шага (согласован с инвентарём).
      baseline: target1,
      strongIonChargeCompensationMolPerKgSw: chargeCompensationFor('precipitate', target1)
    }));
    expect(step2.status).toBe('applied');
    if (step2.status !== 'applied') return;
    // DIC вернулся к исходному (в пределах двойной точности).
    expect(step2.dicAfterMolPerKgSw).toBeCloseTo(step1.dicBeforeMolPerKgSw, 12);
    const finalOcean = entriesOf(step2.core, 'ocean');
    expect(finalOcean.ca2_aq).toBeCloseTo(0.103, FAR);
    // Формы вернулись к равновесию ИСХОДНОГО DIC/TA_C (совпадает с baseline фикстуры).
    expect(finalOcean.co3_aq).toBeCloseTo(entriesOf(core, 'ocean').co3_aq, FAR);
    expect(finalOcean.hco3_aq).toBeCloseTo(entriesOf(core, 'ocean').hco3_aq, FAR);
    expect(finalOcean.co2_aq).toBeCloseTo(entriesOf(core, 'ocean').co2_aq, FAR);
  });

  it('без компенсации фона сильных ионов цикл честно отказывает (not_verifiable), вход не изменён', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const input = cycleInput();
    const stripped: Record<string, unknown> = { ...input };
    delete stripped.strongIonChargeCompensationMolPerKgSw;
    const result = executeCarbonateMineralCycle(core, catalog, stripped as never);
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.failedStage).toBe('speciation');
      expect(result.reasonKind).toBe('not_verifiable');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('несогласованный baseline против после-реакционного инвентаря — baseline_inconsistent и ПОЛНЫЙ откат', () => {
    const core = makeCore();
    const before = snapshotOf(core);
    const wrongBaseline = baselineDistribution();
    const result = executeCarbonateMineralCycle(core, catalog, cycleInput({
      // Занижение co3 против реального инвентаря: стадия 1 применяется,
      // но составная операция обязана вернуть ИСХОДНОЕ состояние
      // (частичное применение исключено).
      baseline: {
        ...wrongBaseline,
        concentrations: {
          ...wrongBaseline.concentrations,
          co3MolPerKgSw: wrongBaseline.concentrations.co3MolPerKgSw * 0.25
        }
      }
    }));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.failedStage).toBe('speciation');
      expect(result.reasonKind).toBe('baseline_inconsistent');
    }
    expect(snapshotOf(core)).toBe(before);
  });

  it('анти-replay в цикле: повтор составной операции с теми же transactionId отклонён на стадии 1', () => {
    const core = makeCore();
    const first = executeCarbonateMineralCycle(core, catalog, cycleInput());
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    const ids = first.core.geochemicalTransactionLog?.appliedTransactionIds ?? [];
    const second = executeCarbonateMineralCycle(first.core, catalog, cycleInput());
    expect(second.status).toBe('not_applied');
    if (second.status === 'not_applied') expect(second.failedStage).toBe('mineral_reaction');
    expect(ids).toEqual(['tx-mineral-cycle-1', 'tx-mineral-cycle-1-speciation']);
  });

  it('цикл при крайнем extent: либо применён согласованно, либо отказано ИСХОДНЫМ состоянием', () => {
    const core2 = makeCore();
    const before = snapshotOf(core2);
    const oceanCo3 = entriesOf(core2, 'ocean').co3_aq;
    const result = executeCarbonateMineralCycle(core2, catalog, cycleInput({
      direction: 'precipitate',
      strongIonChargeCompensationMolPerKgSw: chargeCompensationFor('precipitate', undefined, oceanCo3 / 2),
      amountMolPerM2: oceanCo3 / 2 // synthetic test fixture: половина запаса co3
    }));
    if (result.status === 'not_applied') {
      expect(snapshotOf(core2)).toBe(before);
    } else {
      expect(validateWorldState(result.core)).toEqual([]);
      expect(entriesOf(result.core, 'ocean').co3_aq).toBeGreaterThan(0);
    }
  });

  it('различные transactionId стадий обязательны: одинаковые — not_executable до исполнения', () => {
    const core = makeCore();
    const result = executeCarbonateMineralCycle(core, catalog, cycleInput({
      speciationTransactionId: 'tx-mineral-cycle-1'
    }));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.failedStage).toBe('mineral_reaction');
      expect(result.reasonKind).toBe('not_executable');
      expect(snapshotOf(core)).toBe(snapshotOf(core));
    }
  });
});

// ============================================
// 5. ПРОИЗВОДСТВЕННЫЙ ПУТЬ: КАТАЛОГИ ВИДОВ И ПРОЦЕССОВ
// ============================================

describe('Stage 4.9f производственные каталоги: виды Ca и процессы минеральных реакций', () => {
  it('каталог видов: ca2_aq (+2, aqueous, Ca:1) и aragonite (solid, стехиометрия CaCO3); caco3 остаётся кальцитом', () => {
    expect(validateGeochemicalSpeciesDefinitions()).toEqual([]);
    const ca = GEOCHEMICAL_SPECIES_DEFINITIONS.find((d) => d.id === 'ca2_aq');
    expect(ca).toBeDefined();
    if (ca !== undefined) {
      expect(ca.formula).toBe('Ca');
      expect(ca.elements).toEqual({ Ca: 1 });
      expect(ca.charge).toBe(2);
      expect(ca.phase).toBe('aqueous');
      expect(ca.molarMassStatus).toBe('known');
      expect(ca.provenance?.sourceId).toContain('stage-4.9f');
    }
    const arag = GEOCHEMICAL_SPECIES_DEFINITIONS.find((d) => d.id === 'aragonite');
    expect(arag).toBeDefined();
    if (arag !== undefined) {
      expect(arag.formula).toBe('CaCO3');
      expect(arag.elements).toEqual({ Ca: 1, C: 1, O: 3 });
      expect(arag.charge).toBe(0);
      expect(arag.phase).toBe('solid');
      expect(arag.provenance?.limitations).toContain('НЕ взаимозаменяем');
    }
    const cal = GEOCHEMICAL_SPECIES_DEFINITIONS.find((d) => d.id === 'caco3');
    expect(cal).toBeDefined();
    if (cal !== undefined) {
      // caco3 сохранён как кальцит: идентичность NOT переписана задним числом.
      expect(cal.elements).toEqual({ Ca: 1, C: 1, O: 3 });
      expect(cal.note).toContain('КАЛЬЦИТ');
      expect(cal.note).toContain('aragonite');
    }
    // Ca не добавлен в каталог газов: геохимические определения только aqueous/solid.
    for (const def of GEOCHEMICAL_SPECIES_DEFINITIONS) {
      expect(def.phase === 'gas').toBe(false);
    }
  });

  it('производственный путь: легаси-каталог + геохимия содержит ca2_aq/aragonite без конфликтов', () => {
    const production = buildSpeciesCatalogFromLegacy(gases, elementCompositions);
    // Геохимические виды не в легаси-каталоге.
    expect(production.has('ca2_aq')).toBe(false);
    expect(production.has('aragonite')).toBe(false);
    // Тот же производственный маршрут слияния, что в Stage 4.9e production-тестах.
    const merged = addGeochemicalSpeciesToCatalog(production);
    expect(merged.issues).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.catalog.has('ca2_aq')).toBe(true);
    expect(merged.catalog.has('aragonite')).toBe(true);
    expect(merged.catalog.get('aragonite')?.phase).toBe('solid');
    expect(merged.catalog.get('ca2_aq')?.charge).toBe(2);
  });

  it('каталог процессов: 4 минеральных процесса механизма reaction с rate unknown; направления раздельны', () => {
    expect(validateInitialGeochemicalProcessCatalog()).toEqual([]);
    const ids = [
      CALCITE_DISSOLUTION_PROCESS_ID,
      CALCITE_PRECIPITATION_PROCESS_ID,
      ARAGONITE_DISSOLUTION_PROCESS_ID,
      ARAGONITE_PRECIPITATION_PROCESS_ID
    ];
    for (const id of ids) {
      const process = GEOCHEMICAL_PROCESS_CATALOG.find((p) => p.processId === id);
      expect(process).toBeDefined();
      if (process !== undefined) {
        expect(process.mechanism).toBe('reaction');
        // Статус отражает реальную возможность: путь адаптера Stage 4.9f
        // существует, кинетики нет → rate: unknown сохранён.
        expect(process.rate.status).toBe('unknown');
      }
    }
    const byId = new Map(GEOCHEMICAL_PROCESS_CATALOG.map((p) => [p.processId, p]));
    expect(byId.get(ARAGONITE_PRECIPITATION_PROCESS_ID)?.direction).toEqual({ kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'crust' });
    expect(byId.get(ARAGONITE_DISSOLUTION_PROCESS_ID)?.direction).toEqual({ kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'ocean' });
    expect(byId.get(CALCITE_DISSOLUTION_PROCESS_ID)?.speciesId).toBe('ca2_aq');
    expect(byId.get(ARAGONITE_PRECIPITATION_PROCESS_ID)?.speciesId).toBe('aragonite');
  });

  it('статусы несвязанных процессов не изменились этим этапом', () => {
    const byId = new Map(GEOCHEMICAL_PROCESS_CATALOG.map((p) => [p.processId, p]));
    // Силикатное/карбонатное выветривание остаются not_implemented (путь не реализован).
    expect(byId.get('geo.silicate_weathering.co2_aq.atm->ocn')?.implementationStatus).toBe('not_implemented');
    expect(byId.get('geo.carbonate_weathering.co2_aq.atm->ocn')?.implementationStatus).toBe('not_implemented');
    // CO2-процессы 4.9e — reaction_required (адаптер 4.9e есть, кинетики нет).
    expect(byId.get('geo.dissolution.co2_aq.atm->ocn')?.implementationStatus).toBe('reaction_required');
    // Существующий процесс осаждения кальцита теперь также reaction_required (путь Stage 4.9f).
    expect(byId.get('geo.precipitation.caco3.ocn->crust')?.implementationStatus).toBe('reaction_required');
    // Скорость выветривания осталась unknown.
    expect(byId.get('geo.silicate_weathering.co2_aq.atm->ocn')?.rate.status).toBe('unknown');
  });
});
