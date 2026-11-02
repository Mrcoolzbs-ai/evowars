// ============================================
// STAGE 4.5.1 + 4.5.2 - Тесты контрактов и вычислителя
// констант скорости реакций
// ============================================
//
// Проверяются требования подэтапов 4.5.1/4.5.2 (дорожная карта §4.5,
// CHEMISTRY_ARCHITECTURE §4):
// - реестры и согласование «порядок ↔ модель концентраций ↔ единица k»;
// - валидатор записей: повреждённые и не согласованные данные —
//   список проблем, а не молчаливое принятие;
// - аналитические значения формы Аррениуса (включая эквивалентность
//   форм E/R и Ea = R·(E/R)) и границы диапазонов применимости;
// - fall-off: аналитическая точка Pr = 1 (k = k∞·Fc/2), низкоплотностный
//   предел, явные Fc/N записи, пересечение диапазонов k0/k∞,
//   обязательность и положительность [M];
// - преобразования molecule ↔ mol на ТОЧНОЙ N_A (SI 2019);
// - fail-closed: unknown → no_kinetic_data «не рассчитано»; вне
//   диапазона → temperature_out_of_range; повреждённый вход →
//   invalid_input; переполнение/исчезновение → numerical_failure —
//   никогда не фиктивная скорость и не NaN;
// - детерминированность и отсутствие мутаций входа.
//
// Параметры фикстур — СИНТЕТИЧЕСКИЕ: они проверяют математику
// контракта, а НЕ реальные кинетические данные. Реальные записи JPL
// Evaluation No. 20 (JPL Publication 25-1, 2025, DOI
// 10.48577/jpl.KFQ0TZ) появятся в каталоге 4.5.4 с per-record сверкой
// по таблицам публикации; тесты достоверности самих чисел — там же.

import { describe, it, expect } from 'vitest';
import { quantity } from '../Core/physicalQuantity';
import type { PhysicalQuantity } from '../Core/physicalQuantity';
import type { DataProvenance } from '../Core/scientificValue';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';
import {
  AVOGADRO_NUMBER_PER_MOL,
  ARRHENIUS_REFERENCE_TEMPERATURE_K,
  KINETIC_REACTION_KINDS,
  CONCENTRATION_MODELS,
  RATE_CONSTANT_UNITS,
  rateConstantUnitForOrder,
  validateKineticReactionRecord,
  evaluateRateConstant,
  convertConcentration,
  convertRateConstantUnit,
  KineticsError
} from '../Core/kinetics';
import type {
  KineticReactionRecord,
  ArrheniusParameters,
  FallOffParameters,
  ConcentrationModel
} from '../Core/kinetics';

const R = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
const NA = AVOGADRO_NUMBER_PER_MOL;
const TREF = ARRHENIUS_REFERENCE_TEMPERATURE_K;

/** Синтетический provenance для фикстур (не реальные данные). */
function fixtureProvenance(): DataProvenance {
  return {
    sourceName: 'тестовая фикстура (фикция для тестов)',
    method: 'синтетическая кинетическая параметризация (фикция)'
  };
}

/** Синтетические параметры Аррениуса (форма E/R). */
function arrhenius(
  a: number,
  n: number,
  energyOverRK: number,
  unit: ArrheniusParameters['unit'],
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

/** Синтетические параметры Аррениуса (классическая форма Ea, Дж/моль). */
function arrheniusEa(
  a: number,
  n: number,
  eaJPerMol: number,
  unit: ArrheniusParameters['unit'],
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

/** Запись реакции с аррениусовской константой (порядок 2, molecule_cm3). */
function withArrhenius(
  p: ArrheniusParameters,
  order: KineticReactionRecord['overallOrder'] = 2,
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

/** Базовая аррениусовская запись: A = 1e-11, n = 0, E/R = 0, 200–2000 K. */
function arrheniusReaction(overrides?: Partial<KineticReactionRecord>): KineticReactionRecord {
  const base = withArrhenius(arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s'), 2, 'molecule_cm3', 'test-rxn-1');
  return { ...base, ...overrides };
}

/** Синтетические параметры fall-off: k0 = 2e-30, k∞ = 1e-10 (константы T), Fc = 0.6, N = 1. */
function fallOffParameters(overrides?: Partial<FallOffParameters>): FallOffParameters {
  const base: FallOffParameters = {
    lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s'),
    highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s'),
    centeringFactorFc: 0.6,
    broadeningN: 1,
    thirdBodyNote: 'синтетическое третье тело (фикция)',
    provenance: fixtureProvenance()
  };
  return { ...base, ...overrides };
}

/** Запись fall-off реакции (порядок 2, molecule_cm3). */
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

/** Ловит ошибку вычислителя; падает, если функции не было. */
function kineticsError(fn: () => unknown): KineticsError {
  try {
    fn();
  } catch (e) {
    return e as KineticsError;
  }
  throw new Error('ожидалась ошибка KineticsError, но функция завершилась без ошибки');
}

/** Валидатор обязан зафиксировать проблему, содержащую фрагмент. */
function expectProblem(record: unknown, fragment: string): void {
  const problems = validateKineticReactionRecord(record);
  expect(problems.some((p) => p.includes(fragment))).toBe(true);
}

describe('Stage 4.5.1: реестры и согласование единиц', () => {
  it('реестры классов, моделей концентраций и единиц соответствуют контракту', () => {
    expect(KINETIC_REACTION_KINDS).toEqual(['elementary', 'overall_empirical']);
    expect(CONCENTRATION_MODELS).toEqual(['molecule_cm3', 'mol_m3']);
    expect(RATE_CONSTANT_UNITS).toEqual([
      'per_s',
      'cm3_per_molecule_per_s',
      'cm6_per_molecule2_per_s',
      'm3_per_mol_per_s',
      'm6_per_mol2_per_s'
    ]);
  });

  it('rateConstantUnitForOrder согласует порядок и модель концентраций', () => {
    expect(rateConstantUnitForOrder(1, 'molecule_cm3')).toBe('per_s');
    expect(rateConstantUnitForOrder(1, 'mol_m3')).toBe('per_s');
    expect(rateConstantUnitForOrder(2, 'molecule_cm3')).toBe('cm3_per_molecule_per_s');
    expect(rateConstantUnitForOrder(3, 'molecule_cm3')).toBe('cm6_per_molecule2_per_s');
    expect(rateConstantUnitForOrder(2, 'mol_m3')).toBe('m3_per_mol_per_s');
    expect(rateConstantUnitForOrder(3, 'mol_m3')).toBe('m6_per_mol2_per_s');
  });

  it('порядки вне реестра 1..3 — null, а не «ближайшая» единица', () => {
    expect(rateConstantUnitForOrder(0, 'molecule_cm3')).toBeNull();
    expect(rateConstantUnitForOrder(4, 'molecule_cm3')).toBeNull();
    expect(rateConstantUnitForOrder(1.5, 'mol_m3')).toBeNull();
    expect(rateConstantUnitForOrder(Number.NaN, 'mol_m3')).toBeNull();
  });
});

describe('Stage 4.5.1: валидатор записей (fail-closed, JSON-происхождение)', () => {
  it('корректная аррениусовская запись проходит без проблем', () => {
    expect(validateKineticReactionRecord(arrheniusReaction())).toEqual([]);
  });

  it('корректная fall-off запись проходит без проблем', () => {
    expect(validateKineticReactionRecord(fallOffReaction())).toEqual([]);
  });

  it('unknown-константа без параметров валидна; порядок может быть null', () => {
    const record: KineticReactionRecord = {
      id: 'test-unknown',
      kind: 'overall_empirical',
      overallOrder: null,
      concentrationModel: 'molecule_cm3',
      rateConstant: { status: 'unknown', note: 'экспериментальных данных нет' }
    };
    expect(validateKineticReactionRecord(record)).toEqual([]);
  });

  it('не-объект, пустой id, чужие kind и concentrationModel — проблемы', () => {
    expect(validateKineticReactionRecord(42)[0]).toContain('объектом');
    expectProblem(arrheniusReaction({ id: '   ' }), 'id');
    expectProblem(
      arrheniusReaction({ kind: 'mystical' as unknown as KineticReactionRecord['kind'] }),
      'elementary | overall_empirical'
    );
    expectProblem(
      arrheniusReaction({ concentrationModel: 'parsec' as unknown as ConcentrationModel }),
      'molecule_cm3 | mol_m3'
    );
  });

  it('порядок: null при известных данных, дробный и вне 1..3 — проблемы', () => {
    expectProblem(arrheniusReaction({ overallOrder: null }), 'overallOrder');
    expectProblem(arrheniusReaction({ overallOrder: 4 }), 'порядки закона скорости 1..3');
    expectProblem(arrheniusReaction({ overallOrder: 1.5 }), 'порядки закона скорости 1..3');
  });

  it('параметры Аррениуса: неположительная A, нечисловой n — проблемы', () => {
    expectProblem(withArrhenius(arrhenius(0, 0, 0, 'cm3_per_molecule_per_s')), 'предэкспонента');
    expectProblem(withArrhenius(arrhenius(-1e-11, 0, 0, 'cm3_per_molecule_per_s')), 'предэкспонента');
    expectProblem(
      withArrhenius({ ...arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s'), temperatureExponentN: Number.NaN }),
      'показатель n'
    );
  });

  it('энергия: чужая форма и нечисловое значение — проблемы', () => {
    const p = arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s');
    expectProblem(withArrhenius({ ...p, energy: { form: 'kcal' } as unknown as ArrheniusParameters['energy'] }), 'E_over_R | Ea_J_mol');
    expectProblem(
      withArrhenius({ ...p, energy: { form: 'E_over_R', valueK: Number.NaN } }),
      'E/R (valueK)'
    );
  });

  it('диапазон: вырожденный и неположительный — проблемы', () => {
    expectProblem(withArrhenius(arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s', 300, 300)), '0 < min < max');
    expectProblem(withArrhenius(arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s', 0, 300)), '0 < min < max');
  });

  it('единица k обязана соответствовать порядку и модели концентраций', () => {
    expectProblem(withArrhenius(arrhenius(1e-11, 0, 0, 'per_s')), 'отнесена к порядку 1');
    expectProblem(
      withArrhenius(arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s'), 2, 'mol_m3'),
      'модель концентраций'
    );
    expectProblem(withArrhenius(arrhenius(1e-11, 0, 0, 'knots' as unknown as ArrheniusParameters['unit'])), 'кинетического реестра');
  });

  it('estimated без метода и known без parameters — проблемы', () => {
    const p = arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s');
    const estimatedNoMethod: KineticReactionRecord = {
      ...withArrhenius(p),
      // Пустая строка: тип контракта требует поле, валидатор обязан
      // отвергнуть пустой метод (оценка без метода безследна)
      rateConstant: { status: 'estimated', method: '', parameters: { kind: 'arrhenius', arrhenius: p } }
    };
    expectProblem(estimatedNoMethod, 'method');
    const knownNoParams = { ...withArrhenius(p), rateConstant: { status: 'known' } };
    expectProblem(knownNoParams, 'parameters');
  });

  it('неопределённость с чужим kind фиксируется (делегирование ScientificValue)', () => {
    const p = arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s');
    expectProblem(
      withArrhenius({ ...p, uncertainty: { kind: 'vibes' } as unknown as ArrheniusParameters['uncertainty'] }),
      'interval | stddev | relative | bounded'
    );
    expectProblem(
      withArrhenius({ ...p, uncertainty: { kind: 'relative', fraction: -0.1 } }),
      'относительная неопределённость'
    );
  });

  it('provenance параметров обязателен', () => {
    const p = arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s');
    expectProblem(withArrhenius({ ...p, provenance: undefined as unknown as DataProvenance }), 'provenance');
  });

  it('fall-off: несогласованные пределы, Fc, N — проблемы', () => {
    expectProblem(
      fallOffReaction(fallOffParameters({ lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm3_per_molecule_per_s') })),
      'rateConstant.fallOff.k0'
    );
    expectProblem(fallOffReaction(fallOffParameters({ centeringFactorFc: 0 })), 'Fc');
    expectProblem(fallOffReaction(fallOffParameters({ centeringFactorFc: 1.2 })), 'Fc');
    expectProblem(fallOffReaction(fallOffParameters({ broadeningN: 0 })), 'N');
    expectProblem(
      fallOffReaction(
        fallOffParameters({
          lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s', 200, 400),
          highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s', 500, 600)
        })
      ),
      'не пересекаются'
    );
    expectProblem({ ...fallOffReaction(), overallOrder: 3 }, 'вне реестра');
  });
});

describe('Stage 4.5.2: вычислитель k(T) — модифицированный Аррениус', () => {
  it('T = 300 K, n = 0, E/R = 0: k точно равно A', () => {
    const k = evaluateRateConstant(arrheniusReaction(), quantity(300, 'K'));
    expect(k.value).toBe(1e-11);
    expect(k.unit).toBe('cm3_per_molecule_per_s');
    expect(k.concentrationModel).toBe('molecule_cm3');
    expect(k.dataStatus).toBe('known');
    expect(k.temperatureK).toBe(300);
    expect(k.estimationMethod).toBeUndefined();
  });

  it('n и E/R считаются по форме: k(600) = A·(600/300)^n·exp(−E/R/600)', () => {
    const record = withArrhenius(arrhenius(3.5e-12, 2, 500, 'cm3_per_molecule_per_s'));
    const k = evaluateRateConstant(record, quantity(600, 'K'));
    const expected = 3.5e-12 * Math.pow(600 / TREF, 2) * Math.exp(-500 / 600);
    expect(k.value / expected).toBeCloseTo(1, 12);
  });

  it('формы E/R и Ea = R·(E/R) дают одно и то же k', () => {
    const eOverR = 970;
    const kER = evaluateRateConstant(withArrhenius(arrhenius(1.3e-11, 0, eOverR, 'cm3_per_molecule_per_s')), quantity(500, 'K'));
    const kEa = evaluateRateConstant(withArrhenius(arrheniusEa(1.3e-11, 0, eOverR * R, 'cm3_per_molecule_per_s')), quantity(500, 'K'));
    expect(kEa.value / kER.value).toBeCloseTo(1, 12);
  });

  it('отрицательный E/R допустим: k убывает с ростом T (как у реакций с отрицательной энергией активации)', () => {
    const record = withArrhenius(arrhenius(1e-12, 0, -300, 'cm3_per_molecule_per_s'));
    const cold = evaluateRateConstant(record, quantity(400, 'K')).value;
    const hot = evaluateRateConstant(record, quantity(1000, 'K')).value;
    expect(hot / cold).toBeLessThan(1);
  });

  it('границы диапазона применимости включаются', () => {
    const record = withArrhenius(arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s', 250, 350));
    expect(() => evaluateRateConstant(record, quantity(250, 'K'))).not.toThrow();
    expect(() => evaluateRateConstant(record, quantity(350, 'K'))).not.toThrow();
  });

  it('вне диапазона — отказ temperature_out_of_range с границами в сообщении', () => {
    const record = withArrhenius(arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s', 250, 350));
    const below = kineticsError(() => evaluateRateConstant(record, quantity(249.999, 'K')));
    expect(below).toBeInstanceOf(KineticsError);
    expect(below.code).toBe('temperature_out_of_range');
    expect(below.message).toContain('250');
    expect(below.message).toContain('экстраполяция запрещена');
    const above = kineticsError(() => evaluateRateConstant(record, quantity(350.001, 'K')));
    expect(above.code).toBe('temperature_out_of_range');
  });

  it('некорректная температура — invalid_input (NaN, неположительная, чужая размерность)', () => {
    const record = arrheniusReaction();
    const nanT = { value: Number.NaN, unit: 'K' } as unknown as PhysicalQuantity;
    expect(kineticsError(() => evaluateRateConstant(record, nanT)).code).toBe('invalid_input');
    expect(kineticsError(() => evaluateRateConstant(record, quantity(-5, 'K'))).code).toBe('invalid_input');
    const wrongUnit = { value: 300, unit: 'Pa' } as unknown as PhysicalQuantity;
    expect(kineticsError(() => evaluateRateConstant(record, wrongUnit)).code).toBe('invalid_input');
    expect(kineticsError(() => evaluateRateConstant(record, null as unknown as PhysicalQuantity)).code).toBe('invalid_input');
  });

  it('повреждённая запись — invalid_input со списком проблем', () => {
    const broken = arrheniusReaction({ overallOrder: null });
    const error = kineticsError(() => evaluateRateConstant(broken, quantity(300, 'K')));
    expect(error.code).toBe('invalid_input');
    expect(error.details).toContain('overallOrder');
  });

  it('unknown-константа — no_kinetic_data «не рассчитано», без фиктивной скорости', () => {
    const record: KineticReactionRecord = {
      id: 'no-data',
      kind: 'elementary',
      overallOrder: null,
      concentrationModel: 'molecule_cm3',
      rateConstant: { status: 'unknown', note: 'экспериментальных данных нет' }
    };
    const error = kineticsError(() => evaluateRateConstant(record, quantity(298.15, 'K')));
    expect(error.code).toBe('no_kinetic_data');
    expect(error.message).toContain('не рассчитана');
    expect(error.message).toContain('экспериментальных данных нет');
  });

  it('estimated передаёт статус и метод в результат', () => {
    const record: KineticReactionRecord = {
      id: 'est-1',
      kind: 'overall_empirical',
      overallOrder: 2,
      concentrationModel: 'molecule_cm3',
      rateConstant: {
        status: 'estimated',
        method: 'оценка по аналогии (фикция теста)',
        parameters: { kind: 'arrhenius', arrhenius: arrhenius(5e-11, 0, 100, 'cm3_per_molecule_per_s') }
      },
      provenance: fixtureProvenance()
    };
    const k = evaluateRateConstant(record, quantity(300, 'K'));
    expect(k.dataStatus).toBe('estimated');
    expect(k.estimationMethod).toContain('аналогии');
  });

  it('исчезновение экспоненты — numerical_failure, а не молчаливый 0', () => {
    const record = withArrhenius(arrhenius(1e-11, 0, 1e9, 'cm3_per_molecule_per_s'));
    const error = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
    expect(error.code).toBe('numerical_failure');
  });

  it('thirdBodyConcentration для аррениусовской записи — invalid_input', () => {
    const error = kineticsError(() =>
      evaluateRateConstant(arrheniusReaction(), quantity(300, 'K'), { thirdBodyConcentration: 2.5e19 })
    );
    expect(error.code).toBe('invalid_input');
  });

  it('неопределённость и provenance переносятся в результат', () => {
    const p: ArrheniusParameters = {
      ...arrhenius(1e-11, 0, 0, 'cm3_per_molecule_per_s'),
      uncertainty: { kind: 'relative', fraction: 0.25, note: 'синтетический фактор (фикция)' }
    };
    const k = evaluateRateConstant(withArrhenius(p), quantity(300, 'K'));
    expect(k.uncertainty?.kind).toBe('relative');
    expect(k.provenance?.sourceName).toContain('фикция');
  });
});

describe('Stage 4.5.2: fall-off (Lindemann-ядро + Troe-уширение)', () => {
  it('аналитическая точка Pr = 1: k = k∞·Fc/2, F = Fc, N не влияет', () => {
    // k0 = 2e-30 cm⁶/(molecule²·s), k∞ = 1e-10 cm³/(molecule·s):
    // Pr = 1 при [M] = k∞/k0 = 5e19 molecule/cm³; log10(1) = 0 ⇒ F = Fc^1
    const k = evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: 5e19 });
    expect(k.value / (1e-10 * 0.6 / 2)).toBeCloseTo(1, 12);
    expect(k.fallOff?.reducedPressure).toBeCloseTo(1, 12);
    expect(k.fallOff?.log10ReducedPressure).toBeCloseTo(0, 12);
    expect(k.fallOff?.broadeningFactor).toBeCloseTo(0.6, 12);
    expect(k.unit).toBe('cm3_per_molecule_per_s');
    expect(k.appliedRangeK).toEqual({ min: 200, max: 2000 });
  });

  it('низкоплотностный предел: k → k0·[M] при Pr → 0', () => {
    const M = 1e10; // Pr = 2e-10 → F ≈ 1
    const k = evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: M });
    const f = Math.pow(0.6, 1 / (1 + Math.log10(2e-10) ** 2));
    const expected = (2e-30 * M * f) / (1 + 2e-10);
    expect(k.value / expected).toBeCloseTo(1, 12);
    expect(k.fallOff?.broadeningFactor).toBeCloseTo(f, 12);
  });

  it('Fc берётся из записи: изменение Fc меняет k в точке Pr = 1', () => {
    const k06 = evaluateRateConstant(fallOffReaction(fallOffParameters({ centeringFactorFc: 0.6 })), quantity(300, 'K'), { thirdBodyConcentration: 5e19 });
    const k05 = evaluateRateConstant(fallOffReaction(fallOffParameters({ centeringFactorFc: 0.5 })), quantity(300, 'K'), { thirdBodyConcentration: 5e19 });
    expect(k05.value / k06.value).toBeCloseTo(0.5 / 0.6, 12);
  });

  it('N берётся из записи и влияет вне Pr = 1', () => {
    const M = 5e17; // Pr = 2e-30·5e17/1e-10 = 1e-2, log10(Pr) = −2
    const k1 = evaluateRateConstant(fallOffReaction(fallOffParameters({ broadeningN: 1 })), quantity(300, 'K'), { thirdBodyConcentration: M });
    const k2 = evaluateRateConstant(fallOffReaction(fallOffParameters({ broadeningN: 2 })), quantity(300, 'K'), { thirdBodyConcentration: M });
    const f1 = Math.pow(0.6, 1 / (1 + (Math.log10(0.01) / 1) ** 2));
    const f2 = Math.pow(0.6, 1 / (1 + (Math.log10(0.01) / 2) ** 2));
    expect(k1.fallOff?.broadeningFactor).toBeCloseTo(f1, 12);
    expect(k2.fallOff?.broadeningFactor).toBeCloseTo(f2, 12);
    expect(f1).not.toBeCloseTo(f2, 5);
  });

  it('пределы k0/k∞ считаются формой Аррениуса, k = k∞·(Pr/(1+Pr))·F', () => {
    const params = fallOffParameters({
      lowPressureLimit: arrhenius(2e-30, 1, 200, 'cm6_per_molecule2_per_s'),
      highPressureLimit: arrhenius(1e-10, -1, 100, 'cm3_per_molecule_per_s')
    });
    const T = 600;
    const M = 1e20;
    const k = evaluateRateConstant(fallOffReaction(params), quantity(T, 'K'), { thirdBodyConcentration: M });
    const k0 = 2e-30 * Math.pow(T / TREF, 1) * Math.exp(-200 / T);
    const kInf = 1e-10 * Math.pow(T / TREF, -1) * Math.exp(-100 / T);
    const pr = (k0 * M) / kInf;
    const f = Math.pow(0.6, 1 / (1 + (Math.log10(pr) / 1) ** 2));
    const low = k.fallOff?.lowPressureLimit;
    const high = k.fallOff?.highPressureLimit;
    if (low === undefined || high === undefined) {
      throw new Error('ожидались пределы k0/k∞ в блоке fallOff результата');
    }
    expect(low / k0).toBeCloseTo(1, 12);
    expect(high / kInf).toBeCloseTo(1, 12);
    expect(k.value / (kInf * (pr / (1 + pr)) * f)).toBeCloseTo(1, 12);
  });

  it('[M] обязательна и положительна для fall-off записи', () => {
    const record = fallOffReaction();
    expect(kineticsError(() => evaluateRateConstant(record, quantity(300, 'K'))).code).toBe('invalid_third_body');
    expect(
      kineticsError(() => evaluateRateConstant(record, quantity(300, 'K'), { thirdBodyConcentration: 0 })).code
    ).toBe('invalid_third_body');
    expect(
      kineticsError(() => evaluateRateConstant(record, quantity(300, 'K'), { thirdBodyConcentration: -1 })).code
    ).toBe('invalid_third_body');
    expect(
      kineticsError(() => evaluateRateConstant(record, quantity(300, 'K'), { thirdBodyConcentration: Number.NaN })).code
    ).toBe('invalid_third_body');
  });

  it('T вне диапазона любого предела — отказ; применённый диапазон — пересечение', () => {
    const params = fallOffParameters({
      lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s', 200, 400),
      highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s', 300, 500)
    });
    const record = fallOffReaction(params);
    expect(
      kineticsError(() => evaluateRateConstant(record, quantity(250, 'K'), { thirdBodyConcentration: 1e19 })).code
    ).toBe('temperature_out_of_range');
    expect(
      kineticsError(() => evaluateRateConstant(record, quantity(450, 'K'), { thirdBodyConcentration: 1e19 })).code
    ).toBe('temperature_out_of_range');
    const k = evaluateRateConstant(record, quantity(350, 'K'), { thirdBodyConcentration: 1e19 });
    expect(k.appliedRangeK).toEqual({ min: 300, max: 400 });
  });

  it('для fall-off результата неопределённость не выдумывается', () => {
    const k = evaluateRateConstant(fallOffReaction(), quantity(300, 'K'), { thirdBodyConcentration: 5e19 });
    expect(k.uncertainty).toBeUndefined();
    expect(k.dataStatus).toBe('known');
  });
});

describe('Stage 4.5.2: преобразования molecule ↔ mol на точной N_A', () => {
  it('концентрация: 1 molecule/cm³ = 1e6/N_A моль/м³ и обратно (число Лошмидта)', () => {
    const mol = convertConcentration(1, 'molecule_cm3', 'mol_m3');
    expect(mol).toBeCloseTo(1e6 / NA, 30);
    expect(convertConcentration(mol, 'mol_m3', 'molecule_cm3')).toBeCloseTo(1, 12);
    // Независимая проверка масштаба: 2.687e19 molecule/cm³ (Loschmidt,
    // STP) ≈ 44.6 моль/м³ — молярный объём 22.4 л/моль при тех же условиях
    expect(convertConcentration(2.687e19, 'molecule_cm3', 'mol_m3')).toBeCloseTo(44.6, 1);
  });

  it('константа порядка 2: 1 cm³/(molecule·s) = N_A·1e-6 м³/(моль·с)', () => {
    const mol = convertRateConstantUnit(1, 'cm3_per_molecule_per_s', 'm3_per_mol_per_s');
    expect(mol).toBeCloseTo(NA * 1e-6, 12);
    expect(convertRateConstantUnit(mol, 'm3_per_mol_per_s', 'cm3_per_molecule_per_s')).toBeCloseTo(1, 12);
  });

  it('константа порядка 3: 1 cm⁶/(molecule²·s) = N_A²·1e-12 м⁶/(моль²·с)', () => {
    const mol = convertRateConstantUnit(1, 'cm6_per_molecule2_per_s', 'm6_per_mol2_per_s');
    expect(mol / (NA * NA * 1e-12)).toBeCloseTo(1, 12);
    expect(convertRateConstantUnit(mol, 'm6_per_mol2_per_s', 'cm6_per_molecule2_per_s')).toBeCloseTo(1, 12);
  });

  it('скорость инвариантна к согласованной смене модели концентраций', () => {
    // r = k·c² в molecule-конвенции; r' = k'·c'² в mol-конвенции;
    // r' = r·(1e6/N_A) — та же скорость в моль/м³/с
    const kMolecule = 1e-11;
    const cMolecule = 2.5e12;
    const rateMolecule = kMolecule * cMolecule * cMolecule;
    const kMol = convertRateConstantUnit(kMolecule, 'cm3_per_molecule_per_s', 'm3_per_mol_per_s');
    const cMol = convertConcentration(cMolecule, 'molecule_cm3', 'mol_m3');
    const rateMol = kMol * cMol * cMol;
    expect((rateMol / rateMolecule) / (1e6 / NA)).toBeCloseTo(1, 12);
    // и пересчитанная скорость совпадает с конверсией плотности скорости
    expect(convertConcentration(rateMolecule, 'molecule_cm3', 'mol_m3') / rateMol).toBeCloseTo(1, 12);
  });

  it('несогласованные преобразования и нечисловые значения — invalid_input', () => {
    expect(convertRateConstantUnit(1, 'per_s', 'per_s')).toBe(1);
    expect(kineticsError(() => convertRateConstantUnit(1, 'per_s', 'm3_per_mol_per_s')).code).toBe('invalid_input');
    expect(
      kineticsError(() => convertRateConstantUnit(Number.NaN, 'per_s', 'per_s')).code
    ).toBe('invalid_input');
    expect(
      kineticsError(() => convertConcentration(1, 'molecule_cm3', 'parsec' as unknown as ConcentrationModel)).code
    ).toBe('invalid_input');
    expect(kineticsError(() => convertConcentration(Number.NaN, 'mol_m3', 'mol_m3')).code).toBe('invalid_input');
  });
});

describe('Stage 4.5.2: детерминированность и чистота', () => {
  it('повторные вызовы дают идентичный результат; вход не мутируется', () => {
    const record = fallOffReaction();
    const options = { thirdBodyConcentration: 5e19 };
    const snapshot = JSON.stringify({ record, options });
    const first = evaluateRateConstant(record, quantity(300, 'K'), options);
    const second = evaluateRateConstant(record, quantity(300, 'K'), options);
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
    expect(JSON.stringify({ record, options })).toEqual(snapshot);
  });
});
