// ============================================
// TESTS — MGS Mars occultation → hydrostatic Core bridge (Stage 4.2)
// ============================================
//
// These tests validate a single real PDS retrieval product. The
// one-component composition below is intentionally synthetic and is used
// only to exercise the hydrostatic adapter; it is NOT asserted to be the
// atmospheric composition of the MGS occultation.

import { describe, expect, it } from 'vitest';
import {
  MGS_MARS_8028D38A_METADATA,
  MGS_MARS_8028D38A_SAMPLES
} from '../Data/mgsMarsOccultation1998';
import { createMgsMars8028D38AHydrostaticColumnInput } from '../Core/atmosphericReferenceAdapters';
import {
  computeHydrostaticColumn,
  type HydrostaticColumnCompleted
} from '../Core/hydrostaticAtmosphere';

const TEST_ONLY_COMPOSITION = {
  gases: [{ gasId: 'co2', moleFraction: 1 }],
  provenance: {
    sourceName: 'synthetic test composition (not the MGS retrieval composition)',
    method: 'single-component structural fixture used only to exercise the hydrostatic adapter',
    limitations: 'not an observational estimate of the Mars occultation composition'
  }
} as const;

describe('MGS Mars radio-occultation profile 8028D38A.TPS', () => {
  it('preserves all 74 PDS samples, their uncertainties and local-height reference', () => {
    expect(MGS_MARS_8028D38A_METADATA.productId).toBe('8028D38A.TPS');
    expect(MGS_MARS_8028D38A_METADATA.datasetId).toBe('MGS-M-RSS-5-TPS-V1.0');
    expect(MGS_MARS_8028D38A_SAMPLES).toHaveLength(74);
    expect(MGS_MARS_8028D38A_METADATA.rowCount).toBe(74);

    const first = MGS_MARS_8028D38A_SAMPLES[0];
    const last = MGS_MARS_8028D38A_SAMPLES[MGS_MARS_8028D38A_SAMPLES.length - 1];
    expect(first.radiusM).toBe(3392456.6);
    expect(first.heightAboveLocalSurfaceM).toBeCloseTo(249.6, 9);
    expect(first.pressurePa).toBe(579.82);
    expect(first.pressureSigmaPa).toBe(7.16);
    expect(first.temperatureK).toBe(198.138);
    expect(first.temperatureSigmaK).toBe(1.85);
    expect(last.radiusM).toBe(3427466.4);
    expect(last.heightAboveLocalSurfaceM).toBeCloseTo(35259.4, 9);
    expect(last.pressurePa).toBe(20.6034);
    expect(last.temperatureK).toBe(180);

    for (let i = 0; i < MGS_MARS_8028D38A_SAMPLES.length; i += 1) {
      const sample = MGS_MARS_8028D38A_SAMPLES[i];
      expect(Number.isFinite(sample.pressurePa)).toBe(true);
      expect(sample.pressurePa).toBeGreaterThan(0);
      expect(sample.pressureSigmaPa).toBeGreaterThan(0);
      expect(sample.temperatureK).toBeGreaterThan(0);
      expect(sample.temperatureSigmaK).toBeGreaterThan(0);
      expect(sample.numberDensityPerM3).toBeGreaterThan(0);
      expect(sample.numberDensitySigmaPerM3).toBeGreaterThan(0);
      expect(sample.heightAboveLocalSurfaceM).toBeGreaterThanOrEqual(0);

      if (i > 0) {
        const previous = MGS_MARS_8028D38A_SAMPLES[i - 1];
        expect(sample.radiusM).toBeGreaterThan(previous.radiusM);
        expect(sample.heightAboveLocalSurfaceM).toBeGreaterThan(previous.heightAboveLocalSurfaceM);
        expect(sample.geopotentialM2S2).toBeGreaterThan(previous.geopotentialM2S2);
        expect(sample.pressurePa).toBeLessThan(previous.pressurePa);
        expect(sample.numberDensityPerM3).toBeLessThan(previous.numberDensityPerM3);
      }

      // The PDS number-density column is internally consistent with its
      // retrieved P/T under the ideal-gas relation used by the product.
      const reconstructedNumberDensity =
        sample.pressurePa / (1.380649e-23 * sample.temperatureK);
      expect(
        Math.abs(reconstructedNumberDensity / sample.numberDensityPerM3 - 1)
      ).toBeLessThan(2e-4);
    }
  });

  it('anchors at the lowest measured row, not the extrapolated surface pressure', () => {
    const input = createMgsMars8028D38AHydrostaticColumnInput(TEST_ONLY_COMPOSITION);
    const first = MGS_MARS_8028D38A_SAMPLES[0];
    const last = MGS_MARS_8028D38A_SAMPLES[MGS_MARS_8028D38A_SAMPLES.length - 1];

    expect(input.surface.surfacePressurePa).toBe(first.pressurePa);
    expect(input.surface.bottomHeightM).toBe(first.heightAboveLocalSurfaceM);
    expect(input.surface.surfacePressurePa).not.toBe(
      MGS_MARS_8028D38A_METADATA.extrapolatedSurfacePressurePa
    );
    expect(input.layers).toHaveLength(1);
    expect(input.layers[0].bottomHeightM).toBe(first.heightAboveLocalSurfaceM);
    expect(input.layers[0].topHeightM).toBe(last.heightAboveLocalSurfaceM);
    expect(input.body.referenceRadiusM).toBe(MGS_MARS_8028D38A_METADATA.radiusAtSurfaceM);

    const temperature = input.layers[0].temperature;
    expect(temperature.kind).toBe('measuredNodes');
    if (temperature.kind !== 'measuredNodes') {
      throw new Error('MGS adapter must use measured temperature nodes');
    }
    expect(temperature.interpolation).toBe('linear');
    expect(temperature.nodes).toHaveLength(74);
    expect(temperature.nodes[0]).toEqual({
      heightM: first.heightAboveLocalSurfaceM,
      temperatureK: first.temperatureK
    });
  });

  it('runs the measured temperature nodes through Core hydrostatics without extrapolating the profile', () => {
    const input = createMgsMars8028D38AHydrostaticColumnInput(TEST_ONLY_COMPOSITION);
    const result = computeHydrostaticColumn(input);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error(
        'MGS hydrostatic reference column failed: ' +
          (result.status === 'invalid_input'
            ? result.errors.join('; ')
            : result.status === 'numerical_failure'
              ? result.reason
              : result.reason)
      );
    }

    const completed = result as HydrostaticColumnCompleted;
    expect(completed.gravitationMode).toBe('spherical-gravity');
    expect(completed.coverage.bottomHeightM).toBe(
      MGS_MARS_8028D38A_SAMPLES[0].heightAboveLocalSurfaceM
    );
    expect(completed.coverage.topHeightM).toBe(
      MGS_MARS_8028D38A_SAMPLES[73].heightAboveLocalSurfaceM
    );
    expect(completed.requestedHeightPoints).toHaveLength(74);

    for (let i = 0; i < completed.requestedHeightPoints.length; i += 1) {
      const calculated = completed.requestedHeightPoints[i];
      const observed = MGS_MARS_8028D38A_SAMPLES[i];
      expect(calculated.heightM).toBe(observed.heightAboveLocalSurfaceM);
      expect(calculated.temperatureK).toBeCloseTo(observed.temperatureK, 8);
      expect(Number.isFinite(calculated.pressurePa)).toBe(true);
      expect(calculated.pressurePa).toBeGreaterThan(0);
      if (i > 0) {
        expect(calculated.pressurePa).toBeLessThan(
          completed.requestedHeightPoints[i - 1].pressurePa
        );
      }
    }

    expect(
      completed.assumptions.some((assumption) => /ideal gas/i.test(assumption))
    ).toBe(true);
  });

  it('fails closed for absent or non-normalized caller composition', () => {
    expect(() =>
      createMgsMars8028D38AHydrostaticColumnInput({
        gases: [],
        provenance: { sourceName: 'empty test composition' }
      })
    ).toThrow(/состав атмосферы не может быть пустым/);

    expect(() =>
      createMgsMars8028D38AHydrostaticColumnInput({
        gases: [{ gasId: 'co2', moleFraction: 0.95 }],
        provenance: { sourceName: 'deliberately incomplete test composition' }
      })
    ).toThrow(/автоматическая нормировка запрещена/);
  });
});
