import { describe, expect, it } from 'vitest';
import {
  MARS_INORGANIC_SPECIES_ORDER,
  MarsInorganicMechanismError,
  runMarsInorganicBimolecularMechanism
} from '../ChemicalEvolution/marsInorganicMechanism';
import {
  MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS
} from '../Data/marsInorganicGasPhaseEvidence';
import type { MarsInorganicSpeciesId } from '../Data/marsInorganicGasPhaseEvidence';
import type { DataProvenance } from '../Core/scientificValue';

const initialConcentrations = (): Record<MarsInorganicSpeciesId, number> =>
  Object.fromEntries(
    MARS_INORGANIC_SPECIES_ORDER.map((speciesId) => [speciesId, 1e5])
  ) as Record<MarsInorganicSpeciesId, number>;

const concentrationProvenance = (): Record<MarsInorganicSpeciesId, DataProvenance> =>
  Object.fromEntries(
    MARS_INORGANIC_SPECIES_ORDER.map((speciesId) => [speciesId, {
      sourceName: 'explicit synthetic ODE test fixture; not a planetary atmosphere',
      sourceId: 'test:mars-inorganic-ode:' + speciesId,
      method: 'synthetic unit-test initial condition'
    }])
  ) as Record<MarsInorganicSpeciesId, DataProvenance>;

const allReactionIds = MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS.map(
  (reaction) => reaction.id
);

function runError(fn: () => unknown): MarsInorganicMechanismError {
  try {
    fn();
  } catch (error) {
    if (error instanceof MarsInorganicMechanismError) return error;
    throw new Error('Expected MarsInorganicMechanismError, got ' + String(error));
  }
  throw new Error('Expected MarsInorganicMechanismError but mechanism completed');
}

describe('Mars inorganic B1 chemistry: Radau IIA integration', () => {
  it('integrates one sourced b2 reaction with an analytic solver and conserves C/H/O', () => {
    const concentrations = initialConcentrations();
    concentrations.O1D = 2e5;
    concentrations.H2O = 3e5;
    concentrations.OH = 1e4;
    const provenance = concentrationProvenance();
    const original = structuredClone(concentrations);

    const result = runMarsInorganicBimolecularMechanism({
      temperatureK: 298,
      durationSeconds: 1000,
      initialConcentrationsPerCm3: concentrations,
      concentrationProvenance: provenance,
      reactionIds: ['taysum2020-b1-b2']
    });

    expect(result.status).toBe('applied');
    expect(result.reactions).toHaveLength(1);
    expect(result.reactions[0].tableKey).toBe('b2');
    expect(result.integration.result.status).toBe('solved');
    expect(result.integration.result.stats.jacobianEvaluations).toBeGreaterThan(0);
    expect(result.finalConcentrationsPerCm3.O1D).toBeLessThan(concentrations.O1D);
    expect(result.finalConcentrationsPerCm3.H2O).toBeLessThan(concentrations.H2O);
    expect(result.finalConcentrationsPerCm3.OH).toBeGreaterThan(concentrations.OH);
    expect(concentrations).toEqual(original);

    for (const budget of result.elementBudgets) {
      expect(Math.abs(budget.relativeDrift), budget.element).toBeLessThanOrEqual(1e-8);
    }
    expect(result.limitations.join(' ')).toMatch(/Photolysis Table B2 is not coupled/);
  });

  it('integrates the complete 24-channel bimolecular subset without negative species', () => {
    const result = runMarsInorganicBimolecularMechanism({
      temperatureK: 298,
      durationSeconds: 1,
      initialConcentrationsPerCm3: initialConcentrations(),
      concentrationProvenance: concentrationProvenance(),
      reactionIds: allReactionIds
    });

    expect(result.reactionIds).toHaveLength(24);
    expect(result.reactions).toHaveLength(24);
    expect(result.integration.result.t).toBe(1);
    for (const speciesId of MARS_INORGANIC_SPECIES_ORDER) {
      expect(Number.isFinite(result.finalConcentrationsPerCm3[speciesId])).toBe(true);
      expect(result.finalConcentrationsPerCm3[speciesId]).toBeGreaterThanOrEqual(0);
    }
    for (const budget of result.elementBudgets) {
      expect(Math.abs(budget.relativeDrift), budget.element).toBeLessThanOrEqual(1e-8);
    }
  });

  it('requires all 16 initial species and a separate source for each, including zero species', () => {
    const concentrations = initialConcentrations();
    const provenance = concentrationProvenance();
    delete (concentrations as Partial<Record<MarsInorganicSpeciesId, number>>).O1D;
    const missingConcentration = runError(() => runMarsInorganicBimolecularMechanism({
      temperatureK: 298,
      durationSeconds: 1,
      initialConcentrationsPerCm3: concentrations as Record<MarsInorganicSpeciesId, number>,
      concentrationProvenance: provenance,
      reactionIds: ['taysum2020-b1-b2']
    }));
    expect(missingConcentration.code).toBe('invalid_input');
    expect(missingConcentration.message).toMatch(/missing explicit concentration for O1D/);

    const withoutProvenance = concentrationProvenance();
    delete (withoutProvenance as Partial<Record<MarsInorganicSpeciesId, DataProvenance>>).H2O;
    const missingProvenance = runError(() => runMarsInorganicBimolecularMechanism({
      temperatureK: 298,
      durationSeconds: 1,
      initialConcentrationsPerCm3: initialConcentrations(),
      concentrationProvenance: withoutProvenance as Record<MarsInorganicSpeciesId, DataProvenance>,
      reactionIds: ['taysum2020-b1-b2']
    }));
    expect(missingProvenance.message).toMatch(/missing identified provenance for concentration of H2O/);
  });

  it('rejects duplicated, absent or non-B1 reaction IDs instead of silently skipping them', () => {
    const base = {
      temperatureK: 298,
      durationSeconds: 1,
      initialConcentrationsPerCm3: initialConcentrations(),
      concentrationProvenance: concentrationProvenance()
    };
    expect(runError(() => runMarsInorganicBimolecularMechanism({
      ...base,
      reactionIds: ['taysum2020-b1-b2', 'taysum2020-b1-b2']
    })).code).toBe('invalid_input');

    expect(runError(() => runMarsInorganicBimolecularMechanism({
      ...base,
      reactionIds: ['kida-tb-2015-03-19-89']
    })).code).toBe('no_kinetic_data');

    expect(runError(() => runMarsInorganicBimolecularMechanism({
      ...base,
      reactionIds: []
    })).code).toBe('invalid_input');
  });

  it('rejects invalid temperature and duration', () => {
    const base = {
      initialConcentrationsPerCm3: initialConcentrations(),
      concentrationProvenance: concentrationProvenance(),
      reactionIds: ['taysum2020-b1-b2']
    };
    expect(runError(() => runMarsInorganicBimolecularMechanism({
      ...base, temperatureK: 0, durationSeconds: 1
    })).code).toBe('invalid_input');
    expect(runError(() => runMarsInorganicBimolecularMechanism({
      ...base, temperatureK: 298, durationSeconds: 0
    })).code).toBe('invalid_input');
  });
});
