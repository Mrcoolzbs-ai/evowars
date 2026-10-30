// ============================================
// STAGE 4.1 - Тесты химических видов: состав, заряд, фазы, каталог
// ============================================

import { describe, it, expect } from 'vitest';
import {
  createSpeciesCatalog,
  validateSpecies,
  elementTotals,
  chargeTotal,
  elementBalanceCheck,
  SpeciesError
} from '../Core/species';
import type { ScientificSpecies, SpeciesCatalog } from '../Core/species';

function makeSpecies(overrides: Partial<ScientificSpecies> = {}): ScientificSpecies {
  return {
    id: 'h2o',
    formula: 'H2O',
    name: 'вода',
    elements: { H: 2, O: 1 },
    charge: 0,
    phase: 'gas',
    molarMassKgMol: 0.01801528,
    molarMassStatus: 'known',
    dataStatus: 'known',
    ...overrides
  };
}

function makeCatalog(): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  catalog.register(makeSpecies()); // h2o (gas)
  catalog.register(makeSpecies({ id: 'h2o_liq', phase: 'liquid' }));
  catalog.register(makeSpecies({
    id: 'co2',
    formula: 'CO2',
    elements: { C: 1, O: 2 },
    molarMassKgMol: 0.0440095
  }));
  catalog.register(makeSpecies({
    id: 'ch4',
    formula: 'CH4',
    elements: { C: 1, H: 4 },
    molarMassKgMol: 0.01604
  }));
  catalog.register(makeSpecies({
    id: 'o2',
    formula: 'O2',
    elements: { O: 2 },
    molarMassKgMol: 0.032
  }));
  catalog.register(makeSpecies({
    id: 'h2',
    formula: 'H2',
    elements: { H: 2 },
    molarMassKgMol: 0.002016
  }));
  return catalog;
}

describe('Stage 4.1 ScientificSpecies: валидация записей', () => {
  it('корректный вид проходит валидацию', () => {
    expect(validateSpecies(makeSpecies())).toEqual([]);
  });

  it('отрицательное число атомов невозможно', () => {
    const errors = validateSpecies(makeSpecies({ elements: { H: -1 } }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('неотрицательным целым');
  });

  it('половина атома невозможна: состав — целые числа', () => {
    expect(validateSpecies(makeSpecies({ elements: { H: 1.5 } })).length).toBeGreaterThan(0);
  });

  it('нечисловой заряд отвергается', () => {
    expect(validateSpecies(makeSpecies({ charge: 1.5 })).length).toBeGreaterThan(0);
  });

  it('нулевая и отрицательная молярная масса отвергаются', () => {
    expect(validateSpecies(makeSpecies({ molarMassKgMol: 0 })).length).toBeGreaterThan(0);
    expect(validateSpecies(makeSpecies({ molarMassKgMol: -0.01 })).length).toBeGreaterThan(0);
  });

  it('неизвестная молярная масса — null, а не ноль', () => {
    const unknown = makeSpecies({ molarMassKgMol: null, molarMassStatus: 'unknown' });
    expect(validateSpecies(unknown)).toEqual([]);
    expect(unknown.molarMassKgMol).toBeNull();
  });

  it('пустые id и формула отвергаются', () => {
    expect(validateSpecies(makeSpecies({ id: ' ' })).length).toBeGreaterThan(0);
    expect(validateSpecies(makeSpecies({ formula: '' })).length).toBeGreaterThan(0);
  });

  it('каталог отвергает некорректную запись и дубликат id', () => {
    const catalog = createSpeciesCatalog();
    expect(() => catalog.register(makeSpecies({ elements: { H: -2 } }))).toThrow(SpeciesError);
    catalog.register(makeSpecies());
    expect(() => catalog.register(makeSpecies())).toThrowError(/уже зарегистрирован/);
  });
});

describe('Stage 4.1 ScientificSpecies: каталог и фазы', () => {
  it('регистрация и поиск по id', () => {
    const catalog = makeCatalog();
    expect(catalog.size()).toBe(6);
    expect(catalog.has('h2o')).toBe(true);
    expect(catalog.has('no2')).toBe(false);
    expect(catalog.get('co2')?.elements).toEqual({ C: 1, O: 2 });
  });

  it('CO2(g) и CO2(aq) — разные записи одного вещества: findByFormula', () => {
    const catalog = createSpeciesCatalog();
    catalog.register(makeSpecies({ id: 'co2', formula: 'CO2', elements: { C: 1, O: 2 }, phase: 'gas' }));
    catalog.register(makeSpecies({ id: 'co2_aq', formula: 'CO2', elements: { C: 1, O: 2 }, phase: 'aqueous' }));
    const both = catalog.findByFormula('CO2');
    expect(both.length).toBe(2);
    expect(both.map((s) => s.phase).sort()).toEqual(['aqueous', 'gas']);
    // запись = вид + фаза: уравновешенные расчёты смогут отличить их
    expect(catalog.get('co2')?.phase).toBe('gas');
    expect(catalog.get('co2_aq')?.phase).toBe('aqueous');
  });

  it('все поддерживаемые фазы допустимы', () => {
    const phases = ['gas', 'liquid', 'solid', 'aqueous', 'plasma', 'supercritical', 'other'] as const;
    const catalog = createSpeciesCatalog();
    phases.forEach((phase, i) => {
      catalog.register(makeSpecies({ id: `sp${i}`, formula: `X${i}`, elements: { X: 1 }, phase }));
    });
    expect(catalog.size()).toBe(phases.length);
  });
});

describe('Stage 4.1 ScientificSpecies: элементный и зарядовый баланс', () => {
  it('элементный состав суммируется корректно', () => {
    const catalog = makeCatalog();
    const totals = elementTotals(catalog, { h2o: 2, co2: 1 });
    expect(totals.totals).toEqual({ H: 4, O: 4, C: 1 });
    expect(totals.excludedSpecies).toEqual([]);
  });

  it('неизвестные виды исключаются из подсчёта явно', () => {
    const catalog = makeCatalog();
    const totals = elementTotals(catalog, { h2o: 1, mystery: 5 });
    expect(totals.excludedSpecies).toEqual(['mystery']);
    expect(totals.totals).toEqual({ H: 2, O: 1 });
  });

  it('заряд: электрон и ионы', () => {
    const catalog = createSpeciesCatalog();
    catalog.register(makeSpecies({ id: 'e', formula: 'e-', elements: {}, charge: -1, molarMassKgMol: null, molarMassStatus: 'unknown', phase: 'other' }));
    catalog.register(makeSpecies({ id: 'h_plus', formula: 'H+', elements: { H: 1 }, charge: 1, phase: 'aqueous' }));
    const result = chargeTotal(catalog, { e: 3, h_plus: 3 });
    expect(result.charge).toBe(0);
    expect(result.excludedSpecies).toEqual([]);
  });

  it('элементный баланс: 2 H2 + O2 → 2 H2O соблюдён', () => {
    const catalog = makeCatalog();
    const ok = elementBalanceCheck(catalog, { h2: 2, o2: 1 }, { h2o: 2 });
    expect(ok.balanced).toBe(true);
  });

  it('элементный баланс: CH4 + 2 O2 → CO2 + 2 H2O соблюдён', () => {
    const catalog = makeCatalog();
    const ok = elementBalanceCheck(catalog, { ch4: 1, o2: 2 }, { co2: 1, h2o: 2 });
    expect(ok.balanced).toBe(true);
  });

  it('несбалансированная реакция обнаруживается', () => {
    const catalog = makeCatalog();
    const bad = elementBalanceCheck(catalog, { h2: 2, o2: 1 }, { h2o: 2, o2: 0.5 });
    expect(bad.balanced).toBe(false);
    expect(bad.reason).toContain('O');
  });

  it('неизвестный состав делает баланс непроверяемым — и это сообщается явно', () => {
    const catalog = makeCatalog();
    const result = elementBalanceCheck(catalog, { mystery: 1 }, { h2o: 1 });
    expect(result.balanced).toBe(false);
    expect(result.reason).toContain('непроверяем');
    expect(result.reason).toContain('mystery');
  });
});
