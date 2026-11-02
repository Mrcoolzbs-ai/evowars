// ============================================
// EQUILIBRIUM - решатель химического равновесия
// идеального газа (Stage 4.4.1)
// ============================================
//
// Контракт Stage 4.4.1 (docs/science/IMPLEMENTATION_ROADMAP.md §4.4,
// CHEMISTRY_ARCHITECTURE.md §3.1/§5.1): равновесный состав газовой
// смеси - точка минимума полной энергии Гиббса
//   G = n_tot·R·T·Σ_i x_i·(g_i°/(R·T) + ln(x_i·P/p°))
// при ограничениях сохранения элементов и заряда. Метод элементных
// потенциалов (RAND): двойственные неизвестные - элементные
// потенциалы pi_k и полное число молей n_tot; условия
// стационарности дают
//   x_i = exp(Σ_k pi_k·a_ki − g_i°/(R·T))·(p°/P),
// система Ньютона - балансы элементов + нормировка Σ x_i = 1 с
// линейным поиском по норме невязки. Чистый TypeScript, без
// SolverBackend (интеграция контрактов решателей - отдельный
// подэтап).
//
// Модель и соглашения:
// - идеальный газ; давление стандартного состояния p° - явный
//   аргумент задачи (конвенция данных каталога NASA CEA: S° при
//   1 бар, см. thermoFunctions);
// - линейно-зависимые строки балансов редуцируются; зависимая
//   строка с несовместным итогом - ошибка infeasible, а не
//   молчаливое решение вырожденной системы;
// - инициализация pi: наименьшие квадраты по независимым строкам
//   с демпфированием в диапазон экспоненты [−650, 650] (до 40
//   попыток); вне диапазона экспонента переполняется или вырождает
//   якобиан - честный статус numerical_failure, а не NaN;
// - сходимость: относительная невязка балансов и |Σx_i − 1| меньше
//   tolerance (по умолчанию 1e-13); несходимость - честный статус
//   (max_iterations / line_search_stalled), не ложное converged.
//
// Не-цели Stage 4.4.1: это не шаг эволюции; интеграции в
// Scheduler/CoreWorldState/UI нет; конденсированных фаз нет
// (равновесный flash заблокирован их отсутствием); неидеальность
// (EOS) - после идеального газа; кинетика - Stage 4.5; скрининг фаз
// легаси PhaseEquilibrium не затрагивается.

import type { PhysicalQuantity } from './physicalQuantity';
import {
  convert,
  dimension,
  dimensionOf,
  isKnownUnit,
  quantity,
  sameDimension
} from './physicalQuantity';
import type { ThermodynamicProperties } from './thermodynamics';
import {
  speciesStandardGibbsEnergyOverRT,
  ThermoFunctionsError,
  UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K
} from './thermoFunctions';

const TEMPERATURE_DIMENSION = dimension(0, 0, 0, 1);
const PRESSURE_DIMENSION = dimension(1, -1, -2);

/** Предел |ln x_i| при инициализации: дальше экспонента переполняется. */
const ARGUMENT_LIMIT = 650;
/** Попыток демпфирования инициализации элементных потенциалов. */
const INIT_DAMPING_ATTEMPTS = 40;
/** Делений шага линейного поиска на итерацию Ньютона. */
const LINE_SEARCH_HALVINGS = 80;
/** Порог редукции строк: строка с нормой ниже считается нулевой. */
const ROW_RANK_EPSILON = 1e-9;

// ============================================
// 1. ТИПЫ И ОШИБКА
// ============================================

/** Код ошибки решателя равновесия. */
export type EquilibriumErrorCode =
  | 'invalid_input' // повреждённый вход: NaN, размерности, пустые списки
  | 'infeasible' // несовместные балансы (элементы/заряд)
  | 'species_data_missing'; // вида нет в каталоге, не газ или нет NASA-7

/** Ошибка решателя равновесия (fail-closed: без подстановок). */
export class EquilibriumError extends Error {
  readonly code: EquilibriumErrorCode;
  readonly operation: string;
  readonly details?: string;

  constructor(args: {
    code: EquilibriumErrorCode;
    operation: string;
    message: string;
    details?: string;
  }) {
    super(
      `[equilibrium/${args.operation}] ${args.message}` +
        (args.details !== undefined ? ` (${args.details})` : '')
    );
    this.name = 'EquilibriumError';
    this.code = args.code;
    this.operation = args.operation;
    this.details = args.details;
  }
}

/** Вид равновесной задачи: состав, заряд и g°/(R·T). */
export interface EquilibriumSpecies {
  id: string;
  /** Число атомов элемента в виде (ключ - имя элемента). */
  elements: Readonly<Record<string, number>>;
  /** Заряд вида в единицах элементарного заряда. */
  charge: number;
  /** Стандартная энергия Гиббса g_i°/(R·T) при температуре задачи. */
  gStandardOverRT: number;
}

/** Задача равновесия идеального газа. */
export interface EquilibriumProblem {
  temperature: PhysicalQuantity;
  pressure: PhysicalQuantity;
  standardStatePressure: PhysicalQuantity;
  species: readonly EquilibriumSpecies[];
  /** Итоги по элементам, моль (ключ - имя элемента). */
  elementTotals: Readonly<Record<string, number>>;
  /** Итоговый заряд смеси, моль элементарных зарядов. */
  chargeTotal: number;
  options?: EquilibriumOptions;
}

/** Настройки решателя. */
export interface EquilibriumOptions {
  /** Максимум итераций Ньютона (>= 1; по умолчанию 300). */
  maxIterations?: number;
  /** Порог относительной невязки (по умолчанию 1e-13). */
  tolerance?: number;
}

/** Статус решения. */
export type EquilibriumStatus =
  | 'converged'
  | 'max_iterations'
  | 'line_search_stalled'
  | 'numerical_failure';

/** Результат: равновесный состав и диагностика. */
export interface EquilibriumResult {
  status: EquilibriumStatus;
  model: 'ideal_gas';
  iterations: number;
  /** Полное число молей смеси. */
  totalMoles: number;
  moleFractions: Readonly<Record<string, number>>;
  speciesMoles: Readonly<Record<string, number>>;
  /** Невязки всех исходных строк балансов, моль. */
  elementResiduals: Readonly<Record<string, number>>;
  chargeResidual: number;
  /** Полная энергия Гиббса смеси, Дж; null при нечисленном значении. */
  gibbsEnergy: PhysicalQuantity | null;
  assumptions: readonly string[];
  message: string;
}

// ============================================
// 2. ПРОВЕРКА ВХОДА (FAIL-CLOSED)
// ============================================

/**
 * Величина конечна, имеет известную единицу нужной размерности;
 * возвращает её в целевой единице. Бросает EquilibriumError
 * (invalid_input) на повреждённом входе - без подстановок.
 */
function requireQuantity(
  value: PhysicalQuantity,
  expectedDimension: ReturnType<typeof dimension>,
  targetUnit: string,
  operation: string,
  what: string
): PhysicalQuantity {
  if (value === null || typeof value !== 'object') {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation,
      message: `${what} должна быть величиной {value, unit}`
    });
  }
  const q = value as PhysicalQuantity;
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation,
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
      operation,
      message: `${what} должна иметь размерность единицы «${targetUnit}», получена единица «${String(q.unit)}»`,
      details: `ожидаемая единица: ${targetUnit}`
    });
  }
  return convert(q, targetUnit);
}

/** Проверка записей элементного состава: конечные, неотрицательные. */
function validateElements(
  elements: Readonly<Record<string, number>>,
  operation: string,
  what: string
): void {
  if (elements === null || typeof elements !== 'object' || Array.isArray(elements)) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation,
      message: `${what} должна быть записью «элемент → число атомов»`
    });
  }
  for (const key of Object.keys(elements)) {
    if (key.length === 0) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation,
        message: `имя элемента в ${what} не может быть пустым`
      });
    }
    const v = elements[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation,
        message: `число атомов элемента «${key}» в ${what} должно быть конечным неотрицательным числом, получено ${String(v)}`
      });
    }
  }
}

/**
 * Сужение unknown к записи состава вида каталога: запись -
 * объект, но не массив. Значения проверяет validateElements.
 */
function asElementRecord(
  value: unknown,
  operation: string,
  what: string
): Readonly<Record<string, number>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation,
      message: `${what} должна быть записью «элемент → число атомов»`
    });
  }
  return value as Readonly<Record<string, number>>;
}

/** Разобранные и проверенные параметры задачи. */
interface ValidatedProblem {
  temperatureK: number;
  logPressureRatio: number;
  species: readonly EquilibriumSpecies[];
  elementTotals: Readonly<Record<string, number>>;
  chargeTotal: number;
}

/** Полная fail-closed проверка задачи. */
function validateProblem(problem: EquilibriumProblem): ValidatedProblem {
  const op = 'solveEquilibrium';
  if (problem === null || typeof problem !== 'object') {
    throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'задача должна быть объектом' });
  }
  const temperature = requireQuantity(problem.temperature, TEMPERATURE_DIMENSION, 'K', op, 'температура');
  if (temperature.value <= 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: op,
      message: `температура должна быть положительной, получено ${temperature.value} K`
    });
  }
  const pressure = requireQuantity(problem.pressure, PRESSURE_DIMENSION, 'Pa', op, 'давление');
  const standard = requireQuantity(
    problem.standardStatePressure,
    PRESSURE_DIMENSION,
    'Pa',
    op,
    'давление стандартного состояния'
  );
  if (pressure.value <= 0 || standard.value <= 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: op,
      message: `давление и давление стандартного состояния должны быть положительными, получено P=${pressure.value} Pa, p°=${standard.value} Pa`
    });
  }
  if (!Array.isArray(problem.species) || problem.species.length === 0) {
    throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'список видов не может быть пустым' });
  }
  const seen = new Set<string>();
  for (const s of problem.species) {
    if (s === null || typeof s !== 'object') {
      throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'вид должен быть объектом' });
    }
    if (typeof s.id !== 'string' || s.id.length === 0) {
      throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'id вида должен быть непустой строкой' });
    }
    if (seen.has(s.id)) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: op,
        message: `id видов должны быть уникальны, повтор: «${s.id}»`
      });
    }
    seen.add(s.id);
    validateElements(s.elements, op, `состав вида «${s.id}»`);
    if (typeof s.charge !== 'number' || !Number.isInteger(s.charge)) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: op,
        message: `заряд вида «${s.id}» должен быть целым числом, получено ${String(s.charge)}`
      });
    }
    if (typeof s.gStandardOverRT !== 'number' || !Number.isFinite(s.gStandardOverRT)) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: op,
        message: `g°/(R·T) вида «${s.id}» должно быть конечным числом, получено ${String(s.gStandardOverRT)}`
      });
    }
  }
  validateElements(problem.elementTotals, op, 'итоги элементов');
  for (const key of Object.keys(problem.elementTotals)) {
    if (problem.elementTotals[key] < 0) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: op,
        message: `итог элемента «${key}» не может быть отрицательным`
      });
    }
  }
  if (typeof problem.chargeTotal !== 'number' || !Number.isFinite(problem.chargeTotal)) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: op,
      message: `итоговый заряд должен быть конечным числом, получено ${String((problem as { chargeTotal?: unknown }).chargeTotal)}`
    });
  }
  return {
    temperatureK: temperature.value,
    logPressureRatio: Math.log(standard.value / pressure.value),
    species: problem.species,
    elementTotals: problem.elementTotals,
    chargeTotal: problem.chargeTotal
  };
}

// ============================================
// 3. ЛИНЕЙНАЯ АЛГЕБРА И СТРОКИ БАЛАНСОВ
// ============================================

/** Решение линейной системы с частичным выбором ведущего элемента; null при вырождении. */
function solveLinearSystem(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let pivotRow = c;
    let best = Math.abs(a[c][c]);
    for (let r = c + 1; r < n; r++) {
      const v = Math.abs(a[r][c]);
      if (v > best) {
        best = v;
        pivotRow = r;
      }
    }
    if (best < 1e-300) return null;
    const t = a[c];
    a[c] = a[pivotRow];
    a[pivotRow] = t;
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array<number>(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n];
    for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
    x[r] = s / a[r][r];
  }
  return x;
}

/** Индексы линейно независимых строк матрицы (столбцы - виды). */
export function independentRowIndices(rows: readonly (readonly number[])[]): number[] {
  const columnCount = rows.length > 0 && rows[0] !== undefined ? rows[0].length : 0;
  const reduced: number[][] = [];
  const pivots: number[] = [];
  const result: number[] = [];
  for (let k = 0; k < rows.length; k++) {
    const v = rows[k].slice();
    for (let j = 0; j < reduced.length; j++) {
      const f = v[pivots[j]];
      if (f !== 0) {
        for (let i = 0; i < columnCount; i++) v[i] -= f * reduced[j][i];
      }
    }
    let maxAbs = 0;
    let pivotColumn = -1;
    for (let i = 0; i < columnCount; i++) {
      const av = Math.abs(v[i]);
      if (av > maxAbs) {
        maxAbs = av;
        pivotColumn = i;
      }
    }
    if (maxAbs < ROW_RANK_EPSILON) continue;
    const scale = v[pivotColumn];
    for (let i = 0; i < columnCount; i++) v[i] /= scale;
    reduced.push(v);
    pivots.push(pivotColumn);
    result.push(k);
  }
  return result;
}

/** Строка баланса (элемент или заряд), столбцы - виды. */
interface BalanceRow {
  coefficients: number[];
  total: number;
  name: string;
}

/** Редуцированная (нормированная) независимая строка системы Ньютона. */
interface ReducedRow {
  coefficients: number[];
  total: number;
  name: string;
}

/**
 * Редукция строк балансов: линейно-независимый поднабор с проверкой
 * совместности итогов. Зависимая строка с несовместным итогом -
 * ошибка infeasible: вырожденная система не решается молча.
 */
function reduceRows(rows: readonly BalanceRow[]): ReducedRow[] {
  const reduced: ReducedRow[] = [];
  const pivots: number[] = [];
  const inconsistent: string[] = [];
  for (const row of rows) {
    const v = row.coefficients.slice();
    let bv = row.total;
    for (let j = 0; j < reduced.length; j++) {
      const f = v[pivots[j]];
      if (f !== 0) {
        for (let i = 0; i < v.length; i++) v[i] -= f * reduced[j].coefficients[i];
        bv -= f * reduced[j].total;
      }
    }
    let maxAbs = 0;
    let pivotColumn = -1;
    for (let i = 0; i < v.length; i++) {
      const av = Math.abs(v[i]);
      if (av > maxAbs) {
        maxAbs = av;
        pivotColumn = i;
      }
    }
    if (maxAbs < ROW_RANK_EPSILON) {
      if (Math.abs(bv) > 1e-8 * Math.max(1, Math.abs(row.total))) {
        inconsistent.push(row.name);
      }
      continue;
    }
    const scale = v[pivotColumn];
    for (let i = 0; i < v.length; i++) v[i] /= scale;
    bv /= scale;
    reduced.push({ coefficients: v, total: bv, name: row.name });
    pivots.push(pivotColumn);
  }
  if (inconsistent.length > 0) {
    throw new EquilibriumError({
      code: 'infeasible',
      operation: 'solveEquilibrium',
      message: 'строки балансов линейно зависимы, а их итоги несовместны',
      details: `несовместные строки: ${inconsistent.join(', ')}`
    });
  }
  return reduced;
}

// ============================================
// 4. ОПЦИИ, СТРОКИ ЗАДАЧИ, ИНИЦИАЛИЗАЦИЯ
// ============================================

/** Опции решателя: проверка и значения по умолчанию. */
function parseOptions(problem: EquilibriumProblem): { maxIterations: number; tolerance: number } {
  const op = 'solveEquilibrium';
  const o = problem.options ?? {};
  const maxIterations = o.maxIterations ?? 300;
  if (!Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: op,
      message: `maxIterations должен быть целым числом >= 1, получено ${String(maxIterations)}`
    });
  }
  const tolerance = o.tolerance ?? 1e-13;
  if (typeof tolerance !== 'number' || !Number.isFinite(tolerance) || tolerance <= 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: op,
      message: `tolerance должен быть конечным положительным числом, получено ${String(tolerance)}`
    });
  }
  return { maxIterations, tolerance };
}

/** Безопасный поиск числа атомов в записи состава. */
function elementCount(record: Readonly<Record<string, number>>, name: string): number {
  const value = record[name];
  if (typeof value === 'number') {
    return value;
  }
  return 0;
}

/**
 * Строки балансов задачи: по одному элементу с ненулевым итогом
 * и одна строка заряда, если есть заряженные виды. Итог из
 * elementTotals без видов - ошибка infeasible.
 */
function buildBalanceRows(
  species: readonly EquilibriumSpecies[],
  elementTotals: Readonly<Record<string, number>>,
  chargeTotal: number
): BalanceRow[] {
  const rows: BalanceRow[] = [];
  for (const name of Object.keys(elementTotals)) {
    const total = elementTotals[name] ?? 0;
    if (total === 0) {
      continue;
    }
    let present = false;
    for (const s of species) {
      if (elementCount(s.elements, name) > 0) {
        present = true;
        break;
      }
    }
    if (!present) {
      throw new EquilibriumError({
        code: 'infeasible',
        operation: 'solveEquilibrium',
        message: `элемент «${name}» задан в итогах, но не входит ни в один вид`,
        details: `итог ${name} = ${total} моль`
      });
    }
    rows.push({
      coefficients: species.map((s) => elementCount(s.elements, name)),
      total,
      name
    });
  }
  let hasCharged = false;
  for (const s of species) {
    if (s.charge !== 0) {
      hasCharged = true;
      break;
    }
  }
  if (hasCharged || chargeTotal !== 0) {
    if (!hasCharged) {
      throw new EquilibriumError({
        code: 'infeasible',
        operation: 'solveEquilibrium',
        message: 'итоговый заряд ненулевой, но заряженных видов нет'
      });
    }
    rows.push({
      coefficients: species.map((s) => s.charge),
      total: chargeTotal,
      name: 'charge'
    });
  }
  if (rows.length === 0) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: 'solveEquilibrium',
      message: 'задача без ограничений: итоги элементов и заряда нулевые'
    });
  }
  return rows;
}

/**
 * Начальные элементные потенциалы: наименьшие квадраты по
 * независимым строкам (метод двойственной инициализации RAND):
 * pi решает приближенную задачу exp(...) в допустимом диапазоне,
 * шаг демпфируется, пока все аргументы экспонент не окажутся
 * в [-ARGUMENT_LIMIT, ARGUMENT_LIMIT].
 */
function initialPotentials(
  rows: readonly ReducedRow[],
  gOverRT: readonly number[],
  logPressureRatio: number
): number[] | null {
  const rowCount = rows.length;
  const speciesCount = gOverRT.length;
  const targets = gOverRT.map((g) => g - logPressureRatio);
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let j = 0; j < rowCount; j++) {
    const row = new Array<number>(rowCount);
    for (let k = 0; k < rowCount; k++) {
      let sum = 0;
      for (let i = 0; i < speciesCount; i++) {
        sum += rows[j].coefficients[i] * rows[k].coefficients[i];
      }
      row[k] = sum + (j === k ? 1e-6 : 0);
    }
    matrix.push(row);
    let b = 0;
    for (let i = 0; i < speciesCount; i++) {
      b += rows[j].coefficients[i] * targets[i];
    }
    rhs.push(b);
  }
  const solution = solveLinearSystem(matrix, rhs);
  if (solution === null) {
    return null;
  }
  for (let attempt = 0; attempt < INIT_DAMPING_ATTEMPTS; attempt++) {
    const scale = Math.pow(2, -attempt);
    const candidate = solution.map((v) => v * scale);
    let feasible = true;
    for (let i = 0; i < speciesCount; i++) {
      let argument = -gOverRT[i] + logPressureRatio;
      for (let j = 0; j < rowCount; j++) {
        argument += candidate[j] * rows[j].coefficients[i];
      }
      if (!Number.isFinite(argument) || Math.abs(argument) > ARGUMENT_LIMIT) {
        feasible = false;
        break;
      }
    }
    if (feasible) {
      return candidate;
    }
  }
  return null;
}

// ============================================
// 5. РЕШАТЕЛЬ: НЬЮТОН + ЛИНЕЙНЫЙ ПОИСК
// ============================================

/**
 * Результат-отказ: нулевые моли, невязки от нулевого состава
 * (минус итоги строк), G = null. Состав честно не сообщается.
 */
function failedResult(
  rows: readonly BalanceRow[],
  status: EquilibriumStatus,
  iterations: number,
  message: string
): EquilibriumResult {
  const elementResiduals: Record<string, number> = {};
  let chargeResidual = 0;
  for (const row of rows) {
    if (row.name === 'charge') chargeResidual = -row.total;
    else elementResiduals[row.name] = -row.total;
  }
  return {
    status,
    model: 'ideal_gas',
    iterations,
    totalMoles: Number.NaN,
    moleFractions: {},
    speciesMoles: {},
    elementResiduals,
    chargeResidual,
    gibbsEnergy: null,
    assumptions: ['ideal_gas', 'element_potentials_rand', 'explicit_standard_state_pressure'],
    message
  };
}

/**
 * Решение задачи химического равновесия идеального газа: Ньютон
 * по элементным потенциалам и полному числу молей с линейным
 * поиском по 2-норме невязки балансов. Повреждённый вход и
 * несовместные балансы - EquilibriumError; несходимость - честный
 * статус в EquilibriumResult, без ложного converged.
 */
export function solveEquilibrium(problem: EquilibriumProblem): EquilibriumResult {
  const validated = validateProblem(problem);
  const { maxIterations, tolerance } = parseOptions(problem);
  const rows = buildBalanceRows(
    validated.species,
    validated.elementTotals,
    validated.chargeTotal
  );
  const reduced = reduceRows(rows);
  const species = validated.species;
  const speciesCount = species.length;
  const rowCount = reduced.length;
  const gOverRT = species.map((s) => s.gStandardOverRT);
  const logPressureRatio = validated.logPressureRatio;
  const pi = initialPotentials(reduced, gOverRT, logPressureRatio);
  if (pi === null) {
    return failedResult(
      rows,
      'numerical_failure',
      0,
      'инициализация не удержала аргументы экспонент в допустимом диапазоне'
    );
  }
  let totalMoles = Math.max(1e-6, reduced.reduce((sum, row) => sum + row.total, 0));

  /**
   * Невязки системы Ньютона: балансы n·A·x = b и нормировка
   * Σ x_i = 1 при данных потенциалах; 2-норма и максимум
   * относительной невязки для критерия сходимости.
   */
  const evaluate = (potentials: readonly number[], n: number): {
    fractions: number[];
    equations: number[];
    norm: number;
    maxRelative: number;
  } => {
    const fractions = new Array<number>(speciesCount);
    for (let i = 0; i < speciesCount; i++) {
      let argument = -gOverRT[i] + logPressureRatio;
      for (let j = 0; j < rowCount; j++) {
        argument += potentials[j] * reduced[j].coefficients[i];
      }
      fractions[i] = Math.exp(argument);
    }
    const equations = new Array<number>(rowCount + 1);
    let sumFractions = 0;
    for (let i = 0; i < speciesCount; i++) {
      sumFractions += fractions[i];
    }
    for (let j = 0; j < rowCount; j++) {
      let s = 0;
      for (let i = 0; i < speciesCount; i++) {
        s += reduced[j].coefficients[i] * fractions[i];
      }
      equations[j] = n * s - reduced[j].total;
    }
    equations[rowCount] = sumFractions - 1;
    let normSquared = equations[rowCount] * equations[rowCount];
    let maxRelative = Math.abs(equations[rowCount]);
    for (let j = 0; j < rowCount; j++) {
      normSquared += equations[j] * equations[j];
      const relative = Math.abs(equations[j]) / Math.max(1, Math.abs(reduced[j].total));
      if (relative > maxRelative) {
        maxRelative = relative;
      }
    }
    return { fractions, equations, norm: Math.sqrt(normSquared), maxRelative };
  };

  let state = evaluate(pi, totalMoles);
  let iterations = 0;
  while (!(state.maxRelative < tolerance)) {
    if (iterations >= maxIterations) {
      return failedResult(
        rows,
        'max_iterations',
        iterations,
        `достигнут предел итераций Ньютона (${maxIterations}), относительная невязка ${state.maxRelative}`
      );
    }
    const size = rowCount + 1;
    const jacobian: number[][] = [];
    for (let j = 0; j < rowCount; j++) {
      const jacobianRow = new Array<number>(size);
      for (let k = 0; k < rowCount; k++) {
        let s = 0;
        for (let i = 0; i < speciesCount; i++) {
          s += reduced[j].coefficients[i] * reduced[k].coefficients[i] * state.fractions[i];
        }
        jacobianRow[k] = totalMoles * s;
      }
      let columnSum = 0;
      for (let i = 0; i < speciesCount; i++) {
        columnSum += reduced[j].coefficients[i] * state.fractions[i];
      }
      jacobianRow[rowCount] = columnSum;
      jacobian.push(jacobianRow);
    }
    const lastRow = new Array<number>(size);
    for (let k = 0; k < rowCount; k++) {
      let s = 0;
      for (let i = 0; i < speciesCount; i++) {
        s += reduced[k].coefficients[i] * state.fractions[i];
      }
      lastRow[k] = s;
    }
    lastRow[rowCount] = 0;
    jacobian.push(lastRow);
    const step = solveLinearSystem(jacobian, state.equations.map((v) => -v));
    if (step === null) {
      return failedResult(rows, 'numerical_failure', iterations, 'система Ньютона вырождена');
    }

    let accepted = false;
    let t = 1;
    for (let halving = 0; halving < LINE_SEARCH_HALVINGS; halving++) {
      const candidatePotentials = pi.map((v, j) => v + t * step[j]);
      const candidateMoles = totalMoles + t * step[rowCount];
      if (candidateMoles > 0 && Number.isFinite(candidateMoles)) {
        const candidate = evaluate(candidatePotentials, candidateMoles);
        if (Number.isFinite(candidate.norm) && candidate.norm < state.norm) {
          for (let j = 0; j < rowCount; j++) {
            pi[j] = candidatePotentials[j];
          }
          totalMoles = candidateMoles;
          state = candidate;
          accepted = true;
          break;
        }
      }
      t /= 2;
    }
    if (!accepted) {
      return failedResult(
        rows,
        'line_search_stalled',
        iterations,
        'линейный поиск не уменьшил норму невязки'
      );
    }
    iterations++;
  }

  const moleFractions: Record<string, number> = {};
  const speciesMoles: Record<string, number> = {};
  for (let i = 0; i < speciesCount; i++) {
    moleFractions[species[i].id] = state.fractions[i];
    speciesMoles[species[i].id] = state.fractions[i] * totalMoles;
  }
  const elementResiduals: Record<string, number> = {};
  let chargeResidual = 0;
  for (const row of rows) {
    let s = 0;
    for (let i = 0; i < speciesCount; i++) {
      s += row.coefficients[i] * speciesMoles[species[i].id];
    }
    const residual = s - row.total;
    if (row.name === 'charge') {
      chargeResidual = residual;
    } else {
      elementResiduals[row.name] = residual;
    }
  }
  let gibbsSum = 0;
  for (let i = 0; i < speciesCount; i++) {
    const x = state.fractions[i];
    if (x > 0) {
      gibbsSum += x * (gOverRT[i] + Math.log(x) - logPressureRatio);
    }
  }
  const gibbsValue =
    UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * validated.temperatureK * totalMoles * gibbsSum;
  const gibbsEnergy = Number.isFinite(gibbsValue) ? quantity(gibbsValue, 'J') : null;
  return {
    status: 'converged',
    model: 'ideal_gas',
    iterations,
    totalMoles,
    moleFractions,
    speciesMoles,
    elementResiduals,
    chargeResidual,
    gibbsEnergy,
    assumptions: ['ideal_gas', 'element_potentials_rand', 'explicit_standard_state_pressure'],
    message: `равновесие достигнуто за ${iterations} итераций, относительная невязка ${state.maxRelative}`
  };
}

// ============================================
// 6. АДАПТЕР КАТАЛОГА ВИДОВ
// ============================================

/**
 * Минимальный интерфейс каталога видов: структурная типизация,
 * без зависимости от конкретного реестра - достаточно get(id),
 * возвращающего запись вида или null.
 */
export interface EquilibriumCatalogLike {
  get(id: string): unknown;
}

/**
 * Конфигурация задачи равновесия из каталога: список id видов,
 * НАЧАЛЬНЫЙ состав (amounts) либо итоги элементов (elementTotals)
 * - ровно одно из двух, температура, давления, опции решателя.
 */
export interface CatalogEquilibriumConfig {
  speciesIds: readonly string[];
  /** Начальные количества видов, моль (XOR с elementTotals). */
  amounts?: Readonly<Record<string, number>>;
  /** Итоги элементов, моль атомов (XOR с amounts). */
  elementTotals?: Readonly<Record<string, number>>;
  chargeTotal?: number;
  temperature: PhysicalQuantity;
  pressure: PhysicalQuantity;
  standardStatePressure: PhysicalQuantity;
  options?: EquilibriumOptions;
}

/** Запись вида каталога с неизвестной формой (безопасный доступ). */
interface CatalogSpeciesRecord {
  phase?: unknown;
  charge?: unknown;
  elements?: unknown;
  thermodynamics?: unknown;
}

/**
 * Чтение вида из каталога: запись обязана существовать, быть
 * газом и иметь блок термодинамики; иначе вид попадает в список
 * отсутствующих (ошибка одна на весь список, а не по одному).
 */
function readCatalogSpecies(
  catalog: EquilibriumCatalogLike,
  id: string
): CatalogSpeciesRecord | null {
  const record = catalog.get(id);
  if (record === null || record === undefined || typeof record !== 'object') {
    return null;
  }
  const typed = record as CatalogSpeciesRecord;
  if (typed.phase !== 'gas') {
    return null;
  }
  if (typed.thermodynamics === null || typeof typed.thermodynamics !== 'object') {
    return null;
  }
  return typed;
}

/**
 * Сборка задачи равновесия из каталога видов: g°/(R·T) каждого
 * вида вычисляется из NASA-7 записи при температуре задачи
 * (fail-closed: отсутствующие виды и параметрыризации - ошибка
 * species_data_missing, температура вне диапазона - invalid_input).
 */
export function buildEquilibriumProblemFromCatalog(
  catalog: EquilibriumCatalogLike,
  config: CatalogEquilibriumConfig
): EquilibriumProblem {
  const op = 'buildEquilibriumProblemFromCatalog';
  if (catalog === null || typeof catalog !== 'object' || typeof catalog.get !== 'function') {
    throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'каталог должен иметь метод get(id)' });
  }
  if (config === null || typeof config !== 'object') {
    throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'конфигурация должна быть объектом' });
  }
  if (!Array.isArray(config.speciesIds) || config.speciesIds.length === 0) {
    throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'список id видов не может быть пустым' });
  }
  for (const id of config.speciesIds) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'id вида должен быть непустой строкой' });
    }
  }
  const hasAmounts = config.amounts !== undefined;
  const hasTotals = config.elementTotals !== undefined;
  if (hasAmounts === hasTotals) {
    throw new EquilibriumError({
      code: 'invalid_input',
      operation: op,
      message: 'задайте ровно одно: amounts (начальные количества) или elementTotals (итоги элементов)'
    });
  }
  const amounts: Record<string, number> = {};
  if (hasAmounts) {
    const given = config.amounts as Readonly<Record<string, number>>;
    if (given === null || typeof given !== 'object' || Array.isArray(given)) {
      throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'amounts должна быть записью «id вида → моль»' });
    }
    for (const key of Object.keys(given)) {
      if (!config.speciesIds.includes(key)) {
        throw new EquilibriumError({
          code: 'invalid_input',
          operation: op,
          message: `amounts содержит вид «${key}», которого нет в speciesIds`,
          details: 'ключи amounts должны быть подмножеством speciesIds'
        });
      }
      const value = given[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new EquilibriumError({
          code: 'invalid_input',
          operation: op,
          message: `количество вида «${key}» должно быть конечным положительным числом, получено ${String(value)}`
        });
      }
      amounts[key] = value;
    }
  }
  const species: EquilibriumSpecies[] = [];
  const missing: string[] = [];
  for (const id of config.speciesIds) {
    const record = readCatalogSpecies(catalog, id);
    if (record === null) {
      missing.push(id);
      continue;
    }
    const elements = asElementRecord(record.elements, op, `состав вида «${id}» каталога`);
    validateElements(elements, op, `состав вида «${id}» каталога`);
    if (typeof record.charge !== 'number' || !Number.isInteger(record.charge)) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: op,
        message: `заряд вида «${id}» в каталоге должен быть целым числом, получено ${String(record.charge)}`
      });
    }
    const charge = record.charge;
    const thermodynamics = record.thermodynamics as ThermodynamicProperties;
    let gStandardOverRT: number;
    try {
      gStandardOverRT = speciesStandardGibbsEnergyOverRT(thermodynamics, config.temperature);
    } catch (error) {
      if (error instanceof ThermoFunctionsError) {
        if (error.code === 'no_thermodynamic_data') {
          throw new EquilibriumError({
            code: 'species_data_missing',
            operation: op,
            message: `у вида «${id}» нет NASA-7 параметризации теплоёмкости`,
            details: error.message
          });
        }
        throw new EquilibriumError({
          code: 'invalid_input',
          operation: op,
          message: `не удалось вычислить g°/(R·T) вида «${id}» при заданной температуре`,
          details: error.message
        });
      }
      throw error;
    }
    species.push({ id, elements, charge, gStandardOverRT });
  }
  if (missing.length > 0) {
    throw new EquilibriumError({
      code: 'species_data_missing',
      operation: op,
      message: 'виды отсутствуют в каталоге, не газ или без блока термодинамики',
      details: `виды: ${missing.join(', ')}`
    });
  }
  const elementTotals: Record<string, number> = {};
  let chargeTotal = 0;
  if (hasAmounts) {
    for (const s of species) {
      const amount = amounts[s.id];
      if (amount === undefined) {
        continue;
      }
      for (const element of Object.keys(s.elements)) {
        elementTotals[element] = (elementTotals[element] ?? 0) + amount * s.elements[element];
      }
      chargeTotal += amount * s.charge;
    }
  } else {
    const given = config.elementTotals as Readonly<Record<string, number>>;
    validateElements(given, op, 'итоги элементов');
    for (const element of Object.keys(given)) {
      elementTotals[element] = given[element];
    }
    if (config.chargeTotal !== undefined) {
      if (typeof config.chargeTotal !== 'number' || !Number.isFinite(config.chargeTotal)) {
        throw new EquilibriumError({
          code: 'invalid_input',
          operation: op,
          message: `итоговый заряд должен быть конечным числом, получено ${String(config.chargeTotal)}`
        });
      }
      chargeTotal = config.chargeTotal;
    }
  }
  return {
    temperature: config.temperature,
    pressure: config.pressure,
    standardStatePressure: config.standardStatePressure,
    species,
    elementTotals,
    chargeTotal,
    options: config.options
  };
}

/**
 * Итоги элементов и заряда из начальных количеств видов каталога:
 * точные суммы amount·(состав вида) и amount·charge. Отсутствующие
 * в каталоге виды - ошибка species_data_missing со всем списком.
 */
export function elementTotalsFromCatalogAmounts(
  catalog: EquilibriumCatalogLike,
  amounts: Readonly<Record<string, number>>
): { elementTotals: Record<string, number>; chargeTotal: number } {
  const op = 'elementTotalsFromCatalogAmounts';
  if (catalog === null || typeof catalog !== 'object' || typeof catalog.get !== 'function') {
    throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'каталог должен иметь метод get(id)' });
  }
  if (amounts === null || typeof amounts !== 'object' || Array.isArray(amounts)) {
    throw new EquilibriumError({ code: 'invalid_input', operation: op, message: 'amounts должна быть записью «id вида → моль»' });
  }
  const elementTotals: Record<string, number> = {};
  let chargeTotal = 0;
  const missing: string[] = [];
  for (const id of Object.keys(amounts)) {
    const amount = amounts[id];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: op,
        message: `количество вида «${id}» должно быть конечным положительным числом, получено ${String(amount)}`
      });
    }
    const record = readCatalogSpecies(catalog, id);
    if (record === null) {
      missing.push(id);
      continue;
    }
    const elements = asElementRecord(record.elements, op, `состав вида «${id}» каталога`);
    validateElements(elements, op, `состав вида «${id}» каталога`);
    if (typeof record.charge !== 'number' || !Number.isInteger(record.charge)) {
      throw new EquilibriumError({
        code: 'invalid_input',
        operation: op,
        message: `заряд вида «${id}» в каталоге должен быть целым числом, получено ${String(record.charge)}`
      });
    }
    for (const element of Object.keys(elements)) {
      elementTotals[element] = (elementTotals[element] ?? 0) + amount * elements[element];
    }
    chargeTotal += amount * record.charge;
  }
  if (missing.length > 0) {
    throw new EquilibriumError({
      code: 'species_data_missing',
      operation: op,
      message: 'виды отсутствуют в каталоге, не газ или без блока термодинамики',
      details: `виды: ${missing.join(', ')}`
    });
  }
  return { elementTotals, chargeTotal };
}

// ============================================
// 7. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Stage 4.4.1 - решатель и адаптер каталога. Интеграция в
// Scheduler/CoreWorldState, конденсированные фазы (равновесный
// flash), неидеальные EOS и кинетика - вне объёма этого подэтапа
// (см. docs/science/IMPLEMENTATION_ROADMAP.md §4.4).
