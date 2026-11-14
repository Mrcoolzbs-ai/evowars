// ============================================
// PR REACTIVE GAS EQUILIBRIUM — чистый Core-решатель
// реактивного газового равновесия с Peng–Robinson
// (Stage 4.4.4.8-B2)
// ============================================
//
// Внешний fixed-point цикл по компонентным ln(phi) поверх
// СУЩЕСТВУЮЩЕГО идеальногазового решателя равновесия:
//
//   mu_i/(RT) = g_i°/(RT) + ln(x_i) + ln(P/p°) + ln(phi_i(x))
//
// На внешней итерации k внутренний решатель получает эффективные
// стандартные потенциалы
//
//   gEffective_i/(RT) = g_i°/(RT) + lnPhiUsed_i(k),
//
// решает ОБЫЧНУЮ идеальногазовую задачу (solveEquilibriumWithDiagnostics,
// без изменения её контракта), затем по найденному составу
// вычисляются PR-фугитивности (computePengRobinsonMixture, строго
// root: 'vapor') и получается целевой вектор lnPhiTarget.
// Fixed-point остаток
//
//   r_i = lnPhiTarget_i − lnPhiUsed_i,
//   fixedPointResidual = max_i |r_i|
//
// демпфированно сводится к нулю:
//
//   lnPhiUsed_i(next) = lnPhiUsed_i(current) + lambda·r_i.
//
// Начальное приближение lnPhiUsed_i(0) = 0 — только стартовая точка
// итерации, а НЕ утверждение, что смесь идеальна.
//
// ГРАНИЦЫ ЧЕСТНОСТИ (Stage 4.4.4.8-B2):
// - это ОДНОФАЗНЫЙ vapor-кандидат: глобальная фазовая устойчивость
//   НЕ проверяется, конденсированные фазы НЕ рассчитываются
//   (постоянное предупреждение в каждом результате);
// - внутренний решатель остаётся идеальногазовым; его контракт,
//   арифметика и результаты НЕ меняются;
// - все EOS/BIP-параметры передаются ЯВНО: каталогового lookup в
//   Core нет (каталоговый Data-фасад — отдельный следующий подэтап);
// - status 'candidate_converged' — кандидат равновесия, а не
//   доказанная глобальная устойчивость; статусы stable /
//   globally_stable / phase_stable / global_minimum в этот модуль
//   НЕ вводятся;
// - несходимые результаты НЕ выдают состав за равновесный.
//
// Запрещённые зависимости соблюдены: импорты только из Core
// (equilibrium, pengRobinsonMixture, physicalQuantity,
// thermoFunctions). Импортов из Data, PhaseEquilibrium, Atmosphere
// и UI нет.

import {
  EquilibriumError,
  solveEquilibriumWithDiagnostics
} from './equilibrium';
import type {
  EquilibriumOptions,
  EquilibriumProblem,
  EquilibriumSpecies,
  EquilibriumStationarityDiagnostics
} from './equilibrium';
import {
  computePengRobinsonMixture,
  validatePengRobinsonMixtureInputsStrict
} from './pengRobinsonMixture';
import type {
  PengRobinsonBinaryInteractionInput,
  PengRobinsonMixtureBinaryInteractionUsed,
  PengRobinsonMixtureComponentInput,
  PengRobinsonMixtureWarning,
  PengRobinsonStrictInputDeficiency
} from './pengRobinsonMixture';
import type {
  PengRobinsonCrossCheck,
  PengRobinsonEvidencePolicy,
  PengRobinsonParameterEvidence
} from './pengRobinson';
import type { PhysicalQuantity } from './physicalQuantity';
import {
  convert,
  dimension,
  dimensionOf,
  isKnownUnit,
  sameDimension
} from './physicalQuantity';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from './thermoFunctions';

const TEMPERATURE_DIMENSION = dimension(0, 0, 0, 1);
const PRESSURE_DIMENSION = dimension(1, -1, -2);

// ============================================
// 1. ТИПЫ: ВХОД
// ============================================

/** Операция для сообщений об ошибках модуля. */
const OP = 'solveReactiveGasEquilibriumWithPengRobinson';

/**
 * Химический вид реактивной PR-задачи: те же данные, что у
 * EquilibriumSpecies (g°/(R·T) из вызывающего слоя), плюс ЯВНЫЕ
 * чистокомпонентные PR-параметры с evidence и ограничениями
 * применимости. Идентификатор PR-компонента обязан совпадать с
 * id вида; отдельного поля component во входе нет (оно
 * подставляется из id при вызове смесевого вычислителя).
 */
export interface PrReactiveEquilibriumSpecies extends EquilibriumSpecies {
  /** Явные чистокомпонентные PR-параметры (без component/moleFraction). */
  readonly eos: Omit<PengRobinsonMixtureComponentInput, 'component' | 'moleFraction'>;
}

/** Опции внешнего fixed-point цикла (все с разумными дефолтами). */
export interface PrReactiveGasEquilibriumOptions {
  /** Максимум внешних итераций (>= 1; по умолчанию 100). */
  readonly maxOuterIterations?: number;
  /** Допуск fixed-point остатка и изменения вектора (по умолчанию 1e-10). */
  readonly outerTolerance?: number;
  /** Пол демпфирования lambda (по умолчанию 1/1024). */
  readonly minDamping?: number;
  /** Окно детектора застоя (по умолчанию 5). */
  readonly stagnationWindow?: number;
  /** Порог «изменение уже не меняет ничего» (по умолчанию 1e-14). */
  readonly stagnationEpsilon?: number;
  /** Опции внутреннего идеальногазового решателя. */
  readonly innerOptions?: EquilibriumOptions;
}

/**
 * Запрос реактивного газового равновесия с PR EOS. Температура и
 * давления — физические величины с размерностями (не голые числа);
 * все EOS/BIP-параметры и evidence — ЯВНО, без каталогового lookup.
 */
export interface PrReactiveGasEquilibriumRequest {
  readonly temperature: PhysicalQuantity;
  readonly pressure: PhysicalQuantity;
  readonly standardStatePressure: PhysicalQuantity;
  readonly species: readonly PrReactiveEquilibriumSpecies[];
  /** Итоги по элементам, моль (ключ — имя элемента). */
  readonly elementTotals: Readonly<Record<string, number>>;
  /** Итоговый заряд смеси, моль элементарных зарядов. */
  readonly chargeTotal: number;
  /** Явные бинарные параметры взаимодействия (kij) с evidence. */
  readonly binaryInteractions: readonly PengRobinsonBinaryInteractionInput[];
  /** Обязательная политика доказанности PR-данных. */
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
  readonly options?: PrReactiveGasEquilibriumOptions;
}

// ============================================
// 2. ТИПЫ: РЕЗУЛЬТАТ
// ============================================

/** Коды предупреждений реактивного PR-решателя. */
export type PrReactiveGasEquilibriumWarningCode =
  | 'single_phase_vapor_candidate_without_phase_stability'
  | 'partially_verified_parameter'
  | 'unresolved_cross_check_parameter'
  | 'partially_verified_binary_interaction'
  | 'single_physical_root'
  | 'h2o_classical_pr_limitations'
  | 'zero_element_total_species_excluded';

/** Предупреждение результата: код + описание. */
export interface PrReactiveGasEquilibriumWarning {
  readonly code: PrReactiveGasEquilibriumWarningCode;
  readonly message: string;
}

/**
 * Использованные чистокомпонентные PR-входы (значения и их
 * evidence/limitations). Это НЕ каталоговый provenance: переданные
 * вызывающим слоем значения возвращаются как есть; замороженные
 * provenance-объекты каталогов добавит Data-фасад следующего
 * подэтапа.
 */
export interface PrReactiveEosInputUsed {
  readonly speciesId: string;
  readonly criticalTemperatureK: number;
  readonly criticalPressurePa: number;
  readonly acentricFactor: number;
  readonly evidence: PengRobinsonParameterEvidence;
  readonly crossChecks: readonly PengRobinsonCrossCheck[];
  readonly limitations: readonly string[];
}

/**
 * Успешный результат: ОДНОФАЗНЫЙ vapor-кандидат равновесия
 * (candidate_converged — не доказанная глобальная устойчивость).
 * Все числа конечны; ln(0) не вычисляется (виды с нулевыми
 * итогами элементов имеют ровно нулевые доли и количества).
 */
export interface PrReactiveGasEquilibriumSuccess {
  readonly status: 'candidate_converged';
  readonly model: 'peng_robinson_vapor';
  readonly root: 'vapor';

  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly standardStatePressurePa: number;

  /** Полное число молей смеси (из внутреннего решения). */
  readonly totalMoles: number;
  readonly moleFractions: Readonly<Record<string, number>>;
  readonly speciesMoles: Readonly<Record<string, number>>;

  /** Невязки всех исходных элементных балансов, моль. */
  readonly elementResiduals: Readonly<Record<string, number>>;
  readonly chargeResidual: number;

  /** Демпфированный вектор ln(phi), на котором сошёлся цикл. */
  readonly lnPhiUsed: Readonly<Record<string, number>>;
  /** max_i |lnPhiTarget_i − lnPhiUsed_i| на финальном составе. */
  readonly lnPhiFixedPointResidual: number;

  /**
   * Прямая PR-невязка стационарности по АКТИВНЫМ видам:
   * internalStationarityResidual_i + lnPhiTarget_i − lnPhiUsed_i.
   */
  readonly stationarityResidual: Readonly<Record<string, number>>;
  readonly maxAbsStationarityResidual: number;

  /** Диагностика B1 внутреннего решения на финальной итерации. */
  readonly stationarityDiagnostics: EquilibriumStationarityDiagnostics;

  readonly outerIterations: number;
  /** Суммарное число итераций Ньютона внутреннего решателя. */
  readonly innerIterations: number;
  readonly finalDamping: number;
  readonly dampingEscalations: number;
  readonly oscillationDetected: boolean;

  /** Полная энергия Гиббса PR-задачи, Дж (не значение ideal_gas). */
  readonly gibbsEnergy: number;

  readonly eosInputsUsed: readonly PrReactiveEosInputUsed[];
  readonly binaryInteractionsUsed: readonly PengRobinsonMixtureBinaryInteractionUsed[];

  readonly warnings: readonly PrReactiveGasEquilibriumWarning[];
  readonly notes: readonly string[];
  readonly interpretationLimitation: string;
}

/**
 * Несходимый результат. Состав НЕ выдаётся за равновесный;
 * сохраняются диагностические поля: последний fixed-point остаток,
 * числа итераций, lambda, внутренний статус и код ошибки нижнего
 * слоя. Для unsupported_eos_data — ПОЛНЫЙ список дефицитов данных.
 */
export interface PrReactiveGasEquilibriumFailure {
  readonly status: 'max_iterations' | 'stagnated' | 'numerical_failure' | 'unsupported_eos_data';
  readonly model: 'peng_robinson_vapor';
  readonly root: 'vapor';

  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly standardStatePressurePa: number;

  /** Код причины: собственный или нижнего слоя (inner:/pr:). */
  readonly code: string;
  readonly message: string;

  readonly outerIterations: number;
  readonly innerIterations: number;
  readonly finalDamping: number;

  /** Последний fixed-point остаток (null, если не вычислялся). */
  readonly lastFixedPointResidual: number | null;
  /** Последний вектор lnPhiUsed (null, если не вычислялся). */
  readonly lastLnPhiUsed: Readonly<Record<string, number>> | null;
  /** Последний состав внутреннего решения (null, если недоступен). */
  readonly lastMoleFractions: Readonly<Record<string, number>> | null;

  /** Статус внутреннего идеальногазового решателя, если был вызван. */
  readonly innerStatus: string | null;
  /** Сообщение внутреннего решателя, если было. */
  readonly innerResultMessage: string | null;

  /** Полный список дефицитов EOS/BIP-данных (unsupported_eos_data). */
  readonly deficiencies: readonly PengRobinsonStrictInputDeficiency[];

  readonly warnings: readonly PrReactiveGasEquilibriumWarning[];
  readonly notes: readonly string[];
}

/** Discriminated union результата реактивного PR-решателя. */
export type PrReactiveGasEquilibriumResult =
  | PrReactiveGasEquilibriumSuccess
  | PrReactiveGasEquilibriumFailure;

/**
 * Постоянная граница честности каждого результата: однофазный
 * vapor-кандидат без проверки глобальной фазовой устойчивости и
 * без расчёта конденсированных фаз.
 */
export const PR_REACTIVE_GAS_EQUILIBRIUM_LIMITATION: string =
  'Однофазный vapor-кандидат равновесия Peng–Robinson: глобальная ' +
  'фазовая устойчивость НЕ проверена, конденсированные фазы НЕ ' +
  'рассчитаны (flash/VLE/LLE и validated TPD error bound вне объёма ' +
  'Stage 4.4.4.8-B2); candidate_converged НЕ тождественен ' +
  'термодинамически стабильному состоянию.';

/** Заметка о схеме инициализации (в каждом успехе). */
const INITIALIZATION_NOTE: string =
  'Инициализация lnPhiUsed = 0 — только стартовая точка внешнего ' +
  'fixed-point цикла по компонентным ln(phi), а не утверждение, что ' +
  'смесь идеальна; сходимость определяется независимым fixed-point ' +
  'остатком max_i |lnPhiTarget_i − lnPhiUsed_i|.';

// ============================================
// 3. ПРОВЕРКА ВХОДА (FAIL-CLOSED)
// ============================================

/**
 * Величина конечна, имеет известную единицу нужной размерности;
 * возвращает её в целевой единице. Бросает EquilibriumError
 * (invalid_input) на повреждённом входе — без подстановок.
 * (Та же семантика, что у приватного requireQuantity
 * equilibrium.ts; там он не экспортируется.)
 */
function requireQuantity(
  value: PhysicalQuantity,
  expectedDimension: ReturnType<typeof dimension>,
  targetUnit: string,
  what: string
): PhysicalQuantity {
  if (value === null || typeof value !== 'object') {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `${what} должна быть величиной {value, unit}`
    });
  }
  const q = value as PhysicalQuantity;
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `значение ${what} должно быть конечным числом, получено ${String(q.value)}`
    });
  }
  if (
    typeof q.unit !== 'string' ||
    !isKnownUnit(q.unit) ||
    !sameDimension(dimensionOf(q), expectedDimension)
  ) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `${what} должна иметь размерность единицы «${targetUnit}», получена единица «${String(q.unit)}»`,
      details: `ожидаемая единица: ${targetUnit}`
    });
  }
  return convert(q, targetUnit);
}

/** Проверенные опции внешнего цикла. */
interface ParsedOuterOptions {
  maxOuterIterations: number;
  outerTolerance: number;
  minDamping: number;
  stagnationWindow: number;
  stagnationEpsilon: number;
  innerOptions: EquilibriumOptions | undefined;
}

/** Проверка опций: невалидные значения отклоняются, дефолты — по дизайн-документу. */
function parseOuterOptions(options: PrReactiveGasEquilibriumOptions | undefined): ParsedOuterOptions {
  const o = options ?? {};
  const maxOuterIterations = o.maxOuterIterations ?? 100;
  if (!Number.isInteger(maxOuterIterations) || maxOuterIterations < 1) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `maxOuterIterations должен быть целым числом >= 1, получено ${String(maxOuterIterations)}`
    });
  }
  const outerTolerance = o.outerTolerance ?? 1e-10;
  if (typeof outerTolerance !== 'number' || !Number.isFinite(outerTolerance) || outerTolerance <= 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `outerTolerance должен быть конечным положительным числом, получено ${String(outerTolerance)}`
    });
  }
  const minDamping = o.minDamping ?? 1 / 1024;
  if (typeof minDamping !== 'number' || !Number.isFinite(minDamping) || minDamping <= 0 || minDamping > 1) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `minDamping должен быть конечным числом в (0, 1], получено ${String(minDamping)}`
    });
  }
  const stagnationWindow = o.stagnationWindow ?? 5;
  if (!Number.isInteger(stagnationWindow) || stagnationWindow < 1) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `stagnationWindow должен быть целым числом >= 1, получено ${String(stagnationWindow)}`
    });
  }
  const stagnationEpsilon = o.stagnationEpsilon ?? 1e-14;
  if (typeof stagnationEpsilon !== 'number' || !Number.isFinite(stagnationEpsilon) || stagnationEpsilon <= 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `stagnationEpsilon должен быть конечным положительным числом, получено ${String(stagnationEpsilon)}`
    });
  }
  return {
    maxOuterIterations,
    outerTolerance,
    minDamping,
    stagnationWindow,
    stagnationEpsilon,
    innerOptions: o.innerOptions
  };
}

/** Преобразование предупреждений смесевого вычислителя в свои. */
function mapMixtureWarning(w: PengRobinsonMixtureWarning): PrReactiveGasEquilibriumWarning {
  return { code: w.code as PrReactiveGasEquilibriumWarningCode, message: w.message };
}

// ============================================
// 4. РЕШАТЕЛЬ: ВНЕШНИЙ FIXED-POINT ЦИКЛ ПО ln(phi)
// ============================================

/**
 * Детерминированное адаптивное демпфирование (правило вынесено в
 * отдельный helper для прямого тестирования обновлений; случайности,
 * времени и недетерминированного выбора нет):
 *
 * - рост нормы fixed-point остатка относительно предыдущей итерации —
 *   lambda делится пополам (эскалация);
 * - осцилляция «вниз-вверх» (невязка выросла после локального
 *   минимума два шага назад) — ещё одно деление пополам и флаг
 *   oscillationDetected;
 * - lambda не опускается ниже minDamping.
 */
export function prReactiveDampingUpdate(
  lambda: number,
  residual: number,
  previousResidual: number,
  residualTwoStepsAgo: number,
  minDamping: number
): { lambda: number; escalated: boolean; oscillation: boolean } {
  let next = lambda;
  let escalated = false;
  let oscillation = false;
  const growth = residual > previousResidual;
  if (growth) {
    next = Math.max(next / 2, minDamping);
    escalated = true;
  }
  if (growth && previousResidual < residualTwoStepsAgo) {
    oscillation = true;
    next = Math.max(next / 2, minDamping);
  }
  return { lambda: next, escalated, oscillation };
}

/**
 * Чистый Core-решатель реактивного газового равновесия с
 * Peng–Robinson (Stage 4.4.4.8-B2): внешний последовательный
 * fixed-point цикл по компонентным ln(phi) вокруг внутреннего
 * идеальногазового решателя.
 *
 * До ПЕРВОЙ итерации все PR-входы проверяются строго (все виды и
 * ВСЕ пары, включая виды с нулевыми итогами элементов): дефицит
 * данных — структурированный отказ unsupported_eos_data с полным
 * списком, без удаления видов и без изменения элементного баланса.
 */
export function solveReactiveGasEquilibriumWithPengRobinson(
  request: PrReactiveGasEquilibriumRequest
): PrReactiveGasEquilibriumResult {
  if (request === null || typeof request !== 'object') {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: 'запрос должен быть объектом PrReactiveGasEquilibriumRequest'
    });
  }
  const parsed = parseOuterOptions(request.options);

  // --- Физические величины -> K, Pa (fail-closed, без предположений) ---
  const temperature = requireQuantity(request.temperature, TEMPERATURE_DIMENSION, 'K', 'температура');
  if (temperature.value <= 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `температура должна быть положительной, получено ${temperature.value} K`
    });
  }
  const pressure = requireQuantity(request.pressure, PRESSURE_DIMENSION, 'Pa', 'давление');
  const standard = requireQuantity(
    request.standardStatePressure,
    PRESSURE_DIMENSION,
    'Pa',
    'давление стандартного состояния'
  );
  if (pressure.value <= 0 || standard.value <= 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: `давление и давление стандартного состояния должны быть положительными, получено P=${pressure.value} Pa, p°=${standard.value} Pa`
    });
  }
  const temperatureK = temperature.value;
  const pressurePa = pressure.value;
  const standardStatePressurePa = standard.value;
  const logPressureRatio = Math.log(standardStatePressurePa / pressurePa);

  // --- Виды: базовая форма (химические данные валидирует внутренний решатель) ---
  if (!Array.isArray(request.species) || request.species.length === 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: OP,
      message: 'список видов не может быть пустым'
    });
  }
  const seenIds = new Set<string>();
  for (const s of request.species) {
    if (s === null || typeof s !== 'object') {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: OP,
        message: 'вид должен быть объектом PrReactiveEquilibriumSpecies'
      });
    }
    if (typeof s.id !== 'string' || s.id.length === 0) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: OP,
        message: 'id вида должен быть непустой строкой'
      });
    }
    if (seenIds.has(s.id)) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: OP,
        message: `id видов должны быть уникальны, повтор: «${s.id}»`
      });
    }
    seenIds.add(s.id);
  }
  const species = request.species;
  const ids = species.map((s) => s.id);

  // --- Строгая предитерационная проверка PR-входов (все виды и ВСЕ пары) ---
  const components = species.map((s) => {
    const eos = (s.eos ?? {}) as Record<string, unknown>;
    return {
      component: s.id,
      criticalTemperatureK: eos.criticalTemperatureK,
      criticalPressurePa: eos.criticalPressurePa,
      acentricFactor: eos.acentricFactor,
      evidence: eos.evidence,
      crossChecks: eos.crossChecks,
      limitations: eos.limitations
    } as unknown as Omit<PengRobinsonMixtureComponentInput, 'moleFraction'>;
  });
  const strictCheck = validatePengRobinsonMixtureInputsStrict(
    components,
    request.binaryInteractions,
    temperatureK,
    request.evidencePolicy
  );
  const strictWarnings = strictCheck.warnings.map(mapMixtureWarning);
  if (!strictCheck.ok) {
    return {
      status: 'unsupported_eos_data',
      model: 'peng_robinson_vapor',
      root: 'vapor',
      temperatureK,
      pressurePa,
      standardStatePressurePa,
      code: 'unsupported_eos_data',
      message:
        `EOS/BIP-данные не проходят строгую предитерационную проверку ` +
        `(${strictCheck.deficiencies.length} дефицитов); реактивная задача честно отказывает, ` +
        `виды не удаляются и элементный баланс не меняется`,
      outerIterations: 0,
      innerIterations: 0,
      finalDamping: 1,
      lastFixedPointResidual: null,
      lastLnPhiUsed: null,
      lastMoleFractions: null,
      innerStatus: null,
      innerResultMessage: null,
      deficiencies: strictCheck.deficiencies,
      warnings: withConstantWarnings(strictWarnings, false),
      notes: [
        'Строгая проверка выполнена ДО первой итерации для ВСЕХ видов и ВСЕХ пар, ' +
        'включая виды с нулевыми итогами элементов; молчаливая подстановка kij = 0 запрещена.'
      ]
    };
  }

  // --- Внешний цикл ---
  const lnPhiUsed: Record<string, number> = {};
  for (const id of ids) {
    lnPhiUsed[id] = 0;
  }
  const gStandardOverRT: Record<string, number> = {};
  for (const s of species) {
    gStandardOverRT[s.id] = s.gStandardOverRT;
  }

  let lambda = 1;
  let dampingEscalations = 0;
  let oscillationDetected = false;
  // Изменение демпфированного вектора на последнем обновлении;
  // до первого обновления вектор не менялся (0).
  let lastChange = 0;
  let prevResidual = Infinity;
  let prev2Residual = Infinity;
  let stagnationCount = 0;
  let innerIterationsTotal = 0;
  let lastFpResidual: number | null = null;
  let lastLnPhiUsedSnapshot: Record<string, number> | null = null;
  let lastFractionsSnapshot: Record<string, number> | null = null;
  let lastInnerStatus: string | null = null;
  let lastInnerMessage: string | null = null;
  let prevLnPhiUsed: Record<string, number> | null = null;
  // Предупреждения последнего успешного PR-вызова (финальный состав).
  let lastPrWarnings: PrReactiveGasEquilibriumWarning[] = [];
  let lastBinaryInteractionsUsed: PengRobinsonMixtureBinaryInteractionUsed[] = [];

  const buildProblem = (): EquilibriumProblem => ({
    temperature: request.temperature,
    pressure: request.pressure,
    standardStatePressure: request.standardStatePressure,
    species: species.map((s) => ({
      id: s.id,
      elements: s.elements,
      charge: s.charge,
      gStandardOverRT: s.gStandardOverRT + lnPhiUsed[s.id]
    })),
    elementTotals: request.elementTotals,
    chargeTotal: request.chargeTotal,
    options: parsed.innerOptions
  });

  const innerTolerance = parsed.innerOptions?.tolerance ?? 1e-13;

  for (let outer = 1; outer <= parsed.maxOuterIterations; outer += 1) {
    // 1. Внутреннее идеальногазовое решение с gEffective = g° + lnPhiUsed.
    const detailed = solveEquilibriumWithDiagnostics(buildProblem());
    innerIterationsTotal += detailed.result.iterations;
    lastInnerStatus = detailed.result.status;
    lastInnerMessage = detailed.result.message;
    if (detailed.result.status !== 'converged') {
      // Внутренняя несходимость не объявляется успешным решением.
      return {
        status: 'numerical_failure',
        model: 'peng_robinson_vapor',
        root: 'vapor',
        temperatureK,
        pressurePa,
        standardStatePressurePa,
        code: `inner:${detailed.result.status}`,
        message:
          `внутренний идеальногазовый решатель не сошёлся на внешней итерации ${outer} ` +
          `(статус ${detailed.result.status}); состав не выдаётся за равновесный: ${detailed.result.message}`,
        outerIterations: outer,
        innerIterations: innerIterationsTotal,
        finalDamping: lambda,
        lastFixedPointResidual: lastFpResidual,
        lastLnPhiUsed: lastLnPhiUsedSnapshot !== null ? { ...lastLnPhiUsedSnapshot } : { ...lnPhiUsed },
        lastMoleFractions: lastFractionsSnapshot,
        innerStatus: detailed.result.status,
        innerResultMessage: detailed.result.message,
        deficiencies: [],
        warnings: withConstantWarnings(strictWarnings, hasExcludedSpecies(detailed)),
        notes: []
      };
    }
    const diag = detailed.stationarityDiagnostics;
    if (diag === null) {
      return {
        status: 'numerical_failure',
        model: 'peng_robinson_vapor',
        root: 'vapor',
        temperatureK,
        pressurePa,
        standardStatePressurePa,
        code: `inner:diagnostics_${detailed.diagnosticsUnavailableReason ?? 'unavailable'}`,
        message:
          `диагностика стационарности B1 недоступна на внешней итерации ${outer} ` +
          `(${detailed.diagnosticsUnavailableReason ?? 'причина не сообщена'}); ` +
          `кандидат равновесия без диагностики не выдаётся`,
        outerIterations: outer,
        innerIterations: innerIterationsTotal,
        finalDamping: lambda,
        lastFixedPointResidual: lastFpResidual,
        lastLnPhiUsed: lastLnPhiUsedSnapshot !== null ? { ...lastLnPhiUsedSnapshot } : { ...lnPhiUsed },
        lastMoleFractions: lastFractionsSnapshot,
        innerStatus: detailed.result.status,
        innerResultMessage: detailed.result.message,
        deficiencies: [],
        warnings: withConstantWarnings(strictWarnings, hasExcludedSpecies(detailed)),
        notes: []
      };
    }
    const fractions = detailed.result.moleFractions;

    // 2. PR-фугитивности на фактическом составе (строго vapor-ветвь).
    const prResult = computePengRobinsonMixture(
      {
        components: species.map((s) => {
          const eos = (s.eos ?? {}) as Record<string, unknown>;
          return {
            component: s.id,
            moleFraction: fractions[s.id] ?? 0,
            criticalTemperatureK: eos.criticalTemperatureK,
            criticalPressurePa: eos.criticalPressurePa,
            acentricFactor: eos.acentricFactor,
            evidence: eos.evidence,
            crossChecks: eos.crossChecks,
            limitations: eos.limitations
          } as unknown as PengRobinsonMixtureComponentInput;
        }),
        binaryInteractions: request.binaryInteractions
      },
      {
        temperatureK,
        pressurePa,
        root: 'vapor',
        evidencePolicy: request.evidencePolicy
      }
    );
    if (prResult.status === 'failure') {
      // Демпфированный откат: вернуть lnPhiUsed к состоянию до
      // последнего обновления и уменьшить шаг (PR-отказ вызван
      // слишком агрессивным составом, а не данными: данные
      // проверены строго до цикла).
      if (prevLnPhiUsed !== null && lambda > parsed.minDamping) {
        for (const id of ids) {
          lnPhiUsed[id] = prevLnPhiUsed[id];
        }
        lambda = Math.max(lambda / 2, parsed.minDamping);
        dampingEscalations += 1;
        continue;
      }
      return {
        status: 'numerical_failure',
        model: 'peng_robinson_vapor',
        root: 'vapor',
        temperatureK,
        pressurePa,
        standardStatePressurePa,
        code: `pr:${prResult.code}`,
        message:
          `вычислитель PR-смеси отказал на внешней итерации ${outer} ` +
          `(код ${prResult.code}): ${prResult.message}`,
        outerIterations: outer,
        innerIterations: innerIterationsTotal,
        finalDamping: lambda,
        lastFixedPointResidual: lastFpResidual,
        lastLnPhiUsed: { ...lnPhiUsed },
        lastMoleFractions: { ...fractions },
        innerStatus: detailed.result.status,
        innerResultMessage: detailed.result.message,
        deficiencies: [],
        warnings: withConstantWarnings(strictWarnings, hasExcludedSpecies(detailed)),
        notes: []
      };
    }
    const pr = prResult;
    lastPrWarnings = pr.warnings.map(mapMixtureWarning);
    lastBinaryInteractionsUsed = pr.binaryInteractionsUsed;

    // 3. Целевой вектор и fixed-point остаток (по ВСЕМ видам;
    //    компоненты с нулевой долей имеют собственный lnPhi —
    //    фиктивных ln(0)-невязок нет).
    const lnPhiTarget: Record<string, number> = {};
    for (const c of pr.components) {
      lnPhiTarget[c.component] = c.lnPhi;
    }
    let fpResidual = 0;
    for (const id of ids) {
      const r = Math.abs(lnPhiTarget[id] - lnPhiUsed[id]);
      if (r > fpResidual) {
        fpResidual = r;
      }
    }
    if (!Number.isFinite(fpResidual)) {
      return {
        status: 'numerical_failure',
        model: 'peng_robinson_vapor',
        root: 'vapor',
        temperatureK,
        pressurePa,
        standardStatePressurePa,
        code: 'pr:non_finite_ln_phi',
        message: `fixed-point остаток по ln(phi) неконечен на внешней итерации ${outer}; надёжное решение невозможно`,
        outerIterations: outer,
        innerIterations: innerIterationsTotal,
        finalDamping: lambda,
        lastFixedPointResidual: null,
        lastLnPhiUsed: { ...lnPhiUsed },
        lastMoleFractions: { ...fractions },
        innerStatus: detailed.result.status,
        innerResultMessage: detailed.result.message,
        deficiencies: [],
        warnings: withConstantWarnings(strictWarnings, hasExcludedSpecies(detailed)),
        notes: []
      };
    }
    lastFpResidual = fpResidual;
    lastLnPhiUsedSnapshot = { ...lnPhiUsed };
    lastFractionsSnapshot = { ...fractions };

    // 4. Прямая PR-невязка стационарности АКТИВНЫХ видов:
    //    muPR_i = muIdealEffective_i + lnPhiTarget_i − lnPhiUsed_i,
    //    PRResidual_i = internalResidual_i + lnPhiTarget_i − lnPhiUsed_i.
    const stationarityResidual: Record<string, number> = {};
    let maxPrResidual = 0;
    let stationarityFinite = true;
    for (const id of diag.activeSpeciesIds) {
      const prResidual =
        diag.stationarityResidualOverRT[id] + lnPhiTarget[id] - lnPhiUsed[id];
      stationarityResidual[id] = prResidual;
      if (!Number.isFinite(prResidual)) {
        stationarityFinite = false;
      } else if (Math.abs(prResidual) > maxPrResidual) {
        maxPrResidual = Math.abs(prResidual);
      }
    }

    // 5. Независимая перепроверка C2-критерия внутренних ограничений.
    const c2Ok = checkElementChargeCriterion(
      detailed.result.elementResiduals,
      detailed.result.chargeResidual,
      request.elementTotals,
      request.chargeTotal,
      innerTolerance
    );

    // 6. Критерий кандидата равновесия: ВСЕ условия одновременно.
    if (
      fpResidual < parsed.outerTolerance &&
      lastChange < parsed.outerTolerance &&
      maxPrResidual < parsed.outerTolerance &&
      stationarityFinite &&
      c2Ok
    ) {
      // PR-вызов этой итерации уже выполнен на финальном составе:
      // lnPhiTarget — свежие значения, а не устаревший вектор.
      let gibbsSum = 0;
      for (const id of diag.activeSpeciesIds) {
        const x = fractions[id];
        if (x > 0) {
          gibbsSum += x * (gStandardOverRT[id] + Math.log(x) - logPressureRatio + lnPhiTarget[id]);
        }
      }
      const gibbsOverRT = detailed.result.totalMoles * gibbsSum;
      const gibbsEnergy = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * temperatureK * gibbsOverRT;
      if (!Number.isFinite(gibbsOverRT) || !Number.isFinite(gibbsEnergy)) {
        return {
          status: 'numerical_failure',
          model: 'peng_robinson_vapor',
          root: 'vapor',
          temperatureK,
          pressurePa,
          standardStatePressurePa,
          code: 'non_finite_gibbs_energy',
          message: 'энергия Гиббса PR-задачи неконечна; кандидат не выдаётся',
          outerIterations: outer,
          innerIterations: innerIterationsTotal,
          finalDamping: lambda,
          lastFixedPointResidual: fpResidual,
          lastLnPhiUsed: { ...lnPhiUsed },
          lastMoleFractions: { ...fractions },
          innerStatus: detailed.result.status,
          innerResultMessage: detailed.result.message,
          deficiencies: [],
          warnings: withConstantWarnings(strictWarnings, hasExcludedSpecies(detailed)),
          notes: []
        };
      }
      const warnings = dedupeWarnings([
        ...strictWarnings,
        ...lastPrWarnings,
        ...withConstantWarnings([], hasExcludedSpecies(detailed))
      ]);
      return {
        status: 'candidate_converged',
        model: 'peng_robinson_vapor',
        root: 'vapor',
        temperatureK,
        pressurePa,
        standardStatePressurePa,
        totalMoles: detailed.result.totalMoles,
        moleFractions: { ...fractions },
        speciesMoles: { ...detailed.result.speciesMoles },
        elementResiduals: { ...detailed.result.elementResiduals },
        chargeResidual: detailed.result.chargeResidual,
        lnPhiUsed: { ...lnPhiUsed },
        lnPhiFixedPointResidual: fpResidual,
        stationarityResidual,
        maxAbsStationarityResidual: maxPrResidual,
        stationarityDiagnostics: diag,
        outerIterations: outer,
        innerIterations: innerIterationsTotal,
        finalDamping: lambda,
        dampingEscalations,
        oscillationDetected,
        gibbsEnergy,
        eosInputsUsed: species.map((s) => ({
          speciesId: s.id,
          criticalTemperatureK: s.eos.criticalTemperatureK,
          criticalPressurePa: s.eos.criticalPressurePa,
          acentricFactor: s.eos.acentricFactor,
          evidence: s.eos.evidence,
          crossChecks: s.eos.crossChecks,
          limitations: s.eos.limitations
        })),
        binaryInteractionsUsed: lastBinaryInteractionsUsed,
        warnings,
        notes: [INITIALIZATION_NOTE],
        interpretationLimitation: PR_REACTIVE_GAS_EQUILIBRIUM_LIMITATION
      };
    }

    // 7. Адаптивное демпфирование (рост невязки, осцилляции через
    //    две итерации), детектор застоя и демпфированное обновление.
    const damping = prReactiveDampingUpdate(
      lambda,
      fpResidual,
      prevResidual,
      prev2Residual,
      parsed.minDamping
    );
    lambda = damping.lambda;
    if (damping.escalated) {
      dampingEscalations += 1;
    }
    if (damping.oscillation) {
      oscillationDetected = true;
    }

    const nextChange = lambda * fpResidual;
    if (nextChange < parsed.stagnationEpsilon && fpResidual >= parsed.outerTolerance) {
      stagnationCount += 1;
    } else {
      stagnationCount = 0;
    }
    if (stagnationCount >= parsed.stagnationWindow) {
      return {
        status: 'stagnated',
        model: 'peng_robinson_vapor',
        root: 'vapor',
        temperatureK,
        pressurePa,
        standardStatePressurePa,
        code: 'stagnated',
        message:
          `застой внешнего цикла: изменение демпфированного вектора ` +
          `${nextChange} < stagnationEpsilon (${parsed.stagnationEpsilon}) при fixed-point остатке ` +
          `${fpResidual} >= outerTolerance (${parsed.outerTolerance}) в течение ` +
          `${parsed.stagnationWindow} итераций; застой НЕ выдаётся за сходимость`,
        outerIterations: outer,
        innerIterations: innerIterationsTotal,
        finalDamping: lambda,
        lastFixedPointResidual: fpResidual,
        lastLnPhiUsed: { ...lnPhiUsed },
        lastMoleFractions: { ...fractions },
        innerStatus: detailed.result.status,
        innerResultMessage: detailed.result.message,
        deficiencies: [],
        warnings: withConstantWarnings(strictWarnings, hasExcludedSpecies(detailed)),
        notes: []
      };
    }

    prevLnPhiUsed = { ...lnPhiUsed };
    for (const id of ids) {
      lnPhiUsed[id] = lnPhiUsed[id] + lambda * (lnPhiTarget[id] - lnPhiUsed[id]);
    }
    lastChange = nextChange;
    prev2Residual = prevResidual;
    prevResidual = fpResidual;
  }

  // 8. Бюджет внешних итераций исчерпан без сходимости.
  return {
    status: 'max_iterations',
    model: 'peng_robinson_vapor',
    root: 'vapor',
    temperatureK,
    pressurePa,
    standardStatePressurePa,
    code: 'max_iterations',
    message:
      `исчерпан бюджет внешних итераций (${parsed.maxOuterIterations}) при fixed-point остатке ` +
      `${String(lastFpResidual)}; состав не выдаётся за равновесный`,
    outerIterations: parsed.maxOuterIterations,
    innerIterations: innerIterationsTotal,
    finalDamping: lambda,
    lastFixedPointResidual: lastFpResidual,
    lastLnPhiUsed: lastLnPhiUsedSnapshot !== null ? { ...lastLnPhiUsedSnapshot } : { ...lnPhiUsed },
    lastMoleFractions: lastFractionsSnapshot,
    innerStatus: lastInnerStatus,
    innerResultMessage: lastInnerMessage,
    deficiencies: [],
    warnings: withConstantWarnings(strictWarnings, false),
    notes: []
  };
}

// ============================================
// 5. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ РЕЗУЛЬТАТА
// ============================================

/** Есть ли виды, исключённые нулевыми итогами элементов. */
function hasExcludedSpecies(detailed: { result: { assumptions: readonly string[] } }): boolean {
  return detailed.result.assumptions.includes('zero_element_total_species_excluded');
}

/** Постоянное предупреждение о vapor-кандидате (+ предупреждение об исключённых видах). */
function withConstantWarnings(
  base: readonly PrReactiveGasEquilibriumWarning[],
  excluded: boolean
): PrReactiveGasEquilibriumWarning[] {
  const warnings: PrReactiveGasEquilibriumWarning[] = [
    ...base,
    {
      code: 'single_phase_vapor_candidate_without_phase_stability',
      message:
        'Однофазный vapor-кандидат без проверки глобальной фазовой устойчивости ' +
        'и без расчёта конденсированных фаз (flash/VLE/LLE не реализованы в этом подэтапе).'
    }
  ];
  if (excluded) {
    warnings.push({
      code: 'zero_element_total_species_excluded',
      message:
        'Виды с нулевыми итогами элементов исключены внутренним решателем: их доли и ' +
        'количества — ровно ноль, ln(0) для них не вычисляется.'
    });
  }
  return warnings;
}

/** Дедупликация предупреждений по (code, message) с сохранением порядка. */
function dedupeWarnings(
  warnings: readonly PrReactiveGasEquilibriumWarning[]
): PrReactiveGasEquilibriumWarning[] {
  const seen = new Set<string>();
  const result: PrReactiveGasEquilibriumWarning[] = [];
  for (const w of warnings) {
    const key = w.code + '|' + w.message;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(w);
    }
  }
  return result;
}

/**
 * Независимая перепроверка C2-критерия внутренних ограничений:
 * |невязка| <= tolerance·max(1, |итог|) для каждого элемента и заряда.
 */
function checkElementChargeCriterion(
  elementResiduals: Readonly<Record<string, number>>,
  chargeResidual: number,
  elementTotals: Readonly<Record<string, number>>,
  chargeTotal: number,
  tolerance: number
): boolean {
  for (const name of Object.keys(elementResiduals)) {
    const residual = elementResiduals[name] ?? 0;
    const total = elementTotals[name] ?? 0;
    if (!Number.isFinite(residual) || Math.abs(residual) > tolerance * Math.max(1, Math.abs(total))) {
      return false;
    }
  }
  return (
    Number.isFinite(chargeResidual) &&
    Math.abs(chargeResidual) <= tolerance * Math.max(1, Math.abs(chargeTotal))
  );
}

// ============================================
// 6. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Stage 4.4.4.8-B2 — чистая математика реактивного PR-равновесия в
// слое Core. Границы: каталоговый Data-фасад (замороженные
// provenance-объекты EOS/BIP), интеграция с Atmosphere/Scheduler/UI,
// автоматическое переключение модели, LLE, PPR78, фазовая
// устойчивость и конденсированные фазы — вне объёма подэтапа.
