// ============================================
// coreKinetics.test.ts — тесты контрактов и вычислителя k(T)
// Stage 4.5.1 + 4.5.2
// ============================================
//
// Проверяемое: реестры единиц k и согласование порядок↔единица↔модель;
// валидатор записей (структурный контракт, согласование, диапазоны,
// Fc/N, пересечения); вычислитель k(T) — модифицированный Аррениус
// (внутри диапазона, на границах, отказ вне диапазона, unknown,
// estimated, неинтерпретируемые значения, перенос неопределённости);
// fall-off (Pr=1, низкоплотностный предел, вклад Fc и N,
// T-зависимые пределы, обязательность [M], пересечение диапазонов);
// преобразования molecule↔mol на точной N_A (Лошмидт-контроль);
// преобразования единиц k (порядки 2/3, инвариант скорости,
// отказ при несопоставимых порядках); детерминированность.
//
// ВАЖНО: числовые параметры фикстур — СИНТЕТИЧЕСКИЕ, они проверяют
// МАТЕМАТИКУ контракта, а не достоверность реальных констант. Реальные
// данные JPL Evaluation No. 20 (JPL Publication 25-1, DOI
// 10.48577/jpl.KFQ0TZ) появляются в 4.5.4 с per-record сверкой по
// таблицам публикации и в эти тесты не подмешиваются.

import { describe, expect, it } from 'vitest';
import type { PhysicalQuantity } from '../Core/physicalQuantity';
import { quantity } from '../Core/physicalQuantity';
import type { DataProvenance, Uncertainty } from '../Core/scientificValue';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';
import type {
  ArrheniusParameters,
  ConcentrationModel,
  FallOffParameters,
  KineticReactionRecord,
  RateConstantUnit
} from '../Core/kinetics';
import {
  AVOGADRO_NUMBER_PER_MOL,
  ARRHENIUS_REFERENCE_TEMPERATURE_K,
  CONCENTRATION_MODELS,
  KINETIC_REACTION_KINDS,
  RATE_CONSTANT_UNITS,
  convertConcentration,
  convertRateConstantUnit,
  evaluateRateConstant,
  rateConstantUnitForOrder,
  validateKineticReactionRecord
} from '../Core/kinetics';
import { KineticsError } from '../Core/kinetics';

const R = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
const NA = AVOGADRO_NUMBER_PER_MOL;
const TREF = ARRHENIUS_REFERENCE_TEMPERATURE_K;

// --------------------------------------------
// Хелперы фикстур
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
  unit: RateConstantUnit,
  minK = 200,
  maxK = 2000
): ArrheniusParameters {
  return {
    preExponentialA: a,
    temperatureExponentN: n,
    energy: { form: 'Ea_J_mol', valueJPerMol: eaJPerMol },
    temperatureRangeK: { min: minK, max: maxK },
    unit,
    provenance: fixtureProvenance()
  };
}

function withArrhenius(
  p: ArrheniusParameters,
  order = 2,
  model: ConcentrationModel = 'molecule_cm3',
  id = 'test-rxn'
): KineticReactionRecord {
  return {
    id,
    kind: 'elementary',
    overallOrder: order,
    concentrationModel: model,
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

/** Вызывает fn, ожидает KineticsError; НЕ бросает, а возвращает пойманную ошибку. */
function kineticsError(fn: () => unknown): KineticsError {
  try {
    fn();
  } catch (e) {
    if (e instanceof KineticsError) {
      return e;
    }
    throw new Error(`ожидалась KineticsError, получено: ${String(e)}`);
  }
  throw new Error('ожидалась KineticsError, вызов прошёл без ошибки');
}

/** Проверяет, что валидатор находит проблему, содержащую фрагмент текста. */
function expectProblem(record: unknown, fragment: string): void {
  const problems = validateKineticReactionRecord(record);
  expect(problems.some((p) => p.includes(fragment))).toBe(true);
}

// --------------------------------------------
// 1. Реестры единиц k и согласование
// --------------------------------------------

describe('реестр единиц константы скорости', () => {
  it('перечисляет все 5 единиц без дублей', () => {
    expect(RATE_CONSTANT_UNITS).toHaveLength(5);
    expect(new Set(RATE_CONSTANT_UNITS).size).toBe(5);
  });

  it('rateConstantUnitForOrder: порядок 1 → per_s для обеих моделей', () => {
    expect(rateConstantUnitForOrder(1, 'molecule_cm3')).toBe('per_s');
    expect(rateConstantUnitForOrder(1, 'mol_m3')).toBe('per_s');
  });

  it('rateConstantUnitForOrder: порядок 2 → cm3/m3 по модели', () => {
    expect(rateConstantUnitForOrder(2, 'molecule_cm3')).toBe('cm3_per_molecule_per_s');
    expect(rateConstantUnitForOrder(2, 'mol_m3')).toBe('m3_per_mol_per_s');
  });

  it('rateConstantUnitForOrder: порядок 3 → cm6/m6 по модели', () => {
    expect(rateConstantUnitForOrder(3, 'molecule_cm3')).toBe('cm6_per_molecule2_per_s');
    expect(rateConstantUnitForOrder(3, 'mol_m3')).toBe('m6_per_mol2_per_s');
  });

  it('rateConstantUnitForOrder: null вне порядков 1..3', () => {
    expect(rateConstantUnitForOrder(0, 'molecule_cm3')).toBeNull();
    expect(rateConstantUnitForOrder(4, 'mol_m3')).toBeNull();
    expect(rateConstantUnitForOrder(1.5, 'molecule_cm3')).toBeNull();
    expect(rateConstantUnitForOrder(Number.NaN, 'mol_m3')).toBeNull();
  });

  it('реестры классов и моделей непустые и без дублей', () => {
    expect(KINETIC_REACTION_KINDS).toHaveLength(2);
    expect(CONCENTRATION_MODELS).toHaveLength(2);
  });
});

// --------------------------------------------
// 2. Валидатор записей
// --------------------------------------------

describe('валидатор кинетических записей', () => {
  it('принимает корректную аррениусовскую запись', () => {
    expect(validateKineticReactionRecord(arrheniusReaction())).toEqual([]);
  });

  it('принимает корректную fall-off запись', () => {
    expect(validateKineticReactionRecord(fallOffReaction())).toEqual([]);
  });

  it('принимает unknown-запись с null-порядком (порядок не нужен для «не рассчитано»)', () => {
    const record: KineticReactionRecord = {
      id: 'test-unknown',
      kind: 'overall_empirical',
      overallOrder: null,
      concentrationModel: 'molecule_cm3',
      rateConstant: {
        status: 'unknown',
        note: 'нет данных в JPL Evaluation No. 20',
        provenance: fixtureProvenance()
      }
    };
    expect(validateKineticReactionRecord(record)).toEqual([]);
  });

  it('отвергает не-объект', () => {
    const problems = validateKineticReactionRecord('не запись');
    expect(problems.some((p) => p.includes('объектом'))).toBe(true);
  });

  it('отвергает пустой id', () => {
    expectProblem({ ...arrheniusReaction(), id: '' }, 'id');
  });

  it('отвергает неизвестный kind', () => {
    expectProblem({ ...arrheniusReaction(), kind: 'photo' }, 'kind');
  });

  it('отвергает неизвестную модель концентраций', () => {
    expectProblem({ ...arrheniusReaction(), concentrationModel: 'ppm' }, 'concentrationModel');
  });

  it('отвергает null-порядок при known-константе', () => {
    expectProblem({ ...arrheniusReaction(), overallOrder: null }, 'overallOrder');
  });

  it('отвергает порядок 4 (вне реестра единиц)', () => {
    expectProblem({ ...arrheniusReaction(), overallOrder: 4 }, 'порядки 1..3');
  });

  it('отвергает дробный порядок 1.5', () => {
    expectProblem({ ...arrheniusReaction(), overallOrder: 1.5 }, 'порядки 1..3');
  });

  it('отвергает неположительную предэкспоненту A', () => {
    expectProblem(arrheniusReaction({ preExponentialA: 0 }), 'A');
  });

  it('отвергает NaN-показатель n', () => {
    expectProblem(arrheniusReaction({ temperatureExponentN: Number.NaN }), 'n');
  });

  it('отвергает неизвестную форму энергетического параметра', () => {
    expectProblem(
      arrheniusReaction({ energy: { form: 'kcal', valueK: 500 } as unknown as ArrheniusParameters['energy'] }),
      'E_over_R | Ea_J_mol'
    );
  });

  it('отвергает NaN в valueK', () => {
    expectProblem(arrheniusReaction({ energy: { form: 'E_over_R', valueK: Number.NaN } }), 'valueK');
  });

  it('отвергает вырожденный диапазон применимости', () => {
    expectProblem(arrheniusReaction({ temperatureRangeK: { min: 0, max: 0 } }), '0 < min < max');
  });

  it('отвергает единицу порядка 1 при заявленном порядке 2', () => {
    expectProblem(arrheniusReaction({ unit: 'per_s' }), 'отнесена к порядку 1');
  });

  it('отвергает единицу molecule_cm3 при модели mol_m3', () => {
    expectProblem(withArrhenius(arrhenius(1e-13, 0, 0, 'cm3_per_molecule_per_s'), 2, 'mol_m3'), 'модель концентраций');
  });

  it('отвергает единицу вне кинетического реестра', () => {
    expectProblem(arrheniusReaction({ unit: 'knots' as unknown as RateConstantUnit }), 'кинетического реестра');
  });

  it('отвергает estimated без метода (оценка без метода безследна)', () => {
    const estimatedNoMethod = {
      ...arrheniusReaction(),
      rateConstant: {
        status: 'estimated',
        method: '',
        parameters: { kind: 'arrhenius', arrhenius: arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s') }
      }
    };
    expectProblem(estimatedNoMethod, 'method');
  });

  it('отвергает known без parameters', () => {
    expectProblem(
      { ...arrheniusReaction(), rateConstant: { status: 'known' } },
      'parameters обязателен'
    );
  });

  it('отвергает неизвестный статус константы', () => {
    expectProblem(
      { ...arrheniusReaction(), rateConstant: { status: 'guessed' } },
      'known | estimated | unknown'
    );
  });

  it('отвергает неизвестный kind неопределённости (validateUncertainty молча пропускает)', () => {
    const badUncertainty = { kind: 'vibes', fraction: 0.25 } as unknown as Uncertainty;
    expectProblem(arrheniusReaction({ uncertainty: badUncertainty }), 'interval | stddev | relative | bounded');
  });

  it('отвергает отрицательную относительную неопределённость', () => {
    const badUncertainty: Uncertainty = { kind: 'relative', fraction: -0.1 };
    expectProblem(arrheniusReaction({ uncertainty: badUncertainty }), 'относительная неопределённость');
  });

  it('отвергает отсутствующий provenance параметров (константа без источника не используется)', () => {
    const p = arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s');
    delete (p as Partial<ArrheniusParameters>).provenance;
    expectProblem(withArrhenius(p), 'provenance обязателен');
  });

  it('отвергает k0 с единицей порядка 2 (должен быть порядок overallOrder + 1)', () => {
    expectProblem(
      fallOffReaction(fallOffParameters({ lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm3_per_molecule_per_s') })),
      'rateConstant.fallOff.k0'
    );
  });

  it('отвергает Fc вне (0, 1]', () => {
    expectProblem(fallOffReaction(fallOffParameters({ centeringFactorFc: 0 })), 'Fc');
    expectProblem(fallOffReaction(fallOffParameters({ centeringFactorFc: 1.2 })), 'Fc');
  });

  it('отвергает неположительный N', () => {
    expectProblem(fallOffReaction(fallOffParameters({ broadeningN: 0 })), 'N');
  });

  it('отвергает непересекающиеся диапазоны k0/k∞ (применимых температур нет)', () => {
    expectProblem(
      fallOffReaction(
        fallOffParameters({
          lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s', 200, 400),
          highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s', 500, 700)
        })
      ),
      'не пересекаются'
    );
  });

  it('отвергает fall-off запись порядка 3 (k0 потребовал бы порядок 4)', () => {
    expectProblem({ ...fallOffReaction(), overallOrder: 3 }, 'вне реестра (1..3)');
  });
});

// --------------------------------------------
// 3. Вычислитель k(T): модифицированный Аррениус
// --------------------------------------------

describe('вычислитель k(T): аррениусовские записи', () => {
  it('T=300, n=0, E/R=0 → k = A точно', () => {
    const k = evaluateRateConstant(arrheniusReaction({ preExponentialA: 1e-11 }), quantity(300, 'K'));
    expect(k.value).toBe(1e-11);
    expect(k.unit).toBe('cm3_per_molecule_per_s');
    expect(k.dataStatus).toBe('known');
  });

  it('n≠0 и E/R≠0: k(600) = 3.5e-12·(600/300)^2·exp(−500/600) — отношением', () => {
    const k = evaluateRateConstant(
      arrheniusReaction({ preExponentialA: 3.5e-12, temperatureExponentN: 2, energy: { form: 'E_over_R', valueK: 500 } }),
      quantity(600, 'K')
    );
    const expected = 3.5e-12 * Math.pow(600 / TREF, 2) * Math.exp(-500 / 600);
    expect(k.value / expected).toBeCloseTo(1, 12);
  });

  it('эквивалентность форм E/R = 970 K и Ea = 970·R Дж/моль при 500 K', () => {
    const kER = evaluateRateConstant(arrheniusReaction({ energy: { form: 'E_over_R', valueK: 970 } }), quantity(500, 'K'));
    const kEa = evaluateRateConstant(
      arrheniusReaction({ energy: { form: 'Ea_J_mol', valueJPerMol: 970 * R } }),
      quantity(500, 'K')
    );
    expect(kER.value / kEa.value).toBeCloseTo(1, 12);
  });

  it('отрицательный E/R: k растёт с температурой (барьер отталкивания)', () => {
    const cold = evaluateRateConstant(
      arrheniusReaction({ energy: { form: 'E_over_R', valueK: -1000 } }),
      quantity(250, 'K')
    );
    const hot = evaluateRateConstant(
      arrheniusReaction({ energy: { form: 'E_over_R', valueK: -1000 } }),
      quantity(350, 'K')
    );
    expect(hot.value / cold.value).toBeGreaterThan(1);
  });

  it('положительный E/R: k убывает с температурой (exp(+|E|/RT) → 1 при росте T)', () => {
    const cold = evaluateRateConstant(
      arrheniusReaction({ energy: { form: 'E_over_R', valueK: 1000 } }),
      quantity(250, 'K')
    );
    const hot = evaluateRateConstant(
      arrheniusReaction({ energy: { form: 'E_over_R', valueK: 1000 } }),
      quantity(350, 'K')
    );
    expect(hot.value / cold.value).toBeLessThan(1);
  });

  it('границы диапазона применимости включаются', () => {
    expect(evaluateRateConstant(arrheniusReaction(), quantity(200, 'K')).value).toBe(1e-11);
    expect(evaluateRateConstant(arrheniusReaction(), quantity(2000, 'K')).value).toBe(1e-11);
  });

  it('вне диапазона — отказ temperature_out_of_range с границами в сообщении', () => {
    const e = kineticsError(() => evaluateRateConstant(arrheniusReaction(), quantity(249.999, 'K')));
    expect(e.code).toBe('temperature_out_of_range');
    expect(e.message).toContain('экстраполяция запрещена');
    const e2 = kineticsError(() => evaluateRateConstant(arrheniusReaction(), quantity(2000.001, 'K')));
    expect(e2.code).toBe('temperature_out_of_range');
  });

  it('NaN-температура — invalid_input', () => {
    const e = kineticsError(() =>
      evaluateRateConstant(arrheniusReaction(), { value: Number.NaN, unit: 'K' } as PhysicalQuantity)
    );
    expect(e.code).toBe('invalid_input');
  });

  it('отрицательная температура — invalid_input (K обязан быть положительным)', () => {
    const e = kineticsError(() => evaluateRateConstant(arrheniusReaction(), quantity(-5, 'K')));
    expect(e.code).toBe('invalid_input');
    expect(e.message).toContain('положительной');
  });

  it('не-температурная единица — invalid_input', () => {
    const e = kineticsError(() =>
      evaluateRateConstant(arrheniusReaction(), { value: 300, unit: 'Pa' } as unknown as PhysicalQuantity)
    );
    expect(e.code).toBe('invalid_input');
    expect(e.message).toContain('кельвина');
  });

  it('null-температура — invalid_input', () => {
    const e = kineticsError(() => evaluateRateConstant(arrheniusReaction(), null as unknown as PhysicalQuantity));
    expect(e.code).toBe('invalid_input');
  });

  it('повреждённая запись — invalid_input с деталями (overallOrder null при known)', () => {
    const e = kineticsError(() =>
      evaluateRateConstant({ ...arrheniusReaction(), overallOrder: null }, quantity(300, 'K'))
    );
    expect(e.code).toBe('invalid_input');
    expect(e.details).toContain('overallOrder');
  });

  it('unknown-константа → no_kinetic_data «не рассчитана» с note', () => {
    const record: KineticReactionRecord = {
      id: 'test-unknown',
      kind: 'overall_empirical',
      overallOrder: null,
      concentrationModel: 'molecule_cm3',
      rateConstant: { status: 'unknown', note: 'нет данных в источнике' }
    };
    const e = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
    expect(e.code).toBe('no_kinetic_data');
    expect(e.message).toContain('не рассчитана');
    expect(e.message).toContain('нет данных в источнике');
  });

  it('estimated → статус и метод переносятся в результат', () => {
    const record: KineticReactionRecord = {
      ...withArrhenius(arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s')),
      rateConstant: {
        status: 'estimated',
        method: 'оценка по аналогии с реакцией того же класса',
        parameters: { kind: 'arrhenius', arrhenius: arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s') }
      }
    };
    const k = evaluateRateConstant(record, quantity(300, 'K'));
    expect(k.dataStatus).toBe('estimated');
    expect(k.estimationMethod).toContain('аналогии');
  });

  it('экстремальный E/R → exp уходит в 0 → numerical_failure (не молчаливый ноль)', () => {
    const e = kineticsError(() =>
      evaluateRateConstant(
        arrheniusReaction({ energy: { form: 'E_over_R', valueK: 1e9 } }),
        quantity(300, 'K')
      )
    );
    expect(e.code).toBe('numerical_failure');
  });

  it('thirdBodyConcentration для аррениусовской записи — invalid_input (запись не зависит от давления)', () => {
    const e = kineticsError(() =>
      evaluateRateConstant(arrheniusReaction(), quantity(300, 'K'), { thirdBodyConcentration: 2.5e19 })
    );
    expect(e.code).toBe('invalid_input');
    expect(e.message).toContain('не зависит от давления');
  });

  it('неопределённость и provenance переносятся в результат', () => {
    const uncertainty: Uncertainty = { kind: 'relative', fraction: 0.25 };
    const k = evaluateRateConstant(
      arrheniusReaction({ uncertainty, provenance: { sourceName: 'фикстура' } }),
      quantity(300, 'K')
    );
    expect(k.uncertainty).toEqual(uncertainty);
    expect(k.provenance?.sourceName).toBe('фикстура');
  });

  it('appliedRangeK совпадает с диапазоном записи', () => {
    const k = evaluateRateConstant(arrheniusReaction(), quantity(300, 'K'));
    expect(k.appliedRangeK).toEqual({ min: 200, max: 2000 });
    expect(k.temperatureK).toBe(300);
    expect(k.concentrationModel).toBe('molecule_cm3');
  });
});

// --------------------------------------------
// 4. Вычислитель k([M],T): fall-off
// --------------------------------------------

describe('вычислитель k(T): fall-off записи', () => {
  it('Pr=1: k = k∞·(1/2)·Fc, приведённое давление и вклады диагностируются', () => {
    // [M] = k∞/k0 = 1e-10/2e-30 = 5e19 molecule/cm³ → Pr = 1
    const k = evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: 5e19 });
    const expected = (1e-10 * 0.6) / 2;
    expect(k.value / expected).toBeCloseTo(1, 12);
    expect(k.fallOff?.reducedPressure).toBeCloseTo(1, 12);
    expect(k.fallOff?.log10ReducedPressure).toBeCloseTo(0, 12);
    expect(k.fallOff?.broadeningFactor).toBeCloseTo(0.6, 12);
    expect(k.fallOff?.lowPressureLimit).toBe(2e-30);
    expect(k.fallOff?.highPressureLimit).toBe(1e-10);
    expect(k.unit).toBe('cm3_per_molecule_per_s');
    expect(k.appliedRangeK).toEqual({ min: 200, max: 2000 });
  });

  it('низкоплотностный предел: k → k0·[M]·F (Lindemann-ядро при Pr≪1)', () => {
    const M = 1e10;
    const pr = (2e-30 * M) / 1e-10;
    const f = Math.pow(0.6, 1 / (1 + Math.log10(pr) ** 2));
    const k = evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: M });
    const expected = (2e-30 * M * f) / (1 + pr);
    expect(k.value / expected).toBeCloseTo(1, 12);
    expect(k.fallOff?.reducedPressure).toBeCloseTo(pr, 12);
  });

  it('центрирующий фактор Fc управляет высотой уширения (0.6 vs 0.5 при Pr=1)', () => {
    const k06 = evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: 5e19 });
    const k05 = evaluateRateConstant(
      fallOffReaction(fallOffParameters({ centeringFactorFc: 0.5 })),
      quantity(300, 'K'),
      { thirdBodyConcentration: 5e19 }
    );
    expect(k05.value / k06.value).toBeCloseTo(0.5 / 0.6, 12);
  });

  it('параметр N управляет шириной уширения (N=1 vs N=2 при Pr=0.01)', () => {
    const M = 5e17; // Pr = 2e-30·5e17/1e-10 = 0.01
    const f1 = Math.pow(0.6, 1 / (1 + Math.log10(0.01) ** 2));
    const f2 = Math.pow(0.6, 1 / (1 + (Math.log10(0.01) / 2) ** 2));
    const k1 = evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: M });
    const k2 = evaluateRateConstant(
      fallOffReaction(fallOffParameters({ broadeningN: 2 })),
      quantity(300, 'K'),
      { thirdBodyConcentration: M }
    );
    expect(k1.fallOff?.broadeningFactor).toBeCloseTo(f1, 12);
    expect(k2.fallOff?.broadeningFactor).toBeCloseTo(f2, 12);
    expect(f2 / f1).not.toBeCloseTo(1, 5);
  });

  it('T-зависимые пределы: k0 и k∞ вычисляются по своим (A, n, E/R) при 600 K', () => {
    const params = fallOffParameters({
      lowPressureLimit: arrhenius(2e-30, 1, 200, 'cm6_per_molecule2_per_s'),
      highPressureLimit: arrhenius(1e-10, -1, 100, 'cm3_per_molecule_per_s')
    });
    const M = 1e20;
    const k = evaluateRateConstant(fallOffReaction(params), quantity(600, 'K'), { thirdBodyConcentration: M });
    const k0 = 2e-30 * Math.pow(600 / TREF, 1) * Math.exp(-200 / 600);
    const kInf = 1e-10 * Math.pow(600 / TREF, -1) * Math.exp(-100 / 600);
    const pr = (k0 * M) / kInf;
    const f = Math.pow(0.6, 1 / (1 + Math.log10(pr) ** 2));
    const expected = kInf * (pr / (1 + pr)) * f;
    expect(k.value / expected).toBeCloseTo(1, 12);
    expect(k.fallOff?.lowPressureLimit).toBeCloseTo(k0, 12);
    expect(k.fallOff?.highPressureLimit).toBeCloseTo(kInf, 12);
  });

  it('отсутствующая [M] — invalid_third_body', () => {
    const e = kineticsError(() => evaluateRateConstant(fallOffReaction(), quantity(300, 'K')));
    expect(e.code).toBe('invalid_third_body');
  });

  it('нулевая/отрицательная/NaN [M] — invalid_third_body', () => {
    expect(kineticsError(() => evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: 0 })).code).toBe('invalid_third_body');
    expect(kineticsError(() => evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: -1 })).code).toBe('invalid_third_body');
    expect(kineticsError(() => evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: Number.NaN })).code).toBe('invalid_third_body');
  });

  it('вне пересечения диапазонов k0/k∞ — temperature_out_of_range', () => {
    const params = fallOffParameters({
      lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s', 200, 400),
      highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s', 300, 500)
    });
    const record = fallOffReaction(params);
    const cold = kineticsError(() => evaluateRateConstant(record, quantity(250, 'K'), { thirdBodyConcentration: 1e19 }));
    expect(cold.code).toBe('temperature_out_of_range');
    const hot = kineticsError(() => evaluateRateConstant(record, quantity(450, 'K'), { thirdBodyConcentration: 1e19 }));
    expect(hot.code).toBe('temperature_out_of_range');
    const ok = evaluateRateConstant(record, quantity(350, 'K'), { thirdBodyConcentration: 1e19 });
    expect(ok.appliedRangeK).toEqual({ min: 300, max: 400 });
  });

  it('результат fall-off: единица k∞, uncertainty не выдумывается, статус known', () => {
    const k = evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: 5e19 });
    expect(k.unit).toBe('cm3_per_molecule_per_s');
    expect(k.uncertainty).toBeUndefined();
    expect(k.dataStatus).toBe('known');
  });
});

// --------------------------------------------
// 5. Преобразования концентраций molecule ↔ mol
// --------------------------------------------

describe('преобразование концентраций', () => {
  it('1 molecule/cm³ = 1e6/N_A моль/м³', () => {
    expect(convertConcentration(1, 'molecule_cm3', 'mol_m3')).toBeCloseTo(1e6 / NA, 12);
  });

  it('round-trip molecule → mol → molecule возвращает исходное значение', () => {
    const v = 3.7e16;
    const round = convertConcentration(convertConcentration(v, 'molecule_cm3', 'mol_m3'), 'mol_m3', 'molecule_cm3');
    expect(round / v).toBeCloseTo(1, 12);
  });

  it('число Лошмидта: 2.687e19 molecule/cm³ ≈ 44.6 моль/м³', () => {
    expect(convertConcentration(2.687e19, 'molecule_cm3', 'mol_m3')).toBeCloseTo(44.6, 1);
  });

  it('NaN и неизвестные модели — invalid_input', () => {
    expect(kineticsError(() => convertConcentration(Number.NaN, 'molecule_cm3', 'mol_m3')).code).toBe('invalid_input');
    expect(
      kineticsError(() => convertConcentration(1, 'ppm' as unknown as ConcentrationModel, 'mol_m3')).code
    ).toBe('invalid_input');
  });
});

// --------------------------------------------
// 6. Преобразования единиц k
// --------------------------------------------

describe('преобразование единиц константы скорости', () => {
  it('порядок 2: 1 cm³/(molecule·s) = N_A·1e-6 м³/(моль·с)', () => {
    expect(convertRateConstantUnit(1, 'cm3_per_molecule_per_s', 'm3_per_mol_per_s')).toBeCloseTo(NA * 1e-6, 6);
  });

  it('порядок 2: round-trip', () => {
    const v = 1.3e-11;
    const round = convertRateConstantUnit(
      convertRateConstantUnit(v, 'cm3_per_molecule_per_s', 'm3_per_mol_per_s'),
      'm3_per_mol_per_s',
      'cm3_per_molecule_per_s'
    );
    expect(round / v).toBeCloseTo(1, 12);
  });

  it('порядок 3: 1 cm⁶/(molecule²·s) = N_A²·1e-12 м⁶/(моль²·с)', () => {
    expect(convertRateConstantUnit(1, 'cm6_per_molecule2_per_s', 'm6_per_mol2_per_s')).toBeCloseTo(NA * NA * 1e-12, 6);
  });

  it('порядок 3: round-trip', () => {
    const v = 5.5e-29;
    const round = convertRateConstantUnit(
      convertRateConstantUnit(v, 'cm6_per_molecule2_per_s', 'm6_per_mol2_per_s'),
      'm6_per_mol2_per_s',
      'cm6_per_molecule2_per_s'
    );
    expect(round / v).toBeCloseTo(1, 12);
  });

  it('инвариант скорости: k(mol)·[X](mol)² = k(molecule)·[X](molecule)² при одном порядке', () => {
    const kMolecule = 2.5e-11;
    const concMolecule = 4.2e18;
    const kMol = convertRateConstantUnit(kMolecule, 'cm3_per_molecule_per_s', 'm3_per_mol_per_s');
    const concMol = convertConcentration(concMolecule, 'molecule_cm3', 'mol_m3');
    const rateMol = kMol * concMol * concMol;
    const rateMolecule = kMolecule * concMolecule * concMolecule;
    // скорость в mol/(м³·с) = скорость в molecule/(cm³·s) · (1e6/N_A)
    expect((rateMol / rateMolecule) / (1e6 / NA)).toBeCloseTo(1, 12);
  });

  it('порядок 1: per_s → per_s — тождество', () => {
    expect(convertRateConstantUnit(0.73, 'per_s', 'per_s')).toBe(0.73);
  });

  it('разные порядки — invalid_input (порядок не преобразуется)', () => {
    expect(
      kineticsError(() => convertRateConstantUnit(1, 'per_s', 'm3_per_mol_per_s')).code
    ).toBe('invalid_input');
  });

  it('NaN и единицы вне реестра — invalid_input', () => {
    expect(kineticsError(() => convertRateConstantUnit(Number.NaN, 'per_s', 'per_s')).code).toBe('invalid_input');
    expect(
      kineticsError(() => convertRateConstantUnit(1, 'parsec' as unknown as RateConstantUnit, 'per_s')).code
    ).toBe('invalid_input');
  });
});

// --------------------------------------------
// 7. Детерминированность
// --------------------------------------------

describe('детерминированность', () => {
  it('повторный вызов fall-off даёт идентичный результат', () => {
    const record = fallOffReaction();
    const options = { thirdBodyConcentration: 2.4e19 };
    const a = evaluateRateConstant(record, quantity(650, 'K'), options);
    const b = evaluateRateConstant(record, quantity(650, 'K'), options);
    expect(b).toEqual(a);
  });

  it('вычисление не мутирует запись и опции', () => {
    const record = fallOffReaction();
    const options = { thirdBodyConcentration: 2.4e19 };
    const recordBefore = JSON.stringify(record);
    const optionsBefore = JSON.stringify(options);
    evaluateRateConstant(record, quantity(650, 'K'), options);
    expect(JSON.stringify(record)).toBe(recordBefore);
    expect(JSON.stringify(options)).toBe(optionsBefore);
  });
});
