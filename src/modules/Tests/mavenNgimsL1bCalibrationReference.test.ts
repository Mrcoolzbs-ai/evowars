import {describe,expect,it} from 'vitest';
import {
  MAVEN_NGIMS_CALIBRATION_APPLICABILITY,
  MAVEN_NGIMS_DEAD_TIME_REFERENCE,
  MAVEN_NGIMS_EARLY_MISSION_CONFIGURATION_CAVEAT,
  MAVEN_NGIMS_GAIN_STABILIZATION,
  MAVEN_NGIMS_GROUND_CLOSED_SOURCE_SENSITIVITIES,
  MAVEN_NGIMS_IN_FLIGHT_N2_FRAGMENTATION,
  MAVEN_NGIMS_OPEN_SOURCE_CALIBRATION,
  MAVEN_NGIMS_PREFLIGHT_CALIBRATION_TIDS,
  calculateMavenNgimsGroundReferenceSensitivity,
  findMavenNgimsGroundClosedSourceSensitivity,
  getMavenNgimsRfCorrectionFactor
} from '../Data/mavenNgimsL1bCalibrationReference';

describe('MAVEN NGIMS calibration reference constraints',()=>{
  it('contains all eight SIS preflight ground sensitivity rows',()=>{
    expect(MAVEN_NGIMS_GROUND_CLOSED_SOURCE_SENSITIVITIES).toHaveLength(8);
    expect(findMavenNgimsGroundClosedSourceSensitivity({
      filament:2,emissionMicroamps:250,cem:2,species:'40Ar'
    })?.absoluteSensitivityCountsPerSecondPerParticlePerCc).toBe(3.03e-2);
  });
  it('applies the published RF factor at the exact 20.5 mass boundary',()=>{
    expect(getMavenNgimsRfCorrectionFactor(20.5)).toBe(0.71);
    expect(getMavenNgimsRfCorrectionFactor(20.5001)).toBe(1);
    expect(getMavenNgimsRfCorrectionFactor(-1)).toBeNull();
  });
  it('calculates only a labelled ground-reference sensitivity',()=>{
    const result=calculateMavenNgimsGroundReferenceSensitivity({
      normalizedSensitivity:1.13e-2,massToCharge:40,ionizationCrossSectionAngstromSquared:2.52
    });
    expect(result?.rfCorrectionFactor).toBe(1);
    expect(result?.absoluteSensitivityCountsPerSecondPerParticlePerCc).toBeCloseTo(0.028476,8);
    expect(result?.scope).toBe('preflight_ground_reference_not_flight_validated');
  });
  it('does not invent CEM 2 dead-time coefficients or a correction for L1B CPS columns',()=>{
    expect(MAVEN_NGIMS_DEAD_TIME_REFERENCE.sisRev113.detector2.aSeconds).toBeNull();
    expect(MAVEN_NGIMS_DEAD_TIME_REFERENCE.l1bUse.additionalDeadTimeCorrectionAllowedOnTheseColumns).toBe(false);
  });
  it('stores the published N2 fragment ratio as N2-specific evidence only',()=>{
    expect(MAVEN_NGIMS_IN_FLIGHT_N2_FRAGMENTATION.fragmentToParentRatio).toBe(0.0347);
    expect(MAVEN_NGIMS_IN_FLIGHT_N2_FRAGMENTATION.oneSigmaAbsoluteUncertainty).toBe(0.0042);
    expect(MAVEN_NGIMS_IN_FLIGHT_N2_FRAGMENTATION.calibrationGasRuns).toBe(6);
  });
  it('does not apply the Deep Dip gain stabilization factor to Orbit 391',()=>{
    expect(MAVEN_NGIMS_GAIN_STABILIZATION.firstApplicableOrbitExclusive).toBe(748);
    expect(MAVEN_NGIMS_GAIN_STABILIZATION.appliesToEvent).toBe(false);
  });
  it('keeps the early-2014 event in manual configuration review rather than silently validating it',()=>{
    expect(MAVEN_NGIMS_EARLY_MISSION_CONFIGURATION_CAVEAT.eventTid).toBe(14282);
    expect(MAVEN_NGIMS_EARLY_MISSION_CONFIGURATION_CAVEAT.directFlightReadbacks.channel2.observedVolts).toBe(-2437.6);
    expect(MAVEN_NGIMS_EARLY_MISSION_CONFIGURATION_CAVEAT.reviewRequired).toBe(true);
    expect(MAVEN_NGIMS_CALIBRATION_APPLICABILITY.flightSpecificClosedSourceSensitivityValidated).toBe(false);
  });
  it('leaves open-source sensitivity unavailable when C_EN and paired calibration data are missing',()=>{
    expect(MAVEN_NGIMS_OPEN_SOURCE_CALIBRATION.cEn).toBeNull();
    expect(MAVEN_NGIMS_OPEN_SOURCE_CALIBRATION.computedForTid14282).toBe(false);
  });
  it('preserves the SIS-listed preflight calibration TID 10191 naming conflict',()=>{
    expect(MAVEN_NGIMS_PREFLIGHT_CALIBRATION_TIDS.find(x=>x.tid===10191)?.designationConflict).toBe(true);
    expect(MAVEN_NGIMS_PREFLIGHT_CALIBRATION_TIDS.find(x=>x.tid===10194)?.sisDesignation).toBe('Krypton calibration');
  });
});


describe('flight calibration readiness gate',()=>{
  const readyEvidence = () => ({
    closed_source_sensitivity:{status:'validated' as const,evidenceId:'flight-cs-sensitivity-1',applicability:'flight_event_specific' as const},
    paired_open_closed_response:{status:'validated' as const,evidenceId:'paired-count-rates-1',applicability:'flight_event_specific' as const},
    energy_correction_cEn:{status:'validated' as const,evidenceId:'c-en-validation-1',applicability:'flight_event_specific' as const},
    fragmentation_background:{status:'validated' as const,evidenceId:'fragment-background-1',applicability:'flight_event_specific' as const},
    detector_dead_time:{status:'validated' as const,evidenceId:'cem-deadtime-1',applicability:'flight_event_specific' as const},
    event_configuration_review:{status:'validated' as const,evidenceId:'event-config-review-1',applicability:'flight_event_specific' as const}
  });
  it('only reports ready when every gate has flight-scoped evidence',()=>{
    const result=evaluateMavenNgimsFlightCalibrationReadiness(readyEvidence());
    expect(result.status).toBe('ready');
    expect(result.densityConversionAllowed).toBe(true);
    expect(result.blockers).toEqual([]);
  });
  it('blocks unresolved gates and reports each blocker',()=>{
    const input=readyEvidence();
    input.energy_correction_cEn={status:'unresolved',rationale:'C_EN not established'};
    input.detector_dead_time={status:'missing'};
    const result=evaluateMavenNgimsFlightCalibrationReadiness(input);
    expect(result.status).toBe('blocked');
    expect(result.densityConversionAllowed).toBe(false);
    expect(result.blockers).toHaveLength(2);
  });
  it('rejects preflight evidence promoted without event-specific scope',()=>{
    const input=readyEvidence();
    input.closed_source_sensitivity={status:'validated',evidenceId:'ground-preflight',applicability:undefined};
    const result=evaluateMavenNgimsFlightCalibrationReadiness(input);
    expect(result.status).toBe('blocked');
    expect(result.blockers[0]).toContain('flight scope');
  });
  it('requires a rationale for a not-applicable gate',()=>{
    const input=readyEvidence();
    input.detector_dead_time={status:'not_applicable'};
    expect(evaluateMavenNgimsFlightCalibrationReadiness(input).status).toBe('blocked');
    input.detector_dead_time={status:'not_applicable',rationale:'L1B CPS columns already dead-time corrected; no additional correction applied'};
    expect(evaluateMavenNgimsFlightCalibrationReadiness(input).status).toBe('ready');
  });
});
