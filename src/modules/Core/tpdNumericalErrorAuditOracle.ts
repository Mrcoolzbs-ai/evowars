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
// операции строится НАПРАВЛЕННЫМ ОКРУГЛЕНИЕМ НАРУЖУ ( nextUp/nextDown по
// битовому представлению binary64 ): каждая операция над радиусами —
// сложение, умножение, деление, произведение членов — округляется вверх
// ( nextUp( fl(a op b) ) >= точного значения ), нижние границы
// положительных знаменателей — вниз ( nextDown ). Потеря округления
// НЕ компенсируется «запасом»: TS_WIDEN = 2^-100 покрывает только
// DD-остатки центров ( ~2^-106, запас 64x ), но НЕ заменяет outward
// rounding радиусов ( контрпример: tsAddB с r = 1e-15 и 9.86e-32 —
// fl-сумма радиусов ровно 1e-15, а точная сумма строго больше; только
// nextUp даёт гарантированный enclosure ). Минимальный радиус TS_MIN_R
// ( наименьший субнормальный double ) сохраняет ненулевую ширину у
// субнормальных enclosure и покрывает квантование центров при скейлинге
// на степени двойки ( <= 2^-1074 ). Неконечный радиус или
// промежуточная граница — fail-closed отказ ( oracle_inconclusive ),
// а не молчаливое продолжение.
//
// НЕЗАВИСИМОСТЬ. Модуль НЕ импортирует production PR/TPD runtime и их
// численные helpers. Используются только Math.abs/min/max, Math.pow с
// ТОЧНЫМИ степенями двойки, Math.sqrt ТОЛЬКО как seed ( итоговый радиус
// доказан через невязку y^2 − x и нижнюю границу производной, а не через
// предположение о точности seed ) и Math.log/exp НЕ используются вовсе:
// выбор степени двойки в редукции логарифма — точное извлечение
// binary64-экспоненты/мантиссы по битам ( включая субнормальные ),
// а не Math.log2. Трансцендентных функций libm/V8 нет: логарифм —
// собственный строгий ряд.
//
// НЕЗАВИСИМАЯ ТОПОЛОГИЯ КОРНЕЙ. Число действительных корней кубики
// классифицируется по СТРУКТУРЕ ( знаку m = p^2 − 3q — дискриминанта
// производной, знакам значений полинома над интервальными enclosure-ами
// критических точек ), каждый корень изолируется бисекцией с
// доказанной сменой знака ВНУТРИ монотонного участка ( единственность
// доказана монотонностью, а не только сменой знака ), порядок корней —
// дизъюнктностью конструкции. Знак депрессированного дискриминанта
// D = (q/2)^2 + (p/3)^3 вычисляется интервально и
// кросс-проверяется со структурной классификацией ( противоречие —
// fail-closed ); если enclosure D накрывает ноль, структурная
// классификация идёт СВОИМ путём, а не «догадкой по D». Production-корни
// используются ТОЛЬКО как seed-приближения для выбора ветви, НЕ как
// доказательство числа или порядка корней. Точный dyadic-BigInt-знак
// дискриминанта живёт в production-решателе ( Core/pengRobinson.ts,
// Stage 4.4.4.2.2 ); оракул его НЕ содержит и на него НЕ ссылается.
//
// ГАРАНТИЯ. Для каждой операции |fl(центр) − точное| покрывается
// радиусом: two-sum/two-product битово точны; DD-остатки <= ~2^-106|c|
// покрываются widen 2^-100; перенос неопределённости операндов входит в
// радиус явно с направленным округлением наружу. Формула границы
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

/** Модуль DD в double ( fl(hi)+fl(lo); вызывающий округляет вверх ). */
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
// 2. НАПРАВЛЕННОЕ ОКРУГЛЕНИЕ binary64 ( nextUp / nextDown )
// ============================================

/**
 * Битовый буфер для манипуляций с представлением IEEE-754 binary64.
 * Little-endian: u32[0] — младшие 32 бита, u32[1] — старшие.
 */
const TS_BITS = new ArrayBuffer(8);
const TS_BITS_F64 = new Float64Array(TS_BITS);
const TS_BITS_U32 = new Uint32Array(TS_BITS);

/**
 * Наименьшее binary64, строго большее x ( округление к +Infinity ).
 * Обрабатывает ±0 ( оба дают наименьший субнормальный 2^-1074 ),
 * субнормальные числа ( инкремент младшего бита мантиссы ),
 * ±Infinity ( фиксированы ) и NaN ( NaN ). Для x > 0 инкрементируется
 * 64-битный паттерн ( перенос из мантиссы в экспоненту и из MAX_VALUE
 * в +Infinity корректен ); для x < 0 паттерн уменьшается ( вычитание 1
 * с заёмом; -2^-1074 даёт -0 ).
 */
export function nextUp(x: number): number {
  if (Number.isNaN(x)) {
    return x;
  }
  if (x === 0) {
    return 2.5e-324; // 2^-1074: наименьший положительный субнормальный
  }
  if (x === Infinity) {
    return Infinity;
  }
  if (x === -Infinity) {
    return -1.7976931348623157e308;
  }
  TS_BITS_F64[0] = x;
  const lo = TS_BITS_U32[0];
  const hi = TS_BITS_U32[1];
  if (x > 0) {
    if (lo === 0xffffffff) {
      TS_BITS_U32[0] = 0;
      TS_BITS_U32[1] = (hi + 1) >>> 0;
    } else {
      TS_BITS_U32[0] = lo + 1;
    }
  } else {
    if (lo === 0) {
      TS_BITS_U32[0] = 0xffffffff;
      TS_BITS_U32[1] = (hi - 1) >>> 0;
    } else {
      TS_BITS_U32[0] = lo - 1;
    }
  }
  return TS_BITS_F64[0];
}

/** Наибольшее binary64, строго меньшее x ( nextDown(x) = −nextUp(−x) ). */
export function nextDown(x: number): number {
  return -nextUp(-x);
}

/** Fail-closed проверка конечности радиуса/границы. */
function dirFinite(x: number): number {
  if (Number.isNaN(x) || x === Infinity || x === -Infinity) {
    throw new Error('oracle: неконечный радиус/граница enclosure (fail-closed)');
  }
  return x;
}

/** Округлённая вверх сумма: nextUp(fl(a+b)) >= точной суммы. */
function addUp(a: number, b: number): number {
  return dirFinite(nextUp(a + b));
}

/** Округлённое вверх произведение ( вызывается для a,b >= 0 ). */
function mulUp(a: number, b: number): number {
  return dirFinite(nextUp(a * b));
}

/** Округленное вверх частное ( вызывается для a >= 0, b > 0 ). */
function divUp(a: number, b: number): number {
  return dirFinite(nextUp(a / b));
}

/** Округлённая вниз разность: nextDown(fl(a−b)) <= точной разности. */
function subDown(a: number, b: number): number {
  return dirFinite(nextDown(a - b));
}

/**
 * Округлённое вниз частное ( вызывается для числителей и знаменателей,
 * чей точный знак уже известен; a/b >= 0 в применениях ): 
 * nextDown(fl(a/b)) <= точного частного — нижняя граница.
 */
function divDown(a: number, b: number): number {
  return dirFinite(nextDown(a / b));
}

// ============================================
// 3. BALL-АРИФМЕТИКА ( DD-центр + радиус, округление НАРУЖУ )
// ============================================

/** Enclosure: точное значение гарантированно в [c − r, c + r]. */
export interface Ball {
  /** Центр ( double-double; hi + lo — ТОЧНОЕ вещественное ). */
  c: Dd;
  /** Строгий неотрицательный радиус ( binary64, округлённый наружу ). */
  r: number;
}

/**
 * Запас направленного округления DD-центра: 2^-100
 * ( над DD-остатками ~2^-106 — запас 64x ). Покрывает ТОЛЬКО остатки
 * DD-операций над центрами; округление арифметики РАДИУСОВ всегда
 * направленное ( nextUp/nextDown ), widen его НЕ заменяет.
 */
const TS_WIDEN = Math.pow(2, -100);

/** Минимальный радиус: наименьший субнормальный double 2^-1074. */
const TS_MIN_R = 2.5e-324;

/**
 * Консервативная добавка к радиусу по магнитуде центра, направленно
 * округлённая вверх: покрывает DD-остатки цепочки центров и
 * квантование субнормальных центров при скейлинге ( <= 2^-1074 ).
 */
function ballWidenUp(c: Dd): number {
  const mag = nextUp(ddMag(c)); // >= |hi + lo| ( точного центра )
  return Math.max(mulUp(mag, TS_WIDEN), TS_MIN_R);
}

/**
 * Enclosure с явным дополнительным радиусом ( от операндов ).
 * Радиус — nextUp-сумма: гарантированно >= точной суммы extraR и widen.
 * Неконечный или отрицательный радиус — fail-closed отказ.
 */
function ball(c: Dd, extraR: number): Ball {
  if (!(extraR >= 0) || Number.isNaN(extraR)) {
    throw new Error('oracle ball: неконечный/отрицательный входной радиус (fail-closed)');
  }
  const r = nextUp(addUp(extraR, ballWidenUp(c)));
  if (!Number.isFinite(r)) {
    throw new Error('oracle ball: неконечный радиус enclosure (fail-closed)');
  }
  return { c, r };
}

const TS_ONE_BALL: Ball = { c: { hi: 1, lo: 0 }, r: TS_MIN_R };

/** Enclosure точного вещественного, заданного double ( double — ТОЧНЫЙ ). */
export function tsBall(x: number): Ball {
  return ball(ddFrom(x), 0);
}

function ballVal(b: Ball): number {
  return ddValue(b.c);
}

/**
 * Строгий знак enclosure: 0 — знак не определён ( ноль внутри ).
 * Границы центра: точный центр hi+lo лежит в
 * [ nextDown(fl(hi+lo)), nextUp(fl(hi+lo)) ].
 */
export function ballSign(b: Ball): number {
  const v = ballVal(b);
  if (nextDown(v) > b.r) {
    return 1;
  }
  if (nextUp(v) < -b.r) {
    return -1;
  }
  return 0;
}

/**
 * Верхняя граница |точного значения| enclosure, округлённая вверх:
 * |центр| ( вверх ) + r ( вверх ).
 */
function ballMagUp(b: Ball): number {
  return addUp(nextUp(ddMag(b.c)), b.r);
}

/** Нижняя граница точного значения enclosure ( double, <= истинного ). */
export function ballLo(b: Ball): number {
  return subDown(nextDown(ballVal(b)), b.r);
}

/** Верхняя граница точного значения enclosure ( double, >= истинного ). */
export function ballHi(b: Ball): number {
  return addUp(nextUp(ballVal(b)), b.r);
}

export function tsAddB(a: Ball, b: Ball): Ball {
  return ball(ddAdd(a.c, b.c), addUp(a.r, b.r));
}

export function tsSubB(a: Ball, b: Ball): Ball {
  return ball(ddSub(a.c, b.c), addUp(a.r, b.r));
}

export function tsNegB(a: Ball): Ball {
  return { c: ddNeg(a.c), r: a.r };
}

/**
 * Ball-умножение. Точный перенос:
 * |a·b − a0·b0| = |a0·Δb + b0·Δa + Δa·Δb| <= |a0|·rb + |b0|·ra + ra·rb
 * при |Δa| <= ra, |Δb| <= rb ( разложение a = a0 + Δa точное );
 * |a0|, |b0| — вверх-округленные магнитуды центров; каждое произведение
 * и обе суммы — nextUp. DD-остаток центров покрывает widen.
 */
export function tsMulB(a: Ball, b: Ball): Ball {
  const c = ddMul(a.c, b.c);
  const av = nextUp(ddMag(a.c));
  const bv = nextUp(ddMag(b.c));
  const r1 = mulUp(av, b.r);
  const r2 = mulUp(bv, a.r);
  const r3 = mulUp(a.r, b.r);
  return ball(c, addUp(addUp(r1, r2), r3));
}

/** Умножение enclosure на ТОЧНЫЙ double. */
export function tsMulDB(a: Ball, k: number): Ball {
  if (k === 0) {
    return { c: { hi: 0, lo: 0 }, r: 0 };
  }
  const c = ddMulD(a.c, k);
  return ball(c, mulUp(Math.abs(k), a.r));
}

/**
 * Ball-деление. Знаменатель-enclosure [d_lo, d_hi] строится
 * направленным округлением вниз/вверх; нижняя граница |знаменателя|
 * denomLow = max(d_lo, −d_hi) обязана быть СТРОГО положительной
 * ( иначе знаменатель накрывает ноль — fail-closed отказ ).
 * Перенос: |a/b − a0/b0| <= ra/|b| + |a0|·rb/|b|², где все величины
 * заменены на консервативные границы ( |b| >= denomLow, |a0| <= av ),
 * каждое частное и сумма — nextUp. Слагаемое при b.r = 0 — ровно 0
 * ( защита от деления на субнормальных и Infinity·0 ).
 * DD-остаток центров покрывает widen.
 */
export function tsDivB(a: Ball, b: Ball): Ball {
  const cv = ballVal(b);
  const dLo = subDown(nextDown(cv), b.r);
  const dHi = addUp(nextUp(cv), b.r);
  const denomLow = Math.max(dLo, -dHi);
  if (!(denomLow > 0)) {
    throw new Error('oracle tsDivB: знаменатель enclosure накрывает ноль');
  }
  const c = ddDiv(a.c, b.c);
  const av = nextUp(ddMag(a.c));
  const term1 = divUp(a.r, denomLow);
  const term2 = b.r === 0 ? 0 : mulUp(divUp(av, denomLow), divUp(b.r, denomLow));
  return ball(c, addUp(term1, term2));
}

/**
 * Скейлинг enclosure на ТОЧНУЮ степень двойки. Центры: умножение double
 * на 2^k — сдвиг экспоненты, битово точный в нормальном диапазоне;
 * субнормальное квантование ( <= 2^-1074 на обе части ) покрывает
 * ballWidenUp >= TS_MIN_R. Радиус — nextUp(x.r·2^k): покрывает и
 * потерю округления, и субнормальное квантование радиуса.
 */
export function tsScaleB(x: Ball, pow2: number): Ball {
  if (pow2 === 1) {
    return x;
  }
  const c: Dd = { hi: x.c.hi * pow2, lo: x.c.lo * pow2 };
  return ball(c, nextUp(x.r * pow2));
}

// ============================================
// 4. СТРОГИЙ ЛОГАРИФМ ( битовая редукция, ряд atanh, без libm )
// ============================================

/** Количество членов ряда atanh ( |t| <= 1/3: остаток ~ 3^-(2N+3) ). */
const TS_LOG_TERMS = 44;

/** 2^512 — точный множитель подъёма субнормальных центров. */
const TS_POW2_512 = Math.pow(2, 512);

/**
 * floor(log2(x)) для строго положительного конечного x БЕЗ libm:
 * точное извлечение binary64-экспоненты по битам. Нормальные числа:
 * biased-экспонента минус 1023 ( 2^e <= x < 2^(e+1) ). Субнормальные:
 * точный подъём умножением на 2^512 ( битово точно, результат
 * нормальный ) и вычитание 512.
 */
function tsFloorLog2(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) {
    throw new Error('oracle tsFloorLog2: аргумент не строго положителен/конечен');
  }
  TS_BITS_F64[0] = x;
  const biased = (TS_BITS_U32[1] >>> 20) & 0x7ff;
  if (biased !== 0) {
    return biased - 1023;
  }
  const lifted = x * TS_POW2_512;
  if (!(lifted > 0) || !Number.isFinite(lifted)) {
    throw new Error('oracle tsFloorLog2: вырожденный субнормальный подъём');
  }
  TS_BITS_F64[0] = lifted;
  const liftedBiased = (TS_BITS_U32[1] >>> 20) & 0x7ff;
  if (liftedBiased === 0) {
    throw new Error('oracle tsFloorLog2: подъём не нормализовал аргумент');
  }
  return liftedBiased - 1023 - 512;
}

/**
 * Строгая верхняя граница остатка ряда atanh после `terms` членов:
 * rem = 2·t^(2N+3) / ((2N+3)·max(1e-12, 1 − t²)) при t = |t|max·(1+1e-15),
 * все степени и частное — nextUp, знаменатель — nextDown и проверен
 * на строгую положительность. При андерфлоу степеней t остаток
 * <= 2.2e10·t^91, что при любом t < 1 покрывается widen
 * ( >= |sum|·2^-100; в худшей точке отношение rem/widen <= 2^-928 ),
 * поэтому rem = 0 здесь консервативно безопасен.
 */
function tsSeriesRemainderUp(tMax: number, terms: number): number {
  const tUp = mulUp(tMax, addUp(1, 1e-15));
  if (tUp >= 1) {
    throw new Error('oracle series: |t| >= 1 — ряд не сходится (fail-closed)');
  }
  let num = mulUp(2, tUp);
  for (let i = 0; i < 2 * terms + 2; i += 1) {
    num = mulUp(num, tUp);
  }
  const t2Up = mulUp(tUp, tUp);
  const denBase = Math.max(1e-12, subDown(1, t2Up));
  const denLow = nextDown((2 * terms + 3) * denBase);
  if (!(denLow > 0)) {
    throw new Error('oracle series: знаменатель остатка неположителен (fail-closed)');
  }
  return divUp(num, denLow);
}

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
  const tMax = ballMagUp(t);
  const terms = TS_LOG_TERMS + 24; // 3^-137 << 2^-100: радиус ~ widen
  let sum = tsBall(0);
  let pow = t;
  for (let n = 0; n < terms; n += 1) {
    sum = tsAddB(sum, tsDivB(pow, tsBall(2 * n + 1)));
    pow = tsMulB(pow, tsMulB(t, t));
  }
  const rem = tsSeriesRemainderUp(tMax, terms);
  const ln2 = ball(ddMulD(sum.c, 2), addUp(mulUp(2, sum.r), rem));
  TS_LN2_CACHE = ln2;
  return ln2;
}

/**
 * Строгий ln для положительного enclosure.
 * Редукция диапазона: x = m·2^k с m в [~0.5, ~2) ( скейлинг на степень
 * двойки точен; субнормальные центры сначала поднимаются множителем 2^512;
 * степень двойки выбирается ТОЧНЫМ битовым извлечением экспоненты,
 * без Math.log2 ), ln x = ln m + k·ln 2, ln m = 2·atanh(t),
 * t = (m−1)/(m+1), |t| <= ~1/3, остаток ряда — явная верхняя граница с
 * направленным округлением. Смягчённые границы m ( ±1 ulp центра )
 * покрыты тем, что t-enclosure строится ball-операциями, а остаток
 * считается от tMax = ballMagUp(t) >= |истинного t|.
 */
export function tsLog(x: Ball): Ball {
  const cv = ballVal(x);
  if (!(nextDown(cv) > x.r)) {
    throw new Error('oracle tsLog: enclosure аргумента накрывает ноль/отрицательные');
  }
  let k = 0;
  let m = x;
  // Субнормальный центр: поднять множителем 2^512 ( точный скейлинг ).
  if (Math.abs(cv) < 1e-250) {
    m = tsScaleB(x, TS_POW2_512);
    k = -512;
  }
  const mv = Math.abs(ballVal(m));
  if (!(mv > 0) || !Number.isFinite(mv)) {
    throw new Error('oracle tsLog: вырожденная редукция (fail-closed)');
  }
  // Точная степень двойки ( битовая, без libm ); mv > 0 гарантировано
  // строгой положительностью enclosure выше.
  const ke = tsFloorLog2(mv);
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
  // t = (m − 1)/(m + 1); |t| < 1 гарантирован ( m в [0.5, 2) с ±1 ulp ).
  const t = tsDivB(tsSubB(m, TS_ONE_BALL), tsAddB(m, TS_ONE_BALL));
  const tMax = ballMagUp(t);
  if (tMax >= 1) {
    throw new Error('oracle tsLog: |t| >= 1 после редукции');
  }
  let sum = tsBall(0);
  let pow = t;
  for (let n = 0; n < TS_LOG_TERMS; n += 1) {
    sum = tsAddB(sum, tsDivB(pow, tsBall(2 * n + 1)));
    pow = tsMulB(pow, tsMulB(t, t));
  }
  const rem = tsSeriesRemainderUp(tMax, TS_LOG_TERMS);
  const lnM = ball(ddMulD(sum.c, 2), addUp(mulUp(2, sum.r), rem));
  if (k === 0) {
    return lnM;
  }
  const ln2 = tsLn2Ball();
  return tsAddB(lnM, tsMulDB(ln2, k));
}

/**
 * Строгий sqrt. seed = Math.sqrt ( IEEE-корректное округление ),
 * три Newton-шага в DD ( y ≈ √(точного центра), остаток ~2^-106·y ).
 * ИТОГОВЫЙ РАДИУС — доказательный, без предположений о точности seed:
 * (1) невязка d = y² − center_true в DD покрывается
 *     resUp = |d| ( вверх ) + |y|²·2^-100 ( DD-остатки ddMul/ddSub );
 * (2) |√x_true − y| <= |x_true − center_true|/(√x_true + √center_true)
 *     + resUp/(y_true + √center_true), где все знаменатели заменены
 *     нижними границами ( nextDown-суммы частных от
 *     divDown(xLo, sqrtXHiUp) ), числители — верхними ( nextUp );
 *     строго-положительная нижняя граница входа xLo > 0 проверена
 *     ( иначе fail-closed ).
 */
export function tsSqrt(x: Ball): Ball {
  const cv = ballVal(x);
  if (!(nextDown(cv) > x.r)) {
    throw new Error('oracle tsSqrt: enclosure не строго положителен');
  }
  const seed = Math.sqrt(cv);
  if (!(seed > 0) || !Number.isFinite(seed)) {
    throw new Error('oracle tsSqrt: вырожденный seed');
  }
  let y = ddFrom(seed);
  for (let i = 0; i < 3; i += 1) {
    const q = ddDiv(x.c, y);
    const s = ddAdd(y, q);
    y = ddMulD(s, 0.5);
  }
  const yc = ddValue(y);
  if (!(yc > 0) || !Number.isFinite(yc)) {
    throw new Error('oracle tsSqrt: итерация выродилась');
  }
  // Границы входа и центра ( все направленные ):
  const cvLo = nextDown(cv);
  const cvHi = nextUp(cv);
  const xLo = subDown(cvLo, x.r);
  const xHi = addUp(cvHi, x.r);
  if (!(xLo > 0)) {
    throw new Error('oracle tsSqrt: нижняя граница входа неположительна (fail-closed)');
  }
  // Невязка y² − center_true и её верхняя граница:
  const d = ddSub(ddMul(y, y), x.c);
  const yMagUp = nextUp(ddMag(y));
  const resUp = addUp(nextUp(ddMag(d)), mulUp(mulUp(yMagUp, yMagUp), TS_WIDEN));
  // Верхние границы корней из верхних границ ( Math.sqrt корректно
  // округлён, nextUp покрывает половину ulp ):
  const sqrtXHiUp = nextUp(Math.sqrt(xHi));
  const sqrtCvHiUp = nextUp(Math.sqrt(cvHi));
  if (!(sqrtXHiUp > 0) || !(sqrtCvHiUp > 0)) {
    throw new Error('oracle tsSqrt: вырожденные границы производной (fail-closed)');
  }
  // Нижние границы √x_true, √center_true и y_true:
  const sqrtXLow = divDown(xLo, sqrtXHiUp);
  const sqrtCtLow = divDown(cvLo, sqrtCvHiUp);
  const yLow = nextDown(yc);
  if (!(sqrtXLow > 0) || !(sqrtCtLow > 0) || !(yLow > 0)) {
    throw new Error('oracle tsSqrt: нижняя граница производной неположительна (fail-closed)');
  }
  // Радиус: входная неопределённость + невязка, знаменатели — nextDown.
  const den1 = nextDown(sqrtXLow + sqrtCtLow);
  const den2 = nextDown(yLow + sqrtCtLow);
  if (!(den1 > 0) || !(den2 > 0)) {
    throw new Error('oracle tsSqrt: вырожденный знаменатель радиуса (fail-closed)');
  }
  const term1 = divUp(x.r, den1);
  const term2 = divUp(resUp, den2);
  return ball(y, addUp(term1, term2));
}

// ============================================
// 5. PR: ЧИСТЫЙ КОМПОНЕНТ ( параметры как enclosure )
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
 * что каждая операция здесь возвращает строгий enclosure
 * ( все радиусы — направленное округление наружу ).
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
// 6. КУБИКА PR: КОЭФФИЦИЕНТЫ И НЕЗАВИСИМАЯ ТОПОЛОГИЯ КОРНЕЙ
// ============================================

/** Коэффициенты кубики z^3 + p·z^2 + q·z + s = 0. */
export interface OracleCubicCoeffs {
  p: Ball;
  q: Ball;
  s: Ball;
}

/**
 * Коэффициенты кубики PR:
 * p = B − 1, q = A − 3B^2 − 2B, s = B^2 + B^3 − A·B.
 */
export function oracleCubicCoeffs(A: Ball, B: Ball): OracleCubicCoeffs {
  const p = tsSubB(B, TS_ONE_BALL);
  const b2 = tsMulB(B, B);
  const q = tsSubB(tsSubB(A, tsMulDB(b2, 3)), tsMulDB(B, 2));
  const s = tsSubB(tsAddB(b2, tsMulB(b2, B)), tsMulB(A, B));
  return { p, q, s };
}

/**
 * Значение кубики в точке/интервале ( Horner, все операции в balls ).
 * Для ball-аргумента z с радиусом rz результат — строгий enclosure
 * МНОЖЕСТВА { f(x) : x ∈ [z0 ± rz] }: перенос неопределённости
 * входа входит в радиусы ball-операций ( интервальная семантика ).
 */
export function oracleCubicEval(coeffs: OracleCubicCoeffs, z: Ball): Ball {
  const h1 = tsAddB(z, coeffs.p);
  const h2 = tsAddB(tsMulB(h1, z), coeffs.q);
  const h3 = tsAddB(tsMulB(h2, z), coeffs.s);
  return h3;
}

/** Граница Коши: все корни |z| <= R, R = 1 + max|коэф| ( вверх;
 *  |коэф| — по ПОЛНОМУ enclosure коэффициента, не только центру ). */
function cauchyRadius(coeffs: OracleCubicCoeffs): number {
  const m1 = ballMagUp(coeffs.p);
  const m2 = ballMagUp(coeffs.q);
  const m3 = ballMagUp(coeffs.s);
  return addUp(1, Math.max(m1, m2, m3));
}

/**
 * Двухфазная сертифицированная бисекция корня на скобке [lo0, hi0]
 * ( строгая смена знака ball-кубики на концах; единственность корня
 * внутри скобки доказана ВЫЗЫВАЮЩИМ — скобка целиком лежит в монотонном
 * участке ). Фаза 1 — double-середины, фаза 2 — точные DD-середины
 * ( ddFrom(double) + ddAdd точны, ·0.5 — сдвиг экспоненты ), знак —
 * ball-кубика от ТОЧНОГО DD-аргумента. Выход — по ширине <= 2^-100
 * масштаба скобки либо по неопределённому знаку середины ( enclosure
 * середины со радиусом w/2 — честный enclosure корня: корень всегда
 * остаётся внутри текущей скобки ). Радиус итога — w/2 вверх + widen.
 */
function bisectCertifiedRoot(coeffs: OracleCubicCoeffs, lo0: number, hi0: number): Ball {
  const fAt = (z: number) => oracleCubicEval(coeffs, tsBall(z));
  let lo = lo0;
  let hi = hi0;
  const slo = ballSign(fAt(lo));
  const shi = ballSign(fAt(hi));
  if (!(slo !== 0 && shi !== 0 && slo !== shi)) {
    throw new Error('oracle bisect: скобка не сертифицирована (внутренняя ошибка изоляции)');
  }
  const tol = Math.max(Math.abs(lo), Math.abs(hi), 1) * Math.pow(2, -100);
  let result: Ball | null = null;
  // Фаза 1 ( double ): середины (lo+hi)/2, пока они двигают скобку.
  for (let iter = 0; iter < 200; iter += 1) {
    const mid = (lo + hi) / 2;
    if (!(mid > lo && mid < hi)) {
      break; // ширина ~1 ulp: предел double, переход к DD-фазе
    }
    const sm = ballSign(fAt(mid));
    if (sm === slo) {
      lo = mid;
    } else if (sm === shi) {
      hi = mid;
    } else {
      // Знак середины не определён: enclosure середины накрывает корень
      // ( типично near-merge либо радиусы коэффициентов ); скобка
      // содержит корень, честный enclosure — mid ± w/2.
      result = ball(ddFrom(mid), mulUp(nextUp(hi - lo), 0.5));
      break;
    }
  }
  // Фаза 2 ( double-double ).
  if (result === null) {
    let loD = ddFrom(lo);
    let hiD = ddFrom(hi);
    for (let iter = 0; iter < 400; iter += 1) {
      const wUp = nextUp(ddMag(ddSub(hiD, loD)));
      if (wUp <= tol) {
        result = ball(ddMulD(ddAdd(loD, hiD), 0.5), mulUp(wUp, 0.5));
        break;
      }
      const midD = ddMulD(ddAdd(loD, hiD), 0.5);
      const sm = ballSign(oracleCubicEval(coeffs, { c: midD, r: 0 }));
      if (sm === slo) {
        loD = midD;
      } else if (sm === shi) {
        hiD = midD;
      } else {
        result = ball(midD, mulUp(wUp, 0.5));
        break;
      }
    }
    if (result === null) {
      const wUp = nextUp(ddMag(ddSub(hiD, loD)));
      result = ball(ddMulD(ddAdd(loD, hiD), 0.5), mulUp(wUp, 0.5));
    }
  }
  return result;
}

/**
 * Локальная нижняя граница со сертифицированным f(граница) < 0
 * ( расширение вниз от hi ): стартует от Cauchy-границы, при
 * недоказуемом знаке удваивает ( f(−∞) = −∞ для мономиальной ветви ).
 */
function certifyNegativeBelow(coeffs: OracleCubicCoeffs, hi: number): number {
  let R = Math.max(cauchyRadius(coeffs), Math.abs(hi));
  for (let i = 0; i < 60; i += 1) {
    const lo = -R;
    if (ballSign(oracleCubicEval(coeffs, tsBall(lo))) === -1) {
      return lo;
    }
    R = mulUp(R, 2);
  }
  throw new Error('oracle isolateRoots: нижняя граница не сертифицирована — inconclusive');
}

/** Симметричная верхняя граница со сертифицированным f(граница) > 0. */
function certifyPositiveAbove(coeffs: OracleCubicCoeffs, lo: number): number {
  let R = Math.max(cauchyRadius(coeffs), Math.abs(lo));
  for (let i = 0; i < 60; i += 1) {
    const hi = R;
    if (ballSign(oracleCubicEval(coeffs, tsBall(hi))) === 1) {
      return hi;
    }
    R = mulUp(R, 2);
  }
  throw new Error('oracle isolateRoots: верхняя граница не сертифицирована — inconclusive');
}

/**
 * Доказанная физичность корня ( Z > B ) по enclosure-ам корня и B:
 * строго ballLo(root) > ballHi(B) — физический; ballHi(root) < ballLo(B)
 * — нефизический; иначе ( интервалы пересекаются, Z ~ B ) —
 * inconclusive, а не догадка.
 */
function classifyRootPhysical(root: Ball, B: Ball): boolean {
  if (ballLo(root) > ballHi(B)) {
    return true;
  }
  if (ballHi(root) < ballLo(B)) {
    return false;
  }
  throw new Error('oracle isolateRoots: физичность корня (Z > B) недоказуема — inconclusive');
}

/** Результат независимой изоляции действительных корней кубики PR. */
export interface OracleRootTopology {
  /** Доказанное число действительных корней. */
  readonly realRootCount: 1 | 3;
  /** Enclosure-ы корней по возрастанию, попарно дизъюнктные; каждый
   *  ДОКАЗАННО содержит ровно один корень. */
  readonly roots: readonly Ball[];
  /** Доказанная маска Z > B ( против enclosure B ) для каждого корня. */
  readonly physicalMask: readonly boolean[];
  /** Enclosure депрессированного дискриминанта D = (q/2)^2 + (p/3)^3. */
  readonly discriminant: Ball;
  /** Доказанный интервальный знак D ( 0 — знак не определён ). */
  readonly discriminantSign: -1 | 0 | 1;
  /** Enclosure-ы критических точек f' ( пусто при строгой монотонности ). */
  readonly criticalEnclosures: readonly Ball[];
}

/**
 * Геометрическая серия доказательственных проб: x_k = edge + dir·span·2^−k,
 * k = 0, 1, ... — мономотонно сходится к edge. Возвращает первую пробу
 * с ДОКАЗАННЫМ ( ball-интервальным ) знаком target кубики, строго
 * лежащую по нужную сторону от bound ( dir < 0: x > bound; dir > 0:
 * x < bound ). null — доказанная проба не найдена: корень ближе к edge,
 * чем разрешение enclosure-арифметики ( честный inconclusive у
 * вызывающего, никаких догадок ).
 */
function probeProvenSign(
  coeffs: OracleCubicCoeffs,
  edge: number,
  dir: -1 | 1,
  target: -1 | 1,
  span: number,
  bound: number
): number | null {
  if (!(span > 0) || !Number.isFinite(span)) {
    throw new Error('oracle probeProvenSign: вырожденный span (внутренняя ошибка)');
  }
  for (let k = 0; k < 1100; k += 1) {
    const step = span * Math.pow(2, -k);
    const x = edge + dir * step;
    if (!Number.isFinite(x) || x === edge || step === 0) {
      return null;
    }
    if (dir < 0 ? !(x > bound) : !(x < bound)) {
      continue;
    }
    const s = ballSign(oracleCubicEval(coeffs, tsBall(x)));
    if (s === target) {
      return x;
    }
    // Доказанный противоположный знак либо недоказуемый: серия
    // продолжается — пробы сходятся к edge, где локализована смена знака.
  }
  return null;
}

/**
 * НЕЗАВИСИМАЯ изоляция всех действительных корней кубики PR
 * ( включая корни Z <= B ) по enclosure-ам A, B — без production-корней.
 *
 * Метод ( интервальный, fail-closed ):
 * 1) Депрессированный дискриминант D = (q/2)^2 + (p/3)^3 вычисляется в
 *    balls с наружным округлением всех операций; его интервальный знак
 *    доказывает ЧИСЛО различных действительных корней ( классическая
 *    теорема о кубике ): D < 0 — ровно ТРИ различных действительных
 *    корня, D > 0 — ровно ОДИН ( два комплексно-сопряжённых ).
 *    Enclosure D, накрывающий ноль, — oracle_inconclusive: классификация
 *    не «догадывается» по знакам экстремумов и не использует
 *    production-корни.
 * 2) D > 0: единственный действительный корень. Скобка
 *    [ certifyNegativeBelow, certifyPositiveAbove ] имеет доказанную
 *    смену знака, а ГЛОБАЛЬНАЯ единственность корня ( теорема п.1 )
 *    доказывает «ровно один корень в скобке» без предположений о
 *    монотонности внутри скобки.
 * 3) D < 0: ровно три корня. f' = 3z^2 + 2pz + q; m = p^2 − 3q > 0
 *    ( математически следует из D < 0; доказуемость m проверяется
 *    отдельно — m < 0 при D < 0 это несогласованность, m накрывает
 *    ноль — inconclusive ). Критические точки z1 = (−p − √m)/3 <
 *    z2 = (−p + √m)/3, их enclosure-ы обязаны быть дизъюнктны.
 *    f строго монотонна на (−∞, z1], [z1, z2], [z2, +∞); каждый
 *    монотонный участок содержит НЕ БОЛЕЕ одного корня, а корней три —
 *    значит ровно по одному, с принудительным чередованием
 *    r1 < z1 < r2 < z2 < r3. Изоляция каждого корня — скобка с
 *    ДОКАЗАННОЙ сменой знака внутри его монотонного участка:
 *    r1 — [ certified-lo, проба f>0 ], где проба — первая точка
 *    геометрической серии z1lo − (1+|z1lo|)·2^−k с доказанным знаком +
 *    ( probeProvenSign ); r3 — симметрично вверх от z2hi; r2 —
 *    [ проба f>0, проба f<0 ] внутри (z1hi, z2lo), пробы сходятся к
 *    z1hi и z2lo от краёв. Доказанные знаки на пробах дают положение
 *    пробы относительно корня ( f > 0 только на (r1, r2) левее z2,
 *    f < 0 только на (r2, r3) правее z1 ), поэтому каждая скобка
 *    содержит ровно свой корень. Ненайденная проба — честный
 *    inconclusive ( корень ближе к критической точке, чем разрешение
 *    enclosure-арифметики ).
 * 4) Порядок корней: скобки конструкции дизъюнктны ( скобка r1 левее
 *    z1lo, скобка r2 внутри (z1hi, z2lo), скобка r3 правее z2hi );
 *    дизъюнктность enclosure-ов проверяется явно ( fail-closed ).
 * 5) Физичность ( Z > B ) — строго по интервалам ( см.
 *    classifyRootPhysical ), недоказуемость — inconclusive.
 */
export function oracleIsolateRealRoots(A: Ball, B: Ball): OracleRootTopology {
  const coeffs = oracleCubicCoeffs(A, B);
  const three = tsBall(3);
  // --- Депрессированный дискриминант ( деления — на точные 3 и 27 ) ---
  const p2 = tsMulB(coeffs.p, coeffs.p);
  const p3 = tsMulB(p2, coeffs.p);
  const pDep = tsSubB(coeffs.q, tsDivB(p2, three));
  const qDep = tsAddB(
    tsSubB(tsDivB(tsMulDB(p3, 2), tsBall(27)), tsDivB(tsMulB(coeffs.p, coeffs.q), three)),
    coeffs.s
  );
  const halfQ = tsMulDB(qDep, 0.5);
  const thirdP = tsDivB(pDep, three);
  const thirdP2 = tsMulB(thirdP, thirdP);
  const thirdP3 = tsMulB(thirdP2, thirdP);
  const D = tsAddB(tsMulB(halfQ, halfQ), thirdP3);
  const dSign = ballSign(D);
  const discriminantSign: -1 | 0 | 1 = dSign > 0 ? 1 : dSign < 0 ? -1 : 0;
  if (discriminantSign === 0) {
    throw new Error(
      'oracle isolateRoots: знак дискриминанта не доказан (enclosure накрывает ноль) — inconclusive'
    );
  }
  // --- Структура производной: m = p^2 − 3q ( дискриминант f' / 4 ) ---
  const m = tsSubB(p2, tsMulDB(coeffs.q, 3));
  const mSign = ballSign(m);
  if (discriminantSign > 0) {
    // Ровно ОДИН действительный корень ( теорема, п.1 метода ).
    const lo = certifyNegativeBelow(coeffs, 0);
    const hi = certifyPositiveAbove(coeffs, 0);
    const root = bisectCertifiedRoot(coeffs, lo, hi);
    let criticalEnclosures: Ball[] = [];
    if (mSign > 0) {
      const sqrtM = tsSqrt(m);
      criticalEnclosures = [
        tsDivB(tsAddB(tsNegB(coeffs.p), tsNegB(sqrtM)), three),
        tsDivB(tsAddB(tsNegB(coeffs.p), sqrtM), three)
      ];
    }
    return {
      realRootCount: 1,
      roots: [root],
      physicalMask: [classifyRootPhysical(root, B)],
      discriminant: D,
      discriminantSign,
      criticalEnclosures
    };
  }
  // --- D < 0: ровно ТРИ различных действительных корня ---
  if (mSign < 0) {
    throw new Error(
      'oracle isolateRoots: доказанный D < 0 противоречит строгой монотонности (несогласованность)'
    );
  }
  if (mSign === 0) {
    throw new Error(
      'oracle isolateRoots: критические точки недоказуемы (m накрывает ноль) — inconclusive'
    );
  }
  const sqrtM = tsSqrt(m);
  const z1 = tsDivB(tsAddB(tsNegB(coeffs.p), tsNegB(sqrtM)), three);
  const z2 = tsDivB(tsAddB(tsNegB(coeffs.p), sqrtM), three);
  const z1lo = ballLo(z1);
  const z1hi = ballHi(z1);
  const z2lo = ballLo(z2);
  const z2hi = ballHi(z2);
  if (!(z1hi < z2lo)) {
    throw new Error(
      'oracle isolateRoots: критические точки не разделились интервально — inconclusive'
    );
  }
  // r1 < z1: certified-lo + первая доказанная проба f > 0 ниже z1lo.
  const lo1 = certifyNegativeBelow(coeffs, z1lo);
  const hi1 = probeProvenSign(coeffs, z1lo, -1, 1, 1 + Math.abs(z1lo), lo1);
  if (hi1 === null) {
    throw new Error(
      'oracle isolateRoots: смена знака левого монотонного участка недоказуема — inconclusive'
    );
  }
  const r1 = bisectCertifiedRoot(coeffs, lo1, hi1);
  // r3 > z2: certified-hi + первая доказанная проба f < 0 выше z2hi.
  const hi3 = certifyPositiveAbove(coeffs, z2hi);
  const lo3 = probeProvenSign(coeffs, z2hi, 1, -1, 1 + Math.abs(z2hi), hi3);
  if (lo3 === null) {
    throw new Error(
      'oracle isolateRoots: смена знака правого монотонного участка недоказуема — inconclusive'
    );
  }
  const r3 = bisectCertifiedRoot(coeffs, lo3, hi3);
  // r2 ∈ (z1, z2): пробы внутрь (z1hi, z2lo) с обоих краёв.
  const spanMid = z2lo - z1hi;
  const lo2 = probeProvenSign(coeffs, z1hi, 1, 1, spanMid, z2lo);
  const hi2 = probeProvenSign(coeffs, z2lo, -1, -1, spanMid, z1hi);
  if (lo2 === null || hi2 === null || !(lo2 < hi2)) {
    throw new Error(
      'oracle isolateRoots: смена знака среднего монотонного участка недоказуема — inconclusive'
    );
  }
  const r2 = bisectCertifiedRoot(coeffs, lo2, hi2);
  // Порядок: скобки конструкции дизъюнктны ( контроль, fail-closed ).
  if (!(ballHi(r1) < ballLo(r2) && ballHi(r2) < ballLo(r3))) {
    throw new Error(
      'oracle isolateRoots: enclosure-ы корней пересекаются (внутренняя ошибка)'
    );
  }
  const physicalMask = [
    classifyRootPhysical(r1, B),
    classifyRootPhysical(r2, B),
    classifyRootPhysical(r3, B)
  ];
  return {
    realRootCount: 3,
    roots: [r1, r2, r3],
    physicalMask,
    discriminant: D,
    discriminantSign,
    criticalEnclosures: [z1, z2]
  };
}

/** Результат oracleEncloseRoot ( seed — ТОЛЬКО выбор корня ). */
export interface OracleRootEnclosure {
  /** Enclosure корня, ближайшего к seed ( каждый — доказанно один корень ). */
  readonly root: Ball;
  /** Границы enclosure-а корня как double. */
  readonly bracketLo: number;
  readonly bracketHi: number;
  /** Индекс корня в возрастающей изоляции. */
  readonly index: number;
  /** Доказанное число действительных корней. */
  readonly totalRealRoots: 1 | 3;
}

/**
 * Enclosure корня кубики PR около seed. Все действительные корни
 * изолируются НЕЗАВИСИМО ( oracleIsolateRealRoots ), возвращается
 * enclosure, БЛИЖАЙШИЙ к seed; seed и allSeeds — ТОЛЬКО выбор,
 * НЕ доказательство ( единственность каждого корня доказана
 * изоляцией независимо от seed ).
 */
export function oracleEncloseRoot(
  A: Ball,
  B: Ball,
  seed: number,
  allSeeds: readonly number[]
): OracleRootEnclosure {
  if (!Number.isFinite(seed)) {
    throw new Error('oracle encloseRoot: seed не конечен');
  }
  for (const s of allSeeds) {
    if (!Number.isFinite(s)) {
      throw new Error('oracle encloseRoot: неконечный seed в allSeeds');
    }
  }
  const topo = oracleIsolateRealRoots(A, B);
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < topo.roots.length; i += 1) {
    const lo = ballLo(topo.roots[i]);
    const hi = ballHi(topo.roots[i]);
    const dist = seed < lo ? lo - seed : seed > hi ? seed - hi : 0;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || topo.roots[bestIdx] === undefined) {
    throw new Error('oracle encloseRoot: пустая изоляция (внутренняя ошибка)');
  }
  const root = topo.roots[bestIdx];
  return {
    root,
    bracketLo: ballLo(root),
    bracketHi: ballHi(root),
    index: bestIdx,
    totalRealRoots: topo.realRootCount
  };
}

// ============================================
// 7. PR: СМЕСЬ ( a_mix, b_mix, топология корней, ln(phi_i) )
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
  /** Доказанное число действительных корней кубики. */
  readonly realRootCount: 1 | 3;
  /** Доказанное число физических корней ( Z > B ). */
  readonly physicalRootCount: number;
  /** Enclosure депрессированного дискриминанта. */
  readonly discriminant: Ball;
  /** Доказанный интервальный знак дискриминанта ( 0 — не определён ). */
  readonly discriminantSign: -1 | 0 | 1;
  /** Индекс корня ветви в возрастающей изоляции. */
  readonly branchRootIndex: number;
}

/**
 * Независимое вычисление состояния PR-смеси: правила смешения PR
 * ( a_ij = (1−kij)·sqrt(a_i a_j) ), кубика, топология корней по
 * oracleIsolateRealRoots ( ветвь — последний/первый ДОКАЗАННЫЙ
 * физический корень по независимой классификации, НЕ по
 * production-корням ), компонентные ln(phi_i) по классической формуле
 * PR — всё в enclosure. kij = null для чистого компонента.
 * prodPhysicalRoots сохранены как seed-приближения ( выбор ветви
 * аудита совпадает с production: vapor — наибольший физический,
 * liquid — наименьший ); число и порядок корней доказываются
 * оракулом независимо от них.
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
    throw new Error('oracle mixture: нет production-корней для seed ветви');
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
  if (!(nextDown(ballVal(aMix)) > aMix.r)) {
    throw new Error('oracle mixture: a_mix не строго положителен');
  }
  if (!(nextDown(ballVal(bMix)) > bMix.r)) {
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
  // --- Независимая топология корней и выбор ветви ---
  const topo = oracleIsolateRealRoots(A, B);
  const physicalIdx: number[] = [];
  for (let i = 0; i < topo.roots.length; i += 1) {
    if (topo.physicalMask[i]) {
      physicalIdx.push(i);
    }
  }
  if (physicalIdx.length === 0) {
    throw new Error('oracle mixture: нет доказанных физических корней (Z > B)');
  }
  const branchIdx = branch === 'vapor' ? physicalIdx[physicalIdx.length - 1] : physicalIdx[0];
  const root = topo.roots[branchIdx];
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
  return {
    A,
    B,
    root,
    lnPhi,
    realRootCount: topo.realRootCount,
    physicalRootCount: physicalIdx.length,
    discriminant: topo.discriminant,
    discriminantSign: topo.discriminantSign,
    branchRootIndex: branchIdx
  };
}

// ============================================
// 8. СКАЛЯРНЫЙ TPD ( строгие вклады и сумма )
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
 * переносятся явно ( наружу ), компенсация не нужна ( строже production ).
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
// 9. ГРАНИЦА ОШИБКИ PRODUCTION И ЦЕНТР ENCLOSURE
// ============================================

/**
 * Строгая верхняя граница |prod − exact| для любого exact ∈ [c − r, c + r]:
 * |prod − exact| <= ( |prod − c| + r )·(1+eps) + |c|·eps, где eps = 2.3e-16
 * покрывает перевод DD-центра в binary64 ( fl(c) = c·(1 ± 2^-53) и
 * эффекты 2^-52 ), плюс абсолютный пол 1e-300 от субнормальных потерь.
 * Радиус r гарантированно направлен наружу ( см. ball-операции ).
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
