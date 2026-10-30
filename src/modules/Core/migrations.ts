// ============================================
// DATASET VERSIONING & SAVE MIGRATIONS
// ============================================
//
// Разделяются ПЯТЬ разных версий (это не одно и то же):
// 1. версия схемы данных (сериализуемых структур ядра) —
//    CORE_WORLD_STATE_SCHEMA_VERSION в worldState.ts;
// 2. версия набора научных данных — DatasetDescriptor.version;
// 3. версия модели — в provenance значения (modelVersion);
// 4. версия алгоритма/генератора — GENERATOR_VERSION;
// 5. версия сохранённого мира — SavedWorld.version (схема сохранений).
//
// Управление версиями сохранений:
// - миграции детерминированы и образуют цепочку;
// - миграция никогда не превращает отсутствующее значение в число:
//    «нет поля» остаётся «неизвестно», а не нулём; provenance
//    не теряется; неприменимое не становится неизвестным;
// - каждая миграция оставляет след в SavedWorld.migration.notes:
//    историю преобразований можно проверить после загрузки;
// - поддержка старых сохранений не удаляется с появлением новой
//    внутренней модели.

// ============================================
// 1. НАУЧНЫЕ НАБОРЫ ДАННЫХ
// ============================================

/**
 * Дескриптор набора научных данных. Поля не выдумываются:
 * если лицензия/контрольная сумма не определены, они остаются
 * undefined — пустая строка скрывала бы отсутствие данных.
 * Включение публичного набора в приложение не означает права
 * на его распространение: licenseStatus обязателен при использовании.
 */
export interface DatasetDescriptor {
  /** Стабильный идентификатор набора. */
  id: string;
  /** Версия набора (не схема, не модель — именно версия данных). */
  version: string;
  name?: string;
  source?: string;
  reference?: string;
  retrievedAt?: string;
  /** Лицензия или статус её определения. */
  licenseStatus?: 'public_domain' | 'permissive' | 'restricted' | 'unknown';
  licenseNote?: string;
  /** Контрольная сумма, если она действительно рассчитывалась. */
  checksum?: string;
  restrictions?: string[];
  note?: string;
}

/** Реестр известных наборов данных (по id + версия). */
export interface DatasetRegistry {
  register(descriptor: DatasetDescriptor): void;
  get(id: string, version: string): DatasetDescriptor | null;
  has(id: string, version: string): boolean;
  list(): readonly DatasetDescriptor[];
}

export function createDatasetRegistry(): DatasetRegistry {
  const byKey = new Map<string, DatasetDescriptor>();
  return {
    register(descriptor: DatasetDescriptor): void {
      if (descriptor.id.trim() === '') {
        throw new Error('[DatasetRegistry] идентификатор набора данных не может быть пустым');
      }
      if (descriptor.version.trim() === '') {
        throw new Error(`[DatasetRegistry] версия набора «${descriptor.id}» не может быть пустой`);
      }
      byKey.set(`${descriptor.id}@${descriptor.version}`, descriptor);
    },
    get(id: string, version: string): DatasetDescriptor | null {
      return byKey.get(`${id}@${version}`) ?? null;
    },
    has(id: string, version: string): boolean {
      return byKey.has(`${id}@${version}`);
    },
    list(): readonly DatasetDescriptor[] {
      return [...byKey.values()];
    }
  };
}

// ============================================
// 2. СХЕМА СОХРАНЕНИЙ И ЦЕПОЧКА МИГРАЦИЙ
// ============================================

/**
 * История версий формата сохранений:
 * - 1.0 — формат этапа 1–2 (без физической модели);
 * - 1.1 — этап 3: опциональные поля физической модели; отсутствие
 *         поля = «неизвестно», значения не пересоздаются;
 * - 1.2 — этап 4.1: опциональное поле coreWorldState (состояние
 *         ядра: часы, тела, резервуары, потоки); отсутствие поля
 *         = «ядро не инициализировано», значения не пересоздаются;
 * - 1.3 — этап 4.2.1: опциональное поле coreWorldState.scheduling
 *         (динамика процессов планировщика, очередь событий мира,
 *         журнал шагов); отсутствие = «планировщик не
 *         инициализирован», значения не пересоздаются.
 */
export const SAVE_SCHEMA_VERSIONS = ['1.0', '1.1', '1.2', '1.3'] as const;
export type SaveSchemaVersion = (typeof SAVE_SCHEMA_VERSIONS)[number];
export const CURRENT_SAVE_SCHEMA_VERSION: SaveSchemaVersion = '1.3';

export function isKnownSchemaVersion(version: string): boolean {
  return (SAVE_SCHEMA_VERSIONS as readonly string[]).includes(version);
}

/**
 * Ошибка миграции сохранений (Stage 4.1.1). Раньше любая неизвестная
 * версия молча трактовалась как 1.0: сохранение из будущего ('2.0')
 * или мусорная строка ('abc') «мигрировали» из выдуманной версии.
 * Теперь политика честная и различается:
 * - 'invalid_version' — строка версии не является семантической
 *   версией схемы ('abc', '2', '');
 * - 'unsupported_version' — версия корректна по формату, но ядро
 *   её не поддерживает ('0.9', '1.4', '2.0');
 * - 'missing_migration_path' — нет шага цепочки к целевой версии;
 * - 'migration_failed' — шаг цепочки завершился ошибкой.
 * Каждый бросок содержит исходную и целевую версии.
 */
export class MigrationError extends Error {
  readonly code: 'unsupported_version' | 'invalid_version' | 'missing_migration_path' | 'migration_failed';
  readonly component = 'SaveMigration';
  readonly fromVersion: string;
  readonly toVersion: string;

  constructor(code: MigrationError['code'], message: string, fromVersion: string, toVersion: string) {
    super(`[SaveMigration/${code}] ${message}`);
    this.name = 'MigrationError';
    this.code = code;
    this.fromVersion = fromVersion;
    this.toVersion = toVersion;
  }
}

/** Формат версии схемы сохранений: X.Y или X.Y.Z (семвер без суффиксов). */
export const VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?$/;

/**
 * Минимальная структура, с которой работают миграции.
 * СПЕЦИАЛЬНО без строкового индекс-сигнатуры: интерфейсы (SavedWorld)
 * не получают неявного индекс-типа и иначе не удовлетворяли бы
 * ограничению generic-параметра.
 */
export interface MigrationTarget {
  savedAt: string;
  version: string | undefined;
  migration?: { from: string; notes: string[] };
}

export interface SaveMigrationResult<T extends MigrationTarget> {
  world: T;
  notes: string[];
}

export interface SaveMigration<T extends MigrationTarget = MigrationTarget> {
  from: SaveSchemaVersion;
  to: SaveSchemaVersion;
  migrate(world: T): SaveMigrationResult<T>;
}

/**
 * Миграция 1.0 → 1.1 (унаследована от этапа 3).
 * Новые физические поля НЕ создаются: их отсутствие означает
 * «неизвестно». Легаси totalPressure остаётся в atm и не
 * переписывается: пересчёт в Па — задача модели на лету.
 */
const migrate10to11: SaveMigration<any> = {
  from: '1.0',
  to: '1.1',
  migrate(world: any): SaveMigrationResult<any> {
    return {
      world: { ...world, version: '1.1' },
      notes: [
        'добавлены опциональные поля физической модели этапа 3 (система центрального объекта, орбита, физика тела, атмосферная модель, фазовый анализ, геология, энергетический бюджет, химическое состояние): их отсутствие означает «неизвестно», значения не пересоздаются',
        'totalPressure сохранено в исторических единицах atm; значение в Па вычисляется моделью на лету и не заменяет исходное'
      ]
    };
  }
};

/**
 * Миграция 1.1 → 1.2 (этап 4.1).
 * Поле coreWorldState НЕ создаётся: ядру мира нужны данные,
 * которых в старом сохранении нет. Отсутствие поля = «ядро не
 * инициализировано», а не «нулевой мир». Никакие значения не
 * пересчитываются и не «дозаполняются».
 */
const migrate11to12: SaveMigration<any> = {
  from: '1.1',
  to: '1.2',
  migrate(world: any): SaveMigrationResult<any> {
    if (world.coreWorldState !== undefined) {
      // Поле уже есть (например, частично обновлённое сохранение) —
      // не перезаписываем чужие данные.
      return { world: { ...world, version: '1.2' }, notes: [] };
    }
    return {
      world: { ...world, version: '1.2' },
      notes: [
        'добавлено опциональное поле coreWorldState (состояние научного ядра: часы, тела, резервуары, потоки): его отсутствие означает «ядро не инициализировано», значения не пересоздаются'
      ]
    };
  }
};

/**
 * Миграция 1.2 → 1.3 (этап 4.2.1).
 * Поле coreWorldState.scheduling НЕ создаётся: динамика процессов и
 * очередь событий принадлежат планировщику, их отсутствие —
 * «планировщик не инициализирован», а не нулевое состояние. Часы и
 * физические значения НЕ пересчитываются: легаси химическое время
 * (modelTimeYears) не переносится в локальные секунды WorldClock
 * (это разные величины), космический возраст не переносится в часы.
 */
const migrate12to13: SaveMigration<any> = {
  from: '1.2',
  to: '1.3',
  migrate(world: any): SaveMigrationResult<any> {
    if (world.coreWorldState?.scheduling !== undefined) {
      // Поле уже есть — не перезаписываем чужие данные.
      return { world: { ...world, version: '1.3' }, notes: [] };
    }
    return {
      world: { ...world, version: '1.3' },
      notes: [
        'добавлено опциональное поле coreWorldState.scheduling (динамика процессов планировщика, очередь событий мира, журнал шагов): его отсутствие означает «планировщик не инициализирован», значения не пересоздаются'
      ]
    };
  }
};

const MIGRATIONS: readonly SaveMigration<any>[] = [migrate10to11, migrate11to12, migrate12to13];

/**
 * Полная цепочка миграций. Детерминирована: одна и та же входная
 * версия всегда даёт один и тот же результат.
 *
 * Stage 4.1.1 — честная политика версий:
 * - version === undefined — легаси-сохранение этапа 1-2:
 *   трактуется как 1.0 С ЯВНОЙ записью в истории миграции;
 * - версия известна (1.0 / 1.1 / 1.2 / 1.3) — мигрируется цепочкой;
 * - версия корректна по формату, но неизвестна ядру ('0.9', '1.4',
 *   '2.0') — MigrationError 'unsupported_version': сохранение из
 *   будущего не «мигрируется» из выдуманной версии и не
 *   уничтожается молча (Storage сохраняет его как есть);
 * - версия мусорная ('abc', '2', '') — MigrationError
 *   'invalid_version';
 * - отсутствующий шаг цепочки — MigrationError 'missing_migration_path';
 * - оригинал НЕ мутируется: все преобразования идут по копиям.
 */
export function migrateSavedWorld<T extends MigrationTarget>(world: T, target: SaveSchemaVersion = CURRENT_SAVE_SCHEMA_VERSION): { world: T; notes: string[]; from: string; to: string } {
  const rawVersion = world.version;
  let from: SaveSchemaVersion;
  const notes: string[] = [];
  if (rawVersion === undefined) {
    from = '1.0';
    notes.push('исходная версия сохранения не указана: сохранение трактовано как схема 1.0 (легаси формат этапа 1-2)');
  } else if (!VERSION_PATTERN.test(rawVersion)) {
    throw new MigrationError(
      'invalid_version',
      `версия сохранения «${rawVersion}» не является корректной семантической версией схемы (ожидается X.Y или X.Y.Z)`,
      rawVersion,
      target
    );
  } else if (!isKnownSchemaVersion(rawVersion)) {
    throw new MigrationError(
      'unsupported_version',
      `версия схемы сохранений «${rawVersion}» не поддерживается (поддерживаются: ${SAVE_SCHEMA_VERSIONS.join(', ')})`,
      rawVersion,
      target
    );
  } else {
    // Формат уже проверен VERSION_PATTERN и реестром версий.
    from = rawVersion as SaveSchemaVersion;
  }
  // Уже целевая схема: возвращаем как есть (идемпотентность —
  // повторная миграция не переписывает историю и не плодит записи).
  if (from === target && rawVersion === target) {
    return { world, notes: [], from, to: target };
  }
  let current: T = { ...world, version: from };
  let currentVersion: SaveSchemaVersion = from;

  let guard = 0;
  while (currentVersion !== target) {
    const step = MIGRATIONS.find((m) => m.from === currentVersion);
    if (!step) {
      throw new MigrationError(
        'missing_migration_path',
        `нет миграции из схемы «${currentVersion}» к «${target}»: цепочка не определена`,
        currentVersion,
        target
      );
    }
    try {
      const result = step.migrate(current);
      current = result.world;
      notes.push(...result.notes);
    } catch (error) {
      throw new MigrationError(
        'migration_failed',
        `миграция «${step.from}» → «${step.to}» завершилась ошибкой: ${error instanceof Error ? error.message : String(error)}`,
        step.from,
        step.to
      );
    }
    currentVersion = step.to;
    guard++;
    if (guard > MIGRATIONS.length + 1) {
      throw new MigrationError('missing_migration_path', 'цепочка миграций зациклилась: это ошибка конфигурации реестра', from, target);
    }
  }

  const previousFrom = from;
  const legacyNotes = Array.isArray(world.migration?.notes) ? [...world.migration.notes] : [];
  return {
    world: {
      ...current,
      migration: {
        from: previousFrom,
        notes: [...legacyNotes, ...notes]
      }
    },
    notes,
    from: previousFrom,
    to: target
  };
}
