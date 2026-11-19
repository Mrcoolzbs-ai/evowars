// ============================================
// STABILITY — конечногоризонтная динамическая оценка устойчивости
// (Stage 4.6.2)
// ============================================
//
// ИНТЕГРАЦИОННЫЙ уровень поверх уже реализованных слоёв:
//   Stage 4.6.1-A: детерминированный N-body leapfrog KDK (dynamics.ts);
//   Stage 4.6.1-B: сближения и физические столкновения (events.ts);
//   Stage 4.6.1-C: кандидаты/подтверждение выброса, связность (events.ts);
//   Stage 4.6.1-D: осциллирующие элементы и аналитический скрининг
//                  (orbitScreening.ts).
//
// assessNBodyStabilityOverHorizon объединяет результаты в ЕДИНЫЙ
// контракт конечногоризонтной динамической оценки:
// stable | unstable | indeterminate (плюс структурированный
// invalid_input для некорректного запроса).
//
// ГЛАВНОЕ ПРАВИЛО: статус completed интегратора НЕ означает stable.
// Отсутствие зарегистрированных событий также НЕ доказывает
// устойчивость. 'stable' означает ТОЛЬКО «система удовлетворяет ЯВНО
// заданным критериям классификации на ЯВНО заданном временном
// горизонте». Устойчивость за пределами горизонта, бесконечная
// устойчивость и устойчивость при произвольных возмущениях НЕ
// утверждаются.
//
// МЕТОД: каждая оценка выполняет ДВЕ независимые интеграции одним и
// тем же движком с фиксированным timestep: coarse (timeStepS) и
// refined (timeStepS/2). Длительность, модель, начальные данные и
// физика идентичны. Диагностические точки выбраны так, что оба
// прогона имеют ОБЩИЕ физические времена выборки: если timestep
// основного прогона равен h, уточнённого — h/2, sampleEverySteps
// основного — K и уточнённого — 2K, то моменты снимков
// time0 + j*K*h совпадают у обоих прогонов (движок суммирует время
// как time0 + step*dt, а целочисленные кратности шагов равны
// j*K*(h) == 2K*j*(h/2)). Сравнение состояний на разных временах и
// сравнение только начального/финального состояния исключены
// конструктивно. Если заданные параметры не дают одинаковых моментов
// выборки (некратность), возвращается структурированный invalid_input.
//
// ВЕРДИКТЫ присваиваются ТОЛЬКО по ЯВНЫМ критериям из options:
//   unstable: воспроизводимое на ОБОИХ разрешениях терминальное
//             событие (столкновение одной пары с согласованным
//             временем контакта; подтверждённый выброс одного тела
//             относительно одного primary) либо воспроизводимый
//             выход за ЯВНО заданные операционные пределы орбиталь-
//             ной эволюции. Это критерий ДАННОГО сценария, а не
//             универсальный физический закон. Если разрешения дают
//             разные выводы, принудительный unstable запрещён:
//             возвращается indeterminate.
//   indeterminate: полноценный научный результат при недостаточном
//             доказательстве: неполное покрытие столкновений
//             (неизвестные радиусы), отказ одного из прогонов,
//             кандидаты/pending без подтверждения, неразрешённые
//             сближения, изменения pairwise-графа связности,
//             расхождение разрешений, невычислимые элементы.
//   stable: только при выполнении ВСЕХ десяти условий (см. checks).
//
// Геометрическое пересечение орбит НЕ является столкновением.
// Резонансный кандидат сам по себе НЕ доказывает нестабильность.
// Изменение pairwise-графа связности без терминального события —
// диагностическое предупреждение, а не 'unstable'. Подтверждение
// резонанса временной либрацией резонансных углов НЕ реализовано
// (ЯВНО оставлено будущей задачей).

import { G } from '../Units';
import {
  canonicalBodyOrder,
  integrateNBodyWithEvents,
  NBODY_LEAPFROG_LIMITATION,
  type NBodyConservationReport,
  type NBodyInitialState,
  type NBodyStateSnapshot,
  type OrbitalBodyState,
  type Vector3
} from './dynamics';
import {
  sortDetectionEvents,
  type CloseApproachEvent,
  type CollisionEvent,
  type ConnectivityEvent,
  type EjectionEvent,
  type NBodyDetectionEvent,
  type NBodyEventDetectionMetadata
} from './events';
import {
  computeOsculatingElements,
  ORBIT_SCREENING_LIMITATION,
  screenOrbitalStability,
  type OrbitScreeningResult
} from './orbitScreening';

// ============================================
// 1. ПУБЛИЧНЫЕ ТИПЫ
// ============================================

/** Итог вердикта; относится только к заданному горизонту. */
export type StabilityVerdict = 'stable' | 'unstable' | 'indeterminate';

/**
 * Параметры аналитического скрининга начального состояния (слой
 * Stage 4.6.1-D). Все пороги ЯВНЫЕ.
 */
export interface StabilityScreeningOptions {
  orbitIntersectionToleranceM: number;
  classicHillMaxEccentricity: number;
  classicHillMaxRelativeInclinationRad: number;
  rocheLimitModel: 'fluid' | 'rigid';
  resonanceRelativeTolerance: number;
  maxResonanceInteger: number;
}

/**
 * Контракт опций оценки. ВСЕ допуски классификации передаются ЯВНО;
 * скрытых универсальных констант устойчивости нет. Все пороги
 * валидируются на конечность, знак и допустимый диапазон.
 */
export interface StabilityAssessmentOptions {
  /** Явный primary; автоподбор по массе запрещён. */
  primaryBodyId: string;
  /** Полная длительность горизонта, с; кратна timeStepS и timeStepS/2. */
  durationS: number;
  /** Timestep основного (coarse) прогона, с; строго положительный. */
  timeStepS: number;
  /**
   * Интервал общих диагностических точек, с; обязан быть целым
   * кратным timeStepS (refined сэмплирует каждые два шага по
   * timeStepS/2).
   */
  diagnosticIntervalS: number;
  /** Радиус выхода для escape-детекции Stage 4.6.1-C, м. */
  escapeRadiusM: number;
  /** Интервал подтверждения выброса, с. */
  escapeConfirmationDurationS: number;
  /** Явный лимит шагов КАЖДОГО прогона. */
  maxStepsPerRun: number;
  /** Допуск относительного дрейфа полной энергии. */
  maxEnergyDriftRelative: number;
  /** Допуск относительного дрейфа полного импульса. */
  maxMomentumDriftRelative: number;
  /** Допуск относительного дрейфа полного момента импульса. */
  maxAngularMomentumDriftRelative: number;
  /** Допуск максимального относительного изменения a внутри прогона. */
  maxRelativeSemimajorAxisExcursion: number;
  /** Допуск максимального абсолютного изменения e внутри прогона. */
  maxAbsoluteEccentricityExcursion: number;
  /** Допуск относительного расхождения траекторий (позиция). */
  maxRelativePositionDifference: number;
  /** Допуск относительного расхождения траекторий (скорость). */
  maxRelativeVelocityDifference: number;
  /** Допуск согласованности времени событий между разрешениями, с. */
  maxEventTimeDifferenceS: number;
  /** Допуск расхождения a между разрешениями (относительный). */
  maxRelativeSemimajorAxisDifference: number;
  /** Допуск расхождения e между разрешениями (абсолютный). */
  maxEccentricityDifference: number;
  /**
   * Необязательный порог тесных сближений, м (Stage 4.6.1-B).
   * Неразрешённые сближения запрещают 'stable'.
   */
  closeApproachDistanceM?: number;
  /**
   * Необязательный энергетический допуск pairwise-графа связности,
   * Дж/кг (Stage 4.6.1-C). Изменения графа запрещают 'stable'.
   */
  connectivityEnergyToleranceJPerKg?: number;
  /** Необязательная конфигурация аналитического скрининга. */
  screening?: StabilityScreeningOptions;
}

/** Машиночитаемая проблема валидации входа оценки. */
export interface StabilityValidationIssue {
  code: string;
  message: string;
  bodyId?: string;
}

/** Проверка одного явного критерия вердикта (основание присвоения). */
export interface StabilityCriterionCheck {
  code: string;
  description: string;
  status: 'pass' | 'fail' | 'unknown';
  /** Измеренное значение; null, если не измерено. */
  measured: number | null;
  /** Явный порог из options; null, если порога нет. */
  threshold: number | null;
  detail: string;
}

/** Параметры отдельного прогона (без изменения физики/данных). */
export interface StabilityRunParameters {
  run: 'coarse' | 'refined';
  timeStepS: number;
  sampleEverySteps: number;
  /** Требуемое число шагов для полного горизонта. */
  requestedSteps: number;
  maxSteps: number;
}

/** Итог одного прогона. Сырые снимки в результат НЕ включаются. */
export interface StabilityRunOutcome {
  run: 'coarse' | 'refined';
  timeStepS: number;
  sampleEverySteps: number;
  requestedSteps: number;
  maxSteps: number;
  status: 'completed' | 'collision_detected' | 'integration_failed';
  /** Прогон дошёл до конца горизонта (только для 'completed'). */
  completedHorizon: boolean;
  stepsCompleted: number;
  finalTimeS: number | null;
  /** status внутреннего отказа движка; null, если отказа нет. */
  integrationFailure: string | null;
  conservation: NBodyConservationReport | null;
  events: NBodyDetectionEvent[];
  detection: NBodyEventDetectionMetadata | null;
  /** Общие физические времена диагностических точек прогона, с. */
  diagnosticTimesS: number[];
}

/** Орбитальная диагностика тела относительно primary в прогоне. */
export interface StabilityBodyOrbitalDiagnostics {
  bodyId: string;
  relativeGravitationalParameterM3PerS2: number;
  initialSemiMajorAxisM: number | null;
  initialEccentricity: number | null;
  initialOrbitalPeriodS: number | null;
  initialPeriapsisDistanceM: number | null;
  initialApoapsisDistanceM: number | null;
  /** Максимум |a(t) − a0| / |a0| по точкам; null, если a не вычислим. */
  maxRelativeSemimajorAxisExcursion: number | null;
  /** Максимум |e(t) − e0| по точкам; null, если e не вычислим. */
  maxAbsoluteEccentricityExcursion: number | null;
  /** Знаковое худшее (a − a0)/|a0|: направление превышения. */
  worstSignedRelativeSemimajorAxisDeviation: number | null;
  /** Знаковое худшее e − e0. */
  worstSignedEccentricityDeviation: number | null;
  semiMajorAxisMinM: number | null;
  semiMajorAxisMaxM: number | null;
  eccentricityMin: number | null;
  eccentricityMax: number | null;
  /** Связанная орбита (eps < 0) в начале/конце; null — неизвестно. */
  boundAtStart: boolean | null;
  boundAtEnd: boolean | null;
  /** Число переходов связанная/несвязанная по диагностическим точкам. */
  boundStateTransitions: number | null;
  /** Число точек, на которых элементы не вычислимы. */
  undeterminedPoints: number;
  /** Машинная причина невычислимости; null, если всё вычислимо. */
  undeterminedReason: string | null;
}

/** Отчёт сходимости coarse/refined на общих временах. */
export interface StabilityConvergenceReport {
  status: 'agreed' | 'insufficient' | 'indeterminate';
  reasons: string[];
  sharedDiagnosticTimesCount: number;
  sharedDiagnosticTimesS: number[];
  /** Максимальное относительное расхождение позиций. */
  maxRelativePositionDifference: number | null;
  /** Максимальное относительное расхождение скоростей. */
  maxRelativeVelocityDifference: number | null;
  /** Максимальное относительное расхождение a. */
  maxRelativeSemimajorAxisDifference: number | null;
  /** Максимальное абсолютное расхождение e. */
  maxEccentricityDifference: number | null;
  /** Начальные нормировочные масштабы по телам, м. */
  positionScaleMByBody: Record<string, number>;
  /** Начальные характерные скорости sqrt(2·mu/r0) по телам, м/с. */
  velocityScaleMPerSByBody: Record<string, number>;
  /** Тела с физически вырожденным масштабом (сравнение запрещено). */
  degenerateScaleBodyIds: string[];
}

/** Покрытие обнаружения столкновений и escape по обоим разрешениям. */
export interface StabilityCollisionEscapeCoverage {
  collisionCoverageCompleteCoarse: boolean;
  collisionCoverageCompleteRefined: boolean;
  pairsWithUnknownRadiusCoarse: number;
  pairsWithUnknownRadiusRefined: number;
  escapeDetectionEnabledCoarse: boolean;
  escapeDetectionEnabledRefined: boolean;
  /** Начальное число компонент pairwise-графа связности; null — нет данных. */
  initialConnectivityComponents: number | null;
}

/** Успешный результат оценки (вердикт присвоен по явным критериям). */
export interface StabilityAssessmentSuccess {
  status: 'completed';
  verdict: StabilityVerdict;
  /** Машиночитаемые основания вердикта. */
  verdictReasons: string[];
  /** Человекочитаемое обоснование (RU). */
  rationale: string;
  initialEpochS: number;
  horizonS: number;
  runs: {
    coarse: StabilityRunOutcome;
    refined: StabilityRunOutcome;
  };
  checks: StabilityCriterionCheck[];
  conservation: {
    coarse: NBodyConservationReport | null;
    refined: NBodyConservationReport | null;
  };
  orbitalDiagnostics: {
    coarse: StabilityBodyOrbitalDiagnostics[];
    refined: StabilityBodyOrbitalDiagnostics[];
  };
  convergence: StabilityConvergenceReport;
  collisionEscapeCoverage: StabilityCollisionEscapeCoverage;
  /** Аналитический скрининг начального состояния (диагностический слой). */
  analyticScreening: OrbitScreeningResult | null;
  /** Задана ли ЯВНАЯ конфигурация скрининга. */
  analyticScreeningEnabled: boolean;
  limitations: string[];
  warnings: string[];
}

/** Структурированный отказ: вход некорректен; прогоны не запускались. */
export interface StabilityAssessmentInvalidInput {
  status: 'invalid_input';
  issues: StabilityValidationIssue[];
}

export type StabilityAssessmentResult =
  | StabilityAssessmentSuccess
  | StabilityAssessmentInvalidInput;

/**
 * Явные ограничения контракта Stage 4.6.2 (включаются в каждый
 * результат оценки).
 */
export const STABILITY_ASSESSMENT_LIMITATION =
  'Вердикт stable | unstable | indeterminate относится ТОЛЬКО к заданному ' +
  'конечному горизонту и ЯВНО заданным допускам классификации. ' +
  'Устойчивость вне горизонта, бесконечная устойчивость и устойчивость ' +
  'при произвольных возмущениях НЕ оцениваются и НЕ утверждаются. ' +
  'Два разрешения timestep — операционная проверка сходимости, а не ' +
  'доказательство сходимости к точному решению. Изменение pairwise-графа ' +
  'связности, геометрические пересечения орбит и резонансные кандидаты — ' +
  'диагностические предупреждения, а не терминальные события.';

/** Явный предел числа диагностических точек, хранимых на прогон. */
const MAX_DIAGNOSTIC_POINTS_PER_RUN = 1_000_000;
/** Относительный допуск совпадения времён при сопоставлении снимков. */
const TIME_MATCH_RELATIVE_TOLERANCE = 1e-9;
/** Относительный допуск целочисленности кратностей. */
const INTEGER_TOLERANCE_RELATIVE = 1e-9;

// ============================================
// 2. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function issueOf(code: string, message: string, bodyId?: string): StabilityValidationIssue {
  const issue: StabilityValidationIssue = { code, message };
  if (bodyId !== undefined) {
    issue.bodyId = bodyId;
  }
  return issue;
}

function isNonNegativeFinite(v: unknown): v is number {
  return isFiniteNum(v) && v >= 0;
}

function isStrictlyPositiveFinite(v: unknown): v is number {
  return isFiniteNum(v) && v > 0;
}

function nearInteger(v: number): boolean {
  const r = Math.round(v);
  return Math.abs(v - r) <= INTEGER_TOLERANCE_RELATIVE * Math.max(1, Math.abs(v));
}

function pairKey(a: string, b: string): string {
  return a < b ? '###' + a + '|' + b : '###' + b + '|' + a;
}

function vSub(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vNorm(a: Vector3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function vDiffNorm(a: Vector3, b: Vector3): number {
  const d = vSub(a, b);
  return vNorm(d);
}

function isFiniteVec(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

// ============================================
// 3. ВАЛИДАЦИЯ ВХОДА
// ============================================

/**
 * Полная валидация состояния и опций ДО запуска прогонов. Любая
 * проблема даёт структурированный invalid_input; прогоны не
 * запускаются. Скрытых умолчаний нет.
 */
export function validateStabilityOptions(
  initialState: NBodyInitialState,
  options: StabilityAssessmentOptions
): StabilityValidationIssue[] {
  const issues: StabilityValidationIssue[] = [];

  const bodies: OrbitalBodyState[] | undefined = initialState?.bodies;
  if (!Array.isArray(bodies) || bodies.length < 2) {
    issues.push(issueOf('bodies_too_few', 'нужно не менее двух тел'));
  }
  if (!isFiniteNum(initialState?.timeS) || initialState.timeS < 0) {
    issues.push(issueOf('invalid_time_s', 'timeS должен быть конечным неотрицательным'));
  }
  const seenIds: Set<string> = new Set<string>();
  let primaryExists = false;
  if (Array.isArray(bodies)) {
    for (const b of bodies) {
      if (typeof b?.id !== 'string' || b.id.length === 0) {
        issues.push(issueOf('invalid_body_id', 'id тела должен быть непустой строкой'));
        continue;
      }
      if (seenIds.has(b.id)) {
        issues.push(issueOf('duplicate_body_id', 'дубликат id тела', b.id));
      }
      seenIds.add(b.id);
      if (!isFiniteNum(b.massKg) || b.massKg <= 0) {
        issues.push(issueOf('invalid_body_mass', 'масса тела должна быть конечной и строго положительной', b.id));
      }
      if (b.radiusM !== null && (!isFiniteNum(b.radiusM) || b.radiusM <= 0)) {
        issues.push(issueOf('invalid_body_radius', 'radiusM должен быть null либо конечным положительным', b.id));
      }
      for (const comp of [b.positionM.x, b.positionM.y, b.positionM.z]) {
        if (!isFiniteNum(comp)) {
          issues.push(issueOf('invalid_body_position', 'позиция тела содержит нечисловое значение', b.id));
          break;
        }
      }
      for (const comp of [b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z]) {
        if (!isFiniteNum(comp)) {
          issues.push(issueOf('invalid_body_velocity', 'скорость тела содержит нечисловое значение', b.id));
          break;
        }
      }
    }
    primaryExists = seenIds.has(options.primaryBodyId);
  }

  if (typeof options.primaryBodyId !== 'string' || options.primaryBodyId.length === 0) {
    issues.push(issueOf('invalid_primary_body_id', 'primaryBodyId должен быть непустой строкой'));
  } else if (Array.isArray(bodies) && !primaryExists) {
    issues.push(issueOf('primary_body_not_found', 'primary не найден среди тел; автоподбор по массе запрещён', options.primaryBodyId));
  }
  if (!isStrictlyPositiveFinite(options.timeStepS)) {
    issues.push(issueOf('invalid_time_step_s', 'timeStepS должен быть конечным строго положительным'));
  }
  if (!isStrictlyPositiveFinite(options.durationS)) {
    issues.push(issueOf('invalid_duration_s', 'durationS должен быть конечным строго положительным'));
  }
  if (!isStrictlyPositiveFinite(options.diagnosticIntervalS)) {
    issues.push(issueOf('invalid_diagnostic_interval_s', 'diagnosticIntervalS должен быть конечным строго положительным'));
  }
  if (!isStrictlyPositiveFinite(options.escapeRadiusM)) {
    issues.push(issueOf('invalid_escape_radius_m', 'escapeRadiusM должен быть конечным строго положительным'));
  }
  if (!isStrictlyPositiveFinite(options.escapeConfirmationDurationS)) {
    issues.push(issueOf('invalid_escape_confirmation_duration_s', 'escapeConfirmationDurationS должен быть конечным строго положительным'));
  }
  if (!isFiniteNum(options.maxStepsPerRun) || options.maxStepsPerRun < 1 || !nearInteger(options.maxStepsPerRun)) {
    issues.push(issueOf('invalid_max_steps_per_run', 'maxStepsPerRun должен быть конечным целым >= 1'));
  }
  for (const entry of [
    ['maxEnergyDriftRelative', options.maxEnergyDriftRelative, 'invalid_max_energy_drift_relative'],
    ['maxMomentumDriftRelative', options.maxMomentumDriftRelative, 'invalid_max_momentum_drift_relative'],
    ['maxAngularMomentumDriftRelative', options.maxAngularMomentumDriftRelative, 'invalid_max_angular_momentum_drift_relative'],
    ['maxRelativeSemimajorAxisExcursion', options.maxRelativeSemimajorAxisExcursion, 'invalid_max_relative_semimajor_axis_excursion'],
    ['maxAbsoluteEccentricityExcursion', options.maxAbsoluteEccentricityExcursion, 'invalid_max_absolute_eccentricity_excursion'],
    ['maxRelativePositionDifference', options.maxRelativePositionDifference, 'invalid_max_relative_position_difference'],
    ['maxRelativeVelocityDifference', options.maxRelativeVelocityDifference, 'invalid_max_relative_velocity_difference'],
    ['maxRelativeSemimajorAxisDifference', options.maxRelativeSemimajorAxisDifference, 'invalid_max_relative_semimajor_axis_difference'],
    ['maxEccentricityDifference', options.maxEccentricityDifference, 'invalid_max_eccentricity_difference']
  ] as const) {
    if (!isNonNegativeFinite(entry[1])) {
      issues.push(issueOf(entry[2], entry[0] + ' должен быть конечным неотрицательным'));
    }
  }
  if (!isNonNegativeFinite(options.maxEventTimeDifferenceS)) {
    issues.push(issueOf('invalid_max_event_time_difference_s', 'maxEventTimeDifferenceS должен быть конечным неотрицательным'));
  }
  if (options.closeApproachDistanceM !== undefined && !isStrictlyPositiveFinite(options.closeApproachDistanceM)) {
    issues.push(issueOf('invalid_close_approach_distance_m', 'closeApproachDistanceM, если задан, должен быть конечным строго положительным'));
  }
  if (options.connectivityEnergyToleranceJPerKg !== undefined && !isNonNegativeFinite(options.connectivityEnergyToleranceJPerKg)) {
    issues.push(issueOf('invalid_connectivity_energy_tolerance', 'connectivityEnergyToleranceJPerKg, если задан, должен быть конечным неотрицательным'));
  }

  // Структурные кратности: диагностическая сетка обязана давать
  // ОБЩИЕ физические времена у обоих прогонов.
  const baseScalarsOk =
    isStrictlyPositiveFinite(options.timeStepS) &&
    isStrictlyPositiveFinite(options.durationS) &&
    isStrictlyPositiveFinite(options.diagnosticIntervalS);
  if (baseScalarsOk) {
    const nCoarse = options.durationS / options.timeStepS;
    if (!nearInteger(nCoarse) || Math.round(nCoarse) < 1) {
      issues.push(issueOf('duration_not_multiple_of_time_step', 'durationS обязан быть целым кратным timeStepS (не менее 1 шага)'));
    }
    const nRefined = options.durationS / (options.timeStepS / 2);
    if (!nearInteger(nRefined) || Math.round(nRefined) < 1) {
      issues.push(issueOf('duration_not_multiple_of_refined_time_step', 'durationS обязан быть целым кратным timeStepS/2'));
    }
    const kCoarse = options.diagnosticIntervalS / options.timeStepS;
    if (!nearInteger(kCoarse) || Math.round(kCoarse) < 1) {
      issues.push(issueOf('diagnostic_interval_not_multiple_of_time_step', 'diagnosticIntervalS обязан быть целым кратным timeStepS'));
    }
    if (nearInteger(nCoarse) && nearInteger(kCoarse) && Math.round(nCoarse) >= 1 && Math.round(kCoarse) >= 1) {
      const pointsCoarse = Math.floor(Math.round(nCoarse) / Math.round(kCoarse)) + 1;
      if (pointsCoarse > MAX_DIAGNOSTIC_POINTS_PER_RUN) {
        issues.push(issueOf('too_many_diagnostic_points', 'число диагностических точек превышает явный предел хранения'));
      }
    }
  }

  if (options.screening !== undefined) {
    const s = options.screening;
    if (!isStrictlyPositiveFinite(s.orbitIntersectionToleranceM)) {
      issues.push(issueOf('invalid_screening_options', 'orbitIntersectionToleranceM должен быть конечным строго положительным'));
    }
    if (!isFiniteNum(s.classicHillMaxEccentricity) || s.classicHillMaxEccentricity <= 0 || s.classicHillMaxEccentricity >= 1) {
      issues.push(issueOf('invalid_screening_options', 'classicHillMaxEccentricity должен быть в (0, 1)'));
    }
    if (!isFiniteNum(s.classicHillMaxRelativeInclinationRad) || s.classicHillMaxRelativeInclinationRad <= 0 || s.classicHillMaxRelativeInclinationRad >= Math.PI) {
      issues.push(issueOf('invalid_screening_options', 'classicHillMaxRelativeInclinationRad должен быть в (0, pi)'));
    }
    if (s.rocheLimitModel !== 'fluid' && s.rocheLimitModel !== 'rigid') {
      issues.push(issueOf('invalid_screening_options', 'rocheLimitModel должен быть fluid или rigid'));
    }
    if (!isStrictlyPositiveFinite(s.resonanceRelativeTolerance)) {
      issues.push(issueOf('invalid_screening_options', 'resonanceRelativeTolerance должен быть конечным строго положительным'));
    }
    if (!isFiniteNum(s.maxResonanceInteger) || !Number.isInteger(s.maxResonanceInteger) || s.maxResonanceInteger < 1) {
      issues.push(issueOf('invalid_screening_options', 'maxResonanceInteger должен быть целым >= 1'));
    }
  }
  return issues;
}

// ============================================
// 4. ИЗВЛЕЧЕНИЕ ДИАГНОСТИКИ ИЗ ПРОГОНА
// ============================================

/** Внутреннее представление диагностических точек одного прогона. */
interface RunDiagnosticsInternal {
  times: number[];
  aByBody: Map<string, (number | null)[]>;
  eByBody: Map<string, (number | null)[]>;
  boundByBody: Map<string, (boolean | null)[]>;
  positionsByBody: Map<string, Vector3[]>;
  velocitiesByBody: Map<string, Vector3[]>;
  primaryPositions: Vector3[];
  primaryVelocities: Vector3[];
}

function matchIndexByTime(times: readonly number[], t: number): number {
  const tol = TIME_MATCH_RELATIVE_TOLERANCE * Math.max(1, Math.abs(t));
  for (let i = 0; i < times.length; i++) {
    if (Math.abs(times[i] - t) <= tol) {
      return i;
    }
  }
  return -1;
}

function primaryMassOf(canonical: readonly OrbitalBodyState[], primaryId: string): number {
  return (canonical.find((x) => x.id === primaryId) as OrbitalBodyState).massKg;
}

/**
 * Фильтрует снимки прогона до ОБЩИХ диагностических времён (шаги,
 * кратные периоду выборки прогона) и вычисляет осциллирующие
 * элементы каждого тела относительно primary СУЩЕСТВУЮЩЕЙ
 * computeOsculatingElements. Вторая реализация элементов не создаётся.
 */
function extractRunDiagnostics(
  timeStepS: number,
  sampleEverySteps: number,
  snapshots: readonly NBodyStateSnapshot[],
  time0: number,
  canonical: readonly OrbitalBodyState[],
  primaryId: string
): RunDiagnosticsInternal {
  const result: RunDiagnosticsInternal = {
    times: [],
    aByBody: new Map<string, (number | null)[]>(),
    eByBody: new Map<string, (number | null)[]>(),
    boundByBody: new Map<string, (boolean | null)[]>(),
    positionsByBody: new Map<string, Vector3[]>(),
    velocitiesByBody: new Map<string, Vector3[]>(),
    primaryPositions: [],
    primaryVelocities: []
  };
  for (const b of canonical) {
    if (b.id !== primaryId) {
      result.aByBody.set(b.id, []);
      result.eByBody.set(b.id, []);
      result.boundByBody.set(b.id, []);
      result.positionsByBody.set(b.id, []);
      result.velocitiesByBody.set(b.id, []);
    }
  }
  const muPrimary = G * primaryMassOf(canonical, primaryId);
  for (const snap of snapshots) {
    const st = snap.timeS - time0;
    if (st < 0) continue;
    const stepIdx = Math.round(st / timeStepS);
    const timeResidual = Math.abs(st - stepIdx * timeStepS);
    if (timeResidual > TIME_MATCH_RELATIVE_TOLERANCE * Math.max(1, Math.abs(st))) {
      continue;
    }
    if (stepIdx % sampleEverySteps !== 0) {
      continue;
    }
    const positionsById = new Map<string, Vector3>();
    const velocitiesById = new Map<string, Vector3>();
    for (const b of snap.bodies) {
      positionsById.set(b.id, b.positionM);
      velocitiesById.set(b.id, b.velocityMPerS);
    }
    const primaryPos = positionsById.get(primaryId);
    const primaryVel = velocitiesById.get(primaryId);
    if (primaryPos === undefined || primaryVel === undefined) {
      continue;
    }
    result.times.push(snap.timeS);
    result.primaryPositions.push(primaryPos);
    result.primaryVelocities.push(primaryVel);
    for (const b of canonical) {
      if (b.id === primaryId) {
        continue;
      }
      const pos = positionsById.get(b.id);
      const vel = velocitiesById.get(b.id);
      const aArr = result.aByBody.get(b.id) as (number | null)[];
      const eArr = result.eByBody.get(b.id) as (number | null)[];
      const bArr = result.boundByBody.get(b.id) as (boolean | null)[];
      const pArr = result.positionsByBody.get(b.id) as Vector3[];
      const vArr = result.velocitiesByBody.get(b.id) as Vector3[];
      if (pos === undefined || vel === undefined) {
        aArr.push(null);
        eArr.push(null);
        bArr.push(null);
        pArr.push({ x: NaN, y: NaN, z: NaN });
        vArr.push({ x: NaN, y: NaN, z: NaN });
        continue;
      }
      pArr.push(pos);
      vArr.push(vel);
      const rel = vSub(pos, primaryPos);
      const relV = vSub(vel, primaryVel);
      const mu = muPrimary + G * b.massKg;
      const rec = computeOsculatingElements(b.id, primaryId, rel, relV, mu, snap.timeS);
      const ellipticWithFiniteElements =
        rec.trajectoryKind === 'elliptic' &&
        rec.semiMajorAxisM !== null &&
        isFiniteNum(rec.semiMajorAxisM) &&
        rec.semiMajorAxisM > 0 &&
        isFiniteNum(rec.eccentricity);
      aArr.push(ellipticWithFiniteElements ? rec.semiMajorAxisM : null);
      eArr.push(ellipticWithFiniteElements ? rec.eccentricity : null);
      bArr.push(
        isFiniteNum(rec.specificOrbitalEnergyJPerKg) ? rec.specificOrbitalEnergyJPerKg < 0 : null
      );
    }
  }
  return result;
}

/** Индекс предыдущей определённой bound-точки (для подсчёта переходов). */
function previousBoundIndex(boundArr: readonly (boolean | null)[], i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    if (boundArr[j] !== null) return j;
  }
  return i;
}

/**
 * Сводная орбитальная диагностика тела: начальные элементы,
 * экстремумы, знаковые худшие отклонения (направление), переходы
 * связанная/несвязанная. Невычислимый элемент фиксируется с явной
 * причиной и НЕ подменяется нулём.
 */
function summarizeBodyDiagnostics(
  bodyId: string,
  muM3PerS2: number,
  aArr: readonly (number | null)[],
  eArr: readonly (number | null)[],
  boundArr: readonly (boolean | null)[]
): StabilityBodyOrbitalDiagnostics {
  let a0: number | null = null;
  let e0: number | null = null;
  for (let i = 0; i < aArr.length; i++) {
    const a = aArr[i];
    const e = eArr[i];
    if (a !== null && e !== null && Number.isFinite(a) && Number.isFinite(e)) {
      a0 = a;
      e0 = e;
      break;
    }
  }
  const initialPeriod =
    a0 !== null && e0 !== null && Number.isFinite(a0) && Number.isFinite(e0)
      ? 2 * Math.PI * Math.sqrt((a0 * a0 * a0) / muM3PerS2)
      : null;
  const initialPeriapsis =
    a0 !== null && e0 !== null && Number.isFinite(a0) && Number.isFinite(e0)
      ? a0 * (1 - e0)
      : null;
  const initialApoapsis =
    a0 !== null && e0 !== null && Number.isFinite(a0) && Number.isFinite(e0)
      ? a0 * (1 + e0)
      : null;

  let maxRelA: number | null = null;
  let maxAbsE: number | null = null;
  let worstSignedA: number | null = null;
  let worstSignedE: number | null = null;
  let aMin: number | null = null;
  let aMax: number | null = null;
  let eMin: number | null = null;
  let eMax: number | null = null;
  let undeterminedPoints = 0;
  let undeterminedReason: string | null = null;
  for (let i = 0; i < aArr.length; i++) {
    const a = aArr[i];
    const e = eArr[i];
    if (a === null || e === null || !Number.isFinite(a) || !Number.isFinite(e)) {
      undeterminedPoints += 1;
      if (undeterminedReason === null) {
        undeterminedReason =
          a === null && e === null
            ? 'osculating_elements_not_computable_at_diagnostic_point'
            : 'osculating_elements_numerically_unreliable_at_diagnostic_point';
      }
      continue;
    }
    if (aMin === null || a < aMin) aMin = a;
    if (aMax === null || a > aMax) aMax = a;
    if (eMin === null || e < eMin) eMin = e;
    if (eMax === null || e > eMax) eMax = e;
    if (a0 !== null && Number.isFinite(a0)) {
      const dev = (a - a0) / Math.abs(a0);
      if (maxRelA === null || Math.abs(dev) > Math.abs(maxRelA)) {
        maxRelA = Math.abs(dev);
        worstSignedA = dev;
      }
    }
    if (e0 !== null && Number.isFinite(e0)) {
      const dev = e - e0;
      if (maxAbsE === null || Math.abs(dev) > maxAbsE) {
        maxAbsE = Math.abs(dev);
        worstSignedE = dev;
      }
    }
  }
  let boundAtStart: boolean | null = null;
  let boundAtEnd: boolean | null = null;
  let transitions: number | null = null;
  for (let i = 0; i < boundArr.length; i++) {
    const bnd = boundArr[i];
    if (bnd === null) continue;
    if (boundAtStart === null) {
      boundAtStart = bnd;
      transitions = 0;
    } else if (transitions !== null) {
      const prev = boundArr[previousBoundIndex(boundArr, i)];
      if (prev !== null && bnd !== prev) {
        transitions += 1;
      }
    }
    boundAtEnd = bnd;
  }
  return {
    bodyId,
    relativeGravitationalParameterM3PerS2: muM3PerS2,
    initialSemiMajorAxisM: a0,
    initialEccentricity: e0,
    initialOrbitalPeriodS: initialPeriod,
    initialPeriapsisDistanceM: initialPeriapsis,
    initialApoapsisDistanceM: initialApoapsis,
    maxRelativeSemimajorAxisExcursion: maxRelA,
    maxAbsoluteEccentricityExcursion: maxAbsE,
    worstSignedRelativeSemimajorAxisDeviation: worstSignedA,
    worstSignedEccentricityDeviation: worstSignedE,
    semiMajorAxisMinM: aMin,
    semiMajorAxisMaxM: aMax,
    eccentricityMin: eMin,
    eccentricityMax: eMax,
    boundAtStart,
    boundAtEnd,
    boundStateTransitions: transitions,
    undeterminedPoints,
    undeterminedReason
  };
}

// ============================================
// 5. СОГЛАСОВАНИЕ ТЕРМИНАЛЬНЫХ СОБЫТИЙ МЕЖДУ РАЗРЕШЕНИЯМИ
// ============================================

interface TerminalCollisionInfo {
  pair: string;
  timeS: number;
  run: 'coarse' | 'refined';
}

/**
 * Согласование терминальных/подтверждённых событий между разрешениями.
 * Совпадение — основание unstable; несоответствие — основание
 * indeterminate (принудительный unstable запрещён). Кандидаты и
 * pending НЕ создают unstable.
 */
function matchTerminalEvents(
  collC: TerminalCollisionInfo | null,
  collR: TerminalCollisionInfo | null,
  coarseEvents: readonly NBodyDetectionEvent[],
  refinedEvents: readonly NBodyDetectionEvent[],
  maxEventTimeDifferenceS: number
): { unstableReason: string | null; indeterminateReasons: string[]; matchedKey: string | null } {
  const reasons: string[] = [];

  if (collC !== null && collR !== null) {
    if (collC.pair === collR.pair && Math.abs(collC.timeS - collR.timeS) <= maxEventTimeDifferenceS) {
      return { unstableReason: 'collision_confirmed_on_both_resolutions', indeterminateReasons: [], matchedKey: collC.pair };
    }
    reasons.push('collision_disagreement_between_resolutions');
  } else if (collC !== null || collR !== null) {
    reasons.push('collision_on_single_resolution');
  }

  const confirmedOf = (
    events: readonly NBodyDetectionEvent[],
    run: 'coarse' | 'refined'
  ): Map<string, { primary: string; timeS: number; run: 'coarse' | 'refined' }> => {
    const map = new Map<string, { primary: string; timeS: number; run: 'coarse' | 'refined' }>();
    for (const ev of events) {
      if (ev.type === 'ejection_confirmed') {
        const e = ev as EjectionEvent;
        map.set(e.bodyId, {
          primary: e.primaryBodyId,
          // Для ejection_confirmed confirmationTimeS по построению
          // ненулевой; eventTimeS — безопасная явная альтернатива.
          timeS: e.confirmationTimeS ?? e.eventTimeS,
          run
        });
      }
    }
    return map;
  };
  const confC = confirmedOf(coarseEvents, 'coarse');
  const confR = confirmedOf(refinedEvents, 'refined');
  for (const [bodyId, infoC] of confC) {
    const infoR = confR.get(bodyId);
    if (infoR !== undefined && infoC.primary === infoR.primary) {
      if (Math.abs(infoC.timeS - infoR.timeS) <= maxEventTimeDifferenceS) {
        return { unstableReason: 'ejection_confirmed_on_both_resolutions', indeterminateReasons: [], matchedKey: bodyId };
      }
    }
  }
  if (confC.size > 0 || confR.size > 0) {
    reasons.push('ejection_confirmation_disagreement');
  }

  return { unstableReason: null, indeterminateReasons: reasons, matchedKey: null };
}

/**
 * Согласованность машинных классификаций событий между разрешениями:
 * наборы столкновений, кандидатов и pending-выбросов обязаны
 * совпадать; различие — основание indeterminate.
 */
function checkEventClassificationsAgree(
  coarse: StabilityRunOutcome,
  refined: StabilityRunOutcome
): boolean {
  const fingerprint = (outcome: StabilityRunOutcome): string[] => {
    const out: string[] = [];
    for (const ev of outcome.events) {
      if (ev.type === 'collision') {
        const c = ev as CollisionEvent;
        out.push('collision|' + pairKey(c.pairIdA, c.pairIdB));
      } else if (ev.type === 'ejection_candidate') {
        out.push('candidate|' + (ev as EjectionEvent).bodyId);
      } else if (ev.type === 'ejection_pending_at_horizon') {
        out.push('pending|' + (ev as EjectionEvent).bodyId);
      }
    }
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  };
  const fc = fingerprint(coarse);
  const fr = fingerprint(refined);
  if (fc.length !== fr.length) return false;
  for (let i = 0; i < fc.length; i++) {
    if (fc[i] !== fr[i]) return false;
  }
  return true;
}

// ============================================
// 6. СХОДИМОСТЬ COARSE/REFINED
// ============================================

/**
 * Сравнение разрешений на КАЖДОМ общем диагностическом времени (не
 * только финальном). Нормировка — физические начальные масштабы:
 * начальное расстояние тела до primary и характерная скорость
 * sqrt(2·mu/r0) из ЯВНОГО начального состояния. Физически вырожденный
 * масштаб фиксируется с явной причиной и запрещает 'stable'.
 */
function computeConvergence(
  diagC: RunDiagnosticsInternal,
  diagR: RunDiagnosticsInternal,
  canonical: readonly OrbitalBodyState[],
  primaryId: string,
  options: StabilityAssessmentOptions
): StabilityConvergenceReport {
  const reasons: string[] = [];
  const degenerateScaleBodyIds: string[] = [];
  const positionScaleMByBody: Record<string, number> = {};
  const velocityScaleMPerSByBody: Record<string, number> = {};
  const primaryBody = canonical.find((x) => x.id === primaryId) as OrbitalBodyState;

  for (const b of canonical) {
    if (b.id === primaryId) continue;
    const rel0 = vSub(b.positionM, primaryBody.positionM);
    const posScale = vNorm(rel0);
    const mu = G * (primaryBody.massKg + b.massKg);
    const velScale = posScale > 0 ? Math.sqrt((2 * mu) / posScale) : NaN;
    positionScaleMByBody[b.id] = posScale;
    velocityScaleMPerSByBody[b.id] = velScale;
    if (!(posScale > 0) || !Number.isFinite(posScale) || !(velScale > 0) || !Number.isFinite(velScale)) {
      degenerateScaleBodyIds.push(b.id);
    }
  }

  const sharedTimes: number[] = [];
  const matchedC: number[] = [];
  const matchedR: number[] = [];
  for (let i = 0; i < diagC.times.length; i++) {
    const j = matchIndexByTime(diagR.times, diagC.times[i]);
    if (j >= 0) {
      sharedTimes.push(diagC.times[i]);
      matchedC.push(i);
      matchedR.push(j);
    }
  }
  const sharedCount = sharedTimes.length;
  if (sharedCount < 2) {
    reasons.push('insufficient_shared_diagnostic_points');
  }

  let maxPos: number | null = null;
  let maxVel: number | null = null;
  let maxA: number | null = null;
  let maxE: number | null = null;
  for (let idx = 0; idx < sharedCount; idx++) {
    const i = matchedC[idx];
    const j = matchedR[idx];
    for (const b of canonical) {
      if (b.id === primaryId) continue;
      if (degenerateScaleBodyIds.includes(b.id)) continue;
      const posC = diagC.positionsByBody.get(b.id)?.[i];
      const posR = diagR.positionsByBody.get(b.id)?.[j];
      const velC = diagC.velocitiesByBody.get(b.id)?.[i];
      const velR = diagR.velocitiesByBody.get(b.id)?.[j];
      const primPosC = diagC.primaryPositions[i];
      const primPosR = diagR.primaryPositions[j];
      const primVelC = diagC.primaryVelocities[i];
      const primVelR = diagR.primaryVelocities[j];
      if (
        posC === undefined || posR === undefined || velC === undefined || velR === undefined ||
        !isFiniteVec(posC) || !isFiniteVec(posR) || !isFiniteVec(velC) || !isFiniteVec(velR)
      ) {
        continue;
      }
      const posNorm = positionScaleMByBody[b.id];
      const velNorm = velocityScaleMPerSByBody[b.id];
      const posDiff = vDiffNorm(vSub(posC, primPosC), vSub(posR, primPosR)) / posNorm;
      const velDiff = vDiffNorm(vSub(velC, primVelC), vSub(velR, primVelR)) / velNorm;
      if (Number.isFinite(posDiff) && (maxPos === null || posDiff > maxPos)) maxPos = posDiff;
      if (Number.isFinite(velDiff) && (maxVel === null || velDiff > maxVel)) maxVel = velDiff;
      const aC = diagC.aByBody.get(b.id)?.[i] ?? null;
      const aR = diagR.aByBody.get(b.id)?.[j] ?? null;
      const eC = diagC.eByBody.get(b.id)?.[i] ?? null;
      const eR = diagR.eByBody.get(b.id)?.[j] ?? null;
      if (aC !== null && aR !== null && Number.isFinite(aC) && Number.isFinite(aR) && (aC !== 0 || aR !== 0)) {
        const denom = Math.max(Math.abs(aC), Math.abs(aR));
        const aDiff = Math.abs(aC - aR) / denom;
        if (Number.isFinite(aDiff) && (maxA === null || aDiff > maxA)) maxA = aDiff;
      }
      if (eC !== null && eR !== null && Number.isFinite(eC) && Number.isFinite(eR)) {
        const eDiff = Math.abs(eC - eR);
        if (Number.isFinite(eDiff) && (maxE === null || eDiff > maxE)) maxE = eDiff;
      }
    }
  }

  if (degenerateScaleBodyIds.length > 0) {
    reasons.push('degenerate_physical_scale_for_bodies_' + degenerateScaleBodyIds.join('_'));
  }
  if (sharedCount >= 2 && maxPos === null) {
    reasons.push('no_comparable_trajectory_points');
  }
  if (maxPos !== null && maxPos > options.maxRelativePositionDifference) {
    reasons.push('position_convergence_exceeds_tolerance');
  }
  if (maxVel !== null && maxVel > options.maxRelativeVelocityDifference) {
    reasons.push('velocity_convergence_exceeds_tolerance');
  }
  if (maxA !== null && maxA > options.maxRelativeSemimajorAxisDifference) {
    reasons.push('semimajor_axis_convergence_exceeds_tolerance');
  }
  if (maxE !== null && maxE > options.maxEccentricityDifference) {
    reasons.push('eccentricity_convergence_exceeds_tolerance');
  }

  const status: StabilityConvergenceReport['status'] =
    reasons.length === 0 && sharedCount >= 2
      ? 'agreed'
      : reasons.some((r) => r.startsWith('insufficient'))
        ? 'insufficient'
        : 'indeterminate';
  return {
    status,
    reasons,
    sharedDiagnosticTimesCount: sharedCount,
    sharedDiagnosticTimesS: sharedTimes,
    maxRelativePositionDifference: maxPos,
    maxRelativeVelocityDifference: maxVel,
    maxRelativeSemimajorAxisDifference: maxA,
    maxEccentricityDifference: maxE,
    positionScaleMByBody,
    velocityScaleMPerSByBody,
    degenerateScaleBodyIds
  };
}

// ============================================
// 7. ОПЕРАЦИОННЫЕ ОРБИТАЛЬНЫЕ ПРЕДЕЛЫ
// ============================================

interface OperationalExceedance {
  bodyId: string;
  kind: 'semimajor_axis' | 'eccentricity';
  /** Направление превышения: +1 (рост) или -1 (убыль) относительно начального. */
  direction: number;
  measured: number;
}

/**
 * Операционные превышения ЯВНО заданных пределов орбитальной
 * эволюции внутри одного прогона. Тело, показатель и направление
 * превышения фиксируются для сопоставления между разрешениями.
 */
function findOperationalExceedances(
  diagnostics: readonly StabilityBodyOrbitalDiagnostics[],
  options: StabilityAssessmentOptions
): OperationalExceedance[] {
  const out: OperationalExceedance[] = [];
  for (const d of diagnostics) {
    if (
      d.maxRelativeSemimajorAxisExcursion !== null &&
      d.maxRelativeSemimajorAxisExcursion > options.maxRelativeSemimajorAxisExcursion
    ) {
      out.push({
        bodyId: d.bodyId,
        kind: 'semimajor_axis',
        direction: (d.worstSignedRelativeSemimajorAxisDeviation ?? 0) >= 0 ? 1 : -1,
        measured: d.maxRelativeSemimajorAxisExcursion
      });
    }
    if (
      d.maxAbsoluteEccentricityExcursion !== null &&
      d.maxAbsoluteEccentricityExcursion > options.maxAbsoluteEccentricityExcursion
    ) {
      out.push({
        bodyId: d.bodyId,
        kind: 'eccentricity',
        direction: (d.worstSignedEccentricityDeviation ?? 0) >= 0 ? 1 : -1,
        measured: d.maxAbsoluteEccentricityExcursion
      });
    }
  }
  return out;
}

// ============================================
// 8. ГЛАВНЫЙ API
// ============================================

/**
 * Конечногоризонтная динамическая оценка устойчивости (Stage 4.6.2).
 *
 * Выполняет два прогона ОДНОГО и того же движка Stage 4.6.1-A/B/C
 * (coarse dt и refined dt/2), собирает события, conservation-
 * диагностику, осциллирующие элементы относительно ЯВНОГО primary
 * на ОБЩИХ физических временах, проверяет сходимость разрешений и
 * присваивает вердикт ТОЛЬКО по ЯВНЫМ критериям из options.
 *
 * Гарантии: входное состояние не модифицируется; timestep строго
 * фиксированный (адаптивного интегратора нет); никакого изменения
 * энергии/импульса для улучшения результата не выполняется;
 * диагностические снимки хранятся только на явно заданном интервале
 * и в явном пределе. Вердикт НЕ экстраполируется за горизонт.
 */
export function assessNBodyStabilityOverHorizon(
  initialState: NBodyInitialState,
  options: StabilityAssessmentOptions
): StabilityAssessmentResult {
  // --- 1. Валидация: при любой проблеме прогоны не запускаются ---
  const issues = validateStabilityOptions(initialState, options);
  if (issues.length > 0) {
    return { status: 'invalid_input', issues };
  }

  const time0 = initialState.timeS;
  const h = options.timeStepS;
  const hr = h / 2;
  const nCoarse = Math.round(options.durationS / h);
  const nRefined = Math.round(options.durationS / hr);
  const kCoarse = Math.round(options.diagnosticIntervalS / h);
  const canonical: OrbitalBodyState[] = canonicalBodyOrder(initialState.bodies);
  const primaryId = options.primaryBodyId;

  // --- 2. Два независимых прогона с ЯВНЫМИ параметрами ---
  const optionalEventOptions: {
    closeApproachDistanceM?: number;
    bindingEnergyToleranceJPerKg?: number;
  } = {};
  if (options.closeApproachDistanceM !== undefined) {
    optionalEventOptions.closeApproachDistanceM = options.closeApproachDistanceM;
  }
  if (options.connectivityEnergyToleranceJPerKg !== undefined) {
    optionalEventOptions.bindingEnergyToleranceJPerKg = options.connectivityEnergyToleranceJPerKg;
  }

  const coarseResult = integrateNBodyWithEvents(initialState, {
    timeStepS: h,
    durationS: options.durationS,
    sampleEverySteps: kCoarse,
    maxSteps: options.maxStepsPerRun,
    primaryBodyId: primaryId,
    escapeRadiusM: options.escapeRadiusM,
    escapeConfirmationDurationS: options.escapeConfirmationDurationS,
    ...optionalEventOptions
  });
  const refinedResult = integrateNBodyWithEvents(initialState, {
    timeStepS: hr,
    durationS: options.durationS,
    sampleEverySteps: 2 * kCoarse,
    maxSteps: options.maxStepsPerRun,
    primaryBodyId: primaryId,
    escapeRadiusM: options.escapeRadiusM,
    escapeConfirmationDurationS: options.escapeConfirmationDurationS,
    ...optionalEventOptions
  });

  // --- 3. Развёртка результатов прогонов в публичный формат ---
  const toOutcome = (
    result: ReturnType<typeof integrateNBodyWithEvents>,
    run: 'coarse' | 'refined',
    dtS: number,
    sample: number,
    requestedSteps: number
  ): { outcome: StabilityRunOutcome; snapshots: NBodyStateSnapshot[]; collision: TerminalCollisionInfo | null } => {
    if (result.status === 'completed') {
      return {
        outcome: {
          run,
          timeStepS: dtS,
          sampleEverySteps: sample,
          requestedSteps,
          maxSteps: options.maxStepsPerRun,
          status: 'completed',
          completedHorizon: true,
          stepsCompleted: result.stepsCompleted,
          finalTimeS: result.timeS,
          integrationFailure: null,
          conservation: result.conservation,
          events: sortDetectionEvents(result.events),
          detection: result.detection,
          diagnosticTimesS: []
        },
        snapshots: result.snapshots,
        collision: null
      };
    }
    if (result.status === 'collision_detected') {
      return {
        outcome: {
          run,
          timeStepS: dtS,
          sampleEverySteps: sample,
          requestedSteps,
          maxSteps: options.maxStepsPerRun,
          status: 'collision_detected',
          completedHorizon: false,
          // Вариант collision_detected движка НЕ содержит stepsCompleted.
          stepsCompleted: 'stepsCompleted' in result ? result.stepsCompleted : 0,
          finalTimeS: result.lastCompletedState.timeS,
          integrationFailure: null,
          conservation: null,
          events: sortDetectionEvents(result.events),
          detection: result.detection,
          diagnosticTimesS: []
        },
        snapshots: result.snapshots,
        collision: {
          pair: pairKey(result.pairIdA, result.pairIdB),
          timeS: result.contactTimeS,
          run
        }
      };
    }
    return {
      outcome: {
        run,
        timeStepS: dtS,
        sampleEverySteps: sample,
        requestedSteps,
        maxSteps: options.maxStepsPerRun,
        status: 'integration_failed',
        completedHorizon: false,
        // NBodyIntegrationFailure — объединение: invalid_input не имеет
        // stepsCompleted/timeS, доступны с явным сужением.
        stepsCompleted: 'stepsCompleted' in result.failure ? result.failure.stepsCompleted : 0,
        finalTimeS: 'timeS' in result.failure ? result.failure.timeS : time0,
        integrationFailure: result.failure.status,
        conservation: null,
        events: sortDetectionEvents(result.events),
        detection: result.detection ?? null,
        diagnosticTimesS: []
      },
      snapshots: [],
      collision: null
    };
  };

  const coarse = toOutcome(coarseResult, 'coarse', h, kCoarse, nCoarse);
  const refined = toOutcome(refinedResult, 'refined', hr, 2 * kCoarse, nRefined);

  // Диагностические времена (общая сетка) из фактических снимков.
  const diagC = extractRunDiagnostics(h, kCoarse, coarse.snapshots, time0, canonical, primaryId);
  const diagR = extractRunDiagnostics(hr, 2 * kCoarse, refined.snapshots, time0, canonical, primaryId);
  coarse.outcome.diagnosticTimesS = diagC.times.slice();
  refined.outcome.diagnosticTimesS = diagR.times.slice();

  // --- 4. Орбитальная диагностика по телам ---
  const primaryBody = canonical.find((x) => x.id === primaryId) as OrbitalBodyState;
  const orbitalCoarse: StabilityBodyOrbitalDiagnostics[] = [];
  const orbitalRefined: StabilityBodyOrbitalDiagnostics[] = [];
  for (const b of canonical) {
    if (b.id === primaryId) continue;
    const mu = G * (primaryBody.massKg + b.massKg);
    orbitalCoarse.push(
      summarizeBodyDiagnostics(b.id, mu, diagC.aByBody.get(b.id) ?? [], diagC.eByBody.get(b.id) ?? [], diagC.boundByBody.get(b.id) ?? [])
    );
    orbitalRefined.push(
      summarizeBodyDiagnostics(b.id, mu, diagR.aByBody.get(b.id) ?? [], diagR.eByBody.get(b.id) ?? [], diagR.boundByBody.get(b.id) ?? [])
    );
  }

  // --- 5. Сходимость разрешений ---
  const convergence = computeConvergence(diagC, diagR, canonical, primaryId, options);

  // --- 6. Аналитический скрининг начального состояния ---
  // Отдельный диагностический слой; НИ ОДИН статический критерий
  // скрининга сам по себе не является основанием stable/unstable.
  let analyticScreening: OrbitScreeningResult | null = null;
  const screeningEnabled = options.screening !== undefined;
  if (options.screening !== undefined) {
    const s = options.screening;
    analyticScreening = screenOrbitalStability(initialState, {
      primaryBodyId: primaryId,
      orbitCrossingEnabled: true,
      orbitIntersectionToleranceM: s.orbitIntersectionToleranceM,
      hillScreeningEnabled: true,
      classicHillMaxEccentricity: s.classicHillMaxEccentricity,
      classicHillMaxRelativeInclinationRad: s.classicHillMaxRelativeInclinationRad,
      rocheScreeningEnabled: true,
      rocheLimitModel: s.rocheLimitModel,
      resonanceScreeningEnabled: true,
      resonanceRelativeTolerance: s.resonanceRelativeTolerance,
      maxResonanceInteger: s.maxResonanceInteger
    });
  }

  // --- 7. Покрытие collisions/escape ---
  const coverage: StabilityCollisionEscapeCoverage = {
    collisionCoverageCompleteCoarse:
      coarse.outcome.status !== 'integration_failed' &&
      (coarse.outcome.detection?.pairsWithUnknownRadius ?? 1) === 0 &&
      (coarse.outcome.detection?.collisionDetectionPossible ?? false),
    collisionCoverageCompleteRefined:
      refined.outcome.status !== 'integration_failed' &&
      (refined.outcome.detection?.pairsWithUnknownRadius ?? 1) === 0 &&
      (refined.outcome.detection?.collisionDetectionPossible ?? false),
    pairsWithUnknownRadiusCoarse: coarse.outcome.detection?.pairsWithUnknownRadius ?? -1,
    pairsWithUnknownRadiusRefined: refined.outcome.detection?.pairsWithUnknownRadius ?? -1,
    escapeDetectionEnabledCoarse: coarse.outcome.detection?.escapeDetectionEnabled ?? false,
    escapeDetectionEnabledRefined: refined.outcome.detection?.escapeDetectionEnabled ?? false,
    initialConnectivityComponents: coarse.outcome.detection?.initialConnectivityComponents ?? null
  };

  // --- 8. Явные проверки десяти условий 'stable' ---
  const checks: StabilityCriterionCheck[] = [];
  const warnings: string[] = [];

  const bothCompleted = coarse.outcome.completedHorizon && refined.outcome.completedHorizon;
  checks.push({
    code: 'both_runs_completed_horizon',
    description: 'оба интегратора завершили весь заданный горизонт',
    status: bothCompleted ? 'pass' : 'fail',
    measured: null,
    threshold: null,
    detail: 'coarse: ' + coarse.outcome.status + ', refined: ' + refined.outcome.status
  });
  checks.push({
    code: 'collision_coverage_complete',
    description: 'полное покрытие физических столкновений (неизвестные радиусы запрещают уверенный stable)',
    status: coverage.collisionCoverageCompleteCoarse && coverage.collisionCoverageCompleteRefined ? 'pass' : 'fail',
    measured: Math.max(coverage.pairsWithUnknownRadiusCoarse, coverage.pairsWithUnknownRadiusRefined),
    threshold: 0,
    detail: 'пар с неизвестным радиусом: coarse=' + coverage.pairsWithUnknownRadiusCoarse + ', refined=' + coverage.pairsWithUnknownRadiusRefined
  });
  checks.push({
    code: 'escape_detection_enabled',
    description: 'escape detection включён с ЯВНЫМ primary и полными параметрами на обоих разрешениях',
    status: coverage.escapeDetectionEnabledCoarse && coverage.escapeDetectionEnabledRefined ? 'pass' : 'fail',
    measured: null,
    threshold: null,
    detail: 'primary=' + primaryId + ', escapeRadiusM=' + options.escapeRadiusM.toExponential(6) + ', conf=' + options.escapeConfirmationDurationS.toExponential(6)
  });

  const unresolvedEjectionsOf = (events: readonly NBodyDetectionEvent[]): number =>
    events.filter(
      (e) => e.type === 'ejection_candidate' || e.type === 'ejection_confirmed' || e.type === 'ejection_pending_at_horizon'
    ).length;
  const unresolvedCoarse = unresolvedEjectionsOf(coarse.outcome.events);
  const unresolvedRefined = unresolvedEjectionsOf(refined.outcome.events);
  checks.push({
    code: 'no_unresolved_ejections_or_collisions',
    description: 'нет подтверждённых выбросов, незавершённых кандидатов, pending-событий и столкновений',
    status:
      unresolvedCoarse === 0 &&
      unresolvedRefined === 0 &&
      coarse.outcome.status !== 'collision_detected' &&
      refined.outcome.status !== 'collision_detected'
        ? 'pass'
        : 'fail',
    measured: unresolvedCoarse + unresolvedRefined,
    threshold: 0,
    detail: 'активных событий выброса: coarse=' + unresolvedCoarse + ', refined=' + unresolvedRefined
  });

  let unresolvedApproaches = 0;
  for (const outcome of [coarse.outcome, refined.outcome]) {
    for (const ev of outcome.events) {
      if (ev.type === 'close_approach') {
        const ca = ev as CloseApproachEvent;
        if (ca.ongoingAtHorizon || ca.exitTimeS === null) {
          unresolvedApproaches += 1;
        } else {
          warnings.push(
            'закрытое сближение ' + ca.pairIdA + '/' + ca.pairIdB + ' — диагностическое предупреждение, не терминальное событие'
          );
        }
      }
    }
  }
  checks.push({
    code: 'no_unresolved_close_approach',
    description: 'нет неразрешённых close-approach событий (закрытые эпизоды — предупреждения)',
    status: unresolvedApproaches === 0 ? 'pass' : 'fail',
    measured: unresolvedApproaches,
    threshold: 0,
    detail: 'неразрешённых сближений: ' + unresolvedApproaches
  });

  let connectivityChanges = 0;
  for (const outcome of [coarse.outcome, refined.outcome]) {
    for (const ev of outcome.events) {
      if (ev.type === 'connectivity_lost' || ev.type === 'connectivity_restored' || ev.type === 'connectivity_changed') {
        const c = ev as ConnectivityEvent;
        connectivityChanges += 1;
        warnings.push(
          'изменение pairwise-графа связности при t=' + c.eventTimeS.toExponential(6) + ' с (' + c.type + ') — диагностическое предупреждение: граф сам по себе не доказывает ни устойчивости, ни нестабильности'
        );
      }
    }
  }
  checks.push({
    code: 'no_connectivity_changes',
    description: 'нет событий потери/изменения связности, требующих дополнительной оценки',
    status: connectivityChanges === 0 ? 'pass' : 'fail',
    measured: connectivityChanges,
    threshold: 0,
    detail: 'событий связности: ' + connectivityChanges
  });

  const undetermined: string[] = [];
  for (const d of [...orbitalCoarse, ...orbitalRefined]) {
    if (d.undeterminedReason !== null) {
      undetermined.push(d.bodyId + ' (' + d.undeterminedReason + ', точек: ' + d.undeterminedPoints + ')');
    }
  }
  checks.push({
    code: 'orbital_elements_computable',
    description: 'все требуемые орбитальные элементы вычислимы на общих временах',
    status: undetermined.length === 0 ? 'pass' : 'fail',
    measured: undetermined.length,
    threshold: 0,
    detail: undetermined.length > 0 ? 'невычислимые элементы: ' + undetermined.join('; ') : 'все элементы вычислены'
  });

  const consPairs: { code: string; measured: number | null; threshold: number }[] = [];
  if (coarse.outcome.conservation !== null) {
    consPairs.push({ code: 'conservation_energy_coarse', measured: coarse.outcome.conservation.maxEnergyDriftRelative, threshold: options.maxEnergyDriftRelative });
    consPairs.push({ code: 'conservation_momentum_coarse', measured: coarse.outcome.conservation.maxMomentumDriftRelative, threshold: options.maxMomentumDriftRelative });
    consPairs.push({ code: 'conservation_angular_momentum_coarse', measured: coarse.outcome.conservation.maxAngularMomentumDriftRelative, threshold: options.maxAngularMomentumDriftRelative });
  }
  if (refined.outcome.conservation !== null) {
    consPairs.push({ code: 'conservation_energy_refined', measured: refined.outcome.conservation.maxEnergyDriftRelative, threshold: options.maxEnergyDriftRelative });
    consPairs.push({ code: 'conservation_momentum_refined', measured: refined.outcome.conservation.maxMomentumDriftRelative, threshold: options.maxMomentumDriftRelative });
    consPairs.push({ code: 'conservation_angular_momentum_refined', measured: refined.outcome.conservation.maxAngularMomentumDriftRelative, threshold: options.maxAngularMomentumDriftRelative });
  }
  if (consPairs.length < 6 && bothCompleted) {
    consPairs.push({ code: 'conservation_reports_missing', measured: null, threshold: 0 });
  }
  for (const cp of consPairs) {
    checks.push({
      code: cp.code,
      description: 'дрейф сохраняющейся величины в пределах ЯВНОГО допуска из options',
      status: cp.measured !== null && cp.measured <= cp.threshold ? 'pass' : 'fail',
      measured: cp.measured,
      threshold: cp.threshold,
      detail: 'сравнение измеренного дрейфа с явным порогом'
    });
  }

  const failedRuns: string[] = [];
  if (coarse.outcome.status === 'integration_failed') failedRuns.push('coarse: ' + coarse.outcome.integrationFailure);
  if (refined.outcome.status === 'integration_failed') failedRuns.push('refined: ' + refined.outcome.integrationFailure);
  checks.push({
    code: 'no_integration_failures',
    description: 'ни один прогон не завершился отказом',
    status: failedRuns.length === 0 ? 'pass' : 'fail',
    measured: failedRuns.length,
    threshold: 0,
    detail: failedRuns.length > 0 ? failedRuns.join('; ') : 'оба прогона без отказов'
  });

  // --- 9. Присвоение вердикта (прозрачные и проверяемые правила) ---
  const indeterminateReasons: string[] = [];

  // 9a. Операционные орбитальные пределы.
  const limitC = findOperationalExceedances(orbitalCoarse, options);
  const limitR = findOperationalExceedances(orbitalRefined, options);
  let operationalMatched: OperationalExceedance | null = null;
  for (const c of limitC) {
    for (const r of limitR) {
      if (c.bodyId === r.bodyId && c.kind === r.kind && c.direction === r.direction) {
        operationalMatched = c;
      }
    }
  }
  if (operationalMatched === null && limitC.length > 0 && limitR.length > 0) {
    indeterminateReasons.push('orbital_limit_disagreement_between_resolutions');
  }
  // Превышение ТОЛЬКО на одном разрешении: недостаточная воспроизводимость,
  // принудительный unstable запрещён — полноценный indeterminate.
  if ((limitC.length > 0) !== (limitR.length > 0)) {
    indeterminateReasons.push('orbital_limit_on_single_resolution');
  }

  // 9b. События: только при двух непровалившихся прогонах.
  let eventUnstableReason: string | null = null;
  if (failedRuns.length > 0) {
    indeterminateReasons.push('integration_failure_in_one_resolution');
    warnings.push('прогон завершился отказом (' + failedRuns.join('; ') + '): терминальные события не сопоставляются, stable невозможен');
  } else {
    const terminal = matchTerminalEvents(
      coarse.collision,
      refined.collision,
      coarse.outcome.events,
      refined.outcome.events,
      options.maxEventTimeDifferenceS
    );
    if (terminal.unstableReason !== null) {
      eventUnstableReason = terminal.unstableReason;
    } else {
      indeterminateReasons.push(...terminal.indeterminateReasons);
    }
  }

  // 9c. Согласованность классификаций событий между разрешениями.
  if (!checkEventClassificationsAgree(coarse.outcome, refined.outcome)) {
    warnings.push('наборы кандидатов/терминальных событий различаются между разрешениями');
    indeterminateReasons.push('event_classifications_disagree_between_resolutions');
  }

  // 9d. Сходимость.
  if (convergence.status !== 'agreed') {
    indeterminateReasons.push('coarse_refined_convergence_' + convergence.status);
  } else {
    warnings.push(
      'сходимость coarse/refined: максимумы относительных расхождений позиция=' + (convergence.maxRelativePositionDifference ?? NaN).toExponential(6) +
      ', скорость=' + (convergence.maxRelativeVelocityDifference ?? NaN).toExponential(6) +
      ', a=' + (convergence.maxRelativeSemimajorAxisDifference ?? NaN).toExponential(6) +
      ', e=' + (convergence.maxEccentricityDifference ?? NaN).toExponential(6) +
      ' на ' + convergence.sharedDiagnosticTimesCount + ' общих диагностических временах'
    );
  }

  // 9e. Проваленные условия stable.
  const failedCheckCodes: string[] = [];
  for (const check of checks) {
    if (check.status === 'fail') {
      failedCheckCodes.push(check.code);
      indeterminateReasons.push('stable_condition_failed_' + check.code);
    }
  }

  // 9f. Приоритет: воспроизводимый терминальный unstable; затем
  // indeterminate по расхождениям/проверкам; затем операционный
  // unstable; затем stable при выполнении всех десяти условий.
  let verdict: StabilityVerdict;
  let verdictReasons: string[];
  if (eventUnstableReason !== null) {
    verdict = 'unstable';
    verdictReasons = [eventUnstableReason];
  } else if (failedRuns.length > 0 || convergence.status !== 'agreed' || failedCheckCodes.length > 0 || indeterminateReasons.length > 0) {
    verdict = 'indeterminate';
    verdictReasons = dedupe(indeterminateReasons);
  } else if (operationalMatched !== null) {
    verdict = 'unstable';
    verdictReasons = ['operational_orbital_limit_on_both_resolutions'];
    warnings.push(
      'операционный предел ' + operationalMatched.kind + ' превышен телом ' + operationalMatched.bodyId +
      ' (измерено ' + operationalMatched.measured.toExponential(6) + ') на обоих разрешениях; это критерий данного сценария, а не универсальный физический закон'
    );
  } else {
    verdict = 'stable';
    verdictReasons = ['all_explicit_stable_conditions_satisfied_on_horizon'];
  }
  if (operationalMatched !== null && eventUnstableReason !== null) {
    verdictReasons.push('operational_orbital_limit_on_both_resolutions');
  }

  return assembleSuccess(
    options,
    time0,
    coarse.outcome,
    refined.outcome,
    orbitalCoarse,
    orbitalRefined,
    convergence,
    coverage,
    analyticScreening,
    screeningEnabled,
    checks,
    warnings,
    verdict,
    verdictReasons
  );
}

/** Дубликаты строк убираются с сохранением порядка. */
function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// ============================================
// 10. СБОРКА РЕЗУЛЬТАТА
// ============================================

function assembleSuccess(
  options: StabilityAssessmentOptions,
  time0: number,
  coarse: StabilityRunOutcome,
  refined: StabilityRunOutcome,
  orbitalCoarse: StabilityBodyOrbitalDiagnostics[],
  orbitalRefined: StabilityBodyOrbitalDiagnostics[],
  convergence: StabilityConvergenceReport,
  coverage: StabilityCollisionEscapeCoverage,
  analyticScreening: OrbitScreeningResult | null,
  screeningEnabled: boolean,
  checks: StabilityCriterionCheck[],
  warnings: string[],
  verdict: StabilityVerdict,
  verdictReasons: string[]
): StabilityAssessmentSuccess {
  const enrichedWarnings = warnings.slice();
  if (analyticScreening !== null && analyticScreening.status === 'completed') {
    const crossings = analyticScreening.crossings.filter((c) => c.result === 'geometric_crossing');
    if (crossings.length > 0) {
      enrichedWarnings.push(
        'геометрические пересечения орбит (' + crossings.length + ') — диагностическое предупреждение: НЕ классифицируются как столкновения и не являются основанием вердикта'
      );
    }
    if (analyticScreening.resonanceCandidates.length > 0) {
      enrichedWarnings.push(
        'кандидаты в соизмеримости периодов (' + analyticScreening.resonanceCandidates.length + ') — НЕ подтверждённые резонансы; подтверждение временной либрацией резонансных углов НЕ реализовано (будущая задача)'
      );
    }
  }
  if (!screeningEnabled) {
    enrichedWarnings.push('аналитический скрининг Stage 4.6.1-D не настроен ЯВНО (options.screening отсутствует): скрининг не выполнялся, результат диагностических критериев отсутствует');
  }
  return {
    status: 'completed',
    verdict,
    verdictReasons,
    rationale: buildRationale(verdict, verdictReasons, options),
    initialEpochS: time0,
    horizonS: options.durationS,
    runs: { coarse, refined },
    checks,
    conservation: { coarse: coarse.conservation, refined: refined.conservation },
    orbitalDiagnostics: { coarse: orbitalCoarse, refined: orbitalRefined },
    convergence,
    collisionEscapeCoverage: coverage,
    analyticScreening,
    analyticScreeningEnabled: screeningEnabled,
    limitations: [
      STABILITY_ASSESSMENT_LIMITATION,
      NBODY_LEAPFROG_LIMITATION,
      ORBIT_SCREENING_LIMITATION
    ],
    warnings: enrichedWarnings
  };
}

/** Человекочитаемое обоснование вердикта (RU) по машинным основаниям. */
function buildRationale(
  verdict: StabilityVerdict,
  reasons: readonly string[],
  options: StabilityAssessmentOptions
): string {
  const header =
    verdict === 'stable'
      ? 'STABLE (операционно, только на горизонте ' + options.durationS.toExponential(6) +
        ' с при заданных допусках): оба разрешения timestep прошли горизонт, сходимость coarse/refined в допусках, все десять явных условий контракта выполнены. Устойчивость за пределами горизонта, бесконечная устойчивость и устойчивость при произвольных возмущениях НЕ утверждаются.'
      : verdict === 'unstable'
        ? 'UNSTABLE (воспроизводимый критерий на ОБОИХ разрешениях timestep на горизонте ' + options.durationS.toExponential(6) + ' с): '
        : 'INDETERMINATE (недостаточно доказательств для stable или unstable на горизонте ' + options.durationS.toExponential(6) + ' с): ';
  const lines = reasons.map((r) => reasonText(r, options));
  return header + ' ' + lines.join(' ');
}

function reasonText(code: string, options: StabilityAssessmentOptions): string {
  const known: Record<string, string> = {
    collision_confirmed_on_both_resolutions:
      'физическое столкновение одной пары обнаружено на обоих разрешениях, оценки времени контакта согласуются в пределах maxEventTimeDifferenceS=' + options.maxEventTimeDifferenceS + ' с',
    collision_disagreement_between_resolutions:
      'разрешения дают разные терминальные столкновения (пара или время расходятся сверх допуска): принудительный unstable запрещён',
    collision_on_single_resolution: 'столкновение наблюдается только на одном разрешении',
    ejection_confirmed_on_both_resolutions:
      'подтверждённый выброс одного тела относительно одного primary воспроизведён на обоих разрешениях; событие не является кандидатом или pending',
    ejection_confirmation_disagreement:
      'подтверждённые выбросы не согласуются между разрешениями (тело, primary или время)',
    orbital_limit_on_single_resolution: 'операционный предел орбитальной эволюции превышен только на одном разрешении',
    orbital_limit_disagreement_between_resolutions:
      'операционные пределы превышены на обоих разрешениях, но тело/показатель/направление не совпадают',
    operational_orbital_limit_on_both_resolutions:
      'операционный предел орбитальной эволюции (пороги из options) превышен на обоих разрешениях с совпадающими телом, показателем и направлением; это критерий данного сценария, а не универсальный физический закон',
    event_classifications_disagree_between_resolutions:
      'разрешения дают разные наборы кандидатов/терминальных событий',
    integration_failure_in_one_resolution:
      'один из прогонов завершился отказом интегратора; результат не может быть stable',
    coarse_refined_convergence_insufficient:
      'слишком мало общих диагностических времён для сравнения разрешений',
    coarse_refined_convergence_indeterminate:
      'сходимость coarse/refined не установлена: расхождение сверх допусков или вырожденный физический масштаб'
  };
  if (known[code] !== undefined) return known[code] + '.';
  if (code.startsWith('stable_condition_failed_')) {
    return 'условие stable не выполнено: ' + code.slice('stable_condition_failed_'.length) + '.';
  }
  return code + '.';
}
