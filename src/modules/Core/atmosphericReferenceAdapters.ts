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
  computeHydrostaticColumn
} from './hydrostaticAtmosphere';
import type {
  HydrostaticColumnInput,
  HydrostaticColumnResult
} from './hydrostaticAtmosphere';

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
