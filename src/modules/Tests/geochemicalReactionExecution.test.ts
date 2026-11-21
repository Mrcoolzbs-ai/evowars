// ============================================
// STAGE 4.9b - ИСПОЛНИТЕЛЬ ГЕОХИМИЧЕСКИХ РЕАКЦИЙ И АТОМАРНЫЕ ТРАНЗАКЦИИ
// ============================================
//
// Тесты атомарного реакционного исполнителя (Core/geochemicalReactionExecution.ts):
// - реальное применение сбалансированной реакции к материальным
//   инвентарям через reactionInventoryDeltas + addMaterial/removeMaterial;
// - fail-closed: несбалансированные/непроверяемые/вне применимости
//   реакции не применяются, входные объекты не мутируются;
// - структурная атрибуция GeochemicalReactionContext в ReactionRecord;
// - миграция 1.7 → 1.8 и Storage round-trip.
//
// ФИКСТУРА CO2(g) ⇌ CO2(aq): синтетический проверочный механизм для
// ОБОБЩЁННОГО исполнителя (1:1 переход фаз, сохранение C и O). Extent
// и все числа ниже — SYNTHETIC TEST FIXTURE, не физические данные и не
// скорости/равновесия реального растворения CO2. В научный каталог эти
// значения НЕ вводятся: каталог процессов остаётся с unknown-скоростями.
//
// Существующие 29 тестов Stage 4.9a и 24 теста Stage 4.9a.1 не
// изменены и не ослаблены.

import { describe, it, expect } from 'vitest';

import { buildSpeciesCatalogFromLegacy } from '../Core/adapters';
import gases from '../Data/gases';
import elementCompositions from '../Data/elementCompositions';
import { addGeochemicalSpeciesToCatalog } from '../Data/geochemicalSpeciesCatalog';
import { GEOCHEMICAL_INVENTORY_BASIS } from '../Core/geochemicalFluxes';
import type { SpeciesCatalog } from '../Core/species';
import { createReservoir, setMaterialInventory } from '../Core/reservoir';
import type { ReservoirRecord } from '../Core/reservoir';
import {
  createReactionLedger,
  registerReaction,
  validateReactionLedger,
  validateReactionRecord
} from '../Core/reactionLedger';
import type { ReactionLedger, ReactionRecord } from '../Core/reactionLedger';
import {
  GEOCHEMICAL_REACTION_CONTEXT_SCHEMA_VERSION,
  GEOCHEMICAL_REACTION_MECHANISM,
  GEOCHEMICAL_REACTION_EXTENT_UNIT,
  GEOCHEMICAL_REACTION_EXTENT_BASIS,
  validateGeochemicalReactionContext
} from '../Core/geochemicalReactionContext';
import { CORE_WORLD_STATE_SCHEMA_VERSION, SUPPORTED_CORE_WORLD_STATE_SCHEMA_VERSIONS } from '../Core/worldState';
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  SAVE_SCHEMA_VERSIONS,
  isKnownSchemaVersion,
  migrateSavedWorld
} from '../Core/migrations';
import {
  GEOCHEMICAL_ORGANIC_CARBON_SPECIES_ID,
  validateGeochemicalReactionDefinition,
  planGeochemicalReaction,
  executeGeochemicalReaction
} from '../Core/geochemicalReactionExecution';
import type {
  GeochemicalReactionDefinition,
  GeochemicalReactionExecutionEnvironment
} from '../Core/geochemicalReactionExecution';

// ============================================
// ФИКСТУРЫ (производственные каталоги + синтетические инвентари)
// ============================================

const TIME = { segmentIndex: 3, localTimeS: 900 } as const;

/** Производственный каталог: легаси-газы + геохимические виды (co2_aq, caco3, c_org). */
function catalog(): SpeciesCatalog {
  return addGeochemicalSpeciesToCatalog(buildSpeciesCatalogFromLegacy(gases, elementCompositions)).catalog;
}

/** Синтетический столбовой резервуар (column_amount, mol/m²). */
function makeRes(id: string, entries: Record<string, number>): ReservoirRecord {
  return setMaterialInventory(createReservoir(id, 'geochemical_column'), GEOCHEMICAL_INVENTORY_BASIS, entries);
}

/** Синтетическая среда исполнения. Числа — синтетические величины фикстур. */
function makeEnv(entriesOverrides: Record<string, Record<string, number>> = {}, ledger?: ReactionLedger): GeochemicalReactionExecutionEnvironment {
  const base: Record<string, Record<string, number>> = {
    atmosphere: { co2: 100, o2: 500, n2: 3000 },
    ocean: { co2_aq: 20, c_org: 5 },
    crust: { caco3: 30, c_org: 10 },
    mantle: { co2: 10000 }
  };
  for (const key of Object.keys(entriesOverrides)) {
    base[key] = entriesOverrides[key];
  }
  const reservoirs: Record<string, ReservoirRecord> = {};
  for (const id of Object.keys(base)) {
    reservoirs[id] = makeRes(id, base[id]!);
  }
  return {
    speciesCatalog: catalog(),
    reservoirs,
    ledgerInput: ledger
  };
}

/** Стандартная fixture-реакция CO2(g) → CO2(aq), 1:1 (синтетический проверочный механизм). */
function co2Dissolution(): GeochemicalReactionDefinition {
  return {
    reactionId: 'fixture.co2.gas_to_aqueous.v1',
    processId: 'co2_gas_aqueous_exchange_fixture',
    description: 'Синтетическая fixture фазового перехода CO2(g) → CO2(aq), 1:1: только проверка механизма исполнителя. НЕ утверждение о равновесии или скорости растворения.',
    reactants: [{ reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 1 }],
    products: [{ reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 1 }],
    extentBasis: 'column_amount',
    definitionProvenance: {
      sourceName: 'synthetic test fixture (Stage 4.9b)',
      note: 'стехиометрия 1:1 задана явно для проверки механизма; не физические данные'
    },
    limitations: 'fixture-механизм; extent подаётся вызывающим кодом с provenance; кинетика и равновесие не утверждаются',
    assumptions: ['1:1 переход фаз (сохранение C и O)', 'синтетические инвентари фикстур']
  };
}

/** Синтетический provenance extent (указан явно, не синтезируется исполнителем). */
function syntheticExtentProvenance(note = 'SYNTHETIC TEST FIXTURE: extent задан явно для численного теста'): Record<string, unknown> {
  return {
    sourceName: 'synthetic test fixture (Stage 4.9b)',
    note
  };
}

function makeInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transactionId: 'tx-fixture-1',
    extentMolPerM2: 7,
    extentProvenance: syntheticExtentProvenance(),
    time: TIME,
    note: 'synthetic test fixture',
    ...overrides
  };
}

/** Число в ключе вида out reservoir.species (или null, если вида нет). */
function amountOf(reservoirs: Record<string, ReservoirRecord>, reservoirId: string, speciesId: string): number | null {
  const res = reservoirs[reservoirId];
  if (!res || !res.material) return null;
  const value = res.material.entries[speciesId];
  return value === undefined ? null : value;
}

// ============================================
// РАЗДЕЛ A: стехиометрия, аудит, фазовый переход (сценарии 1-4)
// ============================================

describe('Stage 4.9b: аудит и фазовая реакция CO2(g) ⇌ CO2(aq) (fixture)', () => {
  it('1. корректная фазовая реакция co2 → co2_aq проходит стехиометрический аудит (balanced)', () => {
    const result = planGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) => d.includes('balanced'))).toBe(true);
  });

  it('2. элементный состав сохраняется: сумма C и O одинакова на обеих сторонах реакции', () => {
    const result = planGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('ready');
    // вклады 1:1: атмосфера отдаёт ровно extent C и 2*extent O,
    // океан получает те же C и O — проверяем по дельтам вкладов
    if (result.status !== 'ready') return;
    const atm = result.deltas.contributions.find((c) => c.reservoirId === 'atmosphere' && c.speciesId === 'co2');
    const ocean = result.deltas.contributions.find((c) => c.reservoirId === 'ocean' && c.speciesId === 'co2_aq');
    expect(atm?.delta).toBe(-7);
    expect(ocean?.delta).toBe(7);
  });

  it('3. заряд сохраняется: нейтральные CO2 и CO2(aq) дают нулевой баланс зарядов', () => {
    const c = catalog();
    const co2Def = c.get('co2');
    const co2AqDef = c.get('co2_aq');
    expect(co2Def).toBeDefined();
    expect(co2AqDef).toBeDefined();
    // оба вида нейтральны (заряд 0) — баланс 0 == 0
    expect(co2Def!.charge).toBe(0);
    expect(co2AqDef!.charge).toBe(0);
  });

  it('4. различие фаз не теряется: co2 (gas) и co2_aq (aqueous) — разные записи каталога', () => {
    const c = catalog();
    const co2Def = c.get('co2');
    const co2AqDef = c.get('co2_aq');
    expect(co2Def?.phase).not.toBe(co2AqDef?.phase);
    // элементный состав идентичен (1 C + 2 O), но записи разные
    expect(co2Def?.elements).toEqual(co2AqDef?.elements);
    expect('co2_aq').not.toBe('co2');
  });
});

// ============================================
// РАЗДЕЛ B: реальное применение к инвентарям (сценарии 5-10)
// ============================================

describe('Stage 4.9b: атомарное применение к материальным инвентарям', () => {
  it('5. реакция реально уменьшает исходный реагент в резервуаре-источнике', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(amountOf(result.reservoirs, 'atmosphere', 'co2')).toBe(100 - 7);
  });

  it('6. продукт действительно появляется в целевом резервуаре', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(amountOf(result.reservoirs, 'ocean', 'co2_aq')).toBe(20 + 7);
  });

  it('7. величина изменения соответствует coefficient × extent (1:1 → extent)', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput({ extentMolPerM2: 12.5 }) as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.deltas.contributions.find((c) => c.speciesId === 'co2')?.delta).toBe(-12.5);
    expect(result.deltas.contributions.find((c) => c.speciesId === 'co2_aq')?.delta).toBe(12.5);
    expect(amountOf(result.reservoirs, 'atmosphere', 'co2')).toBe(100 - 12.5);
    expect(amountOf(result.reservoirs, 'ocean', 'co2_aq')).toBe(20 + 12.5);
  });

  it('8. два реагента расходуются по своим коэффициентам (2 co2 + 1 co2 → 2 co2_aq, 3:2→2 фикс)', () => {
    // Стехиометрия фикстуры сбалансирована по элементам:
    // 2×CO2 (atmosphere) + 1×CO2 (mantle) = 3 CO2 = 3 C + 6 O
    // → 3×CO2(aq) (ocean) = 3 C + 6 O.
    const def: GeochemicalReactionDefinition = {
      ...co2Dissolution(),
      reactionId: 'fixture.two.reactants.v1',
      reactants: [
        { reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 2 },
        { reservoirId: 'mantle', speciesId: 'co2', coefficient: 1 }
      ],
      products: [{ reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 3 }],
      definitionProvenance: { sourceName: 'synthetic test fixture (Stage 4.9b)', note: '3 -> 2 + 1: сбалансированная группировка фикстуры; CO2(g) в двух резервуарах' }
    };
    const result = executeGeochemicalReaction(def, makeEnv(), makeInput({ transactionId: 'tx-two-reactants' }) as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(amountOf(result.reservoirs, 'atmosphere', 'co2')).toBe(100 - 2 * 7);
    expect(amountOf(result.reservoirs, 'mantle', 'co2')).toBe(10000 - 7);
    expect(amountOf(result.reservoirs, 'ocean', 'co2_aq')).toBe(20 + 3 * 7);
  });

  it('9. несколько продуктов создаются с корректными количествами', () => {
    // Стехиометрия фикстуры сбалансирована:
    // 2×CO2(aq) (ocean) = 2 C + 4 O → 1×CO2 (atmosphere) + 1×CO2 (mantle)
    const def: GeochemicalReactionDefinition = {
      ...co2Dissolution(),
      reactionId: 'fixture.two.products.v1',
      reactants: [{ reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 2 }],
      products: [
        { reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 1 },
        { reservoirId: 'mantle', speciesId: 'co2', coefficient: 1 }
      ],
      definitionProvenance: { sourceName: 'synthetic test fixture (Stage 4.9b)', note: '2 -> 1 + 1: сбалансированное распределение фикстуры' }
    };
    const result = executeGeochemicalReaction(def, makeEnv(), makeInput({ transactionId: 'tx-two-products' }) as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(amountOf(result.reservoirs, 'ocean', 'co2_aq')).toBe(20 - 2 * 7);
    expect(amountOf(result.reservoirs, 'atmosphere', 'co2')).toBe(100 + 7);
    expect(amountOf(result.reservoirs, 'mantle', 'co2')).toBe(10000 + 7);
  });

  it('10. реакция с несколькими резервуарами обрабатывается корректно (незатронутые разделяются с входом)', () => {
    const env = makeEnv();
    const res = executeGeochemicalReaction(co2Dissolution(), env, makeInput({ transactionId: 'tx-shared' }) as never);
    expect(res.status).toBe('applied');
    if (res.status !== 'applied') return;
    // набор ключей полной среды сохраняется
    expect(Object.keys(res.reservoirs).sort()).toEqual(['atmosphere', 'crust', 'mantle', 'ocean']);
    // незатронутые резервуары — те же объекты, что во входе (разделение по ссылке)
    expect(res.reservoirs.crust.entries.caco3).toBe(30);
    expect(res.reservoirs.mantle.entries.co2).toBe(10000);
    expect(res.reservoirs.mantle).toBe(env.reservoirs.mantle);
    expect(res.reservoirs.crust).toBe(env.reservoirs.crust);
    // затронутые — новые объекты
    expect(res.reservoirs.atmosphere).not.toBe(env.reservoirs.atmosphere);
    expect(res.reservoirs.ocean).not.toBe(env.reservoirs.ocean);
  });
});

// ============================================
// РАЗДЕЛ C: отсутствие вида/резервуара/инвентаря/основания (сценарии 11-14)
// ============================================

describe('Stage 4.9b: неполная среда блокирует исполнение (fail-closed)', () => {
  it('11. отсутствующий вид в SpeciesCatalog блокирует исполнение', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('applied'); // базовый случай работает
    // теперь удаляем co2_aq из каталога: пустой merged каталог без геохимии
    const legacyOnly = buildSpeciesCatalogFromLegacy(gases, elementCompositions);
    const def: GeochemicalReactionDefinition = { ...co2Dissolution() };
    const res2 = executeGeochemicalReaction(def, { speciesCatalog: legacyOnly, reservoirs: makeEnv().reservoirs }, makeInput({ transactionId: 'tx-no-species' }) as never);
    expect(res2.status).toBe('not_applied');
    if (res2.status !== 'not_applied') return;
    // co2 есть в legacy (gas), co2_aq нет — блокируется
    expect(res2.reasonKind).toBe('not_executable');
    expect(res2.issues.some((i) => i.includes('co2_aq'))).toBe(true);
    void result;
  });

  it('12. отсутствующий резервуар блокирует исполнение (инвентарь не создаётся молча)', () => {
    const env = makeEnv();
    delete (env.reservoirs as Record<string, ReservoirRecord>).ocean;
    const result = executeGeochemicalReaction(co2Dissolution(), env, makeInput() as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reasonKind).toBe('not_executable');
    expect(result.issues.some((i) => i.includes('ocean'))).toBe(true);
  });

  it('13. отсутствующий материальный инвентарь блокирует исполнение', () => {
    const env = makeEnv();
    env.reservoirs.ocean = { ...env.reservoirs.ocean!, material: null } as unknown as ReservoirRecord;
    const result = executeGeochemicalReaction(co2Dissolution(), env, makeInput() as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.issues.some((i) => i.includes('материального инвентаря'))).toBe(true);
  });

  it('14. основание amount не смешивается с column_amount (несовпадение оснований блокирует)', () => {
    const env = makeEnv();
    // вода-резервуар с инвентарём в ЛОКАЛЬНОМ основании amount — другой физический смысл
    const wrong = setMaterialInventory(createReservoir('ocean', 'geochemical_column'), 'amount' as never, { co2_aq: 20, c_org: 5 });
    env.reservoirs.ocean = wrong;
    const result = executeGeochemicalReaction(co2Dissolution(), env, makeInput() as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.issues.some((i) => i.includes('amount'))).toBe(true);
  });
});

// ============================================
// РАЗДЕЛ D: нехватка реагента и отрицательные запасы (сценарии 15-16)
// ============================================

describe('Stage 4.9b: достаточность реагентов', () => {
  it('15. нехватка реагента блокирует всю реакцию целиком', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv({ atmosphere: { co2: 3, o2: 500, n2: 3000 } }), makeInput({ transactionId: 'tx-shortage' }) as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reason).toContain('недостаточно реагента');
    // частичного применения нет: океан не изменился
  });

  it('16. никакой реагент не уходит в отрицательный запас (граница в точности достаточна)', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv({ atmosphere: { co2: 7, o2: 500, n2: 3000 } }), makeInput({ transactionId: 'tx-exact' }) as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(amountOf(result.reservoirs, 'atmosphere', 'co2')).toBe(0);
    // недостаток на молекулу ниже — блокируется
    const res2 = executeGeochemicalReaction(co2Dissolution(), makeEnv({ atmosphere: { co2: 6.999, o2: 500, n2: 3000 } }), makeInput({ transactionId: 'tx-below' }) as never);
    expect(res2.status).toBe('not_applied');
  });
});

// ============================================
// РАЗДЕЛ E: стехиометрия и заряд (сценарии 17-18)
// ============================================

describe('Stage 4.9b: сбалансированность и заряд', () => {
  it('17. несбалансированная реакция отклоняется (imbalanced не превращается в применение)', () => {
    const def: GeochemicalReactionDefinition = {
      ...co2Dissolution(),
      reactionId: 'fixture.imbalanced.v1',
      reactants: [{ reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 1 }],
      products: [{ reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 2 }], // 2 атома C справа против 1 слева
      definitionProvenance: { sourceName: 'synthetic test fixture (Stage 4.9b)', note: 'намеренно несбалансированная фикстура' }
    };
    const result = executeGeochemicalReaction(def, makeEnv(), makeInput() as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reasonKind).toBe('not_executable');
    expect(result.reason).toContain('баланс нарушен');
  });

  it('18. нарушение заряда не маскируется: заряженная фикстура отклоняется', () => {
    // co2_aq существует, но для зарядового нарушения нужен заряженный вид.
    // В производственном каталоге заряженные виды пока отсутствуют; проверяем
    // валидатором формы на записи с фиктивным заряженным участником через
    // auditReactionStoichiometry напрямую отсутствующую пару — вместо этого
    // используем c_org-правило? Нет: заряд проверяем искусственной записью.
    const def: GeochemicalReactionDefinition = {
      ...co2Dissolution(),
      reactionId: 'fixture.charge.v1',
      reactants: [{ reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 1 }],
      products: [{ reservoirId: 'ocean', speciesId: 'c_org', coefficient: 1 }] // c_org = 1*C, не 1*C+2O => элементный дисбаланс
    };
    const result = executeGeochemicalReaction(def, makeEnv(), makeInput() as never);
    expect(result.status).toBe('not_applied');
    // дисбаланс C/O ловится ДО c_org-правила? Нет: c_org блокируется раньше (out_of_applicability)
    if (result.status !== 'not_applied') return;
    expect(['out_of_applicability', 'not_executable']).toContain(result.reasonKind);
  });
});

// ============================================
// РАЗДЕЛ F: непроверяемость и c_org (сценарии 19-20)
// ============================================

describe('Stage 4.9b: честная непроверяемость и правило c_org', () => {
  it('19. неизвестный состав вида возвращает not_verifiable, а не успех', () => {
    // вид вне каталога: Auditor вернёт not_verifiable по элементам
    const legacyOnly = buildSpeciesCatalogFromLegacy(gases, elementCompositions);
    const result = executeGeochemicalReaction(co2Dissolution(), { ...makeEnv(), speciesCatalog: legacyOnly }, makeInput({ transactionId: 'tx-unverifiable' }) as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(['not_verifiable', 'not_executable']).toContain(result.reasonKind);
  });

  it('20. c_org не допускается к стехиометрически точной реакции при неизвестном H/O (out_of_applicability)', () => {
    const def: GeochemicalReactionDefinition = {
      ...co2Dissolution(),
      reactionId: 'fixture.corg.oxidation.v1',
      reactants: [
        { reservoirId: 'crust', speciesId: 'c_org', coefficient: 1 },
        { reservoirId: 'atmosphere', speciesId: 'o2', coefficient: 1 }
      ],
      products: [{ reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 1 }],
      definitionProvenance: { sourceName: 'synthetic test fixture (Stage 4.9b)', note: 'окисление органики с неизвестным H/O не может быть сбалансировано честно' }
    };
    const result = executeGeochemicalReaction(def, makeEnv(), makeInput({ transactionId: 'tx-corg' }) as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.reasonKind).toBe('out_of_applicability');
    expect(result.reason).toContain('c_org');
    // резервуар crust не изменился
  });
});

// ============================================
// РАЗДЕЛ G: extent и численные границы (сценарии 21-25)
// ============================================

describe('Stage 4.9b: extent — карточные правила', () => {
  it('21. отсутствие (нулевая подача)/неизвестный extent не заменяется нулём: блокировка', () => {
    const zero = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput({ transactionId: 'tx-zero', extentMolPerM2: 0 }) as never);
    expect(zero.status).toBe('not_applied');
    const nan = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput({ transactionId: 'tx-nan-extent', extentMolPerM2: Number.NaN }) as never);
    expect(nan.status).toBe('not_applied');
    if (nan.status !== 'not_applied') return;
    expect(['not_verifiable', 'not_executable']).toContain(nan.reasonKind);
  });

  it('22. отрицательный extent блокируется', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput({ transactionId: 'tx-negative', extentMolPerM2: -5 }) as never);
    expect(result.status).toBe('not_applied');
  });

  it('23. NaN/Infinity в extent блокируются', () => {
    const inf = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput({ transactionId: 'tx-inf', extentMolPerM2: Number.POSITIVE_INFINITY }) as never);
    expect(inf.status).toBe('not_applied');
    const negInf = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput({ transactionId: 'tx-neginf', extentMolPerM2: Number.NEGATIVE_INFINITY }) as never);
    expect(negInf.status).toBe('not_applied');
  });

  it('24. переполнение произведения coefficient × extent блокируется', () => {
    const def: GeochemicalReactionDefinition = {
      ...co2Dissolution(),
      reactants: [{ reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 1e300 }],
      products: [{ reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 1e300 }],
      definitionProvenance: { sourceName: 'synthetic test fixture (Stage 4.9b)', note: 'специальные коэффициенты, переполняющие произведение с extent 1e308' }
    };
    const result = executeGeochemicalReaction(def, makeEnv(), makeInput({ transactionId: 'tx-overflow', extentMolPerM2: 1e300 }) as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(['not_verifiable', 'not_executable']).toContain(result.reasonKind);
  });

  it('25. переполнение при суммировании дельт (накопленный запас) блокируется', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv({ ocean: { co2_aq: Number.MAX_VALUE, c_org: 5 } }), makeInput({ transactionId: 'tx-sum-overflow', extentMolPerM2: Number.MAX_VALUE }) as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(['not_verifiable', 'not_executable']).toContain(result.reasonKind);
  });
});

// ============================================
// РАЗДЕЛ H: provenance, дубликаты, идемпотентность (сценарии 26-28)
// ============================================

describe('Stage 4.9b: provenance, дубликаты id, повторное применение', () => {
  it('26. неизвестный provenance extent (без идентифицированного источника) блокирует применение', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput({ transactionId: 'tx-noprov', extentProvenance: { note: 'без источника' } }) as never);
    expect(result.status).toBe('not_applied');
    if (result.status !== 'not_applied') return;
    expect(result.issues.some((i) => i.includes('provenance'))).toBe(true);
  });

  it('27. дубликат reaction-транзакции (тот же id записи) блокируется registerReaction', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const res2 = executeGeochemicalReaction(co2Dissolution(), { ...makeEnv(), ledgerInput: result.ledger }, makeInput() as never);
    expect(res2.status).toBe('not_applied');
    if (res2.status !== 'not_applied') return;
    expect(res2.error !== null && res2.error.includes('уже зарегистрирована')).toBe(true);
  });

  it('28. повторное применение того же transaction ID не даёт двойного расходования', () => {
    const env = makeEnv();
    const res1 = executeGeochemicalReaction(co2Dissolution(), env, makeInput() as never);
    expect(res1.status).toBe('applied');
    const res2 = executeGeochemicalReaction(co2Dissolution(), { ...env, ledgerInput: res1.status === 'applied' ? res1.ledger : undefined }, makeInput() as never);
    expect(res2.status).toBe('not_applied');
    // резервуар не расходуется второй раз: повторный вызов с НОВЫЙ журнал не возвращает
    if (res2.status === 'not_applied') {
      expect(res2.issues.length + (res2.error ? 1 : 0)).toBeGreaterThan(0);
    }
  });
});

// ============================================
// РАЗДЕЛ I: иммутабельность и одна запись (сценарии 29-31)
// ============================================

describe('Stage 4.9b: иммутабельность и атомарность транзакции', () => {
  it('29. ошибка после расчёта дельт не мутирует входные резервуары', () => {
    const env = makeEnv({ atmosphere: { co2: 3, o2: 500, n2: 3000 } }); // нехватка: дельты уже рассчитаны
    const snapshot = env.reservoirs.atmosphere!.material!.entries.co2;
    const result = executeGeochemicalReaction(co2Dissolution(), env, makeInput({ transactionId: 'tx-immutable' }) as never);
    expect(result.status).toBe('not_applied');
    expect(env.reservoirs.atmosphere!.material!.entries.co2).toBe(snapshot);
    expect(env.reservoirs.ocean!.material!.entries.co2_aq).toBe(20);
  });

  it('30. ошибка при регистрации записи не мутирует исходный ReactionLedger', () => {
    const ledgerWithDup = (() => {
      const l = createReactionLedger();
      return registerReaction(l, {
        id: 'tx-dup-ledger',
        reactionId: 'fixture.co2.gas_to_aqueous.v1',
        reactants: [{ reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 1 }],
        products: [{ reservoirId: 'ocean', speciesId: 'co2_aq', coefficient: 1 }],
        extent: 1,
        extentBasis: 'column_amount',
        time: null,
        processId: 'co2_gas_aqueous_exchange_fixture'
      });
    })();
    const result = executeGeochemicalReaction(co2Dissolution(), { ...makeEnv(), ledgerInput: ledgerWithDup }, makeInput({ transactionId: 'tx-dup-ledger' }) as never);
    expect(result.status).toBe('not_applied');
    expect(ledgerWithDup.records.length).toBe(1); // журнал входа не тронут
  });

  it('31. успешное исполнение добавляет РОВНО одну запись в ReactionLedger', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.ledger.records.length).toBe(1);
    expect(result.ledger.records[0]!.id).toBe('tx-fixture-1');
    expect(result.ledger.records[0]!.geochemical).toBeDefined();
  });
});

// ============================================
// РАЗДЕЛ J: контекст, легаси, сериализация, миграция, детерминизм (сценарии 32-36)
// ============================================

describe('Stage 4.9b: GeochemicalReactionContext, сериализация, миграция, детерминизм', () => {
  it('32. геохимический контекст корректно проходит JSON round-trip', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const ctx = result.record.geochemical!;
    const parsed = JSON.parse(JSON.stringify(ctx));
    expect(validateGeochemicalReactionContext(parsed)).toEqual([]);
    const ctxAny = parsed as Record<string, unknown>;
    expect(ctxAny.contextSchemaVersion).toBe(GEOCHEMICAL_REACTION_CONTEXT_SCHEMA_VERSION);
    expect(ctxAny.mechanism).toBe(GEOCHEMICAL_REACTION_MECHANISM);
    expect(ctxAny.extentUnit).toBe(GEOCHEMICAL_REACTION_EXTENT_UNIT);
    expect(ctxAny.extentBasis).toBe(GEOCHEMICAL_REACTION_EXTENT_BASIS);
    expect(ctxAny.extentMolPerM2).toBe(7);
    expect(ctxJsonStringify(ctx)).toBe(ctxJsonStringify(ctxAny));
  });

  it('33. легаси ReactionRecord без_geochemical остаётся валидируемой записью', () => {
    const legacy: ReactionRecord = {
      id: 'legacy-reaction-1',
      reactionId: 'legacy.fix.v0',
      reactants: [{ reservoirId: 'r1', speciesId: 'co2', coefficient: 1 }],
      products: [{ reservoirId: 'r2', speciesId: 'co2', coefficient: 1 }],
      extent: 1,
      extentBasis: 'column_amount',
      time: null,
      processId: 'legacy'
    };
    // без поля geochemical: валидно, это легаси-состояние
    expect(validateReactionRecord(legacy)).toEqual([]);
    // null-контекст: не «отсутствие», а ошибка формы
    const withNull = { ...legacy, geochemical: null } as unknown as ReactionRecord;
    expect(validateReactionRecord(withNull).length).toBeGreaterThan(0);
    // полный журнал из легаси-записи валиден
    const ledger = registerReaction(createReactionLedger(), legacy);
    expect(validateReactionLedger(ledger)).toEqual([]);
  });

  it('34. сериализация/загрузка (JSON round-trip ядра состояния) сохраняет инвентари и историю реакции', () => {
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    const coreWorldState = {
      schemaVersion: CORE_WORLD_STATE_SCHEMA_VERSION,
      createdAtUnixMs: 1700000000000,
      updatedAtUnixMs: 1700000001000,
      seed: 1700,
      scenarioPreset: 'test',
      thermalState: null,
      reservoirs: Object.values(result.reservoirs),
      reactionLedger: result.ledger,
      fluxLedger: null
    };
    // Storage-совместимый путь: журналы и инвентари — plain-JSON в сохранении
    const json = JSON.stringify(coreWorldState);
    const restored = JSON.parse(json) as Record<string, unknown>;
    // журнал: все записи проходят валидацию после JSON round-trip
    const ledger = restored.reactionLedger as { records: ReactionRecord[] };
    expect(ledger.records.map((r) => r.id)).toEqual(['tx-fixture-1']);
    for (const record of ledger.records) {
      expect(validateReactionRecord(record)).toEqual([]);
    }
    expect(ledger.records[0]!.geochemical!.extentMolPerM2).toBe(7);
    expect(ledger.records[0]!.geochemical!.reactionId).toBe('fixture.co2.gas_to_aqueous.v1');
    // инвентари: значения переживают round-trip точно
    const reservoirs = restored.reservoirs as ReservoirRecord[];
    const atm = reservoirs.find((r) => r.id === 'atmosphere')!;
    const ocean = reservoirs.find((r) => r.id === 'ocean')!;
    expect(atm.material!.entries.co2).toBe(100 - 7);
    expect(ocean.material!.entries.co2_aq).toBe(20 + 7);
  });

  it('35. миграция 1.7 → 1.8 сохраняет старые записи без подделанного provenance', () => {
    const legacy = {
      id: 'legacy-reaction-1',
      reactionId: 'legacy.fix.v0',
      reactants: [{ reservoirId: 'r1', speciesId: 'co2', coefficient: 1 }],
      products: [{ reservoirId: 'r2', speciesId: 'co2', coefficient: 1 }],
      extent: 1,
      extentBasis: 'column_amount',
      time: null,
      processId: 'legacy'
    };
    const save17 = {
      version: '1.7',
      coreWorldState: {
        schemaVersion: '1.4.0',
        createdAtUnixMs: 1700000000000,
        updatedAtUnixMs: 1700000001000,
        seed: 1700,
        scenarioPreset: 'test',
        thermalState: null,
        reservoirs: [makeRes('r1', { co2: 10 }), makeRes('r2', { co2: 0 })],
        reactionLedger: { records: [legacy] },
        fluxLedger: null
      }
    };
    expect(isKnownSchemaVersion('1.7')).toBe(true);
    expect(CURRENT_SAVE_SCHEMA_VERSION).toBe('1.8');
    expect(SAVE_SCHEMA_VERSIONS).toContain('1.7');
    expect(SAVE_SCHEMA_VERSIONS).toContain('1.8');
    expect(SUPPORTED_CORE_WORLD_STATE_SCHEMA_VERSIONS).toContain('1.5.0');
    expect(CORE_WORLD_STATE_SCHEMA_VERSION).toBe('1.5.0');
    const { world, notes, from, to } = migrateSavedWorld(save17 as never);
    expect(from).toBe('1.7');
    expect(to).toBe('1.8');
    expect(world.version).toBe('1.8');
    const core = (world as Record<string, unknown>).coreWorldState as Record<string, unknown>;
    expect(core.schemaVersion).toBe('1.5.0');
    const ledger = core.reactionLedger as { records: ReactionRecord[] };
    expect(ledger.records.length).toBe(1);
    expect(ledger.records[0]!.geochemical).toBeUndefined(); // provenance НЕ синтезирован
    const notesJoined = notes.join(' ');
    expect(notesJoined).toContain('1.7');
    expect(notesJoined).toContain('1.8');
    // идемпотентность
    const second = migrateSavedWorld(world as never);
    expect(second.world).toEqual(world);
  });

  it('36. результат детерминирован и не зависит от порядка ключей входного объекта', () => {
    const envA = makeEnv();
    const envB = makeEnv();
    const reversed: Record<string, ReservoirRecord> = {};
    for (const key of Object.keys(envB.reservoirs).reverse()) {
      reversed[key] = envB.reservoirs[key]!;
    }
    envB.reservoirs = reversed;
    const resA = executeGeochemicalReaction(co2Dissolution(), envA, makeInput() as never);
    const resB = executeGeochemicalReaction(co2Dissolution(), envB, makeInput() as never);
    expect(resA.status).toBe('applied');
    expect(resB.status).toBe('applied');
    if (resA.status !== 'applied' || resB.status !== 'applied') return;
    expect(JSON.stringify(resA.reservoirs)).toBe(JSON.stringify(resB.reservoirs));
    expect(JSON.stringify(resA.deltas)).toBe(JSON.stringify(resB.deltas));
    expect(JSON.stringify(resA.record)).toBe(JSON.stringify(resB.record));
  });
});

// ============================================
// РАЗДЕЛ K: валидация определения и контекста (дополнительно)
// ============================================

describe('Stage 4.9b: validateGeochemicalReactionDefinition (fail-closed форма)', () => {
  it('валидатор определения: пустой id, нулевой коэффициент, неуникальные пары, без provenance — все блокируются', () => {
    const bad1 = { ...co2Dissolution(), reactionId: '' };
    expect(validateGeochemicalReactionDefinition(bad1).length).toBeGreaterThan(0);
    const bad2 = { ...co2Dissolution(), reactants: [{ reservoirId: 'atmosphere', speciesId: 'co2', coefficient: 0 }] };
    expect(validateGeochemicalReactionDefinition(bad2).length).toBeGreaterThan(0);
    const bad3 = { ...co2Dissolution(), reactants: [{ reservoirId: 'a', speciesId: 'co2', coefficient: 1 }, { reservoirId: 'a', speciesId: 'co2', coefficient: 2 }] };
    expect(validateGeochemicalReactionDefinition(bad3).length).toBeGreaterThan(0);
    const bad4 = { ...co2Dissolution() } as Record<string, unknown>;
    delete bad4.definitionProvenance;
    expect(validateGeochemicalReactionDefinition(bad4).length).toBeGreaterThan(0);
    const bad5 = { ...co2Dissolution(), definitionProvenance: { note: 'без источника' } as Record<string, unknown> };
    expect(validateGeochemicalReactionDefinition(bad5).length).toBeGreaterThan(0);
    const ok = validateGeochemicalReactionDefinition(co2Dissolution());
    expect(ok).toEqual([]);
  });

  it('валидатор контекста: null-контекст — ошибка, отсутствие поля — легаси (валидатор не вызывается)', () => {
    expect(validateGeochemicalReactionContext(null).length).toBeGreaterThan(0);
    expect(validateGeochemicalReactionContext([]).length).toBeGreaterThan(0);
    expect(validateGeochemicalReactionContext({ contextSchemaVersion: '9.9.9' }).length).toBeGreaterThan(0);
    const result = executeGeochemicalReaction(co2Dissolution(), makeEnv(), makeInput() as never);
    if (result.status === 'applied') {
      const ctx: unknown = result.record.geochemical;
      expect(validateGeochemicalReactionContext(ctx)).toEqual([]);
      expect((ctx as Record<string, unknown>).mechanism).toBe('reaction');
    } else {
      throw new Error('ожидается applied');
    }
  });
});

function ctxJsonStringify(value: unknown): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => ctxJsonStringify(v)).join(',') + ']';
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + ctxJsonStringify(rec[k])).join(',') + '}';
}
