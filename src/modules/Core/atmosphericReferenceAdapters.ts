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
  USSA_1976_LAYERS,
  USSA_1976_PROVENANCE
} from '../Data/atmosphericReferenceProfiles';

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
