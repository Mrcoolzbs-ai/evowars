// ============================================
// WORLD CLOCK - Мировая временная система
// ============================================
//
// Stage 4.2.1. WorldClock организует мировое время, расписания
// процессов и порядок физических событий ПОВЕРХ существующих
// сегментированных часов SimulationClock (Stage 4.1).
//
// Разделение ответственности:
// - SimulationClock — низкоуровневая числовая реализация времени
//   (сегменты, представимость шагов, точный порядок моментов);
// - WorldClock — мировая временная система: единый вход продвижения
//   времени для подсистем и планировщика, порядок событий, явный
//   перевод лет в секунды, сериализация, проверка непротиворечивости.
//
// Главные правила:
// - единственный источник прошедшего времени — SimulationClockState:
//   второго независимого числового поля elapsed здесь НЕТ;
//   validateWorldClock отклоняет любые поля, кроме «clock»;
// - локальное время симуляции — НЕ космологический возраст:
//   возраст Вселенной, планетарной системы, звезды и эпоха мира —
//   отдельные характеристики (CoreWorldState.cosmicAge), часы их
//   не хранят и не выводят друг из друга;
// - время ядра — секунды SI; годы переводятся ТОЛЬКО явно
//   (advanceWorldClockYears → yearsToSeconds);
// - продвижение не использует Date.now() и системное время:
//   WorldClock детерминирован — одинаковое состояние даёт
//   одинаковый результат при повторном выполнении;
// - некорректные интервалы (NaN, ±Infinity, ≤ 0) — структурированная
//   ошибка, а не молчаливый нулевой шаг.

import type { SimulationClockState, TimePoint } from './simulationClock';
import {
  SimulationClockError,
  advance,
  comparePoints,
  createSimulationClock,
  deserializeClock,
  now,
  serializeClock,
  startNewSegment,
  totalElapsedSeconds,
  validateClock,
  yearsToSeconds
} from './simulationClock';
import { isPlainRecord } from './reservoir';

// ============================================
// 1. СОСТОЯНИЕ
// ============================================

/**
 * Состояние мировой временной системы. Ровно одно поле — сегменти-
 * рованные часы: WorldClock НЕ вводит второго числового времени.
 * CoreWorldState хранит те же часы в поле «clock» (единая основа);
 * WorldClock — типизированный контракт поверх них.
 */
export interface WorldClockState {
  /** Единственная временная основа: сегментированные часы Stage 4.1. */
  clock: SimulationClockState;
}

/** Ошибка мировой временной системы. */
export class WorldClockError extends Error {
  readonly code: 'invalid_step' | 'invalid_state';
  readonly component = 'WorldClock';

  constructor(code: 'invalid_step' | 'invalid_state', message: string) {
    super('[WorldClock/' + code + '] ' + message);
    this.name = 'WorldClockError';
    this.code = code;
  }
}

// ============================================
// 2. КОНСТРУКТОРЫ
// ============================================

/** Мировые часы в начале моделируемого процесса (нулевой момент). */
export function createWorldClock(): WorldClockState {
  return { clock: createSimulationClock() };
}

/**
 * Мировые часы из существующих часов (например, CoreWorldState.clock).
 * Числа не пересчитываются и не мутируются; некорректное состояние
 * отклоняется явно.
 */
export function worldClockFromClock(clock: SimulationClockState): WorldClockState {
  const issues = validateClock(clock);
  if (issues.length > 0) {
    throw new WorldClockError('invalid_state', 'часы некорректны: ' + issues.join('; '));
  }
  return { clock };
}

// ============================================
// 3. ТЕКУЩИЙ МОМЕНТ И ПРОДВИЖЕНИЕ
// ============================================

/** Текущий момент мирового времени (точная сегментированная пара). */
export function worldClockNow(wc: WorldClockState): TimePoint {
  return now(wc.clock);
}

/**
 * Продвижение мирового времени на положительный конечный интервал
 * в СЕКУНДАХ SI. Сегментация при потере представимости малого шага
 * выполняется автоматически самими часами (контракт Stage 4.1).
 */
export function advanceWorldClock(wc: WorldClockState, dtS: number): WorldClockState {
  assertUsableWorldClock(wc);
  try {
    return { clock: advance(wc.clock, dtS) };
  } catch (e) {
    throw wrappedClockError(e);
  }
}

/**
 * Продвижение мирового времени на годы: ЯВНЫЙ перевод лет в секунды
 * (yearsToSeconds, юлианский год). Внутри ядра время остаётся
 * в секундах; календарные единицы — только на входе API и адаптеров.
 */
export function advanceWorldClockYears(wc: WorldClockState, years: number): WorldClockState {
  assertUsableWorldClock(wc);
  try {
    return { clock: advance(wc.clock, yearsToSeconds(years)) };
  } catch (e) {
    throw wrappedClockError(e);
  }
}

/**
 * Оценка полного прошедшего времени с начала процесса, с.
 * ОЦЕНКА (double-сумма сегментов): для точного порядка моментов
 * используйте worldClockNow + compareWorldMoments.
 */
export function worldClockElapsedSeconds(wc: WorldClockState): number {
  return totalElapsedSeconds(wc.clock);
}

/**
 * Сравнение моментов мирового времени: -1 (a раньше b), 0 (равны),
 * 1 (a позже b). Порядок физических событий и расписаний определяется
 * ТОЛЬКО этим сравнением по сегментированной паре — без округления
 * до календарных единиц и без потери порядка на больших временах.
 */
export function compareWorldMoments(a: TimePoint, b: TimePoint): -1 | 0 | 1 {
  return comparePoints(a, b);
}

/**
 * Ручное начало нового сегмента (смена моделируемого процесса/фазы).
 * Прошедшее время не меняется: фиксируется накопленная длительность.
 */
export function worldClockStartNewSegment(wc: WorldClockState): WorldClockState {
  assertUsableWorldClock(wc);
  return { clock: startNewSegment(wc.clock) };
}

// ============================================
// 4. СЕРИАЛИЗАЦИЯ И ВАЛИДАЦИЯ
// ============================================

/** Сериализация мировых часов (сериализуется их временная основа). */
export function serializeWorldClock(wc: WorldClockState): string {
  assertUsableWorldClock(wc);
  return serializeClock(wc.clock);
}

/** Восстановление мировых часов из JSON. */
export function deserializeWorldClock(json: string): WorldClockState {
  try {
    return { clock: deserializeClock(json) };
  } catch (e) {
    if (e instanceof SimulationClockError) {
      throw new WorldClockError('invalid_state', e.message);
    }
    throw e;
  }
}

/**
 * Проверка непротиворечивости состояния мировых часов (список
 * проблем; пустой = корректно):
 * - только поле «clock»: второе независимое числовое поле времени
 *   (elapsed, cosmicAge и т.п.) запрещено архитектурой;
 * - внутренние часы проходят контрактную проверку Stage 4.1.
 */
export function validateWorldClock(wc: unknown): string[] {
  if (!isPlainRecord(wc)) {
    return ['WorldClock должен быть обычным объектом-словарём'];
  }
  const issues: string[] = [];
  const keys = Object.keys(wc);
  if (keys.length !== 1 || keys[0] !== 'clock') {
    issues.push(
      'WorldClock может содержать только поле «clock» (сегментированные часы); получены поля: ' +
        (keys.length > 0 ? keys.join(', ') : '(нет)') +
        ' — второе независимое поле времени запрещено'
    );
  }
  const clockValue: unknown = wc.clock;
  for (const issue of validateClock(clockValue as SimulationClockState)) {
    issues.push('clock: ' + issue);
  }
  return issues;
}

function assertUsableWorldClock(wc: WorldClockState): void {
  const issues = validateWorldClock(wc);
  if (issues.length > 0) {
    throw new WorldClockError('invalid_state', 'состояние WorldClock некорректно: ' + issues.join('; '));
  }
}

function wrappedClockError(e: unknown): Error {
  if (e instanceof SimulationClockError) {
    return new WorldClockError(e.code === 'invalid_state' ? 'invalid_state' : 'invalid_step', e.message);
  }
  return e instanceof Error ? e : new Error(String(e));
}
