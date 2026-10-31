// ============================================
// WORLD STATE - Каноническое состояние мира ядра
// ============================================
//
// CoreWorldState (Stage 4.1) — корневой агрегат состояния
// моделируемого мира НАД существующей GeneratedWorld моделью,
// а НЕ вторая копия тех же данных.
//
// Разделение источников истины:
// - GeneratedWorld (легаси) — результат генерации: каталог-описанные
//   выборки, атмосферные пресеты, warnings. Его поля не двигаются
//   ядром;
// - CoreWorldState — эволюционирующее физическое состояние: часы,
//   тела, резервуары, потоки. Ссылка на легаси данные — только
//   идентификационная (worldId, seed, generatorVersion), без
//   дублирования научных значений;
// - физические шаги меняют ТОЛЬКО CoreWorldState; если значению
//   из легаси нужна физическая интерпретация, она выполняется
//   адаптером с явным происхождением (adapters.ts).
//
// Гравитация и излучение — РАЗНЫЕ иерархии:
// - gravity.parents задаёт гравитационного родителя тела
//   (планета вокруг звезды, луна вокруг планеты);
// - radiationSources — кто освещает/греет систему. Это НЕ одно и то
//   же: свободно дрейфующая планета может греться реликтовым
//   излучением; двойная звезда — гравитационно связанная с одной,
//   а излучение получают от обеих. Списки независимы, подменять
//   одно другим запрещено.
//
// Валидация не «лечит» состояние: при противоречиях возвращаются
// диагностические проблемы, автозаполнения фиктивными значениями нет.

import type { FluxLedger } from './fluxLedger';
import { validateFluxLedger } from './fluxLedger';
import type { ReactionLedger } from './reactionLedger';
import { validateReactionLedger } from './reactionLedger';
import type { ReservoirRecord } from './reservoir';
import { validateReservoirRecord } from './reservoir';
import type { ScientificValue } from './scientificValue';
import { validateScientificValueShape } from './scientificValue';
import type { SimulationClockState } from './simulationClock';
import { validateClock } from './simulationClock';
import { validateSchedulerBookkeeping } from './scheduler';
import type { SchedulerBookkeeping } from './scheduler';
import type { BodyThermalState } from './thermalState';
import { validateBodyThermalState } from './thermalState';

// ============================================
// 1. ТИПЫ
// ============================================

/**
 * Версия схемы CoreWorldState (semver; меняется при изменении структуры).
 * 1.2.0 (Stage 4.2.2): опциональное тело WorldBody.thermalState
 * (температурная иерархия с provenance) и опциональное поле
 * ReservoirRecord.reservoirTemperature; миграция не создаёт их —
 * поля появляются только там, где температурные данные заявлены.
 * 1.3.0 (Stage 4.2.3.3): опциональное поле reactionLedger (журнал
 * реакционных транзакций ReactionLedger). Новые состояния создаются
 * с пустым журналом; миграция сохранений 1.3 → 1.4 создаёт пустой
 * журнал для существующих coreWorldState (старый код реакций не
 * записывал — пустой журнал честно отражает этот факт, ни одна
 * транзакция не выдумывается). Записи журнала НЕ применяются к
 * инвентарям: ledger фиксирует транзакции, но не исполняет их.
 */
export const CORE_WORLD_STATE_SCHEMA_VERSION = '1.3.0';

/**
 * Поддерживаемые версии схемы CoreWorldState (Stage 4.1.1).
 * Версия из данных (сохранение/JSON) проверяется на ПРИНАДЛЕЖНОСТЬ
 * списку, а не только на непустоту: неизвестная версия — это
 * version_mismatch, а не молчаливое «сойдёт любая».
 */
export const SUPPORTED_CORE_WORLD_STATE_SCHEMA_VERSIONS: readonly string[] = ['1.0.0', '1.1.0', '1.2.0', '1.3.0'];

export const BODY_KINDS: readonly BodyKind[] = [
  'star',
  'planet',
  'moon',
  'compact_remnant',
  'gas_giant',
  'asteroid',
  'comet',
  'other'
];

export type BodyKind =
  | 'star'
  | 'planet'
  | 'moon'
  | 'compact_remnant'
  | 'gas_giant'
  | 'asteroid'
  | 'comet'
  | 'other';

/** Тело мира. Научные характеристики — ScientificValue (статус+uncertainty+provenance). */
export interface WorldBody {
  id: string;
  kind: BodyKind;
  name?: string;
  /** Научные характеристики: масса, радиус, температура, ... Ключи свободные. */
  properties: Record<string, ScientificValue>;
  /**
   * Температурное состояние тела (Stage 4.2.2): РАЗДЕЛЬНЫЕ величины
   * effective/equilibrium/surface/профиль с происхождением.
   * Отсутствие поля ≠ ноль и не равно температуре из properties:
   * оно означает «температурная подсистема для этого тела не
   * инициализирована» (например, старые сохранения). Миграции НЕ
   * создают thermalState и НЕ заполняют его суррогатами.
   */
  thermalState?: BodyThermalState;
}

/** Источник излучения: тело-источник + семантика, БЕЗ гравитационного смысла. */
export interface RadiationSourceRecord {
  id: string;
  /** Тело-источник излучения (ссылка на bodies). */
  bodyId: string;
  /** Семантика источника. */
  kind: 'star' | 'internal' | 'external_irradiation' | 'other';
  /** Научное описание потока, если задано (например,ScientificValue в W_m2). */
  flux?: ScientificValue;
  note?: string;
}

/**
 * Каноническое состояние мира ядра.
 * cosmicAge — возраст космической системы/эпохи: отдельная научная
 * характеристика со своей семантикой, НЕ время симуляции (оно — в clock).
 */
export interface CoreWorldState {
  schemaVersion: string;
  /** Идентификатор мира (совпадает с id легаси GeneratedWorld). */
  worldId: string;
  clock: SimulationClockState;
  /** Возраст системы/эпохи как научное значение (годы); null — не задан. */
  cosmicAge: ScientificValue | null;
  bodies: WorldBody[];
  /** Гравитационная иерархия: bodyId → parentId (null = вершина). */
  gravity: Record<string, string | null>;
  radiationSources: RadiationSourceRecord[];
  reservoirs: ReservoirRecord[];
  fluxLedger: FluxLedger;
  /**
   * Журнал реакционных транзакций (Stage 4.2.3.3): многокомпонентные
   * ПРЕВРАЩЕНИЯ — отдельно от fluxLedger (переносов). Опционально:
   * состояния схем 1.0.0–1.2.0 его не имеют; отсутствие означает
   * «реакции не записывались» и трактуется аудитами как пустой
   * журнал, а не ошибка. Наличие записи НЕ является утверждением об
   * изменении инвентарей: журнал фиксирует транзакции, но не
   * применяет их к запасам (это задача оператора процесса).
   * Миграция сохранений 1.3 → 1.4 создаёт пустой журнал у
   * существующих coreWorldState; некорректный журнал отклоняется
   * валидацией (invalid_reaction_ledger), а не «чинится» молча.
   */
  reactionLedger?: ReactionLedger;
  /**
   * Динамическое состояние планировщика и очередь событий мира
   * (Stage 4.2.1). Опционально: состояния схемы 1.0.0 его не имеют,
   * и миграция его НЕ создаёт — отсутствие означает «планировщик
   * не инициализирован». Определения процессов — в ProcessRegistry
   * (здесь не сериализуются); runtime-исполнители не сериализуются
   * никогда (передаются планировщику отдельно).
   */
  scheduling?: SchedulerBookkeeping;
  /** Идентификация легаси-источника (НЕ копия его данных). */
  legacy: {
    generatorVersion?: string;
    seed?: string;
    savedSchemaVersion?: string;
  };
  note?: string;
}

// ============================================
// 2. ПРОБЛЕМЫ ВАЛИДАЦИИ
// ============================================

export interface WorldStateIssue {
  code:
    | 'duplicate_id'
    | 'broken_reference'
    | 'gravity_cycle'
    | 'self_parent'
    | 'invalid_clock'
    | 'invalid_reservoir'
    | 'invalid_flux'
    | 'invalid_flux_reference'
    | 'invalid_reaction_ledger'
    | 'invalid_scheduling'
    | 'invalid_event'
    | 'invalid_body'
    | 'invalid_thermal_state'
    | 'invalid_scientific_value'
    | 'version_mismatch'
    | 'empty_world_id';
  component: string;
  message: string;
  /** Затронутые идентификаторы. */
  refs: string[];
}

/**
 * Полная валидация состояния. Возвращает список проблем
 * (пустой список = состояние согласовано). Ничего не исправляет:
 * каждое противоречие становится диагностикой.
 */
export function validateWorldState(state: CoreWorldState): WorldStateIssue[] {
  const issues: WorldStateIssue[] = [];

  if (state.worldId.trim() === '') {
    issues.push({ code: 'empty_world_id', component: 'CoreWorldState', message: 'worldId не может быть пустым', refs: [] });
  }

  // --- cosmicAge как научное значение (Stage 4.1.1) ---
  if (state.cosmicAge !== null) {
    const ageIssues = validateScientificValueShape(state.cosmicAge);
    if (ageIssues.length > 0) {
      issues.push({ code: 'invalid_scientific_value', component: 'CoreWorldState', message: `cosmicAge: ${ageIssues.join('; ')}`, refs: [] });
    }
  }

  // --- уникальность идентификаторов и форма тел ---
  const bodyIds = new Set<string>();
  const seenBodies: string[] = [];
  for (const body of state.bodies) {
    if (body.id.trim() === '') {
      issues.push({ code: 'invalid_body', component: 'WorldBody', message: 'id тела должен быть непустой строкой', refs: [] });
    } else if (bodyIds.has(body.id)) {
      issues.push({ code: 'duplicate_id', component: 'WorldBody', message: `дублирующийся id тела «${body.id}»`, refs: [body.id] });
    } else {
      bodyIds.add(body.id);
    }
    if (!(BODY_KINDS as readonly string[]).includes(body.kind)) {
      issues.push({ code: 'invalid_body', component: 'WorldBody', message: `неизвестный тип тела «${String(body.kind)}» (допустимы: ${BODY_KINDS.join(' | ')})`, refs: [body.id] });
    }
    for (const [key, value] of Object.entries(body.properties)) {
      const valueIssues = validateScientificValueShape(value);
      if (valueIssues.length > 0) {
        issues.push({ code: 'invalid_scientific_value', component: 'WorldBody', message: `тело «${body.id}», свойство «${key}»: ${valueIssues.join('; ')}`, refs: [body.id] });
      }
    }
    // --- тепловое состояние тела (Stage 4.2.2) ---
    // Проверяется только ЯВНО заданное thermalState; отсутствие — не
    // ошибка (подсистема может быть не инициализирована). Валидатор
    // не «чинит» иерархию: любая проблема — это issue, а не тихая правка.
    if (body.thermalState !== undefined) {
      const thermalIssues = validateBodyThermalState(body.thermalState, `тело «${body.id}», thermalState`);
      if (thermalIssues.length > 0) {
        issues.push({ code: 'invalid_thermal_state', component: 'WorldBody', message: `тело «${body.id}», thermalState: ${thermalIssues.join('; ')}`, refs: [body.id] });
      }
    }
    seenBodies.push(body.id);
  }
  const reservoirIds = new Set<string>();
  for (const res of state.reservoirs) {
    if (reservoirIds.has(res.id)) {
      issues.push({ code: 'duplicate_id', component: 'Reservoir', message: `дублирующийся id резервуара «${res.id}»`, refs: [res.id] });
    } else {
      reservoirIds.add(res.id);
    }
  }
  const radiationIds = new Set<string>();
  for (const src of state.radiationSources) {
    if (radiationIds.has(src.id)) {
      issues.push({ code: 'duplicate_id', component: 'RadiationSource', message: `дублирующийся id источника излучения «${src.id}»`, refs: [src.id] });
    } else {
      radiationIds.add(src.id);
    }
  }

  // --- гравитационная иерархия ---
  for (const [childId, parentId] of Object.entries(state.gravity)) {
    if (childId === parentId) {
      issues.push({ code: 'self_parent', component: 'Gravity', message: `тело «${childId}» не может быть собственным гравитационным родителем`, refs: [childId] });
      continue;
    }
    if (parentId !== null && !bodyIds.has(parentId)) {
      issues.push({ code: 'broken_reference', component: 'Gravity', message: `тело «${childId}» ссылается на несуществующего родителя «${parentId}»`, refs: [childId, parentId] });
    }
    if (!bodyIds.has(childId)) {
      issues.push({ code: 'broken_reference', component: 'Gravity', message: `гравитационная иерархия ссылается на несуществующее тело «${childId}»`, refs: [childId] });
    }
  }
  // Циклы в иерархии: подъём по родителям не должен возвращаться в исходное тело.
  for (const bodyId of bodyIds) {
    const visited = new Set<string>();
    let current: string | null = bodyId;
    while (current !== null && current !== undefined) {
      if (visited.has(current)) {
        issues.push({ code: 'gravity_cycle', component: 'Gravity', message: `цикл в гравитационной иерархии, достигнут из «${bodyId}»`, refs: [...visited] });
        break;
      }
      visited.add(current);
      current = state.gravity[current] ?? null;
    }
  }

  // --- источники излучения ---
  for (const src of state.radiationSources) {
    if (!bodyIds.has(src.bodyId)) {
      issues.push({ code: 'broken_reference', component: 'RadiationSource', message: `источник излучения «${src.id}» ссылается на несуществующее тело «${src.bodyId}»`, refs: [src.id, src.bodyId] });
    }
  }

  // --- резервуары ---
  for (const res of state.reservoirs) {
    if (res.bodyId !== undefined && !bodyIds.has(res.bodyId)) {
      issues.push({ code: 'broken_reference', component: 'Reservoir', message: `резервуар «${res.id}» ссылается на несуществующее тело «${res.bodyId}»`, refs: [res.id, res.bodyId] });
    }
    // Stage 4.1.1: проверка ФОРМЫ записи резервуара (инвентари,
    // энергия, scientific-свойства), а не только ссылок.
    const resValidation = validateReservoirRecord(res);
    if (!resValidation.valid) {
      issues.push({ code: 'invalid_reservoir', component: 'Reservoir', message: `резервуар «${res.id}» некорректен: ${resValidation.errors.join('; ')}`, refs: [res.id] });
    }
  }

  // --- потоки ---
  // Stage 4.1.1: полная валидация формы записей реестра (id, kind,
  // status, subject, time) и ссылок — не только дубли id.
  const fluxProblems = validateFluxLedger(state.fluxLedger, { reservoirIds: [...reservoirIds] });
  if (fluxProblems.length > 0) {
    issues.push({ code: 'invalid_flux', component: 'FluxLedger', message: fluxProblems.join('; '), refs: [] });
  }

  // --- журнал реакционных транзакций (Stage 4.2.3.3) ---
  // Проверяется ЯВНО заданный журнал: отсутствие поля — не ошибка
  // (реакции не записывались). Некорректные данные не превращаются
  // молча в пустой журнал: каждая проблема — диагностика
  // invalid_reaction_ledger, «лечения» автозаполнением нет.
  if (state.reactionLedger !== undefined) {
    const reactionProblems = validateReactionLedger(state.reactionLedger, { reservoirIds: [...reservoirIds] });
    if (reactionProblems.length > 0) {
      issues.push({ code: 'invalid_reaction_ledger', component: 'ReactionLedger', message: reactionProblems.join('; '), refs: [] });
    }
  }

  // --- планировщик (Stage 4.2.1): опциональное состояние расписаний ---
  if (state.scheduling !== undefined) {
    const schedulingIssues = validateSchedulerBookkeeping(state.scheduling);
    if (schedulingIssues.length > 0) {
      issues.push({ code: 'invalid_scheduling', component: 'Scheduler', message: schedulingIssues.join('; '), refs: [] });
    }
  }

  // --- часы ---
  const clockIssues = validateClock(state.clock);
  if (clockIssues.length > 0) {
    issues.push({ code: 'invalid_clock', component: 'SimulationClock', message: clockIssues.join('; '), refs: [] });
  }

  // --- версии ---
  if (!(SUPPORTED_CORE_WORLD_STATE_SCHEMA_VERSIONS as readonly string[]).includes(state.schemaVersion)) {
    issues.push({
      code: 'version_mismatch',
      component: 'CoreWorldState',
      message: `версия схемы состояния мира «${state.schemaVersion}» не поддерживается (поддерживаются: ${SUPPORTED_CORE_WORLD_STATE_SCHEMA_VERSIONS.join(', ')})`,
      refs: []
    });
  }
  if (state.legacy.savedSchemaVersion !== undefined && !/^\d+\.\d+(?:\.\d+)?$/.test(state.legacy.savedSchemaVersion)) {
    issues.push({ code: 'version_mismatch', component: 'CoreWorldState', message: `некорректная версия схемы сохранения «${state.legacy.savedSchemaVersion}»`, refs: [] });
  }

  return issues;
}

// ============================================
// 3. КОНСТРУКТОР
// ============================================

/** Пустое состояние мира (минимальный каркас, заполняемый адаптерами). */
export function createCoreWorldState(worldId: string): CoreWorldState {
  return {
    schemaVersion: CORE_WORLD_STATE_SCHEMA_VERSION,
    worldId,
    clock: {
      segmentIndex: 0,
      localTimeS: 0,
      priorSegmentsS: 0,
      stepCount: 0,
      representableStepS: null
    },
    cosmicAge: null,
    bodies: [],
    gravity: {},
    radiationSources: [],
    reservoirs: [],
    fluxLedger: { records: [] },
    reactionLedger: { records: [] },
    legacy: {}
  };
}

