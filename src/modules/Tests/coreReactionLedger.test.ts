// ============================================
// STAGE 4.2.3.2 - Тесты ReactionLedger: журнал реакционных транзакций
// и стехиометрический аудит
// ============================================
//
// ReactionLedger — самостоятельный контракт Core (4.2.3.2): он НЕ
// входит в CoreWorldState, Scheduler и InvariantAuditor его пока не
// используют. Тесты фиксируют: форму записи, иммутабельную
// регистрацию, честную семантику статусов аудита
// (balanced / imbalanced / not_verifiable / approximate / invalid)
// и проверку вымышленных ux-компонентов с явно объявленным составом.
//
// Корректирующая ревизия Stage 4.2.3.2.1: обязательность time,
// прототип-безопасный учёт зарезервированных имён компонентов,
// строгая форма состава (Map/класс → not_verifiable), переполнение,
// валидация tolerance и note, однозначные пары участников.

import { describe, it, expect } from 'vitest';
import {
  createReactionLedger,
  registerReaction,
  validateReactionRecord,
  validateReactionLedger,
  auditReactionStoichiometry,
  auditReactionLedger,
  ReactionLedgerError
} from '../Core/reactionLedger';
import type { ReactionRecord, ReactionExtentBasis } from '../Core/reactionLedger';
import { createSpeciesCatalog } from '../Core/species';
import type { ScientificSpecies, SpeciesCatalog } from '../Core/species';

function makeSpecies(overrides: Partial<ScientificSpecies> = {}): ScientificSpecies {
  return {
    id: 'h2o',
    formula: 'H2O',
    name: 'вода',
    elements: { H: 2, O: 1 },
    charge: 0,
    phase: 'gas',
    molarMassKgMol: 0.01801528,
    molarMassStatus: 'known',
    dataStatus: 'known',
    ...overrides
  };
}

function makeCatalog(): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  catalog.register(makeSpecies()); // h2o (gas)
  catalog.register(makeSpecies({ id: 'h2o_liq', phase: 'liquid' }));
  catalog.register(makeSpecies({ id: 'h2', formula: 'H2', elements: { H: 2 }, molarMassKgMol: 0.002016 }));
  catalog.register(makeSpecies({ id: 'o2', formula: 'O2', elements: { O: 2 }, molarMassKgMol: 0.032 }));
  catalog.register(makeSpecies({ id: 'co2', formula: 'CO2', elements: { C: 1, O: 2 }, molarMassKgMol: 0.0440095 }));
  catalog.register(makeSpecies({
    id: 'h2co3',
    formula: 'H2CO3',
    elements: { C: 1, H: 2, O: 3 },
    molarMassKgMol: 0.0620248
  }));
  catalog.register(makeSpecies({ id: 'h_plus', formula: 'H+', elements: { H: 1 }, charge: 1, phase: 'aqueous' }));
  catalog.register(makeSpecies({ id: 'cat', formula: 'Fe', elements: { Fe: 1 }, molarMassKgMol: 0.055845 }));
  // оценочный, но численно проверяемый состав
  catalog.register(makeSpecies({ id: 'est_h2o', dataStatus: 'estimated', molarMassStatus: 'estimated' }));
  // состав объявлен явно, но статус данных unknown: пустые elements НЕ доказательство отсутствия атомов
  catalog.register(makeSpecies({
    id: 'declared_unknown',
    formula: 'X?',
    elements: { X: 1 },
    dataStatus: 'unknown',
    molarMassKgMol: null,
    molarMassStatus: 'unknown',
    phase: 'other'
  }));
  catalog.register(makeSpecies({
    id: 'not_impl',
    formula: 'NI',
    elements: { N: 1, I: 1 },
    dataStatus: 'not_implemented',
    molarMassKgMol: null,
    molarMassStatus: 'not_implemented',
    phase: 'other'
  }));
  // вымышленные гипотетические компоненты с явно объявленным составом
  catalog.register(makeSpecies({
    id: 'ux_mote',
    formula: 'UxMote',
    elements: { 'ux:element_x': 1 },
    molarMassKgMol: null,
    molarMassStatus: 'unknown',
    phase: 'other',
    name: 'гипотетическая пылинка'
  }));
  catalog.register(makeSpecies({
    id: 'ux_dust',
    formula: 'UxDust',
    elements: { 'ux:element_x': 2 },
    molarMassKgMol: null,
    molarMassStatus: 'unknown',
    phase: 'other',
    name: 'гипотетическая пыль'
  }));
  return catalog;
}

function makeRecord(overrides: Partial<ReactionRecord> = {}): ReactionRecord {
  return {
    id: 'rxn-1',
    reactionId: 'water-formation',
    reactants: [
      { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
      { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
    ],
    products: [
      { reservoirId: 'atm', speciesId: 'h2o', coefficient: 2 }
    ],
    extent: 3,
    extentBasis: 'amount',
    time: { segmentIndex: 0, localTimeS: 3600 },
    ...overrides
  };
}

describe('Stage 4.2.3.2 ReactionLedger: создание и регистрация', () => {
  it('пустой журнал создаётся и проходит валидацию', () => {
    const ledger = createReactionLedger();
    expect(ledger).toEqual({ records: [] });
    expect(validateReactionLedger(ledger)).toEqual([]);
  });

  it('регистрация возвращает новый журнал и не мутирует исходный; запись хранится копией', () => {
    const ledger = createReactionLedger();
    const before = JSON.stringify(ledger);
    const record = makeRecord();
    const registered = registerReaction(ledger, record);
    expect(ledger.records.length).toBe(0);
    expect(JSON.stringify(ledger)).toBe(before);
    expect(registered.records.length).toBe(1);
    expect(registered.records[0]).not.toBe(record);
    // мутация исходного объекта после регистрации не искажает журнал
    record.reactants[0].coefficient = 999;
    record.time = null;
    expect(registered.records[0].reactants[0].coefficient).toBe(2);
    expect(registered.records[0].time).toEqual({ segmentIndex: 0, localTimeS: 3600 });
  });

  it('дублирующийся id транзакции отклоняется', () => {
    const ledger = registerReaction(createReactionLedger(), makeRecord());
    let caught: unknown = null;
    try {
      registerReaction(ledger, makeRecord());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReactionLedgerError);
    expect((caught as ReactionLedgerError).code).toBe('duplicate_reaction_id');
    expect((caught as ReactionLedgerError).recordId).toBe('rxn-1');
    expect((caught as ReactionLedgerError).message).toContain('уже зарегистрирована');
  });

  it('пустые id, reactionId, speciesId и reservoirId отклоняются', () => {
    expect(validateReactionRecord(makeRecord({ id: '  ' }))[0]).toContain('id транзакции');
    expect(validateReactionRecord(makeRecord({ reactionId: '' }))[0]).toContain('reactionId');
    expect(validateReactionRecord(makeRecord({
      reactants: [{ reservoirId: '', speciesId: 'h2', coefficient: 1 }]
    }))[0]).toContain('reservoirId');
    expect(validateReactionRecord(makeRecord({
      products: [{ reservoirId: 'atm', speciesId: '', coefficient: 1 }]
    }))[0]).toContain('speciesId');
    let caught: unknown = null;
    try {
      registerReaction(createReactionLedger(), makeRecord({ id: '' }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReactionLedgerError);
    expect((caught as ReactionLedgerError).code).toBe('invalid_reaction');
  });

  it('пустые списки реагентов и продуктов отклоняются', () => {
    expect(validateReactionRecord(makeRecord({ reactants: [] }))[0]).toContain('reactants');
    expect(validateReactionRecord(makeRecord({ products: [] }))[0]).toContain('products');
  });

  it('нулевой, отрицательный, NaN и Infinity extent отклоняются', () => {
    for (const extent of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const problems = validateReactionRecord(makeRecord({ extent }));
      expect(problems.length).toBe(1);
      expect(problems[0]).toContain('extent');
    }
  });

  it('нулевой, отрицательный, NaN и Infinity коэффициент отклоняются', () => {
    const badCoefficient = (coefficient: number): string[] =>
      validateReactionRecord(makeRecord({
        reactants: [{ reservoirId: 'atm', speciesId: 'h2', coefficient }]
      }));
    for (const coefficient of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const problems = badCoefficient(coefficient);
      expect(problems.length).toBe(1);
      expect(problems[0]).toContain('коэффициент');
    }
  });

  it('неизвестный extentBasis отклоняется; допустимые основания принимаются', () => {
    const bad = makeRecord();
    bad.extentBasis = 'mass' as unknown as ReactionExtentBasis;
    const problems = validateReactionRecord(bad);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('extentBasis');
    expect(validateReactionRecord(makeRecord({ extentBasis: 'amount' }))).toEqual([]);
    expect(validateReactionRecord(makeRecord({ extentBasis: 'column_amount' }))).toEqual([]);
    const ledger = registerReaction(createReactionLedger(), makeRecord({ id: 'rxn-col', extentBasis: 'column_amount' }));
    expect(ledger.records.length).toBe(1);
  });

  it('временная метка: null допустим, некорректные формы отклоняются', () => {
    expect(validateReactionRecord(makeRecord({ time: null }))).toEqual([]);
    expect(validateReactionRecord(makeRecord({
      time: { segmentIndex: -1, localTimeS: 0 } as ReactionRecord['time']
    }))[0]).toContain('segmentIndex');
    expect(validateReactionRecord(makeRecord({
      time: { segmentIndex: 0, localTimeS: Number.NaN } as ReactionRecord['time']
    }))[0]).toContain('localTimeS');
    const stringTime = makeRecord({ time: null });
    (stringTime as unknown as { time: string }).time = '2026-10-31';
    expect(validateReactionRecord(stringTime)[0]).toContain('time');
  });

  it('ссылки на резервуары проверяются при передаче списка', () => {
    const ledger = registerReaction(createReactionLedger(), makeRecord({
      products: [{ reservoirId: 'ocean', speciesId: 'h2o_liq', coefficient: 2 }]
    }));
    const narrow = validateReactionLedger(ledger, { reservoirIds: ['atm'] });
    expect(narrow.length).toBe(1);
    expect(narrow[0]).toContain('ocean');
    expect(validateReactionLedger(ledger, { reservoirIds: ['atm', 'ocean'] })).toEqual([]);
  });
});

describe('Stage 4.2.3.2 ReactionLedger: форма сторон записи', () => {
  it('дублирование пары резервуар+вид на одной стороне отклоняется', () => {
    const problems = validateReactionRecord(makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 }
      ]
    }));
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('объединены заранее');
  });

  it('один и тот же вид в разных резервуарах допустим', () => {
    const record = makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2o', coefficient: 1 },
        { reservoirId: 'ocean', speciesId: 'h2o', coefficient: 1 }
      ],
      products: [{ reservoirId: 'atm', speciesId: 'h2o_liq', coefficient: 2 }]
    });
    expect(validateReactionRecord(record)).toEqual([]);
  });

  it('рациональные (дробные) коэффициенты допустимы', () => {
    const record = makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 0.5 }],
      products: [{ reservoirId: 'atm', speciesId: 'h2o_liq', coefficient: 0.5 }]
    });
    expect(validateReactionRecord(record)).toEqual([]);
    expect(auditReactionStoichiometry(record, makeCatalog()).status).toBe('balanced');
  });
});

describe('Stage 4.2.3.2 ReactionLedger: стехиометрический аудит', () => {
  it('2 H2 + O2 → 2 H2O: элементный и зарядовый баланс подтверждены', () => {
    const result = auditReactionStoichiometry(makeRecord(), makeCatalog());
    expect(result.status).toBe('balanced');
    expect(result.reactantElements).toEqual({ H: 4, O: 2 });
    expect(result.productElements).toEqual({ H: 4, O: 2 });
    expect(result.reactantCharge).toBe(0);
    expect(result.productCharge).toBe(0);
    expect(result.elementIssues).toEqual([]);
    expect(result.chargeIssues).toEqual([]);
    expect(result.missingSpecies).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('нарушение элементного баланса обнаруживается', () => {
    const result = auditReactionStoichiometry(makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
      ],
      products: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 1 }]
    }), makeCatalog());
    expect(result.status).toBe('imbalanced');
    expect(result.elementIssues.length).toBe(1);
    expect(result.elementIssues[0]).toContain('O');
    expect(result.chargeIssues).toEqual([]);
    expect(result.diagnostics.some((d) => d.includes('O'))).toBe(true);
  });

  it('нарушение зарядового баланса обнаруживается', () => {
    const result = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'ocean', speciesId: 'h_plus', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'h2', coefficient: 1 }]
    }), makeCatalog());
    expect(result.status).toBe('imbalanced');
    expect(result.chargeIssues.length).toBe(1);
    expect(result.chargeIssues[0]).toContain('заряд');
    expect(result.elementIssues).toEqual([]);
  });

  it('вид вне каталога → not_verifiable: вклад не считается нулевым', () => {
    const result = auditReactionStoichiometry(makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'mystery', coefficient: 1 }
      ],
      products: [{ reservoirId: 'atm', speciesId: 'h2', coefficient: 1 }]
    }), makeCatalog());
    expect(result.status).toBe('not_verifiable');
    expect(result.missingSpecies).toEqual(['mystery']);
    // частичные данные сохранены, но статус не объявляет imbalanced
    expect(result.reactantElements).toEqual({ H: 2 });
    expect(result.diagnostics.some((d) => d.includes('mystery'))).toBe(true);
  });

  it('dataStatus unknown → not_verifiable, а не balanced', () => {
    const result = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'declared_unknown', coefficient: 1 }],
      products: [{ reservoirId: 'atm', speciesId: 'declared_unknown', coefficient: 1 }]
    }), makeCatalog());
    // численно X:1 = X:1, но состав непроверяем — пустые элементы не доказательство
    expect(result.status).toBe('not_verifiable');
    expect(result.status).not.toBe('balanced');
    expect(result.unprovenSpecies).toEqual(['declared_unknown']);
  });

  it('dataStatus not_implemented → not_verifiable', () => {
    const result = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'h2', coefficient: 1 }],
      products: [{ reservoirId: 'atm', speciesId: 'not_impl', coefficient: 1 }]
    }), makeCatalog());
    expect(result.status).toBe('not_verifiable');
    expect(result.unprovenSpecies).toEqual(['not_impl']);
  });

  it('dataStatus estimated при численно согласованном балансе → approximate', () => {
    const result = auditReactionStoichiometry(makeRecord({
      products: [{ reservoirId: 'atm', speciesId: 'est_h2o', coefficient: 2 }]
    }), makeCatalog());
    expect(result.status).toBe('approximate');
    expect(result.estimatedSpecies).toEqual(['est_h2o']);
    expect(result.elementIssues).toEqual([]);
    expect(result.diagnostics.some((d) => d.includes('оценочный'))).toBe(true);
  });

  it('оценочный состав не маскирует реальное нарушение', () => {
    const result = auditReactionStoichiometry(makeRecord({
      products: [{ reservoirId: 'atm', speciesId: 'est_h2o', coefficient: 1 }]
    }), makeCatalog());
    expect(result.status).toBe('imbalanced');
    expect(result.elementIssues.length).toBe(2); // H: 4→2 и O: 2→1
    expect(result.estimatedSpecies).toEqual(['est_h2o']);
  });

  it('катализатор: один и тот же вид на обеих сторонах допустим', () => {
    const record = makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'cat', coefficient: 1 }
      ],
      products: [
        { reservoirId: 'atm', speciesId: 'h2o', coefficient: 2 },
        { reservoirId: 'atm', speciesId: 'cat', coefficient: 1 }
      ]
    });
    const result = auditReactionStoichiometry(record, makeCatalog());
    expect(result.status).toBe('balanced');
    expect(result.reactantElements).toEqual({ H: 4, O: 2, Fe: 1 });
    expect(result.productElements).toEqual({ H: 4, O: 2, Fe: 1 });
  });

  it('реакция между резервуарами: CO2(atm) + H2O(ocean) → H2CO3(ocean)', () => {
    const result = auditReactionStoichiometry(makeRecord({
      id: 'rxn-carbonic',
      reactionId: 'carbon-dissolution',
      reactants: [
        { reservoirId: 'atm', speciesId: 'co2', coefficient: 1 },
        { reservoirId: 'ocean', speciesId: 'h2o_liq', coefficient: 1 }
      ],
      products: [{ reservoirId: 'ocean', speciesId: 'h2co3', coefficient: 1 }]
    }), makeCatalog());
    expect(result.status).toBe('balanced');
    expect(result.reactantElements).toEqual({ C: 1, H: 2, O: 3 });
    expect(result.productElements).toEqual({ C: 1, H: 2, O: 3 });
  });

  it('один вид в двух резервуарах: h2o(atm) + h2o(ocean) → 2 h2o_liq', () => {
    const result = auditReactionStoichiometry(makeRecord({
      id: 'rxn-condense',
      reactionId: 'condensation',
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2o', coefficient: 1 },
        { reservoirId: 'ocean', speciesId: 'h2o', coefficient: 1 }
      ],
      products: [{ reservoirId: 'ocean', speciesId: 'h2o_liq', coefficient: 2 }]
    }), makeCatalog());
    expect(result.status).toBe('balanced');
    expect(result.reactantElements).toEqual({ H: 4, O: 2 });
    expect(result.productElements).toEqual({ H: 4, O: 2 });
  });

  it('вымышленные ux-компоненты: алгебраический баланс проверяется без молярной массы', () => {
    const catalog = makeCatalog();
    expect(catalog.get('ux_mote')?.molarMassKgMol).toBeNull();
    const balanced = auditReactionStoichiometry(makeRecord({
      id: 'rxn-ux',
      reactionId: 'ux-dimerization',
      reactants: [{ reservoirId: 'weird', speciesId: 'ux_mote', coefficient: 2 }],
      products: [{ reservoirId: 'weird', speciesId: 'ux_dust', coefficient: 1 }],
      extentBasis: 'column_amount'
    }), catalog);
    expect(balanced.status).toBe('balanced');
    expect(balanced.reactantElements).toEqual({ 'ux:element_x': 2 });
    const imbalanced = auditReactionStoichiometry(makeRecord({
      id: 'rxn-ux-bad',
      reactionId: 'ux-dimerization',
      reactants: [{ reservoirId: 'weird', speciesId: 'ux_mote', coefficient: 3 }],
      products: [{ reservoirId: 'weird', speciesId: 'ux_dust', coefficient: 1 }]
    }), catalog);
    expect(imbalanced.status).toBe('imbalanced');
    expect(imbalanced.elementIssues[0]).toContain('ux:element_x');
  });

  it('extent не влияет на стехиометрию; некорректная форма → invalid, а не imbalanced', () => {
    const catalog = makeCatalog();
    expect(auditReactionStoichiometry(makeRecord({ extent: 0.5 }), catalog).status).toBe('balanced');
    expect(auditReactionStoichiometry(makeRecord({ extent: 1000 }), catalog).status).toBe('balanced');
    const broken = auditReactionStoichiometry(makeRecord({ extent: 0 }), catalog);
    expect(broken.status).toBe('invalid');
    expect(broken.formIssues.length).toBe(1);
    expect(broken.diagnostics.some((d) => d.includes('валидацию'))).toBe(true);
  });

  it('аудит повторяем: одинаковые входы дают одинаковый результат', () => {
    const catalog = makeCatalog();
    const record = makeRecord();
    const first = auditReactionStoichiometry(record, catalog);
    const second = auditReactionStoichiometry(record, catalog);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('аудит не изменяет входные запись, журнал и каталог', () => {
    const catalog = makeCatalog();
    const ledger = registerReaction(createReactionLedger(), makeRecord());
    const ledgerBefore = JSON.stringify(ledger);
    const idsBefore = JSON.stringify(catalog.listIds());
    const audit = auditReactionLedger(ledger, catalog, { reservoirIds: ['atm'] });
    auditReactionStoichiometry(ledger.records[0], catalog);
    expect(audit.status).toBe('balanced');
    expect(JSON.stringify(ledger)).toBe(ledgerBefore);
    expect(JSON.stringify(catalog.listIds())).toBe(idsBefore);
  });
});

describe('Stage 4.2.3.2 ReactionLedger: агрегированный аудит журнала', () => {
  it('пустой журнал → balanced', () => {
    const audit = auditReactionLedger(createReactionLedger(), makeCatalog());
    expect(audit.status).toBe('balanced');
    expect(audit.recordAudits.length).toBe(0);
    expect(audit.formIssues).toEqual([]);
  });

  it('журнал со сбалансированной записью → balanced', () => {
    const ledger = registerReaction(createReactionLedger(), makeRecord());
    const audit = auditReactionLedger(ledger, makeCatalog());
    expect(audit.status).toBe('balanced');
    expect(audit.recordAudits.length).toBe(1);
    expect(audit.recordAudits[0].recordId).toBe('rxn-1');
    expect(audit.recordAudits[0].status).toBe('balanced');
    expect(audit.diagnostics).toEqual([]);
  });

  it('любая несбалансированная запись делает журнал imbalanced', () => {
    let ledger = registerReaction(createReactionLedger(), makeRecord({ id: 'rxn-ok' }));
    ledger = registerReaction(ledger, makeRecord({
      id: 'rxn-bad',
      reactants: [
        { reservoirId: 'atm', speciesId: 'h2', coefficient: 1 },
        { reservoirId: 'atm', speciesId: 'o2', coefficient: 1 }
      ],
      products: [{ reservoirId: 'atm', speciesId: 'h2o', coefficient: 1 }]
    }));
    const audit = auditReactionLedger(ledger, makeCatalog());
    expect(audit.status).toBe('imbalanced');
    expect(audit.recordAudits.map((r) => r.status)).toEqual(['balanced', 'imbalanced']);
  });

  it('not_verifiable без imbalanced → not_verifiable', () => {
    let ledger = registerReaction(createReactionLedger(), makeRecord({ id: 'rxn-ok' }));
    ledger = registerReaction(ledger, makeRecord({
      id: 'rxn-unknown',
      reactants: [{ reservoirId: 'atm', speciesId: 'mystery', coefficient: 1 }],
      products: [{ reservoirId: 'atm', speciesId: 'mystery', coefficient: 1 }]
    }));
    const audit = auditReactionLedger(ledger, makeCatalog());
    expect(audit.status).toBe('not_verifiable');
    expect(audit.recordAudits.map((r) => r.status)).toEqual(['balanced', 'not_verifiable']);
  });

  it('approximate без нарушений → approximate', () => {
    const ledger = registerReaction(createReactionLedger(), makeRecord({
      id: 'rxn-est',
      products: [{ reservoirId: 'atm', speciesId: 'est_h2o', coefficient: 2 }]
    }));
    expect(auditReactionLedger(ledger, makeCatalog()).status).toBe('approximate');
  });

  it('структурно некорректная запись → invalid', () => {
    const broken = createReactionLedger();
    broken.records.push(makeRecord({ id: '', extent: 0 }));
    const audit = auditReactionLedger(broken, makeCatalog());
    expect(audit.status).toBe('invalid');
    expect(audit.formIssues.length).toBeGreaterThan(0);
    expect(audit.recordAudits[0].status).toBe('invalid');
  });
});

// ============================================
// STAGE 4.2.3.2.1 - Корректирующая ревизия: регрессионные тесты
// ============================================

/**
 * Каталог-заглушка: отдаёт заданные виды напрямую — для форм, которые
 * не проходят регистрацию настоящего каталога (например elements: null).
 */
function stubCatalogWith(species: ScientificSpecies[]): SpeciesCatalog {
  const byId = new Map(species.map((s) => [s.id, s]));
  return {
    register: () => {
      throw new Error('каталог-заглушка: регистрация недоступна');
    },
    get: (id: string) => byId.get(id) ?? null,
    has: (id: string) => byId.has(id),
    listIds: () => [...byId.keys()],
    size: () => byId.size,
    findByFormula: () => []
  };
}

/** Виды с зарезервированными именами компонентов в составе. */
function makeReservedCatalog(): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  const exotic = (id: string, formula: string, elements: Record<string, number>) =>
    makeSpecies({ id, formula, elements, molarMassKgMol: null, molarMassStatus: 'unknown', phase: 'other' });
  catalog.register(exotic('ctor_a', 'CtA', { constructor: 1 }));
  catalog.register(exotic('ctor_b', 'CtB', { constructor: 2 }));
  catalog.register(exotic('ctor_c', 'CtC', { constructor: 3 }));
  catalog.register(exotic('tostr_a', 'TsA', { toString: 1 }));
  catalog.register(exotic('tostr_b', 'TsB', { toString: 2 }));
  catalog.register(exotic('hop_a', 'HpA', { hasOwnProperty: 1 }));
  catalog.register(exotic('hop_b', 'HpB', { hasOwnProperty: 2 }));
  // собственный ключ '__proto__' создан безопасно: Object.fromEntries
  // определяет собственное свойство данных, не трогая прототип
  catalog.register(exotic('proto_a', 'PrA', Object.fromEntries([['__proto__', 1]])));
  catalog.register(exotic('proto_b', 'PrB', Object.fromEntries([['__proto__', 2]])));
  catalog.register(exotic('ux_mote', 'UxMote', { 'ux:element_x': 1 }));
  catalog.register(exotic('ux_dust', 'UxDust', { 'ux:element_x': 2 }));
  return catalog;
}

/** Класс-заглушка: не объектная запись, но без собственных свойств. */
class OpaqueComposition {
  describe(): string {
    return 'не объектная запись';
  }
}

/**
 * Виды с недопустимой формой состава. Все эти формы ПРОХОДЯТ
 * validateSpecies (Object.entries по ним молча пуст) — ReactionLedger
 * обязан распознать непроверяемость самостоятельно.
 */
function makeMalformedCatalog(): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  const malformed = (id: string, elements: unknown) =>
    makeSpecies({
      id,
      formula: id.toUpperCase(),
      elements: elements as ScientificSpecies['elements'],
      molarMassKgMol: null,
      molarMassStatus: 'unknown',
      phase: 'other'
    });
  // Map с ФАКТИЧЕСКИ присутствующим H, невидимым для Object.entries(Map)
  catalog.register(malformed('map_h2', new Map([['H', 2]])));
  catalog.register(malformed('set_h2', new Set(['H'])));
  catalog.register(malformed('date_h2', new Date(0)));
  catalog.register(malformed('regex_h2', /H:2/));
  catalog.register(malformed('array_h2', [2]));
  catalog.register(malformed('opaque_h2', new OpaqueComposition()));
  // непредусмотренный runtime-статус данных: не known и не estimated
  catalog.register(makeSpecies({
    id: 'tentative_h2',
    formula: 'TntH2',
    elements: { H: 2 },
    dataStatus: 'tentative' as unknown as ScientificSpecies['dataStatus'],
    molarMassKgMol: null,
    molarMassStatus: 'unknown',
    phase: 'other'
  }));
  return catalog;
}

/** Виды с формально валидными, но переполняющими значениями. */
function makeOverflowCatalog(): SpeciesCatalog {
  const catalog = createSpeciesCatalog();
  // Number.isInteger(1e308) === true: значения формально валидны
  catalog.register(makeSpecies({
    id: 'big_h', formula: 'BigH', elements: { H: 1e308 },
    molarMassKgMol: null, molarMassStatus: 'unknown', phase: 'other'
  }));
  catalog.register(makeSpecies({
    id: 'big_q', formula: 'BigQ', charge: 1e308,
    molarMassKgMol: null, molarMassStatus: 'unknown', phase: 'other'
  }));
  return catalog;
}

describe('Stage 4.2.3.2.1 ReactionLedger: обязательность time', () => {
  it('time: null проходит валидацию', () => {
    expect(validateReactionRecord(makeRecord({ time: null }))).toEqual([]);
  });

  it('time: корректная метка FluxTime проходит валидацию', () => {
    expect(validateReactionRecord(makeRecord({ time: { segmentIndex: 2, localTimeS: 0 } }))).toEqual([]);
  });

  it('отсутствующее поле time отклоняется', () => {
    const record = makeRecord();
    delete (record as unknown as Record<string, unknown>).time;
    const problems = validateReactionRecord(record);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('time');
  });

  it('registerReaction отклоняет запись без time (spread не создаёт отсутствующий time)', () => {
    const record = makeRecord();
    delete (record as unknown as Record<string, unknown>).time;
    let caught: ReactionLedgerError | null = null;
    try {
      registerReaction(createReactionLedger(), record);
    } catch (error) {
      caught = error as ReactionLedgerError;
    }
    expect(caught).toBeInstanceOf(ReactionLedgerError);
    expect(caught?.code).toBe('invalid_reaction');
    expect(caught?.recordId).toBe('rxn-1');
  });

  it('журнал после успешной регистрации проходит validateReactionLedger', () => {
    const ledger = registerReaction(createReactionLedger(), makeRecord({ id: 'rxn-time-ok' }));
    expect(validateReactionLedger(ledger)).toEqual([]);
  });
});

describe('Stage 4.2.3.2.1 ReactionLedger: зарезервированные имена компонентов', () => {
  const catalog = makeReservedCatalog();

  it("компонент 'constructor': сбалансированная реакция проверяется численно", () => {
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'ctor_a', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'ctor_b', coefficient: 1 }]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(typeof audit.reactantElements['constructor']).toBe('number');
    expect(audit.reactantElements['constructor']).toBe(2);
    expect(audit.productElements['constructor']).toBe(2);
    expect(Object.keys(audit.reactantElements)).toContain('constructor');
  });

  it("намеренный дисбаланс 'constructor' → imbalanced", () => {
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'ctor_a', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'ctor_c', coefficient: 1 }]
    }), catalog);
    expect(audit.status).toBe('imbalanced');
    expect(audit.elementIssues[0]).toContain('constructor');
  });

  it("компонент 'toString': баланс и дисбаланс различаются", () => {
    const balanced = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'tostr_a', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'tostr_b', coefficient: 1 }]
    }), catalog);
    expect(balanced.status).toBe('balanced');
    expect(Object.keys(balanced.reactantElements)).toContain('toString');
    expect(balanced.reactantElements['toString']).toBe(2);
    const imbalanced = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'tostr_a', coefficient: 1 }],
      products: [{ reservoirId: 'atm', speciesId: 'tostr_b', coefficient: 1 }]
    }), catalog);
    expect(imbalanced.status).toBe('imbalanced');
  });

  it("компонент 'hasOwnProperty' не теряется из отчёта", () => {
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'hop_a', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'hop_b', coefficient: 1 }]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(Object.keys(audit.reactantElements)).toContain('hasOwnProperty');
    expect(audit.reactantElements['hasOwnProperty']).toBe(2);
  });

  it("собственный ключ '__proto__': компонент не исчезает, прототип отчёта не меняется", () => {
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'proto_a', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'proto_b', coefficient: 1 }]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(Object.keys(audit.reactantElements)).toContain('__proto__');
    expect(audit.reactantElements['__proto__']).toBe(2);
    expect(Object.getPrototypeOf(audit.reactantElements)).toBe(Object.prototype);
  });

  it("дисбаланс по '__proto__' обнаруживается", () => {
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'proto_a', coefficient: 1 }],
      products: [{ reservoirId: 'atm', speciesId: 'proto_b', coefficient: 1 }]
    }), catalog);
    expect(audit.status).toBe('imbalanced');
    expect(audit.elementIssues[0]).toContain('__proto__');
  });

  it('гипотетический ux:element_x по-прежнему проверяется алгебраически', () => {
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'ux_mote', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'ux_dust', coefficient: 1 }]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(audit.reactantElements['ux:element_x']).toBe(2);
  });
});

describe('Stage 4.2.3.2.1 ReactionLedger: строгая форма состава', () => {
  it('каталог принимает Map-элементы (Object.entries молча пуст), аудит распознаёт непроверяемость', () => {
    const catalog = createSpeciesCatalog();
    expect(() => catalog.register(makeSpecies({
      id: 'map_h2', formula: 'MapH2',
      elements: new Map([['H', 2]]) as unknown as ScientificSpecies['elements'],
      molarMassKgMol: null, molarMassStatus: 'unknown', phase: 'other'
    }))).not.toThrow();
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'map_h2', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'map_h2', coefficient: 2 }]
    }), catalog);
    // Map НЕ трактуется как известный пустой состав (иначе было бы balanced)
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('map_h2');
  });

  it('Set в качестве состава → not_verifiable', () => {
    const catalog = makeMalformedCatalog();
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'set_h2', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'set_h2', coefficient: 2 }]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('set_h2');
  });

  it('Date в качестве состава → not_verifiable', () => {
    const catalog = makeMalformedCatalog();
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'date_h2', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'date_h2', coefficient: 2 }]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('date_h2');
  });

  it('RegExp в качестве состава → not_verifiable', () => {
    const catalog = makeMalformedCatalog();
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'regex_h2', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'regex_h2', coefficient: 2 }]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('regex_h2');
  });

  it('массив в качестве состава → not_verifiable', () => {
    const catalog = makeMalformedCatalog();
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'array_h2', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'array_h2', coefficient: 2 }]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('array_h2');
  });

  it('экземпляр пользовательского класса в качестве состава → not_verifiable', () => {
    const catalog = makeMalformedCatalog();
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'opaque_h2', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'opaque_h2', coefficient: 2 }]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('opaque_h2');
  });

  it('null в качестве состава → not_verifiable, без исключения наружу', () => {
    const species = makeSpecies({ id: 'null_el', formula: 'NullEl', molarMassKgMol: null, molarMassStatus: 'unknown', phase: 'other' });
    (species as unknown as { elements: unknown }).elements = null;
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'null_el', coefficient: 1 }],
      products: [{ reservoirId: 'atm', speciesId: 'null_el', coefficient: 1 }]
    }), stubCatalogWith([species]));
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('null_el');
  });

  it('undefined в качестве состава → not_verifiable', () => {
    const species = makeSpecies({ id: 'undef_el', formula: 'UndefEl', molarMassKgMol: null, molarMassStatus: 'unknown', phase: 'other' });
    (species as unknown as { elements: unknown }).elements = undefined;
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'undef_el', coefficient: 1 }],
      products: [{ reservoirId: 'atm', speciesId: 'undef_el', coefficient: 1 }]
    }), stubCatalogWith([species]));
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('undef_el');
  });

  it('неизвестный runtime dataStatus → not_verifiable (не считается known)', () => {
    const catalog = makeMalformedCatalog();
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [{ reservoirId: 'atm', speciesId: 'tentative_h2', coefficient: 2 }],
      products: [{ reservoirId: 'atm', speciesId: 'tentative_h2', coefficient: 2 }]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.unprovenSpecies).toContain('tentative_h2');
  });

  it('легитимный пустой состав (электрон) → balanced', () => {
    const catalog = createSpeciesCatalog();
    catalog.register(makeSpecies({ id: 'electron', formula: 'e-', elements: {}, charge: -1, molarMassKgMol: null, molarMassStatus: 'unknown', phase: 'other' }));
    catalog.register(makeSpecies({ id: 'h_plus', formula: 'H+', elements: { H: 1 }, charge: 1, phase: 'aqueous', molarMassKgMol: null, molarMassStatus: 'unknown' }));
    catalog.register(makeSpecies({ id: 'h2', formula: 'H2', elements: { H: 2 }, molarMassKgMol: 0.002016 }));
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [
        { reservoirId: 'aq', speciesId: 'h_plus', coefficient: 1 },
        { reservoirId: 'aq', speciesId: 'electron', coefficient: 1 }
      ],
      products: [{ reservoirId: 'atm', speciesId: 'h2', coefficient: 0.5 }]
    }), catalog);
    expect(audit.status).toBe('balanced');
    expect(audit.reactantCharge).toBe(0);
    expect(audit.productCharge).toBe(0);
    expect(audit.reactantElements['H']).toBe(1);
  });
});

describe('Stage 4.2.3.2.1 ReactionLedger: защита от численного переполнения', () => {
  const catalog = makeOverflowCatalog();

  it('переполнение элементного итога: обе стороны Infinity при разных коэффициентах → not_verifiable, не balanced', () => {
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'big_h', coefficient: 1 },
        { reservoirId: 'ocean', speciesId: 'big_h', coefficient: 1 }
      ],
      products: [{ reservoirId: 'atm', speciesId: 'big_h', coefficient: 2 }]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.status).not.toBe('balanced');
    expect(audit.diagnostics.some((d) => d.includes('Infinity') || d.includes('NaN'))).toBe(true);
  });

  it('переполнение зарядового итога → not_verifiable, не balanced', () => {
    const audit = auditReactionStoichiometry(makeRecord({
      reactants: [
        { reservoirId: 'atm', speciesId: 'big_q', coefficient: 1 },
        { reservoirId: 'ocean', speciesId: 'big_q', coefficient: 1 }
      ],
      products: [{ reservoirId: 'atm', speciesId: 'big_q', coefficient: 2 }]
    }), catalog);
    expect(audit.status).toBe('not_verifiable');
    expect(audit.status).not.toBe('balanced');
    expect(audit.diagnostics.some((d) => d.includes('Infinity') || d.includes('NaN'))).toBe(true);
  });
});

describe('Stage 4.2.3.2.1 ReactionLedger: валидация tolerance', () => {
  const catalog = makeCatalog();

  it('NaN → invalid', () => {
    const audit = auditReactionStoichiometry(makeRecord(), catalog, { tolerance: Number.NaN });
    expect(audit.status).toBe('invalid');
    expect(audit.formIssues[0]).toContain('tolerance');
  });

  it('+Infinity → invalid', () => {
    const audit = auditReactionStoichiometry(makeRecord(), catalog, { tolerance: Number.POSITIVE_INFINITY });
    expect(audit.status).toBe('invalid');
    expect(audit.formIssues[0]).toContain('tolerance');
  });

  it('-Infinity → invalid', () => {
    const audit = auditReactionStoichiometry(makeRecord(), catalog, { tolerance: Number.NEGATIVE_INFINITY });
    expect(audit.status).toBe('invalid');
  });

  it('отрицательное значение → invalid', () => {
    const audit = auditReactionStoichiometry(makeRecord(), catalog, { tolerance: -1e-12 });
    expect(audit.status).toBe('invalid');
    expect(audit.formIssues[0]).toContain('tolerance');
  });

  it('нуль допустим: точный целочисленный баланс остаётся balanced', () => {
    const audit = auditReactionStoichiometry(makeRecord(), catalog, { tolerance: 0 });
    expect(audit.status).toBe('balanced');
  });

  it('корректное положительное значение допустимо', () => {
    const audit = auditReactionStoichiometry(makeRecord(), catalog, { tolerance: 1e-6 });
    expect(audit.status).toBe('balanced');
  });

  it('единая политика в аудите журнала: NaN → invalid целиком', () => {
    const ledger = registerReaction(createReactionLedger(), makeRecord({ id: 'rxn-tol' }));
    const audit = auditReactionLedger(ledger, catalog, { tolerance: Number.NaN });
    expect(audit.status).toBe('invalid');
    expect(audit.formIssues[0]).toContain('tolerance');
  });

  it('аудит журнала с корректным tolerance работает как раньше', () => {
    const ledger = registerReaction(createReactionLedger(), makeRecord({ id: 'rxn-tol-ok' }));
    expect(auditReactionLedger(ledger, catalog, { tolerance: 1e-9 }).status).toBe('balanced');
  });
});

describe('Stage 4.2.3.2.1 ReactionLedger: note и однозначность пар участников', () => {
  it('note: непустая строка допустима', () => {
    expect(validateReactionRecord(makeRecord({ note: 'лабораторный эталон' }))).toEqual([]);
  });

  it('note: пустая строка отклоняется', () => {
    const problems = validateReactionRecord(makeRecord({ note: '' }));
    expect(problems.some((p) => p.includes('note'))).toBe(true);
  });

  it('note: число отклоняется', () => {
    const record = makeRecord();
    (record as unknown as { note: unknown }).note = 42;
    expect(validateReactionRecord(record).some((p) => p.includes('note'))).toBe(true);
  });

  it('note: объект и массив отклоняются', () => {
    const objectNote = makeRecord();
    (objectNote as unknown as { note: unknown }).note = { text: 'x' };
    expect(validateReactionRecord(objectNote).some((p) => p.includes('note'))).toBe(true);
    const arrayNote = makeRecord();
    (arrayNote as unknown as { note: unknown }).note = ['x'];
    expect(validateReactionRecord(arrayNote).some((p) => p.includes('note'))).toBe(true);
  });

  it('registerReaction отклоняет некорректный note', () => {
    const record = makeRecord();
    (record as unknown as { note: unknown }).note = '';
    let caught: ReactionLedgerError | null = null;
    try {
      registerReaction(createReactionLedger(), record);
    } catch (error) {
      caught = error as ReactionLedgerError;
    }
    expect(caught).toBeInstanceOf(ReactionLedgerError);
    expect(caught?.code).toBe('invalid_reaction');
  });

  it('различные пары с пробелами в идентификаторах не конфликтуют', () => {
    const record = makeRecord({
      reactants: [
        { reservoirId: 'r x', speciesId: 'y', coefficient: 1 },
        { reservoirId: 'r', speciesId: 'x y', coefficient: 1 }
      ]
    });
    expect(validateReactionRecord(record)).toEqual([]);
  });

  it('точный повтор пары с пробелами по-прежнему отклоняется', () => {
    const record = makeRecord({
      reactants: [
        { reservoirId: 'r x', speciesId: 'y', coefficient: 1 },
        { reservoirId: 'r x', speciesId: 'y', coefficient: 1 }
      ]
    });
    expect(validateReactionRecord(record).some((p) => p.includes('встречается дважды'))).toBe(true);
  });
});
