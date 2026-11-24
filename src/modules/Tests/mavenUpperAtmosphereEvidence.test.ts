import { describe, expect, it } from 'vitest';
import {
  MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS,
  MAVEN_IUVS_NO_DAYGLOW_REFERENCE,
  MAVEN_NGIMS_PDS_ARCHIVE,
  buildMavenNgimsNeutralProfile,
  parseMavenNgimsL2NeutralCsvRow,
  validateMavenNgimsL2NeutralRow,
  type MavenNgimsL2NeutralAbundanceRow
} from '../Data/mavenUpperAtmosphereEvidence';

const row = (overrides: Partial<MavenNgimsL2NeutralAbundanceRow> = {}): MavenNgimsL2NeutralAbundanceRow => ({
  t_utc: '2016-04-07T06:00:00Z',
  tid: 12345,
  orbit: 14016,
  focusmode: 'osnb',
  alt: 155,
  lst: 18,
  long: 120,
  lat: 53,
  sza: 75,
  mass: 16,
  species: 'O',
  abundance: 1.2e7,
  precision: 0.15,
  quality: 'IV',
  ...overrides
});

describe('MAVEN upper-atmosphere evidence', () => {
  it('preserves the published IUVS NO retrieval geometry and method without inventing density points', () => {
    expect(MAVEN_IUVS_NO_DAYGLOW_REFERENCE.speciesId).toBe('no');
    expect(MAVEN_IUVS_NO_DAYGLOW_REFERENCE.observation.sequentialOrbitProfilesAveraged).toBe(9);
    expect(MAVEN_IUVS_NO_DAYGLOW_REFERENCE.observation.marsYear).toBe(33);
    expect(MAVEN_IUVS_NO_DAYGLOW_REFERENCE.altitudeGridKmAscending).toEqual([80, 88, 96, 104, 112, 120, 128]);
    expect(MAVEN_IUVS_NO_DAYGLOW_REFERENCE.retrieval.assumedEmissionScaleHeightAboveTopKm).toBe(10);
    expect(MAVEN_IUVS_NO_DAYGLOW_REFERENCE.numericalDensityTableIncluded).toBe(false);
    expect(MAVEN_IUVS_NO_DAYGLOW_REFERENCE.uncertainty.systematicMuvRadianceFraction).toBe(0.3);
  });

  it('preserves model-constrained O/CO2 ratios with their scaling and uncertainty semantics', () => {
    const estimates = MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS.estimates;
    expect(estimates.map((item) => item.publishedModelConstrainedRatio)).toEqual([0.031, 0.03]);
    expect(estimates[0].unscaledModelRatio).toBe(0.029);
    expect(estimates[1].unscaledModelRatio).toBe(0.025);
    expect(estimates[0].oxygenDensityScaleFactor).toBe(0.77);
    expect(estimates[1].oxygenDensityScaleFactor).toBe(1.8);
    expect(MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS.uncertainty.numericRatioSigmaPublished).toBe(false);
    expect(MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS.numericalVerticalProfileIncluded).toBe(false);
  });

  it('keeps the archive and product level semantics explicit', () => {
    expect(MAVEN_NGIMS_PDS_ARCHIVE.availableProducts).toContain('L2 single-species abundance');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.availableProducts).toContain('L3 altitude-resampled abundance');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.neutralSpeciesOfInterest).toContain('NO');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.dataAvailableThroughUtc).toBe('2025-02-15');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.l2AbundanceUnit).toBe('part/cm3');
  });

  it('converts one verified L2 abundance and its 1-sigma relative precision to SI', () => {
    const result = validateMavenNgimsL2NeutralRow(row());
    expect(result.status).toBe('verified');
    if (result.status !== 'verified') throw new Error(JSON.stringify(result));
    expect(result.measurement.altitudeM).toBe(155000);
    expect(result.measurement.numberDensityPerM3).toBe(1.2e13);
    expect(result.measurement.relativeSigmaFraction).toBe(0.15);
    expect(result.measurement.numberDensitySigmaPerM3).toBeCloseTo(1.8e12, 3);
    expect(result.measurement.eligibleAsSchedulerInitialAbundance).toBe(false);
  });

  it('does not accept uncertain or unreliable quality flags by default', () => {
    expect(validateMavenNgimsL2NeutralRow(row({ quality: 'IU' })).status).toBe('rejected');
    expect(validateMavenNgimsL2NeutralRow(row({ quality: 'OU' })).status).toBe('rejected');
    const unreliable = validateMavenNgimsL2NeutralRow(row({ quality: 'UR' }));
    expect(unreliable.status).toBe('rejected');
    if (unreliable.status !== 'rejected') throw new Error('UR must be rejected');
    expect(unreliable.errors.join(' ')).toMatch(/not usable for science/);
  });

  it('allows uncertain data only under explicit policy and never upgrades it to verified', () => {
    const result = validateMavenNgimsL2NeutralRow(row({ quality: 'IU' }), { allowUncertain: true });
    expect(result.status).toBe('uncertain');
    if (result.status !== 'uncertain') throw new Error('IU must remain uncertain');
    expect(result.measurement.quality).toBe('uncertain');
    expect(result.warnings.join(' ')).toMatch(/not verified/);
  });

  it('retains the published NGIMS NO-instrument chemistry caveat', () => {
    const result = validateMavenNgimsL2NeutralRow(row({
      species: 'NO',
      mass: 30
    }));
    expect(result.status).toBe('verified');
    if (result.status !== 'verified') throw new Error('NO row should be accepted as a measurement candidate');
    expect(result.measurement.interpretation).toBe('possible_instrument_chemistry_bias');
    expect(result.warnings.join(' ')).toMatch(/recombination/);
  });

  it('parses L2 CSV fields using the SIS names and rejects malformed or absent columns', () => {
    const parsed = parseMavenNgimsL2NeutralCsvRow({
      t_utc: '2016-04-07T06:00:00Z',
      tid: '12345',
      orbit: '14016',
      focusmode: 'osnb',
      alt: '155',
      lst: '18',
      long: '120',
      lat: '53',
      sza: '75',
      mass: '16',
      species: 'O',
      abundance: '12000000',
      precision: '0.15',
      quality: 'IV'
    });
    expect(parsed.status).toBe('verified');
    expect(parseMavenNgimsL2NeutralCsvRow({}).status).toBe('rejected');
  });

  it('builds one single-orbit, single-direction profile and sorts it by altitude', () => {
    const result = buildMavenNgimsNeutralProfile([
      row({ alt: 165, abundance: 1e7 }),
      row({ alt: 145, abundance: 1.4e7 }),
      row({ alt: 155, abundance: 1.2e7 })
    ]);
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error(result.errors?.join('; '));
    expect(result.measurements?.map((measurement) => measurement.altitudeM)).toEqual([
      145000, 155000, 165000
    ]);
    expect(result.direction).toBe('inbound');
  });

  it('rejects cross-orbit, inbound/outbound, multi-species and duplicate-altitude mixes', () => {
    expect(buildMavenNgimsNeutralProfile([
      row({ alt: 145 }),
      row({ alt: 155, orbit: 14017 })
    ]).status).toBe('rejected');

    expect(buildMavenNgimsNeutralProfile([
      row({ alt: 145, quality: 'IV' }),
      row({ alt: 155, quality: 'OV' })
    ]).status).toBe('rejected');

    expect(buildMavenNgimsNeutralProfile([
      row({ alt: 145, species: 'O' }),
      row({ alt: 155, species: 'NO', mass: 30 })
    ]).status).toBe('rejected');

    expect(buildMavenNgimsNeutralProfile([
      row({ alt: 145 }),
      row({ alt: 145 })
    ]).status).toBe('rejected');
  });

  it('validates the source precision range and the NGIMS mass coverage', () => {
    expect(validateMavenNgimsL2NeutralRow(row({ precision: 1.01 })).status).toBe('rejected');
    expect(validateMavenNgimsL2NeutralRow(row({ mass: 1 })).status).toBe('rejected');
    expect(validateMavenNgimsL2NeutralRow(row({ abundance: Number.NaN })).status).toBe('rejected');
  });
});
