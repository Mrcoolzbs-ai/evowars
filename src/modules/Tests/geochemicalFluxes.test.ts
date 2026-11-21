// ============================================
// STAGE 4.9a - Тесты фундамента геохимических потоков и element ledger
// ============================================
//
// Все численные значения скоростей в фикстурах — СИНТЕТИЧЕСКИЕ
// (`provenance.sourceName: 'synthetic test fixture'`): они проверяют
// КОНТРАКТ (конверсии, направления, provenance, исполнимость,
// сохранение элементов), а НЕ физику процессов. Реальные скорости
// Stage 4.9 добавляются только с верифицированным происхождением.

import { describe, it, expect } from 'vitest';

import {
  GEOCHEMICAL_YEAR_S,
  GEOCHEMICAL_RATE_UNIT,
  GEOCHEMICAL_INVENTORY_BASIS,
  GeochemicalFluxError,
  molPerM2YearToPerSecond,
  molPerM2SecondToPerYear,
  validateGeochemicalProcessSpec,
  validateGeochemicalProcessCatalog,
  createGeochemicalFluxPlan,
  integrateGeochemicalProcess,
  executeGeochemicalProcess,
  auditGeochemicalElements,
  parseGeochemicalProcessSpec
} from '../Core/geochemicalFluxes';
import type { GeochemicalProcessSpec, GeochemicalProcessType } from '../Core/geochemicalFluxes';
import {
  EXTERNAL,
  applyFlux,
  auditElementConservation,
  createFluxLedger,
  registerFlux
} from '../Core/fluxLedger';
import type { FluxLedger, FluxTime } from '../Core/fluxLedger';
import { createSpeciesCatalog } from '../Core/species';
import type { ScientificSpecies, SpeciesCatalog } from '../Core/species';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import {
  createReactionLedger,
  registerReaction,
  auditReactionStoichiometry
} from '../Core/reactionLedger';
import type { ReactionLedger } from '../Core/reactionLedger';
import {
  GEOCHEMICAL_PROCESS_CATALOG,
  GEOCHEMICAL_RESERVOIRS,
  GEOCHEMICAL_BOUNDARIES,
  GEOCHEMICAL_PROCESS_CATALOG_PROVENANCE,
  validateInitialGeochemicalProcessCatalog
} from '../Data/geochemicalProcessCatalog';

// ============================================
// ФИКСТУРЫ (синтетические, с явной маркировкой)
// ============================================

function makeSpecies(overrides: Partial<ScientificSpecies> = {}): ScientificSpecies {
  return {
    id: 'co2',
    formula: 'CO2',
    name: 'углекислый газ (синтетическая тест-запись)',
    elements: { C: 1, O: 2 },
    charge: 0,
    phase: 'gas',
    molarMassKgMol: 0.0440095,
    molarMassStatus: 'known',
    dataStatus: 'known',
    provenance: {
      sourceName: 'synthetic test fixture',
      recordId: 'fixture-co2',
      method: 'синтетическая запись для проверки контрактов, НЕ физические данные'
    },
    ...overrides
  };
}

function makeCatalog(): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  catalog.register(makeSpecies());
  catalog.register(makeSpecies({
    id: 'caco3',
    formula: 'CaCO3',
    elements: { Ca: 1, C: 1, O: 3 },
    molarMassKgMol: 0.1000869,
    provenance: { sourceName: 'synthetic test fixture', recordId: 'fixture-caco3', method: 'синтетическая запись' }
  }));
  catalog.register(makeSpecies({
    id: 'cao',
    formula: 'CaO',
    elements: { Ca: 1, O: 1 },
    molarMassKgMol: 0.0560774,
    provenance: { sourceName: 'synthetic test fixture', recordId: 'fixture-cao', method: 'синтетическая запись' }
  }));
  catalog.register(makeSpecies({
    id: 'c_org',
    formula: 'CH2O',
    elements: { C: 1, H: 2, O: 1 },
    molarMassKgMol: 0.030026,
    provenance: { sourceName: 'synthetic test fixture', recordId: 'fixture-c_org', method: 'синтетическая запись органики' }
  }));
  return catalog;
}

/** Стандартная тестовая обстановка: 4 резервуара, все basis column_amount. */
function makeReservoirs(): Record<string, ReservoirRecord> {
  const atmosphere = setMaterialInventory(createReservoir('atmosphere', 'gas_column'), 'column_amount', { co2: 100 });
  const ocean = setMaterialInventory(createReservoir('ocean', 'liquid_column'), 'column_amount', { co2: 50, c_org: 5 });
  const crust = setMaterialInventory(createReservoir('crust', 'solid_column'), 'column_amount', { caco3: 30, c_org: 10 });
  const mantle = setMaterialInventory(createReservoir('mantle', 'solid_column'), 'column_amount', { co2: 10000 });
  return { atmosphere, ocean, crust, mantle };
}

function makeEnv(ledger?: FluxLedger) {
  return {
    speciesCatalog: makeCatalog(),
    reservoirs: makeReservoirs(),
    ...(ledger ? { ledgerInput: ledger } : {})
  };
}

const BOUNDARY_SPACE = { id: 'space', physicalJustification: 'метеоритный приток вещества (синтетический тестовый сценарий)' } as const;

/** Синтетический процесс с ИЗВЕСТНОЙ (фиктивной) скоростью. */
function knownSpec(overrides: Partial<GeochemicalProcessSpec> = {}): GeochemicalProcessSpec {
  return {
    processId: 'geo.test.transfer',
    processType: 'volcanic_degas',
    description: 'синтетический перенос для проверки контракта (НЕ физический сценарий)',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'mantle', toReservoirId: 'atmosphere' },
    mechanism: 'transport',
    implementationStatus: 'executable',
    rate: {
      status: 'known',
      unit: GEOCHEMICAL_RATE_UNIT,
      molPerM2PerYear: 5,
      provenance: { sourceName: 'synthetic test fixture', recordId: 'fixture-rate-1', method: 'синтетическое значение, НЕ физическая скорость' }
    },
    basis: 'column_amount',
    ...overrides
  };
}

/** Синтетический процесс с НЕИЗВЕСТНОЙ скоростью (как в каталоге данных). */
function unknownSpec(overrides: Partial<GeochemicalProcessSpec> = {}): GeochemicalProcessSpec {
  return {
    processId: 'geo.test.unknown',
    processType: 'silicate_weathering',
    description: 'синтетический процесс с неподтверждённой скоростью',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' },
    mechanism: 'transport',
    implementationStatus: 'executable',
    rate: { status: 'unknown', reason: 'характеристическая скорость не подтверждена источником (синтетический тест незнания)' },
    basis: 'column_amount',
    ...overrides
  };
}

const TIME: FluxTime = { segmentIndex: 3, localTimeS: 900 };

function inventoryAmount(res: ReservoirRecord | undefined, speciesId: string): number {
  if (!res || !res.material) throw new Error('резервуар без материального инвентаря');
  return res.material.entries[speciesId] ?? 0;
}

// ============================================
// 1. КОНВЕРСИИ И КОНСТАНТЫ (сценарии 1-5)
// ============================================

describe('Stage 4.9a: конверсия единиц и константа года', () => {
  it('(1) mol/m²/year → mol/m²/s: 31557600 mol/m²/yr = 1 mol/m²/s', () => {
    expect(molPerM2YearToPerSecond(31557600)).toBe(1);
    expect(molPerM2YearToPerSecond(1)).toBe(1 / 31557600);
  });

  it('(2) обратная конверсия mol/m²/s → mol/m²/yr: 1 mol/m²/s = 31557600 mol/m²/yr', () => {
    expect(molPerM2SecondToPerYear(1)).toBe(31557600);
    // Туда-обратно без потери значения.
    const f = 42.195;
    expect(molPerM2SecondToPerYear(molPerM2YearToPerSecond(f))).toBe(f);
  });

  it('(3) константа года: 365.25 × 86400 = 31 557 600 s (ровно)', () => {
    expect(GEOCHEMICAL_YEAR_S).toBe(365.25 * 86400);
    expect(GEOCHEMICAL_YEAR_S).toBe(31557600);
  });

  it('(4) NaN и Infinity отклоняются с кодом invalid_rate', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => molPerM2YearToPerSecond(bad)).toThrow(GeochemicalFluxError);
      expect(() => molPerM2SecondToPerYear(bad)).toThrow(GeochemicalFluxError);
      try {
        molPerM2YearToPerSecond(bad);
        throw new Error('не должен был пройти');
      } catch (e) {
        expect((e as GeochemicalFluxError).code).toBe('invalid_rate');
      }
    }
  });

  it('(5) нулевая скорость валидна и конвертируется в ноль; отрицательная отклоняется', () => {
    expect(molPerM2YearToPerSecond(0)).toBe(0);
    expect(molPerM2SecondToPerYear(0)).toBe(0);
    expect(() => molPerM2YearToPerSecond(-1e-12)).toThrow(GeochemicalFluxError);
    expect(() => molPerM2SecondToPerYear(-1)).toThrow(GeochemicalFluxError);
    // Сообщение объясняет семантику направления.
    try {
      molPerM2YearToPerSecond(-5);
      throw new Error('не должен был пройти');
    } catch (e) {
      expect((e as GeochemicalFluxError).message).toContain('from/to');
    }
  });
});

// ============================================
// 2. НАПРАВЛЕНИЕ И ПЛАНИРОВАНИЕ (сценарии 6-9)
// ============================================

describe('Stage 4.9a: направление потоков (положительная скорость + явные from/to)', () => {
  it('(6) внутренний поток: положительная скорость и явные from/to', () => {
    const plan = createGeochemicalFluxPlan(knownSpec(), makeEnv());
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.candidate.kind).toBe('internal_transfer');
    expect(plan.candidate.from).toBe('mantle');
    expect(plan.candidate.to).toBe('atmosphere');
    expect(plan.candidate.rateSubject.ratePerSecond).toBe(5 / 31557600);
    expect(plan.candidate.rateSubject.ratePerSecond).toBeGreaterThan(0);
    expect(plan.ratePerYear).toBe(5);
  });

  it('(7) обратный процесс — обратное направление, а НЕ отрицательная скорость', () => {
    const forward = createGeochemicalFluxPlan(knownSpec(), makeEnv());
    const reverse = createGeochemicalFluxPlan(knownSpec({
      processId: 'geo.test.transfer.reverse',
      description: 'синтетический обратный перенос',
      direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'mantle' }
    }), makeEnv());
    if (forward.status !== 'ready' || reverse.status !== 'ready') throw new Error('планы должны быть готовыми');
    // Скорости ПОЛОЖИТЕЛЬНЫ и одинаковы; направление меняется from/to.
    expect(reverse.candidate.rateSubject.ratePerSecond).toBe(forward.candidate.rateSubject.ratePerSecond);
    expect(reverse.candidate.rateSubject.ratePerSecond).toBeGreaterThan(0);
    expect(reverse.candidate.from).toBe('atmosphere');
    expect(reverse.candidate.to).toBe('mantle');
    // Валидатор не допускает отрицательную скорость и id вида 'self'... только from/to swapping.
    expect(validateGeochemicalProcessSpec(knownSpec({
      rate: {
        status: 'known',
        unit: GEOCHEMICAL_RATE_UNIT,
        molPerM2PerYear: -1,
        provenance: { sourceName: 'synthetic test fixture', recordId: 'fixture-rate-1' }
      }
    })).length).toBeGreaterThan(0);
  });

  it('(8) внешний ввод использует EXTERNAL как from согласно FluxLedger', () => {
    const spec = knownSpec({
      processId: 'geo.test.external.in',
      direction: { kind: 'external_input', reservoirId: 'atmosphere', boundary: BOUNDARY_SPACE }
    });
    const plan = createGeochemicalFluxPlan(spec, makeEnv());
    expect(plan.status).toBe('ready');
    if (plan.status !== 'ready') return;
    expect(plan.candidate.kind).toBe('external_input');
    expect(plan.candidate.from).toBe(EXTERNAL);
    expect(plan.candidate.to).toBe('atmosphere');
    // Граница и обоснование попадают в диагностику.
    expect(plan.diagnostics.join(' ')).toContain('space');
    expect(plan.diagnostics.join(' ')).toContain('метеоритный приток');
  });

  it('(9) внешний вывод использует EXTERNAL как to согласно FluxLedger', () => {
    const spec = knownSpec({
      processId: 'geo.test.external.out',
      direction: { kind: 'external_output', reservoirId: 'ocean', boundary: { id: 'space', physicalJustification: 'потеря атмосферы при фотоиспарении (синтетический сценарий)' } }
    });
    const env = makeEnv();
    const result = executeGeochemicalProcess(spec, env, { fluxId: 'fx-out-1', durationS: 31557600, time: TIME });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.record.kind).toBe('external_output');
    expect(result.record.from).toBe('ocean');
    expect(result.record.to).toBe(EXTERNAL);
  });
});

// ============================================
// 3. ИНТЕГРАЦИЯ И ОСНОВАНИЯ (сценарии 10-13)
// ============================================

describe('Stage 4.9a: rate ≠ количество; интеграция и основание column_amount', () => {
  it('(10) rate НЕ применяется к инвентарю напрямую (rate_not_applicable ядра)', () => {
    const plan = createGeochemicalFluxPlan(knownSpec(), makeEnv());
    if (plan.status !== 'ready') throw new Error('план должен быть ready');
    // rate-субъект можно зарегистрировать, но НЕ применить.
    const ledger = registerFlux(createFluxLedger(), {
      id: 'fx-rate-direct',
      kind: plan.candidate.kind,
      from: plan.candidate.from,
      to: plan.candidate.to,
      subject: plan.candidate.rateSubject
    });
    expect(() => applyFlux(ledger, makeReservoirs(), 'fx-rate-direct')).toThrow();
    try {
      applyFlux(ledger, makeReservoirs(), 'fx-rate-direct');
    } catch (e) {
      expect((e as Error).message).toContain('rate_not_applicable');
    }
  });

  it('(11) скорость после интеграции даёт корректное integrated-количество', () => {
    const plan = createGeochemicalFluxPlan(knownSpec(), makeEnv());
    if (plan.status !== 'ready') throw new Error('план должен быть ready');
    const yearIntegral = integrateGeochemicalProcess(plan, GEOCHEMICAL_YEAR_S);
    expect(yearIntegral.integratedMolPerM2).toBeCloseTo(5, 12);
    const halfIntegral = integrateGeochemicalProcess(plan, GEOCHEMICAL_YEAR_S / 2);
    expect(halfIntegral.integratedMolPerM2).toBeCloseTo(2.5, 12);
    expect(halfIntegral.subject.quantityKind).toBe('integrated');
  });

  it('(12) основание column_amount сохраняется через план, журнал и применение', () => {
    const env = makeEnv();
    const result = executeGeochemicalProcess(knownSpec(), env, { fluxId: 'fx-basis-1', durationS: GEOCHEMICAL_YEAR_S, time: TIME });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // Basis живёт на substance-субъекте (union FluxSubject) — сужение явное.
    const subj = result.record.subject;
    expect(subj.subjectType === 'substance' ? subj.basis : undefined).toBe(GEOCHEMICAL_INVENTORY_BASIS);
    expect(result.reservoirs.atmosphere.material?.basis).toBe('column_amount');
    expect(result.reservoirs.mantle.material?.basis).toBe('column_amount');
    //mantle: 10000 → 9995; atmosphere: 100 → 105 (mol/m²)
    expect(inventoryAmount(result.reservoirs.mantle, 'co2')).toBeCloseTo(9995, 9);
    expect(inventoryAmount(result.reservoirs.atmosphere, 'co2')).toBeCloseTo(105, 9);
  });

  it('(13) смешение column_amount с amount запрещено: процесс не исполняется', () => {
    const reservoirs = makeReservoirs();
    const oceanAmount = setMaterialInventory(createReservoir('ocean', 'liquid'), 'amount', { co2: 1e20, c_org: 1e18 });
    const env = { speciesCatalog: makeCatalog(), reservoirs: { ...reservoirs, ocean: oceanAmount } };
    // createGeochemicalFluxPlan бросает несовместимое основание (fail-closed).
    expect(() => createGeochemicalFluxPlan(knownSpec({
      direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' }
    }), env)).toThrow(GeochemicalFluxError);
    try {
      createGeochemicalFluxPlan(knownSpec({
        direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' }
      }), env);
    } catch (e) {
      expect((e as GeochemicalFluxError).code).toBe('incompatible_basis');
    }
    // Автоподсчёт полного запаса (1e20 mol → mol/m²) НЕ выполняется.
    expect(() => createGeochemicalFluxPlan(knownSpec({
      processId: 'geo.test.exchange2',
      direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'atmosphere' }
    }), env)).toThrow(GeochemicalFluxError);
  });
});

// ============================================
// 4. НЕИЗВЕСТНЫЕ ДАННЫЕ И ВАЛИДАЦИЯ (сценарии 14-20)
// ============================================

describe('Stage 4.9a: unknown-семантика и fail-closed валидация', () => {
  it('(14) процесс с неизвестной скоростью не получает фиктивную скорость и не создаёт записи', () => {
    const plan = createGeochemicalFluxPlan(unknownSpec(), makeEnv());
    expect(plan.status).toBe('unknown_rate');
    if (plan.status !== 'unknown_rate') return;
    expect(plan.reason.length).toBeGreaterThan(0);
    const env = makeEnv();
    const snapshot = JSON.stringify(env.reservoirs);
    const result = executeGeochemicalProcess(unknownSpec(), env, { fluxId: 'fx-unknown-1', durationS: GEOCHEMICAL_YEAR_S });
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reason).toContain('неизвестна');
    expect(result.error).toBeNull();
    // Ни записей, ни изменений резерратов нет.
    expect(env.reservoirs).toEqual(JSON.parse(snapshot));
    expect(env.ledgerInput ?? createFluxLedger()).toEqual(createFluxLedger());
  });

  it('(15) unknown без объяснения отклоняется валидатором', () => {
    const errors = validateGeochemicalProcessSpec(unknownSpec({
      rate: { status: 'unknown', reason: '   ' }
    }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('причину');
    // unknown с числовым значением противоречив — отклоняется.
    expect(validateGeochemicalProcessSpec(unknownSpec({
      rate: { status: 'unknown', reason: 'нет данных', ...({ molPerM2PerYear: 12 } as object) }
    })).join(' ')).toContain('не может нести числовое значение');
    // parseGeochemicalProcessSpec честно возвращает invalid.
    const parsed = parseGeochemicalProcessSpec(unknownSpec({ rate: { status: 'unknown', reason: '' } }));
    expect(parsed.status).toBe('invalid');
  });

  it('(16) числовая скорость без provenance отклоняется', () => {
    const errors = validateGeochemicalProcessSpec(knownSpec({
      rate: { status: 'known', unit: GEOCHEMICAL_RATE_UNIT, molPerM2PerYear: 10, provenance: { note: 'без источника' } }
    }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('источник');
    // Неконечные значения тоже отбрасываются валидатором формы.
    expect(validateGeochemicalProcessSpec(knownSpec({
      rate: { status: 'known', unit: GEOCHEMICAL_RATE_UNIT, molPerM2PerYear: Number.POSITIVE_INFINITY, provenance: { sourceName: 'x' } }
    })).join(' ')).toContain('конечным числом');
    // План не строится (not_executable), исполнение возвращает not_applied.
    const plan = createGeochemicalFluxPlan(knownSpec({
      rate: { status: 'known', unit: GEOCHEMICAL_RATE_UNIT, molPerM2PerYear: 10, provenance: {} }
    }) as unknown as GeochemicalProcessSpec, makeEnv());
    expect(plan.status).toBe('not_executable');
  });

  it('(17) неизвестное вещество блокирует исполнение (unknown_substance)', () => {
    const env = makeEnv();
    const snapshotRes = env.reservoirs;
    expect(() => createGeochemicalFluxPlan(knownSpec({ speciesId: 'ch4x' }), env)).toThrow(GeochemicalFluxError);
    try {
      createGeochemicalFluxPlan(knownSpec({ speciesId: 'ch4x' }), env);
    } catch (e) {
      expect((e as GeochemicalFluxError).code).toBe('unknown_substance');
    }
    const result = executeGeochemicalProcess(knownSpec({ speciesId: 'ch4x' }), env, { fluxId: 'fx-badspecies', durationS: 1000 });
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return; // сужение union для tsc
    expect(result.error).toContain('unknown_substance');
    // Состояние мира не изменилось (тот же объект, без мутирования).
    expect(env.reservoirs).toBe(snapshotRes);
  });

  it('(18) неизвестный резервуар блокирует исполнение (unknown_reservoir), резервуар НЕ создаётся', () => {
    const env = makeEnv();
    const result = executeGeochemicalProcess(knownSpec({
      direction: { kind: 'internal_transfer', fromReservoirId: 'mantle', toReservoirId: 'lithosphere' }
    }), env, { fluxId: 'fx-badres', durationS: 1000 });
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return; // сужение union для tsc
    expect(result.error).toContain('unknown_reservoir');
    expect(env.reservoirs.lithosphere).toBeUndefined();
    expect(() => createGeochemicalFluxPlan(knownSpec({
      direction: { kind: 'external_input', reservoirId: 'biosphere', boundary: BOUNDARY_SPACE }
    }), env)).toThrow(GeochemicalFluxError);
  });

  it('(19) дубликаты идентификаторов в каталоге отклоняются', () => {
    const errors = validateGeochemicalProcessCatalog([
      knownSpec() as unknown as Record<string, unknown>,
      knownSpec({ description: 'дубликат id' }) as unknown as Record<string, unknown>
    ]);
    expect(errors.join(' ')).toContain('дубликат');
    // Уникальные описания — чисто.
    expect(validateGeochemicalProcessCatalog([
      knownSpec() as unknown as Record<string, unknown>,
      knownSpec({ processId: 'geo.test.other', description: 'иной id' }) as unknown as Record<string, unknown>
    ])).toEqual([]);
  });

  it('(20) неизвестный процесс остаётся ЯВНО неисполняемым (не «тихий» пропуск)', () => {
    const env = makeEnv();
    const resBefore = env.reservoirs;
    const result = executeGeochemicalProcess(unknownSpec(), env, { fluxId: 'fx-unknown-2', durationS: GEOCHEMICAL_YEAR_S, time: TIME });
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return; // сужение union для tsc
    expect(result.reason).toContain('неизвестна');
    // В записях потока ничего нет, резервуары не изменены.
    expect(resBefore).toBe(env.reservoirs);
    const audit = auditGeochemicalElements(env.speciesCatalog, env.ledgerInput ?? createFluxLedger(), resBefore, env.reservoirs);
    expect(audit.status).toBe('balanced'); // изменений не было — баланс честно сохранён
  });
});

// ============================================
// 5. ЭЛЕМЕНТНЫЙ АУДИТ (сценарии 21-24)
// ============================================

describe('Stage 4.9a: геохимический адаптер element conservation', () => {
  it('(21) внутренний перенос сохраняет суммарный элемент (balanced, residual = 0)', () => {
    const env = makeEnv();
    const before = env.reservoirs;
    const result = executeGeochemicalProcess(knownSpec(), env, { fluxId: 'fx-balance-1', durationS: GEOCHEMICAL_YEAR_S, time: TIME });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const audit = auditGeochemicalElements(env.speciesCatalog, result.ledger, before, result.reservoirs);
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
    expect(audit.discrepancies).toEqual([]);
    // Повэлементная диагностика по C и O: до + netExternal − после = 0.
    const byElement = new Map(audit.elementDiagnostics.map((d) => [d.element, d]));
    // C до: атмосфера 100 + океан (50+5) + кора (30+10) + мантия 10000 = 10195 атомов C.
    expect(byElement.get('C')?.beforeCount).toBe(10195);
    expect(byElement.get('C')?.residual).toBeCloseTo(0, 9);
    expect(byElement.get('O')?.residual).toBeCloseTo(0, 9);
    // Официальный вердикт согласован с ядром: тот же статус у auditElementConservation.
    const officialDirect = auditElementConservation(env.speciesCatalog, result.ledger, before, result.reservoirs);
    expect(officialDirect.status).toBe(audit.status);
  });

  it('(22) внешний ввод корректно меняет элементный итог системы (и без него — imbalanced)', () => {
    const env = makeEnv();
    const before = env.reservoirs;
    const spec = knownSpec({
      processId: 'geo.test.external.in2',
      direction: { kind: 'external_input', reservoirId: 'atmosphere', boundary: BOUNDARY_SPACE }
    });
    const result = executeGeochemicalProcess(spec, env, { fluxId: 'fx-ext-in', durationS: GEOCHEMICAL_YEAR_S, time: TIME });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // С учётом внешнего переноса система сбалансирована,
    // но чистый ВНЕШНИЙ вклад C > 0 (система выросла).
    const audit = auditGeochemicalElements(env.speciesCatalog, result.ledger, before, result.reservoirs);
    expect(audit.status).toBe('balanced');
    let c = audit.elementDiagnostics.find((d) => d.element === 'C');
    expect(c).toBeDefined();
    expect(c ? c.netExternalCount : undefined).toBeCloseTo(5, 9);
    expect(c ? c.afterCount - c.beforeCount : undefined).toBeCloseTo(5, 9);
    // А БЕЗ учёта внешнего потока (пустой журнал) аудит обязан найти дисбаланс:
    // внешний источник НЕ маскируется под внутренний перенос.
    const auditNoLedger = auditGeochemicalElements(env.speciesCatalog, createFluxLedger(), before, result.reservoirs);
    expect(auditNoLedger.status).toBe('imbalanced');
    expect(auditNoLedger.discrepancies.some((d) => d.key === 'C')).toBe(true);
  });

  it('(23) неполный состав вида даёт not_verifiable (не balanced)', () => {
    const catalog = makeCatalog();
    const before = makeReservoirs();
    const after = makeReservoirs();
    // Флюкс вида с НЕИЗВЕСТНЫМ составом применён «мимо» каталога видов
    // (напрямую контрактом FluxLedger): состав не выдумывается.
    const ledger = registerFlux(createFluxLedger(), {
      id: 'fx-mystery',
      kind: 'external_input',
      from: EXTERNAL,
      to: 'atmosphere',
      subject: { subjectType: 'substance', speciesId: 'mystery_x', quantityKind: 'integrated', amount: 7, basis: 'column_amount' }
    });
    const applied = applyFlux(ledger, after, 'fx-mystery');
    const audit = auditGeochemicalElements(catalog, applied.ledger, before, applied.reservoirs);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.balanced).toBe(false);
    expect(audit.excludedSpecies).toContain('mystery_x');
    // Диагностика по элементам существует только для ИЗВЕСТНЫХ видов (residual 0);
    // элементы вида mystery_x НЕ входят в диагностику — состав неизвестен и не выдумывается.
    expect(audit.elementDiagnostics.length).toBeGreaterThan(0);
    for (const d of audit.elementDiagnostics) {
      expect(d.residual).toBeCloseTo(0, 9);
    }
    // Что подтверждаю: непосредственно в ядре тот же вердикт.
    expect(auditElementConservation(catalog, applied.ledger, before, applied.reservoirs).status).toBe('not_verifiable');
  });

  it('(24) реальное нарушение баланса обнаруживается как imbalanced', () => {
    const catalog = makeCatalog();
    const before = makeReservoirs();
    const after = makeReservoirs();
    // «Испорченное» состояние: лишний CO2 в океане без потока-объяснения.
    const spoiled = setMaterialInventory(createReservoir('ocean', 'liquid_column'), 'column_amount', {
      co2: 50 + 3.5, c_org: 5
    });
    const afterSpoiled = { ...after, ocean: spoiled };
    const audit = auditGeochemicalElements(catalog, createFluxLedger(), before, afterSpoiled);
    expect(audit.status).toBe('imbalanced');
    expect(audit.balanced).toBe(false);
    expect(audit.discrepancies.length).toBeGreaterThan(0);
    const byElement = new Map(audit.discrepancies.map((d) => [d.key, d]));
    expect(byElement.get('C')?.expected).toBeCloseTo(byElement.get('C')!.actual - 3.5, 12);
  });
});

// ============================================
// 6. ДЕТЕРМИНИЗМ, ИММУТАБЕЛЬНОСТЬ, КАТАЛОГ, СЕРИАЛИЗАЦИЯ (сценарии 25-28)
// ============================================

describe('Stage 4.9a: детерминизм, иммутабельность, каталог, сериализация', () => {
  it('(25) идентичный запуск даёт детерминированный результат', () => {
    const run = () => {
      const env = makeEnv();
      const result = executeGeochemicalProcess(knownSpec(), env, { fluxId: 'fx-det', durationS: GEOCHEMICAL_YEAR_S, time: TIME });
      expect(result.status).toBe('applied');
      if (result.status !== 'applied') throw new Error('applied expected');
      expect(result.record.time).toBe(TIME);
      return JSON.stringify({ ledger: result.ledger, reservoirs: result.reservoirs, record: result.record });
    };
    expect(run()).toBe(run());
  });

  it('(26) ошибка применения НЕ мутирует исходное состояние (нехватка вещества)', () => {
    const catalog = makeCatalog();
    const mantleEmpty = setMaterialInventory(createReservoir('mantle', 'solid_column'), 'column_amount', { co2: 0 });
    const reservoirs: Record<string, ReservoirRecord> = { ...makeReservoirs(), mantle: mantleEmpty };
    const ledger = createFluxLedger();
    const env = { speciesCatalog: catalog, reservoirs, ledgerInput: ledger };
    const result = executeGeochemicalProcess(knownSpec(), env, { fluxId: 'fx-insuf', durationS: GEOCHEMICAL_YEAR_S, time: TIME });
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return; // сужение union для tsc
    expect(result.error).toContain('требует');
    // Исходные резервуары и журнал не тронуты.
    expect(inventoryAmount(env.reservoirs.atmosphere, 'co2')).toBe(100);
    expect(inventoryAmount(env.reservoirs.mantle, 'co2')).toBe(0);
    expect(env.ledgerInput.records.length).toBe(0);
  });

  it('(27) начальный каталог проходит runtime-валидацию (данные, не логика)', () => {
    expect(validateInitialGeochemicalProcessCatalog()).toEqual([]);
    expect(GEOCHEMICAL_PROCESS_CATALOG.length).toBeGreaterThanOrEqual(10);
    // Все скорости каталога — unknown с обязательной причиной; никаких чисел.
    for (const entry of GEOCHEMICAL_PROCESS_CATALOG) {
      expect(entry.rate.status).toBe('unknown');
      expect(entry.rate.status === 'unknown' ? entry.rate.reason.length : 0).toBeGreaterThan(0);
      expect(entry.basis).toBe('column_amount');
      expect(entry.direction.kind === 'internal_transfer' ? entry.direction.fromReservoirId : entry.direction.reservoirId).not.toBe(EXTERNAL);
    }
    // Требуемые типы процессов Stage 4.9 покрыты; резервуары и границы описаны.
    const types = new Set(GEOCHEMICAL_PROCESS_CATALOG.map((p) => p.processType));
    for (const required of ['volcanic_degas', 'metamorphic_degas', 'silicate_weathering', 'carbonate_weathering', 'dissolution', 'precipitation', 'ocean_atmosphere_exchange', 'organic_carbon_burial', 'oxidation', 'subduction']) {
      expect(types.has(required as GeochemicalProcessType)).toBe(true);
    }
    expect(GEOCHEMICAL_RESERVOIRS.map((r) => r.id)).toEqual(['atmosphere', 'ocean', 'crust', 'mantle']);
    expect(GEOCHEMICAL_BOUNDARIES.length).toBe(2);
    expect(GEOCHEMICAL_PROCESS_CATALOG_PROVENANCE.sourceId.length).toBeGreaterThan(0);
    // Никакой процесс каталога не знает численной скорости:
    // исполнение каталога возвращает not_applied для всех записей.
    const env = makeEnv();
    for (const entry of GEOCHEMICAL_PROCESS_CATALOG) {
      const result = executeGeochemicalProcess(entry as GeochemicalProcessSpec, env, { fluxId: `fx-cat-${entry.processId}`, durationS: GEOCHEMICAL_YEAR_S, time: TIME });
      expect(result.status).toBe('not_applied');
    }
  });

  it('(28) сериализация/десериализация сохраняет семантику неизвестных данных', () => {
    const spec = unknownSpec({
      processId: 'geo.test.serialization',
      rate: { status: 'unknown', reason: 'скорость дегазации не подтверждена источником' }
    });
    const json = JSON.parse(JSON.stringify(spec)) as unknown;
    const parsed = parseGeochemicalProcessSpec(json);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.spec.rate.status).toBe('unknown');
    expect(parsed.spec.rate.status === 'unknown' ? parsed.spec.rate.reason : '').toBe('скорость дегазации не подтверждена источником');
    expect(parsed.spec.rate.status === 'unknown' ? ('molPerM2PerYear' in parsed.spec.rate ? parsed.spec.rate.molPerM2PerYear : undefined) : 0).toBeUndefined();
    // Известная скорость переживает обход JSON вместе с provenance.
    const knownParsed = parseGeochemicalProcessSpec(JSON.parse(JSON.stringify(knownSpec())));
    expect(knownParsed.status).toBe('ok');
    if (knownParsed.status !== 'ok') return;
    expect(knownParsed.spec.rate.status).toBe('known');
    expect(knownParsed.spec.rate.status === 'known' ? knownParsed.spec.rate.provenance.sourceName : '').toBe('synthetic test fixture');
    // Нарушенная сериализация (unknown с числом) отклоняется, а не «чинится».
    const corrupted = JSON.parse(JSON.stringify(unknownSpec())) as Record<string, unknown>;
    (corrupted.rate as Record<string, unknown>)['molPerM2PerYear'] = 42;
    expect(parseGeochemicalProcessSpec(corrupted).status).toBe('invalid');
  });
});

// ============================================
// 7. ДОП. СЦЕНАРИИ: реакция ≠ перенос; также conversions neg branch
// ============================================

describe('Stage 4.9a (допол.): разделение ReactionLedger и FluxLedger', () => {
  it('(д1) реакция фиксируется ReactionLedger, перенос — FluxLedger (несмешиваемо)', () => {
    const catalog = makeCatalog();
    // Синтетическая сбалансированная реакция карбонизации (превращение):
    // CaO + CO2 → CaCO3 в резервуаре crust. Проверяется через
    // auditReactionStoichiometry, а НЕ через элементный баланс потоков.
    const reactionLedger = registerReaction(createReactionLedger(), {
      id: 'rx-carbonation-1',
      reactionId: 'geo.test.carbonation',
      reactants: [
        { reservoirId: 'crust', speciesId: 'cao', coefficient: 1 },
        { reservoirId: 'crust', speciesId: 'co2', coefficient: 1 }
      ],
      products: [{ reservoirId: 'crust', speciesId: 'caco3', coefficient: 1 }],
      extent: 1,
      extentBasis: 'column_amount',
      time: TIME
    });
    expect(reactionLedger.records.length).toBe(1);
    const stoich = auditReactionStoichiometry(reactionLedger.records[0], catalog);
    expect(stoich.status).toBe('balanced');
    let badLedger: ReactionLedger = createReactionLedger();
    badLedger = registerReaction(badLedger, {
      id: 'rx-unbalanced-1',
      reactionId: 'geo.test.unbalanced',
      // 1 CaO + 1 CO2 → 1 CaCO3 + лишний O2 (нестехиометрично).
      reactants: [
        { reservoirId: 'crust', speciesId: 'cao', coefficient: 1 },
        { reservoirId: 'crust', speciesId: 'co2', coefficient: 1 }
      ],
      products: [
        { reservoirId: 'crust', speciesId: 'caco3', coefficient: 1 },
        { reservoirId: 'crust', speciesId: 'co2', coefficient: 1 }
      ],
      extent: 1,
      extentBasis: 'column_amount',
      time: TIME
    });
    // Окислитель: co2 как продукт лишний — расхождение по C и O.
    const bad = auditReactionStoichiometry(badLedger.records[0], catalog);
    expect(bad.status === 'invalid' || bad.status === 'not_verifiable' || bad.status === 'imbalanced').toBe(true);

    // Перенос вещества между резервуарами при этом фиксируется
    // ТОЛЬКО FluxLedger-записью (kind internal_transfer), а не реакцией.
    const env = makeEnv();
    const res = executeGeochemicalProcess(knownSpec({
      processId: 'geo.test.exchange3',
      processType: 'other',
      direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'atmosphere' }
    }), env, { fluxId: 'fx-rxt-1', durationS: 1000, time: TIME });
    expect(res.status).toBe('applied');
    if (res.status !== 'applied') return;
    expect(res.record.kind).toBe('internal_transfer');
    expect(res.ledger.records[0].subject.subjectType).toBe('substance');
  });
});

