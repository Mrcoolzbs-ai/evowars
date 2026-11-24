import { describe, expect, it } from 'vitest';
import {
  MARS_PHOTOCHEMICAL_AVOGADRO_CONSTANT_MOL_INV,
  assessMarsPhotochemicalEvidenceReadiness,
  createMarsPhotochemicalObservationSnapshot
} from '../ChemicalEvolution/marsPhotochemicalInitialState';
import { MARS_PHOTOCHEMICAL_SPECIES_ORDER } from '../ChemicalEvolution/marsPhotochemicalNetwork';
import type {
  MarsPhotochemicalObservationSnapshotInput,
  MarsPhotochemicalSamplingContext,
  MarsPhotochemicalSpeciesObservation
} from '../ChemicalEvolution/marsPhotochemicalInitialState';
import { knownValue } from '../Core/scientificValue';
import type { DataProvenance } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';

const TEMPERATURE_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic unit-test fixture local temperature',
  sourceId: 'evowars/tests/mars-photochemical-snapshot/temperature',
  method: 'Fixture solely for testing; not an observation'
};

const CO_REGISTRATION_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic unit-test co-registration policy',
  sourceId: 'evowars/tests/mars-photochemical-snapshot/tolerance-policy',
  method: 'Zero-spread fixture tolerances; not a scientific tolerance recommendation'
};

function context(overrides: Partial<MarsPhotochemicalSamplingContext> = {}): MarsPhotochemicalSamplingContext {
  return {
    eventId: 'synthetic-test-event-001',
    timeUtc: '2025-01-01T00:00:00.000Z',
    marsYear: 37,
    solarLongitudeDeg: 251,
    altitudeKm: 0.5,
    latitudeDeg: 5,
    longitudeDeg: 12,
    localSolarTimeHours: 12,
    solarZenithAngleDeg: 0,
    ...overrides
  };
}

function observations(): MarsPhotochemicalSpeciesObservation[] {
  return MARS_PHOTOCHEMICAL_SPECIES_ORDER.map((species, index) => ({
    speciesId: species,
    numberDensityPerCm3: (index + 1) * 1e8,
    reportedSigmaPerCm3: (index + 1) * 1e6,
    evidenceKind: 'in_situ_detection',
    quality: 'verified',
    context: context(),
    provenance: {
      sourceName: 'synthetic unit-test measurement for ' + species,
      sourceId: 'evowars/tests/mars-photochemical-snapshot/species/' + species,
      method: 'synthetic positive value; not a physical observation'
    }
  }));
}

function input(overrides: Partial<MarsPhotochemicalObservationSnapshotInput> = {}): MarsPhotochemicalObservationSnapshotInput {
  return {
    reservoirId: 'mars-observation-test-compartment',
    targetAltitudeKm: 0.5,
    observations: observations(),
    temperatureObservation: {
      temperature: knownValue(quantity(220, 'K'), {
        provenance: TEMPERATURE_PROVENANCE
      }),
      evidenceKind: 'in_situ_detection',
      quality: 'verified',
      context: context(),
      provenance: TEMPERATURE_PROVENANCE
    },
    coRegistration: {
      maximumTimeSeparationSeconds: 0,
      maximumLatitudeSeparationDeg: 0,
      maximumLongitudeSeparationDeg: 0,
      maximumLocalSolarTimeSeparationHours: 0,
      maximumSolarZenithAngleSeparationDeg: 0,
      maximumSolarLongitudeSeparationDeg: 0,
      maximumPhotolysisSzaOffsetDeg: 0,
      maximumPhotolysisSolarLongitudeOffsetDeg: 0,
      provenance: CO_REGISTRATION_PROVENANCE
    },
    ...overrides
  };
}

describe('Stage 4.2: strict Mars photochemical observation snapshot', () => {
  it('reports that the currently imported scientific evidence cannot initialise all 16 species', () => {
    const report = assessMarsPhotochemicalEvidenceReadiness();
    expect(report.status).toBe('not_ready');
    expect(report.targetScenario).toEqual({
      altitudeNodesKm: [0.5, 42.67],
      solarZenithAngleDeg: 0,
      solarLongitudeDeg: 251
    });
    expect(report.missingFromCompatibleObservedSnapshot).toEqual(
      MARS_PHOTOCHEMICAL_SPECIES_ORDER
    );
    expect(report.sourceEvidence.length).toBeGreaterThanOrEqual(6);
    expect(report.blockers.join(' ')).toMatch(/complete 16-species/i);
    expect(report.blockers.join(' ')).toMatch(/upper limits/i);
    expect(report.blockers.join(' ')).toMatch(/atomic H/i);
    expect(report.blockers.join(' ')).toMatch(/3\/16 network species/i);
    expect(report.blockers.join(' ')).toMatch(/LPW electron temperature/i);
    expect(report.blockers.join(' ')).toMatch(/species-specific log-density scale-height fit/i);
    expect(report.blockers.join(' ')).toMatch(/TID 14282/i);
    expect(report.blockers.join(' ')).toMatch(/exact event window/i);
    expect(report.blockers.join(' ')).toMatch(/152\.981 km/i);
    expect(report.blockers.join(' ')).toMatch(/orbit 391/i);
    expect(report.sourceEvidence.some((source) =>
      source.sourceId.includes('res-sht-14282_20141211t154406') &&
      source.sourceId.includes('csn-abund-14282_20141211t154406')
    )).toBe(true);
    expect(report.sourceEvidence.some((source) =>
      source.sourceId.includes('Table A-10')
    )).toBe(true);
    expect(report.sourceEvidence.some((source) =>
      source.sourceId.includes('10.17189/4sjk-t793')
    )).toBe(true);
  });

  it('builds a 16-species molar-concentration reservoir only from a fully co-registered verified fixture', () => {
    const result = createMarsPhotochemicalObservationSnapshot(input());
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error(result.errors.join('; '));
    }

    expect(result.reservoir.kind).toBe('mars_photochemical_compartment');
    expect(result.reservoir.material?.basis).toBe('molar_concentration');
    expect(Object.keys(result.reservoir.material!.entries)).toHaveLength(16);
    expect(result.reservoir.reservoirTemperature?.status).toBe('known');
    expect(result.reservoir.materialProvenance?.sourceId)
      .toBe('evowars/mars/photochemical-observation-snapshot');
    expect(result.context.altitudeKm).toBe(0.5);
    expect(result.context.solarZenithAngleDeg).toBe(0);
    expect(result.context.solarLongitudeDeg).toBe(251);

    for (const [index, species] of MARS_PHOTOCHEMICAL_SPECIES_ORDER.entries()) {
      const expectedParticlesCm3 = (index + 1) * 1e8;
      const expectedMolM3 =
        expectedParticlesCm3 * 1e6 / MARS_PHOTOCHEMICAL_AVOGADRO_CONSTANT_MOL_INV;
      expect(result.reservoir.material!.entries[species]).toBeCloseTo(expectedMolM3, 13);
      expect(result.initialConcentrationsPerCm3[species]).toBe(expectedParticlesCm3);
    }
    expect(result.diagnostics.join(' ')).toMatch(/no fill/i);
  });

  it('rejects missing species rather than treating an absent concentration as zero', () => {
    const rows = observations().filter((row) => row.speciesId !== 'HO2');
    const result = createMarsPhotochemicalObservationSnapshot(input({ observations: rows }));
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected rejection');
    expect(result.errors.join(' ')).toMatch(/exactly 16 species/i);
    expect(result.errors.join(' ')).toMatch(/HO2/);
    expect(result.errors.join(' ')).toMatch(/no zero-fill/i);
  });

  it('rejects duplicate species instead of implicitly averaging them', () => {
    const rows = observations();
    rows.push({ ...rows[0], numberDensityPerCm3: rows[0].numberDensityPerCm3 * 2 });
    const result = createMarsPhotochemicalObservationSnapshot(input({ observations: rows }));
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected rejection');
    expect(result.errors.join(' ')).toMatch(/duplicate species O/);
  });

  it('rejects upper limits, non-detections, model values and uncertain quality rows', () => {
    for (const evidenceKind of ['upper_limit', 'non_detection', 'modelled', 'model_constrained'] as const) {
      const rows = observations();
      rows[10] = { ...rows[10], evidenceKind };
      const result = createMarsPhotochemicalObservationSnapshot(input({ observations: rows }));
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('Expected rejection for ' + evidenceKind);
      expect(result.errors.join(' ')).toMatch(/not a detected point value/);
    }

    const uncertainRows = observations();
    uncertainRows[0] = { ...uncertainRows[0], quality: 'uncertain' };
    const qualityResult = createMarsPhotochemicalObservationSnapshot(input({ observations: uncertainRows }));
    expect(qualityResult.status).toBe('rejected');
    if (qualityResult.status !== 'rejected') throw new Error('Expected uncertain quality rejection');
    expect(qualityResult.errors.join(' ')).toMatch(/must have verified quality/);
  });

  it('rejects cross-event, cross-season, and out-of-tolerance samples', () => {
    const differentEvent = observations();
    differentEvent[0] = {
      ...differentEvent[0],
      context: context({ eventId: 'another-event' })
    };
    const eventResult = createMarsPhotochemicalObservationSnapshot(input({ observations: differentEvent }));
    expect(eventResult.status).toBe('rejected');
    if (eventResult.status !== 'rejected') throw new Error('Expected event mismatch rejection');
    expect(eventResult.errors.join(' ')).toMatch(/cross-event blending is forbidden/);

    const wrongSeason = observations();
    wrongSeason[1] = {
      ...wrongSeason[1],
      context: context({ solarLongitudeDeg: 133 })
    };
    const seasonResult = createMarsPhotochemicalObservationSnapshot(input({ observations: wrongSeason }));
    expect(seasonResult.status).toBe('rejected');
    if (seasonResult.status !== 'rejected') throw new Error('Expected season mismatch rejection');
    expect(seasonResult.errors.join(' ')).toMatch(/Ls=251/);

    const wrongTime = observations();
    wrongTime[2] = {
      ...wrongTime[2],
      context: context({ timeUtc: '2025-01-01T00:00:01.000Z' })
    };
    const timeResult = createMarsPhotochemicalObservationSnapshot(input({ observations: wrongTime }));
    expect(timeResult.status).toBe('rejected');
    if (timeResult.status !== 'rejected') throw new Error('Expected time mismatch rejection');
    expect(timeResult.errors.join(' ')).toMatch(/time separation/);
  });

  it('rejects different exact altitude nodes and solar geometry outside the caller policy', () => {
    const wrongAltitude = observations();
    wrongAltitude[0] = {
      ...wrongAltitude[0],
      context: context({ altitudeKm: 42.67 })
    };
    const altitudeResult = createMarsPhotochemicalObservationSnapshot(input({
      observations: wrongAltitude
    }));
    expect(altitudeResult.status).toBe('rejected');
    if (altitudeResult.status !== 'rejected') throw new Error('Expected altitude rejection');
    expect(altitudeResult.errors.join(' ')).toMatch(/exact Table B2 node/);

    const wrongSza = observations().map((row) => ({
      ...row,
      context: context({ solarZenithAngleDeg: 1 })
    }));
    const szaResult = createMarsPhotochemicalObservationSnapshot(input({ observations: wrongSza }));
    expect(szaResult.status).toBe('rejected');
    if (szaResult.status !== 'rejected') throw new Error('Expected SZA rejection');
    expect(szaResult.errors.join(' ')).toMatch(/SZA does not match/);
  });

  it('rejects a temperature ScientificValue without its own stored provenance', () => {
    const result = createMarsPhotochemicalObservationSnapshot(input({
      temperatureObservation: {
        temperature: knownValue(quantity(220, 'K')),
        evidenceKind: 'in_situ_detection',
        quality: 'verified',
        context: context(),
        provenance: TEMPERATURE_PROVENANCE
      }
    }));
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected embedded temperature provenance rejection');
    expect(result.errors.join(' ')).toMatch(/temperatureObservation.temperature.provenance/);
  });

  it('rejects a malformed or missing temperature ScientificValue without throwing', () => {
    const result = createMarsPhotochemicalObservationSnapshot(input({
      temperatureObservation: {
        temperature: null as never,
        evidenceKind: 'in_situ_detection',
        quality: 'verified',
        context: context(),
        provenance: TEMPERATURE_PROVENANCE
      }
    }));
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('Expected malformed temperature rejection');
    expect(result.errors.join(' ')).toMatch(/temperatureObservation.temperature must be a ScientificValue record/);
  });

  it('requires sourced temperature and a provenance-backed, explicit co-registration policy', () => {
    const missingTemperatureProvenance = input({
      temperatureObservation: {
        temperature: knownValue(quantity(220, 'K')),
        evidenceKind: 'in_situ_detection',
        quality: 'verified',
        context: context(),
        provenance: {}
      }
    });
    const tempResult = createMarsPhotochemicalObservationSnapshot(missingTemperatureProvenance);
    expect(tempResult.status).toBe('rejected');
    if (tempResult.status !== 'rejected') throw new Error('Expected temperature provenance rejection');
    expect(tempResult.errors.join(' ')).toMatch(/temperatureObservation.provenance/);

    const missingPolicySource = input({
      coRegistration: {
        ...input().coRegistration,
        provenance: {}
      }
    });
    const policyResult = createMarsPhotochemicalObservationSnapshot(missingPolicySource);
    expect(policyResult.status).toBe('rejected');
    if (policyResult.status !== 'rejected') throw new Error('Expected policy provenance rejection');
    expect(policyResult.errors.join(' ')).toMatch(/coRegistration.provenance/);
  });

  it('preserves unknown per-species sigma as unknown, not as zero uncertainty', () => {
    const rows = observations();
    rows[0] = { ...rows[0], reportedSigmaPerCm3: null };
    const result = createMarsPhotochemicalObservationSnapshot(input({ observations: rows }));
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error('Expected completion');
    expect(result.reservoir.materialProvenance?.rawInput?.reportedSigmaPerCm3)
      .toContain('O=not_reported');
  });
});
