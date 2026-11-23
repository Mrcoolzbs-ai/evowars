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

  const profileProvenance = profile.provenance;
  if (profileProvenance === undefined || !hasIdentifiedSource(profileProvenance)) {
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

    const temperatureScientificValue = layer.temperature;
    if (
      temperatureScientificValue.status !== 'known' &&
      temperatureScientificValue.status !== 'estimated'
    ) {
      return reject(
        'Импорт отклонён: температура ' + prefix +
        ' не имеет числового статуса known/estimated.'
      );
    }
    const temperature = temperatureValueOrNull(temperatureScientificValue);
    if (temperature === null || !Number.isFinite(temperature) || temperature <= 0) {
      return reject(
        'Импорт отклонён: температура ' + prefix +
        ' не является пригодной положительной температурой в K со статусом known/estimated.'
      );
    }

    // Preserve the profile-level source while allowing a layer-specific
    // measurement/model record to override any supplied fields.
    const temperatureProvenance: DataProvenance = {
      ...profileProvenance,
      ...(temperatureScientificValue.provenance ?? {})
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
      altitudeProvenance: { ...profileProvenance }
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

// ============================================
// SOURCED PROFILE → PHYSICAL SCHEDULER CONFIGURATION
// ============================================
// Geometry and temperature are imported from the sourced profile.
// Chemical inventories, global-column provenance, and reaction selection
// remain explicit caller inputs; this adapter never invents radicals,
// zero inventories, or a reaction network.

import type { ChemicalPhysicalKineticsState } from '../../types';

export interface SourcedKineticLayerInventoryInput {
  sourceLayerId: string;
  columnInventoriesMolM2: Readonly<Record<string, number>>;
  inventoryProvenance: DataProvenance;
  reactionIds: readonly string[];
}

export interface SourcedProfileSchedulerConfigurationInput {
  maximumMacroStepS: number;
  totalInventoryProvenance: Readonly<Record<string, DataProvenance>>;
  /** Exactly one explicit inventory/reaction selection for every profile layer. */
  layers: readonly SourcedKineticLayerInventoryInput[];
}

export type SourcedProfileSchedulerConfigurationResult =
  | {
      status: 'configured';
      configuration: ChemicalPhysicalKineticsState;
      diagnostics: readonly string[];
    }
  | {
      status: 'rejected';
      diagnostics: readonly string[];
    };

function isPlainSourcedRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Build a Scheduler-ready geometry/temperature configuration from a
 * provenance-backed vertical profile plus explicit per-layer chemistry.
 *
 * This function does not configure a world or infer total column amounts.
 * Pass the returned configuration and separately sourced total column
 * inventories to configurePrimaryPhysicalChemicalKinetics(). That second
 * gate checks species support, reaction applicability, subcolumn bounds,
 * third-body availability and atomic state consistency.
 */
export function buildPhysicalKineticsConfigurationFromSourcedProfile(
  profile: AtmosphericTemperatureProfile | null | undefined,
  input: SourcedProfileSchedulerConfigurationInput
): SourcedProfileSchedulerConfigurationResult {
  const diagnostics: string[] = [];
  const imported = importSourcedAtmosphericTemperatureProfileForKinetics(profile);
  if (imported.status !== 'imported') {
    return { status: 'rejected', diagnostics: [...imported.diagnostics] };
  }

  if (
    typeof input.maximumMacroStepS !== 'number' ||
    !Number.isFinite(input.maximumMacroStepS) ||
    input.maximumMacroStepS <= 0
  ) {
    diagnostics.push('maximumMacroStepS должен быть конечным положительным числом секунд');
  }
  if (!isPlainSourcedRecord(input.totalInventoryProvenance)) {
    diagnostics.push('totalInventoryProvenance должен быть plain record с отдельным provenance полного запаса каждого вида');
  }
  if (!Array.isArray(input.layers)) {
    diagnostics.push('layers должен быть массивом явных подстолбовых инвентарей');
  }
  if (diagnostics.length > 0) {
    return { status: 'rejected', diagnostics };
  }

  const expectedIds = imported.layers.map((layer) => layer.sourceLayerId);
  const suppliedById = new Map<string, SourcedKineticLayerInventoryInput>();
  for (const [index, layer] of input.layers.entries()) {
    if (!isPlainSourcedRecord(layer)) {
      diagnostics.push('layers[' + index + '] должен быть plain record');
      continue;
    }
    if (typeof layer.sourceLayerId !== 'string' || layer.sourceLayerId.trim() === '') {
      diagnostics.push('layers[' + index + '].sourceLayerId должен быть непустой строкой');
      continue;
    }
    if (suppliedById.has(layer.sourceLayerId)) {
      diagnostics.push('дублирующийся явный inventory для profile layer «' + layer.sourceLayerId + '»');
      continue;
    }
    suppliedById.set(layer.sourceLayerId, layer);
  }

  for (const expectedId of expectedIds) {
    if (!suppliedById.has(expectedId)) {
      diagnostics.push('для profile layer «' + expectedId + '» отсутствует явный подстолбовой inventory и выбор реакций');
    }
  }
  for (const suppliedId of suppliedById.keys()) {
    if (!expectedIds.includes(suppliedId)) {
      diagnostics.push('inventory указан для отсутствующего profile layer «' + suppliedId + '»');
    }
  }

  const configurationLayers: ChemicalPhysicalKineticsState['layers'] = [];
  for (const seed of imported.layers) {
    const supplied = suppliedById.get(seed.sourceLayerId);
    if (supplied === undefined) continue;
    const prefix = 'profile layer «' + seed.sourceLayerId + '»';

    if (!isPlainSourcedRecord(supplied.columnInventoriesMolM2)) {
      diagnostics.push(prefix + ': columnInventoriesMolM2 должен быть plain record; отсутствие вида не означает ноль');
      continue;
    }
    if (
      typeof supplied.inventoryProvenance !== 'object' ||
      supplied.inventoryProvenance === null ||
      !hasIdentifiedSource(supplied.inventoryProvenance)
    ) {
      diagnostics.push(prefix + ': отсутствует идентифицируемый provenance подстолбового состава');
    }
    if (!Array.isArray(supplied.reactionIds) || supplied.reactionIds.length === 0) {
      diagnostics.push(prefix + ': reactionIds должен быть непустым явным списком поддерживаемых реакций');
    } else {
      const seen = new Set<string>();
      for (const reactionId of supplied.reactionIds) {
        if (typeof reactionId !== 'string' || reactionId.trim() === '') {
          diagnostics.push(prefix + ': reactionIds содержит пустой или нестроковый ID');
        } else if (seen.has(reactionId)) {
          diagnostics.push(prefix + ': дублирующийся reactionId «' + reactionId + '»');
        } else {
          seen.add(reactionId);
        }
      }
    }

    const inventories: Record<string, number> = {};
    for (const [speciesId, amount] of Object.entries(supplied.columnInventoriesMolM2)) {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        diagnostics.push(prefix + ': запас «' + speciesId + '» должен быть конечным неотрицательным числом моль/м²; неизвестный запас не равен нулю');
      } else {
        inventories[speciesId] = amount;
      }
      const totalProvenance = (input.totalInventoryProvenance as Readonly<Record<string, DataProvenance>>)[speciesId];
      if (
        totalProvenance === undefined ||
        typeof totalProvenance !== 'object' ||
        totalProvenance === null ||
        !hasIdentifiedSource(totalProvenance)
      ) {
        diagnostics.push(prefix + ': отсутствует provenance полного атмосферного запаса вида «' + speciesId + '»');
      }
    }

    configurationLayers.push({
      layerId: seed.sourceLayerId,
      altitudeRangeM: {
        min: seed.bottomAltitudeM,
        max: seed.topAltitudeM
      },
      altitudeProvenance: { ...seed.altitudeProvenance },
      layerThicknessM: seed.topAltitudeM - seed.bottomAltitudeM,
      thicknessProvenance: { ...seed.altitudeProvenance },
      temperatureK: seed.temperatureK,
      temperatureProvenance: { ...seed.temperatureProvenance },
      columnInventoriesMolM2: inventories,
      inventoryProvenance:
        isPlainSourcedRecord(supplied.inventoryProvenance)
          ? { ...supplied.inventoryProvenance } as DataProvenance
          : {},
      reactionIds: Array.isArray(supplied.reactionIds)
        ? [...supplied.reactionIds]
        : []
    });
  }

  if (diagnostics.length > 0) {
    return { status: 'rejected', diagnostics };
  }

  const totalProvenance: Record<string, DataProvenance> = {};
  for (const [speciesId, provenance] of Object.entries(input.totalInventoryProvenance)) {
    if (
      typeof provenance !== 'object' ||
      provenance === null ||
      !hasIdentifiedSource(provenance)
    ) {
      diagnostics.push('totalInventoryProvenance[«' + speciesId + '»] не идентифицирует источник');
      continue;
    }
    totalProvenance[speciesId] = { ...provenance };
  }
  if (diagnostics.length > 0) {
    return { status: 'rejected', diagnostics };
  }

  return {
    status: 'configured',
    configuration: {
      maximumMacroStepS: input.maximumMacroStepS,
      totalInventoryProvenance: totalProvenance,
      layers: configurationLayers
    },
    diagnostics: [
      'Геометрия и температурные представители импортированы из source-backed profile; подстолбовые и полные запасы, provenance запасов и reactionIds переданы явно. Финальная физическая валидация выполняется configurePrimaryPhysicalChemicalKinetics().'
    ]
  };
}

