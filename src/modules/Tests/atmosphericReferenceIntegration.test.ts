// ============================================
// STAGE 4.2 — SOURCE PROFILE → GENERATOR → SCHEDULER
// ============================================
//
// The USSA 1976 temperature/height profile is real reference-model data.
// Chemical reactant inventories below are deliberately synthetic test
// inputs: USSA dry-air composition does not provide O/NO/NO2 radicals.
// This test proves wiring and fail-closed behavior, not planetary
// atmospheric chemistry for Earth.

import { describe, expect, it } from 'vitest';
import type { GenerationSettings, GeneratedWorld } from '../../types';
import { generateWorld } from '../Generator/generator';
import {
  computeUssa1976ReferenceHydrostaticColumn,
  createUssa1976AtmosphericTemperatureProfile
} from '../Core/atmosphericReferenceAdapters';
import {
  buildPhysicalKineticsConfigurationFromSourcedProfile,
  deriveDryAirKineticInventoriesFromHydrostaticColumn,
  importSourcedAtmosphericTemperatureProfileForKinetics
} from '../ChemicalEvolution/thermalProfileImport';
import {
  configurePrimaryPhysicalChemicalKinetics,
  runChemicalEvolutionSchedulerStep
} from '../ChemicalEvolution';
import { coreWorldStateFromLegacyWorld } from '../Core/adapters';

const R89 = 'kida-tb-2015-03-19-89';
const R106 = 'kida-tb-2015-03-19-106';

function baseSettings(overrides: Partial<GenerationSettings> = {}): GenerationSettings {
  return {
    seed: 'ussa-stage-4-2-reference-profile',
    mode: 'realistic',
    weights: {
      cosmology: {},
      epoch: {},
      centralObject: {},
      celestialBody: {},
      cradle: {}
    },
    fixedCategories: {
      centralObject: 'yellow_dwarf',
      celestialBody: 'earth_like'
    },
    atmospherePreset: 'earth',
    atmosphericReferenceProfile: 'ussa_1976_earth',
    enableChemicalEvolution: false,
    chemicalEvolutionSteps: 0,
    ...overrides
  };
}

function generateReferenceWorld(): GeneratedWorld {
  return generateWorld(baseSettings());
}

function provenance(sourceId: string) {
  return {
    sourceName: 'test-only synthetic reactant inventory (not planetary source data)',
    sourceId,
    note: 'synthetic values exercise the scheduler adapter; no atmospheric observation is implied'
  };
}

function explicitKineticInputs(
  profile: NonNullable<GeneratedWorld['atmosphericReferenceProfile']>,
  speciesTotals: Readonly<Record<string, number>>,
  reactionId: string
) {
  const imported = importSourcedAtmosphericTemperatureProfileForKinetics(profile);
  if (imported.status !== 'imported') {
    throw new Error(imported.diagnostics.join('; '));
  }
  const layerCount = imported.layers.length;
  return {
    maximumMacroStepS: 0.1,
    totalInventoryProvenance: Object.fromEntries(
      Object.keys(speciesTotals).map((speciesId) => [
        speciesId,
        provenance('test:global:' + speciesId)
      ])
    ),
    layers: imported.layers.map((seed, index) => ({
      sourceLayerId: seed.sourceLayerId,
      columnInventoriesMolM2: Object.fromEntries(
        Object.entries(speciesTotals).map(([speciesId, total]) => [
          speciesId,
          total / layerCount
        ])
      ),
      inventoryProvenance: provenance('test:layer:' + index + ':inventory'),
      reactionIds: [reactionId]
    }))
  };
}

function withSyntheticColumnState(
  world: GeneratedWorld,
  speciesTotals: Readonly<Record<string, number>>
): GeneratedWorld {
  const base = world.chemicalState!;
  const inventory = { ...speciesTotals };
  return {
    ...world,
    chemicalState: {
      ...base,
      mode: 'column_inventory',
      inventory,
      reservoirs: {
        ...base.reservoirs,
        atmospheric: { ...inventory }
      },
      physicalKineticsHistory: []
    }
  };
}

describe('Stage 4.2: reference profile integration', () => {
  it('generator attaches USSA only after explicit reference selection and Earth atmosphere preset', () => {
    const selected = generateReferenceWorld();
    expect(selected.atmosphericReferenceProfile?.status).toBe('partial_profile');
    expect(selected.atmosphericReferenceProfile?.layers).toHaveLength(7);
    expect(selected.atmosphericReferenceProfile?.provenance?.sourceId).toBe('NASA TM-X-74335');

    const notSelected = generateWorld(baseSettings({
      seed: 'ussa-not-selected',
      atmosphericReferenceProfile: undefined
    }));
    expect(notSelected.atmosphericReferenceProfile).toBeUndefined();

    const wrongPreset = generateWorld(baseSettings({
      seed: 'ussa-wrong-preset',
      atmospherePreset: 'mars'
    }));
    expect(wrongPreset.atmosphericReferenceProfile).toBeUndefined();
    expect(wrongPreset.warnings.some((warning) =>
      warning.id === 'warning_atmospheric_reference_profile_not_applicable'
    )).toBe(true);
  });

  it('imports seven finite sourced layers and preserves each source temperature and geometric interval', () => {
    const profile = createUssa1976AtmosphericTemperatureProfile();
    const imported = importSourcedAtmosphericTemperatureProfileForKinetics(profile);

    expect(imported.status).toBe('imported');
    if (imported.status !== 'imported') return;
    expect(imported.layers).toHaveLength(7);
    expect(imported.layers[0]).toMatchObject({
      sourceLayerId: 'ussa-1976-layer-0',
      bottomAltitudeM: 0
    });
    expect(imported.layers[6]!.topAltitudeM).toBeCloseTo(geometricTopOfUsSa(), 6);
    for (const layer of imported.layers) {
      expect(layer.temperatureK).toBeGreaterThan(0);
      expect(layer.topAltitudeM).toBeGreaterThan(layer.bottomAltitudeM);
      expect(layer.temperatureProvenance.sourceId).toBe('NASA TM-X-74335');
      expect(layer.altitudeProvenance.datasetId).toBe('ussa-1976-main-layers');
    }
  });

  it('CoreWorldState keeps the chosen source profile distinct from the preset single-layer estimate', () => {
    const world = generateReferenceWorld();
    const core = coreWorldStateFromLegacyWorld({
      id: world.id,
      seed: world.seed,
      generatorVersion: world.generatorVersion,
      centralObjectSystem: world.centralObjectSystem ?? null,
      orbit: world.orbit ? { frame: world.orbit.frame } : null,
      bodyPhysics: world.bodyPhysics
        ? {
            massKg: world.bodyPhysics.massKg,
            radiusM: world.bodyPhysics.radiusM,
            densityKgM3: world.bodyPhysics.densityKgM3,
            surfaceGravityMs2: world.bodyPhysics.surfaceGravityMs2
          }
        : null,
      atmosphere: {
        temperature: world.atmosphere.temperature,
        presetKind: world.atmosphere.presetKind,
        presetNotes: world.atmosphere.presetNotes,
        presetSourceName: world.atmosphere.presetSourceName
      },
      energyBudget: world.energyBudget
        ? {
            incidentFlux: world.energyBudget.incidentFlux,
            equilibriumTemperature: world.energyBudget.equilibriumTemperature
          }
        : null,
      atmosphericReferenceProfile: world.atmosphericReferenceProfile
    });
    const planet = core.bodies.find((body) => body.id === 'planet');
    expect(planet?.thermalState?.atmosphericTemperatureProfile.status).toBe('partial_profile');
    expect(planet?.thermalState?.atmosphericTemperatureProfile.layers).toHaveLength(7);
    expect(planet?.thermalState?.atmosphericTemperatureProfile.provenance?.sourceId)
      .toBe('NASA TM-X-74335');
  });

  it('feeds hydrostatic pressure, bulk composition and derived N2/O2 columns into Scheduler layer state', () => {
    const column = computeUssa1976ReferenceHydrostaticColumn();
    expect(column.status).toBe('completed');
    if (column.status !== 'completed') return;
    expect(column.layerBoundaries).toHaveLength(7);
    expect(column.requestedHeightPoints).toHaveLength(7);

    const derived = deriveDryAirKineticInventoriesFromHydrostaticColumn(column, [R89]);
    expect(derived.status).toBe('derived');
    if (derived.status !== 'derived') return;
    expect(derived.layers).toHaveLength(7);
    expect(derived.totalColumnInventoriesMolM2.n2).toBeGreaterThan(0);
    expect(derived.totalColumnInventoriesMolM2.o2).toBeGreaterThan(0);
    expect(derived.layers.every((layer) =>
      Object.keys(layer.columnInventoriesMolM2).sort().join(',') === 'n2,o2'
    )).toBe(true);
    expect(derived.layers.every((layer) =>
      !Object.prototype.hasOwnProperty.call(layer.columnInventoriesMolM2, 'o') &&
      !Object.prototype.hasOwnProperty.call(layer.columnInventoriesMolM2, 'no') &&
      !Object.prototype.hasOwnProperty.call(layer.columnInventoriesMolM2, 'ho2')
    )).toBe(true);

    const profile = createUssa1976AtmosphericTemperatureProfile();
    const built = buildPhysicalKineticsConfigurationFromSourcedProfile(profile, {
      maximumMacroStepS: 0.1,
      totalInventoryProvenance: derived.totalInventoryProvenance,
      layers: derived.layers,
      hydrostaticColumn: column
    });
    expect(built.status).toBe('configured');
    if (built.status !== 'configured') return;
    expect(built.configuration.layers).toHaveLength(7);
    const first = built.configuration.layers[0]!;
    expect(first.hydrostaticState).toBeDefined();
    expect(first.hydrostaticState!.pressurePa.bottom).toBeGreaterThan(
      first.hydrostaticState!.pressurePa.representative
    );
    expect(first.hydrostaticState!.pressurePa.representative).toBeGreaterThan(
      first.hydrostaticState!.pressurePa.top
    );
    expect(first.hydrostaticState!.molarFractions.n2).toBeCloseTo(0.7808, 8);
    expect(first.hydrostaticState!.molarFractions.o2).toBeCloseTo(0.2095, 8);
    expect(first.columnInventoriesMolM2.n2).toBeCloseTo(
      derived.layers[0]!.columnInventoriesMolM2.n2,
      12
    );

    // The bridge deliberately does not create radicals required by #89.
    const world = generateReferenceWorld();
    const syntheticWorld = withSyntheticColumnState(world, derived.totalColumnInventoriesMolM2);
    const configured = configurePrimaryPhysicalChemicalKinetics(
      syntheticWorld.chemicalState!,
      built.configuration,
      derived.totalColumnInventoriesMolM2
    );
    expect(configured.status).toBe('rejected');
    if (configured.status === 'rejected') {
      const diagnostic = configured.diagnostics.join('; ');
      expect(diagnostic).toContain('«o»');
      expect(diagnostic).toContain('«no»');
      expect(diagnostic).not.toContain('«o» — 0');
    }
  });

  it('builds Scheduler geometry only when every layer inventory, source and reaction selection is explicit', () => {
    const profile = createUssa1976AtmosphericTemperatureProfile();
    const valid = buildPhysicalKineticsConfigurationFromSourcedProfile(
      profile,
      explicitKineticInputs(profile, { o: 1e-5, no: 5e-6, no2: 2e-7, n2: 4.2e3 }, R89)
    );

    expect(valid.status).toBe('configured');
    if (valid.status !== 'configured') return;
    expect(valid.configuration.layers).toHaveLength(7);
    expect(valid.configuration.layers[0]!.temperatureK).toBeCloseTo(252.4, 0);
    expect(valid.configuration.layers[0]!.layerThicknessM).toBeCloseTo(
      valid.configuration.layers[0]!.altitudeRangeM!.max -
        valid.configuration.layers[0]!.altitudeRangeM!.min,
      8
    );
    expect(valid.configuration.layers.every((layer) =>
      layer.reactionIds[0] === R89
    )).toBe(true);

    const missingLayer = buildPhysicalKineticsConfigurationFromSourcedProfile(profile, {
      maximumMacroStepS: 0.1,
      totalInventoryProvenance: {
        n2: provenance('test:global:n2')
      },
      layers: []
    });
    expect(missingLayer.status).toBe('rejected');
    if (missingLayer.status === 'rejected') {
      expect(missingLayer.diagnostics.join('; ')).toContain('отсутствует явный подстолбовой inventory');
    }
  });

  it('the Scheduler runs on the sourced profile geometry when explicit reactants are supplied', () => {
    const world = generateReferenceWorld();
    const profile = world.atmosphericReferenceProfile!;
    const totals = { o: 1e-5, no: 5e-6, no2: 2e-7, n2: 4.2e3 };
    const explicit = explicitKineticInputs(profile, totals, R89);
    const built = buildPhysicalKineticsConfigurationFromSourcedProfile(profile, explicit);
    expect(built.status).toBe('configured');
    if (built.status !== 'configured') return;

    const syntheticWorld = withSyntheticColumnState(world, totals);
    const configured = configurePrimaryPhysicalChemicalKinetics(
      syntheticWorld.chemicalState!,
      built.configuration,
      totals
    );
    expect(configured.status).toBe('configured');
    if (configured.status !== 'configured') return;
    syntheticWorld.chemicalState = configured.state;

    const result = runChemicalEvolutionSchedulerStep(syntheticWorld);
    expect(result.status).toBe('committed');
    expect(result.world.chemicalState!.physicalKineticsHistory).toHaveLength(1);
    expect(result.world.chemicalState!.physicalKineticsHistory![0]!.layers).toHaveLength(7);
    expect(result.world.coreWorldState?.bodies.find((body) => body.id === 'planet')
      ?.thermalState?.atmosphericTemperatureProfile.layers).toHaveLength(7);
    expect(result.world.coreWorldState?.reactionLedger?.records.filter((record) =>
      record.processId === 'physical_chemical_kinetics'
    )).toHaveLength(7);
  });

  it('does not infer missing radicals from the sourced dry-air profile', () => {
    const world = generateReferenceWorld();
    const profile = world.atmosphericReferenceProfile!;
    const totals = { n2: 4.2e3, o2: 1e-2 };
    const built = buildPhysicalKineticsConfigurationFromSourcedProfile(
      profile,
      explicitKineticInputs(profile, totals, R106)
    );
    expect(built.status).toBe('configured');
    if (built.status !== 'configured') return;

    const syntheticWorld = withSyntheticColumnState(world, totals);
    const configured = configurePrimaryPhysicalChemicalKinetics(
      syntheticWorld.chemicalState!,
      built.configuration,
      totals
    );
    expect(configured.status).toBe('rejected');
    if (configured.status === 'rejected') {
      const message = configured.diagnostics.join('; ');
      expect(message).toContain('«h»');
      expect(message).toContain('«ho2»');
      expect(message).not.toContain('«h» — 0');
    }
  });
});

function geometricTopOfUsSa(): number {
  return 84852 * 6356766 / (6356766 - 84852);
}
