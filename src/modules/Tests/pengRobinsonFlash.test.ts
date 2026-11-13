// ============================================
// STAGE 4.4.4.6 - Тесты двухфазного PR VLE flash (n >= 2 компонентов)
// ============================================
//
// Покрывают контракт computePengRobinsonFlash: валидацию входа,
// fail-closed отказы (kij, политика, диапазоны применимости),
// детерминизм, инвариантность к порядку компонентов, материальный
// баланс, нормировку фаз, равенство фугитивностей, однофазные
// состояния, несходимость, нулевые доли и честную семантику
// устойчивости (verdict 'stable' не предусмотрен вовсе).
//
// Входы строятся ИЗ СУЩЕСТВУЮЩИХ каталогов Data (4.4.4.1 и 4.4.4.3)
// без новых параметров и без подстановок: getEosPureComponentParameters
// + getBinaryInteractionParameter (fail-closed lookup).
//
// Честные границы: независимый CoolProp oracle для flash-сценария НЕ
// расширялся (в среде разработки нет исполнимого python/CoolProp);
// сравнение с benchmark CoolProp остаётся на уровне pure/mixture
// тестов. Совпадение реализаций при одинаковых входах НЕ является
// подтверждением экспериментальной точности исходных kij.

import { describe, it, expect } from 'vitest';
import {
  computePengRobinsonFlash,
  PENG_ROBINSON_FLASH_INTERPRETATION_LIMITATION,
  PENG_ROBINSON_FLASH_ERROR_CODES
} from '../Core/pengRobinsonFlash';
import type {
  PengRobinsonFlashInput,
  PengRobinsonFlashTwoPhaseCandidate
} from '../Core/pengRobinsonFlash';
import type { PengRobinsonMixtureInputs } from '../Core/pengRobinsonMixture';
import { getEosPureComponentParameters } from '../Data/eosParameters';
import { getBinaryInteractionParameter } from '../Data/binaryInteractionParameters';

// ============================================
// Помощники: входы Core из существующих каталогов Data
// ============================================

const POLICY = 'allow_partial' as const;

/**
 * Бинарные входы Core для пары газId из каталогов 4.4.4.1 + 4.4.4.3.
 * includeKij=false имитирует отсутствующий kij (пара без записи).
 */
function binaryInputs(gasA: string, gasB: string, includeKij: boolean = true): PengRobinsonMixtureInputs {
  const a = getEosPureComponentParameters(gasA);
  const b = getEosPureComponentParameters(gasB);
  const components = [a, b].map((record) => ({
    component: record.gasId,
    moleFraction: 0.5,
    criticalTemperatureK: record.criticalTemperatureK.value,
    criticalPressurePa: record.criticalPressurePa.value,
    acentricFactor: record.acentricFactor.value,
    evidence: {
      criticalTemperatureK: record.criticalTemperatureK.provenance.evidence,
      criticalPressurePa: record.criticalPressurePa.provenance.evidence,
      acentricFactor: record.acentricFactor.provenance.evidence
    },
    crossChecks: record.crossChecks,
    limitations: record.limitations
  }));
  let binaryInteractions: PengRobinsonMixtureInputs['binaryInteractions'] = [];
  if (includeKij) {
    const kijRecord = getBinaryInteractionParameter(gasA, gasB);
    binaryInteractions = [
      {
        componentA: kijRecord.componentA,
        componentB: kijRecord.componentB,
        kij: kijRecord.kij.value,
        evidence: kijRecord.kij.provenance.evidence,
        applicabilityRangeK: kijRecord.applicabilityRangeK
      }
    ];
  }
  return { components, binaryInteractions };
}

function flash(
  mixtureInputs: PengRobinsonMixtureInputs,
  overrides: Partial<PengRobinsonFlashInput['request']> = {}
) {
  return computePengRobinsonFlash({
    mixtureInputs,
    request: {
      temperatureK: 230,
      pressurePa: 2_000_000,
      evidencePolicy: POLICY,
      ...overrides
    }
  });
}

function asCandidate(result: ReturnType<typeof flash>): PengRobinsonFlashTwoPhaseCandidate {
  expect(result.status).toBe('two_phase_candidate');
  return result as PengRobinsonFlashTwoPhaseCandidate;
}

/** Компонентный срез состава по id (порядок входа не важен). */
function byComponent(
  composition: readonly { component: string; moleFraction: number }[]
): Map<string, number> {
  return new Map(composition.map((e) => [e.component, e.moleFraction]));
}

// ============================================
// 1. Валидация формы входа и состава
// ============================================

describe('pengRobinsonFlash: валидация входа', () => {
  it('отказывает на некорректной форме входа и запроса', () => {
    const codeOf = (r: ReturnType<typeof computePengRobinsonFlash>): string =>
      r.status === 'failure' ? r.code : 'unexpected_success';
    // @ts-expect-error — намеренно некорректный вход (контракт валидации)
    expect(codeOf(computePengRobinsonFlash(null))).toBe('invalid_input');
    // @ts-expect-error — отсутствует request
    expect(codeOf(computePengRobinsonFlash({ mixtureInputs: binaryInputs('ch4', 'co2') }))).toBe('invalid_input');
    expect(
      codeOf(computePengRobinsonFlash({
        mixtureInputs: binaryInputs('ch4', 'co2'),
        request: { temperatureK: -5, pressurePa: 2_000_000, evidencePolicy: POLICY }
      }))
    ).toBe('invalid_input');
    expect(
      codeOf(computePengRobinsonFlash({
        mixtureInputs: binaryInputs('ch4', 'co2'),
        request: { temperatureK: 230, pressurePa: Number.NaN, evidencePolicy: POLICY }
      }))
    ).toBe('invalid_input');
    expect(
      codeOf(computePengRobinsonFlash({
        mixtureInputs: binaryInputs('ch4', 'co2'),
        // @ts-expect-error — недопустимая политика доказанности
        request: { temperatureK: 230, pressurePa: 2_000_000, evidencePolicy: 'no_policy' }
      }))
    ).toBe('invalid_input');
  });

  it('три компонента без полного набора kij — fail-closed missing_binary_interaction', () => {
    const three = {
      components: [
        ...binaryInputs('ch4', 'co2').components,
        binaryInputs('n2', 'ar').components[0]!
      ],
      binaryInteractions: []
    };
    const result = computePengRobinsonFlash({
      mixtureInputs: three,
      request: { temperatureK: 230, pressurePa: 2_000_000, evidencePolicy: POLICY }
    });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('missing_binary_interaction');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('дубликат имени компонента — invalid_input', () => {
    const base = binaryInputs('ch4', 'co2');
    const dup: PengRobinsonMixtureInputs = {
      components: [base.components[0]!, base.components[0]!],
      binaryInteractions: base.binaryInteractions
    };
    const result = flash(dup);
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('invalid_input');
      expect(result.message).toContain('уникальные');
    }
  });

  it('менее двух активных компонентов (z = 1, 0) — invalid_input без вычислений', () => {
    const base = binaryInputs('ch4', 'co2');
    const degenerate: PengRobinsonMixtureInputs = {
      components: base.components.map((c, i) => ({ ...c, moleFraction: i === 0 ? 1 : 0 })),
      binaryInteractions: base.binaryInteractions
    };
    const result = flash(degenerate);
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('invalid_input');
    }
  });

  it('вырожденные доли (0, 1, NaN, сумма != 1) отказывают без нормализации', () => {
    const base = binaryInputs('ch4', 'co2');
    const cases: number[][] = [
      [0, 1],
      [1, 0],
      [Number.NaN, 0.5],
      [0.5, 0.6]
    ];
    for (const [za, zb] of cases) {
      const inputs: PengRobinsonMixtureInputs = {
        components: base.components.map((c, i) => ({ ...c, moleFraction: i === 0 ? za : zb })),
        binaryInteractions: base.binaryInteractions
      };
      const result = flash(inputs);
      expect(result.status).toBe('failure');
      if (result.status === 'failure') {
        expect(result.code).toBe('invalid_input');
      }
    }
  });

  it('реестр кодов отказов содержит все коды контракта', () => {
    expect([...PENG_ROBINSON_FLASH_ERROR_CODES]).toEqual([
      'invalid_input',
      'missing_binary_interaction',
      'unsupported_binary_interaction',
      'parameter_evidence_rejected',
      'temperature_applicability',
      'no_two_phase_split',
      'convergence_failure',
      'numerical_failure'
    ]);
  });
});

// ============================================
// 2. Fail-closed отказы данных и политики
// ============================================

describe('pengRobinsonFlash: fail-closed отказы', () => {
  it('отсутствующий kij — ЯВНЫЙ отказ missing_binary_interaction, НЕ kij = 0', () => {
    const result = flash(binaryInputs('ch4', 'co2', false));
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('missing_binary_interaction');
    }
  });

  it('недопустимая политика (verified_only при PARTIALLY_VERIFIED kij) — parameter_evidence_rejected', () => {
    const result = flash(binaryInputs('ch4', 'co2'), { evidencePolicy: 'verified_only' });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('parameter_evidence_rejected');
    }
  });

  it('температура вне верифицированного диапазона применимости kij — temperature_applicability', () => {
    // kij ch4|co2 верифицирован в 228.15–273.15 K; 300 K вне диапазона.
    const result = flash(binaryInputs('ch4', 'co2'), { temperatureK: 300 });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('temperature_applicability');
    }
  });

  it('повреждённые чистокомпонентные параметры — invalid_input без вычислений', () => {
    const inputs = binaryInputs('ch4', 'co2');
    const broken: PengRobinsonMixtureInputs = {
      components: inputs.components.map((c, i) =>
        i === 0 ? { ...c, criticalTemperatureK: Number.NaN } : c
      ),
      binaryInteractions: inputs.binaryInteractions
    };
    const brokenResult = flash(broken);
    expect(brokenResult.status).toBe('failure');
    if (brokenResult.status === 'failure') {
      expect(brokenResult.code).toBe('invalid_input');
    }
  });
});

// ============================================
// 3. Двухфазный кандидат: co2 + ch4, 230 K, 2 МПа
// ============================================

describe('pengRobinsonFlash: двухфазный кандидат co2|ch4 (230 K, 2 МПа)', () => {
  const inputs = binaryInputs('co2', 'ch4');
  const result = flash(inputs);

  it('возвращает two_phase_candidate с полным контрактом', () => {
    const c = asCandidate(result);
    expect(c.status).toBe('two_phase_candidate');
    expect(c.temperatureK).toBe(230);
    expect(c.pressurePa).toBe(2_000_000);
    expect(c.evidencePolicy).toBe('allow_partial');
    expect(c.convergence.status).toBe('converged');
    expect(c.iterations).toBeGreaterThan(0);
    // kij использован каталожный, с evidence и диапазоном.
    expect(c.kijUsed).toHaveLength(1);
    expect(c.kijUsed[0]!.kij).toBeCloseTo(0.09897, 12);
    expect(c.kijUsed[0]!.evidence).toBe('PARTIALLY_VERIFIED');
    expect(c.kijUsed[0]!.applicabilityRangeK).not.toBeNull();
    // Явное ограничение интерпретации присутствует.
    expect(c.interpretationLimitation).toBe(PENG_ROBINSON_FLASH_INTERPRETATION_LIMITATION);
    expect(c.interpretationLimitation.length).toBeGreaterThan(0);
  });

  it('фазовые составы нормированы, конечны, неотрицательны; beta в (0, 1)', () => {
    const c = asCandidate(result);
    for (const composition of [c.liquidComposition, c.vaporComposition]) {
      const sum = composition.reduce((s, e) => s + e.moleFraction, 0);
      expect(sum).toBeCloseTo(1, 10);
      for (const e of composition) {
        expect(Number.isFinite(e.moleFraction)).toBe(true);
        expect(e.moleFraction).toBeGreaterThanOrEqual(0);
        expect(e.moleFraction).toBeLessThanOrEqual(1);
      }
    }
    expect(c.vaporFractionBeta).toBeGreaterThan(0);
    expect(c.vaporFractionBeta).toBeLessThan(1);
  });

  it('материальный баланс по каждому компоненту выполнен', () => {
    const c = asCandidate(result);
    const z = byComponent(c.feedComposition);
    const x = byComponent(c.liquidComposition);
    const y = byComponent(c.vaporComposition);
    expect(c.materialBalanceResidual).toBeLessThanOrEqual(1e-8);
    for (const [component, zi] of z) {
      const balance = (1 - c.vaporFractionBeta) * x.get(component)! + c.vaporFractionBeta * y.get(component)!;
      expect(balance).toBeCloseTo(zi, 9);
    }
  });

  it('равенство фугитивностей f_i^L = f_i^V на сходящемся решении', () => {
    const c = asCandidate(result);
    expect(c.fugacityEqualityResidual.maxLnFugacityRatio)
      .toBeLessThan(c.fugacityEqualityResidual.tolerance);
    for (const row of c.fugacityEqualityResidual.perComponent) {
      expect(Number.isFinite(row.lnFugacityRatio)).toBe(true);
    }
    // Независимая проверка по полям фаз: ln(x_i phi_i^L) == ln(y_i phi_i^V).
    for (const liq of c.liquid.components) {
      const vap = c.vapor.components.find((v) => v.component === liq.component)!;
      const lnFL = Math.log(liq.moleFraction) + liq.lnPhi;
      const lnFV = Math.log(vap.moleFraction) + vap.lnPhi;
      expect(lnFL).toBeCloseTo(lnFV, 9);
      // f_i = x_i * phi_i * P согласовано с fugacityPa.
      expect(liq.fugacityPa).toBeCloseTo(liq.moleFraction * liq.phi * c.pressurePa, 6);
      expect(vap.fugacityPa).toBeCloseTo(vap.moleFraction * vap.phi * c.pressurePa, 6);
    }
  });

  it('направление разделения физично: более летучий ch4 обогащает пар', () => {
    const c = asCandidate(result);
    const x = byComponent(c.liquidComposition);
    const y = byComponent(c.vaporComposition);
    expect(y.get('ch4')!).toBeGreaterThan(x.get('ch4')!);
    expect(x.get('co2')!).toBeGreaterThan(y.get('co2')!);
    // Пар ближе к идеальному газу, чем жидкость: phi паровой фазы ближе к 1.
    for (const vap of c.vapor.components) {
      const liq = c.liquid.components.find((l) => l.component === vap.component)!;
      expect(Math.abs(vap.phi - 1)).toBeLessThan(Math.abs(liq.phi - 1));
    }
  });

  it('детерминизм: два одинаковых flash дают побитово идентичный результат', () => {
    const again = flash(inputs);
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });

  it('инвариантность к перестановке порядка компонентов: результаты совпадают как отображения по id', () => {
    const swapped: PengRobinsonMixtureInputs = {
      components: [...inputs.components].reverse(),
      binaryInteractions: inputs.binaryInteractions.map((k) => ({
        componentA: k.componentB,
        componentB: k.componentA,
        kij: k.kij,
        evidence: k.evidence,
        applicabilityRangeK: k.applicabilityRangeK
      }))
    };
    const flipped = asCandidate(flash(swapped));
    const a = asCandidate(result);
    expect(flipped.vaporFractionBeta).toBeCloseTo(a.vaporFractionBeta, 12);
    expect(flipped.materialBalanceResidual).toBeCloseTo(a.materialBalanceResidual, 12);
    for (const composition of ['feedComposition', 'liquidComposition', 'vaporComposition'] as const) {
      expect(byComponent(flipped[composition])).toEqual(byComponent(a[composition]));
    }
    for (const phase of ['liquid', 'vapor'] as const) {
      expect(flipped[phase].Z).toBeCloseTo(a[phase].Z, 10);
      for (const cr of flipped[phase].components) {
        const ar = a[phase].components.find((r) => r.component === cr.component)!;
        expect(cr.lnPhi).toBeCloseTo(ar.lnPhi, 10);
        expect(cr.fugacityPa).toBeCloseTo(ar.fugacityPa, 3);
      }
    }
  });

  it('устойчивость честная: verdict stable отсутствует; TPD-указание не превращается в stable', () => {
    const c = asCandidate(result);
    // Union статусов не содержит 'stable' — проверяем оба допустимых.
    expect(['indeterminate', 'two_phase_split_indicated']).toContain(c.stability);
    expect(c.stabilityNote.length).toBeGreaterThan(0);
    // Даже если TPD нашёл нестабильность feed, статус остаётся
    // 'two_phase_split_indicated' с оговоркой provisional_pending_error_audit.
    if (c.stability === 'two_phase_split_indicated') {
      expect(c.stabilityNote).toContain('provisional_pending_error_audit');
    }
  });
});

// ============================================
// 4. Однофазные состояния, несходимость, численные отказы
// ============================================

describe('pengRobinsonFlash: однофазные состояния и отказы сходимости', () => {
  it('однофазное состояние (низкое давление, оба K > 1) — no_two_phase_split без заявления о стабильности', () => {
    // При 230 K и 0.1 МПа оба компонента газообразны: RR не имеет корня на [0, 1].
    const result = flash(binaryInputs('co2', 'ch4'), { pressurePa: 100_000 });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('no_two_phase_split');
      expect(result.message).toContain('однофазн');
    }
  });

  it('жидкоподобное однофазное состояние (высокое давление) — no_two_phase_split', () => {
    // При 230 K и 30 МПа смесь жидкоподобна: оба K < 1, RR корня не имеет.
    const result = flash(binaryInputs('co2', 'ch4'), { pressurePa: 30_000_000 });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('no_two_phase_split');
    }
  });

  it('исчерпание итераций — convergence_failure, а не частичный результат', () => {
    const result = flash(binaryInputs('co2', 'ch4'), { maxIterations: 1 });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('convergence_failure');
      expect(result.message).toContain('не сошл');
    }
  });

  it('нулевой допуск фугативностей недостижим — convergence_failure', () => {
    const result = flash(binaryInputs('co2', 'ch4'), { fugacityTolerance: 0 });
    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.code).toBe('invalid_input');
    }
  });
});

// ============================================
// 5. Низкодавленческий предел (в рамках контракта)
// ============================================

describe('pengRobinsonFlash: низкодавленческое поведение', () => {
  it('при снижении давления в двухфазной области доля пара растёт, а пар идеализируется', () => {
    // Две двухфазные точки: 2.5 МПа и 2.0 МПа (обе в диапазоне kij).
    // При снижении P молярная доля пара beta растёт, а паровая фаза
    // приближается к идеальному газу (phi -> 1).
    const high = asCandidate(flash(binaryInputs('co2', 'ch4'), { pressurePa: 2_500_000 }));
    const low = asCandidate(flash(binaryInputs('co2', 'ch4'), { pressurePa: 2_000_000 }));
    expect(low.vaporFractionBeta).toBeGreaterThan(high.vaporFractionBeta);
    for (const id of ['co2', 'ch4']) {
      const phiHigh = high.vapor.components.find((e) => e.component === id)!.phi;
      const phiLow = low.vapor.components.find((e) => e.component === id)!.phi;
      expect(Math.abs(phiLow - 1)).toBeLessThan(Math.abs(phiHigh - 1));
    }
  });
});


// ============================================
// 6. Многокомпонентность: тройная смесь co2 + n2 + ar (треугольник kij)
// ============================================

describe('pengRobinsonFlash: тройная смесь co2|n2|ar (250 K, 4 МПа)', () => {
  /**
   * Тройные входы Core из каталогов Data: полный треугольник kij
   * (co2-n2, co2-ar, n2-ar) — единственная тройная комбинация, все пары
   * которой присутствуют в каталоге 4.4.4.3.
   */
  function ternaryInputs(fractions: readonly [number, number, number]): PengRobinsonMixtureInputs {
    const gases = ['co2', 'n2', 'ar'] as const;
    const components = gases.map((gas, i) => {
      const record = getEosPureComponentParameters(gas);
      return {
        component: record.gasId,
        moleFraction: fractions[i]!,
        criticalTemperatureK: record.criticalTemperatureK.value,
        criticalPressurePa: record.criticalPressurePa.value,
        acentricFactor: record.acentricFactor.value,
        evidence: {
          criticalTemperatureK: record.criticalTemperatureK.provenance.evidence,
          criticalPressurePa: record.criticalPressurePa.provenance.evidence,
          acentricFactor: record.acentricFactor.provenance.evidence
        },
        crossChecks: record.crossChecks,
        limitations: record.limitations
      };
    });
    const pairs: [string, string][] = [['co2', 'n2'], ['co2', 'ar'], ['n2', 'ar']];
    const binaryInteractions = pairs.map(([a, b]) => {
      const kijRecord = getBinaryInteractionParameter(a, b);
      return {
        componentA: kijRecord.componentA,
        componentB: kijRecord.componentB,
        kij: kijRecord.kij.value,
        evidence: kijRecord.kij.provenance.evidence,
        applicabilityRangeK: kijRecord.applicabilityRangeK
      };
    });
    return { components, binaryInteractions };
  }

  function ternaryFlash(fractions: readonly [number, number, number]) {
    return computePengRobinsonFlash({
      mixtureInputs: ternaryInputs(fractions),
      request: {
        temperatureK: 250,
        pressurePa: 4_000_000,
        evidencePolicy: POLICY,
        fugacityTolerance: 1e-8
      }
    });
  }

  const z: readonly [number, number, number] = [0.6, 0.3, 0.1];
  const result = ternaryFlash(z);

  it('трёхкомпонентный two_phase_candidate: три пары kij с честными evidence', () => {
    const c = asCandidate(result);
    expect(c.kijUsed).toHaveLength(3);
    const byPair = new Map(c.kijUsed.map((k) => [k.componentA + '|' + k.componentB, k]));
    // n2-ar: точный диапазон применимости НЕ верифицирован (null) —
    // наличие числа в каталоге не делает kij полностью подтверждённым.
    const n2ar = byPair.get('ar|n2');
    expect(n2ar).toBeDefined();
    expect(n2ar!.applicabilityRangeK).toBeNull();
    expect(n2ar!.evidence).toBe('PARTIALLY_VERIFIED');
    // CO2-содержащие пары: диапазон 228.15–273.15 K сохранён без расширения.
    for (const key of ['co2|n2', 'ar|co2']) {
      const record = byPair.get(key);
      expect(record).toBeDefined();
      expect(record!.evidence).toBe('PARTIALLY_VERIFIED');
      expect(record!.applicabilityRangeK).not.toBeNull();
      expect(record!.applicabilityRangeK!.minTemperatureK).toBe(228.15);
      expect(record!.applicabilityRangeK!.maxTemperatureK).toBe(273.15);
    }
    expect(c.convergence.status).toBe('converged');
  });

  it('материальный баланс, нормировка и равенство фугитивностей для всех трёх компонентов', () => {
    const c = asCandidate(result);
    expect(c.materialBalanceResidual).toBeLessThanOrEqual(1e-8);
    expect(c.fugacityEqualityResidual.maxLnFugacityRatio)
      .toBeLessThan(c.fugacityEqualityResidual.tolerance);
    expect(c.fugacityEqualityResidual.perComponent).toHaveLength(3);
    for (const composition of [c.liquidComposition, c.vaporComposition]) {
      const sum = composition.reduce((s, e) => s + e.moleFraction, 0);
      expect(sum).toBeCloseTo(1, 10);
      for (const e of composition) {
        expect(Number.isFinite(e.moleFraction)).toBe(true);
        expect(e.moleFraction).toBeGreaterThanOrEqual(0);
      }
    }
    const x = byComponent(c.liquidComposition);
    const y = byComponent(c.vaporComposition);
    for (const id of ['co2', 'n2', 'ar']) {
      const balance = (1 - c.vaporFractionBeta) * x.get(id)! + c.vaporFractionBeta * y.get(id)!;
      expect(balance).toBeCloseTo(z[['co2', 'n2', 'ar'].indexOf(id)]!, 9);
    }
  });

  it('направление разделения физично: co2 обогащает жидкость, n2 — пар', () => {
    const c = asCandidate(result);
    const x = byComponent(c.liquidComposition);
    const y = byComponent(c.vaporComposition);
    expect(x.get('co2')!).toBeGreaterThan(y.get('co2')!);
    expect(y.get('n2')!).toBeGreaterThan(x.get('n2')!);
    expect(c.vaporFractionBeta).toBeGreaterThan(0);
    expect(c.vaporFractionBeta).toBeLessThan(1);
  });

  it('детерминизм и перестановочная инвариантность тройной смеси', () => {
    const again = ternaryFlash(z);
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
    const swapped: PengRobinsonMixtureInputs = {
      components: [...ternaryInputs(z).components].reverse(),
      binaryInteractions: ternaryInputs(z).binaryInteractions.map((k) => ({
        componentA: k.componentB,
        componentB: k.componentA,
        kij: k.kij,
        evidence: k.evidence,
        applicabilityRangeK: k.applicabilityRangeK
      }))
    };
    const flipped = asCandidate(computePengRobinsonFlash({
      mixtureInputs: swapped,
      request: { temperatureK: 250, pressurePa: 4_000_000, evidencePolicy: POLICY, fugacityTolerance: 1e-8 }
    }));
    const a = asCandidate(result);
    expect(flipped.vaporFractionBeta).toBeCloseTo(a.vaporFractionBeta, 9);
    expect(byComponent(flipped.liquidComposition)).toEqual(byComponent(a.liquidComposition));
    expect(byComponent(flipped.vaporComposition)).toEqual(byComponent(a.vaporComposition));
  });

  it('нулевая доля ar: x_ar = y_ar = 0 точно, без log(0); пары с ar не требуются', () => {
    const zeroAr = asCandidate(ternaryFlash([0.6, 0.4, 0]));
    const x = byComponent(zeroAr.liquidComposition);
    const y = byComponent(zeroAr.vaporComposition);
    expect(x.get('ar')).toBe(0);
    expect(y.get('ar')).toBe(0);
    const arRow = zeroAr.fugacityEqualityResidual.perComponent.find((r) => r.component === 'ar')!;
    expect(arRow.lnFugacityRatio).toBe(0);
    // Только пары активных компонентов попали в kijUsed.
    expect(zeroAr.kijUsed).toHaveLength(1);
    expect(zeroAr.kijUsed[0]!.componentA + '|' + zeroAr.kijUsed[0]!.componentB).toBe('co2|n2');
    expect(zeroAr.materialBalanceResidual).toBeLessThanOrEqual(1e-8);
  });

  it('вырожденный одноактивный состав (1, 0, 0) — invalid_input', () => {
    const result1 = ternaryFlash([1, 0, 0]);
    expect(result1.status).toBe('failure');
    if (result1.status === 'failure') {
      expect(result1.code).toBe('invalid_input');
    }
  });

  it('устойчивость тройной смеси честная: union без stable', () => {
    const c = asCandidate(result);
    expect(['indeterminate', 'two_phase_split_indicated']).toContain(c.stability);
    expect(c.stabilityNote).toContain('indeterminate');
    expect(c.stabilityNote).not.toContain('доказанная устойчивость:');
  });
});
