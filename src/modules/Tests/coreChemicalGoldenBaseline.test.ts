// ============================================
// STAGE 4.2.1 §0.1 — GOLDEN BASELINE ХИМИЧЕСКОЙ ЭВОЛЮЦИИ
// ============================================
//
// Контрольная траектория ДО изменения архитектуры времени и
// планировщика: generateWorld() → runChemicalEvolutionStep() × 100
// при фиксированном seed и фиксированных GenerationSettings.
//
// Снимок содержит ТОЛЬКО измеримые научные поля химического
// состояния; createdAt, wall-clock время и другие
// недетерминированные метаданные в снимок НЕ входят.
//
// Хэш вычисляется РЕАЛЬНО выполняемым кодом на исходной версии
// (коммит A: проверяются формат и детерминизм), затем фиксируется
// константой GOLDEN_BASELINE_SHA256 (коммит B). Ожидаемое значение
// НЕ выдумывается: в файл попадает только хэш, рассчитанный
// фактически выполненной программой.
//
// Назначение: обязательная регрессия перед переводом ChemicalEvolution
// на общий Scheduler (Stage 4.2.3). После интеграции химии в
// планировщик контрольная траектория обязана воспроизводиться
// численно по всем измеримым научным полям.

import { describe, it, expect } from 'vitest';
// tsconfig проекта не включает 'node' в types: типы Node недоступны,
// поэтому импорт подавлен явно. Запись диагностического файла —
// единственная цель этого импорта (см. тест пина хэша).
// @ts-expect-error типы node:fs не подключены в tsconfig проекта
import { writeFileSync } from 'node:fs';
import { generateWorld } from '../Generator';
import { runChemicalEvolutionStep } from '../ChemicalEvolution';
import type { GenerationSettings, ChemicalEvolutionState } from '../../types';

/** Seed контрольной траектории (фиксирован; смена ломает baseline). */
const GOLDEN_SEED = 'golden-baseline-4.2.1';
/** Число шагов контрольной траектории. */
const GOLDEN_STEPS = 100;
/**
 * Зафиксированный SHA-256 канонического снимка контрольной траектории
 * (коммит B). Значение взято из фактического прогона коммита A:
 * CI run #37 (run id 41123636035), notice-аннотация «Golden baseline».
 * Хэш рассчитан реально выполненной программой, а не назначен вручную.
 *
 * Контрольные величины того же прогона: steps=100,
 * modelTimeYears=100000000, reactionRecords=0 (реакции каталога не
 * применимы к сгенерированной метановой атмосфере без O₂ — в истории
 * нет применённых записей), oxygenNet=0.
 */
const GOLDEN_BASELINE_SHA256: string | null = '877e17d346da3618ec5d15aced90c68da8a4bbb34ff18cb78023e756c1d85b20';

// ============================================
// SHA-256 (чистая реализация, без типов Node)
// ============================================
//
// tsconfig проекта не включает 'node' в поле types, поэтому
// 'node:crypto' недоступен типам тестов. SHA-256 реализован здесь
// явно и проверяется на известных контрольных векторах FIPS 180-4
// (см. тест ниже): это стандартный алгоритм, а не «выдуманный хэш».
// Назначение хэша — устойчивая свёртка контрольного снимка, а не
// криптографическая защита.

/** UTF-8 кодирование строки в байты (по кодовым точкам). */
function utf8Bytes(message: string): number[] {
  const out: number[] = [];
  for (const ch of message) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
  }
  return out;
}

/** SHA-256 от UTF-8 байтов сообщения (FIPS 180-4). */
function sha256Hex(message: string): string {
  const bytes = utf8Bytes(message);
  const bitLen = bytes.length * 8;
  const padded: number[] = [...bytes];
  padded.push(0x80);
  while (padded.length % 64 !== 56) {
    padded.push(0);
  }
  const hi = Math.floor(bitLen / 2 ** 32);
  const lo = bitLen >>> 0;
  padded.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  padded.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;
  for (let off = 0; off < padded.length; off += 64) {
    const w = new Array<number>(64);
    for (let i = 0; i < 16; i++) {
      w[i] = ((padded[off + 4 * i] << 24) | (padded[off + 4 * i + 1] << 16) |
        (padded[off + 4 * i + 2] << 8) | padded[off + 4 * i + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const toHex = (x: number): string => x.toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

/** GenerationSettings контрольной траектории (детерминированы). */
function goldenSettings(): GenerationSettings {
  return {
    seed: GOLDEN_SEED,
    mode: 'realistic',
    weights: { cosmology: {}, epoch: {}, centralObject: {}, celestialBody: {}, cradle: {} },
    fixedCategories: {},
    enableChemicalEvolution: true,
    chemicalEvolutionSteps: GOLDEN_STEPS
  };
}

/** Канонический JSON: рекурсивная сортировка ключей объектов. */
function canonicalJson(value: unknown): string {
  const canonicalize = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map(canonicalize);
    }
    if (v !== null && typeof v === 'object') {
      const record = v as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) {
        sorted[key] = canonicalize(record[key]);
      }
      return sorted;
    }
    return v;
  };
  return JSON.stringify(canonicalize(value));
}

/**
 * Снимок химического состояния: ТОЛЬКО измеримые научные поля.
 * Недетерминированные метаданные (createdAt и wall-clock) исключены
 * контрактом baseline: их изменение не должно влиять на хэш.
 */
function chemicalSnapshot(state: ChemicalEvolutionState): Record<string, unknown> {
  return {
    mode: state.mode,
    unitsNote: state.unitsNote,
    inventory: state.inventory,
    reservoirs: state.reservoirs,
    molarFractions: state.molarFractions,
    surfacePressurePa: state.surfacePressurePa,
    gravityMs2: state.gravityMs2,
    meanMolarMassKgMol: state.meanMolarMassKgMol,
    modelTimeYears: state.modelTimeYears,
    stepDurationYears: state.stepDurationYears,
    history: state.history,
    oxygenBalance: state.oxygenBalance,
    notes: state.notes
  };
}

/** Контрольная траектория: генерация мира + 100 глобальных шагов химии. */
function runGoldenTrajectory() {
  let world = generateWorld(goldenSettings());
  for (let step = 0; step < GOLDEN_STEPS; step++) {
    world = runChemicalEvolutionStep(world).world;
  }
  return world;
}

/** Хэш контрольной траектории + конечное химическое состояние. */
function goldenHash(): { hash: string; state: ChemicalEvolutionState } {
  const world = runGoldenTrajectory();
  const state = world.chemicalState;
  if (!state) {
    throw new Error('контрольная траектория завершилась без chemicalState: baseline невозможен');
  }
  const hash = sha256Hex(canonicalJson(chemicalSnapshot(state)));
  return { hash, state };
}

describe('Stage 4.2.1 §0.1: golden baseline химической эволюции', () => {
  it('реализация SHA-256 соответствует контрольным векторам FIPS 180-4', () => {
    // Хэш baseline — стандартный SHA-256, а не «выдуманная свёртка»:
    // реализация проверяется на известных векторах до использования.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('hello world')).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
  });

  it('контрольная траектория 100 шагов детерминирована: два прогона идентичны', () => {
    const first = goldenHash();
    const second = goldenHash();
    expect(canonicalJson(chemicalSnapshot(first.state))).toBe(
      canonicalJson(chemicalSnapshot(second.state))
    );
    expect(first.hash).toBe(second.hash);
  });

  it('инварианты траектории: время кумулятивно, производство O₂ без источников нулевое', () => {
    const { state } = goldenHash();
    // один вызов runChemicalEvolutionStep = ровно один шаг модельного
    // времени независимо от числа применившихся реакций (Stage 3.1.2)
    expect(state.modelTimeYears).toBeCloseTo(GOLDEN_STEPS * state.stepDurationYears, 6);
    // длительность шага генератора — игровое допущение по умолчанию
    expect(state.stepDurationYears).toBe(1e6);
    // источники O₂ отключены: производство = 0, итог = −расход
    expect(state.oxygenBalance.production).toBe(0);
    expect(state.oxygenBalance.net).toBeCloseTo(-state.oxygenBalance.consumption, 12);
  });

  it('SHA-256 канонического снимка зафиксирован', () => {
    const { hash, state } = goldenHash();
    // Линия для CI-аннотации: фактический хэш реального прогона.
    // Запись в файл детерминирована и не зависит от перехвата
    // консольного вывода раннером; CI публикует строку notice-аннотацией.
    const line =
      'GOLDEN-BASELINE-4.2.1 sha256=' + hash +
      ' steps=' + String(GOLDEN_STEPS) +
      ' modelTimeYears=' + String(state.modelTimeYears) +
      ' reactionRecords=' + String(state.history.length) +
      ' oxygenNet=' + String(state.oxygenBalance.net);
    writeFileSync('golden-baseline.txt', line + '\n');
    console.log(line);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    if (GOLDEN_BASELINE_SHA256 !== null) {
      expect(hash).toBe(GOLDEN_BASELINE_SHA256);
    }
  });
});
