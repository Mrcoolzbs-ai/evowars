// ============================================
// STAGE 4.9a.1 - КОРРЕКТИРУЮЩАЯ РЕВИЗИЯ ГЕОХИМИЧЕСКОГО ФУНДАМЕНТА
// ============================================
//
// Регрессионные тесты исправлений Stage 4.9a.1 (проблемы A, B, C и
// разделы 3-5 промпта ревизии). Проверяются ПРОИЗВОДСТВЕННЫЕ
// контракты (buildSpeciesCatalogFromLegacy, справочник резервуаров,
// классификация механизмов), а не только искусственная fixture-среда:
// - проблема A: геохимические виды — ОТДЕЛЬНЫЙ каталог, совместимый
//   с ScientificSpecies/SpeciesCatalog; фазовая идентичность;
//   честная bookkeeping-семантика c_org; известная масса — только
//   с provenance; неизвестная масса не блокирует элементный учёт,
//   но блокирует перевод в кг;
// - проблема B: типизированный справочник резервуаров; легаси
//   liquid-surface/solid-deposits/subsurface-liquid НЕ отождествляются
//   автоматически; резервуары строятся ТОЛЬКО из явных данных;
// - проблема C: transport|reaction|coupled; reaction/coupled не
//   проходят через FluxLedger; отсутствие реализации не изображается
//   нулевой скоростью или «похожим» переносом;
// - структурная атрибуция (FluxGeochemicalContext), числовые конверсии
//   (переполнение), атомарность исполнения, дубликаты id.
//
// Существующие 29 сценариев Stage 4.9a (Tests/geochemicalFluxes.test.ts)
// сохранены без изменений смысла; legacy-тесты персистентности —
// в Tests/corePersistence.test.ts (включая новые тесты миграции
// 1.6 → 1.7). Все численные значения ниже — синтетические величины
// фикстур, НЕ физические данные и НЕ скорости реальных процессов.

import { describe, it, expect } from 'vitest';

import { buildSpeciesCatalogFromLegacy } from '../Core/adapters';
import gases from '../Data/gases';
import elementCompositions from '../Data/elementCompositions';
import {
  GEOCHEMICAL_SPECIES_DEFINITIONS,
  GEOCHEMICAL_SPECIES_CATALOG_PROVENANCE,
  ORGANIC_CARBON_NOTE,
  validateGeochemicalSpeciesDefinitions,
  buildGeochemicalSpeciesCatalog,
  addGeochemicalSpeciesToCatalog
} from '../Data/geochemicalSpeciesCatalog';
import {
  GEOCHEMICAL_PROCESS_CATALOG,
  validateInitialGeochemicalProcessCatalog
} from '../Data/geochemicalProcessCatalog';
import {
  GEOCHEMICAL_RESERVOIR_DICTIONARY,
  GEOCHEMICAL_RESERVOIR_IDS,
  validateGeochemicalReservoirDictionary,
  classifyLegacyReservoirCorrespondence,
  buildExplicitReservoirMapping,
  createGeochemicalReservoirs,
  geochemicalReservoirCompatibilityIssues
} from '../Core/geochemicalReservoirs';
import {
  GEOCHEMICAL_YEAR_S,
  GEOCHEMICAL_RATE_UNIT,
  GEOCHEMICAL_INVENTORY_BASIS,
  GeochemicalFluxError,
  molPerM2YearToPerSecond,
  molPerM2SecondToPerYear,
  validateGeochemicalProcessSpec,
  createGeochemicalFluxPlan,
  executeGeochemicalProcess,
  auditGeochemicalElements
} from '../Core/geochemicalFluxes';
import type { GeochemicalProcessSpec } from '../Core/geochemicalFluxes';
import {
  createFluxLedger,
  registerFlux,
  applyFlux,
  validateFluxLedger,
  FluxLedgerError
} from '../Core/fluxLedger';
import type { FluxLedger, FluxRecord, FluxTime } from '../Core/fluxLedger';
import { SpeciesError, elementTotals } from '../Core/species';
import type { SpeciesCatalog } from '../Core/species';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import { auditReactionStoichiometry } from '../Core/reactionLedger';
import type { ReactionRecord } from '../Core/reactionLedger';
import { validateFluxGeochemicalContext } from '../Core/geochemicalFluxContext';
import { buildSpeciesCatalogFromDefinitions, mergeGeochemicalSpeciesIntoCatalog } from '../Core/geochemicalSpecies';
import type { GeochemicalSpeciesDefinition } from '../Core/geochemicalSpecies';

// ============================================
// ФИКСТУРЫ (производственные каталоги + синтетические инвентари)
// ============================================

const TIME: FluxTime = { segmentIndex: 2, localTimeS: 600 };

/** Производственный каталог видов ДО ревизии (только легаси-газы). */
function productionCatalog(): SpeciesCatalog {
  return buildSpeciesCatalogFromLegacy(gases, elementCompositions);
}

/** Объединённый каталог: легаси-газы + геохимические виды (аддитивно). */
function mergedCatalog(): SpeciesCatalog {
  return addGeochemicalSpeciesToCatalog(productionCatalog()).catalog;
}

/** Синтетический столбовой резервуар (column_amount, mol/m²). */
function makeRes(id: string, entries: Record<string, number>): ReservoirRecord {
  return setMaterialInventory(createReservoir(id, 'geochemical_column'), GEOCHEMICAL_INVENTORY_BASIS, entries);
}

/** Синтетический набор геохимических резервуаров (справочные id). */
function makeReservoirs(): Record<string, ReservoirRecord> {
  return {
    atmosphere: makeRes('atmosphere', { co2: 100 }),
    ocean: makeRes('ocean', { co2: 50, co2_aq: 20, c_org: 5 }),
    crust: makeRes('crust', { caco3: 30, c_org: 10 }),
    mantle: makeRes('mantle', { co2: 10000 })
  };
}

function makeEnv(overrides: {
  catalog?: SpeciesCatalog;
  reservoirs?: Record<string, ReservoirRecord>;
  ledger?: FluxLedger;
} = {}) {
  return {
    speciesCatalog: overrides.catalog ?? mergedCatalog(),
    reservoirs: overrides.reservoirs ?? makeReservoirs(),
    ...(overrides.ledger ? { ledgerInput: overrides.ledger } : {})
  };
}

/** Синтетический transport-процесс с известной (фиктивной) скоростью. */
function transportSpec(overrides: Partial<GeochemicalProcessSpec> = {}): GeochemicalProcessSpec {
  return {
    processId: 'geo.revision.transfer.co2.ocean->atmosphere',
    processType: 'other',
    description: 'синтетический перенос без химического превращения (регрессионный тест ревизии)',
    mechanism: 'transport',
    implementationStatus: 'executable',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'atmosphere' },
    rate: {
      status: 'known',
      unit: GEOCHEMICAL_RATE_UNIT,
      molPerM2PerYear: 2,
      provenance: {
        sourceName: 'synthetic revision test fixture (not a real data source)',
        recordId: 'rev-fixture-rate-1',
        method: 'синтетическое значение для проверки контракта, НЕ физическая скорость'
      }
    },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    ...overrides
  };
}

function inventoryAmount(reservoirs: Record<string, ReservoirRecord>, id: string, speciesId: string): number {
  const res = reservoirs[id];
  if (!res || !res.material) throw new Error('резервуар без материального инвентаря: ' + id);
  return res.material.entries[speciesId] ?? 0;
}

// ============================================
// A. ВЕЩЕСТВА: производственный каталог и аддитивные виды (сценарии 1-7)
// ============================================

describe('Stage 4.9a.1 (A): вещества и каталоги видов', () => {
  it('(1) производственный SpeciesCatalog содержит только реально зарегистрированные легаси-виды', () => {
    const catalog = productionCatalog();
    // co2 есть в производственных данных (Data/gases.ts + elementCompositions)
    expect(catalog.has('co2')).toBe(true);
    expect(catalog.get('co2')?.phase).toBe('gas');
    // минералы и органика в производственном каталоге ОТСУТСТВУЮТ:
    // их нельзя было незаметно использовать как «существующие» виды
    expect(catalog.has('caco3')).toBe(false);
    expect(catalog.has('c_org')).toBe(false);
    expect(catalog.has('co2_aq')).toBe(false);
  });

  it('(2) геохимические виды — отдельный каталог данных, Data/gases.ts не расширяется', () => {
    // данные живут в geochemicalSpeciesCatalog, НЕ в каталоге газов
    expect(GEOCHEMICAL_SPECIES_DEFINITIONS.map((d) => d.id).sort()).toEqual(['c_org', 'caco3', 'co2_aq']);
    expect(validateGeochemicalSpeciesDefinitions()).toEqual([]);
    const geo = buildGeochemicalSpeciesCatalog();
    expect(geo.size()).toBe(3);
    // легаси-каталог по-прежнему их не содержит
    const production = productionCatalog();
    expect(production.has('caco3')).toBe(false);
    // аддитивное слияние: легаси + геохимия, добавлены все три
    const merged = addGeochemicalSpeciesToCatalog(production);
    expect(merged.issues).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    expect([...merged.added].sort()).toEqual(['c_org', 'caco3', 'co2_aq']);
    expect(merged.catalog.size()).toBe(production.size() + 3);
    // повторное слияние идемпотентно: ничего не добавляется заново
    const again = addGeochemicalSpeciesToCatalog(merged.catalog);
    expect(again.added).toEqual([]);
    expect([...again.skipped].sort()).toEqual(['c_org', 'caco3', 'co2_aq']);
    expect(again.conflicts).toEqual([]);
  });

  it('(3) повторное добавление одного species ID отклоняется (duplicate_species)', () => {
    const caco3 = GEOCHEMICAL_SPECIES_DEFINITIONS.find((d) => d.id === 'caco3');
    expect(caco3).toBeDefined();
    // дубликат id внутри набора определений
    expect(() => buildSpeciesCatalogFromDefinitions([caco3!, caco3!])).toThrowError(SpeciesError);
    // дубликат id относительно существующего каталога при register ядра
    const catalog = buildGeochemicalSpeciesCatalog();
    expect(() => catalog.register(catalog.get('caco3')!)).toThrowError(SpeciesError);
    // конфликтующее (несовместимое) определение при слиянии не перезаписывает вид
    const conflicting: GeochemicalSpeciesDefinition = {
      ...GEOCHEMICAL_SPECIES_DEFINITIONS.find((d) => d.id === 'co2_aq')!,
      elements: { C: 1, O: 3 }
    };
    const conflictingMerge = mergeGeochemicalSpeciesIntoCatalog(buildGeochemicalSpeciesCatalog(), [conflicting]);
    expect(conflictingMerge.added).toEqual([]);
    expect(conflictingMerge.conflicts).toEqual(['co2_aq']);
    expect(conflictingMerge.issues.length).toBeGreaterThan(0);
  });

  it('(4) газовая и водная формы CO2 различаются по ID и фазе', () => {
    const merged = mergedCatalog();
    const gas = merged.get('co2');
    const aq = merged.get('co2_aq');
    expect(gas).not.toBeNull();
    expect(aq).not.toBeNull();
    expect(gas!.id).not.toBe(aq!.id);
    expect(gas!.phase).toBe('gas');
    expect(aq!.phase).toBe('aqueous');
    // одинаковый состав, РАЗНЫЕ записи каталога (модель «вид + фаза»)
    expect(aq!.elements).toEqual(gas!.elements);
    // поиск по формуле находит обе записи
    const byFormula = merged.findByFormula('CO2');
    expect(byFormula.some((s) => s.id === 'co2_aq')).toBe(true);
  });

  it('(5) неизвестная молярная масса не мешает элементному аудиту, но запрещает перевод в кг', () => {
    const cOrg = mergedCatalog().get('c_org');
    expect(cOrg).not.toBeNull();
    // масса неизвестна и НЕ назначена автоматически
    expect(cOrg!.molarMassKgMol).toBeNull();
    expect(cOrg!.molarMassStatus).toBe('unknown');
    expect(cOrg!.molarMassProvenance).toBeUndefined();
    // элементный учёт работает: состав {C:1} установлен
    const totals = elementTotals(buildGeochemicalSpeciesCatalog(), { c_org: 7.5 });
    expect(totals.excludedSpecies).toEqual([]);
    expect(totals.totals['C']).toBeCloseTo(7.5, 12);
    expect(totals.totals['H']).toBeUndefined();
    expect(totals.totals['O']).toBeUndefined();
  });

  it('(6) caco3 не используется до регистрации подтверждённого вида', () => {
    // среда без регистрационного caco3 (производственный каталог без слияния)
    const env = makeEnv({ catalog: productionCatalog() });
    const result = executeGeochemicalProcess(
      transportSpec({ speciesId: 'caco3', direction: { kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'mantle' } }),
      env,
      { fluxId: 'fx-rev-nocaco3', durationS: GEOCHEMICAL_YEAR_S }
    );
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reason).toContain('caco3');
    expect(result.reason).toContain('не зарегистрировано');
  });

  it('(7) органический углерод имеет явно определённую bookkeeping-семантику', () => {
    const def = GEOCHEMICAL_SPECIES_DEFINITIONS.find((d) => d.id === 'c_org');
    expect(def).toBeDefined();
    // честная семантика: «моли атомов углерода», НЕ универсальная молекула органики
    expect(ORGANIC_CARBON_NOTE).toContain('bookkeeping');
    expect(ORGANIC_CARBON_NOTE).toContain('НЕ универсальная молекула органики');
    expect(def!.note).toBe(ORGANIC_CARBON_NOTE);
    // H/O органики НЕ представлены: никакая формула вроде CH2O не подставлена
    expect(def!.formula).toBe('C');
    expect(def!.elements).toEqual({ C: 1 });
    expect(def!.phase).toBe('other');
    expect(def!.dataStatus).toBe('estimated');
    // числовая масса не назначена: перевод в кг заблокирован
    expect(def!.molarMassKgMol).toBeNull();
    // ограничения по H/O описаны явно в provenance
    expect(def!.provenance?.limitations).toContain('H и O');
  });
});

// ============================================
// B. РЕЗЕРВУАРЫ: справочник и без подмен легаси (сценарии 8-10)
// ============================================

describe('Stage 4.9a.1 (B): геохимические резервуары', () => {
  it('(8) адаптер не подменяет solid-deposits корой: соответствие только через явное обоснование', () => {
    const c = classifyLegacyReservoirCorrespondence('solid-deposits');
    expect(c.geochemicalReservoirId).toBeNull();
    expect(c.status).toBe('candidate_requires_justification');
    // справочник в принципе не содержит автоматических легаси-соответствий
    expect(validateGeochemicalReservoirDictionary()).toEqual([]);
    for (const entry of GEOCHEMICAL_RESERVOIR_DICTIONARY) {
      expect(entry.legacyReservoirId).toBeNull();
    }
    expect(GEOCHEMICAL_RESERVOIR_IDS).toEqual(['atmosphere', 'ocean', 'crust', 'mantle']);
    // без обоснования правило соответствия отклоняется
    const unjustified = buildExplicitReservoirMapping([
      { geochemicalReservoirId: 'crust', coreReservoirId: 'solid-deposits', justification: '' }
    ]);
    expect(unjustified.issues.length).toBeGreaterThan(0);
    expect(Object.keys(unjustified.mapping)).toEqual([]);
    // явное обоснование принимается
    const justified = buildExplicitReservoirMapping([
      { geochemicalReservoirId: 'crust', coreReservoirId: 'solid-deposits', justification: 'тестовое явное правило: отложения tsчаются подмножеством запасов коры (фикстура)' }
    ]);
    expect(justified.issues).toEqual([]);
    expect(justified.mapping['crust']).toBe('solid-deposits');
  });

  it('(9) адаптер не подменяет subsurface-liquid мантией: геохимического аналога нет', () => {
    const c = classifyLegacyReservoirCorrespondence('subsurface-liquid');
    expect(c.geochemicalReservoirId).toBeNull();
    expect(c.status).toBe('no_geochemical_counterpart');
    expect(c.justification).toContain('НЕ является мантией');
    // расщепление одного резервуара ядра между двумя геохимическими отклоняется
    const split = buildExplicitReservoirMapping([
      { geochemicalReservoirId: 'ocean', coreReservoirId: 'liquid-surface', justification: 'фикстура-A' },
      { geochemicalReservoirId: 'crust', coreReservoirId: 'liquid-surface', justification: 'фикстура-B' }
    ]);
    expect(split.issues.some((i) => i.includes('расщепление'))).toBe(true);
  });

  it('(10) отсутствующий резервуар блокирует процесс (автосоздание запрещено)', () => {
    const env = makeEnv();
    const snapshot = JSON.stringify(env.reservoirs);
    const result = executeGeochemicalProcess(
      transportSpec({ direction: { kind: 'internal_transfer', fromReservoirId: 'lithosphere', toReservoirId: 'atmosphere' } }),
      env,
      { fluxId: 'fx-rev-nores', durationS: GEOCHEMICAL_YEAR_S }
    );
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reason).toContain('не существует');
    // состояние не изменено, резервуар не создан
    expect(JSON.stringify(env.reservoirs)).toBe(snapshot);
    expect(env.reservoirs['lithosphere']).toBeUndefined();
  });

  it('(10b) резервуары строятся ТОЛЬКО из явных данных; basis column_amount', () => {
    const result = createGeochemicalReservoirs([
      { id: 'ocean', inventoryEntries: { co2_aq: 42 } },
      { id: 'crust' },
      { id: 'crust', inventoryEntries: { caco3: 1 } },
      { id: 'abyss' as never, inventoryEntries: { co2: 1 } },
      { id: 'mantle', inventoryEntries: { co2: Number.NaN } }
    ]);
    expect(result.created).toEqual(['ocean']);
    expect(result.reservoirs['ocean'].material?.basis).toBe('column_amount');
    // резервуар без данных НЕ создан (отсутствие данных ≠ «пуст»)
    expect(result.skipped.some((s) => s.id === 'crust')).toBe(true);
    expect(result.reservoirs['crust']).toBeUndefined();
    // дубликат и неизвестный id отклонены с диагностикой
    expect(result.issues.some((i) => i.includes('дубликат'))).toBe(true);
    expect(result.issues.some((i) => i.includes('abyss'))).toBe(true);
    // NaN-инвентарь отклонён
    expect(result.issues.some((i) => i.includes('mantle'))).toBe(true);
    expect(result.reservoirs['mantle']).toBeUndefined();
    // совместимость инвентарей: резервуар не на column_amount даёт issue
    const wrongBasis = setMaterialInventory(createReservoir('atmosphere', 'gas_column'), 'arbitrary_units', { co2: 5 });
    expect(geochemicalReservoirCompatibilityIssues(wrongBasis).length).toBeGreaterThan(0);
    expect(geochemicalReservoirCompatibilityIssues(result.reservoirs['ocean'])).toEqual([]);
  });
});

// ============================================
// C. МЕХАНИЗМЫ: transport ≠ reaction ≠ coupled (сценарии 11-14, 21)
// ============================================

describe('Stage 4.9a.1 (C): разделение переноса и превращения', () => {
  it('(11) flux-only процесс не меняет химический вид', () => {
    const env = makeEnv();
    const before = JSON.stringify(env.reservoirs);
    const result = executeGeochemicalProcess(transportSpec(), env, { fluxId: 'fx-rev-x1', durationS: GEOCHEMICAL_YEAR_S });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // запись — перенос ОДНОГО И ТОГО ЖЕ вида
    expect(result.record.kind).toBe('internal_transfer');
    const subject = result.record.subject;
    expect(subject.subjectType).toBe('substance');
    if (subject.subjectType !== 'substance') return;
    expect(subject.speciesId).toBe('co2');
    expect(subject.quantityKind).toBe('integrated');
    expect(result.record.from).toBe('ocean');
    expect(result.record.to).toBe('atmosphere');
    // вещество переместилось как co2, формы не менялись
    expect(inventoryAmount(result.reservoirs, 'atmosphere', 'co2')).toBeCloseTo(102, 9);
    expect(inventoryAmount(result.reservoirs, 'ocean', 'co2')).toBeCloseTo(48, 9);
    expect(inventoryAmount(result.reservoirs, 'atmosphere', 'co2_aq')).toBe(0);
    // исходная среда не мутировала (исполнение иммутабельно)
    expect(JSON.stringify(env.reservoirs)).toBe(before);
  });

  it('(12) reaction-required процесс не может пройти через FluxLedger', () => {
    const dissolution = GEOCHEMICAL_PROCESS_CATALOG.find((p) => p.processId === 'geo.dissolution.co2_aq.atm->ocn');
    expect(dissolution).toBeDefined();
    expect(dissolution!.mechanism).toBe('reaction');
    expect(dissolution!.implementationStatus).toBe('reaction_required');
    // план: unsupported_mechanism с причиной, fluxId НЕ создаётся
    const plan = createGeochemicalFluxPlan(dissolution as GeochemicalProcessSpec, makeEnv());
    expect(plan.status).toBe('unsupported_mechanism');
    if (plan.status !== 'unsupported_mechanism') return;
    expect(plan.reason).toContain('ReactionLedger');
    // исполнение: not_applied, поток не создан, состояние не изменено
    const env = makeEnv();
    const snapshot = JSON.stringify(env.reservoirs);
    const result = executeGeochemicalProcess(dissolution as GeochemicalProcessSpec, env, { fluxId: 'fx-rev-diss', durationS: GEOCHEMICAL_YEAR_S });
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reason).toContain('не исполняется через FluxLedger');
    expect(result.reason).toContain('reaction_required');
    expect(JSON.stringify(env.reservoirs)).toBe(snapshot);
  });

  it('(13) неизвестная стехиометрия даёт not_verifiable, а не balanced', () => {
    const catalog = mergedCatalog();
    const record: ReactionRecord = {
      id: 'rx-rev-unknown-species',
      reactionId: 'geo.revision.unknown.stoichiometry',
      reactants: [{ reservoirId: 'crust', speciesId: 'no_such_species_x', coefficient: 1 }],
      products: [{ reservoirId: 'crust', speciesId: 'co2', coefficient: 1 }],
      extent: 1,
      extentBasis: 'column_amount',
      time: TIME
    };
    const audit = auditReactionStoichiometry(record, catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.status).not.toBe('balanced');
    expect(audit.missingSpecies).toContain('no_such_species_x');
    // калибровка: известная сбалансированная реакция всё ещё balanced
    const known: ReactionRecord = {
      id: 'rx-rev-known',
      reactionId: 'geo.revision.known.stoichiometry',
      reactants: [
        { reservoirId: 'crust', speciesId: 'co2', coefficient: 1 },
        { reservoirId: 'crust', speciesId: 'c_org', coefficient: 1 }
      ],
      products: [{ reservoirId: 'crust', speciesId: 'caco3', coefficient: 1 }],
      extent: 1,
      extentBasis: 'column_amount',
      time: TIME
    };
    // CaCO3: Ca1C1O3 против CO2+C: C2O2 — НЕ сбалансирована; это
    // осознанная несбалансированная фикстура для проверки честного вердикта
    const knownAudit = auditReactionStoichiometry(known, catalog);
    expect(knownAudit.status === 'imbalanced' || knownAudit.status === 'approximate').toBe(true);
  });

  it('(14) фазовый переход различает исходный и конечный виды', () => {
    const dissolution = GEOCHEMICAL_PROCESS_CATALOG.find((p) => p.processId === 'geo.dissolution.co2_aq.atm->ocn')!;
    const exchange = GEOCHEMICAL_PROCESS_CATALOG.find((p) => p.processId === 'geo.ocean_atm_exchange.co2.ocn->atm')!;
    // конечный вид ≠ исходный: co2(газ) → co2_aq(водный) и обратно
    expect(dissolution.speciesId).toBe('co2_aq');
    expect(dissolution.speciesId).not.toBe('co2');
    expect(exchange.speciesId).toBe('co2');
    const intent = dissolution.reactionIntent!;
    expect(intent.reactantsNote).toContain('co2');
    expect(intent.productsNote).toContain('co2_aq');
    // валидатор: reaction с executable запрещён, transport с reaction_required запрещён
    const badExecutable = validateGeochemicalProcessSpec(transportSpec({
      processId: 'geo.revision.bad.exec',
      mechanism: 'reaction',
      implementationStatus: 'executable',
      reactionIntent: { note: 'фиктивная попытка выдать превращение за исполнимый перенос' }
    }));
    expect(badExecutable.some((e) => e.includes('не может иметь implementationStatus «executable»'))).toBe(true);
    const badTransport = validateGeochemicalProcessSpec(transportSpec({
      processId: 'geo.revision.bad.transport',
      implementationStatus: 'reaction_required'
    }));
    expect(badTransport.some((e) => e.includes('не может иметь implementationStatus «reaction_required»'))).toBe(true);
    // coupled без couplingSequence отклоняется
    const badCoupled = validateGeochemicalProcessSpec(transportSpec({
      processId: 'geo.revision.bad.coupled',
      mechanism: 'coupled',
      implementationStatus: 'not_implemented',
      reactionIntent: { note: 'сопряжённая фикстура' }
    }));
    expect(badCoupled.some((e) => e.includes('couplingSequence'))).toBe(true);
  });

  it('(21) неподдерживаемый (reaction) процесс не изменяет состояние мира', () => {
    const oxidation = GEOCHEMICAL_PROCESS_CATALOG.find((p) => p.processType === 'oxidation')!;
    const env = makeEnv();
    const snapshot = JSON.stringify(env.reservoirs);
    const result = executeGeochemicalProcess(oxidation as GeochemicalProcessSpec, env, { fluxId: 'fx-rev-ox', durationS: GEOCHEMICAL_YEAR_S });
    expect(result.status).toBe('not_applied');
    expect(JSON.stringify(env.reservoirs)).toBe(snapshot);
    // catalog: все reaction/coupled процессы каталога не создают потоков
    for (const entry of GEOCHEMICAL_PROCESS_CATALOG) {
      if (entry.mechanism === 'transport') continue;
      const r = executeGeochemicalProcess(entry as GeochemicalProcessSpec, env, { fluxId: 'fx-rev-cat-' + entry.processId, durationS: GEOCHEMICAL_YEAR_S });
      expect(r.status).toBe('not_applied');
    }
    expect(validateInitialGeochemicalProcessCatalog()).toEqual([]);
  });
});

// ============================================
// D. СТРУКТУРНАЯ АТРИБУЦИЯ ПОТОКОВ (сценарии 15-17)
// ============================================

describe('Stage 4.9a.1 (D): структурная атрибуция геохимических потоков', () => {
  it('(15) структурная provenance сохраняется после JSON round-trip записи', () => {
    const env = makeEnv();
    const result = executeGeochemicalProcess(transportSpec(), env, { fluxId: 'fx-rev-ctx', durationS: GEOCHEMICAL_YEAR_S, time: TIME });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const context = result.record.geochemical;
    expect(context).toBeDefined();
    // сериализуемость: JSON → обратно → валидатор без замечаний
    const restored: unknown = JSON.parse(JSON.stringify(context));
    expect(validateFluxGeochemicalContext(restored)).toEqual([]);
    // поля атрибуции — данные, а не текст в note
    expect(context!.processId).toBe(transportSpec().processId);
    expect(context!.processType).toBe('other');
    expect(context!.mechanism).toBe('transport');
    expect(context!.speciesId).toBe('co2');
    expect(context!.molPerM2PerYear).toBe(2);
    expect(context!.rateUnitExternal).toBe('mol_m2_yr');
    expect(context!.rateUnitInternal).toBe('mol_m2_s');
    expect(context!.integrationDurationS).toBe(GEOCHEMICAL_YEAR_S);
    expect(context!.rateProvenance.sourceName).toContain('synthetic revision test fixture');
    expect(context!.assumptions.length).toBeGreaterThan(0);
    // грузоподъёмность vалидатора: повреждение формы обнаруживается
    const damaged = (restored as Record<string, unknown>);
    damaged['molPerM2PerYear'] = -1;
    expect(validateFluxGeochemicalContext(damaged).some((e) => e.includes('положительным'))).toBe(true);
    delete damaged['rateProvenance'];
    expect(validateFluxGeochemicalContext(damaged).some((e) => e.includes('rateProvenance'))).toBe(true);
  });

  it('(16) boundary ID и physical justification сохраняются после исполнения', () => {
    const result = executeGeochemicalProcess(
      transportSpec({
        processId: 'geo.revision.infall.co2.space',
        direction: { kind: 'external_input', reservoirId: 'atmosphere', boundary: { id: 'space', physicalJustification: 'метеоритный приток co2 (синтетический сценарий ревизии)' } }
      }),
      makeEnv(),
      { fluxId: 'fx-rev-boundary', durationS: GEOCHEMICAL_YEAR_S }
    );
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.record.kind).toBe('external_input');
    expect(result.record.from).toBe('external');
    const context = result.record.geochemical!;
    expect(context.boundary).not.toBeNull();
    expect(context.boundary!.id).toBe('space');
    expect(context.boundary!.physicalJustification).toContain('метеоритный приток');
    // JSON round-trip границы
    const restored = JSON.parse(JSON.stringify(context)) as typeof context;
    expect(restored.boundary).toEqual(context.boundary);
    // внутренний перенос: граница отсутствует (null), и это фиксируется явно
    const internal = executeGeochemicalProcess(transportSpec(), makeEnv(), { fluxId: 'fx-rev-internal', durationS: GEOCHEMICAL_YEAR_S });
    expect(internal.status).toBe('applied');
    if (internal.status !== 'applied') return;
    expect(internal.record.geochemical!.boundary).toBeNull();
  });

  it('(17) старые FluxRecord без новой metadata загружаются без выдумывания источника', () => {
    const legacy: FluxRecord = {
      id: 'fx-rev-legacy',
      kind: 'internal_transfer',
      from: 'ocean',
      to: 'atmosphere',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 3, basis: 'column_amount' },
      time: null,
      status: 'applied'
    };
    // валидатор журнала: отсутствие geochemical — НЕ ошибка
    const problems = validateFluxLedger({ records: [legacy] });
    expect(problems).toEqual([]);
    const record = JSON.parse(JSON.stringify(legacy)) as FluxRecord;
    expect('geochemical' in record).toBe(false);
    // контекст у легаси-записи не синтезируется и не появляется при валидации
    const revalidated = validateFluxLedger(record ? { records: [record] } : { records: [] });
    expect(revalidated).toEqual([]);
    expect((record as unknown as Record<string, unknown>).geochemical).toBeUndefined();
  });
});

// ============================================
// E. ЧИСЛОВЫЕ КОНТРАКТЫ И АТОМАРНОСТЬ (сценарии 19-24)
// ============================================

describe('Stage 4.9a.1 (E): конверсии, provenance, атомарность', () => {
  it('(19) обратная конверсия при переполнении завершается явной ошибкой', () => {
    // конечный вход × 31 557 600 может выйти за диапазон double (порог ~5.7e300)
    expect(() => molPerM2SecondToPerYear(Number.MAX_VALUE)).toThrowError(/переполнилась/);
    expect(() => molPerM2SecondToPerYear(1e306)).toThrowError(/переполнилась/);
    // граница чуть ниже переполнения остаётся конечной
    expect(Number.isFinite(molPerM2SecondToPerYear(1e300))).toBe(true);
    expect(molPerM2SecondToPerYear(1e300)).toBeCloseTo(3.15576e307, 292);
    // NaN/Infinity вход отклоняется и в обратной конверсии
    expect(() => molPerM2SecondToPerYear(Number.NaN)).toThrowError(GeochemicalFluxError);
    expect(() => molPerM2SecondToPerYear(Number.POSITIVE_INFINITY)).toThrowError(GeochemicalFluxError);
    expect(() => molPerM2SecondToPerYear(-1)).toThrowError(GeochemicalFluxError);
    // прямой конверсии переполнения не бывает (деление), но знак/конечность проверяются
    expect(() => molPerM2YearToPerSecond(Number.POSITIVE_INFINITY)).toThrowError(GeochemicalFluxError);
  });

  it('(20) очень малые положительные скорости не становятся отрицательными; нуль сохраняется', () => {
    const tiny = molPerM2YearToPerSecond(1e-300);
    expect(Number.isFinite(tiny)).toBe(true);
    expect(tiny).toBeGreaterThan(0);
    // обратный ход примерно восстанавливает величину
    expect(molPerM2SecondToPerYear(tiny)).toBeCloseTo(1e-300, 300);
    expect(molPerM2YearToPerSecond(0)).toBe(0);
    expect(molPerM2SecondToPerYear(0)).toBe(0);
    // отрицательные значения запрещены в обе стороны
    expect(() => molPerM2YearToPerSecond(-1e-10)).toThrowError(GeochemicalFluxError);
    expect(() => molPerM2SecondToPerYear(-1e-10)).toThrowError(GeochemicalFluxError);
    // согласованность константы года
    expect(molPerM2YearToPerSecond(GEOCHEMICAL_YEAR_S)).toBe(1);
  });

  it('(20b) runtime-валидация provenance: некорректные типы и пустые идентификаторы отклоняются', () => {
    // числовая скорость без provenance-источника
    const noSource = validateGeochemicalProcessSpec(transportSpec({
      rate: { status: 'known', unit: GEOCHEMICAL_RATE_UNIT, molPerM2PerYear: 1, provenance: { note: 'без источника' } }
    }));
    expect(noSource.some((e) => e.includes('идентифицировать источник'))).toBe(true);
    // пустая строка-идентификатор не считается источником
    const emptySource = validateGeochemicalProcessSpec(transportSpec({
      rate: { status: 'known', unit: GEOCHEMICAL_RATE_UNIT, molPerM2PerYear: 1, provenance: { sourceName: '   ' } }
    }));
    expect(emptySource.length).toBeGreaterThan(0);
    // некорректный тип поля provenance
    const badType = validateGeochemicalProcessSpec(transportSpec({
      rate: { status: 'known', unit: GEOCHEMICAL_RATE_UNIT, molPerM2PerYear: 1, provenance: { sourceName: 'x', recordId: 42 as unknown as string } }
    }));
    expect(badType.some((e) => e.includes('provenance.recordId'))).toBe(true);
    // согласованность: unknown не может нести число
    const unknownWithNumber = validateGeochemicalProcessSpec(transportSpec({
      rate: { status: 'unknown', reason: 'причина ревизии', molPerM2PerYear: 5 } as never
    }));
    expect(unknownWithNumber.some((e) => e.includes('не может нести числовое значение'))).toBe(true);
    // отрицательная числовая скорость отклоняется
    const negative = validateGeochemicalProcessSpec(transportSpec({
      rate: { status: 'known', unit: GEOCHEMICAL_RATE_UNIT, molPerM2PerYear: -2, provenance: { sourceName: 'x', recordId: 'r' } }
    }));
    expect(negative.some((e) => e.includes('отрицательным'))).toBe(true);
  });

  it('(22) повторное исполнение одного fluxId отклоняется без двойного учёта', () => {
    const env = makeEnv();
    const first = executeGeochemicalProcess(transportSpec(), env, { fluxId: 'fx-rev-double', durationS: GEOCHEMICAL_YEAR_S });
    expect(first.status).toBe('applied');
    if (first.status !== 'applied') return;
    expect(first.ledger.records.length).toBe(1);
    // повторная регистрация того же id в том же журнале отклоняется
    const second = executeGeochemicalProcess(
      transportSpec(),
      { speciesCatalog: env.speciesCatalog, reservoirs: first.reservoirs, ledgerInput: first.ledger },
      { fluxId: 'fx-rev-double', durationS: GEOCHEMICAL_YEAR_S }
    );
    expect(second.status).toBe('not_applied');
    if (second.status !== 'not_applied') return;
    expect(second.reason).toContain('уже зарегистрирован');
    // запись осталась ровно одна (двойного учёта нет)
    expect(first.ledger.records.length).toBe(1);
    // повторное применение applied-записи к резервуарам запрещено контрактом ядра
    expect(() => applyFlux(first.ledger, first.reservoirs, 'fx-rev-double')).toThrowError(/уже применён/);
    // прямой дубликат id через registerFlux
    const ledger = createFluxLedger();
    const fluxRecord = {
      id: 'fx-rev-direct', kind: 'internal_transfer' as const, from: 'ocean', to: 'atmosphere',
      subject: { subjectType: 'substance' as const, speciesId: 'co2', quantityKind: 'integrated' as const, amount: 1, basis: 'column_amount' as const },
      time: null, status: 'pending' as const
    };
    // прямой дубликат id через registerFlux (функция иммутабельна:
    // дубликат ищется в ВОЗВРАЩАЁМОМ журнале)
    const registered = registerFlux(createFluxLedger(), fluxRecord);
    expect(() => registerFlux(registered, fluxRecord)).toThrowError(FluxLedgerError);
  });

  it('(23) элементный аудит после чистого внутреннего переноса остаётся balanced', () => {
    const catalog = mergedCatalog();
    const before = makeReservoirs();
    const env = makeEnv({ catalog, reservoirs: before });
    const result = executeGeochemicalProcess(transportSpec(), env, { fluxId: 'fx-rev-balanced', durationS: GEOCHEMICAL_YEAR_S });
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    // единственная запись журнала — внутренний перенос; netExternal равен нулю
    expect(result.ledger.records.length).toBe(1);
    expect(result.ledger.records[0].kind).toBe('internal_transfer');
    const audit = auditGeochemicalElements(catalog, result.ledger, before, result.reservoirs);
    expect(audit.status).toBe('balanced');
    expect(audit.balanced).toBe(true);
    // повэлементная диагностика: C сохраняется точно
    const carbon = audit.elementDiagnostics.find((d) => d.element === 'C');
    expect(carbon).toBeDefined();
    expect(carbon!.residual).toBeCloseTo(0, 9);
  });

  it('(24) внешний перенос без проверяемой границы не объявляется balanced', () => {
    const catalog = mergedCatalog();
    const before = makeReservoirs();
    // внешний вход co2 7.5 mol/m² зафиксирован в журнале как ПРИМЕНЁННЫЙ
    // поток, но состояние резервуаров «после» НЕ отражает поступление
    // (проверяемая граница отсутствует — контекст не записан)
    const registered = registerFlux(createFluxLedger(), {
      id: 'fx-rev-ext', kind: 'external_input', from: 'external', to: 'atmosphere',
      subject: { subjectType: 'substance', speciesId: 'co2', quantityKind: 'integrated', amount: 7.5, basis: 'column_amount' },
      time: TIME
    });
    const applied = applyFlux(registered, before, 'fx-rev-ext');
    // аудит: состояние «после» не отражает внешний вход (явно before)
    const audit = auditGeochemicalElements(catalog, applied.ledger, before, before);
    expect(audit.status).not.toBe('balanced');
    expect(audit.balanced).toBe(false);
    // диагностика видит чистый внешний приход и расхождение по C/O
    const carbon = audit.elementDiagnostics.find((d) => d.element === 'C');
    expect(carbon).toBeDefined();
    expect(carbon!.netExternalCount).toBeCloseTo(7.5, 9);
    expect(carbon!.residual).toBeCloseTo(7.5, 9);
  });
});

// ============================================
// F. КАТАЛОГ ПРОЦЕССОВ: классификация и дружелюбность к валидатору
// ============================================

describe('Stage 4.9a.1 (F): каталог процессов после ревизии', () => {
  it('каждый процесс каталога классифицирован: transport+executable или превращение с реакционным намерением', () => {
    for (const entry of GEOCHEMICAL_PROCESS_CATALOG) {
      expect(entry.mechanism).toBeDefined();
      expect(entry.implementationStatus).toBeDefined();
      if (entry.mechanism === 'reaction' || entry.mechanism === 'coupled') {
        // превращение: НЕ executable, намерение описано явно
        expect(entry.implementationStatus).not.toBe('executable');
        expect(entry.reactionIntent?.note.length ?? 0).toBeGreaterThan(0);
        if (entry.mechanism === 'coupled') {
          expect(entry.couplingSequence?.length ?? 0).toBeGreaterThan(0);
        }
      } else {
        // перенос: вид должен быть реально зарегистрирован в объединённом каталоге
        expect(mergedCatalog().has(entry.speciesId)).toBe(true);
      }
      // у всех процессов каталога速度 неизвестна: численных скоростей в этом промпте нет
      expect(entry.rate.status).toBe('unknown');
      expect(entry.rate.status === 'unknown' ? entry.rate.reason.length : 0).toBeGreaterThan(0);
      // каждая спецификация проходит валидатор формы
      expect(validateGeochemicalProcessSpec(entry as GeochemicalProcessSpec)).toEqual([]);
    }
    // transport-процессы каталога: c_org (захоронение) и caco3 (субдукция)
    const transports = GEOCHEMICAL_PROCESS_CATALOG.filter((p) => p.mechanism === 'transport');
    expect(transports.map((p) => p.processType).sort()).toEqual(['organic_carbon_burial', 'subduction']);
    // provenance самого каталога заполнен
    expect(GEOCHEMICAL_SPECIES_CATALOG_PROVENANCE.sourceId.length).toBeGreaterThan(0);
    expect(validateGeochemicalSpeciesDefinitions()).toEqual([]);
  });

  it('исполнение каталога: ни один процесс не создаёт поток с неизвестной скоростью', () => {
    const env = makeEnv();
    const snapshot = JSON.stringify(env.reservoirs);
    const fluxIds = new Set<string>();
    for (const entry of GEOCHEMICAL_PROCESS_CATALOG) {
      const result = executeGeochemicalProcess(entry as GeochemicalProcessSpec, env, { fluxId: 'fx-rev-cat-' + entry.processId, durationS: GEOCHEMICAL_YEAR_S });
      expect(result.status).toBe('not_applied');
      fluxIds.add('fx-rev-cat-' + entry.processId);
    }
    expect(fluxIds.size).toBe(GEOCHEMICAL_PROCESS_CATALOG.length);
    // состояние не изменилось вообще
    expect(JSON.stringify(env.reservoirs)).toBe(snapshot);
  });
});
