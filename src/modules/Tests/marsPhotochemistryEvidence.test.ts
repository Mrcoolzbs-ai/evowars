import { describe, expect, it } from 'vitest';
import {
  MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS,
  MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE,
  evaluateMarsPhotolysisAtReferenceNode
} from '../Data/marsPhotochemistryEvidence';
import type { DataProvenance } from '../Core/scientificValue';

const DENSITY_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic test fixture: explicitly supplied local reactant density',
  sourceId: 'evowars/tests/mars-photolysis/density-fixture',
  method: 'test fixture only'
};

describe('Mars Taysum 2020 photolysis evidence', () => {
  it('preserves the nine published Table B2 channels and both exact altitude nodes', () => {
    expect(MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS).toHaveLength(9);
    expect(MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS.every(
      (channel) => channel.referenceNodes.map((node) => node.altitudeKm).join(',') === '0.5,42.67'
    )).toBe(true);

    const co2 = MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS.find(
      (channel) => channel.id === 'co2_photolysis_to_co_o'
    );
    expect(co2?.referenceNodes.map((node) => node.photolysisFrequencyPerS)).toEqual([
      3.79e-12,
      1.02e-10
    ]);
    expect(MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE.conditions).toMatch(/solar zenith angle 0 degrees/);
    expect(MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE.conditions).toMatch(/Ls=251 degrees/);
    expect(MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE.limitations).toMatch(/not observations/);
    expect(MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE.limitations).toMatch(/no interpolation/);
    expect(MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE.note).toMatch(/nine channels/);
  });

  it('calculates local CO2 photolysis event and species rates as J × n', () => {
    const result = evaluateMarsPhotolysisAtReferenceNode({
      reactionId: 'co2_photolysis_to_co_o',
      altitudeKm: 0.5,
      reactantNumberDensityPerCm3: 2e10,
      reactantDensityProvenance: DENSITY_PROVENANCE
    });
    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') throw new Error(result.reason);

    expect(result.photolysisFrequencyPerS).toBe(3.79e-12);
    expect(result.eventRatePerCm3PerS).toBeCloseTo(0.0758, 14);
    expect(result.netSpeciesRatesPerCm3PerS.co2).toBeCloseTo(-0.0758, 14);
    expect(result.netSpeciesRatesPerCm3PerS.co).toBeCloseTo(0.0758, 14);
    expect(result.netSpeciesRatesPerCm3PerS.o).toBeCloseTo(0.0758, 14);
    expect(result.provenance.reactantDensity.sourceId).toBe(DENSITY_PROVENANCE.sourceId);
    expect(result.provenance.photolysis.sourceId).toBe('DOI:10.1029/2020JE006491');
    expect(result.uncertaintyStatus).toBe('not_quantified');
    expect(result.schedulerEligible).toBe(false);
  });

  it('uses the exact upper reference node and retains published zero-frequency channels', () => {
    const upper = evaluateMarsPhotolysisAtReferenceNode({
      reactionId: 'ho2_photolysis',
      altitudeKm: 42.67,
      reactantNumberDensityPerCm3: 4e7,
      reactantDensityProvenance: DENSITY_PROVENANCE
    });
    expect(upper.status).toBe('evaluated');
    if (upper.status !== 'evaluated') throw new Error(upper.reason);
    expect(upper.photolysisFrequencyPerS).toBe(3.2e-4);
    expect(upper.eventRatePerCm3PerS).toBe(1.28e4);
    expect(upper.netSpeciesRatesPerCm3PerS.ho2).toBe(-1.28e4);
    expect(upper.netSpeciesRatesPerCm3PerS.o).toBe(1.28e4);
    expect(upper.netSpeciesRatesPerCm3PerS.oh).toBe(1.28e4);

    const zero = evaluateMarsPhotolysisAtReferenceNode({
      reactionId: 'o2_photolysis_to_o1d',
      altitudeKm: 0.5,
      reactantNumberDensityPerCm3: 8e9,
      reactantDensityProvenance: DENSITY_PROVENANCE
    });
    expect(zero.status).toBe('evaluated');
    if (zero.status !== 'evaluated') throw new Error(zero.reason);
    expect(zero.photolysisFrequencyPerS).toBe(0);
    expect(zero.eventRatePerCm3PerS).toBe(0);
    expect(zero.netSpeciesRatesPerCm3PerS.o2).toBe(0);
    expect(zero.netSpeciesRatesPerCm3PerS.o).toBe(0);
    expect(zero.netSpeciesRatesPerCm3PerS.o1d).toBe(0);
  });

  it('fails closed for unknown channels, off-grid altitude and invalid density', () => {
    expect(evaluateMarsPhotolysisAtReferenceNode({
      reactionId: 'not-in-table',
      altitudeKm: 0.5,
      reactantNumberDensityPerCm3: 1,
      reactantDensityProvenance: DENSITY_PROVENANCE
    })).toEqual({ status: 'rejected', reason: 'unknown_reaction' });

    expect(evaluateMarsPhotolysisAtReferenceNode({
      reactionId: 'co2_photolysis_to_co_o',
      altitudeKm: 20,
      reactantNumberDensityPerCm3: 1,
      reactantDensityProvenance: DENSITY_PROVENANCE
    })).toEqual({ status: 'rejected', reason: 'unsupported_altitude' });

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateMarsPhotolysisAtReferenceNode({
        reactionId: 'co2_photolysis_to_co_o',
        altitudeKm: 0.5,
        reactantNumberDensityPerCm3: bad,
        reactantDensityProvenance: DENSITY_PROVENANCE
      })).toEqual({ status: 'rejected', reason: 'invalid_density' });
    }
  });

  it('requires identified provenance for the reactant density', () => {
    const result = evaluateMarsPhotolysisAtReferenceNode({
      reactionId: 'h2o_photolysis',
      altitudeKm: 42.67,
      reactantNumberDensityPerCm3: 3e8,
      reactantDensityProvenance: { sourceName: 'unreferenced density' }
    });
    expect(result).toEqual({ status: 'rejected', reason: 'missing_density_provenance' });
  });
});
