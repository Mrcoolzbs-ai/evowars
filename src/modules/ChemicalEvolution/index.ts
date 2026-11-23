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
// - режим A остаётся игровым стехиометрическим сценарием; физический
//   режим B доступен только для двух механистических записей (#89/#106)
//   с явными реакционными слоями, геометрией, температурой, запасами и
//   provenance в основном ChemicalEvolutionState. Для остальных реакций
//   rates остаются неизвестными и не автоматизируются;
// - кислородный баланс: дискретное количество O₂ за один глобальный
//   стехиометрический шаг (column_inventory — моль O₂/м² за шаг,
//   game_normalized — нормированные игровые единицы за шаг);
//   производство по умолчанию нулевое; физическая кинетика ведётся
//   отдельным Scheduler-процессом и не подменяет этот игровой баланс;
// - реестр источников и стоков (все отключены по умолчанию).

import type {
  AtmospherePhysicalModel,
  ChemicalEvolutionState,
  ChemicalPhysicalKineticsState,
  ChemicalPhysicalKineticLayer,
  ChemicalPhysicalKineticsStepAudit,
  ChemicalKineticLayerStepAudit,
  ChemicalKineticReactionAudit,
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
  chemicalProcessesToCoreDescriptors,
  chemicalReservoirConsistencyIssues,
  chemicalStateFromCoreReservoirs,
  coreWorldStateFromLegacyWorld,
  inventoryModeToBasis
} from '../Core/adapters';
import { createProcessRegistry } from '../Core/processRegistry';
import type { ProcessDescriptor, ProcessRegistry } from '../Core/processRegistry';
import type { MacroStepResult, ProcessOperator, ProcessStepProposal } from '../Core/scheduler';
import { runMacroStep } from '../Core/scheduler';
import type { ReactionExtentBasis, ReactionRecord } from '../Core/reactionLedger';
import { registerReaction } from '../Core/reactionLedger';
import { convert, quantity } from '../Core/physicalQuantity';
import { unknownValue } from '../Core/scientificValue';
import type { CoreWorldState } from '../Core/worldState';
import type { MaterialInventory, ReservoirRecord } from '../Core/reservoir';
import { setMaterialInventory, validateMaterialInventory } from '../Core/reservoir';
import type { ScientificSpecies } from '../Core/species';

// Stage 4.5.5 (первый реализационный срез, 2026-11-10): концентрационный
// кинетический механизм ограниченного состава (записи каталога №89/№106,
// known) — отдельный STATELESS API поверх явного вектора концентраций
// molecule/cm³. Режим A (applyReaction/runChemicalEvolutionStep) и
// заглушка runKineticStep НЕ меняются: механизм НЕ подключён к состоянию
// мира (конверсия inventory в концентрации невозможна без физического
// контракта атмосферного столба, которого в проекте нет).
import {
  buildConcentrationKineticProblem,
  MECHANISM_REACTIONS,
  runConcentrationKineticStep
} from './kineticMechanism';
import type { AppliedReactionSummary, MechanismReactionDef } from './kineticMechanism';

export * from './kineticMechanism';

// Stage 4.5.5 (второй реализационный срез, 2026-11-10): физически явный
// реакционный слой (компартмент) поверх концентрационного механизма —
// stateless-адаптер runKineticCompartmentStep между ЯВНЫМ столбовым
// инвентарём (моль/м²) и ЯВНО заданной толщиной однородного слоя (м);
// толщина слоя НЕ выводится из параметров мира, N₂ передаётся явно.
// К состоянию мира (GeneratedWorld/ChemicalEvolutionState/
// runChemicalEvolutionStep) НЕ подключён; режим A и заглушка runKineticStep
// НЕ меняются.
import {
  columnInventoryMolM2ToConcentrationMoleculeCm3,
  runKineticCompartmentStep
} from './kineticCompartment';

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
  /**
   * Опциональная конфигурация физической химической кинетики основного
   * ChemicalEvolutionState. Она не создаётся из пресета автоматически:
   * слои/толщина/температура/подстолбовые запасы должны быть заданы явно.
   */
  physicalKinetics?: ChemicalPhysicalKineticsState;
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
    ...(input.physicalKinetics === undefined
      ? {}
      : {
          physicalKinetics: {
            maximumMacroStepS: input.physicalKinetics.maximumMacroStepS,
            totalInventoryProvenance: Object.fromEntries(
              Object.entries(input.physicalKinetics.totalInventoryProvenance).map(([speciesId, provenance]) => [
                speciesId,
                { ...provenance }
              ])
            ),
            layers: input.physicalKinetics.layers.map((layer) => ({
              ...layer,
              thicknessProvenance: { ...layer.thicknessProvenance },
              temperatureProvenance: { ...layer.temperatureProvenance },
              inventoryProvenance: { ...layer.inventoryProvenance },
              columnInventoriesMolM2: { ...layer.columnInventoriesMolM2 },
              reactionIds: [...layer.reactionIds]
            }))
          },
          physicalKineticsHistory: []
        }),
    oxygenBalance: {
      production: 0,
      consumption: 0,
      net: 0,
      note: 'баланс последнего ЗАВЕРШЁННОГО глобального шага; до первого шага — нулевой. Биологическое производство O₂ по умолчанию равно нулю: генератор ещё не создаёт живые виды; структура позволяет подключить кислородопроизводителей в будущем'
    },
    notes: [
      `длительность шага — ${stepDurationYears} лет: игровое допущение, а не рассчитанное время`,
      'скорости реакций задаются степенью превращения за шаг (режим A) и являются игровым предположением',
      input.physicalKinetics === undefined
        ? 'кинетический режим B недоступен: у реакций каталога нет проверенных кинетических констант'
        : 'физическая кинетика включается только при явно заданной конфигурации слоёв; отсутствие конфигурации не создаёт кинетических условий автоматически'
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
export const PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID = 'physical_chemical_kinetics';

/**
 * Реестр процессов с единственным explicit_only-процессом шага
 * химии. Дескриптор регистрируется стандартной валидацией
 * ProcessRegistry; числовое τ не назначается.
 */
function createPhysicalChemicalKineticsDescriptor(): ProcessDescriptor {
  return {
    id: PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID,
    name: 'Физическая химическая кинетика атмосферных слоёв',
    processKind: 'chemical',
    tau: unknownValue('постоянное τ неприменимо: локальное характерное время вычисляется из кинетического RHS текущего состояния'),
    stepPolicy: {
      kind: 'unspecified',
      note: 'state-dependent: runtime оператор выбирает dt ≤ min(запрошенного максимума, локальное время истощения/20)'
    },
    solverAvailability: 'available',
    enabled: true,
    executionMode: 'state_dependent',
    provenance: {
      sourceName: 'Production ChemicalEvolutionState kinetic layer contract',
      reference: 'src/modules/ChemicalEvolution/index.ts',
      note: 'скорости и их источники берутся только из проверенного каталога кинетического механизма; конфигурация слоёв и начальные запасы задаются явно'
    },
    applicability: 'только column_inventory с явно заданными слоями, температурой, толщиной, подстолбовыми запасами и provenance',
    assumptions: 'каждый слой однороден и изотермичен; перенос между слоями/диффузия/конвекция/пополнение не моделируются; недостающие виды не трактуются как ноль'
  };
}

/**
 * Реестр прежнего режима A и легаси-процессов. Состав намеренно
 * сохранён для legacy/golden совместимости.
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
  const registry = createProcessRegistry();
  for (const legacyDescriptor of chemicalProcessesToCoreDescriptors(createDefaultProcessRegistry())) {
    registry.register(legacyDescriptor);
  }
  return registry.register(descriptor);
}

/** Реестр физического пути: legacy-процессы + отдельный state-dependent процесс. */
export function createPhysicalChemicalEvolutionStepRegistry(): ProcessRegistry {
  return createChemicalEvolutionStepRegistry().register(createPhysicalChemicalKineticsDescriptor());
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
  /** Фактический динамический шаг Scheduler для физических кинетических вызовов. */
  stepSize?: MacroStepResult['stepSize'];
}


/**
 * Канонические имена видов ограниченного кинетического механизма
 * переводятся в ID основного атмосферного ChemicalEvolution inventory.
 * Существующие o2/n2 остаются теми же видами; радикалы получают
 * отдельные lower-case ID и не добавляются в генератор preset-газов.
 */
const MECHANISM_TO_CHEMICAL_SPECIES: Readonly<Record<string, string>> = {
  O: 'o',
  NO: 'no',
  NO2: 'no2',
  H: 'h',
  O2: 'o2',
  HO2: 'ho2',
  N2: 'n2'
};

const CHEMICAL_TO_MECHANISM_SPECIES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(MECHANISM_TO_CHEMICAL_SPECIES).map(([mechanismId, chemicalId]) => [chemicalId, mechanismId])
);

function isPlainChemicalRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Для физических входов нужен явно идентифицируемый источник происхождения. */
function hasIdentifiedPhysicalProvenance(value: unknown): boolean {
  if (!isPlainChemicalRecord(value)) return false;
  return ['sourceName', 'sourceId', 'datasetId', 'reference'].some((key) => {
    const candidate = value[key];
    return typeof candidate === 'string' && candidate.trim() !== '';
  });
}

/**
 * Проверка primary-state конфигурации. Отсутствующий вид никогда не
 * дополняется нулём; общий атмосферный инвентарь обязан покрывать сумму
 * явно указанных подстолбовых запасов всех реакционных слоёв.
 */
function physicalChemicalKineticsConfigurationProblems(state: ChemicalEvolutionState): string[] {
  const problems: string[] = [];
  if (state.mode !== 'column_inventory') {
    problems.push('физическая кинетика требует mode=column_inventory; arbitrary_units не преобразуются в молекулярные концентрации');
  }
  const config = state.physicalKinetics as ChemicalPhysicalKineticsState | undefined;
  if (config === undefined || !isPlainChemicalRecord(config)) {
    return [...problems, 'physicalKinetics отсутствует или не является plain object'];
  }
  if (
    typeof config.maximumMacroStepS !== 'number' ||
    !Number.isFinite(config.maximumMacroStepS) ||
    config.maximumMacroStepS <= 0
  ) {
    problems.push('physicalKinetics.maximumMacroStepS должен быть конечным положительным числом секунд');
  }
  if (!isPlainChemicalRecord(config.totalInventoryProvenance)) {
    problems.push('physicalKinetics.totalInventoryProvenance должен содержать provenance полных атмосферных запасов');
  }
  if (!Array.isArray(config.layers) || config.layers.length === 0) {
    problems.push('physicalKinetics.layers должен содержать хотя бы один явно заданный реакционный слой');
    return problems;
  }

  const seenLayerIds = new Set<string>();
  const subcolumnTotals: Record<string, number> = {};
  const altitudeRanges: Array<{ layerId: string; min: number; max: number }> = [];
  for (let layerIndex = 0; layerIndex < config.layers.length; layerIndex++) {
    const layer = config.layers[layerIndex] as ChemicalPhysicalKineticLayer;
    const prefix = 'physicalKinetics.layers[' + layerIndex + ']';
    if (!isPlainChemicalRecord(layer)) {
      problems.push(prefix + ' должен быть plain object');
      continue;
    }
    if (typeof layer.layerId !== 'string' || layer.layerId.trim() === '') {
      problems.push(prefix + '.layerId должен быть непустой строкой');
    } else if (seenLayerIds.has(layer.layerId)) {
      problems.push(prefix + ': повторный layerId «' + layer.layerId + '»');
    } else {
      seenLayerIds.add(layer.layerId);
    }
    if (
      typeof layer.layerThicknessM !== 'number' ||
      !Number.isFinite(layer.layerThicknessM) ||
      layer.layerThicknessM <= 0
    ) {
      problems.push(prefix + '.layerThicknessM должен быть конечной положительной геометрической толщиной в метрах');
    }
    if (!hasIdentifiedPhysicalProvenance(layer.thicknessProvenance)) {
      problems.push(prefix + '.thicknessProvenance обязан идентифицировать источник толщины');
    }
    if (layer.altitudeRangeM !== undefined) {
      if (!isPlainChemicalRecord(layer.altitudeRangeM)) {
        problems.push(prefix + '.altitudeRangeM должен быть объектом {min, max}');
      } else {
        const min = layer.altitudeRangeM.min;
        const max = layer.altitudeRangeM.max;
        if (typeof min !== 'number' || !Number.isFinite(min) || min < 0) {
          problems.push(prefix + '.altitudeRangeM.min должен быть конечной неотрицательной высотой в метрах');
        }
        if (typeof max !== 'number' || !Number.isFinite(max) || max <= (typeof min === 'number' ? min : 0)) {
          problems.push(prefix + '.altitudeRangeM.max должен быть конечной высотой в метрах строго выше min');
        }
        if (
          typeof min === 'number' && Number.isFinite(min) && min >= 0 &&
          typeof max === 'number' && Number.isFinite(max) && max > min
        ) {
          altitudeRanges.push({ layerId: layer.layerId, min, max });
          if (
            typeof layer.layerThicknessM === 'number' &&
            Number.isFinite(layer.layerThicknessM) &&
            layer.layerThicknessM > 0
          ) {
            const geometryToleranceM = 1e-8 * Math.max(1, Math.abs(min), Math.abs(max), layer.layerThicknessM);
            if (Math.abs((max - min) - layer.layerThicknessM) > geometryToleranceM) {
              problems.push(
                prefix + ': геометрическая толщина ' + layer.layerThicknessM +
                ' м не согласована с altitudeRangeM (' + min + '–' + max +
                ' м); толщина должна равняться max - min'
              );
            }
          }
        }
      }
      if (!hasIdentifiedPhysicalProvenance(layer.altitudeProvenance)) {
        problems.push(prefix + '.altitudeProvenance обязан идентифицировать источник высотных границ');
      }
    } else if (layer.altitudeProvenance !== undefined) {
      problems.push(prefix + '.altitudeProvenance задан без altitudeRangeM');
    }
    if (
      typeof layer.temperatureK !== 'number' ||
      !Number.isFinite(layer.temperatureK) ||
      layer.temperatureK <= 0
    ) {
      problems.push(prefix + '.temperatureK должен быть конечной положительной температурой в K');
    }
    if (!hasIdentifiedPhysicalProvenance(layer.temperatureProvenance)) {
      problems.push(prefix + '.temperatureProvenance обязан идентифицировать источник локальной температуры');
    }
    if (!hasIdentifiedPhysicalProvenance(layer.inventoryProvenance)) {
      problems.push(prefix + '.inventoryProvenance обязан идентифицировать источник подстолбовых запасов');
    }

    const selected: MechanismReactionDef[] = [];
    if (!Array.isArray(layer.reactionIds) || layer.reactionIds.length === 0) {
      problems.push(prefix + '.reactionIds должен быть непустым списком параметризованных реакций');
    } else {
      const seenReactionIds = new Set<string>();
      for (const reactionId of layer.reactionIds) {
        if (typeof reactionId !== 'string' || reactionId.trim() === '') {
          problems.push(prefix + '.reactionIds содержит пустой или нестроковый ID');
          continue;
        }
        if (seenReactionIds.has(reactionId)) {
          problems.push(prefix + '.reactionIds содержит дубликат «' + reactionId + '»');
          continue;
        }
        seenReactionIds.add(reactionId);
        const definition = MECHANISM_REACTIONS.find((entry) => entry.reactionId === reactionId);
        if (definition === undefined) {
          problems.push(prefix + ': реакция «' + reactionId + '» не имеет включённого механистического rate law');
        } else {
          selected.push(definition);
        }
      }
    }

    if (!isPlainChemicalRecord(layer.columnInventoriesMolM2)) {
      problems.push(prefix + '.columnInventoriesMolM2 должен быть plain object');
      continue;
    }
    for (const [speciesId, amount] of Object.entries(layer.columnInventoriesMolM2)) {
      if (!Object.prototype.hasOwnProperty.call(CHEMICAL_TO_MECHANISM_SPECIES, speciesId)) {
        problems.push(prefix + ': неизвестный или неподдерживаемый chemical species ID «' + speciesId + '»');
        continue;
      }
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        problems.push(prefix + ': запас «' + speciesId + '» должен быть конечным неотрицательным числом моль/м² (ноль допустим явно)');
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(state.inventory, speciesId)) {
        problems.push(prefix + ': основной ChemicalEvolutionState.inventory не содержит явный ключ «' + speciesId + '» (отсутствие не является нулём)');
      } else {
        const globalAmount = state.inventory[speciesId];
        if (typeof globalAmount !== 'number' || !Number.isFinite(globalAmount) || globalAmount < 0) {
          problems.push('основной атмосферный инвентарь вида «' + speciesId + '» повреждён');
        }
      }
      const totalProvenance = isPlainChemicalRecord(config.totalInventoryProvenance)
        ? config.totalInventoryProvenance[speciesId]
        : undefined;
      if (!hasIdentifiedPhysicalProvenance(totalProvenance)) {
        problems.push(prefix + ': отсутствует provenance полного атмосферного запаса вида «' + speciesId + '»');
      }
      subcolumnTotals[speciesId] = (subcolumnTotals[speciesId] ?? 0) + amount;
    }

    const required = new Set<string>(['N2']);
    for (const definition of selected) {
      for (const mechanismSpeciesId of definition.species) required.add(mechanismSpeciesId);
    }
    for (const mechanismSpeciesId of required) {
      const chemicalId = MECHANISM_TO_CHEMICAL_SPECIES[mechanismSpeciesId];
      if (
        chemicalId === undefined ||
        !Object.prototype.hasOwnProperty.call(layer.columnInventoriesMolM2, chemicalId)
      ) {
        problems.push(prefix + ': отсутствует явный подстолбовой запас вида «' + (chemicalId ?? mechanismSpeciesId) + '»; неизвестное значение не заменяется нулём');
      }
    }
    // Для используемых fall-off механизмов N2 — явно заданное третье
    // тело в законе скорости, не факультативный фон. Нулевой запас
    // не даёт определённой физической концентрации M и должен быть
    // отклонён на входе, а не позднее внутри ODE solver.
    if (
      Object.prototype.hasOwnProperty.call(layer.columnInventoriesMolM2, 'n2') &&
      layer.columnInventoriesMolM2.n2 <= 0
    ) {
      problems.push(prefix + ': запас третьего тела N₂ должен быть строго положительным для выбранной кинетической сети');
    }
  }

  if (config.layers.length > 1 && altitudeRanges.length !== config.layers.length) {
    problems.push('многослойная физическая кинетика требует altitudeRangeM и altitudeProvenance для каждого слоя; без абсолютных высот нельзя проверить вертикальное неперекрытие');
  }
  if (altitudeRanges.length > 0 && altitudeRanges.length !== config.layers.length) {
    problems.push('altitudeRangeM должен быть задан либо для всех реакционных слоёв, либо ни для одного');
  }
  altitudeRanges.sort((a, b) => a.min - b.min || a.max - b.max || a.layerId.localeCompare(b.layerId));
  for (let index = 1; index < altitudeRanges.length; index++) {
    const previous = altitudeRanges[index - 1]!;
    const current = altitudeRanges[index]!;
    if (current.min < previous.max) {
      problems.push(
        'слои «' + previous.layerId + '» и «' + current.layerId +
        '» перекрываются по высоте (' + current.min + ' м < ' + previous.max + ' м)'
      );
    }
  }

  for (const [speciesId, subcolumnAmount] of Object.entries(subcolumnTotals)) {
    const globalAmount = state.inventory[speciesId];
    if (typeof globalAmount !== 'number' || !Number.isFinite(globalAmount) || globalAmount < 0) continue;
    const tolerance = 1e-12 * Math.max(Math.abs(globalAmount), Math.abs(subcolumnAmount), Number.MIN_VALUE);
    if (subcolumnAmount > globalAmount + tolerance) {
      problems.push(
        'сумма реакционных подстолбов вида «' + speciesId + '» (' + subcolumnAmount +
        ' моль/м²) превышает основной атмосферный инвентарь (' + globalAmount + ' моль/м²)'
      );
    }
  }
  return problems;
}

export interface ConfigurePrimaryPhysicalChemicalKineticsResult {
  status: 'configured' | 'rejected';
  /** On rejection this is the original object and is not mutated. */
  state: ChemicalEvolutionState;
  diagnostics: readonly string[];
}

/**
 * Public, fail-closed configuration entry point for the primary physical
 * chemistry state. Caller supplies independently sourced total column
 * amounts for new/updated species; the function never manufactures them.
 * Layer subcolumn amounts must remain ≤ their corresponding global totals.
 */
export function configurePrimaryPhysicalChemicalKinetics(
  state: ChemicalEvolutionState,
  config: ChemicalPhysicalKineticsState,
  totalColumnInventoriesMolM2: Readonly<Record<string, number>>
): ConfigurePrimaryPhysicalChemicalKineticsResult {
  const diagnostics: string[] = [];
  if (state.mode !== 'column_inventory') {
    return {
      status: 'rejected',
      state,
      diagnostics: ['physical chemistry requires column_inventory; normalized game inventory cannot be converted to molecules/cm³']
    };
  }
  if (!isPlainChemicalRecord(totalColumnInventoriesMolM2)) {
    return {
      status: 'rejected',
      state,
      diagnostics: ['totalColumnInventoriesMolM2 must be a plain object of explicitly supplied mol/m² values']
    };
  }
  const additions: Record<string, number> = {};
  for (const [speciesId, amount] of Object.entries(totalColumnInventoriesMolM2)) {
    if (!Object.prototype.hasOwnProperty.call(CHEMICAL_TO_MECHANISM_SPECIES, speciesId)) {
      diagnostics.push('unsupported physical chemical species ID «' + speciesId + '»');
      continue;
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      diagnostics.push('total column amount for «' + speciesId + '» must be finite and non-negative mol/m²; zero must be explicit');
      continue;
    }
    additions[speciesId] = amount;
  }
  if (diagnostics.length > 0) {
    return { status: 'rejected', state, diagnostics };
  }

  const inventory = { ...state.inventory, ...additions };
  const baseCandidate: ChemicalEvolutionState = {
    ...state,
    inventory,
    reservoirs: {
      ...state.reservoirs,
      atmospheric: { ...state.reservoirs.atmospheric, ...inventory }
    },
    // Validate the caller-owned config before cloning nested values.
    physicalKinetics: config,
    physicalKineticsHistory: [...(state.physicalKineticsHistory ?? [])]
  };
  const configProblems = physicalChemicalKineticsConfigurationProblems(baseCandidate);
  if (configProblems.length > 0) {
    return {
      status: 'rejected',
      state,
      diagnostics: configProblems
    };
  }
  const candidate: ChemicalEvolutionState = {
    ...baseCandidate,
    physicalKinetics: {
      maximumMacroStepS: config.maximumMacroStepS,
      totalInventoryProvenance: Object.fromEntries(
        Object.entries(config.totalInventoryProvenance).map(([speciesId, provenance]) => [
          speciesId,
          { ...provenance }
        ])
      ),
      layers: config.layers.map((layer) => ({
        ...layer,
        thicknessProvenance: { ...layer.thicknessProvenance },
        temperatureProvenance: { ...layer.temperatureProvenance },
        inventoryProvenance: { ...layer.inventoryProvenance },
        columnInventoriesMolM2: { ...layer.columnInventoriesMolM2 },
        reactionIds: [...layer.reactionIds]
      }))
    }
  };
  recomputeFractions(candidate);
  // The mechanism includes neutral radicals whose molar masses are not
  // present in the primary gas catalog. Never retain stale pressure.
  if (candidate.meanMolarMassKgMol === null) {
    candidate.surfacePressurePa = null;
    candidate.notes = [
      ...candidate.notes,
      'поверхностное давление сброшено в unknown: физический инвентарь содержит виды с неизвестной молярной массой'
    ];
  }
  return {
    status: 'configured',
    state: candidate,
    diagnostics: ['physicalKinetics configured from explicit, provenance-backed layer inputs; no rates, species inventories or geometry were inferred']
  };
}

function mechanismInventoriesFromChemicalLayer(
  layer: ChemicalPhysicalKineticLayer
): Record<string, number> {
  const inventories: Record<string, number> = {};
  for (const [chemicalId, amount] of Object.entries(layer.columnInventoriesMolM2)) {
    const mechanismId = CHEMICAL_TO_MECHANISM_SPECIES[chemicalId];
    if (mechanismId === undefined) {
      throw new Error('неподдерживаемый species ID реакционного слоя: ' + chemicalId);
    }
    inventories[mechanismId] = amount;
  }
  return inventories;
}

function mechanismConcentrationsFromChemicalLayer(
  layer: ChemicalPhysicalKineticLayer
): Record<string, number> {
  const concentrations: Record<string, number> = {};
  for (const [mechanismId, inventory] of Object.entries(mechanismInventoriesFromChemicalLayer(layer))) {
    concentrations[mechanismId] = columnInventoryMolM2ToConcentrationMoleculeCm3(
      inventory,
      layer.layerThicknessM
    );
  }
  return concentrations;
}

/**
 * State-dependent timestep из реального начального RHS каждой конфигурации
 * слоя. Используется только численный safety policy dt ≤ τ_local/20;
 * τ_local вычисляется как n/|dn/dt| для реально истощающихся реагентов.
 * Если ни один вид не истощается, постоянное время не выдумывается —
 * используется только явно заданный максимум macro шага.
 */
function proposePhysicalChemicalStep(
  state: ChemicalEvolutionState,
  requestedMaximumDurationS: number
): ProcessStepProposal {
  const config = state.physicalKinetics;
  if (config === undefined) {
    throw new Error('physicalKinetics отсутствует в основном химическом состоянии');
  }
  const timescales: Array<{ layerId: string; speciesId: string; characteristicTimeS: number }> = [];
  const diagnostics: string[] = [];
  for (const layer of config.layers) {
    const built = buildConcentrationKineticProblem({
      temperatureK: layer.temperatureK,
      dtSeconds: requestedMaximumDurationS,
      reactionIds: [...layer.reactionIds],
      concentrations: mechanismConcentrationsFromChemicalLayer(layer)
    });
    const derivative = built.problem.rhs(built.problem.t0, built.problem.y0);
    if (!Array.isArray(derivative) || derivative.length !== built.speciesOrder.length) {
      throw new Error('кинетический RHS вернул вектор неверной размерности для слоя «' + layer.layerId + '»');
    }
    for (let index = 0; index < derivative.length; index++) {
      const value = derivative[index];
      const initial = built.problem.y0[index];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('кинетический RHS вернул неконечную производную для слоя «' + layer.layerId + '»');
      }
      if (initial > 0 && value < 0) {
        const characteristicTimeS = initial / -value;
        if (!Number.isFinite(characteristicTimeS) || characteristicTimeS <= 0) {
          throw new Error('локальное характерное время истощения непредставимо для слоя «' + layer.layerId + '»');
        }
        timescales.push({
          layerId: layer.layerId,
          speciesId: built.speciesOrder[index],
          characteristicTimeS
        });
      }
    }
    diagnostics.push(
      'слой «' + layer.layerId + '»: RHS рассчитан при T=' + layer.temperatureK +
      ' K; явная толщина=' + layer.layerThicknessM + ' м'
    );
  }

  if (timescales.length === 0) {
    return {
      durationS: requestedMaximumDurationS,
      method: 'explicit maximum macro-step; no initially depleting reactant',
      diagnostics: [
        ...diagnostics,
        'ни один реагент не имеет положительного текущего истощения: числовое τ не назначено, используется только maximumMacroStepS'
      ]
    };
  }

  timescales.sort((a, b) =>
    a.characteristicTimeS - b.characteristicTimeS ||
    a.layerId.localeCompare(b.layerId) ||
    a.speciesId.localeCompare(b.speciesId)
  );
  const limiting = timescales[0]!;
  const durationS = Math.min(requestedMaximumDurationS, limiting.characteristicTimeS / 20);
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new Error('локальная оценка dt=τ/20 не представима конечным положительным числом секунд');
  }
  return {
    durationS,
    method: 'minimum local reactant depletion time / 20',
    characteristicTimeS: limiting.characteristicTimeS,
    diagnostics: [
      ...diagnostics,
      'ограничивающий реагент: ' + limiting.speciesId + ' в слое «' + limiting.layerId +
        '»; τ_local=' + limiting.characteristicTimeS + ' s; выбран dt=' + durationS + ' s'
    ]
  };
}

/** Дополнительные радикальные виды для Conservation/ReactionLedger аудита. */
function physicalKineticSpeciesCatalog() {
  const catalog = buildSpeciesCatalogFromLegacy(gases, elementCompositions);
  const radicals: ScientificSpecies[] = [
    {
      id: 'o', formula: 'O', name: 'атомарный кислород',
      elements: { O: 1 }, charge: 0, phase: 'gas',
      molarMassKgMol: null, molarMassStatus: 'unknown', dataStatus: 'known',
      provenance: {
        sourceName: 'типизированная стехиометрия механизма Stage 4.5.5',
        sourceId: 'src/modules/ChemicalEvolution/kineticMechanism.ts',
        recordId: 'species:O',
        note: 'молярная масса намеренно не задаётся; элементный состав следует из формулы механизма'
      },
      note: 'радикал; термодинамические свойства и молярная масса не заявлены'
    },
    {
      id: 'no', formula: 'NO', name: 'оксид азота',
      elements: { N: 1, O: 1 }, charge: 0, phase: 'gas',
      molarMassKgMol: null, molarMassStatus: 'unknown', dataStatus: 'known',
      provenance: {
        sourceName: 'типизированная стехиометрия механизма Stage 4.5.5',
        sourceId: 'src/modules/ChemicalEvolution/kineticMechanism.ts',
        recordId: 'species:NO',
        note: 'молярная масса намеренно не задаётся; элементный состав следует из формулы механизма'
      },
      note: 'реакционноспособный вид; термодинамические свойства и молярная масса не заявлены'
    },
    {
      id: 'no2', formula: 'NO2', name: 'диоксид азота',
      elements: { N: 1, O: 2 }, charge: 0, phase: 'gas',
      molarMassKgMol: null, molarMassStatus: 'unknown', dataStatus: 'known',
      provenance: {
        sourceName: 'типизированная стехиометрия механизма Stage 4.5.5',
        sourceId: 'src/modules/ChemicalEvolution/kineticMechanism.ts',
        recordId: 'species:NO2',
        note: 'молярная масса намеренно не задаётся; элементный состав следует из формулы механизма'
      },
      note: 'реакционноспособный вид; термодинамические свойства и молярная масса не заявлены'
    },
    {
      id: 'h', formula: 'H', name: 'атомарный водород',
      elements: { H: 1 }, charge: 0, phase: 'gas',
      molarMassKgMol: null, molarMassStatus: 'unknown', dataStatus: 'known',
      provenance: {
        sourceName: 'типизированная стехиометрия механизма Stage 4.5.5',
        sourceId: 'src/modules/ChemicalEvolution/kineticMechanism.ts',
        recordId: 'species:H',
        note: 'молярная масса намеренно не задаётся; элементный состав следует из формулы механизма'
      },
      note: 'радикал; термодинамические свойства и молярная масса не заявлены'
    },
    {
      id: 'ho2', formula: 'HO2', name: 'гидропероксильный радикал',
      elements: { H: 1, O: 2 }, charge: 0, phase: 'gas',
      molarMassKgMol: null, molarMassStatus: 'unknown', dataStatus: 'known',
      provenance: {
        sourceName: 'типизированная стехиометрия механизма Stage 4.5.5',
        sourceId: 'src/modules/ChemicalEvolution/kineticMechanism.ts',
        recordId: 'species:HO2',
        note: 'молярная масса намеренно не задаётся; элементный состав следует из формулы механизма'
      },
      note: 'радикал; термодинамические свойства и молярная масса не заявлены'
    }
  ];
  for (const species of radicals) {
    if (!catalog.has(species.id)) catalog.register(species);
  }
  return catalog;
}

/** Точные rate-данные сохраняются в primary-state истории без реконструкции. */
function toPrimaryKineticReactionAudit(summary: AppliedReactionSummary): ChemicalKineticReactionAudit {
  if (summary.dataStatus !== 'known') {
    throw new Error('физическая кинетика допускает только известные rate data; получен статус ' + summary.dataStatus);
  }
  return {
    reactionId: summary.reactionId,
    label: summary.label,
    dataStatus: 'known',
    rateConstant: { ...summary.rateConstant },
    appliedRangeK: { min: summary.appliedRangeK.min, max: summary.appliedRangeK.max },
    // В текущих fall-off записях нет полного численного бюджета
    // неопределённости k0/k∞, а Core RateConstantEvaluation намеренно
    // не комбинирует её в эффективную неопределённость k. Не выдаём
    // отсутствие оценки за нулевую неопределённость.
    uncertainty: {
      status: 'not_quantified',
      effectiveRate: null,
      lowPressureLimit: null,
      highPressureLimit: null,
      reason:
        'Для применённой fall-off параметризации количественная неопределённость эффективного k и его пределов не объединена/не предоставлена; evaluator оставляет uncertainty undefined. Качественные ограничения источников сохранены в provenance и warnings.'
    },
    provenance: { ...summary.provenance },
    parameterProvenance: {
      lowPressureLimit: { ...summary.parameterProvenance.lowPressureLimit },
      highPressureLimit: { ...summary.parameterProvenance.highPressureLimit },
      broadening: { ...summary.parameterProvenance.broadening }
    },
    fallOff: { ...summary.fallOff }
  };
}

/**
 * Production путь: основной ChemicalEvolutionState → state-dependent
 * ProcessOperator → Radau IIA compartment step → атомарные Core reservoirs
 * + ReactionLedger. Никаких game extentFraction/gameSpeedCoefficient,
 * автоматического заполнения отсутствующих видов или синтетической
 * геометрии в этом пути нет.
 */
export function runPhysicalChemicalEvolutionSchedulerStep(
  world: GeneratedWorld
): ChemicalEvolutionSchedulerStepResult {
  const log: string[] = [];
  const reject = (reason: string): ChemicalEvolutionSchedulerStepResult => ({
    world,
    status: 'rejected',
    log: [...log, reason],
    reason
  });
  if (!world.chemicalState) return reject('основное ChemicalEvolutionState отсутствует: физическая кинетика не выполнялась');
  if (!world.atmospherePhysics) return reject('физическая модель атмосферы отсутствует: физическая кинетика не выполнялась');
  const chemical = world.chemicalState;
  if (chemical.physicalKinetics === undefined) {
    return reject('physicalKinetics не сконфигурирован в основном ChemicalEvolutionState');
  }
  const configIssues = physicalChemicalKineticsConfigurationProblems(chemical);
  if (configIssues.length > 0) {
    return reject('физическая кинетическая конфигурация отклонена: ' + configIssues.join('; '));
  }

  let core: CoreWorldState;
  if (world.coreWorldState === undefined || world.coreWorldState === null) {
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
      log.push('научное ядро инициализировано из основного ChemicalEvolutionState; физические слои сохранены без преобразования оснований');
    } catch (error) {
      return reject(
        'инициализация научного ядра для физической кинетики отклонена: ' +
          (error instanceof Error ? error.message : String(error))
      );
    }
  } else {
    core = world.coreWorldState;
    const issues = chemicalReservoirConsistencyIssues(core, chemical);
    if (issues.length > 0) {
      return reject(
        'резервуары научного ядра не согласованы с основным ChemicalEvolutionState: ' +
          issues.join('; ') + ' — ядро не перезаписывается, шаг не выполнен'
      );
    }
  }

  const coreChemical = chemicalStateFromCoreReservoirs(core, chemical);
  const projectedIssues = physicalChemicalKineticsConfigurationProblems(coreChemical);
  if (projectedIssues.length > 0) {
    return reject('проверка подстолбовых запасов относительно CoreWorldState отклонена: ' + projectedIssues.join('; '));
  }

  const box: { chemical: ChemicalEvolutionState | null } = { chemical: null };
  let lastProposal: ProcessStepProposal | null = null;
  const operator: ProcessOperator = {
    processId: PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID,
    proposeStep(snapshot, requestedMaximumDurationS): ProcessStepProposal {
      const projected = chemicalStateFromCoreReservoirs(snapshot as CoreWorldState, chemical);
      const issues = physicalChemicalKineticsConfigurationProblems(projected);
      if (issues.length > 0) {
        throw new Error('физическая кинетическая конфигурация не согласована со снимком CoreWorldState: ' + issues.join('; '));
      }
      lastProposal = proposePhysicalChemicalStep(projected, requestedMaximumDurationS);
      return lastProposal;
    },
    apply(coreWorld, durationS): CoreWorldState {
      const working = chemicalStateFromCoreReservoirs(coreWorld, chemical);
      const issues = physicalChemicalKineticsConfigurationProblems(working);
      if (issues.length > 0) {
        throw new Error('физическая кинетическая конфигурация изменилась до apply: ' + issues.join('; '));
      }
      const config = working.physicalKinetics!;
      const initialInventory = { ...working.inventory };
      const updatedInventory = { ...working.inventory };
      const updatedLayers: ChemicalPhysicalKineticLayer[] = [];
      const layerAudits: ChemicalKineticLayerStepAudit[] = [];
      const historyRecords: ChemicalStepRecord[] = [];
      const warnings: string[] = [];
      const assumptions: string[] = [];
      const altitudeOrderedLayers = config.layers
        .filter((layer) => layer.altitudeRangeM !== undefined)
        .slice()
        .sort((a, b) =>
          a.altitudeRangeM!.min - b.altitudeRangeM!.min ||
          a.altitudeRangeM!.max - b.altitudeRangeM!.max ||
          a.layerId.localeCompare(b.layerId)
        );
      for (let index = 1; index < altitudeOrderedLayers.length; index++) {
        const previous = altitudeOrderedLayers[index - 1]!;
        const current = altitudeOrderedLayers[index]!;
        const previousTopM = previous.altitudeRangeM!.max;
        const currentBottomM = current.altitudeRangeM!.min;
        const gapToleranceM = 1e-8 * Math.max(1, Math.abs(previousTopM), Math.abs(currentBottomM));
        if (currentBottomM > previousTopM + gapToleranceM) {
          assumptions.push(
            'вертикальный промежуток ' + previousTopM + '–' + currentBottomM +
            ' м между слоями «' + previous.layerId + '» и «' + current.layerId +
            '» не содержит реакционного компартмента: химия и перенос в этом интервале не моделируются и не интерполируются'
          );
        }
      }
      let reactionLedger = coreWorld.reactionLedger ?? { records: [] };
      const time = {
        segmentIndex: coreWorld.clock.segmentIndex,
        localTimeS: coreWorld.clock.localTimeS
      };
      const schedulerStep = coreWorld.scheduling?.stepCount ?? 0;

      for (const layer of config.layers) {
        const mechanismInventories = mechanismInventoriesFromChemicalLayer(layer);
        const compartment = runKineticCompartmentStep({
          temperatureK: layer.temperatureK,
          dtSeconds: durationS,
          layerThicknessM: layer.layerThicknessM,
          reactionIds: [...layer.reactionIds],
          columnInventoriesMolM2: mechanismInventories
        });
        const nextLayerInventory: Record<string, number> = { ...layer.columnInventoriesMolM2 };
        const layerChanges: Record<string, number> = {};
        for (const [mechanismId, oldAmount] of Object.entries(mechanismInventories)) {
          const chemicalId = MECHANISM_TO_CHEMICAL_SPECIES[mechanismId];
          const newAmount = compartment.updatedColumnInventoriesMolM2[mechanismId];
          if (chemicalId === undefined || typeof newAmount !== 'number' || !Number.isFinite(newAmount) || newAmount < 0) {
            throw new Error('кинетический слой «' + layer.layerId + '» вернул недопустимый запас вида ' + mechanismId);
          }
          const delta = newAmount - oldAmount;
          const globalBefore = updatedInventory[chemicalId];
          if (!Object.prototype.hasOwnProperty.call(updatedInventory, chemicalId) ||
              typeof globalBefore !== 'number' || !Number.isFinite(globalBefore) || globalBefore < 0) {
            throw new Error('основной атмосферный инвентарь не содержит проверенный вид «' + chemicalId + '»');
          }
          const globalAfter = globalBefore + delta;
          if (!Number.isFinite(globalAfter) || globalAfter < 0) {
            throw new Error('кинетический шаг дал недопустимый общий столбовый запас вида «' + chemicalId + '»');
          }
          updatedInventory[chemicalId] = globalAfter;
          nextLayerInventory[chemicalId] = newAmount;
          layerChanges[chemicalId] = delta;
        }

        const reactionSummaries = compartment.concentrationStep.reactions;
        for (const summary of reactionSummaries) {
          const definition = MECHANISM_REACTIONS.find((entry) => entry.reactionId === summary.reactionId);
          if (definition === undefined) {
            throw new Error('исполнитель вернул reactionId вне типизированной сети: ' + summary.reactionId);
          }
          const productId = MECHANISM_TO_CHEMICAL_SPECIES[definition.product];
          if (productId === undefined) throw new Error('для продукта нет ChemicalEvolution species ID: ' + definition.product);
          const extent = nextLayerInventory[productId] - layer.columnInventoriesMolM2[productId];
          if (!Number.isFinite(extent) || extent < 0) {
            throw new Error('физическая реакция «' + summary.reactionId + '» дала отрицательную или неконечную степень протекания');
          }
          const reactionChanges: Record<string, number> = {};
          for (const mechanismSpeciesId of definition.species) {
            const chemicalId = MECHANISM_TO_CHEMICAL_SPECIES[mechanismSpeciesId]!;
            reactionChanges[chemicalId] =
              nextLayerInventory[chemicalId] - layer.columnInventoriesMolM2[chemicalId];
          }
          const applied = extent > 0;
          const reason =
            'Radau IIA физическая кинетика; k=' + summary.rateConstant.value + ' ' +
            summary.rateConstant.unit + '; source=' +
            (summary.provenance.sourceName ?? summary.provenance.reference ?? summary.provenance.datasetId ?? 'идентификация в provenance отсутствует');
          historyRecords.push({
            stepNumber: working.history.length + historyRecords.length + 1,
            reactionId: summary.reactionId,
            applied,
            mode: 'kinetic',
            extent: applied ? extent : null,
            limitingReactant: null,
            reason: applied ? reason : reason + '; начальная скорость/конечное изменение не привели к положительной степени протекания',
            changes: reactionChanges,
            confidence: 'derived'
          });

          if (applied) {
            const participant = (mechanismSpeciesId: string) => ({
              reservoirId: CHEMICAL_RESERVOIR_IDS.atmospheric,
              speciesId: MECHANISM_TO_CHEMICAL_SPECIES[mechanismSpeciesId]!,
              coefficient: 1
            });
            const record: ReactionRecord = {
              id: 'physical-chemical:' + String(schedulerStep) + ':' + layer.layerId + ':' + summary.reactionId,
              reactionId: summary.reactionId,
              reactants: [
                ...definition.reactants.map((speciesId) => participant(speciesId)),
                participant(definition.thirdBody)
              ],
              products: [participant(definition.product), participant(definition.thirdBody)],
              extent,
              extentBasis: 'column_amount',
              time,
              processId: PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID,
              note:
                'Физическое применение механизма в основном ChemicalEvolutionState; слой=' +
                layer.layerId + '; dt=' + durationS + ' s; k=' + summary.rateConstant.value + ' ' +
                summary.rateConstant.unit + '; source=' +
                (summary.provenance.sourceName ?? summary.provenance.reference ?? summary.provenance.datasetId ?? 'см. physicalKineticsHistory')
            };
            reactionLedger = registerReaction(reactionLedger, record);
          }
          log.push(
            '[' + layer.layerId + '] ' + summary.reactionId +
            (applied ? ': extent=' + extent + ' mol/m²' : ': extent=0')
          );
        }

        const stats = compartment.concentrationStep.integration.stats;
        const layerAudit: ChemicalKineticLayerStepAudit = {
          layerId: layer.layerId,
          temperatureK: layer.temperatureK,
          layerThicknessM: layer.layerThicknessM,
          temperatureProvenance: { ...layer.temperatureProvenance },
          thicknessProvenance: { ...layer.thicknessProvenance },
          altitudeRangeM: layer.altitudeRangeM ? { ...layer.altitudeRangeM } : null,
          altitudeProvenance: layer.altitudeProvenance ? { ...layer.altitudeProvenance } : null,
          inventoryProvenance: { ...layer.inventoryProvenance },
          totalInventoryProvenance: Object.fromEntries(
            Object.keys(layer.columnInventoriesMolM2).map((speciesId) => [
              speciesId,
              { ...config.totalInventoryProvenance[speciesId] }
            ])
          ),
          initialColumnInventoriesMolM2: { ...layer.columnInventoriesMolM2 },
          finalColumnInventoriesMolM2: { ...nextLayerInventory },
          thirdBody: {
            speciesId: compartment.thirdBody.speciesId,
            inventoryMolM2: compartment.thirdBody.inventoryMolM2,
            concentrationMoleculeCm3: compartment.thirdBody.concentrationMoleculeCm3
          },
          integration: {
            method: compartment.concentrationStep.integration.method,
            attemptedSteps: stats.attemptedSteps,
            acceptedSteps: stats.acceptedSteps,
            rejectedSteps: stats.rejectedSteps,
            newtonFailures: stats.newtonFailures,
            rhsEvaluations: stats.rhsEvaluations,
            jacobianEvaluations: stats.jacobianEvaluations,
            minorNegativeCount: compartment.concentrationStep.integration.minorNegativeCount,
            invariantChecks: compartment.concentrationStep.integration.invariantChecks
          },
          reactions: reactionSummaries.map(toPrimaryKineticReactionAudit)
        };
        layerAudits.push(layerAudit);
        updatedLayers.push({
          ...layer,
          thicknessProvenance: { ...layer.thicknessProvenance },
          temperatureProvenance: { ...layer.temperatureProvenance },
          inventoryProvenance: { ...layer.inventoryProvenance },
          columnInventoriesMolM2: nextLayerInventory
        });
        warnings.push(...compartment.warnings.map((warning) => '[' + layer.layerId + '] ' + warning));
        assumptions.push(...compartment.assumptions.map((assumption) => '[' + layer.layerId + '] ' + assumption));
      }

      const elapsedYears = convert(quantity(durationS, 's'), 'yr').value;
      if (!Number.isFinite(elapsedYears) || elapsedYears <= 0) {
        throw new Error('физическая длительность Scheduler не преобразуется в конечные положительные юлианские годы');
      }
      const audit: ChemicalPhysicalKineticsStepAudit = {
        schedulerStep,
        startSegmentIndex: time.segmentIndex,
        startLocalTimeS: time.localTimeS,
        durationS,
        characteristicTimeS: lastProposal?.characteristicTimeS ?? null,
        stepSelectionMethod: lastProposal?.method ?? 'state-dependent proposal',
        layers: layerAudits,
        warnings,
        assumptions
      };
      const oldO2 = initialInventory.o2;
      const newO2 = updatedInventory.o2;
      const oxygenBalance =
        typeof oldO2 === 'number' && typeof newO2 === 'number'
          ? {
              production: Math.max(0, newO2 - oldO2),
              consumption: Math.max(0, oldO2 - newO2),
              net: newO2 - oldO2,
              note: 'физическое изменение O₂ за принятый кинетический macro-шаг; единицы моль/м² атмосферного столба'
            }
          : {
              production: 0,
              consumption: 0,
              net: 0,
              note: 'изменение O₂ не рассчитывалось: основной инвентарь O₂ не задан как явная физическая величина'
            };

      const updatedChemical: ChemicalEvolutionState = {
        ...working,
        inventory: updatedInventory,
        reservoirs: {
          ...working.reservoirs,
          atmospheric: { ...updatedInventory }
        },
        modelTimeYears: working.modelTimeYears + elapsedYears,
        history: [...working.history, ...historyRecords],
        oxygenBalance,
        physicalKinetics: {
          maximumMacroStepS: config.maximumMacroStepS,
          totalInventoryProvenance: Object.fromEntries(
            Object.entries(config.totalInventoryProvenance).map(([speciesId, provenance]) => [
              speciesId,
              { ...provenance }
            ])
          ),
          layers: updatedLayers
        },
        physicalKineticsHistory: [...(working.physicalKineticsHistory ?? []), audit]
      };
      recomputeFractions(updatedChemical);
      if (updatedChemical.mode === 'column_inventory' && updatedChemical.meanMolarMassKgMol === null) {
        updatedChemical.surfacePressurePa = null;
        updatedChemical.notes = [
          ...updatedChemical.notes,
          'surfacePressurePa сброшено в unknown после включения радикальных видов с неизвестной молярной массой; прежнее значение не сохраняется как будто неизменная физическая величина'
        ];
      }

      const atmosphereInventory: MaterialInventory = {
        basis: 'column_amount',
        entries: { ...updatedChemical.inventory }
      };
      const inventoryCheck = validateMaterialInventory(atmosphereInventory);
      if (!inventoryCheck.valid) {
        throw new Error('обновлённый физический атмосферный инвентарь отклонён: ' + inventoryCheck.errors.join('; '));
      }
      const atmosphereReservoir = coreWorld.reservoirs.find(
        (reservoir) => reservoir.id === CHEMICAL_RESERVOIR_IDS.atmospheric
      );
      if (atmosphereReservoir === undefined) {
        throw new Error('CoreWorldState не содержит атмосферный резервуар для физической химической транзакции');
      }
      const reservoirs = coreWorld.reservoirs.map((reservoir) =>
        reservoir.id === CHEMICAL_RESERVOIR_IDS.atmospheric
          ? setMaterialInventory(reservoir, 'column_amount', atmosphereInventory.entries)
          : reservoir
      );
      box.chemical = updatedChemical;
      return { ...coreWorld, reservoirs, reactionLedger };
    }
  };

  let result: MacroStepResult;
  try {
    result = runMacroStep(core, createPhysicalChemicalEvolutionStepRegistry(), [operator], {
      durationS: chemical.physicalKinetics.maximumMacroStepS,
      splitting: 'lie',
      processIds: [PHYSICAL_CHEMICAL_KINETICS_PROCESS_ID],
      audit: {
        speciesCatalog: physicalKineticSpeciesCatalog(),
        boundary: 'complete'
      }
    });
  } catch (error) {
    return reject('физическая химическая кинетика отклонена Scheduler: ' +
      (error instanceof Error ? error.message : String(error)));
  }
  if (result.status !== 'committed') {
    return reject('физический химический шаг отклонён без commit: ' + result.diagnostics.join('; '));
  }
  const chemicalAfter = box.chemical ?? chemical;
  log.push(
    'физическая химическая кинетика зафиксирована Scheduler: dt=' +
    (result.stepSize?.effectiveDurationS ?? 0) + ' s; шаг часов один; ReactionLedger append-only'
  );
  if (result.stepSize !== undefined) {
    log.push(...result.stepSize.diagnostics);
  }
  return {
    world: { ...world, coreWorldState: result.world, chemicalState: chemicalAfter },
    status: 'committed',
    log,
    reason: null,
    stepSize: result.stepSize
  };
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

  // Явно сконфигурированный физический механизм в основном состоянии
  // автоматически выбирает физический Scheduler-путь. Игровые
  // extentFraction/stepDurationYears не читаются и не влияют на него.
  if (chemical.physicalKinetics !== undefined) {
    return runPhysicalChemicalEvolutionSchedulerStep(world);
  }

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
      // Stage 4.2.4 (fail-closed): записи переносятся КАК ЕСТЬ —
      // повреждённые значения НЕ фильтруются молча через
      // Number.isFinite/v >= 0. Инвентарь результата проходит
      // каноническую валидацию validateMaterialInventory (весь объект:
      // основание, форма entries, числа); повреждённый результат
      // бросает контролируемую ошибку с диагностикой, а Scheduler
      // атомарно возвращает rejected с ИСХОДНЫМ миром (часы,
      // инвентари и ReactionLedger нетронуты).
      const atmosphereInventory: MaterialInventory = {
        basis: basisWide,
        entries: Object.fromEntries(Object.entries(working.inventory))
      };
      const atmosphereCheck = validateMaterialInventory(atmosphereInventory);
      if (!atmosphereCheck.valid) {
        throw new Error(
          'химический шаг: инвентарь результата повреждён и не преобразуется в инвентарь ядра: ' +
            atmosphereCheck.errors.join('; ')
        );
      }
      const atmosphereEntries = atmosphereInventory.entries;
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
  runPhysicalChemicalEvolutionSchedulerStep,
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
