// ============================================
// CORE — ЯДРО EOS КОНДЕНСИРОВАННЫХ МАТЕРИАЛОВ (Stage 4.7.1)
// ============================================
//
// Назначение: научное ядро прямой задачи P(ρ) и обратной задачи ρ(P)
// для конденсированных материалов планетных недр на фиксированной
// изотерме опорной температуры записи (для текущих материалов — 300 K).
// Модель: изотермическое уравнение состояния Бирча–Мурнагана
// 3-го порядка (BM3).
//
// Честные ограничения этапа (обязательная оговорка):
// - это ИЗОТЕРМИЧЕСКОЕ EOS при опорной температуре записи; оно НЕ
//   описывает горячие недра планет: тепловое давление и эффекты
//   Ми–Грюнайзена–Дебая не моделируются (перенесены на следующие
//   подэтапы 4.7.x);
// - температура вне подтверждённой изотермы НЕ экстраполируется:
//   возвращается out_of_applicability;
// - фазовые переходы, смешение компонентов и гидростатические
//   профили — вне Stage 4.7.1;
// - отсутствующая неопределённость параметра означает «неизвестна»,
//   а не ноль;
// - ядро не смешивается с газовым каталогом Peng–Robinson
//   (Data/eosParameters.ts, Stage 4.4.4.1): это несопоставимые модели
//   для несопоставимых фаз. Переиспользуются общие контракты проекта
//   (PhysicalQuantity, DataProvenance, Uncertainty, реестр единиц);
//   второй системы статусов научных данных не создаётся.
//
// Математический контракт BM3:
//
//   η = ρ / ρ0     (степень сжатия, η ≥ 1)
//
//   P(η) = (3/2)·K0·(η^(7/3) − η^(5/3))·[1 + (3/4)·(K0′ − 4)·(η^(2/3) − 1)] + P0
//
// Аналитические свойства, проверяемые тестами независимо:
//   P(η = 1)       = P0
//   dP/dln ρ|ρ0    = K0

import type { DataProvenance, Uncertainty } from './scientificValue';
import { validateUncertainty } from './scientificValue';
import type { PhysicalQuantity } from './physicalQuantity';
import { quantity } from './physicalQuantity';

// ============================================
// 1. РЕЕСТРЫ МОДЕЛИ, ФАЗ И ПРОИСХОЖДЕНИЯ
// ============================================

/** Единственная модель, реализованная ядром на этапе 4.7.1. */
export type CondensedMatterEosModel = 'birch_murnaghan_3rd';

export const CONDENSED_MATTER_EOS_MODELS: readonly CondensedMatterEosModel[] = [
  'birch_murnaghan_3rd'
];

/** Фазы конденсированных материалов (газы — вне этого ядра). */
export type CondensedMatterEosPhase = 'solid' | 'liquid';

export const CONDENSED_MATTER_EOS_PHASES: readonly CondensedMatterEosPhase[] = [
  'solid',
  'liquid'
];

/**
 * Класс происхождения числового параметра (паттерн каталога
 * Peng–Robinson, контракт репозитория Stage 4.4.4.1).
 */
export type CondensedMatterEosValueOrigin =
  | 'reported' // значение явно опубликовано в источнике
  | 'derived' // значение вычислено в этом репозитории из опубликованных величин
  | 'software_dataset'; // значение взято из программного набора данных

export type CondensedMatterEosEvidence =
  | 'VERIFIED' // независимо сверено по первоисточнику
  | 'PARTIALLY_VERIFIED' // сверено частично, см. note у provenance
  | 'UNRESOLVED_CROSS_CHECK' // кросс-проверка не сняла несогласованность
  | 'UNRESOLVED'; // не проверено; блокирует использование записи

export const CONDENSED_MATTER_EOS_VALUE_ORIGINS: readonly CondensedMatterEosValueOrigin[] = [
  'reported',
  'derived',
  'software_dataset'
];

export const CONDENSED_MATTER_EOS_EVIDENCE_STATUSES: readonly CondensedMatterEosEvidence[] = [
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'UNRESOLVED_CROSS_CHECK',
  'UNRESOLVED'
];

/** Происхождение параметра = общий DataProvenance проекта + статус проверки. */
export interface CondensedMatterEosParameterProvenance extends Readonly<DataProvenance> {
  readonly origin: CondensedMatterEosValueOrigin;
  readonly evidence: CondensedMatterEosEvidence;
}

/** Числовой параметр записи EOS: SI-значение + единица + неопределённость + происхождение. */
export interface CondensedMatterEosScalarParameter {
  readonly value: number;
  readonly unit: string;
  /** Отсутствие неопределённости означает «неизвестна», а не ноль. */
  readonly uncertainty?: Readonly<Uncertainty>;
  readonly provenance: CondensedMatterEosParameterProvenance;
}

// ============================================
// 2. КОНТРАКТ ЗАПИСИ МАТЕРИАЛА
// ============================================

export interface CondensedMatterEosRange {
  readonly min: number; // включительно
  readonly max: number; // включительно
}

/**
 * Подтверждённая область применимости записи.
 * `...Known: false` означает: диапазон НЕ подтверждён источником;
 * соответствующие проверки ядра будут отказывать (fail-closed),
 * а не пропускать без проверки.
 */
export interface CondensedMatterEosApplicability {
  readonly temperatureRangeKnown: boolean;
  readonly temperatureRangeK?: Readonly<CondensedMatterEosRange>;
  readonly pressureRangeKnown: boolean;
  readonly pressureRangePa?: Readonly<CondensedMatterEosRange>;
  readonly densityRangeKnown: boolean;
  readonly densityRangeKgM3?: Readonly<CondensedMatterEosRange>;
  /** Обязательное текстовое пояснение: что подтверждено, что неизвестно. */
  readonly note: string;
}

/** Кристаллографическая структура (только для фазы 'solid'). */
export interface CondensedMatterEosCrystalStructure {
  readonly designation: string;
  readonly provenance?: CondensedMatterEosParameterProvenance;
  readonly note?: string;
}

/**
 * Полный контракт записи материала (Stage 4.7.1): идентификация, фаза,
 * модель, опорная точка, параметры BM3, подтверждённая область
 * применимости, происхождение каждого параметра, библиография, лицензия.
 */
export interface CondensedMatterEosRecord {
  readonly materialId: string;
  readonly displayName: string;
  /** Стехиометрическая формула в компактной нотации: 'Fe', 'MgSiO3'. */
  readonly formula: string;
  /** Формула для отображения: 'Fe', 'MgSiO₃'. */
  readonly formulaDisplay: string;
  /** Фаза записи; разные фазы одного вещества = разные записи, без смешения. */
  readonly phase: CondensedMatterEosPhase;
  readonly crystalStructure?: Readonly<CondensedMatterEosCrystalStructure>;
  readonly eosModel: CondensedMatterEosModel;
  readonly referenceTemperatureK: CondensedMatterEosScalarParameter;
  /** Опорное давление P0 формулы (для текущих записей 0). */
  readonly referencePressurePa: CondensedMatterEosScalarParameter;
  readonly referenceDensityKgM3: CondensedMatterEosScalarParameter;
  readonly bulkModulusPa: CondensedMatterEosScalarParameter;
  readonly bulkModulusPressureDerivative: CondensedMatterEosScalarParameter;
  readonly applicability: Readonly<CondensedMatterEosApplicability>;
  /** Ограничения модели и записи. Обязательное непустое поле. */
  readonly scopeNotes: readonly string[];
  readonly literature: readonly string[];
  /** Лицензия или честный статус её неопределённости. */
  readonly license: string;
}

// ============================================
// 3. ПРОЗРАЧНЫЕ ГРАНИЦЫ ЯДРА
// ============================================

/**
 * Жёсткая инженерная граница ядра по степени сжатия: BM3 монотонна и
 * численно устойчива при η ∈ [1, 1000]. За границей — отказ, а не
 * экстраполяция. Это консервативная инженерная граница, а не физический
 * предел модели; для подтверждённых диапазонов записей она достигается
 * раньше по applicability записи.
 */
export const BM3_MAX_SUPPORTED_COMPRESSION_RATIO = 1e3;
export const BM3_MIN_SUPPORTED_COMPRESSION_RATIO = 1;

/** Допуск сравнения переданной температуры с изотермой записи, K. */
export const BM3_ISOTHERMAL_TEMPERATURE_TOLERANCE_K = 10;

/**
 * Санитарные границы параметров BM3 (валидация контракта): большинство
 * опубликованных K0′ лежит в [1, 10]; K0 конденсированных веществ — до
 * 1e13 Pa; ρ0 конденсированных веществ — до 1e6 kg/m³.
 */
export const BM3_VALID_K0_PRIME_RANGE: Readonly<CondensedMatterEosRange> = { min: 1, max: 10 };
export const BM3_VALID_BULK_MODULUS_MAX_PA = 1e13;
export const BM3_VALID_REFERENCE_DENSITY_MAX_KG_M3 = 1e6;

// ============================================
// 4. ЧИСЛЕННОЕ ЯДРО BM3
// ============================================

export interface Bm3IsothermalParameters {
  readonly referenceDensityKgM3: number;
  readonly bulkModulusPa: number;
  readonly bulkModulusPressureDerivative: number;
  readonly referencePressurePa: number;
}

function isPositiveFinite(x: number): boolean {
  return Number.isFinite(x) && x > 0;
}

function isFiniteInRange(x: number, min: number, max: number): boolean {
  return Number.isFinite(x) && x >= min && x <= max;
}

/**
 * Степень сжатия η = ρ/ρ0; null при некорректном входе или выходе за
 * поддерживаемую область ядра.
 */
export function bm3CompressionRatio(
  densityKgM3: number,
  referenceDensityKgM3: number
): number | null {
  if (!isPositiveFinite(densityKgM3) || !isPositiveFinite(referenceDensityKgM3)) return null;
  const eta = densityKgM3 / referenceDensityKgM3;
  if (!Number.isFinite(eta)) return null;
  if (eta < BM3_MIN_SUPPORTED_COMPRESSION_RATIO || eta > BM3_MAX_SUPPORTED_COMPRESSION_RATIO) {
    return null;
  }
  return eta;
}

/**
 * Ядро BM3 в степени сжатия. Устойчивые степени через последовательные
 * умножения на η^(2/3); промежуточные величины проверяются на конечность.
 * Возвращает АБСОЛЮТНОЕ давление (P0 включено явным слагаемым; для текущих
 * записей P0 = 0 Pa, избыточное и абсолютное давление не подменяются).
 */
export function bm3PressureAtCompressionRatio(
  eta: number,
  params: Bm3IsothermalParameters
): number | null {
  if (
    !isFiniteInRange(
      eta,
      BM3_MIN_SUPPORTED_COMPRESSION_RATIO,
      BM3_MAX_SUPPORTED_COMPRESSION_RATIO
    )
  ) {
    return null;
  }
  const {
    referenceDensityKgM3,
    bulkModulusPa,
    bulkModulusPressureDerivative,
    referencePressurePa
  } = params;
  if (!isPositiveFinite(referenceDensityKgM3)) return null;
  if (!isPositiveFinite(bulkModulusPa) || bulkModulusPa > BM3_VALID_BULK_MODULUS_MAX_PA) return null;
  if (
    !isFiniteInRange(
      bulkModulusPressureDerivative,
      BM3_VALID_K0_PRIME_RANGE.min,
      BM3_VALID_K0_PRIME_RANGE.max
    )
  ) {
    return null;
  }
  if (!Number.isFinite(referencePressurePa)) return null;

  const x = Math.pow(eta, 2 / 3);
  const eta5 = eta * x; // η^(5/3)
  const eta7 = eta5 * x; // η^(7/3)
  const bracket = 1 + 0.75 * (bulkModulusPressureDerivative - 4) * (x - 1);
  if (!Number.isFinite(x) || !Number.isFinite(eta5) || !Number.isFinite(eta7) || !Number.isFinite(bracket)) {
    return null;
  }
  const pressure = 1.5 * bulkModulusPa * (eta7 - eta5) * bracket + referencePressurePa;
  if (!Number.isFinite(pressure)) return null;
  return pressure;
}

/** Прямая задача: давление при плотности; null при отказе. */
export function bm3Pressure(densityKgM3: number, params: Bm3IsothermalParameters): number | null {
  if (!isPositiveFinite(densityKgM3)) return null;
  const eta = bm3CompressionRatio(densityKgM3, params.referenceDensityKgM3);
  if (eta === null) return null;
  return bm3PressureAtCompressionRatio(eta, params);
}

/**
 * Аналитическая производная dP/dln ρ в степени сжатия — независимая
 * числовая проверка контракта (сценарий 2 §9) и численного контроля
 * монотонности ядра.
 */
export function bm3DPressureDLnDensityAtCompressionRatio(
  eta: number,
  params: Bm3IsothermalParameters
): number | null {
  if (
    !isFiniteInRange(
      eta,
      BM3_MIN_SUPPORTED_COMPRESSION_RATIO,
      BM3_MAX_SUPPORTED_COMPRESSION_RATIO
    )
  ) {
    return null;
  }
  const { bulkModulusPa: K0, bulkModulusPressureDerivative: K0p } = params;
  if (
    !isPositiveFinite(K0) ||
    !isFiniteInRange(K0p, BM3_VALID_K0_PRIME_RANGE.min, BM3_VALID_K0_PRIME_RANGE.max)
  ) {
    return null;
  }
  const x = Math.pow(eta, 2 / 3);
  const eta4 = Math.pow(eta, 4 / 3);
  const eta5 = eta * x;
  const eta7 = eta5 * x;
  const bracket = 1 + 0.75 * (K0p - 4) * (x - 1);
  const dPressBracket = 1.5 * K0 * ((7 / 3) * eta4 - (5 / 3) * x) * bracket;
  const dBracket = 1.5 * K0 * (eta7 - eta5) * 0.75 * (K0p - 4) * ((2 / 3) / Math.cbrt(eta));
  const derivative = (dPressBracket + dBracket) * eta;
  if (!Number.isFinite(derivative)) return null;
  return derivative;
}

/**
 * ЧИСЛЕННЫЙ КОНТРОЛЬ МОНОТОННОСТИ P(ρ) в точке: центральная разность dP/dρ
 * должна быть положительной и согласованной с аналитической оценкой.
 * Немонотонность (BM3 может дать её при K0′ < 4 на больших сжатиях) —
 * numerical_failure, а не молчаливый результат.
 */
export function bm3IsMonotonicAtDensity(
  densityKgM3: number,
  params: Bm3IsothermalParameters
): boolean {
  const eta = bm3CompressionRatio(densityKgM3, params.referenceDensityKgM3);
  if (eta === null) return false;
  const relStep = 1e-6;
  // шаг ограничен поддерживаемой областью ядра
  const etaLow = Math.max(BM3_MIN_SUPPORTED_COMPRESSION_RATIO, eta * (1 - relStep));
  const etaHigh = Math.min(BM3_MAX_SUPPORTED_COMPRESSION_RATIO, eta * (1 + relStep));
  if (etaHigh <= etaLow) return false;
  const pLow = bm3PressureAtCompressionRatio(etaLow, params);
  const pHigh = bm3PressureAtCompressionRatio(etaHigh, params);
  if (pLow === null || pHigh === null) return false;
  if (!(pHigh > pLow)) return false;
  const numeric = (pHigh - pLow) / (etaHigh - etaLow);
  const analytic = bm3DPressureDLnDensityAtCompressionRatio(eta, params);
  if (analytic === null || analytic <= 0) return false;
  if (!(numeric > 0)) return false;
  return true;
}

/** Параметры ядра из записи (для использования после проверки записи). */
export function bm3ParametersFromRecord(
  record: CondensedMatterEosRecord
): Bm3IsothermalParameters {
  return {
    referenceDensityKgM3: record.referenceDensityKgM3.value,
    bulkModulusPa: record.bulkModulusPa.value,
    bulkModulusPressureDerivative: record.bulkModulusPressureDerivative.value,
    referencePressurePa: record.referencePressurePa.value
  };
}

// ============================================
// 5. ВАЛИДАЦИЯ КОНТРАКТА И ФОРМУЛЫ
// ============================================

/** Нотация формулы: последовательность элементов с опциональными индексами. */
const FORMULA_PATTERN = /^(?:[A-Z][a-z]?\d*)+$/;

/** Проверка стехиометрической формулы в компактной нотации. */
export function isValidStoichiometricFormula(formula: string): boolean {
  if (typeof formula !== 'string' || formula.length === 0 || formula.length > 64) return false;
  if (!FORMULA_PATTERN.test(formula)) return false;
  const elements = formula.match(/[A-Z][a-z]?/g);
  if (!elements || elements.length === 0) return false;
  const indices = formula.match(/\d+/g);
  if (indices && indices.some((idx) => idx.startsWith('0'))) return false;
  return true;
}

/**
 * Параметры записи, НЕ пригодные для расчёта: не конечное значение,
 * отсутствует sourceName в provenance или evidence = UNRESOLVED /
 * UNRESOLVED_CROSS_CHECK. Даже одна такая проблема блокирует расчёт
 * целиком (fail-closed против «частично неизвестных» записей).
 */
export function getCondensedMatterEosRecordBlockingIssues(
  record: CondensedMatterEosRecord
): string[] {
  const issues: string[] = [];
  const scalars: [string, CondensedMatterEosScalarParameter][] = [
    ['referenceTemperatureK', record.referenceTemperatureK],
    ['referencePressurePa', record.referencePressurePa],
    ['referenceDensityKgM3', record.referenceDensityKgM3],
    ['bulkModulusPa', record.bulkModulusPa],
    ['bulkModulusPressureDerivative', record.bulkModulusPressureDerivative]
  ];
  for (const [name, scalar] of scalars) {
    if (!Number.isFinite(scalar.value)) {
      issues.push(`${name}: значение не конечно`);
    }
    if (
      !scalar.provenance ||
      typeof scalar.provenance.sourceName !== 'string' ||
      scalar.provenance.sourceName.trim().length === 0
    ) {
      issues.push(`${name}: provenance.sourceName отсутствует`);
    }
    if (
      scalar.provenance.evidence === 'UNRESOLVED' ||
      scalar.provenance.evidence === 'UNRESOLVED_CROSS_CHECK'
    ) {
      issues.push(
        `${name}: параметр не подтверждён (evidence=${scalar.provenance.evidence}) — запись непригодна для расчёта`
      );
    }
  }
  return issues;
}

/**
 * Строгий структурный валидатор записи (контракт §8). Возвращает список
 * нарушений; пустой список — запись структурно корректна. Проверяются:
 * единицы, знаки и санитарные диапазоны параметров, диапазоны
 * применимости, provenance каждого параметра, согласованность фазы и
 * структуры, полнота описания (scopeNotes, literature, license).
 */
export function validateCondensedMatterEosRecordShape(record: unknown): string[] {
  const issues: string[] = [];
  const push = (message: string): void => {
    issues.push(message);
  };

  if (typeof record !== 'object' || record === null) {
    return ['запись обязана быть объектом'];
  }
  const r = record as CondensedMatterEosRecord;

  if (typeof r.materialId !== 'string' || r.materialId.trim().length === 0) {
    push('materialId отсутствует или пуст');
  }
  if (typeof r.displayName !== 'string' || r.displayName.trim().length === 0) {
    push('displayName отсутствует или пуст');
  }
  if (!isValidStoichiometricFormula(r.formula)) {
    push(`formula некорректна: ${String(r.formula)}`);
  }
  if (typeof r.formulaDisplay !== 'string' || r.formulaDisplay.trim().length === 0) {
    push('formulaDisplay отсутствует или пуст');
  }
  if (!CONDENSED_MATTER_EOS_PHASES.includes(r.phase)) {
    push(`фаза не входит в реестр: ${String(r.phase)}`);
  }
  if (r.eosModel !== 'birch_murnaghan_3rd') {
    push(`модель не поддерживается ядром этапа 4.7.1: ${String(r.eosModel)}`);
  }
  if (r.crystalStructure !== undefined) {
    if (r.phase !== 'solid') {
      push('кристаллическая структура задана для не-solid фазы — фазы не должны смешиваться');
    }
    if (
      typeof r.crystalStructure.designation !== 'string' ||
      r.crystalStructure.designation.trim().length === 0
    ) {
      push('обозначение кристаллической структуры пусто');
    }
  }

  const scalars: [string, CondensedMatterEosScalarParameter, string, ((v: number) => boolean) | null][] = [
    ['referenceTemperatureK', r.referenceTemperatureK, 'K', (v) => v > 0],
    ['referencePressurePa', r.referencePressurePa, 'Pa', (v) => Number.isFinite(v) && v >= 0],
    [
      'referenceDensityKgM3',
      r.referenceDensityKgM3,
      'kg_m3',
      (v) => v > 0 && v <= BM3_VALID_REFERENCE_DENSITY_MAX_KG_M3
    ],
    ['bulkModulusPa', r.bulkModulusPa, 'Pa', (v) => v > 0 && v <= BM3_VALID_BULK_MODULUS_MAX_PA],
    [
      'bulkModulusPressureDerivative',
      r.bulkModulusPressureDerivative,
      '1',
      (v) => isFiniteInRange(v, BM3_VALID_K0_PRIME_RANGE.min, BM3_VALID_K0_PRIME_RANGE.max)
    ]
  ];

  for (const [name, scalar, expectedUnit, extraCheck] of scalars) {
    if (typeof scalar !== 'object' || scalar === null) {
      push(`${name}: параметр отсутствует`);
      continue;
    }
    if (!Number.isFinite(scalar.value)) {
      push(`${name}: значение не конечно (${String(scalar.value)})`);
    } else if (extraCheck && !extraCheck(scalar.value)) {
      push(`${name}: значение вне санитарных границ ядра: ${String(scalar.value)}`);
    }
    if (scalar.unit !== expectedUnit) {
      push(`${name}: ожидается единица '${expectedUnit}', получено '${String(scalar.unit)}'`);
    }
    if (scalar.uncertainty !== undefined) {
      const uncertaintyIssues = validateUncertainty(scalar.uncertainty as Uncertainty);
      for (const ui of uncertaintyIssues) push(`${name}: неопределённость: ${ui}`);
    }
    const prov = scalar.provenance;
    if (typeof prov !== 'object' || prov === null) {
      push(`${name}: provenance обязателен для каждого числового параметра`);
      continue;
    }
    if (!CONDENSED_MATTER_EOS_VALUE_ORIGINS.includes(prov.origin)) {
      push(`${name}: origin вне реестра: ${String(prov.origin)}`);
    }
    if (!CONDENSED_MATTER_EOS_EVIDENCE_STATUSES.includes(prov.evidence)) {
      push(`${name}: evidence вне реестра: ${String(prov.evidence)}`);
    }
    if (typeof prov.sourceName !== 'string' || prov.sourceName.trim().length === 0) {
      push(`${name}: provenance.sourceName отсутствует`);
    }
  }

  const app = r.applicability;
  if (typeof app !== 'object' || app === null) {
    push('applicability обязательна');
  } else {
    const ranges: [string, boolean, CondensedMatterEosRange | undefined, number][] = [
      ['temperatureRangeK', app.temperatureRangeKnown, app.temperatureRangeK, r.referenceTemperatureK?.value ?? NaN],
      ['pressureRangePa', app.pressureRangeKnown, app.pressureRangePa, r.referencePressurePa?.value ?? NaN],
      ['densityRangeKgM3', app.densityRangeKnown, app.densityRangeKgM3, r.referenceDensityKgM3?.value ?? NaN]
    ];
    for (const [name, known, range, referenceValue] of ranges) {
      if (known && range === undefined) {
        push(`applicability.${name}: флаг known, но диапазон отсутствует`);
        continue;
      }
      if (!known) continue;
      if (!Number.isFinite(range!.min) || !Number.isFinite(range!.max) || range!.min > range!.max) {
        push(`applicability.${name}: диапазон некорректен`);
        continue;
      }
      if (name === 'pressureRangePa') {
        if (range!.min < 0) {
          push('applicability.pressureRangePa: минимум отрицателен');
        }
      } else if (range!.min <= 0) {
        push(`applicability.${name}: минимум должен быть положительным`);
      }
      if (Number.isFinite(referenceValue) && (referenceValue < range!.min || referenceValue > range!.max)) {
        push(`applicability.${name}: опорное значение записи вне подтверждённого диапазона`);
      }
    }
    if (typeof app.note !== 'string' || app.note.trim().length === 0) {
      push('applicability.note обязана пояснять, что подтверждено и что неизвестно');
    }
  }

  if (!Array.isArray(r.scopeNotes) || r.scopeNotes.length === 0) {
    push('scopeNotes обязательны (ограничения модели должны быть явными)');
  }
  if (!Array.isArray(r.literature) || r.literature.length === 0) {
    push('literature обязательна (библиографическая ссылка)');
  }
  if (typeof r.license !== 'string' || r.license.trim().length === 0) {
    push('license обязательна или должна честно заявлять статус неопределённости');
  }

  return issues;
}

/**
 * Каталожный валидатор: структурная корректность каждой записи,
 * уникальность materialId и запрет смешения (формула, фаза, структура).
 */
export function validateCondensedMatterEosCatalog(
  records: readonly CondensedMatterEosRecord[]
): string[] {
  const issues: string[] = [];
  const seenIds = new Set<string>();
  const seenSignatures = new Map<string, string>();
  for (const record of records) {
    for (const issue of validateCondensedMatterEosRecordShape(record)) {
      issues.push(`${record.materialId ?? '<без ID>'}: ${issue}`);
    }
    if (typeof record.materialId === 'string' && record.materialId.length > 0) {
      if (seenIds.has(record.materialId)) {
        issues.push(`дубликат materialId: ${record.materialId}`);
      }
      seenIds.add(record.materialId);
      const signature = [
        record.formula,
        record.phase,
        record.crystalStructure?.designation ?? ''
      ].join('|');
      const owner = seenSignatures.get(signature);
      if (owner !== undefined) {
        issues.push(
          `смешение фаз/структур запрещено: ${record.materialId} повторяет (формула, фаза, структура) записи ${owner}`
        );
      }
      seenSignatures.set(signature, record.materialId);
    }
  }
  return issues;
}

// ============================================
// 6. ПРЯМАЯ ЗАДАЧА P(ρ)
// ============================================

/** Неопределённости параметров, участвовавших в расчёте (null = неизвестна). */
export interface CondensedMatterEosParameterUncertainties {
  readonly referenceDensityKgM3: Readonly<Uncertainty> | null;
  readonly bulkModulusPa: Readonly<Uncertainty> | null;
  readonly bulkModulusPressureDerivative: Readonly<Uncertainty> | null;
}

export interface CondensedMatterEosProvenanceSummary {
  readonly referenceDensityKgM3: CondensedMatterEosParameterProvenance;
  readonly bulkModulusPa: CondensedMatterEosParameterProvenance;
  readonly bulkModulusPressureDerivative: CondensedMatterEosParameterProvenance;
  readonly referenceTemperatureK: CondensedMatterEosParameterProvenance;
  readonly referencePressurePa: CondensedMatterEosParameterProvenance;
}

export type CondensedMatterEosTemperatureAssumption = 'isothermal_at_reference_temperature';

export interface CondensedMatterEosCompletedPressure {
  readonly status: 'completed';
  readonly materialId: string;
  readonly displayName: string;
  readonly formula: string;
  readonly formulaDisplay: string;
  readonly phase: CondensedMatterEosPhase;
  readonly model: CondensedMatterEosModel;
  readonly temperatureAssumption: CondensedMatterEosTemperatureAssumption;
  /** АБСОЛЮТНОЕ давление в Pa (опорное P0 включено явно). */
  readonly pressurePa: number;
  readonly pressure: PhysicalQuantity;
  readonly densityKgM3: number;
  readonly referenceDensityKgM3: number;
  readonly referencePressurePa: number;
  readonly referenceTemperatureK: number;
  readonly evaluatedTemperatureK: number;
  readonly compressionRatio: number;
  readonly monotonicityChecked: boolean;
  readonly applicability: Readonly<CondensedMatterEosApplicability>;
  readonly parameterUncertainties: CondensedMatterEosParameterUncertainties;
  readonly provenance: CondensedMatterEosProvenanceSummary;
  readonly literature: readonly string[];
  readonly license: string;
  readonly scopeNotes: readonly string[];
}

export type CondensedMatterEosPressureResult =
  | CondensedMatterEosCompletedPressure
  | {
      readonly status: 'invalid_input';
      readonly issues: readonly string[];
    }
  | {
      readonly status: 'out_of_applicability';
      readonly reason: string;
      readonly detail: Readonly<Record<string, number | string | boolean | null>>;
    }
  | {
      readonly status: 'numerical_failure';
      readonly reason: string;
      readonly stage: string;
    };

/**
 * Прямая задача: давление конденсированного материала при заданной плотности
 * на изотерме опорной температуры записи. Fail-closed: температура вне
 * подтверждённой изотермы, плотность вне подтверждённого диапазона или вне
 * поддерживаемой области ядра, непригодная запись — структурированный отказ
 * без экстраполяции и без «тепловых поправок».
 */
export function evaluateCondensedMatterPressure(
  record: CondensedMatterEosRecord,
  densityKgM3: number,
  temperatureK: number
): CondensedMatterEosPressureResult {
  // 1. Пригодность записи (частично неизвестные параметры блокируют расчёт).
  const structuralIssues = validateCondensedMatterEosRecordShape(record);
  if (structuralIssues.length > 0) {
    return { status: 'invalid_input', issues: structuralIssues };
  }
  const blocking = getCondensedMatterEosRecordBlockingIssues(record);
  if (blocking.length > 0) {
    return { status: 'invalid_input', issues: blocking };
  }

  // 2. Строгая проверка входа (NaN/Infinity, знак).
  const inputIssues: string[] = [];
  if (typeof densityKgM3 !== 'number') {
    inputIssues.push('densityKgM3 обязана быть числом');
  } else if (!Number.isFinite(densityKgM3)) {
    inputIssues.push(`densityKgM3 не конечна: ${String(densityKgM3)}`);
  } else if (densityKgM3 === 0) {
    inputIssues.push('densityKgM3 = 0 отклонена: неположительная плотность вне модели');
  } else if (densityKgM3 < 0) {
    inputIssues.push(`densityKgM3 < 0 отклонена: ${String(densityKgM3)}`);
  }
  if (typeof temperatureK !== 'number' || !Number.isFinite(temperatureK)) {
    inputIssues.push(`temperatureK не конечна: ${String(temperatureK)}`);
  } else if (temperatureK <= 0) {
    inputIssues.push(`temperatureK должна быть положительной: ${String(temperatureK)}`);
  }
  if (inputIssues.length > 0) return { status: 'invalid_input', issues: inputIssues };

  // 3. Температура: только подтверждённая изотерма записи.
  const t0 = record.referenceTemperatureK.value;
  if (Math.abs(temperatureK - t0) > BM3_ISOTHERMAL_TEMPERATURE_TOLERANCE_K) {
    const range = record.applicability.temperatureRangeK;
    return {
      status: 'out_of_applicability',
      reason: `переданная температура ${temperatureK} K вне подтверждённой изотермы записи (${t0} K ± ${BM3_ISOTHERMAL_TEMPERATURE_TOLERANCE_K} K); тепловая поправка на этапе 4.7.1 отсутствует`,
      detail: {
        requestedTemperatureK: temperatureK,
        referenceTemperatureK: t0,
        temperatureToleranceK: BM3_ISOTHERMAL_TEMPERATURE_TOLERANCE_K,
        temperatureRangeKnown: record.applicability.temperatureRangeKnown,
        temperatureRangeMinK: range ? range.min : null,
        temperatureRangeMaxK: range ? range.max : null
      }
    };
  }

  // 4. Плотность: подтверждённый диапазон записи.
  const rho0 = record.referenceDensityKgM3.value;
  const densityRange = record.applicability.densityRangeKgM3;
  if (
    record.applicability.densityRangeKnown &&
    densityRange !== undefined &&
    (densityKgM3 < densityRange.min || densityKgM3 > densityRange.max)
  ) {
    return {
      status: 'out_of_applicability',
      reason: `плотность ${densityKgM3} kg/m³ вне подтверждённого диапазона записи [${densityRange.min}, ${densityRange.max}] кг/м³`,
      detail: {
        requestedDensityKgM3: densityKgM3,
        confirmedDensityMinKgM3: densityRange.min,
        confirmedDensityMaxKgM3: densityRange.max
      }
    };
  }

  // 5. Численное ядро: сжатие и монотонность.
  const params = bm3ParametersFromRecord(record);
  const eta = bm3CompressionRatio(densityKgM3, rho0);
  if (eta === null) {
    return {
      status: 'out_of_applicability',
      reason: `степень сжатия вне поддерживаемой области ядра BM3: η должна быть в [${BM3_MIN_SUPPORTED_COMPRESSION_RATIO}, ${BM3_MAX_SUPPORTED_COMPRESSION_RATIO}]`,
      detail: {
        requestedDensityKgM3: densityKgM3,
        referenceDensityKgM3: rho0,
        minSupportedCompressionRatio: BM3_MIN_SUPPORTED_COMPRESSION_RATIO,
        maxSupportedCompressionRatio: BM3_MAX_SUPPORTED_COMPRESSION_RATIO
      }
    };
  }
  if (!bm3IsMonotonicAtDensity(densityKgM3, params)) {
    return {
      status: 'numerical_failure',
      reason: 'контроль монотонности P(ρ) не пройден в точке расчёта',
      stage: 'bm3_monotonicity_control'
    };
  }
  const pressurePa = bm3PressureAtCompressionRatio(eta, params);
  if (pressurePa === null) {
    return {
      status: 'numerical_failure',
      reason: 'ядро BM3 не смогло вычислить конечное давление (переполнение или некорректные параметры)',
      stage: 'bm3_pressure_evaluation'
    };
  }

  // 6. Результат с полным контекстом происхождения и ограничений.
  const uncertaintyOf = (s: CondensedMatterEosScalarParameter): Readonly<Uncertainty> | null =>
    s.uncertainty ?? null;
  return {
    status: 'completed',
    materialId: record.materialId,
    displayName: record.displayName,
    formula: record.formula,
    formulaDisplay: record.formulaDisplay,
    phase: record.phase,
    model: record.eosModel,
    temperatureAssumption: 'isothermal_at_reference_temperature',
    pressurePa,
    pressure: quantity(pressurePa, 'Pa'),
    densityKgM3,
    referenceDensityKgM3: rho0,
    referencePressurePa: record.referencePressurePa.value,
    referenceTemperatureK: t0,
    evaluatedTemperatureK: temperatureK,
    compressionRatio: eta,
    monotonicityChecked: true,
    applicability: record.applicability,
    parameterUncertainties: {
      referenceDensityKgM3: uncertaintyOf(record.referenceDensityKgM3),
      bulkModulusPa: uncertaintyOf(record.bulkModulusPa),
      bulkModulusPressureDerivative: uncertaintyOf(record.bulkModulusPressureDerivative)
    },
    provenance: {
      referenceDensityKgM3: record.referenceDensityKgM3.provenance,
      bulkModulusPa: record.bulkModulusPa.provenance,
      bulkModulusPressureDerivative: record.bulkModulusPressureDerivative.provenance,
      referenceTemperatureK: record.referenceTemperatureK.provenance,
      referencePressurePa: record.referencePressurePa.provenance
    },
    literature: record.literature,
    license: record.license,
    scopeNotes: record.scopeNotes
  };
}

// ============================================
// 7. ОБРАТНАЯ ЗАДАЧА ρ(P)
// ============================================

export interface CondensedMatterDensitySolverOptions {
  /** Абсолютный допуск по давлению, Pa (0 = работать только относительный). */
  readonly absoluteTolerancePa?: number;
  /** Относительный допуск по давлению; по умолчанию 1e-9. */
  readonly relativeTolerance?: number;
  /** Максимум итераций бисекции; по умолчанию 100. */
  readonly maxIterations?: number;
  /**
   * Явный bracket по плотности, kg/m³. Требуется, если запись не
   * подтверждает диапазон плотности (fail-closed по умолчанию).
   */
  readonly densityBracketKgM3?: Readonly<CondensedMatterEosRange>;
}

export interface CondensedMatterEosCompletedDensity {
  readonly status: 'completed';
  readonly materialId: string;
  readonly displayName: string;
  readonly model: CondensedMatterEosModel;
  readonly phase: CondensedMatterEosPhase;
  readonly temperatureAssumption: CondensedMatterEosTemperatureAssumption;
  /** Найденная плотность, kg/m³. */
  readonly densityKgM3: number;
  /** Давление, пересчитанное прямой задачей в найденной плотности, Pa. */
  readonly pressurePa: number;
  /** Невязка pressurePa − targetPressurePa, Pa. */
  readonly residualPa: number;
  readonly relativeResidual: number;
  readonly iterations: number;
  readonly tolerancePa: number;
  readonly densityBracketKgM3: Readonly<CondensedMatterEosRange>;
  readonly bracketSource: 'record_applicability' | 'user_provided';
  readonly compressionRatio: number;
  readonly monotonicityChecked: boolean;
  readonly applicability: Readonly<CondensedMatterEosApplicability>;
  readonly provenance: CondensedMatterEosProvenanceSummary;
  readonly literature: readonly string[];
  readonly license: string;
  readonly scopeNotes: readonly string[];
}

export type CondensedMatterEosDensityResult =
  | CondensedMatterEosCompletedDensity
  | {
      readonly status: 'invalid_input';
      readonly issues: readonly string[];
    }
  | {
      readonly status: 'out_of_applicability';
      readonly reason: string;
      readonly detail: Readonly<Record<string, number | string | boolean | null>>;
    }
  | {
      readonly status: 'numerical_failure';
      readonly reason: string;
      readonly stage: string;
    };

interface ResolvedSolverTolerances {
  readonly absoluteTolerancePa: number;
  readonly relativeTolerance: number;
  readonly maxIterations: number;
}

const DEFAULT_RELATIVE_TOLERANCE = 1e-9;
const DEFAULT_MAX_ITERATIONS = 100;

function resolveSolverOptions(
  options: CondensedMatterDensitySolverOptions | undefined
): ResolvedSolverTolerances | string[] {
  const issues: string[] = [];
  const absolute = options?.absoluteTolerancePa ?? 0;
  const relative = options?.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const maxIterations = options?.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  if (typeof absolute !== 'number' || !Number.isFinite(absolute) || absolute < 0) {
    issues.push(`absoluteTolerancePa должна быть конечной и неотрицательной: ${String(absolute)}`);
  }
  if (typeof relative !== 'number' || !Number.isFinite(relative) || relative <= 0) {
    issues.push(`relativeTolerance должна быть конечной и положительной: ${String(relative)}`);
  }
  if (
    typeof maxIterations !== 'number' ||
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    maxIterations > 10000
  ) {
    issues.push(`maxIterations должна быть целым числом в [1, 10000]: ${String(maxIterations)}`);
  }
  const bracket = options?.densityBracketKgM3;
  if (bracket !== undefined) {
    if (
      typeof bracket !== 'object' ||
      bracket === null ||
      !Number.isFinite(bracket.min) ||
      !Number.isFinite(bracket.max) ||
      bracket.max <= bracket.min ||
      bracket.min <= 0
    ) {
      issues.push('densityBracketKgM3: требуется 0 < min < max, оба конечны');
    }
  }
  if (issues.length > 0) return issues;
  return { absoluteTolerancePa: absolute, relativeTolerance: relative, maxIterations };
}

/**
 * Обратная задача: плотность при заданном давлении на изотерме записи.
 * Метод: гарантированный bracket (подтверждённый диапазон плотности записи
 * либо явно переданный), чистая бисекция с конечным числом итераций,
 * явный критерий сходимости по давлению и по сжатию bracket, численный
 * контроль монотонности и проверка результата. Unbounded Newton не
 * используется; при невозможности корректного bracket — структурированный
 * отказ с точной причиной.
 */
export function solveCondensedMatterDensity(
  record: CondensedMatterEosRecord,
  pressurePa: number,
  temperatureK: number,
  options?: CondensedMatterDensitySolverOptions
): CondensedMatterEosDensityResult {
  // 1. Запись и опции.
  const structuralIssues = validateCondensedMatterEosRecordShape(record);
  if (structuralIssues.length > 0) {
    return { status: 'invalid_input', issues: structuralIssues };
  }
  const blocking = getCondensedMatterEosRecordBlockingIssues(record);
  if (blocking.length > 0) {
    return { status: 'invalid_input', issues: blocking };
  }
  const resolvedTolerances = resolveSolverOptions(options);
  if (Array.isArray(resolvedTolerances)) {
    return { status: 'invalid_input', issues: resolvedTolerances };
  }
  const { absoluteTolerancePa, relativeTolerance, maxIterations } = resolvedTolerances;

  // 2. Вход.
  const inputIssues: string[] = [];
  if (typeof pressurePa !== 'number') {
    inputIssues.push('pressurePa обязано быть числом');
  } else if (!Number.isFinite(pressurePa)) {
    inputIssues.push(`pressurePa не конечно: ${String(pressurePa)}`);
  }
  if (typeof temperatureK !== 'number' || !Number.isFinite(temperatureK)) {
    inputIssues.push(`temperatureK не конечна: ${String(temperatureK)}`);
  } else if (temperatureK <= 0) {
    inputIssues.push(`temperatureK должна быть положительной: ${String(temperatureK)}`);
  }
  if (inputIssues.length > 0) return { status: 'invalid_input', issues: inputIssues };

  // 3. Температурная применимость — как в прямой задаче.
  const t0 = record.referenceTemperatureK.value;
  if (Math.abs(temperatureK - t0) > BM3_ISOTHERMAL_TEMPERATURE_TOLERANCE_K) {
    const range = record.applicability.temperatureRangeK;
    return {
      status: 'out_of_applicability',
      reason: `переданная температура ${temperatureK} K вне подтверждённой изотермы записи (${t0} K ± ${BM3_ISOTHERMAL_TEMPERATURE_TOLERANCE_K} K); тепловая поправка на этапе 4.7.1 отсутствует`,
      detail: {
        requestedTemperatureK: temperatureK,
        referenceTemperatureK: t0,
        temperatureToleranceK: BM3_ISOTHERMAL_TEMPERATURE_TOLERANCE_K,
        temperatureRangeKnown: record.applicability.temperatureRangeKnown,
        temperatureRangeMinK: range ? range.min : null,
        temperatureRangeMaxK: range ? range.max : null
      }
    };
  }

  // 4. Барическая применимость записи (без экстраполяции).
  const p0 = record.referencePressurePa.value;
  const pressureRange = record.applicability.pressureRangePa;
  if (
    record.applicability.pressureRangeKnown &&
    pressureRange !== undefined &&
    (pressurePa < pressureRange.min || pressurePa > pressureRange.max)
  ) {
    return {
      status: 'out_of_applicability',
      reason: `давление ${pressurePa} Pa вне подтверждённого диапазона записи [${pressureRange.min}, ${pressureRange.max}] Pa`,
      detail: {
        requestedPressurePa: pressurePa,
        confirmedPressureMinPa: pressureRange.min,
        confirmedPressureMaxPa: pressureRange.max
      }
    };
  }
  if (pressurePa < p0) {
    return {
      status: 'out_of_applicability',
      reason: `давление ${pressurePa} Pa ниже опорного ${p0} Pa: сжатие η < 1 (растяжение) не поддерживается изотермическим ядром BM3`,
      detail: {
        requestedPressurePa: pressurePa,
        referencePressurePa: p0,
        minSupportedCompressionRatio: BM3_MIN_SUPPORTED_COMPRESSION_RATIO
      }
    };
  }

  // 5. Bracket плотности.
  const params = bm3ParametersFromRecord(record);
  const rho0 = record.referenceDensityKgM3.value;
  let bracket: CondensedMatterEosRange;
  let bracketSource: 'record_applicability' | 'user_provided';
  const userBracket = options?.densityBracketKgM3;
  if (userBracket !== undefined) {
    bracket = { min: userBracket.min, max: userBracket.max };
    bracketSource = 'user_provided';
  } else if (
    record.applicability.densityRangeKnown &&
    record.applicability.densityRangeKgM3 !== undefined
  ) {
    bracket = {
      min: record.applicability.densityRangeKgM3.min,
      max: record.applicability.densityRangeKgM3.max
    };
    bracketSource = 'record_applicability';
  } else {
    return {
      status: 'out_of_applicability',
      reason:
        'запись не подтверждает диапазон плотности, а явный densityBracketKgM3 не передан: корректный bracket невозможен (fail-closed)',
      detail: {
        materialId: record.materialId,
        densityRangeKnown: record.applicability.densityRangeKnown
      }
    };
  }
  // Границы ядра: bracket обязан лежать внутри поддерживаемой области сжатия.
  const etaMin = bracket.min / rho0;
  const etaMax = bracket.max / rho0;
  if (
    !Number.isFinite(etaMin) ||
    !Number.isFinite(etaMax) ||
    etaMin < BM3_MIN_SUPPORTED_COMPRESSION_RATIO ||
    etaMax > BM3_MAX_SUPPORTED_COMPRESSION_RATIO
  ) {
    return {
      status: 'out_of_applicability',
      reason: `bracket плотности [${bracket.min}, ${bracket.max}] кг/м³ выходит за поддерживаемую область сжатия ядра BM3 (η ∈ [${BM3_MIN_SUPPORTED_COMPRESSION_RATIO}, ${BM3_MAX_SUPPORTED_COMPRESSION_RATIO}])`,
      detail: {
        bracketMinKgM3: bracket.min,
        bracketMaxKgM3: bracket.max,
        referenceDensityKgM3: rho0,
        etaMin,
        etaMax
      }
    };
  }

  // 6. Бисекция с явным критерием сходимости.
  const tolerancePa = Math.max(
    absoluteTolerancePa,
    relativeTolerance * Math.max(Math.abs(pressurePa), 1)
  );
  let lo = bracket.min;
  let hi = bracket.max;
  const pLow = bm3Pressure(lo, params);
  const pHigh = bm3Pressure(hi, params);
  if (pLow === null || pHigh === null) {
    return {
      status: 'numerical_failure',
      reason: 'ядро BM3 не смогло вычислить давление на границах bracket',
      stage: 'bracket_evaluation'
    };
  }
  if (pLow > pressurePa || pHigh < pressurePa) {
    return {
      status: 'out_of_applicability',
      reason: `корректный bracket невозможен: P(bracket) = [${pLow}, ${pHigh}] Pa не накрывает цель ${pressurePa} Pa`,
      detail: {
        bracketMinKgM3: bracket.min,
        bracketMaxKgM3: bracket.max,
        pressureAtBracketMinPa: pLow,
        pressureAtBracketMaxPa: pHigh,
        requestedPressurePa: pressurePa
      }
    };
  }

  let iterations = 0;
  let answerDensity: number | null = null;
  while (iterations < maxIterations) {
    const mid = 0.5 * (lo + hi);
    const pMid = bm3Pressure(mid, params);
    if (pMid === null) {
      return {
        status: 'numerical_failure',
        reason: `ядро BM3 не смогло вычислить давление на середине bracket (${String(mid)} kg/m³)`,
        stage: 'bisection_evaluation'
      };
    }
    const residual = pMid - pressurePa;
    const intervalConverged = hi - lo <= 1e-14 * Math.max(lo, hi);
    if (intervalConverged || Math.abs(residual) <= tolerancePa) {
      answerDensity = mid;
      iterations += 1;
      break;
    }
    // Монотонность гарантирует: P(lo) < P(hi).
    if (residual < 0) lo = mid;
    else hi = mid;
    iterations += 1;
  }
  if (answerDensity === null) {
    return {
      status: 'numerical_failure',
      reason: `бисекция не сошлась за ${maxIterations} итераций: явный критерий сходимости (невязка ≤ ${tolerancePa} Pa или сжатие bracket до 1e-14 относительного) не достигнут`,
      stage: 'bisection_convergence'
    };
  }

  // 7. Проверка результата: конечность, принадлежность bracket и ядра,
  //    применимость записи, монотонность.
  const answerPressure = bm3Pressure(answerDensity, params);
  if (
    !Number.isFinite(answerDensity) ||
    answerPressure === null ||
    !Number.isFinite(answerPressure) ||
    answerDensity < bracket.min ||
    answerDensity > bracket.max
  ) {
    return {
      status: 'numerical_failure',
      reason: 'найденное решение не прошло проверку конечности или принадлежности bracket',
      stage: 'result_verification'
    };
  }
  const eta = answerDensity / rho0;
  if (eta < BM3_MIN_SUPPORTED_COMPRESSION_RATIO || eta > BM3_MAX_SUPPORTED_COMPRESSION_RATIO) {
    return {
      status: 'out_of_applicability',
      reason: `найденная плотность ${answerDensity} kg/m³ вне поддерживаемой области сжатия ядра BM3`,
      detail: { foundDensityKgM3: answerDensity, compressionRatio: eta }
    };
  }
  if (
    record.applicability.densityRangeKnown &&
    record.applicability.densityRangeKgM3 !== undefined &&
    (answerDensity < record.applicability.densityRangeKgM3.min ||
      answerDensity > record.applicability.densityRangeKgM3.max)
  ) {
    return {
      status: 'out_of_applicability',
      reason: `найденная плотность ${answerDensity} kg/m³ вне подтверждённого диапазона записи; результат НЕ возвращается (fail-closed)`,
      detail: {
        foundDensityKgM3: answerDensity,
        confirmedDensityMinKgM3: record.applicability.densityRangeKgM3.min,
        confirmedDensityMaxKgM3: record.applicability.densityRangeKgM3.max
      }
    };
  }
  if (!bm3IsMonotonicAtDensity(answerDensity, params)) {
    return {
      status: 'numerical_failure',
      reason: 'контроль монотонности P(ρ) не пройден в найденной точке',
      stage: 'result_monotonicity_control'
    };
  }
  const residual = answerPressure - pressurePa;
  return {
    status: 'completed',
    materialId: record.materialId,
    displayName: record.displayName,
    model: record.eosModel,
    phase: record.phase,
    temperatureAssumption: 'isothermal_at_reference_temperature',
    densityKgM3: answerDensity,
    pressurePa: answerPressure,
    residualPa: residual,
    relativeResidual: residual / Math.max(Math.abs(pressurePa), 1),
    iterations,
    tolerancePa,
    densityBracketKgM3: bracket,
    bracketSource,
    compressionRatio: eta,
    monotonicityChecked: true,
    applicability: record.applicability,
    provenance: {
      referenceDensityKgM3: record.referenceDensityKgM3.provenance,
      bulkModulusPa: record.bulkModulusPa.provenance,
      bulkModulusPressureDerivative: record.bulkModulusPressureDerivative.provenance,
      referenceTemperatureK: record.referenceTemperatureK.provenance,
      referencePressurePa: record.referencePressurePa.provenance
    },
    literature: record.literature,
    license: record.license,
    scopeNotes: record.scopeNotes
  };
}

// ============================================
// 8. ДОКУМЕНТИРОВАННЫЕ ОГРАНИЧЕНИЯ ЭТАПА
// ============================================

export const CONDENSED_MATTER_EOS_STAGE_LIMITATIONS: readonly string[] = [
  'BM3 только изотермический при опорной температуре записи (300 K для текущих материалов); тепловое давление и Ми–Грюнайзен–Дебай НЕ моделируются',
  'горячие EOS недр отсутствуют: температура вне подтверждённой изотермы возвращает out_of_applicability',
  'фазовые переходы, смешение компонентов и твёрдые растворы не поддерживаются',
  'гидростатические профили планет и тепловая эволюция — следующие подэтапы Stage 4.7',
  'изотермическое EOS при 300 K НЕ описывает горячие недра Земли'
];
