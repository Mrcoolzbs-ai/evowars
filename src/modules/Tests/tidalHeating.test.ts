// ============================================
// ТЕСТЫ — Приливная диссипация синхронного спутника (Stage 4.7.3, Часть B/E)
// ============================================
// Проверяются:
//  - независимый аналитический эталон формулы Cuk et al. (2024):
//    Edot = (3/2)·n^5·R^5/G·(k2/Q)·(7e^2 + sin^2(theta));
//  - нулевая диссипация при нулевом возбуждении (e = 0, theta = 0);
//  - квадратичная зависимость от e в режиме применимости;
//  - масштабирование n^5 и R^5;
//  - fail-closed: Q = 0, отрицательные параметры, NaN/Infinity;
//  - отсутствие k2 или Q НЕ даёт completed (значения других тел не
//    подставляются);
//  - несинхронный спиновый режим блокируется;
//  - нет экстраполяции за объявленными пределами малости
//    (e > 0.1, theta > 0.5 rad) и за физическим пределом k2 > 1.5;
//  - n = sqrt(G·M_p/a^3) при вычислении из орбиты;
//  - режим constant_parameters_over_interval даёт E = P·Δt, режим
//    snapshot НЕ утверждает постоянства во времени.

import { describe, it, expect } from 'vitest';
import {
  computeSynchronousSatelliteTidalHeating,
  TIDAL_MODEL_APPLICABILITY_LIMITS,
  LOVE_NUMBER_K2_PHYSICAL_LIMIT,
  type TidalHeatingInput
} from '../Core/tidalHeating';
import { G } from '../Units';

const SYNTHETIC_PROVENANCE = 'синтетические значения для теста формулы (не реальные тела)';

function validInput(overrides?: Partial<TidalHeatingInput>): TidalHeatingInput {
  return {
    meanMotionRadS: 2.0e-5,
    satelliteRadiusM: 1.0e6,
    eccentricity: 0.01,
    obliquityRad: 0.0,
    spinState: { kind: 'synchronous_declared', source: { provenance: SYNTHETIC_PROVENANCE } },
    loveNumberK2: 0.3,
    qualityFactorQ: 100,
    orbitalProvenance: SYNTHETIC_PROVENANCE,
    rheologyProvenance: SYNTHETIC_PROVENANCE,
    ...overrides
  };
}

function assertCompleted(
  result: ReturnType<typeof computeSynchronousSatelliteTidalHeating>
): asserts result is Extract<ReturnType<typeof computeSynchronousSatelliteTidalHeating>, { status: 'completed' }> {
  if (result.status !== 'completed') {
    throw new Error(`ожидается completed, получено ${result.status}`);
  }
}

function assertOutOfApplicability(
  result: ReturnType<typeof computeSynchronousSatelliteTidalHeating>
): asserts result is Extract<ReturnType<typeof computeSynchronousSatelliteTidalHeating>, { status: 'out_of_applicability' }> {
  if (result.status !== 'out_of_applicability') {
    throw new Error(`ожидается out_of_applicability, получено ${result.status}`);
  }
}

// Независимый эталон формулы (переписан иначе, чем в модуле).
function referencePowerW(n: number, R: number, k2: number, Q: number, e: number, theta: number): number {
  const prefactor = 1.5 * (n ** 5) * (R ** 5) / G;
  const excitation = 7 * (e * e) + Math.sin(theta) ** 2;
  return prefactor * (k2 / Q) * excitation;
}

describe('Tidal: аналитические эталоны', () => {
  it('T1. Формула воспроизводит независимый пересчёт (n задано явно)', () => {
    const n = 2.0e-5;
    const R = 2.5e6;
    const k2 = 0.3;
    const Q = 50;
    const e = 0.02;
    const theta = 0.05;
    const res = computeSynchronousSatelliteTidalHeating(validInput({
      meanMotionRadS: n, satelliteRadiusM: R, loveNumberK2: k2, qualityFactorQ: Q,
      eccentricity: e, obliquityRad: theta
    }));
    assertCompleted(res);
    expect(res.tidalPowerW / referencePowerW(n, R, k2, Q, e, theta)).toBeCloseTo(1, 12);
    expect(res.factor7e2PlusSin2Theta).toBeCloseTo(7 * e * e + Math.sin(theta) ** 2, 15);
  });

  it('T2. Нулевое возбуждение (e = 0, theta = 0) даёт ровно ноль', () => {
    const res = computeSynchronousSatelliteTidalHeating(validInput({ eccentricity: 0, obliquityRad: 0 }));
    assertCompleted(res);
    expect(res.tidalPowerW).toBe(0);
  });

  it('T3. Квадратичная зависимость от e: удвоение e -> учетверение мощности', () => {
    const p1 = computeSynchronousSatelliteTidalHeating(validInput({ eccentricity: 0.01, obliquityRad: 0 }));
    const p2 = computeSynchronousSatelliteTidalHeating(validInput({ eccentricity: 0.02, obliquityRad: 0 }));
    assertCompleted(p1);
    assertCompleted(p2);
    expect((p2.tidalPowerW as number) / (p1.tidalPowerW as number)).toBeCloseTo(4, 10);
  });

  it('T4. Масштабирование R^5 и n^5: удвоение R или n -> 32x', () => {
    const base = computeSynchronousSatelliteTidalHeating(validInput({ eccentricity: 0.01 }));
    const bigR = computeSynchronousSatelliteTidalHeating(validInput({ satelliteRadiusM: 2.0e6, eccentricity: 0.01 }));
    const bigN = computeSynchronousSatelliteTidalHeating(validInput({ meanMotionRadS: 4.0e-5, eccentricity: 0.01 }));
    assertCompleted(base);
    assertCompleted(bigR);
    assertCompleted(bigN);
    expect(bigR.tidalPowerW / base.tidalPowerW).toBeCloseTo(32, 8);
    expect(bigN.tidalPowerW / base.tidalPowerW).toBeCloseTo(32, 8);
  });

  it('T5. n из орбиты: n = sqrt(G·M_p/a^3), согласованность с явно заданным n', () => {
    const mp = 5.6832e26;
    const a = 2.37948e8;
    const nExpected = Math.sqrt((G * mp) / (a ** 3));
    const computed = computeSynchronousSatelliteTidalHeating(validInput({
      meanMotionRadS: null, parentMassKg: mp, semiMajorAxisM: a
    }));
    assertCompleted(computed);
    expect(computed.meanMotionRadS / nExpected).toBeCloseTo(1, 12);
    expect(computed.meanMotionComputedFromOrbit).toBe(true);
    // при ОБОИХ способах задания n рассогласование блокирует
    const inconsistent = computeSynchronousSatelliteTidalHeating(validInput({
      meanMotionRadS: nExpected * 1.01, parentMassKg: mp, semiMajorAxisM: a
    }));
    expect(inconsistent.status).toBe('invalid_input');
  });
});

describe('Tidal: fail-closed входы', () => {
  it('T6. Q = 0, k2 <= 0, отрицательный R, e >= 1, NaN/Infinity отклоняются', () => {
    expect(computeSynchronousSatelliteTidalHeating(validInput({ qualityFactorQ: 0 })).status)
      .toBe('out_of_applicability');
    expect(computeSynchronousSatelliteTidalHeating(validInput({ qualityFactorQ: -5 })).status)
      .toBe('out_of_applicability');
    expect(computeSynchronousSatelliteTidalHeating(validInput({ loveNumberK2: 0 })).status)
      .toBe('out_of_applicability');
    expect(computeSynchronousSatelliteTidalHeating(validInput({ loveNumberK2: -0.1 })).status)
      .toBe('out_of_applicability');
    for (const bad of [NaN, Infinity, -Infinity, -1, 0]) {
      expect(computeSynchronousSatelliteTidalHeating(validInput({ satelliteRadiusM: bad as number })).status)
        .toBe('invalid_input');
    }
    expect(computeSynchronousSatelliteTidalHeating(validInput({ eccentricity: 1 })).status)
      .toBe('invalid_input');
    expect(computeSynchronousSatelliteTidalHeating(validInput({ eccentricity: NaN })).status)
      .toBe('invalid_input');
    expect(computeSynchronousSatelliteTidalHeating(validInput({ obliquityRad: Infinity })).status)
      .toBe('invalid_input');
    expect(computeSynchronousSatelliteTidalHeating(validInput({ meanMotionRadS: NaN })).status)
      .not.toBe('completed');
  });

  it('T7. Отсутствие k2 или Q НЕ даёт completed: параметры перечислены', () => {
    const noK2 = computeSynchronousSatelliteTidalHeating(validInput({ loveNumberK2: null }));
    assertOutOfApplicability(noK2);
    expect(noK2.missingParameters.some((p) => p.includes('k2'))).toBe(true);
    const noQ = computeSynchronousSatelliteTidalHeating(validInput({ qualityFactorQ: null }));
    assertOutOfApplicability(noQ);
    expect(noQ.missingParameters.some((p) => p.includes('Q'))).toBe(true);
    // значения с других тел не подставляются: мощность не возвращается
  });

  it('T8. Несинхронный спиновый режим блокируется', () => {
    const n = 2.0e-5;
    const periodNotSync = (2 * Math.PI) / (n * 1.5); // omega = 1.5 n
    const res = computeSynchronousSatelliteTidalHeating(validInput({
      meanMotionRadS: n,
      spinState: { kind: 'rotation_period_s', value: periodNotSync, source: { provenance: SYNTHETIC_PROVENANCE } }
    }));
    assertOutOfApplicability(res);
    expect(res.reason).toContain('несинхронн');
    // а синхронный период проходит
    const syncPeriod = (2 * Math.PI) / n;
    const ok = computeSynchronousSatelliteTidalHeating(validInput({
      meanMotionRadS: n,
      spinState: { kind: 'rotation_period_s', value: syncPeriod, source: { provenance: SYNTHETIC_PROVENANCE } }
    }));
    expect(ok.status).toBe('completed');
  });

  it('T9. Нет экстраполяции: e > 0.1, theta > 0.5 rad, k2 физически недопустимый', () => {
    const bigE = computeSynchronousSatelliteTidalHeating(validInput({ eccentricity: 0.2 }));
    assertOutOfApplicability(bigE);
    expect(bigE.detail).toHaveProperty('maxEccentricity');
    const bigTheta = computeSynchronousSatelliteTidalHeating(validInput({ obliquityRad: 0.6 }));
    assertOutOfApplicability(bigTheta);
    expect(bigTheta.detail).toHaveProperty('maxObliquityRad');
    const badK2 = computeSynchronousSatelliteTidalHeating(validInput({ loveNumberK2: LOVE_NUMBER_K2_PHYSICAL_LIMIT + 0.1 }));
    expect(badK2.status).toBe('invalid_input');
    // объявленные пределы — константы контракта
    expect(TIDAL_MODEL_APPLICABILITY_LIMITS.maxEccentricity).toBe(0.1);
    expect(TIDAL_MODEL_APPLICABILITY_LIMITS.maxObliquityRad).toBe(0.5);
  });
});

describe('Tidal: временные режимы', () => {
  it('T10. constant_parameters_over_interval: E = P·Δt; snapshot НЕ утверждает постоянства', () => {
    const dt = 1e12;
    const interval = computeSynchronousSatelliteTidalHeating(validInput({
      eccentricity: 0.01,
      timeMode: {
        kind: 'constant_parameters_over_interval',
        startSeconds: 0,
        endSeconds: dt,
        justification: 'синтетический тест: параметры объявлены фиксированными на интервале'
      }
    }));
    assertCompleted(interval);
    expect(interval.timeMode.intervalEnergyJ as number).toBeGreaterThan(0);
    expect(interval.timeMode.intervalEnergyJ as number)
      .toBe(interval.tidalPowerW * dt); // одинаковое умножение: точное равенство
    expect(interval.timeMode.kind).toBe('constant_parameters_over_interval');
    expect(interval.assumptions.some((a) => a.includes('ФИКСИРОВАННЫМИ'))).toBe(true);

    const snap = computeSynchronousSatelliteTidalHeating(validInput({ eccentricity: 0.01 }));
    assertCompleted(snap);
    expect(snap.timeMode.intervalEnergyJ).toBeNull();
    expect(snap.timeDependenceDisclaimer).toContain('НЕ постоянна');
  });
});
