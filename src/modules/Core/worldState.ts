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
import type { ReservoirRecord } from './reservoir';
import type { ScientificValue } from './scientificValue';
import type { SimulationClockState } from './simulationClock';
import { validateClock } from './simulationClock';

// ============================================
// 1. ТИПЫ
// ============================================

/** Версия схемы CoreWorldState (semver; меняется при изменении структуры). */
export const CORE_WORLD_STATE_SCHEMA_VERSION = '1.0.0';

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
    | 'invalid_flux_reference'
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

  // --- уникальность идентификаторов ---
  const bodyIds = new Set<string>();
  const seenBodies: string[] = [];
  for (const body of state.bodies) {
    if (bodyIds.has(body.id)) {
      issues.push({ code: 'duplicate_id', component: 'WorldBody', message: `дублирующийся id тела «${body.id}»`, refs: [body.id] });
    } else {
      bodyIds.add(body.id);
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
  }

  // --- потоки ---
  const fluxIds = new Set<string>();
  for (const rec of state.fluxLedger.records) {
    if (fluxIds.has(rec.id)) {
      issues.push({ code: 'duplicate_id', component: 'FluxLedger', message: `дублирующийся id потока «${rec.id}»`, refs: [rec.id] });
    } else {
      fluxIds.add(rec.id);
    }
    for (const side of [rec.from, rec.to]) {
      if (side !== 'external' && !reservoirIds.has(side)) {
        issues.push({ code: 'invalid_flux_reference', component: 'FluxLedger', message: `поток «${rec.id}» ссылается на несуществующий резервуар «${side}»`, refs: [rec.id, side] });
      }
    }
  }

  // --- часы ---
  const clockIssues = validateClock(state.clock);
  if (clockIssues.length > 0) {
    issues.push({ code: 'invalid_clock', component: 'SimulationClock', message: clockIssues.join('; '), refs: [] });
  }

  // --- версии ---
  if (state.schemaVersion.trim() === '') {
    issues.push({ code: 'version_mismatch', component: 'CoreWorldState', message: 'schemaVersion не может быть пустым', refs: [] });
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
    legacy: {}
  };
}
