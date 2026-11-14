// ============================================
// STAGE 4.4.4.6 - Интеграционные тесты Data -> Core:
// computePengRobinsonFlashFromCatalog
// ============================================
//
// Покрывают каталоговый фасад VLE flash: бинарный co2|ch4, тройной
// co2|n2|ar (полный треугольник kij), fail-closed отказы
// (unresolved-пара, неизвестный gasId, неверная сумма, дубликаты,
// политика evidence, диапазон применимости), полноту provenance,
// сохранение ограничений источников и перестановочную инвариантность.
//
// Честность: evidence-статусы каталога не повышаются
// (PARTIALLY_VERIFIED остаётся PARTIALLY_VERIFIED), диапазон n2-ar
// остаётся null (не верифицирован), kij = 0 не подставляется.

import { describe, it, expect } from 'vitest';
import { computePengRobinsonFlashFromCatalog } from '../Data/pengRobinsonFlashFacade';
import type {
  PengRobinsonFlashCatalogRequest,
  PengRobinsonFlashCatalogSuccess
} from '../Data/pengRobinsonFlashFacade';
import { getEosPureComponentParameters } from '../Data/eosParameters';
import { getBinaryInteractionParameter } from '../Data/binaryInteractionParameters';

const POLICY = 'allow_partial' as const;
/**
 * Политика успешных контрольных точек с CH4: acentricFactor CH4 в
 * каталоге — UNRESOLVED_CROSS_CHECK, allow_partial его отклоняет
 * (parameter_evidence_rejected). Успешные точки требуют явного
 * allow_unresolved_cross_check; статусы каталога не повышаются.
 */
const AUCC_POLICY = 'allow_unresolved_cross_check' as const;

function catalog(
  composition: readonly { gasId: string; moleFraction: number }[],
  overrides: Partial<PengRobinsonFlashCatalogRequest> = {}
) {
  return computePengRobinsonFlashFromCatalog({
    composition,
    temperatureK: 230,
    pressurePa: 2_000_000,
    evidencePolicy: AUCC_POLICY,
    ...overrides
  });
}

function asCandidate(result: ReturnType<typeof catalog>): PengRobinsonFlashCatalogSuccess {
  expect(result.status).toBe('two_phase_candidate');
  return result as PengRobinsonFlashCatalogSuccess;
}

function codeOf(result: ReturnType<typeof catalog>): string {
  return result.status === 'failure' ? result.code : 'unexpected_success';
}

function byComponent(
  composition: readonly { component: string; moleFraction: number }[]
): Map<string, number> {
  return new Map(composition.map((e) => [e.component, e.moleFraction]));
}

// Контрольная точка: z = (0.75, 0.25) — при 230 K / 2 МПа сходится как
// заведомо двухфазная (beta ~ 0.435); z = (0.5, 0.5) даёт beta ~ 0.978
// у границы и как контрольная точка менее робастна.
const BINARY_CO2_CH4 = [
  { gasId: 'co2', moleFraction: 0.75 },
  { gasId: 'ch4', moleFraction: 0.25 }
];

const TERNARY_CO2_N2_AR = [
  { gasId: 'co2', moleFraction: 0.6 },
  { gasId: 'n2', moleFraction: 0.3 },
  { gasId: 'ar', moleFraction: 0.1 }
];

// ============================================
// 1. Бинарная смесь co2|ch4: успех + provenance
// ============================================

describe('pengRobinsonFlashFacade: бинарный co2|ch4 (230 K, 2 МПа)', () => {
  const result = catalog(BINARY_CO2_CH4);

  it('возвращает two_phase_candidate сошедшегося flash с фактическими значениями контрольной точки', () => {
    const c = asCandidate(result);
    expect(c.status).toBe('two_phase_candidate');
    expect(c.temperatureK).toBe(230);
    expect(c.pressurePa).toBe(2_000_000);
    expect(c.evidencePolicy).toBe('allow_unresolved_cross_check');
    expect(c.convergence.status).toBe('converged');
    expect(c.materialBalanceResidual).toBeLessThanOrEqual(1e-8);
    expect(c.fugacityEqualityResidual.maxLnFugacityRatio)
      .toBeLessThan(c.fugacityEqualityResidual.tolerance);
    // Контрольная точка z = (0.75, 0.25); значения из фактического
    // выполнения реализации (Core и фасад согласованы).
    const z = byComponent(c.feedComposition);
    expect(z.get('co2')).toBeCloseTo(0.75, 12);
    expect(z.get('ch4')).toBeCloseTo(0.25, 12);
    expect(c.vaporFractionBeta).toBeCloseTo(0.434788, 4);
    const x = byComponent(c.liquidComposition);
    const y = byComponent(c.vaporComposition);
    expect(x.get('co2')!).toBeCloseTo(0.950184, 4);
    expect(x.get('ch4')!).toBeCloseTo(0.049816, 4);
    expect(y.get('co2')!).toBeCloseTo(0.489767, 4);
    expect(y.get('ch4')!).toBeCloseTo(0.510233, 4);
    expect(c.vaporFractionBeta).toBeGreaterThan(0);
    expect(c.vaporFractionBeta).toBeLessThan(1);
  });

  it('успех с CH4 сохраняет предупреждение о неразрешённом конфликте evidence', () => {
    const c = asCandidate(result);
    const unresolved = c.warnings.filter((w) => w.code === 'unresolved_cross_check_parameter');
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.some((w) => w.message.includes('UNRESOLVED_CROSS_CHECK'))).toBe(true);
  });

  it('направление разделения физично: co2 обогащает жидкость, ch4 — пар', () => {
    const c = asCandidate(result);
    const x = byComponent(c.liquidComposition);
    const y = byComponent(c.vaporComposition);
    expect(x.get('co2')!).toBeGreaterThan(y.get('co2')!);
    expect(y.get('ch4')!).toBeGreaterThan(x.get('ch4')!);
  });

  it('provenance чистых параметров совпадает с каталогом 4.4.4.1', () => {
    const c = asCandidate(result);
    expect(c.componentParameters).toHaveLength(2);
    const co2 = getEosPureComponentParameters('co2');
    const prov = c.componentParameters.find((p) => p.gasId === 'co2')!;
    expect(prov.criticalTemperatureK.value).toBe(co2.criticalTemperatureK.value);
    expect(prov.criticalPressurePa.value).toBe(co2.criticalPressurePa.value);
    expect(prov.acentricFactor.value).toBe(co2.acentricFactor.value);
    expect(prov.criticalTemperatureK.provenance.evidence)
      .toBe(co2.criticalTemperatureK.provenance.evidence);
  });

  it('provenance kij совпадает с каталогом 4.4.4.3 без повышения evidence', () => {
    const c = asCandidate(result);
    expect(c.binaryInteractionParameters).toHaveLength(1);
    const kijRecord = getBinaryInteractionParameter('ch4', 'co2');
    const prov = c.binaryInteractionParameters[0]!;
    expect(prov.pairKey).toBe('ch4|co2');
    expect(prov.kij.value).toBe(kijRecord.kij.value);
    expect(prov.kij.provenance.evidence).toBe(kijRecord.kij.provenance.evidence);
    expect(prov.kij.provenance.evidence).toBe('PARTIALLY_VERIFIED');
    expect(prov.applicabilityRangeK).toEqual(kijRecord.applicabilityRangeK);
    // kijUsed результата Core согласован с provenance фасада.
    expect(c.kijUsed[0]!.kij).toBe(prov.kij.value);
    expect(c.kijUsed[0]!.evidence).toBe('PARTIALLY_VERIFIED');
  });

  it('перестановка состава инвариантна', () => {
    const flipped = asCandidate(catalog([...BINARY_CO2_CH4].reverse()));
    const a = asCandidate(result);
    expect(flipped.vaporFractionBeta).toBeCloseTo(a.vaporFractionBeta, 9);
    expect(byComponent(flipped.liquidComposition)).toEqual(byComponent(a.liquidComposition));
    expect(byComponent(flipped.vaporComposition)).toEqual(byComponent(a.vaporComposition));
  });
});

// ============================================
// 2. Тройная смесь co2|n2|ar (полный треугольник kij)
// ============================================

describe('pengRobinsonFlashFacade: тройной co2|n2|ar (250 K, 4 МПа)', () => {
  const result = catalog(TERNARY_CO2_N2_AR, {
    temperatureK: 250,
    pressurePa: 4_000_000,
    fugacityTolerance: 1e-8
  });

  it('трёхкомпонентный two_phase_candidate с тремя парами kij в provenance', () => {
    const c = asCandidate(result);
    expect(c.binaryInteractionParameters).toHaveLength(3);
    const byPair = new Map(c.binaryInteractionParameters.map((p) => [p.pairKey, p]));
    // n2-ar: диапазон применимости НЕ верифицирован — остаётся null.
    const n2ar = byPair.get('ar|n2');
    expect(n2ar).toBeDefined();
    expect(n2ar!.applicabilityRangeK).toBeNull();
    // CO2-содержащие пары: ограниченный диапазон 228.15–273.15 K
    // сохраняется и отражается в результате (не скрывается).
    for (const key of ['co2|n2', 'ar|co2']) {
      const record = byPair.get(key);
      expect(record).toBeDefined();
      expect(record!.applicabilityRangeK).not.toBeNull();
      expect(record!.applicabilityRangeK!.minTemperatureK).toBe(228.15);
      expect(record!.applicabilityRangeK!.maxTemperatureK).toBe(273.15);
    }
    // Ни один статус не повышен до VERIFIED.
    for (const p of c.binaryInteractionParameters) {
      expect(p.kij.provenance.evidence).toBe('PARTIALLY_VERIFIED');
    }
    expect(c.convergence.status).toBe('converged');
    expect(c.fugacityEqualityResidual.perComponent).toHaveLength(3);
    expect(c.materialBalanceResidual).toBeLessThanOrEqual(1e-8);
  });

  it('перестановка тройного состава инвариантна', () => {
    const flipped = asCandidate(
      catalog([...TERNARY_CO2_N2_AR].reverse(), {
        temperatureK: 250,
        pressurePa: 4_000_000,
        fugacityTolerance: 1e-8
      })
    );
    const a = asCandidate(result);
    expect(flipped.vaporFractionBeta).toBeCloseTo(a.vaporFractionBeta, 9);
    expect(byComponent(flipped.liquidComposition)).toEqual(byComponent(a.liquidComposition));
    expect(byComponent(flipped.vaporComposition)).toEqual(byComponent(a.vaporComposition));
  });

  it('ограниченная применимость BIP отражается в предупреждениях/ограничениях результата', () => {
    const c = asCandidate(result);
    // Ограничение интерпретации Core сохранено фасадом без изменений.
    expect(c.interpretationLimitation.length).toBeGreaterThan(0);
    expect(['indeterminate', 'two_phase_split_indicated']).toContain(c.stability);
  });
});

// ============================================
// 3. Fail-closed отказы фасада
// ============================================

describe('pengRobinsonFlashFacade: fail-closed отказы', () => {
  it('тройная комбинация с unresolved-парой (co2|n2|ch4) — missing_binary_interaction, kij = 0 не подставляется', () => {
    const result = catalog([
      { gasId: 'co2', moleFraction: 0.4 },
      { gasId: 'n2', moleFraction: 0.3 },
      { gasId: 'ch4', moleFraction: 0.3 }
    ]);
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('missing_binary_interaction');
      // Отказ называет конкретную отсутствующую пару.
      expect(result.message + ' ' + (result.detail ?? '')).toContain('ch4|n2');
    }
  });

  it('неизвестный gasId — invalid_input', () => {
    const result = catalog([
      { gasId: 'co2', moleFraction: 0.5 },
      { gasId: 'unobtainium', moleFraction: 0.5 }
    ]);
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('invalid_input');
      expect(result.message).toContain('unobtainium');
    }
  });

  it('неверная сумма состава — invalid_input без нормализации', () => {
    const result = catalog([
      { gasId: 'co2', moleFraction: 0.5 },
      { gasId: 'ch4', moleFraction: 0.6 }
    ]);
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('invalid_input');
      expect(result.message).toContain('сумма');
    }
  });

  it('дублированные gasId — invalid_input', () => {
    const result = catalog([
      { gasId: 'co2', moleFraction: 0.3 },
      { gasId: 'co2', moleFraction: 0.3 },
      { gasId: 'ch4', moleFraction: 0.4 }
    ]);
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('invalid_input');
      expect(result.message).toContain('более одного раза');
    }
  });

  it('пустой состав и некорректные записи — invalid_input', () => {
    expect(codeOf(catalog([]))).toBe('invalid_input');
    expect(
      codeOf(
        // @ts-expect-error — намеренно некорректная запись состава
        catalog([{ gasId: 'co2', moleFraction: 'много' }, { gasId: 'ch4', moleFraction: 0.5 }])
      )
    ).toBe('invalid_input');
    expect(
      codeOf(
        // @ts-expect-error — намеренно некорректная запись состава
        catalog([{ moleFraction: 0.5 }, { gasId: 'ch4', moleFraction: 0.5 }])
      )
    ).toBe('invalid_input');
  });

  it('политика verified_only при PARTIALLY_VERIFIED kij — parameter_evidence_rejected', () => {
    const result = catalog(BINARY_CO2_CH4, { evidencePolicy: 'verified_only' });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('parameter_evidence_rejected');
    }
  });

  it('allow_partial НЕ принимает UNRESOLVED_CROSS_CHECK acentricFactor CH4 — parameter_evidence_rejected', () => {
    // Статус каталога не изменяется: co2|ch4 при allow_partial отклоняется
    // ДО расчёта VLE с указанием конкретного поля и статуса.
    const result = catalog(BINARY_CO2_CH4, { evidencePolicy: POLICY });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('parameter_evidence_rejected');
      expect(result.message + ' ' + (result.detail ?? ''))
        .toContain('ch4.acentricFactor=UNRESOLVED_CROSS_CHECK');
    }
  });

  it('температура вне диапазона применимости kij — temperature_applicability', () => {
    // CO2-содержащие пары верифицированы в 228.15–273.15 K; 300 K вне.
    const result = catalog(BINARY_CO2_CH4, { temperatureK: 300 });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('temperature_applicability');
    }
  });
});
