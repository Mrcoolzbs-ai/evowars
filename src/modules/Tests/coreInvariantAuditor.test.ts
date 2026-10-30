// ============================================
// STAGE 4.2.1 - Тесты общего аудита инвариантов перехода
// ============================================
//
// auditWorldTransition объединяет контракты Stage 4.1 (вещество,
// элементы, заряд, энергия, пофазовый аудит резервуаров, валидация
// реестра и состояния мира). Правила честности: неизвестное не
// превращается в ноль; внутренний перенос, отражённый в ledger,
// дисбалансом не является; balanced возможен только при полном
// аудите и полной границе системы; approximate не является balanced.

import { describe, it, expect } from 'vitest';
import { auditWorldTransition } from '../Core/invariantAuditor';
import type { WorldTransitionAudit } from '../Core/invariantAuditor';
import { createCoreWorldState } from '../Core/worldState';
import type { CoreWorldState } from '../Core/worldState';
import { createReservoir, setEnergyInventory, setMaterialInventory } from '../Core/reservoir';
import type { InventoryBasis, ReservoirRecord } from '../Core/reservoir';
import { applyFlux, createFluxLedger, EXTERNAL, registerFlux } from '../Core/fluxLedger';
import type { FluxLedger, FluxRecord } from '../Core/fluxLedger';
import { createSpeciesCatalog } from '../Core/species';
import type { SpeciesCatalog } from '../Core/species';
import { advance, createSimulationClock } from '../Core/simulationClock';

function catalogOf(molarMassStatus: 'known' | 'estimated' = 'known'): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  catalog.register({
    id: 'co2',
    formula: 'CO2',
    name: 'диоксид углерода',
    elements: { c: 1, o: 2 },
    charge: 0,
    phase: 'gas',
    molarMassKgMol: 0.044,
    molarMassStatus,
    dataStatus: 'known'
  });
  return catalog;
}

function res(id: string, kind: string, entries: Record<string, number>, opts?: { basis?: InventoryBasis }): ReservoirRecord {
  return setEnergyInventory(
    setMaterialInventory(createReservoir(id, kind), opts?.basis ?? 'amount', entries),
    { storedJ: 0, netPowerW: null, fluxW_m2: null }
  );
}

function worldOf(reservoirs: ReservoirRecord[]): CoreWorldState {
  return { ...createCoreWorldState('w'), reservoirs };
}

function reservoirsMap(world: CoreWorldState): Record<string, ReservoirRecord> {
  const map: Record<string, ReservoirRecord> = {};
  for (const r of world.reservoirs) map[r.id] = r;
  return map;
}

function sectionOf(audit: WorldTransitionAudit, key: string) {
  return audit.sections.find((s) => s.key === key);
}

describe('Stage 4.2.1 InvariantAuditor: balanced', () => {
  it('внутренний перенос, корректно отражённый в ledger, — balanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 }), res('ocn', 'ocean', { co2: 0 })]);
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'f1',
      kind: 'internal_transfer',
      from: 'atm',
      to: 'ocn',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 40, basis: 'amount' }
    });
    const applied = applyFlux(ledger, reservoirsMap(before), 'f1');
    const after: CoreWorldState = {
      ...before,
      reservoirs: [applied.reservoirs['atm'], applied.reservoirs['ocn']],
      fluxLedger: applied.ledger
    };
    const audit = auditWorldTransition(before, after, applied.ledger, { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
    for (const s of audit.sections) {
      expect(s.status).toBe('balanced');
    }
  });

  it('внешний источник учитывается явно: external_input → balanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 50 })]);
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'in1',
      kind: 'external_input',
      from: EXTERNAL,
      to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 50, basis: 'amount' }
    });
    const applied = applyFlux(ledger, reservoirsMap(before), 'in1');
    const after: CoreWorldState = { ...before, reservoirs: [applied.reservoirs['atm']], fluxLedger: applied.ledger };
    const audit = auditWorldTransition(before, after, applied.ledger, { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('внешний сток учитывается явно: external_output → balanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'out1',
      kind: 'external_output',
      from: 'atm',
      to: EXTERNAL,
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 30, basis: 'amount' }
    });
    const applied = applyFlux(ledger, reservoirsMap(before), 'out1');
    const after: CoreWorldState = { ...before, reservoirs: [applied.reservoirs['atm']], fluxLedger: applied.ledger };
    const audit = auditWorldTransition(before, after, applied.ledger, { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('пустой мир без изменений — balanced', () => {
    const empty = worldOf([]);
    const audit = auditWorldTransition(empty, { ...empty }, createFluxLedger(), { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });
});

describe('Stage 4.2.1 InvariantAuditor: imbalanced', () => {
  it('убыль вещества без записи потока — imbalanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const after = worldOf([res('atm', 'atmosphere', { co2: 97 })]);
    const audit = auditWorldTransition(before, after, createFluxLedger(), { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('imbalanced');
    expect(audit.balanced).toBe(false);
    expect(sectionOf(audit, 'substance')?.status).toBe('imbalanced');
    expect(sectionOf(audit, 'reservoir_fluxes')?.status).toBe('imbalanced');
  });

  it('отрицательный запас в «после» — imbalanced (nonnegativity)', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const bad: ReservoirRecord = { ...before.reservoirs[0], material: { basis: 'amount', entries: { co2: -5 } } };
    const after = worldOf([bad]);
    const audit = auditWorldTransition(before, after, createFluxLedger(), { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('imbalanced');
    expect(sectionOf(audit, 'nonnegativity')?.status).toBe('imbalanced');
  });

  it('реестр с дублирующимся id потока — invalid, итог imbalanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const after = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const rec: FluxRecord = {
      id: 'fx',
      kind: 'external_input',
      from: EXTERNAL,
      to: 'atm',
      subject: { subjectType: 'energy', quantityKind: 'rate', powerW: 5 },
      time: null,
      status: 'applied'
    };
    const broken: FluxLedger = { records: [rec, { ...rec }] };
    const audit = auditWorldTransition(before, after, broken, { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('imbalanced');
    expect(sectionOf(audit, 'ledger')?.status).toBe('invalid');
  });

  it('время мира не может идти назад — time imbalanced', () => {
    const before = { ...worldOf([res('atm', 'atmosphere', { co2: 100 })]), clock: advance(createSimulationClock(), 100) };
    const after = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const audit = auditWorldTransition(before, after, createFluxLedger(), { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('imbalanced');
    expect(sectionOf(audit, 'time')?.status).toBe('imbalanced');
  });

  it('дублирующийся id резервуара — состояние недопустимо, итог imbalanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const after = worldOf([res('atm', 'atmosphere', { co2: 100 }), res('atm', 'ocean', { co2: 0 })]);
    const audit = auditWorldTransition(before, after, createFluxLedger(), { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('imbalanced');
    expect(sectionOf(audit, 'state')?.status).toBe('invalid');
  });
});

describe('Stage 4.2.1 InvariantAuditor: not_verifiable (неизвестное — не ноль)', () => {
  it('исчезнувший материальный инвентарь без not_applicable — not_verifiable', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const after = worldOf([setEnergyInventory(createReservoir('atm', 'atmosphere'), { storedJ: 0, netPowerW: null, fluxW_m2: null })]);
    const audit = auditWorldTransition(before, after, createFluxLedger(), { speciesCatalog: catalogOf(), boundary: 'complete' });
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(sectionOf(audit, 'substance')?.status).toBe('not_verifiable');
    expect(sectionOf(audit, 'reservoir_fluxes')?.status).toBe('not_verifiable');
  });

  it('untimed-запись в ограниченной области не маскируется как успех', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 }), res('ocn', 'ocean', { co2: 0 })]);
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'f1',
      kind: 'internal_transfer',
      from: 'atm',
      to: 'ocn',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 40, basis: 'amount' }
    });
    const applied = applyFlux(ledger, reservoirsMap(before), 'f1');
    const after: CoreWorldState = { ...before, reservoirs: [applied.reservoirs['atm'], applied.reservoirs['ocn']] };
    const audit = auditWorldTransition(before, after, applied.ledger, {
      speciesCatalog: catalogOf(),
      boundary: 'complete',
      scope: { after: { segmentIndex: 0, localTimeS: 0 }, upTo: { segmentIndex: 0, localTimeS: 100 } }
    });
    // untimed-запись исключена из области: изменение резервуаров ничем
    // не объясняется ВНУТРИ области → пофазовый аудит честно фиксирует
    // расхождение (imbalanced), а балансы непроверяемы (not_verifiable).
    // Итог — imbalanced: ни успех, ни маскировка неизвестности нулём.
    expect(audit.status).toBe('imbalanced');
    expect(audit.balanced).toBe(false);
    expect(sectionOf(audit, 'reservoir_fluxes')?.status).toBe('imbalanced');
    expect(sectionOf(audit, 'substance')?.status).toBe('not_verifiable');
  });

  it('includeUntimed берёт ответственность на вызывающего: область полна → balanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 }), res('ocn', 'ocean', { co2: 0 })]);
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'f1',
      kind: 'internal_transfer',
      from: 'atm',
      to: 'ocn',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 40, basis: 'amount' }
    });
    const applied = applyFlux(ledger, reservoirsMap(before), 'f1');
    const after: CoreWorldState = { ...before, reservoirs: [applied.reservoirs['atm'], applied.reservoirs['ocn']] };
    const audit = auditWorldTransition(before, after, applied.ledger, {
      speciesCatalog: catalogOf(),
      boundary: 'complete',
      scope: { after: { segmentIndex: 0, localTimeS: 0 }, upTo: { segmentIndex: 0, localTimeS: 100 }, includeUntimed: true }
    });
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('неизвестная граница системы не даёт balanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const after = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const audit = auditWorldTransition(before, after, createFluxLedger(), { speciesCatalog: catalogOf(), boundary: 'unknown' });
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(audit.boundary).toBe('unknown');
    expect(audit.diagnostics.some((d) => d.includes('boundary'))).toBe(true);
  });

  it('неполная граница системы не даёт balanced', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const after = worldOf([res('atm', 'atmosphere', { co2: 100 })]);
    const audit = auditWorldTransition(before, after, createFluxLedger(), { speciesCatalog: catalogOf(), boundary: 'incomplete' });
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(audit.boundary).toBe('incomplete');
  });
});

describe('Stage 4.2.1 InvariantAuditor: approximate не является balanced', () => {
  it('оценочная молярная масса в массовом основании — approximate', () => {
    const before = worldOf([res('atm', 'atmosphere', { co2: 100 }, { basis: 'mass' })]);
    const after = worldOf([res('atm', 'atmosphere', { co2: 100 }, { basis: 'mass' })]);
    const audit = auditWorldTransition(before, after, createFluxLedger(), { speciesCatalog: catalogOf('estimated'), boundary: 'complete' });
    expect(audit.status).toBe('approximate');
    expect(audit.balanced).toBe(false);
    expect(sectionOf(audit, 'substance')?.status).toBe('approximate');
    expect(sectionOf(audit, 'element')?.status).toBe('approximate');
  });
});
