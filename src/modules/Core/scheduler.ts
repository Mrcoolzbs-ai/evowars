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
//
// Тесты композиции операторов доказывают правильность ПОРЯДКА
// вызовов, а не точность физического решателя: готовых
// физических solver в проекте пока нет.

import type { CoreWorldState } from './worldState';
import type { ProcessRegistry } from './processRegistry';
import { isProcessAutoRunnable, tauSeconds } from './processRegistry';
import type { FluxAuditScope, FluxTime } from './fluxLedger';
import type { SimulationClockState } from './simulationClock';
import { advance, comparePoints, totalElapsedSeconds } from './simulationClock';
import { isPlainRecord } from './reservoir';
import { auditWorldTransition } from './invariantAuditor';
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
    | 'invalid_bookkeeping';
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

  if (!Array.isArray(bk.eventQueue)) {
    issues.push('eventQueue должен быть массивом событий');
  } else {
    const seenEventIds = new Set<string>();
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
      if (event.failReason !== undefined && typeof event.failReason !== 'string') {
        issues.push(label + ': failReason должен быть строкой, если задан');
      }
      if (typeof event.sequence !== 'number' || !Number.isInteger(event.sequence) || event.sequence < 0) {
        issues.push(label + ': sequence должен быть неотрицательным целым');
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
  const worldEvent: WorldEvent = {
    id: event.id,
    time: { segmentIndex: event.time.segmentIndex, localTimeS: event.time.localTimeS },
    type: event.type,
    data: event.data,
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
  return [...bk.eventQueue].sort((a, b) => {
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
    handler(event);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
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
 * позже nowElapsedS), процесс auto-runnable (включён, решатель
 * доступен, τ известно) и runtime-оператор передан. Порядок
 * детерминирован (сортировка по id).
 */
export function readyProcessIds(
  bk: SchedulerBookkeeping,
  registry: ProcessRegistry,
  operators: readonly ProcessOperator[],
  nowElapsedS: number
): readonly string[] {
  const operatorIds = new Set(operators.map((o) => o.processId));
  const ready: string[] = [];
  for (const [processId, dynamics] of Object.entries(bk.processDynamics)) {
    if (dynamics.nextDueElapsedS === null) continue;
    if (dynamics.nextDueElapsedS > nowElapsedS) continue;
    const descriptor = registry.get(processId);
    if (descriptor === null || !isProcessAutoRunnable(descriptor)) continue;
    if (!operatorIds.has(processId)) continue;
    ready.push(processId);
  }
  return ready.sort();
}

// ============================================
// 7. MACRO-ШАГ ПЛАНИРОВЩИКА
// ============================================

/**
 * Runtime-исполнитель процесса. Оператор получает мир и ФИЗИЧЕСКИЙ
 * подынтервал macro-шага: интервал [intervalStartS,
 * intervalStartS + durationS), с, всегда лежит внутри [0, dt].
 * Семантика по splitting (Stage 4.2.1.2): Lie — каждый оператор
 * интегрирует [0, dt] (sub-cycling — последовательные подшаги,
 * покрывающие [0, dt]); Strang — A(dt/2) интегрирует [0, dt/2],
 * B(dt) интегрирует [0, dt], второй A(dt/2) — [dt/2, dt].
 * Оператор возвращает НОВОЕ состояние мира, НЕ двигает часы
 * (проверяется; нарушение отклоняет шаг) и НЕ сериализуется.
 */
export interface ProcessOperator {
  processId: string;
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
  /** Длительность macro-шага, с (положительное конечное число). */
  durationS: number;
  splitting: SplittingMode;
  /** Процессы шага; по умолчанию — операторы, отсортированные по id. */
  processIds?: readonly string[];
  /** Число подшагов (sub-cycling) для Lie splitting; по умолчанию 1. */
  subCycles?: number;
  /** Аудит инвариантов до фиксации нового состояния. */
  audit?: MacroStepAuditOptions;
}

export interface MacroStepResult {
  status: 'committed' | 'rejected';
  /** Новое состояние при committed; ИСХОДНОЕ состояние при rejected. */
  world: CoreWorldState;
  bookkeeping: SchedulerBookkeeping;
  log: readonly SchedulerStepLogEntry[];
  audit?: WorldTransitionAudit;
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
 * Мировое время продвигается РОВНО один раз — после успеха всех
 * операторов и (если запрошен) аудита. Любая ошибка оператора,
 * самовольное продвижение часов оператором или нарушение
 * обязательных инвариантов отклоняют шаг: возвращается исходное
 * состояние, время не движется, частичное состояние не фиксируется.
 */
export function runMacroStep(
  world: CoreWorldState,
  registry: ProcessRegistry,
  operators: readonly ProcessOperator[],
  opts: MacroStepOptions
): MacroStepResult {
  const originalBk: SchedulerBookkeeping = world.scheduling ?? createSchedulerBookkeeping();
  const stepIndex = originalBk.stepCount;

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
  for (const processId of processIds) {
    const descriptor = registry.get(processId);
    if (descriptor === null) {
      throw new SchedulerError('unknown_process', 'процесс «' + processId + '» не зарегистрирован', processId);
    }
    if (!descriptor.enabled) {
      throw new SchedulerError('process_disabled', 'процесс «' + processId + '» отключён (enabled = false): автоматический запуск запрещён', processId);
    }
    if (tauSeconds(descriptor.tau) === null) {
      throw new SchedulerError(
        'process_tau_unknown',
        'процесс «' + processId + '» не имеет пригодного числового характерного времени τ (требуется строго положительное конечное число секунд): шаг процесса не определяется',
        processId
      );
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
    const half = opts.durationS / 2;
    // Физические подынтервалы (4.2.1.2): A интегрирует [0, dt/2],
    // B — [0, dt] (полный шаг B-динамики ВНУТРИ macro-шага), второй
    // A — [dt/2, dt]; ни один вызов не выходит за [0, dt].
    plan.push({ processId: a, phase: 'strang_a_half_first', durationS: half, intervalStartS: 0 });
    plan.push({ processId: b, phase: 'strang_b_full', durationS: opts.durationS, intervalStartS: 0 });
    plan.push({ processId: a, phase: 'strang_a_half_second', durationS: half, intervalStartS: half });
  } else {
    const subDurationS = opts.durationS / subCycles;
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

  // --- Stage 4.2.3.1: snapshot-изоляция ---
  // Рабочее состояние шага — ПОЛНАЯ изолированная копия мира:
  // операторы физически не могут изменить объект вызывающей
  // стороны (включая вложенные структуры); при ошибке или
  // отклонении шага рабочий снимок отбрасывается. Если снимок
  // создать невозможно, шаг завершается контролируемым отказом
  // до вызова первого оператора; исходное состояние нетронуто.
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
          ' — шаг отклонён до вызова операторов, состояние мира не изменено'
      ]
    };
  }

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

  // --- аудит инвариантов до фиксации ---
  let audit: WorldTransitionAudit | undefined;
  if (opts.audit !== undefined) {
    const beforeIds = new Set(world.fluxLedger.records.map((r) => r.id));
    const stepRecords = current.fluxLedger.records.filter((r) => !beforeIds.has(r.id));
    // Stage 4.2.3.3: реакционные транзакции шага — записи, добавленные
    // операторами в журнал реакций (идентификаторы исходного мира
    // исключаются так же, как у потоков). Операторы, не работающие с
    // реакциями, не добавляют записей: аудит получает пустой журнал
    // (не ошибка). Журнал проверяется аудитом ОТДЕЛЬНО от потоков;
    // автоматически записи не создаются.
    const beforeReactionIds = new Set(world.reactionLedger?.records.map((r) => r.id) ?? []);
    const stepReactions = current.reactionLedger?.records.filter((r) => !beforeReactionIds.has(r.id)) ?? [];
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
  const newClock = advance(current.clock, opts.durationS);
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
    stepLog: [...originalBk.stepLog, ...committedLog],
    stepCount: originalBk.stepCount + 1
  };
  const diagnostics: string[] = audit !== undefined ? [...audit.diagnostics] : [];
  return {
    status: 'committed',
    world: { ...current, clock: newClock, scheduling: newBk },
    bookkeeping: newBk,
    log: committedLog,
    audit,
    diagnostics
  };
}
