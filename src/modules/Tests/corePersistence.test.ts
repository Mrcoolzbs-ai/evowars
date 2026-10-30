// ============================================
// STAGE 4.1 - Тесты персистентности: миграции, адаптеры, PRNG-регрессия
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  migrateSavedWorld,
  CURRENT_SAVE_SCHEMA_VERSION,
  SAVE_SCHEMA_VERSIONS,
  createDatasetRegistry,
  MigrationError
} from '../Core/migrations';
import {
  STORAGE_FORMAT_VERSION,
  SUPPORTED_SAVE_VERSIONS,
  getAllWorlds,
  saveWorld,
  deleteWorld,
  importWorldFromJSON,
  getStorageHealth
} from '../Storage';
import {
  legacyUnitToCore,
  legacyUnitScaleFactor,
  physValueToScientificValue,
  numberToScientificValue,
  buildSpeciesCatalogFromLegacy,
  chemicalStateToMaterialInventory,
  inventoryModeToBasis,
  coreWorldStateFromLegacyWorld
} from '../Core/adapters';
import type { LegacyGasRecord, LegacyCompositionRecord, LegacyWorldInput } from '../Core/adapters';
import { validateWorldState } from '../Core/worldState';
import { createRandom } from '../Generator/random';
import type { PhysValue, ChemicalEvolutionState, InventoryMode } from '../../types/physics';
import type {
  GeneratedWorld,
  GenerationSettings,
  CosmologyOption,
  EpochOption,
  CentralObjectOption,
  CelestialBodyOption,
  CradleOption
} from '../../types';

// ============================================
// Фикстуры
// ============================================

/**
 * Тип фикстуры: включает опциональное migration (история миграций
 * может присутствовать в реальных сохранениях) — доступ к полю
 * в тестах типобезопасен без привязки к полной схеме SavedWorld.
 */
interface LegacySaveFixture {
  id: string;
  seed: string;
  savedAt: string;
  version: string | undefined;
  customMarker: string;
  atmosphere: { totalPressure: number | null };
  /** История миграций (присутствует в реальных сохранениях после 1.1). */
  migration?: { from: string; notes: string[] };
  /** Поле ядра этапа 4.1: отсутствие = «ядро не инициализировано». */
  coreWorldState?: unknown;
}

/** Минимальное легаси-сохранение схемы 1.0 с кастомными полями. */
function makeLegacySave(version: string | undefined, extra?: Record<string, unknown>): LegacySaveFixture {
  return {
    id: 'world-1',
    seed: 'seed-1',
    savedAt: '2024-01-01T00:00:00.000Z',
    version,
    // кастомное поле, которое миграция обязана сохранить
    customMarker: 'unique-value-42',
    // легаси-давление null: НЕ должно превратиться в 0 при миграции
    atmosphere: { totalPressure: null as number | null },
    ...extra
  } as LegacySaveFixture;
}

function physValue(pv: PhysValue): PhysValue {
  return pv;
}

/** Полная фикстура химического состояния (все обязательные поля). */
function chemState(mode: InventoryMode, inventory: Record<string, number>): ChemicalEvolutionState {
  return {
    mode,
    unitsNote: 'тестовая фикстура',
    inventory,
    reservoirs: {
      atmospheric: { ...inventory },
      liquidSurface: {},
      subsurfaceLiquid: {},
      solidDeposits: {}
    },
    molarFractions: {},
    surfacePressurePa: null,
    gravityMs2: null,
    meanMolarMassKgMol: null,
    modelTimeYears: 0,
    stepDurationYears: 100,
    history: [],
    oxygenBalance: { production: 0, consumption: 0, net: 0, note: 'тест' },
    notes: []
  };
}

/** Легаси-мир со звездой и орбитой вокруг звезды. */
function starWorld(): LegacyWorldInput {
  return {
    id: 'w-star',
    seed: 'seed-star',
    generatorVersion: '3.0.2',
    centralObjectSystem: { kind: 'star' },
    orbit: { frame: 'around_star' },
    bodyPhysics: {
      massKg: physValue({ value: 5.972e24, unit: 'кг', confidence: 'estimated', method: 'сэмплирование из диапазона' }),
      radiusM: physValue({ value: 6.371e6, unit: 'м', confidence: 'estimated', method: 'сэмплирование из диапазона' }),
      densityKgM3: physValue({ value: 5514, unit: 'кг/м³', confidence: 'derived', formula: 'M/(4/3·π·R³)' }),
      surfaceGravityMs2: physValue({ value: 9.81, unit: 'м/с²', confidence: 'derived', formula: 'g = G·M/R²' })
    },
    energyBudget: {
      incidentFlux: physValue({ value: 1361, unit: 'Вт/м²', confidence: 'derived', formula: 'L/(4πa²)' }),
      equilibriumTemperature: physValue({ value: 255, unit: 'К', confidence: 'derived', formula: '(F(1-A)/(4σ))^0.25' })
    },
    chemicalState: chemState('column_inventory', { ch4: 10, n2: 20 })
  };
}

// ============================================
// 1. МИГРАЦИИ СОХРАНЕНИЙ
// ============================================

describe('Stage 4.1 Persistence: миграции сохранений', () => {
  it('миграция 1.0 → 1.2 проходит всю цепочку с честным следом', () => {
    const save = makeLegacySave('1.0');
    const result = migrateSavedWorld(save);
    expect(result.from).toBe('1.0');
    expect(result.to).toBe('1.2');
    expect(result.world.version).toBe('1.2');
    // две записи от миграции 1.0→1.1 и одна от 1.1→1.2
    expect(result.notes.length).toBe(3);
    expect(result.world.migration?.from).toBe('1.0');
    expect(result.world.migration?.notes).toEqual(result.notes);
    // coreWorldState НЕ создаётся задним числом: отсутствие = «не инициализировано»
    expect(result.world.coreWorldState).toBeUndefined();
    // кастомные поля не теряются
    expect(result.world.customMarker).toBe('unique-value-42');
    // null НЕ превращается в 0
    expect(result.world.atmosphere.totalPressure).toBeNull();
  });

  it('миграция 1.1 → 1.2 добавляет запись о coreWorldState', () => {
    const save = makeLegacySave('1.1');
    const result = migrateSavedWorld(save);
    expect(result.from).toBe('1.1');
    expect(result.notes.length).toBe(1);
    expect(result.notes[0]).toContain('coreWorldState');
    expect(result.world.version).toBe('1.2');
    expect(result.world.coreWorldState).toBeUndefined();
  });

  it('миграция идемпотентна: мир схемы 1.2 не переписывается повторно', () => {
    const save = makeLegacySave('1.2');
    const result = migrateSavedWorld(save);
    expect(result.from).toBe('1.2');
    expect(result.to).toBe('1.2');
    expect(result.notes).toEqual([]);
    // объект не копируется и не обрабатывается повторно
    expect(result.world).toBe(save);
    // ключ migration не навязывается миру без миграции
    expect(result.world.migration).toBeUndefined();
  });

  it('неизвестная, но формат-корректная версия отклоняется явно (unsupported_version)', () => {
    // Stage 4.1.1 (ISSUE 6): раньше '0.9'/'1.3'/'2.0' молча трактовались
    // как 1.0 и «мигрировались» — номер схемы выдумывался. Теперь
    // сохранение из будущего/прошлого формата — честная ошибка.
    for (const version of ['0.9', '1.3', '2.0']) {
      const save = makeLegacySave(version);
      try {
        migrateSavedWorld(save);
        expect.unreachable(`версия ${version} должна быть отклонена`);
      } catch (e) {
        expect(e).toBeInstanceOf(MigrationError);
        expect((e as MigrationError).code).toBe('unsupported_version');
        expect((e as MigrationError).fromVersion).toBe(version);
        expect((e as MigrationError).message).toContain(version);
      }
    }
  });

  it('мусорная строка версии отклоняется (invalid_version)', () => {
    for (const version of ['abc', '2', '']) {
      const save = makeLegacySave(version);
      try {
        migrateSavedWorld(save);
        expect.unreachable(`версия «${version}» должна быть отклонена`);
      } catch (e) {
        expect(e).toBeInstanceOf(MigrationError);
        expect((e as MigrationError).code).toBe('invalid_version');
      }
    }
  });

  it('ошибка миграции не мутирует оригинал сохранения', () => {
    const save = makeLegacySave('2.0');
    expect(() => migrateSavedWorld(save)).toThrow(MigrationError);
    expect(save.version).toBe('2.0');
    expect(save.migration).toBeUndefined();
    expect(save.customMarker).toBe('unique-value-42');
  });

  it('отсутствующая версия трактуется как 1.0 без выдумывания номера', () => {
    const save = makeLegacySave(undefined);
    const result = migrateSavedWorld(save);
    expect(result.from).toBe('1.0');
    expect(result.world.migration?.notes[0]).toContain('не указана');
    expect(result.world.version).toBe('1.2');
  });

  it('легаси-записи истории миграции сохраняются, новые дописываются', () => {
    const save = makeLegacySave('1.1', {
      migration: { from: '1.0', notes: ['старая запись миграции'] }
    });
    const result = migrateSavedWorld(save);
    const notes = result.world.migration?.notes ?? [];
    expect(notes[0]).toBe('старая запись миграции');
    expect(notes.length).toBe(2);
    expect(notes[1]).toContain('coreWorldState');
  });

  it('миграции детерминированы: два прогона дают одинаковый результат', () => {
    const a = migrateSavedWorld(makeLegacySave('1.0'));
    const b = migrateSavedWorld(makeLegacySave('1.0'));
    expect(a.world).toEqual(b.world);
    expect(a.notes).toEqual(b.notes);
  });

  it('ошибка несовместимой целевой схемы диагностируется явно', () => {
    const save = makeLegacySave('1.0');
    expect(() => migrateSavedWorld(save, '9.9' as never)).toThrowError(/нет миграции/);
  });

  it('версии схемы и Storage согласованы', () => {
    expect(CURRENT_SAVE_SCHEMA_VERSION).toBe('1.2');
    expect([...SAVE_SCHEMA_VERSIONS]).toEqual(['1.0', '1.1', '1.2']);
    expect(STORAGE_FORMAT_VERSION).toBe('1.2');
    expect([...SUPPORTED_SAVE_VERSIONS]).toEqual(['1.0', '1.1', '1.2']);
  });
});

// ============================================
// 2. РЕЕСТР НАУЧНЫХ НАБОРОВ ДАННЫХ
// ============================================

describe('Stage 4.1 Persistence: реестр наборов данных', () => {
  it('регистрирует и извлекает набор по id+версии', () => {
    const registry = createDatasetRegistry();
    registry.register({ id: 'species-core', version: '1.0.0', name: 'Базовые виды' });
    expect(registry.has('species-core', '1.0.0')).toBe(true);
    expect(registry.has('species-core', '2.0.0')).toBe(false);
    expect(registry.get('species-core', '1.0.0')?.name).toBe('Базовые виды');
    expect(registry.get('species-core', '2.0.0')).toBeNull();
    expect(registry.list().length).toBe(1);
  });

  it('не выдумывает лицензию и контрольную сумму: поля остаются undefined', () => {
    const registry = createDatasetRegistry();
    registry.register({ id: 'minimal', version: '0.1' });
    const d = registry.get('minimal', '0.1');
    expect(d).not.toBeNull();
    expect(d?.licenseStatus).toBeUndefined();
    expect(d?.checksum).toBeUndefined();
    expect(d?.reference).toBeUndefined();
  });

  it('отвергает пустой идентификатор и пустую версию', () => {
    const registry = createDatasetRegistry();
    expect(() => registry.register({ id: '  ', version: '1' })).toThrowError(/идентификатор/);
    expect(() => registry.register({ id: 'x', version: '' })).toThrowError(/версия/);
  });
});

// ============================================
// 3. АДАПТЕР ЕДИНИЦ
// ============================================

describe('Stage 4.1 Adapters: легаси единицы', () => {
  it('русские единицы PhysValue переводятся в реестр ядра', () => {
    expect(legacyUnitToCore('кг')).toBe('kg');
    expect(legacyUnitToCore('Вт/м²')).toBe('W_m2');
    expect(legacyUnitToCore('моль/м²')).toBe('mol_m2');
    expect(legacyUnitToCore('атм')).toBe('atm');
    expect(legacyUnitToCore('м/с²')).toBe('m_s2');
    // '%' и «доля» — безразмерные
    expect(legacyUnitToCore('%')).toBe('1');
    expect(legacyUnitToCore('доля')).toBe('1');
  });

  it('ASCII-единицы, уже известные реестру, проходят насквозь', () => {
    expect(legacyUnitToCore('m')).toBe('m');
    expect(legacyUnitToCore('Pa')).toBe('Pa');
  });

  it('неизвестная единица даёт null, а не выдуманный идентификатор', () => {
    expect(legacyUnitToCore('furlong')).toBeNull();
    expect(legacyUnitToCore('')).toBeNull();
  });
});

// ============================================
// 4. PHYSVALUE → SCIENTIFIC VALUE
// ============================================

describe('Stage 4.1 Adapters: PhysValue → ScientificValue', () => {
  it('established и derived → known с сохранением источника и метода', () => {
    const established = physValueToScientificValue(
      physValue({ value: 5.972e24, unit: 'кг', confidence: 'established', source: 'NASA' })
    );
    expect(established.status).toBe('known');
    if (established.status === 'known') {
      expect(established.quantity.unit).toBe('kg');
      expect(established.quantity.value).toBeCloseTo(5.972e24, 0);
      expect(established.provenance?.sourceName).toBe('NASA');
    }

    const derived = physValueToScientificValue(
      physValue({ value: 5514, unit: 'кг/м³', confidence: 'derived', formula: 'M/(4/3·π·R³)', method: 'расчёт плотности' })
    );
    expect(derived.status).toBe('known');
    if (derived.status === 'known') {
      expect(derived.quantity.unit).toBe('kg_m3');
      expect(derived.provenance?.method).toBe('расчёт плотности');
      expect(derived.provenance?.note).toContain('формула: M/(4/3·π·R³)');
    }
  });

  it('estimated → estimated: метод обязателен и сохраняется', () => {
    const sv = physValueToScientificValue(
      physValue({ value: 250, unit: 'К', confidence: 'estimated', method: 'упрощённая модель' })
    );
    expect(sv.status).toBe('estimated');
    if (sv.status === 'estimated') {
      expect(sv.method).toBe('упрощённая модель');
      expect(sv.quantity.unit).toBe('K');
    }
  });

  it('hypothetical → estimated с честным предупреждением', () => {
    const sv = physValueToScientificValue(
      physValue({ value: 1e-3, unit: 'бар', confidence: 'hypothetical', method: 'гипотетический сценарий' })
    );
    expect(sv.status).toBe('estimated');
    if (sv.status === 'estimated') {
      expect(sv.provenance?.note).toContain('гипотетическая');
    }
  });

  it('game_assumption → estimated с явной пометкой «не научное измерение»', () => {
    const sv = physValueToScientificValue(
      physValue({ value: 42, unit: 'моль', confidence: 'game_assumption' })
    );
    expect(sv.status).toBe('estimated');
    if (sv.status === 'estimated') {
      expect(sv.provenance?.note).toContain('игровое допущение');
      expect(sv.method).toContain('игровое допущение');
    }
  });

  it('value = null → unknown: неизвестность не подменяется числом, provenance сохраняется', () => {
    const sv = physValueToScientificValue(
      physValue({ value: null, unit: 'Па', confidence: 'unknown', note: 'данных недостаточно' })
    );
    expect(sv.status).toBe('unknown');
    expect(sv).not.toHaveProperty('quantity');
    // Stage 4.1.1 (ISSUE 8): provenance неизвестного значения не теряется
    const withSource = physValueToScientificValue(
      physValue({ value: null, unit: 'Па', confidence: 'unknown', method: 'модель не применима', source: 'датчик X' })
    );
    expect(withSource.status).toBe('unknown');
    if (withSource.status === 'unknown') {
      expect(withSource.provenance?.sourceName).toBe('датчик X');
      expect(withSource.provenance?.method).toBe('модель не применима');
    }
  });

  it('незарегистрированная единица → invalid: фиктивной единицы нет, оригинал в rawInput', () => {
    const sv = physValueToScientificValue(
      physValue({ value: 12, unit: 'furlong', confidence: 'estimated', method: 'тест' })
    );
    expect(sv.status).toBe('invalid');
    if (sv.status === 'invalid') {
      expect(sv.reason).toContain('furlong');
      // Stage 4.1.1 (ISSUE 8): корректного quantity больше нет — раньше
      // создавалась фиктивная unit '1'; оригинал сохраняется в rawInput.
      expect(sv.quantity).toBeUndefined();
      const raw = sv.provenance?.rawInput as Record<string, unknown> | undefined;
      expect(raw?.['originalValue']).toBe(12);
      expect(raw?.['originalUnit']).toBe('furlong');
      expect(sv.provenance?.method).toBe('тест');
    }
  });

  it('range → interval-неопределённость (без заявления о доверительной вероятности)', () => {
    const sv = physValueToScientificValue(
      physValue({ value: 1, unit: 'атм', confidence: 'estimated', method: 'тест', range: { min: 0.5, max: 1.5 } })
    );
    expect(sv.status).toBe('estimated');
    if (sv.status === 'estimated') {
      expect(sv.uncertainty?.kind).toBe('interval');
      if (sv.uncertainty?.kind === 'interval') {
        expect(sv.uncertainty.lower).toBe(0.5);
        expect(sv.uncertainty.upper).toBe(1.5);
        // это НЕ доверительный интервал по умолчанию
        expect(sv.uncertainty.interpretation ?? 'interval').toBe('interval');
      }
    }
  });

  it('parameters расчёта переносятся в provenance.rawInput', () => {
    const sv = physValueToScientificValue(
      physValue({
        value: 2,
        unit: 'м',
        confidence: 'derived',
        formula: 'r = 2R',
        parameters: { R: 1 }
      })
    );
    if (sv.status === 'known') {
      expect(sv.provenance?.rawInput).toEqual({ R: 1 });
    } else {
      throw new Error('derived ожидался как known');
    }
  });

  it('numberToScientificValue: null → unknown, неизвестная единица → invalid', () => {
    expect(numberToScientificValue(null, 'kg', 'тест').status).toBe('unknown');
    expect(numberToScientificValue(NaN, 'kg', 'тест').status).toBe('unknown');
    expect(numberToScientificValue(5, 'furlong', 'тест').status).toBe('invalid');
    const ok = numberToScientificValue(5, 'kg', 'тест');
    expect(ok.status).toBe('estimated');
  });
});

// ============================================
// 5. ЛЕГАСИ КАТАЛОГ ГАЗОВ → SPECIES CATALOG
// ============================================

describe('Stage 4.1 Adapters: легаси газы → ScientificSpecies', () => {
  const gases: LegacyGasRecord[] = [
    { id: 'ch4', formula: 'CH₄', name: 'Метан', molarMass: 16.04, aggregateStates: ['gas'] },
    { id: 'n2', formula: 'N₂', name: 'Азот', molarMass: 28.014, aggregateStates: ['gas'] },
    // вид без известного элементного состава
    { id: 'unidentified', formula: '?', name: null, molarMass: null, aggregateStates: ['gas'] }
  ];
  const compositions: Record<string, LegacyCompositionRecord> = {
    ch4: { formula: 'CH₄', elements: { C: 1, H: 4 } },
    n2: { formula: 'N₂', elements: { N: 2 } }
  };

  it('строит каталог из легаси данных без ручного дублирования значений', () => {
    const catalog = buildSpeciesCatalogFromLegacy(gases, compositions);
    expect(catalog.size()).toBe(2);
    expect(catalog.has('ch4')).toBe(true);
    const ch4 = catalog.get('ch4');
    expect(ch4).not.toBeNull();
    // г/моль → кг/моль: точный множитель 1e-3
    expect(ch4?.molarMassKgMol).toBeCloseTo(0.01604, 9);
    expect(ch4?.phase).toBe('gas');
    expect(ch4?.elements).toEqual({ C: 1, H: 4 });
    expect(ch4?.charge).toBe(0);
    expect(ch4?.formula).toBe('CH₄');
  });

  it('виды без известного состава в каталог не попадают (состав не выдумывается)', () => {
    const catalog = buildSpeciesCatalogFromLegacy(gases, compositions);
    expect(catalog.has('unidentified')).toBe(false);
    expect(catalog.size()).toBe(2);
  });
});

// ============================================
// 6. ХИМИЧЕСКИЙ ИНВЕНТАРЬ → МАТЕРИАЛЬНЫЙ ИНВЕНТАРЬ
// ============================================

describe('Stage 4.1 Adapters: химический инвентарь', () => {
  it('column_inventory → column_amount (моль/м²)', () => {
    const inv = chemicalStateToMaterialInventory(chemState('column_inventory', { ch4: 10, n2: 20 }));
    expect(inv).not.toBeNull();
    expect(inv?.basis).toBe('column_amount');
    expect(inv?.entries).toEqual({ ch4: 10, n2: 20 });
  });

  it('game_normalized → arbitrary_units: игровая нормировка НЕ превращается в моль/м²', () => {
    const inv = chemicalStateToMaterialInventory(chemState('game_normalized', { ch4: 0.3, n2: 0.7 }));
    expect(inv?.basis).toBe('arbitrary_units');
  });

  it('нулевые и некорректные записи отфильтровываются, пустой инвентарь → null', () => {
    const inv = chemicalStateToMaterialInventory(
      chemState('column_inventory', { ch4: 10, co2: 0, broken: Number.NaN })
    );
    expect(inv?.entries).toEqual({ ch4: 10 });
    expect(chemicalStateToMaterialInventory(chemState('column_inventory', {}))).toBeNull();
  });

  it('inventoryModeToBasis согласован с адаптером инвентаря', () => {
    expect(inventoryModeToBasis('column_inventory')).toBe('column_amount');
    expect(inventoryModeToBasis('game_normalized')).toBe('arbitrary_units');
  });
});

// ============================================
// 7. LEGACY WORLD → CORE WORLD STATE
// ============================================

describe('Stage 4.1 Adapters: GeneratedWorld → CoreWorldState', () => {
  it('звёздная система: гравитация и излучение разделены, ядро валидно', () => {
    const core = coreWorldStateFromLegacyWorld(starWorld());
    expect(core.bodies.map((b) => b.id)).toEqual(['central', 'planet']);
    expect(core.bodies[0].kind).toBe('star');
    // гравитационная иерархия
    expect(core.gravity['planet']).toBe('central');
    // излучение — отдельный список
    expect(core.radiationSources.length).toBe(1);
    expect(core.radiationSources[0].kind).toBe('star');
    expect(core.radiationSources[0].bodyId).toBe('central');
    // часы ядра начинаются с нуля: легаси химическое время НЕ подмешивается
    expect(core.clock.localTimeS).toBe(0);
    expect(core.clock.stepCount).toBe(0);
    expect(core.clock.priorSegmentsS).toBe(0);
    // происхождение генерации сохранено
    expect(core.legacy.seed).toBe('seed-star');
    expect(core.legacy.generatorVersion).toBe('3.0.2');
    // итоговое состояние проходит собственную валидацию ядра
    expect(validateWorldState(core)).toEqual([]);
  });

  it('физика тела и энергетический бюджет становятся научными значениями', () => {
    const core = coreWorldStateFromLegacyWorld(starWorld());
    const planet = core.bodies.find((b) => b.id === 'planet');
    expect(planet).toBeDefined();
    const props = planet?.properties ?? {};
    expect(props['mass']?.status).toBe('estimated');
    expect(props['density']?.status).toBe('known');
    expect(props['incidentFlux']?.status).toBe('known');
    if (props['incidentFlux']?.status === 'known') {
      expect(props['incidentFlux'].quantity.unit).toBe('W_m2');
      expect(props['incidentFlux'].quantity.value).toBeCloseTo(1361, 0);
    }
  });

  it('химический инвентарь становится атмосферным резервуаром планеты', () => {
    const core = coreWorldStateFromLegacyWorld(starWorld());
    expect(core.reservoirs.length).toBe(1);
    const atmosphere = core.reservoirs[0];
    expect(atmosphere.kind).toBe('atmosphere');
    expect(atmosphere.bodyId).toBe('planet');
    expect(atmosphere.material?.basis).toBe('column_amount');
    expect(atmosphere.material?.entries).toEqual({ ch4: 10, n2: 20 });
  });

  it('компактный остаток: гравитация есть, источника излучения НЕ выдумывается', () => {
    const core = coreWorldStateFromLegacyWorld({
      id: 'w-remnant',
      seed: 'seed-r',
      generatorVersion: '3.0.2',
      centralObjectSystem: { kind: 'compact_remnant' },
      orbit: { frame: 'around_star' }
    });
    expect(core.bodies[0].kind).toBe('compact_remnant');
    expect(core.gravity['planet']).toBe('central');
    expect(core.radiationSources).toEqual([]);
    expect(validateWorldState(core)).toEqual([]);
  });

  it('свободно плавающий мир: ни родителя, ни излучателя, фиктивных тел нет', () => {
    const core = coreWorldStateFromLegacyWorld({
      id: 'w-free',
      seed: 'seed-f',
      generatorVersion: '3.0.2',
      centralObjectSystem: null,
      orbit: { frame: 'free_floating' }
    });
    expect(core.bodies.map((b) => b.id)).toEqual(['planet']);
    expect(core.gravity['planet']).toBeNull();
    expect(core.radiationSources).toEqual([]);
    expect(validateWorldState(core)).toEqual([]);
  });

  it('мир без химии не получает пустого резервуара-заглушку', () => {
    const core = coreWorldStateFromLegacyWorld({
      id: 'w-bare',
      seed: 'seed-b',
      generatorVersion: '3.0.2'
    });
    expect(core.reservoirs).toEqual([]);
    expect(validateWorldState(core)).toEqual([]);
  });
});

// ============================================
// 8. РЕГРЕССИЯ PRNG
// ============================================

describe('Stage 4.1 Регрессия: детерминизм PRNG', () => {
  it('одинаковый seed даёт одинаковую последовательность next()', () => {
    const a = createRandom('evowars-seed-1');
    const b = createRandom('evowars-seed-1');
    const seqA = [a.next(), a.next(), a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
    // значения строго в [0, 1)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('разные seed дают разные последовательности', () => {
    const a = createRandom('evowars-seed-1');
    const b = createRandom('evowars-seed-2');
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).not.toEqual(seqB);
  });

  it('nextIntRange, shuffle и generateId детерминированы', () => {
    const a = createRandom('determinism-check');
    const b = createRandom('determinism-check');
    expect([a.nextIntRange(1, 100), a.nextIntRange(1, 100)]).toEqual([b.nextIntRange(1, 100), b.nextIntRange(1, 100)]);
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(a.shuffle(arr)).toEqual(b.shuffle(arr));
    expect(a.generateId('world')).toEqual(b.generateId('world'));
  });
});

// ============================================
// 9. STAGE 4.1.1: ПРОЦЕНТЫ ЛЕГАСИ-ЕДИНИЦ (ISSUE 8)
// ============================================

describe('Stage 4.1.1 Adapters: масштабирование легаси-процентов', () => {
  it('50% → 0.5 доли (до 4.1.1 значение оставалось равным 50)', () => {
    const sv = physValueToScientificValue(
      physValue({ value: 50, unit: '%', confidence: 'established', source: 'справочник' })
    );
    expect(sv.status).toBe('known');
    if (sv.status === 'known') {
      expect(sv.quantity.value).toBe(0.5);
      expect(sv.quantity.unit).toBe('1');
      // масштабирование задокументировано в provenance
      expect(sv.provenance?.note).toContain('масштабирование');
      expect(sv.provenance?.sourceName).toBe('справочник');
    }
  });

  it('100% → 1; 0% → 0', () => {
    const full = physValueToScientificValue(physValue({ value: 100, unit: '%', confidence: 'established' }));
    if (full.status !== 'known') throw new Error('ожидался known');
    expect(full.quantity.value).toBe(1);
    const zero = physValueToScientificValue(physValue({ value: 0, unit: '%', confidence: 'established' }));
    if (zero.status !== 'known') throw new Error('ожидался known');
    expect(zero.quantity.value).toBe(0);
  });

  it('range масштабируется вместе со значением', () => {
    const sv = physValueToScientificValue(
      physValue({ value: 50, unit: '%', confidence: 'estimated', method: 'тест', range: { min: 25, max: 75 } })
    );
    expect(sv.status).toBe('estimated');
    if (sv.status === 'estimated') {
      expect(sv.uncertainty?.kind).toBe('interval');
      if (sv.uncertainty?.kind === 'interval') {
        expect(sv.uncertainty.lower).toBe(0.25);
        expect(sv.uncertainty.upper).toBe(0.75);
      }
    }
  });

  it('legacyUnitScaleFactor: проценты — 0.01, «доля» и прямые единицы — 1', () => {
    expect(legacyUnitScaleFactor('%')).toBe(0.01);
    expect(legacyUnitScaleFactor('доля')).toBe(1);
    expect(legacyUnitScaleFactor('кг')).toBe(1);
    // незнакомая единица не выдумывает множитель
    expect(legacyUnitScaleFactor('furlong')).toBe(1);
  });
});

// ============================================
// 10. STAGE 4.1.1: STORAGE — ИЗОЛЯЦИЯ ОШИБОК И ЗАЩИТА НЕСОВМЕСТИМЫХ ЗАПИСЕЙ (ISSUE 7)
// ============================================

const STORAGE_TEST_KEY = 'evowars_worlds';

const fixtureCosmology: CosmologyOption = {
  id: 'cosmo-1', name: 'Тестовая вселенная', description: 'фикстура теста',
  baseWeight: 1, tags: [], isAnomalous: false, compatibilityInfo: '—',
  scientificStatus: 'physically_plausible', specialRules: [], generationImpact: '—'
};
const fixtureEpoch: EpochOption = {
  id: 'epoch-1', name: 'Эпоха', ageRange: { min: 0, max: 13.8 }, description: 'фикстура',
  baseWeight: 1, tags: [], scientificStatus: 'physically_plausible', compatibilityNotes: '—'
};
const fixtureCentralObject: CentralObjectOption = {
  id: 'co-1', name: 'Звезда', objectClass: 'star', role: 'primary_star',
  potentialEnergySources: [], characteristicConstraints: [], potentialThreats: [],
  compatibleOrbits: [], scientificStatus: 'physically_plausible',
  baseWeight: 1, tags: [], minAge: null, maxAge: null
};
const fixtureCelestialBody: CelestialBodyOption = {
  id: 'body-1', name: 'Планета', bodyType: 'planet', sizeClass: 'earth_like',
  gravityDescription: '—', geologicalProperties: [], typicalConstraints: [],
  compatibleCentralObjects: [], scientificStatus: 'physically_plausible', baseWeight: 1, tags: []
};
const fixtureCradle: CradleOption = {
  id: 'cradle-1', name: 'Колыбель', matterState: 'liquid',
  requiredTemperatureRange: { min: 250, max: 400 }, requiredPressureRange: { min: 0.5, max: 10 },
  chemicalFeatures: [], availableEnergySources: ['chemical'], chemicalConstraints: [],
  solventTypes: [], compatibilityRequirements: [], scientificStatus: 'physically_plausible',
  baseWeight: 1, tags: []
};

function makeGeneratedWorld(id: string): GeneratedWorld {
  return {
    id,
    createdAt: '2024-01-01T00:00:00.000Z',
    seed: 'seed-' + id,
    generatorVersion: '0.3.0',
    mode: 'realistic',
    cosmology: fixtureCosmology,
    epoch: fixtureEpoch,
    centralObject: fixtureCentralObject,
    celestialBody: fixtureCelestialBody,
    cradle: fixtureCradle,
    cradleLocalEnvironment: {
      temperature: null,
      temperatureRange: null,
      pressure: null,
      pressureRange: null,
      composition: [],
      matterState: 'liquid',
      energySources: ['chemical'],
      chemicalConstraints: [],
      locationType: 'surface',
      locationDescription: '—',
      notes: 'фикстура теста'
    },
    physicalCharacteristics: {},
    energySources: { primary: ['chemical'], secondary: [], description: '—' },
    atmosphere: { components: [], totalPressure: null, temperature: null, notes: 'фикстура' },
    appliedRules: [],
    warnings: [],
    scientificStatus: 'physically_plausible',
    causalChain: {
      cosmology: '—', epoch: '—', centralObject: '—', celestialBody: '—', cradle: '—',
      chemicalConstraints: [], energySources: [], lifeChallenges: [], unknowns: []
    },
    evolutionImplications: { possibleAdaptations: [], constraints: [], opportunities: [], uncertainties: [] },
    userModifications: {}
  };
}

const fixtureSettings: GenerationSettings = {
  seed: 'seed-storage',
  mode: 'realistic',
  weights: { cosmology: {}, epoch: {}, centralObject: {}, celestialBody: {}, cradle: {} },
  fixedCategories: {},
  enableChemicalEvolution: false,
  chemicalEvolutionSteps: 0
};

function writeRawEntries(entries: unknown[]): void {
  localStorage.setItem(STORAGE_TEST_KEY, JSON.stringify(entries));
}

function rawEntry(id: string, version: string): Record<string, unknown> {
  return { id, version, savedAt: '2024-01-01T00:00:00.000Z', seed: 'seed-' + id };
}

function readRawEntries(): Array<Record<string, unknown>> {
  return JSON.parse(localStorage.getItem(STORAGE_TEST_KEY) ?? '[]') as Array<Record<string, unknown>>;
}

describe('Stage 4.1.1 Storage: изоляция ошибок и защита несовместимых записей', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('три нормальных мира (1.0/1.1/1.2) загружаются и мигрируются к 1.2', () => {
    writeRawEntries([rawEntry('w1', '1.0'), rawEntry('w2', '1.1'), rawEntry('w3', '1.2')]);
    const worlds = getAllWorlds();
    expect(worlds.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(worlds.every((w) => w.version === '1.2')).toBe(true);
  });

  it('несовместимый мир (версия 2.0) не прячет остальные', () => {
    // До 4.1.1 один try/catch на весь массив: любая ошибка → getAllWorlds() === []
    writeRawEntries([rawEntry('w1', '1.0'), rawEntry('future', '2.0'), rawEntry('w2', '1.0')]);
    const worlds = getAllWorlds();
    expect(worlds.map((w) => w.id)).toEqual(['w1', 'w2']);
    const health = getStorageHealth();
    expect(health.rawEntryCount).toBe(3);
    expect(health.loadedWorldCount).toBe(2);
    expect(health.parseError).toBeNull();
    expect(health.incompatibleEntries.length).toBe(1);
    expect(health.incompatibleEntries[0]?.version).toBe('2.0');
    expect(health.incompatibleEntries[0]?.reason).toContain('2.0');
  });

  it('несовместимая запись НЕ удаляется из localStorage при чтении', () => {
    writeRawEntries([rawEntry('w1', '1.0'), rawEntry('future', '2.0')]);
    getAllWorlds();
    const raw = readRawEntries();
    expect(raw.some((e) => e['id'] === 'future' && e['version'] === '2.0')).toBe(true);
  });

  it('saveWorld не уничтожает несовместимую запись', () => {
    writeRawEntries([rawEntry('w1', '1.0'), rawEntry('future', '2.0')]);
    const saved = saveWorld(makeGeneratedWorld('w-new'), fixtureSettings);
    expect(saved.version).toBe('1.2');
    // запись из будущего формата сохранена как есть
    const raw = readRawEntries();
    expect(raw.some((e) => e['id'] === 'future' && e['version'] === '2.0')).toBe(true);
    // новые и совместимые миры загружаются
    const ids = getAllWorlds().map((w) => w.id);
    expect(ids).toContain('w-new');
    expect(ids).toContain('w1');
  });

  it('deleteWorld удаляет только выбранную запись, несовместимые не трогает', () => {
    writeRawEntries([rawEntry('w1', '1.0'), rawEntry('future', '2.0'), rawEntry('w2', '1.0')]);
    expect(deleteWorld('w1')).toBe(true);
    const raw = readRawEntries();
    expect(raw.some((e) => e['id'] === 'w1')).toBe(false);
    expect(raw.some((e) => e['id'] === 'future' && e['version'] === '2.0')).toBe(true);
    expect(raw.some((e) => e['id'] === 'w2')).toBe(true);
    // несуществующий id — честный false
    expect(deleteWorld('missing')).toBe(false);
  });

  it('битый JSON диагностируется через getStorageHealth, а не молчит', () => {
    localStorage.setItem(STORAGE_TEST_KEY, '{broken json');
    expect(getAllWorlds()).toEqual([]);
    const health = getStorageHealth();
    expect(health.parseError).not.toBeNull();
    expect(health.rawEntryCount).toBe(0);
  });

  it('importWorldFromJSON отклоняет сохранение будущей версии', () => {
    const json = JSON.stringify({
      id: 'w-future',
      seed: 's',
      cosmology: {},
      epoch: {},
      centralObject: {},
      celestialBody: {},
      cradle: {},
      version: '2.0',
      savedAt: '2024-01-01T00:00:00.000Z'
    });
    expect(importWorldFromJSON(json)).toBeNull();
    // мусорный JSON — тоже честный null
    expect(importWorldFromJSON('not json at all')).toBeNull();
  });
});
