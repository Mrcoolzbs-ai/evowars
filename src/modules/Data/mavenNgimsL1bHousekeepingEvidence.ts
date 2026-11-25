// MAVEN NGIMS L1B phase-to-housekeeping association — Stage 4.2.
//
// PDS cal-hk MKID means "the numeric ID of the most recent marker to occur
// at TIME". Therefore rows are associated by exact MKID equality with a
// phase-start marker. TIME is retained as source telemetry context only;
// no cross-clock comparison with cal-mkr TIME or L1B t_sclk_cor is made.

import type {
  MavenNgimsL1bMarkerCsvImportResult,
  MavenNgimsL1bPhaseInterval
} from './mavenNgimsL1bMarkerEvidence';

export const MAVEN_NGIMS_L1B_HK_EXPECTED_COLUMN_COUNT = 324;

export const MAVEN_NGIMS_L1B_HK_FIELD_UNITS = {
  'CDH:OS_FIL1_VMON': 'Volts',
  'CDH:OS_FIL2_VMON': 'Volts',
  'CDH:OS_FIL_EMON': 'Microamperes',
  'CDH:OS_FIL1_IMON': 'Amperes',
  'CDH:OS_FIL2_IMON': 'Amperes',
  'CDH:OS_TRAP_MON': 'Volts',
  'CDH:OS_TMP': 'Degrees Celsius',
  'CDH:CS_FIL1_VMON': 'Volts',
  'CDH:CS_FIL2_VMON': 'Volts',
  'CDH:CS_FIL_EMON': 'Microamperes',
  'CDH:CS_FIL1_IMON': 'Amperes',
  'CDH:CS_FIL2_IMON': 'Amperes',
  'CDH:CS_TRAP_MON': 'Volts',
  'CDH:CS_TMP': 'Degrees Celsius',
  'CDH:EM1_IMON': 'Amperes',
  'CDH:EM2_IMON': 'Amperes',
  'CDH:MULTANA1': 'Volts',
  'CDH:MULTANA2': 'Volts',
  'CDH:BA_FIL_VMON': 'Volts',
  'CDH:BA_FIL_IMON': 'Amperes',
  'CDH:BA_FIL_EMIS': 'Volts',
  'CDH:BA_PRES': 'Volts',
  'CDH:THPRES': 'Volts',
  'CDH:IF_TMP': 'Degrees Celsius',
  'CDH:IS_TMP': 'Degrees Celsius',
  'CDH:AGC_TMP': 'Degrees Celsius',
  'CDH:DET_TMP': 'Degrees Celsius',
  'CDH:RF_TMP': 'Degrees Celsius',
  'CDH:PS_TMP': 'Degrees Celsius',
  'QMS:RF_FREQ': 'Megahertz',
  'QMS:OS_FIL1_VCTL': 'Volts',
  'QMS:OS_FIL1_ECTL': 'Volts',
  'QMS:OS_FIL2_VCTL': 'Volts',
  'QMS:OS_FIL2_ECTL': 'Volts',
  'QMS:CS_FIL1_VCTL': 'Volts',
  'QMS:CS_FIL1_ECTL': 'Volts',
  'QMS:CS_FIL2_VCTL': 'Volts',
  'QMS:CS_FIL2_ECTL': 'Volts',
  'QMS:FIL_ON_CTRL': 'Volts',
  'QMS:IP_COUNT': 'seconds',
  'QMS:IP_SETUP': 'seconds',
  'QMS:FIL_SELECT': 'unitless'
} as const;

export const MAVEN_NGIMS_L1B_HK_PHASE_FIELDS = Object.entries(
  MAVEN_NGIMS_L1B_HK_FIELD_UNITS
).map(([name, unit]) => ({ name, unit })) as readonly MavenNgimsL1bHousekeepingFieldSpec[];

export const MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS = [
  'Phase membership uses exact HK MKID equality with the cal-mkr phase-start marker ID; no timestamp join is performed.',
  'PDS describes HK TIME as an NGIMS-internal SCLK approximation. TIME values are retained, not used to align with cal-mkr TIME or L1B t_sclk_cor.',
  'MKID is the most recent marker at the HK observation time. Rows carrying the phase-end marker ID are kept as post-phase context, not folded into the phase.',
  'Blank or non-phase MKID rows remain unassigned; values are never forward-filled across marker changes.',
  'Empty HK channel cells mean that channel was not read at that record; no interpolation or carry-forward is performed.',
  'Housekeeping readbacks are instrument telemetry, not species abundance, absolute sensitivity, fragmentation response, C_EN, or neutral number density.',
  'All results are ineligible for Scheduler initial abundance and Mars photochemical initial-state construction.'
] as const;

export interface MavenNgimsL1bHousekeepingFieldSpec {
  readonly name: string;
  readonly unit: string;
}

export interface MavenNgimsL1bHousekeepingFieldStatistics {
  readonly name: string;
  readonly unit: string;
  readonly observedValueCount: number;
  readonly emptyValueCount: number;
  readonly nonNumericValueCount: number;
  readonly minObservedValue: number | null;
  readonly maxObservedValue: number | null;
  readonly firstObservedRawValue: string | null;
  readonly lastObservedRawValue: string | null;
}

export interface MavenNgimsL1bHousekeepingPhaseSample {
  readonly sourceRecordNumber: number;
  readonly timeSclkRaw: string;
  readonly markerId: number;
  readonly fields: Readonly<Record<string, string | null>>;
}

export interface MavenNgimsL1bHousekeepingPhaseAssociation {
  readonly phaseIndex: number;
  readonly phaseStartMarkerId: number;
  readonly phaseEndMarkerId: number;
  readonly markerStartSclkSeconds: number;
  readonly markerEndSclkSeconds: number;
  readonly markerDurationSclkSeconds: number;
  readonly associationRule: 'HK_MKID_equals_phase_start_MKID';
  readonly associatedRowCount: number;
  readonly firstSourceRecordNumber: number | null;
  readonly lastSourceRecordNumber: number | null;
  readonly firstObservedTimeSclkRaw: string | null;
  readonly lastObservedTimeSclkRaw: string | null;
  readonly endMarkerContextRowCount: number;
  readonly fieldStatistics: readonly MavenNgimsL1bHousekeepingFieldStatistics[];
  readonly sampleRows: readonly MavenNgimsL1bHousekeepingPhaseSample[];
}

export interface MavenNgimsL1bHousekeepingPhaseAssociationResult {
  readonly status: 'completed' | 'rejected';
  readonly sourceRowCount?: number;
  readonly rejectedRowCount?: number;
  readonly blankMarkerIdRowCount?: number;
  readonly nonPhaseRowCount?: number;
  readonly unknownMarkerIdRowCount?: number;
  readonly rowCountByMarkerId?: Readonly<Record<string, number>>;
  readonly phaseAssociations?: readonly MavenNgimsL1bHousekeepingPhaseAssociation[];
  readonly matchedPhaseRowCount?: number;
  readonly associationRule?: 'HK_MKID_equals_phase_start_MKID';
  readonly timeValuesUsedForAssociation?: false;
  readonly utcConversionPerformed?: false;
  readonly l1bCorrectedClockCorrelationPerformed?: false;
  readonly interpolationPerformed?: false;
  readonly carryForwardPerformed?: false;
  readonly eligibleAsSchedulerInitialAbundance?: false;
  readonly eligibleAsMarsPhotochemicalInitialState?: false;
  readonly errors?: readonly string[];
  readonly limitations: readonly string[];
}

interface MutableFieldStatistics {
  readonly spec: MavenNgimsL1bHousekeepingFieldSpec;
  observedValueCount: number;
  emptyValueCount: number;
  nonNumericValueCount: number;
  minObservedValue: number | null;
  maxObservedValue: number | null;
  firstObservedRawValue: string | null;
  lastObservedRawValue: string | null;
}

interface MutablePhaseAssociation {
  readonly interval: MavenNgimsL1bPhaseInterval;
  associatedRowCount: number;
  firstSourceRecordNumber: number | null;
  lastSourceRecordNumber: number | null;
  firstObservedTimeSclkRaw: string | null;
  lastObservedTimeSclkRaw: string | null;
  endMarkerContextRowCount: number;
  readonly fields: MutableFieldStatistics[];
  readonly firstSamples: MavenNgimsL1bHousekeepingPhaseSample[];
  readonly lastSamples: MavenNgimsL1bHousekeepingPhaseSample[];
}

function parseCsvLine(line: string): { values?: string[]; error?: string } {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
    } else if (char === '"' && value.length === 0) {
      quoted = true;
    } else if (char === ',') {
      values.push(value);
      value = '';
    } else if (char === '"') {
      return { error: 'unexpected quote outside a quoted field' };
    } else {
      value += char;
    }
  }
  if (quoted) return { error: 'unterminated quoted field in a single CSV record' };
  values.push(value);
  return { values };
}

function finiteNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function sampleFromRow(
  sourceRecordNumber: number,
  timeRaw: string,
  markerId: number,
  values: readonly string[],
  fieldIndexes: ReadonlyMap<string, number>,
  fieldSpecs: readonly MavenNgimsL1bHousekeepingFieldSpec[]
): MavenNgimsL1bHousekeepingPhaseSample {
  const fields: Record<string, string | null> = {};
  for (const spec of fieldSpecs) {
    const index = fieldIndexes.get(spec.name);
    fields[spec.name] = index === undefined ? null : (values[index]?.trim() || null);
  }
  return { sourceRecordNumber, timeSclkRaw: timeRaw, markerId, fields };
}

/**
 * Associate cal-hk rows with marker-defined phases using the PDS MKID field.
 * The cal-hk label defines MKID as the most recent marker at TIME. A row is
 * assigned to a phase only when its MKID exactly equals that phase's start
 * marker ID. The TIME fields are deliberately not compared across products.
 *
 * The parser processes one CSV record at a time and returns bounded samples
 * plus per-channel observed ranges, avoiding retention of the full 32 MB HK
 * table in memory.
 */
export function associateMavenNgimsL1bHousekeepingRowsByPhase(
  housekeepingCsvText: string,
  markerImport: MavenNgimsL1bMarkerCsvImportResult,
  options: {
    readonly fields?: readonly MavenNgimsL1bHousekeepingFieldSpec[];
    readonly expectedColumnCount?: number;
  } = {}
): MavenNgimsL1bHousekeepingPhaseAssociationResult {
  if (typeof housekeepingCsvText !== 'string' || housekeepingCsvText.trim() === '') {
    return { status: 'rejected', errors: ['housekeeping CSV text is empty'], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
  }
  if (!markerImport || markerImport.status !== 'parsed') {
    return { status: 'rejected', errors: ['a successfully parsed cal-mkr event is required'], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
  }

  const fieldSpecs = options.fields ?? MAVEN_NGIMS_L1B_HK_PHASE_FIELDS;
  const expectedColumnCount = options.expectedColumnCount ?? MAVEN_NGIMS_L1B_HK_EXPECTED_COLUMN_COUNT;
  if (!Number.isInteger(expectedColumnCount) || expectedColumnCount < 2) {
    return { status: 'rejected', errors: ['expectedColumnCount must be an integer of at least 2'], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
  }
  if (new Set(fieldSpecs.map(field => field.name)).size !== fieldSpecs.length ||
      fieldSpecs.some(field => !field.name.trim() || !field.unit.trim())) {
    return { status: 'rejected', errors: ['telemetry field specifications must have unique non-empty names and units'], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
  }

  const lines = housekeepingCsvText.split(/\r\n|\n|\r/);
  const headerRecord = parseCsvLine(lines[0].replace(/^\uFEFF/, ''));
  if (!headerRecord.values) {
    return { status: 'rejected', errors: ['invalid HK CSV header: ' + headerRecord.error], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
  }
  const headers = headerRecord.values.map(value => value.trim());
  if (headers.length !== expectedColumnCount) {
    return { status: 'rejected', errors: ['HK CSV column count mismatch: expected ' + expectedColumnCount + ', received ' + headers.length], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
  }
  if (new Set(headers).size !== headers.length) {
    return { status: 'rejected', errors: ['HK CSV contains duplicate column names'], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
  }
  const timeIndex = headers.indexOf('TIME');
  const markerIndex = headers.indexOf('MKID');
  if (timeIndex < 0 || markerIndex < 0) {
    return { status: 'rejected', errors: ['HK CSV must contain TIME and MKID columns'], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
  }

  const fieldIndexes = new Map<string, number>();
  for (const spec of fieldSpecs) {
    const index = headers.indexOf(spec.name);
    if (index < 0) {
      return { status: 'rejected', errors: ['HK CSV is missing selected telemetry field ' + spec.name], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
    }
    fieldIndexes.set(spec.name, index);
  }

  const phaseByStartMarker = new Map<number, MutablePhaseAssociation>();
  const phaseByEndMarker = new Map<number, MutablePhaseAssociation>();
  const allMarkerIds = new Set(markerImport.rows.map(row => row.markerId));
  for (const interval of markerImport.phaseIntervals) {
    const startId = interval.startMarker.markerId;
    const endId = interval.endMarker.markerId;
    if (phaseByStartMarker.has(startId)) {
      return { status: 'rejected', errors: ['phase-start MKID is not unique: ' + startId], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
    }
    if (phaseByEndMarker.has(endId)) {
      return { status: 'rejected', errors: ['phase-end MKID is not unique: ' + endId], limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS };
    }
    const phase: MutablePhaseAssociation = {
      interval,
      associatedRowCount: 0,
      firstSourceRecordNumber: null,
      lastSourceRecordNumber: null,
      firstObservedTimeSclkRaw: null,
      lastObservedTimeSclkRaw: null,
      endMarkerContextRowCount: 0,
      fields: fieldSpecs.map(spec => ({
        spec,
        observedValueCount: 0,
        emptyValueCount: 0,
        nonNumericValueCount: 0,
        minObservedValue: null,
        maxObservedValue: null,
        firstObservedRawValue: null,
        lastObservedRawValue: null
      })),
      firstSamples: [],
      lastSamples: []
    };
    phaseByStartMarker.set(startId, phase);
    phaseByEndMarker.set(endId, phase);
  }

  const rowCountByMarkerId: Record<string, number> = {};
  const errors: string[] = [];
  let sourceRowCount = 0;
  let rejectedRowCount = 0;
  let blankMarkerIdRowCount = 0;
  let nonPhaseRowCount = 0;
  let unknownMarkerIdRowCount = 0;
  let matchedPhaseRowCount = 0;

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line.trim() === '') continue;
    const sourceRecordNumber = lineIndex + 1;
    const parsedRow = parseCsvLine(line);
    if (!parsedRow.values) {
      rejectedRowCount += 1;
      errors.push('record ' + sourceRecordNumber + ': ' + parsedRow.error);
      continue;
    }
    const values = parsedRow.values;
    if (values.length !== headers.length) {
      rejectedRowCount += 1;
      errors.push('record ' + sourceRecordNumber + ': expected ' + headers.length + ' fields, received ' + values.length);
      continue;
    }

    sourceRowCount += 1;
    const timeRaw = values[timeIndex].trim();
    if (finiteNumber(timeRaw) === null) {
      rejectedRowCount += 1;
      errors.push('record ' + sourceRecordNumber + ': TIME must be a finite SCLK value');
      continue;
    }
    const markerRaw = values[markerIndex].trim();
    if (markerRaw === '') {
      blankMarkerIdRowCount += 1;
      nonPhaseRowCount += 1;
      continue;
    }
    const markerNumber = Number(markerRaw);
    if (!Number.isInteger(markerNumber) || markerNumber < 0) {
      rejectedRowCount += 1;
      errors.push('record ' + sourceRecordNumber + ': MKID must be a non-negative integer or blank');
      continue;
    }
    const markerId = markerNumber;
    const markerKey = String(markerId);
    rowCountByMarkerId[markerKey] = (rowCountByMarkerId[markerKey] ?? 0) + 1;
    if (!allMarkerIds.has(markerId)) unknownMarkerIdRowCount += 1;

    const phase = phaseByStartMarker.get(markerId);
    if (!phase) {
      nonPhaseRowCount += 1;
      const endingPhase = phaseByEndMarker.get(markerId);
      if (endingPhase) endingPhase.endMarkerContextRowCount += 1;
      continue;
    }

    matchedPhaseRowCount += 1;
    phase.associatedRowCount += 1;
    phase.firstSourceRecordNumber ??= sourceRecordNumber;
    phase.lastSourceRecordNumber = sourceRecordNumber;
    phase.firstObservedTimeSclkRaw ??= timeRaw;
    phase.lastObservedTimeSclkRaw = timeRaw;

    for (let fieldIndex = 0; fieldIndex < fieldSpecs.length; fieldIndex += 1) {
      const stats = phase.fields[fieldIndex];
      const raw = values[fieldIndexes.get(stats.spec.name) ?? -1]?.trim() ?? '';
      if (raw === '') {
        stats.emptyValueCount += 1;
        continue;
      }
      const numeric = finiteNumber(raw);
      if (numeric === null) {
        stats.nonNumericValueCount += 1;
        continue;
      }
      stats.observedValueCount += 1;
      stats.minObservedValue = stats.minObservedValue === null ? numeric : Math.min(stats.minObservedValue, numeric);
      stats.maxObservedValue = stats.maxObservedValue === null ? numeric : Math.max(stats.maxObservedValue, numeric);
      stats.firstObservedRawValue ??= raw;
      stats.lastObservedRawValue = raw;
    }

    const sample = sampleFromRow(sourceRecordNumber, timeRaw, markerId, values, fieldIndexes, fieldSpecs);
    if (phase.firstSamples.length < 2) phase.firstSamples.push(sample);
    phase.lastSamples.push(sample);
    if (phase.lastSamples.length > 2) phase.lastSamples.shift();
  }

  if (errors.length > 0) {
    return {
      status: 'rejected',
      sourceRowCount,
      rejectedRowCount,
      errors: errors.slice(0, 100),
      limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS
    };
  }

  const phaseAssociations = markerImport.phaseIntervals.map(interval => {
    const phase = phaseByStartMarker.get(interval.startMarker.markerId);
    if (!phase) throw new Error('internal phase map inconsistency');
    return {
      phaseIndex: interval.phaseIndex,
      phaseStartMarkerId: interval.startMarker.markerId,
      phaseEndMarkerId: interval.endMarker.markerId,
      markerStartSclkSeconds: interval.startSclkSeconds,
      markerEndSclkSeconds: interval.endSclkSeconds,
      markerDurationSclkSeconds: interval.durationSclkSeconds,
      associationRule: 'HK_MKID_equals_phase_start_MKID' as const,
      associatedRowCount: phase.associatedRowCount,
      firstSourceRecordNumber: phase.firstSourceRecordNumber,
      lastSourceRecordNumber: phase.lastSourceRecordNumber,
      firstObservedTimeSclkRaw: phase.firstObservedTimeSclkRaw,
      lastObservedTimeSclkRaw: phase.lastObservedTimeSclkRaw,
      endMarkerContextRowCount: phase.endMarkerContextRowCount,
      fieldStatistics: phase.fields.map(stats => ({
        name: stats.spec.name,
        unit: stats.spec.unit,
        observedValueCount: stats.observedValueCount,
        emptyValueCount: stats.emptyValueCount,
        nonNumericValueCount: stats.nonNumericValueCount,
        minObservedValue: stats.minObservedValue,
        maxObservedValue: stats.maxObservedValue,
        firstObservedRawValue: stats.firstObservedRawValue,
        lastObservedRawValue: stats.lastObservedRawValue
      })),
      sampleRows: [...phase.firstSamples, ...phase.lastSamples.slice(phase.firstSamples.length === phase.lastSamples.length ? 0 : 0)]
        .filter((sample, index, list) => list.findIndex(item => item.sourceRecordNumber === sample.sourceRecordNumber) === index)
    };
  });

  return {
    status: 'completed',
    sourceRowCount,
    rejectedRowCount,
    blankMarkerIdRowCount,
    nonPhaseRowCount,
    unknownMarkerIdRowCount,
    rowCountByMarkerId,
    phaseAssociations,
    matchedPhaseRowCount,
    associationRule: 'HK_MKID_equals_phase_start_MKID',
    timeValuesUsedForAssociation: false,
    utcConversionPerformed: false,
    l1bCorrectedClockCorrelationPerformed: false,
    interpolationPerformed: false,
    carryForwardPerformed: false,
    eligibleAsSchedulerInitialAbundance: false,
    eligibleAsMarsPhotochemicalInitialState: false,
    limitations: MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS
  };
}
