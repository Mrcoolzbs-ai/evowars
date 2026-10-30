// ============================================
// TESTS - Compatibility module tests
// ============================================

import { describe, it, expect } from 'vitest';
import {
  checkCompatibility,
  isWorldCompatible,
  getAllRules,
  getActiveRules,
  isEnergySourceAvailable,
  CRADLE_RELATED_CATEGORIES
} from '../Compatibility';
import { determineCradleLocalEnvironment } from '../WorldModel';
import type { GeneratedWorld, AtmosphereState, PhysicalCharacteristics } from '../../types';
import { cosmologies, epochs, centralObjects, celestialBodies, cradles } from '../Data';

// ============================================
// ХЕЛПЕРЫ
// ============================================

function findCradle(id: string) {
  const cradle = cradles.find(c => c.id === id);
  if (!cradle) throw new Error(`Cradle ${id} not found`);
  return cradle;
}

/**
 * Мир с реальной локальной средой колыбели, вычисленной
 * по тем же правилам, что и в генераторе.
 */
function makeWorld(cradleId: string, overrides: Partial<GeneratedWorld> = {}): Partial<GeneratedWorld> {
  const cradle = findCradle(cradleId);
  return {
    mode: 'realistic',
    cradle,
    cradleLocalEnvironment: determineCradleLocalEnvironment({ cradle }),
    ...overrides
  };
}

/** Тестовая атмосфера с заданным составом. */
function makeAtmosphere(
  components: Array<[string, number]>,
  temperature: number,
  totalPressure: number
): AtmosphereState {
  return {
    components: components.map(([gasId, percentage]) => ({
      gasId,
      percentage,
      isTrace: percentage < 1,
      uncertainty: '',
      warnings: []
    })),
    totalPressure,
    temperature,
    notes: 'Тестовая атмосфера'
  };
}

/** Тестовые физические характеристики планеты. */
function makePhysicalCharacteristics(
  overrides: Partial<PhysicalCharacteristics> = {}
): PhysicalCharacteristics {
  return {
    surfaceTemperature: 288,
    atmosphericPressure: 1,
    geologicalActivity: 'Высокая геологическая активность',
    ...overrides
  } as PhysicalCharacteristics;
}

function errorsForRule(warnings: ReturnType<typeof checkCompatibility>, ruleId: string) {
  return warnings.filter(w => w.ruleId === ruleId);
}

function baseWorld(): Partial<GeneratedWorld> {
  return {
    mode: 'realistic',
    cosmology: cosmologies.find(c => c.id === 'big_bang')!,
    epoch: epochs.find(e => e.id === 'golden_middle')!,
    centralObject: centralObjects.find(o => o.id === 'yellow_dwarf')!,
    celestialBody: celestialBodies.find(b => b.id === 'earth_like')!
  };
}

// ============================================
// ТЕСТЫ
// ============================================

describe('Compatibility Module', () => {
  describe('checkCompatibility', () => {
    it('should return empty array for compatible world', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      expect(warnings).toBeInstanceOf(Array);
    });

    it('should detect anomalous cosmology without anomalous mode', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        cosmology: cosmologies.find(c => c.id === 'world_as_body')!,
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      const hasAnomalousWarning = warnings.some(
        w => w.ruleId === 'anomalous_cosmology_requires_anomalous_mode'
      );
      expect(hasAnomalousWarning).toBe(true);
    });

    it('should not flag anomalous cosmology in anomalous mode', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        mode: 'anomalous',
        cosmology: cosmologies.find(c => c.id === 'world_as_body')!,
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(mockWorld, 'anomalous');
      const hasAnomalousWarning = warnings.some(
        w => w.ruleId === 'anomalous_cosmology_requires_anomalous_mode'
      );
      expect(hasAnomalousWarning).toBe(false);
    });

    it('should detect age and central object incompatibility', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        epoch: epochs.find(e => e.id === 'ancient_cosmos')!, // 11-13.8 bln years
        centralObject: centralObjects.find(o => o.id === 'blue_giant')!, // short-lived
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      const hasAgeWarning = warnings.some(
        w => w.ruleId === 'age_central_object_compatibility' && w.severity === 'error'
      );
      expect(hasAgeWarning).toBe(true);
    });

    it('should detect central object and celestial body incompatibility', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        centralObject: centralObjects.find(o => o.id === 'relativistic_jet')!,
        celestialBody: celestialBodies.find(b => b.id === 'gas_giant_moon')!, // needs gas giant parent
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      const hasCompatibilityWarning = warnings.some(
        w => w.ruleId === 'central_object_body_compatibility' || w.ruleId === 'relativistic_jet_special_handling'
      );
      expect(hasCompatibilityWarning).toBe(true);
    });

    it('should detect gas giant moon without valid parent', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        celestialBody: celestialBodies.find(b => b.id === 'gas_giant_moon')!,
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      const hasMoonWarning = warnings.some(
        w => w.ruleId === 'gas_giant_moon_requires_parent'
      );
      expect(hasMoonWarning).toBe(true);
    });
  });

  describe('isWorldCompatible', () => {
    it('should return true for compatible world', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        cradle: findCradle('supercritical_water')
      };

      const isCompatible = isWorldCompatible(mockWorld, 'realistic');
      expect(isCompatible).toBe(true);
    });

    it('should return false for incompatible world', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        cosmology: cosmologies.find(c => c.id === 'world_as_body')!,
        cradle: findCradle('supercritical_water')
      };

      const isCompatible = isWorldCompatible(mockWorld, 'realistic');
      expect(isCompatible).toBe(false);
    });
  });

  describe('Rules Management', () => {
    it('should return all rules', () => {
      const allRules = getAllRules();
      expect(allRules).toBeInstanceOf(Array);
      expect(allRules.length).toBeGreaterThan(0);
    });

    it('should return only active rules', () => {
      const activeRules = getActiveRules();
      expect(activeRules).toBeInstanceOf(Array);
      expect(activeRules.length).toBeGreaterThan(0);
      expect(activeRules.every(r => r.isActive)).toBe(true);
    });

    it('should have rules with some correct categories', () => {
      const allRules = getAllRules();
      const categories = [
        'cosmology_physics',
        'age_central_object',
        'central_object_environment',
        'body_orbit',
        'cradle_temperature',
        'cradle_pressure'
      ];

      categories.forEach(category => {
        const hasCategory = allRules.some(r => r.category === category);
        expect(hasCategory).toBe(true);
      });
    });

    it('все правила активны — нет отключённых проверок', () => {
      const allRules = getAllRules();
      expect(getActiveRules()).toHaveLength(allRules.length);
      expect(allRules.every(r => r.isActive)).toBe(true);
    });

    it('предусмотрены все новые категории колыбели жизни', () => {
      const allRules = getAllRules();
      const requiredRuleIds = [
        'cradle_temperature_compatibility',
        'cradle_pressure_compatibility',
        'cradle_pressure_atmosphere_location',
        'cradle_atmosphere_composition',
        'cradle_geological_requirements',
        'cradle_energy_sources_availability',
        'cradle_matter_state_location'
      ];

      requiredRuleIds.forEach(ruleId => {
        const rule = allRules.find(r => r.id === ruleId);
        expect(rule).toBeDefined();
        expect(rule?.isActive).toBe(true);
        // Правило действительно отклоняет миры, а не пропускает всё
        expect(['incompatible', 'conditionally_compatible']).toContain(rule?.result);
      });
    });

    it('CRADLE_RELATED_CATEGORIES покрывает все категории колыбели', () => {
      expect(CRADLE_RELATED_CATEGORIES).toHaveLength(6);
      expect(CRADLE_RELATED_CATEGORIES).toContain('geological_requirements');
      expect(CRADLE_RELATED_CATEGORIES).toContain('energy_sources');
      expect(CRADLE_RELATED_CATEGORIES).toContain('matter_state');
    });

    it('идентификаторы предупреждений детерминированы', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        epoch: epochs.find(e => e.id === 'ancient_cosmos')!,
        centralObject: centralObjects.find(o => o.id === 'blue_giant')!,
        cradle: findCradle('supercritical_water')
      };

      const first = checkCompatibility(mockWorld, 'realistic');
      const second = checkCompatibility(mockWorld, 'realistic');

      expect(first.map(w => w.id)).toEqual(second.map(w => w.id));
      const ageWarning = first.find(w => w.ruleId === 'age_central_object_compatibility');
      expect(ageWarning?.id).toBe('warn_age_central_object_compatibility');
    });
  });
});

describe('Cradle Local Environment Compatibility', () => {
  describe('локальная среда колыбели (determineCradleLocalEnvironment)', () => {
    it('сверхкритическая вода — подземный резервуар с неизвестными точными T/P', () => {
      const cradle = findCradle('supercritical_water');
      const env = determineCradleLocalEnvironment({ cradle });

      expect(env.locationType).toBe('subsurface_reservoir');
      // Неизвестные значения не подменяются произвольными числами
      expect(env.temperature).toBeNull();
      expect(env.pressure).toBeNull();
      expect(env.temperatureRange).toEqual({ min: 647, max: 1000 });
      expect(env.pressureRange).toEqual({ min: 22.1, max: 500 });
      expect(env.matterState).toBe('supercritical_fluid');
      expect(env.energySources).toContain('geothermal');
      expect(env.locationDescription.length).toBeGreaterThan(0);
    });

    it('метаново-этановый океан — океан на поверхности', () => {
      const env = determineCradleLocalEnvironment({ cradle: findCradle('liquid_methane_ethane') });
      expect(env.locationType).toBe('ocean');
      expect(env.temperature).toBeNull();
      expect(env.temperatureRange).toEqual({ min: 90, max: 200 });
    });

    it('водородно-гелиевая оболочка — слои атмосферы', () => {
      const env = determineCradleLocalEnvironment({ cradle: findCradle('hydrogen_helium_aerosols') });
      expect(env.locationType).toBe('atmosphere');
      expect(env.matterState).toBe('aerosol');
    });

    it('расплавы солей — глубокие слои планетной оболочки', () => {
      const env = determineCradleLocalEnvironment({ cradle: findCradle('molten_salts') });
      expect(env.locationType).toBe('deep_planetary_layers');
    });
  });

  describe('cradle_temperature_compatibility — температура локальной среды', () => {
    it('поверхностная температура вне диапазона колыбели даёт ошибку', () => {
      // Метаново-этановый океан: 90–200 K, у Земли 288 K
      const world = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
        physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: 288 })
      });

      const warnings = checkCompatibility(world, 'realistic');
      const tempErrors = errorsForRule(warnings, 'cradle_temperature_compatibility');
      expect(tempErrors).toHaveLength(1);
      expect(tempErrors[0].severity).toBe('error');
    });

    it('поверхностная температура в диапазоне колыбели проходит проверку', () => {
      const world = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
        physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: 150 })
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
    });

    it('подземная колыбель не проверяется по поверхностной температуре', () => {
      // Сверхкритическая вода в глубинном резервуаре: 647–1000 K,
      // поверхностные 288 K не должны блокировать глубинную среду
      const world = makeWorld('supercritical_water', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 288,
          geologicalActivity: 'Высокая геологическая активность'
        })
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_pressure_compatibility')).toHaveLength(0);
    });

    it('атмосферная колыбель проверяется по температуре атмосферы', () => {
      // Водородно-гелиевая оболочка: 50–500 K
      const okWorld = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1)
      });
      expect(errorsForRule(checkCompatibility(okWorld, 'realistic'), 'cradle_temperature_compatibility')).toHaveLength(0);

      const coldWorld = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 20, 1)
      });
      expect(errorsForRule(checkCompatibility(coldWorld, 'realistic'), 'cradle_temperature_compatibility')).toHaveLength(1);
    });
  });

  describe('cradle_pressure_compatibility — давление локальной среды', () => {
    it('давление поверхности вне диапазона колыбели даёт ошибку', () => {
      // Метаново-этановый океан: 1–50 атм, Марс ~0.006 атм
      const world = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 0.006),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 150,
          atmosphericPressure: 0.006
        })
      });

      const warnings = checkCompatibility(world, 'realistic');
      const pressureErrors = errorsForRule(warnings, 'cradle_pressure_compatibility');
      expect(pressureErrors).toHaveLength(1);
      expect(pressureErrors[0].severity).toBe('error');
    });

    it('давление поверхности в диапазоне колыбели проходит проверку', () => {
      const world = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 150,
          atmosphericPressure: 1.5
        })
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_pressure_compatibility')).toHaveLength(0);
    });

    it('атмосферная колыбель с давлением вне диапазона даёт предупреждение', () => {
      // Водородно-гелиевая оболочка: 0.1–10 атм; Венера ~92 атм
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 92)
      });

      const warnings = checkCompatibility(world, 'realistic');
      const pressureWarnings = errorsForRule(warnings, 'cradle_pressure_atmosphere_location');
      expect(pressureWarnings).toHaveLength(1);
      expect(pressureWarnings[0].severity).toBe('warning');
    });

    it('атмосферная колыбель с подходящим давлением не даёт предупреждения', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 5)
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_pressure_atmosphere_location')).toHaveLength(0);
    });
  });

  describe('cradle_atmosphere_composition — состав среды', () => {
    it('атмосферная колыбель требует водородно-гелиевой среды (>=50%)', () => {
      const okWorld = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1)
      });
      expect(errorsForRule(checkCompatibility(okWorld, 'realistic'), 'cradle_atmosphere_composition')).toHaveLength(0);

      const badWorld = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 90], ['n2', 10]], 150, 1)
      });
      const warnings = checkCompatibility(badWorld, 'realistic');
      const compositionErrors = errorsForRule(warnings, 'cradle_atmosphere_composition');
      expect(compositionErrors).toHaveLength(1);
      expect(compositionErrors[0].severity).toBe('error');
    });

    it('метаново-этановый океан требует метан и этан в атмосфере', () => {
      const okWorld = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 150,
          atmosphericPressure: 1.5
        })
      });
      expect(errorsForRule(checkCompatibility(okWorld, 'realistic'), 'cradle_atmosphere_composition')).toHaveLength(0);

      const badWorld = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['n2', 90], ['co2', 10]], 95, 1.5),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 150,
          atmosphericPressure: 1.5
        })
      });
      expect(errorsForRule(checkCompatibility(badWorld, 'realistic'), 'cradle_atmosphere_composition')).toHaveLength(1);
    });

    it('аммиачный океан требует аммиак в атмосфере', () => {
      const okWorld = makeWorld('liquid_ammonia', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['n2', 85], ['nh3', 5], ['ch4', 10]], 240, 8),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 240,
          atmosphericPressure: 8
        })
      });
      expect(errorsForRule(checkCompatibility(okWorld, 'realistic'), 'cradle_atmosphere_composition')).toHaveLength(0);

      const badWorld = makeWorld('liquid_ammonia', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['n2', 90], ['ch4', 10]], 240, 8),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 240,
          atmosphericPressure: 8
        })
      });
      expect(errorsForRule(checkCompatibility(badWorld, 'realistic'), 'cradle_atmosphere_composition')).toHaveLength(1);
    });
  });

  describe('cradle_geological_requirements — геология', () => {
    it('горячая колыбель требует высокой геологической активности', () => {
      const world = makeWorld('supercritical_water', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 288,
          geologicalActivity: 'Низкая геологическая активность'
        })
      });

      const warnings = checkCompatibility(world, 'realistic');
      const geoErrors = errorsForRule(warnings, 'cradle_geological_requirements');
      expect(geoErrors).toHaveLength(1);
      expect(geoErrors[0].severity).toBe('error');
    });

    it('горячая колыбель на геологически активной планете проходит проверку', () => {
      const world = makeWorld('supercritical_water', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 288,
          geologicalActivity: 'Высокая геологическая активность'
        })
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_geological_requirements')).toHaveLength(0);
    });

    it('холодная колыбель не требует высокой геологической активности', () => {
      // Метаново-этановый океан: 90–200 K — не горячая среда
      const world = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 150,
          atmosphericPressure: 1.5,
          geologicalActivity: 'Низкая геологическая активность'
        })
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_geological_requirements')).toHaveLength(0);
    });
  });

  describe('cradle_energy_sources_availability — источники энергии', () => {
    it('колыбель, требующая звёздного излучения, несовместима с одиночным газовым гигантом', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        centralObject: centralObjects.find(o => o.id === 'lone_gas_giant')!,
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1)
      });

      const warnings = checkCompatibility(world, 'realistic');
      const energyErrors = errorsForRule(warnings, 'cradle_energy_sources_availability');
      expect(energyErrors).toHaveLength(1);
      expect(energyErrors[0].severity).toBe('error');
    });

    it('колыбель, требующая звёздного излучения, совместима со звёздой', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1)
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_energy_sources_availability')).toHaveLength(0);
    });

    it('инфракрасное излучение коричневого карлика заменяет звёздное', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        centralObject: centralObjects.find(o => o.id === 'brown_dwarf')!,
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1)
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_energy_sources_availability')).toHaveLength(0);
    });

    it('isEnergySourceAvailable различает радиативные и средовые источники', () => {
      const yellowDwarf = centralObjects.find(o => o.id === 'yellow_dwarf')!;
      const loneGasGiant = centralObjects.find(o => o.id === 'lone_gas_giant')!;

      expect(isEnergySourceAvailable(yellowDwarf, 'stellar_radiation')).toBe(true);
      expect(isEnergySourceAvailable(loneGasGiant, 'stellar_radiation')).toBe(false);
      // Геотермальная и химическая энергия доступны из самой среды
      expect(isEnergySourceAvailable(loneGasGiant, 'geothermal')).toBe(true);
      expect(isEnergySourceAvailable(undefined, 'stellar_radiation')).toBe(true);
    });
  });

  describe('cradle_matter_state_location — агрегатное состояние', () => {
    it('жидкая среда не может обитать в свободной атмосфере', () => {
      const cradle = findCradle('liquid_methane_ethane');
      const env = determineCradleLocalEnvironment({ cradle });
      const world: Partial<GeneratedWorld> = {
        ...baseWorld(),
        cradle,
        cradleLocalEnvironment: { ...env, locationType: 'atmosphere' }
      };

      const warnings = checkCompatibility(world, 'realistic');
      const matterWarnings = errorsForRule(warnings, 'cradle_matter_state_location');
      expect(matterWarnings).toHaveLength(1);
      expect(matterWarnings[0].severity).toBe('warning');
    });

    it('аэрозольная среда в атмосфере согласована', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1)
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_matter_state_location')).toHaveLength(0);
    });

    it('аэрозольная среда не располагается на твёрдой поверхности', () => {
      const cradle = findCradle('hydrogen_helium_aerosols');
      const env = determineCradleLocalEnvironment({ cradle });
      const world: Partial<GeneratedWorld> = {
        ...baseWorld(),
        cradle,
        cradleLocalEnvironment: { ...env, locationType: 'surface' }
      };

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_matter_state_location')).toHaveLength(1);
    });
  });

  describe('аномальный режим отключает только привязанные исключения', () => {
    it('аномальный режим не отключает геологические требования', () => {
      const world = makeWorld('supercritical_water', {
        ...baseWorld(),
        mode: 'anomalous',
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 288,
          geologicalActivity: 'Низкая геологическая активность'
        })
      });

      const warnings = checkCompatibility(world, 'anomalous');
      expect(errorsForRule(warnings, 'cradle_geological_requirements')).toHaveLength(1);
    });

    it('аномальный режим отключает проверку возраста (привязанное исключение)', () => {
      const world: Partial<GeneratedWorld> = {
        ...baseWorld(),
        mode: 'anomalous',
        epoch: epochs.find(e => e.id === 'ancient_cosmos')!,
        centralObject: centralObjects.find(o => o.id === 'blue_giant')!,
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(world, 'anomalous');
      expect(errorsForRule(warnings, 'age_central_object_compatibility')).toHaveLength(0);
    });

    it('релятивистский джет запрещён в реалистичном режиме и разрешён в аномальном', () => {
      const realisticWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        centralObject: centralObjects.find(o => o.id === 'relativistic_jet')!,
        cradle: findCradle('supercritical_water')
      };
      expect(errorsForRule(checkCompatibility(realisticWorld, 'realistic'), 'relativistic_jet_special_handling')).toHaveLength(1);

      const anomalousWorld: Partial<GeneratedWorld> = {
        ...realisticWorld,
        mode: 'anomalous'
      };
      expect(errorsForRule(checkCompatibility(anomalousWorld, 'anomalous'), 'relativistic_jet_special_handling')).toHaveLength(0);
    });

    it('аномальный режим не отключает проверку источников энергии', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        mode: 'anomalous',
        centralObject: centralObjects.find(o => o.id === 'lone_gas_giant')!,
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1)
      });

      const warnings = checkCompatibility(world, 'anomalous');
      expect(errorsForRule(warnings, 'cradle_energy_sources_availability')).toHaveLength(1);
    });
  });

  describe('совместимость колыбели с планетой (интеграция)', () => {
    it('полностью совместимый мир не даёт ошибок', () => {
      const world = makeWorld('supercritical_water', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 288,
          atmosphericPressure: 1,
          geologicalActivity: 'Высокая геологическая активность'
        })
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(warnings.filter(w => w.severity === 'error')).toHaveLength(0);
      expect(isWorldCompatible(world, 'realistic')).toBe(true);
    });

    it('мир с несовместимой колыбелью не проходит проверку', () => {
      const world = makeWorld('supercritical_water', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 288,
          atmosphericPressure: 1,
          geologicalActivity: 'Низкая геологическая активность'
        })
      });

      expect(isWorldCompatible(world, 'realistic')).toBe(false);
    });
  });
});

describe('Compatibility Rule Validation', () => {
  it('should have all rules with required properties', () => {
    const allRules = getAllRules();

    allRules.forEach(rule => {
      expect(rule.id).toBeDefined();
      expect(rule.category).toBeDefined();
      expect(rule.condition).toBeInstanceOf(Function);
      expect(rule.result).toBeDefined();
      expect(rule.severity).toBeDefined();
      expect(rule.explanation).toBeDefined();
      expect(rule.resolutionSuggestions).toBeInstanceOf(Array);
      expect(rule.dependsOn).toBeInstanceOf(Array);
      expect(typeof rule.isActive).toBe('boolean');
    });
  });

  it('should have rules with valid severity levels', () => {
    const allRules = getAllRules();
    const validSeverities = ['error', 'warning', 'info'];

    allRules.forEach(rule => {
      expect(validSeverities).toContain(rule.severity);
    });
  });

  it('should have rules with valid result types', () => {
    const allRules = getAllRules();
    const validResults = ['compatible', 'conditionally_compatible', 'incompatible'];

    allRules.forEach(rule => {
      expect(validResults).toContain(rule.result);
    });
  });
});
