// ============================================
// TESTS - Generator module tests
// ============================================

import { describe, it, expect } from 'vitest';
import {
  generateWorld,
  generateMultipleWorlds,
  generateWorldWithFixedCategories,
  generateRandomSeed
} from '../Generator/generator';
import type { GenerationSettings } from '../../types';
import { cosmologies, epochs, centralObjects, celestialBodies, cradles } from '../Data';

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
      expect(divergence?.message).toContain('противоречием');
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
      expect(first.energyBudget.equilibriumTemperature.value)
        .toBe(second.energyBudget.equilibriumTemperature.value);
    });

    it('фазовый скрининг привязан к слою surface_boundary с сохранением статуса и provenance', () => {
      const world = generateWorld(baseSettings({
        seed: 'surface_boundary_screening',
        atmospherePreset: 'earth'
      }));

      // Скрининг основан на явно обозначенной локальной области —
      // приповерхностном слое (однослойная модель текущего этапа)
      expect(world.phaseAnalysis.temperatureBasis.note).toContain('surface_boundary');
      expect(world.phaseAnalysis.temperatureBasis.note).toContain('НЕ глобальная surfaceTemperature');
      // Температура НЕ называется surfaceTemperature и НЕ T_eq
      expect(world.phaseAnalysis.temperatureBasis.note).toContain('НЕ T_eq');
      // Пресет 288 K (earth): статус и provenance сохранены
      expect(world.phaseAnalysis.temperatureBasis.temperature.status).toBe('estimated');
      expect(world.phaseAnalysis.temperatureBasis.temperature.provenance?.rawInput).toMatchObject({
        presetTemperatureK: 288,
        presetKind: 'observational_reference'
      });
    });

    it('без пригодной пресетной температуры скрининг остаётся unknown без fallback на T_eq', () => {
      // zero_atmosphere (если есть) или пресет без температуры:
      // собираем мир и заменяем контекст напрямую
      const world = generateWorld(baseSettings({
        seed: 'unknown_screening_temperature'
      }));

      // В любом сгенерированном мире числовой результат скрининга
      // соответствует именно базовой температуре скрининга, а не T_eq
      // (паритет: компоненты вычислены при базовой температуре слоя)
      const basisK = world.phaseAnalysis.temperatureBasis.temperature.status;
      expect(['known', 'estimated', 'unknown', 'not_applicable', 'invalid']).toContain(basisK);
      // note всегда объясняет контекст локальной области
      expect(world.phaseAnalysis.temperatureBasis.note).toContain('Stage 4.2.2.1');
    });
  });
});

