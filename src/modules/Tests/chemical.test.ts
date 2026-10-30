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
  substanceTotalsOf
} from '../ChemicalEvolution';
import chemicalReactions from '../Data/chemicalReactions';
import { computeAtmospherePhysicalModel, getAllPresets } from '../Atmosphere';
import { G_EARTH_MS2 } from '../Units';
import type { AtmospherePhysicalModel } from '../../types';
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

    it('время моделирования продвигается на длительность шага', () => {
      const state = createChemicalState({
        atmospherePhysicalModel: makeModel({ ch4: 0.6, o2: 0.4 }),
        stepDurationYears: 1e6
      });
      const { state: next } = applyReaction(state, findReaction('ch4_oxidation'), {
        extentFraction: 0.1,
        temperatureK: 500,
        pressureAtm: 1
      });
      expect(next.modelTimeYears).toBeCloseTo(1e6, 6);
      expect(next.stepDurationYears).toBeCloseTo(1e6, 6);
    });
  });

  describe('кинетический режим B честно недоступен', () => {
    it('runKineticStep не выдаёт физически рассчитанную скорость', () => {
      for (const reaction of chemicalReactions) {
        const result = runKineticStep(reaction);
        expect(result.applied).toBe(false);
        expect(result.reason).toContain('кинетические параметры');
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
      const balance = computeOxygenBalance(after);
      expect(balance.consumption).toBeCloseTo(4, 10); // −4 O2 за шаг
      expect(balance.production).toBe(0);
      expect(balance.net).toBeCloseTo(-4, 10);
      expect(balance.note).toContain('положительного');
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
