// ============================================
// KINETIC MECHANISM — ограниченный концентрационный механизм №89/№106
// ============================================
//
// Stage 4.5.5, первый реализационный срез (2026-11-10, по явному
// решению владельца проекта). Этот срез НЕ завершает 4.5.4:
// блокирующие вопросы 4.5.4 остаются открытыми, статусы записей
// №1/№70/№72 НЕ меняются (unknown, no_kinetic_data, fail-closed),
// JPL Table 2.1 НЕ извлечена, полная KIDA Troe-форма НЕ реализована.
//
// Объём среза — только две записи текущего каталога с независимыми
// known-параметризациями (ревизии каталога 4.5.4.6/4.5.4.7):
// - №89 (kida-tb-2015-03-19-89): O + NO + N₂ → NO₂ + N₂,
//   подтверждённая применимость [200, 300] K;
// - №106 (kida-tb-2015-03-19-106): H + O₂ + N₂ → HO₂ + N₂,
//   подтверждённая применимость [300, 400] K.
//
// Контракт среза:
// - STATELESS API поверх явного вектора концентраций molecule/cm³.
//   К runChemicalEvolutionStep()/GeneratedWorld НЕ подключён:
//   конверсия inventory (моль/м² атмосферного столба) в концентрации
//   НЕ выполняется — физического контракта концентраций
//   (объём/толщина кинетического слоя) в проекте нет, выдумывать его
//   запрещено; фиктивные начальные запасы радикалов НЕ создаются;
// - записи извлекаются из текущего каталога (buildKineticsCatalog),
//   числовые коэффициенты НЕ дублируются;
// - k(T, [N₂]) вычисляется существующим evaluateRateConstant()
//   из Core/kinetics (контракт 4.5.2 НЕ менялся);
// - интегрирование — существующим solveOdeWithRadauIia() из
//   Core/odeSolver (контракт 4.5.3 НЕ менялся): аналитический
//   якобиан, неотрицательность и линейные инварианты — контракт
//   решателя, БЕЗ clipping и постфактум-нормализации;
// - N₂ — третье тело (bath gas): концентрация передаётся вызывающей
//   стороной ЯВНО, строго положительная, в вектор состояния не
//   входит, из давления/долей воздуха или смеси НЕ выводится;
// - человекочитаемое поле record.reaction НЕ парсится: стехиометрия
//   задана типизированными определениями ниже и проверяется на
//   элементный баланс; каталожное обозначение O2H — то же самое
//   вещество, что каноническое внутреннее HO₂;
// - недопустимая температура хотя бы одной выбранной записи
//   завершает ВЕСЬ шаг контролируемым отказом
//   temperature_out_of_range: молчаливый пропуск реакции и
//   экстраполяция запрещены; пересечение диапазонов №89 и №106 —
//   только 300 K (общий диапазон 200–400 K НЕ заявляется);
// - время шага — физические секунды; game-величины (extentFraction,
//   gameSpeedCoefficient, игровые годы) НЕ участвуют;
// - solveEquilibrium НЕ вызывается; режим A ChemicalEvolution
//   НЕ меняется; тип игровой реакции ChemicalReaction НЕ
//   превращается в кинетическую запись.

import { evaluateRateConstant, KineticsError } from '../Core/kinetics';
import { buildKineticsCatalog } from '../Data/kineticsCatalog';
import type { KineticsCatalog } from '../Data/kineticsCatalog';
import { quantity } from '../Core/physicalQuantity';
import { solveOdeWithRadauIia, OdeSolverError } from '../Core/odeSolver';
import type { OdeSolverProblem, OdeSolverResult, OdeSolverStats, LinearInvariant } from '../Core/solverBackend';
import type { DataProvenance } from '../Core/scientificValue';

/** Результат вычислителя k(T) (контракт 4.5.2), без дублирования его полей. */
type RateEvaluation = ReturnType<typeof evaluateRateConstant>;
type RateDataStatus = RateEvaluation['dataStatus'];
type RateAppliedRangeK = RateEvaluation['appliedRangeK'];
type RateProvenance = NonNullable<RateEvaluation['provenance']>;
type RateFallOff = NonNullable<RateEvaluation['fallOff']>;

// ============================================
// 1. ТИПИЗИРОВАННЫЕ ОПРЕДЕЛЕНИЯ МЕХАНИЗМА
// ============================================

/** Вид ограниченного механизма (канонические внутренние обозначения). */
export type MechanismSpeciesId = 'O' | 'NO' | 'NO2' | 'H' | 'O2' | 'HO2' | 'N2';

export interface MechanismSpeciesDef {
  readonly id: MechanismSpeciesId;
  /** Человекочитаемое обозначение (с подстрочными индексами). */
  readonly label: string;
  /** Элементный состав: число атомов каждого элемента в молекуле. */
  readonly elements: Readonly<Record<string, number>>;
}

/**
 * Состав видов механизма. HO₂ — каноническое внутреннее обозначение
 * вида, который в номенклатуре KIDA записывается O2H: это один и тот
 * же вид, а не два разных.
 */
export const MECHANISM_SPECIES: readonly MechanismSpeciesDef[] = [
  { id: 'O', label: 'O', elements: { O: 1 } },
  { id: 'NO', label: 'NO', elements: { N: 1, O: 1 } },
  { id: 'NO2', label: 'NO₂', elements: { N: 1, O: 2 } },
  { id: 'H', label: 'H', elements: { H: 1 } },
  { id: 'O2', label: 'O₂', elements: { O: 2 } },
  { id: 'HO2', label: 'HO₂', elements: { H: 1, O: 2 } },
  { id: 'N2', label: 'N₂', elements: { N: 2 } }
];

/** Третье тело механизма (bath gas): не расходуемый стехиометрический реагент. */
export const MECHANISM_THIRD_BODY: MechanismSpeciesId = 'N2';

/** Разрешённые идентификаторы кинетических записей механизма. */
export type MechanismReactionId = 'kida-tb-2015-03-19-89' | 'kida-tb-2015-03-19-106';

export interface MechanismElementInvariant {
  /** Элемент (или иная линейная комбинация), сохраняемая реакцией. */
  readonly element: string;
  /** Коэффициенты при концентрациях видов def.species (в их порядке). */
  readonly coefficients: readonly number[];
}

export interface MechanismReactionDef {
  readonly reactionId: MechanismReactionId;
  /** Человекочитаемая запись (информационная; контракт стехиометрии — поля ниже). */
  readonly label: string;
  /** Два изменяемых реагента (бимолекулярный закон скорости). */
  readonly reactants: readonly MechanismSpeciesId[];
  /** Единственный изменяемый продукт. */
  readonly product: MechanismSpeciesId;
  /** Третье тело: N₂, bath gas; в вектор состояния НЕ входит. */
  readonly thirdBody: MechanismSpeciesId;
  /** Изменяемые виды (порядок вектора состояния отдельной реакции). */
  readonly species: readonly MechanismSpeciesId[];
  /** Линейные инварианты (по видам species). */
  readonly invariants: readonly MechanismElementInvariant[];
}

/**
 * Определения двух разрешённых реакций. Поле record.reaction каталога
 * человекочитаемо и стехиометрическим контрактом НЕ является — оно НЕ
 * парсится; стехиометрия задаётся здесь и проверяется на элементный
 * баланс (mechanismElementBalanceProblems).
 */
export const MECHANISM_REACTIONS: readonly MechanismReactionDef[] = [
  {
    reactionId: 'kida-tb-2015-03-19-89',
    label: 'O + NO + N₂ → NO₂ + N₂',
    reactants: ['O', 'NO'],
    product: 'NO2',
    thirdBody: 'N2',
    species: ['O', 'NO', 'NO2'],
    invariants: [
      { element: 'N', coefficients: [0, 1, 1] },
      { element: 'O', coefficients: [1, 1, 2] }
    ]
  },
  {
    reactionId: 'kida-tb-2015-03-19-106',
    label: 'H + O₂ + N₂ → HO₂ + N₂',
    reactants: ['H', 'O2'],
    product: 'HO2',
    thirdBody: 'N2',
    species: ['H', 'O2', 'HO2'],
    invariants: [
      { element: 'H', coefficients: [1, 0, 1] },
      { element: 'O', coefficients: [0, 1, 1] }
    ]
  }
];

/**
 * Проверка типизированных определений механизма. Чистая функция:
 * возвращает список проблем (пустой = всё сходится). Проверяется:
 * - элементный баланс чистого изменения (реагент −1, продукт +1);
 *   третье тело N₂ входит в обе части реакции и в чистое изменение
 *   не входит, но обязано быть именно N₂;
 * - бимолекулярность (ровно два изменяемых реагента);
 * - каждый инвариант сохраняется стехиометрией:
 *   Σ coefficients_i · Δc_i = 0.
 */
export function mechanismElementBalanceProblems(): string[] {
  const problems: string[] = [];
  const compositionOf = (id: string): Readonly<Record<string, number>> | null => {
    const def = MECHANISM_SPECIES.find((s) => s.id === id);
    return def ? def.elements : null;
  };
  for (const reaction of MECHANISM_REACTIONS) {
    const net: Record<string, number> = {};
    let ok = true;
    const add = (id: string, sign: number): void => {
      const comp = compositionOf(id);
      if (!comp) {
        problems.push('реакция ' + reaction.reactionId + ': неизвестный вид ' + id);
        ok = false;
        return;
      }
      for (const [element, count] of Object.entries(comp)) {
        net[element] = (net[element] ?? 0) + sign * count;
      }
    };
    for (const reactant of reaction.reactants) add(reactant, -1);
    add(reaction.product, 1);
    if (!ok) continue;
    for (const [element, total] of Object.entries(net)) {
      if (total !== 0) {
        problems.push(
          'реакция ' + reaction.reactionId + ': элемент ' + element + ' не сбалансирован (чистое изменение ' + total + ')'
        );
      }
    }
    if (reaction.reactants.length !== 2) {
      problems.push(
        'реакция ' + reaction.reactionId + ': закон скорости механизма бимолекулярный, задано реагентов: ' + reaction.reactants.length
      );
    }
    if (reaction.thirdBody !== MECHANISM_THIRD_BODY) {
      problems.push(
        'реакция ' + reaction.reactionId + ': третьим телом разрешён только N₂, задано ' + reaction.thirdBody
      );
    }
    const netChange = new Array<number>(reaction.species.length).fill(0);
    for (const reactant of reaction.reactants) {
      const i = reaction.species.indexOf(reactant);
      if (i < 0) {
        problems.push('реакция ' + reaction.reactionId + ': реагент ' + reactant + ' отсутствует в species');
        ok = false;
        continue;
      }
      netChange[i] -= 1;
    }
    const p = reaction.species.indexOf(reaction.product);
    if (p < 0) {
      problems.push('реакция ' + reaction.reactionId + ': продукт ' + reaction.product + ' отсутствует в species');
      ok = false;
    } else {
      netChange[p] += 1;
    }
    if (!ok) continue;
    for (const invariant of reaction.invariants) {
      if (invariant.coefficients.length !== reaction.species.length) {
        problems.push(
          'реакция ' + reaction.reactionId + ': инвариант ' + invariant.element + ' имеет неверную длину коэффициентов'
        );
        continue;
      }
      let total = 0;
      for (let i = 0; i < reaction.species.length; i++) {
        total += invariant.coefficients[i] * netChange[i];
      }
      if (total !== 0) {
        problems.push(
          'реакция ' + reaction.reactionId + ': инвариант ' + invariant.element + ' не сохраняется стехиометрией (сумма ' + total + ')'
        );
      }
    }
  }
  return problems;
}

// ============================================
// 2. ОШИБКИ МЕХАНИЗМА (fail-closed)
// ============================================

export const KINETIC_MECHANISM_ERROR_CODES = [
  'invalid_input',
  'temperature_out_of_range',
  'no_kinetic_data',
  'integration_failure'
] as const;

export type KineticMechanismErrorCode = (typeof KINETIC_MECHANISM_ERROR_CODES)[number];

/** Ошибка механизма (стиль KineticsError/OdeSolverError): стабильный код + человекочитаемое сообщение. */
export class KineticMechanismError extends Error {
  readonly code: KineticMechanismErrorCode;
  readonly details?: Record<string, number | string | boolean>;

  constructor(
    code: KineticMechanismErrorCode,
    message: string,
    details?: Record<string, number | string | boolean>
  ) {
    super('[KineticMechanism:' + code + '] ' + message);
    this.name = 'KineticMechanismError';
    this.code = code;
    this.details = details;
  }
}

// ============================================
// 3. КОНТРАКТ КОНЦЕНТРАЦИОННОГО ШАГА
// ============================================

/**
 * Вход stateless-шага. Концентрации — molecule/cm³; ключи — канонические
 * внутренние обозначения видов ('O', 'NO', 'NO2', 'H', 'O2', 'HO2', 'N2').
 * Концентрация N₂ ('N2') ОБЯЗАНА быть передана явно и быть конечной
 * строго положительной: [N₂] НЕ выводится из давления, доли N₂, воздуха
 * или смеси. Для каждой выбранной реакции все её изменяемые виды обязаны
 * присутствовать в объекте: отсутствующее поле — ошибка входа, а не
 * молчаливый ноль; явный ноль допустим для реагента и продукта.
 */
export interface ConcentrationKineticStepInput {
  /** Температура среды, K (конечная, строго положительная). */
  readonly temperatureK: number;
  /** Продолжительность шага, физические секунды (конечная, строго положительная). */
  readonly dtSeconds: number;
  /** Непустой список идентификаторов разрешённых реакций, без дублей. */
  readonly reactionIds: readonly string[];
  /** Явный вектор концентраций molecule/cm³, включая концентрацию N₂. */
  readonly concentrations: Readonly<Record<string, number>>;
}

/**
 * Компонентная трассируемость параметров fall-off: provenance каждого
 * компонента берётся НЕПОСРЕДСТВЕННО из полей записи каталога
 * (lowPressureLimit/highPressureLimit/параметры уширения), а НЕ из
 * единого provenance вычислителя 4.5.2. Существующее поле provenance
 * сводки и контракт RateEvaluation НЕ меняются.
 */
export interface FallOffParameterProvenance {
  /** Provenance каталожного k0 (параметры низкоплотностного предела). */
  readonly lowPressureLimit: DataProvenance;
  /** Provenance каталожного k∞ (параметры высокоплотностного предела). */
  readonly highPressureLimit: DataProvenance;
  /** Provenance параметров уширения fall-off (Fc, N; поле fallOff.provenance записи каталога). */
  readonly broadening: DataProvenance;
}

/** Применённая запись: вычисленная константа и provenance (БЕЗ дублирования параметров). */
export interface AppliedReactionSummary {
  readonly reactionId: string;
  readonly label: string;
  readonly dataStatus: RateDataStatus;
  readonly rateConstant: { readonly value: number; readonly unit: string };
  /** Диапазон применимости, фактически применённый вычислителем 4.5.2. */
  readonly appliedRangeK: RateAppliedRangeK;
  readonly provenance: RateProvenance;
  /** Компонентная трассируемость параметров fall-off (непосредственно из полей записи каталога). */
  readonly parameterProvenance: FallOffParameterProvenance;
  readonly fallOff: RateFallOff;
}

export interface ConcentrationKineticStepResult {
  readonly status: 'applied';
  readonly concentrationModel: 'molecule_cm3';
  readonly reactionIds: readonly string[];
  readonly temperatureK: number;
  readonly dtSeconds: number;
  /** Концентрация N₂, переданная вызывающей стороной (третье тело, не расходуется). */
  readonly thirdBodyN2MoleculeCm3: number;
  /** Порядок вектора состояния (изменяемые виды выбранных реакций). */
  readonly speciesOrder: readonly string[];
  /** Новые концентрации изменяемых видов (новый объект; вход НЕ мутируется). */
  readonly concentrations: Readonly<Record<string, number>>;
  readonly reactions: readonly AppliedReactionSummary[];
  readonly integration: {
    readonly method: string;
    readonly stats: OdeSolverStats;
    readonly minorNegativeCount: number;
    readonly invariantChecks: number;
  };
  /** Предупреждения о нерешённых ограничениях применимости (НЕ маскируются). */
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
}

/** ODE-задача, собранная из проверенного входа. Экспортирована для независимой проверки якобиана и контрактов решателя тестами. */
export interface BuiltConcentrationKineticProblem {
  readonly problem: OdeSolverProblem;
  readonly speciesOrder: readonly string[];
  readonly temperatureK: number;
  readonly dtSeconds: number;
  readonly thirdBodyN2MoleculeCm3: number;
  readonly reactions: readonly AppliedReactionSummary[];
  readonly warnings: readonly string[];
}

// ============================================
// 4. СБОРКА ODE-ЗАДАЧИ ИЗ ПРОВЕРЕННОГО ВХОДА
// ============================================

function requireFinitePositive(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new KineticMechanismError(
      'invalid_input',
      name + ' должен быть конечным строго положительным числом, получено: ' + String(value),
      { field: name, value: String(value) }
    );
  }
}

/**
 * Сборка ODE-задачи ограниченного механизма из входа. Все проверки входа
 * выполняются здесь (fail-closed): температура/время, список реакций
 * (только две разрешённые записи), явные концентрации всех участвующих
 * видов, строго положительная [N₂], применимость каждой записи при
 * заданной температуре (через существующий evaluateRateConstant).
 * Вход НЕ мутируется.
 */
export function buildConcentrationKineticProblem(
  input: ConcentrationKineticStepInput,
  catalog: KineticsCatalog = buildKineticsCatalog()
): BuiltConcentrationKineticProblem {
  // 1. Форма входа.
  if (input === null || typeof input !== 'object') {
    throw new KineticMechanismError('invalid_input', 'вход шага должен быть объектом ConcentrationKineticStepInput');
  }
  requireFinitePositive('temperatureK', input.temperatureK);
  requireFinitePositive('dtSeconds', input.dtSeconds);
  if (!Array.isArray(input.reactionIds) || input.reactionIds.length === 0) {
    throw new KineticMechanismError(
      'invalid_input',
      'reactionIds обязан быть непустым списком идентификаторов реакций'
    );
  }
  const seen = new Set<string>();
  for (const id of input.reactionIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new KineticMechanismError('invalid_input', 'reactionIds содержит не-строчный или пустой идентификатор');
    }
    if (seen.has(id)) {
      throw new KineticMechanismError('invalid_input', 'reactionIds содержит дубликат: ' + id, { reactionId: id });
    }
    seen.add(id);
  }
  const selected: MechanismReactionDef[] = input.reactionIds.map((id) => {
    const def = MECHANISM_REACTIONS.find((r) => r.reactionId === id);
    if (def) {
      return def;
    }
    if (catalog.has(id)) {
      // Запись каталога существует, но в ограниченный механизм НЕ входит
      // (№1/№70/№72 — unknown, no_kinetic_data, и любые будущие записи):
      // контролируемый отказ, коэффициенты НЕ выдумываются.
      throw new KineticMechanismError(
        'no_kinetic_data',
        'запись ' + id + ' не входит в ограниченный кинетический механизм 4.5.5: допущены только ' +
          MECHANISM_REACTIONS.map((r) => r.reactionId).join(', ') +
          ' с известными (known) параметризациями; статусы остальных записей каталога НЕ меняются',
        { reactionId: id }
      );
    }
    throw new KineticMechanismError('invalid_input', 'неизвестный идентификатор реакции: ' + id, { reactionId: id });
  });

  // 2. Вектор концентраций: все поля явные, конечные, неотрицательные.
  const raw = input.concentrations;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new KineticMechanismError(
      'invalid_input',
      'concentrations должен быть объектом «вид → концентрация molecule/cm³»'
    );
  }
  const knownSpecies = new Set(MECHANISM_SPECIES.map((s) => s.id));
  const validated = new Map<string, number>();
  for (const [key, value] of Object.entries(raw)) {
    if (!knownSpecies.has(key as MechanismSpeciesId)) {
      throw new KineticMechanismError(
        'invalid_input',
        'неизвестный вид в concentrations: ' + key + ' (разрешены только ' + [...knownSpecies].join(', ') + ')',
        { species: key }
      );
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new KineticMechanismError(
        'invalid_input',
        'концентрация вида ' + key + ' должна быть конечным неотрицательным числом molecule/cm³ (явный ноль допустим), получено: ' + String(value),
        { species: key, value: String(value) }
      );
    }
    validated.set(key, value);
  }
  // N₂ — третье тело: концентрация обязательна, конечна и строго положительна.
  if (!Object.prototype.hasOwnProperty.call(raw, MECHANISM_THIRD_BODY)) {
    throw new KineticMechanismError(
      'invalid_input',
      'концентрация третьего тела N₂ (ключ "N2") обязательна: отсутствующее поле — ошибка входа, а не молчаливый ноль; [N₂] НЕ выводится из давления или долей смеси',
      { species: 'N2' }
    );
  }
  const thirdBodyN2 = validated.get(MECHANISM_THIRD_BODY) as number;
  if (!(thirdBodyN2 > 0)) {
    throw new KineticMechanismError(
      'invalid_input',
      'концентрация N₂ обязана быть конечной и строго положительной (третье тело), получено: ' + String(raw[MECHANISM_THIRD_BODY]),
      { species: 'N2', value: String(raw[MECHANISM_THIRD_BODY]) }
    );
  }
  // Для каждой выбранной реакции все её изменяемые виды — явно.
  for (const def of selected) {
    for (const species of def.species) {
      if (!Object.prototype.hasOwnProperty.call(raw, species)) {
        throw new KineticMechanismError(
          'invalid_input',
          'реакция ' + def.reactionId + ': отсутствует концентрация вида "' + species + '" — отсутствующее поле есть ошибка входа, а не молчаливый ноль (явный ноль допустим)',
          { reactionId: def.reactionId, species }
        );
      }
    }
  }

  // 3. Самопроверка типизированной стехиометрии механизма.
  const balanceProblems = mechanismElementBalanceProblems();
  if (balanceProblems.length > 0) {
    throw new KineticMechanismError(
      'invalid_input',
      'типизированные определения механизма не проходят проверку элементного баланса: ' + balanceProblems.join('; ')
    );
  }

  // 4. Константы скорости — существующий вычислитель 4.5.2.
  const temperature = quantity(input.temperatureK, 'K');
  const warnings: string[] = [];
  const reactions: AppliedReactionSummary[] = [];
  const rates: number[] = [];
  for (const def of selected) {
    const record = catalog.get(def.reactionId);
    if (record === null) {
      throw new KineticMechanismError('no_kinetic_data', 'запись ' + def.reactionId + ' отсутствует в текущем каталоге');
    }
    if (record.rateConstant.status !== 'known') {
      throw new KineticMechanismError(
        'no_kinetic_data',
        'запись ' + def.reactionId + ' не имеет известной (known) параметризации: статус ' + record.rateConstant.status + ', коэффициенты НЕ выдумываются',
        { reactionId: def.reactionId }
      );
    }
    if (record.overallOrder !== 2 || record.concentrationModel !== 'molecule_cm3') {
      throw new KineticMechanismError(
        'invalid_input',
        'запись ' + def.reactionId + ' не соответствует контракту механизма: нужен бимолекулярный закон скорости (overallOrder = 2) в модели концентраций molecule_cm³',
        { reactionId: def.reactionId }
      );
    }
    // Компонентная трассируемость: параметры записи обязаны быть
    // fall-off (механизм — третий-тельный, N₂); provenance компонентов
    // (k0, k∞, уширение) берётся непосредственно из полей записи
    // каталога, а НЕ из единого provenance вычислителя 4.5.2.
    const parameters = record.rateConstant.parameters;
    if (parameters.kind !== 'fall_off') {
      throw new KineticMechanismError(
        'invalid_input',
        'запись ' + def.reactionId + ': контракт механизма требует fall-off параметризацию (третье тело N₂), получена параметризация ' + parameters.kind,
        { reactionId: def.reactionId }
      );
    }
    const fallOffParameters = parameters.fallOff;
    let evaluation: RateEvaluation;
    try {
      evaluation = evaluateRateConstant(record, temperature, { thirdBodyConcentration: thirdBodyN2 });
    } catch (e) {
      if (e instanceof KineticsError) {
        if (e.code === 'temperature_out_of_range') {
          // Fail-closed: весь запрошенный шаг завершается отказом;
          // реакция НЕ пропускается молча и НЕ экстраполируется.
          throw new KineticMechanismError(
            'temperature_out_of_range',
            'запись ' + def.reactionId + ' неприменима при ' + input.temperatureK + ' K: весь запрошенный шаг завершается контролируемым отказом (молчаливый пропуск и экстраполяция запрещены)',
            { reactionId: def.reactionId, temperatureK: input.temperatureK }
          );
        }
        if (e.code === 'no_kinetic_data' || e.code === 'invalid_third_body') {
          throw new KineticMechanismError(
            'no_kinetic_data',
            'вычислитель k(T) отклонил запись ' + def.reactionId + ': ' + e.message,
            { reactionId: def.reactionId, kineticsErrorCode: e.code }
          );
        }
        throw new KineticMechanismError(
          'invalid_input',
          'вычислитель k(T) отклонил запись ' + def.reactionId + ': ' + e.message,
          { reactionId: def.reactionId, kineticsErrorCode: e.code }
        );
      }
      throw e;
    }
    if (evaluation.dataStatus !== 'known') {
      throw new KineticMechanismError(
        'no_kinetic_data',
        'вычислитель вернул для записи ' + def.reactionId + ' статус ' + evaluation.dataStatus + ' вместо known: результат НЕ выдаётся',
        { reactionId: def.reactionId }
      );
    }
    if (evaluation.unit !== 'cm3_per_molecule_per_s' || evaluation.concentrationModel !== 'molecule_cm3') {
      throw new KineticMechanismError(
        'invalid_input',
        'запись ' + def.reactionId + ': единица константы не соответствует контракту механизма (нужна cm³ molecule⁻¹ s⁻¹ при концентрациях molecule/cm³)',
        { reactionId: def.reactionId }
      );
    }
    const fallOff = evaluation.fallOff;
    const provenance = evaluation.provenance;
    if (!fallOff || !provenance) {
      throw new KineticMechanismError(
        'invalid_input',
        'запись ' + def.reactionId + ': вычислитель не вернул обязательные fall-off диагностику или provenance — результат НЕ выдаётся',
        { reactionId: def.reactionId }
      );
    }
    reactions.push({
      reactionId: def.reactionId,
      label: def.label,
      dataStatus: evaluation.dataStatus,
      rateConstant: { value: evaluation.value, unit: evaluation.unit },
      appliedRangeK: evaluation.appliedRangeK,
      provenance,
      parameterProvenance: {
        lowPressureLimit: fallOffParameters.lowPressureLimit.provenance,
        highPressureLimit: fallOffParameters.highPressureLimit.provenance,
        broadening: fallOffParameters.provenance
      },
      fallOff
    });
    rates.push(evaluation.value);
  }

  // Предупреждения о нерешённых ограничениях применимости (не маскируются).
  if (selected.some((d) => d.reactionId === 'kida-tb-2015-03-19-89')) {
    warnings.push(
      'запись №89 (kida-tb-2015-03-19-89): контрольная точка IUPAC NOx1 формулой 4.5.2 НЕ воспроизводится (относительное расхождение около 46%) — расхождение зафиксировано в provenance записи каталога и остаётся НЕРАЗРЕШЁННЫМ; параметры не менялись ради согласования; вычисленная константа — результат формулы 4.5.2, а НЕ экспериментальное измерение'
    );
  }
  if (selected.some((d) => d.reactionId === 'kida-tb-2015-03-19-106')) {
    warnings.push(
      'запись №106 (kida-tb-2015-03-19-106): low-pressure limit расходится с альтернативной прямой N₂-серией Hsu et al. 1987/1989 (примерно в 1.4–1.5 раза) — расхождение зафиксировано в provenance записи каталога, серии НЕ смешиваются, расхождение НЕ разрешено'
    );
  }

  // 5. Вектор состояния: изменяемые виды выбранных реакций (без N₂).
  const speciesOrder: string[] = [];
  for (const def of selected) {
    for (const species of def.species) {
      if (!speciesOrder.includes(species)) {
        speciesOrder.push(species);
      }
    }
  }
  const y0: number[] = [];
  for (const species of speciesOrder) {
    const value = validated.get(species);
    if (value === undefined) {
      throw new KineticMechanismError(
        'invalid_input',
        'отсутствует концентрация вида "' + species + '" — отсутствующее поле есть ошибка входа, а не молчаливый ноль',
        { species }
      );
    }
    y0.push(value);
  }
  const indexOf = (species: string): number => speciesOrder.indexOf(species);

  // Неотрицательность: все физические концентрации решателя (без clipping).
  const nonNegativeIndices: number[] = speciesOrder.map((_, i) => i);

  // Линейные инварианты элементного состава; expected вычисляется по y0.
  const linearInvariants: LinearInvariant[] = [];
  for (const def of selected) {
    for (const invariant of def.invariants) {
      const coefficients = new Array<number>(speciesOrder.length).fill(0);
      for (let i = 0; i < def.species.length; i++) {
        coefficients[indexOf(def.species[i])] = invariant.coefficients[i];
      }
      let expected = 0;
      for (let i = 0; i < speciesOrder.length; i++) {
        expected += coefficients[i] * y0[i];
      }
      linearInvariants.push({ coefficients, expected });
    }
  }

  // 6. RHS и аналитический якобиан.
  // Для каждой выбранной реакции r = k(T, [N₂]) · [A] · [B];
  // k зафиксированы на шаге (T и [N₂] постоянны), поэтому
  // ∂r/∂[A] = k·[B], ∂r/∂[B] = k·[A] — аналитический якобиан точен.
  const terms = selected.map((def, i) => ({
    k: rates[i],
    iA: indexOf(def.reactants[0]),
    iB: indexOf(def.reactants[1]),
    iP: indexOf(def.product)
  }));
  const rhs = (_t: number, y: readonly number[]): number[] => {
    const dy = new Array<number>(speciesOrder.length).fill(0);
    for (const term of terms) {
      const rate = term.k * y[term.iA] * y[term.iB];
      dy[term.iA] -= rate;
      dy[term.iB] -= rate;
      dy[term.iP] += rate;
    }
    return dy;
  };
  const jacobian = (_t: number, y: readonly number[]): number[][] => {
    const n = speciesOrder.length;
    const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const term of terms) {
      const { k, iA, iB, iP } = term;
      J[iA][iA] += -k * y[iB];
      J[iA][iB] += -k * y[iA];
      J[iB][iA] += -k * y[iB];
      J[iB][iB] += -k * y[iA];
      J[iP][iA] += k * y[iB];
      J[iP][iB] += k * y[iA];
    }
    return J;
  };

  const problem: OdeSolverProblem = {
    kind: 'ode',
    stateDimension: speciesOrder.length,
    t0: 0,
    tEnd: input.dtSeconds,
    y0,
    rhs,
    jacobian,
    nonNegativeIndices,
    linearInvariants,
    description:
      'ограниченный концентрационный кинетический механизм 4.5.5 (' +
      selected.map((d) => d.reactionId).join(' + ') +
      '), T = ' + input.temperatureK + ' K, [N₂] = ' + thirdBodyN2 + ' molecule/cm³'
  };

  return {
    problem,
    speciesOrder,
    temperatureK: input.temperatureK,
    dtSeconds: input.dtSeconds,
    thirdBodyN2MoleculeCm3: thirdBodyN2,
    reactions,
    warnings
  };
}

// ============================================
// 5. КОНЦЕНТРАЦИОННЫЙ КИНЕТИЧЕСКИЙ ШАГ
// ============================================

/**
 * Один концентрационный кинетический шаг ограниченного механизма
 * (записи №89/№106). Интегрирование — существующим Radau IIA
 * (3 стадии, порядок 5, L-stable) с аналитическим якобианом,
 * неотрицательностью и линейными инвариантами контракта решателя.
 *
 * Контракт результата:
 * - 'applied' возвращается ТОЛЬКО вместе с полным численным решением;
 *   любой отказ решателя — KineticMechanismError('integration_failure')
 *   с кодом решателя в details, БЕЗ частичной фиксации результата;
 * - вход НЕ мутируется; concentrations в результате — новый объект;
 * - N₂ (третье тело) в вектор состояния не входит и не расходуется;
 * - предупреждения о нерешённых ограничениях применимости (IUPAC NOx1
 *   для №89, альтернативная серия Hsu для №106) переносятся в
 *   warnings и НЕ маскируются.
 *
 * Отдельный stateless-механизмный API: НЕ подключён к
 * runChemicalEvolutionStep()/GeneratedWorld; game-величины НЕ участвуют.
 */
export function runConcentrationKineticStep(
  input: ConcentrationKineticStepInput,
  catalog?: KineticsCatalog
): ConcentrationKineticStepResult {
  const built = buildConcentrationKineticProblem(input, catalog);
  // 'applied' возвращается ТОЛЬКО вместе с полным численным решением:
  // любой отказ решателя пробрасывается как контролируемый отказ
  // integration_failure, частичной фиксации результата не существует.
  const solved: OdeSolverResult = (() => {
    try {
      return solveOdeWithRadauIia(built.problem);
    } catch (e) {
      if (e instanceof OdeSolverError) {
        throw new KineticMechanismError(
          'integration_failure',
          'интегрирование Radau IIA завершилось отказом, результат НЕ зафиксирован частично: ' + e.message,
          { solverErrorCode: e.code }
        );
      }
      throw e;
    }
  })();
  const concentrations: Record<string, number> = {};
  built.speciesOrder.forEach((species, i) => {
    concentrations[species] = solved.y[i];
  });
  return {
    status: 'applied',
    concentrationModel: 'molecule_cm3',
    reactionIds: [...input.reactionIds],
    temperatureK: built.temperatureK,
    dtSeconds: built.dtSeconds,
    thirdBodyN2MoleculeCm3: built.thirdBodyN2MoleculeCm3,
    speciesOrder: [...built.speciesOrder],
    concentrations,
    reactions: built.reactions,
    integration: {
      method: solved.method,
      stats: solved.stats,
      minorNegativeCount: solved.diagnostics.minorNegativeCount,
      invariantChecks: solved.diagnostics.invariantChecks
    },
    warnings: built.warnings,
    notes: [
      'stateless концентрационный механизмный API: к runChemicalEvolutionStep()/GeneratedWorld НЕ подключён; конверсия inventory (моль/м² атмосферного столба) в molecule/cm³ НЕ выполняется — физического контракта концентраций атмосферного столба нет (объём/толщина кинетического слоя не заданы)',
      'N₂ — третье тело (bath gas): концентрация передана вызывающей стороной явно, в векторе состояния отсутствует и не расходуется',
      'время шага — физические секунды; game-величины (extentFraction, gameSpeedCoefficient, игровые годы) НЕ участвуют',
      'записи №1/№70/№72 остаются unknown (no_kinetic_data) и в механизм НЕ входят; этап 4.5.5 этим срезом НЕ завершён',
      'результат — численное интегрирование по параметризациям каталога: экспериментальная подтверждённость для произвольной планетарной атмосферы НЕ заявляется'
    ]
  };
}
