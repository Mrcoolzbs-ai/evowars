// ============================================
// ТЕСТЫ — Аналитический скрининг орбит (Stage 4.6.1-D)
// ============================================
//
// Проверяется чистый диагностический слой поверх N-body динамики:
// осциллирующие двухтельные кеплеровские элементы, геометрические
// пересечения орбит (узловые и копланарные аналитические решения,
// без угловой сетки), индивидуальные и взаимные радиусы Хилла с
// классическим порогом 2*sqrt(3) под явными допущениями, предел
// Роша с явным выбором модели (fluid 2.44 / rigid 1.26) и кандидаты
// в соизмеримости периодов (взаимно простые p:q, включая 1:1).
//
// ЭТО ДИАГНОСТИЧЕСКИЕ КРИТЕРИИ, а НЕ вердикты: ни один результат
// не классифицирует систему как стабильную или нестабильную.
// Осциллирующие элементы зависят от выбранного primary и эпохи.
// Геометрическое пересечение орбит не означает встречи тел и не
// является collision-событием. Все эталонные числа аналитические:
// модуль — чистые формулы без интегрирования. Fail-closed: нехватка
// данных (radiusM null, вырожденная коника) даёт not_evaluated/
// unknown/indeterminate с машинной причиной, вместо подстановки
// типичных значений.

import { describe, it, expect } from 'vitest';
import {
  screenOrbitalStability,
  computeOsculatingElements,
  CLASSIC_MUTUAL_HILL_THRESHOLD,
  ROCHE_BOUNDARY_RELATIVE_BAND,
  type OrbitScreeningResult,
  type OrbitScreeningAnalysis,
  type OrbitScreeningInvalidInput,
  type OrbitScreeningOptions
} from '../OrbitalMechanics/orbitScreening';
import type { NBodyInitialState, OrbitalBodyState, Vector3 } from '../OrbitalMechanics/dynamics';
import { G } from '../Units/index';

const M_SUN = 1.989e30;

function body(
  id: string,
  massKg: number,
  radiusM: number | null,
  positionM: Vector3,
  velocityMPerS: Vector3
): OrbitalBodyState {
  return { id, massKg, radiusM, positionM, velocityMPerS };
}

function sunBody(radiusM: number | null): OrbitalBodyState {
  return body('sun', M_SUN, radiusM, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
}

function muOf(centralMassKg: number, satMassKg: number): number {
  return G * (centralMassKg + satMassKg);
}

/** Круговая орбита в плоскости xy, повёрнутой вокруг x на planeTiltRad. */
function circleBody(
  id: string,
  massKg: number,
  radiusM: number | null,
  centralMassKg: number,
  r: number,
  planeTiltRad = 0
): OrbitalBodyState {
  const mu = muOf(centralMassKg, massKg);
  const v = Math.sqrt(mu / r);
  return {
    id,
    massKg,
    radiusM,
    positionM: { x: r, y: 0, z: 0 },
    velocityMPerS: { x: 0, y: v * Math.cos(planeTiltRad), z: v * Math.sin(planeTiltRad) }
  };
}

/** Эллипс с перицентром вдоль +x; старт в перицентре или апоцентре. */
function ellipseBody(
  id: string,
  massKg: number,
  radiusM: number | null,
  centralMassKg: number,
  a: number,
  ecc: number,
  atApoapsis: boolean
): OrbitalBodyState {
  const mu = muOf(centralMassKg, massKg);
  const r = atApoapsis ? a * (1 + ecc) : a * (1 - ecc);
  const v = atApoapsis
    ? Math.sqrt((mu * (1 - ecc)) / (a * (1 + ecc)))
    : Math.sqrt((mu * (1 + ecc)) / (a * (1 - ecc)));
  return {
    id,
    massKg,
    radiusM,
    positionM: { x: r, y: 0, z: 0 },
    velocityMPerS: { x: 0, y: v, z: 0 }
  };
}

function state(timeS: number, bodies: OrbitalBodyState[]): NBodyInitialState {
  return { timeS, bodies };
}

function allScreens(overrides?: Partial<OrbitScreeningOptions>): OrbitScreeningOptions {
  return {
    primaryBodyId: 'sun',
    orbitCrossingEnabled: true,
    orbitIntersectionToleranceM: 1,
    hillScreeningEnabled: true,
    classicHillMaxEccentricity: 0.2,
    classicHillMaxRelativeInclinationRad: 0.1,
    rocheScreeningEnabled: true,
    rocheLimitModel: 'fluid',
    resonanceScreeningEnabled: true,
    resonanceRelativeTolerance: 0.01,
    maxResonanceInteger: 6,
    ...overrides
  };
}

function requireAnalysis(result: OrbitScreeningResult): OrbitScreeningAnalysis {
  if (result.status === 'invalid_input') {
    throw new Error('не ожидался invalid_input: ' + result.issues.map((i) => i.code).join(', '));
  }
  return result;
}

function requireInvalid(result: OrbitScreeningResult): OrbitScreeningInvalidInput {
  if (result.status !== 'invalid_input') {
    throw new Error('ожидался invalid_input, получен ' + result.status);
  }
  return result;
}

function expectRelClose(actual: number | null, expected: number, relTol: number): void {
  if (actual === null) {
    throw new Error('ожидалось конечное значение, получено null');
  }
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(relTol);
}

function issueCodes(result: OrbitScreeningAnalysis): string[] {
  return result.issues.map((i) => i.code);
}

function byId<T extends { bodyId?: string }>(items: T[], id: string): T {
  const found = items.find((x) => x.bodyId === id);
  if (!found) throw new Error('нет записи для тела ' + id);
  return found;
}

// --- Сценарии 1–5: осциллирующие двухтельные элементы ---

describe('Stage 4.6.1-D: осциллирующие элементы', () => {
  it('круговая орбита: a = r, e = 0, P по III закону Кеплера, апоцентр = a', () => {
    const m = 5.972e24;
    const r = 1.5e11;
    const mu = muOf(M_SUN, m);
    const result = requireAnalysis(
      screenOrbitalStability(
        state(1000, [sunBody(null), circleBody('earth', m, null, M_SUN, r)]),
        allScreens()
      )
    );
    const el = byId(result.elements, 'earth');
    expect(el.trajectoryKind).toBe('elliptic');
    expect(el.conicApplicable).toBe(true);
    expect(el.inapplicableReason).toBeNull();
    expect(el.primaryBodyId).toBe('sun');
    expect(el.epochS).toBe(1000);
    expectRelClose(el.distanceM, r, 1e-12);
    expectRelClose(el.semiMajorAxisM as number, r, 1e-9);
    expect(el.eccentricity).toBeLessThanOrEqual(1e-9);
    expectRelClose(el.orbitalPeriodS as number, 2 * Math.PI * Math.sqrt((r * r * r) / mu), 1e-12);
    expectRelClose(el.periapsisDistanceM as number, r, 1e-9);
    expectRelClose(el.apoapsisDistanceM as number, r, 1e-9);
    const n = el.planeNormalUnit as Vector3;
    expect(Math.abs(n.z)).toBeGreaterThan(1 - 1e-12);
    expect(Math.abs(n.x)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(n.y)).toBeLessThanOrEqual(1e-12);
    expectRelClose(el.semiLatusRectumM as number, r, 1e-9);
  });

  it('эллипс e=0.4: перицентр a(1-e), апоцентр a(1+e), vis-viva-скорость в перицентре', () => {
    const m = 1e24;
    const a = 1.5e11;
    const ecc = 0.4;
    const mu = muOf(M_SUN, m);
    const record = computeOsculatingElements(
      'planet',
      'sun',
      { x: a * (1 - ecc), y: 0, z: 0 },
      { x: 0, y: Math.sqrt((mu * (1 + ecc)) / (a * (1 - ecc))), z: 0 },
      mu,
      0
    );
    expect(record.trajectoryKind).toBe('elliptic');
    expect(record.conicApplicable).toBe(true);
    expectRelClose(record.semiMajorAxisM as number, a, 1e-9);
    expectRelClose(record.eccentricity, ecc, 1e-9);
    expectRelClose(record.periapsisDistanceM as number, a * (1 - ecc), 1e-9);
    expectRelClose(record.apoapsisDistanceM as number, a * (1 + ecc), 1e-9);
    expectRelClose(record.orbitalPeriodS as number, 2 * Math.PI * Math.sqrt((a * a * a) / mu), 1e-9);
    expect(record.eccentricityVector.x).toBeGreaterThan(0);
  });

  it('гипербола без выдуманных P и a; нечисловые входы дают вырожденную запись', () => {
    const m = 1e15;
    const mu = muOf(M_SUN, m);
    const record = computeOsculatingElements(
      'ship',
      'sun',
      { x: 2e11, y: 0, z: 0 },
      { x: 0, y: 5.2e4, z: 0 },
      mu,
      0
    );
    expect(record.trajectoryKind).toBe('hyperbolic');
    expect(record.conicApplicable).toBe(true);
    expect(record.specificOrbitalEnergyJPerKg).toBeGreaterThan(0);
    expect(record.eccentricity).toBeGreaterThan(1);
    expect(record.semiMajorAxisM).toBeNull();
    expect(record.orbitalPeriodS).toBeNull();
    expect(record.apoapsisDistanceM).toBeNull();
    expect(record.semiLatusRectumM).not.toBeNull();
    expect(record.periapsisDistanceM as number).toBeGreaterThan(0);

    const badInput = computeOsculatingElements(
      'x',
      'sun',
      { x: 1.5e11, y: 0, z: 0 },
      { x: 0, y: NaN, z: 0 },
      G * M_SUN,
      0
    );
    expect(badInput.trajectoryKind).toBe('degenerate');
    expect(badInput.conicApplicable).toBe(false);
    expect(badInput.inapplicableReason).toBe('nonfinite_or_invalid_input');
    expect(badInput.semiMajorAxisM).toBeNull();
    expect(badInput.semiLatusRectumM).toBeNull();
    expect(badInput.orbitalPeriodS).toBeNull();
    expect(badInput.planeNormalUnit).toBeNull();
  });

  it('радиальная траектория: весь скрининг честно не оценён, статус indeterminate, нет NaN', () => {
    const result = screenOrbitalStability(
      state(0, [
        sunBody(null),
        body('rock', 1e23, null, { x: 1.5e11, y: 0, z: 0 }, { x: -15000, y: 0, z: 0 })
      ]),
      allScreens()
    );
    const analysis = requireAnalysis(result);
    expect(analysis.status).toBe('indeterminate');
    const el = byId(analysis.elements, 'rock');
    expect(el.trajectoryKind).toBe('radial');
    expect(el.conicApplicable).toBe(false);
    expect(el.inapplicableReason).toBe('zero_angular_momentum');
    expect(el.orbitalPeriodS).toBeNull();
    expect(el.planeNormalUnit).toBeNull();
    expect(analysis.crossings).toHaveLength(1);
    expect(analysis.crossings[0].result).toBe('indeterminate');
    expect(analysis.crossings[0].reason).toBe('zero_angular_momentum');
    expect(byId(analysis.individualHill, 'rock').status).toBe('not_evaluated');
    expect(analysis.mutualHill).toHaveLength(0);
    expect(analysis.roche[0].status).toBe('not_evaluated');
    expect(analysis.resonanceCandidates).toHaveLength(0);
    expect(analysis.resonancePairsSkipped).toHaveLength(1);
    expect(analysis.resonancePairsSkipped[0].reason).toBe('zero_angular_momentum');
    const json = JSON.stringify(analysis);
    expect(json).not.toContain('NaN');
    expect(json).not.toContain('Infinity');
  });

  it('валидация состояния и опций даёт полный набор машинных кодов invalid_input', () => {
    const bad = requireInvalid(
      screenOrbitalStability(
        state(-1, [
          sunBody(null),
          body('', 1e23, null, { x: 1e11, y: 0, z: 0 }, { x: 0, y: 1e4, z: 0 }),
          body('dup', 1e23, null, { x: 1e11, y: 0, z: 0 }, { x: 0, y: 1e4, z: 0 }),
          body('dup', 1e23, null, { x: 2e11, y: 0, z: 0 }, { x: 0, y: 1e4, z: 0 }),
          body('zm', 0, null, { x: 1e11, y: 0, z: 0 }, { x: 0, y: 1e4, z: 0 }),
          body('nr', 1e23, -5, { x: 1e11, y: 0, z: 0 }, { x: 0, y: 1e4, z: 0 }),
          body('pn', 1e23, null, { x: NaN, y: 0, z: 0 }, { x: 0, y: 1e4, z: 0 }),
          body('vi', 1e23, null, { x: 1e11, y: 0, z: 0 }, { x: 0, y: Infinity, z: 0 })
        ]),
        allScreens()
      )
    );
    const codes = bad.issues.map((i) => i.code);
    for (const expected of [
      'invalid_time_s',
      'invalid_body_id',
      'duplicate_body_id',
      'invalid_body_mass',
      'invalid_body_radius',
      'invalid_body_position',
      'invalid_body_velocity'
    ]) {
      expect(codes).toContain(expected);
    }

    const okState = (): NBodyInitialState =>
      state(0, [sunBody(null), circleBody('p1', 1e20, null, M_SUN, 1.5e11)]);

    const badPrimary = requireInvalid(
      screenOrbitalStability(okState(), allScreens({ primaryBodyId: '' }))
    );
    expect(badPrimary.issues.map((i) => i.code)).toContain('invalid_primary_body_id');

    const ghostPrimary = requireInvalid(
      screenOrbitalStability(okState(), allScreens({ primaryBodyId: 'phantom' }))
    );
    expect(ghostPrimary.issues.map((i) => i.code)).toContain('primary_body_not_found');

    const noTol = allScreens();
    delete (noTol as unknown as Record<string, unknown>).orbitIntersectionToleranceM;
    expect(requireInvalid(screenOrbitalStability(okState(), noTol)).issues.map((i) => i.code)).toContain('missing_intersection_tolerance');

    const badTol = allScreens({ orbitIntersectionToleranceM: 0 });
    expect(requireInvalid(screenOrbitalStability(okState(), badTol)).issues.map((i) => i.code)).toContain('invalid_intersection_tolerance');

    const noHill = allScreens();
    delete (noHill as unknown as Record<string, unknown>).classicHillMaxEccentricity;
    delete (noHill as unknown as Record<string, unknown>).classicHillMaxRelativeInclinationRad;
    expect(requireInvalid(screenOrbitalStability(okState(), noHill)).issues.map((i) => i.code).filter((c) => c === 'missing_hill_classic_option')).toHaveLength(2);

    const badHill = allScreens({ classicHillMaxEccentricity: 0, classicHillMaxRelativeInclinationRad: 0 });
    const badHillCodes = requireInvalid(screenOrbitalStability(okState(), badHill)).issues.map((i) => i.code);
    expect(badHillCodes).toContain('invalid_hill_classic_max_eccentricity');
    expect(badHillCodes).toContain('invalid_hill_classic_max_inclination');

    const noRoche = allScreens();
    delete (noRoche as unknown as Record<string, unknown>).rocheLimitModel;
    expect(requireInvalid(screenOrbitalStability(okState(), noRoche)).issues.map((i) => i.code)).toContain('missing_roche_model');

    const badRoche = allScreens({ rocheLimitModel: 'gas' as unknown as 'fluid' });
    expect(requireInvalid(screenOrbitalStability(okState(), badRoche)).issues.map((i) => i.code)).toContain('invalid_roche_model');

    const noRes = allScreens();
    delete (noRes as unknown as Record<string, unknown>).resonanceRelativeTolerance;
    delete (noRes as unknown as Record<string, unknown>).maxResonanceInteger;
    expect(requireInvalid(screenOrbitalStability(okState(), noRes)).issues.map((i) => i.code).filter((c) => c === 'missing_resonance_option')).toHaveLength(2);

    const badRes = allScreens({ resonanceRelativeTolerance: -1, maxResonanceInteger: 0 });
    const resCodes = requireInvalid(screenOrbitalStability(okState(), badRes)).issues.map((i) => i.code);
    expect(resCodes).toContain('invalid_resonance_tolerance');
    expect(resCodes).toContain('invalid_max_resonance_integer');

    const badFlag = allScreens({ orbitCrossingEnabled: 'yes' as unknown as boolean });
    expect(requireInvalid(screenOrbitalStability(okState(), badFlag)).issues.map((i) => i.code)).toContain('invalid_screening_flag');

    const tooFew = requireInvalid(
      screenOrbitalStability({ timeS: NaN, bodies: [sunBody(null)] }, allScreens())
    );
    expect(tooFew.issues.map((i) => i.code)).toContain('bodies_too_few');
    expect(tooFew.issues.map((i) => i.code)).toContain('invalid_time_s');
  });
});

// --- Сценарии 6–11: геометрические пересечения орбит ---

describe('Stage 4.6.1-D: геометрические пересечения орбит', () => {
  it('копланарные круг и эллипс одного a: два пересечения, расхождение радиусов в допуске', () => {
    const result = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e20, null, M_SUN, 1.5e11),
          ellipseBody('q', 1e20, null, M_SUN, 1.5e11, 0.5, false)
        ]),
        allScreens()
      )
    );
    const crossing = result.crossings[0];
    expect(crossing.pairIdA).toBe('p1');
    expect(crossing.pairIdB).toBe('q');
    expect(crossing.result).toBe('geometric_crossing');
    expect(crossing.coplanar).toBe(true);
    expect(crossing.nodeLineDirection).toBeNull();
    expect(crossing.toleranceM).toBe(1);
    expect(crossing.intersections).toHaveLength(2);
    for (const point of crossing.intersections) {
      expectRelClose(point.radiusAM, 1.5e11, 1e-6);
      expectRelClose(point.radiusBM, 1.5e11, 1e-6);
      expect(point.radiusDifferenceM).toBeLessThanOrEqual(1);
      expect(
        point.sharedPointM.x * point.sharedPointM.x +
          point.sharedPointM.y * point.sharedPointM.y
      ).toBeGreaterThan(0);
    }
  });

  it('копланарная касательность: ровно одна общая точка', () => {
    const result = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e20, null, M_SUN, 1.6e11),
          ellipseBody('q', 1e20, null, M_SUN, 1.28e11, 0.25, true)
        ]),
        allScreens()
      )
    );
    const crossing = result.crossings[0];
    expect(crossing.result).toBe('geometric_crossing');
    expect(crossing.coplanar).toBe(true);
    expect(crossing.intersections).toHaveLength(1);
    expectRelClose(crossing.intersections[0].radiusAM, 1.6e11, 1e-9);
    expect(crossing.intersections[0].radiusDifferenceM).toBeLessThanOrEqual(1);
  });

  it('совпадающие орбиты: coincident_orbits с машинной причиной', () => {
    const result = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e20, null, M_SUN, 1.5e11),
          circleBody('q', 1e20, null, M_SUN, 1.5e11)
        ]),
        allScreens()
      )
    );
    const crossing = result.crossings[0];
    expect(crossing.result).toBe('coincident_orbits');
    expect(crossing.reason).toBe('conics_coincident');
    expect(crossing.intersections).toHaveLength(0);
    expect(result.resonanceCandidates).toHaveLength(1);
    expect(result.resonanceCandidates[0].numeratorP).toBe(1);
    expect(result.resonanceCandidates[0].denominatorQ).toBe(1);
  });

  it('вложенные копланарные круги: нет пересечения, без причин indeterminate', () => {
    const result = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e20, null, M_SUN, 1.5e11),
          circleBody('q', 1e20, null, M_SUN, 2.5e11)
        ]),
        allScreens()
      )
    );
    const crossing = result.crossings[0];
    expect(crossing.result).toBe('no_geometric_crossing');
    expect(crossing.coplanar).toBe(true);
    expect(crossing.reason).toBeNull();
    expect(crossing.intersections).toHaveLength(0);
  });

  it('наклонные круги одинакового радиуса: пересечение в узлах, линия узлов найдена', () => {
    const result = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e20, null, M_SUN, 1.5e11),
          circleBody('q', 1e20, null, M_SUN, 1.5e11, Math.PI / 2)
        ]),
        allScreens()
      )
    );
    const crossing = result.crossings[0];
    expect(crossing.result).toBe('geometric_crossing');
    expect(crossing.coplanar).toBe(false);
    const nodeLine = crossing.nodeLineDirection as Vector3;
    expect(Math.abs(Math.abs(nodeLine.x) - 1)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(nodeLine.y)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(nodeLine.z)).toBeLessThanOrEqual(1e-12);
    expect(crossing.intersections).toHaveLength(2);
    for (const point of crossing.intersections) {
      expectRelClose(point.radiusAM, 1.5e11, 1e-9);
      expectRelClose(point.radiusBM, 1.5e11, 1e-9);
      expect(point.radiusDifferenceM).toBeLessThanOrEqual(1);
      expectRelClose(
        Math.sqrt(
          point.sharedPointM.x * point.sharedPointM.x +
            point.sharedPointM.y * point.sharedPointM.y +
            point.sharedPointM.z * point.sharedPointM.z
        ),
        1.5e11,
        1e-9
      );
    }
  });

  it('наклонные круги разных радиусов: нет пересечения при найденной линии узлов', () => {
    const result = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e20, null, M_SUN, 1.5e11),
          circleBody('q', 1e20, null, M_SUN, 2.5e11, Math.PI / 2)
        ]),
        allScreens()
      )
    );
    const crossing = result.crossings[0];
    expect(crossing.result).toBe('no_geometric_crossing');
    expect(crossing.coplanar).toBe(false);
    expect(crossing.nodeLineDirection).not.toBeNull();
    expect(crossing.intersections).toHaveLength(0);
    expect(crossing.reason).toBeNull();
  });
});

// --- Сценарий 12: детерминизм и контракт входа ---

describe('Stage 4.6.1-D: детерминизм и контракт входа', () => {
  it('результат JSON-равен при перестановке тел; вход не мутируется; без флагов экранинги пусты', () => {
    const build = (order: number[]): NBodyInitialState => {
      const sun = sunBody(null);
      const p1 = circleBody('p1', 1e24, null, M_SUN, 1.5e11);
      const q = circleBody('q', 1e24, null, M_SUN, 2.25e11);
      const all = [sun, p1, q];
      return state(7.5e4, order.map((i) => all[i]));
    };
    const options = allScreens();
    const r0 = requireAnalysis(screenOrbitalStability(build([0, 1, 2]), options));
    const r1 = requireAnalysis(screenOrbitalStability(build([2, 1, 0]), options));
    const r2 = requireAnalysis(screenOrbitalStability(build([2, 0, 1]), options));
    expect(r1).toEqual(r0);
    expect(r2).toEqual(r0);

    const inputState = build([0, 1, 2]);
    const before = JSON.stringify(inputState);
    screenOrbitalStability(inputState, options);
    expect(JSON.stringify(inputState)).toBe(before);
    expect(r0.metadata.pairCount).toBe(1);
    expect(r0.metadata.primaryBodyId).toBe('sun');
    expect(r0.metadata.epochS).toBe(7.5e4);

    const off = requireAnalysis(
      screenOrbitalStability(
        build([0, 1, 2]),
        {
          primaryBodyId: 'sun',
          orbitCrossingEnabled: false,
          hillScreeningEnabled: false,
          rocheScreeningEnabled: false,
          resonanceScreeningEnabled: false
        }
      )
    );
    expect(off.status).toBe('completed');
    expect(off.elements).toHaveLength(2);
    expect(off.crossings).toHaveLength(0);
    expect(off.individualHill).toHaveLength(0);
    expect(off.mutualHill).toHaveLength(0);
    expect(off.roche).toHaveLength(0);
    expect(off.resonanceCandidates).toHaveLength(0);
    expect(off.resonancePairsSkipped).toHaveLength(0);
    expect(off.issues).toHaveLength(0);
    expect(off.metadata.crossingPairsEvaluated).toBe(0);
    expect(off.metadata.hillBodiesEvaluated).toBe(0);
    expect(off.metadata.hillPairsEvaluated).toBe(0);
    expect(off.metadata.rocheBodiesEvaluated).toBe(0);
    expect(off.metadata.resonancePairsEvaluated).toBe(0);
    expect(off.metadata.resonancePairsSkipped).toBe(0);
    expect(off.metadata.orbitCrossingEnabled).toBe(false);
    expect(off.metadata.hillScreeningEnabled).toBe(false);
    expect(off.metadata.rocheScreeningEnabled).toBe(false);
    expect(off.metadata.resonanceScreeningEnabled).toBe(false);
    expect(off.metadata.rocheLimitModel).toBeNull();
    expect(off.metadata.elementsNonApplicableCount).toBe(0);
  });
});

// --- Сценарии 13–15: предел Роша ---

describe('Stage 4.6.1-D: предел Роша', () => {
  const R_SUN = 6.9634e8;
  const M_EARTH = 5.972e24;
  const R_EARTH = 6.371e6;

  it('radiusM null даёт unknown с missing_physical_parameters, плотности не подставляются', () => {
    const result = requireAnalysis(
      screenOrbitalStability(
        state(0, [sunBody(R_SUN), circleBody('earth', M_EARTH, null, M_SUN, 1e9)]),
        allScreens({ rocheLimitModel: 'fluid' })
      )
    );
    const roche = byId(result.roche, 'earth');
    expect(roche.status).toBe('unknown');
    expect(roche.reason).toBe('missing_physical_parameters');
    expect(roche.rocheLimitM).toBeNull();
    expect(roche.satelliteDensityKgPerM3).toBeNull();
    expect(roche.model).toBe('fluid');
    expect(roche.primaryDensityKgPerM3).not.toBeNull();
    expectRelClose(roche.periapsisDistanceM as number, 1e9, 1e-9);
    const json = JSON.stringify(result);
    expect(json).not.toContain('NaN');
    expect(json).not.toContain('Infinity');
  });

  it('fluid против rigid: отношение пределов 2.44/1.26; одна орбита внутри (fluid) и снаружи (rigid)', () => {
    const makeState = (): NBodyInitialState =>
      state(0, [
        body('sun', M_SUN, R_SUN, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
        circleBody('earth', M_EARTH, R_EARTH, M_SUN, 1e9)
      ]);
    const fluid = requireAnalysis(
      screenOrbitalStability(makeState(), allScreens({ rocheLimitModel: 'fluid' }))
    );
    const rigid = requireAnalysis(
      screenOrbitalStability(makeState(), allScreens({ rocheLimitModel: 'rigid' }))
    );
    const rf = byId(fluid.roche, 'earth');
    const rr = byId(rigid.roche, 'earth');
    expect(rf.status).toBe('inside_roche_limit');
    expect(rr.status).toBe('outside_roche_limit');
    const dFluid = rf.rocheLimitM as number;
    const dRigid = rr.rocheLimitM as number;
    expectRelClose(dFluid / dRigid, 2.44 / 1.26, 1e-12);
    const rhoSun = M_SUN / ((4 / 3) * Math.PI * R_SUN * R_SUN * R_SUN);
    const rhoEarth = M_EARTH / ((4 / 3) * Math.PI * R_EARTH * R_EARTH * R_EARTH);
    expectRelClose(rf.primaryDensityKgPerM3 as number, rhoSun, 1e-12);
    expectRelClose(rf.satelliteDensityKgPerM3 as number, rhoEarth, 1e-12);
    expectRelClose(
      dFluid,
      2.44 * R_SUN * Math.pow(rhoSun / rhoEarth, 1 / 3),
      1e-12
    );
  });

  it('границы полосы Роша: at_roche_boundary в пределах 1e-9, внутри/снаружи за 1e-8', () => {
    expect(ROCHE_BOUNDARY_RELATIVE_BAND).toBe(1e-9);
    const makeState = (r: number): NBodyInitialState =>
      state(0, [
        body('sun', M_SUN, R_SUN, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
        circleBody('earth', M_EARTH, R_EARTH, M_SUN, r)
      ]);
    const reference = requireAnalysis(
      screenOrbitalStability(makeState(1e9), allScreens({ rocheLimitModel: 'fluid' }))
    );
    const d = byId(reference.roche, 'earth').rocheLimitM as number;

    const probe = (r: number): string => {
      const result = requireAnalysis(
        screenOrbitalStability(makeState(r), allScreens({ rocheLimitModel: 'fluid' }))
      );
      return byId(result.roche, 'earth').status;
    };
    expect(probe(d * (1 - 1e-8))).toBe('inside_roche_limit');
    expect(probe(d * (1 + 1e-10))).toBe('at_roche_boundary');
    expect(probe(d * (1 + 1e-8))).toBe('outside_roche_limit');
  });
});

// --- Сценарии 16–18: радиусы Хилла ---

describe('Stage 4.6.1-D: радиусы Хилла', () => {
  it('индивидуальный радиус Хилла: аналитическое значение для круговой орбиты; радиальная не оценена', () => {
    const result = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('earth', 5.972e24, null, M_SUN, 1.5e11),
          body('rock', 1e23, null, { x: 4.5e11, y: 0, z: 0 }, { x: -2.2e4, y: 0, z: 0 })
        ]),
        allScreens()
      )
    );
    const earthHill = byId(result.individualHill, 'earth');
    expect(earthHill.status).toBe('evaluated');
    expect(earthHill.reason).toBeNull();
    expectRelClose(
      earthHill.hillRadiusM as number,
      1.5e11 * Math.cbrt(5.972e24 / (3 * M_SUN)),
      1e-9
    );
    const rockHill = byId(result.individualHill, 'rock');
    expect(rockHill.status).toBe('not_evaluated');
    expect(rockHill.hillRadiusM).toBeNull();
    expect(rockHill.reason).toBe('zero_angular_momentum');
    expect(issueCodes(result)).toContain('hill_not_evaluated');
  });

  it('взаимный Хилл: Delta > 2*sqrt(3) при применимых допущениях; близкая пара под порогом', () => {
    const far = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e24, null, M_SUN, 1.5e11),
          circleBody('q', 1e24, null, M_SUN, 2.25e11)
        ]),
        allScreens()
      )
    );
    const mutualFar = far.mutualHill[0];
    const rhFar = Math.cbrt((1e24 + 1e24) / (3 * M_SUN)) * ((1.5e11 + 2.25e11) / 2);
    expect(mutualFar.classicCriterion).toBe('applicable');
    expect(mutualFar.classicThresholdValue).toBe(CLASSIC_MUTUAL_HILL_THRESHOLD);
    expect(mutualFar.deltaExceedsClassicThreshold).toBe(true);
    expectRelClose(mutualFar.mutualHillRadiusM as number, rhFar, 1e-9);
    expectRelClose(mutualFar.delta as number, Math.abs(2.25e11 - 1.5e11) / rhFar, 1e-9);
    expect(mutualFar.delta as number).toBeGreaterThan(CLASSIC_MUTUAL_HILL_THRESHOLD);
    expectRelClose(mutualFar.semiMajorAxisAM as number, 1.5e11, 1e-9);
    expectRelClose(mutualFar.semiMajorAxisBM as number, 2.25e11, 1e-9);

    const near = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e26, null, M_SUN, 1.5e11),
          circleBody('q', 1e26, null, M_SUN, 1.56e11)
        ]),
        allScreens()
      )
    );
    const mutualNear = near.mutualHill[0];
    expect(mutualNear.classicCriterion).toBe('applicable');
    expect(mutualNear.deltaExceedsClassicThreshold).toBe(false);
    expect(mutualNear.delta as number).toBeLessThan(CLASSIC_MUTUAL_HILL_THRESHOLD);
  });

  it('классический критерий неприменим при большом e или наклонении: Delta без порога', () => {
    const ecc = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          ellipseBody('p1', 1e24, null, M_SUN, 1.5e11, 0.05, false),
          ellipseBody('q', 1e24, null, M_SUN, 1.56e11, 0.05, false)
        ]),
        allScreens({ classicHillMaxEccentricity: 0.01 })
      )
    );
    const mutualEcc = ecc.mutualHill[0];
    expect(mutualEcc.classicCriterion).toBe('criterion_not_applicable');
    expect(mutualEcc.classicThresholdValue).toBeNull();
    expect(mutualEcc.deltaExceedsClassicThreshold).toBeNull();
    expect(mutualEcc.delta).not.toBeNull();
    expect(mutualEcc.status).toBe('evaluated');
    expect(mutualEcc.reason).toBe('criterion_not_applicable');
    expect(issueCodes(ecc)).toContain('criterion_not_applicable');

    const incl = requireAnalysis(
      screenOrbitalStability(
        state(0, [
          sunBody(null),
          circleBody('p1', 1e24, null, M_SUN, 1.5e11),
          circleBody('q', 1e24, null, M_SUN, 1.56e11, Math.PI / 8)
        ]),
        allScreens()
      )
    );
    const mutualIncl = incl.mutualHill[0];
    expect(mutualIncl.classicCriterion).toBe('criterion_not_applicable');
    expectRelClose(mutualIncl.mutualInclinationRad as number, Math.PI / 8, 1e-12);
    expect(mutualIncl.deltaExceedsClassicThreshold).toBeNull();
  });
});

// --- Сценарии 19–20: соизмеримости периодов ---

describe('Stage 4.6.1-D: резонансы (соизмеримости периодов)', () => {
  it('2:1, 3:2 и 1:1 найдены с измеренными отклонениями; внутренний и внешний по периоду', () => {
    const runRatio = (ratio: number, phaseOpposite = false) => {
      const a1 = 1.5e11;
      const a2 = a1 * Math.pow(ratio, 2 / 3);
      const inner = circleBody('p1', 1e24, null, M_SUN, a1);
      const outer = phaseOpposite
        ? body(
            'q',
            1e24,
            null,
            { x: -a2, y: 0, z: 0 },
            { x: 0, y: -Math.sqrt(muOf(M_SUN, 1e24) / a2), z: 0 }
          )
        : circleBody('q', 1e24, null, M_SUN, a2);
      return requireAnalysis(
        screenOrbitalStability(
          state(0, [sunBody(null), inner, outer]),
          allScreens()
        )
      );
    };

    const twoToOne = runRatio(2);
    expect(twoToOne.resonanceCandidates).toHaveLength(1);
    const c21 = twoToOne.resonanceCandidates[0];
    expect(c21.pairIdInner).toBe('p1');
    expect(c21.pairIdOuter).toBe('q');
    expect(c21.numeratorP).toBe(2);
    expect(c21.denominatorQ).toBe(1);
    expectRelClose(c21.periodRatio, 2, 1e-9);
    expect(c21.relativeDeviation).toBeLessThanOrEqual(1e-9);
    expect(c21.relativeTolerance).toBe(0.01);
    expect(c21.status).toBe('near_mean_motion_commensurability');
    expect(twoToOne.resonancePairsSkipped).toHaveLength(0);

    const threeToTwo = runRatio(1.5);
    expect(threeToTwo.resonanceCandidates).toHaveLength(1);
    expect(threeToTwo.resonanceCandidates[0].numeratorP).toBe(3);
    expect(threeToTwo.resonanceCandidates[0].denominatorQ).toBe(2);
    expectRelClose(threeToTwo.resonanceCandidates[0].periodRatio, 1.5, 1e-9);
    expect(threeToTwo.resonanceCandidates[0].relativeDeviation).toBeLessThanOrEqual(1e-9);

    const oneToOne = runRatio(1, true);
    expect(oneToOne.resonanceCandidates).toHaveLength(1);
    const c11 = oneToOne.resonanceCandidates[0];
    expect(c11.numeratorP).toBe(1);
    expect(c11.denominatorQ).toBe(1);
    expect(c11.pairIdInner).toBe('p1');
    expectRelClose(c11.periodRatio, 1, 1e-12);
    expect(c11.relativeDeviation).toBeLessThanOrEqual(1e-12);
  });

  it('maxResonanceInteger отсекает 4:3; допуск отделяет внутри и снаружи; кандидаты отсортированы', () => {
    const a1 = 1.5e11;
    const run = (ratio: number, tolerance: number, maxInt: number) =>
      requireAnalysis(
        screenOrbitalStability(
          state(0, [
            sunBody(null),
            circleBody('p1', 1e24, null, M_SUN, a1),
            circleBody('q', 1e24, null, M_SUN, a1 * Math.pow(ratio, 2 / 3))
          ]),
          allScreens({
            resonanceRelativeTolerance: tolerance,
            maxResonanceInteger: maxInt
          })
        )
      );

    const fourThirdsLocked = run(4 / 3, 0.01, 3);
    expect(fourThirdsLocked.resonanceCandidates).toHaveLength(0);
    expect(fourThirdsLocked.metadata.resonancePairsEvaluated).toBe(1);
    const fourThirdsFound = run(4 / 3, 0.01, 4);
    expect(fourThirdsFound.resonanceCandidates).toHaveLength(1);
    expect(fourThirdsFound.resonanceCandidates[0].numeratorP).toBe(4);
    expect(fourThirdsFound.resonanceCandidates[0].denominatorQ).toBe(3);
    expect(fourThirdsFound.resonanceCandidates[0].relativeDeviation).toBeLessThanOrEqual(1e-9);

    const insideTolerance = run(2 * 1.0005, 0.001, 6);
    expect(insideTolerance.resonanceCandidates.length).toBeGreaterThanOrEqual(1);
    expect(insideTolerance.resonanceCandidates[0].numeratorP).toBe(2);
    expect(insideTolerance.resonanceCandidates[0].relativeDeviation)
      .toBeLessThanOrEqual(0.001);
    const outsideTolerance = run(2 * 1.0015, 0.001, 6);
    expect(outsideTolerance.resonanceCandidates).toHaveLength(0);

    const wide = run(2, 0.4, 8);
    const cands = wide.resonanceCandidates;
    expect(cands.length).toBeGreaterThanOrEqual(5);
    expect(cands[0].numeratorP).toBe(2);
    expect(cands[0].denominatorQ).toBe(1);
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    for (const cand of cands) {
      expect(gcd(cand.numeratorP, cand.denominatorQ)).toBe(1);
      expect(cand.relativeDeviation).toBeLessThanOrEqual(0.4 + 1e-15);
      expect(cand.relativeDeviation).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < cands.length; i++) {
      const prev = cands[i - 1];
      const cur = cands[i];
      const keyPrev = [prev.relativeDeviation, prev.numeratorP + prev.denominatorQ, prev.numeratorP];
      const keyCur = [cur.relativeDeviation, cur.numeratorP + cur.denominatorQ, cur.numeratorP];
      let ordered = false;
      for (let k = 0; k < 3; k++) {
        if (keyCur[k] > keyPrev[k]) { ordered = true; break; }
        if (keyCur[k] < keyPrev[k]) { break; }
      }
      if (!ordered && keyPrev.every((v, k) => v === keyCur[k])) ordered = true;
      expect(ordered).toBe(true);
    }
  });
});
