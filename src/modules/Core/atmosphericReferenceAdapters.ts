// ============================================
// ATMOSPHERIC REFERENCE ADAPTERS — Stage 4.2
// ============================================
//
// Explicit bridge from audited atmospheric reference datasets to the
// Core temperature-profile contract. This is reference data, not an
// assertion that an arbitrary generated terrestrial world has Earth's
// atmosphere or gravity.
//
// USSA 1976 provides layer bounds and lapse rates in geopotential height.
// Kinetic layers are isothermal, so each USSA layer is represented by its
// temperature at the geopotential midpoint. The source model, midpoint
// approximation, and finite coverage limit remain explicit in provenance.

import type { AtmosphericTemperatureProfile } from './thermalState';
import { estimatedValue } from './scientificValue';
import type { DataProvenance } from './scientificValue';
import { quantity } from './physicalQuantity';
import {
  geopotentialToGeometricM,
  USSA_1976_CONSTANTS,
  USSA_1976_DRY_AIR_COMPOSITION,
  USSA_1976_EQUIVALENT_BODY_MASS_KG,
  USSA_1976_LAYERS,
  USSA_1976_PROVENANCE
} from '../Data/atmosphericReferenceProfiles';
import {
  computeAdaptivelyRefinedHydrostaticColumn,
  computeHydrostaticColumn
} from './hydrostaticAtmosphere';
import type {
  AdaptiveHydrostaticColumnResult,
  GasMoleFraction,
  HydrostaticColumnInput,
  HydrostaticColumnResult,
  HydrostaticRefinementPolicy
} from './hydrostaticAtmosphere';
import {
  MGS_MARS_8028D38A_METADATA,
  MGS_MARS_8028D38A_PROVENANCE,
  MGS_MARS_8028D38A_SAMPLES
} from '../Data/mgsMarsOccultation1998';

export const USSA_1976_REFERENCE_PROFILE_ID = 'ussa_1976_earth' as const;

export const USSA_1976_THERMAL_PROFILE_PROVENANCE: DataProvenance = {
  ...USSA_1976_PROVENANCE,
  datasetId: 'ussa-1976-main-layers',
  datasetVersion: '1976',
  reference: 'NASA TM-X-74335',
  method: 'USSA 1976 published lapse-rate layers; representative temperature evaluated at each geopotential midpoint',
  limitations:
    'Earth standard-atmosphere reference only; seven layers cover 0–86 km geometric altitude. Each kinetic-layer temperature is an isothermal midpoint approximation; gradients within a layer, ozone detail, water vapour variability, thermosphere, exosphere and atmospheric chemistry are not represented.'
};

/**
 * Build the audited seven-layer USSA 1976 reference temperature profile.
 *
 * Temperatures are not copied from the bottom boundary: each one is
 * evaluated at the midpoint of its source geopotential interval using
 * the published signed lapse rate. Altitude bounds are the source's
 * geometric-height equivalents. The output is partial_profile because
 * USSA 1976 does not cover the full atmosphere.
 */
export function createUssa1976AtmosphericTemperatureProfile(): AtmosphericTemperatureProfile {
  const layers = USSA_1976_LAYERS.map((sourceLayer) => {
    const geopotentialMidpointM =
      (sourceLayer.geopotentialBottomM + sourceLayer.geopotentialTopM) / 2;
    const temperatureK =
      sourceLayer.baseTemperatureK +
      (sourceLayer.lapseRateKPerKm *
        (geopotentialMidpointM - sourceLayer.geopotentialBottomM)) /
        1000;
    const layerProvenance: DataProvenance = {
      ...USSA_1976_THERMAL_PROFILE_PROVENANCE,
      recordId: 'layer-' + sourceLayer.layerIndex,
      rawInput: {
        geopotentialBottomM: sourceLayer.geopotentialBottomM,
        geopotentialTopM: sourceLayer.geopotentialTopM,
        geometricBottomM: sourceLayer.geometricBottomM,
        geometricTopM: sourceLayer.geometricTopM,
        baseTemperatureK: sourceLayer.baseTemperatureK,
        lapseRateKPerKm: sourceLayer.lapseRateKPerKm,
        representativeGeopotentialMidpointM: geopotentialMidpointM,
        representativeTemperatureK: temperatureK
      }
    };
    return {
      layerId: 'ussa-1976-layer-' + sourceLayer.layerIndex,
      altitudeRangeM: {
        min: sourceLayer.geometricBottomM,
        max: sourceLayer.geometricTopM
      },
      temperature: estimatedValue(
        quantity(temperatureK, 'K'),
        'USSA 1976 lapse-rate law evaluated at the geopotential midpoint; used as an isothermal kinetic-layer representative value',
        { provenance: layerProvenance }
      ),
      note:
        'USSA 1976 reference layer ' + sourceLayer.layerIndex +
        '; midpoint temperature is an isothermal approximation, not a layer-mean observation'
    };
  });

  return {
    status: 'partial_profile',
    layers,
    provenance: { ...USSA_1976_THERMAL_PROFILE_PROVENANCE },
    limitations: USSA_1976_THERMAL_PROFILE_PROVENANCE.limitations,
    note:
      'Явно выбранный reference-профиль USSA 1976. Он не подменяет атмосферу случайно сгенерированного мира; переносит только исходные высоты/температуры и требует отдельной проверки совместимости с телом.'
  };
}


// ============================================
// USSA 1976 → HYDROSTATIC COLUMN (Stage 4.8.1)
// ============================================

/**
 * Build the canonical Earth-reference input for the existing Radau IIA
 * hydrostatic solver. This is deliberately NOT populated from a random
 * GeneratedWorld: USSA 1976 is paired with its own reference radius,
 * equivalent mass (g(r0)=g0), sea-level pressure and dry-air composition.
 *
 * Unlike the kinetic midpoint profile above, this path preserves the
 * original USSA temperature law exactly: T is linear in geopotential
 * height h, while the solver integrates in geometric z using h=R*z/(R+z).
 * Mid-layer geometric heights are requested so pressure and composition
 * can be attached to the corresponding Scheduler layer.
 */
export function createUssa1976HydrostaticColumnInput(): HydrostaticColumnInput {
  const referenceRadiusM = USSA_1976_CONSTANTS.r0M;
  const layers = USSA_1976_LAYERS.map((sourceLayer) => ({
    layerId: 'ussa-1976-layer-' + sourceLayer.layerIndex,
    bottomHeightM: sourceLayer.geometricBottomM,
    topHeightM: sourceLayer.geometricTopM,
    temperature: {
      kind: 'geopotentialLapseRate' as const,
      referenceRadiusM,
      bottomGeopotentialHeightM: sourceLayer.geopotentialBottomM,
      bottomTemperatureK: sourceLayer.baseTemperatureK,
      lapseRateKPerM: sourceLayer.lapseRateKPerKm / 1000
    },
    composition: {
      gases: USSA_1976_DRY_AIR_COMPOSITION.gases.map((gas) => ({ ...gas })),
      provenance: { ...USSA_1976_DRY_AIR_COMPOSITION.provenance }
    },
    provenance: { ...USSA_1976_PROVENANCE },
    applicability:
      'USSA 1976 dry-air reference composition; no water vapour, ozone stratification, diffusion or chemistry'
  }));

  const requestedHeightsM = USSA_1976_LAYERS.map((sourceLayer) => {
    const geopotentialMidpointM =
      (sourceLayer.geopotentialBottomM + sourceLayer.geopotentialTopM) / 2;
    return geopotentialToGeometricM(geopotentialMidpointM);
  });

  return {
    body: {
      bodyMassKg: USSA_1976_EQUIVALENT_BODY_MASS_KG,
      referenceRadiusM,
      provenance: {
        ...USSA_1976_PROVENANCE,
        method: 'equivalent spherical mass M = g0*r0^2/G; constructed to reproduce USSA g(h)',
        note: 'canonical Earth reference constants; not read from a generated world'
      }
    },
    surface: {
      surfacePressurePa: 101325,
      pressureProvenance: {
        ...USSA_1976_PROVENANCE,
        method: 'USSA 1976 standard sea-level pressure p0 = 101325 Pa'
      },
      bottomHeightM: 0
    },
    layers,
    requestedHeightsM,
    numerics: { gravitationMode: 'spherical-gravity' }
  };
}

/** Run the canonical USSA 1976 Earth reference through Core's hydrostatic solver. */
export function computeUssa1976ReferenceHydrostaticColumn(): HydrostaticColumnResult {
  return computeHydrostaticColumn(createUssa1976HydrostaticColumnInput());
}


/**
 * Canonical seven-layer USSA Earth reference with adaptive sublayers.
 * The helper returns the refined input and the freshly re-integrated
 * column; its child layer ids retain parentLayerId lineage to the 7 source
 * layers so the Scheduler adapter can project provenance and inventories.
 */
export function computeAdaptivelyRefinedUssa1976ReferenceHydrostaticColumn(
  policy?: HydrostaticRefinementPolicy
): AdaptiveHydrostaticColumnResult {
  return computeAdaptivelyRefinedHydrostaticColumn(
    createUssa1976HydrostaticColumnInput(),
    policy
  );
}


// ============================================
// MGS MARS OCCULTATION → HYDROSTATIC COLUMN (Stage 4.2)
// ============================================

/**
 * A caller-supplied atmosphere composition for the MGS occultation
 * reference. Composition is intentionally mandatory: PDS documents that
 * the retrieval used a Viking-era composition assumption, but this product
 * file does not provide a complete per-row gas-mixture table.
 */
export interface MgsMarsOccultationComposition {
  readonly gases: readonly GasMoleFraction[];
  readonly provenance: DataProvenance;
}

/** Mars mass used by the spherical Core approximation. */
export const MGS_MARS_REFERENCE_BODY_MASS_KG = 0.64169e24;

export const MGS_MARS_REFERENCE_BODY_MASS_PROVENANCE: DataProvenance = {
  sourceName: 'NASA NSSDC Mars Planetary Fact Sheet',
  sourceId: 'Mars bulk mass',
  reference: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html',
  method: 'published planetary mass, used as a spherical-body approximation',
  limitations:
    'The MGS retrieval used a spherical-harmonic gravity field (GGM50A02.SHA). Core hydrostatic integration below uses spherical gravity from the published bulk mass and the occultation local radius; the two gravity models are not identical.'
};

/**
 * Construct a hydrostatic-column input from the actual 8028D38A MGS
 * radio-occultation P/T samples.
 *
 * Important semantics:
 * - The bottom boundary is the FIRST measured PDS row (~250 m above the
 *   local radius-at-surface), not the PDS header's extrapolated surface
 *   pressure. This avoids treating a retrieval extrapolation as a direct
 *   observation.
 * - Every published temperature sample is passed as a measured node.
 *   Linear interpolation is the explicit Core solver policy.
 * - The caller must supply a normalized, identified composition. No
 *   composition or trace gas is invented from this profile.
 * - PDS sigma_P and sigma_T are retained in the source data but are
 *   NOT propagated by the deterministic hydrostatic solver.
 * - The output is a reference-column reconstruction with spherical
 *   gravity, not an exact reproduction of the MGS gravity retrieval or a
 *   general Mars atmosphere.
 */
export function createMgsMars8028D38AHydrostaticColumnInput(
  composition: MgsMarsOccultationComposition
): HydrostaticColumnInput {
  if (!composition || typeof composition !== 'object' || !Array.isArray(composition.gases)) {
    throw new TypeError('MGS Mars adapter: явный состав атмосферы обязателен');
  }
  if (composition.gases.length === 0) {
    throw new RangeError('MGS Mars adapter: состав атмосферы не может быть пустым');
  }
  const sourceIdentity = [
    composition.provenance?.sourceName,
    composition.provenance?.sourceId,
    composition.provenance?.datasetId,
    composition.provenance?.reference
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
  if (!sourceIdentity) {
    throw new RangeError('MGS Mars adapter: для состава требуется provenance (источник/набор/ссылка)');
  }

  const seenGasIds = new Set<string>();
  let moleFractionSum = 0;
  for (const gas of composition.gases) {
    if (!gas || typeof gas.gasId !== 'string' || gas.gasId.trim() === '') {
      throw new RangeError('MGS Mars adapter: каждая доля состава должна иметь непустой gasId');
    }
    if (seenGasIds.has(gas.gasId)) {
      throw new RangeError('MGS Mars adapter: повторяющийся gasId «' + gas.gasId + '»');
    }
    seenGasIds.add(gas.gasId);
    if (!Number.isFinite(gas.moleFraction) || gas.moleFraction <= 0) {
      throw new RangeError(
        'MGS Mars adapter: молярная доля «' + gas.gasId + '» должна быть конечной и положительной'
      );
    }
    moleFractionSum += gas.moleFraction;
  }
  if (!Number.isFinite(moleFractionSum) || Math.abs(moleFractionSum - 1) > 1e-6) {
    throw new RangeError(
      'MGS Mars adapter: сумма молярных долей состава должна быть 1 (получено ' +
        String(moleFractionSum) +
        '); автоматическая нормировка запрещена'
    );
  }

  const first = MGS_MARS_8028D38A_SAMPLES[0];
  const last = MGS_MARS_8028D38A_SAMPLES[MGS_MARS_8028D38A_SAMPLES.length - 1];
  if (first === undefined || last === undefined || MGS_MARS_8028D38A_SAMPLES.length !== MGS_MARS_8028D38A_METADATA.rowCount) {
    throw new Error('MGS Mars adapter: PDS profile is empty or its row count does not match the product label');
  }

  const nodeProvenance: DataProvenance = {
    ...MGS_MARS_8028D38A_PROVENANCE,
    recordId: 'rows-1-' + String(MGS_MARS_8028D38A_METADATA.rowCount),
    method: 'PDS retrieved temperature nodes; Core uses piecewise-linear interpolation between the published samples'
  };

  return {
    body: {
      bodyMassKg: MGS_MARS_REFERENCE_BODY_MASS_KG,
      referenceRadiusM: MGS_MARS_8028D38A_METADATA.radiusAtSurfaceM,
      provenance: {
        ...MGS_MARS_REFERENCE_BODY_MASS_PROVENANCE,
        note:
          'Reference radius is the local radius-at-surface from PDS product ' +
          MGS_MARS_8028D38A_METADATA.productId +
          '; spherical gravity is a Core approximation, not GGM50A02.'
      }
    },
    surface: {
      surfacePressurePa: first.pressurePa,
      pressureProvenance: {
        ...MGS_MARS_8028D38A_PROVENANCE,
        recordId: 'row-' + String(first.rowNumber),
        method: 'first measured PDS pressure sample; not the PDS header surface-pressure extrapolation',
        rawInput: {
          productId: MGS_MARS_8028D38A_METADATA.productId,
          rowNumber: first.rowNumber,
          measuredRadiusM: first.radiusM,
          localSurfaceRadiusM: MGS_MARS_8028D38A_METADATA.radiusAtSurfaceM,
          measuredPressurePa: first.pressurePa,
          measuredPressureSigmaPa: first.pressureSigmaPa,
          pdsHeaderExtrapolatedSurfacePressurePa:
            MGS_MARS_8028D38A_METADATA.extrapolatedSurfacePressurePa
        }
      },
      bottomHeightM: first.heightAboveLocalSurfaceM
    },
    layers: [
      {
        layerId: MGS_MARS_8028D38A_METADATA.profileId,
        bottomHeightM: first.heightAboveLocalSurfaceM,
        topHeightM: last.heightAboveLocalSurfaceM,
        temperature: {
          kind: 'measuredNodes',
          nodes: MGS_MARS_8028D38A_SAMPLES.map((sample) => ({
            heightM: sample.heightAboveLocalSurfaceM,
            temperatureK: sample.temperatureK
          })),
          interpolation: 'linear'
        },
        composition: {
          gases: composition.gases.map((gas) => ({ ...gas })),
          provenance: { ...composition.provenance }
        },
        provenance: nodeProvenance,
        applicability:
          'One MGS radio-occultation retrieval only; explicit caller-provided composition; 0.25–35.26 km above the local radius-at-surface; not a global Mars climatology. PDS sigma_P/sigma_T are preserved in source data but not propagated by Core.'
      }
    ],
    requestedHeightsM: MGS_MARS_8028D38A_SAMPLES.map((sample) => sample.heightAboveLocalSurfaceM),
    numerics: { gravitationMode: 'spherical-gravity' }
  };
}
