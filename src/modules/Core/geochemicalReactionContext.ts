// ============================================
// GEOCHEMICAL REACTION CONTEXT - контекст геохимической атрибуции записей реакций
// ============================================
//
// Stage 4.9b. Структурная атрибуция геохимической транзакции в
// ReactionRecord — аналог FluxRecord.geochemical (Stage 4.9a.1):
// опциональное поле `geochemical: GeochemicalReactionContext` в
// существующей записи реакции (Core/reactionLedger.ts), отдельный
// plain-JSON объект, а не текст в note и не дубликат GeochemicalProcessSpec.
//
// Требования контракта:
// - schema version контекста;
// - processId / reactionId / mechanism: 'reaction';
// - extent (mol/m²) с единицей и основанием — ЗАВЕРШЁННАЯ степень
//   протекания (не скорость, не равновесие);
// - provenance extent и provenance ОПРЕДЕЛЕНИЯ реакции (обязательны,
//   идентифицированный источник);
// - временная отметка (FluxTime | null);
// - assumptions / applicability / limitations.
//
// Совместимость: отсутствие поля у старой записи — легаси-состояние
// (валидно); ничего задним числом не синтезируется. Валидация
// fail-closed: null вместо контекста — ошибка («отсутствие» выражается
// отсутствием поля, а не null).

// Локальная структурная типизация provenance/time: контексты
// сериализуются в plain-JSON внутри записей реакций; структурная форма
// совместима с DataProvenance (Core/scientificValue.ts) и FluxTime
// (Core/fluxLedger.ts). Реальная проверка идентифицированного
// источника выполняется исполнителем и валидатором ниже
// (sourceName/sourceId/datasetId/reference).

export const GEOCHEMICAL_REACTION_CONTEXT_SCHEMA_VERSION = '1.0.0' as const;
export const GEOCHEMICAL_REACTION_MECHANISM = 'reaction' as const;
export const GEOCHEMICAL_REACTION_EXTENT_UNIT = 'mol_m2' as const;
export const GEOCHEMICAL_REACTION_EXTENT_BASIS = 'column_amount' as const;

/** Данные о происхождении числа (структурно: DataProvenance ядра, без импортного цикла). */
export interface ReactionDataProvenance {
  readonly sourceName?: string;
  readonly sourceId?: string;
  readonly datasetId?: string;
  readonly reference?: string;
  readonly field?: string;
  readonly note?: string;
  readonly [key: string]: unknown;
}

/** Временная отметка (структурно: FluxTime ядра, plain-JSON форма). */
export interface ReactionFluxTime {
  readonly kind: 'simulation' | 'wallclock';
  readonly year?: number | null;
  readonly second?: number | null;
  readonly [key: string]: unknown;
}

/**
 * Геохимический контекст записи реакции. Хранит ТОЛЬКО атрибуцию
 * применённой транзакции: id, extent, provenance, время, допущения.
 * Полный GeochemicalProcessSpec в записи НЕ дублируется.
 */
export interface GeochemicalReactionContext {
  /** Версия схемы контекста. */
  readonly contextSchemaVersion: typeof GEOCHEMICAL_REACTION_CONTEXT_SCHEMA_VERSION;
  /** Геохимический процесс каталога. */
  readonly processId: string;
  /** Определение реакции (для аудита и повторяемости). */
  readonly reactionId: string;
  /** Механизм записи: всегда 'reaction'. */
  readonly mechanism: typeof GEOCHEMICAL_REACTION_MECHANISM;
  /** Завершённая степень протекания, mol/m² (не скорость). */
  readonly extentMolPerM2: number;
  /** Единица extent. */
  readonly extentUnit: typeof GEOCHEMICAL_REACTION_EXTENT_UNIT;
  /** Основание extent (геохимическая конвенция). */
  readonly extentBasis: typeof GEOCHEMICAL_REACTION_EXTENT_BASIS;
  /** Откуда известно значение extent (идентифицированный источник). */
  readonly extentProvenance: ReactionDataProvenance;
  /** Откуда определение реакции: стехиометрия, описание, условия. */
  readonly definitionProvenance: ReactionDataProvenance;
  /** Временная отметка транзакции (null — не привязана). */
  readonly time: ReactionFluxTime | null;
  /** Допущения, сопровождающие исполнение. */
  readonly assumptions: readonly string[];
  /** Диапазон применимости (null — не задан). */
  readonly applicability: string | null;
  /** Ограничения (что исполнение НЕ утверждает). */
  readonly limitations: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isFinitePositive(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

/**
 * Runtime-валидация геохимического контекста записи реакции.
 * Fail-closed: некорректное поле = проблема; null на месте контекста =
 * проблема (отсутствие поля выражается отсутствием поля).
 */
export function validateGeochemicalReactionContext(value: unknown): string[] {
  const issues: string[] = [];
  if (value === null) {
    return ['геохимический контекст записи не может быть null: отсутствие атрибуции выражается отсутствием поля geochemical, а не null-значением'];
  }
  if (!isPlainRecord(value)) {
    return ['геохимический контекст записи должен быть объектом-записью (plain record), а не массивом/строкой/числом/Date/Map/Set/RegExp/экземпляром класса'];
  }
  const c = value as Record<string, unknown>;
  if (c.contextSchemaVersion !== GEOCHEMICAL_REACTION_CONTEXT_SCHEMA_VERSION) {
    issues.push(`contextSchemaVersion контекста должен быть «${GEOCHEMICAL_REACTION_CONTEXT_SCHEMA_VERSION}», получено «${String(c.contextSchemaVersion)}»`);
  }
  for (const key of ['processId', 'reactionId'] as const) {
    if (typeof c[key] !== 'string' || (c[key] as string).trim() === '') {
      issues.push(`«${key}» должен быть непустой строкой`);
    }
  }
  if (c.mechanism !== GEOCHEMICAL_REACTION_MECHANISM) {
    issues.push(`mechanism должен быть «${GEOCHEMICAL_REACTION_MECHANISM}», получено «${String(c.mechanism)}»`);
  }
  if (!isFinitePositive(c.extentMolPerM2)) {
    issues.push('extentMolPerM2 должен быть конечным положительным числом (степень протекания mol/m²); неизвестный extent недопустим в учтённой записи');
  }
  if (c.extentUnit !== GEOCHEMICAL_REACTION_EXTENT_UNIT) {
    issues.push(`extentUnit должен быть «${GEOCHEMICAL_REACTION_EXTENT_UNIT}», получено «${String(c.extentUnit)}»`);
  }
  if (c.extentBasis !== GEOCHEMICAL_REACTION_EXTENT_BASIS) {
    issues.push(`extentBasis должен быть «${GEOCHEMICAL_REACTION_EXTENT_BASIS}» (геохимическая конвенция mol/m²), получено «${String(c.extentBasis)}»`);
  }
  for (const key of ['extentProvenance', 'definitionProvenance'] as const) {
    const p = c[key];
    if (!isPlainRecord(p)) {
      issues.push(`«${key}» должен быть объектом-записью (DataProvenance с идентифицированным источником)`);
      continue;
    }
    const identified =
      (typeof p.sourceName === 'string' && p.sourceName.trim() !== '') ||
      (typeof p.sourceId === 'string' && p.sourceId.trim() !== '') ||
      (typeof p.datasetId === 'string' && p.datasetId.trim() !== '') ||
      (typeof p.reference === 'string' && p.reference.trim() !== '');
    if (!identified) {
      issues.push(`«${key}» должен идентифицировать источник (sourceName, sourceId, datasetId или reference)`);
    }
  }
  const t = c.time;
  if (t !== null && t !== undefined && !isPlainRecord(t)) {
    issues.push('time должен быть plain-JSON отметкой времени либо null');
  }
  if (t !== null && t !== undefined && isPlainRecord(t) && t.kind !== 'simulation' && t.kind !== 'wallclock') {
    issues.push('time.kind должен быть «simulation» или «wallclock»');
  }
  if (c.assumptions !== undefined && !Array.isArray(c.assumptions)) {
    issues.push('assumptions должен быть массивом строк');
  }
  if (c.assumptions !== undefined && Array.isArray(c.assumptions)) {
    for (let i = 0; i < c.assumptions.length; i++) {
      const item = c.assumptions[i];
      if (typeof item !== 'string' || item.trim() === '') {
        issues.push(`assumptions[${i}] должен быть непустой строкой`);
      }
    }
  }
  if (c.applicability !== undefined && c.applicability !== null && typeof c.applicability !== 'string') {
    issues.push('applicability, если задан, должен быть строкой или null');
  }
  if (typeof c.limitations !== 'string' || c.limitations.trim() === '') {
    issues.push('limitations должен быть непустой строкой (что исполнение НЕ утверждает)');
  }
  return issues;
}

/**
 * Собрать геохимический контекст исполняемой записи реакции из
 * проверенного входа исполнителя (см. geochemicalReactionExecution.ts).
 * Экспортируется для тестов исполнительного модуля (round-trip и др.).
 */
export function makeGeochemicalReactionContext(
  input: GeochemicalReactionContext
): GeochemicalReactionContext {
  return {
    contextSchemaVersion: input.contextSchemaVersion,
    processId: input.processId,
    reactionId: input.reactionId,
    mechanism: input.mechanism,
    extentMolPerM2: input.extentMolPerM2,
    extentUnit: input.extentUnit,
    extentBasis: input.extentBasis,
    extentProvenance: { ...input.extentProvenance },
    definitionProvenance: { ...input.definitionProvenance },
    time: input.time !== null && input.time !== undefined ? { ...input.time } : null,
    assumptions: [...input.assumptions],
    applicability: input.applicability !== undefined ? input.applicability : null,
    limitations: input.limitations
  };
}

export function makeSimpleProvenance(sourceName: string): ReactionDataProvenance {
  return {
    sourceName,
    note: 'происхождение задаёт вызывающий код этапа 4.9b; исполнитель не синтезирует источники'
  };
}
