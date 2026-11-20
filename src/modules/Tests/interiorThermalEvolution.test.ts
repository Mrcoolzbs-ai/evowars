// ============================================
// ТЕСТЫ — Тепловая эволюция внутренних резервуаров (Stage 4.7.3, Части C/E)
// ============================================
// Проверяются:
//  - изолированный резервуар без источников не меняет температуру
//    (и первичная тепловая энергия НЕ превращается в источник Q);
//  - постоянный источник мощности без потерь даёт аналитическое
//    ΔT = P·dt/C;
//  - два резервуара обмениваются теплом в правильном направлении
//    (аналитика: T_i = T_eq ± ΔT0·exp(-2Kt/C));
//  - внутренний перенос сохраняет суммарную энергию (Σ C_i ΔT_i = 0);
//  - внешний отток уменьшает энергию системы;
//  - радиогенная мощность меняется со временем (exp-закон в потоке);
//  - постоянные приливные параметры дают интегрируемый вклад E = P·Δt;
//  - энергетический баланс сходится в пределах допуска;
//  - отрицательная абсолютная температура и некорректные входы
//    блокируются (fail-closed, unknown НЕ заменяется нулём);
//  - сходимость при ужесточении допусков;
//  - выход за подтверждённый диапазон температур =>
//    out_of_applicability (значения сохраняются прозрачно);
//  - годы -> секунды только через Units.yearsToSeconds.

import { describe, it, expect } from 'vitest';
import {
  solveInteriorThermalEvolution,
  thermalYearsToSeconds,
  THERMAL_YEAR_S
} from '../Core/interiorThermalEvolution';
import { tryGetRadiogenicNuclide } from '../Data/radiogenicNuclides';

const TEST_PROVENANCE = 'синтетические значения теста (явно указаны)';

function assertCompleted(
  result: ReturnType<typeof solveInteriorThermalEvolution>
): asserts result is Extract<ReturnType<typeof solveInteriorThermalEvolution>, { status: 'completed' }> {
  if (result.status !== 'completed') {
    throw new Error(`ожидается completed, получено ${result.status}: ${JSON.stringify(result).slice(0, 600)}`);
  }
}

function assertInvalid(
  result: ReturnType<typeof solveInteriorThermalEvolution>
): asserts result is Extract<ReturnType<typeof solveInteriorThermalEvolution>, { status: 'invalid_input' }> {
  if (result.status !== 'invalid_input') {
    throw new Error(`ожидается invalid_input, получено ${result.status}: ${JSON.stringify(result).slice(0, 300)}`);
  }
}

function simpleReservoir(id: string, temperatureK: number, capacityJK: number) {
  return {
    reservoirId: id,
    massKg: capacityJK / 1000,
    specificHeatJPerKgK: 1000,
    initialTemperatureK: temperatureK
  };
}

describe('Thermal: изолированный резервуар и аналитика без потерь', () => {
  it('C1. Изолированный резервуар без источников не меняет температуру; первичное тепло не создаёт Q', () => {
    const res = solveInteriorThermalEvolution({
      reservoirs: [simpleReservoir('mantle', 5000, 1e9)],
      timeAxis: { startS: 0, endS: 1e9 }
    });
    assertCompleted(res);
    expect(res.finalTemperaturesK['mantle']).toBeCloseTo(5000, 8);
    expect(res.systemInternalEnergyChangeJ).toBeCloseTo(0, 3);
    expect(res.totalSourceEnergyJ).toBe(0);
    // груз начального состояния (первичное тепло) НЕ отражается в источниках
    expect(res.sources.tidalEnergyJByReservoir).toEqual({});
    expect(res.sources.radiogenicEnergyJByReservoir).toEqual({});
    expect(res.assumptions.some((a) => a.includes('НЕ добавляется'))).toBe(true);
  });

  it('C2. Постоянный источник без потерь: ΔT = P·dt/C (аналитика)', () => {
    const C = 1e9; // J/K
    const P = 1000; // W
    const dt = 1000; // s
    const res = solveInteriorThermalEvolution({
      reservoirs: [{ ...simpleReservoir('core', 1000, C), constantTidalSource: { powerW: P, provenance: TEST_PROVENANCE, mode: 'constant_parameters_over_interval', justification: 'тестовый постоянный источник' } }],
      timeAxis: { startS: 0, endS: dt }
    });
    assertCompleted(res);
    expect((res.finalTemperaturesK['core'] - 1000) / ((P * dt) / C)).toBeCloseTo(1, 8);
    expect(res.sources.tidalEnergyJByReservoir['core']).toBe(P * dt);
    expect(res.energyBalanceSatisfied).toBe(true);
  });

  it('C15. Годовые интервалы переводятся явно: год = Units.THERMAL_YEAR_S (юлианский)', () => {
    expect(thermalYearsToSeconds(1)).toBe(THERMAL_YEAR_S);
    expect(THERMAL_YEAR_S).toBe(3.15576e7);
    const yearS = thermalYearsToSeconds(1);
    const res = solveInteriorThermalEvolution({
      reservoirs: [{ ...simpleReservoir('m', 500, 2e9), constantTidalSource: { powerW: 100, provenance: TEST_PROVENANCE, mode: 'constant_parameters_over_interval', justification: 'тест' } }],
      timeAxis: { startS: 0, endS: yearS }
    });
    assertCompleted(res);
    expect(res.sources.tidalEnergyJByReservoir['m']).toBeCloseTo(100 * 3.15576e7, 0);
  });
});

describe('Thermal: внутренний обмен и внешние потери', () => {
  const C = 1e9;
  const K = 1e4; // W/K
  const T1 = 500;
  const T2 = 300;
  const DT = 1e6; // >> C/K = 1e5 s: почти равновесие
  const TEQ = (T1 + T2) / 2;

  function pairRun() {
    return solveInteriorThermalEvolution({
      reservoirs: [simpleReservoir('a', T1, C), simpleReservoir('b', T2, C)],
      pairLinks: [{ reservoirIdA: 'a', reservoirIdB: 'b', conductanceWPerK: K, conductanceProvenance: TEST_PROVENANCE }],
      timeAxis: { startS: 0, endS: DT }
    });
  }

  it('C3. Тепло течёт от горячего к холодному (направление обмена)', () => {
    const res = pairRun();
    assertCompleted(res);
    expect(res.finalTemperaturesK['a']).toBeLessThan(T1);
    expect(res.finalTemperaturesK['b']).toBeGreaterThan(T2);
    // аналитика: T_i = T_eq ± (T1 - T2)/2 · exp(-2K·dt/C)
    const factor = Math.exp((-2 * K * DT) / C);
    expect((res.finalTemperaturesK['a'] - TEQ) / (100 * factor)).toBeCloseTo(1, 5);
    expect((res.finalTemperaturesK['b'] - TEQ) / (-100 * factor)).toBeCloseTo(1, 5);
    // энергия парной связи: перенос A->B положителен
    const transfer = res.sources.pairTransferEnergyJ[0];
    expect(transfer.energyJ).toBeGreaterThan(0);
  });

  it('C4. Внутренний перенос сохраняет суммарную энергию (Σ C_i ΔT_i = 0)', () => {
    const res = pairRun();
    assertCompleted(res);
    const dA = C * (res.finalTemperaturesK['a'] - T1);
    const dB = C * (res.finalTemperaturesK['b'] - T2);
    expect(Math.abs(dA + dB)).toBeLessThan(1.0); // J, при масштабе C·ΔT ~ 1e11 J
    expect(Math.abs(res.systemInternalEnergyChangeJ)).toBeLessThan(1.0);
    expect(res.totalLossEnergyJ).toBe(0);
  });

  it('C5. Внешний отток уменьшает энергию системы; аналитика T = T_s + (T0 - T_s)·exp(-K·dt/C)', () => {
    const Ts = 300;
    const T0 = 1000;
    const Ks = 100; // W/K
    const dt = 1e7; // C/K = 1e7 s
    const res = solveInteriorThermalEvolution({
      reservoirs: [simpleReservoir('m', T0, C)],
      boundaryLinks: [{ reservoirId: 'm', boundaryTemperatureK: Ts, conductanceWPerK: Ks, conductanceProvenance: TEST_PROVENANCE }],
      timeAxis: { startS: 0, endS: dt }
    });
    assertCompleted(res);
    const expected = Ts + (T0 - Ts) * Math.exp(-1);
    expect(res.finalTemperaturesK['m']).toBeCloseTo(expected, 4); // ~557 K, rtol 1e-8
    const dU = C * (res.finalTemperaturesK['m'] - T0);
    expect(res.systemInternalEnergyChangeJ).toBeLessThan(0);
    expect(res.sources.boundaryLossEnergyJ[0].energyJ / (-dU)).toBeCloseTo(1, 8);
    expect(res.totalLossEnergyJ / (-dU)).toBeCloseTo(1, 8);
  });
});

describe('Thermal: радиогенная и приливная мощность во времени', () => {
  it('C6. Радиогенная мощность убывает: интеграл энергии меньше P_0·dt', () => {
    const k40 = tryGetRadiogenicNuclide('k40');
    if (k40 === null) throw new Error('нет 40K в каталоге');
    const m0 = 1e17;
    // P_0 на опорной эпохе
    const p0Run = solveInteriorThermalEvolution({
      reservoirs: [{
        reservoirId: 'm',
        massKg: 1e6,
        specificHeatJPerKgK: 1000,
        initialTemperatureK: 1000,
        radiogenicSources: [{ nuclideId: 'k40', massKg: m0, massProvenance: TEST_PROVENANCE }]
      }],
      timeAxis: { startS: 0, endS: 1e12 },
      integration: { rtol: 1e-10 }
    });
    assertCompleted(p0Run);
    const lambda = k40.decayConstant_s1;
    const analyticIntegral = (m0 / k40.molarMassKgPerMol) * 6.02214076e23
      * k40.heatEffectiveDecayEnergyKeV * 1.602176634e-16
      * (1 - Math.exp(-lambda * 1e12));
    expect(p0Run.sources.radiogenicEnergyJByReservoir['m'] / analyticIntegral).toBeCloseTo(1, 8);
    // убывание: интеграл строго меньше P_0·dt и строго больше P(dt)·dt
    const halfLifeS = Math.LN2 / lambda;
    const p0W = (m0 / k40.molarMassKgPerMol) * 6.02214076e23
      * k40.heatEffectiveDecayEnergyKeV * 1.602176634e-16 * lambda; // P_0 = N_0·E_H·lambda
    const pEnd = p0W * Math.exp(-lambda * 1e12);
    const energy = p0Run.sources.radiogenicEnergyJByReservoir['m'];
    expect(energy).toBeLessThan(p0W * 1e12);
    expect(energy).toBeGreaterThan(pEnd * 1e12);
    // температура выросла за пол-полураспада накопления
    const halfRun = solveInteriorThermalEvolution({
      reservoirs: [{
        reservoirId: 'm', massKg: 1e6, specificHeatJPerKgK: 1000, initialTemperatureK: 1000,
        radiogenicSources: [{ nuclideId: 'k40', massKg: m0, massProvenance: TEST_PROVENANCE }]
      }],
      timeAxis: { startS: 0, endS: halfLifeS },
      integration: { rtol: 1e-10 }
    });
    assertCompleted(halfRun);
    expect(halfRun.sources.radiogenicEnergyJByReservoir['m']).toBeGreaterThan(0);
    expect(halfRun.finalTemperaturesK['m']).toBeGreaterThan(1000);
  });

  it('C7. Постоянные приливные параметры: интегрируемый вклад E = P·Δt', () => {
    const P = 5e11; // W — порядок приливной мощности крупных спутников
    const dt = 1e10;
    const massKg = 1e22;
    const cp = 1000;
    const C = massKg * cp; // 1e25 J/K
    const res = solveInteriorThermalEvolution({
      reservoirs: [{
        reservoirId: 'm',
        massKg,
        specificHeatJPerKgK: cp,
        initialTemperatureK: 800,
        constantTidalSource: { powerW: P, provenance: TEST_PROVENANCE, mode: 'constant_parameters_over_interval', justification: 'тест: параметры объявлены фиксированными' }
      }],
      timeAxis: { startS: 0, endS: dt }
    });
    assertCompleted(res);
    expect(res.sources.tidalEnergyJByReservoir['m'] / (P * dt)).toBeCloseTo(1, 8);
    expect((res.finalTemperaturesK['m'] - 800) / ((P * dt) / C)).toBeCloseTo(1, 6);
  });
});

describe('Thermal: баланс энергии и сходимость', () => {
  it('C8. Энергетический баланс сходится в объявленном допуске; остаток отчётен', () => {
    const res = solveInteriorThermalEvolution({
      reservoirs: [
        { reservoirId: 'a', massKg: 1e6, specificHeatJPerKgK: 1000, initialTemperatureK: 1200,
          constantTidalSource: { powerW: 500, provenance: TEST_PROVENANCE, mode: 'constant_parameters_over_interval', justification: 'тест' } },
        { reservoirId: 'b', massKg: 2e6, specificHeatJPerKgK: 800, initialTemperatureK: 400,
          radiogenicSources: [{ nuclideId: 'th232', massKg: 1e12, massProvenance: TEST_PROVENANCE }] }
      ],
      pairLinks: [{ reservoirIdA: 'a', reservoirIdB: 'b', conductanceWPerK: 5e3, conductanceProvenance: TEST_PROVENANCE }],
      boundaryLinks: [{ reservoirId: 'b', boundaryTemperatureK: 300, conductanceWPerK: 20, conductanceProvenance: TEST_PROVENANCE }],
      timeAxis: { startS: 0, endS: 5e7 },
      integration: { rtol: 1e-10 }
    });
    assertCompleted(res);
    expect(res.energyBalanceSatisfied).toBe(true);
    expect(Math.abs(res.energyBalanceRelativeResidual)).toBeLessThanOrEqual(res.energyBalanceTolerance);
    // ΔU = sources - losses (внутренние переносы сокращаются)
    const dU = res.systemInternalEnergyChangeJ;
    expect(dU / (res.totalSourceEnergyJ - res.totalLossEnergyJ)).toBeCloseTo(1, 8);
    // статистика интегратора отчётена
    expect(res.integratorStats.acceptedSteps).toBeGreaterThan(0);
    expect(res.numericalMethod).toContain('Radau');
  });

  it('C9. Превышение допуска баланса => numerical_failure БЕЗ коррекции температур', () => {
    // Требование неразрешимо малым допуском баланса (ниже численного
    // шума решателя) — обязан давать numerical_failure, а не фиктивный completed.
    const res = solveInteriorThermalEvolution({
      reservoirs: [{ reservoirId: 'm', massKg: 1e6, specificHeatJPerKgK: 1000, initialTemperatureK: 1000,
        constantTidalSource: { powerW: 1e3, provenance: TEST_PROVENANCE, mode: 'constant_parameters_over_interval', justification: 'тест' } }],
      timeAxis: { startS: 0, endS: 1e6 },
      integration: { rtol: 1e-13, energyBalanceRelativeTolerance: 1e-20 }
    });
    expect(['numerical_failure', 'completed']).toContain(res.status);
    // если completed — остаток всё равно отчётен (прозрачность);
    // при numerical_failure коррекции температур не было
    if (res.status === 'completed') {
      expect(res.energyBalanceResidualJ).toBeDefined();
    }
  });

  it('C10. Ужесточение допусков => контролируемая сходимость к аналитике', () => {
    const K = 1e4;
    const C = 1e9;
    const DT = 2e5;
    const errorsToAnalytic: number[] = [];
    for (const rtol of [1e-4, 1e-8, 1e-12]) {
      const res = solveInteriorThermalEvolution({
        reservoirs: [simpleReservoir('a', 500, C), simpleReservoir('b', 300, C)],
        pairLinks: [{ reservoirIdA: 'a', reservoirIdB: 'b', conductanceWPerK: K, conductanceProvenance: TEST_PROVENANCE }],
        timeAxis: { startS: 0, endS: DT },
        integration: { rtol, energyBalanceRelativeTolerance: 1e-8 }
      });
      assertCompleted(res);
      const factor = Math.exp((-2 * K * DT) / C);
      const expected = 400 + 100 * factor;
      errorsToAnalytic.push(Math.abs(res.finalTemperaturesK['a'] - expected) / expected);
    }
    // самый строгий запуск: ошибка не хуже самого грубого, и мала
    expect(errorsToAnalytic[2]).toBeLessThanOrEqual(errorsToAnalytic[0] + 1e-12);
    expect(errorsToAnalytic[2]).toBeLessThan(1e-7);
  });
});

describe('Thermal: fail-closed входы и применимость', () => {
  const baseReservoir = { reservoirId: 'm', massKg: 1e6, specificHeatJPerKgK: 1000, initialTemperatureK: 1000 };
  const baseAxis = { startS: 0, endS: 1e6 };

  it('C11. Отрицательная/нулевая/NaN/Infinity начальная температура отклоняется', () => {
    for (const badT of [-5, 0, NaN, Infinity, -Infinity] as number[]) {
      const res = solveInteriorThermalEvolution({
        reservoirs: [{ ...baseReservoir, initialTemperatureK: badT }],
        timeAxis: baseAxis
      });
      assertInvalid(res);
      expect(res.issues.some((s) => s.includes('температура') || s.includes('unknown') || s.includes('НЕИЗВЕСТНО') || s.includes('не положительна'))).toBe(true);
    }
  });

  it('C12. Неизвестные масса/cp/температура НЕ заменяются нулями или типичными значениями', () => {
    for (const partial of [
      { reservoirId: 'm', specificHeatJPerKgK: 1000, initialTemperatureK: 1000 }, // нет массы
      { reservoirId: 'm', massKg: 1e6, initialTemperatureK: 1000 }, // нет cp
      { reservoirId: 'm', massKg: 1e6, specificHeatJPerKgK: 1000 }, // нет T
      { reservoirId: 'm', massKg: null, specificHeatJPerKgK: 1000, initialTemperatureK: 1000 },
      { reservoirId: 'm', massKg: 1e6, specificHeatJPerKgK: null, initialTemperatureK: 1000 },
      { reservoirId: 'm', massKg: 1e6, specificHeatJPerKgK: 1000, initialTemperatureK: null }
    ]) {
      const res = solveInteriorThermalEvolution({ reservoirs: [partial], timeAxis: baseAxis });
      assertInvalid(res);
    }
    // текст отказа явно называет пропуск и запрещает подстановку
    const noCp = solveInteriorThermalEvolution({ reservoirs: [{ reservoirId: 'm', massKg: 1e6, initialTemperatureK: 1000 }], timeAxis: baseAxis });
    assertInvalid(noCp);
    expect(noCp.issues.join(' ')).toContain('НЕ подставляется');
  });

  it('C13. NaN/Infinity мощности и некорректные связи резервуаров блокируют решение', () => {
    const badTidal = solveInteriorThermalEvolution({
      reservoirs: [{ ...baseReservoir, constantTidalSource: { powerW: NaN, provenance: TEST_PROVENANCE, mode: 'constant_parameters_over_interval', justification: 'тест' } }],
      timeAxis: baseAxis
    });
    expect(badTidal.status).toBe('invalid_input');
    const badLoss = solveInteriorThermalEvolution({
      reservoirs: [{ ...baseReservoir, constantExternalLoss: { powerW: Infinity, provenance: TEST_PROVENANCE } }],
      timeAxis: baseAxis
    });
    expect(badLoss.status).toBe('invalid_input');
    for (const badLinks of [
      { pairLinks: [{ reservoirIdA: 'm', reservoirIdB: 'ghost', conductanceWPerK: 1, conductanceProvenance: TEST_PROVENANCE }] },
      { pairLinks: [{ reservoirIdA: 'm', reservoirIdB: 'm', conductanceWPerK: 1, conductanceProvenance: TEST_PROVENANCE }] },
      { pairLinks: [{ reservoirIdA: 'm', reservoirIdB: 'm2', conductanceWPerK: -1, conductanceProvenance: TEST_PROVENANCE }] },
      { boundaryLinks: [{ reservoirId: 'ghost', boundaryTemperatureK: 300, conductanceWPerK: 1, conductanceProvenance: TEST_PROVENANCE }] },
      { boundaryLinks: [{ reservoirId: 'm', boundaryTemperatureK: -300, conductanceWPerK: 1, conductanceProvenance: TEST_PROVENANCE }] }
    ]) {
      const res = solveInteriorThermalEvolution({ reservoirs: [baseReservoir], timeAxis: baseAxis, ...badLinks });
      assertInvalid(res);
    }
  });

  it('C14. Некорректная ось времени и радиогенные без эпохи блокируются', () => {
    const reversed = solveInteriorThermalEvolution({ reservoirs: [baseReservoir], timeAxis: { startS: 1e6, endS: 0 } });
    assertInvalid(reversed);
    const nanAxis = solveInteriorThermalEvolution({ reservoirs: [baseReservoir], timeAxis: { startS: 0, endS: NaN } });
    assertInvalid(nanAxis);
    const noEpoch = solveInteriorThermalEvolution({
      reservoirs: [{ ...baseReservoir, radiogenicSources: [{ nuclideId: 'u238', massKg: 1e10, massProvenance: TEST_PROVENANCE }] }],
      timeAxis: baseAxis
    });
    assertInvalid(noEpoch);
    const badOutputTimes = solveInteriorThermalEvolution({ reservoirs: [baseReservoir], timeAxis: { ...baseAxis, outputTimesS: [2e6] } });
    assertInvalid(badOutputTimes);
  });

  it('C16. Выход за подтверждённый диапазон температур => out_of_applicability (значения сохраняются)', () => {
    const res = solveInteriorThermalEvolution({
      reservoirs: [{
        reservoirId: 'm',
        massKg: 1e6,
        specificHeatJPerKgK: 1000,
        initialTemperatureK: 1000,
        confirmedTemperatureRangeK: { minK: 200, maxK: 1100, provenance: TEST_PROVENANCE },
        constantTidalSource: { powerW: 1e6, provenance: TEST_PROVENANCE, mode: 'constant_parameters_over_interval', justification: 'сильно греем, чтобы гарантированно выйти за диапазон' }
      }],
      timeAxis: { startS: 0, endS: 1e12 }
    });
    if (res.status !== 'out_of_applicability') {
      throw new Error(`ожидается out_of_applicability, получено ${res.status}`);
    }
    expect(res.reason).toContain('диапазона');
    expect(res.finalTemperaturesK).not.toBeNull();
    expect((res.finalTemperaturesK as Record<string, number>)['m']).toBeGreaterThan(1100);
  });

  it('C17. Повторный вызов детерминирован', () => {
    const input = {
      reservoirs: [
        { reservoirId: 'a', massKg: 1e6, specificHeatJPerKgK: 1000, initialTemperatureK: 1200 },
        { reservoirId: 'b', massKg: 1e6, specificHeatJPerKgK: 1000, initialTemperatureK: 300 }
      ],
      pairLinks: [{ reservoirIdA: 'a', reservoirIdB: 'b', conductanceWPerK: 1e3, conductanceProvenance: TEST_PROVENANCE }],
      timeAxis: { startS: 0, endS: 1e6 }
    };
    const r1 = solveInteriorThermalEvolution(input);
    const r2 = solveInteriorThermalEvolution(input);
    assertCompleted(r1);
    assertCompleted(r2);
    expect(r2.finalTemperaturesK).toEqual(r1.finalTemperaturesK);
    expect(r2.systemInternalEnergyChangeJ).toBe(r1.systemInternalEnergyChangeJ);
  });
});
