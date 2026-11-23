// ============================================
// GEOCHEMICAL KINETICS — контракты скоростей процессов и планировщик
// extent из скорости × Δt (Stage 4.9g)
// ============================================
//
// ЧТО ЭТО:
// - типизированные контракты кинетических записей ГЕОХИМИЧЕСКИХ
//   процессов (отдельно от реакционных кинетических записей Stage
//   4.5.1: kinetics.ts описывает k(T) химических реакций в
//   молекулярных единицах, здесь — скорости потоков/превращений
//   геохимических процессов в столбовых единицах mol·m⁻²·yr⁻¹);
// - планировщик extent: extent(mol/m²) = rate(mol·m⁻²·yr⁻¹) × Δt(year),
//   с обязательной цепочкой provenance (источник скорости + источник
//   длительности) и fail-closed валидацией.
//
// ЧТО ЭТО НЕ ЭТО:
// - это НЕ второй реакционный движок, НЕ второй карбонатный решатель и
//   НЕ второй журнал: планированные extent-ы применяются ТОЛЬКО через
//   существующие production-исполнители (executeGeochemicalProcess
//   Stage 4.9a, executeCO2PhaseExchange Stage 4.9e,
//   executeCarbonateMineralCycle Stage 4.9f, coupled-исполнитель 4.9d);
// - числовых физических скоростей здесь НЕТ: production-каталог
//   (geochemicalProcessCatalog.ts) держит rate: unknown для всех
//   процессов, и этот модуль не «достраивает» неизвестность числом.
//   Известная скорость может появиться ТОЛЬКО как запись с
//   идентифицированным первоисточником (DOI/таблица публикации) и ЯВНОЙ
//   областью применимости. Синтетические скорости допустимы только в
//   тестовых фикстурах с явной маркировкой (synthetic test fixture) и
//   НЕ попадают в production-каталог;
// - преобразование секунд симуляции в годы НЕ выполняется неявно:
//   длительность в годах — ЯВНЫЙ вход с provenance; длительность в
//   секундах пересчитывается ТОЛЬКО через определённый юлианский год
//   (GEOCHEMICAL_YEAR_S из geochemicalFluxes.ts, 365.25 × 86400 с).
//
// Интеграция со временем (контракты Stage 4.2/4.5):
// - Δt макро-шага задаёт вызывающая сторона (тот же договор, что у
//   Scheduler: «НЕТ универсального dt»); WorldClock/SimulationClock
//   продвигает вызывающая сторона, модуль время не трогает;
// - процессы с rate: unknown в план extent НЕ попадают и числового
//   вклада не создают (рядом остаётся честная причина из каталога);
// - соединение планировщика скоростей с исполнителями НЕ создаёт
//   двойного применения: каждая транзакция имеет свой уникальный
//   transactionId/fluxId, применённый ровно один раз (анти-replay ядра).

import type { DataProvenance } from './scientificValue';
import { GEOCHEMICAL_YEAR_S } from './geochemicalFluxes';

// ============================================
// 1. КОНТРАКТЫ СКОРОСТИ ПРОЦЕССА
// ============================================

/**
 * Единица скорости геохимического процесса: столбовая скорость
 * mol·m⁻²·год⁻¹ (та же внешняя конвенция, что у каталога процессов
 * Stage 4.9a: GEOCHEMICAL_RATE_UNIT = 'mol_m2_yr').
 */
export const GEOCHEMICAL_KINETIC_RATE_UNIT = 'mol_m2_yr';

/** Статус скорости процесса. */
export type GeochemicalKineticRateStatus = 'known' | 'unknown';

/**
 * Кинетическая запись геохимического процесса.
 *
 * Статус 'known' требует: конечную положительную скорость, источник
 * (идентифицированный DataProvenance) и ЯВНУю область применимости.
 * Статус 'unknown' требует конкретную причину и ЗАПРЕЩАЕТ числовые
 * поля: неизвестная скорость не превращается в число (fail-closed,
 * как в каталоге процессов Stage 4.9a).
 *
 * Классы законов скорости — расширяемый набор; этот срез исполняет
 * только 'constant_zero_order' (скорость постоянна на интервале
 * интегрирования macro-шага). Более сложные законы (Ω-зависимые
 * эмпирические законы растворения/осаждения и т.п.) добавляются
 * ТОЛЬКО вместе с первоисточниками параметров; до этого — unknown.
 */
export type GeochemicalKineticRateClass = 'constant_zero_order';

export interface GeochemicalKineticRateRecord {
  /** Стабильный processId из каталога геохимических процессов. */
  readonly processId: string;
  /** Класс закона скорости на интервале. */
  readonly rateClass: GeochemicalKineticRateClass;
  readonly status: GeochemicalKineticRateStatus;
  /** Скорость, mol·m⁻²·yr⁻¹ (только status 'known'; конечная > 0). */
  readonly rateMolPerM2PerYear?: number;
  /** Источник скорости (только status 'known'). */
  readonly rateProvenance?: DataProvenance;
  /** Опубликованная область применимости источника (только 'known'). */
  readonly applicability?: string;
  /** Опубликованная неопределённость параметров, если она есть. */
  readonly uncertainty?: string | null;
  /** Конкретная причина неизвестности (только status 'unknown'). */
  readonly unknownReason?: string;
}

/** Класс ошибки кинетического слоя (fail-closed, без частичных планов). */
export class GeochemicalKineticsError extends Error {
  readonly code: 'invalid_input' | 'unrepresentable_extent';
  readonly component = 'GeochemicalKinetics';
  readonly processId: string | null;

  constructor(
    code: 'invalid_input' | 'unrepresentable_extent',
    message: string,
    processId: string | null = null
  ) {
    super('[GeochemicalKinetics/' + code + '] ' + message);
    this.name = 'GeochemicalKineticsError';
    this.code = code;
    this.processId = processId;
  }
}

function provenanceIdentified(p: unknown): boolean {
  if (typeof p !== 'object' || p === null) return false;
  const r = p as Record<string, unknown>;
  return (
    (typeof r.sourceName === 'string' && r.sourceName.trim() !== '') ||
    (typeof r.sourceId === 'string' && r.sourceId.trim() !== '') ||
    (typeof r.datasetId === 'string' && r.datasetId.trim() !== '') ||
    (typeof r.reference === 'string' && r.reference.trim() !== '')
  );
}

/**
 * Валидация кинетической записи (fail-closed). Пустой список = запись
 * корректна. Проверяется форма, согласованность статуса с числовыми
 * полями и наличие provenance у известной скорости.
 */
export function validateGeochemicalKineticRateRecord(record: unknown): string[] {
  const issues: string[] = [];
  if (typeof record !== 'object' || record === null) {
    return ['кинетическая запись должна быть объектом'];
  }
  const r = record as Record<string, unknown>;
  if (typeof r.processId !== 'string' || r.processId.trim() === '') {
    issues.push('processId должен быть непустой строкой');
  }
  if (r.rateClass !== 'constant_zero_order') {
    issues.push('rateClass этого среза — только «constant_zero_order» (иные законы скорости требуют первоисточников параметров и не изображаются)');
  }
  if (r.status !== 'known' && r.status !== 'unknown') {
    issues.push('status должен быть «known» или «unknown»');
    return issues;
  }
  if (r.status === 'known') {
    if (typeof r.rateMolPerM2PerYear !== 'number' || !Number.isFinite(r.rateMolPerM2PerYear) || r.rateMolPerM2PerYear <= 0) {
      issues.push('известная скорость должна быть конечным положительным числом, mol·m⁻²·yr⁻¹');
    }
    if (!provenanceIdentified(r.rateProvenance)) {
      issues.push('известная скорость обязана нести идентифицированный источник (rateProvenance: sourceName/sourceId/datasetId/reference)');
    }
    if (typeof r.applicability !== 'string' || r.applicability.trim() === '') {
      issues.push('известная скорость обязана нести явную область применимости источника (applicability)');
    }
    if (typeof r.unknownReason === 'string') {
      issues.push('у известной скорости не может быть поля unknownReason');
    }
  } else {
    if (typeof r.unknownReason !== 'string' || r.unknownReason.trim() === '') {
      issues.push('unknown-скорость обязана нести конкретную причину (unknownReason), а не молчаливую неизвестность');
    }
    if (r.rateMolPerM2PerYear !== undefined) {
      issues.push('unknown-скорость не может нести числовое значение: неизвестность не завершается числом (fail-closed)');
    }
    if (r.rateProvenance !== undefined) {
      issues.push('unknown-скорость не может нести источник числовой скорости');
    }
  }
  return issues;
}

// ============================================
// 2. ПЛАНИРОВАНИЕ EXTENT ИЗ СКОРОСТЕЙ
// ============================================

/** Запланированный extent одного процесса. */
export interface GeochemicalKineticExtent {
  readonly processId: string;
  /** extent = rate × Δt(period), mol/m². */
  readonly extentMolPerM2: number;
  /** Цепочка provenance: источник скорости + источник длительности. */
  readonly extentProvenance: DataProvenance;
  /** Скорость, использованная в расчёте, mol·m⁻²·yr⁻¹. */
  readonly rateMolPerM2PerYear: number;
}

/** Процесс, пропущенный из-за неизвестной скорости (честно, без числа). */
export interface GeochemicalKineticSkip {
  readonly processId: string;
  readonly reason: string;
}

/** Результат планирования extent-ов macro-шага. */
export interface GeochemicalKineticExtentPlan {
  readonly status: 'planned';
  /** Δt в годах (ЯВНЫЙ вход вызывающей стороны). */
  readonly durationYears: number;
  /** Δt в секундах (юлианский год, для исполнителей в секундах). */
  readonly durationSeconds: number;
  readonly extents: readonly GeochemicalKineticExtent[];
  readonly skipped: readonly GeochemicalKineticSkip[];
  readonly diagnostics: readonly string[];
}

/**
 * Спланировать extent-ы macro-шага из кинетических записей.
 *
 * Гарантии:
 * - extent допустимого знака только ПОЛОЖИТЕЛЬНЫЙ: направление переноса
 *   определяется конфигурацией процесса (spec/адаптером), а не знаком
 *   скорости; ноль/отрицательное/нефинитное — отказ, а не молчаливый пропуск;
 * - unknown-запись не даёт ни числа, ни нуля: она попадает в skipped
 *   с конкретной причиной (стохиометрия процессов не «достраивается»);
 * - длительность — в годах, с provenance; секунды выводятся единственным
 *   способом: durationSeconds = durationYears × GEOCHEMICAL_YEAR_S
 *   (юлианский год 365.25 × 86400 с, та же конвенция, что у Stage 4.9a).
 */
export function planGeochemicalKineticExtents(args: {
  readonly records: readonly GeochemicalKineticRateRecord[];
  /** Длительность macro-шага, годы (конечная, > 0), с provenance. */
  readonly durationYears: number;
  /** Откуда известна длительность макро-шага. */
  readonly durationProvenance: DataProvenance;
}): GeochemicalKineticExtentPlan {
  if (typeof args.durationYears !== 'number' || !Number.isFinite(args.durationYears) || args.durationYears <= 0) {
    throw new GeochemicalKineticsError('invalid_input', 'длительность macro-шага должна быть конечным положительным числом лет, получено ' + String(args.durationYears));
  }
  if (!provenanceIdentified(args.durationProvenance)) {
    throw new GeochemicalKineticsError('invalid_input', 'длительность macro-шага обязана нести идентифицированный provenance');
  }
  const diagnostics: string[] = [];
  const extents: GeochemicalKineticExtent[] = [];
  const skipped: GeochemicalKineticSkip[] = [];
  const durationYears = args.durationYears;
  for (const record of args.records) {
    const issues = validateGeochemicalKineticRateRecord(record);
    if (issues.length > 0) {
      throw new GeochemicalKineticsError(
        'invalid_input',
        'кинетическая запись процесса «' + String(record && (record as Record<string, unknown>).processId) + '» не проходит валидацию: ' + issues.join('; '),
        typeof (record as Record<string, unknown> | undefined)?.processId === 'string' ? (record as Record<string, unknown>).processId as string : null
      );
    }
    if (record.status === 'unknown') {
      skipped.push({ processId: record.processId, reason: record.unknownReason ?? 'скорость неизвестна' });
      continue;
    }
    const extent = (record.rateMolPerM2PerYear as number) * durationYears;
    if (!Number.isFinite(extent) || extent <= 0) {
      throw new GeochemicalKineticsError('unrepresentable_extent', 'extent процесса «' + record.processId + '» непредставим или неположителен (' + String(extent) + ')', record.processId);
    }
    const rateProv = record.rateProvenance as DataProvenance;
    extents.push({
      processId: record.processId,
      extentMolPerM2: extent,
      rateMolPerM2PerYear: record.rateMolPerM2PerYear as number,
      extentProvenance: {
        ...rateProv,
        recordId: 'kinetic-extent:' + record.processId,
        note:
          'extent = rateMolPerM2PerYear × durationYears (' +
          String(record.rateMolPerM2PerYear) +
          ' mol·m⁻²·yr⁻¹ × ' +
          String(durationYears) +
          ' yr); длительность с provenance: ' +
          (args.durationProvenance.sourceName ?? '(идентифицированный источник длительности)') +
          '; скорость постоянна на интервале интегрирования'
      }
    });
  }
  if (skipped.length > 0) {
    diagnostics.push('пропущено процессов с unknown-скоростью: ' + String(skipped.length) + ' (численных вкладов не создано)');
  }
  return {
    status: 'planned',
    durationYears,
    durationSeconds: durationYears * GEOCHEMICAL_YEAR_S,
    extents,
    skipped,
    diagnostics
  };
}
