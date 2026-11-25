import {describe,expect,it} from 'vitest';
import {associateMavenNgimsL1bHousekeepingRowsByPhase} from '../Data/mavenNgimsL1bHousekeepingEvidence';
import {parseMavenNgimsL1bMarkerCsvText} from '../Data/mavenNgimsL1bMarkerEvidence';
import {buildMavenNgimsL1bOperationalPhaseDiagnostics,parseMavenNgimsL1bCalMsgPhaseConfiguration} from '../Data/mavenNgimsL1bOperationalPhaseEvidence';

const markerCsv=[
 'TIME,MKID,DESCRIPTION','10,1,TIDSTART sci_default_osnb','20,2001,Phase mass scans starting',
 '30,2002,Phase ended.','40,2103,Phase mass scans starting','50,2104,Phase ended.',
 '60,10000,TIDSTOP sci_default_osnb'
].join('\n');
const hkCsv=[
 'TIME,MKID,CDH:OS_FIL_EMON,CDH:CS_FIL_EMON,QMS:IP_COUNT,QMS:IP_SETUP,QMS:FIL_SELECT,QMS:RF_FREQ',
 '100,2001,-249.5,-249.6,0.027,0.0029,2,','101,2002,-249.5,-249.6,,,,',
 '102,2103,-249.4,-249.6,,,,','103,2104,-249.5,-249.6,,,,'
].join('\n');
const fields=[
 {name:'CDH:OS_FIL_EMON',unit:'Microamperes'},{name:'CDH:CS_FIL_EMON',unit:'Microamperes'},
 {name:'QMS:IP_COUNT',unit:'seconds'},{name:'QMS:IP_SETUP',unit:'seconds'},
 {name:'QMS:FIL_SELECT',unit:'unitless'},{name:'QMS:RF_FREQ',unit:'Megahertz'}
] as const;
function housekeeping(){
 const markers=parseMavenNgimsL1bMarkerCsvText(markerCsv);
 return associateMavenNgimsL1bHousekeepingRowsByPhase(hkCsv,markers,{fields,expectedColumnCount:8});
}
const log=[
 '100: Reading Phase 1','101: [_PHASE 1_]','102: Start Time: 0.','103: Duration: 10','104: IP: 30',
 '105: CS Scan// Type: Vector','106:  CS Vector ID: 1','107: OS Scan// Mode: 2',
 '108:  OS Scan Type: Vector','109:  OS Vector ID: 2','110: Pressure Check Period: 30',
 '111: Reading Phase 2','112: [_PHASE 2_]','113: Start Time: 0.','114: Duration: 5','115: IP: 30',
 '116: CS Scan// Type:','Vector','Vector','117:  CS Vector ID: 3','118: OS Scan// Mode: 2',
 '119:  OS Scan Type: Sequential','120:  OS Scan ID: 4','121: Pressure Check Period: 30',
 '122: Building fast switch arrays.','130: sys.marker: id=2001, txt=Phase mass scans starting',
 '131: sys.marker: id=2002, txt=Phase ended.','132: sys.marker: id=2103, txt=Phase mass scans starting',
 '133: sys.marker: id=2104, txt=Phase ended.','134: Phase 1. Duration: 10 sec.',
 '135: Phase 2. Duration: 5 sec.','136: Multiplier 2 On @ 2462'
].join('\n');

describe('MAVEN NGIMS operational phase diagnostics',()=>{
 it('parses the alternating long-vector and short-sequential configurations',()=>{
  const parsed=parseMavenNgimsL1bCalMsgPhaseConfiguration(log);
  expect(parsed.status).toBe('parsed');if(parsed.status!=='parsed')return;
  expect(parsed.phaseConfigurations).toHaveLength(2);
  expect(parsed.phaseConfigurations[0]).toMatchObject({closedSourceScanType:'Vector',closedSourceVectorId:1,openSourceScanType:'Vector',openSourceVectorId:2});
  expect(parsed.phaseConfigurations[1]).toMatchObject({closedSourceScanType:'Vector',closedSourceVectorId:3,openSourceScanType:'Sequential',openSourceScanId:4});
  expect(parsed.multiplierTwoEnableLogCount).toBe(1);
 });
 it('matches exact MKIDs and preserves sparse readbacks without carry-forward',()=>{
  const result=buildMavenNgimsL1bOperationalPhaseDiagnostics(parseMavenNgimsL1bCalMsgPhaseConfiguration(log),housekeeping());
  expect(result.status).toBe('completed');if(result.status!=='completed')return;
  expect(result.phaseCount).toBe(2);
  expect(result.phaseDiagnostics?.[0]).toMatchObject({startMarkerId:2001,endMarkerId:2002,housekeepingRowCount:1,
   qmsTiming:{countPeriodSeconds:0.027,setupPeriodSeconds:0.0029,sumMilliseconds:29.9,sumMatchesNominalWithinPrecision:true,filamentSelectRawCode:2,rfFrequencyObserved:false}});
  expect(result.phaseDiagnostics?.[1].qmsTiming.countPeriodSeconds).toBeNull();
  expect(result.clockPolicy.timestampJoinPerformed).toBe(false);
  expect(result.calibration.energyCorrectionFactorCen).toBeNull();
  expect(result.eligibleAsMarsPhotochemicalInitialState).toBe(false);
 });
 it('rejects a runtime marker ID that differs from the cal-mkr/HK phase identity',()=>{
  const altered=log.replace('id=2103','id=9999');
  const result=buildMavenNgimsL1bOperationalPhaseDiagnostics(parseMavenNgimsL1bCalMsgPhaseConfiguration(altered),housekeeping());
  expect(result.status).toBe('rejected');
 });
 it('does not use timestamp prefixes from cal-msg as join coordinates',()=>{
  const shifted=log.replace(/^\d+: /gm,'999999999: ');
  const result=parseMavenNgimsL1bCalMsgPhaseConfiguration(shifted);
  expect(result.status).toBe('parsed');
  if(result.status==='parsed')expect(result.runtimeStartMarkerIds).toEqual([2001,2103]);
 });
 it('rejects incomplete configuration instead of inventing defaults',()=>{
  expect(parseMavenNgimsL1bCalMsgPhaseConfiguration('1: Reading Phase 1\n2: Duration: 10\n3: Building fast switch arrays.').status).toBe('rejected');
 });
});
