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
import { createFluxLedger } from '../Core/fluxLedger';

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
    expect(issues.some((i) => i.code === 'invalid_flux_reference')).toBe(true);
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
