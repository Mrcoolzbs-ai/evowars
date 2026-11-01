// ============================================
// SIMULATION CLOCK - Время симуляции
// ============================================
//
// Контракт времени ядра (Stage 4.1).
//
// Разделение понятий (НЕ смешиваются в одном числе):
// - локальное время симуляции — прошедшее время моделируемого
//   процесса с его начала (или с начала текущего сегмента);
// - космический возраст (возраст Вселенной, системы, звезды,
//   планеты, историческая эпоха) — отдельная характеристика мира
//   (в CoreWorldState.cosmicAge), а НЕ поле часов.
//
// Числовая устойчивость (JavaScript number):
// - время хранится сегментированно: небольшой localTimeS внутри
//   сегмента + накопленная длительность предыдущих сегментов;
// - когда шаг становится непредставим относительно текущего
//   localTimeS (точность double исчерпана), начинается новый
//   сегмент — малые шаги остаются представимыми;
// - тотальная точность не выдумывается: totalElapsedSeconds() —
//   ОЦЕНКА (double-сумма), а сравнение моментов выполняется
//   по паре (segmentIndex, localTimeS), которая не теряет порядок.
//
// Шаги:
// - только положительные конечные интервалы; нулевой и
//   отрицательный шаг запрещены (режима обратного интегрирования
//   в проекте нет, а молчаливый нулевой шаг скрывает ошибки цикла
//   симуляции);
// - фиксированный универсальный time step НЕ вводится:
//   будущие подсистемы (орбиты, химию, геологию) будут задавать
//   собственные шаги и subcycling поверх этого контракта.
//
// Адаптивный интегратор на этом этапе НЕ реализуется — только
// корректный контракт времени.

// ============================================
// 1. СОСТОЯНИЕ
// ============================================

/**
 * Состояние часов. Все поля JSON-сериализуемы (number).
 *
 * priorSegmentsS — суммарная длительность завершённых сегментов;
 * оценка, а не точное накопление: точность обеспечивается тем,
 * что сегменты закрываются до потери представимости шагов.
 */
export interface SimulationClockState {
  /** Индекс текущего сегмента (0 для первого). */
  segmentIndex: number;
  /** Время внутри текущего сегмента, с. */
  localTimeS: number;
  /** Суммарная длительность завершённых сегментов, с. */
  priorSegmentsS: number;
  /** Число выполненных шагов (для аудита). */
  stepCount: number;
  /**
   * Минимальный шаг, представимый относительно локального времени,
   * с (пересчитывается при каждом продвижении). Необязательное поле
   * — сохраняется для диагностики точности.
   */
  representableStepS: number | null;
}

export class SimulationClockError extends Error {
  readonly code: 'invalid_step' | 'invalid_state';
  readonly component = 'SimulationClock';

  constructor(code: 'invalid_step' | 'invalid_state', message: string) {
    super(`[SimulationClock/${code}] ${message}`);
    this.name = 'SimulationClockError';
    this.code = code;
  }
}

/** Момент времени для сравнения (упорядоченная пара). */
export interface TimePoint {
  segmentIndex: number;
  localTimeS: number;
}

/** Создать часы в начале моделируемого процесса. */
export function createSimulationClock(): SimulationClockState {
  return {
    segmentIndex: 0,
    localTimeS: 0,
    priorSegmentsS: 0,
    stepCount: 0,
    representableStepS: null
  };
}

// ============================================
// 2. ОПЕРАЦИИ
// ============================================

/**
 * Продвижение времени на положительный конечный интервал.
 *
 * Если шаг непредставим относительно локального времени сегмента
 * (localTimeS + dt === localTimeS при dt > 0 — точность double
 * исчерпана), автоматически открывается новый сегмент: локальное
 * время обнуляется, накопленная длительность фиксируется.
 * Это защищает «малый шаг при большом elapsed time».
 */
export function advance(clock: SimulationClockState, dtS: number): SimulationClockState {
  if (!Number.isFinite(dtS)) {
    throw new SimulationClockError('invalid_step', `шаг времени должен быть конечным числом, получено ${dtS}`);
  }
  if (dtS <= 0) {
    throw new SimulationClockError('invalid_step', `шаг времени должен быть положительным, получено ${dtS}: нулевые и отрицательные шаги запрещены`);
  }

  const representable = representableStep(clock);
  // Потеря точности: шаг не изменяет локальное время — сегментируем.
  if (clock.localTimeS > 0 && representable !== null && dtS < representable) {
    return {
      segmentIndex: clock.segmentIndex + 1,
      localTimeS: dtS,
      priorSegmentsS: clock.priorSegmentsS + clock.localTimeS,
      stepCount: clock.stepCount + 1,
      representableStepS: null
    };
  }

  const localTimeS = clock.localTimeS + dtS;
  if (!Number.isFinite(localTimeS)) {
    throw new SimulationClockError('invalid_step', 'переполнение времени при сложении шага');
  }
  return {
    ...clock,
    localTimeS,
    stepCount: clock.stepCount + 1,
    // представимость шага оценивается по новому локальному времени
    representableStepS: representableStep({ localTimeS })
  };
}

/**
 * Минимальный шаг, который ещё изменяет локальное время сегмента.
 * null — не определено (локальное время 0: любой конечный шаг представим
 * при разумных величинах).
 */
export function representableStep(clock: Pick<SimulationClockState, 'localTimeS'>): number | null {
  if (clock.localTimeS === 0) return null;
  // machine epsilon для double: следующий представимый после t.
  return Math.max(Math.abs(clock.localTimeS) * Number.EPSILON, Number.MIN_VALUE * 2);
}

/** Текущий момент. */
export function now(clock: SimulationClockState): TimePoint {
  return { segmentIndex: clock.segmentIndex, localTimeS: clock.localTimeS };
}

/**
 * Оценка полного прошедшего времени с начала процесса, с.
 * ОЦЕНКА (double-сумма сегментов): для точного сравнения моментов
 * используйте comparePoints.
 */
export function totalElapsedSeconds(clock: SimulationClockState): number {
  return clock.priorSegmentsS + clock.localTimeS;
}

/**
 * Сравнение моментов: -1 (a раньше b), 0 (равны), 1 (a позже b).
 * Сравнение по упорядоченной паре (сегмент, локальное время),
 * без потери точности на больших elapsed time.
 */
export function comparePoints(a: TimePoint, b: TimePoint): -1 | 0 | 1 {
  if (a.segmentIndex !== b.segmentIndex) {
    return a.segmentIndex < b.segmentIndex ? -1 : 1;
  }
  if (a.localTimeS !== b.localTimeS) {
    return a.localTimeS < b.localTimeS ? -1 : 1;
  }
  return 0;
}

/**
 * Начать новый сегмент вручную (например, при переключении
 * моделируемого процесса или фазы). Локальное время обнуляется,
 * накопленная длительность фиксируется. Используется также
 * будущими подчасами процессов для суб-циклирования.
 */
export function startNewSegment(clock: SimulationClockState): SimulationClockState {
  return {
    segmentIndex: clock.segmentIndex + 1,
    localTimeS: 0,
    priorSegmentsS: clock.priorSegmentsS + clock.localTimeS,
    stepCount: clock.stepCount,
    representableStepS: null
  };
}

// ============================================
// 3. СЕРИАЛИЗАЦИЯ И ВАЛИДАЦИЯ
// ============================================

/**
 * Сериализация: состояние целиком состоит из number — JSON-безопасно.
 * bigint намеренно не используется, чтобы сериализация не требовала
 * особых схем.
 */
export function serializeClock(clock: SimulationClockState): string {
  return JSON.stringify(clock);
}

/** Восстановление часов из сериализованного состояния. */
export function deserializeClock(json: string): SimulationClockState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SimulationClockError('invalid_state', 'сериализованное состояние часов не является корректным JSON');
  }
  const issues = validateClockShape(parsed);
  if (issues.length > 0) {
    throw new SimulationClockError('invalid_state', `состояние часов некорректно: ${issues.join('; ')}`);
  }
  return parsed as SimulationClockState;
}

function validateClockShape(v: unknown): string[] {
  const issues: string[] = [];
  if (typeof v !== 'object' || v === null) {
    return ['состояние часов должно быть объектом'];
  }
  const c = v as Record<string, unknown>;
  for (const key of ['segmentIndex', 'localTimeS', 'priorSegmentsS', 'stepCount'] as const) {
    if (typeof c[key] !== 'number' || !Number.isFinite(c[key])) {
      issues.push(`поле «${key}» должно быть конечным числом`);
    }
  }
  if (typeof c.segmentIndex === 'number' && (!Number.isInteger(c.segmentIndex) || c.segmentIndex < 0)) {
    issues.push('segmentIndex должен быть неотрицательным целым');
  }
  if (typeof c.localTimeS === 'number' && c.localTimeS < 0) {
    issues.push('localTimeS не может быть отрицательным');
  }
  if (typeof c.priorSegmentsS === 'number' && c.priorSegmentsS < 0) {
    issues.push('priorSegmentsS не может быть отрицательным');
  }
  if (typeof c.stepCount === 'number' && (!Number.isInteger(c.stepCount) || c.stepCount < 0)) {
    issues.push('stepCount должен быть неотрицательным целым');
  }
  if (c.representableStepS !== undefined && c.representableStepS !== null && (typeof c.representableStepS !== 'number' || !Number.isFinite(c.representableStepS))) {
    issues.push('representableStepS должен быть числом или null');
  }
  return issues;
}

/** Валидация состояния часов (список проблем; пустой = корректно). */
export function validateClock(clock: SimulationClockState): string[] {
  return validateClockShape(clock);
}

/**
 * Привязка химического времени легаси (modelTimeYears) к часам ядра.
 *
 * Легаси химическая эволюция измеряет модельное время в годах
 * (игровое допущение о длительности шага). Функция переводит
 * годы (юлианские, как Units.YEAR_S) в секунды ЯВНО: это
 * функция-мост для адаптеров, а не изменение легаси семантики.
 */
export function yearsToSeconds(years: number): number {
  if (!Number.isFinite(years) || years < 0) {
    throw new SimulationClockError('invalid_step', `количество лет должно быть неотрицательным конечным числом, получено ${years}`);
  }
  return years * 3.15576e7;
}
