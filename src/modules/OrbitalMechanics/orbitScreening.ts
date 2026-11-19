// ============================================
// ORBIT SCREENING - аналитический скрининг осциллирующих кеплеровских
// орбит (Stage 4.6.1-D)
// ============================================
//
// ЧИСТЫЙ ДИАГНОСТИЧЕСКИЙ слой поверх N-body динамики (dynamics.ts) и
// событийного слоя (events.ts):
// - модуль НИЧЕГО не интегрирует и НЕ вызывается из движка: поведение
//   integrateNBodyLeapfrog и integrateNBodyWithEvents не изменяется;
// - входное состояние не модифицируется (read-only);
// - НИ ОДИН результат не является вердиктом 'stable'/'unstable':
//   каждый критерий - аналитическое приближение, вычисленное на
//   ОСЦИЛЛИРУЮЩИХ двухтельных элементах одной эпохи.
//
// Все элементы - ОСЦИЛЛИРУЮЩИЕ ДВУХТЕЛЬНЫЕ для пары (тело, primary) на
// эпохе state.timeS начального состояния, НЕ постоянные параметры
// многотельной задачи:
//   mu_i = G(M_p + m_i),  eps_i = v_i^2/2 - mu_i/r_i,
//   h_i = r_i x v_i,  e_i = (v_i x h_i)/mu_i - r_i/|r_i|,
//   a_i = -mu_i/(2 eps_i),  p_i = |h_i|^2/mu_i,
//   P_i = 2*pi*sqrt(a_i^3/mu_i)   (только эллипс).
// Единицы SI зашиты в имена полей (M, MPerS, M2PerS, JPerKg, M3PerS2).
//
// Fail-closed: нехватка данных (radiusM null, вырожденная коника,
// нечисловые значения) даёт not_evaluated/unknown/indeterminate с
// машинной причиной - типичные радиусы, плотности и никогда не
// подставляются, неизвестное не превращается в положительный результат.

import { G } from '../Units';
import type { NBodyInitialState, OrbitalBodyState, Vector3 } from './dynamics';

// ============================================
// 1. ТИПЫ
// ============================================

export type OrbitScreeningStatus = 'completed' | 'indeterminate';
export type OsculatingTrajectoryKind =
  | 'elliptic'
  | 'parabolic'
  | 'hyperbolic'
  | 'radial'
  | 'degenerate';

/** Машинно читаемая причина: код + сообщение + затронутые тела. */
export interface OrbitScreeningIssue {
  code: string;
  message: string;
  /** Лексикографически упорядоченные id затронутых тел. */
  bodyIds: string[];
}

/**
 * Осциллирующие двухтельные элементы пары (тело, primary) на эпохе.
 * Значения зависят от выбранного primary и эпохи; это НЕ постоянные
 * орбитальные параметры многотельной задачи.
 */
export interface OsculatingElementsRecord {
  bodyId: string;
  primaryBodyId: string;
  /**
   * Класс осциллирующей коники на эпохе (НЕ категория устойчивости:
   * элемент может меняться от шага к шагу многотельной динамики).
   */
  trajectoryKind: OsculatingTrajectoryKind;
  /**
   * Коника с p > 0 (ненулевой угловой момент, конечные p и e) доступна
   * геометрическим скринингам (пересечение, Рош, периоды).
   */
  conicApplicable: boolean;
  /** Машинная причина неприменимости коники; null, если применима. */
  inapplicableReason: string | null;
  /** |r_i|, м. */
  distanceM: number;
  /** r_i = r_тела - r_primary, м (инерциальная система входного состояния). */
  relativePositionM: Vector3;
  /** v_i = v_тела - v_primary, м/с. */
  relativeVelocityMPerS: Vector3;
  /** mu_i = G(M_p + m_i), м^3/с^2. */
  muM3PerS2: number;
  /** eps_i = v_i^2/2 - mu_i/r_i, Дж/кг. */
  specificOrbitalEnergyJPerKg: number;
  /** h_i = r_i x v_i, м^2/с. */
  specificAngularMomentumVectorM2PerS: Vector3;
  /** |h_i|, м^2/с. */
  specificAngularMomentumM2PerS: number;
  /** Вектор Лапласа-Рунге-Ленца e_i, безразмерный. */
  eccentricityVector: Vector3;
  /** |e_i|, безразмерный. */
  eccentricity: number;
  /** Единичная нормаль плоскости h_i/|h_i|; null при |h_i| = 0. */
  planeNormalUnit: Vector3 | null;
  /** Большая полуось a_i, м; ТОЛЬКО эллипс, иначе null (не придумывается). */
  semiMajorAxisM: number | null;
  /** Фокальный параметр p_i = |h_i|^2/mu_i, м; null при нулевом h_i. */
  semiLatusRectumM: number | null;
  /**
   * Период P_i = 2*pi*sqrt(a_i^3/mu_i), с; ТОЛЬКО эллипс: параболическим
   * и гиперболическим траекториям период НЕ присваивается.
   */
  orbitalPeriodS: number | null;
  /** Перицентр p_i/(1+e_i), м (для эллипса это a_i(1-e_i)); null при нулевом h_i. */
  periapsisDistanceM: number | null;
  /** Апоцентр a_i(1+e_i), м; только эллипс, иначе null. */
  apoapsisDistanceM: number | null;
  /** Эпоха элементов, с (равна state.timeS входного состояния). */
  epochS: number;
}

export interface OrbitScreeningOptions {
  /** Явный primary; НЕ выбирается по массе автоматически. */
  primaryBodyId: string;
  /** Скрининг геометрических пересечений орбит. */
  orbitCrossingEnabled: boolean;
  /** Допуск совпадения радиусов в общей точке, м; обязателен при включённом crossing. */
  orbitIntersectionToleranceM?: number;
  /** Скрининг радиусов Хилла. */
  hillScreeningEnabled: boolean;
  /** Предел эксцентриситета для классического критерия 2*sqrt(3); обязателен при hill. */
  classicHillMaxEccentricity?: number;
  /** Предел взаимного наклонения (рад) для классического критерия; обязателен при hill. */
  classicHillMaxRelativeInclinationRad?: number;
  /** Скрининг предела Роша. */
  rocheScreeningEnabled: boolean;
  /**
   * Модель тела спутника: 'fluid' (2.44) или 'rigid' (1.26). Выбирается
   * ЯВНО в опциях, никогда - автоматически по типу планеты.
   */
  rocheLimitModel?: 'fluid' | 'rigid';
  /** Скрининг резонансов. */
  resonanceScreeningEnabled: boolean;
  /** Относительный допуск близости P_out/P_in к p/q; обязателен при resonance. */
  resonanceRelativeTolerance?: number;
  /** Верхняя граница числителя и знаменателя p, q; обязателен при resonance. */
  maxResonanceInteger?: number;
}

export type OrbitCrossingKind =
  | 'geometric_crossing'
  | 'no_geometric_crossing'
  | 'coincident_orbits'
  | 'indeterminate';

/**
 * Одна общая точка двух орбитальных траекторий относительно primary.
 * Геометрическое пересечение НЕ означает, что тела окажутся в точке
 * одновременно, и НЕ является collision event и не влияет на связность.
 */
export interface OrbitIntersectionPoint {
  /** Радиус коники тела A в точке, м. */
  radiusAM: number;
  /** Радиус коники тела B в точке, м. */
  radiusBM: number;
  /** |r_A - r_B| в точке, м (в пределах допуска ~ 0). */
  radiusDifferenceM: number;
  /** Оценённая общая точка относительно primary, м. */
  sharedPointM: Vector3;
}

export interface OrbitCrossingPairResult {
  pairIdA: string;
  pairIdB: string;
  result: OrbitCrossingKind;
  /** Плоскости параллельны: копланарная аналитика, узловой линии нет. */
  coplanar: boolean;
  /** Единичное направление линии пересечения плоскостей; null для копланарных. */
  nodeLineDirection: Vector3 | null;
  /** Совпадающие точки (0, 1 при касании или 2). */
  intersections: OrbitIntersectionPoint[];
  /** Использованный допуск, м (зеркало опции); null при indeterminate. */
  toleranceM: number | null;
  /** Машинная причина indeterminate; иначе null. */
  reason: string | null;
}

export interface IndividualHillResult {
  bodyId: string;
  /**
   * R_H,i = a_i (1 - e_i) (m_i / (3 M_p))^(1/3), м. Оценка на перицентре
   * для эксцентричной орбиты в задаче малой массы, НЕ точная граница
   * устойчивости многотельной задачи.
   */
  hillRadiusM: number | null;
  status: 'evaluated' | 'not_evaluated';
  /** Машинная причина not_evaluated; иначе null. */
  reason: string | null;
}

export type HillCriterionApplicability =
  | 'applicable'
  | 'criterion_not_applicable'
  | 'assumptions_unknown';

export interface MutualHillResult {
  pairIdA: string;
  pairIdB: string;
  semiMajorAxisAM: number | null;
  semiMajorAxisBM: number | null;
  /** R_H,m = ((m_i+m_j)/(3 M_p))^(1/3) * (a_i+a_j)/2, м. */
  mutualHillRadiusM: number | null;
  /** Delta = |a_j - a_i| / R_H,m, безразмерный. НЕ 'stable'/'unstable'. */
  delta: number | null;
  /** Взаимное наклонение плоскостей (по нормалям коник), рад; иначе null. */
  mutualInclinationRad: number | null;
  classicCriterion: HillCriterionApplicability;
  /** 2*sqrt(3), когда классический критерий применим; иначе null. */
  classicThresholdValue: number | null;
  /** Delta > 2*sqrt(3) при применимом критерии; иначе null. */
  deltaExceedsClassicThreshold: boolean | null;
  status: 'evaluated' | 'not_evaluated';
  /** Машинная причина неоценки или неприменимости; иначе null. */
  reason: string | null;
}

export type RocheScreenStatus =
  | 'inside_roche_limit'
  | 'outside_roche_limit'
  | 'at_roche_boundary'
  | 'unknown'
  | 'not_evaluated';
export type RocheLimitModel = 'fluid' | 'rigid';

export interface RocheBodyResult {
  bodyId: string;
  primaryBodyId: string;
  model: RocheLimitModel;
  /** Плотность primary, кг/м^3; null, если радиус primary не задан. */
  primaryDensityKgPerM3: number | null;
  /** Плотность спутника, кг/м^3; null, если радиус спутника не задан. */
  satelliteDensityKgPerM3: number | null;
  /** d = C_model * R_p * (rho_p/rho_s)^(1/3), м; null, если плотности неизвестны. */
  rocheLimitM: number | null;
  /** Перицентр q = a(1-e) (эллипс) либо p/(1+e) коники, м. */
  periapsisDistanceM: number | null;
  status: RocheScreenStatus;
  /** Машинная причина unknown/not_evaluated; иначе null. */
  reason: string | null;
}

export interface ResonanceCandidate {
  pairIdInner: string;
  pairIdOuter: string;
  /** P_outer/P_inner > 0 (осциллирующие периоды на эпохе). */
  periodRatio: number;
  /** Числитель p взаимно простого отношения p:q. */
  numeratorP: number;
  /** Знаменатель q взаимно простого отношения p:q. */
  denominatorQ: number;
  /** |ratio - p/q| / (p/q), безразмерный. */
  relativeDeviation: number;
  relativeTolerance: number;
  /**
   * Близость периодов к рациональному отношению. Это НЕ подтверждённый
   * резонанс: подтверждение требует исследования либрации резонансных
   * углов во времени, что в этап 4.6.1-D НЕ входит.
   */
  status: 'near_mean_motion_commensurability';
}

export interface ResonancePairSkip {
  pairIdA: string;
  pairIdB: string;
  /** Машинная причина неоценки пары. */
  reason: string;
}

export interface OrbitScreeningMetadata {
  primaryBodyId: string;
  epochS: number;
  bodyCount: number;
  orbitalBodyCount: number;
  /** Число орбитальных пар C(n,2). */
  pairCount: number;
  orbitCrossingEnabled: boolean;
  hillScreeningEnabled: boolean;
  rocheScreeningEnabled: boolean;
  rocheLimitModel: RocheLimitModel | null;
  resonanceScreeningEnabled: boolean;
  crossingPairsEvaluated: number;
  crossingPairsSkipped: number;
  hillBodiesEvaluated: number;
  hillBodiesSkipped: number;
  hillPairsEvaluated: number;
  hillPairsSkipped: number;
  rocheBodiesEvaluated: number;
  rocheBodiesSkipped: number;
  resonancePairsEvaluated: number;
  resonancePairsSkipped: number;
  /** Число орбитальных тел с неприменимой коникой (вырождено/не числовое). */
  elementsNonApplicableCount: number;
}

/**
 * Анализ выполнен (возможно, частично). Отдельные критерии могут быть
 * indeterminate/not_evaluated из-за вырожденной или недостаточной
 * орбитальной информации - см. reason/issues и metadata.
 */
export interface OrbitScreeningAnalysis {
  status: OrbitScreeningStatus;
  elements: OsculatingElementsRecord[];
  crossings: OrbitCrossingPairResult[];
  individualHill: IndividualHillResult[];
  mutualHill: MutualHillResult[];
  roche: RocheBodyResult[];
  resonanceCandidates: ResonanceCandidate[];
  resonancePairsSkipped: ResonancePairSkip[];
  issues: OrbitScreeningIssue[];
  metadata: OrbitScreeningMetadata;
}

/** Некорректные параметры или первичный объект. */
export interface OrbitScreeningInvalidInput {
  status: 'invalid_input';
  issues: OrbitScreeningIssue[];
}

export type OrbitScreeningResult = OrbitScreeningAnalysis | OrbitScreeningInvalidInput;

/**
 * Глобальные ограничения скрининга: осциллирующие двухтельные элементы
 * диагностичны; аналитические критерии игнорируют многотельные
 * возмущения; временная динамика резонансных углов не моделируется;
 * НЕ выдаётся ни один вердикт stable/unstable.
 */
export const ORBIT_SCREENING_LIMITATION =
  'Аналитический скрининг Stage 4.6.1-D использует осциллирующие двухтельные ' +
  'элементы на одной эпохе; он не учитывает многотельные возмущения, не моделирует ' +
  'временную динамику резонансных углов и НЕ выдаёт вердиктов stable/unstable. ' +
  'Геометрическое пересечение орбит не означает встречи тел; предел Роша ' +
  'предполагает сферичность и жидкую/жёсткую идеализацию без прочности ' +
  'и внутренней структуры.';

export const ROCHE_LIMITATION =
  'Предел Роша: сферические тела, классическая приливная идеализация ' +
  '(2.44 - жидкий спутник, 1.26 - жёсткий), без прочности/когезии и сложной ' +
  'внутренней структуры. Плотности вычисляются только из заданных m и R; ' +
  'radiusM null оставляет результат unknown, плотность НЕ подставляется.';

/** Порог классического взаимного критерия Хилла: Delta > 2*sqrt(3). */
export const CLASSIC_MUTUAL_HILL_THRESHOLD = 2 * Math.sqrt(3);
/** Относительная полуширина полосы at_roche_boundary (|q/d - 1| <= band). */
export const ROCHE_BOUNDARY_RELATIVE_BAND = 1e-9;

// ============================================
// 2. ВЕКТОРНЫЕ ОПЕРАЦИИ (Vector3 из dynamics.ts)
// ============================================

function isFiniteScalar(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}

function vDot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vCross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function vNorm(a: Vector3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function vScale(a: Vector3, s: number): Vector3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function vSub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** Единичный вектор или null при нулевой/нечисловой норме. */
function vUnit(a: Vector3): Vector3 | null {
  const n = vNorm(a);
  if (!(n > 0) || !isFiniteScalar(n)) {
    return null;
  }
  return { x: a.x / n, y: a.y / n, z: a.z / n };
}

function clampUnit(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

// ============================================
// 3. ОСЦИЛЛИРУЮЩИЕ ДВУХТЕЛЬНЫЕ ЭЛЕМЕНТЫ (п. 3 промта)
// ============================================

/** Относительная ширина окна |eps| ~ 0 (парабола). */
const PARABOLIC_EPS_REL = 1e-12;
/** Относительный порог нулевого углового момента (радиальная траектория). */
const RADIAL_H_REL = 1e-14;

function degenerateRecord(
  bodyId: string,
  primaryBodyId: string,
  kind: OsculatingTrajectoryKind,
  reason: string,
  r: Vector3,
  v: Vector3,
  rMag: number,
  mu: number,
  eps: number,
  h: Vector3,
  hMag: number,
  eVec: Vector3,
  eMag: number,
  epochS: number
): OsculatingElementsRecord {
  return {
    bodyId,
    primaryBodyId,
    trajectoryKind: kind,
    conicApplicable: false,
    inapplicableReason: reason,
    distanceM: rMag,
    relativePositionM: r,
    relativeVelocityMPerS: v,
    muM3PerS2: mu,
    specificOrbitalEnergyJPerKg: eps,
    specificAngularMomentumVectorM2PerS: h,
    specificAngularMomentumM2PerS: hMag,
    eccentricityVector: eVec,
    eccentricity: eMag,
    planeNormalUnit: null,
    semiMajorAxisM: null,
    semiLatusRectumM: null,
    orbitalPeriodS: null,
    periapsisDistanceM: null,
    apoapsisDistanceM: null,
    epochS
  };
}

/**
 * Осциллирующие двухтельные элементы пары (тело, primary) на эпохе.
 * Обрабатывает: нулевой угловой момент (радиальная траектория),
 * параболические и гиперболические коники (период и большая полуось
 * эллипса НЕ присваиваются), нечисловые значения и вырожденные входы -
 * fail-closed: conicApplicable = false + машинная причина, значения
 * не выдумываются.
 */
export function computeOsculatingElements(
  bodyId: string,
  primaryBodyId: string,
  relativePositionM: Vector3,
  relativeVelocityMPerS: Vector3,
  muM3PerS2: number,
  epochS: number
): OsculatingElementsRecord {
  const r = relativePositionM;
  const v = relativeVelocityMPerS;
  const rMag = vNorm(r);
  const vMag = vNorm(v);
  const h = vCross(r, v);
  const hMag = vNorm(h);
  const mu = muM3PerS2;
  const eps = rMag > 0 ? 0.5 * vMag * vMag - mu / rMag : NaN;

  if (
    !isFiniteScalar(rMag) ||
    !isFiniteScalar(vMag) ||
    !isFiniteScalar(hMag) ||
    !isFiniteScalar(eps) ||
    !isFiniteScalar(mu) ||
    !isFiniteScalar(epochS) ||
    !(mu > 0)
  ) {
    return degenerateRecord(
      bodyId, primaryBodyId, 'degenerate', 'nonfinite_or_invalid_input',
      r, v, rMag, mu, eps, h, hMag, { x: NaN, y: NaN, z: NaN }, NaN, epochS
    );
  }

  const eVec = vSub(vScale(vCross(v, h), 1 / mu), vScale(r, 1 / rMag));
  const eMag = vNorm(eVec);
  if (!isFiniteScalar(eMag)) {
    return degenerateRecord(
      bodyId, primaryBodyId, 'degenerate', 'nonfinite_eccentricity',
      r, v, rMag, mu, eps, h, hMag, eVec, eMag, epochS
    );
  }

  // Нулевой угловой момент: радиальная (вырожденная) траектория.
  if (hMag === 0 || hMag <= RADIAL_H_REL * Math.max(rMag * vMag, 1e-300)) {
    return degenerateRecord(
      bodyId, primaryBodyId, 'radial', 'zero_angular_momentum',
      r, v, rMag, mu, eps, h, hMag, eVec, eMag, epochS
    );
  }

  // Совпадение положений: коники не существует.
  if (!(rMag > 0)) {
    return degenerateRecord(
      bodyId, primaryBodyId, 'degenerate', 'zero_separation_degenerate',
      r, v, rMag, mu, eps, h, hMag, eVec, eMag, epochS
    );
  }

  const p = (hMag * hMag) / mu;
  const normal = vUnit(h);
  const epsScale = mu / rMag;

  // Парабола: |eps| в узком относительном окне вокруг нуля.
  if (Math.abs(eps) <= PARABOLIC_EPS_REL * epsScale) {
    const periapsis = p / (1 + eMag);
    return {
      bodyId,
      primaryBodyId,
      trajectoryKind: 'parabolic',
      conicApplicable: true,
      inapplicableReason: null,
      distanceM: rMag,
      relativePositionM: r,
      relativeVelocityMPerS: v,
      muM3PerS2: mu,
      specificOrbitalEnergyJPerKg: eps,
      specificAngularMomentumVectorM2PerS: h,
      specificAngularMomentumM2PerS: hMag,
      eccentricityVector: eVec,
      eccentricity: eMag,
      planeNormalUnit: normal,
      semiMajorAxisM: null,
      semiLatusRectumM: isFiniteScalar(p) ? p : null,
      orbitalPeriodS: null,
      periapsisDistanceM: isFiniteScalar(periapsis) ? periapsis : null,
      apoapsisDistanceM: null,
      epochS
    };
  }

  if (eps > 0) {
    // Гипербола: период и большая полуось ЭЛЛИПСА не присваиваются.
    const periapsis = p / (1 + eMag);
    return {
      bodyId,
      primaryBodyId,
      trajectoryKind: 'hyperbolic',
      conicApplicable: true,
      inapplicableReason: null,
      distanceM: rMag,
      relativePositionM: r,
      relativeVelocityMPerS: v,
      muM3PerS2: mu,
      specificOrbitalEnergyJPerKg: eps,
      specificAngularMomentumVectorM2PerS: h,
      specificAngularMomentumM2PerS: hMag,
      eccentricityVector: eVec,
      eccentricity: eMag,
      planeNormalUnit: normal,
      semiMajorAxisM: null,
      semiLatusRectumM: isFiniteScalar(p) ? p : null,
      orbitalPeriodS: null,
      periapsisDistanceM: isFiniteScalar(periapsis) ? periapsis : null,
      apoapsisDistanceM: null,
      epochS
    };
  }

  // Эллипс: a = -mu/(2 eps) > 0, e < 1.
  const a = -mu / (2 * eps);
  const period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
  const periapsis = p / (1 + eMag);
  const apoapsis = a * (1 + eMag);
  const consistent =
    eMag < 1 && isFiniteScalar(a) && a > 0 && isFiniteScalar(period) && isFiniteScalar(apoapsis);
  if (!consistent) {
    return degenerateRecord(
      bodyId, primaryBodyId, 'degenerate', 'inconsistent_elliptic_elements',
      r, v, rMag, mu, eps, h, hMag, eVec, eMag, epochS
    );
  }
  return {
    bodyId,
    primaryBodyId,
    trajectoryKind: 'elliptic',
    conicApplicable: true,
    inapplicableReason: null,
    distanceM: rMag,
    relativePositionM: r,
    relativeVelocityMPerS: v,
    muM3PerS2: mu,
    specificOrbitalEnergyJPerKg: eps,
    specificAngularMomentumVectorM2PerS: h,
    specificAngularMomentumM2PerS: hMag,
    eccentricityVector: eVec,
    eccentricity: eMag,
    planeNormalUnit: normal,
    semiMajorAxisM: a,
    semiLatusRectumM: p,
    orbitalPeriodS: period,
    periapsisDistanceM: periapsis,
    apoapsisDistanceM: apoapsis,
    epochS
  };
}

// ============================================
// 4. ГЕОМЕТРИЧЕСКИЕ ПЕРЕСЕЧЕНИЯ ОРБИТ (п. 4 промта)
// ============================================

const TANGENT_SLACK = 1e-9;

/** Детерминированный ортонормированный базис (u, w) плоскости с нормалью n. */
function coplanarBasis(n: Vector3): { u: Vector3; w: Vector3 } {
  const axes: Vector3[] = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 }
  ];
  let abs = Math.abs(n.x);
  let best = 0;
  if (Math.abs(n.y) < abs) {
    abs = Math.abs(n.y);
    best = 1;
  }
  if (Math.abs(n.z) < abs) {
    abs = Math.abs(n.z);
    best = 2;
  }
  const u = vUnit(vCross(n, axes[best]));
  if (u === null) {
    // Недостижимо для единичной нормали; fail-closed на всякий случай.
    return { u: { x: 1, y: 0, z: 0 }, w: { x: 0, y: 1, z: 0 } };
  }
  return { u, w: vCross(n, u) };
}

interface IntersectionAccum {
  kind: OrbitCrossingKind;
  points: OrbitIntersectionPoint[];
}

/**
 * Копланарная аналитика: равенство радиусов p1/(1+e1*q) = p2/(1+e2*q)
 * сводится к A + B*cos(theta) + C*sin(theta) = 0 и решается аналитически
 * (два пересечения / касание / нет пересечения / совпадающие орбиты).
 * Грубая сетка углов НЕ используется.
 */
function coplanarIntersectionSolve(
  elemA: OsculatingElementsRecord,
  elemB: OsculatingElementsRecord,
  toleranceM: number
): IntersectionAccum {
  const normal = elemA.planeNormalUnit as Vector3;
  const { u, w } = coplanarBasis(normal);
  const p1 = elemA.semiLatusRectumM as number;
  const p2 = elemB.semiLatusRectumM as number;
  const c1 = vDot(elemA.eccentricityVector, u);
  const d1 = vDot(elemA.eccentricityVector, w);
  const c2 = vDot(elemB.eccentricityVector, u);
  const d2 = vDot(elemB.eccentricityVector, w);
  const coeffA = p1 - p2;
  const coeffB = p1 * c2 - p2 * c1;
  const coeffC = p1 * d2 - p2 * d1;
  const ampR = Math.hypot(coeffB, coeffC);
  const points: OrbitIntersectionPoint[] = [];

  if (Math.abs(coeffA) <= toleranceM && ampR <= toleranceM) {
    // Совпадающие или практически совпадающие орбиты: любая точка общая.
    return { kind: 'coincident_orbits', points };
  }
  if (ampR <= toleranceM) {
    // e-векторы совпадают в пределах допуска, но p различим: радиусы
    // нигде не равны (знак разности постоянен).
    return { kind: 'no_geometric_crossing', points };
  }
  const ratio = -coeffA / ampR;
  if (ratio < -1 - TANGENT_SLACK || ratio > 1 + TANGENT_SLACK) {
    return { kind: 'no_geometric_crossing', points };
  }
  const phi = Math.atan2(coeffC, coeffB);
  let thetas: number[];
  if (ratio >= 1 - TANGENT_SLACK || ratio <= -1 + TANGENT_SLACK) {
    // Касательное пересечение: единственное направление.
    thetas = [phi + (ratio >= 0 ? 0 : Math.PI)];
  } else {
    const delta = Math.acos(clampUnit(ratio));
    thetas = [phi + delta, phi - delta];
  }
  for (const theta of thetas) {
    const qHat: Vector3 = {
      x: u.x * Math.cos(theta) + w.x * Math.sin(theta),
      y: u.y * Math.cos(theta) + w.y * Math.sin(theta),
      z: u.z * Math.cos(theta) + w.z * Math.sin(theta)
    };
    // Направление может не принадлежать ветви коники (гипербола/парабола).
    const den1 = 1 + vDot(elemA.eccentricityVector, qHat);
    const den2 = 1 + vDot(elemB.eccentricityVector, qHat);
    if (!(den1 > 1e-15) || !(den2 > 1e-15)) {
      continue;
    }
    const r1 = p1 / den1;
    const r2 = p2 / den2;
    points.push({
      radiusAM: r1,
      radiusBM: r2,
      radiusDifferenceM: Math.abs(r1 - r2),
      sharedPointM: vScale(qHat, r1)
    });
  }
  return { kind: points.length >= 1 ? 'geometric_crossing' : 'no_geometric_crossing', points };
}

/** Радиус коники вдоль единичного направления орбитальной плоскости. */
function conicRadiusAlongP(elem: OsculatingElementsRecord, qHat: Vector3): number | null {
  const p = elem.semiLatusRectumM;
  if (p === null) {
    return null;
  }
  const den = 1 + vDot(elem.eccentricityVector, qHat);
  if (!(den > 1e-15) || !isFiniteScalar(den)) {
    return null;
  }
  const radius = p / den;
  return isFiniteScalar(radius) ? radius : null;
}

// ============================================
// 5. ГЛАВНЫЙ API: screenOrbitalStability (пп. 2, 5-8 промта)
// ============================================

const COPLANAR_NORMALS_REL = 1e-12;
const ROCHE_FLUID_COEFFICIENT = 2.44;
const ROCHE_RIGID_COEFFICIENT = 1.26;

function issueOf(code: string, message: string, bodyIds: string[]): OrbitScreeningIssue {
  return { code, message, bodyIds: [...bodyIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) };
}

/**
 * Аналитический скрининг стабильности осциллирующих орбит (Stage 4.6.1-D).
 * Чистая функция: initialState не модифицируется. Primary задаётся ЯВНО
 * (никогда не выбирается по массе). Fail-closed: недостающие данные дают
 * not_evaluated/unknown с машинной причиной. результаты - диагностические,
 * вердикты stable/unstable не выдаются.
 */
export function screenOrbitalStability(
  initialState: NBodyInitialState,
  options: OrbitScreeningOptions
): OrbitScreeningResult {
  const issues: OrbitScreeningIssue[] = [];

  // --- Валидация состояния ---
  const bodies: OrbitalBodyState[] = initialState?.bodies ?? [];
  if (!Array.isArray(bodies) || bodies.length < 2) {
    issues.push(issueOf('bodies_too_few', 'нужно не менее двух тел', []));
  }
  if (!isFiniteScalar(initialState?.timeS) || initialState.timeS < 0) {
    issues.push(issueOf('invalid_time_s', 'timeS должен быть конечным неотрицательным', []));
  }
  const seenIds = new Set<string>();
  for (const b of bodies) {
    if (typeof b.id !== 'string' || b.id.length === 0) {
      issues.push(issueOf('invalid_body_id', 'id тела должен быть непустой строкой', []));
      continue;
    }
    if (seenIds.has(b.id)) {
      issues.push(issueOf('duplicate_body_id', 'дубликат id тела', [b.id]));
    }
    seenIds.add(b.id);
    if (!isFiniteScalar(b.massKg) || b.massKg <= 0) {
      issues.push(issueOf('invalid_body_mass', 'масса тела должна быть конечной и строго положительной', [b.id]));
    }
    if (b.radiusM !== null && (!isFiniteScalar(b.radiusM) || b.radiusM <= 0)) {
      issues.push(issueOf('invalid_body_radius', 'radiusM должен быть null либо конечным положительным', [b.id]));
    }
    for (const comp of [b.positionM.x, b.positionM.y, b.positionM.z]) {
      if (!isFiniteScalar(comp)) {
        issues.push(issueOf('invalid_body_position', 'позиция тела содержит нечисловое значение', [b.id]));
        break;
      }
    }
    for (const comp of [b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z]) {
      if (!isFiniteScalar(comp)) {
        issues.push(issueOf('invalid_body_velocity', 'скорость тела содержит нечисловое значение', [b.id]));
        break;
      }
    }
  }

  // --- Валидация primary: НИКОГДА не подбирается по массе ---
  if (typeof options.primaryBodyId !== 'string' || options.primaryBodyId.length === 0) {
    issues.push(issueOf('invalid_primary_body_id', 'primaryBodyId должен быть непустой строкой', []));
  } else if (!bodies.some((b) => b.id === options.primaryBodyId)) {
    issues.push(issueOf('primary_body_not_found', 'primary не найден среди тел; auto-selection по массе запрещён', [options.primaryBodyId]));
  }

  // --- Валидация флагов ---
  for (const flag of [
    ['orbitCrossingEnabled', options.orbitCrossingEnabled],
    ['hillScreeningEnabled', options.hillScreeningEnabled],
    ['rocheScreeningEnabled', options.rocheScreeningEnabled],
    ['resonanceScreeningEnabled', options.resonanceScreeningEnabled]
  ] as const) {
    if (typeof flag[1] !== 'boolean') {
      issues.push(issueOf('invalid_screening_flag', 'флаг ' + flag[0] + ' должен быть boolean', []));
    }
  }

  // --- Валидация условных параметров (fail-closed, без умолчаний) ---
  let intersectionToleranceM: number | null = null;
  if (options.orbitCrossingEnabled === true) {
    if (options.orbitIntersectionToleranceM === undefined) {
      issues.push(issueOf('missing_intersection_tolerance', 'orbitIntersectionToleranceM обязателен при включённом crossing', []));
    } else if (!isFiniteScalar(options.orbitIntersectionToleranceM) || options.orbitIntersectionToleranceM <= 0) {
      issues.push(issueOf('invalid_intersection_tolerance', 'допуск пересечения должен быть конечным положительным', []));
    } else {
      intersectionToleranceM = options.orbitIntersectionToleranceM;
    }
  }
  let hillMaxEcc: number | null = null;
  let hillMaxIncRad: number | null = null;
  if (options.hillScreeningEnabled === true) {
    if (options.classicHillMaxEccentricity === undefined) {
      issues.push(issueOf('missing_hill_classic_option', 'classicHillMaxEccentricity обязателен при включённом hill screening', []));
    } else if (!isFiniteScalar(options.classicHillMaxEccentricity) || options.classicHillMaxEccentricity <= 0 || options.classicHillMaxEccentricity >= 1) {
      issues.push(issueOf('invalid_hill_classic_max_eccentricity', 'предел эксцентриситета должен быть в (0, 1)', []));
    } else {
      hillMaxEcc = options.classicHillMaxEccentricity;
    }
    if (options.classicHillMaxRelativeInclinationRad === undefined) {
      issues.push(issueOf('missing_hill_classic_option', 'classicHillMaxRelativeInclinationRad обязателен при включённом hill screening', []));
    } else if (!isFiniteScalar(options.classicHillMaxRelativeInclinationRad) || options.classicHillMaxRelativeInclinationRad <= 0 || options.classicHillMaxRelativeInclinationRad >= Math.PI) {
      issues.push(issueOf('invalid_hill_classic_max_inclination', 'предел взаимного наклонения должен быть в (0, pi)', []));
    } else {
      hillMaxIncRad = options.classicHillMaxRelativeInclinationRad;
    }
  }
  if (options.rocheScreeningEnabled === true) {
    if (options.rocheLimitModel === undefined) {
      issues.push(issueOf('missing_roche_model', 'rocheLimitModel обязан; модель НЕ выбирается автоматически', []));
    } else if (options.rocheLimitModel !== 'fluid' && options.rocheLimitModel !== 'rigid') {
      issues.push(issueOf('invalid_roche_model', 'rocheLimitModel должен быть fluid или rigid', []));
    }
  }
  let resonanceTolerance: number | null = null;
  let resonanceMaxInteger: number | null = null;
  if (options.resonanceScreeningEnabled === true) {
    if (options.resonanceRelativeTolerance === undefined) {
      issues.push(issueOf('missing_resonance_option', 'resonanceRelativeTolerance обязателен при включённом resonance screening', []));
    } else if (!isFiniteScalar(options.resonanceRelativeTolerance) || options.resonanceRelativeTolerance <= 0) {
      issues.push(issueOf('invalid_resonance_tolerance', 'допуск резонанса должен быть конечным положительным', []));
    } else {
      resonanceTolerance = options.resonanceRelativeTolerance;
    }
    if (options.maxResonanceInteger === undefined) {
      issues.push(issueOf('missing_resonance_option', 'maxResonanceInteger обязан при включённом resonance screening', []));
    } else if (!Number.isInteger(options.maxResonanceInteger) || options.maxResonanceInteger < 1) {
      issues.push(issueOf('invalid_max_resonance_integer', 'maxResonanceInteger должен быть целым >= 1', []));
    } else {
      resonanceMaxInteger = options.maxResonanceInteger;
    }
  }

  if (issues.length > 0) {
    return { status: 'invalid_input', issues };
  }

  // --- Канонический порядок и элементы ---
  const canonical = [...bodies].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const primary = canonical.find((b) => b.id === options.primaryBodyId) as OrbitalBodyState;
  const epochS = initialState.timeS;
  const elements = canonical
    .filter((b) => b.id !== options.primaryBodyId)
    .map((b) =>
      computeOsculatingElements(
        b.id,
        primary.id,
        vSub(b.positionM, primary.positionM),
        vSub(b.velocityMPerS, primary.velocityMPerS),
        G * (primary.massKg + b.massKg),
        epochS
      )
    );

  const pushIssue = (code: string, message: string, bodyIds: string[]): void => {
    issues.push(issueOf(code, message, bodyIds));
  };

  const massById = new Map<string, number>(canonical.map((b) => [b.id, b.massKg]));
  const radiusById = new Map<string, number | null>(canonical.map((b) => [b.id, b.radiusM]));
  const orbitOk = (el: OsculatingElementsRecord): boolean =>
    el.conicApplicable && el.planeNormalUnit !== null && el.semiLatusRectumM !== null;
  const nonEllipticReason = (el: OsculatingElementsRecord): string => {
    if (el.trajectoryKind === 'hyperbolic' || el.trajectoryKind === 'parabolic') {
      return 'non_elliptic_orbit';
    }
    return el.inapplicableReason ?? 'non_applicable_conic';
  };

  // --- 4. Геометрические пересечения ---
  const crossings: OrbitCrossingPairResult[] = [];
  if (options.orbitCrossingEnabled === true) {
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const elA = elements[i];
      const elB = elements[j];
      if (!orbitOk(elA) || !orbitOk(elB)) {
        const reason = orbitOk(elA) ? nonEllipticReason(elB) : nonEllipticReason(elA);
        crossings.push({
          pairIdA: elA.bodyId,
          pairIdB: elB.bodyId,
          result: 'indeterminate',
          coplanar: false,
          nodeLineDirection: null,
          intersections: [],
          toleranceM: null,
          reason
        });
        pushIssue('crossing_not_evaluated', 'у пары нет применимой коники (вырожденный угловой момент или нечисловые элементы)', [elA.bodyId, elB.bodyId]);
        continue;
      }
      const n1 = elA.planeNormalUnit as Vector3;
      const n2 = elB.planeNormalUnit as Vector3;
      const crossNormals = vCross(n1, n2);
      const crossNorm = vNorm(crossNormals);
      if (crossNorm <= COPLANAR_NORMALS_REL) {
        const solved = coplanarIntersectionSolve(elA, elB, intersectionToleranceM as number);
        crossings.push({
          pairIdA: elA.bodyId,
          pairIdB: elB.bodyId,
          result: solved.kind,
          coplanar: true,
          nodeLineDirection: null,
          intersections: solved.points,
          toleranceM: intersectionToleranceM,
          reason: solved.kind === 'coincident_orbits' ? 'conics_coincident' : null
        });
        continue;
      }
      const nodeLine = vUnit(crossNormals) as Vector3;
      const points: OrbitIntersectionPoint[] = [];
      for (const side of [1, -1]) {
        const qHat = vScale(nodeLine, side);
        const rA = conicRadiusAlongP(elA, qHat);
        const rB = conicRadiusAlongP(elB, qHat);
        if (rA === null || rB === null) {
          continue;
        }
        if (Math.abs(rA - rB) <= (intersectionToleranceM as number)) {
          points.push({ radiusAM: rA, radiusBM: rB, radiusDifferenceM: Math.abs(rA - rB), sharedPointM: vScale(qHat, rA) });
        }
      }
      crossings.push({
        pairIdA: elA.bodyId,
        pairIdB: elB.bodyId,
        result: points.length >= 1 ? 'geometric_crossing' : 'no_geometric_crossing',
        coplanar: false,
        nodeLineDirection: nodeLine,
        intersections: points,
        toleranceM: intersectionToleranceM,
        reason: null
      });
    }
  }
  }

  // --- 5. Критерии Хилла ---
  const individualHill: IndividualHillResult[] = [];
  const mutualHill: MutualHillResult[] = [];
  if (options.hillScreeningEnabled === true) {
  for (const el of elements) {
    if (el.trajectoryKind === 'elliptic' && el.semiMajorAxisM !== null) {
      const rh = el.semiMajorAxisM * (1 - el.eccentricity) * Math.cbrt((massById.get(el.bodyId) as number) / (3 * primary.massKg));
      individualHill.push({ bodyId: el.bodyId, hillRadiusM: isFiniteScalar(rh) ? rh : null, status: 'evaluated', reason: null });
    } else {
      individualHill.push({ bodyId: el.bodyId, hillRadiusM: null, status: 'not_evaluated', reason: nonEllipticReason(el) });
      pushIssue('hill_not_evaluated', 'индивидуальный радиус Хилла требует эллиптической коники', [el.bodyId]);
    }
  }
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const elA = elements[i];
      const elB = elements[j];
      if (elA.trajectoryKind !== 'elliptic' || elB.trajectoryKind !== 'elliptic' || elA.semiMajorAxisM === null || elB.semiMajorAxisM === null) {
        mutualHill.push({
          pairIdA: elA.bodyId,
          pairIdB: elB.bodyId,
          semiMajorAxisAM: null,
          semiMajorAxisBM: null,
          mutualHillRadiusM: null,
          delta: null,
          mutualInclinationRad: null,
          classicCriterion: 'assumptions_unknown',
          classicThresholdValue: null,
          deltaExceedsClassicThreshold: null,
          status: 'not_evaluated',
          reason: orbitOk(elA) && orbitOk(elB) ? 'non_elliptic_orbit' : nonEllipticReason(elA)
        });
        pushIssue('hill_not_evaluated', 'взаимный радиус Хилла требует двух эллиптических коник', [elA.bodyId, elB.bodyId]);
        continue;
      }
      const mSum = (massById.get(elA.bodyId) as number) + (massById.get(elB.bodyId) as number);
      const mutualHillRadius = Math.cbrt(mSum / (3 * primary.massKg)) * ((elA.semiMajorAxisM + elB.semiMajorAxisM) / 2);
      const delta = Math.abs(elB.semiMajorAxisM - elA.semiMajorAxisM) / mutualHillRadius;
      const inc = Math.acos(clampUnit(vDot(elA.planeNormalUnit as Vector3, elB.planeNormalUnit as Vector3)));
      const eccOk = elA.eccentricity <= (hillMaxEcc as number) && elB.eccentricity <= (hillMaxEcc as number);
      const incOk = inc <= (hillMaxIncRad as number);
      const applicable = eccOk && incOk;
      mutualHill.push({
        pairIdA: elA.bodyId,
        pairIdB: elB.bodyId,
        semiMajorAxisAM: elA.semiMajorAxisM,
        semiMajorAxisBM: elB.semiMajorAxisM,
        mutualHillRadiusM: isFiniteScalar(mutualHillRadius) ? mutualHillRadius : null,
        delta: isFiniteScalar(delta) ? delta : null,
        mutualInclinationRad: inc,
        classicCriterion: applicable ? 'applicable' : 'criterion_not_applicable',
        classicThresholdValue: applicable ? CLASSIC_MUTUAL_HILL_THRESHOLD : null,
        deltaExceedsClassicThreshold: applicable ? delta > CLASSIC_MUTUAL_HILL_THRESHOLD : null,
        status: 'evaluated',
        reason: applicable ? null : 'criterion_not_applicable'
      });
      if (!applicable) {
        pushIssue('criterion_not_applicable', 'классический порог 2*sqrt(3) требует малых эксцентриситетов и наклонений; Delta возвращён без порога', [elA.bodyId, elB.bodyId]);
      }
    }
  }
  }

  // --- 6. Предел Роша ---
  const rocheModel: RocheLimitModel = options.rocheLimitModel === 'rigid' ? 'rigid' : 'fluid';
  const roche: RocheBodyResult[] = [];
  if (options.rocheScreeningEnabled === true) {
  const densityOf = (bodyId: string): number | null => {
    const radius = radiusById.get(bodyId);
    const mass = massById.get(bodyId);
    if (radius === undefined || radius === null || !(radius > 0) || mass === undefined || !(mass > 0)) {
      return null;
    }
    const rho = mass / ((4 / 3) * Math.PI * radius * radius * radius);
    return isFiniteScalar(rho) && rho > 0 ? rho : null;
  };
  for (const el of elements) {
    const rhoPrimary = densityOf(primary.id);
    const rhoSatellite = densityOf(el.bodyId);
    const primaryRadius = radiusById.get(primary.id);
    if (!orbitOk(el)) {
      roche.push({
        bodyId: el.bodyId,
        primaryBodyId: el.primaryBodyId,
        model: rocheModel,
        primaryDensityKgPerM3: rhoPrimary,
        satelliteDensityKgPerM3: rhoSatellite,
        rocheLimitM: null,
        periapsisDistanceM: el.periapsisDistanceM,
        status: 'not_evaluated',
        reason: nonEllipticReason(el)
      });
      pushIssue('roche_not_evaluated', 'предел Роша требует применимой коники (нужен перицентр)', [el.bodyId]);
      continue;
    }
    if (rhoPrimary === null || rhoSatellite === null || primaryRadius === undefined || primaryRadius === null || !(primaryRadius > 0)) {
      roche.push({
        bodyId: el.bodyId,
        primaryBodyId: el.primaryBodyId,
        model: rocheModel,
        primaryDensityKgPerM3: rhoPrimary,
        satelliteDensityKgPerM3: rhoSatellite,
        rocheLimitM: null,
        periapsisDistanceM: el.periapsisDistanceM,
        status: 'unknown',
        reason: 'missing_physical_parameters'
      });
      pushIssue('roche_unknown', 'плотность (radiusM null) или радиус primary неизвестны; подстановка запрещена', [el.bodyId]);
      continue;
    }
    const coefficient = rocheModel === 'fluid' ? ROCHE_FLUID_COEFFICIENT : ROCHE_RIGID_COEFFICIENT;
    const rocheLimit = coefficient * primaryRadius * Math.cbrt(rhoPrimary / rhoSatellite);
    const periapsis = el.periapsisDistanceM as number;
    const qRatio = periapsis / rocheLimit;
    const rocheStatus: RocheScreenStatus =
      Math.abs(qRatio - 1) <= ROCHE_BOUNDARY_RELATIVE_BAND
        ? 'at_roche_boundary'
        : periapsis < rocheLimit
          ? 'inside_roche_limit'
          : 'outside_roche_limit';
    roche.push({
      bodyId: el.bodyId,
      primaryBodyId: el.primaryBodyId,
      model: rocheModel,
      primaryDensityKgPerM3: rhoPrimary,
      satelliteDensityKgPerM3: rhoSatellite,
      rocheLimitM: isFiniteScalar(rocheLimit) ? rocheLimit : null,
      periapsisDistanceM: periapsis,
      status: rocheStatus,
      reason: null
    });
  }
  }

  // --- 7. Резонансы ---
  const resonanceCandidates: ResonanceCandidate[] = [];
  const resonancePairsSkipped: ResonancePairSkip[] = [];
  if (options.resonanceScreeningEnabled === true) {
  const gcdOf = (a: number, b: number): number => {
    let x = a;
    let y = b;
    while (y !== 0) {
      const t = x % y;
      x = y;
      y = t;
    }
    return x;
  };
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const elA = elements[i];
      const elB = elements[j];
      if (elA.orbitalPeriodS === null || elB.orbitalPeriodS === null) {
        resonancePairsSkipped.push({
          pairIdA: elA.bodyId,
          pairIdB: elB.bodyId,
          reason: orbitOk(elA) && orbitOk(elB) ? 'non_elliptic_orbit' : nonEllipticReason(orbitOk(elA) ? elB : elA)
        });
        pushIssue('resonance_not_evaluated', 'скрининг резонансов требует двух эллиптических периодов', [elA.bodyId, elB.bodyId]);
        continue;
      }
      // inner/outer: по периоду; при равенстве - лексикографически по id.
      const aInner = elA.orbitalPeriodS <= elB.orbitalPeriodS;
      let innerId = aInner ? elA.bodyId : elB.bodyId;
      let outerId = aInner ? elB.bodyId : elA.bodyId;
      const periodIn = Math.min(elA.orbitalPeriodS, elB.orbitalPeriodS);
      const periodOut = Math.max(elA.orbitalPeriodS, elB.orbitalPeriodS);
      if (elA.orbitalPeriodS === elB.orbitalPeriodS && innerId > outerId) {
        const tmp = innerId;
        innerId = outerId;
        outerId = tmp;
      }
      const ratio = periodOut / periodIn;
      const matched: ResonanceCandidate[] = [];
      for (let p = 1; p <= (resonanceMaxInteger as number); p++) {
        for (let q = 1; q <= p; q++) {
          if (gcdOf(p, q) !== 1) {
            continue;
          }
          const exact = p / q;
          const deviation = Math.abs(ratio - exact) / exact;
          if (deviation <= (resonanceTolerance as number)) {
            matched.push({
              pairIdInner: innerId,
              pairIdOuter: outerId,
              periodRatio: ratio,
              numeratorP: p,
              denominatorQ: q,
              relativeDeviation: deviation,
              relativeTolerance: resonanceTolerance as number,
              status: 'near_mean_motion_commensurability'
            });
          }
        }
      }
      // Детерминированная сортировка: отклонение, затем низший порядок (p+q), затем p.
      matched.sort((x, y) =>
        x.relativeDeviation - y.relativeDeviation ||
        x.numeratorP + x.denominatorQ - (y.numeratorP + y.denominatorQ) ||
        x.numeratorP - y.numeratorP
      );
      resonanceCandidates.push(...matched);
    }
  }
  }

  // --- Метаданные ---
  const applicableCount = elements.filter((el) => el.conicApplicable).length;
  const status: OrbitScreeningStatus =
    elements.length > 0 && applicableCount === 0 ? 'indeterminate' : 'completed';

  return {
    status,
    elements,
    crossings,
    individualHill,
    mutualHill,
    roche,
    resonanceCandidates,
    resonancePairsSkipped,
    issues,
    metadata: {
      primaryBodyId: primary.id,
      epochS,
      bodyCount: bodies.length,
      orbitalBodyCount: elements.length,
      pairCount: (elements.length * (elements.length - 1)) / 2,
      orbitCrossingEnabled: options.orbitCrossingEnabled === true,
      hillScreeningEnabled: options.hillScreeningEnabled === true,
      rocheScreeningEnabled: options.rocheScreeningEnabled === true,
      rocheLimitModel: options.rocheScreeningEnabled === true ? rocheModel : null,
      resonanceScreeningEnabled: options.resonanceScreeningEnabled === true,
      crossingPairsEvaluated: crossings.filter((c) => c.result !== 'indeterminate').length,
      crossingPairsSkipped: crossings.filter((c) => c.result === 'indeterminate').length,
      hillBodiesEvaluated: individualHill.filter((h) => h.status === 'evaluated').length,
      hillBodiesSkipped: individualHill.filter((h) => h.status !== 'evaluated').length,
      hillPairsEvaluated: mutualHill.filter((h) => h.status === 'evaluated').length,
      hillPairsSkipped: mutualHill.filter((h) => h.status !== 'evaluated').length,
      rocheBodiesEvaluated: roche.filter((r) => r.status !== 'unknown' && r.status !== 'not_evaluated').length,
      rocheBodiesSkipped: roche.filter((r) => r.status === 'unknown' || r.status === 'not_evaluated').length,
      resonancePairsEvaluated:
        options.resonanceScreeningEnabled === true
          ? (elements.length * (elements.length - 1)) / 2 - resonancePairsSkipped.length
          : 0,
      resonancePairsSkipped: resonancePairsSkipped.length,
      elementsNonApplicableCount: elements.filter((el) => !el.conicApplicable).length
    }
  };
}
