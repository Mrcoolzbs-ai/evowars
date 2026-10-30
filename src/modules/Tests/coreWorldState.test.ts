// ============================================
// STAGE 4.1 - Тесты канонического состояния мира
// ============================================

import { describe, it, expect } from 'vitest';
import {
  CORE_WORLD_STATE_SCHEMA_VERSION,
  createCoreWorldState,
  validateWorldState
} from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { createSimulationClock, advance } from '../Core/simulationClock';
import { knownValue, unknownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { createFluxLedger, EXTERNAL } from '../Core/fluxLedger';
import type { FluxRecord } from '../Core/fluxLedger';

function validState(): CoreWorldState {
  const state = createCoreWorldState('w1');
  state.bodies.push({ id: 'star', kind: 'star', properties: {} });
  state.bodies.push({
    id: 'planet',
    kind: 'planet',
    properties: { mass: knownValue(quantity(5.97e24, 'kg')) }
  });
  state.gravity = { planet: 'star', star: null };
  state.radiationSources.push({ id: 'star-light', bodyId: 'star', kind: 'star' });
  state.reservoirs.push(setMaterialInventory(
    createReservoir('atm', 'atmosphere', { bodyId: 'planet' }),
    'amount',
    { co2: 100 }
  ));
  state.legacy = { generatorVersion: '0.3.0', seed: 'test-seed' };
  return state;
}

describe('Stage 4.1 WorldState: корректное состояние', () => {
  it('createCoreWorldState создаёт согласованный каркас', () => {
    const state = createCoreWorldState('world-1');
    expect(state.schemaVersion).toBe(CORE_WORLD_STATE_SCHEMA_VERSION);
    expect(validateWorldState(state)).toEqual([]);
    // часы стартуют с нуля локального времени; космический возраст не задан
    expect(state.clock.localTimeS).toBe(0);
    expect(state.cosmicAge).toBeNull();
  });

  it('валидное состояние с телами, иерархией и резервуарами проходит', () => {
    expect(validateWorldState(validState())).toEqual([]);
  });
});

describe('Stage 4.1 WorldState: целостность ссылок', () => {
  it('дублирующийся id тела обнаруживается', () => {
    const state = validState();
    state.bodies.push({ id: 'planet', kind: 'moon', properties: {} });
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'duplicate_id' && i.component === 'WorldBody')).toBe(true);
  });

  it('дублирующийся id резервуара обнаруживается', () => {
    const state = validState();
    state.reservoirs.push(createReservoir('atm', 'atmosphere'));
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'duplicate_id' && i.component === 'Reservoir')).toBe(true);
  });

  it('битая ссылка гравитационного родителя обнаруживается', () => {
    const state = validState();
    state.gravity = { planet: 'black-hole-ghost' };
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'broken_reference' && i.component === 'Gravity')).toBe(true);
  });

  it('тело не может быть собственным родителем', () => {
    const state = validState();
    state.gravity = { planet: 'planet', star: null };
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'self_parent')).toBe(true);
  });

  it('цикл в гравитационной иерархии обнаруживается', () => {
    const state = validState();
    state.bodies.push({ id: 'moon', kind: 'moon', properties: {} });
    state.gravity = { planet: 'moon', moon: 'planet', star: null };
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'gravity_cycle')).toBe(true);
  });

  it('источник излучения обязан ссылаться на существующее тело', () => {
    const state = validState();
    state.radiationSources.push({ id: 'ghost-light', bodyId: 'phantom', kind: 'star' });
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'broken_reference' && i.component === 'RadiationSource')).toBe(true);
  });

  it('резервуар обязан ссылаться на существующее тело', () => {
    const state = validState();
    state.reservoirs.push(createReservoir('ghost-tank', 'ocean', { bodyId: 'phantom' }));
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'broken_reference' && i.component === 'Reservoir')).toBe(true);
  });

  it('поток обязан ссылаться на существующие резервуары', () => {
    const state = validState();
    const ledger = createFluxLedger();
    state.fluxLedger = {
      records: [
        ...ledger.records,
        {
          id: 'bad-flux',
          kind: 'internal_transfer',
          from: 'atm',
          to: 'nonexistent-reservoir',
          subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' },
          time: null,
          status: 'pending'
        }
      ]
    };
    const issues = validateWorldState(state);
    // Stage 4.1.1: полная валидация формы FluxRecord (validateFluxLedger) → invalid_flux
    expect(issues.some((i) => i.code === 'invalid_flux' && i.component === 'FluxLedger')).toBe(true);
  });

  it('некорректные часы обнаруживаются', () => {
    const state = validState();
    state.clock = { segmentIndex: 0, localTimeS: -10, priorSegmentsS: 0, stepCount: 0, representableStepS: null };
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'invalid_clock')).toBe(true);
  });

  it('пустой worldId и некорректная версия схемы обнаруживаются', () => {
    const state = validState();
    state.worldId = ' ';
    state.legacy.savedSchemaVersion = 'супер-версия';
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'empty_world_id')).toBe(true);
    expect(issues.some((i) => i.code === 'version_mismatch')).toBe(true);
  });
});

describe('Stage 4.1 WorldState: гравитация ≠ излучение', () => {
  it('компактный остаток — гравитационкий якорь без звёздного излучения', () => {
    const state = createCoreWorldState('w2');
    state.bodies.push({ id: 'remnant', kind: 'compact_remnant', properties: {} });
    state.bodies.push({ id: 'planet', kind: 'planet', properties: { surfaceTemp: unknownValue('не рассчитано') } });
    state.gravity = { planet: 'remnant', remnant: null };
    // НЕТ ни одного источника излучения — и это валидно: без аккреции
    // компактный остаток не светит, а гравитация от него не зависит
    expect(state.radiationSources.length).toBe(0);
    expect(validateWorldState(state)).toEqual([]);
  });

  it('одна и та же звезда может быть родителем И источником — независимо', () => {
    const state = validState();
    const issues = validateWorldState(state);
    expect(issues).toEqual([]);
    expect(state.gravity['planet']).toBe('star');
    expect(state.radiationSources[0].bodyId).toBe('star');
  });

  it('излучение от тела, не являющегося гравитационным родителем, допустимо', () => {
    const state = validState();
    state.bodies.push({ id: 'distant-star', kind: 'star', properties: {} });
    state.radiationSources.push({ id: 'far-light', bodyId: 'distant-star', kind: 'star' });
    // планета гравитационно привязана к star, но освещается и от distant-star
    expect(validateWorldState(state)).toEqual([]);
  });
});

describe('Stage 4.1 WorldState: время состояния', () => {
  it('часы состояния можно продвигать, возраст остаётся отдельной характеристикой', () => {
    const state = validState();
    state.clock = advance(createSimulationClock(), 1000);
    expect(state.clock.localTimeS).toBe(1000);
    expect(state.cosmicAge).toBeNull(); // возраст не «утёк» из часов
    expect(validateWorldState(state)).toEqual([]);
  });
});

// ============================================
// STAGE 4.1.1 — глубокая валидация состояния мира (ISSUE 5)
// ============================================

function baseFluxRecord(): FluxRecord {
  return {
    id: 'flux-1',
    kind: 'external_input',
    from: EXTERNAL,
    to: 'atm',
    subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' },
    time: null,
    status: 'pending'
  };
}

function badFluxRecord(overrides: Record<string, unknown>): FluxRecord {
  return { ...baseFluxRecord(), ...overrides } as unknown as FluxRecord;
}

describe('Stage 4.1.1 WorldState: глубокая валидация резервуаров', () => {
  it('отрицательный материальный инвентарь → invalid_reservoir', () => {
    const state = validState();
    state.reservoirs.push({
      id: 'bad-inventory', kind: 'ocean', material: { basis: 'amount', entries: { co2: -5 } }, properties: {}
    } as unknown as ReservoirRecord);
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'invalid_reservoir' && i.component === 'Reservoir')).toBe(true);
  });

  it('NaN в storedJ → invalid_reservoir', () => {
    const state = validState();
    state.reservoirs.push({
      id: 'bad-energy', kind: 'ocean',
      energy: { storedJ: Number.NaN, netPowerW: null, fluxW_m2: null },
      properties: {}
    } as unknown as ReservoirRecord);
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'invalid_reservoir' && i.component === 'Reservoir')).toBe(true);
  });

  it('storedJ: null (энергия неизвестна) проходит валидацию — отсутствие знания не ошибка', () => {
    const state = validState();
    state.reservoirs.push({
      id: 'unknown-energy', kind: 'ocean',
      energy: { storedJ: null, netPowerW: null, fluxW_m2: null },
      properties: {}
    } as unknown as ReservoirRecord);
    const issues = validateWorldState(state);
    expect(issues.filter((i) => i.code === 'invalid_reservoir')).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('unknown-значения в свойствах тел и резервуаров допустимы', () => {
    const state = validState();
    state.bodies.push({
      id: 'cold-planet', kind: 'planet',
      properties: { surfaceTemp: unknownValue('не рассчитано'), albedo: unknownValue('нет данных') }
    });
    expect(validateWorldState(state)).toEqual([]);
  });

  it('known-свойство без quantity → invalid_scientific_value', () => {
    const state = validState();
    state.bodies.push({
      id: 'broken-planet', kind: 'planet',
      properties: { mass: { status: 'known' } as unknown as never }
    });
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'invalid_scientific_value' && i.component === 'WorldBody')).toBe(true);
  });
});

describe('Stage 4.1.1 WorldState: полная валидация FluxRecord', () => {
  it('корректная запись потока проходит', () => {
    const state = validState();
    state.fluxLedger = { records: [baseFluxRecord()] };
    expect(validateWorldState(state)).toEqual([]);
  });

  it('дублирующийся id потока → invalid_flux', () => {
    const state = validState();
    state.fluxLedger = { records: [baseFluxRecord(), baseFluxRecord()] };
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'invalid_flux' && i.component === 'FluxLedger')).toBe(true);
  });

  it('мусорный kind и status записи → invalid_flux', () => {
    const state = validState();
    state.fluxLedger = { records: [badFluxRecord({ kind: 'magic-teleport' })] };
    expect(validateWorldState(state).some((i) => i.code === 'invalid_flux')).toBe(true);

    const state2 = validState();
    state2.fluxLedger = { records: [badFluxRecord({ status: 'weird' })] };
    expect(validateWorldState(state2).some((i) => i.code === 'invalid_flux')).toBe(true);
  });

  it('несогласованные направления с kind → invalid_flux', () => {
    // internal_transfer не может начинаться во внешнем источнике
    const state = validState();
    state.fluxLedger = { records: [badFluxRecord({ kind: 'internal_transfer', from: EXTERNAL, to: 'atm' })] };
    expect(validateWorldState(state).some((i) => i.code === 'invalid_flux')).toBe(true);

    // external_input обязан начинаться во внешнем источнике
    const state2 = validState();
    state2.fluxLedger = { records: [badFluxRecord({ kind: 'external_input', from: 'atm', to: 'atm' })] };
    expect(validateWorldState(state2).some((i) => i.code === 'invalid_flux')).toBe(true);
  });

  it('неотрицательный subject: отрицательное/NaN количество → invalid_flux', () => {
    const state = validState();
    state.fluxLedger = {
      records: [badFluxRecord({ subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: -1, basis: 'amount' } })]
    };
    expect(validateWorldState(state).some((i) => i.code === 'invalid_flux')).toBe(true);

    const state2 = validState();
    state2.fluxLedger = {
      records: [badFluxRecord({ subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: Number.NaN } })]
    };
    expect(validateWorldState(state2).some((i) => i.code === 'invalid_flux')).toBe(true);
  });

  it('некорректное время потока (segmentIndex -1, localTimeS NaN) → invalid_flux', () => {
    const state = validState();
    state.fluxLedger = { records: [badFluxRecord({ time: { segmentIndex: -1, localTimeS: 10 } })] };
    expect(validateWorldState(state).some((i) => i.code === 'invalid_flux')).toBe(true);

    const state2 = validState();
    state2.fluxLedger = { records: [badFluxRecord({ time: { segmentIndex: 0, localTimeS: Number.NaN } })] };
    expect(validateWorldState(state2).some((i) => i.code === 'invalid_flux')).toBe(true);
  });

  it('ссылка на несуществующий резервуар → invalid_flux', () => {
    const state = validState();
    state.fluxLedger = { records: [badFluxRecord({ to: 'ghost-tank' })] };
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'invalid_flux' && i.component === 'FluxLedger')).toBe(true);
  });
});

describe('Stage 4.1.1 WorldState: строгая проверка версии схемы', () => {
  it('неподдерживаемая schemaVersion «2.0.0» → version_mismatch (раньше проходила любая строка)', () => {
    const state = validState();
    state.schemaVersion = '2.0.0';
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'version_mismatch' && i.component === 'CoreWorldState')).toBe(true);
  });

  it('мусорная schemaVersion → version_mismatch', () => {
    const state = validState();
    state.schemaVersion = 'абракадабра';
    expect(validateWorldState(state).some((i) => i.code === 'version_mismatch')).toBe(true);
  });

  it('текущая версия схемы проходит', () => {
    const state = validState();
    state.schemaVersion = '1.0.0';
    expect(validateWorldState(state)).toEqual([]);
  });
});


// ============================================
// STAGE 4.1.1.2 — WORLDSTATE: ОБЯЗАТЕЛЬНЫЕ ПОЛЯ RESERVOIRRECORD
// ============================================

describe('Stage 4.1.1.2 WorldState: обязательные поля ReservoirRecord', () => {
  it('резервуар без properties → invalid_reservoir (обязательное поле)', () => {
    const state = validState();
    state.reservoirs.push({
      id: 'no-props', kind: 'ocean'
    } as unknown as ReservoirRecord);
    const issues = validateWorldState(state);
    const reservoirIssues = issues.filter((i) => i.code === 'invalid_reservoir');
    expect(reservoirIssues.length).toBeGreaterThan(0);
    expect(reservoirIssues.some((i) => i.message.includes('properties'))).toBe(true);
  });

  it('properties не-объект (42) → invalid_reservoir', () => {
    const state = validState();
    state.reservoirs.push({
      id: 'num-props', kind: 'ocean', properties: 42
    } as unknown as ReservoirRecord);
    const issues = validateWorldState(state);
    expect(issues.some((i) => i.code === 'invalid_reservoir' && i.message.includes('properties'))).toBe(true);
  });

  it('голый резервуар c properties = {} без material/energy валиден (отсутствие инвентаря ≠ ошибка)', () => {
    const state = validState();
    state.reservoirs.push({
      id: 'bare', kind: 'ocean', properties: {}
    } as unknown as ReservoirRecord);
    expect(validateWorldState(state)).toEqual([]);
  });

  it('materialApplicability: not_applicable валиден, мусор и конфликт — invalid_reservoir', () => {
    // явное «материя неприменима по природе» — законно
    const okState = validState();
    okState.reservoirs.push({
      id: 'radiation-buffer', kind: 'buffer', properties: {}, materialApplicability: 'not_applicable'
    } as unknown as ReservoirRecord);
    expect(validateWorldState(okState)).toEqual([]);

    // неизвестное значение маркера — ошибка
    const junkState = validState();
    junkState.reservoirs.push({
      id: 'junk-marker', kind: 'buffer', properties: {}, materialApplicability: 'sometimes'
    } as unknown as ReservoirRecord);
    expect(validateWorldState(junkState).some((i) => i.code === 'invalid_reservoir' && i.message.includes('materialApplicability'))).toBe(true);

    // одновременный инвентарь и «неприменимость» — противоречие
    const conflictState = validState();
    conflictState.reservoirs.push({
      id: 'conflict', kind: 'buffer', properties: {}, materialApplicability: 'not_applicable',
      material: { basis: 'amount', entries: {} }
    } as unknown as ReservoirRecord);
    expect(validateWorldState(conflictState).some((i) => i.code === 'invalid_reservoir' && i.message.includes('противоречат'))).toBe(true);
  });
});

// ============================================
// STAGE 4.1.1.3 — WORLDSTATE: СЛОВАРИ-ПОЛЯ НЕ ПРИНИМАЮТ МАССИВЫ (ISSUE B)
// ============================================

describe('Stage 4.1.1.3 WorldState: словари-поля не принимают массивы (ISSUE B)', () => {
  it('резервуар с properties = [] — invalid_reservoir', () => {
    const state = validState();
    state.reservoirs.push({ id: 'arr-props', kind: 'ocean', properties: [] } as unknown as ReservoirRecord);
    expect(validateWorldState(state).some((i) => i.code === 'invalid_reservoir' && i.message.includes('properties'))).toBe(true);
  });

  it('резервуар с material.entries = [] — invalid_reservoir', () => {
    const state = validState();
    state.reservoirs.push({ id: 'arr-entries', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: [] } } as unknown as ReservoirRecord);
    expect(validateWorldState(state).some((i) => i.code === 'invalid_reservoir' && i.message.includes('material.entries'))).toBe(true);
  });

  it('корректные словари properties/material.entries проходят полностью', () => {
    const state = validState();
    state.reservoirs.push({ id: 'dict-ok', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: {} } } as unknown as ReservoirRecord);
    expect(validateWorldState(state)).toEqual([]);
  });
});
