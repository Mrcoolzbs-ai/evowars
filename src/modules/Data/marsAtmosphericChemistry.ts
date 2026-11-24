// ============================================
// MARS ATMOSPHERIC CHEMISTRY — source-backed evidence (Stage 4.2)
// ============================================
//
// This module deliberately keeps unlike evidence classes separate:
// - SAM annual-mean near-surface volume mixing ratios;
// - ACS/TGO observational upper limits for HO2;
// - OpenMARS modelled HO2 ranges.
// These records are not a single co-temporal or globally representative
// vertical profile and are not silently promoted to initial chemistry state.

export interface MarsAtmosphericSourceProvenance {
  readonly sourceName: string;
  readonly sourceId: string;
  readonly reference: string;
  readonly method: string;
  readonly applicability: string;
  readonly limitations: string;
}

export interface MarsSamAnnualMeanRecord {
  readonly gasId: 'co2' | 'n2' | 'ar' | 'o2' | 'co';
  readonly formula: 'CO2' | 'N2' | '40Ar' | 'O2' | 'CO';
  readonly volumeMixingRatioFraction: number;
  /** Published ± value, retained without assigning an unreported statistical meaning. */
  readonly reportedPlusMinusFraction: number;
}

export const MARS_SAM_GALE_CRATER_PROVENANCE: MarsAtmosphericSourceProvenance = {
  sourceName: 'Trainer et al. (2019), Seasonal Variations in Atmospheric Composition as Measured in Gale Crater, Mars',
  sourceId: 'DOI:10.1029/2019JE006175',
  reference: 'https://doi.org/10.1029/2019JE006175',
  method: 'Annual mean volume mixing ratios reported from the MSL Curiosity SAM quadrupole mass spectrometer atmospheric-inlet measurements',
  applicability: 'Near-surface atmosphere at Gale Crater; measurements span MY31 Ls=175 degrees through MY34 Ls=12 degrees (nearly five Earth years and three Mars years)',
  limitations: 'Not a global or vertical profile. Several species show seasonal/interannual variability. The five published annual means sum to 0.99849, not 1; the remaining 0.00151 is left unassigned and is not treated as a measured gas.'
};

/**
 * Published annual-mean volume mixing ratios (dimensionless fractions).
 * The Ar record is specifically 40Ar, while the existing gas catalog has
 * only a bulk-Ar gasId; preserve the isotopic qualifier in the formula.
 */
export const MARS_SAM_GALE_CRATER_ANNUAL_MEAN = {
  site: 'Gale Crater, Mars',
  instrument: 'MSL Curiosity / Sample Analysis at Mars (SAM) QMS',
  marsYearRange: { start: 31, end: 34 },
  solarLongitudeRangeDeg: { start: 175, end: 12 },
  records: [
    { gasId: 'co2', formula: 'CO2', volumeMixingRatioFraction: 0.951, reportedPlusMinusFraction: 0.003 },
    { gasId: 'n2', formula: 'N2', volumeMixingRatioFraction: 0.0259, reportedPlusMinusFraction: 0.0006 },
    { gasId: 'ar', formula: '40Ar', volumeMixingRatioFraction: 0.0194, reportedPlusMinusFraction: 0.0004 },
    { gasId: 'o2', formula: 'O2', volumeMixingRatioFraction: 0.00161, reportedPlusMinusFraction: 0.00009 },
    { gasId: 'co', formula: 'CO', volumeMixingRatioFraction: 0.00058, reportedPlusMinusFraction: 0.00008 }
  ] as const satisfies readonly MarsSamAnnualMeanRecord[],
  provenance: MARS_SAM_GALE_CRATER_PROVENANCE
} as const;

export interface MarsSamCompositionCoverage {
  readonly status: 'complete' | 'incomplete' | 'invalid';
  readonly measuredVolumeFractionSum: number;
  /** Residual within the reported subset; identity is intentionally unknown. */
  readonly unassignedRemainderFraction: number | null;
  readonly tolerance: number;
  readonly errors: readonly string[];
}

/**
 * Assess completeness without normalising, filling, or inventing species.
 * A positive remainder means only that the reported subset does not close.
 */
export function assessMarsSamCompositionCoverage(
  records: readonly MarsSamAnnualMeanRecord[] = MARS_SAM_GALE_CRATER_ANNUAL_MEAN.records,
  tolerance = 1e-6
): MarsSamCompositionCoverage {
  const errors: string[] = [];
  const seenGasIds = new Set<string>();
  let sum = 0;

  if (!Number.isFinite(tolerance) || tolerance < 0) {
    errors.push('tolerance must be a finite non-negative number');
  }

  for (const record of records) {
    if (!record || typeof record.gasId !== 'string' || record.gasId.trim() === '') {
      errors.push('each SAM record must have a non-empty gasId');
      continue;
    }
    if (seenGasIds.has(record.gasId)) {
      errors.push('duplicate SAM gasId: ' + record.gasId);
    }
    seenGasIds.add(record.gasId);

    const fraction = record.volumeMixingRatioFraction;
    const uncertainty = record.reportedPlusMinusFraction;
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
      errors.push('invalid volume mixing ratio for ' + record.gasId);
    } else {
      sum += fraction;
    }
    if (!Number.isFinite(uncertainty) || uncertainty < 0) {
      errors.push('invalid reported uncertainty for ' + record.gasId);
    }
  }

  if (!Number.isFinite(sum) || sum > 1 + Math.max(0, tolerance)) {
    errors.push('reported volume mixing ratios exceed unity');
  }

  const unassignedRemainderFraction =
    Number.isFinite(sum) && sum <= 1 ? 1 - sum : null;
  const status: MarsSamCompositionCoverage['status'] =
    errors.length > 0
      ? 'invalid'
      : Math.abs(sum - 1) <= tolerance
        ? 'complete'
        : 'incomplete';

  return {
    status,
    measuredVolumeFractionSum: sum,
    unassignedRemainderFraction,
    tolerance,
    errors
  };
}

export interface MarsHo2UpperLimitPoint {
  readonly altitudeKmApprox: number;
  readonly upperLimitPpbv: number;
  readonly sigmaLevel: 5;
}

/**
 * ACS MIR/TGO observations from 200 occultations (April 2022–May 2023,
 * MY36 Ls=212 degrees through MY37 Ls=63 degrees). No confident HO2
 * spectral detection was reported; these values are 5-sigma upper limits.
 */
export const MARS_HO2_ACS_UPPER_LIMITS = {
  species: 'HO2',
  speciesId: 'ho2',
  detectionStatus: 'no_confident_detection',
  observationCount: 200,
  marsYearRange: { start: 36, end: 37 },
  solarLongitudeRangeDeg: { start: 212, end: 63 },
  points: [
    { altitudeKmApprox: 10, upperLimitPpbv: 15, sigmaLevel: 5 },
    { altitudeKmApprox: 40, upperLimitPpbv: 100, sigmaLevel: 5 }
  ] as const satisfies readonly MarsHo2UpperLimitPoint[],
  provenance: {
    sourceName: 'Alday et al. (2024), Upper limits of HO2 in the atmosphere of Mars from the ExoMars Trace Gas Orbiter',
    sourceId: 'DOI:10.1093/mnras/stae1814',
    reference: 'https://doi.org/10.1093/mnras/stae1814',
    method: 'ACS MIR solar-occultation spectral search; 5-sigma abundance upper limits derived from 200 observations',
    applicability: 'Mars atmosphere during MY36 Ls=212 degrees to MY37 Ls=63 degrees; lowest reported upper limit is approximately 15 ppbv near 10 km and rises to approximately 100 ppbv near 40 km',
    limitations: 'HO2 was not confidently detected. Upper limits constrain abundance from above and must not be used as measured concentrations, non-zero initial abundances, or zero-valued detections.'
  } satisfies MarsAtmosphericSourceProvenance
} as const;

export interface MarsHo2ModelledRange {
  readonly altitudeRangeKm: readonly [number, number];
  readonly mixingRatioRangePpbv: readonly [number, number];
}

/**
 * Separate OpenMARS model expectations cited by Alday et al. (2024).
 * These are MY35 dusty-season model ranges, not ACS measurements and not
 * a direct reconstruction of the MY36–MY37 occultation period.
 */
export const MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES = {
  species: 'HO2',
  speciesId: 'ho2',
  evidenceKind: 'modelled_range',
  model: 'OpenMARS 3-D GCM/reanalysis with photochemistry',
  modelMarsYear: 35,
  season: 'second half of Mars year; dusty-season profiles',
  ranges: [
    { altitudeRangeKm: [0, 20], mixingRatioRangePpbv: [1, 2] },
    { altitudeRangeKm: [40, 50], mixingRatioRangePpbv: [4, 5] }
  ] as const satisfies readonly MarsHo2ModelledRange[],
  provenance: {
    sourceName: 'OpenMARS model ranges as summarized in Alday et al. (2024), Figure 5 and Section 4.2',
    sourceId: 'OpenMARS MY35 HO2 comparison',
    reference: 'https://doi.org/10.1093/mnras/stae1814',
    method: 'Modelled HO2 volume-mixing-ratio ranges reported for dusty-season MY35 profiles',
    applicability: 'Model estimates at ACS occultation locations/times used for the paper comparison; MY35 model output compared against MY36–MY37 ACS observations',
    limitations: 'Model-derived ranges only; not observational values, not a global constant profile, and not evidence of HO2 detection. Post-dusty-season profiles are lower but not numerically specified in this compact record.'
  } satisfies MarsAtmosphericSourceProvenance
} as const;
