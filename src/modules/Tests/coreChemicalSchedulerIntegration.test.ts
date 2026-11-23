// ============================================
// STAGE 4.2.3.3 - Интеграционные тесты: пользовательский шаг
// химической эволюции через Scheduler научного ядра
// ============================================
//
// Проверяется полный путь новой кнопки «Сделать шаг химической
// эволюции»: runChemicalEvolutionSchedulerStep выполняет ОДИН шаг
// через runMacroStep (explicit_only-процесс без выдуманного τ),
// материальные резервуары и ReactionLedger ядра отражают результат,
// численные результаты режима A совпадают с существующим legacy-
// расчётом, а любой отказ возвращает исходный мир без частичных
// изменений. Legacy-путь runChemicalEvolutionStep и golden baseline
// не изменяются и остаются зелёными (см. chemical.test.ts и
// coreChemicalGoldenBaseline.test.ts).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Spy-обёртка вокруг РЕАЛЬНОЙ реализации runMacroStep: модуль
// ChemicalEvolution получает подменённую ссылку, шаг по-прежнему
// выполняется настоящим планировщиком, но тест доказывает сам факт
// прохода пользовательского шага через Scheduler и форму его вызова.
vi.mock('../Core/scheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../Core/scheduler')>();
  return { ...actual, runMacroStep: vi.fn(actual.runMacroStep) };
});

import {
  CHEMICAL_EVOLUTION_STEP_PROCESS_ID,
  PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID,
  createChemicalEvolutionStepRegistry,
  createPhysicalChemicalEvolutionStepRegistry,
  createChemicalState,
  configurePrimaryPhysicalChemicalKinetics,
  createDefaultProcessRegistry,
  elementTotalsOf,
  runChemicalEvolutionSchedulerStep,
  runChemicalEvolutionStep
} from '../ChemicalEvolution';
import {
  CHEMICAL_RESERVOIR_IDS,
  buildSpeciesCatalogFromLegacy,
  chemicalReservoirConsistencyIssues,
  chemicalStateFromCoreReservoirs,
  chemicalStateToCoreReservoirs,
  coreWorldStateFromLegacyWorld
} from '../Core/adapters';
import {
  createSchedulerBookkeeping,
  readyProcessIds,
  runMacroStep,
  scheduleProcess,
  SchedulerError
} from '../Core/scheduler';
import type { MacroStepResult, ProcessOperator } from '../Core/scheduler';
import {
  isExplicitOnlyProcess,
  isProcessAutoRunnable,
  processAvailability,
  tauSeconds,
  validateProcessDescriptor
} from '../Core/processRegistry';
import { convert, quantity } from '../Core/physicalQuantity';
import { knownValue } from '../Core/scientificValue';
import { registerReaction } from '../Core/reactionLedger';
import type { ReactionRecord } from '../Core/reactionLedger';
import { createCoreWorldState } from '../Core/worldState';
import { setMaterialInventory } from '../Core/reservoir';
import { totalElapsedSeconds } from '../Core/simulationClock';
import chemicalReactions from '../Data/chemicalReactions';
import gases from '../Data/gases';
import { elementCompositions } from '../Data/elementCompositions';
import type {
  AtmospherePhysicalModel,
  ChemicalEvolutionState,
  ChemicalPhysicalKineticsState,
  GeneratedWorld
} from '../../types';

// ============================================
// ХЕЛПЕРЫ
// ============================================

/** Синтетическая физическая модель атмосферы (аналог chemical.test.ts). */
function makeModel(
  fractions: Record<string, number>,
  overrides: Partial<AtmospherePhysicalModel> = {}
): AtmospherePhysicalModel {
  return {
    molarFractions: fractions,
    surfacePressurePa: { value: 101325, unit: 'Па', confidence: 'derived' },
    meanMolarMassKgMol: null,
    partialPressuresPa: {},
    columnMassKgM2: null,
    columnMolM2: null,
    idealGasAssumption: true,
    idealGasNote: '',
    fugacityNote: '',
    layers: [],
    layersNote: '',
    notes: [],
    ...overrides
  } as AtmospherePhysicalModel;
}

/** Минимальный мир с игровой (game_normalized) химией. */
function makeGameWorld(fractions: Record<string, number>, temperatureK = 600): GeneratedWorld {
  const model = makeModel(fractions);
  const chemicalState = createChemicalState({ atmospherePhysicalModel: model });
  return {
    id: 'world-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    seed: 'seed-1',
    generatorVersion: '0.3.0',
    mode: 'realistic',
    chemicalState,
    atmospherePhysics: model,
    atmosphere: { temperature: temperatureK },
    phaseAnalysis: { temperatureK },
    // Радиация доступна через energySources (как в legacy-пути):
    // energyBudget не задаётся, чтобы не подавать адаптеру ядра
    // неполные PhysValue.
    energySources: { primary: ['stellar_radiation'], secondary: [], description: '' }
  } as unknown as GeneratedWorld;
}

/** Мир со ВСЕМИ четырьмя непустыми резервуарами легаси-химии.
 *  Stage 4.2.4: температура 250 K — НИЖЕ нижних границ allowedRanges
 *  всех температурно-зависимых реакций каталога (ch4_oxidation от
 *  300 K, c2h6_oxidation от 400 K, h2_oxidation от 500 K,
 *  co_oxidation от 200 K, но co в фикстуре нет): шаг химии гарантированно
 *  не применяет реакций, поэтому перенос резервуаров проверяется в
 *  изоляции от их применения. */
function makeFourReservoirWorld(): GeneratedWorld {
  const model = makeModel({ ch4: 0.6, o2: 0.4 });
  const chemicalState: ChemicalEvolutionState = {
    ...createChemicalState({ atmospherePhysicalModel: model }),
    reservoirs: {
      atmospheric: { ch4: 60, o2: 40 },
      liquidSurface: { h2o: 5 },
      subsurfaceLiquid: { co2: 3 },
      solidDeposits: { c2h6: 7 }
    }
  };
  return {
    ...(makeGameWorld({ ch4: 0.6, o2: 0.4 }, 250) as unknown as Record<string, unknown>),
    chemicalState
  } as unknown as GeneratedWorld;
}

/** Мир со столбовым режимом (column_inventory, моль/м²). */
function makeColumnWorld(): GeneratedWorld {
  const model = makeModel({ ch4: 0.6, o2: 0.4 }, { columnMolM2: { value: 1000, unit: 'моль/м²', confidence: 'derived' } });
  const chemicalState = createChemicalState({ atmospherePhysicalModel: model, surfaceGravityMs2: 9.81 });
  return {
    ...(makeGameWorld({ ch4: 0.6, o2: 0.4 }) as unknown as Record<string, unknown>),
    chemicalState
  } as unknown as GeneratedWorld;
}

/**
 * Тестовый мир с ЯВНО заданным физическим реакционным слоем.
 * Числа и provenance синтетические, только для проверки интеграционного
 * контракта; они не описывают реальную планетарную атмосферу.
 */
function makePhysicalKineticWorld(temperatureK = 350): GeneratedWorld {
  const model = makeModel(
    { n2: 0.8, o2: 0.2 },
    { columnMolM2: { value: 5250, unit: 'моль/м²', confidence: 'derived' } }
  );
  const base = createChemicalState({
    atmospherePhysicalModel: model,
    surfaceGravityMs2: 9.81,
    stepDurationYears: 7
  });
  const inventory = {
    ...base.inventory,
    h: 8e-6,
    ho2: 1e-8
  };
  const provenance = (sourceId: string) => ({
    sourceName: 'synthetic integration test fixture',
    sourceId,
    reference: 'test-only; not planetary source data',
    limitations: 'synthetic values used only to validate the primary-state Scheduler adapter'
  });
  const chemicalState: ChemicalEvolutionState = {
    ...base,
    inventory,
    reservoirs: {
      ...base.reservoirs,
      atmospheric: { ...inventory }
    },
    physicalKinetics: {
      maximumMacroStepS: 1e10,
      totalInventoryProvenance: Object.fromEntries(
        ['o', 'no', 'no2', 'h', 'o2', 'ho2', 'n2'].map((speciesId) => [
          speciesId,
          provenance('fixture:global-inventory:' + speciesId)
        ])
      ),
      layers: [
        {
          layerId: 'explicit-test-layer',
          layerThicknessM: 100,
          thicknessProvenance: provenance('fixture:layer-thickness'),
          temperatureK,
          temperatureProvenance: provenance('fixture:layer-temperature'),
          columnInventoriesMolM2: {
            h: 8e-6,
            o2: 4e-5,
            ho2: 1e-8,
            n2: 4.2e3
          },
          inventoryProvenance: provenance('fixture:layer-inventory'),
          reactionIds: ['kida-tb-2015-03-19-106']
        }
      ]
    },
    physicalKineticsHistory: []
  };
  return {
    ...(makeGameWorld({ n2: 0.8, o2: 0.2 }, temperatureK) as unknown as Record<string, unknown>),
    atmospherePhysics: model,
    chemicalState
  } as unknown as GeneratedWorld;
}

/** Длительность шага Scheduler: stepDurationYears через единицу 'yr'. */
function stepDurationSeconds(stepDurationYears: number): number {
  return convert(quantity(stepDurationYears, 'yr'), 's').value;
}

/** Записи каталога, реально применимые к состоянию шага. */
function appliedRecordOf(world: GeneratedWorld, startIndex: number): { reactionId: string; extent: number }[] {
  const state = world.chemicalState!;
  return state.history.slice(startIndex).filter((r) => r.applied).map((r) => ({
    reactionId: r.reactionId,
    extent: r.extent as number
  }));
}

beforeEach(() => {
  vi.mocked(runMacroStep).mockClear();
});

// ============================================
// 1. ПРОХОД ЧЕРЕЗ SCHEDULER
// ============================================

describe('Stage 4.2.3.3: пользовательский шаг химии выполняется через Scheduler', () => {
  it('нажатый шаг проходит через runMacroStep: один вызов, один explicit-процесс, Lie, фактическая длительность', () => {
    const world = makeGameWorld({ ch4: 0.6, o2: 0.4 });
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    expect(vi.mocked(runMacroStep)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(runMacroStep).mock.calls[0]!;
    const [, registry, operators, opts] = call;
    expect(registry.get(CHEMICAL_EVOLUTION_STEP_PROCESS_ID)?.id).toBe(CHEMICAL_EVOLUTION_STEP_PROCESS_ID);
    expect(operators).toHaveLength(1);
    expect(operators[0]!.processId).toBe(CHEMICAL_EVOLUTION_STEP_PROCESS_ID);
    expect(opts.splitting).toBe('lie');
    expect(opts.subCycles).toBeUndefined();
    expect(opts.processIds).toEqual([CHEMICAL_EVOLUTION_STEP_PROCESS_ID]);
    expect(opts.explicit).toEqual({ processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID });
    expect(opts.durationS).toBeCloseTo(stepDurationSeconds(1e6), 6);
    expect(opts.audit?.speciesCatalog).toBeDefined();
    expect(opts.audit?.boundary).toBe('complete');
  });

  it('второй последовательный шаг использует уже существующее ядро (без повторной инициализации)', () => {
    let world = makeGameWorld({ ch4: 0.6, o2: 0.4 });
    const first = runChemicalEvolutionSchedulerStep(world);
    expect(first.status).toBe('committed');
    expect(first.log.some((l) => l.includes('инициализировано'))).toBe(true);
    vi.mocked(runMacroStep).mockClear();
    const second = runChemicalEvolutionSchedulerStep(first.world);
    expect(second.status).toBe('committed');
    expect(second.log.some((l) => l.includes('инициализировано'))).toBe(false);
    world = second.world;
    expect(world.coreWorldState?.scheduling?.stepCount).toBe(2);
    expect(totalElapsedSeconds(world.coreWorldState!.clock)).toBeCloseTo(2 * stepDurationSeconds(1e6), 6);
  });
});

// ============================================
// 1а. ФИЗИЧЕСКАЯ КИНЕТИКА В ОСНОВНОМ CHEMICALEVOLUTIONSTATE
// ============================================

describe('Stage 4.2: configure explicit physical kinetics in primary chemical state', () => {
  function setup() {
    const model = makeModel(
      { n2: 0.8, o2: 0.2 },
      { columnMolM2: { value: 5250, unit: 'моль/м²', confidence: 'derived' } }
    );
    const state = createChemicalState({
      atmospherePhysicalModel: model,
      surfaceGravityMs2: 9.81
    });
    const source = (sourceId: string) => ({
      sourceName: 'synthetic configuration test fixture',
      sourceId,
      reference: 'test-only'
    });
    const config: ChemicalPhysicalKineticsState = {
      maximumMacroStepS: 10,
      totalInventoryProvenance: Object.fromEntries(
        ['h', 'o2', 'ho2', 'n2'].map((speciesId) => [
          speciesId,
          source('config:global-inventory:' + speciesId)
        ])
      ),
      layers: [
        {
          layerId: 'configured-test-layer',
          layerThicknessM: 100,
          thicknessProvenance: source('config:thickness'),
          temperatureK: 350,
          temperatureProvenance: source('config:temperature'),
          columnInventoriesMolM2: {
            h: 8e-6,
            o2: 4e-5,
            ho2: 1e-8,
            n2: 4.2e3
          },
          inventoryProvenance: source('config:inventory'),
          reactionIds: ['kida-tb-2015-03-19-106']
        }
      ]
    };
    return { state, config };
  }

  it('configures explicit layers and merges supplied total columns without mutating the original state', () => {
    const { state, config } = setup();
    const original = JSON.stringify(state);
    const result = configurePrimaryPhysicalChemicalKinetics(state, config, {
      h: 8e-6,
      ho2: 1e-8
    });

    expect(result.status).toBe('configured');
    expect(result.state).not.toBe(state);
    expect(JSON.stringify(state)).toBe(original);
    expect(result.state.physicalKinetics).toEqual(config);
    expect(result.state.physicalKineticsHistory).toEqual([]);
    expect(result.state.inventory.h).toBe(8e-6);
    expect(result.state.inventory.ho2).toBe(1e-8);
    expect(result.state.inventory.o2).toBe(state.inventory.o2);
    expect(result.state.inventory.n2).toBe(state.inventory.n2);
    expect(result.state.reservoirs.atmospheric.h).toBe(8e-6);
    expect(result.state.reservoirs.atmospheric.ho2).toBe(1e-8);
    expect(result.state.surfacePressurePa).toBeNull();
    expect(result.diagnostics.join(' ')).toContain('no rates, species inventories or geometry were inferred');

    // Nested configuration values are copied: later caller edits do not
    // silently alter the active physical model.
    config.layers[0]!.columnInventoriesMolM2.h = 1;
    expect(result.state.physicalKinetics!.layers[0]!.columnInventoriesMolM2.h).toBe(8e-6);
  });

  it('rejects incomplete, unsupported or physically excessive inputs without changing state', () => {
    const { state, config } = setup();
    const original = JSON.stringify(state);
    const excessive = configurePrimaryPhysicalChemicalKinetics(state, config, {
      h: 1e-7,
      ho2: 1e-8
    });
    expect(excessive.status).toBe('rejected');
    expect(excessive.state).toBe(state);
    expect(excessive.diagnostics.join(' ')).toContain('превышает основной атмосферный инвентарь');
    expect(JSON.stringify(state)).toBe(original);

    const unsupported = configurePrimaryPhysicalChemicalKinetics(state, config, {
      h: 8e-6,
      ho2: 1e-8,
      ch4: 1
    });
    expect(unsupported.status).toBe('rejected');
    expect(unsupported.state).toBe(state);
    expect(unsupported.diagnostics.join(' ')).toContain('unsupported physical chemical species ID');

    const missingGlobalProvenance = {
      ...config,
      totalInventoryProvenance: {
        ...config.totalInventoryProvenance,
        h: {}
      }
    } as unknown as ChemicalPhysicalKineticsState;
    const invalidGlobalSource = configurePrimaryPhysicalChemicalKinetics(
      state,
      missingGlobalProvenance,
      { h: 8e-6, ho2: 1e-8 }
    );
    expect(invalidGlobalSource.status).toBe('rejected');
    expect(invalidGlobalSource.state).toBe(state);
    expect(invalidGlobalSource.diagnostics.join(' ')).toContain('provenance полного атмосферного запаса вида «h»');

    const missingProvenance = {
      ...config,
      layers: config.layers.map((layer) => ({
        ...layer,
        temperatureProvenance: {}
      }))
    } as unknown as ChemicalPhysicalKineticsState;
    expect(() =>
      configurePrimaryPhysicalChemicalKinetics(state, missingProvenance, {
        h: 8e-6,
        ho2: 1e-8
      })
    ).not.toThrow();
    const invalid = configurePrimaryPhysicalChemicalKinetics(state, missingProvenance, {
      h: 8e-6,
      ho2: 1e-8
    });
    expect(invalid.status).toBe('rejected');
    expect(invalid.state).toBe(state);
    expect(JSON.stringify(state)).toBe(original);
  });
});

describe('Stage 4.2: physical kinetics runs in the primary world Scheduler transaction', () => {
  it('uses explicit layer inventory and geometry, proposes a state-dependent dt and commits the actual kinetic reaction', () => {
    const world = makePhysicalKineticWorld();
    const before = { ...world.chemicalState!.inventory };
    const requestedMaximum = world.chemicalState!.physicalKinetics!.maximumMacroStepS;
    // extentFraction намеренно 0: физический путь не читает игровые параметры.
    const result = runChemicalEvolutionSchedulerStep(world, { extentFraction: 0 });

    expect(result.status).toBe('committed');
    expect(result.stepSize).toBeDefined();
    expect(result.stepSize!.requestedDurationS).toBe(requestedMaximum);
    expect(result.stepSize!.effectiveDurationS).toBeLessThan(requestedMaximum);
    expect(result.stepSize!.proposals[0]!.characteristicTimeS).toBeGreaterThan(0);
    expect(result.stepSize!.proposals[0]!.method).toContain('local reactant depletion');
    const call = vi.mocked(runMacroStep).mock.calls[0]!;
    const [, registry, operators, options] = call;
    expect(registry.get(PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID)?.executionMode).toBe('state_dependent');
    expect(options.processIds).toEqual([PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID]);
    expect(options.explicit).toBeUndefined();
    expect(operators).toHaveLength(1);
    expect(operators[0]!.processId).toBe(PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID);

    const updated = result.world.chemicalState!;
    expect(updated.inventory.h).toBeLessThan(before.h!);
    expect(updated.inventory.o2).toBeLessThan(before.o2!);
    expect(updated.inventory.ho2).toBeGreaterThan(before.ho2!);
    expect(updated.history.some((entry) => entry.mode === 'kinetic' && entry.applied)).toBe(true);
    expect(updated.physicalKineticsHistory).toHaveLength(1);
    const stepAudit = updated.physicalKineticsHistory![0]!;
    expect(stepAudit.durationS).toBe(result.stepSize!.effectiveDurationS);
    expect(stepAudit.characteristicTimeS).toBe(result.stepSize!.proposals[0]!.characteristicTimeS);
    expect(stepAudit.layers[0]!.temperatureK).toBe(350);
    expect(stepAudit.layers[0]!.layerThicknessM).toBe(100);
    expect(stepAudit.layers[0]!.temperatureProvenance.sourceId).toBe('fixture:layer-temperature');
    expect(stepAudit.layers[0]!.thicknessProvenance.sourceId).toBe('fixture:layer-thickness');
    expect(stepAudit.layers[0]!.totalInventoryProvenance.h!.sourceId).toBe('fixture:global-inventory:h');
    expect(stepAudit.layers[0]!.initialColumnInventoriesMolM2.h).toBe(8e-6);
    expect(stepAudit.layers[0]!.finalColumnInventoriesMolM2.h).toBeLessThan(8e-6);
    expect(stepAudit.layers[0]!.thirdBody).toMatchObject({ speciesId: 'N2', inventoryMolM2: 4.2e3 });
    expect(stepAudit.layers[0]!.thirdBody.concentrationMoleculeCm3).toBeGreaterThan(0);
    expect(stepAudit.layers[0]!.reactions[0]!.reactionId).toBe('kida-tb-2015-03-19-106');
    expect(stepAudit.layers[0]!.reactions[0]!.dataStatus).toBe('known');
    expect(stepAudit.layers[0]!.reactions[0]!.provenance.sourceName).toBeTruthy();
    expect(stepAudit.layers[0]!.reactions[0]!.uncertainty).toMatchObject({
      status: 'not_quantified',
      effectiveRate: null,
      lowPressureLimit: null,
      highPressureLimit: null
    });
    expect(stepAudit.layers[0]!.reactions[0]!.uncertainty.reason).toContain('не объединена');
    expect(stepAudit.layers[0]!.integration.method).toContain('radau');
    expect(updated.physicalKinetics!.layers[0]!.columnInventoriesMolM2.h).toBeLessThan(8e-6);

    const ledger = result.world.coreWorldState!.reactionLedger!.records;
    const kineticRecord = ledger.find((record) => record.reactionId === 'kida-tb-2015-03-19-106');
    expect(kineticRecord).toBeDefined();
    expect(kineticRecord!.processId).toBe(PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID);
    expect(kineticRecord!.extentBasis).toBe('column_amount');
    expect(kineticRecord!.extent).toBeGreaterThan(0);
    expect(result.world.coreWorldState!.clock.localTimeS).toBeCloseTo(result.stepSize!.effectiveDurationS, 12);
    expect(updated.modelTimeYears).toBeCloseTo(
      convert(quantity(result.stepSize!.effectiveDurationS, 's'), 'yr').value,
      12
    );
    expect(world.chemicalState!.inventory).toEqual(before);
    expect(world.coreWorldState).toBeUndefined();
  });

  it('executes the #89 NOx reaction in the primary ChemicalEvolutionState at its valid temperature', () => {
    const world = makePhysicalKineticWorld(250);
    const state = world.chemicalState!;
    const additions = { o: 1e-5, no: 5e-6, no2: 2e-7 };
    state.inventory = { ...state.inventory, ...additions };
    state.reservoirs = {
      ...state.reservoirs,
      atmospheric: { ...state.inventory }
    };
    state.physicalKinetics = {
      ...state.physicalKinetics!,
      maximumMacroStepS: 0.1,
      layers: [
        {
          layerId: 'explicit-nox-test-layer',
          layerThicknessM: 100,
          thicknessProvenance: {
            sourceName: 'synthetic integration test fixture',
            sourceId: 'fixture:layer-thickness',
            reference: 'test-only; not planetary source data'
          },
          temperatureK: 250,
          temperatureProvenance: {
            sourceName: 'synthetic integration test fixture',
            sourceId: 'fixture:layer-temperature',
            reference: 'test-only; not planetary source data'
          },
          columnInventoriesMolM2: {
            o: 1e-5,
            no: 5e-6,
            no2: 2e-7,
            n2: 4.2e3
          },
          inventoryProvenance: {
            sourceName: 'synthetic integration test fixture',
            sourceId: 'fixture:layer-inventory',
            reference: 'test-only; not planetary source data'
          },
          reactionIds: ['kida-tb-2015-03-19-89']
        }
      ]
    };
    const before = { ...state.inventory };
    const result = runChemicalEvolutionSchedulerStep(world);

    expect(result.status).toBe('committed');
    const updated = result.world.chemicalState!;
    expect(updated.inventory.o).toBeLessThan(before.o!);
    expect(updated.inventory.no).toBeLessThan(before.no!);
    expect(updated.inventory.no2).toBeGreaterThan(before.no2!);
    const audit = updated.physicalKineticsHistory![0]!;
    expect(audit.layers[0]!.reactions.map((reaction) => reaction.reactionId)).toEqual([
      'kida-tb-2015-03-19-89'
    ]);
    expect(audit.warnings.some((warning) => warning.includes('№89'))).toBe(true);
    const ledger = result.world.coreWorldState!.reactionLedger!.records;
    expect(ledger.some((record) =>
      record.reactionId === 'kida-tb-2015-03-19-89' &&
      record.processId === PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID &&
      record.extentBasis === 'column_amount'
    )).toBe(true);
  });

  it('executes both supported mechanisms together at their shared 300 K applicability boundary', () => {
    const world = makePhysicalKineticWorld(300);
    const state = world.chemicalState!;
    state.inventory = {
      ...state.inventory,
      o: 1e-5,
      no: 5e-6,
      no2: 2e-7
    };
    state.reservoirs = {
      ...state.reservoirs,
      atmospheric: { ...state.inventory }
    };
    const layer = state.physicalKinetics!.layers[0]!;
    layer.temperatureK = 300;
    layer.columnInventoriesMolM2 = {
      ...layer.columnInventoriesMolM2,
      o: 1e-5,
      no: 5e-6,
      no2: 2e-7
    };
    layer.reactionIds = [
      'kida-tb-2015-03-19-89',
      'kida-tb-2015-03-19-106'
    ];

    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    const updated = result.world.chemicalState!;
    expect(updated.inventory.o).toBeLessThan(1e-5);
    expect(updated.inventory.no).toBeLessThan(5e-6);
    expect(updated.inventory.no2).toBeGreaterThan(2e-7);
    expect(updated.inventory.h).toBeLessThan(8e-6);
    expect(updated.inventory.o2).toBeLessThan(state.inventory.o2);
    expect(updated.inventory.ho2).toBeGreaterThan(1e-8);
    expect(updated.physicalKineticsHistory![0]!.layers[0]!.reactions.map((r) => r.reactionId)).toEqual([
      'kida-tb-2015-03-19-89',
      'kida-tb-2015-03-19-106'
    ]);
    const records = result.world.coreWorldState!.reactionLedger!.records;
    expect(records.filter((r) => r.processId === PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID))
      .toHaveLength(2);
  });

  it('converges to the same 0.1 s trajectory when the macro step is halved', () => {
    const coarse = makePhysicalKineticWorld();
    coarse.chemicalState!.physicalKinetics!.maximumMacroStepS = 0.1;
    const coarseResult = runChemicalEvolutionSchedulerStep(coarse);
    expect(coarseResult.status).toBe('committed');
    expect(coarseResult.stepSize!.effectiveDurationS).toBeCloseTo(0.1, 12);

    const fine = makePhysicalKineticWorld();
    fine.chemicalState!.physicalKinetics!.maximumMacroStepS = 0.05;
    const firstHalf = runChemicalEvolutionSchedulerStep(fine);
    expect(firstHalf.status).toBe('committed');
    expect(firstHalf.stepSize!.effectiveDurationS).toBeCloseTo(0.05, 12);
    const secondHalf = runChemicalEvolutionSchedulerStep(firstHalf.world);
    expect(secondHalf.status).toBe('committed');
    expect(secondHalf.stepSize!.effectiveDurationS).toBeCloseTo(0.05, 12);

    const coarseState = coarseResult.world.chemicalState!;
    const fineState = secondHalf.world.chemicalState!;
    for (const speciesId of ['h', 'o2', 'ho2']) {
      const coarseAmount = coarseState.inventory[speciesId]!;
      const fineAmount = fineState.inventory[speciesId]!;
      const relativeDifference =
        Math.abs(coarseAmount - fineAmount) / Math.max(Math.abs(coarseAmount), Math.abs(fineAmount));
      expect(relativeDifference, speciesId + ' coarse/fine relative difference').toBeLessThan(5e-6);
    }
    expect(coarseResult.world.coreWorldState!.clock.localTimeS).toBeCloseTo(0.1, 12);
    expect(secondHalf.world.coreWorldState!.clock.localTimeS).toBeCloseTo(0.1, 12);
  });

  it('runs against an already existing synchronized CoreWorldState without rebuilding its scheduler history', () => {
    const world = makePhysicalKineticWorld();
    const core = coreWorldStateFromLegacyWorld({
      id: world.id,
      seed: world.seed,
      generatorVersion: world.generatorVersion,
      centralObjectSystem: world.centralObjectSystem ?? null,
      orbit: world.orbit ? { frame: world.orbit.frame } : null,
      bodyPhysics: world.bodyPhysics
        ? {
            massKg: world.bodyPhysics.massKg,
            radiusM: world.bodyPhysics.radiusM,
            densityKgM3: world.bodyPhysics.densityKgM3,
            surfaceGravityMs2: world.bodyPhysics.surfaceGravityMs2
          }
        : null,
      atmosphere: world.atmosphere
        ? {
            temperature: world.atmosphere.temperature,
            presetKind: world.atmosphere.presetKind,
            presetNotes: world.atmosphere.presetNotes,
            presetSourceName: world.atmosphere.presetSourceName
          }
        : null,
      energyBudget: world.energyBudget
        ? {
            incidentFlux: world.energyBudget.incidentFlux,
            equilibriumTemperature: world.energyBudget.equilibriumTemperature
          }
        : null,
      chemicalState: world.chemicalState!
    });
    // Этот fixture явно начинает с существующей Scheduler-истории:
    // adapter legacy → CoreWorldState сам по себе её не создаёт.
    const priorBookkeeping = scheduleProcess(
      createSchedulerBookkeeping(),
      'preexisting_scheduled_process',
      12
    );
    const seededCore = { ...core, scheduling: priorBookkeeping };
    const result = runChemicalEvolutionSchedulerStep({ ...world, coreWorldState: seededCore });

    expect(result.status).toBe('committed');
    expect(result.world.coreWorldState).not.toBe(seededCore);
    const updatedCore = result.world.coreWorldState;
    if (!updatedCore?.scheduling) throw new Error('committed physical step must preserve scheduler bookkeeping');
    expect(updatedCore.scheduling.stepCount).toBe(priorBookkeeping.stepCount + 1);
    expect(updatedCore.scheduling.processDynamics.preexisting_scheduled_process)
      .toEqual(priorBookkeeping.processDynamics.preexisting_scheduled_process);
    const updatedAtmosphere = updatedCore.reservoirs.find(
      (reservoir) => reservoir.id === CHEMICAL_RESERVOIR_IDS.atmospheric
    );
    expect(updatedAtmosphere?.material?.entries).toEqual(result.world.chemicalState!.inventory);
    expect(seededCore.scheduling).toEqual(priorBookkeeping);
    expect(world.chemicalState!.inventory.h).toBe(8e-6);
  });

  it('rejects a missing provenance or missing species instead of silently using zero or game mode', () => {
    const noProvenance = makePhysicalKineticWorld();
    noProvenance.chemicalState!.physicalKinetics!.layers[0]!.thicknessProvenance = {};
    const rejectedProvenance = runChemicalEvolutionSchedulerStep(noProvenance, { extentFraction: 0.9 });
    expect(rejectedProvenance.status).toBe('rejected');
    expect(rejectedProvenance.world).toBe(noProvenance);
    expect(rejectedProvenance.reason).toContain('thicknessProvenance');
    expect(vi.mocked(runMacroStep)).not.toHaveBeenCalled();

    const missingSpecies = makePhysicalKineticWorld();
    delete missingSpecies.chemicalState!.physicalKinetics!.layers[0]!.columnInventoriesMolM2.ho2;
    const rejectedSpecies = runChemicalEvolutionSchedulerStep(missingSpecies);
    expect(rejectedSpecies.status).toBe('rejected');
    expect(rejectedSpecies.world).toBe(missingSpecies);
    expect(rejectedSpecies.reason).toContain('отсутствует явный подстолбовой запас вида «ho2»');
    expect(vi.mocked(runMacroStep)).not.toHaveBeenCalled();
  });

  it('rejects layer material exceeding the primary atmospheric column inventory', () => {
    const world = makePhysicalKineticWorld();
    world.chemicalState!.physicalKinetics!.layers[0]!.columnInventoriesMolM2.n2 = 5000;
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.reason).toContain('превышает основной атмосферный инвентарь');
    expect(world.coreWorldState).toBeUndefined();
    expect(vi.mocked(runMacroStep)).not.toHaveBeenCalled();
  });

  it('temperature outside the rate record validity domain rejects before apply and preserves the world', () => {
    const world = makePhysicalKineticWorld(250);
    const before = JSON.stringify(world.chemicalState);
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.reason).toMatch(/температур|temperature|250/);
    expect(JSON.stringify(world.chemicalState)).toBe(before);
    expect(world.coreWorldState).toBeUndefined();
  });
});

// ============================================
// 2. ЯДРО И ЧЕТЫРЕ РЕЗЕРВУАРА
// ============================================

describe('Stage 4.2.3.3: инициализация ядра и перенос всех четырёх резервуаров', () => {
  it('отсутствующее ядро инициализируется безопасно: worldId, часы с нуля, согласованное состояние', () => {
    const world = makeGameWorld({ ch4: 0.6, o2: 0.4 });
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    const core = result.world.coreWorldState!;
    expect(core.worldId).toBe('world-1');
    expect(totalElapsedSeconds(core.clock)).toBeCloseTo(stepDurationSeconds(1e6), 6);
    expect(chemicalReservoirConsistencyIssues(core, result.world.chemicalState!)).toEqual([]);
  });

  it('все четыре резервуара переносятся в CoreWorldState с корректными id, kind и запасами', () => {
    const world = makeFourReservoirWorld();
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    const reservoirs = result.world.coreWorldState!.reservoirs;
    const byId = new Map(reservoirs.map((r) => [r.id, r]));
    expect(reservoirs).toHaveLength(4);
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.atmospheric)?.kind).toBe('atmosphere');
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.liquidSurface)?.kind).toBe('surface_liquid');
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.subsurfaceLiquid)?.kind).toBe('subsurface_liquid');
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.solidDeposits)?.kind).toBe('solid_deposits');
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.atmospheric)?.material?.entries).toEqual({ ch4: 60, o2: 40 });
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.liquidSurface)?.material?.entries).toEqual({ h2o: 5 });
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.subsurfaceLiquid)?.material?.entries).toEqual({ co2: 3 });
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.solidDeposits)?.material?.entries).toEqual({ c2h6: 7 });
    for (const res of reservoirs) {
      expect(res.material?.basis).toBe('arbitrary_units');
      expect(res.bodyId).toBe('planet');
    }
    // Stage 4.2.4: ЯВНАЯ проверка изоляции переноса от применения
    // реакций. 250 K ниже нижней границы allowedRanges.temperature
    // каждой реакции каталога, ВСЕ реагенты которой есть в фикстуре
    // (проверка every, а не some: co_oxidation содержит o2, но co в
    // фикстуре отсутствует — реакция НЕ применима, и проверка «хотя бы
    // один реагент» ошибочно считала бы её применимой).
    const chemicalState = result.world.chemicalState!;
    for (const reaction of chemicalReactions) {
      const hasAllReactants = reaction.reactants.every((p) => {
        const total =
          (chemicalState.reservoirs.atmospheric[p.gasId] ?? 0) +
          (chemicalState.reservoirs.liquidSurface[p.gasId] ?? 0) +
          (chemicalState.reservoirs.subsurfaceLiquid[p.gasId] ?? 0) +
          (chemicalState.reservoirs.solidDeposits[p.gasId] ?? 0);
        return total > 0;
      });
      if (hasAllReactants && reaction.allowedRanges.temperature) {
        expect(
          250 < reaction.allowedRanges.temperature.min || 250 > reaction.allowedRanges.temperature.max,
          'реакция ' + reaction.id + ' применима при 250 K — фикстура не изолирована'
        ).toBe(true);
      }
    }
    // Ни одна реакция не применена: перенос проверяется без побочных эффектов.
    expect(appliedRecordOf(result.world, 0)).toEqual([]);
    expect(result.world.chemicalState!.inventory).toEqual({ ch4: 60, o2: 40 });
  });

  it('основания column_amount и arbitrary_units не смешиваются: основание строго следует режиму', () => {
    // Игровой мир → arbitrary_units везде.
    const game = runChemicalEvolutionSchedulerStep(makeGameWorld({ ch4: 0.6, o2: 0.4 }));
    expect(game.status).toBe('committed');
    for (const res of game.world.coreWorldState!.reservoirs) {
      expect(res.material?.basis).toBe('arbitrary_units');
    }
    const gameLedger = game.world.coreWorldState!.reactionLedger!;
    expect(gameLedger.records.length).toBeGreaterThan(0);
    for (const record of gameLedger.records) {
      expect(record.extentBasis).toBe('arbitrary_units');
    }
    // Столбовой мир → column_amount везде.
    const column = runChemicalEvolutionSchedulerStep(makeColumnWorld());
    expect(column.status).toBe('committed');
    for (const res of column.world.coreWorldState!.reservoirs) {
      expect(res.material?.basis).toBe('column_amount');
    }
    for (const record of column.world.coreWorldState!.reactionLedger!.records) {
      expect(record.extentBasis).toBe('column_amount');
    }
  });
});

// ============================================
// 3. ЧИСЛЕННОЕ СОВПАДЕНИЕ С LEGACY
// ============================================

describe('Stage 4.2.3.3: численные результаты режима A совпадают с legacy-расчётом', () => {
  const checkPair = (
    scheduler: { status: string; world: GeneratedWorld },
    legacy: { world: GeneratedWorld }
  ): void => {
    expect(scheduler.status).toBe('committed');
    const a = scheduler.world.chemicalState!;
    const b = legacy.world.chemicalState!;
    // Реальные поля инвентарей, резервуаров и производных — не только
    // счётчики шагов.
    expect(a.mode).toBe(b.mode);
    expect(a.inventory).toEqual(b.inventory);
    expect(a.reservoirs).toEqual(b.reservoirs);
    expect(a.molarFractions).toEqual(b.molarFractions);
    expect(a.surfacePressurePa).toEqual(b.surfacePressurePa);
    expect(a.meanMolarMassKgMol).toEqual(b.meanMolarMassKgMol);
    expect(a.modelTimeYears).toEqual(b.modelTimeYears);
    expect(a.stepDurationYears).toEqual(b.stepDurationYears);
    expect(a.oxygenBalance).toEqual(b.oxygenBalance);
    expect(a.history).toEqual(b.history);
  };

  it('игровой (game_normalized) мир: инвентарь, история и кислородный баланс идентичны legacy', () => {
    const world = makeGameWorld({ ch4: 0.6, o2: 0.4 });
    checkPair(runChemicalEvolutionSchedulerStep(world), runChemicalEvolutionStep(world));
  });

  it('мультиреакционный мир (несколько окислений): идентичны legacy', () => {
    const fractions = { ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 };
    const world = makeGameWorld(fractions);
    const scheduler = runChemicalEvolutionSchedulerStep(world);
    expect(scheduler.world.chemicalState!.history.filter((r) => r.applied).length).toBeGreaterThanOrEqual(3);
    checkPair(scheduler, runChemicalEvolutionStep(world));
  });

  it('столбовой (column_inventory) мир: идентичен legacy', () => {
    const world = makeColumnWorld();
    checkPair(runChemicalEvolutionSchedulerStep(world), runChemicalEvolutionStep(world));
  });

  it('два одинаковых запуска на идентичных мирах дают одинаковый результат (детерминизм)', () => {
    const first = runChemicalEvolutionSchedulerStep(makeGameWorld({ ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 }));
    const second = runChemicalEvolutionSchedulerStep(makeGameWorld({ ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 }));
    expect(first.status).toBe('committed');
    expect(second.status).toBe('committed');
    expect(JSON.stringify(second.world)).toBe(JSON.stringify(first.world));
    expect(second.log).toEqual(first.log);
  });
});

// ============================================
// 4. СОГЛАСОВАННОСТЬ СОСТОЯНИЙ И ЖУРНАЛ РЕАКЦИЙ
// ============================================

describe('Stage 4.2.3.3: согласованность ядра, проекции и ReactionLedger после commit', () => {
  it('CoreWorldState и ChemicalEvolutionState согласованы по запасам всех резервуаров', () => {
    const world = makeFourReservoirWorld();
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    const core = result.world.coreWorldState!;
    const chemical = result.world.chemicalState!;
    expect(chemicalReservoirConsistencyIssues(core, chemical)).toEqual([]);
    // Проекция ядра воспроизводит инвентарь легаси-состояния.
    const projected = chemicalStateFromCoreReservoirs(core, chemical);
    expect(projected.inventory).toEqual(chemical.inventory);
    expect(projected.reservoirs).toEqual(chemical.reservoirs);
  });

  it('ReactionLedger содержит ТОЛЬКО фактически применённые реакции с корректными участниками', () => {
    const world = makeGameWorld({ ch4: 0.6, o2: 0.4 });
    const startIndex = world.chemicalState!.history.length;
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    const applied = appliedRecordOf(result.world, startIndex);
    expect(applied).toEqual([{ reactionId: 'ch4_oxidation', extent: 2 }]); // 0.1 × 20 (лимитирующий o2)
    const ledger = result.world.coreWorldState!.reactionLedger!;
    expect(ledger.records.map((r) => r.reactionId)).toEqual(['ch4_oxidation']);
    const record = ledger.records[0]!;
    const catalog = chemicalReactions.find((r) => r.id === 'ch4_oxidation')!;
    expect(record.reactants).toEqual(
      catalog.reactants.map((p) => ({ reservoirId: 'atmosphere', speciesId: p.gasId, coefficient: p.coefficient }))
    );
    expect(record.products).toEqual(
      catalog.products.map((p) => ({ reservoirId: 'atmosphere', speciesId: p.gasId, coefficient: p.coefficient }))
    );
    expect(record.extent).toBeCloseTo(2, 10);
    expect(record.extentBasis).toBe('arbitrary_units');
    expect(record.processId).toBe(CHEMICAL_EVOLUTION_STEP_PROCESS_ID);
    expect(record.time).toEqual({ segmentIndex: 0, localTimeS: 0 });
    // Неприменённые реакции каталога фиктивных записей не получают.
    const appliedIds = new Set(applied.map((r) => r.reactionId));
    for (const recordOfLedger of ledger.records) {
      expect(appliedIds.has(recordOfLedger.reactionId)).toBe(true);
    }
  });

  it('мультиреакционный шаг: все применённые реакции в журнале, id уникальны', () => {
    const world = makeGameWorld({ ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 });
    const startIndex = world.chemicalState!.history.length;
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    const applied = appliedRecordOf(result.world, startIndex);
    expect(applied.length).toBeGreaterThanOrEqual(3);
    const ledger = result.world.coreWorldState!.reactionLedger!;
    expect(ledger.records).toHaveLength(applied.length);
    const ids = new Set(ledger.records.map((r) => r.id));
    expect(ids.size).toBe(ledger.records.length);
    const appliedByReaction = new Map(applied.map((r) => [r.reactionId, r.extent]));
    for (const record of ledger.records) {
      expect(appliedByReaction.has(record.reactionId)).toBe(true);
      expect(record.extent).toBeCloseTo(appliedByReaction.get(record.reactionId)!, 10);
    }
  });

  it('элементный баланс не ослаблен: итоги элементов по всем резервуарам неизменны, аудит реакций balanced', () => {
    const world = makeGameWorld({ ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 });
    const before = elementTotalsOf(world.chemicalState!);
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    expect(elementTotalsOf(result.world.chemicalState!)).toEqual(before);
    // Аудит шага выполнен: секция reactions (стехиометрический
    // элементный/зарядовый баланс каждой записи) — balanced.
    const macro = vi.mocked(runMacroStep).mock.results[0]?.value as MacroStepResult | undefined;
    expect(macro).toBeDefined();
    expect(macro!.audit).toBeDefined();
    expect(macro!.audit!.status).not.toBe('imbalanced');
    const reactionsSection = macro!.audit!.sections.find((s) => s.key === 'reactions');
    expect(reactionsSection?.status).toBe('balanced');
    const reactionInventorySection = macro!.audit!.sections.find((s) => s.key === 'reaction_inventory');
    expect(reactionInventorySection?.status).toBe('balanced');
  });

  it('часы Scheduler продвигаются ровно на один шаг, модельное время — на stepDurationYears', () => {
    const world = makeGameWorld({ n2: 1 });
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('committed');
    const core = result.world.coreWorldState!;
    expect(totalElapsedSeconds(core.clock)).toBeCloseTo(stepDurationSeconds(1e6), 6);
    expect(core.scheduling?.stepCount).toBe(1);
    expect(core.scheduling?.stepLog).toHaveLength(1);
    expect(core.scheduling?.stepLog[0]).toMatchObject({
      stepIndex: 0,
      processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID,
      phase: 'lie',
      status: 'committed'
    });
    expect(result.world.chemicalState!.modelTimeYears).toBeCloseTo(1e6, 6);
  });
});

// ============================================
// 5. ОТКАЗЫ БЕЗ ЧАСТИЧНЫХ ИЗМЕНЕНИЙ
// ============================================

describe('Stage 4.2.3.3: отказ шага не меняет исходный мир, историю и часы', () => {
  it('ошибка оператора (дубликат записи журнала) возвращает исходный мир без изменений', () => {
    const world = makeGameWorld({ ch4: 0.6, o2: 0.4 });
    // Существующее согласованное ядро с уже занятым id будущей записи:
    // оператор упадёт на registerReaction (duplicate_reaction_id).
    const base = coreWorldStateFromLegacyWorld({
      id: world.id,
      seed: world.seed,
      generatorVersion: world.generatorVersion,
      atmosphere: { temperature: 600 },
      chemicalState: world.chemicalState!
    });
    const catalog = chemicalReactions.find((r) => r.id === 'ch4_oxidation')!;
    const conflicting: ReactionRecord = {
      id: 'chemical-evolution-step:0:ch4_oxidation',
      reactionId: 'ch4_oxidation',
      reactants: catalog.reactants.map((p) => ({ reservoirId: 'atmosphere', speciesId: p.gasId, coefficient: p.coefficient })),
      products: catalog.products.map((p) => ({ reservoirId: 'atmosphere', speciesId: p.gasId, coefficient: p.coefficient })),
      extent: 1,
      extentBasis: 'arbitrary_units',
      time: { segmentIndex: 0, localTimeS: 0 }
    };
    const core = {
      ...base,
      reactionLedger: registerReaction({ records: [] }, conflicting)
    };
    const worldWithCore = { ...world, coreWorldState: core } as GeneratedWorld;
    const historyBefore = world.chemicalState!.history.length;

    const result = runChemicalEvolutionSchedulerStep(worldWithCore);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('отклонён');
    // Исходный мир не изменён: та же ссылка, история и часы нетронуты.
    expect(result.world).toBe(worldWithCore);
    expect(result.world.chemicalState!.history).toHaveLength(historyBefore);
    expect(result.world.chemicalState!.modelTimeYears).toBe(0);
    expect(totalElapsedSeconds(result.world.coreWorldState!.clock)).toBe(0);
    expect(result.world.coreWorldState!.scheduling?.stepCount ?? 0).toBe(0);
  });

  it('существующее ядро с конфликтующим инвентарём НЕ перезаписывается легаси-состоянием', () => {
    const world = makeGameWorld({ ch4: 0.6, o2: 0.4 });
    const base = coreWorldStateFromLegacyWorld({
      id: world.id,
      seed: world.seed,
      generatorVersion: world.generatorVersion,
      atmosphere: { temperature: 600 },
      chemicalState: world.chemicalState!
    });
    // Конфликт: ядро содержит co2, которого нет в легаси-проекции.
    const conflictingCore = {
      ...base,
      reservoirs: base.reservoirs.map((res) =>
        res.id === CHEMICAL_RESERVOIR_IDS.atmospheric
          ? setMaterialInventory(res, 'arbitrary_units', { co2: 999 })
          : res
      )
    };
    const worldWithCore = { ...world, coreWorldState: conflictingCore } as GeneratedWorld;
    const result = runChemicalEvolutionSchedulerStep(worldWithCore);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('не согласованы');
    expect(result.world).toBe(worldWithCore);
    // Ядро не перезаписано: конфликтующий запас остался как был.
    const atmosphere = result.world.coreWorldState!.reservoirs.find(
      (r) => r.id === CHEMICAL_RESERVOIR_IDS.atmospheric
    )!;
    expect(atmosphere.material?.entries).toEqual({ co2: 999 });
    expect(result.world.chemicalState!.inventory).toEqual({ ch4: 60, o2: 40 });
    expect(result.world.chemicalState!.history).toHaveLength(0);
  });

  it('мир без химического состояния или без модели атмосферы — контролируемый отказ', () => {
    const noChemical = { ...makeGameWorld({ ch4: 0.6, o2: 0.4 }), chemicalState: undefined } as GeneratedWorld;
    const r1 = runChemicalEvolutionSchedulerStep(noChemical);
    expect(r1.status).toBe('rejected');
    expect(r1.world).toBe(noChemical);
    const noAtmosphere = { ...makeGameWorld({ ch4: 0.6, o2: 0.4 }), atmospherePhysics: undefined } as GeneratedWorld;
    const r2 = runChemicalEvolutionSchedulerStep(noAtmosphere);
    expect(r2.status).toBe('rejected');
    expect(r2.world).toBe(noAtmosphere);
  });
});

// ============================================
// 6. EXPLICIT_ONLY И ЗАПРЕТ ВЫДУМАННОГО τ
// ============================================

describe('Stage 4.2.3.3: explicit_only-процесс и запрет автоматического запуска', () => {
  const operator: ProcessOperator = {
    processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID,
    apply: (w) => w
  };

  it('дескриптор процесса шага химии: explicit_only, τ честно unknown, без фиктивного числа', () => {
    const registry = createChemicalEvolutionStepRegistry();
    const descriptor = registry.get(CHEMICAL_EVOLUTION_STEP_PROCESS_ID)!;
    expect(descriptor.executionMode).toBe('explicit_only');
    expect(isExplicitOnlyProcess(descriptor)).toBe(true);
    expect(descriptor.tau.status).toBe('unknown');
    expect(tauSeconds(descriptor.tau)).toBeNull();
    expect(validateProcessDescriptor(descriptor)).toEqual([]);
    // Не autorunnable: числового τ нет и не появится.
    expect(isProcessAutoRunnable(descriptor)).toBe(false);
    expect(processAvailability(descriptor)).toBe('unknown');
  });

  it('реестр Scheduler включает весь легаси-каталог, не активируя процессы с неизвестной физикой', () => {
    const legacyProcesses = createDefaultProcessRegistry();
    const registry = createChemicalEvolutionStepRegistry();

    expect(registry.list().map((entry) => entry.id)).toEqual([
      ...legacyProcesses.map((process) => process.id),
      CHEMICAL_EVOLUTION_STEP_PROCESS_ID
    ]);
    const physicalRegistry = createPhysicalChemicalEvolutionStepRegistry();
    const physical = physicalRegistry.get(PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID)!;
    expect(physical.executionMode).toBe('state_dependent');
    expect(physical.enabled).toBe(true);
    expect(physical.solverAvailability).toBe('available');
    expect(physical.tau.status).toBe('unknown');
    expect(tauSeconds(physical.tau)).toBeNull();
    expect(isProcessAutoRunnable(physical)).toBe(true);

    for (const process of legacyProcesses) {
      const descriptor = registry.get(process.id);
      expect(descriptor).not.toBeNull();
      expect(descriptor!.enabled).toBe(false);
      expect(descriptor!.solverAvailability).toBe('not_implemented');
      expect(descriptor!.tau.status).toBe('unknown');
      expect(tauSeconds(descriptor!.tau)).toBeNull();
      expect(isProcessAutoRunnable(descriptor!)).toBe(false);
    }
  });

  it('explicit_only не попадает в очередь автоматически готовых процессов', () => {
    const registry = createChemicalEvolutionStepRegistry();
    const bk = scheduleProcess(createSchedulerBookkeeping(), CHEMICAL_EVOLUTION_STEP_PROCESS_ID, 0);
    const ready = readyProcessIds(bk, registry, [operator], 0);
    expect(ready).not.toContain(CHEMICAL_EVOLUTION_STEP_PROCESS_ID);
  });

  it('автоматический запуск explicit_only через runMacroStep запрещён (explicit_only_process)', () => {
    const registry = createChemicalEvolutionStepRegistry();
    const world = createCoreWorldState('w');
    let code: string | null = null;
    try {
      runMacroStep(world, registry, [operator], {
        durationS: 1000,
        splitting: 'lie',
        processIds: [CHEMICAL_EVOLUTION_STEP_PROCESS_ID]
      });
    } catch (e) {
      expect(e).toBeInstanceOf(SchedulerError);
      code = (e as SchedulerError).code;
    }
    expect(code).toBe('explicit_only_process');
  });

  it('явный запуск с неизвестным τ выполняется: длительность задаёт вызывающая сторона', () => {
    const registry = createChemicalEvolutionStepRegistry();
    const world = createCoreWorldState('w');
    const result = runMacroStep(world, registry, [operator], {
      durationS: 1000,
      splitting: 'lie',
      processIds: [CHEMICAL_EVOLUTION_STEP_PROCESS_ID],
      explicit: { processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID }
    });
    expect(result.status).toBe('committed');
    expect(totalElapsedSeconds(result.world.clock)).toBeCloseTo(1000, 6);
    // τ процесса остался unknown: фиктивное числовое время не появилось.
    expect(tauSeconds(registry.get(CHEMICAL_EVOLUTION_STEP_PROCESS_ID)!.tau)).toBeNull();
  });

  it('обычный автономный процесс нельзя запустить явно в обход τ (not_explicit_only)', () => {
    const registry = createChemicalEvolutionStepRegistry();
    registry.register({
      id: 'normal_process',
      name: 'Обычный процесс с числовым τ',
      processKind: 'thermal',
      tau: knownValue(quantity(1000, 's')),
      stepPolicy: { kind: 'unspecified' },
      solverAvailability: 'available',
      enabled: true
    });
    const normalOperator: ProcessOperator = { processId: 'normal_process', apply: (w) => w };
    const world = createCoreWorldState('w');
    let code: string | null = null;
    try {
      runMacroStep(world, registry, [normalOperator], {
        durationS: 1000,
        splitting: 'lie',
        processIds: ['normal_process'],
        explicit: { processId: 'normal_process' }
      });
    } catch (e) {
      code = (e as SchedulerError).code;
    }
    expect(code).toBe('not_explicit_only');
  });

  it('явный запуск запрещает Strang, sub-cycling и несколько процессов шага', () => {
    const registry = createChemicalEvolutionStepRegistry();
    const world = createCoreWorldState('w');
    const expectCode = (opts: Parameters<typeof runMacroStep>[3]): string | null => {
      try {
        runMacroStep(world, registry, [operator], opts);
        return null;
      } catch (e) {
        return (e as SchedulerError).code;
      }
    };
    expect(
      expectCode({
        durationS: 1000,
        splitting: 'strang',
        processIds: [CHEMICAL_EVOLUTION_STEP_PROCESS_ID],
        explicit: { processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID }
      })
    ).toBe('invalid_splitting');
    expect(
      expectCode({
        durationS: 1000,
        splitting: 'lie',
        subCycles: 2,
        processIds: [CHEMICAL_EVOLUTION_STEP_PROCESS_ID],
        explicit: { processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID }
      })
    ).toBe('invalid_step');
  });

  it('каталог видов для аудита строится из легаси-данных без дублирования', () => {
    const catalog = buildSpeciesCatalogFromLegacy(gases, elementCompositions);
    expect(catalog.get('ch4')).not.toBeNull();
    expect(catalog.get('o2')).not.toBeNull();
    expect(catalog.get('co2')).not.toBeNull();
  });
});

// ============================================
// 7. НУЛИ И ПОВРЕЖДЁННЫЕ ЗНАЧЕНИЯ (STAGE 4.2.4)
// ============================================

describe('Stage 4.2.4: нулевые запасы сохраняются, повреждённые значения отклоняются атомарно', () => {
  it('явный ноль во всех четырёх резервуарах сохраняется при переносе в ядро и в обратной проекции', () => {
    const model = makeModel({ ch4: 0.6, o2: 0.4 });
    const chemicalState: ChemicalEvolutionState = {
      ...createChemicalState({ atmospherePhysicalModel: model }),
      inventory: { ch4: 0, o2: 5 },
      reservoirs: {
        atmospheric: { ch4: 0, o2: 5 },
        liquidSurface: { h2o: 0 },
        subsurfaceLiquid: { co2: 0 },
        solidDeposits: { c2h6: 3 }
      }
    };
    // Прямая конверсия: ноль — известное значение, НЕ отсутствие.
    const reservoirs = chemicalStateToCoreReservoirs(chemicalState);
    const byId = new Map(reservoirs.map((r) => [r.id, r]));
    expect(reservoirs).toHaveLength(4);
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.atmospheric)?.material?.entries).toEqual({ ch4: 0, o2: 5 });
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.liquidSurface)?.material?.entries).toEqual({ h2o: 0 });
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.subsurfaceLiquid)?.material?.entries).toEqual({ co2: 0 });
    expect(byId.get(CHEMICAL_RESERVOIR_IDS.solidDeposits)?.material?.entries).toEqual({ c2h6: 3 });
    // Ядро — источник состояния: обратная проекция сохраняет нули.
    const core = coreWorldStateFromLegacyWorld({
      id: 'w-zero',
      seed: 'seed-1',
      generatorVersion: '0.3.0',
      atmosphere: { temperature: 250 },
      chemicalState
    });
    const projected = chemicalStateFromCoreReservoirs(core, chemicalState);
    expect(projected.inventory).toEqual({ ch4: 0, o2: 5 });
    expect(projected.reservoirs).toEqual(chemicalState.reservoirs);
  });

  it.each([
    ['atmospheric', NaN],
    ['liquidSurface', Infinity],
    ['subsurfaceLiquid', -Infinity],
    ['solidDeposits', -1]
  ] as const)('повреждённое значение в резервуаре %s: инициализация ядра бросает, шаг возвращает rejected атомарно', (key, bad) => {
    const model = makeModel({ ch4: 0.6, o2: 0.4 });
    const reservoirs: ChemicalEvolutionState['reservoirs'] = {
      atmospheric: { ch4: 60, o2: 40 },
      liquidSurface: { h2o: 5 },
      subsurfaceLiquid: { co2: 3 },
      solidDeposits: { c2h6: 7 }
    };
    reservoirs[key] = { s: bad };
    // Типобезопасная структура четырёх резервуаров: без приведения всей
    // фикстуры к ChemicalEvolutionState. Повреждённое ЗНАЧЕНИЕ вносится
    // в типобезопасный контейнер; runtime-границей служит валидация ядра.
    const chemicalState: ChemicalEvolutionState = {
      ...createChemicalState({ atmospherePhysicalModel: model }),
      reservoirs
    };

    // Инициализация ядра напрямую: контролируемый отказ с диагностикой.
    // Канонические сообщения validateMaterialInventory (узкая формулировка
    // «не является конечным неотрицательным числом» живёт в другом слое —
    // readEntriesStrict обратной проекции, не в прямой конверсии).
    let initMessage = '';
    try {
      coreWorldStateFromLegacyWorld({
        id: 'w-bad',
        seed: 'seed-1',
        generatorVersion: '0.3.0',
        atmosphere: { temperature: 250 },
        chemicalState
      });
    } catch (error) {
      initMessage = error instanceof Error ? error.message : String(error);
    }
    expect(initMessage).not.toBe('');
    // Канонический валидатор проверяет КОНЕЧНОСТЬ раньше знака:
    // -Infinity отклоняется сообщением о конечности, и только конечное
    // отрицательное значение (-1) — сообщением об отрицательном запасе.
    if (Number.isFinite(bad) && bad < 0) {
      expect(initMessage).toMatch(/отрицательный запас вида «s» невозможен/);
    } else {
      expect(initMessage).toMatch(/количество вида «s» должно быть конечным числом/);
    }
    // Диагностика называет резервуар, вид и исходное повреждённое значение.
    expect(initMessage).toContain(CHEMICAL_RESERVOIR_IDS[key]);
    expect(initMessage).toContain('«s»');
    expect(initMessage).toContain(String(bad));

    // Пользовательский шаг: rejected, а не необработанное исключение.
    const world = {
      ...(makeGameWorld({ ch4: 0.6, o2: 0.4 }, 250) as unknown as Record<string, unknown>),
      chemicalState
    } as unknown as GeneratedWorld;
    const historyBefore = world.chemicalState!.history.length;
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('отклонена');
    // Атомарность: исходная ссылка мира, история, часы и инвентари нетронуты.
    expect(result.world).toBe(world);
    expect(result.world.chemicalState!.history).toHaveLength(historyBefore);
    expect(result.world.chemicalState!.modelTimeYears).toBe(0);
    expect(result.world.chemicalState!.inventory).toEqual({ ch4: 60, o2: 40 });
    expect(result.world.coreWorldState).toBeUndefined();
  });

  it('повреждённый инвентарь ядра: обратное преобразование отклоняется с диагностикой', () => {
    const model = makeModel({ ch4: 0.6, o2: 0.4 });
    const chemicalState = createChemicalState({ atmospherePhysicalModel: model });
    const core = coreWorldStateFromLegacyWorld({
      id: 'w-core',
      seed: 'seed-1',
      generatorVersion: '0.3.0',
      atmosphere: { temperature: 250 },
      chemicalState
    });
    const damagedCore = {
      ...core,
      reservoirs: core.reservoirs.map((r) =>
        r.id === CHEMICAL_RESERVOIR_IDS.atmospheric
          ? { ...r, material: { basis: 'arbitrary_units' as const, entries: { ch4: NaN, o2: 40 } } }
          : r
      )
    };
    // Обратная проекция: контролируемый отказ; сообщение называет
    // резервуар, вид и повреждённое значение (readEntriesStrict).
    let message = '';
    try {
      chemicalStateFromCoreReservoirs(damagedCore, chemicalState);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/не является конечным неотрицательным числом/);
    expect(message).toContain(CHEMICAL_RESERVOIR_IDS.atmospheric);
    expect(message).toContain('«ch4»');
    expect(message).toContain('NaN');
  });

  it('chemicalReservoirConsistencyIssues сообщает о повреждённых значениях обеих сторон', () => {
    const model = makeModel({ ch4: 0.6, o2: 0.4 });
    const chemicalState = {
      ...createChemicalState({ atmospherePhysicalModel: model }),
      reservoirs: {
        atmospheric: { ch4: NaN, o2: 40 },
        liquidSurface: { h2o: 5 },
        subsurfaceLiquid: { co2: 3 },
        solidDeposits: { c2h6: Infinity }
      }
    } as ChemicalEvolutionState;
    // Ядро строится из ВАЛИДНОГО состояния со всеми четырьмя резервуарами
    // (liquidSurface {h2o:5} реально присутствует в core.reservoirs),
    // затем повреждается ТОЛЬКО ядро liquidSurface: диагностируется именно
    // конфликт повреждённого ядра с легаси-проекцией, а не отсутствие
    // резервуара. Отдельно легаси-сторона повреждена в atmospheric/solidDeposits.
    const validState: ChemicalEvolutionState = {
      ...createChemicalState({ atmospherePhysicalModel: model }),
      reservoirs: {
        atmospheric: { ch4: 60, o2: 40 },
        liquidSurface: { h2o: 5 },
        subsurfaceLiquid: { co2: 3 },
        solidDeposits: { c2h6: 7 }
      }
    };
    const core = coreWorldStateFromLegacyWorld({
      id: 'w-cons',
      seed: 'seed-1',
      generatorVersion: '0.3.0',
      atmosphere: { temperature: 250 },
      chemicalState: validState
    });
    // Предусловие: целевой резервуар реально в ядре (иначе map — no-op).
    expect(
      core.reservoirs.find((r) => r.id === CHEMICAL_RESERVOIR_IDS.liquidSurface)?.material?.entries
    ).toEqual({ h2o: 5 });
    const damagedCore = {
      ...core,
      reservoirs: core.reservoirs.map((r) =>
        r.id === CHEMICAL_RESERVOIR_IDS.liquidSurface
          ? { ...r, material: { basis: 'arbitrary_units' as const, entries: { h2o: -5 } } }
          : r
      )
    };
    const issues = chemicalReservoirConsistencyIssues(damagedCore, chemicalState);
    const all = issues.join(' | ');
    expect(all).toContain('легаси-проекция, вид «ch4»');
    expect(all).toContain('NaN');
    expect(all).toContain('легаси-проекция, вид «c2h6»');
    expect(all).toContain('Infinity');
    expect(all).toContain('ядро, вид «h2o»');
    expect(all).toContain('-5');
  });
});

// ============================================
// 8. FAIL-CLOSED СТРУКТУРА ИНВЕНТАРЯ ЯДРА (STAGE 4.2.4)
// ============================================

describe('Stage 4.2.4: некорректная структура MaterialInventory ядра диагностируется без TypeError', () => {
  it.each([
    ['entries: null', null],
    ['entries: массив', [{ ch4: 1 }]]
  ] as const)('повреждённая структура (%s): согласованность диагностируется, обратная проекция и шаг отказывают контролируемо', (_name, brokenEntries) => {
    const model = makeModel({ ch4: 0.6, o2: 0.4 });
    const chemicalState = createChemicalState({ atmospherePhysicalModel: model });
    const core = coreWorldStateFromLegacyWorld({
      id: 'w-struct',
      seed: 'seed-1',
      generatorVersion: '0.3.0',
      atmosphere: { temperature: 250 },
      chemicalState
    });
    const damagedMaterial = {
      basis: 'arbitrary_units',
      entries: brokenEntries
    } as unknown as { basis: 'arbitrary_units'; entries: Record<string, number> };
    const damagedCore = {
      ...core,
      reservoirs: core.reservoirs.map((r) =>
        r.id === CHEMICAL_RESERVOIR_IDS.atmospheric ? { ...r, material: damagedMaterial } : r
      )
    };

    // Согласованность: диагностика повреждённой структуры, НЕ TypeError.
    let issues: string[] = [];
    expect(() => {
      issues = chemicalReservoirConsistencyIssues(damagedCore, chemicalState);
    }).not.toThrow();
    expect(issues.some((i) => i.includes('инвентарь ядра повреждён'))).toBe(true);

    // Обратная проекция: контролируемый отказ с диагностикой.
    expect(() => chemicalStateFromCoreReservoirs(damagedCore, chemicalState)).toThrow(/повреждён/);

    // Пользовательский шаг: rejected, исходный мир атомарно нетронут.
    const world = {
      ...(makeGameWorld({ ch4: 0.6, o2: 0.4 }, 250) as unknown as Record<string, unknown>),
      coreWorldState: damagedCore
    } as unknown as GeneratedWorld;
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.world.chemicalState!.inventory).toEqual({ ch4: 60, o2: 40 });
    expect(result.world.chemicalState!.history).toHaveLength(0);
    expect(
      result.world.coreWorldState!.reservoirs.find((r) => r.id === CHEMICAL_RESERVOIR_IDS.atmospheric)?.material
    ).toEqual(damagedMaterial);
  });
});


// ============================================
// 9. СТРОГАЯ ВАЛИДАЦИЯ ИНВЕНТАРЯ ЯДРА (STAGE 4.4.4.6)
// ============================================

describe('Stage 4.4.4.6: неверный basis и примитивные entries отклоняются без обхода', () => {
  /** Валидное ядро из корректного химического состояния со ВСЕМИ
   *  четырьмя непустыми резервуарами: chemicalStateToCoreReservoirs
   *  пропускает пустые легаси-резервуары, поэтому ядро из «голого»
   *  createChemicalState содержало бы только atmospheric, и повреждение
   *  любого другого резервуара через map() было бы тихим no-op.
   *  Фикстура обязана гарантировать реальное присутствие цели. */
  function validCore(id: string) {
    const model = makeModel({ ch4: 0.6, o2: 0.4 });
    const chemicalState: ChemicalEvolutionState = {
      ...createChemicalState({ atmospherePhysicalModel: model }),
      reservoirs: {
        atmospheric: { ch4: 60, o2: 40 },
        liquidSurface: { h2o: 5 },
        subsurfaceLiquid: { co2: 3 },
        solidDeposits: { c2h6: 7 }
      }
    };
    return {
      chemicalState,
      core: coreWorldStateFromLegacyWorld({
        id,
        seed: 'seed-1',
        generatorVersion: '0.3.0',
        atmosphere: { temperature: 250 },
        chemicalState
      })
    };
  }

  /** Повреждение material одного резервуара ядра (граница runtime-валидации).
   *  Предусловие: целевой резервуар реально присутствует в ядре и имеет
   *  material — иначе замена через map() ничего бы не изменила и тест
   *  проверял бы неизменённое ядро. */
  function withMaterial(
    core: ReturnType<typeof coreWorldStateFromLegacyWorld>,
    reservoirId: string,
    material: unknown
  ): ReturnType<typeof coreWorldStateFromLegacyWorld> {
    const target = core.reservoirs.find((r) => r.id === reservoirId);
    if (!target || !target.material) {
      throw new Error(
        'тестовая фикстура повреждена: резервуар «' +
          reservoirId +
          '» отсутствует в ядре или не имеет material — замена была бы no-op'
      );
    }
    return {
      ...core,
      reservoirs: core.reservoirs.map((r) =>
        r.id === reservoirId ? ({ ...r, material } as unknown as typeof r) : r
      )
    };
  }

  it.each([
    ['атмосферный', CHEMICAL_RESERVOIR_IDS.atmospheric],
    ['жидкий поверхностный', CHEMICAL_RESERVOIR_IDS.liquidSurface],
    ['подповерхностный жидкий', CHEMICAL_RESERVOIR_IDS.subsurfaceLiquid],
    ['твёрдые отложения', CHEMICAL_RESERVOIR_IDS.solidDeposits]
  ])('неверный basis в резервуаре «%s» отклоняется обратной проекцией и диагностируется согласованностью', (_name, reservoirId) => {
    const { chemicalState, core } = validCore('w-basis');
    const damagedCore = withMaterial(
      core,
      reservoirId,
      // Намеренно повреждённые данные: unknown-cast к границе
      // runtime-валидации, без ослабления типов production-кода.
      { basis: 'mol', entries: { ch4: 1 } } as unknown as { basis: 'arbitrary_units'; entries: Record<string, number> }
    );
    // Обратная проекция: контролируемая ошибка с указанием резервуара.
    expect(() => chemicalStateFromCoreReservoirs(damagedCore, chemicalState)).toThrow(/повреждён/);
    // Согласованность: диагностика без TypeError.
    let issues: string[] = [];
    expect(() => {
      issues = chemicalReservoirConsistencyIssues(damagedCore, chemicalState);
    }).not.toThrow();
    expect(issues.some((i) => i.includes('инвентарь ядра повреждён'))).toBe(true);
  });

  it.each([
    ['число', 42],
    ['строка', 'мусор'],
    ['массив', [{ ch4: 1 }]],
    ['null', null]
  ] as const)('malformed entries (%s) в атмосферном резервуаре отклоняются контролируемо', (_name, brokenEntries) => {
    const { chemicalState, core } = validCore('w-entries');
    const damagedCore = withMaterial(
      core,
      CHEMICAL_RESERVOIR_IDS.atmospheric,
      { basis: 'arbitrary_units', entries: brokenEntries } as unknown as {
        basis: 'arbitrary_units';
        entries: Record<string, number>;
      }
    );
    expect(() => chemicalStateFromCoreReservoirs(damagedCore, chemicalState)).toThrow(/повреждён/);
    let issues: string[] = [];
    expect(() => {
      issues = chemicalReservoirConsistencyIssues(damagedCore, chemicalState);
    }).not.toThrow();
    expect(issues.some((i) => i.includes('инвентарь ядра повреждён'))).toBe(true);
  });

  it('структурно некорректный инвентарь не становится допустимым из-за корректных чисел', () => {
    const { chemicalState, core } = validCore('w-struct');
    const damagedCore = withMaterial(
      core,
      CHEMICAL_RESERVOIR_IDS.liquidSurface,
      // Числа корректны, но basis неизвестен: отклонение обязательно.
      { basis: 'moles_per_liter', entries: { h2o: 5 } } as unknown as {
        basis: 'arbitrary_units';
        entries: Record<string, number>;
      }
    );
    expect(() => chemicalStateFromCoreReservoirs(damagedCore, chemicalState)).toThrow(
      /резервуар «.*»: инвентарь ядра повреждён/
    );
  });

  it.each([
    ['NaN', Number.NaN],
    ['+Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['отрицательное', -1]
  ] as const)('повреждённое числовое значение (%s) в неатмосферном резервуаре отклоняется с диагностикой вида', (_name, bad) => {
    const { chemicalState, core } = validCore('w-value');
    const damagedCore = withMaterial(
      core,
      CHEMICAL_RESERVOIR_IDS.solidDeposits,
      { basis: 'arbitrary_units', entries: { c2h6: bad } } as unknown as {
        basis: 'arbitrary_units';
        entries: Record<string, number>;
      }
    );
    // Обратная проекция: контролируемый отказ (readEntriesStrict);
    // сообщение называет резервуар, вид и исходное повреждённое значение.
    let valueMessage = '';
    try {
      chemicalStateFromCoreReservoirs(damagedCore, chemicalState);
    } catch (error) {
      valueMessage = error instanceof Error ? error.message : String(error);
    }
    expect(valueMessage).toMatch(/не является конечным неотрицательным числом/);
    expect(valueMessage).toContain(CHEMICAL_RESERVOIR_IDS.solidDeposits);
    expect(valueMessage).toContain('«c2h6»');
    expect(valueMessage).toContain(String(bad));
  });

  it('явный ноль в корректной структуре остаётся допустимым (контракт 4.2.4 сохранён)', () => {
    const { chemicalState, core } = validCore('w-zero');
    const zeroCore = withMaterial(
      core,
      CHEMICAL_RESERVOIR_IDS.atmospheric,
      { basis: 'arbitrary_units', entries: { ch4: 0, o2: 0 } }
    );
    const projected = chemicalStateFromCoreReservoirs(zeroCore, chemicalState);
    // Явный ноль сохраняется в обратной проекции (не отсутствие).
    expect(projected.inventory).toEqual({ ch4: 0, o2: 0 });
    expect(projected.reservoirs.atmospheric).toEqual({ ch4: 0, o2: 0 });
  });

  it('пользовательский шаг с повреждённым ядром возвращает rejected атомарно, без побочных изменений', () => {
    // Легаси-состояние согласовано с ядром (те же четыре резервуара):
    // единственный источник отказа — повреждённый basis в ядре.
    const { chemicalState, core } = validCore('w-rejected');
    const damagedCore = withMaterial(
      core,
      CHEMICAL_RESERVOIR_IDS.atmospheric,
      { basis: 'mol', entries: { ch4: 1 } } as unknown as { basis: 'arbitrary_units'; entries: Record<string, number> }
    );
    const world = {
      ...(makeGameWorld({ ch4: 0.6, o2: 0.4 }, 250) as unknown as Record<string, unknown>),
      chemicalState,
      coreWorldState: damagedCore
    } as unknown as GeneratedWorld;
    const result = runChemicalEvolutionSchedulerStep(world);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('неизвестное основание инвентаря');
    expect(result.world).toBe(world);
    expect(result.world.chemicalState!.inventory).toEqual({ ch4: 60, o2: 40 });
    expect(
      result.world.coreWorldState!.reservoirs.find((r) => r.id === CHEMICAL_RESERVOIR_IDS.atmospheric)?.material
    ).toEqual({ basis: 'mol', entries: { ch4: 1 } });
  });
});
