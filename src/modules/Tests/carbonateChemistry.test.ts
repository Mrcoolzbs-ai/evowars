// ============================================
// CARBONATE CHEMISTRY TESTS - карбонатная система океана (Stage 4.9c)
// ============================================
//
// Тесты равновесного ядра: константы K1/K2/Kw (параметризации
// Dickson & Millero 1987, Lueker et al. 2000, Millero 1995),
// спекиация DIC, карбонатная щёлочность, зарядовый баланс,
// отказы применимости, детерминизм, JSON round-trip, определения
// реакций диссоциации, интеграция с ReactionLedger Stage 4.9b.
//
// ВАЖНО: все численные величины входов ниже — синтетические величины
// фикстур (synthetic test fixture), НЕ физические данные океана и НЕ
// основание для климатических выводов. Равновесное распределение CO2 в
// воде здесь проверяется как ХИМИЯ, а не как кинетика растворения, не
// как полный океанический цикл и не как климатическая модель.
// Контрольные значения pK1/pK2/pKw — независимый расчёт по тем же
// формулам первоисточников (вне модуля) со сравнением в допуске.

import { describe, it, expect } from 'vitest';

import {
  CARBONATE_ACTIVITY_MODELS,
  CARBONATE_CONCENTRATION_UNIT,
  CARBONATE_PH_SCALES,
  CARBONATE_DISSOCIATION_REACTION_DEFINITIONS,
  calculateCarbonateAlkalinity,
  calculateCarbonateChargeBalance,
  computeCarbonateSpeciation,
  evaluateCarbonateEquilibriumConstants,
  planCarbonateSpeciationTransfer,
  solveCarbonateEquilibrium,
  validateCarbonateChemistryInputs,
  validateCarbonateDissociationReactionDefinitions,
  CarbonateChemistryError,
  type CarbonateModelInput
} from '../Core/carbonateChemistry';
import {
  GEOCHEMICAL_SPECIES_DEFINITIONS,
  addGeochemicalSpeciesToCatalog,
  buildGeochemicalSpeciesCatalog,
  validateGeochemicalSpeciesDefinitions
} from '../Data/geochemicalSpeciesCatalog';
import gases from '../Data/gases';
import elementCompositions from '../Data/elementCompositions';
import { buildSpeciesCatalogFromLegacy } from '../Core/adapters';
import { auditReactionStoichiometry } from '../Core/reactionLedger';
import type { ReactionRecord } from '../Core/reactionLedger';
import { validateGeochemicalReactionDefinition } from '../Core/geochemicalReactionExecution';

// ============================================
// ФИКСТУРЫ (все числа входа — synthetic test fixture)
// ============================================

const FIXTURE_PROVENANCE = {
  sourceName: 'synthetic carbonate test fixture (not a real data source)',
  sourceId: 'evowars-tests/stage-4.9c/synthetic',
  recordId: 'fixture-input',
  method: 'синтетическое значение для проверки контракта решателя, НЕ физические данные океана'
} as const;

/** Синтетические условия базового входа: 25 °C, S = 35, 1 атм, DIC = 0.002 mol/kg-SW. */
function fixtureInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    temperatureK: 298.15,
    temperatureProvenance: { ...FIXTURE_PROVENANCE, recordId: 'fixture-T' },
    salinityPSU: 35,
    salinityProvenance: { ...FIXTURE_PROVENANCE, recordId: 'fixture-S' },
    pressurePa: 101325,
    pressureProvenance: { ...FIXTURE_PROVENANCE, recordId: 'fixture-P' },
    dicMolPerKgSw: 0.002,
    dicProvenance: { ...FIXTURE_PROVENANCE, recordId: 'fixture-DIC' },
    ph: 8.1,
    phProvenance: { ...FIXTURE_PROVENANCE, recordId: 'fixture-pH' },
    phScale: 'seawater',
    activityModel: 'ideal_dilute',
    ...overrides
  } as Record<string, unknown>;
}

/** Вход в режиме щёлочности (без pH): TA_C — синтетическое значение. */
function fixtureInputByTA(taC: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const input = fixtureInput({ ...overrides });
  delete input.ph;
  delete input.phProvenance;
  return {
    ...input,
    carbonateAlkalinityMolPerKgSw: taC,
    carbonateAlkalinityProvenance: { ...FIXTURE_PROVENANCE, recordId: 'fixture-TA' }
  } as Record<string, unknown>;
}


// Справочные значения (рассчитаны НЕЗАВИСИМО от модуля по формулам
// первоисточников; сравнение в допуске 0.05, что сильно меньше
// различий между температурами/солёностями, но много больше
// двойных погрешностей параметризаций):
const REF_PK1_SWS_25C_35 = 5.8372;
const REF_PK2_SWS_25C_35 = 8.9554;
const REF_PKW_SWS_25C_35 = 13.2107;
const REF_PK1_TOTAL_25C_35 = 5.8472;
const REF_PK2_TOTAL_25C_35 = 8.9660;

function pK(k: number): number {
  return -Math.log10(k);
}

// ============================================
// 1. РАВНОВЕСНЫЕ КОНСТАНТЫ (K1 / K2 / Kw)
// ============================================

describe('Stage 4.9c (1): равновесные константы K1/K2/Kw', () => {
  it('(1) K1 совпадает с независимым расчётом по параметризации Dickson & Millero (1987)', () => {
    const c = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    expect(c.K1.value).not.toBeNull();
    expect(c.K1.valueStatus).toBe('known');
    expect(c.K1.phScale).toBe('seawater');
    expect(c.K1.concentrationUnit).toBe(CARBONATE_CONCENTRATION_UNIT);
    expect(Math.abs(pK(c.K1.value as number) - REF_PK1_SWS_25C_35)).toBeLessThan(0.05);
    // provenance идентифицирует первоисточник (DOI)
    expect(c.K1.provenance.sourceId).toContain('90021-0');
  });

  it('(2) K2 совпадает с независимым расчётом; K2 < K1 физически обязательна', () => {
    const c = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    expect(c.K2.value).not.toBeNull();
    expect(c.K2.valueStatus).toBe('known');
    expect(Math.abs(pK(c.K2.value as number) - REF_PK2_SWS_25C_35)).toBeLessThan(0.05);
    expect((c.K2.value as number) < (c.K1.value as number)).toBe(true);
    expect(c.K2.reaction).toContain('HCO3-');
    expect(c.K2.reaction).toContain('CO3^2-');
  });

  it('(3) Kw совпадает с независимым расчётом Millero (1995) на шкале SWS', () => {
    const c = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    expect(c.Kw.value).not.toBeNull();
    expect(c.Kw.valueStatus).toBe('known');
    expect(c.Kw.phScale).toBe('seawater');
    expect(Math.abs(pK(c.Kw.value as number) - REF_PKW_SWS_25C_35)).toBeLessThan(0.05);
  });
});

// ============================================
// 2. СПЕКИАЦИЯ: ДИК-БАЛАНС И ПРЕОБЛАДАНИЕ ВИДОВ
// ============================================

describe('Stage 4.9c (2): спекиация и пределы DIC', () => {
  it('(4) на total-шкале K1/K2 = Lueker et al. (2000), а Kw честно недоступна', () => {
    const c = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'total' });
    expect(Math.abs(pK(c.K1.value as number) - REF_PK1_TOTAL_25C_35)).toBeLessThan(0.05);
    expect(Math.abs(pK(c.K2.value as number) - REF_PK2_TOTAL_25C_35)).toBeLessThan(0.05);
    expect(c.K1.provenance.sourceId).toContain('00022-0');
    // шкалы не смешиваются: Kw на total НЕ подменяется SWS-значением
    expect(c.Kw.value).toBeNull();
    expect(c.Kw.valueStatus).toBe('not_verifiable');
    expect(c.Kw.notes.length).toBeGreaterThan(0);
  });

  it('(5) нулевой предел CO2: при высоком pH концентрация CO2* пренебрежимо мала', () => {
    const c = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    const s = computeCarbonateSpeciation({ k1: c.K1.value as number, k2: c.K2.value as number, hydrogenMolPerKgSw: Math.pow(10, -9.8), dicMolPerKgSw: 0.002 });
    expect(s.co2StarMolPerKgSw / s.dicSumMolPerKgSw).toBeLessThan(0.001);
    expect(s.co3MolPerKgSw / s.dicSumMolPerKgSw).toBeGreaterThan(0.5);
  });

  it('(6) низкий DIC корректно распределяется; доли зависят только от pH и констант', () => {
    const result = solveCarbonateEquilibrium(fixtureInputByTA(0.001117) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const sum = result.speciesMolPerKgSw.co2_aq + result.speciesMolPerKgSw.hco3_aq + result.speciesMolPerKgSw.co3_aq;
    expect(sum).toBeCloseTo(1e-3, 15);
    expect(result.ph).toBeGreaterThan(6);
    expect(result.ph).toBeLessThan(11);
  });

  it('(7) при низком pH преобладает CO2* (в CO2-ограничении)', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ ph: 4.5 }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const { co2_aq: co2, hco3_aq: hco3, co3_aq: co3 } = result.speciesMolPerKgSw;
    expect(co2).toBeGreaterThan(hco3);
    expect(co2).toBeGreaterThan(co3);
    expect(co2 / (co2 + hco3 + co3)).toBeGreaterThan(0.9);
  });

  it('(8) в характерном промежуточном диапазоне pH преобладает HCO3-', () => {
    for (const ph of [7.4, 8.1, 8.8]) {
      const result = solveCarbonateEquilibrium(fixtureInput({ ph }) as unknown as CarbonateModelInput);
      expect(result.status).toBe('applied');
      if (result.status !== 'applied') continue;
      const { co2_aq: co2, hco3_aq: hco3, co3_aq: co3 } = result.speciesMolPerKgSw;
      expect(hco3).toBeGreaterThan(co2);
      expect(hco3).toBeGreaterThan(co3);
    }
  });

  it('(9) при высоком pH преобладает CO3^2-', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ ph: 10.2 }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const { co2_aq: co2, hco3_aq: hco3, co3_aq: co3 } = result.speciesMolPerKgSw;
    expect(co3).toBeGreaterThan(hco3);
    expect(co3).toBeGreaterThan(co2);
  });

  it('(10) DIC сохраняется: слагаемые видов в точности дают DIC (и при малом, и при большом)', () => {
    for (const dic of [1e-12, 0.002, 0.1]) {
      const result = solveCarbonateEquilibrium(fixtureInput({ dicMolPerKgSw: dic }) as unknown as CarbonateModelInput);
      expect(result.status).toBe('applied');
      if (result.status !== 'applied') continue;
      expect(result.dicConservationResidualMolPerKgSw).toBeLessThan(1e-12);
      expect(result.carbonateAlkalinityMolPerKgSw).toBeGreaterThan(0);
    }
  });
});

// ============================================
// 3. ЩЁЛОЧНОСТЬ И РЕЖИМ TA
// ============================================

describe('Stage 4.9c (3): карбонатная щёлочность', () => {
  it('(11) TA_C повторяет вычисление карбонатной щёлочности и маркируется как «только карбонатная»', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({}) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const direct = calculateCarbonateAlkalinity({
      hco3MolPerKgSw: result.speciesMolPerKgSw.hco3_aq,
      co3MolPerKgSw: result.speciesMolPerKgSw.co3_aq
    });
    expect(direct.kind).toBe('carbonate_alkalinity_only');
    expect(direct.note).toContain('НЕ моделируются');
    expect(result.carbonateAlkalinityMolPerKgSw).toBeCloseTo(direct.valueMolPerKgSw, 18);
    // полная TA в модуль НЕ выдаётся: warning обязателен
    expect(result.warnings.some((w) => w.includes('щёлочность'))).toBe(true);
  });

  it('(12) режим щёлочности: решение по TA_C даёт малую невязку TA', () => {
    const taC = 0.002234; // синтетическая карбонатная щёлочность fixture (mol/kg-SW)
    const result = solveCarbonateEquilibrium(fixtureInputByTA(taC) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.mode).toBe('alkalinity');
    expect(result.alkalinityResidualMolPerKgSw).not.toBeNull();
    expect(result.alkalinityResidualMolPerKgSw as unknown as number).toBeLessThan(1e-12);
    expect(result.ph).toBeGreaterThan(7);
    expect(result.ph).toBeLessThan(9);
  });

  it('(13) согласованность прямых и обратных задач: pH-режим → TA_C → тот же pH', () => {
    const ph0 = 8.1;
    const first = solveCarbonateEquilibrium(fixtureInput({ ph: ph0 }) as unknown as CarbonateModelInput);
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    const second = solveCarbonateEquilibrium(fixtureInputByTA(first.carbonateAlkalinityMolPerKgSw) as unknown as CarbonateModelInput);
    expect(second.status).toBe('applied');
    if (second.status !== 'applied') return;
    expect(Math.abs(second.ph - ph0)).toBeLessThan(1e-6);
    // «карбонатная щёлочность повторяет расчёт»: TA_C второго решения совпадает
    expect(Math.abs(second.carbonateAlkalinityMolPerKgSw - first.carbonateAlkalinityMolPerKgSw)).toBeLessThan(1e-14);
  });
});

// ============================================
// 4. ТЕМПЕРАТУРА, СОЛЁНОСТЬ, ДАВЛЕНИЕ (источники и отказы)
// ============================================

describe('Stage 4.9c (4): температура/солёность/давление', () => {
  it('(14) повышение температуры увеличивает K1/K2/Kw согласно параметризациям', () => {
    const cold = evaluateCarbonateEquilibriumConstants({ temperatureK: 278.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    const warm = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    // эндотермическая диссоциация: константы растут с T (pK падает)
    expect(pK(cold.K1.value as number)).toBeGreaterThan(pK(warm.K1.value as number));
    expect(pK(cold.K2.value as number)).toBeGreaterThan(pK(warm.K2.value as number));
    expect(pK(cold.Kw.value as number)).toBeGreaterThan(pK(warm.Kw.value as number));
  });

  it('(15) повышение солёности согласуется с параметризацией (понижение pK1 по Dickson & Millero 1987)', () => {
    const s25 = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 25, pressurePa: 101325, phScale: 'seawater' });
    const s35 = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    // коэффициент при S отрицателен: pK1(35) < pK1(25) ⇒ K1(35) > K1(25)
    expect(pK(s35.K1.value as number)).toBeLessThan(pK(s25.K1.value as number));
  });

  it('(16) давление: K1 растёт по барометрической поправке Millero 1995; отказ выше 1000 bar', () => {
    const surface = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    const deep = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325 + 1e7, phScale: 'seawater' });
    expect((deep.K1.value as number) / (surface.K1.value as number)).toBeCloseTo(1.094, 2);
    expect(deep.pressureBarOverAtmosphere).toBeCloseTo(100, 6);
    // давление за конвертом поправок: значение НЕ подставляется
    const beyond = solveCarbonateEquilibrium(fixtureInput({ pressurePa: 101325 + 1.01e8 }) as unknown as CarbonateModelInput);
    expect(beyond.status).toBe('not_applied');
    if (beyond.status !== 'not_applied') return;
    expect(beyond.reasonKind).toBe('out_of_applicability');
  });

  it('(17) температура вне заявленного диапазона T = 2..35 °C даёт отказ, а не экстраполяцию', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ temperatureK: 270 }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reasonKind).toBe('out_of_applicability');
    // значения констант в отчёте о константах честный null со статусом
    const c = evaluateCarbonateEquilibriumConstants({ temperatureK: 270, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    expect(c.K1.value).toBeNull();
    expect(c.K1.valueStatus).toBe('out_of_applicability');
    expect(c.K2.value).toBeNull();
  });

  it('(18) солёность вне заявленного диапазона S = 20..40 даёт отказ', () => {
    for (const salinity of [5, 45]) {
      const result = solveCarbonateEquilibrium(fixtureInput({ salinityPSU: salinity }) as unknown as CarbonateModelInput);
      expect(result.status).toBe('not_applied');
      if (result.status !== 'not_applied') continue;
      expect(result.reasonKind).toBe('out_of_applicability');
    }
  });
});

// ============================================
// 5. ОТКАЗЫ И ПРОГРЕССИ (валидация входа)
// ============================================

describe('Stage 4.9c (5): валидация входа и отказы', () => {
  it('(19) неподдерживаемая шкала pH даёт ЯВНЫЙ отказ (free/NBS не реализованы)', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ phScale: 'free' }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reasonKind).toBe('unsupported_ph_scale');
    const validator = validateCarbonateChemistryInputs(fixtureInput({ phScale: 'NBS' }));
    expect(validator.length).toBeGreaterThan(0);
    expect(validator.some((e) => e.includes('не поддерживаются'))).toBe(true);
  });

  it('(20) неизвестное provenance не превращается в подтверждённое: отсутствие источника блокирует расчёт', () => {
    const noResult = validateCarbonateChemistryInputs(fixtureInput({ dicProvenance: undefined }));
    expect(noResult.some((e) => e.includes('provenance обязателен'))).toBe(true);
    // «источник-пустышка» (только note) тоже не проходит
    const note = validateCarbonateChemistryInputs(fixtureInput({ temperatureProvenance: { note: 'без источника' } }));
    expect(note.some((e) => e.includes('температура'))).toBe(true);
    // solve: invalid_input + никакой «приблизительной» подстановки констант
    const result = solveCarbonateEquilibrium(fixtureInput({ salinityProvenance: undefined }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reasonKind).toBe('invalid_input');
  });

  it('(21) неположительный DIC блокируется (0 и отрицательное значение)', () => {
    for (const dicMolPerKgSw of [0, -0.002]) {
      const result = solveCarbonateEquilibrium(fixtureInput({ dicMolPerKgSw }) as unknown as CarbonateModelInput);
      expect(result.status).toBe('not_applied');
      if (result.status !== 'not_applied') continue;
      expect(result.reasonKind).toBe('invalid_input');
    }
    expect(validateCarbonateChemistryInputs(fixtureInput({ dicMolPerKgSw: 0 })).some((e) => e.includes('ПОЛОЖИТЕЛЬНЫМ'))).toBe(true);
  });

  it('(22) несогласованность DIC и TA: TA_C > 2·DIC и TA_C = 2·DIC — решения нет', () => {
    const tooBig = solveCarbonateEquilibrium(fixtureInputByTA(0.005) as unknown as CarbonateModelInput);
    expect(tooBig.status).toBe('not_applied');
    if (tooBig.status !== 'not_applied') return;
    expect(tooBig.reasonKind).toBe('no_solution');
    expect(tooBig.reason).toContain('2·DIC');
    const exact = solveCarbonateEquilibrium(fixtureInputByTA(0.004) as unknown as CarbonateModelInput);
    expect(exact.status).toBe('not_applied');
    if (exact.status !== 'not_applied') return;
    expect(exact.reasonKind).toBe('no_solution');
  });

  it('(23) неподдерживаемая модель активности даёт ЯВНЫЙ отказ (Pitzer не реализован)', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ activityModel: 'pitzer' }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reasonKind).toBe('unsupported_activity_model');
    expect(result.reason).toContain('не реализована');
    expect(result.reason).toContain('морскую воду');
    expect(CARBONATE_ACTIVITY_MODELS).toEqual(['ideal_dilute']);
    expect(CARBONATE_PH_SCALES).toEqual(['seawater', 'total']);
  });

  it('(24) NaN/Infinity входы отклоняются (никак не «аварийное решение»)', () => {
    for (const weird of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = solveCarbonateEquilibrium(fixtureInput({ temperatureK: weird, temperatureProvenance: { sourceName: 'synthetic' } }) as unknown as CarbonateModelInput);
      expect(result.status).toBe('not_applied');
      if (result.status !== 'not_applied') continue;
      expect(result.reasonKind).toBe('invalid_input');
    }
    expect(validateCarbonateChemistryInputs(fixtureInput({ pressurePa: Number.NaN })).length).toBeGreaterThan(0);
  });

  it('(25) откат при невозможном решении: вход остаётся неизменным, результата нет', () => {
    const broken = fixtureInputByTA(0.005); // TA_C > 2·DIC → решения нет
    const snapshot = JSON.stringify(broken);
    const result = solveCarbonateEquilibrium(broken as unknown as CarbonateModelInput);
    expect(result.status).toBe('not_applied');
    expect(JSON.stringify(broken)).toBe(snapshot); // вход не мутирован
  });
});

// ============================================
// 6. ПОЛОЖИТЕЛЬНОСТЬ, ФИНАЛЬНОСТЬ, ЗАРЯД
// ============================================

describe('Stage 4.9c (6): положительность, зарядовый баланс', () => {
  it('(26) при корректных задачах все концентрации конечны и положительны', () => {
    for (const ph of [3.0, 6.0, 8.1, 11.5, 13.9]) {
      const result = solveCarbonateEquilibrium(fixtureInput({ ph }) as unknown as CarbonateModelInput);
      expect(result.status).toBe('applied');
      if (result.status !== 'applied') continue;
      for (const v of [result.speciesMolPerKgSw.co2_aq, result.speciesMolPerKgSw.hco3_aq, result.speciesMolPerKgSw.co3_aq]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  it('(27) зарядовый баланс РАСТВОРА проверяется независимо; без фона — «unknown», с фоном — «yes/no»', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({}) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // без явного фона модуль НЕ утверждает нейтральность полного раствора
    expect(result.chargeBalance.electroneutral).toBe('unknown');
    expect(result.chargeBalance.residualMolPerKgSw).toBeNull();
    // заряженность видов ≠ нейтральность раствора: вклады с формальными зарядами
    const contributions = result.chargeBalance.contributions;
    // на SWS-шкале Kw известна: OH- входит в баланс (4 вклада)
    expect(contributions.map((c) => c.speciesId).sort()).toEqual(['co3_aq', 'hco3_aq', 'hplus_aq', 'oh_aq']);
    const hco3 = contributions.find((c) => c.speciesId === 'hco3_aq');
    expect(hco3!.charge).toBe(-1);
    const co3 = contributions.find((c) => c.speciesId === 'co3_aq');
    expect(co3!.charge).toBe(-2);
    // с ЯВНЫМ фоном (синтетическая сильноионная пара) электронейтральность даёт «yes»
    const background = -(result.chargeBalance.modeledNetChargeMolPerKgSw);
    const balanced = calculateCarbonateChargeBalance({
      hydrogenMolPerKgSw: result.hydrogenMolPerKgSw,
      hco3MolPerKgSw: result.speciesMolPerKgSw.hco3_aq,
      co3MolPerKgSw: result.speciesMolPerKgSw.co3_aq,
      ohMolPerKgSw: result.speciesMolPerKgSw.oh_aq,
      backgroundStrongIonChargeMolPerKgSw: background
    });
    expect(balanced.electroneutral).toBe('yes');
    expect(Math.abs(balanced.residualMolPerKgSw as unknown as number)).toBeLessThan(1e-15);
    // независимость: сумма вкладов пересчитывается тем же выражением
    let net = 0;
    for (const c of balanced.contributions) net += c.chargeContributionMolPerKgSw;
    expect(net).toBeCloseTo(result.chargeBalance.modeledNetChargeMolPerKgSw, 15);
  });
});

// ============================================
// 7. ФАЗОВАЯ ИДЕНТИЧНОСТЬ И КАТАЛОГ ВИДОВ
// ============================================

describe('Stage 4.9c (7): фазовая идентичность и каталог видов', () => {
  it('(28) CO2(газ) и CO2(aq) не смешиваются: разные записи объединённого каталога', () => {
    const catalog = addGeochemicalSpeciesToCatalog(buildSpeciesCatalogFromLegacy(gases, elementCompositions)).catalog;
    const gas = catalog.get('co2');
    const aq = catalog.get('co2_aq');
    expect(gas).not.toBeNull();
    expect(aq).not.toBeNull();
    expect(gas!.id).not.toBe(aq!.id);
    expect(gas!.phase).toBe('gas');
    expect(aq!.phase).toBe('aqueous');
  });

  it('(29) HCO3- и CO3^2- сохраняют свои формальные заряды (-1 и -2) в каталоге', () => {
    const catalog = buildGeochemicalSpeciesCatalog();
    expect(catalog.get('hco3_aq')!.charge).toBe(-1);
    expect(catalog.get('co3_aq')!.charge).toBe(-2);
    expect(catalog.get('hplus_aq')!.charge).toBe(1);
    expect(catalog.get('oh_aq')!.charge).toBe(-1);
    // составы формуле обязаны
    expect(catalog.get('hco3_aq')!.elements).toEqual({ H: 1, C: 1, O: 3 });
    expect(catalog.get('co3_aq')!.elements).toEqual({ C: 1, O: 3 });
  });

  it('(30) новые водные виды проходят SpeciesCatalog: сборка, валидация, уникальность id', () => {
    expect(validateGeochemicalSpeciesDefinitions()).toEqual([]);
    const catalog = buildGeochemicalSpeciesCatalog();
    for (const id of ['hco3_aq', 'co3_aq', 'hplus_aq', 'oh_aq']) {
      expect(catalog.get(id)).not.toBeNull();
      expect(catalog.get(id)!.phase).toBe('aqueous');
    }
    // аддитивность к производственному каталогу не создаёт конфликтов
    const merged = addGeochemicalSpeciesToCatalog(buildSpeciesCatalogFromLegacy(gases, elementCompositions));
    expect(merged.issues).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    // состав видов никуда не «плавает»: определения Stage 4.9c
    const ids = GEOCHEMICAL_SPECIES_DEFINITIONS.map((d) => d.id).sort();
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ============================================
// 8. СОХРАНЕНИЕ УГЛЕРОДА, ОТКАТ, ДЕТЕРМИНИЗМ
// ============================================

describe('Stage 4.9c (8): сохранение углерода, детерминизм, сериализация', () => {
  it('(31) transfer-план: сумма дельт по углеродным видам сохраняет DIC', () => {
    const before = solveCarbonateEquilibrium(fixtureInput({ ph: 8.1 }) as unknown as CarbonateModelInput);
    const after = solveCarbonateEquilibrium(fixtureInput({ ph: 7.6 }) as unknown as CarbonateModelInput);
    expect(before.status).toBe('applied');
    expect(after.status).toBe('applied');
    if (before.status !== 'applied' || after.status !== 'applied') return;
    const plan = planCarbonateSpeciationTransfer(
      {
        co2StarMolPerKgSw: before.speciesMolPerKgSw.co2_aq,
        hco3MolPerKgSw: before.speciesMolPerKgSw.hco3_aq,
        co3MolPerKgSw: before.speciesMolPerKgSw.co3_aq
      },
      {
        co2StarMolPerKgSw: after.speciesMolPerKgSw.co2_aq,
        hco3MolPerKgSw: after.speciesMolPerKgSw.hco3_aq,
        co3MolPerKgSw: after.speciesMolPerKgSw.co3_aq
      }
    );
    expect(plan.status).toBe('planned_not_applied');
    expect(plan.atomicity).toBe('deferred_to_next_stage');
    expect(plan.deltas.length).toBe(3);
    // сохранение углерода: |ΔCO2* + ΔHCO3- + ΔCO3^2-| = 0 при неизменном DIC
    expect(plan.carbonConservationResidualMolPerKgSw).toBeLessThan(1e-12);
    // никакая физическая транзакция тут НЕ исполнена (запрет трёх extent-вызовов)
    expect(plan.reason).toContain('не выполняется');
    expect(plan.notes.length).toBeGreaterThan(0);
  });

  it('(32) откат: planCarbonateSpeciationTransfer на плохих распределениях не бросает и не мутирует вход', () => {
    const baseline = { co2StarMolPerKgSw: 1e-6, hco3MolPerKgSw: 1e-3, co3MolPerKgSw: 1e-4 };
    const target = { co2StarMolPerKgSw: 1e-6, hco3MolPerKgSw: Number.NaN, co3MolPerKgSw: 1e-4 };
    const plan = planCarbonateSpeciationTransfer(baseline, target);
    expect(plan.status).toBe('planned_not_applied');
    expect(Number.isFinite(plan.carbonConservationResidualMolPerKgSw)).toBe(false);
    expect(plan.reason).toContain('не построен');
  });

  it('(33) детерминизм: два запуска решателя дали побитово одинаковый результат', () => {
    const a = solveCarbonateEquilibrium(fixtureInputByTA(0.002234) as unknown as CarbonateModelInput);
    const b = solveCarbonateEquilibrium(fixtureInputByTA(0.002234) as unknown as CarbonateModelInput);
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(true);
  });

  it('(34) порядок представления видов не влияет на результат спекиации', () => {
    const c = evaluateCarbonateEquilibriumConstants({ temperatureK: 298.15, salinityPSU: 35, pressurePa: 101325, phScale: 'seawater' });
    const s1 = computeCarbonateSpeciation({ k1: c.K1.value as number, k2: c.K2.value as number, hydrogenMolPerKgSw: Math.pow(10, -8.1), dicMolPerKgSw: 0.002 });
    const s2 = computeCarbonateSpeciation({ k2: c.K2.value as number, k1: c.K1.value as number, hydrogenMolPerKgSw: Math.pow(10, -8.1), dicMolPerKgSw: 0.002 });
    expect(s1).toEqual(s2);
    const planA = planCarbonateSpeciationTransfer(s1, s2);
    expect(planA.carbonConservationResidualMolPerKgSw).toBeLessThan(1e-12);
  });

  it('(35) JSON round-trip: результат решателя — plain-JSON, сериализуется по кругу без потерь', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ backgroundStrongIonChargeMolPerKgSw: 0.00233, backgroundChargeProvenance: { sourceName: 'synthetic', recordId: 'bg' } }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const restored: unknown = JSON.parse(JSON.stringify(result));
    expect(restored).toEqual(result);
    // Math-объекты/классы не просачиваются: typeof все ключей — примитивы/объекты-данные
    expect(result instanceof CarbonateChemistryError).toBe(false);
  });
});

// ============================================
// 9. ИДЕАЛЬНЫЙ РЕЖИМ, ГРАНИЦЫ pH, МАЛЫЕ/БОЛЬШИЕ DIC
// ============================================

describe('Stage 4.9c (9): режим приближения и численные границы', () => {
  it('(36) идеальный разбавленный режим явно маркируется как приближение', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({}) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.activityModel).toBe('ideal_dilute');
    expect(result.approximation.kind).toBe('ideal_dilute');
    expect(result.approximation.note.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('ideal_dilute') || w.toLowerCase().includes('приближени'))).toBe(true);
  });

  it('(37) обратное направление диссоциации: определения реакций корректны и симметричны', () => {
    const issues = validateCarbonateDissociationReactionDefinitions();
    expect(issues).toEqual([]);
    expect(CARBONATE_DISSOCIATION_REACTION_DEFINITIONS).toHaveLength(5);
    const forwardK1 = CARBONATE_DISSOCIATION_REACTION_DEFINITIONS.map((d) => d.reactionId);
    expect(forwardK1).toContain('geo.carbonate.co2aq.dissociation.forward');
    expect(forwardK1).toContain('geo.carbonate.co2aq.dissociation.reverse');
    expect(forwardK1).toContain('geo.carbonate.hco3.dissociation.forward');
    expect(forwardK1).toContain('geo.carbonate.hco3.dissociation.reverse');
    // каждое определение проходит штатную валидацию Stage 4.9b
    for (const def of CARBONATE_DISSOCIATION_REACTION_DEFINITIONS) {
      expect(validateGeochemicalReactionDefinition(def)).toEqual([]);
    }
  });

  it('(38) пограничный pH: значения 0 и 14 запрещены, но 0.001 и 13.999 решаются', () => {
    for (const ph of [0, 14, -1, 14.1]) {
      expect(validateCarbonateChemistryInputs(fixtureInput({ ph })).length).toBeGreaterThan(0);
    }
    for (const ph of [0.001, 13.999]) {
      const result = solveCarbonateEquilibrium(fixtureInput({ ph }) as unknown as CarbonateModelInput);
      expect(result.status).toBe('applied');
      if (result.status !== 'applied') continue;
      expect(result.hydrogenMolPerKgSw).toBeGreaterThan(0);
    }
  });

  it('(39) очень малый DIC без underflow: концентрации остаются положительными', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ dicMolPerKgSw: 1e-15 }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.speciesMolPerKgSw.hco3_aq).toBeGreaterThan(0);
    expect(result.dicConservationResidualMolPerKgSw).toBeLessThan(1e-12);
  });

  it('(40) численная устойчивость при высоком DIC (синтетическая повышенная концентрация)', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ dicMolPerKgSw: 1.0, ph: 7.0 }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(Number.isFinite(result.speciesMolPerKgSw.co2_aq)).toBe(true);
    expect(Number.isFinite(result.speciesMolPerKgSw.co3_aq)).toBe(true);
    expect(result.dicConservationResidualMolPerKgSw).toBeLessThan(1e-12);
  });

  it('(41) Kw-only-seawater: в базе режима pH на total-шкале OH- НЕ синтезируется', () => {
    const result = solveCarbonateEquilibrium(fixtureInput({ phScale: 'total' }) as unknown as CarbonateModelInput);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.speciesMolPerKgSw.oh_aq).toBeNull();
    expect(result.warnings.some((w) => w.includes('OH-'))).toBe(true);
    // зарядовый баланс без OH- не изображает полную электронейтральность
    expect(result.chargeBalance.contributions.some((c) => c.speciesId === 'oh_aq')).toBe(false);
  });
});

// ============================================
// 10. ИНТЕГРАЦИЯ СО STAGE 4.9b (ReactionLedger не ослаблен)
// ============================================

describe('Stage 4.9c (10): ReactionLedger Stage 4.9b не ослаблен', () => {
  it('(42) определения реакций Stage 4.9c проходят штатный стехиометрический аудит ReactionLedger', () => {
    // баланс элементов и формального заряда каждой отдельной реакции
    // (раздел 8 промпта): все определения диссоциаций и автопротолиза
    // должны быть auditReactionStoichiometry = balanced на объединённом
    // каталоге (включая hco3_aq/co3_aq/hplus_aq/oh_aq/h2o_aq).
    const catalog = addGeochemicalSpeciesToCatalog(buildSpeciesCatalogFromLegacy(gases, elementCompositions)).catalog;
    const audited = new Map<string, string>();
    for (const def of CARBONATE_DISSOCIATION_REACTION_DEFINITIONS) {
      // промышленный маршрут Stage 4.9b: definition → candidate ReactionRecord → аудит
      const record: ReactionRecord = {
        id: 'rx-49c-' + def.reactionId,
        reactionId: def.reactionId,
        reactants: def.reactants,
        products: def.products,
        extent: 1,
        extentBasis: 'column_amount',
        time: null
      } as unknown as ReactionRecord;
      const audit = auditReactionStoichiometry(record, catalog);
      audited.set(def.reactionId, audit.status);
      expect(audit.status).toBe('balanced');
      // синтетическая карбонатная fixture с несбалансированной стехиометрией не «балансируется» (калибровка честности аудита)
      const unbalanced: ReactionRecord = {
        id: 'rx-49c-unbalanced',
        reactionId: 'synthetic test fixture: compat UNbalanced',
        reactants: [{ reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 1 }],
        products: [{ reservoirId: 'ocean', speciesId: 'hco3_aq', coefficient: 1 }],
        extent: 1,
        extentBasis: 'column_amount',
        time: null
      } as unknown as ReactionRecord;
      expect(auditReactionStoichiometry(unbalanced, catalog).status).not.toBe('balanced');
    }
    expect(audited.size).toBe(5);
  });
});
