// ============================================
// TESTS - Generator module tests
// ============================================

import { describe, it, expect } from 'vitest';
import {
  generateWorld,
  generateMultipleWorlds,
  generateWorldWithFixedCategories,
  generateRandomSeed,
  isCradleSupportedOnWorld,
  selectCradle
} from '../Generator/generator';
import { createRandom } from '../Generator/random';
import type { GenerationSettings, AtmosphereState, PhysicalCharacteristics, CradleLocalEnvironment } from '../../types';
import { cosmologies, epochs, centralObjects, celestialBodies, cradles } from '../Data';
import { checkCompatibility } from '../Compatibility';
import { determineCradleLocalEnvironment } from '../WorldModel';
import { knownValue, estimatedValue, unknownValue, notApplicable } from '../Core/scientificValue';
import type { ScientificValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { createCoreWorldState } from '../Core/worldState';

function baseSettings(overrides: Partial<GenerationSettings> = {}): GenerationSettings {
  return {
    seed: 'test_seed_123',
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

function worldSignature(world: { cosmology: { id: string }; epoch: { id: string }; centralObject: { id: string }; celestialBody: { id: string }; cradle: { id: string } }) {
  return [
    world.cosmology.id,
    world.epoch.id,
    world.centralObject.id,
    world.celestialBody.id,
    world.cradle.id
  ].join('|');
}

describe('Generator Module', () => {
  describe('generateWorld', () => {
    it('should generate a valid world object', () => {
      // Фиксируем реалистичную космологию: без фиксации случайный выбор
      // может выбрать аномальную космологию, что законно переключит режим.
      const world = generateWorld(baseSettings({
        fixedCategories: { cosmology: 'big_bang' }
      }));

      expect(world).toBeDefined();
      expect(world.id).toBeDefined();
      expect(world.createdAt).toBeDefined();
      expect(world.seed).toBe('test_seed_123');
      expect(world.mode).toBe('realistic');
      expect(world.cosmology).toBeDefined();
      expect(world.epoch).toBeDefined();
      expect(world.centralObject).toBeDefined();
      expect(world.celestialBody).toBeDefined();
      expect(world.cradle).toBeDefined();
      expect(world.physicalCharacteristics).toBeDefined();
      expect(world.energySources).toBeDefined();
      expect(world.atmosphere).toBeDefined();
      expect(world.cradleLocalEnvironment).toBeDefined();
      expect(world.causalChain).toBeDefined();
      expect(world.evolutionImplications).toBeDefined();
      expect(world.scientificStatus).toBeDefined();
      expect(world.warnings).toBeInstanceOf(Array);
      expect(world.appliedRules).toBeInstanceOf(Array);
    });

    it('should generate deterministic results with same seed', () => {
      const world1 = generateWorld(baseSettings({ seed: 'deterministic_test' }));
      const world2 = generateWorld(baseSettings({ seed: 'deterministic_test' }));

      expect(world1.id).toBe(world2.id);
      expect(world1.cosmology.id).toBe(world2.cosmology.id);
      expect(world1.epoch.id).toBe(world2.epoch.id);
      expect(world1.centralObject.id).toBe(world2.centralObject.id);
      expect(world1.celestialBody.id).toBe(world2.celestialBody.id);
      expect(world1.cradle.id).toBe(world2.cradle.id);
    });

    it('одинаковый seed воспроизводит мир полностью, включая предупреждения', () => {
      const world1 = generateWorld(baseSettings({ seed: 'full_determinism' }));
      const world2 = generateWorld(baseSettings({ seed: 'full_determinism' }));

      // createdAt зависит от времени, всё остальное должно совпадать
      const stripCreatedAt = (w: typeof world1) => {
        const copy = { ...w } as Record<string, unknown>;
        delete copy.createdAt;
        return copy;
      };

      expect(stripCreatedAt(world1)).toEqual(stripCreatedAt(world2));
      expect(JSON.stringify(world1.warnings)).toBe(JSON.stringify(world2.warnings));
    });

    it('реалистичная космология не активирует аномальный режим', () => {
      const world = generateWorld(baseSettings({
        seed: 'realistic_stays_realistic',
        fixedCategories: { cosmology: 'big_bang' }
      }));

      expect(world.mode).toBe('realistic');
      expect(world.cosmology.id).toBe('big_bang');
      expect(world.scientificStatus).not.toBe('anomalous_rule');
      expect(world.warnings.some(w => w.ruleId === 'anomalous_cosmology_mode_automatic_activation')).toBe(false);
    });

    it.each(['world_as_body', 'dream', 'simulation', 'monster_imprisonment'])(
      'аномальная космология %s принудительно активирует аномальный режим',
      (cosmologyId) => {
        const world = generateWorld(baseSettings({
          seed: `anomalous_${cosmologyId}`,
          mode: 'realistic', // пользователь явно запросил realistic — режим перекрывается
          fixedCategories: { cosmology: cosmologyId }
        }));

        expect(world.cosmology.id).toBe(cosmologyId);
        // Режим realistic не должен молча перекрывать требования аномальной космологии
        expect(world.mode).toBe('anomalous');
        expect(world.scientificStatus).toBe('anomalous_rule');

        // Обязательное информационное предупреждение о переключении режима
        const activationWarning = world.warnings.find(
          w => w.ruleId === 'anomalous_cosmology_mode_automatic_activation'
        );
        expect(activationWarning).toBeDefined();
        expect(activationWarning?.severity).toBe('info');

        // Ошибки «аномальная космология без аномального режима» быть не должно:
        // режим уже активирован автоматически
        expect(world.warnings.some(
          w => w.ruleId === 'anomalous_cosmology_requires_anomalous_mode'
        )).toBe(false);
      }
    );

    it('аномальный режим не отключает физические проверки колыбели', () => {
      const world = generateWorld(baseSettings({
        seed: 'anomalous_keeps_checks',
        mode: 'realistic',
        fixedCategories: {
          cosmology: 'dream',
          celestialBody: 'small_planet',
          cradle: 'supercritical_water'
        },
        atmospherePreset: 'earth'
      }));

      expect(world.mode).toBe('anomalous');
      // Геологическое требование — физическая проверка, а не аномальное правило:
      // оно должно остаться активным даже в аномальном режиме
      expect(world.warnings.some(
        w => w.ruleId === 'cradle_geological_requirements' && w.severity === 'error'
      )).toBe(true);
    });

    it('should respect fixed categories', () => {
      const world = generateWorld(baseSettings({
        seed: 'fixed_test',
        fixedCategories: { epoch: 'first_water_era' }
      }));

      expect(world.epoch.id).toBe('first_water_era');
    });

    it('зафиксированная несовместимая колыбель даёт ошибку совместимости', () => {
      // small_planet: низкая тектоническая активность — сверхкритической воде
      // нужна высокая геологическая активность
      const world = generateWorld(baseSettings({
        seed: 'fixed_incompatible_cradle',
        fixedCategories: {
          celestialBody: 'small_planet',
          cradle: 'supercritical_water'
        },
        atmospherePreset: 'earth'
      }));

      expect(world.cradle.id).toBe('supercritical_water');
      expect(world.celestialBody.id).toBe('small_planet');

      const geoError = world.warnings.find(
        w => w.ruleId === 'cradle_geological_requirements' && w.severity === 'error'
      );
      expect(geoError).toBeDefined();
    });

    it('отсутствие поддерживаемых колыбелей даёт предупреждение fallback', () => {
      // Земная атмосфера на маленькой планете: ни одна колыбель
      // не проходит реальные проверки совместимости
      const world = generateWorld(baseSettings({
        seed: 'no_supported_cradles',
        fixedCategories: { celestialBody: 'small_planet' },
        atmospherePreset: 'earth'
      }));

      const fallbackWarning = world.warnings.find(
        w => w.ruleId === 'cradle_support_fallback'
      );
      expect(fallbackWarning).toBeDefined();
      expect(fallbackWarning?.severity).toBe('warning');
    });

    it('локальная среда колыбели отделяется от атмосферы планеты', () => {
      const world = generateWorld(baseSettings({
        seed: 'cradle_env_structure',
        fixedCategories: {
          celestialBody: 'earth_like',
          cradle: 'supercritical_water'
        },
        atmospherePreset: 'earth'
      }));

      const env = world.cradleLocalEnvironment;

      // Сверхкритическая вода существует в глубинном гидротермальном резервуаре
      expect(env.locationType).toBe('subsurface_reservoir');
      expect(env.matterState).toBe('supercritical_fluid');
      // Точные значения не подменяются произвольными числами
      expect(env.temperature).toBeNull();
      expect(env.pressure).toBeNull();
      // Известные диапазоны требований сохраняются
      expect(env.temperatureRange).toEqual({ min: 647, max: 1000 });
      expect(env.pressureRange).toEqual({ min: 22.1, max: 500 });
      expect(env.energySources.length).toBeGreaterThan(0);
      expect(env.chemicalConstraints).toBeInstanceOf(Array);
      expect(env.composition.length).toBeGreaterThan(0);
      expect(env.composition.some(c => c.componentId === 'h2o')).toBe(true);
      expect(env.locationDescription.length).toBeGreaterThan(0);

      // Атмосфера планеты при этом остаётся земной
      expect(world.atmosphere.temperature).toBe(288);
      expect(world.atmosphere.totalPressure).toBe(1);
      // Stage 4.2.2: пресетная температура атмосферы больше НЕ
      // копируется в температуру поверхности (это разные величины:
      // 288 K — допущение об атмосфере, а не измерение поверхности)
      expect(world.physicalCharacteristics.surfaceTemperature).toBeUndefined();
      expect(world.physicalCharacteristics.atmosphericPressure).toBe(1);
    });

    it('пресетная температура атмосферы не становится температурой поверхности (4.2.2: метановый пресет, 95 K)', () => {
      const world = generateWorld(baseSettings({
        seed: 'methane_surface_temperature',
        atmospherePreset: 'methane_ethane'
      }));

      expect(world.atmosphere.temperature).toBe(95);
      // Stage 4.2.2: 95 K — допущение об атмосфере (пресет), а НЕ
      // температура поверхности; копирование запрещено
      expect(world.physicalCharacteristics.surfaceTemperature).toBeUndefined();
      // Основные компоненты пресета сохраняются
      const ch4 = world.atmosphere.components.find(c => c.gasId === 'ch4');
      expect(ch4?.percentage).toBe(60);
    });

    it('атмосфера сгенерированного мира составляет ровно 100%', () => {
      const world = generateWorld(baseSettings({ seed: 'atmosphere_sum' }));

      const sum = world.atmosphere.components.reduce((acc, c) => acc + c.percentage, 0);
      expect(sum).toBeCloseTo(100, 6);
      expect(world.atmosphere.components.every(c => c.percentage >= 0)).toBe(true);
    });

    it('разные seed дают разные миры', () => {
      const signatures = new Set<string>();
      const ids = new Set<string>();

      for (let i = 0; i < 20; i++) {
        const world = generateWorld(baseSettings({ seed: `diversity_seed_${i}` }));
        signatures.add(worldSignature(world));
        ids.add(world.id);
      }

      // Реальная случайность: 20 миров должны давать заметное разнообразие
      expect(signatures.size).toBeGreaterThanOrEqual(3);
      expect(ids.size).toBe(20);
    });
  });

  describe('generateMultipleWorlds', () => {
    it('should generate multiple worlds', () => {
      const worlds = generateMultipleWorlds(baseSettings({ seed: 'multi_test_unique' }), 3);

      expect(worlds).toHaveLength(3);
      expect(worlds[0].seed).toBe('multi_test_unique_0');
      expect(worlds[1].seed).toBe('multi_test_unique_1');
      expect(worlds[2].seed).toBe('multi_test_unique_2');
    });

    it('should generate worlds with different seeds', () => {
      const worlds = generateMultipleWorlds(baseSettings({ seed: 'multi_seed_test' }), 2);

      expect(worlds[0].seed).toBe('multi_seed_test_0');
      expect(worlds[1].seed).toBe('multi_seed_test_1');
    });

    it('миры из серии различаются между собой', () => {
      const worlds = generateMultipleWorlds(baseSettings({ seed: 'series_diversity' }), 8);

      const signatures = new Set(worlds.map(worldSignature));
      expect(signatures.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('generateWorldWithFixedCategories', () => {
    it('should override existing fixed categories', () => {
      const world = generateWorldWithFixedCategories(
        baseSettings({
          seed: 'override_test',
          fixedCategories: { epoch: 'first_water_era' }
        }),
        { epoch: 'golden_middle' }
      );

      expect(world.epoch.id).toBe('golden_middle');
    });
  });

  describe('generateRandomSeed', () => {
    it('should generate a string seed', () => {
      const seed = generateRandomSeed();
      expect(typeof seed).toBe('string');
      expect(seed.length).toBe(16);
    });

    it('should generate different seeds on each call', () => {
      const seed1 = generateRandomSeed();
      const seed2 = generateRandomSeed();
      expect(seed1).not.toBe(seed2);
    });
  });
});

describe('Data Validation', () => {
  describe('Cosmologies', () => {
    it('should have all required cosmology options', () => {
      const expectedCosmologies = [
        'big_bang',
        'quantum_fluctuation',
        'branes',
        'false_vacuum',
        'world_as_body',
        'dream',
        'world_axis',
        'simulation',
        'cyclic_universe',
        'monster_imprisonment'
      ];

      const cosmologyIds = cosmologies.map(c => c.id);
      expectedCosmologies.forEach(id => {
        expect(cosmologyIds).toContain(id);
      });
    });

    it('should have anomalous cosmologies marked correctly', () => {
      const anomalousIds = ['world_as_body', 'dream', 'simulation', 'monster_imprisonment'];
      anomalousIds.forEach(id => {
        const cosmology = cosmologies.find(c => c.id === id);
        expect(cosmology?.isAnomalous).toBe(true);
      });
    });
  });

  describe('Epochs', () => {
    it('should have all required epoch options', () => {
      const expectedEpochs = ['first_water_era', 'golden_middle', 'ancient_cosmos'];
      const epochIds = epochs.map(e => e.id);
      expectedEpochs.forEach(id => {
        expect(epochIds).toContain(id);
      });
    });

    it('should have correct age ranges', () => {
      const firstWater = epochs.find(e => e.id === 'first_water_era');
      expect(firstWater?.ageRange).toEqual({ min: 2, max: 4 });

      const goldenMiddle = epochs.find(e => e.id === 'golden_middle');
      expect(goldenMiddle?.ageRange).toEqual({ min: 5, max: 9 });

      const ancientCosmos = epochs.find(e => e.id === 'ancient_cosmos');
      expect(ancientCosmos?.ageRange).toEqual({ min: 11, max: 13.8 });
    });
  });

  describe('Central Objects', () => {
    it('should have all required central object options', () => {
      const expectedObjects = [
        'orange_dwarf',
        'red_dwarf',
        'yellow_dwarf',
        'blue_giant',
        'white_dwarf',
        'pulsar',
        'black_hole',
        'brown_dwarf',
        'lone_gas_giant',
        'relativistic_jet'
      ];
      const objectIds = centralObjects.map(o => o.id);
      expectedObjects.forEach(id => {
        expect(objectIds).toContain(id);
      });
    });
  });

  describe('Celestial Bodies', () => {
    it('should have all required celestial body options', () => {
      const expectedBodies = [
        'small_planet',
        'earth_like',
        'super_earth',
        'mega_earth',
        'ocean_planet',
        'gas_giant_moon',
        'carbon_planet'
      ];
      const bodyIds = celestialBodies.map(b => b.id);
      expectedBodies.forEach(id => {
        expect(bodyIds).toContain(id);
      });
    });
  });

  describe('Cradles', () => {
    it('should have all required cradle options', () => {
      const expectedCradles = [
        'supercritical_water',
        'liquid_ammonia',
        'liquid_methane_ethane',
        'supercritical_co2',
        'h2o_co2_supercritical_mix',
        'hydrogen_helium_aerosols',
        'molten_salts'
      ];
      const cradleIds = cradles.map(c => c.id);
      expectedCradles.forEach(id => {
        expect(cradleIds).toContain(id);
      });
    });

    it('should have correct matter states', () => {
      const liquidAmmonia = cradles.find(c => c.id === 'liquid_ammonia');
      expect(liquidAmmonia?.matterState).toBe('liquid');

      const supercriticalWater = cradles.find(c => c.id === 'supercritical_water');
      expect(supercriticalWater?.matterState).toBe('supercritical_fluid');

      const hydrogenHelium = cradles.find(c => c.id === 'hydrogen_helium_aerosols');
      expect(hydrogenHelium?.matterState).toBe('aerosol');
    });
  });

  // Stage 4.2.2.1: интеграция диагностики «пресет vs T_eq» и
  // location-aware фазового скрининга в реальном генерационном контуре.
  describe('Stage 4.2.2.1: диагностика и локальный температурный контекст', () => {
    it('диагностика «пресет vs T_eq» появляется в результате реальной генерации', () => {
      const world = generateWorld(baseSettings({
        seed: 'divergence_integration',
        fixedCategories: { cosmology: 'big_bang', centralObject: 'yellow_dwarf', celestialBody: 'earth_like' },
        atmospherePreset: 'earth'
      }));

      // Информационная запись присутствует в warnings мира —
      // не только при прямом unit-вызове функции диагностики.
      const divergence = world.warnings.find(w => w.ruleId === 'preset_equilibrium_divergence');
      expect(divergence).toBeDefined();
      expect(divergence?.severity).toBe('info');
      expect(divergence?.category).toBe('atmosphere');
      // Явное указание разных физических величин
      expect(divergence?.message).toContain('РАЗНЫЕ величины');
      expect(divergence?.message).toContain('K');
      // НЕ объявляется физическим противоречием (нет threshold)
      expect(divergence?.message).toContain('без объявления физического противоречия');
      expect(divergence?.affectedFields).toContain('atmosphere');

      // appliedRules синхронно содержит правило
      expect(world.appliedRules).toContain('preset_equilibrium_divergence');
    });

    it('диагностика детерминирована и не изменяет сами температуры', () => {
      const first = generateWorld(baseSettings({
        seed: 'divergence_determinism',
        fixedCategories: { cosmology: 'big_bang', centralObject: 'yellow_dwarf', celestialBody: 'earth_like' },
        atmospherePreset: 'earth'
      }));
      const second = generateWorld(baseSettings({
        seed: 'divergence_determinism',
        fixedCategories: { cosmology: 'big_bang', centralObject: 'yellow_dwarf', celestialBody: 'earth_like' },
        atmospherePreset: 'earth'
      }));

      const firstWarning = first.warnings.find(w => w.ruleId === 'preset_equilibrium_divergence');
      const secondWarning = second.warnings.find(w => w.ruleId === 'preset_equilibrium_divergence');
      expect(firstWarning?.message).toBe(secondWarning?.message);
      // Сами величины не изменяются диагностикой
      expect(first.atmosphere.temperature).toBe(second.atmosphere.temperature);
      expect(first.energyBudget!.equilibriumTemperature.value)
        .toBe(second.energyBudget!.equilibriumTemperature.value);
    });

    it('фазовый скрининг привязан к слою surface_boundary с сохранением статуса и provenance', () => {
      const world = generateWorld(baseSettings({
        seed: 'surface_boundary_screening',
        atmospherePreset: 'earth'
      }));

      // Скрининг основан на явно обозначенной локальной области —
      // приповерхностном слое (однослойная модель текущего этапа)
      expect(world.phaseAnalysis!.temperatureBasis!.note).toContain('surface_boundary');
      expect(world.phaseAnalysis!.temperatureBasis!.note).toContain('НЕ глобальная surfaceTemperature');
      // Температура НЕ называется surfaceTemperature и НЕ T_eq
      expect(world.phaseAnalysis!.temperatureBasis!.note).toContain('НЕ T_eq');
      // Пресет 288 K (earth): статус и provenance сохранены
      const basisTemperature = world.phaseAnalysis!.temperatureBasis!.temperature;
      expect(basisTemperature.status).toBe('estimated');
      if (basisTemperature.status === 'estimated') {
        expect(basisTemperature.provenance?.rawInput).toMatchObject({
          presetTemperatureK: 288,
          presetKind: 'observational_reference'
        });
      }
      // Stage 4.2.2.2: структурированное место контекста — тот же layerId
      expect(world.phaseAnalysis!.temperatureBasis!.location).toEqual({
        kind: 'atmosphere_layer',
        layerId: 'surface_boundary'
      });
    });

    it('без пригодной пресетной температуры скрининг остаётся unknown без fallback на T_eq (4.2.2.2)', () => {
      // ЯВНАЯ атмосфера с корректным составом, но temperature: null —
      // сценарий гарантированно воспроизводит отсутствие температурной
      // информации (ранее без customAtmosphere генератор брал пресет
      // methane_ethane с температурой 95 K, и тест не доказывал
      // неизвестность). presetKind задан в корректной форме.
      const world = generateWorld(baseSettings({
        seed: 'unknown_screening_temperature',
        fixedCategories: {
          cosmology: 'big_bang',
          centralObject: 'yellow_dwarf',
          celestialBody: 'earth_like'
        },
        customAtmosphere: {
          components: [
            { gasId: 'n2', percentage: 80, isTrace: false, uncertainty: '', warnings: [] },
            { gasId: 'ch4', percentage: 20, isTrace: false, uncertainty: '', warnings: [] }
          ],
          totalPressure: 1,
          temperature: null,
          notes: 'фикстура: состав задан, температура не заявлена',
          presetKind: 'hypothetical',
          presetNotes: 'температура не заявлена намеренно'
        } as AtmosphereState
      }));

      // Числовой результат скрининга отсутствует — именно unknown
      expect(world.phaseAnalysis!.temperatureK).toBeNull();
      expect(world.phaseAnalysis!.temperatureBasis!.temperature.status).toBe('unknown');
      // ВСЕ компоненты фазового анализа остаются unknown
      expect(world.phaseAnalysis!.components.length).toBeGreaterThan(0);
      for (const component of world.phaseAnalysis!.components) {
        expect(component.state).toBe('unknown');
      }
      // T_eq энергетического бюджета вычислена, но НЕ подставлена
      // вместо локальной температуры
      expect(world.energyBudget!.equilibriumTemperature.value).not.toBeNull();
      expect(world.phaseAnalysis!.temperatureK).toBeNull();
      // note объясняет контекст локальной области
      expect(world.phaseAnalysis!.temperatureBasis!.note).toContain('Stage 4.2.2.1');
      // Структурированное место слоя задано и остаётся unknown-слоем
      expect(world.phaseAnalysis!.temperatureBasis!.location).toEqual({
        kind: 'atmosphere_layer',
        layerId: 'surface_boundary'
      });
    });
  });

  // Stage 4.2.2.2: семантика «оценка не является доказанным
  // противоречием» в реальном генерационном контуре + измерение
  // системного следствия для scientificStatus.
  describe('Stage 4.2.2.2: оценочные расхождения и научный статус миров', () => {
    it('оценочное расхождение не отбрасывает колыбель из автоматического выбора', () => {
      // Венусоподобная водородно-гелиевая атмосфера 737 K при
      // диапазоне колыбели 50–500 K: оценка (не known) — предупреждение
      // cradle_temperature_estimate_outside_range, колыбель остаётся
      // кандидатом (isCradleSupportedOnWorld фильтрует только error).
      const world = generateWorld(baseSettings({
        seed: 'cradle_estimate_keeps_candidate',
        fixedCategories: {
          cosmology: 'big_bang',
          centralObject: 'yellow_dwarf',
          celestialBody: 'earth_like',
          cradle: 'hydrogen_helium_aerosols'
        },
        customAtmosphere: {
          components: [
            { gasId: 'h2', percentage: 80, isTrace: false, uncertainty: '', warnings: [] },
            { gasId: 'he', percentage: 15, isTrace: false, uncertainty: '', warnings: [] },
            { gasId: 'ch4', percentage: 5, isTrace: false, uncertainty: '', warnings: [] }
          ],
          totalPressure: 92,
          temperature: 737,
          notes: 'фикстура: венусоподобный оценочный сценарий',
          presetKind: 'hypothetical',
          presetNotes: 'оценочный сценарий вне диапазона колыбели'
        } as AtmosphereState
      }));

      expect(world.cradle.id).toBe('hydrogen_helium_aerosols');
      // Предупреждение оценочного расхождения присутствует в мире
      const estimate = world.warnings.filter(w => w.ruleId === 'cradle_temperature_estimate_outside_range');
      expect(estimate.length).toBeGreaterThan(0);
      expect(estimate[0].severity).toBe('warning');
      // ...но не превратилось в доказанную ошибку
      expect(world.warnings.some(w => w.ruleId === 'cradle_temperature_compatibility')).toBe(false);

      // Прямая проверка фильтрации: колыбель не отбрасывается
      const supported = isCradleSupportedOnWorld(world.cradle, {
        mode: 'realistic',
        centralObject: world.centralObject,
        celestialBody: world.celestialBody,
        atmosphere: world.atmosphere,
        bodyCharacteristics: world.physicalCharacteristics
      });
      expect(supported).toBe(true);
    });

    it('доля миров с hypothetical из-за cradle_temperature_unproven измерена детерминированно', () => {
      // Репрезентативная серия: 25 сидов, фиксирована только
      // неаномальная космология (остальное сэмплируется).
      const worlds = Array.from({ length: 25 }, (_, i) =>
        generateWorld(baseSettings({
          seed: `hypothetical_share_${i}`,
          fixedCategories: { cosmology: 'big_bang' }
        }))
      );

      for (const world of worlds) {
        // КАЖДЫЙ мир реалистичного режима несёт предупреждение
        // недоказанности локальной температуры колыбели:
        // генератор не создаёт known-значений локальной среды.
        expect(
          world.warnings.some(w => w.ruleId === 'cradle_temperature_unproven')
        ).toBe(true);
        // Следствие: physically_plausible недостижим — любое
        // предупреждение даёт hypothetical (или impossible_in_model
        // при доказанных ошибках).
        expect(world.scientificStatus).not.toBe('physically_plausible');
      }

      // Измеренная доля: все миры БЕЗ доказанных ошибок — hypothetical
      // именно с этим предупреждением в причине.
      const withoutProvenErrors = worlds.filter(
        w => !w.warnings.some(warn => warn.severity === 'error')
      );
      const hypothetical = withoutProvenErrors.filter(
        w => w.scientificStatus === 'hypothetical'
      );
      expect(withoutProvenErrors.length).toBeGreaterThan(0);
      expect(hypothetical.length).toBe(withoutProvenErrors.length);
    });
  });

  // Stage 4.2.2.3 (§4.13–14 ТЗ): доказанные нарушения в РЕАЛЬНОМ
  // пути выбора колыбели (isCradleSupportedOnWorld → checkCompatibility →
  // фильтр severity 'error'), а не только в изолированном
  // вызове checkCompatibility. Контекст фильтрации расширен
  // опциональными coreWorldState/cradleLocalEnvironment: в реальном
  // генерационном контуре ядро строится ПОСЛЕ выбора колыбели, поэтому
  // на этапе выбора доказательств нет и поведение генерации не меняется.
  describe('Stage 4.2.2.3: доказанные нарушения в реальном пути выбора колыбели', () => {
    const cradle = cradles.find(c => c.id === 'liquid_methane_ethane')!;
    const centralObject = centralObjects.find(o => o.id === 'yellow_dwarf')!;
    const celestialBody = celestialBodies.find(b => b.id === 'earth_like')!;
    const atmosphere: AtmosphereState = {
      components: [
        { gasId: 'ch4', percentage: 60, isTrace: false, uncertainty: '', warnings: [] },
        { gasId: 'c2h6', percentage: 15, isTrace: false, uncertainty: '', warnings: [] },
        { gasId: 'n2', percentage: 25, isTrace: false, uncertainty: '', warnings: [] }
      ],
      totalPressure: 1.5,
      temperature: 95,
      notes: 'фикстура: метаново-этановая атмосфера'
    };
    const bodyCharacteristics = {
      surfaceTemperature: 150,
      atmosphericPressure: 1.5,
      geologicalActivity: 'Высокая геологическая активность'
    } as PhysicalCharacteristics;

    /** Ядро с планетой и океаническим резервуаром с заданной температурой. */
    const coreWithReservoirTemperature = (temperature: ScientificValue) => {
      const core = createCoreWorldState('w-select-cradle');
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
      core.reservoirs.push({
        id: 'ocean_reservoir',
        kind: 'ocean',
        bodyId: 'planet',
        properties: {},
        reservoirTemperature: temperature
      });
      return core;
    };

    /** Локальная среда колыбели, явно связанная с резервуаром ядра. */
    const environment = (): CradleLocalEnvironment => ({
      ...determineCradleLocalEnvironment({ cradle }),
      localReservoirId: 'ocean_reservoir'
    });

    it('доказанное known-нарушение исключает колыбель из автоматического выбора', () => {
      // Резервуар океана: известные (known) 288 K с содержательным
      // provenance вне диапазона 90–200 K → ошибка правила 6 →
      // isCradleSupportedOnWorld = false
      const rejected = isCradleSupportedOnWorld(cradle, {
        mode: 'realistic',
        centralObject,
        celestialBody,
        atmosphere,
        bodyCharacteristics,
        coreWorldState: coreWithReservoirTemperature(
          knownValue(quantity(288, 'K'), {
            provenance: { sourceName: 'зонд фикстуры: температура океана' }
          })
        ),
        cradleLocalEnvironment: environment()
      });
      expect(rejected).toBe(false);

      // Контроль: те же параметры, но доказанные 150 K в диапазоне —
      // колыбель поддержана. False в первом случае именно из-за
      // доказанного температурного нарушения.
      const supported = isCradleSupportedOnWorld(cradle, {
        mode: 'realistic',
        centralObject,
        celestialBody,
        atmosphere,
        bodyCharacteristics,
        coreWorldState: coreWithReservoirTemperature(
          knownValue(quantity(150, 'K'), {
            provenance: { sourceName: 'зонд фикстуры: температура океана' }
          })
        ),
        cradleLocalEnvironment: environment()
      });
      expect(supported).toBe(true);
    });

    it('known БЕЗ provenance не исключает колыбель: недоказанность не становится ошибкой', () => {
      const supported = isCradleSupportedOnWorld(cradle, {
        mode: 'realistic',
        centralObject,
        celestialBody,
        atmosphere,
        bodyCharacteristics,
        coreWorldState: coreWithReservoirTemperature(
          knownValue(quantity(288, 'K')) // без provenance — не доказательство
        ),
        cradleLocalEnvironment: environment()
      });
      expect(supported).toBe(true);
    });

    it('estimated-расхождение и unknown не превращаются в hard error', () => {
      // Оценка резервуара 288 K вне диапазона — предупреждение,
      // колыбель остаётся кандидатом
      const estimatedSupported = isCradleSupportedOnWorld(cradle, {
        mode: 'realistic',
        centralObject,
        celestialBody,
        atmosphere,
        bodyCharacteristics,
        coreWorldState: coreWithReservoirTemperature(
          estimatedValue(quantity(288, 'K'), 'модельная оценка фикстуры', {
            provenance: { sourceName: 'оценка фикстуры' }
          })
        ),
        cradleLocalEnvironment: environment()
      });
      expect(estimatedSupported).toBe(true);

      // Без coreWorldState (реальный генерационный контур: ядро ещё
      // не построено) локальная температура неизвестна — недоказанность,
      // не ошибка
      const unknownSupported = isCradleSupportedOnWorld(cradle, {
        mode: 'realistic',
        centralObject,
        celestialBody,
        atmosphere,
        bodyCharacteristics
      });
      expect(unknownSupported).toBe(true);
    });

    it('реальная генерация: без ядра нет доказанных температурных ошибок, есть недоказанность', () => {
      // Генератор не создаёт coreWorldState на этапе выбора колыбели:
      // ни оценки, ни легаси-числа не могут превратиться в ошибку.
      const world = generateWorld(baseSettings({
        seed: 'cradle_real_path_unproven',
        fixedCategories: {
          cosmology: 'big_bang',
          centralObject: 'yellow_dwarf',
          celestialBody: 'earth_like',
          cradle: 'liquid_methane_ethane'
        },
        customAtmosphere: atmosphere
      }));

      expect(world.cradle.id).toBe('liquid_methane_ethane');
      // Доказанной ошибки нет
      expect(
        world.warnings.some(w => w.ruleId === 'cradle_temperature_compatibility')
      ).toBe(false);
      // Молчаливого подтверждения тоже нет: локальная температура
      // колыбели недоказана (ядро строится после выбора)
      expect(
        world.warnings.some(w => w.ruleId === 'cradle_temperature_unproven')
      ).toBe(true);
    });
  });

  // Stage 4.2.2.4 (§3 ТЗ): интеграционные тесты САМОГО selectCradle —
  // полного автоматического selector'а (фильтр isCradleSupportedOnWorld
  // → chooseWeighted), а не только boolean predicate. Детерминизм:
  // фиксированный seed + явные веса (нулевые веса полностью исключают
  // кандидатов из chooseWeighted). Typed evidence передаётся selector'у
  // только явно; в реальном контуре generateWorld его не передаёт
  // (научное ядро строится ПОСЛЕ выбора колыбели). Stage 4.2.2.5:
  // локальная среда передаётся per-candidate — карта
  // cradleLocalEnvironmentsById по ID кандидата; для кандидата без
  // явной среды selector вычисляет её сам
  // (determineCradleLocalEnvironment), как в реальном контуре.
  describe('Stage 4.2.2.4: интеграция selectCradle с typed evidence', () => {
    const cradle = cradles.find(c => c.id === 'liquid_methane_ethane')!;
    const centralObject = centralObjects.find(o => o.id === 'yellow_dwarf')!;
    const celestialBody = celestialBodies.find(b => b.id === 'earth_like')!;
    const atmosphere: AtmosphereState = {
      components: [
        { gasId: 'ch4', percentage: 60, isTrace: false, uncertainty: '', warnings: [] },
        { gasId: 'c2h6', percentage: 15, isTrace: false, uncertainty: '', warnings: [] },
        { gasId: 'n2', percentage: 25, isTrace: false, uncertainty: '', warnings: [] }
      ],
      totalPressure: 1.5,
      temperature: 95,
      notes: 'фикстура: метаново-этановая атмосфера'
    };
    const bodyCharacteristics = {
      surfaceTemperature: 150,
      atmosphericPressure: 1.5,
      geologicalActivity: 'Высокая геологическая активность'
    } as PhysicalCharacteristics;

    /** Ядро с планетой и океанским резервуаром с заданной температурой. */
    const coreWithReservoirTemperature = (temperature: ScientificValue) => {
      const core = createCoreWorldState('w-select-cradle-4224');
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
      core.reservoirs.push({
        id: 'ocean_reservoir',
        kind: 'ocean',
        bodyId: 'planet',
        properties: {},
        reservoirTemperature: temperature
      });
      return core;
    };

    /** Локальная среда колыбели, явно связанная с резервуаром ядра. */
    const environment = (): CradleLocalEnvironment => ({
      ...determineCradleLocalEnvironment({ cradle }),
      localReservoirId: 'ocean_reservoir'
    });

    const baseContext = {
      mode: 'realistic' as const,
      centralObject,
      celestialBody,
      atmosphere,
      bodyCharacteristics
    };

    // Веса: только liquid_methane_ethane имеет положительный вес —
    // детерминированный выбор кандидата среди поддержанных.
    const forcedCradleSettings = baseSettings({
      seed: 's4224_select_cradle',
      weights: {
        cosmology: {},
        epoch: {},
        centralObject: {},
        celestialBody: {},
        cradle: {
          supercritical_water: 0,
          liquid_ammonia: 0,
          liquid_methane_ethane: 1,
          supercritical_co2: 0,
          h2o_co2_supercritical_mix: 0,
          hydrogen_helium_aerosols: 0,
          molten_salts: 0
        }
      }
    });

    it('кандидат с known в допустимом диапазоне остаётся доступным для выбора', () => {
      const { cradle: chosen, cradleWarnings } = selectCradle(
        createRandom('s4224_select_cradle'),
        forcedCradleSettings,
        {
          ...baseContext,
          coreWorldState: coreWithReservoirTemperature(
            knownValue(quantity(150, 'K'), {
              provenance: { sourceName: 'зонд фикстуры: температура океана' }
            })
          ),
          cradleLocalEnvironmentsById: { liquid_methane_ethane: environment() }
        }
      );
      expect(chosen.id).toBe('liquid_methane_ethane');
      expect(cradleWarnings.some(w => w.id === 'warn_cradle_support_fallback')).toBe(false);
    });

    it('доказанное known-нарушение исключает кандидата: выбирается допустимая альтернатива', () => {
      // Веса не заданы (все поддержанные кандидаты равновесны):
      // нарушивший кандидат не выбирается, fallback на общий список
      // не происходит — выбор идёт среди поддержанных альтернатив
      const settings = baseSettings({ seed: 's4224_select_cradle_alt' });
      const { cradle: chosen, cradleWarnings } = selectCradle(
        createRandom('s4224_select_cradle_alt'),
        settings,
        {
          ...baseContext,
          coreWorldState: coreWithReservoirTemperature(
            knownValue(quantity(288, 'K'), {
              provenance: { sourceName: 'зонд фикстуры: температура океана' }
            })
          ),
          cradleLocalEnvironmentsById: { liquid_methane_ethane: environment() }
        }
      );
      expect(chosen.id).not.toBe('liquid_methane_ethane');
      expect(cradleWarnings.some(w => w.id === 'warn_cradle_support_fallback')).toBe(false);
    });

    it('estimated вне диапазона остаётся допустимым условным кандидатом', () => {
      const { cradle: chosen } = selectCradle(
        createRandom('s4224_select_cradle'),
        forcedCradleSettings,
        {
          ...baseContext,
          coreWorldState: coreWithReservoirTemperature(
            estimatedValue(quantity(288, 'K'), 'модельная оценка фикстуры', {
              provenance: { sourceName: 'оценка фикстуры' }
            })
          ),
          cradleLocalEnvironmentsById: { liquid_methane_ethane: environment() }
        }
      );
      expect(chosen.id).toBe('liquid_methane_ethane');
    });

    it('unknown-температура не превращается в hard error: кандидат остаётся', () => {
      const { cradle: chosen } = selectCradle(
        createRandom('s4224_select_cradle'),
        forcedCradleSettings,
        {
          ...baseContext,
          coreWorldState: coreWithReservoirTemperature(
            unknownValue('температура океана не измерялась')
          ),
          cradleLocalEnvironmentsById: { liquid_methane_ethane: environment() }
        }
      );
      expect(chosen.id).toBe('liquid_methane_ethane');
    });

    it('без typed evidence selector не выдумывает доказательств и не исключает кандидата', () => {
      // Реальный генерационный контур: ни ядра, ни среды не передано —
      // температура не доказана, но и не опровергнута
      const { cradle: chosen, cradleWarnings } = selectCradle(
        createRandom('s4224_select_cradle'),
        forcedCradleSettings,
        baseContext
      );
      expect(chosen.id).toBe('liquid_methane_ethane');
      expect(cradleWarnings.some(w => w.id === 'warn_cradle_support_fallback')).toBe(false);
    });

    it('ручная фиксация колыбели: выбор не фильтруется даже при доказанном нарушении', () => {
      const settings = baseSettings({
        seed: 's4224_select_cradle_fixed',
        fixedCategories: { cradle: 'liquid_methane_ethane' }
      });
      const { cradle: chosen, cradleWarnings } = selectCradle(
        createRandom('s4224_select_cradle_fixed'),
        settings,
        {
          ...baseContext,
          coreWorldState: coreWithReservoirTemperature(
            knownValue(quantity(288, 'K'), {
              provenance: { sourceName: 'зонд фикстуры: температура океана' }
            })
          ),
          cradleLocalEnvironmentsById: { liquid_methane_ethane: environment() }
        }
      );
      // Прежняя семантика: ручной выбор остаётся, несовместимость
      // отражается предупреждениями итоговой проверки мира
      expect(chosen.id).toBe('liquid_methane_ethane');
      expect(cradleWarnings).toHaveLength(0);
    });

    it('ручная фиксация в реальной генерации: колыбель остаётся, несовместимость — предупреждением', () => {
      const world = generateWorld(baseSettings({
        seed: 's4224_fixed_cradle_pipeline',
        fixedCategories: {
          cosmology: 'big_bang',
          centralObject: 'yellow_dwarf',
          celestialBody: 'earth_like',
          cradle: 'liquid_methane_ethane'
        },
        customAtmosphere: {
          components: [
            { gasId: 'n2', percentage: 100, isTrace: false, uncertainty: '', warnings: [] }
          ],
          totalPressure: 1.5,
          temperature: 95,
          notes: 'фикстура: азотная атмосфера без метана — колыбели не хватает носителя'
        }
      }));
      // Ручная колыбель остаётся выбранной...
      expect(world.cradle.id).toBe('liquid_methane_ethane');
      // ...а несовместимость (состав без ch4/c2h6) отражается
      // предупреждением совместимости, а не сменой колыбели
      expect(world.warnings.some(w =>
        w.ruleId === 'cradle_atmosphere_composition' && w.severity === 'error'
      )).toBe(true);
    });
  });


  // Stage 4.2.2.5 (§2–3 ТЗ): локальная среда принадлежит каждому
  // кандидату ОТДЕЛЬНО. selectCradle проверяет каждого кандидата
  // по собственной среде: явная среда из cradleLocalEnvironmentsById
  // по ID кандидата, иначе per-candidate вычисление
  // determineCradleLocalEnvironment (тот же путь, что и в реальном
  // контуре). Чужой locationType / localReservoirId / состав к
  // кандидату НЕ применяются; перенос evidence между кандидатами
  // исключён. Детерминизм: фиксированный seed + нулевые веса
  // (исключают кандидата из chooseWeighted; если бы нулевые веса
  // перестали исключать или кандидат ошибочно получал чужую среду,
  // единственный положительный вес перестал бы детерминировать
  // выбор и тесты ниже падали бы).
  describe('Stage 4.2.2.5: candidate-specific локальные среды selector'а', () => {
    const centralObject = centralObjects.find(o => o.id === 'yellow_dwarf')!;
    const celestialBody = celestialBodies.find(b => b.id === 'earth_like')!;

    // Атмосфера, поддерживающая ОБЕ атмосферозависимые колыбели:
    // аэрозоли (h2+he ≥ 50) и углеводородный океан (ch4+c2h6 ≥ 5).
    const mixedAtmosphere: AtmosphereState = {
      components: [
        { gasId: 'h2', percentage: 45, isTrace: false, uncertainty: '', warnings: [] },
        { gasId: 'he', percentage: 10, isTrace: false, uncertainty: '', warnings: [] },
        { gasId: 'ch4', percentage: 40, isTrace: false, uncertainty: '', warnings: [] },
        { gasId: 'n2', percentage: 5, isTrace: false, uncertainty: '', warnings: [] }
      ],
      totalPressure: 1.5,
      temperature: 95,
      notes: 'фикстура Stage 4.2.2.5: водородно-гелиевая + метановая атмосфера'
    };

    const bodyCharacteristics = {
      surfaceTemperature: 150,
      atmosphericPressure: 1.5,
      geologicalActivity: 'Высокая геологическая активность'
    } as PhysicalCharacteristics;

    /** Ядро с раздельными резервуарами трёх локаций (ocean/crust/mantle). */
    const coreWithReservoirs = (temps: {
      ocean?: ScientificValue;
      crust?: ScientificValue;
      mantle?: ScientificValue;
    }) => {
      const core = createCoreWorldState('w-select-cradle-4225');
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
      if (temps.ocean !== undefined) {
        core.reservoirs.push({
          id: 'res_ocean', kind: 'ocean', bodyId: 'planet', properties: {},
          reservoirTemperature: temps.ocean
        });
      }
      if (temps.crust !== undefined) {
        core.reservoirs.push({
          id: 'res_crust', kind: 'crust', bodyId: 'planet', properties: {},
          reservoirTemperature: temps.crust
        });
      }
      if (temps.mantle !== undefined) {
        core.reservoirs.push({
          id: 'res_mantle', kind: 'mantle', bodyId: 'planet', properties: {},
          reservoirTemperature: temps.mantle
        });
      }
      return core;
    };

    const knownK = (valueK: number, source: string) =>
      knownValue(quantity(valueK, 'K'), { provenance: { sourceName: source } });

    /** Собственная среда кандидата, явно связанная с его резервуаром. */
    const ownEnvironment = (
      cradleId: string,
      reservoirId?: string,
      atmosphereOverride?: AtmosphereState
    ): CradleLocalEnvironment => {
      const cradle = cradles.find(c => c.id === cradleId)!;
      const env = determineCradleLocalEnvironment({
        cradle,
        celestialBody,
        atmosphere: atmosphereOverride ?? mixedAtmosphere
      });
      return reservoirId !== undefined ? { ...env, localReservoirId: reservoirId } : env;
    };

    const baseContext = {
      mode: 'realistic' as const,
      centralObject,
      celestialBody,
      atmosphere: mixedAtmosphere,
      bodyCharacteristics
    };

    /** Веса: положительные ТОЛЬКО у перечисленных кандидатов. */
    const settingsWithWeights = (ids: string[], seed: string) => {
      const cradleWeights: Record<string, number> = {};
      for (const c of cradles) cradleWeights[c.id] = ids.includes(c.id) ? 1 : 0;
      return baseSettings({
        seed,
        weights: {
          cosmology: {},
          epoch: {},
          centralObject: {},
          celestialBody: {},
          cradle: cradleWeights
        }
      });
    };

    it('подземный кандидат проверяется по собственной среде: pressure location не получает чужой ocean', () => {
      // Если бы supercritical_water ошибочно получил океанскую среду
      // liquid_methane_ethane, правило cradle_pressure_compatibility
      // исключило бы его: 1.5 atm ∉ 22.1–500 atm. Собственная
      // subsurface-среда поверхностное давление не проверяет —
      // кандидат поддержан и выбирается единственным
      // положительным весом.
      const { cradle: chosen, cradleWarnings } = selectCradle(
        createRandom('s4225_own_subsurface'),
        settingsWithWeights(['supercritical_water'], 's4225_own_subsurface'),
        {
          ...baseContext,
          coreWorldState: coreWithReservoirs({
            crust: knownK(700, 'скважина фикстуры: коровый резервуар')
          }),
          cradleLocalEnvironmentsById: {
            liquid_methane_ethane: ownEnvironment('liquid_methane_ethane', 'res_ocean'),
            supercritical_water: ownEnvironment('supercritical_water', 'res_crust'),
            molten_salts: ownEnvironment('molten_salts', 'res_mantle'),
            hydrogen_helium_aerosols: ownEnvironment('hydrogen_helium_aerosols')
          }
        }
      );
      expect(chosen.id).toBe('supercritical_water');
      expect(cradleWarnings.some(w => w.id === 'warn_cradle_support_fallback')).toBe(false);
    });

    it('deep-кандидат проверяется по собственной глубинной среде и своему резервуару', () => {
      // molten_salts: собственная deep-среда + резервуар мантии
      // 1500 K внутри 1000–2000 — доказательная семантика typed
      // known сохраняется для КОНКРЕТНОГО кандидата.
      const { cradle: chosen } = selectCradle(
        createRandom('s4225_own_deep'),
        settingsWithWeights(['molten_salts'], 's4225_own_deep'),
        {
          ...baseContext,
          coreWorldState: coreWithReservoirs({
            mantle: knownK(1500, 'скважина фикстуры: мантийный резервуар')
          }),
          cradleLocalEnvironmentsById: {
            liquid_methane_ethane: ownEnvironment('liquid_methane_ethane', 'res_ocean'),
            supercritical_water: ownEnvironment('supercritical_water', 'res_crust'),
            molten_salts: ownEnvironment('molten_salts', 'res_mantle'),
            hydrogen_helium_aerosols: ownEnvironment('hydrogen_helium_aerosols')
          }
        }
      );
      expect(chosen.id).toBe('molten_salts');
    });

    it('атмосферный кандидат проверяется по собственной атмосферной среде', () => {
      // В mixed-атмосфере аэрозоли поддержаны по СВОЕЙ среде
      // (h2+he = 55 ≥ 50); резервуарное температурное правило к
      // атмосферной локации не применяется.
      const { cradle: chosen } = selectCradle(
        createRandom('s4225_own_atmosphere'),
        settingsWithWeights(['hydrogen_helium_aerosols'], 's4225_own_atmosphere'),
        {
          ...baseContext,
          coreWorldState: coreWithReservoirs({
            crust: knownK(700, 'скважина фикстуры: коровый резервуар'),
            mantle: knownK(1500, 'скважина фикстуры: мантийный резервуар')
          }),
          cradleLocalEnvironmentsById: {
            liquid_methane_ethane: ownEnvironment('liquid_methane_ethane', 'res_ocean'),
            supercritical_water: ownEnvironment('supercritical_water', 'res_crust'),
            molten_salts: ownEnvironment('molten_salts', 'res_mantle'),
            hydrogen_helium_aerosols: ownEnvironment('hydrogen_helium_aerosols')
          }
        }
      );
      expect(chosen.id).toBe('hydrogen_helium_aerosols');
    });

    it('атмосферная колыбель без H₂/He исключается по СВОЕЙ среде, океанская остаётся', () => {
      // Атмосфера без h2/he (но с ch4/c2h6): аэрозоли обязаны
      // исключаться по СОБСТВЕННОЙ атмосферной среде (rule 9:
      // h2+he = 0 < 50). Под чужой (океанской) средой аэрозоли
      // прошли бы без проверки носителей — regression-защита
      // candidate-specific контракта.
      const noH2HeAtmosphere: AtmosphereState = {
        components: [
          { gasId: 'ch4', percentage: 60, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'c2h6', percentage: 15, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'n2', percentage: 25, isTrace: false, uncertainty: '', warnings: [] }
        ],
        totalPressure: 1.5,
        temperature: 95,
        notes: 'фикстура Stage 4.2.2.5: атмосфера без водорода и гелия'
      };
      const { cradle: chosen } = selectCradle(
        createRandom('s4225_no_h2he'),
        settingsWithWeights(['hydrogen_helium_aerosols', 'liquid_methane_ethane'], 's4225_no_h2he'),
        {
          mode: 'realistic' as const,
          centralObject,
          celestialBody,
          atmosphere: noH2HeAtmosphere,
          bodyCharacteristics,
          coreWorldState: coreWithReservoirs({
            ocean: knownK(150, 'зонд фикстуры: температура океана')
          }),
          cradleLocalEnvironmentsById: {
            liquid_methane_ethane: ownEnvironment('liquid_methane_ethane', 'res_ocean', noH2HeAtmosphere)
          }
        }
      );
      expect(chosen.id).toBe('liquid_methane_ethane');
    });

    it('океанская колыбель без ch4/c2h6 исключается по СВОЕЙ среде, атмосферная остаётся', () => {
      // Зеркальный случай: атмосфера h2/he без метана. LME обязана
      // исключаться по СОБСТВЕННОЙ океанской среде (rule 9:
      // ch4+c2h6 = 0 < 5). Под атмосферной средой аэрозолей
      // проверка носителей океана была бы пропущена.
      const h2OnlyAtmosphere: AtmosphereState = {
        components: [
          { gasId: 'h2', percentage: 85, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'he', percentage: 10, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'n2', percentage: 5, isTrace: false, uncertainty: '', warnings: [] }
        ],
        totalPressure: 1.5,
        temperature: 95,
        notes: 'фикстура Stage 4.2.2.5: водородно-гелиевая атмосфера без метана'
      };
      const { cradle: chosen } = selectCradle(
        createRandom('s4225_h2only'),
        settingsWithWeights(['liquid_methane_ethane', 'hydrogen_helium_aerosols'], 's4225_h2only'),
        {
          mode: 'realistic' as const,
          centralObject,
          celestialBody,
          atmosphere: h2OnlyAtmosphere,
          bodyCharacteristics,
          cradleLocalEnvironmentsById: {
            liquid_methane_ethane: ownEnvironment('liquid_methane_ethane', undefined, h2OnlyAtmosphere),
            hydrogen_helium_aerosols: ownEnvironment('hydrogen_helium_aerosols', undefined, h2OnlyAtmosphere)
          }
        }
      );
      expect(chosen.id).toBe('hydrogen_helium_aerosols');
    });

    it('доказанное known-нарушение океанского кандидата исключает только его; альтернатива — по своему контексту', () => {
      // ocean known 288 K вне 90–200: ошибка ТОЛЬКО для
      // liquid_methane_ethane. supercritical_water проверяется по
      // собственному коровому резервуару (700 K внутри 647–1000)
      // и выбирается.
      const { cradle: chosen, cradleWarnings } = selectCradle(
        createRandom('s4225_b1'),
        settingsWithWeights(['liquid_methane_ethane', 'supercritical_water'], 's4225_b1'),
        {
          ...baseContext,
          coreWorldState: coreWithReservoirs({
            ocean: knownK(288, 'зонд фикстуры: температура океана'),
            crust: knownK(700, 'скважина фикстуры: коровый резервуар'),
            mantle: knownK(1500, 'скважина фикстуры: мантийный резервуар')
          }),
          cradleLocalEnvironmentsById: {
            liquid_methane_ethane: ownEnvironment('liquid_methane_ethane', 'res_ocean'),
            supercritical_water: ownEnvironment('supercritical_water', 'res_crust')
          }
        }
      );
      expect(chosen.id).toBe('supercritical_water');
      expect(cradleWarnings.some(w => w.id === 'warn_cradle_support_fallback')).toBe(false);
    });

    it('доказанное known-нарушение deep-кандидата исключает только его', () => {
      // mantle known 700 K вне 1000–2000: ошибка ТОЛЬКО для
      // molten_salts; supercritical_water (crust 700 K внутри
      // 647–1000) остаётся и выбирается.
      const { cradle: chosen } = selectCradle(
        createRandom('s4225_b2'),
        settingsWithWeights(['molten_salts', 'supercritical_water'], 's4225_b2'),
        {
          ...baseContext,
          coreWorldState: coreWithReservoirs({
            mantle: knownK(700, 'скважина фикстуры: мантийный резервуар'),
            crust: knownK(700, 'скважина фикстуры: коровый резервуар')
          }),
          cradleLocalEnvironmentsById: {
            molten_salts: ownEnvironment('molten_salts', 'res_mantle'),
            supercritical_water: ownEnvironment('supercritical_water', 'res_crust')
          }
        }
      );
      expect(chosen.id).toBe('supercritical_water');
    });

    it('estimated вне диапазона остаётся условным кандидатом; known вне диапазона — ошибкой', () => {
      // crust estimated 288 K вне 647–1000: предупреждение, НЕ
      // ошибка — supercritical_water остаётся. mantle known 288 K
      // вне 1000–2000: доказанная ошибка — molten_salts исключён.
      const { cradle: chosen } = selectCradle(
        createRandom('s4225_b3'),
        settingsWithWeights(['supercritical_water', 'molten_salts'], 's4225_b3'),
        {
          ...baseContext,
          coreWorldState: coreWithReservoirs({
            crust: estimatedValue(quantity(288, 'K'), 'модельная оценка фикстуры', {
              provenance: { sourceName: 'оценка фикстуры' }
            }),
            mantle: knownK(288, 'скважина фикстуры: мантийный резервуар')
          }),
          cradleLocalEnvironmentsById: {
            supercritical_water: ownEnvironment('supercritical_water', 'res_crust'),
            molten_salts: ownEnvironment('molten_salts', 'res_mantle')
          }
        }
      );
      expect(chosen.id).toBe('supercritical_water');
    });

    it('unknown-температура собственного резервуара не превращается в hard error', () => {
      // ocean known 288 вне 90–200 исключает LME; crust unknown —
      // недоказанность, не ошибка: supercritical_water остаётся.
      const { cradle: chosen } = selectCradle(
        createRandom('s4225_b4'),
        settingsWithWeights(['liquid_methane_ethane', 'supercritical_water'], 's4225_b4'),
        {
          ...baseContext,
          coreWorldState: coreWithReservoirs({
            ocean: knownK(288, 'зонд фикстуры: температура океана'),
            crust: unknownValue('температура корового резервуара не измерялась')
          }),
          cradleLocalEnvironmentsById: {
            liquid_methane_ethane: ownEnvironment('liquid_methane_ethane', 'res_ocean'),
            supercritical_water: ownEnvironment('supercritical_water', 'res_crust')
          }
        }
      );
      expect(chosen.id).toBe('supercritical_water');
    });

    it('без явного reservoir ID температура не подставляется (нет переноса между кандидатами)', () => {
      // Карта содержит ТОЛЬКО среду supercritical_water с
      // localReservoirId res_crust. LME получает вычисленную
      // ocean-среду БЕЗ reservoir ID: ядро содержит res_ocean с
      // known 288 K (вне 90–200), но selector не подставляет его
      // автоматически и не переносит res_crust с другого
      // кандидата — недоказанность, кандидат остаётся условным.
      // Подмена ID дала бы доказанную ошибку → исключение LME →
      // пустой выбор → падение теста.
      const { cradle: chosen, cradleWarnings } = selectCradle(
        createRandom('s4225_no_reservoir_id'),
        settingsWithWeights(['liquid_methane_ethane'], 's4225_no_reservoir_id'),
        {
          ...baseContext,
          coreWorldState: coreWithReservoirs({
            ocean: knownK(288, 'зонд фикстуры: температура океана'),
            crust: knownK(700, 'скважина фикстуры: коровый резервуар')
          }),
          cradleLocalEnvironmentsById: {
            supercritical_water: ownEnvironment('supercritical_water', 'res_crust')
          }
        }
      );
      expect(chosen.id).toBe('liquid_methane_ethane');
      expect(cradleWarnings.some(w => w.id === 'warn_cradle_support_fallback')).toBe(false);
    });

    it("matter state читает расположение именно текущего кандидата (warning, не фильтр selector'а)", () => {
      // Правило cradle_matter_state_location — предупреждение: оно
      // не исключает кандидата из selector'а, но обязано читать
      // расположение ЕГО локальной среды. Selector передаёт
      // каждому кандидату собственную среду (тесты выше); здесь
      // зафиксирована сама зависимость правила от расположения.
      const aerosolsCradle = cradles.find(c => c.id === 'hydrogen_helium_aerosols')!;
      const matterStateWorld = (env: CradleLocalEnvironment) => checkCompatibility({
        mode: 'realistic',
        centralObject,
        celestialBody,
        atmosphere: mixedAtmosphere,
        cradle: aerosolsCradle,
        cradleLocalEnvironment: env,
        physicalCharacteristics: bodyCharacteristics
      }, 'realistic');
      const own = matterStateWorld(ownEnvironment('hydrogen_helium_aerosols'));
      expect(own.some(w => w.ruleId === 'cradle_matter_state_location')).toBe(false);
      const foreignSurface = matterStateWorld({
        ...ownEnvironment('hydrogen_helium_aerosols'),
        locationType: 'surface',
        locationDescription: 'фикстура: чужое расположение'
      });
      expect(foreignSurface.some(w => w.ruleId === 'cradle_matter_state_location')).toBe(true);
    });

    it('ни один кандидат не поддержан — прежний fallback с диагностикой, детерминизм сохранён', () => {
      // Стерильная атмосфера (n2) + низкая геология: аэрозоли без
      // h2/he, углеводородный океан без ch4/c2h6, аммиачный без
      // nh3, высокотемпературные глубинные среды — без глубинного
      // тепла. Поддержанных нет: прежний fallback на общий список
      // с предупреждением warn_cradle_support_fallback.
      const sterileAtmosphere: AtmosphereState = {
        components: [
          { gasId: 'n2', percentage: 100, isTrace: false, uncertainty: '', warnings: [] }
        ],
        totalPressure: 1.5,
        temperature: 95,
        notes: 'фикстура Stage 4.2.2.5: стерильная азотная атмосфера'
      };
      const sterileBody = {
        surfaceTemperature: 150,
        atmosphericPressure: 1.5,
        geologicalActivity: 'Низкая геологическая активность'
      } as PhysicalCharacteristics;
      const settings = baseSettings({ seed: 's4225_fallback' });
      const context = {
        mode: 'realistic' as const,
        centralObject,
        celestialBody,
        atmosphere: sterileAtmosphere,
        bodyCharacteristics: sterileBody
      };
      const first = selectCradle(createRandom('s4225_fallback'), settings, context);
      const second = selectCradle(createRandom('s4225_fallback'), settings, context);
      expect(first.cradle.id).toBe(second.cradle.id); // детерминизм
      expect(first.cradleWarnings.some(w => w.id === 'warn_cradle_support_fallback')).toBe(true);
    });
  });
});

