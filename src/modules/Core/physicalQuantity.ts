// ============================================
// PHYSICAL QUANTITY - Физическая величина с размерностью
// ============================================
//
// Единая система представления физических величин ядра научной
// симуляции (Stage 4.1).
//
// Контракт:
// - каждая величина = число + идентификатор единицы из реестра;
// - каждая единица имеет ЯВНУЮ размерность (показатели базовых
//   единиц SI) и множитель к когерентной единице SI своей размерности;
// - математические операции проверяют совместимость размерностей
//   на этапе исполнения (складывать массу с температурой нельзя);
// - исходные единицы сохраняются; преобразование в другую единицу
//   той же размерности — только явным вызовом convert();
// - NaN и бесконечности запрещены на входе (ошибка invalid_number);
// - знак не запрещается сам по себе: для потоков, координат и
//   энергетического обмена отрицательные значения имеют физический
//   смысл. Запреты отрицательных значений там, где они физически
//   невозможны (запас вещества), выполняются на уровне инвентаря
//   (см. reservoir.ts), а не самой величины.
//
// Этот модуль НЕ заменяет модуль Units (константы и конвертеры
// этапа 3, с русскими единицами в PhysValue). Units продолжает
// работать; сопоставление единиц для адаптеров — в adapters.ts.

// ============================================
// 1. РАЗМЕРНОСТЬ
// ============================================

/**
 * Размерность через показатели семи базовых единиц SI.
 * Только целые показатели; для проекта этого достаточно
 * (экспоненты вроде 1/2 в размерностях ядра не встречаются).
 */
export interface Dimension {
  kg: number; // масса
  m: number; // длина
  s: number; // время
  K: number; // термодинамическая температура
  A: number; // сила электрического тока
  mol: number; // количество вещества
  cd: number; // сила света
}

/** Безразмерная величина (в т.ч. молярная/массовая доля, угол в радианах). */
export const DIMENSIONLESS: Dimension = { kg: 0, m: 0, s: 0, K: 0, A: 0, mol: 0, cd: 0 };

/** Краткая запись размерности в порядке базовых единиц SI. */
export function dimension(
  kg = 0, m = 0, s = 0, K = 0, A = 0, mol = 0, cd = 0
): Dimension {
  return { kg, m, s, K, A, mol, cd };
}

/** Совпадают ли две размерности (показатели равны попарно). */
export function sameDimension(a: Dimension, b: Dimension): boolean {
  return (
    a.kg === b.kg && a.m === b.m && a.s === b.s && a.K === b.K &&
    a.A === b.A && a.mol === b.mol && a.cd === b.cd
  );
}

const DIMENSION_PARTS: [keyof Dimension, string][] = [
  ['kg', 'kg'], ['m', 'm'], ['s', 's'], ['K', 'K'],
  ['A', 'A'], ['mol', 'mol'], ['cd', 'cd']
];

/** Строковое представление размерности (kg·m²·s⁻³·K⁻¹·mol·A·cd). */
export function dimensionToString(d: Dimension): string {
  const parts: string[] = [];
  for (const [key, symbol] of DIMENSION_PARTS) {
    const power = d[key];
    if (power === 0) continue;
    parts.push(power === 1 ? symbol : `${symbol}^${power}`);
  }
  return parts.length === 0 ? '1' : parts.join('·');
}

// ============================================
// 2. СТРУКТУРИРОВАННАЯ ОШИБКА
// ============================================

/** Коды ошибок системы величин. */
export type QuantityErrorCode =
  | 'invalid_number'        // NaN или бесконечность во входных данных
  | 'unknown_unit'          // единица не зарегистрирована
  | 'incompatible_dimension'// операция между разными размерностями
  | 'overflow'              // результат преобразования непредставим
  | 'invalid_operation';    // прочая некорректная операция

/**
 * Структурированная ошибка: код, компонент, операция, ожидаемая и
 * фактическая размерность/единица. Не общий Error("Invalid data").
 */
export class QuantityError extends Error {
  readonly code: QuantityErrorCode;
  readonly component: string;
  readonly operation: string;
  readonly expected?: string;
  readonly actual?: string;

  constructor(args: {
    code: QuantityErrorCode;
    component: string;
    operation: string;
    message: string;
    expected?: string;
    actual?: string;
  }) {
    super(
      `[${args.component}/${args.operation}] ${args.message}` +
      (args.expected !== undefined ? ` (ожидалось: ${args.expected})` : '') +
      (args.actual !== undefined ? ` (фактически: ${args.actual})` : '')
    );
    this.name = 'QuantityError';
    this.code = args.code;
    this.component = args.component;
    this.operation = args.operation;
    this.expected = args.expected;
    this.actual = args.actual;
  }
}

// ============================================
// 3. РЕЕСТР ЕДИНИЦ
// ============================================

/**
 * Определение единицы.
 *
 * factor: значение_в_единице * factor = значение в когерентной единице
 * SI той же размерности (например, km → 1000 м; atm → 101325 Па).
 * Температура поддерживается только в кельвинах: аффинные шкалы
 * (°C, °F) в реестр не включены, чтобы не смешивать мультипликативные
 * и аффинные преобразования.
 */
export interface UnitDefinition {
  id: string;
  name: string;
  dimension: Dimension;
  factor: number;
  /** Особенности интерпретации единицы, если есть. */
  note?: string;
}

/**
 * Реестр единиц ядра. Идентификаторы ASCII.
 *
 * Год — юлианский (365.25 сут = 3.15576e7 с): то же определение,
 * что и в Units.YEAR_S. Определение года фиксируется явно: «yr»
 * БЕЗ такого примечания неоднозначен.
 *
 * Углы: rad и deg — безразмерные единицы с семантикой плоского угла.
 * Это математические единицы ( deg = π/180 rad ), физической
 * размерности у угла в модели не вводится.
 */
const UNIT_TABLE: UnitDefinition[] = [
  // --- длина ---
  { id: 'm', name: 'метр', dimension: dimension(0, 1), factor: 1 },
  { id: 'km', name: 'километр', dimension: dimension(0, 1), factor: 1e3 },
  { id: 'cm', name: 'сантиметр', dimension: dimension(0, 1), factor: 1e-2 },
  { id: 'mm', name: 'миллиметр', dimension: dimension(0, 1), factor: 1e-3 },
  { id: 'AU', name: 'астрономическая единица', dimension: dimension(0, 1), factor: 1.495978707e11, note: 'астрономическая единица IAU 2012, в метрах' },
  // --- масса ---
  { id: 'kg', name: 'килограмм', dimension: dimension(1), factor: 1 },
  { id: 'g', name: 'грамм', dimension: dimension(1), factor: 1e-3 },
  // --- время ---
  { id: 's', name: 'секунда', dimension: dimension(0, 0, 1), factor: 1 },
  { id: 'min', name: 'минута', dimension: dimension(0, 0, 1), factor: 60 },
  { id: 'h', name: 'час', dimension: dimension(0, 0, 1), factor: 3600 },
  { id: 'day', name: 'сутки', dimension: dimension(0, 0, 1), factor: 86400 },
  { id: 'yr', name: 'юлианский год', dimension: dimension(0, 0, 1), factor: 3.15576e7, note: 'юлианский год 365.25 сут = 3.15576e7 с; совпадает с Units.YEAR_S этапа 3' },
  { id: 'ms', name: 'миллисекунда', dimension: dimension(0, 0, 1), factor: 1e-3 },
  { id: 'ka', name: 'тысяча юлианских лет', dimension: dimension(0, 0, 1), factor: 3.15576e10, note: 'килоаннум NUBASE2020: 1000 юлианских лет = 3.15576e10 с; периоды полураспада (Stage 4.3.3)' },
  { id: 'Ma', name: 'миллион юлианских лет', dimension: dimension(0, 0, 1), factor: 3.15576e13, note: 'мегааннум NUBASE2020: 1 000 000 юлианских лет = 3.15576e13 с; периоды полураспада (Stage 4.3.3)' },
  // --- температура: только кельвин ---
  { id: 'K', name: 'кельвин', dimension: dimension(0, 0, 0, 1), factor: 1 },
  // --- количество вещества ---
  { id: 'mol', name: 'моль', dimension: dimension(0, 0, 0, 0, 0, 1), factor: 1 },
  // --- сила тока ---
  { id: 'A', name: 'ампер', dimension: dimension(0, 0, 0, 0, 1), factor: 1 },
  // --- давление ---
  { id: 'Pa', name: 'паскаль', dimension: dimension(1, -1, -2), factor: 1 },
  { id: 'kPa', name: 'килопаскаль', dimension: dimension(1, -1, -2), factor: 1e3 },
  { id: 'MPa', name: 'мегапаскаль', dimension: dimension(1, -1, -2), factor: 1e6 },
  { id: 'bar', name: 'бар', dimension: dimension(1, -1, -2), factor: 1e5 },
  { id: 'atm', name: 'стандартная атмосфера', dimension: dimension(1, -1, -2), factor: 101325, note: '1 atm = 101325 Па (точно); совпадает с Units.ATM_TO_PA этапа 3' },
  // --- энергия ---
  { id: 'J', name: 'джоуль', dimension: dimension(1, 2, -2), factor: 1 },
  { id: 'kJ', name: 'килоджоуль', dimension: dimension(1, 2, -2), factor: 1e3 },
  { id: 'eV', name: 'электронвольт', dimension: dimension(1, 2, -2), factor: 1.602176634e-19, note: '1 eV = 1.602176634e-19 Дж (точно, ревизия SI 2019); первая энергия ионизации NIST (Stage 4.3.3)' },
  // --- мощность ---
  { id: 'W', name: 'ватт', dimension: dimension(1, 2, -3), factor: 1 },
  { id: 'kW', name: 'киловатт', dimension: dimension(1, 2, -3), factor: 1e3 },
  // --- плотность энергетического потока (НЕ мощность и НЕ энергия) ---
  { id: 'W_m2', name: 'ватт на квадратный метр', dimension: dimension(1, 0, -3), factor: 1 },
  // --- площадь, объём ---
  { id: 'm2', name: 'квадратный метр', dimension: dimension(0, 2), factor: 1 },
  { id: 'm3', name: 'кубический метр', dimension: dimension(0, 3), factor: 1 },
  // --- плотности (разные величины, не взаимозаменяемы) ---
  { id: 'kg_m3', name: 'килограмм на кубический метр', dimension: dimension(1, -3), factor: 1 },
  { id: 'mol_m3', name: 'моль на кубический метр', dimension: dimension(0, -3, 0, 0, 0, 1), factor: 1 },
  { id: 'kg_m2', name: 'килограмм на квадратный метр', dimension: dimension(1, -2), factor: 1 },
  { id: 'mol_m2', name: 'моль на квадратный метр', dimension: dimension(0, -2, 0, 0, 0, 1), factor: 1 },
  // --- удельные величины ---
  { id: 'J_kg', name: 'джоуль на килограмм', dimension: dimension(0, 2, -2), factor: 1 },
  { id: 'J_m3', name: 'джоуль на кубический метр', dimension: dimension(1, -1, -2), factor: 1 },
  { id: 'kg_mol', name: 'килограмм на моль', dimension: dimension(1, 0, 0, 0, 0, -1), factor: 1 },
  { id: 'g_mol', name: 'грамм на моль', dimension: dimension(1, 0, 0, 0, 0, -1), factor: 1e-3 },
  // --- термодинамические молярные величины (Stage 4.3) ---
  { id: 'J_mol', name: 'джоуль на моль', dimension: dimension(1, 2, -2, 0, 0, -1), factor: 1, note: 'молярная энергия (ΔfH°, ΔfG°)' },
  { id: 'kJ_mol', name: 'килоджоуль на моль', dimension: dimension(1, 2, -2, 0, 0, -1), factor: 1e3, note: 'молярная энергия (ΔfH°, ΔfG°)' },
  { id: 'J_mol_K', name: 'джоуль на моль-кельвин', dimension: dimension(1, 2, -2, -1, 0, -1), factor: 1, note: 'молярная теплоёмкость Cp° и молярная энтропия S°' },
  // --- механика ---
  { id: 'm_s', name: 'метр в секунду', dimension: dimension(0, 1, -1), factor: 1 },
  { id: 'm_s2', name: 'метр на секунду в квадрате', dimension: dimension(0, 1, -2), factor: 1 },
  { id: 'N', name: 'ньютон', dimension: dimension(1, 1, -2), factor: 1 },
  { id: 'g0', name: 'стандартное ускорение свободного падения', dimension: dimension(0, 1, -2), factor: 9.80665, note: 'нормированная единица g⊕ = 9.80665 м/с² (точно); для поверхностной гравитации в «g»' },
  // --- безразмерные и углы ---
  { id: '1', name: 'безразмерная единица', dimension: DIMENSIONLESS, factor: 1, note: 'доли, коэффициенты; безразмерная величина' },
  { id: 'rad', name: 'радиан', dimension: DIMENSIONLESS, factor: 1, note: 'плоский угол; безразмерная единица с угловой семантикой' },
  { id: 'deg', name: 'градус', dimension: DIMENSIONLESS, factor: Math.PI / 180, note: 'плоский угол: 1 deg = π/180 rad' }
];

const UNITS: ReadonlyMap<string, UnitDefinition> = new Map(
  UNIT_TABLE.map((u) => [u.id, u])
);

/** Все зарегистрированные единицы (для аудита и документации). */
export function listUnits(): readonly UnitDefinition[] {
  return UNIT_TABLE;
}

/** Определение единицы; null, если единица неизвестна. */
export function getUnitDefinition(id: string): UnitDefinition | null {
  return UNITS.get(id) ?? null;
}

/** Есть ли единица с таким идентификатором. */
export function isKnownUnit(id: string): boolean {
  return UNITS.has(id);
}

// ============================================
// 4. ВЕЛИЧИНА И ОПЕРАЦИИ
// ============================================

/**
 * Физическая величина: числовое значение в зарегистрированной единице.
 * Создаётся только через quantity() — с проверкой числа и единицы.
 */
export interface PhysicalQuantity {
  readonly value: number;
  readonly unit: string;
}

function assertFinite(value: number, operation: string): void {
  if (!Number.isFinite(value)) {
    throw new QuantityError({
      code: 'invalid_number',
      component: 'PhysicalQuantity',
      operation,
      message: `значение должно быть конечным числом, получено ${String(value)}`,
      actual: String(value)
    });
  }
}

function requireUnit(id: string, operation: string): UnitDefinition {
  const def = UNITS.get(id);
  if (!def) {
    throw new QuantityError({
      code: 'unknown_unit',
      component: 'PhysicalQuantity',
      operation,
      message: `единица «${id}» не зарегистрирована`,
      actual: id
    });
  }
  return def;
}

/** Создать величину. NaN и ±Infinity запрещены; знак не ограничен. */
export function quantity(value: number, unit: string): PhysicalQuantity {
  assertFinite(value, 'quantity');
  requireUnit(unit, 'quantity');
  return { value, unit };
}

/** Безопасное создание: null при некорректном числе или единице. */
export function tryQuantity(value: number, unit: string): PhysicalQuantity | null {
  if (!Number.isFinite(value) || !UNITS.has(unit)) return null;
  return { value, unit };
}

/** Размерность величины. */
export function dimensionOf(q: PhysicalQuantity): Dimension {
  return requireUnit(q.unit, 'dimensionOf').dimension;
}

function requireSameDimension(a: PhysicalQuantity, b: PhysicalQuantity, operation: string): void {
  const da = requireUnit(a.unit, operation).dimension;
  const db = requireUnit(b.unit, operation).dimension;
  if (!sameDimension(da, db)) {
    throw new QuantityError({
      code: 'incompatible_dimension',
      component: 'PhysicalQuantity',
      operation,
      message: `операция «${operation}» между величинами разных размерностей запрещена`,
      expected: dimensionToString(da),
      actual: dimensionToString(db)
    });
  }
}

/**
 * Явное преобразование в другую единицу ТОЙ ЖЕ размерности.
 * Внутреннее представление не меняется: возвращается новая величина.
 */
export function convert(q: PhysicalQuantity, targetUnit: string): PhysicalQuantity {
  const op = 'convert';
  const from = requireUnit(q.unit, op);
  const to = requireUnit(targetUnit, op);
  if (!sameDimension(from.dimension, to.dimension)) {
    throw new QuantityError({
      code: 'incompatible_dimension',
      component: 'PhysicalQuantity',
      operation: op,
      message: `преобразование «${q.unit}» → «${targetUnit}» невозможно: разные размерности`,
      expected: dimensionToString(to.dimension),
      actual: dimensionToString(from.dimension)
    });
  }
  const si = q.value * from.factor;
  const result = si / to.factor;
  assertFinite(result, op);
  return { value: result, unit: targetUnit };
}

/** Значение величины в когерентной единице SI её размерности. */
export function toSI(q: PhysicalQuantity): number {
  const def = requireUnit(q.unit, 'toSI');
  const si = q.value * def.factor;
  assertFinite(si, 'toSI');
  return si;
}

/** Сложение; результат в единице первого слагаемого. */
export function add(a: PhysicalQuantity, b: PhysicalQuantity): PhysicalQuantity {
  const op = 'add';
  requireSameDimension(a, b, op);
  const sum = a.value + convert(b, a.unit).value;
  assertFinite(sum, op);
  return { value: sum, unit: a.unit };
}

/** Вычитание; результат в единице уменьшаемого. */
export function sub(a: PhysicalQuantity, b: PhysicalQuantity): PhysicalQuantity {
  const op = 'sub';
  requireSameDimension(a, b, op);
  const diff = a.value - convert(b, a.unit).value;
  assertFinite(diff, op);
  return { value: diff, unit: a.unit };
}

/**
 * Умножение на безразмерный коэффициент (масштабирование).
 * Умножение величины на величину в Stage 4.1 не вводится:
 * для него требуется размерностный вывод результата, который
 * появится вместе с конкретными физическими модулями.
 */
export function scale(q: PhysicalQuantity, k: number): PhysicalQuantity {
  const op = 'scale';
  assertFinite(k, op);
  const result = q.value * k;
  assertFinite(result, op);
  return { value: result, unit: q.unit };
}

/** Сравнение моментов/значений одной размерности: -1, 0, 1. */
export function compare(a: PhysicalQuantity, b: PhysicalQuantity): -1 | 0 | 1 {
  requireSameDimension(a, b, 'compare');
  const av = a.value;
  const bv = convert(b, a.unit).value;
  return av < bv ? -1 : av > bv ? 1 : 0;
}

/**
 * Приближённое равенство в единицах первой величины.
 * Допуск абсолютный; для сравнения с относительным допуском
 * вызывающий код вычисляет его сам (контекст задачи решает,
 * что считать пренебрежимым).
 */
export function approxEqual(a: PhysicalQuantity, b: PhysicalQuantity, absTolerance: number): boolean {
  requireSameDimension(a, b, 'approxEqual');
  assertFinite(absTolerance, 'approxEqual');
  return Math.abs(a.value - convert(b, a.unit).value) <= absTolerance;
}

/**
 * Проверка ожидаемой размерности (для валидации входных данных
 * конкретных модулей). Бросает QuantityError при несовпадении.
 */
export function assertDimension(q: PhysicalQuantity, expected: Dimension, operation: string, component: string): void {
  const actual = requireUnit(q.unit, operation).dimension;
  if (!sameDimension(actual, expected)) {
    throw new QuantityError({
      code: 'incompatible_dimension',
      component,
      operation,
      message: `величина в единице «${q.unit}» имеет несовместимую размерность`,
      expected: dimensionToString(expected),
      actual: dimensionToString(actual)
    });
  }
}

/** Значение равно нулю (сравнение без допуска). */
export function isZero(q: PhysicalQuantity): boolean {
  return q.value === 0;
}

/** Значение отрицательно (для потоков и координат это физически осмысленно). */
export function isNegative(q: PhysicalQuantity): boolean {
  return q.value < 0;
}
