// ============================================
// MARS PHOTOCHEMICAL OBSERVATION-SNAPSHOT GATE (Stage 4.2)
// ============================================
//
// This module is deliberately an assembler, not a profile synthesizer.
// It creates the scheduler's 16-species starting compartment only when
// every required species has one explicitly identified, verified
// detection co-registered to the same event as the temperature sample.
//
// Upper limits, non-detections, modelled ranges, model-constrained ratios,
// missing species, uncertain quality rows, and cross-season averages are
// not converted into point concentrations. No zero fill, interpolation,
// climatological averaging, or cross-event blending is performed.
//
// The accepted snapshot must match the two Taysum & Palmer (2020) Table B2
// scenario coordinates: altitude 0.5 or 42.67 km, SZA=0 deg, Ls=251 deg.
// Caller-declared co-registration tolerances are part of the result
// provenance; they are never implicit defaults.

import {
  MARS_PHOTOCHEMICAL_SPECIES_ORDER
} from './marsPhotochemicalNetwork';
import type {
  MarsPhotochemicalInitialConcentrations
} from './marsPhotochemicalNetwork';
import type { MarsGasSpeciesId } from '../Data/marsGasPhaseKinetics';
import {
  MARS_SAM_GALE_CRATER_ANNUAL_MEAN,
  assessMarsSamCompositionCoverage,
  MARS_HO2_ACS_UPPER_LIMITS,
  MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES
} from '../Data/marsAtmosphericChemistry';
import {
  MAVEN_IUVS_NO_DAYGLOW_REFERENCE,
  MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS,
  MAVEN_NGIMS_PDS_ARCHIVE
} from '../Data/mavenUpperAtmosphereEvidence';
import { MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE } from '../Data/marsPhotochemistryEvidence';
import type { DataProvenance, ScientificValue } from '../Core/scientificValue';
import { hasUsableTemperature } from '../Core/thermalState';
import {
  createReservoir,
  setMaterialInventory,
  validateMaterialInventory
} from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';

export const MARS_PHOTOCHEMICAL_AVOGADRO_CONSTANT_MOL_INV = 6.02214076e23;

export interface MarsPhotochemicalSamplingContext {
  /** Curated event key shared by all instruments/rows in this snapshot. */
  readonly eventId: string;
  /** UTC timestamp; must be parseable and end in Z. */
  readonly timeUtc: string;
  readonly marsYear: number;
  readonly solarLongitudeDeg: number;
  /** Exact Table B2 node: 0.5 or 42.67 km; no altitude interpolation. */
  readonly altitudeKm: number;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly localSolarTimeHours: number;
  readonly solarZenithAngleDeg: number;
}

export type MarsPhotochemicalObservationKind =
  | 'in_situ_detection'
  | 'remote_sensing_detection'
  | 'upper_limit'
  | 'non_detection'
  | 'modelled'
  | 'model_constrained';

export interface MarsPhotochemicalSpeciesObservation {
  readonly speciesId: MarsGasSpeciesId;
  /** Positive measured number density, particles cm^-3. */
  readonly numberDensityPerCm3: number;
  /** Reported 1-sigma in particles cm^-3; null means not published/unknown. */
  readonly reportedSigmaPerCm3: number | null;
  readonly evidenceKind: MarsPhotochemicalObservationKind;
  readonly quality: 'verified' | 'uncertain' | 'rejected';
  readonly context: MarsPhotochemicalSamplingContext;
  readonly provenance: DataProvenance;
}

export interface MarsPhotochemicalTemperatureObservation {
  /** known or estimated ScientificValue with K as its unit. */
  readonly temperature: ScientificValue;
  readonly evidenceKind: 'in_situ_detection' | 'remote_sensing_detection';
  readonly quality: 'verified' | 'uncertain' | 'rejected';
  readonly context: MarsPhotochemicalSamplingContext;
  readonly provenance: DataProvenance;
}

export interface MarsPhotochemicalCoRegistrationPolicy {
  /**
   * Explicit caller-declared maximum pairwise separations. These are
   * selection tolerances, not instrument accuracy or physical uncertainty.
   */
  readonly maximumTimeSeparationSeconds: number;
  readonly maximumLatitudeSeparationDeg: number;
  readonly maximumLongitudeSeparationDeg: number;
  readonly maximumLocalSolarTimeSeparationHours: number;
  readonly maximumSolarZenithAngleSeparationDeg: number;
  readonly maximumSolarLongitudeSeparationDeg: number;
  /** Explicit tolerance from the Table B2 radiation scenario SZA=0 deg. */
  readonly maximumPhotolysisSzaOffsetDeg: number;
  /** Explicit circular tolerance from the Table B2 radiation scenario Ls=251 deg. */
  readonly maximumPhotolysisSolarLongitudeOffsetDeg: number;
  /** Provenance for how these matching tolerances were selected. */
  readonly provenance: DataProvenance;
}

export interface MarsPhotochemicalObservationSnapshotInput {
  readonly reservoirId: string;
  readonly targetAltitudeKm: 0.5 | 42.67;
  readonly observations: readonly MarsPhotochemicalSpeciesObservation[];
  readonly temperatureObservation: MarsPhotochemicalTemperatureObservation;
  readonly coRegistration: MarsPhotochemicalCoRegistrationPolicy;
}

export interface MarsPhotochemicalObservationSnapshot {
  readonly status: 'completed';
  readonly reservoir: ReservoirRecord;
  readonly initialConcentrationsPerCm3: MarsPhotochemicalInitialConcentrations;
  readonly context: MarsPhotochemicalSamplingContext;
  readonly observedSpecies: readonly MarsGasSpeciesId[];
  readonly sourceIds: readonly string[];
  readonly diagnostics: readonly string[];
}

export interface MarsPhotochemicalObservationSnapshotRejection {
  readonly status: 'rejected';
  readonly errors: readonly string[];
}

export type MarsPhotochemicalObservationSnapshotResult =
  | MarsPhotochemicalObservationSnapshot
  | MarsPhotochemicalObservationSnapshotRejection;

export interface MarsPhotochemicalEvidenceReadinessReport {
  readonly status: 'not_ready';
  readonly targetScenario: {
    readonly altitudeNodesKm: readonly [0.5, 42.67];
    readonly solarZenithAngleDeg: 0;
    readonly solarLongitudeDeg: 251;
  };
  /** All 16 species still required; no complete event is imported in this repository. */
  readonly missingFromCompatibleObservedSnapshot: readonly MarsGasSpeciesId[];
  readonly blockers: readonly string[];
  readonly sourceEvidence: readonly {
    readonly sourceName: string;
    readonly sourceId: string;
    readonly classification: string;
    readonly reasonNotEligibleAsInitialPointValue: string;
  }[];
}

/** Current in-repository data readiness; does not query external archives. */
export function assessMarsPhotochemicalEvidenceReadiness(): MarsPhotochemicalEvidenceReadinessReport {
  const samCoverage = assessMarsSamCompositionCoverage();
  return {
    status: 'not_ready',
    targetScenario: {
      altitudeNodesKm: [0.5, 42.67],
      solarZenithAngleDeg: 0,
      solarLongitudeDeg: 251
    },
    missingFromCompatibleObservedSnapshot: [...MARS_PHOTOCHEMICAL_SPECIES_ORDER],
    blockers: [
      'No complete 16-species, species-resolved number-density snapshot from one co-registered event is imported into this repository.',
      'The SAM dataset contains ' + MARS_SAM_GALE_CRATER_ANNUAL_MEAN.records.length +
        ' annual-mean Gale Crater VMR records; their measured subset sums to ' +
        samCoverage.measuredVolumeFractionSum.toFixed(5) +
        ' and remains ' + samCoverage.status +
        '. It is not a time/altitude-resolved number-density snapshot.',
      'The MGS 1998 radio-occultation product supplies a bulk atmospheric retrieval (temperature, pressure and total number density), not 16 species-resolved densities, and its SZA/Ls event does not match the Taysum Table B2 forcing.',
      'ACS reports HO2 ' + MARS_HO2_ACS_UPPER_LIMITS.detectionStatus +
        ' with 5-sigma upper limits; upper limits are inequalities, not measured positive point concentrations.',
      'The OpenMARS HO2 values are ' + MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES.evidenceKind +
        ' for MY' + MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES.modelMarsYear +
        ', not observations from the ACS event or the Table B2 radiation scenario.',
      'The IUVS NO numerical table is included=' +
        String(MAVEN_IUVS_NO_DAYGLOW_REFERENCE.numericalDensityTableIncluded) +
        '; its retrieved event is MY' + MAVEN_IUVS_NO_DAYGLOW_REFERENCE.observation.marsYear +
        ', Ls ' + MAVEN_IUVS_NO_DAYGLOW_REFERENCE.observation.solarLongitudeDeg.min + '–' +
        MAVEN_IUVS_NO_DAYGLOW_REFERENCE.observation.solarLongitudeDeg.max +
        ', SZA ' + MAVEN_IUVS_NO_DAYGLOW_REFERENCE.observation.solarZenithAngleDeg +
        ' deg and altitude 80–128 km, not either Table B2 node.',
      'The IUVS atomic-O record is ' +
        MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS.evidenceKind +
        ' at ' + MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS.altitudeKm +
        ' km, not a direct number-density observation at 0.5 or 42.67 km.',
      'MAVEN NGIMS readers and selection contracts exist, but no selected L2 measurement rows/orbit snapshot are frozen in Data. NGIMS also has a 2–150 Da mass range; atomic H (1 Da) is outside its coverage.',
      'Taysum Table B2 requires SZA=0 deg, Ls=251 deg and exact altitude nodes 0.5/42.67 km. Its compact table does not publish all TUV inputs (temperature, O3 and total columns, Sun–Mars distance, opacity/dust), so the matching context alone does not close radiation-forcing uncertainty.',
      'The co-registration policy must be justified per imported dataset. Tolerances cannot be widened to disguise a mismatch between instruments, seasons, altitudes or retrieval methods.'
    ],
    sourceEvidence: [
      {
        sourceName: MARS_SAM_GALE_CRATER_ANNUAL_MEAN.instrument,
        sourceId: MARS_SAM_GALE_CRATER_ANNUAL_MEAN.provenance.sourceId,
        classification: 'near-surface annual-mean volume mixing ratios',
        reasonNotEligibleAsInitialPointValue: 'Five partial VMR records across MY31–MY34; no shared vertical event or complete 16-species concentration vector.'
      },
      {
        sourceName: 'MGS 8028D38A radio-occultation retrieval',
        sourceId: 'MGS-M-RSS-5-TPS-V1.0 / DOI:10.17189/n719-8n94',
        classification: 'bulk temperature/pressure/total-number-density retrieval',
        reasonNotEligibleAsInitialPointValue: 'No species-resolved 16-component concentrations; event geometry differs from the fixed Table B2 radiation case.'
      },
      {
        sourceName: MARS_HO2_ACS_UPPER_LIMITS.provenance.sourceName,
        sourceId: MARS_HO2_ACS_UPPER_LIMITS.provenance.sourceId,
        classification: '5-sigma observational upper limits',
        reasonNotEligibleAsInitialPointValue: 'No confident HO2 detection; an upper limit cannot be converted to a point value.'
      },
      {
        sourceName: MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES.provenance.sourceName,
        sourceId: MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES.provenance.sourceId,
        classification: 'modelled HO2 ranges',
        reasonNotEligibleAsInitialPointValue: 'Model range is not a direct observational detection and refers to a different Mars year.'
      },
      {
        sourceName: MAVEN_IUVS_NO_DAYGLOW_REFERENCE.provenance.sourceName,
        sourceId: MAVEN_IUVS_NO_DAYGLOW_REFERENCE.provenance.sourceId,
        classification: 'remote-sensing retrieval described graphically',
        reasonNotEligibleAsInitialPointValue: 'The publication does not provide tabulated numerical density points in the repository; digitised values are not fabricated.'
      },
      {
        sourceName: MAVEN_NGIMS_PDS_ARCHIVE.archive,
        sourceId: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MAVEN/ngims.html',
        classification: 'archive and CSV selection/parser contract',
        reasonNotEligibleAsInitialPointValue: 'No selected orbit/TID species rows are imported; a single-species profile is not a complete initial state and H is outside NGIMS mass coverage.'
      }
    ]
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasIdentifiedProvenance(value: unknown): value is DataProvenance {
  if (!isPlainRecord(value)) return false;
  return ['sourceName', 'sourceId', 'datasetId', 'reference'].some((key) => {
    const candidate = value[key];
    return typeof candidate === 'string' && candidate.trim() !== '';
  });
}

function circularDifference(a: number, b: number, period: number): number {
  const raw = Math.abs(((a - b) % period + period) % period);
  return Math.min(raw, period - raw);
}

function validateContext(
  context: MarsPhotochemicalSamplingContext,
  label: string,
  targetAltitudeKm: number
): string[] {
  const errors: string[] = [];
  if (!context || typeof context !== 'object') return [label + ': sampling context is required'];
  if (typeof context.eventId !== 'string' || context.eventId.trim() === '') {
    errors.push(label + '.eventId must be non-empty');
  }
  if (
    typeof context.timeUtc !== 'string' ||
    !context.timeUtc.endsWith('Z') ||
    !Number.isFinite(Date.parse(context.timeUtc))
  ) {
    errors.push(label + '.timeUtc must be a parseable UTC timestamp ending in Z');
  }
  if (!Number.isInteger(context.marsYear) || context.marsYear <= 0) {
    errors.push(label + '.marsYear must be a positive integer');
  }
  if (!Number.isFinite(context.solarLongitudeDeg) || context.solarLongitudeDeg < 0 || context.solarLongitudeDeg >= 360) {
    errors.push(label + '.solarLongitudeDeg must be in [0,360)');
  }
  if (context.altitudeKm !== targetAltitudeKm) {
    errors.push(label + '.altitudeKm must equal the selected exact Table B2 node (' + targetAltitudeKm + ' km)');
  }
  if (!Number.isFinite(context.latitudeDeg) || context.latitudeDeg < -90 || context.latitudeDeg > 90) {
    errors.push(label + '.latitudeDeg must be in [-90,90]');
  }
  if (!Number.isFinite(context.longitudeDeg) || context.longitudeDeg < -180 || context.longitudeDeg > 360) {
    errors.push(label + '.longitudeDeg must be in [-180,360]');
  }
  if (!Number.isFinite(context.localSolarTimeHours) || context.localSolarTimeHours < 0 || context.localSolarTimeHours >= 24) {
    errors.push(label + '.localSolarTimeHours must be in [0,24)');
  }
  if (!Number.isFinite(context.solarZenithAngleDeg) || context.solarZenithAngleDeg < 0 || context.solarZenithAngleDeg > 180) {
    errors.push(label + '.solarZenithAngleDeg must be in [0,180]');
  }
  return errors;
}

function validateCoRegistrationPolicy(policy: MarsPhotochemicalCoRegistrationPolicy): string[] {
  if (!isPlainRecord(policy)) return ['coRegistration must be a plain object'];
  const errors: string[] = [];
  const toleranceFields: Array<keyof Omit<MarsPhotochemicalCoRegistrationPolicy, 'provenance'>> = [
    'maximumTimeSeparationSeconds',
    'maximumLatitudeSeparationDeg',
    'maximumLongitudeSeparationDeg',
    'maximumLocalSolarTimeSeparationHours',
    'maximumSolarZenithAngleSeparationDeg',
    'maximumSolarLongitudeSeparationDeg',
    'maximumPhotolysisSzaOffsetDeg',
    'maximumPhotolysisSolarLongitudeOffsetDeg'
  ];
  for (const field of toleranceFields) {
    const value = policy[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      errors.push('coRegistration.' + field + ' must be finite and non-negative');
    }
  }
  if (!hasIdentifiedProvenance(policy.provenance)) {
    errors.push('coRegistration.provenance must identify the source/method used to select tolerances');
  }
  return errors;
}

/** Pairwise co-registration against the temperature sample and the photolysis scenario. */
function validateCoRegisteredContext(
  context: MarsPhotochemicalSamplingContext,
  anchor: MarsPhotochemicalSamplingContext,
  policy: MarsPhotochemicalCoRegistrationPolicy,
  label: string
): string[] {
  const errors: string[] = [];
  if (context.eventId !== anchor.eventId) {
    errors.push(label + ': eventId differs from the temperature observation; cross-event blending is forbidden');
  }
  if (context.marsYear !== anchor.marsYear) {
    errors.push(label + ': Mars year differs from the temperature observation');
  }
  if (context.altitudeKm !== anchor.altitudeKm) {
    errors.push(label + ': altitude differs; vertical interpolation is not implemented');
  }
  const timeSeparationS = Math.abs(Date.parse(context.timeUtc) - Date.parse(anchor.timeUtc)) / 1000;
  if (timeSeparationS > policy.maximumTimeSeparationSeconds) {
    errors.push(label + ': time separation ' + timeSeparationS + ' s exceeds the explicit co-registration tolerance');
  }
  const latitudeSeparation = Math.abs(context.latitudeDeg - anchor.latitudeDeg);
  if (latitudeSeparation > policy.maximumLatitudeSeparationDeg) {
    errors.push(label + ': latitude separation exceeds the explicit co-registration tolerance');
  }
  const longitudeSeparation = circularDifference(context.longitudeDeg, anchor.longitudeDeg, 360);
  if (longitudeSeparation > policy.maximumLongitudeSeparationDeg) {
    errors.push(label + ': longitude separation exceeds the explicit co-registration tolerance');
  }
  const localTimeSeparation = circularDifference(context.localSolarTimeHours, anchor.localSolarTimeHours, 24);
  if (localTimeSeparation > policy.maximumLocalSolarTimeSeparationHours) {
    errors.push(label + ': local solar time separation exceeds the explicit co-registration tolerance');
  }
  const szaSeparation = Math.abs(context.solarZenithAngleDeg - anchor.solarZenithAngleDeg);
  if (szaSeparation > policy.maximumSolarZenithAngleSeparationDeg) {
    errors.push(label + ': SZA separation exceeds the explicit co-registration tolerance');
  }
  const lsSeparation = circularDifference(context.solarLongitudeDeg, anchor.solarLongitudeDeg, 360);
  if (lsSeparation > policy.maximumSolarLongitudeSeparationDeg) {
    errors.push(label + ': solar-longitude separation exceeds the explicit co-registration tolerance');
  }
  if (context.solarZenithAngleDeg > policy.maximumPhotolysisSzaOffsetDeg) {
    errors.push(label + ': SZA does not match the fixed Taysum Table B2 scenario (0 deg)');
  }
  if (circularDifference(context.solarLongitudeDeg, 251, 360) >
      policy.maximumPhotolysisSolarLongitudeOffsetDeg) {
    errors.push(label + ': solar longitude does not match the fixed Taysum Table B2 scenario (Ls=251 deg)');
  }
  return errors;
}

/**
 * Create the Scheduler's dedicated molar-concentration reservoir from a
 * complete, verified, co-registered 16-species observation snapshot.
 *
 * This routine accepts no modelled values, upper limits, non-detections,
 * uncertain quality rows, duplicate species rows, or absent species.
 */
export function createMarsPhotochemicalObservationSnapshot(
  input: MarsPhotochemicalObservationSnapshotInput
): MarsPhotochemicalObservationSnapshotResult {
  const errors: string[] = [];
  if (!isPlainRecord(input)) {
    return { status: 'rejected', errors: ['input must be a plain object'] };
  }
  if (typeof input.reservoirId !== 'string' || input.reservoirId.trim() === '') {
    errors.push('reservoirId must be a non-empty string');
  }
  if (input.targetAltitudeKm !== 0.5 && input.targetAltitudeKm !== 42.67) {
    errors.push('targetAltitudeKm must be exactly 0.5 or 42.67 km');
  }
  if (!Array.isArray(input.observations)) {
    errors.push('observations must be an array of species detections');
  }
  if (input.observations.length !== MARS_PHOTOCHEMICAL_SPECIES_ORDER.length) {
    errors.push('exactly 16 species observations are required; received ' + input.observations.length);
  }
  errors.push(...validateCoRegistrationPolicy(input.coRegistration));

  const temperature = input.temperatureObservation;
  if (!isPlainRecord(temperature)) {
    errors.push('temperatureObservation must be a plain object');
  } else {
    if (temperature.quality !== 'verified') {
      errors.push('temperatureObservation must have verified quality');
    }
    if (
      temperature.evidenceKind !== 'in_situ_detection' &&
      temperature.evidenceKind !== 'remote_sensing_detection'
    ) {
      errors.push('temperatureObservation must be a measured temperature detection, not a modelled value or bound');
    }
    if (!hasUsableTemperature(temperature.temperature)) {
      errors.push('temperatureObservation.temperature must be a usable known/estimated temperature in K');
    }
    if (!hasIdentifiedProvenance(temperature.provenance)) {
      errors.push('temperatureObservation.provenance must identify its source');
    }
  }

  if (!Array.isArray(input.observations) || !isPlainRecord(temperature)) {
    return { status: 'rejected', errors };
  }
  const anchor = temperature.context;
  errors.push(...validateContext(anchor, 'temperatureObservation.context', input.targetAltitudeKm));

  const seen = new Set<string>();
  const concentrations = {} as Record<MarsGasSpeciesId, number>;
  const inventoryMolM3: Record<string, number> = {};
  const sigmaEntries: string[] = [];
  const sourceIds: string[] = [];

  for (let index = 0; index < input.observations.length; index += 1) {
    const observation = input.observations[index];
    const label = 'observations[' + index + ']';
    if (!isPlainRecord(observation)) {
      errors.push(label + ' must be a plain object');
      continue;
    }
    const species = observation.speciesId as string;
    if (!MARS_PHOTOCHEMICAL_SPECIES_ORDER.includes(species as MarsGasSpeciesId)) {
      errors.push(label + '.speciesId is not part of the 16-species ODE');
      continue;
    }
    if (seen.has(species)) {
      errors.push(label + ': duplicate species ' + species + '; averaging is not implicit');
      continue;
    }
    seen.add(species);

    if (observation.evidenceKind !== 'in_situ_detection' &&
        observation.evidenceKind !== 'remote_sensing_detection') {
      errors.push(label + ': ' + species + ' evidenceKind=' + String(observation.evidenceKind) +
        ' is not a detected point value; upper limits/model values cannot initialise the ODE');
    }
    if (observation.quality !== 'verified') {
      errors.push(label + ': ' + species + ' must have verified quality');
    }
    if (
      typeof observation.numberDensityPerCm3 !== 'number' ||
      !Number.isFinite(observation.numberDensityPerCm3) ||
      observation.numberDensityPerCm3 <= 0
    ) {
      errors.push(label + ': ' + species + ' numberDensityPerCm3 must be finite and positive');
    }
    if (
      observation.reportedSigmaPerCm3 !== null &&
      (typeof observation.reportedSigmaPerCm3 !== 'number' ||
        !Number.isFinite(observation.reportedSigmaPerCm3) ||
        observation.reportedSigmaPerCm3 < 0)
    ) {
      errors.push(label + ': ' + species + ' reportedSigmaPerCm3 must be non-negative or null (unknown)');
    }
    if (!hasIdentifiedProvenance(observation.provenance)) {
      errors.push(label + ': ' + species + ' requires source-identifying provenance');
    } else {
      sourceIds.push(
        observation.provenance.sourceId ??
        observation.provenance.datasetId ??
        observation.provenance.sourceName ??
        observation.provenance.reference ??
        species
      );
    }

    errors.push(...validateContext(observation.context, label + '.context', input.targetAltitudeKm));
    errors.push(...validateCoRegisteredContext(
      observation.context,
      anchor,
      input.coRegistration,
      label + '.context'
    ));

    if (
      Number.isFinite(observation.numberDensityPerCm3) &&
      observation.numberDensityPerCm3 > 0
    ) {
      concentrations[species as MarsGasSpeciesId] = observation.numberDensityPerCm3;
      const molarConcentration = observation.numberDensityPerCm3 *
        1e6 / MARS_PHOTOCHEMICAL_AVOGADRO_CONSTANT_MOL_INV;
      if (!Number.isFinite(molarConcentration) || molarConcentration <= 0) {
        errors.push(label + ': ' + species + ' number density is outside representable mol/m^3 range');
      } else {
        inventoryMolM3[species] = molarConcentration;
      }
    }
    sigmaEntries.push(species + '=' +
      (observation.reportedSigmaPerCm3 === null
        ? 'not_reported'
        : String(observation.reportedSigmaPerCm3)));
  }

  const missing = MARS_PHOTOCHEMICAL_SPECIES_ORDER.filter((species) => !seen.has(species));
  if (missing.length > 0) {
    errors.push('missing required species; no zero-fill is permitted: ' + missing.join(', '));
  }
  if (errors.length > 0) return { status: 'rejected', errors };

  const context = anchor;
  const sourceIdsUnique = [...new Set(sourceIds)].sort();
  const sourceProvenance: DataProvenance = {
    sourceName: 'Co-registered Mars photochemical initial-state observation snapshot',
    sourceId: 'evowars/mars/photochemical-observation-snapshot',
    method: 'No-fill assembly of one verified positive detection per ODE species; exact Table B2 altitude and caller-declared co-registration tolerances; no averaging or interpolation',
    rawInput: {
      eventId: context.eventId,
      timeUtc: context.timeUtc,
      marsYear: context.marsYear,
      solarLongitudeDeg: context.solarLongitudeDeg,
      altitudeKm: context.altitudeKm,
      latitudeDeg: context.latitudeDeg,
      longitudeDeg: context.longitudeDeg,
      localSolarTimeHours: context.localSolarTimeHours,
      solarZenithAngleDeg: context.solarZenithAngleDeg,
      sourceIds: sourceIdsUnique.join(';'),
      reportedSigmaPerCm3: sigmaEntries.sort().join(';'),
      maximumTimeSeparationSeconds: input.coRegistration.maximumTimeSeparationSeconds,
      maximumLatitudeSeparationDeg: input.coRegistration.maximumLatitudeSeparationDeg,
      maximumLongitudeSeparationDeg: input.coRegistration.maximumLongitudeSeparationDeg,
      maximumLocalSolarTimeSeparationHours: input.coRegistration.maximumLocalSolarTimeSeparationHours,
      maximumSolarZenithAngleSeparationDeg: input.coRegistration.maximumSolarZenithAngleSeparationDeg,
      maximumSolarLongitudeSeparationDeg: input.coRegistration.maximumSolarLongitudeSeparationDeg,
      maximumPhotolysisSzaOffsetDeg: input.coRegistration.maximumPhotolysisSzaOffsetDeg,
      maximumPhotolysisSolarLongitudeOffsetDeg: input.coRegistration.maximumPhotolysisSolarLongitudeOffsetDeg,
      coRegistrationPolicySource:
        input.coRegistration.provenance.sourceId ??
        input.coRegistration.provenance.datasetId ??
        input.coRegistration.provenance.sourceName ??
        input.coRegistration.provenance.reference ??
        'identified co-registration method'
    },
    applicability: 'One local measured snapshot at the exact Taysum Table B2 altitude node under SZA=0 deg and Ls=251 deg; not a global or vertical profile',
    limitations: [
      'All 16 species must be direct verified detections; this builder does not infer hidden species from bulk VMRs, elemental closure, chemical steady state, model ranges or upper limits.',
      'Null reported sigma means the source did not provide a usable per-species 1-sigma value; it is not treated as zero uncertainty.',
      'The Table B2 lookup also depends on temperature, O3/total column abundance, Sun-Mars distance and dust/optical opacity; those inputs are not reconstructed by this snapshot builder.',
      'A matched SZA/Ls/altitude does not prove that observations from different instruments share unresolved calibration or retrieval-systematic errors.',
      'The ODE remains a one-compartment model without vertical transport or surface exchange.'
    ].join('; ')
  };

  let reservoir = createReservoir(
    input.reservoirId,
    'mars_photochemical_compartment',
    { note: 'Initial compartment created only from a complete co-registered verified observation snapshot' }
  );
  reservoir = setMaterialInventory(reservoir, 'molar_concentration', inventoryMolM3);
  reservoir = {
    ...reservoir,
    materialProvenance: sourceProvenance,
    reservoirTemperature: temperature.temperature
  };
  const inventoryCheck = validateMaterialInventory(reservoir.material);
  if (!inventoryCheck.valid) {
    return {
      status: 'rejected',
      errors: ['constructed observation inventory failed validation: ' + inventoryCheck.errors.join('; ')]
    };
  }

  return {
    status: 'completed',
    reservoir,
    initialConcentrationsPerCm3: concentrations as MarsPhotochemicalInitialConcentrations,
    context,
    observedSpecies: [...MARS_PHOTOCHEMICAL_SPECIES_ORDER],
    sourceIds: sourceIdsUnique,
    diagnostics: [
      'One positive verified detection was accepted for each of the 16 ODE species; no fill, average or interpolation was applied.',
      'Per-species 1-sigma values are preserved in materialProvenance.rawInput; missing sigma remains explicitly not_reported.',
      'Co-registration tolerances and their source are preserved in provenance and must be justified for the selected instruments.',
      'Taysum photolysis conditions checked: SZA=0 deg, Ls=251 deg, exact altitude node=' + context.altitudeKm + ' km.'
    ]
  };
}

export default {
  MARS_PHOTOCHEMICAL_AVOGADRO_CONSTANT_MOL_INV,
  assessMarsPhotochemicalEvidenceReadiness,
  createMarsPhotochemicalObservationSnapshot
};
