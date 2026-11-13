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
  createChemicalEvolutionStepRegistry,
  createChemicalState,
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
import type { AtmospherePhysicalModel, ChemicalEvolutionState, GeneratedWorld } from '../../types';

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
    // каждой реакции каталога, ВСЕ реагенты которой есть в фикс­туре
    // (проверка every, а не some: co_oxidation содержит o2, но co в
    // фикстуре отсутствует — реакция НЕ применима, и проверка «хотя бы
    // один реагент» ошибочно считала бы её применимой).
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
          `реакция ${reaction.id} применима при 250 K — фикс­тура не изолирована`
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
    const reservoirs: Record<string, Record<string, number>> = {
      atmospheric: { ch4: 60, o2: 40 },
      liquidSurface: { h2o: 5 },
      subsurfaceLiquid: { co2: 3 },
      solidDeposits: { c2h6: 7 }
    };
    reservoirs[key] = { s: bad };
    const chemicalState = {
      ...createChemicalState({ atmospherePhysicalModel: model }),
      reservoirs
    } as ChemicalEvolutionState;

    // Инициализация ядра напрямую: контролируемый отказ с диагностикой.
    expect(() =>
      coreWorldStateFromLegacyWorld({
        id: 'w-bad',
        seed: 'seed-1',
        generatorVersion: '0.3.0',
        atmosphere: { temperature: 250 },
        chemicalState
      })
    ).toThrow(/не является конечным неотрицательным числом/);

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
          ? { ...r, material: { basis: 'arbitrary_units', entries: { ch4: NaN, o2: 40 } } }
          : r
      )
    };
    expect(() => chemicalStateFromCoreReservoirs(damagedCore, chemicalState)).toThrow(
      /не является конечным неотрицательным числом/
    );
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
    // Ядро из валидного состояния, повреждение вносится вручную.
    const core = coreWorldStateFromLegacyWorld({
      id: 'w-cons',
      seed: 'seed-1',
      generatorVersion: '0.3.0',
      atmosphere: { temperature: 250 },
      chemicalState: createChemicalState({ atmospherePhysicalModel: model })
    });
    const damagedCore = {
      ...core,
      reservoirs: core.reservoirs.map((r) =>
        r.id === CHEMICAL_RESERVOIR_IDS.liquidSurface
          ? { ...r, material: { basis: 'arbitrary_units', entries: { h2o: -5 } } }
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
