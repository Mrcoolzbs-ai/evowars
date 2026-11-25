import { describe, expect, it } from 'vitest';
import {
  MAVEN_NGIMS_L1B_CSV_HEADERS,
  MAVEN_NGIMS_L1B_LIMITATIONS,
  MAVEN_NGIMS_L1B_PRODUCT_TID_14282,
  parseMavenNgimsL1bCsvText,
  selectMavenNgimsL1bMassChannelSignals
} from '../Data/mavenNgimsL1bEvidence';

type Row=Record<string,string>;
function row(overrides:Partial<Row>={}):Row{return{
  t_utc:'2014-12-11T17:04:01',t_unix:'1418317441.000',t_sclk_raw:'471589421.469',
  t_sclk_cor:'471589421.469',t_tid:'4712.342446',tid:'14282',umkid:'1',orbit:'391',
  focus_mode:'osnb',multiplier:'1',filament:'0',temperature_s:'23.5',mass:'16',
  counts:'403',cps_raw:'14925.925926',cps_raw_bkgd:'796.296296',cps_dt:'14926.422823',
  cps_dt_bkgd:'796.236104',bkgd:'0',alt_iau:'181.2',vsc_iau:'4.2',ram1:'0',
  ram2_rot_angle:'0',sol_lon:'250.49',sol_lat:'0',lst:'12.3',x_iau:'0',y_iau:'0',
  z_iau:'0',vx_iau:'0',vy_iau:'0',vz_iau:'0',lat:'73.6',long:'161.5',sza:'112.2',
  quality:'TSC',...overrides};}
function csv(rows:readonly Row[]):string{
  const header=MAVEN_NGIMS_L1B_CSV_HEADERS.join(',');
  const body=rows.map(item=>MAVEN_NGIMS_L1B_CSV_HEADERS.map(key=>{
    const value=item[key]??'';
    return value.includes(',')||value.includes('"')||value.includes('\n')?'"'+value.replace(/"/g,'""')+'"':value;
  }).join(','));
  return '\uFEFF'+[header,...body].join('\r\n')+'\r\n';
}

describe('MAVEN NGIMS L1B signal evidence',()=>{
  it('parses Table A-6 and preserves signal units/modes',()=>{
    const result=parseMavenNgimsL1bCsvText(csv([row(),row({
      t_utc:'2014-12-11T17:04:02',t_unix:'1418317442',focus_mode:'csn',mass:'28',quality:'TSU'
    })]));
    expect(result.status).toBe('parsed');if(result.status!=='parsed')return;
    expect(result.parsedRowCount).toBe(2);
    const a=result.rows[0].validation,b=result.rows[1].validation;
    expect(a.status).toBe('parsed');expect(b.status).toBe('parsed');
    if(a.status!=='parsed'||b.status!=='parsed')return;
    expect(a.row.timeUtc).toBe('2014-12-11T17:04:01Z');
    expect(a.row.massToChargeAmuPerE).toBe(16);
    expect(a.row.cpsDeadTimeCorrectedBackgroundSubtractedHz).toBe(796.236104);
    expect(a.row.altitudeKm).toBe(181.2);
    expect(a.row.ionSourceTemperatureC).toBe(23.5);
    expect(a.row.timeCorrection).toBe('corrected');
    expect(b.row.timeCorrection).toBe('uncorrected');
    expect(a.row.rawFields.t_sclk_raw).toBe('471589421.469');
    expect(a.row.speciesId).toBeNull();
    expect(a.row.abundanceParticlesPerCm3).toBeNull();
  });
  it('keeps unknown time flags without treating them as science quality',()=>{
    const result=parseMavenNgimsL1bCsvText(csv([row({quality:'FUTURE_FLAG'})]));
    expect(result.status).toBe('parsed');if(result.status!=='parsed')return;
    const v=result.rows[0].validation;expect(v.status).toBe('parsed');if(v.status!=='parsed')return;
    expect(v.row.qualityFlagRaw).toBe('FUTURE_FLAG');expect(v.row.timeCorrection).toBe('unrecognized');
  });
  it('retains malformed row diagnostics and rejects a mismatched schema',()=>{
    const result=parseMavenNgimsL1bCsvText(csv([row(),row({t_utc:'2014-02-31T17:04:01',mass:'999'})]));
    expect(result.status).toBe('parsed');if(result.status!=='parsed')return;
    expect(result.parsedRowCount).toBe(1);expect(result.rejectedRowCount).toBe(1);
    expect(result.rows[1].validation.status).toBe('rejected');
    expect(parseMavenNgimsL1bCsvText(csv([row()]).replace('cps_dt_bkgd','bad_header'))).toMatchObject({status:'invalid_csv'});
  });
  it('does not invent a mass channel for blank/DAC mass cells',()=>{
    const result=parseMavenNgimsL1bCsvText(csv([row({mass:''})]));
    expect(result.status).toBe('parsed');if(result.status!=='parsed')return;
    const v=result.rows[0].validation;expect(v.status).toBe('parsed');if(v.status!=='parsed')return;
    expect(v.row.massToChargeAmuPerE).toBeNull();
  });
  it('selects exact TID/orbit/focus/time/mass rows without species promotion',()=>{
    const result=parseMavenNgimsL1bCsvText(csv([
      row({mass:'16'}),
      row({t_utc:'2014-12-11T17:04:02',t_unix:'1418317442',mass:'30'}),
      row({t_utc:'2014-12-11T17:04:03',t_unix:'1418317443',focus_mode:'csn',mass:'16'}),
      row({t_utc:'2014-12-11T17:04:04',t_unix:'1418317444',orbit:'392',mass:'16'}),
      row({t_utc:'2014-12-11T17:04:05',t_unix:'1418317445',mass:'44'})
    ]));
    expect(result.status).toBe('parsed');if(result.status!=='parsed')return;
    const selected=selectMavenNgimsL1bMassChannelSignals(result,{
      tid:14282,orbit:391,focusMode:'osnb',startUtc:'2014-12-11T17:04:00Z',
      stopUtc:'2014-12-11T17:04:04Z',massToChargeAmuPerE:[16,30]
    });
    expect(selected.status).toBe('completed');if(selected.status!=='completed')return;
    expect(selected.selectedRowCount).toBe(2);
    expect(selected.rowCountByMassToCharge).toEqual({'16':1,'30':1});
    expect(selected.speciesIdentification).toBe('not_performed');
    expect(selected.densityConversionPerformed).toBe(false);
    expect(selected.eligibleAsSchedulerInitialAbundance).toBe(false);
    expect(selected.eligibleAsMarsPhotochemicalInitialState).toBe(false);
    expect(selected.rows?.every(item=>item.speciesId===null&&item.abundanceParticlesPerCm3===null)).toBe(true);
    expect(selected.limitations).toContain(MAVEN_NGIMS_L1B_LIMITATIONS[1]);
  });
  it('keeps the real TID 14282 product forensic-only',()=>{
    expect(MAVEN_NGIMS_L1B_PRODUCT_TID_14282.tid).toBe(14282);
    expect(MAVEN_NGIMS_L1B_PRODUCT_TID_14282.orbit).toBe(391);
    expect(MAVEN_NGIMS_L1B_PRODUCT_TID_14282.focusModeRowCounts).toEqual({csn:22579,osnb:17420});
    expect(MAVEN_NGIMS_L1B_PRODUCT_TID_14282.csvByteLength).toBe(14600292);
    expect(MAVEN_NGIMS_L1B_PRODUCT_TID_14282.labelDeclaredFileSizeBytes).toBe(14603490);
    expect(MAVEN_NGIMS_L1B_PRODUCT_TID_14282.forensicOnly).toBe(true);
  });
  it('rejects selections that do not match the source mode',()=>{
    const result=parseMavenNgimsL1bCsvText(csv([row()]));
    expect(result.status).toBe('parsed');if(result.status!=='parsed')return;
    const selected=selectMavenNgimsL1bMassChannelSignals(result,{
      tid:14282,orbit:391,focusMode:'csn',
      startUtc:'2014-12-11T17:04:00Z',stopUtc:'2014-12-11T17:04:01Z'
    });
    expect(selected.status).toBe('rejected');
  });
});
