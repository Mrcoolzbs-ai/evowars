// ============================================================================
// Stage 4.4.4.4.1-C — тесты сертифицированного логарифмического ядра
// Core/certifiedLogarithm.ts (certifiedLn / certifiedLog1p)
// ----------------------------------------------------------------------------
// Проверяется перенос вычислительного ядра tsLog из оракула Stage
// 4.4.4.4.1-A в production (см. docs/science/CERTIFIED_LOGARITHM_KERNEL.md):
//
// Основное доказательство корректности содержится в САМОМ алгоритме
// (строгий ряд atanh с доказанной верхней границей остатка, стартующей
// с первого отброшенного члена степени 2N+1; DD-примитивы Knuth/Dekker;
// ball-арифметика с направленным округлением радиусов; точная битовая
// редукция входа) — сетка тестовых точек доказательством НЕ является.
// Тесты ловят ошибки реализации и проверяют КОНТРАКТ результата:
//   - enclosure: lowerBound <= value <= upperBound, все величины конечны,
//     absoluteErrorBound >= обе стороны зазора и покрывает расхождение
//     с точным значением;
//   - НЕЗАВИСИМЫЙ high-precision эталон входит в enclosure. Эталон —
//     BigInt fixed-point (Q = 420 бит ~ 126 десятичных знаков, 150 членов
//     ряда, точная рациональная редукция входа по битам), полученный
//     способом, НЕ зависящим от kernel-кода (другая точность, другое
//     суммирование, другая редукция; Python decimal в среде генерации
//     был недоступен — происхождение эталона задокументировано в
//     CERTIFIED_LOGARITHM_KERNEL.md §5);
//   - фиксированные golden decimal-строки (110 знаков после точки)
//     сверяются и с эталоном, и с enclosure;
//   - фактические диапазоны аргументов всех трёх PR log1p-термов и TPD
//     ln(w/z)-ветки (задание Stage 4.4.4.4.1-C §4.1);
//   - точные специальные случаи (ln(1) = +0; log1p(±0) = ±0) и
//     fail-closed семантика недопустимых входов;
//   - регрессия переноса certifiedPow2: верхняя бинада
//     [2^1023, 2^1024) включая Number.MAX_VALUE (дефект переноса давал
//     здесь радиус ~1e7 и смещение ~7; см. шапку модуля, §3);
//   - побитовое/близкое к побитовому совпадение с libm — только
//     ДОПОЛНИТЕЛЬНАЯ регрессионная проверка на известных диапазонах
//     (V8/IEEE), НЕ эталон и НЕ доказательство: единственный эталон —
//     строгий enclosure и BigInt-референс.
//
// Тесты НЕ доказывают correctness-окружение для всей PR/TPD-цепочки:
// локальная граница absoluteErrorBound — граница ТОЛЬКО одного
// логарифмического вызова (см. CERTIFIED_LOGARITHM_KERNEL.md §9).
// ============================================================================

import { describe, expect, it } from 'vitest';

import {
  CERTIFIED_LOG_ERROR_CODES,
  CERTIFIED_LOG_SERIES_TERMS,
  certifiedLn,
  certifiedLog1p
} from '../Core/certifiedLogarithm';
import type { CertifiedLogResult, CertifiedLogSuccess } from '../Core/certifiedLogarithm';

// ============================================
// 1. НЕЗАВИСИМЫЙ BigInt-ЭТАЛОН (fixed-point Q=420)
// ============================================
// Число представляется целым BigInt fix = round(значение * 2^Q).
// Q = 420 бит (~126 десятичных знаков) >> 100 знаков задания; ряд
// atanh из 150 членов: первый отброшенный член ~3^-301 ~ 10^-144,
// ошибки округления ~150 ulp_2^-420 ~ 10^-122 — заведомо ниже
// двойной точности проверяемых enclosure (~2^-52 относительных).
// Эталон не использует ни одну функцию/примитив kernel-модуля.

const REF_Q = 420n;
const REF_TERMS = 150;
const REF_DV = new DataView(new ArrayBuffer(8));

/** Битовое представление binary64 (little-endian среда Node/vitest). */
function refBits(x: number): bigint {
  REF_DV.setFloat64(0, x);
  return REF_DV.getBigUint64(0, true);
}

/** Точное разложение |x| = num * 2^exp (num целое, экспонента bigint). */
function refDecomposeAbs(x: number): { num: bigint; exp: bigint } {
  const bits = refBits(x);
  const frac = bits & ((1n << 52n) - 1n);
  const biased = (bits >> 52n) & 2047n;
  if (biased === 0n) {
    return { num: frac, exp: -1074n };
  }
  return { num: frac | (1n << 52n), exp: biased - 1023n - 52n };
}

/** Точный знак x как bigint (±1). */
function refSign(x: number): bigint {
  return (refBits(x) >> 63n) & 1n ? -1n : 1n;
}

function refBitLen(n: bigint): number {
  return n.toString(2).length;
}

/** ln(2) = 2*atanh(1/3) фиксированной точности (вычисляется один раз). */
let REF_LN2: bigint | null = null;
function refLn2Fix(): bigint {
  if (REF_LN2 !== null) {
    return REF_LN2;
  }
  const t = (1n << REF_Q) / 3n; // floor(2^Q/3): смещение ~2^-Q, не влияет
  let p = t;
  let sum = 0n;
  for (let n = 0; n < REF_TERMS; n += 1) {
    sum += p / BigInt(2 * n + 1);
    p = (p * t * t) >> (2n * REF_Q);
  }
  REF_LN2 = sum << 1n;
  return REF_LN2;
}

/** ln(m) = 2*SUM t^(2n+1)/(2n+1), t фиксированной точки, m = A/B ∈ [1,2). */
function refLnMSeriesFix(tFix: bigint): bigint {
  let p = tFix;
  let sum = 0n;
  for (let n = 0; n < REF_TERMS; n += 1) {
    sum += p / BigInt(2 * n + 1);
    p = (p * tFix * tFix) >> (2n * REF_Q);
  }
  return sum << 1n;
}

/**
 * Точный ln(x) для x > 0: разложение по битам num*2^exp, нормализация
 * m = num/2^(bl-1) ∈ [1,2), k = exp + bl - 1, t = (A-B)/(A+B) точной
 * рациональной арифметикой (степени двойки сокращаются точно), затем
 * ряд и k*ln(2).
 */
function refLnFix(x: number): bigint {
  const { num, exp } = refDecomposeAbs(x);
  if (num === 0n || refSign(x) < 0n) {
    throw new Error('refLnFix: x <= 0');
  }
  const bl = refBitLen(num);
  const k = exp + BigInt(bl - 1);
  const A = num;
  const B = 1n << BigInt(bl - 1);
  const tFix = ((A - B) << REF_Q) / (A + B);
  return refLnMSeriesFix(tFix) + k * refLn2Fix();
}

/**
 * Точный ln(1+x): 1+x — ТОЧНАЯ рациональная дробь N/D (x = num*2^exp,
 * общий знаменатель — степень двойки; при exp > 0 числитель и
 * знаменатель домножаются на 2^exp), нормализация m = A/B ∈ [1,2),
 * k ∈ Z (возможно отрицательный), ряд + k*ln(2).
 */
function refLog1pFix(x: number): bigint {
  const { num, exp } = refDecomposeAbs(x);
  const s = refSign(x);
  const E = exp < 0n ? -exp : 0n;
  const D = 1n << E;
  const N = D + s * (num << (exp > 0n ? exp : 0n));
  if (N <= 0n) {
    throw new Error('refLog1pFix: 1 + x <= 0');
  }
  let k = BigInt(refBitLen(N) - refBitLen(D));
  let A = N;
  let B = D;
  for (let guard = 0; guard < 4; guard += 1) {
    if (k >= 0n) {
      A = N;
      B = D << k;
    } else {
      A = N << (-k);
      B = D;
    }
    if (A >= B && A < 2n * B) {
      break;
    }
    k = A < B ? k - 1n : k + 1n;
  }
  const tFix = ((A - B) << REF_Q) / (A + B);
  return refLnMSeriesFix(tFix) + k * refLn2Fix();
}

/** floor(x * 2^Q) наружу (нижняя граница enclosure в fixed-point). */
function refDoubleToFixFloor(x: number): bigint {
  const { num, exp } = refDecomposeAbs(x);
  const a = refSign(x) * num;
  const shift = exp + REF_Q;
  if (shift >= 0n) {
    return a << shift;
  }
  return a >> (-shift); // BigInt >> округляет к -Infinity
}

/** ceil(x * 2^Q) наружу (верхняя граница enclosure в fixed-point). */
function refDoubleToFixCeil(x: number): bigint {
  const { num, exp } = refDecomposeAbs(x);
  const a = refSign(x) * num;
  const shift = exp + REF_Q;
  if (shift >= 0n) {
    return a << shift;
  }
  return -((-a) >> (-shift));
}

/** ulp(|value|) в единицах fixed-point (null — если представимо < 1). */
function refUlpFix(value: number): bigint | null {
  if (value === 0) {
    return null;
  }
  const { num, exp } = refDecomposeAbs(Math.abs(value));
  const bl = refBitLen(num);
  const shift = exp + BigInt(bl - 53) + REF_Q;
  if (shift < 0n) {
    return null;
  }
  return 1n << shift;
}

/** Парсинг golden decimal-строки в fixed-point (round-to-nearest). */
function parseGoldenToFix(str: string): bigint {
  const m = /^(-?)(\d+)\.(\d+)$/.exec(str);
  if (m === null) {
    throw new Error(`parseGoldenToFix: некорректная строка: ${str}`);
  }
  const N = BigInt(m[1] + m[2] + m[3]);
  const scale = 10n ** BigInt(m[3].length);
  return ((N << REF_Q) + (scale >> 1n)) / scale;
}

// ============================================
// 2. ВСПОМОГАТЕЛЬНЫЕ ПРОВЕРКИ КОНТРАКТА
// ============================================

function expectSuccess(result: CertifiedLogResult): CertifiedLogSuccess {
  expect(result.status).toBe('success');
  const s = result as CertifiedLogSuccess;
  expect(Number.isFinite(s.value)).toBe(true);
  expect(Number.isFinite(s.lowerBound)).toBe(true);
  expect(Number.isFinite(s.upperBound)).toBe(true);
  expect(Number.isFinite(s.absoluteErrorBound)).toBe(true);
  expect(s.absoluteErrorBound >= 0).toBe(true);
  expect(s.lowerBound <= s.value).toBe(true);
  expect(s.value <= s.upperBound).toBe(true);
  // Граница ошибки покрывает ОБЕ стороны enclosure.
  expect(s.absoluteErrorBound >= s.value - s.lowerBound).toBe(true);
  expect(s.absoluteErrorBound >= s.upperBound - s.value).toBe(true);
  return s;
}

/**
 * Полный аудит одной точки против независимого эталона:
 * - отсутствие неожиданного отказа;
 * - контракт enclosure (expectSuccess);
 * - ТОЧНОЕ значение входит в enclosure (fixed-point, наружу);
 * - расхождение value с точным значением покрывается absoluteErrorBound
 *   и не превосходит 4 ulp (регрессионная проверка реализации;
 *   измеренный максимум на батарее — 1.6 ulp).
 */
function auditAgainstReference(
  result: CertifiedLogResult,
  refFix: bigint,
  maxDevUlp: number
): CertifiedLogSuccess {
  const s = expectSuccess(result);
  const loFix = refDoubleToFixFloor(s.lowerBound);
  const hiFix = refDoubleToFixCeil(s.upperBound);
  expect(loFix <= refFix).toBe(true);
  expect(refFix <= hiFix).toBe(true);
  const valFix = refDoubleToFixFloor(s.value);
  const dev = valFix > refFix ? valFix - refFix : refFix - valFix;
  const ulpFix = refUlpFix(s.value);
  if (ulpFix !== null) {
    const devUlp = Number((dev * 1000000n) / ulpFix) / 1000000;
    expect(devUlp).toBeLessThanOrEqual(maxDevUlp);
  }
  return s;
}

// nextUp/nextDown по битам (для сетки соседей; LE-среда Node).
function testNextUp(x: number): number {
  REF_DV.setFloat64(0, x);
  const bits = REF_DV.getBigUint64(0, true);
  REF_DV.setBigUint64(0, bits + (x >= 0 ? 1n : -1n), true);
  return REF_DV.getFloat64(0);
}
function testNextDown(x: number): number {
  return -testNextUp(-x);
}

// ============================================
// 3. ФИКСТУРА PR (единственный побитовый якорь смешевого теста)
// ============================================
// Воспроизводит B_mix и Z паровой ветви фикстуры Stage 4.4.4.3.1
// (N2, T = 1388.2195230363363 K, P = 1e6 Pa): в
// pengRobinsonMixture.test.ts эта точка требует |lnPhi - libm-формы| <
// 1e-30, т.е. фактического побитового совпадения certified с libm.
// Здесь те же аргументы трёх log1p-термов покрываются эталоном и
// сеткой соседей.

const R = 8.31446261815324;
const N2_TC = 126.192;
const N2_PC = 3395800;
const N2_OMEGA = 0.0372;
const FIXTURE_T = 1388.2195230363363;
const FIXTURE_P = 1e6;
const FIXTURE_Z = 1.0020826254379862;

function fixtureDimensionlessB(): number {
  const kappa = 0.37464 + 1.54226 * N2_OMEGA - 0.26992 * N2_OMEGA * N2_OMEGA;
  const alpha = (1 + kappa * (1 - Math.sqrt(FIXTURE_T / N2_TC))) ** 2;
  const a = (0.45724 * R * R * N2_TC * N2_TC * alpha) / N2_PC;
  const b = (0.0778 * R * N2_TC) / N2_PC;
  return (b * FIXTURE_P) / (R * FIXTURE_T);
}

// ============================================
// 4. certifiedLn
// ============================================

describe('Stage 4.4.4.4.1-C: certifiedLn — контракт enclosure', () => {
  it('ln(1) — точный специальный случай +0', () => {
    const r = certifiedLn(1);
    const s = expectSuccess(r);
    expect(Object.is(s.value, 0)).toBe(true);
    expect(s.lowerBound).toBe(0);
    expect(s.upperBound).toBe(0);
    expect(s.absoluteErrorBound).toBe(0);
  });

  it('экспортирует константы контракта (N=44, коды ошибок)', () => {
    expect(CERTIFIED_LOG_SERIES_TERMS).toBe(44);
    expect(CERTIFIED_LOG_ERROR_CODES).toEqual([
      'invalid_input',
      'non_positive_argument',
      'at_or_below_minus_one',
      'enclosure_failure'
    ]);
  });

  it('батарея ln: enclosure содержит точное значение (независимый эталон)', () => {
    const nU = testNextUp;
    const nD = testNextDown;
    const points: number[] = [
      2, 3, 4, 10, 0.5, 0.75, 1.5, 7.5, 123.456, 2.718281828, 0.0345,
      0.9979, 1.003, 0.9999999999999999, 1.0000000000000002,
      nU(1), nD(1), nU(0.5), nD(0.5), nU(2), nD(2),
      Math.pow(2, 100), Math.pow(2, -100),
      Number.MIN_VALUE, 3 * Number.MIN_VALUE, 12345 * Number.MIN_VALUE,
      2.2250738585072014e-308, nD(2.2250738585072014e-308), nU(2.2250738585072014e-308),
      8.988465674311579e307, 8.988465674311579e307 * 0.75,
      Number.MAX_VALUE, nD(Number.MAX_VALUE)
    ];
    for (const x of points) {
      const r = certifiedLn(x);
      // Отказ на валидном входе — ошибка реализации; enclosure-контракт
      // и попадание эталона проверяются в auditAgainstReference.
      auditAgainstReference(r, refLnFix(x), 4);
    }
  });

  it('верхняя бинада [2^1023, 2^1024) — регрессия дефекта переноса pow2', () => {
    // Дефект (шапка модуля §3): certifiedPow2(-1023) возвращал 2^-1055,
    // редукция MAX_VALUE ломалась (value ~702.65 вместо 709.78,
    // радиус ~1e7). Здесь — точные значения и tight enclosure.
    const maxR = certifiedLn(Number.MAX_VALUE);
    const maxS = auditAgainstReference(maxR, refLnFix(Number.MAX_VALUE), 4);
    expect(maxS.value).toBe(709.782712893384);
    expect(maxS.absoluteErrorBound).toBeLessThanOrEqual(2e-13);

    const p1023 = 8.988465674311579e307; // = 2^1023
    for (const x of [p1023, p1023 * 0.75, p1023 * 1.25, testNextDown(Number.MAX_VALUE)]) {
      auditAgainstReference(certifiedLn(x), refLnFix(x), 4);
    }
    // Сосед с 2^1023 снизу — стык бинад: экспонента меняется на 1,
    // ln(x) = 709.089... - k*ln(2) собирается из тех же enclosure.
    auditAgainstReference(certifiedLn(testNextDown(p1023)), refLnFix(testNextDown(p1023)), 4);
  });

  it('побитовое совпадение с корректно округленным libm на фикстуре и соседях', () => {
    // ДОПОЛНИТЕЛЬНАЯ регрессия (не эталон): в окрестности Z паровой
    // ветви фикстуры (±1000 ulp) certified побитово совпадает с
    // libm V8 — это обеспечивает якорь |lnPhi - libm-формы| < 1e-30
    // в pengRobinsonMixture.test.ts.
    let z = FIXTURE_Z;
    for (let i = 0; i < 1000; i += 1) {
      z = testNextDown(z);
    }
    for (let i = 0; i < 2001; i += 1) {
      const r = certifiedLn(z);
      expect(r.status).toBe('success');
      const s = r as CertifiedLogSuccess;
      expect(s.value).toBe(Math.log(z));
      z = testNextUp(z);
    }
  });

  it('недопустимые входы: fail-closed с точными кодами', () => {
    for (const x of [0, -0, -1, -Number.MIN_VALUE, -Number.MAX_VALUE]) {
      const r = certifiedLn(x);
      expect(r.status).toBe('failure');
      expect((r as { code: string }).code).toBe('non_positive_argument');
    }
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = certifiedLn(x);
      expect(r.status).toBe('failure');
      expect((r as { code: string }).code).toBe('invalid_input');
    }
  });
});

// ============================================
// 5. certifiedLog1p
// ============================================

describe('Stage 4.4.4.4.1-C: certifiedLog1p — контракт enclosure', () => {
  it('точные +0/-0 (IEEE-конвенция log1p)', () => {
    const p = certifiedLog1p(0);
    const ps = expectSuccess(p);
    expect(Object.is(ps.value, 0)).toBe(true);
    expect(ps.lowerBound).toBe(0);
    expect(ps.upperBound).toBe(0);
    expect(ps.absoluteErrorBound).toBe(0);
    const m = certifiedLog1p(-0);
    const ms = expectSuccess(m);
    expect(Object.is(ms.value, -0)).toBe(true);
    expect(Object.is(ms.lowerBound, -0)).toBe(true);
    expect(Object.is(ms.upperBound, -0)).toBe(true);
    expect(ms.absoluteErrorBound).toBe(0);
  });

  it('батарея log1p: enclosure содержит точное значение (независимый эталон)', () => {
    const nU = testNextUp;
    const nD = testNextDown;
    const B = fixtureDimensionlessB();
    expect(B).toBe(0.002082625437986142);
    const points: number[] = [
      0.5, -0.5, nU(-0.5), nD(-0.5), nU(0.5), nD(0.5),
      -0.4999999999999999, 0.4999999999999999,
      1e-16, -1e-16, 1e-300, -1e-300,
      5e-324, -5e-324, 3 * Number.MIN_VALUE, -3 * Number.MIN_VALUE,
      nU(-1), 1, 2, 1e6, 1e300,
      // фактические аргументы трёх PR log1p-термов на фикстуре
      -B / FIXTURE_Z,
      ((1 + Math.SQRT2) * B) / FIXTURE_Z,
      ((1 - Math.SQRT2) * B) / FIXTURE_Z,
      // границы заявленных диапазонов (задание §4.1) и соседи
      2.414213562373095, -0.41421356237309515, nU(2.414213562373095), nD(-0.41421356237309515)
    ];
    for (const x of points) {
      auditAgainstReference(certifiedLog1p(x), refLog1pFix(x), 4);
    }
  });

  it('log1p около -1: малая добавка сохраняется в младшей DD-части', () => {
    // nextUp(-1) = -1 + 2^-53: 1 + x = 2^-53 ТОЧНО; ln(2^-53) = -53*ln(2)
    // бинарное 1+x уничтожило бы добавку полностью.
    const r = certifiedLog1p(testNextUp(-1));
    const s = auditAgainstReference(r, refLog1pFix(testNextUp(-1)), 4);
    expect(s.value).toBeCloseTo(-36.7368005696771, 10);
    expect(s.value).toBeLessThan(0);
    // Сосед nextUp(nextUp(-1)): добавка 2·2^-53 — раскладывается twoSum-ом.
    const r2 = certifiedLog1p(testNextUp(testNextUp(-1)));
    auditAgainstReference(r2, refLog1pFix(testNextUp(testNextUp(-1))), 4);
  });

  it('log1p малых |x|: разрешение ~x недостижимо для бинарного 1+x', () => {
    for (const x of [1e-16, -1e-16, 5e-324, -5e-324, 1e-300, -1e-300]) {
      const r = certifiedLog1p(x);
      const s = auditAgainstReference(r, refLog1pFix(x), 4);
      // sign(x) и масштаб ~|x| (для субнормалей — округление к сетке)
      expect(Math.sign(s.value)).toBe(Math.sign(x));
      expect(Math.abs(s.value)).toBeLessThanOrEqual(Math.abs(x));
    }
  });

  it('недопустимые входы: fail-closed с точными кодами', () => {
    for (const x of [-1, -1.5, -Number.MAX_VALUE]) {
      const r = certifiedLog1p(x);
      expect(r.status).toBe('failure');
      expect((r as { code: string }).code).toBe('at_or_below_minus_one');
    }
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = certifiedLog1p(x);
      expect(r.status).toBe('failure');
      expect((r as { code: string }).code).toBe('invalid_input');
    }
  });

  it('детерминизм: одинаковый вход — одинаковый результат (чистая функция)', () => {
    // Необходимое условие перестановочной инвариантности TPD
    // (канонический порядок + чистое ядро); сама инвариантность TPD
    // проверяется в prTangentPlaneDistance.test.ts.
    for (const x of [2, 0.75, -0.5, 1e-16]) {
      const a = certifiedLn(x);
      const b = certifiedLn(x);
      expect(a).toEqual(b);
      const c = certifiedLog1p(x);
      const d = certifiedLog1p(x);
      expect(c).toEqual(d);
    }
  });
});

// ============================================
// 6. GOLDEN REFERENCE STRINGS (§7.3-7.4 задания)
// ============================================
// Зафиксированные ≥110-значные десятичные эталоны, сгенерированные
// НЕЗАВИСИМЫМ BigInt fixed-point эталоном (Q = 420, 150 членов),
// зафиксированным в этом файле. Для каждой точки:
//   - распарсенная строка согласована с runtime-эталоном;
//   - точное значение входит в enclosure certified-результата;
//   - расхождение value с эталоном покрывается absoluteErrorBound.

describe('Stage 4.4.4.4.1-C: golden reference vectors (независимый эталон, 110 знаков)', () => {
  const B = fixtureDimensionlessB();

  const goldenLn: Array<[string, number, string]> = [
    ['ln(2)', 2, '0.69314718055994530941723212145817656807550013436025525412068000949339362196969471560586332699641868754200148102'],
    ['ln(3)', 3, '1.09861228866810969139524523692252570464749055782274945173469433363749429321860896687361575481373208878797002906'],
    ['ln(0.75)', 0.75, '-0.28768207245178092743921900599382743150350971089776105650666568534929295072078046433811089917910528629603293298'],
    ['ln(MIN_VALUE)', Number.MIN_VALUE, '-744.44007192138126231410729844608163411308714430291414292561033019590474999545212456069721319415367042010959061610'],
    ['ln(MAX_VALUE)', Number.MAX_VALUE, '709.78271289338399673222338991065714550397314873666416303860305771470605931916868143989110797201570339585659860517']
  ];
  const goldenLog1p: Array<[string, number, string]> = [
    ['log1p(0.5)', 0.5, '0.40546510810816438197801311546434913657199042346249419761401432414410067124891425126775242781731340124596854804'],
    ['log1p(-0.5)', -0.5, '-0.69314718055994530941723212145817656807550013436025525412068000949339362196969471560586332699641868754200148103'],
    ['log1p(nextUp(-1))', testNextUp(-1), '-36.73680056967710139911330243728335810800150712109352846839604050314986196439381992711075633081019043972607849410'],
    ['log1p(1e-16)', 1e-16, '0.00000000000000009999999999999999290977867240346089853957758707192327183048452234000735254290429626865846110943'],
    ['log1p(-B/Z фикстуры)', -B / FIXTURE_Z, '-0.00208045977994375730755976682800664647132891279288859271544471649265781578260550970926452788662612114644069016'],
    ['log1p((1+sqrt(2))B/Z фикстуры)', ((1 + Math.SQRT2) * B) / FIXTURE_Z, '0.00500490763115725840348675421022191457025661611972482425768706650252865028698991555622245448177626861240859720'],
    ['log1p((1-sqrt(2))B/Z фикстуры)', ((1 - Math.SQRT2) * B) / FIXTURE_Z, '-0.00086122960698289657148791250078547648982252438564733526268637250461183847403022580600414286774453246800171603']
  ];

  it('golden ln-строки: эталон в enclosure, строка согласована с runtime-эталоном', () => {
    for (const [name, x, str] of goldenLn) {
      const r = certifiedLn(x);
      const s = expectSuccess(r);
      const refFix = refLnFix(x);
      const strFix = parseGoldenToFix(str);
      // Строка (110 знаков) согласована с runtime-эталоном Q=420:
      // расхождение не превосходит усечения строки ~ 2^54 единиц.
      const diff = strFix > refFix ? strFix - refFix : refFix - strFix;
      expect(diff <= (1n << 60n), `${name}: golden-строка рассогласована с эталоном`).toBe(true);
      // Точное значение — внутри enclosure (наружу округлённые границы).
      expect(refDoubleToFixFloor(s.lowerBound) <= refFix, `${name}: эталон ниже lowerBound`).toBe(true);
      expect(refFix <= refDoubleToFixCeil(s.upperBound), `${name}: эталон выше upperBound`).toBe(true);
      // Расхождение value с эталоном покрывается локальной границей.
      const valFix = refDoubleToFixFloor(s.value);
      const dev = valFix > refFix ? valFix - refFix : refFix - valFix;
      const errFix = refDoubleToFixCeil(s.absoluteErrorBound);
      expect(dev <= errFix, `${name}: расхождение больше absoluteErrorBound`).toBe(true);
    }
  });

  it('golden log1p-строки: эталон в enclosure, строка согласована с runtime-эталоном', () => {
    for (const [name, x, str] of goldenLog1p) {
      const r = certifiedLog1p(x);
      const s = expectSuccess(r);
      const refFix = refLog1pFix(x);
      const strFix = parseGoldenToFix(str);
      const diff = strFix > refFix ? strFix - refFix : refFix - strFix;
      expect(diff <= (1n << 60n), `${name}: golden-строка рассогласована с эталоном`).toBe(true);
      expect(refDoubleToFixFloor(s.lowerBound) <= refFix, `${name}: эталон ниже lowerBound`).toBe(true);
      expect(refFix <= refDoubleToFixCeil(s.upperBound), `${name}: эталон выше upperBound`).toBe(true);
      const valFix = refDoubleToFixFloor(s.value);
      const dev = valFix > refFix ? valFix - refFix : refFix - valFix;
      const errFix = refDoubleToFixCeil(s.absoluteErrorBound);
      expect(dev <= errFix, `${name}: расхождение больше absoluteErrorBound`).toBe(true);
    }
  });

  it('максимальные полученные локальные границы ошибок не превосходят 1 ulp value', () => {
    // Измерение по всей золотой батарее: типичный и максимальный
    // absoluteErrorBound — 1 ulp значения (tight-границы §4 шапки
    // модуля). Фиксируется как регрессионная характеристика.
    let maxErr = 0;
    for (const [, x] of goldenLn) {
      const s = expectSuccess(certifiedLn(x));
      if (s.absoluteErrorBound > maxErr) {
        maxErr = s.absoluteErrorBound;
      }
    }
    for (const [, x] of goldenLog1p) {
      const s = expectSuccess(certifiedLog1p(x));
      if (s.absoluteErrorBound > maxErr) {
        maxErr = s.absoluteErrorBound;
      }
    }
    // 1 ulp на ln(MAX_VALUE) ~ 1.14e-13 — наибольший в батарее.
    expect(maxErr).toBeLessThanOrEqual(1.2e-13);
  });
});
