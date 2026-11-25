#!/usr/bin/env python3
"""Reproducible operational-only phase profile for MAVEN NGIMS TID 14282."""
from __future__ import annotations
import hashlib,json,re,sys
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[2]
HK_DIR=ROOT/'src/modules/Data/mavenNgimsL1bHousekeepingArchive'
MSG=HK_DIR/'mvn_ngi_l1b_cal-msg-014282_20141211T154406_v01_r02.txt'
MKR=HK_DIR/'mvn_ngi_l1b_cal-mkr-014282_20141211T154406_v01_r02.csv'
HK_MANIFEST=HK_DIR/'manifest.json'
PHASES=HK_DIR/'phase-associations.json'
L1B_MANIFEST=ROOT/'src/modules/Data/mavenNgimsL1bArchive/l1b-osnb-tid-14282-manifest.json'
OUT=HK_DIR/'operational-phase-diagnostics.json'
FIELDS=[
 'CDH:OS_FIL1_VMON','CDH:OS_FIL2_VMON','CDH:OS_FIL_EMON','CDH:OS_FIL1_IMON','CDH:OS_FIL2_IMON',
 'CDH:CS_FIL1_VMON','CDH:CS_FIL2_VMON','CDH:CS_FIL_EMON','CDH:CS_FIL1_IMON','CDH:CS_FIL2_IMON',
 'CDH:EM1_IMON','CDH:EM2_IMON','CDH:MULTANA1','CDH:MULTANA2',
 'QMS:IP_COUNT','QMS:IP_SETUP','QMS:FIL_SELECT','QMS:RF_FREQ','QMS:MT_MU1_VCTL','QMS:MT_MU2_VCTL'
]
def sha(path:Path)->str:
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def normalize(line:str)->str:return re.sub(r'^\s*\d+(?:\.\d+)?:\s*','',line).strip()
def numeric(lines:list[str],pattern:str)->float|None:
 for line in lines:
  m=re.search(pattern,line,re.I)
  if m:return float(m.group(1))
 return None
def label(lines:list[str],pattern:str,index:int)->str|None:
 m=re.search(pattern,lines[index],re.I)
 if m and m.group(1).strip():return m.group(1).strip()
 for candidate in lines[index+1:index+4]:
  candidate=candidate.strip()
  if not candidate:continue
  return candidate if candidate.lower() in ('vector','sequential') else None
 return None
def parse_message(text:str)->dict[str,Any]:
 lines=[normalize(x) for x in text.splitlines()]
 starts=[]
 for i,line in enumerate(lines):
  m=re.fullmatch(r'Reading Phase\s+(\d+)',line,re.I)
  if m:starts.append((int(m.group(1)),i))
 if not starts:raise ValueError('No Reading Phase config blocks')
 configs=[]
 for ordinal,(phase,start) in enumerate(starts):
  build=next((i for i,x in enumerate(lines) if i>start and re.fullmatch(r'Building fast switch arrays\.?',x,re.I)),len(lines))
  end=starts[ordinal+1][1] if ordinal+1<len(starts) else build
  block=lines[start:end]
  ci=next((i for i,x in enumerate(block) if re.match(r'CS Scan// Type:',x,re.I)),None)
  oi=next((i for i,x in enumerate(block) if re.match(r'OS Scan Type:',x,re.I)),None)
  if phase!=ordinal+1 or ci is None or oi is None:raise ValueError(f'Phase {phase}: malformed config block')
  cfg={'phaseIndex':phase,'configuredDurationSeconds':numeric(block,r'^Duration:\s*([\d.]+)'),
   'integrationPeriodMilliseconds':numeric(block,r'^IP:\s*([\d.]+)'),
   'closedSourceScanType':label(block,r'^CS Scan// Type:\s*(.*)$',ci),
   'closedSourceVectorId':numeric(block,r'^CS Vector ID:\s*(\d+)'),
   'openSourceMode':numeric(block,r'^OS Scan// Mode:\s*(\d+)'),
   'openSourceScanType':label(block,r'^OS Scan Type:\s*(.*)$',oi),
   'openSourceVectorId':numeric(block,r'^OS Vector ID:\s*(\d+)'),
   'openSourceScanId':numeric(block,r'^OS Scan ID:\s*(\d+)'),
   'pressureCheckPeriodSeconds':numeric(block,r'^Pressure Check Period:\s*([\d.]+)')}
  required=('configuredDurationSeconds','integrationPeriodMilliseconds','closedSourceScanType','closedSourceVectorId','openSourceMode','openSourceScanType','pressureCheckPeriodSeconds')
  if any(cfg[k] is None for k in required):raise ValueError(f'Phase {phase}: missing required configuration field')
  configs.append(cfg)
 begin=[];finish=[];runtime={}
 for line in lines:
  m=re.match(r'^sys\.marker:\s*id=(\d+)\s*,\s*txt=(.*)$',line,re.I)
  if m:
   desc=m.group(2).strip().lower()
   if desc=='phase mass scans starting':begin.append(int(m.group(1)))
   if desc=='phase ended.':finish.append(int(m.group(1)))
  d=re.match(r'^Phase\s+(\d+)\.\s+Duration:\s*([\d.]+)\s+sec\.?$',line,re.I)
  if d:runtime[d.group(1)]=float(d.group(2))
 mult=sum(bool(re.search(r'\bMultiplier\s+2\s+On\s+@',x,re.I)) for x in lines)
 if len(begin)!=len(configs) or len(finish)!=len(configs):raise ValueError('Runtime marker count mismatch')
 return {'configurations':configs,'runtimeStartMarkerIds':begin,'runtimeEndMarkerIds':finish,
  'runtimeDurationByPhase':runtime,'multiplierTwoEnableLogCount':mult}
def field(phase:dict[str,Any],name:str)->dict[str,Any]:
 return next((f for f in phase['fieldStatistics'] if f['name']==name),{
  'name':name,'unit':'unknown','observedValueCount':0,'emptyValueCount':phase['associatedHousekeepingRowCount'],
  'nonNumericValueCount':0,'minObservedValue':None,'maxObservedValue':None,'firstObservedRawValue':None,'lastObservedRawValue':None})
def stable_value(f:dict[str,Any])->float|None:
 if f['observedValueCount'] and f['minObservedValue'] is not None and f['minObservedValue']==f['maxObservedValue']:return float(f['minObservedValue'])
 return None
def self_test()->None:
 sample='''100: Reading Phase 1
101: Duration: 181
102: IP: 30
103: CS Scan// Type: Vector
104: CS Vector ID: 1
105: OS Scan// Mode: 2
106: OS Scan Type: Vector
107: OS Vector ID: 2
108: Pressure Check Period: 30
109: Reading Phase 2
110: Duration: 5
111: IP: 30
112: CS Scan// Type:
Vector
Vector
113: CS Vector ID: 3
114: OS Scan// Mode: 2
115: OS Scan Type: Sequential
116: OS Scan ID: 4
117: Pressure Check Period: 30
118: Building fast switch arrays.
119: sys.marker: id=2001, txt=Phase mass scans starting
120: sys.marker: id=2002, txt=Phase ended.
121: sys.marker: id=2103, txt=Phase mass scans starting
122: sys.marker: id=2104, txt=Phase ended.
123: Multiplier 2 On @ 2462'''
 parsed=parse_message(sample)
 assert len(parsed['configurations'])==2 and parsed['configurations'][1]['openSourceScanType']=='Sequential'
 assert parsed['runtimeStartMarkerIds']==[2001,2103] and parsed['runtimeEndMarkerIds']==[2002,2104]
 assert parsed['multiplierTwoEnableLogCount']==1
def analyse()->dict[str,Any]:
 for p in (MSG,MKR,HK_MANIFEST,PHASES,L1B_MANIFEST):
  if not p.is_file():raise FileNotFoundError(p)
 manifest=json.loads(HK_MANIFEST.read_text());phase_doc=json.loads(PHASES.read_text());l1b=json.loads(L1B_MANIFEST.read_text())
 products=manifest['products']
 for key,path in (('cal-msg',MSG),('cal-mkr',MKR)):
  if sha(path)!=products[key]['payload']['sha256']:raise ValueError(f'{key} SHA-256 mismatch')
 if phase_doc.get('status')!='phase_mkid_association_complete':raise ValueError('HK phase index is not complete')
 msg=parse_message(MSG.read_text(encoding='utf-8'));phases=phase_doc['phaseAssociations']
 if len(phases)!=15 or len(msg['configurations'])!=15:raise ValueError('Expected 15 phases')
 rows=[]
 for i,(cfg,hk) in enumerate(zip(msg['configurations'],phases)):
  if cfg['phaseIndex']!=hk['phaseIndex']:raise ValueError('phase ordinal mismatch')
  if msg['runtimeStartMarkerIds'][i]!=hk['startMarkerId'] or msg['runtimeEndMarkerIds'][i]!=hk['endMarkerId']:
   raise ValueError(f'Phase {i+1}: runtime MKID mismatch')
  selected={n:field(hk,n) for n in FIELDS}
  count=stable_value(selected['QMS:IP_COUNT']);setup=stable_value(selected['QMS:IP_SETUP'])
  total=(count+setup)*1000 if count is not None and setup is not None else None
  rows.append({'phaseIndex':hk['phaseIndex'],'startMarkerId':hk['startMarkerId'],'endMarkerId':hk['endMarkerId'],
   'markerDurationSclkSeconds':hk['markerDurationSclkSeconds'],'housekeepingRowCount':hk['associatedHousekeepingRowCount'],
   'endMarkerContextRowCount':hk['endMarkerContextRowCount'],'configuration':cfg,
   'runtimeDurationSeconds':msg['runtimeDurationByPhase'].get(str(hk['phaseIndex'])),
   'readbacks':list(selected.values()),
   'qmsTiming':{'countPeriodSeconds':count,'setupPeriodSeconds':setup,'sumMilliseconds':total,
    'sumMatchesNominalWithinPrecision':abs(total-cfg['integrationPeriodMilliseconds'])<=.2 if total is not None else None,
    'filamentSelectRawCode':stable_value(selected['QMS:FIL_SELECT']),
    'rfFrequencyObserved':selected['QMS:RF_FREQ']['observedValueCount']>0}})
 def aggregate(name:str)->dict[str,Any]:
  x=[field(p,name) for p in phases];observed=[v for v in (a['minObservedValue'] for a in x) if v is not None]
  maxima=[v for v in (a['maxObservedValue'] for a in x) if v is not None]
  return {'observedValueCount':sum(a['observedValueCount'] for a in x),
   'emptyValueCount':sum(a['emptyValueCount'] for a in x),'nonNumericValueCount':sum(a['nonNumericValueCount'] for a in x),
   'minObservedValue':min(observed,default=None),'maxObservedValue':max(maxima,default=None),
   'unit':next((a['unit'] for a in x if a['unit']!='unknown'),'unknown')}
 os_e=aggregate('CDH:OS_FIL_EMON');cs_e=aggregate('CDH:CS_FIL_EMON')
 def abs_range(x:dict[str,Any])->dict[str,float]|None:
  if x['minObservedValue'] is None:return None
  a,b=abs(x['minObservedValue']),abs(x['maxObservedValue'])
  return {'min':min(a,b),'max':max(a,b)}
 signal={};modes=l1b['productManifest']['csv']['focusModeDetails']
 for mode in ('csn','osnb'):
  stat=modes[mode].get('massChannelSignalStatistics',{}).get('40',{}).get('cps_dt_bkgd')
  if stat:signal[mode]={'massToChargeChannel':'40 (species not assigned)','rowCount':stat['n'],
   'backgroundSubtractedDeadTimeCorrectedCps':{k:stat[k] for k in ('mean','median','q05','q95','min','max')}}
 return {
  'schemaVersion':'1.0.0','status':'operational_profile_complete_calibration_not_established','event':manifest['event'],
  'phaseAssociation':{'method':'phase ordinal plus exact cal-msg runtime MKID equals cal-mkr/HK phase marker IDs',
   'phaseCount':len(rows),'calMsgTimestampUsedForAssociation':False,'hkTimeUsedForAssociation':False,
   'l1bTSclkCorCorrelationPerformed':False,'interpolationOrCarryForwardPerformed':False},
  'sourceProducts':{'calMsg':{'fileName':products['cal-msg']['payload']['fileName'],'sha256':sha(MSG)},
   'calMkr':{'fileName':products['cal-mkr']['payload']['fileName'],'sha256':sha(MKR)},
   'calHk':{'fileName':products['cal-hk']['payload']['fileName'],'sha256':products['cal-hk']['payload']['sha256']},
   'phaseAssociationArtifact':'phase-associations.json','l1bSignalSummaryArtifact':'../mavenNgimsL1bArchive/l1b-osnb-tid-14282-manifest.json'},
  'runLogSummary':{'multiplierTwoEnableLogCount':msg['multiplierTwoEnableLogCount'],
   'runtimePhaseStartMarkerIds':msg['runtimeStartMarkerIds'],'runtimePhaseEndMarkerIds':msg['runtimeEndMarkerIds']},
  'telemetrySummary':{'OS_emission_monitor':{**os_e,'absoluteMagnitudeMicroamperes':abs_range(os_e)},
   'CS_emission_monitor':{**cs_e,'absoluteMagnitudeMicroamperes':abs_range(cs_e)},
   'EM1_current_monitor':aggregate('CDH:EM1_IMON'),'EM2_current_monitor':aggregate('CDH:EM2_IMON'),
   'MULTANA1_monitor':aggregate('CDH:MULTANA1'),'MULTANA2_monitor':aggregate('CDH:MULTANA2'),
   'QMS_IP_COUNT':aggregate('QMS:IP_COUNT'),'QMS_IP_SETUP':aggregate('QMS:IP_SETUP'),
   'QMS_FIL_SELECT':aggregate('QMS:FIL_SELECT'),'QMS_RF_FREQ':aggregate('QMS:RF_FREQ'),
   'QMS_MT_MU1_VCTL':aggregate('QMS:MT_MU1_VCTL'),'QMS_MT_MU2_VCTL':aggregate('QMS:MT_MU2_VCTL')},
  'eventWideL1bSignalContext_notSensitivity':{'description':'CSN/OSNB m/z 40 channel summaries; no species identity or phase/time/altitude match is asserted.',
   'modes':signal,'ratioOrSensitivityDerived':False},
  'calibrationAssessment':{'closedSourceAbsoluteSensitivity':'not_derived','openSourceSensitivity':'not_derived','C_EN':None,
   'numericalCenValueFoundInEventCalHkMkrMsgOrCitedSISPaper':False,
   'closedSourceMethod':'S_a = S_n × C_RF(m_s) × σ_s; event-specific reference-gas calibration is required.',
   'openSourceMethod':'O_a = [S_a(m_ref) × n_c(m_ref) / n_o(m_ref)] × C_EN(m_s).',
   'requiredEvidence':['in-flight reference-species calibration and applicable closed-source sensitivity',
    'same reference species measured in CS and OS with dead-time-corrected count rates',
    'validated energy correction C_EN for selected mass/energy range',
    'applicable fragmentation/response matrix and background treatment'],
   'preflightTableNotSubstitutedForFlightCalibration':True},
  'scientificUse':{'instrumentOperationalContextOnly':True,'speciesIdentityAssigned':False,'neutralNumberDensityProduced':False,
   'cpsToDensityConversionPerformed':False,'eligibleAsSchedulerInitialAbundance':False,'eligibleAsMarsPhotochemicalInitialState':False},
  'limitations':['Telemetry observations are sparse; empty cells remain unobserved, not zero or off.',
   'Emission monitor sign and units are preserved; absolute magnitude is descriptive, not a calibrated setpoint.',
   'QMS:FIL_SELECT retains raw readback code; no enum interpretation is applied.',
   'QMS:RF_FREQ has no observations in selected HK channels; this does not prove RF was disabled.',
   'Multiplier 2 enable log is an event record, not an electron-multiplier gain calibration.',
   'Whole-event CSN/OSNB m/z 40 distributions are not time/phase/altitude paired and must not be divided to estimate sensitivity.',
   'No clock join is made among cal-msg log prefixes, HK TIME, cal-mkr TIME and L1B t_sclk_cor.',
   'Mass-to-charge 40 is a channel label, not a unique species identity.'],
  'phases':rows
 }
def main()->None:
 if '--self-test' in sys.argv:self_test();print('operational analyzer self-test: OK');return
 result=analyse();OUT.write_text(json.dumps(result,indent=2,sort_keys=True)+'\n',encoding='utf-8')
 print(f'Wrote {OUT.relative_to(ROOT)}: {len(result["phases"])} phases, {sum(p["housekeepingRowCount"] for p in result["phases"]):,} HK rows')
if __name__=='__main__':main()
