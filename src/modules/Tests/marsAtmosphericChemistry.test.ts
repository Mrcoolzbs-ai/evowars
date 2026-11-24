import { describe, expect, it } from 'vitest';
import {
  MARS_HO2_ACS_UPPER_LIMITS,
  MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES,
  MARS_SAM_GALE_CRATER_ANNUAL_MEAN,
  assessMarsSamCompositionCoverage
} from '../Data/marsAtmosphericChemistry';
import { createMgsMars8028D38AHydrostaticColumnInput } from '../Core/atmosphericReferenceAdapters';

describe('source-backed Mars atmospheric chemistry evidence', () => {
  it('preserves the five SAM annual means and explicitly reports incomplete closure', () => {
    const records = MARS_SAM_GALE_CRATER_ANNUAL_MEAN.records;
    expect(records).toHaveLength(5);
    expect(records.map((record) => record.volumeMixingRatioFraction)).toEqual([
      0.951, 0.0259, 0.0194, 0.00161, 0.00058
    ]);
    expect(records.find((record) => record.gasId === 'ar')?.formula).toBe('40Ar');

    const coverage = assessMarsSamCompositionCoverage();
    expect(coverage.status).toBe('incomplete');
    expect(coverage.measuredVolumeFractionSum).toBeCloseTo(0.99849, 12);
    expect(coverage.unassignedRemainderFraction).toBeCloseTo(0.00151, 12);
    expect(coverage.errors).toHaveLength(0);
  });

  it('does not silently normalise the SAM subset into an artificial hydrostatic mixture', () => {
    const samComposition = {
      gases: MARS_SAM_GALE_CRATER_ANNUAL_MEAN.records.map((record) => ({
        gasId: record.gasId,
        moleFraction: record.volumeMixingRatioFraction
      })),
      provenance: {
        sourceName: MARS_SAM_GALE_CRATER_PROVENANCE.sourceName,
        sourceId: MARS_SAM_GALE_CRATER_PROVENANCE.sourceId,
        reference: MARS_SAM_GALE_CRATER_PROVENANCE.reference,
        method: MARS_SAM_GALE_CRATER_PROVENANCE.method
      }
    };

    expect(() => createMgsMars8028D38AHydrostaticColumnInput(samComposition))
      .toThrow(/автоматическая нормировка запрещена/);
  });

  it('fails closed for duplicate or non-finite SAM records', () => {
    const valid = MARS_SAM_GALE_CRATER_ANNUAL_MEAN.records[0];
    const duplicate = assessMarsSamCompositionCoverage([valid, valid]);
    expect(duplicate.status).toBe('invalid');
    expect(duplicate.errors.join(' ')).toMatch(/duplicate/);

    const invalid = assessMarsSamCompositionCoverage([{
      ...valid,
      volumeMixingRatioFraction: Number.NaN
    }]);
    expect(invalid.status).toBe('invalid');
    expect(invalid.errors.join(' ')).toMatch(/invalid volume mixing ratio/);
  });

  it('keeps ACS observational upper limits distinct from measured detections', () => {
    expect(MARS_HO2_ACS_UPPER_LIMITS.detectionStatus).toBe('no_confident_detection');
    expect(MARS_HO2_ACS_UPPER_LIMITS.observationCount).toBe(200);
    expect(MARS_HO2_ACS_UPPER_LIMITS.points).toEqual([
      { altitudeKmApprox: 10, upperLimitPpbv: 15, sigmaLevel: 5 },
      { altitudeKmApprox: 40, upperLimitPpbv: 100, sigmaLevel: 5 }
    ]);
    expect(MARS_HO2_ACS_UPPER_LIMITS.provenance.limitations).toMatch(/not be used as measured concentrations/);
  });

  it('keeps OpenMARS MY35 dusty-season estimates as model output, not observations', () => {
    expect(MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES.evidenceKind).toBe('modelled_range');
    expect(MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES.modelMarsYear).toBe(35);
    expect(MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES.ranges).toEqual([
      { altitudeRangeKm: [0, 20], mixingRatioRangePpbv: [1, 2] },
      { altitudeRangeKm: [40, 50], mixingRatioRangePpbv: [4, 5] }
    ]);
    expect(MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES.provenance.limitations)
      .toMatch(/not observational values/);
  });
});
