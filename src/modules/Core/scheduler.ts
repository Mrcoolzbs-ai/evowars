// ============================================
// SCHEDULER - Планировщик физических процессов
// ============================================
//
// Stage 4.2.1. Детерминированный планировщик выполнения процессов
// поверх WorldClock и ProcessRegistry. Планировщик управляет
// ПОРЯДКОМ физических процессов; время продвигается только через
// WorldClock (один раз на macro-шаг); научные значения не
// выдумываются: процессы с неизвестным τ, отключённые процессы и
// процессы без решателя не запускаются.
//
// Ключевые контракты:
// - сериализуемое состояние планировщика (SchedulerBookkeeping)
//   живёт в CoreWorldState.scheduling; runtime-исполнители
//   (ProcessOperator) передаются ОТДЕЛЬНО и никогда не
//   сериализуются; скрытого состояния нет;
// - детерминизм: одинаковый вход → одинаковый выход; порядок
//   событий — по сегментированному времени (comparePoints),
//   при одинаковом времени — по sequence (стабильный tie-break);
// - НЕТ универсального dt: длительность macro-шага задаёт
//   вызывающий код; sub-cycling делит её на равные подшаги;
//   эвристика dt ≤ τ/20 — только предварительная подсказка реестра,
//   окончательный шаг выбирает конкретный solver;
// - Lie splitting: последовательное выполнение операторов;
// - Strang splitting: симметричная композиция ровно ДВУХ
//   РАЗНЫХ операторов A(dt/2) → B(dt) → A(dt/2) — не произвольный
//   порядок процессов и не два Lie-шага;
// - идентификаторы процессов одного macro-шага уникальны
//   (Stage 4.2.1.2): дублирующийся processId — и в списке
//   процессов шага, и среди переданных runtime-операторов —
//   отклоняется ДО вызова первого оператора (SchedulerError
//   'duplicate_process_id'); молчаливая перезапись оператора
//   через Map.set невозможна;
// - временной аргумент оператора — ФИЗИЧЕСКИЙ подынтервал
//   macro-шага (Stage 4.2.1.2): [intervalStartS, intervalStartS +
//   durationS) всегда лежит внутри [0, dt]; Strang: A интегрирует
//   [0, dt/2], B — [0, dt], второй A — [dt/2, dt];
// - оператор НЕ двигает мировое время: проверяется после каждого
//   вызова; нарушение → шаг отклонён (operator_moved_clock);
// - атомарность транзакции шага (Stage 4.2.3.1 — snapshot-
//   изоляция): macro-шаг выполняется на ПОЛНОЙ изолированной
//   копии состояния мира, поэтому операторы физически не могут
//   изменить объект вызывающей стороны — включая вложенные
//   bodies, reservoirs, fluxLedger и scheduling; при ошибке
//   оператора, самовольном движении часов или нарушении
//   инвариантов шаг отклоняется: возвращается ИСХОДНОЕ состояние
//   мира, мировое время не продвигается, частичное состояние не
//   фиксируется;
// - мировое время продвигается РОВНО ОДИН раз — после успеха
//   всех операторов и аудита инвариантов;
// - событие мира не теряется: ошибка обработки фиксируется
//   статусом 'failed' с причиной; повторная обработка
//   выполненного события запрещена.
// - append-only история реакций (Stage 4.2.3.3.1): записи
//   reactionLedger, существовавшие до macro-шага, неизменяемы —
//   совпадающий id не доказывает неизменности записи; разрешено
//   только добавление новых записей в конец журнала; правка,
//   удаление, перестановка старых записей и удаление журнала
//   отклоняют шаг; новые записи обязаны пройти стехиометрический
//   аудит до фиксации — шаг с новыми реакциями требует
//   запрошенного аудита инвариантов (speciesCatalog);
//
// Тесты композиции операторов доказывают правильность ПОРЯДКА
// вызовов, а не точность физического решателя: готовых
// физических solver в проекте пока нет.

import type { CoreWorldState } from './worldState';
import type { ProcessRegistry } from './processRegistry';
import { isProcessAutoRunnable, tauSeconds } from './processRegistry';
import type { FluxAuditScope, FluxTime } from './fluxLedger';
import type { SimulationClockState } from './simulationClock';
import { advance, advanceTo, comparePoints, totalElapsedSeconds } from './simulationClock';
import { isPlainRecord } from './reservoir';
import { auditWorldTransition } from './invariantAuditor';
import { reactionLedgerAppendOnlyIssues } from './reactionLedger';
import type { BoundaryCompleteness, WorldTransitionAudit } from './invariantAuditor';
import type { SpeciesCatalog } from './species';

// ============================================
// 1. ОШИБКА
// ============================================

export class SchedulerError extends Error {
  readonly code:
    | 'invalid_step'
    | 'unknown_process'
    | 'process_disabled'
    | 'process_tau_unknown'
    | 'solver_unavailable'
    | 'invalid_splitting'
    | 'duplicate_process_id'
    | 'invalid_event'
    | 'already_processed'
    | 'operator_error'
    | 'operator_moved_clock'
    | 'invalid_bookkeeping'
    | 'explicit_only_process'
    | 'not_explicit_only';
  readonly component = 'Scheduler';
  readonly processId: string | null;

  constructor(code: SchedulerError['code'], message: string, processId: string | null) {
    super('[Scheduler/' + code + '] ' + message);
    this.name = 'SchedulerError';
    this.code = code;
    this.processId = processId;
  }
}

// ============================================
// 2. СОБЫТИЯ МИРА
// ============================================

export type WorldEventStatus = 'pending' | 'processed' | 'failed';
export const WORLD_EVENT_STATUSES: readonly WorldEventStatus[] = ['pending', 'processed', 'failed'];

/**
 * Типизированная инфраструктура для будущих событий (решателей для
 * них пока НЕТ — события не выдумываются): фазовый переход,
 * исчерпание реагента, достижение границы диапазона, смена режима,
 * событие, найденное solver.
 */
export const WORLD_EVENT_TYPES: readonly string[] = [
  'phase_transition',
  'reagent_exhausted',
  'range_boundary_reached',
  'regime_change',
  'solver_detected'
];

/**
 * Событие мира. Данные события — JSON-сериализуемый словарь
 * (функции, Map/Set/Date и экземпляры классов запрещены);
 * callback-функции НЕ хранятся в состоянии мира: обработчики
 * передаются в processEvent отдельно.
 */
export interface WorldEvent {
  id: string;
  /** Момент события в сегментированном времени (порядок — comparePoints). */
  time: FluxTime;
  /** Тип события (см. WORLD_EVENT_TYPES). */
  type: string;
  /** Структурированные JSON-сериализуемые данные события. */
  data: Record<string, unknown>;
  /** Источник события (кто/что его породил). */
  source: string;
  status: WorldEventStatus;
  /** Причина неудачной обработки, если status = 'failed'. */
  failReason?: string;
  /** Последовательность: детерминированный tie-break одинакового времени. */
  sequence: number;
}

// ============================================
// 3. ДИНАМИКА ПРОЦЕССОВ И ЖУРНАЛ
// ============================================

/** Динамическое состояние процесса (НЕ определение процесса). */
export interface ProcessDynamics {
  processId: string;
  /** Последний запуск: оценка elapsed-времени, с; null — не запускался. */
  lastRunElapsedS: number | null;
  /** Следующий момент готовности: оценка elapsed-времени, с; null — не назначен. */
  nextDueElapsedS: number | null;
  macroStepsCompleted: number;
  operatorCallsCompleted: number;
}

export type StepLogPhase =
  | 'lie'
  | 'subcycle'
  | 'strang_a_half_first'
  | 'strang_b_full'
  | 'strang_a_half_second';

export const STEP_LOG_PHASES: readonly StepLogPhase[] = [
  'lie',
  'subcycle',
  'strang_a_half_first',
  'strang_b_full',
  'strang_a_half_second'
];

/** Запись журнала о выполненном (или отклонённом) вызове оператора. */
export interface SchedulerStepLogEntry {
  stepIndex: number;
  processId: string;
  phase: StepLogPhase;
  durationS: number;
  /** Начало физического подынтервала [intervalStartS, intervalStartS + durationS) внутри macro-шага [0, dt], с. */
  intervalStartS: number;
  status: 'committed' | 'rejected';
}

/**
 * Сериализуемое состояние планировщика (живёт в
 * CoreWorldState.scheduling; опционально — отсутствие означает
 * «планировщик не инициализирован»).
 */
export interface SchedulerBookkeeping {
  processDynamics: Record<string, ProcessDynamics>;
  eventQueue: WorldEvent[];
  stepLog: SchedulerStepLogEntry[];
  nextSequence: number;
  stepCount: number;
}

/** Пустое состояние планировщика. */
export function createSchedulerBookkeeping(): SchedulerBookkeeping {
  return {
    processDynamics: {},
    eventQueue: [],
    stepLog: [],
    nextSequence: 0,
    stepCount: 0
  };
}

// ============================================
// 4. ВАЛИДАЦИЯ СОСТОЯНИЯ ПЛАНИРОВЩИКА
// ============================================

function validateFluxTimeShape(t: unknown): string[] {
  if (!isPlainRecord(t)) {
    return ['time должен быть объектом-словарём {segmentIndex, localTimeS}'];
  }
  const issues: string[] = [];
  if (typeof t.segmentIndex !== 'number' || !Number.isInteger(t.segmentIndex) || t.segmentIndex < 0) {
    issues.push('time.segmentIndex должен быть неотрицательным целым');
  }
  if (typeof t.localTimeS !== 'number' || !Number.isFinite(t.localTimeS) || t.localTimeS < 0) {
    issues.push('time.localTimeS должен быть неотрицательным конечным числом');
  }
  return issues;
}

/** Рекурсивная проверка JSON-сериализуемости данных события. */
function jsonSerializableIssues(value: unknown, label: string): string[] {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return [];
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [] : [label + ': NaN/Infinity не сериализуемы'];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => jsonSerializableIssues(v, label + '[' + String(i) + ']'));
  }
  if (typeof value === 'object') {
    if (!isPlainRecord(value)) {
      return [label + ': объекты с чужим прототипом (Map/Set/Date/классы) не сериализуемы'];
    }
    return Object.entries(value).flatMap(([k, v]) => jsonSerializableIssues(v, label + '.' + k));
  }
  return [label + ': значение типа ' + typeof value + ' не сериализуемо (функции/undefined запрещены)'];
}

/**
 * Проверка формы состояния планировщика (данные могут приходить из
 * JSON). Возвращает список проблем; пустой = форма корректна.
 * Используется и валидацией CoreWorldState (код invalid_scheduling).
 */
export function validateSchedulerBookkeeping(bk: unknown): string[] {
  if (!isPlainRecord(bk)) {
    return ['состояние планировщика должно быть обычным объектом-словарём'];
  }
  const issues: string[] = [];

  if (!isPlainRecord(bk.processDynamics)) {
    issues.push('processDynamics должен быть объектом-словарём (processId → динамика)');
  } else {
    for (const [processId, dynamics] of Object.entries(bk.processDynamics)) {
      if (!isPlainRecord(dynamics)) {
        issues.push('processDynamics[' + processId + '] должен быть объектом-словарём');
        continue;
      }
      if (typeof dynamics.processId !== 'string' || dynamics.processId !== processId) {
        issues.push('processDynamics[' + processId + '].processId должен совпадать с ключом');
      }
      for (const key of ['lastRunElapsedS', 'nextDueElapsedS'] as const) {
        const v = dynamics[key];
        if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
          issues.push('processDynamics[' + processId + '].' + key + ' должен быть конечным числом или null');
        } else if (typeof v === 'number' && v < 0) {
          issues.push('processDynamics[' + processId + '].' + key + ' не может быть отрицательным elapsed-временем');
        }
      }
      for (const key of ['macroStepsCompleted', 'operatorCallsCompleted'] as const) {
        const v = dynamics[key];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          issues.push('processDynamics[' + processId + '].' + key + ' должен быть неотрицательным целым');
        }
      }
    }
  }

  let maxEventSequence = -1;
  if (!Array.isArray(bk.eventQueue)) {
    issues.push('eventQueue должен быть массивом событий');
  } else {
    const seenEventIds = new Set<string>();
    const seenEventSequences = new Set<number>();
    bk.eventQueue.forEach((event, index) => {
      const label = 'eventQueue[' + String(index) + ']';
      if (!isPlainRecord(event)) {
        issues.push(label + ' должен быть объектом-словарём');
        return;
      }
      if (typeof event.id !== 'string' || event.id.trim() === '') {
        issues.push(label + ': id должен быть непустой строкой');
      } else if (seenEventIds.has(event.id)) {
        issues.push(label + ': дублирующийся id события «' + event.id + '»');
      } else {
        seenEventIds.add(event.id);
      }
      for (const issue of validateFluxTimeShape(event.time)) {
        issues.push(label + ': ' + issue);
      }
      if (typeof event.type !== 'string' || event.type.trim() === '') {
        issues.push(label + ': type должен быть непустой строкой');
      }
      if (!isPlainRecord(event.data)) {
        issues.push(label + ': data должен быть объектом-словарём');
      } else {
        for (const issue of jsonSerializableIssues(event.data, label + '.data')) {
          issues.push(issue);
        }
      }
      if (typeof event.source !== 'string' || event.source.trim() === '') {
        issues.push(label + ': source должен быть непустой строкой');
      }
      if (typeof event.status !== 'string' || !(WORLD_EVENT_STATUSES as readonly string[]).includes(event.status)) {
        issues.push(label + ': status должен быть одним из: ' + WORLD_EVENT_STATUSES.join(', '));
      }
      if (event.failReason !== undefined && (typeof event.failReason !== 'string' || event.failReason.trim() === '')) {
        issues.push(label + ': failReason должен быть непустой строкой, если задан');
      }
      if (event.status === 'failed' && (typeof event.failReason !== 'string' || event.failReason.trim() === '')) {
        issues.push(label + ': событие failed обязано содержать непустой failReason');
      }
      if (event.status !== 'failed' && event.failReason !== undefined) {
        issues.push(label + ': failReason допустим только при status=failed');
      }
      if (typeof event.sequence !== 'number' || !Number.isInteger(event.sequence) || event.sequence < 0) {
        issues.push(label + ': sequence должен быть неотрицательным целым');
      } else {
        if (seenEventSequences.has(event.sequence)) {
          issues.push(label + ': дублирующийся sequence события ' + String(event.sequence));
        } else {
          seenEventSequences.add(event.sequence);
        }
        maxEventSequence = Math.max(maxEventSequence, event.sequence);
      }
    });
  }

  if (!Array.isArray(bk.stepLog)) {
    issues.push('stepLog должен быть массивом записей шагов');
  } else {
    bk.stepLog.forEach((entry, index) => {
      const label = 'stepLog[' + String(index) + ']';
      if (!isPlainRecord(entry)) {
        issues.push(label + ' должен быть объектом-словарём');
        return;
      }
      if (typeof entry.stepIndex !== 'number' || !Number.isInteger(entry.stepIndex) || entry.stepIndex < 0) {
        issues.push(label + ': stepIndex должен быть неотрицательным целым');
      }
      if (typeof entry.processId !== 'string' || entry.processId.trim() === '') {
        issues.push(label + ': processId должен быть непустой строкой');
      }
      if (typeof entry.phase !== 'string' || !(STEP_LOG_PHASES as readonly string[]).includes(entry.phase)) {
        issues.push(label + ': phase должен быть одним из: ' + STEP_LOG_PHASES.join(', '));
      }
      if (typeof entry.durationS !== 'number' || !Number.isFinite(entry.durationS) || entry.durationS <= 0) {
        issues.push(label + ': durationS должен быть положительным конечным числом');
      }
      if (typeof entry.intervalStartS !== 'number' || !Number.isFinite(entry.intervalStartS) || entry.intervalStartS < 0) {
        issues.push(label + ': intervalStartS должен быть неотрицательным конечным числом');
      }
      if (entry.status !== 'committed' && entry.status !== 'rejected') {
        issues.push(label + ': status должен быть committed или rejected');
      }
    });
  }

  if (typeof bk.nextSequence !== 'number' || !Number.isInteger(bk.nextSequence) || bk.nextSequence < 0) {
    issues.push('nextSequence должен быть неотрицательным целым');
  } else if (maxEventSequence >= bk.nextSequence) {
    issues.push(
      'nextSequence должен быть строго больше всех уже назначенных sequence (max=' +
        String(maxEventSequence) + ', next=' + String(bk.nextSequence) + ')'
    );
  }
  if (typeof bk.stepCount !== 'number' || !Number.isInteger(bk.stepCount) || bk.stepCount < 0) {
    issues.push('stepCount должен быть неотрицательным целым');
  }
  return issues;
}

// ============================================
// 5. ОЧЕРЕДЬ СОБЫТИЙ
// ============================================

/** Поставить событие в очередь (иммутабельно; sequence назначается автоматически). */
export function enqueueEvent(
  bk: SchedulerBookkeeping,
  event: { id: string; time: FluxTime; type: string; data: Record<string, unknown>; source: string }
): SchedulerBookkeeping {
  const bookkeepingIssues = validateSchedulerBookkeeping(bk);
  if (bookkeepingIssues.length > 0) {
    throw new SchedulerError(
      'invalid_bookkeeping',
      'нельзя поставить событие в некорректное состояние Scheduler: ' + bookkeepingIssues.join('; '),
      null
    );
  }
  const issues: string[] = [];
  if (typeof event.id !== 'string' || event.id.trim() === '') {
    issues.push('id события должен быть непустой строкой');
  }
  if (bk.eventQueue.some((e) => e.id === event.id)) {
    issues.push('событие «' + String(event.id) + '» уже в очереди: повторная постановка запрещена');
  }
  issues.push(...validateFluxTimeShape(event.time));
  if (typeof event.type !== 'string' || event.type.trim() === '') {
    issues.push('type события должен быть непустой строкой');
  }
  if (!isPlainRecord(event.data)) {
    issues.push('data события должен быть объектом-словарём');
  } else {
    issues.push(...jsonSerializableIssues(event.data, 'data'));
  }
  if (typeof event.source !== 'string' || event.source.trim() === '') {
    issues.push('source события должен быть непустой строкой');
  }
  if (issues.length > 0) {
    throw new SchedulerError(
      'invalid_event',
      'событие некорректно: ' + issues.join('; '),
      typeof event.id === 'string' ? event.id : null
    );
  }
  let dataSnapshot: Record<string, unknown>;
  try {
    // Ownership of nested JSON data transfers to the queue as a deep
    // snapshot. Keeping the caller's object would let later edits mutate
    // an already-enqueued event without passing through Scheduler APIs.
    dataSnapshot = structuredClone(event.data);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new SchedulerError(
      'invalid_event',
      'data события не удалось изолировать глубоким снимком: ' + reason,
      event.id
    );
  }
  const worldEvent: WorldEvent = {
    id: event.id,
    time: { segmentIndex: event.time.segmentIndex, localTimeS: event.time.localTimeS },
    type: event.type,
    data: dataSnapshot,
    source: event.source,
    status: 'pending',
    sequence: bk.nextSequence
  };
  return {
    ...bk,
    eventQueue: [...bk.eventQueue, worldEvent],
    nextSequence: bk.nextSequence + 1
  };
}

/** Все события очереди в детерминированном порядке (время, затем sequence). */
export function sortedEvents(bk: SchedulerBookkeeping): readonly WorldEvent[] {
  // Return detached values, not queue-owned references. A readonly
  // type only protects TypeScript callers, not nested runtime data.
  return bk.eventQueue.map((event) => structuredClone(event)).sort((a, b) => {
    const byTime = comparePoints(a.time, b.time);
    if (byTime !== 0) return byTime;
    return a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0;
  });
}

/** Ожидающие события в детерминированном порядке. */
export function pendingEvents(bk: SchedulerBookkeeping): readonly WorldEvent[] {
  return sortedEvents(bk).filter((e) => e.status === 'pending');
}

/** Момент следующего события (null — очередь пуста или всё обработано). */
export function nextEventTime(bk: SchedulerBookkeeping): FluxTime | null {
  return pendingEvents(bk)[0]?.time ?? null;
}

/** События, срок которых наступил (момент события не позже now). */
export function dueEvents(bk: SchedulerBookkeeping, nowPoint: FluxTime): readonly WorldEvent[] {
  return pendingEvents(bk).filter((e) => comparePoints(e.time, nowPoint) <= 0);
}

/** Результат обработки события. */
export interface EventProcessingResult {
  bookkeeping: SchedulerBookkeeping;
  status: 'processed' | 'failed';
  failReason?: string;
}

/**
 * Обработать событие ОДИН раз: повторная обработка выполненного
 * события — ошибка already_processed. Ошибка обработчика НЕ теряет
 * событие: оно помечается 'failed' с причиной (failReason).
 */
export function processEvent(
  bk: SchedulerBookkeeping,
  eventId: string,
  handler: (event: WorldEvent) => void
): EventProcessingResult {
  const bookkeepingIssues = validateSchedulerBookkeeping(bk);
  if (bookkeepingIssues.length > 0) {
    throw new SchedulerError(
      'invalid_bookkeeping',
      'нельзя обработать событие в некорректном состоянии Scheduler: ' + bookkeepingIssues.join('; '),
      eventId
    );
  }
  const index = bk.eventQueue.findIndex((e) => e.id === eventId);
  if (index === -1) {
    throw new SchedulerError('invalid_event', 'событие «' + eventId + '» не найдено в очереди', eventId);
  }
  const event = bk.eventQueue[index];
  if (event.status !== 'pending') {
    throw new SchedulerError(
      'already_processed',
      'событие «' + eventId + '» уже обработано (status: ' + event.status + '): повторная обработка запрещена',
      eventId
    );
  }
  try {
    // A handler receives a detached event snapshot. It may inspect or
    // annotate its local copy, but cannot mutate the persisted queue row.
    handler(structuredClone(event));
  } catch (error) {
    const rawReason = error instanceof Error ? error.message : String(error);
    const reason = rawReason.trim() === ''
      ? 'обработчик завершился ошибкой без диагностического сообщения'
      : rawReason;
    const queue = [...bk.eventQueue];
    queue[index] = { ...event, status: 'failed', failReason: reason };
    return { bookkeeping: { ...bk, eventQueue: queue }, status: 'failed', failReason: reason };
  }
  const queue = [...bk.eventQueue];
  queue[index] = { ...event, status: 'processed' };
  return { bookkeeping: { ...bk, eventQueue: queue }, status: 'processed' };
}

// ============================================
// 6. РАСПИСАНИЯ ПРОЦЕССОВ
// ============================================

/**
 * Назначить следующий момент готовности процесса (расписание;
 * иммутабельно). nextDueElapsedS — оценка elapsed-времени, с;
 * null — снять расписание.
 */
export function scheduleProcess(
  bk: SchedulerBookkeeping,
  processId: string,
  nextDueElapsedS: number | null
): SchedulerBookkeeping {
  if (typeof processId !== 'string' || processId.trim() === '') {
    throw new SchedulerError('invalid_bookkeeping', 'processId должен быть непустой строкой', processId ?? null);
  }
  if (nextDueElapsedS !== null && (!Number.isFinite(nextDueElapsedS) || nextDueElapsedS < 0)) {
    throw new SchedulerError(
      'invalid_bookkeeping',
      'nextDueElapsedS должен быть неотрицательным конечным числом или null',
      processId
    );
  }
  const dynamics: ProcessDynamics = bk.processDynamics[processId] ?? {
    processId,
    lastRunElapsedS: null,
    nextDueElapsedS: null,
    macroStepsCompleted: 0,
    operatorCallsCompleted: 0
  };
  return {
    ...bk,
    processDynamics: { ...bk.processDynamics, [processId]: { ...dynamics, nextDueElapsedS } }
  };
}

/**
 * Готовые к запуску процессы: срок наступил (nextDueElapsedS не
 * позже nowElapsedS), процесс auto-runnable и runtime-оператор
 * передан. Для autonomous требуется известное τ; для
 * state_dependent — обязательный runtime proposeStep(); explicit_only
 * исключён. Порядок детерминирован (сортировка по id).
 */
export function readyProcessIds(
  bk: SchedulerBookkeeping,
  registry: ProcessRegistry,
  operators: readonly ProcessOperator[],
  nowElapsedS: number
): readonly string[] {
  const operatorById = new Map(operators.map((operator) => [operator.processId, operator]));
  const ready: string[] = [];
  for (const [processId, dynamics] of Object.entries(bk.processDynamics)) {
    if (dynamics.nextDueElapsedS === null) continue;
    if (dynamics.nextDueElapsedS > nowElapsedS) continue;
    const descriptor = registry.get(processId);
    if (descriptor === null || !isProcessAutoRunnable(descriptor)) continue;
    // Explicit-only операции не попадают в автоматическую очередь.
    if (descriptor.executionMode === 'explicit_only') continue;
    const operator = operatorById.get(processId);
    if (operator === undefined) continue;
    // State-dependent процесс доступен, только если runtime solver
    // умеет предложить ограничение шага для актуального состояния.
    if (descriptor.executionMode === 'state_dependent' && typeof operator.proposeStep !== 'function') continue;
    ready.push(processId);
  }
  return ready.sort();
}

// ============================================
// 7. MACRO-ШАГ ПЛАНИРОВЩИКА
// ============================================

/**
 * Runtime-оценка допустимого macro-шага state-dependent процесса.
 * durationS — верхняя граница длительности, безопасная для текущего
 * состояния и не превышающая запрошенный вызывающей стороной максимум.
 * characteristicTimeS, если известна решателю, — фактический
 * state-dependent масштаб времени; неизвестное не заменяется числом.
 * method и diagnostics сохраняют объяснение принятого решения.
 */
export interface ProcessEventProposal {
  /** Globally unique event identity within this world's SchedulerBookkeeping. */
  id: string;
  /** Event time relative to the start of the current macro-step, seconds. */
  offsetS: number;
  type: string;
  data: Record<string, unknown>;
}

export interface ProcessStepProposal {
  durationS: number;
  method: string;
  characteristicTimeS?: number;
  diagnostics?: readonly string[];
  /** Root/event detections made by this solver within its proposed interval. */
  events?: readonly ProcessEventProposal[];
}

/** Сводка выбора длительности macro-шага. */
export interface MacroStepSizeReport {
  requestedDurationS: number;
  effectiveDurationS: number;
  /** Процессы, задавшие минимальное ограничение, только когда шаг сокращён. */
  limitingProcessIds: readonly string[];
  /** Ближайшее событие текущего временного сегмента, на котором остановлен шаг. */
  eventBoundary?: { eventId: string; time: FluxTime };
  proposals: readonly (ProcessStepProposal & { processId: string })[];
  diagnostics: readonly string[];
}

/**
 * Runtime-исполнитель процесса. Оператор получает мир и ФИЗИЧЕСКИЙ
 * подынтервал macro-шага: интервал [intervalStartS,
 * intervalStartS + durationS), с, всегда лежит внутри [0, dt].
 * Семантика по splitting (Stage 4.2.1.2): Lie — каждый оператор
 * интегрирует [0, dt] (sub-cycling — последовательные подшаги,
 * покрывающие [0, dt]); Strang — A(dt/2) интегрирует [0, dt/2],
 * B(dt) интегрирует [0, dt], второй A(dt/2) — [dt/2, dt].
 *
 * State-dependent оператор обязан реализовать proposeStep(). Перед
 * применением Scheduler вызывает его на ИЗОЛИРОВАННОМ снимке мира;
 * результат ограничивает запрошенный macro-шаг сверху. При нескольких
 * таких процессах выбирается минимальное предложение. Некорректное
 * предложение или ошибка callback отклоняют транзакцию до apply().
 * Оператор apply возвращает НОВОЕ состояние мира, НЕ двигает часы
 * (проверяется; нарушение отклоняет шаг); runtime-код не сериализуется.
 */
export interface ProcessOperator {
  processId: string;
  /** Предложить максимальный допустимый macro-шаг для текущего состояния. */
  proposeStep?(
    world: Readonly<CoreWorldState>,
    requestedMaximumDurationS: number
  ): ProcessStepProposal;
  apply(world: CoreWorldState, durationS: number, intervalStartS: number): CoreWorldState;
}

export type SplittingMode = 'lie' | 'strang';

/** Настройки аудита инвариантов macro-шага (аудит опционален). */
export interface MacroStepAuditOptions {
  speciesCatalog: SpeciesCatalog;
  boundary: BoundaryCompleteness;
  tolerance?: number;
  scope?: FluxAuditScope;
}

export interface MacroStepOptions {
  /**
   * Запрошенная максимальная длительность macro-шага, с. Если среди
   * процессов есть state_dependent-решатели, фактический шаг может
   * быть строго меньше по их runtime-предложениям; Scheduler никогда
   * не увеличивает запрошенную длительность.
   */
  durationS: number;
  splitting: SplittingMode;
  /** Процессы шага; по умолчанию — операторы, отсортированные по id. */
  processIds?: readonly string[];
  /** Число подшагов (sub-cycling) для Lie splitting; по умолчанию 1. */
  subCycles?: number;
  /** Аудит инвариантов до фиксации нового состояния. */
  audit?: MacroStepAuditOptions;
  /**
   * Stage 4.2.3.3: явный пользовательский запуск дискретного процесса
   * (executionMode = 'explicit_only'). Требования к такому шагу:
   * - processId обязан ссылаться на explicit_only-процесс реестра
   *   (обычный автономный процесс так запустить нельзя: обход
   *   τ-контроля запрещён — ошибка 'not_explicit_only');
   * - splitting = 'lie', subCycles = 1, ровно один процесс шага
   *   (сам explicit.processId): дискретная операция выполняется один
   *   раз за macro-шаг;
   * - τ процесса НЕ требуется и НЕ выдумывается: длительность шага
   *   задаёт вызывающая сторона через durationS (фактическая
   *   длительность модельного шага, а не характерное время реакции).
   *
   * Обратно совместимо: без поля поведение runMacroStep неизменно.
   */
  explicit?: { processId: string };
}

export interface MacroStepResult {
  status: 'committed' | 'rejected';
  /** Новое состояние при committed; ИСХОДНОЕ состояние при rejected. */
  world: CoreWorldState;
  bookkeeping: SchedulerBookkeeping;
  log: readonly SchedulerStepLogEntry[];
  audit?: WorldTransitionAudit;
  /** Фактический выбор длительности; присутствует после разрешения предложений. */
  stepSize?: MacroStepSizeReport;
  diagnostics: readonly string[];
}

function clocksEqual(a: SimulationClockState, b: SimulationClockState): boolean {
  return (
    a.segmentIndex === b.segmentIndex &&
    a.localTimeS === b.localTimeS &&
    a.priorSegmentsS === b.priorSegmentsS &&
    a.stepCount === b.stepCount &&
    a.representableStepS === b.representableStepS
  );
}

/**
 * Рабочий снимок состояния мира для macro-шага (Stage 4.2.3.1 —
 * snapshot-изоляция).
 *
 * CoreWorldState — JSON-сериализуемые данные: plain-объекты,
 * массивы и примитивы (Map/Set/Date/классы/функции запрещены
 * валидацией данных событий и Storage), поэтому structuredClone
 * даёт полную изолированную копию всех вложенных объектов —
 * bodies и bodies[].properties, reservoirs и
 * reservoirs[].material.entries, reservoirs[].energy,
 * fluxLedger.records и их subject, reactionLedger.records
 * (Stage 4.2.3.3), scheduling (eventQueue, processDynamics,
 * stepLog) и другие поля — без изменения или
 * потери значений. JSON-раунд-трип (JSON.parse(JSON.stringify(
 * ...))) для клонирования НЕ используется: он молча теряет и
 * искажает значения (undefined-поля, -0, нестроковые ключи) и
 * может скрыть некорректное состояние.
 *
 * Ошибка клонирования (например, несериализуемое значение в
 * состоянии) пробрасывается вызывающему коду runMacroStep для
 * контролируемого отказа шага ДО запуска первого оператора:
 * исходное состояние остаётся нетронутым.
 */
function snapshotWorldState(world: CoreWorldState): CoreWorldState {
  return structuredClone(world);
}

/**
 * Выполнить macro-шаг планировщика.
 *
 * Lie: операторы выполняются последовательно (каждый с полной
 * длительностью шага; при subCycles > 1 — подшагами равной длины).
 *
 * Strang: ровно два оператора в симметричном порядке
 * A(dt/2) → B(dt) → A(dt/2); sub-cycling при Strang запрещён.
 *
 * Идентификаторы процессов одного macro-шага уникальны
 * (Stage 4.2.1.2): дубликат processId — в opts.processIds или среди
 * переданных операторов — SchedulerError 'duplicate_process_id'
 * ДО выполнения первого оператора; перезапись оператора невозможна.
 *
 * Временные аргументы операторов — физические подынтервалы внутри
 * [0, dt] (Stage 4.2.1.2): Lie без sub-cycling даёт каждому
 * оператору [0, dt]; sub-cycling — последовательные подшаги
 * [i·dt/n, (i+1)·dt/n); Strang — A: [0, dt/2], B: [0, dt],
 * второй A: [dt/2, dt]. Выход за границы macro-шага невозможен.
 *
 * Snapshot-изоляция (Stage 4.2.3.1): macro-шаг выполняется на
 * полной изолированной копии входного world. Первый оператор
 * получает рабочую копию; результат успешного оператора
 * становится состоянием для следующего. Объект вызывающей
 * стороны остаётся неизменным на протяжении всего выполнения:
 * мутации оператора (включая вложенные структуры) физически не
 * могут достичь исходного состояния, а при ошибке или отклонении
 * шага рабочий снимок просто отбрасывается. Если снимок создать
 * невозможно (неклонируемое значение), шаг завершается
 * контролируемым отказом ДО вызова первого оператора.
 *
 * Append-only журнал реакций (Stage 4.2.3.3.1): записи, существовавшие
 * до шага, остаются неизменными — содержимое, порядок и количество;
 * разрешено только добавление новых записей в конец. Нарушение
 * (правка при сохранённом id, удаление, перестановка, удаление
 * журнала) отклоняет шаг ещё до аудита. Новые реакционные записи
 * требуют запрошенного аудита инвариантов (speciesCatalog): без
 * него шаг с новыми реакциями отклоняется — стехиометрический
 * аудит новых транзакций обязателен до фиксации.
 *
 * Мировое время продвигается РОВНО один раз — после успеха всех
 * операторов и (если запрошен) аудита. Любая ошибка оператора,
 * самовольное продвижение часов оператором или нарушение
 * обязательных инвариантов отклоняют шаг: возвращается исходное
 * состояние, время не движется, частичное состояние не фиксируется.
 *
 * Явный запуск дискретного процесса (Stage 4.2.3.3,
 * opts.explicit.processId): выполняется ровно один оператор
 * explicit_only-процесса один раз за шаг (Lie, subCycles = 1,
 * единственный processId). τ процесса НЕ проверяется и НЕ
 * выдумывается: у дискретной операции нет физически установленного
 * характерного времени; длительность шага — фактическая
 * opts.durationS, переданная вызывающей стороной. Автономные
 * процессы сохраняют прежнюю семантику: числовое τ обязательно.
 */
export function runMacroStep(
  world: CoreWorldState,
  registry: ProcessRegistry,
  operators: readonly ProcessOperator[],
  opts: MacroStepOptions
): MacroStepResult {
  const originalBk: SchedulerBookkeeping = world.scheduling ?? createSchedulerBookkeeping();
  const stepIndex = originalBk.stepCount;
  const bookkeepingIssues = validateSchedulerBookkeeping(originalBk);
  if (bookkeepingIssues.length > 0) {
    throw new SchedulerError(
      'invalid_bookkeeping',
      'состояние Scheduler отклонено до macro-step: ' + bookkeepingIssues.join('; '),
      null
    );
  }

  if (!Number.isFinite(opts.durationS) || opts.durationS <= 0) {
    throw new SchedulerError('invalid_step', 'durationS должен быть положительным конечным числом, получено ' + String(opts.durationS), null);
  }
  const subCycles = opts.subCycles ?? 1;
  if (!Number.isInteger(subCycles) || subCycles < 1) {
    throw new SchedulerError('invalid_step', 'subCycles должен быть целым числом не меньше 1, получено ' + String(opts.subCycles), null);
  }
  if (opts.splitting === 'strang' && subCycles > 1) {
    throw new SchedulerError(
      'invalid_splitting',
      'sub-cycling несовместим со Strang splitting: симметричная композиция A(dt/2) → B(dt) → A(dt/2) не делится на подшаги',
      null
    );
  }
  const processIds: string[] =
    opts.processIds !== undefined ? [...opts.processIds] : operators.map((o) => o.processId).sort();
  if (processIds.length === 0) {
    throw new SchedulerError('invalid_step', 'macro-шаг требует хотя бы один процесс: не заданы ни processIds, ни операторы', null);
  }
  // --- runtime-операторы: дубликаты processId отклоняются явно,
  // молчаливая перезапись через Map.set невозможна (4.2.1.2) ---
  const operatorByProcess = new Map<string, ProcessOperator>();
  for (const operator of operators) {
    if (operatorByProcess.has(operator.processId)) {
      throw new SchedulerError(
        'duplicate_process_id',
        'runtime-оператор с processId «' + operator.processId + '» передан планировщику более одного раза: молчаливая перезапись оператора запрещена',
        operator.processId
      );
    }
    operatorByProcess.set(operator.processId, operator);
  }
  // --- идентификаторы процессов шага уникальны (4.2.1.2):
  // дубликат processId — не второй оператор; отклоняется до
  // выполнения первого оператора ---
  const seenStepProcessIds = new Set<string>();
  for (const processId of processIds) {
    if (seenStepProcessIds.has(processId)) {
      throw new SchedulerError(
        'duplicate_process_id',
        'processId «' + processId + '» повторяется в списке процессов macro-шага: идентификаторы одного macro-шага уникальны, дубликат — не второй оператор',
        processId
      );
    }
    seenStepProcessIds.add(processId);
  }
  if (opts.splitting === 'strang' && processIds.length !== 2) {
    throw new SchedulerError(
      'invalid_splitting',
      'Strang splitting определён ровно для двух операторов A(dt/2) → B(dt) → A(dt/2); получено процессов: ' +
        String(processIds.length) + '. Для одного процесса используйте Lie splitting',
      null
    );
  }
  // --- Stage 4.2.3.3: явный запуск дискретного процесса ---
  // Явно инициируемая операция выполняется ОДНИМ оператором один раз
  // за macro-шаг: Lie splitting, без sub-cycling, ровно один процесс
  // шага — тот, что назван в opts.explicit.processId.
  const explicitProcessId = opts.explicit?.processId ?? null;
  if (explicitProcessId !== null) {
    if (opts.splitting === 'strang') {
      throw new SchedulerError(
        'invalid_splitting',
        'явный запуск дискретного процесса «' + explicitProcessId + '» выполняется одним оператором (Lie splitting): Strang-композиция к дискретной операции неприменима',
        explicitProcessId
      );
    }
    if (subCycles > 1) {
      throw new SchedulerError(
        'invalid_step',
        'явный запуск дискретного процесса «' + explicitProcessId + '» выполняется ровно один раз за macro-шаг: sub-cycling запрещён',
        explicitProcessId
      );
    }
    if (processIds.length !== 1 || processIds[0] !== explicitProcessId) {
      throw new SchedulerError(
        'invalid_step',
        'явный запуск требует ровно один процесс шага — «' + explicitProcessId + '»; получено: ' + processIds.join(', '),
        explicitProcessId
      );
    }
  }
  for (const processId of processIds) {
    const descriptor = registry.get(processId);
    if (descriptor === null) {
      throw new SchedulerError('unknown_process', 'процесс «' + processId + '» не зарегистрирован', processId);
    }
    if (!descriptor.enabled) {
      throw new SchedulerError('process_disabled', 'процесс «' + processId + '» отключён (enabled = false): автоматический запуск запрещён', processId);
    }
    if (explicitProcessId === processId) {
      // Явно инициируемая дискретная операция (Stage 4.2.3.3): τ
      // процесса НЕ требуется и НЕ выдумывается — длительность шага
      // задаёт вызывающая сторона (opts.durationS). Такой запуск
      // доступен ТОЛЬКО explicit_only-процессам: обычный автономный
      // процесс нельзя запустить в обход обязательного числового τ.
      if (descriptor.executionMode !== 'explicit_only') {
        throw new SchedulerError(
          'not_explicit_only',
          'процесс «' + processId + '» не является явно инициируемой дискретной операцией (executionMode ≠ explicit_only): явный запуск без числового τ доступен только explicit_only-процессам',
          processId
        );
      }
    } else if (descriptor.executionMode === 'state_dependent') {
      // τ не требуется: выбранная state-dependent семантика требует
      // обязательного runtime-предложения, привязанного к состоянию.
      const operator = operatorByProcess.get(processId);
      if (operator === undefined || typeof operator.proposeStep !== 'function') {
        throw new SchedulerError(
          'solver_unavailable',
          'процесс «' + processId + '» объявлен state_dependent, но runtime-оператор не предоставляет proposeStep(): автоматический шаг не определён',
          processId
        );
      }
    } else {
      // Обычный autonomous-путь по-прежнему требует числовое τ.
      if (descriptor.executionMode === 'explicit_only') {
        throw new SchedulerError(
          'explicit_only_process',
          'процесс «' + processId + '» — явно инициируемая дискретная операция (executionMode = explicit_only) без установленного числового τ: автоматический запуск запрещён; используйте opts.explicit с processId',
          processId
        );
      }
      if (tauSeconds(descriptor.tau) === null) {
        throw new SchedulerError(
          'process_tau_unknown',
          'процесс «' + processId + '» не имеет пригодного числового характерного времени τ (требуется строго положительное конечное число секунд): шаг процесса не определяется',
          processId
        );
      }
    }
    if (descriptor.solverAvailability !== 'available') {
      throw new SchedulerError(
        'solver_unavailable',
        'процесс «' + processId + '»: численный решатель недоступен (статус: ' + descriptor.solverAvailability + ')',
        processId
      );
    }
  }
  for (const processId of processIds) {
    if (!operatorByProcess.has(processId)) {
      throw new SchedulerError('solver_unavailable', 'процесс «' + processId + '»: runtime-оператор не передан планировщику', processId);
    }
  }

  // --- Stage 4.2: изолированный снимок и state-dependent выбор dt ---
  // Callback-предложения не должны мутировать ни исходный мир, ни
  // рабочий снимок, на котором будут применены операторы. Каждый
  // solver получает собственную глубокую копию исходного состояния.
  let working: CoreWorldState;
  try {
    working = snapshotWorldState(world);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: 'rejected',
      world,
      bookkeeping: originalBk,
      log: [],
      diagnostics: [
        'не удалось создать рабочий снимок состояния мира: ' +
          reason +
          ' — шаг отклонён до вызова solver-предложений и операторов, состояние мира не изменено'
      ]
    };
  }

  const proposals: Array<ProcessStepProposal & { processId: string }> = [];
  const proposalDiagnostics: string[] = [];
  const currentPoint: FluxTime = {
    segmentIndex: world.clock.segmentIndex,
    localTimeS: world.clock.localTimeS
  };
  const proposedEventIds = new Set(originalBk.eventQueue.map((event) => event.id));
  const proposedEvents: Array<ProcessEventProposal & { processId: string; time: FluxTime }> = [];
  let effectiveDurationS = opts.durationS;
  for (const processId of processIds) {
    const descriptor = registry.get(processId);
    const operator = operatorByProcess.get(processId);
    if (descriptor?.executionMode !== 'state_dependent') continue;
    if (operator === undefined || typeof operator.proposeStep !== 'function') {
      throw new SchedulerError(
        'solver_unavailable',
        'процесс «' + processId + '» объявлен state_dependent, но runtime proposeStep() отсутствует',
        processId
      );
    }
    let proposal: ProcessStepProposal;
    try {
      proposal = operator.proposeStep(snapshotWorldState(working), opts.durationS);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        status: 'rejected',
        world,
        bookkeeping: originalBk,
        log: [],
        diagnostics: [
          'state-dependent solver-предложение процесса «' + processId + '» завершилось ошибкой: ' + reason +
            ' — оператор apply не вызван, состояние мира не изменено'
        ]
      };
    }
    const raw = proposal as unknown as Record<string, unknown>;
    const proposalProblems: string[] = [];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      proposalProblems.push('ожидается объект ProcessStepProposal');
    } else {
      if (
        typeof raw.durationS !== 'number' ||
        !Number.isFinite(raw.durationS) ||
        raw.durationS <= 0 ||
        raw.durationS > opts.durationS
      ) {
        proposalProblems.push(
          'durationS должен быть конечным положительным числом не больше запрошенного максимума ' +
            opts.durationS + ' с'
        );
      }
      if (typeof raw.method !== 'string' || raw.method.trim() === '') {
        proposalProblems.push('method должен быть непустой строкой');
      }
      if (
        raw.characteristicTimeS !== undefined &&
        (typeof raw.characteristicTimeS !== 'number' ||
          !Number.isFinite(raw.characteristicTimeS) ||
          raw.characteristicTimeS <= 0)
      ) {
        proposalProblems.push('characteristicTimeS, если задано, должно быть конечным строго положительным временем в секундах');
      }
      if (
        raw.diagnostics !== undefined &&
        (!Array.isArray(raw.diagnostics) || raw.diagnostics.some((item) => typeof item !== 'string'))
      ) {
        proposalProblems.push('diagnostics, если заданы, должны быть массивом строк');
      }
    }

    const normalizedEvents: Array<ProcessEventProposal & { time: FluxTime }> = [];
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && raw.events !== undefined) {
      if (!Array.isArray(raw.events)) {
        proposalProblems.push('events, если заданы, должны быть массивом ProcessEventProposal');
      } else {
        raw.events.forEach((candidate, index) => {
          const eventLabel = 'events[' + String(index) + ']';
          if (!isPlainRecord(candidate)) {
            proposalProblems.push(eventLabel + ' должен быть объектом-словарём');
            return;
          }
          if (typeof candidate.id !== 'string' || candidate.id.trim() === '') {
            proposalProblems.push(eventLabel + '.id должен быть непустой строкой');
          } else if (proposedEventIds.has(candidate.id)) {
            proposalProblems.push(eventLabel + ': дублирующийся id события «' + candidate.id + '»');
          }
          if (
            typeof candidate.offsetS !== 'number' ||
            !Number.isFinite(candidate.offsetS) ||
            candidate.offsetS <= 0
          ) {
            proposalProblems.push(eventLabel + '.offsetS должен быть конечным строго положительным временем в секундах');
          } else if (
            typeof raw.durationS === 'number' &&
            Number.isFinite(raw.durationS) &&
            raw.durationS > 0 &&
            candidate.offsetS > raw.durationS
          ) {
            proposalProblems.push(eventLabel + '.offsetS выходит за предложенный интервал процесса');
          }
          if (typeof candidate.type !== 'string' || candidate.type.trim() === '') {
            proposalProblems.push(eventLabel + '.type должен быть непустой строкой');
          }
          if (!isPlainRecord(candidate.data)) {
            proposalProblems.push(eventLabel + '.data должен быть JSON-словарём');
          } else {
            const dataIssues = jsonSerializableIssues(candidate.data, eventLabel + '.data');
            if (dataIssues.length > 0) {
              proposalProblems.push(...dataIssues);
            }
          }

          if (
            typeof candidate.id !== 'string' || candidate.id.trim() === '' ||
            proposedEventIds.has(candidate.id) ||
            typeof candidate.offsetS !== 'number' || !Number.isFinite(candidate.offsetS) || candidate.offsetS <= 0 ||
            typeof raw.durationS !== 'number' || !Number.isFinite(raw.durationS) || raw.durationS <= 0 ||
            candidate.offsetS > raw.durationS ||
            typeof candidate.type !== 'string' || candidate.type.trim() === '' ||
            !isPlainRecord(candidate.data) ||
            jsonSerializableIssues(candidate.data, eventLabel + '.data').length > 0
          ) {
            return;
          }

          const eventLocalTimeS = currentPoint.localTimeS + candidate.offsetS;
          if (!Number.isSafeInteger(currentPoint.segmentIndex + 1)) {
            proposalProblems.push(eventLabel + ': segmentIndex исчерпал диапазон безопасных целых для переноса root-события');
            return;
          }
          const eventTime: FluxTime =
            Number.isFinite(eventLocalTimeS) &&
            eventLocalTimeS > currentPoint.localTimeS &&
            eventLocalTimeS - currentPoint.localTimeS === candidate.offsetS
              ? {
                  segmentIndex: currentPoint.segmentIndex,
                  localTimeS: eventLocalTimeS
                }
              : {
                  // The offset is positive but smaller than the next
                  // representable increment at this large local time.
                  // The matching exact coordinate is in the next segment.
                  segmentIndex: currentPoint.segmentIndex + 1,
                  localTimeS: candidate.offsetS
                };

          let dataSnapshot: Record<string, unknown>;
          try {
            dataSnapshot = structuredClone(candidate.data);
          } catch (error) {
            proposalProblems.push(
              eventLabel + '.data не удалось изолировать: ' +
                (error instanceof Error ? error.message : String(error))
            );
            return;
          }

          proposedEventIds.add(candidate.id);
          normalizedEvents.push({
            id: candidate.id,
            offsetS: candidate.offsetS,
            type: candidate.type,
            data: dataSnapshot,
            time: eventTime
          });
        });
      }
    }

    if (proposalProblems.length > 0) {
      return {
        status: 'rejected',
        world,
        bookkeeping: originalBk,
        log: [],
        diagnostics: [
          'state-dependent solver-предложение процесса «' + processId + '» отклонено: ' +
            proposalProblems.join('; ') + ' — оператор apply не вызван, состояние мира не изменено'
        ]
      };
    }
    const normalized: ProcessStepProposal & { processId: string } = {
      processId,
      durationS: raw.durationS as number,
      method: raw.method as string,
      ...(raw.characteristicTimeS === undefined ? {} : { characteristicTimeS: raw.characteristicTimeS as number }),
      ...(raw.diagnostics === undefined ? {} : { diagnostics: [...(raw.diagnostics as string[])] }),
      ...(normalizedEvents.length === 0 ? {} : { events: normalizedEvents })
    };
    proposals.push(normalized);
    for (const event of normalizedEvents) {
      proposedEvents.push({
        ...event,
        processId
      });
    }
    if (Array.isArray(normalized.diagnostics)) {
      proposalDiagnostics.push(...normalized.diagnostics.map((message) => '[' + processId + '] ' + message));
    }
    effectiveDurationS = Math.min(effectiveDurationS, normalized.durationS);
  }
  // A macro-step must not pass a pending event in the current clock
  // segment. Segment indices are ordered exactly, but priorSegmentsS is
  // only an elapsed-time estimate; therefore we never translate a future
  // segment's event into a delta using that approximate sum.
  const pendingEventTime = nextEventTime(originalBk);
  let eventBoundary: MacroStepSizeReport['eventBoundary'];
  if (pendingEventTime !== null) {
    const comparison = comparePoints(pendingEventTime, currentPoint);
    if (comparison <= 0) {
      return {
        status: 'rejected',
        world,
        bookkeeping: originalBk,
        log: [],
        diagnostics: [
          'событие «' + (pendingEvents(originalBk)[0]?.id ?? 'unknown') +
            '» уже наступило и остаётся pending: обработайте событие до следующего macro-шага; время и состояние не изменены'
        ]
      };
    }
    if (pendingEventTime.segmentIndex === world.clock.segmentIndex) {
      const secondsUntilEvent = pendingEventTime.localTimeS - world.clock.localTimeS;
      if (secondsUntilEvent <= effectiveDurationS) {
        effectiveDurationS = secondsUntilEvent;
        const event = pendingEvents(originalBk)[0];
        if (event !== undefined) {
          eventBoundary = {
            eventId: event.id,
            time: { ...pendingEventTime }
          };
        }
      }
    }
  }

  // A solver-discovered root is another exact stop candidate. Select the
  // earliest one that lies inside the globally admissible duration; all
  // proposals at the selected point will be queued after a successful
  // macro-step. Later candidates are recomputed from the next state.
  const solverEventCandidates = proposedEvents
    .filter((event) => event.offsetS <= effectiveDurationS)
    .slice()
    .sort((a, b) =>
      a.offsetS - b.offsetS ||
      a.processId.localeCompare(b.processId) ||
      a.id.localeCompare(b.id)
    );
  const firstSolverEvent = solverEventCandidates[0];
  if (
    firstSolverEvent !== undefined &&
    (eventBoundary === undefined || firstSolverEvent.offsetS < effectiveDurationS)
  ) {
    effectiveDurationS = firstSolverEvent.offsetS;
    eventBoundary = {
      eventId: firstSolverEvent.id,
      time: { ...firstSolverEvent.time }
    };
  }

  const limitingProcessIds =
    effectiveDurationS < opts.durationS
      ? proposals.filter((proposal) => proposal.durationS === effectiveDurationS).map((proposal) => proposal.processId).sort()
      : [];
  const stepSizeDiagnostics = [...proposalDiagnostics];
  if (eventBoundary !== undefined) {
    stepSizeDiagnostics.push(
      'macro-шаг остановлен на событии «' + eventBoundary.eventId +
        '»; событие остаётся pending и должно быть обработано до следующего шага'
    );
  }
  const stepSize: MacroStepSizeReport = {
    requestedDurationS: opts.durationS,
    effectiveDurationS,
    limitingProcessIds,
    ...(eventBoundary === undefined ? {} : { eventBoundary }),
    proposals: proposals.map((proposal) => ({ ...proposal })),
    diagnostics: stepSizeDiagnostics
  };

  // --- детерминированный план вызовов операторов ---
  interface PlannedCall {
    processId: string;
    phase: StepLogPhase;
    durationS: number;
    intervalStartS: number;
  }
  const plan: PlannedCall[] = [];
  if (opts.splitting === 'strang') {
    const a = processIds[0];
    const b = processIds[1];
    if (a === undefined || b === undefined) {
      throw new SchedulerError('invalid_splitting', 'Strang splitting требует ровно два процесса', null);
    }
    const half = effectiveDurationS / 2;
    // Физические подынтервалы (4.2.1.2): A интегрирует [0, dt/2],
    // B — [0, dt] (полный шаг B-динамики ВНУТРИ macro-шага), второй
    // A — [dt/2, dt]; ни один вызов не выходит за [0, dt].
    plan.push({ processId: a, phase: 'strang_a_half_first', durationS: half, intervalStartS: 0 });
    plan.push({ processId: b, phase: 'strang_b_full', durationS: effectiveDurationS, intervalStartS: 0 });
    plan.push({ processId: a, phase: 'strang_a_half_second', durationS: half, intervalStartS: half });
  } else {
    const subDurationS = effectiveDurationS / subCycles;
    for (const processId of processIds) {
      for (let i = 0; i < subCycles; i++) {
        plan.push({
          processId,
          phase: subCycles > 1 ? 'subcycle' : 'lie',
          durationS: subDurationS,
          intervalStartS: subDurationS * i
        });
      }
    }
  }

  const rejectedLog = (attempted: PlannedCall[]): SchedulerStepLogEntry[] =>
    attempted.map((c) => ({
      stepIndex,
      processId: c.processId,
      phase: c.phase,
      durationS: c.durationS,
      intervalStartS: c.intervalStartS,
      status: 'rejected' as const
    }));

  // --- выполнение с атомарностью ---
  let current: CoreWorldState = working;
  const attempted: PlannedCall[] = [];
  for (const call of plan) {
    attempted.push(call);
    const operator = operatorByProcess.get(call.processId);
    if (!operator) {
      throw new SchedulerError('solver_unavailable', 'процесс «' + call.processId + '»: оператор не передан', call.processId);
    }
    const clockBefore = { ...current.clock };
    let next: CoreWorldState;
    try {
      next = operator.apply(current, call.durationS, call.intervalStartS);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        status: 'rejected',
        world,
        bookkeeping: originalBk,
        log: rejectedLog(attempted),
        diagnostics: [
          'оператор «' + call.processId + '» вызвал ошибку (фаза ' + call.phase + '): ' + reason +
            ' — шаг отклонён, состояние мира не изменено'
        ]
      };
    }
    if (next === null || typeof next !== 'object' || next.clock === undefined) {
      return {
        status: 'rejected',
        world,
        bookkeeping: originalBk,
        log: rejectedLog(attempted),
        diagnostics: ['оператор «' + call.processId + '» вернул некорректное состояние мира — шаг отклонён']
      };
    }
    if (!clocksEqual(next.clock, clockBefore)) {
      return {
        status: 'rejected',
        world,
        bookkeeping: originalBk,
        log: rejectedLog(attempted),
        diagnostics: [
          'оператор «' + call.processId + '» продвинул мировое время: часы принадлежат WorldClock, операторы их не двигают — шаг отклонён'
        ]
      };
    }
    current = next;
  }

  // --- Stage 4.2.3.3.1: append-only контракт журнала реакций ---
  // Записи, существовавшие до macro-шага, остаются неизменными (по
  // всему содержимому — участники, коэффициенты, extent, extentBasis,
  // time, processId, note), в том же порядке и количестве; разрешено
  // только добавление новых записей в конец журнала. Совпадающий id
  // не является доказательством неизменности: подмена содержимого
  // при сохранённом id, удаление и перестановка старых записей,
  // удаление журнала — нарушение контракта. Проверка выполняется на
  // КАЖДОМ шаге, независимо от того, запрошен аудит инвариантов.
  const reactionAppendOnlyIssues = reactionLedgerAppendOnlyIssues(world.reactionLedger, current.reactionLedger);
  if (reactionAppendOnlyIssues.length > 0) {
    return {
      status: 'rejected',
      world,
      bookkeeping: originalBk,
      log: rejectedLog(plan),
      diagnostics: [
        ...reactionAppendOnlyIssues,
        'нарушение append-only контракта журнала реакций: шаг отклонён, состояние мира и его журнал не изменены'
      ]
    };
  }
  // Реакционные транзакции шага — ТОЛЬКО записи, добавленные в конец
  // журнала поверх неизменной истории (префикс проверен выше). Мир
  // без журнала до шага: все записи «после» — новые.
  const beforeReactionCount =
    world.reactionLedger !== undefined && Array.isArray(world.reactionLedger.records)
      ? world.reactionLedger.records.length
      : 0;
  const afterReactionRecords =
    current.reactionLedger !== undefined && Array.isArray(current.reactionLedger.records)
      ? current.reactionLedger.records
      : [];
  const stepReactions = afterReactionRecords.slice(beforeReactionCount);
  // Новые записи обязаны пройти стехиометрический аудит ДО фиксации
  // шага: аудит требует каталог видов (speciesCatalog). Шаг, который
  // добавил реакционные транзакции, но не запросил аудит инвариантов,
  // отклоняется — незаверенные реакции не фиксируются молча.
  if (stepReactions.length > 0 && opts.audit === undefined) {
    return {
      status: 'rejected',
      world,
      bookkeeping: originalBk,
      log: rejectedLog(plan),
      diagnostics: [
        'шаг добавил ' + String(stepReactions.length) + ' реакционных транзакций, но аудит инвариантов не запрошен: новые записи обязаны пройти стехиометрический аудит (speciesCatalog) до фиксации шага — шаг отклонён, состояние мира не изменено'
      ]
    };
  }

  // --- аудит инвариантов до фиксации ---
  let audit: WorldTransitionAudit | undefined;
  if (opts.audit !== undefined) {
    const beforeIds = new Set(world.fluxLedger.records.map((r) => r.id));
    const stepRecords = current.fluxLedger.records.filter((r) => !beforeIds.has(r.id));
    // Stage 4.2.3.3/4.2.3.3.1: реакционные транзакции шага — записи,
    // добавленные В КОНЕЦ журнала поверх неизменной истории (фильтр
    // по id из 4.2.3.3 не замечал правку/удаление/перестановку
    // старых записей и заменён префиксной append-only проверкой).
    // Операторы, не работающие с реакциями, не добавляют записей:
    // аудит получает пустой журнал (не ошибка). Журнал проверяется
    // аудитом ОТДЕЛЬНО от потоков; автоматически записи не создаются.
    audit = auditWorldTransition(world, current, { records: stepRecords }, {
      speciesCatalog: opts.audit.speciesCatalog,
      boundary: opts.audit.boundary,
      tolerance: opts.audit.tolerance,
      scope: opts.audit.scope,
      reactionLedger: { records: stepReactions }
    });
    if (audit.status === 'imbalanced') {
      return {
        status: 'rejected',
        world,
        bookkeeping: originalBk,
        log: rejectedLog(plan),
        audit,
        diagnostics: [...audit.diagnostics, 'обязательные инварианты нарушены: шаг не фиксируется, мировое время не продвигается']
      };
    }
  }

  // --- ЕДИНСТВЕННОЕ продвижение мирового времени ---
  // Prefer an exact point in the current segment whenever adding dt
  // changes the double value. The conservative representableStep estimate
  // is not itself proof that a particular target point is unrepresentable.
  // Only when addition rounds back to the current value do we open a new
  // segment with advance(); pending events in the old segment are then
  // rebased by their exact local offset from the old current point.
  const targetLocalTimeS = current.clock.localTimeS + effectiveDurationS;
  const newClock =
    eventBoundary !== undefined && eventBoundary.time.segmentIndex === current.clock.segmentIndex
      ? advanceTo(current.clock, eventBoundary.time)
      : eventBoundary !== undefined
        ? advance(current.clock, effectiveDurationS)
        : Number.isFinite(targetLocalTimeS) && targetLocalTimeS > current.clock.localTimeS
          ? advanceTo(current.clock, {
              segmentIndex: current.clock.segmentIndex,
              localTimeS: targetLocalTimeS
            })
          : advance(current.clock, effectiveDurationS);

  const eventQueue =
    newClock.segmentIndex === current.clock.segmentIndex
      ? originalBk.eventQueue
      : originalBk.eventQueue.map((event) => {
          if (
            event.status !== 'pending' ||
            event.time.segmentIndex !== current.clock.segmentIndex ||
            event.time.localTimeS <= current.clock.localTimeS
          ) {
            return event;
          }
          return {
            ...event,
            time: {
              segmentIndex: newClock.segmentIndex,
              localTimeS: event.time.localTimeS - current.clock.localTimeS
            }
          };
        });
  let eventBookkeeping: SchedulerBookkeeping = {
    ...originalBk,
    eventQueue
  };
  for (const event of proposedEvents) {
    if (event.offsetS > effectiveDurationS) continue;
    try {
      eventBookkeeping = enqueueEvent(eventBookkeeping, {
        id: event.id,
        time: event.time,
        type: event.type,
        data: event.data,
        source: event.processId
      });
    } catch (error) {
      return {
        status: 'rejected',
        world,
        bookkeeping: originalBk,
        log: rejectedLog(plan),
        diagnostics: [
          'solver-событие «' + event.id + '» не удалось включить в транзакцию Scheduler: ' +
            (error instanceof Error ? error.message : String(error)) +
            ' — шаг отклонён, мировое состояние и очередь не изменены'
        ]
      };
    }
  }

  const lastRunElapsedS = totalElapsedSeconds(newClock);
  const callsPerProcess = new Map<string, number>();
  for (const call of plan) {
    callsPerProcess.set(call.processId, (callsPerProcess.get(call.processId) ?? 0) + 1);
  }
  const newDynamics: Record<string, ProcessDynamics> = { ...originalBk.processDynamics };
  for (const [processId, calls] of callsPerProcess) {
    const dynamics: ProcessDynamics = newDynamics[processId] ?? {
      processId,
      lastRunElapsedS: null,
      nextDueElapsedS: null,
      macroStepsCompleted: 0,
      operatorCallsCompleted: 0
    };
    newDynamics[processId] = {
      ...dynamics,
      lastRunElapsedS,
      macroStepsCompleted: dynamics.macroStepsCompleted + 1,
      operatorCallsCompleted: dynamics.operatorCallsCompleted + calls
    };
  }
  const committedLog: SchedulerStepLogEntry[] = plan.map((c) => ({
    stepIndex,
    processId: c.processId,
    phase: c.phase,
    durationS: c.durationS,
    intervalStartS: c.intervalStartS,
    status: 'committed' as const
  }));
  const newBk: SchedulerBookkeeping = {
    ...originalBk,
    processDynamics: newDynamics,
    eventQueue: eventBookkeeping.eventQueue,
    nextSequence: eventBookkeeping.nextSequence,
    stepLog: [...originalBk.stepLog, ...committedLog],
    stepCount: originalBk.stepCount + 1
  };
  const diagnostics: string[] = [
    ...stepSize.diagnostics,
    ...(audit !== undefined ? [...audit.diagnostics] : [])
  ];
  return {
    status: 'committed',
    world: { ...current, clock: newClock, scheduling: newBk },
    bookkeeping: newBk,
    log: committedLog,
    audit,
    stepSize,
    diagnostics
  };
}
