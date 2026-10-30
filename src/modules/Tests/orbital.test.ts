// ============================================
// TESTS - OrbitalMechanics (этап 3: орбиты и поток энергии)
// ============================================

import { describe, it, expect } from 'vitest';
import {
  incidentFlux,
  equilibriumTemperature,
  sampleOrbit,
  solarConstantCheck,
  orbitalPeriodFromElements,
  existsInEpoch,
  ORBIT_BANDS
} from '../OrbitalMechanics';
import { checkCompatibility } from '../Compatibility';
import { getTypicalLifetimeGyr, getRepresentativeLuminosityW } from '../Data/starPhysical';
import { createRandom } from '../Generator/random';
import { L_SUN_W, AU_M, M_EARTH_KG } from '../Units';
import { epochs, centralObjects, celestialBodies, cosmologies } from '../Data';
import type { GeneratedWorld } from '../../types';

describe('OrbitalMechanics (поток энергии и орбиты, этап 3)', () => {
  describe('энергетический поток F = L / (4πa²)', () => {
    it('солнечная постоянная: L_☉ на 1 а.е. ≈ 1361 Вт/м²', () => {
      const flux = incidentFlux(L_SUN_W, AU_M);
      expect(flux).not.toBeNull();
      expect(flux as number).toBeCloseTo(1361, 0);
      // Встроенная самопроверка модуля
      expect(solarConstantCheck()).toBeCloseTo(1361, 0);
    });

    it('поток обратно пропорционален квадрату расстояния: F(2a) = F(a)/4', () => {
      const f1 = incidentFlux(L_SUN_W, AU_M);
      const f2 = incidentFlux(L_SUN_W, 2 * AU_M);
      expect(f1).not.toBeNull();
      expect(f2).not.toBeNull();
      expect((f2 as number) / (f1 as number)).toBeCloseTo(0.25, 10);
    });

    it('при неизвестной светимости поток НЕ выдумывается: null, а не 0', () => {
      // Чёрная дыра: излучение зависит от аккреции и не гарантируется.
      expect(getRepresentativeLuminosityW('black_hole')).toBeNull();
      expect(incidentFlux(null, AU_M)).toBeNull();

      // При неизвестном расстоянии поток также неизвестен.
      expect(incidentFlux(L_SUN_W, null)).toBeNull();
    });
  });

  describe('равновесная температура T_eq = [F(1-A)/(4σ)]^(1/4)', () => {
    it('T_eq для Земли при A=0.3 ≈ 254.6 K', () => {
      const flux = incidentFlux(L_SUN_W, AU_M) as number;
      const t = equilibriumTemperature(flux);
      expect(t).not.toBeNull();
      expect(t as number).toBeCloseTo(254.6, 0);
    });

    it('T_eq падает с ростом альбедо Бонда', () => {
      const flux = incidentFlux(L_SUN_W, AU_M) as number;
      const tLow = equilibriumTemperature(flux, { bondAlbedo: 0.1 }) as number;
      const tMid = equilibriumTemperature(flux, { bondAlbedo: 0.3 }) as number;
      const tHigh = equilibriumTemperature(flux, { bondAlbedo: 0.6 }) as number;
      expect(tLow).toBeGreaterThan(tMid);
      expect(tMid).toBeGreaterThan(tHigh);
    });

    it('без потока T_eq не рассчитывается: null вместо произвольной температуры', () => {
      expect(equilibriumTemperature(null)).toBeNull();
    });

    it('коэффициент перераспределения тепла — явное изменяемое допущение', () => {
      const flux = incidentFlux(L_SUN_W, AU_M) as number;
      const tEven = equilibriumTemperature(flux, { redistribution: 1 }) as number;
      const tDayside = equilibriumTemperature(flux, { redistribution: 2 }) as number;
      // f=2 соответствует отсутствию перераспределения на ночную сторону.
      expect(tDayside).toBeGreaterThan(tEven);
      expect(tDayside / tEven).toBeCloseTo(Math.pow(2, 0.25), 10);
    });
  });

  describe('III закон Кеплера', () => {
    it('орбитальный период Земли вокруг звезды солнечной массы ≈ 1 год', () => {
      const M_SUN = 1.989e30;
      const period = orbitalPeriodFromElements(AU_M, M_SUN);
      expect(period).not.toBeNull();
      expect((period as number) / 3.15576e7).toBeCloseTo(1.0, 2);
    });

    it('при неизвестной массе центра период не рассчитывается', () => {
      expect(orbitalPeriodFromElements(AU_M, 0)).toBeNull();
    });

    it('период растёт с расстоянием: P ∝ a^(3/2)', () => {
      const p1 = orbitalPeriodFromElements(AU_M, M_EARTH_KG) as number;
      const p4 = orbitalPeriodFromElements(4 * AU_M, M_EARTH_KG) as number;
      expect(p4 / p1).toBeCloseTo(8, 10);
    });
  });

  describe('сэмплирование орбиты', () => {
    it('детерминизм: один seed даёт одинаковую орбитальную конфигурацию', () => {
      const star = centralObjects.find(o => o.id === 'yellow_dwarf')!;
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const orbitA = sampleOrbit(createRandom('orbit_seed'), { centralObject: star, celestialBody: body });
      const orbitB = sampleOrbit(createRandom('orbit_seed'), { centralObject: star, celestialBody: body });
      expect(JSON.stringify(orbitA)).toBe(JSON.stringify(orbitB));
    });

    it('разные seed дают разные орбиты', () => {
      const star = centralObjects.find(o => o.id === 'yellow_dwarf')!;
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const orbits = [1, 2, 3, 4, 5].map(i =>
        sampleOrbit(createRandom(`orbit_${i}`), { centralObject: star, celestialBody: body })
      );
      const axes = new Set(orbits.map(o => o.semiMajorAxis.value?.toPrecision(6)));
      expect(axes.size).toBeGreaterThan(1);
    });

    it('орбита планеты вокруг звезды лежит в физически обоснованном диапазоне', () => {
      const star = centralObjects.find(o => o.id === 'yellow_dwarf')!;
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const band = ORBIT_BANDS['yellow_dwarf'];
      for (let i = 0; i < 20; i++) {
        const orbit = sampleOrbit(createRandom(`orbit_band_${i}`), { centralObject: star, celestialBody: body });
        const au = (orbit.semiMajorAxis.value as number) / AU_M;
        expect(au).toBeGreaterThanOrEqual(band.minAu);
        expect(au).toBeLessThanOrEqual(band.maxAu);
        expect(orbit.frame).toBe('around_star');
      }
    });

    it('спутник газового гиганта orbitирует вокруг РОДИТЕЛЬСКОЙ ПЛАНЕТЫ, а не звезды', () => {
      const parent = centralObjects.find(o => o.id === 'lone_gas_giant')!;
      const moon = celestialBodies.find(b => b.id === 'gas_giant_moon')!;
      const orbit = sampleOrbit(createRandom('moon_orbit'), {
        centralObject: parent,
        celestialBody: moon,
        parentBodyRadiusM: 6.9911e7
      });
      expect(orbit.frame).toBe('around_parent_body');
      // Орбитальное расстояние задано в радиусах родительской планеты.
      const radii = (orbit.semiMajorAxis.value as number) / 6.9911e7;
      expect(radii).toBeGreaterThanOrEqual(5);
      expect(radii).toBeLessThanOrEqual(60);
    });

    it('динамическая устойчивость не заявляется без проверки', () => {
      const star = centralObjects.find(o => o.id === 'yellow_dwarf')!;
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const orbit = sampleOrbit(createRandom('stability'), { centralObject: star, celestialBody: body });
      expect(orbit.stabilityCheck).toBe('not_performed');
      expect(orbit.inclination.value).toBeNull();
    });
  });

  describe('разделение возраста Вселенной и времени жизни звезды', () => {
    it('время жизни голубого гиганта много меньше возраста Вселенной', () => {
      const lifetime = getTypicalLifetimeGyr('blue_giant');
      expect(lifetime).not.toBeNull();
      expect((lifetime as { min: number; max: number }).max).toBeLessThan(1);
    });

    it('время жизни красного карлика превышает возраст Вселенной', () => {
      const lifetime = getTypicalLifetimeGyr('red_dwarf');
      expect(lifetime).not.toBeNull();
      expect((lifetime as { min: number; max: number }).min).toBeGreaterThan(13.8);
    });

    it('для не-звёзд характерное время жизни неприменимо', () => {
      expect(getTypicalLifetimeGyr('relativistic_jet')).toBeNull();
      expect(getTypicalLifetimeGyr('lone_gas_giant')).toBeNull();
    });

    it('короткоживущая звезда НЕ запрещена в древней Вселенной (предупреждение, не ошибка)', () => {
      const world: Partial<GeneratedWorld> = {
        mode: 'realistic',
        cosmology: cosmologies.find(c => c.id === 'big_bang')!,
        epoch: epochs.find(e => e.id === 'ancient_cosmos')!,
        centralObject: centralObjects.find(o => o.id === 'blue_giant')!,
        celestialBody: celestialBodies.find(b => b.id === 'earth_like')!
      };
      const warnings = checkCompatibility(world, 'realistic');
      expect(warnings.some(w => w.ruleId === 'age_central_object_compatibility')).toBe(false);
      expect(warnings.some(w => w.ruleId === 'short_lived_star_recent_formation')).toBe(true);
    });

    it('existsInEpoch: объект существует только если Вселенная достаточно стара', () => {
      const ancient = epochs.find(e => e.id === 'ancient_cosmos')!;
      expect(existsInEpoch(ancient, 13)).toBe(true);
      expect(existsInEpoch(ancient, 20)).toBe(false);
    });
  });

  describe('релятивистский джет — не обычная звезда', () => {
    it('светимость джета неизвестна: поток не рассчитывается', () => {
      expect(getRepresentativeLuminosityW('relativistic_jet')).toBeNull();
      expect(incidentFlux(getRepresentativeLuminosityW('relativistic_jet'), AU_M)).toBeNull();
    });

    it('ортбитальная система джета использует собственную систему отсчёта', () => {
      const jet = centralObjects.find(o => o.id === 'relativistic_jet')!;
      const body = celestialBodies.find(b => b.id === 'earth_like')!;
      const orbit = sampleOrbit(createRandom('jet_orbit'), { centralObject: jet, celestialBody: body });
      expect(orbit.frame).toBe('jet_system');
      expect(orbit.orbitalPeriod.value).toBeNull();
    });
  });
});
