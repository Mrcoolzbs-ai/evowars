// ============================================
// PENG–ROBINSON — дамп СМЕСЕВЫХ контрольных точек для независимого
// benchmark (Stage 4.4.4.3)
// ============================================
//
// Этот файл НЕ является самостоятельной проверкой корректности: он
// фиксирует смесевые контрольные точки (каталог 4.4.4.1 + каталог kij
// 4.4.4.3 через фасад Data) и записывает значения СОБСТВЕННОЙ
// реализации в JSON-дамп benchmark-artifacts/
// peng-robinson-mixture-ts-dump.json (рабочая директория vitest — тот
// же паттерн, что у pengRobinsonBenchmarkDump.test.ts).
//
// Дамп потребляется НЕЗАВИСИМЫМ оракулом scripts/benchmarks/
// peng_robinson_coolprop.py (аргумент --mixtures): CoolProp 8.0.0
// backend 'PR' с ВВЕДЁННЫМИ каталожными kij
// (set_binary_interaction_double) и mpmath-реализация правил смешения
// (50 знаков). ЧЕСТНАЯ СЕМАНТИКА: CoolProp НЕ содержит собственных
// значений kij (документация Cubics: «does not come with any values
// for the kij parameter»), поэтому оракул ВАЛИДИРУЕТ РЕАЛИЗАЦИЮ
// (правила смешения, кубику, phi_i) при одинаковых kij — он НЕ
// является независимым подтверждением ЗНАЧЕНИЙ kij (те остаются
// PARTIALLY_VERIFIED по provenance каталога).
//
// Границы: flash, VLE/LLE, фазовая устойчивость — НЕ реализованы;
// выбор ветви — математический, не доказательство устойчивости фазы.

import { describe, it, expect, afterAll } from 'vitest';
// @ts-expect-error типы node:fs не подключены в tsconfig проекта (паттерн golden-baseline теста)
import { mkdirSync, writeFileSync } from 'node:fs';

import { computePengRobinsonMixtureFromCatalog } from '../Data/pengRobinsonMixtureFacade';
import type {
  PengRobinsonMixtureCatalogResult,
  PengRobinsonMixtureCatalogSuccess
} from '../Data/pengRobinsonMixtureFacade';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';

// ============================================
// 1. СМЕСЕВЫЕ КОНТРОЛЬНЫЕ ТОЧКИ
// ============================================

interface MixturePointSpec {
  readonly id: string;
  /** Состав в каноническом (лексикографическом) порядке gasId. */
  readonly composition: readonly { gasId: string; moleFraction: number }[];
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: 'vapor' | 'liquid';
  readonly evidencePolicy: 'allow_partial' | 'allow_unresolved_cross_check';
  /** Коды предупреждений, которые ОБЯЗАНЫ присутствовать. */
  readonly mustWarn: readonly string[];
}

// Пять смесевых точек (все kij — из каталога 4.4.4.3, пары с
// положительными долями обеих компонентов):
// 1) co2 + n2 250 K / 2 MPa — пара Okoro 2024 (диапазон применимости
//    228.15–273.15 K, точка внутри);
// 2) co2 + ar 250 K / 2 MPa — пара Okoro 2024;
// 3) n2 + ar 150 K / 5 MPa — пара Köster 2018 (диапазон null);
// 4) n2 + h2o 400 K / 5 MPa — пара Köster 2018; предупреждение об
//    ограничениях классического PR для H2O обязательно;
// 5) co2 + n2 + ar 250 K / 2 MPa — тернарная (все три пары available).
const MIXTURE_POINTS: readonly MixturePointSpec[] = [
  {
    id: 'co2-n2-250K-2MPa-vapor',
    composition: [
      { gasId: 'co2', moleFraction: 0.7 },
      { gasId: 'n2', moleFraction: 0.3 }
    ],
    temperatureK: 250,
    pressurePa: 2e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter', 'partially_verified_binary_interaction']
  },
  {
    id: 'co2-ar-250K-2MPa-vapor',
    composition: [
      { gasId: 'ar', moleFraction: 0.05 },
      { gasId: 'co2', moleFraction: 0.95 }
    ],
    temperatureK: 250,
    pressurePa: 2e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter', 'partially_verified_binary_interaction']
  },
  {
    id: 'n2-ar-150K-5MPa-vapor',
    composition: [
      { gasId: 'ar', moleFraction: 0.5 },
      { gasId: 'n2', moleFraction: 0.5 }
    ],
    temperatureK: 150,
    pressurePa: 5e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter', 'partially_verified_binary_interaction']
  },
  {
    id: 'n2-h2o-400K-5MPa-vapor',
    composition: [
      { gasId: 'h2o', moleFraction: 0.1 },
      { gasId: 'n2', moleFraction: 0.9 }
    ],
    temperatureK: 400,
    pressurePa: 5e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: [
      'partially_verified_parameter',
      'partially_verified_binary_interaction',
      'h2o_classical_pr_limitations'
    ]
  },
  {
    id: 'co2-n2-ar-250K-2MPa-vapor',
    composition: [
      { gasId: 'ar', moleFraction: 0.1 },
      { gasId: 'co2', moleFraction: 0.6 },
      { gasId: 'n2', moleFraction: 0.3 }
    ],
    temperatureK: 250,
    pressurePa: 2e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    mustWarn: ['partially_verified_parameter', 'partially_verified_binary_interaction']
  }
];

// Точки ТОЧНОГО НУЛЕВОГО ПРЕДЕЛА a_mix (Stage 4.4.4.3.1): N2,
// 1 МПа, два соседних binary64-значения T. При T = 1388.2195230363366 K
// alpha(T) вычисляется в binary64 РОВНО в 0 (a_i = a_mix = S_i =
// A_mix = 0, b_mix > 0, B_mix > 0) — ln(phi_i) вычисляется ТОЧНОЙ
// предельной формой (b_i/b_mix)*(Z-1) - ln(Z-B_mix); при
// T = 1388.2195230363363 K (1 ulp ниже) alpha = 1.232595164407831e-32 —
// общий путь (проверка отсутствия epsilon-переключения). Оба случая —
// вход для независимых оракулов: CoolProp проверяет ту же ветвь gas
// (при отказе точку фиксирует причину БЕЗ подмены собственным
// расчётом), mpmath (50 знаков, точные binary64-входы через
// as_integer_ratio) — точный предел: в точной арифметике alpha нулю
// не равен (нулевой alpha — артефакт округления binary64), и
// сходимость Z/ln(phi)/phi/f к значениям TS подтверждает корректность
// предельной формы.
const ZERO_ATTRACTION_POINTS: readonly {
  readonly id: string;
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly expectExactZero: boolean;
  readonly note: string;
}[] = [
  {
    id: 'n2-zero-attraction-1388K-1MPa-vapor',
    temperatureK: 1388.2195230363366,
    pressurePa: 1e6,
    expectExactZero: true,
    note: 'alpha = 0 ровно в binary64: ln(phi_i) точной предельной формой без члена притяжения'
  },
  {
    id: 'n2-near-zero-alpha-1388K-1MPa-vapor',
    temperatureK: 1388.2195230363363,
    pressurePa: 1e6,
    expectExactZero: false,
    note: 'alpha = 1.232595164407831e-32 (соседнее binary64-значение T): общий путь, без epsilon-переключения'
  }
];

// ============================================
// 2. ХЕЛПЕРЫ
// ============================================

function expectMixtureSuccess(
  result: PengRobinsonMixtureCatalogResult
): PengRobinsonMixtureCatalogSuccess {
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

// Накопитель строк дампа (заполняется тестами, выгружается в afterAll).
const mixtureRows: Record<string, unknown>[] = [];
// Накопитель строк нулевого предела a_mix (Stage 4.4.4.3.1).
const zeroAttractionRows: Record<string, unknown>[] = [];

// ============================================
// 3. ТЕСТЫ
// ============================================

describe('Stage 4.4.4.3: дамп смесевых контрольных точек PR', () => {
  for (const point of MIXTURE_POINTS) {
    it(`смесь ${point.id}: успех, ожидаемые предупреждения, конечные значения`, () => {
      const s = expectMixtureSuccess(computePengRobinsonMixtureFromCatalog({
        composition: point.composition,
        temperatureK: point.temperatureK,
        pressurePa: point.pressurePa,
        root: point.root,
        evidencePolicy: point.evidencePolicy
      }));

      // Структура и конечность (глубокие проверки — в
      // pengRobinsonMixture.test.ts).
      expectFiniteNumber(s.Z, `${point.id}: Z`);
      expectFiniteNumber(s.aMixPaM6PerMol2, `${point.id}: a_mix`);
      expectFiniteNumber(s.bMixM3PerMol, `${point.id}: b_mix`);
      expectFiniteNumber(s.dimensionlessA, `${point.id}: A_mix`);
      expectFiniteNumber(s.dimensionlessB, `${point.id}: B_mix`);
      expect(s.Z).toBe(s.selectedRoot);
      expect(s.Z).toBeGreaterThan(s.dimensionlessB);
      for (const c of s.components) {
        expectFiniteNumber(c.lnPhi, `${point.id}: lnPhi(${c.component})`);
        expectFiniteNumber(c.phi, `${point.id}: phi(${c.component})`);
        expectFiniteNumber(c.fugacityPa, `${point.id}: f(${c.component})`);
        expectFiniteNumber(c.sIPaM6PerMol2, `${point.id}: S(${c.component})`);
        expect(c.phi).toBeGreaterThan(0);
        expect(c.fugacityPa).toBeGreaterThan(0);
      }

      // Предупреждения: обязательные коды присутствуют.
      const codes: readonly string[] = s.warnings.map((w) => w.code);
      for (const required of point.mustWarn) {
        if (!codes.includes(required)) {
          throw new Error(
            `${point.id}: ожидалось предупреждение ${required}, получено: [${codes.join(', ')}]`
          );
        }
      }

      // Строка дампа: значения СОБСТВЕННОЙ реализации (вход для оракула).
      mixtureRows.push({
        id: point.id,
        temperatureK: s.temperatureK,
        pressurePa: s.pressurePa,
        root: s.root,
        evidencePolicy: s.evidencePolicy,
        // Канонический порядок gasId (соответствует s.components).
        composition: point.composition.map((c) => ({
          gasId: c.gasId,
          moleFraction: c.moleFraction
        })),
        kijUsed: s.binaryInteractionsUsed.map((p) => ({
          pairKey: `${p.componentA}|${p.componentB}`,
          kij: p.kij,
          evidence: p.evidence,
          applicabilityRangeK: p.applicabilityRangeK
        })),
        aMixPaM6PerMol2: s.aMixPaM6PerMol2,
        bMixM3PerMol: s.bMixM3PerMol,
        dimensionlessA: s.dimensionlessA,
        dimensionlessB: s.dimensionlessB,
        Z: s.Z,
        realRoots: [...s.realRoots],
        physicalRoots: [...s.physicalRoots],
        components: s.components.map((c) => ({
          component: c.component,
          moleFraction: c.moleFraction,
          aPaM6PerMol2: c.aPaM6PerMol2,
          bM3PerMol: c.bM3PerMol,
          sIPaM6PerMol2: c.sIPaM6PerMol2,
          lnPhi: c.lnPhi,
          phi: c.phi,
          fugacityPa: c.fugacityPa
        })),
        warningCodes: codes
      });
    });
  }

  // --- Stage 4.4.4.3.1: точки точного нулевого предела a_mix ---
  for (const point of ZERO_ATTRACTION_POINTS) {
    it(`нулевой предел a_mix ${point.id}: успех, конечные значения, предельная форма`, () => {
      const s = expectMixtureSuccess(computePengRobinsonMixtureFromCatalog({
        composition: [{ gasId: 'n2', moleFraction: 1.0 }],
        temperatureK: point.temperatureK,
        pressurePa: point.pressurePa,
        root: 'vapor',
        evidencePolicy: 'allow_partial'
      }));

      // Структура и конечность.
      expectFiniteNumber(s.Z, `${point.id}: Z`);
      expectFiniteNumber(s.aMixPaM6PerMol2, `${point.id}: a_mix`);
      expectFiniteNumber(s.bMixM3PerMol, `${point.id}: b_mix`);
      expectFiniteNumber(s.dimensionlessA, `${point.id}: A_mix`);
      expectFiniteNumber(s.dimensionlessB, `${point.id}: B_mix`);
      expect(s.Z).toBe(s.selectedRoot);
      expect(s.Z).toBeGreaterThan(s.dimensionlessB);
      for (const c of s.components) {
        expectFiniteNumber(c.lnPhi, `${point.id}: lnPhi(${c.component})`);
        expectFiniteNumber(c.phi, `${point.id}: phi(${c.component})`);
        expectFiniteNumber(c.fugacityPa, `${point.id}: f(${c.component})`);
        expectFiniteNumber(c.sIPaM6PerMol2, `${point.id}: S(${c.component})`);
        expect(c.phi).toBeGreaterThan(0);
        expect(c.fugacityPa).toBeGreaterThan(0);
      }

      if (point.expectExactZero) {
        // Точный нулевой предел: a_i = a_mix = S_i = A_mix = 0 при
        // b_mix > 0; ln(phi_i) — предельной формой; примечание
        // о нулевом пределе прикреплено к результату.
        expect(s.aMixPaM6PerMol2).toBe(0);
        expect(s.dimensionlessA).toBe(0);
        expect(s.components[0].aPaM6PerMol2).toBe(0);
        expect(s.components[0].sIPaM6PerMol2).toBe(0);
        expect(s.bMixM3PerMol).toBeGreaterThan(0);
        expect(s.dimensionlessB).toBeGreaterThan(0);
        expect(s.notes.join(' ')).toContain('точный нулевой предел a_mix');
      } else {
        // Соседняя точка: a_mix крошечный, но НЕ ноль (общий путь,
        // без epsilon-переключения); примечание о пределе НЕ прикреплено.
        expect(s.aMixPaM6PerMol2).toBeGreaterThan(0);
        expect(s.dimensionlessA).toBeGreaterThan(0);
        expect(s.notes.join(' ')).not.toContain('точный нулевой предел a_mix');
      }

      // Предупреждение об единственной физической ветви обязательно.
      expect(s.warnings.map((w) => w.code)).toContain('single_physical_root');

      // Строка дампа: значения СОБСТВЕННОЙ реализации (вход для оракула).
      zeroAttractionRows.push({
        id: point.id,
        temperatureK: s.temperatureK,
        pressurePa: s.pressurePa,
        root: s.root,
        composition: [{ gasId: 'n2', moleFraction: 1.0 }],
        aMixPaM6PerMol2: s.aMixPaM6PerMol2,
        bMixM3PerMol: s.bMixM3PerMol,
        dimensionlessA: s.dimensionlessA,
        dimensionlessB: s.dimensionlessB,
        Z: s.Z,
        realRoots: [...s.realRoots],
        physicalRoots: [...s.physicalRoots],
        components: s.components.map((c) => ({
          component: c.component,
          moleFraction: c.moleFraction,
          aPaM6PerMol2: c.aPaM6PerMol2,
          bM3PerMol: c.bM3PerMol,
          sIPaM6PerMol2: c.sIPaM6PerMol2,
          lnPhi: c.lnPhi,
          phi: c.phi,
          fugacityPa: c.fugacityPa
        })),
        warningCodes: s.warnings.map((w) => w.code),
        note: point.note
      });
    });
  }

  // Выгрузка дампа: безусловная запись в benchmark-artifacts/
  // (рабочая директория vitest; каталог не отслеживается git).
  afterAll(() => {
    mkdirSync('benchmark-artifacts', { recursive: true });
    const payload = {
      generator:
        'evowars Stage 4.4.4.3 — TS-дамп смесевых контрольных точек PR (kij каталога 4.4.4.3)',
      consumer:
        'scripts/benchmarks/peng_robinson_coolprop.py --mixtures ' +
        '(CoolProp 8.0.0 backend PR с введёнными каталожными kij; mpmath)',
      validationSemantics: {
        coolprop: 'ВАЛИДАЦИЯ РЕАЛИЗАЦИИ при одинаковых kij (CoolProp собственных значений kij не содержит); НЕ независимое подтверждение значений kij',
        kijEvidence: 'значения kij остаются PARTIALLY_VERIFIED по provenance каталога (подгонки Okoro 2024 / Köster 2018)',
        aqueousSolubility: 'точка n2-h2o — валидация РЕАЛИЗАЦИИ при одинаковых kij, НЕ проверка растворимости N2 в воде: постоянный BIP классического PR качественно не воспроизводит константы Генри газов в воде (Köster, Thol & Vrabec 2018, Supplementary Section 4)'
      },
      universalGasConstantJPerMolK: UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K,
      omegaA: 0.45724,
      omegaB: 0.0778,
      points: mixtureRows,
      zeroAttractionLimit: {
        stage: '4.4.4.3.1',
        semantics: 'точный нулевой предел a_mix (alpha = 0 ровно в binary64 при T = 1388.2195230363366 K для N2): ln(phi_i) точной предельной формой (b_i/b_mix)*(Z-1) - ln(Z-B_mix); вырожденная компенсация (a_mix = 0 при ненулевых a_i) — отказ degenerate_attraction_limit; epsilon-порог не вводится (соседняя точка alpha = 1.232595164407831e-32 идёт общим путём). Независимая проверка предела: mpmath с ТОЧНЫМИ binary64-входами (в точной арифметике alpha не равен нулю — нулевой alpha есть артефакт округления; сходимость Z/ln(phi)/phi/f к значениям TS подтверждает корректность предельной формы; a_mix сверяется по АБСОЛЮТНОЙ близости к нулю). CoolProp проверяет ту же ветвь gas; при отказе CoolProp причина фиксируется, результат НЕ подменяется собственным расчётом (главный оракул этого предельного случая — mpmath)',
        cases: zeroAttractionRows
      }
    };
    writeFileSync(
      'benchmark-artifacts/peng-robinson-mixture-ts-dump.json',
      JSON.stringify(payload, null, 2) + '\n',
      'utf8'
    );
  });
});
