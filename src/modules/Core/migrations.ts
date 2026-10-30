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
 *         = «ядро не инициализировано», значения не пересоздаются.
 */
export const SAVE_SCHEMA_VERSIONS = ['1.0', '1.1', '1.2'] as const;
export type SaveSchemaVersion = (typeof SAVE_SCHEMA_VERSIONS)[number];
export const CURRENT_SAVE_SCHEMA_VERSION: SaveSchemaVersion = '1.2';

export function isKnownSchemaVersion(version: string): boolean {
  return (SAVE_SCHEMA_VERSIONS as readonly string[]).includes(version);
}

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

const MIGRATIONS: readonly SaveMigration<any>[] = [migrate10to11, migrate11to12];

/**
 * Полная цепочка миграций. Детерминирована: одна и та же входная
 * версия всегда даёт один и тот же результат.
 *
 * Отсутствующая/неизвестная версия трактуется как 1.0 (легаси),
 * как и в предыдущей реализации Storage.migrateWorld.
 */
export function migrateSavedWorld<T extends MigrationTarget>(world: T, target: SaveSchemaVersion = CURRENT_SAVE_SCHEMA_VERSION): { world: T; notes: string[]; from: string; to: string } {
  const rawVersion = world.version;
  const from = rawVersion !== undefined && isKnownSchemaVersion(rawVersion) ? rawVersion : '1.0';
  // Уже целевая схема: возвращаем как есть (идемпотентность —
  // повторная миграция не переписывает историю и не плодит записи).
  if (from === target && rawVersion === target) {
    return { world, notes: [], from, to: target };
  }
  const notes: string[] = [];
  let current: T = { ...world };
  let currentVersion: SaveSchemaVersion = from as SaveSchemaVersion;

  if (rawVersion === undefined || !isKnownSchemaVersion(rawVersion)) {
    // Версия отсутствовала или не распознана: фиксируем это в истории,
    // чтобы след миграции был честным.
    notes.push(`исходная версия сохранения не указана или не распознана («${String(rawVersion ?? '—')}»): сохранение трактовано как схема 1.0`);
    current = { ...current, version: '1.0' };
  }

  let guard = 0;
  while (currentVersion !== target) {
    const step = MIGRATIONS.find((m) => m.from === currentVersion);
    if (!step) {
      throw new Error(`[SaveMigration] нет миграции из схемы «${currentVersion}» к «${target}»: цепочка не определена`);
    }
    const result = step.migrate(current);
    current = result.world;
    notes.push(...result.notes);
    currentVersion = step.to;
    guard++;
    if (guard > MIGRATIONS.length + 1) {
      throw new Error('[SaveMigration] цепочка миграций зациклилась: это ошибка конфигурации реестра');
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
