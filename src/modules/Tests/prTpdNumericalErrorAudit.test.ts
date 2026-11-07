// ============================================
// Stage 4.4.4.4.1-A — ЧИСЛЕННЫЙ АУДИТ ОШИБОК: CI-ТЕСТ
// PR → lnPhi → scalar TPD (production-фасады + независимый оракул)
// ============================================
//
// НАЗНАЧЕНИЕ. Этот тест прогоняет ЗАМОРОЖЕННУЮ матрицу из 44
// воспроизводимых сценариев ( Core/tpdNumericalErrorAudit.ts ) через
// РЕАЛЬНЫЕ production-фасады ( Data/pengRobinsonMixtureFacade +
// Core/prTangentPlaneDistance, политика allow_partial ) и сверяет
// production-значения ( A/B, Z, ln(phi_i), вклады, scalar TPD ) со
// СТРОГИМИ enclosure-границами независимого оракула
// ( Core/tpdNumericalErrorAuditOracle.ts ). Полный отчёт выгружается
// в benchmark-artifacts/tpd-numerical-error-audit-dump.json
// (рабочая директория vitest; тот же паттерн, что у
// pengRobinsonMixtureBenchmarkDump.test.ts).
//
// ОРАКУЛ ( ревизия Stage 4.4.4.4.1-A корректировки ): enclosure-границы
// построены НАПРАВЛЕННЫМ ОКРУГЛЕНИЕМ НАРУЖУ ( проверенные nextUp/nextDown
// для IEEE-754 binary64, включая субнормали ) всех радиусных операций;
// топология корней ( число действительных/физических, порядок )
// доказана НЕЗАВИСИМО: интервальный знак депрессированного
// дискриминанта определяет 1/3 корня, изоляция — монотонными
// участками кубики с сертифицированной бисекцией, production-корни
// используются ТОЛЬКО как seed-приближения. Логарифм свободен от
// платформенного Math.log2 ( точное извлечение binary64 экспоненты ),
// sqrt доказан невязкой y² − x и нижней границей производной.
// Adversarial-тесты ( секции 3.1b/3.1c ) фиксируют эти гарантии.
//
// ПРОВАЙДЕР. Единственный канал, через который harness получает
// production-значения: состав канонически сортируется, результат
// смесевого вычислителя кэшируется по ключу (T, P, ветвь, состав) —
// feed и trial одного сценария гарантированно используют ОДНО и то
// же состояние ( битовая детерминированность identity-случаев ).
// Отказы нормализуются: cubic_solver_failure с признаком схлопывания
// корней → «схлопывание корней»; остальные коды — как есть.
// Echo-поля ln(w/z) и скобки вклада воспроизводят ТОЧНУЮ
// production-формулу Stage 4.4.4.4.1 (log1p-ветка / разность
// логарифмов / ровно +0 при w === z; скобка = lnRatio +
// (lnPhiTrial − lnPhiFeed)) — они только echo для аудита, итоговый
// TPD берётся из production-результата.
//
// ГРАНИЦЫ ( Stage 4.4.4.4.1-A ). Тест — ИНСТРУМЕНТ ЧИСЛЕННОГО АУДИТА:
// он НЕ является валидацией PR как физической модели, НЕ выдаёт
// вердиктов о фазовой устойчивости, НЕ пересматривает
// evidence-статусы каталогов EOS/BIP и НЕ распространяет per-point
// границы дискретной матрицы на континуум T/P/составов
// ( validatedErrorBoundStatus — в docs/science/
// TPD_NUMERICAL_ERROR_AUDIT.md ). Численная погрешность — НЕ
// физическая неопределённость EOS/BIP-данных.

import { describe, it, expect, afterAll } from 'vitest';
// @ts-expect-error типы node:fs не подключены в tsconfig проекта (паттерн golden-baseline теста)
import { mkdirSync, writeFileSync } from 'node:fs';

import { computePengRobinsonMixtureFromCatalog } from '../Data/pengRobinsonMixtureFacade';
import type {
  PengRobinsonMixtureCatalogResult,
  PengRobinsonMixtureCatalogSuccess
} from '../Data/pengRobinsonMixtureFacade';
import { computePrTangentPlaneDistance } from '../Core/prTangentPlaneDistance';

import {
  runTpdNumericalErrorAudit,
  TPD_NUMERICAL_ERROR_AUDIT_CO2,
  TPD_NUMERICAL_ERROR_AUDIT_R_J_PER_MOL_K,
  type TpdNumericalErrorAuditProvider,
  type TpdNumericalErrorAuditReport,
  type TpdNumericalErrorAuditScenarioResult,
  type TpdNumericalErrorAuditStateMeasurement,
  type TpdNumericalErrorAuditStateSpec,
  type TpdNumericalErrorAuditTpdMeasurement
} from '../Core/tpdNumericalErrorAudit';
import {
  ballHi,
  ballLo,
  ballSign,
  nextDown,
  nextUp,
  oracleCenter,
  oracleCubicCoeffs,
  oracleCubicEval,
  oracleEncloseRoot,
  oracleErrorBound,
  oracleIsolateRealRoots,
  oracleLnRatio,
  oraclePureParams,
  tsAddB,
  tsBall,
  tsDivB,
  tsMulB,
  tsScaleB,
  tsSubB,
  type Ball,
  type OracleRootTopology
} from '../Core/tpdNumericalErrorAuditOracle';

// ============================================
// 1. PRODUCTION-ПРОВАЙДЕР (фасады + кэш состояний)
// ============================================

/** Кэшированная запись смесевого состояния (успех или нормализованный отказ). */
type CatalogEntry =
  | { readonly ok: true; readonly success: PengRobinsonMixtureCatalogSuccess }
  | { readonly ok: false; readonly label: string };

/** Кэш spec → состояние: identity-сценарии и повторные составы дают один объект. */
const stateCache = new Map<string, CatalogEntry>();

/** Канонический порядок компонентов (лексикографический, как в harness). */
function canonicalSpecComps(
  spec: TpdNumericalErrorAuditStateSpec
): readonly { readonly id: string; readonly x: number }[] {
  return [...spec.comps].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );
}

function stateKey(
  spec: TpdNumericalErrorAuditStateSpec,
  temperatureK: number,
  pressurePa: number
): string {
  const comps = canonicalSpecComps(spec)
    .map((c) => `${c.id}=${String(c.x)}`)
    .join(',');
  return `${String(temperatureK)}|${String(pressurePa)}|${spec.branch}|${comps}`;
}

/**
 * Нормализация production-отказа в метку аудита: схлопывание корней
 * кубики (кубический решатель доказал N различимых корней, но double
 * не может представить их различными в допуске) — каноническая метка;
 * остальные коды проходят как есть (любой неожидаемый код останется
 * unexpected_failure и уронит аудит).
 */
function normalizeMixtureFailure(code: string, message: string): string {
  if (code === 'cubic_solver_failure' && message.includes('схлопывани')) {
    return 'схлопывание корней';
  }
  return code;
}

function catalogEntry(
  spec: TpdNumericalErrorAuditStateSpec,
  temperatureK: number,
  pressurePa: number
): CatalogEntry {
  const key = stateKey(spec, temperatureK, pressurePa);
  const cached = stateCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const result: PengRobinsonMixtureCatalogResult = computePengRobinsonMixtureFromCatalog({
    composition: canonicalSpecComps(spec).map((c) => ({
      gasId: c.id,
      moleFraction: c.x
    })),
    temperatureK,
    pressurePa,
    root: spec.branch,
    evidencePolicy: 'allow_partial'
  });
  const entry: CatalogEntry =
    result.status === 'success'
      ? { ok: true, success: result }
      : { ok: false, label: normalizeMixtureFailure(result.code, result.message) };
  stateCache.set(key, entry);
  return entry;
}

/** ln(phi_i) production-состояния в каноническом порядке аудита (по id). */
function prodLnPhi(
  success: PengRobinsonMixtureCatalogSuccess,
  spec: TpdNumericalErrorAuditStateSpec
): number[] {
  const lnPhiById = new Map<string, number>();
  for (const c of success.components) {
    lnPhiById.set(c.component, c.lnPhi);
  }
  return canonicalSpecComps(spec).map((c) => {
    const value = lnPhiById.get(c.id);
    if (value === undefined) {
      throw new Error(`production-состояние не содержит компонент «${c.id}»`);
    }
    return value;
  });
}

/**
 * Echo ln(w/z): ТОЧНАЯ реплика production-формулы Stage 4.4.4.4.1
 * ( w === z — ровно +0; |(w−z)/z| <= 0.5 — Math.log1p относительной
 * разности; иначе — разность логарифмов ). Вызывается только для
 * вкладов УСПЕШНОГО production-результата, поэтому неконечный случай
 * (production numerical_failure) здесь недостижим.
 */
const ECHO_LOG_RATIO_LOG1P_THRESHOLD = 0.5;

function productionEchoStableLogRatio(w: number, z: number): number {
  if (w === z) {
    return 0;
  }
  const relativeDifference = (w - z) / z;
  if (Math.abs(relativeDifference) <= ECHO_LOG_RATIO_LOG1P_THRESHOLD) {
    return Math.log1p(relativeDifference);
  }
  return Math.log(w) - Math.log(z);
}

const provider: TpdNumericalErrorAuditProvider = {
  label: 'production: Data/pengRobinsonMixtureFacade (allow_partial) + Core/prTangentPlaneDistance',
  mixtureState(spec, temperatureK, pressurePa) {
    const entry = catalogEntry(spec, temperatureK, pressurePa);
    if (!entry.ok) {
      return { failure: entry.label };
    }
    const s = entry.success;
    return {
      dimensionlessA: s.dimensionlessA,
      dimensionlessB: s.dimensionlessB,
      Z: s.Z,
      realRoots: [...s.realRoots],
      physicalRoots: [...s.physicalRoots],
      lnPhi: prodLnPhi(s, spec)
    };
  },
  tangentPlaneDistance(feedSpec, trialSpec, temperatureK, pressurePa) {
    const feedEntry = catalogEntry(feedSpec, temperatureK, pressurePa);
    if (!feedEntry.ok) {
      return { failure: feedEntry.label };
    }
    const trialEntry = catalogEntry(trialSpec, temperatureK, pressurePa);
    if (!trialEntry.ok) {
      return { failure: trialEntry.label };
    }
    const result = computePrTangentPlaneDistance({
      feed: feedEntry.success,
      trial: trialEntry.success
    });
    if (result.status === 'failure') {
      return { failure: result.code };
    }
    return {
      tpd: result.tpd,
      contributions: result.contributions.map((c) => {
        const lnRatio = productionEchoStableLogRatio(c.trialMoleFraction, c.feedMoleFraction);
        const bracket = lnRatio + (c.lnPhiTrial - c.lnPhiFeed);
        return {
          component: c.component,
          w: c.trialMoleFraction,
          z: c.feedMoleFraction,
          lnRatio,
          bracket,
          contribution: c.contribution
        };
      })
    };
  }
};

// ============================================
// 2. ОТЧЁТ АУДИТА (module scope: полный прогон 44 сценариев)
// ============================================

const report: TpdNumericalErrorAuditReport = runTpdNumericalErrorAudit(provider);

const byId = new Map<string, TpdNumericalErrorAuditScenarioResult>();
for (const r of report.results) {
  byId.set(r.id, r);
}

function scenario(id: string): TpdNumericalErrorAuditScenarioResult {
  const r = byId.get(id);
  if (r === undefined) {
    throw new Error(`сценарий «${id}» отсутствует в отчёте аудита`);
  }
  return r;
}

function feedOf(id: string): TpdNumericalErrorAuditStateMeasurement {
  const f = scenario(id).feed;
  if (f === undefined) {
    throw new Error(`сценарий «${id}»: отсутствует feed-измерение`);
  }
  return f;
}

function trialOf(id: string): TpdNumericalErrorAuditStateMeasurement {
  const t = scenario(id).trial;
  if (t === undefined) {
    throw new Error(`сценарий «${id}»: отсутствует trial-измерение`);
  }
  return t;
}

function tpdOf(id: string): TpdNumericalErrorAuditTpdMeasurement {
  const t = scenario(id).tpd;
  if (t === undefined) {
    throw new Error(`сценарий «${id}»: отсутствует TPD-измерение`);
  }
  return t;
}

/**
 * Независимая изоляция корней кубики PR на oracle-вычисленных A/B
 * для чистого CO2 при (T = 250 K, P). Возвращает ДОКАЗАННУЮ топологию;
 * любое недоказуемое место оракул превращает в исключение (fail-closed).
 */
function isolateCo2(pressurePa: number): OracleRootTopology {
  const params = oraclePureParams(
    TPD_NUMERICAL_ERROR_AUDIT_CO2,
    250,
    pressurePa,
    TPD_NUMERICAL_ERROR_AUDIT_R_J_PER_MOL_K
  );
  return oracleIsolateRealRoots(params.A, params.B);
}

/** Дизъюнктность и порядок enclosure-ов возрастающих корней. */
function enclosuresDisjointOrdered(roots: readonly Ball[]): boolean {
  for (let i = 0; i + 1 < roots.length; i += 1) {
    if (!(ballHi(roots[i] as Ball) < ballLo(roots[i + 1] as Ball))) {
      return false;
    }
  }
  return true;
}

// ============================================
// 3. ТЕСТЫ
// ============================================

describe('Stage 4.4.4.4.1-A: численный аудит ошибок PR → lnPhi → scalar TPD', () => {
  // --- 3.1. Self-test независимого оракула ------------------------------

  it('self-test оракула: enclosure-валидность базовых операций', () => {
    // ln(8) = 3·ln(2) в центрах оракула: серия редукции согласована
    // (аномалия старого прототипа 4.8e-16 исключена).
    expect(report.selfTest.ln8_vs_3ln2).toBeLessThan(1e-16);
    // log 3: платформенный Math.log НЕ обязан быть correctly rounded
    // ( fdlibm-класс — до ~1 ulp ): граница = |c|·eps + |Math.log(3) − c|·(1+eps)
    // + r. В среде аудита Math.log(3) совпадает с центром оракула — 2.5268e-16
    // ( = |c|·eps ); в CI V8/fdlibm отклонение 1 ulp ( 2.2204e-16 ) —
    // 4.747254313187558e-16 ( наблюдено в CI 2026-11-07 ). Порог 6e-16 =
    // |c|·eps + ~1.6 ulp покрывает оба окружения с запасом.
    expect(report.selfTest.log3_bound).toBeLessThan(6e-16);
    expect(report.selfTest.sqrt2_bound).toBeLessThan(4e-16);
    expect(report.selfTest.subnormalMul.coversTrue).toBe(true);
    expect(Math.abs(report.selfTest.lnRatio_identity.center)).toBeLessThan(1e-30);
    expect(report.selfTest.lnRatio_identity.r).toBeLessThan(1e-28);
  });

  it('self-test оракула: CO2-фикстура (T=250 K, P=1 MPa), vapor-корень', () => {
    // Каталожная CO2-фикстура Stage 4.4.4.4.1: три физических корня
    // 0.0198964 / 0.0652088 / 0.9020656; enclosure vapor-ветви обязан
    // содержать production-корень с границей < 1e-12.
    const params = oraclePureParams(
      TPD_NUMERICAL_ERROR_AUDIT_CO2,
      250,
      1e6,
      TPD_NUMERICAL_ERROR_AUDIT_R_J_PER_MOL_K
    );
    const enc = oracleEncloseRoot(params.A, params.B, 0.9020656184687209, [0.9020656184687209]);
    expect(oracleErrorBound(0.9020656184687209, enc.root)).toBeLessThan(1e-12);
  });

  it('self-test оракула: субнормальные ln(w/z) enclosure накрывает ln 2', () => {
    // w = 2e-320, z = 1e-320 — субнормальные doubles; w = 2·z битово,
    // точное w/z = 2, истинное ln(w/z) = ln 2 ( центр воспроизводит его
    // без отклонения ). Enclosure обязан НАКРЫТЬ значение, а не быть
    // узким: при |z| ~ 1e-320 пол TS_MIN_R = 2^-1074 доминирует над
    // |z|·2^-100 ( произведение underflow'ится в 0 ). Механизм полуширины
    // при направленном округлении наружу: ball() округляет пол вверх дважды
    // ( nextUp( addUp( 0, floor ) ) = 3·2^-1074 ), радиус частного
    // ~ ( 1 + w/z )·3·2^-1074/|z|, редукция логарифма делит его ещё на 2:
    // r ~ 4.5·( 2^-1074/|z| ). Наблюдено в CI: 2.235370459361875e-3 =
    // 4.52·( 2^-1074/1e-320 ). Порог 3e-3 = 6.07·( 2^-1074/1e-320 ) выведен
    // из механизма ( запас ~34% ), НЕ подогнан под наблюдение.
    // На scalar TPD это НЕ влияет: вклад w_i·ln(w_i/z_i) масштабируется
    // w_i ~ 1e-320 ( сценарий subnormal: eTpd ~ 1.4e-27 ).
    const sub = oracleLnRatio(2e-320, 1e-320);
    const center = oracleCenter(sub);
    expect(Math.abs(center - Math.LN2)).toBeLessThan(1e-14);
    expect(sub.r).toBeLessThan(3e-3);
    // Направленное округление наружу: истинное ln 2 внутри enclosure.
    expect(center - sub.r).toBeLessThanOrEqual(Math.LN2);
    expect(center + sub.r).toBeGreaterThanOrEqual(Math.LN2);
  });

  // --- 3.1b. Adversarial: направленные округления ( outwards ) -----------

  it('adversarial A.6: nextUp/nextDown — ±0, субнормали, границы, NaN/Infinity', () => {
    // Проверенные nextUp/nextDown для IEEE-754 binary64: битовая
    // семантика на ВСЕХ специальных значениях.
    expect(nextUp(0)).toBe(2.5e-324);
    expect(Object.is(nextUp(-0), 2.5e-324)).toBe(true);
    expect(Object.is(nextDown(0), -2.5e-324)).toBe(true);
    expect(Object.is(nextDown(-0), -2.5e-324)).toBe(true);
    // 2.5e-324 — минимальный субнормаль: nextUp даёт 2 ulp ( тот же
    // битовый шаг 2^-1074 ), nextDown даёт +0.
    expect(nextUp(2.5e-324)).toBe(2.5e-324 + 2.5e-324);
    expect(Object.is(nextDown(2.5e-324), 0)).toBe(true);
    expect(Object.is(nextUp(-2.5e-324), -0)).toBe(true);
    expect(nextUp(1)).toBe(1 + Math.pow(2, -52));
    expect(nextDown(1)).toBe(1 - Math.pow(2, -53));
    expect(nextUp(1.7976931348623157e308)).toBe(Infinity);
    expect(nextDown(1.7976931348623157e308)).toBe(1.7976931348623155e308);
    expect(nextUp(Infinity)).toBe(Infinity);
    expect(nextUp(-Infinity)).toBe(-1.7976931348623157e308);
    expect(nextDown(Infinity)).toBe(1.7976931348623157e308);
    expect(Number.isNaN(nextUp(NaN))).toBe(true);
    expect(Number.isNaN(nextDown(NaN))).toBe(true);
    // Монотонность: обход 3000 субнормалей от 2^-1074 вверх.
    let x = 2.5e-324;
    for (let i = 0; i < 3000; i += 1) {
      const up = nextUp(x);
      if (!(up > x)) {
        throw new Error(`nextUp не монотонен в субнормалях: i=${String(i)}`);
      }
      const dn = nextDown(x);
      if (x === 2.5e-324) {
        if (dn !== 0) {
          throw new Error('nextDown(2^-1074) обязан быть +0');
        }
      } else if (!(dn < x)) {
        throw new Error(`nextDown не монотонен в субнормалях: i=${String(i)}`);
      }
      x = up;
    }
    for (const v of [1.5, 0.1, 123.456, 6.02e23, 1e-9, -3.7, -1e-30, 2.2250738585072014e-308]) {
      if (!(nextUp(v) > v) || !(nextDown(v) < v)) {
        throw new Error(`nextUp/nextDown не монотонны в ${String(v)}`);
      }
    }
  });

  it('adversarial A.6: контрольный контрпример tsAddB — сумма радиусов округлена наружу', () => {
    // Точная сумма 1e-15 + 9.860761315262648e-32 строго больше 1e-15,
    // но binary64 округляет её к ближайшему ВНИЗ до 1e-15. При нулевом
    // центре ballWiden практически ничего не добавляет. Enclosure без
    // направленного округления НЕ был бы гарантированным; теперь радиус
    // строго > 1e-15.
    const a: Ball = { c: { hi: 1, lo: 0 }, r: 1e-15 };
    const b: Ball = { c: { hi: -1, lo: 0 }, r: 9.860761315262648e-32 };
    const sum = tsAddB(a, b);
    expect(oracleCenter(sum)).toBe(0);
    expect(sum.r).toBeGreaterThan(1e-15);
    // Cancellation-вариант ( одинаковые центры ).
    const diff = tsSubB(a, { c: { hi: 1, lo: 0 }, r: 9.860761315262648e-32 });
    expect(oracleCenter(diff)).toBe(0);
    expect(diff.r).toBeGreaterThan(1e-15);
  });

  it('adversarial A.6: радиусы умножения, деления и знаменатели округлены наружу', () => {
    const mul = tsMulB({ c: { hi: 0, lo: 0 }, r: 1e-15 }, { c: { hi: 1, lo: 0 }, r: 9.860761315262648e-32 });
    expect(mul.r).toBeGreaterThan(1e-15);
    const div = tsDivB({ c: { hi: 0, lo: 0 }, r: 1e-15 }, { c: { hi: 1, lo: 0 }, r: 9.860761315262648e-32 });
    expect(div.r).toBeGreaterThan(1e-15);
    // Знаменатель, накрывающий ноль, обязан давать отказ (fail-closed).
    let threw = false;
    try {
      tsDivB(tsBall(1), { c: { hi: 0, lo: 0 }, r: 1 });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('adversarial A.6: субнормальные радиусы не исчезают при округлении', () => {
    // Пол 2^-1074: сумма/произведение/частное/масштаб радиусов не
    // могут округлиться до нуля и потерять гарантию.
    const add = tsAddB({ c: { hi: 0, lo: 0 }, r: 2.5e-324 }, { c: { hi: 0, lo: 0 }, r: 2.5e-324 });
    expect(add.r).toBeGreaterThanOrEqual(5e-324);
    const mul = tsMulB({ c: { hi: 1.1, lo: 0 }, r: 0 }, { c: { hi: 2.5e-324, lo: 0 }, r: 2.5e-324 });
    expect(mul.r).toBeGreaterThan(2.5e-324);
    const div = tsDivB({ c: { hi: 0, lo: 0 }, r: 2.5e-324 }, { c: { hi: 3, lo: 0 }, r: 0 });
    expect(div.r).toBeGreaterThan(0);
    const scaled = tsScaleB({ c: { hi: 0, lo: 0 }, r: 7.5e-324 }, 0.5);
    expect(scaled.r).toBeGreaterThanOrEqual(5e-324);
    // 1e-320 · 1e-320 = 1e-640: истинное значение 0 ( двоично );
    // enclosure обязан его накрывать.
    const tiny = tsMulB(tsBall(1e-320), tsBall(1e-320));
    expect(oracleCenter(tiny) - tiny.r).toBeLessThanOrEqual(0);
    expect(oracleCenter(tiny) + tiny.r).toBeGreaterThanOrEqual(0);
  });

  // --- 3.1c. Adversarial: независимая доказанная топология корней ---------

  it('adversarial B.7: nm1e6 — 3 действительных, 3 физических, D < 0, дизъюнктность', () => {
    const topo = isolateCo2(3343704.864302838);
    expect(topo.realRootCount).toBe(3);
    expect(topo.discriminantSign).toBe(-1);
    expect([...topo.physicalMask]).toEqual([true, true, true]);
    expect(enclosuresDisjointOrdered(topo.roots)).toBe(true);
  });

  it('adversarial B.7: смена знака на широкой скобке НЕ доказывает единственность', () => {
    // Широкая скобка [−3, 3] для nm1e6 имеет доказанную смену знака
    // f(−3) < 0 < f(3), хотя внутри ТРИ корня: смена знака сама по
    // себе недостаточна. Оракул тем не менее доказывает ровно 3
    // дизъюнктных enclosure-а — единственность каждого корня
    // доказана монотонностью участка, а не сменой знака.
    const params = oraclePureParams(
      TPD_NUMERICAL_ERROR_AUDIT_CO2,
      250,
      3343704.864302838,
      TPD_NUMERICAL_ERROR_AUDIT_R_J_PER_MOL_K
    );
    const coeffs = oracleCubicCoeffs(params.A, params.B);
    expect(ballSign(oracleCubicEval(coeffs, tsBall(-3)))).toBe(-1);
    expect(ballSign(oracleCubicEval(coeffs, tsBall(3)))).toBe(1);
    const topo = oracleIsolateRealRoots(params.A, params.B);
    expect(topo.realRootCount).toBe(3);
    expect(enclosuresDisjointOrdered(topo.roots)).toBe(true);
    for (const root of topo.roots) {
      expect(ballLo(root)).toBeGreaterThanOrEqual(-3);
      expect(ballHi(root)).toBeLessThanOrEqual(3);
    }
  });

  it('adversarial B.7: co2_1e9 — 3 действительных, только 1 физический (Z > B)', () => {
    const topo = isolateCo2(1e9);
    expect(topo.realRootCount).toBe(3);
    const physical = topo.physicalMask.filter((p) => p);
    expect(physical).toHaveLength(1);
    // Физический — наибольший корень (zb ~ 0.0617), остальные Z <= B.
    expect(topo.physicalMask[2]).toBe(true);
    expect(topo.physicalMask[0]).toBe(false);
    expect(topo.physicalMask[1]).toBe(false);
  });

  it('adversarial B.7: d0_1root — ровно 1 действительный корень за D = 0', () => {
    const topo = isolateCo2(3343704.864306194);
    expect(topo.realRootCount).toBe(1);
    expect(topo.discriminantSign).toBe(1);
    expect([...topo.physicalMask]).toEqual([true]);
  });

  it('adversarial B.7: nmedge near-merge — 3 корня, зазор enclosure-ов >> радиусов', () => {
    // Радиус у почти-кратного корня ограничен ДОКАЗУЕМОСТЬЮ знака f
    // (|f'| ~ 4e-9 при шуме ball ~1.5e-30): честный предел
    // ~1.7e-21, а не 2^-100. Разделение корней ~1.1e-8 доказано
    // дизъюнктностью enclosure-ов с зазором > 1e6·maxR.
    const topo = isolateCo2(3343704.8643061933);
    expect(topo.realRootCount).toBe(3);
    expect(enclosuresDisjointOrdered(topo.roots)).toBe(true);
    const maxR = topo.roots.reduce((acc, rb) => Math.max(acc, rb.r), 0);
    expect(maxR).toBeLessThanOrEqual(1e-20);
    const gapMid = ballLo(topo.roots[2] as Ball) - ballHi(topo.roots[1] as Ball);
    expect(gapMid).toBeGreaterThan(1e6 * maxR);
  });

  it('adversarial B.7: lowp_fail (P=0.1 Па) — оракул доказывает 3 корня, production отказ representation-допуска', () => {
    // Математически при P = 0.1 Па кубика имеет ТРИ раздельных
    // корня ( sep ~ 3.85e-9, доказанные enclosure-ы радиуса ~4e-31 );
    // production отказывает «схлопывание корней», потому что его
    // допуск различимости ( 1e-8·max(1, |z|, B) ) больше разделения.
    // Это ожидаемый production-отказ представления, НЕ отсутствие
    // трёх корней: независимая топология это фиксирует.
    const topo = isolateCo2(0.1);
    expect(topo.realRootCount).toBe(3);
    expect(topo.discriminantSign).toBe(-1);
    expect(enclosuresDisjointOrdered(topo.roots)).toBe(true);
  });

  it('adversarial B.7: сдвинутый seed не ломает изоляцию; Vieta-сверка суммы корней', () => {
    // Seed — ТОЛЬКО приближение: изоляция всегда доказывается заново.
    // Существенно сдвинутый seed ( средний production-корень + 0.5 )
    // обязан отобразиться в ближайший ДОКАЗАННЫЙ корень ( индекс 2 ),
    // а точный production-средний-корень — в средний ( индекс 1 ).
    const prodRoots = [...feedOf('nm1e6_vap').rootsAll].sort((x, y) => x - y);
    expect(prodRoots).toHaveLength(3);
    const params = oraclePureParams(
      TPD_NUMERICAL_ERROR_AUDIT_CO2,
      250,
      3343704.864302838,
      TPD_NUMERICAL_ERROR_AUDIT_R_J_PER_MOL_K
    );
    const topo = oracleIsolateRealRoots(params.A, params.B);
    const encShifted = oracleEncloseRoot(params.A, params.B, (prodRoots[1] as number) + 0.5, prodRoots);
    expect(encShifted.index).toBe(2);
    const ref = topo.roots[encShifted.index] as Ball;
    // Тот же certified enclosure, что в независимой изоляции.
    expect(oracleCenter(encShifted.root)).toBe(oracleCenter(ref));
    expect(encShifted.root.r).toBe(ref.r);
    const encMid = oracleEncloseRoot(params.A, params.B, prodRoots[1] as number, prodRoots);
    expect(encMid.index).toBe(1);
    // Vieta: сумма трёх доказанных корней накрывает 1 − B.
    const sumLo =
      ballLo(topo.roots[0] as Ball) + ballLo(topo.roots[1] as Ball) + ballLo(topo.roots[2] as Ball);
    const sumHi =
      ballHi(topo.roots[0] as Ball) + ballHi(topo.roots[1] as Ball) + ballHi(topo.roots[2] as Ball);
    expect(sumLo).toBeLessThanOrEqual(1 - ballLo(params.B));
    expect(sumHi).toBeGreaterThanOrEqual(1 - ballHi(params.B));
  });

  // --- 3.2. Итоговая статистика -----------------------------------------

  it('summary: 44 сценария; 40 audited; 4 expected failure; 0 unexpected; 0 inconclusive', () => {
    const s = report.summary;
    expect(s.scenarioCount).toBe(44);
    expect(s.auditedCount).toBe(40);
    expect(s.expectedFailures.map((f) => f.id).sort()).toEqual([
      'highzb_1e14',
      'highzb_1e3',
      'lowp_fail',
      'support_violation'
    ]);
    expect(s.unexpectedFailures).toHaveLength(0);
    expect(s.oracleInconclusive).toHaveLength(0);
  });

  it('глобальные границы ошибки: eZ <= 2e-9, eLnPhi <= 1e-6, eTpd <= 1e-6', () => {
    expect(report.summary.maxEz).toBeLessThanOrEqual(2e-9);
    expect(report.summary.maxELnPhi).toBeLessThanOrEqual(1e-6);
    expect(report.summary.maxETpd).toBeLessThanOrEqual(1e-6);
  });

  it('радиусы enclosure-ов: rZ <= 5e-21, rLnPhi <= 1e-19, rTpd <= 2e-19', () => {
    // Радиусы — чистые oracle-величины ( детерминированный TS-код,
    // без платформенных функций ): сужение против прежней ревизии
    // обеспечено DD-бисекцией до 2^-100 и probe-сериями вместо
    // двойной точности; предел у near-merge задаётся доказуемостью
    // знака ( см. adversarial B.7 nmedge ).
    let maxRz = 0;
    let maxRLnPhi = 0;
    let maxRTpd = 0;
    for (const r of report.results) {
      if (r.status !== 'audited') {
        continue;
      }
      for (const s of [r.feed, r.trial]) {
        if (s === undefined) {
          continue;
        }
        maxRz = Math.max(maxRz, s.rZ);
        maxRLnPhi = Math.max(maxRLnPhi, ...s.rLnPhi);
      }
      if (r.tpd !== undefined) {
        maxRTpd = Math.max(maxRTpd, r.tpd.rTpd);
      }
    }
    expect(maxRz).toBeLessThanOrEqual(5e-21);
    expect(maxRLnPhi).toBeLessThanOrEqual(1e-19);
    expect(maxRTpd).toBeLessThanOrEqual(2e-19);
  });

  // --- 3.3. Identity и общая TPD-граница ---------------------------------

  it('identity: 18 сценариев, TPD(z; z) = ровно +0', () => {
    const identities = report.results.filter((r) => r.feed !== undefined && r.trial === undefined);
    expect(identities).toHaveLength(18);
    for (const r of identities) {
      const t = r.tpd;
      if (t === undefined) {
        throw new Error(`identity «${r.id}»: отсутствует TPD-измерение`);
      }
      if (!Object.is(t.tpd, 0)) {
        throw new Error(`identity «${r.id}»: TPD(z;z) = ${String(t.tpd)}, ожидался ровно +0`);
      }
    }
  });

  it('eTpd <= 1e-14 для всех audited сценариев кроме lowp1_cross', () => {
    const offenders: string[] = [];
    for (const r of report.results) {
      if (r.status !== 'audited' || r.tpd === undefined) {
        continue;
      }
      if (r.id !== 'lowp1_cross' && r.tpd.eTpd > 1e-14) {
        offenders.push(`${r.id}: eTpd = ${String(r.tpd.eTpd)}`);
      }
    }
    expect(offenders).toHaveLength(0);
  });

  // --- 3.4. Топология корней ---------------------------------------------

  it('топология: все audited узлы — topologyMatch=true, доказанный знак D, счёт корней 1/3', () => {
    for (const r of report.results) {
      if (r.status !== 'audited') {
        continue;
      }
      for (const s of [r.feed, r.trial]) {
        if (s === undefined) {
          continue;
        }
        if (s.topologyMatch !== true) {
          throw new Error(`«${r.id}»: независимая топология разошлась с production`);
        }
        if (s.oracleRealRootCount !== 1 && s.oracleRealRootCount !== 3) {
          throw new Error(`«${r.id}»: недоказанное число корней`);
        }
        if (s.oracleDiscriminantSign === 0) {
          throw new Error(`«${r.id}»: знак дискриминанта не доказан`);
        }
      }
    }
  });

  it('near-merge серия: 3 корня, eZ <= 2e-9, eLnPhi <= 1e-14', () => {
    for (const id of ['nm1e4_vap', 'nm1e6_vap', 'nm1e7_vap', 'nmedge_vap']) {
      const f = feedOf(id);
      expect(f.rootCount).toBe(3);
      expect(f.oracleRealRootCount).toBe(3);
      expect(f.oraclePhysicalRootCount).toBe(3);
      expect(f.eZtotal).toBeLessThanOrEqual(2e-9);
      expect(f.eLnPhiMax).toBeLessThanOrEqual(1e-14);
    }
  });

  it('nmedge: minSep в (1e-8, 1.2e-8) — последняя 3-корневая точка', () => {
    const m = feedOf('nmedge_vap').minSep;
    if (m === null) {
      throw new Error('nmedge_vap: minSep не должен быть null при 3 корнях');
    }
    expect(m).toBeGreaterThan(1e-8);
    expect(m).toBeLessThan(1.2e-8);
  });

  it('d0_1root: ровно 1 физический корень за границей D=0', () => {
    const f = feedOf('d0_1root');
    expect(f.rootCount).toBe(1);
    expect(f.oracleRealRootCount).toBe(1);
    expect(f.oracleDiscriminantSign).toBe(1);
  });

  it('single-root группы: 1 корень (сверхкритично, высокие P)', () => {
    for (const id of ['n2_supercrit', 'mix_1e7', 'co2_1e9']) {
      expect(feedOf(id).rootCount).toBe(1);
    }
    // co2_1e9: production отдаёт 1 физический корень; оракул
    // независимо доказывает: действительных ТРИ, физических ОДИН
    // ( остальные Z <= B ) — представление production корректно.
    const c = feedOf('co2_1e9');
    expect(c.oracleRealRootCount).toBe(3);
    expect(c.oraclePhysicalRootCount).toBe(1);
    // n2dom_1e9 и trange-группы: доказанно ровно 1 действительный.
    expect(feedOf('n2dom_1e9').oracleRealRootCount).toBe(1);
    for (const id of ['t228', 't273', 't250z50', 't250z005']) {
      expect(feedOf(id).rootCount).toBe(1);
      expect(feedOf(id).oracleRealRootCount).toBe(1);
      expect(feedOf(id).oraclePhysicalRootCount).toBe(1);
    }
  });

  it('highzb_1e3: production fail-closed (phi = exp(lnPhi ~ 970) переполняет binary64) -> ожидаемый numerical_failure', () => {
    // Тот же phi-overflow fail-closed guard, что и highzb_1e14: при P = 7.6e10 Pa
    // (T = 250 K, чистый CO2) lnPhi ~ 969.96, поэтому phi_i = exp(ln(phi_i))
    // переполняет binary64 и фасад возвращает numerical_failure. Расхождение
    // найдено полной симуляцией провайдера против run A dump (subset-проверка
    // эту точку не покрывала). Сценарий НЕ входит в audited-домен: per-point
    // enclosure существует только на уровне числовой цепочки (dump), НЕ как
    // production-выход. Матрица фиксирует это как ОЖИДАЕМЫЙ отказ контракта.
    const r = scenario('highzb_1e3');
    expect(r.status).toBe('expected_failure');
    expect(r.feedFailure).toBe('numerical_failure');
    expect(r.feed).toBeUndefined();
    expect(r.tpd).toBeUndefined();
  });

  it('highzb_1e14: production fail-closed (phi = exp(lnPhi ~ 1.28e6) переполняет binary64) -> ожидаемый numerical_failure', () => {
    // Production-контракт Stage 4.4.4.3 отказывает ВЕСЬ расчёт состояния,
    // когда phi_i = exp(ln(phi_i)) неконечен (fail-closed guard), поэтому
    // при P = 1e14 Pa (lnPhi ~ 1.28e6) фасад возвращает numerical_failure.
    // Сценарий НЕ входит в audited-домен: per-point enclosure этого узла
    // существует только на уровне числовой цепочки (run A/B dump), НЕ как
    // production-выход. Матрица фиксирует это как ОЖИДАЕМЫЙ отказ контракта.
    const r = scenario('highzb_1e14');
    expect(r.status).toBe('expected_failure');
    expect(r.feedFailure).toBe('numerical_failure');
    expect(r.feed).toBeUndefined();
    expect(r.tpd).toBeUndefined();
  });

  it('lowp1_liq: 3 корня, eZ <= 1e-10, eLnPhi <= 1e-6 (низко-P near-merge без усиления)', () => {
    const f = feedOf('lowp1_liq');
    expect(f.rootCount).toBe(3);
    expect(f.oracleRealRootCount).toBe(3);
    expect(f.eZtotal).toBeLessThanOrEqual(1e-10);
    expect(f.eLnPhiMax).toBeLessThanOrEqual(1e-6);
  });

  it('lowp1_vap: eLnPhiMax <= 1e-20 (vapor-ветвь при P=1 Па)', () => {
    expect(feedOf('lowp1_vap').eLnPhiMax).toBeLessThanOrEqual(1e-20);
  });

  it('trange: 1 корень во всех четырёх точках диапазона применимости kij', () => {
    for (const id of ['t228', 't273', 't250z50', 't250z005']) {
      expect(feedOf(id).rootCount).toBe(1);
    }
  });

  // --- 3.5. Знак TPD и cancellation --------------------------------------

  it('zero_hi / zero_lo: |tpd| < 1e-14, знак НЕ определён (зона шума)', () => {
    const hi = tpdOf('zero_hi');
    const lo = tpdOf('zero_lo');
    expect(hi.tpd).toBeGreaterThan(0);
    expect(hi.tpd).toBeLessThan(1e-14);
    expect(hi.signDetermined).toBe(false);
    expect(lo.tpd).toBeLessThan(0);
    expect(lo.tpd).toBeGreaterThan(-1e-14);
    expect(lo.signDetermined).toBe(false);
  });

  it('near-серия: 1e9p/1e9n — шум; 1e7/1e6/1e3 — знак определён', () => {
    const p9 = tpdOf('near_1e9p');
    const n9 = tpdOf('near_1e9n');
    expect(Math.abs(p9.tpd)).toBeLessThan(1e-15);
    expect(p9.signDetermined).toBe(false);
    expect(Math.abs(n9.tpd)).toBeLessThan(1e-15);
    expect(n9.signDetermined).toBe(false);
    const m7 = tpdOf('near_1e7');
    expect(m7.tpd).toBeGreaterThan(0);
    expect(m7.tpd).toBeLessThan(1e-11);
    expect(m7.signDetermined).toBe(true);
    const m6 = tpdOf('near_1e6');
    expect(m6.tpd).toBeGreaterThan(0);
    expect(m6.tpd).toBeLessThan(1e-9);
    expect(m6.signDetermined).toBe(true);
    const m3 = tpdOf('near_1e3');
    expect(m3.tpd).toBeGreaterThan(1e-5);
    expect(m3.signDetermined).toBe(true);
  });

  it('subnormal: 0 < tpd < 5e-320, знак не определён (субнормальный вклад)', () => {
    const s = tpdOf('subnormal');
    expect(s.tpd).toBeGreaterThan(0);
    expect(s.tpd).toBeLessThan(5e-320);
    expect(s.signDetermined).toBe(false);
  });

  // --- 3.6. Cross-сценарии ------------------------------------------------

  it('cross: побитовая антисимметрия mix-пар; эталонное значение cross_pure', () => {
    const liqFeed = tpdOf('cross_mix_liqfeed').tpd;
    const vapFeed = tpdOf('cross_mix_vapfeed').tpd;
    expect(liqFeed).toBe(-vapFeed);
    expect(tpdOf('cross_pure').tpd).toBeCloseTo(-0.4780889274888209, 12);
  });

  it('nmedge_cross: tpd в (0.41, 0.42)', () => {
    const v = tpdOf('nmedge_cross').tpd;
    expect(v).toBeGreaterThan(0.41);
    expect(v).toBeLessThan(0.42);
  });

  it('lowp1_cross: tpd < -14, eTpd <= 1e-6, |tpd| > 1e6·eTpd, знак определён', () => {
    const t = tpdOf('lowp1_cross');
    expect(t.tpd).toBeLessThan(-14);
    expect(t.eTpd).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(t.tpd)).toBeGreaterThan(1e6 * t.eTpd);
    expect(t.signDetermined).toBe(true);
  });

  // --- 3.7. Support и ожидаемые отказы -------------------------------------

  it('support: co2only > 0, n2only > 2', () => {
    expect(tpdOf('support_co2only').tpd).toBeGreaterThan(0);
    expect(tpdOf('support_n2only').tpd).toBeGreaterThan(2);
  });

  it('lowp_fail: expected_failure (схлопывание корней), без измерений', () => {
    const r = scenario('lowp_fail');
    expect(r.status).toBe('expected_failure');
    if (r.feedFailure === undefined) {
      throw new Error('lowp_fail: ожидалась метка отказа feed-состояния');
    }
    expect(r.feedFailure).toContain('схлопывани');
    expect(r.feed).toBeUndefined();
    expect(r.tpd).toBeUndefined();
  });

  it('support_violation: expected_failure, состояния вычислены, TPD отсутствует', () => {
    const r = scenario('support_violation');
    expect(r.status).toBe('expected_failure');
    if (r.tpdFailure === undefined) {
      throw new Error('support_violation: ожидалась метка отказа TPD');
    }
    expect(r.tpdFailure).toContain('support_violation');
    expect(r.feed).toBeDefined();
    expect(trialOf('support_violation')).toBeDefined();
    expect(r.tpd).toBeUndefined();
  });

  // --- 3.8. Выгрузка дампа --------------------------------------------------

  // Полный отчёт аудита (production-echo + oracle-enclosure для всех
  // 44 сценариев): вход для независимой перекрёстной проверки и таблицы
  // docs/science/TPD_NUMERICAL_ERROR_AUDIT.md. Каталог не отслеживается git.
  afterAll(() => {
    mkdirSync('benchmark-artifacts', { recursive: true });
    const payload = {
      generator:
        'evowars Stage 4.4.4.4.1-A — численный аудит ошибок PR → lnPhi → scalar TPD ' +
        '(CI: production-фасады + независимый double-double/ball оракул)',
      consumer:
        'docs/science/TPD_NUMERICAL_ERROR_AUDIT.md (per-scenario таблица); ' +
        'независимый replay-провайдер может воспроизвести harness по этому дампу',
      validationSemantics: {
        oracle:
          'независимая реализация PR/TPD с enclosure-границами: double-double центры, ' +
          'радиусы с направленным округлением наружу (проверенные nextUp/nextDown binary64), ' +
          'независимо доказанная топология корней (интервальный знак дискриминанта, ' +
          'монотонные участки, сертифицированная бисекция), логарифм без платформенного ' +
          'Math.log2 (точное извлечение экспоненты), sqrt через доказанную невязку y² − x; ' +
          'production PR/TPD runtime не импортируется',
        scope:
          'измеряется численная ошибка ВЫЧИСЛЕНИЙ при заданных входах; это НЕ физическая ' +
          'неопределённость EOS/BIP-данных и НЕ валидация PR как физической модели',
        evidence:
          'evidence-статусы каталогов Stage 4.4.4.1/4.4.4.3 не пересматриваются аудитом'
      },
      validatedErrorBoundStatus: {
        continuum: 'not_established',
        discreteMatrix:
          'per-point validated enclosure (40 audited сценариев матрицы; границы построены ' +
          'направленным округлением наружу nextUp/nextDown, топология корней каждого узла ' +
          '(число действительных/физических) доказана независимо интервальным знаком ' +
          'дискриминанта, монотонными участками и сертифицированной бисекцией, с учётом корней ' +
          'Z <= B; highzb_1e3 и highzb_1e14 — ожидаемые production-отказы numerical_failure: ' +
          'phi = exp(lnPhi ~ 970 / ~1.28e6) переполняет binary64, fail-closed guard; ' +
          'per-point enclosure этих узлов существует только на уровне числовой цепочки ' +
          '(run A/B dump), не как production-выход)'
      },
      report
    };
    writeFileSync(
      'benchmark-artifacts/tpd-numerical-error-audit-dump.json',
      JSON.stringify(payload, null, 2) + '\n',
      'utf8'
    );
  });
});
