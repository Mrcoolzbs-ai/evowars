import { describe, expect, it } from 'vitest';
import {
  MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS,
  MARS_TAYSUM_2020_INORGANIC_EXCLUDED_REACTIONS,
  evaluateMarsInorganicBimolecularReaction
} from '../Data/marsInorganicGasPhaseEvidence';
import type {
  MarsInorganicSpeciesId
} from '../Data/marsInorganicGasPhaseEvidence';
import type { DataProvenance } from '../Core/scientificValue';

const provenance = (speciesId: string): DataProvenance => ({
  sourceName: 'synthetic unit-test density fixture',
  sourceId: 'test:mars-gas-phase-density:' + speciesId,
  method: 'synthetic test fixture only'
});

const allConcentrations: Record<MarsInorganicSpeciesId, number> = {
  O: 2e8,
  O1D: 3e7,
  O2: 4e16,
  O3: 5e9,
  H: 6e7,
  OH: 7e8,
  HO2: 8e8,
  H2: 9e10,
  H2O: 1e12,
  H2O2: 2e8,
  CO: 3e12,
  CO2: 4e16,
  CH4: 5e8,
  CH3: 6e7,
  CH3O: 7e7,
  HCHO: 8e7
};

const allProvenance = Object.fromEntries(
  Object.keys(allConcentrations).map((speciesId) => [speciesId, provenance(speciesId)])
) as Record<MarsInorganicSpeciesId, DataProvenance>;

describe('Taysum & Palmer 2020 Table B1 inorganic bimolecular evidence', () => {
  it('imports exactly the 24 explicit bimolecular rate laws and audits all other B1 rows', () => {
    expect(MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS).toHaveLength(24);
    expect(MARS_TAYSUM_2020_INORGANIC_EXCLUDED_REACTIONS).toHaveLength(8);
    expect(MARS_TAYSUM_2020_INORGANIC_EXCLUDED_REACTIONS.filter(
      (row) => row.reason === 'termolecular_CO2_bath_gas_not_modelled'
    )).toHaveLength(7);
    expect(MARS_TAYSUM_2020_INORGANIC_EXCLUDED_REACTIONS.find(
      (row) => row.tableKey === 'e1'
    )?.reason).toBe('rate_law_not_tabulated');
    expect(new Set(MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS.map(
      (row) => row.tableKey
    )).size).toBe(24);
  });

  it('reproduces the independently tabulated 298 K rate constants', () => {
    for (const reaction of MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS) {
      const actual = reaction.rate.preExponentialA *
        Math.exp(reaction.rate.exponentNumeratorK / 298);
      const expected = reaction.rate.publishedRateAt298K;
      expect(Math.abs(actual - expected) / expected, reaction.tableKey).toBeLessThanOrEqual(0.01);
    }
  });

  it('keeps every imported reaction element-balanced', () => {
    const composition: Readonly<Record<MarsInorganicSpeciesId, Readonly<Record<string, number>>>> = {
      O: { O: 1 },
      O1D: { O: 1 },
      O2: { O: 2 },
      O3: { O: 3 },
      H: { H: 1 },
      OH: { H: 1, O: 1 },
      HO2: { H: 1, O: 2 },
      H2: { H: 2 },
      H2O: { H: 2, O: 1 },
      H2O2: { H: 2, O: 2 },
      CO: { C: 1, O: 1 },
      CO2: { C: 1, O: 2 },
      CH4: { C: 1, H: 4 },
      CH3: { C: 1, H: 3 },
      CH3O: { C: 1, H: 3, O: 1 },
      HCHO: { C: 1, H: 2, O: 1 }
    };

    for (const reaction of MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS) {
      const balance: Record<string, number> = {};
      for (const speciesId of reaction.reactants) {
        for (const [element, count] of Object.entries(composition[speciesId])) {
          balance[element] = (balance[element] ?? 0) - count;
        }
      }
      for (const product of reaction.products) {
        for (const [element, count] of Object.entries(composition[product.speciesId])) {
          balance[element] = (balance[element] ?? 0) + product.coefficient * count;
        }
      }
      expect(Object.values(balance).every((value) => value === 0), reaction.tableKey).toBe(true);
    }
  });

  it('evaluates a b1 collision partner with zero net CO2 source/sink', () => {
    const result = evaluateMarsInorganicBimolecularReaction({
      reactionId: 'taysum2020-b1-b1',
      temperatureK: 298,
      concentrationsPerCm3: { O1D: 1e7, CO2: 4e16 },
      concentrationProvenance: { O1D: provenance('O1D'), CO2: provenance('CO2') }
    });
    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') throw new Error(result.reason);
    expect(result.rateConstantCm3PerMoleculePerS).toBeCloseTo(1.11e-10, 12);
    expect(result.netSpeciesRatesPerCm3PerS.O1D).toBeLessThan(0);
    expect(result.netSpeciesRatesPerCm3PerS.O).toBeGreaterThan(0);
    expect(result.netSpeciesRatesPerCm3PerS.CO2).toBe(0);
    expect(result.schedulerEligible).toBe(false);
    expect(result.uncertaintyStatus).toBe('not_quantified');
  });

  it('evaluates repeated reactants as [A] squared and preserves branch channels separately', () => {
    const repeated = evaluateMarsInorganicBimolecularReaction({
      reactionId: 'taysum2020-b1-c8',
      temperatureK: 298,
      concentrationsPerCm3: { HO2: 2e8 },
      concentrationProvenance: { HO2: provenance('HO2') }
    });
    expect(repeated.status).toBe('evaluated');
    if (repeated.status !== 'evaluated') throw new Error(repeated.reason);
    expect(repeated.eventRatePerCm3PerS).toBeCloseTo(
      repeated.rateConstantCm3PerMoleculePerS * (2e8 ** 2), 8
    );
    expect(repeated.netSpeciesRatesPerCm3PerS.HO2)
      .toBeCloseTo(-2 * repeated.eventRatePerCm3PerS, 8);

    const branchIds = ['b7', 'b8', 'b9'].map((key) =>
      MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS.find((row) => row.tableKey === key)?.id
    );
    expect(branchIds.every((id) => typeof id === 'string')).toBe(true);
    const branchSum = MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS
      .filter((row) => ['b7', 'b8', 'b9'].includes(row.tableKey))
      .reduce((sum, row) => sum + row.rate.preExponentialA, 0);
    expect(branchSum).toBeCloseTo(1.75e-10, 18);
  });

  it('fails closed on absent/invalid concentrations and absent per-species provenance', () => {
    expect(evaluateMarsInorganicBimolecularReaction({
      reactionId: 'taysum2020-b1-a3',
      temperatureK: 298,
      concentrationsPerCm3: { O: 2e8 },
      concentrationProvenance: { O: provenance('O') }
    })).toEqual({ status: 'rejected', reason: 'missing_concentration', speciesId: 'O3' });

    expect(evaluateMarsInorganicBimolecularReaction({
      reactionId: 'taysum2020-b1-a3',
      temperatureK: 298,
      concentrationsPerCm3: { O: 2e8, O3: -1 },
      concentrationProvenance: { O: provenance('O'), O3: provenance('O3') }
    })).toEqual({ status: 'rejected', reason: 'invalid_concentration', speciesId: 'O3' });

    expect(evaluateMarsInorganicBimolecularReaction({
      reactionId: 'taysum2020-b1-a3',
      temperatureK: 298,
      concentrationsPerCm3: { O: 2e8, O3: 1e9 },
      concentrationProvenance: { O: provenance('O') }
    })).toEqual({ status: 'rejected', reason: 'missing_concentration_provenance', speciesId: 'O3' });
  });

  it('rejects malformed runtime objects rather than throwing', () => {
    expect(evaluateMarsInorganicBimolecularReaction(null as unknown as Parameters<
      typeof evaluateMarsInorganicBimolecularReaction
    >[0])).toEqual({ status: 'rejected', reason: 'invalid_input' });

    expect(evaluateMarsInorganicBimolecularReaction({
      reactionId: 'taysum2020-b1-a3',
      temperatureK: 298,
      concentrationsPerCm3: null as unknown as Record<string, number>,
      concentrationProvenance: allProvenance
    })).toEqual({ status: 'rejected', reason: 'invalid_input' });
  });

  it('rejects unsupported reaction IDs and non-positive temperatures', () => {
    expect(evaluateMarsInorganicBimolecularReaction({
      reactionId: 'unknown',
      temperatureK: 298,
      concentrationsPerCm3: allConcentrations,
      concentrationProvenance: allProvenance
    })).toEqual({ status: 'rejected', reason: 'unknown_reaction' });

    for (const temperatureK of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateMarsInorganicBimolecularReaction({
        reactionId: 'taysum2020-b1-c1',
        temperatureK,
        concentrationsPerCm3: allConcentrations,
        concentrationProvenance: allProvenance
      })).toEqual({ status: 'rejected', reason: 'invalid_temperature' });
    }
  });
});
