// ============================================
// STAGE 4.2.1 - Тесты мировой временной системы (WorldClock)
// ============================================
//
// WorldClock — типизированный контракт ПОВЕРХ сегментированных часов
// SimulationClock (Stage 4.1): второго независимого числового поля
// прошедшего времени нет; локальное время не смешивается с
// космологическим возрастом; годы переводятся в секунды ТОЛЬКО явно.

import { describe, it, expect } from 'vitest';
import {
  WorldClockError,
  advanceWorldClock,
  advanceWorldClockYears,
  compareWorldMoments,
  createWorldClock,
  deserializeWorldClock,
  serializeWorldClock,
  validateWorldClock,
  worldClockElapsedSeconds,
  worldClockFromClock,
  worldClockNow,
  worldClockStartNewSegment
} from '../Core/worldClock';
import { createSimulationClock, yearsToSeconds } from '../Core/simulationClock';

describe('Stage 4.2.1 WorldClock: конструкция и продвижение', () => {
  it('старт с нуля: elapsed 0, момент (0, 0), валидация без проблем', () => {
    const wc = createWorldClock();
    expect(worldClockElapsedSeconds(wc)).toBe(0);
    expect(worldClockNow(wc)).toEqual({ segmentIndex: 0, localTimeS: 0 });
    expect(validateWorldClock(wc)).toEqual([]);
  });

  it('продвижение в секундах SI: 100 + 0.5', () => {
    let wc = createWorldClock();
    wc = advanceWorldClock(wc, 100);
    expect(worldClockElapsedSeconds(wc)).toBe(100);
    wc = advanceWorldClock(wc, 0.5);
    expect(worldClockElapsedSeconds(wc)).toBe(100.5);
    expect(worldClockNow(wc).localTimeS).toBe(100.5);
  });

  it('годы переводятся явно через yearsToSeconds (юлианский год)', () => {
    let wc = createWorldClock();
    wc = advanceWorldClockYears(wc, 1);
    expect(worldClockElapsedSeconds(wc)).toBe(yearsToSeconds(1));
    expect(yearsToSeconds(1)).toBe(3.15576e7);
  });

  it('некорректные интервалы — структурированная ошибка invalid_step', () => {
    const wc = createWorldClock();
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      let thrown = false;
      let code: string | null = null;
      try {
        advanceWorldClock(wc, bad);
      } catch (e) {
        thrown = true;
        code = (e as WorldClockError).code;
      }
      expect(thrown).toBe(true);
      expect(code).toBe('invalid_step');
    }
  });
});

describe('Stage 4.2.1 WorldClock: сегменты и порядок моментов', () => {
  it('ручное начало сегмента сохраняет прошедшее время', () => {
    let wc = advanceWorldClock(createWorldClock(), 100);
    wc = worldClockStartNewSegment(wc);
    expect(worldClockElapsedSeconds(wc)).toBe(100);
    expect(wc.clock.segmentIndex).toBe(1);
    expect(worldClockNow(wc)).toEqual({ segmentIndex: 1, localTimeS: 0 });
  });

  it('сравнение моментов корректно через границу сегментов', () => {
    let wc = advanceWorldClock(createWorldClock(), 100);
    wc = worldClockStartNewSegment(wc);
    wc = advanceWorldClock(wc, 5);
    const later = worldClockNow(wc);
    const earlier = { segmentIndex: 0, localTimeS: 100 };
    expect(compareWorldMoments(later, earlier)).toBe(1);
    expect(compareWorldMoments(earlier, later)).toBe(-1);
    expect(compareWorldMoments(later, worldClockNow(wc))).toBe(0);
  });
});

describe('Stage 4.2.1 WorldClock: нет второго поля времени', () => {
  it('validateWorldClock отклоняет посторонние поля (cosmicAge и т.п.)', () => {
    const bad = { clock: createSimulationClock(), cosmicAge: 5 } as unknown;
    const issues = validateWorldClock(bad);
    expect(issues.length).toBeGreaterThan(0);
  });

  it('worldClockFromClock отклоняет некорректные часы (invalid_state)', () => {
    const broken = { ...createSimulationClock(), localTimeS: -1 };
    let thrown = false;
    let code: string | null = null;
    try {
      worldClockFromClock(broken);
    } catch (e) {
      thrown = true;
      code = (e as WorldClockError).code;
    }
    expect(thrown).toBe(true);
    expect(code).toBe('invalid_state');
  });

  it('worldClockFromClock принимает корректные часы без пересчёта', () => {
    const clock = createSimulationClock();
    const wc = worldClockFromClock(clock);
    expect(wc.clock).toBe(clock);
  });
});

describe('Stage 4.2.1 WorldClock: сериализация и детерминизм', () => {
  it('round-trip сериализации восстанавливает состояние', () => {
    let wc = advanceWorldClockYears(createWorldClock(), 2);
    wc = advanceWorldClock(wc, 7);
    wc = worldClockStartNewSegment(wc);
    wc = advanceWorldClock(wc, 3);
    const restored = deserializeWorldClock(serializeWorldClock(wc));
    expect(restored).toEqual(wc);
    expect(validateWorldClock(restored)).toEqual([]);
  });

  it('повторный запуск с одинаковым входом даёт одинаковое состояние', () => {
    const chain = () => {
      let wc = createWorldClock();
      wc = advanceWorldClockYears(wc, 1);
      wc = advanceWorldClock(wc, 12.5);
      wc = worldClockStartNewSegment(wc);
      wc = advanceWorldClock(wc, 0.25);
      return wc;
    };
    expect(chain()).toEqual(chain());
  });
});
