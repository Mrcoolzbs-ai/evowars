// ============================================
// ТЕСТЫ — Конечногоризонтная динамическая оценка устойчивости
// (Stage 4.6.2, assessNBodyStabilityOverHorizon)
// ============================================
// Двадцать обязательных сценариев промта этапа 4.6.2. Каждый сценарий
// прогоняет ОДИН и тот же движок Stage 4.6.1-A/B/C дважды (coarse dt и
// refined dt/2) на ОБЩИХ физических временах диагностики и присваивает
// вердикт ТОЛЬКО по ЯВНЫМ критериям из options.
//
// Главное правило: completed НЕ означает stable; отсутствие событий
// НЕ доказывает устойчивость; 'stable' — только «удовлетворяет объ-
// явленным критериям на указанном горизонте». Все эталонные числа —
// измеренные на фиксированных детерминированных конфигурациях.
// Геометрическое пересечение орбит != столкновение; резонансный
// кандидат != нестабильность; pairwise-граф связности != вердикт.

import { describe, it, expect } from 'vitest';
import {
  assessNBodyStabilityOverHorizon,
  type StabilityAssessmentOptions,
  type StabilityAssessmentResult,
  type StabilityAssessmentSuccess
} from '../OrbitalMechanics/stability';
import type { NBodyInitialState, OrbitalBodyState, Vector3 } from '../OrbitalMechanics/dynamics';
import type {
  CloseApproachEvent,
  CollisionEvent,
  EjectionEvent,
  NBodyDetectionEvent
} from '../OrbitalMechanics/events';
import { G, M_SUN_KG, M_EARTH_KG, AU_M } from '../Units/index';

function collisionsOf(events: readonly NBodyDetectionEvent[]): CollisionEvent[] {
  return events.filter((e): e is CollisionEvent => e.type === 'collision');
}

function confirmedEjectionsOf(events: readonly NBodyDetectionEvent[]): EjectionEvent[] {
  return events.filter((e): e is EjectionEvent => e.type === 'ejection_confirmed');
}

function ongoingApproachesOf(events: readonly NBodyDetectionEvent[]): CloseApproachEvent[] {
  return events.filter((e): e is CloseApproachEvent => e.type === 'close_approach' && e.ongoingAtHorizon);
}

const DAY_S = 86400;
const R_SUN_PHYS = 6.96e8;
const R_EARTH_PHYS = 6.371e6;
const M_MOON = 7.34767309e22;
const R_MOON_PHYS = 1.737e6;

function body(
  id: string,
  massKg: number,
  radiusM: number | null,
  positionM: Vector3,
  velocityMPerS: Vector3
): OrbitalBodyState {
  return { id, massKg, radiusM, positionM, velocityMPerS };
}

function requireAssessed(result: StabilityAssessmentResult): StabilityAssessmentSuccess {
  if (result.status !== 'completed') {
    throw new Error(`ожидался статус completed, получен ${result.status}`);
  }
  return result;
}

/**
 * Базовый полный набор опций: ВСЕ допуски классификации ЯВНЫЕ,
 * скрытых универсальных констант устойчивости нет. Каждый сценарий
 * переопределяет только то, что тестирует.
 */
function baseOptions(primaryBodyId: string, overrides: Partial<StabilityAssessmentOptions>): StabilityAssessmentOptions {
  return {
    primaryBodyId,
    durationS: 5e6,
    timeStepS: 1e4,
    diagnosticIntervalS: 2e4,
    escapeRadiusM: 1.5e12,
    escapeConfirmationDurationS: 1e6,
    maxStepsPerRun: 1e6,
    maxEnergyDriftRelative: 1e-5,
    maxMomentumDriftRelative: 1e-9,
    maxAngularMomentumDriftRelative: 1e-9,
    // Измерено (реплика KDK, 2.43·10^6 с = ~2 лунных оборота): гелиоцентрические
    // оскулирующие элементы Луны физически осциллируют на ~0.41 (a) и ~0.088 (e)
    // на обоих разрешениях идентично — это физика, а не численная ошибка,
    // поэтому операционные допуски по умолчанию 0.5 / 0.15.
    maxRelativeSemimajorAxisExcursion: 0.5,
    maxAbsoluteEccentricityExcursion: 0.15,
    maxRelativePositionDifference: 1e-3,
    maxRelativeVelocityDifference: 1e-2,
    maxEventTimeDifferenceS: 1e3,
    maxRelativeSemimajorAxisDifference: 3e-3,
    maxEccentricityDifference: 1e-3,
    ...overrides
  };
}

// --- Иерархическая система: звезда + планета + луна (полное покрытие) ---
function sunPlanetMoon(): NBodyInitialState {
  const mPlanet = 1e26;
  const mMoon = 1e24;
  const rP = 1e11;
  const vP = Math.sqrt((G * M_SUN_KG) / rP);
  const rM = 1e9;
  const vM = Math.sqrt((G * (mPlanet + mMoon)) / rM);
  return {
    timeS: 0,
    bodies: [
      body('moon', mMoon, 1e6, { x: rP - rM, y: 0, z: 0 }, { x: 0, y: vP - vM, z: 0 }),
      body('planet', mPlanet, 1e7, { x: rP, y: 0, z: 0 }, { x: 0, y: vP, z: 0 }),
      body('sun', M_SUN_KG, R_SUN_PHYS, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    ]
  };
}

// --- Контрольная барицентрическая круговая пара Земля–Солнце (1 а.е.) ---
function sunEarthBary(): NBodyInitialState {
  const mu = G * (M_SUN_KG + M_EARTH_KG);
  const aRel = AU_M;
  const vRel = Math.sqrt(mu / aRel);
  const rE = aRel * (M_SUN_KG / (M_SUN_KG + M_EARTH_KG));
  const rS = aRel * (M_EARTH_KG / (M_SUN_KG + M_EARTH_KG));
  const vE = vRel * (M_SUN_KG / (M_SUN_KG + M_EARTH_KG));
  const vS = vRel * (M_EARTH_KG / (M_SUN_KG + M_EARTH_KG));
  return {
    timeS: 0,
    bodies: [
      body('earth', M_EARTH_KG, R_EARTH_PHYS, { x: rE, y: 0, z: 0 }, { x: 0, y: vE, z: 0 }),
      body('sun', M_SUN_KG, R_SUN_PHYS, { x: -rS, y: 0, z: 0 }, { x: 0, y: -vS, z: 0 })
    ]
  };
}

// --- Контрольная барицентрическая круговая пара Земля–Луна ---
// a подобрана аналитически так, чтобы P = 27.32 сут (±0.5% запас).
function earthMoonBary(): NBodyInitialState {
  const pTarget = 27.32 * DAY_S;
  const mu = G * (M_EARTH_KG + M_MOON);
  const aRel = Math.cbrt(mu * (pTarget / (2 * Math.PI)) ** 2);
  const vRel = Math.sqrt(mu / aRel);
  const rE = aRel * (M_MOON / (M_EARTH_KG + M_MOON));
  const rM = aRel * (M_EARTH_KG / (M_EARTH_KG + M_MOON));
  const vE = vRel * (M_MOON / (M_EARTH_KG + M_MOON));
  const vM = vRel * (M_EARTH_KG / (M_EARTH_KG + M_MOON));
  return {
    timeS: 0,
    bodies: [
      body('earth', M_EARTH_KG, R_EARTH_PHYS, { x: rE, y: 0, z: 0 }, { x: 0, y: vE, z: 0 }),
      body('moon', M_MOON, R_MOON_PHYS, { x: -rM, y: 0, z: 0 }, { x: 0, y: -vM, z: 0 })
    ]
  };
}

// --- Лобовое сближение с физическим контактом (Stage 4.6.1-B, измерено:
// контакт ≈ 7.5e5 с, пара 'a'/'b') ---
function collisionCourse(): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('a', 1e23, 5e8, { x: -5e9, y: 0, z: 0 }, { x: 6e3, y: 0, z: 0 }),
      body('b', 1e23, 5e8, { x: 5e9, y: 0, z: 0 }, { x: -6e3, y: 0, z: 0 })
    ]
  };
}

// --- Гиперболический пролёт мимо звезды (Stage 4.6.1-C, измерено:
// пересечение 4e11 наружу ≈ 4.18e6 с, подтверждение ещё через 1e6 с) ---
function hyperbolic(): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('ship', 1e15, null, { x: 2e11, y: 0, z: 0 }, { x: 5.2e4, y: 0, z: 0 }),
      body('sun', M_SUN_KG, R_SUN_PHYS, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    ]
  };
}

// --- Эксцентричная двойная пара в перицентре: r_peri = 1e11 < порог
// сближения 1.5e11; до конца горизонта эпизод остаётся открытым ---
function eccentricPairAtPeriapsis(): NBodyInitialState {
  const m = 5e29;
  const mu = G * (2 * m);
  const rPeri = 1e11;
  const vPeri = Math.sqrt((mu * 1.5) / 1e11);
  return {
    timeS: 0,
    bodies: [
      body('a', m, 1e8, { x: -rPeri / 2, y: 0, z: 0 }, { x: 0, y: -vPeri / 2, z: 0 }),
      body('b', m, 1e8, { x: rPeri / 2, y: 0, z: 0 }, { x: 0, y: vPeri / 2, z: 0 })
    ]
  };
}

// --- Пара, уходящая к солнцу: pairwise-граф связности меняется
// (Stage 4.6.1-C, измерено: первая потеря связности ≈ 13.76e6 с) ---
function pairFallingToSun(): NBodyInitialState {
  const m = 1e29;
  const sep = 1e10;
  const vi = Math.sqrt((G * 2 * m) / sep) / 2;
  return {
    timeS: 0,
    bodies: [
      body('sun', M_SUN_KG, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      body('p', m, null, { x: 6e11 - sep / 2, y: 0, z: 0 }, { x: -1.1e4, y: vi, z: 0 }),
      body('q', m, null, { x: 6e11 + sep / 2, y: 0, z: 0 }, { x: -1.1e4, y: -vi, z: 0 })
    ]
  };
}

// --- Геометрически пересекающиеся орбиты без временной встречи:
// круговая планета (1 а.е.) и эксцентричная (a = 1 а.е., e = 0.3),
// начинается с апоцентра на противоположной стороне ---
function crossingOrbits(): NBodyInitialState {
  const mu = G * M_SUN_KG;
  const mP = 1e24;
  const vCirc = Math.sqrt(mu / AU_M);
  const rApo = AU_M * 1.3;
  const vApo = Math.sqrt((mu * (1 - 0.3)) / (AU_M * 1.3));
  return {
    timeS: 0,
    bodies: [
      body('p1', mP, 1e7, { x: AU_M, y: 0, z: 0 }, { x: 0, y: vCirc, z: 0 }),
      body('p2', mP, 1e7, { x: -rApo, y: 0, z: 0 }, { x: 0, y: -vApo, z: 0 }),
      body('sun', M_SUN_KG, R_SUN_PHYS, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
    ]
  };
}

describe('Stage 4.6.2: вердикты динамической оценки устойчивости', () => {
  it('1. иерархическая система с полным покрытием: stable + agreed сходимость', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(sunPlanetMoon(), baseOptions('sun', {}))
    );
    expect(result.verdict).toBe('stable');
    expect(result.runs.coarse.status).toBe('completed');
    expect(result.runs.refined.status).toBe('completed');
    for (const check of result.checks) {
      expect(check.status).toBe('pass');
    }
    expect(result.rationale).toContain('НЕ утверждаются');
    console.log(
      '4.6.2 [1] measured:',
      JSON.stringify({
        energyDrift: {
          coarse: result.conservation.coarse?.maxEnergyDriftRelative,
          refined: result.conservation.refined?.maxEnergyDriftRelative
        },
        momentum: {
          coarse: result.conservation.coarse?.maxMomentumDriftRelative,
          refined: result.conservation.refined?.maxMomentumDriftRelative
        },
        angular: {
          coarse: result.conservation.coarse?.maxAngularMomentumDriftRelative,
          refined: result.conservation.refined?.maxAngularMomentumDriftRelative
        },
        convergence: result.convergence.maxRelativePositionDifference
      })
    );
  });

  it('2. контроль Земля–Солнце: период 365.25 сут ± 0.5%', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        sunEarthBary(),
        baseOptions('sun', {
          durationS: 6e7,
          timeStepS: 3000,
          diagnosticIntervalS: 6e4
        })
      )
    );
    const period = result.orbitalDiagnostics.refined[0].initialOrbitalPeriodS;
    if (period === null) throw new Error('период Земли не вычислен');
    const target = 365.25 * DAY_S;
    console.log(
      '4.6.2 [2] measured:',
      JSON.stringify({
        periodDays: period / DAY_S,
        deviationPercent: ((period - target) / target) * 100
      })
    );
    expect(Math.abs(period - target) / target).toBeLessThan(0.005);
    expect(result.verdict).toBe('stable');
  });

  it('3. контроль Земля–Луна: период 27.32 сут ± 0.5%', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        earthMoonBary(),
        baseOptions('earth', {
          durationS: 2.4e6,
          timeStepS: 1000,
          diagnosticIntervalS: 2000
        })
      )
    );
    const period = result.orbitalDiagnostics.refined[0].initialOrbitalPeriodS;
    if (period === null) throw new Error('период Луны не вычислен');
    const target = 27.32 * DAY_S;
    console.log(
      '4.6.2 [3] measured:',
      JSON.stringify({
        periodDays: period / DAY_S,
        deviationPercent: ((period - target) / target) * 100
      })
    );
    expect(Math.abs(period - target) / target).toBeLessThan(0.005);
    expect(result.verdict).toBe('stable');
  });

  it('4. физическое столкновение на обоих разрешениях: unstable, согласованная пара', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        collisionCourse(),
        baseOptions('a', {
          durationS: 1e6,
          timeStepS: 1e5,
          diagnosticIntervalS: 2e5,
          escapeRadiusM: 2e10,
          escapeConfirmationDurationS: 1e5,
          maxEventTimeDifferenceS: 3e3
        })
      )
    );
    expect(result.verdict).toBe('unstable');
    expect(result.verdictReasons).toContain('collision_confirmed_on_both_resolutions');
    expect(result.runs.coarse.status).toBe('collision_detected');
    expect(result.runs.refined.status).toBe('collision_detected');
    const collC = collisionsOf(result.runs.coarse.events);
    const collR = collisionsOf(result.runs.refined.events);
    expect(collC).toHaveLength(1);
    expect(collR).toHaveLength(1);
    expect([collC[0].pairIdA, collC[0].pairIdB].sort()).toEqual(['a', 'b']);
    expect([collR[0].pairIdA, collR[0].pairIdB].sort()).toEqual(['a', 'b']);
    expect(Math.abs(collC[0].contactTimeS - collR[0].contactTimeS)).toBeLessThanOrEqual(3e3);
  });

  it('5. подтверждённый выброс на обоих разрешениях: unstable, одно и то же тело', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        hyperbolic(),
        baseOptions('sun', {
          durationS: 6e6,
          escapeRadiusM: 4e11,
          escapeConfirmationDurationS: 1e6,
          maxEventTimeDifferenceS: 1e4
        })
      )
    );
    expect(result.verdict).toBe('unstable');
    expect(result.verdictReasons).toContain('ejection_confirmed_on_both_resolutions');
    const confC = confirmedEjectionsOf(result.runs.coarse.events);
    const confR = confirmedEjectionsOf(result.runs.refined.events);
    expect(confC).toHaveLength(1);
    expect(confR).toHaveLength(1);
    expect(confC[0].bodyId).toBe('ship');
    expect(confC[0].primaryBodyId).toBe('sun');
    expect(confR[0].bodyId).toBe('ship');
    expect(confR[0].primaryBodyId).toBe('sun');
    if (confC[0].confirmationTimeS === null || confR[0].confirmationTimeS === null) {
      throw new Error('подтверждённый выброс без времени подтверждения');
    }
    expect(Math.abs(confC[0].confirmationTimeS - confR[0].confirmationTimeS)).toBeLessThanOrEqual(1e4);
  });

  it('6. кандидат выброса без подтверждения (pending): indeterminate, не unstable', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        hyperbolic(),
        baseOptions('sun', {
          durationS: 5e6,
          escapeRadiusM: 4e11,
          escapeConfirmationDurationS: 1e6,
          maxEventTimeDifferenceS: 1e4
        })
      )
    );
    expect(result.verdict).toBe('indeterminate');
    expect(result.verdictReasons).not.toContain('ejection_confirmed_on_both_resolutions');
    for (const runName of ['coarse', 'refined'] as const) {
      expect(
        result.runs[runName].events.filter((e) => e.type === 'ejection_pending_at_horizon').length
      ).toBe(1);
    }
    expect(result.verdictReasons.length).toBeGreaterThan(0);
  });

  it('7. radiusM null у части тел: stable запрещён, покрытие честно', () => {
    const state = sunPlanetMoon();
    const planet = state.bodies.find((b) => b.id === 'planet');
    if (!planet) throw new Error('нет планеты');
    planet.radiusM = null;
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(state, baseOptions('sun', {}))
    );
    expect(result.verdict).toBe('indeterminate');
    // Радиус известен только у sun и moon; неизвестен planet => в покрытие попадают
    // обе пары (sun,planet) и (planet,moon), то есть 2, а не 1.
    expect(result.collisionEscapeCoverage.pairsWithUnknownRadiusCoarse).toBe(2);
    expect(result.collisionEscapeCoverage.pairsWithUnknownRadiusRefined).toBe(2);
    expect(result.collisionEscapeCoverage.collisionCoverageCompleteCoarse).toBe(false);
    expect(result.collisionEscapeCoverage.collisionCoverageCompleteRefined).toBe(false);
    expect(result.checks.find((c) => c.code === 'collision_coverage_complete')?.status).toBe('fail');
  });

  it('8. незакрытое сближение без контакта/выброса: indeterminate, не unstable', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        eccentricPairAtPeriapsis(),
        baseOptions('a', {
          durationS: 5e6,
          timeStepS: 5e4,
          diagnosticIntervalS: 1e5,
          closeApproachDistanceM: 1.5e11,
          escapeRadiusM: 5e11,
          escapeConfirmationDurationS: 1e6
        })
      )
    );
    expect(result.verdict).toBe('indeterminate');
    expect(result.verdictReasons).toContain('stable_condition_failed_no_unresolved_close_approach');
    for (const runName of ['coarse', 'refined'] as const) {
      expect(ongoingApproachesOf(result.runs[runName].events)).toHaveLength(1);
    }
    expect(result.runs.coarse.status).toBe('completed');
    expect(result.runs.refined.status).toBe('completed');
  });

  it('9. потеря связности без терминального события: предупреждение и indeterminate', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        pairFallingToSun(),
        baseOptions('sun', {
          durationS: 2.5e7,
          connectivityEnergyToleranceJPerKg: 0
        })
      )
    );
    expect(result.verdict).toBe('indeterminate');
    expect(result.verdictReasons).not.toContain('ejection_confirmed_on_both_resolutions');
    expect(result.verdictReasons).not.toContain('collision_confirmed_on_both_resolutions');
    expect(result.verdictReasons).toContain('stable_condition_failed_no_connectivity_changes');
    expect(result.warnings.some((w) => w.includes('связности'))).toBe(true);
    expect(result.collisionEscapeCoverage.initialConnectivityComponents).toBe(1);
  });

  it('10. сходимость coarse/refined внутри допусков (нет только начальной/финальной точек)', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(sunPlanetMoon(), baseOptions('sun', {}))
    );
    expect(result.convergence.status).toBe('agreed');
    expect(result.convergence.sharedDiagnosticTimesCount).toBeGreaterThan(2);
    expect(result.runs.coarse.diagnosticTimesS).toEqual(result.runs.refined.diagnosticTimesS);
    console.log(
      '4.6.2 [10] convergence measured:',
      JSON.stringify({
        sharedTimes: result.convergence.sharedDiagnosticTimesCount,
        pos: result.convergence.maxRelativePositionDifference,
        vel: result.convergence.maxRelativeVelocityDifference,
        a: result.convergence.maxRelativeSemimajorAxisDifference,
        e: result.convergence.maxEccentricityDifference,
        posScale: result.convergence.positionScaleMByBody,
        velScale: result.convergence.velocityScaleMPerSByBody
      })
    );
  });

  it('11. расхождение времени события сверх допуска: indeterminate, не принудительный unstable', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        collisionCourse(),
        baseOptions('a', {
          durationS: 1e6,
          timeStepS: 1e5,
          diagnosticIntervalS: 2e5,
          escapeRadiusM: 2e10,
          escapeConfirmationDurationS: 1e5,
          maxEventTimeDifferenceS: 1e-9
        })
      )
    );
    expect(result.verdict).toBe('indeterminate');
    expect(result.verdictReasons).toContain('collision_disagreement_between_resolutions');
  });

  it('12. численный отказ одного прогона (лимит шагов): indeterminate', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        sunEarthBary(),
        baseOptions('sun', {
          durationS: 3e6,
          timeStepS: 3000,
          diagnosticIntervalS: 6000,
          maxStepsPerRun: 1500
        })
      )
    );
    expect(result.runs.coarse.status).toBe('completed');
    expect(result.runs.refined.status).toBe('integration_failed');
    expect(result.runs.refined.integrationFailure).toBe('step_limit_exceeded');
    expect(result.verdict).toBe('indeterminate');
    expect(result.verdictReasons).toContain('integration_failure_in_one_resolution');
    expect(result.checks.find((c) => c.code === 'both_runs_completed_horizon')?.status).toBe('fail');
  });

  it('13. дрейф энергии за явно заданным порогом: stable запрещён', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        sunPlanetMoon(),
        baseOptions('sun', { maxEnergyDriftRelative: 1e-15 })
      )
    );
    expect(result.verdict).toBe('indeterminate');
    const measured = result.conservation.coarse?.maxEnergyDriftRelative ?? 0;
    console.log(
      '4.6.2 [13] measured energy drift:',
      JSON.stringify({
        coarse: result.conservation.coarse?.maxEnergyDriftRelative,
        refined: result.conservation.refined?.maxEnergyDriftRelative
      })
    );
    expect(measured).toBeGreaterThan(1e-15);
    expect(result.checks.find((c) => c.code === 'conservation_energy_coarse')?.status).toBe('fail');
  });

  it('14. орбитальный предел превышен на обоих разрешениях: операционный unstable', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        sunPlanetMoon(),
        baseOptions('sun', { maxRelativeSemimajorAxisExcursion: 0.004 })
      )
    );
    expect(result.verdict).toBe('unstable');
    expect(result.verdictReasons).toContain('operational_orbital_limit_on_both_resolutions');
    expect(result.warnings.some((w) => w.includes('критерий данного сценария'))).toBe(true);
  });

  it('15. превышение предела только на одном разрешении: indeterminate', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        sunEarthBary(),
        baseOptions('sun', {
          // Калибровка по реплике KDK (h=3e4/1.5e4): coarse maxRelA = 3.18e-10,
          // refined = 1.99e-11 => порог 1e-10 превышен только на coarse.
          durationS: 6e7,
          timeStepS: 3e4,
          diagnosticIntervalS: 6e4,
          maxRelativeSemimajorAxisExcursion: 1e-10
        })
      )
    );
    console.log(
      '4.6.2 [15] excursions measured:',
      JSON.stringify({
        coarse: result.orbitalDiagnostics.coarse.map((d) => d.maxRelativeSemimajorAxisExcursion),
        refined: result.orbitalDiagnostics.refined.map((d) => d.maxRelativeSemimajorAxisExcursion)
      })
    );
    expect(result.verdict).toBe('indeterminate');
    expect(result.verdictReasons).not.toContain('operational_orbital_limit_on_both_resolutions');
  });

  it('16. перестановка тел во входе не меняет события и итог', () => {
    const state = sunPlanetMoon();
    const shuffled: NBodyInitialState = {
      timeS: state.timeS,
      bodies: [state.bodies[2], state.bodies[0], state.bodies[1]]
    };
    const a1 = requireAssessed(assessNBodyStabilityOverHorizon(state, baseOptions('sun', {})));
    const a2 = requireAssessed(assessNBodyStabilityOverHorizon(shuffled, baseOptions('sun', {})));
    expect(a2.verdict).toBe(a1.verdict);
    expect(a2.runs.coarse.events).toEqual(a1.runs.coarse.events);
    expect(a2.runs.refined.events).toEqual(a1.runs.refined.events);
    expect(a2.runs.coarse.conservation).toEqual(a1.runs.coarse.conservation);
    expect(a2.convergence.maxRelativePositionDifference).toBe(a1.convergence.maxRelativePositionDifference);
    expect(a2.convergence.sharedDiagnosticTimesS).toEqual(a1.convergence.sharedDiagnosticTimesS);
  });

  it('17. неизвестный primary и некорректный горизонт: invalid_input', () => {
    const result = assessNBodyStabilityOverHorizon(
      sunPlanetMoon(),
      baseOptions('phantom', { durationS: 1e6, timeStepS: 3e5 })
    );
    expect(result.status).toBe('invalid_input');
    if (result.status !== 'invalid_input') return;
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('primary_body_not_found');
    expect(codes).toContain('duration_not_multiple_of_time_step');
  });

  it('18. диагностические времена coarse/refined полностью совпадают', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        sunEarthBary(),
        baseOptions('sun', {
          durationS: 6e7,
          timeStepS: 3000,
          diagnosticIntervalS: 6e4
        })
      )
    );
    expect(result.runs.coarse.diagnosticTimesS.length).toBeGreaterThan(100);
    expect(result.runs.coarse.diagnosticTimesS).toEqual(result.runs.refined.diagnosticTimesS);
    expect(result.convergence.sharedDiagnosticTimesCount).toBe(result.runs.coarse.diagnosticTimesS.length);
  });

  it('19. входное состояние не модифицируется', () => {
    const state = sunPlanetMoon();
    const snapshot = structuredClone(state);
    assessNBodyStabilityOverHorizon(state, baseOptions('sun', {}));
    expect(state).toEqual(snapshot);
  });

  it('20. геометрическое пересечение орбит не классифицируется как столкновение', () => {
    const result = requireAssessed(
      assessNBodyStabilityOverHorizon(
        crossingOrbits(),
        baseOptions('sun', {
          durationS: 6.3e7,
          timeStepS: 3000,
          diagnosticIntervalS: 6e4,
          maxAbsoluteEccentricityExcursion: 0.05,
          screening: {
            orbitIntersectionToleranceM: 1e8,
            classicHillMaxEccentricity: 0.95,
            classicHillMaxRelativeInclinationRad: 0.5,
            rocheLimitModel: 'fluid',
            resonanceRelativeTolerance: 0.05,
            maxResonanceInteger: 5
          }
        })
      )
    );
    expect(result.analyticScreeningEnabled).toBe(true);
    if (!result.analyticScreening || result.analyticScreening.status !== 'completed') {
      throw new Error('скрининг не выполнен');
    }
    const crossings = result.analyticScreening.crossings.filter((c) => c.result === 'geometric_crossing');
    expect(crossings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('геометрические пересечения орбит'))).toBe(true);
    for (const runName of ['coarse', 'refined'] as const) {
      expect(result.runs[runName].events.filter((e) => e.type === 'collision')).toHaveLength(0);
    }
    expect(result.verdict).not.toBe('unstable');
  });
});
