import { describe, expect, it } from 'vitest';
import type { ChemicalPhysicalKineticLayer } from '../../types';
import { runVerticalEddyDiffusionStep } from '../ChemicalEvolution/verticalEddyDiffusion';

const R = 8.31446261815324;
const MEAN_AIR_MOLAR_MASS = 0.0289647;

function hydrostaticPoint(
  heightM: number,
  pressurePa: number,
  temperatureK: number,
  columnMolesPerM2: number
) {
  return {
    heightM,
    pressurePa,
    temperatureK,
    densityKgPerM3: pressurePa * MEAN_AIR_MOLAR_MASS / (R * temperatureK),
    meanMolarMassKgPerMol: MEAN_AIR_MOLAR_MASS,
    gravityMs2: 9.80665,
    scaleHeightM: 8000,
    columnMassKgPerM2: columnMolesPerM2 * MEAN_AIR_MOLAR_MASS,
    columnMolesPerM2
  };
}

function makeLayer(
  layerId: string,
  minM: number,
  maxM: number,
  bottomPressurePa: number,
  topPressurePa: number,
  bottomColumnMoles: number,
  topColumnMoles: number,
  inventory: Record<string, number>
): ChemicalPhysicalKineticLayer {
  const bottomTemperatureK = 280;
  const topTemperatureK = 278;
  const bottom = hydrostaticPoint(minM, bottomPressurePa, bottomTemperatureK, bottomColumnMoles);
  const top = hydrostaticPoint(maxM, topPressurePa, topTemperatureK, topColumnMoles);
  const representative = hydrostaticPoint(
    (minM + maxM) / 2,
    Math.sqrt(bottomPressurePa * topPressurePa),
    Math.sqrt(bottomTemperatureK * topTemperatureK),
    (bottomColumnMoles + topColumnMoles) / 2
  );
  const airColumn = topColumnMoles - bottomColumnMoles;
  const provenance = { sourceName: 'synthetic hydrostatic fixture', sourceId: 'test:hydrostatic:' + layerId };
  return {
    layerId,
    altitudeRangeM: { min: minM, max: maxM },
    altitudeProvenance: { ...provenance },
    layerThicknessM: maxM - minM,
    thicknessProvenance: { ...provenance },
    temperatureK: (bottomTemperatureK + topTemperatureK) / 2,
    temperatureProvenance: { ...provenance },
    columnInventoriesMolM2: { ...inventory },
    inventoryProvenance: { ...provenance },
    hydrostaticState: {
      representativeHeightM: representative.heightM,
      bottom,
      representative,
      top,
      molarFractions: { n2: 0.7808, o2: 0.2095, ar: 0.0097 },
      equationOfStateMaxRelativeDeviation: 0,
      thirdBodyConsistency: {
        speciesId: 'n2',
        hydrostaticMidpointConcentrationMoleculeCm3: 1e19,
        layerAverageConcentrationMoleculeCm3: 1e19,
        relativeDeviation: 0,
        maximumAllowedRelativeDeviation: 0.02,
        hydrostaticLayerInventoryMolM2: airColumn * 0.7808,
        suppliedLayerInventoryMolM2: airColumn * 0.7808,
        inventoryRelativeDeviation: 0
      },
      provenance: {
        pressure: { ...provenance },
        composition: { ...provenance },
        model: { ...provenance }
      }
    },
    reactionIds: []
  };
}

function twoLayerColumn(): ChemicalPhysicalKineticLayer[] {
  return [
    makeLayer('lower', 0, 100, 100000, 99000, 100, 110, { no: 0.5, no2: 0 }),
    makeLayer('upper', 100, 200, 99000, 98000, 110, 119.9, { no: 0, no2: 0 })
  ];
}

function molecularTransportFixture(thermalDiffusionFactor = 0) {
  const syntheticProvenance = (id: string) => ({
    sourceName: 'synthetic-only molecular transport test fixture; not reference data',
    sourceId: 'test:molecular-transport:' + id,
    limitations: 'Used only to test the transport implementation; not measured Lennard-Jones or thermal-diffusion data'
  });
  const backgroundSpecies = {
    n2: {
      molarMassKgMol: 0.028,
      molarMassProvenance: syntheticProvenance('mass:n2'),
      collisionDiameterAngstrom: 3.8,
      characteristicEnergyOverKBK: 70,
      collisionParametersProvenance: syntheticProvenance('lj:n2')
    },
    o2: {
      molarMassKgMol: 0.032,
      molarMassProvenance: syntheticProvenance('mass:o2'),
      collisionDiameterAngstrom: 3.5,
      characteristicEnergyOverKBK: 100,
      collisionParametersProvenance: syntheticProvenance('lj:o2')
    },
    ar: {
      molarMassKgMol: 0.04,
      molarMassProvenance: syntheticProvenance('mass:ar'),
      collisionDiameterAngstrom: 3.4,
      characteristicEnergyOverKBK: 120,
      collisionParametersProvenance: syntheticProvenance('lj:ar')
    }
  };
  return {
    species: {
      heavy: {
        molarMassKgMol: 0.08,
        molarMassProvenance: syntheticProvenance('mass:heavy'),
        collisionDiameterAngstrom: 3.5,
        characteristicEnergyOverKBK: 100,
        collisionParametersProvenance: syntheticProvenance('lj:heavy'),
        thermalDiffusionFactor,
        thermalDiffusionProvenance: syntheticProvenance('thermal:heavy')
      }
    },
    backgroundSpecies
  };
}

describe('vertical eddy diffusion', () => {
  it('moves an explicit trace species down its mixing-ratio gradient and reports the interface flux', () => {
    const layers = twoLayerColumn();
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['no'],
      durationS: 1,
      eddyDiffusivityM2S: 1
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.layers[0]!.columnInventoriesMolM2.no).toBeLessThan(0.5);
    expect(result.layers[1]!.columnInventoriesMolM2.no).toBeGreaterThan(0);
    expect(result.audit.interfaces).toHaveLength(1);
    expect(result.audit.interfaces[0]!.species.no!.fluxMolM2S).toBeGreaterThan(0);
    expect(result.audit.interfaces[0]!.species.no!.transferredMolM2).toBeGreaterThan(0);
    expect(result.audit.boundaryCondition).toBe('closed_zero_flux');
  });

  it('conserves each species column inventory and balances the two adjacent subcolumns', () => {
    const result = runVerticalEddyDiffusionStep({
      layers: twoLayerColumn(),
      speciesIds: ['no', 'no2'],
      durationS: 25,
      eddyDiffusivityM2S: [20]
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    for (const speciesId of ['no', 'no2']) {
      const total = result.audit.columnTotalsMolM2[speciesId]!;
      expect(total.after).toBeCloseTo(total.before, 11);
      expect(total.relativeDeviation).toBeLessThan(1e-10);
      const transfer = result.audit.interfaces[0]!.species[speciesId]!.transferredMolM2;
      const lowerDelta =
        result.layers[0]!.columnInventoriesMolM2[speciesId]! -
        0.5 * Number(speciesId === 'no');
      const upperDelta =
        result.layers[1]!.columnInventoriesMolM2[speciesId]!;
      expect(lowerDelta).toBeCloseTo(-transfer, 9);
      expect(upperDelta).toBeCloseTo(transfer, 9);
    }
  });

  it('handles three layers with a distinct Kzz at each interface', () => {
    const layers = [
      makeLayer('lower', 0, 100, 100000, 99000, 100, 110, { no: 0.8 }),
      makeLayer('middle', 100, 250, 99000, 97500, 110, 125, { no: 0 }),
      makeLayer('upper', 250, 450, 97500, 95500, 125, 145, { no: 0 })
    ];
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['no'],
      durationS: 100,
      eddyDiffusivityM2S: [3, 1]
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.layers).toHaveLength(3);
    expect(result.audit.interfaces).toHaveLength(2);
    const total = result.audit.columnTotalsMolM2.no!;
    expect(total.after).toBeCloseTo(total.before, 11);
    const transfer0 = result.audit.interfaces[0]!.species.no!.transferredMolM2;
    const transfer1 = result.audit.interfaces[1]!.species.no!.transferredMolM2;
    expect(result.layers[0]!.columnInventoriesMolM2.no).toBeCloseTo(0.8 - transfer0, 10);
    expect(result.layers[1]!.columnInventoriesMolM2.no).toBeCloseTo(transfer0 - transfer1, 10);
    expect(result.layers[2]!.columnInventoriesMolM2.no).toBeCloseTo(transfer1, 10);
    expect(result.audit.interfaces[0]!.eddyDiffusivityM2S).toBe(3);
    expect(result.audit.interfaces[1]!.eddyDiffusivityM2S).toBe(1);
  });

  it('uses an implicit solve that remains non-negative and conservative for a stiff diffusion step', () => {
    const result = runVerticalEddyDiffusionStep({
      layers: twoLayerColumn(),
      speciesIds: ['no'],
      durationS: 1e6,
      eddyDiffusivityM2S: 1e5
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    for (const layer of result.layers) {
      expect(layer.columnInventoriesMolM2.no).toBeGreaterThanOrEqual(0);
    }
    const lowerMixingRatio =
      result.layers[0]!.columnInventoriesMolM2.no! / result.audit.layers[0]!.airColumnInventoryMolM2;
    const upperMixingRatio =
      result.layers[1]!.columnInventoriesMolM2.no! / result.audit.layers[1]!.airColumnInventoryMolM2;
    expect(lowerMixingRatio).toBeCloseTo(upperMixingRatio, 7);
    expect(result.audit.columnTotalsMolM2.no!.relativeDeviation).toBeLessThan(1e-10);
    expect(result.audit.interfaces[0]!.species.no!.fluxClosureRelativeDeviation).toBeLessThan(1e-4);
  });

  it('does not change inventories when every explicit interface Kzz is zero', () => {
    const layers = twoLayerColumn();
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['no'],
      durationS: 1e8,
      eddyDiffusivityM2S: 0
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.layers.map((layer) => layer.columnInventoriesMolM2.no))
      .toEqual([0.5, 0]);
    expect(layers.map((layer) => layer.columnInventoriesMolM2.no))
      .toEqual([0.5, 0]);
  });

  it('updates transport provenance without mutating the input state', () => {
    const layers = twoLayerColumn();
    const originalProvenance = { ...layers[0]!.inventoryProvenance };
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['no'],
      durationS: 10,
      eddyDiffusivityM2S: 2
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(layers[0]!.columnInventoriesMolM2.no).toBe(0.5);
    expect(layers[0]!.inventoryProvenance).toEqual(originalProvenance);
    expect(result.layers[0]!.inventoryProvenance.modelVersion)
      .toBe('stage-4.2-vertical-atmospheric-diffusion-2');
    expect(result.layers[0]!.inventoryProvenance.rawInput?.vertical_transport_duration_s).toBe(10);
    expect(result.layers[0]!.columnInventoriesMolM2.no).not.toBe(0.5);
  });

  it('computes Chapman-Enskog molecular diffusivity and gravitationally separates a heavy trace species', () => {
    const baseline = twoLayerColumn();
    const layers = [
      {
        ...baseline[0]!,
        columnInventoriesMolM2: { heavy: 0.005 }
      },
      {
        ...baseline[1]!,
        columnInventoriesMolM2: { heavy: 0.00495 }
      }
    ];
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['heavy'],
      durationS: 1e10,
      eddyDiffusivityM2S: 0,
      molecularDiffusion: molecularTransportFixture()
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    const interfaceAudit = result.audit.interfaces[0]!.species.heavy!;
    expect(interfaceAudit.molecularDiffusivityM2S).toBeGreaterThan(0);
    expect(Object.keys(interfaceAudit.binaryDiffusivitiesM2S ?? {}).sort()).toEqual(['ar', 'n2', 'o2']);
    expect(interfaceAudit.barodiffusionVelocityMs).toBeLessThan(0);
    expect(interfaceAudit.molecularDriftVelocityMs).toBeLessThan(0);
    expect(interfaceAudit.fluxMolM2S).toBeLessThan(0);
    expect(result.layers[0]!.columnInventoriesMolM2.heavy).toBeGreaterThan(0.005);
    expect(result.layers[1]!.columnInventoriesMolM2.heavy).toBeLessThan(0.00495);
    expect(result.audit.columnTotalsMolM2.heavy!.after).toBeCloseTo(
      result.audit.columnTotalsMolM2.heavy!.before,
      10
    );
    expect(result.audit.molecularDiffusion?.method)
      .toBe('chapman_enskog_neufeld_effective_binary_trace_species');
    expect(result.audit.molecularDiffusion?.species.heavy.thermalDiffusionProvenance.sourceId)
      .toBe('test:molecular-transport:thermal:heavy');
  });

  it('includes the explicitly supplied thermal-diffusion factor in the molecular drift', () => {
    const baseline = twoLayerColumn();
    const lower = baseline[0]!;
    const upper = {
      ...baseline[1]!,
      hydrostaticState: {
        ...baseline[1]!.hydrostaticState!,
        representative: {
          ...baseline[1]!.hydrostaticState!.representative,
          temperatureK: 310
        }
      }
    };
    const layers = [
      { ...lower, columnInventoriesMolM2: { heavy: 0.005 } },
      { ...upper, columnInventoriesMolM2: { heavy: 0.00495 } }
    ];
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['heavy'],
      durationS: 1e8,
      eddyDiffusivityM2S: 0,
      molecularDiffusion: molecularTransportFixture(1)
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    const speciesAudit = result.audit.interfaces[0]!.species.heavy!;
    expect(speciesAudit.thermalDiffusionVelocityMs).toBeLessThan(0);
    expect(speciesAudit.molecularDriftVelocityMs).toBeLessThan(speciesAudit.barodiffusionVelocityMs!);
  });

  it('rejects molecular transport when any present bulk component lacks Lennard-Jones data', () => {
    const baseline = twoLayerColumn();
    const layers = [
      { ...baseline[0]!, columnInventoriesMolM2: { heavy: 0.005 } },
      { ...baseline[1]!, columnInventoriesMolM2: { heavy: 0.00495 } }
    ];
    const molecularDiffusion = molecularTransportFixture();
    delete (molecularDiffusion.backgroundSpecies as Record<string, unknown>).ar;
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['heavy'],
      durationS: 1,
      eddyDiffusivityM2S: 0,
      molecularDiffusion
    });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.diagnostics.join('; ')).toContain('Lennard-Jones');
    }
  });

  it('keeps dry-statically stable layers free of a convective diffusivity contribution', () => {
    const layers = twoLayerColumn();
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['no'],
      durationS: 100,
      eddyDiffusivityM2S: 0,
      dryConvectiveMixing: {
        speciesIds: ['no'],
        mixingLengthScaleHeightFraction: 0.5,
        efficiencyCoefficient: 0.1,
        provenance: {
          sourceName: 'synthetic mixing-length closure used for unit testing',
          sourceId: 'test:dry-convection:stable'
        }
      }
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    expect(result.audit.dryConvectiveMixing?.method)
      .toBe('dry_mixing_length_virtual_potential_temperature');
    expect(result.audit.dryConvectiveMixing!.interfaces[0]!.bruntVaisalaFrequencySquaredS2)
      .toBeGreaterThan(0);
    expect(result.audit.dryConvectiveMixing!.interfaces[0]!.convectiveDiffusivityM2S).toBe(0);
    expect(result.audit.interfaces[0]!.convectiveDiffusivityM2S).toBe(0);
    expect(result.layers[0]!.columnInventoriesMolM2.no).toBe(0.5);
    expect(result.layers[1]!.columnInventoriesMolM2.no).toBe(0);
  });

  it('adds a conservative convective tracer diffusivity only across dry-unstable interfaces', () => {
    const stable = twoLayerColumn();
    const lower = stable[0]!;
    const upper = stable[1]!;
    const unstableUpper = {
      ...upper,
      temperatureK: 274,
      hydrostaticState: {
        ...upper.hydrostaticState!,
        bottom: { ...upper.hydrostaticState!.bottom, temperatureK: 274 },
        representative: { ...upper.hydrostaticState!.representative, temperatureK: 274 },
        top: { ...upper.hydrostaticState!.top, temperatureK: 274 }
      }
    };
    const layers = [lower, unstableUpper];
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['no'],
      durationS: 100,
      eddyDiffusivityM2S: 0,
      dryConvectiveMixing: {
        speciesIds: ['no'],
        mixingLengthScaleHeightFraction: 0.5,
        efficiencyCoefficient: 0.05,
        provenance: {
          sourceName: 'synthetic mixing-length closure used for unit testing',
          sourceId: 'test:dry-convection:unstable'
        }
      }
    });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') return;
    const convection = result.audit.dryConvectiveMixing!.interfaces[0]!;
    expect(convection.bruntVaisalaFrequencySquaredS2).toBeLessThan(0);
    expect(convection.isDryConvectivelyUnstable).toBe(true);
    expect(convection.convectiveDiffusivityM2S).toBeGreaterThan(0);
    expect(result.audit.interfaces[0]!.effectiveEddyDiffusivityM2S)
      .toBeCloseTo(convection.convectiveDiffusivityM2S, 12);
    expect(result.audit.interfaces[0]!.species.no!.convectiveGradientFluxMolM2S).toBeDefined();
    expect(result.layers[0]!.columnInventoriesMolM2.no).toBeLessThan(0.5);
    expect(result.layers[1]!.columnInventoriesMolM2.no).toBeGreaterThan(0);
    expect(result.audit.columnTotalsMolM2.no!.after).toBeCloseTo(
      result.audit.columnTotalsMolM2.no!.before,
      10
    );
  });

  it('fails closed when a bulk species lacks NASA CEA heat-capacity data', () => {
    const layers = twoLayerColumn().map((layer) => ({
      ...layer,
      hydrostaticState: {
        ...layer.hydrostaticState!,
        molarFractions: { xenon: 1 }
      }
    }));
    const result = runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['no'],
      durationS: 1,
      eddyDiffusivityM2S: 0,
      dryConvectiveMixing: {
        speciesIds: ['no'],
        mixingLengthScaleHeightFraction: 0.5,
        efficiencyCoefficient: 0.1,
        provenance: {
          sourceName: 'synthetic closure test',
          sourceId: 'test:dry-convection:missing-cp'
        }
      }
    });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.diagnostics.join('; ')).toContain('NASA CEA');
    }
  });

  it('fails closed for bulk species, missing inventories, vertical gaps, and pressure discontinuities', () => {
    const layers = twoLayerColumn();
    expect(runVerticalEddyDiffusionStep({
      layers,
      speciesIds: ['n2'],
      durationS: 1,
      eddyDiffusivityM2S: 1
    }).status).toBe('rejected');

    const missing = twoLayerColumn();
    delete missing[1]!.columnInventoriesMolM2.no;
    expect(runVerticalEddyDiffusionStep({
      layers: missing,
      speciesIds: ['no'],
      durationS: 1,
      eddyDiffusivityM2S: 1
    }).status).toBe('rejected');

    const gap = twoLayerColumn();
    gap[1] = {
      ...gap[1]!,
      altitudeRangeM: { min: 101, max: 201 },
      layerThicknessM: 100,
      hydrostaticState: {
        ...gap[1]!.hydrostaticState!,
        bottom: { ...gap[1]!.hydrostaticState!.bottom, heightM: 101 },
        representative: { ...gap[1]!.hydrostaticState!.representative, heightM: 151 },
        top: { ...gap[1]!.hydrostaticState!.top, heightM: 201 },
        representativeHeightM: 151
      }
    };
    expect(runVerticalEddyDiffusionStep({
      layers: gap,
      speciesIds: ['no'],
      durationS: 1,
      eddyDiffusivityM2S: 1
    }).status).toBe('rejected');

    const pressureBreak = twoLayerColumn();
    pressureBreak[1] = {
      ...pressureBreak[1]!,
      hydrostaticState: {
        ...pressureBreak[1]!.hydrostaticState!,
        bottom: { ...pressureBreak[1]!.hydrostaticState!.bottom, pressurePa: 97000 }
      }
    };
    expect(runVerticalEddyDiffusionStep({
      layers: pressureBreak,
      speciesIds: ['no'],
      durationS: 1,
      eddyDiffusivityM2S: 1
    }).status).toBe('rejected');
  });
});
