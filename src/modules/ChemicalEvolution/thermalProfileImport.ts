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
import type { HydrostaticColumnCompleted, HydrostaticProfilePoint } from '../Core/hydrostaticAtmosphere';
import { AVOGADRO_NUMBER_PER_MOL } from '../Core/kinetics';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';

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
  /** Optional completed 4.8.1 column aligned to source layers or their refined child layers. */
  hydrostaticColumn?: HydrostaticColumnCompleted;
  /** Maximum allowed midpoint-vs-layer-average N2 number-density mismatch (fraction). Default: 0.02. */
  maximumHydrostaticThirdBodyRelativeDeviation?: number;
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

  const toleranceM = 1e-5;
  const maximumHydrostaticThirdBodyRelativeDeviation =
    input.maximumHydrostaticThirdBodyRelativeDeviation ?? 0.02;
  if (
    !Number.isFinite(maximumHydrostaticThirdBodyRelativeDeviation) ||
    maximumHydrostaticThirdBodyRelativeDeviation <= 0 ||
    maximumHydrostaticThirdBodyRelativeDeviation >= 1
  ) {
    diagnostics.push('maximumHydrostaticThirdBodyRelativeDeviation должен быть в диапазоне (0, 1)');
  }

  let effectiveSeeds: ThermalProfileKineticLayerSeed[] = [...imported.layers];
  const pendingHydrostaticById = new Map<string, {
    boundary: HydrostaticColumnCompleted['layerBoundaries'][number];
    representative: HydrostaticProfilePoint;
    fractions: Record<string, number>;
    sourceProvenance: DataProvenance;
    equationOfStateMaxRelativeDeviation: number;
  }>();

  if (input.hydrostaticColumn !== undefined) {
    const column = input.hydrostaticColumn;
    if (
      !Array.isArray(column.layerBoundaries) ||
      column.layerBoundaries.length === 0 ||
      !Array.isArray(column.requestedHeightPoints)
    ) {
      diagnostics.push('hydrostaticColumn должен содержать completed layerBoundaries и requestedHeightPoints');
    } else {
      const seedsById = new Map(imported.layers.map((seed) => [seed.sourceLayerId, seed]));
      const effective: ThermalProfileKineticLayerSeed[] = [];
      const childRangesByParent = new Map<string, Array<{ min: number; max: number; childId: string }>>();

      for (const boundary of column.layerBoundaries) {
        const parentId = boundary.parentLayerId ?? boundary.layerId;
        const sourceSeed = seedsById.get(parentId);
        if (sourceSeed === undefined) {
          diagnostics.push('hydrostaticColumn: child layer «' + boundary.layerId + '» не сопоставлен с исходным profile layer «' + parentId + '»');
          continue;
        }
        if (
          boundary.bottom.heightM < sourceSeed.bottomAltitudeM - toleranceM ||
          boundary.top.heightM > sourceSeed.topAltitudeM + toleranceM ||
          boundary.top.heightM <= boundary.bottom.heightM
        ) {
          diagnostics.push('hydrostaticColumn: границы child layer «' + boundary.layerId + '» выходят за исходный profile layer');
          continue;
        }
        const parentChildren = childRangesByParent.get(parentId) ?? [];
        parentChildren.push({
          min: boundary.bottom.heightM,
          max: boundary.top.heightM,
          childId: boundary.layerId
        });
        childRangesByParent.set(parentId, parentChildren);

        const interior = column.requestedHeightPoints.filter((point) =>
          point.layerId === boundary.layerId &&
          point.heightM > boundary.bottom.heightM + toleranceM &&
          point.heightM < boundary.top.heightM - toleranceM
        );
        if (interior.length !== 1) {
          diagnostics.push('hydrostaticColumn: для child layer «' + boundary.layerId + '» требуется ровно одна внутренняя representative-height точка; получено ' + interior.length);
          continue;
        }
        const representative = interior[0]!;
        const points = [boundary.bottom, representative, boundary.top];
        if (points.some((point) =>
          !Number.isFinite(point.pressurePa) || point.pressurePa <= 0 ||
          !Number.isFinite(point.temperatureK) || point.temperatureK <= 0 ||
          !Number.isFinite(point.densityKgPerM3) || point.densityKgPerM3 <= 0 ||
          !Number.isFinite(point.meanMolarMassKgPerMol) || point.meanMolarMassKgPerMol <= 0 ||
          !Number.isFinite(point.columnMolesPerM2) ||
          !Number.isFinite(point.columnMassKgPerM2)
        )) {
          diagnostics.push('hydrostaticColumn: child layer «' + boundary.layerId + '» содержит нечисловые или неположительные P/T/rho');
          continue;
        }
        if (
          boundary.bottom.pressurePa < representative.pressurePa ||
          representative.pressurePa < boundary.top.pressurePa ||
          boundary.top.columnMolesPerM2 <= boundary.bottom.columnMolesPerM2
        ) {
          diagnostics.push('hydrostaticColumn: давление должно убывать, а молярный столб возрастать в child layer «' + boundary.layerId + '»');
          continue;
        }

        const fractions = Object.fromEntries(
          representative.moleFractions.map((entry: HydrostaticProfilePoint['moleFractions'][number]) => [entry.gasId, entry.moleFraction])
        );
        const fractionValues = Object.values(fractions);
        const fractionSum = fractionValues.reduce((sum, value) => sum + value, 0);
        if (
          fractionValues.length === 0 ||
          fractionValues.some((value) => !Number.isFinite(value) || value <= 0) ||
          Math.abs(fractionSum - 1) > 1e-6
        ) {
          diagnostics.push('hydrostaticColumn: молярные доли child layer «' + boundary.layerId + '» не образуют нормированный bulk-состав');
          continue;
        }
        const sourceLayer = column.provenance.layers.find((entry) => entry.layerId === boundary.layerId);
        if (
          sourceLayer === undefined ||
          !hasIdentifiedSource(sourceLayer.provenance) ||
          !hasIdentifiedSource(column.provenance.surfacePressure)
        ) {
          diagnostics.push('hydrostaticColumn: отсутствует provenance давления или состава child layer «' + boundary.layerId + '»');
          continue;
        }

        let equationOfStateMaxRelativeDeviation = 0;
        for (const point of points) {
          const eosDensity =
            (point.pressurePa * point.meanMolarMassKgPerMol) /
            (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * point.temperatureK);
          const eosDeviation =
            Math.abs(eosDensity - point.densityKgPerM3) / Math.max(point.densityKgPerM3, Number.MIN_VALUE);
          equationOfStateMaxRelativeDeviation = Math.max(
            equationOfStateMaxRelativeDeviation,
            eosDeviation
          );
        }
        if (equationOfStateMaxRelativeDeviation > 1e-8) {
          diagnostics.push('hydrostaticColumn: EOS mismatch P*Mbar/(R*T) vs rho in child layer «' + boundary.layerId + '» (' + equationOfStateMaxRelativeDeviation + ')');
          continue;
        }

        pendingHydrostaticById.set(boundary.layerId, {
          boundary,
          representative,
          fractions,
          sourceProvenance: { ...sourceLayer.provenance },
          equationOfStateMaxRelativeDeviation
        });
        effective.push({
          sourceLayerId: boundary.layerId,
          temperatureK: representative.temperatureK,
          bottomAltitudeM: boundary.bottom.heightM,
          topAltitudeM: boundary.top.heightM,
          temperatureProvenance: {
            ...sourceSeed.temperatureProvenance,
            method: 'representative temperature evaluated by hydrostatic solver at ' + representative.heightM + ' m',
            note: 'T(z) preserved by the exact source temperature law; midpoint value used only as homogeneous kinetic-compartment representative'
          },
          altitudeProvenance: { ...sourceLayer.provenance }
        });
      }

      for (const sourceSeed of imported.layers) {
        const children = (childRangesByParent.get(sourceSeed.sourceLayerId) ?? [])
          .sort((a, b) => a.min - b.min);
        if (children.length === 0) {
          diagnostics.push('hydrostaticColumn: исходный слой «' + sourceSeed.sourceLayerId + '» не имеет дочерних гидростатических слоёв');
          continue;
        }
        if (Math.abs(children[0]!.min - sourceSeed.bottomAltitudeM) > toleranceM) {
          diagnostics.push('hydrostaticColumn: child layers не покрывают нижнюю границу исходного слоя «' + sourceSeed.sourceLayerId + '»');
        }
        if (Math.abs(children[children.length - 1]!.max - sourceSeed.topAltitudeM) > toleranceM) {
          diagnostics.push('hydrostaticColumn: child layers не покрывают верхнюю границу исходного слоя «' + sourceSeed.sourceLayerId + '»');
        }
        for (let index = 1; index < children.length; index++) {
          if (Math.abs(children[index]!.min - children[index - 1]!.max) > toleranceM) {
            diagnostics.push('hydrostaticColumn: child layers имеют разрыв или перекрытие внутри «' + sourceSeed.sourceLayerId + '»');
          }
        }
      }
      effectiveSeeds = effective;
    }
  }

  const expectedIds = effectiveSeeds.map((layer) => layer.sourceLayerId);

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
  for (const seed of effectiveSeeds) {
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

    const pendingHydrostatic = pendingHydrostaticById.get(seed.sourceLayerId);
    let hydrostaticState:
      NonNullable<ChemicalPhysicalKineticsState['layers'][number]['hydrostaticState']> | undefined;
    if (pendingHydrostatic !== undefined) {
      const { boundary, representative, fractions, sourceProvenance, equationOfStateMaxRelativeDeviation } = pendingHydrostatic;
      const n2MoleFraction = fractions.n2;
      const suppliedN2 = inventories.n2;
      if (typeof n2MoleFraction !== 'number' || n2MoleFraction <= 0) {
        diagnostics.push(prefix + ': в гидростатическом bulk-составе отсутствует положительная доля N2');
      } else if (typeof suppliedN2 !== 'number' || !Number.isFinite(suppliedN2) || suppliedN2 <= 0) {
        diagnostics.push(prefix + ': для гидростатической проверки требуется явный положительный подстолбовой запас n2');
      } else {
        const deltaColumnMoles =
          boundary.top.columnMolesPerM2 - boundary.bottom.columnMolesPerM2;
        const hydrostaticLayerInventoryMolM2 = deltaColumnMoles * n2MoleFraction;
        const layerThicknessM = seed.topAltitudeM - seed.bottomAltitudeM;
        const layerAverageConcentrationMoleculeCm3 =
          (suppliedN2 / layerThicknessM) * AVOGADRO_NUMBER_PER_MOL / 1e6;
        const hydrostaticMidpointConcentrationMoleculeCm3 =
          (n2MoleFraction * representative.pressurePa /
            (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * representative.temperatureK)) *
          AVOGADRO_NUMBER_PER_MOL / 1e6;
        const relativeDeviation =
          Math.abs(layerAverageConcentrationMoleculeCm3 - hydrostaticMidpointConcentrationMoleculeCm3) /
          hydrostaticMidpointConcentrationMoleculeCm3;
        const inventoryRelativeDeviation =
          Math.abs(suppliedN2 - hydrostaticLayerInventoryMolM2) /
          Math.max(hydrostaticLayerInventoryMolM2, Number.MIN_VALUE);
        if (
          !Number.isFinite(relativeDeviation) ||
          relativeDeviation > maximumHydrostaticThirdBodyRelativeDeviation
        ) {
          diagnostics.push(
            prefix + ': средняя концентрация N2 из столба отличается от локальной xN2*P/(R*T) на ' +
            (relativeDeviation * 100).toFixed(3) + '%; требуется дополнительное вертикальное разбиение (лимит ' +
            (maximumHydrostaticThirdBodyRelativeDeviation * 100).toFixed(2) + '%)'
          );
        }
        if (!Number.isFinite(inventoryRelativeDeviation) || inventoryRelativeDeviation > 1e-6) {
          diagnostics.push(
            prefix + ': подстолбовой запас n2 не согласован с гидростатическим ΔNmol*xN2; относительное расхождение ' +
            inventoryRelativeDeviation
          );
        }
        hydrostaticState = {
          representativeHeightM: representative.heightM,
          bottom: {
            heightM: boundary.bottom.heightM,
            pressurePa: boundary.bottom.pressurePa,
            temperatureK: boundary.bottom.temperatureK,
            densityKgPerM3: boundary.bottom.densityKgPerM3,
            meanMolarMassKgPerMol: boundary.bottom.meanMolarMassKgPerMol,
            gravityMs2: boundary.bottom.gravityMs2,
            scaleHeightM: boundary.bottom.scaleHeightM,
            columnMassKgPerM2: boundary.bottom.columnMassKgPerM2,
            columnMolesPerM2: boundary.bottom.columnMolesPerM2
          },
          representative: {
            heightM: representative.heightM,
            pressurePa: representative.pressurePa,
            temperatureK: representative.temperatureK,
            densityKgPerM3: representative.densityKgPerM3,
            meanMolarMassKgPerMol: representative.meanMolarMassKgPerMol,
            gravityMs2: representative.gravityMs2,
            scaleHeightM: representative.scaleHeightM,
            columnMassKgPerM2: representative.columnMassKgPerM2,
            columnMolesPerM2: representative.columnMolesPerM2
          },
          top: {
            heightM: boundary.top.heightM,
            pressurePa: boundary.top.pressurePa,
            temperatureK: boundary.top.temperatureK,
            densityKgPerM3: boundary.top.densityKgPerM3,
            meanMolarMassKgPerMol: boundary.top.meanMolarMassKgPerMol,
            gravityMs2: boundary.top.gravityMs2,
            scaleHeightM: boundary.top.scaleHeightM,
            columnMassKgPerM2: boundary.top.columnMassKgPerM2,
            columnMolesPerM2: boundary.top.columnMolesPerM2
          },
          molarFractions: fractions,
          equationOfStateMaxRelativeDeviation,
          thirdBodyConsistency: {
            speciesId: 'n2',
            hydrostaticMidpointConcentrationMoleculeCm3,
            layerAverageConcentrationMoleculeCm3,
            relativeDeviation,
            maximumAllowedRelativeDeviation: maximumHydrostaticThirdBodyRelativeDeviation,
            hydrostaticLayerInventoryMolM2,
            suppliedLayerInventoryMolM2: suppliedN2,
            inventoryRelativeDeviation
          },
          provenance: {
            pressure: { ...input.hydrostaticColumn!.provenance.surfacePressure },
            composition: { ...sourceProvenance },
            model: {
              sourceName: 'Core hydrostatic atmosphere solver (Stage 4.8.1)',
              method: 'spherical-gravity ideal-gas hydrostatic integration with Radau IIA',
              limitations: input.hydrostaticColumn!.assumptions.join('; ')
            }
          }
        };
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
        : [],
      ...(hydrostaticState === undefined ? {} : { hydrostaticState })
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
      'Геометрия и температурные представители импортированы из source-backed profile; подстолбовые и полные запасы, provenance запасов и reactionIds переданы явно. Финальная физическая валидация выполняется configurePrimaryPhysicalChemicalKinetics().',
      ...(input.hydrostaticColumn === undefined
        ? []
        : ['Послойные P(z), rho(z), gravity, scale height, сухой состав и молярные столбы перенесены из завершённой гидростатической колонки; отдельный pressure term пока не входит в rate law.'])
    ]
  };
}



// ============================================
// HYDROSTATIC COLUMN → DRY-AIR KINETIC SUBCOLUMNS
// ============================================

export type HydrostaticKineticInventoryDerivation =
  | {
      status: 'derived';
      layers: readonly SourcedKineticLayerInventoryInput[];
      totalColumnInventoriesMolM2: Readonly<Record<string, number>>;
      totalInventoryProvenance: Readonly<Record<string, DataProvenance>>;
      diagnostics: readonly string[];
    }
  | {
      status: 'rejected';
      layers: readonly [];
      totalColumnInventoriesMolM2: Readonly<Record<string, number>>;
      totalInventoryProvenance: Readonly<Record<string, DataProvenance>>;
      diagnostics: readonly string[];
    };

/**
 * Derive only the stable dry-air species supported by the primary
 * chemical state (N2/O2) from each hydrostatic layer's molar-column
 * increment: ΔN_i = x_i * (Nmol_top - Nmol_bottom).
 *
 * Argon and CO2 remain in the hydrostatic bulk composition but are not
 * copied into the restricted O/NO/NO2/H/O2/HO2/N2 reaction mechanism.
 * Radicals are never inferred. reactionIds must be explicitly selected
 * by the caller and can still fail the final mechanism species checks.
 */
export function deriveDryAirKineticInventoriesFromHydrostaticColumn(
  column: HydrostaticColumnCompleted,
  reactionIds: readonly string[]
): HydrostaticKineticInventoryDerivation {
  const diagnostics: string[] = [];
  if (!Array.isArray(reactionIds) || reactionIds.length === 0) {
    diagnostics.push('reactionIds должен быть непустым явным списком параметризованных реакций');
  } else {
    const seen = new Set<string>();
    for (const reactionId of reactionIds) {
      if (typeof reactionId !== 'string' || reactionId.trim() === '' || seen.has(reactionId)) {
        diagnostics.push('reactionIds содержит пустой, нестроковый или повторный ID');
        break;
      }
      seen.add(reactionId);
    }
  }
  if (
    !column ||
    column.status !== 'completed' ||
    !Array.isArray(column.layerBoundaries) ||
    column.layerBoundaries.length === 0
  ) {
    diagnostics.push('требуется completed hydrostatic column с непустыми layerBoundaries');
  }
  if (diagnostics.length > 0) {
    return {
      status: 'rejected',
      layers: [],
      totalColumnInventoriesMolM2: {},
      totalInventoryProvenance: {},
      diagnostics
    };
  }

  const totalColumnInventoriesMolM2: Record<string, number> = { n2: 0, o2: 0 };
  const totalInventoryProvenance: Record<string, DataProvenance> = {};
  const layers: SourcedKineticLayerInventoryInput[] = [];

  for (const boundary of column.layerBoundaries) {
    const representatives = column.requestedHeightPoints.filter((point) =>
      point.layerId === boundary.layerId &&
      point.heightM > boundary.bottom.heightM &&
      point.heightM < boundary.top.heightM
    );
    if (representatives.length !== 1) {
      diagnostics.push('для гидростатического слоя «' + boundary.layerId + '» требуется ровно одна representative-height точка');
      continue;
    }
    const representative = representatives[0]!;
    const totalDeltaMoles = boundary.top.columnMolesPerM2 - boundary.bottom.columnMolesPerM2;
    if (!Number.isFinite(totalDeltaMoles) || totalDeltaMoles <= 0) {
      diagnostics.push('молярный столб слоя «' + boundary.layerId + '» не имеет конечного положительного приращения');
      continue;
    }
    const fractions = Object.fromEntries(
      representative.moleFractions.map((entry: HydrostaticProfilePoint['moleFractions'][number]) => [entry.gasId, entry.moleFraction])
    );
    const layerInventories: Record<string, number> = {};
    for (const gasId of ['n2', 'o2']) {
      const fraction = fractions[gasId];
      if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction <= 0) {
        diagnostics.push('слой «' + boundary.layerId + '» не содержит подтверждённую молярную долю ' + gasId);
        continue;
      }
      const amount = fraction * totalDeltaMoles;
      if (!Number.isFinite(amount) || amount <= 0) {
        diagnostics.push('вычисленный столб ' + gasId + ' слоя «' + boundary.layerId + '» не конечен и положителен');
        continue;
      }
      layerInventories[gasId] = amount;
      totalColumnInventoriesMolM2[gasId] += amount;
    }
    const sourceLayer = column.provenance.layers.find((entry) => entry.layerId === boundary.layerId);
    if (sourceLayer === undefined || !hasIdentifiedSource(sourceLayer.provenance)) {
      diagnostics.push('слой «' + boundary.layerId + '» не имеет идентифицируемого provenance');
      continue;
    }
    const inventoryProvenance: DataProvenance = {
      ...sourceLayer.provenance,
      method: 'hydrostatic layer ΔNmol × sourced dry-air mole fraction x_i',
      rawInput: {
        bottomColumnMolesPerM2: boundary.bottom.columnMolesPerM2,
        topColumnMolesPerM2: boundary.top.columnMolesPerM2,
        representativeHeightM: representative.heightM,
        representativeMoleFractionsJson: JSON.stringify(fractions),
        derivedSpeciesJson: JSON.stringify(layerInventories)
      },
      limitations:
        'derives only stable N2/O2 inventories; Ar/CO2 remain outside the primary reaction mechanism; no radicals are inferred'
    };
    layers.push({
      sourceLayerId: boundary.layerId,
      columnInventoriesMolM2: layerInventories,
      inventoryProvenance,
      reactionIds: [...reactionIds]
    });
    for (const gasId of ['n2', 'o2']) {
      totalInventoryProvenance[gasId] = {
        ...sourceLayer.provenance,
        method: 'sum of hydrostatic per-layer ΔNmol × USSA dry-air mole fraction',
        limitations: 'column total covers only the stable N2/O2 species passed to the restricted chemical mechanism'
      };
    }
  }

  if (layers.length !== column.layerBoundaries.length) {
    diagnostics.push('не все гидростатические слои дали проверяемые N2/O2 inventories');
  }
  if (diagnostics.length > 0) {
    return {
      status: 'rejected',
      layers: [],
      totalColumnInventoriesMolM2: {},
      totalInventoryProvenance: {},
      diagnostics
    };
  }
  return {
    status: 'derived',
    layers,
    totalColumnInventoriesMolM2,
    totalInventoryProvenance,
    diagnostics: [
      'N2/O2 inventories вычислены по разности интегрированного молярного столба границ и исходным molar fractions каждого слоя.',
      'Ar/CO2 сохранены в гидростатическом составе, но исключены из ограниченного реакционного механизма; O/NO/NO2/H/HO2 остаются unknown и не выводятся.'
    ]
  };
}
