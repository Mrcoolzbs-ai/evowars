// ============================================
// BENCHMARK — N-body динамика: leapfrog KDK (Stage 4.6.1-A)
// ============================================
//
// Обязательный benchmark этапа: 10^4 орбитальных периодов двухтельной
// задачи Солнце–Земля, три уменьшающихся timestep, дрейф энергии < 1e-6.
//
// ПЛОТНЫЙ контроль: controlStateCount = 1001 (sampleEverySteps =
// totalSteps/1000). Плотный сэмпл обязателен: редкий контроль
// страдает алиасингом и занижает измеренный дрейф.
//
// Эталонные измеренные значения (запись 2026-11-15, Node/V8, double,
// барицентрические начальные условия, плотный контроль 1001 состояние):
//   делитель  250 → maxEnergyDriftRelative = 9.965e-8
//   делитель  500 → maxEnergyDriftRelative = 1.007e-9
//   делитель 1000 → maxEnergyDriftRelative = 4.674e-12
// Дрейф монотонно падает с уменьшением timestep (сходимость 2-го порядка).
//
// Эти строки — СПРАВОЧНЫЕ. Тест проверяет порог этапа (< 1e-6) и падение
// дрейфа с уменьшением шага; он НЕ переписывает эталонные числа и не
// является golden baseline (авто-обновления запрещены этапом 4.6.1-A).

import { describe, it, expect } from 'vitest';
import { G } from '../../src/modules/Units/index';
import { integrateNBodyLeapfrog } from '../../src/modules/OrbitalMechanics/dynamics';
import type { NBodyInitialState } from '../../src/modules/OrbitalMechanics/dynamics';

const M_SUN = 1.989e30;
const M_EARTH = 5.9722e24;
const AU = 1.495978707e11;
const MU = G * (M_SUN + M_EARTH);
/** Период двухтельной задачи Солнце–Земля. */
const P_EARTH = 2 * Math.PI * Math.sqrt((AU * AU * AU) / MU);
/** Горизонт benchmark: 10^4 орбитальных периодов. */
const PERIODS = 10000;

const V_REL = Math.sqrt(MU / AU);
const R_EARTH = AU * (M_SUN / (M_SUN + M_EARTH));
const R_SUN = AU * (M_EARTH / (M_SUN + M_EARTH));
const V_EARTH = V_REL * (M_SUN / (M_SUN + M_EARTH));
const V_SUN = V_REL * (M_EARTH / (M_SUN + M_EARTH));

function sunEarth(): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      { id: 'earth', massKg: M_EARTH, radiusM: null, positionM: { x: R_EARTH, y: 0, z: 0 }, velocityMPerS: { x: 0, y: V_EARTH, z: 0 } },
      { id: 'sun', massKg: M_SUN, radiusM: null, positionM: { x: -R_SUN, y: 0, z: 0 }, velocityMPerS: { x: 0, y: -V_SUN, z: 0 } }
    ]
  };
}

/** Плотный benchmark: один делитель шага, 1001 контрольное состояние. */
function runBenchmark(divisor: number): { maxEnergyDriftRelative: number; controlStateCount: number; totalSteps: number } {
  const timeStepS = P_EARTH / divisor;
  const totalSteps = divisor * PERIODS;
  const sampleEverySteps = totalSteps / 1000;
  const result = integrateNBodyLeapfrog(sunEarth(), { timeStepS, durationS: PERIODS * P_EARTH, sampleEverySteps, maxSteps: totalSteps });
  if (result.status !== 'completed') {
    throw new Error(`benchmark не завершился: ${result.status} (делитель ${divisor})`);
  }
  return {
    maxEnergyDriftRelative: result.conservation.maxEnergyDriftRelative,
    controlStateCount: result.conservation.controlStateCount,
    totalSteps
  };
}

describe('benchmark: 10^4 периодов Солнце–Земля, плотный контроль (1001 состояние)', () => {
  it('dt = P/250: дрейф энергии < 1e-6 (эталон 9.965e-8)', () => {
    const run = runBenchmark(250);
    expect(run.controlStateCount).toBe(1001);
    expect(run.totalSteps).toBe(2_500_000);
    expect(run.maxEnergyDriftRelative).toBeLessThan(1e-6);
  }, 3_600_000);

  it('dt = P/500: дрейф энергии < 1e-6 (эталон 1.007e-9)', () => {
    const run = runBenchmark(500);
    expect(run.controlStateCount).toBe(1001);
    expect(run.totalSteps).toBe(5_000_000);
    expect(run.maxEnergyDriftRelative).toBeLessThan(1e-6);
  }, 3_600_000);

  it('dt = P/1000: дрейф энергии < 1e-6 (эталон 4.674e-12)', () => {
    const run = runBenchmark(1000);
    expect(run.controlStateCount).toBe(1001);
    expect(run.totalSteps).toBe(10_000_000);
    expect(run.maxEnergyDriftRelative).toBeLessThan(1e-6);
  }, 3_600_000);

  it('дрейф энергии монотонно падает с уменьшением timestep', () => {
    const d250 = runBenchmark(250).maxEnergyDriftRelative;
    const d500 = runBenchmark(500).maxEnergyDriftRelative;
    const d1000 = runBenchmark(1000).maxEnergyDriftRelative;
    expect(d500).toBeLessThan(d250);
    expect(d1000).toBeLessThan(d500);
  }, 3_600_000);
});
