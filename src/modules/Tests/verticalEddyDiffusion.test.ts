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
      .toBe('stage-4.2-vertical-eddy-diffusion-1');
    expect(result.layers[0]!.inventoryProvenance.rawInput?.vertical_transport_duration_s).toBe(10);
    expect(result.layers[0]!.columnInventoriesMolM2.no).not.toBe(0.5);
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
