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
// НЕЗАВИСИМЫЙ ПРОГРАММНЫЙ BENCHMARK (CoolProp 8.0.0, backend 'PR') ВЫПОЛНЕН
// и ПРОЙДЕН отдельным GitHub Actions workflow (Stage 4.4.4.2.1; см.
// docs/science/DATA_PROVENANCE.md §2.30). Числа ниже — либо аналитические
// величины (критическая точка, идеальный предел, ТОЧНЫЙ двойной корень,
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
// Stage 4.4.4.2.2: знак дискриминанта классифицируется в double-double
// (~106 бит) из точных binary64-входов; high-precision оракул (mpmath,
// 50 знаков) сверяет и ЧИСЛО действительных корней, а не только значения.
// Closeout 4.4.4.2.2: знак В ПОЛОСЕ порога вычисляет ТОЧНЫЙ dyadic-BigInt
// fallback; DD-деление исправлено (Core/prDoubleDouble.ts) и покрыто
// изолированными тестами с независимым BigInt-оракулом (секция 20).

import { describe, expect, it } from 'vitest';

// Stage 4.4.4.2.1 (архитектура Core/Data): чистая математика PR и
// низкоуровневые хелперы — в Core; gasId-вычислитель по каталогу —
// фасад Data над Core.
import {
  computePengRobinsonFromComponent,
  computePengRobinsonPureParameters,
  pengRobinsonCubicCoefficients,
  pengRobinsonLnPhi,
  prPhysicalRoots,
  solvePrCubicRealRoots
} from '../Core/pengRobinson';

// Closeout Stage 4.4.4.2.2: ВНУТРЕННИЙ модуль Core (НЕ входит в публичный
// контракт слоя) для ИЗОЛИРОВАННЫХ тестов DD-деления с НЕЗАВИСИМЫМ
// dyadic-BigInt-оракулом; производственный решатель импортирует его же
// (тот же код, что и в Core/pengRobinson.ts), но без тестового API в
// публичном Core/index.ts.
import {
  ddAdd,
  ddDiv,
  ddFromDouble,
  ddMul,
  ddNeg,
  ddSub,
  ddToDouble
} from '../Core/prDoubleDouble';
import type { DoubleDouble } from '../Core/prDoubleDouble';

import { computePengRobinsonPure } from '../Data/pengRobinsonFacade';
import * as corePrModule from '../Core/pengRobinson';
import * as facadePrModule from '../Data/pengRobinsonFacade';

// R — единая константа репозитория (точное СИ-2019), из Core/thermoFunctions.
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';

import type {
  PengRobinsonComponentInputs,
  PengRobinsonComponentRequest,
  PengRobinsonComponentResult,
  PengRobinsonComponentSuccess,
  PengRobinsonEvidencePolicy
} from '../Core/pengRobinson';

import type {
  PengRobinsonPureFailure,
  PengRobinsonPureRequest,
  PengRobinsonPureResult,
  PengRobinsonPureSuccess
} from '../Data/pengRobinsonFacade';

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

/** Успех компонентного вычислителя Core (без provenance-скаляров каталога). */
function expectComponentSuccess(result: PengRobinsonComponentResult): PengRobinsonComponentSuccess {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`ожидался успех, получен отказ: ${JSON.stringify(result)}`);
  }
  return result;
}

function expectFailure(
  result: PengRobinsonPureResult | PengRobinsonComponentResult,
  code: PengRobinsonPureFailure['code']
): PengRobinsonPureFailure {
  expect(result.status).toBe('failure');
  if (result.status !== 'failure') {
    throw new Error(`ожидался отказ ${code}, получен успех`);
  }
  expect(result.code).toBe(code);
  return result;
}

function expectAllNumbersFinite(s: PengRobinsonComponentSuccess): void {
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

  it('точный двойной корень (A=49/128, B=1/16): ровно 2 различимых корня', () => {
    // Факторизация: (16Z-9)(16Z-3)^2/4096 = 0 — двойной корень
    // Z = 3/16 = 0.1875, простой корень Z = 9/16 = 0.5625; оба
    // больше B. Это НАСТОЯЩИЙ кратный корень: дискриминант D = 0
    // ТОЧНО (диадические входы; подтверждается DD-классификацией и
    // независимым mpmath-оракулом), а не приближённая критическая
    // точка производной. Прежний «сконструированный» случай
    // A = 0.13130582290421344 двойным корнем НЕ является: его точный
    // дискриминант ПОЛОЖИТЕЛЕН (см. регрессионную серию A0 ниже).
    const result = solvePrCubicRealRoots(0.3828125, 0.0625);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('недостижимо');
    }
    expect(result.roots).toHaveLength(2);
    expect(result.roots[0]).toBeCloseTo(0.1875, 12);
    expect(result.roots[1]).toBeCloseTo(0.5625, 12);
    // Оба корня физически допустимы (Z > B) — различимые ветви.
    const physical = prPhysicalRoots(result.roots, 0.0625);
    expect(physical).toHaveLength(2);
    expect(physical[0]).toBeCloseTo(0.1875, 12);
    expect(physical[1]).toBeCloseTo(0.5625, 12);
  });

  it('возмущение A0 на +-1e-6: уверенно три корня против одного (DD-классификация)', () => {
    // A0 + 1e-6: дискриминант уверенно ОТРИЦАТЕЛЕН в double-double —
    // три корня (пара у 0.05 в пределах 5e-3); A0 - 1e-6: уверенно
    // ПОЛОЖИТЕЛЕН — один корень.
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

// ============================================
// 18. ГРАНИЦА ДИСКРИМИНАНТА (STAGE 4.4.4.2.2)
// ============================================
//
// Регрессионная серия около нулевого дискриминанта с одним и тем же
// B = 0.01980480623881198 и базовым A0 = 0.13130582290421344.
// Точный дискриминант binary64-входов (A0, B) ПОЛОЖИТЕЛЕН
// (D/scale ~ +2.7e-16): математически существует ровно ОДИН
// действительный корень 0.880195193761188, пара 0.05 ± 5.23e-9 i —
// комплексная. Ожидания подтверждены НЕЗАВИСИМЫМ расчётом корней
// исходного полинома в расширенной точности (double-double,
// ~106 бит; воспроизводимый oracle с mpmath 50 знаков —
// scripts/benchmarks/peng_robinson_coolprop.py, секция boundary);
// метод и результаты зафиксированы в DATA_PROVENANCE.md §2.30.

const PR_BOUNDARY_B = 0.01980480623881198;
const PR_BOUNDARY_A0 = 0.13130582290421344;

describe('Stage 4.4.4.2.2: граница дискриминанта кубического уравнения', () => {
  it('регрессионный случай A = A0 - 1e-13: ровно один действительный корень (фиктивная liquid-ветвь устранена)', () => {
    // До ревизии 4.4.4.2.1 условие discriminant <= 1e-12*discScale
    // направляло и ПОЛОЖИТЕЛЬНЫЙ дискриминант в тригонометрическую
    // ветвь, кламп acos создавал фиктивный повторный корень у 0.05:
    // он больше B, проходил проверку Z > B и мог становиться ложной
    // liquid-ветвью. Математически существует ровно ОДИН
    // действительный корень 0.8801951937613128; пара
    // 0.05 ± 6.04e-8 i — комплексная (оракул расширенной точности).
    const result = solvePrCubicRealRoots(0.13130582290411344, PR_BOUNDARY_B);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('недостижимо');
    }
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toBeCloseTo(0.8801951937613128, 12);
    // Фиктивного корня у 0.05 больше нет ни в каком виде.
    for (const z of result.roots) {
      expect(Math.abs(z - 0.05)).toBeGreaterThan(1e-3);
    }
    // Physical root selection: ровно один физически допустимый корень.
    const physical = prPhysicalRoots(result.roots, PR_BOUNDARY_B);
    expect(physical).toHaveLength(1);
    expect(physical[0]).toBeCloseTo(0.8801951937613128, 12);
  });

  it('A0 - 1e-12 и A0 - 1e-11: уверенно один действительный корень', () => {
    const d12 = solvePrCubicRealRoots(PR_BOUNDARY_A0 - 1e-12, PR_BOUNDARY_B);
    const d11 = solvePrCubicRealRoots(PR_BOUNDARY_A0 - 1e-11, PR_BOUNDARY_B);
    expect(d12.ok).toBe(true);
    expect(d11.ok).toBe(true);
    if (!d12.ok || !d11.ok) {
      throw new Error('недостижимо');
    }
    expect(d12.roots).toHaveLength(1);
    expect(d12.roots[0]).toBeCloseTo(0.8801951937624364, 12);
    expect(d11.roots).toHaveLength(1);
    expect(d11.roots[0]).toBeCloseTo(0.8801951937736714, 12);
    for (const r of [d12, d11]) {
      for (const z of r.roots) {
        expect(Math.abs(z - 0.05)).toBeGreaterThan(1e-3);
      }
    }
  });

  it('A0: положительный дискриминант, разрешимый в double-double — ровно ОДИН действительный корень', () => {
    // Регрессия Stage 4.4.4.2.2. Точный дискриминант binary64-входов
    // (A0, B) ПОЛОЖИТЕЛЕН: D/scale ~ +2.69e-16 (double-double
    // классификация из точных входов; ~ +2.79e-16 в десятичном
    // представлении тех же чисел). В double-точности знак не
    // разрешим, но DD-цепочка (~106 бит) уверенно классифицирует
    // D > 0: существует ровно ОДИН действительный корень
    // 0.880195193761188, пара 0.05 ± 5.23e-9 i — комплексная.
    // Прежняя (4.4.4.2.1) обработка полосы |D| <= discErr выдавала
    // критическую точку производной (0.05) за второй действительный
    // корень — он больше B и формировал ФИКТИВНУЮ liquid-ветвь.
    const result = solvePrCubicRealRoots(PR_BOUNDARY_A0, PR_BOUNDARY_B);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('недостижимо');
    }
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toBeCloseTo(0.880195193761188, 12);
    // Ложного корня у 0.05 нет НИ В КАКОМ ВИДЕ — ни в realRoots,
    // ни в physicalRoots (фиктивной liquid-ветви не возникает).
    for (const z of result.roots) {
      expect(Math.abs(z - 0.05)).toBeGreaterThan(1e-3);
    }
    const physical = prPhysicalRoots(result.roots, PR_BOUNDARY_B);
    expect(physical).toHaveLength(1);
    expect(physical[0]).toBeCloseTo(0.880195193761188, 12);
  });

  it('A0 + 1e-13: уверенно три действительных корня, расщепление пары выше допуска дедупликации', () => {
    // PR_BOUNDARY_A0 + 1e-13 — выражение вместо литерала: литерал
    // 0.13130582290431344 в рантайме равен 0.13130582290431345
    // (17 значащих цифр не round-trip'ятся, предупреждение линтера
    // о потере точности); вычисленное значение идентично.
    const result = solvePrCubicRealRoots(PR_BOUNDARY_A0 + 1e-13, PR_BOUNDARY_B);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('недостижимо');
    }
    expect(result.roots).toHaveLength(3);
    // Пара у 0.05 расщеплена на ~1.2e-7 — дедупликация (допуск 1e-8)
    // различает корни; это три РАЗЛИЧИМЫХ действительных корня.
    const pairSplit = result.roots[1] - result.roots[0];
    expect(pairSplit).toBeGreaterThan(1e-8);
    expect(pairSplit).toBeLessThan(2e-7);
    // Точность пары против оракула расширенной точности (~1e-9 отн.):
    // ошибка кратных/близких корней в double ~ sqrt(eps)-масштаба.
    expect(result.roots[0]).toBeCloseTo(0.04999993977067657, 9);
    expect(result.roots[1]).toBeCloseTo(0.05000006022944803, 9);
    // Простой корень — с полной точностью.
    expect(result.roots[2]).toBeCloseTo(0.8801951937610631, 12);
    // Все три корня больше B — физически допустимы.
    for (const z of result.roots) {
      expect(z).toBeGreaterThan(PR_BOUNDARY_B);
    }
    const physical = prPhysicalRoots(result.roots, PR_BOUNDARY_B);
    expect(physical).toHaveLength(3);
  });

  it('A0 + 1e-12 и A0 + 1e-11: уверенно три действительных корня', () => {
    const d12 = solvePrCubicRealRoots(PR_BOUNDARY_A0 + 1e-12, PR_BOUNDARY_B);
    const d11 = solvePrCubicRealRoots(PR_BOUNDARY_A0 + 1e-11, PR_BOUNDARY_B);
    expect(d12.ok).toBe(true);
    expect(d11.ok).toBe(true);
    if (!d12.ok || !d11.ok) {
      throw new Error('недостижимо');
    }
    expect(d12.roots).toHaveLength(3);
    expect(d12.roots[0]).toBeCloseTo(0.04999980933037945, 9);
    expect(d12.roots[1]).toBeCloseTo(0.05000019067086875, 9);
    expect(d12.roots[2]).toBeCloseTo(0.8801951937599396, 12);
    expect(d11.roots).toHaveLength(3);
    expect(d11.roots[0]).toBeCloseTo(0.04999939694119104, 9);
    expect(d11.roots[1]).toBeCloseTo(0.05000060307129239, 9);
    expect(d11.roots[2]).toBeCloseTo(0.8801951937487045, 12);
  });
});

// ============================================
// 19. АРХИТЕКТУРНАЯ ГРАНИЦА CORE/DATA (STAGE 4.4.4.2.1)
// ============================================
//
// CORE_SCIENTIFIC_ENGINE.md: зависимости слоёв ацикличны, фундамент
// Core не получает runtime из Data; каталог строится ПОВЕРХ контрактов
// Core. Core/pengRobinson.ts принимает валидированные параметры и
// evidence напрямую; lookup по gasId и обработка EosParametersError —
// в фасаде Data/pengRobinsonFacade.ts.

describe('Stage 4.4.4.2.1: архитектурная граница Core/Data', () => {
  const syntheticInputs: PengRobinsonComponentInputs = {
    gasId: 'synthetic',
    formula: 'XeSyn',
    name: 'Синтетический компонент (тест Core)',
    criticalTemperatureK: 200,
    criticalPressurePa: 5e6,
    acentricFactor: 0.1,
    evidence: {
      criticalTemperatureK: 'VERIFIED',
      criticalPressurePa: 'VERIFIED',
      acentricFactor: 'VERIFIED'
    },
    crossChecks: [],
    limitations: []
  };

  const syntheticRequest = (overrides: Partial<PengRobinsonComponentRequest> = {}): PengRobinsonComponentRequest => ({
    // 150 K < Tc = 200 K и P = 1.5e6 Pa — внутри купола: три
    // действительных корня, все физически допустимые (без
    // предупреждения single_physical_root).
    temperatureK: 150,
    pressurePa: 1.5e6,
    root: 'vapor',
    evidencePolicy: 'verified_only',
    ...overrides
  });

  it('Core считает синтетический компонент без каталога (verified_only, без предупреждений)', () => {
    const s = expectComponentSuccess(
      computePengRobinsonFromComponent(syntheticInputs, syntheticRequest())
    );
    expectAllNumbersFinite(s);
    expect(s.gasId).toBe('synthetic');
    expect(s.formula).toBe('XeSyn');
    expect(s.evidence.acentricFactor).toBe('VERIFIED');
    // Три физически допустимых корня — предупреждений нет.
    expect(s.realRoots).toHaveLength(3);
    expect(s.physicalRoots).toHaveLength(3);
    expect(s.hasDistinctBranches).toBe(true);
    expect(s.warnings).toHaveLength(0);
    // Vapor — наибольший физический корень; сжатие существенно.
    expect(s.Z).toBe(s.selectedRoot);
    expect(s.Z).toBe(s.physicalRoots[s.physicalRoots.length - 1]);
    expect(s.Z).toBeGreaterThan(0.5);
    expect(s.Z).toBeLessThan(1);
    expect(s.notes.join(' ')).toContain('НЕ доказывает');
  });

  it('некорректные числовые параметры — invalid_parameters (fail-closed Core)', () => {
    const badOverrides: ReadonlyArray<Partial<PengRobinsonComponentInputs>> = [
      { criticalTemperatureK: 0 },
      { criticalTemperatureK: -200 },
      { criticalTemperatureK: Number.NaN },
      { criticalPressurePa: 0 },
      { criticalPressurePa: -5e6 },
      { criticalPressurePa: Number.POSITIVE_INFINITY },
      { acentricFactor: Number.NaN },
      { acentricFactor: Number.POSITIVE_INFINITY }
    ];
    for (const bad of badOverrides) {
      const f = expectFailure(
        computePengRobinsonFromComponent({ ...syntheticInputs, ...bad }, syntheticRequest()),
        'invalid_parameters'
      );
      expect(f.message.length).toBeGreaterThan(0);
    }
  });

  it('некорректные статусы evidence и структуры входа — invalid_parameters', () => {
    const badEvidence = { ...syntheticInputs, evidence: { ...syntheticInputs.evidence, acentricFactor: 'MAYBE' as unknown as PengRobinsonComponentInputs['evidence']['acentricFactor'] } };
    expectFailure(
      computePengRobinsonFromComponent(badEvidence, syntheticRequest()),
      'invalid_parameters'
    );
    const badCrossChecks = { ...syntheticInputs, crossChecks: 'не массив' as unknown as PengRobinsonComponentInputs['crossChecks'] };
    expectFailure(
      computePengRobinsonFromComponent(badCrossChecks, syntheticRequest()),
      'invalid_parameters'
    );
    const badGasId = { ...syntheticInputs, gasId: '   ' };
    expectFailure(
      computePengRobinsonFromComponent(badGasId, syntheticRequest()),
      'invalid_parameters'
    );
  });

  it('UNRESOLVED отклоняется даже политикой allow_unresolved_cross_check (Core без каталога)', () => {
    const f = expectFailure(
      computePengRobinsonFromComponent(
        { ...syntheticInputs, evidence: { ...syntheticInputs.evidence, acentricFactor: 'UNRESOLVED' } },
        syntheticRequest({ evidencePolicy: 'allow_unresolved_cross_check' })
      ),
      'parameter_evidence_not_accepted'
    );
    expect(f.detail).toContain('acentricFactor=UNRESOLVED');
    expect(f.message).toContain('UNRESOLVED');
  });

  it('некорректный запрос (T/P/root/policy) — invalid_input из общей валидации Core', () => {
    expectFailure(
      computePengRobinsonFromComponent(syntheticInputs, syntheticRequest({ temperatureK: 0 })),
      'invalid_input'
    );
    expectFailure(
      computePengRobinsonFromComponent(syntheticInputs, syntheticRequest({ pressurePa: -1 })),
      'invalid_input'
    );
    expectFailure(
      computePengRobinsonFromComponent(
        syntheticInputs,
        syntheticRequest({ root: 'solid' as unknown as PengRobinsonComponentRequest['root'] })
      ),
      'invalid_input'
    );
    expectFailure(
      computePengRobinsonFromComponent(
        syntheticInputs,
        syntheticRequest({ evidencePolicy: 'yolo' as unknown as PengRobinsonEvidencePolicy })
      ),
      'invalid_input'
    );
  });

  it('публичный API: gasId-вычислитель вынесен из Core в фасад Data', () => {
    // Core экспортирует чистую математику (computePengRobinsonFromComponent
    // и низкоуровневые хелперы), но больше НЕ экспортирует
    // computePengRobinsonPure — он определён в Data/pengRobinsonFacade.ts.
    const coreModule = corePrModule as Record<string, unknown>;
    expect(coreModule.computePengRobinsonPure).toBeUndefined();
    expect(coreModule.computePengRobinsonFromComponent).toBeDefined();
    expect(coreModule.solvePrCubicRealRoots).toBeDefined();
    const facadeModule = facadePrModule as Record<string, unknown>;
    expect(facadeModule.computePengRobinsonPure).toBeDefined();
  });

  it('фасад возвращает уточнённый gasId каталога и то же замороженное provenance', () => {
    const s = expectSuccess(computePengRobinsonPure(baseRequest()));
    const catalog = getEosPureComponentParameters('co2');
    expect(s.gasId).toBe('co2');
    expect(s.criticalTemperatureK).toBe(catalog.criticalTemperatureK);
    expect(Object.isFrozen(s.criticalTemperatureK)).toBe(true);
  });
});


// ============================================
// 20. STAGE 4.4.4.2.2 (CLOSEOUT): DD-ДЕЛЕНИЕ И ТОЧНЫЙ ЗНАК ДИСКРИМИНАНТА
// ============================================
//
// Closeout-дефекты, закрытые этой секцией:
// - ddDiv учитывал в остатке ТОЛЬКО старшую часть знаменателя
//   (ddTwoProd(q1, b.hi)) и терял слагаемое q1*b.lo — ошибка частного
//   деградировала до ~double для знаменателей с ненулевой lo;
// - полоса |D| <= discThreshold пыталась доказать кратный корень по
//   допуску невязки — невязка НЕ доказывает точное D = 0 (ненулевой
//   дискриминант возможен у почти кратного корня). Теперь знак в полосе
//   вычисляет ТОЧНЫЙ dyadic-BigInt fallback по исходным binary64 A/B;
// - при доказанных ТРЁХ корнях с неразличимой в double парой решатель
//   мог молча схлопнуть их дедупликацией — теперь контролируемый отказ.

describe('Stage 4.4.4.2.2 (closeout): DD-деление и точный знак дискриминанта', () => {
  // --- НЕЗАВИСИМЫЙ dyadic-BigInt-оракул: СОБСТВЕННАЯ реализация в тесте
  // (DataView + BigInt); производственный Core/prDoubleDouble оракулом
  // НЕ является. Все сравнения точные, без округления в number. ---
  type TestDyadic = { readonly num: bigint; readonly exp: number };
  const testDyadicBuffer = new ArrayBuffer(8);
  const testDyadicView = new DataView(testDyadicBuffer);
  const testDyadicFromDouble = (x: number): TestDyadic => {
    testDyadicView.setFloat64(0, x);
    const bits = testDyadicView.getBigUint64(0);
    const negative = (bits & 0x8000000000000000n) !== 0n;
    const biasedExponent = Number((bits >> 52n) & 0x7ffn);
    const mantissa = bits & 0x000fffffffffffffn;
    const num = biasedExponent === 0 ? mantissa : mantissa | 0x0010000000000000n;
    const exp = biasedExponent === 0 ? -1074 : biasedExponent - 1075;
    return { num: negative ? -num : num, exp };
  };
  const testDyadicSum = (a: TestDyadic, b: TestDyadic): TestDyadic => {
    const exp = Math.min(a.exp, b.exp);
    return {
      num: (a.num << BigInt(a.exp - exp)) + (b.num << BigInt(b.exp - exp)),
      exp
    };
  };
  const testDyadicFromDd = (x: DoubleDouble): TestDyadic =>
    testDyadicSum(testDyadicFromDouble(x.hi), testDyadicFromDouble(x.lo));
  // Точная проверка |u - v| <= 2^-bits * |v| в BigInt.
  const testWithinRelative = (u: TestDyadic, v: TestDyadic, bits: number): boolean => {
    const exp = Math.min(u.exp, v.exp);
    const un = u.num << BigInt(u.exp - exp);
    const vn = v.num << BigInt(v.exp - exp);
    const diff = un - vn;
    const absDiff = diff < 0n ? -diff : diff;
    const absV = vn < 0n ? -vn : vn;
    return absV !== 0n && absDiff * (1n << BigInt(bits)) <= absV;
  };
  // Точная проверка |u| <= 2^-bits * |v| в BigInt.
  const testAbsLeqRelative = (u: TestDyadic, v: TestDyadic, bits: number): boolean => {
    const exp = Math.min(u.exp, v.exp);
    const un = u.num << BigInt(u.exp - exp);
    const vn = v.num << BigInt(v.exp - exp);
    const absU = un < 0n ? -un : un;
    const absV = vn < 0n ? -vn : vn;
    return absV !== 0n && absU * (1n << BigInt(bits)) <= absV;
  };
  // Точная сверка ddDiv(a, b) против рационального эталона:
  // |q*Bex - Aex| * 2^100 <= |Aex| для q = ddDiv(a, b), всё в BigInt.
  const expectDdQuotientAccurate = (a: DoubleDouble, b: DoubleDouble): void => {
    const q = ddDiv(a, b);
    const qExact = testDyadicFromDd(q);
    const aExact = testDyadicFromDd(a);
    const bExact = testDyadicFromDd(b);
    const prodExp = qExact.exp + bExact.exp;
    const exp = Math.min(prodExp, aExact.exp);
    const prodNum = qExact.num * bExact.num * (1n << BigInt(prodExp - exp));
    const aNum = aExact.num * (1n << BigInt(aExact.exp - exp));
    const diff = prodNum - aNum;
    const absDiff = diff < 0n ? -diff : diff;
    const absA = aNum < 0n ? -aNum : aNum;
    expect(absA).not.toBe(0n);
    expect(absDiff * (1n << 100n) <= absA).toBe(true);
  };

  it('ddDiv: делители с ненулевой lo — точность 2^-100 против точного рационального частного', () => {
    // a = x1*x2 и b = y1*y2 — ТОЧНЫЕ DD-произведения (two_prod Деккера
    // точен), поэтому точное частное Q = (x1*x2)/(y1*y2) известно как
    // рациональное число; сверка идёт BigInt-выравниванием экспонент.
    // Первые четыре кейса — знаковые варианты с ДЕЛИТЕЛЕМ, у которого
    // младшая DD-часть ненулевая (sqrt(2)*sqrt(3) — не степень двойки).
    const loDivisorCases: readonly [number, number, number, number][] = [
      [Math.PI, Math.E, Math.SQRT2, Math.sqrt(3)],
      [-Math.PI, Math.E, Math.SQRT2, Math.sqrt(3)],
      [Math.PI, Math.E, -Math.SQRT2, Math.sqrt(3)],
      [-Math.PI, -Math.E, -Math.SQRT2, Math.sqrt(3)]
    ];
    for (const [x1, x2, y1, y2] of loDivisorCases) {
      const a = ddMul(ddFromDouble(x1), ddFromDouble(x2));
      const b = ddMul(ddFromDouble(y1), ddFromDouble(y2));
      expect(b.lo).not.toBe(0);
      expectDdQuotientAccurate(a, b);
    }
    // Масштабные кейсы: частные ~1e-71 и ~2.4e201 остаются представимыми
    // и сохраняют DD-точность (делители — одинарные double, lo = 0).
    const scaleCases: readonly [number, number, number, number][] = [
      [1.234e-150, 1, -2.1e-80, 1],
      [9e150, 8e150, 3e100, 1],
      [1.5, -2.5, 7.25, -0.125],
      [4.656612873077393e-10, 1, 2.220446049250313e-16, 1]
    ];
    for (const [x1, x2, y1, y2] of scaleCases) {
      const a = ddMul(ddFromDouble(x1), ddFromDouble(x2));
      const b = ddMul(ddFromDouble(y1), ddFromDouble(y2));
      expectDdQuotientAccurate(a, b);
    }
  });

  it('ddDiv: регрессия прежнего дефекта — остаток учитывал только старшую часть знаменателя', () => {
    // b = 3 + 1e-17 (lo != 0): прежний ddDiv терял слагаемое q1*b.lo и
    // ошибался на ~3.3e-18 отн. (~2^-48), новый алгоритм — на ~5e-34
    // (проверено против ТОЧНОГО рационального эталона 1/(3 + 1e-17):
    // условие |q*(3 + 1e-17) - 1| <= 2^-100, всё точно в BigInt).
    const b = ddAdd(ddFromDouble(3), ddFromDouble(1e-17));
    expect(b.lo).not.toBe(0);
    const q = ddDiv(ddFromDouble(1), b);
    const qExact = testDyadicFromDd(q);
    const bExact = testDyadicFromDd(b);
    const prodExp = qExact.exp + bExact.exp;
    const exp = Math.min(prodExp, 0);
    const prodNum = qExact.num * bExact.num * (1n << BigInt(prodExp - exp));
    const oneNum = 1n << BigInt(0 - exp);
    const diff = prodNum - oneNum;
    const absDiff = diff < 0n ? -diff : diff;
    expect(absDiff * (1n << 100n) <= oneNum).toBe(true);
  });

  it('ddDiv: тождество остатка и roundtrip в DD-точности', () => {
    const a = ddMul(ddFromDouble(Math.PI), ddFromDouble(Math.E));
    const b = ddMul(ddFromDouble(Math.SQRT2), ddFromDouble(Math.sqrt(3)));
    const q = ddDiv(a, b);
    // Тождество остатка: |a - q*b| <= 2^-100*|a| (точно в BigInt) —
    // невязка деления пренебрежимо мала относительно |a|.
    const remainder = ddSub(a, ddMul(q, b));
    expect(testAbsLeqRelative(testDyadicFromDd(remainder), testDyadicFromDd(a), 100)).toBe(true);
    // Roundtrip: ddMul(ddDiv(a, b), b) восстанавливает a с точностью 2^-100.
    const roundtrip = ddMul(q, b);
    expect(testWithinRelative(testDyadicFromDd(roundtrip), testDyadicFromDd(a), 100)).toBe(true);
  });

  it('ddDiv: знаки и масштабы частного (отрицательные числитель/знаменатель)', () => {
    const a = ddNeg(ddMul(ddFromDouble(Math.PI), ddFromDouble(Math.E)));
    const b = ddMul(ddFromDouble(Math.SQRT2), ddFromDouble(Math.sqrt(3)));
    const q = ddDiv(a, b);
    expect(q.hi).toBeLessThan(0);
    const qBack = ddMul(q, b);
    expect(testWithinRelative(testDyadicFromDd(qBack), testDyadicFromDd(a), 100)).toBe(true);
    // Масштабы: частное ~ -5.9e-71 (нормальное) и ~2.4e201.
    const small = ddDiv(ddFromDouble(1.234e-150), ddFromDouble(-2.1e-80));
    expect(small.hi).toBeLessThan(0);
    expect(small.hi).toBeGreaterThan(-1e-69);
    const big = ddDiv(ddMul(ddFromDouble(9e150), ddFromDouble(8e150)), ddFromDouble(3e100));
    expect(big.hi).toBeGreaterThan(2e201);
    expect(big.hi).toBeLessThan(3e201);
    expect(Number.isFinite(ddToDouble(big))).toBe(true);
  });

  // --- Точный знак дискриминанта в полосе порога (dyadic-BigInt) ---
  // Near-threshold пары подобраны НЕЗАВИСИМЫМ exact-оракулом (dyadic
  // BigInt + mpmath 50 знаков в benchmark-оракуле), НЕ по выходу TS
  // решателя. B = 2^-20 — точная степень двойки; A+ и A- — соседние
  // binary64-значения вокруг границы кратного корня: точный
  // дискриминант A+ ПОЛОЖИТЕЛЕН (D/scale ~ +2.35e-27 < порога 2^-84,
  // т.е. ВНУТРИ старой полосы), точный дискриминант A- ОТРИЦАТЕЛЕН
  // (D/scale ~ -1.50e-27, тоже в полосе).
  const NT_B = Math.pow(2, -20);
  const NT_A_PLUS = 0.0000011173004678283645;
  const NT_A_MINUS = 0.0000011173004678283643;

  it('near-threshold D > 0 внутри старой полосы: ТОЧНО один действительный корень', () => {
    // Точный знак дискриминанта +1 (dyadic-BigInt из исходных binary64
    // A/B); DD-цепочка знак не различает (|D|/scale ~ 2.35e-27 <
    // 2^-84). Решатель обязан вернуть РОВНО ОДИН действительный корень
    // либо структурный отказ — но НЕ приблизительный второй корень.
    // Значение корня подтверждено независимо (mpmath, benchmark-оракул).
    const result = solvePrCubicRealRoots(NT_A_PLUS, NT_B);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`ожидался успех, получен отказ: ${result.reason}`);
    }
    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toBeCloseTo(0.9999998363768624, 12);
  });

  it('near-threshold D < 0 внутри старой полосы: доказано три корня, пара неразличима — структурный отказ', () => {
    // Точный знак -1 (dyadic-BigInt): математически ТРИ действительных
    // корня, но пара расщеплена на ~2e-14 — много меньше допуска
    // дедупликации 1e-8*max(1, |z|, B), поэтому двойная реализация не
    // может надёжно представить их различными. Единственно честный
    // исход — контролируемый отказ, а НЕ молчаливое схлопывание в
    // один корень и НЕ подмена пары кратным корнем.
    const result = solvePrCubicRealRoots(NT_A_MINUS, NT_B);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('ожидался структурный отказ, получены корни');
    }
    expect(result.reason).toContain('дедупликац');
    expect(result.reason).toContain('3');
  });

  it('точный D = 0: кратная семантика — двойной корень одним значением, простым вторым', () => {
    // (A, B) = (0, 0): кубика z^3 - z^2 = z^2 (z - 1), D = 0 ТОЧНО;
    // двойной корень 0, простой 1. (A, B) = (0.25, 0): кубика
    // z^3 - z^2 + 0.25 z = z (z - 1/2)^2 — двойной корень 0.5, простой 0
    // (в двойной точности простой корень представлен значением
    // ~ -6e-33 в пределах невязки полинома).
    const r00 = solvePrCubicRealRoots(0, 0);
    expect(r00.ok).toBe(true);
    if (!r00.ok) {
      throw new Error('недостижимо');
    }
    expect(r00.roots).toHaveLength(2);
    expect(r00.roots[0]).toBeCloseTo(0, 12);
    expect(r00.roots[1]).toBeCloseTo(1, 12);
    const rQuarter = solvePrCubicRealRoots(0.25, 0);
    expect(rQuarter.ok).toBe(true);
    if (!rQuarter.ok) {
      throw new Error('недостижимо');
    }
    expect(rQuarter.roots).toHaveLength(2);
    expect(rQuarter.roots[0]).toBeCloseTo(0, 12);
    expect(rQuarter.roots[1]).toBeCloseTo(0.5, 12);
  });

  it('схлопывание трёх корней ниже допуска дедупликации: отказ вместо молчаливого схлопывания', () => {
    // Точный знак -1 для всех входов (dyadic-BigInt): доказано ТРИ
    // корня, но пары/тройка неразличимы в double (расщепление много
    // меньше 1e-8) — контролируемый отказ. 2^-1074 — наименьший
    // субнормальный binary64.
    const collapsing: readonly [number, number][] = [
      [Math.pow(2, -44), 0],
      [0, Math.pow(2, -50)],
      [0, Math.pow(2, -60)],
      [Math.pow(2, -1074), 0]
    ];
    for (const [a, b] of collapsing) {
      const result = solvePrCubicRealRoots(a, b);
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error(`ожидался отказ для A=${a}, B=${b}`);
      }
      expect(result.reason).toContain('дедупликац');
    }
  });

  it('неконечные и экстремальные входы: fail-closed отказ', () => {
    expect(solvePrCubicRealRoots(Number.NaN, 0.1).ok).toBe(false);
    expect(solvePrCubicRealRoots(0.1, Number.POSITIVE_INFINITY).ok).toBe(false);
    const huge = solvePrCubicRealRoots(1e308, 0.5);
    expect(huge.ok).toBe(false);
    if (huge.ok) {
      throw new Error('недостижимо');
    }
    expect(huge.reason).toContain('неконечный');
  });
});
