// ============================================
// STAGE 4.1 - Тесты времени симуляции
// ============================================

import { describe, it, expect } from 'vitest';
import {
  createSimulationClock,
  advance,
  representableStep,
  now,
  totalElapsedSeconds,
  comparePoints,
  startNewSegment,
  serializeClock,
  deserializeClock,
  validateClock,
  yearsToSeconds,
  SimulationClockError
} from '../Core/simulationClock';

describe('Stage 4.1 SimulationClock: шаги', () => {
  it('часы начинаются с нуля локального времени', () => {
    const clock = createSimulationClock();
    expect(clock.segmentIndex).toBe(0);
    expect(clock.localTimeS).toBe(0);
    expect(clock.stepCount).toBe(0);
    expect(now(clock)).toEqual({ segmentIndex: 0, localTimeS: 0 });
  });

  it('положительный шаг продвигает время', () => {
    let clock = createSimulationClock();
    clock = advance(clock, 10);
    clock = advance(clock, 5);
    expect(clock.localTimeS).toBe(15);
    expect(clock.stepCount).toBe(2);
    expect(totalElapsedSeconds(clock)).toBe(15);
  });

  it('нулевой шаг запрещён', () => {
    const clock = createSimulationClock();
    expect(() => advance(clock, 0)).toThrow(SimulationClockError);
  });

  it('отрицательный шаг запрещён (режима обратного интегрирования нет)', () => {
    const clock = advance(createSimulationClock(), 10);
    try {
      advance(clock, -1);
      expect.unreachable('отрицательный шаг должен быть отклонён');
    } catch (e) {
      expect((e as SimulationClockError).code).toBe('invalid_step');
      expect((e as SimulationClockError).message).toContain('положительным');
    }
  });

  it('NaN и бесконечные шаги запрещены', () => {
    const clock = createSimulationClock();
    expect(() => advance(clock, Number.NaN)).toThrow(SimulationClockError);
    expect(() => advance(clock, Number.POSITIVE_INFINITY)).toThrow(SimulationClockError);
  });

  it('длительные интервалы представимы', () => {
    let clock = createSimulationClock();
    clock = advance(clock, 3.15576e7); // юлианский год в секундах
    clock = advance(clock, 4.7303644e17); // возраст Вселенной в секундах (~15 млрд лет) как сегмент локального времени
    expect(clock.localTimeS).toBeCloseTo(3.15576e7 + 4.7303644e17, 6);
    expect(clock.stepCount).toBe(2);
  });
});

describe('Stage 4.1 SimulationClock: численная устойчивость', () => {
  it('маленький шаг при большом локальном времени вызывает сегментацию', () => {
    let clock = createSimulationClock();
    // большое локальное время сегмента: машинная точность ~ t * 2.2e-16
    clock = advance(clock, 1e16);
    expect(representableStep(clock)).not.toBeNull();
    expect(representableStep(clock)!).toBeGreaterThan(1);
    // шаг 0.001 с непредставим относительно 1e16 с — открывается новый сегмент
    const small = advance(clock, 0.001);
    expect(small.segmentIndex).toBe(1);
    expect(small.localTimeS).toBe(0.001);
    expect(small.priorSegmentsS).toBeCloseTo(1e16, 0);
    expect(totalElapsedSeconds(small)).toBeCloseTo(1e16, 0);
    expect(small.stepCount).toBe(clock.stepCount + 1);
  });

  it('обычный шаг при обычном времени сегментации не вызывает', () => {
    let clock = createSimulationClock();
    clock = advance(clock, 1e6);
    const next = advance(clock, 100);
    expect(next.segmentIndex).toBe(0);
    expect(next.localTimeS).toBe(1e6 + 100);
  });

  it('сегментация сохраняет представимость малых шагов в новом сегменте', () => {
    let clock = createSimulationClock();
    clock = advance(clock, 1e16);
    clock = advance(clock, 0.001); // сегмент 1
    // теперь малые шаги снова представимы
    const tiny = advance(clock, 1e-6);
    expect(tiny.localTimeS).toBeCloseTo(0.001001, 12);
    expect(tiny.segmentIndex).toBe(1);
  });
});

describe('Stage 4.1 SimulationClock: моменты и сегменты', () => {
  it('сравнение моментов: сегменты упорядочены', () => {
    expect(comparePoints({ segmentIndex: 0, localTimeS: 1e15 }, { segmentIndex: 1, localTimeS: 0 })).toBe(-1);
    expect(comparePoints({ segmentIndex: 1, localTimeS: 5 }, { segmentIndex: 1, localTimeS: 5 })).toBe(0);
    expect(comparePoints({ segmentIndex: 1, localTimeS: 2 }, { segmentIndex: 1, localTimeS: 10 })).toBe(-1);
    expect(comparePoints({ segmentIndex: 2, localTimeS: 0 }, { segmentIndex: 1, localTimeS: 9e15 })).toBe(1);
  });

  it('startNewSegment фиксирует накопленное время', () => {
    let clock = advance(createSimulationClock(), 100);
    clock = startNewSegment(clock);
    expect(clock.segmentIndex).toBe(1);
    expect(clock.localTimeS).toBe(0);
    expect(clock.priorSegmentsS).toBe(100);
    expect(totalElapsedSeconds(clock)).toBe(100);
    clock = advance(clock, 20);
    expect(totalElapsedSeconds(clock)).toBe(120);
  });
});

describe('Stage 4.1 SimulationClock: сериализация и валидация', () => {
  it('round-trip: serialize → deserialize восстанавливает состояние', () => {
    let clock = createSimulationClock();
    clock = advance(clock, 1e16);
    clock = advance(clock, 0.001);
    const restored = deserializeClock(serializeClock(clock));
    expect(restored).toEqual(clock);
  });

  it('некорректный JSON отвергается', () => {
    expect(() => deserializeClock('не json')).toThrow(SimulationClockError);
  });

  it('некорректная форма состояния отвергается', () => {
    expect(() => deserializeClock('{"segmentIndex":0}')).toThrow(SimulationClockError);
    expect(() => deserializeClock('[]')).toThrow(SimulationClockError);
    expect(() => deserializeClock(JSON.stringify({
      segmentIndex: -1, localTimeS: 0, priorSegmentsS: 0, stepCount: 0
    }))).toThrow(SimulationClockError);
    expect(() => deserializeClock(JSON.stringify({
      segmentIndex: 0, localTimeS: -5, priorSegmentsS: 0, stepCount: 0
    }))).toThrow(SimulationClockError);
  });

  it('validateClock: корректное состояние без проблем', () => {
    expect(validateClock(createSimulationClock())).toEqual([]);
    expect(validateClock(advance(createSimulationClock(), 42))).toEqual([]);
  });
});

describe('Stage 4.1 SimulationClock: локальное время ≠ космический возраст', () => {
  it('в состоянии часов нет полей космического возраста', () => {
    const clock = createSimulationClock();
    const keys = Object.keys(clock);
    expect(keys).not.toContain('cosmicAge');
    expect(keys).not.toContain('universeAge');
    expect(keys).not.toContain('epochAge');
    // возраст системы живёт отдельно, в CoreWorldState.cosmicAge
  });

  it('yearsToSeconds переводит годы явно (юлианский год)', () => {
    expect(yearsToSeconds(1)).toBe(3.15576e7);
    expect(yearsToSeconds(0)).toBe(0);
    expect(() => yearsToSeconds(-1)).toThrow(SimulationClockError);
    expect(() => yearsToSeconds(Number.POSITIVE_INFINITY)).toThrow(SimulationClockError);
  });
});
