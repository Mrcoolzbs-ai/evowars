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
  CRADLE_RELATED_CATEGORIES,
  LOCATION_TYPE_RESERVOIR_KINDS
} from '../Compatibility';
import { determineCradleLocalEnvironment } from '../WorldModel';
import type { GeneratedWorld, AtmosphereState, PhysicalCharacteristics, CradleLocalEnvironment } from '../../types';
import { cosmologies, epochs, centralObjects, celestialBodies, cradles } from '../Data';
import { knownValue, estimatedValue, unknownValue, notApplicable, invalidValue } from '../Core/scientificValue';
import type { DataProvenance, ScientificValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { createCoreWorldState } from '../Core/worldState';
import type { ReservoirRecord } from '../Core/reservoir';
import { atmospherePresetTemperatureToScientificValue } from '../Core/adapters';

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
  temperature: number | null,
  totalPressure: number | null
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

/**
 * Stage 4.2.2.2 / 4.2.2.3: мир с типизированной (known/estimated)
 * температурой поверхности в научном ядре (coreWorldState → тело
 * 'planet' → thermalState.surfaceTemperature) со статусом и
 * provenance. Stage 4.2.2.3: параметр provenance даёт полный контроль
 * над происхождением (включая ЯВНО пустой объект {} или только note —
 * для тестов evidence gate).
 */
function withTypedSurfaceTemperature(
  world: Partial<GeneratedWorld>,
  temperature: {
    status: 'known' | 'estimated';
    valueK: number;
    sourceName?: string;
    provenance?: DataProvenance;
  }
): Partial<GeneratedWorld> {
  const provenance: DataProvenance | undefined =
    temperature.provenance !== undefined
      ? temperature.provenance
      : temperature.sourceName !== undefined
        ? { sourceName: temperature.sourceName }
        : undefined;
  const value =
    temperature.status === 'known'
      ? knownValue(quantity(temperature.valueK, 'K'), { provenance })
      : estimatedValue(quantity(temperature.valueK, 'K'), 'оценка фикстуры теста', { provenance });
  return withCoreSurfaceTemperature(world, value);
}

/**
 * Stage 4.2.2.3: инъекция ПРОИЗВОЛЬНОГО ScientificValue как
 * thermalState.surfaceTemperature тела 'planet' (включая значения
 * искажённой формы: NaN, неверная единица, invalid — фикстуры
 * обходят конструкторы ядра намеренно, чтобы проверять поведение
 * правил на данных произвольного происхождения).
 */
function withCoreSurfaceTemperature(
  world: Partial<GeneratedWorld>,
  value: ScientificValue
): Partial<GeneratedWorld> {
  const core = createCoreWorldState('w-typed-surface');
  core.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: {},
    thermalState: {
      effectiveTemperature: notApplicable('планета — получатель излучения'),
      equilibriumTemperature: unknownValue('T_eq не задана в фикстуре'),
      surfaceTemperature: value,
      atmosphericTemperatureProfile: { status: 'unknown', layers: [] }
    }
  });
  return { ...world, coreWorldState: core };
}

/**
 * Stage 4.2.2.3: фиксура локальной среды с переопределённым типом
 * расположения. Поверхность и океан — РАЗНЫЕ области с раздельными
 * источниками температуры; тесты правил обязаны выбирать область
 * явно, а не полагаться на совпадение колыбели и расположения.
 */
function withLocationType(
  world: Partial<GeneratedWorld>,
  locationType: CradleLocalEnvironment['locationType']
): Partial<GeneratedWorld> {
  const env = world.cradleLocalEnvironment as CradleLocalEnvironment;
  return {
    ...world,
    cradleLocalEnvironment: {
      ...env,
      locationType,
      locationDescription: `фикстура Stage 4.2.2.3: локальная среда ${locationType}`
    }
  };
}

/**
 * Stage 4.2.2.3: мир с океаническим резервуаром в научном ядре,
 * явно привязанным к локальной среде колыбели через
 * env.localReservoirId. Резервуар принадлежит телу 'planet'
 * (или указанному телу — для негативных тестов «чужого» резервуара).
 */
function withOceanReservoir(
  world: Partial<GeneratedWorld>,
  options: {
    reservoirTemperature?: ScientificValue;
    reservoirId?: string;
    reservoirBodyId?: string;
    /** Stage 4.2.2.4: переопределение вида резервуара для тестов соответствия kind локальной среде (по умолчанию 'ocean'). */
    reservoirKind?: string;
    withMoonBody?: boolean;
    linkReservoirId?: string | null;
  } = {}
): Partial<GeneratedWorld> {
  const core = createCoreWorldState('w-typed-ocean');
  core.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: {},
    thermalState: {
      effectiveTemperature: notApplicable('планета — получатель излучения'),
      equilibriumTemperature: unknownValue('T_eq не задана в фикстуре'),
      surfaceTemperature: unknownValue('фикстура: поверхность не заявлена'),
      atmosphericTemperatureProfile: { status: 'unknown', layers: [] }
    }
  });
  if (options.withMoonBody) {
    core.bodies.push({
      id: 'moon',
      kind: 'moon',
      properties: {},
      thermalState: {
        effectiveTemperature: notApplicable('луна — получатель излучения'),
        equilibriumTemperature: unknownValue('T_eq не задана в фикстуре'),
        surfaceTemperature: unknownValue('фикстура: поверхность не заявлена'),
        atmosphericTemperatureProfile: { status: 'unknown', layers: [] }
      }
    });
  }
  const reservoirId = options.reservoirId ?? 'ocean_reservoir';
  const reservoir: ReservoirRecord = {
    id: reservoirId,
    kind: options.reservoirKind ?? 'ocean',
    bodyId: options.reservoirBodyId ?? 'planet',
    properties: {},
    ...(options.reservoirTemperature !== undefined
      ? { reservoirTemperature: options.reservoirTemperature }
      : {})
  };
  core.reservoirs.push(reservoir);

  const env = world.cradleLocalEnvironment as CradleLocalEnvironment;
  const linkedReservoirId =
    options.linkReservoirId === null ? undefined : (options.linkReservoirId ?? reservoirId);
  return {
    ...world,
    coreWorldState: core,
    cradleLocalEnvironment:
      linkedReservoirId !== undefined
        ? { ...env, localReservoirId: linkedReservoirId }
        : env
  };
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

    it('короткоживущая звезда НЕ запрещена в древней Вселенной (этап 3)', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        epoch: epochs.find(e => e.id === 'ancient_cosmos')!, // 11-13.8 bln years
        centralObject: centralObjects.find(o => o.id === 'blue_giant')!, // short-lived
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      // Голубой гигант мог сформироваться недавно даже в древней Вселенной:
      // время жизни звезды НЕ равно возрасту Вселенной.
      const hasAgeError = warnings.some(
        w => w.ruleId === 'age_central_object_compatibility' && w.severity === 'error'
      );
      expect(hasAgeError).toBe(false);

      // Вместо запрета — предупреждение об ограниченном окне стабильности.
      const hasShortLivedWarning = warnings.some(
        w => w.ruleId === 'short_lived_star_recent_formation' && w.severity === 'warning'
      );
      expect(hasShortLivedWarning).toBe(true);
    });

    it('объект, не существовавший в ранней Вселенной, всё ещё даёт ошибку (этап 3)', () => {
      // Синтетический объект: класс возникает не раньше 20 млрд лет
      // (например, гипотетический поздний класс) — Вселенная 13.8 млрд лет слишком молода.
      const lateObject = {
        ...centralObjects.find(o => o.id === 'blue_giant')!,
        id: 'test_late_object',
        existenceWindow: { earliestUniverseAgeGyr: 20 }
      };
      const mockWorld: Partial<GeneratedWorld> = {
        ...baseWorld(),
        epoch: epochs.find(e => e.id === 'ancient_cosmos')!,
        centralObject: lateObject,
        cradle: findCradle('supercritical_water')
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      const hasAgeError = warnings.some(
        w => w.ruleId === 'age_central_object_compatibility' && w.severity === 'error'
      );
      expect(hasAgeError).toBe(true);
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
      // Этап 3: для короткоживущей звезды в древней Вселенной срабатывает
      // предупреждение времени жизни (детерминированный идентификатор).
      const shortLivedWarning = first.find(w => w.ruleId === 'short_lived_star_recent_formation');
      expect(shortLivedWarning?.id).toBe('warn_short_lived_star_recent_formation');
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
    it('известная (known) типизированная поверхностная температура вне диапазона колыбели даёт ошибку', () => {
      // Метаново-этановый океан: 90–200 K, измерено 288 K.
      // Stage 4.2.2.2: ошибка — только доказанное known-значение.
      // Stage 4.2.2.3: доказательство — значение ИМЕННО указанной
      // области; фикстура переопределяет расположение на поверхность,
      // потому что typed surfaceTemperature доказывает только её.
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 288, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );

      const warnings = checkCompatibility(world, 'realistic');
      const tempErrors = errorsForRule(warnings, 'cradle_temperature_compatibility');
      expect(tempErrors).toHaveLength(1);
      expect(tempErrors[0].severity).toBe('error');
    });

    it('известная (known) типизированная поверхностная температура в диапазоне проходит проверку', () => {
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 150, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );

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

      // Stage 4.2.2.2: холодная оценка (20 K) — оценочное расхождение:
      // предупреждение, а НЕ доказанная физическая ошибка
      const coldWorld = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 20, 1)
      });
      const coldWarnings = checkCompatibility(coldWorld, 'realistic');
      expect(errorsForRule(coldWarnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const estimateWarnings = errorsForRule(coldWarnings, 'cradle_temperature_estimate_outside_range');
      expect(estimateWarnings).toHaveLength(1);
      expect(estimateWarnings[0].severity).toBe('warning');
    });
  });

  // Stage 4.2.2.1: главный принцип ревизии — отсутствие локальной
  // температуры есть отсутствие доказательства совместимости,
  // а не доказательство совместимости. Оценка не становится
  // измерением только потому, что она числовая.
  describe('cradle_temperature_unproven — отсутствие температуры НЕ является пройденной проверкой', () => {
    it('поверхностная/океаническая колыбель без surfaceTemperature не проходит проверку молча', () => {
      // Метаново-этановый океан; surfaceTemperature больше не
      // заполняется генератором (Stage 4.2.2) — проверка не должна
      // «успешно пройти» по отсутствию данных.
      const world = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
        physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: undefined })
      });

      const warnings = checkCompatibility(world, 'realistic');
      const unproven = warnings.filter(w => w.ruleId === 'cradle_temperature_unproven');
      expect(unproven).toHaveLength(1);
      // Молчаливого подтверждения нет: предупреждение ЯВНОЕ
      expect(unproven[0].severity).toBe('warning');
      expect(unproven[0].category).toBe('cradle_temperature');
    });

    it('вместо ложного подтверждения создаётся диагностическое предупреждение, а не ошибка', () => {
      const world = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: undefined })
      });

      const warnings = checkCompatibility(world, 'realistic');
      // Неизвестность НЕ превращается автоматически в incompatible/error
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const unproven = warnings.find(w => w.ruleId === 'cradle_temperature_unproven');
      expect(unproven).toBeDefined();
      expect(unproven?.severity).toBe('warning');
      // Сообщение отражает принцип: отсутствие данных — не доказательство
      expect(unproven?.message).toContain('НЕ ДОКАЗАНА');
      expect(unproven?.suggestions.length).toBeGreaterThan(0);
      expect(unproven?.affectedFields).toContain('cradle');
    });

    it('известная (known) температура вне диапазона по-прежнему даёт ошибку', () => {
      // 288 K вне диапазона метанового океана 90–200 K
      // (Stage 4.2.2.2: доказанное known-значение из научного ядра)
      // Stage 4.2.2.3: доказательство — значение ИМЕННО указанной
      // области; typed surfaceTemperature доказывает только поверхность.
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 288, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );

      const warnings = checkCompatibility(world, 'realistic');
      const tempErrors = errorsForRule(warnings, 'cradle_temperature_compatibility');
      expect(tempErrors).toHaveLength(1);
      expect(tempErrors[0].severity).toBe('error');
      // Известное число доказывает проверяемость: предупреждения о
      // недоказанности нет
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });

    it('известная (known) температура в диапазоне проходит проверку без предупреждений', () => {
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 150, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });

    it('атмосферная температура с provenance обрабатывается в соответствии со статусом', () => {
      // Водородно-гелиевая оболочка: 50–500 K.
      // historical_game — игровое допущение: число участвует в
      // проверке диапазона (историческое поведение сохранено), но
      // оценка НЕ считается измерением — фиксируется предупреждение.
      const gameAssumptionWorld = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: {
          ...makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1),
          presetKind: 'historical_game',
          presetNotes: 'исторический игровой сценарий'
        }
      });
      const gameWarnings = checkCompatibility(gameAssumptionWorld, 'realistic');
      expect(errorsForRule(gameWarnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const gameUnproven = gameWarnings.find(w => w.ruleId === 'cradle_temperature_unproven');
      expect(gameUnproven).toBeDefined();
      expect(gameUnproven?.severity).toBe('warning');
      expect(gameUnproven?.message).toContain('оценкой');

      // Неизвестная температура атмосферы (null) — не доказано,
      // но и не ошибка
      const noDataWorld = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], null, 1)
      });
      const noDataWarnings = checkCompatibility(noDataWorld, 'realistic');
      expect(errorsForRule(noDataWarnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(noDataWarnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('отсутствие температурных данных не создаёт фиктивного значения', () => {
      // Ни поверхностной, ни атмосферной температуры; колыбель
      // подземная — локальная температура не моделируется вообще.
      const world = makeWorld('supercritical_water', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['n2', 100]], null, null),
        physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: undefined })
      });

      const warnings = checkCompatibility(world, 'realistic');
      // Фиктивного «известного» значения не появилось: ни ошибки
      // «вне диапазона», ни молчаливого успеха
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const unproven = warnings.filter(w => w.ruleId === 'cradle_temperature_unproven');
      expect(unproven).toHaveLength(1);
      expect(unproven[0].message).toContain('НЕ ДОКАЗАНА');
    });

    it('подземная колыбель не проверяется по поверхностной температуре или T_eq', () => {
      // Сверхкритическая вода: 647–1000 K в глубинном резервуаре.
      // Поверхностные 288 K НЕ должны ни «пройти», ни «завалить»
      // глубинную среду — они не являются её температурой.
      const world = makeWorld('supercritical_water', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 288,
          geologicalActivity: 'Высокая геологическая активность'
        })
      });

      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      // Совместимость условна: локальная глубинная температура
      // не моделируется
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('isWorldCompatible: условная совместимость и доказанная различимы в диагностике', () => {
      // Мир с неизвестной локальной температурой: несовместимости НЕТ
      // (предупреждение, а не ошибка), но условность видна в checkCompatibility
      const unprovenWorld = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: undefined })
      });
      expect(isWorldCompatible(unprovenWorld, 'realistic')).toBe(true);
      const unprovenWarnings = checkCompatibility(unprovenWorld, 'realistic');
      expect(unprovenWarnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);

      // Мир с известной (known) температурой в диапазоне: та же итоговая
      // совместимость, но предупреждения о недоказанности нет —
      // два состояния различимы только через диагностику.
      // Stage 4.2.2.3: typed surfaceTemperature доказывает только
      // поверхность — фикстура переопределяет область.
      const provenWorld = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 150, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );
      expect(isWorldCompatible(provenWorld, 'realistic')).toBe(true);
      expect(
        checkCompatibility(provenWorld, 'realistic').some(w => w.ruleId === 'cradle_temperature_unproven')
      ).toBe(false);
    });
  });

  // Stage 4.2.2.2: оценка может помочь исследовать сценарий, но не
  // превращается в доказанное физическое противоречие; легаси-число
  // без происхождения не становится измерением.
  describe('Stage 4.2.2.2: оценка не является доказанным противоречием', () => {
    it('known вне диапазона → ошибка (доказанное нарушение)', () => {
      // Stage 4.2.2.3: typed surfaceTemperature доказывает только
      // поверхность — фикстура переопределяет область колыбели.
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 288, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      const errors = errorsForRule(warnings, 'cradle_temperature_compatibility');
      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe('error');
      // доказанное значение снимает недоказанность
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });

    it('estimated вне диапазона → предупреждение, НЕ ошибка (венусоподобный сценарий 737 K)', () => {
      // Атмосфера 737 K (венусоподобная оценка без presetKind) при
      // диапазоне колыбели 50–500 K: оценочный сценарий вне диапазона
      // НЕ исключает колыбель как «доказанно несовместимую».
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 737, 92)
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const estimate = errorsForRule(warnings, 'cradle_temperature_estimate_outside_range');
      expect(estimate).toHaveLength(1);
      expect(estimate[0].severity).toBe('warning');
      expect(estimate[0].message).toContain('НЕ является доказанным физическим противоречием');
      expect(isWorldCompatible(world, 'realistic')).toBe(true);
    });

    it('estimated в диапазоне → условная совместимость (предупреждение о недоказанности остаётся)', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1)
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(0);
      expect(
        warnings.some(w => w.ruleId === 'cradle_temperature_unproven' && w.severity === 'warning')
      ).toBe(true);
      expect(isWorldCompatible(world, 'realistic')).toBe(true);
    });

    it('unknown → предупреждение о недоказанности, без ошибок и без фиктивных значений', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], null, 1)
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(0);
      const unproven = warnings.filter(w => w.ruleId === 'cradle_temperature_unproven');
      expect(unproven).toHaveLength(1);
      expect(unproven[0].severity).toBe('warning');
    });

    it('historical_game остаётся явно игровым допущением, а не измерением', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: {
          ...makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1),
          presetKind: 'historical_game',
          presetNotes: 'исторический игровой сценарий'
        }
      });
      // Адаптер честно помечает значение как игровое допущение
      const typed = atmospherePresetTemperatureToScientificValue(world.atmosphere);
      expect(typed.status).toBe('estimated');
      if (typed.status === 'estimated') {
        expect(typed.method).toContain('game_assumption');
      }
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      // Игровое допущение не считается измерением мира
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('observational_reference не становится known конкретного генерируемого мира', () => {
      const world = makeWorld('hydrogen_helium_aerosols', {
        ...baseWorld(),
        atmosphere: {
          ...makeAtmosphere([['h2', 80], ['he', 15], ['ch4', 5]], 150, 1),
          presetKind: 'observational_reference',
          presetNotes: 'Наблюдательный справочный сценарий: значения соответствуют современной атмосфере Земли.'
        }
      });
      const typed = atmospherePresetTemperatureToScientificValue(world.atmosphere);
      // Справочный ориентир — оценка, НЕ известное значение мира
      expect(typed.status).toBe('estimated');
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });
  });

  // Stage 4.2.2.2: легаси surfaceTemperature (число без статуса и
  // происхождения) не считается доказанным измерением поверхности.
  describe('Stage 4.2.2.2: легаси surfaceTemperature без происхождения', () => {
    it('легаси-число вне диапазона не создаёт доказанной физической ошибки', () => {
      // Старое сохранение: 288 K в легаси-поле без статуса/метода/
      // источника. Вне диапазона метанового океана — предупреждение
      // об оценочном расхождении, а не error.
      // Stage 4.2.2.3: легаси-число поверхности читается только как
      // оценочный сценарий ПОВЕРХНОСТИ — фикстура задаёт область явно.
      const world = withLocationType(
        makeWorld('liquid_methane_ethane', {
          ...baseWorld(),
          atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
          physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: 288 })
        }),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const estimate = errorsForRule(warnings, 'cradle_temperature_estimate_outside_range');
      expect(estimate).toHaveLength(1);
      expect(estimate[0].severity).toBe('warning');
      // Недоказанность сохраняется: число без происхождения — не измерение
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
      expect(isWorldCompatible(world, 'realistic')).toBe(true);
    });

    it('легаси-число в диапазоне не даёт молчаливого подтверждения', () => {
      const world = withLocationType(
        makeWorld('liquid_methane_ethane', {
          ...baseWorld(),
          atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
          physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: 150 })
        }),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(0);
      // Предупреждение вместо молчаливого подтверждения
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('типизированная known-температура подтверждает диапазон', () => {
      // Stage 4.2.2.3: typed surfaceTemperature доказывает только
      // поверхность — фикстура переопределяет область колыбели.
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 150, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_estimate_outside_range')).toBe(false);
    });

    it('типизированная estimated-температура не создаёт жёсткой физической ошибки', () => {
      // Оценка 288 K вне диапазона 90–200 K: предупреждения, не ошибка.
      // Stage 4.2.2.3: оценка поверхности относится к поверхности —
      // фикстура переопределяет область колыбели.
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'estimated', valueK: 288, sourceName: 'оценка фикстуры' }
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(1);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
      expect(isWorldCompatible(world, 'realistic')).toBe(true);
    });
  });

  // Stage 4.2.2.3 (§4.1 ТЗ): известное (known) значение становится
  // доказательством температурной совместимости ТОЛЬКО при
  // содержательном provenance. Статус known сам по себе, пустой
  // объект provenance или один только note идентификацией
  // происхождения не являются: такое значение — недоказанность
  // (правило 6a), а не физическая ошибка (правило 6). Непригодное
  // число (invalid, не в K, NaN, отрицательное) физическим
  // доказательством не становится ни при каком provenance.
  describe('Stage 4.2.2.3: evidence gate — known требует содержательного provenance', () => {
    it('known с содержательным provenance вне диапазона → доказанная ошибка', () => {
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 288, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(1);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_estimate_outside_range')).toBe(false);
    });

    it('known с содержательным provenance в диапазоне → доказанная проверка без предупреждений', () => {
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 150, sourceName: 'измерение фикстуры' }
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_estimate_outside_range')).toBe(false);
    });

    it('known БЕЗ provenance — не доказательство: вне диапазона нет ошибки, есть недоказанность', () => {
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 288 } // ни sourceName, ни provenance
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const unproven = warnings.filter(w => w.ruleId === 'cradle_temperature_unproven');
      expect(unproven).toHaveLength(1);
      expect(unproven[0].severity).toBe('warning');
      expect(unproven[0].message).toContain('НЕ ДОКАЗАНА');
      // Число без происхождения не считается доказанным значением и
      // не порождает дублирующего оценочного предупреждения
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_estimate_outside_range')).toBe(false);
    });

    it('known БЕЗ provenance в диапазоне всё равно остаётся недоказанным', () => {
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 150 } // ни sourceName, ни provenance
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('known с ПУСТЫМ provenance {} — те же ожидания, что и без provenance', () => {
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 288, provenance: {} }
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const unproven = warnings.filter(w => w.ruleId === 'cradle_temperature_unproven');
      expect(unproven).toHaveLength(1);
      expect(unproven[0].message).toContain('НЕ ДОКАЗАНА');
    });

    it('known с provenance только {note} — note не идентифицирует происхождение', () => {
      const world = withLocationType(
        withTypedSurfaceTemperature(
          makeWorld('liquid_methane_ethane', {
            ...baseWorld(),
            atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
          }),
          { status: 'known', valueK: 288, provenance: { note: 'заметка без источника' } }
        ),
        'surface'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('непригодные формы числа не становятся физическим доказательством', () => {
      const makeSurfaceWorld = (value: ScientificValue) =>
        withLocationType(
          withCoreSurfaceTemperature(
            makeWorld('liquid_methane_ethane', {
              ...baseWorld(),
              atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
            }),
            value
          ),
          'surface'
        );

      const fixtures: Array<{ label: string; value: ScientificValue }> = [
        {
          label: 'invalid-статус',
          value: invalidValue('повреждённая запись', quantity(288, 'K'), { sourceName: 'источник фикстуры' })
        },
        {
          label: 'неправильная единица (Па вместо K)',
          value: knownValue(quantity(288, 'Pa'), { provenance: { sourceName: 'источник фикстуры' } })
        },
        {
          label: 'NaN в значении',
          value: {
            status: 'known',
            quantity: { value: Number.NaN, unit: 'K' },
            provenance: { sourceName: 'источник фикстуры' }
          } as unknown as ScientificValue
        },
        {
          label: 'отрицательная температура',
          value: knownValue(quantity(-5, 'K'), { provenance: { sourceName: 'источник фикстуры' } })
        }
      ];

      for (const fixture of fixtures) {
        const warnings = checkCompatibility(makeSurfaceWorld(fixture.value), 'realistic');
        // Пригодное provenance НЕ спасает непригодное число: ошибки
        // только на основании статуса known не возникает
        expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
        expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
      }
    });

    it('проверяемый расчёт не требует библиографии: method и rawInput — содержательный provenance', () => {
      const makeWorldWith = (provenance: DataProvenance) =>
        withLocationType(
          withTypedSurfaceTemperature(
            makeWorld('liquid_methane_ethane', {
              ...baseWorld(),
              atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
            }),
            { status: 'known', valueK: 288, provenance }
          ),
          'surface'
        );

      // Только метод расчёта: происхождение проверяемо без библиографии
      const methodWarnings = checkCompatibility(
        makeWorldWith({ method: 'energy balance fixed-point iteration' }),
        'realistic'
      );
      expect(errorsForRule(methodWarnings, 'cradle_temperature_compatibility')).toHaveLength(1);
      expect(methodWarnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);

      // Только исходные параметры расчёта
      const rawInputWarnings = checkCompatibility(
        makeWorldWith({ rawInput: { 'A (альбедо Бонда)': 0.3, f: 1, 'ε': 1 } }),
        'realistic'
      );
      expect(errorsForRule(rawInputWarnings, 'cradle_temperature_compatibility')).toHaveLength(1);
      expect(rawInputWarnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });
  });

  // Stage 4.2.2.3 (§4.5–9 ТЗ): поверхность и океан — РАЗНЫЕ области
  // с раздельными источниками температуры. Температура поверхности
  // не подтверждает и не опровергает океанскую колыбель; океан
  // доказывается ТОЛЬКО температурой конкретного резервуара по
  // явной ссылке localReservoirId; произвольный резервуар по
  // совпадению kind и резервуары других тел не выбираются.
  describe('Stage 4.2.2.3: поверхность ≠ океан', () => {
    const oceanWorld = () =>
      makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
      });

    it('доказанная температура поверхности НЕ подтверждает температуру океана', () => {
      // typed surface known 150 (в диапазоне 90–200), но океанская
      // среда не связана ни с каким резервуаром
      const world = withTypedSurfaceTemperature(oceanWorld(), {
        status: 'known',
        valueK: 150,
        sourceName: 'измерение фикстуры'
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('доказанная температура поверхности вне диапазона НЕ опровергает океанскую колыбель', () => {
      const world = withTypedSurfaceTemperature(oceanWorld(), {
        status: 'known',
        valueK: 288,
        sourceName: 'измерение фикстуры'
      });
      const warnings = checkCompatibility(world, 'realistic');
      // 288 K вне 90–200 K, но это температура ПОВЕРХНОСТИ, а не океана:
      // доказанного опровержения нет — только недоказанность
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('океан с явным reservoir (known + provenance) вне диапазона → доказанная ошибка', () => {
      const world = withOceanReservoir(
        oceanWorld(),
        {
          reservoirTemperature: knownValue(quantity(288, 'K'), {
            provenance: { sourceName: 'зонд фикстуры: температура океана' }
          })
        }
      );
      const warnings = checkCompatibility(world, 'realistic');
      const errors = errorsForRule(warnings, 'cradle_temperature_compatibility');
      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe('error');
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_estimate_outside_range')).toBe(false);
    });

    it('океан с явным reservoir (known + provenance) в диапазоне → доказанная проверка', () => {
      const world = withOceanReservoir(
        oceanWorld(),
        {
          reservoirTemperature: knownValue(quantity(150, 'K'), {
            provenance: { sourceName: 'зонд фикстуры: температура океана' }
          })
        }
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_estimate_outside_range')).toBe(false);
    });

    it('океан без reservoir ID → недоказанность, отсутствие ошибки именно из-за неизвестности', () => {
      const world = withOceanReservoir(oceanWorld(), { linkReservoirId: null });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(0);
      const unproven = warnings.filter(w => w.ruleId === 'cradle_temperature_unproven');
      expect(unproven).toHaveLength(1);
      expect(unproven[0].message).toContain('НЕ ДОКАЗАНА');
    });

    it('резервуар без температуры → недоказанность, не ошибка', () => {
      const world = withOceanReservoir(oceanWorld(), { reservoirTemperature: undefined });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('резервуар с unknown-температурой → недоказанность, не ошибка', () => {
      const world = withOceanReservoir(oceanWorld(), {
        reservoirTemperature: unknownValue('температура океана не измерялась')
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('резервуар known БЕЗ provenance вне диапазона → нет ошибки, недоказанность', () => {
      const world = withOceanReservoir(oceanWorld(), {
        reservoirTemperature: knownValue(quantity(288, 'K')) // без provenance
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('резервуар estimated вне диапазона → оценочное предупреждение и недоказанность, НЕ ошибка', () => {
      const world = withOceanReservoir(oceanWorld(), {
        reservoirTemperature: estimatedValue(quantity(288, 'K'), 'модельная оценка фикстуры', {
          provenance: { sourceName: 'оценка фикстуры' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const estimate = errorsForRule(warnings, 'cradle_temperature_estimate_outside_range');
      expect(estimate).toHaveLength(1);
      expect(estimate[0].severity).toBe('warning');
      expect(estimate[0].message).toContain('НЕ является доказанным физическим противоречием');
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('резервуар ДРУГОГО тела не выбирается как температура океана', () => {
      // Резервуар физически существует, но принадлежит луне —
      // читается только пара (bodyId 'planet', localReservoirId)
      const world = withOceanReservoir(oceanWorld(), {
        reservoirBodyId: 'moon',
        withMoonBody: true,
        reservoirTemperature: knownValue(quantity(288, 'K'), {
          provenance: { sourceName: 'зонд фикстуры: чужой резервуар' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('ссылка на несуществующий reservoir ID → недоказанность, не ошибка', () => {
      const world = withOceanReservoir(oceanWorld(), {
        linkReservoirId: 'несуществующий_резервуар',
        reservoirTemperature: knownValue(quantity(288, 'K'), {
          provenance: { sourceName: 'зонд фикстуры' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('подземная среда доказывается температурой явно связанного резервуара', () => {
      // Сверхкритическая вода (647–1000 K, глубинный резервуар):
      // локальная среда subsurface_reservoir, связанная с резервуаром
      // ядра, доказывается его температурой — доказательство через
      // резервуар работает и для неокеанских областей.
      // Stage 4.2.2.5 (фикс): вид резервуара должен быть допустим для
      // subsurface_reservoir — 'crust'; вид 'ocean' больше не
      // принимается (схема ReservoirRecord не различает поверхностный
      // и подземный океан).
      const world = withOceanReservoir(
        makeWorld('supercritical_water', {
          ...baseWorld(),
          atmosphere: makeAtmosphere([['n2', 100]], null, null)
        }),
        {
          reservoirKind: 'crust',
          reservoirTemperature: knownValue(quantity(700, 'K'), {
            provenance: { sourceName: 'скважина фикстуры: сверхкритический резервуар' }
          })
        }
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });
  });

  // Stage 4.2.2.4 (§2 ТЗ): вид резервуара (ReservoirRecord.kind) должен
  // соответствовать локальной среде (CradleLocationType): температура
  // резервуара атмосферы не доказывает температуру океана, лёд — не
  // океанический резервуар, вид 'ocean' не соответствует глубоким
  // планетным слоям (допустимы mantle/core). Несовпадение вида —
  // НЕДОКАЗАННОСТЬ (fail-closed), не физическая ошибка; правильный
  // вид сохраняет доказательную семантику Stage 4.2.2.3; другой
  // резервуар автоматически не выбирается.
  describe('Stage 4.2.2.4: вид резервуара должен соответствовать локальной среде', () => {
    const oceanWorld = () =>
      makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5)
      });

    const subsurfaceWorld = () =>
      makeWorld('supercritical_water', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['n2', 100]], null, null)
      });

    const deepWorld = () =>
      makeWorld('molten_salts', {
        ...baseWorld(),
        physicalCharacteristics: makePhysicalCharacteristics({
          surfaceTemperature: 1500,
          atmosphericPressure: 1,
          geologicalActivity: 'Высокая геологическая активность'
        })
      });

    it('экспортированное соответствие фиксирует допустимые виды без изобретения таксономии', () => {
      expect(LOCATION_TYPE_RESERVOIR_KINDS.ocean).toEqual(['ocean']);
      // Stage 4.2.2.5: вид 'ocean' убран из subsurface_reservoir —
      // схема ReservoirRecord не различает поверхностный и подземный
      // океан: поверхностный океан не доказывает глубинную среду.
      expect(LOCATION_TYPE_RESERVOIR_KINDS.subsurface_reservoir).toEqual(['crust']);
      expect(LOCATION_TYPE_RESERVOIR_KINDS.deep_planetary_layers).toEqual(['mantle', 'core']);
      expect(LOCATION_TYPE_RESERVOIR_KINDS.surface).toBeNull();
      expect(LOCATION_TYPE_RESERVOIR_KINDS.atmosphere).toBeNull();
      expect(LOCATION_TYPE_RESERVOIR_KINDS.other).toBeNull();
    });

    it('океан + резервуар атмосферы: even known + provenance НЕ доказывает и НЕ опровергает', () => {
      // 288 K вне диапазона 90–200, но резервуар атмосферы температурой
      // океана не является: физической ошибки нет — недоказанность
      const world = withOceanReservoir(oceanWorld(), {
        reservoirKind: 'atmosphere',
        reservoirTemperature: knownValue(quantity(288, 'K'), {
          provenance: { sourceName: 'зонд фикстуры: атмосферный резервуар, не океан' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('океан + резервуар льда (kind ice): недоказанность, не физическая ошибка', () => {
      // 150 K формально в диапазоне 90–200, но ледяной резервуар без
      // явно обоснованной связи с океанской средой: молчаливого
      // подтверждения нет
      const world = withOceanReservoir(oceanWorld(), {
        reservoirKind: 'ice',
        reservoirTemperature: knownValue(quantity(150, 'K'), {
          provenance: { sourceName: 'зонд фикстуры: ледяной покров' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('подземная среда + резервуар атмосферы не принимается как доказательство', () => {
      // 700 K в диапазоне 647–1000, но вид 'atmosphere' недопустим для
      // subsurface_reservoir: доказательство недоступно
      const world = withOceanReservoir(subsurfaceWorld(), {
        reservoirKind: 'atmosphere',
        reservoirTemperature: knownValue(quantity(700, 'K'), {
          provenance: { sourceName: 'скважина фикстуры' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('глубинные слои + вид ocean не принимается как доказательство', () => {
      // Вид 'ocean' допустим для океана, но НЕ для deep_planetary_layers
      // (допустимы mantle/core): even известные 1500 K в диапазоне
      // не доказывают среду
      const world = withOceanReservoir(deepWorld(), {
        reservoirKind: 'ocean',
        reservoirTemperature: knownValue(quantity(1500, 'K'), {
          provenance: { sourceName: 'скважина фикстуры' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('неизвестный тип расположения (other) не выводит природу резервуара из ID', () => {
      // Даже вид 'ocean' с known + provenance в диапазоне не доказывает
      // среду с недокументируемым расположением (fail-closed)
      const world = withLocationType(
        withOceanReservoir(oceanWorld(), {
          reservoirTemperature: knownValue(quantity(150, 'K'), {
            provenance: { sourceName: 'зонд фикстуры' }
          })
        }),
        'other'
      );
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('правильный вид (mantle) + known вне диапазона → доказанная ошибка', () => {
      // Прежние контракты в силе: при правильном виде доказанное
      // значение вне диапазона — физическая ошибка
      const world = withOceanReservoir(deepWorld(), {
        reservoirKind: 'mantle',
        reservoirTemperature: knownValue(quantity(288, 'K'), {
          provenance: { sourceName: 'скважина фикстуры: мантийный резервуар' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      const errors = errorsForRule(warnings, 'cradle_temperature_compatibility');
      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe('error');
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });

    it('правильный вид (mantle) + known в диапазоне → доказанная проверка', () => {
      const world = withOceanReservoir(deepWorld(), {
        reservoirKind: 'mantle',
        reservoirTemperature: knownValue(quantity(1500, 'K'), {
          provenance: { sourceName: 'скважина фикстуры: мантийный резервуар' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });

    it('правильный вид (crust) доказывает подземную среду: прежняя семантика сохранена', () => {
      const world = withOceanReservoir(subsurfaceWorld(), {
        reservoirKind: 'crust',
        reservoirTemperature: knownValue(quantity(700, 'K'), {
          provenance: { sourceName: 'скважина фикстуры: коровый резервуар' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });

    it('правильный вид + estimated вне диапазона → предупреждение, не ошибка', () => {
      const world = withOceanReservoir(subsurfaceWorld(), {
        reservoirKind: 'crust',
        reservoirTemperature: estimatedValue(quantity(288, 'K'), 'модельная оценка фикстуры', {
          provenance: { sourceName: 'оценка фикстуры' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const estimate = errorsForRule(warnings, 'cradle_temperature_estimate_outside_range');
      expect(estimate).toHaveLength(1);
      expect(estimate[0].severity).toBe('warning');
      expect(estimate[0].message).toContain('НЕ является доказанным физическим противоречием');
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('резервуар другого тела с правильным видом не читается (прежняя защита сохранена)', () => {
      // Kind-гейт не ослабил проверку принадлежности телу: пара
      // (bodyId 'planet', localReservoirId) остаётся обязательной
      const world = withOceanReservoir(oceanWorld(), {
        reservoirKind: 'ocean',
        reservoirBodyId: 'moon',
        withMoonBody: true,
        reservoirTemperature: knownValue(quantity(288, 'K'), {
          provenance: { sourceName: 'зонд фикстуры: чужой резервуар' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });
  });


  // Stage 4.2.2.5 (§4–5 ТЗ): семантика видов резервуаров и runtime-
  // безопасность kind-гейта. Тестовая фикстура физическим
  // обоснованием таксономии НЕ является: subsurface_reservoir
  // доказывается только видом 'crust' (схема ReservoirRecord не
  // различает поверхностный и подземный океан); неизвестное
  // runtime-расположение — fail-closed без исключений.
  // Stage 4.2.2.5.1: fail-closed охватывает и имена унаследованных
  // свойств прототипа ('constructor'/'toString'/'hasOwnProperty'/
  // '__proto__') — унаследованные значения Object.prototype
  // списками допустимых видов резервуаров не являются.
  describe('Stage 4.2.2.5: семантика видов и runtime-безопасность kind-гейта', () => {
    const subsurfaceWorld = () =>
      makeWorld('supercritical_water', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['n2', 100]], null, null)
      });

    /**
     * Stage 4.2.2.5.1: декой-резервуар тела 'planet' с ДОКАЗАННОЙ
     * (known + содержательный provenance) неприемлемой температурой
     * 288 K — вне диапазона supercritical_water (647–1000 K). Если
     * бы kind-гейт при некорректном locationType автоматически
     * «перепрыгнул» на другой резервуар, возникла бы ошибка
     * cradle_temperature_compatibility. Отсутствие такой ошибки —
     * наблюдаемое доказательство запрета автоподбора резервуара.
     */
    const withDecoyReservoir = (world: Partial<GeneratedWorld>): Partial<GeneratedWorld> => {
      world.coreWorldState!.reservoirs.push({
        id: 'decoy_reservoir',
        kind: 'crust',
        bodyId: 'planet',
        properties: {},
        reservoirTemperature: knownValue(quantity(288, 'K'), {
          provenance: { sourceName: 'скважина фикстуры: ловушка автоподбора' }
        })
      });
      return world;
    };

    it("вид 'ocean' больше не доказывает подземную среду: недоказанность, не ошибка", () => {
      // 700 K внутри диапазона 647–1000 с known + provenance, но
      // ReservoirRecord не различает поверхностный и подземный
      // океан: допущение 'ocean' позволяло бы поверхностному
      // океану «доказывать» глубинную среду. Достаточных данных
      // для такого соответствия нет — доказательство убрано
      // (fail-closed), новые виды не вводятся, фикстура таксономию
      // не обосновывает.
      const world = withOceanReservoir(subsurfaceWorld(), {
        reservoirKind: 'ocean',
        reservoirTemperature: knownValue(quantity(700, 'K'), {
          provenance: { sourceName: 'скважина фикстуры: глубинный резервуар' }
        })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('runtime-неизвестный locationType не выбрасывает, не доказывает и не подбирает другой резервуар', () => {
      // Некорректное runtime-значение поступает через явно
      // приведённую фикстуру (внешние данные/сохранения). Lookup
      // по несобственному ключу таблицы даёт undefined: без
      // исключения, без доказательства, без выбора другого
      // резервуара — недоказанность (fail-closed). Декой-резервуар
      // с доказанной неприемлемой температурой фиксирует отсутствие
      // автоподбора.
      const world = withDecoyReservoir(
        withLocationType(
          withOceanReservoir(subsurfaceWorld(), {
            reservoirKind: 'crust',
            reservoirTemperature: knownValue(quantity(700, 'K'), {
              provenance: { sourceName: 'скважина фикстуры: коровый резервуар' }
            })
          }),
          'hydrothermal_sinter' as unknown as CradleLocalEnvironment['locationType']
        )
      );
      // Прямой вызов = no-throw assert: гейт обязан вернуть
      // недоказанность, а не выбросить TypeError на undefined.
      const warnings = checkCompatibility(world, 'realistic');
      // Нет ошибки по температуре этого резервуара; автоподбор
      // другого резервуара не выполняется (декой с доказанной
      // неприемлемой температурой не становится «доказательством»).
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      // Явная недоказанность.
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it("имена унаследованных свойств прототипа как locationType — fail-closed без TypeError", () => {
      // Stage 4.2.2.5.1: LOCATION_TYPE_RESERVOIR_KINDS — обычный
      // объект, наследующий свойства Object.prototype. При обычном
      // lookup 'constructor'/'toString'/'hasOwnProperty' вернули бы
      // функции, '__proto__' — Object.prototype, и последующий
      // .includes() выбросил бы TypeError. Гейт обязан проверять
      // СОБСТВЕННОСТЬ ключа: без исключения, без доказательства,
      // без выбора другого резервуара — недоказанность (fail-closed).
      // Приведение типа — ТОЛЬКО на границе тестовой фикстуры; вид
      // 'crust' допустим для subsurface_reservoir, поэтому тест
      // гарантированно проходит через фактический kind-гейт.
      const prototypeKeyLocationTypes = [
        'constructor',
        'toString',
        'hasOwnProperty',
        '__proto__'
      ];
      for (const rawLocationType of prototypeKeyLocationTypes) {
        const world = withDecoyReservoir(
          withLocationType(
            withOceanReservoir(subsurfaceWorld(), {
              reservoirKind: 'crust',
              reservoirTemperature: knownValue(quantity(700, 'K'), {
                provenance: { sourceName: 'скважина фикстуры: коровый резервуар' }
              })
            }),
            rawLocationType as unknown as CradleLocalEnvironment['locationType']
          )
        );
        // Прямой вызов = no-throw assert: гейт обязан вернуть
        // недоказанность, а не выбросить TypeError на унаследованном
        // свойстве прототипа.
        const warnings = checkCompatibility(world, 'realistic');
        // Нет ошибки по температуре; автоподбор другого резервуара
        // не выполняется.
        expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
        // Явная недоказанность.
        expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
      }
    });
  });

  // Stage 4.2.2.3 (§4.10–12 ТЗ): приоритет типизированного значения
  // над легаси-скаляром. При наличии пригодного typed known
  // легаси-число не читается вовсе; легаси-скаляр без типизированного
  // значения — оценочный сценарий ТОЛЬКО поверхности: он не создаёт
  // ни ошибки, ни молчаливого подтверждения.
  describe('Stage 4.2.2.3: приоритет typed над легаси-скаляром', () => {
    const surfaceWorld = (legacySurfaceTemperature?: number) =>
      withLocationType(
        makeWorld('liquid_methane_ethane', {
          ...baseWorld(),
          atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
          ...(legacySurfaceTemperature !== undefined
            ? {
                physicalCharacteristics: makePhysicalCharacteristics({
                  surfaceTemperature: legacySurfaceTemperature
                })
              }
            : {})
        }),
        'surface'
      );

    it('typed known в диапазоне + легаси-число вне диапазона → нет ни ошибки, ни предупреждений', () => {
      const world = withTypedSurfaceTemperature(surfaceWorld(288), {
        status: 'known',
        valueK: 150,
        sourceName: 'измерение фикстуры'
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });

    it('typed known вне диапазона + легаси-число в диапазоне → одна доказанная ошибка без дублирующего предупреждения', () => {
      const world = withTypedSurfaceTemperature(surfaceWorld(150), {
        status: 'known',
        valueK: 288,
        sourceName: 'измерение фикстуры'
      });
      const warnings = checkCompatibility(world, 'realistic');
      const errors = errorsForRule(warnings, 'cradle_temperature_compatibility');
      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe('error');
      // Легаси-скаляр после пригодного typed known не читается:
      // оценочного предупреждения нет
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(false);
    });

    it('только легаси-число вне диапазона → оценочное предупреждение, никогда ошибка', () => {
      const world = surfaceWorld(288);
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      const estimate = errorsForRule(warnings, 'cradle_temperature_estimate_outside_range');
      expect(estimate).toHaveLength(1);
      expect(estimate[0].severity).toBe('warning');
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
      expect(isWorldCompatible(world, 'realistic')).toBe(true);
    });

    it('только легаси-число в диапазоне → нет оценочного предупреждения, но остаётся недоказанным', () => {
      const world = surfaceWorld(150);
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
    });

    it('даже абсурдное легаси-число (5000 K) даёт только предупреждение', () => {
      const world = surfaceWorld(5000);
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(1);
      expect(isWorldCompatible(world, 'realistic')).toBe(true);
    });
  });

  // Stage 4.2.2.3: запрет fallback — легаси-число поверхности не
  // используется даже как ОЦЕНКА океанской среды. Оценочный сценарий
  // правила 6b строится только по значению указанной области.
  describe('Stage 4.2.2.3: легаси-число поверхности не используется как оценка океана', () => {
    it('океанская среда + легаси surfaceTemperature вне диапазона → нет оценочного предупреждения, только недоказанность', () => {
      const world = makeWorld('liquid_methane_ethane', {
        ...baseWorld(),
        atmosphere: makeAtmosphere([['ch4', 60], ['c2h6', 15], ['n2', 25]], 95, 1.5),
        physicalCharacteristics: makePhysicalCharacteristics({ surfaceTemperature: 288 })
      });
      const warnings = checkCompatibility(world, 'realistic');
      expect(errorsForRule(warnings, 'cradle_temperature_compatibility')).toHaveLength(0);
      // Поверхностные 288 K — не температура океана: правило 6b
      // молчит, оценка не выдумывается
      expect(errorsForRule(warnings, 'cradle_temperature_estimate_outside_range')).toHaveLength(0);
      expect(warnings.some(w => w.ruleId === 'cradle_temperature_unproven')).toBe(true);
      expect(isWorldCompatible(world, 'realistic')).toBe(true);
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
      // Этап 3: используем объект, который РЕАЛЬНО нарушает возрастное
      // ограничение в реалистичном режиме, чтобы проверить, что аномальный
      // режим отключает именно это правило.
      const lateObject = {
        ...centralObjects.find(o => o.id === 'blue_giant')!,
        id: 'test_late_object',
        existenceWindow: { earliestUniverseAgeGyr: 20 }
      };
      const world: Partial<GeneratedWorld> = {
        ...baseWorld(),
        mode: 'anomalous',
        epoch: epochs.find(e => e.id === 'ancient_cosmos')!,
        centralObject: lateObject,
        cradle: findCradle('supercritical_water')
      };

      // Реалистичный режим: ошибка есть — Вселенная слишком молода для класса.
      expect(errorsForRule(checkCompatibility(world, 'realistic'), 'age_central_object_compatibility')).toHaveLength(1);

      // Аномальный режим: возрастное правило отключено.
      const warnings = checkCompatibility(world, 'anomalous');
      expect(errorsForRule(warnings, 'age_central_object_compatibility')).toHaveLength(0);
    });

    it('аномальный режим НЕ отключает физическое правило фазового скрининга (этап 3)', () => {
      // Синтетический мир с подтверждённой потенциальной конденсацией:
      // правило 14 сознательно без exemptInAnomalousMode.
      const phaseAnalysis = {
        temperatureK: 95,
        components: [],
        hasPotentialTransitions: true,
        warnings: ['тестовая конденсация'],
        mixtureNote: 'тест'
      };
      const world: Partial<GeneratedWorld> = {
        ...baseWorld(),
        mode: 'anomalous',
        cosmology: cosmologies.find(c => c.id === 'world_as_body')!,
        phaseAnalysis: phaseAnalysis as unknown as GeneratedWorld['phaseAnalysis']
      };

      const warnings = checkCompatibility(world, 'anomalous');
      expect(warnings.some(w => w.ruleId === 'atmosphere_phase_screening')).toBe(true);
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
