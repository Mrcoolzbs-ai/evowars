// ============================================
// GEOCHEMICAL FLUX CONTEXT - структурная атрибуция геохимической записи потока
// ============================================
//
// Stage 4.9a.1 (корректирующая ревизия геохимического фундамента).
//
// ПРОБЛЕМА, КОТОРУЮ РЕШАЕТ МОДУЛЬ: до этой ревизии исполнение
// геохимического процесса сохраняло в записи FluxRecord только
// количество и текстовую заметку (note). Атрибуция геохимического
// события (processId, provenance скорости, единицы, период
// интегрирования, внешняя граница, допущения) существовала только
// внутри длинной строки — машиночитаемо она НЕ сохранялась.
//
// РЕШЕНИЕ: аддитивный опциональный контейнер `geochemical` в записи
// потока (FluxRecord, Core/fluxLedger.ts). Это НЕ второй FluxLedger
// и НЕ новая система учёта: контейнер живёт ВНУТРИ существующей
// записи существующего журнала и однозначно связан с fluxId самим
// фактом вложенности. Журналы Резервуаров/реакций не дублируются.
//
// Сериализация: контейнер — plain-JSON структура, проходит полный
// round-trip (запись → сериализация → загрузка → валидация → аудит).
//
// Обратная совместимость: поле опционально. Старые записи потоков
// (до Stage 4.9a.1) поля не имеют: это честное «геохимическая
// атрибуция недоступна», а не «пустой контекст». Provenance старых
// записей НЕ синтезируется задним числом; миграция сохранений
// 1.6 → 1.7 записи не переписывает (см. Core/migrations.ts).
//
// Валидатор — fail-closed по форме: некорректный контекст (не объект,
// неверная версия схемы, непустой processId обязателен, provenance
// обязан нести идентифицированный источник) — это диагностические
// ошибки, а не «сойдёт и так».

import type { DataProvenance } from './scientificValue';
import type { GeochemicalProcessType, GeochemicalProcessMechanism } from './geochemicalFluxes';

/** Версия схемы контейнера атрибуции (semver формы контекста). */
export const GEOCHEMICAL_FLUX_CONTEXT_SCHEMA_VERSION = '1.0.0';

/** Внешняя единица скорости, сохранённая в контексте (mol·m⁻²·yr⁻¹). */
export const CONTEXT_RATE_UNIT_EXTERNAL = 'mol_m2_yr';

/** Внутренняя единица скорости ядра, сохранённая в контексте (mol·m⁻²·s⁻¹). */
export const CONTEXT_RATE_UNIT_INTERNAL = 'mol_m2_s';

/**
 * Машиночитаемая структурная атрибуция геохимической записи потока.
 * Все поля сериализуемы (plain JSON, без Map/Set/функций).
 */
export interface FluxGeochemicalContext {
  /** Версия схемы самого контейнера. */
  readonly contextSchemaVersion: typeof GEOCHEMICAL_FLUX_CONTEXT_SCHEMA_VERSION;
  /** Стабильный идентификатор геохимического процесса каталога. */
  readonly processId: string;
  /** Класс геохимической механики процесса. */
  readonly processType: GeochemicalProcessType;
  /** Механизм исполнения: transport | reaction | coupled. */
  readonly mechanism: GeochemicalProcessMechanism;
  /** Перенесённый вид (speciesId из SpeciesCatalog на момент исполнения). */
  readonly speciesId: string;
  /** Основание инвентаря, на котором исполнялся поток (столбовые mol/m²). */
  readonly basis: 'column_amount';
  /** Внешняя геохимическая единица скорости. */
  readonly rateUnitExternal: typeof CONTEXT_RATE_UNIT_EXTERNAL;
  /** Внутренняя единица скорости ядра. */
  readonly rateUnitInternal: typeof CONTEXT_RATE_UNIT_INTERNAL;
  /** Скорость внешней конвенции, mol·m⁻²·yr⁻¹ (известная скорость). */
  readonly molPerM2PerYear: number;
  /**
   * ПРОИСХОЖДЕНИЕ использованной скорости (DataProvenance с
   * идентифицированным источником). Числовая скорость без provenance
   * в исполнение не допускается, поэтому поле обязательно.
   */
  readonly rateProvenance: DataProvenance;
  /** Период интегрирования, с (то же значение, что ушло в integrateSubstanceRate). */
  readonly integrationDurationS: number;
  /**
   * Внешняя граница для external_input/external_output (id и физическое
   * обоснование пересечения). Для внутреннего переноса — null
   * (отсутствие границы — честный факт, а не пропуск заполнения).
   */
  readonly boundary: { readonly id: string; readonly physicalJustification: string } | null;
  /**
   * Использованные при исполнении допущения (непустой список обязан
   * формировать исполнитель; «совсем без допущений» — это пустой
   * массив, а не отсутствующий вопрос).
   */
  readonly assumptions: readonly string[];
  /** Диапазон применимости описания процесса (null — не задан). */
  readonly applicability: string | null;
  /** Условия выполнения процесса (null — не заданы). */
  readonly conditions: string | null;
}

/** Runtime-проверка формы контекста (данные могут прийти из JSON сохранения). */
export function validateFluxGeochemicalContext(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['геохимический контекст должен быть объектом, получено ' + (value === null ? 'null' : typeof value)];
  }
  const c = value as Record<string, unknown>;
  if (c.contextSchemaVersion !== GEOCHEMICAL_FLUX_CONTEXT_SCHEMA_VERSION) {
    errors.push(`contextSchemaVersion должен быть «${GEOCHEMICAL_FLUX_CONTEXT_SCHEMA_VERSION}», получено «${String(c.contextSchemaVersion)}»`);
  }
  for (const key of ['processId', 'processType', 'mechanism', 'speciesId'] as const) {
    if (typeof c[key] !== 'string' || (c[key] as string).trim() === '') {
      errors.push(`«${key}» должен быть непустой строкой`);
    }
  }
  if (c.basis !== 'column_amount') {
    errors.push(`basis контекста должен быть «column_amount» (геохимическая конвенция mol/m²), получено «${String(c.basis)}»`);
  }
  if (c.rateUnitExternal !== CONTEXT_RATE_UNIT_EXTERNAL) {
    errors.push(`rateUnitExternal должен быть «${CONTEXT_RATE_UNIT_EXTERNAL}», получено «${String(c.rateUnitExternal)}»`);
  }
  if (c.rateUnitInternal !== CONTEXT_RATE_UNIT_INTERNAL) {
    errors.push(`rateUnitInternal должен быть «${CONTEXT_RATE_UNIT_INTERNAL}», получено «${String(c.rateUnitInternal)}»`);
  }
  if (typeof c.molPerM2PerYear !== 'number' || !Number.isFinite(c.molPerM2PerYear) || c.molPerM2PerYear <= 0) {
    errors.push(`molPerM2PerYear контекста должен быть конечным положительным числом, получено ${String(c.molPerM2PerYear)}`);
  }
  // Provenance обязателен и обязан идентифицировать источник:
  // синтезировать происхождение задним числом запрещено, отсутствие — диагностическая ошибка.
  if (typeof c.rateProvenance !== 'object' || c.rateProvenance === null) {
    errors.push('rateProvenance обязателен (DataProvenance с идентифицированным источником)');
  } else {
    const p = c.rateProvenance as Record<string, unknown>;
    const identified =
      (typeof p.sourceName === 'string' && p.sourceName.trim() !== '') ||
      (typeof p.sourceId === 'string' && p.sourceId.trim() !== '') ||
      (typeof p.datasetId === 'string' && p.datasetId.trim() !== '') ||
      (typeof p.reference === 'string' && p.reference.trim() !== '');
    if (!identified) {
      errors.push('rateProvenance должен идентифицировать источник (sourceName, sourceId, datasetId или reference)');
    }
  }
  if (typeof c.integrationDurationS !== 'number' || !Number.isFinite(c.integrationDurationS) || c.integrationDurationS <= 0) {
    errors.push(`integrationDurationS должен быть конечным положительным числом (период интегрирования, с), получено ${String(c.integrationDurationS)}`);
  }
  // Граница: null разрешён (внутренний перенос), объект — с id и обоснованием.
  if (c.boundary !== null) {
    if (typeof c.boundary !== 'object' || Array.isArray(c.boundary)) {
      errors.push('boundary должен быть объектом {id, physicalJustification} или null (внутренний перенос)');
    } else {
      const b = c.boundary as Record<string, unknown>;
      if (typeof b.id !== 'string' || b.id.trim() === '') {
        errors.push('boundary.id должен быть непустой строкой');
      }
      if (typeof b.physicalJustification !== 'string' || b.physicalJustification.trim() === '') {
        errors.push('boundary.physicalJustification должно быть непустой строкой (физическое обоснование пересечения границы)');
      }
    }
  }
  if (!Array.isArray(c.assumptions)) {
    errors.push('assumptions должен быть массивом строк (использованные допущения)');
  } else {
    for (let i = 0; i < c.assumptions.length; i++) {
      const item = c.assumptions[i];
      if (typeof item !== 'string' || item.trim() === '') {
        errors.push(`assumptions[${i}] должен быть непустой строкой`);
      }
    }
  }
  for (const key of ['applicability', 'conditions'] as const) {
    const v = c[key];
    if (v !== null && typeof v !== 'string') {
      errors.push(`«${key}» должен быть строкой или null, получено ${typeof v}`);
    }
  }
  return errors;
}
