// ============================================
// CO2 SOLUBILITY — растворимость CO2 по закону Генри, равновесие
// атмосфера-океан (Stage 4.9e)
// ============================================
//
// ТЕРМОДИНАМИКА растворимости и распределения CO2 между газовой и
// водной фазами. Это НЕ кинетика газообмена: модуль определяет
// равновесную цель (какая [CO2*] и какое распределение углерода
// соответствуют заданной фугитивности/составу), но НИКАК не скорость
// достижения цели. Коэффициенты переноса, ветровые параметризации,
// толщина пограничного слоя и временные шаги газообмена здесь
// отсутствуют сознательно (граница этапа 4.9e; кинетика — отдельный
// следующий этап с собственным источником и provenance).
//
// ФИЗИЧЕСКИЙ ИСТОЧНИК (коэффициенты закодированы дословно):
// - Weiss, R. F. (1974), «Carbon dioxide in water and seawater: the
//   solubility of a non-ideal gas», Marine Chemistry 2(3):203-215,
//   DOI 10.1016/0304-4203(74)90015-2 — K0 (mol/kg-SW/atm):
//   ln K0 = A1 + A2·(100/T) + A3·ln(T/100)
//           + S·(B1 + B2·(T/100) + B3·(T/100)^2),
//   T в K, S — практическая солёность. Решение в основном
//   воспроизведено штатной параметризацией PyCO2SYS
//   (Humphreys et al., GMD 2022) — перекрёстная проверка чисел,
//   код не копируется;
// - газовая постоянная: CODATA 2018, R = 8.314462618 J/(mol·K);
//   стандартная атмосфера 101325 Pa — только для ЯВНОГО преобразования
//   единиц давления (никаких молчаливых atm <-> Pa).
//
// ФУГАТИВНОСТЬ, НЕ ПАРЦИАЛЬНОЕ ДАВЛЕНИЕ:
// - f_CO2 = phi_CO2 · p_CO2; коэффициент фугитивности phi задаётся
//   вызывающей стороной (например, из pengRobinson-модулей ядра);
//   ОТСУТСТВИЕ phi — ЯВНОЕ идеальное допущение phi = 1 с пометкой
//   idealFugacityAssumption = true: идеальное приближение не выдаётся
//   за точную неидеальную модель;
// - сухая и влажная основы молярной доли НЕ смешиваются: 'dry_air'
//   требует явного парциального давления водяного пара
//   (p_CO2 = (p_total - p_H2O)·x_dry); 'wet_air' использует
//   p_CO2 = p_total·x_wet; смешение основ молчаливой пересадкой
//   доли запрещено.
//
// ПРИМЕНИМОСТЬ: конверт модуля берётся из условий измерений
// первоисточника (Weiss 1974: измерения при T примерно 0..40 °C,
// S = 0..40 на давлениях, близких к 1 атм) и применяется fail-closed:
// вне конверта значение НЕ подставляется (out_of_applicability),
// никаких выдуманных высокотемпературных/высокодавлений поправок.
//
// СВЯЗЬ С STAGE 4.9c (второго решателя НЕТ):
// - Henry задаёт целевую [CO2*] = K0·f_CO2 (mol/kg-SW);
// - распределение DIC между co2_aq/hco3_aq/co3_aq при целевой [CO2*]
//   и заданной карбонатной щёлочности выполняет СУЩЕСТВУЮЩИЙ
//   solveCarbonateEquilibrium (Stage 4.9c); поиск целевого DIC
//   вызывает только его, внутренние формулы K1/K2 не дублируются;
// - шкалы pH ('seawater' | 'total'), модель активности
//   ('ideal_dilute'), T/S/P не смешиваются с другими вариантами;
// - co2 != co2_aq: газовый CO2 атмосферы и растворённый CO2*(aq)
//   океана — РАЗНЫЕ виды каталога с разными reservoirId; молчаливого
//   отождествления нет.

import type { DataProvenance } from './scientificValue';
import {
  CARBONATE_CONCENTRATION_UNIT,
  CARBONATE_STANDARD_ATMOSPHERE_PA,
  solveCarbonateEquilibrium
} from './carbonateChemistry';
import type {
  CarbonateActivityModel,
  CarbonateConstantProvenance,
  CarbonateModelResult,
  CarbonatePhScale
} from './carbonateChemistry';
import { SEAWATER_COLUMN_MASS_UNIT } from './carbonateSpeciationExecution';
import type { SeawaterColumnMass } from './carbonateSpeciationExecution';

// ============================================
// 1. КОНСТАНТЫ И PROVENANCE ИСТОЧНИКА
// ============================================

/** Единица K0 и [CO2*]-целей Henry: mol/kg-SW/atm. */
export const CO2_SOLUBILITY_UNIT = 'mol/kg-SW/atm' as const;

/** Единица фугитивности/парциального давления в этом модуле. */
export const CO2_FUGACITY_UNIT = 'atm' as const;

/** Единица столбовых количеств (mol/m², как в остальной геохимии ядра). */
export const CO2_COLUMN_AMOUNT_UNIT = 'mol/m2' as const;

/**
 * Коэффициенты Weiss (1974) для ln K0, дословно из источника
 * (T в K, S — практическая солёность).
 */
export const WEISS_1974_K0_COEFFICIENTS = {
  A1: -60.2409,
  A2: 93.4517,
  A3: 23.3585,
  B1: 0.023517,
  B2: -0.023656,
  B3: 0.0047036
} as const;

/**
 * Конверт применимости Weiss (1974) — условия ИЗМЕРЕНИЙ
 * первоисточника: T примерно 0..40 °C, S = 0..40. Выход за конверт —
 * контролируемый отказ (out_of_applicability), экстраполяция молчаливой
 * подменой запрещена. Внутри конверта [, ] включительно.
 */
export const WEISS_1974_APPLICABILITY = {
  temperatureKMinInclusive: 273.15,
  temperatureKMaxInclusive: 313.15,
  salinityMinInclusive: 0,
  salinityMaxInclusive: 40
} as const;

/**
 * Модульная граница применимости по фугативности (политика модуля,
 * НЕ новый физический результат): измерения Weiss (1974) выполнены
 * при давлениях, близких к 1 атм. Равновесия с f_CO2 заметно выше
 * этой границы — экстраполяция, для которой в проекте НЕТ
 * верифицированной поправки: fail-closed out_of_applicability.
 */
export const CO2_FUGACITY_MAX_ATM = 5;

/**
 * Газовая постоянная, CODATA 2018 (J/(mol·K)) — для перехода
 * столбовое количество газа (mol/m2) <-> парциальное давление (Pa)
 * при ЯВНО заявленном идеальном приближении газовой фазы.
 */
export const CO2_GAS_CONSTANT_J_PER_MOL_K = 8.314462618;

/**
 * Константа Генри K0 по Weiss (1974) как чистая функция условий.
 * Ничего не валидирует — численное ядро для результатов c диагностикой.
 */
export function co2SolubilityK0Weiss1974(temperatureK: number, salinityPSU: number): number {
  const c = WEISS_1974_K0_COEFFICIENTS;
  return Math.exp(
    c.A1 +
      c.A2 * (100 / temperatureK) +
      c.A3 * Math.log(temperatureK / 100) +
      salinityPSU * (c.B1 + c.B2 * (temperatureK / 100) + c.B3 * (temperatureK / 100) ** 2)
  );
}

/**
 * Provenance параметризации (едино для всех результатов модуля).
 * Явное отличие первоисточника и модульной политики применимости.
 */
export const CO2_SOLUBILITY_PROVENANCE: CarbonateConstantProvenance = {
  sourceName:
    'Weiss, R. F. (1974): Carbon dioxide in water and seawater: the solubility of a non-ideal gas',
  sourceId: 'doi:10.1016/0304-4203(74)90015-2',
  reference: 'Marine Chemistry 2(3):203-215; перекрёстная проверка чисел: штатная параметризация PyCO2SYS (Humphreys et al., GMD 2022)',
  retrievedAt: '2026-11-22',
  method: 'коэффициенты закодированы дословно из источника; вычисление — чистая функция T и S',
  conditions:
    'K0 в mol/kg-SW/atm; T в K; S — практическая солёность; измерения источника выполнены при T примерно 0..40 °C, S = 0..40 на давлениях, близких к 1 атм',
  applicability:
    'морская и пресная вода в конверте измерений источника; [CO2*] = K0·f_CO2 — единственно определённая этим модулем связь',
  limitations:
    'параметризация получена при давлениях, близких к 1 атм: применения с f_CO2 > CO2_FUGACITY_MAX_ATM вне конверта модуля (отказ); неидеальность растворённого CO2 и температурная зависимость K0 на других давлениях не учитываются; модуль НЕ описывает кинетику газообмена',
  formula:
    'ln K0 = A1 + A2·(100/T) + A3·ln(T/100) + S·(B1 + B2·(T/100) + B3·(T/100)^2); A = (-60.2409, 93.4517, 23.3585), B = (0.023517, -0.023656, 0.0047036)'
};

/** Источник идентифицирован? (конвенция Stage 4.9b/4.9c/4.9d). */
function provenanceIdentified(p: unknown): boolean {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return false;
  const r = p as Record<string, unknown>;
  return (
    (typeof r.sourceName === 'string' && r.sourceName.trim() !== '') ||
    (typeof r.sourceId === 'string' && r.sourceId.trim() !== '') ||
    (typeof r.datasetId === 'string' && r.datasetId.trim() !== '') ||
    (typeof r.reference === 'string' && r.reference.trim() !== '')
  );
}

function finitePositive(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function finiteNonNegative(v: number): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// ============================================
// 2. K0: ВЫЧИСЛИМОСТЬ С ЗДРАВОЙ ДИАГНОСТИКОЙ
// ============================================

/** Вход решения K0. */
export interface CO2SolubilityInput {
  /** Температура, K (условия равновесия на границе газ-вода). */
  readonly temperatureK: number;
  readonly temperatureProvenance: DataProvenance;
  /** Практическая солёность, согласованная с параметризацией источника. */
  readonly salinityPSU: number;
  readonly salinityProvenance: DataProvenance;
}

/** Успешное значение K0 (plain-JSON). */
export type CO2SolubilityResult =
  | {
      readonly status: 'applied';
      /** Растворимость CO2, mol/kg-SW/atm. */
      readonly K0MolPerKgSwPerAtm: number;
      readonly unit: typeof CO2_SOLUBILITY_UNIT;
      readonly temperatureK: number;
      readonly salinityPSU: number;
      readonly provenance: CarbonateConstantProvenance;
      readonly applicability: typeof WEISS_1974_APPLICABILITY;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: 'invalid_input' | 'out_of_applicability';
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Вычислить K0 (Weiss 1974) с проверкой формы, provenance и конверта
 * применимости. Чистая функция; никаких побочных эффектов.
 */
export function evaluateCO2Solubility(input: CO2SolubilityInput): CO2SolubilityResult {
  const issues: string[] = [];
  if (!finitePositive(input.temperatureK)) {
    issues.push('temperatureK должен быть конечным положительным числом (K), получено ' + String(input?.temperatureK));
  }
  if (!finiteNonNegative(input.salinityPSU)) {
    issues.push('salinityPSU должен быть конечным неотрицательным числом (практическая солёность), получено ' + String(input?.salinityPSU));
  }
  if (!provenanceIdentified(input.temperatureProvenance)) {
    issues.push('temperatureProvenance обязателен и должен идентифицировать источник');
  }
  if (!provenanceIdentified(input.salinityProvenance)) {
    issues.push('salinityProvenance обязателен и должен идентифицировать источник');
  }
  if (issues.length > 0) {
    return {
      status: 'not_applied',
      reasonKind: 'invalid_input',
      reason: 'вход K0 не проходит валидацию формы/provenance',
      issues
    };
  }
  const a = WEISS_1974_APPLICABILITY;
  if (input.temperatureK < a.temperatureKMinInclusive || input.temperatureK > a.temperatureKMaxInclusive) {
    return {
      status: 'not_applied',
      reasonKind: 'out_of_applicability',
      reason:
        'температура вне конверта измерений Weiss (1974): значение K0 НЕ подставляется экстраполяцией (выдуманные поправки запрещены)',
      issues: ['temperatureK = ' + String(input.temperatureK) + ' вне [' + String(a.temperatureKMinInclusive) + ', ' + String(a.temperatureKMaxInclusive) + '] K (измерения: примерно 0..40 °C)']
    };
  }
  if (input.salinityPSU < a.salinityMinInclusive || input.salinityPSU > a.salinityMaxInclusive) {
    return {
      status: 'not_applied',
      reasonKind: 'out_of_applicability',
      reason: 'солёность вне конверта измерений Weiss (1974): значение K0 НЕ подставляется экстраполяцией',
      issues: ['salinityPSU = ' + String(input.salinityPSU) + ' вне [' + String(a.salinityMinInclusive) + ', ' + String(a.salinityMaxInclusive) + ']']
    };
  }
  const k0 = co2SolubilityK0Weiss1974(input.temperatureK, input.salinityPSU);
  if (!Number.isFinite(k0) || k0 <= 0) {
    return {
      status: 'not_applied',
      reasonKind: 'invalid_input',
      reason: 'вычисленное K0 непредставимо (переполнение: конечные входы не гарантируют конечности экспоненты)',
      issues: ['K0 = ' + String(k0)]
    };
  }
  return {
    status: 'applied',
    K0MolPerKgSwPerAtm: k0,
    unit: CO2_SOLUBILITY_UNIT,
    temperatureK: input.temperatureK,
    salinityPSU: input.salinityPSU,
    provenance: CO2_SOLUBILITY_PROVENANCE,
    applicability: WEISS_1974_APPLICABILITY,
    warnings: [
      'K0 в mol/kg-SW/atm: пересчёт в другие концентрационные единицы молчаливо НЕ выполняется',
      'равновесие Генри задаёт термодинамическую цель, но НЕ скорость достижения цели (кинетика газообмена — вне этапа 4.9e)'
    ]
  };
}

// ============================================
// 3. ФУГАТИВНОСТЬ: p_CO2, f_CO2, сухая/влажная основы
// ============================================

/** Основа молярной доли CO2 в газе. */
export type CO2MoleFractionBasis = 'dry_air' | 'wet_air';

/** Вход вычисления фугитивности. */
export interface CO2FugacityInput {
  /** Молярная доля CO2 (безразмерная, 0..1) на ЯВНО указанной основе. */
  readonly co2MoleFraction: number;
  readonly moleFractionBasis: CO2MoleFractionBasis;
  readonly moleFractionProvenance: DataProvenance;
  /** Полное давление газовой смеси, Pa (атмосфера + статика). */
  readonly totalPressurePa: number;
  readonly totalPressureProvenance: DataProvenance;
  /**
   * Парциальное давление водяного пара, Pa. Обязательно для сухой
   * основы (явная поправка, никакого встроенного параметра насыщения
   * здесь нет); для влажной основы — допустимо, но НЕ используется.
   */
  readonly waterVaporPressurePa?: number;
  readonly waterVaporPressureProvenance?: DataProvenance;
  /**
   * Коэффициент фугативности phi (f = phi·p). Отсутствие — ЯВНОЕ
   * идеальное допущение phi = 1 (idealFugacityAssumption = true).
   */
  readonly fugacityCoefficient?: number;
  readonly fugacityCoefficientProvenance?: DataProvenance;
}

/** Успешная фугитивность (plain-JSON). */
export type CO2FugacityResult =
  | {
      readonly status: 'applied';
      /** Парциальное давление CO2, atm (в ДОЛях полного давления). */
      readonly pCO2Atm: number;
      /** Фугитивность CO2 = phi·p_CO2, atm. */
      readonly fCO2Atm: number;
      readonly fugacityUnit: typeof CO2_FUGACITY_UNIT;
      readonly moleFractionBasis: CO2MoleFractionBasis;
      readonly fugacityCoefficient: number;
      /** true — phi = 1 это ЯВНОЕ идеальное допущение, не измерение. */
      readonly idealFugacityAssumption: boolean;
      /** Парциальное давление H2O, atm (dry-основа; null у wet). */
      readonly waterVaporPressureAtmForDryBasis: number | null;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: 'invalid_input' | 'out_of_applicability';
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Вычислить p_CO2 и f_CO2 из молярной доли с ЯВНЫМ различием сухой и
 * влажной основ. Единственное преобразование давления Pa -> atm —
 * деление на стандартную атмосферу 101325 Pa (определение единицы),
 * выполняется явно и отражается в результате (единица atm).
 */
export function computeCO2Fugacity(input: CO2FugacityInput): CO2FugacityResult {
  const issues: string[] = [];
  if (typeof input?.co2MoleFraction !== 'number' || !Number.isFinite(input.co2MoleFraction) || input.co2MoleFraction < 0 || input.co2MoleFraction > 1) {
    issues.push('co2MoleFraction должен быть конечным числом в [0, 1]');
  }
  if (input.moleFractionBasis !== 'dry_air' && input.moleFractionBasis !== 'wet_air') {
    issues.push('moleFractionBasis должен быть «dry_air» или «wet_air»: смешение основ запрещено');
  }
  if (!finitePositive(input.totalPressurePa)) {
    issues.push('totalPressurePa должен быть конечным положительным числом (Pa)');
  }
  if (!provenanceIdentified(input?.moleFractionProvenance)) {
    issues.push('moleFractionProvenance обязателен и должен идентифицировать источник');
  }
  if (!provenanceIdentified(input?.totalPressureProvenance)) {
    issues.push('totalPressureProvenance обязателен и должен идентифицировать источник');
  }
  if (input?.moleFractionBasis === 'dry_air') {
    if (!finiteNonNegative(input.waterVaporPressurePa ?? NaN)) {
      issues.push('для сухой основы waterVaporPressurePa обязателен (конечное неотрицательное Pa): вычитание пара НЕ выполняется вслепую');
    } else if (!provenanceIdentified(input.waterVaporPressureProvenance)) {
      issues.push('waterVaporPressureProvenance обязателен для сухой основы');
    }
  }
  if (issues.length > 0) {
    return {
      status: 'not_applied',
      reasonKind: 'invalid_input',
      reason: 'вход фугативности не проходит валидацию формы/provenance',
      issues
    };
  }
  if (input.moleFractionBasis === 'dry_air' && (input.waterVaporPressurePa as number) >= input.totalPressurePa) {
    return {
      status: 'not_applied',
      reasonKind: 'invalid_input',
      reason: 'парциальное давление водяного пара не может быть >= полного давления газовой смеси',
      issues: ['p_H2O = ' + String(input.waterVaporPressurePa) + ' Pa, p_total = ' + String(input.totalPressurePa) + ' Pa']
    };
  }
  let fugacityCoefficient = 1;
  let idealAssumption = true;
  if (input.fugacityCoefficient !== undefined) {
    if (!finitePositive(input.fugacityCoefficient)) {
      return {
        status: 'not_applied',
        reasonKind: 'invalid_input',
        reason: 'fugacityCoefficient, если задан, должен быть конечным положительным числом',
        issues: ['phi = ' + String(input.fugacityCoefficient)]
      };
    }
    if (!provenanceIdentified(input.fugacityCoefficientProvenance)) {
      return {
        status: 'not_applied',
        reasonKind: 'invalid_input',
        reason: 'fugacityCoefficientProvenance обязателен при заданном phi: неидеальный коэффициент без происхождения не подставляется',
        issues: []
      };
    }
    fugacityCoefficient = input.fugacityCoefficient;
    idealAssumption = false;
  }
  const pTotalAtm = input.totalPressurePa / CARBONATE_STANDARD_ATMOSPHERE_PA;
  let pCO2Atm: number;
  let waterVaporPressureAtm: number | null = null;
  const warnings: string[] = [];
  if (input.moleFractionBasis === 'dry_air') {
    waterVaporPressureAtm = (input.waterVaporPressurePa as number) / CARBONATE_STANDARD_ATMOSPHERE_PA;
    pCO2Atm = (pTotalAtm - waterVaporPressureAtm) * input.co2MoleFraction;
    warnings.push('основа молярной доли — сухой газ: парциальное давление водяного пара вычтено ЯВНО (молчаливого wet-пересчёта не было)');
  } else {
    pCO2Atm = pTotalAtm * input.co2MoleFraction;
    warnings.push('основа молярной доли — влажный газ: H2O уже входит в долю, дополнительное вычитание НЕ выполнялось');
    if (input.waterVaporPressurePa !== undefined) {
      warnings.push('waterVaporPressurePa задан при влажной основе: поле не используется (проверьте согласованность входа)');
    }
  }
  if (!(pCO2Atm > 0) || !(pCO2Atm <= CO2_FUGACITY_MAX_ATM)) {
    return {
      status: 'not_applied',
      reasonKind: pCO2Atm > CO2_FUGACITY_MAX_ATM ? 'out_of_applicability' : 'invalid_input',
      reason:
        pCO2Atm > CO2_FUGACITY_MAX_ATM
          ? 'p_CO2 выше конверта модуля (измерения Weiss близки к 1 атм, политика модуля: до ' + String(CO2_FUGACITY_MAX_ATM) + ' atm): верифицированной высокотемпературной/давления поправки у проекта нет, отказ вместо выдумки'
          : 'пересчитанное p_CO2 непредставимо (неположительное)',
      issues: ['p_CO2 = ' + String(pCO2Atm) + ' atm']
    };
  }
  const fCO2Atm = fugacityCoefficient * pCO2Atm;
  if (!Number.isFinite(fCO2Atm) || fCO2Atm <= 0 || fCO2Atm > CO2_FUGACITY_MAX_ATM) {
    return {
      status: 'not_applied',
      reasonKind: fCO2Atm > CO2_FUGACITY_MAX_ATM ? 'out_of_applicability' : 'invalid_input',
      reason:
        fCO2Atm > CO2_FUGACITY_MAX_ATM
          ? 'фугитивность выше конверта модуля (см. CO2_FUGACITY_MAX_ATM)'
          : 'фугитивность непредставима (phi·p_CO2 переполнено или неположительно)',
      issues: ['f_CO2 = ' + String(fCO2Atm) + ' atm']
    };
  }
  if (idealAssumption) {
    warnings.push('phi не задан: применено ЯВНОЕ идеальное допущение phi = 1 (это НЕ точная неидеальная модель; неидеальность — отдельная модель EOS)');
  }
  return {
    status: 'applied',
    pCO2Atm,
    fCO2Atm,
    fugacityUnit: CO2_FUGACITY_UNIT,
    moleFractionBasis: input.moleFractionBasis,
    fugacityCoefficient,
    idealFugacityAssumption: idealAssumption,
    waterVaporPressureAtmForDryBasis: waterVaporPressureAtm,
    warnings
  };
}

// ============================================
// 4. РАВНОВЕСИЕ ГЕНРИ ДЛЯ ЗАДАННОЙ ФУГИТИВНОСТИ
// ============================================

/** Ввод равновесия Генри. */
export interface CO2HenryEquilibriumInput {
  /** Фугитивность CO2 (f = phi·p). */
  readonly fCO2: number;
  /** Единица фугативности; молчаливо допускается ТОЛЬКО 'atm'. */
  readonly fCO2Unit: typeof CO2_FUGACITY_UNIT;
  readonly fCO2Provenance: DataProvenance;
  readonly temperatureK: number;
  readonly temperatureProvenance: DataProvenance;
  readonly salinityPSU: number;
  readonly salinityProvenance: DataProvenance;
}

/** Успешное равновесие Генри (plain-JSON). */
export type CO2HenryEquilibriumResult =
  | {
      readonly status: 'applied';
      /** Равновесная [CO2*] = K0·f_CO2, mol/kg-SW. */
      readonly co2StarMolPerKgSw: number;
      readonly concentrationUnit: typeof CARBONATE_CONCENTRATION_UNIT;
      readonly K0MolPerKgSwPerAtm: number;
      readonly solubilityUnit: typeof CO2_SOLUBILITY_UNIT;
      readonly fCO2Atm: number;
      /** Равновесие — цель, НЕ скорость (жёсткая маркировка этапа). */
      readonly equilibriumKind: 'thermodynamic_target_not_kinetics';
      readonly provenance: CarbonateConstantProvenance;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: 'invalid_input' | 'out_of_applicability';
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Равновесная концентрация [CO2*] = K0·f_CO2 при заданной фугитивности
 * (мол/кг-SW). Никаких молчаливых atm <-> Pa и mol/L <-> mol/kg-SW:
 * фугитивность принимается ТОЛЬКО в atm, результат только в единице
 * карбонатного ядра mol/kg-SW.
 */
export function calculateCO2AqueousEquilibrium(input: CO2HenryEquilibriumInput): CO2HenryEquilibriumResult {
  if (typeof input !== 'object' || input === null) {
    return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'вход равновесия Генри должен быть объектом-записью (plain record)', issues: [] };
  }
  if (input.fCO2Unit !== CO2_FUGACITY_UNIT) {
    return {
      status: 'not_applied',
      reasonKind: 'invalid_input',
      reason: 'фугитивность принимается ТОЛЬКО в единице «atm»: молчаливой atm <-> Pa конверсии нет — переведите давление явно',
      issues: ['fCO2Unit = ' + String(input.fCO2Unit)]
    };
  }
  const sol = evaluateCO2Solubility(input);
  if (sol.status === 'not_applied') return sol;
  if (!finitePositive(input.fCO2)) {
    return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'fCO2 должен быть конечным положительным числом (atm)', issues: ['fCO2 = ' + String(input.fCO2)] };
  }
  if (!provenanceIdentified(input.fCO2Provenance)) {
    return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'fCO2Provenance обязателен и должен идентифицировать источник', issues: [] };
  }
  if (input.fCO2 > CO2_FUGACITY_MAX_ATM) {
    return {
      status: 'not_applied',
      reasonKind: 'out_of_applicability',
      reason: 'фугитивность выше конверта модуля (измерения Weiss близки к 1 атм, политика модуля: до ' + String(CO2_FUGACITY_MAX_ATM) + ' atm)',
      issues: ['f_CO2 = ' + String(input.fCO2) + ' atm']
    };
  }
  const co2Star = sol.K0MolPerKgSwPerAtm * input.fCO2;
  if (!Number.isFinite(co2Star) || co2Star <= 0) {
    return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'произведение K0·f_CO2 непредставимо', issues: ['[CO2*] = ' + String(co2Star)] };
  }
  return {
    status: 'applied',
    co2StarMolPerKgSw: co2Star,
    concentrationUnit: CARBONATE_CONCENTRATION_UNIT,
    K0MolPerKgSwPerAtm: sol.K0MolPerKgSwPerAtm,
    solubilityUnit: CO2_SOLUBILITY_UNIT,
    fCO2Atm: input.fCO2,
    equilibriumKind: 'thermodynamic_target_not_kinetics',
    provenance: CO2_SOLUBILITY_PROVENANCE,
    warnings: [
      ...sol.warnings,
      '[CO2*] — термодинамическая цель при заданной фугитивности: ни скорость растворения, ни время установления здесь НЕ вычисляются'
    ]
  };
}

// ============================================
// 5. ЦЕЛЕВОЙ DIC ПО ЗАДАННОЙ [CO2*] — ПОИСК ЧЕРЕЗ СУЩЕСТВУЮЩИЙ
//    РЕШИТЕЛЬ STAGE 4.9c (вторая реализация НЕ создаётся)
// ============================================

/**
 * Найденный аналитической формой [H+] проверяется тем же решателем
 * Stage 4.9c: расхождение выше этого относительного допуска — отказ
 * (сходимость доказана решателем, а не доверена аналитике).
 */
export const CO2_DIC_TARGET_RELATIVE_TOLERANCE = 1e-9;

/** Ввход поиска целевого DIC. */
export interface CO2TargetDICSearchInput {
  /** Целевая [CO2*] из равновесия Генри, mol/kg-SW. */
  readonly targetCO2StarMolPerKgSw: number;
  readonly targetCO2StarProvenance: DataProvenance;
  /** Карбонатная щёлочность TA_C = [HCO3-] + 2[CO3^2-], mol/kg-SW. */
  readonly carbonateAlkalinityMolPerKgSw: number;
  readonly carbonateAlkalinityProvenance: DataProvenance;
  readonly temperatureK: number;
  readonly temperatureProvenance: DataProvenance;
  readonly salinityPSU: number;
  readonly salinityProvenance: DataProvenance;
  readonly pressurePa: number;
  readonly pressureProvenance: DataProvenance;
  readonly phScale: CarbonatePhScale;
  readonly activityModel: CarbonateActivityModel;
  /** Фоновый заряд сильных ионов (как в Stage 4.9c; опционален). */
  readonly backgroundStrongIonChargeMolPerKgSw?: number;
  readonly backgroundChargeProvenance?: DataProvenance;
}

/** Результат поиска целевого DIC. */
export type CO2TargetDICSearchResult =
  | {
      readonly status: 'applied';
      /** Целевой DIC, mol/kg-SW (подтверждён решателем Stage 4.9c). */
      readonly dicMolPerKgSw: number;
      readonly hydrogenMolPerKgSw: number;
      /** Согласованное распределение (решатель Stage 4.9c). */
      readonly solve: CarbonateModelResult;
      readonly targetCO2StarMolPerKgSw: number;
      /** Достигнутая решателем [CO2*]. */
      readonly achievedCO2StarMolPerKgSw: number;
      /** |достигнута − цель| / цель. */
      readonly relativeResidual: number;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: 'invalid_input' | 'out_of_applicability' | 'no_solution';
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Найти DIC, при котором решатель Stage 4.9c (по заданной TF_C) даёт
 * co2Star тождественно равный Henry-цели.
 *
 * МАТЕМАТИКА ПОИСКА (без второго решателя карбонатной системы): при
 * фиксированных K1, K2 и TA_C связь co2Star([H+]) = TA_C·[H+]^2 /
 * (K1·[H+] + 2·K1·K2) монотонна по [H+], и уравнение относительно
 * [H+] квадратично; корень вычисляется явно, затем результат
 * ПРОВЕРЯЕТСЯ существующим solveCarbonateEquilibrium (Stage 4.9c) при
 * найденном DIC: расхождение выше относительного допуска —
 * контролируемый отказ, а не молчаливое принятие аналитики.
 */
export function solveDICForTargetCO2Star(input: CO2TargetDICSearchInput): CO2TargetDICSearchResult {
  const issues: string[] = [];
  if (!finitePositive(input.targetCO2StarMolPerKgSw)) issues.push('targetCO2StarMolPerKgSw должен быть конечным положительным числом (mol/kg-SW)');
  if (!finitePositive(input.carbonateAlkalinityMolPerKgSw)) issues.push('carbonateAlkalinityMolPerKgSw должен быть конечным положительным числом (mol/kg-SW)');
  if (!provenanceIdentified(input.targetCO2StarProvenance)) issues.push('targetCO2StarProvenance обязателен');
  if (!provenanceIdentified(input.carbonateAlkalinityProvenance)) issues.push('carbonateAlkalinityProvenance обязателен');
  if (!provenanceIdentified(input.temperatureProvenance)) issues.push('temperatureProvenance обязателен');
  if (!provenanceIdentified(input.salinityProvenance)) issues.push('salinityProvenance обязателен');
  if (!provenanceIdentified(input.pressureProvenance)) issues.push('pressureProvenance обязателен');
  if (issues.length > 0) {
    return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'вход поиска целевого DIC не проходит валидацию формы/provenance', issues };
  }
  const constResult = solveCarbonateEquilibrium({
    temperatureK: input.temperatureK,
    temperatureProvenance: input.temperatureProvenance,
    salinityPSU: input.salinityPSU,
    salinityProvenance: input.salinityProvenance,
    pressurePa: input.pressurePa,
    pressureProvenance: input.pressureProvenance,
    // Пробный DIC произволен для этапа констант: solve вернёт not_applied,
    // если константы недоступны (out_of_applicability); ниже системный
    // поиск выполняется только при 'known' K1/K2.
    dicMolPerKgSw: Math.max(input.carbonateAlkalinityMolPerKgSw, input.targetCO2StarMolPerKgSw) || 1e-12,
    dicProvenance: input.targetCO2StarProvenance,
    carbonateAlkalinityMolPerKgSw: input.carbonateAlkalinityMolPerKgSw,
    carbonateAlkalinityProvenance: input.carbonateAlkalinityProvenance,
    phScale: input.phScale,
    activityModel: input.activityModel,
    backgroundStrongIonChargeMolPerKgSw: input.backgroundStrongIonChargeMolPerKgSw,
    backgroundChargeProvenance: input.backgroundChargeProvenance
  });
  if (constResult.status === 'not_applied') {
    return {
      status: 'not_applied',
      reasonKind: constResult.reasonKind === 'unsupported_ph_scale' || constResult.reasonKind === 'unsupported_activity_model' ? constResult.reasonKind : constResult.reasonKind === 'out_of_applicability' ? 'out_of_applicability' : 'invalid_input',
      reason: 'условия решения Stage 4.9c недоступны: ' + constResult.reason,
      issues: [...constResult.issues]
    };
  }
  const k1 = constResult.K1.value as number;
  const k2 = constResult.K2.value as number;
  const taC = input.carbonateAlkalinityMolPerKgSw;
  const c = input.targetCO2StarMolPerKgSw;
  // TA_C·H² = K1·c·H + 2·K1·K2·c (монотонная задача: корень единственный,
  // дискриминант строго положителен при c > 0, TA_C > 0).
  const disc = k1 * k1 * c * c + 8 * taC * k1 * k2 * c;
  const sqrtDisc = Math.sqrt(disc);
  if (!Number.isFinite(disc) || !(disc > 0) || sqrtDisc <= 0) {
    return {
      status: 'not_applied',
      reasonKind: 'no_solution',
      reason: 'квадратичная задача по [H+] непредставима (переполнение: конечные входы не гарантируют конечности дискриминанта)',
      issues: ['disc = ' + String(disc)]
    };
  }
  const hydrogen = (k1 * c + sqrtDisc) / (2 * taC);
  if (!Number.isFinite(hydrogen) || hydrogen <= 0) {
    return { status: 'not_applied', reasonKind: 'no_solution', reason: 'корень по [H+] непредставим', issues: ['[H+] = ' + String(hydrogen)] };
  }
  if (hydrogen > 1 || hydrogen < 1e-16) {
    return {
      status: 'not_applied',
      reasonKind: 'out_of_applicability',
      reason: 'требуемая кислотность вне решателя Stage 4.9c ([H+] обязан лежать в [1e-16, 1]): равновесие на границе карбонатного конверта не решается молчаливо',
      issues: ['[H+] = ' + String(hydrogen)]
    };
  }
  const den = hydrogen * hydrogen + k1 * hydrogen + k1 * k2;
  const dic = (taC * den) / (k1 * hydrogen + 2 * k1 * k2);
  if (!Number.isFinite(dic) || dic <= 0) {
    return { status: 'not_applied', reasonKind: 'no_solution', reason: 'целевой DIC непредставим', issues: ['DIC = ' + String(dic)] };
  }
  // Проверка цели СУЩЕСТВУЮЩИМ решателем Stage 4.9c при найденном DIC.
  const verify = solveCarbonateEquilibrium({
    temperatureK: input.temperatureK,
    temperatureProvenance: input.temperatureProvenance,
    salinityPSU: input.salinityPSU,
    salinityProvenance: input.salinityProvenance,
    pressurePa: input.pressurePa,
    pressureProvenance: input.pressureProvenance,
    dicMolPerKgSw: dic,
    dicProvenance: input.targetCO2StarProvenance,
    carbonateAlkalinityMolPerKgSw: taC,
    carbonateAlkalinityProvenance: input.carbonateAlkalinityProvenance,
    phScale: input.phScale,
    activityModel: input.activityModel,
    backgroundStrongIonChargeMolPerKgSw: input.backgroundStrongIonChargeMolPerKgSw,
    backgroundChargeProvenance: input.backgroundChargeProvenance
  });
  if (verify.status === 'not_applied') {
    return {
      status: 'not_applied',
      reasonKind: verify.reasonKind === 'out_of_applicability' ? 'out_of_applicability' : 'no_solution',
      reason: 'решатель Stage 4.9c отклонил найденный DIC: ' + verify.reason,
      issues: [...verify.issues]
    };
  }
  const achieved = verify.speciesMolPerKgSw.co2_aq;
  const relativeResidual = Math.abs(achieved - c) / c;
  if (!Number.isFinite(relativeResidual) || relativeResidual > CO2_DIC_TARGET_RELATIVE_TOLERANCE) {
    return {
      status: 'not_applied',
      reasonKind: 'no_solution',
      reason: 'сходимость поиска целевого DIC не доказана: |co2Star(решателя) − цель| / цель выше допуска',
      issues: ['достигнуто ' + String(achieved) + ', цель ' + String(c) + ', невязка ' + String(relativeResidual)]
    };
  }
  return {
    status: 'applied',
    dicMolPerKgSw: dic,
    hydrogenMolPerKgSw: verify.hydrogenMolPerKgSw,
    solve: verify,
    targetCO2StarMolPerKgSw: c,
    achievedCO2StarMolPerKgSw: achieved,
    relativeResidual,
    warnings: [
      'целевой DIC получен ПОИСКОМ поверх решателя Stage 4.9c (второй карбонатный решатель не создаётся)',
      ...verify.warnings
    ]
  };
}

// ============================================
// 6. ЗАКРЫТОЕ РАВНОВЕСИЕ АТМОСФЕРА-ОКЕАН
// ============================================

/**
 * Число с provenance (та же конвенция, что у Stage 4.9c).
 */
export interface CO2ProvenancedNumber {
  readonly value: number;
  readonly provenance: DataProvenance;
}

/** Газовое состояние атмосферного столба (идеальное приближение ЯВНО). */
export interface CO2AtmosphereGasState {
  /**
   * Температура газа столба, K. Идеальное приближение газовой фазы
   * (p_CO2 = n_CO2·R·T_gas на 1 м²) — ЯВНОЕ допущение результата.
   */
  readonly gasTemperatureK: number;
  readonly gasTemperatureProvenance: DataProvenance;
  /**
   * Коэффициент фугативности (f = phi·p). Отсутствие — явное
   * идеальное допущение phi = 1.
   */
  readonly fugacityCoefficient?: number;
  readonly fugacityCoefficientProvenance?: DataProvenance;
}

/** Условия карбонатного равновесия океана (решатель Stage 4.9c). */
export interface CO2OceanChemistryConditions {
  readonly temperatureK: number;
  readonly temperatureProvenance: DataProvenance;
  readonly salinityPSU: number;
  readonly salinityProvenance: DataProvenance;
  readonly pressurePa: number;
  readonly pressureProvenance: DataProvenance;
  readonly phScale: CarbonatePhScale;
  readonly activityModel: CarbonateActivityModel;
  readonly backgroundStrongIonChargeMolPerKgSw?: number;
  readonly backgroundChargeProvenance?: DataProvenance;
}

/** Ввход замкнутого равновесия атмосфера-океан. */
export interface CO2AtmosphereOceanEquilibriumInput {
  /** Текущий столбовой запас газового co2 атмосферы, mol/m2. */
  readonly atmosphereCO2ColumnMolPerM2: CO2ProvenancedNumber;
  /** Текущий столбовой запас растворённого DIC океана, mol/m2. */
  readonly oceanDICColumnMolPerM2: CO2ProvenancedNumber;
  /** Газовое состояние атмосферы. */
  readonly atmosphere: CO2AtmosphereGasState;
  /** Явная масса водного столба (kg-SW/m2, provenance обязателен). */
  readonly seawaterColumnMassKgPerM2: SeawaterColumnMass;
  /** Карбонатная щёлочность океана, mol/kg-SW. */
  readonly carbonateAlkalinityMolPerKgSw: CO2ProvenancedNumber;
  /** Условия карбонатного равновесия океана. */
  readonly oceanChemistry: CO2OceanChemistryConditions;
  /** Допуск сохранения общего углерода, mol/m2 (по умолчанию 1e-9). */
  readonly carbonConservationToleranceMolPerM2?: number;
}

/** Успешное равновесие (plain-JSON). */
export type CO2AtmosphereOceanEquilibriumResult =
  | {
      readonly status: 'applied';
      /** Равновесная фугитивность, atm. */
      readonly fCO2Atm: number;
      /** Равновесное p_CO2 (идеальная газовая фаза), atm. */
      readonly pCO2Atm: number;
      readonly fugacityUnit: typeof CO2_FUGACITY_UNIT;
      /** Рядовая идеальная газовая фаза? (не = точная модель EOS) */
      readonly idealGasAssumption: boolean;
      readonly idealFugacityAssumption: boolean;
      /** Равновесный столбовой запас co2 атмосферы, mol/m2. */
      readonly atmosphereCO2ColumnAfterMolPerM2: number;
      /** Равновесный DIC океана, mol/kg-SW. */
      readonly oceanDICMolPerKgSw: number;
      /** Равновесная [CO2*] океана, mol/kg-SW. */
      readonly oceanCO2StarMolPerKgSw: number;
      /** Согласованное карбонатное решение (Stage 4.9c). */
      readonly solve: CarbonateModelResult;
      readonly K0MolPerKgSwPerAtm: number;
      readonly solubilityUnit: typeof CO2_SOLUBILITY_UNIT;
      /** Общий сохраняемый углерод системы, mol/m2. */
      readonly totalCarbonColumnMolPerM2: number;
      /** |углерод(f) − общий углерод|, mol/m2 (в допуске). */
      readonly carbonConservationResidualMolPerM2: number;
      readonly carbonConservationToleranceMolPerM2: number;
      /** Перенос C атмосфера -> океан при переходе к равновесию, mol/m2. */
      readonly carbonTransferAtmToOceanMolPerM2: number;
      /** Равновесие — цель, НЕ скорость. */
      readonly equilibriumKind: 'thermodynamic_target_not_kinetics';
      readonly provenance: CarbonateConstantProvenance;
      readonly warnings: readonly string[];
    }
  | {
      /** Недостаток входов: глобальное равновесие честно не решается. */
      readonly status: 'not_verifiable';
      readonly missingInputs: readonly string[];
      readonly reason: string;
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: 'invalid_input' | 'out_of_applicability' | 'no_solution';
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Замкнутое двухрезервуарное равновесие атмосфера-океан при заданных
 * и достаточных входах. Решается система:
 * - Henry: [CO2*] = K0·f_CO2;
 * - карбонатное равновесие Stage 4.9c по TA_C;
 * - сохранение общего углерода (атмосфера + растворённый DIC);
 * - согласованность газовой и водной фаз (идеальное газовое
 *   приближение p_CO2 = n_CO2·R·T_gas на 1 м2 — ЯВНО).
 *
 * МАССА СТОЛБА, температура газа, TA и условия — ТОЛЬКО явные
 * величины с идентифицированным provenance. Отсутствие любого
 * необходимого входа — not_verifiable со списком недостающего:
 * синтетические значения в производственное состояние НЕ подставляются.
 * Равновесие задаёт термодинамическую цель; скорость достижения
 * (кинетика газообмена) здесь НЕ вычисляется.
 */
export function evaluateAtmosphereOceanEquilibrium(
  input: CO2AtmosphereOceanEquilibriumInput
): CO2AtmosphereOceanEquilibriumResult {
  // 0. Опора структуры, затем нехватка входов -> not_verifiable
  // (это честный частичный режим: нечто отсутствует — не 000000000).
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'вход равновесия должен быть объектом-записью (plain record)', issues: [] };
  }
  const missing: string[] = [];
  if (typeof input.atmosphereCO2ColumnMolPerM2 !== 'object' || input.atmosphereCO2ColumnMolPerM2 === null) missing.push('atmosphereCO2ColumnMolPerM2');
  if (typeof input.oceanDICColumnMolPerM2 !== 'object' || input.oceanDICColumnMolPerM2 === null) missing.push('oceanDICColumnMolPerM2');
  if (typeof input.atmosphere !== 'object' || input.atmosphere === null) missing.push('atmosphere (газовое состояние: температура столба газа)');
  if (input.seawaterColumnMassKgPerM2 === undefined) missing.push('seawaterColumnMassKgPerM2 (явная масса водного столба)');
  if (typeof input.carbonateAlkalinityMolPerKgSw !== 'object' || input.carbonateAlkalinityMolPerKgSw === null) missing.push('carbonateAlkalinityMolPerKgSw');
  if (typeof input.oceanChemistry !== 'object' || input.oceanChemistry === null) missing.push('oceanChemistry (условия карбонатного равновесия океана)');
  if (missing.length > 0) {
    return {
      status: 'not_verifiable',
      missingInputs: missing,
      reason: 'входов для замкнутого равновесия не хватает: глобальное закрытое решение НЕ вычисляется, синтетические значения НЕ подставляются (допустим частичный расчёт через calculateCO2AqueousEquilibrium для заданной фугитивности)'
    };
  }
  if (!provenanceIdentified(input.seawaterColumnMassKgPerM2.provenance)) {
    return {
      status: 'not_verifiable',
      missingInputs: ['seawaterColumnMassKgPerM2.provenance (источник массы столба)'],
      reason: 'масса водного столба без идентифицированного происхождения: глобальное равновесие не решается'
    };
  }
  if (input.atmosphere.gasTemperatureK === undefined || !provenanceIdentified(input.atmosphere.gasTemperatureProvenance)) {
    return {
      status: 'not_verifiable',
      missingInputs: ['atmosphere.gasTemperatureK + gasTemperatureProvenance (температура газового столба)'],
      reason: 'температура газа не дана: p_CO2 из столбового количества вычислен быть не может, глобальное равновесие не решается'
    };
  }
  // 1. Численность и форма.
  const issues: string[] = [];
  const atm = input.atmosphereCO2ColumnMolPerM2;
  const dic = input.oceanDICColumnMolPerM2;
  if (!finiteNonNegative(atm.value)) issues.push('atmosphereCO2ColumnMolPerM2.value должен быть конечным неотрицательным числом (mol/m2)');
  if (!provenanceIdentified(atm.provenance)) issues.push('atmosphereCO2ColumnMolPerM2.provenance обязателен');
  if (!finitePositive(dic.value)) issues.push('oceanDICColumnMolPerM2.value должен быть конечным положительным числом (mol/m2)');
  if (!provenanceIdentified(dic.provenance)) issues.push('oceanDICColumnMolPerM2.provenance обязателен');
  const gasT = input.atmosphere.gasTemperatureK;
  if (!finitePositive(gasT)) issues.push('atmosphere.gasTemperatureK должен быть конечным положительным числом (K)');
  const mass = input.seawaterColumnMassKgPerM2;
  if (mass.unit !== SEAWATER_COLUMN_MASS_UNIT) {
    issues.push('seawaterColumnMassKgPerM2.unit должен быть «kg-SW/m2» (kg-SW/m²), получено «' + String(mass.unit) + '»');
  }
  if (!finitePositive(mass.valueKgPerM2)) issues.push('seawaterColumnMassKgPerM2.valueKgPerM2 должен быть конечным положительным числом');
  const ta = input.carbonateAlkalinityMolPerKgSw;
  if (!finitePositive(ta.value)) issues.push('carbonateAlkalinityMolPerKgSw.value должен быть конечным положительным числом (mol/kg-SW)');
  if (!provenanceIdentified(ta.provenance)) issues.push('carbonateAlkalinityMolPerKgSw.provenance обязателен');
  const oc = input.oceanChemistry;
  if (!finitePositive(oc.temperatureK)) issues.push('oceanChemistry.temperatureK должен быть конечным положительным числом (K)');
  if (!finiteNonNegative(oc.salinityPSU)) issues.push('oceanChemistry.salinityPSU должен быть конечным неотрицательным числом');
  if (!finiteNonNegative(oc.pressurePa)) issues.push('oceanChemistry.pressurePa должен быть конечным неотрицательным числом (Pa)');
  if (oc.phScale !== 'seawater' && oc.phScale !== 'total') issues.push('oceanChemistry.phScale должен быть «seawater» или «total»');
  if (oc.activityModel !== 'ideal_dilute') issues.push('oceanChemistry.activityModel должен быть «ideal_dilute»');
  if (!provenanceIdentified(oc.temperatureProvenance)) issues.push('oceanChemistry.temperatureProvenance обязателен');
  if (!provenanceIdentified(oc.salinityProvenance)) issues.push('oceanChemistry.salinityProvenance обязателен');
  if (!provenanceIdentified(oc.pressureProvenance)) issues.push('oceanChemistry.pressureProvenance обязателен');
  if (issues.length > 0) {
    return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'вход равновесия не проходит валидацию формы/provenance', issues };
  }
  let fugacityCoefficient = 1;
  let idealFugacity = true;
  if (input.atmosphere.fugacityCoefficient !== undefined) {
    if (!finitePositive(input.atmosphere.fugacityCoefficient)) {
      return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'atmosphere.fugacityCoefficient, если задан, должен быть конечным положительным числом', issues: [] };
    }
    if (!provenanceIdentified(input.atmosphere.fugacityCoefficientProvenance)) {
      return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'fugacityCoefficientProvenance обязателен при заданном phi', issues: [] };
    }
    fugacityCoefficient = input.atmosphere.fugacityCoefficient;
    idealFugacity = false;
  }
  // 2. Общий углерод системы (сохраняемая величина).
  const totalCarbon = atm.value + dic.value;
  if (!Number.isFinite(totalCarbon) || totalCarbon <= 0) {
    return { status: 'not_applied', reasonKind: 'no_solution', reason: 'общий углерод системы непредставим (переполнение или неположительный)', issues: ['C_total = ' + String(totalCarbon)] };
  }
  // 3. Функция замыкания по фугитивности.
  //    p_CO2(n) = n·R·T_gas (Pa, идеальный столб на 1 м2, ЯВНО);
  //    f = phi·p; [CO2*] = K0·f; DIC(f) по TA_C через решатель 4.9c;
  //    C(f) = DIC(f)·M + n_atm(f), n_atm(f) = (f/phi)·101325/(R·T_gas).
  const co2ToAtm = (n: number): number => (n * CO2_GAS_CONSTANT_J_PER_MOL_K * gasT) / CARBONATE_STANDARD_ATMOSPHERE_PA;
  const atmToCo2 = (f: number): number => ((f / fugacityCoefficient) * CARBONATE_STANDARD_ATMOSPHERE_PA) / (CO2_GAS_CONSTANT_J_PER_MOL_K * gasT);
  const closure = (f: number): { carbon: number; d: CO2TargetDICSearchResult } => {
    const target = co2SolubilityK0Weiss1974(oc.temperatureK, oc.salinityPSU) * f;
    const d = solveDICForTargetCO2Star({
      targetCO2StarMolPerKgSw: target,
      targetCO2StarProvenance: CO2_SOLUBILITY_PROVENANCE,
      carbonateAlkalinityMolPerKgSw: ta.value,
      carbonateAlkalinityProvenance: ta.provenance,
      temperatureK: oc.temperatureK,
      temperatureProvenance: oc.temperatureProvenance,
      salinityPSU: oc.salinityPSU,
      salinityProvenance: oc.salinityProvenance,
      pressurePa: oc.pressurePa,
      pressureProvenance: oc.pressureProvenance,
      phScale: oc.phScale,
      activityModel: oc.activityModel,
      backgroundStrongIonChargeMolPerKgSw: oc.backgroundStrongIonChargeMolPerKgSw,
      backgroundChargeProvenance: oc.backgroundChargeProvenance
    });
    if (d.status !== 'applied') return { carbon: NaN, d };
    return { carbon: d.dicMolPerKgSw * mass.valueKgPerM2 + atmToCo2(f), d };
  };
  // 4. Вилка по фугативности: g(f) = C(f) − C_total монотонно растёт.
  const tolerance = input.carbonConservationToleranceMolPerM2 !== undefined ? input.carbonConservationToleranceMolPerM2 : 1e-9;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return { status: 'not_applied', reasonKind: 'invalid_input', reason: 'carbonConservationToleranceMolPerM2, если задан, должен быть конечным положительным числом', issues: [] };
  }
  const fLo = 1e-12;
  const fHiMax = CO2_FUGACITY_MAX_ATM;
  const closureLo = closure(fLo);
  if (Number.isFinite(closureLo.carbon) && closureLo.carbon > totalCarbon + tolerance) {
    return {
      status: 'not_applied',
      reasonKind: 'no_solution',
      reason: 'даже при f_CO2 около нуля океанное равновесие требует больше углерода, чем есть в системе: равновесие ниже границы поиска, решения нет',
      issues: ['C(f = ' + String(fLo) + ' atm) = ' + String(closureLo.carbon) + ' mol/m2 > C_total = ' + String(totalCarbon) + ' mol/m2']
    };
  }
  let fHi = 1e-3;
  let closureHi = closure(fHi);
  while ((Number.isNaN(closureHi.carbon) || closureHi.carbon < totalCarbon - tolerance) && fHi < fHiMax) {
    fHi = fHi * 2;
    if (fHi > fHiMax) {
      fHi = fHiMax;
      closureHi = closure(fHi);
      break;
    }
    closureHi = closure(fHi);
  }
  if (!Number.isFinite(closureHi.carbon) || closureHi.carbon < totalCarbon - tolerance) {
    return {
      status: 'not_applied',
      reasonKind: closureHi.carbon > totalCarbon ? 'no_solution' : 'out_of_applicability',
      reason:
        closureHi.carbon > totalCarbon
          ? 'равновесие между границей поиска и недоступной точкой'
          : 'равновесная фугитивность выше конверта модуля (' + String(CO2_FUGACITY_MAX_ATM) + ' atm): параметризация Weiss получена около 1 атм, экстраполяция запрещена',
      issues: closureHi.d.status === 'applied' ? ['g(f = ' + String(fHi) + ' atm) = ' + String(closureHi.carbon - totalCarbon)] : [...closureHi.d.issues]
    };
  }
  let lo = fLo;
  let hi = fHi;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    const closureMid = closure(mid);
    if (!Number.isFinite(closureMid.carbon)) {
      return { status: 'not_applied', reasonKind: 'no_solution', reason: 'внутри бисекции пересчёт равновесия потерял представимость', issues: closureMid.d.status === 'applied' ? [] : [...closureMid.d.issues] };
    }
    if (closureMid.carbon < totalCarbon) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const fEq = Math.sqrt(lo * hi);
  const final = closure(fEq);
  const dFinal: CO2TargetDICSearchResult = final.d;
  if (dFinal.status !== 'applied' || !Number.isFinite(final.carbon)) {
    return {
      status: 'not_applied',
      reasonKind: dFinal.status === 'not_applied' ? dFinal.reasonKind : 'no_solution',
      reason: 'финальное равновесие не сошлось: ' + (dFinal.status === 'not_applied' ? dFinal.reason : 'невязка непредставима'),
      issues: dFinal.status === 'not_applied' ? [...dFinal.issues] : []
    };
  }
  const residual = Math.abs(final.carbon - totalCarbon);
  if (!Number.isFinite(residual) || residual > tolerance) {
    return {
      status: 'not_applied',
      reasonKind: 'no_solution',
      reason: 'сохранение общего углерода не сошлось в допуске: равновесие НЕ применялось и НЕ выдаётся как сошедшееся',
      issues: ['невязка ' + String(residual) + ' mol/m2 > допуск ' + String(tolerance) + ' mol/m2']
    };
  }
  const atmAfter = atmToCo2(fEq);
  const pCO2Atm = co2ToAtm(atmAfter);
  if (!Number.isFinite(pCO2Atm) || pCO2Atm <= 0 || pCO2Atm > CO2_FUGACITY_MAX_ATM) {
    return {
      status: 'not_applied',
      reasonKind: pCO2Atm > CO2_FUGACITY_MAX_ATM ? 'out_of_applicability' : 'no_solution',
      reason: 'равновесное p_CO2 вне конверта модуля или непредставимо',
      issues: ['p_CO2 = ' + String(pCO2Atm) + ' atm']
    };
  }
  return {
    status: 'applied',
    fCO2Atm: fugacityCoefficient * pCO2Atm,
    pCO2Atm,
    fugacityUnit: CO2_FUGACITY_UNIT,
    idealGasAssumption: true,
    idealFugacityAssumption: idealFugacity,
    atmosphereCO2ColumnAfterMolPerM2: atmAfter,
    oceanDICMolPerKgSw: dFinal.dicMolPerKgSw,
    oceanCO2StarMolPerKgSw: dFinal.solve.speciesMolPerKgSw.co2_aq,
    solve: dFinal.solve,
    K0MolPerKgSwPerAtm: co2SolubilityK0Weiss1974(oc.temperatureK, oc.salinityPSU),
    solubilityUnit: CO2_SOLUBILITY_UNIT,
    totalCarbonColumnMolPerM2: totalCarbon,
    carbonConservationResidualMolPerM2: residual,
    carbonConservationToleranceMolPerM2: tolerance,
    carbonTransferAtmToOceanMolPerM2: atm.value - atmAfter,
    equilibriumKind: 'thermodynamic_target_not_kinetics',
    provenance: CO2_SOLUBILITY_PROVENANCE,
    warnings: [
      'газовая фаза — ЯВНОЕ идеальное приближение (p_CO2 = n_CO2·R·T_gas на 1 м2, R CODATA 2018); неидеальный EOS/фугитивный коэффициент — отдельная модель' +
        (idealFugacity ? '; phi не задан: также применено идеальное допущение phi = 1' : ''),
      'равновесие задаёт термодинамическую цель, но НЕ скорость: никакой коэффициент переноса/VLP/блока времени здесь НЕ участвует (кинетика газообмена — следующий этап)',
      'щёлочность МОДЕЛИРУЕТСЯ карбонатной (TA_C): борат/фосфат/силикат не входят (Stage 4.9c)'
    ]
  };
}
