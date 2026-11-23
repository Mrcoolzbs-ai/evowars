// ============================================
// THERMAL PROFILE IMPORT - Stage 4.2
// ============================================
//
// Pure adapter from a sourced Core atmospheric temperature profile to
// explicit kinetic-layer geometry/temperature drafts. It deliberately
// does NOT provide reaction selections, species inventories, or rates.
//
// A single_layer_estimate is not a vertical profile. Unknown upper
// altitude bounds are not replaced with scale heights or extrapolation.

import type {
  AtmosphericTemperatureProfile,
  AtmosphereTemperatureLayer
} from '../Core/thermalState';
import {
  temperatureValueOrNull,
  validateAtmosphericTemperatureProfile
} from '../Core/thermalState';
import type { DataProvenance } from '../Core/scientificValue';

export interface ThermalProfileKineticLayerSeed {
  sourceLayerId: string;
  temperatureK: number;
  bottomAltitudeM: number;
  topAltitudeM: number;
  temperatureProvenance: DataProvenance;
  altitudeProvenance: DataProvenance;
}

export type ThermalProfileKineticImportResult =
  | {
      status: 'imported';
      layers: readonly ThermalProfileKineticLayerSeed[];
      diagnostics: readonly string[];
    }
  | {
      status: 'rejected';
      layers: readonly [];
      diagnostics: readonly string[];
    };

function provenanceReference(provenance: DataProvenance): string | undefined {
  return provenance.reference ??
    provenance.sourceId ??
    provenance.datasetId ??
    provenance.recordId;
}

function hasIdentifiedSource(provenance: DataProvenance): boolean {
  return typeof provenance.sourceName === 'string' &&
    provenance.sourceName.trim() !== '' &&
    typeof provenanceReference(provenance) === 'string' &&
    provenanceReference(provenance)!.trim() !== '';
}

function reject(...diagnostics: string[]): ThermalProfileKineticImportResult {
  return { status: 'rejected', layers: [], diagnostics };
}

/**
 * Import ONLY an existing partial/complete vertical profile with finite
 * altitude bounds and identifiable sources. Any missing physical input
 * rejects the whole import; no partial or inferred layers are returned.
 */
export function importSourcedAtmosphericTemperatureProfileForKinetics(
  profile: AtmosphericTemperatureProfile | null | undefined
): ThermalProfileKineticImportResult {
  if (profile === null || profile === undefined) {
    return reject(
      'CoreWorldState не содержит atmosphericTemperatureProfile; вертикальный профиль не создаётся из поверхностной температуры.'
    );
  }
  if (profile.status !== 'partial_profile' && profile.status !== 'complete_profile') {
    return reject(
      'Импорт отклонён: статус профиля «' + profile.status +
      '» не является вертикальным профилем; single_layer_estimate нельзя размножать на несколько слоёв.'
    );
  }

  const profileIssues = validateAtmosphericTemperatureProfile(profile);
  if (profileIssues.length > 0) {
    return reject('Профиль температур не прошёл валидацию: ' + profileIssues.join('; '));
  }

  if (profile.provenance === undefined || !hasIdentifiedSource(profile.provenance)) {
    return reject(
      'У вертикального профиля отсутствует идентифицируемый provenance высотных данных (sourceName + reference/ID).'
    );
  }

  const seeds: ThermalProfileKineticLayerSeed[] = [];
  const ranges: Array<{ layerId: string; min: number; max: number }> = [];

  for (let index = 0; index < profile.layers.length; index++) {
    const layer: AtmosphereTemperatureLayer = profile.layers[index]!;
    const prefix = 'слой «' + layer.layerId + '»';

    const range = layer.altitudeRangeM;
    if (
      range === undefined ||
      typeof range.min !== 'number' ||
      !Number.isFinite(range.min) ||
      range.min < 0 ||
      typeof range.max !== 'number' ||
      !Number.isFinite(range.max) ||
      range.max <= range.min
    ) {
      return reject(
        'Импорт отклонён: ' + prefix +
        ' не имеет конечных нижней и верхней высот; неизвестная верхняя граница не заменяется масштабной высотой.'
      );
    }

    const temperature = temperatureValueOrNull(layer.temperature);
    if (temperature === null || !Number.isFinite(temperature) || temperature <= 0) {
      return reject(
        'Импорт отклонён: температура ' + prefix +
        ' не является пригодной положительной температурой в K со статусом known/estimated.'
      );
    }

    // Preserve the profile-level source while allowing a layer-specific
    // measurement/model record to override any supplied fields.
    const temperatureProvenance: DataProvenance = {
      ...profile.provenance,
      ...(layer.temperature.provenance ?? {})
    };
    if (!hasIdentifiedSource(temperatureProvenance)) {
      return reject(
        'Импорт отклонён: для температуры ' + prefix +
        ' отсутствует идентифицируемый provenance.'
      );
    }

    ranges.push({ layerId: layer.layerId, min: range.min, max: range.max });
    seeds.push({
      sourceLayerId: layer.layerId,
      temperatureK: temperature,
      bottomAltitudeM: range.min,
      topAltitudeM: range.max,
      temperatureProvenance,
      altitudeProvenance: { ...profile.provenance }
    });
  }

  const sortedRanges = [...ranges].sort((a, b) =>
    a.min - b.min || a.max - b.max || a.layerId.localeCompare(b.layerId)
  );
  for (let index = 1; index < sortedRanges.length; index++) {
    const previous = sortedRanges[index - 1]!;
    const current = sortedRanges[index]!;
    if (current.min < previous.max) {
      return reject(
        'Импорт отклонён: высотные интервалы слоёв «' + previous.layerId +
        '» и «' + current.layerId + '» перекрываются (' +
        current.min + ' м < ' + previous.max + ' м).'
      );
    }
  }

  return {
    status: 'imported',
    layers: seeds,
    diagnostics: [
      'Импортированы только явно определённые температуры и конечные высотные интервалы из ' +
      profile.status + '; реакции, толщины как независимые данные, запасы веществ и скорости не выведены.'
    ]
  };
}
