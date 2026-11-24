import { describe, expect, it } from 'vitest';
import {
  computeHydrostaticColumn,
  type HydrostaticColumnCompleted,
  type HydrostaticColumnInput
} from '../Core/hydrostaticAtmosphere';
import { propagateMeasuredNodeHydrostaticUncertainty } from '../Core/hydrostaticUncertainty';
import { tryGetGasSpecies } from '../Data/gases';

const BODY_MASS_KG = 5.9722e24;
const BODY_RADIUS_M = 6.371e6;
const SURFACE_PRESSURE_PA = 101325;
const N2_FRACTION = 0.7;
const PROVENANCE = {
  sourceName: 'Synthetic finite-difference fixture',
  sourceId: 'test-only-hydrostatic-parameter-uncertainty',
  method: 'Controlled input used only to compare first-order sensitivities with central finite differences',
  limitations: 'Not an observational atmosphere or planetary parameter set'
} as const;

function requiredMolarMassKgPerMol(gasId: string): number {
  const gas = tryGetGasSpecies(gasId);
  if (!gas || typeof gas.molarMass !== 'number') {
    throw new Error('Test fixture requires a catalogued molar mass for ' + gasId);
  }
  return gas.molarMass * 1e-3;
}

const N2_MOLAR_MASS = requiredMolarMassKgPerMol('n2');
const CO2_MOLAR_MASS = requiredMolarMassKgPerMol('co2');

function makeInput(overrides: {
  bodyMassKg?: number;
  referenceRadiusM?: number;
  nitrogenMoleFraction?: number;
} = {}): HydrostaticColumnInput {
  const nitrogenMoleFraction = overrides.nitrogenMoleFraction ?? N2_FRACTION;
  return {
    body: {
      bodyMassKg: overrides.bodyMassKg ?? BODY_MASS_KG,
      referenceRadiusM: overrides.referenceRadiusM ?? BODY_RADIUS_M,
      provenance: PROVENANCE
    },
    surface: {
      surfacePressurePa: SURFACE_PRESSURE_PA,
      pressureProvenance: PROVENANCE
    },
    layers: [{
      layerId: 'synthetic-measured-temperature-layer',
      bottomHeightM: 0,
      topHeightM: 15000,
      temperature: {
        kind: 'measuredNodes',
        interpolation: 'linear',
        nodes: [
          { heightM: 0, temperatureK: 288 },
          { heightM: 5000, temperatureK: 260 },
          { heightM: 15000, temperatureK: 230 }
        ]
      },
      composition: {
        gases: [
          { gasId: 'n2', moleFraction: nitrogenMoleFraction },
          { gasId: 'co2', moleFraction: 1 - nitrogenMoleFraction }
        ],
        provenance: PROVENANCE
      },
      provenance: PROVENANCE
    }],
    requestedHeightsM: [7500, 15000],
    numerics: { gravitationMode: 'spherical-gravity', rtol: 1e-10, atol: 1e-12 }
  };
}

function solve(input: HydrostaticColumnInput): HydrostaticColumnCompleted {
  const result = computeHydrostaticColumn(input);
  if (result.status !== 'completed') {
    throw new Error('Synthetic hydrostatic fixture failed: ' +
      (result.status === 'invalid_input' ? result.errors.join('; ') : result.status));
  }
  return result;
}

function readMetrics(input: HydrostaticColumnInput) {
  const solved = solve(input);
  const point = solved.profile.find((entry) => Math.abs(entry.heightM - 15000) < 1e-6);
  if (!point) throw new Error('Expected hydrostatic profile endpoint at 15000 m');
  return {
    pressurePa: point.pressurePa,
    densityKgPerM3: point.densityKgPerM3,
    columnMassKgPerM2: point.columnMassKgPerM2,
    columnMolesPerM2: point.columnMolesPerM2
  };
}

function centralDerivative(
  minus: number,
  plus: number,
  delta: number
): number {
  return (plus - minus) / (2 * delta);
}

describe('Hydrostatic physical-parameter uncertainty (Stage 4.2)', () => {
  it('matches central finite differences for mass, radius and mixture molar mass', () => {
    const baseInput = makeInput();
    const base = solve(baseInput);
    const baseMetrics = readMetrics(baseInput);
    const target = base.profile.find((entry) => Math.abs(entry.heightM - 15000) < 1e-6);
    if (!target) throw new Error('Expected target point');

    const massDelta = BODY_MASS_KG * 1e-5;
    const radiusDelta = BODY_RADIUS_M * 1e-5;
    const baseMeanMolarMass =
      N2_FRACTION * N2_MOLAR_MASS + (1 - N2_FRACTION) * CO2_MOLAR_MASS;
    const molarMassDelta = baseMeanMolarMass * 1e-5;
    const compositionDelta = molarMassDelta / (CO2_MOLAR_MASS - N2_MOLAR_MASS);

    const massMinus = readMetrics(makeInput({ bodyMassKg: BODY_MASS_KG - massDelta }));
    const massPlus = readMetrics(makeInput({ bodyMassKg: BODY_MASS_KG + massDelta }));
    const radiusMinus = readMetrics(makeInput({ referenceRadiusM: BODY_RADIUS_M - radiusDelta }));
    const radiusPlus = readMetrics(makeInput({ referenceRadiusM: BODY_RADIUS_M + radiusDelta }));
    const molarMinus = readMetrics(makeInput({ nitrogenMoleFraction: N2_FRACTION - compositionDelta }));
    const molarPlus = readMetrics(makeInput({ nitrogenMoleFraction: N2_FRACTION + compositionDelta }));

    const massSigma = BODY_MASS_KG * 2e-4;
    const radiusSigma = BODY_RADIUS_M * 2e-4;
    const meanMolarMassSigma = baseMeanMolarMass * 2e-4;
    const propagated = propagateMeasuredNodeHydrostaticUncertainty(
      baseInput,
      base,
      {
        surfacePressureSigmaPa: 0,
        temperatureNodeSigmaK: [0, 0, 0],
        physicalParameters: {
          bodyMassSigmaKg: massSigma,
          referenceRadiusSigmaM: radiusSigma,
          meanMolarMassSigmaKgPerMol: meanMolarMassSigma,
          covariance: 'independent_diagonal',
          provenance: PROVENANCE
        }
      }
    );

    expect(propagated.status).toBe('estimated');
    if (propagated.status !== 'estimated') {
      throw new Error('Expected estimated uncertainty result');
    }
    const output = propagated.points.find((entry) => Math.abs(entry.heightM - 15000) < 1e-6);
    if (!output) throw new Error('Expected uncertainty result at 15000 m');

    const dLogPressureMass = centralDerivative(
      Math.log(massMinus.pressurePa),
      Math.log(massPlus.pressurePa),
      massDelta
    );
    const dLogPressureRadius = centralDerivative(
      Math.log(radiusMinus.pressurePa),
      Math.log(radiusPlus.pressurePa),
      radiusDelta
    );
    const dLogPressureMolar = centralDerivative(
      Math.log(molarMinus.pressurePa),
      Math.log(molarPlus.pressurePa),
      molarMassDelta
    );
    const dLogDensityMass = centralDerivative(
      Math.log(massMinus.densityKgPerM3),
      Math.log(massPlus.densityKgPerM3),
      massDelta
    );
    const dLogDensityRadius = centralDerivative(
      Math.log(radiusMinus.densityKgPerM3),
      Math.log(radiusPlus.densityKgPerM3),
      radiusDelta
    );
    const dLogDensityMolar = centralDerivative(
      Math.log(molarMinus.densityKgPerM3),
      Math.log(molarPlus.densityKgPerM3),
      molarMassDelta
    );
    const dMassColumnMass = centralDerivative(
      massMinus.columnMassKgPerM2,
      massPlus.columnMassKgPerM2,
      massDelta
    );
    const dMassColumnRadius = centralDerivative(
      radiusMinus.columnMassKgPerM2,
      radiusPlus.columnMassKgPerM2,
      radiusDelta
    );
    const dMassColumnMolar = centralDerivative(
      molarMinus.columnMassKgPerM2,
      molarPlus.columnMassKgPerM2,
      molarMassDelta
    );
    const dMolarColumnMass = centralDerivative(
      massMinus.columnMolesPerM2,
      massPlus.columnMolesPerM2,
      massDelta
    );
    const dMolarColumnRadius = centralDerivative(
      radiusMinus.columnMolesPerM2,
      radiusPlus.columnMolesPerM2,
      radiusDelta
    );
    const dMolarColumnMolar = centralDerivative(
      molarMinus.columnMolesPerM2,
      molarPlus.columnMolesPerM2,
      molarMassDelta
    );

    const expectedPressureRelativeSigma = Math.sqrt(
      (dLogPressureMass * massSigma) ** 2 +
      (dLogPressureRadius * radiusSigma) ** 2 +
      (dLogPressureMolar * meanMolarMassSigma) ** 2
    );
    const expectedDensityRelativeSigma = Math.sqrt(
      (dLogDensityMass * massSigma) ** 2 +
      (dLogDensityRadius * radiusSigma) ** 2 +
      (dLogDensityMolar * meanMolarMassSigma) ** 2
    );
    const expectedMassColumnSigma = Math.sqrt(
      (dMassColumnMass * massSigma) ** 2 +
      (dMassColumnRadius * radiusSigma) ** 2 +
      (dMassColumnMolar * meanMolarMassSigma) ** 2
    );
    const expectedMolarColumnSigma = Math.sqrt(
      (dMolarColumnMass * massSigma) ** 2 +
      (dMolarColumnRadius * radiusSigma) ** 2 +
      (dMolarColumnMolar * meanMolarMassSigma) ** 2
    );

    expect(output.pressureRelativeSigma / expectedPressureRelativeSigma).toBeCloseTo(1, 3);
    expect(output.densityRelativeSigma / expectedDensityRelativeSigma).toBeCloseTo(1, 3);
    expect(output.columnMassSigmaKgPerM2 / expectedMassColumnSigma).toBeCloseTo(1, 3);
    expect(output.columnMolesSigmaPerM2 / expectedMolarColumnSigma).toBeCloseTo(1, 3);
    expect(baseMetrics.pressurePa).toBeGreaterThan(0);
  });

  it('rejects physical-parameter uncertainties without provenance or with invalid sigma', () => {
    const input = makeInput();
    const completed = solve(input);
    const noProvenance = propagateMeasuredNodeHydrostaticUncertainty(input, completed, {
      surfacePressureSigmaPa: 0,
      temperatureNodeSigmaK: [0, 0, 0],
      physicalParameters: {
        bodyMassSigmaKg: BODY_MASS_KG * 1e-4,
        covariance: 'independent_diagonal',
        provenance: {}
      }
    });
    expect(noProvenance.status).toBe('invalid_input');

    const negativeSigma = propagateMeasuredNodeHydrostaticUncertainty(input, completed, {
      surfacePressureSigmaPa: 0,
      temperatureNodeSigmaK: [0, 0, 0],
      physicalParameters: {
        bodyMassSigmaKg: -1,
        covariance: 'independent_diagonal',
        provenance: PROVENANCE
      }
    });
    expect(negativeSigma.status).toBe('invalid_input');
  });

  it('keeps omitted mass, radius and mixture uncertainty explicitly conditional', () => {
    const input = makeInput();
    const completed = solve(input);
    const propagated = propagateMeasuredNodeHydrostaticUncertainty(input, completed, {
      surfacePressureSigmaPa: 0,
      temperatureNodeSigmaK: [0, 0, 0]
    });
    expect(propagated.status).toBe('estimated');
    if (propagated.status !== 'estimated') {
      throw new Error('Expected estimated uncertainty result');
    }
    expect(propagated.conditionalOn.join(' ')).toMatch(/body mass held fixed/i);
    expect(propagated.conditionalOn.join(' ')).toMatch(/reference radius held fixed/i);
    expect(propagated.conditionalOn.join(' ')).toMatch(/mean molar mass\/composition held fixed/i);
  });
});
