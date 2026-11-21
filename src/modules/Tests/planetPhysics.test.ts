// ============================================
// TESTS - Физические параметры планеты (этап 3)
// ============================================

import { describe, it, expect } from 'vitest';
import { sampleBodyPhysics } from '../WorldModel';
import { celestialBodies } from '../Data';
import { createRandom } from '../Generator/random';
import { G, earthMassesToKg, earthRadiiToM, ms2ToG } from '../Units';

describe('Физические параметры планеты (этап 3)', () => {
  describe('проверка формул гравитации и плотности', () => {
    it('g = GM/R² для 1 M⊕ и 1 R⊕ даёт ~9.82 м/с²', () => {
      const massKg = earthMassesToKg(1);
      const radiusM = earthRadiiToM(1);
      const g = (G * massKg) / (radiusM * radiusM);
      expect(g).toBeGreaterThan(9.8);
      expect(g).toBeLessThan(9.84);
      // В земных g — около единицы.
      expect(ms2ToG(g)).toBeCloseTo(1, 1);
    });

    it('плотность ρ = M / (4/3·π·R³) для Земли даёт ~5510 кг/м³', () => {
      const massKg = earthMassesToKg(1);
      const radiusM = earthRadiiToM(1);
      const density = massKg / ((4 / 3) * Math.PI * radiusM ** 3);
      expect(density).toBeGreaterThan(5400);
      expect(density).toBeLessThan(5600);
    });

    it('согласованность единиц: удвоение массы при том же радиусе удваивает g и плотность', () => {
      const m1 = earthMassesToKg(1);
      const m2 = earthMassesToKg(2);
      const r = earthRadiiToM(1);
      const g1 = (G * m1) / (r * r);
      const g2 = (G * m2) / (r * r);
      expect(g2 / g1).toBeCloseTo(2, 10);

      const d1 = m1 / ((4 / 3) * Math.PI * r ** 3);
      const d2 = m2 / ((4 / 3) * Math.PI * r ** 3);
      expect(d2 / d1).toBeCloseTo(2, 10);
    });
  });

  describe('sampleBodyPhysics: сэмплирование из диапазонов каталога', () => {
    it('все тела каталога имеют диапазоны массы и радиуса', () => {
      for (const body of celestialBodies) {
        expect(body.massRange).toBeDefined();
        expect(body.radiusRange).toBeDefined();
        expect(body.massRange!.min).toBeLessThan(body.massRange!.max);
        expect(body.radiusRange!.min).toBeLessThan(body.radiusRange!.max);
      }
    });

    it('сэмплированные значения лежат в границах диапазонов каталога', () => {
      for (const body of celestialBodies) {
        for (let i = 0; i < 10; i++) {
          const sample = sampleBodyPhysics(body, createRandom(`${body.id}_${i}`));
          const massEarth = sample.massKg.value as number / earthMassesToKg(1);
          const radiusEarth = sample.radiusM.value as number / earthRadiiToM(1);
          expect(massEarth).toBeGreaterThanOrEqual(body.massRange!.min);
          expect(massEarth).toBeLessThanOrEqual(body.massRange!.max);
          expect(radiusEarth).toBeGreaterThanOrEqual(body.radiusRange!.min);
          expect(radiusEarth).toBeLessThanOrEqual(body.radiusRange!.max);
        }
      }
    });

    it('гравитация и плотность вычислены из сэмплированной массы и радиуса', () => {
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const sample = sampleBodyPhysics(body, createRandom('earth_physics'));
      const massKg = sample.massKg.value as number;
      const radiusM = sample.radiusM.value as number;

      expect(sample.surfaceGravityMs2.value).toBeCloseTo((G * massKg) / (radiusM * radiusM), 6);
      expect(sample.densityKgM3.value).toBeCloseTo(
        massKg / ((4 / 3) * Math.PI * radiusM ** 3),
        6
      );
    });

    it('масса НЕ постоянна для всех объектов одного класса', () => {
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const masses = [1, 2, 3, 4, 5, 6, 7, 8].map(i =>
        sampleBodyPhysics(body, createRandom(`mass_variety_${i}`)).massKg.value
      );
      const distinct = new Set(masses.map(m => (m as number).toPrecision(8)));
      expect(distinct.size).toBeGreaterThan(3);
    });

    it('физическая согласованность: плотность в правдоподобном диапазоне', () => {
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const sample = sampleBodyPhysics(body, createRandom('consistent'));
      expect(sample.consistencyCheck.plausible).toBe(true);
      expect(sample.consistencyCheck.densityRangeKgM3.min).toBeGreaterThan(0);
      const density = sample.densityKgM3.value as number;
      expect(density).toBeGreaterThanOrEqual(sample.consistencyCheck.densityRangeKgM3.min);
      expect(density).toBeLessThanOrEqual(sample.consistencyCheck.densityRangeKgM3.max);
    });

    it('небольшая планета не получает земную гравитацию автоматически', () => {
      const small = celestialBodies.find(b => b.id === 'small_planet')!;
      for (let i = 0; i < 10; i++) {
        const sample = sampleBodyPhysics(small, createRandom(`small_g_${i}`));
        const gInG = ms2ToG(sample.surfaceGravityMs2.value as number);
        // Диапазон каталога 0.01-0.1 M⊕ и 0.2-0.5 R⊕ даёт малую гравитацию.
        expect(gInG).toBeLessThan(1);
      }
    });

    it('детерминизм: один seed воспроизводит одинаковые физические параметры', () => {
      const body = celestialBodies.find(b => b.id === 'super_earth')!;
      const a = sampleBodyPhysics(body, createRandom('determinism_seed'));
      const b = sampleBodyPhysics(body, createRandom('determinism_seed'));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('значения помечены как оценки (estimated) с указанием метода', () => {
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const sample = sampleBodyPhysics(body, createRandom('confidence_check'));
      expect(sample.massKg.confidence).toBe('estimated');
      expect(sample.densityKgM3.confidence).toBe('derived');
      expect(sample.surfaceGravityMs2.confidence).toBe('derived');
      expect(sample.surfaceGravityMs2.formula).toContain('G');
    });
  });
});
