// ============================================
// STAGE 4.5.5 (интеграционный срез) - Тесты world adapter
// пользовательского кинетического эксперимента №89/№106
// ============================================
//
// Эксперимент — отдельное опциональное состояние мира
// (GeneratedWorld.kineticExperiment), НЕ часть ChemicalEvolutionState:
// начальные запасы задаются явно, не заимствуются из
// chemicalState.inventory; толщина слоя и N₂ не выводятся из
// параметров атмосферы; физическое время — сумма dtSeconds
// сегментов, игровые часы и gameSpeedCoefficient не участвуют.
//
// ВАЖНО: все численные значения инвентарей ниже — СИНТЕТИЧЕСКИЕ
// тестовые величины, не претендующие на физическую реальность
// какой-либо планеты.

import { describe, it, expect } from 'vitest';
import {
  runWorldKineticTrajectory,
  resetWorldKineticExperiment,
  kineticExperimentStateProblems,
  runKineticCompartmentTrajectory,
  kineticRunHistoryViewModel,
  KineticMechanismError,
  KINETIC_EXPERIMENT_SCHEMA_VERSION
} from '../ChemicalEvolution';
import type {
  GeneratedWorld,
  KineticExperimentState,
  KineticExperimentInventoryMolM2,
  KineticExperimentSegmentAudit,
  KineticExperimentRunRecord
} from '../../types';

// ============================================
// ФИКСТУРЫ (синтетические значения)
// ============================================

const R89 = 'kida-tb-2015-03-19-89';
const R106 = 'kida-tb-2015-03-19-106';

/** Синтетическая толщина слоя, м. */
const THICKNESS_M = 1000;

/** Синтетический явный инвентарь всех семи видов, моль/м². */
const INITIAL_INVENTORY: KineticExperimentInventoryMolM2 = {
  O: 1e-3,
  NO: 1e-3,
  NO2: 1e-3,
  H: 1e-4,
  O2: 1e-1,
  HO2: 0,
  N2: 10
};

/**
 * Минимальный мир: адаптер читает ТОЛЬКО kineticExperiment
 * (и не должен трогать прочие поля), поэтому полная схема
 * GeneratedWorld в unit-тестах не нужна.
 */
function makeWorld(extra: Record<string, unknown> = {}): GeneratedWorld {
  return {
    id: 'w-kinetic',
    seed: 'seed-kinetic',
    ...extra
  } as unknown as GeneratedWorld;
}

function setupInput(inventoryOverrides: Partial<KineticExperimentInventoryMolM2> = {}) {
  return {
    layerThicknessM: THICKNESS_M,
    initialInventoriesMolM2: { ...INITIAL_INVENTORY, ...inventoryOverrides }
  };
}

/** Односегментное расписание: №89 при 250 K, 100 физических секунд. */
const SINGLE_SEGMENT = [{ temperatureK: 250, dtSeconds: 100, reactionIds: [R89] }];

/** Двухсегментное расписание: №89 при 250 K и №106 при 350 K. */
const TWO_SEGMENTS = [
  { temperatureK: 250, dtSeconds: 100, reactionIds: [R89] },
  { temperatureK: 350, dtSeconds: 50, reactionIds: [R106] }
];

/** Минимальное синтетическое chemicalState (для изоляционных тестов). */
function chemicalStateFixture(mode: 'column_inventory' | 'game_normalized'): Record<string, unknown> {
  return {
    mode,
    unitsNote: 'синтетическая тестовая фикстура',
    inventory: { ch4: 60, o2: 40, n2: 20 },
    reservoirs: {
      atmospheric: { ch4: 60, o2: 40, n2: 20 },
      liquidSurface: {},
      subsurfaceLiquid: {},
      solidDeposits: {}
    },
    molarFractions: {},
    surfacePressurePa: null,
    gravityMs2: null,
    meanMolarMassKgMol: null,
    modelTimeYears: 0,
    stepDurationYears: 100,
    history: [],
    oxygenBalance: { production: 0, consumption: 0, net: 0, note: 'тест' },
    notes: []
  };
}

/**
 * Снимок аудита синтетического тестового сегмента: сегменты старой
 * схемы 1.0.0 получают при миграции явный маркер недоступного
 * исторического снимка, численные значения не выдумываются.
 */
function legacySegmentAudit(): KineticExperimentSegmentAudit {
  return {
    kind: 'unavailable_legacy',
    reason: 'синтетический тестовый сегмент: исторический снимок параметров не записывался'
  };
}

/** Валидное состояние эксперимента (один завершённый запуск, 100 с). */
function validExperimentState(): KineticExperimentState {
  return {
    schemaVersion: KINETIC_EXPERIMENT_SCHEMA_VERSION,
    layerThicknessM: THICKNESS_M,
    currentInventoriesMolM2: { ...INITIAL_INVENTORY },
    elapsedSeconds: 100,
    completedRuns: 1,
    history: [
      {
        runIndex: 0,
        startInventoriesMolM2: { ...INITIAL_INVENTORY },
        endInventoriesMolM2: { ...INITIAL_INVENTORY },
        startElapsedSeconds: 0,
        endElapsedSeconds: 100,
        segments: [
          {
            index: 0,
            temperatureK: 250,
            dtSeconds: 100,
            reactionIds: [R89],
            startTimeSeconds: 0,
            endTimeSeconds: 100,
            audit: legacySegmentAudit()
          }
        ],
        warnings: [],
        assumptions: []
      }
    ]
  };
}

// ============================================
// 1. ПЕРВИЧНАЯ НАСТРОЙКА
// ============================================

describe('Stage 4.5.5 world adapter: первичная настройка', () => {
  it('первый запуск без явной настройки отказывает, а не изобретает запасы', () => {
    expect(() => runWorldKineticTrajectory(makeWorld(), { segments: SINGLE_SEGMENT })).toThrow(
      KineticMechanismError
    );
    try {
      runWorldKineticTrajectory(makeWorld(), { segments: SINGLE_SEGMENT });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).code).toBe('invalid_input');
      expect((e as KineticMechanismError).message).toContain('первый запуск требует явной настройки');
      expect((e as KineticMechanismError).message).toContain('не извлекаются из атмосферного состава');
    }
  });

  it('пустое расписание отвергается до всякой настройки', () => {
    expect(() =>
      runWorldKineticTrajectory(makeWorld(), { segments: [], setup: setupInput() })
    ).toThrow(KineticMechanismError);
  });

  it('частичный инвентарь отвергается: пустое поле не превращается в ноль', () => {
    const partial = setupInput();
    delete (partial.initialInventoriesMolM2 as Record<string, unknown>).O;
    try {
      runWorldKineticTrajectory(makeWorld(), { segments: SINGLE_SEGMENT, setup: partial });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).code).toBe('invalid_input');
      // отсутствующий вид назван явно: O не подменён нулём
      expect((e as KineticMechanismError).message).toContain('O');
      expect((e as KineticMechanismError).message).toContain('не задан');
    }
  });

  it('реакционные нули допустимы при явной настройке', () => {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput({ H: 0, HO2: 0, NO2: 0 })
    });
    expect(world.kineticExperiment).toBeDefined();
    expect(world.kineticExperiment?.completedRuns).toBe(1);
    expect(world.kineticExperiment?.currentInventoriesMolM2.H).toBe(0);
    expect(world.kineticExperiment?.currentInventoriesMolM2.HO2).toBe(0);
  });

  it('N2 = 0 отвергается: третье тело механизма обязано быть строго положительным', () => {
    try {
      runWorldKineticTrajectory(makeWorld(), {
        segments: SINGLE_SEGMENT,
        setup: setupInput({ N2: 0 })
      });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).code).toBe('invalid_input');
      expect((e as KineticMechanismError).message).toContain('N2');
      expect((e as KineticMechanismError).message).toContain('строго положительным');
    }
  });

  it('отрицательный запас отвергается', () => {
    try {
      runWorldKineticTrajectory(makeWorld(), {
        segments: SINGLE_SEGMENT,
        setup: setupInput({ NO: -1e-3 })
      });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).code).toBe('invalid_input');
      expect((e as KineticMechanismError).message).toContain('отрицательный запас запрещён');
    }
  });

  it('неконечный запас отвергается', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      try {
        runWorldKineticTrajectory(makeWorld(), {
          segments: SINGLE_SEGMENT,
          setup: setupInput({ H: bad })
        });
        expect.unreachable('должен быть отказ');
      } catch (e) {
        expect((e as KineticMechanismError).code).toBe('invalid_input');
        expect((e as KineticMechanismError).message).toContain('конечное число');
      }
    }
  });

  it('нулевая и отрицательная толщина слоя отвергаются', () => {
    for (const bad of [0, -100, Number.NaN]) {
      try {
        runWorldKineticTrajectory(makeWorld(), {
          segments: SINGLE_SEGMENT,
          setup: { layerThicknessM: bad, initialInventoriesMolM2: { ...INITIAL_INVENTORY } }
        });
        expect.unreachable('должен быть отказ');
      } catch (e) {
        expect((e as KineticMechanismError).code).toBe('invalid_input');
        expect((e as KineticMechanismError).message).toContain('layerThicknessM');
      }
    }
  });
});

// ============================================
// 2. СООТВЕТСТВИЕ ПРЯМОЙ ТРАЕКТОРИИ И НАКОПЛЕНИЕ ВРЕМЕНИ
// ============================================

describe('Stage 4.5.5 world adapter: выполнение и накопление состояния', () => {
  it('односегментный запуск совпадает с прямым runKineticCompartmentTrajectory', () => {
    const direct = runKineticCompartmentTrajectory({
      layerThicknessM: THICKNESS_M,
      initialInventoriesMolM2: { ...INITIAL_INVENTORY },
      segments: SINGLE_SEGMENT
    });
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    const state = world.kineticExperiment!;
    expect(state.completedRuns).toBe(1);
    expect(state.elapsedSeconds).toBe(direct.totalTimeSeconds);
    expect(state.currentInventoriesMolM2.O).toBe(direct.finalInventoriesMolM2['O']);
    expect(state.currentInventoriesMolM2.NO).toBe(direct.finalInventoriesMolM2['NO']);
    expect(state.currentInventoriesMolM2.NO2).toBe(direct.finalInventoriesMolM2['NO2']);
    expect(state.currentInventoriesMolM2.H).toBe(direct.finalInventoriesMolM2['H']);
    expect(state.currentInventoriesMolM2.O2).toBe(direct.finalInventoriesMolM2['O2']);
    expect(state.currentInventoriesMolM2.HO2).toBe(direct.finalInventoriesMolM2['HO2']);
    expect(state.currentInventoriesMolM2.N2).toBe(direct.finalInventoriesMolM2['N2']);
    const record = state.history[0];
    expect(record.startElapsedSeconds).toBe(0);
    expect(record.endElapsedSeconds).toBe(direct.totalTimeSeconds);
    expect(record.warnings).toEqual(direct.warnings);
    expect(record.assumptions).toEqual(direct.assumptions);
  });

  it('многосегментный запуск сохраняет точное последовательное состояние', () => {
    const direct = runKineticCompartmentTrajectory({
      layerThicknessM: THICKNESS_M,
      initialInventoriesMolM2: { ...INITIAL_INVENTORY },
      segments: TWO_SEGMENTS
    });
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: TWO_SEGMENTS,
      setup: setupInput()
    });
    const state = world.kineticExperiment!;
    expect(state.elapsedSeconds).toBe(direct.totalTimeSeconds);
    expect(state.currentInventoriesMolM2.NO2).toBe(direct.finalInventoriesMolM2['NO2']);
    expect(state.currentInventoriesMolM2.HO2).toBe(direct.finalInventoriesMolM2['HO2']);
    const record = state.history[0];
    expect(record.segments.length).toBe(2);
    // точное расписание с проверенными границами времени
    expect(record.segments[0].startTimeSeconds).toBe(0);
    expect(record.segments[0].endTimeSeconds).toBe(100);
    expect(record.segments[1].startTimeSeconds).toBe(100);
    expect(record.segments[1].endTimeSeconds).toBe(150);
    expect(record.segments[0].temperatureK).toBe(250);
    expect(record.segments[1].temperatureK).toBe(350);
    expect(record.segments[0].reactionIds).toEqual([R89]);
    expect(record.segments[1].reactionIds).toEqual([R106]);
  });

  it('повторный запуск начинается с точного конечного инвентаря предыдущего', () => {
    const first = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    const second = runWorldKineticTrajectory(first, { segments: SINGLE_SEGMENT });
    const state1 = first.kineticExperiment!;
    const state2 = second.kineticExperiment!;
    expect(state2.completedRuns).toBe(2);
    expect(state2.history.length).toBe(2);
    // запись второго запуска начинается ровно с инвентаря первого
    expect(state2.history[1].startInventoriesMolM2).toEqual(state1.currentInventoriesMolM2);
    expect(state2.history[1].runIndex).toBe(1);
    // и совпадает с прямой траекторией от того же начального состояния
    const direct = runKineticCompartmentTrajectory({
      layerThicknessM: THICKNESS_M,
      initialInventoriesMolM2: { ...state1.currentInventoriesMolM2 },
      segments: SINGLE_SEGMENT
    });
    expect(state2.currentInventoriesMolM2.NO2).toBe(direct.finalInventoriesMolM2['NO2']);
    expect(state2.currentInventoriesMolM2.O).toBe(direct.finalInventoriesMolM2['O']);
  });

  it('elapsedSeconds накапливается в физических секундах', () => {
    const first = runWorldKineticTrajectory(makeWorld(), {
      segments: TWO_SEGMENTS,
      setup: setupInput()
    });
    expect(first.kineticExperiment!.elapsedSeconds).toBe(150);
    expect(first.kineticExperiment!.history[0].startElapsedSeconds).toBe(0);
    expect(first.kineticExperiment!.history[0].endElapsedSeconds).toBe(150);
    const second = runWorldKineticTrajectory(first, { segments: SINGLE_SEGMENT });
    expect(second.kineticExperiment!.elapsedSeconds).toBe(250);
    expect(second.kineticExperiment!.history[1].startElapsedSeconds).toBe(150);
    expect(second.kineticExperiment!.history[1].endElapsedSeconds).toBe(250);
  });

  it('переполнение накопленного времени отвергает весь запуск до выполнения сегментов', () => {
    const overflowState = validExperimentState();
    overflowState.elapsedSeconds = Number.MAX_VALUE;
    overflowState.history[0].endElapsedSeconds = Number.MAX_VALUE;
    overflowState.history[0].segments[0].dtSeconds = Number.MAX_VALUE;
    overflowState.history[0].segments[0].endTimeSeconds = Number.MAX_VALUE;
    expect(kineticExperimentStateProblems(overflowState)).toEqual([]);
    const world = makeWorld({ kineticExperiment: overflowState });
    try {
      runWorldKineticTrajectory(world, {
        segments: [{ temperatureK: 250, dtSeconds: Number.MAX_VALUE, reactionIds: [R89] }]
      });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).code).toBe('invalid_input');
      expect((e as KineticMechanismError).message).toContain('переполняет');
    }
    // исходный мир и его состояние не изменены
    expect(world.kineticExperiment).toBe(overflowState);
    expect(world.kineticExperiment?.history.length).toBe(1);
  });

  it('ошибка температуры не добавляет запись истории и не меняет исходный мир', () => {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    const before = JSON.parse(JSON.stringify(world.kineticExperiment));
    try {
      // 100 K вне диапазона обеих реакций механизма (200–400 K)
      runWorldKineticTrajectory(world, {
        segments: [{ temperatureK: 100, dtSeconds: 100, reactionIds: [R89] }]
      });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).code).toBe('temperature_out_of_range');
    }
    // мир не мутирован: та же ссылка, то же состояние, история не выросла
    expect(world.kineticExperiment?.history.length).toBe(1);
    expect(world.kineticExperiment).toEqual(before);
  });

  it('N2 остаётся неизменным: механизм №89/№106 не расходует третье тело', () => {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: TWO_SEGMENTS,
      setup: setupInput()
    });
    const state = world.kineticExperiment!;
    expect(state.currentInventoriesMolM2.N2).toBe(INITIAL_INVENTORY.N2);
    expect(state.history[0].endInventoriesMolM2.N2).toBe(INITIAL_INVENTORY.N2);
    expect(state.history[0].startInventoriesMolM2.N2).toBe(INITIAL_INVENTORY.N2);
  });
});

// ============================================
// 3. СБРОС И КОНТРАКТ ПРОДОЛЖЕНИЯ
// ============================================

describe('Stage 4.5.5 world adapter: сброс и контракт продолжения', () => {
  it('продолжение уже настроенного эксперимента не принимает новые начальные запасы', () => {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    try {
      runWorldKineticTrajectory(world, { segments: SINGLE_SEGMENT, setup: setupInput() });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).code).toBe('invalid_input');
      expect((e as KineticMechanismError).message).toContain('уже настроен');
      expect((e as KineticMechanismError).message).toContain('явный сброс');
    }
  });

  it('сброс требует отдельного явного вызова и возвращает мир без поля', () => {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    expect(world.kineticExperiment).toBeDefined();
    const reset = resetWorldKineticExperiment(world);
    expect(reset.kineticExperiment).toBeUndefined();
    // исходный мир не мутирован: эксперимент остаётся у него
    expect(world.kineticExperiment).toBeDefined();
    // после сброса следующий запуск снова требует явную настройку
    try {
      runWorldKineticTrajectory(reset, { segments: SINGLE_SEGMENT });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).message).toContain('первый запуск требует явной настройки');
    }
  });

  it('сброс не настроенного эксперимента идемпотентен', () => {
    const world = makeWorld({ customMarker: 'keep-me' });
    const reset = resetWorldKineticExperiment(world);
    expect(reset.kineticExperiment).toBeUndefined();
    // явное двойное приведение: GeneratedWorld (interface) не имеет
    // индексной сигнатуры, прямое сведение к Record не компилируется
    expect((reset as unknown as Record<string, unknown>)['customMarker']).toBe('keep-me');
  });

  it('сброс повреждённого состояния работает как явное действие пользователя', () => {
    const broken = validExperimentState();
    broken.currentInventoriesMolM2.N2 = 0;
    expect(kineticExperimentStateProblems(broken).length).toBeGreaterThan(0);
    const world = makeWorld({ kineticExperiment: broken });
    // запуск на повреждённом состоянии отклоняется...
    expect(() => runWorldKineticTrajectory(world, { segments: SINGLE_SEGMENT })).toThrow(
      KineticMechanismError
    );
    // ...а явный сброс возвращает мир без поля
    const reset = resetWorldKineticExperiment(world);
    expect(reset.kineticExperiment).toBeUndefined();
    expect(world.kineticExperiment).toBe(broken);
  });
});

// ============================================
// 4. ИЗОЛЯЦИЯ ОТ ChemicalEvolutionState
// ============================================

describe('Stage 4.5.5 world adapter: изоляция от химического состояния', () => {
  it('начальные запасы не заимствуются из chemicalState.inventory', () => {
    const world = makeWorld({ chemicalState: chemicalStateFixture('column_inventory') });
    // без явной настройки адаптер не берёт inventory мира молча
    try {
      runWorldKineticTrajectory(world, { segments: SINGLE_SEGMENT });
      expect.unreachable('должен быть отказ');
    } catch (e) {
      expect((e as KineticMechanismError).message).toContain('первый запуск требует явной настройки');
    }
    // с явной настройкой запасы равны именно явным значениям
    const result = runWorldKineticTrajectory(world, {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    expect(result.kineticExperiment?.history[0].startInventoriesMolM2).toEqual(INITIAL_INVENTORY);
    // chemicalState передан по ссылке без изменений
    expect(result.chemicalState).toBe(world.chemicalState);
  });

  it('режимы chemicalState не меняют семантику эксперимента', () => {
    const a = runWorldKineticTrajectory(
      makeWorld({ chemicalState: chemicalStateFixture('column_inventory') }),
      { segments: TWO_SEGMENTS, setup: setupInput() }
    );
    const b = runWorldKineticTrajectory(
      makeWorld({ chemicalState: chemicalStateFixture('game_normalized') }),
      { segments: TWO_SEGMENTS, setup: setupInput() }
    );
    expect(a.kineticExperiment).toEqual(b.kineticExperiment);
  });

  it('кинетический запуск не изменяет chemicalState', () => {
    const world = makeWorld({ chemicalState: chemicalStateFixture('column_inventory') });
    const snapshot = JSON.parse(JSON.stringify(world.chemicalState));
    const result = runWorldKineticTrajectory(world, {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    expect(result.chemicalState).toEqual(snapshot);
    expect(world.chemicalState).toEqual(snapshot);
  });

  it('стехиометрический и кинетический инвентари не смешиваются', () => {
    const world = runWorldKineticTrajectory(
      makeWorld({ chemicalState: chemicalStateFixture('column_inventory') }),
      { segments: TWO_SEGMENTS, setup: setupInput() }
    );
    const state = world.kineticExperiment!;
    // инвентарь эксперимента содержит ровно семь видов механизма
    expect(Object.keys(state.currentInventoriesMolM2).sort()).toEqual(
      ['H', 'HO2', 'N2', 'NO', 'NO2', 'O', 'O2']
    );
    // стехиометрический инвентарь chemicalState не получил ключей механизма
    const chemInventory = (world.chemicalState as { inventory: Record<string, number> }).inventory;
    for (const key of ['O', 'NO', 'NO2', 'H', 'HO2']) {
      expect(chemInventory[key]).toBeUndefined();
    }
  });
});

// ============================================
// 5. ВАЛИДАТОР СОСТОЯНИЯ
// ============================================

describe('Stage 4.5.5 world adapter: валидатор состояния эксперимента', () => {
  it('отсутствие поля — валидно (эксперимент не настроен)', () => {
    expect(kineticExperimentStateProblems(undefined)).toEqual([]);
  });

  it('null — некорректная форма, а не отсутствие', () => {
    const problems = kineticExperimentStateProblems(null);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('null');
  });

  it('валидное состояние проходит без проблем', () => {
    expect(kineticExperimentStateProblems(validExperimentState())).toEqual([]);
  });

  it('N2 = 0 в сохранённом состоянии диагностируется', () => {
    const broken = validExperimentState();
    broken.currentInventoriesMolM2.N2 = 0;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('N2') || p.includes('N₂'))).toBe(true);
  });

  it('нарушенная цепочка времени истории диагностируется', () => {
    const broken = validExperimentState();
    broken.history[0].endElapsedSeconds = 50;
    broken.elapsedSeconds = 50;
    const problems = kineticExperimentStateProblems(broken);
    // сегмент утверждает конец 100 с, запись запуска — 50 с
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('цепочка'))).toBe(true);
  });

  it('рассинхрон completedRuns и длины истории диагностируется', () => {
    const broken = validExperimentState();
    broken.completedRuns = 2;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('completedRuns'))).toBe(true);
  });

  it('чужая версия схемы состояния не «чинится» и диагностируется', () => {
    const broken = validExperimentState();
    broken.schemaVersion = '0.9.9';
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('schemaVersion'))).toBe(true);
  });
});

// ============================================
// 6. СТРОГИЕ ИНВАРИАНТЫ ЦЕЛОСТНОСТИ (пакетное усиление валидатора)
// ============================================

describe('Stage 4.5.5 world adapter: строгие инварианты целостности состояния', () => {
  /**
   * Валидное начальное состояние: пустая история, нулевое накопленное
   * время, явно заданный первоначальный инвентарь (синтетические
   * тестовые величины).
   */
  function freshExperimentState(): KineticExperimentState {
    return {
      schemaVersion: KINETIC_EXPERIMENT_SCHEMA_VERSION,
      layerThicknessM: THICKNESS_M,
      currentInventoriesMolM2: { ...INITIAL_INVENTORY },
      elapsedSeconds: 0,
      completedRuns: 0,
      history: []
    };
  }

  it('валидное начальное состояние с нулевым временем и пустой историей принимается', () => {
    expect(kineticExperimentStateProblems(freshExperimentState())).toEqual([]);
  });

  it('пустая история с положительным elapsedSeconds отклоняется', () => {
    const broken = freshExperimentState();
    broken.elapsedSeconds = 50;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('пустой истории'))).toBe(true);
  });

  it('пустая история с ненулевым completedRuns отклоняется', () => {
    const broken = freshExperimentState();
    broken.completedRuns = 1;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('completedRuns'))).toBe(true);
  });

  it('dtSeconds = 100 при интервале сегмента 50 с отклоняется', () => {
    const broken = validExperimentState();
    broken.history[0].segments[0].endTimeSeconds = 50;
    broken.history[0].endElapsedSeconds = 50;
    broken.elapsedSeconds = 50;
    const problems = kineticExperimentStateProblems(broken);
    // конец сегмента обязан в точности равняться 0 + 100
    expect(problems.some((p) => p.includes('в точности равняться началу плюс длительности'))).toBe(true);
    expect(problems.some((p) => p.includes('100'))).toBe(true);
  });

  it('конец сегмента не совпадает с суммой начала и длительности: отклоняется', () => {
    const broken = validExperimentState();
    broken.history[0].segments.push({
      index: 1,
      temperatureK: 350,
      dtSeconds: 50,
      reactionIds: [R106],
      startTimeSeconds: 100,
      endTimeSeconds: 200
    });
    broken.history[0].endElapsedSeconds = 200;
    broken.elapsedSeconds = 200;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('segments[1].endTimeSeconds'))).toBe(true);
    expect(problems.some((p) => p.includes('в точности равняться началу плюс длительности'))).toBe(true);
  });

  it('индекс сегмента обязан соответствовать позиции в расписании', () => {
    const broken = validExperimentState();
    broken.history[0].segments[0].index = 7;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('segments[0].index'))).toBe(true);
  });

  it('пустой список сегментов успешного запуска отклоняется', () => {
    const broken = validExperimentState();
    broken.history[0].segments = [];
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('пустого массива сегментов'))).toBe(true);
  });

  it('переполнение накопления времени сегментов обнаруживается', () => {
    const broken = validExperimentState();
    // сегмент 0 корректен: 0 + MAX_VALUE = MAX_VALUE (конечно);
    // сегмент 1: MAX_VALUE + MAX_VALUE переполняет Number
    broken.history[0].segments[0].dtSeconds = Number.MAX_VALUE;
    broken.history[0].segments[0].endTimeSeconds = Number.MAX_VALUE;
    broken.history[0].segments.push({
      index: 1,
      temperatureK: 350,
      dtSeconds: Number.MAX_VALUE,
      reactionIds: [R106],
      startTimeSeconds: Number.MAX_VALUE,
      endTimeSeconds: Number.MAX_VALUE
    });
    broken.history[0].endElapsedSeconds = Number.MAX_VALUE;
    broken.elapsedSeconds = Number.MAX_VALUE;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('переполняет Number'))).toBe(true);
  });

  it('начальный инвентарь второго запуска обязан совпадать с конечным инвентарём первого', () => {
    const first = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    const second = runWorldKineticTrajectory(first, { segments: SINGLE_SEGMENT });
    // глубокая копия: повреждение НЕ должно просачиваться через общие ссылки
    const state2 = JSON.parse(JSON.stringify(second.kineticExperiment)) as KineticExperimentState;
    // до повреждения состояние строго валидно
    expect(kineticExperimentStateProblems(state2)).toEqual([]);
    state2.history[1].startInventoriesMolM2.O = 999;
    const problems = kineticExperimentStateProblems(state2);
    expect(problems.some((p) => p.includes('history[1].startInventoriesMolM2.O'))).toBe(true);
    expect(problems.some((p) => p.includes('конечным запасом предыдущего запуска'))).toBe(true);
  });

  it('текущий инвентарь обязан совпадать с конечным инвентарём последнего запуска', () => {
    const broken = validExperimentState();
    broken.currentInventoriesMolM2.H = 5;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('currentInventoriesMolM2.H'))).toBe(true);
    expect(problems.some((p) => p.includes('последнего завершённого запуска'))).toBe(true);
  });

  it('корректная многосегментная история и корректное продолжение принимаются', () => {
    const first = runWorldKineticTrajectory(makeWorld(), {
      segments: TWO_SEGMENTS,
      setup: setupInput()
    });
    expect(kineticExperimentStateProblems(first.kineticExperiment)).toEqual([]);
    const second = runWorldKineticTrajectory(first, { segments: TWO_SEGMENTS });
    const state2 = second.kineticExperiment!;
    expect(kineticExperimentStateProblems(state2)).toEqual([]);
    expect(state2.history.length).toBe(2);
    expect(state2.history[1].startElapsedSeconds).toBe(150);
    expect(state2.elapsedSeconds).toBe(300);
  });

  it('продолжение из валидного состояния с пустой историей выполняется и даёт строго валидное состояние', () => {
    const world = makeWorld({ kineticExperiment: freshExperimentState() });
    const after = runWorldKineticTrajectory(world, { segments: SINGLE_SEGMENT });
    const state = after.kineticExperiment!;
    expect(state.completedRuns).toBe(1);
    expect(state.elapsedSeconds).toBe(100);
    expect(state.history[0].startElapsedSeconds).toBe(0);
    expect(kineticExperimentStateProblems(state)).toEqual([]);
  });
});

// ============================================
// 7. СНИМКИ КИНЕТИЧЕСКОЙ ТРАССИРУЕМОСТИ СЕГМЕНТОВ
// ============================================

describe('Stage 4.5.5 world adapter: снимки кинетической трассируемости сегментов', () => {
  /** Прямой прогон вычислителя с теми же входами (эталон фактического результата). */
  function directRun(segments: readonly { temperatureK: number; dtSeconds: number; reactionIds: string[] }[]) {
    return runKineticCompartmentTrajectory({
      layerThicknessM: THICKNESS_M,
      initialInventoriesMolM2: { ...INITIAL_INVENTORY },
      segments
    });
  }

  /** Реальное состояние с recorded-снимками (один запуск №89, 250 K), глубоко отсоединённое. */
  function recordedState(): KineticExperimentState {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    return JSON.parse(JSON.stringify(world.kineticExperiment)) as KineticExperimentState;
  }

  it('снимок №89 в точности совпадает с фактическим результатом вычислителя', () => {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    const audit = world.kineticExperiment!.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    const step = directRun(SINGLE_SEGMENT).segments[0].compartment.concentrationStep;
    const applied = step.reactions[0];
    expect(audit.reactions.length).toBe(1);
    const snapshot = audit.reactions[0];
    expect(snapshot.reactionId).toBe(applied.reactionId);
    expect(snapshot.label).toBe(applied.label);
    expect(snapshot.dataStatus).toBe(applied.dataStatus);
    // точное равенство фактически вычисленной константы и её единицы,
    // без преобразования и подмены
    expect(snapshot.rateConstant.value).toBe(applied.rateConstant.value);
    expect(snapshot.rateConstant.unit).toBe(applied.rateConstant.unit);
    expect(snapshot.rateConstant.unit).toBe('cm3_per_molecule_per_s');
    expect(snapshot.appliedRangeK).toEqual(applied.appliedRangeK);
    expect(snapshot.provenance).toEqual(applied.provenance);
    expect(snapshot.parameterProvenance).toEqual(applied.parameterProvenance);
    expect(snapshot.fallOff).toEqual(applied.fallOff);
    expect(audit.concentrationModel).toBe('molecule_cm3');
    // фактическая концентрация N₂ из того же результата, без пересчёта
    expect(audit.thirdBodyN2MoleculeCm3).toBe(step.thirdBodyN2MoleculeCm3);
    // состояние с фактическими снимками строго валидно
    expect(kineticExperimentStateProblems(world.kineticExperiment)).toEqual([]);
  });

  it('снимок №106 в точности совпадает с фактическим результатом вычислителя', () => {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: TWO_SEGMENTS,
      setup: setupInput()
    });
    const audit = world.kineticExperiment!.history[0].segments[1].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    const step = directRun(TWO_SEGMENTS).segments[1].compartment.concentrationStep;
    const applied = step.reactions[0];
    expect(applied.reactionId).toBe(R106);
    const snapshot = audit.reactions[0];
    expect(snapshot.reactionId).toBe(R106);
    expect(snapshot.rateConstant.value).toBe(applied.rateConstant.value);
    expect(snapshot.rateConstant.unit).toBe(applied.rateConstant.unit);
    // фактическая единица механизма №106 подтверждается явно
    expect(snapshot.rateConstant.unit).toBe('cm3_per_molecule_per_s');
    expect(snapshot.fallOff).toEqual(applied.fallOff);
    expect(snapshot.provenance).toEqual(applied.provenance);
    expect(audit.thirdBodyN2MoleculeCm3).toBe(step.thirdBodyN2MoleculeCm3);
    expect(kineticExperimentStateProblems(world.kineticExperiment)).toEqual([]);
  });

  it('совместный сегмент №89+№106 при 300 K сохраняет оба снимка в порядке расписания', () => {
    const schedule = [{ temperatureK: 300, dtSeconds: 100, reactionIds: [R89, R106] }];
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: schedule,
      setup: setupInput()
    });
    const audit = world.kineticExperiment!.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    expect(audit.reactions.map((r) => r.reactionId)).toEqual([R89, R106]);
    const step = directRun(schedule).segments[0].compartment.concentrationStep;
    expect(audit.reactions[0].rateConstant.value).toBe(step.reactions[0].rateConstant.value);
    expect(audit.reactions[1].rateConstant.value).toBe(step.reactions[1].rateConstant.value);
    // обе фактические единицы совместного сегмента подтверждаются явно
    expect(audit.reactions[0].rateConstant.unit).toBe('cm3_per_molecule_per_s');
    expect(audit.reactions[1].rateConstant.unit).toBe('cm3_per_molecule_per_s');
    // оба диапазона фактически применённой применимости включают 300 K
    expect(audit.reactions[0].appliedRangeK).toEqual(step.reactions[0].appliedRangeK);
    expect(audit.reactions[1].appliedRangeK).toEqual(step.reactions[1].appliedRangeK);
    expect(audit.thirdBodyN2MoleculeCm3).toBe(step.thirdBodyN2MoleculeCm3);
    expect(kineticExperimentStateProblems(world.kineticExperiment)).toEqual([]);
  });

  it('отказ траектории не сохраняет ни мир, ни частичный снимок', () => {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    const before = JSON.parse(JSON.stringify(world));
    // 500 K вне диапазона №89: отказ до публикации нового состояния
    expect(() =>
      runWorldKineticTrajectory(world, {
        segments: [{ temperatureK: 500, dtSeconds: 50, reactionIds: [R89] }]
      })
    ).toThrow(KineticMechanismError);
    expect(JSON.parse(JSON.stringify(world))).toEqual(before);
    // ошибка во втором сегменте многосегментной траектории: частично
    // выполненные сегменты и частичные снимки не сохраняются
    expect(() =>
      runWorldKineticTrajectory(world, {
        segments: [
          { temperatureK: 250, dtSeconds: 100, reactionIds: [R89] },
          { temperatureK: 500, dtSeconds: 50, reactionIds: [R89] }
        ]
      })
    ).toThrow(KineticMechanismError);
    expect(JSON.parse(JSON.stringify(world))).toEqual(before);
    expect(kineticExperimentStateProblems(world.kineticExperiment)).toEqual([]);
  });

  it('отсутствие снимка у сегмента схемы 1.1.0 отклоняется', () => {
    const broken = recordedState();
    delete broken.history[0].segments[0].audit;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('.audit'))).toBe(true);
    expect(problems.some((p) => p.includes('снимок кинетической трассируемости обязателен'))).toBe(true);
  });

  it('несогласованность записей аудита с расписанием отклоняется', () => {
    const broken = recordedState();
    const segment = broken.history[0].segments[0];
    (segment.audit as { reactions: unknown }).reactions = [];
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('непустой массив аудиозаписей'))).toBe(true);
  });

  it('порядок и идентификаторы аудита обязаны точно соответствовать расписанию', () => {
    const schedule = [{ temperatureK: 300, dtSeconds: 100, reactionIds: [R89, R106] }];
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: schedule,
      setup: setupInput()
    });
    const broken = JSON.parse(JSON.stringify(world.kineticExperiment)) as KineticExperimentState;
    const audit = broken.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    // перестановка записей аудита: идентификаторы больше не совпадают
    // с расписанием по позициям
    audit.reactions.reverse();
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('не совпадает с расписанием сегмента'))).toBe(true);
  });

  it('дубликаты реакций в расписании сегмента отклоняются', () => {
    const broken = recordedState();
    const segment = broken.history[0].segments[0];
    segment.reactionIds = [R89, R89];
    const audit = segment.audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    audit.reactions = [audit.reactions[0], { ...audit.reactions[0] }];
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('дубликаты реакций в расписании сегмента запрещены'))).toBe(true);
  });

  it('неконечная константа в снимке отклоняется', () => {
    const broken = recordedState();
    const audit = broken.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    audit.reactions[0].rateConstant.value = Infinity;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('конечная положительная фактически вычисленная константа'))).toBe(true);
  });

  it('диапазон снимка обязан включать температуру сегмента', () => {
    const broken = recordedState();
    const audit = broken.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    audit.reactions[0].appliedRangeK = { min: 400, max: 500 };
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('вне диапазона фактически применённой применимости'))).toBe(true);
  });

  it('provenance снимка обязан идентифицировать источник', () => {
    const broken = recordedState();
    const audit = broken.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    (audit.reactions[0].provenance as unknown) = {};
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('не идентифицирует источник'))).toBe(true);
  });

  it('снимок unavailable_legacy не может содержать выдуманные численные результаты', () => {
    const broken = recordedState();
    const segment = broken.history[0].segments[0];
    (segment.audit as unknown) = {
      kind: 'unavailable_legacy',
      reason: 'тестовая причина',
      reactions: [{ reactionId: R89 }],
      thirdBodyN2MoleculeCm3: 1e19,
      concentrationModel: 'molecule_cm3'
    };
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('не может содержать численные результаты'))).toBe(true);
  });

  it('снимок unavailable_legacy требует явную непустую причину', () => {
    const broken = recordedState();
    (broken.history[0].segments[0].audit as unknown) = { kind: 'unavailable_legacy', reason: '' };
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('непустая причина отсутствия исторического снимка'))).toBe(true);
  });

  it('неизвестный kind снимка отклоняется', () => {
    const broken = recordedState();
    (broken.history[0].segments[0].audit as unknown) = { kind: 'other' };
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('recorded | unavailable_legacy'))).toBe(true);
  });
});

// ============================================
// 8. СТРОГАЯ ФОРМА И СОГЛАСОВАННОСТЬ СНИМКОВ АУДИТА
// ============================================

describe('Stage 4.5.5 world adapter: строгая форма unavailable_legacy', () => {
  /** Реальное состояние с recorded-снимками (один запуск №89, 250 K), глубоко отсоединённое. */
  function recordedState(): KineticExperimentState {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    return JSON.parse(JSON.stringify(world.kineticExperiment)) as KineticExperimentState;
  }

  it('каждое постороннее поле unavailable_legacy отклоняется', () => {
    const forbiddenKeys = [
      'reactions',
      'rateConstant',
      'provenance',
      'parameterProvenance',
      'fallOff',
      'thirdBodyN2MoleculeCm3',
      'concentrationModel',
      'integration'
    ] as const;
    for (const key of forbiddenKeys) {
      const broken = recordedState();
      (broken.history[0].segments[0].audit as unknown) = {
        kind: 'unavailable_legacy',
        reason: 'тестовая причина',
        [key]: key === 'reactions' ? [] : key === 'fallOff' ? { reducedPressure: 1 } : 1
      };
      const problems = kineticExperimentStateProblems(broken);
      // посторонний ключ назван точно и отклонён строгой формой
      expect(problems.some((p) => p.includes('.audit.' + key + ':'))).toBe(true);
      expect(problems.some((p) => p.includes('кроме kind и reason'))).toBe(true);
    }
  });

  it('произвольный неизвестный дополнительный ключ unavailable_legacy отклоняется', () => {
    const broken = recordedState();
    (broken.history[0].segments[0].audit as unknown) = {
      kind: 'unavailable_legacy',
      reason: 'тестовая причина',
      customNote: 'неизвестное содержимое'
    };
    const problems = kineticExperimentStateProblems(broken);
    // неизвестное содержимое не отбрасывается и не нормализуется, а диагностируется
    expect(problems.some((p) => p.includes('.audit.customNote:'))).toBe(true);
    expect(problems.some((p) => p.includes('постороннее содержимое не отбрасывается и не нормализуется'))).toBe(true);
  });

  it('чистый объект kind + непустой reason принимается', () => {
    const state = recordedState();
    (state.history[0].segments[0].audit as unknown) = {
      kind: 'unavailable_legacy',
      reason: 'сегмент выполнен до введения снимков аудита (схема состояния 1.0.0)'
    };
    expect(kineticExperimentStateProblems(state)).toEqual([]);
  });

  it('JSON round-trip чистого legacy-маркера остаётся валидным', () => {
    const state = recordedState();
    (state.history[0].segments[0].audit as unknown) = {
      kind: 'unavailable_legacy',
      reason: 'сегмент выполнен до введения снимков аудита (схема состояния 1.0.0)'
    };
    const restored = JSON.parse(JSON.stringify(state)) as KineticExperimentState;
    expect(restored.history[0].segments[0].audit).toEqual({
      kind: 'unavailable_legacy',
      reason: 'сегмент выполнен до введения снимков аудита (схема состояния 1.0.0)'
    });
    expect(kineticExperimentStateProblems(restored)).toEqual([]);
  });
});

describe('Stage 4.5.5 world adapter: строгая размерность единицы константы', () => {
  /** Реальное состояние с recorded-снимками (один запуск №89, 250 K), глубоко отсоединённое. */
  function recordedState(): KineticExperimentState {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    return JSON.parse(JSON.stringify(world.kineticExperiment)) as KineticExperimentState;
  }

  it('зарегистрированные, но физически несовместимые единицы отклоняются', () => {
    const incompatibleUnits = ['m3_per_mol_per_s', 'cm6_per_molecule2_per_s', 'per_s'] as const;
    for (const unit of incompatibleUnits) {
      const broken = recordedState();
      const audit = broken.history[0].segments[0].audit;
      if (audit === undefined || audit.kind !== 'recorded') {
        throw new Error('ожидался recorded-снимок сегмента');
      }
      audit.reactions[0].rateConstant.unit = unit;
      const problems = kineticExperimentStateProblems(broken);
      // единица из общего реестра недостаточна: она обязана
      // соответствовать механизму №89/№106 и модели molecule_cm3
      expect(problems.some((p) => p.includes('обязана быть cm3_per_molecule_per_s'))).toBe(true);
      expect(problems.some((p) => p.includes('несовместимая с этим механизмом размерность'))).toBe(true);
    }
  });

  it('неизвестная строка единицы отклоняется и реестром, и механизмом', () => {
    const broken = recordedState();
    const audit = broken.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    audit.reactions[0].rateConstant.unit = 'parsec_per_kg_per_s';
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('единица должна быть из кинетического реестра'))).toBe(true);
    expect(problems.some((p) => p.includes('обязана быть cm3_per_molecule_per_s'))).toBe(true);
  });

  it('фактическая единица реальных снимков №89/№106 равна cm3_per_molecule_per_s', () => {
    const world89 = runWorldKineticTrajectory(makeWorld(), { segments: SINGLE_SEGMENT, setup: setupInput() });
    const worldBoth = runWorldKineticTrajectory(makeWorld(), {
      segments: [{ temperatureK: 300, dtSeconds: 100, reactionIds: [R89, R106] }],
      setup: setupInput()
    });
    const audit89 = world89.kineticExperiment!.history[0].segments[0].audit;
    if (audit89 === undefined || audit89.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    expect(audit89.reactions[0].rateConstant.unit).toBe('cm3_per_molecule_per_s');
    const auditBoth = worldBoth.kineticExperiment!.history[0].segments[0].audit;
    if (auditBoth === undefined || auditBoth.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    expect(auditBoth.reactions.map((r) => r.rateConstant.unit)).toEqual([
      'cm3_per_molecule_per_s',
      'cm3_per_molecule_per_s'
    ]);
  });
});

describe('Stage 4.5.5 world adapter: внутренняя согласованность fall-off', () => {
  /** Реальное состояние с recorded-снимками (один запуск №89, 250 K), глубоко отсоединённое. */
  function recordedState(): KineticExperimentState {
    const world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    return JSON.parse(JSON.stringify(world.kineticExperiment)) as KineticExperimentState;
  }

  it('нулевое приведённое давление отклоняется', () => {
    const broken = recordedState();
    const audit = broken.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    audit.reactions[0].fallOff.reducedPressure = 0;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('конечное строго положительное приведённое давление'))).toBe(true);
  });

  it('отрицательное приведённое давление отклоняется', () => {
    const broken = recordedState();
    const audit = broken.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    audit.reactions[0].fallOff.reducedPressure = -1.5;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('конечное строго положительное приведённое давление'))).toBe(true);
  });

  it('несогласованный log10ReducedPressure отклоняется', () => {
    const broken = recordedState();
    const audit = broken.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    // рассинхрон логарифма с фактической операцией Math.log10(Pr)
    audit.reactions[0].fallOff.log10ReducedPressure += 0.25;
    const problems = kineticExperimentStateProblems(broken);
    expect(problems.some((p) => p.includes('логарифм не согласован с приведённым давлением'))).toBe(true);
  });

  it('корректная фактическая fall-off-диагностика продолжает приниматься', () => {
    const state = recordedState();
    const audit = state.history[0].segments[0].audit;
    if (audit === undefined || audit.kind !== 'recorded') {
      throw new Error('ожидался recorded-снимок сегмента');
    }
    const fallOff = audit.reactions[0].fallOff;
    // фактические числа согласованы внутренне: Pr строго положителен,
    // логарифм равен фактической операции вычислителя Math.log10(Pr)
    expect(fallOff.reducedPressure).toBeGreaterThan(0);
    expect(fallOff.log10ReducedPressure).toBe(Math.log10(fallOff.reducedPressure));
    expect(fallOff.lowPressureLimit).toBeGreaterThan(0);
    expect(fallOff.highPressureLimit).toBeGreaterThan(0);
    expect(fallOff.broadeningFactor).toBeGreaterThan(0);
    expect(fallOff.broadeningFactor).toBeLessThanOrEqual(1);
    // реальное состояние без повреждений проходит валидатор целиком
    expect(kineticExperimentStateProblems(state)).toEqual([]);
  });
});

// ============================================
// 9. МОДЕЛЬ ПРЕДСТАВЛЕНИЯ ПОЛНОЙ ИСТОРИИ ЗАПУСКОВ
// ============================================

describe('Stage 4.5.5 world adapter: модель представления полной истории запусков', () => {
  it('возвращает ВСЕ запуски в хронологическом порядке, а не только последний', () => {
    let world = runWorldKineticTrajectory(makeWorld(), {
      segments: SINGLE_SEGMENT,
      setup: setupInput()
    });
    world = runWorldKineticTrajectory(world, {
      segments: [{ temperatureK: 350, dtSeconds: 50, reactionIds: [R106] }]
    });
    world = runWorldKineticTrajectory(world, { segments: SINGLE_SEGMENT });
    const experiment = world.kineticExperiment;
    if (experiment === undefined) {
      throw new Error('ожидался настроенный эксперимент');
    }
    expect(experiment.history.length).toBe(3);
    const model = kineticRunHistoryViewModel(experiment.history);
    // все три запуска представлены, в хронологическом порядке
    expect(model.length).toBe(3);
    expect(model.map((entry) => entry.runIndex)).toEqual([0, 1, 2]);
    expect(model.map((entry) => entry.segmentCount)).toEqual([1, 1, 1]);
    // последний раскрыт по умолчанию, предыдущие свёрнуты
    expect(model.map((entry) => entry.defaultExpanded)).toEqual([false, false, true]);
    // все сегменты всех запусков дают recorded-снимки (никаких реконструкций)
    expect(model.map((entry) => entry.segmentAuditKinds.join(','))).toEqual([
      'recorded',
      'recorded',
      'recorded'
    ]);
    // накопленное состояние трёх запусков строго валидно
    expect(kineticExperimentStateProblems(experiment)).toEqual([]);
  });

  it('снимки unavailable_legacy и отсутствующие снимки обозначаются честно', () => {
    const history = [
      {
        runIndex: 0,
        segments: [
          { index: 0, audit: { kind: 'unavailable_legacy', reason: 'сегмент выполнен до введения снимков аудита' } }
        ]
      },
      { runIndex: 1, segments: [{ index: 0 }, { index: 1, audit: undefined }] }
    ] as unknown as KineticExperimentRunRecord[];
    const model = kineticRunHistoryViewModel(history);
    expect(model.length).toBe(2);
    expect(model[0].defaultExpanded).toBe(false);
    expect(model[1].defaultExpanded).toBe(true);
    expect(model[0].segmentAuditKinds).toEqual(['unavailable_legacy']);
    // сегмент старой схемы 1.0.0 без поля audit — явное отсутствие, а не выдуманный снимок
    expect(model[1].segmentAuditKinds).toEqual(['absent', 'absent']);
  });
});
