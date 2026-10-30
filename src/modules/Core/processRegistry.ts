// ============================================
// PROCESS REGISTRY - Реестр физических процессов
// ============================================
//
// Stage 4.2.1. Реестр ОПИСЫВАЕТ физические процессы, но НЕ выполняет
// их: дескрипторы — сериализуемые данные (τ, политика шага, статус
// решателя, provenance); runtime-исполнители передаются планировщику
// отдельно и в состоянии мира не хранятся (см. scheduler.ts).
//
// Научная семантика характерного времени τ:
// - τ — физически значимая величина в секундах, представленная
//   как ScientificValue с размерностью времени и provenance;
// - если данных недостаточно — tau = unknownValue с явной причиной;
//   текстовые описания («миллионы лет», timescaleNote) НЕ являются
//   числом и автоматически в τ не преобразуются;
// - процесс с неизвестным τ или недоступным решателем НЕ может
//   запускаться автоматически (isProcessAutoRunnable = false);
// - политика шага dt ≤ τ/20 — ТОЛЬКО предварительная эвристика
//   (stepPolicy 'tau_heuristic'): окончательный шаг выбирает
//   конкретный solver (устойчивость, локальная ошибка, жёсткость,
//   физические события). Универсального dt для всех подсистем НЕТ.
//
// Реестр — архитектурный механизм, а не источник физики: скорости,
// константы и доступность без источников не назначаются.

import type { DataProvenance, ScientificValue } from './scientificValue';
import { hasUsableQuantity, validateScientificValueShape } from './scientificValue';
import { convert } from './physicalQuantity';
import { isPlainRecord } from './reservoir';

// ============================================
// 1. ТИПЫ
// ============================================

/** Классы физических процессов ядра (описательные метки). */
export type ProcessKind =
  | 'chemical'
  | 'photochemical'
  | 'thermal'
  | 'orbital'
  | 'geological'
  | 'radiative'
  | 'biological'
  | 'other';

export const PROCESS_KINDS: readonly ProcessKind[] = [
  'chemical',
  'photochemical',
  'thermal',
  'orbital',
  'geological',
  'radiative',
  'biological',
  'other'
];

/**
 * Статус численного решателя процесса:
 * - available       — решатель реализован и доступен;
 * - scheduled       — решатель запланирован (будущий подэтап);
 * - not_implemented — решатель не реализован;
 * - unknown         — статус решателя неизвестен.
 */
export type SolverAvailability = 'available' | 'scheduled' | 'not_implemented' | 'unknown';

export const SOLVER_AVAILABILITY_STATUSES: readonly SolverAvailability[] = [
  'available',
  'scheduled',
  'not_implemented',
  'unknown'
];

/**
 * Итоговая доступность процесса (производная: enabled + решатель + τ):
 * - available       — может запускаться автоматически планировщиком;
 * - scheduled       — решатель запланирован, исполнения пока нет;
 * - not_implemented — решатель не реализован;
 * - disabled        — процесс явно отключён;
 * - unknown         — τ неизвестно или статус решателя неизвестен.
 */
export type ProcessAvailability =
  | 'available'
  | 'scheduled'
  | 'not_implemented'
  | 'disabled'
  | 'unknown';

export const PROCESS_AVAILABILITIES: readonly ProcessAvailability[] = [
  'available',
  'scheduled',
  'not_implemented',
  'disabled',
  'unknown'
];

/**
 * Политика шага процесса:
 * - unspecified  — шаг задаёт конкретный solver (по умолчанию);
 * - tau_heuristic — предварительная эвристика dt ≤ tauFraction × τ;
 *   окончательный шаг всё равно выбирает solver.
 */
export type ProcessStepPolicy =
  | { kind: 'unspecified'; note?: string }
  | { kind: 'tau_heuristic'; tauFraction: number; note?: string };

/** Дескриптор физического процесса (сериализуемое описание). */
export interface ProcessDescriptor {
  /** Уникальный идентификатор процесса. */
  id: string;
  /** Человеческое имя процесса. */
  name: string;
  /** Класс процесса. */
  processKind: ProcessKind;
  /** Характерное время τ (научное значение с размерностью времени). */
  tau: ScientificValue;
  /** Рекомендуемый шаг или политика шага. */
  stepPolicy: ProcessStepPolicy;
  /** Статус численного решателя процесса. */
  solverAvailability: SolverAvailability;
  /** Явный переключатель: процесс включён или отключён. */
  enabled: boolean;
  /** Происхождение данных о процессе. */
  provenance?: DataProvenance;
  /** Область применимости процесса. */
  applicability?: string;
  /** Допущения, при которых описание процесса имеет смысл. */
  assumptions?: string;
  /** Текстовое описание масштаба времени (легаси timescaleNote) — НЕ число. */
  timescaleNote?: string;
  /** Зависимости и порядок композиции (идентификаторы процессов). */
  dependencies?: string[];
}

// ============================================
// 2. ОШИБКА
// ============================================

export class ProcessRegistryError extends Error {
  readonly code: 'invalid_descriptor' | 'duplicate_id';
  readonly component = 'ProcessRegistry';
  readonly processId: string | null;

  constructor(code: 'invalid_descriptor' | 'duplicate_id', message: string, processId: string | null) {
    super('[ProcessRegistry/' + code + '] ' + message);
    this.name = 'ProcessRegistryError';
    this.code = code;
    this.processId = processId;
  }
}

// ============================================
// 3. τ И ПОЛИТИКА ШАГА
// ============================================

/**
 * Числовое τ в секундах; null, если τ неизвестно или непригодно.
 * null — НЕ ноль и НЕ «процесс мгновенный»: неизвестное время
 * не превращается в число.
 */
export function tauSeconds(v: ScientificValue): number | null {
  if (!hasUsableQuantity(v)) {
    return null;
  }
  try {
    return convert(v.quantity, 's').value;
  } catch {
    // Непригодная размерность τ: как неизвестное для исполнения;
    // структурный дефект дескриптора ловится validateProcessDescriptor.
    return null;
  }
}

/**
 * Предварительный шаг по эвристике dt ≤ tauFraction × τ, с;
 * null — эвристика не задана или τ неизвестно.
 * Возвращённое значение НЕ является обязательным шагом процесса:
 * окончательный шаг выбирает конкретный solver.
 */
export function heuristicStepSeconds(d: ProcessDescriptor): number | null {
  if (d.stepPolicy.kind !== 'tau_heuristic') {
    return null;
  }
  const tau = tauSeconds(d.tau);
  return tau === null ? null : tau * d.stepPolicy.tauFraction;
}

// ============================================
// 4. ДОСТУПНОСТЬ
// ============================================

/** Итоговая доступность процесса для автоматического запуска. */
export function processAvailability(d: ProcessDescriptor): ProcessAvailability {
  if (!d.enabled) {
    return 'disabled';
  }
  switch (d.solverAvailability) {
    case 'not_implemented':
      return 'not_implemented';
    case 'scheduled':
      return 'scheduled';
    case 'unknown':
      return 'unknown';
    case 'available': {
      // Решатель есть, но без числового τ автоматический запуск
      // невозможен: неизвестное время не подменяется числом.
      return tauSeconds(d.tau) !== null ? 'available' : 'unknown';
    }
    default: {
      const exhaustive: never = d.solverAvailability;
      throw new ProcessRegistryError(
        'invalid_descriptor',
        'неизвестный статус решателя: ' + String(exhaustive),
        d.id
      );
    }
  }
}

/** Может ли процесс запускаться автоматически планировщиком. */
export function isProcessAutoRunnable(d: ProcessDescriptor): boolean {
  return processAvailability(d) === 'available';
}

// ============================================
// 5. ВАЛИДАЦИЯ ДЕСКРИПТОРА
// ============================================

/**
 * Проверка формы дескриптора (данные могут приходить из JSON).
 * Возвращает список проблем; пустой список = форма корректна.
 * Физическую правильность τ эта проверка не доказывает — только
 * размерность времени и явность статуса.
 */
export function validateProcessDescriptor(d: unknown): string[] {
  if (!isPlainRecord(d)) {
    return ['дескриптор процесса должен быть обычным объектом-словарём'];
  }
  const errors: string[] = [];

  if (typeof d.id !== 'string' || d.id.trim() === '') {
    errors.push('id должен быть непустой строкой');
  }
  if (typeof d.name !== 'string' || d.name.trim() === '') {
    errors.push('name должен быть непустой строкой');
  }
  if (typeof d.processKind !== 'string' || !(PROCESS_KINDS as readonly string[]).includes(d.processKind)) {
    errors.push(
      'processKind должен быть одним из: ' + PROCESS_KINDS.join(', ') + '; получено «' + String(d.processKind) + '»'
    );
  }

  // τ — научное значение; числовое τ обязано иметь размерность времени.
  const tauShapeIssues = validateScientificValueShape(d.tau);
  for (const issue of tauShapeIssues) {
    errors.push('tau: ' + issue);
  }
  if (tauShapeIssues.length === 0 && d.tau !== undefined) {
    const tau = d.tau as ScientificValue;
    if (hasUsableQuantity(tau)) {
      try {
        convert(tau.quantity, 's');
      } catch {
        errors.push(
          'tau: числовое τ обязано иметь размерность времени; получена единица «' + tau.quantity.unit + '»'
        );
      }
    }
  }

  if (!isPlainRecord(d.stepPolicy)) {
    errors.push('stepPolicy должен быть объектом-словарём');
  } else if (d.stepPolicy.kind === 'tau_heuristic') {
    const fraction = d.stepPolicy.tauFraction;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
      errors.push(
        'tauFraction должен быть конечным числом в (0, 1] (эвристика dt ≤ τ/20 — предварительная); получено ' + String(fraction)
      );
    }
  } else if (d.stepPolicy.kind !== 'unspecified') {
    errors.push(
      "stepPolicy.kind должен быть 'unspecified' или 'tau_heuristic'; получено «" + String(d.stepPolicy.kind) + '»'
    );
  }
  if (isPlainRecord(d.stepPolicy) && d.stepPolicy.note !== undefined && typeof d.stepPolicy.note !== 'string') {
    errors.push('stepPolicy.note должен быть строкой');
  }

  if (
    typeof d.solverAvailability !== 'string' ||
    !(SOLVER_AVAILABILITY_STATUSES as readonly string[]).includes(d.solverAvailability)
  ) {
    errors.push(
      'solverAvailability должен быть одним из: ' +
        SOLVER_AVAILABILITY_STATUSES.join(', ') +
        '; получено «' +
        String(d.solverAvailability) +
        '»'
    );
  }
  if (typeof d.enabled !== 'boolean') {
    errors.push('enabled должен быть boolean');
  }
  if (d.provenance !== undefined && !isPlainRecord(d.provenance)) {
    errors.push('provenance должен быть объектом-словарём');
  }
  for (const key of ['applicability', 'assumptions', 'timescaleNote'] as const) {
    if (d[key] !== undefined && typeof d[key] !== 'string') {
      errors.push('«' + key + '» должен быть строкой, если задан');
    }
  }
  if (d.dependencies !== undefined) {
    if (!Array.isArray(d.dependencies)) {
      errors.push('dependencies должен быть массивом идентификаторов');
    } else {
      for (const dep of d.dependencies) {
        if (typeof dep !== 'string' || dep.trim() === '') {
          errors.push('каждый элемент dependencies должен быть непустой строкой');
          break;
        }
      }
    }
  }
  return errors;
}

// ============================================
// 6. РЕЕСТР
// ============================================

/** Реестр процессов: регистрация и детерминированный доступ. */
export interface ProcessRegistry {
  /** Зарегистрировать дескриптор; дубликаты идентификаторов запрещены. */
  register(descriptor: ProcessDescriptor): ProcessRegistry;
  /** Дескриптор по идентификатору; null — не зарегистрирован. */
  get(processId: string): ProcessDescriptor | null;
  /** Есть ли процесс с таким идентификатором. */
  has(processId: string): boolean;
  /**
   * Стабильный список дескрипторов в порядке регистрации.
   * Порядок детерминирован: реестр не переупорядочивает процессы.
   */
  list(): readonly ProcessDescriptor[];
}

/** Пустой реестр процессов. */
export function createProcessRegistry(): ProcessRegistry {
  const byId = new Map<string, ProcessDescriptor>();
  const registry: ProcessRegistry = {
    register(descriptor) {
      const issues = validateProcessDescriptor(descriptor);
      if (issues.length > 0) {
        const id = isPlainRecord(descriptor) && typeof descriptor.id === 'string' ? descriptor.id : null;
        throw new ProcessRegistryError(
          'invalid_descriptor',
          'дескриптор некорректен: ' + issues.join('; '),
          id
        );
      }
      if (byId.has(descriptor.id)) {
        throw new ProcessRegistryError(
          'duplicate_id',
          'процесс «' + descriptor.id + '» уже зарегистрирован: идентификаторы должны быть уникальны',
          descriptor.id
        );
      }
      byId.set(descriptor.id, descriptor);
      return registry;
    },
    get(processId) {
      return byId.get(processId) ?? null;
    },
    has(processId) {
      return byId.has(processId);
    },
    list() {
      return Array.from(byId.values());
    }
  };
  return registry;
}
