// ============================================
// UNITS - Единая система единиц и физические константы
// ============================================
//
// Все внутренние расчёты физической модели используют SI:
// кг, метры, кельвины, паскали, ватты, джоули, моли, секунды.
// Пользовательский интерфейс может отображать привычные единицы
// (а.е., массы Земли, atm, бар, миллионы лет), но только через
// функции конвертации этого модуля.
//
// Константы — стандартные справочные значения с указанием источника.
// Игровые допущения единицами не маскируются.

import type { PhysValue } from '../../types';

// ============================================
// ФИЗИЧЕСКИЕ КОНСТАНТЫ (SI)
// ============================================

/** Гравитационная постоянная G, м³/(кг·с²) */
export const G = 6.67430e-11;
/** Постоянная Стефана — Больцмана σ, Вт/(м²·К⁴) */
export const STEFAN_BOLTZMANN = 5.670374419e-8;
/** Стандартная атмосфера, Па (точное определение) */
export const ATM_TO_PA = 101325;
/** Бар, Па (точное определение) */
export const BAR_TO_PA = 1e5;
/** Масса Земли, кг (номинальное справочное значение) */
export const M_EARTH_KG = 5.9722e24;
/** Радиус Земли, м (номинальное справочное значение) */
export const R_EARTH_M = 6.371e6;
/** Ускорение свободного падения на Земле, м/с² (стандартное) */
export const G_EARTH_MS2 = 9.80665;
/** Масса Солнца, кг (стандартное справочное значение) */
export const M_SUN_KG = 1.989e30;
/** Светимость Солнца, Вт (номинальное значение IAU) */
export const L_SUN_W = 3.828e26;
/** Масса Юпитера, кг (стандартное справочное значение) */
export const M_JUP_KG = 1.898e27;
/** Астрономическая единица, м (номинальное значение IAU 2012) */
export const AU_M = 1.495978707e11;
/** Юлианский год, с (365.25 дней) */
export const YEAR_S = 3.15576e7;

/** Источники констант — только реальные справочники, без вымышленных ссылок. */
export const UNIT_CONSTANTS_METADATA: Record<string, PhysValue> = {
  G: {
    value: G,
    unit: 'м³/(кг·с²)',
    confidence: 'established',
    method: 'справочное значение CODATA 2018',
    source: 'CODATA 2018 (гравитационная постоянная)',
    uncertainty: 'относительная стандартная неопределённость ~2.2e-5; для оценок планетарной физики пренебрежима'
  },
  STEFAN_BOLTZMANN: {
    value: STEFAN_BOLTZMANN,
    unit: 'Вт/(м²·К⁴)',
    confidence: 'established',
    method: 'справочное значение CODATA 2018',
    source: 'CODATA 2018 (постоянная Стефана — Больцмана)'
  },
  ATM_TO_PA: {
    value: ATM_TO_PA,
    unit: 'Па',
    confidence: 'established',
    method: 'точное определение стандартной атмосферы',
    source: 'определение единицы «стандартная атмосфера» (точно 101325 Па)'
  },
  M_EARTH_KG: {
    value: M_EARTH_KG,
    unit: 'кг',
    confidence: 'established',
    method: 'номинальное значение',
    source: 'номинальные параметры Земли (IAU 2015) и стандартные справочные данные'
  },
  R_EARTH_M: {
    value: R_EARTH_M,
    unit: 'м',
    confidence: 'established',
    method: 'номинальное значение (средний радиус)',
    source: 'номинальные параметры Земли (IAU 2015)'
  },
  L_SUN_W: {
    value: L_SUN_W,
    unit: 'Вт',
    confidence: 'established',
    method: 'номинальное значение IAU',
    source: 'номинальная светимость Солнца (резолюция IAU 2015)'
  },
  AU_M: {
    value: AU_M,
    unit: 'м',
    confidence: 'established',
    method: 'определение астрономической единицы',
    source: 'IAU 2012 (фиксированное определение а.е.)'
  }
};

// ============================================
// ФУНКЦИИ КОНВЕРТАЦИИ
// ============================================

/** atm → Па */
export function atmToPa(atm: number): number {
  return atm * ATM_TO_PA;
}

/** Па → atm */
export function paToAtm(pa: number): number {
  return pa / ATM_TO_PA;
}

/** бар → Па */
export function barToPa(bar: number): number {
  return bar * BAR_TO_PA;
}

/** Па → бар */
export function paToBar(pa: number): number {
  return pa / BAR_TO_PA;
}

/** массы Земли → кг */
export function earthMassesToKg(masses: number): number {
  return masses * M_EARTH_KG;
}

/** кг → массы Земли */
export function kgToEarthMasses(kg: number): number {
  return kg / M_EARTH_KG;
}

/** радиусы Земли → м */
export function earthRadiiToM(radii: number): number {
  return radii * R_EARTH_M;
}

/** м → радиусы Земли */
export function mToEarthRadii(m: number): number {
  return m / R_EARTH_M;
}

/** массы Солнца → кг */
export function solarMassesToKg(masses: number): number {
  return masses * M_SUN_KG;
}

/** массы Юпитера → кг */
export function jupiterMassesToKg(masses: number): number {
  return masses * M_JUP_KG;
}

/** а.е. → м */
export function auToM(au: number): number {
  return au * AU_M;
}

/** м → а.е. */
export function mToAu(m: number): number {
  return m / AU_M;
}

/** годы → секунды */
export function yearsToSeconds(years: number): number {
  return years * YEAR_S;
}

/** секунды → годы */
export function secondsToYears(seconds: number): number {
  return seconds / YEAR_S;
}

/** м/с² → земные g */
export function ms2ToG(ms2: number): number {
  return ms2 / G_EARTH_MS2;
}

/**
 * Форматирование давления для отображения: Па (внутренняя единица)
 * в Pa/бар/atm по величине. Внутренние расчёты конвертацию не используют.
 */
export function formatPressure(pa: number): string {
  if (Math.abs(pa) >= 1e4) {
    return `${(paToBar(pa)).toFixed(2)} бар`;
  }
  if (Math.abs(pa) >= 1e2) {
    return `${pa.toFixed(0)} Па`;
  }
  return `${(paToAtm(pa)).toPrecision(3)} atm`;
}

export default {
  G,
  STEFAN_BOLTZMANN,
  ATM_TO_PA,
  BAR_TO_PA,
  M_EARTH_KG,
  R_EARTH_M,
  G_EARTH_MS2,
  M_SUN_KG,
  L_SUN_W,
  M_JUP_KG,
  AU_M,
  YEAR_S,
  atmToPa,
  paToAtm,
  barToPa,
  paToBar,
  earthMassesToKg,
  kgToEarthMasses,
  earthRadiiToM,
  mToEarthRadii,
  solarMassesToKg,
  jupiterMassesToKg,
  auToM,
  mToAu,
  yearsToSeconds,
  secondsToYears,
  ms2ToG,
  formatPressure
};
