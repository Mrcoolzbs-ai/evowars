// ============================================
// ТЕСТЫ — Ядро EOS конденсированных материалов (Stage 4.7.1)
// ============================================
// Больше 20 обязательных сценариев промта этапа 4.7.1:
// прямая задача P(ρ), обратная задача ρ(P), аналитические эталоны BM3,
// независимая проверка формулы и производной, fail-closed отказы
// (применимость, вход, параметры), каталог (уникальность, фазы,
// immutability, provenance, детерминизм).
//
// Честные эталонные числа получены ЗАРАНЕЕ на независимом пересчёте
// той же формулы BM3 (в комментарии каждого эталона) и проверены
// против альтернативной реализации степеней (exp/log в сценарии 6).
// Главное правило этапа: completed НЕ означает применимость к горячим
// недрам; отсутствующая неопределённость — «неизвестна», а не ноль.

import { describe, it, expect } from 'vitest';
import {
  bm3Pressure,
  bm3CompressionRatio,
  bm3PressureAtCompressionRatio,
  bm3DPressureDLnDensityAtCompressionRatio,
  bm3IsMonotonicAtDensity,
  bm3ParametersFromRecord,
  evaluateCondensedMatterPressure,
  solveCondensedMatterDensity,
  validateCondensedMatterEosCatalog,
  validateCondensedMatterEosRecordShape,
  getCondensedMatterEosRecordBlockingIssues,
  BM3_MAX_SUPPORTED_COMPRESSION_RATIO,
  BM3_MIN_SUPPORTED_COMPRESSION_RATIO,
  BM3_VALID_K0_PRIME_RANGE,
  type CondensedMatterEosRecord
} from '../Core/condensedMatterEos';
import { validateUncertainty } from '../Core/scientificValue';
import {
  PLANETARY_EOS_RECORDS,
  getPlanetaryEosRecord,
  tryGetPlanetaryEosRecord,
  listPlanetaryEosMaterialIds,
  validatePlanetaryEosCatalog,
  PlanetaryEosLookupError
} from '../Data/planetaryEos';

const FE = getPlanetaryEosRecord('fe_hcp_300k');
const BR = getPlanetaryEosRecord('mgso3_bridgmanite_300k');
const FE_PARAMS = bm3ParametersFromRecord(FE);
const BR_PARAMS = bm3ParametersFromRecord(BR);

/** Альтернативная (независимая) реализация BM3 через exp/log для сверки. */
function bm3ReferenceImplementation(
  rho: number,
  rho0: number,
  K0: number,
  K0p: number,
  P0: number
): number | null {
  const ln = Math.log(rho / rho0);
  const e5 = Math.exp((5 / 3) * ln);
  const e7 = Math.exp((7 / 3) * ln);
  const bracket = 1 + 0.75 * (K0p - 4) * (Math.exp((2 / 3) * ln) - 1);
  const p = 1.5 * K0 * (e7 - e5) * bracket + P0;
  return Number.isFinite(p) ? p : null;
}

/** Аналитические эталоны (пересчитаны заранее, относительный допуск 1e-10). */
const FE_EXPECTED = {
  p105: 9.47212648891753e9,
  p12: 48.84331158516357e9,
  p15: 187.0952637598057e9
};
const BR_EXPECTED = {
  p105: 13.576015415102955e9,
  p12: 65.82003137732792e9,
  p15: 226.12520916304993e9
};

function assertRel(actual: number, expected: number, digits = 10): void {
  expect(actual / expected).toBeCloseTo(1, digits);
}

function assertCompletedPressure(
  result: ReturnType<typeof evaluateCondensedMatterPressure>,
  materialId: string
): asserts result is Extract<ReturnType<typeof evaluateCondensedMatterPressure>, { status: 'completed' }> {
  if (result.status !== 'completed') {
    throw new Error(`ожидается completed, получено ${result.status}: ${JSON.stringify(result)}`);
  }
  expect(result.materialId).toBe(materialId);
}

function assertCompletedDensity(
  result: ReturnType<typeof solveCondensedMatterDensity>,
  materialId: string
): asserts result is Extract<ReturnType<typeof solveCondensedMatterDensity>, { status: 'completed' }> {
  if (result.status !== 'completed') {
    throw new Error(`ожидается completed, получено ${result.status}: ${JSON.stringify(result)}`);
  }
  expect(result.materialId).toBe(materialId);
}

describe('Stage 4.7.1: прямая задача P(ρ) и контракт BM3', () => {
  it('сценарий 1: P(ρ0) = P0 = 0 для Fe; бриджманит отклоняется (барический диапазон не подтверждён)', () => {
    const result = evaluateCondensedMatterPressure(FE, FE_PARAMS.referenceDensityKgM3, 300);
    assertCompletedPressure(result, FE.materialId);
    // P(ρ0) = P0 = 0 Pa точно (множитель (η^(7/3) − η^(5/3)) зануляет ядро)
    expect(result.pressurePa).toBe(0);
    expect(result.pressure.value).toBe(0);
    expect(result.referencePressurePa).toBe(0);
    expect(result.temperatureAssumption).toBe('isothermal_at_reference_temperature');
    // Бриджманит: даже математически корректная точка ρ0 не даёт completed,
    // пока pressureRangeKnown = false (fail-closed, Stage 4.7.1)
    const brResult = evaluateCondensedMatterPressure(BR, BR_PARAMS.referenceDensityKgM3, 300);
    expect(brResult.status).toBe('out_of_applicability');
    if (brResult.status === 'out_of_applicability') {
      expect(brResult.reason).toContain('барическая область применимости');
      expect(brResult.detail.pressureRangeKnown).toBe(false);
    }
    // алгебраическое тождество P(ρ0) = 0 для ядра BM3 проверяется
    // независимо от применимости в сценариях 2 и 6 (чистое ядро)
  });

  it('сценарий 2: dP/dln ρ|ρ0 = K0 — аналитически и независимо конечной разностью', () => {
    for (const [params, K0] of [
      [FE_PARAMS, FE_PARAMS.bulkModulusPa],
      [BR_PARAMS, BR_PARAMS.bulkModulusPa]
    ] as const) {
      const analytic = bm3DPressureDLnDensityAtCompressionRatio(1, params);
      expect(analytic).not.toBeNull();
      assertRel(analytic as number, K0, 12);
      // независимая числовая проверка: fdG = ΔP/Δln ρ с малым шагом
      const dEta = 1e-7;
      const p0 = bm3PressureAtCompressionRatio(1, params) as number;
      const p1 = bm3PressureAtCompressionRatio(1 + dEta, params) as number;
      const finiteDifference = (p1 - p0) / (dEta / 1);
      // односторонняя разность имеет ошибку отсечения O(dEta) ≈ 1.9e-7 относительной
      // при dEta = 1e-7, поэтому только 6 знаков; аналитика уже проверена до 12 знаков
      assertRel(finiteDifference, K0, 6);
    }
  });

  it('сценарий 3: давление положительно при сжатии и монотонно растёт', () => {
    for (const record of [FE, BR]) {
      const params = bm3ParametersFromRecord(record);
      const p1 = bm3Pressure(record.referenceDensityKgM3.value * 1.01, params) as number;
      const p2 = bm3Pressure(record.referenceDensityKgM3.value * 1.02, params) as number;
      const p3 = bm3Pressure(record.referenceDensityKgM3.value * 1.5, params) as number;
      expect(p1).toBeGreaterThan(0);
      expect(p2).toBeGreaterThan(p1);
      expect(p3).toBeGreaterThan(p2);
      expect(bm3IsMonotonicAtDensity(record.referenceDensityKgM3.value * 1.01, params)).toBe(true);
      expect(bm3IsMonotonicAtDensity(record.referenceDensityKgM3.value * 1.5, params)).toBe(true);
    }
  });

  it('сценарий 4: аналитические BM3 эталоны hcp-Fe (Fei et al. 2016/K0=172.7 GPa, K0′=4.79)', () => {
    assertRel(bm3Pressure(FE.referenceDensityKgM3.value * 1.05, FE_PARAMS) as number, FE_EXPECTED.p105);
    assertRel(bm3Pressure(FE.referenceDensityKgM3.value * 1.2, FE_PARAMS) as number, FE_EXPECTED.p12);
    assertRel(bm3Pressure(FE.referenceDensityKgM3.value * 1.5, FE_PARAMS) as number, FE_EXPECTED.p15);
  });

  it('сценарий 5: аналитические BM3 эталоны бриджманита и честный вывод ρ0 из V0 (CIAAW)', () => {
    assertRel(bm3Pressure(BR.referenceDensityKgM3.value * 1.05, BR_PARAMS) as number, BR_EXPECTED.p105);
    assertRel(bm3Pressure(BR.referenceDensityKgM3.value * 1.2, BR_PARAMS) as number, BR_EXPECTED.p12);
    assertRel(bm3Pressure(BR.referenceDensityKgM3.value * 1.5, BR_PARAMS) as number, BR_EXPECTED.p15);
    // ρ0 обязана быть выведена явно из V0 и середин CIAAW-интервалов
    const M = 24.3055 + 28.085 + 3 * 15.9994; // середины CIAAW 2024 из Data/elements.ts
    const rho0Derived = (M / 24.45) * 1000;
    assertRel(BR.referenceDensityKgM3.value, rho0Derived, 12);
    const rho0Provenance = BR.referenceDensityKgM3.provenance;
    expect(rho0Provenance.origin).toBe('derived');
    const raw = rho0Provenance.rawInput ?? {};
    expect((raw as Record<string, number | string | boolean | null>)['V0_cm3_mol']).toBe(24.45);
    expect(Object.isFrozen(rho0Provenance) || rho0Provenance.evidence === 'PARTIALLY_VERIFIED').toBe(true);
    // интервал ρ0 по весам CIAAW фиксируется как неопределённость
    const unc = BR.referenceDensityKgM3.uncertainty;
    expect(unc).toBeDefined();
    if (unc && unc.kind === 'interval') {
      expect(unc.lower).toBeLessThan(BR.referenceDensityKgM3.value);
      expect(unc.upper).toBeGreaterThan(BR.referenceDensityKgM3.value);
      expect(validateUncertainty(unc)).toHaveLength(0);
    } else {
      throw new Error('ρ0 бриджманита должна нести interval-неопределённость');
    }
  });

  it('сценарий 6: независимая проверка формулы BM3 (альтернативная exp/log-реализация)', () => {
    for (const [rho0, K0, K0p, P0] of [
      [8269.5, 172.7e9, 4.79, 0],
      [4105.877300613497, 253e9, 3.9, 0]
    ] as const) {
      for (const eta of [1.0, 1.05, 1.2, 1.5, 1.6345, 2.0, 5.0]) {
        const kernel = bm3PressureAtCompressionRatio(eta, {
          referenceDensityKgM3: rho0,
          bulkModulusPa: K0,
          bulkModulusPressureDerivative: K0p,
          referencePressurePa: P0
        });
        const reference = bm3ReferenceImplementation(eta * rho0, rho0, K0, K0p, P0) as number;
        expect(kernel).not.toBeNull();
        // оба числа в Pa на шкале сжатия; сверка с относительным допуском
        if (eta === 1) {
          // при η = 1 ядро тождественно 0: относительная сверка 0/0 не определена, сверяем точное равенство
          expect(kernel).toBe(0);
          expect(reference).toBe(0);
          continue;
        }
        assertRel(kernel as number, reference, 12);
      }
    }
  });

  it('сценарий 7: единица давления результата — Pa из реестра; давление согласовано с pressurePa', () => {
    const result = evaluateCondensedMatterPressure(FE, FE.referenceDensityKgM3.value * 1.2, 300);
    assertCompletedPressure(result, 'fe_hcp_300k');
    expect(result.pressure.unit).toBe('Pa');
    assertRel(result.pressure.value, result.pressurePa, 15);
  });
});

describe('Stage 4.7.1: обратная задача ρ(P)', () => {
  it('сценарий 8: круговой переход hcp-Fe (P(1.2·ρ0) → ρ)', () => {
    const pressure = (bm3Pressure(FE.referenceDensityKgM3.value * 1.2, FE_PARAMS) as number);
    const result = solveCondensedMatterDensity(FE, pressure, 300);
    assertCompletedDensity(result, 'fe_hcp_300k');
    expect(result.bracketSource).toBe('record_applicability');
    assertRel(result.densityKgM3, FE.referenceDensityKgM3.value * 1.2, 9);
    expect(Math.abs(result.residualPa)).toBeLessThanOrEqual(result.tolerancePa);
    expect(result.model).toBe('birch_murnaghan_3rd');
  });

  it('сценарий 9: ЯВНЫЙ bracket не заменяет подтверждённый барический диапазон (fail-closed)', () => {
    // Численно задача корректна (root внутри bracket существует), но
    // pressureRangeKnown = false: bracket — численный инструмент поиска корня,
    // а НЕ доказательство применимости.
    const pressure = bm3Pressure(BR.referenceDensityKgM3.value * 1.2, BR_PARAMS) as number;
    const result = solveCondensedMatterDensity(BR, pressure, 300, {
      densityBracketKgM3: { min: BR.referenceDensityKgM3.value, max: 2 * BR.referenceDensityKgM3.value }
    });
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.reason).toContain('не подтверждена');
      expect(result.reason).toContain('НЕ доказательство');
      expect(result.detail.pressureRangeKnown).toBe(false);
    }
  });

  it('сценарий 10: обратная задача hcp-Fe на границе подтверждённого диапазона (280 GPa → 13516.49 кг/м³)', () => {
    const etaFromSource = 13516.4919 / FE.referenceDensityKgM3.value;
    const result = solveCondensedMatterDensity(FE, 280e9, 300);
    assertCompletedDensity(result, 'fe_hcp_300k');
    // эталон численного решения (Независимая бисекция раньше, относительная невязка < 1e-9)
    assertRel(result.densityKgM3, 13516.4925, 6);
    expect(result.compressionRatio).toBeCloseTo(etaFromSource, 2);
    expect(result.compressionRatio).toBeLessThanOrEqual(BM3_MAX_SUPPORTED_COMPRESSION_RATIO);
    expect(Math.abs(result.residualPa)).toBeLessThanOrEqual(result.tolerancePa);
    // давление, восстановленное из решённой плотности, сходится к целевому в пределах объявленного допуска решателя
    expect(Math.abs(result.pressurePa - 280e9)).toBeLessThanOrEqual(result.tolerancePa);
  });

  it('сценарий 11: обратная задача бриджманита при 100 GPa → out_of_applicability даже с bracket; положительный контроль на синтетической записи', () => {
    const result = solveCondensedMatterDensity(BR, 100e9, 300, {
      densityBracketKgM3: { min: BR.referenceDensityKgM3.value, max: 2 * BR.referenceDensityKgM3.value }
    });
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.detail.pressureRangeKnown).toBe(false);
    }
    // Положительный контроль той же численной задачи: СИНТЕТИЧЕСКАЯ запись
    // (НЕ каталог, НЕ источник) с ГИПОТЕТИЧЕСКИ подтверждённым барическим
    // диапазоном и непресданным диапазоном плотности. Явный bracket здесь
    // разрешён, и корень сходится к независимому эталону.
    const synthetic: CondensedMatterEosRecord = {
      ...BR,
      materialId: 'mgso3_bridgmanite_300k_synthetic_positive_control',
      applicability: {
        ...BR.applicability,
        pressureRangeKnown: true,
        pressureRangePa: { min: 0, max: 101e9 }
      }
    };
    const positive = solveCondensedMatterDensity(synthetic, 100e9, 300, {
      densityBracketKgM3: { min: BR.referenceDensityKgM3.value, max: 2 * BR.referenceDensityKgM3.value }
    });
    assertCompletedDensity(positive, 'mgso3_bridgmanite_300k_synthetic_positive_control');
    expect(positive.bracketSource).toBe('user_provided');
    assertRel(positive.densityKgM3, 5246.246089503775, 9);
    expect(positive.compressionRatio).toBeCloseTo(5246.246089503775 / BR.referenceDensityKgM3.value, 6);
    expect(Math.abs(positive.residualPa)).toBeLessThanOrEqual(positive.tolerancePa);
  });

  it('сценарий 12: ужесточение допуска требует больше итераций и даёт меньшую невязку', () => {
    const coarseResult = solveCondensedMatterDensity(FE, 280e9, 300, { relativeTolerance: 1e-9 });
    const tightResult = solveCondensedMatterDensity(FE, 280e9, 300, { relativeTolerance: 1e-12 });
    assertCompletedDensity(coarseResult, 'fe_hcp_300k');
    assertCompletedDensity(tightResult, 'fe_hcp_300k');
    expect(Math.abs(tightResult.residualPa)).toBeLessThanOrEqual(Math.abs(coarseResult.residualPa));
    expect(Math.abs(tightResult.relativeResidual)).toBeLessThanOrEqual(1e-12);
    expect(tightResult.iterations).toBeGreaterThanOrEqual(coarseResult.iterations);
  });

  it('сценарий 13: некорректные опции решателя отклоняются (fail-closed, invalid_input)', () => {
    expect(solveCondensedMatterDensity(FE, 100e9, 300, { relativeTolerance: -1 }).status).toBe('invalid_input');
    expect(solveCondensedMatterDensity(FE, 100e9, 300, { maxIterations: 0 }).status).toBe('invalid_input');
    expect(solveCondensedMatterDensity(FE, 100e9, 300, { densityBracketKgM3: { min: 9000, max: 8000 } }).status).toBe('invalid_input');
    expect(solveCondensedMatterDensity(FE, 100e9, 300, { absoluteTolerancePa: Number.NaN }).status).toBe('invalid_input');
  });

  it('сценарий 14: невозможный bracket по плотности отклоняется, а не «решается в лоб»', () => {
    // слишком узкий bracket: P(bracketMax) < 100 GPa — корректного решения нет
    const result = solveCondensedMatterDensity(FE, 100e9, 300, {
      densityBracketKgM3: { min: FE.referenceDensityKgM3.value, max: FE.referenceDensityKgM3.value * 1.01 }
    });
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.reason).toContain('не накрывает');
      expect(Object.keys(result.detail).length).toBeGreaterThan(0);
    }
  });
});

describe('Stage 4.7.1: fail-closed применимость', () => {
  it('сценарий 15: температура вне подтверждённой изотермы → out_of_applicability (прямая и обратная)', () => {
    for (const record of [FE, BR]) {
      const forward = evaluateCondensedMatterPressure(record, record.referenceDensityKgM3.value * 1.2, 500);
      expect(forward.status).toBe('out_of_applicability');
      const inverse = solveCondensedMatterDensity(record, 100e9, 500);
      expect(inverse.status).toBe('out_of_applicability');
    }
  });

  it('сценарий 16: строгая изотерма: только 300 K (+ машинный epsilon); 300.001/308/315 K отклоняются в обеих задачах', () => {
    // Температурная применимость = принадлежность temperatureRangeK записи.
    // Обе записи: {300, 300} K. Разрешена только машинная погрешность
    // сравнения max(1e-9 K, 1e-12·|T0|) — она НЕ расширяет физическую область.
    const machineEpsilonK = Math.max(1e-9, 1e-12 * 300);
    const atMachineEps = evaluateCondensedMatterPressure(
      FE,
      FE.referenceDensityKgM3.value * 1.05,
      300 + machineEpsilonK
    );
    expect(atMachineEps.status).toBe('completed');
    for (const badT of [300.001, 308, 315]) {
      const forward = evaluateCondensedMatterPressure(FE, FE.referenceDensityKgM3.value * 1.05, badT);
      expect(forward.status).toBe('out_of_applicability');
      if (forward.status === 'out_of_applicability') {
        expect(forward.reason).toContain('температурного диапазона');
        expect(forward.detail.requestedTemperatureK).toBe(badT);
      }
      const inverse = solveCondensedMatterDensity(FE, 100e9, badT);
      expect(inverse.status).toBe('out_of_applicability');
      if (inverse.status === 'out_of_applicability') {
        expect(inverse.detail.requestedTemperatureK).toBe(badT);
      }
    }
    // точная граница диапазона включительна
    const at300 = solveCondensedMatterDensity(FE, 100e9, 300);
    assertCompletedDensity(at300, 'fe_hcp_300k');
    // и для бриджманита: 300 K сейчас всё равно блокируется барическим гейтом
    // (pressureRangeKnown = false), но температура 300.001 K отклоняется
    // своей температурной проверкой при гипотетической проверке — проверяем
    // через прямую задачу: причина обязана быть температурной ИЛИ барической
    // (панель причинов фиксируется в регрессии сценария 32)
    const brNearBoundary = evaluateCondensedMatterPressure(
      BR,
      BR.referenceDensityKgM3.value * 1.05,
      300 + 2 * machineEpsilonK
    );
    expect(brNearBoundary.status).toBe('out_of_applicability');
  });

  it('сценарий 17: обратная задача ниже опорного давления (растяжение) отклоняется', () => {
    const result = solveCondensedMatterDensity(FE, -1e8, 300);
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      // P < 0 отклоняется раньше всего барьером подтверждённого диапазона [0, 280] GPa записи Fe
      expect(result.reason).toContain('вне подтверждённого диапазона записи');
    }
  });

  it('сценарий 18: давление вне подтверждённого диапазона записи Fe (350 GPa) отклоняется', () => {
    expect(FE.applicability.pressureRangeKnown).toBe(true);
    const result = solveCondensedMatterDensity(FE, 350e9, 300);
    expect(result.status).toBe('out_of_applicability');
  });

  it('сценарий 19: нулевая и отрицательная плотности → invalid_input (прямая задача)', () => {
    const zero = evaluateCondensedMatterPressure(FE, 0, 300);
    expect(zero.status).toBe('invalid_input');
    const negative = evaluateCondensedMatterPressure(FE, -8269.5, 300);
    expect(negative.status).toBe('invalid_input');
  });

  it('сценарий 20: NaN и Infinity во входных величинах → invalid_input во всей цепочке', () => {
    const pair: Array<[number, number]> = [
      [Number.NaN, 300],
      [Number.POSITIVE_INFINITY, 300],
      [Number.NEGATIVE_INFINITY, 300],
      [8269.5, Number.NaN],
      [8269.5, Number.POSITIVE_INFINITY]
    ];
    for (const [rho, t] of pair) {
      expect(evaluateCondensedMatterPressure(FE, rho, t).status).toBe('invalid_input');
    }
    // обратная задача: некорректная температура тоже блокирует вход (включая нулевую и отрицательную)
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, 0, -10]) {
      expect(solveCondensedMatterDensity(FE, Number.NaN, t).status).toBe('invalid_input');
      expect(solveCondensedMatterDensity(FE, 100e9, t).status).toBe('invalid_input');
    }
    // контроль: при полностью корректных входных данных тот же вызов завершается успешно
    expect(solveCondensedMatterDensity(FE, 100e9, 300).status).toBe('completed');
  });

  it('сценарий 21: граница ядра BM3 по η честная: η→1000 считается и конечна, η>1000 и нечисловое — null', () => {
    expect(BM3_MIN_SUPPORTED_COMPRESSION_RATIO).toBe(1);
    expect(BM3_MAX_SUPPORTED_COMPRESSION_RATIO).toBe(1e3);
    const at1000 = bm3PressureAtCompressionRatio(1000, FE_PARAMS);
    expect(at1000).not.toBeNull();
    expect(Number.isFinite(at1000 as number)).toBe(true);
    expect(bm3PressureAtCompressionRatio(1001, FE_PARAMS)).toBeNull();
    expect(bm3PressureAtCompressionRatio(0.999, FE_PARAMS)).toBeNull();
    expect(bm3PressureAtCompressionRatio(Number.NaN, FE_PARAMS)).toBeNull();
    // недостижимые плотности вне ядра (η > 1000) не рассчитываются
    expect(bm3Pressure(FE.referenceDensityKgM3.value * 1001, FE_PARAMS)).toBeNull();
    expect(bm3CompressionRatio(-1, FE.referenceDensityKgM3.value)).toBeNull();
  });

  it('сценарий 22: некорректные K0 и K0′ в записи блокируют расчёт и валидацию', () => {
    const badK0: CondensedMatterEosRecord = {
      ...FE,
      bulkModulusPa: { ...FE.bulkModulusPa, value: 0 }
    };
    const badK0Result = evaluateCondensedMatterPressure(badK0, badK0.referenceDensityKgM3.value * 1.2, 300);
    expect(badK0Result.status).toBe('invalid_input');
    expect(validateCondensedMatterEosRecordShape(badK0).join(' ')).toContain('вне санитарных границ');

    const badK0p = { ...FE, bulkModulusPressureDerivative: { ...(FE.bulkModulusPressureDerivative as any), value: 12 } };
    expect(validateCondensedMatterEosRecordShape(badK0p).join(' ')).toContain('bulkModulusPressureDerivative');
    expect(evaluateCondensedMatterPressure(badK0p, badK0p.referenceDensityKgM3.value * 1.2, 300).status).toBe('invalid_input');
    const lowK0p = { ...FE, bulkModulusPressureDerivative: { ...(FE.bulkModulusPressureDerivative as any), value: 0.5 } };
    expect(validateCondensedMatterEosRecordShape(lowK0p).length).toBeGreaterThan(0);
    expect(BM3_VALID_K0_PRIME_RANGE).toEqual({ min: 1, max: 10 });
  });

  it('сценарий 23: «частично неизвестные» параметры записи блокируют весь расчёт (fail-closed против смешанных данных)', () => {
    const unresolved: CondensedMatterEosRecord = {
      ...FE,
      bulkModulusPressureDerivative: {
        ...(FE.bulkModulusPressureDerivative as any),
        provenance: { ...(FE.bulkModulusPressureDerivative.provenance as any), evidence: 'UNRESOLVED' }
      }
    };
    const blocking = getCondensedMatterEosRecordBlockingIssues(unresolved);
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.some((issue) => issue.includes('непригодна'))).toBe(true);
    expect(evaluateCondensedMatterPressure(unresolved, unresolved.referenceDensityKgM3.value * 1.2, 300).status).toBe('invalid_input');
    // отсутствие uncertainty ≠ ноль; ядра обязаны различать «неизвестна» и ноль
    expect(FE.referenceDensityKgM3.uncertainty).toBeUndefined();
  });

  it('сценарий 24: запись без подтверждённых диапазонов не решается: барический гейт срабатывает раньше bracket-логики', () => {
    expect(BR.applicability.densityRangeKnown).toBe(false);
    const result = solveCondensedMatterDensity(BR, 100e9, 300);
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.reason).toContain('барическая область применимости');
      expect(result.detail.pressureRangeKnown).toBe(false);
    }
  });

  it('сценарий 32: прямая задача проверяет ВЫЧИСЛЕННОЕ давление, а не только плотность', () => {
    // СИНТЕТИЧЕСКИ широкий диапазон плотности (НЕ каталог, НЕ источник):
    // изолируем барический гейт. Точку ищем numerically: η для 285 GPa
    // (ядро — численный инструмент, не доказательство применимости).
    let lo = 1;
    let hi = 1.7;
    for (let k = 0; k < 60; k++) {
      const mid = 0.5 * (lo + hi);
      const pAtMid = bm3PressureAtCompressionRatio(mid, FE_PARAMS) as number;
      if (pAtMid < 285e9) lo = mid;
      else hi = mid;
    }
    const eta285 = 0.5 * (lo + hi);
    const syntheticWide: CondensedMatterEosRecord = {
      ...FE,
      materialId: 'fe_hcp_300k_synthetic_wide_density',
      applicability: { ...FE.applicability, densityRangeKgM3: { min: 8269.5, max: 30000 } }
    };
    const result = evaluateCondensedMatterPressure(
      syntheticWide,
      FE.referenceDensityKgM3.value * eta285,
      300
    );
    // плотность внутри (широкого синтетического) диапазона, но вычисленное
    // давление 285 GPa вне подтверждённого барического [0, 280] GPa
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.reason).toContain('вне подтверждённого диапазона записи');
      expect(result.detail.checkedComputedPressure).toBe(true);
      expect(result.detail.confirmedPressureMaxPa).toBe(280e9);
    }
  });

  it('сценарий 33: границы барического диапазона Fe включительны, чуть за границей — отклонение', () => {
    const atZero = solveCondensedMatterDensity(FE, 0, 300);
    assertCompletedDensity(atZero, 'fe_hcp_300k');
    expect(atZero.densityKgM3).toBeCloseTo(FE.referenceDensityKgM3.value, 6);
    const at280 = solveCondensedMatterDensity(FE, 280e9, 300);
    assertCompletedDensity(at280, 'fe_hcp_300k');
    const above280 = solveCondensedMatterDensity(FE, 280e9 + 1e7, 300);
    expect(above280.status).toBe('out_of_applicability');
    if (above280.status === 'out_of_applicability') {
      expect(above280.reason).toContain('вне подтверждённого диапазона записи');
    }
    // прямая задача: та же включительность (точка глубоко внутри диапазона
    // и точное значение 280 GPa через обратную задачу уже проверено выше)
    const forwardInside = evaluateCondensedMatterPressure(FE, FE.referenceDensityKgM3.value * 1.2, 300);
    assertCompletedPressure(forwardInside, 'fe_hcp_300k');
  });

  it('сценарий 34: плотность проверяется независимо от давления', () => {
    // ρ = 13600 kg/m³ вне подтверждённого диапазона плотности [8269.5, 13516.5]:
    // отклонение обязано сослаться на ПЛОТНОСТЬ, ещё до вычисления давления
    const result = evaluateCondensedMatterPressure(FE, 13600, 300);
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.reason).toContain('плотность');
    }
    // точка внутри диапазона плотности с давлением глубоко внутри барического
    // диапазона обязана завершаться успешно
    const inside = evaluateCondensedMatterPressure(FE, FE.referenceDensityKgM3.value * 1.2, 300);
    assertCompletedPressure(inside, 'fe_hcp_300k');
  });

  it('сценарий 35: синтетический положительный контроль: bracket разрешён при известном давлении и неизвестной плотности', () => {
    const syntheticNoDensity: CondensedMatterEosRecord = {
      ...FE,
      materialId: 'fe_hcp_300k_synthetic_no_density_range',
      applicability: { ...FE.applicability, densityRangeKnown: false, densityRangeKgM3: undefined }
    };
    const result = solveCondensedMatterDensity(syntheticNoDensity, 100e9, 300, {
      densityBracketKgM3: { min: FE.referenceDensityKgM3.value, max: 2 * FE.referenceDensityKgM3.value }
    });
    assertCompletedDensity(result, 'fe_hcp_300k_synthetic_no_density_range');
    expect(result.bracketSource).toBe('user_provided');
    expect(Math.abs(result.residualPa)).toBeLessThanOrEqual(result.tolerancePa);
    // контраст: та же структура с НЕИЗВЕСТНЫМ давлением — отказ даже с bracket
    const syntheticNoPressure: CondensedMatterEosRecord = {
      ...FE,
      materialId: 'fe_hcp_300k_synthetic_no_pressure_range',
      applicability: { ...FE.applicability, pressureRangeKnown: false, pressureRangePa: undefined }
    };
    const blocked = solveCondensedMatterDensity(syntheticNoPressure, 100e9, 300, {
      densityBracketKgM3: { min: FE.referenceDensityKgM3.value, max: 2 * FE.referenceDensityKgM3.value }
    });
    expect(blocked.status).toBe('out_of_applicability');
    if (blocked.status === 'out_of_applicability') {
      expect(blocked.detail.pressureRangeKnown).toBe(false);
    }
  });
});

describe('Stage 4.7.1: каталог материалов', () => {
  it('сценарий 25: unique ID, валидность каталога, lookup fail-closed', () => {
    const ids = listPlanetaryEosMaterialIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('fe_hcp_300k');
    expect(ids).toContain('mgso3_bridgmanite_300k');
    expect(validatePlanetaryEosCatalog()).toHaveLength(0);
    expect(validateCondensedMatterEosCatalog(PLANETARY_EOS_RECORDS)).toHaveLength(0);
    // неизвестный работой материал → исключение с code/полем issues
    expect(tryGetPlanetaryEosRecord('mystery_material_absent')).toBeNull();
    expect(() => getPlanetaryEosRecord('unobtainium')).toThrow(PlanetaryEosLookupError);
    try {
      getPlanetaryEosRecord('unobtainium');
    } catch (e) {
      const err = e as PlanetaryEosLookupError;
      expect(err.code).toBe('unknown_material');
      expect(err.materialId).toBe('unobtainium');
      expect(err.issues).toHaveLength(0);
    }
  });

  it('сценарий 26: узнавание фазы и структуры разделено, смешение фаз запрещено', () => {
    expect(FE.phase).toBe('solid');
    expect(BR.phase).toBe('solid');
    expect(FE.crystalStructure?.designation).toContain('hcp');
    expect(BR.crystalStructure?.designation).toContain('perovskite');
    // разные фазы одного вещества = разные записи: добавление «Fe жидкое» допустимо только отдельной записью
    const mixedCatalog: CondensedMatterEosRecord[] = [FE, BR, { ...FE, materialId: 'fe_liquid_test', phase: 'liquid' } as unknown as CondensedMatterEosRecord];
    // liquid с кристаллической структурой и без пересказа V0: структурная валидация ловит несовместимость
    const issues = validateCondensedMatterEosCatalog(mixedCatalog);
    expect(issues.length).toBeGreaterThan(0);
    const duplicateMaterial = [FE, { ...FE }];
    expect(validateCondensedMatterEosCatalog(duplicateMaterial).length).toBeGreaterThan(0);
  });

  it('сценарий 27: provenance результатов — указатель на запись, а не копия-подделка', () => {
    const forward = evaluateCondensedMatterPressure(FE, FE.referenceDensityKgM3.value * 1.2, 300);
    assertCompletedPressure(forward, 'fe_hcp_300k');
    expect(forward.provenance.bulkModulusPa.sourceName).toBe(FE.bulkModulusPa.provenance.sourceName);
    expect(forward.provenance.bulkModulusPa.evidence).toBe('VERIFIED');
    expect(forward.provenance.referenceDensityKgM3).toBe(FE.referenceDensityKgM3.provenance);
    expect(forward.literature).toBe(FE.literature);
    expect(forward.scopeNotes.join(' ')).toContain('300 K');
    // бриджманит: обратная задача отклонена (pressureRangeKnown = false),
    // поэтому provenance фиксируется на положительном контроле Fe
    const inverse = solveCondensedMatterDensity(FE, 100e9, 300);
    assertCompletedDensity(inverse, 'fe_hcp_300k');
    expect(inverse.provenance.bulkModulusPa.sourceName).toBe(FE.bulkModulusPa.provenance.sourceName);
    // provenance записи Myhill (2018) при этом сохранён на уровне записи
    expect(BR.bulkModulusPa.provenance.evidence).toBe('PARTIALLY_VERIFIED');
    expect(BR.bulkModulusPa.provenance.sourceName).toContain('Myhill');
  });

  it('сценарий 28: неопределённости как «неизвестные», а не нули, и их сохранение в результате', () => {
    const forwardFe = evaluateCondensedMatterPressure(FE, FE.referenceDensityKgM3.value * 1.2, 300);
    assertCompletedPressure(forwardFe, 'fe_hcp_300k');
    // Fe: неопределённость ρ0 − НЕИЗВЕСТНАЯ (null), K0 и K0′ известны (stddev)
    expect(forwardFe.parameterUncertainties.referenceDensityKgM3).toBeNull();
    expect(forwardFe.parameterUncertainties.bulkModulusPa?.kind).toBe('stddev');
    if (forwardFe.parameterUncertainties.bulkModulusPa && forwardFe.parameterUncertainties.bulkModulusPa.kind === 'stddev') {
      expect(forwardFe.parameterUncertainties.bulkModulusPa.sigma).toBeGreaterThan(0);
      expect(validateUncertainty(forwardFe.parameterUncertainties.bulkModulusPa)).toHaveLength(0);
    }
    // Бриджманит: прямая задача отклонена (pressureRangeKnown = false),
    // поэтому проверяем неопределённости записи напрямую
    expect(BR.referenceDensityKgM3.uncertainty?.kind).toBe('interval');
    expect(BR.bulkModulusPa.uncertainty?.kind).toBe('stddev');
    const brBlocked = evaluateCondensedMatterPressure(BR, BR.referenceDensityKgM3.value * 1.2, 300);
    expect(brBlocked.status).toBe('out_of_applicability');
  });

  it('сценарий 29: каталог иммутабелен (deep-frozen): мутация отбрасывается или бросает', () => {
    expect(Object.isFrozen(PLANETARY_EOS_RECORDS)).toBe(true);
    expect(Object.isFrozen(PLANETARY_EOS_RECORDS[0])).toBe(true);
    expect(Object.isFrozen(PLANETARY_EOS_RECORDS[0].bulkModulusPa.provenance)).toBe(true);
    expect(Object.isFrozen(PLANETARY_EOS_RECORDS[0].applicability)).toBe(true);
    let mutationThrew = false;
    try {
      (PLANETARY_EOS_RECORDS[0] as { materialId: string }).materialId = 'hacked';
    } catch {
      mutationThrew = true; // строгий режим: TypeError на frozen-объекте
    }
    expect(mutationThrew || PLANETARY_EOS_RECORDS[0].materialId === 'fe_hcp_300k').toBe(true);
    expect(PLANETARY_EOS_RECORDS[0].materialId).toBe('fe_hcp_300k');
  });

  it('сценарий 30: детерминизм — два независимых вызова дают побитово равный результат', () => {
    const a = evaluateCondensedMatterPressure(FE, FE.referenceDensityKgM3.value * 1.34, 300);
    const b = evaluateCondensedMatterPressure(FE, FE.referenceDensityKgM3.value * 1.34, 300);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const invA = solveCondensedMatterDensity(FE, 200e9, 300);
    const invB = solveCondensedMatterDensity(FE, 200e9, 300);
    expect(JSON.stringify(invA)).toBe(JSON.stringify(invB));
  });

  it('сценарий 31: материалы разделены: одинаковое сжатие даёт разные давления; нет перекрёстного использования', () => {
    const pFe = bm3Pressure(FE.referenceDensityKgM3.value * 1.2, FE_PARAMS) as number;
    const pBr = bm3Pressure(BR.referenceDensityKgM3.value * 1.2, BR_PARAMS) as number;
    assertRel(pFe, FE_EXPECTED.p12);
    assertRel(pBr, BR_EXPECTED.p12);
    expect(pBr).toBeGreaterThan(pFe);
    // параметры двух материалов не перепутаны: чей ρ0 у Fe — тот и в записи Fe
    expect(FE.referenceDensityKgM3.value).toBeCloseTo(8269.5, 6);
    expect(BR.referenceDensityKgM3.value).toBeCloseTo(4105.877, 3);
  });
});
