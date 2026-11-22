// ============================================
// CO2 SOLUBILITY TESTS — растворимость CO2 по Weiss (1974),
// равновесие Генри и замкнутое равновесие атмосфера-океан
// (Stage 4.9e)
// ============================================
//
// Обязательные проверки промпта 4.9e: численная корректность K0 по
// референсным значениям первоисточника, зависимость от T и S, единицы
// mol/kg-SW/atm, ЯВНОЕ (не молчаливое) atm <-> Pa, сухая/влажная
// основы молярной доли, коэффициент фугативности и явное идеальное
// допущение, NaN/Infinity/границы, выход за применимость, равновесие
// Генри для заданной фугитивности, согласованность с решателем
// Stage 4.9c, сохранение общего углерода атмосфера-океан, различие
// co2 и co2_aq, честный not_verifiable при нехватке входов,
// отсутствие фиктивной кинетической скорости.
//
// ВАЖНО: все численные величины входов ниже — синтетические
// значения фикстур (synthetic test fixture): НЕ наблюдения океана и
// НЕ основание климатических выводов. ИСКЛЮЧЕНИЕ — сами константы
// Weiss (1974) и референсные якоря K0: это проверяемые величины
// первоисточника (Weiss 1974, Marine Chemistry 2:203-215,
// DOI 10.1016/0304-4203(74)90015-2; воспроизведены штатной
// параметризацией PyCO2SYS), используемые как РЕФЕРЕНС.

import { describe, it, expect } from 'vitest';

import {
  CO2_SOLUBILITY_UNIT,
  CO2_FUGACITY_UNIT,
  WEISS_1974_K0_COEFFICIENTS,
  WEISS_1974_APPLICABILITY,
  CO2_SOLUBILITY_PROVENANCE,
  CO2_FUGACITY_MAX_ATM,
  CO2_GAS_CONSTANT_J_PER_MOL_K,
  co2SolubilityK0Weiss1974,
  evaluateCO2Solubility,
  computeCO2Fugacity,
  calculateCO2AqueousEquilibrium,
  solveDICForTargetCO2Star,
  evaluateAtmosphereOceanEquilibrium
} from '../Core/co2Solubility';
import type {
  CO2AtmosphereOceanEquilibriumInput,
  CO2AtmosphereOceanEquilibriumResult,
  CO2HenryEquilibriumInput
} from '../Core/co2Solubility';
import { SEAWATER_COLUMN_MASS_UNIT } from '../Core/carbonateSpeciationExecution';
import type { DataProvenance } from '../Core/scientificValue';

// ============================================
// ФИКСТУРЫ (synthetic test fixtures)
// ============================================

const FIXTURE_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic test fixture: Stage 4.9e (числа фикстур)',
  sourceId: 'evowars/tests/stage-4.9e/co2-solubility-fixture',
  recordId: 'synthetic-co2-solubility-fixture'
};

const PROV_T: DataProvenance = { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: температура' };
const PROV_S: DataProvenance = { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: солёность' };
const PROV_P: DataProvenance = { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: давление' };
const PROV_GAS: DataProvenance = { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: молярная доля CO2 в газе' };

/**
 * РЕФЕРЕНСНЫЕ ЯКОРЯ Weiss (1974) (мол/kg-SW/atm), воспроизведённые
 * штатной параметризацией PyCO2SYS (Humphreys et al., GMD 2022);
 * допуски в тестах покрывают воспроизводимость параметризации,
 * но НЕ являются «подгонкой» формулы (сама формула закодирована
 * дословно из первоисточника).
 */
const K0_REF_298_35 = 0.02839; // 25 °C, S=35 (классический якорь Weiss 1974)
const K0_REF_298_0 = 0.03406; // 25 °C, пресная вода (S=0)
const K0_REF_273_35 = 0.06287; // 0 °C, S=35 (растворимость ~вдвое выше)
const K0_REF_278_35 = 0.05213; // 5 °C, S=35
const K0_REF_293_35 = 0.03241; // 20 °C, S=35
const K0_REF_308_35 = 0.02257; // 35 °C, S=35
const K0_REF_298_20 = 0.03070; // 25 °C, S=20

function solubilityInput(overrides: Partial<{ T: number; S: number; noProvT: boolean; noProvS: boolean }> = {}) {
  return {
    temperatureK: overrides.T ?? 298.15,
    temperatureProvenance: overrides.noProvT === true ? ({ note: 'источник не назван' } as unknown as DataProvenance) : PROV_T,
    salinityPSU: overrides.S ?? 35,
    salinityProvenance: overrides.noProvS === true ? ({ note: 'источник не назван' } as unknown as DataProvenance) : PROV_S
  };
}

/** Фугитивность фикстуры: 400 ppm (synthetic test fixture). */
const FCO2_FIXTURE = 4.0531e-4;

function henryInput(overrides: Partial<CO2HenryEquilibriumInput> = {}): CO2HenryEquilibriumInput {
  return {
    fCO2: FCO2_FIXTURE,
    fCO2Unit: 'atm',
    fCO2Provenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: фугитивность задана числом фикстуры' },
    temperatureK: 298.15,
    temperatureProvenance: PROV_T,
    salinityPSU: 35,
    salinityProvenance: PROV_S,
    ...overrides
  };
}

function dicSearchInput(overrides: Record<string, unknown> = {}) {
  return {
    targetCO2StarMolPerKgSw: 1.15075e-5, // synthetic test fixture (≈ K0·400 ppm при 25 °C, S=35)
    targetCO2StarProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: цель Henry' },
    carbonateAlkalinityMolPerKgSw: 2.2e-3, // synthetic test fixture
    carbonateAlkalinityProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: TA_C' },
    temperatureK: 298.15,
    temperatureProvenance: PROV_T,
    salinityPSU: 35,
    salinityProvenance: PROV_S,
    pressurePa: 101325,
    pressureProvenance: PROV_P,
    phScale: 'seawater' as const,
    activityModel: 'ideal_dilute' as const,
    ...overrides
  };
}

/**
 * Замкнутое равновесие атмосфера-океан ( ВСЕ величины — synthetic test
 * fixture): атм. столб co2 0.0169 mol/m2 (≈ pCO2 400 ppm при Tg=288.15 K
 * и идеальном столбе), DIC-столб 2.15 mol/m2 (DIC 2.15e-3 при массе
 * столба 1000 kg-SW/m2), TA_C 2.2e-3 mol/kg-SW, T_океана = 288.15 K.
 */
function equilibriumInput(overrides: Partial<CO2AtmosphereOceanEquilibriumInput> & Record<string, unknown> = {}): CO2AtmosphereOceanEquilibriumInput {
  const base: CO2AtmosphereOceanEquilibriumInput = {
    atmosphereCO2ColumnMolPerM2: {
      value: 0.0169,
      provenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: столб газа co2 (соглашение фикстуры ~400 ppm)' }
    },
    oceanDICColumnMolPerM2: {
      value: 2.15,
      provenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: столб растворённого DIC' }
    },
    atmosphere: {
      gasTemperatureK: 288.15,
      gasTemperatureProvenance: PROV_T
    },
    seawaterColumnMassKgPerM2: {
      valueKgPerM2: 1000,
      unit: SEAWATER_COLUMN_MASS_UNIT,
      provenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: явная масса столба (НЕ из глубины)' }
    },
    carbonateAlkalinityMolPerKgSw: {
      value: 2.2e-3,
      provenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: карбонатная щёлочность' }
    },
    oceanChemistry: {
      temperatureK: 288.15,
      temperatureProvenance: PROV_T,
      salinityPSU: 35,
      salinityProvenance: PROV_S,
      pressurePa: 101325,
      pressureProvenance: PROV_P,
      phScale: 'seawater',
      activityModel: 'ideal_dilute'
    }
  };
  return { ...base, ...overrides } as CO2AtmosphereOceanEquilibriumInput;
}

// ============================================
// 1. WEISS K0: ЧИСЛЕННАЯ КОРРЕКТНОСТЬ И ЗАВИСИМОСТИ
// ============================================

describe('Stage 4.9e Weiss K0: численная корректность', () => {
  it('K0(25 °C, S=35) совпадает с литературным якорем Weiss 1974 (0.02839 mol/kg-SW/atm) в пределах 0.1%', () => {
    const k0 = co2SolubilityK0Weiss1974(298.15, 35);
    expect(Math.abs(k0 - K0_REF_298_35) / K0_REF_298_35).toBeLessThan(0.001);
  });

  it('K0(25 °C, S=0) совпадает с якорем пресной воды (0.03406) в пределах 0.1%', () => {
    const k0 = co2SolubilityK0Weiss1974(298.15, 0);
    expect(Math.abs(k0 - K0_REF_298_0) / K0_REF_298_0).toBeLessThan(0.001);
  });

  it('K0(0 °C, S=35) ≈ 0.0629: растворимость примерно вдвое выше, чем при 25 °C', () => {
    const k0cold = co2SolubilityK0Weiss1974(273.15, 35);
    const k0warm = co2SolubilityK0Weiss1974(298.15, 35);
    expect(Math.abs(k0cold - K0_REF_273_35) / K0_REF_273_35).toBeLessThan(0.001);
    expect(k0cold / k0warm).toBeGreaterThan(2.1);
    expect(k0cold / k0warm).toBeLessThan(2.3);
  });

  it('монотонная температурная зависимость: K0 падает с ростом T', () => {
    const k05 = co2SolubilityK0Weiss1974(278.15, 35);
    const k020 = co2SolubilityK0Weiss1974(293.15, 35);
    const k025 = co2SolubilityK0Weiss1974(298.15, 35);
    const k035 = co2SolubilityK0Weiss1974(308.15, 35);
    expect(Math.abs(k05 - K0_REF_278_35) / K0_REF_278_35).toBeLessThan(0.001);
    expect(Math.abs(k020 - K0_REF_293_35) / K0_REF_293_35).toBeLessThan(0.001);
    expect(Math.abs(k035 - K0_REF_308_35) / K0_REF_308_35).toBeLessThan(0.001);
    expect(k05).toBeGreaterThan(k020);
    expect(k020).toBeGreaterThan(k025);
    expect(k025).toBeGreaterThan(k035);
  });

  it('высаливание: K0 падает с ростом солёности; якорь S=20 совпадает', () => {
    const k0s0 = co2SolubilityK0Weiss1974(298.15, 0);
    const k0s20 = co2SolubilityK0Weiss1974(298.15, 20);
    const k0s35 = co2SolubilityK0Weiss1974(298.15, 35);
    expect(Math.abs(k0s20 - K0_REF_298_20) / K0_REF_298_20).toBeLessThan(0.001);
    expect(k0s0).toBeGreaterThan(k0s20);
    expect(k0s20).toBeGreaterThan(k0s35);
  });

  it('коэффициенты и конверт применимости экспортированы дословно из источника', () => {
    expect(WEISS_1974_K0_COEFFICIENTS).toEqual({ A1: -60.2409, A2: 93.4517, A3: 23.3585, B1: 0.023517, B2: -0.023656, B3: 0.0047036 });
    expect(WEISS_1974_APPLICABILITY).toEqual({ temperatureKMinInclusive: 273.15, temperatureKMaxInclusive: 313.15, salinityMinInclusive: 0, salinityMaxInclusive: 40 });
    expect(CO2_SOLUBILITY_UNIT).toBe('mol/kg-SW/atm');
    expect(CO2_FUGACITY_UNIT).toBe('atm');
    expect(CO2_GAS_CONSTANT_J_PER_MOL_K).toBeCloseTo(8.314462618, 12);
    expect(CO2_SOLUBILITY_PROVENANCE.sourceId).toBe('doi:10.1016/0304-4203(74)90015-2');
  });

  it('evaluateCO2Solubility: применённый результат совпадает с чистой функцией, единица mol/kg-SW/atm', () => {
    const result = evaluateCO2Solubility(solubilityInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.K0MolPerKgSwPerAtm).toBe(co2SolubilityK0Weiss1974(298.15, 35));
    expect(result.unit).toBe('mol/kg-SW/atm');
    expect(result.provenance.sourceId).toBe('doi:10.1016/0304-4203(74)90015-2');
    expect(result.warnings.join(' ')).toContain('НЕ скорость');
  });

  it('NaN/Infinity/неположительная температура — контролируемый отказ', () => {
    for (const T of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -288]) {
      const result = evaluateCO2Solubility(solubilityInput({ T }));
      expect(result.status).toBe('not_applied');
      if (result.status === 'not_applied') {
        expect(result.reasonKind).toBe('invalid_input');
      }
    }
  });

  it('NaN/Infinity/отрицательная солёность — контролируемый отказ', () => {
    for (const S of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const result = evaluateCO2Solubility(solubilityInput({ S }));
      expect(result.status).toBe('not_applied');
      if (result.status === 'not_applied') {
        expect(result.reasonKind).toBe('invalid_input');
      }
    }
  });

  it('отсутствие идентифицированного provenance T/S — отказ (значение без источника не подставляется)', () => {
    for (const [label, build] of [
      ['no-prov-T', () => solubilityInput({ noProvT: true })],
      ['no-prov-S', () => solubilityInput({ noProvS: true })]
    ] as const) {
      const result = evaluateCO2Solubility(build());
      expect(result.status, label).toBe('not_applied');
      if (result.status === 'not_applied') {
        expect(result.issues.join(' ')).toContain('provenance');
      }
    }
  });

  it('границы конверта: включительно на границе, отказ чуть за ней (никакой экстраполяции)', () => {
    expect(evaluateCO2Solubility(solubilityInput({ T: 273.15, S: 0 })).status).toBe('applied');
    expect(evaluateCO2Solubility(solubilityInput({ T: 313.15, S: 40 })).status).toBe('applied');
    const cold = evaluateCO2Solubility(solubilityInput({ T: 273.0 }));
    expect(cold.status).toBe('not_applied');
    if (cold.status === 'not_applied') expect(cold.reasonKind).toBe('out_of_applicability');
    const hot = evaluateCO2Solubility(solubilityInput({ T: 313.2 }));
    expect(hot.status).toBe('not_applied');
    if (hot.status === 'not_applied') expect(hot.reasonKind).toBe('out_of_applicability');
    const salty = evaluateCO2Solubility(solubilityInput({ S: 40.5 }));
    expect(salty.status).toBe('not_applied');
    if (salty.status === 'not_applied') expect(salty.reasonKind).toBe('out_of_applicability');
  });
});

// ============================================
// 2. ФУГАТИВНОСТЬ: p_CO2, f_CO2, СУХАЯ/ВЛАЖНАЯ ОСНОВЫ
// ============================================

describe('Stage 4.9e фугативность: основы и единицы', () => {
  it('wet-основа: 400 ppm при p_total = 101325 Pa даёт p_CO2 = 4.0e-4 atm (никакого масштабного сдвига Pa↔atm)', () => {
    const result = computeCO2Fugacity({
      co2MoleFraction: 400e-6,
      moleFractionBasis: 'wet_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 101325,
      totalPressureProvenance: PROV_P
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(Math.abs(result.pCO2Atm - 4.0e-4) / 4.0e-4).toBeLessThan(1e-12);
    expect(result.fugacityUnit).toBe('atm');
    expect(result.idealFugacityAssumption).toBe(true);
    expect(result.waterVaporPressureAtmForDryBasis).toBeNull();
  });

  it('dry-основа требует явного пара: p_CO2 = (p_total − p_H2O)·x_dry, без молчаливого wet-пересчёта', () => {
    const wet = computeCO2Fugacity({
      co2MoleFraction: 400e-6,
      moleFractionBasis: 'wet_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 103000,
      totalPressureProvenance: PROV_P
    });
    const dry = computeCO2Fugacity({
      co2MoleFraction: 400e-6,
      moleFractionBasis: 'dry_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 103000,
      totalPressureProvenance: PROV_P,
      waterVaporPressurePa: 2338,
      waterVaporPressureProvenance: PROV_P
    });
    expect(wet.status).toBe('applied');
    expect(dry.status).toBe('applied');
    if (wet.status !== 'applied' || dry.status !== 'applied') return;
    const expectedDry = ((103000 - 2338) / 101325) * 400e-6;
    expect(Math.abs(dry.pCO2Atm - expectedDry) / expectedDry).toBeLessThan(1e-12);
    // основы НЕ одинаковы: вычитание пара действительно подействовало
    expect(dry.pCO2Atm).toBeLessThan(wet.pCO2Atm);
    expect(dry.waterVaporPressureAtmForDryBasis).toBeCloseTo(2338 / 101325, 15);
    expect(dry.warnings.join(' ')).toContain('сухой газ');
  });

  it('dry-основа без p_H2O — отказ (молчаливая подмена основ запрещена)', () => {
    const result = computeCO2Fugacity({
      co2MoleFraction: 400e-6,
      moleFractionBasis: 'dry_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 101325,
      totalPressureProvenance: PROV_P
    });
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.issues.join(' ')).toContain('waterVaporPressurePa');
    }
  });

  it('p_H2O >= p_total — некорректная форма: отказ', () => {
    const result = computeCO2Fugacity({
      co2MoleFraction: 400e-6,
      moleFractionBasis: 'dry_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 101325,
      totalPressureProvenance: PROV_P,
      waterVaporPressurePa: 101326,
      waterVaporPressureProvenance: PROV_P
    });
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reason).toContain('полного давления');
    }
  });

  it('wet-основа с заданным p_H2O: поле НЕ используется (без двойного вычитания), предупреждение присутствует', () => {
    const withField = computeCO2Fugacity({
      co2MoleFraction: 400e-6,
      moleFractionBasis: 'wet_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 101325,
      totalPressureProvenance: PROV_P,
      waterVaporPressurePa: 2338,
      waterVaporPressureProvenance: PROV_P
    });
    expect(withField.status).toBe('applied');
    if (withField.status !== 'applied') return;
    expect(withField.pCO2Atm).toBeCloseTo(400e-6, 20);
    expect(withField.warnings.join(' ')).toContain('не используется');
  });

  it('некорректная молярная доля (NaN, > 1, < 0) и неопределённые provenance — отказы', () => {
    const base = {
      moleFractionBasis: 'wet_air' as const,
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 101325,
      totalPressureProvenance: PROV_P
    };
    for (const x of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -0.1]) {
      const result = computeCO2Fugacity({ ...base, co2MoleFraction: x });
      expect(result.status).toBe('not_applied');
      if (result.status === 'not_applied') expect(result.reasonKind).toBe('invalid_input');
    }
    const noProv = computeCO2Fugacity({ ...base, co2MoleFraction: 400e-6, moleFractionProvenance: { note: 'без источника' } as unknown as DataProvenance });
    expect(noProv.status).toBe('not_applied');
    const noProvP = computeCO2Fugacity({ ...base, co2MoleFraction: 400e-6, totalPressureProvenance: {} as unknown as DataProvenance });
    expect(noProvP.status).toBe('not_applied');
  });

  it('заданный phi: f = phi·p, idealFugacityAssumption = false; phi без provenance — отказ', () => {
    const result = computeCO2Fugacity({
      co2MoleFraction: 400e-6,
      moleFractionBasis: 'wet_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 101325,
      totalPressureProvenance: PROV_P,
      fugacityCoefficient: 0.9955,
      fugacityCoefficientProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: phi (проверенный EOS-выход вызывающей стороны)' }
    });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.idealFugacityAssumption).toBe(false);
    expect(Math.abs(result.fCO2Atm - 0.9955 * 4.0e-4) / 4.0e-4).toBeLessThan(1e-12);
    const noProv = computeCO2Fugacity({
      co2MoleFraction: 400e-6,
      moleFractionBasis: 'wet_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 101325,
      totalPressureProvenance: PROV_P,
      fugacityCoefficient: 0.9955
    });
    expect(noProv.status).toBe('not_applied');
    if (noProv.status === 'not_applied') expect(noProv.reason).toContain('provenance');
  });

  it('p_CO2 выше конверта модуля (5 atm) — out_of_applicability, а не предполагаемая поправка', () => {
    const result = computeCO2Fugacity({
      co2MoleFraction: 0.5,
      moleFractionBasis: 'wet_air',
      moleFractionProvenance: PROV_GAS,
      totalPressurePa: 20 * 101325,
      totalPressureProvenance: PROV_P
    });
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reasonKind).toBe('out_of_applicability');
      expect(String(CO2_FUGACITY_MAX_ATM)).toBeDefined();
    }
  });
});

// ============================================
// 3. РАВНОВЕСИЕ ГЕНРИ ДЛЯ ЗАДАННОЙ ФУГИТИВНОСТИ
// ============================================

describe('Stage 4.9e равновесие Генри: [CO2*] = K0·f_CO2', () => {
  it('400 ppm при 25 °C, S=35: [CO2*] ≈ 1.1507e-5 mol/kg-SW; единицы mol/kg-SW; НЕ скорость', () => {
    const result = calculateCO2AqueousEquilibrium(henryInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const expected = co2SolubilityK0Weiss1974(298.15, 35) * FCO2_FIXTURE;
    expect(Math.abs(result.co2StarMolPerKgSw - expected) / expected).toBeLessThan(1e-12);
    expect(result.concentrationUnit).toBe('mol/kg-SW');
    expect(result.solubilityUnit).toBe('mol/kg-SW/atm');
    expect(result.equilibriumKind).toBe('thermodynamic_target_not_kinetics');
    expect(result.warnings.join(' ')).toContain('НЕ вычисляются');
    // отсутствие фиктивной кинетики: в результате нет полей скорости
    const keys = Object.keys(result).join(' ').toLowerCase();
    expect(keys.includes('rate')).toBe(false);
    expect(keys.includes('velocity')).toBe(false);
  });

  it('фугитивность только в atm: единица «Pa» — отказ без молчаливой конверсии', () => {
    const result = calculateCO2AqueousEquilibrium(henryInput({ fCO2Unit: 'Pa' as never }));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.issues.join(' ')).toContain('Pa');
      expect(result.reason).toContain('atm');
    }
  });

  it('NaN/Infinity/неположительная фугитивность — контролируемый отказ', () => {
    for (const f of [Number.NaN, Number.POSITIVE_INFINITY, 0, -4.0531e-4]) {
      const result = calculateCO2AqueousEquilibrium(henryInput({ fCO2: f }));
      expect(result.status, String(f)).toBe('not_applied');
    }
  });

  it('фугативность без provenance — отказ', () => {
    const result = calculateCO2AqueousEquilibrium(henryInput({ fCO2Provenance: { sourceName: '' } as unknown as DataProvenance }));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') expect(result.reason).toContain('provenance');
  });

  it('фугативность выше конверта модуля — out_of_applicability', () => {
    const result = calculateCO2AqueousEquilibrium(henryInput({ fCO2: CO2_FUGACITY_MAX_ATM + 1 }));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reasonKind).toBe('out_of_applicability');
      expect(result.reason).toContain(String(CO2_FUGACITY_MAX_ATM));
    }
  });
});

// ============================================
// 4. ЦЕЛЕВОЙ DIC ПОИСКОМ ПОВЕРХ РЕШАТЕЛЯ STAGE 4.9c
// ============================================

describe('Stage 4.9e целевой DIC через существующий решатель 4.9c', () => {
  it('Henry-цель 400 ppm при TA_C = 2.2e-3 (25 °C, S=35): DIC ≈ 2.00e-3, pH ≈ 8.0; согласованность с решателем 4.9c', () => {
    const result = solveDICForTargetCO2Star(dicSearchInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // решение соответствует цели в относительном допуске модуля
    expect(result.relativeResidual).toBeLessThan(1e-9);
    expect(result.achievedCO2StarMolPerKgSw).toBe(result.solve.speciesMolPerKgSw.co2_aq);
    expect(result.hydrogenMolPerKgSw).toBe(result.solve.hydrogenMolPerKgSw);
    // DIC физически разумный (synthetic test fixture TA_C): порядок 2e-3
    expect(result.dicMolPerKgSw).toBeGreaterThan(1e-4);
    expect(result.dicMolPerKgSw).toBeLessThan(1e-2);
    expect(result.solve.ph).toBeGreaterThan(7.5);
    expect(result.solve.ph).toBeLessThan(8.5);
    // решатель 4.9c подтвердил сохранение DIC и щёлочность
    expect(result.solve.dicConservationResidualMolPerKgSw).toBeLessThanOrEqual(1e-12);
    expect(result.solve.alkalinityResidualMolPerKgSw).not.toBeNull();
    expect(result.solve.mode).toBe('alkalinity');
    expect(result.warnings.join(' ')).toContain('второй карбонатный решатель не создаётся');
  });

  it('NaN-щёлочность, отсутствие provenance — контролируемые отказы', () => {
    for (const [label, overrides] of [
      ['nan-ta', { carbonateAlkalinityMolPerKgSw: Number.NaN }],
      ['nan-target', { targetCO2StarMolPerKgSw: Number.NaN }],
      ['zero-target', { targetCO2StarMolPerKgSw: 0 }],
      ['no-prov', { targetCO2StarProvenance: { note: 'без источника' } as unknown as DataProvenance }]
    ] as const) {
      const raw = dicSearchInput();
      const patched = { ...raw, ...overrides } as never;
      const result = solveDICForTargetCO2Star(patched);
      expect(result.status, label).toBe('not_applied');
      if (result.status === 'not_applied') {
        expect(result.reasonKind, label).toBe('invalid_input');
      }
    }
  });

  it('несовместимые модель активности/шкала pH проходят ЯВНО (решатель 4.9c даёт причину)', () => {
    const badModel = solveDICForTargetCO2Star(dicSearchInput({ activityModel: 'pitzer' } as never));
    expect(badModel.status).toBe('not_applied');
    if (badModel.status === 'not_applied') {
      expect(badModel.reasonKind).toBe('unsupported_activity_model');
    }
    const badScale = solveDICForTargetCO2Star(dicSearchInput({ phScale: 'free' } as never));
    expect(badScale.status).toBe('not_applied');
    if (badScale.status === 'not_applied') {
      expect(badScale.reasonKind).toBe('unsupported_ph_scale');
    }
  });

  it('условия вне конверта решателя (T = 40 °C) — out_of_applicability, значение не подставляется', () => {
    const result = solveDICForTargetCO2Star(dicSearchInput({ temperatureK: 313.15 + 5 }));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reasonKind).toBe('out_of_applicability');
    }
  });

  it('абсурдно завышенная цель ([H+] > 1 потребовался бы) — out_of_applicability границы решателя', () => {
    const result = solveDICForTargetCO2Star(dicSearchInput({ targetCO2StarMolPerKgSw: 1e9 }));
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reasonKind).toBe('out_of_applicability');
      expect(result.reason).toContain('[1e-16, 1]');
    }
  });
});

// ============================================
// 5. ЗАМКНУТОЕ РАВНОВЕСИЕ АТМОСФЕРА-ОКЕАН
// ============================================

describe('Stage 4.9e замкнутое равновесие атмосфера-океан', () => {
  it('полный синтетический набор входов: равновесие сходится, общий углерод сохранён, направление обмена честное', () => {
    const result = evaluateAtmosphereOceanEquilibrium(equilibriumInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const atmBefore = 0.0169;
    const dicBefore = 2.15;
    const total = atmBefore + dicBefore;
    // сохранение общего углерода (атм co2 + растворённый DIC)
    expect(result.totalCarbonColumnMolPerM2).toBeCloseTo(total, 15);
    expect(
      Math.abs(result.atmosphereCO2ColumnAfterMolPerM2 + result.oceanDICMolPerKgSw * 1000 - total)
    ).toBeLessThanOrEqual(1e-9);
    expect(result.carbonConservationResidualMolPerM2).toBeLessThanOrEqual(result.carbonConservationToleranceMolPerM2);
    // согласованность фаз: f = phi·p (phi = 1 в фикстуре), [CO2*] = K0·f
    expect(result.fCO2Atm).toBeCloseTo(result.pCO2Atm, 18);
    expect(
      Math.abs(result.oceanCO2StarMolPerKgSw - result.K0MolPerKgSwPerAtm * result.fCO2Atm) /
        result.oceanCO2StarMolPerKgSw
    ).toBeLessThan(1e-9);
    // фикстура богата CO2: океан отдаёт газ (перенос ocn -> atm)
    expect(result.carbonTransferAtmToOceanMolPerM2).toBeLessThan(0);
    expect(result.atmosphereCO2ColumnAfterMolPerM2).toBeGreaterThan(atmBefore);
    // маркировка равновесия и явные идеальные допущения
    expect(result.equilibriumKind).toBe('thermodynamic_target_not_kinetics');
    expect(result.idealGasAssumption).toBe(true);
    expect(result.idealFugacityAssumption).toBe(true);
    expect(result.warnings.join(' ')).toContain('НЕ скорость');
    expect(result.warnings.join(' ')).toContain('идеальн');
  });

  it('равновесное p_CO2 согласовано с идеальным столбом (обратный пересчёт mol/m² <-> atm без масштабной ошибки)', () => {
    const result = evaluateAtmosphereOceanEquilibrium(equilibriumInput());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const backFromPressure = (result.pCO2Atm * 101325) / (CO2_GAS_CONSTANT_J_PER_MOL_K * 288.15);
    expect(Math.abs(backFromPressure - result.atmosphereCO2ColumnAfterMolPerM2)).toBeLessThan(1e-12);
  });

  it('заданный phi неидеальности: равновесие учитывает его (f ≠ p), сохранение углерода удерживается', () => {
    const result = evaluateAtmosphereOceanEquilibrium(
      equilibriumInput({
        atmosphere: {
          gasTemperatureK: 288.15,
          gasTemperatureProvenance: PROV_T,
          fugacityCoefficient: 0.999,
          fugacityCoefficientProvenance: { ...FIXTURE_PROVENANCE, note: 'synthetic test fixture: phi' }
        }
      })
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.idealFugacityAssumption).toBe(false);
    expect(result.fCO2Atm).toBeCloseTo(result.pCO2Atm * 0.999, 18);
  });

  it('нехватка газового состояния атмосферы — not_verifiable со списком недостающих входов', () => {
    const raw: Record<string, unknown> = { ...equilibriumInput() };
    delete raw.atmosphere;
    const result = evaluateAtmosphereOceanEquilibrium(raw as never);
    expect(result.status).toBe('not_verifiable');
    if (result.status === 'not_verifiable') {
      expect(result.missingInputs.join(' ')).toContain('atmosphere');
    }
  });

  it('нехватка массы столба / TA / состава океана — not_verifiable с перечислением', () => {
    for (const [label, key] of [
      ['no-mass', 'seawaterColumnMassKgPerM2'],
      ['no-ta', 'carbonateAlkalinityMolPerKgSw'],
      ['no-ocean', 'oceanChemistry'],
      ['no-atm-co2', 'atmosphereCO2ColumnMolPerM2'],
      ['no-dic', 'oceanDICColumnMolPerM2']
    ] as const) {
      const raw: Record<string, unknown> = { ...equilibriumInput() };
      delete raw[key];
      const result = evaluateAtmosphereOceanEquilibrium(raw as never);
      expect(result.status, label).toBe('not_verifiable');
      if (result.status === 'not_verifiable') {
        expect(result.missingInputs.join(' ')).toContain(String(key));
      }
    }
  });

  it('масса столба без provenance — not_verifiable (происхождение обязательно)', () => {
    const raw: Record<string, unknown> = { ...equilibriumInput() };
    raw.seawaterColumnMassKgPerM2 = { valueKgPerM2: 1000, unit: SEAWATER_COLUMN_MASS_UNIT, provenance: { note: 'без источника' } };
    const result = evaluateAtmosphereOceanEquilibrium(raw as never);
    expect(result.status).toBe('not_verifiable');
    if (result.status === 'not_verifiable') {
      expect(result.missingInputs.join(' ')).toContain('provenance');
    }
  });

  it('неправильная единица массы столба и NaN-входы — контролируемый отказ (не ноль, не выдумка)', () => {
    const badUnit: Record<string, unknown> = { ...equilibriumInput() };
    badUnit.seawaterColumnMassKgPerM2 = { valueKgPerM2: 1000, unit: 'kg/m2', provenance: FIXTURE_PROVENANCE };
    const r1 = evaluateAtmosphereOceanEquilibrium(badUnit as never);
    expect(r1.status).toBe('not_applied');
    if (r1.status === 'not_applied') expect(r1.issues.join(' ')).toContain('kg-SW');
    const badNaN: Record<string, unknown> = { ...equilibriumInput() };
    badNaN.atmosphereCO2ColumnMolPerM2 = { value: Number.NaN, provenance: FIXTURE_PROVENANCE };
    const r2 = evaluateAtmosphereOceanEquilibrium(badNaN as never);
    expect(r2.status).toBe('not_applied');
    if (r2.status === 'not_applied') expect(r2.reasonKind).toBe('invalid_input');
  });

  it('слишком много углерода в системе: равновесная фугитивность выше конверта — out_of_applicability (экстраполяции нет)', () => {
    const result = evaluateAtmosphereOceanEquilibrium(
      equilibriumInput({
        atmosphereCO2ColumnMolPerM2: { value: 15000, provenance: FIXTURE_PROVENANCE },
        oceanDICColumnMolPerM2: { value: 5000, provenance: FIXTURE_PROVENANCE }
      })
    );
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reasonKind).toBe('out_of_applicability');
      expect(result.reason).toContain('1 атм');
    }
  });

  it('слишком мало углерода: океан требует больше даже при f около нуля — no_solution без выдумки', () => {
    const result = evaluateAtmosphereOceanEquilibrium(
      equilibriumInput({
        atmosphereCO2ColumnMolPerM2: { value: 0, provenance: FIXTURE_PROVENANCE },
        oceanDICColumnMolPerM2: { value: 1e-4, provenance: FIXTURE_PROVENANCE }
      })
    );
    expect(result.status).toBe('not_applied');
    if (result.status === 'not_applied') {
      expect(result.reasonKind).toBe('no_solution');
      expect(result.reason).toContain('больше углерода');
    }
  });

  it('детерминизм: идентичные входы дают идентичные результаты (по JSON)', () => {
    const a = evaluateAtmosphereOceanEquilibrium(equilibriumInput());
    const b = evaluateAtmosphereOceanEquilibrium(equilibriumInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('результат НЕ заявляет закрытия H/O-баланса и не содержит фиктивной кинетической скорости', () => {
    const result: CO2AtmosphereOceanEquilibriumResult = evaluateAtmosphereOceanEquilibrium(equilibriumInput());
    const text = JSON.stringify(result).toLowerCase();
    expect(text.includes('закрыт')).toBe(false);
    expect(text.includes('rate')).toBe(false);
    expect(text.includes('velocity')).toBe(false);
    expect(result.status === 'applied' ? result.warnings.join(' ') : '').toContain('кинетика газообмена');
  });
});
