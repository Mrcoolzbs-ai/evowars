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
// - кислородный баланс dO2/dt = P(O2) − C(O2);
// - реестр источников и стоков (все отключены по умолчанию).

import type {
  AtmospherePhysicalModel,
  ChemicalEvolutionState,
  ChemicalReaction,
  ChemicalStepRecord,
  ChemicalProcess,
  GeneratedWorld,
  SubstanceReservoirs
} from '../../types';
import chemicalReactions from '../Data/chemicalReactions';
import gases from '../Data/gases';
import { getElementComposition } from '../Data/elementCompositions';
import { paToAtm } from '../Units';
import { createEmptyReservoirs, totalSubstanceAmount } from '../PhaseEquilibrium';

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
      note: 'биологическое производство O₂ по умолчанию равно нулю: генератор ещё не создаёт живые виды; структура позволяет подключить кислородопроизводителей в будущем'
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

  // 7. Кислородный баланс пересчитывается по всей истории шагов:
  // после каждой реакции состояние содержит консистентный баланс,
  // а не результат только последней выполненной реакции.
  next.oxygenBalance = computeOxygenBalance(next);

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

export interface OxygenBalanceSummary {
  production: number;
  consumption: number;
  net: number;
  note: string;
}

/**
 * Суммарный кислородный баланс dO2/dt = P(O2) − C(O2) по истории шагов.
 * Биологическое и фотохимическое производство подключается через
 * реестр процессов; по умолчанию производство равно нулю. O₂
 * накапливается только при устойчиво положительном балансе.
 */
export function computeOxygenBalance(state: ChemicalEvolutionState): OxygenBalanceSummary {
  let consumption = 0;
  for (const record of state.history) {
    const o2Change = record.changes['o2'] ?? 0;
    if (o2Change < 0) {
      consumption += -o2Change;
    }
  }
  // Производство O₂: биологических видов нет (генератор их не создаёт),
  // фотохимическое производство задаётся процессами реестра (отключены).
  const production = 0;
  return {
    production,
    consumption,
    net: production - consumption,
    note:
      'd(O2) = производство − потребление. Производство по умолчанию нулевое: накопление O₂ возможно только при положительном суммарном балансе после подключения источников.'
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

  // Кислородный баланс вычисляется по окончательному состоянию шага
  // и сохраняется в состоянии мира (актуален для UI, а не только
  // для промежуточной реакции).
  const oxygen = computeOxygenBalance(state);
  state = { ...state, oxygenBalance: oxygen };
  log.push(
    `кислородный баланс: производство ${oxygen.production.toFixed(6)}, потребление ${oxygen.consumption.toFixed(6)}, итог ${oxygen.net.toFixed(6)}`
  );

  return {
    world: { ...world, chemicalState: state },
    log
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
  runChemicalEvolutionStep
};
