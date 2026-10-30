// ============================================
// ADAPTERS - Мосты между научным ядром и существующей системой
// ============================================
//
// Фаза интеграции Stage 4.1. Ядро не заменяет легаси-модули, а
// связывается с ними явно, с сохранением происхождения данных.
//
// Что здесь делается:
// - легаси русские единицы PhysValue → единицы реестра ядра;
// - PhysValue (confidence-шкала этапа 3) → ScientificValue
//   (статусная семантика этапа 4.1) без потери метода и источника;
// - каталог газов + элементные составы Data → SpeciesCatalog
//   (без ручного дублирования значений);
// - химический инвентарь (column_inventory / game_normalized)
//   → материальный инвентарь с ЯВНЫМ основанием; нормированный
//   игровой режим отображается в 'arbitrary_units' и остаётся
//   физически неприменимым — он не превращается в моль/м²;
// - GeneratedWorld (физические поля этапа 3) → CoreWorldState:
//   гравитационная иерархия и источники излучения строятся по
//    CentralObjectSystem, а не по одному полю «центральный объект».

import type { PhysValue, ScientificConfidence } from '../../types/physics';
import type { ChemicalEvolutionState, InventoryMode } from '../../types/physics';
import { quantity, isKnownUnit } from './physicalQuantity';
import type { DataProvenance, ScientificValue } from './scientificValue';
import { estimatedValue, invalidValue, knownValue, unknownValue } from './scientificValue';
import type { MaterialInventory } from './reservoir';
import { createReservoir, setMaterialInventory } from './reservoir';
import type { ScientificSpecies, SpeciesCatalog } from './species';
import { createSpeciesCatalog } from './species';
import type { CoreWorldState, WorldBody } from './worldState';
import { CORE_WORLD_STATE_SCHEMA_VERSION } from './worldState';

// ============================================
// 1. ЛЕГАСИ ЕДИНИЦЫ → ЕДИНИЦЫ ЯДРА
// ============================================

/**
 * Соответствие русских единиц легаси PhysValue (этап 3) и единиц
 * реестра ядра. Маппинг не двусторонний: единицы ядра — канон для
 * новых вычислений, русские строки остаются в легаси-данных как есть.
 */
const LEGACY_UNIT_TO_CORE: Record<string, string> = {
  'кг': 'kg',
  'г': 'g',
  'м': 'm',
  'км': 'km',
  'см': 'cm',
  'м²': 'm2',
  'м³': 'm3',
  'с': 's',
  'мин': 'min',
  'ч': 'h',
  'сут': 'day',
  'лет': 'yr',
  'К': 'K',
  'моль': 'mol',
  'Па': 'Pa',
  'кПа': 'kPa',
  'МПа': 'MPa',
  'бар': 'bar',
  'атм': 'atm',
  'Дж': 'J',
  'кДж': 'kJ',
  'Вт': 'W',
  'кВт': 'kW',
  'Вт/м²': 'W_m2',
  'кг/м³': 'kg_m3',
  'моль/м³': 'mol_m3',
  'кг/м²': 'kg_m2',
  'моль/м²': 'mol_m2',
  'Дж/кг': 'J_kg',
  'Дж/м³': 'J_m3',
  'кг/моль': 'kg_mol',
  'г/моль': 'g_mol',
  'м/с': 'm_s',
  'м/с²': 'm_s2',
  'g': 'g0',
  '%': '1',
  'доля': '1'
};

/** Идентификатор единицы ядра для легаси-строки; null — единица ядру неизвестна. */
export function legacyUnitToCore(unit: string): string | null {
  const mapped = LEGACY_UNIT_TO_CORE[unit];
  if (mapped !== undefined) return mapped;
  // Латинские/ASCII единицы легаси могут уже совпадать с реестром.
  if (isKnownUnit(unit)) return unit;
  return null;
}

// ============================================
// 2. PHYSVALUE → SCIENTIFIC VALUE
// ============================================

/**
 * Соответствие шкалы confidence (этап 3) статусам данных (этап 4.1):
 * - established → known (установленное значение);
 * - derived     → known (расчёт проверяемой формулой; метод и формула
 *                 сохраняются в provenance);
 * - estimated   → estimated (оценка; метод обязателен);
 * - hypothetical → estimated с явным предупреждением о
 *                 гипотетичности в provenance;
 * - game_assumption → estimated с пометкой «игровое допущение»:
 *                 НЕ научное измерение и им не притворяется;
 * - unknown     → unknown.
 *
 * PhysValue.range (интервал) → Uncertainty kind='interval'
 * БЕЗ заявления о доверительной вероятности.
 */
export function physValueToScientificValue(pv: PhysValue): ScientificValue {
  const provenance: DataProvenance = {};
  if (pv.method !== undefined) provenance.method = pv.method;
  if (pv.formula !== undefined) provenance.note = [provenance.note, `формула: ${pv.formula}`].filter(Boolean).join('; ');
  if (pv.source !== undefined && pv.source !== '') provenance.sourceName = pv.source;
  if (pv.applicability !== undefined) provenance.applicability = pv.applicability;
  if (pv.note !== undefined) provenance.note = [provenance.note, pv.note].filter(Boolean).join('; ');
  if (pv.uncertainty !== undefined && pv.uncertainty !== '') {
    provenance.note = [provenance.note, `характер неопределённости: ${pv.uncertainty}`].filter(Boolean).join('; ');
  }
  // Параметры расчёта переносятся как исходные данные.
  if (pv.parameters !== undefined) {
    provenance.rawInput = pv.parameters;
  }

  if (pv.value === null) {
    return unknownValue('значение неизвестно в рамках легаси-модели этапа 3');
  }

  const coreUnit = legacyUnitToCore(pv.unit);
  if (coreUnit === null) {
    // Данные есть, но единица ядру не интерпретируема: как корректное
    // значение использовать нельзя — invalid с сохранением оригинала.
    return invalidValue(`единица «${pv.unit}» не зарегистрирована в ядре; значение сохранено для диагностики`, { value: pv.value, unit: '1' }, provenance);
  }

  const q = quantity(pv.value, coreUnit);
  const uncertainty =
    pv.range !== undefined && Number.isFinite(pv.range.min) && Number.isFinite(pv.range.max) && pv.range.min <= pv.range.max
      ? { kind: 'interval' as const, lower: pv.range.min, upper: pv.range.max }
      : undefined;

  const confidence: ScientificConfidence = pv.confidence;
  if (confidence === 'established' || confidence === 'derived') {
    return knownValue(q, { uncertainty, provenance });
  }
  if (confidence === 'game_assumption') {
    provenance.note = [provenance.note, 'игровое допущение: значение не является научным измерением'].filter(Boolean).join('; ');
    return estimatedValue(q, pv.method ?? 'игровое допущение генератора (метод не документирован)', { uncertainty, provenance });
  }
  // estimated и hypothetical
  if (confidence === 'hypothetical') {
    provenance.note = [provenance.note, 'гипотетическая оценка: подтверждённых данных нет'].filter(Boolean).join('; ');
  }
  return estimatedValue(q, pv.method ?? 'оценка легаси-модели этапа 3 (метод не документирован)', { uncertainty, provenance });
}

/** Научное значение из числа без легаси-обёртки (unit — единица ядра). */
export function numberToScientificValue(value: number | null, unit: string, method: string): ScientificValue {
  if (value === null || !Number.isFinite(value)) {
    return unknownValue();
  }
  if (!isKnownUnit(unit)) {
    return invalidValue(`единица «${unit}» не зарегистрирована в ядре`);
  }
  return estimatedValue(quantity(value, unit), method);
}

// ============================================
// 3. КАТАЛОГ ГАЗОВ ЛЕГАСИ → SPECIES CATALOG
// ============================================

/** Минимальный контур легаси-данных газов, нужный адаптеру. */
export interface LegacyGasRecord {
  id: string;
  formula: string;
  name: string | null;
  molarMass: number | null;
  aggregateStates: string[];
}

/** Минимальный контур легаси-данных об элементном составе. */
export interface LegacyCompositionRecord {
  formula: string;
  elements: Record<string, number>;
}

/**
 * Построить каталог видов ядра из легаси данных (gases.ts +
 * elementCompositions.ts). Значения не дублируются вручную:
 * молярная масса переводится из г/моль в кг/моль как точный
 * множитель 1e-3; фаза — 'gas' (легаси-каталог атмосферный).
 * Виды без известного элементного состава ('unidentified') в каталог
 * не попадают: их состав неизвестен и не выдумывается.
 */
export function buildSpeciesCatalogFromLegacy(
  gases: readonly LegacyGasRecord[],
  compositions: Record<string, LegacyCompositionRecord>
): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  for (const gas of gases) {
    const composition = compositions[gas.id];
    if (!composition) continue;
    const species: ScientificSpecies = {
      id: gas.id,
      formula: gas.formula,
      name: gas.name ?? undefined,
      elements: { ...composition.elements },
      charge: 0,
      phase: 'gas',
      molarMassKgMol: gas.molarMass !== null ? gas.molarMass * 1e-3 : null,
      molarMassStatus: gas.molarMass !== null ? 'known' : 'unknown',
      dataStatus: 'known',
      provenance: {
        sourceName: 'легаси-каталог газов проекта (этап 1–3)',
        note: 'состав — установленная химическая формула; заряд 0 — все виды легаси-каталога электронейтральны'
      }
    };
    catalog.register(species);
  }
  return catalog;
}

// ============================================
// 4. ХИМИЧЕСКИЙ ИНВЕНТАРЬ ЛЕГАСИ → МАТЕРИАЛЬНЫЙ ИНВЕНТАРЬ
// ============================================

/**
 * Материальный инвентарь ядра из легаси химического состояния.
 *
 * - column_inventory → основание 'column_amount' (моль/м² столба) —
 *   физическая величина;
 * - game_normalized  → основание 'arbitrary_units' — нормированные
 *   игровые единицы; абсолютное физическое количество неизвестно
 *   и НЕ преобразуется в моль/м².
 *
 * Возвращает null, если инвентарь пуст (мир без химической модели).
 */
export function chemicalStateToMaterialInventory(state: ChemicalEvolutionState): MaterialInventory | null {
  const entries = Object.fromEntries(Object.entries(state.inventory).filter(([, v]) => Number.isFinite(v) && v > 0));
  if (Object.keys(entries).length === 0) return null;
  const basis: MaterialInventory['basis'] = state.mode === 'column_inventory' ? 'column_amount' : 'arbitrary_units';
  return { basis, entries };
}

/** Основание, соответствующее легаси режиму инвентаря. */
export function inventoryModeToBasis(mode: InventoryMode): MaterialInventory['basis'] {
  return mode === 'column_inventory' ? 'column_amount' : 'arbitrary_units';
}

// ============================================
// 5. GENERATED WORLD → CORE WORLD STATE
// ============================================

/** Структурный вход адаптера: только нужные поля GeneratedWorld. */
export interface LegacyWorldInput {
  id: string;
  seed: string;
  generatorVersion: string;
  /** Опциональная структурная модель центрального объекта (этап 3). */
  centralObjectSystem?: { kind: string } | null;
  /** Опциональная орбита: задаёт гравитационную иерархию. */
  orbit?: { frame: string } | null;
  /** Опциональная физика тела (масса/радиус/гравитация, SI). */
  bodyPhysics?: {
    massKg: PhysValue;
    radiusM: PhysValue;
    densityKgM3: PhysValue;
    surfaceGravityMs2: PhysValue;
  } | null;
  /** Опциональный энергетический бюджет (падающий поток, T_eq). */
  energyBudget?: {
    incidentFlux: PhysValue;
    equilibriumTemperature: PhysValue;
  } | null;
  /** Опциональное химическое состояние (инвентарь + время). */
  chemicalState?: ChemicalEvolutionState | null;
}

/**
 * Тело планеты с научными характеристиками из bodyPhysics.
 * Все значения — ScientificValue с сохранением метода и источника.
 */
export function bodyPhysicsToPlanetBody(input: LegacyWorldInput): WorldBody {
  const properties: Record<string, ScientificValue> = {};
  if (input.bodyPhysics) {
    properties['mass'] = physValueToScientificValue(input.bodyPhysics.massKg);
    properties['radius'] = physValueToScientificValue(input.bodyPhysics.radiusM);
    properties['density'] = physValueToScientificValue(input.bodyPhysics.densityKgM3);
    properties['surfaceGravity'] = physValueToScientificValue(input.bodyPhysics.surfaceGravityMs2);
  }
  return { id: 'planet', kind: 'planet', name: 'планета (небесное тело мира)', properties };
}

/**
 * Построить CoreWorldState из легаси GeneratedWorld.
 *
 * Гравитация и излучение НЕ выводятся друг из друга:
 * - гравитационный родитель планеты назначается только при
 *   орбитальной системе around_star / around_parent_body;
 * - источник излучения создаётся, только если центральный объект
 *   системы — звезда (kind === 'star'); компактный остаток
 *   БЕЗ аккреции источником излучения не объявляется;
 * - свободно плавающие миры не получают ни родителя, ни источника:
 *   фиктивные сущности не создаются;
 * - время ядра стартует с нуля; легаси химическое время (годы,
 *   игровое допущение) НЕ переносится в часы как «прошедшее
 *   время симуляции» — это разные величины.
 */
export function coreWorldStateFromLegacyWorld(input: LegacyWorldInput): CoreWorldState {
  const state: CoreWorldState = {
    schemaVersion: CORE_WORLD_STATE_SCHEMA_VERSION,
    worldId: input.id,
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
    legacy: {
      generatorVersion: input.generatorVersion,
      seed: input.seed
    },
    note: 'создано адаптером Stage 4.1 из легаси GeneratedWorld; легаси-поля остаются источником генерационных данных, физическое эволюционирование — только в ядре'
  };

  const centralKind = input.centralObjectSystem?.kind ?? null;
  const centralIsRadiatingStar = centralKind === 'star';

  if (centralKind !== null) {
    state.bodies.push({
      id: 'central',
      kind: centralKind === 'star'
        ? 'star'
        : centralKind === 'compact_remnant'
          ? 'compact_remnant'
          : centralKind === 'gas_giant_system'
            ? 'gas_giant'
            : 'other',
      name: 'центральный объект системы',
      properties: {}
    });
  }

  const planet = bodyPhysicsToPlanetBody(input);
  state.bodies.push(planet);

  // Гравитационная иерархия — только там, где орбита это утверждает.
  const frame = input.orbit?.frame ?? null;
  if (frame === 'around_star' && centralKind !== null) {
    state.gravity['planet'] = 'central';
  } else if (frame === 'around_parent_body') {
    state.gravity['planet'] = 'central';
  } else {
    state.gravity['planet'] = null;
  }

  // Источник излучения — только для звезды. Компактный остаток
  // без модели аккреции излучателем не объявляется.
  if (centralIsRadiatingStar) {
    state.radiationSources.push({
      id: 'central-star-radiation',
      bodyId: 'central',
      kind: 'star',
      note: 'звёздное излучение центрального объекта; гравитационная иерархия и излучение — независимые списки'
    });
  }

  // Планетные характеристики из энергетического бюджета.
  if (input.energyBudget) {
    planet.properties['incidentFlux'] = physValueToScientificValue(input.energyBudget.incidentFlux);
    planet.properties['equilibriumTemperature'] = physValueToScientificValue(input.energyBudget.equilibriumTemperature);
  }

  // Атмосферный резервуар из химического инвентаря.
  if (input.chemicalState) {
    const inventory = chemicalStateToMaterialInventory(input.chemicalState);
    if (inventory) {
      let atmosphere = createReservoir('atmosphere', 'atmosphere', {
        bodyId: 'planet',
        note: input.chemicalState.unitsNote
      });
      atmosphere = setMaterialInventory(atmosphere, inventory.basis, { ...inventory.entries });
      state.reservoirs.push(atmosphere);
    }
  }

  return state;
}
