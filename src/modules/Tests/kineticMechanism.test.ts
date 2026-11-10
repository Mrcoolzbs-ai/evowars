// ============================================
// kineticMechanism.test.ts — тесты ограниченного концентрационного
// кинетического механизма №89/№106 (Stage 4.5.5, первый срез)
// ============================================
//
// Проверяемое: типизированная стехиометрия и элементный баланс;
// только две разрешённые записи каталога (known); контролируемый
// отказ для записей вне механизма (№1/№70/№72 — unknown,
// no_kinetic_data); расчёт k(T, [N₂]) существующим
// evaluateRateConstant(); per-record диапазоны применимости
// ([200, 300] K у №89, [300, 400] K у №106, совместный выбор —
// только 300 K); fail-closed контроль входа (отсутствующее поле —
// ошибка, не молчаливый ноль; NaN/Infinity/отрицательные/нулевой
// [N₂]/неверный dt — отказ); неизменность N₂ (третье тело);
// элементные инварианты и неотрицательность через контракт
// существующего Radau IIA; аналитический якобиан против
// независимой конечной разности; нулевые составы без выдуманной
// скорости; отказ интегратора без частичной фиксации результата;
// иммутабельность входа.
//
// ВАЖНО: числовые концентрации в фикстурах — СИНТЕТИЧЕСКИЕ, они
// проверяют МАТЕМАТИКУ контракта механизма, а НЕ достоверность
// состава какой-либо планетарной атмосферы. Научные статусы
// параметров не повышаются.

import { describe, expect, it } from 'vitest';
import {
  buildConcentrationKineticProblem,
  KineticMechanismError,
  MECHANISM_REACTIONS,
  mechanismElementBalanceProblems,
  runConcentrationKineticStep
} from '../ChemicalEvolution/kineticMechanism';
import type { ConcentrationKineticStepInput } from '../ChemicalEvolution/kineticMechanism';
import { buildKineticsCatalog, kidaTbRecordId } from '../Data/kineticsCatalog';
import type { KineticReactionRecord } from '../Core/kinetics';
import { evaluateRateConstant } from '../Core/kinetics';
import type { DataProvenance } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { solveOdeWithRadauIia, OdeSolverError } from '../Core/odeSolver';
import type { OdeSolverProblem } from '../Core/solverBackend';

const ID89 = 'kida-tb-2015-03-19-89';
const ID106 = 'kida-tb-2015-03-19-106';

// Синтетическая концентрация N₂ (порядка числа Лошмидта при ~1 атм):
// тестовая фикстура, НЕ научный параметр планеты.
const N2_FIXTURE = 2.5e19;
const DT_FIXTURE_S = 0.1;

function input89(temperatureK: number): ConcentrationKineticStepInput {
  return {
    temperatureK,
    dtSeconds: DT_FIXTURE_S,
    reactionIds: [ID89],
    concentrations: { O: 1e12, NO: 5e11, NO2: 2e10, N2: N2_FIXTURE }
  };
}

function input106(temperatureK: number): ConcentrationKineticStepInput {
  return {
    temperatureK,
    dtSeconds: DT_FIXTURE_S,
    reactionIds: [ID106],
    concentrations: { H: 8e11, O2: 4e12, HO2: 1e9, N2: N2_FIXTURE }
  };
}

function inputJoint(temperatureK: number): ConcentrationKineticStepInput {
  return {
    temperatureK,
    dtSeconds: DT_FIXTURE_S,
    reactionIds: [ID89, ID106],
    concentrations: { O: 1e12, NO: 5e11, NO2: 2e10, H: 8e11, O2: 4e12, HO2: 1e9, N2: N2_FIXTURE }
  };
}

/** Вызывает fn, ожидает KineticMechanismError; НЕ бросает, а возвращает пойманную ошибку. */
function mechanismError(fn: () => unknown): KineticMechanismError {
  try {
    fn();
  } catch (e) {
    if (e instanceof KineticMechanismError) {
      return e;
    }
    throw new Error('ожидалась KineticMechanismError, получено: ' + String(e));
  }
  throw new Error('ожидалась KineticMechanismError, вызов прошёл без ошибки');
}

/** Вызывает fn, ожидает OdeSolverError; возвращает пойманную ошибку. */
function solverError(fn: () => unknown): OdeSolverError {
  try {
    fn();
  } catch (e) {
    if (e instanceof OdeSolverError) {
      return e;
    }
    throw new Error('ожидалась OdeSolverError, получено: ' + String(e));
  }
  throw new Error('ожидалась OdeSolverError, вызов прошёл без ошибки');
}

/** Provenance синтетической фикстуры (фикция для тестов). */
function fixtureProvenance(): DataProvenance {
  return {
    sourceName: 'тестовая фикстура (фикция для тестов)',
    method: 'синтетическая кинетическая параметризация (фикция)'
  };
}

/**
 * Синтетическая запись-фикстура с id №89 и ЗАВЕДОМО переполняющей
 * скоростью реакции (k порядка 1e290 cm³ molecule⁻¹ s⁻¹: произведение
 * k·[O]·[NO] уходит в Infinity на фикстурных концентрациях): используется
 * ТОЛЬКО для проверки семантики отказа интегратора (rhs_non_finite —
 * решатель обязан отказаться, обёртка обязана отдать контролируемый
 * отказ без частичной фиксации результата). НЕ научная параметризация.
 */
function fixtureStiff89Record(): KineticReactionRecord {
  return {
    id: ID89,
    kind: 'elementary',
    overallOrder: 2,
    concentrationModel: 'molecule_cm3',
    rateConstant: {
      status: 'known',
      parameters: {
        kind: 'fall_off',
        fallOff: {
          lowPressureLimit: {
            preExponentialA: 1e280,
            temperatureExponentN: 0,
            energy: { form: 'E_over_R', valueK: 0 },
            temperatureRangeK: { min: 100, max: 500 },
            unit: 'cm6_per_molecule2_per_s',
            provenance: fixtureProvenance()
          },
          highPressureLimit: {
            preExponentialA: 1e290,
            temperatureExponentN: 0,
            energy: { form: 'E_over_R', valueK: 0 },
            temperatureRangeK: { min: 100, max: 500 },
            unit: 'cm3_per_molecule_per_s',
            provenance: fixtureProvenance()
          },
          centeringFactorFc: 0.6,
          broadeningN: 1,
          thirdBodyNote: 'M = N₂ (фикстура)',
          provenance: fixtureProvenance()
        }
      }
    },
    provenance: fixtureProvenance()
  };
}

// --------------------------------------------
// 1. Типизированные определения механизма
// --------------------------------------------

describe('ограниченный кинетический механизм: типизированные определения', () => {
  it('механизм содержит ровно две разрешённые записи с каталожными id', () => {
    expect(MECHANISM_REACTIONS).toHaveLength(2);
    expect(MECHANISM_REACTIONS.map((r) => r.reactionId)).toEqual([ID89, ID106]);
  });

  it('элементный баланс типизированной стехиометрии сходится; поле record.reaction не парсится', () => {
    // Проверка определений механизма, а не человекочитаемых строк каталога.
    expect(mechanismElementBalanceProblems()).toEqual([]);
  });
});

// --------------------------------------------
// 2. Разрешённые записи каталога (fail-closed)
// --------------------------------------------

describe('разрешённые записи каталога', () => {
  it('из текущего каталога механизм применяет только №89/№106 со статусом known', () => {
    const catalog = buildKineticsCatalog();
    const record89 = catalog.get(ID89);
    const record106 = catalog.get(ID106);
    expect(record89?.rateConstant.status).toBe('known');
    expect(record106?.rateConstant.status).toBe('known');
    // Остальные записи каталога остаются unknown и в механизм не входят.
    for (const n of [1, 70, 72]) {
      const record = catalog.get(kidaTbRecordId(n));
      expect(record?.rateConstant.status).toBe('unknown');
    }
  });

  it('шаг по №89 возвращает ровно одну применённую запись с known-статусом', () => {
    const result = runConcentrationKineticStep(input89(250));
    expect(result.reactions).toHaveLength(1);
    expect(result.reactions[0].reactionId).toBe(ID89);
    expect(result.reactions[0].dataStatus).toBe('known');
  });

  it('записи №1/№70/№72 (unknown, no_kinetic_data) в механизм не допускаются', () => {
    for (const n of [1, 70, 72]) {
      const id = kidaTbRecordId(n);
      const e = mechanismError(() => runConcentrationKineticStep({ ...input89(250), reactionIds: [id] }));
      expect(e.code).toBe('no_kinetic_data');
    }
  });

  it('несуществующий id, пустой список и дубликаты — invalid_input', () => {
    expect(mechanismError(() => runConcentrationKineticStep({ ...input89(250), reactionIds: ['нет-такой-записи'] })).code).toBe('invalid_input');
    expect(mechanismError(() => runConcentrationKineticStep({ ...input89(250), reactionIds: [] })).code).toBe('invalid_input');
    expect(
      mechanismError(() => runConcentrationKineticStep({ ...input89(250), reactionIds: [ID89, ID89] })).code
    ).toBe('invalid_input');
  });
});

// --------------------------------------------
// 3. k(T, [N₂]) через существующий evaluateRateConstant
// --------------------------------------------

describe('константа скорости: существующий вычислитель 4.5.2 без дублирования параметров', () => {
  it('k №89 совпадает с прямым вызовом evaluateRateConstant и переносит статус, диапазон, provenance и fall-off', () => {
    const catalog = buildKineticsCatalog();
    const record = catalog.get(ID89);
    if (record === null) {
      throw new Error('запись №89 отсутствует в каталоге');
    }
    const expected = evaluateRateConstant(record, quantity(250, 'K'), { thirdBodyConcentration: N2_FIXTURE });
    const result = runConcentrationKineticStep(input89(250));
    const applied = result.reactions[0];
    expect(applied.rateConstant.value).toBe(expected.value);
    expect(applied.rateConstant.unit).toBe(expected.unit);
    expect(applied.dataStatus).toBe('known');
    expect(applied.appliedRangeK).toEqual({ min: 200, max: 300 });
    expect(applied.provenance).toEqual(expected.provenance);
    expect(applied.fallOff).toEqual(expected.fallOff);
    expect(applied.rateConstant.value).toBeGreaterThan(0);
    expect(Number.isFinite(applied.rateConstant.value)).toBe(true);
  });

  it('k №106 совпадает с прямым вызовом evaluateRateConstant (диапазон [300, 400] K)', () => {
    const catalog = buildKineticsCatalog();
    const record = catalog.get(ID106);
    if (record === null) {
      throw new Error('запись №106 отсутствует в каталоге');
    }
    const expected = evaluateRateConstant(record, quantity(350, 'K'), { thirdBodyConcentration: N2_FIXTURE });
    const result = runConcentrationKineticStep(input106(350));
    const applied = result.reactions[0];
    expect(applied.rateConstant.value).toBe(expected.value);
    expect(applied.appliedRangeK).toEqual({ min: 300, max: 400 });
    expect(applied.dataStatus).toBe('known');
  });
});

// --------------------------------------------
// 4. Диапазоны применимости — per-record, fail-closed
// --------------------------------------------

describe('диапазоны применимости: per-record, без экстраполяции', () => {
  it('№89 применима на границах 200 и 300 K', () => {
    expect(runConcentrationKineticStep(input89(200)).status).toBe('applied');
    expect(runConcentrationKineticStep(input89(300)).status).toBe('applied');
  });

  it('№89 вне [200, 300] K — temperature_out_of_range', () => {
    const cold = mechanismError(() => runConcentrationKineticStep(input89(199.999)));
    expect(cold.code).toBe('temperature_out_of_range');
    expect(cold.details?.reactionId).toBe(ID89);
    const hot = mechanismError(() => runConcentrationKineticStep(input89(300.001)));
    expect(hot.code).toBe('temperature_out_of_range');
  });

  it('№106 применима на границах 300 и 400 K', () => {
    expect(runConcentrationKineticStep(input106(300)).status).toBe('applied');
    expect(runConcentrationKineticStep(input106(400)).status).toBe('applied');
  });

  it('№106 вне [300, 400] K — temperature_out_of_range', () => {
    expect(mechanismError(() => runConcentrationKineticStep(input106(299.999))).code).toBe('temperature_out_of_range');
    expect(mechanismError(() => runConcentrationKineticStep(input106(400.001))).code).toBe('temperature_out_of_range');
  });

  it('совместный выбор №89+№106 допустим только при 300 K (пересечение диапазонов)', () => {
    expect(runConcentrationKineticStep(inputJoint(300)).status).toBe('applied');
    // При 250 K неприменима №106, при 350 K — №89: весь шаг отказывает,
    // недопустимая реакция НЕ пропускается молча.
    const cold = mechanismError(() => runConcentrationKineticStep(inputJoint(250)));
    expect(cold.code).toBe('temperature_out_of_range');
    expect(cold.details?.reactionId).toBe(ID106);
    const hot = mechanismError(() => runConcentrationKineticStep(inputJoint(350)));
    expect(hot.code).toBe('temperature_out_of_range');
    expect(hot.details?.reactionId).toBe(ID89);
  });
});

// --------------------------------------------
// 5. Контроль входа (отсутствующее поле — ошибка, не молчаливый ноль)
// --------------------------------------------

describe('контроль входа: контролируемые отказы', () => {
  it('отсутствующая концентрация обязательного вида — invalid_input', () => {
    const bad = {
      temperatureK: 250,
      dtSeconds: DT_FIXTURE_S,
      reactionIds: [ID89],
      concentrations: { O: 1e12, NO2: 2e10, N2: N2_FIXTURE } // нет NO
    };
    const e = mechanismError(() => runConcentrationKineticStep(bad));
    expect(e.code).toBe('invalid_input');
    expect(e.message).toContain('NO');
  });

  it('NaN, Infinity и отрицательная концентрация — invalid_input', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const bad = { ...input89(250), concentrations: { O: value, NO: 5e11, NO2: 2e10, N2: N2_FIXTURE } };
      const e = mechanismError(() => runConcentrationKineticStep(bad));
      expect(e.code).toBe('invalid_input');
    }
  });

  it('концентрация N₂: отсутствие, ноль и NaN — invalid_input (строго положительная, передаётся явно)', () => {
    const noN2 = {
      temperatureK: 250,
      dtSeconds: DT_FIXTURE_S,
      reactionIds: [ID89],
      concentrations: { O: 1e12, NO: 5e11, NO2: 2e10 }
    };
    expect(mechanismError(() => runConcentrationKineticStep(noN2)).code).toBe('invalid_input');
    const zeroN2 = { ...input89(250), concentrations: { O: 1e12, NO: 5e11, NO2: 2e10, N2: 0 } };
    expect(mechanismError(() => runConcentrationKineticStep(zeroN2)).code).toBe('invalid_input');
    const nanN2 = { ...input89(250), concentrations: { O: 1e12, NO: 5e11, NO2: 2e10, N2: Number.NaN } };
    expect(mechanismError(() => runConcentrationKineticStep(nanN2)).code).toBe('invalid_input');
  });

  it('temperatureK и dtSeconds: NaN, ноль, отрицательные, Infinity — invalid_input', () => {
    for (const t of [0, -5, Number.NaN]) {
      expect(mechanismError(() => runConcentrationKineticStep(input89(t))).code).toBe('invalid_input');
    }
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bad = { ...input89(250), dtSeconds: dt };
      expect(mechanismError(() => runConcentrationKineticStep(bad)).code).toBe('invalid_input');
    }
  });

  it('неизвестный вид в concentrations — invalid_input', () => {
    const bad = {
      ...input89(250),
      concentrations: { O: 1e12, NO: 5e11, NO2: 2e10, N2: N2_FIXTURE, CO2: 1e12 }
    };
    expect(mechanismError(() => runConcentrationKineticStep(bad)).code).toBe('invalid_input');
  });
});

// --------------------------------------------
// 6. N₂ — третье тело: не расходуется
// --------------------------------------------

describe('N₂ — третье тело (bath gas)', () => {
  it('N₂ не входит в вектор состояния и не изменяется', () => {
    const result = runConcentrationKineticStep(inputJoint(300));
    expect(result.thirdBodyN2MoleculeCm3).toBe(N2_FIXTURE);
    expect(result.concentrations).not.toHaveProperty('N2');
    expect(result.speciesOrder).toEqual(['O', 'NO', 'NO2', 'H', 'O2', 'HO2']);
  });
});

// --------------------------------------------
// 7. RHS, якобиан, знаки изменений
// --------------------------------------------

describe('RHS и аналитический якобиан', () => {
  it('аналитический якобиан совпадает с независимой центральной конечной разностью', () => {
    const built = buildConcentrationKineticProblem(inputJoint(300));
    const rhs = built.problem.rhs;
    const analytic = built.problem.jacobian;
    if (!analytic) {
      throw new Error('аналитический якобиан не задан в собранной задаче');
    }
    const y = built.problem.y0.map((v) => v * 0.7 + 3e8);
    const J = analytic(0, y);
    expect(J).toHaveLength(6);
    // Независимая центральная конечная разность (не численный якобиан решателя).
    const n = y.length;
    for (let j = 0; j < n; j++) {
      const scale = Math.max(Math.abs(y[j]), 1e-6);
      const h = 1e-5 * scale;
      const yp = y.slice();
      yp[j] += h;
      const ym = y.slice();
      ym[j] -= h;
      const fp = rhs(0, yp);
      const fm = rhs(0, ym);
      for (let i = 0; i < n; i++) {
        const fd = (fp[i] - fm[i]) / (2 * h);
        const an = J[i][j];
        expect(Math.abs(an - fd) <= 1e-6 * (1 + Math.abs(fd))).toBe(true);
      }
    }
  });

  it('реагенты убывают, продукт растёт', () => {
    const input = input89(250);
    const result = runConcentrationKineticStep(input);
    expect(result.concentrations.O).toBeLessThan(input.concentrations.O);
    expect(result.concentrations.NO).toBeLessThan(input.concentrations.NO);
    expect(result.concentrations.NO2).toBeGreaterThan(input.concentrations.NO2);
  });

  it('результат детерминирован: повторный вызов даёт то же решение', () => {
    const a = runConcentrationKineticStep(input89(250));
    const b = runConcentrationKineticStep(input89(250));
    expect(b.concentrations).toEqual(a.concentrations);
  });
});

// --------------------------------------------
// 8. Элементные инварианты и неотрицательность
// --------------------------------------------

describe('элементные инварианты и неотрицательность', () => {
  it('инварианты №89 сохраняются: N = [NO]+[NO₂], O = [O]+[NO]+2·[NO₂]', () => {
    const input = input89(250);
    const result = runConcentrationKineticStep(input);
    const nBefore = input.concentrations.NO + input.concentrations.NO2;
    const nAfter = result.concentrations.NO + result.concentrations.NO2;
    const oBefore = input.concentrations.O + input.concentrations.NO + 2 * input.concentrations.NO2;
    const oAfter = result.concentrations.O + result.concentrations.NO + 2 * result.concentrations.NO2;
    expect(nAfter / nBefore).toBeCloseTo(1, 9);
    expect(oAfter / oBefore).toBeCloseTo(1, 9);
  });

  it('инварианты №106 сохраняются: H = [H]+[HO₂], O = [O₂]+[HO₂]', () => {
    const input = input106(350);
    const result = runConcentrationKineticStep(input);
    const hBefore = input.concentrations.H + input.concentrations.HO2;
    const hAfter = result.concentrations.H + result.concentrations.HO2;
    const oBefore = input.concentrations.O2 + input.concentrations.HO2;
    const oAfter = result.concentrations.O2 + result.concentrations.HO2;
    expect(hAfter / hBefore).toBeCloseTo(1, 9);
    expect(oAfter / oBefore).toBeCloseTo(1, 9);
  });

  it('совместный шаг сохраняет все четыре инварианта, все концентрации неотрицательны', () => {
    const input = inputJoint(300);
    const result = runConcentrationKineticStep(input);
    const c0 = input.concentrations;
    const c1 = result.concentrations;
    expect((c1.NO + c1.NO2) / (c0.NO + c0.NO2)).toBeCloseTo(1, 9);
    expect((c1.O + c1.NO + 2 * c1.NO2) / (c0.O + c0.NO + 2 * c0.NO2)).toBeCloseTo(1, 9);
    expect((c1.H + c1.HO2) / (c0.H + c0.HO2)).toBeCloseTo(1, 9);
    expect((c1.O2 + c1.HO2) / (c0.O2 + c0.HO2)).toBeCloseTo(1, 9);
    for (const value of Object.values(c1)) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('задача содержит nonNegativeIndices по всем видам и инварианты с expected по y0', () => {
    const built = buildConcentrationKineticProblem(input89(250));
    expect(built.problem.nonNegativeIndices).toEqual([0, 1, 2]);
    expect(built.problem.linearInvariants).toHaveLength(2);
    const [invN, invO] = built.problem.linearInvariants;
    expect(invN.coefficients).toEqual([0, 1, 1]);
    expect(invN.expected).toBe(5e11 + 2e10);
    expect(invO.coefficients).toEqual([1, 1, 2]);
    expect(invO.expected).toBe(1e12 + 5e11 + 2 * 2e10);
  });

  it('решатель реально проверяет инварианты: искажённый expected даёт invariant_violation', () => {
    const built = buildConcentrationKineticProblem(input89(250));
    const corrupted: OdeSolverProblem = {
      ...built.problem,
      linearInvariants: [{ coefficients: [0, 1, 1], expected: 1e12 }]
    };
    const e = solverError(() => solveOdeWithRadauIia(corrupted));
    expect(e.code).toBe('invariant_violation');
  });

  it('решатель реально проверяет неотрицательность: отрицательное y0 даёт nonneg_violation (без clipping)', () => {
    const built = buildConcentrationKineticProblem(input89(250));
    const corrupted: OdeSolverProblem = {
      ...built.problem,
      y0: [-1e10, 5e11, 2e10]
    };
    const e = solverError(() => solveOdeWithRadauIia(corrupted));
    expect(e.code).toBe('nonneg_violation');
  });

  it('интегрирование реально выполнялось: статистика согласована, инварианты проверялись', () => {
    const result = runConcentrationKineticStep(inputJoint(300));
    expect(result.integration.method).toBe('radau_iia_5');
    expect(result.integration.invariantChecks).toBeGreaterThan(0);
    expect(result.integration.stats.attemptedSteps).toBe(
      result.integration.stats.acceptedSteps + result.integration.stats.rejectedSteps
    );
    expect(result.integration.stats.acceptedSteps).toBeGreaterThan(0);
  });
});

// --------------------------------------------
// 9. Нулевые составы: скорость не выдумывается
// --------------------------------------------

describe('нулевые и вырожденные составы', () => {
  it('полностью нулевой состав даёт точно нулевой результат без выдуманной скорости', () => {
    const zero = {
      temperatureK: 250,
      dtSeconds: 1,
      reactionIds: [ID89],
      concentrations: { O: 0, NO: 0, NO2: 0, N2: N2_FIXTURE }
    };
    const result = runConcentrationKineticStep(zero);
    expect(result.concentrations.O).toBe(0);
    expect(result.concentrations.NO).toBe(0);
    expect(result.concentrations.NO2).toBe(0);
    expect(result.integration.stats.acceptedSteps).toBeGreaterThan(0);
  });

  it('явный ноль одного реагента допустим: ничего не изменяется', () => {
    const input = { ...input89(250), concentrations: { O: 1e12, NO: 0, NO2: 2e10, N2: N2_FIXTURE } };
    const result = runConcentrationKineticStep(input);
    expect(result.concentrations.O).toBe(1e12);
    expect(result.concentrations.NO).toBe(0);
    expect(result.concentrations.NO2).toBe(2e10);
  });
});

// --------------------------------------------
// 10. Отказы интегратора: частичной фиксации не существует
// --------------------------------------------

describe('отказы интегратора и отсутствие частичной фиксации', () => {
  it('ошибка интегратора отдаётся как контролируемый отказ integration_failure, без частичного результата', () => {
    // Синтетическая запись-фикстура с заведомо жёсткой константой:
    // решатель обязан отказаться; обёртка обязана пробросить отказ,
    // а НЕ вернуть «частично проинтегрированный» вектор.
    const catalog = buildKineticsCatalog([fixtureStiff89Record()]);
    const input = input89(250);
    const snapshot = JSON.stringify(input);
    const e = mechanismError(() => runConcentrationKineticStep(input, catalog));
    expect(e.code).toBe('integration_failure');
    expect(typeof e.details?.solverErrorCode).toBe('string');
    expect(JSON.stringify(input)).toBe(snapshot);
    // API stateless: после отказа обычный каталог даёт полный результат.
    const ok = runConcentrationKineticStep(input89(250));
    expect(ok.status).toBe('applied');
  });

  it('отказ ДО интегрирования (температура) не оставляет следов: вход не изменён, повторный валидный вызов успешен', () => {
    const input = inputJoint(250);
    const snapshot = JSON.stringify(input);
    expect(mechanismError(() => runConcentrationKineticStep(input)).code).toBe('temperature_out_of_range');
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(runConcentrationKineticStep(inputJoint(300)).status).toBe('applied');
  });
});

// --------------------------------------------
// 11. Иммутабельность входа
// --------------------------------------------

describe('иммутабельность входа', () => {
  it('вход и вложенные поля не мутируются; результат — новые объекты', () => {
    const input = inputJoint(300);
    const snapshot = JSON.stringify(input);
    const result = runConcentrationKineticStep(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.concentrations).not.toBe(input.concentrations);
    expect(result.reactionIds).not.toBe(input.reactionIds);
  });
});

// --------------------------------------------
// 12. Диагностика и честные предупреждения
// --------------------------------------------

describe('диагностика результата', () => {
  it('результат №89 содержит предупреждение о контрольной точке IUPAC NOx1 (не маскируется)', () => {
    const result = runConcentrationKineticStep(input89(250));
    expect(result.warnings.some((w) => w.includes('IUPAC'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('46%'))).toBe(true);
  });

  it('результат №106 содержит предупреждение о расхождении серий k0', () => {
    const result = runConcentrationKineticStep(input106(350));
    expect(result.warnings.some((w) => w.includes('Hsu'))).toBe(true);
  });

  it('в заметках зафиксировано, что механизм не подключён к состоянию планеты', () => {
    const result = runConcentrationKineticStep(input89(250));
    expect(result.notes.some((n) => n.includes('НЕ подключён'))).toBe(true);
    expect(result.temperatureK).toBe(250);
    expect(result.dtSeconds).toBe(DT_FIXTURE_S);
  });
});
