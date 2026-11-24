import { describe, expect, it } from 'vitest';
import {
  MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS,
  MAVEN_IUVS_NO_DAYGLOW_REFERENCE,
  MAVEN_NGIMS_PDS_ARCHIVE,
  MAVEN_INSITU_KP_PDS_ARCHIVE,
  MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT,
  MAVEN_NGIMS_L3_SCALE_HEIGHT_TEMPERATURE_PROVENANCE,
  MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE,
  linkMavenNgimsL2L3IndexEventWindow,
  parseMavenInsituKeyParameterRecord,
  parseMavenNgimsL3ScaleHeightTemperatureCsvRow,
  parseMavenNgimsL3ScaleHeightTemperatureCsvText,
  selectMavenNgimsL3ScaleHeightTemperatureRows,
  buildMavenNgimsNeutralProfile,
  buildMavenNgimsNeutralProfileFromCsvImport,
  parseMavenNgimsL2NeutralCsvRow,
  parseMavenNgimsL2NeutralCsvText,
  selectMavenNgimsL2EventWindowProfile,
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

function ngimsL2CsvText(rows: readonly MavenNgimsL2NeutralAbundanceRow[]): string {
  const headers = [
    't_utc', 'tid', 'orbit', 'focusmode', 'alt', 'lst', 'long',
    'lat', 'sza', 'mass', 'species', 'abundance', 'precision', 'quality'
  ] as const;
  return [
    headers.join(','),
    ...rows.map((record) => headers.map((header) => String(record[header])).join(','))
  ].join('\r\n');
}

function scaleHeightCsvRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    t_utc: '2025-06-10T12:00:00Z',
    t_unix: '1749556800',
    t_sclk: '123456789',
    t_tid: '120',
    tid: '45678',
    orbit: '31000',
    exo_alt: '180',
    mass: '44',
    species: 'CO2',
    scale_height: '10.5',
    scale_height_error: '0.8',
    temperature: '210',
    temperature_error: '16',
    fit_residual: '0.12',
    quality: 'HI',
    ...overrides
  };
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
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.fileName)
      .toBe('MAVEN_NGIMS_Scale-Height&Temp_del1-42.csv');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.revision).toBe('del1-42');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.role).toMatch(/not itself a temperature measurement file/);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.retrievalStatus)
      .toBe('html_index_rows_searchable_csv_payload_not_imported');
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

  it('records the current NGIMS scale-height index revision as selection metadata only', () => {
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.revision).toBe('del1-42');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.lastModifiedUtc).toBe('2025-08-14T10:04:00Z');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.reportedFileSize).toBe('3.1 MB');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.url).toContain('https://atmos.nmsu.edu/');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.htmlCompanion.reportedFileSize).toBe('9.0 MB');
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.htmlCompanion.fullTableAvailable).toBe(true);
    expect(MAVEN_NGIMS_PDS_ARCHIVE.temperatureSelectionIndex.mirrorNote).toMatch(/62-byte .htm stub/i);
    expect(MAVEN_NGIMS_L3_SCALE_HEIGHT_TEMPERATURE_PROVENANCE.method).toMatch(/linear fit of altitude versus log density/);
    expect(MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE).toMatchObject({
      tid: 14282,
      observationDateUtc: '2014-12-11',
      timeStartUtc: '2014-12-11T15:45:25.000Z',
      timeStopUtc: '2014-12-11T17:29:43.000Z',
      matching: {
        exactTidMatch: true,
        exactUtcWindowMatch: true,
        numericL2CsvImported: false,
        numericL3TemperatureCsvImported: false,
        schedulerInitialStateEligible: false
      }
    });
    expect(MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE.scaleHeightIndex.indexObservationGeometry).toMatchObject({
      closestApproachUtc: '2014-12-11T17:15:29.000Z',
      spacecraftAltitudeKm: 152.981,
      phaseAngleDeg: 112.218,
      orbitNumber: 391,
      marsSolarLongitudeDeg: 250.49,
      marsYear: 32,
      isIndexGeometryNotSpeciesMeasurement: true
    });
    expect(MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE.l2AbundanceProduct).toMatchObject({
      directoryReportedSize: '526 KB',
      focusMode: 'csn',
      neutralSpecies: ['Ar', 'CO2', 'He', 'N2'],
      productPayloadImported: false,
      labelPayloadImported: false
    });
    expect(MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE.l2AbundanceProduct.fileName)
      .toBe('mvn_ngi_l2_csn-abund-14282_20141211T154406_v08_r01.csv');
    expect(MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE.scaleHeightIndex.productId)
      .toContain('res-sht-14282_20141211t154406');
  });

  it('links one real L2/L3 NGIMS index candidate only on identical TID and UTC event window', () => {
    const candidate = MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE;
    const result = linkMavenNgimsL2L3IndexEventWindow(
      {
        sourceProductId: candidate.l2AbundanceProduct.productId,
        tid: candidate.tid,
        timeStartUtc: candidate.timeStartUtc,
        timeStopUtc: candidate.timeStopUtc
      },
      {
        sourceProductId: candidate.scaleHeightIndex.productId,
        tid: candidate.tid,
        timeStartUtc: candidate.timeStartUtc,
        timeStopUtc: candidate.timeStopUtc
      }
    );
    expect(result).toEqual({
      status: 'matched',
      tid: 14282,
      timeStartUtc: '2014-12-11T15:45:25.000Z',
      timeStopUtc: '2014-12-11T17:29:43.000Z',
      l2SourceProductId: candidate.l2AbundanceProduct.productId,
      l3SourceProductId: candidate.scaleHeightIndex.productId,
      coRegistrationBasis: 'same-tid-and-exact-time-window',
      eligibleAsMarsPhotochemicalInitialState: false
    });
  });

  it('rejects NGIMS L2/L3 links when TID or either endpoint of the time window differs', () => {
    const candidate = MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE;
    const l2 = {
      sourceProductId: candidate.l2AbundanceProduct.productId,
      tid: candidate.tid,
      timeStartUtc: candidate.timeStartUtc,
      timeStopUtc: candidate.timeStopUtc
    };
    const l3 = {
      sourceProductId: candidate.scaleHeightIndex.productId,
      tid: candidate.tid,
      timeStartUtc: candidate.timeStartUtc,
      timeStopUtc: candidate.timeStopUtc
    };
    expect(linkMavenNgimsL2L3IndexEventWindow(l2, { ...l3, tid: 14284 }).status).toBe('rejected');
    expect(linkMavenNgimsL2L3IndexEventWindow(l2, {
      ...l3, timeStopUtc: '2014-12-11T17:29:44Z'
    }).status).toBe('rejected');
    expect(linkMavenNgimsL2L3IndexEventWindow(l2, {
      ...l3, timeStartUtc: '2014-12-11T15:45:25.100Z'
    }).status).toBe('rejected');
    expect(linkMavenNgimsL2L3IndexEventWindow(l2, {
      ...l3, timeStartUtc: '2014-02-30T15:45:25Z'
    }).status).toBe('rejected');
  });

  it('selects one exact NGIMS L2 product/TID/orbit/focus-mode/species/track/quality/UTC profile', () => {
    const csv = ngimsL2CsvText([
      row({
        t_utc: '2014-12-11T15:45:25Z', tid: 14282, orbit: 391,
        focusmode: 'csn', species: 'CO2', alt: 150, quality: 'IV'
      }),
      row({
        t_utc: '2014-12-11T16:10:00Z', tid: 14282, orbit: 391,
        focusmode: 'csn', species: 'CO2', alt: 160, quality: 'IV'
      }),
      row({
        t_utc: '2014-12-11T17:29:43Z', tid: 14282, orbit: 391,
        focusmode: 'csn', species: 'CO2', alt: 170, quality: 'IV'
      }),
      row({
        t_utc: '2014-12-11T16:20:00Z', tid: 14284, orbit: 392,
        focusmode: 'csn', species: 'CO2', alt: 180, quality: 'IV'
      }),
      row({
        t_utc: '2014-12-11T16:25:00Z', tid: 14282, orbit: 391,
        focusmode: 'osnb', species: 'CO2', alt: 190, quality: 'IV'
      }),
      row({
        t_utc: '2014-12-11T16:30:00Z', tid: 14282, orbit: 391,
        focusmode: 'csn', species: 'O', alt: 200, mass: 16, quality: 'IV'
      }),
      row({
        t_utc: '2014-12-11T17:30:00Z', tid: 14282, orbit: 391,
        focusmode: 'csn', species: 'CO2', alt: 210, quality: 'IV'
      })
    ]);
    const imported = parseMavenNgimsL2NeutralCsvText(csv);
    expect(imported.status).toBe('parsed');
    if (imported.status !== 'parsed') throw new Error(imported.errors.join('; '));

    const result = selectMavenNgimsL2EventWindowProfile(imported, {
      sourceProductId: MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE.l2AbundanceProduct.productId,
      tid: 14282,
      orbit: 391,
      focusMode: 'csn',
      species: 'CO2',
      direction: 'inbound',
      quality: 'verified',
      timeStartUtc: '2014-12-11T15:45:25Z',
      timeStopUtc: '2014-12-11T17:29:43Z'
    });
    expect(result.status).toBe('completed');
    if (result.status !== 'completed') throw new Error(result.errors.join('; '));
    expect(result.profile.measurements).toHaveLength(3);
    expect(result.profile.measurements.map((measurement) => measurement.altitudeM))
      .toEqual([150000, 160000, 170000]);
    expect(result.profile.measurements.every((measurement) =>
      measurement.tid === 14282 &&
      measurement.orbit === 391 &&
      measurement.focusMode === 'csn' &&
      measurement.species === 'CO2'
    )).toBe(true);
    expect(result.excludedRows).toEqual({
      rejectedByRowValidation: 0,
      differentTid: 1,
      differentOrbit: 0,
      differentFocusMode: 1,
      differentSpecies: 1,
      differentDirection: 0,
      differentQuality: 0,
      outsideUtcWindow: 1
    });
    expect(result.eligibleAsMarsPhotochemicalInitialState).toBe(false);
  });

  it('rejects an event profile selector with a mismatched source window or fewer than two selected rows', () => {
    const imported = parseMavenNgimsL2NeutralCsvText(ngimsL2CsvText([
      row({
        t_utc: '2014-12-11T16:00:00Z', tid: 14282, orbit: 391,
        focusmode: 'csn', species: 'CO2', alt: 150, quality: 'IV'
      })
    ]));
    expect(imported.status).toBe('parsed');
    if (imported.status !== 'parsed') throw new Error(imported.errors.join('; '));
    const result = selectMavenNgimsL2EventWindowProfile(imported, {
      sourceProductId: 'mvn_ngi_l2_csn-abund-14282_20141211T154406_v08_r01.csv',
      tid: 14282,
      orbit: 391,
      focusMode: 'csn',
      species: 'CO2',
      direction: 'inbound',
      quality: 'verified',
      timeStartUtc: '2014-12-11T15:45:25Z',
      timeStopUtc: '2014-12-11T17:29:43Z'
    });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.errors.join(' ')).toMatch(/fewer than two rows/);
      expect(result.excludedRows?.differentTid).toBe(0);
    }
  });

  it('parses the SIS 1.13 Table A-10 derived scale-height temperature without upgrading it to a local observation', () => {
    const result = parseMavenNgimsL3ScaleHeightTemperatureCsvRow(
      scaleHeightCsvRow(),
      'urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-sht-31000_20250610t120000'
    );
    expect(result.status).toBe('parsed');
    if (result.status !== 'parsed') throw new Error(result.errors.join('; '));
    expect(result.row).toMatchObject({
      timeUtc: '2025-06-10T12:00:00.000Z',
      tid: 45678,
      orbit: 31000,
      exobaseAltitudeKm: 180,
      massAmu: 44,
      species: 'CO2',
      scaleHeightKm: 10.5,
      scaleHeightFitErrorKm: 0.8,
      scaleHeightTemperatureK: 210,
      temperatureFitErrorK: 16,
      qualityFlag: 'HI',
      fitQuality: 'good_near_isothermic_fit',
      evidenceKind: 'derived_scale_height_temperature',
      eligibleAsLocalNeutralTemperatureObservation: false,
      eligibleAsMarsPhotochemicalInitialState: false
    });
    expect(result.row.diagnostics.join(' ')).toMatch(/not a direct point measurement/);
  });

  it('preserves all SIS scale-height quality classes, including H0 do-not-use', () => {
    const cases = [
      ['HI', 'good_near_isothermic_fit'],
      ['HW', 'structured_or_wavy_fit'],
      ['HA', 'high_altitude_fit'],
      ['H0', 'bad_or_negative_fit_do_not_use']
    ] as const;
    for (const [quality, fitQuality] of cases) {
      const overrides: Record<string, string> = quality === 'H0'
        ? { quality, scale_height: '-10.5', temperature: '-210' }
        : { quality };
      const result = parseMavenNgimsL3ScaleHeightTemperatureCsvRow(
        scaleHeightCsvRow(overrides),
        'maven-ngims-l3-scale-height-test-product'
      );
      expect(result.status).toBe('parsed');
      if (result.status === 'parsed') {
        expect(result.row.fitQuality).toBe(fitQuality);
        if (quality === 'H0') {
          expect(result.row.scaleHeightKm).toBe(-10.5);
          expect(result.row.scaleHeightTemperatureK).toBe(-210);
          expect(result.row.diagnostics.join(' ')).toMatch(/retained only for audit/);
        }
      }
    }
  });

  it('imports the full Table A-10 CSV schema and selects only an exact species/TID/orbit/quality group', () => {
    const headers = [
      't_utc', 't_unix', 't_sclk', 't_tid', 'tid', 'orbit', 'exo_alt', 'mass',
      'species', 'scale_height', 'Scale_height_error', 'temperature',
      'temperature_error', 'Fit_residual', 'Quality'
    ];
    const serialize = (row: Record<string, string>): string =>
      headers.map((header) => row[header.toLowerCase()] ?? '').join(',');
    const csv = [
      headers.join(','),
      serialize(scaleHeightCsvRow()),
      serialize(scaleHeightCsvRow({ t_utc: '2025-06-10T12:00:01Z', species: 'O', mass: '16' })),
      serialize(scaleHeightCsvRow({ t_utc: '2025-06-10T12:00:02Z', quality: 'HW' })),
      serialize(scaleHeightCsvRow({ t_utc: '2025-06-10T12:00:03Z', tid: '45679' }))
    ].join('\r\n');
    const imported = parseMavenNgimsL3ScaleHeightTemperatureCsvText(
      '\uFEFF' + csv,
      'maven-ngims-l3-scale-height-test-product'
    );
    expect(imported.status).toBe('parsed');
    if (imported.status !== 'parsed') throw new Error(imported.errors.join('; '));
    expect(imported.parsedRowCount).toBe(4);
    expect(imported.goodFitCount).toBe(3);
    const selected = selectMavenNgimsL3ScaleHeightTemperatureRows(imported, {
      tid: 45678, orbit: 31000, species: 'CO2', qualityFlag: 'HI'
    });
    expect(selected.status).toBe('completed');
    if (selected.status !== 'completed') throw new Error(selected.errors.join('; '));
    expect(selected.rows).toHaveLength(1);
    expect(selected.rows[0].species).toBe('CO2');
    expect(selectMavenNgimsL3ScaleHeightTemperatureRows(imported, {
      tid: 45678, orbit: 31000, species: 'NO', qualityFlag: 'HI'
    }).status).toBe('rejected');
  });

  it('rejects invalid UTC dates, unsupported H mass, negative fit errors and malformed L3 CSV headers', () => {
    expect(parseMavenNgimsL3ScaleHeightTemperatureCsvRow(
      scaleHeightCsvRow({ t_utc: '2025-02-30T12:00:00Z' }),
      'product'
    ).status).toBe('rejected');
    expect(parseMavenNgimsL3ScaleHeightTemperatureCsvRow(
      scaleHeightCsvRow({ species: 'H', mass: '1' }),
      'product'
    ).status).toBe('rejected');
    expect(parseMavenNgimsL3ScaleHeightTemperatureCsvRow(
      scaleHeightCsvRow({ temperature_error: '-1' }),
      'product'
    ).status).toBe('rejected');
    const incomplete = parseMavenNgimsL3ScaleHeightTemperatureCsvText(
      't_utc,tid,orbit\n2025-06-10T12:00:00Z,1,1',
      'product'
    );
    expect(incomplete.status).toBe('invalid_csv');
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
