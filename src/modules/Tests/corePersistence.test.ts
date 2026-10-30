// ============================================
// STAGE 4.1 - Тесты персистентности: миграции, адаптеры, PRNG-регрессия
// ============================================

import { describe, it, expect } from 'vitest';
import {
  migrateSavedWorld,
  CURRENT_SAVE_SCHEMA_VERSION,
  SAVE_SCHEMA_VERSIONS,
  createDatasetRegistry
} from '../Core/migrations';
import { STORAGE_FORMAT_VERSION, SUPPORTED_SAVE_VERSIONS } from '../Storage';
import {
  legacyUnitToCore,
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

  it('неизвестная версия трактуется как 1.0 с честной записью в истории', () => {
    const save = makeLegacySave('0.9');
    const result = migrateSavedWorld(save);
    expect(result.from).toBe('1.0');
    expect(result.to).toBe('1.2');
    expect(result.world.migration?.notes[0]).toContain('не указана или не распознана');
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

  it('value = null → unknown: неизвестность не подменяется числом', () => {
    const sv = physValueToScientificValue(
      physValue({ value: null, unit: 'Па', confidence: 'unknown', note: 'данных недостаточно' })
    );
    expect(sv.status).toBe('unknown');
    expect(sv).not.toHaveProperty('quantity');
  });

  it('незарегистрированная единица → invalid с сохранением отклонённых данных', () => {
    const sv = physValueToScientificValue(
      physValue({ value: 12, unit: 'furlong', confidence: 'estimated', method: 'тест' })
    );
    expect(sv.status).toBe('invalid');
    if (sv.status === 'invalid') {
      expect(sv.reason).toContain('furlong');
      // отклонённые данные сохранены для диагностики
      expect(sv.quantity?.value).toBe(12);
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
