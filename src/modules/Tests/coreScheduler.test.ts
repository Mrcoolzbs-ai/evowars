// ============================================
// STAGE 4.2.1 - Тесты планировщика физических процессов
// ============================================
//
// Планировщик управляет ПОРЯДКОМ операторов; мировое время
// продвигается ровно один раз за macro-шаг; Lie/Strang splitting
// проверяется на ТЕСТОВЫХ операторах (доказывается порядок вызовов,
// а не точность физических решателей); шаг атомарен: ошибка
// оператора, самовольное продвижение часов или нарушение инвариантов
// отклоняют шаг без фиксации частичного состояния.

import { describe, it, expect } from 'vitest';
import {
  SchedulerError,
  createSchedulerBookkeeping,
  dueEvents,
  enqueueEvent,
  nextEventTime,
  pendingEvents,
  processEvent,
  processWorldEvent,
  processDueWorldEvents,
  runScheduledWorldTurn,
  readyProcessIds,
  readyProcessIdsAt,
  runReadyProcessesAt,
  runMacroStep,
  scheduleProcess,
  scheduleProcessAt,
  sortedEvents,
  validateSchedulerBookkeeping
} from '../Core/scheduler';
import type { ProcessOperator } from '../Core/scheduler';
import { createProcessRegistry } from '../Core/processRegistry';
import type { ProcessDescriptor, ProcessRegistry } from '../Core/processRegistry';
import { knownValue, unknownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { createCoreWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { advance, createSimulationClock } from '../Core/simulationClock';
import { createReservoir, setEnergyInventory, setMaterialInventory } from '../Core/reservoir';
import { createSpeciesCatalog } from '../Core/species';
import { registerReaction } from '../Core/reactionLedger';
import type { ReactionLedger, ReactionRecord } from '../Core/reactionLedger';
import { applyFlux, createFluxLedger, EXTERNAL, registerFlux, revertFlux } from '../Core/fluxLedger';
import type { ReservoirRecord } from '../Core/reservoir';

function descriptor(id: string, overrides?: Partial<ProcessDescriptor>): ProcessDescriptor {
  return {
    id,
    name: 'Процесс ' + id,
    processKind: 'chemical',
    tau: knownValue(quantity(1000, 's')),
    stepPolicy: { kind: 'unspecified' },
    solverAvailability: 'available',
    enabled: true,
    ...overrides
  };
}

function makeRegistry(descriptors: ProcessDescriptor[]) {
  const registry = createProcessRegistry();
  for (const d of descriptors) registry.register(d);
  return registry;
}

function testWorld(): CoreWorldState {
  const res = setEnergyInventory(
    setMaterialInventory(createReservoir('atm', 'atmosphere'), 'amount', { co2: 100 }),
    { storedJ: 0, netPowerW: null, fluxW_m2: null }
  );
  return { ...createCoreWorldState('w'), reservoirs: [res] };
}

function co2Catalog() {
  const catalog = createSpeciesCatalog();
  catalog.register({
    id: 'co2',
    formula: 'CO2',
    name: 'диоксид углерода',
    elements: { c: 1, o: 2 },
    charge: 0,
    phase: 'gas',
    molarMassKgMol: 0.044,
    molarMassStatus: 'known',
    dataStatus: 'known'
  });
  return catalog;
}

interface Call {
  processId: string;
  durationS: number;
  intervalStartS: number;
}

function recorder(processId: string, calls: Call[]): ProcessOperator {
  return {
    processId,
    apply: (world, durationS, intervalStartS) => {
      calls.push({ processId, durationS, intervalStartS });
      return world;
    }
  };
}

function expectSchedulerError(fn: () => unknown, code: string): void {
  let thrown = false;
  let actual: string | null = null;
  try {
    fn();
  } catch (e) {
    if (e instanceof SchedulerError) {
      thrown = true;
      actual = e.code;
    } else {
      throw e;
    }
  }
  expect(thrown).toBe(true);
  expect(actual).toBe(code);
}

describe('Stage 4.2.1 Scheduler: детерминированный порядок и Lie splitting', () => {
  it('Lie: операторы по умолчанию сортируются по id (вход [b, a] → порядок a, b)', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const calls: Call[] = [];
    const result = runMacroStep(world, registry, [recorder('b', calls), recorder('a', calls)], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('committed');
    expect(calls.map((c) => c.processId)).toEqual(['a', 'b']);
    expect(calls.map((c) => c.durationS)).toEqual([10, 10]);
    expect(calls.map((c) => c.intervalStartS)).toEqual([0, 0]);
  });

  it('Lie: явный порядок processIds уважается', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const calls: Call[] = [];
    const result = runMacroStep(world, registry, [recorder('a', calls), recorder('b', calls)], {
      durationS: 10,
      splitting: 'lie',
      processIds: ['b', 'a']
    });
    expect(result.status).toBe('committed');
    expect(calls.map((c) => c.processId)).toEqual(['b', 'a']);
  });

  it('один macro-шаг — одно продвижение WorldClock; журнал и динамика зафиксированы', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const result = runMacroStep(world, registry, [recorder('a', []), recorder('b', [])], { durationS: 10, splitting: 'lie' });
    expect(result.world.clock.localTimeS).toBe(10);
    expect(result.world.clock.stepCount).toBe(1);
    expect(result.bookkeeping.stepCount).toBe(1);
    expect(result.world.scheduling?.stepCount).toBe(1);
    const dynA = result.bookkeeping.processDynamics['a'];
    expect(dynA.macroStepsCompleted).toBe(1);
    expect(dynA.operatorCallsCompleted).toBe(1);
    expect(dynA.lastRunElapsedS).toBe(10);
    expect(dynA.lastRunTime).toEqual({ segmentIndex: 0, localTimeS: 10 });
    expect(result.log.every((entry) => entry.status === 'committed' && entry.phase === 'lie')).toBe(true);
    expect(result.log[0]!.worldStartTime).toEqual({ segmentIndex: 0, localTimeS: 0 });
    expect(result.log[0]!.worldEndTime).toEqual({ segmentIndex: 0, localTimeS: 10 });
    expect(result.bookkeeping.stepLog[0]!.worldStartTime).toEqual({ segmentIndex: 0, localTimeS: 0 });
    expect(result.bookkeeping.stepLog[0]!.worldEndTime).toEqual({ segmentIndex: 0, localTimeS: 10 });
    expect(validateSchedulerBookkeeping(result.bookkeeping)).toEqual([]);
  });
});

describe('Stage 4.2.1 Scheduler: точное время последнего запуска', () => {
  it('сохраняет последний запуск в точной сегментированной координате при большом elapsed-времени', () => {
    const registry = makeRegistry([descriptor('a')]);
    const largeClock = advance(createSimulationClock(), 1e16);
    const world = { ...testWorld(), clock: largeClock };
    const exact = runMacroStep(world, registry, [recorder('a', [])], {
      durationS: 2,
      splitting: 'lie'
    });
    expect(exact.status).toBe('committed');
    expect(exact.world.clock.segmentIndex).toBe(0);
    expect(exact.world.clock.localTimeS).toBe(1e16 + 2);
    expect(exact.bookkeeping.processDynamics.a!.lastRunTime).toEqual({
      segmentIndex: 0,
      localTimeS: 1e16 + 2
    });

    const rounded = runMacroStep(world, registry, [recorder('a', [])], {
      durationS: 3,
      splitting: 'lie'
    });
    expect(rounded.status).toBe('committed');
    expect(rounded.world.clock.segmentIndex).toBe(1);
    expect(rounded.world.clock.localTimeS).toBe(3);
    expect(rounded.bookkeeping.processDynamics.a!.lastRunTime).toEqual({
      segmentIndex: 1,
      localTimeS: 3
    });
  });
});

describe('Stage 4.2.1 Scheduler: Strang splitting', () => {
  it('Strang: A(dt/2) → B(dt) → A(dt/2) с точными интервалами', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const calls: Call[] = [];
    const result = runMacroStep(world, registry, [recorder('a', calls), recorder('b', calls)], { durationS: 10, splitting: 'strang' });
    expect(result.status).toBe('committed');
    // Стадия 4.2.1.2: подынтервалы — физические; B интегрирует [0, dt]
    // (полный шаг B-динамики внутри macro-шага), а не [dt/2, 3dt/2]
    expect(calls).toEqual([
      { processId: 'a', durationS: 5, intervalStartS: 0 },
      { processId: 'b', durationS: 10, intervalStartS: 0 },
      { processId: 'a', durationS: 5, intervalStartS: 5 }
    ]);
    expect(result.log.map((e) => e.phase)).toEqual(['strang_a_half_first', 'strang_b_full', 'strang_a_half_second']);
    // единое продвижение мирового времени после macro-шага
    expect(result.world.clock.localTimeS).toBe(10);
    expect(result.world.clock.stepCount).toBe(1);
    expect(result.bookkeeping.processDynamics['a'].operatorCallsCompleted).toBe(2);
    expect(result.bookkeeping.processDynamics['a'].macroStepsCompleted).toBe(1);
  });

  it('Strang: sub-cycling и число процессов ≠ 2 отклоняются', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b'), descriptor('c')]);
    expectSchedulerError(
      () => runMacroStep(world, registry, [recorder('a', []), recorder('b', [])], { durationS: 10, splitting: 'strang', subCycles: 2 }),
      'invalid_splitting'
    );
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, [recorder('a', []), recorder('b', []), recorder('c', [])], {
          durationS: 10,
          splitting: 'strang',
          processIds: ['a', 'b', 'c']
        }),
      'invalid_splitting'
    );
    expectSchedulerError(
      () => runMacroStep(world, registry, [recorder('a', [])], { durationS: 10, splitting: 'strang', processIds: ['a'] }),
      'invalid_splitting'
    );
  });
});

describe('Stage 4.2.1.2 Scheduler: дублирующиеся processId запрещены', () => {
  it('Strang с processIds [a, a] отклоняется: два одинаковых id — не два процесса', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const calls: Call[] = [];
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, [recorder('a', calls), recorder('b', calls)], {
          durationS: 10,
          splitting: 'strang',
          processIds: ['a', 'a']
        }),
      'duplicate_process_id'
    );
    // отказ ДО выполнения первого оператора: мир и часы не тронуты
    expect(calls).toEqual([]);
    expect(world.clock.localTimeS).toBe(0);
    expect(world.clock.stepCount).toBe(0);
    expect(world.scheduling).toBeUndefined();
  });

  it('Lie с повторяющимся processId отклоняется', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const calls: Call[] = [];
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, [recorder('a', calls)], {
          durationS: 10,
          splitting: 'lie',
          processIds: ['a', 'a']
        }),
      'duplicate_process_id'
    );
    expect(calls).toEqual([]);
    expect(world.clock.localTimeS).toBe(0);
  });

  it('два оператора с одним processId отклоняются явно, без молчаливой перезаписи', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const first: Call[] = [];
    const second: Call[] = [];
    expectSchedulerError(
      () => runMacroStep(world, registry, [recorder('a', first), recorder('a', second)], { durationS: 10, splitting: 'lie' }),
      'duplicate_process_id'
    );
    // ни первый, ни «перезаписавший» его оператор не вызваны
    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(world.clock.localTimeS).toBe(0);
  });
});

describe('Stage 4.2.1.2 Scheduler: физические подынтервалы операторов', () => {
  it('Strang: подынтервалы всех вызовов лежат внутри [0, dt] и согласованы с композицией', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const calls: Call[] = [];
    const dt = 10;
    const result = runMacroStep(world, registry, [recorder('a', calls), recorder('b', calls)], { durationS: dt, splitting: 'strang' });
    expect(result.status).toBe('committed');
    expect(calls.length).toBe(3);
    for (const call of calls) {
      expect(call.intervalStartS).toBeGreaterThanOrEqual(0);
      expect(call.intervalStartS + call.durationS).toBeLessThanOrEqual(dt);
    }
    // согласованность композиции: A — [0, dt/2], B — [0, dt] (полный
    // шаг ВНУТРИ macro-шага), второй A — [dt/2, dt]
    expect(calls[0]).toEqual({ processId: 'a', durationS: 5, intervalStartS: 0 });
    expect(calls[1]).toEqual({ processId: 'b', durationS: 10, intervalStartS: 0 });
    expect(calls[2]).toEqual({ processId: 'a', durationS: 5, intervalStartS: 5 });
  });

  it('журнал Strang фиксирует те же физические подынтервалы, что и вызовы операторов', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const result = runMacroStep(world, registry, [recorder('a', []), recorder('b', [])], { durationS: 10, splitting: 'strang' });
    expect(result.status).toBe('committed');
    expect(result.log.map((e) => [e.phase, e.durationS, e.intervalStartS])).toEqual([
      ['strang_a_half_first', 5, 0],
      ['strang_b_full', 10, 0],
      ['strang_a_half_second', 5, 5]
    ]);
  });

  it('Lie sub-cycling: подшаги последовательно покрывают [0, dt] и не выходят за него', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const calls: Call[] = [];
    const dt = 10;
    const result = runMacroStep(world, registry, [recorder('a', calls)], { durationS: dt, splitting: 'lie', subCycles: 4 });
    expect(result.status).toBe('committed');
    for (const call of calls) {
      expect(call.intervalStartS).toBeGreaterThanOrEqual(0);
      expect(call.intervalStartS + call.durationS).toBeLessThanOrEqual(dt);
    }
    expect(calls.map((c) => [c.durationS, c.intervalStartS])).toEqual([
      [2.5, 0],
      [2.5, 2.5],
      [2.5, 5],
      [2.5, 7.5]
    ]);
  });
});

describe('Stage 4.2.1.2 Scheduler: непригодное τ не запускается', () => {
  it('процесс с неположительным τ не запускается даже при прямом вызове (fail-closed)', () => {
    const world = testWorld();
    const bad = descriptor('neg', { tau: knownValue(quantity(-2, 'h')) });
    // реестр, собранный в обход register(): runMacroStep обязан быть
    // защищён и от дескрипторов, не прошедших валидацию реестра
    const registry: ProcessRegistry = {
      register: () => {
        throw new Error('register не используется в этом тесте');
      },
      get: (processId) => (processId === 'neg' ? bad : null),
      has: (processId) => processId === 'neg',
      list: () => [bad]
    };
    const calls: Call[] = [];
    expectSchedulerError(
      () => runMacroStep(world, registry, [recorder('neg', calls)], { durationS: 10, splitting: 'lie' }),
      'process_tau_unknown'
    );
    expect(calls).toEqual([]);
    expect(world.clock.localTimeS).toBe(0);
  });
});

describe('Stage 4.2.1 Scheduler: sub-cycling', () => {
  it('Lie sub-cycling: равные подшаги, порядок и локальное время сохранены', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const calls: Call[] = [];
    const result = runMacroStep(world, registry, [recorder('a', calls)], { durationS: 10, splitting: 'lie', subCycles: 4 });
    expect(result.status).toBe('committed');
    expect(calls.map((c) => c.durationS)).toEqual([2.5, 2.5, 2.5, 2.5]);
    expect(calls.map((c) => c.intervalStartS)).toEqual([0, 2.5, 5, 7.5]);
    expect(result.log.every((e) => e.phase === 'subcycle')).toBe(true);
    expect(result.bookkeeping.processDynamics['a'].operatorCallsCompleted).toBe(4);
    // подшаги не двигают мировое время: продвижение — одно, после macro-шага
    expect(result.world.clock.localTimeS).toBe(10);
    expect(result.world.clock.stepCount).toBe(1);
  });
});

describe('Stage 4.2.1 Scheduler: отказы запуска', () => {
  it('некорректные durationS/subCycles → invalid_step', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const op: ProcessOperator = recorder('a', []);
    expectSchedulerError(() => runMacroStep(world, registry, [op], { durationS: 0, splitting: 'lie' }), 'invalid_step');
    expectSchedulerError(() => runMacroStep(world, registry, [op], { durationS: -3, splitting: 'lie' }), 'invalid_step');
    expectSchedulerError(() => runMacroStep(world, registry, [op], { durationS: Number.NaN, splitting: 'lie' }), 'invalid_step');
    expectSchedulerError(() => runMacroStep(world, registry, [op], { durationS: 10, splitting: 'lie', subCycles: 0 }), 'invalid_step');
  });

  it('незарегистрированный процесс → unknown_process', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    expectSchedulerError(
      () => runMacroStep(world, registry, [recorder('x', [])], { durationS: 10, splitting: 'lie', processIds: ['x'] }),
      'unknown_process'
    );
  });

  it('отключённый процесс не запускается автоматически → process_disabled', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('off', { enabled: false })]);
    expectSchedulerError(() => runMacroStep(world, registry, [recorder('off', [])], { durationS: 10, splitting: 'lie' }), 'process_disabled');
  });

  it('неизвестное tau → process_tau_unknown', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('u', { tau: unknownValue('числовое τ неизвестно') })]);
    expectSchedulerError(() => runMacroStep(world, registry, [recorder('u', [])], { durationS: 10, splitting: 'lie' }), 'process_tau_unknown');
  });

  it('решатель не реализован → solver_unavailable', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('n', { solverAvailability: 'not_implemented' })]);
    expectSchedulerError(() => runMacroStep(world, registry, [recorder('n', [])], { durationS: 10, splitting: 'lie' }), 'solver_unavailable');
  });

  it('отсутствие runtime-оператора → solver_unavailable', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    expectSchedulerError(
      () => runMacroStep(world, registry, [recorder('b', [])], { durationS: 10, splitting: 'lie', processIds: ['a'] }),
      'solver_unavailable'
    );
  });
});

describe('Stage 4.2.1 Scheduler: атомарность macro-шага', () => {
  it('ошибка оператора: шаг отклонён, исходное состояние и время сохранены', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const failing: ProcessOperator = {
      processId: 'b',
      apply: () => {
        throw new Error('оператор сломан');
      }
    };
    const result = runMacroStep(world, registry, [recorder('a', []), failing], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(result.log.every((e) => e.status === 'rejected')).toBe(true);
    expect(result.log.length).toBe(2);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('оператор не имеет права двигать мировое время — шаг отклонён', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const mover: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({ ...w, clock: { ...w.clock, localTimeS: w.clock.localTimeS + 1 } })
    };
    const result = runMacroStep(world, registry, [mover], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(result.diagnostics.join(' ').includes('продвинул мировое время')).toBe(true);
  });

  it('мусорный возврат оператора — шаг отклонён', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const junk: ProcessOperator = {
      processId: 'a',
      apply: () => null as unknown as CoreWorldState
    };
    const result = runMacroStep(world, registry, [junk], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
  });
});

describe('Stage 4.2.1 Scheduler: повторяемость', () => {
  it('одинаковый вход — одинаковый выход', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const run = () => runMacroStep(world, registry, [recorder('a', []), recorder('b', [])], { durationS: 10, splitting: 'strang' });
    const first = run();
    const second = run();
    expect(JSON.stringify({ status: second.status, world: second.world, bookkeeping: second.bookkeeping, log: second.log })).toBe(
      JSON.stringify({ status: first.status, world: first.world, bookkeeping: first.bookkeeping, log: first.log })
    );
  });
});

describe('Stage 4.2.1 Scheduler: аудит инвариантов шага', () => {
  it('сбалансированный переход фиксируется; аудит — balanced', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const result = runMacroStep(world, registry, [recorder('a', [])], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: co2Catalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.audit?.status).toBe('balanced');
    expect(result.audit?.balanced).toBe(true);
    expect(result.world.clock.localTimeS).toBe(10);
  });

  it('нарушение инвариантов: шаг отклонён, время не продвигается, состояние не фиксируется', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const leaking: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reservoirs: w.reservoirs.map((r) =>
          r.id === 'atm' ? { ...r, material: { basis: 'amount', entries: { co2: 97 } } } : r
        )
      })
    };
    const result = runMacroStep(world, registry, [leaking], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: co2Catalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.world).toBe(world);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('Stage 4.2.1 Scheduler: очередь событий мира', () => {
  it('сортировка: сегментированное время, затем sequence (стабильный tie-break)', () => {
    let bk = createSchedulerBookkeeping();
    bk = enqueueEvent(bk, { id: 'e-late', time: { segmentIndex: 0, localTimeS: 50 }, type: 'regime_change', data: {}, source: 'test' });
    bk = enqueueEvent(bk, { id: 'e-next-seg', time: { segmentIndex: 1, localTimeS: 0 }, type: 'phase_transition', data: {}, source: 'test' });
    bk = enqueueEvent(bk, { id: 'e-early', time: { segmentIndex: 0, localTimeS: 10 }, type: 'reagent_exhausted', data: {}, source: 'test' });
    bk = enqueueEvent(bk, { id: 'e-tie', time: { segmentIndex: 0, localTimeS: 10 }, type: 'range_boundary_reached', data: {}, source: 'test' });
    expect(sortedEvents(bk).map((e) => e.id)).toEqual(['e-early', 'e-tie', 'e-late', 'e-next-seg']);
    expect(pendingEvents(bk).length).toBe(4);
    expect(nextEventTime(bk)).toEqual({ segmentIndex: 0, localTimeS: 10 });
    expect(dueEvents(bk, { segmentIndex: 0, localTimeS: 20 }).map((e) => e.id)).toEqual(['e-early', 'e-tie']);
    expect(dueEvents(bk, { segmentIndex: 0, localTimeS: 5 }).length).toBe(0);
  });

  it('обработка: processed/failed; повторная обработка запрещена; событие не теряется', () => {
    let bk = createSchedulerBookkeeping();
    bk = enqueueEvent(bk, { id: 'ev-1', time: { segmentIndex: 0, localTimeS: 5 }, type: 'solver_detected', data: { depth: 3 }, source: 'test' });
    expect(pendingEvents(bk).map((e) => e.id)).toEqual(['ev-1']);
    const ok = processEvent(bk, 'ev-1', () => undefined);
    expect(ok.status).toBe('processed');
    expect(ok.bookkeeping.eventQueue[0].status).toBe('processed');
    expectSchedulerError(() => processEvent(ok.bookkeeping, 'ev-1', () => undefined), 'already_processed');

    let bk2 = createSchedulerBookkeeping();
    bk2 = enqueueEvent(bk2, { id: 'ev-2', time: { segmentIndex: 0, localTimeS: 5 }, type: 'solver_detected', data: {}, source: 'test' });
    const failed = processEvent(bk2, 'ev-2', () => {
      throw new Error('обработчик сломан');
    });
    expect(failed.status).toBe('failed');
    expect(failed.failReason).toBe('обработчик сломан');
    const kept = failed.bookkeeping.eventQueue.find((e) => e.id === 'ev-2');
    expect(kept?.status).toBe('failed');
    expect(kept?.failReason).toBe('обработчик сломан');
  });

  it('применяет событие как атомарный аудируемый переход резервуара', () => {
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'release-co2',
      time: { segmentIndex: 0, localTimeS: 0 },
      type: 'regime_change',
      data: { fluxId: 'event-co2-output' },
      source: 'test event solver'
    });
    const world = { ...testWorld(), scheduling };

    const result = processWorldEvent(
      world,
      'release-co2',
      (state, event) => {
        expect(event.data).toEqual({ fluxId: 'event-co2-output' });
        const registered = registerFlux(state.fluxLedger, {
          id: 'event-co2-output',
          kind: 'external_output',
          from: 'atm',
          to: EXTERNAL,
          subject: {
            subjectType: 'substance',
            speciesId: 'co2',
            quantityKind: 'integrated',
            amount: 5,
            basis: 'amount'
          },
          time: { segmentIndex: 0, localTimeS: 0 },
          note: 'test event transfer'
        });
        const applied = applyFlux(
          registered,
          Object.fromEntries(state.reservoirs.map((reservoir) => [reservoir.id, reservoir])),
          'event-co2-output'
        );
        return {
          ...state,
          reservoirs: state.reservoirs.map((reservoir) => applied.reservoirs[reservoir.id]!),
          fluxLedger: applied.ledger
        };
      },
      { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
    );

    expect(result.status).toBe('processed');
    expect(result.audit?.status).toBe('balanced');
    expect(result.world.reservoirs[0]!.material!.entries.co2).toBe(95);
    expect(result.world.fluxLedger.records).toHaveLength(1);
    expect(result.world.fluxLedger.records[0]!.status).toBe('applied');
    expect(result.event.status).toBe('processed');
    expect(result.world.scheduling!.eventQueue[0]!.status).toBe('processed');
    expect(result.world.clock).toEqual(world.clock);
    expect(result.world.scheduling!.stepCount).toBe(0);
    expect(world.reservoirs[0]!.material!.entries.co2).toBe(100);
    expect(world.fluxLedger.records).toHaveLength(0);
    expect(world.scheduling!.eventQueue[0]!.status).toBe('pending');
  });

  it('аудирует откат ранее применённого FluxLedger как обратный физический перенос', () => {
    const base = testWorld();
    const registered = registerFlux(base.fluxLedger, {
      id: 'pre-event-output',
      kind: 'external_output',
      from: 'atm',
      to: EXTERNAL,
      subject: {
        subjectType: 'substance',
        speciesId: 'co2',
        quantityKind: 'integrated',
        amount: 5,
        basis: 'amount'
      },
      time: { segmentIndex: 0, localTimeS: 0 },
      note: 'pre-event output'
    });
    const applied = applyFlux(
      registered,
      Object.fromEntries(base.reservoirs.map((reservoir) => [reservoir.id, reservoir])),
      'pre-event-output'
    );
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'undo-pre-event-output',
      time: { segmentIndex: 0, localTimeS: 0 },
      type: 'regime_change',
      data: { fluxId: 'pre-event-output' },
      source: 'test'
    });
    const world = {
      ...base,
      reservoirs: base.reservoirs.map((reservoir) => applied.reservoirs[reservoir.id]!),
      fluxLedger: applied.ledger,
      scheduling
    };

    const result = processWorldEvent(
      world,
      'undo-pre-event-output',
      (state) => {
        const reverted = revertFlux(
          state.fluxLedger,
          Object.fromEntries(state.reservoirs.map((reservoir) => [reservoir.id, reservoir])),
          'pre-event-output'
        );
        return {
          ...state,
          reservoirs: state.reservoirs.map((reservoir) => reverted.reservoirs[reservoir.id]!),
          fluxLedger: reverted.ledger
        };
      },
      { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
    );

    expect(result.status).toBe('processed');
    expect(result.audit?.status).toBe('balanced');
    expect(result.world.reservoirs[0]!.material!.entries.co2).toBe(100);
    expect(result.world.fluxLedger.records[0]!.status).toBe('reverted');
    expect(result.event.status).toBe('processed');
    expect(world.reservoirs[0]!.material!.entries.co2).toBe(95);
    expect(world.fluxLedger.records[0]!.status).toBe('applied');
  });

  it('отклоняет несбалансированное событие, сохраняет физический мир и отмечает событие failed', () => {
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'bad-inventory-event',
      time: { segmentIndex: 0, localTimeS: 0 },
      type: 'phase_transition',
      data: {},
      source: 'test'
    });
    const world = { ...testWorld(), scheduling };

    const result = processWorldEvent(
      world,
      'bad-inventory-event',
      (state) => ({
        ...state,
        reservoirs: state.reservoirs.map((reservoir) =>
          reservoir.id === 'atm'
            ? setMaterialInventory(reservoir, 'amount', { co2: 97 })
            : reservoir
        )
      }),
      { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
    );

    expect(result.status).toBe('failed');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.event.status).toBe('failed');
    expect(result.event.failReason).toContain('substance');
    expect(result.world.reservoirs[0]!.material!.entries.co2).toBe(100);
    expect(result.world.clock).toEqual(world.clock);
    expect(result.world.scheduling!.eventQueue[0]!.status).toBe('failed');
    expect(result.world.scheduling!.eventQueue[0]!.failReason).toContain('substance');
    expect(world.reservoirs[0]!.material!.entries.co2).toBe(100);
    expect(world.scheduling!.eventQueue[0]!.status).toBe('pending');
  });

  it('ошибка обработчика и попытка изменить WorldClock не фиксируют физическое состояние', () => {
    const makeWorld = (id: string) => ({
      ...testWorld(),
      scheduling: enqueueEvent(createSchedulerBookkeeping(), {
        id,
        time: { segmentIndex: 0, localTimeS: 0 },
        type: 'solver_detected',
        data: {},
        source: 'test'
      })
    });
    const broken = makeWorld('broken-handler');
    const thrown = processWorldEvent(
      broken,
      'broken-handler',
      () => {
        throw new Error('event solver failure');
      },
      { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
    );
    expect(thrown.status).toBe('failed');
    expect(thrown.event.failReason).toContain('event solver failure');
    expect(thrown.world.reservoirs[0]!.material!.entries.co2).toBe(100);
    expect(thrown.world.scheduling!.eventQueue[0]!.status).toBe('failed');

    const clockWorld = makeWorld('clock-mutator');
    const moved = processWorldEvent(
      clockWorld,
      'clock-mutator',
      (state) => ({
        ...state,
        clock: { ...state.clock, localTimeS: state.clock.localTimeS + 1 }
      }),
      { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
    );
    expect(moved.status).toBe('failed');
    expect(moved.event.failReason).toContain('изменил WorldClock');
    expect(moved.world.clock).toEqual(clockWorld.clock);
    expect(moved.world.scheduling!.eventQueue[0]!.status).toBe('failed');
  });

  it('отклоняет попытку обработать событие вне его точной временной точки', () => {
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'future-event',
      time: { segmentIndex: 0, localTimeS: 10 },
      type: 'phase_transition',
      data: {},
      source: 'test'
    });
    const world = { ...testWorld(), scheduling };
    expectSchedulerError(
      () => processWorldEvent(
        world,
        'future-event',
        (state) => state,
        { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
      ),
      'invalid_event'
    );
    expect(world.scheduling!.eventQueue[0]!.status).toBe('pending');
  });

  it('диспетчеризует все наступившие события по sequence и применяет каждый ровно один раз', () => {
    const firstScheduling = enqueueEvent(
      enqueueEvent(createSchedulerBookkeeping(), {
        id: 'event-second',
        time: { segmentIndex: 0, localTimeS: 0 },
        type: 'second',
        data: { order: 2 },
        source: 'test'
      }),
      {
        id: 'event-first',
        time: { segmentIndex: 0, localTimeS: 0 },
        type: 'first',
        data: { order: 1 },
        source: 'test'
      }
    );
    const world = { ...testWorld(), scheduling: firstScheduling };
    const handled: string[] = [];
    const result = processDueWorldEvents(
      world,
      {
        first: (state, event) => {
          handled.push(event.id);
          return state;
        },
        second: (state, event) => {
          handled.push(event.id);
          return state;
        }
      },
      { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
    );

    expect(result.status).toBe('completed');
    expect(handled).toEqual(['event-second', 'event-first']);
    expect(result.results.map((entry) => entry.event.status)).toEqual(['processed', 'processed']);
    expect(result.world.scheduling!.eventQueue.map((event) => event.status)).toEqual(['processed', 'processed']);
    expect(result.world.clock).toEqual(world.clock);
    expect(world.scheduling!.eventQueue.map((event) => event.status)).toEqual(['pending', 'pending']);
  });

  it('при первом failed событии останавливает dispatch и оставляет последующие события pending', () => {
    const scheduling = enqueueEvent(
      enqueueEvent(
        enqueueEvent(createSchedulerBookkeeping(), {
          id: 'dispatch-ok',
          time: { segmentIndex: 0, localTimeS: 0 },
          type: 'ok',
          data: {},
          source: 'test'
        }),
        {
          id: 'dispatch-missing',
          time: { segmentIndex: 0, localTimeS: 0 },
          type: 'not-registered',
          data: {},
          source: 'test'
        }
      ),
      {
        id: 'dispatch-after-failure',
        time: { segmentIndex: 0, localTimeS: 0 },
        type: 'ok',
        data: {},
        source: 'test'
      }
    );
    const result = processDueWorldEvents(
      { ...testWorld(), scheduling },
      { ok: (state) => state },
      { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
    );

    expect(result.status).toBe('failed');
    expect(result.results.map((entry) => entry.event.id)).toEqual(['dispatch-ok', 'dispatch-missing']);
    expect(result.world.scheduling!.eventQueue.map((event) => [event.id, event.status])).toEqual([
      ['dispatch-ok', 'processed'],
      ['dispatch-missing', 'failed'],
      ['dispatch-after-failure', 'pending']
    ]);
    expect(result.world.scheduling!.eventQueue[1]!.failReason).toContain('не зарегистрирован обработчик');
  });

  it('не применяет пропущенное событие ретроактивно и сохраняет failReason', () => {
    const clock = advance(createSimulationClock(), 5);
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'missed-event',
      time: { segmentIndex: 0, localTimeS: 2 },
      type: 'phase_transition',
      data: {},
      source: 'test'
    });
    const world = { ...testWorld(), clock, scheduling };
    const result = processDueWorldEvents(
      world,
      { phase_transition: (state) => state },
      { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } }
    );

    expect(result.status).toBe('failed');
    expect(result.results).toHaveLength(1);
    expect(result.world.reservoirs[0]!.material!.entries.co2).toBe(100);
    expect(result.world.clock).toEqual(clock);
    expect(result.world.scheduling!.eventQueue[0]!.status).toBe('failed');
    expect(result.world.scheduling!.eventQueue[0]!.failReason).toContain('ретроактивное');
  });

  it('runScheduledWorldTurn сначала применяет due events и только потом запускает готовые процессы', () => {
    let scheduling = scheduleProcessAt(createSchedulerBookkeeping(), 'a', {
      segmentIndex: 0,
      localTimeS: 0
    });
    scheduling = enqueueEvent(scheduling, {
      id: 'turn-phase-event',
      time: { segmentIndex: 0, localTimeS: 0 },
      type: 'phase_transition',
      data: { phase: 'post-event' },
      source: 'turn test'
    });
    const world = { ...testWorld(), scheduling };
    let observedEventStatus: string | undefined;
    const operator: ProcessOperator = {
      processId: 'a',
      apply: (state) => {
        observedEventStatus = state.scheduling?.eventQueue.find((event) => event.id === 'turn-phase-event')?.status;
        return state;
      }
    };

    const result = runScheduledWorldTurn(
      world,
      makeRegistry([descriptor('a')]),
      [operator],
      { phase_transition: (state) => state },
      {
        eventAudit: { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } },
        process: { durationS: 1 }
      }
    );

    expect(result.status).toBe('completed');
    expect(result.eventDispatch?.results.map((entry) => entry.event.status)).toEqual(['processed']);
    expect(observedEventStatus).toBe('processed');
    expect(result.processRun?.status).toBe('committed');
    expect(result.processRun?.readyProcessIds).toEqual(['a']);
    expect(result.world.clock.localTimeS).toBe(1);
    expect(result.world.scheduling!.eventQueue[0]!.status).toBe('processed');
    expect(result.world.scheduling!.processDynamics.a!.nextDueTime).toBeNull();
    expect(world.clock.localTimeS).toBe(0);
    expect(world.scheduling!.eventQueue[0]!.status).toBe('pending');
  });

  it('runScheduledWorldTurn advances continuous processes when no one-shot deadline is due', () => {
    const registry = makeRegistry([descriptor('continuous_a')]);
    const calls: Call[] = [];
    const world = { ...testWorld(), scheduling: createSchedulerBookkeeping() };
    const result = runScheduledWorldTurn(
      world,
      registry,
      [recorder('continuous_a', calls)],
      {},
      {
        continuousProcessIds: ['continuous_a'],
        eventAudit: { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } },
        process: { durationS: 2 }
      }
    );

    expect(result.status).toBe('completed');
    expect(result.processRun?.status).toBe('committed');
    expect(result.processRun?.readyProcessIds).toEqual([]);
    expect(result.processRun?.continuousProcessIds).toEqual(['continuous_a']);
    expect(result.processRun?.invokedProcessIds).toEqual(['continuous_a']);
    expect(calls).toEqual([{ processId: 'continuous_a', durationS: 2, intervalStartS: 0 }]);
    expect(result.world.clock.localTimeS).toBe(2);
    expect(world.clock.localTimeS).toBe(0);
  });

  it('continuous process stops exactly at another process deadline and leaves it due for the next turn', () => {
    const registry = makeRegistry([descriptor('continuous_a'), descriptor('scheduled_b')]);
    const callsA: Call[] = [];
    const callsB: Call[] = [];
    const scheduling = scheduleProcessAt(createSchedulerBookkeeping(), 'scheduled_b', {
      segmentIndex: 0,
      localTimeS: 3
    });
    const world = { ...testWorld(), scheduling };

    const first = runScheduledWorldTurn(
      world,
      registry,
      [recorder('continuous_a', callsA), recorder('scheduled_b', callsB)],
      {},
      {
        continuousProcessIds: ['continuous_a'],
        eventAudit: { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } },
        process: { durationS: 10 }
      }
    );

    expect(first.status).toBe('completed');
    expect(callsA).toEqual([{ processId: 'continuous_a', durationS: 3, intervalStartS: 0 }]);
    expect(callsB).toEqual([]);
    expect(first.world.clock.localTimeS).toBe(3);
    expect(first.processRun?.macroStep?.stepSize?.processBoundary).toEqual({
      processIds: ['scheduled_b'],
      time: { segmentIndex: 0, localTimeS: 3 }
    });
    expect(readyProcessIdsAt(first.world.scheduling!, registry, [recorder('scheduled_b', callsB)], {
      segmentIndex: 0,
      localTimeS: 3
    })).toEqual(['scheduled_b']);

    const second = runScheduledWorldTurn(
      first.world,
      registry,
      [recorder('continuous_a', callsA), recorder('scheduled_b', callsB)],
      {},
      {
        continuousProcessIds: ['continuous_a'],
        eventAudit: { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } },
        process: { durationS: 1 }
      }
    );
    expect(second.status).toBe('completed');
    expect(callsB).toEqual([{ processId: 'scheduled_b', durationS: 1, intervalStartS: 0 }]);
    expect(callsA).toHaveLength(2);
    expect(second.processRun?.readyProcessIds).toEqual(['scheduled_b']);
    expect(second.world.clock.localTimeS).toBe(4);
    expect(second.world.scheduling!.processDynamics.scheduled_b!.nextDueTime).toBeNull();
  });

  it('continuous process also treats its own future deadline as a macro-step boundary', () => {
    const registry = makeRegistry([descriptor('continuous_a')]);
    const calls: Call[] = [];
    const scheduling = scheduleProcessAt(createSchedulerBookkeeping(), 'continuous_a', {
      segmentIndex: 0,
      localTimeS: 3
    });
    const world = { ...testWorld(), scheduling };

    const result = runScheduledWorldTurn(
      world,
      registry,
      [recorder('continuous_a', calls)],
      {},
      {
        continuousProcessIds: ['continuous_a'],
        eventAudit: { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } },
        process: { durationS: 10 }
      }
    );

    expect(result.status).toBe('completed');
    expect(calls).toEqual([{ processId: 'continuous_a', durationS: 3, intervalStartS: 0 }]);
    expect(result.world.clock.localTimeS).toBe(3);
    expect(result.processRun?.macroStep?.stepSize?.processBoundary).toEqual({
      processIds: ['continuous_a'],
      time: { segmentIndex: 0, localTimeS: 3 }
    });
    expect(result.world.scheduling!.processDynamics.continuous_a!.nextDueTime).toBeNull();
  });

  it('failed due event blocks every scheduled process in the same world turn', () => {
    const scheduling = enqueueEvent(
      scheduleProcessAt(createSchedulerBookkeeping(), 'a', {
        segmentIndex: 0,
        localTimeS: 0
      }),
      {
        id: 'turn-missing-handler',
        time: { segmentIndex: 0, localTimeS: 0 },
        type: 'unregistered-transition',
        data: {},
        source: 'turn test'
      }
    );
    const world = { ...testWorld(), scheduling };
    const calls: Call[] = [];
    const result = runScheduledWorldTurn(
      world,
      makeRegistry([descriptor('a')]),
      [recorder('a', calls)],
      {},
      {
        eventAudit: { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } },
        process: { durationS: 1 }
      }
    );

    expect(result.status).toBe('failed');
    expect(result.processRun).toBeUndefined();
    expect(calls).toEqual([]);
    expect(result.world.clock).toEqual(world.clock);
    expect(result.world.scheduling!.eventQueue[0]!.status).toBe('failed');
    expect(result.world.scheduling!.processDynamics.a!.nextDueTime).toEqual({
      segmentIndex: 0,
      localTimeS: 0
    });
    expect(world.scheduling!.eventQueue[0]!.status).toBe('pending');
  });

  it('глубоко изолирует payload события при enqueue и при чтении очереди', () => {
    const sourceTime = { segmentIndex: 0, localTimeS: 5 };
    const sourceData = {
      layer: { temperatureK: 250 },
      participants: [{ speciesId: 'co2', amount: 1 }]
    };
    const bk = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'event-isolation',
      time: sourceTime,
      type: 'solver_detected',
      data: sourceData,
      source: 'test'
    });

    sourceTime.localTimeS = 99;
    sourceData.layer.temperatureK = 999;
    sourceData.participants[0]!.amount = 999;
    expect(bk.eventQueue[0]!.time).toEqual({ segmentIndex: 0, localTimeS: 5 });
    expect(bk.eventQueue[0]!.data).toEqual({
      layer: { temperatureK: 250 },
      participants: [{ speciesId: 'co2', amount: 1 }]
    });

    const sorted = sortedEvents(bk);
    sorted[0]!.time.localTimeS = 100;
    (sorted[0]!.data.layer as { temperatureK: number }).temperatureK = 1000;
    (pendingEvents(bk)[0]!.data.participants as Array<{ amount: number }>)[0]!.amount = 1000;
    (dueEvents(bk, { segmentIndex: 0, localTimeS: 5 })[0]!.data.layer as { temperatureK: number }).temperatureK = 1000;
    nextEventTime(bk)!.localTimeS = 100;

    expect(bk.eventQueue[0]!.time).toEqual({ segmentIndex: 0, localTimeS: 5 });
    expect(bk.eventQueue[0]!.data).toEqual({
      layer: { temperatureK: 250 },
      participants: [{ speciesId: 'co2', amount: 1 }]
    });
  });

  it('обработчик получает копию события: его мутации не меняют очередь даже при ошибке', () => {
    const bk = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'event-handler-isolation',
      time: { segmentIndex: 0, localTimeS: 5 },
      type: 'solver_detected',
      data: { details: { reason: 'original' } },
      source: 'test'
    });
    const failed = processEvent(bk, 'event-handler-isolation', (event) => {
      (event.data.details as { reason: string }).reason = 'mutated';
      event.time.localTimeS = 50;
      throw new Error('handler failed after local mutation');
    });

    expect(failed.status).toBe('failed');
    expect(failed.bookkeeping.eventQueue[0]!.status).toBe('failed');
    expect(failed.bookkeeping.eventQueue[0]!.time.localTimeS).toBe(5);
    expect(failed.bookkeeping.eventQueue[0]!.data).toEqual({ details: { reason: 'original' } });
    expect(bk.eventQueue[0]!.status).toBe('pending');
    expect(bk.eventQueue[0]!.time.localTimeS).toBe(5);
    expect(bk.eventQueue[0]!.data).toEqual({ details: { reason: 'original' } });
  });

  it('связывает failReason со статусом failed и сохраняет диагностическую причину пустого исключения', () => {
    const pending = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'failure-reason',
      time: { segmentIndex: 0, localTimeS: 1 },
      type: 'solver_detected',
      data: {},
      source: 'test'
    });

    const failedWithoutReason = {
      ...pending,
      eventQueue: [{ ...pending.eventQueue[0]!, status: 'failed' as const }]
    };
    expect(validateSchedulerBookkeeping(failedWithoutReason).join(' '))
      .toContain('событие failed обязано содержать непустой failReason');

    const processedWithReason = {
      ...pending,
      eventQueue: [{ ...pending.eventQueue[0]!, status: 'processed' as const, failReason: 'stale failure' }]
    };
    expect(validateSchedulerBookkeeping(processedWithReason).join(' '))
      .toContain('failReason допустим только при status=failed');

    const result = processEvent(pending, 'failure-reason', () => {
      throw new Error('');
    });
    expect(result.status).toBe('failed');
    expect(result.failReason).toBe('обработчик завершился ошибкой без диагностического сообщения');
    expect(validateSchedulerBookkeeping(result.bookkeeping)).toEqual([]);
  });

  it('некорректные события отклоняются: дубликат id, время, несериализуемые данные', () => {
    const bk = createSchedulerBookkeeping();
    const good = { id: 'ev', time: { segmentIndex: 0, localTimeS: 1 }, type: 'regime_change', data: {}, source: 'test' };
    const queued = enqueueEvent(bk, good);
    expectSchedulerError(() => enqueueEvent(queued, good), 'invalid_event');
    expectSchedulerError(
      () => enqueueEvent(bk, { id: 'ev-neg', time: { segmentIndex: 0, localTimeS: -1 }, type: 'regime_change', data: {}, source: 'test' }),
      'invalid_event'
    );
    expectSchedulerError(
      () => enqueueEvent(bk, { id: 'ev-fn', time: { segmentIndex: 0, localTimeS: 1 }, type: 'regime_change', data: { callback: () => undefined }, source: 'test' }),
      'invalid_event'
    );
    expectSchedulerError(
      () => enqueueEvent(bk, { id: 'ev-date', time: { segmentIndex: 0, localTimeS: 1 }, type: 'regime_change', data: { at: new Date(0) }, source: 'test' }),
      'invalid_event'
    );
    expectSchedulerError(
      () => enqueueEvent(bk, { id: 'ev-map', time: { segmentIndex: 0, localTimeS: 1 }, type: 'regime_change', data: { extra: new Map() }, source: 'test' }),
      'invalid_event'
    );
  });

  it('требует уникальные sequence и nextSequence выше каждого уже назначенного номера', () => {
    let duplicate = enqueueEvent(
      enqueueEvent(createSchedulerBookkeeping(), {
        id: 'sequence-a',
        time: { segmentIndex: 0, localTimeS: 1 },
        type: 'solver_detected',
        data: {},
        source: 'test'
      }),
      {
        id: 'sequence-b',
        time: { segmentIndex: 0, localTimeS: 1 },
        type: 'solver_detected',
        data: {},
        source: 'test'
      }
    );
    duplicate = {
      ...duplicate,
      eventQueue: duplicate.eventQueue.map((event) => ({ ...event, sequence: 0 }))
    };
    expect(validateSchedulerBookkeeping(duplicate).join(' ')).toContain('дублирующийся sequence');

    const staleNext = {
      ...enqueueEvent(createSchedulerBookkeeping(), {
        id: 'sequence-stale',
        time: { segmentIndex: 0, localTimeS: 1 },
        type: 'solver_detected',
        data: {},
        source: 'test'
      }),
      nextSequence: 0
    };
    expect(validateSchedulerBookkeeping(staleNext).join(' '))
      .toContain('nextSequence должен быть строго больше');
    expectSchedulerError(
      () => enqueueEvent(staleNext, {
        id: 'sequence-next',
        time: { segmentIndex: 0, localTimeS: 2 },
        type: 'solver_detected',
        data: {},
        source: 'test'
      }),
      'invalid_bookkeeping'
    );
    expectSchedulerError(
      () => processEvent(duplicate, 'sequence-a', () => undefined),
      'invalid_bookkeeping'
    );
  });

  it('отклоняет отрицательные elapsed-времена в динамике процесса', () => {
    const bk = {
      ...createSchedulerBookkeeping(),
      processDynamics: {
        invalid: {
          processId: 'invalid',
          lastRunElapsedS: -1,
          nextDueElapsedS: 0,
          macroStepsCompleted: 0,
          operatorCallsCompleted: 0
        }
      }
    };
    expect(validateSchedulerBookkeeping(bk).join(' '))
      .toContain('не может быть отрицательным elapsed-временем');
  });

  it('валидирует парные worldStartTime/worldEndTime в stepLog и их строгий порядок', () => {
    const base = runMacroStep(
      testWorld(),
      makeRegistry([descriptor('a')]),
      [recorder('a', [])],
      { durationS: 2, splitting: 'lie' }
    );
    expect(base.status).toBe('committed');
    const validBookkeeping = base.bookkeeping;
    expect(validateSchedulerBookkeeping(validBookkeeping)).toEqual([]);

    const missingEnd = {
      ...validBookkeeping,
      stepLog: [{
        ...validBookkeeping.stepLog[0]!,
        worldStartTime: { segmentIndex: 0, localTimeS: 0 }
      }]
    };
    expect(validateSchedulerBookkeeping(missingEnd).join(' '))
      .toContain('worldStartTime и worldEndTime должны задаваться вместе');

    const reversed = {
      ...validBookkeeping,
      stepLog: [{
        ...validBookkeeping.stepLog[0]!,
        worldStartTime: { segmentIndex: 0, localTimeS: 2 },
        worldEndTime: { segmentIndex: 0, localTimeS: 1 }
      }]
    };
    expect(validateSchedulerBookkeeping(reversed).join(' '))
      .toContain('worldEndTime должен быть строго позже worldStartTime');

    const legacy = {
      ...validBookkeeping,
      stepLog: [{
        stepIndex: 0,
        processId: 'legacy',
        phase: 'lie' as const,
        durationS: 2,
        intervalStartS: 0,
        status: 'committed' as const
      }]
    };
    expect(validateSchedulerBookkeeping(legacy)).toEqual([]);
  });

  it('состояние планировщика JSON-сериализуемо и проходит валидацию после round-trip', () => {
    let bk = createSchedulerBookkeeping();
    bk = enqueueEvent(bk, { id: 'ev-json', time: { segmentIndex: 1, localTimeS: 2.5 }, type: 'phase_transition', data: { pressure: 101325 }, source: 'test' });
    bk = scheduleProcess(bk, 'proc-a', 42.5);
    const restored = JSON.parse(JSON.stringify(bk)) as unknown;
    expect(validateSchedulerBookkeeping(restored)).toEqual([]);
  });
});

describe('Stage 4.2.1 Scheduler: macro-step respects pending event boundaries', () => {
  it('clips the macro-step at the next event in the current segment and leaves it pending', () => {
    const registry = makeRegistry([descriptor('a')]);
    const calls: Call[] = [];
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'phase-boundary',
      time: { segmentIndex: 0, localTimeS: 3 },
      type: 'phase_transition',
      data: { reservoirId: 'surface' },
      source: 'test solver'
    });
    const world = { ...testWorld(), scheduling };

    const result = runMacroStep(world, registry, [recorder('a', calls)], {
      durationS: 10,
      splitting: 'lie'
    });

    expect(result.status).toBe('committed');
    expect(calls).toEqual([{ processId: 'a', durationS: 3, intervalStartS: 0 }]);
    expect(result.stepSize?.requestedDurationS).toBe(10);
    expect(result.stepSize?.effectiveDurationS).toBe(3);
    expect(result.stepSize?.eventBoundary).toEqual({
      eventId: 'phase-boundary',
      time: { segmentIndex: 0, localTimeS: 3 }
    });
    expect(result.world.clock.localTimeS).toBe(3);
    expect(result.bookkeeping.eventQueue[0]!.status).toBe('pending');
    expect(dueEvents(result.bookkeeping, { segmentIndex: 0, localTimeS: 3 }).map((event) => event.id))
      .toEqual(['phase-boundary']);
  });

  it('rebases all pending current-segment events when a sub-ULP macro-step opens a new segment', () => {
    const registry = makeRegistry([descriptor('a')]);
    const largeClock = advance(createSimulationClock(), 1e16);
    const scheduling = enqueueEvent(
      enqueueEvent(createSchedulerBookkeeping(), {
        id: 'event-near',
        time: { segmentIndex: largeClock.segmentIndex, localTimeS: largeClock.localTimeS + 2 },
        type: 'solver_detected',
        data: { threshold: 1 },
        source: 'test solver'
      }),
      {
        id: 'event-far',
        time: { segmentIndex: largeClock.segmentIndex, localTimeS: largeClock.localTimeS + 4 },
        type: 'solver_detected',
        data: { threshold: 2 },
        source: 'test solver'
      }
    );
    const world = { ...testWorld(), clock: largeClock, scheduling };

    const rollover = runMacroStep(world, registry, [recorder('a', [])], {
      durationS: 1,
      splitting: 'lie'
    });

    expect(rollover.status).toBe('committed');
    expect(rollover.world.clock.segmentIndex).toBe(largeClock.segmentIndex + 1);
    expect(rollover.world.clock.localTimeS).toBe(1);
    expect(rollover.log[0]!.worldStartTime).toEqual({
      segmentIndex: largeClock.segmentIndex,
      localTimeS: largeClock.localTimeS
    });
    expect(rollover.log[0]!.worldEndTime).toEqual({
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 1
    });
    expect(rollover.bookkeeping.stepLog[0]!.worldEndTime).toEqual({
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 1
    });
    expect(rollover.bookkeeping.eventQueue.map((event) => [
      event.id,
      event.status,
      event.time.segmentIndex,
      event.time.localTimeS
    ])).toEqual([
      ['event-near', 'pending', largeClock.segmentIndex + 1, 2],
      ['event-far', 'pending', largeClock.segmentIndex + 1, 4]
    ]);
    expect(nextEventTime(rollover.bookkeeping)).toEqual({
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 2
    });
    expect(dueEvents(rollover.bookkeeping, {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 1
    })).toHaveLength(0);

    const atFirstEvent = runMacroStep(
      rollover.world,
      registry,
      [recorder('a', [])],
      { durationS: 10, splitting: 'lie' }
    );
    expect(atFirstEvent.status).toBe('committed');
    expect(atFirstEvent.stepSize?.effectiveDurationS).toBe(1);
    expect(atFirstEvent.world.clock.segmentIndex).toBe(largeClock.segmentIndex + 1);
    expect(atFirstEvent.world.clock.localTimeS).toBe(2);
    expect(atFirstEvent.bookkeeping.eventQueue.map((event) => event.time)).toEqual([
      { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 2 },
      { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 4 }
    ]);
    expect(dueEvents(atFirstEvent.bookkeeping, {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 2
    }).map((event) => event.id)).toEqual(['event-near']);
  });

  it('clips a forced segment rollover to a pending event already scheduled in the next segment', () => {
    const registry = makeRegistry([descriptor('a')]);
    const largeClock = advance(createSimulationClock(), 1e16);
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'next-segment-event',
      time: { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 1 },
      type: 'phase_transition',
      data: { phase: 'new-regime' },
      source: 'pre-scheduled boundary'
    });
    const world = { ...testWorld(), clock: largeClock, scheduling };
    const calls: Call[] = [];

    const result = runMacroStep(world, registry, [recorder('a', calls)], {
      durationS: 3,
      splitting: 'lie'
    });

    expect(result.status).toBe('committed');
    expect(calls).toEqual([{ processId: 'a', durationS: 1, intervalStartS: 0 }]);
    expect(result.stepSize?.effectiveDurationS).toBe(1);
    expect(result.stepSize?.eventBoundary).toEqual({
      eventId: 'next-segment-event',
      time: { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 1 }
    });
    expect(result.world.clock.segmentIndex).toBe(largeClock.segmentIndex + 1);
    expect(result.world.clock.localTimeS).toBe(1);
    expect(result.bookkeeping.eventQueue[0]!.status).toBe('pending');
    expect(dueEvents(result.bookkeeping, {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 1
    }).map((event) => event.id)).toEqual(['next-segment-event']);
  });

  it('blocks a segment rollover at a pre-scheduled event at the next segment origin', () => {
    const registry = makeRegistry([descriptor('a')]);
    const largeClock = advance(createSimulationClock(), 1e16);
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'next-segment-origin',
      time: { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 0 },
      type: 'regime_change',
      data: { mode: 'new-segment' },
      source: 'pre-scheduled boundary'
    });
    const world = { ...testWorld(), clock: largeClock, scheduling };
    const calls: Call[] = [];

    const result = runMacroStep(world, registry, [recorder('a', calls)], {
      durationS: 3,
      splitting: 'lie'
    });

    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.world.clock).toEqual(largeClock);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(calls).toEqual([]);
    expect(result.diagnostics.join(' ')).toContain('совпадает с текущим физическим моментом');
  });

  it('rejects a new macro-step while an event at the current point is still pending', () => {
    const registry = makeRegistry([descriptor('a')]);
    const calls: Call[] = [];
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'already-due',
      time: { segmentIndex: 0, localTimeS: 0 },
      type: 'reagent_exhausted',
      data: { speciesId: 'co2' },
      source: 'test solver'
    });
    const world = { ...testWorld(), scheduling };
    const result = runMacroStep(world, registry, [recorder('a', calls)], {
      durationS: 10,
      splitting: 'lie'
    });

    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(calls).toEqual([]);
    expect(result.diagnostics.join(' ')).toContain('остаётся pending');
  });

  it('clips a macro-step at the earliest exact process deadline and wakes that process next', () => {
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const callsA: Call[] = [];
    const callsB: Call[] = [];
    const scheduling = scheduleProcessAt(createSchedulerBookkeeping(), 'b', {
      segmentIndex: 0,
      localTimeS: 3
    });
    const world = { ...testWorld(), scheduling };

    const first = runMacroStep(
      world,
      registry,
      [recorder('a', callsA)],
      { durationS: 10, splitting: 'lie', processIds: ['a'] }
    );
    expect(first.status).toBe('committed');
    expect(callsA).toEqual([{ processId: 'a', durationS: 3, intervalStartS: 0 }]);
    expect(first.stepSize?.effectiveDurationS).toBe(3);
    expect(first.stepSize?.processBoundary).toEqual({
      processIds: ['b'],
      time: { segmentIndex: 0, localTimeS: 3 }
    });
    expect(first.world.clock.localTimeS).toBe(3);
    expect(readyProcessIdsAt(first.bookkeeping, registry, [recorder('b', callsB)], {
      segmentIndex: 0,
      localTimeS: 3
    })).toEqual(['b']);

    const next = runReadyProcessesAt(first.world, registry, [recorder('b', callsB)], {
      durationS: 1
    });
    expect(next.status).toBe('committed');
    expect(callsB).toEqual([{ processId: 'b', durationS: 1, intervalStartS: 0 }]);
    expect(next.world.clock.localTimeS).toBe(4);
    expect(next.bookkeeping.processDynamics.b!.nextDueTime).toBeNull();
  });

  it('сохраняет одинаковую process и event boundary в одной точке времени', () => {
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const scheduling = enqueueEvent(
      scheduleProcessAt(createSchedulerBookkeeping(), 'b', {
        segmentIndex: 0,
        localTimeS: 3
      }),
      {
        id: 'same-time-phase-event',
        time: { segmentIndex: 0, localTimeS: 3 },
        type: 'phase_transition',
        data: { phase: 'boiling' },
        source: 'test'
      }
    );
    const world = { ...testWorld(), scheduling };
    const result = runMacroStep(
      world,
      registry,
      [recorder('a', [])],
      { durationS: 10, splitting: 'lie', processIds: ['a'] }
    );

    expect(result.status).toBe('committed');
    expect(result.world.clock.localTimeS).toBe(3);
    expect(result.stepSize?.eventBoundary).toEqual({
      eventId: 'same-time-phase-event',
      time: { segmentIndex: 0, localTimeS: 3 }
    });
    expect(result.stepSize?.processBoundary).toEqual({
      processIds: ['b'],
      time: { segmentIndex: 0, localTimeS: 3 }
    });
    expect(result.bookkeeping.eventQueue[0]!.status).toBe('pending');
    expect(readyProcessIdsAt(result.bookkeeping, registry, [recorder('b', [])], {
      segmentIndex: 0,
      localTimeS: 3
    })).toEqual(['b']);
  });

  it('не позволяет другому процессу пропустить exact deadline, уже наступивший в текущем TimePoint', () => {
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const scheduling = scheduleProcessAt(createSchedulerBookkeeping(), 'b', {
      segmentIndex: 0,
      localTimeS: 0
    });
    const world = { ...testWorld(), scheduling };
    const calls: Call[] = [];
    const result = runMacroStep(
      world,
      registry,
      [recorder('a', calls)],
      { durationS: 1, splitting: 'lie', processIds: ['a'] }
    );

    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(calls).toEqual([]);
    expect(result.diagnostics.join(' ')).toContain('имеет наступивший exact deadline');
  });

  it('клиппит rollover на exact process deadline в следующем сегменте', () => {
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const largeClock = advance(createSimulationClock(), 1e16);
    const scheduling = scheduleProcessAt(createSchedulerBookkeeping(), 'b', {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 2
    });
    const world = { ...testWorld(), clock: largeClock, scheduling };
    const result = runMacroStep(
      world,
      registry,
      [recorder('a', [])],
      { durationS: 3, splitting: 'lie', processIds: ['a'] }
    );

    expect(result.status).toBe('committed');
    expect(result.stepSize?.effectiveDurationS).toBe(2);
    expect(result.stepSize?.processBoundary).toEqual({
      processIds: ['b'],
      time: { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 2 }
    });
    expect(result.world.clock.segmentIndex).toBe(largeClock.segmentIndex + 1);
    expect(result.world.clock.localTimeS).toBe(2);
    expect(readyProcessIdsAt(result.bookkeeping, registry, [recorder('b', [])], {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 2
    })).toEqual(['b']);
  });

  it('lands on a representable event point without rolling the clock into a new segment', () => {
    const registry = makeRegistry([descriptor('a')]);
    const calls: Call[] = [];
    const largeClock = advance(createSimulationClock(), 1e16);
    const eventLocalTimeS = largeClock.localTimeS + 2;
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'ulp-event',
      time: { segmentIndex: largeClock.segmentIndex, localTimeS: eventLocalTimeS },
      type: 'solver_detected',
      data: { threshold: 'exact-double-point' },
      source: 'test solver'
    });
    const world = { ...testWorld(), clock: largeClock, scheduling };

    const result = runMacroStep(world, registry, [recorder('a', calls)], {
      durationS: 10,
      splitting: 'lie'
    });

    expect(result.status).toBe('committed');
    expect(calls).toEqual([{ processId: 'a', durationS: 2, intervalStartS: 0 }]);
    expect(result.world.clock.segmentIndex).toBe(largeClock.segmentIndex);
    expect(result.world.clock.localTimeS).toBe(eventLocalTimeS);
    expect(result.stepSize?.eventBoundary?.eventId).toBe('ulp-event');
    expect(result.bookkeeping.eventQueue[0]!.status).toBe('pending');
  });
});

describe('Stage 4.2.1 Scheduler: сегментный ноль — координатный переход без физического шага', () => {
  it('нормализует nextSegment:0 и обрабатывает событие без увеличения stepCount', () => {
    const largeClock = advance(createSimulationClock(), 1e16);
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'segment-origin-transition',
      time: { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 0 },
      type: 'regime_change',
      data: { regime: 'new-segment' },
      source: 'segment-origin test'
    });
    const world = { ...testWorld(), clock: largeClock, scheduling };
    const handled: string[] = [];

    const result = runScheduledWorldTurn(
      world,
      makeRegistry([]),
      [],
      {
        regime_change: (state, event) => {
          handled.push(event.id);
          return state;
        }
      },
      {
        eventAudit: { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } },
        process: { durationS: 1 }
      }
    );

    expect(result.status).toBe('completed');
    expect(handled).toEqual(['segment-origin-transition']);
    expect(result.world.clock.segmentIndex).toBe(largeClock.segmentIndex + 1);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(result.world.clock.priorSegmentsS).toBe(largeClock.priorSegmentsS + largeClock.localTimeS);
    expect(result.world.clock.stepCount).toBe(largeClock.stepCount);
    expect(result.eventDispatch?.results[0]?.event.status).toBe('processed');
    expect(result.processRun?.status).toBe('idle');
    expect(largeClock.segmentIndex).toBe(0);
    expect(world.scheduling!.eventQueue[0]!.status).toBe('pending');
  });

  it('нормализует nextSegment:0 и запускает exact process deadline в этой точке', () => {
    const registry = makeRegistry([descriptor('b')]);
    const largeClock = advance(createSimulationClock(), 1e16);
    const scheduling = scheduleProcessAt(createSchedulerBookkeeping(), 'b', {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 0
    });
    const world = { ...testWorld(), clock: largeClock, scheduling };
    const calls: Call[] = [];

    const result = runScheduledWorldTurn(
      world,
      registry,
      [recorder('b', calls)],
      {},
      {
        eventAudit: { audit: { speciesCatalog: co2Catalog(), boundary: 'complete' } },
        process: { durationS: 1 }
      }
    );

    expect(result.status).toBe('completed');
    expect(result.world.clock.segmentIndex).toBe(largeClock.segmentIndex + 1);
    expect(result.world.clock.localTimeS).toBe(1);
    expect(result.world.clock.stepCount).toBe(largeClock.stepCount + 1);
    expect(result.processRun?.readyProcessIds).toEqual(['b']);
    expect(result.processRun?.status).toBe('committed');
    expect(calls).toEqual([{ processId: 'b', durationS: 1, intervalStartS: 0 }]);
    expect(result.world.scheduling!.processDynamics.b!.nextDueTime).toBeNull();
    expect(world.clock).toEqual(largeClock);
  });
});

describe('Stage 4.2.1 Scheduler: расписания процессов', () => {
  it('точное расписание сравнивается по сегменту/локальному времени, а не через elapsed-сумму', () => {
    const registry = makeRegistry([descriptor('a'), descriptor('b'), descriptor('off', { enabled: false })]);
    const opA: ProcessOperator = { processId: 'a', apply: (w) => w };
    const opB: ProcessOperator = { processId: 'b', apply: (w) => w };
    const opOff: ProcessOperator = { processId: 'off', apply: (w) => w };
    let bk = createSchedulerBookkeeping();
    bk = scheduleProcessAt(bk, 'a', { segmentIndex: 100000, localTimeS: 0.25 });
    bk = scheduleProcessAt(bk, 'b', { segmentIndex: 100001, localTimeS: 0 });
    bk = scheduleProcessAt(bk, 'off', { segmentIndex: 100000, localTimeS: 0 });

    expect(readyProcessIdsAt(bk, registry, [opA, opB, opOff], {
      segmentIndex: 99999,
      localTimeS: 1e300
    })).toEqual([]);
    expect(readyProcessIdsAt(bk, registry, [opA, opB, opOff], {
      segmentIndex: 100000,
      localTimeS: 0.249
    })).toEqual([]);
    expect(readyProcessIdsAt(bk, registry, [opA, opB, opOff], {
      segmentIndex: 100000,
      localTimeS: 0.25
    })).toEqual(['a']);
    expect(readyProcessIdsAt(bk, registry, [opA, opB, opOff], {
      segmentIndex: 100001,
      localTimeS: 0
    })).toEqual(['a', 'b']);
    // Legacy elapsed-time readiness does not reinterpret exact segmented deadlines.
    expect(readyProcessIds(bk, registry, [opA, opB, opOff], Number.MAX_VALUE)).toEqual([]);
    expect(validateSchedulerBookkeeping(bk)).toEqual([]);
    expect(validateSchedulerBookkeeping(JSON.parse(JSON.stringify(bk)) as unknown)).toEqual([]);
  });

  it('legacy elapsed schedule and exact schedule are mutually exclusive and can replace each other', () => {
    const registry = makeRegistry([descriptor('a')]);
    const opA: ProcessOperator = { processId: 'a', apply: (w) => w };
    let bk = scheduleProcessAt(createSchedulerBookkeeping(), 'a', {
      segmentIndex: 4,
      localTimeS: 0.5
    });
    expect(readyProcessIdsAt(bk, registry, [opA], { segmentIndex: 4, localTimeS: 0.5 })).toEqual(['a']);
    expect(readyProcessIds(bk, registry, [opA], 1e300)).toEqual([]);

    bk = scheduleProcess(bk, 'a', 12);
    expect(bk.processDynamics.a!.nextDueTime).toBeNull();
    expect(readyProcessIdsAt(bk, registry, [opA], { segmentIndex: 100, localTimeS: 0 })).toEqual([]);
    expect(readyProcessIds(bk, registry, [opA], 12)).toEqual(['a']);

    bk = scheduleProcessAt(bk, 'a', { segmentIndex: 6, localTimeS: 0.125 });
    expect(bk.processDynamics.a!.nextDueElapsedS).toBeNull();
    expect(readyProcessIds(bk, registry, [opA], 1e300)).toEqual([]);
    expect(readyProcessIdsAt(bk, registry, [opA], { segmentIndex: 6, localTimeS: 0.125 })).toEqual(['a']);
  });

  it('валидация не допускает два одновременно активных представления следующего запуска', () => {
    const scheduled = scheduleProcessAt(createSchedulerBookkeeping(), 'a', {
      segmentIndex: 2,
      localTimeS: 1
    });
    const invalid = {
      ...scheduled,
      processDynamics: {
        ...scheduled.processDynamics,
        a: { ...scheduled.processDynamics.a!, nextDueElapsedS: 10 }
      }
    };
    expect(validateSchedulerBookkeeping(invalid).join(' '))
      .toContain('не может одновременно задавать nextDueTime и nextDueElapsedS');
    expect(() => scheduleProcessAt(createSchedulerBookkeeping(), 'a', {
      segmentIndex: Number.MAX_SAFE_INTEGER + 1,
      localTimeS: 0
    })).toThrow(SchedulerError);
  });

  it('успешный запуск потребляет one-shot дедлайн и требует явного нового расписания', () => {
    const registry = makeRegistry([descriptor('a')]);
    const operator = recorder('a', []);
    const atStart = { segmentIndex: 0, localTimeS: 0 };
    const worldForExact = {
      ...testWorld(),
      scheduling: scheduleProcessAt(createSchedulerBookkeeping(), 'a', atStart)
    };
    expect(readyProcessIdsAt(worldForExact.scheduling!, registry, [operator], atStart)).toEqual(['a']);

    const exactRun = runMacroStep(worldForExact, registry, [operator], {
      durationS: 2,
      splitting: 'lie'
    });
    expect(exactRun.status).toBe('committed');
    expect(exactRun.bookkeeping.processDynamics.a!.lastRunTime).toEqual({
      segmentIndex: 0,
      localTimeS: 2
    });
    expect(exactRun.bookkeeping.processDynamics.a!.nextDueTime).toBeNull();
    expect(exactRun.bookkeeping.processDynamics.a!.nextDueElapsedS).toBeNull();
    expect(readyProcessIdsAt(exactRun.bookkeeping, registry, [operator], {
      segmentIndex: 0,
      localTimeS: 2
    })).toEqual([]);

    const worldForLegacy = {
      ...testWorld(),
      scheduling: scheduleProcess(createSchedulerBookkeeping(), 'a', 0)
    };
    const legacyRun = runMacroStep(worldForLegacy, registry, [operator], {
      durationS: 2,
      splitting: 'lie'
    });
    expect(legacyRun.status).toBe('committed');
    expect(legacyRun.bookkeeping.processDynamics.a!.nextDueElapsedS).toBeNull();
    expect(readyProcessIds(legacyRun.bookkeeping, registry, [operator], Number.MAX_VALUE)).toEqual([]);
  });

  it('ранний ручной запуск не уничтожает будущий exact или legacy deadline', () => {
    const registry = makeRegistry([descriptor('a')]);
    const operator = recorder('a', []);
    const exactDue = { segmentIndex: 0, localTimeS: 10 };
    const exactWorld = {
      ...testWorld(),
      scheduling: scheduleProcessAt(createSchedulerBookkeeping(), 'a', exactDue)
    };
    const exactRun = runMacroStep(exactWorld, registry, [operator], {
      durationS: 2,
      splitting: 'lie'
    });
    expect(exactRun.status).toBe('committed');
    expect(exactRun.bookkeeping.processDynamics.a!.nextDueTime).toEqual(exactDue);
    expect(readyProcessIdsAt(exactRun.bookkeeping, registry, [operator], {
      segmentIndex: 0,
      localTimeS: 2
    })).toEqual([]);

    const legacyWorld = {
      ...testWorld(),
      scheduling: scheduleProcess(createSchedulerBookkeeping(), 'a', 10)
    };
    const legacyRun = runMacroStep(legacyWorld, registry, [operator], {
      durationS: 2,
      splitting: 'lie'
    });
    expect(legacyRun.status).toBe('committed');
    expect(legacyRun.bookkeeping.processDynamics.a!.nextDueElapsedS).toBe(10);
    expect(readyProcessIds(legacyRun.bookkeeping, registry, [operator], 2)).toEqual([]);
  });

  it('runReadyProcessesAt исполняет только exact deadlines, наступившие в текущем TimePoint', () => {
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const calls: Call[] = [];
    const operators = [recorder('b', calls), recorder('a', calls)];
    const scheduling = scheduleProcessAt(
      scheduleProcessAt(createSchedulerBookkeeping(), 'a', { segmentIndex: 0, localTimeS: 0 }),
      'b',
      { segmentIndex: 0, localTimeS: 5 }
    );
    const world = { ...testWorld(), scheduling };

    const result = runReadyProcessesAt(world, registry, operators, { durationS: 2 });
    expect(result.status).toBe('committed');
    expect(result.readyProcessIds).toEqual(['a']);
    expect(calls).toEqual([{ processId: 'a', durationS: 2, intervalStartS: 0 }]);
    expect(result.world.clock.localTimeS).toBe(2);
    expect(result.bookkeeping.processDynamics.a!.nextDueTime).toBeNull();
    expect(result.bookkeeping.processDynamics.b!.nextDueTime).toEqual({
      segmentIndex: 0,
      localTimeS: 5
    });
    expect(readyProcessIdsAt(result.bookkeeping, registry, operators, {
      segmentIndex: 0,
      localTimeS: 2
    })).toEqual([]);
  });

  it('runReadyProcessesAt отклоняет наступивший deadline заблокированного процесса вместо idle', () => {
    const registry = makeRegistry([descriptor('disabled', { enabled: false })]);
    const world = {
      ...testWorld(),
      scheduling: scheduleProcessAt(createSchedulerBookkeeping(), 'disabled', {
        segmentIndex: 0,
        localTimeS: 0
      })
    };
    const result = runReadyProcessesAt(world, registry, [recorder('disabled', [])], {
      durationS: 1
    });

    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.readyProcessIds).toEqual([]);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(result.diagnostics.join(' ')).toContain('отключён (enabled=false)');
  });

  it('runReadyProcessesAt возвращает idle без продвижения времени, если точных сроков нет', () => {
    const registry = makeRegistry([descriptor('a')]);
    const calls: Call[] = [];
    const world = {
      ...testWorld(),
      scheduling: scheduleProcessAt(createSchedulerBookkeeping(), 'a', {
        segmentIndex: 0,
        localTimeS: 10
      })
    };
    const result = runReadyProcessesAt(world, registry, [recorder('a', calls)], {
      durationS: 2
    });

    expect(result.status).toBe('idle');
    expect(result.readyProcessIds).toEqual([]);
    expect(result.world).toBe(world);
    expect(result.bookkeeping).toBe(world.scheduling);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(calls).toEqual([]);
  });

  it('готовность: срок, autorunnable и переданный оператор', () => {
    const registry = makeRegistry([
      descriptor('a'),
      descriptor('b'),
      descriptor('off', { enabled: false }),
      descriptor('u', { tau: unknownValue('числовое τ неизвестно') })
    ]);
    let bk = createSchedulerBookkeeping();
    bk = scheduleProcess(bk, 'a', 5);
    bk = scheduleProcess(bk, 'b', 50);
    bk = scheduleProcess(bk, 'off', 0);
    bk = scheduleProcess(bk, 'u', 0);
    const opA: ProcessOperator = { processId: 'a', apply: (w) => w };
    const opB: ProcessOperator = { processId: 'b', apply: (w) => w };
    expect(readyProcessIds(bk, registry, [opA], 10)).toEqual(['a']);
    expect(readyProcessIds(bk, registry, [opA], 4)).toEqual([]);
    expect(readyProcessIds(bk, registry, [opA, opB], 60)).toEqual(['a', 'b']);
  });
});

// ============================================
// STAGE 4.2.3.3 - ЖУРНАЛ РЕАКЦИОННЫХ ТРАНЗАКЦИЙ В ПЛАНИРОВЩИКЕ
// ============================================

/** Каталог с известными составами для записи 2 H2 + O2 → 2 H2O. */
function waterCatalog() {
  const catalog = createSpeciesCatalog();
  const register = (id: string, elements: Record<string, number>): void => {
    catalog.register({
      id,
      formula: id.toUpperCase(),
      name: id,
      elements,
      charge: 0,
      phase: 'gas',
      molarMassKgMol: 0.02,
      molarMassStatus: 'known',
      dataStatus: 'known'
    });
  };
  register('h2', { h: 2 });
  register('o2', { o: 2 });
  register('h2o', { h: 2, o: 1 });
  register('co2', { c: 1, o: 2 });
  return catalog;
}

/** Запись реакции в резервуаре «atm» (по умолчанию сбалансированная). */
function schedulerReaction(id: string, productCoefficient = 2): ReactionRecord {
  return {
    id,
    reactionId: 'water-formation',
    reactants: [
      { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
      { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
    ],
    products: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: productCoefficient }],
    extent: 1,
    extentBasis: 'amount',
    time: { segmentIndex: 0, localTimeS: 0 },
    processId: 'a',
    note: 'тестовая транзакция шага'
  };
}

/**
 * Мир с известным материальным инвентарём для реакции
 * 2 H2 + O2 → 2 H2O в резервуаре «atm» (Stage 4.2.3.4).
 */
function reactiveWorld(): CoreWorldState {
  const reservoir = setEnergyInventory(
    setMaterialInventory(createReservoir('atm', 'atmosphere'), 'amount', { co2: 100, h2: 2, o2: 1, h2o: 0 }),
    { storedJ: 0, netPowerW: null, fluxW_m2: null }
  );
  return { ...createCoreWorldState('w'), reservoirs: [reservoir] };
}

/**
 * Иммутабельно применить завершённое превращение
 * 2 H2 + O2 → 2 H2O (extent 1, основание amount) к резервуару «atm».
 */
function applyWaterFormation(w: CoreWorldState): CoreWorldState {
  return {
    ...w,
    reservoirs: w.reservoirs.map((r) => {
      if (r.id !== 'atm' || r.material === undefined) {
        return r;
      }
      const entries = { ...r.material.entries };
      entries['h2'] = (entries['h2'] ?? 0) - 2;
      entries['o2'] = (entries['o2'] ?? 0) - 1;
      entries['h2o'] = (entries['h2o'] ?? 0) + 2;
      return { ...r, material: { ...r.material, entries } };
    })
  };
}

describe('Stage 4.2.3.3 Scheduler: журнал реакционных транзакций', () => {
  it('оператор регистрирует реакцию: commit фиксирует журнал, аудит balanced', () => {
    // Stage 4.2.3.4: запись описывает завершённое превращение — инвентарь обязан измениться ожидаемым образом
    const world = reactiveWorld();
    const registry = makeRegistry([descriptor('a')]);
    const reacting: ProcessOperator = {
      processId: 'a',
      apply: (w) => applyWaterFormation({
        ...w,
        reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-1'))
      })
    };
    const result = runMacroStep(world, registry, [reacting], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-1']);
    expect(result.audit?.status).toBe('balanced');
    // исходный мир не мутирован: его журнал пуст
    expect(world.reactionLedger?.records).toEqual([]);
  });

  it('snapshot-изоляция: записи журнала в результате — копии, ссылки с исходным миром не разделяются', () => {
    // Stage 4.2.3.4: запись описывает завершённое превращение — инвентарь обязан измениться ожидаемым образом
    const world = reactiveWorld();
    const existing: ReactionLedger = { records: [schedulerReaction('rxn-0')] };
    world.reactionLedger = existing;
    const registry = makeRegistry([descriptor('a')]);
    const reacting: ProcessOperator = {
      processId: 'a',
      apply: (w) => applyWaterFormation({
        ...w,
        reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-1'))
      })
    };
    const result = runMacroStep(world, registry, [reacting], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.world.reactionLedger?.records.length).toBe(2);
    expect(existing.records.length).toBe(1);
    // structuredClone-изоляция: запись исходного мира не «протекает» ссылкой в результат
    const carried = result.world.reactionLedger?.records.find((r) => r.id === 'rxn-0');
    expect(carried).not.toBe(existing.records[0]);
  });

  it('реакционный дисбаланс: шаг отклонён, мир и журнал на исходном snapshot', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const badStoichiometry: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-bad', 3))
      })
    };
    const result = runMacroStep(world, registry, [badStoichiometry], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.world).toBe(world);
    expect(world.reactionLedger?.records).toEqual([]);
    expect(world.clock.localTimeS).toBe(0);
  });

  it('ошибка оператора: атомарность — состояние и журнал нетронуты', () => {
    const world = testWorld();
    const existing: ReactionLedger = { records: [schedulerReaction('rxn-0')] };
    world.reactionLedger = existing;
    const registry = makeRegistry([descriptor('a')]);
    const failing: ProcessOperator = {
      processId: 'a',
      apply: () => {
        throw new Error('оператор сломан');
      }
    };
    const result = runMacroStep(world, registry, [failing], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(existing.records.length).toBe(1);
    expect(existing.records[0].id).toBe('rxn-0');
  });

  it('операторы без реакций не создают записей журнала автоматически', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const result = runMacroStep(world, registry, [recorder('a', [])], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.world.reactionLedger?.records).toEqual([]);
    expect(result.audit?.status).toBe('balanced');
  });
});


// ============================================
// STAGE 4.2.3.3.1 - APPEND-ONLY КОНТРАКТ ЖУРНАЛА РЕАКЦИЙ
// ============================================
//
// Записи журнала, существовавшие до macro-шага, неизменяемы:
// совпадающий id не доказывает неизменности записи. Разрешено
// только добавление новых записей в конец журнала; правка,
// удаление, перестановка старых записей и удаление журнала
// отклоняют шаг до аудита инвариантов. Новые записи обязаны
// пройти стехиометрический аудит: шаг с новыми реакциями без
// запрошенного аудита не фиксируется.

/** Мир с одной старой записью журнала реакций и инвентарём для превращения (Stage 4.2.3.4). */
function worldWithHistory(): CoreWorldState {
  const world = reactiveWorld();
  world.reactionLedger = { records: [schedulerReaction('rxn-0')] };
  return world;
}

/** Мир с двумя старыми записями (для проверки перестановки). */
function worldWithTwoRecords(): CoreWorldState {
  const world = testWorld();
  world.reactionLedger = { records: [schedulerReaction('rxn-0'), schedulerReaction('rxn-1')] };
  return world;
}

/**
 * Оператор, добавляющий новую сбалансированную запись в конец журнала.
 * Stage 4.2.3.4: запись описывает ЗАВЕРШЁННОЕ превращение — оператор
 * изменяет материальный инвентарь ожидаемым образом.
 */
function appendingOperator(): ProcessOperator {
  return {
    processId: 'a',
    apply: (w) => applyWaterFormation({
      ...w,
      reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-new'))
    })
  };
}

/**
 * Оператор, подменяющий старую запись (позиция 0) с сохранением id:
 * содержимое меняется мутатором, переданным вызывающей стороной.
 */
function tamperOperator(tamper: (record: ReactionRecord) => ReactionRecord): ProcessOperator {
  return {
    processId: 'a',
    apply: (w) => {
      const records = (w.reactionLedger?.records ?? []).map((r) => structuredClone(r));
      records[0] = tamper(records[0] as ReactionRecord);
      return { ...w, reactionLedger: { records } };
    }
  };
}

describe('Stage 4.2.3.3.1 Scheduler: append-only контракт журнала реакций', () => {
  it('новая сбалансированная запись при пустой истории — commit с аудитом balanced', () => {
    // Stage 4.2.3.4: завершённая транзакция подтверждается изменением инвентаря
    const world = reactiveWorld();
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [appendingOperator()], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-new']);
    expect(result.audit?.status).toBe('balanced');
  });

  it('неизменная история плюс новая сбалансированная запись — commit', () => {
    const world = worldWithHistory();
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [appendingOperator()], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-0', 'rxn-new']);
    expect(result.audit?.status).toBe('balanced');
  });

  it('мир без журнала до шага: все записи после шага — новые, commit', () => {
    // Stage 4.2.3.4: завершённая транзакция подтверждается изменением инвентаря
    const world = reactiveWorld();
    delete world.reactionLedger;
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [appendingOperator()], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-new']);
  });

  it('новая несбалансированная запись — reject с аудитом imbalanced', () => {
    const world = testWorld();
    const unbalanced: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-bad', 3))
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [unbalanced], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.world).toBe(world);
    expect(world.reactionLedger?.records.map((r) => r.id)).toEqual([]);
  });

  it('изменение extent старой записи с сохранением id — reject до аудита', () => {
    const world = worldWithHistory();
    const result = runMacroStep(
      world,
      makeRegistry([descriptor('a')]),
      [tamperOperator((r) => ({ ...r, extent: 999 }))],
      { durationS: 10, splitting: 'lie', audit: { speciesCatalog: waterCatalog(), boundary: 'complete' } }
    );
    expect(result.status).toBe('rejected');
    // отказ происходит ДО аудита инвариантов: нарушен append-only контракт
    expect(result.audit).toBeUndefined();
    expect(result.diagnostics.some((d) => d.includes('append-only'))).toBe(true);
    expect(world.reactionLedger?.records[0]?.extent).toBe(1);
  });

  it('подмена старой записи на стехиометрически несбалансированную — reject до аудита', () => {
    const world = worldWithHistory();
    const result = runMacroStep(
      world,
      makeRegistry([descriptor('a')]),
      [tamperOperator((r) => ({ ...r, products: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 3 }] }))],
      { durationS: 10, splitting: 'lie', audit: { speciesCatalog: waterCatalog(), boundary: 'complete' } }
    );
    expect(result.status).toBe('rejected');
    expect(result.audit).toBeUndefined();
    expect(result.diagnostics.some((d) => d.includes('изменена'))).toBe(true);
  });

  it('удаление старой записи — reject', () => {
    const world = worldWithHistory();
    const removing: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({ ...w, reactionLedger: { records: [] } })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [removing], {
      durationS: 10, splitting: 'lie', audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.diagnostics.some((d) => d.includes('удалены'))).toBe(true);
  });

  it('перестановка старых записей — reject', () => {
    const world = worldWithTwoRecords();
    const swapping: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({ ...w, reactionLedger: { records: [...(w.reactionLedger?.records ?? [])].reverse() } })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [swapping], {
      durationS: 10, splitting: 'lie', audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.diagnostics.some((d) => d.includes('изменена или сдвинута'))).toBe(true);
    expect(world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-0', 'rxn-1']);
  });

  it('изменение note, time, extentBasis или processId старой записи — reject', () => {
    const tampers: Array<(record: ReactionRecord) => ReactionRecord> = [
      (r) => ({ ...r, note: 'подменённая заметка' }),
      (r) => ({ ...r, time: { segmentIndex: 0, localTimeS: 999 } }),
      (r) => ({ ...r, extentBasis: 'column_amount' }),
      (r) => ({ ...r, processId: 'not-a' })
    ];
    for (const tamper of tampers) {
      const world = worldWithHistory();
      const result = runMacroStep(
        world,
        makeRegistry([descriptor('a')]),
        [tamperOperator(tamper)],
        { durationS: 10, splitting: 'lie', audit: { speciesCatalog: waterCatalog(), boundary: 'complete' } }
      );
      expect(result.status).toBe('rejected');
      expect(result.diagnostics.some((d) => d.includes('append-only'))).toBe(true);
    }
  });

  it('удаление журнала из состояния мира — reject', () => {
    const world = worldWithHistory();
    const dropping: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        const copy = { ...w };
        delete copy.reactionLedger;
        return copy;
      }
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [dropping], {
      durationS: 10, splitting: 'lie', audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.diagnostics.some((d) => d.includes('удалён'))).toBe(true);
  });

  it('шаг добавил реакции, но аудит инвариантов не запрошен — reject', () => {
    const world = worldWithHistory();
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [appendingOperator()], {
      durationS: 10,
      splitting: 'lie'
    });
    expect(result.status).toBe('rejected');
    expect(result.diagnostics.some((d) => d.includes('аудит инвариантов не запрошен'))).toBe(true);
    expect(world.clock.localTimeS).toBe(0);
    expect(world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-0']);
    expect(result.bookkeeping.stepCount).toBe(0);
  });

  it('отказные сценарии изолированы: исходный мир, журнал и записи не затронуты', () => {
    const scenarios: ProcessOperator[] = [
      tamperOperator((r) => ({ ...r, extent: 999 })),
      tamperOperator((r) => ({ ...r, products: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 3 }] })),
      { processId: 'a', apply: (w) => ({ ...w, reactionLedger: { records: [] } }) }
    ];
    for (const operator of scenarios) {
      const world = worldWithHistory();
      const originalLedger = world.reactionLedger;
      const originalRecord = originalLedger?.records[0];
      const result = runMacroStep(world, makeRegistry([descriptor('a')]), [operator], {
        durationS: 10, splitting: 'lie', audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
      });
      expect(result.status).toBe('rejected');
      expect(result.world).toBe(world);
      expect(world.reactionLedger).toBe(originalLedger);
      expect(world.reactionLedger?.records[0]).toBe(originalRecord);
      expect(world.clock.stepCount).toBe(0);
    }
    // перестановка: исходный порядок двух старых записей сохранён
    const world = worldWithTwoRecords();
    const originalLedger = world.reactionLedger;
    const swapping: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({ ...w, reactionLedger: { records: [...(w.reactionLedger?.records ?? [])].reverse() } })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [swapping], {
      durationS: 10, splitting: 'lie', audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(world.reactionLedger).toBe(originalLedger);
    expect(world.reactionLedger?.records[0]?.id).toBe('rxn-0');
  });
});


// ============================================
// STAGE 4.2.3.1 - Snapshot-изоляция состояния мира
// ============================================
//
// Macro-шаг выполняется на полной изолированной копии мира:
// операторы физически не могут изменить объект вызывающей
// стороны (включая вложенные bodies, reservoirs, fluxLedger и
// scheduling). Отклонение шага — ошибкой оператора, движением
// часов или аудитом инвариантов — оставляет исходный world
// глубоко неизменным; успешный шаг фиксирует итоговое рабочее
// состояние, а не частично изменённый объект вызывающей стороны.

describe('Stage 4.2.3.1 Scheduler: snapshot-изоляция состояния мира', () => {
  /** Мир со вложенными структурами, которые попробуют мутировать операторы. */
  function snapshotTestWorld(): CoreWorldState {
    const base = testWorld();
    const world: CoreWorldState = {
      ...base,
      bodies: [
        {
          id: 'planet',
          kind: 'planet',
          properties: { massKg: knownValue(quantity(5.972e24, 'kg')) }
        }
      ],
      gravity: { planet: null },
      fluxLedger: {
        records: [
          {
            id: 'flux-1',
            kind: 'internal_transfer',
            from: 'atm',
            to: 'atm',
            subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' },
            time: { segmentIndex: 0, localTimeS: 0 },
            status: 'applied'
          }
        ]
      }
    };
    return world;
  }

  /** Мутация НЕСКОЛЬКИХ вложенных полей рабочего состояния на месте. */
  function mutateNestedInPlace(w: CoreWorldState): void {
    const res = w.reservoirs[0];
    if (res !== undefined && res.material !== undefined) {
      res.material.entries['co2'] = 5;
    }
    if (res !== undefined && res.energy !== undefined) {
      res.energy.storedJ = 4321;
    }
    const body = w.bodies[0];
    if (body !== undefined) {
      body.properties['massKg'] = knownValue(quantity(1, 'kg'));
    }
    const rec = w.fluxLedger.records[0];
    if (rec !== undefined && rec.subject.subjectType === 'substance' && rec.subject.quantityKind === 'integrated') {
      rec.subject.amount = 999;
    }
  }

  it('Тест A: оператор мутировал вложенное состояние и выбросил исключение — исходный мир глубоко неизменен', () => {
    const world = snapshotTestWorld();
    const pristine = structuredClone(world);
    const registry = makeRegistry([descriptor('a')]);
    const mutator: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        mutateNestedInPlace(w);
        throw new Error('оператор сломался после мутаций');
      }
    };
    const result = runMacroStep(world, registry, [mutator], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    // возвращён ИСХОДНЫЙ объект вызывающей стороны
    expect(result.world).toBe(world);
    // исходный мир глубоко идентичен снимку до вызова
    expect(world).toEqual(pristine);
    // ни одна вложенная структура не изменилась
    expect(world.reservoirs[0]?.material?.entries['co2']).toBe(100);
    expect(world.reservoirs[0]?.energy?.storedJ).toBe(0);
    expect(world.bodies[0]?.properties['massKg']).toEqual(knownValue(quantity(5.972e24, 'kg')));
    const rec = world.fluxLedger.records[0];
    expect(rec?.subject.subjectType === 'substance' && rec.subject.quantityKind === 'integrated' ? rec.subject.amount : null).toBe(1);
    // часы и bookkeeping не продвинулись
    expect(world.clock.localTimeS).toBe(0);
    expect(world.clock.stepCount).toBe(0);
    expect(world.scheduling).toBeUndefined();
    expect(result.bookkeeping.stepCount).toBe(0);
    // диагностика содержит причину отказа
    expect(result.diagnostics.join(' ')).toContain('оператор сломался после мутаций');
    expect(result.log.every((e) => e.status === 'rejected')).toBe(true);
  });

  it('Тест B: успех первого оператора + ошибка второго — весь шаг отклонён, частичный результат не фиксируется', () => {
    const world = snapshotTestWorld();
    const pristine = structuredClone(world);
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const good: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        mutateNestedInPlace(w);
        return w;
      }
    };
    const bad: ProcessOperator = {
      processId: 'b',
      apply: () => {
        throw new Error('второй оператор сломан');
      }
    };
    const result = runMacroStep(world, registry, [good, bad], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    // изменения первого оператора не попали в исходный мир
    expect(world).toEqual(pristine);
    expect(world.reservoirs[0]?.material?.entries['co2']).toBe(100);
    // шаг отклонён целиком: время и счётчики шагов не изменились
    expect(world.clock.localTimeS).toBe(0);
    expect(world.clock.stepCount).toBe(0);
    expect(world.scheduling).toBeUndefined();
    expect(result.bookkeeping.stepCount).toBe(0);
    // все записи лога имеют статус rejected
    expect(result.log.length).toBe(2);
    expect(result.log.every((e) => e.status === 'rejected')).toBe(true);
  });

  it('Тест C: успешный шаг фиксирует рабочее состояние; входной мир нетронут; часы продвинулись ровно один раз', () => {
    const world = snapshotTestWorld();
    const pristine = structuredClone(world);
    const registry = makeRegistry([descriptor('a')]);
    const worker: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        const res = w.reservoirs[0];
        if (res !== undefined && res.material !== undefined) {
          res.material.entries['co2'] = 90;
        }
        return w;
      }
    };
    const result = runMacroStep(world, registry, [worker], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('committed');
    // зафиксировано итоговое рабочее состояние с ожидаемыми изменениями
    expect(result.world.reservoirs[0]?.material?.entries['co2']).toBe(90);
    // входной объект вызывающей стороны остался неизменным
    expect(world).toEqual(pristine);
    expect(world.reservoirs[0]?.material?.entries['co2']).toBe(100);
    expect(world.clock.localTimeS).toBe(0);
    expect(world.clock.stepCount).toBe(0);
    // часы продвинулись ровно на durationS
    expect(result.world.clock.localTimeS).toBe(10);
    expect(result.world.clock.stepCount).toBe(1);
    // bookkeeping и журнал вызовов обновились ровно один раз
    expect(result.bookkeeping.stepCount).toBe(1);
    expect(result.world.scheduling?.stepCount).toBe(1);
    expect(result.log.length).toBe(1);
    expect(result.log[0]?.status).toBe('committed');
    expect(result.bookkeeping.processDynamics['a']?.operatorCallsCompleted).toBe(1);
    expect(result.bookkeeping.processDynamics['a']?.macroStepsCompleted).toBe(1);
  });

  it('Тест D: оператор изменил материал и незаконно двинул часы — шаг отклонён, мир без мутаций', () => {
    const world = snapshotTestWorld();
    const pristine = structuredClone(world);
    const registry = makeRegistry([descriptor('a')]);
    const mover: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        const res = w.reservoirs[0];
        if (res !== undefined && res.material !== undefined) {
          res.material.entries['co2'] = 7;
        }
        return { ...w, clock: { ...w.clock, localTimeS: w.clock.localTimeS + 1 } };
      }
    };
    const result = runMacroStep(world, registry, [mover], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    // первоначальный мир сохранён без мутаций
    expect(world).toEqual(pristine);
    expect(world.reservoirs[0]?.material?.entries['co2']).toBe(100);
    expect(world.clock.localTimeS).toBe(0);
    expect(world.clock.stepCount).toBe(0);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(result.diagnostics.join(' ')).toContain('продвинул мировое время');
  });

  it('Тест E: аудит отклонил переход как imbalanced — исходный мир и все вложенные объекты неизменны', () => {
    const world = snapshotTestWorld();
    const pristine = structuredClone(world);
    const registry = makeRegistry([descriptor('a')]);
    const leaking: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        const res = w.reservoirs[0];
        if (res !== undefined && res.material !== undefined) {
          res.material.entries['co2'] = 55;
        }
        return w;
      }
    };
    const result = runMacroStep(world, registry, [leaking], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: co2Catalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.world).toBe(world);
    expect(world).toEqual(pristine);
    expect(world.reservoirs[0]?.material?.entries['co2']).toBe(100);
    expect(world.clock.localTimeS).toBe(0);
    expect(result.bookkeeping.stepCount).toBe(0);
  });

  it('Тест F: повторяемость — одинаковое состояние и операторы дают детерминированный результат', () => {
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const opA: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        const res = w.reservoirs[0];
        if (res !== undefined && res.material !== undefined) {
          res.material.entries['co2'] = 80;
        }
        return w;
      }
    };
    const opB: ProcessOperator = { processId: 'b', apply: (w) => w };
    const first = runMacroStep(snapshotTestWorld(), registry, [opA, opB], { durationS: 10, splitting: 'lie' });
    const second = runMacroStep(snapshotTestWorld(), registry, [opA, opB], { durationS: 10, splitting: 'lie' });
    expect(first.status).toBe('committed');
    expect(second.status).toBe('committed');
    // механизм копирования и порядок обхода полей не вносят различий
    expect(
      JSON.stringify({ world: second.world, bookkeeping: second.bookkeeping, log: second.log, diagnostics: second.diagnostics })
    ).toBe(JSON.stringify({ world: first.world, bookkeeping: first.bookkeeping, log: first.log, diagnostics: first.diagnostics }));
    // повторные прогоны на одном и том же входном объекте: мир нетронут, результат идентичен
    const world = snapshotTestWorld();
    const pristine = structuredClone(world);
    const r1 = runMacroStep(world, registry, [opA, opB], { durationS: 10, splitting: 'lie' });
    const r2 = runMacroStep(world, registry, [opA, opB], { durationS: 10, splitting: 'lie' });
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
    expect(world).toEqual(pristine);
  });

  it('неклонируемое состояние мира — контролируемый отказ ДО вызова первого оператора', () => {
    const world = snapshotTestWorld();
    (world.legacy as unknown as { seed?: unknown }).seed = (() => 'несериализуемо') as unknown as string;
    const registry = makeRegistry([descriptor('a')]);
    let operatorCalls = 0;
    const probe: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        operatorCalls += 1;
        return w;
      }
    };
    const result = runMacroStep(world, registry, [probe], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    // ни один оператор не был вызван
    expect(operatorCalls).toBe(0);
    // исходное состояние нетронуто
    expect(result.world).toBe(world);
    expect(world.clock.localTimeS).toBe(0);
    expect(result.bookkeeping.stepCount).toBe(0);
    expect(result.log).toEqual([]);
    expect(result.diagnostics.join(' ')).toContain('рабочий снимок');
  });
});

// ============================================
// STAGE 4.2.3.3.2 - ВАЛИДАЦИЯ НОВОГО ЖУРНАЛА БЕЗ СТАРОГО
// ============================================
//
// Мир без журнала до шага: форма появившегося журнала проверяется
// до фиксации. Некорректная форма (records не массив, null, битая
// запись) — контролируемый reject, а не commit и не исключение;
// валидные новые записи по-прежнему требуют аудита.

describe('Stage 4.2.3.3.2 Scheduler: валидация нового журнала при отсутствии старого', () => {
  /** Мир без журнала реакций (поле отсутствует) и с инвентарём для превращения 4.2.3.4. */
  function worldWithoutLedger(): CoreWorldState {
    const world = reactiveWorld();
    delete world.reactionLedger;
    return world;
  }

  it('исходный мир без журнала: оператор добавляет валидный пустой журнал — commit', () => {
    const world = worldWithoutLedger();
    const addingEmpty: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({ ...w, reactionLedger: { records: [] } })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [addingEmpty], {
      durationS: 10,
      splitting: 'lie'
    });
    expect(result.status).toBe('committed');
    expect(result.world.reactionLedger).toEqual({ records: [] });
    // исходный мир по-прежнему без журнала
    expect(world.reactionLedger).toBeUndefined();
  });

  it('исходный мир без журнала: records не массив, без аудита — reject', () => {
    const world = worldWithoutLedger();
    const addingBroken: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({ ...w, reactionLedger: { records: 'bad' } as unknown as ReactionLedger })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [addingBroken], {
      durationS: 10,
      splitting: 'lie'
    });
    expect(result.status).toBe('rejected');
    expect(result.audit).toBeUndefined();
    expect(result.diagnostics.some((d) => d.includes('append-only'))).toBe(true);
    expect(result.world).toBe(world);
    expect(world.reactionLedger).toBeUndefined();
    expect(world.clock.stepCount).toBe(0);
  });

  it('исходный мир без журнала: явный null — контролируемый reject, не исключение', () => {
    const world = worldWithoutLedger();
    const settingNull: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({ ...w, reactionLedger: null as unknown as ReactionLedger })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [settingNull], {
      durationS: 10,
      splitting: 'lie'
    });
    expect(result.status).toBe('rejected');
    expect(result.diagnostics.some((d) => d.includes('null'))).toBe(true);
    expect(result.world).toBe(world);
    expect(world.reactionLedger).toBeUndefined();
  });

  it('исходный мир без журнала: массив с некорректной записью — reject до аудита', () => {
    const world = worldWithoutLedger();
    const addingInvalid: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reactionLedger: { records: [{ id: 'rxn-bad' }] as unknown as ReactionRecord[] }
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [addingInvalid], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    // форма отклоняется ДО стехиометрического аудита
    expect(result.audit).toBeUndefined();
    expect(result.diagnostics.some((d) => d.includes('некорректен'))).toBe(true);
    expect(result.world).toBe(world);
  });

  it('с валидным аудитом новая сбалансированная запись — commit', () => {
    const world = worldWithoutLedger();
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [appendingOperator()], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-new']);
    expect(result.audit?.status).toBe('balanced');
  });

  it('с валидным аудитом новая несбалансированная запись — reject с imbalanced', () => {
    const world = worldWithoutLedger();
    const unbalanced: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reactionLedger: { records: [schedulerReaction('rxn-bad', 3)] }
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [unbalanced], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.world).toBe(world);
  });

  it('ошибочные сценарии не изменяют исходный мир, часы, журнал и вложенные ссылки', () => {
    const scenarios: ProcessOperator[] = [
      { processId: 'a', apply: (w) => ({ ...w, reactionLedger: { records: 'bad' } as unknown as ReactionLedger }) },
      { processId: 'a', apply: (w) => ({ ...w, reactionLedger: null as unknown as ReactionLedger }) },
      {
        processId: 'a',
        apply: (w) => ({ ...w, reactionLedger: { records: [{ id: 'rxn-bad' }] as unknown as ReactionRecord[] } })
      }
    ];
    for (const operator of scenarios) {
      const world = worldWithHistory();
      const pristine = structuredClone(world);
      const originalLedger = world.reactionLedger;
      const originalRecord = originalLedger?.records[0];
      const originalReservoir = world.reservoirs[0];
      const result = runMacroStep(world, makeRegistry([descriptor('a')]), [operator], {
        durationS: 10,
        splitting: 'lie',
        audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
      });
      expect(result.status).toBe('rejected');
      expect(result.audit).toBeUndefined();
      expect(result.world).toBe(world);
      expect(world.reactionLedger).toBe(originalLedger);
      expect(world.reactionLedger?.records[0]).toBe(originalRecord);
      expect(world.reservoirs[0]).toBe(originalReservoir);
      expect(world.clock.stepCount).toBe(0);
      expect(world).toEqual(pristine);
    }
  });
});

describe('Stage 4.2.3.3.3 Scheduler: циклические данные и разреженные участники', () => {
  /** Мир без журнала реакций (поле отсутствует). */
  function worldWithoutLedger(): CoreWorldState {
    const world = testWorld();
    delete world.reactionLedger;
    return world;
  }

  it('существующая запись с циклическим дополнительным полем: обычный шаг — контролируемый rejected, без исключения', () => {
    const world = worldWithHistory();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const ledger = world.reactionLedger;
    if (ledger === undefined) {
      throw new Error('фикстура worldWithHistory обязана содержать журнал реакций');
    }
    (ledger.records[0] as unknown as { extra?: unknown }).extra = cyclic;
    const pristine = structuredClone(world);
    const originalLedger = world.reactionLedger;
    const originalRecord = originalLedger?.records[0];
    const originalReservoir = world.reservoirs[0];
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [appendingOperator()], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    // цикл делает равенство недоказуемым: fail-closed — нарушение
    // append-only, а не RangeError; аудит не выполняется
    expect(result.audit).toBeUndefined();
    expect(result.diagnostics.some((d) => d.includes('изменена или сдвинута'))).toBe(true);
    expect(result.world).toBe(world);
    expect(world.reactionLedger).toBe(originalLedger);
    expect(world.reactionLedger?.records[0]).toBe(originalRecord);
    expect(world.reservoirs[0]).toBe(originalReservoir);
    expect(world.clock.stepCount).toBe(0);
    expect(world).toEqual(pristine);
  });

  it('новая запись с разреженным массивом участников: reject до аудита, исходный мир нетронут', () => {
    const world = worldWithoutLedger();
    const pristine = structuredClone(world);
    const addingSparse: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reactionLedger: { records: [{ ...schedulerReaction('rxn-sparse'), reactants: new Array(1) }] }
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [addingSparse], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    // форма нового журнала отклоняется ДО стехиометрического аудита
    expect(result.audit).toBeUndefined();
    expect(result.diagnostics.some((d) => d.includes('некорректен'))).toBe(true);
    expect(result.diagnostics.some((d) => d.includes('разреженный массив'))).toBe(true);
    expect(result.world).toBe(world);
    expect(world.reactionLedger).toBeUndefined();
    expect(world.clock.stepCount).toBe(0);
    expect(world).toEqual(pristine);
  });
});

describe('Stage 4.2.3.3.4 Scheduler: унаследованные индексы массивов не заменяют элементы', () => {
  /** Мир без журнала реакций (поле отсутствует). */
  function worldWithoutLedger(): CoreWorldState {
    const world = testWorld();
    delete world.reactionLedger;
    return world;
  }

  it('новая запись с дыркой в reactants, унаследованной из prototype chain: reject до аудита, исходный мир нетронут', () => {
    const world = worldWithoutLedger();
    const pristine = structuredClone(world);
    const sparseReactants = new Array(1);
    Object.setPrototypeOf(sparseReactants, { 0: { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 } });
    const addingInherited: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reactionLedger: { records: [{ ...schedulerReaction('rxn-proto-hole'), reactants: sparseReactants }] }
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [addingInherited], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    // унаследованный индекс — не собственный элемент: структурная
    // ошибка формы отклоняется ДО стехиометрического аудита
    expect(result.audit).toBeUndefined();
    expect(result.diagnostics.some((d) => d.includes('некорректен'))).toBe(true);
    expect(result.diagnostics.some((d) => d.includes('разреженный массив'))).toBe(true);
    expect(result.world).toBe(world);
    expect(world.reactionLedger).toBeUndefined();
    expect(world.clock.stepCount).toBe(0);
    expect(world).toEqual(pristine);
  });
});

describe('Stage 4.2.3.4 Scheduler: согласование реакций с инвентарями', () => {
  it('подтверждённое превращение: commit, секция reaction_inventory balanced, инвентарь изменён', () => {
    const world = reactiveWorld();
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [appendingOperator()], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.audit?.status).toBe('balanced');
    expect(result.audit?.sections.find((s) => s.key === 'reaction_inventory')?.status).toBe('balanced');
    expect(result.world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-new']);
    expect(result.world.reservoirs[0]?.material?.entries['h2o']).toBe(2);
    expect(result.world.reservoirs[0]?.material?.entries['h2']).toBe(0);
  });

  it('запись без изменения инвентаря — reject с известным несоответствием; атомарность сохранена', () => {
    const world = reactiveWorld();
    const pristine = structuredClone(world);
    const recordOnly: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-no-inv'))
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [recordOnly], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.audit?.sections.find((s) => s.key === 'reaction_inventory')?.status).toBe('imbalanced');
    // исходный CoreWorldState, часы, журнал и материальные инвентари нетронуты
    expect(result.world).toBe(world);
    expect(world).toEqual(pristine);
    expect(world.clock.stepCount).toBe(0);
    expect(world.reactionLedger?.records).toEqual([]);
    expect(world.reservoirs[0]?.material?.entries['h2']).toBe(2);
    expect(result.bookkeeping.stepCount).toBe(0);
  });

  it('неверный размер изменения — reject; исходное состояние нетронуто', () => {
    const world = reactiveWorld();
    const wrongAmount: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reservoirs: w.reservoirs.map((r) => {
          if (r.id !== 'atm' || r.material === undefined) {
            return r;
          }
          return { ...r, material: { ...r.material, entries: { ...r.material.entries, h2o: 1 } } };
        }),
        reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-wrong'))
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [wrongAmount], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('rejected');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.audit?.sections.find((s) => s.key === 'reaction_inventory')?.status).toBe('imbalanced');
    expect(result.world).toBe(world);
    expect(world.clock.stepCount).toBe(0);
    expect(world.reservoirs[0]?.material?.entries['h2o']).toBe(0);
  });

  it('поток и реакция в одном шаге: вклады складываются ровно один раз', () => {
    const world = reactiveWorld();
    const fluxAndReaction: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        const fluxLedger = registerFlux(createFluxLedger(), {
          id: 'flux-h2o',
          kind: 'external_input',
          from: EXTERNAL,
          to: 'atm',
          subject: { subjectType: 'substance', speciesId: 'h2o', quantityKind: 'integrated', amount: 3, basis: 'amount' }
        });
        const map: Record<string, ReservoirRecord> = {};
        for (const r of w.reservoirs) {
          map[r.id] = r;
        }
        const applied = applyFlux(fluxLedger, map, 'flux-h2o');
        return applyWaterFormation({
          ...w,
          reservoirs: [applied.reservoirs['atm']],
          fluxLedger: applied.ledger,
          reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-with-flux'))
        });
      }
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [fluxAndReaction], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.audit?.status).toBe('balanced');
    expect(result.audit?.sections.find((s) => s.key === 'reaction_inventory')?.status).toBe('balanced');
    // реакция не превратилась в поток: один поток и одна запись реакции
    expect(result.world.fluxLedger.records.length).toBe(1);
    expect(result.world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-with-flux']);
    expect(result.world.reservoirs[0]?.material?.entries['h2o']).toBe(5);
  });

  it('две реакции в одном шаге: повторное участие вида агрегируется', () => {
    const world = reactiveWorld();
    const twoReactions: ProcessOperator = {
      processId: 'a',
      apply: (w) => {
        const reverse: ReactionRecord = {
          ...schedulerReaction('rxn-rev'),
          reactants: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 2 }],
          products: [
            { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
            { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
          ],
          extent: 0.5
        };
        const reactionLedger = registerReaction(
          registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-fwd')),
          reverse
        );
        return {
          ...w,
          reservoirs: w.reservoirs.map((r) => {
            if (r.id !== 'atm' || r.material === undefined) {
              return r;
            }
            const entries = { ...r.material.entries };
            entries['h2'] = (entries['h2'] ?? 0) - 2 + 1;
            entries['o2'] = (entries['o2'] ?? 0) - 1 + 0.5;
            entries['h2o'] = (entries['h2o'] ?? 0) + 2 - 1;
            return { ...r, material: { ...r.material, entries } };
          }),
          reactionLedger
        };
      }
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [twoReactions], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.audit?.status).toBe('balanced');
    expect(result.audit?.sections.find((s) => s.key === 'reaction_inventory')?.status).toBe('balanced');
    expect(result.world.reactionLedger?.records.map((r) => r.id)).toEqual(['rxn-fwd', 'rxn-rev']);
    expect(result.world.reservoirs[0]?.material?.entries['h2o']).toBe(1);
    expect(result.world.reservoirs[0]?.material?.entries['h2']).toBe(1);
    expect(result.world.reservoirs[0]?.material?.entries['o2']).toBe(0.5);
  });
});


// ============================================
// STAGE 4.2.3.4.1 - PROTOTYPE-SAFE ВИДЫ И НЕКОРРЕКТНЫЙ TOLERANCE В ПЛАНИРОВЩИКЕ
// ============================================

describe('Stage 4.2.3.4.1 Scheduler: prototype-safe виды и некорректный tolerance', () => {
  /** Каталог с видом «__proto__» (элемент x) и его димером (x: 2). */
  function protoCatalog() {
    const catalog = createSpeciesCatalog();
    const register = (id: string, elements: Record<string, number>): void => {
      catalog.register({
        id,
        formula: id.toUpperCase(),
        name: id,
        elements,
        charge: 0,
        phase: 'gas',
        molarMassKgMol: 0.02,
        molarMassStatus: 'known',
        dataStatus: 'known'
      });
    };
    register('__proto__', { x: 1 });
    register('dimer', { x: 2 });
    return catalog;
  }

  /** entries с СОБСТВЕННЫМ ключом «__proto__» (литерал own-ключа не создаёт). */
  function protoEntries(speciesAmount: number, dimerAmount: number): Record<string, number> {
    const entries = Object.create(null) as Record<string, number>;
    Object.defineProperty(entries, '__proto__', {
      value: speciesAmount,
      writable: true,
      enumerable: true,
      configurable: true
    });
    entries['dimer'] = dimerAmount;
    return entries;
  }

  /** Реакция 2 «__proto__» → димер (extent 1, основание amount) в «atm». */
  function protoReaction(): ReactionRecord {
    return {
      id: 'rxn-proto',
      reactionId: 'dimer-formation',
      reactants: [{ reservoirId: 'atm', speciesId: '__proto__', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'dimer', coefficient: 1 }],
      extent: 1,
      extentBasis: 'amount',
      time: { segmentIndex: 0, localTimeS: 0 },
      processId: 'a',
      note: 'тестовая транзакция шага'
    };
  }

  it('оператор с видом «__proto__»: вклад не теряется, шаг фиксируется, аудит balanced', () => {
    const reservoir = setEnergyInventory(
      setMaterialInventory(createReservoir('atm', 'atmosphere'), 'amount', protoEntries(2, 0)),
      { storedJ: 0, netPowerW: null, fluxW_m2: null }
    );
    const world: CoreWorldState = { ...createCoreWorldState('w'), reservoirs: [reservoir] };
    const reacting: ProcessOperator = {
      processId: 'a',
      apply: (w) => ({
        ...w,
        reservoirs: w.reservoirs.map((r) =>
          r.id === 'atm' && r.material !== undefined
            ? { ...r, material: { ...r.material, entries: protoEntries(0, 1) } }
            : r
        ),
        reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, protoReaction())
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [reacting], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: protoCatalog(), boundary: 'complete' }
    });
    expect(result.status).toBe('committed');
    expect(result.audit?.status).toBe('balanced');
    expect(result.audit?.sections.find((s) => s.key === 'reaction_inventory')?.status).toBe('balanced');
    const afterEntries = result.world.reservoirs[0]?.material?.entries as Record<string, number>;
    expect(Object.prototype.hasOwnProperty.call(afterEntries, '__proto__')).toBe(true);
    expect(afterEntries['__proto__']).toBe(0);
    expect(afterEntries['dimer']).toBe(1);
  });

  it('некорректный tolerance (NaN): шаг отклонён по секции reaction_inventory, состояние не фиксируется', () => {
    const world = reactiveWorld();
    const reacting: ProcessOperator = {
      processId: 'a',
      apply: (w) => applyWaterFormation({
        ...w,
        reactionLedger: registerReaction(w.reactionLedger ?? { records: [] }, schedulerReaction('rxn-1'))
      })
    };
    const result = runMacroStep(world, makeRegistry([descriptor('a')]), [reacting], {
      durationS: 10,
      splitting: 'lie',
      audit: { speciesCatalog: waterCatalog(), boundary: 'complete', tolerance: Number.NaN }
    });
    expect(result.status).toBe('rejected');
    expect(result.audit?.status).toBe('imbalanced');
    expect(result.audit?.sections.find((s) => s.key === 'reaction_inventory')?.status).toBe('invalid');
    // атомарность: исходный мир не изменён, время не продвинуто
    expect(result.world).toBe(world);
    expect(result.world.clock.localTimeS).toBe(0);
    expect(world.reactionLedger?.records).toEqual([]);
  });
});


// ============================================
// Stage 4.2.3.3: explicit_only-процессы (явный пользовательский запуск)
// ============================================

describe('Stage 4.2.3.3 Scheduler: explicit_only-процессы', () => {
  const explicitDescriptor = (id: string): ProcessDescriptor =>
    descriptor(id, {
      executionMode: 'explicit_only',
      tau: unknownValue('характеристическое время дискретной операции неизвестно')
    });

  it('explicit_only не попадает в очередь автоматически готовых процессов', () => {
    const registry = makeRegistry([explicitDescriptor('d'), descriptor('a')]);
    const bookkeeping = scheduleProcess(
      scheduleProcess(createSchedulerBookkeeping(), 'd', 0),
      'a',
      0
    );
    const ready = readyProcessIds(bookkeeping, registry, [recorder('d', []), recorder('a', [])], 0);
    expect(ready).toContain('a');
    expect(ready).not.toContain('d');
  });

  it('автоматический запуск explicit_only (без opts.explicit) → explicit_only_process', () => {
    const world = testWorld();
    const registry = makeRegistry([explicitDescriptor('d')]);
    const calls: Call[] = [];
    expectSchedulerError(
      () => runMacroStep(world, registry, [recorder('d', calls)], { durationS: 10, splitting: 'lie' }),
      'explicit_only_process'
    );
    expect(calls).toEqual([]);
    expect(world.clock.localTimeS).toBe(0);
  });

  it('explicit_only в одном списке с обычным процессом (без explicit) → explicit_only_process', () => {
    const world = testWorld();
    const registry = makeRegistry([explicitDescriptor('d'), descriptor('a')]);
    const calls: Call[] = [];
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, [recorder('d', []), recorder('a', calls)], {
          durationS: 10,
          splitting: 'lie'
        }),
      'explicit_only_process'
    );
    expect(calls).toEqual([]);
  });

  it('явный запуск с неизвестным τ выполняется один раз с фактической длительностью шага', () => {
    const world = testWorld();
    const registry = makeRegistry([explicitDescriptor('d')]);
    const calls: Call[] = [];
    const result = runMacroStep(world, registry, [recorder('d', calls)], {
      durationS: 10,
      splitting: 'lie',
      processIds: ['d'],
      explicit: { processId: 'd' }
    });
    expect(result.status).toBe('committed');
    expect(calls).toEqual([{ processId: 'd', durationS: 10, intervalStartS: 0 }]);
    expect(result.world.clock.localTimeS).toBe(10);
    expect(result.world.clock.stepCount).toBe(1);
    // τ процесса остался unknown: Scheduler не назначал числового времени.
    expect(registry.get('d')?.tau.status).toBe('unknown');
  });

  it('явный запуск обычного автономного процесса → not_explicit_only (обход τ запрещён)', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a')]);
    const calls: Call[] = [];
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, [recorder('a', calls)], {
          durationS: 10,
          splitting: 'lie',
          processIds: ['a'],
          explicit: { processId: 'a' }
        }),
      'not_explicit_only'
    );
    expect(calls).toEqual([]);
  });

  it('явный запуск запрещает Strang, sub-cycling и несколько процессов шага', () => {
    const world = testWorld();
    const registry = makeRegistry([explicitDescriptor('d'), explicitDescriptor('e')]);
    const ops = [recorder('d', []), recorder('e', [])];
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, ops, {
          durationS: 10,
          splitting: 'strang',
          processIds: ['d', 'e'],
          explicit: { processId: 'd' }
        }),
      'invalid_splitting'
    );
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, ops, {
          durationS: 10,
          splitting: 'lie',
          subCycles: 2,
          processIds: ['d'],
          explicit: { processId: 'd' }
        }),
      'invalid_step'
    );
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, ops, {
          durationS: 10,
          splitting: 'lie',
          processIds: ['d', 'e'],
          explicit: { processId: 'd' }
        }),
      'invalid_step'
    );
    expectSchedulerError(
      () =>
        runMacroStep(world, registry, ops, {
          durationS: 10,
          splitting: 'lie',
          processIds: ['e'],
          explicit: { processId: 'd' }
        }),
      'invalid_step'
    );
  });

  it('отсутствие opts.explicit сохраняет прежнюю семантику автономных шагов (обратная совместимость)', () => {
    const world = testWorld();
    const registry = makeRegistry([descriptor('a'), descriptor('b')]);
    const calls: Call[] = [];
    const result = runMacroStep(world, registry, [recorder('a', calls), recorder('b', calls)], {
      durationS: 10,
      splitting: 'lie'
    });
    expect(result.status).toBe('committed');
    expect(calls.map((c) => c.processId)).toEqual(['a', 'b']);
    expect(result.world.clock.localTimeS).toBe(10);
  });
});

describe('Stage 4.2 Scheduler: state-dependent macro-step selection', () => {
  function stateDependent(id: string): ProcessDescriptor {
    return descriptor(id, {
      tau: unknownValue('характерное время зависит от текущего состояния и вычисляется runtime-решателем'),
      executionMode: 'state_dependent'
    });
  }

  it('solver root в следующем сегменте совпадает с exact process deadline без потери обеих границ', () => {
    const dynamic = descriptor('root_solver', {
      tau: unknownValue('характерное время вычисляет state-dependent solver'),
      executionMode: 'state_dependent'
    });
    const registry = makeRegistry([dynamic, descriptor('scheduled_process')]);
    const largeClock = advance(createSimulationClock(), 1e16);
    const scheduling = scheduleProcessAt(createSchedulerBookkeeping(), 'scheduled_process', {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 3
    });
    const world = { ...testWorld(), clock: largeClock, scheduling };
    const operator: ProcessOperator = {
      processId: 'root_solver',
      proposeStep: () => ({
        durationS: 5,
        method: 'sub-ULP root detection',
        events: [{
          id: 'sub-ulp-phase-root',
          offsetS: 3,
          type: 'phase_transition',
          data: { boundary: 'same as process deadline' }
        }]
      }),
      apply: (state) => state
    };

    const result = runMacroStep(
      world,
      registry,
      [operator],
      { durationS: 5, splitting: 'lie', processIds: ['root_solver'] }
    );

    expect(result.status).toBe('committed');
    expect(result.stepSize?.effectiveDurationS).toBe(3);
    expect(result.stepSize?.eventBoundary).toEqual({
      eventId: 'sub-ulp-phase-root',
      time: { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 3 }
    });
    expect(result.stepSize?.processBoundary).toEqual({
      processIds: ['scheduled_process'],
      time: { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 3 }
    });
    expect(result.world.clock.segmentIndex).toBe(largeClock.segmentIndex + 1);
    expect(result.world.clock.localTimeS).toBe(3);
    expect(result.bookkeeping.eventQueue[0]!.time).toEqual({
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 3
    });
    expect(readyProcessIdsAt(result.bookkeeping, registry, [{
      processId: 'scheduled_process',
      apply: (state) => state
    }], {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 3
    })).toEqual(['scheduled_process']);
  });

  it('state-dependent процесс готов к автоисполнению только при наличии proposeStep()', () => {
    const dynamic = stateDependent('dynamic_chemistry');
    const registry = makeRegistry([dynamic]);
    const due = scheduleProcess(createSchedulerBookkeeping(), dynamic.id, 0);

    expect(readyProcessIds(due, registry, [recorder(dynamic.id, [])], 0)).toEqual([]);

    const operator: ProcessOperator = {
      processId: dynamic.id,
      proposeStep: (_world, maximum) => ({
        durationS: maximum / 2,
        method: 'test state-dependent limiter'
      }),
      apply: (world) => world
    };
    expect(readyProcessIds(due, registry, [operator], 0)).toEqual([dynamic.id]);
    // Постоянное числовое τ не должно подменять state-dependent семантику.
    expect(() =>
      makeRegistry([
        descriptor('invalid_dynamic_tau', {
          executionMode: 'state_dependent',
          tau: knownValue(quantity(10, 's'))
        })
      ])
    ).toThrow(/state_dependent.*числовое τ запрещено/);
  });

  it('выбирает минимум нескольких предложений и продвигает часы на фактический dt', () => {
    const registry = makeRegistry([stateDependent('a_chemistry'), stateDependent('b_chemistry')]);
    const calls: Call[] = [];
    const proposalCalls: string[] = [];
    const operator = (
      processId: string,
      proposedDurationS: number,
      characteristicTimeS: number
    ): ProcessOperator => ({
      processId,
      proposeStep: (snapshot, maximum) => {
        proposalCalls.push(processId + ':' + maximum);
        // Callback получает отдельную копию: мутация не дойдёт до apply()
        // и не изменит снимок, который будет зафиксирован Scheduler.
        if (processId === 'a_chemistry') {
          (snapshot as CoreWorldState).note = 'must not leak from proposal';
        } else {
          expect(snapshot.note).toBeUndefined();
        }
        return {
          durationS: proposedDurationS,
          characteristicTimeS,
          method: 'state-dependent solver bound',
          diagnostics: [processId + ' selected ' + proposedDurationS + ' s']
        };
      },
      apply: (world, durationS, intervalStartS) => {
        expect(world.note).toBeUndefined();
        calls.push({ processId, durationS, intervalStartS });
        return world;
      }
    });

    const world = testWorld();
    const result = runMacroStep(
      world,
      registry,
      [operator('b_chemistry', 2.5, 5), operator('a_chemistry', 6, 12)],
      { durationS: 10, splitting: 'lie' }
    );

    expect(result.status).toBe('committed');
    expect(proposalCalls).toEqual(['a_chemistry:10', 'b_chemistry:10']);
    expect(calls).toEqual([
      { processId: 'a_chemistry', durationS: 2.5, intervalStartS: 0 },
      { processId: 'b_chemistry', durationS: 2.5, intervalStartS: 0 }
    ]);
    expect(result.stepSize).toEqual({
      requestedDurationS: 10,
      effectiveDurationS: 2.5,
      limitingProcessIds: ['b_chemistry'],
      proposals: [
        {
          processId: 'a_chemistry',
          durationS: 6,
          characteristicTimeS: 12,
          method: 'state-dependent solver bound',
          diagnostics: ['a_chemistry selected 6 s']
        },
        {
          processId: 'b_chemistry',
          durationS: 2.5,
          characteristicTimeS: 5,
          method: 'state-dependent solver bound',
          diagnostics: ['b_chemistry selected 2.5 s']
        }
      ],
      diagnostics: ['[a_chemistry] a_chemistry selected 6 s', '[b_chemistry] b_chemistry selected 2.5 s']
    });
    expect(result.world.clock.localTimeS).toBe(2.5);
    expect(result.world.clock.stepCount).toBe(1);
    expect(world.clock.localTimeS).toBe(0);
    expect(result.log.every((entry) => entry.durationS === 2.5)).toBe(true);
    expect(result.diagnostics).toContain('[b_chemistry] b_chemistry selected 2.5 s');
  });

  it('clips to the earliest solver root and atomically queues simultaneous root events', () => {
    const registry = makeRegistry([stateDependent('root_solver')]);
    const payloadA = { transition: { from: 'liquid', to: 'gas' } };
    const payloadB = { threshold: { saturationIndex: 1 } };
    const calls: Call[] = [];
    const operator: ProcessOperator = {
      processId: 'root_solver',
      proposeStep: () => ({
        durationS: 10,
        method: 'root-finding on saturation index',
        events: [
          { id: 'phase-root-b', offsetS: 3, type: 'phase_transition', data: payloadB },
          { id: 'phase-root-a', offsetS: 3, type: 'phase_transition', data: payloadA },
          { id: 'later-root', offsetS: 5, type: 'range_boundary_reached', data: { bound: 100 } }
        ]
      }),
      apply: (world, durationS, intervalStartS) => {
        calls.push({ processId: 'root_solver', durationS, intervalStartS });
        return world;
      }
    };
    const world = testWorld();
    const result = runMacroStep(world, registry, [operator], { durationS: 10, splitting: 'lie' });

    expect(result.status).toBe('committed');
    expect(calls).toEqual([{ processId: 'root_solver', durationS: 3, intervalStartS: 0 }]);
    expect(result.stepSize?.effectiveDurationS).toBe(3);
    expect(result.stepSize?.eventBoundary).toEqual({
      eventId: 'phase-root-a',
      time: { segmentIndex: 0, localTimeS: 3 }
    });
    expect(result.world.clock.localTimeS).toBe(3);
    expect(result.bookkeeping.eventQueue.map((event) => ({
      id: event.id,
      time: event.time,
      status: event.status,
      sequence: event.sequence,
      source: event.source
    }))).toEqual([
      {
        id: 'phase-root-b',
        time: { segmentIndex: 0, localTimeS: 3 },
        status: 'pending',
        sequence: 0,
        source: 'root_solver'
      },
      {
        id: 'phase-root-a',
        time: { segmentIndex: 0, localTimeS: 3 },
        status: 'pending',
        sequence: 1,
        source: 'root_solver'
      }
    ]);
    expect(result.bookkeeping.nextSequence).toBe(2);
    expect(dueEvents(result.bookkeeping, { segmentIndex: 0, localTimeS: 3 }).map((event) => event.id))
      .toEqual(['phase-root-b', 'phase-root-a']);
    expect(validateSchedulerBookkeeping(result.bookkeeping)).toEqual([]);

    payloadA.transition.to = 'mutated-after-proposal';
    payloadB.threshold.saturationIndex = 999;
    expect(result.bookkeeping.eventQueue[0]!.data).toEqual({ threshold: { saturationIndex: 1 } });
    expect(result.bookkeeping.eventQueue[1]!.data).toEqual({ transition: { from: 'liquid', to: 'gas' } });
  });

  it('places a solver root in the next segment when its absolute local point is not representable', () => {
    const registry = makeRegistry([stateDependent('root_solver')]);
    const largeClock = advance(createSimulationClock(), 1e16);
    const world = { ...testWorld(), clock: largeClock };
    const operator: ProcessOperator = {
      processId: 'root_solver',
      proposeStep: () => ({
        durationS: 3,
        method: 'root-finding at sub-ULP absolute time',
        events: [
          { id: 'sub-ulp-root', offsetS: 3, type: 'solver_detected', data: { root: 'exact local offset' } }
        ]
      }),
      apply: (state) => state
    };

    const result = runMacroStep(world, registry, [operator], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('committed');
    expect(result.stepSize?.effectiveDurationS).toBe(3);
    expect(result.stepSize?.eventBoundary).toEqual({
      eventId: 'sub-ulp-root',
      time: { segmentIndex: largeClock.segmentIndex + 1, localTimeS: 3 }
    });
    expect(result.world.clock.segmentIndex).toBe(largeClock.segmentIndex + 1);
    expect(result.world.clock.localTimeS).toBe(3);
    expect(result.bookkeeping.eventQueue[0]!.time).toEqual({
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 3
    });
    expect(dueEvents(result.bookkeeping, {
      segmentIndex: largeClock.segmentIndex + 1,
      localTimeS: 3
    }).map((event) => event.id)).toEqual(['sub-ulp-root']);
    expect(world.clock).toEqual(largeClock);
  });

  it('a pre-existing earlier event wins over a later solver root; the later root is not queued prematurely', () => {
    const registry = makeRegistry([stateDependent('root_solver')]);
    const scheduling = enqueueEvent(createSchedulerBookkeeping(), {
      id: 'already-scheduled-root',
      time: { segmentIndex: 0, localTimeS: 2 },
      type: 'reagent_exhausted',
      data: { speciesId: 'co2' },
      source: 'initial condition'
    });
    const world = { ...testWorld(), scheduling };
    const calls: Call[] = [];
    const operator: ProcessOperator = {
      processId: 'root_solver',
      proposeStep: () => ({
        durationS: 10,
        method: 'root-finding',
        events: [
          { id: 'later-root', offsetS: 3, type: 'phase_transition', data: { phase: 'gas' } }
        ]
      }),
      apply: (state, durationS, intervalStartS) => {
        calls.push({ processId: 'root_solver', durationS, intervalStartS });
        return state;
      }
    };

    const result = runMacroStep(world, registry, [operator], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('committed');
    expect(result.stepSize?.effectiveDurationS).toBe(2);
    expect(result.stepSize?.eventBoundary?.eventId).toBe('already-scheduled-root');
    expect(calls).toEqual([{ processId: 'root_solver', durationS: 2, intervalStartS: 0 }]);
    expect(result.bookkeeping.eventQueue.map((event) => event.id)).toEqual(['already-scheduled-root']);
  });

  it('rejects an invalid solver root before apply and leaves the world/queue untouched', () => {
    const cases = [
      { id: 'too-late', offsetS: 6, type: 'phase_transition', data: {} },
      { id: 'zero-offset', offsetS: 0, type: 'phase_transition', data: {} },
      { id: 'invalid-payload', offsetS: 2, type: 'phase_transition', data: { nested: Number.NaN } }
    ];
    for (const event of cases) {
      const registry = makeRegistry([stateDependent('root_solver')]);
      const world = testWorld();
      const calls: Call[] = [];
      const operator: ProcessOperator = {
        processId: 'root_solver',
        proposeStep: () => ({
          durationS: 5,
          method: 'deliberately invalid root proposal',
          events: [event]
        }),
        apply: (state, durationS, intervalStartS) => {
          calls.push({ processId: 'root_solver', durationS, intervalStartS });
          return state;
        }
      };

      const result = runMacroStep(world, registry, [operator], { durationS: 10, splitting: 'lie' });
      expect(result.status).toBe('rejected');
      expect(result.world).toBe(world);
      expect(result.bookkeeping.stepCount).toBe(0);
      expect(result.bookkeeping.eventQueue).toHaveLength(0);
      expect(calls).toEqual([]);
      expect(result.diagnostics.join(' ')).toContain('solver-предложение');
    }
  });

  it('недопустимое предложение отклоняет macro-шаг до вызова apply()', () => {
    for (const proposedDurationS of [0, Number.NaN, 11]) {
      const world = testWorld();
      const registry = makeRegistry([stateDependent('adaptive')]);
      const calls: Call[] = [];
      const operator: ProcessOperator = {
        processId: 'adaptive',
        proposeStep: () => ({
          durationS: proposedDurationS,
          method: 'deliberately invalid test proposal'
        }),
        apply: (state, durationS, intervalStartS) => {
          calls.push({ processId: 'adaptive', durationS, intervalStartS });
          return state;
        }
      };

      const result = runMacroStep(world, registry, [operator], { durationS: 10, splitting: 'lie' });
      expect(result.status).toBe('rejected');
      expect(result.world).toBe(world);
      expect(result.bookkeeping.stepCount).toBe(0);
      expect(result.diagnostics.join(' ')).toContain('state-dependent solver-предложение');
      expect(calls).toEqual([]);
      expect(world.clock.localTimeS).toBe(0);
    }
  });

  it('ошибка proposeStep() не вызывает оператор и не меняет мир', () => {
    const world = testWorld();
    const registry = makeRegistry([stateDependent('adaptive')]);
    const calls: Call[] = [];
    const operator: ProcessOperator = {
      processId: 'adaptive',
      proposeStep: () => {
        throw new Error('physical timescale unavailable');
      },
      apply: (state, durationS, intervalStartS) => {
        calls.push({ processId: 'adaptive', durationS, intervalStartS });
        return state;
      }
    };

    const result = runMacroStep(world, registry, [operator], { durationS: 10, splitting: 'lie' });
    expect(result.status).toBe('rejected');
    expect(result.world).toBe(world);
    expect(result.diagnostics.join(' ')).toContain('physical timescale unavailable');
    expect(calls).toEqual([]);
    expect(world.clock.localTimeS).toBe(0);
  });
});
