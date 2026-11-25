// MAVEN NGIMS L1B calibrated signal evidence — Stage 4.2.
// L1B is a calibrated instrument-signal product, not an L2 abundance product.
// No m/z-to-species mapping or CPS-to-particles/cm3 conversion is performed.
// Source: NGIMS SIS Rev. 1.13, Table A-6 and §3.3.

export const MAVEN_NGIMS_L1B_SIS_PROVENANCE = {
  name: 'MAVEN NGIMS PDS Software Interface Specification, Revision 1.13',
  url: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/document/ngims_pds_sis_v03_r01.pdf',
  table: 'A-6',
  openSourceCalibrationSection: '§3.3',
  signalUnit: 'counts_per_second',
  speciesIdentity: 'mass_to_charge_is_not_unique_species_identity',
  calibrationRequirement: 'closed/open reference-species response, closed-source sensitivity and energy correction factor C_EN'
} as const;

export const MAVEN_NGIMS_L1B_PRODUCT_TID_14282 = {
  productId: 'urn:nasa:pds:maven_ngims:l1b:mvn_ngi_l1b_osnb-14282_20141211t154406',
  fileName: 'mvn_ngi_l1b_osnb-14282_20141211T154406_v09_r01.csv',
  labelFileName: 'mvn_ngi_l1b_osnb-14282_20141211T154406_v09_r01.xml',
  csvUrl: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l1b/2014/12/mvn_ngi_l1b_osnb-14282_20141211T154406_v09_r01.csv',
  labelUrl: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/l1b/2014/12/mvn_ngi_l1b_osnb-14282_20141211T154406_v09_r01.xml',
  tid: 14282,
  orbit: 391,
  eventWindowUtc: { start: '2014-12-11T15:45:25Z', stop: '2014-12-11T17:29:43Z' },
  payloadWindowUtc: { start: '2014-12-11T17:03:58.937Z', stop: '2014-12-11T17:27:14.447Z' },
  rowCount: 39999,
  focusModeRowCounts: { csn: 22579, osnb: 17420 },
  csvByteLength: 14600292,
  csvSha256: '342ba5b2045844b49cb2344f53e25d977aff05fc996e3db032caf7613ef0c486',
  labelDeclaredFileSizeBytes: 14603490,
  sizeDifferenceBytes: 3198,
  csvSizeConsistencyStatus: 'mismatch_forensic_only',
  md5ChecksumStatus: 'not_present_in_detached_label',
  csvFixityStatus: 'sha256_computed_not_compared_to_archive_checksum',
  detachedLabelAuthenticity: 'not_independently_authenticated',
  forensicOnly: true,
  interpretation: {
    mOverZIsNotUniqueSpecies: true,
    mass16And30AreCandidateSignalsOnly: true,
    cpsIsNotNumberDensity: true,
    densityConversionApplied: false,
    focusModesMustNotBeMerged: true,
    noOOrNoNeutralAbundanceClaim: true,
    calibrationResponseAndFragmentationModelRequired: true
  }
} as const;

export const MAVEN_NGIMS_L1B_LIMITATIONS = [
  'L1B calibrated counts/CPS are instrument signals, not L2 neutral abundances or number densities.',
  'A mass-to-charge channel is not a unique molecular species identifier; m/z 16 and 30 remain candidate signals only.',
  'The L1B quality field TSC/TSU describes SCLK time correction, not L2 science quality (IV/IU/OV/OU/UR).',
  'Open-source sensitivity requires reference-species calibration, closed/open response information and the applicable energy correction factor; these are not inferred from this CSV.',
  'The detached PDS4 label declares 3,198 more bytes than the exact CSV payload and contains no MD5; the original payload remains forensic-only.',
  'This product is not eligible as a Mars photochemical initial state or Scheduler initial abundance.'
] as const;

export const MAVEN_NGIMS_L1B_CSV_HEADERS = [
  't_utc','t_unix','t_sclk_raw','t_sclk_cor','t_tid','tid','umkid','orbit',
  'focus_mode','multiplier','filament','temperature_s','mass','counts',
  'cps_raw','cps_raw_bkgd','cps_dt','cps_dt_bkgd','bkgd','alt_iau','vsc_iau',
  'ram1','ram2_rot_angle','sol_lon','sol_lat','lst','x_iau','y_iau','z_iau',
  'vx_iau','vy_iau','vz_iau','lat','long','sza','quality'
] as const;

export type MavenNgimsL1bFocusMode = 'csn' | 'osnb' | 'osion';
export type MavenNgimsL1bTimeCorrection = 'corrected' | 'uncorrected' | 'unrecognized';

export interface MavenNgimsL1bSignalRow {
  readonly recordNumber: number;
  readonly timeUtc: string;
  readonly unixTimeSeconds: number;
  readonly tid: number;
  readonly orbit: number;
  readonly focusMode: MavenNgimsL1bFocusMode;
  readonly massToChargeAmuPerE: number | null;
  readonly counts: number | null;
  readonly cpsRawHz: number | null;
  readonly cpsRawBackgroundSubtractedHz: number | null;
  readonly cpsDeadTimeCorrectedHz: number | null;
  readonly cpsDeadTimeCorrectedBackgroundSubtractedHz: number | null;
  readonly backgroundHz: number | null;
  readonly altitudeKm: number | null;
  readonly latitudeDeg: number | null;
  readonly longitudeDeg: number | null;
  readonly solarZenithAngleDeg: number | null;
  readonly ionSourceTemperatureC: number | null;
  readonly qualityFlagRaw: string;
  readonly timeCorrection: MavenNgimsL1bTimeCorrection;
  readonly rawFields: Readonly<Record<string,string>>;
  readonly speciesId: null;
  readonly abundanceParticlesPerCm3: null;
  readonly eligibleAsSchedulerInitialAbundance: false;
  readonly eligibleAsMarsPhotochemicalInitialState: false;
}

export type MavenNgimsL1bRowValidation =
  | { readonly status: 'parsed'; readonly row: MavenNgimsL1bSignalRow }
  | { readonly status: 'rejected'; readonly errors: readonly string[] };

export interface MavenNgimsL1bCsvRowResult {
  readonly recordNumber: number;
  readonly validation: MavenNgimsL1bRowValidation;
}

export type MavenNgimsL1bCsvImportResult =
  | { readonly status: 'parsed'; readonly headers: readonly string[]; readonly rows: readonly MavenNgimsL1bCsvRowResult[]; readonly parsedRowCount: number; readonly rejectedRowCount: number }
  | { readonly status: 'invalid_csv'; readonly errors: readonly string[] };

export interface MavenNgimsL1bSignalSelection {
  readonly tid: number;
  readonly orbit: number;
  readonly focusMode: MavenNgimsL1bFocusMode;
  readonly startUtc: string;
  readonly stopUtc: string;
  readonly massToChargeAmuPerE?: readonly number[];
}

export interface MavenNgimsL1bSignalSelectionResult {
  readonly status: 'completed' | 'rejected';
  readonly selection?: MavenNgimsL1bSignalSelection;
  readonly rows?: readonly MavenNgimsL1bSignalRow[];
  readonly selectedRowCount?: number;
  readonly rowCountByMassToCharge?: Readonly<Record<string,number>>;
  readonly excludedRowCount?: number;
  readonly errors?: readonly string[];
  readonly speciesIdentification: 'not_performed';
  readonly densityConversionPerformed: false;
  readonly eligibleAsSchedulerInitialAbundance: false;
  readonly eligibleAsMarsPhotochemicalInitialState: false;
  readonly limitations: readonly string[];
}

const FOCUS_MODES: readonly string[] = ['csn','osnb','osion'];
const CONTEXT_NUMERIC_FIELDS = [
  't_sclk_cor','t_tid','temperature_s','alt_iau','vsc_iau','ram1','ram2_rot_angle',
  'sol_lon','sol_lat','lst','x_iau','y_iau','z_iau','vx_iau','vy_iau','vz_iau',
  'lat','long','sza'
] as const;

function parseCsv(textInput: string): { rows?: string[][]; error?: string } {
  const text = textInput.charCodeAt(0) === 0xfeff ? textInput.slice(1) : textInput;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      if (row.some(value => value.length > 0)) rows.push(row);
      row = []; cell = '';
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
    } else if (ch === '"') return { error: 'unexpected quote outside a quoted CSV field at character ' + i };
    else cell += ch;
  }
  if (quoted) return { error: 'unterminated quoted CSV field' };
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some(value => value.length > 0)) rows.push(row);
  }
  return { rows };
}

function numberValue(value: string | undefined, field: string, errors: string[], required = false): number | null {
  const raw = value?.trim() ?? '';
  if (!raw) { if (required) errors.push(field + ' is required'); return null; }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) { errors.push(field + ' must be finite'); return null; }
  return parsed;
}

function integerValue(value: string | undefined, field: string, errors: string[], required = false): number | null {
  const parsed = numberValue(value, field, errors, required);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) { errors.push(field + ' must be an integer'); return null; }
  return parsed;
}

function utcSecond(value: string | undefined, errors: string[]): string | null {
  const raw = value?.trim() ?? '';
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$/.exec(raw);
  if (!match) { errors.push('t_utc must be a timezone-naive PDS UTC second token'); return null; }
  const date = new Date(match[1] + 'Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,19) !== match[1]) {
    errors.push('t_utc is not a valid UTC calendar date'); return null;
  }
  return match[1] + 'Z';
}

function validateSignalRow(record: Record<string,string>, recordNumber: number): MavenNgimsL1bRowValidation {
  const errors: string[] = [];
  const timeUtc = utcSecond(record.t_utc, errors);
  const unixTime = numberValue(record.t_unix, 't_unix', errors, true);
  const tid = integerValue(record.tid, 'tid', errors, true);
  const orbit = integerValue(record.orbit, 'orbit', errors, true);
  const focusMode = (record.focus_mode ?? '').trim().toLowerCase();
  const mass = numberValue(record.mass, 'mass', errors);
  const counts = integerValue(record.counts, 'counts', errors);
  const cpsRaw = numberValue(record.cps_raw, 'cps_raw', errors);
  const cpsRawBackground = numberValue(record.cps_raw_bkgd, 'cps_raw_bkgd', errors);
  const cpsDeadTimeCorrected = numberValue(record.cps_dt, 'cps_dt', errors);
  const cpsDeadTimeCorrectedBackground = numberValue(record.cps_dt_bkgd, 'cps_dt_bkgd', errors);
  const background = numberValue(record.bkgd, 'bkgd', errors);
  const context: Record<string,number|null> = {};
  for (const key of CONTEXT_NUMERIC_FIELDS) context[key] = numberValue(record[key], key, errors);

  if (!FOCUS_MODES.includes(focusMode)) errors.push('focus_mode is not a recognized NGIMS L1B mode');
  if (mass !== null && (mass < 1.5 || mass > 450)) errors.push('mass is outside the L1B scan range 1.5–450 amu/e');
  if (counts !== null && counts < 0) errors.push('counts cannot be negative');
  for (const [key,value] of [['cps_raw',cpsRaw],['cps_raw_bkgd',cpsRawBackground],['cps_dt',cpsDeadTimeCorrected],['cps_dt_bkgd',cpsDeadTimeCorrectedBackground],['bkgd',background]] as const) {
    if (value !== null && value < 0) errors.push(key + ' cannot be negative');
  }
  if (tid !== null && tid <= 0) errors.push('tid must be positive');
  if (orbit !== null && orbit <= 0) errors.push('orbit must be positive');
  if (errors.length || !timeUtc || unixTime === null || tid === null || orbit === null) return { status:'rejected', errors };

  const quality = (record.quality ?? '').trim().toUpperCase();
  const timeCorrection: MavenNgimsL1bTimeCorrection =
    quality === 'TSC' ? 'corrected' : quality === 'TSU' ? 'uncorrected' : 'unrecognized';
  return {
    status:'parsed',
    row:{
      recordNumber,timeUtc,unixTimeSeconds:unixTime,tid,orbit,
      focusMode:focusMode as MavenNgimsL1bFocusMode,
      massToChargeAmuPerE:mass,counts,
      cpsRawHz:cpsRaw,cpsRawBackgroundSubtractedHz:cpsRawBackground,
      cpsDeadTimeCorrectedHz:cpsDeadTimeCorrected,
      cpsDeadTimeCorrectedBackgroundSubtractedHz:cpsDeadTimeCorrectedBackground,
      backgroundHz:background,altitudeKm:context.alt_iau,
      latitudeDeg:context.lat,longitudeDeg:context.long,
      solarZenithAngleDeg:context.sza,ionSourceTemperatureC:context.temperature_s,
      qualityFlagRaw:quality,timeCorrection,rawFields:{...record},
      speciesId:null,abundanceParticlesPerCm3:null,
      eligibleAsSchedulerInitialAbundance:false,
      eligibleAsMarsPhotochemicalInitialState:false
    }
  };
}

export function parseMavenNgimsL1bCsvText(csvText: string): MavenNgimsL1bCsvImportResult {
  if (typeof csvText !== 'string' || csvText.trim() === '') return { status:'invalid_csv',errors:['CSV text is empty'] };
  const parsed = parseCsv(csvText);
  if (!parsed.rows?.length) return { status:'invalid_csv',errors:[parsed.error ?? 'CSV contains no records'] };
  const headers = parsed.rows[0].map(value => value.trim().toLowerCase());
  const expected = MAVEN_NGIMS_L1B_CSV_HEADERS as readonly string[];
  if (new Set(headers).size !== headers.length) return { status:'invalid_csv',errors:['CSV contains duplicate headers'] };
  if (headers.length !== expected.length || headers.some((value,index) => value !== expected[index])) {
    return { status:'invalid_csv',errors:['CSV headers do not match MAVEN NGIMS L1B Table A-6 schema/order'] };
  }
  const rows: MavenNgimsL1bCsvRowResult[] = [];
  for (let i=1;i<parsed.rows.length;i+=1) {
    const values=parsed.rows[i], recordNumber=i+1;
    if (values.length !== headers.length) {
      rows.push({recordNumber,validation:{status:'rejected',errors:['field count mismatch: expected '+headers.length+', received '+values.length]}});
      continue;
    }
    const record: Record<string,string> = {};
    headers.forEach((header,index)=>{record[header]=values[index];});
    rows.push({recordNumber,validation:validateSignalRow(record,recordNumber)});
  }
  return {
    status:'parsed',headers,rows,
    parsedRowCount:rows.filter(item=>item.validation.status==='parsed').length,
    rejectedRowCount:rows.filter(item=>item.validation.status==='rejected').length
  };
}

const LIMITATIONS = [
  ...MAVEN_NGIMS_L1B_LIMITATIONS,
  'Selection filters signal rows only; it does not calibrate, identify species, interpolate, average or convert signals.'
] as const;

function selectionTime(value: string): number | null {
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match) return null;
  const calendar=new Date(match[1]+'Z'), parsed=Date.parse(value);
  return Number.isFinite(parsed) && calendar.toISOString().slice(0,19)===match[1] ? parsed : null;
}

export function selectMavenNgimsL1bMassChannelSignals(
  imported: MavenNgimsL1bCsvImportResult,
  selection: MavenNgimsL1bSignalSelection
): MavenNgimsL1bSignalSelectionResult {
  if (imported.status!=='parsed') return {
    status:'rejected',errors:['a parsed L1B CSV is required'],speciesIdentification:'not_performed',
    densityConversionPerformed:false,eligibleAsSchedulerInitialAbundance:false,
    eligibleAsMarsPhotochemicalInitialState:false,limitations:LIMITATIONS
  };
  const start=selectionTime(selection.startUtc), stop=selectionTime(selection.stopUtc);
  if (!Number.isInteger(selection.tid)||selection.tid<=0||!Number.isInteger(selection.orbit)||
      selection.orbit<=0||!FOCUS_MODES.includes(selection.focusMode)||start===null||stop===null||start>stop) {
    return {status:'rejected',errors:['selection needs positive TID/orbit, known focus mode and ordered ISO-UTC window'],
      speciesIdentification:'not_performed',densityConversionPerformed:false,
      eligibleAsSchedulerInitialAbundance:false,eligibleAsMarsPhotochemicalInitialState:false,limitations:LIMITATIONS};
  }
  const masses=selection.massToChargeAmuPerE?new Set(selection.massToChargeAmuPerE):null;
  if (masses&&[...masses].some(value=>!Number.isFinite(value)||value<1.5||value>450)) {
    return {status:'rejected',errors:['invalid mass-to-charge channel'],speciesIdentification:'not_performed',
      densityConversionPerformed:false,eligibleAsSchedulerInitialAbundance:false,
      eligibleAsMarsPhotochemicalInitialState:false,limitations:LIMITATIONS};
  }
  const selected:MavenNgimsL1bSignalRow[]=[];
  let excluded=0;
  for (const entry of imported.rows) {
    if (entry.validation.status!=='parsed') {excluded+=1;continue;}
    const row=entry.validation.row, time=Date.parse(row.timeUtc);
    if(row.tid!==selection.tid||row.orbit!==selection.orbit||row.focusMode!==selection.focusMode||
       time<start||time>stop||row.massToChargeAmuPerE===null||
       (masses!==null&&!masses.has(row.massToChargeAmuPerE))) {excluded+=1;continue;}
    selected.push(row);
  }
  if(!selected.length) return {status:'rejected',errors:['no parsed L1B rows match the exact selection'],
    excludedRowCount:excluded,speciesIdentification:'not_performed',densityConversionPerformed:false,
    eligibleAsSchedulerInitialAbundance:false,eligibleAsMarsPhotochemicalInitialState:false,limitations:LIMITATIONS};
  const counts:Record<string,number>={};
  for(const row of selected){const key=String(row.massToChargeAmuPerE);counts[key]=(counts[key]??0)+1;}
  return {status:'completed',selection,rows:selected,selectedRowCount:selected.length,
    rowCountByMassToCharge:counts,excludedRowCount:excluded,speciesIdentification:'not_performed',
    densityConversionPerformed:false,eligibleAsSchedulerInitialAbundance:false,
    eligibleAsMarsPhotochemicalInitialState:false,limitations:LIMITATIONS};
}
