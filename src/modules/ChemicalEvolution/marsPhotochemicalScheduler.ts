// ============================================
// MARS PHOTOCHEMICAL SCHEDULER ADAPTER (Stage 4.2)
// ============================================
//
// The source-backed 16-species Mars ODE is connected to CoreWorldState
// through one explicit-only Scheduler process. The adapter deliberately
// requires a dedicated, fully specified single-compartment reservoir.
// It does not initialise concentrations from a planetary atmosphere,
// surface pressure, column abundance, or a guessed scale height.
//
// Inventory contract:
// - reservoir material basis: molar_concentration (mol/m^3);
// - temperature: explicit known/estimated reservoirTemperature in K;
// - all 16 concentrations and both provenance records are mandatory;
// - conversion to/from molecule cm^-3 is exact unit conversion using N_A;
// - exact Table B2 altitude node only (0.5 or 42.67 km).
//
// The current ODE returns final species concentrations and element
// invariants, not per-reaction extents. Therefore this adapter updates
// the dedicated compartment inventory but intentionally appends NO
// synthetic ReactionLedger or FluxLedger records.
//
// This is a manual one-shot operation (explicit_only). There is no
// automatic wake-up, vertical transport, radiation interpolation,
// pressure/temperature reconstruction, or multi-compartment coupling.

import {
  MARS_PHOTOCHEMICAL_SPECIES_ORDER,
  runMarsPhotochemicalConcentrationStep
} from './marsPhotochemicalNetwork';
import type {
  MarsPhotochemicalInitialConcentrations,
  MarsPhotochemicalNetworkInput,
  MarsPhotochemicalNetworkResult
} from './marsPhotochemicalNetwork';
import type { MarsGasSpeciesId } from '../Data/marsGasPhaseKinetics';
import type { DataProvenance } from '../Core/scientificValue';
import { hasUsableTemperature } from '../Core/thermalState';
import { setMaterialInventory, validateMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { validateWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { unknownValue } from '../Core/scientificValue';
import { runMacroStep } from '../Core/scheduler';
import type { ProcessOperator } from '../Core/scheduler';
import { createProcessRegistry } from '../Core/processRegistry';
import type { ProcessRegistry } from '../Core/processRegistry';

export const MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID =
  'mars_single_compartment_photochemistry';

/** SI-defined Avogadro constant, mol^-1 (exact). */
export const AVOGADRO_CONSTANT_MOL_INV = 6.02214076e23;

const CUBIC_CENTIMETRES_PER_CUBIC_METRE = 1e6;

export interface MarsPhotochemicalSchedulerProcessConfig {
  /** Dedicated CoreWorldState reservoir containing exactly 16 species. */
  readonly reservoirId: string;
  /** Exact source Table B2 reference node; no vertical interpolation. */
  readonly altitudeKm: 0.5 | 42.67;
  readonly gasPhaseReactionIds: readonly string[];
  readonly photolysisReactionIds: readonly string[];
}

export interface MarsPhotochemicalSchedulerStepResult {
  readonly status: 'committed' | 'rejected';
  /** Original input world on every rejected step. */
  readonly world: CoreWorldState;
  readonly processId: string;
  readonly networkResult?: MarsPhotochemicalNetworkResult;
  readonly diagnostics: readonly string[];
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

function validateConfig(config: MarsPhotochemicalSchedulerProcessConfig): string[] {
  const errors: string[] = [];
  if (typeof config.reservoirId !== 'string' || config.reservoirId.trim() === '') {
    errors.push('reservoirId должен быть непустой строкой');
  }
  if (config.altitudeKm !== 0.5 && config.altitudeKm !== 42.67) {
    errors.push('altitudeKm должен совпадать с точным узлом Table B2: 0.5 или 42.67 km');
  }
  for (const [name, ids] of [
    ['gasPhaseReactionIds', config.gasPhaseReactionIds],
    ['photolysisReactionIds', config.photolysisReactionIds]
  ] as const) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.trim() === '')) {
      errors.push(name + ' должен быть массивом непустых строк');
    } else if (new Set(ids).size !== ids.length) {
      errors.push(name + ' не должен содержать повторяющиеся идентификаторы');
    }
  }
  if (
    Array.isArray(config.gasPhaseReactionIds) &&
    Array.isArray(config.photolysisReactionIds) &&
    config.gasPhaseReactionIds.length + config.photolysisReactionIds.length === 0
  ) {
    errors.push('необходимо явно выбрать хотя бы одну газофазную или фотолизную реакцию');
  }
  return errors;
}

/** Registry description: no constant physical tau exists for this explicit interval. */
export function createMarsPhotochemicalProcessRegistry(): ProcessRegistry {
  const registry = createProcessRegistry();
  registry.register({
    id: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
    name: 'Локальная фотохимия Марса (однокомпартментный ODE)',
    processKind: 'photochemical',
    tau: unknownValue(
      'постоянное характерное время не задано: длительность интегрируемого интервала явно передаёт вызывающая сторона',
      {
        sourceName: 'Taysum & Palmer (2020), Mars photochemical mechanism adapter',
        reference: 'Taysum & Palmer (2020), Appendix Tables B1 and B2',
        applicability: 'source-backed single-compartment reaction/photolysis subset'
      }
    ),
    stepPolicy: {
      kind: 'unspecified',
      note: 'explicit_only: длительность dt задаётся вызывающей стороной в физических секундах'
    },
    solverAvailability: 'available',
    enabled: true,
    executionMode: 'explicit_only',
    provenance: {
      sourceName: 'Taysum & Palmer (2020), Mars gas-phase and photolysis reference mechanisms',
      reference: 'Appendix Tables B1 and B2',
      applicability: 'один однородный компартмент, SZA=0°, Ls=251°, точный узел высоты 0.5 или 42.67 km',
      limitations: 'без вертикального переноса, радиационного переноса, интерполяции высоты и изменения метеорологии во времени'
    },
    applicability: 'выделенный резервуар CoreWorldState с точным набором 16 видов, температурой и инвентарём mol/m^3, каждое поле с provenance',
    assumptions: 'идеально перемешанный изотермический компартмент; все начальные концентрации заданы явно; атомный баланс C/H/O контролируется линейными инвариантами ODE',
    timescaleNote: 'характерное время зависит от состояния и выбранной сети; в дескрипторе не подменяется числом'
  });
  return registry;
}

function getPhotochemicalReservoir(
  world: CoreWorldState,
  reservoirId: string
): ReservoirRecord {
  const reservoir = world.reservoirs.find((candidate) => candidate.id === reservoirId);
  if (reservoir === undefined) {
    throw new Error('в CoreWorldState отсутствует фотохимический резервуар «' + reservoirId + '»');
  }
  if (reservoir.kind !== 'mars_photochemical_compartment') {
    throw new Error(
      'резервуар «' + reservoirId + '» должен иметь kind=mars_photochemical_compartment; ' +
      'адаптер не превращает произвольную атмосферу в локальный Mars-компартмент'
    );
  }
  if (reservoir.material === undefined || reservoir.material.basis !== 'molar_concentration') {
    throw new Error('резервуар «' + reservoirId + '» должен иметь material.basis=molar_concentration (mol/m^3)');
  }
  if (!hasIdentifiedProvenance(reservoir.materialProvenance)) {
    throw new Error('резервуар «' + reservoirId + '» требует явный materialProvenance с идентификатором источника');
  }
  const materialValidation = validateMaterialInventory(reservoir.material);
  if (!materialValidation.valid) {
    throw new Error('материальный инвентарь фотохимического резервуара некорректен: ' + materialValidation.errors.join('; '));
  }

  const expected = new Set<string>(MARS_PHOTOCHEMICAL_SPECIES_ORDER);
  const missing = MARS_PHOTOCHEMICAL_SPECIES_ORDER.filter((species) =>
    !Object.prototype.hasOwnProperty.call(reservoir.material!.entries, species)
  );
  const unknown = Object.keys(reservoir.material.entries).filter((species) => !expected.has(species));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      'резервуар должен содержать ровно 16 фотохимических видов; missing=' +
      missing.join(',') + '; unknown=' + unknown.join(',')
    );
  }
  const reservoirTemperature = reservoir.reservoirTemperature;
  if (
    reservoirTemperature === undefined ||
    (reservoirTemperature.status !== 'known' && reservoirTemperature.status !== 'estimated') ||
    !hasUsableTemperature(reservoirTemperature)
  ) {
    throw new Error('резервуар требует числовую reservoirTemperature со статусом known/estimated и единицей K');
  }
  if (!hasIdentifiedProvenance(reservoirTemperature.provenance)) {
    throw new Error('reservoirTemperature требует идентифицируемый provenance');
  }
  return reservoir;
}

function inventoryToInitialConcentrations(
  entries: Readonly<Record<string, number>>
): MarsPhotochemicalInitialConcentrations {
  const result = {} as Record<MarsGasSpeciesId, number>;
  for (const species of MARS_PHOTOCHEMICAL_SPECIES_ORDER) {
    const concentrationMolM3 = entries[species];
    const particlesCm3 =
      concentrationMolM3 * AVOGADRO_CONSTANT_MOL_INV / CUBIC_CENTIMETRES_PER_CUBIC_METRE;
    if (!Number.isFinite(particlesCm3) || particlesCm3 < 0) {
      throw new Error('species ' + species + ' не преобразуется в конечную концентрацию particles/cm^3');
    }
    result[species] = particlesCm3;
  }
  return result;
}

function concentrationsToInventory(
  concentrationsPerCm3: MarsPhotochemicalInitialConcentrations
): Record<string, number> {
  const entries: Record<string, number> = {};
  for (const species of MARS_PHOTOCHEMICAL_SPECIES_ORDER) {
    const concentrationMolM3 =
      concentrationsPerCm3[species] * CUBIC_CENTIMETRES_PER_CUBIC_METRE /
      AVOGADRO_CONSTANT_MOL_INV;
    if (!Number.isFinite(concentrationMolM3) || concentrationMolM3 < 0) {
      throw new Error('выходная концентрация species ' + species + ' не преобразуется в mol/m^3');
    }
    entries[species] = concentrationMolM3;
  }
  return entries;
}

function applyMarsPhotochemicalInterval(
  world: CoreWorldState,
  config: MarsPhotochemicalSchedulerProcessConfig,
  durationS: number,
  intervalStartS: number
): { readonly world: CoreWorldState; readonly result: MarsPhotochemicalNetworkResult } {
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error('Scheduler durationS должен быть конечным положительным числом');
  }
  if (!Number.isFinite(intervalStartS) || intervalStartS !== 0) {
    throw new Error('explicit_only Mars фотохимия ожидает единственный интервал [0, dt)');
  }
  const reservoir = getPhotochemicalReservoir(world, config.reservoirId);
  const temperature = reservoir.reservoirTemperature;
  if (
    temperature === undefined ||
    (temperature.status !== 'known' && temperature.status !== 'estimated') ||
    !hasUsableTemperature(temperature)
  ) {
    throw new Error('reservoirTemperature потеряна или стала непригодной к расчёту');
  }
  const materialProvenance = reservoir.materialProvenance;
  if (!hasIdentifiedProvenance(materialProvenance)) {
    throw new Error('materialProvenance потерян или не идентифицирует входной инвентарь');
  }
  const initial = inventoryToInitialConcentrations(reservoir.material!.entries);
  const networkInput: MarsPhotochemicalNetworkInput = {
    temperatureK: temperature.quantity.value,
    temperatureProvenance: temperature.provenance as DataProvenance,
    altitudeKm: config.altitudeKm,
    gasPhaseReactionIds: [...config.gasPhaseReactionIds],
    photolysisReactionIds: [...config.photolysisReactionIds],
    dtSeconds: durationS,
    initialConcentrationsPerCm3: initial,
    initialStateProvenance: materialProvenance
  };
  const result = runMarsPhotochemicalConcentrationStep(networkInput);
  const nextEntries = concentrationsToInventory(result.finalConcentrationsPerCm3);
  const outputProvenance: DataProvenance = {
    sourceName: 'Evolution Wars Mars single-compartment photochemical ODE output',
    sourceId: 'evowars/core/mars-single-compartment-ode',
    method: 'Radau IIA integration of the selected Taysum & Palmer (2020) Table B1 gas-phase and Table B2 photolysis channels',
    rawInput: {
      temperatureK: temperature.quantity.value,
      altitudeKm: config.altitudeKm,
      durationS,
      startSegmentIndex: world.clock.segmentIndex,
      startLocalTimeS: world.clock.localTimeS,
      gasPhaseReactionIds: config.gasPhaseReactionIds.join(','),
      photolysisReactionIds: config.photolysisReactionIds.join(','),
      solverMethod: result.method,
      initialStateSourceId:
        materialProvenance.sourceId ??
        materialProvenance.datasetId ??
        materialProvenance.sourceName ??
        'identified source (see input provenance)'
    },
    applicability: 'выходной локальный вектор концентраций в mol/m^3 одного изотермического компартмента',
    limitations: [
      'не является вертикальным профилем или моделью целой атмосферы',
      'нет переноса между резервуарами, осаждения, диффузии и поверхности',
      'нет динамики температуры, давления, SZA и сезонного угла в пределах шага',
      'в текущем API решателя нет реакционных extent; поэтому новые ReactionLedger/FluxLedger записи не создаются'
    ].join('; ')
  };
  const updatedReservoir = setMaterialInventory(
    { ...reservoir, materialProvenance: outputProvenance },
    'molar_concentration',
    nextEntries
  );
  const updatedWorld: CoreWorldState = {
    ...world,
    reservoirs: world.reservoirs.map((candidate) =>
      candidate.id === reservoir.id ? updatedReservoir : candidate
    )
  };
  return { world: updatedWorld, result };
}

/**
 * Run one user-requested Mars photochemical integration interval through
 * Scheduler. The operation is explicit-only, advances WorldClock exactly
 * once after a successful transaction, and returns the original world on
 * any validation, solver or invariant failure.
 */
export function runMarsPhotochemicalSchedulerStep(
  world: CoreWorldState,
  config: MarsPhotochemicalSchedulerProcessConfig,
  durationS: number
): MarsPhotochemicalSchedulerStepResult {
  const configIssues = validateConfig(config);
  if (configIssues.length > 0) {
    return {
      status: 'rejected',
      world,
      processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
      diagnostics: configIssues
    };
  }
  const initialIssues = validateWorldState(world);
  if (initialIssues.length > 0) {
    return {
      status: 'rejected',
      world,
      processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
      diagnostics: initialIssues.map((issue) => issue.component + ': ' + issue.message)
    };
  }

  let networkResult: MarsPhotochemicalNetworkResult | undefined;
  const operator: ProcessOperator = {
    processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
    apply: (workingWorld, stepDurationS, intervalStartS) => {
      const applied = applyMarsPhotochemicalInterval(
        workingWorld,
        config,
        stepDurationS,
        intervalStartS
      );
      networkResult = applied.result;
      return applied.world;
    }
  };

  try {
    const macroStep = runMacroStep(
      world,
      createMarsPhotochemicalProcessRegistry(),
      [operator],
      {
        durationS,
        splitting: 'lie',
        processIds: [MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID],
        explicit: { processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID }
      }
    );
    if (macroStep.status !== 'committed') {
      return {
        status: 'rejected',
        world,
        processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
        diagnostics: macroStep.diagnostics
      };
    }
    const finalIssues = validateWorldState(macroStep.world);
    if (finalIssues.length > 0) {
      return {
        status: 'rejected',
        world,
        processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
        diagnostics: [
          'результат CoreWorldState после ODE не прошёл валидацию; commit отозван',
          ...finalIssues.map((issue) => issue.component + ': ' + issue.message)
        ]
      };
    }
    if (networkResult === undefined) {
      return {
        status: 'rejected',
        world,
        processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
        diagnostics: ['Scheduler commit завершился без результата фотохимического ODE']
      };
    }
    return {
      status: 'committed',
      world: macroStep.world,
      processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
      networkResult,
      diagnostics: [...macroStep.diagnostics, ...networkResult.warnings]
    };
  } catch (error) {
    return {
      status: 'rejected',
      world,
      processId: MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
      diagnostics: [error instanceof Error ? error.message : String(error)]
    };
  }
}

export default {
  MARS_PHOTOCHEMICAL_SCHEDULER_PROCESS_ID,
  AVOGADRO_CONSTANT_MOL_INV,
  createMarsPhotochemicalProcessRegistry,
  runMarsPhotochemicalSchedulerStep
};
