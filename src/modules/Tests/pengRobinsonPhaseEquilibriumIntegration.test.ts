// ============================================
// STAGE 4.4.4.7 - Интеграционные тесты:
// PhaseEquilibrium -> Data/pengRobinsonFlashFacade -> Core flash
// ============================================
//
// Покрывают ЯВНЫЙ PR-based VLE API PhaseEquilibrium: контрольные точки
// co2|ch4 (230 K, 2 МПа) и co2|n2|ar (250 K, 4 МПа) с проверкой
// материального баланса и равенства фугитивностей, fail-closed отказы
// (отсутствующий kij, неизвестный компонент, недопустимая политика,
// температура вне диапазона kij), некорректные входы (сумма долей,
// не-конечные значения), недоступность TPD-скрининга, перестановочную
// инвариантность, детерминизм, адаптер атмосферы с явными
// диагностиками и НЕИЗМЕННОСТЬ legacy Antoine-скрининга.
//
// Честность: two_phase_candidate не трактуется как stable;
// indeterminate остаётся indeterminate; evidence-статусы не повышаются.

import { describe, it, expect } from 'vitest';
import {
  analyzeVleWithPengRobinson,
  analyzeAtmosphereVleWithPengRobinson,
  PR_VLE_EXPLICIT_API_NOTE,
  PR_VLE_CANDIDATE_NOTE,
  PR_VLE_INDETERMINATE_NOTE,
  PR_VLE_PROVENANCE_NOTE
} from '../PhaseEquilibrium/pengRobinsonVle';
import {
  saturationPressure,
  checkComponentPhase,
  analyzeAtmospherePhases,
  MIXTURE_MODEL_NOTE
} from '../PhaseEquilibrium/index';
import type { AtmospherePhysicalModel } from '../../types';
import type {
  PengRobinsonVleRequest,
  PengRobinsonVleResult
} from '../PhaseEquilibrium/pengRobinsonVle';

const AUCC = 'allow_unresolved_cross_check' as const;

const BINARY_CO2_CH4 = [
  { gasId: 'co2', moleFraction: 0.75 },
  { gasId: 'ch4', moleFraction: 0.25 }
];
const TERNARY_CO2_N2_AR = [
  { gasId: 'co2', moleFraction: 0.6 },
  { gasId: 'n2', moleFraction: 0.3 },
  { gasId: 'ar', moleFraction: 0.1 }
];

function vle(overrides: Partial<PengRobinsonVleRequest> = {}): PengRobinsonVleResult {
  return analyzeVleWithPengRobinson({
    temperatureK: 230,
    pressurePa: 2_000_000,
    composition: BINARY_CO2_CH4,
    evidencePolicy: AUCC,
    ...overrides
  });
}

function asCandidate(r: PengRobinsonVleResult) {
  expect(r.status).toBe('two_phase_candidate');
  if (r.status !== 'two_phase_candidate') throw new Error('expected two_phase_candidate');
  return r.flash;
}

function asFailure(r: PengRobinsonVleResult): { code: string; text: string } {
  expect(r.status).toBe('failure');
  if (r.status !== 'failure') throw new Error('expected failure');
  return { code: r.code, text: r.message + ' ' + (r.detail ?? '') };
}

function byComponent(
  entries: readonly { component?: string; moleFraction: number }[]
): Map<string, number> {
  return new Map(entries.map((e) => [e.component ?? '', e.moleFraction]));
}

function makeModel(overrides: Partial<AtmospherePhysicalModel> = {}): AtmospherePhysicalModel {
  return {
    molarFractions: { co2: 0.75, ch4: 0.25 },
    surfacePressurePa: {
      value: 2_000_000,
      unit: 'Pa',
      confidence: 'derived',
      method: 'p_i = x_i · P_total (тестовая фикстура)'
    },
    meanMolarMassKgMol: { value: 0.0374, unit: 'kg/mol', confidence: 'derived' },
    partialPressuresPa: {
      co2: { value: 1_500_000, unit: 'Pa', confidence: 'derived' },
      ch4: { value: 500_000, unit: 'Pa', confidence: 'derived' }
    },
    columnMassKgM2: null,
    columnMolM2: null,
    idealGasAssumption: true,
    idealGasNote: 'тестовая фикстура',
    fugacityNote: 'тестовая фикстура',
    layers: [],
    layersNote: '',
    notes: [],
    ...overrides
  };
}

// ============================================
// 1. Явный API: контрольная точка co2|ch4 (230 K, 2 МПа)
// ============================================

describe('pengRobinsonVle: бинарный co2|ch4 (230 K, 2 МПа)', () => {
  const result = vle();

  it('возвращает two_phase_candidate со значениями контрольной точки', () => {
    const c = asCandidate(result);
    expect(c.temperatureK).toBe(230);
    expect(c.pressurePa).toBe(2_000_000);
    expect(c.evidencePolicy).toBe('allow_unresolved_cross_check');
    expect(c.convergence.status).toBe('converged');
    expect(c.vaporFractionBeta).toBeCloseTo(0.434788, 4);
    const x = byComponent(c.liquidComposition);
    const y = byComponent(c.vaporComposition);
    expect(x.get('co2')!).toBeCloseTo(0.950184, 4);
    expect(x.get('ch4')!).toBeCloseTo(0.049816, 4);
    expect(y.get('co2')!).toBeCloseTo(0.489767, 4);
    expect(y.get('ch4')!).toBeCloseTo(0.510233, 4);
  });

  it('материальный баланс и равенство фугитивностей — в допусках', () => {
    const c = asCandidate(result);
    expect(c.materialBalanceResidual).toBeLessThanOrEqual(1e-8);
    expect(c.fugacityEqualityResidual.maxLnFugacityRatio)
      .toBeLessThan(c.fugacityEqualityResidual.tolerance);
    expect(c.fugacityEqualityResidual.perComponent).toHaveLength(2);
    // Материальный баланс состава фаз: z_i = (1-beta)*x_i + beta*y_i.
    const z = byComponent(c.feedComposition);
    const x = byComponent(c.liquidComposition);
    const y = byComponent(c.vaporComposition);
    for (const [gasId, zi] of z) {
      const mixed = (1 - c.vaporFractionBeta) * x.get(gasId)! + c.vaporFractionBeta * y.get(gasId)!;
      expect(mixed).toBeCloseTo(zi, 10);
    }
  });

  it('кандидат честно маркирован: stable НЕ заявляется, предупреждения интеграции присутствуют', () => {
    const c = asCandidate(result);
    expect(result.warnings).toContain(PR_VLE_EXPLICIT_API_NOTE);
    expect(result.warnings).toContain(PR_VLE_CANDIDATE_NOTE);
    expect(result.warnings).toContain(PR_VLE_PROVENANCE_NOTE);
    expect(['indeterminate', 'two_phase_split_indicated']).toContain(c.stability);
    expect((c as { stability?: string }).stability).not.toBe('stable');
  });

  it('provenance чистых параметров и kij передан без повышения evidence', () => {
    const c = asCandidate(result);
    expect(c.componentParameters).toHaveLength(2);
    expect(c.binaryInteractionParameters).toHaveLength(1);
    expect(c.binaryInteractionParameters[0]!.kij.provenance.evidence).toBe('PARTIALLY_VERIFIED');
    expect(c.kijUsed[0]!.kij).toBe(c.binaryInteractionParameters[0]!.kij.value);
  });
});

// ============================================
// 2. Тройная co2|n2|ar (250 K, 4 МПа)
// ============================================

describe('pengRobinsonVle: тройной co2|n2|ar (250 K, 4 МПа)', () => {
  const result = vle({
    temperatureK: 250,
    pressurePa: 4_000_000,
    composition: TERNARY_CO2_N2_AR,
    fugacityTolerance: 1e-8
  });

  it('трёхкомпонентный кандидат с тремя парами kij, баланс и фугитивности в допуске', () => {
    const c = asCandidate(result);
    expect(c.binaryInteractionParameters).toHaveLength(3);
    expect(c.vaporFractionBeta).toBeCloseTo(0.864075, 4);
    expect(c.materialBalanceResidual).toBeLessThanOrEqual(1e-8);
    expect(c.fugacityEqualityResidual.maxLnFugacityRatio)
      .toBeLessThan(c.fugacityEqualityResidual.tolerance);
    expect(c.fugacityEqualityResidual.perComponent).toHaveLength(3);
    // Непроверенный диапазон n2-ar остаётся null (не выдумывается).
    const byPair = new Map(c.binaryInteractionParameters.map((p) => [p.pairKey, p]));
    expect(byPair.get('ar|n2')!.applicabilityRangeK).toBeNull();
  });

  it('перестановка компонентов инвариантна', () => {
    const flipped = asCandidate(
      vle({
        temperatureK: 250,
        pressurePa: 4_000_000,
        composition: [...TERNARY_CO2_N2_AR].reverse(),
        fugacityTolerance: 1e-8
      })
    );
    const a = asCandidate(result);
    expect(flipped.vaporFractionBeta).toBeCloseTo(a.vaporFractionBeta, 9);
    expect(byComponent(flipped.liquidComposition)).toEqual(byComponent(a.liquidComposition));
    expect(byComponent(flipped.vaporComposition)).toEqual(byComponent(a.vaporComposition));
  });
});

// ============================================
// 3. Детерминизм
// ============================================

describe('pengRobinsonVle: детерминизм', () => {
  it('повторный вызов с тем же входом даёт идентичный результат', () => {
    const a = vle();
    const b = vle();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

// ============================================
// 4. Fail-closed отказы
// ============================================

describe('pengRobinsonVle: fail-closed отказы', () => {
  it('отсутствующий бинарный параметр (co2|n2|ch4) — missing_binary_interaction, kij = 0 не подставляется', () => {
    const f = asFailure(
      vle({
        composition: [
          { gasId: 'co2', moleFraction: 0.4 },
          { gasId: 'n2', moleFraction: 0.3 },
          { gasId: 'ch4', moleFraction: 0.3 }
        ]
      })
    );
    expect(f.code).toBe('missing_binary_interaction');
    expect(f.text).toContain('ch4|n2');
  });

  it('неизвестный компонент — invalid_input', () => {
    const f = asFailure(
      vle({ composition: [{ gasId: 'co2', moleFraction: 0.5 }, { gasId: 'unobtainium', moleFraction: 0.5 }] })
    );
    expect(f.code).toBe('invalid_input');
    expect(f.text).toContain('unobtainium');
  });

  it('недопустимая evidencePolicy — явный отказ', () => {
    const f = asFailure(
      // @ts-expect-error — намеренно недопустимая политика
      vle({ evidencePolicy: 'bogus_policy' })
    );
    expect(f.code).toBe('invalid_input');
  });

  it('температура вне диапазона применимости kij — temperature_applicability', () => {
    const f = asFailure(vle({ temperatureK: 300 }));
    expect(f.code).toBe('temperature_applicability');
  });
});

// ============================================
// 5. Некорректные входы (интеграционный слой)
// ============================================

describe('pengRobinsonVle: некорректные входы', () => {
  it('некорректная сумма молярных долей — invalid_input без нормализации', () => {
    const f = asFailure(
      vle({ composition: [{ gasId: 'co2', moleFraction: 0.5 }, { gasId: 'ch4', moleFraction: 0.6 }] })
    );
    expect(f.code).toBe('invalid_input');
    expect(f.text).toContain('сумма');
  });

  it('не-конечные входы — invalid_input с явной диагностикой', () => {
    expect(asFailure(vle({ temperatureK: NaN })).code).toBe('invalid_input');
    expect(asFailure(vle({ temperatureK: Infinity })).code).toBe('invalid_input');
    expect(asFailure(vle({ pressurePa: NaN })).code).toBe('invalid_input');
    expect(asFailure(vle({ pressurePa: -Infinity })).code).toBe('invalid_input');
    const bad = asFailure(
      vle({ composition: [{ gasId: 'co2', moleFraction: NaN }, { gasId: 'ch4', moleFraction: 1 }] })
    );
    expect(bad.code).toBe('invalid_input');
    expect(bad.text).toContain('конечное');
  });
});

// ============================================
// 6. Недоступность TPD-скрининга
// ============================================

describe('pengRobinsonVle: недоступность TPD-скрининга', () => {
  it('без TPD-скрининга stability остаётся indeterminate с явным предупреждением, stable НЕ появляется', () => {
    const r = vle({ stabilityScreening: false });
    const c = asCandidate(r);
    expect(c.stability).toBe('indeterminate');
    expect(r.warnings).toContain(PR_VLE_INDETERMINATE_NOTE);
    expect(c.stability).not.toBe('stable');
  });
});

// ============================================
// 7. Адаптер атмосферы
// ============================================

describe('analyzeAtmosphereVleWithPengRobinson: адаптер атмосферы', () => {
  it('успех по явным molarFractions и surfacePressurePa', () => {
    const r = analyzeAtmosphereVleWithPengRobinson(makeModel(), 230, AUCC);
    const c = asCandidate(r);
    expect(c.evidencePolicy).toBe('allow_unresolved_cross_check');
    expect(c.vaporFractionBeta).toBeCloseTo(0.434788, 4);
  });

  it('неизвестное давление — явная диагностика, НЕ выводится из игровых допущений', () => {
    const f = asFailure(
      analyzeAtmosphereVleWithPengRobinson(
        makeModel({ surfacePressurePa: null }),
        230,
        AUCC
      )
    );
    expect(f.code).toBe('atmosphere_pressure_unavailable');
    expect(f.text).toContain('неизвестно');
  });

  it('не-конечная молярная доля — invalid_input без подмены', () => {
    const f = asFailure(
      analyzeAtmosphereVleWithPengRobinson(
        makeModel({ molarFractions: { co2: NaN, ch4: 0.25 } }),
        230,
        AUCC
      )
    );
    expect(f.code).toBe('invalid_input');
    expect(f.text).toContain('co2');
  });

  it('пустой состав — invalid_input', () => {
    const f = asFailure(
      analyzeAtmosphereVleWithPengRobinson(makeModel({ molarFractions: {} }), 230, AUCC)
    );
    expect(f.code).toBe('invalid_input');
  });

  it('не-конечная температура — invalid_input', () => {
    const f = asFailure(analyzeAtmosphereVleWithPengRobinson(makeModel(), NaN, AUCC));
    expect(f.code).toBe('invalid_input');
  });
});

// ============================================
// 8. Сохранение legacy Antoine-поведения
// ============================================

describe('pengRobinsonVle: legacy Antoine-скрининг не изменён', () => {
  it('saturationPressure / checkComponentPhase / analyzeAtmospherePhases идентичны до и после PR-вызовов', () => {
    const model = makeModel();
    const snapshot = () =>
      JSON.stringify({
        sat: saturationPressure('co2', 230),
        satCh4: saturationPressure('ch4', 230),
        satUnknown: saturationPressure('unobtainium', 230),
        comp: checkComponentPhase({ gasId: 'co2', partialPressurePa: 1_500_000, temperatureK: 230 }),
        analysis: analyzeAtmospherePhases(model, 230)
      });
    const before = snapshot();
    // Явные PR-вызовы не должны влиять на legacy-скрининг.
    asCandidate(vle());
    asCandidate(analyzeAtmosphereVleWithPengRobinson(model, 230, AUCC));
    expect(snapshot()).toBe(before);
    // Legacy-семантика не подменена PR: mixtureNote остаётся скрининговым.
    const analysis = analyzeAtmospherePhases(model, 230);
    expect(analysis.mixtureNote).toBe(MIXTURE_MODEL_NOTE);
    // Контроль: Antoine-значение co2 при 230 K — в разумном диапазоне (скрининг жив).
    expect(saturationPressure('co2', 230).pressurePa).toBeGreaterThan(0);
  });
});
