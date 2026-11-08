// ============================================
// rustWasmParity.test.ts — парити Rust/WASM и TypeScript ядер
// Stage H (Rust/WASM Performance Pilot)
// ============================================
//
// Математическая эквивалентность двух числовых ядер, перенесённых
// на Rust (rust/evowars-sim-core), и их TypeScript-оригиналов:
// - k(T): evaluateRateConstant (kinetics.ts) vs
//   evalRateConstantsRustBatch (RustSim);
// - аудит стехиометрии: auditReactionStoichiometry
//   (reactionLedger.ts) vs auditReactionStoichiometryRustBatch.
//
// Сравниваются не только числа, но и СЕМАНТИКА исходов: коды
// ошибок кинетики и ПОЛНЫЕ объекты аудита (статусы, списки,
// диагностика дословно).
//
// Самопропуск: WASM-сборка pkg-node собирается отдельно
// (npm run wasm:build, CI workflow rust-wasm-pilot). В окружении без
// неё (основной ci.yml) сьют пропускается: loadRustSimCore()
// возвращает null, describe.skip. Приложение не зависит от WASM.
//
// Допуски: контракт кинетики НЕ обещает побитовой идентичности
// между платформами (Math.pow/exp vs f64::powf/exp в libm могут
// отличаться на ulp) — значения сравниваются с относительным
// допуском 1e-12; статусы/коды — точно. Стехиометрия: порядок
// суммирования зеркалит натив (битово идентичная binary64-арифметика
// при том же порядке операций) — полная проверка toEqual аудита.

import { describe, expect, it } from 'vitest';
import {
  KineticsError,
  evaluateRateConstant
} from '../Core/kinetics';
import type {
  ArrheniusParameters,
  FallOffParameters,
  KineticReactionRecord,
  KineticsErrorCode,
  RateConstantEvaluation,
  RateConstantEvaluationOptions,
  RateConstantUnit
} from '../Core/kinetics';
import { quantity } from '../Core/physicalQuantity';
import type { PhysicalQuantity } from '../Core/physicalQuantity';
import type { DataProvenance } from '../Core/scientificValue';
import { auditReactionStoichiometry } from '../Core/reactionLedger';
import type { ReactionRecord, ReactionStoichiometryAudit } from '../Core/reactionLedger';
import { createSpeciesCatalog } from '../Core/species';
import type { ScientificSpecies, SpeciesCatalog } from '../Core/species';
import { loadRustSimCore } from '../RustSim/rustSimCore';
import type { RustSimCoreWasm } from '../RustSim/rustSimCore';
import { evalRateConstantsRustBatch } from '../RustSim/rustKinetics';
import type { RustRateConstantOutcome } from '../RustSim/rustKinetics';
import { auditReactionStoichiometryRustBatch } from '../RustSim/rustReactionAudit';

// WASM-ядро загружается асинхронно ДО регистрации тестов: сьют
// пропускается целиком, если pkg-node не собран (TLA поддержан
// module esnext + target es2023).
const wasm = await loadRustSimCore();
const core: RustSimCoreWasm = wasm as RustSimCoreWasm;
const maybe = wasm === null ? describe.skip : describe;

// --------------------------------------------
// Хелперы сравнения
// --------------------------------------------

/** Относительный допуск (контракт не обещает побитовой идентичности платформ). */
function expectRelClose(actual: number, expected: number, relTolerance = 1e-12): void {
  if (expected === 0) {
    expect(Math.abs(actual)).toBeLessThan(1e-300);
    return;
  }
  const diff = Math.abs(actual - expected) / Math.abs(expected);
  expect(diff).toBeLessThan(relTolerance);
}

type NativeKineticsOutcome =
  | { ok: true; evaluation: RateConstantEvaluation }
  | { ok: false; code: KineticsErrorCode };

function nativeKineticsOutcome(
  record: KineticReactionRecord,
  temperature: PhysicalQuantity,
  options?: RateConstantEvaluationOptions
): NativeKineticsOutcome {
  try {
    return { ok: true, evaluation: evaluateRateConstant(record, temperature, options) };
  } catch (e) {
    if (e instanceof KineticsError) {
      return { ok: false, code: e.code };
    }
    throw e;
  }
}

function expectKineticsOutcomeEquivalence(native: NativeKineticsOutcome, rust: RustRateConstantOutcome): void {
  expect(rust.ok).toBe(native.ok);
  if (!native.ok || !rust.ok) {
    expect(rust.code).toBe(native.code);
    return;
  }
  const a = native.evaluation;
  const b = rust.evaluation;
  // Семантика: единицы, модель, статусы, диапазон, происхождение.
  expect(b.unit).toBe(a.unit);
  expect(b.concentrationModel).toBe(a.concentrationModel);
  expect(b.dataStatus).toBe(a.dataStatus);
  expect(b.estimationMethod).toBe(a.estimationMethod);
  expect(b.temperatureK).toBe(a.temperatureK);
  expect(b.appliedRangeK).toEqual(a.appliedRangeK);
  expect(b.uncertainty).toEqual(a.uncertainty);
  expect(b.provenance).toEqual(a.provenance);
  // Числа: относительный допуск (см. шапку файла).
  expectRelClose(b.value, a.value);
  if (a.fallOff !== undefined || b.fallOff !== undefined) {
    expect(b.fallOff).toBeDefined();
    expect(a.fallOff).toBeDefined();
    expectRelClose(b.fallOff!.lowPressureLimit, a.fallOff!.lowPressureLimit);
    expectRelClose(b.fallOff!.highPressureLimit, a.fallOff!.highPressureLimit);
    expectRelClose(b.fallOff!.reducedPressure, a.fallOff!.reducedPressure);
    expectRelClose(b.fallOff!.log10ReducedPressure, a.fallOff!.log10ReducedPressure, 1e-9);
    expectRelClose(b.fallOff!.broadeningFactor, a.fallOff!.broadeningFactor);
  } else {
    expect(b.fallOff).toBeUndefined();
  }
}

/** Один случай кинетики: натив vs Rust по одной записи. */
function checkKineticsCase(
  record: KineticReactionRecord,
  temperature: PhysicalQuantity,
  options?: RateConstantEvaluationOptions
): void {
  const native = nativeKineticsOutcome(record, temperature, options);
  const rust = evalRateConstantsRustBatch(core, [record], [temperature], [options])[0];
  expectKineticsOutcomeEquivalence(native, rust);
}

// --------------------------------------------
// Фикстуры кинетики (зеркалят coreKinetics.test.ts)
// --------------------------------------------

function fixtureProvenance(): DataProvenance {
  return {
    sourceName: 'тестовая фикстура (фикция для тестов)',
    method: 'синтетическая кинетическая параметризация (фикция)'
  };
}

function arrhenius(
  a: number,
  n: number,
  energyOverRK: number,
  unit: RateConstantUnit,
  minK = 200,
  maxK = 2000
): ArrheniusParameters {
  return {
    preExponentialA: a,
    temperatureExponentN: n,
    energy: { form: 'E_over_R', valueK: energyOverRK },
    temperatureRangeK: { min: minK, max: maxK },
    unit,
    provenance: fixtureProvenance()
  };
}

function arrheniusEa(
  a: number,
  n: number,
  eaJPerMol: number,
  unit: RateConstantUnit
): ArrheniusParameters {
  return {
    preExponentialA: a,
    temperatureExponentN: n,
    energy: { form: 'Ea_J_mol', valueJPerMol: eaJPerMol },
    temperatureRangeK: { min: 200, max: 2000 },
    unit,
    provenance: fixtureProvenance()
  };
}

function withArrhenius(p: ArrheniusParameters): KineticReactionRecord {
  return {
    id: 'test-rxn',
    kind: 'elementary',
    overallOrder: 2,
    concentrationModel: 'molecule_cm3',
    rateConstant: { status: 'known', parameters: { kind: 'arrhenius', arrhenius: p } },
    provenance: fixtureProvenance()
  };
}

function arrheniusReaction(overrides?: Partial<ArrheniusParameters>): KineticReactionRecord {
  const base: ArrheniusParameters = {
    preExponentialA: 1e-11,
    temperatureExponentN: 0,
    energy: { form: 'E_over_R', valueK: 0 },
    temperatureRangeK: { min: 200, max: 2000 },
    unit: 'cm3_per_molecule_per_s',
    provenance: fixtureProvenance()
  };
  return withArrhenius({ ...base, ...overrides });
}

function fallOffParameters(overrides?: Partial<FallOffParameters>): FallOffParameters {
  const base: FallOffParameters = {
    lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s'),
    highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s'),
    centeringFactorFc: 0.6,
    broadeningN: 1,
    thirdBodyNote: 'M = N2 + O2 (фикция фикстуры)',
    provenance: fixtureProvenance()
  };
  return { ...base, ...overrides };
}

function fallOffReaction(params?: FallOffParameters): KineticReactionRecord {
  return {
    id: 'test-falloff-1',
    kind: 'elementary',
    overallOrder: 2,
    concentrationModel: 'molecule_cm3',
    rateConstant: { status: 'known', parameters: { kind: 'fall_off', fallOff: params ?? fallOffParameters() } },
    provenance: fixtureProvenance()
  };
}

// --------------------------------------------
// Фикстуры стехиометрии (зеркалят coreReactionLedger.test.ts)
// --------------------------------------------

function makeSpecies(overrides: Partial<ScientificSpecies> = {}): ScientificSpecies {
  return {
    id: 'h2o',
    formula: 'H2O',
    name: 'вода',
    elements: { H: 2, O: 1 },
    charge: 0,
    phase: 'gas',
    molarMassKgMol: 0.01801528,
    molarMassStatus: 'known',
    dataStatus: 'known',
    ...overrides
  };
}

function makeCatalog(): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  catalog.register(makeSpecies());
  catalog.register(makeSpecies({ id: 'h2o_liq', phase: 'liquid' }));
  catalog.register(makeSpecies({ id: 'h2', formula: 'H2', elements: { H: 2 }, molarMassKgMol: 0.002016 }));
  catalog.register(makeSpecies({ id: 'o2', formula: 'O2', elements: { O: 2 }, molarMassKgMol: 0.032 }));
  catalog.register(makeSpecies({ id: 'co2', formula: 'CO2', elements: { C: 1, O: 2 }, molarMassKgMol: 0.0440095 }));
  catalog.register(makeSpecies({ id: 'h_plus', formula: 'H+', elements: { H: 1 }, charge: 1, phase: 'aqueous' }));
  catalog.register(makeSpecies({ id: 'cat', formula: 'Fe', elements: { Fe: 1 }, molarMassKgMol: 0.055845 }));
  catalog.register(makeSpecies({ id: 'est_h2o', dataStatus: 'estimated', molarMassStatus: 'estimated' }));
  catalog.register(makeSpecies({
    id: 'declared_unknown',
    formula: 'X?',
    elements: { X: 1 },
    dataStatus: 'unknown',
    molarMassKgMol: null,
    molarMassStatus: 'unknown',
    phase: 'other'
  }));
  catalog.register(makeSpecies({
    id: 'not_impl',
    formula: 'NI',
    elements: { N: 1, I: 1 },
    dataStatus: 'not_implemented',
    molarMassKgMol: null,
    molarMassStatus: 'not_implemented',
    phase: 'other'
  }));
  // Заряженные и зарезервированные JS-ключи как обычные данные.
  catalog.register(makeSpecies({ id: 'electron', formula: 'e-', elements: {}, charge: -1, phase: 'aqueous' }));
  catalog.register(makeSpecies({ id: 'h_minus', formula: 'H-', elements: { H: 1 }, charge: -1, phase: 'aqueous' }));
  catalog.register(makeSpecies({
    id: 'weird',
    formula: 'Weird',
    // Вычисляемый ключ: собственное свойство '__proto__' как данные,
    // а не установка прототипа (литерал { __proto__: 1 } прототип
    // только меняет/игнорирует, собственного свойства не создаёт).
    elements: { ['__proto__']: 1, constructor: 2, toString: 1 },
    molarMassKgMol: null,
    molarMassStatus: 'unknown',
    phase: 'other'
  }));
  return catalog;
}

function makeRecord(overrides: Partial<ReactionRecord> = {}): ReactionRecord {
  return {
    id: 'rxn-1',
    reactionId: 'water-formation',
    reactants: [
      { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
      { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
    ],
    products: [
      { reservoirId: 'atm', speciesId: 'h2o', coefficient: 2 }
    ],
    extent: 3,
    extentBasis: 'amount',
    time: { segmentIndex: 0, localTimeS: 3600 },
    ...overrides
  };
}

function expectAuditEquivalence(
  record: ReactionRecord,
  catalog: SpeciesCatalog,
  options?: { tolerance?: number }
): ReactionStoichiometryAudit {
  const native = auditReactionStoichiometry(record, catalog, options);
  const rust = auditReactionStoichiometryRustBatch(core, [record], catalog, options)[0];
  // Полная эквивалентность: статус, списки, состав, заряд,
  // диагностика (строки дословно).
  expect(rust).toEqual(native);
  return native;
}

// --------------------------------------------
// 1. Парити k(T)
// --------------------------------------------

maybe('Rust/WASM parity: числовое ядро k(T)', () => {
  it('модифицированный Аррениус E_over_R в середине диапазона', () => {
    checkKineticsCase(arrheniusReaction(), quantity(650, 'K'));
  });

  it('Аррениус с ненулевым n и отрицательным E/R', () => {
    checkKineticsCase(
      arrheniusReaction({ preExponentialA: 3.7e-12, temperatureExponentN: 1.5, energy: { form: 'E_over_R', valueK: -500 } }),
      quantity(900, 'K')
    );
  });

  it('Аррениус с дробным отрицательным n', () => {
    checkKineticsCase(
      arrheniusReaction({ temperatureExponentN: -2.5 }),
      quantity(400, 'K')
    );
  });

  it('Аррениус с энергетическим параметром Ea в Дж/моль', () => {
    const record: KineticReactionRecord = {
      id: 'test-ea',
      kind: 'elementary',
      overallOrder: 2,
      concentrationModel: 'molecule_cm3',
      rateConstant: {
        status: 'known',
        parameters: {
          kind: 'arrhenius',
          arrhenius: arrheniusEa(2.4e-11, 0, 15000, 'cm3_per_molecule_per_s')
        }
      },
      provenance: fixtureProvenance()
    };
    checkKineticsCase(record, quantity(650, 'K'));
  });

  it('модель концентраций mol_m3 и единицы SI', () => {
    const record: KineticReactionRecord = {
      id: 'test-si',
      kind: 'elementary',
      overallOrder: 2,
      concentrationModel: 'mol_m3',
      rateConstant: {
        status: 'known',
        parameters: {
          kind: 'arrhenius',
          arrhenius: arrhenius(1.2e7, 0, 300, 'm3_per_mol_per_s')
        }
      },
      provenance: fixtureProvenance()
    };
    checkKineticsCase(record, quantity(1000, 'K'));
  });

  it('границы диапазона включительно (T = min и T = max)', () => {
    checkKineticsCase(arrheniusReaction(), quantity(200, 'K'));
    checkKineticsCase(arrheniusReaction(), quantity(2000, 'K'));
  });

  it('вне диапазона: temperature_out_of_range (снизу и сверху)', () => {
    checkKineticsCase(arrheniusReaction(), quantity(199, 'K'));
    checkKineticsCase(arrheniusReaction(), quantity(2001, 'K'));
  });

  it('estimated: dataStatus и метод оценки перенесены', () => {
    const record: KineticReactionRecord = {
      ...arrheniusReaction({ preExponentialA: 5e-11 }),
      id: 'test-estimated',
      rateConstant: {
        status: 'estimated',
        method: 'оценка по аналогии (фикция фикстуры)',
        parameters: { kind: 'arrhenius', arrhenius: arrhenius(5e-11, 0, 0, 'cm3_per_molecule_per_s') }
      }
    };
    checkKineticsCase(record, quantity(650, 'K'));
  });

  it('unknown: no_kinetic_data', () => {
    const record = {
      id: 'test-unknown',
      kind: 'overall_empirical' as const,
      overallOrder: null,
      concentrationModel: 'molecule_cm3' as const,
      rateConstant: {
        status: 'unknown' as const,
        note: 'нет данных',
        provenance: fixtureProvenance()
      }
    };
    checkKineticsCase(record, quantity(650, 'K'));
  });

  it('переполнение: A*2^2 = 4e308 → numerical_failure', () => {
    checkKineticsCase(
      arrheniusReaction({ preExponentialA: 1e308, temperatureExponentN: 2 }),
      quantity(600, 'K')
    );
  });

  it('исчезновение: exp(-1000) = 0 → numerical_failure', () => {
    checkKineticsCase(
      arrheniusReaction({ energy: { form: 'E_over_R', valueK: 300000 } }),
      quantity(300, 'K')
    );
  });

  it('некорректная температура (размерность не K) → invalid_input', () => {
    checkKineticsCase(arrheniusReaction(), quantity(650, 'Pa'));
  });

  it('некорректная запись (kind вне реестра) → invalid_input', () => {
    const broken = { ...arrheniusReaction(), kind: 'photo' } as unknown as KineticReactionRecord;
    checkKineticsCase(broken, quantity(650, 'K'));
  });

  it('fall-off: Pr = 1 (F = Fc, k = k0*M/2*Fc)', () => {
    checkKineticsCase(fallOffReaction(), quantity(650, 'K'), { thirdBodyConcentration: 5e19 });
  });

  it('fall-off: малое Pr (низкоплотностный предел)', () => {
    checkKineticsCase(fallOffReaction(), quantity(650, 'K'), { thirdBodyConcentration: 1e10 });
  });

  it('fall-off: большое Pr (высокоплотностный предел)', () => {
    checkKineticsCase(fallOffReaction(), quantity(650, 'K'), { thirdBodyConcentration: 1e30 });
  });

  it('fall-off: влияние Fc и N (несколько комбинаций)', () => {
    for (const fc of [0.3, 0.6, 1.0]) {
      for (const n of [0.5, 1.0, 2.0]) {
        checkKineticsCase(
          fallOffReaction(fallOffParameters({ centeringFactorFc: fc, broadeningN: n })),
          quantity(750, 'K'),
          { thirdBodyConcentration: 1.7e19 }
        );
      }
    }
  });

  it('fall-off: T-зависимые пределы (n ≠ 0 у k0 и k∞)', () => {
    checkKineticsCase(
      fallOffReaction(fallOffParameters({
        lowPressureLimit: arrhenius(2e-30, -1.2, 0, 'cm6_per_molecule2_per_s'),
        highPressureLimit: arrhenius(1e-10, 0.7, 0, 'cm3_per_molecule_per_s')
      })),
      quantity(850, 'K'),
      { thirdBodyConcentration: 2.4e19 }
    );
  });

  it('fall-off: пересечение диапазонов k0/k∞ в appliedRangeK', () => {
    checkKineticsCase(
      fallOffReaction(fallOffParameters({
        lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s', 250, 1500),
        highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s', 300, 1800)
      })),
      quantity(700, 'K'),
      { thirdBodyConcentration: 5e19 }
    );
  });

  it('fall-off: вне диапазона (k0) → temperature_out_of_range', () => {
    checkKineticsCase(
      fallOffReaction(fallOffParameters({
        lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s', 500, 900),
        highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s', 200, 2000)
      })),
      quantity(400, 'K'),
      { thirdBodyConcentration: 5e19 }
    );
  });

  it('fall-off без [M] → invalid_third_body', () => {
    checkKineticsCase(fallOffReaction(), quantity(650, 'K'), undefined);
  });

  it('fall-off с некорректной [M] (0, отрицательная, NaN) → invalid_third_body', () => {
    checkKineticsCase(fallOffReaction(), quantity(650, 'K'), { thirdBodyConcentration: 0 });
    checkKineticsCase(fallOffReaction(), quantity(650, 'K'), { thirdBodyConcentration: -1.5 });
    checkKineticsCase(fallOffReaction(), quantity(650, 'K'), { thirdBodyConcentration: Number.NaN });
  });

  it('аррениусовская запись с [M] → invalid_input', () => {
    checkKineticsCase(arrheniusReaction(), quantity(650, 'K'), { thirdBodyConcentration: 2.4e19 });
  });

  it('смешанный батч: исходы по индексам, порядок пре-чеков нативный', () => {
    const records: KineticReactionRecord[] = [
      arrheniusReaction(),
      arrheniusReaction(),
      fallOffReaction(),
      {
        id: 'u',
        kind: 'overall_empirical',
        overallOrder: null,
        concentrationModel: 'molecule_cm3',
        rateConstant: { status: 'unknown', provenance: fixtureProvenance() }
      },
      arrheniusReaction(),
      fallOffReaction(),
      { ...arrheniusReaction(), kind: 'photo' } as unknown as KineticReactionRecord
    ];
    const temperatures = [quantity(650, 'K'), quantity(2500, 'K'), quantity(700, 'K'), quantity(650, 'K'), quantity(300, 'K'), quantity(650, 'K'), quantity(650, 'K')];
    const options: Array<RateConstantEvaluationOptions | undefined> = [
      undefined,
      undefined,
      { thirdBodyConcentration: 5e19 },
      undefined,
      undefined,
      undefined,
      undefined
    ];
    const rust = evalRateConstantsRustBatch(core, records, temperatures, options);
    expect(rust).toHaveLength(records.length);
    for (let i = 0; i < records.length; i++) {
      expectKineticsOutcomeEquivalence(nativeKineticsOutcome(records[i], temperatures[i], options[i]), rust[i]);
    }
  });
});

// --------------------------------------------
// 2. Парити аудита стехиометрии
// --------------------------------------------

maybe('Rust/WASM parity: числовое ядро аудита стехиометрии', () => {
  it('полностью сбалансированная реакция 2H2 + O2 → 2H2O', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord(), catalog);
    expect(audit.status).toBe('balanced');
  });

  it('элементный дисбаланс: строки диагностики дословно', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      products: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 3 }]
    }), catalog);
    expect(audit.status).toBe('imbalanced');
    expect(audit.elementIssues[0]).toContain('элемент «H»');
    expect(audit.elementIssues[0]).toContain('4 слева против 6 справа');
  });

  it('зарядовый дисбаланс при согласованном элементном балансе', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      id: 'rxn-charge',
      reactionId: 'ion-recombination',
      reactants: [
        { reservoirId: 'aq', speciesId: 'h_plus', coefficient: 2 }
      ],
      products: [
        { reservoirId: 'aq', speciesId: 'h2', coefficient: 1 }
      ]
    }), catalog);
    expect(audit.status).toBe('imbalanced');
    expect(audit.elementIssues).toHaveLength(0);
    expect(audit.chargeIssues).toHaveLength(1);
    expect(audit.chargeIssues[0]).toContain('заряд: 2 слева против 0 справа');
  });

  it('зарядовый баланс с электронами (пустой состав легитимен)', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      id: 'rxn-electrons',
      reactionId: 'electron-pair',
      reactants: [
        { reservoirId: 'aq', speciesId: 'electron', coefficient: 1 },
        { reservoirId: 'ion', speciesId: 'electron', coefficient: 1 }
      ],
      products: [
        { reservoirId: 'aq', speciesId: 'electron', coefficient: 2 }
      ]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(audit.reactantElements).toEqual({});
  });

  it('estimated состав: approximate', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      id: 'rxn-est',
      reactionId: 'estimated-water',
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
      ],
      products: [
        { reservoirId: 'atm', speciesId: 'est_h2o', coefficient: 2 }
      ]
    }), catalog);
    expect(audit.status).toBe('approximate');
    expect(audit.estimatedSpecies).toEqual(['est_h2o']);
  });

  it('отсутствующий вид: not_verifiable, вклад неизвестен', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'ghost', coefficient: 1 }
      ]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.missingSpecies).toEqual(['ghost']);
  });

  it('unproven состав (статус unknown при объявленных элементах)', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      products: [
        { reservoirId: 'atm', speciesId: 'h2o', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'declared_unknown', coefficient: 1 }
      ]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toEqual(['declared_unknown']);
  });

  it('частичные численные суммы при unproven (partial issues)', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      id: 'rxn-partial',
      reactionId: 'partial-sums',
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'declared_unknown', coefficient: 1 }
      ],
      products: [
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
      ]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.reactantElements).toEqual({ H: 4 });
    expect(audit.productElements).toEqual({ O: 2 });
    expect(audit.diagnostics.some((d) => d.startsWith('расхождения вычислены'))).toBe(true);
  });

  it('несколько резервуаров одного вида: коэффициенты суммируются', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      id: 'rxn-multi',
      reactionId: 'multi-reservoir',
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
        { reservoirId: 'ocn', speciesId: 'h2', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 2 }
      ],
      products: [
        { reservoirId: 'atm', speciesId: 'h2o', coefficient: 4 }
      ]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(audit.reactantElements).toEqual({ H: 8, O: 4 });
  });

  it('катализатор (вид на обеих сторонах) сбалансирован', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      id: 'rxn-cat',
      reactionId: 'catalytic',
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'cat', coefficient: 1 }
      ],
      products: [
        { reservoirId: 'atm', speciesId: 'h2o', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'cat', coefficient: 1 }
      ]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(audit.reactantElements).toEqual({ H: 4, O: 2, Fe: 1 });
  });

  it('переполнение при конечных входах: not_verifiable, raw суммы', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      id: 'rxn-overflow',
      reactionId: 'overflow',
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 1e308 },
        { reservoirId: 'ocn', speciesId: 'h2', coefficient: 1e308 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
      ]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.reactantElements.H).toBe(Number.POSITIVE_INFINITY);
    expect(audit.diagnostics[0]).toContain('NaN или Infinity');
  });

  it('tolerance = 0: точный целочисленный баланс', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord(), catalog, { tolerance: 0 });
    expect(audit.status).toBe('balanced');
  });

  it('стандартный tolerance (по умолчанию) и пользовательский', () => {
    const catalog = makeCatalog();
    expectAuditEquivalence(makeRecord(), catalog);
    expectAuditEquivalence(makeRecord(), catalog, { tolerance: 1e-9 });
    // Численный дисбаланс меньше tolerance не фиксируется.
    const audit = expectAuditEquivalence(makeRecord({
      products: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 2 + 1e-12 }]
    }), catalog, { tolerance: 1e-6 });
    expect(audit.status).toBe('balanced');
  });

  it('некорректный tolerance (NaN, отрицательный) → invalid', () => {
    const catalog = makeCatalog();
    const nanAudit = expectAuditEquivalence(makeRecord(), catalog, { tolerance: Number.NaN });
    expect(nanAudit.status).toBe('invalid');
    const negAudit = expectAuditEquivalence(makeRecord(), catalog, { tolerance: -1 });
    expect(negAudit.status).toBe('invalid');
  });

  it('невалидная запись (дубль пары на стороне) → invalid', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
      ]
    }), catalog);
    expect(audit.status).toBe('invalid');
    expect(audit.formIssues.length).toBeGreaterThan(0);
  });

  it('зарезервированные JS-ключи элементов — обычные данные', () => {
    const catalog = makeCatalog();
    const audit = expectAuditEquivalence(makeRecord({
      id: 'rxn-weird',
      reactionId: 'weird-keys',
      reactants: [{ reservoirId: 'x', speciesId: 'weird', coefficient: 1 }],
      products: [{ reservoirId: 'x', speciesId: 'weird', coefficient: 1 }]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(Object.keys(audit.reactantElements).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(audit.reactantElements.__proto__).toBe(1);
  });

  it('смешанный batch аудита: индексная целостность и парити каждого', () => {
    const catalog = makeCatalog();
    const records: ReactionRecord[] = [
      makeRecord(),
      makeRecord({ id: 'rxn-b', products: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 3 }] }),
      makeRecord({ id: 'rxn-c', reactants: [{ reservoirId: 'atm', speciesId: 'ghost', coefficient: 1 }] }),
      makeRecord({
        id: 'rxn-d',
        reactants: [
          { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 },
          { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 }
        ]
      }),
      makeRecord({
        id: 'rxn-e',
        reactants: [{ reservoirId: 'atm', speciesId: 'h2', coefficient: 2 }, { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }],
        products: [{ reservoirId: 'atm', speciesId: 'est_h2o', coefficient: 2 }]
      })
    ];
    const native = records.map((r) => auditReactionStoichiometry(r, catalog));
    const rust = auditReactionStoichiometryRustBatch(core, records, catalog);
    expect(rust).toHaveLength(records.length);
    for (let i = 0; i < records.length; i++) {
      expect(rust[i]).toEqual(native[i]);
    }
    expect(rust.map((a) => a.status)).toEqual([
      'balanced',
      'imbalanced',
      'not_verifiable',
      'invalid',
      'approximate'
    ]);
  });
});
