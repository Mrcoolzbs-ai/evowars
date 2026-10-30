// ============================================
// SCIENTIFIC VALUE - Научное значение со статусом, неопределённостью
// и происхождением
// ============================================
//
// Центральный контракт Stage 4.1: научное значение — НЕ голое число.
//
// Семантика статусов (различия не схлопываются в один null):
// - known:           значение известно в рамках явно указанного
//                    источника или модели;
// - estimated:       значение оценено/рассчитано приближённой моделью
//                    (метод оценки сохраняется);
// - unknown:         значение неизвестно; НЕ ноль и НЕ значение
//                    по умолчанию;
// - not_applicable:  характеристика неприменима к объекту в выбранной
//                    модели (твёрдая кора газового гиганта);
// - not_implemented: характеристика проектируется, но соответствующий
//                    модуль ещё не реализован (оценивать её нечем);
// - invalid:         данные присутствуют, но не прошли проверку
//                    (отрицательная абсолютная температура); такими
//                    значениями пользоваться как корректными нельзя.
//
// Неопределённость:
// - НЕ сводится к confidence: 0.8; confidence (качество источника)
//   и неопределённость (разброс значения) — разные вещи;
// - отсутствие uncertainty означает «неопределённость неизвестна»,
//   а НЕ «погрешность равна нулю»;
// - интервал [lower, upper] не объявляется доверительным, если
//   источник этого смысла не задаёт (interpretation — явное поле).
//
// Происхождение (provenance) сохраняется при преобразованиях единиц.

import type { PhysicalQuantity } from './physicalQuantity';
import { convert as convertQuantity } from './physicalQuantity';

// ============================================
// 1. СТАТУС И ОШИБКА
// ============================================

export type DataStatus =
  | 'known'
  | 'estimated'
  | 'unknown'
  | 'not_applicable'
  | 'not_implemented'
  | 'invalid';

export class ScientificValueError extends Error {
  readonly code: 'non_numeric_status' | 'invalid_uncertainty' | 'invalid_value';
  readonly component = 'ScientificValue';
  readonly status: DataStatus | null;

  constructor(code: 'non_numeric_status' | 'invalid_uncertainty' | 'invalid_value', message: string, status: DataStatus | null) {
    super(`[ScientificValue] ${message}`);
    this.name = 'ScientificValueError';
    this.code = code;
    this.status = status;
  }
}

// ============================================
// 2. НЕОПРЕДЕЛЁННОСТЬ
// ============================================

/**
 * Неопределённость значения. Разные виды не смешиваются:
 * интервал, стандартное отклонение, относительная оценка или
 * односторонняя граница (точное распределение неизвестно).
 * Нулевая неопределённость должна быть задана ЯВНО — её отсутствие
 * означает «неизвестна», а не «равна нулю».
 */
export type Uncertainty =
  | {
      kind: 'interval';
      /** Нижняя граница в единицах значения. */
      lower: number;
      /** Верхняя граница в единицах значения. */
      upper: number;
      /** Семантика интервала, если источник её задаёт (иначе — просто границы). */
      interpretation?: string;
      note?: string;
    }
  | {
      kind: 'stddev';
      /** Стандартное отклонение в единицах значения; sigma >= 0. */
      sigma: number;
      interpretation?: string;
      note?: string;
    }
  | {
      kind: 'relative';
      /** Относительная неопределённость (доля), >= 0; 0.01 = 1%. */
      fraction: number;
      note?: string;
    }
  | {
      kind: 'bounded';
      /** Направление: значение известно снизу/сверху, распределение неизвестно. */
      direction: 'above' | 'below';
      /** Граница в единицах значения. */
      bound: number;
      note?: string;
    };

/** Проверка неопределённости. Возвращает список ошибок (пустой = корректна). */
export function validateUncertainty(u: Uncertainty): string[] {
  const errors: string[] = [];
  switch (u.kind) {
    case 'interval':
      if (!Number.isFinite(u.lower) || !Number.isFinite(u.upper)) {
        errors.push('границы интервала должны быть конечными числами');
      } else if (u.lower > u.upper) {
        errors.push(`некорректный интервал [${u.lower}, ${u.upper}]: нижняя граница больше верхней`);
      }
      break;
    case 'stddev':
      if (!Number.isFinite(u.sigma) || u.sigma < 0) {
        errors.push(`стандартное отклонение должно быть неотрицательным числом, получено ${u.sigma}`);
      }
      break;
    case 'relative':
      if (!Number.isFinite(u.fraction) || u.fraction < 0) {
        errors.push(`относительная неопределённость должна быть неотрицательной, получено ${u.fraction}`);
      }
      break;
    case 'bounded':
      if (!Number.isFinite(u.bound)) {
        errors.push('граница должна быть конечным числом');
      }
      break;
  }
  return errors;
}

/**
 * Преобразование неопределённости при смене единицы.
 * Аффинных шкал в реестре нет, поэтому линейное преобразование
 * достаточно. Возвращает null, если результат неопределим.
 */
export function convertUncertainty(u: Uncertainty, fromUnit: string, toUnit: string): Uncertainty | null {
  const probe = convertQuantity({ value: 1, unit: fromUnit }, toUnit).value;
  if (!Number.isFinite(probe)) return null;
  switch (u.kind) {
    case 'interval':
      return {
        kind: 'interval',
        lower: u.lower * probe,
        upper: u.upper * probe,
        interpretation: u.interpretation,
        note: u.note
      };
    case 'stddev':
      return { kind: 'stddev', sigma: u.sigma * probe, interpretation: u.interpretation, note: u.note };
    case 'relative':
      return { kind: 'relative', fraction: u.fraction, note: u.note };
    case 'bounded':
      return { kind: 'bounded', direction: u.direction, bound: u.bound * probe, note: u.note };
  }
}

// ============================================
// 3. ПРОИСХОЖДЕНИЕ
// ============================================

/**
 * Происхождение значения. Все поля необязательны: отсутствие
 * метаданных НЕ маскируется фиктивными данными (пустая строка —
 * это отсутствие значения, а не «источник неизвестен» в смысле
 * легаси PhysValue.source: ''). Никакие идентификаторы источников,
 * версии и лицензии не выдумываются.
 */
export interface DataProvenance {
  /** Название источника. */
  sourceName?: string;
  /** Идентификатор источника. */
  sourceId?: string;
  /** Идентификатор набора данных. */
  datasetId?: string;
  /** Версия набора данных. */
  datasetVersion?: string;
  /** Идентификатор записи внутри набора. */
  recordId?: string;
  /** Ссылка на первичный источник. */
  reference?: string;
  /** Дата или версия извлечения данных. */
  retrievedAt?: string;
  /** Метод получения значения (расчёт, интерполяция, измерение). */
  method?: string;
  /** Исходные данные или параметры преобразования. */
  rawInput?: Record<string, number | string | boolean | null>;
  /** Область применимости значения. */
  applicability?: string;
  /** Ограничения использования. */
  limitations?: string;
  /** Условия, при которых значение действительно. */
  conditions?: string;
  /** Версия модели, если значение рассчитано моделью. */
  modelVersion?: string;
  /** Лицензия набора данных или статус её определения. */
  license?: string;
  /** Свободное примечание. */
  note?: string;
}

// ============================================
// 4. НАУЧНОЕ ЗНАЧЕНИЕ
// ============================================

/**
 * Научное значение: discriminated union по статусу.
 * Числовое содержание есть только у known/estimated/invalid
 * (у invalid — как отклонённые данные для диагностики).
 */
export type ScientificValue =
  | {
      status: 'known';
      quantity: PhysicalQuantity;
      uncertainty?: Uncertainty;
      provenance?: DataProvenance;
    }
  | {
      status: 'estimated';
      quantity: PhysicalQuantity;
      /** Метод/модель оценки — обязателен, иначе оценка безследна. */
      method: string;
      uncertainty?: Uncertainty;
      provenance?: DataProvenance;
    }
  | {
      status: 'unknown';
      note?: string;
      provenance?: DataProvenance;
    }
  | {
      status: 'not_applicable';
      reason: string;
    }
  | {
      status: 'not_implemented';
      note?: string;
    }
  | {
      status: 'invalid';
      reason: string;
      /** Отклонённые данные (для диагностики), использовать как корректное значение запрещено. */
      quantity?: PhysicalQuantity;
      provenance?: DataProvenance;
    };

// ============================================
// 5. КОНСТРУКТОРЫ И ОПЕРАЦИИ
// ============================================

/** Значение известно (в рамках явно указанного источника или модели). */
export function knownValue(quantity: PhysicalQuantity, opts?: { uncertainty?: Uncertainty; provenance?: DataProvenance }): ScientificValue {
  if (opts?.uncertainty && validateUncertainty(opts.uncertainty).length > 0) {
    throw new ScientificValueError('invalid_uncertainty', `некорректная неопределённость: ${validateUncertainty(opts.uncertainty).join('; ')}`, null);
  }
  return { status: 'known', quantity, uncertainty: opts?.uncertainty, provenance: opts?.provenance };
}

/** Значение оценено; метод оценки обязателен и сохраняется. */
export function estimatedValue(quantity: PhysicalQuantity, method: string, opts?: { uncertainty?: Uncertainty; provenance?: DataProvenance }): ScientificValue {
  if (method.trim() === '') {
    throw new ScientificValueError('invalid_value', 'estimated-значение требует непустого метода оценки', 'estimated');
  }
  if (opts?.uncertainty && validateUncertainty(opts.uncertainty).length > 0) {
    throw new ScientificValueError('invalid_uncertainty', `некорректная неопределённость: ${validateUncertainty(opts.uncertainty).join('; ')}`, 'estimated');
  }
  return { status: 'estimated', quantity, method, uncertainty: opts?.uncertainty, provenance: opts?.provenance };
}

/** Значение неизвестно. Не превращается в ноль или значение по умолчанию. */
export function unknownValue(note?: string, provenance?: DataProvenance): ScientificValue {
  return { status: 'unknown', note, provenance };
}

/** Характеристика неприменима к объекту в выбранной модели. */
export function notApplicable(reason: string): ScientificValue {
  return { status: 'not_applicable', reason };
}

/** Характеристика проектируется, но модуль расчёта не реализован. */
export function notImplemented(note?: string): ScientificValue {
  return { status: 'not_implemented', note };
}

/** Данные присутствуют, но не прошли проверку. Как корректное значение не используется. */
export function invalidValue(reason: string, quantity?: PhysicalQuantity, provenance?: DataProvenance): ScientificValue {
  return { status: 'invalid', reason, quantity, provenance };
}

/**
 * Явное преобразование единицы числового научного значения.
 * Статус, метод оценки, provenance сохраняются; неопределённость
 * пересчитывается в новые единицы. Неопределённость не теряется.
 */
export function convertScientificValueUnit(v: ScientificValue, targetUnit: string): ScientificValue {
  if (v.status === 'known' || v.status === 'estimated') {
    const q = convertQuantity(v.quantity, targetUnit);
    const uncertainty = v.uncertainty ? convertUncertainty(v.uncertainty, v.quantity.unit, targetUnit) : undefined;
    if (v.status === 'estimated') {
      return { status: 'estimated', quantity: q, method: v.method, uncertainty, provenance: v.provenance };
    }
    return { status: 'known', quantity: q, uncertainty, provenance: v.provenance };
  }
  // Для статусов без числового содержания преобразование единицы
  // бессмысленно — значение возвращается без изменений (это НЕ
  // ошибка: у Unknown нет числа, которое можно было бы перевести).
  return v;
}

/** Есть ли числовое содержание, пригодное для использования в расчётах. */
export function hasUsableQuantity(v: ScientificValue): v is Extract<ScientificValue, { status: 'known' | 'estimated' }> {
  return v.status === 'known' || v.status === 'estimated';
}

/**
 * Получить числовую величину. Unknown/NotApplicable/NotImplemented/
 * Invalid использовать как число нельзя — структурированная ошибка
 * вместо молчаливого нуля.
 */
export function expectQuantity(operation: string, v: ScientificValue): PhysicalQuantity {
  if (hasUsableQuantity(v)) {
    return v.quantity;
  }
  const reason =
    v.status === 'invalid'
      ? `данные отклонены: ${v.reason}`
      : v.status === 'not_applicable'
        ? `характеристика неприменима: ${v.reason}`
        : v.status === 'not_implemented'
          ? `расчёт не реализован${v.note !== undefined ? `: ${v.note}` : ''}`
          : `значение неизвестно${v.note !== undefined ? `: ${v.note}` : ''}`;
  throw new ScientificValueError(
    'non_numeric_status',
    `операция «${operation}» требует числового значения, получен статус «${v.status}» (${reason})`,
    v.status
  );
}

/**
 * Мягкое извлечение: числовая величина для known/estimated, null для
 * остальных статусов (включая invalid). Удобно для аудита, где
 * отсутствие числа — нормальная ситуация, а не ошибка.
 */
export function quantityOrNull(v: ScientificValue): PhysicalQuantity | null {
  return hasUsableQuantity(v) ? v.quantity : null;
}

/** Статус значения. */
export function statusOf(v: ScientificValue): DataStatus {
  return v.status;
}
