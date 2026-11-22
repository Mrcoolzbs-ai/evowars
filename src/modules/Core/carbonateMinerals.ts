// ============================================
// CARBONATE MINERALS — растворимость кальцита и арагонита в морской воде
// (Mucci 1983), степень насыщения — Stage 4.9f
// ============================================
//
// ЧТО ЭТО:
// - стохиометрические КАЖУЩИЕСЯ продукты растворимости кальцита и
//   арагонита в морской воде K*sp (стехиометрические, apparent) по
//   параметризации Mucci (1983);
// - чистая термодинамика насыщения: ионное произведение
//   IP = [Ca2+]·[CO3^2-], Ω = IP / K*sp и ВЕРДИКТ направления,
//   термодинамически благоприятного при данном W.
//
// ЧТО ЭТО НЕ ЭТО:
// - это НЕ термодинамические K°sp в бесконечном разведении:
//   термодинамическая константа вычисляется ТОЛЬКО как промежуточный
//   шаг внутри параметризации Mucci и как самостоятельный результат
//   насыщения НЕ возвращается (насыщение оценивается строго через
//   стохиометрическую K*sp);
// - это НЕ кинетика: Ω > 1 не означает мгновенного осаждения, Ω < 1
//   не означает мгновенного растворения; нуклеация, рост кристаллов и
//   скорости растворения — вне Stage 4.9f (кинетика — Stage 4.9g);
// - это НЕ неидеальная термодинамика морской воды: K*sp — эмпирическая
//   параметризация «на общую ионную силу морской воды» в рамках
//   измерений первоисточника; НЕ смешивается с произвольными
//   коэффициентами активности и с Pitzer (не реализован);
// - поправки на давление НЕ реализуются: параметризация Mucci получена
//   при общем давлении 1 atm; применения при другом давлении —
//   fail-closed out_of_applicability (значит, и никакой
//   «универсальной для глубоководного давления» формулы здесь нет).
//
// Происхождение формулы: Mucci, A. (1983). The solubility of calcite and
// aragonite in seawater at various salinities, temperatures, and one
// atmosphere total pressure. American Journal of Science, 283(7), 780-799.
// DOI 10.2475/ajs.283.7.780. Аппроксимационный комбинационный статус
// карбонатного ядра Stage 4.9c (ideal_dilute) с эмпирической K*sp — ЯВНО
// отмеченное приближение (см. MUCCI_IDEAL_DILUTE_COMBINATION_NOTE).

import type { DataProvenance } from './scientificValue';
import type { CarbonateConstantProvenance, CarbonatePhScale, CarbonateActivityModel } from './carbonateChemistry';

// ============================================
// 1. КОНСТАНТЫ, ЕДИНИЦЫ, PROVENANCE
// ============================================

/** Полиморф карбоната кальция (разные виды каталога: caco3 / aragonite). */
export type CarbonateMineralPolymorph = 'calcite' | 'aragonite';

/** Идентификатор вида каталога, соответствующего полиморфу. */
export const CARBONATE_MINERAL_SPECIES_ID: Readonly<Record<CarbonateMineralPolymorph, 'caco3' | 'aragonite'>> = {
  calcite: 'caco3',
  aragonite: 'aragonite'
};

/** Обратное соответствие: вид каталога → полиморф (для смешения полиморфов). */
export const CARBONATE_MINERAL_SPECIES_TO_POLYMORPH: Readonly<Record<'caco3' | 'aragonite', CarbonateMineralPolymorph>> = {
  caco3: 'calcite',
  aragonite: 'aragonite'
};

/** Единицы стохиометрического произведения растворимости в морской воде. */
export const CARBONATE_MINERAL_KSP_UNIT = 'mol^2/kg-SW^2' as const;

/** Единица давления параметризации Mucci (общее давление измерений). */
export const CARBONATE_MINERAL_PRESSURE_UNIT = 'atm' as const;

/** Допуск «давление = 1 atm измерений» (точно 1; допуск — численная гигиена). */
export const CARBONATE_MINERAL_PRESSURE_TOLERANCE_ATM = 1e-12;

/**
 * Термодинамические коэффициенты термодинамической формулы Mucci (1983,
 * уравнения для термодинамического произведения растворимости):
 *
 *   log10 K°sp,cal   = -171.9065 - 0.077993·T + 2839.319/T + 71.595·log10 T
 *   log10 K°sp,arag  = -171.945  - 0.077993·T + 2903.293/T + 71.595·log10 T
 */
export const MUCCI_1983_THERMODYNAMIC_COEFFICIENTS: Readonly<
  Record<CarbonateMineralPolymorph, { readonly a1: number; readonly a2: number; readonly a3: number; readonly a4: number }>
> = {
  calcite: { a1: -171.9065, a2: -0.077993, a3: 2839.319, a4: 71.595 },
  aragonite: { a1: -171.945, a2: -0.077993, a3: 2903.293, a4: 71.595 }
} as const;

/**
 * Солевые коэффициенты перехода к стохиометрическому продукту
 * растворимости в морской воде:
 *
 *   log10 K*sp = log10 K°sp + (b0 + b1·T + b2/T)·sqrt(S) + c0·S + d0·S^1.5
 */
export const MUCCI_1983_SALINITY_COEFFICIENTS: Readonly<
  Record<CarbonateMineralPolymorph, { readonly b0: number; readonly b1: number; readonly b2: number; readonly c0: number; readonly d0: number }>
> = {
  calcite: { b0: -0.77712, b1: 0.0028426, b2: 178.34, c0: -0.07711, d0: 0.0041249 },
  aragonite: { b0: -0.068393, b1: 0.0017276, b2: 88.135, c0: -0.10018, d0: 0.0059415 }
} as const;

/**
 * Область применимости параметризации Mucci (1983): измерения выполнены
 * при температуре 5-40 C, практической солёности 5-44 и ОЩЕМ давлении
 * 1 atm. Вне этого конверта — fail-closed out_of_applicability.
 */
export const MUCCI_1983_APPLICABILITY = {
  temperatureMinK: 278.15,
  temperatureMaxK: 313.15,
  salinityMinPSU: 5,
  salinityMaxPSU: 44,
  pressureAtm: 1,
  note:
    'измерения Mucci (1983) выполнены при T = 5-40 C, S = 5-44 (практическая солёность) и общем давлении 1 atm; вне конверта — fail-closed; давление не вход параметризации: любое давление, кроме 1 atm, — out_of_applicability'
} as const;

/** Допуск присвоения вердикта «насыщение» для Ω: |W - 1| <= tolerance. */
export const CARBONATE_MINERAL_OMEGA_SATURATION_TOLERANCE = 1e-6;

/**
 * Происхождение K*sp: стохиометрическая кажущаяся константа в морской воде
 * (НЕ термодинамическая K°sp; NOT коэффициенты активности NOT Pitzer).
 */
export const MUCCI_1983_KSP_PROVENANCE: CarbonateConstantProvenance = {
  sourceName:
    'Mucci, A. (1983): The solubility of calcite and aragonite in seawater at various salinities, temperatures, and one atmosphere total pressure',
  sourceId: 'doi:10.2475/ajs.283.7.780',
  reference:
    'American Journal of Science, 283(7), 780-799; перекрёстная проверка точек: приблизительно K*sp,calcite(25 C, 35) ~ 4.3e-07 и K*sp,aragonite(25 C, 35) ~ 6.65e-07 mol^2/kg^2 (таблицы первоисточника и его воспроизведения)',
  retrievedAt: '2026-11-23',
  method:
    'коэффициенты закодированы дословно из первоисточника: термодинамическая часть формулы (log10 K°sp) плюс непрерывные солевые поправки; вычисление — чистая функция T и S',
  conditions:
    'K*sp в mol^2/kg-SW^2; T в K; S — практическая солёность; измерения источника выполнены при T = 5-40 C, S = 5-44, общем давлении 1 atm',
  applicability:
    'морская вода (в т.ч. разведённая) в конверте измерений источника; стохиометрическая константа искренна именно в среде морской воды исходной параметризации',
  limitations:
    'стохиометрическая K*sp НЕ термодинамическая K° sp: она «впитывает» свойства конкретной среды морской воды в рамках первоисточника; НЕ подмешиваются какие-либо коэффициенты активности; Pitzer не реализован; поправки на давление не реализуются; модуль не описывает кинетику',
  formula:
    'log10 K°sp,cal = -171.9065 - 0.077993·T + 2839.319/T + 71.595·log10(T); log10 K°sp,arag = -171.945 - 0.077993·T + 2903.293/T + 71.595·log10(T); log10 K*sp = log10 K°sp + (b0 + b1·T + b2/T)·sqrt(S) + c0·S + d0·S^1.5'
};

/**
 * Происхождение концентраций кальция и карбоната по умолчанию НЕ задаётся:
 * концентрации обязаны нести provenance КАЖДАЯ собственная (fail-closed).
 */

/**
 * ЯВНО отмеченная комбинация приближений: карбонатная специация Stage 4.9c
 * (ideal_dilute) + эмпирическая стохиометрическая K*sp Mucci. Комбинация
 * НЕ является полноценной неидеальной термодинамикой морской воды.
 */
export const MUCCI_IDEAL_DILUTE_COMBINATION_NOTE =
  'Stage 4.9c использует activityModel «ideal_dilute» (коэффициенты активности не рассчитываются), при этом K*sp Mucci 1983 — эмпирическая стохиометрическая константа морской воды; их комбинация — заведомое (явно отмеченное) приближение, а не полноценная неидеальная термодинамика морской воды (Pitzer не реализован); замена комбинации на неидеальную модель морской воды не заявляется';

// ============================================
// 2. ВЫЧИСЛИТЕЛЬНОЕ ЯДРО (чистые функции, без входных проверок)
// ============================================

/**
 * Термодинамическая часть формулы: log10 K°sp как функция температуры.
 * Чистая функция; защита от нефинитных входов — валидатором формы
 * вызывающей стороны (fail-closed).
 */
function log10ThermodynamicKsp(polymorph: CarbonateMineralPolymorph, temperatureK: number): number {
  const c = MUCCI_1983_THERMODYNAMIC_COEFFICIENTS[polymorph];
  return c.a1 + c.a2 * temperatureK + c.a3 / temperatureK + c.a4 * Math.log10(temperatureK);
}

/**
 * Солевая поправка: log10 K*sp = log10 K°sp + поправка(S, T).
 * Чистая функция.
 */
function salinityCorrectionLog10(polymorph: CarbonateMineralPolymorph, temperatureK: number, salinityPSU: number): number {
  const s = MUCCI_1983_SALINITY_COEFFICIENTS[polymorph];
  const sqrtS = Math.sqrt(salinityPSU);
  return (s.b0 + s.b1 * temperatureK + s.b2 / temperatureK) * sqrtS + s.c0 * salinityPSU + s.d0 * salinityPSU * sqrtS;
}

// ============================================
// 3. ОПРЕДЕЛЕНИЕ K*SP (fail-closed, с provenance)
// ============================================

/** Вход определения K*sp. */
export interface CarbonateMineralSolubilityInput {
  /** Полиморф: «calcite» (вид caco3) или «aragonite» (вид aragonite). */
  readonly mineral: CarbonateMineralPolymorph;
  /** Температура, K. */
  readonly temperatureK: number;
  readonly temperatureProvenance: DataProvenance;
  /** Практическая солёность. */
  readonly salinityPSU: number;
  readonly salinityProvenance: DataProvenance;
  /**
   * Общее давление, atm. Обязательство FAIL-CLOSED: параметризация Mucci
   * получена при 1 atm; если поле задано и отлично от 1 (точнее допуска) —
   * out_of_applicability (значение по умолчанию 1 — условие измерений).
   */
  readonly pressureAtm?: number;
}

export type CarbonateMineralSolubilityResult =
  | {
      readonly status: 'applied';
      readonly mineral: CarbonateMineralPolymorph;
      /** Соответствующий вид каталога (caco3 или aragonite). */
      readonly speciesId: 'caco3' | 'aragonite';
      /** Стохиометрическая K*sp (apparent, морская вода), mol^2/kg-SW^2. */
      readonly KspStoichiometricMol2PerKgSw2: number;
      readonly unit: typeof CARBONATE_MINERAL_KSP_UNIT;
      /** Промежуточный термодинамический член (диагностика, НЕ результат насыщения). */
      readonly log10KspThermodynamic: number;
      readonly log10KspStoichiometric: number;
      /** Солевая поправка (диагностика). */
      readonly salinityCorrectionLog10: number;
      readonly temperatureK: number;
      readonly salinityPSU: number;
      readonly pressureAtm: number;
      readonly provenance: CarbonateConstantProvenance;
      readonly applicability: typeof MUCCI_1983_APPLICABILITY;
      /** Комбинация приближений (ideal_dilute + эмпирическая K*sp) — ЯВНО. */
      readonly activityCombinationNote: string;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: 'invalid_input' | 'out_of_applicability';
      readonly reason: string;
      readonly issues: readonly string[];
    };

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

/**
 * Вычислить стохиометрическую K*sp (Mucci 1983) с проверкой формы,
 * provenance и конверта применимости. Fail-closed: вне T/S/P-конверта
 * или при непроверяемом происхождении — отказ, а не число.
 */
export function evaluateCarbonateMineralSolubility(input: CarbonateMineralSolubilityInput): CarbonateMineralSolubilityResult {
  const notApplied = (reasonKind: 'invalid_input' | 'out_of_applicability', reason: string, issues: readonly string[]): CarbonateMineralSolubilityResult => ({
    status: 'not_applied',
    reasonKind,
    reason,
    issues
  });
  if (
    input.mineral !== 'calcite' &&
    input.mineral !== 'aragonite'
  ) {
    return notApplied('invalid_input', 'mineral должен быть «calcite» или «aragonite» (разные виды каталога: caco3 / aragonite)', [
      'полиморф не распознан: смешение полиморфов или неизвестный вид'
    ]);
  }
  const issues: string[] = [];
  if (!finitePositive(input.temperatureK)) {
    issues.push('temperatureK должен быть конечным положительным числом (K), получено ' + String(input?.temperatureK));
  }
  if (
    typeof input.salinityPSU !== 'number' ||
    !Number.isFinite(input.salinityPSU) ||
    input.salinityPSU < 0
  ) {
    issues.push('salinityPSU должен быть конечным неотрицательным числом (практическая солёность), получено ' + String(input?.salinityPSU));
  }
  if (!provenanceIdentified(input.temperatureProvenance)) {
    issues.push('temperatureProvenance обязателен и должен идентифицировать источник');
  }
  if (!provenanceIdentified(input.salinityProvenance)) {
    issues.push('salinityProvenance обязателен и должен идентифицировать источник');
  }
  if (issues.length > 0) {
    return notApplied('invalid_input', 'вход определения K*sp не проходит валидацию формы', issues);
  }

  const warnings: string[] = [];
  const pressureAtm = input.pressureAtm !== undefined ? input.pressureAtm : 1;
  if (typeof pressureAtm !== 'number' || !Number.isFinite(pressureAtm)) {
    return notApplied('invalid_input', 'pressureAtm, если задан, должен быть конечным числом (atm)', ['получено ' + String(pressureAtm)]);
  }
  if (Math.abs(pressureAtm - 1) > CARBONATE_MINERAL_PRESSURE_TOLERANCE_ATM) {
    return notApplied(
      'out_of_applicability',
      'параметризация Mucci (1983) получена при общем давлении 1 atm: давление-зависимая поправка вне области применимости (и НЕ добавляется без отдельного проверенного источника)',
      ['запрошено давление ' + String(pressureAtm) + ' atm; допустимо только 1 atm (в пределах допуска ' + String(CARBONATE_MINERAL_PRESSURE_TOLERANCE_ATM) + ' atm)']
    );
  }

  if (input.temperatureK < MUCCI_1983_APPLICABILITY.temperatureMinK || input.temperatureK > MUCCI_1983_APPLICABILITY.temperatureMaxK) {
    return notApplied(
      'out_of_applicability',
      'температура вне конверта измерений Mucci (1983): T = 5-40 C (278.15-313.15 K)',
      ['запрошено ' + String(input.temperatureK) + ' K']
    );
  }
  if (input.salinityPSU < MUCCI_1983_APPLICABILITY.salinityMinPSU || input.salinityPSU > MUCCI_1983_APPLICABILITY.salinityMaxPSU) {
    return notApplied(
      'out_of_applicability',
      'солёность вне конверта измерений Mucci (1983): S = 5-44 (практическая солёность)',
      ['запрошено S = ' + String(input.salinityPSU)]
    );
  }

  const log10KspThermodynamic = log10ThermodynamicKsp(input.mineral, input.temperatureK);
  const salinityCorrection = salinityCorrectionLog10(input.mineral, input.temperatureK, input.salinityPSU);
  const log10Ksp = log10KspThermodynamic + salinityCorrection;
  const Ksp = Math.pow(10, log10Ksp);
  return {
    status: 'applied',
    mineral: input.mineral,
    speciesId: CARBONATE_MINERAL_SPECIES_ID[input.mineral],
    KspStoichiometricMol2PerKgSw2: Ksp,
    unit: CARBONATE_MINERAL_KSP_UNIT,
    log10KspThermodynamic,
    log10KspStoichiometric: log10Ksp,
    salinityCorrectionLog10: salinityCorrection,
    temperatureK: input.temperatureK,
    salinityPSU: input.salinityPSU,
    pressureAtm,
    provenance: MUCCI_1983_KSP_PROVENANCE,
    applicability: MUCCI_1983_APPLICABILITY,
    activityCombinationNote: MUCCI_IDEAL_DILUTE_COMBINATION_NOTE,
    warnings
  };
}

/** Обёртка совместимости: K*sp кальцита. */
export function evaluateCalciteSolubilityProduct(input: Omit<CarbonateMineralSolubilityInput, 'mineral'>): CarbonateMineralSolubilityResult {
  return evaluateCarbonateMineralSolubility({ ...input, mineral: 'calcite' });
}

/** Обёртка совместимости: K*sp арагонита. */
export function evaluateAragoniteSolubilityProduct(input: Omit<CarbonateMineralSolubilityInput, 'mineral'>): CarbonateMineralSolubilityResult {
  return evaluateCarbonateMineralSolubility({ ...input, mineral: 'aragonite' });
}

// ============================================
// 4. СТЕПЕНЬ НАСЫЩЕНИЯ И ВЕРДИКТ
// ============================================

/** Вход оценки насыщения минералов. */
export interface CarbonateMineralSaturationInput {
  /** Полиморф (вид каталога: caco3 / aragonite). */
  readonly mineral: CarbonateMineralPolymorph;
  readonly temperatureK: number;
  readonly temperatureProvenance: DataProvenance;
  readonly salinityPSU: number;
  readonly salinityProvenance: DataProvenance;
  /** Общее давление, atm (только 1 — конверт параметризации; см. Солюбилити). */
  readonly pressureAtm?: number;
  /** Концентрация Ca2+, mol/kg-SW; ЕДИНАЯ основа с карбонатом. */
  readonly calciumConcentrationMolPerKgSw: number;
  readonly calciumProvenance: DataProvenance;
  /** Концентрация CO3^2-, mol/kg-SW; ЕДИНАЯ основа с кальцием. */
  readonly carbonateConcentrationMolPerKgSw: number;
  readonly carbonateProvenance: DataProvenance;
  /**
   * Шкала pH / модель активности окружения концентраций. Шкалы не входят
   * в формулу этого модуля (требуются только согласованные концентрации),
   * но передаются ДИАГНОСТИЧЕСКИ: статусы, несовместимые со Stage 4.9c
   * (activityModel не «ideal_dilute»), отклоняются fail-closed.
   */
  readonly phScale?: CarbonatePhScale;
  readonly activityModel?: CarbonateActivityModel;
}

/** Вердикт насыщения (термодинамическое направление, НЕ скорость). */
export type CarbonateMineralSaturationVerdict = 'undersaturated' | 'saturated' | 'oversaturated';

export type CarbonateMineralSaturationResult =
  | {
      readonly status: 'applied';
      readonly mineral: CarbonateMineralPolymorph;
      readonly speciesId: 'caco3' | 'aragonite';
      /** Ионное произведение [Ca2+]·[CO3^2-], mol^2/kg-SW^2. */
      readonly ionProductMol2PerKgSw2: number;
      /** Стохиометрическая K*sp (Mucci 1983), mol^2/kg-SW^2. */
      readonly KspStoichiometricMol2PerKgSw2: number;
      /** Степень насыщения Ω = IP / K*sp. */
      readonly saturationStateOmega: number;
      readonly verdict: CarbonateMineralSaturationVerdict;
      /** Допуск вердикта «насыщение». */
      readonly omegaSaturationTolerance: number;
      readonly unit: typeof CARBONATE_MINERAL_KSP_UNIT;
      readonly temperatureK: number;
      readonly salinityPSU: number;
      readonly pressureAtm: number;
      readonly concentrationBasis: 'mol/kg-SW';
      readonly provenance: CarbonateConstantProvenance;
      readonly calciumProvenance: DataProvenance;
      readonly carbonateProvenance: DataProvenance;
      readonly phScale: CarbonatePhScale | null;
      readonly activityModel: CarbonateActivityModel | null;
      /** Комбинация приближений — ЯВНО (ideal_dilute + эмпирическая K*sp). */
      readonly activityCombinationNote: string;
      /** Диагностические ограничения. */
      readonly diagnostics: readonly string[];
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: 'invalid_input' | 'out_of_applicability';
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Оценить насыщение минерала относительно морской воды. Вердикт —
 * термодинамическое НАПРАВЛЕНИЕ (растворение благоприятно при W < 1,
 * осаждение при W > 1); кинетические выводы из вердикта НЕ следуют
 * (нуклеация/рост — вне этапа).
 */
export function evaluateCarbonateMineralSaturation(input: CarbonateMineralSaturationInput): CarbonateMineralSaturationResult {
  const notApplied = (reasonKind: 'invalid_input' | 'out_of_applicability', reason: string, issues: readonly string[]): CarbonateMineralSaturationResult => ({
    status: 'not_applied',
    reasonKind,
    reason,
    issues
  });
  if (
    input.mineral !== 'calcite' &&
    input.mineral !== 'aragonite'
  ) {
    return notApplied('invalid_input', 'mineral должен быть «calcite» или «aragonite» (разные виды каталога: caco3 / aragonite)', [
      'полиморф не распознан: смешение полиморфов или неизвестный вид'
    ]);
  }
  const issues: string[] = [];
  const calcium = input.calciumConcentrationMolPerKgSw;
  const carbonate = input.carbonateConcentrationMolPerKgSw;
  if (typeof calcium !== 'number' || !Number.isFinite(calcium) || calcium <= 0) {
    issues.push('calciumConcentrationMolPerKgSw должен быть конечным положительным числом (mol/kg-SW), получено ' + String(calcium));
  }
  if (typeof carbonate !== 'number' || !Number.isFinite(carbonate) || carbonate <= 0) {
    issues.push('carbonateConcentrationMolPerKgSw должен быть конечным положительным числом (mol/kg-SW), получено ' + String(carbonate));
  }
  if (!provenanceIdentified(input.calciumProvenance)) {
    issues.push('calciumProvenance обязателен и должен идентифицировать источник концентрации Ca2+');
  }
  if (!provenanceIdentified(input.carbonateProvenance)) {
    issues.push('carbonateProvenance обязателен и должен идентифицировать источник концентрации CO3^2-');
  }
  if (!provenanceIdentified(input.temperatureProvenance)) {
    issues.push('temperatureProvenance обязателен и должен идентифицировать источник температуры');
  }
  if (!provenanceIdentified(input.salinityProvenance)) {
    issues.push('salinityProvenance обязателен и должен идентифицировать источник солёности');
  }
  if (input.phScale !== undefined && input.phScale !== 'seawater' && input.phScale !== 'total') {
    issues.push("phScale, если задан, должен быть «seawater» или «total» (Stage 4.9c), получено «" + String(input.phScale) + "»");
  }
  if (input.activityModel !== undefined && input.activityModel !== 'ideal_dilute') {
    issues.push(
      "activityModel, если задан, должен быть «ideal_dilute» (единственная модель Stage 4.9c; сочетание с Pitzer/этот модуль не реализовано и не утверждается), получено «" +
        String(input.activityModel) +
        "»"
    );
  }
  if (issues.length > 0) {
    return notApplied('invalid_input', 'вход оценки насыщения не проходит валидацию формы', issues);
  }

  const kspResult = evaluateCarbonateMineralSolubility({
    mineral: input.mineral,
    temperatureK: input.temperatureK,
    temperatureProvenance: input.temperatureProvenance,
    salinityPSU: input.salinityPSU,
    salinityProvenance: input.salinityProvenance,
    pressureAtm: input.pressureAtm
  });
  if (kspResult.status === 'not_applied') {
    return notApplied(kspResult.reasonKind, 'K*sp не определён: ' + kspResult.reason, [...kspResult.issues]);
  }

  const ionProduct = calcium * carbonate;
  const omega = ionProduct / kspResult.KspStoichiometricMol2PerKgSw2;
  const tolerance = CARBONATE_MINERAL_OMEGA_SATURATION_TOLERANCE;
  const verdict: CarbonateMineralSaturationVerdict =
    Math.abs(omega - 1) <= tolerance ? 'saturated' : omega < 1 ? 'undersaturated' : 'oversaturated';

  const diagnostics: string[] = [
    'вердикт — термодинамическое направление («недо»/«пере»насыщение); кинетические следствия НЕ вытекают: нуклеация, рост кристаллов, скорости растворения/осаждения вне Stage 4.9f',
    'концентрации Ca2+ и CO3^2- обязаны быть на ЕДИНОЙ основе (mol/kg-SW) и согласованного происхождения; любой принятый вход обязан нести provenance',
    'параметризация применима при 1 atm: давление-зависимый перенос K*sp на глубину НЕ реализован'
  ];

  return {
    status: 'applied',
    mineral: input.mineral,
    speciesId: CARBONATE_MINERAL_SPECIES_ID[input.mineral],
    ionProductMol2PerKgSw2: ionProduct,
    KspStoichiometricMol2PerKgSw2: kspResult.KspStoichiometricMol2PerKgSw2,
    saturationStateOmega: omega,
    verdict,
    omegaSaturationTolerance: tolerance,
    unit: CARBONATE_MINERAL_KSP_UNIT,
    temperatureK: input.temperatureK,
    salinityPSU: input.salinityPSU,
    pressureAtm: kspResult.pressureAtm,
    concentrationBasis: 'mol/kg-SW',
    provenance: kspResult.provenance,
    calciumProvenance: input.calciumProvenance,
    carbonateProvenance: input.carbonateProvenance,
    phScale: input.phScale !== undefined ? input.phScale : null,
    activityModel: input.activityModel !== undefined ? input.activityModel : null,
    activityCombinationNote: MUCCI_IDEAL_DILUTE_COMBINATION_NOTE,
    diagnostics,
    warnings: []
  };
}

