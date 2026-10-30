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
  readyProcessIds,
  runMacroStep,
  scheduleProcess,
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
import { createReservoir, setEnergyInventory, setMaterialInventory } from '../Core/reservoir';
import { createSpeciesCatalog } from '../Core/species';

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
    expect(result.log.every((entry) => entry.status === 'committed' && entry.phase === 'lie')).toBe(true);
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

  it('состояние планировщика JSON-сериализуемо и проходит валидацию после round-trip', () => {
    let bk = createSchedulerBookkeeping();
    bk = enqueueEvent(bk, { id: 'ev-json', time: { segmentIndex: 1, localTimeS: 2.5 }, type: 'phase_transition', data: { pressure: 101325 }, source: 'test' });
    bk = scheduleProcess(bk, 'proc-a', 42.5);
    const restored = JSON.parse(JSON.stringify(bk)) as unknown;
    expect(validateSchedulerBookkeeping(restored)).toEqual([]);
  });
});

describe('Stage 4.2.1 Scheduler: расписания процессов', () => {
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
