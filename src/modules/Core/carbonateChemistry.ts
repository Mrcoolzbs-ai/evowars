// ============================================
// CARBONATE CHEMISTRY - карбонатная система океана и равновесное
// распределение неорганического углерода (Stage 4.9c)
// ============================================
//
// РАВНОВЕСНОЕ ЯДРО водной карбонатной системы: распределение
// растворённого неорганического углерода (DIC) между CO2(aq),
// HCO3- и CO3^2- при заданных температуре, солёности и давлении.
//
// ЧТО ЭТО И ЧТО ЭТО НЕ ЭТО:
// - это химическое РАВНОВЕСИЕ (термодинамически подтверждённые
//   константы диссоциации K1/K2/Kw с provenance первоисточников);
// - это НЕ кинетика: ни скорость растворения CO2, ни скорость
//   диссоциации, ни время установления равновесия здесь не
//   вычисляются и не утверждаются (граничный запрет Stage 4.5.4-
//   4.5.5 сохраняется);
// - это НЕ модель всего океана и НЕ климатическая модель: равновесное
//   распределение CO2 в воде — не доказательство скорости
//   растворения, не доказательство полного океанического цикла и
//   не климатическая модель (см. docs/science/PHYSICS_ARCHITECTURE.md
//   §Stage 4.9c);
// - произвольный extent (степень протекания) НЕ используется:
//   сначала решается равновесие (заданное DIC/TA или pH), затем —
//   при необходимости — вычисляется результирующий перенос вещества
//   как РАЗНОСТЬ равновесных распределений (см.
//   planCarbonateSpeciationTransfer). Никаких трёх независимых
//   транзакций без общей проверки сохранения DIC.
//
// ФИЗИЧЕСКИЕ ИСТОЧНИКИ (проверка перед кодированием констант:
// коэффициенты сверены с публикациями через независимую реализацию
// параметризаций CO2SYS — PyCO2SYS, Humphreys et al., GMD 2022;
// файл PyCO2SYS/equilibria/p1atm.py и pcx.py — только как
// перекрёстная проверка чисел, код не копируется):
// - Dickson, A. G., Millero, F. J. (1987), «A comparison of the
//   equilibrium constants for the dissociation of carbonic acid in
//   seawater media», Deep-Sea Research 34(10):1733-1743 (Corrigenda
//   36:983, 1989) — аппроксимация данных Mehrbach et al. (1973),
//   шкала SWS (seawater), mol/kg-SW; применимость по данным:
//   T = 2..35 °C, S = 20..40 (заявлено самим источником);
// - Lueker, T. J., Dickson, A. G., Keeling, C. D. (2000), «Ocean
//   pCO2 calculated from dissolved inorganic carbon, alkalinity,
//   and equations for K1 and K2...», Marine Chemistry 70:105-119 —
//   шкала total, mol/kg-SW; данные эквилибратора, S ~ 24..40;
// - Millero, F. J. (1995), «Thermodynamics of the carbon dioxide
//   system in the oceans», Geochimica et Cosmochimica Acta
//   59:661-677 — константа автопротолиза воды Kw (шкала SWS,
//   mol/kg-SW) и барометрические поправки K1/K2/Kw (ΔV, κ;
//   данные Culberson & Pytkowicz 1968);
// - Dickson, A. G., Sabine, C. L., Christian, J. R. (eds.) (2007),
//   «Guide to Best Practices for Ocean CO2 Measurements»,
//   PICES Special Publication 3 / CDIAC-74 — методология шкал pH
//   и соглашения (используется как методологическая ссылка,
//   числовые константы — из первоисточников выше).
//
// ШКАЛЫ pH НЕ СМЕШИВАЮТСЯ:
// - 'seawater' (SWS): K1/K2 определены на seawater-шкале
//   (Dickson & Millero 1987 refit Mehrbach), Kw — Millero 1995;
// - 'total': K1/K2 Lueker et al. (2000); Kw на total-шкале в этом
//   модуле НЕ параметризована (преобразование шкал требует KSO4/KF
//   и суммарного сульфата/фторида — честное отсутствие, не подмена
//   значением другой шкалы);
// - свободная ('free') и NBS шкалы не поддерживаются: явный отказ
//   вместо молчаливой подмены (поддержка — отдельный этап).
//
// ЕДИНИЦЫ: все концентрации — mol/kg-SW (стандарт морской воды,
// как у первоисточников). Физический перевод mol/kg-SW в столбовые
// mol/m² (и наоборот) здесь НЕ выполняется: он требует плотности
// воды и толщины слоя, которые знает только вызывающая сторона.
// Реестр единиц ядра (Core/physicalQuantity.ts) расширяется
// аддитивно в отдельном изменении; сам модуль работает с числами
// в явно задокументированной единице mol/kg-SW и НЕ подставляет
// их в PhysicalQuantity другого размера.
//
// МОДЕЛЬ АКТИВНОСТИ: реализован ТОЛЬКО режим 'ideal_dilute'
// (активность ≡ концентрация/1 mol/kg-SW) и КОНЦЕНТРАЦИОННЫЕ
// (стехиометрические) константы — режим явно маркируется как
// приближение. Питцер-полная модель (Pitzer 1991) НЕ реализована:
// матрица взаимодействий не верифицирована в этом этапе; параметры
// без верифицированной матрицы не кодируются (явный отказ
// unsupported_activity_model, никакого «идеального раствора,
// изображающего морскую воду»).
//
// Интеграция со Stage 4.9b: диссоциации карбонатной системы заданы
// ЯВНЫМИ GeochemicalReactionDefinition (см.
// CARBONATE_DISSOCIATION_REACTION_DEFINITIONS) — определения
// проходят штатную validateGeochemicalReactionDefinition и
// стехиометрический аудит существующего ReactionLedger; физическое
// применение к инвентарям НЕ выполняется (см.
// planCarbonateSpeciationTransfer: атомарное применение
// multi-species результата через общий исполнитель — следующий
// этап), исходные объекты сохраняются при любой ошибке.

import type { DataProvenance } from './scientificValue';
import { GEOCHEMICAL_REACTION_EXTENT_BASIS } from './geochemicalReactionContext';
import { validateGeochemicalReactionDefinition } from './geochemicalReactionExecution';
import type { GeochemicalReactionDefinition } from './geochemicalReactionExecution';
import type { ReactionParticipant } from './reactionLedger';

// ============================================
// 1. ТИПЫ И КОНСТАНТЫ АПЛИКАЦИИ
// ============================================

/**
 * Шкала pH. 'seawater' — SWS-шкала; 'total' — total-шкала
 * (по Dickson et al. 2007 терминология). Свободная и NBS шкалы
 * НЕ поддерживаются (явный отказ, тест: неподдерживаемая шкала).
 */
export type CarbonatePhScale = 'seawater' | 'total';

/** Поддерживаемые модели активности. */
export type CarbonateActivityModel = 'ideal_dilute';

export const CARBONATE_ACTIVITY_MODELS: readonly CarbonateActivityModel[] = ['ideal_dilute'];
export const CARBONATE_PH_SCALES: readonly CarbonatePhScale[] = ['seawater', 'total'];

/** Концентрационная единица карбонатного ядра: mol/kg-SW (морская вода). */
export const CARBONATE_CONCENTRATION_UNIT = 'mol/kg-SW' as const;

/**
 * Конверт применимости МОДУЛЯ (консервативная политика): K1/K2
 * Dickson & Millero 1987 заявлены для T = 2..35 °C, S = 20..40;
 * тот же конверт консервативно применяется к Kw (Millero 1995) и к
 * параметризации Lueker et al. 2000 на total-шкале. КОНВЕНТ —
 * политика модуля по Заявленным диапазонам первоисточников, а не
 * новые физические границы.
 */
export const CARBONATE_MODULE_APPLICABILITY = {
  temperatureKMinInclusive: 273.15 + 2,
  temperatureKMaxInclusive: 273.15 + 35,
  salinityMinInclusive: 20,
  salinityMaxInclusive: 40
} as const;

/** Верх применимости барометрических поправок (океанские давления). */
export const CARBONATE_PRESSURE_MAX_BAR = 1000;
/** Стандартная атмосфера — ноль шкалы барометрических поправок. */
export const CARBONATE_STANDARD_ATMOSPHERE_PA = 101325;

/**
 * Газовая постоянная в cm³·bar/(mol·K) — точное преобразование
 * CODATA 2018 R = 8.314462618 J/(mol·K) (1 J = 10 cm³·bar) в
 * барометрические поправки (конвенция CO2SYS/PyCO2SYS).
 */
export const CARBONATE_GAS_CONSTANT_CM3_BAR_PER_MOL_K = 83.14462618;

/** Ошибка карбонатного ядра (структурированная, fail-closed). */
export class CarbonateChemistryError extends Error {
  readonly code:
    | 'invalid_input'
    | 'unsupported_ph_scale'
    | 'unsupported_activity_model'
    | 'out_of_applicability'
    | 'no_solution';
  readonly component = 'CarbonateChemistry';

  constructor(code: CarbonateChemistryError['code'], message: string) {
    super(`[CarbonateChemistry/${code}] ${message}`);
    this.name = 'CarbonateChemistryError';
    this.code = code;
  }
}

/** Вход с provenance (число + идентифицированный источник). */
export interface CarbonateProvenancedNumber {
  readonly value: number;
  /** Идентифицированный источник значения (DataProvenance ядра). */
  readonly provenance: DataProvenance;
}

/** Происхождение константы (единичные описания первоисточников). */
export interface CarbonateConstantProvenance extends DataProvenance {
  /** Формула параметризации — сохраняется дословно из источника. */
  readonly formula?: string;
}

/** Вход карбонатного расчёта. */
export interface CarbonateModelInput {
  /** Температура, K. */
  readonly temperatureK: number;
  readonly temperatureProvenance?: DataProvenance;
  /** Практическая солёность, PSU (безразмерная величина). */
  readonly salinityPSU: number;
  readonly salinityProvenance?: DataProvenance;
  /** Полное давление, Pa (атмосфера + гидростатика). */
  readonly pressurePa: number;
  readonly pressureProvenance?: DataProvenance;
  /** Общее растворённое неорганическое количество углерода (DIC), mol/kg-SW. */
  readonly dicMolPerKgSw: number;
  readonly dicProvenance?: DataProvenance;
  /** Карбонатная щёлочность TA_C = [HCO3-] + 2[CO3^2-], mol/kg-SW. */
  readonly carbonateAlkalinityMolPerKgSw?: number;
  readonly carbonateAlkalinityProvenance?: DataProvenance;
  /**
   * ПОЛНАЯ щёлочность, mol/kg-SW. МОДЕЛИРУЕТСЯ ТОЛЬКО КАК ОГРАНИЧЕНИЕ:
   * борат/фосфат/силикат и прочие компоненты не рассматриваются —
   * решение по полной TA НЕ выполняется (out_of_applicability);
   * поле принимается только для честной диагностики несогласованности.
   */
  readonly totalAlkalinityMolPerKgSw?: number;
  readonly totalAlkalinityProvenance?: DataProvenance;
  /** Явно заданный pH (вместо TA). */
  readonly ph?: number;
  readonly phProvenance?: DataProvenance;
  readonly phScale: CarbonatePhScale;
  readonly activityModel: CarbonateActivityModel;
  /**
   * Фоновый заряд сильных ионов (Na+, Cl-, SO4^2-, ...),
   * mol/kg-SW; положительный = избыток катионов. Элект-нейтральности
   * полного решения без этого поля НЕ УТВЕРЖДАЕТСЯ (unknown) —
   * карбонатные анионы в реальной морской воде балансируются
   * немоделируемыми здесь сильными ионами.
   */
  readonly backgroundStrongIonChargeMolPerKgSw?: number;
  readonly backgroundChargeProvenance?: DataProvenance;
}

// ============================================
// 2. ВАЛИДАЦИЯ ВХОДА
// ============================================

/** Источник идентифицирован? (та же конвенция, что у Stage 4.9b). */
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

function labelOf(field: string): string {
  const labels: Record<string, string> = {
    temperatureK: 'температура',
    salinityPSU: 'солёность',
    pressurePa: 'давление',
    dicMolPerKgSw: 'DIC',
    carbonateAlkalinityMolPerKgSw: 'карбонатная щёлочность',
    totalAlkalinityMolPerKgSw: 'полная щёлочность',
    ph: 'pH',
    backgroundStrongIonChargeMolPerKgSw: 'фоновый заряд сильных ионов'
  };
  return labels[field] ?? field;
}

/**
 * Runtime-валидация входа (форма + численность + provenance).
 * Возвращает список проблем; пустой = вход корректен. Ничего не
 * достраивается: отсутствие provenance у физической величины —
 * проблема, а не молчаливый «источник по умолчанию».
 */
export function validateCarbonateChemistryInputs(input: unknown): string[] {
  const issues: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['вход карбонатного расчёта должен быть объектом-записью (plain record)'];
  }
  const c = input as Record<string, unknown>;

  if (typeof c.temperatureK !== 'number' || !Number.isFinite(c.temperatureK) || c.temperatureK <= 0) {
    issues.push('temperatureK должен быть конечным положительным числом (K)');
  }
  if (typeof c.salinityPSU !== 'number' || !Number.isFinite(c.salinityPSU) || c.salinityPSU < 0) {
    issues.push('salinityPSU должен быть конечным неотрицательным числом (практическая солёность)');
  }
  if (typeof c.pressurePa !== 'number' || !Number.isFinite(c.pressurePa) || c.pressurePa < 0) {
    issues.push('pressurePa должен быть конечным неотрицательным числом (Pa, атмосфера + гидростатика)');
  }
  if (typeof c.dicMolPerKgSw !== 'number' || !Number.isFinite(c.dicMolPerKgSw) || c.dicMolPerKgSw <= 0) {
    issues.push('dicMolPerKgSw должен быть конечным ПОЛОЖИТЕЛЬНЫМ числом (mol/kg-SW); нулевой и отрицательный DIC карбонатной системы не означают «система» и не проходят');
  }
  if (c.ph !== undefined && (typeof c.ph !== 'number' || !Number.isFinite(c.ph) || c.ph <= 0 || c.ph >= 14)) {
    issues.push('ph, если задан, должен быть конечным числом строго в интервале (0, 14)');
  }
  const alk = c.carbonateAlkalinityMolPerKgSw;
  if (alk !== undefined && (typeof alk !== 'number' || !Number.isFinite(alk) || alk <= 0)) {
    issues.push('carbonateAlkalinityMolPerKgSw, если задан, должен быть конечным положительным числом (mol/kg-SW)');
  }
  if (c.carbonateAlkalinityMolPerKgSw === undefined && c.ph === undefined) {
    issues.push('требуется либо явно заданный ph, либо carbonateAlkalinityMolPerKgSw: система без такого ограничения не имеет единственного решения');
  }
  const totalAlk = c.totalAlkalinityMolPerKgSw;
  if (totalAlk !== undefined && (typeof totalAlk !== 'number' || !Number.isFinite(totalAlk) || totalAlk <= 0)) {
    issues.push('totalAlkalinityMolPerKgSw, если задан, должен быть конечным положительным числом (mol/kg-SW)');
  }
  if (
    c.phScale !== 'seawater' && c.phScale !== 'total'
  ) {
    issues.push(`phScale должен быть «seawater» или «total»; получено «${String(c.phScale)}» — шкалы free/NBS в этом этапе не поддерживаются, отказ вместо подмены`);
  }
  if (c.activityModel !== 'ideal_dilute') {
    issues.push(
      `activityModel должен быть «ideal_dilute»; получено «${String(c.activityModel)}» — другие модели активности не реализованы, идеальный раствор не выдаётся за морскую воду`
    );
  }
  // provenance: обязательны для каждой заданной физической величины.
  const quantityFields = [
    'temperatureK',
    'salinityPSU',
    'pressurePa',
    'dicMolPerKgSw',
    'carbonateAlkalinityMolPerKgSw',
    'totalAlkalinityMolPerKgSw',
    'ph',
    'backgroundStrongIonChargeMolPerKgSw'
  ] as const;
  for (const field of quantityFields) {
    if (c[field] === undefined) continue;
    const prov = c[field.replace(/^dicMolPerKgSw$/, 'dicProvenance')
      .replace(/^carbonateAlkalinityMolPerKgSw$/, 'carbonateAlkalinityProvenance')
      .replace(/^totalAlkalinityMolPerKgSw$/, 'totalAlkalinityProvenance')
      .replace(/^ph$/, 'phProvenance')
      .replace(/^backgroundStrongIonChargeMolPerKgSw$/, 'backgroundChargeProvenance')
      .replace(/^temperatureK$/, 'temperatureProvenance')
      .replace(/^salinityPSU$/, 'salinityProvenance')
      .replace(/^pressurePa$/, 'pressureProvenance')];
    if (!provenanceIdentified(prov)) {
      issues.push(`${labelOf(field)}: provenance обязателен и должен идентифицировать источник (sourceName/sourceId/datasetId/reference) — числовое значение без происхождения не подставляется`);
    }
  }
  return issues;
}

// ============================================
// 3. РАВНОВЕСНЫЕ КОНСТАНТЫ (параметризации первоисточников)
// ============================================

/** Запись одной константы. */
export interface CarbonateEquilibriumConstant {
  readonly name: 'K1' | 'K2' | 'Kw';
  /** Уравнение реакции (текстом, для аудита и отчёта). */
  readonly reaction: string;
  /** Шкала pH, на которой определена ЗНАЧЕНИЕ (не смешивается с другими). */
  readonly phScale: CarbonatePhScale | null;
  readonly concentrationUnit: typeof CARBONATE_CONCENTRATION_UNIT;
  /** Численное значение константы (null = недоступна на этой шкале/условиях). */
  readonly value: number | null;
  /** Статус значения: known — первоисточник/параметризация подтверждены. */
  readonly valueStatus: 'known' | 'not_verifiable' | 'out_of_applicability';
  /** Откуда константа (первоисточник, условия, формула — дословно). */
  readonly provenance: CarbonateConstantProvenance;
  /** Заявленная применимость параметризации (какие границы источника). */
  readonly applicability: string;
  readonly notes: readonly string[];
}

/** Результат расчёта констант. */
export interface CarbonateConstantsResult {
  readonly phScale: CarbonatePhScale;
  readonly temperatureK: number;
  readonly salinityPSU: number;
  /** Избыточное давление относительно стандартной атмосферы, bar. */
  readonly pressureBarOverAtmosphere: number;
  readonly K1: CarbonateEquilibriumConstant;
  readonly K2: CarbonateEquilibriumConstant;
  readonly Kw: CarbonateEquilibriumConstant;
  readonly notes: readonly string[];
}

/** ln(K) генераторы — формулы ДОСЛОВНО из первоисточников (T в K, t в °C). */
function pK1_seawater_DM87_Mehrbach(T: number, S: number): number {
  // Dickson & Millero (1987), Table 4: refit данных Mehrbach et al. (1973);
  // шкала SWS, mol/kg-SW; заявленная применимость T = 2..35 °C, S = 20..40.
  return 3670.7 / T - 62.008 + 9.7944 * Math.log(T) - 0.0118 * S + 0.000116 * S * S;
}
function pK2_seawater_DM87_Mehrbach(T: number, S: number): number {
  // Dickson & Millero (1987), Table 4 (с учётом Corrigenda 1989: 0.000132·S² —
  // это другая параметризация (Hansson); для Mehrbach-рефита — 0.000118·S²).
  return 1394.7 / T + 4.777 - 0.0184 * S + 0.000118 * S * S;
}
function pK1_total_LDK00(T: number, S: number): number {
  // Lueker, Dickson, Keeling (2000), Marine Chemistry 70:105-119;
  // шкала total, mol/kg-SW (рефит данных Mehrbach et al. 1973 после
  // пересчёта шкалы).
  return 3633.86 / T - 61.2172 + 9.6777 * Math.log(T) - 0.011555 * S + 0.0001152 * S * S;
}
function pK2_total_LDK00(T: number, S: number): number {
  // Lueker, Dickson, Keeling (2000), там же.
  return 471.78 / T + 25.929 - 3.16967 * Math.log(T) - 0.01781 * S + 0.0001122 * S * S;
}
function lnKw_seawater_M95(T: number, S: number): number {
  // Millero (1995), GCA 59:661-677, шкала SWS, mol/kg-SW.
  return (
    148.9802 -
    13847.26 / T -
    23.6521 * Math.log(T) +
    (-5.977 + 118.67 / T + 1.0495 * Math.log(T)) * Math.sqrt(S) -
    0.01615 * S
  );
}

/**
 * Барометрическая поправка равновесной константы (Millero 1995,
 * ΔV/Kappa-форма CO2SYS): factor K(P) = exp((−ΔV + κ·P/2)·P / (R·T)),
 * ΔV в cm³/mol, κ в cm³/(mol·bar), P — избыточное давление в bar.
 * Коэффициенты: Culberson & Pytkowicz (1968) через Millero (1995);
 * без солевой зависимости поправки (предполагается S ≈ 35); шкала SWS.
 */
function pressureFactor(deltaV: number, kappa: number, Pbar: number, T: number): number {
  return Math.exp((-deltaV + 0.5 * kappa * Pbar) * Pbar / (CARBONATE_GAS_CONSTANT_CM3_BAR_PER_MOL_K * T));
}

const PRESSURE_K1 = { deltaV: (t: number) => -25.5 + 0.1271 * t, kappa: (t: number) => (-3.08 + 0.0877 * t) / 1000 };
const PRESSURE_K2 = { deltaV: (t: number) => -15.82 - 0.0219 * t, kappa: (t: number) => (1.13 - 0.1475 * t) / 1000 };
const PRESSURE_KW = { deltaV: (t: number) => -20.02 + 0.1119 * t - 0.001409 * t * t, kappa: (t: number) => (-5.13 + 0.0794 * t) / 1000 };

/** Диагностика применимости: вне конверта — out_of_applicability. */
function applicabilityIssues(T: number, S: number): string[] {
  const issues: string[] = [];
  const a = CARBONATE_MODULE_APPLICABILITY;
  if (T < a.temperatureKMinInclusive || T > a.temperatureKMaxInclusive) {
    issues.push(`температура ${String(T)} K вне заявленной применимости параметризаций (${String(a.temperatureKMinInclusive)}..${String(a.temperatureKMaxInclusive)} K, T = 2..35 °C по Dickson & Millero 1987)`);
  }
  if (S < a.salinityMinInclusive || S > a.salinityMaxInclusive) {
    issues.push(`солёность ${String(S)} вне заявленной применимости параметризаций (S = ${String(a.salinityMinInclusive)}..${String(a.salinityMaxInclusive)})`);
  }
  return issues;
}

/**
 * Рассчитать равновесные константы K1/K2/Kw для условий входа.
 * Формулы применяются ТОЛЬКО по подтверждённым параметризациям
 * первоисточников (никаких произвольных экспоненциальных коррекций);
 * вне конверта применимости (T/S/давление) значение константы НЕ
 * подставляется: value = null, valueStatus = 'out_of_applicability'.
 */
export function evaluateCarbonateEquilibriumConstants(input: {
  temperatureK: number;
  salinityPSU: number;
  pressurePa: number;
  phScale: CarbonatePhScale;
}): CarbonateConstantsResult {
  const T = input.temperatureK;
  const S = input.salinityPSU;
  if (typeof T !== 'number' || !Number.isFinite(T) || T <= 0) {
    throw new CarbonateChemistryError('invalid_input', `temperatureK должен быть конечным положительным числом, получено ${String(input.temperatureK)}`);
  }
  if (typeof S !== 'number' || !Number.isFinite(S) || S < 0) {
    throw new CarbonateChemistryError('invalid_input', `salinityPSU должен быть конечным неотрицательным числом, получено ${String(input.salinityPSU)}`);
  }
  if (typeof input.pressurePa !== 'number' || !Number.isFinite(input.pressurePa) || input.pressurePa < 0) {
    throw new CarbonateChemistryError('invalid_input', `pressurePa должен быть конечным неотрицательным числом, получено ${String(input.pressurePa)}`);
  }
  if (input.phScale !== 'seawater' && input.phScale !== 'total') {
    throw new CarbonateChemistryError('unsupported_ph_scale', `шкала «${String(input.phScale)}» не поддерживается (поддерживаются seawater и total)`);
  }

  const pressureBarOverAtmosphere = Math.max(0, (input.pressurePa - CARBONATE_STANDARD_ATMOSPHERE_PA) / 1e5);
  const tC = T - 273.15;
  const notes: string[] = [];

  if (input.pressurePa < CARBONATE_STANDARD_ATMOSPHERE_PA) {
    notes.push('давление ниже стандартной атмосферы: барометрическая поправка принята нулевой (Pbar = 0) — поправки определены относительно 1 атм');
  }
  if (pressureBarOverAtmosphere > CARBONATE_PRESSURE_MAX_BAR) {
    notes.push(`избыточное давление ${String(pressureBarOverAtmosphere)} bar выше ${String(CARBONATE_PRESSURE_MAX_BAR)} bar — вне конверта барометрических поправок (океанские давления, CO2SYS)`);
  }

  const envIssues = applicabilityIssues(T, S);
  const outOfRange = envIssues.length > 0;
  const pressureOutOfRange = pressureBarOverAtmosphere > CARBONATE_PRESSURE_MAX_BAR;
  if (outOfRange) notes.push(...envIssues);
  // Поправки без солевой зависимости: предполагается S ≈ 35 (Millero 1995/CO2SYS).
  notes.push('барометрические поправки (ΔV/κ, Millero 1995) заданы без солевой зависимости: предполагается S ≈ 35; шкала поправок — SWS');

  // К1/K2 по шкале входа; Kw — только на seawater-шкале.
  // Параметризация выбирается ШКАЛОЙ входа: seawater → Dickson &
  // Millero (1987) refit Mehrbach; total → Lueker et al. (2000).
  // Шкалы НЕ смешиваются: no silent substitution between them.
  const K1P = input.phScale === 'total' ? pK1_total_LDK00 : pK1_seawater_DM87_Mehrbach;
  const K2P = input.phScale === 'total' ? pK2_total_LDK00 : pK2_seawater_DM87_Mehrbach;
  const valueStatus = (): 'known' | 'out_of_applicability' => (outOfRange || pressureOutOfRange ? 'out_of_applicability' : 'known');
  const anyIssue = outOfRange || pressureOutOfRange;

  const k1Value = anyIssue ? null : Math.pow(10, -K1P(T, S)) * (pressureBarOverAtmosphere === 0 ? 1 : pressureFactor(PRESSURE_K1.deltaV(tC), PRESSURE_K1.kappa(tC), pressureBarOverAtmosphere, T));
  const k2Value = anyIssue ? null : Math.pow(10, -K2P(T, S)) * (pressureBarOverAtmosphere === 0 ? 1 : pressureFactor(PRESSURE_K2.deltaV(tC), PRESSURE_K2.kappa(tC), pressureBarOverAtmosphere, T));
  const kwValue = input.phScale === 'total' || anyIssue ? null : Math.exp(lnKw_seawater_M95(T, S)) * (pressureBarOverAtmosphere === 0 ? 1 : pressureFactor(PRESSURE_KW.deltaV(tC), PRESSURE_KW.kappa(tC), pressureBarOverAtmosphere, T));

  const dm87Source: CarbonateConstantProvenance = {
    sourceName: 'Dickson, A. G.; Millero, F. J. (1987): A comparison of the equilibrium constants for the dissociation of carbonic acid in seawater media',
    sourceId: 'doi:10.1016/0198-0148(87)90021-0',
    reference: 'Deep-Sea Research 34(10):1733-1743 (Corrigenda: Deep-Sea Research 36:983, 1989); первичные данные: Mehrbach et al. (1973), Limnology and Oceanography 18(6):897-907',
    retrievedAt: '2026-11-22',
    method: 'штатная параметризация CO2SYS (перекрёстно проверена с независимой реализацией PyCO2SYS, GMD 2022); коэффициенты закодированы дословно',
    conditions: 'шкала pH: seawater (SWS); концентрационная единица mol/kg-SW; заявленные условия данных: T = 2..35 °C, S = 20..40',
    applicability: 'морская вода; условные константы на концентрационной SWS-шкале (не термодинамические)',
    limitations: '2s-точность исходного рефита: pK1 ~ 0.011 (2.6% в K1), pK2 ~ 0.020 (4.6% в K2) по данным Mehrbach; значения не распространяются на пресные/опреснённые воды (S < 20)',
    formula: input.phScale === 'seawater'
      ? 'pK1 = 3670.7/T − 62.008 + 9.7944·ln(T) − 0.0118·S + 0.000116·S²'
      : 'не применяется: на total-шкале используется параметризация Lueker et al. (2000)'
  };
  const dm87K2Source: CarbonateConstantProvenance = {
    ...dm87Source,
    formula: 'pK2 = 1394.7/T + 4.777 − 0.0184·S + 0.000118·S²'
  };
  const ldk00Source: CarbonateConstantProvenance = {
    sourceName: 'Lueker, T. J.; Dickson, A. G.; Keeling, C. D. (2000): Ocean pCO2 calculated from dissolved inorganic carbon, alkalinity, and equations for K1 and K2: validation based on laboratory measurements of CO2 in gas and seawater at equilibrium',
    sourceId: 'doi:10.1016/S0304-4203(00)00022-0',
    reference: 'Marine Chemistry 70(1-3):105-119; первичные данные: Mehrbach et al. (1973), пересчитанные на total-шкалу',
    retrievedAt: '2026-11-22',
    method: 'штатная параметризация CO2SYS (перекрёстно проверена с независимой реализацией PyCO2SYS, GMD 2022); коэффициенты закодированы дословно',
    conditions: 'шкала pH: total; концентрационная единица mol/kg-SW',
    applicability: 'морская вода; условные константы на концентрационной total-шкале (не термодинамические)',
    limitations: 'диапазон исходного эквилибраторного набора ограничен; вне конверта модуля (T = 2..35 °C, S = 20..40) значение не подставляется',
    formula: input.phScale === 'total'
      ? 'pK1 = 3633.86/T − 61.2172 + 9.6777·ln(T) − 0.011555·S + 0.0001152·S²'
      : 'не применяется: на scale seawater используется параметризация Dickson & Millero (1987)'
  };
  const ldk00K2Source: CarbonateConstantProvenance = {
    ...ldk00Source,
    formula: 'pK2 = 471.78/T + 25.929 − 3.16967·ln(T) − 0.01781·S + 0.0001122·S²'
  };
  const m95KwSource: CarbonateConstantProvenance = {
    sourceName: 'Millero, F. J. (1995): Thermodynamics of the carbon dioxide system in the oceans',
    sourceId: 'doi:10.1016/0016-7037(94)00354-X',
    reference: 'Geochimica et Cosmochimica Acta 59(4):661-677',
    retrievedAt: '2026-11-22',
    method: 'штатная параметризация CO2SYS (перекрёстно проверена с независимой реализацией PyCO2SYS, GMD 2022); коэффициенты закодированы дословно',
    conditions: 'шкала pH: seawater (SWS); концентрационная единица mol/kg-SW; параметризация lnKw',
    applicability: 'морская вода; условная константа автопротолиза на SWS-шкале',
    limitations: 'на total-шкале модуль Kw НЕ подставляет (преобразование шкал требует KSO4/KF и суммарных сульфата/фторида — не реализовано)',
    formula: 'lnKw = 148.9802 − 13847.26/T − 23.6521·ln(T) + (−5.977 + 118.67/T + 1.0495·ln(T))·√S − 0.01615·S'
  };

  const k1Source = input.phScale === 'total' ? ldk00Source : dm87Source;
  const k2Source = input.phScale === 'total' ? ldk00K2Source : dm87K2Source;
  const status = valueStatus();
  const reasonNote = outOfRange
    ? 'значение НЕ подставляется: условия вне заявленной применимости параметризации (экстраполяция молчаливой подменой запрещена)'
    : pressureOutOfRange
      ? 'значение НЕ подставляется: барометрическая поправка вне конверта'
      : null;

  return {
    phScale: input.phScale,
    temperatureK: T,
    salinityPSU: S,
    pressureBarOverAtmosphere,
    K1: {
      name: 'K1',
      reaction: 'CO2*(aq) + H2O ⇌ H+ + HCO3- (CO2* = CO2(aq) + H2CO3, суммарно)',
      phScale: input.phScale,
      concentrationUnit: CARBONATE_CONCENTRATION_UNIT,
      value: k1Value,
      valueStatus: status,
      provenance: k1Source,
      applicability: k1Source.conditions ?? '',
      notes: reasonNote ? [reasonNote] : []
    },
    K2: {
      name: 'K2',
      reaction: 'HCO3- ⇌ H+ + CO3^2-',
      phScale: input.phScale,
      concentrationUnit: CARBONATE_CONCENTRATION_UNIT,
      value: k2Value,
      valueStatus: status,
      provenance: k2Source,
      applicability: k2Source.conditions ?? '',
      notes: reasonNote ? [reasonNote] : []
    },
    Kw: {
      name: 'Kw',
      reaction: 'H2O ⇌ H+ + OH-',
      phScale: input.phScale === 'seawater' ? 'seawater' : null,
      concentrationUnit: CARBONATE_CONCENTRATION_UNIT,
      value: kwValue,
      valueStatus: input.phScale === 'total' ? 'not_verifiable' : status,
      provenance: m95KwSource,
      applicability: m95KwSource.conditions ?? '',
      notes:
        input.phScale === 'total'
          ? ['Kw на total-шкале в этом модуле не параметризована (преобразование шкал требует KSO4/KF и суммарного сульфата/фторида): значение НЕ подменяется значением другой шкалы']
          : reasonNote
            ? [reasonNote]
            : []
    },
    notes: [...notes]
  };
}

// ============================================
// 4. РАВНОВЕСНАЯ МАТЕМАТИКА
// ============================================

/** Распределение видов при заданном [H+]. */
export interface CarbonateSpeciesConcentrations {
  readonly co2StarMolPerKgSw: number;
  readonly hco3MolPerKgSw: number;
  readonly co3MolPerKgSw: number;
  /** Сумма трёх (должна совпасть с DIC — проверяется решателем). */
  readonly dicSumMolPerKgSw: number;
}

/**
 * Распределение видов из [H+] и K1/K2 (модель с двумя кислотами и
 * общим DIC). Точная алгебра: dic-баланс выполняется по построению;
 * возвращает NaN-безопасные величины (конечность проверяется
 * решателем, положительность — тоже).
 */
export function computeCarbonateSpeciation(options: {
  k1: number;
  k2: number;
  hydrogenMolPerKgSw: number;
  dicMolPerKgSw: number;
}): CarbonateSpeciesConcentrations {
  const H = options.hydrogenMolPerKgSw;
  const k1 = options.k1;
  const k2 = options.k2;
  const D = options.dicMolPerKgSw;
  const den = H * H + k1 * H + k1 * k2;
  const co2Star = (D * H * H) / den;
  const hco3 = (D * k1 * H) / den;
  const co3 = (D * k1 * k2) / den;
  return { co2StarMolPerKgSw: co2Star, hco3MolPerKgSw: hco3, co3MolPerKgSw: co3, dicSumMolPerKgSw: co2Star + hco3 + co3 };
}

/**
 * КАРБОНАТНАЯ щёлочность TA_C = [HCO3-] + 2·[CO3^2-].
 * НЕ ВЫДАЁТСЯ ЗА ПОЛНУЮ TA: борат, фосфат, силикат и прочие
 * компоненты полной щёлочности в этом этапе НЕ моделируются.
 */
export function calculateCarbonateAlkalinity(options: {
  hco3MolPerKgSw: number;
  co3MolPerKgSw: number;
}): { valueMolPerKgSw: number; kind: 'carbonate_alkalinity_only'; note: string } {
  if (!Number.isFinite(options.hco3MolPerKgSw) || !Number.isFinite(options.co3MolPerKgSw)) {
    throw new CarbonateChemistryError('invalid_input', 'расчёт TA_C требует конечных концентраций HCO3- и CO3^2-');
  }
  return {
    valueMolPerKgSw: options.hco3MolPerKgSw + 2 * options.co3MolPerKgSw,
    kind: 'carbonate_alkalinity_only',
    note: 'ТА здесь — карбонатная ([HCO3-] + 2[CO3^2-]): борат/фосфат/силикат и органические компоненты ПОЛНОЙ щёлочности в этом этапе НЕ моделируются и НЕ выдаются за полную TA'
  };
}

/**
 * Зарядовый баланс МОДЕЛИРУЕМОЙ ПОДСИСТЕМЫ. Виды — отдельные
 * заряды, раствор целиком — электронейтрален ТОЛЬКО с фоновыми
 * сильными ионами, которых здесь нет: без явного фонового заряда
 * статус электронейтральности — «unknown», а не «полный да/нет».
 */
export interface CarbonateChargeBalanceResult {
  readonly modeledNetChargeMolPerKgSw: number;
  readonly contributions: readonly {
    readonly speciesId: string;
    readonly charge: number;
    readonly concentrationMolPerKgSw: number;
    readonly chargeContributionMolPerKgSw: number;
  }[];
  readonly backgroundStrongIonChargeMolPerKgSw: number | null;
  readonly residualMolPerKgSw: number | null;
  /** «yes»/«no» только с явно данным фоном; без фона — «unknown». */
  readonly electroneutral: 'yes' | 'no' | 'unknown';
  readonly toleranceMolPerKgSw: number;
}

/**
 * Макроскопический зарядовый баланс раствора по моделируемым
 * заряженным видам. НЕ путать: (а) заряд ВИДА — его формальный
 * заряд; (б) электронейтральность РАСТВОРА — сумма всех зарядов
 * с фоном ноль; (в) щёлочность — кислотно-связующее свойство.
 */
export function calculateCarbonateChargeBalance(options: {
  hydrogenMolPerKgSw: number;
  hco3MolPerKgSw: number;
  co3MolPerKgSw: number;
  /** Концентрация OH- (null = не определена на этой шкале). */
  ohMolPerKgSw: number | null;
  /** Фоновый заряд сильных ионов; absence = неизвестен. */
  backgroundStrongIonChargeMolPerKgSw?: number;
  toleranceMolPerKgSw?: number;
}): CarbonateChargeBalanceResult {
  const contributions: CarbonateChargeBalanceResult['contributions'] = [
    { speciesId: 'hplus_aq', charge: 1, concentrationMolPerKgSw: options.hydrogenMolPerKgSw, chargeContributionMolPerKgSw: options.hydrogenMolPerKgSw * 1 },
    { speciesId: 'hco3_aq', charge: -1, concentrationMolPerKgSw: options.hco3MolPerKgSw, chargeContributionMolPerKgSw: -options.hco3MolPerKgSw },
    { speciesId: 'co3_aq', charge: -2, concentrationMolPerKgSw: options.co3MolPerKgSw, chargeContributionMolPerKgSw: -2 * options.co3MolPerKgSw }
  ];
  if (options.ohMolPerKgSw !== null && options.ohMolPerKgSw !== undefined) {
    contributions.push({ speciesId: 'oh_aq', charge: -1, concentrationMolPerKgSw: options.ohMolPerKgSw, chargeContributionMolPerKgSw: -options.ohMolPerKgSw });
  }
  let net = 0;
  for (const c of contributions) net += c.chargeContributionMolPerKgSw;
  const background = options.backgroundStrongIonChargeMolPerKgSw !== undefined ? options.backgroundStrongIonChargeMolPerKgSw : null;
  const tolerance = options.toleranceMolPerKgSw !== undefined ? options.toleranceMolPerKgSw : 1e-12;
  if (background === null) {
    return {
      modeledNetChargeMolPerKgSw: net,
      contributions,
      backgroundStrongIonChargeMolPerKgSw: null,
      residualMolPerKgSw: null,
      electroneutral: 'unknown',
      toleranceMolPerKgSw: tolerance
    };
  }
  const residual = net + background;
  return {
    modeledNetChargeMolPerKgSw: net,
    contributions,
    backgroundStrongIonChargeMolPerKgSw: background,
    residualMolPerKgSw: residual,
    electroneutral: Math.abs(residual) <= tolerance ? 'yes' : 'no',
    toleranceMolPerKgSw: tolerance
  };
}

// ============================================
// 5. РЕШАТЕЛЬ РАВНОВЕСИЯ
// ============================================

/** Успешное равновесное решение (plain-JSON). */
export interface CarbonateModelResult {
  readonly status: 'applied';
  readonly mode: 'ph' | 'alkalinity';
  readonly phScale: CarbonatePhScale;
  readonly activityModel: CarbonateActivityModel;
  /** Явная маркировка приближения: результат НЕ «точная морская вода». */
  readonly approximation: {
    readonly kind: 'ideal_dilute';
    readonly note: string;
  };
  readonly temperatureK: number;
  readonly salinityPSU: number;
  readonly pressurePa: number;
  readonly pressureBarOverAtmosphere: number;
  /** [H+] в единицах модуля, mol/kg-SW; a(H+) = [H+]/1 mol/kg-SW в ideal_dilute. */
  readonly hydrogenMolPerKgSw: number;
  readonly ph: number;
  readonly speciesMolPerKgSw: {
    readonly co2_aq: number;
    readonly hco3_aq: number;
    readonly co3_aq: number;
    /** null — OH- не определена на этой шкале (Kw только для seawater). */
    readonly oh_aq: number | null;
  };
  readonly K1: CarbonateEquilibriumConstant;
  readonly K2: CarbonateEquilibriumConstant;
  readonly Kw: CarbonateEquilibriumConstant;
  /** Невязка |Σspecies − DIC|. */
  readonly dicConservationResidualMolPerKgSw: number;
  /** Расчётная карбонатная щёлочность (TA_C = [HCO3-] + 2[CO3^2-]). */
  readonly carbonateAlkalinityMolPerKgSw: number;
  /** Невязка |TA_C(решение) − TA_C(вход)|; null при режиме pH. */
  readonly alkalinityResidualMolPerKgSw: number | null;
  readonly chargeBalance: CarbonateChargeBalanceResult;
  readonly warnings: readonly string[];
}

/** Отказ (fail-closed, plain-JSON). */
export type CarbonateModelError = {
  readonly status: 'not_applied';
  readonly reasonKind: 'invalid_input' | 'out_of_applicability' | 'no_solution' | 'unsupported_ph_scale' | 'unsupported_activity_model';
  readonly reason: string;
  readonly issues: readonly string[];
};

export type CarbonateSolveResult = CarbonateModelResult | CarbonateModelError;

/** Итерации бинарного поиска для режима TA (детерминированные). */
const CARBONATE_BISECTION_ITERATIONS = 240;
const CARBONATE_H_MIN = 1e-16;
const CARBONATE_H_MAX = 1.0;

/**
 * Решить равновесие карбонатной системы:
 * 1) validateCarbonateChemistryInputs;
 * 2) применимость T/S/p и константы (evaluateCarbonateEquilibriumConstants);
 * 3) решение по заданный pH ИЛИ бинарным поиском по TA_C;
 * 4) невязки DIC/TA/заряда; 5) честные предупреждения.
 * Никакого изменения состояния и никаких побочных эффектов: чистая
 * функция. При любой ошибке — not_applied с диагностикой.
 */
export function solveCarbonateEquilibrium(input: CarbonateModelInput): CarbonateSolveResult {
  // 0. Опора структуры, затем ЯВНЫЕ проверки шкалы/модели, потом
  // остальная валидация формы — иначе phScale/ activityModel не
  // различать в reasonKind (метаданные не тонут в invalid_input).
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      status: 'not_applied',
      reasonKind: 'invalid_input',
      reason: 'вход карбонатного расчёта должен быть объектом-записью (plain record)',
      issues: []
    };
  }
  if (input.phScale !== 'seawater' && input.phScale !== 'total') {
    return {
      status: 'not_applied',
      reasonKind: 'unsupported_ph_scale',
      reason: `шкала «${String(input.phScale)}» не поддерживается ядром (поддерживаются seawater и total): отказ вместо молчаливой подмены шкалы`,
      issues: []
    };
  }
  if (input.activityModel !== 'ideal_dilute') {
    return {
      status: 'not_applied',
      reasonKind: 'unsupported_activity_model',
      reason: `модель активности «${String(input.activityModel)}» не реализована: параметры без верифицированной матрицы не кодируются, идеальный раствор не выдаётся за морскую воду`,
      issues: []
    };
  }

  // 1. Форма входа.
  const issues = validateCarbonateChemistryInputs(input);
  if (issues.length > 0) {
    return {
      status: 'not_applied',
      reasonKind: 'invalid_input',
      reason: 'вход карбонатного расчёта не проходит валидацию формы',
      issues
    };
  }

  // 2. Константы и применимость.
  let constants: CarbonateConstantsResult;
  try {
    constants = evaluateCarbonateEquilibriumConstants({
      temperatureK: input.temperatureK,
      salinityPSU: input.salinityPSU,
      pressurePa: input.pressurePa,
      phScale: input.phScale
    });
  } catch (error) {
    return {
      status: 'not_applied',
      reasonKind: error instanceof CarbonateChemistryError && error.code === 'unsupported_ph_scale' ? 'unsupported_ph_scale' : 'invalid_input',
      reason: 'константы не рассчитаны: ' + (error instanceof Error ? error.message : String(error)),
      issues: []
    };
  }
  const missing: string[] = [];
  if (constants.K1.value === null || constants.K1.valueStatus !== 'known') missing.push('K1 (' + (constants.K1.valueStatus) + ')');
  if (constants.K2.value === null || constants.K2.valueStatus !== 'known') missing.push('K2 (' + (constants.K2.valueStatus) + ')');
  if (missing.length > 0) {
    return {
      status: 'not_applied',
      reasonKind: 'out_of_applicability',
      reason: 'условия вне заявленной применимости параметризаций: равновесная система не решается на неверефицированных константах',
      issues: [...constants.notes, ...missing.map((m) => 'константа недоступна: ' + m)]
    };
  }
  const k1 = constants.K1.value as number;
  const k2 = constants.K2.value as number;

  const warnings: string[] = [...constants.notes];
  warnings.push('режим «ideal_dilute»: активности отождествлены концентрациям (a ≡ c/1 mol kg⁻¹) — результат является концентрационным приближением, а НЕ точной морской водой');
  warnings.push('карбонатная щёлочность ≠ полная TA: борат, фосфат, силикат и органические компоненты НЕ моделируются');

  // 3. Определение [H+].
  const dic = input.dicMolPerKgSw;
  let hydrogen: number;
  let mode: 'ph' | 'alkalinity';
  if (input.ph !== undefined) {
    mode = 'ph';
    hydrogen = Math.pow(10, -input.ph);
  } else {
    mode = 'alkalinity';
    const taC = input.carbonateAlkalinityMolPerKgSw as number;
    // Физическая достижимая: TA_C ∈ (0, 2·DIC]. TA_C > 2·DIC или ровно
    // на границе не решается (решение потребовало бы [H+] → 0).
    if (taC > 2 * dic) {
      return {
        status: 'not_applied',
        reasonKind: 'no_solution',
        reason: 'карбонатная щёлочность превышает физически достижимый предел 2·DIC (TA_C = [HCO3-] + 2[CO3^2-] ≤ 2·[HCO3-+CO3^2-]): решение не существует',
        issues: [`DIC = ${String(dic)}, TA_C = ${String(taC)}, 2·DIC = ${String(2 * dic)}`]
      };
    }
    if (taC === 2 * dic) {
      return {
        status: 'not_applied',
        reasonKind: 'no_solution',
        reason: 'TA_C точно достигла предела 2·DIC: потребовался бы [H+] → 0 (pH → +∞) — конечного решения нет',
        issues: [`DIC = ${String(dic)}, TA_C = ${String(taC)}`]
      };
    }
    // f(H) = TA_C(H) − TA_C строго убывает по H (положительной области);
    // бисекция по геометрическому среднему — детерминированная и
    // численно стабильная для H ∈ [1e-16, 1].
    const f = (H: number): number => {
      const den = H * H + k1 * H + k1 * k2;
      return (dic * (k1 * H + 2 * k1 * k2)) / den - taC;
    };
    let lo = CARBONATE_H_MIN;
    let hi = CARBONATE_H_MAX;
    for (let i = 0; i < CARBONATE_BISECTION_ITERATIONS; i++) {
      const mid = Math.sqrt(lo * hi);
      if (f(mid) > 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    hydrogen = Math.sqrt(lo * hi);
  }

  if (!Number.isFinite(hydrogen) || hydrogen <= 0) {
    return {
      status: 'not_applied',
      reasonKind: 'no_solution',
      reason: 'решатель не смог получить конечное положительное [H+]',
      issues: [`hydrogenMolPerKgSw = ${String(hydrogen)}`]
    };
  }

  const ph = -Math.log10(hydrogen);
  if (!Number.isFinite(ph)) {
    return {
      status: 'not_applied',
      reasonKind: 'no_solution',
      reason: 'pH непредставим (переполнение логарифма): отказ вместо нечислового значения',
      issues: []
    };
  }

  // 4. Виды, невязки, заряд.
  const speciation = computeCarbonateSpeciation({ k1, k2, hydrogenMolPerKgSw: hydrogen, dicMolPerKgSw: dic });
  const finitenessIssues: string[] = [];
  const positive = [speciation.co2StarMolPerKgSw, speciation.hco3MolPerKgSw, speciation.co3MolPerKgSw];
  for (let i = 0; i < positive.length; i++) {
    const v = positive[i]!;
    if (!Number.isFinite(v)) finitenessIssues.push(`вид #${String(i)}: не конечное число`);
    if (v <= 0) finitenessIssues.push(`вид #${String(i)}: неположительная концентрация`);
  }
  if (finitenessIssues.length > 0) {
    return {
      status: 'not_applied',
      reasonKind: 'no_solution',
      reason: 'решение не даёт конечных положительных концентраций всех трёх видов: оно отброшено (откат к входному состоянию, никакого результата)',
      issues: finitenessIssues
    };
  }
  const dicResidual = Math.abs(speciation.dicSumMolPerKgSw - dic);

  const karbonat = calculateCarbonateAlkalinity({ hco3MolPerKgSw: speciation.hco3MolPerKgSw, co3MolPerKgSw: speciation.co3MolPerKgSw });
  const alkalinityResidual = mode === 'alkalinity' ? Math.abs(karbonat.valueMolPerKgSw - (input.carbonateAlkalinityMolPerKgSw as number)) : null;

  // OH- определена только когда Kw известна И шкала входа совпадает со шкалой Kw (seawater).
  const kwKnown = constants.Kw.value !== null && constants.Kw.valueStatus === 'known' && constants.Kw.phScale === input.phScale;
  const ohValue = kwKnown && constants.Kw.value !== null ? (constants.Kw.value as number) / hydrogen : null;
  if (mode === 'ph' && !kwKnown) {
    warnings.push('OH- не определена на этой шкале (Kw только для seawater): charge-balance отчёт без вклада OH-');
  }

  const chargeBalance = calculateCarbonateChargeBalance({
    hydrogenMolPerKgSw: hydrogen,
    hco3MolPerKgSw: speciation.hco3MolPerKgSw,
    co3MolPerKgSw: speciation.co3MolPerKgSw,
    ohMolPerKgSw: ohValue,
    backgroundStrongIonChargeMolPerKgSw: input.backgroundStrongIonChargeMolPerKgSw,
    toleranceMolPerKgSw: Math.max(1e-15, 1e-12 * Math.max(1, dic))
  });
  if (input.backgroundStrongIonChargeMolPerKgSw === undefined) {
    warnings.push('фоновый заряд сильных ионов не задан: электронейтральность ПОЛНОГО раствора не утверждается (статус «unknown») — карбонатные анионы в реальной морской воде балансируются сильными ионами, которые здесь не моделируются');
  }

  return {
    status: 'applied',
    mode,
    phScale: input.phScale,
    activityModel: input.activityModel,
    approximation: {
      kind: 'ideal_dilute',
      note: 'активность отождествлена концентрации: a(H+) ≡ [H+]/(1 mol/kg-SW) — идеальное разбавленное приближение, ЯВНО маркированное; завышение точности морской воды запрещено'
    },
    temperatureK: input.temperatureK,
    salinityPSU: input.salinityPSU,
    pressurePa: input.pressurePa,
    pressureBarOverAtmosphere: constants.pressureBarOverAtmosphere,
    hydrogenMolPerKgSw: hydrogen,
    ph,
    speciesMolPerKgSw: {
      co2_aq: speciation.co2StarMolPerKgSw,
      hco3_aq: speciation.hco3MolPerKgSw,
      co3_aq: speciation.co3MolPerKgSw,
      oh_aq: ohValue
    },
    K1: constants.K1,
    K2: constants.K2,
    Kw: constants.Kw,
    dicConservationResidualMolPerKgSw: dicResidual,
    carbonateAlkalinityMolPerKgSw: karbonat.valueMolPerKgSw,
    alkalinityResidualMolPerKgSw: alkalinityResidual,
    chargeBalance,
    warnings
  };
}

// ============================================
// 6. ИНТЕГРАЦИЯ СО STAGE 4.9b:
//    ЯВНЫЕ ОПРЕДЕЛЕНИЯ РЕАКЦИЙ И ВЫЧИСЛИМЫЙ ПЕРЕНОС ВЕЩЕСТВА
// ============================================

/**
 * Linked provenance параметризаций (общий для определений).
 */
const CARBONATE_REACTION_DEFINITIONS_PROVENANCE = {
  sourceName: 'Стандартная кислотно-основная химия угольной кислоты (стехиометрия реакций диссоциации); константы — Dickson & Millero (1987), Lueker et al. (2000), Millero (1995)',
  sourceId: 'evowars/stage-4.9c/carbonate-dissociation-definitions',
  retrievedAt: '2026-11-22',
  method: 'определения строят КАРКАС реакций для будущего атомарного применения; численное распределение выполняет равновесный решатель (не extent), применённая степень протекания появится только вместе с атомарным coupled-исполнением',
  conditions: 'форма, записанная в ReactionLedger: CO2(aq) + H2O ⇌ H+ + HCO3-; HCO3- ⇌ H+ + CO3^2-; H2O ⇌ H+ + OH- (и обратные направления); проверка стадии — auditReactionStoichiometry'
} as const;

const P_OCEAN = 'ocean';

function participant(speciesId: string, coefficient: number): ReactionParticipant {
  return { reservoirId: P_OCEAN, speciesId, coefficient };
}

/**
 * Явные определения реакций карбонатной системы (Stage 4.9c §7):
 * первой диссоциации, второй диссоциации, обратных направлений и
 * автопротолиза воды. Первая диссоциация и автопротолиз включают
 * растворитель h2o_aq — иначе стехиометрия не балансируется по H и O
 * (раздел 8 промпта: баланс каждой отдельной реакции обязателен);
 * h2o_aq — закреплённый растворитель, не переменная состояния.
 * Определения проходят validateGeochemicalReactionDefinition и
 * аудируется штатным auditReactionStoichiometry; ФИЗИЧЕСКОЕ
 * применение через extent НЕ выполняется этапом: равновесное
 * распределение не зависит от произвольного extent, одновременное
 * распределение трёх видов — единая задача (см.
 * planCarbonateSpeciationTransfer).
 */
export const CARBONATE_DISSOCIATION_REACTION_DEFINITIONS: readonly GeochemicalReactionDefinition[] = [
  {
    reactionId: 'geo.carbonate.co2aq.dissociation.forward',
    processId: 'geo.carbonate.speciation.stage-4.9c',
    description: 'Первая диссоциация растворённого диоксида углерода: CO2(aq) + H2O → H+ + HCO3- (в воде океана)',
    reactants: [participant('co2_aq', 1), participant('h2o_aq', 1)],
    products: [participant('hplus_aq', 1), participant('hco3_aq', 1)],
    extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
    definitionProvenance: CARBONATE_REACTION_DEFINITIONS_PROVENANCE,
    applicability: 'водная фаза океана; применяется только как часть единого равновесного расчёта Stage 4.9c, а не как независимая extent-транзакция',
    limitations: 'не является кинетикой и не доказывает скорость растворения CO2; равновесное распределение НЕ сводится к трём независимым extent-транзакциям без общей проверки DIC',
    assumptions: ['гомогенная водная фаза; константы равновесия стадии 4.9c; h2o_aq — закреплённый растворитель, не переносимое запас']
  },
  {
    reactionId: 'geo.carbonate.co2aq.dissociation.reverse',
    processId: 'geo.carbonate.speciation.stage-4.9c',
    description: 'Обратная первая диссоциации: H+ + HCO3- → CO2(aq) + H2O',
    reactants: [participant('hplus_aq', 1), participant('hco3_aq', 1)],
    products: [participant('co2_aq', 1), participant('h2o_aq', 1)],
    extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
    definitionProvenance: CARBONATE_REACTION_DEFINITIONS_PROVENANCE,
    applicability: 'водная фаза океана; как часть единого равновесного расчёта Stage 4.9c',
    limitations: 'не является кинетикой; равновесие не зависит от направления записи — направление фиксирует стехиометрию, не механику',
    assumptions: ['гомогенная водная фаза; h2o_aq — закреплённый растворитель']
  },
  {
    reactionId: 'geo.carbonate.hco3.dissociation.forward',
    processId: 'geo.carbonate.speciation.stage-4.9c',
    description: 'Вторая диссоциация: HCO3- → H+ + CO3^2-',
    reactants: [participant('hco3_aq', 1)],
    products: [participant('hplus_aq', 1), participant('co3_aq', 1)],
    extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
    definitionProvenance: CARBONATE_REACTION_DEFINITIONS_PROVENANCE,
    applicability: 'водная фаза океана; как часть единого равновесного расчёта Stage 4.9c',
    limitations: 'не является кинетикой; стехиометрическая запись не изображает установление равновесия во времени',
    assumptions: ['гомогенная водная фаза']
  },
  {
    reactionId: 'geo.carbonate.hco3.dissociation.reverse',
    processId: 'geo.carbonate.speciation.stage-4.9c',
    description: 'Обратная второй диссоциации: H+ + CO3^2- → HCO3-',
    reactants: [participant('hplus_aq', 1), participant('co3_aq', 1)],
    products: [participant('hco3_aq', 1)],
    extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
    definitionProvenance: CARBONATE_REACTION_DEFINITIONS_PROVENANCE,
    applicability: 'водная фаза океана; как часть единого равновесного расчёта Stage 4.9c',
    limitations: 'не является кинетикой; стехиометрическая запись не изображает установление равновесия во времени',
    assumptions: ['гомогенная водная фаза']
  },
  {
    reactionId: 'geo.carbonate.water.autoprotolysis.forward',
    processId: 'geo.carbonate.speciation.stage-4.9c',
    description: 'Автопротолиз воды: H2O → H+ + OH- (константа Kw)',
    reactants: [participant('h2o_aq', 1)],
    products: [participant('hplus_aq', 1), participant('oh_aq', 1)],
    extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
    definitionProvenance: CARBONATE_REACTION_DEFINITIONS_PROVENANCE,
    applicability: 'водная фаза океана; как часть диагностики зарядового баланса Stage 4.9c',
    limitations: 'не является кинетикой; стехиометрическая запись автопротолиза не изображает процесс во времени',
    assumptions: ['гомогенная водная фаза; h2o_aq — закреплённый растворитель']
  }
] as const;

/**
 * Runtime-проверка экспортированных определений: форма + уникальность
 * reactionId. Возвращает список проблем (пустой = корректно).
 */
export function validateCarbonateDissociationReactionDefinitions(): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const def of CARBONATE_DISSOCIATION_REACTION_DEFINITIONS) {
    for (const issue of validateGeochemicalReactionDefinition(def)) {
      issues.push(`${def.reactionId}: ${issue}`);
    }
    if (seen.has(def.reactionId)) {
      issues.push(`дубликат reactionId «${def.reactionId}»`);
    }
    seen.add(def.reactionId);
  }
  return issues;
}

/**
 * План переноса вещества при сдвиге равновесия (специальный
 * иммутабельный результат используемый вместо трёх независимых
 * extent-транзакций; Stage 4.9c §7).
 *
 * ЗАЧЕМ ТАК: равновесное распределение не зависит от произвольного
 * extent. Сначала решается равновесие (solveCarbonateEquilibrium),
 * затем перенос = РАЗНОСТЬ равновесных распределений до/после.
 * Три независимые транзакции по одному extent не распределяют три
 * вида одновременно и не гарантируют сохранения DIC; контракт
 * GeochemicalCoupledTransactionContract (Stage 4.9b) пока не имеет
 * исполнителя multi-reaction — поэтому НЕ ИМИТИРУЕТСЯ совместное
 * применение, а возвращается честный вычислимый план БЕЗ применения
 * (физическая запись транзакций — следующий этап).
 *
 * Гарантии: входные объекты НЕ мутируются; план сериализуем в plain-JSON;
 * carbonConservationResidual — прямая проверка сохранения углерода.
 */
export interface CarbonateSpeciationTransferPlan {
  readonly status: 'planned_not_applied';
  /** Физическое применение переноса данным этапом НЕ выполняется. */
  readonly atomicity: 'deferred_to_next_stage';
  readonly reason: string;
  readonly deltas: readonly {
    readonly reservoirId: string;
    readonly speciesId: 'co2_aq' | 'hco3_aq' | 'co3_aq';
    readonly deltaMolPerKgSw: number;
  }[];
  /** |Σ delta по углеродным видам| — прямая проверка сохранения DIC. */
  readonly carbonConservationResidualMolPerKgSw: number;
  readonly notes: readonly string[];
}

/**
 * Вычислить план переноса как разность равновесных распределений.
 * target и baseline — ЛЮБЫЕ согласованные распределения (например,
 * два solveCarbonateEquilibrium при разном pH при одном DIC).
 * При несовпадении DIC — план с ненулевым residual (диагностика),
 * а не ложное сохранение.
 */
export function planCarbonateSpeciationTransfer(
  baseline: { readonly co2StarMolPerKgSw: number; readonly hco3MolPerKgSw: number; readonly co3MolPerKgSw: number },
  target: { readonly co2StarMolPerKgSw: number; readonly hco3MolPerKgSw: number; readonly co3MolPerKgSw: number }
): CarbonateSpeciationTransferPlan {
  const finite = (v: number): boolean => Number.isFinite(v) && v > 0;
  const issues: string[] = [];
  for (const [label, value] of [
    ['co2Star(база)', baseline.co2StarMolPerKgSw],
    ['hco3(база)', baseline.hco3MolPerKgSw],
    ['co3(база)', baseline.co3MolPerKgSw],
    ['co2Star(цель)', target.co2StarMolPerKgSw],
    ['hco3(цель)', target.hco3MolPerKgSw],
    ['co3(цель)', target.co3MolPerKgSw]
  ] as const) {
    if (!finite(value)) issues.push(`${label}: не конечное положительное число (фикс. значение ${String(value)})`);
  }
  const co2Delta = finite(baseline.co2StarMolPerKgSw) && finite(target.co2StarMolPerKgSw) ? target.co2StarMolPerKgSw - baseline.co2StarMolPerKgSw : NaN;
  const hco3Delta = finite(baseline.hco3MolPerKgSw) && finite(target.hco3MolPerKgSw) ? target.hco3MolPerKgSw - baseline.hco3MolPerKgSw : NaN;
  const co3Delta = finite(baseline.co3MolPerKgSw) && finite(target.co3MolPerKgSw) ? target.co3MolPerKgSw - baseline.co3MolPerKgSw : NaN;
  const carbonDelta = co2Delta + hco3Delta + co3Delta;
  const notes: string[] = [
    'план НЕ применён к инвентарям: атомарное multi-species применение через общий исполнитель — следующий этап (GeochemicalCoupledTransactionContract без исполнителя в 4.9b); три независимые extent-транзакции для этого НЕ используются (без общей проверки DIC)',
    'перенос H+/OH- в план НЕ включается: распределение протонов в составе полной щёлочности требует явного учёта немоделируемых компонентов (борат и др.) — это отдельно фиксируется ограничением этапа'
  ];
  if (issues.length > 0) {
    notes.push(...issues);
    return {
      status: 'planned_not_applied',
      atomicity: 'deferred_to_next_stage',
      reason: 'план переноса не построен: распределения содержат не представимые (неположительные/неконечные) концентрации',
      deltas: [
        { reservoirId: P_OCEAN, speciesId: 'co2_aq', deltaMolPerKgSw: NaN },
        { reservoirId: P_OCEAN, speciesId: 'hco3_aq', deltaMolPerKgSw: NaN },
        { reservoirId: P_OCEAN, speciesId: 'co3_aq', deltaMolPerKgSw: NaN }
      ],
      carbonConservationResidualMolPerKgSw: NaN,
      notes
    };
  }
  return {
    status: 'planned_not_applied',
    atomicity: 'deferred_to_next_stage',
    reason:
      'равновесие решено до переноса; план — разность распределений DIC, применяемая единым оператором будущей стадии: атомарность multi-reaction 4.9c executor не гарантирует, физическое применение не выполняется',
    deltas: [
      { reservoirId: P_OCEAN, speciesId: 'co2_aq', deltaMolPerKgSw: co2Delta },
      { reservoirId: P_OCEAN, speciesId: 'hco3_aq', deltaMolPerKgSw: hco3Delta },
      { reservoirId: P_OCEAN, speciesId: 'co3_aq', deltaMolPerKgSw: co3Delta }
    ],
    carbonConservationResidualMolPerKgSw: Math.abs(carbonDelta),
    notes
  };
}
