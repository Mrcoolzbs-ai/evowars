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
  dataAvailableThroughUtc: '2025-02-15',
  archiveIndexFiles: [
    {
      product: 'L2 neutral single-species abundance index',
      fileName: 'MAVEN_NGIMS_l2_del1-35.csv',
      revision: 'del1-35',
      lastModifiedUtc: '2023-11-15',
      url: 'https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/logs/MAVEN_NGIMS_l2_del1-35.csv'
    }
  ] as const,
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
