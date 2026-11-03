// ============================================
// ODE SOLVER - Radau IIA (3 стадии, порядок 5, L-stable)
// ============================================
//
// Stage 4.5.3. Реализация жёсткого (stiff) ODE-решателя семейства
// Radau IIA (Hairer & Wanner, "Solving ODEs II", раздел IV.10):
// коллокационный метод Гаусса–Радо 3 стадии, порядок 5,
// stiffly accurate (b совпадает с последней строкой A),
// L-stable — бесконечно жёсткие моды затухают за один шаг,
// без нефизичных осцилляций.
//
// Реализованное (и только оно заявляется в capabilities):
// - адаптивный шаг с оценкой ошибки step-doubling:
//     шаг h (полное решение y_full) против два полушага h/2
//     (y_fine). Для метода порядка p=5 локальная ошибка
//     «тонкого» решения равна (y_fine − y_full) / 31, где
//     31 = 2^5 − 1 (документированная константа STEP doubling
//     DIVISOR = 2^p − 1); норма — взвешенная RMS с масштабом
//     atol_i + rtol·max(|y_i|, |y_fine_i|);
// - упрощённый метод Ньютона для нелинейной системы стадий
//     с плотной LU-факторизацией (частичный выбор ведущего
//     элемента, без явного обращения матрицы), якобиан J(t, y)
//     замораживается на шаге, критерии сходимости —
//     скорость сходимости rate (Hairer/SciPy): прогноз
//     остатка rate/(1−rate)·||dW|| < tol, отказ при rate ≥ 1
//     или rate^(оставшиеся итерации)/(1−rate)·||dW|| > tol;
//     tol Ньютона согласован с допусками интегрирования:
//     max(10·eps/rtol, min(0.03, rtol^0.5)) — нелинейная
//     ошибка не доминирует над ошибкой интегрирования;
// - начальное приближение Ньютона — прогноз стадий с
//     предыдущего принятого шага (масштабирование по h);
// - аналитический якобиан (problem.jacobian) или численный
//     (конечные разности вперёд, шаг ~ sqrt(eps));
// - tEval: контрольные времена; шаг обрезается до ближайшей
//     точки, t присваивается РОВНО заданному времени
//     (без подстановки значений «из воздуха»);
// - неотрицательность БЕЗ молчаливого clipping: существенно
//     отрицательная компонента отклоняет шаг с уменьшением h
//     (при невозможности — ошибка nonneg_violation), небольшая
//     отрицательная в пределах допуска сохраняется как есть с
//     явной диагностикой (счётчик);
// - линейные инварианты Σ c_i·y_i = expected: проверка на y0
//     и после каждого принятого шага, БЕЗ коррекции вектора;
//     нарушение — reject с уменьшением h, при невозможности —
//     ошибка invariant_violation.
//
// Ограничения (честные):
// - плотный LU: O((3n)^3) на шаг; оптимизирован для малых
//   систем (n ≤ 64, maxStateDimension в capabilities);
// - разреженные якобианы НЕ поддерживаются (sparseJacobian=false);
// - BDF-методы НЕ реализованы (не заявляются);
// - DAE и алгебраические задачи НЕ поддерживаются;
// - детерминизм 'within_tolerance': битовая идентичность не
//   гарантируется между платформами.
//
// solve() общего контракта SolverBackend у ODE-бэкенда
// принципиально НЕ выполняет интегрирования: он возвращает
// status 'error' с диагностикой «используйте solveOde». Статус
// 'solved' никогда не возвращается без численного решения.
//
// ============================================
// КОРРЕКТИРУЮЩАЯ РЕВИЗИЯ STAGE 4.5.3 (02.11.2026,
// по независимому аудиту; метод не менялся)
// ============================================
// Закрыто 6 дефектов, найденных независимым аудитом:
// 1. Начальный шаг: алгоритм Hairer/SciPy select_initial_step
//    с гарантированно положительным fallback — вырожденный
//    случай (y0 = 0 при y' = 1) больше не даёт нулевых шагов;
//    шаг ограничен maxStep с первого шага; неконечный выбор —
//    numerical_failure.
// 2. Численная устойчивость: взвешенная RMS-норма устойчива к
//    переполнению (нормировка на максимум до возведения в
//    квадрат), не-конечная ошибка шага НЕ проходит как «малая»,
//    «solved» с NaN/Infinity невозможен (финальная проверка
//    конечности), luFactor/luSolve отвергают не-конечные
//    данные; новый код ошибки numerical_failure.
// 3. Строгие лимиты: maxSteps/maxNewtonIterations — только
//    конечные целые ≥ 1 (дробные/нулевые/NaN/∞ — invalid_input
//    без молчаливого округления); minStep > maxStep —
//    противоречие (invalid_input).
// 4. Неотрицательность проверяется и на y0: существенный минус
//    начального состояния — nonneg_violation с диагностикой,
//    молчаливое исправление (clipping) невозможно.
// 5. Допуск линейных инвариантов покомпонентный и масштабируется
//    по данным: Σ|c_i|·atol_i + relTolerance·
//    max(|expected|, Σ|c_i·y_i|); опции absTolerance/relTolerance
//    на инварианте; фиксированный max(1, ·) убран — нарушения
//    видны при концентрациях ~1e-20.
// 6. Честная статистика: каждый отказ Ньютона учитывается и в
//    rejectedSteps; для завершившегося интегрирования
//    attemptedSteps === acceptedSteps + rejectedSteps.
//
// Этап 2 корректирующей ревизии (03.11.2026, по независимому
// аудиту принятого коммита):
// 7. Пробный шаг select_initial_step ограничен интервалом ДО
//    вызова rhs (h0 ≤ span): rhs не вызывается вне [t0, tEnd]
//    (соответствует min(h0, interval_length) SciPy); d2 — норма
//    ИЗМЕНЕНИЯ производной norm(f1 − f0)/h0 (как в SciPy),
//    а не норма самой f1; вырожденные нормы (d1 ≤ 1e-15 и
//    d2 ≤ 1e-15) дают умеренный h1 = max(1e-6, h0·1e-3) вместо
//    h1 = Infinity — начальный шаг конечен и умерен.
// 8. Контракт minorNegativeCount: учитываются ТОЛЬКО y0 и
//    ПРИНЯТЫЕ состояния; малые минусы кандидатов отклонённых
//    попыток шага в счётчик не попадают — диагностика отражает
//    реальную траекторию, а не историю проб.
//
// Этап 3 корректирующей ревизии (03.11.2026):
// 9. Условие выбора h0 — ДОСЛОВНО алгоритм SciPy
//    select_initial_step (scipy/integrate/_ivp/common.py):
//    при d0 < 1e-5 или d1 < 1e-5 — h0 = 1e-6 (абсолютный
//    fallback, НЕ 1e-6·span), иначе h0 = 0.01·d0/d1;
//    отношение-эвристика с масштабированием на длину интервала
//    удалена. Нормы — взвешенная RMS (rms_norm SciPy), поэтому
//    h1 совпадает с SciPy и без поправок; собственные адаптации
//    под единицы времени проекта НЕ вводились.
// 10. Свойства сохранены: h0 конечен и строго положителен
//     (fail-closed страховка от не-конечных норм), h0 ≤ span
//     ДО пробного вызова rhs, итог h = min(100·h0, h1, maxStep,
//     span), ветка малых d1/d2 — без изменений.

import type {
  OdeSolverBackend,
  OdeSolverProblem,
  OdeSolverOptions,
  OdeSolverResult,
  OdeJacobian,
  OdeRhs,
  LinearInvariant
} from './solverBackend';

// ============================================
// 1. ТАБЛИЦА БАТЧЕРА RADAU IIA (3 СТАДИИ, ПОРЯДОК 5)
// ============================================

const SQRT6 = Math.sqrt(6);

/** Узлы стадий c_i. */
export const RADAU_IIA_NODES = [(4 - SQRT6) / 10, (4 + SQRT6) / 10, 1] as const;

/**
 * Матрица AButcher. Константы — точные выражения через √6
 * (Hairer & Wanner IV.10, таблица 5.6).
 */
export const RADAU_IIA_MATRIX_A: readonly (readonly number[])[] = [
  [(88 - 7 * SQRT6) / 360, (296 - 169 * SQRT6) / 1800, (-2 + 3 * SQRT6) / 225],
  [(296 + 169 * SQRT6) / 1800, (88 + 7 * SQRT6) / 360, (-2 - 3 * SQRT6) / 225],
  [(16 - SQRT6) / 36, (16 + SQRT6) / 36, 1 / 9]
];

/**
 * Веса b_i: Radau IIA stiffly accurate, b совпадает с третьей
 * строкой A, поэтому y_{n+1} = y_n + Z_3 (последняя стадия).
 */
export const RADAU_IIA_WEIGHTS_B = RADAU_IIA_MATRIX_A[2];

/** Машинный эпсилон двойной точности. */
const EPS = 2.22e-16;

/**
 * Делитель оценки ошибки step-doubling: 2^5 − 1 = 31.
 * Локальная ошибка решения двумя полушагами равна
 * (y_fine − y_full)/31 для метода порядка 5.
 */
export const STEP_DOUBLING_DIVISOR = Math.pow(2, 5) - 1;

/** Метод, реализованный этим модулем (совпадает с capabilities). */
export const RADAU_IIA_METHOD_ID = 'radau_iia_5';

/** Идентификатор backend'а. */
export const RADAU_IIA_BACKEND_ID = 'ts-radau-iia';

/** Максимальная размерность состояния (плотный LU). */
export const RADAU_IIA_MAX_STATE_DIMENSION = 64;

// ============================================
// 2. ОШИБКИ РЕШАТЕЛЯ
// ============================================

export const ODE_ERROR_CODES = [
  'invalid_input',
  't_eval_invalid',
  'rhs_callback_error',
  'rhs_dimension_mismatch',
  'rhs_non_finite',
  'jacobian_callback_error',
  'jacobian_invalid',
  'lu_singular',
  'newton_non_convergence',
  'max_steps_exceeded',
  'min_step_violated',
  'nonneg_violation',
  'invariant_violation',
  'numerical_failure'
] as const;

export type OdeErrorCode = (typeof ODE_ERROR_CODES)[number];

/**
 * Ошибка решателя (стиль KineticsError): стабильный код для
 * тестов и диагностики, человекочитаемое сообщение.
 */
export class OdeSolverError extends Error {
  readonly code: OdeErrorCode;
  readonly details?: Record<string, number | string | boolean>;

  constructor(code: OdeErrorCode, message: string, details?: Record<string, number | string | boolean>) {
    super(`[OdeSolver:${code}] ${message}`);
    this.name = 'OdeSolverError';
    this.code = code;
    this.details = details;
  }
}

// ============================================
// 3. ПЛОТНАЯ LU-ФАКТОРИЗАЦИЯ С ЧАСТИЧНЫМ ВЫБОРОМ
// ============================================

interface LuDecomposition {
  lu: number[][];
  piv: number[];
}

/**
 * LU-факторизация с частичным выбором ведущего элемента.
 * Возвращает null для сингулярной матрицы; явного обратного
 * вычисления НЕТ — решение только через luSolve.
 *
 * Порог сингулярности ОТНОСИТЕЛЕН СТОЛБЦУ исходной матрицы
 * (|pivot| ≤ 1e-14·||столбец||∞), а не глобальному максимуму:
 * в системе стадий Radau блоки h·A·J могут иметь записи ~1e14
 * (жёсткие задачи) при единичных диагоналях других компонент —
 * глобальный порог даёт ложные срабатывания на легитимных
 * пивтах порядка 1.
 */
export function luFactor(matrix: readonly (readonly number[])[]): LuDecomposition | null {
  const n = matrix.length;
  // Fail-closed: не-конечные входы не попадают в факторизацию —
  // NaN «заражает» весь результат и проходит проверки
  // сингулярности (любое сравнение с NaN ложно).
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = matrix[i][j];
      if (!Number.isFinite(v)) return null;
    }
  }
  const lu = matrix.map((row) => row.slice());
  const piv = new Array<number>(n).fill(0);
  const columnNorms: number[] = new Array<number>(n).fill(0);
  for (let j = 0; j < n; j++) {
    let mx = 0;
    for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(matrix[i][j]));
    columnNorms[j] = mx;
  }
  for (let k = 0; k < n; k++) {
    let p = k;
    let mx = Math.abs(lu[k][k]);
    for (let i = k + 1; i < n; i++) {
      const a = Math.abs(lu[i][k]);
      if (a > mx) { mx = a; p = i; }
    }
    piv[k] = p;
    if (mx <= 1e-14 * columnNorms[k]) return null;
    if (p !== k) { const tmp = lu[k]; lu[k] = lu[p]; lu[p] = tmp; }
    const dk = lu[k][k];
    for (let i = k + 1; i < n; i++) {
      const f = lu[i][k] / dk;
      lu[i][k] = f;
      if (f !== 0) {
        for (let j = k + 1; j < n; j++) lu[i][j] -= f * lu[k][j];
      }
    }
  }
  return { lu, piv };
}

/**
 * Решение системы LU·x = b. Перестановки применяются ВСЕ
 * до прямой подстановки (семантика LAPACK dlaswp: свопы
 * факторизации переносят множители вместе со строками,
 * поэтому множители хранятся в финальном порядке строк).
 */
export function luSolve(F: LuDecomposition, b: readonly number[]): number[] {
  const n = F.lu.length;
  // Fail-closed: не-конечная правая часть — численная неудача,
  // а не «решение», содержащее NaN.
  for (let k = 0; k < n; k++) {
    const x0 = b[k];
    if (!Number.isFinite(x0)) {
      throw new OdeSolverError('numerical_failure', `luSolve: правая часть содержит нечисловую компоненту b[${k}] = ${x0}`, { index: k, value: x0 });
    }
  }
  const x = b.slice();
  for (let k = 0; k < n; k++) {
    const p = F.piv[k];
    if (p !== k) { const t = x[k]; x[k] = x[p]; x[p] = t; }
  }
  for (let k = 0; k < n; k++) {
    for (let i = k + 1; i < n; i++) x[i] -= F.lu[i][k] * x[k];
  }
  for (let k = n - 1; k >= 0; k--) {
    for (let j = k + 1; j < n; j++) x[k] -= F.lu[k][j] * x[j];
    x[k] /= F.lu[k][k];
  }
  for (let k = 0; k < n; k++) {
    if (!Number.isFinite(x[k])) {
      throw new OdeSolverError('numerical_failure', `luSolve: результат содержит нечисловую компоненту x[${k}] = ${x[k]}`, { index: k, value: x[k] });
    }
  }
  return x;
}

// ============================================
// 4. ЧИСЛЕННЫЙ ЯКОБИАН
// ============================================

/**
 * Численный якобиан конечными разностями вперёд: по столбцам,
 * шаг delta_j = sqrt(eps)·max(|y_j|, 1e-8). Используется, когда
 * problem.jacobian не задан. Стоимость: n+1 вызовов rhs.
 */
export function createNumericalJacobian(rhs: OdeRhs, stateDimension: number): OdeJacobian {
  const n = stateDimension;
  return (t: number, y: readonly number[]): number[][] => {
    const f0 = rhs(t, y);
    const columns: number[][] = [];
    for (let j = 0; j < n; j++) {
      const delta = Math.sqrt(EPS) * Math.max(Math.abs(y[j]), 1e-8);
      const yp = y.slice();
      yp[j] += delta;
      const fj = rhs(t, yp);
      const col: number[] = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) col[i] = (fj[i] - f0[i]) / delta;
      columns.push(col);
    }
    const J: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = new Array<number>(n).fill(0);
      for (let j = 0; j < n; j++) row[j] = columns[j][i];
      J.push(row);
    }
    return J;
  };
}

// ============================================
// 5. ВАЛИДАЦИЯ ВХОДОВ
// ============================================

interface ResolvedOptions {
  rtol: number;
  atol: number[];
  tEval: number[];
  initialStep?: number;
  maxStep: number;
  minStep?: number;
  maxSteps: number;
  maxNewtonIterations: number;
}

function resolveAtol(atol: number | readonly number[] | undefined, n: number): number[] {
  if (atol === undefined) return new Array<number>(n).fill(1e-12);
  if (typeof atol === 'number') {
    if (!Number.isFinite(atol) || atol <= 0) {
      throw new OdeSolverError('invalid_input', `atol должен быть конечным положительным числом, получено ${atol}`);
    }
    return new Array<number>(n).fill(atol);
  }
  if (!Array.isArray(atol) || atol.length !== n) {
    throw new OdeSolverError('invalid_input', `atol-массив должен иметь длину ${n} (размерность состояния)`);
  }
  const result: number[] = [];
  for (const v of atol) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new OdeSolverError('invalid_input', `каждый элемент atol должен быть конечным положительным числом, получено ${v}`);
    }
    result.push(v);
  }
  return result;
}

function resolveOptions(problem: OdeSolverProblem, options: OdeSolverOptions | undefined): ResolvedOptions {
  const opts = options ?? {};
  const n = problem.y0.length;
  const rtol = opts.rtol ?? 1e-6;
  if (!Number.isFinite(rtol) || rtol <= 0) {
    throw new OdeSolverError('invalid_input', `rtol должен быть конечным положительным числом, получено ${rtol}`);
  }
  const tEval = opts.tEval ? opts.tEval.slice() : [];
  for (const tv of tEval) {
    if (!Number.isFinite(tv)) {
      throw new OdeSolverError('t_eval_invalid', `tEval содержит не-конечное значение ${tv}`);
    }
  }
  for (let i = 1; i < tEval.length; i++) {
    if (tEval[i] <= tEval[i - 1]) {
      throw new OdeSolverError('t_eval_invalid', `tEval должен строго возрастать: tEval[${i}] = ${tEval[i]} ≤ tEval[${i - 1}] = ${tEval[i - 1]}`);
    }
  }
  if (tEval.length > 0 && tEval[0] < problem.t0) {
    throw new OdeSolverError('t_eval_invalid', `tEval[0] = ${tEval[0]} меньше t0 = ${problem.t0}`);
  }
  if (tEval.length > 0 && tEval[tEval.length - 1] > problem.tEnd) {
    throw new OdeSolverError('t_eval_invalid', `последний tEval = ${tEval[tEval.length - 1]} больше tEnd = ${problem.tEnd}`);
  }
  const span = problem.tEnd - problem.t0;
  const maxStep = opts.maxStep ?? span;
  if (!Number.isFinite(maxStep) || maxStep <= 0) {
    throw new OdeSolverError('invalid_input', `maxStep должен быть конечным положительным числом, получено ${maxStep}`);
  }
  if (opts.minStep !== undefined && (!Number.isFinite(opts.minStep) || opts.minStep <= 0)) {
    throw new OdeSolverError('invalid_input', `minStep должен быть конечным положительным числом, получено ${opts.minStep}`);
  }
  if (opts.initialStep !== undefined && (!Number.isFinite(opts.initialStep) || opts.initialStep <= 0)) {
    throw new OdeSolverError('invalid_input', `initialStep должен быть конечным положительным числом, получено ${opts.initialStep}`);
  }
  if (opts.minStep !== undefined && opts.minStep > maxStep) {
    throw new OdeSolverError('invalid_input', `minStep (${opts.minStep}) больше maxStep (${maxStep}): противоречивые лимиты шага`);
  }
  // Лимиты — только КОНЕЧНЫЕ ЦЕЛЫЕ ≥ 1: NaN/Infinity/ноль/
  // отрицательные/дробные значения — некорректный вход, а не
  // молчаливое округление (fail-closed, без «магических»
  // исправлений пользовательских ошибок).
  const rawMaxSteps = opts.maxSteps ?? 100000;
  if (!Number.isInteger(rawMaxSteps) || rawMaxSteps < 1) {
    throw new OdeSolverError('invalid_input', `maxSteps должен быть конечным целым числом ≥ 1, получено ${rawMaxSteps}`);
  }
  const rawMaxNewton = opts.maxNewtonIterations ?? 10;
  if (!Number.isInteger(rawMaxNewton) || rawMaxNewton < 1) {
    throw new OdeSolverError('invalid_input', `maxNewtonIterations должен быть конечным целым числом ≥ 1, получено ${rawMaxNewton}`);
  }
  return {
    rtol,
    atol: resolveAtol(opts.atol, n),
    tEval,
    initialStep: opts.initialStep,
    maxStep,
    minStep: opts.minStep,
    maxSteps: rawMaxSteps,
    maxNewtonIterations: rawMaxNewton
  };
}

function validateProblem(problem: OdeSolverProblem): void {
  if (!Array.isArray(problem.y0) || problem.y0.length === 0) {
    throw new OdeSolverError('invalid_input', 'y0 должен быть непустым массивом');
  }
  const n = problem.y0.length;
  if (problem.stateDimension !== n) {
    throw new OdeSolverError('invalid_input', `stateDimension (${problem.stateDimension}) не совпадает с длиной y0 (${n})`);
  }
  if (!Number.isFinite(problem.t0) || !Number.isFinite(problem.tEnd)) {
    throw new OdeSolverError('invalid_input', `t0 и tEnd должны быть конечными: t0 = ${problem.t0}, tEnd = ${problem.tEnd}`);
  }
  if (problem.tEnd <= problem.t0) {
    throw new OdeSolverError('invalid_input', `интервал интегрирования должен быть положительным: tEnd (${problem.tEnd}) > t0 (${problem.t0})`);
  }
  for (const v of problem.y0) {
    if (!Number.isFinite(v)) {
      throw new OdeSolverError('invalid_input', `y0 содержит не-конечное значение ${v}`);
    }
  }
  if (typeof problem.rhs !== 'function') {
    throw new OdeSolverError('invalid_input', 'rhs должен быть функцией (t, y) => number[]');
  }
  if (problem.jacobian !== undefined && typeof problem.jacobian !== 'function') {
    throw new OdeSolverError('invalid_input', 'jacobian должен быть функцией (t, y) => number[][] или отсутствовать');
  }
  if (problem.nonNegativeIndices !== undefined) {
    if (!Array.isArray(problem.nonNegativeIndices)) {
      throw new OdeSolverError('invalid_input', 'nonNegativeIndices должен быть массивом индексов');
    }
    const seen = new Set<number>();
    for (const idx of problem.nonNegativeIndices) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= n) {
        throw new OdeSolverError('invalid_input', `nonNegativeIndices содержит некорректный индекс ${idx} (нужен 0..${n - 1})`);
      }
      if (seen.has(idx)) {
        throw new OdeSolverError('invalid_input', `nonNegativeIndices содержит дубликат индекса ${idx}`);
      }
      seen.add(idx);
    }
  }
  if (problem.linearInvariants !== undefined) {
    if (!Array.isArray(problem.linearInvariants)) {
      throw new OdeSolverError('invalid_input', 'linearInvariants должен быть массивом описаний инвариантов');
    }
    for (const inv of problem.linearInvariants) {
      if (!Array.isArray(inv.coefficients) || inv.coefficients.length !== n) {
        throw new OdeSolverError('invalid_input', `коэффициенты линейного инварианта должны иметь длину ${n}`);
      }
      for (const c of inv.coefficients) {
        if (!Number.isFinite(c)) {
          throw new OdeSolverError('invalid_input', `коэффициенты инварианта должны быть конечными, получено ${c}`);
        }
      }
      if (!Number.isFinite(inv.expected)) {
        throw new OdeSolverError('invalid_input', `ожидаемое значение инварианта должно быть конечным, получено ${inv.expected}`);
      }
      if (inv.absTolerance !== undefined && (!Number.isFinite(inv.absTolerance) || inv.absTolerance < 0)) {
        throw new OdeSolverError('invalid_input', `absTolerance инварианта должен быть конечным неотрицательным числом, получено ${inv.absTolerance}`);
      }
      if (inv.relTolerance !== undefined && (!Number.isFinite(inv.relTolerance) || inv.relTolerance < 0)) {
        throw new OdeSolverError('invalid_input', `relTolerance инварианта должен быть конечным неотрицательным числом, получено ${inv.relTolerance}`);
      }
    }
  }
}

// ============================================
// 6. ОБЁРТКИ ОБРАТНЫХ ВЫЗОВОВ (диагностические коды)
// ============================================

interface RunContext {
  stats: {
    attemptedSteps: number;
    acceptedSteps: number;
    rejectedSteps: number;
    newtonFailures: number;
    rhsEvaluations: number;
    jacobianEvaluations: number;
    luFactorizations: number;
    maxNewtonIterationsUsed: number;
    maxAcceptedStepSize: number;
    minAcceptedStepSize: number;
  };
  rtol: number;
  atol: number[];
}

function callRhs(problem: OdeSolverProblem, t: number, y: number[], ctx: RunContext): number[] {
  let r: number[];
  try {
    r = problem.rhs(t, y);
  } catch {
    throw new OdeSolverError('rhs_callback_error', `rhs-обратный вызов бросил исключение при t = ${t}`, { t });
  }
  ctx.stats.rhsEvaluations++;
  const n = y.length;
  if (!Array.isArray(r) || r.length !== n) {
    throw new OdeSolverError('rhs_dimension_mismatch', `rhs вернул ${Array.isArray(r) ? `массив длины ${r.length}` : 'не массив'} вместо ${n} компонент при t = ${t}`, { t });
  }
  for (const v of r) {
    if (!Number.isFinite(v)) {
      throw new OdeSolverError('rhs_non_finite', `rhs вернул не-конечное значение при t = ${t}`, { t });
    }
  }
  return r;
}

function callJacobian(jacobian: OdeJacobian, t: number, y: number[], ctx: RunContext): number[][] {
  let J: number[][];
  try {
    J = jacobian(t, y);
  } catch {
    throw new OdeSolverError('jacobian_callback_error', `якобиан-обратный вызов бросил исключение при t = ${t}`, { t });
  }
  ctx.stats.jacobianEvaluations++;
  const n = y.length;
  if (!Array.isArray(J) || J.length !== n) {
    throw new OdeSolverError('jacobian_invalid', `якобиан должен быть матрицей ${n}×${n}, получено строк: ${Array.isArray(J) ? J.length : 'не массив'}`, { t });
  }
  for (const row of J) {
    if (!Array.isArray(row) || row.length !== n) {
      throw new OdeSolverError('jacobian_invalid', `строка якобиана должна иметь ${n} элементов`, { t });
    }
    for (const v of row) {
      if (!Number.isFinite(v)) {
        throw new OdeSolverError('jacobian_invalid', `якобиан содержит не-конечное значение при t = ${t}`, { t });
      }
    }
  }
  return J;
}

// ============================================
// 7. ОДИН ШАГ RADAU IIA (упрощённый Ньютон)
// ============================================

const NODES = RADAU_IIA_NODES;
const MATRIX_A = RADAU_IIA_MATRIX_A;

interface NewtonSuccess {
  ok: true;
  y1: number[];
  Z: number[][];
}
type NewtonOutcome = NewtonSuccess | { ok: false };

/**
 * Один неявный шаг метода. Система стадий Z_i = h·Σ_j A_ij·f(t+c_j·h, y+Z_j)
 * решается упрощённым Ньютоном: якобиан J(t, y) и LU-факторизация
 * вычисляются ОДИН раз на шаг, итерации идут на фиксированной матрице.
 * Сходимость контролируется по скорости rate (см. шапку файла);
 * сингулярная LU — немедленный отказ lu_singular (fail-closed).
 */
function radauStep(
  t: number,
  y: readonly number[],
  h: number,
  z0: readonly (readonly number[])[],
  jacobian: OdeJacobian,
  problem: OdeSolverProblem,
  ctx: RunContext,
  newtonTol: number,
  maxNewtonIterations: number
): NewtonOutcome {
  const n = y.length;
  const m = 3 * n;
  const J = callJacobian(jacobian, t, y as number[], ctx);
  const M: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          M[i * n + a][j * n + b] = (i === j && a === b ? 1 : 0) - h * MATRIX_A[i][j] * J[a][b];
        }
      }
    }
  }
  const F = luFactor(M);
  ctx.stats.luFactorizations++;
  if (F === null) {
    throw new OdeSolverError('lu_singular', `система стадий вырождена при t = ${t}, h = ${h}: LU-факторизация сингулярна`, { t, h });
  }
  const Z: number[][] = [z0[0].slice(), z0[1].slice(), z0[2].slice()];
  let prevD: number | null = null;
  for (let k = 0; k < maxNewtonIterations; k++) {
    ctx.stats.maxNewtonIterationsUsed = Math.max(ctx.stats.maxNewtonIterationsUsed, k + 1);
    const fstage: number[][] = [];
    const scaleMax: number[] = y.map((v) => Math.abs(v));
    for (let j = 0; j < 3; j++) {
      const yj = y.map((v, idx) => v + Z[j][idx]);
      // Стадийные значения обязаны быть конечными до вызова rhs:
      // не-конечная стадия — отказ шага (уменьшение h), а не
      // «решение» с NaN, ушедшее в обратный вызов.
      let yjFinite = true;
      for (let a = 0; a < n; a++) {
        if (!Number.isFinite(yj[a])) { yjFinite = false; break; }
      }
      if (!yjFinite) return { ok: false };
      fstage.push(callRhs(problem, t + NODES[j] * h, yj, ctx));
      for (let a = 0; a < n; a++) scaleMax[a] = Math.max(scaleMax[a], Math.abs(yj[a]));
    }
    // Веса Ньютона по стадийным значениям (Hairer NORMX).
    const scale = scaleMax.map((v, a) => ctx.atol[a] + ctx.rtol * v);
    const rhsBig = new Array<number>(m).fill(0);
    for (let i = 0; i < 3; i++) {
      for (let a = 0; a < n; a++) {
        let s = 0;
        for (let j = 0; j < 3; j++) s += MATRIX_A[i][j] * fstage[j][a];
        rhsBig[i * n + a] = -(Z[i][a] - h * s);
      }
    }
    let d: number[];
    try {
      d = luSolve(F, rhsBig);
    } catch (e) {
      // Численная неудача внутри линейной алгебры — отказ шага
      // с уменьшением h (никаких «решений», содержащих NaN).
      if (e instanceof OdeSolverError && e.code === 'numerical_failure') return { ok: false };
      throw e;
    }
    for (let i = 0; i < 3; i++) {
      for (let a = 0; a < n; a++) Z[i][a] += d[i * n + a];
    }
    const dW = weightedRmsNorm(d, [...scale, ...scale, ...scale]);
    // Не-конечная норма поправки Ньютона — отказ шага, а не
    // ложная сходимость (сравнения с NaN всегда ложны).
    if (!Number.isFinite(dW)) return { ok: false };
    let rate: number | null = null;
    if (prevD !== null) rate = dW / prevD;
    if (dW === 0 || (rate !== null && rate < 1 && (rate / (1 - rate)) * dW < newtonTol)) {
      const y1 = y.map((v, a) => v + Z[2][a]);
      for (let a = 0; a < n; a++) {
        if (!Number.isFinite(y1[a])) return { ok: false };
      }
      return { ok: true, y1, Z };
    }
    if (rate !== null && (rate >= 1 || (Math.pow(rate, maxNewtonIterations - k) / (1 - rate)) * dW > newtonTol)) {
      return { ok: false };
    }
    prevD = dW;
  }
  return { ok: false };
}

/**
 * Взвешенная RMS-норма: sqrt(mean((v_i/s_i)^2)). Устойчива к
 * переполнению: нормировка на максимум модуля ДО возведения в
 * квадрат (|v_i/mx| ≤ 1, поэтому квадраты не переполняются).
 * Не-конечные элементы дают не-конечную норму (NaN/Infinity),
 * которую вызывающий код обязан проверить, а не
 * интерпретировать как «малую ошибку».
 */
function weightedRmsNorm(v: readonly number[], scale: readonly number[]): number {
  let mx = 0;
  for (const x of v) mx = Math.max(mx, Math.abs(x));
  if (!Number.isFinite(mx)) return mx;
  if (mx === 0) return 0;
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const si = Math.abs(scale[i]);
    if (!Number.isFinite(si) || si === 0) return Infinity;
    const q = (v[i] / mx) / si;
    sum += q * q;
  }
  const rms = Math.sqrt(sum / v.length) * mx;
  return Number.isFinite(rms) ? rms : Infinity;
}

/**
 * Допуск проверки линейного инварианта: покомпонентный шумовый
 * пол Σ|c_i|·atol_i плюс относительная часть
 * relTolerance·max(|expected|, Σ|c_i·y_i|). Допуск масштабируется
 * по данным задачи, а не по max(1, ·): относительные нарушения
 * видны при любых масштабах, включая малые концентрации ~1e-20.
 * Не-конечный допуск — численная неудача (fail-closed).
 */
function invariantTolerance(inv: LinearInvariant, y: readonly number[], opts: ResolvedOptions): number {
  const sumAbs = inv.coefficients.reduce((s, c, i) => s + Math.abs(c) * opts.atol[i], 0);
  const absTol = inv.absTolerance ?? sumAbs;
  const scale = Math.max(Math.abs(inv.expected), inv.coefficients.reduce((s, c, i) => s + Math.abs(c * y[i]), 0));
  const tol = absTol + (inv.relTolerance ?? opts.rtol) * scale;
  if (!Number.isFinite(tol)) {
    throw new OdeSolverError('numerical_failure', `допуск линейного инварианта не конечен: масштаб компонент за пределами double`, { expected: inv.expected, sumAbs });
  }
  return tol;
}

// ============================================
// 8. ГЛАВНЫЙ ИНТЕГРАТОР
// ============================================

/**
 * Интегрирование задачи Коши методом Radau IIA (порядок 5,
 * L-stable) с адаптивным шагом (step-doubling, делитель 31).
 *
 * Возвращает результат только с реальным численным решением;
 * при невозможности продолжать бросает OdeSolverError со
 * стабильным кодом (см. ODE_ERROR_CODES).
 */
export function solveOdeWithRadauIia(problem: OdeSolverProblem, options?: OdeSolverOptions): OdeSolverResult {
  validateProblem(problem);
  const opts = resolveOptions(problem, options);
  const n = problem.y0.length;
  if (n > RADAU_IIA_MAX_STATE_DIMENSION) {
    throw new OdeSolverError(
      'invalid_input',
      `размерность состояния ${n} превышает максимум плотного решателя (${RADAU_IIA_MAX_STATE_DIMENSION}); разреженные якобианы не поддерживаются`
    );
  }
  // Статистика честная: attemptedSteps === acceptedSteps +
  // rejectedSteps для любого ЗАВЕРШИВШЕГОСЯ интегрирования —
  // каждая попытка шага заканчивается либо принятием, либо
  // отказом (newtonFailures ≤ rejectedSteps). Прерванное
  // интегрирование этим инвариантом не гарантируется.
  const stats = {
    attemptedSteps: 0,
    acceptedSteps: 0,
    rejectedSteps: 0,
    newtonFailures: 0,
    rhsEvaluations: 0,
    jacobianEvaluations: 0,
    luFactorizations: 0,
    maxNewtonIterationsUsed: 0,
    maxAcceptedStepSize: 0,
    minAcceptedStepSize: Infinity
  };
  const ctx: RunContext = { stats, rtol: opts.rtol, atol: opts.atol };
  const jacobian: OdeJacobian = problem.jacobian ?? createNumericalJacobian((t, y) => problem.rhs(t, y), n);
  const nonNegativeIndices = problem.nonNegativeIndices ?? [];
  const linearInvariants = problem.linearInvariants ?? [];
  const newtonTol = Math.max((10 * EPS) / opts.rtol, Math.min(0.03, Math.sqrt(opts.rtol)));

  // Инварианты обязаны выполняться на y0 (без коррекции вектора).
  // Допуск покомпонентный и масштабируется по данным (см.
  // invariantTolerance): нарушения видны при малых концентрациях.
  for (const inv of linearInvariants) {
    const value = inv.coefficients.reduce((s, c, i) => s + c * problem.y0[i], 0);
    const tolerance = invariantTolerance(inv, problem.y0, opts);
    if (Math.abs(value - inv.expected) > tolerance) {
      throw new OdeSolverError('invariant_violation', `линейный инвариант нарушен уже на y0: ${value} ≠ ${inv.expected} (допуск ${tolerance})`, { value, expected: inv.expected, tolerance });
    }
  }

  // Контракт minorNegativeCount: число малых (в пределах допуска
  // atol_i + rtol·|y_i|) отрицательных компонент, сохранённых КАК
  // ЕСТЬ без clipping. Учитываются ТОЛЬКО начальное состояние (y0)
  // и ПРИНЯТЫЕ состояния (по одному на компоненту за принятый
  // шаг); кандидаты отклонённых попыток шага (превышение локальной
  // ошибки, несходимость Ньютона, нарушение инварианта или
  // неотрицательности) в счётчик НЕ попадают: диагностика
  // отражает реальную траекторию, а не историю проб.
  let minorNegativeCount = 0;

  // Неотрицательность проверяется и на y0: существенно
  // отрицательная компонента начального состояния — противоречие
  // в постановке задачи (nonneg_violation), молчаливое
  // исправление (clipping) невозможно; небольшой минус в
  // пределах допуска сохраняется как есть и учитывается в
  // minorNegativeCount.
  for (const idx of nonNegativeIndices) {
    const v = problem.y0[idx];
    if (v < 0) {
      const tolerance = opts.atol[idx] + opts.rtol * Math.abs(v);
      if (Math.abs(v) > tolerance) {
        throw new OdeSolverError('nonneg_violation', `компонента y0[${idx}] = ${v} отрицательна за пределами допуска (${tolerance}) при заявленной неотрицательности; молчаливое исправление невозможно`, { index: idx, value: v, tolerance });
      }
      // Малый минус начального состояния (в пределах допуска):
      // сохраняется без clipping и попадает в диагностику.
      minorNegativeCount++;
    }
  }

  let t = problem.t0;
  const y = problem.y0.slice();
  const span = problem.tEnd - problem.t0;
  const scale0 = y.map((v, a) => opts.atol[a] + opts.rtol * Math.abs(v));
  const f0 = callRhs(problem, t, y, ctx);
  // Начальный шаг: алгоритм Hairer (Solving ODEs I, §II.4) в
  // форме select_initial_step SciPy solve_ivp — условие выбора
  // пробного шага ДОСЛОВНО как в SciPy: при вырожденных нормах
  // (d0 < 1e-5 или d1 < 1e-5, в т.ч. y0 = 0 при y' ≠ 0) —
  // абсолютный fallback h0 = 1e-6 (НЕ 1e-6·span: единицы времени
  // задачи произвольны и шаг не масштабируется интервалом),
  // иначе h0 = 0.01·d0/d1. Интегратор НИКОГДА не начинает с
  // нулевого шага: неконечный/неположительный выбор —
  // fail-closed fallback 1e-6. До пробного вызова rhs шаг h0
  // ограничен интервалом (h0 ≤ span): rhs не вызывается вне
  // [t0, tEnd]. Вторая пробная точка уточняет норму ИЗМЕНЕНИЯ
  // производной d2 = norm(f1 − f0)/h0 (как в SciPy), а не норму
  // самой f1; вырожденные d1 и d2 (обе ≤ 1e-15) дают умеренный
  // h1 = max(1e-6, h0·1e-3) вместо деления на нулевую норму
  // (h1 = Infinity). Итог ограничен maxStep и span с первого
  // шага. Неконечный/неположительный выбор — numerical_failure.
  let h: number;
  if (opts.initialStep !== undefined) {
    h = opts.initialStep;
  } else {
    const d0 = weightedRmsNorm(y, scale0);
    const d1 = weightedRmsNorm(f0, scale0);
    // Условие SciPy select_initial_step (дословно):
    //   if d0 < 1e-5 or d1 < 1e-5: h0 = 1e-6
    //   else:                     h0 = 0.01 * d0 / d1
    let h0: number;
    if (d0 < 1e-5 || d1 < 1e-5) {
      h0 = 1e-6;
    } else {
      h0 = 0.01 * (d0 / d1);
    }
    // Fail-closed страховка конечности/положительности (не-конечные
    // нормы возможны только при экзотических scale/y; поведение
    // ниже всё равно fail-closed на численной проверке h).
    if (!Number.isFinite(h0) || h0 <= 0) h0 = 1e-6;
    // Пробный вызов rhs — строго внутри [t0, tEnd] (соответствует
    // min(h0, interval_length) SciPy select_initial_step): h0
    // конечен, строго положителен и не превышает длину интервала.
    if (h0 > span) h0 = span;
    const yProbe = y.map((v, a) => v + h0 * f0[a]);
    const f1 = callRhs(problem, t + h0, yProbe, ctx);
    // d2 — норма ИЗМЕНЕНИЯ производной на пробном шаге
    // (SciPy: norm((f1 − f0)/scale)/h0), а не норма самой f1.
    // weightedRmsNorm честно возвращает NaN/Infinity —
    // не-конечные данные дают numerical_failure ниже (fail-closed).
    const d2 = weightedRmsNorm(f1.map((v, a) => v - f0[a]), scale0) / h0;
    let h1: number;
    if (d1 <= 1e-15 && d2 <= 1e-15) {
      // Вырожденный случай (постоянная/почти нулевая производная
      // без изменения): деление на нулевую норму не даёт
      // h1 = Infinity и неоправданно большой начальный шаг.
      h1 = Math.max(1e-6, h0 * 1e-3);
    } else {
      h1 = Math.pow(0.01 / Math.max(d1, d2), 1 / 6);
    }
    h = Math.min(100 * h0, h1, opts.maxStep, span);
  }
  if (!Number.isFinite(h) || h <= 0) {
    const d0v = weightedRmsNorm(y, scale0);
    const d1v = weightedRmsNorm(f0, scale0);
    throw new OdeSolverError('numerical_failure', `не удалось выбрать конечный положительный начальный шаг (h = ${h})`, { h, d0: d0v, d1: d1v });
  }
  h = Math.min(h, opts.maxStep, span);
  if (!Number.isFinite(h) || h <= 0) {
    throw new OdeSolverError('numerical_failure', `начальный шаг выродился после ограничений maxStep/span (h = ${h})`, { h, maxStep: opts.maxStep, span });
  }
  if (opts.minStep !== undefined) h = Math.max(opts.minStep, h);

  const tEval = opts.tEval;
  let evalIndex = 0;
  const points: { t: number; y: number[] }[] = [];
  // Точка tEval, совпадающая с t0 (строгое возрастание допускает
  // равенство только для первой точки), записывается без шага.
  while (evalIndex < tEval.length && tEval[evalIndex] === t) {
    points.push({ t, y: y.slice() });
    evalIndex++;
  }
  let prevStages: number[][] | null = null;
  let prevStep = 0;
  let invariantChecks = 0;

  const zeroStages = (): number[][] => [0, 1, 2].map(() => y.map(() => 0));
  const scaleStages = (Z: readonly (readonly number[])[], factor: number, shift?: readonly number[]): number[][] =>
    Z.map((zi) => zi.map((v, a) => v * factor + (shift ? shift[a] : 0)));

  while (t < problem.tEnd) {
    if (++stats.attemptedSteps > opts.maxSteps) {
      throw new OdeSolverError('max_steps_exceeded', `превышен лимит попыток шагов (${opts.maxSteps}) при t = ${t}`, { t, maxSteps: opts.maxSteps });
    }
    // Динамический машинный порог отказа (семантика SciPy nextafter);
    // пользовательский minStep имеет приоритет.
    const minStepEffective = opts.minStep ?? 10 * EPS * Math.max(Math.abs(t), 1e-6);
    const target = evalIndex < tEval.length ? Math.min(tEval[evalIndex], problem.tEnd) : problem.tEnd;
    const distance = target - t;
    const hTry = Math.min(h, distance);
    const clippedToTarget = hTry >= distance;
    const stagesFull = prevStages ? scaleStages(prevStages, hTry / prevStep) : zeroStages();
    const stagesHalf = prevStages ? scaleStages(prevStages, (hTry / 2) / prevStep) : zeroStages();

    const full = radauStep(t, y, hTry, stagesFull, jacobian, problem, ctx, newtonTol, opts.maxNewtonIterations);
    if (!full.ok) {
      // Отказ Ньютона — это тоже ЗАВЕРШИВШАЯСЯ попытка шага:
      // учитывается и в newtonFailures, и в rejectedSteps
      // (attemptedSteps === acceptedSteps + rejectedSteps).
      stats.newtonFailures++;
      stats.rejectedSteps++;
      if (hTry * 0.3 < minStepEffective) {
        throw new OdeSolverError('newton_non_convergence', `Ньютон не сошёлся при t = ${t}, h = ${hTry}, уменьшение шага невозможно`, { t, h: hTry });
      }
      h = hTry * 0.3;
      continue;
    }
    const half1 = radauStep(t, y, hTry / 2, stagesHalf, jacobian, problem, ctx, newtonTol, opts.maxNewtonIterations);
    if (!half1.ok) {
      stats.newtonFailures++;
      stats.rejectedSteps++;
      if (hTry * 0.3 < minStepEffective) {
        throw new OdeSolverError('newton_non_convergence', `Ньютон не сошёлся (первый полушаг) при t = ${t}, h = ${hTry}`, { t, h: hTry });
      }
      h = hTry * 0.3;
      continue;
    }
    // Прогноз стадий второго полушага: масштабированные стадии
    // предыдущего шага + сдвиг базовой точки.
    const shift = half1.y1.map((v, a) => v - y[a]);
    const stagesHalf2 = prevStages ? scaleStages(prevStages, (hTry / 2) / prevStep, shift) : zeroStages();
    const half2 = radauStep(t + hTry / 2, half1.y1, hTry / 2, stagesHalf2, jacobian, problem, ctx, newtonTol, opts.maxNewtonIterations);
    if (!half2.ok) {
      stats.newtonFailures++;
      stats.rejectedSteps++;
      if (hTry * 0.3 < minStepEffective) {
        throw new OdeSolverError('newton_non_convergence', `Ньютон не сошёлся (второй полушаг) при t = ${t}, h = ${hTry}`, { t, h: hTry });
      }
      h = hTry * 0.3;
      continue;
    }

    const yFine = half2.y1;
    const yFull = full.y1;
    const scale = y.map((v, a) => opts.atol[a] + opts.rtol * Math.max(Math.abs(v), Math.abs(yFine[a])));
    const err = weightedRmsNorm(yFine.map((v, a) => (v - yFull[a]) / STEP_DOUBLING_DIVISOR), scale);
    // Не-конечная ошибка (NaN/Infinity) НЕ проходит как «малая»:
    // шаг отклоняется с уменьшением h (fail-closed).
    if (!Number.isFinite(err) || err > 1) {
      stats.rejectedSteps++;
      const nextH = hTry * (Number.isFinite(err) ? Math.min(0.8, Math.max(0.1, 0.9 * Math.pow(err, -1 / 6))) : 0.3);
      if (nextH < minStepEffective) {
        throw new OdeSolverError('min_step_violated', `локальная ошибка превышает допуск при t = ${t}, h = ${hTry}, err = ${err}, уменьшение шага невозможно`, { t, h: hTry, err });
      }
      h = nextH;
      continue;
    }

    // Неотрицательность БЕЗ молчаливого clipping.
    let nonnegRejected = false;
    for (const idx of nonNegativeIndices) {
      const v = yFine[idx];
      if (v < 0) {
        const minorTolerance = opts.atol[idx] + opts.rtol * Math.abs(y[idx]);
        if (Math.abs(v) > minorTolerance) {
          nonnegRejected = true;
          break;
        }
        // Малый минус КАНДИДАТА здесь НЕ учитывается: шаг ещё не
        // принят — если он будет отклонён (ошибка, инвариант),
        // эта проба не должна попасть в minorNegativeCount.
        // Принятые состояния считаются после принятия шага.
      }
    }
    if (nonnegRejected) {
      stats.rejectedSteps++;
      const nextH = hTry * 0.3;
      if (nextH < minStepEffective) {
        throw new OdeSolverError('nonneg_violation', `неотрицательная компонента y[${nonNegativeIndices.join(', ')}] существенно отрицательна при t = ${t}: решение не может быть продолжено без молчаливой коррекции`, { t, h: hTry });
      }
      h = nextH;
      continue;
    }

    // Линейные инварианты (без коррекции вектора); допуск
    // покомпонентный, масштабируется по данным (invariantTolerance).
    let invariantRejected = false;
    for (const inv of linearInvariants) {
      invariantChecks++;
      const value = inv.coefficients.reduce((s, c, i) => s + c * yFine[i], 0);
      const tolerance = invariantTolerance(inv, yFine, opts);
      if (Math.abs(value - inv.expected) > tolerance) {
        invariantRejected = true;
        break;
      }
    }
    if (invariantRejected) {
      stats.rejectedSteps++;
      const nextH = hTry * 0.3;
      if (nextH < minStepEffective) {
        throw new OdeSolverError('invariant_violation', `линейный инвариант нарушен при t = ${t} и не восстанавливается уменьшением шага`, { t, h: hTry });
      }
      h = nextH;
      continue;
    }

    // Принятие шага.
    stats.acceptedSteps++;
    stats.maxAcceptedStepSize = Math.max(stats.maxAcceptedStepSize, hTry);
    stats.minAcceptedStepSize = Math.min(stats.minAcceptedStepSize, hTry);
    for (let a = 0; a < n; a++) y[a] = yFine[a];
    // Малые отрицательные компоненты ПРИНЯТОГО состояния: все
    // проверки пройдены, значит любой минус — в пределах допуска
    // (существенный отклонил бы шаг). Кандидаты отклонённых проб
    // не считаются — диагностика отражает реальную траекторию.
    for (const idx of nonNegativeIndices) {
      if (yFine[idx] < 0) minorNegativeCount++;
    }
    // Строгое продвижение времени: если шаг выродился относительно
    // масштаба t (t + h === t в арифметике double), интегратор
    // зациклился бы на одном месте — это численная неудача.
    const tNew = clippedToTarget ? target : t + hTry;
    if (!(tNew > t)) {
      throw new OdeSolverError('numerical_failure', `шаг выродился (h = ${hTry}) при t = ${t}: продвижение времени невозможно`, { t, h: hTry });
    }
    t = tNew;
    if (evalIndex < tEval.length && t === tEval[evalIndex]) {
      points.push({ t, y: y.slice() });
      evalIndex++;
    }
    prevStages = full.Z;
    prevStep = hTry;
    h = Math.min(opts.maxStep, hTry * Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -1 / 6))));
  }

  // Финальная точка добавляется, если она не была запрошена через tEval.
  if (points.length === 0 || points[points.length - 1].t !== t) {
    points.push({ t, y: y.slice() });
  }
  if (stats.minAcceptedStepSize === Infinity) stats.minAcceptedStepSize = 0;

  // «solved» никогда не возвращается с не-конечным состоянием
  // или контрольными точками (fail-closed).
  for (let a = 0; a < n; a++) {
    if (!Number.isFinite(y[a])) {
      throw new OdeSolverError('numerical_failure', `конечное состояние содержит не-конечную компоненту y[${a}] = ${y[a]}`, { index: a, value: y[a] });
    }
  }
  for (const p of points) {
    for (let a = 0; a < n; a++) {
      if (!Number.isFinite(p.y[a])) {
        throw new OdeSolverError('numerical_failure', `контрольная точка t = ${p.t} содержит не-конечную компоненту y[${a}]`, { t: p.t, index: a });
      }
    }
  }

  const diagnostics = {
    backendId: RADAU_IIA_BACKEND_ID,
    method: RADAU_IIA_METHOD_ID,
    message: 'ODE проинтегрировано методом Radau IIA (3 стадии, порядок 5, L-stable)',
    minorNegativeCount,
    invariantChecks
  };
  return {
    status: 'solved',
    method: RADAU_IIA_METHOD_ID,
    t0: problem.t0,
    tEnd: problem.tEnd,
    t,
    y,
    points,
    stats,
    diagnostics
  };
}

// ============================================
// 9. BACKEND ДЛЯ РЕЕСТРА
// ============================================

/**
 * ODE-бэкенд Radau IIA. Регистрируется через
 * createSolverBackendRegistry().registerAvailable() ТОЛЬКО
 * после проверки контракта validateBackendContract (которая
 * сама выполняет минимальный реальный прогон solveOde).
 *
 * Общий solve() не выполняет интегрирования: у ODE-бэкенда
 * специализированный контракт solveOde.
 */
export function createRadauIiaOdeBackend(): OdeSolverBackend {
  const capabilities = {
    problemKinds: ['ode'] as const,
    implementedMethods: [RADAU_IIA_METHOD_ID],
    adaptiveStep: true,
    implicit: true,
    stiff: true,
    sparseJacobian: false,
    maxStateDimension: RADAU_IIA_MAX_STATE_DIMENSION,
    deterministic: 'within_tolerance' as const
  };
  return {
    id: RADAU_IIA_BACKEND_ID,
    version: '1.0.0',
    capabilities,
    supports(problem) {
      return problem.kind === 'ode' && problem.stateDimension >= 1 && problem.stateDimension <= RADAU_IIA_MAX_STATE_DIMENSION;
    },
    solve(problem) {
      return {
        status: 'error',
        diagnostics: {
          backendId: RADAU_IIA_BACKEND_ID,
          problemKind: problem.kind,
          message: 'ODE-бэкенд не решает задачи через общий solve(): используйте специализированный вызов solveOde(problem, options)',
          details: { method: RADAU_IIA_METHOD_ID }
        }
      };
    },
    solveOde(problem, options) {
      return solveOdeWithRadauIia(problem, options);
    }
  };
}

