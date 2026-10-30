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
// - легаси химические процессы (createDefaultProcessRegistry)
//   → дескрипторы ProcessRegistry ядра в честном состоянии:
//   без выдуманных τ, скоростей, констант и решателей (Stage 4.2.1).

import type { PhysValue, ScientificConfidence } from '../../types/physics';
import type { ChemicalEvolutionState, InventoryMode } from '../../types/physics';
import { quantity, isKnownUnit } from './physicalQuantity';
import type { DataProvenance, ScientificValue } from './scientificValue';
import { estimatedValue, invalidValue, knownValue, notApplicable, unknownValue } from './scientificValue';
import type { ProcessDescriptor } from './processRegistry';
import type { MaterialInventory } from './reservoir';
import { createReservoir, setMaterialInventory } from './reservoir';
import type { ScientificSpecies, SpeciesCatalog } from './species';
import { createSpeciesCatalog } from './species';
import type { AtmosphericTemperatureProfile, BodyThermalState } from './thermalState';
import type { CoreWorldState, WorldBody } from './worldState';
import { CORE_WORLD_STATE_SCHEMA_VERSION } from './worldState';

// ============================================
// 1. ЛЕГАСИ ЕДИНИЦЫ → ЕДИНИЦЫ ЯДРА
// ============================================

/**
 * Соответствие русских единиц легаси PhysValue (этап 3) и единиц
 * реестра ядра. Маппинг не двусторонний: единицы ядра — канон для
 * новых вычислений, русские строки остаются в легаси-данных как есть.
 *
 * Stage 4.1.1 (исправление Issue 8): каждому маппингу сопоставлен
 * масштабирующий множитель. Проценты ('%') — это НЕ доля 0..1:
 * 50% = 0.5, поэтому factor = 0.01. Раньше '%' → '1' без
 * масштабирования превращало 50% в «50 долей» — в 100 раз больше
 * физического значения (legacy molarFractions хранит доли 0..1).
 */
const LEGACY_UNIT_TO_CORE: Record<string, { unit: string; factor: number }> = {
  'кг': { unit: 'kg', factor: 1 },
  'г': { unit: 'g', factor: 1 },
  'м': { unit: 'm', factor: 1 },
  'км': { unit: 'km', factor: 1 },
  'см': { unit: 'cm', factor: 1 },
  'м²': { unit: 'm2', factor: 1 },
  'м³': { unit: 'm3', factor: 1 },
  'с': { unit: 's', factor: 1 },
  'мин': { unit: 'min', factor: 1 },
  'ч': { unit: 'h', factor: 1 },
  'сут': { unit: 'day', factor: 1 },
  'лет': { unit: 'yr', factor: 1 },
  'К': { unit: 'K', factor: 1 },
  'моль': { unit: 'mol', factor: 1 },
  'Па': { unit: 'Pa', factor: 1 },
  'кПа': { unit: 'kPa', factor: 1 },
  'МПа': { unit: 'MPa', factor: 1 },
  'бар': { unit: 'bar', factor: 1 },
  'атм': { unit: 'atm', factor: 1 },
  'Дж': { unit: 'J', factor: 1 },
  'кДж': { unit: 'kJ', factor: 1 },
  'Вт': { unit: 'W', factor: 1 },
  'кВт': { unit: 'kW', factor: 1 },
  'Вт/м²': { unit: 'W_m2', factor: 1 },
  'кг/м³': { unit: 'kg_m3', factor: 1 },
  'моль/м³': { unit: 'mol_m3', factor: 1 },
  'кг/м²': { unit: 'kg_m2', factor: 1 },
  'моль/м²': { unit: 'mol_m2', factor: 1 },
  'Дж/кг': { unit: 'J_kg', factor: 1 },
  'Дж/м³': { unit: 'J_m3', factor: 1 },
  'кг/моль': { unit: 'kg_mol', factor: 1 },
  'г/моль': { unit: 'g_mol', factor: 1 },
  'м/с': { unit: 'm_s', factor: 1 },
  'м/с²': { unit: 'm_s2', factor: 1 },
  'g': { unit: 'g0', factor: 1 },
  '%': { unit: '1', factor: 0.01 },
  'доля': { unit: '1', factor: 1 }
};

/** Идентификатор единицы ядра для легаси-строки; null — единица ядру неизвестна. */
export function legacyUnitToCore(unit: string): string | null {
  const mapped = LEGACY_UNIT_TO_CORE[unit];
  if (mapped !== undefined) return mapped.unit;
  // Латинские/ASCII единицы легаси могут уже совпадать с реестром.
  if (isKnownUnit(unit)) return unit;
  return null;
}

/**
 * Масштабирующий множитель легаси-единицы (Stage 4.1.1):
 * во сколько раз значение в легаси-единице больше значения в единице
 * ядра ('%': 50 → 50 × 0.01 = 0.5 доли). Для единиц, совпадающих с
 * реестром напрямую, множитель равен 1.
 */
export function legacyUnitScaleFactor(unit: string): number {
  return LEGACY_UNIT_TO_CORE[unit]?.factor ?? 1;
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
    // Stage 4.1.1: unknown СОХРАНЯЕТ собранный provenance — источник
    // и метод неизвестного значения не теряются.
    return unknownValue('значение неизвестно в рамках легаси-модели этапа 3', provenance);
  }

  const coreUnit = legacyUnitToCore(pv.unit);
  if (coreUnit === null) {
    // Данные есть, но единица ядру не интерпретируема: как корректное
    // значение использовать нельзя — invalid с сохранением оригинала.
    // Stage 4.1.1: ФИКТИВНОЙ единицы '1' больше нет; оригинальные
    // значение и единица сохраняются в provenance.rawInput.
    return invalidValue(
      `единица «${pv.unit}» не зарегистрирована в ядре; значение сохранено для диагностики`,
      undefined,
      {
        ...provenance,
        rawInput: { ...(provenance.rawInput ?? {}), originalValue: pv.value, originalUnit: pv.unit }
      }
    );
  }

  // Stage 4.1.1: масштабирование легаси-единицы (проценты → доли).
  const factor = legacyUnitScaleFactor(pv.unit);
  const scaledValue = pv.value * factor;
  if (!Number.isFinite(scaledValue)) {
    return invalidValue(
      `значение ${pv.value} в единице «${pv.unit}» непредставимо после масштабирования (×${factor})`,
      undefined,
      {
        ...provenance,
        rawInput: { ...(provenance.rawInput ?? {}), originalValue: pv.value, originalUnit: pv.unit }
      }
    );
  }
  if (factor !== 1) {
    provenance.note = [provenance.note, `масштабирование легаси-единицы: 1 «${pv.unit}» = ${factor} ${coreUnit}`].filter(Boolean).join('; ');
  }

  const q = quantity(scaledValue, coreUnit);
  const uncertainty =
    pv.range !== undefined && Number.isFinite(pv.range.min) && Number.isFinite(pv.range.max) && pv.range.min <= pv.range.max
      ? { kind: 'interval' as const, lower: pv.range.min * factor, upper: pv.range.max * factor }
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
  /**
   * Опциональная структурная модель центрального объекта (этап 3).
   * effectiveTemperatureK читается ТОЛЬКО как эффективная
   * температура ИСТОЧНИКА излучения (звезда/субзвёздный объект)
   * и никогда не переносится на планету (Stage 4.2.2).
   */
  centralObjectSystem?: { kind: string; effectiveTemperatureK?: PhysValue | null } | null;
  /** Опциональная орбита: задаёт гравитационную иерархию. */
  orbit?: { frame: string } | null;
  /** Опциональная физика тела (масса/радиус/гравитация, SI). */
  bodyPhysics?: {
    massKg: PhysValue;
    radiusM: PhysValue;
    densityKgM3: PhysValue;
    surfaceGravityMs2: PhysValue;
  } | null;
  /**
   * Легаси-атмосфера (Stage 4.2.2): temperature — числовое допущение
   * пресета, а НЕ измерение; presetKind/presetNotes объясняют его
   * происхождение. Никакое из этих полей не является температурой
   * поверхности.
   */
  atmosphere?: {
    temperature: number | null;
    presetKind?: string;
    presetNotes?: string;
  } | null;
  /** Опциональный энергетический бюджет (падающий поток, T_eq). */
  energyBudget?: {
    incidentFlux: PhysValue;
    equilibriumTemperature: PhysValue;
  } | null;
  /** Опциональное химическое состояние (инвентарь + время). */
  chemicalState?: ChemicalEvolutionState | null;
}

// ============================================
// 5a. ТЕМПЕРАТУРНАЯ ИЕРАРХИЯ: ЛЕГАСИ → ТИПИЗИРОВАННАЯ (STAGE 4.2.2)
// ============================================
//
// Шесть температурных понятий не смешиваются (см. thermalState.ts):
// пресетная температура атмосферы, T_eq и температура поверхности —
// РАЗНЫЕ величины. Адаптеры переводят легаси-числа в ScientificValue
// С ЯВНЫМ происхождением и никогда не подставляют одну вместо другой.

/**
 * Пресетная температура атмосферы → ScientificValue (Stage 4.2.2).
 *
 * Легаси-число (например, 95 K метанового пресета) — это ДОПУЩЕНИЕ
 * генератора, а не измерение. Оно обязано получить статус estimated
 * с методом и происхождением:
 * - historical_game — игровое допущение (game_assumption): исторический
 *   игровой сценарий, НЕ научное измерение;
 * - observational_reference — справочный ориентир из наблюдений за
 *   реальными телами: НЕ измерение ЭТОГО мира;
 * - hypothetical — физически мотивированная гипотеза;
 * - без presetKind — пользовательская конфигурация.
 * - null → unknown; NaN/отрицательные → invalid (диагностика).
 *
 * Происхождение сохраняется в provenance.rawInput
 * (presetTemperatureK, presetKind) и не теряется.
 */
export function atmospherePresetTemperatureToScientificValue(
  atmosphere: LegacyWorldInput['atmosphere']
): ScientificValue {
  if (atmosphere === null || atmosphere === undefined) {
    return unknownValue('температура атмосферы не заявлена (поле отсутствует или null)');
  }
  const raw = atmosphere.temperature;
  const presetKind = atmosphere.presetKind ?? null;
  const presetNotes =
    atmosphere.presetNotes !== undefined && atmosphere.presetNotes !== ''
      ? atmosphere.presetNotes
      : null;
  const provenance: DataProvenance = {
    rawInput: { presetTemperatureK: raw === null ? null : raw, presetKind }
  };
  // Stage 4.2.2.1: presetNotes — ПОЯСНЕНИЕ пресета, а не название
  // источника. sourceName заполняется только когда пресет явно
  // заявляет наблюдательный источник (observational_reference):
  // игровое допущение (historical_game) и гипотеза НЕ изображаются
  // наблюдательным измерением. Выдумывать библиографию запрещено.
  if (presetNotes !== null && presetKind === 'observational_reference') {
    provenance.sourceName = presetNotes;
  }
  const noteWithPreset = (baseNote: string): DataProvenance => ({
    ...provenance,
    note:
      presetNotes !== null && presetKind !== 'observational_reference'
        ? `${baseNote}; пояснение пресета: ${presetNotes}`
        : baseNote
  });
  if (raw === null) {
    return unknownValue('температура атмосферы не заявлена (null)', noteWithPreset('температура не заявлена'));
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return invalidValue(
      `пресетная температура атмосферы непригодна как число: ${String(raw)}`,
      undefined,
      noteWithPreset('непригодное значение пресета')
    );
  }
  if (raw < 0) {
    return invalidValue(
      `пресетная температура атмосферы отрицательна (${raw} K) — термодинамическая температура неотрицательна`,
      undefined,
      noteWithPreset('отрицательное значение пресета')
    );
  }
  const q = quantity(raw, 'K');
  if (presetKind === 'historical_game') {
    return estimatedValue(q, 'игровое допущение пресета атмосферы (game_assumption)', {
      provenance: noteWithPreset(
        'игровое допущение исторического сценария: значение пресета НЕ является научным измерением'
      )
    });
  }
  if (presetKind === 'observational_reference') {
    return estimatedValue(q, 'справочный ориентир пресета (observational_reference)', {
      provenance: {
        ...provenance,
        note: 'справочное значение из наблюдений за реальными телами: НЕ измерение этого мира'
      }
    });
  }
  if (presetKind === 'hypothetical') {
    return estimatedValue(q, 'гипотетическая оценка пресета атмосферы', {
      provenance: noteWithPreset('гипотетический сценарий: подтверждённых данных нет')
    });
  }
  return estimatedValue(q, 'пользовательской конфигурацией атмосферы', {
    provenance: noteWithPreset('температура задана пользователем без указания происхождения пресета')
  });
}

/**
 * Профиль температур атмосферы из пресета (Stage 4.2.2).
 *
 * ОДНО число из пресета — НЕ вертикальный профиль: оно становится
 * профилем со статусом single_layer_estimate и ЯВНЫМ limitations.
 * Непригодная/отсутствующая температура → null (фиктивный профиль
 * не создаётся).
 */
export function atmosphericProfileFromPreset(
  atmosphere: LegacyWorldInput['atmosphere']
): AtmosphericTemperatureProfile | null {
  const temperature = atmospherePresetTemperatureToScientificValue(atmosphere);
  if (temperature.status !== 'known' && temperature.status !== 'estimated') {
    return null;
  }
  const provenance: DataProvenance = {};
  if (temperature.provenance !== undefined) {
    provenance.rawInput = temperature.provenance.rawInput;
    if (temperature.provenance.sourceName !== undefined) {
      provenance.sourceName = temperature.provenance.sourceName;
    }
    // Stage 4.2.2.1: пояснение пресета (note) переносится вместе
    // с остальным происхождением и не теряется на пути в профиль.
    if (temperature.provenance.note !== undefined) {
      provenance.note = temperature.provenance.note;
    }
  }
  return {
    status: 'single_layer_estimate',
    layers: [
      {
        layerId: 'surface_boundary',
        temperature,
        note: 'единственная оценка из пресета атмосферы (приповерхностный слой)'
      }
    ],
    limitations:
      'одиночная оценка из пресета — НЕ расчётный вертикальный профиль; слоистая структура и градиенты не вычислялись (RCM/гидростатика не реализованы, Stage 4.2.2)',
    provenance
  };
}

/**
 * Тепловое состояние ПЛАНЕТЫ из легаси-данных (Stage 4.2.2).
 *
 * - equilibriumTemperature — из энергетического бюджета (T_eq),
 *   переносится КАК СЕБЯ: радиационная оценка серого тела, а не
 *   температура поверхности;
 * - surfaceTemperature — ЯВНО unknown: RCM не реализована, и ни
 *   T_eq, ни пресетная температура атмосферы НЕ являются
 *   измерением поверхности;
 * - effectiveTemperature — not_applicable: планета — получатель
 *   излучения, а не источник с собственной эффективной температурой;
 * - профиль — single_layer_estimate из пресета, если пригоден.
 */
export function planetThermalStateFromLegacy(input: LegacyWorldInput): BodyThermalState {
  const equilibrium =
    input.energyBudget !== undefined && input.energyBudget !== null
      ? physValueToScientificValue(input.energyBudget.equilibriumTemperature)
      : unknownValue('равновесная температура не вычислена: энергетический бюджет отсутствует');
  const profile = atmosphericProfileFromPreset(input.atmosphere);
  const provenance: DataProvenance = {
    note: 'собрано адаптером Stage 4.2.2 из легаси-полей GeneratedWorld; величины перенесены раздельно, без подстановок'
  };
  return {
    effectiveTemperature: notApplicable('планета — получатель излучения, а не источник: эффективная температура неприменима'),
    equilibriumTemperature: equilibrium,
    surfaceTemperature: unknownValue(
      'температура поверхности неизвестна: радиационно-конвективная модель (RCM) не реализована; T_eq и пресетная температура атмосферы НЕ являются измерением поверхности',
      undefined
    ),
    atmosphericTemperatureProfile: profile ?? {
      status: 'unknown',
      layers: [],
      note: 'профиль температур неизвестен: пригодной пресетной температуры нет'
    },
    provenance
  };
}

/**
 * Тепловое состояние ЦЕНТРАЛЬНОГО объекта из легаси-модели (Stage 4.2.2).
 *
 * - null, если centralObjectSystem не задана: тепловое состояние
 *   центрального объекта не инициализируется из ничего;
 * - звезда/субзвёздный объект: effectiveTemperatureK переносится
 *   как эффективная температура ИСТОЧНИКА; при отсутствии значения
 *   — unknown (среднее по классу НЕ подставляется);
 * - jet_system: not_applicable (джет — поток, а не тело с температурой);
 * - остальные kinds (компактный остаток, система гиганта): unknown
 *   по всем величинам — честное «не знаем» вместо выдумки.
 */
export function centralThermalStateFromLegacy(input: LegacyWorldInput): BodyThermalState | null {
  const system = input.centralObjectSystem;
  if (system === null || system === undefined) {
    return null;
  }
  const kind = system.kind;
  if (kind === 'star' || kind === 'substellar') {
    const teff = system.effectiveTemperatureK ?? null;
    let effective: ScientificValue;
    if (teff !== null && teff.value !== null) {
      effective = physValueToScientificValue(teff);
    } else if (
      teff !== null &&
      teff.range !== undefined &&
      Number.isFinite(teff.range.min) &&
      Number.isFinite(teff.range.max) &&
      teff.range.min <= teff.range.max
    ) {
      // Stage 4.2.2.1: известен только ДИАПАЗОН класса — он НЕ
      // превращается в среднее или конкретную температуру
      // (оценка не становится измерением и не «схлопывается» в
      // число). Диапазон сохраняется в provenance: rawInput несёт
      // границы, note объясняет отказ от подстановки среднего.
      const rangeNote = `известен только диапазон значений класса: ${teff.range.min}–${teff.range.max} K; среднее по классу НЕ подставляется как конкретная эффективная температура`;
      effective = unknownValue('эффективная температура источника неизвестна', {
        note: rangeNote,
        rawInput: { rangeMinK: teff.range.min, rangeMaxK: teff.range.max },
        ...(teff.source !== undefined && teff.source !== '' ? { sourceName: teff.source } : {})
      });
    } else {
      effective = unknownValue(
        'эффективная температура источника неизвестна: значение класса не задано; среднее по классу НЕ подставляется'
      );
    }
    return {
      effectiveTemperature: effective,
      equilibriumTemperature: unknownValue('равновесная температура для центрального объекта не определена'),
      surfaceTemperature: unknownValue('температура поверхности центрального объекта не моделируется'),
      atmosphericTemperatureProfile: { status: 'unknown', layers: [] },
      provenance: { note: 'собрано адаптером Stage 4.2.2 из структурной модели центрального объекта' }
    };
  }
  if (kind === 'jet_system') {
    return {
      effectiveTemperature: notApplicable('релятивистский джет — направленный поток, а не тело с эффективной температурой'),
      equilibriumTemperature: notApplicable('равновесная температура к джету неприменима'),
      surfaceTemperature: notApplicable('у высокоэнергетического потока нет поверхности'),
      atmosphericTemperatureProfile: { status: 'unknown', layers: [] },
      provenance: { note: 'собрано адаптером Stage 4.2.2: все величины not_applicable/unknown, без выдумки' }
    };
  }
  return {
    effectiveTemperature: unknownValue('эффективная температура центрального объекта этого класса неизвестна'),
    equilibriumTemperature: unknownValue('равновесная температура центрального объекта не определена'),
    surfaceTemperature: unknownValue('температура поверхности центрального объекта не моделируется'),
    atmosphericTemperatureProfile: { status: 'unknown', layers: [] },
    provenance: { note: 'собрано адаптером Stage 4.2.2: величины честно неизвестны' }
  };
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
    const centralThermalState = centralThermalStateFromLegacy(input);
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
      properties: {},
      // Stage 4.2.2: тепловое состояние центрального объекта — только
      // из структурной модели; без неё подсистема не инициализируется.
      thermalState: centralThermalState ?? undefined
    });
  }

  const planet = bodyPhysicsToPlanetBody(input);
  // Stage 4.2.2: тепловое состояние планеты — раздельные величины
  // (T_eq отдельно, поверхность неизвестна, профиль из пресета).
  planet.thermalState = planetThermalStateFromLegacy(input);
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

// ============================================
// 6. ЛЕГАСИ ХИМИЧЕСКИЕ ПРОЦЕССЫ → PROCESS REGISTRY ЯДРА
// ============================================

/**
 * Минимальный контур легаси-процесса, нужный мосту реестра
 * Stage 4.2.1. Берётся структурно (как LegacyGasRecord выше):
 * полный тип ChemicalProcess этапа 3 здесь не требуется.
 */
export interface LegacyChemicalProcessInput {
  id: string;
  name: string;
  enabled: boolean;
  /** Текстовый масштаб легаси («миллионы лет») — НЕ число. */
  timescaleNote?: string;
  source?: string;
  note?: string;
}

/**
 * Мост легаси-химических процессов (createDefaultProcessRegistry,
 * этап 3) в дескрипторы ProcessRegistry ядра.
 *
 * Честное состояние сохраняется (Stage 4.2.1):
 * - числового τ в легаси-реестре нет → tau = unknownValue:
 *   текстовые timescaleNote НЕ преобразуются в числа автоматически;
 * - численный решатель процессов химии в ядре не реализован →
 *   solverAvailability = 'not_implemented';
 * - enabled переносится как есть: процессы легаси-реестра
 *   отключены и этим мостом НЕ активируются;
 * - скорости, константы и физическая доступность не назначаются.
 */
export function chemicalProcessesToCoreDescriptors(
  processes: readonly LegacyChemicalProcessInput[]
): ProcessDescriptor[] {
  return processes.map((p): ProcessDescriptor => ({
    id: p.id,
    name: p.name,
    processKind: 'chemical',
    tau: unknownValue(
      p.timescaleNote !== undefined && p.timescaleNote !== ''
        ? 'числовое характерное время неизвестно; легаси-описание масштаба: «' +
          p.timescaleNote +
          '» — текст, а не число'
        : 'числовое характерное время неизвестно: в легаси-реестре числового τ нет',
      {
        sourceName:
          p.source !== undefined && p.source !== ''
            ? p.source
            : 'легаси-реестр химических процессов (этап 3)',
        note: 'текстовые описания масштаба времени не преобразуются в числа автоматически (Stage 4.2.1)'
      }
    ),
    stepPolicy: { kind: 'unspecified' },
    solverAvailability: 'not_implemented',
    enabled: p.enabled,
    provenance: {
      sourceName: 'легаси createDefaultProcessRegistry (ChemicalEvolution, этап 3)',
      note: 'мост Stage 4.2.1: процессы перенесены в честном состоянии — без назначенных скоростей, τ, констант и решателей'
    },
    applicability:
      'химическая эволюция легаси-модуля; численный решатель процесса в ядре не реализован (интеграция — будущий подэтап 4.2.3)',
    assumptions: p.note,
    timescaleNote: p.timescaleNote
  }));
}

