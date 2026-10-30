// ============================================
// STAGE 4.1 - Тесты учёта потоков: внутренние/внешние переносы,
// rate против integrated, балансы, идемпотентность
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
  validateLedgerReferences,
  FluxLedgerError
} from '../Core/fluxLedger';
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
  return catalog;
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
    };
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
    const audit = auditSubstanceConservation(applied.ledger, before, applied.reservoirs);
    expect(audit.balanced).toBe(true);
  });

  it('внешний вход увеличивает, внешний выход уменьшает общий инвентарь', () => {
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
    const audit = auditSubstanceConservation(state.ledger, before, state.reservoirs);
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

  it('энергетический баланс: запас меняется только внешними потоками', () => {
    // внутренний перенос энергии не меняет суммарный запас системы
    let ledger = createFluxLedger();
    const before = {
      r1: setEnergyInventory(createReservoir('r1', 'test'), { storedJ: 100, netPowerW: null, fluxW_m2: null }),
      r2: setEnergyInventory(createReservoir('r2', 'test'), { storedJ: 30, netPowerW: null, fluxW_m2: null })
    };
    ledger = registerFlux(ledger, {
      id: 'et1', kind: 'internal_transfer', from: 'r1', to: 'r2',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 30 }
    });
    const state = applyFlux(ledger, before, 'et1');
    const afterInternal = {
      r1: setEnergyInventory(before['r1'], { storedJ: 70, netPowerW: null, fluxW_m2: null }),
      r2: setEnergyInventory(before['r2'], { storedJ: 60, netPowerW: null, fluxW_m2: null })
    };
    const internalAudit = auditEnergyConservation(state.ledger, before, afterInternal);
    expect(internalAudit.balanced).toBe(true);

    // внешний вход энергии увеличивает запас ровно на переданную энергию
    let ledger2 = createFluxLedger();
    ledger2 = registerFlux(ledger2, {
      id: 'ex1', kind: 'external_input', from: EXTERNAL, to: 'r1',
      subject: { subjectType: 'energy', quantityKind: 'integrated', energyJ: 50 }
    });
    const after2 = {
      r1: setEnergyInventory(before['r1'], { storedJ: 150, netPowerW: null, fluxW_m2: null }),
      r2: setEnergyInventory(before['r2'], { storedJ: 30, netPowerW: null, fluxW_m2: null })
    };
    const applied2 = applyFlux(ledger2, before, 'ex1');
    expect(auditEnergyConservation(applied2.ledger, before, after2).balanced).toBe(true);
    // расхождение обнаруживается аудитом
    const wrongAfter = {
      r1: setEnergyInventory(before['r1'], { storedJ: 160, netPowerW: null, fluxW_m2: null }),
      r2: setEnergyInventory(before['r2'], { storedJ: 30, netPowerW: null, fluxW_m2: null })
    };
    expect(auditEnergyConservation(applied2.ledger, before, wrongAfter).balanced).toBe(false);
  });
});

describe('Stage 4.1 FluxLedger: идемпотентность и отмена', () => {
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

describe('Stage 4.1 FluxLedger: защита от некорректных состояний', () => {
  it('несовместимые основания потока и резервуара обнаруживаются', () => {
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
      expect((e as FluxLedgerError).message).toContain('несовместимы');
    }
  });

  it('перенос больше имеющегося запаса невозможен', () => {
    let ledger = createFluxLedger();
    const reservoirs = reservoirsFixture();
    ledger = registerFlux(ledger, {
      id: 'toomuch', kind: 'internal_transfer', from: 'ocean', to: 'atm',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 1000, basis: 'amount' }
    });
    expect(() => applyFlux(ledger, reservoirs, 'toomuch')).toThrow(FluxLedgerError);
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
    expect(problems[0]).toContain('nonexistent');
  });

  it('totalInventory не смешивает разные основания', () => {
    const mixed = {
      a: setMaterialInventory(createReservoir('a', 'x'), 'amount', { co2: 1 }),
      b: setMaterialInventory(createReservoir('b', 'x'), 'mass', { co2: 1 })
    };
    expect(() => totalInventory(mixed)).toThrow(FluxLedgerError);
  });
});
