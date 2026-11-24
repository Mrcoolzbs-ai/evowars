import { describe, expect, it } from 'vitest';
import {
  MARS_PHOTOCHEMICAL_SPECIES_ORDER,
  MarsPhotochemicalNetworkError,
  buildMarsPhotochemicalNetworkProblem,
  runMarsPhotochemicalConcentrationStep
} from '../ChemicalEvolution/marsPhotochemicalNetwork';
import type {
  MarsPhotochemicalInitialConcentrations,
  MarsPhotochemicalNetworkInput
} from '../ChemicalEvolution/marsPhotochemicalNetwork';
import {
  MARS_TAYSUM_2020_GAS_PHASE_REACTIONS
} from '../Data/marsGasPhaseKinetics';
import {
  MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS
} from '../Data/marsPhotochemistryEvidence';
import type { MarsGasSpeciesId } from '../Data/marsGasPhaseKinetics';
import type { DataProvenance } from '../Core/scientificValue';

const INITIAL: MarsPhotochemicalInitialConcentrations = {
  O: 2e7,
  O1D: 2e3,
  O2: 4e10,
  O3: 1e7,
  CO2: 2e17,
  CO: 1e8,
  H: 1e4,
  H2: 1e9,
  H2O: 1e8,
  OH: 2e4,
  HO2: 1e5,
  H2O2: 1e5,
  CH4: 1e7,
  CH3: 1e2,
  CH3O: 1e2,
  HCHO: 1e3
};

const STATE_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic test fixture — explicit 16-species state',
  sourceId: 'evowars/tests/mars-network/initial-state',
  method: 'synthetic test data only; not an observation'
};

const TEMPERATURE_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic test fixture — explicit temperature',
  sourceId: 'evowars/tests/mars-network/temperature',
  method: 'synthetic test data only; not an observation'
};

function input(overrides: Partial<MarsPhotochemicalNetworkInput> = {}): MarsPhotochemicalNetworkInput {
  return {
    temperatureK: 220,
    temperatureProvenance: TEMPERATURE_PROVENANCE,
    altitudeKm: 0.5,
    gasPhaseReactionIds: ['c4'],
    photolysisReactionIds: ['ho2_photolysis'],
    dtSeconds: 1,
    initialConcentrationsPerCm3: { ...INITIAL },
    initialStateProvenance: STATE_PROVENANCE,
    ...overrides
  };
}

function totalElement(state: MarsPhotochemicalInitialConcentrations, element: 'C' | 'H' | 'O'): number {
  const atoms: Readonly<Record<MarsGasSpeciesId, Readonly<Record<string, number>>>> = {
    O: { O: 1 }, O1D: { O: 1 }, O2: { O: 2 }, O3: { O: 3 },
    CO2: { C: 1, O: 2 }, CO: { C: 1, O: 1 }, H: { H: 1 },
    H2: { H: 2 }, H2O: { H: 2, O: 1 }, OH: { O: 1, H: 1 },
    HO2: { H: 1, O: 2 }, H2O2: { H: 2, O: 2 }, CH4: { C: 1, H: 4 },
    CH3: { C: 1, H: 3 }, CH3O: { C: 1, H: 3, O: 1 }, HCHO: { C: 1, H: 2, O: 1 }
  };
  return Object.entries(state).reduce((sum, [id, value]) =>
    sum + value * (atoms[id as MarsGasSpeciesId][element] ?? 0), 0);
}

describe('Mars single-compartment source-backed photochemical network', () => {
  it('builds one 16-species ODE with explicit initial state, provenance and combined gas/photo forcing', () => {
    const built = buildMarsPhotochemicalNetworkProblem(input());
    expect(MARS_PHOTOCHEMICAL_SPECIES_ORDER).toHaveLength(16);
    expect(built.problem.stateDimension).toBe(16);
    expect(built.problem.t0).toBe(0);
    expect(built.problem.tEnd).toBe(1);
    expect(built.reactions.map((reaction) => reaction.id)).toEqual(['c4', 'ho2_photolysis']);
    expect(built.inputProvenance.initialState.sourceId).toBe(STATE_PROVENANCE.sourceId);
    expect(built.problem.linearInvariants).toHaveLength(3);

    const y = built.problem.y0;
    const dy = built.problem.rhs(0, y);
    const i = (species: MarsGasSpeciesId) => built.speciesOrder.indexOf(species);
    expect(dy[i('HO2')]).toBeCloseTo(-24.072, 10);
    expect(dy[i('H')]).toBeCloseTo(-0.072, 10);
    expect(dy[i('OH')]).toBeCloseTo(24.144, 10);
    expect(dy[i('O')]).toBeCloseTo(24, 10);
  });

  it('analytical Jacobian agrees with independent central differences', () => {
    const built = buildMarsPhotochemicalNetworkProblem(input());
    const y = [...built.problem.y0];
    const jacobian = built.problem.jacobian?.(0, y);
    if (jacobian === undefined) throw new Error('analytical Jacobian missing');
    const n = y.length;
    const iH = built.speciesOrder.indexOf('H');
    const iHo2 = built.speciesOrder.indexOf('HO2');
    const h = 1e-2;

    for (const column of [iH, iHo2]) {
      const plus = [...y];
      const minus = [...y];
      plus[column] += h;
      minus[column] -= h;
      const fPlus = built.problem.rhs(0, plus);
      const fMinus = built.problem.rhs(0, minus);
      for (let row = 0; row < n; row++) {
        const finiteDifference = (fPlus[row] - fMinus[row]) / (2 * h);
        expect(jacobian[row][column]).toBeCloseTo(finiteDifference, 5);
      }
    }
  });

  it('integrates gas and photolysis source/sink rates without negative values or element drift', () => {
    const start = { ...INITIAL };
    const result = runMarsPhotochemicalConcentrationStep(input());
    expect(result.status).toBe('applied');
    expect(result.method).toMatch(/Radau/i);
    expect(result.reactions).toHaveLength(2);

    for (const species of MARS_PHOTOCHEMICAL_SPECIES_ORDER) {
      expect(Number.isFinite(result.finalConcentrationsPerCm3[species])).toBe(true);
      expect(result.finalConcentrationsPerCm3[species]).toBeGreaterThanOrEqual(0);
    }
    for (const element of ['C', 'H', 'O'] as const) {
      const before = totalElement(start, element);
      const after = totalElement(result.finalConcentrationsPerCm3, element);
      expect(after).toBeCloseTo(before, 7);
    }
    expect(result.finalConcentrationsPerCm3.HO2).toBeLessThan(start.HO2);
    expect(result.finalConcentrationsPerCm3.O).toBeGreaterThan(start.O);
    expect(result.finalConcentrationsPerCm3.CO2).toBeCloseTo(start.CO2, 6);
  });

  it('builds and integrates every explicitly evaluable B1 and B2 channel in the source-backed subset', () => {
    const gasPhaseReactionIds = MARS_TAYSUM_2020_GAS_PHASE_REACTIONS
      .filter((reaction) => reaction.rateExpression.kind !== 'falloff_not_evaluated')
      .map((reaction) => reaction.id);
    const photolysisReactionIds = MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS.map(
      (reaction) => reaction.id
    );
    const completeFixture = Object.fromEntries(
      MARS_PHOTOCHEMICAL_SPECIES_ORDER.map((species) => [species, 1e3])
    ) as MarsPhotochemicalInitialConcentrations;

    const built = buildMarsPhotochemicalNetworkProblem(input({
      temperatureK: 298,
      altitudeKm: 0.5,
      gasPhaseReactionIds,
      photolysisReactionIds,
      dtSeconds: 1,
      initialConcentrationsPerCm3: completeFixture
    }));
    expect(gasPhaseReactionIds).toHaveLength(30);
    expect(photolysisReactionIds).toHaveLength(9);
    expect(built.reactions).toHaveLength(39);
    expect(built.problem.stateDimension).toBe(16);

    const result = runMarsPhotochemicalConcentrationStep(input({
      temperatureK: 298,
      altitudeKm: 0.5,
      gasPhaseReactionIds,
      photolysisReactionIds,
      dtSeconds: 1,
      initialConcentrationsPerCm3: completeFixture
    }));
    expect(result.reactions).toHaveLength(39);
    for (const species of MARS_PHOTOCHEMICAL_SPECIES_ORDER) {
      expect(Number.isFinite(result.finalConcentrationsPerCm3[species])).toBe(true);
      expect(result.finalConcentrationsPerCm3[species]).toBeGreaterThanOrEqual(0);
    }
    for (const element of ['C', 'H', 'O'] as const) {
      expect(
        totalElement(result.finalConcentrationsPerCm3, element)
      ).toBeCloseTo(totalElement(completeFixture, element), 7);
    }
  });

  it('uses the dynamic CO2 state as the explicit third body for selected termolecular reactions', () => {
    const built = buildMarsPhotochemicalNetworkProblem(input({
      gasPhaseReactionIds: ['a1'],
      photolysisReactionIds: []
    }));
    const i = (species: MarsGasSpeciesId) => built.speciesOrder.indexOf(species);
    const derivative = built.problem.rhs(0, built.problem.y0);
    expect(derivative[i('O')]).toBeLessThan(0);
    expect(derivative[i('O2')]).toBeLessThan(0);
    expect(derivative[i('O3')]).toBeGreaterThan(0);
    expect(derivative[i('CO2')]).toBe(0);
  });

  it('fails closed for unresolved fall-off rows and e1 outside its single 298 K datum', () => {
    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      gasPhaseReactionIds: ['c11'],
      photolysisReactionIds: []
    }))).toThrowError(MarsPhotochemicalNetworkError);
    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      gasPhaseReactionIds: ['e1'],
      photolysisReactionIds: []
    }))).toThrowError(MarsPhotochemicalNetworkError);
    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      temperatureK: 298,
      gasPhaseReactionIds: ['e1'],
      photolysisReactionIds: []
    }))).not.toThrow();
  });

  it('requires exact complete state, explicit provenance, selected reactions and positive CO2 for termolecular kinetics', () => {
    const missing: Record<string, number> = { ...INITIAL };
    delete missing.HO2;
    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      initialConcentrationsPerCm3: missing as unknown as MarsPhotochemicalInitialConcentrations
    }))).toThrowError(/missing=HO2/);

    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      initialStateProvenance: {}
    }))).toThrowError(/provenance/);

    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      temperatureProvenance: {}
    }))).toThrowError(/provenance/);

    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      gasPhaseReactionIds: [],
      photolysisReactionIds: []
    }))).toThrowError(/at least one/);

    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      gasPhaseReactionIds: ['a1'],
      photolysisReactionIds: [],
      initialConcentrationsPerCm3: { ...INITIAL, CO2: 0 }
    }))).toThrowError(/strictly positive initial CO2/);
  });

  it('rejects unsupported photolysis altitude, unknown IDs and invalid initial concentrations', () => {
    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      altitudeKm: 10 as unknown as 0.5
    }))).toThrowError(/exact Table B2 node/);

    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      gasPhaseReactionIds: ['not-a-reaction'],
      photolysisReactionIds: []
    }))).toThrowError(/unknown gas-phase/);

    expect(() => buildMarsPhotochemicalNetworkProblem(input({
      initialConcentrationsPerCm3: { ...INITIAL, O: -1 }
    }))).toThrowError(/finite non-negative/);
  });

  it('does not mutate the supplied initial concentration object', () => {
    const values = { ...INITIAL };
    const before = { ...values };
    runMarsPhotochemicalConcentrationStep(input({
      initialConcentrationsPerCm3: values
    }));
    expect(values).toEqual(before);
  });
});
