// ============================================
// TESTS - Generator: физическая модель мира (этап 3)
// ============================================
// Проверяет, что генератор строит ВЗАИМОСВЯЗАННУЮ физическую
// модель: масса/радиус/гравитация, орбита, энергетический поток,
// атмосферная физика, фазовый скрининг, геология и химический
// инвентарь — детерминированно и без выдуманных значений.

import { describe, it, expect } from 'vitest';
import { generateWorld } from '../Generator/generator';
import type { GenerationSettings, GeneratedWorld } from '../../types';
import { atmToPa, G_EARTH_MS2 } from '../Units';
import { getRepresentativeRadiusM } from '../Data/starPhysical';

function baseSettings(overrides: Partial<GenerationSettings> = {}): GenerationSettings {
  return {
    seed: 'physics_seed_123',
    mode: 'realistic',
    weights: {
      cosmology: {},
      epoch: {},
      centralObject: {},
      celestialBody: {},
      cradle: {}
    },
    fixedCategories: {},
    enableChemicalEvolution: false,
    chemicalEvolutionSteps: 0,
    ...overrides
  };
}

/** Физическая подпись мира: все новые физические поля этапа 3. */
function physicsSnapshot(world: GeneratedWorld): string {
  return JSON.stringify({
    bodyPhysics: world.bodyPhysics,
    centralObjectSystem: world.centralObjectSystem,
    orbit: world.orbit,
    atmospherePhysics: world.atmospherePhysics,
    phaseAnalysis: world.phaseAnalysis,
    geologyAnalysis: world.geologyAnalysis,
    energyBudget: world.energyBudget,
    chemicalState: world.chemicalState
  });
}

describe('Generator: физическая модель (этап 3)', () => {
  describe('детерминизм физической выборки', () => {
    it('тот же seed воспроизводит ту же физическую модель мира', () => {
      const world1 = generateWorld(baseSettings({ seed: 'physics_determinism' }));
      const world2 = generateWorld(baseSettings({ seed: 'physics_determinism' }));

      expect(physicsSnapshot(world1)).toBe(physicsSnapshot(world2));
      // Полные миры совпадают целиком, кроме метки времени создания
      const strip = (w: GeneratedWorld) => {
        const copy = { ...w } as Record<string, unknown>;
        delete copy.createdAt;
        return JSON.stringify(copy);
      };
      expect(strip(world1)).toBe(strip(world2));
    });

    it('разные seed дают разные физические конфигурации', () => {
      const masses = new Set<number>();
      const radii = new Set<number>();
      for (let i = 0; i < 20; i++) {
        const world = generateWorld(baseSettings({ seed: `physics_diversity_${i}` }));
        masses.add(world.bodyPhysics!.massKg.value as number);
        radii.add(world.bodyPhysics!.radiusM.value as number);
      }
      // Масса и радиус сэмплируются из диапазонов, а не фиксированы
      expect(masses.size).toBeGreaterThanOrEqual(3);
      expect(radii.size).toBeGreaterThanOrEqual(3);
    });

    it('масса и радиус всегда лежат в диапазонах каталога', () => {
      // Фиксируем тело: earth_like (0.5–2 M⊕, 0.8–1.2 R⊕)
      const world = generateWorld(baseSettings({
        seed: 'physics_range_check',
        fixedCategories: { celestialBody: 'earth_like' }
      }));
      const massEarth = (world.bodyPhysics!.massKg.value as number) / 5.9722e24;
      const radiusEarth = (world.bodyPhysics!.radiusM.value as number) / 6.371e6;
      expect(massEarth).toBeGreaterThanOrEqual(0.5);
      expect(massEarth).toBeLessThanOrEqual(2);
      expect(radiusEarth).toBeGreaterThanOrEqual(0.8);
      expect(radiusEarth).toBeLessThanOrEqual(1.2);
    });
  });

  describe('единая причинно-следственная цепочка', () => {
    it('зафиксированные категории отражаются в физической модели', () => {
      const world = generateWorld(baseSettings({
        seed: 'physics_fixed_moon',
        fixedCategories: {
          cosmology: 'big_bang',
          centralObject: 'lone_gas_giant',
          celestialBody: 'gas_giant_moon'
        }
      }));

      expect(world.cosmology.id).toBe('big_bang');
      expect(world.celestialBody.id).toBe('gas_giant_moon');
      // Спутник газового гиганта: орбита вокруг РОДИТЕЛЬСКОЙ планеты
      expect(world.orbit!.frame).toBe('around_parent_body');
      // Орбита масштабируется радиусом РОДИТЕЛЬСКОГО гиганта
      // (данные класса каталога), а не радиусом самой луны.
      expect(world.orbit!.semiMajorAxis.value).not.toBeNull();
      const representativeParentRadius = getRepresentativeRadiusM('lone_gas_giant') as number;
      const radii = (world.orbit!.semiMajorAxis.value as number) / representativeParentRadius;
      expect(radii).toBeGreaterThanOrEqual(5);
      expect(radii).toBeLessThanOrEqual(60);
      // Период рассчитан по массе РОДИТЕЛЬСКОЙ планеты (класс гиганта).
      expect(world.orbit!.orbitalPeriod.value).not.toBeNull();
      // Параметры самой луны остаются её собственными: радиус луны
      // (0.3–1.5 R⊕ по каталогу) не подменён родительскими значениями
      // и много меньше орбиты.
      const moonRadiusEarth = (world.bodyPhysics!.radiusM.value as number) / 6.371e6;
      expect(moonRadiusEarth).toBeGreaterThanOrEqual(0.3);
      expect(moonRadiusEarth).toBeLessThanOrEqual(1.5);
      expect((world.orbit!.semiMajorAxis.value as number)).toBeGreaterThan(
        world.bodyPhysics!.radiusM.value as number
      );
      // Структурированная система центрального объекта построена
      expect(world.centralObjectSystem).not.toBeNull();
    });

    it('спутник в системе звезды: родительская планета не моделируется — орбита не выдумывается', () => {
      // Звезда (синий гигант) освещает систему, но родительская
      // планета луны в модели не создаётся: масса и радиус родителя
      // неизвестны → параметры орбиты честно null.
      const world = generateWorld(baseSettings({
        seed: 'physics_star_moon',
        fixedCategories: {
          centralObject: 'blue_giant',
          celestialBody: 'gas_giant_moon'
        }
      }));
      expect(world.orbit!.frame).toBe('around_parent_body');
      expect(world.orbit!.semiMajorAxis.value).toBeNull();
      expect(world.orbit!.orbitalPeriod.value).toBeNull();
      // Параметры самой луны определены и не подменены:
      expect(world.bodyPhysics!.radiusM.value).not.toBeNull();
      expect(world.bodyPhysics!.surfaceGravityMs2.value).not.toBeNull();
      // Поток от звезды не рассчитывается из спутниковой полуоси:
      expect(world.energyBudget!.incidentFlux.value).toBeNull();
      expect(world.energyBudget!.equilibriumTemperature.value).toBeNull();
    });

    it('гравитация и плотность тела согласованы: g = G·M/R²', () => {
      const world = generateWorld(baseSettings({ seed: 'physics_gravity_check' }));
      const { massKg, radiusM, surfaceGravityMs2, densityKgM3 } = world.bodyPhysics!;
      const expectedG = (6.6743e-11 * (massKg.value as number)) / Math.pow(radiusM.value as number, 2);
      expect(surfaceGravityMs2.value as number).toBeCloseTo(expectedG, 1);
      const expectedRho = (massKg.value as number) / ((4 / 3) * Math.PI * Math.pow(radiusM.value as number, 3));
      expect(densityKgM3.value as number).toBeCloseTo(expectedRho, 0);
      // Гравитация показывается и в m/s², и в земных g
      expect((surfaceGravityMs2.value as number) / G_EARTH_MS2)
        .toBeCloseTo(world.bodyPhysics!.surfaceGravityInG.value as number, 2);
    });

    it('звезда задаёт энергетический поток и равновесную температуру', () => {
      const world = generateWorld(baseSettings({
        seed: 'physics_star_flux',
        fixedCategories: {
          centralObject: 'yellow_dwarf',
          celestialBody: 'earth_like'
        },
        atmospherePreset: 'earth'
      }));

      const flux = world.energyBudget!.incidentFlux.value as number | null;
      const tEq = world.energyBudget!.equilibriumTemperature.value as number | null;
      expect(flux).not.toBeNull();
      expect(tEq).not.toBeNull();
      // Ожидаемый порядок величины: орбита 0.5–3 а.е. вокруг солнцеподобной
      // звезды даёт T_eq в диапазоне примерно 170–310 K
      expect(flux as number).toBeGreaterThan(0);
      expect(tEq as number).toBeGreaterThan(150);
      expect(tEq as number).toBeLessThan(350);
      // Допущения модели видны пользователю
      expect(world.energyBudget!.greenhouseNote).toContain('T_eq');
      expect(world.energyBudget!.assumptions.length).toBeGreaterThan(0);
    });

    it('светимость недоступна → поток null, а не выдуманное значение', () => {
      const cases: Array<{ seed: string; centralObject: string; body: string; frame: string; noteMatch: RegExp }> = [
        { seed: 'physics_giant_flux', centralObject: 'lone_gas_giant', body: 'gas_giant_moon', frame: 'around_parent_body', noteMatch: /светимость|плавани/i },
        { seed: 'physics_bh_flux', centralObject: 'black_hole', body: 'earth_like', frame: 'around_star', noteMatch: /аккре|светимость/i },
        { seed: 'physics_jet_flux', centralObject: 'relativistic_jet', body: 'earth_like', frame: 'jet_system', noteMatch: /аккре|светимость|джет/i }
      ];
      for (const c of cases) {
        const world = generateWorld(baseSettings({
          seed: c.seed,
          fixedCategories: { centralObject: c.centralObject, celestialBody: c.body }
        }));
        expect(world.orbit!.frame).toBe(c.frame);
        expect(world.energyBudget!.incidentFlux.value).toBeNull();
        expect(world.energyBudget!.equilibriumTemperature.value).toBeNull();
        // null объясняется, а не подменяется нулём
        expect(world.energyBudget!.incidentFlux.note ?? '').toMatch(c.noteMatch);
      }
    });

    it('геотермальная энергия не добавляется каждому миру автоматически', () => {
      // Малая планета: внутреннее тепло низкое → геотермы нет.
      // Колыбель зафиксирована без геотермального источника в списке.
      const cold = generateWorld(baseSettings({
        seed: 'physics_no_geothermal',
        fixedCategories: {
          celestialBody: 'small_planet',
          cradle: 'hydrogen_helium_aerosols'
        }
      }));
      expect(cold.geologyAnalysis!.geothermalEnergyAvailable).toBe(false);
      expect(cold.energySources.primary).not.toContain('geothermal');
      expect(cold.energySources.secondary).not.toContain('geothermal');

      // Землеподобная планета: два умеренных источника → доступная геотерма.
      const warm = generateWorld(baseSettings({
        seed: 'physics_with_geothermal',
        fixedCategories: { celestialBody: 'earth_like' }
      }));
      expect(warm.geologyAnalysis!.geothermalEnergyAvailable).toBe(true);
      expect(
        warm.energySources.primary.includes('geothermal') ||
        warm.energySources.secondary.includes('geothermal')
      ).toBe(true);
    });
  });

  describe('связь атмосферной физики с остальной моделью', () => {
    it('метаново-этановый мир: давление в Па, инвентарь игровой, фазовый скрининг срабатывает', () => {
      const world = generateWorld(baseSettings({ seed: 'physics_methane_world' }));
      // Пресет по умолчанию — историческая метаново-этановая атмосфера
      expect(world.atmosphere.totalPressure).toBe(1.5);
      expect(world.atmosphere.temperature).toBe(95);

      // Давление конвертировано в Па
      expect(world.atmospherePhysics!.surfacePressurePa?.value).toBeCloseTo(atmToPa(1.5), 3);
      // Остаток unidentified блокирует среднюю молярную массу и столб
      expect(world.atmospherePhysics!.meanMolarMassKgMol?.value ?? null).toBeNull();
      expect(world.atmospherePhysics!.columnMolM2).toBeNull();
      // Поэтому инвентарь — нормированный игровой режим с явной пометкой
      expect(world.chemicalState!.mode).toBe('game_normalized');
      expect(world.chemicalState!.unitsNote).toContain('НЕИЗВЕСТНО');

      // Фазовый скрининг: при 95 K метан и этан потенциально конденсируются
      expect(world.phaseAnalysis!.hasPotentialTransitions).toBe(true);
      const states = new Map(world.phaseAnalysis!.components.map(c => [c.gasId, c.state]));
      expect(states.get('ch4')).toBe('potentially_condensing');
      expect(states.get('c2h6')).toBe('potentially_condensing');
      // Предупреждение честно сообщает границы модели смеси
      expect(world.phaseAnalysis!.warnings.join(' ')).toContain('не рассчитаны');
    });

    it('полный известный состав + известная гравитация → инвентарь в моль/м²', () => {
      const world = generateWorld(baseSettings({
        seed: 'physics_column_inventory',
        fixedCategories: { celestialBody: 'earth_like' },
        atmospherePreset: 'earth'
      }));

      expect(world.atmospherePhysics!.meanMolarMassKgMol?.value ?? null).not.toBeNull();
      expect(world.chemicalState!.mode).toBe('column_inventory');
      expect(world.chemicalState!.unitsNote).toContain('молях');
      // Инвентарь — это доли от столба вещества, а не проценты
      const column = world.atmospherePhysics!.columnMolM2?.value as number;
      const inventorySum = Object.values(world.chemicalState!.inventory).reduce((s, v) => s + v, 0);
      expect(inventorySum).toBeCloseTo(column, 3);
      // Гравитация, использованная для столба, — из сэмплированного тела
      expect(world.chemicalState!.gravityMs2).toBeCloseTo(world.bodyPhysics!.surfaceGravityMs2.value as number, 6);
    });

    it('фазовый скрининг реагирует на температуру атмосферы', () => {
      // Земной пресет при 288 K: метан выше критической температуры (190.6 K) —
      // конденсация в жидкость невозможна
      const warm = generateWorld(baseSettings({
        seed: 'physics_warm_screening',
        atmospherePreset: 'earth'
      }));
      const warmCh4 = warm.phaseAnalysis!.components.find(c => c.gasId === 'ch4');
      expect(warmCh4?.state).toBe('no_condensation_above_critical');

      // Тот же состав при 95 K: вода ниже тройной точки (273.16 K) —
      // возможно выпадение твёрдой фазы
      const coldAtmosphere = warm.atmosphere;
      const cold = generateWorld(baseSettings({
        seed: 'physics_cold_screening',
        customAtmosphere: { ...coldAtmosphere, temperature: 95 }
      }));
      expect(cold.atmosphere.temperature).toBe(95);
      const coldH2O = cold.phaseAnalysis!.components.find(c => c.gasId === 'h2o');
      expect(coldH2O?.state).toBe('potential_solid_deposition');
    });
  });

  describe('химическое состояние мира', () => {
    it('начальное состояние синхронизировано с атмосферой', () => {
      const world = generateWorld(baseSettings({ seed: 'physics_chemical_init' }));
      // Молярные доли химического состояния совпадают с атмосферной моделью
      expect(world.chemicalState!.molarFractions).toEqual(world.atmospherePhysics!.molarFractions);
      // Резервуар атмосферной фазы синхронен с инвентарём
      expect(world.chemicalState!.reservoirs.atmospheric).toEqual(world.chemicalState!.inventory);
      // Модельное время пока нулевое, шаг задан явно
      expect(world.chemicalState!.modelTimeYears).toBe(0);
      expect(world.chemicalState!.stepDurationYears).toBeGreaterThan(0);
      // Кислородный баланс: без биологии производство равно нулю
      expect(world.chemicalState!.oxygenBalance.production).toBe(0);
    });
  });
});
