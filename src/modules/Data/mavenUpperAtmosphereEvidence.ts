// ============================================
// MAVEN UPPER-ATMOSPHERE EVIDENCE (Stage 4.2)
// ============================================
//
// Source-specific records and a fail-closed reader contract for NGIMS
// L2 neutral abundance rows. No observations from different orbits,
// seasons, instruments, or retrieval methods are merged automatically.
//
// NGIMS SIS Rev 1.13 (2022-10-30), PDS Atmospheres Node:
// - L2 neutral rows: altitude [km], abundance [part/cm3], precision
//   [fractional 1-sigma], quality IV/IU/OV/OU/UR.
// - L3 resampled rows: altitude-resampled densities [part/cm3] and
//   quality flags; they are not the same product as single-orbit L2.
// - NGIMS mass coverage is 2–150 Da (atomic H is outside the range).

export interface MavenUpperAtmosphereProvenance {
  readonly sourceName: string;
  readonly sourceId: string;
  readonly reference: string;
  readonly method: string;
  readonly applicability: string;
  readonly limitations: string;
}

export const MAVEN_NGIMS_PDS_SIS_PROVENANCE: MavenUpperAtmosphereProvenance = {
  sourceName: 'MAVEN NGIMS PDS Software Interface Specification, Revision 1.13',
  sourceId: 'MAVEN-NGIMS-SIS-0001',
  reference: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/document/ngims_pds_sis_v03_r01.pdf',
  method: 'PDS product contract for NGIMS L2 neutral single-species abundance and L3 altitude-resampled density products',
  applicability: 'MAVEN NGIMS upper-atmosphere observations; L2 single-species abundance is sampled along a spacecraft orbit; L3 resampled densities are averaged/interpolated on equal-pressure-altitude bins',
  limitations: 'A product schema is not itself a measured profile. Quality flags must be retained. L2 and L3 products are different data products. NGIMS measures mass-to-charge from 2 to 150 Da, so atomic hydrogen (1 Da) is outside the instrument mass range.'
};

export const MAVEN_NGIMS_PDS_ARCHIVE = {
  archive: 'NASA Planetary Data System, Planetary Atmospheres Node',
  archiveUrl: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims.html',
  dataSearchUrl: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims_data_search.html',
  archiveCoverage: {
    latestAnnualCollectionYearListed: 2025,
    annual2025AbundancesSize: '308 MB',
    exactLatestMeasurementUtc: '2025-02-15',
    latestSolarLongitudeDeg: 44.2,
    latestMartianYear: 38,
    note: 'The PDS NGIMS landing page explicitly states that currently available data extend through 2025-02-15 (Ls 44.2, MY 38). The annual 2025 abundance collection size is 308 MB. The Single-Species selector modification date (2025-12-19) is a product-index revision timestamp, not the observation end date.',
    source: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims.html'
  },
  archiveIndexFiles: [
    {
      product: 'Legacy L2 neutral single-species abundance index locator',
      fileName: 'MAVEN_NGIMS_l2_del1-35.csv',
      revision: 'del1-35',
      lastModifiedUtc: '2023-11-15',
      url: 'https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_NGIMS_l2_del1-35.csv',
      note: 'Historical locator retained for provenance; it is not the current index linked by the PDS NGIMS archive page.'
    }
  ] as const,
  selectionIndexFiles: [
    {
      product: 'PDS Single species abundance product-selection index',
      fileName: 'MAVEN_NGIMS_Single-Species_del1-43.csv',
      revision: 'del1-43',
      url: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_NGIMS_Single-Species_del1-43.csv',
      mirroredUrls: [
        'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_NGIMS_Single-Species_del1-43.csv',
        'https://atmos-ah-vs.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_NGIMS_Single-Species_del1-43.csv'
      ],
      lastModifiedUtc: '2025-12-19',
      reportedFileSize: '6.6 MB',
      htmlCompanion: {
        fileName: 'MAVEN_NGIMS_Single-Species_del1-43.htm',
        lastModifiedUtc: '2026-11-16',
        reportedFileSizeBytes: 62,
        fullTableAvailable: false,
        note: 'The directory reports only a 62-byte .htm companion; it is a stub, not an HTML rendering of the CSV index.'
      },
      role: 'Selection metadata and product identifiers/URNs; not an L2 measurement table and not valid input to parseMavenNgimsL2NeutralCsvText().',
      retrievalStatus: 'content_not_retrieved_in_this_environment',
      linkedFrom: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims.html'
    }
  ] as const,
  temperatureSelectionIndex: {
    product: 'NGIMS scale heights and temperatures product-selection index',
    fileName: 'MAVEN_NGIMS_Scale-Height&Temp_del1-42.csv',
    revision: 'del1-42',
    url: 'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_NGIMS_Scale-Height%26Temp_del1-42.csv',
    linkedFrom: 'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims.html',
    lastModifiedUtc: '2025-08-14T10:04:00Z',
    reportedFileSize: '3.1 MB',
    htmlCompanion: {
      fileName: 'MAVEN_NGIMS_Scale-Height&Temp_del1-42.htm',
      lastModifiedUtc: '2026-11-16T10:09:00Z',
      reportedFileSize: '9.0 MB',
      fullTableAvailable: true,
      searchableIndexRowsVerified: true
    },
    mirrorNote: 'The pds-atmospheres.nmsu.edu mirror currently exposes a 62-byte .htm stub; the canonical atmos.nmsu.edu archive exposes the full ~9.0 MB HTML rendering and search-indexed data rows.',
    role: 'Current NGIMS scale-height/temperature product-selection index; it identifies per-orbit derived products but is not itself a temperature measurement file.',
    retrievalStatus: 'html_index_rows_searchable_csv_payload_not_imported'
  },
  dataProductArchiveFormat: 'ASCII tables with detached XML labels',
  orbitProductScope: {
    description: 'One or two science-product files span one MAVEN orbit',
    maximumSpacecraftAltitudeKm: 500,
    source: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims_data_search.html'
  },
  l3AltitudeResamplingAvailability: {
    generalAvailabilityEndsUtc: '2020-07',
    exception: 'Occasional products may still be generated when periapsis dips below 190 km and atmosphere/density profiles permit.',
    implication: 'For later MAVEN years, do not require L3 altitude-resampled abundance; select the orbit-specific L2 single-species products instead.',
    source: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims.html'
  },
  retrievalMethods: [
    'Download the relevant product index, select product URNs, and submit the revised URN list.',
    'Use the PDS parameter/time-range selector to request limited product files.'
  ] as const,
  selectionIndexContentRetrieved: false,
  availableProducts: ['L1A raw', 'L1B calibrated', 'L2 single-species abundance', 'L3 altitude-resampled abundance', 'L3 scale heights and temperatures'] as const,
  neutralSpeciesOfInterest: ['O', 'NO', 'CO2', 'N2', 'CO', 'O2', 'Ar', 'N', 'He'] as const,
  l2NeutralColumns: [
    't_utc', 't_unix', 't_sclk', 't_tid', 'tid', 'orbit', 'focusmode',
    'alt', 'lst', 'long', 'lat', 'sza', 'mass', 'species',
    'cps_dt_bkgd', 'abundance', 'precision', 'quality'
  ] as const,
  l2AbundanceUnit: 'part/cm3',
  l2PrecisionMeaning: 'fractional one-sigma relative error on abundance; PDS SIS describes the field as percent error and constrains it to [0,1]',
  l3DensityColumn: 'density_bins',
  l3DensityUnit: 'part/cm3',
  l3Caveat: 'L3 resampled abundance is interpolated to equal-pressure altitude and averaged in constant log-density bins; it must not be mistaken for an individual raw L2 measurement.',
  provenance: MAVEN_NGIMS_PDS_SIS_PROVENANCE
} as const;

/**
 * Newer PDS/PPI in-situ Key Parameters collection (bundle v41.0).
 * This is an averaged, uniformly sampled L2-derived daily product, not the
 * native single-orbit NGIMS L2 abundance file. The example label is useful
 * for schema/evidence auditing; the full .tab payload is not imported here.
 */
export const MAVEN_INSITU_KP_PDS_ARCHIVE = {
  archive: 'NASA Planetary Data System, Planetary Plasma Interactions Node',
  bundle: {
    name: 'MAVEN Insitu Key Parameters Data Bundle',
    logicalIdentifier: 'urn:nasa:pds:maven.insitu.calibrated',
    version: '41.0',
    doi: '10.17189/4sjk-t793',
    publicationYear: 2026,
    description: 'Selected fully calibrated Level 2 data from the MAVEN Particles and Fields package and NGIMS, together with SPICE ephemeris information; values are in physical units and sampled/averaged at a uniform cadence.',
    source: 'https://pds.nasa.gov/ds-view/pds/viewBundle.jsp?identifier=urn%3Anasa%3Apds%3Amaven.insitu.calibrated&version=41.0'
  },
  collection: {
    name: 'MAVEN Insitu Key Parameters Data Collection',
    logicalIdentifier: 'urn:nasa:pds:maven.insitu.calibrated:data.kp',
    version: '41.0',
    doi: '10.17189/1jfy-9a74',
    source: 'https://search-pdsppi.igpp.ucla.edu/search/view/?f=null&id=pds%3A%2F%2FPPI%2Fmaven.insitu.calibrated%2Fdata'
  },
  coverageUtc: {
    start: '2014-03-18T12:00:00.000Z',
    stop: '2025-12-05T11:59:52.000Z'
  },
  exampleProduct: {
    observationDateUtc: '2025-06-10',
    fileName: 'mvn_kp_insitu_20250610_v26_r01.tab',
    labelFileName: 'mvn_kp_insitu_20250610_v26_r01.xml',
    logicalIdentifier: 'urn:nasa:pds:maven.insitu.calibrated:data.kp:mvn_kp_insitu_20250610',
    reportedDirectorySize: '43 MB',
    source: 'https://pds-ppi.igpp.ucla.edu/data/maven-insitu-calibrated/data/2025/06/',
    productLabelRetrieved: false,
    tableImportedIntoRepository: false
  },
  sampling: {
    description: 'Uniformly sampled/averaged key-parameter time series derived from instrument Level 2 products; not identical to the native NGIMS single-orbit abundance product.',
    geometryFromSpice: true,
    spacecraftAltitudeField: 'SPICE:Spacecraft altitude w.r.t. ellipsoid',
    orbitField: 'SPICE:Orbit Number',
    inboundOutboundField: 'SPICE:Inbound/Outbound Flag',
    solarLongitudeField: 'SPICE:Mars Season (Ls)',
    solarZenithAngleField: 'SPICE:Spacecraft solar zenith angle',
    localTimeField: 'SPICE:Spacecraft local time',
    latitudeField: 'SPICE:Spacecraft GEO Latitude',
    longitudeField: 'SPICE:Spacecraft GEO Longitude'
  },
  neutralDensityFields: [
    { species: 'He', networkSpeciesId: null, status: 'field_present' },
    { species: 'O', networkSpeciesId: 'O', status: 'field_present' },
    { species: 'CO', networkSpeciesId: 'CO', status: 'field_present' },
    { species: 'N2', networkSpeciesId: null, status: 'field_present' },
    { species: 'NO', networkSpeciesId: null, status: 'field_present_sis_declares_all_nan' },
    { species: 'Ar', networkSpeciesId: null, status: 'field_present' },
    { species: 'CO2', networkSpeciesId: 'CO2', status: 'field_present' }
  ],
  precision: {
    fieldName: 'NGIMS:Precision',
    meaning: 'Percent error (1 sigma) for the corresponding density field.',
    upperLimitSentinel: -1,
    upperLimitMeaning: 'The corresponding density value is an upper limit, not a positive detection.',
    qualityFieldName: 'NGIMS:Precision quality',
    qualityFlags: ['IV', 'IU', 'OV', 'OU', 'UR'],
    verifiedFlags: ['IV', 'OV'],
    uncertainFlags: ['IU', 'OU'],
    unreliableFlag: 'UR'
  },
  neutralTemperature: {
    presentInInsituKeyParameterNgimsDensityRows: false,
    lpwTemperatureField: 'LPW:Electron Temperature',
    lpwTemperatureIsNeutralGasTemperature: false,
    separateNgimsProduct: 'Scale-heights and temperatures',
    interpretation: 'The LPW field is electron temperature and cannot be substituted for neutral-gas temperature. NGIMS scale-height/temperature products are separate derived products and require their own event/geometry/provenance matching.'
  },
  photochemicalNetworkCoverage: {
    directlyRepresentedSpecies: ['O', 'CO', 'CO2'],
    directSpeciesCount: 3,
    totalNetworkSpeciesCount: 16,
    missingNetworkSpecies: [
      'O1D', 'O2', 'O3', 'H', 'H2', 'H2O', 'OH',
      'HO2', 'H2O2', 'CH4', 'CH3', 'CH3O', 'HCHO'
    ],
    note: 'NO is not a species in the current 16-species gas-phase network. MAVEN Key Parameter PDS Archive SIS Rev. 5.2 explicitly defines the NO density, precision and quality fields as removed by the NGIMS team with all values set to NaN. The 2025 product label retains the fixed-width field definitions, but that does not make them measurements.'
  },
  limitations: [
    'This is a schema and archive-coverage record, not an imported numerical observation set; no full .tab rows are checked into this repository.',
    'The key-parameter table offers only three named neutral-density species that overlap the current 16-species network (O, CO, CO2); no complete initial vector can be formed from it.',
    'The Key Parameter PDS Archive SIS Rev. 5.2 says the NO density, precision and quality fields were removed by NGIMS and all values set to NaN. A field definition in a product label is not evidence of a positive NO detection.',
    'The precision sentinel -1 denotes an upper limit and must not be promoted to a measured point concentration.',
    'The inspected table contains LPW electron temperature, not a co-registered neutral-gas temperature; the separate NGIMS scale-height/temperature product must be independently selected and validated.',
    'MAVEN/NGIMS samples the upper atmosphere along an orbital spacecraft track; it does not provide direct measurements at the Taysum Table B2 lower-atmosphere nodes 0.5 or 42.67 km.',
    'H is outside NGIMS mass coverage (2–150 Da), and O2+ fields are ion measurements rather than neutral O2 number density.'
  ],
  provenance: {
    sourceName: 'MAVEN Insitu Key Parameters Data Bundle, PDS version 41.0',
    sourceId: 'urn:nasa:pds:maven.insitu.calibrated::41.0 / DOI:10.17189/4sjk-t793',
    reference: 'https://pds.nasa.gov/ds-view/pds/viewBundle.jsp?identifier=urn%3Anasa%3Apds%3Amaven.insitu.calibrated&version=41.0',
    method: 'PDS L2-derived uniformly sampled key-parameter data with SPICE geometry; NGIMS abundance and precision fields retained as distinct measurements/flags',
    applicability: 'MAVEN in-situ upper-atmosphere observations, 2014-03-18 through 2025-12-05',
    limitations: 'The record documents archive metadata and an inspected product schema. It does not import a numerical product, does not provide a complete 16-species vector, lacks neutral-gas temperature in the inspected table, and cannot meet the Table B2 lower-atmosphere altitude nodes.'
  }
} as const;

export const MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT = {
  fixedWidthAsciiSchema: {
    sisRevision: '5.2',
    recordLengthBytes: 3765,
    fieldWidthBytes: 16,
    source: 'https://pds-ppi.igpp.ucla.edu/data/maven-insitu-calibrated/document/maven_sis_kp_insitu_r05.2.pdf',
    bytePositionsAreOneBased: true,
    timeUtc: { start: 1, length: 19 },
    O: { density: 2308, precisionPercent: 2324, quality: 2340 },
    CO: { density: 2356, precisionPercent: 2372, quality: 2388 },
    CO2: { density: 2548, precisionPercent: 2564, quality: 2580 },
    longitudeDeg: 3076,
    latitudeDeg: 3092,
    solarZenithAngleDeg: 3108,
    localSolarTimeHours: 3124,
    altitudeKm: 3140,
    orbitNumber: 3348,
    inboundOutboundFlag: 3364,
    solarLongitudeDeg: 3380
  },
} as const;


// ============================================
// MAVEN INSITU KEY-PARAMETER FIXED-WIDTH READER
// ============================================

export type MavenInsituKeyParameterSpecies = 'O' | 'CO' | 'CO2';

export type MavenInsituKeyParameterEvidenceStatus =
  | 'verified_detection'
  | 'upper_limit'
  | 'preliminary'
  | 'not_available'
  | 'non_positive'
  | 'quality_unverified';

export interface MavenInsituKeyParameterSpeciesValue {
  readonly species: MavenInsituKeyParameterSpecies;
  /** NGIMS neutral abundance in particles cm^-3, as reported by PDS. */
  readonly numberDensityPerCm3: number | null;
  /** PDS NGIMS precision is a percent 1-sigma relative error, not a fraction. */
  readonly precisionPercent1Sigma: number | null;
  readonly qualityFlag: 'D' | 'P' | null;
  readonly reportedSigmaPerCm3: number | null;
  readonly evidenceStatus: MavenInsituKeyParameterEvidenceStatus;
}

export interface MavenInsituKeyParameterGeometry {
  readonly longitudeDeg: number | null;
  readonly latitudeDeg: number | null;
  readonly solarZenithAngleDeg: number | null;
  readonly localSolarTimeHours: number | null;
  readonly altitudeKm: number | null;
  readonly orbitNumber: number | null;
  readonly direction: 'inbound' | 'outbound' | null;
  readonly solarLongitudeDeg: number | null;
}

export interface MavenInsituKeyParameterRow {
  readonly sourceProductId: string;
  readonly timeUtc: string;
  readonly geometry: MavenInsituKeyParameterGeometry;
  readonly neutralDensities: Readonly<Record<MavenInsituKeyParameterSpecies, MavenInsituKeyParameterSpeciesValue>>;
  /** Key Parameters are upper-atmosphere orbital rows, not Table B2 lower-atmosphere initial states. */
  readonly eligibleAsMarsPhotochemicalInitialState: false;
  readonly diagnostics: readonly string[];
}

export type MavenInsituKeyParameterParseResult =
  | { readonly status: 'parsed'; readonly row: MavenInsituKeyParameterRow }
  | { readonly status: 'rejected'; readonly errors: readonly string[] };

type MavenInsituFieldValue =
  | { readonly status: 'value'; readonly value: number }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid'; readonly raw: string };

function readMavenInsituFixedField(
  record: string,
  startByteOneBased: number,
  lengthBytes: number
): string {
  return record.slice(startByteOneBased - 1, startByteOneBased - 1 + lengthBytes).trim();
}

function parseMavenInsituNumericField(raw: string): MavenInsituFieldValue {
  if (raw.trim() === '' || /^NaN$/i.test(raw.trim())) return { status: 'missing' };
  const value = Number(raw.trim());
  return Number.isFinite(value)
    ? { status: 'value', value }
    : { status: 'invalid', raw };
}

function parseMavenInsituDensity(
  record: string,
  species: MavenInsituKeyParameterSpecies,
  positions: { readonly density: number; readonly precisionPercent: number; readonly quality: number }
): MavenInsituKeyParameterSpeciesValue {
  const densityRaw = readMavenInsituFixedField(record, positions.density, 16);
  const precisionRaw = readMavenInsituFixedField(record, positions.precisionPercent, 16);
  const qualityRaw = readMavenInsituFixedField(record, positions.quality, 16);
  const density = parseMavenInsituNumericField(densityRaw);
  const precision = parseMavenInsituNumericField(precisionRaw);
  const qualityFlag = qualityRaw === 'D' || qualityRaw === 'P' ? qualityRaw : null;

  if (density.status === 'invalid' || precision.status === 'invalid') {
    throw new Error('invalid numeric NGIMS field for ' + species);
  }
  if (precision.status === 'value' && precision.value < -1) {
    throw new Error('NGIMS precision for ' + species + ' must be -1 (upper limit) or non-negative percent');
  }
  if (density.status === 'value' && density.value < 0) {
    throw new Error('NGIMS density for ' + species + ' cannot be negative');
  }

  const numberDensityPerCm3 = density.status === 'value' ? density.value : null;
  const precisionPercent1Sigma = precision.status === 'value' ? precision.value : null;
  let evidenceStatus: MavenInsituKeyParameterEvidenceStatus;
  let reportedSigmaPerCm3: number | null = null;

  if (numberDensityPerCm3 === null) {
    evidenceStatus = 'not_available';
  } else if (precisionPercent1Sigma === -1) {
    evidenceStatus = numberDensityPerCm3 > 0 ? 'upper_limit' : 'non_positive';
  } else if (numberDensityPerCm3 <= 0) {
    evidenceStatus = 'non_positive';
  } else if (precisionPercent1Sigma === null || qualityFlag === null) {
    evidenceStatus = 'quality_unverified';
  } else if (qualityFlag === 'P') {
    evidenceStatus = 'preliminary';
  } else {
    evidenceStatus = 'verified_detection';
    reportedSigmaPerCm3 = numberDensityPerCm3 * precisionPercent1Sigma / 100;
  }

  return {
    species,
    numberDensityPerCm3,
    precisionPercent1Sigma,
    qualityFlag,
    reportedSigmaPerCm3,
    evidenceStatus
  };
}

/**
 * Parse one fixed-width PDS Key Parameters data record using SIS Rev. 5.2
 * one-based byte positions. This parser consumes a data row only, not the
 * detached XML label or any leading file/header bytes. It preserves upper
 * limits and preliminary rows as such; it never creates Scheduler inventory.
 */
export function parseMavenInsituKeyParameterRecord(
  rawRecord: string,
  sourceProductId: string
): MavenInsituKeyParameterParseResult {
  if (typeof rawRecord !== 'string') {
    return { status: 'rejected', errors: ['record must be a string'] };
  }
  const record = rawRecord.endsWith('\r\n')
    ? rawRecord.slice(0, -2)
    : rawRecord.endsWith('\n') || rawRecord.endsWith('\r')
      ? rawRecord.slice(0, -1)
      : rawRecord;
  if (typeof sourceProductId !== 'string' || sourceProductId.trim() === '') {
    return { status: 'rejected', errors: ['sourceProductId must identify the exact PDS product'] };
  }
  if (record.length !== MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT.fixedWidthAsciiSchema.recordLengthBytes) {
    return {
      status: 'rejected',
      errors: ['record must contain exactly ' + MAVEN_INSITU_KP_PDS_ARCHIVE_LAYOUT.fixedWidthAsciiSchema.recordLengthBytes + ' ASCII bytes']
    };
  }
  if ([...record].some((character) => character.charCodeAt(0) > 0x7f)) {
    return { status: 'rejected', errors: ['PDS Key Parameter rows must be 7-bit ASCII'] };
  }

  const timeRaw = readMavenInsituFixedField(record, 1, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(timeRaw)) {
    return { status: 'rejected', errors: ['TIME (UTC/SCET) must use YYYY-MM-DDTHH:mm:ss'] };
  }
  const timestamp = Date.parse(timeRaw + 'Z');
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 19) !== timeRaw
  ) {
    return { status: 'rejected', errors: ['TIME (UTC/SCET) is not a valid calendar UTC timestamp'] };
  }

  const readGeometry = (field: number): MavenInsituFieldValue =>
    parseMavenInsituNumericField(readMavenInsituFixedField(record, field, 16));
  const geometryFields = {
    longitudeDeg: readGeometry(3076),
    latitudeDeg: readGeometry(3092),
    solarZenithAngleDeg: readGeometry(3108),
    localSolarTimeHours: readGeometry(3124),
    altitudeKm: readGeometry(3140),
    orbitNumber: readGeometry(3348),
    solarLongitudeDeg: readGeometry(3380)
  };
  const diagnostics: string[] = [];
  const invalidGeometry = Object.entries(geometryFields)
    .filter(([, value]) => value.status === 'invalid')
    .map(([field]) => field + ' is not a finite numeric field');
  if (invalidGeometry.length > 0) {
    return { status: 'rejected', errors: invalidGeometry };
  }
  const geometryValue = (field: keyof typeof geometryFields): number | null => {
    const value = geometryFields[field];
    return value.status === 'value' ? value.value : null;
  };
  const orbitNumberValue = geometryValue('orbitNumber');
  const directionRaw = readMavenInsituFixedField(record, 3364, 16);
  const direction = directionRaw === 'I'
    ? 'inbound'
    : directionRaw === 'O'
      ? 'outbound'
      : null;

  const geometry: MavenInsituKeyParameterGeometry = {
    longitudeDeg: geometryValue('longitudeDeg'),
    latitudeDeg: geometryValue('latitudeDeg'),
    solarZenithAngleDeg: geometryValue('solarZenithAngleDeg'),
    localSolarTimeHours: geometryValue('localSolarTimeHours'),
    altitudeKm: geometryValue('altitudeKm'),
    orbitNumber: orbitNumberValue,
    direction,
    solarLongitudeDeg: geometryValue('solarLongitudeDeg')
  };
  if (Object.values(geometry).some((value) => value === null)) {
    diagnostics.push('One or more SPICE geometry fields are absent; this row cannot be used for geometry-based co-registration.');
  }
  if (orbitNumberValue !== null && !Number.isInteger(orbitNumberValue)) {
    return { status: 'rejected', errors: ['SPICE orbit number must be an integer'] };
  }
  if (geometry.altitudeKm !== null && geometry.altitudeKm <= 0) {
    return { status: 'rejected', errors: ['SPICE spacecraft altitude must be positive km'] };
  }
  if (geometry.solarZenithAngleDeg !== null &&
      (geometry.solarZenithAngleDeg < 0 || geometry.solarZenithAngleDeg > 180)) {
    return { status: 'rejected', errors: ['SPICE solar zenith angle must be within [0,180] degrees'] };
  }
  if (geometry.localSolarTimeHours !== null &&
      (geometry.localSolarTimeHours < 0 || geometry.localSolarTimeHours >= 24)) {
    return { status: 'rejected', errors: ['SPICE local solar time must be within [0,24) hours'] };
  }
  if (geometry.latitudeDeg !== null &&
      (geometry.latitudeDeg < -90 || geometry.latitudeDeg > 90)) {
    return { status: 'rejected', errors: ['SPICE latitude must be within [-90,90] degrees'] };
  }
  if (geometry.solarLongitudeDeg !== null &&
      (geometry.solarLongitudeDeg < 0 || geometry.solarLongitudeDeg >= 360)) {
    return { status: 'rejected', errors: ['SPICE solar longitude must be within [0,360) degrees'] };
  }
  if (direction === null) diagnostics.push('SPICE inbound/outbound flag is absent or unrecognized.');

  try {
    const neutralDensities = {
      O: parseMavenInsituDensity(record, 'O', { density: 2308, precisionPercent: 2324, quality: 2340 }),
      CO: parseMavenInsituDensity(record, 'CO', { density: 2356, precisionPercent: 2372, quality: 2388 }),
      CO2: parseMavenInsituDensity(record, 'CO2', { density: 2548, precisionPercent: 2564, quality: 2580 })
    } as const;
    return {
      status: 'parsed',
      row: {
        sourceProductId,
        timeUtc: new Date(timestamp).toISOString(),
        geometry,
        neutralDensities,
        eligibleAsMarsPhotochemicalInitialState: false,
        diagnostics
      }
    };
  } catch (error) {
    return {
      status: 'rejected',
      errors: [error instanceof Error ? error.message : 'unknown NGIMS Key Parameter row error']
    };
  }
}

export type MavenNgimsNeutralQuality = 'IV' | 'IU' | 'OV' | 'OU' | 'UR';
export type MavenNgimsFocusMode = 'csn' | 'osnb' | 'osion' | 'osnt';

export interface MavenNgimsL2NeutralAbundanceRow {
  readonly t_utc: string;
  readonly tid: number;
  readonly orbit: number;
  readonly focusmode: MavenNgimsFocusMode;
  readonly alt: number;
  readonly lst: number;
  readonly long: number;
  readonly lat: number;
  readonly sza: number;
  readonly mass: number;
  readonly species: string;
  readonly abundance: number;
  readonly precision: number;
  readonly quality: MavenNgimsNeutralQuality;
}

export interface MavenNgimsNeutralMeasurement {
  readonly species: string;
  readonly timeUtc: string;
  readonly orbit: number;
  readonly tid: number;
  readonly focusMode: MavenNgimsFocusMode;
  readonly quality: 'verified' | 'uncertain';
  readonly qualityFlag: 'IV' | 'IU' | 'OV' | 'OU';
  readonly direction: 'inbound' | 'outbound';
  readonly altitudeM: number;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly localSolarTimeHours: number;
  readonly solarZenithAngleDeg: number;
  readonly massAmu: number;
  readonly numberDensityPerM3: number;
  readonly relativeSigmaFraction: number;
  readonly numberDensitySigmaPerM3: number;
  /** NO has a published NGIMS in-instrument recombination caveat. */
  readonly interpretation: 'candidate_neutral_measurement' | 'possible_instrument_chemistry_bias';
  /** A single NGIMS row is never a complete initial atmospheric state. */
  readonly eligibleAsSchedulerInitialAbundance: false;
}

export interface MavenNgimsValidationError {
  readonly field: string;
  readonly message: string;
}

export type MavenNgimsRowValidation =
  | {
      readonly status: 'verified';
      readonly measurement: MavenNgimsNeutralMeasurement;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'uncertain';
      readonly measurement: MavenNgimsNeutralMeasurement;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'rejected';
      readonly errors: readonly MavenNgimsValidationError[];
    };

export interface MavenNgimsImportPolicy {
  /** Uncertain inbound/outbound quality flags are rejected unless explicitly enabled. */
  readonly allowUncertain?: boolean;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validUtc(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 &&
    Number.isFinite(Date.parse(value));
}

const FOCUS_MODES: readonly string[] = ['csn', 'osnb', 'osion', 'osnt'];
const QUALITY_FLAGS: readonly string[] = ['IV', 'IU', 'OV', 'OU', 'UR'];

export function validateMavenNgimsL2NeutralRow(
  row: MavenNgimsL2NeutralAbundanceRow,
  policy: MavenNgimsImportPolicy = {}
): MavenNgimsRowValidation {
  const errors: MavenNgimsValidationError[] = [];
  if (!row || typeof row !== 'object') {
    return { status: 'rejected', errors: [{ field: 'row', message: 'record must be an object' }] };
  }

  if (!validUtc(row.t_utc)) errors.push({ field: 't_utc', message: 'must be a parseable UTC timestamp' });
  if (!finiteNumber(row.tid) || !Number.isInteger(row.tid) || row.tid < 0) {
    errors.push({ field: 'tid', message: 'must be a non-negative integer' });
  }
  if (!finiteNumber(row.orbit) || !Number.isInteger(row.orbit) || row.orbit <= 0) {
    errors.push({ field: 'orbit', message: 'must be a positive integer' });
  }
  if (typeof row.focusmode !== 'string' || !FOCUS_MODES.includes(row.focusmode)) {
    errors.push({ field: 'focusmode', message: 'unknown NGIMS focus mode' });
  }
  if (!finiteNumber(row.alt) || row.alt <= 0) {
    errors.push({ field: 'alt', message: 'altitude must be finite and positive km' });
  }
  if (!finiteNumber(row.lst) || row.lst < 0 || row.lst > 24) {
    errors.push({ field: 'lst', message: 'local solar time must be within [0,24] h' });
  }
  if (!finiteNumber(row.long)) errors.push({ field: 'long', message: 'longitude must be finite degrees' });
  if (!finiteNumber(row.lat) || row.lat < -90 || row.lat > 90) {
    errors.push({ field: 'lat', message: 'latitude must be within [-90,90] degrees' });
  }
  if (!finiteNumber(row.sza) || row.sza < 0 || row.sza > 180) {
    errors.push({ field: 'sza', message: 'solar zenith angle must be within [0,180] degrees' });
  }
  if (!finiteNumber(row.mass) || row.mass < 2 || row.mass > 150) {
    errors.push({ field: 'mass', message: 'mass must be within NGIMS coverage [2,150] Da' });
  }
  if (typeof row.species !== 'string' || row.species.trim() === '') {
    errors.push({ field: 'species', message: 'species name is required' });
  }
  if (!finiteNumber(row.abundance) || row.abundance <= 0) {
    errors.push({ field: 'abundance', message: 'abundance must be finite and positive part/cm3' });
  }
  if (!finiteNumber(row.precision) || row.precision < 0 || row.precision > 1) {
    errors.push({ field: 'precision', message: '1-sigma relative precision must be within [0,1]' });
  }
  if (typeof row.quality !== 'string' || !QUALITY_FLAGS.includes(row.quality)) {
    errors.push({ field: 'quality', message: 'unknown NGIMS neutral quality flag' });
  }

  if (errors.length > 0) return { status: 'rejected', errors };
  if (row.quality === 'UR') {
    return {
      status: 'rejected',
      errors: [{ field: 'quality', message: 'UR means unreliable; NGIMS SIS says these data are not usable for science' }]
    };
  }

  const uncertain = row.quality === 'IU' || row.quality === 'OU';
  if (uncertain && policy.allowUncertain !== true) {
    return {
      status: 'rejected',
      errors: [{
        field: 'quality',
        message: 'IU/OU are uncertain measurements; set allowUncertain=true only for explicit sensitivity studies'
      }]
    };
  }

  // PDS L2 abundance is in part/cm3. 1 cm3 = 1e-6 m3.
  const numberDensityPerM3 = row.abundance * 1e6;
  const relativeSigmaFraction = row.precision;
  const direction = row.quality === 'IV' || row.quality === 'IU' ? 'inbound' : 'outbound';
  const isNo = row.species.trim().toUpperCase() === 'NO';
  const warnings: string[] = [];
  if (uncertain) warnings.push('NGIMS quality flag is uncertain (IU/OU), not verified');
  if (isNo) {
    warnings.push(
      'Published MAVEN/IUVS analysis notes possible in-instrument recombination of N and O as a high-bias source for NGIMS NO; do not use as a validated NO profile without independent cross-check'
    );
  }

  const measurement: MavenNgimsNeutralMeasurement = {
    species: row.species,
    timeUtc: row.t_utc,
    orbit: row.orbit,
    tid: row.tid,
    focusMode: row.focusmode,
    quality: uncertain ? 'uncertain' : 'verified',
    qualityFlag: row.quality as Exclude<MavenNgimsNeutralQuality, 'UR'>,
    direction,
    altitudeM: row.alt * 1000,
    latitudeDeg: row.lat,
    longitudeDeg: row.long,
    localSolarTimeHours: row.lst,
    solarZenithAngleDeg: row.sza,
    massAmu: row.mass,
    numberDensityPerM3,
    relativeSigmaFraction,
    numberDensitySigmaPerM3: numberDensityPerM3 * relativeSigmaFraction,
    interpretation: isNo ? 'possible_instrument_chemistry_bias' : 'candidate_neutral_measurement',
    eligibleAsSchedulerInitialAbundance: false
  };

  return {
    status: uncertain ? 'uncertain' : 'verified',
    measurement,
    warnings
  };
}

export interface MavenNgimsProfileBuildResult {
  readonly status: 'completed' | 'rejected';
  readonly species?: string;
  readonly orbit?: number;
  readonly tid?: number;
  readonly direction?: 'inbound' | 'outbound';
  readonly quality?: 'verified' | 'uncertain';
  readonly measurements?: readonly MavenNgimsNeutralMeasurement[];
  readonly errors?: readonly string[];
  readonly limitations?: readonly string[];
}

export interface MavenNgimsProfileSelection {
  readonly species: string;
  readonly orbit: number;
  readonly tid: number;
  readonly direction: 'inbound' | 'outbound';
  readonly quality: 'verified' | 'uncertain';
}

/**
 * Build one monotonic single-orbit, single-species profile from already
 * validated measurements. The identity checks are repeated at this boundary
 * so callers cannot bypass them by constructing a measurement array.
 */
export function buildMavenNgimsNeutralProfileFromMeasurements(
  measurements: readonly MavenNgimsNeutralMeasurement[]
): MavenNgimsProfileBuildResult {
  if (!Array.isArray(measurements) || measurements.length < 2) {
    return { status: 'rejected', errors: ['at least two accepted measurements are required for a vertical profile'] };
  }

  const first = measurements[0];
  const identityErrors: string[] = [];
  for (let index = 0; index < measurements.length; index += 1) {
    const current = measurements[index];
    if (!current || current.eligibleAsSchedulerInitialAbundance !== false) {
      identityErrors.push('measurement is malformed or incorrectly marked for Scheduler initialization');
      continue;
    }
    if (current.orbit !== first.orbit) identityErrors.push('profile cannot combine different MAVEN orbits');
    if (current.tid !== first.tid) identityErrors.push('profile cannot combine different NGIMS TIDs');
    if (current.species.trim().toUpperCase() !== first.species.trim().toUpperCase()) {
      identityErrors.push('profile cannot combine different neutral species');
    }
    if (current.direction !== first.direction) {
      identityErrors.push('profile cannot combine inbound and outbound measurements');
    }
    if (current.quality !== first.quality) {
      identityErrors.push('profile must not silently combine verified and uncertain quality classes');
    }
  }
  if (identityErrors.length > 0) return { status: 'rejected', errors: [...new Set(identityErrors)] };

  const sorted = [...measurements].sort((a, b) => a.altitudeM - b.altitudeM);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].altitudeM === sorted[index - 1].altitudeM) {
      return { status: 'rejected', errors: ['duplicate altitude rows are not averaged implicitly'] };
    }
  }

  const isNo = first.species.trim().toUpperCase() === 'NO';
  return {
    status: 'completed',
    species: first.species,
    orbit: first.orbit,
    tid: first.tid,
    direction: first.direction,
    quality: first.quality,
    measurements: sorted,
    limitations: [
      'One MAVEN orbit and one spacecraft-track branch only; the rows retain their individual UTC, latitude, longitude, local time and solar zenith angle.',
      'This is a neutral number-density profile only; it is not a complete T(z), P(z), bulk-composition or global-climatology profile.',
      'No samples are automatically inserted into CoreWorldState or Scheduler inventories.'
    ].concat(isNo ? [
      'NO-specific limitation: the IUVS publication reports a possible positive NGIMS bias from N+O recombination inside the instrument; this profile is not independently corrected.'
    ] : [])
  };
}

/**
 * Validate raw L2 rows and build a single-orbit profile. No cross-orbit,
 * inbound/outbound, or multi-species averaging is performed.
 */
export function buildMavenNgimsNeutralProfile(
  rows: readonly MavenNgimsL2NeutralAbundanceRow[],
  policy: MavenNgimsImportPolicy = {}
): MavenNgimsProfileBuildResult {
  if (!Array.isArray(rows) || rows.length < 2) {
    return { status: 'rejected', errors: ['at least two L2 rows are required for a vertical profile'] };
  }

  const validated = rows.map((row) => validateMavenNgimsL2NeutralRow(row, policy));
  const rejected = validated.flatMap((result, index) =>
    result.status === 'rejected'
      ? result.errors.map((error) => 'row ' + index + ' (' + error.field + '): ' + error.message)
      : []
  );
  if (rejected.length > 0) return { status: 'rejected', errors: rejected };

  const measurements = validated.flatMap((result) =>
    result.status === 'rejected' ? [] : [result.measurement]
  );
  return buildMavenNgimsNeutralProfileFromMeasurements(measurements);
}

/**
 * Select one homogeneous profile from a full L2 CSV import. Species, orbit,
 * TID, track direction and quality class are all mandatory filters: a broad
 * CSV export is never silently averaged into one atmosphere.
 */
export function buildMavenNgimsNeutralProfileFromCsvImport(
  imported: MavenNgimsL2CsvImportResult,
  selection: MavenNgimsProfileSelection
): MavenNgimsProfileBuildResult {
  if (!imported || imported.status !== 'parsed') {
    return {
      status: 'rejected',
      errors: imported?.status === 'invalid_csv'
        ? [...imported.errors]
        : ['a successfully parsed NGIMS L2 CSV import is required']
    };
  }
  if (
    !selection ||
    typeof selection.species !== 'string' ||
    selection.species.trim() === '' ||
    !Number.isInteger(selection.orbit) ||
    selection.orbit <= 0 ||
    !Number.isInteger(selection.tid) ||
    selection.tid < 0 ||
    (selection.direction !== 'inbound' && selection.direction !== 'outbound') ||
    (selection.quality !== 'verified' && selection.quality !== 'uncertain')
  ) {
    return { status: 'rejected', errors: ['profile selection must explicitly identify species, positive orbit, TID, track direction and quality class'] };
  }

  const selected = imported.rows.flatMap((entry) => {
    if (entry.validation.status === 'rejected') return [];
    const measurement = entry.validation.measurement;
    return (
      measurement.species.trim().toUpperCase() === selection.species.trim().toUpperCase() &&
      measurement.orbit === selection.orbit &&
      measurement.tid === selection.tid &&
      measurement.direction === selection.direction &&
      measurement.quality === selection.quality
    ) ? [measurement] : [];
  });

  if (selected.length === 0) {
    return {
      status: 'rejected',
      errors: ['the requested NGIMS species/orbit/TID/direction/quality selection has no accepted rows']
    };
  }
  return buildMavenNgimsNeutralProfileFromMeasurements(selected);
}

function parseFiniteField(
  row: Readonly<Record<string, string | undefined>>,
  field: string,
  errors: MavenNgimsValidationError[]
): number {
  const raw = row[field];
  if (typeof raw !== 'string' || raw.trim() === '') {
    errors.push({ field, message: 'required numeric CSV field is absent' });
    return Number.NaN;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) errors.push({ field, message: 'CSV field must be a finite number' });
  return value;
}

/** Parse one NGIMS L2 neutral CSV row using the SIS column names. */
export function parseMavenNgimsL2NeutralCsvRow(
  row: Readonly<Record<string, string | undefined>>,
  policy: MavenNgimsImportPolicy = {}
): MavenNgimsRowValidation {
  const errors: MavenNgimsValidationError[] = [];
  if (!row || typeof row !== 'object') {
    return { status: 'rejected', errors: [{ field: 'row', message: 'CSV row must be an object' }] };
  }
  const t_utc = row.t_utc;
  const species = row.species;
  const focusmode = row.focusmode;
  const quality = row.quality;
  if (typeof t_utc !== 'string' || t_utc.trim() === '') errors.push({ field: 't_utc', message: 'required UTC field is absent' });
  if (typeof species !== 'string' || species.trim() === '') errors.push({ field: 'species', message: 'required species field is absent' });
  if (typeof focusmode !== 'string') errors.push({ field: 'focusmode', message: 'required focusmode field is absent' });
  if (typeof quality !== 'string') errors.push({ field: 'quality', message: 'required quality field is absent' });

  const parsed: MavenNgimsL2NeutralAbundanceRow = {
    t_utc: typeof t_utc === 'string' ? t_utc : '',
    species: typeof species === 'string' ? species : '',
    focusmode: typeof focusmode === 'string' ? focusmode as MavenNgimsFocusMode : 'csn',
    quality: typeof quality === 'string' ? quality as MavenNgimsNeutralQuality : 'UR',
    tid: parseFiniteField(row, 'tid', errors),
    orbit: parseFiniteField(row, 'orbit', errors),
    alt: parseFiniteField(row, 'alt', errors),
    lst: parseFiniteField(row, 'lst', errors),
    long: parseFiniteField(row, 'long', errors),
    lat: parseFiniteField(row, 'lat', errors),
    sza: parseFiniteField(row, 'sza', errors),
    mass: parseFiniteField(row, 'mass', errors),
    abundance: parseFiniteField(row, 'abundance', errors),
    precision: parseFiniteField(row, 'precision', errors)
  };
  if (errors.length > 0) return { status: 'rejected', errors };
  return validateMavenNgimsL2NeutralRow(parsed, policy);
}


export interface MavenNgimsL2CsvRowResult {
  /** One-based record number after the CSV header (not a physical line number). */
  readonly recordNumber: number;
  readonly validation: MavenNgimsRowValidation;
}

export type MavenNgimsL2CsvImportResult =
  | {
      readonly status: 'parsed';
      readonly headers: readonly string[];
      readonly rows: readonly MavenNgimsL2CsvRowResult[];
      readonly acceptedRowCount: number;
      readonly rejectedRowCount: number;
    }
  | {
      readonly status: 'invalid_csv';
      readonly errors: readonly string[];
    };

const REQUIRED_NGIMS_L2_NEUTRAL_COLUMNS = [
  't_utc', 'tid', 'orbit', 'focusmode', 'alt', 'lst', 'long',
  'lat', 'sza', 'mass', 'species', 'abundance', 'precision', 'quality'
] as const;

/**
 * Small RFC-4180-style record reader for the ASCII CSV delivered by the
 * NGIMS PDS index. It handles quoted commas, escaped quotes, CRLF and
 * LF records. A quoted newline is retained in its field and subsequently
 * rejected by the typed UTC/numeric validators where inappropriate.
 */
function parseNgimsCsvRecords(text: string): { records: string[][]; error?: string } {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let quoteClosed = false;
  let rowTouched = false;

  const pushField = (): void => {
    fields.push(field);
    field = '';
    quoteClosed = false;
  };
  const pushRecord = (): void => {
    pushField();
    if (rowTouched || fields.some((value) => value.length > 0)) {
      records.push(fields);
    }
    fields = [];
    rowTouched = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      rowTouched = true;
      continue;
    }

    if (quoteClosed) {
      if (character === ',') {
        pushField();
        rowTouched = true;
        continue;
      }
      if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        pushRecord();
        continue;
      }
      return { records: [], error: 'unexpected character after a closing CSV quote at offset ' + index };
    }

    if (character === '"') {
      if (field.length !== 0) {
        return { records: [], error: 'quote inside an unquoted CSV field at offset ' + index };
      }
      inQuotes = true;
      rowTouched = true;
      continue;
    }
    if (character === ',') {
      pushField();
      rowTouched = true;
      continue;
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      pushRecord();
      continue;
    }

    field += character;
    rowTouched = true;
  }

  if (inQuotes) return { records: [], error: 'unterminated quoted CSV field' };
  if (rowTouched || fields.length > 0 || field.length > 0 || quoteClosed) pushRecord();
  return { records };
}

/**
 * Parse a complete NGIMS L2 neutral CSV text export. Syntax/header failures
 * reject the file; per-row quality or numeric failures remain attached to
 * their individual records so a caller can audit every excluded sample.
 * No rows are averaged, interpolated, or promoted to a complete atmosphere.
 */
export function parseMavenNgimsL2NeutralCsvText(
  csvText: string,
  policy: MavenNgimsImportPolicy = {}
): MavenNgimsL2CsvImportResult {
  if (typeof csvText !== 'string' || csvText.trim() === '') {
    return { status: 'invalid_csv', errors: ['CSV text is empty'] };
  }

  const parsed = parseNgimsCsvRecords(csvText.replace(/^\uFEFF/, ''));
  if (parsed.error) return { status: 'invalid_csv', errors: [parsed.error] };
  if (parsed.records.length < 2) {
    return { status: 'invalid_csv', errors: ['CSV must contain a header and at least one data record'] };
  }

  const headers = parsed.records[0].map((header) => header.trim());
  if (headers.length === 0 || headers.some((header) => header === '')) {
    return { status: 'invalid_csv', errors: ['CSV header contains an empty column name'] };
  }
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length > 0) {
    return {
      status: 'invalid_csv',
      errors: ['CSV header contains duplicate columns: ' + [...new Set(duplicateHeaders)].join(', ')]
    };
  }

  const missingColumns = REQUIRED_NGIMS_L2_NEUTRAL_COLUMNS.filter((column) => !headers.includes(column));
  if (missingColumns.length > 0) {
    return {
      status: 'invalid_csv',
      errors: ['CSV is missing required NGIMS L2 neutral columns: ' + missingColumns.join(', ')]
    };
  }

  const rows: MavenNgimsL2CsvRowResult[] = parsed.records.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      return {
        recordNumber: index + 1,
        validation: {
          status: 'rejected',
          errors: [{
            field: 'row',
            message: 'CSV record has ' + values.length + ' fields; expected ' + headers.length
          }]
        }
      };
    }

    const record: Record<string, string | undefined> = Object.fromEntries(
      headers.map((header, columnIndex) => [header, values[columnIndex]])
    );
    return {
      recordNumber: index + 1,
      validation: parseMavenNgimsL2NeutralCsvRow(record, policy)
    };
  });

  const acceptedRowCount = rows.filter((entry) => entry.validation.status !== 'rejected').length;
  return {
    status: 'parsed',
    headers,
    rows,
    acceptedRowCount,
    rejectedRowCount: rows.length - acceptedRowCount
  };
}



export type MavenNgimsL3ResampledDensityEvidenceStatus =
  | 'verified_resampled_value'
  | 'uncertain_resampled_value'
  | 'unreliable'
  | 'not_available'
  | 'non_positive'
  | 'unclassified_quality';

export interface MavenNgimsL3ResampledDensityRow {
  readonly sourceProductId: string;
  readonly timeUtc: string;
  readonly unixTimeSeconds: number;
  readonly spacecraftClockSeconds: number;
  readonly elapsedSinceTidStartSeconds: number;
  readonly tid: number;
  readonly orbit: number;
  readonly focusMode: MavenNgimsFocusMode;
  readonly altitudeKm: number;
  readonly massAmu: number;
  readonly species: string;
  /** Raw Table A-9 density_bins number. The source's log-bin prose conflicts with its Part/cc unit declaration. */
  readonly reportedDensityBinValue: number | null;
  /** No linear concentration is emitted until the PDS density-bin transform is resolved. */
  readonly densityBinsPerCm3: null;
  readonly densityBinsPerM3: null;
  readonly densityBinInterpretationStatus: 'unresolved_log_bin_vs_part_cm3_contract';
  /** Table A-9 has no per-row precision/sigma column. */
  readonly reportedSigmaPerCm3: null;
  /** Unknown source flags are preserved, but never promoted to verified/uncertain. */
  readonly qualityFlag: MavenNgimsNeutralQuality | 'unrecognized';
  readonly qualityFlagRaw: string;
  readonly evidenceStatus: MavenNgimsL3ResampledDensityEvidenceStatus;
  readonly evidenceKind: 'l3_resampled_average_density';
  readonly densityBasis: 'equal_pressure_altitude_constant_log_density_bins';
  readonly duplicateUtcColumnsMatched: boolean;
  readonly eligibleAsDirectL2Measurement: false;
  readonly eligibleAsSchedulerInitialAbundance: false;
  readonly eligibleAsMarsPhotochemicalInitialState: false;
  readonly diagnostics: readonly string[];
}

export type MavenNgimsL3ResampledDensityRowValidation =
  | { readonly status: 'parsed'; readonly row: MavenNgimsL3ResampledDensityRow }
  | { readonly status: 'rejected'; readonly errors: readonly string[] };

export interface MavenNgimsL3ResampledDensityCsvRowResult {
  readonly recordNumber: number;
  readonly validation: MavenNgimsL3ResampledDensityRowValidation;
}

export type MavenNgimsL3ResampledDensityCsvImportResult =
  | {
      readonly status: 'parsed';
      readonly sourceProductId: string;
      readonly headers: readonly string[];
      readonly duplicatedUtcHeader: boolean;
      readonly rows: readonly MavenNgimsL3ResampledDensityCsvRowResult[];
      readonly parsedRowCount: number;
      readonly rejectedRowCount: number;
      readonly evidenceStatusCounts: Readonly<Record<MavenNgimsL3ResampledDensityEvidenceStatus, number>>;
    }
  | { readonly status: 'invalid_csv'; readonly errors: readonly string[] };


export interface MavenNgimsL3ResampledDensityPds4ImportInput {
  readonly csvText: string;
  readonly detachedLabelXml: string;
  /** Expected PDS4 logical identifier taken from an independent archive index. */
  readonly expectedProductId: string;
  /** Expected CSV file name taken from an independent archive directory/index. */
  readonly expectedCsvFileName: string;
  /** Explicit forensic-only opt-in for a source whose bytes disagree with the detached label file_size. */
  readonly allowLabelSizeMismatchForensicAnalysis?: boolean;
}

export interface MavenNgimsL3ResampledDensityPds4ImportProvenance {
  readonly sourceProductId: string;
  readonly csvFileName: string;
  /** Actual length of the exact UTF-8 CSV bytes supplied to the importer. */
  readonly csvByteLength: number;
  readonly labelDeclaredFileSizeBytes: number;
  readonly csvSizeConsistencyStatus: 'matches_detached_label_file_size' | 'mismatch_explicitly_accepted_for_forensic_analysis';
  readonly labelHeaderObjectLengthBytes: number | null;
  readonly labelTableOffsetBytes: number | null;
  readonly labelTableObjectLengthBytes: number | null;
  readonly labelFileLayoutDiagnosis: 'consistent' | 'possible_header_double_count_in_label' | 'not_diagnosable';
  /** SHA-256 of the exact UTF-8 text supplied to this importer (BOM/newlines preserved). */
  readonly csvSha256: string;
  readonly hashAlgorithm: 'SHA-256';
  readonly sourceProductIdentityBasis: 'detached-pds4-label-logical-identifier';
  readonly detachedLabelChecks: readonly [
    'logical_identifier_matches_expected_product_id',
    'file_name_matches_expected_csv_file_name',
    'pds4_root_namespace_and_scoped_file_structure_validated'
  ];
  /** Optional MD5 declared by the PDS4 File element; null when the label omits it. */
  readonly csvMd5Checksum: string | null;
  readonly csvMd5ChecksumStatus: 'not_present_in_detached_label' | 'verified_against_detached_label';
  /** MD5 comparison checks file fixity against the supplied label, not label authenticity. */
  readonly csvFixityStatus: 'sha256_computed_not_compared_to_archive_checksum' | 'md5_verified_against_detached_label';
  /** The label is user-supplied input; this function does not authenticate its publisher/signature. */
  readonly detachedLabelAuthenticity: 'not_independently_authenticated';
}

export type MavenNgimsL3ResampledDensityPds4ImportResult =
  | {
      readonly status: 'imported';
      readonly forensicOnly: false;
      readonly warnings: readonly [];
      readonly imported: Extract<MavenNgimsL3ResampledDensityCsvImportResult, { readonly status: 'parsed' }>;
      readonly provenance: MavenNgimsL3ResampledDensityPds4ImportProvenance;
    }
  | {
      readonly status: 'imported_forensic_only';
      readonly forensicOnly: true;
      readonly warnings: readonly string[];
      readonly imported: Extract<MavenNgimsL3ResampledDensityCsvImportResult, { readonly status: 'parsed' }>;
      readonly provenance: MavenNgimsL3ResampledDensityPds4ImportProvenance;
    }
  | { readonly status: 'rejected'; readonly errors: readonly string[] };

export type MavenNgimsL3ResampledDensityPds4SelectionResult =
  | {
      readonly status: 'completed';
      readonly selection: MavenNgimsL3ResampledDensitySelection;
      readonly measurements: readonly MavenNgimsL3ResampledDensityRow[];
      readonly excludedRows: MavenNgimsL3ResampledDensityExcludedRowCounts;
      readonly sourceProductIdentityBasis: 'detached-pds4-label-logical-identifier';
      readonly sourceArtifactSha256: string;
      readonly detachedLabelAuthenticity: 'not_independently_authenticated';
      readonly csvSizeConsistencyStatus: MavenNgimsL3ResampledDensityPds4ImportProvenance['csvSizeConsistencyStatus'];
      readonly forensicOnly: boolean;
      readonly warnings: readonly string[];
      readonly eligibleAsMarsPhotochemicalInitialState: false;
      readonly limitations: readonly string[];
    }
  | { readonly status: 'rejected'; readonly errors: readonly string[]; readonly excludedRows?: MavenNgimsL3ResampledDensityExcludedRowCounts };

export interface MavenNgimsL3ResampledDensitySelection {
  readonly sourceProductId: string;
  readonly tid: number;
  readonly orbit: number;
  readonly focusMode: MavenNgimsFocusMode;
  readonly species: string;
  readonly quality: 'verified' | 'uncertain';
  readonly timeStartUtc: string;
  readonly timeStopUtc: string;
}

export interface MavenNgimsL3ResampledDensityExcludedRowCounts {
  readonly rejectedByRowValidation: number;
  readonly differentTid: number;
  readonly differentOrbit: number;
  readonly differentFocusMode: number;
  readonly differentSpecies: number;
  readonly differentQuality: number;
  readonly unrecognizedQualityFlag: number;
  readonly unavailableOrNonPositive: number;
  readonly outsideUtcWindow: number;
}

export type MavenNgimsL3ResampledDensitySelectionResult =
  | {
      readonly status: 'completed';
      readonly selection: MavenNgimsL3ResampledDensitySelection;
      readonly measurements: readonly MavenNgimsL3ResampledDensityRow[];
      readonly excludedRows: MavenNgimsL3ResampledDensityExcludedRowCounts;
      readonly sourceProductIdentityBasis: 'caller-supplied-not-verified-from-csv-payload';
      readonly eligibleAsMarsPhotochemicalInitialState: false;
      readonly limitations: readonly string[];
    }
  | {
      readonly status: 'rejected';
      readonly errors: readonly string[];
      readonly excludedRows?: MavenNgimsL3ResampledDensityExcludedRowCounts;
    };

const NGIMS_L3_RES_DEN_BASE_COLUMNS = [
  't_utc', 't_unix', 't_sclk', 't_tid', 'tid', 'orbit',
  'focusmode', 'alt', 'mass', 'species', 'density_bins', 'quality'
] as const;

/**
 * Parse one Table A-9 row. SIS Rev. 1.13 prints two t_utc entries in its
 * column table; both the single-timestamp-header and duplicated-header
 * variants are accepted. When duplicated, the two row values must agree.
 */
export function parseMavenNgimsL3ResampledDensityCsvRow(
  values: readonly string[],
  headers: readonly string[],
  sourceProductId: string,
  recordNumber = 1
): MavenNgimsL3ResampledDensityRowValidation {
  if (typeof sourceProductId !== 'string' || sourceProductId.trim() === '') {
    return { status: 'rejected', errors: ['sourceProductId must identify the exact L3 res-den PDS product'] };
  }
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  const duplicatedUtcHeader =
    normalizedHeaders.length === 13 &&
    normalizedHeaders[0] === 't_utc' &&
    normalizedHeaders[1] === 't_utc';
  const columnHeaders = duplicatedUtcHeader
    ? [normalizedHeaders[0], ...normalizedHeaders.slice(2)]
    : normalizedHeaders;
  if (
    columnHeaders.length !== NGIMS_L3_RES_DEN_BASE_COLUMNS.length ||
    columnHeaders.some((header, index) => header !== NGIMS_L3_RES_DEN_BASE_COLUMNS[index])
  ) {
    return { status: 'rejected', errors: ['CSV columns do not match the NGIMS SIS Rev. 1.13 Table A-9 schema'] };
  }
  if (values.length !== normalizedHeaders.length) {
    return {
      status: 'rejected',
      errors: ['record ' + recordNumber + ' has ' + values.length + ' values; expected ' + normalizedHeaders.length]
    };
  }

  const record = Object.fromEntries(
    columnHeaders.map((header, index) => [header, values[duplicatedUtcHeader ? (index === 0 ? 0 : index + 1) : index]])
  ) as Record<string, string>;
  const errors: string[] = [];
  const timeUtc = strictNgimsL3UtcTimestamp(record.t_utc?.trim() ?? '');
  if (timeUtc === null) errors.push('t_utc must be a valid UTC calendar timestamp in Table A-9 format');
  let duplicateUtcColumnsMatched = false;
  if (duplicatedUtcHeader) {
    const firstUtc = strictNgimsL3UtcTimestamp(values[0]?.trim() ?? '');
    const secondUtc = strictNgimsL3UtcTimestamp(values[1]?.trim() ?? '');
    duplicateUtcColumnsMatched = firstUtc !== null && firstUtc === secondUtc;
    if (!duplicateUtcColumnsMatched) {
      errors.push('the duplicated Table A-9 t_utc columns must contain the same UTC instant');
    }
  }

  const numericFields = [
    't_unix', 't_sclk', 't_tid', 'tid', 'orbit',
    'alt', 'mass', 'density_bins'
  ] as const;
  const numeric = {} as Record<typeof numericFields[number], number | null>;
  for (const field of numericFields) {
    const raw = record[field]?.trim() ?? '';
    if (field === 'density_bins' && (raw === '' || /^NaN$/i.test(raw))) {
      numeric[field] = null;
      continue;
    }
    if (raw === '') {
      errors.push(field + ' is a required numeric field and cannot be blank');
      numeric[field] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(field + ' must be a finite numeric value' +
        (field === 'density_bins' ? ' or an explicit NaN/blank unavailable marker' : ''));
      numeric[field] = null;
    } else {
      numeric[field] = value;
    }
  }

  const focusMode = record.focusmode?.trim().toLowerCase();
  if (!FOCUS_MODES.includes(focusMode ?? '')) errors.push('focusmode is not an NGIMS-supported focus mode');
  const species = record.species?.trim();
  if (!species) errors.push('species must be non-empty');
  const qualityFlag = record.quality?.trim().toUpperCase();
  if (!qualityFlag) errors.push('quality flag must be present');

  if (errors.length > 0) return { status: 'rejected', errors };
  if (!Number.isInteger(numeric.tid) || numeric.tid! <= 0) errors.push('tid must be a positive integer');
  if (!Number.isInteger(numeric.orbit) || numeric.orbit! <= 0) errors.push('orbit must be a positive integer');
  if (numeric.t_unix! < 0 || numeric.t_sclk! < 0 || numeric.t_tid! < 0) {
    errors.push('unix, spacecraft-clock and elapsed TID times must be non-negative');
  }
  if (numeric.alt! <= 0) errors.push('alt must be positive km');
  if (numeric.mass! < 2 || numeric.mass! > 150) errors.push('mass must be within NGIMS coverage [2,150] Da');
  if (numeric.density_bins !== null && numeric.density_bins! < 0) {
    errors.push('density_bins cannot be negative');
  }
  if (errors.length > 0) return { status: 'rejected', errors };

  const densityBinValue = numeric.density_bins;
  const knownQuality = !!qualityFlag && QUALITY_FLAGS.includes(qualityFlag);
  const flag: MavenNgimsNeutralQuality | 'unrecognized' =
    knownQuality ? qualityFlag as MavenNgimsNeutralQuality : 'unrecognized';
  const evidenceStatus: MavenNgimsL3ResampledDensityEvidenceStatus =
    densityBinValue === null
      ? 'not_available'
      : densityBinValue <= 0
        ? 'non_positive'
        : !knownQuality
          ? 'unclassified_quality'
          : flag === 'UR'
            ? 'unreliable'
            : flag === 'IU' || flag === 'OU'
              ? 'uncertain_resampled_value'
              : 'verified_resampled_value';

  const diagnostics = [
    'L3 res-den values are altitude-resampled and averaged on density bins; they are not raw L2 point measurements.',
    'The PDS SIS describes density bins as log(density)-spaced but Table A-9 labels density_bins in Part/cc; raw values are retained without a linear SI conversion until this contract conflict is resolved.',
    'Table A-9 supplies no per-row density precision or sigma; reportedSigmaPerCm3 is therefore null, not zero.',
    'The row carries altitude, time, TID, orbit, focus mode, species and quality, but no per-row latitude, longitude, SZA or local solar time.',
    'This L3 resampled profile is not eligible for direct Scheduler or Mars photochemical initial-state construction.'
  ];
  if (flag === 'UR') diagnostics.push('Quality UR marks this row unreliable and not usable for science.');
  if (flag === 'IU' || flag === 'OU') diagnostics.push('Quality IU/OU marks this resampled density as uncertain.');
  if (flag === 'unrecognized') diagnostics.push('Quality flag "' + qualityFlag + '" is not defined by NGIMS SIS Rev. 1.13 neutral L2/L3 flags; retained raw and excluded from science selections.');
  if (densityBinValue === null) diagnostics.push('density_bins is unavailable/NaN.');
  if (densityBinValue !== null && densityBinValue <= 0) diagnostics.push('Non-positive density-bin coordinate is retained for audit and is not a positive detection.');

  return {
    status: 'parsed',
    row: {
      sourceProductId: sourceProductId.trim(),
      timeUtc: timeUtc!,
      unixTimeSeconds: numeric.t_unix!,
      spacecraftClockSeconds: numeric.t_sclk!,
      elapsedSinceTidStartSeconds: numeric.t_tid!,
      tid: numeric.tid!,
      orbit: numeric.orbit!,
      focusMode: focusMode as MavenNgimsFocusMode,
      altitudeKm: numeric.alt!,
      massAmu: numeric.mass!,
      species: species!,
      reportedDensityBinValue: densityBinValue,
      densityBinsPerCm3: null,
      densityBinsPerM3: null,
      densityBinInterpretationStatus: 'unresolved_log_bin_vs_part_cm3_contract',
      reportedSigmaPerCm3: null,
      qualityFlag: flag,
      qualityFlagRaw: qualityFlag!,
      evidenceStatus,
      evidenceKind: 'l3_resampled_average_density',
      densityBasis: 'equal_pressure_altitude_constant_log_density_bins',
      duplicateUtcColumnsMatched,
      eligibleAsDirectL2Measurement: false,
      eligibleAsSchedulerInitialAbundance: false,
      eligibleAsMarsPhotochemicalInitialState: false,
      diagnostics
    }
  };
}

/** Parse the L3 res-den CSV; a schema/header failure rejects the entire product. */
export function parseMavenNgimsL3ResampledDensityCsvText(
  csvText: string,
  sourceProductId: string
): MavenNgimsL3ResampledDensityCsvImportResult {
  if (typeof csvText !== 'string' || csvText.trim() === '') {
    return { status: 'invalid_csv', errors: ['CSV text is empty'] };
  }
  if (typeof sourceProductId !== 'string' || sourceProductId.trim() === '') {
    return { status: 'invalid_csv', errors: ['sourceProductId must identify the exact L3 res-den PDS product'] };
  }
  const parsed = parseNgimsCsvRecords(csvText.replace(/^\uFEFF/, ''));
  if (parsed.error) return { status: 'invalid_csv', errors: [parsed.error] };
  if (parsed.records.length < 2) {
    return { status: 'invalid_csv', errors: ['CSV must contain a header and at least one data record'] };
  }

  const headers = parsed.records[0].map((header) => header.trim().toLowerCase());
  const duplicatedUtcHeader =
    headers.length === 13 && headers[0] === 't_utc' && headers[1] === 't_utc';
  const columns = duplicatedUtcHeader ? [headers[0], ...headers.slice(2)] : headers;
  if (
    columns.length !== NGIMS_L3_RES_DEN_BASE_COLUMNS.length ||
    columns.some((header, index) => header !== NGIMS_L3_RES_DEN_BASE_COLUMNS[index])
  ) {
    return { status: 'invalid_csv', errors: ['CSV header does not match the NGIMS SIS Rev. 1.13 Table A-9 schema'] };
  }

  const rows: MavenNgimsL3ResampledDensityCsvRowResult[] = parsed.records.slice(1).map((values, index) => ({
    recordNumber: index + 1,
    validation: parseMavenNgimsL3ResampledDensityCsvRow(values, headers, sourceProductId, index + 1)
  }));
  const statusCounts: Record<MavenNgimsL3ResampledDensityEvidenceStatus, number> = {
    verified_resampled_value: 0,
    uncertain_resampled_value: 0,
    unreliable: 0,
    not_available: 0,
    non_positive: 0
  };
  for (const entry of rows) {
    if (entry.validation.status === 'parsed') {
      statusCounts[entry.validation.row.evidenceStatus] += 1;
    }
  }
  const parsedRowCount = rows.filter((entry) => entry.validation.status === 'parsed').length;
  return {
    status: 'parsed',
    sourceProductId: sourceProductId.trim(),
    headers,
    duplicatedUtcHeader,
    rows,
    parsedRowCount,
    rejectedRowCount: rows.length - parsedRowCount,
    evidenceStatusCounts: statusCounts
  };
}


const PDS4_LABEL_NAMESPACE = 'http://pds.nasa.gov/pds4/pds/v1';

interface Pds4DetachedLabelElement {
  readonly count: number;
  readonly value: string | null;
  readonly unit: string | null;
}

/**
 * Read a single scalar from the PDS namespace. DOM parsing is intentional:
 * regular expressions cannot establish XML well-formedness or the document
 * root, and can mistake nested lookalike tags for label fields.
 */
function readPds4DetachedLabelElement(
  scope: Element,
  elementName: string
): Pds4DetachedLabelElement {
  // PDS4 File and Identification_Area attributes are direct children. Count
  // descendants as well so nested lookalike tags cannot satisfy the contract.
  const matches = Array.from(
    scope.getElementsByTagNameNS(PDS4_LABEL_NAMESPACE, elementName)
  );
  const element = matches.length === 1 && matches[0].parentElement === scope
    ? matches[0]
    : null;
  const hasElementChildren = element !== null && element.children.length > 0;
  return {
    count: matches.length,
    value: element !== null && !hasElementChildren
      ? (element.textContent ?? '').trim()
      : null,
    unit: element?.getAttribute('unit') ?? null
  };
}

interface Pds4TableObjectLayout {
  readonly count: number;
  readonly offsetBytes: number | null;
  readonly objectLengthBytes: number | null;
}

function readPds4TableObjectLayout(
  fileArea: Element | null,
  objectName: 'Header' | 'Table_Delimited'
): Pds4TableObjectLayout {
  if (!fileArea) return { count: 0, offsetBytes: null, objectLengthBytes: null };
  const matches = Array.from(fileArea.children).filter(
    (child) => child.namespaceURI === PDS4_LABEL_NAMESPACE && child.localName === objectName
  );
  if (matches.length !== 1) {
    return { count: matches.length, offsetBytes: null, objectLengthBytes: null };
  }
  const offset = readPds4DetachedLabelElement(matches[0], 'offset');
  const length = readPds4DetachedLabelElement(matches[0], 'object_length');
  const offsetValue = offset.count === 1 && offset.value !== null ? Number(offset.value) : Number.NaN;
  const lengthValue = length.count === 1 && length.value !== null ? Number(length.value) : Number.NaN;
  return {
    count: 1,
    offsetBytes: Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : null,
    objectLengthBytes: Number.isSafeInteger(lengthValue) && lengthValue >= 0 ? lengthValue : null
  };
}


async function computeMavenPdsCsvSha256(csvText: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable in this runtime');
  }
  const bytes = new TextEncoder().encode(csvText);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute the PDS4 File.md5_checksum value over the exact UTF-8 CSV bytes.
 * MD5 is used only for archive fixity (not authenticity or security decisions).
 */
function computeMavenPdsCsvMd5(csvText: string): string {
  const input = new TextEncoder().encode(csvText);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 0x100000000), true);

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const constants = Array.from(
    { length: 64 },
    (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
  );

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const words = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let mix: number;
      let wordIndex: number;
      if (index < 16) {
        mix = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        mix = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        mix = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        mix = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }

      const sum = (a + mix + constants[index] + words[wordIndex]) >>> 0;
      const rotated = ((sum << shifts[index]) | (sum >>> (32 - shifts[index]))) >>> 0;
      const nextA = d;
      d = c;
      c = b;
      b = (b + rotated) >>> 0;
      a = nextA;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].flatMap((word) => [
    word & 0xff,
    (word >>> 8) & 0xff,
    (word >>> 16) & 0xff,
    (word >>> 24) & 0xff
  ]).map((value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Import an L3 res-den CSV only after checking its detached PDS4 label.
 * The PDS label must identify the expected product, CSV file name and byte
 * length. SHA-256 is computed over the exact UTF-8 text, without newline or
 * BOM normalization. The label itself is not cryptographically authenticated.
 */
export async function importMavenNgimsL3ResampledDensityPds4Product(
  input: MavenNgimsL3ResampledDensityPds4ImportInput
): Promise<MavenNgimsL3ResampledDensityPds4ImportResult> {
  if (!input || typeof input !== 'object') {
    return { status: 'rejected', errors: ['a PDS4 CSV/label import input is required'] };
  }
  if (typeof input.csvText !== 'string' || input.csvText.length === 0) {
    return { status: 'rejected', errors: ['the exact downloaded CSV text is required'] };
  }
  if (typeof input.detachedLabelXml !== 'string' || input.detachedLabelXml.trim() === '') {
    return { status: 'rejected', errors: ['the detached PDS4 XML label is required'] };
  }
  if (typeof input.expectedProductId !== 'string' || input.expectedProductId.trim() === '') {
    return { status: 'rejected', errors: ['expectedProductId from the archive index is required'] };
  }
  if (typeof input.expectedCsvFileName !== 'string' || input.expectedCsvFileName.trim() === '') {
    return { status: 'rejected', errors: ['expectedCsvFileName from the archive index is required'] };
  }

  const xml = input.detachedLabelXml.replace(/<!--[\s\S]*?-->/g, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return { status: 'rejected', errors: ['PDS4 label must not contain a DTD or entity declaration'] };
  }
  if (typeof DOMParser === 'undefined') {
    return { status: 'rejected', errors: ['XML DOMParser is unavailable in this runtime'] };
  }

  let labelDocument: Document;
  try {
    labelDocument = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return { status: 'rejected', errors: ['detached PDS4 XML label could not be parsed'] };
  }
  const root = labelDocument.documentElement;
  if (
    !root ||
    root.localName === 'parsererror' ||
    root.localName !== 'Product_Observational' ||
    root.namespaceURI !== PDS4_LABEL_NAMESPACE
  ) {
    return {
      status: 'rejected',
      errors: ['detached label must be a well-formed PDS4 Product_Observational document in the PDS namespace']
    };
  }

  const identificationAreas = Array.from(
    labelDocument.getElementsByTagNameNS(PDS4_LABEL_NAMESPACE, 'Identification_Area')
  );
  const fileAreas = Array.from(
    labelDocument.getElementsByTagNameNS(PDS4_LABEL_NAMESPACE, 'File_Area_Observational')
  );
  const observationalFiles = fileAreas.length === 1
    ? Array.from(fileAreas[0].getElementsByTagNameNS(PDS4_LABEL_NAMESPACE, 'File'))
    : [];
  const structureErrors: string[] = [];
  if (identificationAreas.length !== 1 || identificationAreas[0]?.parentElement !== root) {
    structureErrors.push('detached label must contain exactly one direct-child Identification_Area');
  }
  if (fileAreas.length !== 1 || fileAreas[0]?.parentElement !== root) {
    structureErrors.push('detached label must contain exactly one direct-child File_Area_Observational');
  }
  if (observationalFiles.length !== 1 || observationalFiles[0]?.parentElement !== fileAreas[0]) {
    structureErrors.push('File_Area_Observational must contain exactly one direct-child File entry');
  }
  const logicalIdentifier = identificationAreas.length === 1
    ? readPds4DetachedLabelElement(identificationAreas[0], 'logical_identifier')
    : { count: 0, value: null, unit: null };
  const fileScope = observationalFiles.length === 1 ? observationalFiles[0] : root;
  const fileName = readPds4DetachedLabelElement(fileScope, 'file_name');
  const fileSize = readPds4DetachedLabelElement(fileScope, 'file_size');
  const errors: string[] = [];
  errors.push(...structureErrors);
  if (logicalIdentifier.count !== 1 || !logicalIdentifier.value) {
    errors.push('detached label must contain exactly one non-empty logical_identifier');
  } else if (logicalIdentifier.value !== input.expectedProductId.trim()) {
    errors.push('detached label logical_identifier does not match expectedProductId');
  }
  if (fileName.count !== 1 || !fileName.value) {
    errors.push('detached label must contain exactly one non-empty file_name');
  } else if (fileName.value !== input.expectedCsvFileName.trim()) {
    errors.push('detached label file_name does not match expectedCsvFileName');
  }
  if (fileSize.count !== 1 || !fileSize.value) {
    errors.push('detached label must contain exactly one file_size value');
  }
  if (fileSize.count === 1 && fileSize.unit !== 'byte') {
    errors.push('detached label file_size must use unit="byte"');
  }
  const declaredFileSize = fileSize.value === null ? Number.NaN : Number(fileSize.value);
  if (fileSize.count === 1 && (!Number.isSafeInteger(declaredFileSize) || declaredFileSize <= 0)) {
    errors.push('detached label file_size must be a positive integer number of bytes');
  }
  const md5Checksum = readPds4DetachedLabelElement(fileScope, 'md5_checksum');
  if (md5Checksum.count > 1) {
    errors.push('detached label File must contain at most one direct md5_checksum');
  } else if (
    md5Checksum.count === 1 &&
    (md5Checksum.value === null || !/^[a-f0-9]{32}$/i.test(md5Checksum.value))
  ) {
    errors.push('detached label md5_checksum must be exactly 32 hexadecimal characters');
  }

  const csvByteLength = new TextEncoder().encode(input.csvText).length;
  const csvSizeMatchesLabel = Number.isSafeInteger(declaredFileSize) && declaredFileSize === csvByteLength;
  const labelSizeMismatchForensicOptIn =
    input.allowLabelSizeMismatchForensicAnalysis === true;
  if (
    Number.isSafeInteger(declaredFileSize) &&
    declaredFileSize !== csvByteLength &&
    !labelSizeMismatchForensicOptIn
  ) {
    errors.push('CSV UTF-8 byte length does not match detached label file_size; forensic opt-in is required');
  }
  const headerLayout = readPds4TableObjectLayout(fileAreas.length === 1 ? fileAreas[0] : null, 'Header');
  const tableLayout = readPds4TableObjectLayout(fileAreas.length === 1 ? fileAreas[0] : null, 'Table_Delimited');
  const labelFileLayoutDiagnosis: MavenNgimsL3ResampledDensityPds4ImportProvenance['labelFileLayoutDiagnosis'] =
    csvSizeMatchesLabel
      ? 'consistent'
      : (
        headerLayout.objectLengthBytes !== null &&
        tableLayout.offsetBytes !== null &&
        tableLayout.objectLengthBytes !== null &&
        tableLayout.offsetBytes === headerLayout.objectLengthBytes &&
        tableLayout.objectLengthBytes === csvByteLength &&
        declaredFileSize === headerLayout.objectLengthBytes + tableLayout.objectLengthBytes
      )
        ? 'possible_header_double_count_in_label'
        : 'not_diagnosable';
  if (errors.length > 0) return { status: 'rejected', errors };

  const sourceProductId = logicalIdentifier.value!;
  const imported = parseMavenNgimsL3ResampledDensityCsvText(input.csvText, sourceProductId);
  if (imported.status !== 'parsed') {
    return { status: 'rejected', errors: [...imported.errors] };
  }

  let csvSha256: string;
  let csvMd5Checksum: string | null = null;
  let csvMd5ChecksumStatus: MavenNgimsL3ResampledDensityPds4ImportProvenance['csvMd5ChecksumStatus'] =
    'not_present_in_detached_label';
  let csvFixityStatus: MavenNgimsL3ResampledDensityPds4ImportProvenance['csvFixityStatus'] =
    'sha256_computed_not_compared_to_archive_checksum';
  try {
    csvSha256 = await computeMavenPdsCsvSha256(input.csvText);
    if (md5Checksum.value !== null) {
      const computedMd5 = computeMavenPdsCsvMd5(input.csvText);
      const declaredMd5 = md5Checksum.value.toLowerCase();
      if (computedMd5 !== declaredMd5) {
        return {
          status: 'rejected',
          errors: ['CSV MD5 does not match the md5_checksum in the detached PDS4 label']
        };
      }
      csvMd5Checksum = declaredMd5;
      csvMd5ChecksumStatus = 'verified_against_detached_label';
      csvFixityStatus = 'md5_verified_against_detached_label';
    }
  } catch (error) {
    return {
      status: 'rejected',
      errors: [error instanceof Error ? error.message : 'unable to compute CSV fixity hashes']
    };
  }

  const provenance: MavenNgimsL3ResampledDensityPds4ImportProvenance = {
    sourceProductId,
    csvFileName: fileName.value!,
    csvByteLength,
    labelDeclaredFileSizeBytes: declaredFileSize,
    csvSizeConsistencyStatus: csvSizeMatchesLabel
      ? 'matches_detached_label_file_size'
      : 'mismatch_explicitly_accepted_for_forensic_analysis',
    labelHeaderObjectLengthBytes: headerLayout.objectLengthBytes,
    labelTableOffsetBytes: tableLayout.offsetBytes,
    labelTableObjectLengthBytes: tableLayout.objectLengthBytes,
    labelFileLayoutDiagnosis,
    csvSha256,
    hashAlgorithm: 'SHA-256',
    sourceProductIdentityBasis: 'detached-pds4-label-logical-identifier',
    detachedLabelChecks: [
      'logical_identifier_matches_expected_product_id',
      'file_name_matches_expected_csv_file_name',
      'pds4_root_namespace_and_scoped_file_structure_validated'
    ],
    csvMd5Checksum,
    csvMd5ChecksumStatus,
    csvFixityStatus,
    detachedLabelAuthenticity: 'not_independently_authenticated'
  };
  if (!csvSizeMatchesLabel) {
    return {
      status: 'imported_forensic_only',
      forensicOnly: true,
      warnings: [
        'Detached PDS4 label file_size is inconsistent with the exact CSV byte length; the import is forensic-only.',
        'No byte rewriting, line-ending normalization, or inferred repair has been applied.',
        'No md5_checksum is present in the label; SHA-256 is recorded but not independently authenticated.',
        labelFileLayoutDiagnosis === 'possible_header_double_count_in_label'
          ? 'The label Header.object_length + Table_Delimited.object_length equals file_size, while Table_Delimited.object_length also equals the complete archived CSV byte length; this is a possible header double-count in the label metadata.'
          : 'The label object layout does not independently explain the declared file-size discrepancy.'
      ],
      imported,
      provenance
    };
  }
  return {
    status: 'imported',
    forensicOnly: false,
    warnings: [],
    imported,
    provenance
  };
}

/** Select one L3 res-den species profile from an exact TID/orbit/focus-mode and UTC event window. */
export function selectMavenNgimsL3ResampledDensityProfile(
  imported: MavenNgimsL3ResampledDensityCsvImportResult,
  selection: MavenNgimsL3ResampledDensitySelection
): MavenNgimsL3ResampledDensitySelectionResult {
  if (!imported || imported.status !== 'parsed') {
    return { status: 'rejected', errors: ['a successfully parsed NGIMS L3 res-den CSV import is required'] };
  }
  if (!selection || typeof selection !== 'object') {
    return { status: 'rejected', errors: ['an explicit L3 res-den event selection is required'] };
  }
  const errors: string[] = [];
  if (selection.sourceProductId !== imported.sourceProductId) {
    errors.push('selection sourceProductId must exactly match the imported L3 res-den product identity');
  }
  if (!Number.isInteger(selection.tid) || selection.tid <= 0) errors.push('TID must be a positive integer');
  if (!Number.isInteger(selection.orbit) || selection.orbit <= 0) errors.push('orbit must be a positive integer');
  if (!FOCUS_MODES.includes(selection.focusMode)) errors.push('focusMode must be an NGIMS-supported focus mode');
  if (typeof selection.species !== 'string' || selection.species.trim() === '') errors.push('species must be explicit');
  if (selection.quality !== 'verified' && selection.quality !== 'uncertain') {
    errors.push('quality must be explicitly verified or uncertain');
  }
  const startUtc = normalizeMavenIndexUtc(selection.timeStartUtc);
  const stopUtc = normalizeMavenIndexUtc(selection.timeStopUtc);
  if (startUtc === null || stopUtc === null) errors.push('UTC selection window must contain valid calendar timestamps');
  else if (Date.parse(startUtc) >= Date.parse(stopUtc)) errors.push('UTC stop must be later than start');
  if (errors.length > 0) return { status: 'rejected', errors };

  const excluded: { -readonly [Key in keyof MavenNgimsL3ResampledDensityExcludedRowCounts]: number } = {
    rejectedByRowValidation: 0,
    differentTid: 0,
    differentOrbit: 0,
    differentFocusMode: 0,
    differentSpecies: 0,
    differentQuality: 0,
    unrecognizedQualityFlag: 0,
    unavailableOrNonPositive: 0,
    outsideUtcWindow: 0
  };
  const selected: MavenNgimsL3ResampledDensityRow[] = [];
  const targetSpecies = selection.species.trim().toUpperCase();
  for (const entry of imported.rows) {
    if (entry.validation.status === 'rejected') {
      excluded.rejectedByRowValidation += 1;
      continue;
    }
    const row = entry.validation.row;
    if (row.tid !== selection.tid) { excluded.differentTid += 1; continue; }
    if (row.orbit !== selection.orbit) { excluded.differentOrbit += 1; continue; }
    if (row.focusMode !== selection.focusMode) { excluded.differentFocusMode += 1; continue; }
    if (row.species.trim().toUpperCase() !== targetSpecies) { excluded.differentSpecies += 1; continue; }
    if (row.qualityFlag === 'unrecognized') { excluded.unrecognizedQualityFlag += 1; continue; }
    if (
      (selection.quality === 'verified' && row.evidenceStatus !== 'verified_resampled_value') ||
      (selection.quality === 'uncertain' && row.evidenceStatus !== 'uncertain_resampled_value')
    ) {
      if (row.evidenceStatus === 'not_available' || row.evidenceStatus === 'non_positive' || row.evidenceStatus === 'unreliable') {
        excluded.unavailableOrNonPositive += 1;
      } else {
        excluded.differentQuality += 1;
      }
      continue;
    }
    const timeUtc = normalizeMavenIndexUtc(row.timeUtc);
    if (
      timeUtc === null ||
      Date.parse(timeUtc) < Date.parse(startUtc!) ||
      Date.parse(timeUtc) > Date.parse(stopUtc!)
    ) {
      excluded.outsideUtcWindow += 1;
      continue;
    }
    selected.push(row);
  }

  if (selected.length < 2) {
    return {
      status: 'rejected',
      errors: ['fewer than two valid resampled-density rows match the exact product/TID/orbit/focus-mode/species/quality/UTC-window selection'],
      excludedRows: excluded
    };
  }
  selected.sort((a, b) => a.altitudeKm - b.altitudeKm);
  for (let index = 1; index < selected.length; index += 1) {
    if (selected[index].altitudeKm === selected[index - 1].altitudeKm) {
      return { status: 'rejected', errors: ['duplicate altitude-bin rows are not averaged implicitly'], excludedRows: excluded };
    }
  }
  return {
    status: 'completed',
    selection: {
      ...selection,
      sourceProductId: selection.sourceProductId.trim(),
      species: selection.species.trim(),
      timeStartUtc: startUtc!,
      timeStopUtc: stopUtc!
    },
    measurements: selected,
    excludedRows: excluded,
    sourceProductIdentityBasis: 'caller-supplied-not-verified-from-csv-payload',
    eligibleAsMarsPhotochemicalInitialState: false,
    limitations: [
      'L3 res-den is interpolated to equal-pressure altitude and averaged in constant log-density bins; it is not a raw L2 measurement profile.',
      'Table A-9 does not publish a per-row precision or uncertainty column; no sigma is fabricated.',
      'Each row contains altitude and event/species identifiers but not pointwise latitude, longitude, SZA or local solar time.',
      'The source product ID is supplied by the caller and is not cryptographically verified from the CSV payload; retain the detached XML label and downloaded-file hash.',
      'This resampled neutral-density profile is useful for upper-atmosphere analysis only and is not eligible for Mars photochemical or Scheduler initial-state construction.'
    ]
  };
}


/** Select from a PDS4 label-checked import while carrying its fixity provenance. */
export function selectMavenNgimsL3ResampledDensityPds4Profile(
  imported: MavenNgimsL3ResampledDensityPds4ImportResult,
  selection: MavenNgimsL3ResampledDensitySelection
): MavenNgimsL3ResampledDensityPds4SelectionResult {
  if (!imported || (imported.status !== 'imported' && imported.status !== 'imported_forensic_only')) {
    return {
      status: 'rejected',
      errors: imported?.status === 'rejected'
        ? [...imported.errors]
        : ['a PDS4 label-checked res-den import is required']
    };
  }
  const selected = selectMavenNgimsL3ResampledDensityProfile(imported.imported, selection);
  if (selected.status === 'rejected') return selected;
  return {
    ...selected,
    sourceProductIdentityBasis: 'detached-pds4-label-logical-identifier',
    sourceArtifactSha256: imported.provenance.csvSha256,
    detachedLabelAuthenticity: imported.provenance.detachedLabelAuthenticity,
    csvSizeConsistencyStatus: imported.provenance.csvSizeConsistencyStatus,
    forensicOnly: imported.forensicOnly,
    warnings: imported.warnings,
    limitations: [
      ...selected.limitations,
      'The PDS4 label logical_identifier and file_name were checked against the expected archive identity; the detached label file_size status is carried separately.',
      'The file declares no MD5 checksum; SHA-256 is recorded for exact CSV text but is not an independent authenticity or archive fixity proof.',
      'L3 res-den remains an altitude-resampled product; density-bin coordinate semantics are unresolved, no linear concentration is emitted, and it is not a planetary initial state.',
      ...(imported.forensicOnly ? imported.warnings : [])
    ]
  };
}

export interface MavenNgimsL2EventWindowSelection {
  /** Exact PDS product URN or product identifier supplied with the downloaded CSV. */
  readonly sourceProductId: string;
  readonly tid: number;
  readonly orbit: number;
  readonly focusMode: MavenNgimsFocusMode;
  readonly species: string;
  readonly direction: 'inbound' | 'outbound';
  readonly quality: 'verified' | 'uncertain';
  readonly timeStartUtc: string;
  readonly timeStopUtc: string;
}

export interface MavenNgimsL2EventWindowExcludedRowCounts {
  readonly rejectedByRowValidation: number;
  readonly differentTid: number;
  readonly differentOrbit: number;
  readonly differentFocusMode: number;
  readonly differentSpecies: number;
  readonly differentDirection: number;
  readonly differentQuality: number;
  readonly outsideUtcWindow: number;
}

export interface MavenNgimsL2EventWindowProfile {
  readonly species: string;
  readonly orbit: number;
  readonly tid: number;
  readonly direction: 'inbound' | 'outbound';
  readonly quality: 'verified' | 'uncertain';
  readonly measurements: readonly MavenNgimsNeutralMeasurement[];
  readonly limitations: readonly string[];
}

export type MavenNgimsL2EventWindowSelectionResult =
  | {
      readonly status: 'completed';
      readonly selection: MavenNgimsL2EventWindowSelection;
      readonly profile: MavenNgimsL2EventWindowProfile;
      readonly excludedRows: MavenNgimsL2EventWindowExcludedRowCounts;
      readonly sourceProductIdentityBasis: 'caller-supplied-not-verified-from-csv-payload';
      readonly eligibleAsMarsPhotochemicalInitialState: false;
    }
  | {
      readonly status: 'rejected';
      readonly errors: readonly string[];
      readonly excludedRows?: MavenNgimsL2EventWindowExcludedRowCounts;
    };

/**
 * Select one homogeneous NGIMS L2 profile from one exact product/TID/orbit
 * and a caller-declared UTC event window. All non-selected rows are counted
 * by the first exclusion reason; no cross-track, cross-species or cross-window
 * values are averaged. This is a source-backed upper-atmosphere profile only.
 */
export function selectMavenNgimsL2EventWindowProfile(
  imported: MavenNgimsL2CsvImportResult,
  selection: MavenNgimsL2EventWindowSelection
): MavenNgimsL2EventWindowSelectionResult {
  const errors: string[] = [];
  if (!imported || imported.status !== 'parsed') {
    return {
      status: 'rejected',
      errors: imported?.status === 'invalid_csv'
        ? [...imported.errors]
        : ['a successfully parsed NGIMS L2 CSV import is required']
    };
  }
  if (!selection || typeof selection !== 'object') {
    return { status: 'rejected', errors: ['an explicit NGIMS L2 event-window selection is required'] };
  }
  if (typeof selection.sourceProductId !== 'string' || selection.sourceProductId.trim() === '') {
    errors.push('sourceProductId must identify the exact selected PDS product');
  }
  if (!Number.isInteger(selection.tid) || selection.tid <= 0) {
    errors.push('TID must be a positive integer');
  }
  if (!Number.isInteger(selection.orbit) || selection.orbit <= 0) {
    errors.push('orbit must be a positive integer');
  }
  if (!FOCUS_MODES.includes(selection.focusMode)) {
    errors.push('focusMode must be an NGIMS-supported focus mode');
  }
  if (typeof selection.species !== 'string' || selection.species.trim() === '') {
    errors.push('species must be explicit');
  }
  if (selection.direction !== 'inbound' && selection.direction !== 'outbound') {
    errors.push('track direction must be explicitly inbound or outbound');
  }
  if (selection.quality !== 'verified' && selection.quality !== 'uncertain') {
    errors.push('quality class must be explicitly verified or uncertain');
  }
  const startUtc = normalizeMavenIndexUtc(selection.timeStartUtc);
  const stopUtc = normalizeMavenIndexUtc(selection.timeStopUtc);
  if (startUtc === null || stopUtc === null) {
    errors.push('selection window must use valid calendar UTC timestamps ending in Z');
  } else if (Date.parse(startUtc) >= Date.parse(stopUtc)) {
    errors.push('selection window stop must be later than start');
  }
  if (errors.length > 0) return { status: 'rejected', errors };

  const excluded = {
    rejectedByRowValidation: 0,
    differentTid: 0,
    differentOrbit: 0,
    differentFocusMode: 0,
    differentSpecies: 0,
    differentDirection: 0,
    differentQuality: 0,
    outsideUtcWindow: 0
  };
  const selected: MavenNgimsNeutralMeasurement[] = [];
  const selectedSpecies = selection.species.trim().toUpperCase();

  for (const entry of imported.rows) {
    if (entry.validation.status === 'rejected') {
      excluded.rejectedByRowValidation += 1;
      continue;
    }
    const measurement = entry.validation.measurement;
    if (measurement.tid !== selection.tid) {
      excluded.differentTid += 1;
      continue;
    }
    if (measurement.orbit !== selection.orbit) {
      excluded.differentOrbit += 1;
      continue;
    }
    if (measurement.focusMode !== selection.focusMode) {
      excluded.differentFocusMode += 1;
      continue;
    }
    if (measurement.species.trim().toUpperCase() !== selectedSpecies) {
      excluded.differentSpecies += 1;
      continue;
    }
    if (measurement.direction !== selection.direction) {
      excluded.differentDirection += 1;
      continue;
    }
    if (measurement.quality !== selection.quality) {
      excluded.differentQuality += 1;
      continue;
    }
    const measurementTime = normalizeMavenIndexUtc(measurement.timeUtc);
    if (
      measurementTime === null ||
      Date.parse(measurementTime) < Date.parse(startUtc!) ||
      Date.parse(measurementTime) > Date.parse(stopUtc!)
    ) {
      excluded.outsideUtcWindow += 1;
      continue;
    }
    selected.push(measurement);
  }

  if (selected.length < 2) {
    return {
      status: 'rejected',
      errors: ['fewer than two rows match the exact product/TID/orbit/focus-mode/species/track/quality/UTC-window selection'],
      excludedRows: excluded
    };
  }

  const profile = buildMavenNgimsNeutralProfileFromMeasurements(selected);
  if (profile.status !== 'completed' || !profile.measurements) {
    return {
      status: 'rejected',
      errors: profile.status === 'rejected'
        ? [...(profile.errors ?? ['selected NGIMS rows do not form a homogeneous vertical profile'])]
        : ['selected NGIMS rows do not form a homogeneous vertical profile'],
      excludedRows: excluded
    };
  }

  return {
    status: 'completed',
    selection: {
      ...selection,
      sourceProductId: selection.sourceProductId.trim(),
      species: selection.species.trim(),
      timeStartUtc: startUtc!,
      timeStopUtc: stopUtc!
    },
    profile: {
      species: profile.species ?? selection.species,
      orbit: profile.orbit ?? selection.orbit,
      tid: profile.tid ?? selection.tid,
      direction: profile.direction ?? selection.direction,
      quality: profile.quality ?? selection.quality,
      measurements: profile.measurements,
      limitations: [
        ...(profile.limitations ?? []),
        'Selection is tied to one exact PDS product identifier supplied by the caller and an inclusive UTC event window.',
        'The CSV payload itself does not embed or cryptographically verify the PDS URN; retain the downloaded file hash and detached XML label as external provenance.',
        'The profile remains an upper-atmosphere single-species NGIMS observation; it is not a complete planetary initial state.'
      ]
    },
    excludedRows: excluded,
    sourceProductIdentityBasis: 'caller-supplied-not-verified-from-csv-payload',
    eligibleAsMarsPhotochemicalInitialState: false
  };
}

export const MAVEN_IUVS_NO_DAYGLOW_REFERENCE = {
  species: 'NO',
  speciesId: 'no',
  evidenceKind: 'retrieved_remote_density_profile',
  instrument: 'MAVEN / IUVS MUV limb dayglow',
  observation: {
    startDateUtc: '2016-04-06',
    endDateUtc: '2016-04-08',
    marsYear: 33,
    solarLongitudeDeg: { min: 133, max: 134 },
    localSolarTimeHours: 18,
    latitudeDegNorth: 53,
    solarZenithAngleDeg: 75,
    sequentialOrbitProfilesAveraged: 9
  },
  altitudeGridKmAscending: [80, 88, 96, 104, 112, 120, 128] as const,
  retrieval: {
    method: 'limb-radiance onion-peeling inversion with Monte Carlo propagation of the natural variability in the nine-profile mean',
    uppermostPositiveRadianceAltitudeKm: 128,
    assumedEmissionScaleHeightAboveTopKm: 10,
    verticalStepKm: 8,
    retrievalFloorKm: 80,
    belowFloor: 'not_retrieved_due_to_spectral_subtraction_artifacts'
  },
  uncertainty: {
    densityUncertainty: 'one_sigma_natural_variability propagated from the mean of nine profiles by Monte Carlo',
    systematicMuvRadianceFraction: 0.30,
    systematicMeaning: 'reported MUV radiance systematic uncertainty; not a directly published relative sigma for every retrieved NO density node'
  },
  numericalDensityTableIncluded: false,
  numericalDensityTableNote: 'The publication presents the retrieved density profile graphically (Figure 6), not as a numerical table in the article text. No digitized point estimates are fabricated here. The IUVS L1b periapse v13 inputs are public through the MAVEN SDC/PDS; the archived IUVS derived bundle currently does not provide the corresponding density profile as a PDS derived product.',
  provenance: {
    sourceName: 'Stevens et al. (2019), Detection of the Nitric Oxide Dayglow on Mars by MAVEN/IUVS',
    sourceId: 'DOI:10.1029/2019JE005945',
    reference: 'https://doi.org/10.1029/2019JE005945',
    method: 'IUVS MUV NO gamma-band solar resonance fluorescence; nine sequential-orbit mean limb profile, radiance inversion to local number density',
    applicability: 'MY33, 6–8 April 2016, approximately 53 degrees N, local time 18 h, solar zenith angle approximately 75 degrees; upper atmosphere 80–128 km',
    limitations: 'One narrow observing window, not a global climatology. The article reports ±30% systematic MUV radiance uncertainty and a 1-sigma natural-variability band; neither should be conflated with a complete covariance matrix for the retrieved NO density nodes. Numerical point values are not tabulated in the article. NGIMS NO measurements are separately cautioned because N+O recombination inside the instrument may cause a high bias.'
  }
} as const;

export const MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS = {
  species: 'O',
  speciesId: 'o',
  coSpecies: 'CO2',
  coSpeciesId: 'co2',
  altitudeKm: 130,
  evidenceKind: 'model_constrained_by_limb_observations',
  observingConditions: {
    solarLongitudeDeg: 350,
    solarZenithAngleDegApprox: 34,
    latitudeDegApprox: -16
  },
  estimates: [
    {
      marsYear: 32,
      unscaledModelRatio: 0.029,
      publishedModelConstrainedRatio: 0.031,
      co2DensityScaleFactor: 0.7,
      oxygenDensityScaleFactor: 0.77
    },
    {
      marsYear: 33,
      unscaledModelRatio: 0.025,
      publishedModelConstrainedRatio: 0.03,
      co2DensityScaleFactor: 1.5,
      oxygenDensityScaleFactor: 1.8
    }
  ] as const,
  uncertainty: {
    atomicOxygenDensity: 'factor-of-two uncertainty due to surface-recombination processes in the remote-sensing retrieval',
    co2Density: 'can be as large as a factor of 1.5 in the model-atmosphere comparison',
    iuvsFuvAbsoluteCalibrationFraction: 0.25,
    numericRatioSigmaPublished: false
  },
  numericalVerticalProfileIncluded: false,
  provenance: {
    sourceName: 'Ritter et al. (2019), Characteristics of Mars UV Dayglow Emissions From Atomic Oxygen at 130.4 and 135.6 nm: MAVEN/IUVS Limb Observations and Modeling',
    sourceId: 'DOI:10.1029/2019JA026669',
    reference: 'https://doi.org/10.1029/2019JA026669',
    method: 'Atomic-oxygen/CO2 ratios derived from scaled model atmospheres adjusted to reproduce the IUVS 130.4/135.6-nm limb brightness observations',
    applicability: 'Two mean observation sets near Ls=350 degrees in MY32 and MY33; representative profile conditions SZA approximately 34 degrees and latitude approximately 16 degrees south; reported ratio at 130 km',
    limitations: 'These are model-constrained ratios rather than direct in-situ atomic oxygen densities. The model scaling factors differ between MY32 and MY33. Surface recombination contributes a factor-of-two uncertainty to retrieved atomic-O densities; CO2 density can be uncertain by about a factor 1.5. The paper does not publish a numerical uncertainty sigma for the final ratios or a tabulated vertical density profile.'
  }
} as const;


/**
 * NGIMS L3 resampled scale-height / scale-height-temperature product.
 * This is a derived species-specific fit over the exobase-to-homopause
 * density range, not a pointwise thermometer reading at exo_alt.
 */
export const MAVEN_NGIMS_L3_SCALE_HEIGHT_TEMPERATURE_PROVENANCE: MavenUpperAtmosphereProvenance = {
  sourceName: 'MAVEN NGIMS PDS Software Interface Specification, Revision 1.13, Table A-10',
  sourceId: 'MAVEN-NGIMS-SIS-0001 / Rev 1.13 / Table A-10',
  reference: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/document/ngims_pds_sis_v03_r01.pdf',
  method: 'L3 scale height from linear fit of altitude versus log density between exobase and homopause; species-specific temperature computed from H = m g / (k T)',
  applicability: 'MAVEN NGIMS upper-atmosphere per-orbit products; output temperature is a derived fit result for the measured species and fitted altitude interval',
  limitations: 'Temperature is not a local direct detection at exo_alt. Fit quality flags HI/HW/HA/H0 must be retained. The error is fit-residual uncertainty, not a complete physical/instrument covariance. The product cannot by itself initialise the lower-atmosphere Taysum Table B2 photochemical compartment.'
};


export interface MavenNgimsIndexEventWindowIdentity {
  readonly sourceProductId: string;
  readonly tid: number;
  readonly timeStartUtc: string;
  readonly timeStopUtc: string;
}

export type MavenNgimsIndexEventWindowLinkResult =
  | {
      readonly status: 'matched';
      readonly tid: number;
      readonly timeStartUtc: string;
      readonly timeStopUtc: string;
      readonly l2SourceProductId: string;
      readonly l3SourceProductId: string;
      readonly coRegistrationBasis: 'same-tid-and-exact-time-window';
      readonly eligibleAsMarsPhotochemicalInitialState: false;
    }
  | { readonly status: 'rejected'; readonly errors: readonly string[] };

function normalizeMavenIndexUtc(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value.trim())
  ) return null;
  const raw = value.trim();
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return null;
  const normalized = new Date(timestamp).toISOString();
  const expectedSecond = raw.slice(0, 19);
  return normalized.slice(0, 19) === expectedSecond ? normalized : null;
}

/**
 * Link L2 abundance and L3 scale-height index rows only when their TID and
 * UTC observation interval match exactly. This links archive identities, not
 * numerical measurements; it cannot produce density or temperature values.
 */
export function linkMavenNgimsL2L3IndexEventWindow(
  l2: MavenNgimsIndexEventWindowIdentity,
  l3: MavenNgimsIndexEventWindowIdentity
): MavenNgimsIndexEventWindowLinkResult {
  const errors: string[] = [];
  if (!l2 || typeof l2 !== 'object') errors.push('L2 index identity is required');
  if (!l3 || typeof l3 !== 'object') errors.push('L3 index identity is required');
  if (errors.length > 0) return { status: 'rejected', errors };

  if (typeof l2.sourceProductId !== 'string' || l2.sourceProductId.trim() === '') {
    errors.push('L2 sourceProductId must identify the indexed product');
  }
  if (typeof l3.sourceProductId !== 'string' || l3.sourceProductId.trim() === '') {
    errors.push('L3 sourceProductId must identify the indexed product');
  }
  if (!Number.isInteger(l2.tid) || l2.tid <= 0 || !Number.isInteger(l3.tid) || l3.tid <= 0) {
    errors.push('both NGIMS TIDs must be positive integers');
  }
  const l2Start = normalizeMavenIndexUtc(l2.timeStartUtc);
  const l2Stop = normalizeMavenIndexUtc(l2.timeStopUtc);
  const l3Start = normalizeMavenIndexUtc(l3.timeStartUtc);
  const l3Stop = normalizeMavenIndexUtc(l3.timeStopUtc);
  if (l2Start === null || l2Stop === null) errors.push('L2 observation window must contain valid UTC start/stop timestamps');
  if (l3Start === null || l3Stop === null) errors.push('L3 observation window must contain valid UTC start/stop timestamps');
  if (errors.length > 0) return { status: 'rejected', errors };

  if (l2.tid !== l3.tid) {
    return { status: 'rejected', errors: ['L2 and L3 TIDs differ; these rows cannot be linked as the same NGIMS event'] };
  }
  if (l2Start !== l3Start || l2Stop !== l3Stop) {
    return { status: 'rejected', errors: ['L2 and L3 UTC observation windows do not match exactly'] };
  }
  if (Date.parse(l2Start!) >= Date.parse(l2Stop!)) {
    return { status: 'rejected', errors: ['NGIMS observation window stop must be later than start'] };
  }

  return {
    status: 'matched',
    tid: l2.tid,
    timeStartUtc: l2Start!,
    timeStopUtc: l2Stop!,
    l2SourceProductId: l2.sourceProductId,
    l3SourceProductId: l3.sourceProductId,
    coRegistrationBasis: 'same-tid-and-exact-time-window',
    eligibleAsMarsPhotochemicalInitialState: false
  };
}

/**
 * Canonical index cross-match candidate selected from the official NGIMS
 * del1-42 scale-height index and the PDS4 L2 archive directory. Only index
 * identifiers/timing are frozen here; numerical CSV payloads are not present.
 */
export const MAVEN_NGIMS_TID_14282_CROSS_INDEX_CANDIDATE = {
  tid: 14282,
  observationDateUtc: '2014-12-11',
  timeStartUtc: '2014-12-11T15:45:25.000Z',
  timeStopUtc: '2014-12-11T17:29:43.000Z',
  scaleHeightIndex: {
    productId: 'urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-sht-14282_20141211t154406',
    fileName: 'MAVEN_NGIMS_Scale-Height&Temp_del1-42.csv',
    indexHtml: 'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_NGIMS_Scale-Height%26Temp_del1-42.htm',
    rowMidpointUtc: '2014-12-11T17:15:29.000Z',
    indexObservationGeometry: {
      closestApproachUtc: '2014-12-11T17:15:29.000Z',
      solarLongitudeDegSigned: -110.209,
      solarLatitudeDeg: -23.431,
      subSpacecraftLongitudeDeg: 161.514,
      subSpacecraftLatitudeDeg: 73.674,
      spacecraftAltitudeKm: 152.981,
      phaseAngleDeg: 112.218,
      orbitNumber: 391,
      marsSolarLongitudeDeg: 250.49,
      marsYear: 32,
      sourceTable: 'MAVEN_NGIMS_Scale_Heights_del1-22 HTML index',
      isIndexGeometryNotSpeciesMeasurement: true
    }
  },
  l2AbundanceProduct: {
    productId: 'urn:nasa:pds:maven_ngims:l2:mvn_ngi_l2_csn-abund-14282_20141211t154406',
    fileName: 'mvn_ngi_l2_csn-abund-14282_20141211T154406_v08_r01.csv',
    labelFileName: 'mvn_ngi_l2_csn-abund-14282_20141211T154406_v08_r01.xml',
    archiveDirectory: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l2/2014/12/',
    directoryRowVerified: true,
    directoryReportedSize: '526 KB',
    directoryLastModifiedUtc: '2018-08-15T14:27:00Z',
    focusMode: 'csn',
    neutralSpecies: ['Ar', 'CO2', 'He', 'N2'],
    productPayloadImported: false,
    labelPayloadImported: false
  },
  l3ResampledDensityProduct: {
    productId: 'urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-den-14282_20141211t154406',
    fileName: 'mvn_ngi_l3_res-den-14282_20141211T154406_v06_r01.csv',
    labelFileName: 'mvn_ngi_l3_res-den-14282_20141211T154406_v06_r01.xml',
    archiveDirectory: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l3/2014/12/',
    directoryRowVerified: true,
    directoryReportedSize: '23 KB',
    directoryLastModifiedUtc: '2021-08-12T16:28:00Z',
    productType: 'res-den',
    table: 'NGIMS SIS Rev. 1.13 Table A-9',
    densitySemantics: 'interpolated to equal-pressure altitude and averaged in constant log-density bins (0.2 log steps)',
    productPayloadImported: false,
    labelPayloadImported: false
  },
  l3ResampledDensityIndex: {
    productId: 'urn:nasa:pds:maven_ngims:l3:mvn_ngi_l3_res-den-14282_20141211t154406',
    indexHtml: 'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_Derived_Density_NGIMS_Del-1-18.html',
    rowMidpointUtc: '2014-12-11T17:15:29.000Z',
    timeStartUtc: '2014-12-11T15:45:25.000Z',
    timeStopUtc: '2014-12-11T17:29:43.000Z',
    indexObservationGeometry: {
      closestApproachUtc: '2014-12-11T17:15:29.000Z',
      solarLongitudeDegSigned: -110.209,
      solarLatitudeDeg: -23.431,
      subSpacecraftLongitudeDeg: 161.514,
      subSpacecraftLatitudeDeg: 73.674,
      spacecraftAltitudeKm: 152.981,
      phaseAngleDeg: 112.218,
      orbitNumber: 391,
      marsSolarLongitudeDeg: 250.49,
      marsYear: 32,
      sourceTable: 'MAVEN_Derived_Density_NGIMS_Del-1-18 HTML index',
      isIndexGeometryNotSpeciesMeasurement: true
    }
  },
  matching: {
    exactTidMatch: true,
    exactUtcWindowMatch: true,
    resampledDensityIndexVerified: true,
    numericL2CsvImported: false,
    numericL3ResampledDensityCsvImported: false,
    numericL3TemperatureCsvImported: false,
    temperatureIsDerivedScaleHeightFit: true,
    neutralDensitySpeciesFromClosedSource: ['Ar', 'CO2', 'He', 'N2'],
    schedulerInitialStateEligible: false,
    note: 'This is an archive cross-index candidate, not an imported measurement row. It links one TID and exact observation interval; it does not prove per-species numeric values, fit-quality class, or local temperature.'
  },
  provenance: {
    l2IndexHtml: 'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN%20NGIMS%20Single%20Species.html',
    l3IndexHtml: 'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_NGIMS_Scale-Height%26Temp_del1-42.htm',
    l3ResampledDensityIndexHtml: 'https://atmos.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_Derived_Density_NGIMS_Del-1-18.html',
    pds4L2Directory: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l2/2014/12/',
    sis: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/document/ngims_pds_sis_v03_r01.pdf'
  }
} as const;

export type MavenNgimsL3ScaleHeightQualityFlag = 'HI' | 'HW' | 'HA' | 'H0';
export type MavenNgimsL3ScaleHeightFitQuality =
  | 'good_near_isothermic_fit'
  | 'structured_or_wavy_fit'
  | 'high_altitude_fit'
  | 'bad_or_negative_fit_do_not_use';

export interface MavenNgimsL3ScaleHeightTemperatureRow {
  readonly sourceProductId: string;
  readonly timeUtc: string;
  readonly unixTimeSeconds: number;
  readonly spacecraftClockSeconds: number;
  readonly elapsedSinceTidStartSeconds: number;
  readonly tid: number;
  readonly orbit: number;
  readonly exobaseAltitudeKm: number;
  readonly massAmu: number;
  readonly species: string;
  readonly scaleHeightKm: number;
  readonly scaleHeightFitErrorKm: number;
  readonly scaleHeightTemperatureK: number;
  readonly temperatureFitErrorK: number;
  readonly fitResidual: number;
  readonly qualityFlag: MavenNgimsL3ScaleHeightQualityFlag;
  readonly fitQuality: MavenNgimsL3ScaleHeightFitQuality;
  readonly evidenceKind: 'derived_scale_height_temperature';
  readonly eligibleAsLocalNeutralTemperatureObservation: false;
  readonly eligibleAsMarsPhotochemicalInitialState: false;
  readonly provenance: MavenUpperAtmosphereProvenance;
  readonly diagnostics: readonly string[];
}

export type MavenNgimsL3ScaleHeightTemperatureRowValidation =
  | { readonly status: 'parsed'; readonly row: MavenNgimsL3ScaleHeightTemperatureRow }
  | { readonly status: 'rejected'; readonly errors: readonly string[] };

export interface MavenNgimsL3ScaleHeightTemperatureCsvRowResult {
  readonly recordNumber: number;
  readonly validation: MavenNgimsL3ScaleHeightTemperatureRowValidation;
}

export type MavenNgimsL3ScaleHeightTemperatureCsvImportResult =
  | {
      readonly status: 'parsed';
      readonly sourceProductId: string;
      readonly headers: readonly string[];
      readonly rows: readonly MavenNgimsL3ScaleHeightTemperatureCsvRowResult[];
      readonly parsedRowCount: number;
      readonly rejectedRowCount: number;
      readonly goodFitCount: number;
    }
  | { readonly status: 'invalid_csv'; readonly errors: readonly string[] };

export interface MavenNgimsL3ScaleHeightTemperatureSelection {
  readonly tid: number;
  readonly orbit: number;
  readonly species: string;
  readonly qualityFlag: MavenNgimsL3ScaleHeightQualityFlag;
}

export type MavenNgimsL3ScaleHeightTemperatureSelectionResult =
  | {
      readonly status: 'completed';
      readonly selection: MavenNgimsL3ScaleHeightTemperatureSelection;
      readonly rows: readonly MavenNgimsL3ScaleHeightTemperatureRow[];
      readonly limitations: readonly string[];
    }
  | { readonly status: 'rejected'; readonly errors: readonly string[] };

const REQUIRED_NGIMS_L3_SCALE_HEIGHT_COLUMNS = [
  't_utc', 't_unix', 't_sclk', 't_tid', 'tid', 'orbit', 'exo_alt',
  'mass', 'species', 'scale_height', 'scale_height_error',
  'temperature', 'temperature_error', 'fit_residual', 'quality'
] as const;

function strictNgimsUtcTimestamp(value: string): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?Z$/);
  if (!match) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== match[1]) {
    return null;
  }
  return new Date(timestamp).toISOString();
}

/** Table A-9 t_utc is defined as UTC yyyy-mm-ddThh:mm:ss; a trailing Z is optional in the ASCII product. */
function strictNgimsL3UtcTimestamp(value: string): string | null {
  const trimmed = value.trim();
  const withUtcSuffix = /Z$/i.test(trimmed) ? trimmed : trimmed + 'Z';
  return strictNgimsUtcTimestamp(withUtcSuffix);
}

/** Parse one Table A-10 row. "parsed" means structurally valid, not a measured local temperature. */
export function parseMavenNgimsL3ScaleHeightTemperatureCsvRow(
  rawRow: Readonly<Record<string, string | undefined>>,
  sourceProductId: string
): MavenNgimsL3ScaleHeightTemperatureRowValidation {
  if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
    return { status: 'rejected', errors: ['CSV row must be an object'] };
  }
  if (typeof sourceProductId !== 'string' || sourceProductId.trim() === '') {
    return { status: 'rejected', errors: ['sourceProductId must identify the exact NGIMS L3 product'] };
  }

  const row = Object.fromEntries(
    Object.entries(rawRow).map(([key, value]) => [key.trim().toLowerCase(), value])
  ) as Record<string, string | undefined>;
  const errors: string[] = [];
  const timeRaw = row.t_utc;
  const timeUtc = typeof timeRaw === 'string' ? strictNgimsUtcTimestamp(timeRaw.trim()) : null;
  if (timeUtc === null) errors.push('t_utc must be a valid UTC timestamp ending in Z');

  const numberFields = [
    't_unix', 't_sclk', 't_tid', 'tid', 'orbit', 'exo_alt', 'mass',
    'scale_height', 'scale_height_error', 'temperature',
    'temperature_error', 'fit_residual'
  ] as const;
  const numbers = Object.fromEntries(numberFields.map((field) => {
    const raw = row[field];
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : Number.NaN;
    if (!Number.isFinite(value)) errors.push(field + ' must be a finite numeric field');
    return [field, value];
  })) as Record<typeof numberFields[number], number>;

  const species = row.species?.trim();
  if (!species) errors.push('species must be non-empty');
  const qualityFlag = row.quality?.trim().toUpperCase();
  if (qualityFlag !== 'HI' && qualityFlag !== 'HW' && qualityFlag !== 'HA' && qualityFlag !== 'H0') {
    errors.push('quality must be one of HI, HW, HA or H0');
  }
  if (errors.length > 0) return { status: 'rejected', errors };

  if (!Number.isInteger(numbers.tid) || numbers.tid < 0) errors.push('tid must be a non-negative integer');
  if (!Number.isInteger(numbers.orbit) || numbers.orbit <= 0) errors.push('orbit must be a positive integer');
  if (numbers.t_unix < 0 || numbers.t_sclk < 0 || numbers.t_tid < 0) {
    errors.push('unix, spacecraft-clock and elapsed TID times must be non-negative');
  }
  if (numbers.exo_alt <= 0) errors.push('exo_alt must be positive km');
  if (numbers.mass < 2 || numbers.mass > 150) errors.push('mass must be within NGIMS coverage [2,150] Da');
  // H0 explicitly means a bad or negative slope. Preserve its finite
  // non-positive fit outputs for audit, but never treat that row as usable.
  if (numbers.scale_height <= 0 && qualityFlag !== 'H0') {
    errors.push('scale_height must be positive km unless quality is H0');
  }
  if (numbers.scale_height_error < 0) errors.push('scale_height_error cannot be negative');
  if (numbers.temperature <= 0 && qualityFlag !== 'H0') {
    errors.push('temperature must be positive K unless quality is H0');
  }
  if (numbers.temperature_error < 0) errors.push('temperature_error cannot be negative K');
  if (numbers.fit_residual < 0 || numbers.fit_residual > 500) errors.push('fit_residual must be within the SIS range [0,500]');
  if (errors.length > 0) return { status: 'rejected', errors };

  const fitQuality: MavenNgimsL3ScaleHeightFitQuality =
    qualityFlag === 'HI'
      ? 'good_near_isothermic_fit'
      : qualityFlag === 'HW'
        ? 'structured_or_wavy_fit'
        : qualityFlag === 'HA'
          ? 'high_altitude_fit'
          : 'bad_or_negative_fit_do_not_use';
  const diagnostics: string[] = [
    'Temperature is derived from a species-specific scale-height fit using H = m g / (k T), not a direct point measurement.',
    'The fit spans the exobase-to-homopause density range; exo_alt is not a representative local-temperature altitude.',
    'This L3 result is not eligible for direct Mars photochemical initial-state construction.'
  ];
  if (qualityFlag === 'HW') diagnostics.push('SIS quality HW denotes a wavy or structured fit with r2 < 75%.');
  if (qualityFlag === 'HA') diagnostics.push('SIS quality HA denotes a high-altitude fit with the spacecraft above 200 km.');
  if (qualityFlag === 'H0') diagnostics.push('SIS quality H0 denotes a bad or negative fit and must not be used as a temperature estimate; finite non-positive fit outputs are retained only for audit.');

  return {
    status: 'parsed',
    row: {
      sourceProductId,
      timeUtc: timeUtc!,
      unixTimeSeconds: numbers.t_unix,
      spacecraftClockSeconds: numbers.t_sclk,
      elapsedSinceTidStartSeconds: numbers.t_tid,
      tid: numbers.tid,
      orbit: numbers.orbit,
      exobaseAltitudeKm: numbers.exo_alt,
      massAmu: numbers.mass,
      species: species!,
      scaleHeightKm: numbers.scale_height,
      scaleHeightFitErrorKm: numbers.scale_height_error,
      scaleHeightTemperatureK: numbers.temperature,
      temperatureFitErrorK: numbers.temperature_error,
      fitResidual: numbers.fit_residual,
      qualityFlag: qualityFlag as MavenNgimsL3ScaleHeightQualityFlag,
      fitQuality,
      evidenceKind: 'derived_scale_height_temperature',
      eligibleAsLocalNeutralTemperatureObservation: false,
      eligibleAsMarsPhotochemicalInitialState: false,
      provenance: MAVEN_NGIMS_L3_SCALE_HEIGHT_TEMPERATURE_PROVENANCE,
      diagnostics
    }
  };
}

export function parseMavenNgimsL3ScaleHeightTemperatureCsvText(
  csvText: string,
  sourceProductId: string
): MavenNgimsL3ScaleHeightTemperatureCsvImportResult {
  if (typeof csvText !== 'string' || csvText.trim() === '') {
    return { status: 'invalid_csv', errors: ['CSV text is empty'] };
  }
  if (typeof sourceProductId !== 'string' || sourceProductId.trim() === '') {
    return { status: 'invalid_csv', errors: ['sourceProductId must identify the exact NGIMS L3 product'] };
  }
  const parsed = parseNgimsCsvRecords(csvText.replace(/^\uFEFF/, ''));
  if (parsed.error) return { status: 'invalid_csv', errors: [parsed.error] };
  if (parsed.records.length < 2) {
    return { status: 'invalid_csv', errors: ['CSV must contain a header and at least one data record'] };
  }

  const headers = parsed.records[0].map((header) => header.trim().toLowerCase());
  if (headers.some((header) => header === '')) {
    return { status: 'invalid_csv', errors: ['CSV header contains an empty column name'] };
  }
  const duplicateHeaders = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicateHeaders.length > 0) {
    return { status: 'invalid_csv', errors: ['CSV header contains duplicate columns: ' + [...new Set(duplicateHeaders)].join(', ')] };
  }
  const missing = REQUIRED_NGIMS_L3_SCALE_HEIGHT_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    return { status: 'invalid_csv', errors: ['CSV is missing required NGIMS L3 scale-height columns: ' + missing.join(', ')] };
  }

  const rows: MavenNgimsL3ScaleHeightTemperatureCsvRowResult[] = parsed.records.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      return {
        recordNumber: index + 1,
        validation: { status: 'rejected' as const, errors: ['CSV record has ' + values.length + ' fields; expected ' + headers.length] }
      };
    }
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    return {
      recordNumber: index + 1,
      validation: parseMavenNgimsL3ScaleHeightTemperatureCsvRow(record, sourceProductId)
    };
  });
  const parsedRowCount = rows.filter((entry) => entry.validation.status === 'parsed').length;
  const goodFitCount = rows.filter((entry) =>
    entry.validation.status === 'parsed' && entry.validation.row.fitQuality === 'good_near_isothermic_fit'
  ).length;
  return {
    status: 'parsed',
    sourceProductId,
    headers,
    rows,
    parsedRowCount,
    rejectedRowCount: rows.length - parsedRowCount,
    goodFitCount
  };
}

/** Select one exact species/orbit/TID/quality class; never average across products or species. */
export function selectMavenNgimsL3ScaleHeightTemperatureRows(
  imported: MavenNgimsL3ScaleHeightTemperatureCsvImportResult,
  selection: MavenNgimsL3ScaleHeightTemperatureSelection
): MavenNgimsL3ScaleHeightTemperatureSelectionResult {
  if (!imported || imported.status !== 'parsed') {
    return { status: 'rejected', errors: ['a successfully parsed NGIMS L3 scale-height CSV is required'] };
  }
  if (
    !selection ||
    !Number.isInteger(selection.tid) || selection.tid < 0 ||
    !Number.isInteger(selection.orbit) || selection.orbit <= 0 ||
    typeof selection.species !== 'string' || selection.species.trim() === '' ||
    !['HI', 'HW', 'HA', 'H0'].includes(selection.qualityFlag)
  ) {
    return { status: 'rejected', errors: ['selection must identify TID, orbit, species and exact quality flag'] };
  }

  const rows = imported.rows.flatMap((entry) => {
    if (entry.validation.status !== 'parsed') return [];
    const row = entry.validation.row;
    return row.tid === selection.tid &&
      row.orbit === selection.orbit &&
      row.species.trim().toUpperCase() === selection.species.trim().toUpperCase() &&
      row.qualityFlag === selection.qualityFlag
      ? [row]
      : [];
  }).sort((a, b) => Date.parse(a.timeUtc) - Date.parse(b.timeUtc));

  if (rows.length === 0) {
    return { status: 'rejected', errors: ['no rows match the exact NGIMS TID/orbit/species/quality selection'] };
  }
  if (rows.some((row) =>
    row.tid !== selection.tid || row.orbit !== selection.orbit ||
    row.species.trim().toUpperCase() !== selection.species.trim().toUpperCase() ||
    row.qualityFlag !== selection.qualityFlag
  )) {
    return { status: 'rejected', errors: ['selected NGIMS L3 rows do not share one TID/orbit/species/quality identity'] };
  }

  return {
    status: 'completed',
    selection: { ...selection, species: selection.species.trim() },
    rows,
    limitations: [
      'Rows retain the exact L3 TID, orbit, species, fit quality and original product ID; no cross-orbit, cross-TID or cross-species aggregation is performed.',
      'The temperature is derived from a linear altitude-versus-log-density scale-height fit over the exobase-to-homopause interval, not a local temperature measurement.',
      'The table supplies exobase altitude, not the representative altitude of the fitted interval; it cannot be co-registered to a single lower-atmosphere altitude node.',
      'The selected derived temperature is not eligible for direct Mars photochemical initial-state construction.'
    ]
  };
}
