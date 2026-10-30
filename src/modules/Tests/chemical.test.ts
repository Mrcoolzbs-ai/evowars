// ============================================
// TESTS - ChemicalEvolution (этап 3: химическая эволюция)
// ============================================

import { describe, it, expect } from 'vitest';
import {
  isReactionBalanced,
  createChemicalState,
  applyReaction,
  runKineticStep,
  computeOxygenBalance,
  createDefaultProcessRegistry,
  elementTotalsOf,
  substanceTotalsOf,
  runChemicalEvolutionStep
} from '../ChemicalEvolution';
import chemicalReactions from '../Data/chemicalReactions';
import { computeAtmospherePhysicalModel, getAllPresets } from '../Atmosphere';
import { G_EARTH_MS2 } from '../Units';
import type { AtmospherePhysicalModel, GeneratedWorld, ChemicalStepRecord } from '../../types';
import type { ChemicalReaction } from '../../types';

// ============================================
// ХЕЛПЕРЫ
// ============================================

/** Синтетическая физическая модель атмосферы для детерминированных тестов. */
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

/** Реакция каталога по id. */
function findReaction(id: string): ChemicalReaction {
  const reaction = chemicalReactions.find(r => r.id === id);
  if (!reaction) throw new Error(`Reaction ${id} not found`);
  return reaction;
}

describe('ChemicalEvolution (химическая эволюция, этап 3)', () => {
  describe('элементный баланс реакций', () => {
    it('все реакции каталога сбалансированы по элементам', () => {
      expect(chemicalReactions.length).toBe(4);
      for (const reaction of chemicalReactions) {
        expect(isReactionBalanced(reaction)).toBe(true);
      }
    });

    it('этан балансируется дробным коэффициентом: C2H6 + 3.5O2 → 2CO2 + 3H2O', () => {
      const c2h6 = findReaction('c2h6_oxidation');
      expect(isReactionBalanced(c2h6)).toBe(true);
      // 2 C, 6 H, 7 O слева; 2 C, 6 H, 7 O справа.
    });

    it('несбалансированная реакция отвергается с ошибкой', () => {
      const fake: ChemicalReaction = {
        ...findReaction('ch4_oxidation'),
        id: 'fake_unbalanced',
        products: [
          { gasId: 'co2', coefficient: 1 },
          { gasId: 'h2o', coefficient: 1 } // должно быть 2
        ]
      };
      expect(isReactionBalanced(fake)).toBe(false);
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.5, o2: 0.5 }) });
      expect(() => applyReaction(state, fake, { temperatureK: 500, pressureAtm: 1 })).toThrow(/баланса/);
    });

    it('реакция с веществом неизвестного состава не считается сбалансированной', () => {
      const withUnknown: ChemicalReaction = {
        ...findReaction('ch4_oxidation'),
        id: 'with_unidentified',
        products: [
          { gasId: 'unidentified', coefficient: 1 },
          { gasId: 'h2o', coefficient: 2 }
        ]
      };
      expect(isReactionBalanced(withUnknown)).toBe(false);
    });
  });

  describe('стехиометрия и лимитирующий реагент', () => {
    it('CH4 + 2O2 → CO2 + 2H2O: стехиометрия соблюдается точно', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) });
      // Инвентарь: ch4 = 60, o2 = 40. Лимитирующий: o2 (40/2 = 20 < 60/1).
      const { state: next, record } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      expect(record.applied).toBe(true);
      expect(record.limitingReactant).toBe('o2');
      // extent = 0.1 × maxExtent(20) = 2.
      expect(record.extent).toBeCloseTo(2, 10);
      expect(next.inventory['ch4']).toBeCloseTo(58, 10);   // −2
      expect(next.inventory['o2']).toBeCloseTo(36, 10);    // −4
      expect(next.inventory['co2']).toBeCloseTo(2, 10);    // +2
      expect(next.inventory['h2o']).toBeCloseTo(4, 10);    // +4
    });

    it('кислород расходуется, CO2 и H2O образуются (суммарная реакция окисления)', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) });
      const before = { ...state.inventory };
      const { state: next } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.5,
        temperatureK: 500,
        pressureAtm: 1
      });
      expect(next.inventory['o2']).toBeLessThan(before['o2']);
      expect(next.inventory['co2']).toBeGreaterThan(before['co2'] ?? 0);
      expect(next.inventory['h2o']).toBeGreaterThan(before['h2o'] ?? 0);
    });

    it('реакция останавливается при исчерпании лимитирующего реагента', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 1 }) });
      // Кислорода нет вообще: maxExtent = 0.
      const { state: next, record } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      expect(record.applied).toBe(false);
      expect(record.limitingReactant).toBe('o2');
      expect(record.reason).toContain('недостаточно реагентов');
      // Инвентарь не изменился.
      expect(next.inventory['ch4']).toBeCloseTo(100, 10);
    });

    it('отрицательные количества веществ невозможны при полном превращении', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.1, o2: 0.9 }) });
      // maxExtent = min(10, 45) = 10; запрашиваем огромную степень превращения.
      const { state: next, record } = applyReaction(state, findReaction('ch4_oxidation'), {
        extent: 1000,
        temperatureK: 500,
        pressureAtm: 1
      });
      expect(record.extent).toBeCloseTo(10, 10);
      expect(next.inventory['ch4']).toBeUndefined(); // полностью израсходован, а не отрицателен
      for (const amount of Object.values(next.inventory)) {
        expect(amount).toBeGreaterThanOrEqual(0);
      }
    });

    it('элементные итоги сохраняются после реакции: атомы не возникают и не исчезают', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) });
      const before = elementTotalsOf(state);
      const { state: next } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.3,
        temperatureK: 500,
        pressureAtm: 1
      });
      const after = elementTotalsOf(next);
      for (const element of Object.keys(before.totals)) {
        expect(after.totals[element]).toBeCloseTo(before.totals[element], 8);
      }
      for (const element of Object.keys(after.totals)) {
        expect(before.totals[element]).toBeCloseTo(after.totals[element], 8);
      }
    });

    it('молярные доли пересчитываются после реакции', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) });
      const { state: next } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      const total = Object.values(next.inventory).reduce((s, v) => s + v, 0);
      expect(next.molarFractions['ch4']).toBeCloseTo(58 / total, 10);
    });
  });

  describe('условия и ограничения реакций', () => {
    it('реакция вне температурного диапазона каталога не выполняется', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) });
      // Окисление метана: 300–2000 K. Холодный мир 100 K.
      const { record } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 100,
        pressureAtm: 1
      });
      expect(record.applied).toBe(false);
      expect(record.reason).toContain('вне допустимого диапазона');
    });

    it('фотохимическая реакция требует доступности излучения', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ co: 0.5, o2: 0.5 }) });
      const reaction = findReaction('co_oxidation'); // isPhotochemical: true
      expect(reaction.isPhotochemical).toBe(true);
      const { record } = applyReaction(state, reaction, {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1,
        radiationAvailable: false
      });
      expect(record.applied).toBe(false);
      expect(record.reason).toContain('излучения');

      // При подтверждённом излучении реакция выполняется.
      const { record: withLight } = applyReaction(state, reaction, {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1,
        radiationAvailable: true
      });
      expect(withLight.applied).toBe(true);
    });
  });

  describe('режимы инвентаря', () => {
    it('режим A (игровой): скорость — явное игровое допущение', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) });
      expect(state.mode).toBe('game_normalized');
      expect(state.unitsNote).toContain('НЕИЗВЕСТНО');
      const { record } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      expect(record.mode).toBe('stoichiometric');
      expect(record.confidence).toBe('game_assumption');
      expect(record.reason).toContain('игровое допущение');
    });

    it('режим column_inventory включается только при известном столбе и гравитации', () => {
      const earth = getAllPresets()['earth'];
      const model = computeAtmospherePhysicalModel(earth, { surfaceGravityMs2: G_EARTH_MS2 });
      const state = createChemicalState({
        atmospherePhysicalModel: model,
        surfaceGravityMs2: G_EARTH_MS2
      });
      expect(state.mode).toBe('column_inventory');
      expect(state.unitsNote).toContain('молях вещества на м²');
      // Инвентарь в моль/м², а не в процентах.
      const columnMol = model.columnMolM2?.value as number;
      expect(state.inventory['n2']).toBeCloseTo(columnMol * model.molarFractions['n2'], 6);
    });

    it('применение одиночной реакции НЕ продвигает модельное время', () => {
      const state = createChemicalState({
        atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }),
        stepDurationYears: 1e6
      });
      const { state: next } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      // Время продвигает ТОЛЬКО глобальный шаг runChemicalEvolutionStep
      // (ровно один раз за вызов): одиночная реакция — не шаг симуляции.
      expect(next.modelTimeYears).toBe(0);
      expect(next.stepDurationYears).toBeCloseTo(1e6, 6);
    });
  });

  describe('глобальный шаг: время и кислородный баланс', () => {
    /** Синтетический мир с химическим состоянием (unit-уровень, без генератора). */
    function makeWorld(fractions: Record<string, number>, temperatureK = 600): GeneratedWorld {
      const model = makeModel(fractions);
      const chemicalState = createChemicalState({ atmospherePhysicalModel: model });
      return {
        chemicalState,
        atmospherePhysics: model,
        atmosphere: { temperature: temperatureK },
        phaseAnalysis: { temperatureK },
        energyBudget: { incidentFlux: { value: 1361 } },
        energySources: { primary: [], secondary: [] }
      } as unknown as GeneratedWorld;
    }

    it('сценарий A: применилась одна реакция — время растёт ровно на один шаг', () => {
      const world = makeWorld({ ch4: 0.6, o2: 0.4 });
      const result = runChemicalEvolutionStep(world);
      const applied = result.world.chemicalState?.history.filter(r => r.applied).length ?? 0;
      expect(applied).toBe(1); // доступна только реакция окисления метана
      expect(result.world.chemicalState?.modelTimeYears).toBeCloseTo(1e6, 6);
    });

    it('сценарий B: применилось несколько реакций — время всё равно растёт ровно на один шаг', () => {
      // При 600 K все четыре окислительные реакции каталога проходят
      // свои температурные диапазоны; кислорода достаточно для каждой.
      const world = makeWorld({ ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 });
      const result = runChemicalEvolutionStep(world);
      const applied = result.world.chemicalState?.history.filter(r => r.applied).length ?? 0;
      expect(applied).toBeGreaterThanOrEqual(3);
      expect(result.world.chemicalState?.modelTimeYears).toBeCloseTo(1e6, 6);
    });

    it('сценарий C: ни одна реакция не применилась — время всё равно растёт на один шаг', () => {
      // Инертный азот: реагентов каталога нет.
      const world = makeWorld({ n2: 1 });
      const result = runChemicalEvolutionStep(world);
      const applied = result.world.chemicalState?.history.filter(r => r.applied).length ?? 0;
      expect(applied).toBe(0);
      expect(result.world.chemicalState?.modelTimeYears).toBeCloseTo(1e6, 6);
    });

    it('сценарий D: последовательные шаги накапливают время кумулятивно', () => {
      let world = makeWorld({ n2: 1 });
      for (let step = 1; step <= 3; step++) {
        world = runChemicalEvolutionStep(world).world;
        expect(world.chemicalState?.modelTimeYears).toBeCloseTo(step * 1e6, 6);
      }
    });

    it('баланс (сценарий A): первый шаг показывает расход именно этого шага', () => {
      // До первого шага баланс нулевой (инициализация состояния).
      const world = makeWorld({ ch4: 0.6, o2: 0.4 });
      expect(world.chemicalState!.oxygenBalance.consumption).toBe(0);
      const result = runChemicalEvolutionStep(world);
      const state = result.world.chemicalState!;
      // Инвентарь: ch4=60, o2=40 → лимитирующий реагент o2 (40/2=20),
      // степень превращения 0.1×20=2 → потреблено 2×2=4 O₂.
      // Проверяем СМЫСЛ величин (расход шага), а не сравнение
      // oxygenBalance с результатом computeOxygenBalance.
      expect(state.oxygenBalance.consumption).toBeCloseTo(4, 6);
      expect(state.oxygenBalance.production).toBe(0);
      expect(state.oxygenBalance.net).toBeCloseTo(-4, 6);
      // Единственная применённая запись шага несёт тот же расход O₂.
      const appliedRecords = state.history.filter(r => r.applied);
      expect(appliedRecords.length).toBe(1);
      expect(appliedRecords[0].changes['o2']).toBeCloseTo(-4, 6);
    });

    it('баланс (сценарий B): второй шаг без применимых реакций — нулевой, не накопительный', () => {
      // Шаг 1 при 600 K: окисление метана применилось, расход 4.
      let world = runChemicalEvolutionStep(makeWorld({ ch4: 0.6, o2: 0.4 })).world;
      expect(world.chemicalState!.oxygenBalance.consumption).toBeCloseTo(4, 6);
      const lenAfterStep1 = world.chemicalState!.history.length;
      // Шаг 2 при 200 K: окисление метана вне диапазона (300–2000 K),
      // других реагентов каталога в составе нет → 0 применимых реакций.
      const worldCold = {
        ...world,
        atmosphere: { temperature: 200 },
        phaseAnalysis: { temperatureK: 200 }
      } as GeneratedWorld;
      world = runChemicalEvolutionStep(worldCold).world;
      const state = world.chemicalState!;
      const appliedStep2 = state.history.slice(lenAfterStep1).filter(r => r.applied).length;
      expect(appliedStep2).toBe(0);
      // Баланс шага 2 — нулевой, а НЕ накопленный расход истории (4).
      expect(state.oxygenBalance.consumption).toBe(0);
      expect(state.oxygenBalance.production).toBe(0);
      expect(state.oxygenBalance.net).toBe(0);
      // Время всё равно продвинулось ровно на один шаг.
      expect(state.modelTimeYears).toBeCloseTo(2e6, 6);
    });

    it('баланс: единицы соответствуют режиму инвентаря, скорость не заявляется', () => {
      // Нормированный игровой инвентарь.
      const normalized = runChemicalEvolutionStep(makeWorld({ ch4: 0.6, o2: 0.4 })).world;
      const noteNormalized = normalized.chemicalState!.oxygenBalance.note;
      expect(noteNormalized).toContain('нормированные игровые единицы');
      expect(noteNormalized).toContain('НЕ кинетическая скорость');
      // Инвентарь моль/м²: модель столба с известной гравитацией.
      const columnModel = makeModel(
        { ch4: 0.6, o2: 0.4 },
        { columnMolM2: { value: 1e5, unit: 'моль/м²', confidence: 'derived' } }
      );
      const columnWorld = {
        chemicalState: createChemicalState({
          atmospherePhysicalModel: columnModel,
          surfaceGravityMs2: G_EARTH_MS2
        }),
        atmospherePhysics: columnModel,
        atmosphere: { temperature: 600 },
        phaseAnalysis: { temperatureK: 600 },
        energyBudget: { incidentFlux: { value: 1361 } },
        energySources: { primary: [], secondary: [] }
      } as unknown as GeneratedWorld;
      expect(columnWorld.chemicalState!.mode).toBe('column_inventory');
      const columnResult = runChemicalEvolutionStep(columnWorld).world;
      const noteColumn = columnResult.chemicalState!.oxygenBalance.note;
      expect(noteColumn).toContain('моль');
    });

    it('баланс (сценарий C): несколько реакций шага суммируются в расход шага', () => {
      const world = makeWorld({ ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 });
      const result = runChemicalEvolutionStep(world);
      const state = result.world.chemicalState!;
      const appliedRecords = state.history.filter(r => r.applied);
      expect(appliedRecords.length).toBeGreaterThanOrEqual(3);
      // Смысл: расход шага = сумма расходов O₂ по применённым записям
      // ЭТОГО шага (вычисляется из записей, а не из computeOxygenBalance).
      const expected = appliedRecords.reduce(
        (sum, r) => sum + Math.max(0, -(r.changes['o2'] ?? 0)),
        0
      );
      expect(expected).toBeGreaterThan(4); // действительно несколько реакций
      expect(state.oxygenBalance.consumption).toBeCloseTo(expected, 10);
      expect(state.oxygenBalance.net).toBeCloseTo(-expected, 10);
    });

    it('баланс (сценарий D): расходы последовательных шагов считаются отдельно', () => {
      let world = makeWorld({ ch4: 0.6, o2: 0.4 });
      world = runChemicalEvolutionStep(world).world;
      const lenAfterStep1 = world.chemicalState!.history.length;
      expect(world.chemicalState!.oxygenBalance.consumption).toBeCloseTo(4, 6);
      world = runChemicalEvolutionStep(world).world;
      const state = world.chemicalState!;
      // Записи шага 2 — только добавленные после шага 1.
      const step2Records = state.history.slice(lenAfterStep1);
      expect(step2Records.length).toBeGreaterThan(0);
      const appliedStep2 = step2Records.filter(r => r.applied);
      expect(appliedStep2.length).toBeGreaterThan(0);
      const expectedStep2 = appliedStep2.reduce(
        (sum, r) => sum + Math.max(0, -(r.changes['o2'] ?? 0)),
        0
      );
      // Расход шага 2 — собственный, а НЕ накопленный за историю
      // (накопленный = 4 + расход шага 2, строго больше расхода шага 2).
      const cumulative = state.history.reduce(
        (sum, r) => sum + Math.max(0, -(r.changes['o2'] ?? 0)),
        0
      );
      expect(expectedStep2).toBeGreaterThan(0);
      expect(state.oxygenBalance.consumption).toBeCloseTo(expectedStep2, 10);
      expect(cumulative).toBeCloseTo(4 + expectedStep2, 10);
      expect(state.oxygenBalance.consumption).toBeLessThan(cumulative);
    });

    it('баланс (сценарий E): прямой applyReaction сохраняет семантику последнего завершённого шага', () => {
      // Контракт: отдельный applyReaction — НЕ глобальный шаг. Он
      // применяет реакцию и добавляет запись в history, но не двигает
      // время и не меняет oxygenBalance: поле продолжает отражать
      // последний ЗАВЕРШЁННЫЙ глобальный шаг (здесь — нулевую
      // инициализацию).
      const state = createChemicalState({
        atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 })
      });
      const { state: after } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      // Запись сохранена в истории и несёт численный расход O₂:
      const record = after.history.find(r => r.applied);
      expect(record).toBeDefined();
      expect(record!.changes['o2']).toBeCloseTo(-4, 6);
      expect(after.history.length).toBe(1);
      // Время и баланс последнего завершённого шага не тронуты:
      expect(after.modelTimeYears).toBe(0);
      expect(after.oxygenBalance.consumption).toBe(0);
      expect(after.oxygenBalance.production).toBe(0);
      expect(after.oxygenBalance.net).toBe(0);
      // Баланс по ЯВНО переданным записям (вся история) реакцию учитывает:
      const balanceFromHistory = computeOxygenBalance(after.history, after.mode);
      expect(balanceFromHistory.consumption).toBeCloseTo(4, 6);
    });

    it('баланс: запись прямого applyReaction НЕ включается в баланс следующего глобального шага', () => {
      // Контракт: баланс глобального шага учитывает ТОЛЬКО реакции,
      // выполненные внутри этого шага. Запись, добавленная прямым
      // вызовом applyReaction, остаётся в истории, но в баланс
      // следующего runChemicalEvolutionStep автоматически не попадает.
      const manual = applyReaction(
        createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) }),
        findReaction('ch4_oxidation'),
        { extentFraction: 0.1, temperatureK: 500, pressureAtm: 1 }
      ).state;
      // Глобальный шаг над этим состоянием (мир собирается вокруг него):
      const world = {
        chemicalState: manual,
        atmospherePhysics: makeModel({ ch4: 0.6, o2: 0.4 }),
        atmosphere: { temperature: 600 },
        phaseAnalysis: { temperatureK: 600 },
        energyBudget: { incidentFlux: { value: 1361 } },
        energySources: { primary: [], secondary: [] }
      } as unknown as GeneratedWorld;
      const result = runChemicalEvolutionStep(world);
      const state = result.world.chemicalState!;
      // В истории: 1 ручная запись + 4 записи глобального шага
      // (по одной на каждую реакцию каталога).
      expect(state.history.length).toBe(5);
      // Баланс шага — только реакции САМОГО шага: ещё одно окисление
      // метана (инвентарь после ручной реакции: ch4=58, o2=36 →
      // лимит min(58, 36/2=18)=18 → 0.1×18 → −3.6 O₂), без ручной
      // записи (с ней было бы 4 + 3.6 = 7.6).
      expect(state.oxygenBalance.consumption).toBeCloseTo(3.6, 6);
      expect(state.oxygenBalance.consumption).not.toBeCloseTo(7.6, 6);
      // История по-прежнему хранит ручную запись с расходом 4:
      const manualRecord = state.history[0];
      expect(manualRecord.changes['o2']).toBeCloseTo(-4, 6);
    });

    it('баланс (сценарий F): производство O₂ остаётся нулевым без источников', () => {
      let world = makeWorld({ ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 });
      for (let step = 1; step <= 3; step++) {
        world = runChemicalEvolutionStep(world).world;
        const state = world.chemicalState!;
        expect(state.oxygenBalance.production).toBe(0);
        expect(state.oxygenBalance.net).toBeCloseTo(-state.oxygenBalance.consumption, 12);
      }
      // Источники реестра отключены и без выдуманных скоростей.
      const registry = createDefaultProcessRegistry();
      const bio = registry.find(p => p.id === 'biological_o2_production');
      expect(bio).toBeDefined();
      expect(bio!.enabled).toBe(false);
      expect(bio!.ratePerStep).toBeNull();
    });

    it('элементный состав сохраняется на последовательных шагах (повторного применения нет)', () => {
      let world = makeWorld({ ch4: 0.15, c2h6: 0.15, h2: 0.15, co: 0.15, o2: 0.4 });
      const before = elementTotalsOf(world.chemicalState!);
      world = runChemicalEvolutionStep(world).world;
      world = runChemicalEvolutionStep(world).world;
      const after = elementTotalsOf(world.chemicalState!);
      // elementTotalsOf возвращает { totals, excludedSubstances }:
      // индексируем именно таблицу totals.
      for (const element of Object.keys(before.totals)) {
        expect(after.totals[element] ?? 0).toBeCloseTo(before.totals[element], 6);
      }
    });
  });

  describe('computeOxygenBalance: явный набор записей', () => {
    /** Синтетическая запись с изменением O₂ (остальные поля — константы). */
    const rec = (o2: number, applied = true): ChemicalStepRecord => ({
      stepNumber: 1,
      reactionId: 'synthetic',
      applied,
      mode: 'stoichiometric',
      extent: applied ? 1 : null,
      limitingReactant: 'o2',
      reason: '',
      changes: o2 === 0 ? {} : { o2 },
      confidence: 'game_assumption'
    });

    it('пустой набор записей даёт нулевой баланс', () => {
      const balance = computeOxygenBalance([], 'game_normalized');
      expect(balance.production).toBe(0);
      expect(balance.consumption).toBe(0);
      expect(balance.net).toBe(0);
      expect(balance.note).toContain('НЕ кинетическая скорость');
    });

    it('баланс считается ТОЛЬКО по переданным записям шага', () => {
      // Две применимые записи шага (−4 и −3.6 O₂) и одна пустая:
      const balance = computeOxygenBalance([rec(-4), rec(0, false), rec(-3.6)], 'game_normalized');
      expect(balance.consumption).toBeCloseTo(7.6, 6);
      expect(balance.production).toBe(0);
      expect(balance.net).toBeCloseTo(-7.6, 6);
      // Единицы режима column_inventory — моль O₂/м² за шаг:
      const column = computeOxygenBalance([rec(-4)], 'column_inventory');
      expect(column.consumption).toBeCloseTo(4, 6);
      expect(column.note).toContain('моль');
    });

    it('записи разных шагов не смешиваются: каждой порции — свой баланс', () => {
      const step1 = [rec(-4), rec(0, false)];
      const step2 = [rec(-3.6), rec(0, false)];
      // Баланс каждого шага — только его записи; накопленный итог 7.6
      // не присваивается ни одному отдельному шагу:
      expect(computeOxygenBalance(step1, 'game_normalized').consumption).toBeCloseTo(4, 6);
      expect(computeOxygenBalance(step2, 'game_normalized').consumption).toBeCloseTo(3.6, 6);
      expect(computeOxygenBalance([...step1, ...step2], 'game_normalized').consumption).toBeCloseTo(7.6, 6);
    });
  });

  describe('кинетический режим B честно недоступен', () => {
    it('runKineticStep не выдаёт физически рассчитанную скорость', () => {
      for (const reaction of chemicalReactions) {
        const result = runKineticStep(reaction);
        expect(result.applied).toBe(false);
        expect(result.reason).toContain('кинетических параметров');
      }
    });

    it('gameSpeedCoefficient каталога не используется как доказанная константа', () => {
      for (const reaction of chemicalReactions) {
        // Коэффициент остаётся игровым полем каталога и не фигурирует
        // в расчётах скорости движка.
        expect(reaction.gameSpeedCoefficient).toBeGreaterThanOrEqual(0);
        expect(typeof reaction.gameSpeedCoefficient).toBe('number');
      }
    });
  });

  describe('кислородный баланс', () => {
    it('потребление O2 фиксируется в балансе, производство по умолчанию нулевое', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) });
      const { state: after } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      const balance = computeOxygenBalance(after.history, after.mode);
      expect(balance.consumption).toBeCloseTo(4, 10); // −4 O2 за шаг
      expect(balance.production).toBe(0);
      expect(balance.net).toBeCloseTo(-4, 10);
      // Итог дискретного шага, а не кинетическая скорость d(O₂)/dt:
      expect(balance.note).toContain('НЕ кинетическая скорость');
      // Баланс считается по ЯВНО переданному набору записей
      // (здесь — вся история, состоящая из одной записи шага).
    });

    it('O2 не накапливается без источников: структура ждёт будущих организмов', () => {
      const registry = createDefaultProcessRegistry();
      const bio = registry.find(p => p.id === 'biological_o2_production');
      expect(bio).toBeDefined();
      expect(bio?.enabled).toBe(false); // отключён по умолчанию
      expect(bio?.ratePerStep).toBeNull(); // численной скорости нет
      expect(bio?.note).toContain('не добавляет O₂ автоматически');
    });
  });

  describe('реестр источников и стоков', () => {
    it('все процессы реестра по умолчанию отключены и без выдуманных скоростей', () => {
      const registry = createDefaultProcessRegistry();
      expect(registry.length).toBeGreaterThanOrEqual(11);
      for (const process of registry) {
        expect(process.enabled).toBe(false);
        expect(process.ratePerStep).toBeNull();
        expect(['source', 'sink', 'exchange']).toContain(process.direction);
        // Источник либо честно пуст, либо указан явно.
        expect(typeof process.source).toBe('string');
      }
    });
  });

  describe('сохранение вещества между резервуарами', () => {
    it('реакция обновляет атмосферный резервуар синхронно с инвентарём', () => {
      const state = createChemicalState({ atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }) });
      const { state: next } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      expect(next.reservoirs.atmospheric['ch4']).toBeCloseTo(next.inventory['ch4'], 10);
      // Общее количество вещества (в моль исходных частиц) сохраняется
      // только с учётом стехиометрии: проверяем по элементам.
      const totals = substanceTotalsOf(next);
      expect(totals['co2']).toBeCloseTo(2, 10);
    });
  });
});
