// ============================================
// RANDOM - Детерминированная случайность
// ============================================

import type { Seed } from '../../types';

// ============================================
// PRNG: Mulberry32
// ============================================
//
// Проверенная компактная реализация псевдослучайного
// генератора Mulberry32 (автор: Tommy Ettinger / bryc).
// Свойства:
// - период 2^32, хорошее распределение бит;
// - next() возвращает действительное число строго в [0, 1);
// - детерминирован: одинаковый seed => одинаковая последовательность;
// - разные seed дают разные последовательности (seed проходит
//   FNV-1a хеш + лавинное перемешивание).
//
// Предыдущая реализация на Xorshift содержала критическую ошибку:
//   return (this.nextInt() / 0x100000000) >>> 0;
// Приведение `>>> 0` превращало дробное число в 0, поэтому
// next() всегда возвращал ноль и вся генерация вырождалась.

class DeterministicRandom {
  private state: number;

  constructor(seed: Seed) {
    this.state = this.hashSeed(seed);
  }

  // FNV-1a 32-bit + лавинное перемешивание (avalanche finisher).
  // Гарантирует, что похожие seed дают сильно различающиеся состояния.
  private hashSeed(seed: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  // Базовое 32-битное целое Mulberry32
  private nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  // Возвращает действительное число в диапазоне [0, 1).
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  // Возвращает целое число в диапазоне [min, max] (оба включительно).
  nextIntRange(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`nextIntRange: границы должны быть числами (min=${min}, max=${max})`);
    }
    if (max < min) {
      throw new Error(`nextIntRange: max (${max}) не может быть меньше min (${min})`);
    }
    const range = max - min + 1;
    // Для корректной равномерности используем целочисленный диапазон
    // без потери точности: floor(next() * range) покрывает [0, range - 1].
    return Math.floor(this.next() * range) + min;
  }

  // Выбор случайного элемента из массива (равномерное распределение).
  choose<T>(items: T[]): T {
    if (items.length === 0) {
      throw new Error('choose: массив элементов пуст');
    }
    const index = this.nextIntRange(0, items.length - 1);
    return items[index];
  }

  // Взвешенный случайный выбор.
  //
  // Реализован через накопительные суммы (cumulative weights):
  // элементы НЕ повторяются в массиве для имитации весов, поэтому
  // поддерживаются произвольные вещественные веса (0.001, 2.5, 100 и т.д.).
  //
  // - Вес берётся по ключу getId(item); для строковых элементов
  //   дополнительно допускается ключ, равный самому элементу.
  // - Элементы с нулевым (или отрицательным/некорректным) весом
  //   полностью исключаются из выбора.
  // - Если не осталось ни одного элемента с положительным весом — ошибка.
  chooseWeighted<T>(items: T[], weights: Record<string, number>, getId: (item: T) => string): T {
    const weighted: { item: T; weight: number }[] = [];

    for (const item of items) {
      const id = getId(item);
      let weight = weights[id];
      if (weight === undefined && typeof item === 'string') {
        weight = weights[item];
      }
      const effectiveWeight = weight === undefined ? 1 : weight;

      // Нулевой и отрицательный вес полностью исключает вариант.
      if (Number.isFinite(effectiveWeight) && effectiveWeight > 0) {
        weighted.push({ item, weight: effectiveWeight });
      }
    }

    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (weighted.length === 0 || totalWeight <= 0) {
      throw new Error('chooseWeighted: нет элементов с положительным весом');
    }

    // Накопительные суммы: выбираем точку на шкале [0, totalWeight).
    const point = this.next() * totalWeight;
    let cumulative = 0;
    for (const entry of weighted) {
      cumulative += entry.weight;
      if (point < cumulative) {
        return entry.item;
      }
    }

    // На случай ошибок округления с плавающей точкой — последний элемент.
    return weighted[weighted.length - 1].item;
  }

  // Перемешивание массива (алгоритм Фишера-Йетса)
  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextIntRange(0, i);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  // Генерация случайного идентификатора: prefix_XXXXXXXX,
  // где X — буквы и цифры.
  generateId(prefix: string = 'id'): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = prefix + '_';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(this.nextIntRange(0, chars.length - 1));
    }
    return result;
  }

  // Генерация случайного числа с плавающей точкой в диапазоне [min, max)
  nextFloatRange(min: number, max: number): number {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error(`nextFloatRange: границы должны быть числами (min=${min}, max=${max})`);
    }
    if (max < min) {
      throw new Error(`nextFloatRange: max (${max}) не может быть меньше min (${min})`);
    }
    return min + this.next() * (max - min);
  }
}

// Фабричная функция для создания генератора с заданным seed
export function createRandom(seed: Seed): DeterministicRandom {
  return new DeterministicRandom(seed);
}

export { DeterministicRandom };

export default { createRandom, DeterministicRandom };
