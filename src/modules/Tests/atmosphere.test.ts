// ============================================
// TESTS - Atmosphere module tests
// ============================================

import { describe, it, expect } from 'vitest';
import { createAtmosphere, normalizeAtmosphere } from '../Atmosphere';
import { createRandom } from '../Generator/random';
import type { AtmosphereState } from '../../types';

describe('Atmosphere Module', () => {
  describe('createAtmosphere', () => {
    it('should create methane-ethane atmosphere preset', () => {
      const rng = createRandom('test_seed');
      const atmosphere = createAtmosphere('methane_ethane', rng);

      expect(atmosphere).toBeDefined();
      expect(atmosphere.components).toBeInstanceOf(Array);
      expect(atmosphere.components.length).toBeGreaterThan(0);
      expect(atmosphere.totalPressure).toBeDefined();
      expect(atmosphere.temperature).toBeDefined();
    });

    it('should have components that sum to approximately 100% (allowing for minor variations)', () => {
      const rng = createRandom('test_seed');
      const atmosphere = createAtmosphere('methane_ethane', rng);

      const totalPercentage = atmosphere.components.reduce(
        (sum, component) => sum + component.percentage,
        0
      );

      expect(totalPercentage).toBeGreaterThanOrEqual(95);
      expect(totalPercentage).toBeLessThanOrEqual(105);
    });

    it('should include methane as primary component', () => {
      const rng = createRandom('test_seed');
      const atmosphere = createAtmosphere('methane_ethane', rng);

      const methaneComponent = atmosphere.components.find(c => c.gasId === 'ch4');
      expect(methaneComponent).toBeDefined();
      expect(methaneComponent?.percentage).toBeGreaterThan(0);
    });

    it('should include ethane as primary component', () => {
      const rng = createRandom('test_seed');
      const atmosphere = createAtmosphere('methane_ethane', rng);

      const ethaneComponent = atmosphere.components.find(c => c.gasId === 'c2h6');
      expect(ethaneComponent).toBeDefined();
      expect(ethaneComponent?.percentage).toBeGreaterThan(0);
    });
  });

  describe('normalizeAtmosphere', () => {
    it('should normalize component percentages to sum to 100%', () => {
      const atmosphere: AtmosphereState = {
        components: [
          { gasId: 'ch4', percentage: 60, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'n2', percentage: 20, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'c2h6', percentage: 15, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'h2', percentage: 3, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'nh3', percentage: 0.5, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'co', percentage: 0.3, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'co2', percentage: 0.2, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'h2o', percentage: 0.1, isTrace: false, uncertainty: '', warnings: [] }
        ],
        totalPressure: 1.5,
        temperature: 100,
        notes: 'Test atmosphere'
      };

      const normalized = normalizeAtmosphere(atmosphere);

      const totalPercentage = normalized.components.reduce(
        (sum, component) => sum + component.percentage,
        0
      );

      expect(totalPercentage).toBeCloseTo(100, 0.01);
    });

    it('should handle empty components array', () => {
      const atmosphere: AtmosphereState = {
        components: [],
        totalPressure: 1.0,
        temperature: 200,
        notes: 'Empty atmosphere'
      };

      const normalized = normalizeAtmosphere(atmosphere);
      expect(normalized.components.length).toBeLessThanOrEqual(1);
    });

    it('should preserve all component properties', () => {
      const atmosphere: AtmosphereState = {
        components: [
          { gasId: 'ch4', percentage: 50, isTrace: false, minRange: 40, maxRange: 60, uncertainty: 'low', warnings: [] }
        ],
        totalPressure: 1.0,
        temperature: 100,
        notes: 'Test'
      };

      const normalized = normalizeAtmosphere(atmosphere);
      const component = normalized.components[0];

      expect(component.gasId).toBe('ch4');
      expect(component.isTrace).toBe(false);
      expect(component.minRange).toBe(40);
      expect(component.maxRange).toBe(60);
      expect(component.uncertainty).toBe('low');
      expect(component.warnings).toEqual([]);
    });
  });
});

describe('Atmosphere Composition Validation', () => {
  it('should create atmosphere with all required gases', () => {
    const rng = createRandom('test_seed');
    const atmosphere = createAtmosphere('methane_ethane', rng);

    const requiredGases = ['ch4', 'n2', 'c2h6', 'h2', 'nh3', 'co', 'co2', 'h2o'];
    const gasIds = atmosphere.components.map(c => c.gasId);

    requiredGases.forEach(gasId => {
      expect(gasIds).toContain(gasId);
    });
  });

  it('should have methane as dominant component', () => {
    const rng = createRandom('test_seed');
    const atmosphere = createAtmosphere('methane_ethane', rng);

    const methaneComponent = atmosphere.components.find(c => c.gasId === 'ch4');
    expect(methaneComponent?.percentage).toBeGreaterThan(50);
  });

  it('should have nitrogen as second most abundant component', () => {
    const rng = createRandom('test_seed');
    const atmosphere = createAtmosphere('methane_ethane', rng);

    const nitrogenComponent = atmosphere.components.find(c => c.gasId === 'n2');
    expect(nitrogenComponent?.percentage).toBeGreaterThan(10);
    expect(nitrogenComponent?.percentage).toBeLessThan(30);
  });

  it('should have trace components with low percentages', () => {
    const rng = createRandom('test_seed');
    const atmosphere = createAtmosphere('methane_ethane', rng);

    const traceComponents = atmosphere.components.filter(c => c.isTrace);
    traceComponents.forEach(component => {
      expect(component.percentage).toBeLessThan(1);
    });
  });
});
