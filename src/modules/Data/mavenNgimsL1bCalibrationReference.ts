// Authoritative reference parameters and conservative applicability gates for MAVEN NGIMS.
export const MAVEN_NGIMS_CALIBRATION_REFERENCE_DOCUMENT = {
  title: 'MAVEN NGIMS PDS Software Interface Specification',
  revision: '1.13',
  date: '2022-10-30',
  url: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/document/ngims_pds_sis_v03_r01.pdf',
  relevantSections: [
    '3.7.1 detector-chain characterization (printed pp. 19-20)',
    '3.7.4 instrument sensitivity and equations (printed pp. 21-22)',
    '8.1-8.3 electrode and L1B housekeeping definitions (printed pp. 39-72)',
    '8.4 pre-launch calibration TIDs (printed p. 82)'
  ]
} as const;

export type MavenNgimsGroundSpecies = '40Ar' | '84Kr';
export interface MavenNgimsGroundClosedSourceSensitivity {
  readonly filament: 1 | 2;
  readonly emissionMicroamps: 50 | 250;
  readonly cem: 1 | 2;
  readonly species: MavenNgimsGroundSpecies;
  readonly massToCharge: 40 | 84;
  readonly ionizationCrossSectionAngstromSquared: number;
  readonly absoluteSensitivityCountsPerSecondPerParticlePerCc: number;
  readonly normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: number;
  readonly calibrationScope: 'preflight_ground_reference';
}

export const MAVEN_NGIMS_GROUND_CLOSED_SOURCE_SENSITIVITIES: readonly MavenNgimsGroundClosedSourceSensitivity[] = [
  { filament: 1, emissionMicroamps: 250, cem: 1, species: '40Ar', massToCharge: 40, ionizationCrossSectionAngstromSquared: 2.52, absoluteSensitivityCountsPerSecondPerParticlePerCc: 2.84e-2, normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: 1.13e-2, calibrationScope: 'preflight_ground_reference' },
  { filament: 1, emissionMicroamps: 50, cem: 1, species: '40Ar', massToCharge: 40, ionizationCrossSectionAngstromSquared: 2.52, absoluteSensitivityCountsPerSecondPerParticlePerCc: 1.83e-3, normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: 7.26e-4, calibrationScope: 'preflight_ground_reference' },
  { filament: 1, emissionMicroamps: 250, cem: 1, species: '84Kr', massToCharge: 84, ionizationCrossSectionAngstromSquared: 3.45, absoluteSensitivityCountsPerSecondPerParticlePerCc: 2.03e-2, normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: 5.89e-3, calibrationScope: 'preflight_ground_reference' },
  { filament: 1, emissionMicroamps: 50, cem: 1, species: '84Kr', massToCharge: 84, ionizationCrossSectionAngstromSquared: 3.45, absoluteSensitivityCountsPerSecondPerParticlePerCc: 1.38e-3, normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: 4.00e-4, calibrationScope: 'preflight_ground_reference' },
  { filament: 2, emissionMicroamps: 250, cem: 2, species: '40Ar', massToCharge: 40, ionizationCrossSectionAngstromSquared: 2.52, absoluteSensitivityCountsPerSecondPerParticlePerCc: 3.03e-2, normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: 1.20e-2, calibrationScope: 'preflight_ground_reference' },
  { filament: 2, emissionMicroamps: 50, cem: 2, species: '40Ar', massToCharge: 40, ionizationCrossSectionAngstromSquared: 2.52, absoluteSensitivityCountsPerSecondPerParticlePerCc: 2.36e-3, normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: 9.36e-4, calibrationScope: 'preflight_ground_reference' },
  { filament: 2, emissionMicroamps: 250, cem: 2, species: '84Kr', massToCharge: 84, ionizationCrossSectionAngstromSquared: 3.45, absoluteSensitivityCountsPerSecondPerParticlePerCc: 2.27e-2, normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: 6.57e-3, calibrationScope: 'preflight_ground_reference' },
  { filament: 2, emissionMicroamps: 50, cem: 2, species: '84Kr', massToCharge: 84, ionizationCrossSectionAngstromSquared: 3.45, absoluteSensitivityCountsPerSecondPerParticlePerCc: 1.90e-3, normalizedSensitivityCountsPerSecondPerParticlePerCcPerAngstromSquared: 5.51e-4, calibrationScope: 'preflight_ground_reference' }
] as const;

export const MAVEN_NGIMS_RF_CORRECTION = {
  thresholdMassToCharge: 20.5,
  atOrBelowThreshold: 0.71,
  aboveThreshold: 1.0,
  formula: 'S_a = S_n * C_RF(m_s) * sigma_s',
  scope: 'SIS closed-source sensitivity equation; not a stand-alone flight sensitivity calibration'
} as const;

export function getMavenNgimsRfCorrectionFactor(massToCharge: number): number | null {
  if (!Number.isFinite(massToCharge) || massToCharge < 0) return null;
  return massToCharge <= MAVEN_NGIMS_RF_CORRECTION.thresholdMassToCharge
    ? MAVEN_NGIMS_RF_CORRECTION.atOrBelowThreshold
    : MAVEN_NGIMS_RF_CORRECTION.aboveThreshold;
}

export function findMavenNgimsGroundClosedSourceSensitivity(input: {
  readonly filament: 1 | 2;
  readonly emissionMicroamps: 50 | 250;
  readonly cem: 1 | 2;
  readonly species: MavenNgimsGroundSpecies;
}): MavenNgimsGroundClosedSourceSensitivity | null {
  return MAVEN_NGIMS_GROUND_CLOSED_SOURCE_SENSITIVITIES.find(row =>
    row.filament === input.filament &&
    row.emissionMicroamps === input.emissionMicroamps &&
    row.cem === input.cem &&
    row.species === input.species
  ) ?? null;
}

export interface MavenNgimsGroundSensitivityCalculation {
  readonly absoluteSensitivityCountsPerSecondPerParticlePerCc: number;
  readonly rfCorrectionFactor: number;
  readonly scope: 'preflight_ground_reference_not_flight_validated';
}
export function calculateMavenNgimsGroundReferenceSensitivity(input: {
  readonly normalizedSensitivity: number;
  readonly massToCharge: number;
  readonly ionizationCrossSectionAngstromSquared: number;
}): MavenNgimsGroundSensitivityCalculation | null {
  const values = [input.normalizedSensitivity, input.massToCharge, input.ionizationCrossSectionAngstromSquared];
  if (values.some(value => !Number.isFinite(value)) ||
      input.normalizedSensitivity < 0 ||
      input.massToCharge < 0 ||
      input.ionizationCrossSectionAngstromSquared <= 0) return null;
  const rfCorrectionFactor = getMavenNgimsRfCorrectionFactor(input.massToCharge);
  if (rfCorrectionFactor === null) return null;
  return {
    absoluteSensitivityCountsPerSecondPerParticlePerCc:
      input.normalizedSensitivity * rfCorrectionFactor * input.ionizationCrossSectionAngstromSquared,
    rfCorrectionFactor,
    scope: 'preflight_ground_reference_not_flight_validated'
  };
}

export const MAVEN_NGIMS_DEAD_TIME_REFERENCE = {
  sisRev113: {
    equation: 'tau = A * ln(m) + B',
    detector1: { cem: 1, aSeconds: 1.5738e-8, bSeconds: -2.3125e-7 },
    detector2: { cem: 2, aSeconds: null, bSeconds: null },
    note: 'SIS Table 2 has pre-flight values for CEM 1 only; CEM 2 has no supplied coefficients because values were to be determined from flight data.'
  },
  stone2018Analysis: {
    equation: 'tau = max(A * ln(m) + B, 0)',
    aSeconds: 9.49e-9,
    bSeconds: -1.39e-7,
    note: 'Coefficients reported for that study-specific data reduction; not a universal replacement for detector-specific calibration.'
  },
  l1bUse: {
    cpsDtAlreadyDeadTimeCorrected: true,
    cpsDtBkgdAlreadyDeadTimeCorrected: true,
    cpsDtBkgdRecommendedByPdsSis: true,
    additionalDeadTimeCorrectionAllowedOnTheseColumns: false
  }
} as const;

export const MAVEN_NGIMS_IN_FLIGHT_N2_FRAGMENTATION = {
  parentSpecies: 'N2',
  parentMassToCharge: 28,
  fragmentMassToCharge: 14,
  fragmentToParentRatio: 0.0347,
  oneSigmaAbsoluteUncertainty: 0.0042,
  calibrationGasRuns: 6,
  scope: 'published in-flight known-composition calibration-gas measurements; specific to N2 retrieval through m/z 14, not a general fragmentation matrix',
  source: 'Stone et al. (2018), NGIMS neutral composition calibration analysis'
} as const;

export const MAVEN_NGIMS_GAIN_STABILIZATION = {
  densityCorrectionFactor: 1.5331,
  operation: 'divide density by factor',
  firstApplicableOrbitExclusive: 748,
  cause: 'detector gain stabilization after exposure during Deep Dip 1',
  eventOrbit: 391,
  appliesToEvent: false
} as const;

export const MAVEN_NGIMS_EARLY_MISSION_CONFIGURATION_CAVEAT = {
  period: 'October-December 2014',
  initialPublishedMultiplierSettingVolts: 125,
  laterPublishedMultiplierSettingVolts: 25,
  changeContext: 'early-December contamination in m/z 19 and 16 channels with loss of signal across masses; several instrument settings were changed',
  publishedPipelineDifference: '2014 data used different calibration techniques and computation methods from February 2015 onward',
  eventTid: 14282,
  eventDate: '2014-12-11',
  eventOrbit: 391,
  reviewRequired: true,
  directFlightReadbacks: {
    channel1: { name: 'QMS:MT_MU1_VCTL', observedVolts: -45.0, unit: 'V', observedValueCount: 23 },
    channel2: { name: 'QMS:MT_MU2_VCTL', observedVolts: -2437.6, unit: 'V', observedValueCount: 23 }
  },
  multiplier2CommandLogged: true,
  commandValue: 2462,
  interpretationBoundary: 'PDS SIS defines MT_MU1/MT_MU2 as actual negative multiplier-electrode voltage channels. The published 125/25 V early-mission setting is not mapped to either of these PDS channels by the retrieved source; do not infer equivalence from numerical values.'
} as const;

export const MAVEN_NGIMS_OPEN_SOURCE_CALIBRATION = {
  equation: 'O_a = [S_a(m_ref) * n_c(m_ref) / n_o(m_ref)] * C_EN(m_s)',
  cEn: null,
  cEnFoundInRetrievedSisOrPublications: false,
  required: [
    'applicable closed-source sensitivity for the same reference gas and detector configuration',
    'paired dead-time-corrected reference-gas count rates from closed and open sources',
    'validated energy correction C_EN for the target mass/energy range',
    'applicable fragmentation and background model'
  ],
  computedForTid14282: false
} as const;

export const MAVEN_NGIMS_CALIBRATION_APPLICABILITY = {
  event: { tid: 14282, orbit: 391, utcDate: '2014-12-11' },
  preflightGroundSensitivityAvailable: true,
  flightSpecificClosedSourceSensitivityValidated: false,
  openSourceSensitivityValidated: false,
  energyCorrectionFactorCEnAvailable: false,
  fragmentationMatrixComplete: false,
  deadTimeCorrectionForCem2AvailableInSis: false,
  eventNeedsEarlyMissionConfigurationReview: true,
  existingCsnL2ProductIsCalibrationEvidence: false,
  safeScientificUse: 'reference metadata and operational evidence only; do not convert L1B CPS to density with these references'
} as const;

export const MAVEN_NGIMS_PREFLIGHT_CALIBRATION_TIDS = [
  { tid: 10191, sisDesignation: 'Argon calibration', date: '2012-09-23', messageLogDirectory: '2012-09-23-08.19.45-10191-KrCalibration/', designationConflict: true },
  { tid: 10194, sisDesignation: 'Krypton calibration', date: '2012-09-23', messageLogDirectory: '2012-09-23-17.42.16-10194-KrCal/', designationConflict: false },
  { tid: 10197, sisDesignation: 'Krypton calibration', date: '2012-09-24', designationConflict: false },
  { tid: 10198, sisDesignation: 'Krypton calibration', date: '2012-09-24', designationConflict: false },
  { tid: 10199, sisDesignation: 'Krypton calibration', date: '2012-09-25', designationConflict: false },
  { tid: 10201, sisDesignation: 'Xenon calibration', date: '2012-09-25', designationConflict: false },
  { tid: 10202, sisDesignation: 'Xenon calibration', date: '2012-09-25', designationConflict: false },
  { tid: 10205, sisDesignation: 'Helium calibration', date: '2012-09-26', designationConflict: false },
  { tid: 10207, sisDesignation: 'Helium calibration', date: '2012-09-26', designationConflict: false },
  { tid: 10216, sisDesignation: 'CS/OS switching test', date: '2012-09-28', designationConflict: false },
  { tid: 10217, sisDesignation: 'CS/OS switching test', date: '2012-09-28', designationConflict: false }
] as const;

export const MAVEN_NGIMS_CALIBRATION_COLLECTION = {
  collectionLid: 'urn:nasa:pds:maven_ngims:calibration',
  url: 'https://atmos.nmsu.edu/PDS/data/PDS4/MAVEN/ngims_bundle/calibration/',
  description: 'Raw pre-launch integration and testing data used to define calibration techniques for flight data.',
  eventProducts: 'gnd-sci, gnd-hk, gnd-mkr, gnd-msg',
  sourceTids: [10191, 10194, 10197, 10198, 10199, 10201, 10202, 10205, 10207, 10216, 10217]
} as const;
