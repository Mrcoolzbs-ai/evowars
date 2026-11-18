// ============================================
// EVENTS - обнаружение тесных сближений и столкновений (Stage 4.6.1-B)
// ============================================
//
// Событийный слой поверх ОБЩЕГО KDK-движка dynamics.ts. Обнаружение
// выполняется ВНУТРИ каждого drift-шага по фактическому отрезку
//   r(s) = r0 + s·(r1 − r0),  s ∈ [0,1],
// а не только по сохранённым snapshot'ам: между двумя снимками тело
// может пересечь область сближения и снова её покинуть (fly-through),
// и даже между соседними шагами возможно пересечение порога.
//
// Три РАЗНЫХ условия, которые нельзя смешивать:
// 1. физический контакт поверхностей (R_A + R_B) — терминальное
//    событие collision, останавливающее прогон;
// 2. заданный пользователем порог closeApproachDistanceM —
//    нетерминальные события close_approach (эпизоды);
// 3. численная сингулярность ньютоновской модели
//    (NBODY_SINGULARITY_DISTANCE_M) — отказ прогона.
//
// ГРАНИЦЫ ЭТАПА 4.6.1-B (намеренные, не дефекты):
// - слияния, отскоки, фрагментация, передача энергии и изменение
//   масс НЕ моделируются: столкновение только останавливает прогон;
// - radiusM === null означает "неизвестен", а не "нулевой": для пар
//   с неизвестным радиусом столкновение НЕ ищется, и отсутствие
//   зарегистрированного столкновения НЕ является доказательством
//   безопасности (покрытие отражено в detection-метаданных);
// - геометрия события опирается на численный drift-отрезок, а не на
//   точное решение непрерывной гравитационной траектории между
//   шагами; ошибка времени события зависит от timestep и должна
//   проверяться сходимостью;
// - порог сближения НЕ подбирается автоматически из масс, радиусов
//   или орбит — только явный параметр пользователя.
//
// Stage 4.6.1-C: ДОПОЛНИТЕЛЬНАЯ, физически не смешиваемая с сближениями
// и столкновениями детекция выброса и связности по ЯВНЫМ опциям:
//
// 4. ESCAPE DETECTION (выброс). Центральное тело задаётся ЯВНО
//    (primaryBodyId; НЕ выбирается автоматически по максимальной
//    массе). Для тела i относительно primary p используется
//    осциллирующая двухтельная удельная энергия
//      eps_i = |v_i − v_p|²/2 − G(m_p + m_i)/|r_i − r_p|,
//    радиальная скорость v_r = (r_rel · v_rel)/|r_rel| и ЯВНЫЙ
//    положительный радиус выхода escapeRadiusM. Кандидат: пересечение
//    радиуса НАРУЖУ на drift-отрезке (квадратичное уравнение, не
//    конечный snapshot) при v_r > 0 и eps > допуска. Подтверждение:
//    условия непрерывно выполняются все escapeConfirmationDurationS,
//    проверка на каждом integration step (не по snapshots). Отмена —
//    с явной причиной: возврат внутрь границы, неградиентное движение
//    (v_r <= 0) или энергия не выше допуска. Одиночное положительное
//    значение двухтельной энергии — НЕ доказанный физический выброс:
//    eps осциллирует из-за многотельных возмущений. Это диагностическая
//    оценка по явно объявленному критерию, а не вердикт устойчивости.
//
// 5. CONNECTIVITY (связность). Граф тел: ребро i—j существует при
//      eps_ij = |v_i − v_j|²/2 − G(m_i + m_j)/|r_i − r_j| < −E_tol,
//    где E_tol — ЯВНЫЙ неотрицательный допуск (Дж/кг). Компоненты
//    связности считаются детерминированно в каноническом порядке.
//    ОБЯЗАТЕЛЬНОЕ НАУЧНОЕ ОГРАНИЧЕНИЕ: это pairwise osculating-binding
//    graph — диагностическое приближение, а НЕ доказательство
//    физической связанности N-body системы: вклад остальных тел не
//    входит в каждую отдельную двухтельную энергию. Результат
//    описывает применённый критерий и НЕ является вердиктом
//    устойчивости. Начальное разбиение фиксируется отдельно, в t = 0,
//    и не порождает фиктивного события потери связности.

import { G } from '../Units';
import type {
  Vector3,
  NBodyIntegrationOptions,
  NBodyStateSnapshot,
  NBodyConservationReport,
  NBodyIntegrationFailure
} from './dynamics';

// ============================================
// 1. ГЕОМЕТРИЯ DRIFT-ОТРЕЗКА
// ============================================

export interface SegmentClosestPoint {
  /** Параметр ближайшей точки, зажатый в [0,1]. */
  sStar: number;
  /** Расстояние от начала координат до ближайшей точки отрезка, м. */
  minDistanceM: number;
  /** true: отрезок вырожден (нулевая длина) или нечисловой. */
  degenerate: boolean;
}

/**
 * Ближайшая к началу координат точка отрезка r0 + s·(r1 − r0):
 *   s* = clamp( −(r0·d)/|d|², 0, 1 ),  d = r1 − r0,
 *   d_min = |r(s*)|.
 * Устойчиво к нулевой длине отрезка (s* = 0), переполнению и NaN.
 */
export function segmentClosestPoint(r0: Vector3, r1: Vector3): SegmentClosestPoint {
  const dx = r1.x - r0.x;
  const dy = r1.y - r0.y;
  const dz = r1.z - r0.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  const d0 = Math.sqrt(r0.x * r0.x + r0.y * r0.y + r0.z * r0.z);
  if (!(l2 > 0) || !Number.isFinite(l2)) {
    // Вырожденный отрезок или нечисловое направление: ближайшая
    // точка — сам конец r0.
    return { sStar: 0, minDistanceM: d0, degenerate: true };
  }
  const dot = r0.x * dx + r0.y * dy + r0.z * dz;
  let s = -dot / l2;
  if (!Number.isFinite(s)) {
    s = 0;
  }
  if (s < 0) {
    s = 0;
  }
  if (s > 1) {
    s = 1;
  }
  const px = r0.x + s * dx;
  const py = r0.y + s * dy;
  const pz = r0.z + s * dz;
  return { sStar: s, minDistanceM: Math.sqrt(px * px + py * py + pz * pz), degenerate: false };
}

export interface SegmentSphereCrossing {
  /** true: квадратичное уравнение имеет действительные корни. */
  hasRoot: boolean;
  /** Меньший корень (вход в сферу); может лежать вне [0,1]. */
  sEntry: number;
  /** Больший корень (выход из сферы); может лежать вне [0,1]. */
  sExit: number;
}

/**
 * Пересечение отрезка r0 + s·(r1 − r0) со сферой радиуса R с центром
 * в начале координат (относительное положение пары). Квадратичное
 * уравнение |r0 + s·d|² = R²:
 *   a·s² + 2b·s + c = 0,  a = d·d,  b = r0·d,  c = r0·r0 − R²,
 *   s = ( −b ± √(b² − a·c) ) / a.
 * Дискриминант при округлении вблизи касания зажимается к нулю
 * (касание); вырожденный/нечисловой отрезок — корней нет.
 */
export function segmentSphereCrossing(r0: Vector3, r1: Vector3, radiusM: number): SegmentSphereCrossing {
  const dx = r1.x - r0.x;
  const dy = r1.y - r0.y;
  const dz = r1.z - r0.z;
  const l2 = dx * dx + dy * dy + dz * dz;
  if (!(l2 > 0) || !Number.isFinite(l2)) {
    return { hasRoot: false, sEntry: 0, sExit: 0 };
  }
  const dot = r0.x * dx + r0.y * dy + r0.z * dz;
  const c = r0.x * r0.x + r0.y * r0.y + r0.z * r0.z - radiusM * radiusM;
  const disc = dot * dot - l2 * c;
  if (!Number.isFinite(disc)) {
    return { hasRoot: false, sEntry: 0, sExit: 0 };
  }
  const sq = Math.sqrt(disc > 0 ? disc : 0);
  return { hasRoot: true, sEntry: (-dot - sq) / l2, sExit: (-dot + sq) / l2 };
}

function sub3(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

// ============================================
// 1b. ДВУХТЕЛЬНАЯ ЭНЕРГИЯ И ГРАФ СВЯЗНОСТИ (Stage 4.6.1-C)
// ============================================

export interface RelativePairEnergy {
  /** Расстояние между телами, м. */
  distanceM: number;
  /**
   * Осциллирующая двухтельная удельная энергия, Дж/кг:
   *   eps = |v_rel|²/2 − G(m_i + m_j)/|r_rel|.
   * ДВА-тельное приближение: вклад остальных тел не учтён.
   */
  specificOrbitalEnergyJPerKg: number;
  /** Радиальная скорость (r_rel · v_rel)/|r_rel|, м/с. */
  radialVelocityMPerS: number;
}

/**
 * Осциллирующая двухтельная удельная энергия и радиальная скорость
 * пары (i, j) в заданном состоянии. Чистая функция без скрытого
 * состояния — детерминирована бит в бит при перестановке аргументов
 * (r_rel и v_rel меняют знак одновременно).
 */
export function relativePairEnergy(
  massAKg: number,
  massBKg: number,
  positionA: Vector3,
  positionB: Vector3,
  velocityA: Vector3,
  velocityB: Vector3
): RelativePairEnergy {
  const dr = sub3(positionA, positionB);
  const dv = sub3(velocityA, velocityB);
  const d = norm3(dr);
  const v2 = dv.x * dv.x + dv.y * dv.y + dv.z * dv.z;
  return {
    distanceM: d,
    specificOrbitalEnergyJPerKg: v2 / 2 - (G * (massAKg + massBKg)) / d,
    radialVelocityMPerS: (dr.x * dv.x + dr.y * dv.y + dr.z * dv.z) / d
  };
}

/**
 * Рёбра pairwise osculating-binding графа в каноническом порядке пар
 * (i < j): ребро существует при eps_ij < −tolerance. Поле
 * `edges[p]` соответствует паре p канонического порядка
 * (тот же индекс, что в createEventCollector).
 * Нечисловая энергия трактуется консервативно: ребра нет.
 */
export function bindingGraphEdges(
  positions: readonly Vector3[],
  velocities: readonly Vector3[],
  massesKg: readonly number[],
  energyToleranceJPerKg: number
): boolean[] {
  const edges: boolean[] = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const eps = relativePairEnergy(
        massesKg[i],
        massesKg[j],
        positions[i],
        positions[j],
        velocities[i],
        velocities[j]
      ).specificOrbitalEnergyJPerKg;
      edges.push(Number.isFinite(eps) && eps < -energyToleranceJPerKg);
    }
  }
  return edges;
}

/**
 * Детерминированные connected components по списку рёбер канонического
 * порядка пар. Тела внутри компоненты — в порядке канонического индекса
 * (совпадает с лексикографическим порядком id); список компонент
 * сортируется лексикографически по каноническому представлению.
 * Результат не зависит ни от какого порядка входа, кроме канонического.
 */
export function componentsFromEdges(
  ids: readonly string[],
  edges: readonly boolean[]
): string[][] {
  const n = ids.length;
  const adjacency: number[][] = [];
  for (let i = 0; i < n; i++) {
    adjacency.push([]);
  }
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (edges[p]) {
        adjacency[i].push(j);
        adjacency[j].push(i);
      }
      p += 1;
    }
  }
  const visited = new Array<boolean>(n).fill(false);
  const components: string[][] = [];
  for (let start = 0; start < n; start++) {
    if (visited[start]) {
      continue;
    }
    const members: number[] = [];
    const queue = [start];
    visited[start] = true;
    while (queue.length > 0) {
      const cur = queue.pop() as number;
      members.push(cur);
      for (const nb of adjacency[cur]) {
        if (!visited[nb]) {
          visited[nb] = true;
          queue.push(nb);
        }
      }
    }
    members.sort((a, b) => a - b);
    components.push(members.map((idx) => ids[idx]));
  }
  components.sort((a, b) => {
    const ka = a.join('\u0000');
    const kb = b.join('\u0000');
    if (ka === kb) return 0;
    return ka < kb ? -1 : 1;
  });
  return components;
}

function norm3(a: Vector3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

function clamp01(s: number): number {
  if (s < 0) return 0;
  if (s > 1) return 1;
  return s;
}

// ============================================
// 2. ТИПЫ СОБЫТИЙ
// ============================================

/** Эпизод тесного сближения пары (внутри заданного пользователем порога). */
export interface CloseApproachEvent {
  type: 'close_approach';
  /** Пара в каноническом порядке (по возрастанию id). */
  pairIdA: string;
  pairIdB: string;
  /** Порог сближения, м (тот же, что в опциях прогона). */
  thresholdM: number;
  /** Оценка времени входа в порог, с. */
  entryTimeS: number;
  /** Время минимума дистанции внутри эпизода, с. */
  minimumTimeS: number;
  /** Минимальная дистанция эпизода, м. */
  minimumDistanceM: number;
  /** Оценка времени выхода из порога; null, если эпизод не завершён. */
  exitTimeS: number | null;
  /** Эпизод остался открытым на конце горизонта/остановки прогона. */
  ongoingAtHorizon: boolean;
}

/** Событие физического столкновения (терминальное для прогона). */
export interface CollisionEvent {
  type: 'collision';
  /** Пара в каноническом порядке (по возрастанию id). */
  pairIdA: string;
  pairIdB: string;
  /** Сумма физических радиусов R_A + R_B, м. */
  contactRadiusM: number;
  /** Оценка времени первого контакта, с. */
  contactTimeS: number;
  /** Доля drift-шага, на которой оценён первый контакт, [0,1]. */
  contactStepFraction: number;
  /** Минимальная дистанция на контактном drift-отрезке, м. */
  minimumDistanceM: number;
}

/**
 * Состояние детекции выброса для одного тела. Состояния РАЗДЕЛЕНЫ
 * явно: ejection_candidate — НЕ подтверждённый физический выброс.
 */
export type EjectionStateType =
  | 'ejection_candidate'
  | 'ejection_confirmed'
  | 'ejection_cancelled'
  | 'ejection_pending_at_horizon';

/** Явные причины отмены кандидата выброса. */
export type EjectionCancelReason =
  | 'returned_within_escape_radius'
  | 'radial_velocity_not_outward'
  | 'energy_not_above_threshold';

/** Событие детекции выброса (Stage 4.6.1-C). */
export interface EjectionEvent {
  type: EjectionStateType;
  /** Тело, удовлетворяющее/нарушившее критерий выброса. */
  bodyId: string;
  /** Явное центральное тело классификации, заданное опцией. */
  primaryBodyId: string;
  /** Время пересечения escape radius наружу, с. */
  crossingTimeS: number;
  /** Явный радиус выхода, м. */
  escapeRadiusM: number;
  /**
   * Осциллирующая двухтельная удельная энергия относительно primary,
   * оценённая на конце шага пересечения, Дж/кг (приближение).
   */
  specificOrbitalEnergyAtCrossingJPerKg: number;
  /** Радиальная скорость на конце шага пересечения, м/с. */
  radialVelocityAtCrossingMPerS: number;
  /** Время подтверждения; null, если выброс не подтверждён. */
  confirmationTimeS: number | null;
  /** Время регистрации данного события состояния, с. */
  eventTimeS: number;
  /** Причина отмены; не null только у ejection_cancelled. */
  cancelReason: EjectionCancelReason | null;
}

/** Модель критерия связности (единственная реализация в 4.6.1-C). */
export type ConnectivityCriterionModel = 'pairwise_osculating_binding_energy';

/** Изменение одного ребра графа связности. */
export interface ConnectivityEdgeChange {
  /** Пара тел в каноническом порядке id. */
  bodyIdA: string;
  bodyIdB: string;
  wasConnected: boolean;
  isConnected: boolean;
}

/**
 * Событие изменения connected components pairwise-binding графа.
 * Это диагностическое приближение: pairwise osculating energies, а не
 * доказательство физической связанности N-body системы.
 */
export interface ConnectivityEvent {
  type: 'connectivity_lost' | 'connectivity_restored' | 'connectivity_changed';
  eventTimeS: number;
  /** Компоненты до события, канонический порядок, отсортированы. */
  componentsBefore: string[][];
  /** Компоненты после события, канонический порядок, отсортированы. */
  componentsAfter: string[][];
  componentCountBefore: number;
  componentCountAfter: number;
  /** Изменённые рёбра, канонический порядок пар. */
  edgeChanges: ConnectivityEdgeChange[];
  /** Применённый энергетический допуск, Дж/кг. */
  energyToleranceJPerKg: number;
  /** Применённая модель критерия связности. */
  criterionModel: ConnectivityCriterionModel;
}

/** Любое обнаруженное событие (дискриминация по полю type). */
export type NBodyDetectionEvent =
  | CloseApproachEvent
  | CollisionEvent
  | EjectionEvent
  | ConnectivityEvent;

// ============================================
// 3. МЕТАДАННЫЕ ПОКРЫТИЯ ОБНАРУЖЕНИЯ
// ============================================

/**
 * Что реально проверялось в прогоне. Неполное покрытие столкновений
 * (пары с неизвестным радиусом) НЕ прячется за успешным статусом.
 */
export interface NBodyEventDetectionMetadata {
  /** Классификация тесных сближений включена (порог передан). */
  closeApproachDetectionEnabled: boolean;
  /** Порог сближения, м; null, если выключен. */
  closeApproachThresholdM: number | null;
  /** Всего проверенных пар (все проверки, канонический порядок). */
  pairsCheckedTotal: number;
  /** Пар с известными ОБОИМИ радиусами (для них ищется столкновение). */
  pairsWithBothRadiiKnown: number;
  /** Пар, для которых столкновение НЕ ищется из-за неизвестного радиуса. */
  pairsWithUnknownRadius: number;
  /** Хотя бы одна пара допускает поиск физического столкновения. */
  collisionDetectionPossible: boolean;
  /** Число шагов, на которых выполнялась проверка drift-отрезков. */
  stepsWithEventDetection: number;
  /**
   * Stage 4.6.1-C: включена ли детекция выброса. Выключена честно,
   * если не задана ПОЛНАЯ явная конфигурация (primaryBodyId +
   * escapeRadiusM + escapeConfirmationDurationS).
   */
  escapeDetectionEnabled: boolean;
  /** Явное центральное тело escape-классификации; null, если выключено. */
  primaryBodyId: string | null;
  /** Явный радиус выхода, м; null, если выключен. */
  escapeRadiusM: number | null;
  /** Явный интервал подтверждения, с; null, если выключен. */
  escapeConfirmationDurationS: number | null;
  /** Явный энергетический допуск выброса, Дж/кг; null, если выключено. */
  escapeEnergyToleranceJPerKg: number | null;
  /** Включена ли детекция связности (явный допуск передан). */
  connectivityDetectionEnabled: boolean;
  /** Применённый допуск энергии связности, Дж/кг; null, если выключено. */
  connectivityEnergyToleranceJPerKg: number | null;
  /** Сколько раз вычислялся граф связности (t=0 фиксация + шаги). */
  connectivityChecksTotal: number;
  /** Число компонент в начальном состоянии; null, если выключено. */
  initialConnectivityComponents: number | null;
}

// ============================================
// 4. ОПЦИИ И РЕЗУЛЬТАТ СОБЫТИЙНОГО ИНТЕГРИРОВАНИЯ
// ============================================

export interface NBodyEventIntegrationOptions extends NBodyIntegrationOptions {
  /**
   * Порог тесного сближения, м. Обязан быть конечным и строго
   * положительным; НЕ подбирается автоматически. Если не задан,
   * классификация тесных сближений выключена (см. detection).
   */
  closeApproachDistanceM?: number;
  /**
   * Stage 4.6.1-C: явное центральное тело escape-классификации.
   * НЕ выбирается автоматически по массе. Для включения детекции
   * выброса обязано быть задано ВМЕСТЕ с escapeRadiusM и
   * escapeConfirmationDurationS; тело с таким id обязано существовать.
   */
  primaryBodyId?: string;
  /** Явный конечный строго положительный радиус выхода, м. */
  escapeRadiusM?: number;
  /** Явный строго положительный интервал подтверждения, с. */
  escapeConfirmationDurationS?: number;
  /**
   * Необязательный явный энергетический допуск выброса, Дж/кг.
   * По умолчанию 0. Должен быть конечным неотрицательным.
   */
  ejectionEnergyToleranceJPerKg?: number;
  /**
   * Stage 4.6.1-C: явный НЕОТРИЦАТЕЛЬНЫЙ энергетический допуск
   * pairwise-binding графа связности, Дж/кг. Если не задан, детекция
   * связности выключена. Ребро: eps_ij < −допуск.
   */
  bindingEnergyToleranceJPerKg?: number;
}

/** Горизонт пройден полностью; события сближения при этом возможны. */
export interface NBodyEventsRunCompleted {
  status: 'completed';
  stepsCompleted: number;
  timeS: number;
  snapshots: NBodyStateSnapshot[];
  conservation: NBodyConservationReport;
  /** Все события в детерминированном порядке (время → тип → пара). */
  events: NBodyDetectionEvent[];
  detection: NBodyEventDetectionMetadata;
}

/**
 * Прогон остановлен физическим контактом поверхностей. Последнее
 * полностью завершённое состояние возвращается отдельно от оценки
 * момента контакта: интерполированные координаты события НЕ выдаются
 * за новое интегрированное состояние.
 */
export interface NBodyEventsRunCollisionDetected {
  status: 'collision_detected';
  pairIdA: string;
  pairIdB: string;
  /** Оценка времени первого контакта, с. */
  contactTimeS: number;
  /** Доля контактного drift-шага, [0,1]. */
  contactStepFraction: number;
  /** Состояние на начало контактного шага (конец предыдущего шага). */
  lastCompletedState: NBodyStateSnapshot;
  snapshots: NBodyStateSnapshot[];
  events: NBodyDetectionEvent[];
  detection: NBodyEventDetectionMetadata;
}

/** Отказ интегратора или сингулярная конфигурация; события сохранены. */
export interface NBodyEventsRunIntegrationFailed {
  status: 'integration_failed';
  /** Исходный отказ интегратора Stage 4.6.1-A без изменений. */
  failure: NBodyIntegrationFailure;
  events: NBodyDetectionEvent[];
  detection: NBodyEventDetectionMetadata;
}

export type NBodyEventIntegrationResult =
  | NBodyEventsRunCompleted
  | NBodyEventsRunCollisionDetected
  | NBodyEventsRunIntegrationFailed;

/**
 * Детерминированный порядок событий: время (контакт для collision,
 * минимум для close_approach, время регистрации состояния для
 * ejection- и connectivity-событий), затем приоритет типа, затем
 * канонические ID пары/тела.
 *
 * Приоритеты типов на равном времени: collision(0) → close_approach(1)
 * → ejection_candidate(2) → ejection_cancelled(3) → ejection_confirmed(4)
 * → ejection_pending_at_horizon(5) → connectivity_changed(6)
 * → connectivity_lost(7) → connectivity_restored(8). Порядок within-
 * типа детерминирован по каноническим ID.
 */
export function sortDetectionEvents(events: readonly NBodyDetectionEvent[]): NBodyDetectionEvent[] {
  const timeOf = (e: NBodyDetectionEvent): number =>
    e.type === 'collision' ? e.contactTimeS : e.type === 'close_approach' ? e.minimumTimeS : e.eventTimeS;
  const EVENT_TYPE_PRIORITY: Readonly<Record<NBodyDetectionEvent['type'], number>> = {
    collision: 0,
    close_approach: 1,
    ejection_candidate: 2,
    ejection_cancelled: 3,
    ejection_confirmed: 4,
    ejection_pending_at_horizon: 5,
    connectivity_changed: 6,
    connectivity_lost: 7,
    connectivity_restored: 8
  };
  const priorityOf = (e: NBodyDetectionEvent): number => EVENT_TYPE_PRIORITY[e.type];
  const idKeyOf = (e: NBodyDetectionEvent): string => {
    if (e.type === 'close_approach' || e.type === 'collision') {
      return `${e.pairIdA}\u0000${e.pairIdB}`;
    }
    if (e.type === 'ejection_candidate' || e.type === 'ejection_confirmed' || e.type === 'ejection_cancelled' || e.type === 'ejection_pending_at_horizon') {
      return e.bodyId;
    }
    return '';
  };
  return [...events].sort((x, y) => {
    const dt = timeOf(x) - timeOf(y);
    if (dt !== 0) {
      return dt;
    }
    const dp = priorityOf(x) - priorityOf(y);
    if (dp !== 0) {
      return dp;
    }
    const kx = idKeyOf(x);
    const ky = idKeyOf(y);
    if (kx !== ky) {
      return kx < ky ? -1 : 1;
    }
    return 0;
  });
}

// ============================================
// 5. КОЛЛЕКТОР СОБЫТИЙ (СОСТОЯНИЕ ЭПИЗОДОВ ПО ПАРАМ)
// ============================================

/** Остановка прогона, запрошенная событийным слоем. */
export type EventCollectorHalt =
  | {
      kind: 'collision';
      pairIdA: string;
      pairIdB: string;
      contactRadiusM: number;
      contactTimeS: number;
      contactStepFraction: number;
      minimumDistanceM: number;
      /** Индекс шага (с 1), на котором обнаружен контакт. */
      step: number;
    }
  | {
      kind: 'singularity';
      pairIdA: string;
      pairIdB: string;
      distanceM: number;
      thresholdM: number;
      /** Оценка времени пересечения порога, с. */
      timeS: number;
      step: number;
    }
  | {
      kind: 'nonfinite_geometry';
      step: number;
      timeS: number;
    }
  | {
      /** Нечисловое состояние на конце шага (Stage 4.6.1-C). */
      kind: 'nonfinite_step_state';
      step: number;
      timeS: number;
    };

/** Явная конфигурация детекции выброса (Stage 4.6.1-C). */
export interface EscapeDetectionConfig {
  /** Канонический индекс центрального тела. */
  primaryIndex: number;
  primaryId: string;
  /** Радиус выхода, м (строго положительный. конечный). */
  escapeRadiusM: number;
  /** Интервал подтверждения, с (строго положительный, конечный). */
  escapeConfirmationDurationS: number;
  /** Энергетический допуск, Дж/кг (неотрицательный; по умолчанию 0). */
  ejectionEnergyToleranceJPerKg: number;
}

export interface EventCollectorConfig {
  /** Тела в каноническом порядке (id + радиус; radiusM null = неизвестен). */
  bodies: readonly { id: string; radiusM: number | null }[];
  /** Начальные позиции в том же каноническом порядке, м. */
  initialPositions: readonly Vector3[];
  initialTimeS: number;
  /** Порог тесного сближения; null — классификация выключена. */
  closeApproachThresholdM: number | null;
  /** Порог численной сингулярности (NBODY_SINGULARITY_DISTANCE_M). */
  singularityThresholdM: number;
  /**
   * Stage 4.6.1-C: массы тел в каноническом порядке, кг. Обязательна
   * при включённой escape- или connectivity-детекции (нужна для
   * двухтельных энергий).
   */
  massesKg?: readonly number[];
  /** Начальные скорости в каноническом порядке, м/с (для базовой связности). */
  initialVelocities?: readonly Vector3[];
  /** Явная конфигурация escape-детекции; null/undefined — выключена. */
  escape?: EscapeDetectionConfig | null;
  /** Явная конфигурация connectivity-детекции; null/undefined — выключена. */
  connectivity?: { energyToleranceJPerKg: number } | null;
}

export interface EventCollector {
  /**
   * Проверка drift-отрезков всех пар одного шага. Вызывается движком
   * после drift, ДО второго kick. Пары — в каноническом порядке;
   * внутри пары приоритет: контакт → сингулярность → сближение.
   */
  processStep(
    step: number,
    timeStartS: number,
    dtS: number,
    prevPositions: readonly Vector3[],
    nextPositions: readonly Vector3[]
  ): { halt: false } | { halt: true; haltInfo: EventCollectorHalt };
  /**
   * Stage 4.6.1-C: проверка КОНЦА шага (после второго kick): условия
   * подтверждения выброса и граф связности оцениваются на каждом
   * integration step, а не только на snapshot'ах. Никогда не
   * останавливает прогон (события нетерминальные).
   */
  processStepEnd(
    step: number,
    timeStartS: number,
    dtS: number,
    prevPositions: readonly Vector3[],
    nextPositions: readonly Vector3[],
    nextVelocities: readonly Vector3[]
  ): { halt: false } | { halt: true; haltInfo: EventCollectorHalt };
  /**
   * Закрытые эпизоды плюс открытые (как ongoing, exitTimeS = null),
   * плюс pending-выбросы на конце прогона (если запрошены).
   * Идемпотентно: повторный вызов возвращает те же события.
   */
  finalize(options?: { finalTimeS?: number; emitPendingEjections?: boolean }): NBodyDetectionEvent[];
  /** Число обработанных шагов (для detection-метаданных). */
  readonly stepsProcessed: number;
  /** Число вычислений графа связности (для detection-метаданных). */
  readonly connectivityChecksTotal: number;
}

/**
 * Создаёт коллектор событий. Состояние эпизодов ведётся ОТДЕЛЬНО для
 * каждой пары: повторные сближения одной пары дают отдельные события.
 * Состояние кандидатов выброса — отдельно для каждого НЕ-primary тела
 * (канонический индекс); состояние связности — общий граф.
 */
export function createEventCollector(config: EventCollectorConfig): EventCollector {
  const n = config.bodies.length;
  const threshold = config.closeApproachThresholdM;
  const escape = config.escape ?? null;
  const connectivity = config.connectivity ?? null;

  interface PairInfo {
    ia: number;
    ib: number;
    idA: string;
    idB: string;
    contactRadiusM: number | null;
  }
  const pairs: PairInfo[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ra = config.bodies[i].radiusM;
      const rb = config.bodies[j].radiusM;
      const known = ra !== null && rb !== null;
      pairs.push({
        ia: i,
        ib: j,
        idA: config.bodies[i].id,
        idB: config.bodies[j].id,
        contactRadiusM: known ? ra + rb : null
      });
    }
  }

  interface Episode {
    active: boolean;
    entryTimeS: number;
    minDistanceM: number;
    minimumTimeS: number;
  }
  const episodes: Episode[] = pairs.map(() => ({
    active: false,
    entryTimeS: 0,
    minDistanceM: Infinity,
    minimumTimeS: 0
  }));

  const closedEvents: NBodyDetectionEvent[] = [];
  let stepsProcessed = 0;
  let finalized = false;

  // --- Stage 4.6.1-C: состояние выброса (по каноническим индексам) ---
  interface ActiveEjection {
    crossingTimeS: number;
    specificOrbitalEnergyAtCrossingJPerKg: number;
    radialVelocityAtCrossingMPerS: number;
  }
  const activeEjections = new Map<number, ActiveEjection>();

  // --- Stage 4.6.1-C: состояние связности ---
  // Начальное разбиение фиксируется отдельно (t = 0) и НЕ порождает
  // событий; далее граф вычисляется на каждом конце шага.
  const ids = config.bodies.map((b) => b.id);
  const masses = config.massesKg ?? [];
  let currentEdges: boolean[] | null = null;
  let currentComponents: string[][] | null = null;
  let connectivityChecksTotal = 0;
  const connectivityEnabled = connectivity !== null && masses.length === n;
  const escapeEnabled = escape !== null && masses.length === n;

  function componentsKeyOf(components: readonly string[][]): string {
    return components.map((c) => c.join('\u0000')).join('\u0001');
  }

  function establishInitialConnectivity(): void {
    if (connectivityEnabled && currentEdges === null && config.initialVelocities !== undefined) {
      currentEdges = bindingGraphEdges(
        config.initialPositions,
        config.initialVelocities,
        masses,
        connectivity!.energyToleranceJPerKg
      );
      currentComponents = componentsFromEdges(ids, currentEdges);
      connectivityChecksTotal = 1;
    }
  }

  /** Конец шага: подтверждение/отмена кандидатов и граф связности. */
  function processStepEnd(
    step: number,
    timeStartS: number,
    dtS: number,
    prevPositions: readonly Vector3[],
    nextPositions: readonly Vector3[],
    nextVelocities: readonly Vector3[]
  ): { halt: false } | { halt: true; haltInfo: EventCollectorHalt } {
    if (!escapeEnabled && !connectivityEnabled) {
      return { halt: false };
    }
    const timeEndS = timeStartS + dtS;

    // --- Выброс: условия оцениваются на КАЖДОМ шаге (не snapshots) ---
    if (escapeEnabled) {
      const esc = escape!;
      const pIdx = esc.primaryIndex;
      for (let i = 0; i < n; i++) {
        if (i === pIdx) {
          continue;
        }
        const rel0 = sub3(prevPositions[i], prevPositions[pIdx]);
        const rel1 = sub3(nextPositions[i], nextPositions[pIdx]);
        const vrel = sub3(nextVelocities[i], nextVelocities[pIdx]);
        const d1 = norm3(rel1);
        const dvl = norm3(vrel);
        const eps = (dvl * dvl) / 2 - (G * (masses[pIdx] + masses[i])) / d1;
        const vr = (rel1.x * vrel.x + rel1.y * vrel.y + rel1.z * vrel.z) / d1;
        if (!Number.isFinite(d1) || !Number.isFinite(eps) || !Number.isFinite(vr)) {
          return {
            halt: true,
            haltInfo: { kind: 'nonfinite_step_state', step, timeS: timeEndS }
          };
        }
        const active = activeEjections.get(i);
        // --- Кандидат: пересечение радиуса наружу на drift-отрезке ---
        if (active === undefined) {
          const d0 = norm3(rel0);
          if (d0 <= esc.escapeRadiusM && d1 > esc.escapeRadiusM && eps > esc.ejectionEnergyToleranceJPerKg && vr > 0) {
            const cross = segmentSphereCrossing(rel0, rel1, esc.escapeRadiusM);
            const sEntry = cross.hasRoot ? clamp01(cross.sEntry) : 0;
            const crossingTimeS = timeStartS + sEntry * dtS;
            activeEjections.set(i, {
              crossingTimeS,
              specificOrbitalEnergyAtCrossingJPerKg: eps,
              radialVelocityAtCrossingMPerS: vr
            });
            closedEvents.push({
              type: 'ejection_candidate',
              bodyId: ids[i],
              primaryBodyId: esc.primaryId,
              crossingTimeS,
              escapeRadiusM: esc.escapeRadiusM,
              specificOrbitalEnergyAtCrossingJPerKg: eps,
              radialVelocityAtCrossingMPerS: vr,
              confirmationTimeS: null,
              eventTimeS: crossingTimeS,
              cancelReason: null
            });
          }
          continue;
        }
        // --- Активный кандидат: отмена/подтверждение по приоритету ---
        if (d1 <= esc.escapeRadiusM) {
          activeEjections.delete(i);
          closedEvents.push({
            type: 'ejection_cancelled',
            bodyId: ids[i],
            primaryBodyId: esc.primaryId,
            crossingTimeS: active.crossingTimeS,
            escapeRadiusM: esc.escapeRadiusM,
            specificOrbitalEnergyAtCrossingJPerKg: active.specificOrbitalEnergyAtCrossingJPerKg,
            radialVelocityAtCrossingMPerS: active.radialVelocityAtCrossingMPerS,
            confirmationTimeS: null,
            eventTimeS: timeEndS,
            cancelReason: 'returned_within_escape_radius'
          });
        } else if (eps <= esc.ejectionEnergyToleranceJPerKg) {
          activeEjections.delete(i);
          closedEvents.push({
            type: 'ejection_cancelled',
            bodyId: ids[i],
            primaryBodyId: esc.primaryId,
            crossingTimeS: active.crossingTimeS,
            escapeRadiusM: esc.escapeRadiusM,
            specificOrbitalEnergyAtCrossingJPerKg: active.specificOrbitalEnergyAtCrossingJPerKg,
            radialVelocityAtCrossingMPerS: active.radialVelocityAtCrossingMPerS,
            confirmationTimeS: null,
            eventTimeS: timeEndS,
            cancelReason: 'energy_not_above_threshold'
          });
        } else if (vr <= 0) {
          activeEjections.delete(i);
          closedEvents.push({
            type: 'ejection_cancelled',
            bodyId: ids[i],
            primaryBodyId: esc.primaryId,
            crossingTimeS: active.crossingTimeS,
            escapeRadiusM: esc.escapeRadiusM,
            specificOrbitalEnergyAtCrossingJPerKg: active.specificOrbitalEnergyAtCrossingJPerKg,
            radialVelocityAtCrossingMPerS: active.radialVelocityAtCrossingMPerS,
            confirmationTimeS: null,
            eventTimeS: timeEndS,
            cancelReason: 'radial_velocity_not_outward'
          });
        } else if (timeEndS - active.crossingTimeS >= esc.escapeConfirmationDurationS) {
          activeEjections.delete(i);
          closedEvents.push({
            type: 'ejection_confirmed',
            bodyId: ids[i],
            primaryBodyId: esc.primaryId,
            crossingTimeS: active.crossingTimeS,
            escapeRadiusM: esc.escapeRadiusM,
            specificOrbitalEnergyAtCrossingJPerKg: active.specificOrbitalEnergyAtCrossingJPerKg,
            radialVelocityAtCrossingMPerS: active.radialVelocityAtCrossingMPerS,
            confirmationTimeS: timeEndS,
            eventTimeS: timeEndS,
            cancelReason: null
          });
        }
      }
    }

    // --- Связность: граф на каждом шаге; изменение — событие ---
    if (connectivityEnabled && config.initialVelocities !== undefined) {
      const conn = connectivity!;
      const nextEdges = bindingGraphEdges(nextPositions, nextVelocities, masses, conn.energyToleranceJPerKg);
      const nextComponents = componentsFromEdges(ids, nextEdges);
      connectivityChecksTotal += 1;
      const beforeEdges = currentEdges;
      const beforeComponents = currentComponents;
      if (beforeEdges !== null && beforeComponents !== null) {
        const sigBefore = componentsKeyOf(beforeComponents);
        const sigAfter = componentsKeyOf(nextComponents);
        if (sigBefore !== sigAfter) {
          const edgeChanges: ConnectivityEdgeChange[] = [];
          for (let p = 0; p < nextEdges.length; p++) {
            if (beforeEdges[p] !== nextEdges[p]) {
              let ia = 0;
              let ib = 0;
              let idx = 0;
              outer: for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                  if (idx === p) {
                    ia = i;
                    ib = j;
                    break outer;
                  }
                  idx += 1;
                }
              }
              edgeChanges.push({
                bodyIdA: ids[ia],
                bodyIdB: ids[ib],
                wasConnected: beforeEdges[p],
                isConnected: nextEdges[p]
              });
            }
          }
          const countBefore = beforeComponents.length;
          const countAfter = nextComponents.length;
          const eventType: ConnectivityEvent['type'] =
            countBefore === 1 && countAfter > 1
              ? 'connectivity_lost'
              : countAfter === 1 && countBefore > 1
                ? 'connectivity_restored'
                : 'connectivity_changed';
          closedEvents.push({
            type: eventType,
            eventTimeS: timeEndS,
            componentsBefore: beforeComponents.map((c) => c.slice()),
            componentsAfter: nextComponents.map((c) => c.slice()),
            componentCountBefore: countBefore,
            componentCountAfter: countAfter,
            edgeChanges,
            energyToleranceJPerKg: conn.energyToleranceJPerKg,
            criterionModel: 'pairwise_osculating_binding_energy'
          });
        }
      }
      currentEdges = nextEdges;
      currentComponents = nextComponents;
    }

    return { halt: false };
  }

  // Эпизоды, открытые уже в начальном состоянии (вход в момент t0).
  if (threshold !== null) {
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      const d0 = norm3(sub3(config.initialPositions[pair.ia], config.initialPositions[pair.ib]));
      if (Number.isFinite(d0) && d0 <= threshold) {
        episodes[p] = {
          active: true,
          entryTimeS: config.initialTimeS,
          minDistanceM: d0,
          minimumTimeS: config.initialTimeS
        };
      }
    }
  }

  function pushClosed(pair: PairInfo, thresholdM: number, ep: Episode, exitTimeS: number): void {
    closedEvents.push({
      type: 'close_approach',
      pairIdA: pair.idA,
      pairIdB: pair.idB,
      thresholdM,
      entryTimeS: ep.entryTimeS,
      minimumTimeS: ep.minimumTimeS,
      minimumDistanceM: ep.minDistanceM,
      exitTimeS,
      ongoingAtHorizon: false
    });
  }

  function processStep(
    step: number,
    timeStartS: number,
    dtS: number,
    prevPositions: readonly Vector3[],
    nextPositions: readonly Vector3[]
  ): { halt: false } | { halt: true; haltInfo: EventCollectorHalt } {
    stepsProcessed += 1;
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      const r0 = sub3(prevPositions[pair.ia], prevPositions[pair.ib]);
      const r1 = sub3(nextPositions[pair.ia], nextPositions[pair.ib]);
      const seg = segmentClosestPoint(r0, r1);
      if (!Number.isFinite(seg.minDistanceM)) {
        return { halt: true, haltInfo: { kind: 'nonfinite_geometry', step, timeS: timeStartS } };
      }

      // --- 1. Физический контакт поверхностей (терминальный) ---
      if (pair.contactRadiusM !== null && seg.minDistanceM <= pair.contactRadiusM) {
        let sContact: number;
        if (norm3(r0) <= pair.contactRadiusM) {
          // Контакт уже в начале шага (в том числе при начальном
          // перекрытии): доля шага 0, время контакта = время начала.
          sContact = 0;
        } else {
          const cross = segmentSphereCrossing(r0, r1, pair.contactRadiusM);
          sContact = cross.hasRoot ? clamp01(cross.sEntry) : seg.sStar;
        }
        return {
          halt: true,
          haltInfo: {
            kind: 'collision',
            pairIdA: pair.idA,
            pairIdB: pair.idB,
            contactRadiusM: pair.contactRadiusM,
            contactTimeS: timeStartS + sContact * dtS,
            contactStepFraction: sContact,
            minimumDistanceM: seg.minDistanceM,
            step
          }
        };
      }

      // --- 2. Численная сингулярность ньютоновской модели ---
      if (seg.minDistanceM < config.singularityThresholdM) {
        return {
          halt: true,
          haltInfo: {
            kind: 'singularity',
            pairIdA: pair.idA,
            pairIdB: pair.idB,
            distanceM: seg.minDistanceM,
            thresholdM: config.singularityThresholdM,
            timeS: timeStartS + seg.sStar * dtS,
            step
          }
        };
      }

      // --- 3. Эпизоды тесного сближения (нетерминальные) ---
      if (threshold !== null) {
        const ep = episodes[p];
        const distStart = norm3(r0);
        const distEnd = norm3(r1);
        if (seg.minDistanceM <= threshold) {
          const cross = segmentSphereCrossing(r0, r1, threshold);
          if (!ep.active) {
            // Вход в порог: в начале шага (s = 0) либо внутри отрезка
            // (меньший корень квадратичного уравнения).
            const sEntry =
              distStart <= threshold ? 0 : cross.hasRoot ? clamp01(cross.sEntry) : seg.sStar;
            ep.active = true;
            ep.entryTimeS = timeStartS + sEntry * dtS;
            ep.minDistanceM = seg.minDistanceM;
            ep.minimumTimeS = timeStartS + seg.sStar * dtS;
          } else if (seg.minDistanceM < ep.minDistanceM) {
            ep.minDistanceM = seg.minDistanceM;
            ep.minimumTimeS = timeStartS + seg.sStar * dtS;
          }
          if (distEnd > threshold) {
            // Выход из порога внутри этого же отрезка (в том числе
            // полный проход "вошёл и вышел" внутри одного шага).
            const sExit = cross.hasRoot ? clamp01(cross.sExit) : 1;
            pushClosed(pair, threshold, ep, timeStartS + sExit * dtS);
            ep.active = false;
          }
        } else if (ep.active) {
          // Защитная ветвь: для линейных отрезков активный эпизод при
          // d_min > порога недостижим (d_min ≤ расстояний на концах);
          // закрываем честно, без выдуманного времени выхода.
          pushClosed(pair, threshold, ep, timeStartS);
          ep.active = false;
        }
      }
    }
    return { halt: false };
  }

  function finalize(options?: { finalTimeS?: number; emitPendingEjections?: boolean }): NBodyDetectionEvent[] {
    if (!finalized) {
      finalized = true;
      if (threshold !== null) {
        for (let p = 0; p < pairs.length; p++) {
          const ep = episodes[p];
          if (ep.active) {
            ep.active = false;
            closedEvents.push({
              type: 'close_approach',
              pairIdA: pairs[p].idA,
              pairIdB: pairs[p].idB,
              thresholdM: threshold,
              entryTimeS: ep.entryTimeS,
              minimumTimeS: ep.minimumTimeS,
              minimumDistanceM: ep.minDistanceM,
              exitTimeS: null,
              ongoingAtHorizon: true
            });
          }
        }
      }
      // Pending-выбросы: горизонт (или прогон) закончился до
      // подтверждения; события ЕЩЁ активных кандидатов остаются в списке
      // как observed candidate + pending, НЕ как подтверждённый выброс.
      // При отказе интегратора pending НЕ создаётся (не смешивается с
      // отказом движка), сам ejection_candidate сохраняется.
      if (escapeEnabled && options?.emitPendingEjections === true) {
        const finalTimeS = options.finalTimeS;
        for (const [i, active] of [...activeEjections.entries()].sort((a, b) => a[0] - b[0])) {
          closedEvents.push({
            type: 'ejection_pending_at_horizon',
            bodyId: ids[i],
            primaryBodyId: escape!.primaryId,
            crossingTimeS: active.crossingTimeS,
            escapeRadiusM: escape!.escapeRadiusM,
            specificOrbitalEnergyAtCrossingJPerKg: active.specificOrbitalEnergyAtCrossingJPerKg,
            radialVelocityAtCrossingMPerS: active.radialVelocityAtCrossingMPerS,
            confirmationTimeS: null,
            eventTimeS: Number.isFinite(finalTimeS) ? (finalTimeS as number) : active.crossingTimeS,
            cancelReason: null
          });
        }
      }
    }
    return closedEvents.slice();
  }

  establishInitialConnectivity();

  return {
    processStep,
    processStepEnd,
    finalize,
    get stepsProcessed() {
      return stepsProcessed;
    },
    get connectivityChecksTotal() {
      return connectivityChecksTotal;
    }
  };
}

