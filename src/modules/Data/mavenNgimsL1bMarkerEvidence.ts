// MAVEN NGIMS L1B cal-mkr evidence. TIME remains in source SCLK seconds.
// No UTC conversion, L1B t_sclk_cor correlation, interpolation, or density inference.

export const MAVEN_NGIMS_L1B_MARKER_PROVENANCE = {
  productKind: 'instrument_marker_log',
  sourceFile: 'mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v01_r02.csv',
  productId: 'urn:nasa:pds:maven_ngims:l1b:mvn_ngi_l1b_cal-mkr-014282_20141211t154406',
  tid: 14282,
  orbit: 391,
  timeField: 'TIME',
  timeUnit: 'SECONDS',
  timeCoordinate: 'NGIMS_SCLK_seconds',
  utcConversionPerformed: false,
  l1bCorrectedClockCorrelationPerformed: false,
  eligibleAsSchedulerInitialAbundance: false,
  eligibleAsMarsPhotochemicalInitialState: false
} as const;

export const MAVEN_NGIMS_L1B_MARKER_LIMITATIONS = [
  'TIME is preserved as source SCLK seconds; it is not converted to UTC.',
  'HK TIME is described as an NGIMS-internal-clock approximation; exact equivalence to L1B t_sclk_cor is not established.',
  'Phase intervals are instrument-protocol event windows, not calibrated mass-channel exposure intervals.',
  'No interpolation, nearest-neighbour join, or co-registration with L1B signal rows is performed.',
  'Markers do not provide species identity, abundance, sensitivity, fragmentation response, or C_EN.',
  'Marker evidence is ineligible for Scheduler and Mars photochemical initialization.'
] as const;

export interface MavenNgimsL1bMarkerRecord {
  readonly recordNumber: number;
  /** Source TIME value in SCLK seconds, not UTC. */
  readonly sclkSeconds: number;
  readonly markerId: number;
  readonly description: string;
}

export interface MavenNgimsL1bPhaseInterval {
  readonly phaseIndex: number;
  readonly startMarker: MavenNgimsL1bMarkerRecord;
  readonly endMarker: MavenNgimsL1bMarkerRecord;
  readonly startSclkSeconds: number;
  readonly endSclkSeconds: number;
  readonly durationSclkSeconds: number;
  readonly timeCoordinate: 'SCLK_seconds';
}

export interface MavenNgimsL1bMarkerEventBounds {
  readonly tidStartMarker: MavenNgimsL1bMarkerRecord;
  readonly tidStopMarker: MavenNgimsL1bMarkerRecord;
  readonly startSclkSeconds: number;
  readonly stopSclkSeconds: number;
}

export type MavenNgimsL1bMarkerCsvImportResult =
  | {
      readonly status: 'parsed';
      readonly headers: readonly ['TIME','MKID','DESCRIPTION'];
      readonly rows: readonly MavenNgimsL1bMarkerRecord[];
      readonly eventBounds: MavenNgimsL1bMarkerEventBounds;
      readonly phaseIntervals: readonly MavenNgimsL1bPhaseInterval[];
      readonly rowCount: number;
      readonly phaseCount: number;
      readonly timeCoordinate: 'SCLK_seconds';
      readonly utcConversionPerformed: false;
      readonly l1bCorrectedClockCorrelationPerformed: false;
      readonly eligibleAsSchedulerInitialAbundance: false;
      readonly eligibleAsMarsPhotochemicalInitialState: false;
      readonly limitations: readonly string[];
    }
  | { readonly status: 'invalid_csv'|'invalid_event'; readonly errors: readonly string[] };

function parseCsv(input: string): { rows?: string[][]; error?: string } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i=0;i<text.length;i+=1) {
    const ch=text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i+1] === '"') { cell+='"'; i+=1; } else quoted=false;
      } else cell+=ch;
    } else if (ch === '"' && cell.length===0) quoted=true;
    else if (ch === ',') { row.push(cell); cell=''; }
    else if (ch === '\n' || ch === '\r') {
      row.push(cell); if (row.some(x=>x.length>0)) rows.push(row);
      row=[]; cell=''; if (ch==='\r' && text[i+1]==='\n') i+=1;
    } else if (ch === '"') return {error:'unexpected quote outside quoted CSV field at character '+i};
    else cell+=ch;
  }
  if (quoted) return {error:'unterminated quoted CSV field'};
  if (cell.length>0 || row.length>0) { row.push(cell); if (row.some(x=>x.length>0)) rows.push(row); }
  return {rows};
}

function deriveEvent(rows: readonly MavenNgimsL1bMarkerRecord[]) {
  const errors: string[]=[];
  const starts=rows.filter(r=>/^TIDSTART(?:\s|$)/i.test(r.description.trim()));
  const stops=rows.filter(r=>/^TIDSTOP(?:\s|$)/i.test(r.description.trim()));
  if (starts.length!==1) errors.push('expected exactly one TIDSTART marker; found '+starts.length);
  if (stops.length!==1) errors.push('expected exactly one TIDSTOP marker; found '+stops.length);
  if (errors.length) return {errors};
  const tidStart=starts[0], tidStop=stops[0];
  if (tidStop.sclkSeconds<=tidStart.sclkSeconds) return {errors:['TIDSTOP must occur after TIDSTART']};

  const phaseIntervals: MavenNgimsL1bPhaseInterval[]=[];
  let openStart: MavenNgimsL1bMarkerRecord|null=null;
  for (const row of rows) {
    const description=row.description.trim();
    if (/^Phase mass scans starting$/i.test(description)) {
      if (openStart) { errors.push('nested phase start at record '+row.recordNumber); continue; }
      openStart=row; continue;
    }
    if (/^Phase ended\.?$/i.test(description)) {
      if (!openStart) { errors.push('phase end without start at record '+row.recordNumber); continue; }
      if (row.sclkSeconds<=openStart.sclkSeconds) {
        errors.push('phase end must follow its start at record '+row.recordNumber);
        openStart=null; continue;
      }
      phaseIntervals.push({
        phaseIndex:phaseIntervals.length+1,startMarker:openStart,endMarker:row,
        startSclkSeconds:openStart.sclkSeconds,endSclkSeconds:row.sclkSeconds,
        durationSclkSeconds:row.sclkSeconds-openStart.sclkSeconds,timeCoordinate:'SCLK_seconds'
      });
      openStart=null;
    }
  }
  if (openStart) errors.push('phase start at record '+openStart.recordNumber+' has no matching end');
  if (!phaseIntervals.length) errors.push('no complete mass-scan phase intervals found');
  for (const p of phaseIntervals) {
    if (p.startSclkSeconds<tidStart.sclkSeconds || p.endSclkSeconds>tidStop.sclkSeconds)
      errors.push('phase '+p.phaseIndex+' lies outside TIDSTART/TIDSTOP');
  }
  if (errors.length) return {errors};
  return {
    errors,
    eventBounds:{tidStartMarker:tidStart,tidStopMarker:tidStop,
      startSclkSeconds:tidStart.sclkSeconds,stopSclkSeconds:tidStop.sclkSeconds},
    phaseIntervals
  };
}

/** Parse the PDS cal-mkr TIME,MKID,DESCRIPTION CSV and pair phase start/end markers. */
export function parseMavenNgimsL1bMarkerCsvText(csvText: string): MavenNgimsL1bMarkerCsvImportResult {
  if (typeof csvText!=='string' || csvText.trim()==='')
    return {status:'invalid_csv',errors:['CSV text is empty']};
  const parsed=parseCsv(csvText);
  if (!parsed.rows?.length) return {status:'invalid_csv',errors:[parsed.error??'CSV has no rows']};
  const headers=parsed.rows[0].map(x=>x.trim().toUpperCase());
  const expected=['TIME','MKID','DESCRIPTION'] as const;
  if (headers.length!==3 || headers.some((x,i)=>x!==expected[i]))
    return {status:'invalid_csv',errors:['headers must be exactly TIME,MKID,DESCRIPTION']};

  const rows:MavenNgimsL1bMarkerRecord[]=[];
  const errors:string[]=[];
  for (let i=1;i<parsed.rows.length;i+=1) {
    const values=parsed.rows[i], recordNumber=i+1;
    if (values.length!==3) { errors.push('record '+recordNumber+' must have exactly 3 fields'); continue; }
    const timeRaw=values[0].trim(), idRaw=values[1].trim();
    const time=Number(timeRaw), markerId=Number(idRaw);
    if (!timeRaw || !Number.isFinite(time) || time<0) { errors.push('invalid TIME at record '+recordNumber); continue; }
    if (!idRaw || !Number.isInteger(markerId) || markerId<0) { errors.push('invalid MKID at record '+recordNumber); continue; }
    if (rows.length && time<rows[rows.length-1].sclkSeconds) {
      errors.push('TIME decreases at record '+recordNumber); continue;
    }
    rows.push({recordNumber,sclkSeconds:time,markerId,description:values[2]});
  }
  if (errors.length) return {status:'invalid_csv',errors};
  const event=deriveEvent(rows);
  if (event.errors.length || !event.eventBounds || !event.phaseIntervals)
    return {status:'invalid_event',errors:event.errors};
  return {
    status:'parsed',headers:expected,rows,eventBounds:event.eventBounds,
    phaseIntervals:event.phaseIntervals,rowCount:rows.length,phaseCount:event.phaseIntervals.length,
    timeCoordinate:'SCLK_seconds',utcConversionPerformed:false,
    l1bCorrectedClockCorrelationPerformed:false,eligibleAsSchedulerInitialAbundance:false,
    eligibleAsMarsPhotochemicalInitialState:false,limitations:MAVEN_NGIMS_L1B_MARKER_LIMITATIONS
  };
}
