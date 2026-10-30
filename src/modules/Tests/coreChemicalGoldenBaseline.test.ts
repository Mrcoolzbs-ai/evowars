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
import { createHash } from 'node:crypto';
import { generateWorld } from '../Generator';
import { runChemicalEvolutionStep } from '../ChemicalEvolution';
import type { GenerationSettings, ChemicalEvolutionState } from '../../types';

/** Seed контрольной траектории (фиксирован; смена ломает baseline). */
const GOLDEN_SEED = 'golden-baseline-4.2.1';
/** Число шагов контрольной траектории. */
const GOLDEN_STEPS = 100;
/**
 * Зафиксированный SHA-256 канонического снимка. Заполняется реальным
 * значением из CI-аннотации первого прогона (коммит B); null — хэш
 * ещё не зафиксирован, проверяются только формат и детерминизм.
 */
const GOLDEN_BASELINE_SHA256: string | null = null;

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
  const hash = createHash('sha256')
    .update(canonicalJson(chemicalSnapshot(state)), 'utf8')
    .digest('hex');
  return { hash, state };
}

describe('Stage 4.2.1 §0.1: golden baseline химической эволюции', () => {
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
    console.log(
      'GOLDEN-BASELINE-4.2.1 sha256=' + hash +
      ' steps=' + String(GOLDEN_STEPS) +
      ' modelTimeYears=' + String(state.modelTimeYears) +
      ' reactionRecords=' + String(state.history.length) +
      ' oxygenNet=' + String(state.oxygenBalance.net)
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    if (GOLDEN_BASELINE_SHA256 !== null) {
      expect(hash).toBe(GOLDEN_BASELINE_SHA256);
    }
  });
});
