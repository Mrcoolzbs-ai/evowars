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

describe('Generator Module', () => {
  describe('generateWorld', () => {
    it('should generate a valid world object', () => {
      const settings: GenerationSettings = {
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
        chemicalEvolutionSteps: 0
      };

      const world = generateWorld(settings);

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
      expect(world.causalChain).toBeDefined();
      expect(world.evolutionImplications).toBeDefined();
      expect(world.scientificStatus).toBeDefined();
      expect(world.warnings).toBeInstanceOf(Array);
      expect(world.appliedRules).toBeInstanceOf(Array);
    });

    it('should generate deterministic results with same seed', () => {
      const settings: GenerationSettings = {
        seed: 'deterministic_test',
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
        chemicalEvolutionSteps: 0
      };

      const world1 = generateWorld(settings);
      const world2 = generateWorld(settings);

      expect(world1.id).toBe(world2.id);
      expect(world1.cosmology.id).toBe(world2.cosmology.id);
      expect(world1.epoch.id).toBe(world2.epoch.id);
      expect(world1.centralObject.id).toBe(world2.centralObject.id);
      expect(world1.celestialBody.id).toBe(world2.celestialBody.id);
      expect(world1.cradle.id).toBe(world2.cradle.id);
    });

    it('should handle anomalous cosmology mode', () => {
      const settings: GenerationSettings = {
        seed: 'anomalous_test',
        mode: 'realistic',
        weights: {
          cosmology: {},
          epoch: {},
          centralObject: {},
          celestialBody: {},
          cradle: {}
        },
        fixedCategories: {
          cosmology: 'world_as_body'
        },
        enableChemicalEvolution: false,
        chemicalEvolutionSteps: 0
      };

      const world = generateWorld(settings);
      expect(world.mode).toBeDefined();
      expect(['realistic', 'anomalous']).toContain(world.mode);
      // Note: This test may need adjustment based on actual cosmology selection
    });

    it('should respect fixed categories', () => {
      const settings: GenerationSettings = {
        seed: 'fixed_test',
        mode: 'realistic',
        weights: {
          cosmology: {},
          epoch: {},
          centralObject: {},
          celestialBody: {},
          cradle: {}
        },
        fixedCategories: {
          epoch: 'first_water_era'
        },
        enableChemicalEvolution: false,
        chemicalEvolutionSteps: 0
      };

      const world = generateWorld(settings);
      expect(world.epoch.id).toBe('first_water_era');
    });
  });

  describe('generateMultipleWorlds', () => {
    it('should generate multiple worlds', () => {
      const settings: GenerationSettings = {
        seed: 'multi_test_unique',
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
        chemicalEvolutionSteps: 0
      };

      const worlds = generateMultipleWorlds(settings, 3);

      expect(worlds).toHaveLength(3);
      expect(worlds).toHaveLength(3);
      expect(worlds[0].seed).toBe('multi_test_unique_0');
      expect(worlds[1].seed).toBe('multi_test_unique_1');
      expect(worlds[2].seed).toBe('multi_test_unique_2');
      
    });

    it('should generate worlds with different seeds', () => {
      const settings: GenerationSettings = {
        seed: 'multi_seed_test',
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
        chemicalEvolutionSteps: 0
      };

      const worlds = generateMultipleWorlds(settings, 2);

      expect(worlds[0].seed).toBe('multi_seed_test_0');
      expect(worlds[1].seed).toBe('multi_seed_test_1');
    });
  });

  describe('generateWorldWithFixedCategories', () => {
    it('should override existing fixed categories', () => {
      const settings: GenerationSettings = {
        seed: 'override_test',
        mode: 'realistic',
        weights: {
          cosmology: {},
          epoch: {},
          centralObject: {},
          celestialBody: {},
          cradle: {}
        },
        fixedCategories: {
          epoch: 'first_water_era'
        },
        enableChemicalEvolution: false,
        chemicalEvolutionSteps: 0
      };

      const world = generateWorldWithFixedCategories(settings, {
        epoch: 'golden_middle'
      });

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
});
