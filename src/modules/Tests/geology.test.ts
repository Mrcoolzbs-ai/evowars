// ============================================
// TESTS - Geology (этап 3: внутреннее тепло)
// ============================================

import { describe, it, expect } from 'vitest';
import { analyzeGeology } from '../Geology';
import { sampleOrbit } from '../OrbitalMechanics';
import { celestialBodies, centralObjects } from '../Data';
import { createRandom } from '../Generator/random';
import type { OrbitalConfigurationData } from '../../types';

function findBody(id: string) {
  const body = celestialBodies.find(b => b.id === id);
  if (!body) throw new Error(`Body ${id} not found`);
  return body;
}

/** Орбита спутника вокруг родительской планеты с заданным эксцентриситетом. */
function makeMoonOrbit(eccentricity: number): OrbitalConfigurationData {
  return {
    ...sampleOrbit(createRandom('moon_geo'), {
      centralObject: centralObjects.find(o => o.id === 'lone_gas_giant')!,
      celestialBody: findBody('gas_giant_moon'),
      parentBodyRadiusM: 6.9911e7
    }),
    eccentricity: { value: eccentricity, unit: 'безразмерный', confidence: 'game_assumption' }
  } as OrbitalConfigurationData;
}

describe('Geology (внутренние источники тепла, этап 3)', () => {
  describe('раздельный учёт источников внутреннего тепла', () => {
    it('анализ возвращает три независимых источника + суммарный уровень', () => {
      const analysis = analyzeGeology({ celestialBody: findBody('earth_like') });
      expect(analysis.primordialHeat.sourceId).toBe('primordial');
      expect(analysis.radiogenicHeat.sourceId).toBe('radiogenic');
      expect(analysis.tidalHeat.sourceId).toBe('tidal');
      expect(['high', 'moderate', 'low', 'none']).toContain(analysis.totalInternalHeat);
    });

    it('массивная планета: остаточное и радиогенное тепло оцениваются умеренно или выше', () => {
      const analysis = analyzeGeology({ celestialBody: findBody('earth_like') });
      // Средняя точка диапазона масс earth_like = 1.25 M⊕.
      expect(analysis.primordialHeat.level).toBe('moderate');
      expect(analysis.radiogenicHeat.level).toBe('moderate');
      expect(analysis.primordialHeat.confidence).toBe('estimated');
    });

    it('мощности источников в ваттах не вычисляются', () => {
      const analysis = analyzeGeology({ celestialBody: findBody('super_earth') });
      for (const source of [analysis.primordialHeat, analysis.radiogenicHeat, analysis.tidalHeat]) {
        expect(source.note).not.toMatch(/\d+ ?Вт/);
      }
      expect(analysis.notes.join(' ')).toContain('не вычисляются');
    });
  });

  describe('геотермальная энергия не добавляется автоматически', () => {
    it('малая планета: суммарный уровень низкий, геотермальная энергия недоступна', () => {
      const analysis = analyzeGeology({ celestialBody: findBody('small_planet') });
      // small_planet: средняя масса 0.055 M⊕ → primordial low, radiogenic low.
      expect(analysis.primordialHeat.level).toBe('low');
      expect(analysis.radiogenicHeat.level).toBe('low');
      expect(analysis.totalInternalHeat).toBe('low');
      expect(analysis.geothermalEnergyAvailable).toBe(false);
    });

    it('вывод о тектонике не делается по названию типа планеты', () => {
      // У ocean_planet нет геологических свойств «активная тектоника»,
      // но анализ опирается только на массу и состав.
      const analysis = analyzeGeology({ celestialBody: findBody('ocean_planet') });
      const mid = (findBody('ocean_planet').massRange!.min + findBody('ocean_planet').massRange!.max) / 2;
      const expectedPrimordial = mid <= 3 ? 'moderate' : 'high';
      expect(analysis.primordialHeat.level).toBe(expectedPrimordial);
    });
  });

  describe('приливный нагрев', () => {
    it('не-спутник: приливный нагрев не оценивается', () => {
      const analysis = analyzeGeology({ celestialBody: findBody('earth_like') });
      expect(analysis.tidalHeat.level).toBeNull();
      expect(analysis.tidalHeat.status).toBe('not_estimated');
    });

    it('спутник без орбитальных данных: приливный нагрев не оценивается', () => {
      const analysis = analyzeGeology({ celestialBody: findBody('gas_giant_moon') });
      expect(analysis.tidalHeat.level).toBeNull();
      expect(analysis.tidalHeat.status).toBe('not_estimated');
    });

    it('спутник на орбите вокруг родителя с e > 0.05: возможен приливный нагрев (без мощности)', () => {
      const analysis = analyzeGeology({
        celestialBody: findBody('gas_giant_moon'),
        orbit: makeMoonOrbit(0.2)
      });
      expect(analysis.tidalHeat.status).toBe('potential');
      expect(analysis.tidalHeat.level).toBeNull(); // мощность НЕ вычисляется
      expect(analysis.tidalHeat.confidence).toBe('hypothetical');
      expect(analysis.tidalHeat.note).toContain('мощность НЕ вычисляется');
    });

    it('почти круговая орбита (e ≤ 0.05): приливная диссипация пренебрежима', () => {
      const analysis = analyzeGeology({
        celestialBody: findBody('gas_giant_moon'),
        orbit: makeMoonOrbit(0.01)
      });
      expect(analysis.tidalHeat.level).toBe('negligible');
    });

    it('радиогенный нагрев спутника газового гиганта не выдумывается', () => {
      // Состав недр спутника в каталоге не задан → оценка не производится.
      const analysis = analyzeGeology({ celestialBody: findBody('gas_giant_moon') });
      expect(analysis.radiogenicHeat.level).toBeNull();
      expect(analysis.radiogenicHeat.status).toBe('not_estimated');
      expect(analysis.radiogenicHeat.note).toContain('не оценивается');
    });
  });

  describe('честная неопределённость', () => {
    it('гидротермальные системы и подземные резервуары остаются неизвестными', () => {
      const analysis = analyzeGeology({ celestialBody: findBody('earth_like') });
      expect(analysis.hydrothermalSystems).toBeNull();
      expect(analysis.subsurfaceLiquidReservoirs).toBeNull();
    });

    it('вулканизм: высокое тепло → возможен, низкое → маловероятен', () => {
      const high = analyzeGeology({ celestialBody: findBody('earth_like') });
      expect(high.totalInternalHeat).toBe('high'); // 2 источника moderate → усиление
      expect(high.volcanism).toBe(true);

      const low = analyzeGeology({ celestialBody: findBody('small_planet') });
      expect(low.totalInternalHeat).toBe('low');
      expect(low.volcanism).toBe(false);
    });

    it('геохимические градиенты перечисляются как потенциальные', () => {
      const analysis = analyzeGeology({ celestialBody: findBody('earth_like') });
      expect(analysis.geochemicalGradients.length).toBeGreaterThan(0);
      expect(analysis.geochemicalGradients.every(g => g.includes('потенциальн') || g.includes('приливн') || g.includes('не выявлено')))
        .toBe(true);
    });
  });
});
