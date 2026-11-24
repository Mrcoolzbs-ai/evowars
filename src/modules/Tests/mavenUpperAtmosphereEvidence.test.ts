import { describe, expect, it } from 'vitest';
import {
  MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS,
  MAVEN_IUVS_NO_DAYGLOW_REFERENCE,
  MAVEN_NGIMS_PDS_ARCHIVE,
  MAVEN_INSITU_KP_PDS_ARCHIVE,
  MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT,
  parseMavenInsituKeyParameterRecord,
  buildMavenNgimsNeutralProfile,
  buildMavenNgimsNeutralProfileFromCsvImport,
  parseMavenNgimsL2NeutralCsvRow,
  parseMavenNgimsL2NeutralCsvText,
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

function keyParameterRecord(overrides: Record<string, string> = {}): string {
  let record = ' '.repeat(MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT.fixedWidthAsciiSchema.recordLengthBytes);
  const set = (start: number, length: number, value: string): void => {
    record = record.slice(0, start - 1) + value.padStart(length, ' ') + record.slice(start - 1 + length);
  };
  set(1, 19, '2025-06-10T12:00:00');
  set(2308, 16, '1.0e6');
  set(2324, 16, '15');
  set(2340, 16, 'D');
  set(2356, 16, '2.0e6');
  set(2372, 16, '20');
  set(2388, 16, 'D');
  set(2548, 16, '3.0e6');
  set(2564, 16, '30');
  set(2580, 16, 'D');
  set(3076, 16, '123.4');
  set(3092, 16, '-5');
  set(3108, 16, '75');
  set(3124, 16, '12.5');
  set(3140, 16, '160');
  set(3348, 16, '31000');
  set(3364, 16, 'I');
  set(3380, 16, '251');
  const positions: Record<string, number> = {
    timeUtc: 1,
    O_density: 2308, O_precision: 2324, O_quality: 2340,
    CO_density: 2356, CO_precision: 2372, CO_quality: 2388,
    CO2_density: 2548, CO2_precision: 2564, CO2_quality: 2580,
    longitude: 3076, latitude: 3092, sza: 3108, lst: 3124,
    altitude: 3140, orbit: 3348, direction: 3364, solarLongitude: 3380
  };
  for (const [key, value] of Object.entries(overrides)) {
    const start = positions[key];
    if (start === undefined) throw new Error('unknown synthetic fixed-width field: ' + key);
    const length = key === 'timeUtc' ? 19 : 16;
    set(start, length, value);
  }
  return record;
}

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
    expect(MAVEN_NGIMS_PDS_ARCHIVE.archiveCoverage.latestAnnualCollectionYearListed).toBe(2025);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.archiveCoverage.annual2025AbundancesSize).toBe('308 MB');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.archiveCoverage.exactLatestMeasurementUtc).toBe('2025-02-15');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.archiveCoverage.latestSolarLongitudeDeg).toBe(44.2);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.archiveCoverage.latestMartianYear).toBe(38);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.archiveIndexFiles[0].fileName).toBe('MAVEN_NGIMS_l2_del1-35.csv');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexFiles[0].fileName).toBe('MAVEN_NGIMS_Single-Species_del1-43.csv');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexFiles[0].revision).toBe('del1-43');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexFiles[0].lastModifiedUtc).toBe('2025-12-19');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexFiles[0].reportedFileSize).toBe('6.6 MB');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexFiles[0].mirroredUrls).toHaveLength(2);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexFiles[0].htmlCompanion.reportedFileSizeBytes).toBe(62);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexFiles[0].htmlCompanion.fullTableAvailable).toBe(false);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexFiles[0].role).toMatch(/not an L2 measurement table/);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.selectionIndexContentRetrieved).toBe(false);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.orbitProductScope.maximumSpacecraftAltitudeKm).toBe(500);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.l3AltitudeResamplingAvailability.generalAvailabilityEndsUtc).toBe('2020-07');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.l2AbundanceUnit).toBe('part/cm3');
  });

  it('records the newer PDS v41.0 Key Parameters coverage without promoting schema fields to observations', () => {
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.bundle.version).toBe('41.0');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.bundle.doi).toBe('10.17189/4sjk-t793');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.collection.doi).toBe('10.17189/1jfy-9a74');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.coverageUtc.start).toBe('2014-03-18T12:00:00.000Z');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.coverageUtc.stop).toBe('2025-12-05T11:59:52.000Z');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.exampleProduct.observationDateUtc).toBe('2025-06-10');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.exampleProduct.fileName).toBe('mvn_kp_insitu_20250610_v26_r01.tab');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.exampleProduct.reportedDirectorySize).toBe('43 MB');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.exampleProduct.productLabelRetrieved).toBe(false);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.exampleProduct.tableImportedIntoRepository).toBe(false);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT.fixedWidthAsciiSchema.sisRevision).toBe('5.2');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT.fixedWidthAsciiSchema.recordLengthBytes).toBe(3765);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT.fixedWidthAsciiSchema.O.density).toBe(2308);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT.fixedWidthAsciiSchema.CO.density).toBe(2356);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT.fixedWidthAsciiSchema.CO2.density).toBe(2548);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.neutralDensityFields.map((field) => field.species)).toEqual([
      'He', 'O', 'CO', 'N2', 'NO', 'Ar', 'CO2'
    ]);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.neutralDensityFields.find((field) => field.species === 'NO')?.status)
      .toBe('field_present_sis_declares_all_nan');
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.precision.upperLimitSentinel).toBe(-1);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.photochemicalNetworkCoverage.directlyRepresentedSpecies)
      .toEqual(['O', 'CO', 'CO2']);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.photochemicalNetworkCoverage.directSpeciesCount).toBe(3);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.photochemicalNetworkCoverage.note).toMatch(/all values set to NaN/i);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.limitations.join(' ')).toMatch(/all values set to NaN/i);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.photochemicalNetworkCoverage.totalNetworkSpeciesCount).toBe(16);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.neutralTemperature.lpwTemperatureIsNeutralGasTemperature).toBe(false);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.sampling.geometryFromSpice).toBe(true);
    expect(MAVEN_INSITU_KP_PDS_ARCHIVE.limitations.join(' ')).toMatch(/0\.5 or 42\.67 km/);
  });

  it('parses one SIS 5.2 fixed-width row and preserves the three neutral detection values', () => {
    const result = parseMavenInsituKeyParameterRecord(
      keyParameterRecord(),
      'mvn_kp_insitu_20250610_v26_r01.tab'
    );
    expect(result.status).toBe('parsed');
    if (result.status !== 'parsed') throw new Error(result.errors.join('; '));
    expect(result.row.sourceProductId).toBe('mvn_kp_insitu_20250610_v26_r01.tab');
    expect(result.row.timeUtc).toBe('2025-06-10T12:00:00.000Z');
    expect(result.row.geometry).toEqual({
      longitudeDeg: 123.4,
      latitudeDeg: -5,
      solarZenithAngleDeg: 75,
      localSolarTimeHours: 12.5,
      altitudeKm: 160,
      orbitNumber: 31000,
      direction: 'inbound',
      solarLongitudeDeg: 251
    });
    expect(result.row.neutralDensities.O).toMatchObject({
      numberDensityPerCm3: 1e6,
      precisionPercent1Sigma: 15,
      qualityFlag: 'D',
      reportedSigmaPerCm3: 150000,
      evidenceStatus: 'verified_detection'
    });
    expect(result.row.neutralDensities.CO.reportedSigmaPerCm3).toBe(400000);
    expect(result.row.neutralDensities.CO2.reportedSigmaPerCm3).toBe(900000);
    expect(result.row.eligibleAsMarsPhotochemicalInitialState).toBe(false);
  });

  it('keeps NGIMS precision=-1 as an upper limit and never treats it as a detection', () => {
    const result = parseMavenInsituKeyParameterRecord(keyParameterRecord({
      O_density: '5.0e5',
      O_precision: '-1'
    }), 'mvn_kp_insitu_20250610_v26_r01.tab');
    expect(result.status).toBe('parsed');
    if (result.status !== 'parsed') throw new Error(result.errors.join('; '));
    expect(result.row.neutralDensities.O.evidenceStatus).toBe('upper_limit');
    expect(result.row.neutralDensities.O.reportedSigmaPerCm3).toBeNull();
  });

  it('keeps preliminary quality, NaN density, and unknown quality distinct from verified detections', () => {
    const result = parseMavenInsituKeyParameterRecord(keyParameterRecord({
      O_quality: 'P',
      CO_density: 'NaN',
      CO_precision: 'NaN',
      CO_quality: 'P',
      CO2_quality: 'X'
    }), 'mvn_kp_insitu_20250610_v26_r01.tab');
    expect(result.status).toBe('parsed');
    if (result.status !== 'parsed') throw new Error(result.errors.join('; '));
    expect(result.row.neutralDensities.O.evidenceStatus).toBe('preliminary');
    expect(result.row.neutralDensities.CO).toMatchObject({
      numberDensityPerCm3: null,
      precisionPercent1Sigma: null,
      evidenceStatus: 'not_available'
    });
    expect(result.row.neutralDensities.CO2.evidenceStatus).toBe('quality_unverified');
  });

  it('rejects wrong record widths, non-ASCII bytes, invalid numbers, timestamps, and missing product identity', () => {
    expect(parseMavenInsituKeyParameterRecord('short', 'product').status).toBe('rejected');
    const unicode = keyParameterRecord().slice(0, 2307) + 'é' +
      keyParameterRecord().slice(2308);
    expect(parseMavenInsituKeyParameterRecord(unicode, 'product').status).toBe('rejected');
    expect(parseMavenInsituKeyParameterRecord(keyParameterRecord({ O_density: 'invalid' }), 'product').status)
      .toBe('rejected');
    expect(parseMavenInsituKeyParameterRecord(keyParameterRecord({ timeUtc: '2025-02-30T12:00:00' }), 'product').status)
      .toBe('rejected');
    expect(parseMavenInsituKeyParameterRecord(keyParameterRecord(), ' ').status).toBe('rejected');
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
    expect(unreliable.errors.map((error) => error.message).join(' ')).toMatch(/not usable for science/);
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


  it('parses a complete quoted CRLF NGIMS L2 CSV and retains per-row quality results', () => {
    const csv = [
      't_utc,tid,orbit,focusmode,alt,lst,long,lat,sza,mass,species,abundance,precision,quality',
      '"2016-04-07T06:00:00Z",12345,14016,osnb,155,18,120,53,75,16,O,12000000,0.15,IV',
      '"2016-04-07T06:00:01Z",12345,14016,osnb,156,18,120,53,75,16,O,11000000,0.20,IU'
    ].join('\r\n');

    const parsed = parseMavenNgimsL2NeutralCsvText('\uFEFF' + csv);
    expect(parsed.status).toBe('parsed');
    if (parsed.status !== 'parsed') throw new Error(parsed.errors.join('; '));
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.acceptedRowCount).toBe(1);
    expect(parsed.rejectedRowCount).toBe(1);
    expect(parsed.rows[0].validation.status).toBe('verified');
    expect(parsed.rows[1].validation.status).toBe('rejected');
  });

  it('rejects malformed CSV structure and missing required PDS columns', () => {
    expect(parseMavenNgimsL2NeutralCsvText('t_utc,tid,orbit')).toEqual({
      status: 'invalid_csv',
      errors: ['CSV must contain a header and at least one data record']
    });

    const missingColumn = [
      't_utc,tid,orbit,focusmode,alt,lst,long,lat,sza,mass,species,abundance,quality',
      '2016-04-07T06:00:00Z,12345,14016,osnb,155,18,120,53,75,16,O,12000000,IV'
    ].join('\n');
    const missing = parseMavenNgimsL2NeutralCsvText(missingColumn);
    expect(missing.status).toBe('invalid_csv');
    if (missing.status !== 'invalid_csv') throw new Error('missing columns must reject the CSV');
    expect(missing.errors.join(' ')).toMatch(/precision/);

    const unclosedQuote = [
      't_utc,tid,orbit,focusmode,alt,lst,long,lat,sza,mass,species,abundance,precision,quality',
      '"2016-04-07T06:00:00Z,12345,14016,osnb,155,18,120,53,75,16,O,12000000,0.15,IV'
    ].join('\n');
    expect(parseMavenNgimsL2NeutralCsvText(unclosedQuote)).toEqual({
      status: 'invalid_csv',
      errors: ['unterminated quoted CSV field']
    });
  });


  it('selects one homogeneous O profile from a mixed full-file L2 CSV', () => {
    const csv = [
      't_utc,tid,orbit,focusmode,alt,lst,long,lat,sza,mass,species,abundance,precision,quality',
      '2016-04-07T06:00:00Z,12345,14016,osnb,165,18,120,53,75,16,O,10000000,0.15,IV',
      '2016-04-07T06:00:01Z,12345,14016,osnb,145,18,120,53,75,16,O,14000000,0.15,IV',
      '2016-04-07T06:00:02Z,12345,14016,osnb,155,18,120,53,75,30,NO,3000000,0.20,IV'
    ].join('\n');
    const imported = parseMavenNgimsL2NeutralCsvText(csv);
    expect(imported.status).toBe('parsed');
    if (imported.status !== 'parsed') throw new Error(imported.errors.join('; '));

    const profile = buildMavenNgimsNeutralProfileFromCsvImport(imported, {
      species: 'O',
      orbit: 14016,
      tid: 12345,
      direction: 'inbound',
      quality: 'verified'
    });
    expect(profile.status).toBe('completed');
    if (profile.status !== 'completed') throw new Error(profile.errors?.join('; '));
    expect(profile.species).toBe('O');
    expect(profile.measurements?.map((measurement) => measurement.altitudeM)).toEqual([145000, 165000]);
    expect(profile.measurements?.every((measurement) => measurement.species === 'O')).toBe(true);
  });

  it('requires an exact homogeneous selection and rejects a selection without matching rows', () => {
    const csv = [
      't_utc,tid,orbit,focusmode,alt,lst,long,lat,sza,mass,species,abundance,precision,quality',
      '2016-04-07T06:00:00Z,12345,14016,osnb,145,18,120,53,75,16,O,14000000,0.15,IV',
      '2016-04-07T06:00:01Z,12345,14016,osnb,165,18,120,53,75,16,O,10000000,0.15,IV'
    ].join('\n');
    const imported = parseMavenNgimsL2NeutralCsvText(csv);
    if (imported.status !== 'parsed') throw new Error(imported.errors.join('; '));

    const missing = buildMavenNgimsNeutralProfileFromCsvImport(imported, {
      species: 'NO',
      orbit: 14016,
      tid: 12345,
      direction: 'inbound',
      quality: 'verified'
    });
    expect(missing.status).toBe('rejected');
    if (missing.status !== 'rejected') throw new Error('missing species selection must reject');
    expect(missing.errors?.join(' ')).toMatch(/no accepted rows/);
  });

  it('retains malformed row-width diagnostics instead of discarding records', () => {
    const csv = [
      't_utc,tid,orbit,focusmode,alt,lst,long,lat,sza,mass,species,abundance,precision,quality',
      '2016-04-07T06:00:00Z,12345,14016,osnb,155,18,120,53,75,16,O,12000000,0.15,IV',
      '2016-04-07T06:00:01Z,12345,14016,osnb,156,18,120,53,75,16,O,11000000,0.20'
    ].join('\n');
    const parsed = parseMavenNgimsL2NeutralCsvText(csv);
    expect(parsed.status).toBe('parsed');
    if (parsed.status !== 'parsed') throw new Error(parsed.errors.join('; '));
    expect(parsed.acceptedRowCount).toBe(1);
    expect(parsed.rejectedRowCount).toBe(1);
    expect(parsed.rows[1].validation.status).toBe('rejected');
    if (parsed.rows[1].validation.status !== 'rejected') throw new Error('short row must be rejected');
    expect(parsed.rows[1].validation.errors[0].message).toMatch(/expected 14/);
  });

  it('validates the source precision range and the NGIMS mass coverage', () => {
    expect(validateMavenNgimsL2NeutralRow(row({ precision: 1.01 })).status).toBe('rejected');
    expect(validateMavenNgimsL2NeutralRow(row({ mass: 1 })).status).toBe('rejected');
    expect(validateMavenNgimsL2NeutralRow(row({ abundance: Number.NaN })).status).toBe('rejected');
  });
});
