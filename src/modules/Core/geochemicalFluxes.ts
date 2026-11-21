// ============================================
// GEOCHEMICAL FLUXES - фундамент геохимических потоков (Stage 4.9a)
// ============================================
//
// Типизированная ОСНОВА геохимических циклов (Stage 4.9): контракт
// описания геохимического процесса, его скорости, направления переноса,
// происхождения данных и исполнения через СУЩЕСТВУЮЩИЕ контракты ядра.
//
// ЧТО ЭТО И ЧТО ЭТО НЕ ЭТО:
// - это описание (спецификация) геохимического процесса и исполнитель,
//   сводящий его к контракту FluxLedger через integrateSubstanceRate и
//   applyFlux; НОВАЯ СИСТЕМА УЧЁТА ЗАПАСОВ НЕ СОЗДАЁТСЯ: инвентари —
//   ReservoirRecord, переносы — FluxLedger, превращения — ReactionLedger,
//   сохранение элементов — auditElementConservation;
// - физические уравнения и численные скорости процессов (выветривание,
//   дегазация, растворение, захоронение, ...) здесь НЕ реализуются:
//   каталог Stage 4.9a описывает процессы БЕЗ фиктивных скоростей;
// - реакция не подменяется переносом: химическое превращение фиксируется
//   только через ReactionLedger (см. docs/science/PHYSICS_ARCHITECTURE.md
//   §7.4); этот модуль описывает ТОЛЬКО перенос вещества между
//   резервуарами или через явную внешнюю границу.
//
// ВНЕШНЯЯ геохимическая конвенция (Stage 4.9):
//   F = mol·m⁻²·yr⁻¹ (скорость потока на единицу площади поверхности);
//   1 yr = 365.25 × 86400 s = 31 557 600 s (юлианский год);
//   внутреннее представление FluxLedger: ratePerSecond в mol·m⁻²·s⁻¹
//   на основании column_amount (моль/м²).
//
//   Единицы НЕ смешиваются: mol/yr, mol/m²/yr, mol/s, mol/m²/s,
//   интегрированные mol и интегрированные mol/m² — РАЗНЫЕ величины.
//   Конверсия допускается только между mol/m²/yr и mol/m²/s (и задана
//   именованными функциями с runtime-проверками); mol/yr или mol/s без
//   площади НЕ конвертируются автоматически: геометрия/площадь должна
//   быть предоставлена вызывающим кодом явно (автоматического перевода
//   полного запаса в столбовой инвентарь нет).
//
// НАПРАВЛЕНИЕ ПОТОКА: семантика FluxLedger сохранена — величина потока
// ПОЛОЖИТЕЛЬНА, направление задаётся явными from/to. Запрещено:
// - обозначать обратное направление отрицательной скоростью (обратный
//   процесс — отдельное описание с обратными from/to);
// - менять местами резервуары без смены смысла процесса;
// - маскировать внешний источник под внутренний перенос (и наоборот);
// - создавать отсутствующий резервуар автоматически (неизвестный
//   резервуар делает процесс неисполнимым — fail-closed).
//
// ИСТОЧНИКИ И НЕИЗВЕСТНОСТЬ: каждый процесс несёт явное состояние
// происхождения и достоверности скорости (семантика ScientificValue /
// DataProvenance, вторая шкала достоверности не вводится):
// - известная скорость — конечное неотрицательное число, единица
//   'mol_m2_yr', ЗАПОЛНЕННЫЙ provenance (источник обязан быть
//   идентифицирован);
// - неизвестная скорость — status 'unknown' с обязательной причиной;
//   такой процесс НЕ исполняется и НЕ создаёт фиктивной записи потока;
//   отсутствие значения не заменяется нулем или оценкой.
//
// Fail-closed принципы:
// - неизвестное вещество, резервуар или основание → процесс не
//   исполняется (not_executable), состояние мира не меняется;
// - числовая скорость без provenance → не исполняется;
// - нулевая скорость — валидное значение с нулевым переносом: записи
//   потока не создаётся (нулевой перенос — не поток);
// - внешние потоки допускаются только при явной границе системы и
//   физическом обосновании пересечения;
// - интегрирование скорости за интервал выполняет integrateSubstanceRate
//   из FluxLedger; скорость НЕЛЬЗЯ применить к инвентарю напрямую
//   (applyFlux отвергает rate-субъекты) — это свойство ядра, здесь оно
//   воспроизводится и тестируется явными сценариями.

import type { ReservoirRecord } from './reservoir';
import {
  EXTERNAL,
  applyFlux,
  auditElementConservation,
  createFluxLedger,
  integrateSubstanceRate,
  netExternalMolarCounts,
  registerFlux,
  reservoirsToMolarCounts
} from './fluxLedger';
import type {
  AuditExclusion,
  AuditOptions,
  BalanceDiscrepancy,
  ConservationStatus,
  FluxAuditScope,
  FluxKind,
  FluxLedger,
  FluxRecord,
  FluxSubject,
  FluxTime
} from './fluxLedger';
import type { SpeciesCatalog } from './species';
import { elementTotals as speciesElementTotals } from './species';
import type { DataProvenance } from './scientificValue';
import { isPlainRecord } from './reservoir';

// ============================================
// 1. КОНСТАНТЫ ГОДА И ЕДИНИЦ
// ============================================

/**
 * Юлианский год в секундах: 1 yr = 365.25 × 86400 s = 31 557 600 s
 * (ровно; значение совпадает с Units.YEAR_S из легаси-модуля Units,
 * двойной источник истины исключён конверсионным тестом).
 */
export const GEOCHEMICAL_YEAR_S: number = 365.25 * 86400;

/**
 * Внешняя (геохимическая) единица скорости Stage 4.9: mol·m⁻²·yr⁻¹.
 * Внутренняя единица FluxLedger: mol·m⁻²·s⁻¹ (ratePerSecond, basis column_amount).
 */
export const GEOCHEMICAL_RATE_UNIT = 'mol_m2_yr';
export const FLUX_RATE_UNIT = 'mol_m2_s';

/**
 * Единственное основание инвентаря, совместимое с геохимической
 * конвенцией mol/m²: столбовые запасы. Переводы полного запаса
 * (basis 'amount') в столбовой НЕ выполняются автоматически:
 * для них нужна площадь, которую знает только вызывающий код.
 */
export const GEOCHEMICAL_INVENTORY_BASIS: 'column_amount' = 'column_amount';

/** Приоритетные элементы диагностики сохранения (если виды присутствуют в каталоге). */
export const GEOCHEMICAL_PRIORITY_ELEMENTS: readonly string[] = ['C', 'O', 'H', 'Ca', 'Mg', 'Si'];

// ============================================
// 2. ОШИБКА
// ============================================

export class GeochemicalFluxError extends Error {
  readonly code:
    | 'invalid_rate'
    | 'invalid_spec'
    | 'unknown_substance'
    | 'unknown_reservoir'
    | 'incompatible_basis'
    | 'missing_provenance'
    | 'not_executable';
  readonly component = 'GeochemicalFluxes';
  readonly processId: string | null;

  constructor(code: GeochemicalFluxError['code'], message: string, processId: string | null) {
    super(`[GeochemicalFluxes/${code}] ${message}`);
    this.name = 'GeochemicalFluxError';
    this.code = code;
    this.processId = processId;
  }
}

// ============================================
// 3. ИМЕНОВАННЫЕ КОНВЕРСИИ СКОРОСТИ
// ============================================

/**
 * F [mol·m⁻²·yr⁻¹] → ratePerSecond [mol·m⁻²·s⁻¹] = F / 31 557 600.
 * NaN/±Infinity и отрицательные значения отклоняются исключением:
 * направление потока задаётся from/to, а НЕ знаком скорости.
 * Ноль допустим и конвертируется в ноль.
 */
export function molPerM2YearToPerSecond(molPerM2PerYear: number): number {
  if (!Number.isFinite(molPerM2PerYear)) {
    throw new GeochemicalFluxError('invalid_rate', `скорость должна быть конечным числом, получено ${String(molPerM2PerYear)} ${GEOCHEMICAL_RATE_UNIT}`, null);
  }
  if (molPerM2PerYear < 0) {
    throw new GeochemicalFluxError('invalid_rate', `скорость не может быть отрицательной: обратное направление задаётся from/to, а не знаком; получено ${String(molPerM2PerYear)} ${GEOCHEMICAL_RATE_UNIT}`, null);
  }
  return molPerM2PerYear / GEOCHEMICAL_YEAR_S;
}

/**
 * ratePerSecond [mol·m⁻²·s⁻¹] → F [mol·m⁻²·yr⁻¹] = rate × 31 557 600.
 * Те же runtime-гарантии, что и у прямой конверсии.
 */
export function molPerM2SecondToPerYear(molPerM2PerSecond: number): number {
  if (!Number.isFinite(molPerM2PerSecond)) {
    throw new GeochemicalFluxError('invalid_rate', `скорость должна быть конечным числом, получено ${String(molPerM2PerSecond)} ${FLUX_RATE_UNIT}`, null);
  }
  if (molPerM2PerSecond < 0) {
    throw new GeochemicalFluxError('invalid_rate', `скорость не может быть отрицательной: обратное направление задаётся from/to, а не знаком; получено ${String(molPerM2PerSecond)} ${FLUX_RATE_UNIT}`, null);
  }
  return molPerM2PerSecond * GEOCHEMICAL_YEAR_S;
}

// ============================================
// 4. ТИПЫ ПРОЦЕССОВ И ОПИСАНИЕ
// ============================================

/**
 * Тип геохимического процесса (данные для последующих частей Stage 4.9).
 * 'other' — явный выход для процессов, не входящих в перечисленные классы.
 */
export type GeochemicalProcessType =
  | 'volcanic_degas'
  | 'metamorphic_degas'
  | 'silicate_weathering'
  | 'carbonate_weathering'
  | 'dissolution'
  | 'precipitation'
  | 'ocean_atmosphere_exchange'
  | 'organic_carbon_burial'
  | 'oxidation'
  | 'subduction'
  | 'other';

export const GEOCHEMICAL_PROCESS_TYPES: readonly GeochemicalProcessType[] = [
  'volcanic_degas',
  'metamorphic_degas',
  'silicate_weathering',
  'carbonate_weathering',
  'dissolution',
  'precipitation',
  'ocean_atmosphere_exchange',
  'organic_carbon_burial',
  'oxidation',
  'subduction',
  'other'
];

/**
 * Внешняя граница системы: любая внешняя скорость/поступление обязана
 * ссылаться на ЯВНУЮ границу с физическим обоснованием пересечения.
 */
export interface GeochemicalExternalBoundary {
  /** Идентификатор границы (согласуется с EXTERNAL семантикой FluxLedger). */
  id: string;
  /** Физическое основание пересечения границы этим процессом. */
  physicalJustification: string;
}

/**
 * Направление переноса. Соответствует FluxKind:
 * - internal_transfer — между двумя внутренними резервуарами;
 * - external_input    — с внешней границы в резервуар;
 * - external_output   — из резервуара на внешнюю границу.
 */
export type GeochemicalTransferDirection =
  | { readonly kind: 'internal_transfer'; readonly fromReservoirId: string; readonly toReservoirId: string }
  | { readonly kind: 'external_input'; readonly reservoirId: string; readonly boundary: GeochemicalExternalBoundary }
  | { readonly kind: 'external_output'; readonly reservoirId: string; readonly boundary: GeochemicalExternalBoundary };

/**
 * Скорость геохимического процесса. Второй шкалы достоверности
 * не вводится: 'known' обязан нести заполненный DataProvenance,
 * 'unknown' — обязательную причину неизвестности.
 */
export type GeochemicalRate =
  | {
      readonly status: 'known';
      /** Единица значения: только 'mol_m2_yr' (mol·m⁻²·yr⁻¹). */
      readonly unit: typeof GEOCHEMICAL_RATE_UNIT;
      /** Скорость, mol·m⁻²·yr⁻¹ (конечная, неотрицательная). */
      readonly molPerM2PerYear: number;
      /** Происхождение значения: обязателен идентифицированный источник. */
      readonly provenance: DataProvenance;
    }
  | {
      readonly status: 'unknown';
      /** Причина неизвестности — обязательна. */
      readonly reason: string;
      readonly provenance?: DataProvenance;
    };

/**
 * Спецификация геохимического процесса (данные, не логика):
 * описывает КТО, ЧТО и КУДА переносит и НА КАКОМ основании.
 */
export interface GeochemicalProcessSpec {
  /** Уникальный стабильный идентификатор процесса. */
  readonly processId: string;
  /** Тип процесса (класс геохимической механики). */
  readonly processType: GeochemicalProcessType;
  /** Человекочитаемое физическое описание. */
  readonly description: string;
  /** Переносимое вещество: speciesId из SpeciesCatalog. */
  readonly speciesId: string;
  /** Направление переноса (positive velocity + явные from/to). */
  readonly direction: GeochemicalTransferDirection;
  /** Скорость и её достоверность. */
  readonly rate: GeochemicalRate;
  /**
   * Основание инвентаря: только 'column_amount' (геохимическая конвенция
   * mol/m²). Иные основания делают процесс неисполнимым — автоматический
   * пересчёт между основаниями не выполняется.
   */
  readonly basis: 'column_amount';
  /** Диапазон применимости описания. */
  readonly applicability?: string;
  /** Условия выполнения (когда процесс физически возможен). */
  readonly conditions?: string;
  /** Диагностические ограничения (что описание НЕ утверждает). */
  readonly diagnosticsNote?: string;
}

// ============================================
// 5. ВАЛИДАЦИЯ ОПИСАНИЯ (runtime-форма)
// ============================================

/**
 * Runtime-валидация спецификации (данные могут прийти из JSON):
 * возвращает список проблем; пустой список — описание валидно.
 * Числовая скорость дополнительно требует provenance с
 * идентифицированным источником (sourceName или sourceId).
 */
export function validateGeochemicalProcessSpec(spec: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainRecord(spec)) {
    return ['спецификация должна быть объектом-записью, получено ' + typeof spec];
  }
  if (typeof spec.processId !== 'string' || spec.processId.trim() === '') {
    errors.push('processId должен быть непустой строкой');
  }
  if (
    typeof spec.processType !== 'string' ||
    !(GEOCHEMICAL_PROCESS_TYPES as readonly string[]).includes(spec.processType)
  ) {
    errors.push('processType должен быть одним из: ' + GEOCHEMICAL_PROCESS_TYPES.join(', '));
  }
  if (typeof spec.description !== 'string' || spec.description.trim() === '') {
    errors.push('description должен быть непустой строкой (физическое описание процесса)');
  }
  if (typeof spec.speciesId !== 'string' || spec.speciesId.trim() === '') {
    errors.push('speciesId должен быть непустой строкой');
  }
  if (spec.basis !== GEOCHEMICAL_INVENTORY_BASIS) {
    errors.push(`basis должен быть «${GEOCHEMICAL_INVENTORY_BASIS}» (геохимическая конвенция mol/m²); получено «${String(spec.basis)}»: смешение оснований и автоматический пересчёт запрещены`);
  }

  // Направление.
  const dir = spec.direction;
  if (!isPlainRecord(dir)) {
    errors.push('direction должен быть объектом-записью');
  } else {
    if (dir.kind === 'internal_transfer') {
      if (typeof dir.fromReservoirId !== 'string' || dir.fromReservoirId.trim() === '' || dir.fromReservoirId === EXTERNAL) {
        errors.push('internal_transfer: fromReservoirId должен быть внутренним резервуаром (не external и не пустым)');
      }
      if (typeof dir.toReservoirId !== 'string' || dir.toReservoirId.trim() === '' || dir.toReservoirId === EXTERNAL) {
        errors.push('internal_transfer: toReservoirId должен быть внутренним резервуаром (не external и не пустым)');
      }
      if (typeof dir.fromReservoirId === 'string' && typeof dir.toReservoirId === 'string' && dir.fromReservoirId === dir.toReservoirId) {
        errors.push('internal_transfer: from и to совпадают — перенос в самого себя не является переносом');
      }
      if (dir.boundary !== undefined) {
        errors.push('internal_transfer не задаёт внешнюю границу (boundary запрещён)');
      }
    } else if (dir.kind === 'external_input' || dir.kind === 'external_output') {
      if (typeof dir.reservoirId !== 'string' || dir.reservoirId.trim() === '' || dir.reservoirId === EXTERNAL) {
        errors.push(`${dir.kind}: reservoirId должен быть внутренним резервуаром (не external и не пустым)`);
      }
      if (!isPlainRecord(dir.boundary)) {
        errors.push(`${dir.kind}: обязательна явная граница системы (boundary с id и physicalJustification)`);
      } else {
        if (typeof dir.boundary.id !== 'string' || dir.boundary.id.trim() === '') {
          errors.push(`${dir.kind}: boundary.id должен быть непустой строкой`);
        }
        if (typeof dir.boundary.physicalJustification !== 'string' || dir.boundary.physicalJustification.trim() === '') {
          errors.push(`${dir.kind}: boundary.physicalJustification обязано описывать физическое основание пересечения границы`);
        }
      }
    } else {
      errors.push("direction.kind должен быть 'internal_transfer', 'external_input' или 'external_output'");
    }
  }

  // Скорость.
  const rate = spec.rate;
  if (!isPlainRecord(rate)) {
    errors.push('rate должен быть объектом-записью');
  } else if (rate.status === 'known') {
    if (rate.unit !== GEOCHEMICAL_RATE_UNIT) {
      errors.push(`rate.unit известной скорости должен быть «${GEOCHEMICAL_RATE_UNIT}»; получено «${String(rate.unit)}»`);
    }
    const v = rate.molPerM2PerYear;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`rate.molPerM2PerYear известной скорости должен быть конечным числом, получено ${String(v)}`);
    } else if (v < 0) {
      errors.push(`rate.molPerM2PerYear не может быть отрицательным: обратное направление задаётся direction; получено ${String(v)}`);
    }
    if (!isPlainRecord(rate.provenance)) {
      errors.push('известная скорость обязана нести provenance (DataProvenance с идентифицированным источником)');
    } else {
      const sName = rate.provenance.sourceName;
      const sId = rate.provenance.sourceId;
      const sourceKnown = (typeof sName === 'string' && sName.trim() !== '') || (typeof sId === 'string' && sId.trim() !== '');
      if (!sourceKnown) {
        errors.push('provenance известной скорости обязан идентифицировать источник (sourceName или sourceId)');
      }
    }
  } else if (rate.status === 'unknown') {
    if (typeof rate.reason !== 'string' || rate.reason.trim() === '') {
      errors.push('неизвестная скорость обязана нести непустую причину unknown (rate.reason)');
    }
    if (rate.molPerM2PerYear !== undefined) {
      errors.push('неизвестная скорость не может нести числовое значение (molPerM2PerYear запрещён при status unknown)');
    }
  } else {
    errors.push("rate.status должен быть 'known' или 'unknown'");
  }

  for (const key of ['applicability', 'conditions', 'diagnosticsNote'] as const) {
    if (spec[key] !== undefined && typeof spec[key] !== 'string') {
      errors.push(`«${key}» должен быть строкой, если задан`);
    }
  }
  return errors;
}

/**
 * Runtime-валидация каталога процессов: массив описаний с уникальными
 * идентификаторами, каждое из которых проходит validateGeochemicalProcessSpec.
 */
export function validateGeochemicalProcessCatalog(catalog: readonly unknown[]): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < catalog.length; i++) {
    const entry = catalog[i];
    if (!isPlainRecord(entry) || typeof entry.processId !== 'string') {
      errors.push(`запись каталога #${i}: не является объектом с processId`);
      continue;
    }
    if (seenIds.has(entry.processId)) {
      errors.push(`дубликат идентификатора процесса «${entry.processId}» в каталоге`);
    }
    seenIds.add(entry.processId);
    for (const issue of validateGeochemicalProcessSpec(entry)) {
      errors.push(`процесс «${entry.processId}»: ${issue}`);
    }
  }
  return errors;
}

// ============================================
// 6. ПЛАН И ИСПОЛНЕНИЕ
// ============================================

/**
 * Среда исполнения: известные виды и резервуары даны извне.
 * Исполнитель ничего не «достраивает»: отсутствующий резервуар делает
 * процесс неисполнимым (fail-closed), а не создаётся.
 */
export interface GeochemicalExecutionEnvironment {
  readonly speciesCatalog: SpeciesCatalog;
  readonly reservoirs: Record<string, ReservoirRecord>;
  /**
   * Существующий журнал потоков (опционально). Если не задан,
   * исполняется на пустом журнале; заданный журнал НЕ мутируется —
   * результат несёт новый журнал с добавленной записью.
   */
  readonly ledgerInput?: FluxLedger;
}

/** Готовый поток-кандидат: сегменты FluxRecord без записи в журнал. */
export interface GeochemicalFluxCandidate {
  readonly kind: FluxKind;
  /** Источник: резервуар или EXTERNAL для external_input. */
  readonly from: string;
  /** Получатель: резервуар или EXTERNAL для external_output. */
  readonly to: string;
  /**
   * Rate-субъект в единицах ядра (mol·m⁻²·s⁻¹, basis column_amount).
   * К инвентарю НЕ применяется: только integrateSubstanceRate.
   */
  readonly rateSubject: Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'rate' }>;
}

export type GeochemicalFluxPlanResult =
  | {
      readonly status: 'ready';
      readonly processId: string;
      readonly candidate: GeochemicalFluxCandidate;
      readonly ratePerYear: number;
      readonly ratePerSecond: number;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'zero_rate';
      readonly processId: string;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'unknown_rate';
      readonly processId: string;
      readonly reason: string;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'not_executable';
      readonly processId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Построить план геохимического потока:
 * 1) runtime-валидация описания; 2) известность вещества; 3) известность
 * резервуаров; 4) совместимость основания инвентаря (column_amount);
 * 5) конечность/единицы скорости; 6) provenance числовых значений.
 * План НЕ содержит исполненного переноса: применение — отдельный шаг
 * через integrateSubstanceRate + applyFlux.
 */
export function createGeochemicalFluxPlan(spec: GeochemicalProcessSpec, env: GeochemicalExecutionEnvironment): GeochemicalFluxPlanResult {
  // 1. Валидация формы.
  const issues = validateGeochemicalProcessSpec(spec);
  if (issues.length > 0) {
    return {
      status: 'not_executable',
      processId: isPlainRecord(spec) && typeof spec.processId === 'string' ? spec.processId : null,
      reason: 'спецификация не проходит runtime-валидацию',
      issues
    };
  }
  const processId: string = spec.processId;
  const diagnostics: string[] = [];

  // 2. Известность вещества.
  if (!env.speciesCatalog.has(spec.speciesId)) {
    throw new GeochemicalFluxError('unknown_substance', `процесс «${processId}»: вещество «${spec.speciesId}» не зарегистрировано в каталоге видов — исполнение невозможно (состав неизвестен, fail-closed)`, processId);
  }
  diagnostics.push(`вещество «${spec.speciesId}» подтверждено каталогом видов`);

  // 3. Известность резервуаров: нумерация по направлению.
  let kind: FluxKind;
  let from: string;
  let to: string;
  const engagedReservoirs: string[] = [];
  if (spec.direction.kind === 'internal_transfer') {
    kind = 'internal_transfer';
    from = spec.direction.fromReservoirId;
    to = spec.direction.toReservoirId;
    engagedReservoirs.push(from, to);
  } else if (spec.direction.kind === 'external_input') {
    kind = 'external_input';
    from = EXTERNAL;
    to = spec.direction.reservoirId;
    engagedReservoirs.push(to);
  } else {
    kind = 'external_output';
    from = spec.direction.reservoirId;
    to = EXTERNAL;
    engagedReservoirs.push(from);
  }
  for (const id of engagedReservoirs) {
    if (!env.reservoirs[id]) {
      throw new GeochemicalFluxError('unknown_reservoir', `процесс «${processId}»: резервуар «${id}» не существует в состоянии мира — создание отсутствующего резервуара запрещено (fail-closed)`, processId);
    }
  }
  if (spec.direction.kind === 'internal_transfer') {
    diagnostics.push(`внутренний перенос ${from} → ${to}: система сохраняет суммарное количество вещества`);
  } else {
    diagnostics.push(`внешний поток ${kind} на границе «${spec.direction.boundary.id}»: ${spec.direction.boundary.physicalJustification}`);
  }

  // 4. Совместимость основания инвентаря.
  for (const id of engagedReservoirs) {
    const res = env.reservoirs[id];
    if (!res.material) {
      throw new GeochemicalFluxError('incompatible_basis', `процесс «${processId}»: резервуар «${id}» не содержит материального инвентаря — применение потока не создаёт инвентарь молча (задайте его явно)`, processId);
    }
    if (res.material.basis !== GEOCHEMICAL_INVENTORY_BASIS) {
      throw new GeochemicalFluxError('incompatible_basis', `процесс «${processId}»: резервуар «${id}» хранит инвентарь в основании «${res.material.basis}», а геохимическая конвенция — «${GEOCHEMICAL_INVENTORY_BASIS}»: автоматический пересчёт полного запаса в столбовой (и обратно) не выполняется без явно переданной площади`, processId);
    }
  }
  diagnostics.push(`основание ${GEOCHEMICAL_INVENTORY_BASIS} подтверждено для резервуаров: ${engagedReservoirs.join(', ')}`);

  // 5-6. Скорость: известность, единицы, конечность, provenance.
  if (spec.rate.status === 'unknown') {
    return {
      status: 'unknown_rate',
      processId,
      reason: spec.rate.reason,
      diagnostics: [...diagnostics, 'скорость неизвестна: процесс остаётся неисполняемым, фиктивная запись потока не создаётся']
    };
  }
  const ratePerYear = spec.rate.molPerM2PerYear;
  // Повторная runtime-проверка конечности/знака (данные могли прийти из JSON).
  if (!Number.isFinite(ratePerYear) || ratePerYear < 0) {
    throw new GeochemicalFluxError('not_executable', `процесс «${processId}»: скорость должна быть конечной неотрицательной, получено ${String(ratePerYear)} ${GEOCHEMICAL_RATE_UNIT}`, processId);
  }
  const ratePerSecond = molPerM2YearToPerSecond(ratePerYear);
  diagnostics.push(`скорость ${ratePerYear} ${GEOCHEMICAL_RATE_UNIT} = ${ratePerSecond} ${FLUX_RATE_UNIT}; источник подтверждён provenance`);

  const rateSubject: Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'rate' }> = {
    subjectType: 'substance',
    speciesId: spec.speciesId,
    quantityKind: 'rate',
    ratePerSecond,
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    note: `${processId}: геохимическая скорость ${GEOCHEMICAL_RATE_UNIT} → ${FLUX_RATE_UNIT} (÷ ${GEOCHEMICAL_YEAR_S} с)`
  };

  if (ratePerYear === 0) {
    return {
      status: 'zero_rate',
      processId,
      diagnostics: [...diagnostics, 'нулевая скорость: перенос отсутствует; запись потока НЕ создаётся (нулевой перенос — не поток)']
    };
  }

  return {
    status: 'ready',
    processId,
    candidate: { kind, from, to, rateSubject },
    ratePerYear,
    ratePerSecond,
    diagnostics
  };
}

/**
 * Явная интеграция готового плана за интервал времени через
 * integrateSubstanceRate (контракт FluxLedger). Возвращает
 * integrated-субъект; применение к резервуарам — отдельный шаг.
 * Нулевой/неизвестный/неисполнимый план интеграции не подлежит.
 */
export function integrateGeochemicalProcess(
  plan: GeochemicalFluxPlanResult,
  durationS: number
): { subject: Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }>; integratedMolPerM2: number } {
  if (plan.status !== 'ready') {
    throw new GeochemicalFluxError('not_executable', `интеграция возможна только для готового плана (status ready); получен «${plan.status}»`, 'processId' in plan ? plan.processId : null);
  }
  const subject = integrateSubstanceRate(plan.candidate.rateSubject, durationS);
  return { subject, integratedMolPerM2: subject.amount };
}

/** Итог исполнения геохимического процесса. */
export type GeochemicalExecutionResult =
  | {
      readonly status: 'applied';
      readonly fluxId: string;
      /** Журнал с ЕДИНСТВЕННОЙ применённой записью (инт. поток этого процесса). */
      readonly ledger: FluxLedger;
      /** НОВЫЕ резервуары; исходные объекты не изменяются. */
      readonly reservoirs: Record<string, ReservoirRecord>;
      readonly record: FluxRecord;
      readonly ratePerYear: number;
      readonly ratePerSecond: number;
      readonly integratedMolPerM2: number;
      readonly durationS: number;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly processId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
      readonly error: string | null;
    };

/**
 * Исполнить геохимический процесс: план → явная интеграция скорости за
 * durationS → регистрация integrated-потока → applyFlux (контракты ядра).
 *
 * Гарантии:
 * - состояние мира НЕ изменяется при неуспешной валидации или неполном
 *   выполнении (все операции иммутабельны; при исключении возвращается
 *   not_applied, исходные резервуары и журнал остаются нетронутыми);
 * - rate к инвентарю напрямую не применяется;
 * - при нехватке вещества applyFlux отклоняет применение (insufficient).
 */
export function executeGeochemicalProcess(
  spec: GeochemicalProcessSpec,
  env: GeochemicalExecutionEnvironment,
  opts: {
    /** Уникальный id потока в журнале (требует FluxLedger). */
    fluxId: string;
    /** Длительность интервала переноса, с (> 0). */
    durationS: number;
    /** Привязка к моменту времени симуляции (необязательна). */
    time?: FluxTime | null;
    /** Служебная заметка в записи потока. */
    note?: string;
  }
): GeochemicalExecutionResult {
  let plan: GeochemicalFluxPlanResult;
  try {
    plan = createGeochemicalFluxPlan(spec, env);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = e instanceof GeochemicalFluxError ? e.code : 'not_executable';
    return {
      status: 'not_applied',
      processId: isPlainRecord(spec) && typeof spec.processId === 'string' ? spec.processId : null,
      reason: `план не построен (${code}): ${message}`,
      issues: [],
      error: message
    };
  }

  if (plan.status !== 'ready') {
    return {
      status: 'not_applied',
      processId: plan.processId,
      reason:
        plan.status === 'zero_rate'
          ? 'нулевая скорость: перенос отсутствует, фиктивная запись потока не создаётся'
          : plan.status === 'unknown_rate'
            ? `скорость неизвестна: ${plan.reason}`
            : `процесс неисполним: ${plan.reason}`,
      issues: plan.status === 'not_executable' ? plan.issues : [],
      error: null
    };
  }

  try {
    const { subject, integratedMolPerM2 } = integrateGeochemicalProcess(plan, opts.durationS);
    const baseLedger = env.ledgerInput ?? createFluxLedger();
    const registered = registerFlux(baseLedger, {
      id: opts.fluxId,
      kind: plan.candidate.kind,
      from: plan.candidate.from,
      to: plan.candidate.to,
      subject,
      time: opts.time ?? null,
      note: opts.note ?? `geochemical: ${plan.processId} (${spec.processType}), интегрировано за ${opts.durationS} с`
    });
    const applied = applyFlux(registered, env.reservoirs, opts.fluxId);
    return {
      status: 'applied',
      fluxId: opts.fluxId,
      ledger: applied.ledger,
      reservoirs: applied.reservoirs,
      record: applied.ledger.records.find((r) => r.id === opts.fluxId) as FluxRecord,
      ratePerYear: plan.ratePerYear,
      ratePerSecond: plan.ratePerSecond,
      integratedMolPerM2,
      durationS: opts.durationS,
      diagnostics: plan.diagnostics
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      status: 'not_applied',
      processId: plan.processId,
      reason: `применение потока не выполнено: ${message}`,
      issues: [],
      error: message
    };
  }
}

// ============================================
// 7. ГЕОХИМИЧЕСКИЙ АДАПТЕР ЭЛЕМЕНТНОГО АУДИТА
// ============================================

/** Диагностика по одному элементу (моли/м² при столбовом основании). */
export interface GeochemicalElementDiagnostics {
  readonly element: string;
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly netExternalCount: number;
  /** before + netExternal − after; 0 означает сохранение в замкнутой системе. */
  readonly residual: number;
}

export interface GeochemicalElementAuditOptions {
  /** Элементы диагностики; по умолчанию GEOCHEMICAL_PRIORITY_ELEMENTS. */
  readonly elements?: readonly string[];
  readonly tolerance?: number;
  readonly scope?: FluxAuditScope;
}

export interface GeochemicalElementAudit {
  /**
   * ЕДИНСТВЕННЫЙ вердикт — результат существующего auditElementConservation
   * ('balanced' | 'imbalanced' | 'approximate' | 'not_verifiable').
   * Адаптер НЕ вводит вторую шкалу и не перекрывает вердикт ядра.
   */
  readonly status: ConservationStatus;
  readonly balanced: boolean;
  readonly discrepancies: readonly BalanceDiscrepancy[];
  readonly excludedSpecies: readonly string[];
  readonly exclusions: readonly AuditExclusion[];
  readonly tolerance: number;
  /** Повэлементная диагностика (только по проверяемым основаниям). */
  readonly elementDiagnostics: readonly GeochemicalElementDiagnostics[];
  /** Пояснения адаптера (не влияют на вердикт). */
  readonly diagnostics: readonly string[];
}

/**
 * Геохимический адаптер аудита сохранения элементов.
 *
 * Использует СУЩЕСТВУЮЩИЕ контракты: SpeciesCatalog + ReservoirRecord +
 * FluxLedger + auditElementConservation; собственный вердикт не
 * формируется. Дополнительно (и только если молярные счёты проверяемы)
 * строится повэлементная диагностика по выбранным элементам:
 *   residual(элемент) = (запас до) + (чистый внеш. перенос) − (запас после).
 * Неизвестный состав вида, неизвестный запас, смешение оснований или
 * непроверяемый внешний поток НЕ ведут к ложному balanced: официальная
 * часть аудита честно возвращает not_verifiable/imbalanced ядра.
 */
export function auditGeochemicalElements(
  catalog: SpeciesCatalog,
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  opts?: GeochemicalElementAuditOptions & AuditOptions
): GeochemicalElementAudit {
  // Официальный вердикт — только контракт ядра.
  const official = auditElementConservation(catalog, ledger, before, after, opts);

  const requested = opts?.elements ?? GEOCHEMICAL_PRIORITY_ELEMENTS;
  const diagnostics: string[] = [];
  const elementDiagnostics: GeochemicalElementDiagnostics[] = [];

  try {
    const beforeCounts = reservoirsToMolarCounts(catalog, before);
    const afterCounts = reservoirsToMolarCounts(catalog, after);
    const netCounts = netExternalMolarCounts(catalog, ledger, opts?.scope);
    const notVerifiable = [beforeCounts, afterCounts, netCounts].some((r) => r.status === 'not_verifiable');
    if (notVerifiable) {
      diagnostics.push(
        'повэлементная диагностика недоступна: молярные счёты непроверяемы (неизвестный запас, неизвестный состав вида или смешение оснований); вердикт auditElementConservation сохранён без изменений'
      );
    } else {
      const totalsBefore = speciesElementTotals(catalog, beforeCounts.counts);
      const totalsAfter = speciesElementTotals(catalog, afterCounts.counts);
      const totalsNet = speciesElementTotals(catalog, netCounts.counts);
      const present = new Set<string>([
        ...Object.keys(totalsBefore.totals),
        ...Object.keys(totalsAfter.totals),
        ...Object.keys(totalsNet.totals)
      ]);
      for (const element of requested) {
        if (!present.has(element)) continue;
        const b = totalsBefore.totals[element] ?? 0;
        const a = totalsAfter.totals[element] ?? 0;
        const n = totalsNet.totals[element] ?? 0;
        const residual = b + n - a;
        if (!Number.isFinite(residual)) {
          diagnostics.push(`элемент «${element}»: остаток непредставим — диагностика не строится`);
          continue;
        }
        elementDiagnostics.push({ element, beforeCount: b, afterCount: a, netExternalCount: n, residual });
      }
      if (elementDiagnostics.length === 0) {
        diagnostics.push('выбранные элементы не представлены в проверяемых счётах системы');
      }
    }
  } catch (e) {
    // Аудит резервуаров может бросать при смешении оснований — это
    // состояние «непроверяемо», а не успех и не дисбаланс; официальный
    // вердикт auditElementConservation при этом уже честен.
    const message = e instanceof Error ? e.message : String(e);
    diagnostics.push(`повэлементная диагностика не выполнена: ${message}`);
  }

  return {
    status: official.status,
    balanced: official.balanced,
    discrepancies: official.discrepancies,
    excludedSpecies: official.excludedSpecies,
    exclusions: official.exclusions,
    tolerance: official.tolerance,
    elementDiagnostics,
    diagnostics
  };
}

// ============================================
// 8. СЕРИАЛИЗАЦИЯ
// ============================================

/** Результат разбора спецификации из внешних данных (JSON сохранения). */
export type GeochemicalSpecParseResult =
  | { readonly status: 'ok'; readonly spec: GeochemicalProcessSpec }
  | { readonly status: 'invalid'; readonly issues: readonly string[] };

/**
 * Разбор спецификации процесса из внешних данных с честной валидацией:
 * неизвестная скорость остаётся неизвестной (числовое значение при
 * status unknown запрещено валидатором), никакие поля не «достраиваются».
 */
export function parseGeochemicalProcessSpec(json: unknown): GeochemicalSpecParseResult {
  const issues = validateGeochemicalProcessSpec(json);
  if (issues.length > 0) {
    return { status: 'invalid', issues };
  }
  return { status: 'ok', spec: json as GeochemicalProcessSpec };
}
