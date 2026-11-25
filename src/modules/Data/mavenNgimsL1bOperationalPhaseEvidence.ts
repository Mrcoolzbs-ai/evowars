// MAVEN NGIMS L1B operational phase diagnostics.
// Exact marker-ID association only; no clock, calibration or density inference.
import type {MavenNgimsL1bHousekeepingPhaseAssociation as HkPhase, MavenNgimsL1bHousekeepingPhaseAssociationResult as HkResult, MavenNgimsL1bHousekeepingFieldStatistics as FieldStats} from './mavenNgimsL1bHousekeepingEvidence';

export const MAVEN_NGIMS_L1B_OPERATIONAL_FIELD_NAMES = [
  'CDH:OS_FIL1_VMON','CDH:OS_FIL2_VMON','CDH:OS_FIL_EMON','CDH:OS_FIL1_IMON','CDH:OS_FIL2_IMON',
  'CDH:CS_FIL1_VMON','CDH:CS_FIL2_VMON','CDH:CS_FIL_EMON','CDH:CS_FIL1_IMON','CDH:CS_FIL2_IMON',
  'CDH:EM1_IMON','CDH:EM2_IMON','CDH:MULTANA1','CDH:MULTANA2',
  'QMS:IP_COUNT','QMS:IP_SETUP','QMS:FIL_SELECT','QMS:RF_FREQ'
] as const;
export const MAVEN_NGIMS_L1B_OPERATIONAL_LIMITATIONS = [
  'cal-msg phase blocks are paired with cal-hk summaries by phase ordinal and exact cal-mkr start/end MKID; cal-msg timestamps are not used as clock coordinates.',
  'HK values are sparse readbacks. Empty cells mean not read; no threshold state, interpolation or carry-forward is inferred.',
  'Filament and multiplier monitor values remain raw telemetry; no detector gain, filament identity enum or calibration response is derived.',
  'QMS:FIL_SELECT is retained as a raw integer; no validated enum mapping is supplied by the consulted field definition.',
  'No validated correlation is implemented between cal-msg/HK internal clock, cal-mkr SCLK and L1B t_sclk_cor.',
  'Whole-event CSN/OSNB signal summaries are not paired by species, phase, altitude or time and are not a sensitivity ratio.',
  'Closed/open-source sensitivity, C_EN, fragmentation response and neutral density are not produced.',
  'Results are instrument-operational evidence only and are ineligible for Scheduler or Mars photochemical initial-state construction.'
] as const;

export interface MavenNgimsL1bCalMsgPhaseConfiguration {
  readonly phaseIndex:number; readonly configuredDurationSeconds:number; readonly integrationPeriodMilliseconds:number;
  readonly closedSourceScanType:string; readonly closedSourceVectorId:number; readonly openSourceMode:number;
  readonly openSourceScanType:string; readonly openSourceVectorId:number|null; readonly openSourceScanId:number|null;
  readonly pressureCheckPeriodSeconds:number;
}
export type MavenNgimsL1bCalMsgParseResult =
  | {readonly status:'parsed';readonly phaseConfigurations:readonly MavenNgimsL1bCalMsgPhaseConfiguration[];
     readonly runtimeStartMarkerIds:readonly number[];readonly runtimeEndMarkerIds:readonly number[];
     readonly runtimeDurationByPhase:Readonly<Record<string,number>>;readonly multiplierTwoEnableLogCount:number}
  | {readonly status:'rejected';readonly errors:readonly string[]};
export interface MavenNgimsL1bOperationalPhaseDiagnostic {
  readonly phaseIndex:number;readonly startMarkerId:number;readonly endMarkerId:number;
  readonly markerDurationSclkSeconds:number;readonly housekeepingRowCount:number;readonly endMarkerContextRowCount:number;
  readonly configuration:MavenNgimsL1bCalMsgPhaseConfiguration;readonly runtimeDurationSeconds:number|null;
  readonly readbacks:readonly FieldStats[];
  readonly qmsTiming:{readonly nominalIntegrationPeriodMilliseconds:number;readonly countPeriodSeconds:number|null;
    readonly setupPeriodSeconds:number|null;readonly sumMilliseconds:number|null;
    readonly sumMatchesNominalWithinPrecision:boolean|null;readonly filamentSelectRawCode:number|null;
    readonly rfFrequencyObserved:boolean};
}
export interface MavenNgimsL1bOperationalPhaseDiagnosticsResult {
  readonly status:'completed'|'rejected';readonly phaseCount?:number;
  readonly phaseDiagnostics?:readonly MavenNgimsL1bOperationalPhaseDiagnostic[];
  readonly multiplierTwoEnableLogCount?:number;
  readonly calibration:{readonly closedSourceSensitivity:'not_derived';readonly openSourceSensitivity:'not_derived';
    readonly energyCorrectionFactorCen:null;readonly cpsToDensityConversionPerformed:false};
  readonly clockPolicy:{readonly calMsgTimestampsUsedForAssociation:false;readonly timestampJoinPerformed:false;
    readonly l1bCorrectedClockCorrelationPerformed:false};
  readonly eligibleAsSchedulerInitialAbundance:false;readonly eligibleAsMarsPhotochemicalInitialState:false;
  readonly errors?:readonly string[];readonly limitations:readonly string[];
}

const stripClock=(s:string)=>s.replace(/^\s*\d+(?:\.\d+)?:\s*/,'').trim();
function numeric(lines:readonly string[],re:RegExp):number|null {
  for(const s of lines){const m=re.exec(s);if(m){const n=Number(m[1]);if(Number.isFinite(n))return n;}}return null;
}
function label(lines:readonly string[],re:RegExp,index:number):string|null {
  const m=re.exec(lines[index]);if(m?.[1]?.trim())return m[1].trim();
  for(let i=index+1;i<Math.min(lines.length,index+4);i++){const s=lines[i].trim();if(!s)continue;if(/^(Vector|Sequential)$/i.test(s))return s;break;}
  return null;
}
function parseBlock(i:number,lines:readonly string[]):MavenNgimsL1bCalMsgPhaseConfiguration|null {
  const duration=numeric(lines,/^Duration:\s*([\d.]+)/i),ip=numeric(lines,/^IP:\s*([\d.]+)/i);
  const csid=numeric(lines,/^CS Vector ID:\s*(\d+)/i),mode=numeric(lines,/^OS Scan\/\/ Mode:\s*(\d+)/i);
  const ov=numeric(lines,/^OS Vector ID:\s*(\d+)/i),os=numeric(lines,/^OS Scan ID:\s*(\d+)/i);
  const pressure=numeric(lines,/^Pressure Check Period:\s*([\d.]+)/i);
  const ci=lines.findIndex(x=>/^CS Scan\/\/ Type:/i.test(x)),oi=lines.findIndex(x=>/^OS Scan Type:/i.test(x));
  const cs=ci<0?null:label(lines,/^CS Scan\/\/ Type:\s*(.*)$/i,ci);
  const ot=oi<0?null:label(lines,/^OS Scan Type:\s*(.*)$/i,oi);
  if(duration===null||ip===null||csid===null||mode===null||pressure===null||!cs||!ot)return null;
  return {phaseIndex:i,configuredDurationSeconds:duration,integrationPeriodMilliseconds:ip,
    closedSourceScanType:cs,closedSourceVectorId:csid,openSourceMode:mode,openSourceScanType:ot,
    openSourceVectorId:ov,openSourceScanId:os,pressureCheckPeriodSeconds:pressure};
}
export function parseMavenNgimsL1bCalMsgPhaseConfiguration(text:string):MavenNgimsL1bCalMsgParseResult {
  if(typeof text!=='string'||!text.trim())return {status:'rejected',errors:['cal-msg text is empty']};
  const lines=text.split(/\r?\n/).map(stripClock),starts:Array<{phase:number;line:number}>=[];
  lines.forEach((s,i)=>{const m=/^Reading Phase\s+(\d+)$/i.exec(s);if(m)starts.push({phase:+m[1],line:i});});
  if(!starts.length)return {status:'rejected',errors:['no Reading Phase blocks found']};
  const configs:MavenNgimsL1bCalMsgPhaseConfiguration[]=[],errors:string[]=[];
  starts.forEach((s,i)=>{const build=lines.findIndex((x,j)=>j>s.line&&/^Building fast switch arrays\.?$/i.test(x));
    const end=starts[i+1]?.line??(build>=0?build:lines.length);
    if(s.phase!==i+1)errors.push('phase blocks must be sequential and one-based');
    const c=parseBlock(s.phase,lines.slice(s.line,end));if(!c)errors.push('phase '+s.phase+' has incomplete scan configuration');else configs.push(c);});
  const begin:number[]=[],finish:number[]=[],runtime:Record<string,number>={};
  for(const s of lines){const m=/^sys\.marker:\s*id=(\d+)\s*,\s*txt=(.*)$/i.exec(s);
    if(m){const d=m[2].trim().toLowerCase();if(d==='phase mass scans starting')begin.push(+m[1]);if(d==='phase ended.')finish.push(+m[1]);}
    const r=/^Phase\s+(\d+)\.\s+Duration:\s*([\d.]+)\s+sec\.?$/i.exec(s);if(r)runtime[r[1]]=+r[2];}
  const mult=lines.filter(x=>/\bMultiplier\s+2\s+On\s+@/i.test(x)).length;
  return errors.length?{status:'rejected',errors}:{status:'parsed',phaseConfigurations:configs,
    runtimeStartMarkerIds:begin,runtimeEndMarkerIds:finish,runtimeDurationByPhase:runtime,multiplierTwoEnableLogCount:mult};
}
const get=(p:HkPhase,n:string):FieldStats|null=>p.fieldStatistics.find(f=>f.name===n)??null;
function stable(f:FieldStats|null):number|null {
  return !f||!f.observedValueCount||f.minObservedValue===null||f.minObservedValue!==f.maxObservedValue?null:f.minObservedValue;
}
function base(status:'completed'|'rejected',errors?:readonly string[]):MavenNgimsL1bOperationalPhaseDiagnosticsResult {
  return {status,...(errors?{errors}:{}),calibration:{closedSourceSensitivity:'not_derived',openSourceSensitivity:'not_derived',
    energyCorrectionFactorCen:null,cpsToDensityConversionPerformed:false},
    clockPolicy:{calMsgTimestampsUsedForAssociation:false,timestampJoinPerformed:false,l1bCorrectedClockCorrelationPerformed:false},
    eligibleAsSchedulerInitialAbundance:false,eligibleAsMarsPhotochemicalInitialState:false,
    limitations:MAVEN_NGIMS_L1B_OPERATIONAL_LIMITATIONS};
}
export function buildMavenNgimsL1bOperationalPhaseDiagnostics(
  log:MavenNgimsL1bCalMsgParseResult,hk:HkResult
):MavenNgimsL1bOperationalPhaseDiagnosticsResult {
  if(log.status!=='parsed')return base('rejected',log.errors);
  if(hk.status!=='completed'||!hk.phaseAssociations)return base('rejected',['completed cal-hk marker association is required']);
  const phases=hk.phaseAssociations,cfg=log.phaseConfigurations,starts=log.runtimeStartMarkerIds,ends=log.runtimeEndMarkerIds;
  if(cfg.length!==phases.length||starts.length!==phases.length||ends.length!==phases.length)
    return base('rejected',['cal-msg configuration/runtime marker counts do not match HK phases']);
  const out:MavenNgimsL1bOperationalPhaseDiagnostic[]=[];
  for(let i=0;i<phases.length;i++){const p=phases[i],c=cfg[i];
    if(c.phaseIndex!==p.phaseIndex||starts[i]!==p.phaseStartMarkerId||ends[i]!==p.phaseEndMarkerId)
      return base('rejected',['phase '+p.phaseIndex+' ordinal or exact runtime MKID mismatch']);
    const count=stable(get(p,'QMS:IP_COUNT')),setup=stable(get(p,'QMS:IP_SETUP'));
    const sum=count===null||setup===null?null:(count+setup)*1000;
    out.push({phaseIndex:p.phaseIndex,startMarkerId:p.phaseStartMarkerId,endMarkerId:p.phaseEndMarkerId,
      markerDurationSclkSeconds:p.markerDurationSclkSeconds,housekeepingRowCount:p.associatedRowCount,
      endMarkerContextRowCount:p.endMarkerContextRowCount,configuration:c,
      runtimeDurationSeconds:log.runtimeDurationByPhase[String(p.phaseIndex)]??null,
      readbacks:MAVEN_NGIMS_L1B_OPERATIONAL_FIELD_NAMES.map(n=>get(p,n)??{
        name:n,unit:'unknown',observedValueCount:0,emptyValueCount:p.associatedRowCount,nonNumericValueCount:0,
        minObservedValue:null,maxObservedValue:null,firstObservedRawValue:null,lastObservedRawValue:null}),
      qmsTiming:{nominalIntegrationPeriodMilliseconds:c.integrationPeriodMilliseconds,countPeriodSeconds:count,
        setupPeriodSeconds:setup,sumMilliseconds:sum,
        sumMatchesNominalWithinPrecision:sum===null?null:Math.abs(sum-c.integrationPeriodMilliseconds)<=0.2,
        filamentSelectRawCode:stable(get(p,'QMS:FIL_SELECT')),
        rfFrequencyObserved:(get(p,'QMS:RF_FREQ')?.observedValueCount??0)>0}});
  }
  return {...base('completed'),phaseCount:out.length,phaseDiagnostics:out,
    multiplierTwoEnableLogCount:log.multiplierTwoEnableLogCount};
}
