// ============================================
// DOUBLE-DOUBLE АРИФМЕТИКА — ВНУТРЕННИЙ МОДУЛЬ CORE
// ============================================
//
// Stage 4.4.4.2.2 (closeout): арифметика double-double (~106 бит),
// выделенная из Core/pengRobinson.ts в отдельный ВНУТРЕННИЙ модуль
// Core. Модуль НЕ входит в публичный контракт слоя: Core/index.ts его
// НЕ реэкспортирует. Потребители: Core/pengRobinson.ts (классификация
// знака дискриминанта кубического уравнения PR) и ИЗОЛИРОВАННЫЕ тесты
// деления в Tests/pengRobinson.test.ts с НЕЗАВИСИМЫМ dyadic-BigInt
// оракулом (сама DD-реализация оракулом для своих тестов НЕ служит).
//
// Деление ddDiv (closeout 4.4.4.2.2): прежняя версия учитывала в
// остатке ТОЛЬКО старшую часть знаменателя (ddTwoProd(q1, b.hi),
// остаток в double) и теряла слагаемое q1*b.lo — для DD-знаменателя
// с ненулевой младшей частью ошибка частного деградировала до
// ~double-точности (критично в ветке кратного корня кубики PR, где
// делят на 2p и p с ненулевой DD-младшей частью). Полный алгоритм:
// остатки r1 = a - q1*b и r2 = r1 - q2*b вычисляются DD-умножением и
// DD-вычитанием ОБЕИХ частей b, затем уточняющие шаги частного
// q1 -> q2 -> q3 и компоновка quick-two-sum; ни одна часть
// знаменателя не отбрасывается.

/**
 * Число double-double: hi — старшая часть, lo — младшая; объединённая
 * мантисса даёт ~106 бит. Используется для классификации знака
 * дискриминанта кубического уравнения PR (Stage 4.4.4.2.2): вблизи
 * кратных корней знак не разрешим в double-точности, а ложный второй
 * действительный корень создаёт фиктивную liquid-ветвь (Z > B).
 */
export type DoubleDouble = { readonly hi: number; readonly lo: number };

/** Константа разбиения Деккера (2^27 + 1) для точного произведения. */
export const DD_SPLITTER = 134217729;

/**
 * Точное сложение (two_sum Кнута): [s, e], где s + e == a + b без
 * потери информации (s — округлённая сумма, e — точная ошибка).
 */
export function ddTwoSum(a: number, b: number): readonly [number, number] {
  const s = a + b;
  const bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
}

/** Быстрый two_sum для |a| >= |b| (quick_two_sum). */
export function ddQuickTwoSum(a: number, b: number): readonly [number, number] {
  const s = a + b;
  return [s, b - (s - a)];
}

/**
 * Точное произведение (two_prod Деккера): [p, e], где p + e == a * b
 * (разбиение мантисс константой DD_SPLITTER).
 */
export function ddTwoProd(a: number, b: number): readonly [number, number] {
  const p = a * b;
  const ah = DD_SPLITTER * a - (DD_SPLITTER * a - a);
  const bh = DD_SPLITTER * b - (DD_SPLITTER * b - b);
  return [p, (a - ah) * (b - bh) - ((p - ah * bh) - ah * (b - bh) - (a - ah) * bh)];
}

/** Точное представление binary64-числа в double-double (младшая часть 0). */
export function ddFromDouble(x: number): DoubleDouble {
  return { hi: x, lo: 0 };
}

/** Сложение double-double (two_sum + перенормировка). */
export function ddAdd(a: DoubleDouble, b: DoubleDouble): DoubleDouble {
  const [s, e1] = ddTwoSum(a.hi, b.hi);
  const [hi, lo] = ddQuickTwoSum(s, e1 + a.lo + b.lo);
  return { hi, lo };
}

/** Смена знака double-double (точная). */
export function ddNeg(a: DoubleDouble): DoubleDouble {
  return { hi: -a.hi, lo: -a.lo };
}

/** Вычитание double-double. */
export function ddSub(a: DoubleDouble, b: DoubleDouble): DoubleDouble {
  return ddAdd(a, ddNeg(b));
}

/** Умножение double-double (алгоритм QD-библиотеки), ~106 бит. */
export function ddMul(a: DoubleDouble, b: DoubleDouble): DoubleDouble {
  const [p, err] = ddTwoProd(a.hi, b.hi);
  const [hi, lo] = ddQuickTwoSum(p, a.hi * b.lo + a.lo * b.hi + err);
  return { hi, lo };
}

/**
 * Деление double-double (полный алгоритм QD-библиотеки), ~106 бит.
 *
 * Closeout Stage 4.4.4.2.2: прежняя версия учитывала в остатке только
 * старшую часть знаменателя (ddTwoProd(q1, b.hi), остаток в double) и
 * пропускала слагаемое q1*b.lo — для DD-знаменателя с ненулевой
 * младшей частью это НЕ полноценное DD-деление: ошибка частного
 * деградировала до ~double-точности. Полная версия вычисляет остаток
 * r1 = a - q1*b DD-умножением и DD-вычитанием ОБЕИХ частей b,
 * выполняет уточняющие шаги частного q2 (по невязке r1) и q3 (по
 * невязке r2 = r1 - q2*b) и компонует результат quick-two-sum.
 * Корректна для положительных и отрицательных чисел, разных масштабов
 * и знаменателей с ненулевой lo; невязка после q3 — уровня 2^-106.
 */
export function ddDiv(a: DoubleDouble, b: DoubleDouble): DoubleDouble {
  const q1 = a.hi / b.hi;
  const r1 = ddSub(a, ddMul(ddFromDouble(q1), b));
  const q2 = r1.hi / b.hi;
  const r2 = ddSub(r1, ddMul(ddFromDouble(q2), b));
  const q3 = r2.hi / b.hi;
  const [s, e] = ddQuickTwoSum(q1, q2);
  const [hi, lo] = ddQuickTwoSum(s, e + q3);
  return { hi, lo };
}

/** Модуль double-double. */
export function ddAbs(a: DoubleDouble): DoubleDouble {
  return a.hi < 0 || (a.hi === 0 && a.lo < 0) ? ddNeg(a) : a;
}

/** Знак double-double (+1 / -1 / 0); 0 — только точный ноль обеих частей. */
export function ddSign(a: DoubleDouble): number {
  return a.hi > 0 ? 1 : a.hi < 0 ? -1 : a.lo > 0 ? 1 : a.lo < 0 ? -1 : 0;
}

/** Округление double-double к ближайшему binary64. */
export function ddToDouble(a: DoubleDouble): number {
  return a.hi + a.lo;
}
