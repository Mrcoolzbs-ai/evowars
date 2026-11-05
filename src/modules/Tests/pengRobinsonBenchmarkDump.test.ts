// ============================================
// PENG–ROBINSON — дамп контрольных точек для независимого benchmark
// ============================================
//
// Stage 4.4.4.2.2. Этот файл НЕ является самостоятельной проверкой
// корректности: он фиксирует (1) контрольные точки Stage 4.4.4.2 из
// каталога через фасад Data, (2) сетку A0±delta границы дискриминанта
// кубики и (3) фабрику математически ТОЧНОГО двойного корня
// (A = 49/128, B = 1/16), а затем записывает их значения в JSON-дамп
// benchmark-artifacts/peng-robinson-ts-dump.json (рабочая директория
// запуска vitest — тот же паттерн, что у golden-baseline теста).
//
// Дамп потребляется НЕЗАВИСИМЫМ оракулом scripts/benchmarks/
// peng_robinson_coolprop.py (CoolProp 8.0.0, backend 'PR', и
// высокоточная mpmath-реализация), который выполняется отдельным
// GitHub Actions workflow (.github/workflows/
// peng-robinson-benchmark.yml) и НЕ входит в runtime-зависимости
// TypeScript-приложения.
//
// Значения в дампе — выход СОБСТВЕННОЙ реализации (фасад ->
// Core/pengRobinson.ts): они служат входом сравнения, а не
// эталоном. Файл ведёт себя как обычный модульный тест (проверки
// успех/предупреждения/структура) и пишет дамп в каталог
// benchmark-artifacts, не отслеживаемый git.
//
// Границы: смеси/kij/flash — Stage 4.4.4.3+ (НЕ реализованы);
// результат этого модуля не влияет на phaseProperties.ts и
// solveEquilibrium.

import { describe, it, expect, afterAll } from 'vitest';
// @ts-expect-error типы node:fs не подключены в tsconfig проекта (паттерн golden-baseline теста)
import { mkdirSync, writeFileSync } from 'node:fs';

import { computePengRobinsonPure } from '../Data/pengRobinsonFacade';
import type { PengRobinsonPureResult, PengRobinsonPureSuccess } from '../Data/pengRobinsonFacade';
import { solvePrCubicRealRoots } from '../Core/pengRobinson';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';

// ============================================
// 1. КОНТРОЛЬНЫЕ ТОЧКИ (Stage 4.4.4.2 / 4.4.4.2.2)
// ============================================

type BenchmarkGasId = 'co2' | 'n2' | 'ch4' | 'h2o' | 'ar';

interface BenchmarkPointSpec {
  readonly id: string;
  readonly gasId: BenchmarkGasId;
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: 'vapor' | 'liquid';
  readonly evidencePolicy: 'allow_partial' | 'allow_unresolved_cross_check';
  /** Коды предупреждений, которые ОБЯЗАНЫ присутствовать. */
  readonly mustWarn: readonly string[];
  /** Коды предупреждений, которых быть НЕ ДОЛЖНО. */
  readonly mustNotWarn: readonly string[];
}

// Семь контрольных точек независимого benchmark (§4 задачи 4.4.4.2.1):
// 1-2) CO2 250 K, 2 MPa — обе математические ветви (T < Tc, P > Psat:
//      сжатая жидкость, три действительных корня, обе ветви различимы);
// 3)   CO2 350 K, 10 MPa — сверхкритическая область, единственный корень;
// 4)   N2 400 K, 5 MPa;
// 5)   CH4 200 K, 1 MPa — ТОЛЬКО политикой allow_unresolved_cross_check
//      (конфликт omega из каталога остаётся видимым);
// 6)   H2O 800 K, 20 MPa — предупреждение об ограничениях классического
//      PR для полярного ассоциирующего компонента сохраняется;
// 7)   Ar 200 K, 1 MPa.
const BENCHMARK_POINTS: readonly BenchmarkPointSpec[] = [
  {
    id: 'co2-250K-2MPa-vapor',
    gasId: 'co2',
    temperatureK: 250,
    pressurePa: 2e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter'],
    mustNotWarn: ['single_physical_root']
  },
  {
    id: 'co2-250K-2MPa-liquid',
    gasId: 'co2',
    temperatureK: 250,
    pressurePa: 2e6,
    root: 'liquid',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter'],
    mustNotWarn: ['single_physical_root']
  },
  {
    id: 'co2-350K-10MPa-vapor',
    gasId: 'co2',
    temperatureK: 350,
    pressurePa: 1e7,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter', 'single_physical_root'],
    mustNotWarn: []
  },
  {
    id: 'n2-400K-5MPa-vapor',
    gasId: 'n2',
    temperatureK: 400,
    pressurePa: 5e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter', 'single_physical_root'],
    mustNotWarn: []
  },
  {
    id: 'ch4-200K-1MPa-vapor',
    gasId: 'ch4',
    temperatureK: 200,
    pressurePa: 1e6,
    root: 'vapor',
    evidencePolicy: 'allow_unresolved_cross_check',
    mustWarn: ['unresolved_cross_check_parameter', 'single_physical_root'],
    mustNotWarn: ['partially_verified_parameter']
  },
  {
    id: 'h2o-800K-20MPa-vapor',
    gasId: 'h2o',
    temperatureK: 800,
    pressurePa: 2e7,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter', 'single_physical_root', 'h2o_classical_pr_limitations'],
    mustNotWarn: []
  },
  {
    id: 'ar-200K-1MPa-vapor',
    gasId: 'ar',
    temperatureK: 200,
    pressurePa: 1e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter', 'single_physical_root'],
    mustNotWarn: []
  }
];

// ============================================
// 2. СЕТКА ГРАНИЦЫ ДИСКРИМИНАНТА И ТОЧНЫЙ ДВОЙНОЙ КОРЕНЬ
// ============================================
//
// Те же константы, что в Tests/pengRobinson.test.ts (граница
// дискриминанта): B = 0.01980480623881198,
// A0 = 0.13130582290421344. Точный дискриминант binary64-входов
// (A0, B) ПОЛОЖИТЕЛЕН (D/scale ~ +2.7e-16) — математически ровно
// ОДИН действительный корень 0.8802...; пара 0.05 ± 5.23e-9 i —
// комплексная. Сетка A0 ± delta покрывает обе стороны границы
// дискриминанта; дельта 0 — сами точные binary64-входы (A0, B):
// один действительный корень. Фабрика ТОЧНОГО двойного корня
// (16Z-9)(16Z-3)^2/4096 = 0 при A = 49/128 = 0.3828125,
// B = 1/16 = 0.0625: D = 0 ТОЧНО, два различимых корня 0.1875 и
// 0.5625, оба больше B. Значения A и B, ФАКТИЧЕСКИ использованные
// двойной точностью, попадают в дамп — высокоточный оракул
// (mpmath, 50 знаков) пересчитывает корни именно по этим значениям
// (as_integer_ratio — точная binary64-семантика, без потерь).
// Closeout 4.4.4.2.2 добавляет near-threshold пару (B = 2^-20,
// соседние binary64-значения A): ненулевой ТОЧНЫЙ знак дискриминанта
// внутри старой полосы порога; кейс D<0 ожидает структурный отказ
// решателя (строка дампа со статусом solverFailure и причиной).

const PR_BOUNDARY_B = 0.01980480623881198;
const PR_BOUNDARY_A0 = 0.13130582290421344;

interface BoundaryCase {
  readonly label: string;
  /** Смещение A от A0 (при незаданных absoluteA/absoluteB). */
  readonly delta: number;
  /** Точное значение A вместо A0 + delta (фабрика кратных корней). */
  readonly absoluteA?: number;
  /** Точное значение B вместо граничного B (фабрика кратных корней). */
  readonly absoluteB?: number;
  /** Ожидаемое число различимых действительных корней решателем. */
  readonly expectedRootCount: number;
  /**
   * Ожидается структурный отказ TS-решателя: точный знак дискриминанта
   * (dyadic-BigInt) доказывает заданное expectedRootCount математически
   * различимых корней, но в double они неразделимы (расщепление пары
   * много меньше зеркала дедупликации 1e-8*max(1, |z|, B)).
   */
  readonly expectRefusal?: boolean;
}

const BOUNDARY_CASES: readonly BoundaryCase[] = [
  { label: 'A0-1e-6', delta: -1e-6, expectedRootCount: 1 },
  { label: 'A0-1e-11', delta: -1e-11, expectedRootCount: 1 },
  { label: 'A0-1e-12', delta: -1e-12, expectedRootCount: 1 },
  { label: 'A0-1e-13', delta: -1e-13, expectedRootCount: 1 },
  { label: 'A0 (точные binary64-входы, D > 0)', delta: 0, expectedRootCount: 1 },
  { label: 'A0+1e-13', delta: 1e-13, expectedRootCount: 3 },
  { label: 'A0+1e-12', delta: 1e-12, expectedRootCount: 3 },
  { label: 'A0+1e-11', delta: 1e-11, expectedRootCount: 3 },
  { label: 'A0+1e-6', delta: 1e-6, expectedRootCount: 3 },
  {
    label: 'точный двойной корень (A=49/128, B=1/16)',
    delta: 0,
    absoluteA: 0.3828125,
    absoluteB: 0.0625,
    expectedRootCount: 2
  },
  {
    // Near-threshold (closeout 4.4.4.2.2): пара соседних binary64-значений
    // A вокруг границы кратного корня при B = 2^-20 (точная степень
    // двойки). Оба имеют НЕНУЛЕВОЙ точный дискриминант ВНУТРИ старой
    // полосы порога |D| <= discThreshold (DD-цепочка знак не различает,
    // dyadic-BigInt fallback различает): A+ — D/scale ~ +2.35e-27 > 0,
    // ровно ОДИН действительный корень ~0.99999984; A- — D/scale
    // ~ -1.50e-27 < 0, доказано ТРИ корня, но пара расщеплена на ~2e-14
    // — много меньше зеркала TS-дедупликации 1e-8*max(1, |z|, B),
    // поэтому решатель обязан дать структурный отказ (НЕ молчаливое
    // схлопывание и НЕ подмена пары кратным корнем). Пара подобрана
    // НЕЗАВИСИМЫМ exact-оракулом (dyadic-BigInt + mpmath 50 знаков),
    // НЕ выходом TS-решателя; оракул benchmark-а проверяет отказ
    // самостоятельно (статус solver_failure в отчёте).
    label: 'near-threshold D>0 (B=2^-20, полоса порога)',
    delta: 0,
    absoluteA: 0.0000011173004678283645,
    absoluteB: Math.pow(2, -20),
    expectedRootCount: 1
  },
  {
    label: 'near-threshold D<0 (B=2^-20, полоса порога)',
    delta: 0,
    absoluteA: 0.0000011173004678283643,
    absoluteB: Math.pow(2, -20),
    expectedRootCount: 3,
    expectRefusal: true
  }
];

// ============================================
// 3. ХЕЛПЕРЫ
// ============================================

function expectPureSuccess(result: PengRobinsonPureResult): PengRobinsonPureSuccess {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`ожидался успех, получен отказ: ${JSON.stringify(result)}`);
  }
  return result;
}

function expectFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label}: ожидалось конечное число, получено ${String(value)}`);
  }
}

// Накопители строк дампа (заполняются тестами, выгружаются в afterAll).
const pointRows: Record<string, unknown>[] = [];
const boundaryRows: Record<string, unknown>[] = [];

// ============================================
// 4. ТЕСТЫ
// ============================================

describe('Stage 4.4.4.2.2: дамп контрольных точек PR для независимого benchmark', () => {
  for (const point of BENCHMARK_POINTS) {
    it(`точка ${point.id}: успех, ожидаемые предупреждения, конечные значения`, () => {
      const s = expectPureSuccess(computePengRobinsonPure({
        gasId: point.gasId,
        temperatureK: point.temperatureK,
        pressurePa: point.pressurePa,
        root: point.root,
        evidencePolicy: point.evidencePolicy
      }));

      // Структура и конечность (глубокие проверки — в pengRobinson.test.ts).
      expectFiniteNumber(s.Z, `${point.id}: Z`);
      expectFiniteNumber(s.lnPhi, `${point.id}: lnPhi`);
      expectFiniteNumber(s.phi, `${point.id}: phi`);
      expectFiniteNumber(s.fugacityPa, `${point.id}: fugacityPa`);
      expectFiniteNumber(s.dimensionlessA, `${point.id}: A`);
      expectFiniteNumber(s.dimensionlessB, `${point.id}: B`);
      expect(s.Z).toBe(s.selectedRoot);
      expect(s.Z).toBeGreaterThan(s.dimensionlessB);
      expect(s.phi).toBeGreaterThan(0);
      expect(s.fugacityPa).toBeGreaterThan(0);
      if (s.physicalRoots.length >= 2) {
        expect(s.Z).toBe(s.root === 'vapor'
          ? s.physicalRoots[s.physicalRoots.length - 1]
          : s.physicalRoots[0]);
      }

      // Предупреждения: обязательные коды присутствуют, запрещённых нет.
      const codes: readonly string[] = s.warnings.map((w) => w.code);
      for (const required of point.mustWarn) {
        if (!codes.includes(required)) {
          throw new Error(`${point.id}: ожидалось предупреждение ${required}, получено: [${codes.join(', ')}]`);
        }
      }
      for (const forbidden of point.mustNotWarn) {
        if (codes.includes(forbidden)) {
          throw new Error(`${point.id}: предупреждение ${forbidden} присутствует, но не должно: [${codes.join(', ')}]`);
        }
      }

      // Строка дампа: значения СОБСТВЕННОЙ реализации (вход для оракула).
      pointRows.push({
        id: point.id,
        gasId: s.gasId,
        formula: s.formula,
        name: s.name,
        temperatureK: s.temperatureK,
        pressurePa: s.pressurePa,
        root: s.root,
        evidencePolicy: s.evidencePolicy,
        evidence: s.evidence,
        criticalTemperatureK: s.criticalTemperatureK.value,
        criticalPressurePa: s.criticalPressurePa.value,
        acentricFactor: s.acentricFactor.value,
        kappa: s.kappa,
        alpha: s.alpha,
        aPaM6PerMol2: s.aPaM6PerMol2,
        bM3PerMol: s.bM3PerMol,
        dimensionlessA: s.dimensionlessA,
        dimensionlessB: s.dimensionlessB,
        Z: s.Z,
        lnPhi: s.lnPhi,
        phi: s.phi,
        fugacityPa: s.fugacityPa,
        rhoMolar: s.pressurePa / (s.Z * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * s.temperatureK),
        realRoots: [...s.realRoots],
        physicalRoots: [...s.physicalRoots],
        warningCodes: codes
      });
    });
  }

  it('граница дискриминанта: сетка A0±delta и фабрика точного двойного корня', () => {
    for (const testCase of BOUNDARY_CASES) {
      const a = testCase.absoluteA ?? PR_BOUNDARY_A0 + testCase.delta;
      const b = testCase.absoluteB ?? PR_BOUNDARY_B;
      const result = solvePrCubicRealRoots(a, b);
      if (testCase.expectRefusal === true) {
        // Обоснованный структурный отказ: точный знак (dyadic-BigInt)
        // доказывает expectedRootCount математически различимых корней,
        // но пара неразличима в double (расщепление ниже зеркала
        // дедупликации) — решатель обязан отказаться, а НЕ схлопывать
        // корни молча и НЕ подменять пару кратным корнем. Отказ
        // попадает в дамп с явным статусом solver_failure; независимый
        // оракул benchmark-а проверяет его обоснованность САМ
        // (точный знак дискриминанта, число корней и расщепление).
        if (result.ok) {
          throw new Error(
            `${testCase.label}: ожидался структурный отказ (пара корней ` +
            `неразличима в double), получены корни: [${result.roots.join(', ')}]`
          );
        }
        expect(result.reason).toContain('дедупликац');
        expect(result.reason).toContain('3');
        boundaryRows.push({
          label: testCase.label,
          delta: testCase.delta,
          A: a,
          B: b,
          expectedRootCount: testCase.expectedRootCount,
          rootCount: 0,
          roots: [] as number[],
          solverFailure: true,
          reason: result.reason
        });
        continue;
      }
      if (!result.ok) {
        throw new Error(`${testCase.label}: решатель отказал: ${result.reason}`);
      }
      if (result.roots.length !== testCase.expectedRootCount) {
        throw new Error(
          `${testCase.label}: ожидалось ${testCase.expectedRootCount} различимых корней, ` +
          `получено ${result.roots.length}: [${result.roots.join(', ')}]`
        );
      }
      for (const z of result.roots) {
        expectFiniteNumber(z, `${testCase.label}: корень`);
      }
      boundaryRows.push({
        label: testCase.label,
        delta: testCase.delta,
        A: a,
        B: b,
        rootCount: result.roots.length,
        roots: [...result.roots]
      });
    }
    expect(boundaryRows).toHaveLength(BOUNDARY_CASES.length);
  });

  // Выгрузка дампа: безусловная запись в benchmark-artifacts/
  // (рабочая директория vitest — паттерн golden-baseline теста);
  // каталог не отслеживается git, в CI файл существует только в
  // workspace раннера.
  afterAll(() => {
    mkdirSync('benchmark-artifacts', { recursive: true });
    const payload = {
      generator: 'evowars Stage 4.4.4.2.2 — TS-дамп контрольных точек PR и сетки границы дискриминанта',
      consumer: 'scripts/benchmarks/peng_robinson_coolprop.py (CoolProp 8.0.0, backend PR; mpmath)',
      universalGasConstantJPerMolK: UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K,
      omegaA: 0.45724,
      omegaB: 0.0778,
      points: pointRows,
      boundary: {
        B: PR_BOUNDARY_B,
        A0: PR_BOUNDARY_A0,
        note: 'дельта 0 — точные binary64-входы A0/B: положительный дискриминант, один действительный корень; кейс 49/128 и 1/16 — математически точный двойной корень (D = 0); near-threshold пара (B=2^-20) — ненулевой точный дискриминант внутри старой полосы порога: D>0 — один корень, D<0 — доказано три корня, но пара неразличима в double, TS-решатель даёт структурный отказ (строка со solverFailure: true и reason; оракул проверяет отказ независимо)',
        cases: boundaryRows
      }
    };
    writeFileSync('benchmark-artifacts/peng-robinson-ts-dump.json',
      JSON.stringify(payload, null, 2) + '\n', 'utf8');
  });
});
