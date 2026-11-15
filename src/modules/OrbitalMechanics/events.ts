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

/** Любое обнаруженное событие (дискриминация по полю type). */
export type NBodyDetectionEvent = CloseApproachEvent | CollisionEvent;

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
 * Детерминированный порядок событий: время (время контакта для
 * collision, время минимума для close_approach), затем приоритет типа
 * (collision раньше close_approach), затем канонические ID пары.
 */
export function sortDetectionEvents(events: readonly NBodyDetectionEvent[]): NBodyDetectionEvent[] {
  const timeOf = (e: NBodyDetectionEvent): number =>
    e.type === 'collision' ? e.contactTimeS : e.minimumTimeS;
  const priorityOf = (e: NBodyDetectionEvent): number => (e.type === 'collision' ? 0 : 1);
  return [...events].sort((x, y) => {
    const dt = timeOf(x) - timeOf(y);
    if (dt !== 0) {
      return dt;
    }
    const dp = priorityOf(x) - priorityOf(y);
    if (dp !== 0) {
      return dp;
    }
    if (x.pairIdA !== y.pairIdA) {
      return x.pairIdA < y.pairIdA ? -1 : 1;
    }
    if (x.pairIdB !== y.pairIdB) {
      return x.pairIdB < y.pairIdB ? -1 : 1;
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
    };

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
   * Закрытые эпизоды плюс открытые (как ongoing, exitTimeS = null).
   * Идемпотентно: повторный вызов возвращает те же события.
   */
  finalize(): CloseApproachEvent[];
  /** Число обработанных шагов (для detection-метаданных). */
  readonly stepsProcessed: number;
}

/**
 * Создаёт коллектор событий. Состояние эпизодов ведётся ОТДЕЛЬНО для
 * каждой пары: повторные сближения одной пары дают отдельные события.
 */
export function createEventCollector(config: EventCollectorConfig): EventCollector {
  const n = config.bodies.length;
  const threshold = config.closeApproachThresholdM;

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

  const closedEvents: CloseApproachEvent[] = [];
  let stepsProcessed = 0;
  let finalized = false;

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

  function finalize(): CloseApproachEvent[] {
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
    }
    return closedEvents.slice();
  }

  return {
    processStep,
    finalize,
    get stepsProcessed() {
      return stepsProcessed;
    }
  };
}
