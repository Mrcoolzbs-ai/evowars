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
