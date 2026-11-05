// ============================================
// ТЕСТЫ Stage 4.4.4.2 — чистокомпонентный Peng–Robinson: Z, phi, фугитивность
// ============================================
//
// Источники формул и констант:
// - Peng & Robinson 1976, Ind. Eng. Chem. Fundam. 15(1):59–64,
//   doi:10.1021/i160057a011 (кубическое уравнение, ln(phi), kappa(omega),
//   Zc = 0.307 для точных констант Omega_a/Omega_b);
// - R = N_A·k = 8.31446261815324 J/(mol*K) — точное значение СИ-2019,
//   единая константа репозитория (Core/thermoFunctions.ts);
// - каталог параметров Stage 4.4.4.1 (src/modules/Data/eosParameters.ts).
//
// НЕЗАВИСИМЫЙ ПРОГРАММНЫЙ BENCHMARK (CoolProp, backend 'PR') НЕ ВЫПОЛНЕН:
// в среде разработки нет доступа к CoolProp (блокер зафиксирован в
// docs/science/DATA_PROVENANCE.md §2.30). Числа ниже — либо аналитические
// величины (критическая точка, идеальный предел, двойной корень,
// сконструированные A/B), либо результаты закрытой реализации PR,
// проверенные НЕЗАВИСИМЫМИ путями:
//   (а) интегральное тождество ln(phi) = Int (Z-1)/P dP (правая часть
//       вычисляется квадратурой Симпсона по самой кубике — независимый
//       путь через EOS);
//   (б) равенство фугитивностей vapor/liquid ветвей на PR-изобаре
//       насыщения (бисекция по условию f_v = f_l);
//   (в) идеальный предел P -> 0 (Z -> 1, phi -> 1, линейность по P);
//   (г) тройной корень в критической точке для ТОЧНЫХ констант
//       Omega_a = 0.4572355289213822, Omega_b = 0.07779607390388846
//       (Zc = (1 - Omega_b)/3 = 0.3074013… против опубликованных 0.307).
// Этап по benchmark-критерию честно считается ЧАСТИЧНЫМ.

import { describe, expect, it } from 'vitest';

import {
  computePengRobinsonPure,
  computePengRobinsonPureParameters,
  pengRobinsonCubicCoefficients,
  pengRobinsonLnPhi,
  prPhysicalRoots,
  solvePrCubicRealRoots
} from '../Core/pengRobinson';

// R — единая константа репозитория (точное СИ-2019), из Core/thermoFunctions.
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';

import type {
  PengRobinsonEvidencePolicy,
  PengRobinsonPureFailure,
  PengRobinsonPureRequest,
  PengRobinsonPureResult,
  PengRobinsonPureSuccess
} from '../Core/pengRobinson';

import {
  EOS_PURE_COMPONENT_IDS,
  EOS_PURE_COMPONENT_PARAMETERS,
  getEosPureComponentParameters
} from '../Data/eosParameters';

// ============================================
// ХЕЛПЕРЫ
// ============================================

function baseRequest(overrides: Partial<PengRobinsonPureRequest> = {}): PengRobinsonPureRequest {
  return {
    gasId: 'co2',
    temperatureK: 300,
    pressurePa: 1e6,
    root: 'vapor',
    evidencePolicy: 'allow_partial',
    ...overrides
  };
}

function expectSuccess(result: PengRobinsonPureResult): PengRobinsonPureSuccess {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`ожидался успех, получен отказ: ${JSON.stringify(result)}`);
  }
  return result;
}

function expectFailure(
  result: PengRobinsonPureResult,
  code: PengRobinsonPureFailure['code']
): PengRobinsonPureFailure {
  expect(result.status).toBe('failure');
  if (result.status !== 'failure') {
    throw new Error(`ожидался отказ ${code}, получен успех`);
  }
  expect(result.code).toBe(code);
  return result;
}

function expectAllNumbersFinite(s: PengRobinsonPureSuccess): void {
  const numericFields = [
    'temperatureK',
    'pressurePa',
    'kappa',
    'alpha',
    'aPaM6PerMol2',
    'bM3PerMol',
    'dimensionlessA',
    'dimensionlessB',
    'Z',
    'lnPhi',
    'phi',
    'fugacityPa',
    'selectedRoot'
  ] as const;
  for (const field of numericFields) {
    expect(Number.isFinite(s[field])).toBe(true);
  }
  for (const z of [...s.realRoots, ...s.physicalRoots]) {
    expect(Number.isFinite(z)).toBe(true);
  }
}

/** Разность ln(phi) ветвей liquid/vapor (null при отказе хотя бы одной ветви). */
function lnPhiPair(
  gasId: 'co2' | 'n2',
  temperatureK: number,
  pressurePa: number
): { v: number; l: number; zv: number; zl: number } | null {
  const rv = computePengRobinsonPure({
    gasId,
    temperatureK,
    pressurePa,
    root: 'vapor',
    evidencePolicy: 'allow_partial'
  });
  const rl = computePengRobinsonPure({
    gasId,
    temperatureK,
    pressurePa,
    root: 'liquid',
    evidencePolicy: 'allow_partial'
  });
  if (rv.status !== 'success' || rl.status !== 'success') {
    return null;
  }
  return { v: rv.lnPhi, l: rl.lnPhi, zv: rv.Z, zl: rl.Z };
}

/**
 * PR-давление насыщения бисекцией по условию f_v = f_l
 * (ln(phi)_vapor = ln(phi)_liquid): сканирование вниз от pStart (выше
 * насыщения, жидкость устойчива: ln(phi)_l < ln(phi)_v) до смены знака,
 * затем 200 итераций бисекции. Термодинамическая самосогласованность
 * EOS: пересечение фугитивностей ветвей существует и единственно.
 */
function findPrSaturationPressure(gasId: 'co2' | 'n2', temperatureK: number, pStart: number): number {
  const g = (P: number): number => {
    const pair = lnPhiPair(gasId, temperatureK, P);
    return pair === null ? Number.NaN : pair.l - pair.v;
  };
  let hi = pStart;
  let lo = pStart;
  for (let i = 0; i < 200; i += 1) {
    lo *= 0.95;
    if (g(lo) > 0) {
      break;
    }
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (g(mid) > 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// ============================================
// 1. ИДЕАЛЬНЫЙ ПРЕДЕЛ P -> 0
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — идеальный предел P -> 0', () => {
  it('Z -> 1 и phi -> 1 при P -> 0 (co2, 300 K)', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 300, pressurePa: 1 })));
    expectAllNumbersFinite(s);
    // Замкнутая форма: Z = 1 + (B - A) + O(P^2) при малых P.
    expect(s.dimensionlessA).toBeLessThan(1e-7);
    expect(s.dimensionlessB).toBeLessThan(1e-7);
    expect(s.Z).toBeCloseTo(0.9999999463797848, 12);
    expect(Math.abs(s.lnPhi)).toBeLessThan(1e-7);
    expect(s.phi).toBeCloseTo(1, 6);
    expect(s.fugacityPa).toBeCloseTo(1, 6);
  });

  it('Z линеен по P в идеальном пределе (co2, 300 K, P = 100 Pa)', () => {
    const s1 = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 300, pressurePa: 1 })));
    const s100 = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 300, pressurePa: 100 })));
    expect(s100.Z).toBeCloseTo(0.9999946379647806, 12);
    // (1 - Z(100)) = 100 * (1 - Z(1)) * (1 + O(P)) — линейность по P.
    const ratio = (1 - s100.Z) / (1 - s1.Z);
    expect(Math.abs(ratio - 100)).toBeLessThan(1e-3);
  });

  it('идеальный предел выполняется для всех пяти компонентов каталога', () => {
    const policies: Record<string, PengRobinsonEvidencePolicy> = {
      co2: 'allow_partial',
      n2: 'allow_partial',
      ch4: 'allow_unresolved_cross_check',
      h2o: 'allow_partial',
      ar: 'allow_partial'
    };
    for (const gasId of EOS_PURE_COMPONENT_IDS) {
      const s = expectSuccess(
        computePengRobinsonPure(
          baseRequest({ gasId, temperatureK: 300, pressurePa: 10, evidencePolicy: policies[gasId] })
        )
      );
      // h2o имеет наибольшие a/b: |Z - 1| ~ 1.5e-6 даже при 10 Па —
      // допуск 1e-5 покрывает все пять компонентов с запасом.
      expect(Math.abs(s.Z - 1)).toBeLessThan(1e-5);
      expect(Math.abs(s.phi - 1)).toBeLessThan(1e-5);
      expect(Math.abs(s.fugacityPa - 10)).toBeLessThan(1e-4);
    }
  });
});

// ============================================
// 2. НОРМАЛЬНЫЕ И ВЫСОКИЕ ДАВЛЕНИЯ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — нормальные и высокие давления', () => {
  it('h2o 800 K, 20 MPa: пар с предупреждением о полярности/ассоциации', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest({ gasId: 'h2o', temperatureK: 800, pressurePa: 2e7 })));
    expectAllNumbersFinite(s);
    expect(s.Z).toBeCloseTo(0.8406353859067515, 12);
    expect(s.phi).toBeCloseTo(0.8503760335100439, 12);
    const warning = s.warnings.find((w) => w.code === 'h2o_classical_pr_limitations');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('полярн');
    expect(warning?.message).toContain('ассоци');
  });

  it('ar 200 K, 1 MPa: слабые взаимодействия, phi близок к 1', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest({ gasId: 'ar', temperatureK: 200, pressurePa: 1e6 })));
    expect(s.Z).toBeCloseTo(0.9645859106674826, 12);
    expect(s.phi).toBeCloseTo(0.9651787228882104, 12);
  });

  it('ch4 200 K, 1 MPa: суперкритическая температура, предупреждение о конфликте omega', () => {
    const s = expectSuccess(
      computePengRobinsonPure(
        baseRequest({ gasId: 'ch4', temperatureK: 200, pressurePa: 1e6, evidencePolicy: 'allow_unresolved_cross_check' })
      )
    );
    expect(s.Z).toBeCloseTo(0.9252353808956797, 12);
    expect(s.phi).toBeCloseTo(0.929087887326945, 12);
    expect(s.warnings.find((w) => w.code === 'unresolved_cross_check_parameter')).toBeDefined();
  });

  it('co2 250 K: сжатие пара и жидкости растёт с давлением (2 -> 3 MPa)', () => {
    const v2 = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 2e6 })));
    const v3 = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 3e6 })));
    const l2 = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 2e6, root: 'liquid' })));
    const l3 = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 3e6, root: 'liquid' })));
    expect(v2.Z).toBeGreaterThan(v3.Z);
    expect(l2.Z).toBeLessThan(l3.Z);
    expect(v3.Z).toBeCloseTo(0.6113430329320095, 12);
    expect(l3.Z).toBeCloseTo(0.05895036236602158, 12);
    expect(l3.phi).toBeCloseTo(0.5089253481353818, 12);
  });
});

// ============================================
// 3. ОДИН КОРЕНЬ (СВЕРХКРИТИЧЕСКАЯ ОБЛАСТЬ)
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — единственный корень', () => {
  it('co2 350 K, 10 MPa: один действительный корень, обе ветви используют его', () => {
    const vapor = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 350, pressurePa: 1e7 })));
    const liquid = expectSuccess(
      computePengRobinsonPure(baseRequest({ temperatureK: 350, pressurePa: 1e7, root: 'liquid' }))
    );
    expect(vapor.realRoots).toHaveLength(1);
    expect(vapor.physicalRoots).toHaveLength(1);
    expect(vapor.distinctPhysicalRootCount).toBe(1);
    expect(vapor.hasDistinctBranches).toBe(false);
    expect(vapor.Z).toBeCloseTo(0.6512288978680003, 12);
    expect(vapor.lnPhi).toBeCloseTo(-0.340936303642174, 12);
    expect(vapor.phi).toBeCloseTo(0.7111042015115562, 12);
    // Жидкая ветвь выбирает тот же единственный корень с явным предупреждением.
    expect(liquid.Z).toBe(vapor.Z);
    expect(liquid.lnPhi).toBe(vapor.lnPhi);
    const warning = liquid.warnings.find((w) => w.code === 'single_physical_root');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('единственный физически допустимый корень');
  });
});

// ============================================
// 4. ТРИ КОРНЯ НИЖЕ КРИТИЧЕСКОЙ ТЕМПЕРАТУРЫ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — три корня ниже критической температуры', () => {
  it('co2 250 K, 2 MPa: три действительных корня, все физически допустимы', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 2e6 })));
    expect(s.realRoots).toHaveLength(3);
    expect(s.realRoots[0]).toBeCloseTo(0.039538821208198904, 12);
    expect(s.realRoots[1]).toBeCloseTo(0.15073626915579444, 12);
    expect(s.realRoots[2]).toBeCloseTo(0.7840665533701641, 12);
    // Отсортированы по возрастанию.
    expect(s.realRoots[0]).toBeLessThan(s.realRoots[1]);
    expect(s.realRoots[1]).toBeLessThan(s.realRoots[2]);
    // Все три корня > B — физически допустимы.
    expect(s.physicalRoots).toHaveLength(3);
    expect(s.hasDistinctBranches).toBe(true);
    expect(s.warnings.find((w) => w.code === 'single_physical_root')).toBeUndefined();
    // Дисклеймер о характере выбора ветви присутствует всегда.
    expect(s.notes.join(' ')).toContain('НЕ доказывает');
  });
});

// ============================================
// 5. КРАТНЫЕ КОРНИ И КРИТИЧЕСКАЯ ТОЧКА
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — кратные корни и критическая точка', () => {
  it('коэффициенты кубического уравнения (A=0.2, B=0.05)', () => {
    const c = pengRobinsonCubicCoefficients(0.2, 0.05);
    expect(c.c2).toBeCloseTo(-0.95, 12);
    expect(c.c1).toBeCloseTo(0.0925, 12);
    expect(c.c0).toBeCloseTo(-0.007375, 12);
  });

  it('сконструированный двойной корень: дедупликация оставляет 2 различимых корня', () => {
    // Корни z0 = 0.05 (двойной) и z1 = 0.880195193761188:
    // A = 0.13130582290421344, B = 0.01980480623881198.
    const result = solvePrCubicRealRoots(0.13130582290421344, 0.01980480623881198);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('недостижимо');
    }
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0]).toBeCloseTo(0.04999999999999982, 12);
    expect(result.roots[1]).toBeCloseTo(0.8801951937611879, 12);
  });

  it('возмущение A на +-1e-6 расщепляет/схлопывает двойной корень', () => {
    // A + 1e-6: три корня (пара у 0.05 в пределах 5e-3 — ошибки кратных
    // корней ~ sqrt(eps) ~ 1.5e-8 не мешают их различить).
    const three = solvePrCubicRealRoots(0.13130682290421344, 0.01980480623881198);
    expect(three.ok).toBe(true);
    if (!three.ok) {
      throw new Error('недостижимо');
    }
    expect(three.roots).toHaveLength(3);
    expect(Math.abs(three.roots[0] - 0.05)).toBeLessThan(5e-3);
    expect(Math.abs(three.roots[1] - 0.05)).toBeLessThan(5e-3);
    expect(three.roots[2]).toBeCloseTo(0.880193945412825, 10);
    // A - 1e-6: один корень (гиперболическая ветвь без катастрофического
    // сокращения Cardano).
    const one = solvePrCubicRealRoots(0.13130482290421344, 0.01980480623881198);
    expect(one.ok).toBe(true);
    if (!one.ok) {
      throw new Error('недостижимо');
    }
    expect(one.roots).toHaveLength(1);
    expect(one.roots[0]).toBeCloseTo(0.8801964421056651, 12);
  });

  it('точные константы Omega: тройной корень Zc = 0.3074013… (публикация: 0.307)', () => {
    // Peng & Robinson 1976: Zc = 0.307 для ТОЧНЫХ констант
    // Omega_a = 0.4572355289213822, Omega_b = 0.07779607390388846
    // (Zc = (1 - Omega_b)/3 = 0.30740130869870386).
    const OMEGA_A_EXACT = 0.4572355289213822;
    const OMEGA_B_EXACT = 0.07779607390388846;
    const result = solvePrCubicRealRoots(OMEGA_A_EXACT, OMEGA_B_EXACT);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('недостижимо');
    }
    expect(result.roots).toHaveLength(1);
    const zc = (1 - OMEGA_B_EXACT) / 3;
    expect(Math.abs(result.roots[0] - zc)).toBeLessThan(2e-6);
    expect(zc).toBeCloseTo(0.30740130869870386, 12);
  });

  it('каталожная критическая точка co2 (округлённые константы): один корень', () => {
    // Каталог использует ОКРУГЛЁННЫЕ константы PR (0.45724/0.0778): в
    // критической точке кубика вырождается не идеально, и решатель
    // возвращает ОДИН корень Z = 0.3213790… — это корректное следствие
    // округления констант, а НЕ опубликованное Zc = 0.307 (которое
    // выполняется для точных Omega — см. тест выше).
    const s = expectSuccess(
      computePengRobinsonPure(baseRequest({ temperatureK: 304.1282, pressurePa: 7377300 }))
    );
    expect(s.alpha).toBeCloseTo(1, 12);
    expect(s.dimensionlessA).toBeCloseTo(0.45724, 12);
    expect(s.dimensionlessB).toBeCloseTo(0.0778, 12);
    expect(s.realRoots).toHaveLength(1);
    expect(s.Z).toBeCloseTo(0.3213790251736613, 11);
    expect(s.lnPhi).toBeCloseTo(-0.44216403012959704, 11);
    expect(s.warnings.find((w) => w.code === 'single_physical_root')).toBeDefined();
  });
});

// ============================================
// 6. ВЫБОР ВЕТВИ VAPOR/LIQUID
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — выбор ветви vapor/liquid', () => {
  it('vapor = наибольший физически допустимый корень, liquid = наименьший', () => {
    const request = baseRequest({ temperatureK: 250, pressurePa: 2e6 });
    const v = expectSuccess(computePengRobinsonPure(request));
    const l = expectSuccess(computePengRobinsonPure({ ...request, root: 'liquid' }));
    expect(v.root).toBe('vapor');
    expect(l.root).toBe('liquid');
    expect(v.selectedRoot).toBe(v.physicalRoots[v.physicalRoots.length - 1]);
    expect(l.selectedRoot).toBe(l.physicalRoots[0]);
    expect(v.Z).toBeCloseTo(0.7840665533701641, 12);
    expect(v.lnPhi).toBeCloseTo(-0.196993255787904, 12);
    expect(v.phi).toBeCloseTo(0.8211961716151359, 12);
    expect(l.Z).toBeCloseTo(0.039538821208198904, 12);
    expect(l.lnPhi).toBeCloseTo(-0.2896979920906313, 12);
    expect(l.phi).toBeCloseTo(0.7484895832218045, 12);
    // Промежуточные величины не зависят от ветви.
    expect(l.dimensionlessA).toBe(v.dimensionlessA);
    expect(l.dimensionlessB).toBe(v.dimensionlessB);
    expect(l.realRoots).toEqual(v.realRoots);
  });
});

// ============================================
// 7. КОРНИ Z <= B ОТБРАСЫВАЮТСЯ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — корни Z <= B физически недопустимы', () => {
  it('n2 400 K, 5 MPa: два корня ниже B отброшены, остаётся один', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest({ gasId: 'n2', temperatureK: 400, pressurePa: 5e6 })));
    expect(s.realRoots).toHaveLength(3);
    expect(s.realRoots[0]).toBeLessThan(0);
    expect(s.dimensionlessB).toBeCloseTo(0.03613926615230579, 12);
    // 0.005540237764369571 < B = 0.036139… — отброшен вместе с отрицательным.
    expect(s.realRoots[1]).toBeLessThan(s.dimensionlessB);
    expect(s.physicalRoots).toHaveLength(1);
    expect(s.physicalRoots[0]).toBeCloseTo(1.0098511383402604, 12);
    expect(s.Z).toBeCloseTo(1.0098511383402604, 12);
    expect(s.phi).toBeCloseTo(1.0083309629375534, 12);
    expect(s.warnings.find((w) => w.code === 'single_physical_root')).toBeDefined();
  });

  it('низкоуровневые проверки: prPhysicalRoots отбрасывает Z <= B', () => {
    expect(prPhysicalRoots([0], 0)).toEqual([]);
    expect(prPhysicalRoots([-1, 0.05, 0.1], 0.05)).toEqual([0.1]);
    const degenerate = solvePrCubicRealRoots(1, 0);
    expect(degenerate.ok).toBe(true);
    if (!degenerate.ok) {
      throw new Error('недостижимо');
    }
    // A = 1, B = 0: z^3 - z^2 + z = 0 — единственный действительный корень 0.
    expect(degenerate.roots).toHaveLength(1);
    expect(degenerate.roots[0]).toBeCloseTo(0, 12);
  });

  it('неконечные A/B решателем отвергаются', () => {
    expect(solvePrCubicRealRoots(Number.NaN, 0.05).ok).toBe(false);
    expect(solvePrCubicRealRoots(0.2, Number.POSITIVE_INFINITY).ok).toBe(false);
  });
});

// ============================================
// 8. PHI И ФУГИТИВНОСТЬ ПОЛОЖИТЕЛЬНЫ И КОНЕЧНЫ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — phi и фугитивность положительны и конечны', () => {
  it('для всех компонентов и обеих ветвей phi > 0, f > 0, без NaN/Infinity', () => {
    const cases: ReadonlyArray<{ gasId: string; T: number; P: number; policy: PengRobinsonEvidencePolicy }> = [
      { gasId: 'co2', T: 250, P: 2e6, policy: 'allow_partial' },
      { gasId: 'co2', T: 350, P: 1e7, policy: 'allow_partial' },
      { gasId: 'n2', T: 400, P: 5e6, policy: 'allow_partial' },
      { gasId: 'ch4', T: 200, P: 1e6, policy: 'allow_unresolved_cross_check' },
      { gasId: 'h2o', T: 800, P: 2e7, policy: 'allow_partial' },
      { gasId: 'ar', T: 200, P: 1e6, policy: 'allow_partial' }
    ];
    for (const c of cases) {
      for (const root of ['vapor', 'liquid'] as const) {
        const s = expectSuccess(
          computePengRobinsonPure(
            baseRequest({ gasId: c.gasId, temperatureK: c.T, pressurePa: c.P, root, evidencePolicy: c.policy })
          )
        );
        expectAllNumbersFinite(s);
        expect(s.phi).toBeGreaterThan(0);
        expect(s.fugacityPa).toBeGreaterThan(0);
        expect(Number.isFinite(s.lnPhi)).toBe(true);
      }
    }
  });
});

// ============================================
// 9. ТОЖДЕСТВО f = phi * P
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — фугитивность f = phi * P', () => {
  it('fugacityPa === phi * pressurePa для обеих ветвей', () => {
    const v = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 2e6 })));
    const l = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 2e6, root: 'liquid' })));
    const h = expectSuccess(computePengRobinsonPure(baseRequest({ gasId: 'h2o', temperatureK: 800, pressurePa: 2e7 })));
    expect(v.fugacityPa).toBe(v.phi * v.pressurePa);
    expect(l.fugacityPa).toBe(l.phi * l.pressurePa);
    expect(h.fugacityPa).toBe(h.phi * h.pressurePa);
    expect(v.fugacityPa).toBeCloseTo(0.8211961716151359 * 2e6, 10);
  });
});

// ============================================
// 10. ДЕТЕРМИНИЗМ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — детерминизм', () => {
  it('повторные вызовы возвращают структурно идентичный результат', () => {
    const request = baseRequest({ temperatureK: 250, pressurePa: 2e6 });
    const first = computePengRobinsonPure(request);
    const second = computePengRobinsonPure(request);
    expect(first).toStrictEqual(second);
    const l1 = computePengRobinsonPure({ ...request, root: 'liquid' });
    const l2 = computePengRobinsonPure({ ...request, root: 'liquid' });
    expect(l1).toStrictEqual(l2);
  });
});

// ============================================
// 11. ПЛОХИЕ ВХОДЫ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — некорректные входы', () => {
  it('пустой/пробельный gasId — invalid_input', () => {
    const f1 = expectFailure(computePengRobinsonPure(baseRequest({ gasId: '' })), 'invalid_input');
    expect(f1.message).toContain('gasId');
    expectFailure(computePengRobinsonPure(baseRequest({ gasId: '   ' })), 'invalid_input');
  });

  it('компоненты вне каталога (h2, c2h6) — unknown_component', () => {
    const f = expectFailure(computePengRobinsonPure(baseRequest({ gasId: 'h2' })), 'unknown_component');
    expect(f.gasId).toBe('h2');
    expect(f.message).toContain('h2');
    expectFailure(computePengRobinsonPure(baseRequest({ gasId: 'c2h6' })), 'unknown_component');
  });

  it('неконечные и неположительные T/P — invalid_input', () => {
    expectFailure(computePengRobinsonPure(baseRequest({ temperatureK: Number.NaN })), 'invalid_input');
    expectFailure(computePengRobinsonPure(baseRequest({ temperatureK: 0 })), 'invalid_input');
    expectFailure(computePengRobinsonPure(baseRequest({ temperatureK: -300 })), 'invalid_input');
    expectFailure(
      computePengRobinsonPure(baseRequest({ temperatureK: Number.POSITIVE_INFINITY })),
      'invalid_input'
    );
    expectFailure(computePengRobinsonPure(baseRequest({ pressurePa: Number.NaN })), 'invalid_input');
    expectFailure(computePengRobinsonPure(baseRequest({ pressurePa: 0 })), 'invalid_input');
    expectFailure(computePengRobinsonPure(baseRequest({ pressurePa: -1e5 })), 'invalid_input');
    expectFailure(
      computePengRobinsonPure(baseRequest({ pressurePa: Number.NEGATIVE_INFINITY })),
      'invalid_input'
    );
  });

  it('неизвестная ветвь корня — invalid_input', () => {
    const f = expectFailure(
      computePengRobinsonPure(
        baseRequest({ root: 'solid' as unknown as PengRobinsonPureRequest['root'] })
      ),
      'invalid_input'
    );
    expect(f.message).toContain("vapor' или 'liquid'");
  });

  it('отсутствующая политика доказанности — invalid_input (молчаливой подстановки нет)', () => {
    const noPolicy = {
      gasId: 'co2',
      temperatureK: 300,
      pressurePa: 1e6,
      root: 'vapor'
    } as unknown as PengRobinsonPureRequest;
    const f = expectFailure(computePengRobinsonPure(noPolicy), 'invalid_input');
    expect(f.message).toContain('evidencePolicy');
  });

  it('неизвестная политика доказанности — invalid_input', () => {
    expectFailure(
      computePengRobinsonPure(
        baseRequest({ evidencePolicy: 'yolo' as unknown as PengRobinsonEvidencePolicy })
      ),
      'invalid_input'
    );
  });
});

// ============================================
// 12. PROVENANCE И СТАТУСЫ EVIDENCE
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — provenance и статусы доказанности', () => {
  it('успех возвращает ТО ЖЕ (замороженное) provenance-дерево каталога', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest()));
    const catalog = getEosPureComponentParameters('co2');
    expect(s.criticalTemperatureK).toBe(catalog.criticalTemperatureK);
    expect(s.criticalPressurePa).toBe(catalog.criticalPressurePa);
    expect(s.acentricFactor).toBe(catalog.acentricFactor);
    expect(Object.isFrozen(s.criticalTemperatureK)).toBe(true);
    expect(Object.isFrozen(s.criticalTemperatureK.provenance)).toBe(true);
  });

  it('фактические статусы co2: Tc/pc VERIFIED, omega PARTIALLY_VERIFIED', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest()));
    expect(s.evidence).toEqual({
      criticalTemperatureK: 'VERIFIED',
      criticalPressurePa: 'VERIFIED',
      acentricFactor: 'PARTIALLY_VERIFIED'
    });
    expect(s.criticalTemperatureK.provenance.evidence).toBe('VERIFIED');
    expect(s.acentricFactor.provenance.evidence).toBe('PARTIALLY_VERIFIED');
  });

  it('фактический статус omega ch4 — UNRESOLVED_CROSS_CHECK (конфликт не скрыт)', () => {
    const s = expectSuccess(
      computePengRobinsonPure(
        baseRequest({ gasId: 'ch4', evidencePolicy: 'allow_unresolved_cross_check' })
      )
    );
    expect(s.evidence.acentricFactor).toBe('UNRESOLVED_CROSS_CHECK');
    expect(s.acentricFactor.provenance.evidence).toBe('UNRESOLVED_CROSS_CHECK');
    expect(s.evidence.criticalTemperatureK).toBe('VERIFIED');
    expect(s.evidence.criticalPressurePa).toBe('VERIFIED');
  });
});

// ============================================
// 13. ТРИ ПОЛИТИКИ ДОКАЗАННОСТИ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — политики доказанности', () => {
  it('verified_only отказывает ВСЕМ пяти компонентам (omega не VERIFIED)', () => {
    for (const gasId of EOS_PURE_COMPONENT_IDS) {
      const f = expectFailure(
        computePengRobinsonPure(baseRequest({ gasId, evidencePolicy: 'verified_only' })),
        'parameter_evidence_not_accepted'
      );
      expect(f.detail).toContain('acentricFactor=');
      expect(f.message).toContain('verified_only');
    }
    const co2 = expectFailure(
      computePengRobinsonPure(baseRequest({ evidencePolicy: 'verified_only' })),
      'parameter_evidence_not_accepted'
    );
    expect(co2.detail).toContain('acentricFactor=PARTIALLY_VERIFIED');
    const ch4 = expectFailure(
      computePengRobinsonPure(baseRequest({ gasId: 'ch4', evidencePolicy: 'verified_only' })),
      'parameter_evidence_not_accepted'
    );
    expect(ch4.detail).toContain('acentricFactor=UNRESOLVED_CROSS_CHECK');
  });

  it('allow_partial разрешает co2/n2/h2o/ar с предупреждением, ch4 отклоняет', () => {
    for (const gasId of ['co2', 'n2', 'h2o', 'ar'] as const) {
      const s = expectSuccess(computePengRobinsonPure(baseRequest({ gasId, evidencePolicy: 'allow_partial' })));
      const warning = s.warnings.find((w) => w.code === 'partially_verified_parameter');
      expect(warning).toBeDefined();
      expect(warning?.message).toContain('acentricFactor');
      expect(warning?.message).toContain('PARTIALLY_VERIFIED');
    }
    expectFailure(
      computePengRobinsonPure(baseRequest({ gasId: 'ch4', evidencePolicy: 'allow_partial' })),
      'parameter_evidence_not_accepted'
    );
  });

  it('allow_unresolved_cross_check разрешает ch4 с явной диагностикой конфликта', () => {
    const s = expectSuccess(
      computePengRobinsonPure(
        baseRequest({ gasId: 'ch4', temperatureK: 250, pressurePa: 5e6, evidencePolicy: 'allow_unresolved_cross_check' })
      )
    );
    expectAllNumbersFinite(s);
    const warning = s.warnings.find((w) => w.code === 'unresolved_cross_check_parameter');
    expect(warning).toBeDefined();
    // Конфликт значений omega виден в сообщении: 0.01142 против ~0.00661.
    expect(warning?.message).toContain('0.01142');
    expect(warning?.message).toContain('0.00661');
    expect(warning?.message).toContain('allow_unresolved_cross_check');
    // Для политик allow_partial/verified_only отказ детализирует конфликт.
    const f = expectFailure(
      computePengRobinsonPure(baseRequest({ gasId: 'ch4', evidencePolicy: 'allow_partial' })),
      'parameter_evidence_not_accepted'
    );
    expect(f.message).toContain('UNRESOLVED_CROSS_CHECK');
  });

  it('h2 не проходит ни при одной политике (unknown_component до проверки статусов)', () => {
    for (const evidencePolicy of [
      'verified_only',
      'allow_partial',
      'allow_unresolved_cross_check'
    ] as const) {
      expectFailure(
        computePengRobinsonPure(baseRequest({ gasId: 'h2', evidencePolicy })),
        'unknown_component'
      );
    }
  });
});

// ============================================
// 14. RUNTIME-ИММУТАБЕЛЬНОСТЬ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — runtime-иммутабельность', () => {
  it('попытка мутации provenance результата бросает TypeError и не портит каталог', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest()));
    const catalog = getEosPureComponentParameters('co2');
    const before = catalog.criticalTemperatureK.value;
    expect(() => {
      (s.criticalTemperatureK as unknown as { value: number }).value = 999;
    }).toThrow(TypeError);
    expect(() => {
      (s.acentricFactor.provenance as unknown as { evidence: string }).evidence = 'VERIFIED';
    }).toThrow(TypeError);
    expect(catalog.criticalTemperatureK.value).toBe(before);
    expect(catalog.acentricFactor.provenance.evidence).toBe('PARTIALLY_VERIFIED');
    // Повторный lookup возвращает исходные значения.
    expect(getEosPureComponentParameters('co2').criticalTemperatureK.value).toBe(before);
  });

  it('каталог и реестр ID глубоко заморожены', () => {
    expect(Object.isFrozen(EOS_PURE_COMPONENT_PARAMETERS)).toBe(true);
    expect(Object.isFrozen(EOS_PURE_COMPONENT_IDS)).toBe(true);
    for (const gasId of EOS_PURE_COMPONENT_IDS) {
      const record = getEosPureComponentParameters(gasId);
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.crossChecks)).toBe(true);
      expect(Object.isFrozen(record.limitations)).toBe(true);
    }
    expect(() => {
      (EOS_PURE_COMPONENT_IDS as unknown as string[]).push('h2');
    }).toThrow(TypeError);
    expect(EOS_PURE_COMPONENT_IDS).toHaveLength(5);
  });
});

// ============================================
// 15. ПРОМЕЖУТОЧНЫЕ ВЕЛИЧИНЫ
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — промежуточные величины', () => {
  it('co2 250 K, 2 MPa: kappa, alpha, a, b, A, B', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 2e6 })));
    expect(s.kappa).toBeCloseTo(0.7064774529578879, 12);
    expect(s.alpha).toBeCloseTo(1.1362424339624086, 12);
    expect(s.aPaM6PerMol2).toBeCloseTo(0.45029749308007133, 12);
    expect(s.bM3PerMol).toBeCloseTo(2.6666930501950694e-5, 15);
    expect(s.dimensionlessA).toBeCloseTo(0.20844003496011448, 12);
    expect(s.dimensionlessB).toBeCloseTo(0.025658356265842515, 12);
  });

  it('ch4 200 K, 1 MPa: kappa, alpha, a, b, A, B', () => {
    const s = expectSuccess(
      computePengRobinsonPure(
        baseRequest({ gasId: 'ch4', temperatureK: 200, pressurePa: 1e6, evidencePolicy: 'allow_unresolved_cross_check' })
      )
    );
    expect(s.kappa).toBeCloseTo(0.392217407205312, 12);
    expect(s.alpha).toBeCloseTo(0.9809055656396592, 12);
    expect(s.aPaM6PerMol2).toBeCloseTo(0.24481566849001654, 12);
    expect(s.bM3PerMol).toBeCloseTo(2.6802317444263274e-5, 15);
    expect(s.dimensionlessA).toBeCloseTo(0.08853415534145982, 12);
    expect(s.dimensionlessB).toBeCloseTo(0.01611788919812141, 12);
  });

  it('computePengRobinsonPureParameters согласован с закрытой реализацией (ar)', () => {
    // Независимый пересчёт по формулам PR 1976 с R CODATA.
    const R = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
    const Tc = 150.687;
    const Pc = 4863000;
    const omega = -0.00219;
    const T = 200;
    const P = 1e6;
    const direct = computePengRobinsonPureParameters(Tc, Pc, omega, T, P);
    const kappa = 0.37464 + 1.54226 * omega - 0.26992 * omega * omega;
    const alpha = (1 + kappa * (1 - Math.sqrt(T / Tc))) ** 2;
    const a = (0.45724 * R * R * Tc * Tc * alpha) / Pc;
    const b = (0.0778 * R * Tc) / Pc;
    const A = (a * P) / (R * R * T * T);
    const B = (b * P) / (R * T);
    expect(direct.kappa).toBeCloseTo(kappa, 15);
    expect(direct.alpha).toBeCloseTo(alpha, 15);
    expect(direct.aPaM6PerMol2).toBeCloseTo(a, 15);
    expect(direct.bM3PerMol).toBeCloseTo(b, 15);
    expect(direct.dimensionlessA).toBeCloseTo(A, 15);
    expect(direct.dimensionlessB).toBeCloseTo(B, 15);
    expect(direct.kappa).toBeCloseTo(0.371261156036688, 12);
  });
});

// ============================================
// 16. АНАЛИТИЧЕСКИЕ ПРОВЕРКИ (НЕЗАВИСИМЫЕ ПУТИ)
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — аналитические независимые проверки', () => {
  it('интегральное тождество ln(phi) = Integral (Z-1)/P dP (co2, 280 K, 5 MPa)', () => {
    const target = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 280, pressurePa: 5e6 })));
    expect(target.lnPhi).toBeCloseTo(-0.3845165061985406, 12);
    // Квадтура Симпсона по vapor-ветви от 1000 Па до 5 МПа + прямоугольный
    // хвост от 0 до 1000 Па (интегранд (Z-1)/P конечен при P -> 0).
    const P0 = 1000;
    const P1 = 5e6;
    const n = 2000;
    const h = (P1 - P0) / n;
    const integrand = (P: number): number => {
      const r = computePengRobinsonPure(baseRequest({ temperatureK: 280, pressurePa: P }));
      if (r.status !== 'success') {
        throw new Error(`отказ интегранда при P=${P}`);
      }
      return (r.Z - 1) / P;
    };
    let sum = integrand(P0) + integrand(P1);
    for (let i = 1; i < n; i += 1) {
      sum += (i % 2 === 1 ? 4 : 2) * integrand(P0 + i * h);
    }
    const simpson = (h / 3) * sum;
    const low = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 280, pressurePa: P0 })));
    const tail = ((low.Z - 1) / P0) * P0;
    expect(Math.abs(simpson + tail - target.lnPhi)).toBeLessThan(5e-9);
  });

  it('PR-давление насыщения co2 (250 K): фугитивности ветвей равны', () => {
    const psat = findPrSaturationPressure('co2', 250, 2e6);
    // Бисекция по условию ln(phi)_v = ln(phi)_l сходится к Psat.
    expect(Math.abs(psat - 1770933.45)).toBeLessThan(1);
    const pair = lnPhiPair('co2', 250, psat);
    expect(pair).not.toBeNull();
    if (pair === null) {
      throw new Error('недостижимо: lnPhiPair отказ на Psat');
    }
    expect(Math.abs(pair.l - pair.v)).toBeLessThan(1e-9);
    expect(pair.v).toBeCloseTo(-0.17258934483089, 11);
    expect(pair.zv).toBeCloseTo(0.8137472849543431, 12);
    expect(pair.zl).toBeCloseTo(0.03506055738770175, 12);
  });

  it('PR-давление насыщения n2 (100 K) существует (самосогласованность EOS)', () => {
    const psat = findPrSaturationPressure('n2', 100, 2e6);
    expect(Math.abs(psat - 780609.68)).toBeLessThan(1);
  });

  it('log1p-форма ln(phi) совпадает с прямой формулой PR 1976', () => {
    // co2 250 K, 2 МПа, vapor: Z, A, B из проверенных якорей.
    const z = 0.7840665533701641;
    const A = 0.20844003496011448;
    const B = 0.025658356265842515;
    const direct =
      z - 1 - Math.log(z - B) -
      (A / (2 * Math.SQRT2 * B)) * Math.log((z + (1 + Math.SQRT2) * B) / (z + (1 - Math.SQRT2) * B));
    const stable = pengRobinsonLnPhi(z, A, B);
    expect(Math.abs(direct - stable)).toBeLessThan(1e-12);
    expect(stable).toBeCloseTo(-0.196993255787904, 12);
  });

  it('ln(phi) за пределами области определения (Z <= B) возвращает NaN', () => {
    expect(Number.isNaN(pengRobinsonLnPhi(0.01, 0.2, 0.05))).toBe(true);
    expect(Number.isNaN(pengRobinsonLnPhi(-1, 0.2, 0.05))).toBe(true);
  });
});

// ============================================
// 17. ГРАНИЦЫ ПОДЭТАПА
// ============================================

describe('Stage 4.4.4.2: Peng–Robinson — границы подэтапа', () => {
  it('результат не содержит смесевых величин (kij/смешение — 4.4.4.3)', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest()));
    const keys = Object.keys(s);
    for (const forbidden of ['kij', 'kIJ', 'mixing', 'binaryInteraction', 'mixture', 'flash', 'bubblePoint', 'dewPoint']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('дисклеймер о выборе ветви присутствует в каждом успехе', () => {
    for (const root of ['vapor', 'liquid'] as const) {
      const s = expectSuccess(computePengRobinsonPure(baseRequest({ temperatureK: 250, pressurePa: 2e6, root })));
      const note = s.notes.join(' ');
      expect(note).toContain('НЕ доказывает');
      expect(note).toContain('flash');
      expect(note).toContain('4.4.4.2');
    }
  });

  it('h2o всегда сопровождается предупреждением о применимости классического PR', () => {
    for (const root of ['vapor', 'liquid'] as const) {
      const s = expectSuccess(computePengRobinsonPure(baseRequest({ gasId: 'h2o', temperatureK: 800, pressurePa: 2e7, root })));
      const warning = s.warnings.find((w) => w.code === 'h2o_classical_pr_limitations');
      expect(warning).toBeDefined();
      expect(warning?.message).toMatch(/полярн|ассоциац/);
      // Ограничения каталога включены в сообщение.
      expect(warning?.message).toContain('смес');
    }
  });
});
