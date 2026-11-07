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
  oracleCenter,
  oracleEncloseRoot,
  oracleErrorBound,
  oracleLnRatio,
  oraclePureParams
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

// ============================================
// 3. ТЕСТЫ
// ============================================

describe('Stage 4.4.4.4.1-A: численный аудит ошибок PR → lnPhi → scalar TPD', () => {
  // --- 3.1. Self-test независимого оракула ------------------------------

  it('self-test оракула: enclosure-валидность базовых операций', () => {
    // ln(8) = 3·ln(2) в центрах оракула: серия редукции согласована
    // (аномалия старого прототипа 4.8e-16 исключена).
    expect(report.selfTest.ln8_vs_3ln2).toBeLessThan(1e-16);
    expect(report.selfTest.log3_bound).toBeLessThan(3e-16);
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
    const sub = oracleLnRatio(2e-320, 1e-320);
    expect(Math.abs(oracleCenter(sub) - Math.LN2)).toBeLessThan(1e-14);
    expect(sub.r).toBeLessThan(1e-14);
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

  it('near-merge серия: 3 корня, eZ <= 2e-9, eLnPhi <= 1e-14', () => {
    for (const id of ['nm1e4_vap', 'nm1e6_vap', 'nm1e7_vap', 'nmedge_vap']) {
      const f = feedOf(id);
      expect(f.rootCount).toBe(3);
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
    expect(feedOf('d0_1root').rootCount).toBe(1);
  });

  it('single-root группы: 1 корень (сверхкритично, высокие P)', () => {
    for (const id of ['n2_supercrit', 'mix_1e7', 'co2_1e9']) {
      expect(feedOf(id).rootCount).toBe(1);
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
          'независимая реализация PR/TPD с enclosure-границами (double-double центры, ' +
          'консервативные радиусы); production PR/TPD runtime не импортируется',
        scope:
          'измеряется численная ошибка ВЫЧИСЛЕНИЙ при заданных входах; это НЕ физическая ' +
          'неопределённость EOS/BIP-данных и НЕ валидация PR как физической модели',
        evidence:
          'evidence-статусы каталогов Stage 4.4.4.1/4.4.4.3 не пересматриваются аудитом'
      },
      validatedErrorBoundStatus: {
        continuum: 'not_established',
        discreteMatrix:
          'per-point validated enclosure (40 audited сценариев матрицы; ' +
          'highzb_1e3 и highzb_1e14 — ожидаемые production-отказы numerical_failure: ' +
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
