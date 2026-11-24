import { describe, expect, it } from 'vitest';
import {
  AVOGADRO_CONSTANT_MOL_INV,
  MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
  createMarsPhotochemicalProcessRegistry,
  runMarsPhotochemicalSchedulerStep
} from '../ChemicalEvolution/marsPhotochemicalScheduler';
import { MARS_PHOTOCHEMICAL_SPECIES_ORDER } from '../ChemicalEvolution/marsPhotochemicalNetwork';
import type { MarsPhotochemicalInitialConcentrations } from '../ChemicalEvolution/marsPhotochemicalNetwork';
import { createCoreWorldState, validateWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { knownValue } from '../Core/scientificValue';
import type { DataProvenance } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';

const RESERVOIR_ID = 'mars-local-photochemical-box';
const GAS_REACTION_IDS = ['c4'];
const PHOTOLYSIS_REACTION_IDS = ['ho2_photolysis'];

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
  sourceName: 'synthetic test fixture — explicit Mars-compartment initial state',
  sourceId: 'evowars/tests/mars-scheduler/initial-state',
  method: 'synthetic fixture only; not an observational profile'
};

const TEMPERATURE_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic test fixture — local compartment temperature',
  sourceId: 'evowars/tests/mars-scheduler/temperature',
  method: 'synthetic fixture only; not an observational temperature'
};

function toMolPerM3(valueParticlesPerCm3: number): number {
  return valueParticlesPerCm3 * 1e6 / AVOGADRO_CONSTANT_MOL_INV;
}

function fromMolPerM3(valueMolPerM3: number): number {
  return valueMolPerM3 * AVOGADRO_CONSTANT_MOL_INV / 1e6;
}

function makeReservoir(overrides: {
  kind?: string;
  basis?: 'molar_concentration' | 'column_amount';
  omitMaterialProvenance?: boolean;
  omitTemperature?: boolean;
  omitSpecies?: string;
} = {}): ReservoirRecord {
  const entries: Record<string, number> = Object.fromEntries(
    MARS_PHOTOCHEMICAL_SPECIES_ORDER
      .filter((species) => species !== overrides.omitSpecies)
      .map((species) => [species, toMolPerM3(INITIAL[species])])
  );
  let reservoir = createReservoir(
    RESERVOIR_ID,
    overrides.kind ?? 'mars_photochemical_compartment'
  );
  reservoir = setMaterialInventory(
    reservoir,
    overrides.basis ?? 'molar_concentration',
    entries
  );
  if (!overrides.omitMaterialProvenance) {
    reservoir = {
      ...reservoir,
      materialProvenance: { ...STATE_PROVENANCE }
    };
  }
  if (!overrides.omitTemperature) {
    reservoir = {
      ...reservoir,
      reservoirTemperature: knownValue(quantity(220, 'K'), {
        provenance: { ...TEMPERATURE_PROVENANCE }
      })
    };
  }
  return reservoir;
}

function makeWorld(reservoir = makeReservoir()): CoreWorldState {
  return {
    ...createCoreWorldState('mars-photochemical-scheduler-test'),
    reservoirs: [reservoir]
  };
}

function run(world: CoreWorldState, overrides: {
  reservoirId?: string;
  altitudeKm?: 0.5 | 42.67;
  gasPhaseReactionIds?: readonly string[];
  photolysisReactionIds?: readonly string[];
  durationS?: number;
} = {}) {
  return runMarsPhotochemicalSchedulerStep(
    world,
    {
      reservoirId: overrides.reservoirId ?? RESERVOIR_ID,
      altitudeKm: overrides.altitudeKm ?? 0.5,
      gasPhaseReactionIds: overrides.gasPhaseReactionIds ?? GAS_REACTION_IDS,
      photolysisReactionIds: overrides.photolysisReactionIds ?? PHOTOLYSIS_REACTION_IDS
    },
    overrides.durationS ?? 1
  );
}

describe('Stage 4.2: Mars photochemical ODE through Core Scheduler', () => {
  it('registers as explicit_only with unknown tau; no automatic characteristic time is invented', () => {
    const registry = createMarsPhotochemicalProcessRegistry();
    const descriptor = registry.get(MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID);
    expect(descriptor).not.toBeNull();
    expect(descriptor?.processKind).toBe('photochemical');
    expect(descriptor?.executionMode).toBe('explicit_only');
    expect(descriptor?.tau.status).toBe('unknown');
  });

  it('commits one 16-species interval, updates only its compartment and advances Core clock once', () => {
    const initialWorld = makeWorld();
    expect(validateWorldState(initialWorld)).toEqual([]);

    const result = run(initialWorld);
    expect(result.status).toBe('committed');
    expect(result.processId).toBe(MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID);
    expect(result.networkResult?.status).toBe('applied');
    expect(result.networkResult?.method).toMatch(/Radau/i);
    expect(result.networkResult?.reactions.map((reaction) => reaction.id)).toEqual([
      'c4',
      'ho2_photolysis'
    ]);

    expect(result.world.clock.localTimeS).toBe(1);
    expect(result.world.clock.stepCount).toBe(1);
    expect(validateWorldState(result.world)).toEqual([]);

    const beforeReservoir = initialWorld.reservoirs[0]!;
    const afterReservoir = result.world.reservoirs[0]!;
    expect(beforeReservoir.material?.basis).toBe('molar_concentration');
    expect(afterReservoir.material?.basis).toBe('molar_concentration');
    expect(afterReservoir.materialProvenance?.sourceId).toBe('evowars/core/mars-single-compartment-ode');

    for (const species of MARS_PHOTOCHEMICAL_SPECIES_ORDER) {
      const afterMolM3 = afterReservoir.material!.entries[species]!;
      expect(Number.isFinite(afterMolM3)).toBe(true);
      expect(afterMolM3).toBeGreaterThanOrEqual(0);
      expect(fromMolPerM3(afterMolM3)).toBeCloseTo(
        result.networkResult!.finalConcentrationsPerCm3[species],
        5
      );
    }
    expect(
      result.networkResult!.finalConcentrationsPerCm3.HO2
    ).toBeLessThan(INITIAL.HO2);
    expect(
      result.networkResult!.finalConcentrationsPerCm3.O
    ).toBeGreaterThan(INITIAL.O);

    // Snapshot isolation: input object and its nested inventory were not mutated.
    expect(initialWorld.clock.localTimeS).toBe(0);
    expect(initialWorld.clock.stepCount).toBe(0);
    expect(initialWorld.reservoirs[0]!.material!.entries.HO2).toBe(
      toMolPerM3(INITIAL.HO2)
    );

    // The ODE exposes final concentrations, not per-reaction extents.
    // Do not synthesize transaction records from net concentration changes.
    expect(result.world.reactionLedger?.records).toEqual([]);
    expect(result.world.fluxLedger.records).toEqual([]);
  });

  it('rejects missing reservoir provenance without changing world or clock', () => {
    const world = makeWorld(makeReservoir({ omitMaterialProvenance: true }));
    const before = structuredClone(world);
    const result = run(world);
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.diagnostics.join(' ')).toMatch(/materialProvenance/i);
    expect(world).toEqual(before);
  });

  it('rejects missing local temperature and incomplete concentration vector', () => {
    const withoutTemperature = makeWorld(makeReservoir({ omitTemperature: true }));
    const temperatureResult = run(withoutTemperature);
    expect(temperatureResult.status).toBe('rejected');
    expect(temperatureResult.world).toBe(withoutTemperature);
    expect(temperatureResult.diagnostics.join(' ')).toMatch(/reservoirTemperature/i);

    const incomplete = makeWorld(makeReservoir({ omitSpecies: 'HO2' }));
    const inventoryResult = run(incomplete);
    expect(inventoryResult.status).toBe('rejected');
    expect(inventoryResult.world).toBe(incomplete);
    expect(inventoryResult.diagnostics.join(' ')).toMatch(/HO2/i);
    expect(incomplete.clock.stepCount).toBe(0);
  });

  it('rejects an incompatible reservoir basis and a non-compartment reservoir kind', () => {
    const wrongBasis = makeWorld(makeReservoir({ basis: 'column_amount' }));
    const basisResult = run(wrongBasis);
    expect(basisResult.status).toBe('rejected');
    expect(basisResult.world).toBe(wrongBasis);
    expect(basisResult.diagnostics.join(' ')).toMatch(/molar_concentration/i);

    const wrongKind = makeWorld(makeReservoir({ kind: 'atmosphere' }));
    const kindResult = run(wrongKind);
    expect(kindResult.status).toBe('rejected');
    expect(kindResult.world).toBe(wrongKind);
    expect(kindResult.diagnostics.join(' ')).toMatch(/mars_photochemical_compartment/i);
  });

  it('rejects unsupported reaction selectors and non-reference altitude without partial commit', () => {
    const world = makeWorld();
    const unsupported = run(world, { gasPhaseReactionIds: ['not-a-source-backed-reaction'] });
    expect(unsupported.status).toBe('rejected');
    expect(unsupported.world).toBe(world);
    expect(unsupported.diagnostics.join(' ')).toMatch(/unknown gas-phase reaction ID/i);

    const invalidAltitude = runMarsPhotochemicalSchedulerStep(
      world,
      {
        reservoirId: RESERVOIR_ID,
        altitudeKm: 12 as never,
        gasPhaseReactionIds: ['c4'],
        photolysisReactionIds: ['ho2_photolysis']
      },
      1
    );
    expect(invalidAltitude.status).toBe('rejected');
    expect(invalidAltitude.world).toBe(world);
    expect(invalidAltitude.diagnostics.join(' ')).toMatch(/0\.5 или 42\.67/);
  });

  it('rejects invalid duration before changing world time', () => {
    const world = makeWorld();
    const result = run(world, { durationS: 0 });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.world.clock.localTimeS).toBe(0);
  });
});
