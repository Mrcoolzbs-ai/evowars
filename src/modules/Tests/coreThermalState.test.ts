// ============================================
// STAGE 4.2.2 - Тесты температурной иерархии и происхождения
// ============================================
//
// Шесть температурных понятий разделены (thermalState.ts):
// effective / equilibrium / surface / профиль / reservoir /
// локальная. Проверяются:
// - термодинамическая валидация (только 'K', неотрицательность,
//   статусы без числа, provenance);
// - профиль температур (single_layer_estimate ≠ вертикальный
//   профиль, обязательный limitations);
// - интеграция с validateWorldState (схема 1.2.0, новая ветка
//   invalid_thermal_state, reservoirTemperature → invalid_reservoir);
// - адаптеры легаси-пресетов (provenance сохраняется, ничего не
//   притворяется измерением);
// - resolver локальной температуры (запрещённые подстановки
//   отсутствуют ВСЕГДА, а не «обычно»);
// - диагностика «пресет vs T_eq» (порог только явный);
// - типизированный фазовый скрининг (числовая регрессия этапа 3).

import { describe, it, expect } from 'vitest';
import {
  TEMPERATURE_UNIT,
  THERMODYNAMIC_TEMPERATURE_DIMENSION,
  validateThermalScientificValue,
  hasUsableTemperature,
  temperatureValueOrNull,
  validateAtmosphericTemperatureProfile,
  validateBodyThermalState,
  ThermalStateError,
  resolveLocalReactionTemperature,
  diagnosePresetEquilibriumDivergence
} from '../Core/thermalState';
import type {
  AtmosphereTemperatureLayer,
  AtmosphericTemperatureProfile,
  BodyThermalState,
  LocalReactionTemperatureResolution
} from '../Core/thermalState';
import {
  createCoreWorldState,
  validateWorldState,
  CORE_WORLD_STATE_SCHEMA_VERSION
} from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import {
  knownValue,
  estimatedValue,
  unknownValue,
  notApplicable,
  notImplemented,
  invalidValue
} from '../Core/scientificValue';
import type { ScientificValue } from '../Core/scientificValue';
import { quantity, dimensionOf, sameDimension } from '../Core/physicalQuantity';
import { createReservoir } from '../Core/reservoir';
import { migrateSavedWorld } from '../Core/migrations';
import {
  atmospherePresetTemperatureToScientificValue,
  atmosphericProfileFromPreset,
  planetThermalStateFromLegacy,
  centralThermalStateFromLegacy,
  coreWorldStateFromLegacyWorld
} from '../Core/adapters';
import type { LegacyWorldInput } from '../Core/adapters';
import { analyzeAtmospherePhases, analyzeAtmospherePhasesWithProvenance } from '../PhaseEquilibrium';
import type { AtmospherePhysicalModel, PhysValue, AtmosphereState, OrbitalConfigurationData } from '../../types';
import { getAllPresets } from '../Atmosphere';
import { computeEnergyBudget } from '../EnergyBalance';

// ============================================
// ФИКСТУРЫ
// ============================================

/** Температура в K. */
function pv(valueK: number) {
  return quantity(valueK, 'K');
}

/** Известная температура в K с происхождением. */
function knownTemp(valueK: number, sourceName?: string): ScientificValue {
  return knownValue(pv(valueK), {
    provenance: sourceName !== undefined ? { sourceName } : undefined
  });
}

/** Валидное тепловое состояние планеты. */
function planetThermalState(): BodyThermalState {
  return {
    effectiveTemperature: notApplicable('планета — получатель излучения'),
    equilibriumTemperature: knownTemp(255, 'радиационный бюджет'),
    surfaceTemperature: knownTemp(288, 'внешняя фикстура'),
    atmosphericTemperatureProfile: {
      status: 'single_layer_estimate',
      layers: [
        {
          layerId: 'cloud-deck',
          temperature: estimatedValue(pv(110), 'оценка облачного слоя', {
            provenance: { sourceName: 'фикстура теста' }
          })
        }
      ],
      limitations: 'тестовая одиночная оценка — не вертикальный профиль'
    }
  };
}

/**
 * Мир с температурной иерархией: планета (T_eq 255 K, поверхность
 * 288 K, слой 'cloud-deck' 110 K) и спутник (профиль unknown).
 * Резервуары: ocean-1 (277.15 K), atmosphere-1 (БЕЗ температуры),
 * moon-ice-1 (110 K, тело moon), deep-basin (unknown).
 */
function thermalWorld(): CoreWorldState {
  const state = createCoreWorldState('w-thermal');
  state.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: {},
    thermalState: planetThermalState()
  });
  state.bodies.push({
    id: 'moon',
    kind: 'moon',
    properties: {},
    thermalState: {
      effectiveTemperature: notApplicable('спутник — получатель излучения'),
      equilibriumTemperature: unknownValue('T_eq спутника не вычислялась'),
      surfaceTemperature: unknownValue('температура поверхности неизвестна'),
      atmosphericTemperatureProfile: { status: 'unknown', layers: [] }
    }
  });
  state.gravity = { planet: null, moon: 'planet' };
  state.reservoirs.push({
    ...createReservoir('ocean-1', 'ocean', { bodyId: 'planet' }),
    reservoirTemperature: knownTemp(277.15, 'гидросфера фикстуры')
  });
  state.reservoirs.push(createReservoir('atmosphere-1', 'atmosphere', { bodyId: 'planet' }));
  state.reservoirs.push({
    ...createReservoir('moon-ice-1', 'ice', { bodyId: 'moon' }),
    reservoirTemperature: knownTemp(110, 'ледяная корка фикстуры')
  });
  state.reservoirs.push({
    ...createReservoir('deep-basin-1', 'ocean', { bodyId: 'planet' }),
    reservoirTemperature: unknownValue('глубинный бассейн не картирован', {
      sourceName: 'фикстура теста'
    })
  });
  return state;
}

/** Легаси PhysValue. */
function phys(value: number | null, unit: string, method?: string): PhysValue {
  return {
    value,
    unit,
    confidence: value === null ? 'unknown' : 'derived',
    ...(method !== undefined ? { method } : {})
  };
}

/** Легаси-вход адаптера: звезда 5772 K, T_eq 255 K, атмосфера 288 K. */
function legacyInput(overrides: Partial<LegacyWorldInput> = {}): LegacyWorldInput {
  return {
    id: 'w1',
    seed: 'seed-thermal',
    generatorVersion: '0.3.0',
    centralObjectSystem: { kind: 'star', effectiveTemperatureK: phys(5772, 'K') },
    orbit: { frame: 'around_star' },
    bodyPhysics: {
      massKg: phys(5.97e24, 'кг'),
      radiusM: phys(6.371e6, 'м'),
      densityKgM3: phys(5514, 'кг/м³'),
      surfaceGravityMs2: phys(9.81, 'м/с²')
    },
    atmosphere: {
      temperature: 288,
      presetKind: 'observational_reference',
      presetNotes: 'справочник фикстуры'
    },
    energyBudget: {
      incidentFlux: phys(1361, 'Вт/м²'),
      equilibriumTemperature: phys(255, 'K')
    },
    chemicalState: null,
    ...overrides
  };
}

/** Минимальная физическая модель атмосферы для фазового скрининга. */
function makeAtmosphereModel(): AtmospherePhysicalModel {
  return {
    molarFractions: { ch4: 0.6, n2: 0.4 },
    surfacePressurePa: phys(146521, 'Pa'),
    meanMolarMassKgMol: phys(0.0239, 'kg/mol'),
    partialPressuresPa: {
      ch4: phys(87913, 'Pa'),
      n2: phys(58609, 'Pa')
    },
    columnMassKgM2: null,
    columnMolM2: null,
    idealGasAssumption: true,
    idealGasNote: 'фикстура',
    fugacityNote: 'фикстура',
    layers: [],
    layersNote: 'фикстура',
    notes: []
  };
}

/** Температура результата как число (или null). */
function resolutionK(r: LocalReactionTemperatureResolution): number | null {
  return temperatureValueOrNull(r.temperature);
}

// ============================================
// 1. ВАЛИДАЦИЯ ТЕМПЕРАТУР
// ============================================

describe('Stage 4.2.2: термодинамическая валидация температур', () => {
  it('константа единицы — кельвин, размерность — термодинамическая', () => {
    expect(TEMPERATURE_UNIT).toBe('K');
    expect(sameDimension(dimensionOf(pv(300)), THERMODYNAMIC_TEMPERATURE_DIMENSION)).toBe(true);
    expect(sameDimension(dimensionOf(quantity(5, 'kg')), THERMODYNAMIC_TEMPERATURE_DIMENSION)).toBe(false);
  });

  it('известная температура в K проходит валидацию', () => {
    expect(validateThermalScientificValue(knownTemp(277.15))).toEqual([]);
    expect(validateThermalScientificValue(estimatedValue(pv(95), 'пресет'))).toEqual([]);
  });

  it('нулевая температура допустима (предел третьего начала)', () => {
    expect(validateThermalScientificValue(knownTemp(0))).toEqual([]);
  });

  it('масса в килограммах отклоняется как температура', () => {
    const issues = validateThermalScientificValue(knownValue(quantity(5, 'kg')), 'тест');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).toContain('K');
  });

  it('неизвестная единица отклоняется с указанием полученной единицы', () => {
    const raw = { status: 'known', quantity: { value: 300, unit: 'furlong' } };
    const issues = validateThermalScientificValue(raw, 'тест');
    expect(issues.join(' ')).toContain('furlong');
  });

  it('отрицательная температура отклоняется', () => {
    const issues = validateThermalScientificValue(knownTemp(-40), 'тест');
    expect(issues.join(' ')).toContain('отрицательная');
  });

  it('NaN и Infinity отклоняются', () => {
    const nanValue = { status: 'known', quantity: { value: Number.NaN, unit: 'K' } };
    expect(validateThermalScientificValue(nanValue, 'тест').length).toBeGreaterThan(0);
    const infValue = { status: 'known', quantity: { value: Infinity, unit: 'K' } };
    expect(validateThermalScientificValue(infValue, 'тест').length).toBeGreaterThan(0);
  });

  it('не-объект отклоняется', () => {
    expect(validateThermalScientificValue(null, 'тест').length).toBeGreaterThan(0);
    expect(validateThermalScientificValue(42, 'тест').length).toBeGreaterThan(0);
  });

  it('unknown без числа валиден, с quantity — ошибка противоречия', () => {
    expect(validateThermalScientificValue(unknownValue('нет данных'))).toEqual([]);
    const contradictory = { status: 'unknown' as const, quantity: pv(300) };
    const issues = validateThermalScientificValue(contradictory, 'тест');
    expect(issues.join(' ')).toContain('противоречат');
  });

  it('not_applicable и not_implemented без числа валидны', () => {
    expect(validateThermalScientificValue(notApplicable('планета — получатель'))).toEqual([]);
    expect(validateThermalScientificValue(notImplemented('RCM не реализована'))).toEqual([]);
  });

  it('estimated без метода отклоняется (оценка безследна)', () => {
    const broken = { status: 'estimated' as const, quantity: pv(300) };
    expect(validateThermalScientificValue(broken, 'тест').join(' ')).toContain('method');
  });

  it('invalid не порождает термодинамических ошибок — только форма', () => {
    // Отклонённые данные с корректной формой остаются diagnostic-only.
    expect(validateThermalScientificValue(invalidValue('отклонено внешним контролем', pv(300)))).toEqual([]);
    expect(validateThermalScientificValue(invalidValue('', pv(300)), 'тест').length).toBeGreaterThan(0);
  });

  it('hasUsableTemperature: только known/estimated в K, конечные, неотрицательные', () => {
    expect(hasUsableTemperature(knownTemp(300))).toBe(true);
    expect(hasUsableTemperature(estimatedValue(pv(95), 'пресет'))).toBe(true);
    expect(hasUsableTemperature(unknownValue())).toBe(false);
    expect(hasUsableTemperature(notApplicable('причина'))).toBe(false);
    expect(hasUsableTemperature(invalidValue('отклонено', pv(300)))).toBe(false);
    expect(hasUsableTemperature(null)).toBe(false);
    expect(hasUsableTemperature(undefined)).toBe(false);
    expect(hasUsableTemperature(knownValue(quantity(5, 'kg')))).toBe(false);
  });

  it('hasUsableTemperature: estimated без method НЕ пригоден (4.2.2.1 — строгая форма)', () => {
    // Оценка без следа метода — не температура: как и неизвестность,
    // она не превращается в число. Форма проверяется так же строго,
    // как единица и размерность.
    const brokenEstimated = { status: 'estimated' as const, quantity: pv(300) } as unknown as ScientificValue;
    expect(hasUsableTemperature(brokenEstimated)).toBe(false);
    expect(temperatureValueOrNull(brokenEstimated)).toBeNull();
  });

  it('hasUsableTemperature: известные числовые пороки не проходят', () => {
    // Неизвестная единица
    const unknownUnit = { status: 'known' as const, quantity: { value: 300, unit: 'furlong' } };
    expect(hasUsableTemperature(unknownUnit)).toBe(false);
    expect(temperatureValueOrNull(unknownUnit)).toBeNull();
    // NaN и Infinity
    const nanValue = { status: 'known' as const, quantity: { value: Number.NaN, unit: 'K' } };
    expect(hasUsableTemperature(nanValue)).toBe(false);
    const infValue = { status: 'known' as const, quantity: { value: Infinity, unit: 'K' } };
    expect(hasUsableTemperature(infValue)).toBe(false);
    // Отрицательная
    expect(hasUsableTemperature(knownTemp(-1))).toBe(false);
    // known без quantity — форма испорчена
    const noQuantity = { status: 'known' as const } as unknown as ScientificValue;
    expect(hasUsableTemperature(noQuantity)).toBe(false);
  });

  it('hasUsableTemperature/temperatureValueOrNull: статусы без числа не превращаются в число', () => {
    // unknown/not_applicable/not_implemented/invalid никогда не
    // становятся числом — даже если несут quantity в нарушение формы.
    expect(hasUsableTemperature(notImplemented('RCM не реализована'))).toBe(false);
    const contradictory = { status: 'unknown' as const, quantity: pv(300) };
    expect(hasUsableTemperature(contradictory)).toBe(false);
    expect(temperatureValueOrNull(contradictory)).toBeNull();
  });

  it('temperatureValueOrNull возвращает число или null', () => {
    expect(temperatureValueOrNull(knownTemp(277.15))).toBe(277.15);
    expect(temperatureValueOrNull(unknownValue())).toBeNull();
    expect(temperatureValueOrNull(notApplicable('причина'))).toBeNull();
  });
});

// ============================================
// 2. ПРОФИЛЬ ТЕМПЕРАТУР АТМОСФЕРЫ
// ============================================

describe('Stage 4.2.2: профиль температур атмосферы', () => {
  it('single_layer_estimate: один слой + обязательный limitations', () => {
    const profile: AtmosphericTemperatureProfile = {
      status: 'single_layer_estimate',
      layers: [{ layerId: 'surface_boundary', temperature: knownTemp(95) }],
      limitations: 'одиночная оценка — не профиль'
    };
    expect(validateAtmosphericTemperatureProfile(profile)).toEqual([]);
  });

  it('single_layer_estimate без limitations отклоняется', () => {
    const profile: AtmosphericTemperatureProfile = {
      status: 'single_layer_estimate',
      layers: [{ layerId: 'surface_boundary', temperature: knownTemp(95) }]
    };
    const issues = validateAtmosphericTemperatureProfile(profile, 'тест');
    expect(issues.join(' ')).toContain('limitations');
  });

  it('unknown со слоем отклоняется: неизвестность не изображается данными', () => {
    const issues = validateAtmosphericTemperatureProfile(
      { status: 'unknown', layers: [{ layerId: 'x', temperature: knownTemp(1) }] },
      'тест'
    );
    expect(issues.join(' ')).toContain('unknown');
  });

  it('partial_profile требует не менее одного слоя', () => {
    expect(
      validateAtmosphericTemperatureProfile({ status: 'partial_profile', layers: [{ layerId: 'a', temperature: knownTemp(1) }] })
    ).toEqual([]);
    expect(
      validateAtmosphericTemperatureProfile({ status: 'complete_profile', layers: [] }, 'тест').join(' ')
    ).toContain('complete_profile');
  });

  it('дублирующийся layerId отклоняется', () => {
    const layers: AtmosphereTemperatureLayer[] = [
      { layerId: 'same', temperature: knownTemp(1) },
      { layerId: 'same', temperature: knownTemp(2) }
    ];
    const issues = validateAtmosphericTemperatureProfile(
      { status: 'partial_profile', layers },
      'тест'
    );
    expect(issues.join(' ')).toContain('same');
  });

  it('пустой layerId отклоняется', () => {
    const issues = validateAtmosphericTemperatureProfile(
      { status: 'partial_profile', layers: [{ layerId: '  ', temperature: knownTemp(1) }] },
      'тест'
    );
    expect(issues.join(' ')).toContain('layerId');
  });

  it('слой с температурой не в K отклоняется', () => {
    const issues = validateAtmosphericTemperatureProfile(
      {
        status: 'partial_profile',
        layers: [{ layerId: 'weird', temperature: knownValue(quantity(5, 'kg')) }]
      },
      'тест'
    );
    expect(issues.join(' ')).toContain('weird');
  });

  it('altitudeRangeM: корректный диапазон проходит, инвертированный отклоняется', () => {
    expect(
      validateAtmosphericTemperatureProfile({
        status: 'partial_profile',
        layers: [{ layerId: 'a', temperature: knownTemp(1), altitudeRangeM: { min: 0, max: 1000 } }]
      })
    ).toEqual([]);
    expect(
      validateAtmosphericTemperatureProfile({
        status: 'partial_profile',
        layers: [{ layerId: 'b', temperature: knownTemp(1), altitudeRangeM: { min: 1000, max: 100 } }]
      }, 'тест').join(' ')
    ).toContain('max < min');
    // max = null допустим: верхняя граница неизвестна
    expect(
      validateAtmosphericTemperatureProfile({
        status: 'partial_profile',
        layers: [{ layerId: 'c', temperature: knownTemp(1), altitudeRangeM: { min: 0, max: null } }]
      })
    ).toEqual([]);
  });
});

// ============================================
// 3. ИНТЕГРАЦИЯ С СОСТОЯНИЕМ МИРА
// ============================================

describe('Stage 4.2.2: CoreWorldState 1.2.0 и валидация', () => {
  it('версия схемы 1.2.0 с тепловым состоянием валидна', () => {
    expect(CORE_WORLD_STATE_SCHEMA_VERSION).toBe('1.2.0');
    const state = thermalWorld();
    expect(validateWorldState(state)).toEqual([]);
  });

  it('схема 1.1.0 остаётся поддерживаемой', () => {
    const state = thermalWorld();
    const old = JSON.parse(JSON.stringify(state)) as CoreWorldState;
    old.schemaVersion = '1.1.0';
    expect(validateWorldState(old).some((i) => i.code === 'version_mismatch')).toBe(false);
  });

  it('некорректное тепловое состояние даёт invalid_thermal_state', () => {
    const state = thermalWorld();
    state.bodies[0].thermalState = {
      ...planetThermalState(),
      surfaceTemperature: knownValue(quantity(300, 'kg'))
    };
    const issues = validateWorldState(state);
    const thermal = issues.find((i) => i.code === 'invalid_thermal_state');
    expect(thermal).toBeDefined();
    expect(thermal?.component).toBe('WorldBody');
    expect(thermal?.refs).toContain('planet');
    expect(thermal?.message).toContain('surfaceTemperature');
  });

  it('reservoirTemperature не в K даёт invalid_reservoir', () => {
    const state = thermalWorld();
    state.reservoirs[0].reservoirTemperature = knownValue(quantity(277, 'kg'));
    const issues = validateWorldState(state);
    const reservoirIssue = issues.find((i) => i.code === 'invalid_reservoir');
    expect(reservoirIssue).toBeDefined();
    expect(reservoirIssue?.message).toContain('reservoirTemperature');
  });

  it('отсутствие thermalState у тела — не ошибка (подсистема не инициализирована)', () => {
    const state = thermalWorld();
    state.bodies[0].thermalState = undefined;
    expect(validateWorldState(state).some((i) => i.code === 'invalid_thermal_state')).toBe(false);
  });

  it('миграция сохранения 1.2 → 1.3 НЕ создаёт thermalState', () => {
    const core = createCoreWorldState('w-mig');
    core.bodies.push({ id: 'planet', kind: 'planet', properties: {} });
    const saved = {
      id: 'w-mig',
      savedAt: '2026-10-30T00:00:00.000Z',
      version: '1.2',
      coreWorldState: core
    };
    const result = migrateSavedWorld(saved as never, '1.3');
    const world = result.world as unknown as typeof saved;
    expect(world.coreWorldState.bodies[0].thermalState).toBeUndefined();
  });

  it('миграция сохраняет легаси surfaceTemperature без выдуманного provenance (4.2.2.2)', () => {
    // Старое сохранение этапа 3: скаляр surfaceTemperature мог быть
    // скопирован из температуры пресета атмосферы — происхождение
    // неизвестно. Миграция обязана сохранить исходное число и НЕ
    // выдумать источник, метод или статус.
    const core = createCoreWorldState('w-mig-legacy');
    core.bodies.push({ id: 'planet', kind: 'planet', properties: {} });
    const saved = {
      id: 'w-mig-legacy',
      savedAt: '2026-10-30T00:00:00.000Z',
      version: '1.2',
      coreWorldState: core,
      physicalCharacteristics: {
        surfaceTemperature: 288,
        atmosphericPressure: 1,
        geologicalActivity: 'Высокая геологическая активность'
      }
    };
    const result = migrateSavedWorld(saved as never, '1.3');
    const world = result.world as unknown as typeof saved;
    // Исходное число сохранено без потерь
    expect(world.physicalCharacteristics.surfaceTemperature).toBe(288);
    // Миграция НЕ создаёт thermalState и НЕ выдумывает provenance:
    // легаси-число не становится известным измерением при загрузке
    expect(world.coreWorldState.bodies[0].thermalState).toBeUndefined();
  });

  it('validateBodyThermalState агрегирует ошибки по полям', () => {
    const issues = validateBodyThermalState(
      {
        effectiveTemperature: knownValue(quantity(5772, 'kg')),
        equilibriumTemperature: knownTemp(255),
        surfaceTemperature: knownTemp(-5),
        atmosphericTemperatureProfile: { status: 'unknown', layers: [{ layerId: 'x', temperature: knownTemp(1) }] }
      },
      'тест'
    );
    const joined = issues.join(' ');
    expect(joined).toContain('effectiveTemperature');
    expect(joined).toContain('surfaceTemperature');
    expect(joined).toContain('atmosphericTemperatureProfile');
  });
});

// ============================================
// 4. АДАПТЕРЫ ЛЕГАСИ-ПРЕСЕТОВ
// ============================================

describe('Stage 4.2.2: адаптеры пресетных температур', () => {
  it('historical_game 95 K → estimated с пометкой игрового допущения', () => {
    const value = atmospherePresetTemperatureToScientificValue({
      temperature: 95,
      presetKind: 'historical_game'
    });
    expect(value.status).toBe('estimated');
    if (value.status === 'estimated') {
      expect(value.method).toContain('game_assumption');
      expect(value.provenance?.note).toContain('НЕ является научным измерением');
      expect(value.provenance?.rawInput).toEqual({ presetTemperatureK: 95, presetKind: 'historical_game' });
    }
  });

  it('observational_reference 94 K → estimated со справочной пометкой (пояснение НЕ источник)', () => {
    const value = atmospherePresetTemperatureToScientificValue({
      temperature: 94,
      presetKind: 'observational_reference',
      presetNotes: 'Наблюдательный справочный сценарий: значения соответствуют современной атмосфере Титана.'
    });
    expect(value.status).toBe('estimated');
    if (value.status === 'estimated') {
      expect(value.method).toContain('observational_reference');
      expect(value.provenance?.note).toContain('НЕ измерение');
      // Stage 4.2.2.2: пояснительный текст пресета живёт в note,
      // sourceName НЕ выдумывается из пояснения
      expect(value.provenance?.sourceName).toBeUndefined();
      expect(value.provenance?.note).toContain('пояснение пресета');
      expect(value.provenance?.note).toContain('Титана');
    }
  });

  it('presetSourceName переносится в sourceName, только когда реальный источник известен (4.2.2.2)', () => {
    const value = atmospherePresetTemperatureToScientificValue({
      temperature: 94,
      presetKind: 'observational_reference',
      presetNotes: 'справочный сценарий Титана',
      presetSourceName: 'фикстура: справочный профиль атмосферы Титана'
    });
    expect(value.status).toBe('estimated');
    if (value.status === 'estimated') {
      // Настоящее отдельное поле источника переносится в sourceName
      expect(value.provenance?.sourceName).toBe('фикстура: справочный профиль атмосферы Титана');
      // Пояснение пресета при этом остаётся пояснением в note
      expect(value.provenance?.note).toContain('пояснение пресета');
      expect(value.provenance?.note).toContain('справочный сценарий Титана');
    }
    // Без presetSourceName источник не выдумывается ни для какого вида пресета
    const noSource = atmospherePresetTemperatureToScientificValue({
      temperature: 94,
      presetKind: 'observational_reference',
      presetNotes: 'пояснение без источника'
    });
    if (noSource.status === 'estimated') {
      expect(noSource.provenance?.sourceName).toBeUndefined();
    }
  });

  it('provenance не теряется в AtmosphericTemperatureProfile (4.2.2.2)', () => {
    const profile = atmosphericProfileFromPreset({
      temperature: 94,
      presetKind: 'observational_reference',
      presetNotes: 'справочный сценарий',
      presetSourceName: 'фикстура справочника'
    });
    expect(profile).not.toBeNull();
    expect(profile?.layers[0]?.layerId).toBe('surface_boundary');
    // sourceName и note переносятся в профиль слоя без потерь
    expect(profile?.provenance?.sourceName).toBe('фикстура справочника');
    expect(profile?.provenance?.note).toContain('пояснение пресета');
    expect(profile?.provenance?.note).toContain('справочный сценарий');
    if (profile && profile.layers[0] && profile.layers[0].temperature.status === 'estimated') {
      expect(profile.layers[0].temperature.provenance?.sourceName).toBe('фикстура справочника');
      expect(profile.layers[0].temperature.provenance?.note).toContain('справочный сценарий');
    }
  });

  it('hypothetical → estimated с пометкой гипотетичности', () => {
    const value = atmospherePresetTemperatureToScientificValue({
      temperature: 350,
      presetKind: 'hypothetical'
    });
    expect(value.status).toBe('estimated');
    if (value.status === 'estimated') {
      expect(value.provenance?.note).toContain('гипотет');
    }
  });

  it('без presetKind → estimated пользовательской конфигурации', () => {
    const value = atmospherePresetTemperatureToScientificValue({ temperature: 300 });
    expect(value.status).toBe('estimated');
    if (value.status === 'estimated') {
      expect(value.method).toContain('пользовательск');
    }
  });

  it('null → unknown; NaN и отрицательные → invalid', () => {
    expect(atmospherePresetTemperatureToScientificValue(null).status).toBe('unknown');
    expect(atmospherePresetTemperatureToScientificValue({ temperature: null }).status).toBe('unknown');
    expect(atmospherePresetTemperatureToScientificValue({ temperature: Number.NaN }).status).toBe('invalid');
    expect(atmospherePresetTemperatureToScientificValue({ temperature: -10 }).status).toBe('invalid');
  });

  it('отсутствующая атмосфера → unknown', () => {
    expect(atmospherePresetTemperatureToScientificValue(undefined).status).toBe('unknown');
  });

  it('профиль из пресета: single_layer_estimate с limitations', () => {
    const profile = atmosphericProfileFromPreset({ temperature: 95, presetKind: 'historical_game' });
    expect(profile).not.toBeNull();
    expect(profile?.status).toBe('single_layer_estimate');
    expect(profile?.layers).toHaveLength(1);
    expect(profile?.layers[0]?.layerId).toBe('surface_boundary');
    expect(profile?.limitations).toContain('НЕ расчётный вертикальный профиль');
    expect(validateAtmosphericTemperatureProfile(profile as AtmosphericTemperatureProfile)).toEqual([]);
  });

  it('профиль не создаётся из непригодной температуры', () => {
    expect(atmosphericProfileFromPreset(null)).toBeNull();
    expect(atmosphericProfileFromPreset({ temperature: Number.NaN })).toBeNull();
  });

  it('planetThermalStateFromLegacy: T_eq отдельно, поверхность unknown, effective не применима', () => {
    const thermal = planetThermalStateFromLegacy(legacyInput());
    expect(temperatureValueOrNull(thermal.equilibriumTemperature)).toBe(255);
    expect(thermal.equilibriumTemperature.status).toBe('known');
    expect(thermal.surfaceTemperature.status).toBe('unknown');
    if (thermal.surfaceTemperature.status === 'unknown') {
      expect(thermal.surfaceTemperature.note).toContain('RCM');
    }
    expect(thermal.effectiveTemperature.status).toBe('not_applicable');
    expect(thermal.atmosphericTemperatureProfile.status).toBe('single_layer_estimate');
  });

  it('planetThermalStateFromLegacy без бюджета: T_eq unknown', () => {
    const thermal = planetThermalStateFromLegacy(legacyInput({ energyBudget: null }));
    expect(thermal.equilibriumTemperature.status).toBe('unknown');
  });

  it('T_eq из реального EnergyBalance (confidence estimated) НЕ повышается до known (4.2.2.1)', () => {
    // Реальный computeEnergyBudget даёт equilibriumTemperature с
    // confidence 'estimated': светимость класса репрезентативна,
    // а не измерена — T_eq остаётся ОЦЕНКОЙ и после адаптации.
    const thermal = planetThermalStateFromLegacy(
      legacyInput({
        energyBudget: {
          incidentFlux: phys(1361, 'Вт/м²'),
          equilibriumTemperature: {
            value: 255,
            unit: 'K',
            confidence: 'estimated',
            method: 'T_eq = [F(1-A)·f / (4εσ)]^(1/4) при A=0.3, f=1, ε=1',
            note: 'репрезентативная светимость класса — оценочная T_eq'
          }
        }
      })
    );
    expect(thermal.equilibriumTemperature.status).toBe('estimated');
    expect(temperatureValueOrNull(thermal.equilibriumTemperature)).toBe(255);
    if (thermal.equilibriumTemperature.status === 'estimated') {
      expect(thermal.equilibriumTemperature.method).toContain('T_eq');
      expect(thermal.equilibriumTemperature.provenance?.method).toContain('T_eq');
    }
  });

  it('T_eq из РЕАЛЬНОГО computeEnergyBudget: статус, метод и provenance сохранены, surfaceTemperature не заполняется (4.2.2.2)', () => {
    // Настоящий integration-контур: валидный вход → реальная функция
    // EnergyBalance → её equilibriumTemperature → адаптер планеты.
    // Формула T_eq не меняется; estimated НЕ повышается до known.
    const orbit: OrbitalConfigurationData = {
      frame: 'around_star',
      orbitalBasis: 'фикстура: звезда класса жёлтый карлик',
      semiMajorAxis: phys(1.496e11, 'м'),
      eccentricity: phys(0.0167, ''),
      orbitalPeriod: phys(3.156e7, 'с'),
      inclination: phys(null, 'рад'),
      tidalLocking: { value: 'unknown', unit: '', confidence: 'unknown', note: 'фикстура' },
      stabilityCheck: 'not_performed',
      stabilityNote: 'фикстура: устойчивость не проверялась',
      radiativeConditions: 'фикстура',
      notes: ['фикстура орбиты для интеграционного теста EnergyBalance']
    };
    const budget = computeEnergyBudget({ centralObjectId: 'yellow_dwarf', orbit });

    // Реальная функция дала числовую равновесную температуру
    expect(budget.equilibriumTemperature.value).not.toBeNull();
    expect(budget.equilibriumTemperature.confidence).toBe('estimated');

    const thermal = planetThermalStateFromLegacy(legacyInput({ energyBudget: budget }));
    // Фактический статус сохранён: оценка остаётся оценкой
    expect(thermal.equilibriumTemperature.status).toBe('estimated');
    expect(temperatureValueOrNull(thermal.equilibriumTemperature)).toBe(
      budget.equilibriumTemperature.value
    );
    if (thermal.equilibriumTemperature.status === 'estimated') {
      // Метод (формула T_eq) сохранён
      expect(thermal.equilibriumTemperature.method).toContain('T_eq = [F(1-A)·f / (4εσ)]^(1/4)');
      expect(thermal.equilibriumTemperature.provenance?.method).toContain('T_eq = [F(1-A)·f / (4εσ)]^(1/4)');
      // Характер неопределённости и параметры расчёта не потерялись
      expect(thermal.equilibriumTemperature.provenance?.note).toContain('характер неопределённости');
      expect(thermal.equilibriumTemperature.provenance?.rawInput).toMatchObject({
        'A (альбедо Бонда)': 0.3,
        f: 1,
        ε: 1
      });
    }
    // surfaceTemperature НЕ заполняется T_eq: RCM не реализована
    expect(thermal.surfaceTemperature.status).toBe('unknown');
    expect(temperatureValueOrNull(thermal.surfaceTemperature)).toBeNull();
  });

  it('centralThermalStateFromLegacy: null без centralObjectSystem', () => {
    expect(centralThermalStateFromLegacy(legacyInput({ centralObjectSystem: null }))).toBeNull();
    expect(centralThermalStateFromLegacy(legacyInput({ centralObjectSystem: undefined }))).toBeNull();
  });

  it('centralThermalStateFromLegacy: звезда с teff → known, без teff → unknown без подстановки', () => {
    const withTeff = centralThermalStateFromLegacy(legacyInput());
    expect(withTeff).not.toBeNull();
    expect(temperatureValueOrNull(withTeff?.effectiveTemperature as ScientificValue)).toBe(5772);
    const withoutTeff = centralThermalStateFromLegacy(
      legacyInput({ centralObjectSystem: { kind: 'star', effectiveTemperatureK: null } })
    );
    expect(withoutTeff?.effectiveTemperature.status).toBe('unknown');
    if (withoutTeff && withoutTeff.effectiveTemperature.status === 'unknown') {
      expect(withoutTeff.effectiveTemperature.note).toContain('НЕ подставляется');
    }
  });

  it('диапазон класса при teff=null сохраняется в provenance и НЕ схлопывается в среднее (4.2.2.1)', () => {
    // Известен только диапазон значений класса: среднее НЕ подставляется
    // как конкретная эффективная температура; границы и происхождение
    // сохраняются в допустимом provenance.
    const withRange = centralThermalStateFromLegacy(
      legacyInput({
        centralObjectSystem: {
          kind: 'star',
          effectiveTemperatureK: {
            value: null,
            unit: 'K',
            confidence: 'unknown',
            range: { min: 2500, max: 4000 },
            source: 'справочник фикстуры'
          }
        }
      })
    );
    expect(withRange?.effectiveTemperature.status).toBe('unknown');
    if (withRange && withRange.effectiveTemperature.status === 'unknown') {
      expect(withRange.effectiveTemperature.provenance?.note).toContain('2500');
      expect(withRange.effectiveTemperature.provenance?.note).toContain('4000');
      expect(withRange.effectiveTemperature.provenance?.note).toContain('НЕ подставляется');
    }
    expect(temperatureValueOrNull(withRange?.effectiveTemperature as ScientificValue)).toBeNull();
    if (withRange && withRange.effectiveTemperature.status === 'unknown') {
      expect(withRange.effectiveTemperature.provenance?.rawInput).toEqual({
        rangeMinK: 2500,
        rangeMaxK: 4000
      });
      expect(withRange.effectiveTemperature.provenance?.sourceName).toBe('справочник фикстуры');
    }
    // Фиктивного числа из середины диапазона (3250) не появилось
    expect(temperatureValueOrNull(withRange?.effectiveTemperature as ScientificValue)).not.toBe(3250);
  });

  it('centralThermalStateFromLegacy: substellar обрабатывается как источник', () => {
    const substellar = centralThermalStateFromLegacy(
      legacyInput({ centralObjectSystem: { kind: 'substellar', effectiveTemperatureK: phys(1500, 'K') } })
    );
    expect(temperatureValueOrNull(substellar?.effectiveTemperature as ScientificValue)).toBe(1500);
  });

  it('centralThermalStateFromLegacy: jet_system → все величины not_applicable', () => {
    const jet = centralThermalStateFromLegacy(
      legacyInput({ centralObjectSystem: { kind: 'jet_system', effectiveTemperatureK: null } })
    );
    expect(jet?.effectiveTemperature.status).toBe('not_applicable');
    expect(jet?.equilibriumTemperature.status).toBe('not_applicable');
    expect(jet?.surfaceTemperature.status).toBe('not_applicable');
  });

  it('centralThermalStateFromLegacy: компактный остаток → честный unknown', () => {
    const remnant = centralThermalStateFromLegacy(
      legacyInput({ centralObjectSystem: { kind: 'compact_remnant', effectiveTemperatureK: null } })
    );
    expect(remnant?.effectiveTemperature.status).toBe('unknown');
    expect(remnant?.surfaceTemperature.status).toBe('unknown');
  });

  it('coreWorldStateFromLegacyWorld: тепловые состояния привязаны к правильным телам', () => {
    const state = coreWorldStateFromLegacyWorld(legacyInput());
    const central = state.bodies.find((b) => b.id === 'central');
    const planet = state.bodies.find((b) => b.id === 'planet');
    expect(central?.thermalState).toBeDefined();
    expect(planet?.thermalState).toBeDefined();
    // Эффективная температура ЗВЕЗДЫ не переносится на планету:
    expect(temperatureValueOrNull(central?.thermalState?.effectiveTemperature)).toBe(5772);
    expect(planet?.thermalState?.effectiveTemperature.status).toBe('not_applicable');
    expect(planet?.thermalState?.surfaceTemperature.status).toBe('unknown');
    expect(validateWorldState(state)).toEqual([]);
  });

  it('coreWorldStateFromLegacyWorld без centralObjectSystem: центрального тела нет', () => {
    const state = coreWorldStateFromLegacyWorld(legacyInput({ centralObjectSystem: null }));
    expect(state.bodies.some((b) => b.id === 'central')).toBe(false);
    expect(validateWorldState(state)).toEqual([]);
  });

  it('provenance и uncertainty не теряются при адаптации', () => {
    const value = atmospherePresetTemperatureToScientificValue({
      temperature: 95,
      presetKind: 'historical_game',
      presetNotes: 'историческая миссия'
    });
    if (value.status === 'estimated') {
      expect(value.provenance?.rawInput).toEqual({ presetTemperatureK: 95, presetKind: 'historical_game' });
      // Stage 4.2.2.1: пояснение пресета живёт в note, а НЕ в
      // sourceName: игровое допущение не изображается источником
      // наблюдательного измерения.
      expect(value.provenance?.sourceName).toBeUndefined();
      expect(value.provenance?.note).toContain('пояснение пресета');
      expect(value.provenance?.note).toContain('историческая миссия');
      const state = coreWorldStateFromLegacyWorld(
        legacyInput({ atmosphere: { temperature: 95, presetKind: 'historical_game', presetNotes: 'историческая миссия' } })
      );
      const planet = state.bodies.find((b) => b.id === 'planet');
      const layer = planet?.thermalState?.atmosphericTemperatureProfile.layers[0];
      expect(layer?.temperature.status).toBe('estimated');
      if (layer && layer.temperature.status === 'estimated') {
        expect(layer.temperature.provenance?.rawInput?.presetKind).toBe('historical_game');
        // note перенесён и в профиль слоя (не теряется на пути)
        expect(layer.temperature.provenance?.note).toContain('историческая миссия');
        expect(layer.temperature.provenance?.sourceName).toBeUndefined();
      }
    }
  });
});

// ============================================
// 5. RESOLVER ЛОКАЛЬНОЙ ТЕМПЕРАТУРЫ
// ============================================

describe('Stage 4.2.2: resolver локальной температуры', () => {
  it('резервуар с известной температурой: значение + provenance + source', () => {
    const state = thermalWorld();
    const r = resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'ocean-1' });
    expect(resolutionK(r)).toBe(277.15);
    expect(r.source).toBe('reservoir_temperature');
    expect(r.placeKind).toBe('reservoir');
    expect(r.placeId).toBe('ocean-1');
    expect(r.provenance?.sourceName).toBe('гидросфера фикстуры');
  });

  it('слой атмосферы читается через профиль тела', () => {
    const state = thermalWorld();
    const r = resolveLocalReactionTemperature(state, { bodyId: 'planet', layerId: 'cloud-deck' });
    expect(resolutionK(r)).toBe(110);
    expect(r.source).toBe('atmosphere_layer_temperature');
    expect(r.placeKind).toBe('atmosphere_layer');
    expect(r.placeId).toBe('cloud-deck');
  });

  it('резервуар без температуры остаётся unknown — без fallback', () => {
    const state = thermalWorld();
    const r = resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'atmosphere-1' });
    expect(r.temperature.status).toBe('unknown');
    expect(r.source).toBe('none');
    expect(resolutionK(r)).toBeNull();
  });

  it('T_eq НЕ подставляется как локальная температура', () => {
    const state = thermalWorld();
    // У планеты известны и T_eq (255 K), и поверхность (288 K),
    // и слой (110 K) — но резервуар без температуры не получает их.
    const r = resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'atmosphere-1' });
    expect(resolutionK(r)).not.toBe(255);
    expect(resolutionK(r)).not.toBe(288);
    expect(resolutionK(r)).not.toBe(110);
  });

  it('surfaceTemperature НЕ подставляется как локальная температура', () => {
    const state = thermalWorld();
    state.reservoirs[1].reservoirTemperature = undefined;
    const r = resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'atmosphere-1' });
    expect(resolutionK(r)).toBeNull();
  });

  it('отсутствующий слой/профиль → unknown с причиной', () => {
    const state = thermalWorld();
    const missingLayer = resolveLocalReactionTemperature(state, { bodyId: 'planet', layerId: 'tropopause' });
    expect(missingLayer.temperature.status).toBe('unknown');
    expect(missingLayer.source).toBe('none');
    // У спутника профиль unknown: слоёв нет.
    const moonLayer = resolveLocalReactionTemperature(state, { bodyId: 'moon', layerId: 'exosphere' });
    expect(moonLayer.temperature.status).toBe('unknown');
  });

  it('резервуар другого тела не подставляется', () => {
    const state = thermalWorld();
    // ocean-1 принадлежит планете; у спутника его нет.
    const r = resolveLocalReactionTemperature(state, { bodyId: 'moon', reservoirId: 'ocean-1' });
    expect(r.temperature.status).toBe('unknown');
    expect(resolutionK(r)).toBeNull();
  });

  it('резервуар спутника читается только со спутника', () => {
    const state = thermalWorld();
    const ok = resolveLocalReactionTemperature(state, { bodyId: 'moon', reservoirId: 'moon-ice-1' });
    expect(resolutionK(ok)).toBe(110);
    const wrong = resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'moon-ice-1' });
    expect(wrong.temperature.status).toBe('unknown');
  });

  it('несуществующее тело → unknown, не throw', () => {
    const state = thermalWorld();
    const r = resolveLocalReactionTemperature(state, { bodyId: 'decommissioned', reservoirId: 'ocean-1' });
    expect(r.temperature.status).toBe('unknown');
  });

  it('invalid температура резервуара не используется', () => {
    const state = thermalWorld();
    state.reservoirs[0].reservoirTemperature = invalidValue('отклонено контролем', pv(9999));
    const r = resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'ocean-1' });
    expect(r.temperature.status).toBe('unknown');
    expect(resolutionK(r)).toBeNull();
  });

  it('заявленный unknown остаётся unknown (заявленная неизвестность — данные)', () => {
    const state = thermalWorld();
    const r = resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'deep-basin-1' });
    expect(r.temperature.status).toBe('unknown');
    if (r.temperature.status === 'unknown') {
      expect(r.temperature.note).toContain('глубинный бассейн');
      expect(r.provenance?.sourceName).toBe('фикстура теста');
    }
    expect(r.source).toBe('reservoir_temperature');
  });

  it('некорректное место процесса — throw invalid_place (3 варианта)', () => {
    const state = thermalWorld();
    expect(() =>
      resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'ocean-1', layerId: 'cloud-deck' })
    ).toThrowError(ThermalStateError);
    expect(() => resolveLocalReactionTemperature(state, { bodyId: 'planet' })).toThrowError(ThermalStateError);
    expect(() => resolveLocalReactionTemperature(state, { bodyId: '', reservoirId: 'ocean-1' })).toThrowError(
      ThermalStateError
    );
    let thrown: unknown = null;
    try {
      resolveLocalReactionTemperature(state, { bodyId: 'planet' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ThermalStateError);
    expect((thrown as ThermalStateError).code).toBe('invalid_place');
  });

  it('пустые/пробельные идентификаторы области отклоняются (4.2.2.1)', () => {
    const state = thermalWorld();
    // Пустая строка — не идентификатор области
    expect(() =>
      resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: '' })
    ).toThrowError(ThermalStateError);
    expect(() =>
      resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: '   ' })
    ).toThrowError(ThermalStateError);
    expect(() =>
      resolveLocalReactionTemperature(state, { bodyId: 'planet', layerId: '' })
    ).toThrowError(ThermalStateError);
    expect(() =>
      resolveLocalReactionTemperature(state, { bodyId: 'planet', layerId: ' ' })
    ).toThrowError(ThermalStateError);
    let thrown: unknown = null;
    try {
      resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: '' });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ThermalStateError);
    expect((thrown as ThermalStateError).code).toBe('invalid_place');
  });

  it('orphan-резервуар (без существующего тела) не является областью мира (4.2.2.1)', () => {
    const state = thermalWorld();
    // Резервуар ссылается на тело 'ghost', которого нет в bodies:
    // сам резервуар не делает это место областью существующего мира.
    state.reservoirs.push({
      ...createReservoir('orphan-res', 'ocean', { bodyId: 'ghost' }),
      reservoirTemperature: knownTemp(300, 'фикстура orphan')
    });
    const r = resolveLocalReactionTemperature(state, { bodyId: 'ghost', reservoirId: 'orphan-res' });
    expect(r.temperature.status).toBe('unknown');
    expect(resolutionK(r)).toBeNull();
    if (r.temperature.status === 'unknown') {
      expect(r.temperature.note).toContain('не найдено');
      expect(r.temperature.note).toContain('orphan');
    }
    expect(r.source).toBe('none');
  });

  it('слой из профиля со статусом unknown не читается (4.2.2.1)', () => {
    const state = thermalWorld();
    // Профиль спутника ЗАЯВЛЕН неизвестным: даже если в слоях
    // что-то оказалось, заявленная неизвестность не изображается
    // данными — слои не читаются.
    const moon = state.bodies.find((b) => b.id === 'moon');
    if (moon && moon.thermalState) {
      moon.thermalState.atmosphericTemperatureProfile = {
        status: 'unknown',
        layers: [{ layerId: 'sneaky-layer', temperature: knownTemp(500, 'фикстура') }]
      };
    }
    const r = resolveLocalReactionTemperature(state, { bodyId: 'moon', layerId: 'sneaky-layer' });
    expect(r.temperature.status).toBe('unknown');
    expect(resolutionK(r)).toBeNull();
    if (r.temperature.status === 'unknown') {
      expect(r.temperature.note).toContain('unknown');
      expect(r.temperature.note).toContain('не читаются');
    }
    // Число 500 из незаявленного слоя НЕ подставлено
    expect(resolutionK(r)).not.toBe(500);
  });

  it('resolver чист: состояние мира не изменяется (JSON-снимок)', () => {
    const state = thermalWorld();
    const before = JSON.stringify(state);
    resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'ocean-1' });
    resolveLocalReactionTemperature(state, { bodyId: 'planet', layerId: 'cloud-deck' });
    resolveLocalReactionTemperature(state, { bodyId: 'moon', reservoirId: 'moon-ice-1' });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('детерминизм: повторные вызовы дают идентичный результат', () => {
    const state = thermalWorld();
    const first = resolveLocalReactionTemperature(state, { bodyId: 'planet', reservoirId: 'ocean-1' });
    const second = resolveLocalReactionTemperature(thermalWorld(), { bodyId: 'planet', reservoirId: 'ocean-1' });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

// ============================================
// 6. ДИАГНОСТИКА «ПРЕСЕТ vs T_eq»
// ============================================

describe('Stage 4.2.2: диагностика расхождения пресета и T_eq', () => {
  const preset95 = estimatedValue(pv(95), 'пресет');
  const eq255 = knownTemp(255);

  it('без порога — noted: разница зафиксирована, противоречием не объявлена', () => {
    const d = diagnosePresetEquilibriumDivergence(preset95, eq255);
    expect(d.comparable).toBe(true);
    expect(d.differenceK).toBe(160);
    expect(d.verdict).toBe('noted');
    expect(d.thresholdK).toBeNull();
    expect(d.message).toContain('РАЗНЫЕ величины');
  });

  it('явный порог превышен — threshold_exceeded', () => {
    const d = diagnosePresetEquilibriumDivergence(preset95, eq255, { thresholdK: 100 });
    expect(d.verdict).toBe('threshold_exceeded');
    expect(d.thresholdK).toBe(100);
    expect(d.differenceK).toBe(160);
  });

  it('явный порог не превышен — noted', () => {
    const d = diagnosePresetEquilibriumDivergence(preset95, eq255, { thresholdK: 200 });
    expect(d.verdict).toBe('noted');
    expect(d.thresholdK).toBe(200);
  });

  it('непригодные входы — not_comparable без выдуманной разницы', () => {
    const d = diagnosePresetEquilibriumDivergence(unknownValue('нет пресета'), eq255);
    expect(d.comparable).toBe(false);
    expect(d.differenceK).toBeNull();
    expect(d.verdict).toBe('not_comparable');
    const d2 = diagnosePresetEquilibriumDivergence(preset95, notApplicable('T_eq неприменима'));
    expect(d2.verdict).toBe('not_comparable');
  });

  it('некорректный порог — throw invalid_threshold (нет порога «по умолчанию»)', () => {
    expect(() => diagnosePresetEquilibriumDivergence(preset95, eq255, { thresholdK: 0 })).toThrowError(
      ThermalStateError
    );
    expect(() => diagnosePresetEquilibriumDivergence(preset95, eq255, { thresholdK: -5 })).toThrowError(
      ThermalStateError
    );
    expect(() =>
      diagnosePresetEquilibriumDivergence(preset95, eq255, { thresholdK: Number.NaN })
    ).toThrowError(ThermalStateError);
    let thrown: unknown = null;
    try {
      diagnosePresetEquilibriumDivergence(preset95, eq255, { thresholdK: 0 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ThermalStateError);
    expect((thrown as ThermalStateError).code).toBe('invalid_threshold');
  });

  it('диагностика не изменяет входные температуры', () => {
    const before = JSON.stringify([preset95, eq255]);
    diagnosePresetEquilibriumDivergence(preset95, eq255, { thresholdK: 10 });
    expect(JSON.stringify([preset95, eq255])).toBe(before);
  });
});

// ============================================
// 7. ТИПИЗИРОВАННЫЙ ФАЗОВЫЙ СКРИНИНГ
// ============================================

describe('Stage 4.2.2: фазовый скрининг с происхождением температуры', () => {
  it('temperatureBasis сохраняет значение и происхождение; числа совпадают с легаси', () => {
    const model = makeAtmosphereModel();
    const temperature = estimatedValue(pv(95), 'пресет метановой атмосферы', {
      provenance: { sourceName: 'фикстура' }
    });
    const typed = analyzeAtmospherePhasesWithProvenance(model, temperature);
    const legacy = analyzeAtmospherePhases(model, 95);
    expect(typed.temperatureK).toBe(95);
    expect(typed.temperatureBasis).toBeDefined();
    expect(typed.temperatureBasis?.temperature).toBe(temperature);
    expect(typed.temperatureBasis?.note).toContain('95');
    // Числовая регрессия: компоненты и предупреждения идентичны.
    expect(typed.components).toEqual(legacy.components);
    expect(typed.warnings).toEqual(legacy.warnings);
    expect(typed.hasPotentialTransitions).toBe(legacy.hasPotentialTransitions);
  });

  it('unknown температура → скрининг без числа, все компоненты unknown', () => {
    const model = makeAtmosphereModel();
    const typed = analyzeAtmospherePhasesWithProvenance(model, unknownValue('пресет не задан'));
    expect(typed.temperatureK).toBeNull();
    expect(typed.components.length).toBeGreaterThan(0);
    expect(typed.components.every((c) => c.state === 'unknown')).toBe(true);
    expect(typed.temperatureBasis?.note).toContain('подстановка');
  });

  it('not_applicable температура → тоже без числа и без подстановок', () => {
    const model = makeAtmosphereModel();
    const typed = analyzeAtmospherePhasesWithProvenance(model, notApplicable('для получателя неприменима'));
    expect(typed.temperatureK).toBeNull();
    expect(typed.components.every((c) => c.state === 'unknown')).toBe(true);
  });

  it('численный API этапа 3 не изменился (регрессия)', () => {
    const model = makeAtmosphereModel();
    const legacy = analyzeAtmospherePhases(model, 95);
    expect(legacy.temperatureK).toBe(95);
    expect(legacy.mixtureNote).toContain('смеси');
    // Компоненты перечислены для всех газов модели.
    const gasIds = legacy.components.map((c) => c.gasId).sort();
    expect(gasIds).toEqual(['ch4', 'n2']);
  });

  it('слой атмосферы (4.2.2.1): контекст локальной области, числа идентичны', () => {
    const model = makeAtmosphereModel();
    // Location-aware контекст: слой surface_boundary из профиля
    const layer = {
      layerId: 'surface_boundary',
      temperature: estimatedValue(pv(95), 'игровое допущение пресета атмосферы (game_assumption)', {
        provenance: { rawInput: { presetTemperatureK: 95, presetKind: 'historical_game' } }
      }),
      note: 'единственная оценка из пресета атмосферы (приповерхностный слой)'
    };
    const typed = analyzeAtmospherePhasesWithProvenance(model, layer);
    const legacy = analyzeAtmospherePhases(model, 95);
    // Числовой паритет: результат скрининга идентичен
    expect(typed.temperatureK).toBe(95);
    expect(typed.components).toEqual(legacy.components);
    expect(typed.warnings).toEqual(legacy.warnings);
    // Базис: тот же ScientificValue со статусом и provenance
    expect(typed.temperatureBasis?.temperature).toBe(layer.temperature);
    expect(typed.temperatureBasis?.note).toContain('surface_boundary');
    expect(typed.temperatureBasis?.note).toContain('НЕ глобальная surfaceTemperature');
    expect(typed.temperatureBasis?.note).toContain('НЕ T_eq');
    // Stage 4.2.2.2: layerId доступен как структурированное значение
    expect(typed.temperatureBasis?.location).toEqual({
      kind: 'atmosphere_layer',
      layerId: 'surface_boundary'
    });
  });

  it('структурированное location контекста (4.2.2.2): слой — да, ScientificValue — нет', () => {
    const model = makeAtmosphereModel();
    // Слой передаётся как входной контекст → тот же layerId в результате
    const layerAnalysis = analyzeAtmospherePhasesWithProvenance(model, {
      layerId: 'surface_boundary',
      temperature: estimatedValue(pv(95), 'пресет метановой атмосферы', {
        provenance: { sourceName: 'фикстура' }
      })
    });
    expect(layerAnalysis.temperatureBasis?.location).toEqual({
      kind: 'atmosphere_layer',
      layerId: 'surface_boundary'
    });
    // Статус и provenance температуры сохранены
    expect(layerAnalysis.temperatureBasis?.temperature.status).toBe('estimated');
    // ScientificValue-контекст без конкретного слоя: location отсутствует
    // (обратная совместимость API сохранена)
    const valueAnalysis = analyzeAtmospherePhasesWithProvenance(
      model,
      estimatedValue(pv(95), 'пресет метановой атмосферы')
    );
    expect(valueAnalysis.temperatureBasis?.location).toBeUndefined();
    // unknown остаётся unknown: T_eq не используется как fallback
    const unknownAnalysis = analyzeAtmospherePhasesWithProvenance(model, {
      layerId: 'surface_boundary',
      temperature: unknownValue('температура не заявлена')
    });
    expect(unknownAnalysis.temperatureK).toBeNull();
    expect(unknownAnalysis.temperatureBasis?.temperature.status).toBe('unknown');
    expect(unknownAnalysis.temperatureBasis?.location).toEqual({
      kind: 'atmosphere_layer',
      layerId: 'surface_boundary'
    });
  });

  it('слой с unknown температурой (4.2.2.1): скрининг остаётся unknown без fallback', () => {
    const model = makeAtmosphereModel();
    const layer = {
      layerId: 'surface_boundary',
      temperature: unknownValue('локальная температура слоя неизвестна — пресета нет')
    };
    const typed = analyzeAtmospherePhasesWithProvenance(model, layer);
    expect(typed.temperatureK).toBeNull();
    expect(typed.components.every((c) => c.state === 'unknown')).toBe(true);
    expect(typed.temperatureBasis?.note).toContain('surface_boundary');
    expect(typed.temperatureBasis?.note).toContain('подстановка');
  });
});

// ============================================
// 8. РЕГРЕССИИ ПРЕСЕТОВ АТМОСФЕРЫ
// ============================================

describe('Stage 4.2.2: происхождение пресетных температур (регрессии)', () => {
  it('methane_ethane: 95 K, 1.5 atm, historical_game → игровое допущение', () => {
    const presets = getAllPresets();
    const preset = presets['methane_ethane'] as AtmosphereState;
    expect(preset).toBeDefined();
    expect(preset.temperature).toBe(95);
    expect(preset.totalPressure).toBe(1.5);
    expect(preset.presetKind).toBe('historical_game');
    const value = atmospherePresetTemperatureToScientificValue(preset);
    expect(value.status).toBe('estimated');
    expect(temperatureValueOrNull(value)).toBe(95);
  });

  it('titan_reference: 94 K, observational_reference — отличается от methane_ethane', () => {
    const presets = getAllPresets();
    const titan = presets['titan_reference'] as AtmosphereState;
    expect(titan.temperature).toBe(94);
    expect(titan.presetKind).toBe('observational_reference');
    const methane = atmospherePresetTemperatureToScientificValue(presets['methane_ethane'] as AtmosphereState);
    const titanValue = atmospherePresetTemperatureToScientificValue(titan);
    expect(temperatureValueOrNull(methane)).not.toBe(temperatureValueOrNull(titanValue));
    if (titanValue.status === 'estimated' && methane.status === 'estimated') {
      expect(titanValue.method).not.toBe(methane.method);
    }
  });

  it('earth 288 K / venus 737 K / mars 210 K — справочные ориентиры', () => {
    const presets = getAllPresets();
    const earth = presets['earth'] as AtmosphereState;
    const venus = presets['venus'] as AtmosphereState;
    const mars = presets['mars'] as AtmosphereState;
    expect(earth.temperature).toBe(288);
    expect(venus.temperature).toBe(737);
    expect(mars.temperature).toBe(210);
    for (const preset of [earth, venus, mars]) {
      const value = atmospherePresetTemperatureToScientificValue(preset);
      expect(value.status).toBe('estimated');
      expect(temperatureValueOrNull(value)).toBe(preset.temperature);
    }
  });

  it('not_applicable и unknown — разные статусы, число не подставляется ни одному', () => {
    const na = notApplicable('планета — получатель излучения');
    const unk = unknownValue('нет данных');
    expect(na.status).not.toBe(unk.status);
    expect(temperatureValueOrNull(na)).toBeNull();
    expect(temperatureValueOrNull(unk)).toBeNull();
    expect(validateThermalScientificValue(na)).toEqual([]);
    expect(validateThermalScientificValue(unk)).toEqual([]);
  });

  it('диагностика пресета 95 K против T_eq 255 K — расхождение 160 K', () => {
    const preset = atmospherePresetTemperatureToScientificValue({
      temperature: 95,
      presetKind: 'historical_game'
    });
    const d = diagnosePresetEquilibriumDivergence(preset, knownTemp(255));
    expect(d.differenceK).toBe(160);
    expect(d.verdict).toBe('noted');
  });
});
