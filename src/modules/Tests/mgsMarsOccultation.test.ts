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
import {
  computeAdaptivelyRefinedMgsMars8028D38AHydrostaticColumnWithUncertainty,
  computeMgsMars8028D38AHydrostaticColumnWithUncertainty,
  createMgsMars8028D38AHydrostaticColumnInput,
  createMgsMars8028D38AAtmosphericTemperatureProfile
} from '../Core/atmosphericReferenceAdapters';
import { propagateMeasuredNodeHydrostaticUncertainty } from '../Core/hydrostaticUncertainty';
import { importSourcedAtmosphericTemperatureProfileForKinetics } from '../ChemicalEvolution/thermalProfileImport';
import {
  computeHydrostaticColumn,
  type HydrostaticColumnCompleted,
  type HydrostaticColumnInput
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

  it('builds a source-grounded partial temperature profile from exactly 74 nodes and 73 adjacent intervals', () => {
    const profile = createMgsMars8028D38AAtmosphericTemperatureProfile();
    expect(profile.status).toBe('partial_profile');
    expect(profile.layers).toHaveLength(73);
    expect(profile.provenance?.sourceId).toBe('PDS product 8028D38A.TPS');
    expect(profile.limitations).toMatch(/one MGS radio occultation/i);
    expect(profile.limitations).toMatch(/covariance/i);

    const first = MGS_MARS_8028D38A_SAMPLES[0]!;
    const last = MGS_MARS_8028D38A_SAMPLES[73]!;
    expect(profile.layers[0].altitudeRangeM).toEqual({
      min: first.heightAboveLocalSurfaceM,
      max: MGS_MARS_8028D38A_SAMPLES[1]!.heightAboveLocalSurfaceM
    });
    expect(profile.layers[72].altitudeRangeM).toEqual({
      min: MGS_MARS_8028D38A_SAMPLES[72]!.heightAboveLocalSurfaceM,
      max: last.heightAboveLocalSurfaceM
    });
    const firstLayerTemperature = profile.layers[0].temperature;
    expect(firstLayerTemperature.status).toBe('estimated');
    if (firstLayerTemperature.status !== 'estimated') {
      throw new Error('MGS midpoint temperature must retain estimated status');
    }
    expect(firstLayerTemperature.quantity.value).toBeCloseTo(
      (first.temperatureK + MGS_MARS_8028D38A_SAMPLES[1]!.temperatureK) / 2,
      12
    );
    expect(firstLayerTemperature.provenance?.recordId).toBe('interpolated-rows-1-2');
    expect(firstLayerTemperature.provenance?.rawInput?.lowerTemperatureSigmaK).toBe(first.temperatureSigmaK);
    expect(firstLayerTemperature.uncertainty).toBeUndefined();

    for (let index = 0; index < profile.layers.length; index += 1) {
      const layer = profile.layers[index]!;
      expect(layer.temperature.status).toBe('estimated');
      expect(layer.altitudeRangeM!.max).toBeGreaterThan(layer.altitudeRangeM!.min);
      if (index > 0) {
        expect(layer.altitudeRangeM!.min).toBe(profile.layers[index - 1]!.altitudeRangeM!.max);
      }
    }
  });

  it('passes the MGS temperature-only profile through the strict kinetic-layer importer without adding chemistry', () => {
    const profile = createMgsMars8028D38AAtmosphericTemperatureProfile();
    const imported = importSourcedAtmosphericTemperatureProfileForKinetics(profile);

    expect(imported.status).toBe('imported');
    if (imported.status !== 'imported') {
      throw new Error(imported.diagnostics.join('; '));
    }
    expect(imported.layers).toHaveLength(73);
    expect(imported.layers[0].bottomAltitudeM).toBe(
      MGS_MARS_8028D38A_SAMPLES[0]!.heightAboveLocalSurfaceM
    );
    expect(imported.layers[72].topAltitudeM).toBe(
      MGS_MARS_8028D38A_SAMPLES[73]!.heightAboveLocalSurfaceM
    );
    expect(imported.layers[0].temperatureProvenance.sourceId).toBe('PDS product 8028D38A.TPS');
    expect(imported.layers[0].altitudeProvenance.sourceId).toBe('PDS product 8028D38A.TPS');
    expect(imported.diagnostics.join(' ')).toMatch(/реакции.*запасы.*скорости не выведены/);
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
      completed.assumptions.some((assumption) => /идеальный газ/i.test(assumption))
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

  it('propagates PDS one-sigma boundary-pressure and temperature errors to P(z) and density', () => {
    const result = computeMgsMars8028D38AHydrostaticColumnWithUncertainty(TEST_ONLY_COMPOSITION);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error(
        result.status === 'hydrostatic_failed'
          ? 'hydrostatic failed: ' + result.result.status
          : 'uncertainty failed: ' + result.errors.join('; ')
      );
    }

    expect(result.column.requestedHeightPoints).toHaveLength(74);
    expect(result.uncertainty.status).toBe('estimated');
    expect(result.uncertainty.method).toBe('first_order_linearized_diagonal_covariance');
    expect(result.uncertainty.uncertaintyLevel).toBe('one_sigma');
    expect(result.uncertainty.covarianceAssumption).toMatch(/independent/);
    expect(result.uncertainty.points).toHaveLength(74);

    const first = result.uncertainty.points[0];
    const last = result.uncertainty.points[result.uncertainty.points.length - 1];
    expect(first.heightM).toBe(MGS_MARS_8028D38A_SAMPLES[0].heightAboveLocalSurfaceM);
    expect(first.pressureSigmaPa).toBeCloseTo(
      MGS_MARS_8028D38A_SAMPLES[0].pressureSigmaPa,
      10
    );
    expect(first.temperatureSigmaK).toBeCloseTo(
      MGS_MARS_8028D38A_SAMPLES[0].temperatureSigmaK,
      10
    );
    expect(last.heightM).toBe(MGS_MARS_8028D38A_SAMPLES[73].heightAboveLocalSurfaceM);
    expect(last.pressureRelativeSigma).toBeGreaterThan(first.pressureRelativeSigma);
    expect(last.pressureSigmaPa).toBeGreaterThan(0);
    expect(last.densitySigmaKgPerM3).toBeGreaterThan(0);
    expect(last.densityRelativeSigma).toBeGreaterThan(0);
    expect(first.columnMassSigmaKgPerM2).toBe(0);
    expect(first.columnMassRelativeSigma).toBeNull();
    expect(first.columnMolesSigmaPerM2).toBe(0);
    expect(first.columnMolesRelativeSigma).toBeNull();
    expect(last.columnMassSigmaKgPerM2).toBeGreaterThan(0);
    expect(last.columnMassRelativeSigma).toBeGreaterThan(0);
    expect(last.columnMolesSigmaPerM2).toBeGreaterThan(0);
    expect(last.columnMolesRelativeSigma).toBeCloseTo(last.columnMassRelativeSigma!, 10);
    expect(last.columnMolesSigmaPerM2).toBeCloseTo(
      last.columnMassSigmaKgPerM2 /
        result.column.requestedHeightPoints[73].meanMolarMassKgPerMol,
      10
    );
    expect(result.uncertainty.columnIntegralConsistencyMaxRelativeDeviation).toBeLessThan(5e-5);

    for (const point of result.uncertainty.points) {
      expect(Number.isFinite(point.pressureSigmaPa)).toBe(true);
      expect(Number.isFinite(point.densitySigmaKgPerM3)).toBe(true);
      expect(point.pressureLowerOneSigmaPa).toBeGreaterThanOrEqual(0);
      expect(point.pressureUpperOneSigmaPa).toBeGreaterThan(point.pressureLowerOneSigmaPa);
      expect(point.densityLowerOneSigmaKgPerM3).toBeGreaterThanOrEqual(0);
      expect(point.densityUpperOneSigmaKgPerM3).toBeGreaterThan(point.densityLowerOneSigmaKgPerM3);
    }
    expect(result.uncertainty.limitations.join(' ')).toMatch(/covariance matrix/i);
  });

  it('matches an independent finite-difference sensitivity for one temperature node', () => {
    const input = createMgsMars8028D38AHydrostaticColumnInput(TEST_ONLY_COMPOSITION);
    const layer = input.layers[0];
    const model = layer.temperature;
    if (model.kind !== 'measuredNodes') {
      throw new Error('finite-difference test requires measuredNodes');
    }

    const selectedNode = 35;
    const perturbationK = 1e-3;
    const sigmaK = 0.25;
    const buildPerturbedInput = (deltaK: number): HydrostaticColumnInput => ({
      ...input,
      layers: [{
        ...layer,
        temperature: {
          kind: 'measuredNodes',
          interpolation: 'linear',
          nodes: model.nodes.map((node, index) => ({
            ...node,
            temperatureK: node.temperatureK + (index === selectedNode ? deltaK : 0)
          }))
        }
      }]
    });

    const base = computeHydrostaticColumn(input);
    const plus = computeHydrostaticColumn(buildPerturbedInput(perturbationK));
    const minus = computeHydrostaticColumn(buildPerturbedInput(-perturbationK));
    expect(base.status).toBe('completed');
    expect(plus.status).toBe('completed');
    expect(minus.status).toBe('completed');
    if (base.status !== 'completed' || plus.status !== 'completed' || minus.status !== 'completed') {
      throw new Error('finite-difference hydrostatic solve failed');
    }

    const sigmas = new Array<number>(model.nodes.length).fill(0);
    sigmas[selectedNode] = sigmaK;
    const uncertainty = propagateMeasuredNodeHydrostaticUncertainty(input, base, {
      surfacePressureSigmaPa: 0,
      temperatureNodeSigmaK: sigmas
    });
    expect(uncertainty.status).toBe('estimated');
    if (uncertainty.status !== 'estimated') {
      throw new Error(uncertainty.errors.join('; '));
    }

    const basePressure = base.requestedHeightPoints[73].pressurePa;
    const plusPressure = plus.requestedHeightPoints[73].pressurePa;
    const minusPressure = minus.requestedHeightPoints[73].pressurePa;
    const finiteDifferenceLogSensitivity =
      (Math.log(plusPressure) - Math.log(minusPressure)) / (2 * perturbationK);
    const expectedSigmaPa = basePressure * Math.abs(finiteDifferenceLogSensitivity) * sigmaK;
    const propagatedSigmaPa =
      uncertainty.points[uncertainty.points.length - 1].pressureSigmaPa;
    expect(propagatedSigmaPa).toBeCloseTo(expectedSigmaPa, 4);
  });

  it('matches an independent finite-difference sensitivity for integrated mass and molar columns', () => {
    const input = createMgsMars8028D38AHydrostaticColumnInput(TEST_ONLY_COMPOSITION);
    const layer = input.layers[0];
    const model = layer.temperature;
    if (model.kind !== 'measuredNodes') {
      throw new Error('finite-difference inventory test requires measuredNodes');
    }

    const selectedNode = 35;
    const perturbationK = 1e-3;
    const sigmaK = 0.25;
    const buildPerturbedInput = (deltaK: number): HydrostaticColumnInput => ({
      ...input,
      layers: [{
        ...layer,
        temperature: {
          kind: 'measuredNodes',
          interpolation: 'linear',
          nodes: model.nodes.map((node, index) => ({
            ...node,
            temperatureK: node.temperatureK + (index === selectedNode ? deltaK : 0)
          }))
        }
      }]
    });

    const base = computeHydrostaticColumn(input);
    const plus = computeHydrostaticColumn(buildPerturbedInput(perturbationK));
    const minus = computeHydrostaticColumn(buildPerturbedInput(-perturbationK));
    expect(base.status).toBe('completed');
    expect(plus.status).toBe('completed');
    expect(minus.status).toBe('completed');
    if (base.status !== 'completed' || plus.status !== 'completed' || minus.status !== 'completed') {
      throw new Error('finite-difference inventory solve failed');
    }

    const sigmas = new Array<number>(model.nodes.length).fill(0);
    sigmas[selectedNode] = sigmaK;
    const uncertainty = propagateMeasuredNodeHydrostaticUncertainty(input, base, {
      surfacePressureSigmaPa: 0,
      temperatureNodeSigmaK: sigmas
    });
    expect(uncertainty.status).toBe('estimated');
    if (uncertainty.status !== 'estimated') {
      throw new Error(uncertainty.errors.join('; '));
    }

    const topIndex = base.requestedHeightPoints.length - 1;
    const expectedMassSigma =
      Math.abs(
        (plus.requestedHeightPoints[topIndex].columnMassKgPerM2 -
          minus.requestedHeightPoints[topIndex].columnMassKgPerM2) /
          (2 * perturbationK)
      ) * sigmaK;
    const expectedMolesSigma =
      Math.abs(
        (plus.requestedHeightPoints[topIndex].columnMolesPerM2 -
          minus.requestedHeightPoints[topIndex].columnMolesPerM2) /
          (2 * perturbationK)
      ) * sigmaK;
    const propagatedTop = uncertainty.points[uncertainty.points.length - 1];

    expect(expectedMassSigma).toBeGreaterThan(0);
    expect(expectedMolesSigma).toBeGreaterThan(0);
    expect(propagatedTop.columnMassSigmaKgPerM2).toBeCloseTo(expectedMassSigma, 3);
    expect(propagatedTop.columnMolesSigmaPerM2).toBeCloseTo(expectedMolesSigma, 3);
  });

  it('propagates original PDS node errors onto the adaptively refined hydrostatic mesh', () => {
    const result =
      computeAdaptivelyRefinedMgsMars8028D38AHydrostaticColumnWithUncertainty(
        TEST_ONLY_COMPOSITION
      );
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error(
        result.status === 'adaptive_rejected'
          ? result.result.reason + ': ' + result.result.diagnostics.join('; ')
          : result.errors.join('; ')
      );
    }

    expect(result.adaptive.refinements.length).toBeGreaterThan(1);
    expect(result.adaptive.input.layers.length).toBeGreaterThan(1);
    expect(result.adaptive.refinements.every((summary) => summary.subdivisions >= 1)).toBe(true);
    expect(result.uncertainty.points.length).toBeGreaterThan(2);
    expect(result.uncertainty.points[0].heightM).toBe(
      MGS_MARS_8028D38A_SAMPLES[0].heightAboveLocalSurfaceM
    );
    expect(result.uncertainty.points[result.uncertainty.points.length - 1].heightM).toBe(
      MGS_MARS_8028D38A_SAMPLES[73].heightAboveLocalSurfaceM
    );
    expect(result.uncertainty.points.every((point) =>
      Number.isFinite(point.columnMassSigmaKgPerM2) &&
      Number.isFinite(point.columnMolesSigmaPerM2)
    )).toBe(true);
    expect(result.uncertainty.points[result.uncertainty.points.length - 1]
      .columnMassSigmaKgPerM2).toBeGreaterThan(0);
    for (let i = 1; i < result.uncertainty.points.length; i += 1) {
      expect(result.uncertainty.points[i].heightM).toBeGreaterThan(
        result.uncertainty.points[i - 1].heightM
      );
    }
  });

  it('rejects missing, negative or dimensionally mismatched uncertainty inputs', () => {
    const input = createMgsMars8028D38AHydrostaticColumnInput(TEST_ONLY_COMPOSITION);
    const solved = computeHydrostaticColumn(input);
    expect(solved.status).toBe('completed');
    if (solved.status !== 'completed') throw new Error('hydrostatic solve failed');

    const validSigmas = MGS_MARS_8028D38A_SAMPLES.map((sample) => sample.temperatureSigmaK);
    const missing = propagateMeasuredNodeHydrostaticUncertainty(input, solved, {
      surfacePressureSigmaPa: 7.16,
      temperatureNodeSigmaK: []
    });
    expect(missing.status).toBe('invalid_input');

    const negative = propagateMeasuredNodeHydrostaticUncertainty(input, solved, {
      surfacePressureSigmaPa: 7.16,
      temperatureNodeSigmaK: validSigmas.map((sigma, index) => index === 5 ? -sigma : sigma)
    });
    expect(negative.status).toBe('invalid_input');

    const invalidBoundary = propagateMeasuredNodeHydrostaticUncertainty(input, solved, {
      surfacePressureSigmaPa: 600,
      temperatureNodeSigmaK: validSigmas
    });
    expect(invalidBoundary.status).toBe('invalid_input');
  });
});
