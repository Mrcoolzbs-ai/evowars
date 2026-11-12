// ============================================
// CHEMICAL EVOLUTION - Стехиометрический движок химической эволюции
// ============================================
//
// Материальная модель атмосферной химии:
// - инвентарь веществ в молях на м² атмосферного столба (когда известны
//   давление, гравитация и состав) или явно помеченный нормированный
//   игровой инвентарь;
// - автоматическая проверка ЭЛЕМЕНТНОГО БАЛАНСА каждой реакции
//   (атомы не возникают из ничего и не исчезают);
// - лимитирующий реагент: реакция не потребляет больше, чем есть;
// - два режима: A — стехиометрический сценарий (скорость = игровое
//   допущение), B — кинетический расчёт. Для реакций каталога
//   экспериментальных кинетических данных нет, поэтому режим B
//   честно возвращает "не рассчитано" и НЕ выдумывает константы;
// - кислородный баланс: дискретное количество O₂ за один глобальный
//   стехиометрический шаг (column_inventory — моль O₂/м² за шаг,
//   game_normalized — нормированные игровые единицы за шаг);
//   производство по умолчанию нулевое, кинетика НЕ моделируется;
// - реестр источников и стоков (все отключены по умолчанию).

import type {
  AtmospherePhysicalModel,
  ChemicalEvolutionState,
  ChemicalReaction,
  ChemicalStepRecord,
  ChemicalProcess,
  GeneratedWorld,
  InventoryMode,
  SubstanceReservoirs
} from '../../types';
import chemicalReactions from '../Data/chemicalReactions';
import gases from '../Data/gases';
import { elementCompositions, getElementComposition } from '../Data/elementCompositions';
import { paToAtm } from '../Units';
import { createEmptyReservoirs, totalSubstanceAmount } from '../PhaseEquilibrium';
// Stage 4.2.3.3 (интеграция химии с Scheduler): пользовательский шаг
// химической эволюции выполняется через атомарный macro-шаг научного
// ядра. Импортируется только научное ядро (без обратных зависимостей:
// ядро легаси-химию не импортирует).
import {
  CHEMICAL_RESERVOIR_IDS,
  buildSpeciesCatalogFromLegacy,
  chemicalReservoirConsistencyIssues,
  chemicalStateFromCoreReservoirs,
  coreWorldStateFromLegacyWorld,
  inventoryModeToBasis
} from '../Core/adapters';
import { createProcessRegistry } from '../Core/processRegistry';
import type { ProcessDescriptor, ProcessRegistry } from '../Core/processRegistry';
import type { MacroStepResult, ProcessOperator } from '../Core/scheduler';
import { runMacroStep } from '../Core/scheduler';
import type { ReactionExtentBasis } from '../Core/reactionLedger';
import { registerReaction } from '../Core/reactionLedger';
import { convert, quantity } from '../Core/physicalQuantity';
import { unknownValue } from '../Core/scientificValue';
import type { CoreWorldState } from '../Core/worldState';
import type { ReservoirRecord } from '../Core/reservoir';
import { setMaterialInventory } from '../Core/reservoir';

// Stage 4.5.5 (первый реализационный срез, 2026-11-10): концентрационный
// кинетический механизм ограниченного состава (записи каталога №89/№106,
// known) — отдельный STATELESS API поверх явного вектора концентраций
// molecule/cm³. Режим A (applyReaction/runChemicalEvolutionStep) и
// заглушка runKineticStep НЕ меняются: механизм НЕ подключён к состоянию
// мира (конверсия inventory в концентрации невозможна без физического
// контракта атмосферного столба, которого в проекте нет).
import { runConcentrationKineticStep } from './kineticMechanism';

export * from './kineticMechanism';

// Stage 4.5.5 (второй реализационный срез, 2026-11-10): физически явный
// реакционный слой (компартмент) поверх концентрационного механизма —
// stateless-адаптер runKineticCompartmentStep между ЯВНЫМ столбовым
// инвентарём (моль/м²) и ЯВНО заданной толщиной однородного слоя (м);
// толщина слоя НЕ выводится из параметров мира, N₂ передаётся явно.
// К состоянию мира (GeneratedWorld/ChemicalEvolutionState/
// runChemicalEvolutionStep) НЕ подключён; режим A и заглушка runKineticStep
// НЕ меняются.
import { runKineticCompartmentStep } from './kineticCompartment';

export * from './kineticCompartment';

// Stage 4.5.5 (третий реализационный срез, 2026-11-10): последовательная
// кинетическая траектория одного компартмента — stateless API
// runKineticCompartmentTrajectory поверх существующего
// runKineticCompartmentStep: явное расписание сегментов (своя температура/
// dt/реакции каждого сегмента), общая постоянная толщина слоя, строгая
// последовательная передача инвентаря между сегментами, накопление
// физического времени и атомарный отказ всей траектории с диагностикой
// (segmentIndex, elapsedSecondsBeforeSegment). К состоянию мира НЕ
// подключён; режим A, Radau IIA и каталог НЕ меняются; конвертеры слоя
// укреплены (переполнение/underflow запрещены).
import { runKineticCompartmentTrajectory } from './kineticTrajectory';

export * from './kineticTrajectory';

// Stage 4.5.5 (интеграционный срез, 2026-11-10): пользовательский
// кинетический эксперимент №89/№106 в паспорте мира — world adapter
// runWorldKineticTrajectory поверх существующей траектории
// компартмента. Эксперимент — отдельное ОПЦИОНАЛЬНОЕ состояние мира
// (GeneratedWorld.kineticExperiment): начальные запасы и толщина
// слоя задаются пользователем ЯВНО (не извлекаются из атмосферного
// состава и параметров мира), физическое время — сумма dtSeconds
// сегментов (игровые часы/gameSpeedCoefficient не участвуют),
// состояние обновляется только после полного успешного завершения
// траектории, ошибки — существующая KineticMechanismError без
// мутации исходного мира; сброс — отдельная явная операция
// (resetWorldKineticExperiment). Режим A, ChemicalEvolutionState и
// runChemicalEvolutionStep НЕ меняются: эксперимент к ним не
// подключён, результаты НЕ выдаются за рассчитанную эволюцию
// атмосферы планеты (перенос/диффузия/конвекция/пополнение не
// моделируются).
import {
  KINETIC_EXPERIMENT_SCHEMA_VERSION,
  KINETIC_EXPERIMENT_SPECIES,
  kineticExperimentStateProblems,
  resetWorldKineticExperiment,
  runWorldKineticTrajectory
} from './kineticWorldAdapter';

export * from './kineticWorldAdapter';

// ============================================
// 1. ЭЛЕМЕНТНЫЙ БАЛАНС РЕАКЦИЙ
// ============================================

/**
 * Проверка сохранения числа атомов каждого элемента в реакции.
 * Для веществ с неизвестным составом проверка невозможна —
 * возвращается false (реакция не допускается к применению).
 */
export function isReactionBalanced(reaction: ChemicalReaction): boolean {
  const reactantTotals: Record<string, number> = {};
  const productTotals: Record<string, number> = {};

  const accumulate = (
    entries: { gasId: string; coefficient: number }[],
    totals: Record<string, number>
  ): boolean => {
    for (const entry of entries) {
      const composition = getElementComposition(entry.gasId);
      if (!composition) {
        return false; // состав неизвестен — баланс не проверить
      }
      for (const [element, count] of Object.entries(composition.elements)) {
        totals[element] = (totals[element] ?? 0) + count * entry.coefficient;
      }
    }
    return true;
  };

  if (!accumulate(reaction.reactants, reactantTotals)) return false;
  if (!accumulate(reaction.products, productTotals)) return false;

  const elements = new Set([...Object.keys(reactantTotals), ...Object.keys(productTotals)]);
  for (const element of elements) {
    if ((reactantTotals[element] ?? 0) !== (productTotals[element] ?? 0)) {
      return false;
    }
  }
  return true;
}

// ============================================
// 2. СОЗДАНИЕ СОСТОЯНИЯ ХИМИЧЕСКОЙ ЭВОЛЮЦИИ
// ============================================

export interface CreateChemicalStateInput {
  atmospherePhysicalModel: AtmospherePhysicalModel;
  /** Поверхностная гравитация, м/с² (null — неизвестна) */
  surfaceGravityMs2?: number | null;
  /** Длительность шага, лет (игровое допущение; по умолчанию 1 млн лет) */
  stepDurationYears?: number;
}

/** Молярная масса газа в кг/моль; null, если неизвестна. */
function gasMolarMassKgMol(gasId: string): number | null {
  const gas = gases.find((g) => g.id === gasId);
  return gas && gas.molarMass !== null ? gas.molarMass / 1000 : null;
}

/** Средняя молярная масса смеси по молярным долям; null при неизвестном составе. */
function meanMolarMassFromFractions(fractions: Record<string, number>): number | null {
  let weighted = 0;
  let total = 0;
  for (const [gasId, x] of Object.entries(fractions)) {
    const m = gasMolarMassKgMol(gasId);
    if (m === null) {
      return null;
    }
    weighted += x * m;
    total += x;
  }
  if (total <= 0) {
    return null;
  }
  return weighted / total;
}

/**
 * Начальное состояние химической эволюции.
 *
 * Режим column_inventory (моль/м² столба) выбирается ТОЛЬКО когда
 * атмосферный столб и гравитация известны. Иначе используется
 * game_normalized с явной пометкой, что абсолютное количество
 * вещества неизвестно. Режимы не смешиваются.
 */
export function createChemicalState(input: CreateChemicalStateInput): ChemicalEvolutionState {
  const { atmospherePhysicalModel: model } = input;
  const stepDurationYears = input.stepDurationYears ?? 1e6;
  const gravityMs2 = input.surfaceGravityMs2 ?? null;
  const columnMolM2 = model.columnMolM2?.value ?? null;

  const useColumnInventory = columnMolM2 !== null && gravityMs2 !== null;

  const inventory: Record<string, number> = {};
  if (useColumnInventory) {
    for (const [gasId, x] of Object.entries(model.molarFractions)) {
      inventory[gasId] = (columnMolM2 as number) * x;
    }
  } else {
    // Нормированный игровой инвентарь: доли × 100 (безразмерные единицы).
    // Абсолютное физическое количество неизвестно и НЕ утверждается.
    for (const [gasId, x] of Object.entries(model.molarFractions)) {
      inventory[gasId] = x * 100;
    }
  }

  const reservoirs: SubstanceReservoirs = {
    ...createEmptyReservoirs(),
    atmospheric: { ...inventory }
  };

  const meanMolarMassKgMol = model.meanMolarMassKgMol?.value ?? null;

  return {
    mode: useColumnInventory ? 'column_inventory' : 'game_normalized',
    unitsNote: useColumnInventory
      ? 'атмосферный инвентарь задан в молях вещества на м² атмосферного столба'
      : 'нормированный игровой инвентарь: абсолютное физическое количество вещества НЕИЗВЕСТНО; проценты не являются количеством вещества',
    inventory,
    reservoirs,
    molarFractions: { ...model.molarFractions },
    surfacePressurePa: model.surfacePressurePa?.value ?? null,
    gravityMs2,
    meanMolarMassKgMol,
    modelTimeYears: 0,
    stepDurationYears,
    history: [],
    oxygenBalance: {
      production: 0,
      consumption: 0,
      net: 0,
      note: 'баланс последнего ЗАВЕРШЁННОГО глобального шага; до первого шага — нулевой. Биологическое производство O₂ по умолчанию равно нулю: генератор ещё не создаёт живые виды; структура позволяет подключить кислородопроизводителей в будущем'
    },
    notes: [
      `длительность шага — ${stepDurationYears} лет: игровое допущение, а не рассчитанное время`,
      'скорости реакций задаются степенью превращения за шаг (режим A) и являются игровым предположением',
      'кинетический режим B недоступен: у реакций каталога нет проверенных кинетических констант'
    ]
  };
}

// ============================================
// 3. ПЕРЕСЧЁТ ПРОИЗВОДНЫХ ВЕЛИЧИН
// ============================================

function recomputeFractions(state: ChemicalEvolutionState): void {
  const total = Object.values(state.inventory).reduce((s, v) => s + v, 0);
  const fractions: Record<string, number> = {};
  if (total > 0) {
    for (const [gasId, amount] of Object.entries(state.inventory)) {
      fractions[gasId] = amount / total;
    }
  }
  state.molarFractions = fractions;

  const meanM = meanMolarMassFromFractions(fractions);
  state.meanMolarMassKgMol = meanM;

  // Атмосферный резервуар всегда синхронен с инвентарём.
  state.reservoirs.atmospheric = { ...state.inventory };

  // Пересчёт поверхностного давления возможен только в режиме
  // column_inventory при известной гравитации и составе:
  //   P = n_column · M · g (гидростатика + идеальный газ).
  if (state.mode === 'column_inventory' && state.gravityMs2 !== null && meanM !== null && total > 0) {
    state.surfacePressurePa = total * meanM * state.gravityMs2;
  }
}

// ============================================
// 4. ПРИМЕНЕНИЕ РЕАКЦИИ (РЕЖИМ A — СТЕХИОМЕТРИЧЕСКИЙ)
// ============================================

export interface ApplyReactionOptions {
  /** Доля превращения лимитирующего реагента за шаг (игровое допущение) */
  extentFraction?: number;
  /** Абсолютная степень превращения (моль/м²); имеет приоритет над extentFraction */
  extent?: number;
  /** Температура среды, K; null — условия не проверяются */
  temperatureK?: number | null;
  /** Давление среды, atm; null — условия не проверяются */
  pressureAtm?: number | null;
  /** Доступность подходящего излучения для фотохимических реакций */
  radiationAvailable?: boolean;
}

export interface ApplyReactionResult {
  state: ChemicalEvolutionState;
  record: ChemicalStepRecord;
}

/**
 * Применение одной реакции к состоянию.
 *
 * Гарантии:
 * - элементный баланс реакции проверяется ДО применения (при нарушении — ошибка);
 * - расход ограничен лимитирующим реагентом;
 * - отрицательные количества веществ невозможны;
 * - молярные доли и (в режиме column_inventory) давление пересчитываются;
 * - скорость задана степенью превращения и помечена как игровое допущение.
 */
export function applyReaction(
  state: ChemicalEvolutionState,
  reaction: ChemicalReaction,
  options: ApplyReactionOptions = {}
): ApplyReactionResult {
  const stepNumber = state.history.length + 1;
  const baseRecord: ChemicalStepRecord = {
    stepNumber,
    reactionId: reaction.id,
    applied: false,
    mode: 'stoichiometric',
    extent: null,
    limitingReactant: null,
    reason: '',
    changes: {},
    confidence: 'game_assumption'
  };

  // 1. Элементный баланс обязателен: атомы не возникают и не исчезают.
  if (!isReactionBalanced(reaction)) {
    throw new Error(
      `Реакция ${reaction.id} не проходит проверку элементного баланса: применение запрещено.`
    );
  }

  const temperatureK = options.temperatureK ?? null;
  const pressureAtm = options.pressureAtm ?? null;

  // 2. Диапазоны допустимых условий каталога.
  if (temperatureK !== null && reaction.allowedRanges.temperature) {
    const range = reaction.allowedRanges.temperature;
    if (temperatureK < range.min || temperatureK > range.max) {
      return {
        state,
        record: {
          ...baseRecord,
          reason: `температура ${temperatureK} K вне допустимого диапазона реакции (${range.min}–${range.max} K): реакция не выполнялась`
        }
      };
    }
  }
  if (pressureAtm !== null && reaction.allowedRanges.pressure) {
    const range = reaction.allowedRanges.pressure;
    if (pressureAtm < range.min || pressureAtm > range.max) {
      return {
        state,
        record: {
          ...baseRecord,
          reason: `давление ${pressureAtm.toFixed(3)} atm вне допустимого диапазона реакции (${range.min}–${range.max} atm): реакция не выполнялась`
        }
      };
    }
  }

  // 3. Фотохимические реакции требуют подходящего излучения.
  if (reaction.isPhotochemical && options.radiationAvailable !== true) {
    return {
      state,
      record: {
        ...baseRecord,
        reason:
          'фотохимическая реакция требует подходящего излучения; доступность излучения не подтверждена — реакция не выполнялась'
      }
    };
  }

  // 4. Лимитирующий реагент.
  let maxExtent = Infinity;
  let limitingReactant: string | null = null;
  for (const reactant of reaction.reactants) {
    const available = state.inventory[reactant.gasId] ?? 0;
    const possible = available / reactant.coefficient;
    if (possible < maxExtent) {
      maxExtent = possible;
      limitingReactant = reactant.gasId;
    }
  }

  if (maxExtent <= 0) {
    return {
      state,
      record: {
        ...baseRecord,
        limitingReactant,
        reason: `недостаточно реагентов (лимитирующий: ${limitingReactant ?? 'неизвестен'}): реакция остановлена`
      }
    };
  }

  // 5. Степень превращения за шаг (режим A — игровое допущение).
  const extent = options.extent !== undefined ? options.extent : (options.extentFraction ?? 0.1) * maxExtent;
  if (extent <= 0) {
    return {
      state,
      record: { ...baseRecord, limitingReactant, reason: 'нулевая степень превращения: изменений нет' }
    };
  }
  const appliedExtent = Math.min(extent, maxExtent);

  // 6. Пересчёт количеств с запретом отрицательных значений.
  const changes: Record<string, number> = {};
  const next: ChemicalEvolutionState = {
    ...state,
    inventory: { ...state.inventory },
    reservoirs: {
      atmospheric: { ...state.reservoirs.atmospheric },
      liquidSurface: { ...state.reservoirs.liquidSurface },
      subsurfaceLiquid: { ...state.reservoirs.subsurfaceLiquid },
      solidDeposits: { ...state.reservoirs.solidDeposits }
    },
    history: [...state.history]
  };

  const take = (gasId: string, amount: number): void => {
    const current = next.inventory[gasId] ?? 0;
    const taken = Math.min(amount, current);
    const remaining = current - taken;
    if (remaining > 0) {
      next.inventory[gasId] = remaining;
    } else {
      delete next.inventory[gasId];
    }
    changes[gasId] = (changes[gasId] ?? 0) - taken;
  };

  const add = (gasId: string, amount: number): void => {
    next.inventory[gasId] = (next.inventory[gasId] ?? 0) + amount;
    changes[gasId] = (changes[gasId] ?? 0) + amount;
  };

  for (const reactant of reaction.reactants) {
    take(reactant.gasId, appliedExtent * reactant.coefficient);
  }
  for (const product of reaction.products) {
    add(product.gasId, appliedExtent * product.coefficient);
  }

  recomputeFractions(next);

  // 7. Кислородный баланс на уровне отдельной реакции НЕ обновляется.
  // Контракт разделён явно:
  // - отдельный applyReaction НЕ является глобальным шагом: он не
  //   двигает модельное время и не меняет oxygenBalance — поле
  //   продолжает отражать последний ЗАВЕРШЁННЫЙ глобальный шаг;
  // - запись реакции сохраняется в history;
  // - баланс каждого глобального шага учитывает ТОЛЬКО реакции,
  //   выполненные внутри этого шага (записи, добавленные самим
  //   runChemicalEvolutionStep). Запись прямого вызова applyReaction
  //   вне глобального шага в баланс следующего шага автоматически
  //   НЕ включается: явного механизма группировки записей по шагам
  //   на данном этапе нет, и случайные предположения о длине
  //   истории вместо него не используются.

  const record: ChemicalStepRecord = {
    ...baseRecord,
    applied: true,
    extent: appliedExtent,
    limitingReactant,
    reason: `реакция выполнена в стехиометрическом режиме: степень превращения ${appliedExtent.toFixed(6)} — игровое допущение, а не кинетический расчёт`,
    changes,
    confidence: 'game_assumption'
  };

  next.history = [...next.history, record];
  // Глобальное модельное время здесь НЕ продвигается: одиночная
  // реакция — не отдельный шаг симуляции. Время продвигает ровно
  // один раз runChemicalEvolutionStep, независимо от того, сколько
  // реакций применилось в рамках общего шага.

  return { state: next, record };
}

// ============================================
// 5. КИНЕТИЧЕСКИЙ РЕЖИМ (B) — ЧЕСТНО НЕДОСТУПЕН
// ============================================

/**
 * Кинетический шаг реакции. В каталоге нет экспериментальных
 * кинетических данных (уравнений скорости и констант), поэтому
 * физически рассчитанная скорость НЕ выдается — в отличие от
 * gameSpeedCoefficient, который является игровым параметром
 * и доказанной физической константой не считается.
 */
export function runKineticStep(reaction: ChemicalReaction): { applied: boolean; reason: string } {
  void reaction;
  return {
    applied: false,
    reason:
      'кинетический расчёт недоступен: для реакции нет проверенных кинетических параметров (уравнения скорости, констант и диапазона применимости). Скорость НЕ выдумывается.'
  };
}

// ============================================
// 6. КИСЛОРОДНЫЙ БАЛАНС
// ============================================

/**
 * Кислородный баланс ПО ЯВНО ПЕРЕДАННОМУ НАБОРУ ЗАПИСЕЙ — дискретный
 * итог стехиометрического игрового шага, а НЕ кинетическая скорость
 * d(O₂)/dt (кинетических констант модель не содержит).
 * Единицы соответствуют режиму инвентаря: column_inventory —
 * моль O₂/м² за шаг, game_normalized — нормированные игровые
 * единицы за шаг.
 */
export interface OxygenBalanceSummary {
  /** Произведено O₂ по переданным записям (без источников = 0) */
  production: number;
  /** Потреблено O₂ по переданным записям */
  consumption: number;
  /** Итоговое изменение количества O₂ по переданным записям */
  net: number;
  note: string;
}

/**
 * Кислородный баланс по ЯВНО ПЕРЕДАННОМУ набору записей: результат
 * всегда однозначно описывает именно тот набор реакций, который он
 * суммирует. Никакого неявного накопления по всей истории и
 * «молчаливых» аргументов по умолчанию: вызывающая сторона сама
 * выделяет записи нужного шага (runChemicalEvolutionStep передаёт
 * записи, созданные текущим вызовом; пустой набор даёт нулевой
 * баланс).
 *
 * Величины — дискретные количества за стехиометрический шаг в
 * единицах режима инвентаря: column_inventory — моль O₂/м² за шаг,
 * game_normalized — нормированные игровые единицы за шаг. Это НЕ
 * кинетическая скорость d(O₂)/dt: кинетика не моделируется.
 * Производство O₂ по умолчанию нулевое: биологических видов нет,
 * фотохимическое производство задаётся отключёнными процессами
 * реестра без подтверждённых численных скоростей.
 */
export function computeOxygenBalance(
  records: readonly ChemicalStepRecord[],
  mode: InventoryMode
): OxygenBalanceSummary {
  let consumption = 0;
  for (const record of records) {
    const o2Change = record.changes['o2'] ?? 0;
    if (o2Change < 0) {
      consumption += -o2Change;
    }
  }
  const production = 0;
  const stepUnits =
    mode === 'column_inventory'
      ? 'моль O₂ на м² атмосферного столба за шаг'
      : 'нормированные игровые единицы O₂ за шаг (абсолютное физическое количество неизвестно)';
  return {
    production,
    consumption,
    net: production - consumption,
    note:
      `дискретное изменение количества O₂ по переданным записям шага (${stepUnits}); ` +
      'производство по умолчанию нулевое — источники без подтверждённых численных скоростей не подключены; ' +
      'итог стехиометрического шага, а НЕ кинетическая скорость d(O₂)/dt.'
  };
}

// ============================================
// 7. РЕЕСТР ИСТОЧНИКОВ И СТОКОВ
// ============================================

/**
 * Реестр процессов обмена вещества. Все процессы по умолчанию
 * ОТКЛЮЧЕНЫ и не имеют численных скоростей: данных для них нет,
 * включение и настройка — явное решение пользователя/администратора.
 */
export function createDefaultProcessRegistry(): ChemicalProcess[] {
  const disabled = (
    id: string,
    name: string,
    substance: string[],
    direction: ChemicalProcess['direction'],
    timescaleNote: string,
    note: string
  ): ChemicalProcess => ({
    id,
    name,
    substance,
    direction,
    ratePerStep: null,
    enabled: false,
    timescaleNote,
    confidence: 'unknown',
    source: '',
    note
  });

  return [
    disabled('volcanic_outgassing', 'Вулканический выброс', ['co2', 'so2', 'h2o', 'h2'], 'source', 'геологические времена', 'мощность зависит от вулканической активности, которая количественно не моделируется'),
    disabled('geological_degassing', 'Геологическая дегазация', ['co2', 'n2', 'ch4'], 'source', 'миллионы лет', 'скорость дегазации недр не оценивается'),
    disabled('photochemical_production', 'Фотохимическое образование', ['o2', 'h2', 'co'], 'source', 'зависит от потока излучения', 'требует расчёта фотодиссоциации; поток известен лишь оценочно'),
    disabled('evaporation', 'Испарение', ['h2o', 'ch4', 'c2h6'], 'exchange', 'зависит от температуры и давления пара', 'обмен атмосферного и жидкого резервуаров; равновесие смеси не рассчитано'),
    disabled('condensation', 'Конденсация', ['h2o', 'ch4', 'c2h6'], 'exchange', 'зависит от температуры', 'обнаружен только потенциал конденсации; количество конденсата не рассчитано'),
    disabled('ocean_absorption', 'Поглощение океаном', ['co2', 'n2'], 'sink', 'зависит от растворимости', 'требуется модель растворимости газов'),
    disabled('rock_interaction', 'Взаимодействие с породами', ['co2', 'o2'], 'sink', 'выветривание: тысячи–миллионы лет', 'геохимическое выветривание количественно не моделируется'),
    disabled('burial', 'Захоронение', ['co2', 'ch4'], 'sink', 'миллионы лет', 'скорость осадконакопления неизвестна'),
    disabled('atmospheric_escape', 'Атмосферная утечка', ['h2', 'he'], 'sink', 'зависит от гравитации и температуры экзосферы', 'модель Джинса/гидродинамического убегания не реализована'),
    disabled('biological_o2_production', 'Биологическое производство O₂', ['o2'], 'source', 'только после появления жизни', 'заготовка на будущее: генератор ещё не создаёт кислородопроизводящие виды; процесс отключён и не добавляет O₂ автоматически'),
    disabled('biological_consumption', 'Биологическое потребление', ['o2', 'co2', 'ch4'], 'sink', 'только после появления жизни', 'заготовка на будущее: потребители не созданы')
  ];
}

// ============================================
// 8. ЭЛЕМЕНТНЫЕ ИТОГИ (ДЛЯ ПРОВЕРКИ СОХРАНЕНИЯ)
// ============================================

/**
 * Суммарное число атомов каждого элемента во всех резервуарах.
 * Вещества с неизвестным составом в подсчёт не входят и перечисляются
 * отдельно в note (обычно это инертные газы без реакций).
 */
export function elementTotalsOf(state: ChemicalEvolutionState): {
  totals: Record<string, number>;
  excludedSubstances: string[];
} {
  const totals: Record<string, number> = {};
  const excluded: string[] = [];

  const accumulate = (reservoir: Record<string, number>): void => {
    for (const [gasId, amount] of Object.entries(reservoir)) {
      const composition = getElementComposition(gasId);
      if (!composition) {
        if (!excluded.includes(gasId)) {
          excluded.push(gasId);
        }
        continue;
      }
      for (const [element, count] of Object.entries(composition.elements)) {
        totals[element] = (totals[element] ?? 0) + count * amount;
      }
    }
  };

  accumulate(state.reservoirs.atmospheric);
  accumulate(state.reservoirs.liquidSurface);
  accumulate(state.reservoirs.subsurfaceLiquid);
  accumulate(state.reservoirs.solidDeposits);

  return { totals, excludedSubstances: excluded };
}

/** Суммарное количество вещества по всем резервуарам (проверка сохранения). */
export function substanceTotalsOf(state: ChemicalEvolutionState): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const gasId of new Set([
    ...Object.keys(state.reservoirs.atmospheric),
    ...Object.keys(state.reservoirs.liquidSurface),
    ...Object.keys(state.reservoirs.subsurfaceLiquid),
    ...Object.keys(state.reservoirs.solidDeposits)
  ])) {
    totals[gasId] = totalSubstanceAmount(state.reservoirs, gasId);
  }
  return totals;
}

// ============================================
// 9. ПОЛНЫЙ ШАГ ХИМИЧЕСКОЙ ЭВОЛЮЦИИ МИРА
// ============================================

/**
 * Один шаг химической эволюции мира: применяет все реакции каталога
 * в стехиометрическом режиме с условиями мира.
 * Возвращает обновлённую копию мира (иммутабельно) и лог шага.
 */
export function runChemicalEvolutionStep(
  world: GeneratedWorld,
  options: ApplyReactionOptions = {}
): { world: GeneratedWorld; log: string[] } {
  const log: string[] = [];

  if (!world.chemicalState) {
    return {
      world,
      log: ['состояние химической эволюции отсутствует (старый мир или генерация без физической модели): шаг не выполнен']
    };
  }
  if (!world.atmospherePhysics) {
    return { world, log: ['физическая модель атмосферы отсутствует: шаг не выполнен'] };
  }

  let state: ChemicalEvolutionState = world.chemicalState;
  // Граница текущего глобального шага в истории: все записи с индексами
  // >= stepStartRecordIndex добавлены ЭТИМ вызовом и относятся к
  // текущему шагу. Кислородный баланс шага считается только по ним.
  const stepStartRecordIndex = state.history.length;

  const temperatureK = world.phaseAnalysis?.temperatureK ?? world.atmosphere.temperature ?? null;
  const surfacePressurePa = state.surfacePressurePa ?? world.atmospherePhysics.surfacePressurePa?.value ?? null;
  const pressureAtm = surfacePressurePa !== null ? paToAtm(surfacePressurePa) : null;

  // Доступность излучения: фотохимия выполняется только там,
  // где есть звёздный поток (или явно указанные радиационные источники).
  const incidentFlux = world.energyBudget?.incidentFlux?.value ?? null;
  const radiationAvailable =
    incidentFlux !== null || world.energySources.primary.includes('stellar_radiation');

  for (const reaction of chemicalReactions) {
    const result = applyReaction(state, reaction, {
      extentFraction: options.extentFraction ?? 0.1,
      temperatureK,
      pressureAtm,
      radiationAvailable
    });
    state = result.state;
    log.push(`[${reaction.id}] ${result.record.reason}`);
  }

  // Один вызов = ровно один глобальный шаг модельного времени
  // независимо от числа применённых реакций (ни одной, одна или
  // несколько): количество реакций не влияет на продолжительность
  // шага симуляции.
  state = {
    ...state,
    modelTimeYears: state.modelTimeYears + state.stepDurationYears
  };

  // Кислородный баланс — итог ИМЕННО ЭТОГО шага: записи, добавленные
  // текущим вызовом, явно выделяются и передаются в расчёт; расход
  // кислорода предыдущих шагов НЕ добавляется к текущему шагу.
  const stepRecords = state.history.slice(stepStartRecordIndex);
  const oxygen = computeOxygenBalance(stepRecords, state.mode);
  state = { ...state, oxygenBalance: oxygen };
  log.push(
    `кислородный баланс: производство ${oxygen.production.toFixed(6)}, потребление ${oxygen.consumption.toFixed(6)}, итог ${oxygen.net.toFixed(6)}`
  );

  return {
    world: { ...world, chemicalState: state },
    log
  };
}

// ============================================
// 10. ПОЛЬЗОВАТЕЛЬСКИЙ ШАГ ХИМИИ ЧЕРЕЗ SCHEDULER (STAGE 4.2.3.3)
// ============================================

/**
 * Идентификатор процесса «один шаг химической эволюции (режим A)»
 * в реестре процессов научного ядра. Процесс — ЯВНО ИНИЦИИРУЕМАЯ
 * дискретная операция (executionMode = 'explicit_only'): у реакций
 * каталога нет физически установленного характерного времени
 * (текстовые timescaleNote числом не являются), поэтому τ процесса
 * неизвестен и НЕ выдумывается; длительность модельного шага при
 * каждом запуске передаёт вызывающая сторона.
 */
export const CHEMICAL_EVOLUTION_STEP_PROCESS_ID = 'chemical_evolution_step';

/**
 * Реестр процессов с единственным explicit_only-процессом шага
 * химии. Дескриптор регистрируется стандартной валидацией
 * ProcessRegistry; числовое τ не назначается.
 */
export function createChemicalEvolutionStepRegistry(): ProcessRegistry {
  const descriptor: ProcessDescriptor = {
    id: CHEMICAL_EVOLUTION_STEP_PROCESS_ID,
    name: 'Шаг химической эволюции (режим A, стехиометрический)',
    processKind: 'chemical',
    tau: unknownValue(
      'характерное время реакций каталога неизвестно: экспериментальных кинетических данных нет; текстовые масштабы этапа 3 (timescaleNote) числом не являются и в τ не преобразуются'
    ),
    stepPolicy: {
      kind: 'unspecified',
      note: 'дискретный модельный шаг: длительность задаёт вызывающая сторона (stepDurationYears), эвристика dt ≤ τ/20 неприменима — τ неизвестно'
    },
    solverAvailability: 'available',
    enabled: true,
    executionMode: 'explicit_only',
    provenance: {
      sourceName: 'интеграция Stage 4.2.3.3: ChemicalEvolution (режим A) → Scheduler научного ядра',
      note: 'runtime-оператор применяет каталог chemicalReactions стехиометрически (extentFraction — игровое допущение)'
    },
    applicability: 'миры с ChemicalEvolutionState и физической моделью атмосферы',
    assumptions:
      'степень превращения за шаг — игровое допущение (extentFraction), не кинетический расчёт; длительность шага (stepDurationYears) — тоже игровое допущение',
    timescaleNote: 'реакции каталога не имеют подтверждённых характерных времён'
  };
  return createProcessRegistry().register(descriptor);
}

/** Результат пользовательского шага химии через Scheduler. */
export interface ChemicalEvolutionSchedulerStepResult {
  /** Новый мир при committed; ИСХОДНЫЙ мир без изменений при rejected. */
  world: GeneratedWorld;
  status: 'committed' | 'rejected';
  /** Лог шага (причины отказа включаются и в reason). */
  log: string[];
  /** Причина отказа; null при успехе. */
  reason: string | null;
}

/**
 * Один пользовательский шаг химической эволюции через атомарный
 * macro-шаг Scheduler научного ядра (Stage 4.2.3.3).
 *
 * Отличия от legacy-пути runChemicalEvolutionStep (который сохранён
 * как совместимый API и golden-база):
 * - физическое состояние живёт в CoreWorldState: ядро
 *   инициализируется адаптером ТОЛЬКО при отсутствии; существующее
 *   ядро — источник истины и легаси-проекцией НЕ перезаписывается
 *   (конфликт источников — контролируемый отказ с диагностикой);
 * - шаг выполняется ОДНИМ оператором ОДНОГО explicit_only-процесса
 *   через runMacroStep (snapshot-изоляция, append-only контракт
 *   журнала реакций, аудит инвариантов, продвижение часов ровно
 *   один раз);
 * - длительность Scheduler — stepDurationYears, переведённая в
 *   секунды зарегистрированной единицей юлианского года 'yr'
 *   (gameSpeedCoefficient не используется);
 * - фактически применённые реакции регистрируются в ReactionLedger
 *   ядра (extentBasis — основание режима инвентаря; для
 *   game_normalized это arbitrary_units: игровые единицы молями
 *   не объявляются); фиктивные записи для неприменённых реакций
 *   не создаются;
 * - после успешного commit GeneratedWorld.chemicalState —
 *   актуальная совместимая ПРОЕКЦИЯ состояния ядра, а не независимый
 *   источник физического состояния;
 * - численный результат идентичен legacy-расчёту на том же входе:
 *   тот же каталог, порядок применения, extentFraction, условия
 *   температуры/давления/излучения, лимитирующий реагент, элементный
 *   баланс, история и кислородный баланс шага.
 *
 * При отказе (guards, конфликт источников, ошибка оператора, аудит)
 * возвращается исходный мир без частичных изменений, часы не
 * двигаются, reason содержит причину.
 */
export function runChemicalEvolutionSchedulerStep(
  world: GeneratedWorld,
  options: ApplyReactionOptions = {}
): ChemicalEvolutionSchedulerStepResult {
  const log: string[] = [];
  const reject = (reason: string): ChemicalEvolutionSchedulerStepResult => ({
    world,
    status: 'rejected',
    log: [...log, reason],
    reason
  });

  if (!world.chemicalState) {
    return reject('состояние химической эволюции отсутствует (старый мир или генерация без физической модели): шаг не выполнен');
  }
  if (!world.atmospherePhysics) {
    return reject('физическая модель атмосферы отсутствует: шаг не выполнен');
  }
  const chemical = world.chemicalState;

  // Ядро: инициализация ТОЛЬКО при отсутствии. Существующее ядро —
  // источник физического состояния; перезапись его резервуаров
  // легаси-проекцией молча запрещена (контролируемый отказ).
  let core: CoreWorldState;
  if (world.coreWorldState === undefined || world.coreWorldState === null) {
    // Stage 4.2.4: инициализация ядра из легаси-состояния — часть
    // атомарности шага. Некорректный legacy-инвентарь (NaN, ∞,
    // отрицательные запасы) отклоняет шаг через reject, а не даёт
    // необработанное исключение: мир остаётся без частичных изменений.
    try {
      core = coreWorldStateFromLegacyWorld({
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
      chemicalState: chemical
    });
    } catch (error) {
      return reject(
        'инициализация научного ядра из легаси-состояния отклонена: ' +
          (error instanceof Error ? error.message : String(error))
      );
    }
    log.push(
      'научное ядро мира не было инициализировано: создано адаптером из легаси-состояния (все четыре химических резервуара перенесены без конверсии оснований)'
    );
  } else {
    core = world.coreWorldState;
    const issues = chemicalReservoirConsistencyIssues(core, chemical);
    if (issues.length > 0) {
      return reject(
        'резервуары научного ядра не согласованы с легаси-химическим состоянием: ' +
          issues.join('; ') +
          ' — существующее ядро НЕ перезаписывается легаси-проекцией, шаг не выполнен'
      );
    }
  }

  // Условия шага — идентичны legacy-пути runChemicalEvolutionStep.
  const temperatureK = world.phaseAnalysis?.temperatureK ?? world.atmosphere.temperature ?? null;
  const surfacePressurePa =
    chemical.surfacePressurePa ?? world.atmospherePhysics.surfacePressurePa?.value ?? null;
  const pressureAtm = surfacePressurePa !== null ? paToAtm(surfacePressurePa) : null;
  const incidentFlux = world.energyBudget?.incidentFlux?.value ?? null;
  const radiationAvailable =
    incidentFlux !== null || world.energySources.primary.includes('stellar_radiation');

  // Длительность macro-шага = stepDurationYears через
  // зарегистрированную единицу юлианского года (новых коэффициентов
  // и gameSpeedCoefficient нет).
  const durationS = convert(quantity(chemical.stepDurationYears, 'yr'), 's').value;
  if (!Number.isFinite(durationS) || durationS <= 0) {
    return reject(
      'длительность шага химической эволюции (' + String(chemical.stepDurationYears) +
        ' лет) непредставима положительными секундами: шаг не выполнен'
    );
  }

  const stepIndex = core.scheduling?.stepCount ?? 0;
  const basisWide = inventoryModeToBasis(chemical.mode);
  const basis: ReactionExtentBasis = basisWide === 'column_amount' ? 'column_amount' : 'arbitrary_units';
  const box: { chemical: ChemicalEvolutionState | null } = { chemical: null };

  // Runtime-оператор шага: применяет каталог реакций к рабочему
  // состоянию, собранному ИЗ резервуаров ядра, фиксирует результат
  // в резервуарах ядра и регистрирует фактически применённые
  // реакции в ReactionLedger. Часы НЕ двигает (это делает Scheduler
  // ровно один раз после аудита).
  const operator: ProcessOperator = {
    processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID,
    apply(coreWorld: CoreWorldState): CoreWorldState {
      const workingBase = chemicalStateFromCoreReservoirs(coreWorld, chemical);
      const stepStartRecordIndex = workingBase.history.length;
      let working = workingBase;
      const applied: Array<{ reaction: ChemicalReaction; extent: number; record: ChemicalStepRecord }> = [];
      for (const reaction of chemicalReactions) {
        const result = applyReaction(working, reaction, {
          extentFraction: options.extentFraction ?? 0.1,
          temperatureK,
          pressureAtm,
          radiationAvailable
        });
        working = result.state;
        log.push('[' + reaction.id + '] ' + result.record.reason);
        if (result.record.applied && result.record.extent !== null) {
          applied.push({ reaction, extent: result.record.extent, record: result.record });
        }
      }

      // Модельное время — ровно на один шаг; кислородный баланс —
      // только по записям ЭТОГО шага (семантика legacy-шага).
      working = {
        ...working,
        modelTimeYears: working.modelTimeYears + working.stepDurationYears
      };
      const stepRecords = working.history.slice(stepStartRecordIndex);
      working = { ...working, oxygenBalance: computeOxygenBalance(stepRecords, working.mode) };
      log.push(
        'кислородный баланс: производство ' + working.oxygenBalance.production.toFixed(6) +
        ', потребление ' + working.oxygenBalance.consumption.toFixed(6) +
        ', итог ' + working.oxygenBalance.net.toFixed(6)
      );

      // Проекция состояния ядра для существующего UI.
      box.chemical = working;

      // Атмосферный резервуар ядра — результат шага.
      // Stage 4.2.4: явные нули сохраняются (нулевой запас — известное
      // значение); повреждённые значения здесь невозможны: working
      // прошёл валидацию адаптера при переносе в ядро.
      const atmosphereEntries = Object.fromEntries(
        Object.entries(working.inventory).filter(([, v]) => Number.isFinite(v) && v >= 0)
      );
      // ReactionLedger: только ФАКТИЧЕСКИ применённые реакции;
      // id уникальны по (stepIndex, reactionId).
      let ledger = coreWorld.reactionLedger ?? { records: [] };
      const reactionTime = {
        segmentIndex: coreWorld.clock.segmentIndex,
        localTimeS: coreWorld.clock.localTimeS
      };
      for (const { reaction, extent } of applied) {
        ledger = registerReaction(ledger, {
          id: 'chemical-evolution-step:' + String(stepIndex) + ':' + reaction.id,
          reactionId: reaction.id,
          reactants: reaction.reactants.map((p) => ({
            reservoirId: CHEMICAL_RESERVOIR_IDS.atmospheric,
            speciesId: p.gasId,
            coefficient: p.coefficient
          })),
          products: reaction.products.map((p) => ({
            reservoirId: CHEMICAL_RESERVOIR_IDS.atmospheric,
            speciesId: p.gasId,
            coefficient: p.coefficient
          })),
          extent,
          extentBasis: basis,
          time: reactionTime,
          processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID,
          note:
            'режим A (стехиометрический): степень превращения — игровое допущение (extentFraction), не кинетический расчёт' +
            (basis === 'arbitrary_units'
              ? '; основание arbitrary_units — нормированные игровые единицы, НЕ моли'
              : '')
        });
      }
      const reservoirs: ReservoirRecord[] = coreWorld.reservoirs.map((res) => {
        if (res.id !== CHEMICAL_RESERVOIR_IDS.atmospheric) return res;
        return setMaterialInventory(res, basisWide, atmosphereEntries);
      });
      return { ...coreWorld, reservoirs, reactionLedger: ledger };
    }
  };

  // Один явный оператор — один runMacroStep (повторный запуск химии
  // внутри одного macro-шага невозможен по построению).
  let result: MacroStepResult;
  try {
    result = runMacroStep(core, createChemicalEvolutionStepRegistry(), [operator], {
      durationS,
      splitting: 'lie',
      processIds: [CHEMICAL_EVOLUTION_STEP_PROCESS_ID],
      explicit: { processId: CHEMICAL_EVOLUTION_STEP_PROCESS_ID },
      audit: {
        speciesCatalog: buildSpeciesCatalogFromLegacy(gases, elementCompositions),
        boundary: 'complete'
      }
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return reject('шаг химической эволюции отклонён планировщиком: ' + reason);
  }
  if (result.status !== 'committed') {
    return reject('шаг химической эволюции отклонён: ' + result.diagnostics.join('; '));
  }

  // Commit: мир обновляется; chemicalState — актуальная совместимая
  // проекция состояния ядра (а не независимый источник).
  const chemicalAfter = box.chemical ?? chemical;
  return {
    world: { ...world, coreWorldState: result.world, chemicalState: chemicalAfter },
    status: 'committed',
    log,
    reason: null
  };
}

// Все функции экспортированы непосредственно в своих определениях.

export default {
  isReactionBalanced,
  createChemicalState,
  applyReaction,
  runKineticStep,
  computeOxygenBalance,
  createDefaultProcessRegistry,
  elementTotalsOf,
  substanceTotalsOf,
  runChemicalEvolutionStep,
  runChemicalEvolutionSchedulerStep,
  createChemicalEvolutionStepRegistry,
  CHEMICAL_EVOLUTION_STEP_PROCESS_ID,
  runConcentrationKineticStep,
  runKineticCompartmentStep,
  runKineticCompartmentTrajectory,
  runWorldKineticTrajectory,
  resetWorldKineticExperiment,
  kineticExperimentStateProblems,
  KINETIC_EXPERIMENT_SCHEMA_VERSION,
  KINETIC_EXPERIMENT_SPECIES
};
