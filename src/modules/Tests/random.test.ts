// ============================================
// TESTS - PRNG (Mulberry32) tests
// ============================================

import { describe, it, expect } from 'vitest';
import { createRandom } from '../Generator/random';

describe('Random Module (PRNG: Mulberry32)', () => {
  it('несколько вызовов next() не возвращают исключительно ноль', () => {
    const rng = createRandom('evowars_test');
    const values = Array.from({ length: 1000 }, () => rng.next());

    const zeros = values.filter(v => v === 0).length;
    expect(zeros).toBeLessThan(50);
    // Реальная случайность: почти все значения различны
    expect(new Set(values).size).toBeGreaterThan(900);
  });

  it('все значения next() находятся в диапазоне [0, 1)', () => {
    const rng = createRandom('range_test');
    const values = Array.from({ length: 10000 }, () => rng.next());

    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('повторное создание генератора с одним seed воспроизводит последовательность', () => {
    const first = createRandom('alpha');
    const second = createRandom('alpha');

    const seqA = Array.from({ length: 100 }, () => first.next());
    const seqB = Array.from({ length: 100 }, () => second.next());

    expect(seqA).toEqual(seqB);
  });

  it('разные seed дают разные последовательности', () => {
    const first = createRandom('alpha');
    const second = createRandom('beta');

    const seqA = Array.from({ length: 100 }, () => first.next());
    const seqB = Array.from({ length: 100 }, () => second.next());

    expect(seqA).not.toEqual(seqB);
  });

  describe('nextIntRange', () => {
    it('возвращает целые числа в заданных границах включительно', () => {
      const rng = createRandom('int_test');
      const values = Array.from({ length: 600 }, () => rng.nextIntRange(1, 6));

      for (const v of values) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
        expect(Number.isInteger(v)).toBe(true);
      }
      // Все значения диапазона достижимы
      expect(new Set(values).size).toBe(6);
    });

    it('выбрасывает понятную ошибку при max < min', () => {
      const rng = createRandom('bounds_test');
      expect(() => rng.nextIntRange(5, 1)).toThrow();
    });
  });

  describe('choose', () => {
    it('равномерно выбирает элементы массива', () => {
      const rng = createRandom('choose_test');
      const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };

      for (let i = 0; i < 1000; i++) {
        counts[rng.choose(['a', 'b', 'c', 'd'])]++;
      }

      // При равномерном выборе ни один элемент не выпадает (ожидание ~250)
      for (const key of ['a', 'b', 'c', 'd']) {
        expect(counts[key]).toBeGreaterThanOrEqual(150);
      }
    });

    it('выбрасывает ошибку для пустого массива', () => {
      const rng = createRandom('empty_test');
      expect(() => rng.choose([])).toThrow();
    });
  });

  describe('chooseWeighted', () => {
    it('корректно работает с дробными весами через накопительные суммы', () => {
      const rng = createRandom('weighted_test');
      const items = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
      const counts: Record<string, number> = { x: 0, y: 0, z: 0 };

      for (let i = 0; i < 10000; i++) {
        const chosen = rng.chooseWeighted(items, { x: 0.5, y: 2.5, z: 7 }, (item) => item.id);
        counts[chosen.id]++;
      }

      // Все варианты с положительным весом выбираются
      expect(counts.x).toBeGreaterThan(300);
      expect(counts.y).toBeGreaterThan(1500);
      expect(counts.z).toBeGreaterThan(5500);

      // Частоты пропорциональны весам (z/y ≈ 7/2.5 = 2.8)
      const ratio = counts.z / counts.y;
      expect(ratio).toBeGreaterThan(2.2);
      expect(ratio).toBeLessThan(3.6);
    });

    it('варианты с нулевым весом никогда не выбираются', () => {
      const rng = createRandom('zero_test');
      const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const counts: Record<string, number> = { a: 0, b: 0, c: 0 };

      for (let i = 0; i < 1000; i++) {
        const chosen = rng.chooseWeighted(items, { a: 0, b: 1, c: 1 }, (item) => item.id);
        counts[chosen.id]++;
      }

      expect(counts.a).toBe(0);
      expect(counts.b).toBeGreaterThan(300);
      expect(counts.c).toBeGreaterThan(300);
    });

    it('выбрасывает ошибку, если все веса нулевые', () => {
      const rng = createRandom('all_zero_test');
      const items = [{ id: 'a' }, { id: 'b' }];
      expect(() => rng.chooseWeighted(items, { a: 0, b: 0 }, (item) => item.id)).toThrow();
    });

    it('элемент без указанного веса получает вес по умолчанию', () => {
      const rng = createRandom('default_weight_test');
      const items = [{ id: 'a' }, { id: 'b' }];
      const chosen = rng.chooseWeighted(items, { a: 5 }, (item) => item.id);
      expect(items).toContain(chosen);
    });
  });

  describe('generateId', () => {
    it('создаёт корректные идентификаторы с префиксом', () => {
      const rng = createRandom('id_test');
      const id1 = rng.generateId('world');
      const id2 = rng.generateId('world');

      expect(id1).toMatch(/^world_[A-Za-z0-9]{8}$/);
      expect(id2).toMatch(/^world_[A-Za-z0-9]{8}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('shuffle', () => {
    it('сохраняет элементы массива при перемешивании', () => {
      const rng = createRandom('shuffle_test');
      const source = [1, 2, 3, 4, 5, 6, 7, 8];
      const shuffled = rng.shuffle(source);

      expect(shuffled).toHaveLength(source.length);
      expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
      expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // исходник не изменён
    });
  });
});
