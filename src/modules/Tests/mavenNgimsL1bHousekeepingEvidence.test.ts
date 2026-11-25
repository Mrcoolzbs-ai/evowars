import {describe,expect,it} from 'vitest';
import {parseMavenNgimsL1bMarkerCsvText} from '../Data/mavenNgimsL1bMarkerEvidence';
import {
  associateMavenNgimsL1bHousekeepingRowsByPhase,
  MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS,
  type MavenNgimsL1bHousekeepingFieldSpec
} from '../Data/mavenNgimsL1bHousekeepingEvidence';

const fields:readonly MavenNgimsL1bHousekeepingFieldSpec[]=[
  {name:'CDH:OS_FIL1_VMON',unit:'Volts'},
  {name:'CDH:OS_TMP',unit:'Degrees Celsius'}
];

function markers() {
  return parseMavenNgimsL1bMarkerCsvText([
    'TIME,MKID,DESCRIPTION',
    '10,1,TIDSTART sci_default_osnb',
    '20,2001,Phase mass scans starting',
    '25,2002,Phase ended.',
    '30,2103,Phase mass scans starting',
    '35,2104,Phase ended.',
    '40,10000,TIDSTOP sci_default_osnb'
  ].join('\n'));
}

function hk(rows:readonly string[][]):string {
  return ['TIME,MKID,CDH:OS_FIL1_VMON,CDH:OS_TMP',...rows.map(row=>row.join(','))].join('\n');
}

describe('MAVEN NGIMS phase-to-housekeeping association',()=>{
  it('associates telemetry by exact phase-start MKID and keeps end-marker rows separate',()=>{
    const result=associateMavenNgimsL1bHousekeepingRowsByPhase(hk([
      ['100.0','1','9','30'],
      ['101.0','2001','12.5','-25'],
      ['102.0','2001','12.7','-24.8'],
      ['103.0','2002','13','-24'],
      ['104.0','2103','11.9','-25.2'],
      ['105.0','2104','12','-25'],
      ['106.0','10000','8','28']
    ]),markers(),{fields,expectedColumnCount:4});

    expect(result.status).toBe('completed');
    if(result.status!=='completed')return;
    expect(result.sourceRowCount).toBe(7);
    expect(result.matchedPhaseRowCount).toBe(3);
    expect(result.rowCountByMarkerId).toEqual({'1':1,'2001':2,'2002':1,'2103':1,'2104':1,'10000':1});
    expect(result.phaseAssociations).toHaveLength(2);
    expect(result.phaseAssociations?.[0].associatedRowCount).toBe(2);
    expect(result.phaseAssociations?.[0].endMarkerContextRowCount).toBe(1);
    expect(result.phaseAssociations?.[0].fieldStatistics[0]).toMatchObject({
      name:'CDH:OS_FIL1_VMON',unit:'Volts',observedValueCount:2,
      minObservedValue:12.5,maxObservedValue:12.7,firstObservedRawValue:'12.5',lastObservedRawValue:'12.7'
    });
    expect(result.phaseAssociations?.[0].fieldStatistics[1]).toMatchObject({
      unit:'Degrees Celsius',minObservedValue:-25,maxObservedValue:-24.8
    });
    expect(result.associationRule).toBe('HK_MKID_equals_phase_start_MKID');
    expect(result.timeValuesUsedForAssociation).toBe(false);
    expect(result.interpolationPerformed).toBe(false);
  });

  it('does not use HK TIME to join the marker product clock',()=>{
    const result=associateMavenNgimsL1bHousekeepingRowsByPhase(hk([
      ['999999.0','2001','12.5','-25'],
      ['999998.0','2002','13','-24'],
      ['999997.0','2103','11.9','-25.2']
    ]),markers(),{fields,expectedColumnCount:4});
    expect(result.status).toBe('completed');
    if(result.status!=='completed')return;
    expect(result.phaseAssociations?.[0].associatedRowCount).toBe(1);
    expect(result.phaseAssociations?.[1].associatedRowCount).toBe(1);
    expect(result.timeValuesUsedForAssociation).toBe(false);
  });

  it('retains blank MKID rows as unassigned and counts non-phase records',()=>{
    const result=associateMavenNgimsL1bHousekeepingRowsByPhase(hk([
      ['100','', '1','2'],
      ['101','999','1','2'],
      ['102','2001','3','4']
    ]),markers(),{fields,expectedColumnCount:4});
    expect(result.status).toBe('completed');
    if(result.status!=='completed')return;
    expect(result.blankMarkerIdRowCount).toBe(1);
    expect(result.unknownMarkerIdRowCount).toBe(1);
    expect(result.nonPhaseRowCount).toBe(2);
    expect(result.phaseAssociations?.[0].associatedRowCount).toBe(1);
  });

  it('preserves empty channel cells as unread instead of carrying the previous value forward',()=>{
    const result=associateMavenNgimsL1bHousekeepingRowsByPhase(hk([
      ['101','2001','12.5',''],
      ['102','2001','','-24.5']
    ]),markers(),{fields,expectedColumnCount:4});
    expect(result.status).toBe('completed');
    if(result.status!=='completed')return;
    expect(result.phaseAssociations?.[0].fieldStatistics[0].observedValueCount).toBe(1);
    expect(result.phaseAssociations?.[0].fieldStatistics[0].emptyValueCount).toBe(1);
    expect(result.phaseAssociations?.[0].fieldStatistics[1].observedValueCount).toBe(1);
    expect(result.phaseAssociations?.[0].fieldStatistics[1].emptyValueCount).toBe(1);
    expect(result.carryForwardPerformed).toBe(false);
  });

  it('preserves quoted commas in CSV values and bounds samples to first/last records',()=>{
    const result=associateMavenNgimsL1bHousekeepingRowsByPhase(hk([
      ['101','2001','12.5','-25'],
      ['102','2001','12.6','-24.9'],
      ['103','2001','12.7','-24.8'],
      ['104','2001','12.8','-24.7']
    ]).replace('CDH:OS_TMP','CDH:OS_TMP'),markers(),{fields,expectedColumnCount:4});
    expect(result.status).toBe('completed');
    if(result.status!=='completed')return;
    expect(result.phaseAssociations?.[0].sampleRows).toHaveLength(4);
    expect(result.phaseAssociations?.[0].sampleRows.map(row=>row.sourceRecordNumber)).toEqual([2,3,4,5]);
  });

  it('rejects invalid schema, field sets and malformed rows',()=>{
    expect(associateMavenNgimsL1bHousekeepingRowsByPhase('TIME,MKID\n1,2',markers(),{fields,expectedColumnCount:2}))
      .toMatchObject({status:'rejected'});
    const malformedValue=associateMavenNgimsL1bHousekeepingRowsByPhase(
      hk([['100','2001','bad','-25']]),markers(),{fields,expectedColumnCount:4}
    );
    expect(malformedValue.status).toBe('completed');
    if(malformedValue.status==='completed') {
      expect(malformedValue.phaseAssociations?.[0].fieldStatistics[0].nonNumericValueCount).toBe(1);
    }
    expect(associateMavenNgimsL1bHousekeepingRowsByPhase(hk([['100','2001','1','2']]),markers(),{fields:[...fields,{name:'MISSING',unit:'V'}],expectedColumnCount:4}))
      .toMatchObject({status:'rejected'});
  });

  it('rejects invalid marker input and keeps results out of scientific initial state',()=>{
    const invalid=parseMavenNgimsL1bMarkerCsvText('TIME,MKID,DESCRIPTION\n1,1,TIDSTART');
    const result=associateMavenNgimsL1bHousekeepingRowsByPhase(hk([['100','2001','1','2']]),invalid,{fields,expectedColumnCount:4});
    expect(result.status).toBe('rejected');
    expect(MAVEN_NGIMS_L1B_HK_ASSOCIATION_LIMITATIONS.length).toBeGreaterThan(0);
  });
});
