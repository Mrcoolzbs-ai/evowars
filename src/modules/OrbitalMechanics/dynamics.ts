// ============================================
// DYNAMICS - Детерминированная N-body динамика (Stage 4.6.1-A/B)
// ============================================
//
// Чистый гравитационный N-body интегратор: метод leapfrog KDK
// (kick-drift-kick), симплектический интегратор 2-го порядка.
//
// ГРАНИЦЫ ЭТАПА 4.6.1-A (намеренные, не дефекты):
// - БЕЗ смягчения (softening): чистый ньютоновский потенциал 1/r;
// - БЕЗ адаптивного шага: timestep фиксирован на весь прогон;
// - БЕЗ перенормировки энергии: дрейф энергии честно измеряется;
// - успешное завершение прогона НЕ является вердиктом устойчивости
//   орбиты (статусы stable/unstable интегратор не выдаёт).
//
// Stage 4.6.1-B: поверх ТОГО ЖЕ движка добавлено обнаружение тесных
// сближений и физических столкновений внутри drift-шага (см. events.ts).
// Оба публичных API — integrateNBodyLeapfrog и integrateNBodyWithEvents —
// используют один общий внутренний KDK-движок runKdkCore: алгоритм
// интегрирования НЕ скопирован во вторую реализацию. Без событийного
// хука движок выполняет ровно те же операции в том же порядке, что и
// в этапе 4.6.1-A (численные результаты побитово совпадают).
// Столкновение останавливает прогон ДО второго kick контактного шага;
// слияния/отскоки/фрагментации/передача энергии НЕ моделируются.
//
// Stage 4.6.1-C: движок получил НЕобязательный второй хук конца шага
// (после второго kick) для escape/connectivity детекции events.ts.
// Хук не выполняет ни одной операции над числами, когда он не задан:
// чистый путь 4.6.1-A и путь 4.6.1-B остаются побитово неизменными.
//
// Детерминизм: все суммы и вычисления выполняются в каноническом
// порядке тел (сортировка по id) — результат побитово не зависит от
// порядка тел во входном массиве и воспроизводим бит в бит.

import { G } from '../Units';
import {
  bindingGraphEdges,
  componentsFromEdges,
  createEventCollector,
  sortDetectionEvents,
  type CollisionEvent,
  type EventCollectorHalt,
  type NBodyDetectionEvent,
  type NBodyEventDetectionMetadata,
  type NBodyEventIntegrationOptions,
  type NBodyEventIntegrationResult
} from './events';

// ============================================
// 1. ТИПЫ
// ============================================

/** Вектор в SI (метры, м/с, м/с² — по контексту). */
export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/** Состояние одного тела. */
export interface OrbitalBodyState {
  /** Уникальный непустой идентификатор. */
  id: string;
  /** Масса, кг (конечная, строго положительная). */
  massKg: number;
  /** Радиус, м; null если не задан (радиус в гравитации не участвует). */
  radiusM: number | null;
  /** Позиция, м. */
  positionM: Vector3;
  /** Скорость, м/с. */
  velocityMPerS: Vector3;
}

/** Начальное состояние N-body задачи. */
export interface NBodyInitialState {
  /** Начальное время, с (конечное, неотрицательное). */
  timeS: number;
  /** Не менее двух тел. */
  bodies: OrbitalBodyState[];
}

/** Опции интегрирования. */
export interface NBodyIntegrationOptions {
  /** Фиксированный timestep, с (конечный, строго положительный). */
  timeStepS: number;
  /** Полная длительность прогона, с; обязана быть кратна timestep. */
  durationS: number;
  /**
   * Период контрольных снимков: снимок каждые K шагов (плюс всегда
   * начальное состояние и финальное). По умолчанию снимаются только
   * начальное и финальное состояния (2 контрольных точки).
   */
  sampleEverySteps?: number;
  /** Предел числа шагов; по умолчанию 10_000_000. */
  maxSteps?: number;
}

/** Диагностика состояния системы в момент времени. */
export interface NBodyStateDiagnostics {
  /** Полная масса, кг. */
  totalMassKg: number;
  /** Центр масс, м. */
  centerOfMassM: Vector3;
  /** Скорость центра масс, м/с. */
  centerOfMassVelocityMPerS: Vector3;
  /** Полный импульс, кг·м/с. */
  momentumKgMPerS: Vector3;
  /** Полный момент импульса (относительно начала координат), кг·м²/с. */
  angularMomentumKgM2PerS: Vector3;
  /** Кинетическая энергия, Дж. */
  kineticEnergyJ: number;
  /** Потенциальная энергия (отрицательная), Дж. */
  potentialEnergyJ: number;
  /** Полная энергия, Дж. */
  totalEnergyJ: number;
}

/** Контрольный снимок состояния. */
export interface NBodyStateSnapshot {
  /** Время снимка, с. */
  timeS: number;
  /** Состояния тел в каноническом порядке. */
  bodies: OrbitalBodyState[];
  /** Диагностика на момент снимка. */
  diagnostics: NBodyStateDiagnostics;
}

/** Отчёт о сохранении интегралов движения за прогон. */
export interface NBodyConservationReport {
  /** Число контрольных состояний (включая начальное и финальное). */
  controlStateCount: number;
  /** Полная энергия начального состояния, Дж. */
  initialEnergyJ: number;
  /** Максимум |E(t) − E0| / |E0| по контрольным состояниям. */
  maxEnergyDriftRelative: number;
  /** Максимум |p(t) − p0| / Σ m|v0| по контрольным состояниям. */
  maxMomentumDriftRelative: number;
  /** Максимум |L(t) − L0| / Σ m|r×v|0 по контрольным состояниям. */
  maxAngularMomentumDriftRelative: number;
  /** Максимум |COM(t) − (COM0 + V0·t)|, м (равномерное движение ЦМ). */
  maxCenterOfMassDriftM: number;
}

/** Успешное завершение: статус 'completed'. Завершение ≠ устойчивость. */
export interface NBodyIntegrationSuccess {
  status: 'completed';
  /** Число выполненных шагов. */
  stepsCompleted: number;
  /** Конечное время, с. */
  timeS: number;
  /** Контрольные снимки (первый — начальное состояние, последний — финальное). */
  snapshots: NBodyStateSnapshot[];
  /** Отчёт о сохранении интегралов. */
  conservation: NBodyConservationReport;
}

/** Проблема валидации входа. */
export interface NBodyValidationIssue {
  /** Машинный код проблемы. */
  code: string;
  /** Человекочитаемое описание. */
  message: string;
  /** id тела, если проблема относится к телу. */
  bodyId?: string;
  /** Индекс тела во входном массиве, если применимо. */
  bodyIndex?: number;
}

/** Отказ: вход не прошёл валидацию. */
export interface NBodyInvalidInputFailure {
  status: 'invalid_input';
  issues: NBodyValidationIssue[];
}

/** Отказ: требуемое число шагов превышает maxSteps. Прогон не начинался. */
export interface NBodyStepLimitFailure {
  status: 'step_limit_exceeded';
  requiredSteps: number;
  maxSteps: number;
  stepsCompleted: number;
  timeS: number;
}

/** Отказ: недопустимо тесное сближение (порог NBODY_SINGULARITY_DISTANCE_M). */
export interface NBodySingularFailure {
  status: 'singular_configuration';
  /** Пара тел в каноническом порядке (по возрастанию id). */
  pairIdA: string;
  pairIdB: string;
  /** Дистанция между телами, м. */
  distanceM: number;
  /** Порог сближения, м. */
  thresholdM: number;
  stepsCompleted: number;
  timeS: number;
}

/**
 * Отказ: нечисловые значения (переполнение/NaN). Причины:
 * nonfinite_diagnostics — диагностика состояния; nonfinite_geometry —
 * нечисловая геометрия drift-отрезка в событийном слое (Stage 4.6.1-B,
 * аддитивное расширение перечисления причин); nonfinite_step_state —
 * нечисловое согласованное состояние на конце шага в escape/connectivity
 * детекции (Stage 4.6.1-C, аддитивное расширение).
 */
export interface NBodyNumericalFailure {
  status: 'numerical_failure';
  reason: 'nonfinite_diagnostics' | 'nonfinite_geometry' | 'nonfinite_step_state';
  stepsCompleted: number;
  timeS: number;
}

/** Результат интегрирования — дискриминированное объединение по status. */
export type NBodyIntegrationResult =
  | NBodyIntegrationSuccess
  | NBodyInvalidInputFailure
  | NBodyStepLimitFailure
  | NBodySingularFailure
  | NBodyNumericalFailure;

/** Любой отказ (все не-completed статусы, кроме объединения с успехом). */
export type NBodyIntegrationFailure =
  | NBodyInvalidInputFailure
  | NBodyStepLimitFailure
  | NBodySingularFailure
  | NBodyNumericalFailure;

/**
 * Явное описание ограничений интегратора этапа 4.6.1-A. Потребителям
 * запрещено трактовать успешное завершение как вердикт устойчивости.
 */
export const NBODY_LEAPFROG_LIMITATION =
  'Интегратор leapfrog KDK этапа 4.6.1-A использует фиксированный timestep, ' +
  'не обрабатывает сближения/столкновения/выбросы и не переносит энергию ' +
  'между телами. Успешный статус completed означает только то, что прогон ' +
  'дошёл до конца горизонта без отказа; вывод об устойчивости орбит из ' +
  'этого статуса делать нельзя.';

/** Порог сближения, м: пара ближе этого расстояния — singular_configuration. */
export const NBODY_SINGULARITY_DISTANCE_M = 1e-6;

/** Максимальное число шагов по умолчанию. */
export const NBODY_DEFAULT_MAX_STEPS = 10_000_000;

// ============================================
// 2. КАНОНИЧЕСКИЙ ПОРЯДОК
// ============================================

/**
 * Канонический порядок тел: сортировка по id (лексикографическая,
 * стабильная). Все внутренние вычисления интегратора выполняются
 * только в этом порядке — результат не зависит от порядка входа.
 */
export function canonicalBodyOrder(bodies: readonly OrbitalBodyState[]): OrbitalBodyState[] {
  return [...bodies].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ============================================
// 3. ДИАГНОСТИКА СОСТОЯНИЯ
// ============================================

function vec(x: number, y: number, z: number): Vector3 {
  return { x, y, z };
}

/**
 * Полная диагностика системы: масса, центр масс, импульс, момент
 * импульса, кинетическая/потенциальная/полная энергия. Суммы —
 * в каноническом порядке тел.
 */
export function computeStateDiagnostics(state: NBodyInitialState): NBodyStateDiagnostics {
  const bodies = canonicalBodyOrder(state.bodies);
  let totalMass = 0;
  let comX = 0;
  let comY = 0;
  let comZ = 0;
  let cvx = 0;
  let cvy = 0;
  let cvz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  let kinetic = 0;
  let potential = 0;
  for (const b of bodies) {
    totalMass += b.massKg;
    comX += b.massKg * b.positionM.x;
    comY += b.massKg * b.positionM.y;
    comZ += b.massKg * b.positionM.z;
    cvx += b.massKg * b.velocityMPerS.x;
    cvy += b.massKg * b.velocityMPerS.y;
    cvz += b.massKg * b.velocityMPerS.z;
    px += b.massKg * b.velocityMPerS.x;
    py += b.massKg * b.velocityMPerS.y;
    pz += b.massKg * b.velocityMPerS.z;
    lx += b.massKg * (b.positionM.y * b.velocityMPerS.z - b.positionM.z * b.velocityMPerS.y);
    ly += b.massKg * (b.positionM.z * b.velocityMPerS.x - b.positionM.x * b.velocityMPerS.z);
    lz += b.massKg * (b.positionM.x * b.velocityMPerS.y - b.positionM.y * b.velocityMPerS.x);
    kinetic += 0.5 * b.massKg * (b.velocityMPerS.x ** 2 + b.velocityMPerS.y ** 2 + b.velocityMPerS.z ** 2);
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[j].positionM.x - bodies[i].positionM.x;
      const dy = bodies[j].positionM.y - bodies[i].positionM.y;
      const dz = bodies[j].positionM.z - bodies[i].positionM.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      potential -= (G * bodies[i].massKg * bodies[j].massKg) / d;
    }
  }
  return {
    totalMassKg: totalMass,
    centerOfMassM: vec(comX / totalMass, comY / totalMass, comZ / totalMass),
    centerOfMassVelocityMPerS: vec(cvx / totalMass, cvy / totalMass, cvz / totalMass),
    momentumKgMPerS: vec(px, py, pz),
    angularMomentumKgM2PerS: vec(lx, ly, lz),
    kineticEnergyJ: kinetic,
    potentialEnergyJ: potential,
    totalEnergyJ: kinetic + potential
  };
}

// ============================================
// 4. БАРИЦЕНТРИЧЕСКАЯ СИСТЕМА ОТСЧЁТА
// ============================================

/**
 * Перевод начального состояния в барицентрическую систему: центр масс
 * в начале координат, суммарный импульс нулевой. Интегратор этот
 * перевод САМ не выполняет — он интегрирует ровно ту систему, которую
 * ему передали.
 */
export function toBarycentricFrame(state: NBodyInitialState): NBodyInitialState {
  const d = computeStateDiagnostics(state);
  return {
    timeS: state.timeS,
    bodies: state.bodies.map((b) => ({
      id: b.id,
      massKg: b.massKg,
      radiusM: b.radiusM,
      positionM: vec(
        b.positionM.x - d.centerOfMassM.x,
        b.positionM.y - d.centerOfMassM.y,
        b.positionM.z - d.centerOfMassM.z
      ),
      velocityMPerS: vec(
        b.velocityMPerS.x - d.centerOfMassVelocityMPerS.x,
        b.velocityMPerS.y - d.centerOfMassVelocityMPerS.y,
        b.velocityMPerS.z - d.centerOfMassVelocityMPerS.z
      )
    }))
  };
}

// ============================================
// 5. ВАЛИДАЦИЯ ВХОДА
// ============================================

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateVector(v: Vector3, code: string, message: string, issues: NBodyValidationIssue[], bodyId: string, bodyIndex: number): void {
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.z)) {
    issues.push({ code, message, bodyId, bodyIndex });
  }
}

/**
 * Полная валидация входа. Собирает ВСЕ проблемы, не останавливается
 * на первой. Коды: bodies_too_few, empty_id, duplicate_id,
 * invalid_mass, invalid_radius, invalid_position, invalid_velocity,
 * invalid_time, invalid_time_step, invalid_duration,
 * invalid_sample_every_steps, invalid_max_steps, steps_not_integer.
 */
function validateInput(
  initialState: NBodyInitialState,
  options: NBodyIntegrationOptions
): NBodyValidationIssue[] {
  const issues: NBodyValidationIssue[] = [];
  if (!Array.isArray(initialState.bodies) || initialState.bodies.length < 2) {
    issues.push({
      code: 'bodies_too_few',
      message: 'N-body задача требует не менее двух тел'
    });
  }
  const seen = new Set<string>();
  const bodies = Array.isArray(initialState.bodies) ? initialState.bodies : [];
  bodies.forEach((b, index) => {
    if (typeof b.id !== 'string' || b.id.length === 0) {
      issues.push({ code: 'empty_id', message: 'id тела обязан быть непустой строкой', bodyIndex: index });
    } else {
      if (seen.has(b.id)) {
        issues.push({ code: 'duplicate_id', message: `id '${b.id}' встречается более одного раза`, bodyId: b.id, bodyIndex: index });
      }
      seen.add(b.id);
    }
    if (!isFiniteNumber(b.massKg) || b.massKg <= 0) {
      issues.push({ code: 'invalid_mass', message: 'massKg обязан быть конечным положительным числом', bodyId: b.id, bodyIndex: index });
    }
    if (b.radiusM !== null && (!isFiniteNumber(b.radiusM) || b.radiusM <= 0)) {
      issues.push({ code: 'invalid_radius', message: 'radiusM, если задан, обязан быть конечным положительным числом', bodyId: b.id, bodyIndex: index });
    }
    if (b.positionM === null || b.positionM === undefined) {
      issues.push({ code: 'invalid_position', message: 'positionM обязателен', bodyId: b.id, bodyIndex: index });
    } else {
      validateVector(b.positionM, 'invalid_position', 'positionM обязан быть конечным вектором', issues, b.id, index);
    }
    if (b.velocityMPerS === null || b.velocityMPerS === undefined) {
      issues.push({ code: 'invalid_velocity', message: 'velocityMPerS обязателен', bodyId: b.id, bodyIndex: index });
    } else {
      validateVector(b.velocityMPerS, 'invalid_velocity', 'velocityMPerS обязан быть конечным вектором', issues, b.id, index);
    }
  });
  if (!isFiniteNumber(initialState.timeS) || initialState.timeS < 0) {
    issues.push({ code: 'invalid_time', message: 'timeS обязан быть конечным неотрицательным числом' });
  }
  if (!isFiniteNumber(options.timeStepS) || options.timeStepS <= 0) {
    issues.push({ code: 'invalid_time_step', message: 'timeStepS обязан быть конечным строго положительным числом' });
  }
  if (!isFiniteNumber(options.durationS) || options.durationS <= 0) {
    issues.push({ code: 'invalid_duration', message: 'durationS обязан быть конечным строго положительным числом' });
  }
  if (options.sampleEverySteps !== undefined && (!Number.isInteger(options.sampleEverySteps) || options.sampleEverySteps < 1)) {
    issues.push({ code: 'invalid_sample_every_steps', message: 'sampleEverySteps, если задан, обязан быть целым числом >= 1' });
  }
  if (options.maxSteps !== undefined && (!Number.isInteger(options.maxSteps) || options.maxSteps < 1)) {
    issues.push({ code: 'invalid_max_steps', message: 'maxSteps, если задан, обязан быть целым числом >= 1' });
  }
  // Кратность горизонта шагу: с допуском на ошибку округления double.
  if (isFiniteNumber(options.timeStepS) && options.timeStepS > 0 && isFiniteNumber(options.durationS) && options.durationS > 0) {
    const exact = options.durationS / options.timeStepS;
    const steps = Math.round(exact);
    if (steps < 1 || Math.abs(options.durationS - steps * options.timeStepS) > 1e-9 * Math.max(options.durationS, steps * options.timeStepS)) {
      issues.push({ code: 'steps_not_integer', message: 'durationS обязан быть целым числом timestep (с допуском 1e-9 относительной погрешности)' });
    }
  }
  return issues;
}

// ============================================
// 6. ГРАВИТАЦИОННЫЕ УСКОРЕНИЯ (ПРЯМАЯ СУММА)
// ============================================

/**
 * Ускорения всех тел: a_i = Σ_{j≠i} G·m_j·(r_j − r_i)/|r_j − r_i|³.
 * Без смягчения. Симметричная попарная схема: каждая пара считается
 * один раз, третий закон Ньютона выполняется по построению.
 */
function computeAccelerations(bodies: readonly OrbitalBodyState[]): Vector3[] {
  const n = bodies.length;
  const acc: Vector3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    acc[i] = vec(0, 0, 0);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = bodies[j].positionM.x - bodies[i].positionM.x;
      const dy = bodies[j].positionM.y - bodies[i].positionM.y;
      const dz = bodies[j].positionM.z - bodies[i].positionM.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const invD3 = 1 / (d2 * Math.sqrt(d2));
      const si = G * bodies[j].massKg * invD3;
      const sj = G * bodies[i].massKg * invD3;
      acc[i] = vec(acc[i].x + si * dx, acc[i].y + si * dy, acc[i].z + si * dz);
      acc[j] = vec(acc[j].x - sj * dx, acc[j].y - sj * dy, acc[j].z - sj * dz);
    }
  }
  return acc;
}

/** Минимальное межтелесное расстояние и пара (в каноническом порядке). */
function closestPair(bodies: readonly OrbitalBodyState[]): { distance: number; a: string; b: string } {
  let best = Infinity;
  let bestA = '';
  let bestB = '';
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const dx = bodies[j].positionM.x - bodies[i].positionM.x;
      const dy = bodies[j].positionM.y - bodies[i].positionM.y;
      const dz = bodies[j].positionM.z - bodies[i].positionM.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < best) {
        best = d;
        bestA = bodies[i].id;
        bestB = bodies[j].id;
      }
    }
  }
  return { distance: best, a: bestA, b: bestB };
}

// ============================================
// 7. ОБЩИЙ KDK-ДВИЖОК И ДВА ПУБЛИЧНЫХ API
// ============================================

/**
 * Остановка прогона, запрошенная событийным слоем (Stage 4.6.1-B).
 * kind 'collision' — физический контакт поверхностей (терминальный);
 * kind 'singularity' — пересечение порога численной сингулярности
 * внутри drift-отрезка; kind 'nonfinite_geometry' — нечисловая
 * геометрия отрезка.
 */
export type KdkHaltInfo = EventCollectorHalt;

/** Событийный хук общего движка: вызывается после drift, до второго kick. */
export interface KdkEventHook {
  onAfterDrift(
    /** Индекс шага (с 1). */
    step: number,
    /** Время начала шага, с. */
    timeStartS: number,
    /** Длительность шага, с. */
    dtS: number,
    /** Позиции тел до drift (канонический порядок), м. */
    prevPositions: readonly Vector3[],
    /** Позиции тел после drift (канонический порядок), м. */
    nextPositions: readonly Vector3[]
  ): { halt: false } | { halt: true; haltInfo: KdkHaltInfo };
  /**
   * Stage 4.6.1-C: НЕобязательный хук КОНЦА шага — вызывается после
   * второго kick, когда позиции и скорости согласованы (оба — на
   * t + dt). Нужен детекции выброса и связности: энергии и радиальные
   * скорости осмысленны только для согласованного состояния. Если
   * отсутствует, движок ведёт себя ровно как в этапе 4.6.1-B.
   */
  onAfterStepEnd?(
    step: number,
    timeStartS: number,
    dtS: number,
    prevPositions: readonly Vector3[],
    nextPositions: readonly Vector3[],
    nextVelocities: readonly Vector3[]
  ): { halt: false } | { halt: true; haltInfo: KdkHaltInfo };
}

/**
 * Внутренний результат движка при остановке хуком. lastCompletedState —
 * состояние на начало остановленного шага (конец предыдущего полностью
 * завершённого шага), НЕ интерполяция на событие.
 */
export interface KdkHaltedRun {
  halted: true;
  halt: KdkHaltInfo;
  /** Число полностью завершённых шагов (до остановленного). */
  stepsCompleted: number;
  /** Время начала остановленного шага, с. */
  timeStartS: number;
  lastCompletedSnapshot: NBodyStateSnapshot;
  snapshots: NBodyStateSnapshot[];
}

/**
 * Общий внутренний KDK-движок обоих публичных API. hook === null —
 * чистый режим этапа 4.6.1-A: ровно те же операции в том же порядке,
 * без дополнительных вычислений.
 */
function runKdkCore(
  initialState: NBodyInitialState,
  options: NBodyIntegrationOptions,
  hook: KdkEventHook | null
): NBodyIntegrationResult | KdkHaltedRun {
  // --- Валидация входа ---
  const issues = validateInput(initialState, options);
  if (issues.length > 0) {
    return { status: 'invalid_input', issues };
  }

  const timeStepS = options.timeStepS;
  const totalSteps = Math.round(options.durationS / timeStepS);
  const sampleEverySteps = options.sampleEverySteps ?? totalSteps;
  const maxSteps = options.maxSteps ?? NBODY_DEFAULT_MAX_STEPS;

  // Канонический порядок: дальше тела обрабатываются только так.
  const bodies: OrbitalBodyState[] = canonicalBodyOrder(initialState.bodies).map((b) => ({
    id: b.id,
    massKg: b.massKg,
    radiusM: b.radiusM,
    positionM: vec(b.positionM.x, b.positionM.y, b.positionM.z),
    velocityMPerS: vec(b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z)
  }));

  const time0 = initialState.timeS;

  // --- Начальная проверка на сингулярную конфигурацию (до диагностики:
  // нулевой зазор даёт бесконечную потенциальную энергию) ---
  const initialClosest = closestPair(bodies);
  if (initialClosest.distance < NBODY_SINGULARITY_DISTANCE_M) {
    return {
      status: 'singular_configuration',
      pairIdA: initialClosest.a,
      pairIdB: initialClosest.b,
      distanceM: initialClosest.distance,
      thresholdM: NBODY_SINGULARITY_DISTANCE_M,
      stepsCompleted: 0,
      timeS: time0
    };
  }

  // --- Начальная диагностика: отказ до первого шага при переполнении ---
  const diagnostics0 = computeStateDiagnostics({ timeS: time0, bodies });
  if (!diagnosticsFinite(diagnostics0)) {
    return { status: 'numerical_failure', reason: 'nonfinite_diagnostics', stepsCompleted: 0, timeS: time0 };
  }

  // --- Предел шагов: прогон не начинается ---
  if (totalSteps > maxSteps) {
    return {
      status: 'step_limit_exceeded',
      requiredSteps: totalSteps,
      maxSteps,
      stepsCompleted: 0,
      timeS: time0
    };
  }

  // --- Базовые величины для отчёта о сохранении ---
  const energy0 = diagnostics0.totalEnergyJ;
  const energyScale = Math.abs(energy0) > 0 ? Math.abs(energy0) : 1;
  const momentumScale = momentumScaleOf(bodies);
  const angularScale = angularScaleOf(bodies);
  const com0 = diagnostics0.centerOfMassM;
  const comV0 = diagnostics0.centerOfMassVelocityMPerS;

  let maxEnergyDrift = 0;
  let maxMomentumDrift = 0;
  let maxAngularDrift = 0;
  let maxComDrift = 0;
  let controlStateCount = 1;

  const snapshots: NBodyStateSnapshot[] = [
    { timeS: time0, bodies: cloneBodies(bodies), diagnostics: diagnostics0 }
  ];

  let acc = computeAccelerations(bodies);

  // Состояние последнего полностью завершённого шага (для событийного
  // слоя: терминальное событие возвращает его отдельно от оценки
  // момента события). Заполняется только при активном хуке.
  let lastCompletedBodies: OrbitalBodyState[] | null = null;

  // --- Основной цикл шагов ---
  for (let step = 1; step <= totalSteps; step++) {
    if (hook) {
      lastCompletedBodies = cloneBodies(bodies);
    }
    // kick (полшага)
    for (let i = 0; i < bodies.length; i++) {
      bodies[i].velocityMPerS = vec(
        bodies[i].velocityMPerS.x + acc[i].x * timeStepS * 0.5,
        bodies[i].velocityMPerS.y + acc[i].y * timeStepS * 0.5,
        bodies[i].velocityMPerS.z + acc[i].z * timeStepS * 0.5
      );
    }
    // Позиции до drift (для проверки drift-отрезка событийным слоем).
    const prevPositions: ReadonlyArray<Vector3> | null = hook
      ? bodies.map((b) => b.positionM)
      : null;
    // drift (полный шаг)
    for (let i = 0; i < bodies.length; i++) {
      bodies[i].positionM = vec(
        bodies[i].positionM.x + bodies[i].velocityMPerS.x * timeStepS,
        bodies[i].positionM.y + bodies[i].velocityMPerS.y * timeStepS,
        bodies[i].positionM.z + bodies[i].velocityMPerS.z * timeStepS
      );
    }
    // --- Событийный слой (Stage 4.6.1-B): проверка drift-отрезков
    // всех пар ДО второго kick. Терминальное событие останавливает
    // шаг: второй kick для остановленного шага не выполняется. ---
    if (hook && prevPositions) {
      const nextPositions = bodies.map((b) => b.positionM);
      const outcome = hook.onAfterDrift(
        step,
        time0 + (step - 1) * timeStepS,
        timeStepS,
        prevPositions,
        nextPositions
      );
      if (outcome.halt) {
        const timeStartS = time0 + (step - 1) * timeStepS;
        const completedBodies = lastCompletedBodies ?? cloneBodies(bodies);
        return {
          halted: true,
          halt: outcome.haltInfo,
          stepsCompleted: step - 1,
          timeStartS,
          lastCompletedSnapshot: {
            timeS: timeStartS,
            bodies: completedBodies,
            diagnostics: computeStateDiagnostics({ timeS: timeStartS, bodies: completedBodies })
          },
          snapshots
        };
      }
    }
    // Проверка сингулярности после дрейфа, до второго kick:
    // ускорение при нулевом зазоре не вычисляется.
    const closest = closestPair(bodies);
    if (closest.distance < NBODY_SINGULARITY_DISTANCE_M) {
      return {
        status: 'singular_configuration',
        pairIdA: closest.a,
        pairIdB: closest.b,
        distanceM: closest.distance,
        thresholdM: NBODY_SINGULARITY_DISTANCE_M,
        stepsCompleted: step - 1,
        timeS: time0 + (step - 1) * timeStepS
      };
    }
    // kick (полшага) с ускорениями в новых позициях
    acc = computeAccelerations(bodies);
    for (let i = 0; i < bodies.length; i++) {
      bodies[i].velocityMPerS = vec(
        bodies[i].velocityMPerS.x + acc[i].x * timeStepS * 0.5,
        bodies[i].velocityMPerS.y + acc[i].y * timeStepS * 0.5,
        bodies[i].velocityMPerS.z + acc[i].z * timeStepS * 0.5
      );
    }

    // --- Событийный слой, конец шага (Stage 4.6.1-C): согласованные
    // позиции и скорости после второго kick. Хук необязателен; без него
    // и без него числа не изменяются (этап 4.6.1-B побитово совпадает). ---
    if (hook && hook.onAfterStepEnd && prevPositions) {
      const nextPositions = bodies.map((b) => b.positionM);
      const nextVelocities = bodies.map((b) => b.velocityMPerS);
      const outcome = hook.onAfterStepEnd(
        step,
        time0 + (step - 1) * timeStepS,
        timeStepS,
        prevPositions,
        nextPositions,
        nextVelocities
      );
      if (outcome.halt) {
        // Шаг ПОЛНОСТЬЮ завершён (в отличие от остановки после drift):
        // последнее завершённое состояние — конец этого шага.
        const timeEndS = time0 + step * timeStepS;
        return {
          halted: true,
          halt: outcome.haltInfo,
          stepsCompleted: step,
          timeStartS,
          lastCompletedSnapshot: {
            timeS: timeEndS,
            bodies: cloneBodies(bodies),
            diagnostics: computeStateDiagnostics({ timeS: timeEndS, bodies })
          },
          snapshots
        };
      }
    }

    const timeK = time0 + step * timeStepS;

    // Контрольный снимок: по периоду и всегда финальный.
    if (step % sampleEverySteps === 0 || step === totalSteps) {
      const diag = computeStateDiagnostics({ timeS: timeK, bodies });
      if (!diagnosticsFinite(diag)) {
        return { status: 'numerical_failure', reason: 'nonfinite_diagnostics', stepsCompleted: step, timeS: timeK };
      }
      maxEnergyDrift = Math.max(maxEnergyDrift, Math.abs(diag.totalEnergyJ - energy0) / energyScale);
      maxMomentumDrift = Math.max(
        maxMomentumDrift,
        vectorNormDiff(diag.momentumKgMPerS, diagnostics0.momentumKgMPerS) / momentumScale
      );
      maxAngularDrift = Math.max(
        maxAngularDrift,
        vectorNormDiff(diag.angularMomentumKgM2PerS, diagnostics0.angularMomentumKgM2PerS) / angularScale
      );
      const expectedComX = com0.x + comV0.x * (timeK - time0);
      const expectedComY = com0.y + comV0.y * (timeK - time0);
      const expectedComZ = com0.z + comV0.z * (timeK - time0);
      const comDrift = Math.sqrt(
        (diag.centerOfMassM.x - expectedComX) ** 2 +
          (diag.centerOfMassM.y - expectedComY) ** 2 +
          (diag.centerOfMassM.z - expectedComZ) ** 2
      );
      maxComDrift = Math.max(maxComDrift, comDrift);
      controlStateCount += 1;
      snapshots.push({ timeS: timeK, bodies: cloneBodies(bodies), diagnostics: diag });
    }
  }

  return {
    status: 'completed',
    stepsCompleted: totalSteps,
    timeS: time0 + totalSteps * timeStepS,
    snapshots,
    conservation: {
      controlStateCount,
      initialEnergyJ: energy0,
      maxEnergyDriftRelative: maxEnergyDrift,
      maxMomentumDriftRelative: maxMomentumDrift,
      maxAngularMomentumDriftRelative: maxAngularDrift,
      maxCenterOfMassDriftM: maxComDrift
    }
  };
}

/**
 * Детерминированное N-body интегрирование методом leapfrog KDK:
 *   v(t + dt/2) = v(t) + a(x(t))·dt/2   — kick
 *   x(t + dt)   = x(t) + v(t + dt/2)·dt — drift
 *   v(t + dt)   = v(t + dt/2) + a(x(t + dt))·dt/2 — kick
 * Симплектический метод 2-го порядка; энергия осциллирует вокруг
 * точного значения без систематического дрейфа. Чистый режим этапа
 * 4.6.1-A: без обнаружения событий (общий движок с runKdkCore).
 */
export function integrateNBodyLeapfrog(
  initialState: NBodyInitialState,
  options: NBodyIntegrationOptions
): NBodyIntegrationResult {
  const raw = runKdkCore(initialState, options, null);
  if ('halted' in raw) {
    // Недостижимо: без событийного хука движок не останавливается.
    throw new Error('kdk: остановка движка без событийного хука невозможна');
  }
  return raw;
}

/** Метаданные покрытия обнаружения для набора тел. */
function buildEventDetectionMetadata(
  bodies: readonly OrbitalBodyState[],
  closeApproachEnabled: boolean,
  closeApproachThresholdM: number | null,
  stepsProcessed: number,
  escape: {
    enabled: boolean;
    primaryId: string | null;
    escapeRadiusM: number | null;
    confirmationDurationS: number | null;
    energyToleranceJPerKg: number | null;
  },
  connectivity: {
    enabled: boolean;
    energyToleranceJPerKg: number | null;
    checksTotal: number;
    initialComponents: number | null;
  }
): NBodyEventDetectionMetadata {
  let bothKnown = 0;
  let unknownRadius = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (bodies[i].radiusM !== null && bodies[j].radiusM !== null) {
        bothKnown += 1;
      } else {
        unknownRadius += 1;
      }
    }
  }
  return {
    closeApproachDetectionEnabled: closeApproachEnabled,
    closeApproachThresholdM: closeApproachThresholdM,
    pairsCheckedTotal: (bodies.length * (bodies.length - 1)) / 2,
    pairsWithBothRadiiKnown: bothKnown,
    pairsWithUnknownRadius: unknownRadius,
    collisionDetectionPossible: bothKnown > 0,
    stepsWithEventDetection: stepsProcessed,
    escapeDetectionEnabled: escape.enabled,
    primaryBodyId: escape.primaryId,
    escapeRadiusM: escape.escapeRadiusM,
    escapeConfirmationDurationS: escape.confirmationDurationS,
    escapeEnergyToleranceJPerKg: escape.energyToleranceJPerKg,
    connectivityDetectionEnabled: connectivity.enabled,
    connectivityEnergyToleranceJPerKg: connectivity.energyToleranceJPerKg,
    connectivityChecksTotal: connectivity.checksTotal,
    initialConnectivityComponents: connectivity.initialComponents
  };
}

/**
 * Событийное N-body интегрирование (Stage 4.6.1-B + 4.6.1-C): тот же
 * общий KDK движок, что и integrateNBodyLeapfrog, с проверкой каждого
 * drift-отрезка всех пар: физический контакт поверхностей (R_A + R_B,
 * терминальный), порог численной сингулярности и, при переданном
 * closeApproachDistanceM, эпизоды тесного сближения. Дополнительно
 * (Stage 4.6.1-C), при ЯВНО заданной конфигурации, на каждом конце
 * шага оцениваются: детекция выброса относительно primaryBodyId
 * (осциллирующая двухтельная энергия + радиальная скорость + явный
 * escapeRadiusM, подтверждение за escapeConfirmationDurationS) и
 * pairwise osculating-binding граф связности с явным
 * bindingEnergyToleranceJPerKg. Обнаружение выполняется на КАЖДОМ
 * шаге независимо от sampleEverySteps, поэтому события доступны даже
 * при редких снимках.
 *
 * Границы: столкновение только останавливает прогон (без слияния,
 * отскока, фрагментации, передачи энергии); radiusM null означает
 * неизвестный радиус, для таких пар столкновение не ищется, и его
 * отсутствие НЕ доказательство безопасности; геометрия события
 * опирается на численный drift-отрезок, ошибка времени зависит от
 * timestep. двухтельные энергии выброса и pairwise graph связности —
 * диагностические приближения, а не доказательства. Статус completed
 * по-прежнему означает только завершение интегрирования, а не
 * устойчивость системы.
 */
export function integrateNBodyWithEvents(
  initialState: NBodyInitialState,
  options: NBodyEventIntegrationOptions
): NBodyEventIntegrationResult {
  const thresholdRaw = options.closeApproachDistanceM;
  const thresholdProvided = thresholdRaw !== undefined;

  // --- Валидация: базовая + событийные опции (Stage 4.6.1-B/C) ---
  const issues = validateInput(initialState, options);
  if (thresholdProvided && (!isFiniteNumber(thresholdRaw) || thresholdRaw <= 0)) {
    issues.push({
      code: 'invalid_close_approach_distance',
      message: 'closeApproachDistanceM, если задан, обязан быть конечным строго положительным числом'
    });
  }
  const canonical: OrbitalBodyState[] = Array.isArray(initialState.bodies)
    ? canonicalBodyOrder(initialState.bodies)
    : [];

  // --- Stage 4.6.1-C: escape-конфигурация ЯВНА и ПОЛНА, либо выключена ---
  const escapeRequested =
    options.primaryBodyId !== undefined ||
    options.escapeRadiusM !== undefined ||
    options.escapeConfirmationDurationS !== undefined;
  if (escapeRequested) {
    if (options.primaryBodyId === undefined) {
      issues.push({
        code: 'missing_escape_option',
        message: 'primaryBodyId обязателен для детекции выброса (не подбирается автоматически)'
      });
    }
    if (options.escapeRadiusM === undefined) {
      issues.push({
        code: 'missing_escape_option',
        message: 'escapeRadiusM обязателен для детекции выброса (не определяется из системы)'
      });
    }
    if (options.escapeConfirmationDurationS === undefined) {
      issues.push({
        code: 'missing_escape_option',
        message: 'escapeConfirmationDurationS обязателен для детекции выброса'
      });
    }
    if (options.primaryBodyId !== undefined && (typeof options.primaryBodyId !== 'string' || options.primaryBodyId.length === 0)) {
      issues.push({
        code: 'invalid_primary_body_id',
        message: 'primaryBodyId обязан быть непустой строкой'
      });
    } else if (
      typeof options.primaryBodyId === 'string' &&
      options.primaryBodyId.length > 0 &&
      Array.isArray(initialState.bodies) &&
      !canonical.some((b) => b.id === options.primaryBodyId)
    ) {
      issues.push({
        code: 'invalid_primary_body_id',
        message: `primaryBodyId '${options.primaryBodyId}' отсутствует среди тел системы`,
        bodyId: options.primaryBodyId
      });
    }
    if (options.escapeRadiusM !== undefined && (!isFiniteNumber(options.escapeRadiusM) || options.escapeRadiusM <= 0)) {
      issues.push({
        code: 'invalid_escape_radius_m',
        message: 'escapeRadiusM, если задан, обязан быть конечным строго положительным числом'
      });
    }
    if (options.escapeConfirmationDurationS !== undefined && (!isFiniteNumber(options.escapeConfirmationDurationS) || options.escapeConfirmationDurationS <= 0)) {
      issues.push({
        code: 'invalid_escape_confirmation_duration_s',
        message: 'escapeConfirmationDurationS, если задан, обязан быть конечным строго положительным числом'
      });
    }
  }
  if (options.ejectionEnergyToleranceJPerKg !== undefined && (!isFiniteNumber(options.ejectionEnergyToleranceJPerKg) || options.ejectionEnergyToleranceJPerKg < 0)) {
    issues.push({
      code: 'invalid_ejection_energy_tolerance_j_per_kg',
      message: 'ejectionEnergyToleranceJPerKg, если задан, обязан быть конечным неотрицательным числом'
    });
  }
  if (options.bindingEnergyToleranceJPerKg !== undefined && (!isFiniteNumber(options.bindingEnergyToleranceJPerKg) || options.bindingEnergyToleranceJPerKg < 0)) {
    issues.push({
      code: 'invalid_binding_energy_tolerance',
      message: 'bindingEnergyToleranceJPerKg, если задан, обязан быть конечным неотрицательным числом'
    });
  }

  if (issues.length > 0) {
    return {
      status: 'integration_failed',
      failure: { status: 'invalid_input', issues },
      events: [],
      detection: buildEventDetectionMetadata(
        canonical,
        false,
        null,
        0,
        { enabled: false, primaryId: null, escapeRadiusM: null, confirmationDurationS: null, energyToleranceJPerKg: null },
        { enabled: false, energyToleranceJPerKg: null, checksTotal: 0, initialComponents: null }
      )
    };
  }

  const threshold = thresholdProvided && isFiniteNumber(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : null;
  const escapeEnabled = escapeRequested;
  const escapeToleranceJPerKg = escapeEnabled ? (options.ejectionEnergyToleranceJPerKg ?? 0) : null;
  const connectivityEnabled = options.bindingEnergyToleranceJPerKg !== undefined;

  // --- Коллектор событий и хук общего движка ---
  const collector = createEventCollector({
    bodies: canonical.map((b) => ({ id: b.id, radiusM: b.radiusM })),
    initialPositions: canonical.map((b) => b.positionM),
    initialVelocities: canonical.map((b) => b.velocityMPerS),
    initialTimeS: initialState.timeS,
    closeApproachThresholdM: threshold,
    singularityThresholdM: NBODY_SINGULARITY_DISTANCE_M,
    massesKg: canonical.map((b) => b.massKg),
    escape:
      escapeEnabled && options.primaryBodyId !== undefined && options.escapeRadiusM !== undefined && options.escapeConfirmationDurationS !== undefined && isFiniteNumber(escapeToleranceJPerKg)
        ? {
            primaryIndex: canonical.findIndex((b) => b.id === options.primaryBodyId),
            primaryId: options.primaryBodyId,
            escapeRadiusM: options.escapeRadiusM,
            escapeConfirmationDurationS: options.escapeConfirmationDurationS,
            ejectionEnergyToleranceJPerKg: escapeToleranceJPerKg
          }
        : null,
    connectivity: connectivityEnabled ? { energyToleranceJPerKg: options.bindingEnergyToleranceJPerKg } : null
  });
  const hook: KdkEventHook = {
    onAfterDrift: (step, timeStartS, dtS, prevPositions, nextPositions) =>
      collector.processStep(step, timeStartS, dtS, prevPositions, nextPositions),
    onAfterStepEnd: (step, timeStartS, dtS, prevPositions, nextPositions, nextVelocities) =>
      collector.processStepEnd(step, timeStartS, dtS, prevPositions, nextPositions, nextVelocities)
  };

  const raw = runKdkCore(initialState, options, hook);
  const initialComponentsCount = connectivityEnabled
    ? componentsFromEdges(
        canonical.map((b) => b.id),
        bindingGraphEdges(
          canonical.map((b) => b.positionM),
          canonical.map((b) => b.velocityMPerS),
          canonical.map((b) => b.massKg),
          options.bindingEnergyToleranceJPerKg as number
        )
      ).length
    : null;
  const detection = buildEventDetectionMetadata(
    canonical,
    threshold !== null,
    threshold,
    collector.stepsProcessed,
    {
      enabled: escapeEnabled,
      primaryId: escapeEnabled ? (options.primaryBodyId ?? null) : null,
      escapeRadiusM: escapeEnabled ? (options.escapeRadiusM ?? null) : null,
      confirmationDurationS: escapeEnabled ? (options.escapeConfirmationDurationS ?? null) : null,
      energyToleranceJPerKg: escapeToleranceJPerKg
    },
    {
      enabled: connectivityEnabled,
      energyToleranceJPerKg: connectivityEnabled ? (options.bindingEnergyToleranceJPerKg ?? null) : null,
      checksTotal: collector.connectivityChecksTotal,
      initialComponents: initialComponentsCount
    }
  );

  if ('halted' in raw) {
    const halt = raw.halt;
    if (halt.kind === 'collision') {
      const collisionEvent: CollisionEvent = {
        type: 'collision',
        pairIdA: halt.pairIdA,
        pairIdB: halt.pairIdB,
        contactRadiusM: halt.contactRadiusM,
        contactTimeS: halt.contactTimeS,
        contactStepFraction: halt.contactStepFraction,
        minimumDistanceM: halt.minimumDistanceM
      };
      const events: NBodyDetectionEvent[] = sortDetectionEvents([
        ...collector.finalize(),
        collisionEvent
      ]);
      return {
        status: 'collision_detected',
        pairIdA: halt.pairIdA,
        pairIdB: halt.pairIdB,
        contactTimeS: halt.contactTimeS,
        contactStepFraction: halt.contactStepFraction,
        lastCompletedState: raw.lastCompletedSnapshot,
        snapshots: raw.snapshots,
        events,
        detection
      };
    }
    if (halt.kind === 'singularity') {
      const failure: NBodySingularFailure = {
        status: 'singular_configuration',
        pairIdA: halt.pairIdA,
        pairIdB: halt.pairIdB,
        distanceM: halt.distanceM,
        thresholdM: halt.thresholdM,
        stepsCompleted: raw.stepsCompleted,
        timeS: halt.timeS
      };
      return {
        status: 'integration_failed',
        failure,
        events: sortDetectionEvents(collector.finalize()),
        detection
      };
    }
    // nonfinite_geometry (drift-отрезок) либо nonfinite_step_state
    // (согласованное состояние, Stage 4.6.1-C) — аддитивные причины.
    const failure: NBodyNumericalFailure = {
      status: 'numerical_failure',
      reason: halt.kind === 'nonfinite_geometry' ? 'nonfinite_geometry' : 'nonfinite_step_state',
      stepsCompleted: raw.stepsCompleted,
      timeS: halt.timeS
    };
    return {
      status: 'integration_failed',
      failure,
      events: sortDetectionEvents(collector.finalize()),
      detection
    };
  }

  if (raw.status === 'completed') {
    return {
      status: 'completed',
      stepsCompleted: raw.stepsCompleted,
      timeS: raw.timeS,
      snapshots: raw.snapshots,
      conservation: raw.conservation,
      events: sortDetectionEvents(collector.finalize({ finalTimeS: raw.timeS, emitPendingEjections: true })),
      detection
    };
  }
  return {
    status: 'integration_failed',
    failure: raw,
    events: sortDetectionEvents(collector.finalize()),
    detection
  };
}

// ============================================
// 8. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function diagnosticsFinite(d: NBodyStateDiagnostics): boolean {
  return (
    Number.isFinite(d.totalMassKg) &&
    Number.isFinite(d.kineticEnergyJ) &&
    Number.isFinite(d.potentialEnergyJ) &&
    Number.isFinite(d.totalEnergyJ) &&
    Number.isFinite(d.centerOfMassM.x) &&
    Number.isFinite(d.centerOfMassM.y) &&
    Number.isFinite(d.centerOfMassM.z) &&
    Number.isFinite(d.centerOfMassVelocityMPerS.x) &&
    Number.isFinite(d.centerOfMassVelocityMPerS.y) &&
    Number.isFinite(d.centerOfMassVelocityMPerS.z) &&
    Number.isFinite(d.momentumKgMPerS.x) &&
    Number.isFinite(d.momentumKgMPerS.y) &&
    Number.isFinite(d.momentumKgMPerS.z) &&
    Number.isFinite(d.angularMomentumKgM2PerS.x) &&
    Number.isFinite(d.angularMomentumKgM2PerS.y) &&
    Number.isFinite(d.angularMomentumKgM2PerS.z)
  );
}

/** Масштаб импульса: Σ m|v| (нулевому импульсу соответствуют нулевые делители → 0). */
function momentumScaleOf(bodies: readonly OrbitalBodyState[]): number {
  let s = 0;
  for (const b of bodies) {
    s += b.massKg * Math.sqrt(b.velocityMPerS.x ** 2 + b.velocityMPerS.y ** 2 + b.velocityMPerS.z ** 2);
  }
  return s;
}

/** Масштаб момента импульса: Σ m|r×v|. */
function angularScaleOf(bodies: readonly OrbitalBodyState[]): number {
  let s = 0;
  for (const b of bodies) {
    const lx = b.positionM.y * b.velocityMPerS.z - b.positionM.z * b.velocityMPerS.y;
    const ly = b.positionM.z * b.velocityMPerS.x - b.positionM.x * b.velocityMPerS.z;
    const lz = b.positionM.x * b.velocityMPerS.y - b.positionM.y * b.velocityMPerS.x;
    s += b.massKg * Math.sqrt(lx * lx + ly * ly + lz * lz);
  }
  return s;
}

/** |a − b| (евклидова норма разности векторов). */
function vectorNormDiff(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function cloneBodies(bodies: readonly OrbitalBodyState[]): OrbitalBodyState[] {
  return bodies.map((b) => ({
    id: b.id,
    massKg: b.massKg,
    radiusM: b.radiusM,
    positionM: vec(b.positionM.x, b.positionM.y, b.positionM.z),
    velocityMPerS: vec(b.velocityMPerS.x, b.velocityMPerS.y, b.velocityMPerS.z)
  }));
}

