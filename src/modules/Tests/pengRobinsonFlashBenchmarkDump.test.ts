// ============================================
// PENG–ROBINSON — дамп VLE FLASH контрольных точек для независимого
// benchmark (Stage 4.4.4.6)
// ============================================
//
// Этот файл НЕ является самостоятельной проверкой корректности: он
// фиксирует двухфазные контрольные точки flash (каталог 4.4.4.1 +
// каталог kij 4.4.4.3 через фасад Data) и записывает значения
// СОБСТВЕННОЙ реализации в JSON-дамп benchmark-artifacts/
// peng-robinson-flash-ts-dump.json (тот же паттерн, что у
// pengRobinsonMixtureBenchmarkDump.test.ts).
//
// Дамп потребляется НЕЗАВИСИМЫМ оракулом scripts/benchmarks/
// peng_robinson_coolprop.py (аргумент --flash): CoolProp backend 'PR'
// с ВВЕДЁННЫМИ каталожными kij (set_binary_interaction_double).
// ЧЕСТНАЯ СЕМАНТИКА: оракул ВАЛИДИРУЕТ РЕАЛИЗАЦИЮ алгоритма flash
// (правила смешения, кубику, phi_i, равенство фугитивностей) при
// одинаковых параметрах — он НЕ является подтверждением ЗНАЧЕНИЙ kij
// (те остаются PARTIALLY_VERIFIED по provenance каталога). Если
// CoolProp для точки возвращает однофазное состояние или не конечный
// результат, оракул фиксирует НЕДОСТУПНОСТЬ сравнения, а не PASS.
//
// Границы: LLE, PPR78, доказанная глобальная устойчивость — НЕ
// реализованы; stability кандидата — indeterminate или
// two_phase_split_indicated, НИКОГДА 'stable'.

import { describe, it, expect, afterAll } from 'vitest';
// @ts-expect-error типы node:fs не подключены в tsconfig проекта (паттерн golden-baseline теста)
import { mkdirSync, writeFileSync } from 'node:fs';

import { computePengRobinsonFlashFromCatalog } from '../Data/pengRobinsonFlashFacade';
import type {
  PengRobinsonFlashCatalogResult,
  PengRobinsonFlashCatalogSuccess
} from '../Data/pengRobinsonFlashFacade';

// ============================================
// 1. TWO-PHASE КОНТРОЛЬНЫЕ ТОЧКИ FLASH
// ============================================

interface FlashPointSpec {
  readonly id: string;
  /** Состав feed (gasId + мольные доли, сумма = 1). */
  readonly composition: readonly { gasId: string; moleFraction: number }[];
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly evidencePolicy: 'allow_partial';
  readonly fugacityTolerance: number;
}

// 1) бинарная co2 + ch4, 230 K / 2 МПа — kij ch4|co2 (228.15–273.15 K);
// 2) тройная co2 + n2 + ar, 250 K / 4 МПа — полный треугольник kij
//    (co2-n2 и ar-co2 в 228.15–273.15 K; ar-n2 — диапазон null).
const FLASH_POINTS: readonly FlashPointSpec[] = [
  {
    id: 'flash-co2-ch4-230K-2MPa',
    composition: [
      { gasId: 'co2', moleFraction: 0.5 },
      { gasId: 'ch4', moleFraction: 0.5 }
    ],
    temperatureK: 230,
    pressurePa: 2e6,
    evidencePolicy: 'allow_partial',
    fugacityTolerance: 1e-10
  },
  {
    id: 'flash-co2-n2-ar-250K-4MPa',
    composition: [
      { gasId: 'co2', moleFraction: 0.6 },
      { gasId: 'n2', moleFraction: 0.3 },
      { gasId: 'ar', moleFraction: 0.1 }
    ],
    temperatureK: 250,
    pressurePa: 4e6,
    evidencePolicy: 'allow_partial',
    fugacityTolerance: 1e-8
  }
];

// ============================================
// 2. ХЕЛПЕРЫ
// ============================================

function expectFlashSuccess(
  result: PengRobinsonFlashCatalogResult
): PengRobinsonFlashCatalogSuccess {
  expect(result.status).toBe('two_phase_candidate');
  if (result.status !== 'two_phase_candidate') {
    throw new Error(`ожидался two_phase_candidate, получен отказ: ${JSON.stringify(result)}`);
  }
  return result;
}

function expectFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label}: ожидалось конечное число, получено ${String(value)}`);
  }
}

// Накопитель строк дампа (заполняется тестами, выгружается в afterAll).
const flashRows: Record<string, unknown>[] = [];

// ============================================
// 3. ТЕСТЫ
// ============================================

describe('Stage 4.4.4.6: дамп двухфазных контрольных точек PR VLE flash', () => {
  for (const point of FLASH_POINTS) {
    it(`flash ${point.id}: two_phase_candidate, конечные составы и невязки в допуске`, () => {
      const s = expectFlashSuccess(computePengRobinsonFlashFromCatalog({
        composition: point.composition,
        temperatureK: point.temperatureK,
        pressurePa: point.pressurePa,
        evidencePolicy: point.evidencePolicy,
        fugacityTolerance: point.fugacityTolerance
      }));

      expect(s.convergence.status).toBe('converged');
      expectFiniteNumber(s.vaporFractionBeta, `${point.id}: beta`);
      expect(s.vaporFractionBeta).toBeGreaterThan(0);
      expect(s.vaporFractionBeta).toBeLessThan(1);
      expectFiniteNumber(s.materialBalanceResidual, `${point.id}: materialBalance`);
      expect(s.materialBalanceResidual).toBeLessThanOrEqual(1e-8);
      expectFiniteNumber(s.fugacityEqualityResidual.maxLnFugacityRatio, `${point.id}: fugacityResidual`);
      expect(s.fugacityEqualityResidual.maxLnFugacityRatio)
        .toBeLessThan(s.fugacityEqualityResidual.tolerance);
      // Честная семантика устойчивости: 'stable' не предусмотрен.
      expect(['indeterminate', 'two_phase_split_indicated']).toContain(s.stability);

      // Строка дампа: значения СОБСТВЕННОЙ реализации (вход для оракула).
      flashRows.push({
        id: point.id,
        temperatureK: s.temperatureK,
        pressurePa: s.pressurePa,
        evidencePolicy: s.evidencePolicy,
        fugacityTolerance: s.fugacityEqualityResidual.tolerance,
        feedComposition: s.feedComposition.map((e) => ({ gasId: e.component, moleFraction: e.moleFraction })),
        liquidComposition: s.liquidComposition.map((e) => ({ gasId: e.component, moleFraction: e.moleFraction })),
        vaporComposition: s.vaporComposition.map((e) => ({ gasId: e.component, moleFraction: e.moleFraction })),
        vaporFractionBeta: s.vaporFractionBeta,
        kijUsed: s.kijUsed.map((k) => ({
          pairKey: `${k.componentA}|${k.componentB}`,
          kij: k.kij,
          evidence: k.evidence,
          applicabilityRangeK: k.applicabilityRangeK
        })),
        liquid: {
          Z: s.liquid.Z,
          aMixPaM6PerMol2: s.liquid.aMixPaM6PerMol2,
          bMixM3PerMol: s.liquid.bMixM3PerMol,
          dimensionlessA: s.liquid.dimensionlessA,
          dimensionlessB: s.liquid.dimensionlessB,
          components: s.liquid.components.map((c) => ({
            component: c.component,
            moleFraction: c.moleFraction,
            lnPhi: c.lnPhi,
            phi: c.phi,
            fugacityPa: c.fugacityPa
          }))
        },
        vapor: {
          Z: s.vapor.Z,
          aMixPaM6PerMol2: s.vapor.aMixPaM6PerMol2,
          bMixM3PerMol: s.vapor.bMixM3PerMol,
          dimensionlessA: s.vapor.dimensionlessA,
          dimensionlessB: s.vapor.dimensionlessB,
          components: s.vapor.components.map((c) => ({
            component: c.component,
            moleFraction: c.moleFraction,
            lnPhi: c.lnPhi,
            phi: c.phi,
            fugacityPa: c.fugacityPa
          }))
        },
        fugacityEqualityResidual: {
          maxLnFugacityRatio: s.fugacityEqualityResidual.maxLnFugacityRatio,
          perComponent: s.fugacityEqualityResidual.perComponent.map((r) => ({
            component: r.component,
            lnFugacityRatio: r.lnFugacityRatio
          }))
        },
        materialBalanceResidual: s.materialBalanceResidual,
        iterations: s.iterations,
        stability: s.stability,
        warningCodes: s.warnings.map((w) => w.code)
      });
    });
  }

  // Выгрузка дампа: безусловная запись в benchmark-artifacts/
  // (рабочая директория vitest; каталог не отслеживается git).
  afterAll(() => {
    mkdirSync('benchmark-artifacts', { recursive: true });
    const payload = {
      generator:
        'evowars Stage 4.4.4.6 — TS-дамп двухфазных контрольных точек PR VLE flash (kij каталога 4.4.4.3)',
      consumer:
        'scripts/benchmarks/peng_robinson_coolprop.py --flash ' +
        '(CoolProp backend PR с введёнными каталожными kij; двухфазная сверка составов фаз, beta и фугитивностей)',
      validationSemantics: {
        coolprop:
          'ВАЛИДАЦИЯ РЕАЛИЗАЦИИ алгоритма flash при одинаковых чистых параметрах и kij ' +
          '(CoolProp собственных значений kij не содержит); НЕ независимое подтверждение значений kij',
        onePhaseOrNonFinite:
          'если CoolProp возвращает однофазное состояние или не конечный результат — ' +
          'НЕДОСТУПНОСТЬ сравнения (unavailable), а НЕ PASS',
        stability:
          'сходимость flash и stability-статус кандидата НЕ являются доказательством глобальной фазовой устойчивости'
      },
      points: flashRows
    };
    writeFileSync(
      'benchmark-artifacts/peng-robinson-flash-ts-dump.json',
      JSON.stringify(payload, null, 2) + '\n',
      'utf8'
    );
  });
});
