import { describe, expect, it } from 'vitest';
import {
  MARS_GAS_PHASE_SPECIES_ELEMENTS,
  MARS_TAYSUM_2020_GAS_PHASE_PROVENANCE,
  MARS_TAYSUM_2020_GAS_PHASE_REACTIONS,
  evaluateMarsGasPhaseReaction,
  validateMarsGasPhaseReactionBalance
} from '../Data/marsGasPhaseKinetics';
import type { MarsGasSpeciesId } from '../Data/marsGasPhaseKinetics';

const density = (values: Record<string, number>) =>
  values as Readonly<Partial<Record<MarsGasSpeciesId, number>>>;

describe('Mars Taysum & Palmer 2020 gas-phase kinetics evidence', () => {
  it('preserves all 32 Appendix Table B1 records and distinguishes evaluable from unresolved laws', () => {
    expect(MARS_TAYSUM_2020_GAS_PHASE_REACTIONS).toHaveLength(32);
    expect(MARS_TAYSUM_2020_GAS_PHASE_REACTIONS.filter(
      (reaction) => reaction.rateExpression.kind === 'arrhenius' ||
        reaction.rateExpression.kind === 'termolecular_arrhenius'
    )).toHaveLength(29);
    expect(MARS_TAYSUM_2020_GAS_PHASE_REACTIONS.filter(
      (reaction) => reaction.rateExpression.kind === 'falloff_not_evaluated'
    ).map((reaction) => reaction.id)).toEqual(['c11', 'c17']);
    expect(MARS_TAYSUM_2020_GAS_PHASE_REACTIONS.find(
      (reaction) => reaction.id === 'e1'
    )?.rateExpression.kind).toBe('single_temperature_value');

    expect(MARS_TAYSUM_2020_GAS_PHASE_PROVENANCE.sourceId).toBe('DOI:10.1029/2020JE006491');
    expect(MARS_TAYSUM_2020_GAS_PHASE_PROVENANCE.conditions).toMatch(/CO2 is the bath gas/);
    expect(MARS_TAYSUM_2020_GAS_PHASE_PROVENANCE.limitations).toMatch(/no numerical 1-sigma/);
  });

  it('all 32 published reaction stoichiometries conserve C, H and O atoms', () => {
    expect(Object.keys(MARS_GAS_PHASE_SPECIES_ELEMENTS)).toHaveLength(16);
    for (const reaction of MARS_TAYSUM_2020_GAS_PHASE_REACTIONS) {
      expect(validateMarsGasPhaseReactionBalance(reaction), reaction.id).toEqual([]);
    }
  });

  it('reproduces all 24 bimolecular Table B1 rates at the independently tabulated 298 K', () => {
    const bimolecularRows = MARS_TAYSUM_2020_GAS_PHASE_REACTIONS.filter(
      (reaction) =>
        reaction.thirdBody === null &&
        reaction.rateExpression.kind === 'arrhenius'
    );
    expect(bimolecularRows).toHaveLength(24);

    for (const reaction of bimolecularRows) {
      if (reaction.rateExpression.kind !== 'arrhenius') {
        throw new Error('expected an Arrhenius expression for ' + reaction.id);
      }
      if (reaction.publishedRateAt298 === undefined) {
        throw new Error('missing independent 298 K rate for ' + reaction.id);
      }
      const expression = reaction.rateExpression;
      const calculated =
        expression.preExponentialA *
        Math.pow(298 / expression.temperatureScaleK, expression.temperatureExponentN) *
        Math.exp(expression.exponentialTemperatureK / 298);
      const relativeDifference =
        Math.abs(calculated - reaction.publishedRateAt298) / reaction.publishedRateAt298;
      expect(relativeDifference, reaction.id).toBeLessThanOrEqual(0.01);
    }
  });

  it('evaluates a bimolecular Arrhenius law and the concentration-based event rate', () => {
    const result = evaluateMarsGasPhaseReaction({
      reactionId: 'a3',
      temperatureK: 250,
      concentrationsPerCm3: density({ O: 2e9, O3: 3e8 })
    });
    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') throw new Error(result.reason);

    const expectedK = 8e-13 * Math.exp(-2060 / 250);
    expect(result.rateConstant).toBeCloseTo(expectedK, 14);
    expect(result.rateConstantUnit).toBe('cm3_molecule_s');
    expect(result.eventRatePerCm3PerS).toBeCloseTo(expectedK * 2e9 * 3e8, 12);
    expect(result.netSpeciesRatesPerCm3PerS.O).toBeCloseTo(-result.eventRatePerCm3PerS, 12);
    expect(result.netSpeciesRatesPerCm3PerS.O3).toBeCloseTo(-result.eventRatePerCm3PerS, 12);
    expect(result.netSpeciesRatesPerCm3PerS.O2).toBeCloseTo(2 * result.eventRatePerCm3PerS, 12);
    expect(result.temperatureValidity).toBe('source_interval_not_published');
    expect(result.uncertaintyStatus).toBe('not_quantified');
  });

  it('requires explicit local CO2 density for Mars termolecular reactions', () => {
    const missing = evaluateMarsGasPhaseReaction({
      reactionId: 'a1',
      temperatureK: 200,
      concentrationsPerCm3: density({ O: 1e9, O2: 2e10 })
    });
    expect(missing).toEqual({ status: 'rejected', reason: 'missing_co2_third_body' });

    const result = evaluateMarsGasPhaseReaction({
      reactionId: 'a1',
      temperatureK: 200,
      concentrationsPerCm3: density({ O: 1e9, O2: 2e10 }),
      co2ThirdBodyConcentrationPerCm3: 1e17
    });
    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') throw new Error(result.reason);

    const expectedK = 2.075 * 6e-34 * Math.pow(200 / 300, -2.4);
    expect(result.rateConstant).toBeCloseTo(expectedK, 14);
    expect(result.rateConstantUnit).toBe('cm6_molecule2_s');
    expect(result.co2ThirdBodyConcentrationPerCm3).toBe(1e17);
    expect(result.eventRatePerCm3PerS).toBeCloseTo(expectedK * 1e9 * 2e10 * 1e17, 12);

    const noCollider = evaluateMarsGasPhaseReaction({
      reactionId: 'a2',
      temperatureK: 250,
      concentrationsPerCm3: density({ O: 1e9 }),
      co2ThirdBodyConcentrationPerCm3: 0
    });
    expect(noCollider.status).toBe('evaluated');
    if (noCollider.status !== 'evaluated') throw new Error(noCollider.reason);
    expect(noCollider.eventRatePerCm3PerS).toBe(0);
  });

  it('preserves special k_3rd records as unevaluated instead of guessing their fall-off convention', () => {
    for (const id of ['c11', 'c17']) {
      expect(evaluateMarsGasPhaseReaction({
        reactionId: id,
        temperatureK: 200,
        concentrationsPerCm3: density({ H: 1e8, O2: 1e10, OH: 1e8 }),
        co2ThirdBodyConcentrationPerCm3: 1e17
      })).toEqual({ status: 'rejected', reason: 'unsupported_falloff_expression' });
    }

    const c11 = MARS_TAYSUM_2020_GAS_PHASE_REACTIONS.find((reaction) => reaction.id === 'c11');
    expect(c11?.rateExpression.kind).toBe('falloff_not_evaluated');
    if (c11?.rateExpression.kind !== 'falloff_not_evaluated') throw new Error('missing c11 fall-off metadata');
    expect(c11.rateExpression.publishedFormula).toMatch(/k_3rd/);
    expect(c11.rateExpression.reason).toMatch(/2.5/);
  });

  it('evaluates the e1 single-point rate only at the published 298 K value', () => {
    const outside = evaluateMarsGasPhaseReaction({
      reactionId: 'e1',
      temperatureK: 250,
      concentrationsPerCm3: density({ OH: 1e8, CO: 2e10 })
    });
    expect(outside).toEqual({ status: 'rejected', reason: 'temperature_not_supported' });

    const at298 = evaluateMarsGasPhaseReaction({
      reactionId: 'e1',
      temperatureK: 298,
      concentrationsPerCm3: density({ OH: 1e8, CO: 2e10 })
    });
    expect(at298.status).toBe('evaluated');
    if (at298.status !== 'evaluated') throw new Error(at298.reason);
    expect(at298.rateConstant).toBe(1.47e-13);
    expect(at298.eventRatePerCm3PerS).toBeCloseTo(1.47e-13 * 1e8 * 2e10, 12);
  });

  it('rejects missing, negative, non-finite concentrations and invalid temperatures', () => {
    expect(evaluateMarsGasPhaseReaction({
      reactionId: 'c1',
      temperatureK: 250,
      concentrationsPerCm3: density({ O: 1e8 })
    })).toEqual({ status: 'rejected', reason: 'missing_reactant_concentration' });

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateMarsGasPhaseReaction({
        reactionId: 'c1',
        temperatureK: 250,
        concentrationsPerCm3: density({ O: 1e8, HO2: bad })
      })).toEqual({ status: 'rejected', reason: 'invalid_reactant_concentration' });
    }

    expect(evaluateMarsGasPhaseReaction({
      reactionId: 'c1',
      temperatureK: 0,
      concentrationsPerCm3: density({ O: 1e8, HO2: 1e8 })
    })).toEqual({ status: 'rejected', reason: 'invalid_temperature' });

    expect(evaluateMarsGasPhaseReaction({
      reactionId: 'unknown',
      temperatureK: 250,
      concentrationsPerCm3: density({ O: 1e8, HO2: 1e8 })
    })).toEqual({ status: 'rejected', reason: 'unknown_reaction' });
  });

  it('preserves catalytic CO2 and O2 reactant/product species as zero-net species', () => {
    const result = evaluateMarsGasPhaseReaction({
      reactionId: 'b1',
      temperatureK: 200,
      concentrationsPerCm3: density({ O1D: 2e8, CO2: 1e17 })
    });
    expect(result.status).toBe('evaluated');
    if (result.status !== 'evaluated') throw new Error(result.reason);
    expect(result.netSpeciesRatesPerCm3PerS.O1D).toBeCloseTo(-result.eventRatePerCm3PerS, 12);
    expect(result.netSpeciesRatesPerCm3PerS.O).toBeCloseTo(result.eventRatePerCm3PerS, 12);
    expect(result.netSpeciesRatesPerCm3PerS.CO2).toBe(0);
  });
});
