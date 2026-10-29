// ============================================
// RANDOM - Детерминированная случайность
// ============================================

import type { Seed } from '../../types';

// Реализация псевдослучайного генератора на основе Xorshift
// Детерминированный и воспроизводимый при одинаковом seed
class DeterministicRandom {
  private state: number[];

  constructor(seed: Seed) {
    // Создаем начальное состояние из seed
    const seedHash = this.hashSeed(seed);
    this.state = [
      seedHash,
      seedHash * 1812433253 + 1,
      seedHash * 1664525 + 1013904223,
      seedHash * 1103515245 + 12345
    ];
  }

  private hashSeed(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Конвертация в 32-битное целое
    }
    return hash >>> 0;
  }

  // Xorshift алгоритм
  private nextInt(): number {
    let t = this.state[3];
    
    t = t ^ (t << 11);
    t = t ^ (t >>> 8);
    
    this.state[3] = this.state[2];
    this.state[2] = this.state[1];
    this.state[1] = this.state[0];
    
    t = t ^ (this.state[0] >>> 19);
    t = t ^ (this.state[0] << 14);
    
    this.state[0] = t;
    
    return t >>> 0;
  }

  // Возвращает число от 0 (включительно) до 1 (не включая)
  next(): number {
    return (this.nextInt() / 0x100000000) >>> 0;
  }

  // Возвращает целое число в диапазоне [min, max]
  nextIntRange(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Выбор случайного элемента из массива с равными весами
  choose<T>(items: T[]): T {
    const index = this.nextIntRange(0, items.length - 1);
    return items[index];
  }

  // Взвешенный случайный выбор
  chooseWeighted<T>(items: T[], weights: Record<string, number>, getId: (item: T) => string): T {
    // Создаем список с учетом весов
    const weightedList: T[] = [];
    
    for (const item of items) {
      const id = getId(item);
      const weight = weights[id] ?? weights[item as unknown as string] ?? 1;
      
      if (weight > 0) {
        for (let i = 0; i < weight; i++) {
          weightedList.push(item);
        }
      }
    }

    if (weightedList.length === 0) {
      throw new Error('No valid items with positive weights');
    }

    return this.choose(weightedList);
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

  // Генерация случайной строки
  generateId(prefix: string = 'id'): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = prefix + '_';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(this.nextIntRange(0, chars.length - 1));
    }
    return result;
  }

  // Генерация случайного числа с плавающей точкой в диапазоне
  nextFloatRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

// Глобальный экземпляр (не используется, нужно создавать для каждого seed)
// export const random = new DeterministicRandom('default');

// Фабричная функция для создания генератора с заданным seed
export function createRandom(seed: Seed): DeterministicRandom {
  return new DeterministicRandom(seed);
}

export { DeterministicRandom };
