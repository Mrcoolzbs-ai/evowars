// ============================================
// ТЕСТЫ Stage 4.9g: macro-шаг геохимического цикла
// (Core/geochemicalCycleMacroStep.ts)
// ============================================
//
// Разделы:
// 1. Элементный снапшот и невязка (независимый оракул по инвентарям).
// 2. Фазы macro-шага: transport / co2_phase_exchange / mineral_cycle
//    через production-исполнителей 4.9a/4.9e/4.9f.
// 3. Атомарность и rollback.
// 4. Интеграционный тест 1000 macro-шагов: замкнутая система,
//    детерминизм, чувствительность к шагу, инжектированный отказ.
//
// ВАЖНО: ВСЕ скорости и начальные количества в этом файле —
// synthetic test fixture. Они проверяют контракты интеграции и
// сохранения элементов, а НЕ являются физикой процессов:
// production-каталог (geochemicalProcessCatalog.ts) остаётся с
// rate: unknown для всех процессов, и ни одна синтетическая скорость
// из этого файла в production-данные не попадает. PRNG используется
// ТОЛЬКО как детерминированный по seed генератор множителей скоростей
// тестовой фикстуры (LCG), без отправки в production-код.

import { describe, it, expect } from 'vitest';

import {
  geochemicalElementSnapshot,
  geochemicalElementResidual,
  runGeochemicalMacroStep,
  type GeochemicalMacroStepPhase
} from '../Core/geochemicalCycleMacroStep';
import {
  planGeochemicalKineticExtents,
  type GeochemicalKineticRateRecord,
  type GeochemicalKineticExtentPlan
} from '../Core/geochemicalKinetics';
import {
  GEOCHEMICAL_PROCESS_CATALOG,
  validateInitialGeochemicalProcessCatalog
} from '../Data/geochemicalProcessCatalog';
import { addGeochemicalSpeciesToCatalog } from '../Data/geochemicalSpeciesCatalog';
import { buildSpeciesCatalogFromLegacy } from '../Core/adapters';
import gases from '../Data/gases';
import elementCompositions from '../Data/elementCompositions';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { createCoreWorldState, validateWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { knownValue } from '../Core/scientificValue';
import type { DataProvenance } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { GEOCHEMICAL_RATE_UNIT } from '../Core/geochemicalFluxes';
import type { GeochemicalProcessSpec } from '../Core/geochemicalFluxes';
import { solveCarbonateEquilibrium } from '../Core/carbonateChemistry';
import type { CarbonateSpeciationDistribution } from '../Core/carbonateSpeciationExecution';
import type { CO2PhaseExchangeInput } from '../Core/co2ExchangeExecution';
import type { CarbonateMineralCycleInput } from '../Core/carbonateMineralExecution';
import type { SpeciesCatalog } from '../Core/species';

// ============================================
// ФИКСТУРЫ (synthetic test fixtures)
// ============================================

const T0 = 298.15; // K
const S0 = 35; // PSU
const PRESSURE_PA = 101325; // 1 atm
const MASS = 10; // kg-SW/m2, явная масса водного столба фикстуры
const YEAR_S = 365.25 * 86400; // юлианский год (та же конвенция, что у Stage 4.9a)

// Без аннотации типа: литеральный тип обязан быть совместим и с
// DataProvenance (поля величин), и с ReactionDataProvenance
// (поля количеств транзакций 4.9e/4.9f).
const PROV = {
  sourceName: 'synthetic test fixture: Stage 4.9g (тестовые числа)',
  sourceId: 'evowars/tests/stage-4.9g/macro-step-fixture',
  recordId: 'synthetic-macro-fixture'
};

const SRC_RATE_NOTE = 'synthetic test fixture: НЕ опубликованная скорость и НЕ production-данные';

/** Идентификаторы транспортных процессов каталога (production, mechanism transport). */
const BURIAL_ID = 'geo.organic_carbon_burial.c_org.ocn->crust';
const SUBDUCTION_ID = 'geo.subduction.caco3.crust->mantle';

/** Синтетический id фикстуры (НЕ production-каталог, для минеральной фазы). */
const MINERAL_FIXTURE_ID = 'fixture.synthetic.mineral.calcite';

/** Каталог видов: production-маршрут слияния (как в Stage 4.9e production-тестах). */
const merged = addGeochemicalSpeciesToCatalog(buildSpeciesCatalogFromLegacy(gases, elementCompositions));
const catalog: SpeciesCatalog = merged.catalog;

function reservoirOf(
  id: string,
  kind: string,
  entries: Record<string, number>,
  note: string
): ReservoirRecord {
  const reservoir = createReservoir(id, kind, { note });
  return setMaterialInventory(reservoir, 'column_amount', entries);
}

/** Решение Stage 4.9c фикстуры по ПРОИЗВОДСТВЕННОМУ решателю (как в 4.9f). */
function solveFixture(dicMolPerKgSw: number, carbonateAlkalinityMolPerKgSw: number) {
  const solved = solveCarbonateEquilibrium({
    temperatureK: T0,
    salinityPSU: S0,
    pressurePa: PRESSURE_PA,
    dicMolPerKgSw,
    carbonateAlkalinityMolPerKgSw,
    phScale: 'seawater',
    activityModel: 'ideal_dilute',
    temperatureProvenance: {
      ...PROV,
      recordId: 'fixture-temperature-stage2',
      note: 'synthetic test fixture: температура стадии переспециации, НЕ измерение'
    },
    salinityProvenance: {
      ...PROV,
      recordId: 'fixture-salinity-stage2',
      note: 'synthetic test fixture: солёность стадии переспециации, НЕ измерение'
    },
    pressureProvenance: {
      ...PROV,
      recordId: 'fixture-pressure-stage2',
      note: 'synthetic test fixture: давление стадии переспециации (1 atm), НЕ измерение'
    },
    dicProvenance: {
      ...PROV,
      recordId: 'fixture-dic-stage2',
      note: 'synthetic test fixture: DIC стадии переспециации, НЕ измерение'
    },
    carbonateAlkalinityProvenance: {
      ...PROV,
      recordId: 'fixture-ta-c-stage2',
      note: 'synthetic test fixture: карбонатная щёлочность стадии переспециации, НЕ измерение'
    }
  });
  expect(solved.status).toBe('applied');
  if (solved.status !== 'applied') throw new Error('solveCarbonateEquilibrium отказал на фикстуре (проверь Stage 4.9c)');
  return solved;
}

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
      ...PROV,
      recordId,
      method: 'synthetic test fixture: baseline из производственного решателя Stage 4.9c (solveCarbonateEquilibrium) при фиксированных T/S'
    }
  };
}

/**
 * Baseline для очередного минерального цикла: углеродные формы — из
 * решения Stage 4.9c по DIC/TA_C, вычисленным из ТЕКУЩЕГО инвентаря
 * океана; протонные концентрации (H+, OH-) — из ФАКТИЧЕСКОГО инвентаря
 * (exchange 4.9e этого же/прошлых шагов сдвигает co2_aq без переспециации
 * протонов, поэтому H из решения не согласуется с инвентарём, а
 * baseline обязан быть согласован с фактическим инвентарём).
 */
function baselineFromInventory(core: CoreWorldState, recordId: string): CarbonateSpeciationDistribution {
  const ocean = core.reservoirs.find((r) => r.id === 'ocean');
  if (ocean === undefined || ocean.material === undefined) {
    throw new Error('фикстура: резервуар ocean без инвентаря');
  }
  const entries = ocean.material.entries as Record<string, number>;
  const co2Aq = entries['co2_aq'] ?? 0;
  const hco3 = entries['hco3_aq'] ?? 0;
  const co3 = entries['co3_aq'] ?? 0;
  const dic = (co2Aq + hco3 + co3) / MASS;
  const alk = (hco3 + 2 * co3) / MASS;
  const solved = solveFixture(dic, alk);
  return {
    phScale: solved.phScale,
    activityModel: solved.activityModel,
    temperatureK: solved.temperatureK,
    salinityPSU: solved.salinityPSU,
    pressurePa: solved.pressurePa,
    approximationKind: solved.approximation.kind,
    concentrations: {
      co2StarMolPerKgSw: solved.speciesMolPerKgSw.co2_aq,
      hco3MolPerKgSw: solved.speciesMolPerKgSw.hco3_aq,
      co3MolPerKgSw: solved.speciesMolPerKgSw.co3_aq,
      hydrogenMolPerKgSw: (entries['hplus_aq'] ?? 0) / MASS,
      ohMolPerKgSw: (entries['oh_aq'] ?? 0) / MASS
    },
    provenance: {
      ...PROV,
      recordId,
      method: 'synthetic test fixture: baseline из производственного решателя Stage 4.9c по DIC/TA_C инвентаря; протонные концентрации — из фактического инвентаря (согласованность baseline)'
    }
  };
}

interface ChargeCompensation {
  readonly deltaStrongIonChargeMolPerKgSw: number;
  readonly hydrogenMolPerM2Drift: number;
  readonly oxygenMolPerM2Drift: number;
  readonly provenance: DataProvenance;
}

/**
 * Компенсация фона сильных ионов для минерального цикла (семантика как
 * в 4.9f): закрывает изменение модельного заряда ПЕРЕспециации относительно
 * пост-реакционного baseline (сдвиг только co3). Заодно возвращает
 * ожидаемые дрейфы H и O инвентаря: H содержится в hco3_aq, hplus_aq и
 * oh_aq; O — в co2_aq (×2), hco3_aq (×3), co3_aq (×3) и oh_aq (×1).
 * Оба дрейфа НЕ сохраняются при переспециации в CO2* — при переходе
 * hco3 -> co2_aq атомы H и O уходят в неявный растворитель H2O, количество
 * которого в инвентаре не отслеживается (известное ограничение
 * Stage 4.9d/4.9e); здесь дрейфы предсказываются ТОЧНО из решения
 * Stage 4.9c, что исключает маскировку под balanced.
 */
function chargeCompensationFor(
  direction: 'dissolve' | 'precipitate',
  base: CarbonateSpeciationDistribution,
  amountMolPerM2: number,
  massKgPerM2: number
): ChargeCompensation {
  const sign = direction === 'dissolve' ? 1 : -1;
  const perKg = amountMolPerM2 / massKgPerM2;
  const b = base.concentrations;
  const postCo3 = b.co3MolPerKgSw + sign * perKg;
  const dic = b.co2StarMolPerKgSw + b.hco3MolPerKgSw + b.co3MolPerKgSw + sign * perKg;
  const alk = b.hco3MolPerKgSw + 2 * b.co3MolPerKgSw + sign * 2 * perKg;
  const solved = solveFixture(dic, alk);
  const tOh = solved.speciesMolPerKgSw.oh_aq ?? 0;
  const modeledChargePerKg =
    -1 * (solved.speciesMolPerKgSw.hco3_aq - b.hco3MolPerKgSw) +
    -2 * (solved.speciesMolPerKgSw.co3_aq - postCo3) +
    1 * (solved.hydrogenMolPerKgSw - b.hydrogenMolPerKgSw) +
    -1 * (tOh - (b.ohMolPerKgSw ?? 0));
  // Полный водородный дрейф: H в инвентаре несут hco3_aq, hplus_aq и oh_aq.
  const hydrogenDriftPerM2 =
    massKgPerM2 *
    ((solved.speciesMolPerKgSw.hco3_aq - b.hco3MolPerKgSw) +
      (solved.hydrogenMolPerKgSw - b.hydrogenMolPerKgSw) +
      (tOh - (b.ohMolPerKgSw ?? 0)));
  // Полный кислородный дрейф: O в инвентаре несут co2_aq (×2),
  // hco3_aq (×3), co3_aq (×3) и oh_aq (×1). Дельта co3 берётся относительно
  // ПОСТ-РЕАКЦИОННОГО состояния postCo3 (реакционная стадия поставляет co3
  // из минерала с сохранением O: CaCO3 -> Ca2+ + CO3^2-), а вклад реакции
  // в суммарный O равен нулю (caco3 и co3_aq оба O×3).
  const oxygenDriftPerM2 =
    massKgPerM2 *
    (2 * (solved.speciesMolPerKgSw.co2_aq - b.co2StarMolPerKgSw) +
      3 * (solved.speciesMolPerKgSw.hco3_aq - b.hco3MolPerKgSw) +
      3 * (solved.speciesMolPerKgSw.co3_aq - postCo3) +
      (tOh - (b.ohMolPerKgSw ?? 0)));
  return {
    deltaStrongIonChargeMolPerKgSw: -modeledChargePerKg,
    hydrogenMolPerM2Drift: hydrogenDriftPerM2,
    oxygenMolPerM2Drift: oxygenDriftPerM2,
    provenance: {
      ...PROV,
      recordId: 'fixture-strong-ion-compensation-macro',
      note: 'synthetic test fixture: компенсация фоновых сильных ионов закрывает изменение модельного заряда переспециации; полный фон сильных ионов вне Stage 4.9 (ограничение Stage 4.9d)'
    }
  };
}

/** Резервуары замкнутой тестовой подсистемы (все количества — synthetic fixture). */
function fixtureReservoirs(): ReservoirRecord[] {
  const b = distributionOfSolve(solveFixture(0.002, 0.0023), 'fixture-reservoirs-baseline').concentrations;
  return [
    reservoirOf(
      'atmosphere',
      'atmospheric_column',
      { co2: 2.0e-4 },
      'synthetic test fixture: столб атмосферы фикстуры в mol/m2, НЕ данные планеты'
    ),
    reservoirOf(
      'ocean',
      'ocean_surface',
      {
        co2_aq: b.co2StarMolPerKgSw * MASS,
        hco3_aq: b.hco3MolPerKgSw * MASS,
        co3_aq: b.co3MolPerKgSw * MASS,
        hplus_aq: b.hydrogenMolPerKgSw * MASS,
        oh_aq: (b.ohMolPerKgSw ?? 0) * MASS,
        ca2_aq: 0.0106,
        c_org: 8.0e-4
      },
      'synthetic test fixture: столб океана фикстуры (концентрации baseline решателя 4.9c × масса столба) + ca2_aq + c_org, НЕ данные океана'
    ),
    reservoirOf(
      'crust',
      'crustal_column',
      { caco3: 0.05, c_org: 2.0e-3 },
      'synthetic test fixture: карбонат и захоронённая органика коры фикстуры в mol/m2'
    ),
    reservoirOf(
      'mantle',
      'mantle_column',
      { caco3: 0.01 },
      'synthetic test fixture: глубинный карбонат мантии фикстуры в mol/m2'
    )
  ];
}

function makeCore(): CoreWorldState {
  const core = createCoreWorldState('w-geochemical-macro-step-test');
  core.bodies.push({ id: 'star', kind: 'star', properties: {} });
  core.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: { mass: knownValue(quantity(5.97e24, 'kg')) } // synthetic test fixture
  });
  core.gravity = { planet: 'star', star: null };
  core.radiationSources.push({ id: 'star-light', bodyId: 'star', kind: 'star' });
  for (const r of fixtureReservoirs()) {
    core.reservoirs.push({ ...r, bodyId: 'planet' });
  }
  core.legacy = { generatorVersion: '0.3.0', seed: 'macro-test-seed' };
  return core;
}

function entriesOf(core: CoreWorldState, id: string): Record<string, number> {
  const reservoir = core.reservoirs.find((r) => r.id === id);
  return (reservoir?.material?.entries ?? {}) as Record<string, number>;
}

function entriesOfAll(core: CoreWorldState): Record<string, Record<string, number>> {
  const all: Record<string, Record<string, number>> = {};
  for (const r of core.reservoirs) {
    if (r.material !== undefined) {
      all[r.id] = { ...r.material.entries } as Record<string, number>;
    }
  }
  return all;
}

function productionSpec(id: string): GeochemicalProcessSpec {
  const spec = GEOCHEMICAL_PROCESS_CATALOG.find((p) => p.processId === id);
  if (spec === undefined) throw new Error('process id не найден в каталоге: ' + id);
  return spec;
}

/**
 * Копия production-спецификации с ЯВНО синтетической скоростью
 * (известной только в тестовой фикстуре; production-каталог не меняется:
 * каждый вызов делает собственную копию spec).
 */
function withSyntheticRate(spec: GeochemicalProcessSpec, rate: number, recordId: string): GeochemicalProcessSpec {
  return {
    ...spec,
    rate: {
      status: 'known',
      unit: GEOCHEMICAL_RATE_UNIT,
      molPerM2PerYear: rate,
      provenance: {
        ...PROV,
        recordId,
        note: SRC_RATE_NOTE
      }
    }
  };
}

function timeOf(step: number): { segmentIndex: number; localTimeS: number } {
  return { segmentIndex: 0, localTimeS: step * YEAR_S };
}

/** Детерминированный LCG (synthetic test fixture): множитель скоростей по индексу шага. */
function stepFactor(seed: number, step: number): number {
  const raw = (Math.imul(seed + step + 1, 2654435761) >>> 0) / 4294967296;
  return 0.5 + 0.5 * raw;
}

const SYNTHETIC_RATE_BASE = {
  burial: 5.0e-8, // mol m-2 yr-1 (fixture)
  subduction: 4.0e-8,
  exchange: 5.0e-8,
  mineral: 2.0e-6
};

const DURATION_PROVENANCE = {
  sourceName: 'synthetic test fixture: Stage 4.9g (длительность macro-шага задана явно)',
  sourceId: 'evowars/tests/stage-4.9g/duration-fixture',
  recordId: 'fixture-duration-macro'
};

interface ScenarioOptions {
  readonly seed: number;
  readonly steps: number;
  readonly dtYears: number;
  readonly includeMineral: boolean;
  /** 'random' — LCG-множитель по шагу; 'constant' — базовые скорости без множителя (для теста чувствительности к шагу). */
  readonly rateFactor: 'random' | 'constant';
}

/** Кинетические записи фикстуры (синтетические скорости, НЕ production-данные). */
function kineticRecords(opts: ScenarioOptions, step: number): GeochemicalKineticRateRecord[] {
  const f = opts.rateFactor === 'constant' ? 1 : stepFactor(opts.seed, step);
  function known(processId: string, base: number): GeochemicalKineticRateRecord {
    return {
      processId,
      rateClass: 'constant_zero_order',
      status: 'known',
      rateMolPerM2PerYear: base * f,
      rateProvenance: {
        ...PROV,
        recordId: 'synthetic-rate-' + processId,
        note: SRC_RATE_NOTE
      },
      applicability: 'synthetic test fixture: без физической области применимости'
    };
  }
  return [
    known(BURIAL_ID, SYNTHETIC_RATE_BASE.burial),
    known(SUBDUCTION_ID, SYNTHETIC_RATE_BASE.subduction),
    known('geo.dissolution.co2_aq.atm->ocn', SYNTHETIC_RATE_BASE.exchange),
    known(MINERAL_FIXTURE_ID, SYNTHETIC_RATE_BASE.mineral)
  ];
}

interface ScenarioResult {
  readonly finalEntries: Record<string, Record<string, number>>;
  readonly finalTotals: Record<string, number>;
  readonly finalCharge: number;
  readonly residual: ReturnType<typeof geochemicalElementResidual>;
  readonly chargeActual: number;
  readonly chargeExpected: number;
  readonly hydrogenActual: number;
  readonly hydrogenExpected: number;
  readonly oxygenExpected: number;
  readonly appliedPhaseCount: number;
  readonly fluxRecords: number;
  readonly reactionRecords: number;
  readonly transactions: number;
  readonly injection: {
    readonly status: string;
    readonly coreIsOriginal: boolean;
    readonly failedPhaseIndex: number;
    readonly appliedPhases: number;
  } | null;
}

function runScenario(opts: ScenarioOptions): ScenarioResult {
  let core: CoreWorldState = makeCore();
  const before = geochemicalElementSnapshot(catalog, core);
  let appliedPhaseCount = 0;
  let chargeExpected = 0;
  let hydrogenExpected = 0;
  let oxygenExpected = 0;
  let injection: ScenarioResult['injection'] = null;

  /**
   * Фазы одного macro-шага; замыкание на ТЕКУЩИЙ core гарантирует, что
   * baseline минерального цикла всегда согласован с актуальным инвентарём.
   */
  const buildPhases = function (step: number, plan: GeochemicalKineticExtentPlan): GeochemicalMacroStepPhase[] {
    const burialRate = plan.extents.find((e) => e.processId === BURIAL_ID)!.rateMolPerM2PerYear;
    const subductionRate = plan.extents.find((e) => e.processId === SUBDUCTION_ID)!.rateMolPerM2PerYear;
    const exchangeExtent = plan.extents.find((e) => e.processId === 'geo.dissolution.co2_aq.atm->ocn')!.extentMolPerM2;
    const phases: GeochemicalMacroStepPhase[] = [];
    // Минеральная фаза — ПЕРВОЙ в macro-шаге: её baseline обязан быть
    // согласован с инвентарём НАЧАЛА шага (все фазы строятся по одному
    // состоянию; Exchange в этом же шаге сдвинул бы co2_aq и нарушил бы
    // согласованность baseline с инвентарём на момент минеральной фазы).
    if (opts.includeMineral && step % 10 === 5) {
      const mineralExtent = plan.extents.find((e) => e.processId === MINERAL_FIXTURE_ID)!.extentMolPerM2;
      const baseline = baselineFromInventory(core, 'fixture-baseline-macro-' + String(step));
      const compensation = chargeCompensationFor('dissolve', baseline, mineralExtent, MASS);
      // Ожидаемые дрейфы инвентарного заряда и H: вычисляются точно из
      // решения Stage 4.9c по целевой DIC/TA_C — НЕ заглушки.
      chargeExpected += -1 * compensation.deltaStrongIonChargeMolPerKgSw * MASS;
      hydrogenExpected += compensation.hydrogenMolPerM2Drift;
      oxygenExpected += compensation.oxygenMolPerM2Drift;
      phases.push({
        kind: 'mineral_cycle',
        input: {
          transactionId: 'tx-mineral-' + String(step),
          speciationTransactionId: 'tx-mineral-' + String(step) + '-speciation',
          mineral: 'calcite',
          direction: 'dissolve',
          oceanReservoirId: 'ocean',
          crustReservoirId: 'crust',
          amountMolPerM2: mineralExtent,
          amountProvenance: {
            ...PROV,
            recordId: 'fixture-mineral-extent-' + String(step),
            note: 'synthetic test fixture: количество минерального цикла из кинетического плана фикстуры, НЕ кинетика растворения'
          },
          baseline,
          seawaterColumnMassKgPerM2: {
            valueKgPerM2: MASS,
            unit: 'kg-SW/m²',
            provenance: {
              ...PROV,
              recordId: 'fixture-column-mass-macro',
              note: 'synthetic test fixture: масса водного столба задана ЯВНО, НЕ вычислена из глубины'
            }
          },
          strongIonChargeCompensationMolPerKgSw: compensation,
          time: timeOf(step)
        } as CarbonateMineralCycleInput
      });
    }
    phases.push({
        kind: 'transport',
        spec: withSyntheticRate(productionSpec(BURIAL_ID), burialRate, 'synthetic-rate-stage49g-burial'),
        fluxId: 'flux-burial-' + String(step),
        durationS: plan.durationSeconds,
        time: timeOf(step),
        note: 'Stage 4.9g macro-step: захоронение органического углерода (скорость — synthetic test fixture)'
      },
      {
        kind: 'transport',
        spec: withSyntheticRate(productionSpec(SUBDUCTION_ID), subductionRate, 'synthetic-rate-stage49g-subduction'),
        fluxId: 'flux-subduction-' + String(step),
        durationS: plan.durationSeconds,
        time: timeOf(step),
        note: 'Stage 4.9g macro-step: субдукция карбоната (скорость — synthetic test fixture)'
      },
      {
        kind: 'co2_phase_exchange',
        input: {
          transactionId: 'tx-exchange-' + String(step),
          direction: 'dissolution',
          atmosphereReservoirId: 'atmosphere',
          oceanReservoirId: 'ocean',
          amountMolPerM2: exchangeExtent,
          amountProvenance: {
            ...PROV,
            recordId: 'fixture-co2-exchange-amount-' + String(step),
            note: 'synthetic test fixture: количество обмена из кинетического плана фикстуры (rate × Δt), НЕ термодинамическое равновесие на этот шаг'
          },
          time: timeOf(step)
        } as CO2PhaseExchangeInput
      }
    );
    return phases;
  };

  for (let step = 0; step < opts.steps; step++) {
    // Инжектированный отказ на середине прогона: искусственно невыполнимый
    // обмен (количество превышает весь атмосферный запас). Ожидается
    // честный not_applied и ПОЛНЫЙ rollback macro-шага.
    if (opts.steps > 2 && step === Math.floor(opts.steps / 2)) {
      const snapshotBeforeInjection = JSON.stringify(entriesOfAll(core));
      const failResult = runGeochemicalMacroStep(core, catalog, [
        {
          kind: 'co2_phase_exchange',
          input: {
            transactionId: 'tx-injected-failure-' + String(step),
            direction: 'dissolution',
            atmosphereReservoirId: 'atmosphere',
            oceanReservoirId: 'ocean',
            amountMolPerM2: 1.0e9,
            amountProvenance: {
              ...PROV,
              recordId: 'fixture-injected-failure-amount',
              note: 'synthetic test fixture: намеренно невыполнимое количество для проверки rollback'
            },
            time: timeOf(step)
          } as CO2PhaseExchangeInput
        }
      ]);
      injection = {
        status: failResult.status,
        coreIsOriginal: failResult.core === core,
        failedPhaseIndex: failResult.status === 'not_applied' ? failResult.failedPhaseIndex : -1,
        appliedPhases: failResult.appliedPhases.length
      };
      expect(failResult.status).toBe('not_applied');
      expect(failResult.core).toBe(core);
      expect(JSON.stringify(entriesOfAll(core))).toBe(snapshotBeforeInjection);
      continue;
    }

    const plan = planGeochemicalKineticExtents({
      records: kineticRecords(opts, step),
      durationYears: opts.dtYears,
      durationProvenance: {
        ...DURATION_PROVENANCE,
        recordId: 'fixture-duration-macro-' + String(step)
      }
    });
    const result = runGeochemicalMacroStep(core, catalog, buildPhases(step, plan));
    if (result.status !== 'applied') {
      const failed = result.appliedPhases.length > 0 ? 'частично применён' : 'не применён';
      throw new Error(
        'macro-step ' + String(step) + ' ' + failed + ': failedPhaseIndex=' + String(result.failedPhaseIndex) +
        ' reasonKind=' + String(result.reasonKind) + ' reason=' + String(result.reason).slice(0, 300)
      );
    }
    expect(result.status).toBe('applied');
    core = result.core;
    appliedPhaseCount += result.appliedPhases.length;
  }

  const after = geochemicalElementSnapshot(catalog, core);
  return {
    finalEntries: entriesOfAll(core),
    finalTotals: { ...after.totals },
    finalCharge: after.charge,
    residual: geochemicalElementResidual(before, after),
    chargeActual: after.charge - before.charge,
    chargeExpected,
    hydrogenActual: after.totals['H'] - before.totals['H'],
    hydrogenExpected,
    oxygenExpected,
    appliedPhaseCount,
    fluxRecords: core.fluxLedger.records.length,
    reactionRecords: core.reactionLedger !== undefined ? core.reactionLedger.records.length : -1,
    transactions:
      core.geochemicalTransactionLog !== undefined
        ? core.geochemicalTransactionLog.appliedTransactionIds.length
        : -1,
    injection
  };
}

// ============================================
// 0. ПРОИЗВОДСТВЕННЫЙ ПУТЬ
// ============================================

describe('Stage 4.9g macro-шаг: производственный путь', () => {
  it('слияние легаси-каталога и геохимии (production-маршрут) содержит все виды тестовой подсистемы', () => {
    expect(merged.issues).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    for (const id of ['co2', 'co2_aq', 'hco3_aq', 'co3_aq', 'hplus_aq', 'oh_aq', 'ca2_aq', 'caco3', 'c_org']) {
      expect(catalog.has(id)).toBe(true);
    }
    expect(catalog.get('co2')!.phase).toBe('gas');
    expect(catalog.get('co2_aq')!.phase).toBe('aqueous');
  });

  it('production-каталог процессов валиден; два transport-процесса executable с честной unknown-скоростью', () => {
    expect(validateInitialGeochemicalProcessCatalog()).toEqual([]);
    for (const id of [BURIAL_ID, SUBDUCTION_ID]) {
      const spec = productionSpec(id);
      expect(spec.mechanism).toBe('transport');
      expect(spec.implementationStatus).toBe('executable');
      expect(spec.rate.status).toBe('unknown');
      if (spec.rate.status === 'unknown') {
        expect(spec.rate.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================
// 1. ЭЛЕМЕНТНЫЙ СНАПШОТ И НЕВЯЗКА (независимый оракул)
// ============================================

describe('Stage 4.9g macro-шаг: элементный снапшот (независимый оракул)', () => {
  it('снапшот суммирует инвентари всех резервуаров и совпадает с независимым пересчётом', () => {
    const snapshot = geochemicalElementSnapshot(catalog, makeCore());
    // Независимый пересчёт: углерод = co2 + co2_aq + hco3 + co3 + caco3 + c_org.
    const b = distributionOfSolve(solveFixture(0.002, 0.0023), 'fixture-snapshot-baseline').concentrations;
    const expectedC = 2.0e-4
      + b.co2StarMolPerKgSw * MASS
      + b.hco3MolPerKgSw * MASS
      + b.co3MolPerKgSw * MASS
      + 0.05 + 0.01 // caco3 crust + mantle
      + 8.0e-4 + 2.0e-3; // c_org ocean + crust
    expect(snapshot.totals['C']).toBeCloseTo(expectedC, 12);
  });

  it('резервуар без material попадает в unknownMaterialReservoirs, а не в ноль', () => {
    const baseCore = makeCore();
    const core = makeCore();
    core.reservoirs.push(createReservoir('exogenic_sink', 'other'));
    const base = geochemicalElementSnapshot(catalog, baseCore);
    const snapshot = geochemicalElementSnapshot(catalog, core);
    expect(snapshot.unknownMaterialReservoirs).toContain('exogenic_sink');
    expect(geochemicalElementResidual(base, snapshot).absolute['C']).toBeCloseTo(0, 14);
  });

  it('вид без известного состава исключается из подсчёта И явно перечисляется (не ноль, не молчание)', () => {
    const core = makeCore();
    const patched = setMaterialInventory(
      core.reservoirs.find((r) => r.id === 'ocean')!,
      'column_amount',
      { ...entriesOf(core, 'ocean'), unknown_mineral: 1.0 }
    );
    core.reservoirs = core.reservoirs.map((r) => (r.id === 'ocean' ? patched : r));
    const base = geochemicalElementSnapshot(catalog, makeCore());
    const snapshot = geochemicalElementSnapshot(catalog, core);
    expect(snapshot.excludedSpecies).toContain('unknown_mineral');
    const residual = geochemicalElementResidual(base, snapshot);
    expect(residual.absolute['C']).toBeCloseTo(0, 14);
  });
});

// ============================================
// 2. ФАЗЫ MACRO-ШАГА
// ============================================

describe('Stage 4.9g macro-шаг: фазы через production-исполнителей', () => {
  it('transport (production spec каталога + синтетическая скорость фикстуры): перенос происходит, элементы сохраняются, поток записан', () => {
    const core = makeCore();
    const before = geochemicalElementSnapshot(catalog, core);
    const spec = withSyntheticRate(productionSpec(SUBDUCTION_ID), 4.0e-4, 'synthetic-rate-single');
    const result = runGeochemicalMacroStep(core, catalog, [
      { kind: 'transport', spec, fluxId: 'flux-single-subduction', durationS: YEAR_S, time: timeOf(0) }
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const moved = 4.0e-4 * 1; // extent = rate × Δt (1 юлианский год)
    expect(entriesOf(result.core, 'crust')['caco3']).toBeCloseTo(0.05 - moved, 15);
    expect(entriesOf(result.core, 'mantle')['caco3']).toBeCloseTo(0.01 + moved, 15);
    expect(result.core.fluxLedger.records.length).toBe(1);
    const residual = geochemicalElementResidual(before, result.elementAfter);
    expect(residual.absolute['C']).toBeCloseTo(0, 14);
    expect(residual.absolute['Ca']).toBeCloseTo(0, 14);
    expect(residual.absolute['O']).toBeCloseTo(0, 14);
  });

  it('production-спецификация БЕЗ переопределения (rate unknown) честно не применяется: ни чисел, ни записей в журналах', () => {
    const core = makeCore();
    const result = runGeochemicalMacroStep(core, catalog, [
      { kind: 'transport', spec: productionSpec(SUBDUCTION_ID), fluxId: 'flux-unknown', durationS: YEAR_S, time: timeOf(0) }
    ]);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'applied') {
      expect(result.reason).toContain('неизвестна');
      expect(result.reason).toContain('не подтверждена источником');
    }
    expect(result.core).toBe(core);
    expect(result.core.fluxLedger.records.length).toBe(0);
    expect(JSON.stringify(entriesOfAll(core))).toBe(JSON.stringify(entriesOfAll(result.core)));
  });

  it('production-каталог переопределяется ТОЛЬКО в тесте: сам GEOCHEMICAL_PROCESS_CATALOG не тронут', () => {
    const spec = productionSpec(SUBDUCTION_ID);
    expect(spec.rate.status).toBe('unknown');
    expect(JSON.stringify(spec)).not.toContain(SRC_RATE_NOTE);
  });

  it('co2_phase_exchange (Stage 4.9e) внутри macro-шага: co2 минус в атмосфере, co2_aq плюс в океане, C сохраняется', () => {
    const core = makeCore();
    const before = geochemicalElementSnapshot(catalog, core);
    const amount = 1.0e-7;
    const oceanCo2AqBefore = entriesOf(core, 'ocean')['co2_aq'];
    const result = runGeochemicalMacroStep(core, catalog, [
      {
        kind: 'co2_phase_exchange',
        input: {
          transactionId: 'tx-single-exchange',
          direction: 'dissolution',
          atmosphereReservoirId: 'atmosphere',
          oceanReservoirId: 'ocean',
          amountMolPerM2: amount,
          amountProvenance: {
            ...PROV,
            recordId: 'fixture-single-exchange-amount',
            note: 'synthetic test fixture: количество задано явно, НЕ из равновесия'
          },
          time: timeOf(0)
        } as CO2PhaseExchangeInput
      }
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(entriesOf(result.core, 'atmosphere')['co2']).toBeCloseTo(2.0e-4 - amount, 15);
    expect(entriesOf(result.core, 'ocean')['co2_aq']).toBeCloseTo(oceanCo2AqBefore + amount, 15);
    const residual = geochemicalElementResidual(before, result.elementAfter);
    expect(residual.absolute['C']).toBeCloseTo(0, 14);
    expect(residual.absolute['O']).toBeCloseTo(0, 14);
  });

  it('mineral_cycle (Stage 4.9f) внутри macro-шага: минерал расходуется, C и Ca сохраняются, дрейф H объясняется протонными дельтами', () => {
    const core = makeCore();
    const before = geochemicalElementSnapshot(catalog, core);
    const amount = 1.0e-7;
    const baseline = baselineFromInventory(core, 'fixture-single-mineral-baseline');
    const compensation = chargeCompensationFor('dissolve', baseline, amount, MASS);
    const result = runGeochemicalMacroStep(core, catalog, [
      {
        kind: 'mineral_cycle',
        input: {
          transactionId: 'tx-single-mineral',
          speciationTransactionId: 'tx-single-mineral-speciation',
          mineral: 'calcite',
          direction: 'dissolve',
          oceanReservoirId: 'ocean',
          crustReservoirId: 'crust',
          amountMolPerM2: amount,
          amountProvenance: {
            ...PROV,
            recordId: 'fixture-single-mineral-extent',
            note: 'synthetic test fixture: количество задано явно, НЕ кинетика'
          },
          baseline,
          seawaterColumnMassKgPerM2: {
            valueKgPerM2: MASS,
            unit: 'kg-SW/m²',
            provenance: {
              ...PROV,
              recordId: 'fixture-column-mass-single',
              note: 'synthetic test fixture: масса водного столба задана ЯВНО'
            }
          },
          strongIonChargeCompensationMolPerKgSw: compensation,
          time: timeOf(0)
        } as CarbonateMineralCycleInput
      }
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(entriesOf(result.core, 'crust')['caco3']).toBeCloseTo(0.05 - amount, 15);
    const residual = geochemicalElementResidual(before, result.elementAfter);
    expect(residual.absolute['C']).toBeCloseTo(0, 14);
    expect(residual.absolute['Ca']).toBeCloseTo(0, 14);
    // Кислород НЕ сохраняется в минеральном цикле: при переспециации в
    // CO2* часть O уходит в неявный растворитель H2O (известное ограничение
    // Stage 4.9d/4.9e). Дрейф предсказывается ТОЧНО из дельт решения
    // Stage 4.9c — аудит согласован с известной химией, а не маскируется.
    expect(Math.abs(residual.absolute['O'] - compensation.oxygenMolPerM2Drift)).toBeLessThanOrEqual(1e-12);
    // Водород НЕ сохраняется: дрейф равен водородным дельтам переспециации
    // (hco3_aq, hplus_aq, oh_aq), предсказанным независимо решателем Stage 4.9c.
    const hydrogenDrift = result.elementAfter.totals['H'] - before.totals['H'];
    expect(Math.abs(hydrogenDrift)).toBeGreaterThan(0);
    expect(hydrogenDrift).toBeCloseTo(compensation.hydrogenMolPerM2Drift, 12);
  });

  it('повторное применение того же fluxId отклоняется (анти-replay на уровне macro-шага)', () => {
    const core = makeCore();
    const spec = withSyntheticRate(productionSpec(SUBDUCTION_ID), 1e-8, 'synthetic-rate-replay');
    const result = runGeochemicalMacroStep(core, catalog, [
      { kind: 'transport', spec, fluxId: 'flux-replay', durationS: YEAR_S, time: timeOf(0) }
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const replay = runGeochemicalMacroStep(result.core, catalog, [
      { kind: 'transport', spec, fluxId: 'flux-replay', durationS: YEAR_S, time: timeOf(1) }
    ]);
    expect(replay.status).toBe('not_applied');
    if (replay.status !== 'applied') {
      expect(replay.reason.length).toBeGreaterThan(0);
    }
    // Инвентари не изменились при отклонённом повторе.
    expect(JSON.stringify(entriesOfAll(result.core))).toBe(
      JSON.stringify({
        atmosphere: entriesOf(result.core, 'atmosphere'),
        ocean: entriesOf(result.core, 'ocean'),
        crust: entriesOf(result.core, 'crust'),
        mantle: entriesOf(result.core, 'mantle')
      })
    );
  });
});

// ============================================
// 3. АТОМАРНОСТЬ И ROLLBACK
// ============================================

describe('Stage 4.9g macro-шаг: атомарность и rollback', () => {
  it('отказ второй фазы откатывает ВЕСЬ шаг: состояние исходное (ссылочно), промежуточное не протекло', () => {
    const core = makeCore();
    const snapshot = JSON.stringify(entriesOfAll(core));
    const spec = withSyntheticRate(productionSpec(SUBDUCTION_ID), 1e-8, 'synthetic-rate-atomic');
    const result = runGeochemicalMacroStep(core, catalog, [
      { kind: 'transport', spec, fluxId: 'flux-ok', durationS: YEAR_S, time: timeOf(0) },
      {
        kind: 'co2_phase_exchange',
        input: {
          transactionId: 'tx-too-much',
          direction: 'dissolution',
          atmosphereReservoirId: 'atmosphere',
          oceanReservoirId: 'ocean',
          amountMolPerM2: 1.0e9,
          amountProvenance: {
            ...PROV,
            recordId: 'fixture-too-much',
            note: 'synthetic test fixture: количество превышает весь запас атмосферы'
          },
          time: timeOf(0)
        } as CO2PhaseExchangeInput
      }
    ]);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'applied') {
      expect(result.failedPhaseIndex).toBe(1);
      expect(result.failedKind).toBe('co2_phase_exchange');
      expect(result.appliedPhases.length).toBe(1);
    }
    expect(result.core).toBe(core);
    expect(JSON.stringify(entriesOfAll(result.core))).toBe(snapshot);
  });

  it('пустая последовательность фаз — not_applied, а не фиктивное применение', () => {
    const core = makeCore();
    const result = runGeochemicalMacroStep(core, catalog, []);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'applied') {
      expect(result.failedPhaseIndex).toBe(-1);
    }
  });

  it('финальная validateWorldState macro-шага не подменяется состоянием без аудита', () => {
    const core = makeCore();
    expect(validateWorldState(core)).toEqual([]);
    const spec = withSyntheticRate(productionSpec(BURIAL_ID), 1e-8, 'synthetic-rate-validate');
    const result = runGeochemicalMacroStep(core, catalog, [
      { kind: 'transport', spec, fluxId: 'flux-valid', durationS: YEAR_S, time: timeOf(0) }
    ]);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(validateWorldState(result.core)).toEqual([]);
  });
});

// ============================================
// 4. ИНТЕГРАЦИОННЫЙ ТЕСТ 1000 MACRO-ШАГОВ
// ============================================

describe('Stage 4.9g: интеграция 1000 macro-шагов (замкнутая тестовая подсистема)', () => {
  it(
    '1000 шагов: C и Ca сохраняются с относительной невязкой <= 1e-9; O и H честно НЕ сохраняются и их дрейфы предсказаны точными дельтами решения Stage 4.9c; отказ посередине откатывается; отрицательных запасов нет',
    () => {
      const result = runScenario({ seed: 13001, steps: 1000, dtYears: 1, includeMineral: true, rateFactor: 'random' });

      // Отказ посередине прогона.
      expect(result.injection).not.toBeNull();
      if (result.injection !== null) {
        expect(result.injection.status).toBe('not_applied');
        expect(result.injection.coreIsOriginal).toBe(true);
        expect(result.injection.failedPhaseIndex).toBe(0);
        expect(result.injection.appliedPhases).toBe(0);
      }

      // Консервация C и Ca на 1000 шагах (независимый оракул по инвентарям).
      for (const element of ['C', 'Ca']) {
        expect(result.residual.absolute[element]).toBeCloseTo(0, 9);
        expect(Math.abs(result.residual.relative[element] ?? 0)).toBeLessThanOrEqual(1e-9);
      }
      // Кислород честно НЕ сохраняется: переспециация DIC в CO2* переносит
      // O в неявный растворитель H2O (не в инвентаре, ограничение 4.9d/4.9e),
      // обмен co2/co2_aq сохраняет O (состав идентичен). Дрейф O предсказан
      // побитово точно суммой дельт решения Stage 4.9c минеральных циклов
      // — аудит не маскируется под balanced.
      expect(Math.abs(result.residual.absolute['O'] - result.oxygenExpected)).toBeLessThanOrEqual(1e-12);
      // Водород честно НЕ сохраняется (не маскируется под balanced),
      // при этом дрейф точно предсказан протонными дельтами
      // переспециации минеральных циклов.
      expect(Math.abs(result.hydrogenActual)).toBeGreaterThan(0);
      expect(result.hydrogenActual).toBeCloseTo(result.hydrogenExpected, 8);
      expect(result.residual.absolute['H']).toBeCloseTo(result.hydrogenExpected, 8);

      // Дрейф инвентарного заряда тоже объяснён ТОЧНО (потолок не маскирует,
      // а предсказывает: modeled charge закрыт фоном сильных ионов вне видов).
      expect(result.chargeActual).toBeCloseTo(result.chargeExpected, 8);

      // Отрицательных запасов нет: все записи конечны и >= 0.
      for (const reservoirEntries of Object.values(result.finalEntries)) {
        for (const amount of Object.values(reservoirEntries)) {
          expect(Number.isFinite(amount)).toBe(true);
          expect(amount).toBeGreaterThanOrEqual(0);
        }
      }

      // Контроль двойного учёта: из 1000 шагов один (середина) занят
      // инжектированным отказом, остальные 999 применяли ровно 2
      // transport-фазы каждая (FluxLedger), ТОЛЬКО через аудированный
      // production-путь. Обмен пишёт 1 транзакцию/шаг, минеральный цикл
      // 2 (реакция + переспециация); минеральных циклов 100.
      expect(result.fluxRecords).toBe(2 * 999);
      expect(result.transactions).toBe(999 + 2 * 100);
      expect(result.reactionRecords).toBeGreaterThanOrEqual(100);
    },
    120000
  );

  it(
    'детерминизм: повторный прогон с тем же seed даёт побитово тот же результат',
    () => {
      const a = runScenario({ seed: 13001, steps: 1000, dtYears: 1, includeMineral: true, rateFactor: 'random' });
      const b = runScenario({ seed: 13001, steps: 1000, dtYears: 1, includeMineral: true, rateFactor: 'random' });
      expect(JSON.stringify(a.finalEntries)).toBe(JSON.stringify(b.finalEntries));
      expect(a.fluxRecords).toBe(b.fluxRecords);
      expect(a.reactionRecords).toBe(b.reactionRecords);
      expect(a.transactions).toBe(b.transactions);
      expect(a.chargeActual).toBe(b.chargeActual);
      expect(a.appliedPhaseCount).toBe(b.appliedPhaseCount);
    },
    120000
  );

  it(
    'чувствительность к временному шагу: 500 шагов × 1 год и 1000 шагов × 0.5 года дают одинаковые элементные итоги (дробление шага не меняет результат за пределами последнего бита float)',
    () => {
      const coarse = runScenario({ seed: 777, steps: 500, dtYears: 1, includeMineral: false, rateFactor: 'constant' });
      const fine = runScenario({ seed: 777, steps: 1000, dtYears: 0.5, includeMineral: false, rateFactor: 'constant' });
      for (const element of ['C', 'Ca', 'O', 'H']) {
        expect(fine.finalTotals[element]).toBeCloseTo(coarse.finalTotals[element], 10);
      }
      expect(fine.finalCharge).toBeCloseTo(coarse.finalCharge, 10);
      expect(Math.abs(coarse.chargeActual)).toBeLessThan(1e-12);
      expect(Math.abs(fine.chargeActual)).toBeLessThan(1e-12);
    },
    120000
  );
});
