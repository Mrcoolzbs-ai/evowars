// ============================================================================
// Stage 4.4.4.4.1-A — НЕЗАВИСИМЫЙ ОРАКУЛ ЧИСЛЕННОГО АУДИТА
// PR → lnPhi → scalar TPD: строгие enclosure-границы
// ----------------------------------------------------------------------------
// Назначение: полностью независимая от production-цепочки реализация
// вычислений Peng–Robinson ( чистый компонент, смесь, ln(phi_i) ) и scalar TPD
// с КОНТРОЛИРУЕМОЙ погрешностью: каждая величина возвращается как enclosure
// [ center − r, center + r ], гарантированно содержащий точное значение.
//
// АРХИТЕКТУРА. Центр — double-double ( ~106 бит ) на битово точных
// two-sum / two-product ( Knuth / Dekker ) в IEEE binary64. Радиус каждой
// операции расширяется консервативной добавкой TS_WIDEN = 2^-100 от
// магнитуды результата ( покрывает остаток DD-операций ~ 2^-106 с запасом
// в 64 раза ) плюс перенос радиусов операндов. Минимальный радиус
// TS_MIN_R ( наименьший субнормальный double ) сохраняет ненулевую ширину
// у субнормальных enclosure и покрывает потери квантования при скейлинге
// на степени двойки.
//
// НЕЗАВИСИМОСТЬ. Модуль НЕ импортирует production PR/TPD runtime и их
// численные helpers. Используются только Math.abs/min/max, Math.pow с
// ТОЧНЫМИ степенями двойки и Math.sqrt ТОЛЬКО как seed ( итоговый радиус
// не зависит от точности seed ). Трансцендентных функций libm/V8
// ( log/acos/cbrt/exp ) нет: логарифм — собственный строгий ряд,
// sqrt — Newton-уточнение с консервативным радиусом.
//
// ГАРАНТИЯ ( направленное округление наружу ). Для каждой операции
// |fl(центр) − точное| покрывается радиусом: two-sum/two-product битово
// точны; DD-остатки ≤ ~2^-106·|результата| < TS_WIDEN; перенос
// неопределённости операндов входит в радиус явно. Формула границы
// production-значения oracleErrorBound покрывает и перевод DD-центра в
// binary64 ( eps = 2.3e-16 > 2^-52·(1+2^-53)-эффекты ).
//
// ГРАНИЦЫ. Оракул — инструмент Stage 4.4.4.4.1-A: он НЕ является
// валидацией PR как физической модели, НЕ пересматривает evidence-статусы
// каталога и НЕ используется за пределами численного аудита. Отказ
// ( throw ) вместо молчаливого выдающего ложную точность результата.
// ============================================================================

// ============================================
// 1. DOUBLE-DOUBLE БАЗИС ( битово точные примитивы )
// ============================================

/** Double-double: число как hi + lo, ~106 бит мантиссы. */
export interface Dd {
  hi: number;
  lo: number;
}

/** Константа Dekker-разбиения: 2^27 + 1. */
const TS_SPLIT = 134217729;

function ddFrom(x: number): Dd {
  return { hi: x, lo: 0 };
}

function ddValue(d: Dd): number {
  return d.hi + d.lo;
}

/** Модуль DD в double ( консервативно вверх для widen ). */
function ddMag(d: Dd): number {
  return Math.abs(d.hi) + Math.abs(d.lo);
}

/** Knuth two-sum: s = fl(a+b), e = точная невязка. */
function ddTwoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const bv = s - a;
  const av = s - bv;
  const br = b - bv;
  const ar = a - av;
  return [s, ar + br];
}

/** Quick two-sum ( |a| >= |b| ): точная невязка сложения. */
function ddQuickTwoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const e = b - (s - a);
  return [s, e];
}

/** Dekker two-product ( без FMA ): p = fl(a*b), e = точная невязка. */
function ddTwoProd(a: number, b: number): [number, number] {
  const p = a * b;
  const ca = TS_SPLIT * a;
  const ahi = ca - (ca - a);
  const alo = a - ahi;
  const cb = TS_SPLIT * b;
  const bhi = cb - (cb - b);
  const blo = b - bhi;
  const e = (ahi * bhi - p + ahi * blo + alo * bhi) + alo * blo;
  return [p, e];
}

function ddNeg(a: Dd): Dd {
  return { hi: -a.hi, lo: -a.lo };
}

/** DD-сложение: остаток покрывается widen (2^-100 > 2^-106). */
function ddAdd(a: Dd, b: Dd): Dd {
  const [s, e] = ddTwoSum(a.hi, b.hi);
  const err = e + a.lo + b.lo;
  const [hi, lo] = ddQuickTwoSum(s, err);
  return { hi, lo };
}

function ddSub(a: Dd, b: Dd): Dd {
  return ddAdd(a, ddNeg(b));
}

/** DD-умножение: остаток ~2^-106·|p| покрывается widen. */
function ddMul(a: Dd, b: Dd): Dd {
  const [p, e] = ddTwoProd(a.hi, b.hi);
  const err = e + a.hi * b.lo + a.lo * b.hi;
  const [hi, lo] = ddQuickTwoSum(p, err);
  return { hi, lo };
}

/** Умножение DD на точный double. */
function ddMulD(a: Dd, k: number): Dd {
  if (k === 0) {
    return { hi: 0, lo: 0 };
  }
  return ddMul(a, ddFrom(k));
}

/**
 * DD-деление ( полный QD-алгоритм ): остатки r1 = a − q1·b и
 * r2 = r1 − q2·b вычисляются DD-умножением и DD-вычитанием ОБЕИХ частей b,
 * затем шаги частного q1 → q2 → q3 и компоновка quick-two-sum.
 */
function ddDiv(a: Dd, b: Dd): Dd {
  if (b.hi === 0 && b.lo === 0) {
    throw new Error('oracle ddDiv: нулевой знаменатель');
  }
  const q1 = a.hi / b.hi;
  const r1 = ddSub(a, ddMul(ddFrom(q1), b));
  const q2 = r1.hi / b.hi;
  const r2 = ddSub(r1, ddMul(ddFrom(q2), b));
  const q3 = r2.hi / b.hi;
  const [s, e] = ddQuickTwoSum(q1, q2);
  const [hi, lo] = ddQuickTwoSum(s, e + q3);
  return { hi, lo };
}

// ============================================
// 2. BALL-АРИФМЕТИКА ( DD-центр + строгий радиус )
// ============================================

/** Enclosure: точное значение гарантированно в [c − r, c + r]. */
export interface Ball {
  /** Центр ( double-double ). */
  c: Dd;
  /** Строгий неотрицательный радиус. */
  r: number;
}

/**
 * Запас направленного округления на одну ball-операцию: 2^-100
 * ( над DD-остатками ~2^-106 — запас 64x ).
 */
const TS_WIDEN = Math.pow(2, -100);

/** Минимальный радиус: наименьший субнормальный double 2^-1074. */
const TS_MIN_R = 2.5e-324;

/** Консервативная добавка к радиусу по магнитуде центра. */
function ballWiden(c: Dd): number {
  return Math.max(ddMag(c) * TS_WIDEN, TS_MIN_R);
}

/** Enclosure с явным дополнительным радиусом ( например, от операндов ). */
function ball(c: Dd, extraR: number): Ball {
  return { c, r: extraR + ballWiden(c) };
}

const TS_ONE_BALL: Ball = { c: { hi: 1, lo: 0 }, r: TS_MIN_R };

/** Enclosure точного вещественного, заданного double ( double — ТОЧНЫЙ ). */
export function tsBall(x: number): Ball {
  return ball(ddFrom(x), 0);
}

function ballVal(b: Ball): number {
  return ddValue(b.c);
}

/** Строгий знак enclosure: 0 — знак не определён ( ноль внутри ). */
function ballSign(b: Ball): number {
  const v = ballVal(b);
  if (v > b.r) {
    return 1;
  }
  if (v < -b.r) {
    return -1;
  }
  return 0;
}

/** Верхняя граница |точного| для enclosure. */
function ballMag(b: Ball): number {
  return Math.abs(ballVal(b)) + b.r;
}

export function tsAddB(a: Ball, b: Ball): Ball {
  return ball(ddAdd(a.c, b.c), a.r + b.r);
}

export function tsSubB(a: Ball, b: Ball): Ball {
  return ball(ddSub(a.c, b.c), a.r + b.r);
}

export function tsNegB(a: Ball): Ball {
  return { c: ddNeg(a.c), r: a.r };
}

/**
 * Ball-умножение: |a·b − a0·b0| ≤ |a0|·rb + |b0|·ra + ra·rb
 * при |a − a0| ≤ ra, |b − b0| ≤ rb; DD-остаток покрывает widen.
 */
export function tsMulB(a: Ball, b: Ball): Ball {
  const c = ddMul(a.c, b.c);
  const av = Math.abs(ballVal(a));
  const bv = Math.abs(ballVal(b));
  return ball(c, av * b.r + bv * a.r + a.r * b.r);
}

/** Умножение enclosure на ТОЧНЫЙ double. */
export function tsMulDB(a: Ball, k: number): Ball {
  if (k === 0) {
    return { c: { hi: 0, lo: 0 }, r: 0 };
  }
  const c = ddMulD(a.c, k);
  return ball(c, Math.abs(k) * a.r);
}

/**
 * Ball-деление: при |b0| − rb > 0
 * |a/b − a0/b0| ≤ ra/(|b0| − rb) + |a0|·rb/(|b0| − rb)^2; DD-остаток
 * покрывает widen. Знаменатель, накрывающий ноль, — отказ.
 */
export function tsDivB(a: Ball, b: Ball): Ball {
  const b0 = ballVal(b);
  const denom = Math.abs(b0) - b.r;
  if (!(denom > 0)) {
    throw new Error('oracle tsDivB: знаменатель enclosure накрывает ноль');
  }
  const c = ddDiv(a.c, b.c);
  const av = Math.abs(ballVal(a));
  // Радиус в форме (av/denom)·(b.r/denom): отдельные произведения
  // av·b.r и denom·denom андерфлоуятся до 0 на субнормальных операндах
  // и дают 0/0 = NaN ( наблюдались при ln(w_i/z_i) с ~1e-320 долями ).
  // Деления выполняются в нормальном диапазоне; слагаемое при b.r = 0
  // берётся ровно 0 ( защита от Infinity·0 = NaN при переполнении
  // av/denom ). Относительная ошибка округления самой этой арифметики
  // ( ~1e-16 ) покрывается widen ( 2^-100 ) в ball().
  const term2 = b.r === 0 ? 0 : (av / denom) * (b.r / denom);
  return ball(c, a.r / denom + term2);
}

/**
 * Скейлинг enclosure на ТОЧНУЮ степень двойки: умножение double на 2^k —
 * сдвиг экспоненты, битово точный, кроме квантования субнормальных
 * результатов ( ≤ 2^-1075 ), которое покрывает ballWiden ≥ 2^-1074.
 * В отличие от ddMul не использует Dekker-сплит — безопасно для
 * субнормальных центров.
 */
function tsScaleB(x: Ball, pow2: number): Ball {
  if (pow2 === 1) {
    return x;
  }
  const c: Dd = { hi: x.c.hi * pow2, lo: x.c.lo * pow2 };
  return ball(c, x.r * pow2);
}

// ============================================
// 3. СТРОГИЙ ЛОГАРИФМ ( ряд atanh, без libm )
// ============================================

/** Количество членов ряда atanh ( |t| ≤ 1/3: остаток ~ 3^-(2N+3) ). */
const TS_LOG_TERMS = 44;

/** Лениво вычисленный строгий ln 2 ( ряд atanh в t = 1/3 ). */
let TS_LN2_CACHE: Ball | null = null;

function tsLn2Ball(): Ball {
  if (TS_LN2_CACHE !== null) {
    return TS_LN2_CACHE;
  }
  // ln 2 = 2·atanh(1/3) = 2·SUM (1/3)^(2n+1)/(2n+1).
  // ВАЖНО: t должен быть enclosure ИСТИННОГО 1/3, а не fl(1/3): последний
  // ниже 1/3 на 1.85e-17, что даёт в ln 2 смещение 2·|dt|/(1-t^2) = 4.16e-17.
  // Заметим: 1 - 3*(1/3) = 0 в double ( тайс-ту-ивен ), поэтому lo-часть
  // извлекается через точную ошибку произведения ddTwoProd(3, fl(1/3)) = -2^-54.
  const oneThirdHi = 1 / 3;
  const oneThirdErr = ddTwoProd(3, oneThirdHi)[1]; // = -2^-54
  const t = ball(
    { hi: oneThirdHi, lo: -oneThirdErr / 3 },
    1e-32 // покрывает fl-ошибку (2^-54/3) и накопление widen
  );
  const tMax = ballMag(t);
  const terms = TS_LOG_TERMS + 24; // 3^-137 << 2^-100: радиус ~ widen
  let sum = tsBall(0);
  let pow = t;
  for (let n = 0; n < terms; n += 1) {
    sum = tsAddB(sum, tsDivB(pow, tsBall(2 * n + 1)));
    pow = tsMulB(pow, tsMulB(t, t));
  }
  const rem = (2 * Math.pow(tMax * (1 + 1e-15), 2 * terms + 3)) /
    ((2 * terms + 3) * Math.max(1e-12, 1 - tMax * tMax));
  const ln2 = ball(ddMulD(sum.c, 2), sum.r * 2 + rem);
  TS_LN2_CACHE = ln2;
  return ln2;
}

/**
 * Строгий ln для положительного enclosure.
 * Редукция диапазона: x = m·2^k с m в [~0.5, ~2) ( скейлинг на степень
 * двойки точен; субнормальные центры сначала поднимаются множителем 2^512 ),
 * ln x = ln m + k·ln 2, ln m = 2·atanh(t), t = (m−1)/(m+1), |t| ≤ 1/3,
 * остаток ряда — явная верхняя граница.
 */
export function tsLog(x: Ball): Ball {
  const mag = ballMag(x);
  if (!(mag > 0)) {
    throw new Error('oracle tsLog: аргумент не положителен');
  }
  if (ballVal(x) - x.r <= 0) {
    throw new Error('oracle tsLog: enclosure аргумента накрывает ноль/отрицательные');
  }
  let k = 0;
  let m = x;
  // Субнормальный центр: поднять множителем 2^512 ( точный скейлинг ).
  if (Math.abs(ballVal(x)) < 1e-250) {
    m = tsScaleB(x, Math.pow(2, 512));
    k -= 512;
  }
  // Оценка степени двойки ( корректируется ниже до m в [0.5, 2) ).
  const mv = Math.abs(ballVal(m));
  let ke = Math.floor(Math.log2(Math.max(mv, 5e-324)));
  if (!Number.isFinite(ke)) {
    ke = 0;
  }
  m = tsScaleB(m, Math.pow(2, -ke));
  k += ke;
  let mval = Math.abs(ballVal(m));
  if (mval >= 2) {
    m = tsScaleB(m, 0.5);
    k += 1;
    mval = Math.abs(ballVal(m));
  } else if (mval < 0.5) {
    m = tsScaleB(m, 2);
    k -= 1;
    mval = Math.abs(ballVal(m));
  }
  // t = (m − 1)/(m + 1); |t| < 1 гарантирован ( m в [0.5, 2) ).
  const t = tsDivB(tsSubB(m, TS_ONE_BALL), tsAddB(m, TS_ONE_BALL));
  const tMax = ballMag(t);
  if (tMax >= 1) {
    throw new Error('oracle tsLog: |t| >= 1 после редукции');
  }
  let sum = tsBall(0);
  let pow = t;
  for (let n = 0; n < TS_LOG_TERMS; n += 1) {
    sum = tsAddB(sum, tsDivB(pow, tsBall(2 * n + 1)));
    pow = tsMulB(pow, tsMulB(t, t));
  }
  const rem = (2 * Math.pow(tMax * (1 + 1e-15), 2 * TS_LOG_TERMS + 3)) /
    ((2 * TS_LOG_TERMS + 3) * Math.max(1e-12, 1 - tMax * tMax));
  const lnM = ball(ddMulD(sum.c, 2), sum.r * 2 + rem);
  if (k === 0) {
    return lnM;
  }
  const ln2 = tsLn2Ball();
  return tsAddB(lnM, tsMulDB(ln2, k));
}

/**
 * Строгий sqrt: seed = Math.sqrt ( IEEE-корректное округление ), три
 * Newton-шага в DD ( остаток ~ 2^-106·y ), радиус
 * max( 2^-95·|y|, 8·rx/|y|, 1e-310 ) покрывает и остаток итераций
 * ( запас 2^11 ), и неопределённость входа ( производная 1/(2√x) —
 * запас 16x ), не завися от точности seed.
 */
export function tsSqrt(x: Ball): Ball {
  const x0 = ballVal(x);
  if (!(x0 > x.r)) {
    throw new Error('oracle tsSqrt: enclosure не строго положителен');
  }
  const seed = Math.sqrt(x0);
  if (!(seed > 0) || !Number.isFinite(seed)) {
    throw new Error('oracle tsSqrt: вырожденный seed');
  }
  let y = ddFrom(seed);
  for (let i = 0; i < 3; i += 1) {
    const q = ddDiv(x.c, y);
    const s = ddAdd(y, q);
    y = ddMulD(s, 0.5);
  }
  const yc = Math.abs(ddValue(y));
  if (!(yc > 0) || !Number.isFinite(yc)) {
    throw new Error('oracle tsSqrt: итерация выродилась');
  }
  const delta = Math.max(yc * Math.pow(2, -95), (x.r * 8) / yc, 1e-310);
  return ball(y, delta);
}

// ============================================
// 4. PR: ЧИСТЫЙ КОМПОНЕНТ ( параметры как enclosure )
// ============================================

/** Каталожные (Tc, Pc, omega) как ТОЧНЫЕ вещественные. */
export interface OraclePureParams {
  readonly criticalTemperatureK: number;
  readonly criticalPressurePa: number;
  readonly acentricFactor: number;
}

/** Константы классического PR ( Peng & Robinson 1976 ) — как в production. */
const PR_OMEGA_A = 0.45724;
const PR_OMEGA_B = 0.0778;
const PR_KAPPA_C1 = 0.37464;
const PR_KAPPA_C2 = 1.54226;
const PR_KAPPA_C3 = 0.26992;

/**
 * Чистокомпонентные величины PR в enclosure:
 * kappa(omega), alpha(T), a(T), b, A = aP/(R^2 T^2), B = bP/(RT).
 * Формулы — классический PR; отличие от production только в том,
 * что каждая операция здесь возвращает строгий enclosure.
 */
export function oraclePureParams(
  params: OraclePureParams,
  T: number,
  P: number,
  R: number
): { kappa: Ball; alpha: Ball; a: Ball; b: Ball; A: Ball; B: Ball } {
  const om = tsBall(params.acentricFactor);
  // kappa = C1 + C2·omega − C3·omega^2
  const kappa = tsSubB(
    tsAddB(tsBall(PR_KAPPA_C1), tsMulDB(om, PR_KAPPA_C2)),
    tsMulDB(tsMulB(om, om), PR_KAPPA_C3)
  );
  const Tc = tsBall(params.criticalTemperatureK);
  const Tb = tsBall(T);
  const Pb = tsBall(P);
  const Rb = tsBall(R);
  // alpha = ( 1 + kappa·( 1 − sqrt(T/Tc)) )^2
  const tr = tsDivB(Tb, Tc);
  const inner = tsAddB(TS_ONE_BALL, tsMulB(kappa, tsSubB(TS_ONE_BALL, tsSqrt(tr))));
  const alpha = tsMulB(inner, inner);
  // a = 0.45724·R^2·Tc^2/Pc·alpha; b = 0.07780·R·Tc/Pc
  const r2 = tsMulB(Rb, Rb);
  const tc2 = tsMulB(Tc, Tc);
  const aBase = tsDivB(tsMulDB(tsMulB(r2, tc2), PR_OMEGA_A), tsBall(params.criticalPressurePa));
  const a = tsMulB(aBase, alpha);
  const b = tsDivB(
    tsMulDB(tsMulB(Rb, Tc), PR_OMEGA_B),
    tsBall(params.criticalPressurePa)
  );
  const t2 = tsMulB(Tb, Tb);
  const A = tsDivB(tsMulB(a, Pb), tsMulB(r2, t2));
  const B = tsDivB(tsMulB(b, Pb), tsMulB(Rb, Tb));
  return { kappa, alpha, a, b, A, B };
}

// ============================================
// 5. КУБИКА PR: КОЭФФИЦИЕНТЫ И СТРОГИЙ ENCLOSURE КОРНЯ
// ============================================

/**
 * Коэффициенты кубики PR в форме z^3 + p·z^2 + q·z + s = 0:
 * p = B − 1, q = A − 3B^2 − 2B, s = B^2 + B^3 − A·B.
 */
function oracleCubicCoeffs(A: Ball, B: Ball): { p: Ball; q: Ball; s: Ball } {
  const p = tsSubB(B, TS_ONE_BALL);
  const b2 = tsMulB(B, B);
  const q = tsSubB(tsSubB(A, tsMulDB(b2, 3)), tsMulDB(B, 2));
  const s = tsSubB(tsAddB(b2, tsMulB(b2, B)), tsMulB(A, B));
  return { p, q, s };
}

/** Значение кубики ( Horner, все операции в balls ). */
function oracleCubicEval(coeffs: { p: Ball; q: Ball; s: Ball }, z: Ball): Ball {
  const h1 = tsAddB(z, coeffs.p);
  const h2 = tsAddB(tsMulB(h1, z), coeffs.q);
  const h3 = tsAddB(tsMulB(h2, z), coeffs.s);
  return h3;
}

/**
 * Строгий enclosure корня кубики PR около seed.
 *
 * Метод: сертифицированная скобка со сменой строгого знака ball-кубики,
 * затем двухфазная бисекция с ball-знаками ( фаза 1 — double-середины,
 * фаза 2 — DD-середины ) до ширины ~2^-100·|seed| либо до
 * неопределённого знака в середине ( enclosure середины накрывает корень ).
 * Начальная полуширина h0 = sep/4 при других корнях ( изоляция от них
 * доказана: они на расстоянии ≥ 4·h0 ), иначе локальная h0 вокруг seed.
 * Контроль: |центр − seed| ≤ 2·h0 стартовой изоляции, иначе отказ —
 * результат отошёл бы от выбранной production ветви.
 */
export function oracleEncloseRoot(
  A: Ball,
  B: Ball,
  seed: number,
  allSeeds: readonly number[]
): { root: Ball; bracketLo: number; bracketHi: number } {
  const coeffs = oracleCubicCoeffs(A, B);
  if (!Number.isFinite(seed)) {
    throw new Error('oracle encloseRoot: seed не конечен');
  }
  let sep = Infinity;
  for (const s of allSeeds) {
    const d = Math.abs(seed - s);
    if (d > 0 && d < sep) {
      sep = d;
    }
  }
  const h0 = Number.isFinite(sep)
    ? sep / 4
    : Math.max(Math.abs(seed) * Math.pow(2, -40), 1e-12);
  const fAt = (z: number) => oracleCubicEval(coeffs, tsBall(z));
  let h = h0;
  let lo = seed - h;
  let hi = seed + h;
  let slo = ballSign(fAt(lo));
  let shi = ballSign(fAt(hi));
  for (let iter = 0; iter < 80 && !(slo !== 0 && shi !== 0 && slo !== shi); iter += 1) {
    h *= 2;
    if (!Number.isFinite(h)) {
      throw new Error('oracle encloseRoot: скобка не найдена ( расширение )');
    }
    lo = seed - h;
    hi = seed + h;
    slo = ballSign(fAt(lo));
    shi = ballSign(fAt(hi));
  }
  if (!(slo !== 0 && shi !== 0 && slo !== shi)) {
    throw new Error('oracle encloseRoot: смена знака не сертифицирована');
  }
  // Бисекция, фаза 1 ( double ): середины (lo+hi)/2, пока они двигают
  // скобку. Предел разрешения double — ширина ~1 ulp; целевая толщина
  // tol ~2^-100·|seed| на этой фазе недостижима, tol здесь НЕ проверяется.
  let result: Ball | null = null;
  const tol = Math.max(Math.abs(seed), 1) * Math.pow(2, -100);
  for (let iter = 0; iter < 200; iter += 1) {
    const mid = (lo + hi) / 2;
    if (!(mid > lo && mid < hi)) {
      break; // ширина ~1 ulp: предел double, переход к DD-фазе
    }
    const fm = fAt(mid);
    const sm = ballSign(fm);
    if (sm === slo) {
      lo = mid;
    } else if (sm === shi) {
      hi = mid;
    } else {
      // Знак середины не определён: enclosure середины накрывает корень
      // ( типично near-merge либо грубые радиусы коэффициентов ).
      result = ball(ddFrom(mid), (hi - lo) / 2);
      break;
    }
  }
  // Бисекция, фаза 2 ( double-double ): точные DD-середины скобки
  // ( ddFrom(double) + ddAdd точны, ·0.5 — сдвиг экспоненты ), знак —
  // ball-кубика от ТОЧНОГО DD-аргумента ( r = 0 ). Скоба-certification
  // фазы 1 наследуется ( знак концов не менялся ). Выход — по ширине
  // ≤ tol ( радиус w/2 + widen ≈ 2^-100·|seed| ) либо по неопределённому
  // знаку середины ( радиус w/2 ). Восстанавливает разрешение ~2^-100,
  // недостижимое бисекцией чистых double ( застревает на half-ulp ).
  if (result === null) {
    let loD = ddFrom(lo);
    let hiD = ddFrom(hi);
    for (let iter = 0; iter < 400; iter += 1) {
      const w = ddMag(ddSub(hiD, loD));
      if (w <= tol) {
        result = ball(ddMulD(ddAdd(loD, hiD), 0.5), w / 2);
        break;
      }
      const midD = ddMulD(ddAdd(loD, hiD), 0.5);
      const sm = ballSign(oracleCubicEval(coeffs, { c: midD, r: 0 }));
      if (sm === slo) {
        loD = midD;
      } else if (sm === shi) {
        hiD = midD;
      } else {
        result = ball(midD, w / 2);
        break;
      }
    }
    if (result === null) {
      const w = ddMag(ddSub(hiD, loD));
      result = ball(ddMulD(ddAdd(loD, hiD), 0.5), w / 2);
    }
    lo = ddValue(loD);
    hi = ddValue(hiD);
  }
  if (Math.abs(ballVal(result) - seed) > 2 * h0 + (hi - lo) / 2) {
    throw new Error('oracle encloseRoot: enclosure отошёл от seed ветви');
  }
  return { root: result, bracketLo: lo, bracketHi: hi };
}

// ============================================
// 6. PR: СМЕСЬ ( a_mix, b_mix, корень ветви, ln(phi_i) )
// ============================================

/** Компонент смеси для оракула ( параметры — ТОЧНЫЕ doubles ). */
export interface OracleComponent {
  readonly id: string;
  readonly moleFraction: number;
  readonly params: OraclePureParams;
}

/** Состояние смеси по оракулу: enclosure-ы A, B, корня и ln(phi_i). */
export interface OracleState {
  readonly A: Ball;
  readonly B: Ball;
  readonly root: Ball;
  readonly lnPhi: readonly Ball[];
}

/**
 * Независимое вычисление состояния PR-смеси: правила смешения PR
 * ( a_ij = (1−kij)·sqrt(a_i a_j) ), кубика, корень выбранной ветви
 * ( наибольший для vapor / наименьший для liquid среди физических ),
 * компонентные ln(phi_i) по классической формуле PR — всё в enclosure.
 * kij = null для чистого компонента. prodPhysicalRoots используются
 * ТОЛЬКО как seed/изоляция ветви ( enclosure строится бисекцией от
 * сертифицированной скобки, не наследуя точность seed ).
 */
export function oracleMixtureState(
  components: readonly OracleComponent[],
  kij: number | null,
  T: number,
  P: number,
  R: number,
  branch: 'vapor' | 'liquid',
  prodPhysicalRoots: readonly number[]
): OracleState {
  if (components.length === 0) {
    throw new Error('oracle mixture: пустой состав');
  }
  if (prodPhysicalRoots.length === 0) {
    throw new Error('oracle mixture: нет физических корней для seed');
  }
  const n = components.length;
  const pure = components.map((c) => oraclePureParams(c.params, T, P, R));
  const x = components.map((c) => tsBall(c.moleFraction));
  // a_ij, S_i, a_mix = SUM_i SUM_j x_i x_j a_ij, b_mix = SUM x_i b_i.
  const aij: Ball[][] = [];
  for (let i = 0; i < n; i += 1) {
    aij.push([]);
    for (let j = 0; j < n; j += 1) {
      if (i === j) {
        // a_ii = a_i безусловно, включая нулевые доли ( как в production ).
        aij[i].push(pure[i].a);
      } else if (
        components[i].moleFraction <= 0 ||
        components[j].moleFraction <= 0
      ) {
        // РЕПЛИКАЦИЯ фактической семантики production ( pengRobinsonMixture ):
        // пары i != j с нулевой долей хотя бы одного компонента получают
        // a_ij = 0, а НЕ (1−k_ij)·sqrt(a_i·a_j). Для a_mix это роли не
        // играет ( слагаемое x_i·x_j·a_ij = 0 ), но S_i = SUM_j x_j·a_ij
        // компонента с x_i = 0 обращается в 0, и его ln(phi_i) отличается
        // от «стандартного» PR-предела на O(1) ( измеренный разрыв
        // ~0.2477 при переходе x_n2: 0 -> 1e-320 в CO2-фикстуре ). Аудит
        // измеряет ошибку вычисления ОПРЕДЛЁННОЙ production-функции,
        // поэтому оракул обязан моделировать ту же функцию; разрыв
        // документируется в отчёте аудита. Для TPD это нейтрально:
        // вклады ненулевые только при w_i > 0.
        aij[i].push(tsBall(0));
      } else {
        const geo = tsSqrt(tsMulB(pure[i].a, pure[j].a));
        aij[i].push(tsMulB(tsSubB(TS_ONE_BALL, tsBall(kij ?? 0)), geo));
      }
    }
  }
  let aMix = tsBall(0);
  const sI: Ball[] = [];
  const bMixParts: Ball[] = [];
  for (let i = 0; i < n; i += 1) {
    let si = tsBall(0);
    for (let j = 0; j < n; j += 1) {
      const xjaij = tsMulB(x[j], aij[i][j]);
      aMix = tsAddB(aMix, tsMulB(x[i], xjaij));
      si = tsAddB(si, xjaij);
    }
    sI.push(si);
    bMixParts.push(tsMulB(x[i], pure[i].b));
  }
  let bMix = tsBall(0);
  for (const bp of bMixParts) {
    bMix = tsAddB(bMix, bp);
  }
  if (!(ballVal(aMix) - aMix.r > 0)) {
    throw new Error('oracle mixture: a_mix не строго положителен');
  }
  if (!(ballVal(bMix) - bMix.r > 0)) {
    throw new Error('oracle mixture: b_mix не строго положителен');
  }
  const Pb = tsBall(P);
  const Tb = tsBall(T);
  const Rb = tsBall(R);
  const A = tsDivB(
    tsMulB(aMix, Pb),
    tsMulB(tsMulB(Rb, Rb), tsMulB(Tb, Tb))
  );
  const B = tsDivB(tsMulB(bMix, Pb), tsMulB(Rb, Tb));
  const seed =
    branch === 'vapor'
      ? Math.max(...prodPhysicalRoots)
      : Math.min(...prodPhysicalRoots);
  const enc = oracleEncloseRoot(A, B, seed, prodPhysicalRoots);
  const root = enc.root;
  // ln(phi_i) = (b_i/b)(Z−1) − ln(Z−B)
  //              − A/(2√2·B)·( 2 S_i/a − b_i/b )·ln[(Z+(1+√2)B)/(Z+(1−√2)B)].
  const sqrt2 = tsSqrt(tsBall(2));
  const zMinusB = tsSubB(root, B);
  const lnZmB = tsLog(zMinusB);
  const coef = tsDivB(A, tsMulB(tsMulDB(sqrt2, 2), B));
  const num = tsAddB(root, tsMulB(tsAddB(TS_ONE_BALL, sqrt2), B));
  const den = tsAddB(root, tsMulB(tsSubB(TS_ONE_BALL, sqrt2), B));
  const lnBranch = tsLog(tsDivB(num, den));
  const lnPhi: Ball[] = [];
  for (let i = 0; i < n; i += 1) {
    const biOverB = tsDivB(pure[i].b, bMix);
    const term1 = tsMulB(biOverB, tsSubB(root, TS_ONE_BALL));
    const ratio = tsSubB(tsMulDB(tsDivB(sI[i], aMix), 2), biOverB);
    const attract = tsMulB(tsMulB(coef, ratio), lnBranch);
    lnPhi.push(tsSubB(tsSubB(term1, lnZmB), attract));
  }
  return { A, B, root, lnPhi };
}

// ============================================
// 7. СКАЛЯРНЫЙ TPD ( строгие вклады и сумма )
// ============================================

/** Строгий ln(w/z) для ТОЧНЫХ doubles w > 0, z > 0. */
export function oracleLnRatio(w: number, z: number): Ball {
  if (!(w > 0) || !(z > 0)) {
    throw new Error('oracle lnRatio: w и z должны быть строго положительны');
  }
  return tsLog(tsDivB(tsBall(w), tsBall(z)));
}

/**
 * Строгий вклад компонента: w·( ln(w/z) + lnPhiTrial − lnPhiFeed ).
 */
export function oracleTpdContribution(
  w: number,
  z: number,
  lnPhiTrial: Ball,
  lnPhiFeed: Ball
): Ball {
  if (!(w > 0)) {
    throw new Error('oracle tpdContribution: w должна быть строго положительна');
  }
  if (!(z > 0)) {
    throw new Error('oracle tpdContribution: z должна быть строго положительна ( support )');
  }
  const delta = tsSubB(lnPhiTrial, lnPhiFeed);
  return tsMulB(tsBall(w), tsAddB(oracleLnRatio(w, z), delta));
}

/** Компонент TPD-оракула ( канонический порядок задаётся снаружи ). */
export interface OracleTpdComponent {
  readonly id: string;
  readonly moleFraction: number;
  readonly lnPhi: Ball;
}

/**
 * Строгий scalar TPD(w; z) = SUM_{i: w_i > 0} w_i·[ ln(w_i/z_i)
 * + lnPhi_i(w) − lnPhi_i(z) ]. Суммирование в balls — радиусы
 * переносятся явно, компенсация не нужна ( строже production ).
 */
export function oracleTpdBall(
  feed: readonly OracleTpdComponent[],
  trial: readonly OracleTpdComponent[]
): Ball {
  let sum = tsBall(0);
  for (const tc of trial) {
    if (tc.moleFraction <= 0) {
      continue; // вклады только при w_i > 0
    }
    const fc = feed.find((f) => f.id === tc.id);
    if (fc === undefined) {
      throw new Error(`oracle tpdBall: компонент ${tc.id} отсутствует в feed`);
    }
    sum = tsAddB(sum, oracleTpdContribution(tc.moleFraction, fc.moleFraction, tc.lnPhi, fc.lnPhi));
  }
  return sum;
}

// ============================================
// 8. ГРАНИЦА ОШИБКИ PRODUCTION И ЦЕНТР ENCLOSURE
// ============================================

/**
 * Строгая верхняя граница |prod − exact| для любого exact ∈ [c − r, c + r]:
 * |prod − exact| ≤ ( |prod − c| + r )·(1+eps) + |c|·eps, где eps = 2.3e-16
 * покрывает перевод DD-центра в binary64 ( fl(c) = c·(1 ± 2^-53) и
 * эффекты 2^-52 ), плюс абсолютный пол 1e-300 от субнормальных потерь.
 */
export function oracleErrorBound(prod: number, oracle: Ball): number {
  const cv = ddValue(oracle.c);
  const d = Math.abs(prod - cv);
  const eps = 2.3e-16; // 2^-51 с запасом над 2^-52/2^-53 эффектами
  return d * (1 + eps) + Math.abs(cv) * eps + oracle.r * (1 + eps) + 1e-300;
}

/** Центр oracle-enclosure как число ( для отчётности ). */
export function oracleCenter(oracle: Ball): number {
  return ddValue(oracle.c);
}
