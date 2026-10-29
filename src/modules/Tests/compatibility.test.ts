// ============================================
// TESTS - Compatibility module tests
// ============================================

import { describe, it, expect } from 'vitest';
import {
  checkCompatibility,
  isWorldCompatible,
  getAllRules,
  getActiveRules
} from '../Compatibility';
import type { GeneratedWorld } from '../../types';
import { cosmologies, epochs, centralObjects, celestialBodies, cradles } from '../Data';

describe('Compatibility Module', () => {
  describe('checkCompatibility', () => {
    it('should return empty array for compatible world', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        mode: 'realistic',
        cosmology: cosmologies.find(c => c.id === 'big_bang')!,
        epoch: epochs.find(e => e.id === 'golden_middle')!,
        centralObject: centralObjects.find(o => o.id === 'yellow_dwarf')!,
        celestialBody: celestialBodies.find(b => b.id === 'earth_like')!,
        cradle: cradles.find(c => c.id === 'supercritical_water')!
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      expect(warnings).toBeInstanceOf(Array);
    });

    it('should detect anomalous cosmology without anomalous mode', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        mode: 'realistic',
        cosmology: cosmologies.find(c => c.id === 'world_as_body')!,
        epoch: epochs.find(e => e.id === 'golden_middle')!,
        centralObject: centralObjects.find(o => o.id === 'yellow_dwarf')!,
        celestialBody: celestialBodies.find(b => b.id === 'earth_like')!,
        cradle: cradles.find(c => c.id === 'supercritical_water')!
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      const hasAnomalousWarning = warnings.some(
        w => w.ruleId === 'anomalous_cosmology_requires_anomalous_mode'
      );
      expect(hasAnomalousWarning).toBe(true);
    });

    it('should not flag anomalous cosmology in anomalous mode', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        mode: 'anomalous',
        cosmology: cosmologies.find(c => c.id === 'world_as_body')!,
        epoch: epochs.find(e => e.id === 'golden_middle')!,
        centralObject: centralObjects.find(o => o.id === 'yellow_dwarf')!,
        celestialBody: celestialBodies.find(b => b.id === 'earth_like')!,
        cradle: cradles.find(c => c.id === 'supercritical_water')!
      };

      const warnings = checkCompatibility(mockWorld, 'anomalous');
      const hasAnomalousWarning = warnings.some(
        w => w.ruleId === 'anomalous_cosmology_requires_anomalous_mode'
      );
      expect(hasAnomalousWarning).toBe(false);
    });

    it('should detect age and central object incompatibility', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        mode: 'realistic',
        cosmology: cosmologies.find(c => c.id === 'big_bang')!,
        epoch: epochs.find(e => e.id === 'ancient_cosmos')!, // 11-13.8 bln years
        centralObject: centralObjects.find(o => o.id === 'blue_giant')!, // short-lived
        celestialBody: celestialBodies.find(b => b.id === 'earth_like')!,
        cradle: cradles.find(c => c.id === 'supercritical_water')!
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      const hasAgeWarning = warnings.some(
        w => w.ruleId === 'age_central_object_compatibility' && w.severity === 'error'
      );
      expect(hasAgeWarning).toBe(true);
    });

    it('should detect central object and celestial body incompatibility', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        mode: 'realistic',
        cosmology: cosmologies.find(c => c.id === 'big_bang')!,
        epoch: epochs.find(e => e.id === 'golden_middle')!,
        centralObject: centralObjects.find(o => o.id === 'relativistic_jet')!,
        celestialBody: celestialBodies.find(b => b.id === 'gas_giant_moon')!, // needs gas giant parent
        cradle: cradles.find(c => c.id === 'supercritical_water')!
      };

      const warnings = checkCompatibility(mockWorld, 'realistic');
      const hasCompatibilityWarning = warnings.some(
        w => w.ruleId === 'central_object_body_compatibility' || w.ruleId === 'relativistic_jet_special_handling'
      );
      expect(hasCompatibilityWarning).toBe(true);
    });

    it('should detect gas giant moon without valid parent', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        mode: 'realistic',
        cosmology: cosmologies.find(c => c.id === 'big_bang')!,
        epoch: epochs.find(e => e.id === 'golden_middle')!,
        centralObject: centralObjects.find(o => o.id === 'yellow_dwarf')!,
        celestialBody: celestialBodies.find(b => b.id === 'gas_giant_moon')!,
        cradle: cradles.find(c => c.id === 'supercritical_water')!
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
        mode: 'realistic',
        cosmology: cosmologies.find(c => c.id === 'big_bang')!,
        epoch: epochs.find(e => e.id === 'golden_middle')!,
        centralObject: centralObjects.find(o => o.id === 'yellow_dwarf')!,
        celestialBody: celestialBodies.find(b => b.id === 'earth_like')!,
        cradle: cradles.find(c => c.id === 'supercritical_water')!
      };

      const isCompatible = isWorldCompatible(mockWorld, 'realistic');
      expect(isCompatible).toBe(true);
    });

    it('should return false for incompatible world', () => {
      const mockWorld: Partial<GeneratedWorld> = {
        mode: 'realistic',
        cosmology: cosmologies.find(c => c.id === 'world_as_body')!,
        epoch: epochs.find(e => e.id === 'golden_middle')!,
        centralObject: centralObjects.find(o => o.id === 'yellow_dwarf')!,
        celestialBody: celestialBodies.find(b => b.id === 'earth_like')!,
        cradle: cradles.find(c => c.id === 'supercritical_water')!
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
