// ============================================================================
// Stage 4.4.4.4.1-C — СЕРТИФИЦИРОВАННЫЙ ПРОИЗВОДСТВЕННЫЙ ЛОГАРИФМ
// certifiedLn / certifiedLog1p: строгие enclosure-границы БЕЗ libm
// ----------------------------------------------------------------------------
// Назначение: production-реализация ln(x) и ln(1+x) с МАТЕМАТИЧЕСКИ
// ДОКАЗАННОЙ границей ошибки для каждого вызова:
//
//   lowerBound <= ln(точный аргумент) <= upperBound,
//   absoluteErrorBound >= max(value - lowerBound, upperBound - value).
//
// Происхождение алгоритма (Stage 4.4.4.4.1-C): ПЕРЕНОС вычислительного ядра
// независимого оракула численного аудита Stage 4.4.4.4.1-A
// ( Core/tpdNumericalErrorAuditOracle.ts, функция tsLog и её зависимости )
// в самостоятельный production-модуль. НОВЫЙ алгоритм НЕ разрабатывался:
// использованы перенесённые double-double примитивы (Knuth/Dekker two-sum /
// two-product, QD-деление), направленное округление наружу (nextUp/nextDown
// по битовому представлению binary64), ball-арифметика с наружу
// округлёнными радиусами, точное извлечение binary64-экспоненты по битам
// и ряд atanh ln(m) = 2·SUM t^(2n+1)/(2n+1), t = (m-1)/(m+1), |t| <= 1/3.
// Модуль НЕ импортирует tpdNumericalErrorAuditOracle.ts и не связан с
// audit-harness; оракул Stage A не изменялся.
//
// Отличия переноса от оракула (ЗАФИКСИРОВАНЫ ОТДЕЛЬНО, оракул не тронут):
//
// 1. ИСПРАВЛЕНИЕ ОСТАТКА РЯДА (математическая ошибка перенесённой версии).
//    Сумма ряда обрывается после N = CERTIFIED_LOG_SERIES_TERMS членов
//    (n = 0..N-1): последний включённый член имеет степень 2N-1, поэтому
//    ПЕРВЫЙ ОТБРОШЕННЫЙ член имеет степень 2N+1, и строгая верхняя
//    граница хвоста —
//        |R_N| <= 2·|t|^(2N+1) / ((2N+1)·(1 - t^2)).
//    В оракуле ( tsSeriesRemainderUp ) граница построена от члена степени
//    2N+3, т.е. пропускает член t^(2N+1)/(2N+1): для N = 44 пропущенный
//    вклад ~2·3^-89/89 ≈ 2.5e-45. Числово это замаскировано запасом
//    TS_WIDEN-радиусов (~|c|·2^-100 >= 1e-31 на членах ряда), поэтому
//    enclosure-ы Stage 4.4.4.4.1-A остаются корректными, но ДОКУМЕНТИРОВАННАЯ
//    граница хвоста не покрывала фактическое усечение. Здесь формула
//    исправлена: числитель — 2·tUp^(2N+1) (2N умножений на tUp после
//    начального 2·tUp), знаменатель — (2N+1)·(1 - tUp^2), округления
//    наружу (числитель вверх, знаменатель вниз), эмпирический запас
//    вместо остатка НЕ используется, N не уменьшается.
//
// 2. ТОЧНАЯ РЕДУКЦИЯ ВХОДА (расширение контракта, в оракуле не нужно).
//    Контракт certifiedLn — ВСЕ строго положительные конечные binary64,
//    включая субнормальные и Number.MIN_VALUE; контракт certifiedLog1p —
//    все конечные x > -1 (фактические диапазоны PR/TPD call sites —
//    см. сертификат ниже). Оракул строит ball ДО редукции, и его
//    positivity-проверка nextDown(центр) > радиус недостижима для
//    крошечных аргументов: радиус имеет абсолютный пол 2^-1074, поэтому
//    любой ball вокруг |x| < ~1e-323 накрывает ноль — оракул для таких
//    входов корректно fail-closed (его контракт этого и требовал).
//    Production-контракт требует большего, поэтому здесь редукция
//    выполняется ТОЧНО над самим входом ДО построения шаров:
//    - certifiedLn(x): x — точный binary64; разложение x = m·2^k,
//      m ∈ [1, 2), выполняется точно по битам (субнормальные — точным
//      подъёмом 2^512, битово точным умножением);
//    - certifiedLog1p(x): точная сумма 1+x = (s, e) по алгоритму twoSum
//      (Knuth; s+e = 1+x БЕЗУСЛОВНО точно для любых binary64 1 и x),
//      затем точная редукция DD-значения (s+e) = m·2^k, m ∈ [0.5, 2),
//      точными покомпонентными умножениями на степени двойки.
//    Все покомпонентные скейлинги в редукции БИТОВО ТОЧНЫ (обоснование
//    инвариантов — в certify-комментариях certifyReduceExactPositive);
//    positivity аргумента гарантируется проверкой входа (x > 0 для ln;
//    1+x > 0 при x > -1), а НЕ ball-знаком. Шары строятся только для
//    m ∈ [0.5, 2) (|t| <= 1/3), где радиусные полы не разрушают знака.
//
// 3. ДЕФЕКТ ПЕРЕНОСА certifiedPow2 (найден перенос-тестом; оракула НЕ
//    касается: оракул берёт степени двойки как обычные double-множители
//    tsScaleB(x, Math.pow(2, -ke)) и никогда не строит их по битам).
//    Субнормальная ветвь (n ∈ [-1074, -1023]) размещала единственный
//    мантиссный бит индексом i = n + 1074 ∈ [0, 51] выражением `1 << i`
//    В МЛАДШЕМ 32-битном слове: JS-битовые сдвиги берут счётчик по
//    модулю 32, поэтому для i >= 32 молча строилась степень
//    2^((i mod 32) − 1074) вместо 2^(i − 1074). Проявление:
//    certifiedPow2(-1023) возвращал 2^-1055 (множитель ошибочен в
//    2^32 раз), редукция certifiedLn(x) для x из верхней бинады
//    [2^1023, 2^1024) (включая Number.MAX_VALUE) давала m ~ 2^-32,
//    |t| ~ 1 — ряд не сходился, enclosure взрывался (радиус ~1e7,
//    значение смещено на ~7). Исправлено явным размещением бита по
//    словам (i < 32 — младшее слово, i >= 32 — старшее со сдвигом
//    i − 32); тесты ядра покрывают верхнюю бинаду и Number.MAX_VALUE
//    (Tests/certifiedLogarithm.test.ts; см. также §4 шапки
//    CERTIFIED_LOGARITHM_KERNEL.md).
//
// 4. TIGHT-ГРАНИЦЫ РЕЗУЛЬТАТА (улучшение перенос-качества, не дефект
//    оракула): double-эндпоинты enclosure оптимизированы до 1 ulp.
//    ballLo/ballHi вычисляют DD-сумму центра с (±r), компенсируют
//    DD-остаток δ-поправкой (2^-104·масштаб) и делают ровно ОДИН
//    направленный шаг за fl (лемма nextDown(fl(y)) <= y для любого
//    вещественного y, включая стыки бинад); зазоры результата —
//    точный twoSum. Типичный absoluteErrorBound — 1 ulp value
//    (было ~2 ulp при грубом двойном шаге).
//
// 5. ДЕФЕКТ ПЕРЕНОСА ballLo/ballHi (найден перенос-тестом; оракула НЕ
//    касается: его границы результата строятся иначе). DD-сумма центра
//    с (±r) в первой версии переноса ошибочно трактовалась как Ball
//    (обращение к полю .c у значения типа Dd) — каждый вызов
//    guaranteed-обёртки падал с TypeError и certifiedLn/certifiedLog1p
//    возвращали enclosure_failure на ЛЮБОМ входе. Исправлено:
//    ddAdd возвращает Dd,magnitude и значение берутся напрямую
//    (ddMag(lowerDD) / ddValue(lowerDD)); после исправления батарея
//    43 точек против независимого BigInt-эталона — 0 нарушений
//    containment, побитовое совпадение value с libm на сетке
//    ±5000 ulp вокруг PR-корня фикстуры (10001 точек, ln и log1p).
//
// certifiedLog1p НЕ имеет собственного ряда: ln(1+x) = ln(точной DD-суммы
// twoSum(1, x)) — тот же внутренний certify-путь lnBall, что и certifiedLn
// (задание Stage 4.4.4.4.1-C §4; второй логарифмический ряд не вводится).
// Критично: бинарное 1+x НЕ вычисляется (при |x| < eps слагаемое x теряется
// напрочь) — сумма всегда точная DD-пара.
//
// Локальная граница absoluteErrorBound — граница ошибки ТОЛЬКО этого
// логарифмического вызова в этой точке. Она НЕ является
// validatedErrorBound для PR/TPD-цепочки (статус континуума остаётся
// not_established; см. docs/science/TPD_CONTINUOUS_ERROR_BOUND.md и
// docs/science/TPD_NUMERICAL_ERROR_AUDIT.md).
//
// Платформенные трансцендентальные функции (Math.log / Math.log1p /
// Math.log2 / Math.atanh / Math.exp и т.п.) в модуле НЕ используются
// вовсе; степени двойки строятся битово (certifiedPow2), Math.sqrt —
// только как correctly-rounded seed там, где он нужен... (не нужен:
// ряд atanh не использует sqrt). Все операции — IEEE binary64
// correctly rounded (+, -, *, /) и битовые манипуляции.
// ============================================================================

// ============================================
// 1. ТИПЫ РЕЗУЛЬТАТА (production API)
// ============================================

/** Коды отказа certify-логарифма (fail-closed, без NaN в успехе). */
export type CertifiedLogErrorCode =
  | 'invalid_input' // не конечное binary64 (NaN / ±Infinity)
  | 'non_positive_argument' // certifiedLn: аргумент <= 0 (включая ±0)
  | 'at_or_below_minus_one' // certifiedLog1p: аргумент <= -1
  | 'enclosure_failure'; // внутренний fail-closed (неконечный радиус/граница)

/** Полный перечень кодов отказа (для аудита полноты enum). */
export const CERTIFIED_LOG_ERROR_CODES: readonly CertifiedLogErrorCode[] = [
  'invalid_input',
  'non_positive_argument',
  'at_or_below_minus_one',
  'enclosure_failure'
];

/**
 * Успех certify-логарифма: value — округлённое binary64 представление
 * DD-центра enclosure; lowerBound/upperBound — наружу округленные
 * границы strict enclosure (lowerBound <= ln(аргумент) <= upperBound);
 * absoluteErrorBound — наружу округленная вверх величина
 * max(value - lowerBound, upperBound - value).
 */
export interface CertifiedLogSuccess {
  readonly status: 'success';
  readonly value: number;
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly absoluteErrorBound: number;
}

/** Отказ: устойчивый код + диагностика (fail-closed). */
export interface CertifiedLogFailure {
  readonly status: 'failure';
  readonly code: CertifiedLogErrorCode;
  readonly message: string;
}

/** Discriminated union результата. */
export type CertifiedLogResult = CertifiedLogSuccess | CertifiedLogFailure;

/**
 * Количество членов ряда atanh основного сведения: N = 44 (задание
 * Stage 4.4.4.4.1-C §3.3; |t| <= 1/3 — первый отброшенный член степени
 * 2N+1 = 89). НЕ уменьшается ради производительности.
 */
export const CERTIFIED_LOG_SERIES_TERMS = 44;

// ============================================
// 2. DOUBLE-DOUBLE БАЗИС (перенос из oracle Stage A, битово точные примитивы)
// ============================================

/** Double-double: число как hi + lo, ~106 бит мантиссы. */
interface Dd {
  hi: number;
  lo: number;
}

/** Константа Dekker-разбиения: 2^27 + 1. */
const DD_SPLIT = 134217729;

function ddFrom(x: number): Dd {
  return { hi: x, lo: 0 };
}

function ddValue(d: Dd): number {
  return d.hi + d.lo;
}

/** Модуль DD в double (fl(hi)+fl(lo); вызывающий округляет вверх). */
function ddMag(d: Dd): number {
  return Math.abs(d.hi) + Math.abs(d.lo);
}

/** Knuth two-sum: s = fl(a+b), e — точная невязка (s + e = a + b точно). */
function ddTwoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const bv = s - a;
  const av = s - bv;
  const br = b - bv;
  const ar = a - av;
  return [s, ar + br];
}

/** Quick two-sum (|a| >= |b|): точная невязка сложения. */
function ddQuickTwoSum(a: number, b: number): [number, number] {
  const s = a + b;
  const e = b - (s - a);
  return [s, e];
}

/** Dekker two-product (без FMA): p = fl(a*b), e — точная невязка. */
function ddTwoProd(a: number, b: number): [number, number] {
  const p = a * b;
  const ca = DD_SPLIT * a;
  const ahi = ca - (ca - a);
  const alo = a - ahi;
  const cb = DD_SPLIT * b;
  const bhi = cb - (cb - b);
  const blo = b - bhi;
  const e = (ahi * bhi - p + ahi * blo + alo * bhi) + alo * blo;
  return [p, e];
}

function ddNeg(a: Dd): Dd {
  return { hi: -a.hi, lo: -a.lo };
}

/** DD-сложение: остаток (~2^-106) покрывается widen (2^-100, запас 64x). */
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
 * DD-деление (полный QD-алгоритм, перенос из oracle): остатки
 * r1 = a − q1·b и r2 = r1 − q2·b вычисляются DD-умножением и
 * DD-вычитанием ОБЕИХ частей b, затем шаги частного q1 → q2 → q3
 * и компоновка quick-two-sum.
 */
function ddDiv(a: Dd, b: Dd): Dd {
  if (b.hi === 0 && b.lo === 0) {
    throw new Error('certifiedLogarithm ddDiv: нулевой знаменатель (fail-closed)');
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
// 3. НАПРАВЛЕННОЕ ОКРУГЛЕНИЕ binary64 (перенос nextUp/nextDown)
// ============================================

/**
 * Битовый буфер для манипуляций с представлением IEEE-754 binary64.
 * Little-endian: u32[0] — младшие 32 бита, u32[1] — старшие.
 */
const DD_BITS = new ArrayBuffer(8);
const DD_BITS_F64 = new Float64Array(DD_BITS);
const DD_BITS_U32 = new Uint32Array(DD_BITS);

/**
 * Наименьшее binary64, строго большее x (округление к +Infinity).
 * Обрабатывает ±0 (оба дают наименьший субнормальный 2^-1074),
 * субнормальные (инкремент младшего бита мантиссы), ±Infinity
 * (фиксированы) и NaN. Для x > 0 инкрементируется 64-битный паттерн
 * (перенос из мантиссы в экспоненту и из MAX_VALUE в +Infinity
 * корректен); для x < 0 паттерн уменьшается (вычитание с заёмом;
 * -2^-1074 даёт -0).
 */
function nextUp(x: number): number {
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
  DD_BITS_F64[0] = x;
  const lo = DD_BITS_U32[0];
  const hi = DD_BITS_U32[1];
  if (x > 0) {
    if (lo === 0xffffffff) {
      DD_BITS_U32[0] = 0;
      DD_BITS_U32[1] = (hi + 1) >>> 0;
    } else {
      DD_BITS_U32[0] = lo + 1;
    }
  } else {
    if (lo === 0) {
      DD_BITS_U32[0] = 0xffffffff;
      DD_BITS_U32[1] = (hi - 1) >>> 0;
    } else {
      DD_BITS_U32[0] = lo - 1;
    }
  }
  return DD_BITS_F64[0];
}

/** Наибольшее binary64, строго меньшее x (nextDown(x) = -nextUp(-x)). */
function nextDown(x: number): number {
  return -nextUp(-x);
}

/** Fail-closed проверка конечности радиуса/границы. */
function dirFinite(x: number): number {
  if (Number.isNaN(x) || x === Infinity || x === -Infinity) {
    throw new Error('certifiedLogarithm: неконечный радиус/граница enclosure (fail-closed)');
  }
  return x;
}

/** Округлённая вверх сумма: nextUp(fl(a+b)) >= точной суммы. */
function addUp(a: number, b: number): number {
  return dirFinite(nextUp(a + b));
}

/** Округлённое вверх произведение (вызывается для a, b >= 0). */
function mulUp(a: number, b: number): number {
  return dirFinite(nextUp(a * b));
}

/** Округлённое вверх частное (вызывается для a >= 0, b > 0). */
function divUp(a: number, b: number): number {
  return dirFinite(nextUp(a / b));
}

/** Округлённая вниз разность: nextDown(fl(a-b)) <= точной разности. */
function subDown(a: number, b: number): number {
  return dirFinite(nextDown(a - b));
}

/**
 * Точная (в рамках binary64-сетки) нижняя граница enclosure: наибольшая
 * двойка, гарантированно <= точного значения f. Центр c = hi + lo —
 * ТОЧНОЕ вещественное (DD); f ∈ [c - r, c + r]. lowerDD = ddAdd(c, -r)
 * приближает c - r с DD-остатком δ <= 2^-104·(|c| + r) (покрывает
 * быстрое two-sum-округление ddAdd с запасом 4x; на субнормальном
 * масштабе ddAdd точен и δ-поправка равна 0). Вычитание δUp наружу
 * (up-округление) и ОДИН шаг nextDown за fl дают double, СТРОГО
 * <= c - r (лемма: nextDown(fl(y)) <= y для любого вещественного y,
 * включая стыки бинад), при этом в типичном случае (r << ulp)
 * граница отстоит от value ровно на 1 ulp — оптимум для double-границ.
 */
function ballLo(b: Ball): number {
  const lowerDD = ddAdd(b.c, ddFrom(-b.r));
  const deltaUp = mulUp(
    addUp(nextUp(ddMag(lowerDD)), b.r),
    certifiedPow2(-104)
  );
  return dirFinite(nextDown(ddValue(lowerDD) - deltaUp));
}

/**
 * Точная верхняя граница enclosure (зеркально ballLo): наименьшая
 * двойка, гарантированно >= f; δ-поправка покрывает DD-остаток
 * ddAdd(c, +r), один шаг nextUp за fl — типично value + 1 ulp.
 */
function ballHi(b: Ball): number {
  const upperDD = ddAdd(b.c, ddFrom(b.r));
  const deltaUp = mulUp(
    addUp(nextUp(ddMag(upperDD)), b.r),
    certifiedPow2(-104)
  );
  return dirFinite(nextUp(ddValue(upperDD) + deltaUp));
}

/**
 * ТОЧНАЯ степень двойки 2^n по битам, БЕЗ Math.pow и libm:
 * n ∈ [-1074, 1023]; для n >= -1022 — нормальное число с biased-полем
 * (n+1023); для n ∈ [-1074, -1023] — субнормальное с единственным
 * мантиссным битом i = n + 1074 ∈ [0, 51] (биты 0..31 — младшее слово,
 * биты 32..51 — старшее слово со сдвигом i − 32; JS-битовые сдвиги
 * берут счётчик по модулю 32, поэтому размещение по словам обязано
 * быть ЯВНЫМ — наивный `1 << i` в младшем слове молча строил бы
 * 2^(i mod 32 − 1074) вместо 2^(i − 1074); этот дефект был найден
 * перенос-тестом на верхней бинаде (n = -1023) и здесь устранён).
 * Вне диапазона — fail-closed (в редукции не возникает: множители
 * ограничены 2^±(1074+512) сверху построением).
 */
function certifiedPow2(n: number): number {
  if (!Number.isInteger(n) || n < -1074 || n > 1023) {
    throw new Error(`certifiedLogarithm certifiedPow2: n вне binary64-диапазона: ${String(n)}`);
  }
  if (n >= -1022) {
    DD_BITS_U32[0] = 0;
    DD_BITS_U32[1] = ((n + 1023) << 20) >>> 0;
  } else {
    const i = n + 1074; // индекс единственного мантиссного бита: 0..51
    if (i < 32) {
      DD_BITS_U32[0] = (1 << i) >>> 0;
      DD_BITS_U32[1] = 0;
    } else {
      DD_BITS_U32[0] = 0;
      DD_BITS_U32[1] = (1 << (i - 32)) >>> 0;
    }
  }
  return DD_BITS_F64[0];
}

// ============================================
// 4. BALL-АРИФМЕТИКА (DD-центр + радиус, округление НАРУЖУ; перенос)
// ============================================

/**
 * Enclosure: точное значение гарантированно в [c - r, c + r].
 * Инвариант радиусов: каждая операция над радиусами округлена наружу
 * (nextUp/nextDown); widen НЕ заменяет направленное округление.
 */
interface Ball {
  /** Центр (double-double; hi + lo — точное вещественное). */
  c: Dd;
  /** Строгий неотрицательный радиус (binary64, округлённый наружу). */
  r: number;
}

/**
 * Запас направленного округления DD-центра: 2^-100
 * (над DD-остатками ~2^-106 — запас 64x). Покрывает ТОЛЬКО остатки
 * DD-операций над центрами; округление арифметики РАДИУСОВ всегда
 * направленное, widen его НЕ заменяет.
 */
const BALL_WIDEN = certifiedPow2(-100);

/** Минимальный радиус: наименьший субнормальный double 2^-1074. */
const BALL_MIN_R = certifiedPow2(-1074);

/** Наименьшее положительное нормальное binary64 (2^-1022). */
const BINARY64_MIN_NORMAL = certifiedPow2(-1022);

/** Точный множитель подъёма субнормальных значений. */
const POW2_512 = certifiedPow2(512);

/**
 * Консервативная добавка к радиусу по магнитуде центра, направленно
 * округлённая вверх: покрывает DD-остатки цепочки центров и
 * квантование субнормальных центров (<= 2^-1074).
 */
function ballWidenUp(c: Dd): number {
  const mag = nextUp(ddMag(c)); // >= |hi + lo| (точного центра)
  return Math.max(mulUp(mag, BALL_WIDEN), BALL_MIN_R);
}

/**
 * Enclosure с явным дополнительным радиусом (от операндов).
 * Радиус — nextUp-сумма: гарантированно >= точной суммы extraR и widen.
 * Неконечный или отрицательный радиус — fail-closed отказ.
 */
function ball(c: Dd, extraR: number): Ball {
  if (!(extraR >= 0) || Number.isNaN(extraR)) {
    throw new Error('certifiedLogarithm ball: неконечный/отрицательный входной радиус (fail-closed)');
  }
  const r = nextUp(addUp(extraR, ballWidenUp(c)));
  if (!Number.isFinite(r)) {
    throw new Error('certifiedLogarithm ball: неконечный радиус enclosure (fail-closed)');
  }
  return { c, r };
}

const ONE_BALL: Ball = { c: { hi: 1, lo: 0 }, r: BALL_MIN_R };

/** Enclosure точного вещественного, заданного double (double — ТОЧНЫЙ). */
function ballOfDd(c: Dd): Ball {
  return ball(c, 0);
}

function ballVal(b: Ball): number {
  return ddValue(b.c);
}

/**
 * Верхняя граница |точного значения| enclosure, округлённая вверх:
 * |центр| (вверх) + r (вверх).
 */
function ballMagUp(b: Ball): number {
  return addUp(nextUp(ddMag(b.c)), b.r);
}

function addB(a: Ball, b: Ball): Ball {
  return ball(ddAdd(a.c, b.c), addUp(a.r, b.r));
}

function mulDB(a: Ball, k: number): Ball {
  if (k === 0) {
    return { c: { hi: 0, lo: 0 }, r: 0 };
  }
  const c = ddMulD(a.c, k);
  return ball(c, mulUp(Math.abs(k), a.r));
}

/**
 * Ball-умножение. Точный перенос:
 * |a·b − a0·b0| = |a0·Δb + b0·Δa + Δa·Δb| <= |a0|·rb + |b0|·ra + ra·rb
 * при |Δa| <= ra, |Δb| <= rb; |a0|, |b0| — вверх-округленные магнитуды
 * центров; каждое произведение и обе суммы — nextUp. DD-остаток
 * центров покрывает widen.
 */
function mulB(a: Ball, b: Ball): Ball {
  const c = ddMul(a.c, b.c);
  const av = nextUp(ddMag(a.c));
  const bv = nextUp(ddMag(b.c));
  const r1 = mulUp(av, b.r);
  const r2 = mulUp(bv, a.r);
  const r3 = mulUp(a.r, b.r);
  return ball(c, addUp(addUp(r1, r2), r3));
}

/**
 * Ball-деление. Знаменатель-enclosure [d_lo, d_hi] строится
 * направленным округлением; нижняя граница |знаменателя|
 * denomLow = max(d_lo, -d_hi) обязана быть СТРОГО положительной
 * (иначе fail-closed). Перенос:
 * |a/b − a0/b0| <= ra/|b| + |a0|·rb/|b|^2 (все величины — консервативные
 * границы, частные и суммы — nextUp; слагаемое при rb = 0 — ровно 0).
 */
function divB(a: Ball, b: Ball): Ball {
  const cv = ballVal(b);
  const dLo = subDown(nextDown(cv), b.r);
  const dHi = addUp(nextUp(cv), b.r);
  const denomLow = Math.max(dLo, -dHi);
  if (!(denomLow > 0)) {
    throw new Error('certifiedLogarithm divB: знаменатель enclosure накрывает ноль (fail-closed)');
  }
  const c = ddDiv(a.c, b.c);
  const av = nextUp(ddMag(a.c));
  const term1 = divUp(a.r, denomLow);
  const term2 = b.r === 0 ? 0 : mulUp(divUp(av, denomLow), divUp(b.r, denomLow));
  return ball(c, addUp(term1, term2));
}

// ============================================
// 5. ТОЧНАЯ БИНАРНАЯ ЭКСПОНЕНТА (перенос tsFloorLog2, без Math.log2)
// ============================================

/**
 * floor(log2(x)) для строго положительного КОНЕЧНОГО binary64 БЕЗ libm:
 * точное извлечение экспоненты по битам. Нормальные: biased-экспонента
 * минус 1023 (2^e <= x < 2^(e+1)). Субнормальные: точный подъём
 * умножением на 2^512 (битово точно, результат нормальный) и
 * вычитание 512.
 */
function floorLog2(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) {
    throw new Error('certifiedLogarithm floorLog2: аргумент не строго положителен/конечен');
  }
  DD_BITS_F64[0] = x;
  const biased = (DD_BITS_U32[1] >>> 20) & 0x7ff;
  if (biased !== 0) {
    return biased - 1023;
  }
  const lifted = x * POW2_512;
  if (!(lifted > 0) || !Number.isFinite(lifted)) {
    throw new Error('certifiedLogarithm floorLog2: вырожденный субнормальный подъём');
  }
  DD_BITS_F64[0] = lifted;
  const liftedBiased = (DD_BITS_U32[1] >>> 20) & 0x7ff;
  if (liftedBiased === 0) {
    throw new Error('certifiedLogarithm floorLog2: подъём не нормализовал аргумент');
  }
  return liftedBiased - 1023 - 512;
}

// ============================================
// 6. СТРОГИЙ ОСТАТОК РЯДА ATANH (исправленная формула первого
//    отброшенного члена степени 2N+1)
// ============================================

/**
 * Строгая верхняя граница остатка ряда atanh после `terms` членов
 * (N = terms; последний включённый член — степени 2N-1):
 *
 *   |R_N| = 2·|SUM_{n>=N} t^(2n+1)/(2n+1)|
 *         <= 2·tMax^(2N+1) / ((2N+1)·(1 − tMax²))
 *
 * (геометрическая оценка: члены хвоста мажорируются убывающей
 * геометрической прогрессией со знаменателем t²; числитель — первый
 * отброшенный член степени 2N+1). Все вычисления направленные:
 * степени числителя — вверх (mulUp), знаменатель (1 − t²) — вниз
 * (subDown) с fail-closed на неположительности, итог — divUp.
 * tUp = tMax·(1+1e-15) — направленная наружу инфляция аргумента
 * (перенос из oracle; tMax уже >= |истинного t| как ballMagUp).
 * При tUp >= 1 — fail-closed (ряд не сходится).
 */
function seriesRemainderUp(tMax: number, terms: number): number {
  const tUp = mulUp(tMax, addUp(1, 1e-15));
  if (tUp >= 1) {
    throw new Error('certifiedLogarithm series: |t| >= 1 — ряд не сходится (fail-closed)');
  }
  // Числитель: 2·tUp^(2N+1) — ИСПРАВЛЕНИЕ: ровно 2N умножений на tUp
  // после начального 2·tUp (в оракуле — 2N+2 умножений, что даёт
  // степень 2N+3 и пропускает первый отброшенный член 2N+1).
  let num = mulUp(2, tUp);
  for (let i = 0; i < 2 * terms; i += 1) {
    num = mulUp(num, tUp);
  }
  const t2Up = mulUp(tUp, tUp);
  // ИСПРАВЛЕНИЕ (относительно oracle): знаменатель (2N+1)·(1 − t²),
  // а не (2N+3)·...; нижняя граница (1 − t²) — строго downward без
  // эмпирического этажа вида max(1e-12, ...): такой этаж при |t| → 1
  // ЗАНИЖАЛ бы знаменатель и лишал границу строгости. Неположительная
  // нижняя граница (1 − t²) — fail-closed.
  const oneMinusT2Low = subDown(1, t2Up);
  if (!(oneMinusT2Low > 0)) {
    throw new Error('certifiedLogarithm series: (1 - t^2) <= 0 — геометрическая оценка неприменима (fail-closed)');
  }
  const denLow = nextDown((2 * terms + 1) * oneMinusT2Low);
  if (!(denLow > 0)) {
    throw new Error('certifiedLogarithm series: знаменатель остатка неположителен (fail-closed)');
  }
  return divUp(num, denLow);
}

// ============================================
// 7. СТРОГИЙ ln 2 (ряд atanh в t = 1/3, ленивый кэш)
// ============================================

/**
 * Лениво вычисленный строгий enclosure ln 2 (ряд atanh, 68 членов —
 * перенос из oracle: 3^-137 << 2^-100, радиус определяется widen).
 * ВАЖНО: t — enclosure ИСТИННОГО 1/3, полученное BALL-ДЕЛЕНИЕМ
 * 1/3 (задание §3.5): бинарное fl(1/3) НЕ считается точным вещественным
 * 1/3 (fl(1/3) ниже 1/3 на 1.85e-17 — без enclosure это дало бы
 * смещение ln 2 на ~4.2e-17). Остаток ряда — исправленная формула
 * (первый отброшенный член степени 2·68+1 = 137).
 */
let LN2_CACHE: Ball | null = null;

function ln2Ball(): Ball {
  if (LN2_CACHE !== null) {
    return LN2_CACHE;
  }
  const terms = CERTIFIED_LOG_SERIES_TERMS + 24;
  const t = divB(ballOfDd(ddFrom(1)), ballOfDd(ddFrom(3)));
  const tMax = ballMagUp(t);
  let sum = ballOfDd(ddFrom(0));
  let pow = t;
  for (let n = 0; n < terms; n += 1) {
    sum = addB(sum, divB(pow, ballOfDd(ddFrom(2 * n + 1))));
    pow = mulB(pow, mulB(t, t));
  }
  const rem = seriesRemainderUp(tMax, terms);
  const ln2 = ball(ddMulD(sum.c, 2), addUp(mulUp(2, sum.r), rem));
  LN2_CACHE = ln2;
  return ln2;
}

// ============================================
// 8. ТОЧНАЯ РЕДУКЦИЯ ВХОДА (расширение контракта; см. шапку, п. 2)
// ============================================

/**
 * Точная редукция СТРОГО ПОЛОЖИТЕЛЬНОГО точного DD-значения v = hi + lo:
 * v = m·2^k, значение m ∈ [0.5, 2). Выполняется ТОЧНЫМИ покомпонентными
 * умножениями на степени двойки — enclosure сохраняется без потерь
 * (радиус не нужен: вход ТОЧНЫЙ, а все скейлинги битово точны).
 *
 * Точность скейлингов (обоснование инвариантов):
 * (1) подъём субнормального лидера на 2^512: лидер = M·2^-1074
 *     (0 < M < 2^52) → M·2^-562 >= 2^-1022 — нормальный, умножение
 *     точное; вторая компонента (|lo| <= |hi|) также поднимается точно
 *     (M'·2^(j-1074) с j-1074 >= -1074 при j >= 0);
 * (2) нормализация множителем 2^-e, e = floorLog2(лидер): лидер
 *     попадает в [1, 2) — точное умножение; вторая компонента
 *     масштабируется той же степенью двойки: для certifiedLn lo = 0;
 *     для twoSum-DD |lo| <= ulp(hi)/2 и lo кратен ulp-решётке входов,
 *     поэтому результат масштабирования остаётся представимым точно
 *     (в фактических диапазонах PR/TPD: 1+x >= 2^-53 при x > -1 — точная
 *     сумма 1 + nextUp(-1) = 2^-53 (Stage 4.4.4.4.1-D closeout: ранее
 *     ошибочно 2^-52; nextUp(-1) = -1 + 2^-53, не -1 + 2^-52), так
 *     что e ∈ [-53, 1] и множитель ∈ [2^-1, 2^53]; меньшие |lo|
 *     масштабируются только вверх);
 * (3) коррекция границы (value >= 2 → деление на 2; value < 0.5 →
 *     умножение на 2) — те же точные покомпонентные умножения.
 * После редукции m ∈ [0.5, 2), поэтому t = (m-1)/(m+1) ∈ [-1/3, 1/3]:
 * контракт ряда (|t| <= 1/3) выполняется; остаток ряда корректен для
 * любого tUp < 1 (fail-closed проверка внутри).
 */
function reduceExactPositive(v: Dd): { m: Dd; k: number } {
  let hi = v.hi;
  let lo = v.lo;
  let k = 0;
  // Лидер — старшая ненулевая компонента. Для certifiedLn hi = x > 0;
  // для twoSum(1, x) hi = fl(1+x) >= 2^-53 > 0 при x > -1 (соседнее
  // сверху к -1 бинарное значение есть -1 + 2^-53: nextUp(-1) даёт
  // точную сумму 1+x = 2^-53, а не 2^-52 — Stage 4.4.4.4.1-D closeout).
  // hi = 0 обрабатывается defensively через lo.
  const leader = hi !== 0 ? hi : lo;
  if (!(leader > 0) || !Number.isFinite(leader)) {
    throw new Error('certifiedLogarithm reduce: значение не строго положительно/конечно (fail-closed)');
  }
  // Субнормальный лидер: точный подъём 2^512 (нормализует вплоть до
  // Number.MIN_VALUE: 2^-1074·2^512 = 2^-562).
  if (leader < BINARY64_MIN_NORMAL) {
    hi *= POW2_512;
    lo *= POW2_512;
    k = -512;
    const liftedLeader = hi !== 0 ? hi : lo;
    if (!(liftedLeader >= BINARY64_MIN_NORMAL) || !Number.isFinite(liftedLeader)) {
      throw new Error('certifiedLogarithm reduce: подъём не нормализовал значение (fail-closed)');
    }
  }
  // Точная степень двойки (битовая, без libm).
  const leader2 = hi !== 0 ? hi : lo;
  const e = floorLog2(leader2);
  const scale = certifiedPow2(-e);
  hi *= scale;
  lo *= scale;
  k += e;
  // Значение m теперь в [0.5, 2) с точностью до полу-ulp перекрытия
  // границы степени двойки (лидер в [1, 2), вторая компонента до
  // полу-ulp лидера). Точная коррекция границы по fl(hi+lo):
  // решение по fl безопасно — при любом исходе m остаётся в [0.25, 2),
  // |t| < 1, а контракт ряда требует лишь |t| <= 1/3 по факту проверки
  // tMax ниже (худший случай коррекции даёт |t| <= 0.6 — остаток
  // формально корректен при любом tUp < 1, но фактически коррекция
  // возвращает m в [0.5, 2)).
  const mVal = hi + lo;
  if (mVal >= 2) {
    hi *= 0.5;
    lo *= 0.5;
    k += 1;
  } else if (mVal < 0.5) {
    hi *= 2;
    lo *= 2;
    k -= 1;
  }
  if (!(Number.isFinite(hi) && Number.isFinite(lo))) {
    throw new Error('certifiedLogarithm reduce: неконечная редукция (fail-closed)');
  }
  return { m: { hi, lo }, k };
}

// ============================================
// 9. ВНУТРЕННИЙ СТРОГИЙ ЛОГАРИФМ ПОЛЯРНО-ПРИВЕДЁННОГО АРГУМЕНТА
// ============================================

/**
 * Строгий enclosure ln(m·2^k) для m ∈ [0.5, 2), |k| <= ~1100:
 * ln(m) = 2·atanh(t), t = (m-1)/(m+1), ряд из N = 44 членов в
 * ball-арифметике + исправленная строгая граница остатка; восстановление
 * ln(x) = ln(m) + k·ln 2 (ln 2 — тот же ряд в t = 1/3, кэшированный).
 * Смягчённые границы m (±1 ulp) покрыты тем, что t-enclosure строится
 * ball-операциями, а остаток считается от tMax = ballMagUp(t) >=
 * |истинного t|.
 */
function lnBallOfReduced(m: Dd, k: number): Ball {
  const mBall = ballOfDd(m);
  const t = divB(subtractOneBall(mBall), addOneBall(mBall));
  const tMax = ballMagUp(t);
  if (tMax >= 1) {
    throw new Error('certifiedLogarithm lnBall: |t| >= 1 после редукции (fail-closed)');
  }
  let sum = ballOfDd(ddFrom(0));
  let pow = t;
  for (let n = 0; n < CERTIFIED_LOG_SERIES_TERMS; n += 1) {
    sum = addB(sum, divB(pow, ballOfDd(ddFrom(2 * n + 1))));
    pow = mulB(pow, mulB(t, t));
  }
  const rem = seriesRemainderUp(tMax, CERTIFIED_LOG_SERIES_TERMS);
  const lnM = ball(ddMulD(sum.c, 2), addUp(mulUp(2, sum.r), rem));
  if (k === 0) {
    return lnM;
  }
  return addB(lnM, mulDB(ln2Ball(), k));
}

/** m − 1 (ball): вычитание ТОЧНОЙ единицы из enclosure. */
function subtractOneBall(m: Ball): Ball {
  return ball(ddSub(m.c, ONE_BALL.c), addUp(m.r, ONE_BALL.r));
}

/** m + 1 (ball): прибавление ТОЧНОЙ единицы к enclosure. */
function addOneBall(m: Ball): Ball {
  return ball(ddAdd(m.c, ONE_BALL.c), addUp(m.r, ONE_BALL.r));
}

// ============================================
// 10. СБОРКА РЕЗУЛЬТАТА (контракт CertifiedLogSuccess)
// ============================================

/**
 * Наружу (вверх) округлённая величина a - b для ЗАЗОРОВ результата:
 * twoSum даёт [s, e] с s + e = a − b ТОЧНО; если e <= 0, то s >=
 * точного зазора (s — валидная верхняя граница), иначе nextUp(s).
 * Типичный зазор (1 ulp) воспроизводится точно, без лишнего шага.
 */
function gapUp(a: number, b: number): number {
  const [s, e] = ddTwoSum(a, -b);
  return e <= 0 ? s : nextUp(s);
}

function logFailure(code: CertifiedLogErrorCode, message: string): CertifiedLogFailure {
  return { status: 'failure', code, message };
}

/**
 * Сборка CertifiedLogSuccess из Ball с проверками контракта:
 * value = fl(hi+lo) конечен; границы ballLo/ballHi конечны и
 * lowerBound <= value <= upperBound (гарантируется направленным
 * округлением: точный центр лежит в [nextDown(fl), nextUp(fl)] а
 * радиус прибавляется/вычитается наружу); absoluteErrorBound —
 * наружу округлённая вверх max(value - lowerBound,
 * upperBound - value) (каждая сторона — nextUp(fl(...)) >= точного
 * зазора). Нарушение любого инварианта — fail-closed отказ
 * (НЕ NaN в успехе).
 */
function resultOf(b: Ball): CertifiedLogResult {
  const value = ballVal(b);
  if (!Number.isFinite(value)) {
    return logFailure('enclosure_failure', `неконечный центр enclosure: ${String(value)}`);
  }
  const lowerBound = ballLo(b);
  const upperBound = ballHi(b);
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) {
    return logFailure(
      'enclosure_failure',
      `неконечные границы enclosure: [${String(lowerBound)}, ${String(upperBound)}]`
    );
  }
  if (!(lowerBound <= value) || !(value <= upperBound)) {
    return logFailure(
      'enclosure_failure',
      `инвариант lowerBound <= value <= upperBound нарушен: ` +
        `[${String(lowerBound)}, ${String(value)}, ${String(upperBound)}]`
    );
  }
  const gapLo = gapUp(value, lowerBound);
  const gapHi = gapUp(upperBound, value);
  const absoluteErrorBound = Math.max(gapLo, gapHi);
  if (!Number.isFinite(absoluteErrorBound) || !(absoluteErrorBound >= 0)) {
    return logFailure(
      'enclosure_failure',
      `неконечная/отрицательная граница ошибки: ${String(absoluteErrorBound)}`
    );
  }
  return { status: 'success', value, lowerBound, upperBound, absoluteErrorBound };
}

// ============================================
// 11. ПУБЛИЧНЫЙ API
// ============================================

/**
 * Сертифицированный натуральный логарифм ТОЧНОГО binary64-аргумента.
 *
 * Контракт входа: 0 < x < +Infinity — ВСЕ строго положительные конечные
 * binary64, включая субнормальные, Number.MIN_VALUE и Number.MAX_VALUE;
 * никакой нижней границы величины аргумента нет. Для x <= 0 (включая
 * ±0), NaN и ±Infinity — явный fail-closed отказ (НЕ NaN и НЕ бросок).
 *
 * Точность: value — округлённый binary64 DD-центр strict enclosure;
 * [lowerBound, upperBound] гарантированно содержит ТОЧНЫЙ ln(x)
 * (направленное округление всех радиусных операций; редукция входа
 * точная; остаток ряда — доказанная верхняя граница с первым
 * отброшенным членом степени 2N+1). ln(1) — точный специальный
 * случай: value = lowerBound = upperBound = +0,
 * absoluteErrorBound = 0.
 *
 * Платформенные трансцендентальные функции НЕ используются.
 */
export function certifiedLn(x: number): CertifiedLogResult {
  if (typeof x !== 'number' || Number.isNaN(x) || x === Infinity || x === -Infinity) {
    return logFailure(
      'invalid_input',
      `certifiedLn: аргумент должен быть конечным binary64, получено: ${String(x)}`
    );
  }
  if (!(x > 0)) {
    return logFailure(
      'non_positive_argument',
      `certifiedLn: аргумент должен быть строго положительным, получено: ${String(x)}`
    );
  }
  if (x === 1) {
    // Точный специальный случай: ln(1) = +0.
    return { status: 'success', value: 0, lowerBound: 0, upperBound: 0, absoluteErrorBound: 0 };
  }
  try {
    const { m, k } = reduceExactPositive(ddFrom(x));
    return resultOf(lnBallOfReduced(m, k));
  } catch (error) {
    return logFailure(
      'enclosure_failure',
      `certifiedLn(${String(x)}): ${error instanceof Error ? error.message : 'внутренний fail-closed'}`
    );
  }
}

/**
 * Сертифицированный ln(1 + x) для ТОЧНОГО binary64-аргумента x.
 *
 * Контракт входа: конечные binary64 x > -1 (без верхней границы:
 * 1+x округляется двухсловно). Фактические диапазоны PR/TPD call sites
 * (задание §4.1, основание: выбранный физический корень Z > B > 0,
 * поэтому 0 < B/Z < 1; TPD-ветка log1p — только после проверки
 * |(w-z)/z| <= 0.5):
 *   - lnZMinusB PR: x = -B/Z ∈ (-1, 0);
 *   - положительный log-ratio член PR: x = (1+sqrt(2))·B/Z ∈ (0, 2.415);
 *   - отрицательный log-ratio член PR: x = (1-sqrt(2))·B/Z ∈ (-0.415, 0);
 *   - TPD близкие доли: x = (w-z)/z ∈ [-0.5, 0.5].
 *
 * Алгоритм (задание §4): ВТОРОЙ ряд не вводится; бинарное 1+x НЕ
 * вычисляется (при малых |x| добавка x теряется напрочь) — сумма
 * строится ТОЧНО алгоритмом twoSum(1, x) как DD-пара (s, e),
 * s + e = 1 + x безусловно точно; enclosure этой точной DD-суммы
 * проходит тот же внутренний certify-путь (точная редукция → ряд),
 * что и certifiedLn. Около -1 малая добавка сохраняется в младшей
 * DD-части (twoSum точен при любых величинах слагаемых); около нуля
 * малая добавка НЕ поглощается (для |x| < 2^-53 сумма равна (1, x)
 * точно: ln(1+x) разрешается с точностью ~x, недостижимой для
 * бинарного 1+x).
 *
 * Специальные случаи: x = +0 → ТОЧНЫЙ +0; x = -0 → ТОЧНЫЙ -0
 * (IEEE-конвенция log1p(±0) = ±0); x = -1, x < -1, NaN, ±Infinity —
 * явный fail-closed отказ.
 */
export function certifiedLog1p(x: number): CertifiedLogResult {
  if (typeof x !== 'number' || Number.isNaN(x) || x === Infinity || x === -Infinity) {
    return logFailure(
      'invalid_input',
      `certifiedLog1p: аргумент должен быть конечным binary64, получено: ${String(x)}`
    );
  }
  if (x === 0) {
    // Точные специальные случаи: ln(1 + (+0)) = +0, ln(1 + (-0)) = -0
    // (сохранение знака по IEEE-конвенции log1p).
    return { status: 'success', value: x, lowerBound: x, upperBound: x, absoluteErrorBound: 0 };
  }
  if (x <= -1) {
    return logFailure(
      'at_or_below_minus_one',
      `certifiedLog1p: аргумент должен быть строго больше -1, получено: ${String(x)}`
    );
  }
  try {
    const [s, e] = ddTwoSum(1, x); // ТОЧНАЯ сумма 1 + x (Knuth two-sum)
    const { m, k } = reduceExactPositive({ hi: s, lo: e });
    return resultOf(lnBallOfReduced(m, k));
  } catch (error) {
    return logFailure(
      'enclosure_failure',
      `certifiedLog1p(${String(x)}): ${error instanceof Error ? error.message : 'внутренний fail-closed'}`
    );
  }
}

/**
 * Значение certified-результата для production call sites (PR/TPD,
 * Stage 4.4.4.4.1-C): value при успехе, Number.NaN при любом fail-closed
 * отказе. Это НЕ сам certified-результат: полные enclosure-поля
 * (lowerBound / upperBound / absoluteErrorBound) остаются доступны
 * напрямую через certifiedLn / certifiedLog1p для будущих аудиторских
 * цепочек распространения ошибки (Stage 4.4.4.4.1-B и далее).
 * Production PR/TPD используют .value, чтобы НЕ менять свои публичные API:
 * NaN-семантика при отказе воспроизводит прежнюю доменную семантику
 * Math.log / Math.log1p на недопустимых входах, поэтому существующие
 * guard-ы и коды отказов (NaN, logarithm_domain_error, null →
 * numerical_failure) не меняются.
 */
export function certifiedLogValue(result: CertifiedLogResult): number {
  return result.status === 'success' ? result.value : Number.NaN;
}
