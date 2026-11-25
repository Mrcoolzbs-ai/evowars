import {describe,expect,it} from 'vitest';
import {
  MAVEN_NGIMS_L1B_MARKER_LIMITATIONS,
  MAVEN_NGIMS_L1B_MARKER_PROVENANCE,
  parseMavenNgimsL1bMarkerCsvText
} from '../Data/mavenNgimsL1bMarkerEvidence';

type R=readonly [string,string,string];
function csv(rows:readonly R[]):string {
  const q=(v:string)=>v.includes(',')||v.includes('"')||v.includes('\n')?'"'+v.replace(/"/g,'""')+'"':v;
  return '\uFEFFTIME,MKID,DESCRIPTION\r\n'+rows.map(r=>r.map(q).join(',')).join('\r\n')+'\r\n';
}
const bounds:R[]=[
 ['471584738.8451434','1','TIDSTART sci_default_osnb $Rev: 612 $']
];
const phases=[
 [471589326.6889069,471589507.4794493],
 [471589507.68944985,471589513.59946764],
 [471589513.7494681,471589652.15988326],
 [471589652.30988383,471589658.2199015],
 [471589658.39990205,471589869.3105348],
 [471589869.4605352,471589875.37055296],
 [471589875.55055344,471590056.0410949],
 [471590056.1910955,471590078.77116317],
 [471590078.9511637,471590264.1317192],
 [471590264.2817197,471590270.2217375],
 [471590270.40173805,471590478.97236377],
 [471590479.1123641,471590485.052382],
 [471590485.23238254,471590621.2727906],
 [471590621.392791,471590627.33280885],
 [471590627.5128094,471590723.7730982]
] as const;

describe('MAVEN NGIMS L1B marker evidence',()=>{
 it('parses SCLK event bounds and one phase without clock conversion',()=>{
  const result=parseMavenNgimsL1bMarkerCsvText(csv([
   ...bounds,
   ['471589326.6889069','2001','Phase mass scans starting'],
   ['471589507.4794493','2002','Phase ended.'],
   ['471590735.5031334','10000','TIDSTOP sci_default_osnb $Rev: 612 $'],
   ['471590832.6934249','86000','qms_off.bas done']
  ]));
  expect(result.status).toBe('parsed'); if(result.status!=='parsed')return;
  expect(result.timeCoordinate).toBe('SCLK_seconds');
  expect(result.eventBounds.startSclkSeconds).toBe(471584738.8451434);
  expect(result.eventBounds.stopSclkSeconds).toBe(471590735.5031334);
  expect(result.phaseCount).toBe(1);
  expect(result.phaseIntervals[0].durationSclkSeconds).toBeCloseTo(180.7905424,6);
  expect(result.utcConversionPerformed).toBe(false);
  expect(result.l1bCorrectedClockCorrelationPerformed).toBe(false);
  expect(result.eligibleAsSchedulerInitialAbundance).toBe(false);
 });

 it('extracts the 15 start/end pairs present in the archived TID 14282 marker log',()=>{
  const rows:R[]=[...bounds];
  phases.forEach(([start,end],i)=>{
   rows.push([String(start),String(2001+i*102),'Phase mass scans starting']);
   rows.push([String(end),String(2002+i*102),'Phase ended.']);
  });
  rows.push(['471590735.5031334','10000','TIDSTOP sci_default_osnb $Rev: 612 $']);
  const result=parseMavenNgimsL1bMarkerCsvText(csv(rows));
  expect(result.status).toBe('parsed'); if(result.status!=='parsed')return;
  expect(result.phaseCount).toBe(15);
  expect(result.phaseIntervals[0].durationSclkSeconds).toBeCloseTo(180.7905424,6);
  expect(result.phaseIntervals[14].durationSclkSeconds).toBeCloseTo(96.2602888,6);
  expect(result.phaseIntervals.every(p=>p.durationSclkSeconds>0)).toBe(true);
 });

 it('preserves quoted descriptions containing commas',()=>{
  const result=parseMavenNgimsL1bMarkerCsvText(csv([
   ['10','1','TIDSTART cfg'],['11','2001','Phase mass scans starting'],
   ['12','77','OS Init 2, 2'],['13','2002','Phase ended.'],['14','10000','TIDSTOP cfg']
  ]));
  expect(result.status).toBe('parsed'); if(result.status!=='parsed')return;
  expect(result.rows[2].description).toBe('OS Init 2, 2');
 });

 it('rejects non-monotonic SCLK and invalid marker IDs',()=>{
  expect(parseMavenNgimsL1bMarkerCsvText(csv([
   ['10','1','TIDSTART cfg'],['9','2001','Phase mass scans starting'],
   ['12','2002','Phase ended.'],['13','10000','TIDSTOP cfg']
  ]))).toMatchObject({status:'invalid_csv'});
  expect(parseMavenNgimsL1bMarkerCsvText(csv([
   ['10','1.5','TIDSTART cfg'],['11','2001','Phase mass scans starting'],
   ['12','2002','Phase ended.'],['13','10000','TIDSTOP cfg']
  ]))).toMatchObject({status:'invalid_csv'});
 });

 it('rejects orphan, nested and unmatched phase markers',()=>{
  expect(parseMavenNgimsL1bMarkerCsvText(csv([
   ['10','1','TIDSTART cfg'],['11','2002','Phase ended.'],['13','10000','TIDSTOP cfg']
  ]))).toMatchObject({status:'invalid_event'});
  expect(parseMavenNgimsL1bMarkerCsvText(csv([
   ['10','1','TIDSTART cfg'],['11','2001','Phase mass scans starting'],
   ['12','2103','Phase mass scans starting'],['13','2002','Phase ended.'],
   ['14','10000','TIDSTOP cfg']
  ]))).toMatchObject({status:'invalid_event'});
  expect(parseMavenNgimsL1bMarkerCsvText(csv([
   ['10','1','TIDSTART cfg'],['11','2001','Phase mass scans starting'],
   ['14','10000','TIDSTOP cfg']
  ]))).toMatchObject({status:'invalid_event'});
 });

 it('requires exact headers and one TIDSTART/TIDSTOP pair',()=>{
  expect(parseMavenNgimsL1bMarkerCsvText('TIME,MKID,OTHER\n1,2,x'))
   .toMatchObject({status:'invalid_csv'});
  expect(parseMavenNgimsL1bMarkerCsvText(csv([
   ['10','1','TIDSTART cfg'],['11','2001','Phase mass scans starting'],
   ['12','2002','Phase ended.']
  ]))).toMatchObject({status:'invalid_event'});
 });

 it('keeps marker evidence outside all scientific initial-state paths',()=>{
  expect(MAVEN_NGIMS_L1B_MARKER_PROVENANCE.utcConversionPerformed).toBe(false);
  expect(MAVEN_NGIMS_L1B_MARKER_PROVENANCE.l1bCorrectedClockCorrelationPerformed).toBe(false);
  expect(MAVEN_NGIMS_L1B_MARKER_PROVENANCE.eligibleAsSchedulerInitialAbundance).toBe(false);
  expect(MAVEN_NGIMS_L1B_MARKER_LIMITATIONS.length).toBeGreaterThan(0);
 });
});
