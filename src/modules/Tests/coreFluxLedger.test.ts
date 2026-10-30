// ============================================
// STAGE 4.1 / 4.1.1 - Тесты учёта потоков: внутренние/внешние переносы,
// rate против integrated, балансы, идемпотентность.
// Stage 4.1.1: реальное применение энергетических потоков,
// basis-aware аудиты, временная область, пофазовый аудит.
// ============================================

import { describe, it, expect } from 'vitest';
import {
  EXTERNAL,
  createFluxLedger,
  registerFlux,
  applyFlux,
  revertFlux,
  integrateSubstanceRate,
  integratePower,
  totalInventory,
  netExternalTransfers,
  auditSubstanceConservation,
  auditElementConservation,
  auditChargeConservation,
  auditEnergyConservation,
  auditReservoirFluxes,
  validateLedgerReferences,
  validateFluxLedger,
  FluxLedgerError
} from '../Core/fluxLedger';
import type { FluxLedger, FluxRecord } from '../Core/fluxLedger';
import {
  createReservoir,
  setMaterialInventory,
  getAmount,
  setEnergyInventory
} from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { createSpeciesCatalog } from '../Core/species';
import type { SpeciesCatalog } from '../Core/species';

function reservoirsFixture(): Record<string, ReservoirRecord> {
  return {
    atm: setMaterialInventory(createReservoir('atm', 'atmosphere'), 'amount', { co2: 100, h2o: 10 }),
    ocean: setMaterialInventory(createReservoir('ocean', 'ocean'), 'amount', { co2: 20 })
  };
}

/**
 * Каталог видов Stage 4.1.1: молярные массы с разными статусами
 * нужны для basis-aware аудитов (mass → mol).
 */
function speciesFixture(): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  catalog.register({
    id: 'co2', formula: 'CO2', elements: { C: 1, O: 2 }, charge: 0, phase: 'gas',
    molarMassKgMol: 0.044, molarMassStatus: 'known', dataStatus: 'known'
  });
  catalog.register({
    id: 'h2o', formula: 'H2O', elements: { H: 2, O: 1 }, charge: 0, phase: 'gas',
    molarMassKgMol: 0.018, molarMassStatus: 'known', dataStatus: 'known'
  });
  catalog.register({
    id: 'co2_est', formula: 'CO2~', elements: { C: 1, O: 2 }, charge: 0, phase: 'gas',
    molarMassKgMol: 0.0445, molarMassStatus: 'estimated', dataStatus: 'estimated'
  });
  catalog.register({
    id: 'co2_nomass', formula: 'CO2?!', elements: { C: 1, O: 2 }, charge: 0, phase: 'gas',
    molarMassKgMol: null, molarMassStatus: 'unknown', dataStatus: 'known'
  });
  catalog.register({
    id: 'electron', formula: 'e-', elements: {}, charge: -1, phase: 'plasma',
    molarMassKgMol: 5.4857990907e-37, molarMassStatus: 'known', dataStatus: 'known'
  });
  return catalog;
}

function energyFixture(storedJ1: number, storedJ2: number): Record<string, ReservoirRecord> {
  return {
    r1: setEnergyInventory(createReservoir('r1', 'test'), { storedJ: storedJ1, netPowerW: null, fluxW_m2: null }),
    r2: setEnergyInventory(createReservoir('r2', 'test'), { storedJ: storedJ2, netPowerW: null, fluxW_m2: null })
  };
}

describe('Stage 4.1 FluxLedger: регистрация потоков', () => {
  it('внутренний перенос, внешний вход и внешний выход регистрируются', () => {
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'f1', kind: 'internal_transfer', from: 'atm', to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 10, basis: 'amount' }
    });
    ledger = registerFlux(ledger, {
      id: 'f2', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'h2o', quantityKind: 'integrated', amount: 5, basis: 'amount' }
    });
    ledger = registerFlux(ledger, {
      id: 'f3', kind: 'external_output', from: 'atm', to: EXTERNAL,
      subject: { subjectType: 'substance', speciesId: 'h2o', quantityKind: 'integrated', amount: 2, basis: 'amount' }
    });
    expect(ledger.records.length).toBe(3);
    expect(ledger.records.map((r) => r.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('внешний поток нельзя замаскировать под внутренний и наоборот', () => {
    const ledger = createFluxLedger();
    expect(() => registerFlux(ledger, {
      id: 'bad1', kind: 'internal_transfer', from: EXTERNAL, to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' }
    })).toThrowError(/внешнюю границу/);
    expect(() => registerFlux(ledger, {
      id: 'bad2', kind: 'external_input', from: 'atm', to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' }
    })).toThrow(FluxLedgerError);
    expect(() => registerFlux(ledger, {
      id: 'bad3', kind: 'internal_transfer', from: 'atm', to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' }
    })).toThrowError(/в самого себя/);
  });

  it('нулевые, отрицательные и нечисловые количества отвергаются', () => {
    const ledger = createFluxLedger();
    expect(() => registerFlux(ledger, {
      id: 'z', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 0, basis: 'amount' }
    })).toThrow(FluxLedgerError);
    expect(() => registerFlux(ledger, {
      id: 'z', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: -3, basis: 'amount' }
    })).toThrow(FluxLedgerError);
  });

  it('дублирующийся id потока невозможен', () => {
    let ledger = createFluxLedger();
    const rec = {
      id: 'f', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' as const }
    } as const;
    ledger = registerFlux(ledger, rec);
    expect(() => registerFlux(ledger, rec)).toThrowError(/уже зарегистрирован/);
  });
});

describe('Stage 4.1 FluxLedger: rate ≠ integrated amount', () => {
  it('скорость не применяется к инвентарю без интеграции', () => {
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'rate1', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'rate', ratePerSecond: 2, basis: 'amount' }
    });
    const reservoirs = reservoirsFixture();
    try {
      applyFlux(ledger, reservoirs, 'rate1');
      expect.unreachable('скорость не должна применяться');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('rate_not_applicable');
    }
  });

  it('мощность — не переданная энергия', () => {
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'power1', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'energy', quantityKind: 'rate', powerW: 500 }
    });
    try {
      applyFlux(ledger, reservoirsFixture(), 'power1');
      expect.unreachable('мощность не должна применяться как энергия');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('rate_not_applicable');
    }
  });

  it('интеграция скорости по времени даёт количество', () => {
    const rate = { subjectType: 'substance', speciesId: 'co2', quantityKind: 'rate', ratePerSecond: 2, basis: 'amount' } as const;
    const integrated = integrateSubstanceRate(rate, 10);
    expect(integrated.quantityKind).toBe('integrated');
    expect(integrated.amount).toBe(20);
    // отрицательный и нулевой интервал запрещены
    expect(() => integrateSubstanceRate(rate, 0)).toThrow(FluxLedgerError);
    expect(() => integrateSubstanceRate(rate, -5)).toThrow(FluxLedgerError);
  });

  it('интеграция мощности даёт энергию за интервал', () => {
    expect(integratePower(100, 10)).toBe(1000);
    expect(() => integratePower(100, 0)).toThrow(FluxLedgerError);
    expect(() => integratePower(Number.NaN, 10)).toThrow(FluxLedgerError);
  });
});

describe('Stage 4.1 FluxLedger: применение и балансы', () => {
  it('внутренний перенос: источник теряет, получатель получает, итог неизменен', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 't1', kind: 'internal_transfer', from: 'atm', to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 10, basis: 'amount' }
    });
    const applied = applyFlux(ledger, before, 't1');
    expect(getAmount(applied.reservoirs['atm'], 'co2')).toBe(90);
    expect(getAmount(applied.reservoirs['ocean'], 'co2')).toBe(30);
    expect(applied.ledger.records[0].status).toBe('applied');
    // общий запас системы не изменился
    const beforeTotals = totalInventory(before).totals;
    const afterTotals = totalInventory(applied.reservoirs).totals;
    expect(afterTotals.co2).toBe(beforeTotals.co2);
    const audit = auditSubstanceConservation(catalog, applied.ledger, before, applied.reservoirs);
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('внешний вход увеличивает, внешний выход уменьшает общий инвентарь', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 'in1', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'h2o', quantityKind: 'integrated', amount: 7, basis: 'amount' }
    });
    ledger = registerFlux(ledger, {
      id: 'out1', kind: 'external_output', from: 'atm', to: EXTERNAL,
      subject: { subjectType: 'substance', speciesId: 'h2o', quantityKind: 'integrated', amount: 3, basis: 'amount' }
    });
    let state = { ledger, reservoirs: before };
    state = applyFlux(state.ledger, state.reservoirs, 'in1');
    state = applyFlux(state.ledger, state.reservoirs, 'out1');
    expect(totalInventory(state.reservoirs).totals.h2o).toBe(10 + 7 - 3);
    expect(netExternalTransfers(state.ledger)).toEqual({ h2o: 4 });
    const audit = auditSubstanceConservation(catalog, state.ledger, before, state.reservoirs);
    expect(audit.balanced).toBe(true);
  });

  it('элементный баланс: внешний вход учитывается по элементам', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 'in2', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 10, basis: 'amount' }
    });
    const applied = applyFlux(ledger, before, 'in2');
    const audit = auditElementConservation(catalog, applied.ledger, before, applied.reservoirs);
    expect(audit.balanced).toBe(true);
    expect(audit.excludedSpecies).toEqual([]);
  });

  it('зарядовый баланс: система с нейтральными видами остаётся нейтральной', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 't2', kind: 'internal_transfer', from: 'atm', to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 5, basis: 'amount' }
    });
    const applied = applyFlux(ledger, before, 't2');
    const audit = auditChargeConservation(catalog, applied.ledger, before, applied.reservoirs);
    expect(audit.balanced).toBe(true);
  });
});

describe('Stage 4.1.1 FluxLedger: энергетические потоки физически применяются', () => {
  it('внутренний перенос РЕАЛЬНО перемещает storedJ (Issue 4)', () => {
    let ledger = createFluxLedger();
    const before = energyFixture(100, 30);
    ledger = registerFlux(ledger, {
      id: 'et1', kind: 'internal_transfer', from: 'r1', to: 'r2',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 30 }
    });
    const state = applyFlux(ledger, before, 'et1');
    expect(state.reservoirs['r1'].energy?.storedJ).toBe(70);
    expect(state.reservoirs['r2'].energy?.storedJ).toBe(60);
    // суммарный запас системы не изменился
    const audit = auditEnergyConservation(state.ledger, before, state.reservoirs);
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('внешний вход энергии увеличивает запас ровно на переданную энергию', () => {
    let ledger = createFluxLedger();
    const before = energyFixture(100, 30);
    ledger = registerFlux(ledger, {
      id: 'ex1', kind: 'external_input', from: EXTERNAL, to: 'r1',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 50 }
    });
    const applied = applyFlux(ledger, before, 'ex1');
    expect(applied.reservoirs['r1'].energy?.storedJ).toBe(150);
    expect(auditEnergyConservation(applied.ledger, before, applied.reservoirs).balanced).toBe(true);
  });

  it('внешний выход энергии уменьшает запас; нехватка запаса запрещена', () => {
    let ledger = createFluxLedger();
    const before = energyFixture(100, 30);
    ledger = registerFlux(ledger, {
      id: 'out1', kind: 'external_output', from: 'r1', to: EXTERNAL,
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 40 }
    });
    const applied = applyFlux(ledger, before, 'out1');
    expect(applied.reservoirs['r1'].energy?.storedJ).toBe(60);
    // изъять больше, чем есть: ошибка insufficient_energy, не отрицательный запас
    let ledger2 = createFluxLedger();
    ledger2 = registerFlux(ledger2, {
      id: 'out2', kind: 'external_output', from: 'r1', to: EXTERNAL,
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 200 }
    });
    try {
      applyFlux(ledger2, before, 'out2');
      expect.unreachable('изъятие сверх запаса должно быть отклонено');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('insufficient_energy');
    }
  });

  it('повторное применение энергетического потока запрещено', () => {
    let ledger = createFluxLedger();
    const before = energyFixture(100, 30);
    ledger = registerFlux(ledger, {
      id: 'dup-e', kind: 'internal_transfer', from: 'r1', to: 'r2',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 10 }
    });
    const first = applyFlux(ledger, before, 'dup-e');
    try {
      applyFlux(first.ledger, first.reservoirs, 'dup-e');
      expect.unreachable('повторное применение должно быть отклонено');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('already_applied');
    }
  });

  it('отмена энергетического потока возвращает энергию', () => {
    let ledger = createFluxLedger();
    const before = energyFixture(100, 30);
    ledger = registerFlux(ledger, {
      id: 'rev-e', kind: 'internal_transfer', from: 'r1', to: 'r2',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 30 }
    });
    const applied = applyFlux(ledger, before, 'rev-e');
    expect(applied.reservoirs['r1'].energy?.storedJ).toBe(70);
    const reverted = revertFlux(applied.ledger, applied.reservoirs, 'rev-e');
    expect(reverted.ledger.records[0].status).toBe('reverted');
    expect(reverted.reservoirs['r1'].energy?.storedJ).toBe(100);
    expect(reverted.reservoirs['r2'].energy?.storedJ).toBe(30);
  });

  it('unknown storedJ не подменяется нулём: ошибка unknown_energy_inventory (Issue 4)', () => {
    let ledger = createFluxLedger();
    const before: Record<string, ReservoirRecord> = {
      r1: setEnergyInventory(createReservoir('r1', 'test'), { storedJ: 100, netPowerW: null, fluxW_m2: null }),
      r2: setEnergyInventory(createReservoir('r2', 'test'), { storedJ: null, netPowerW: null, fluxW_m2: null })
    };
    ledger = registerFlux(ledger, {
      id: 'unk-e', kind: 'internal_transfer', from: 'r1', to: 'r2',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 30 }
    });
    try {
      applyFlux(ledger, before, 'unk-e');
      expect.unreachable('unknown storedJ должен быть отклонён');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('unknown_energy_inventory');
    }
    // запись осталась pending, резервуары не тронуты
    expect(ledger.records[0].status).toBe('pending');
    expect(before['r1'].energy?.storedJ).toBe(100);
    expect(before['r2'].energy?.storedJ).toBe(null);
  });

  it('отсутствие энергетического инвентаря — тоже unknown_energy_inventory (Issue 3)', () => {
    let ledger = createFluxLedger();
    const before: Record<string, ReservoirRecord> = {
      r1: setEnergyInventory(createReservoir('r1', 'test'), { storedJ: 100, netPowerW: null, fluxW_m2: null }),
      r2: createReservoir('r2', 'test')
    };
    ledger = registerFlux(ledger, {
      id: 'no-inv-e', kind: 'internal_transfer', from: 'r1', to: 'r2',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 30 }
    });
    try {
      applyFlux(ledger, before, 'no-inv-e');
      expect.unreachable('отсутствие инвентаря должно быть отклонено');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('unknown_energy_inventory');
    }
  });

  it('аудит энергии при неизвестном запасе: not_verifiable, а не «сбалансировано»', () => {
    const ledger = createFluxLedger();
    const before: Record<string, ReservoirRecord> = {
      r1: setEnergyInventory(createReservoir('r1', 'test'), { storedJ: 100, netPowerW: null, fluxW_m2: null }),
      r2: setEnergyInventory(createReservoir('r2', 'test'), { storedJ: null, netPowerW: null, fluxW_m2: null })
    };
    const audit = auditEnergyConservation(ledger, before, before);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(audit.exclusions.length).toBeGreaterThan(0);
  });

  it('расхождение энергетического аудита обнаруживается', () => {
    let ledger = createFluxLedger();
    const before = energyFixture(100, 30);
    ledger = registerFlux(ledger, {
      id: 'w-e', kind: 'internal_transfer', from: 'r1', to: 'r2',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 30 }
    });
    const applied = applyFlux(ledger, before, 'w-e');
    // «после» с неверным итогом (70 + 70 = 140 вместо 130)
    const wrongAfter = energyFixture(70, 70);
    const audit = auditEnergyConservation(applied.ledger, before, wrongAfter);
    expect(audit.status).toBe('imbalanced');
    expect(audit.balanced).toBe(false);
    expect(audit.discrepancies.length).toBe(1);
    expect(audit.discrepancies[0].key).toBe('energy');
  });
});

describe('Stage 4.1.1 FluxLedger: применение вещества без молчаливых обходов', () => {
  it('поток к резервуару без инвентаря не создаёт инвентарь молча (Issue 3)', () => {
    let ledger = createFluxLedger();
    const before: Record<string, ReservoirRecord> = {
      atm: setMaterialInventory(createReservoir('atm', 'atmosphere'), 'amount', { co2: 100 }),
      bare: createReservoir('bare', 'crust')
    };
    ledger = registerFlux(ledger, {
      id: 'to-bare', kind: 'internal_transfer', from: 'atm', to: 'bare',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 10, basis: 'amount' }
    });
    try {
      applyFlux(ledger, before, 'to-bare');
      expect.unreachable('отсутствие инвентаря должно быть отклонено');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('unknown_inventory');
    }
    expect(before['bare'].material).toBeUndefined();
    expect(ledger.records[0].status).toBe('pending');
  });

  it('несовместимое основание потока и инвентаря: incompatible_basis', () => {
    let ledger = createFluxLedger();
    const massReservoirs = {
      atm: setMaterialInventory(createReservoir('atm', 'atmosphere'), 'mass', { co2: 4.4 })
    };
    ledger = registerFlux(ledger, {
      id: 'mix', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' }
    });
    try {
      applyFlux(ledger, massReservoirs, 'mix');
      expect.unreachable('несовместимый basis должен быть отклонён');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('incompatible_basis');
      expect((e as FluxLedgerError).message).toContain('несовместимы');
    }
  });

  it('перенос больше имеющегося запаса невозможен (внешний выход тоже проверяется)', () => {
    let ledger = createFluxLedger();
    const reservoirs = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 'toomuch', kind: 'internal_transfer', from: 'ocean', to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1000, basis: 'amount' }
    });
    expect(() => applyFlux(ledger, reservoirs, 'toomuch')).toThrow(FluxLedgerError);
    let ledger2 = createFluxLedger();
    ledger2 = registerFlux(ledger2, {
      id: 'out-too-much', kind: 'external_output', from: 'ocean', to: EXTERNAL,
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 999, basis: 'amount' }
    });
    expect(() => applyFlux(ledger2, reservoirs, 'out-too-much')).toThrow(FluxLedgerError);
  });

  it('несуществующий резервуар обнаруживается', () => {
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'ghost', kind: 'internal_transfer', from: 'atm', to: 'nonexistent',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' }
    });
    // регистрация допускает запись (резервуары поставляются отдельно),
    // но применение и аудит ссылок её отвергают
    expect(() => applyFlux(ledger, reservoirsFixture(), 'ghost')).toThrow(FluxLedgerError);
    const problems = validateLedgerReferences(ledger, reservoirsFixture());
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('nonexistent'))).toBe(true);
  });

  it('totalInventory не смешивает разные основания', () => {
    const mixed = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2: 1 }),
      b: setMaterialInventory(createReservoir('b', 'x'), 'mass', { co2: 1 })
    };
    expect(() => totalInventory(mixed)).toThrow(FluxLedgerError);
  });
});

describe('Stage 4.1 FluxLedger: идемпотентность и отмена (вещество)', () => {
  it('повторное применение того же потока запрещено (двойного учёта нет)', () => {
    let ledger = createFluxLedger();
    const reservoirs = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 'dup', kind: 'internal_transfer', from: 'atm', to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 10, basis: 'amount' }
    });
    const first = applyFlux(ledger, reservoirs, 'dup');
    try {
      applyFlux(first.ledger, first.reservoirs, 'dup');
      expect.unreachable('повторное применение должно быть отклонено');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('already_applied');
    }
  });

  it('отмена восстанавливает инвентарь и сохраняет историю', () => {
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 'rev', kind: 'internal_transfer', from: 'atm', to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 10, basis: 'amount' }
    });
    const applied = applyFlux(ledger, before, 'rev');
    const reverted = revertFlux(applied.ledger, applied.reservoirs, 'rev');
    expect(reverted.ledger.records[0].status).toBe('reverted');
    expect(getAmount(reverted.reservoirs['atm'], 'co2')).toBe(100);
    expect(getAmount(reverted.reservoirs['ocean'], 'co2')).toBe(20);
    // повторная отмена и повторное применение отменённого запрещены
    expect(() => revertFlux(reverted.ledger, reverted.reservoirs, 'rev')).toThrow(FluxLedgerError);
    expect(() => applyFlux(reverted.ledger, reverted.reservoirs, 'rev')).toThrow(FluxLedgerError);
  });

  it('отменять неприменённый поток нельзя', () => {
    let ledger = createFluxLedger();
    ledger = registerFlux(ledger, {
      id: 'pending1', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' }
    });
    try {
      revertFlux(ledger, reservoirsFixture(), 'pending1');
      expect.unreachable('отмена pending должна быть отклонена');
    } catch (e) {
      expect((e as FluxLedgerError).code).toBe('not_applied');
    }
  });
});

describe('Stage 4.1.1 FluxLedger: basis-aware аудиты (mass → mol по видам)', () => {
  it('1 моль CO2 (amount) = 0.044 кг CO2 (mass): элементный баланс сходится', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2: 1 })
    };
    const after: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'mass', { co2: 0.044 })
    };
    const ledger = createFluxLedger();
    const audit = auditElementConservation(catalog, ledger, before, after);
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('смешение mol и mol/m² в одном аудите: not_verifiable «смешение оснований»', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2: 1 }),
      b: setMaterialInventory(createReservoir('b', 'x'), 'column_amount', { co2: 2 })
    };
    const after = before;
    const audit = auditElementConservation(catalog, createFluxLedger(), before, after);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(audit.exclusions.some((e) => e.reason.includes('смешение оснований'))).toBe(true);
  });

  it('mol/m² + mol/m² баланс сходится (один столбовой scope)', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'column_amount', { co2: 10 }),
      b: setMaterialInventory(createReservoir('b', 'x'), 'column_amount', { co2: 0 })
    };
    ledger = registerFlux(ledger, {
      id: 'col1', kind: 'internal_transfer', from: 'a', to: 'b',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 4, basis: 'column_amount' }
    });
    const applied = applyFlux(ledger, before, 'col1');
    const audit = auditSubstanceConservation(catalog, applied.ledger, before, applied.reservoirs);
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('mass без молярной массы вида: not_verifiable «молярная масса»', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'mass', { co2_nomass: 0.044 })
    };
    const audit = auditElementConservation(catalog, createFluxLedger(), before, before);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(audit.exclusions.some((e) => e.reason.includes('молярная масса'))).toBe(true);
  });

  it('оценочная (estimated) молярная масса: approximate, а не balanced', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'mass', { co2_est: 0.0445 })
    };
    const after: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2_est: 1 })
    };
    const audit = auditSubstanceConservation(catalog, createFluxLedger(), before, after);
    expect(audit.status).toBe('approximate');
    expect(audit.balanced).toBe(false);
  });

  it('концентрация без объёма: not_verifiable «объём»', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'molar_concentration', { co2: 1 })
    };
    const audit = auditElementConservation(catalog, createFluxLedger(), before, before);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.exclusions.some((e) => e.reason.includes('объём'))).toBe(true);
  });

  it('доля без общего запаса: not_verifiable «доля»', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'molar_fraction', { co2: 0.5 })
    };
    const audit = auditElementConservation(catalog, createFluxLedger(), before, before);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.exclusions.some((e) => e.reason.includes('доля'))).toBe(true);
  });

  it('arbitrary_units: not_verifiable (калибровки нет)', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'arbitrary_units', { co2: 100 })
    };
    const audit = auditSubstanceConservation(catalog, createFluxLedger(), before, before);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
  });

  it('незарегистрированный вид: excludedSpecies и not_verifiable, «balanced» запрещён (Issue 2)', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2: 1, xo: 5 })
    };
    const audit = auditElementConservation(catalog, createFluxLedger(), before, before);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(audit.excludedSpecies).toContain('xo');
  });

  it('зарядовый баланс: внешний вход иона меняет заряд ровно на z·n', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before: Record<string, ReservoirRecord> = {
      plasma: setMaterialInventory(createReservoir('plasma', 'x'), 'amount', { electron: 0 })
    };
    ledger = registerFlux(ledger, {
      id: 'e-in', kind: 'external_input', from: EXTERNAL, to: 'plasma',
      subject: { subjectType: 'substance', speciesId: 'electron', quantityKind: 'integrated', amount: 10, basis: 'amount' }
    });
    const applied = applyFlux(ledger, before, 'e-in');
    const audit = auditChargeConservation(catalog, applied.ledger, before, applied.reservoirs);
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('вещественный аудит: mass-резервуар и amount-резервуар сопоставимы через молярные массы', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2: 2 }),
      b: setMaterialInventory(createReservoir('b', 'x'), 'mass', { co2: 0 })
    };
    // внешний вход 0.044 кг CO2 = 1 моль: массовый поток сопоставим
    // с молярным инвентарём через молярную массу вида
    ledger = registerFlux(ledger, {
      id: 'm1', kind: 'external_input', from: EXTERNAL, to: 'b',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 0.044, basis: 'mass' }
    });
    const applied = applyFlux(ledger, before, 'm1');
    const audit = auditSubstanceConservation(catalog, applied.ledger, before, applied.reservoirs);
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
  });

  it('непроверяемый аудит никогда не выдаёт себя за success', () => {
    const catalog = speciesFixture();
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'arbitrary_units', { co2: 1 })
    };
    const audit = auditSubstanceConservation(catalog, createFluxLedger(), before, before);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(audit.discrepancies).toEqual([]);
  });
});

describe('Stage 4.1.1 FluxLedger: пофазовый аудит и временная область', () => {
  it('auditReservoirFluxes ловит неверного получателя при сохранении общей суммы (Issue 3)', () => {
    // Поток зарегистрирован a → b, но вещество «ушло» в c.
    // Суммарный аудит системы по-прежнему сбалансирован,
    // пофазовый — находит расхождение.
    const catalog = speciesFixture();
    const ledger: FluxLedger = {
      records: [
        {
          id: 'misplaced', kind: 'internal_transfer', from: 'a', to: 'b',
          subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 10, basis: 'amount' },
          time: null, status: 'applied'
        }
      ]
    };
    const before: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2: 100 }),
      b: setMaterialInventory(createReservoir('b', 'x'), 'amount', { co2: 0 }),
      c: setMaterialInventory(createReservoir('c', 'x'), 'amount', { co2: 0 })
    };
    const after: Record<string, ReservoirRecord> = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2: 90 }),
      b: setMaterialInventory(createReservoir('b', 'x'), 'amount', { co2: 0 }),
      c: setMaterialInventory(createReservoir('c', 'x'), 'amount', { co2: 10 })
    };
    // суммарный баланс «сходится»
    const totalAudit = auditSubstanceConservation(catalog, ledger, before, after);
    expect(totalAudit.status).toBe('balanced');
    // пофазовый — нет
    const perReservoir = auditReservoirFluxes(ledger, before, after);
    expect(perReservoir.status).toBe('imbalanced');
    expect(perReservoir.balanced).toBe(false);
    const bDiscrepancy = perReservoir.discrepancies.find((d) => d.key === 'b:co2');
    expect(bDiscrepancy).toBeDefined();
    expect(bDiscrepancy?.expected).toBe(10);
    expect(bDiscrepancy?.actual).toBe(0);
    expect(bDiscrepancy?.reservoirId).toBe('b');
  });

  it('auditReservoirFluxes подтверждает корректное применение', () => {
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 'ok1', kind: 'internal_transfer', from: 'atm', to: 'ocean',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 10, basis: 'amount' }
    });
    const applied = applyFlux(ledger, before, 'ok1');
    const perReservoir = auditReservoirFluxes(applied.ledger, before, applied.reservoirs);
    expect(perReservoir.status).toBe('balanced');
    expect(perReservoir.balanced).toBe(true);
    expect(perReservoir.discrepancies).toEqual([]);
  });

  it('временная область (after, upTo] исключает чужие шаги', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    // два внешних входа на разных шагах времени
    ledger = registerFlux(ledger, {
      id: 'early', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 5, basis: 'amount' },
      time: { segmentIndex: 0, localTimeS: 1 }
    });
    ledger = registerFlux(ledger, {
      id: 'late', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 7, basis: 'amount' },
      time: { segmentIndex: 0, localTimeS: 100 }
    });
    let state = applyFlux(ledger, before, 'early');
    state = applyFlux(state.ledger, state.reservoirs, 'late');
    // аудита без области: оба шага учтены — сбалансировано
    const fullAudit = auditSubstanceConservation(catalog, state.ledger, before, state.reservoirs);
    expect(fullAudit.status).toBe('balanced');
    // область (50, 200]: учитывается только 'late'; 'early' вне области → расхождение
    const scopedAudit = auditSubstanceConservation(catalog, state.ledger, before, state.reservoirs, {
      scope: { after: { segmentIndex: 0, localTimeS: 50 }, upTo: { segmentIndex: 0, localTimeS: 200 } }
    });
    expect(scopedAudit.status).toBe('imbalanced');
    expect(scopedAudit.discrepancies.some((d) => d.key === 'co2')).toBe(true);
    // область (0, 1]: учитывается только 'early'
    const earlyOnly = auditSubstanceConservation(catalog, state.ledger, before, state.reservoirs, {
      scope: { after: { segmentIndex: 0, localTimeS: 0 }, upTo: { segmentIndex: 0, localTimeS: 1 } }
    });
    expect(earlyOnly.status).toBe('imbalanced');
  });

  it('записи без привязки ко времени исключаются из области и перечисляются', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    // привязанный вход
    ledger = registerFlux(ledger, {
      id: 'timed', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 5, basis: 'amount' },
      time: { segmentIndex: 0, localTimeS: 10 }
    });
    // непривязанный вход
    ledger = registerFlux(ledger, {
      id: 'untimed', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 9, basis: 'amount' },
      time: null
    });
    let state = applyFlux(ledger, before, 'timed');
    state = applyFlux(state.ledger, state.reservoirs, 'untimed');
    const scoped = auditSubstanceConservation(catalog, state.ledger, before, state.reservoirs, {
      scope: { after: { segmentIndex: 0, localTimeS: 5 }, upTo: { segmentIndex: 0, localTimeS: 20 } }
    });
    expect(scoped.untimedRecords).toContain('untimed');
    // непривязанный шаг не учтён в области: 9 моль «не объяснены»
    expect(scoped.status).toBe('imbalanced');
    // includeUntimed: непривязанный шаг включён на ответственность вызывающего
    const withUntimed = auditSubstanceConservation(catalog, state.ledger, before, state.reservoirs, {
      scope: { after: { segmentIndex: 0, localTimeS: 5 }, upTo: { segmentIndex: 0, localTimeS: 20 }, includeUntimed: true }
    });
    expect(withUntimed.untimedRecords).toEqual([]);
    expect(withUntimed.status).toBe('balanced');
  });

  it('без области учитываются все записи, включая непривязанные', () => {
    const catalog = speciesFixture();
    let ledger = createFluxLedger();
    const before = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 'u2', kind: 'external_input', from: EXTERNAL, to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 9, basis: 'amount' },
      time: null
    });
    const state = applyFlux(ledger, before, 'u2');
    const audit = auditSubstanceConservation(catalog, state.ledger, before, state.reservoirs);
    expect(audit.status).toBe('balanced');
    expect(audit.untimedRecords).toEqual([]);
  });
});

describe('Stage 4.1.1 FluxLedger: validateFluxLedger (форма записей из JSON)', () => {
  const validRecord: FluxRecord = {
    id: 'ok', kind: 'external_input', from: EXTERNAL, to: 'atm',
    subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1, basis: 'amount' },
    time: { segmentIndex: 0, localTimeS: 5 }, status: 'pending'
  };

  function rawLedger(overrides: Partial<FluxRecord> | ((r: FluxRecord) => Partial<FluxRecord>)): unknown {
    const patch = typeof overrides === 'function' ? overrides(validRecord) : overrides;
    return { records: [{ ...validRecord, ...patch }] };
  }

  it('корректный реестр проходит без проблем', () => {
    const problems = validateFluxLedger(rawLedger({}));
    expect(problems).toEqual([]);
  });

  it('дублирующийся id, мусорные kind и status обнаруживаются', () => {
    expect(validateFluxLedger(rawLedger({ id: ' ' })).length).toBeGreaterThan(0);
    const dup = { records: [validRecord, { ...validRecord }] };
    expect(validateFluxLedger(dup).some((p) => p.includes('дублирующийся'))).toBe(true);
    expect(validateFluxLedger(rawLedger({ kind: 'teleport' as FluxRecord['kind'] })).length).toBeGreaterThan(0);
    expect(validateFluxLedger(rawLedger({ status: 'maybe' as FluxRecord['status'] })).length).toBeGreaterThan(0);
  });

  it('несогласованные направления from/to против kind обнаруживаются', () => {
    expect(validateFluxLedger(rawLedger({ kind: 'internal_transfer', from: EXTERNAL })).length).toBeGreaterThan(0);
    expect(validateFluxLedger(rawLedger({ kind: 'internal_transfer', from: 'atm', to: 'atm' })).length).toBeGreaterThan(0);
    expect(validateFluxLedger(rawLedger({ kind: 'external_input', from: 'atm', to: 'ocean' })).length).toBeGreaterThan(0);
    expect(validateFluxLedger(rawLedger({ kind: 'external_output', from: EXTERNAL })).length).toBeGreaterThan(0);
  });

  it('некорректный subject (нулевое количество, неизвестное основание) обнаруживается', () => {
    expect(
      validateFluxLedger(
        rawLedger({ subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 0, basis: 'amount' } })
      ).length
    ).toBeGreaterThan(0);
    expect(
      validateFluxLedger(
        rawLedger((r) => ({ subject: { ...(r.subject as object), basis: 'quarts' } as unknown as FluxRecord['subject'] }))
      ).length
    ).toBeGreaterThan(0);
    expect(
      validateFluxLedger(
        rawLedger({ subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: -5 } })
      ).length
    ).toBeGreaterThan(0);
  });

  it('некорректное time (отрицательный сегмент, NaN локального времени) обнаруживается', () => {
    expect(validateFluxLedger(rawLedger({ time: { segmentIndex: -1, localTimeS: 1 } })).length).toBeGreaterThan(0);
    expect(validateFluxLedger(rawLedger({ time: { segmentIndex: 0, localTimeS: Number.NaN } })).length).toBeGreaterThan(0);
  });

  it('ссылки на несуществующие резервуары проверяются при переданном списке', () => {
    const problems = validateFluxLedger(rawLedger({ kind: 'internal_transfer', from: 'atm', to: 'ghost' }), {
      reservoirIds: ['atm', 'ocean']
    });
    expect(problems.some((p) => p.includes('ghost'))).toBe(true);
  });
});
