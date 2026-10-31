// ============================================
// STORAGE - Модуль хранения данных
// ============================================

import type {
  GeneratedWorld,
  SavedWorld,
  GenerationSettings,
  Seed
} from '../../types';

// Миграции сохранений ведутся реестром научного ядра
// (Core/migrations.ts): цепочка 1.0 → 1.1 → 1.2 → 1.3 детерминирована,
// «нет поля» остаётся «неизвестно», provenance не теряется.
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  MigrationError,
  migrateSavedWorld,
  SAVE_SCHEMA_VERSIONS
} from '../Core/migrations';
import { validateReactionLedger } from '../Core/reactionLedger';

const STORAGE_KEY = 'evowars_worlds';
const SETTINGS_KEY = 'evowars_settings';

/**
 * Версия формата сохранения. Ведётся реестром миграций ядра.
 *
 * История версий:
 * - 1.0 — формат этапа 1–2 (без физической модели);
 * - 1.1 (этап 3) — опциональные поля физической модели
 *   (centralObjectSystem, orbit, bodyPhysics, atmospherePhysics,
 *   phaseAnalysis, geologyAnalysis, energyBudget, chemicalState);
 *   отсутствие поля означает «неизвестно», значения НЕ пересоздаются;
 * - 1.2 (этап 4.1) — опциональное поле coreWorldState (состояние
 *   научного ядра: часы, тела, резервуары, потоки); отсутствие поля
 *   означает «ядро не инициализировано», а не нулевое состояние;
 * - 1.3 (этап 4.2.1) — опциональное поле coreWorldState.scheduling
 *   (динамика процессов планировщика, очередь событий мира, журнал
 *   шагов); отсутствие означает «планировщик не инициализирован»,
 *   значения не пересоздаются;
 * - 1.4 (этап 4.2.3.3, корректирующая ревизия 4.2.3.3.1) —
 *   опциональное поле coreWorldState.reactionLedger (журнал
 *   реакционных транзакций): у существующего coreWorldState с
 *   ИЗВЕСТНОЙ схемой миграция создаёт ПУСТОЙ журнал (старый код
 *   реакций не записывал), схема состояния ядра поднимается до
 *   1.3.0; существующий журнал не перезаписывается; при
 *   неизвестной схеме ядра coreWorldState не изменяется вообще;
 *   некорректный журнал отклоняется при загрузке и импорте
 *   (4.2.3.3.1), а не «чинится» молча; значения не пересчитываются.
 */
export const STORAGE_FORMAT_VERSION: string = CURRENT_SAVE_SCHEMA_VERSION;

/** Поддерживаемые схемы сохранений (для диагностики). */
export const SUPPORTED_SAVE_VERSIONS: readonly string[] = SAVE_SCHEMA_VERSIONS;

/**
 * Миграция мира из старой версии формата.
 *
 * Выполняется цепочкой реестра Core/migrations.ts:
 * - отсутствующие физические поля остаются «неизвестными»,
 *   значения не пересоздаются;
 * - легаси-давление totalPressure остаётся в atm и не переписывается
 *   (пересчёт в Па выполняется моделью на лету);
 * - поле coreWorldState не создаётся задним числом: ядру нужны данные,
 *   которых в старом сохранении нет;
 * - история миграций накапливается в world.migration.notes.
 */
function migrateWorld(world: SavedWorld): SavedWorld {
  if (world.version === CURRENT_SAVE_SCHEMA_VERSION) return world;
  return migrateSavedWorld(world).world;
}

/**
 * Проблемы журнала реакций в сохранении (Stage 4.2.3.3.1).
 * Минимальная достаточная граница проверки при загрузке: валидируется
 * ТОЛЬКО явно заданный coreWorldState.reactionLedger (форма журнала и
 * каждой записи, уникальность id, ссылки участников на резервуары
 * ядра). Отсутствие журнала или ядра — не ошибка; полный
 * validateWorldState здесь НЕ выполняется: его правила относятся к
 * живому состоянию ядра и не должны менять контракт загрузки старых
 * сохранений. Некорректный журнал не «чинится» и не подменяется
 * пустым: проблемы возвращаются диагностикой.
 *
 * Stage 4.2.3.3.2: отсутствие (undefined) и явный null
 * различаются. Отсутствие поля coreWorldState или
 * coreWorldState.reactionLedger — честное «не инициализировано»,
 * не ошибка. ЯВНО заданный null (равно как не-объектное
 * coreWorldState) — некорректная форма, которая раньше
 * маскировалась под отсутствие: такое сохранение не возвращается
 * как валидно загруженный мир, а получает точную причину в
 * диагностике. Граница остаётся минимальной: полный
 * validateWorldState не выполняется.
 */
function reactionLedgerProblemsOfWorld(world: SavedWorld): string[] {
  const core: unknown = (world as { coreWorldState?: unknown }).coreWorldState;
  // Stage 4.2.3.3.2: отсутствие поля (undefined) — «ядро не
  // инициализировано», не ошибка; явный null и прочие не-объектные
  // значения — некорректная форма, не маскируемая под отсутствие.
  if (core === undefined) {
    return [];
  }
  if (typeof core !== 'object' || core === null || Array.isArray(core)) {
    const description = core === null ? 'null' : Array.isArray(core) ? 'массив' : 'значение типа ' + typeof core;
    return ['coreWorldState должен быть объектом-состоянием ядра (или отсутствовать), получено: ' + description];
  }
  const coreRecord = core as Record<string, unknown>;
  const ledger: unknown = coreRecord.reactionLedger;
  // Stage 4.2.3.3.2: undefined — отсутствие журнала, не ошибка;
  // null — некорректная форма: контракт CoreWorldState допускает
  // отсутствие поля, но не ReactionLedger | null. Дальнейшие
  // правила формы — существующий validateReactionLedger.
  if (ledger === undefined) {
    return [];
  }
  if (ledger === null) {
    return ['coreWorldState.reactionLedger: журнал реакций равен null — отсутствие журнала выражается отсутствием поля, а не null (некорректная форма)'];
  }
  const rawReservoirs: unknown = coreRecord.reservoirs;
  const reservoirIds = Array.isArray(rawReservoirs)
    ? rawReservoirs
        .map((reservoir) =>
          typeof reservoir === 'object' && reservoir !== null
            ? (reservoir as Record<string, unknown>).id
            : undefined
        )
        .filter((id): id is string => typeof id === 'string')
    : undefined;
  const problems =
    reservoirIds !== undefined
      ? validateReactionLedger(ledger, { reservoirIds })
      : validateReactionLedger(ledger);
  return problems.map((problem) => 'coreWorldState.reactionLedger: ' + problem);
}

/**
 * Миграция + проверка журнала реакций (Stage 4.2.3.3.1): некорректный
 * reactionLedger не может незаметно попасть в приложение как успешно
 * загруженное состояние. Бросает Error с диагностикой; вызывается из
 * loadSingleEntry (запись становится несовместимой с точной причиной
 * отказа, но НЕ удаляется из хранилища) и из saveWorld (повреждённая
 * запись сохраняется как raw, без «лечения» и перезаписи).
 */
function migrateAndCheckWorld(entry: Record<string, unknown>): SavedWorld {
  const migrated = migrateWorld(entry as unknown as SavedWorld);
  const problems = reactionLedgerProblemsOfWorld(migrated);
  if (problems.length > 0) {
    throw new Error('некорректный журнал реакций: ' + problems.join('; '));
  }
  return migrated;
}

// ============================================
// RAW-ДОСТУП К ХРАНИЛИЩУ (Stage 4.1.1)
// ============================================

/**
 * Структурированная ошибка хранилища (Stage 4.1.1.2, ISSUE D):
 * корневой JSON localStorage повреждён или не является массивом —
 * приложение не может ни читать, ни безопасно переписать данные.
 * Запись в такое хранилище ОТКАЗЫВАЕТ: исходная строка остаётся
 * нетронутой, пока пользователь явно не очистит хранилище
 * (clearAllWorlds). Никаких резервных копий в виде «фиктивного
 * мира» с выдуманной версией не создаётся.
 */
export class StorageError extends Error {
  readonly code: 'storage_unreadable';
  readonly component = 'Storage';
  /** Диагностика разбора из readRawEntries (не null). */
  readonly parseError: string;

  constructor(parseError: string) {
    super(
      `[Storage/storage_unreadable] хранилище сохранений не читается (${parseError}). ` +
      'Запись отклонена: исходные данные НЕ изменены. ' +
      'Диагностика — getStorageHealth(); явная очистка — clearAllWorlds().'
    );
    this.name = 'StorageError';
    this.code = 'storage_unreadable';
    this.parseError = parseError;
  }
}

/** Несовместимая запись хранилища: версия известна формату, но ядро её не поддерживает. */
export interface IncompatibleEntry {
  /** Позиция записи в массиве localStorage. */
  index: number;
  /** Версия записи («—», если не задана). */
  version: string;
  /** Причина, по которой запись не загружается. */
  reason: string;
}

/** Диагностика хранилища: что лежит в localStorage на самом деле. */
export interface StorageHealth {
  /** Всего записей в raw-массиве localStorage. */
  rawEntryCount: number;
  /** Сколько записей успешно загружаются и мигрируются. */
  loadedWorldCount: number;
  /** Ошибка разбора JSON (null, если хранилище читается). */
  parseError: string | null;
  /** Записи с неподдерживаемыми версиями: они НЕ удаляются. */
  incompatibleEntries: IncompatibleEntry[];
  /** Индексы записей, не являющихся объектами (мусор). */
  nonObjectEntries: number[];
}

/**
 * Чтение RAW-записей хранилища без миграций и преобразований.
 * Возвращает записи как есть + ошибку разбора, если JSON повреждён.
 */
function readRawEntries(): { entries: unknown[]; parseError: string | null } {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return { entries: [], parseError: null };
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      return { entries: [], parseError: 'хранилище содержит не массив' };
    }
    return { entries: parsed as unknown[], parseError: null };
  } catch (error) {
    return { entries: [], parseError: error instanceof Error ? error.message : String(error) };
  }
}

/** Является ли запись потенциальным миром (объектом). */
function isObjectEntry(entry: unknown): entry is Record<string, unknown> {
  return typeof entry === 'object' && entry !== null;
}

/**
 * Загрузка ОДНОЙ записи с изоляцией ошибок (Stage 4.1.1):
 * - успешная миграция → мир;
 * - MigrationError → несовместимая запись (пропускается с
 *   диагностикой, НЕ удаляется);
 * - прочие ошибки → запись пропускается с диагностикой.
 * Одна плохая запись больше не прячет все остальные миры.
 *
 * Stage 4.2.3.3.1: после миграции проверяется журнал реакций
 * (migrateAndCheckWorld): сохранение с некорректным
 * coreWorldState.reactionLedger НЕ возвращается как валидно
 * загруженный мир — запись становится несовместимой с точной
 * причиной в diagnostics, но остаётся в хранилище как есть
 * (исходные данные сохраняются для диагностики и восстановления).
 */
function loadSingleEntry(entry: unknown, index: number): { world: SavedWorld | null; incompatible: IncompatibleEntry | null } {
  if (!isObjectEntry(entry)) {
    return { world: null, incompatible: { index, version: '—', reason: 'запись не является объектом' } };
  }
  try {
    return { world: migrateAndCheckWorld(entry), incompatible: null };
  } catch (error) {
    return {
      world: null,
      incompatible: {
        index,
        version: String(entry.version ?? '—'),
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

// ============================================
// ФУНКЦИИ РАБОТЫ С LOCALSTORAGE
// ============================================

/**
 * Сохранение мира
 *
 * Stage 4.1.1: хранилище переписывается из RAW-записей, а не из
 * getAllWorlds(). Совместимые миры мигрируются и попадают под лимит
 * (50 записей); НЕСОВМЕСТИМЫЕ записи (версии из будущего, например
 * '2.0') сохраняются КАК ЕСТЬ и не удаляются: лимит к ним не
 * применяется — пользовательский данные не уничтожаются молча.
 *
 * Stage 4.1.1.2 (ISSUE D): если корневой JSON повреждён или не
 * является массивом, запись ОТКАЗАЕТ со структурированной ошибкой
 * StorageError('storage_unreadable'). Раньше parseError
 * игнорировался, entries приходил пустым, и saveWorld перезаписывал
 * хранилище новым массивом — уничтожая исходные данные, которые
 * приложение не смогло прочитать. Теперь исходная строка localStorage
 * остаётся неизменной; никакая «резервная копия» в виде фиктивного
 * мира не создаётся.
 */
export function saveWorld(world: GeneratedWorld, settings: GenerationSettings): SavedWorld {
  const savedWorld: SavedWorld = {
    ...world,
    savedAt: new Date().toISOString(),
    version: STORAGE_FORMAT_VERSION,
    settings
  };

  // Читаем raw-записи: что реально лежит в хранилище.
  const { entries, parseError } = readRawEntries();

  // Хранилище не разобрать: переписывать его нельзя — отказ.
  if (parseError !== null) {
    throw new StorageError(parseError);
  }

  // Совместимые миры — загружаются и мигрируются; записи с
  // некорректным журналом реакций (4.2.3.3.1) и прочие
  // несовместимые — сохраняются как raw (см. контракт выше).
  const compatible: SavedWorld[] = [];
  const untouched: unknown[] = [];
  entries.forEach((entry) => {
    if (!isObjectEntry(entry)) {
      untouched.push(entry);
      return;
    }
    try {
      compatible.push(migrateAndCheckWorld(entry));
    } catch {
      untouched.push(entry);
    }
  });

  compatible.unshift(savedWorld);

  // Лимит применяется ТОЛЬКО к совместимым мирам.
  const trimmedWorlds = compatible.slice(0, 50);

  localStorage.setItem(STORAGE_KEY, JSON.stringify([...trimmedWorlds, ...untouched]));

  return savedWorld;
}

/**
 * Получение всех сохраненных миров
 *
 * Stage 4.1.1: изолированная обработка КАЖДОЙ записи. Раньше один
 * try/catch на весь массив означал, что одна несовместимая запись
 * прячет ВСЕ миры (getAllWorlds возвращал []). Теперь несовместимые
 * записи пропускаются по одной (с диагностикой через
 * getStorageHealth) и не мешают загрузке остальных.
 */
export function getAllWorlds(): SavedWorld[] {
  const { entries, parseError } = readRawEntries();
  if (parseError !== null) return [];
  const worlds: SavedWorld[] = [];
  entries.forEach((entry, index) => {
    const loaded = loadSingleEntry(entry, index);
    if (loaded.world !== null) {
      worlds.push(loaded.world);
    }
  });
  return worlds;
}

/**
 * Диагностика хранилища (Stage 4.1.1): сколько raw-записей лежит,
 * сколько загружается, какие несовместимы (с версиями и причинами),
 * какие записи не являются объектами, и читается ли JSON вообще.
 */
export function getStorageHealth(): StorageHealth {
  const { entries, parseError } = readRawEntries();
  const incompatibleEntries: IncompatibleEntry[] = [];
  const nonObjectEntries: number[] = [];
  let loadedWorldCount = 0;
  entries.forEach((entry, index) => {
    const loaded = loadSingleEntry(entry, index);
    if (loaded.world !== null) {
      loadedWorldCount++;
      return;
    }
    if (loaded.incompatible) {
      if (loaded.incompatible.reason === 'запись не является объектом') {
        nonObjectEntries.push(index);
      } else {
        incompatibleEntries.push(loaded.incompatible);
      }
    }
  });
  return {
    rawEntryCount: entries.length,
    loadedWorldCount,
    parseError,
    incompatibleEntries,
    nonObjectEntries
  };
}

/**
 * Получение мира по ID
 */
export function getWorldById(id: string): SavedWorld | null {
  const worlds = getAllWorlds();
  return worlds.find(w => w.id === id) || null;
}

/**
 * Удаление мира по ID
 *
 * Stage 4.1.1: удаление работает по RAW-записям — удаляется ТОЛЬКО
 * выбранная запись. Раньше список переписывался из getAllWorlds(),
 * что молча удаляло бы все несовместимые записи хранилища.
 *
 * Stage 4.1.1.2 (ISSUE D): при повреждённом корневом JSON удаление
 * явно отказывает (false) и НЕ трогает хранилище — исходные данные,
 * которые не удалось разобрать, сохраняются как есть.
 */
export function deleteWorld(id: string): boolean {
  const { entries, parseError } = readRawEntries();
  if (parseError !== null) {
    // Хранилище не читается: переписывать его (даже «сокращённой»
    // версией) нельзя — возвращаем честный false без записи.
    return false;
  }
  const targetIndex = entries.findIndex(
    (entry) => isObjectEntry(entry) && entry.id === id
  );

  if (targetIndex === -1) return false;

  const remaining = entries.filter((_, index) => index !== targetIndex);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));

  return true;
}

/**
 * Очистка всех миров
 */
export function clearAllWorlds(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Сохранение настроек
 */
export function saveSettings(settings: GenerationSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ошибка сохранения
  }
}

/**
 * Получение настроек
 */
export function getSettings(): GenerationSettings | null {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    return parsed as GenerationSettings;
  } catch {
    return null;
  }
}

/**
 * Удаление настроек
 */
export function deleteSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}

/**
 * Сохранение последнего seed
 */
export function saveLastSeed(seed: Seed): void {
  try {
    localStorage.setItem('evowars_last_seed', seed);
  } catch {
    // Ошибка сохранения
  }
}

/**
 * Получение последнего seed
 */
export function getLastSeed(): Seed | null {
  try {
    return localStorage.getItem('evowars_last_seed');
  } catch {
    return null;
  }
}

// ============================================
// ЭКСПОРТ И ИМПОРТ
// ============================================

/**
 * Экспорт мира в JSON
 */
export function exportWorldToJSON(world: SavedWorld): string {
  return JSON.stringify(world, null, 2);
}

/**
 * Экспорт мира в Markdown
 */
export function exportWorldToMarkdown(world: SavedWorld): string {
  const lines: string[] = [];

  lines.push(`# ${world.cosmology.name} - ${world.epoch.name}`);
  lines.push('');
  lines.push(`**ID:** ${world.id}`);
  lines.push(`**Seed:** ${world.seed}`);
  lines.push(`**Дата создания:** ${new Date(world.createdAt).toLocaleString('ru-RU')}`);
  lines.push(`**Режим:** ${world.mode === 'anomalous' ? 'Аномальный' : 'Реалистичный'}`);
  lines.push('');

  lines.push('## Космология');
  lines.push('');
  lines.push(`- **Концепция:** ${world.cosmology.name}`);
  lines.push(`- **Описание:** ${world.cosmology.description}`);
  lines.push(`- **Научный статус:** ${formatScientificStatus(world.cosmology.scientificStatus)}`);
  lines.push('');

  lines.push('## Эпоха');
  lines.push('');
  lines.push(`- **Название:** ${world.epoch.name}`);
  lines.push(`- **Возраст:** ${world.epoch.ageRange.min}-${world.epoch.ageRange.max} млрд лет`);
  lines.push(`- **Описание:** ${world.epoch.description}`);
  lines.push('');

  lines.push('## Центральный объект');
  lines.push('');
  lines.push(`- **Название:** ${world.centralObject.name}`);
  lines.push(`- **Класс:** ${world.centralObject.objectClass}`);
  lines.push(`- **Роль:** ${world.centralObject.role}`);
  lines.push(`- **Источники энергии:** ${world.centralObject.potentialEnergySources.join(', ')}`);
  lines.push(`- **Угрозы:** ${world.centralObject.potentialThreats.join(', ')}`);
  lines.push('');

  lines.push('## Небесное тело');
  lines.push('');
  lines.push(`- **Название:** ${world.celestialBody.name}`);
  lines.push(`- **Тип:** ${world.celestialBody.bodyType}`);
  lines.push(`- **Класс размера:** ${world.celestialBody.sizeClass}`);
  lines.push(`- **Гравитация:** ${world.celestialBody.gravityDescription}`);
  lines.push(`- **Геологические свойства:** ${world.celestialBody.geologicalProperties.join(', ')}`);
  lines.push('');

  lines.push('## Колыбель жизни');
  lines.push('');
  lines.push(`- **Название:** ${world.cradle.name}`);
  lines.push(`- **Состояние вещества:** ${world.cradle.matterState}`);
  lines.push(`- **Температура:** ${world.cradle.requiredTemperatureRange.min}-${world.cradle.requiredTemperatureRange.max} K`);
  lines.push(`- **Давление:** ${world.cradle.requiredPressureRange.min}-${world.cradle.requiredPressureRange.max} atm`);
  lines.push(`- **Химические особенности:** ${world.cradle.chemicalFeatures.join(', ')}`);
  lines.push('');

  lines.push('## Атмосфера');
  lines.push('');
  if (world.atmosphere.components.length > 0) {
    lines.push('| Газ | Формула | % | Примечания |');
    lines.push('|-----|---------|---|------------|');
    
    for (const component of world.atmosphere.components) {
      lines.push(`| ${getGasName(component.gasId)} | ${getGasFormula(component.gasId)} | ${component.percentage.toFixed(4)}% | ${component.uncertainty} |`);
    }
  } else {
    lines.push('Атмосфера не определена.');
  }
  
  if (world.atmosphere.totalPressure) {
    lines.push(`- **Общее давление:** ${world.atmosphere.totalPressure} atm`);
  }
  if (world.atmosphere.temperature) {
    lines.push(`- **Температура:** ${world.atmosphere.temperature} K`);
  }
  lines.push('');

  lines.push('## Физические характеристики');
  lines.push('');
  const pc = world.physicalCharacteristics;
  if (pc.mass) lines.push(`- **Масса:** ${pc.mass} масс Земли`);
  if (pc.radius) lines.push(`- **Радиус:** ${pc.radius} радиусов Земли`);
  if (pc.surfaceGravity) lines.push(`- **Гравитация:** ${pc.surfaceGravity}g`);
  if (pc.surfaceTemperature) lines.push(`- **Температура поверхности:** ${pc.surfaceTemperature} K`);
  if (pc.atmosphericPressure) lines.push(`- **Атмосферное давление:** ${pc.atmosphericPressure} atm`);
  if (pc.geologicalActivity) lines.push(`- **Геологическая активность:** ${pc.geologicalActivity}`);
  lines.push('');

  // --- Этап 3: физическая модель (опциональные поля) ---
  if (world.bodyPhysics) {
    lines.push('## Физическая модель тела (этап 3)');
    lines.push('');
    const bp = world.bodyPhysics;
    lines.push(`- **Масса:** ${formatPhysValue(bp.massKg)}`);
    lines.push(`- **Радиус:** ${formatPhysValue(bp.radiusM)}`);
    lines.push(`- **Плотность:** ${formatPhysValue(bp.densityKgM3)}`);
    lines.push(`- **Гравитация:** ${formatPhysValue(bp.surfaceGravityMs2)} (${bp.surfaceGravityInG.value?.toFixed(2) ?? '?'} g)`);
    lines.push(`- **Физическая согласованность:** ${bp.consistencyCheck.plausible ? 'правдоподобно' : 'ВНЕ ДИАПАЗОНА'} — ${bp.consistencyCheck.note}`);
    lines.push('');
  }

  if (world.orbit) {
    lines.push('## Орбитальная конфигурация (этап 3)');
    lines.push('');
    lines.push(`- **Система отсчёта:** ${world.orbit.orbitalBasis}`);
    if (world.orbit.semiMajorAxis.value !== null) {
      lines.push(`- **Большая полуось:** ${world.orbit.semiMajorAxis.value.toFixed(0)} м (${(world.orbit.semiMajorAxis.value / 1.495978707e11).toFixed(3)} а.е.)`);
    } else {
      lines.push(`- **Большая полуось:** неизвестно — ${world.orbit.semiMajorAxis.note ?? ''}`);
    }
    if (world.orbit.eccentricity.value !== null) {
      lines.push(`- **Эксцентриситет:** ${world.orbit.eccentricity.value.toFixed(3)}`);
    }
    if (world.orbit.orbitalPeriod.value !== null) {
      const years = world.orbit.orbitalPeriod.value / 3.15576e7;
      lines.push(`- **Орбитальный период:** ${world.orbit.orbitalPeriod.value.toFixed(0)} с (~${years.toFixed(2)} лет)`);
    }
    lines.push(`- **Проверка устойчивости:** ${world.orbit.stabilityCheck === 'not_performed' ? 'не выполнялась' : world.orbit.stabilityCheck}`);
    lines.push('');
  }

  if (world.energyBudget) {
    lines.push('## Энергетический бюджет (этап 3)');
    lines.push('');
    lines.push(`- **Падающий поток:** ${formatPhysValue(world.energyBudget.incidentFlux)}`);
    lines.push(`- **Равновесная температура:** ${formatPhysValue(world.energyBudget.equilibriumTemperature)}`);
    lines.push(`- **Внутреннее тепло:** ${world.energyBudget.internalHeatLevel}`);
    lines.push(`- Примечание: ${world.energyBudget.greenhouseNote}`);
    world.energyBudget.assumptions.forEach(a => lines.push(`  - допущение: ${a}`));
    lines.push('');
  }

  if (world.atmospherePhysics) {
    lines.push('## Физическая модель атмосферы (этап 3)');
    lines.push('');
    const ap = world.atmospherePhysics;
    if (ap.surfacePressurePa) lines.push(`- **Давление:** ${formatPhysValue(ap.surfacePressurePa)}`);
    if (ap.meanMolarMassKgMol) lines.push(`- **Средняя молярная масса:** ${(ap.meanMolarMassKgMol.value ?? 0).toFixed(4)} кг/моль`);
    if (ap.columnMassKgM2) lines.push(`- **Масса столба:** ${formatPhysValue(ap.columnMassKgM2)}`);
    if (ap.columnMolM2) lines.push(`- **Вещество столба:** ${formatPhysValue(ap.columnMolM2)}`);
    lines.push(`- ${ap.idealGasNote}`);
    lines.push('');
    lines.push('| Газ | Молярная доля | Парциальное давление, Па |');
    lines.push('|-----|---------------|--------------------------|');
    for (const [gasId, fraction] of Object.entries(ap.molarFractions)) {
      const partial = ap.partialPressuresPa[gasId]?.value;
      lines.push(`| ${getGasName(gasId)} | ${(fraction * 100).toFixed(4)}% | ${partial !== null && partial !== undefined ? partial.toExponential(3) : 'неизвестно'} |`);
    }
    lines.push('');
  }

  if (world.phaseAnalysis) {
    lines.push('## Фазовые состояния (этап 3)');
    lines.push('');
    for (const component of world.phaseAnalysis.components) {
      lines.push(`- **${getGasName(component.gasId)}:** ${formatPhaseState(component.state)}${component.screeningRatio !== null && component.screeningRatio !== undefined ? ` (S = ${component.screeningRatio.toFixed(2)})` : ''}${component.message ? ` — ${component.message}` : ''}`);
    }
    world.phaseAnalysis.warnings.forEach(w => lines.push(`- Предупреждение: ${w}`));
    if (world.phaseAnalysis.hasPotentialTransitions) {
      lines.push('- Точный состав и количество конденсированной фазы не рассчитаны: требуется модель равновесия смеси.');
    }
    lines.push('');
  }

  if (world.geologyAnalysis) {
    lines.push('## Внутреннее тепло (этап 3)');
    lines.push('');
    const ga = world.geologyAnalysis;
    lines.push(`- **Суммарный уровень:** ${formatHeatLevel(ga.totalInternalHeat)}`);
    lines.push(`- **Геотермальная энергия доступна:** ${ga.geothermalEnergyAvailable ? 'да' : 'нет'}`);
    lines.push(`- **Остаточное тепло формирования:** ${formatHeatSource(ga.primordialHeat)}`);
    lines.push(`- **Радиогенный нагрев:** ${formatHeatSource(ga.radiogenicHeat)}`);
    lines.push(`- **Приливный нагрев:** ${formatHeatSource(ga.tidalHeat)}`);
    if (ga.volcanism === true) lines.push('- **Вулканизм:** возможен');
    if (ga.volcanism === null) lines.push('- **Вулканизм:** неизвестно');
    lines.push('');
  }

  if (world.chemicalState) {
    lines.push('## Химическая эволюция (этап 3)');
    lines.push('');
    const cs = world.chemicalState;
    lines.push(`- **Режим инвентаря:** ${cs.mode === 'column_inventory' ? 'моль/м² атмосферного столба' : 'нормированный игровой (абсолютное количество неизвестно)'}`);
    lines.push(`- **Единицы:** ${cs.unitsNote}`);
    lines.push(`- **Модельное время:** ${cs.modelTimeYears.toExponential(2)} лет`);
    lines.push(`- **Шаг:** ${cs.stepDurationYears.toExponential(2)} лет (игровое допущение)`);
    if (cs.surfacePressurePa !== null && cs.surfacePressurePa !== undefined) {
      lines.push(`- **Давление:** ${cs.surfacePressurePa.toExponential(4)} Па`);
    }
    const steps = cs.history.length;
    lines.push(`- **Выполнено шагов реакций:** ${steps}`);
    lines.push('');
  }

  // --- Этап 4.1: научное ядро (опциональное поле) ---
  if (world.coreWorldState) {
    lines.push('## Научное ядро (этап 4.1)');
    lines.push('');
    const core = world.coreWorldState;
    lines.push(`- **Схема ядра:** ${core.schemaVersion}`);
    lines.push(`- **Сегмент времени:** ${core.clock.segmentIndex}, шагов: ${core.clock.stepCount}`);
    lines.push(`- **Локальное время симуляции, с:** ${core.clock.localTimeS}`);
    lines.push(`- **Тела:** ${core.bodies.length}; резервуары: ${core.reservoirs.length}; записи потоков: ${core.fluxLedger.records.length}`);
    // Stage 4.2.3.3: записи реакций — только если журнал реально задан;
    // отсутствие журнала не изображается пустым списком.
    if (core.reactionLedger !== undefined && core.reactionLedger !== null && Array.isArray(core.reactionLedger.records)) {
      lines.push(`- **Записи реакционных транзакций (Stage 4.2.3.3):** ${core.reactionLedger.records.length}`);
    }
    if (core.note) lines.push(`- Примечание: ${core.note}`);
    lines.push('');
  }

  lines.push('## Энергия');
  lines.push('');
  lines.push(`- **Основные источники:** ${world.energySources.primary.join(', ')}`);
  lines.push(`- **Вторичные источники:** ${world.energySources.secondary.join(', ')}`);
  lines.push('');

  lines.push('## Цепочка причинно-следственных связей');
  lines.push('');
  lines.push(`- **Космология:** ${world.causalChain.cosmology}`);
  lines.push(`- **Эпоха:** ${world.causalChain.epoch}`);
  lines.push(`- **Центральный объект:** ${world.causalChain.centralObject}`);
  lines.push(`- **Небесное тело:** ${world.causalChain.celestialBody}`);
  lines.push(`- **Колыбель:** ${world.causalChain.cradle}`);
  lines.push('');

  lines.push('## Эволюционные последствия');
  lines.push('');
  lines.push('### Возможные адаптации:');
  world.evolutionImplications.possibleAdaptations.forEach(a => lines.push(`- ${a}`));
  lines.push('');
  lines.push('### Ограничения:');
  world.evolutionImplications.constraints.forEach(c => lines.push(`- ${c}`));
  lines.push('');
  lines.push('### Возможности:');
  world.evolutionImplications.opportunities.forEach(o => lines.push(`- ${o}`));
  lines.push('');

  lines.push('## Предупреждения');
  lines.push('');
  if (world.warnings.length > 0) {
    world.warnings.forEach(w => {
      lines.push(`- **${w.severity.toUpperCase()}:** ${w.message}`);
      lines.push(`  - Категория: ${w.category}`);
      lines.push(`  - Предложения: ${w.suggestions.join(', ')}`);
    });
  } else {
    lines.push('Предупреждений нет.');
  }
  lines.push('');

  lines.push('## Научный статус');
  lines.push('');
  lines.push(`- **Статус:** ${formatScientificStatus(world.scientificStatus)}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Результат импорта сохранения из JSON с диагностикой (Stage
 * 4.2.3.3.1): world === null при отказе, reason поясняет причину
 * (null при успехе). Некорректное сохранение не возвращается как
 * валидно загруженный мир только потому, что его JSON удалось
 * разобрать.
 */
export interface WorldImportResult {
  world: SavedWorld | null;
  /** Причина отказа (null, если сохранение импортировано). */
  reason: string | null;
}

/**
 * Импорт мира из JSON с диагностикой отказа (Stage 4.2.3.3.1).
 * Повторяет контракт importWorldFromJSON, но возвращает причину:
 * некорректный coreWorldState.reactionLedger, неподдерживаемая
 * версия схемы и другие проблемы получают явное объяснение вместо
 * молчаливого null.
 */
export function importWorldFromJSONDetailed(json: string): WorldImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { world: null, reason: 'JSON не разбирается: ' + (error instanceof Error ? error.message : String(error)) };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { world: null, reason: 'сохранение не является JSON-объектом' };
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    !candidate.id || !candidate.seed || !candidate.cosmology || !candidate.epoch ||
    !candidate.centralObject || !candidate.celestialBody || !candidate.cradle
  ) {
    return { world: null, reason: 'отсутствуют обязательные поля сохранения (id, seed, cosmology, epoch, centralObject, celestialBody, cradle)' };
  }
  try {
    // Импортированный мир мигрируется к актуальной версии формата
    // (отсутствующие физические поля остаются неизвестными).
    // Stage 4.1.1: сохранение несовместимой/будущей версии
    // отклоняется ЯВНО (MigrationError) — import не должен возвращать
    // «мигрированный» мир из выдуманной версии.
    const migrated = migrateWorld(candidate as unknown as SavedWorld);
    // Stage 4.2.3.3.1: некорректный журнал реакций не возвращается
    // как валидно загруженный мир — причина отказа возвращается
    // диагностикой, оригинальный JSON остаётся у вызывающей стороны.
    const problems = reactionLedgerProblemsOfWorld(migrated);
    if (problems.length > 0) {
      return { world: null, reason: 'некорректный журнал реакций: ' + problems.join('; ') };
    }
    return { world: migrated, reason: null };
  } catch (error) {
    if (error instanceof MigrationError) {
      return { world: null, reason: error.message };
    }
    return { world: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Импорт мира из JSON. Возвращает мир или null; причина отказа
 * доступна через importWorldFromJSONDetailed (Stage 4.2.3.3.1):
 * контракт SavedWorld | null сохранён для совместимости.
 */
export function importWorldFromJSON(json: string): SavedWorld | null {
  return importWorldFromJSONDetailed(json).world;
}

/**
 * Форматирование научного статуса
 */
function formatScientificStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'established_fact': 'Установленный факт',
    'physically_plausible': 'Физически правдоподобно',
    'hypothetical': 'Гипотетически',
    'impossible_in_model': 'Невозможно в модели',
    'game_assumption': 'Игровое допущение',
    'anomalous_rule': 'Аномальное правило'
  };
  
  return statusMap[status] || status;
}

/**
 * Получение названия газа по ID
 */
function getGasName(gasId: string): string {
  // В будущем можно подгрузить из модуля Data
  const gasNames: Record<string, string> = {
    'ch4': 'Метан',
    'n2': 'Азот',
    'c2h6': 'Этан',
    'h2': 'Водород',
    'nh3': 'Аммиак',
    'co': 'Угарный газ',
    'co2': 'Углекислый газ',
    'h2o': 'Водяной пар',
    'he': 'Гелий',
    'ar': 'Аргон',
    'ne': 'Неон',
    'o2': 'Кислород',
    'unidentified': 'Неидентифицированный'
  };
  
  return gasNames[gasId] || gasId;
}

/**
 * Получение формулы газа по ID
 */
function getGasFormula(gasId: string): string {
  const gasFormulas: Record<string, string> = {
    'ch4': 'CH₄',
    'n2': 'N₂',
    'c2h6': 'C₂H₆',
    'h2': 'H₂',
    'nh3': 'NH₃',
    'co': 'CO',
    'co2': 'CO₂',
    'h2o': 'H₂O',
    'he': 'He',
    'ar': 'Ar',
    'ne': 'Ne',
    'o2': 'O₂',
    'unidentified': '?'
  };
  
  return gasFormulas[gasId] || gasId;
}

/**
 * Форматирование значения физической модели с указанием достоверности.
 * Показывает, где заканчивается известная физика и начинается
 * модельное предположение.
 */
function formatPhysValue(value: { value: number | null; unit: string; confidence: string; note?: string }): string {
  if (value.value === null) {
    return `неизвестно (${value.note ?? 'данных недостаточно'})`;
  }
  const confidenceLabels: Record<string, string> = {
    'established': 'установлено',
    'derived': 'рассчитано',
    'estimated': 'оценка',
    'hypothetical': 'гипотеза',
    'game_assumption': 'игровое допущение',
    'unknown': 'неизвестно'
  };
  const label = confidenceLabels[value.confidence] ?? value.confidence;
  return `${value.value.toExponential(3)} ${value.unit} [${label}]`;
}

/** Русская метка фазового состояния компонента. */
function formatPhaseState(state: string): string {
  const labels: Record<string, string> = {
    'gas': 'газ',
    'potentially_condensing': 'потенциальная конденсация',
    'potential_solid_deposition': 'возможно выпадение твёрдой фазы',
    'no_condensation_above_critical': 'выше критической температуры: жидкой фазы нет',
    'unknown': 'неизвестно'
  };
  return labels[state] ?? state;
}

/** Русская метка уровня внутреннего тепла. */
function formatHeatLevel(level: string): string {
  const labels: Record<string, string> = {
    'high': 'высокий',
    'moderate': 'умеренный',
    'low': 'низкий',
    'none': 'отсутствует',
    'unknown': 'неизвестно'
  };
  return labels[level] ?? level;
}

/** Описание отдельного источника внутреннего тепла. */
function formatHeatSource(source: { level: string | null; status: string; note: string }): string {
  if (source.level === null) {
    return `${source.status === 'potential' ? 'возможен, не оценён' : 'не оценён'} — ${source.note}`;
  }
  return `${formatHeatLevel(source.level)} — ${source.note}`;
}

/**
 * Получение статистики хранения
 */
export function getStorageStats(): { total: number; lastSaved: string | null } {
  const worlds = getAllWorlds();
  const lastSaved = worlds.length > 0 ? worlds[0].savedAt : null;
  
  return {
    total: worlds.length,
    lastSaved
  };
}

export default {
  saveWorld,
  getAllWorlds,
  getWorldById,
  deleteWorld,
  clearAllWorlds,
  saveSettings,
  getSettings,
  deleteSettings,
  saveLastSeed,
  getLastSeed,
  exportWorldToJSON,
  exportWorldToMarkdown,
  importWorldFromJSON,
  importWorldFromJSONDetailed,
  getStorageStats,
  getStorageHealth
};

