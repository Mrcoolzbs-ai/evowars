// ============================================
// STAGE 4.3.3 - Тесты модели ChemicalElement:
// валидатор записи, каталог, ссылочная целостность ElementCounts
// ============================================
//
// Модель Core/elements.ts проверяется на записях, НЕ связанных
// с каталогом 118 элементов: валидатор принимает корректную запись
// любого происхождения (данные могут приходить из JSON — тип
// TypeScript их не проверяет) и отвергает повреждённые записи
// диагностиками, а не молчанием. Каталог отклоняет дубликаты
// атомного номера и символа. checkElementCountsReference —
// отдельная проверка ссылок ElementCounts на канонический реестр,
// не меняющая правила химического движка (точка интеграции 4.3.3).

import { describe, it, expect } from 'vitest';
import {
  createElementCatalog,
  validateChemicalElement,
  provenanceIdentifiesSource,
  checkElementCountsReference,
  ElementError,
  ELEMENT_COUNT,
  ELEMENT_BLOCKS,
  ELEMENT_CATEGORIES
} from '../Core/elements';
import type { ChemicalElement, NuclideCandidate } from '../Core/elements';
import { unknownValue, knownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';

const PROVENANCE = { sourceName: 'тестовый источник', recordId: 'test:record' };

/** Минимально корректная запись элемента (все свойства валидны). */
function makeElement(): ChemicalElement {
  return {
    atomicNumber: 1,
    symbol: 'H',
    nameEnglish: 'Hydrogen',
    nameEnglishProvenance: PROVENANCE,
    nameRussian: 'водород',
    nameRussianProvenance: PROVENANCE,
    position: { group: 1, period: 1, block: 's', provenance: PROVENANCE },
    category: { status: 'known', category: 'reactive_nonmetal', provenance: PROVENANCE },
    standardAtomicWeight: {
      kind: 'interval',
      lower: 1.00784,
      upper: 1.00811,
      rawNotation: '[1.00784,1.00811]',
      provenance: PROVENANCE
    },
    isotopicComposition: { status: 'not_applicable', reason: 'тест: изотопный состав не назначается' },
    representativeIsotopeCandidates: {
      status: 'not_applicable',
      notApplicableReason: 'тест: стандартный атомный вес назначен'
    },
    electronConfiguration: { status: 'unknown', unknownReason: 'тест: значение не импортировано' },
    firstIonizationEnergy: unknownValue('тест: значение не импортировано'),
    electronAffinity: unknownValue('тест: значение не импортировано'),
    electronegativity: unknownValue('тест: значение не импортировано'),
    atomicRadius: unknownValue('тест: значение не импортировано'),
    meltingPoint: unknownValue('тест: значение не импортировано'),
    boilingPoint: unknownValue('тест: значение не импортировано'),
    density: unknownValue('тест: значение не импортировано'),
    oxidationStates: { status: 'unknown', unknownReason: 'тест: значение не импортировано' },
    provenance: PROVENANCE
  };
}

/** Повреждённая копия записи: валидатор принимает unknown. */
function damaged(mutate: (el: Record<string, unknown>) => void): unknown {
  const el = makeElement() as unknown as Record<string, unknown>;
  mutate(el);
  return el;
}

/**
 * Валидный кандидат-нуклид, согласованный с элементом-владельцем
 * makeElement() (Z=1, H): символ, массовое число, состояние, recordId
 * и provenance.recordId согласованы (аудит R1 — валидатор сверяет
 * обозначение нуклида с элементом-владельцем).
 */
function makeCandidate(): NuclideCandidate {
  return {
    atomicNumber: 1,
    massNumber: 1,
    nuclideNotation: 'H-1',
    state: 'ground',
    stateIndex: 0,
    stateCode: '',
    recordId: 'test:A=1',
    halfLife: knownValue(quantity(4.2, 'Ma'), { provenance: { ...PROVENANCE, recordId: 'test:A=1' } }),
    halfLifeRawNotation: '4.2(3) My',
    decayMode: 'B-=100',
    dataStatus: 'experimental',
    reason: 'тест: кандидат включён как самый долгоживущий',
    provenance: { ...PROVENANCE, recordId: 'test:A=1' }
  };
}

/**
 * Валидный изомерный кандидат с явной строкой состояния NUBASE2020
 * (i, s): recordId, provenance.recordId и recordId периода полураспада
 * идентифицируют одну и ту же строку источника (аудит R2).
 */
function makeStateCandidate(stateIndex: number, stateCode: string): NuclideCandidate {
  const recordId = 'test:A=1 i=' + stateIndex + ' s=' + stateCode;
  return {
    ...makeCandidate(),
    state: 'isomeric',
    stateIndex,
    stateCode: stateCode as NuclideCandidate['stateCode'],
    nuclideNotation: 'H-1' + stateCode,
    recordId,
    halfLife: knownValue(quantity(4.2, 'Ma'), { provenance: { ...PROVENANCE, recordId } }),
    provenance: { ...PROVENANCE, recordId }
  };
}

function candidatesWith(candidates: unknown[]): Record<string, unknown> {
  return {
    status: 'known',
    completeness: 'complete',
    completenessNote: 'тест: полнота в пределах тестового набора',
    candidates,
    provenance: PROVENANCE
  };
}

describe('Stage 4.3.3 (модель): валидатор записи ChemicalElement', () => {
  it('корректная запись проходит валидацию без ошибок', () => {
    expect(validateChemicalElement(makeElement())).toEqual([]);
  });

  it('not_verifiable — валидный статус полноты кандидатов (аудит R2)', () => {
    const el = makeElement();
    el.representativeIsotopeCandidates = {
      status: 'known',
      completeness: 'not_verifiable',
      completenessNote: 'тест: нижние пределы T1/2 без верхней границы — полнота не доказуема',
      candidates: [makeCandidate()],
      provenance: PROVENANCE
    };
    expect(validateChemicalElement(el)).toEqual([]);
  });

  it('корректная запись с кандидатами и unknown-свойствами проходит валидацию', () => {
    const el = makeElement();
    el.representativeIsotopeCandidates = {
      status: 'known',
      completeness: 'incomplete',
      completenessNote: 'тест: полнота не доказана',
      candidates: [makeCandidate()],
      provenance: PROVENANCE
    };
    el.category = { status: 'unknown', category: null, unknownReason: 'тест: категория неизвестна', provenance: PROVENANCE };
    const pos = { ...el.position };
    pos.group = null;
    pos.groupNotAssignedReason = 'тест: вопрос группы 3 не закрыт';
    pos.block = null;
    pos.blockUnknownReason = 'тест: блок спорен';
    el.position = pos;
    expect(validateChemicalElement(el)).toEqual([]);
  });

  it('атомный номер вне 1…118 или нецелый — диагностическая ошибка', () => {
    const zero = validateChemicalElement(damaged((el) => { el.atomicNumber = 0; }));
    expect(zero.some((e) => e.includes('атомный номер должен быть целым числом'))).toBe(true);
    const big = validateChemicalElement(damaged((el) => { el.atomicNumber = 119; }));
    expect(big.some((e) => e.includes('атомный номер должен быть целым числом'))).toBe(true);
    const frac = validateChemicalElement(damaged((el) => { el.atomicNumber = 1.5; }));
    expect(frac.some((e) => e.includes('атомный номер должен быть целым числом'))).toBe(true);
  });

  it('символ не в официальной записи IUPAC — ошибка', () => {
    const lower = validateChemicalElement(damaged((el) => { el.symbol = 'h'; }));
    expect(lower.some((e) => e.includes('символ должен быть официальной записью IUPAC'))).toBe(true);
    const two = validateChemicalElement(damaged((el) => { el.symbol = 'HX'; }));
    expect(two.some((e) => e.includes('символ должен быть официальной записью IUPAC'))).toBe(true);
  });

  it('пустые английское и русское названия — ошибки', () => {
    const en = validateChemicalElement(damaged((el) => { el.nameEnglish = ''; }));
    expect(en.some((e) => e.includes('английское название не может быть пустым'))).toBe(true);
    const ru = validateChemicalElement(damaged((el) => { el.nameRussian = '   '; }));
    expect(ru.some((e) => e.includes('русское название не может быть пустым'))).toBe(true);
  });

  it('provenance названий и записи без идентификации источника — ошибки', () => {
    const en = validateChemicalElement(damaged((el) => { el.nameEnglishProvenance = {}; }));
    expect(en.some((e) => e.includes('должно идентифицировать источник'))).toBe(true);
    const ru = validateChemicalElement(damaged((el) => { el.nameRussianProvenance = { sourceName: ' ' }; }));
    expect(ru.some((e) => e.includes('должно идентифицировать источник'))).toBe(true);
    const rec = validateChemicalElement(damaged((el) => { el.provenance = { note: 'источник не назван' }; }));
    expect(rec.some((e) => e.includes('provenance записи (идентификация) должен идентифицировать источник'))).toBe(true);
  });

  it('период вне 1–7 — ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => { (el.position as Record<string, unknown>).period = 9; }));
    expect(bad.some((e) => e.includes('период должен быть целым числом'))).toBe(true);
  });

  it('group = null без объяснения — ошибка; с объяснением — норма', () => {
    const bad = validateChemicalElement(damaged((el) => { (el.position as Record<string, unknown>).group = null; }));
    expect(bad.some((e) => e.includes('требует объяснения groupNotAssignedReason'))).toBe(true);
    const ok = validateChemicalElement(damaged((el) => {
      const pos = el.position as Record<string, unknown>;
      pos.group = null;
      pos.groupNotAssignedReason = 'тест: вопрос группы 3 не закрыт';
    }));
    expect(ok.some((e) => e.includes('groupNotAssignedReason'))).toBe(false);
  });

  it('block = null без объяснения — ошибка; с объяснением — норма', () => {
    const bad = validateChemicalElement(damaged((el) => { (el.position as Record<string, unknown>).block = null; }));
    expect(bad.some((e) => e.includes('требует объяснения blockUnknownReason'))).toBe(true);
    const ok = validateChemicalElement(damaged((el) => {
      const pos = el.position as Record<string, unknown>;
      pos.block = null;
      pos.blockUnknownReason = 'тест: блок спорен из-за вопроса группы 3';
    }));
    expect(ok.some((e) => e.includes('blockUnknownReason'))).toBe(false);
  });

  it('категория: unknown без причины и неизвестная категория — ошибки', () => {
    const unknownCat = validateChemicalElement(damaged((el) => { (el.category as Record<string, unknown>).status = 'unknown'; }));
    expect(unknownCat.some((e) => e.includes('категория unknown требует объяснения unknownReason'))).toBe(true);
    const badCat = validateChemicalElement(damaged((el) => { (el.category as Record<string, unknown>).category = 'щелочной металл'; }));
    expect(badCat.some((e) => e.includes('неизвестная категория'))).toBe(true);
  });

  it('интервальный атомный вес: нижняя граница не меньше верхней — ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => {
      const w = el.standardAtomicWeight as Record<string, unknown>;
      w.upper = 1.00784;
    }));
    expect(bad.some((e) => e.includes('нижняя граница интервала должна быть меньше верхней'))).toBe(true);
  });

  it('интервальный атомный вес без исходной нотации — ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => {
      delete (el.standardAtomicWeight as Record<string, unknown>).rawNotation;
    }));
    expect(bad.some((e) => e.includes('обязан сохранять исходную нотацию CIAAW (rawNotation)'))).toBe(true);
  });

  it('скобочный вес: отрицательная неопределённость и отсутствие нотации — ошибки', () => {
    const neg = validateChemicalElement(damaged((el) => {
      el.standardAtomicWeight = {
        kind: 'value_with_uncertainty',
        value: 4.002602,
        uncertainty: -1,
        rawNotation: '4.002602(2)',
        provenance: PROVENANCE
      };
    }));
    expect(neg.some((e) => e.includes('стандартная неопределённость должна быть конечным неотрицательным числом'))).toBe(true);
    const noRaw = validateChemicalElement(damaged((el) => {
      el.standardAtomicWeight = {
        kind: 'value_with_uncertainty',
        value: 4.002602,
        uncertainty: 0.000002,
        provenance: PROVENANCE
      };
    }));
    expect(noRaw.some((e) => e.includes('обязан сохранять исходную нотацию CIAAW (rawNotation)'))).toBe(true);
  });

  it('not_assigned без reason — ошибка; с reason — норма', () => {
    const bad = validateChemicalElement(damaged((el) => {
      el.standardAtomicWeight = { kind: 'not_assigned', provenance: PROVENANCE };
    }));
    expect(bad.some((e) => e.includes('требует объяснения reason'))).toBe(true);
    const ok = validateChemicalElement(damaged((el) => {
      el.standardAtomicWeight = { kind: 'not_assigned', reason: 'тест: CIAAW 2024 ставит прочерк', provenance: PROVENANCE };
    }));
    expect(ok).toEqual([]);
  });

  it('неизвестная форма стандартного атомного веса — ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => {
      (el.standardAtomicWeight as Record<string, unknown>).kind = 'приблизительный';
    }));
    expect(bad.some((e) => e.includes('неизвестная форма стандартного атомного веса'))).toBe(true);
  });

  it('known-изотопный состав без записей — ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => { el.isotopicComposition = { status: 'known' }; }));
    expect(bad.some((e) => e.includes('изотопный состав known требует непустого списка записей'))).toBe(true);
  });

  it('изотопная запись: нецелое массовое число и распространённость вне [0,1] — ошибки', () => {
    const badValue = validateChemicalElement(damaged((el) => {
      el.isotopicComposition = {
        status: 'known',
        records: [{ massNumber: 1, abundance: { kind: 'value', value: 1.5, uncertainty: null, rawNotation: '1.5', provenance: { sourceName: 'тест', recordId: 'тест' } } }]
      };
    }));
    expect(badValue.some((e) => e.includes('долевая распространённость должна быть числом в [0, 1]'))).toBe(true);
    const badMass = validateChemicalElement(damaged((el) => {
      el.isotopicComposition = {
        status: 'known',
        records: [{ massNumber: 1.5, abundance: { kind: 'value', value: 0.5, uncertainty: null, rawNotation: '0.5', provenance: { sourceName: 'тест', recordId: 'тест' } } }]
      };
    }));
    expect(badMass.some((e) => e.includes('массовое число должно быть целым положительным'))).toBe(true);
  });

  it('изотопная запись без recordId — ошибка (дисциплина 4.3.2)', () => {
    const bad = validateChemicalElement(damaged((el) => {
      el.isotopicComposition = {
        status: 'known',
        records: [{ massNumber: 1, abundance: { kind: 'value', value: 0.9999, uncertainty: null, rawNotation: '0.9999', provenance: { sourceName: 'тест' } } }]
      };
    }));
    expect(bad.some((e) => e.includes('recordId — непустая строка'))).toBe(true);
  });

  it('not_applicable/unknown-изотопный состав без reason — ошибка', () => {
    const na = validateChemicalElement(damaged((el) => { el.isotopicComposition = { status: 'not_applicable' }; }));
    expect(na.some((e) => e.includes('требует объяснения reason'))).toBe(true);
    const un = validateChemicalElement(damaged((el) => { el.isotopicComposition = { status: 'unknown' }; }));
    expect(un.some((e) => e.includes('требует объяснения reason'))).toBe(true);
  });

  it('кандидат: атомный номер не совпадает с элементом-владельцем — ошибка', () => {
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).atomicNumber = 2;
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('обязан совпадать с элементом-владельцем'))).toBe(true);
  });

  it('кандидат: пустой recordId — ошибка (дисциплина 4.3.2)', () => {
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).recordId = '';
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('recordId источника обязателен'))).toBe(true);
  });

  it('кандидат: нецелое массовое число и пустая причина — ошибки', () => {
    const badMass = makeCandidate();
    (badMass as unknown as Record<string, unknown>).massNumber = 98.5;
    const res1 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([badMass]); }));
    expect(res1.some((e) => e.includes('массовое число должно быть целым положительным'))).toBe(true);
    const badReason = makeCandidate();
    (badReason as unknown as Record<string, unknown>).reason = '';
    const res2 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([badReason]); }));
    expect(res2.some((e) => e.includes('причина включения в список обязательна'))).toBe(true);
  });

  it('кандидат: unknown-период полураспада — ошибка (источник публикует значение)', () => {
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).halfLife = unknownValue('тест: значение недоступно');
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('обязан быть known/estimated'))).toBe(true);
  });

  it('кандидат: estimated-период полураспада без метода — ошибка', () => {
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).halfLife = {
      status: 'estimated',
      quantity: quantity(4.2, 'Ma'),
      method: '',
      provenance: PROVENANCE
    };
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('требует непустой метод оценки'))).toBe(true);
  });

  it('кандидат: обозначение не соответствует элементу-владельцу (H с «Tc-98») — ошибка', () => {
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).nuclideNotation = 'Tc-98';
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('обозначение нуклида обязано начинаться с символа элемента-владельца'))).toBe(true);
  });

  it('кандидат: массовое число в обозначении не совпадает с записью — ошибка', () => {
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).nuclideNotation = 'H-2';
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('требует обозначение «H-1»'))).toBe(true);
  });

  it('кандидат: суффикс состояния в обозначении неверен (ground с m, isomeric без m) — ошибки', () => {
    const withM = makeCandidate();
    (withM as unknown as Record<string, unknown>).nuclideNotation = 'H-1m';
    const badM = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([withM]); }));
    expect(badM.some((e) => e.includes('основное состояние требует обозначение «H-1» без суффикса изомера'))).toBe(true);
    const noM = makeCandidate();
    (noM as unknown as Record<string, unknown>).state = 'isomeric';
    (noM as unknown as Record<string, unknown>).stateIndex = 1;
    (noM as unknown as Record<string, unknown>).stateCode = 'm';
    const badI = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([noM]); }));
    expect(badI.some((e) => e.includes('изомерное состояние требует обозначение «H-1m»'))).toBe(true);
  });

  it('кандидат (R2): согласованность индекса i и кода s NUBASE2020; i=3↔p — дополнительный изомер', () => {
    // i=1 с кодом p — рассогласование пары (i, s)
    const mismatch = makeStateCandidate(1, 'p');
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([mismatch]); }));
    expect(bad.some((e) => e.includes('не согласованы'))).toBe(true);
    // i=3 с кодом p — согласовано: строка дополнительного изомера NUBASE2020
    const extra = makeStateCandidate(3, 'p');
    const ok = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([extra]); }));
    expect(ok).toEqual([]);
  });

  it('кандидат (R2): отсутствие stateIndex, некорректный stateCode, ground с i>=1 — ошибки', () => {
    const noIndex = makeCandidate();
    delete (noIndex as unknown as Record<string, unknown>).stateIndex;
    const res1 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([noIndex]); }));
    expect(res1.some((e) => e.includes('индекс состояния NUBASE2020 (stateIndex)'))).toBe(true);
    const badCode = makeCandidate();
    (badCode as unknown as Record<string, unknown>).stateCode = 'z';
    const res2 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([badCode]); }));
    expect(res2.some((e) => e.includes('буквенный код состояния NUBASE2020 (stateCode)'))).toBe(true);
    // ground обязан быть строкой i=0
    const groundExcited = makeCandidate();
    (groundExcited as unknown as Record<string, unknown>).stateIndex = 1;
    (groundExcited as unknown as Record<string, unknown>).stateCode = 'm';
    const res3 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([groundExcited]); }));
    expect(res3.some((e) => e.includes('основное состояние — это строка i=0 NUBASE2020'))).toBe(true);
    // isomeric не может быть IAS (s=i)
    const ias = makeCandidate();
    (ias as unknown as Record<string, unknown>).state = 'isomeric';
    (ias as unknown as Record<string, unknown>).stateIndex = 8;
    (ias as unknown as Record<string, unknown>).stateCode = 'i';
    const res4 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([ias]); }));
    expect(res4.some((e) => e.includes('изомерное состояние — возбуждённая строка NUBASE2020'))).toBe(true);
  });

  it('кандидат (R2): несколько РАЗЛИЧНЫХ изомерных состояний одного A (s=m и s=p) — не дубликат', () => {
    const m = makeStateCandidate(1, 'm');
    const p = makeStateCandidate(3, 'p');
    const res = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([m, p]); }));
    expect(res.some((e) => e.includes('дубликат'))).toBe(false);
    expect(res).toEqual([]);
  });

  it('кандидат (R2): дубликат одной и той же строки источника (A + i + s) — ошибка', () => {
    const m1 = makeStateCandidate(1, 'm');
    const m2 = makeStateCandidate(1, 'm');
    const res = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([m1, m2]); }));
    expect(res.some((e) => e.includes('дубликат записи-кандидата'))).toBe(true);
    expect(res.some((e) => e.includes('строка источника NUBASE2020'))).toBe(true);
  });

  it('кандидат: массовое число меньше атомного номера (A < Z) — ошибка', () => {
    const cand = makeCandidate();
    const c = cand as unknown as Record<string, unknown>;
    c.atomicNumber = 98;
    c.massNumber = 43;
    c.nuclideNotation = 'Cf-43';
    c.recordId = 'test:A=43';
    c.provenance = { ...PROVENANCE, recordId: 'test:A=43' };
    const bad = validateChemicalElement(damaged((el) => {
      el.atomicNumber = 98;
      el.symbol = 'Cf';
      el.representativeIsotopeCandidates = candidatesWith([cand]);
    }));
    expect(bad.some((e) => e.includes('не может быть меньше атомного номера'))).toBe(true);
  });

  it('кандидат: recordId не совпадает с provenance.recordId — ошибка', () => {
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).recordId = 'test:other-row';
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('обязан совпадать с provenance.recordId'))).toBe(true);
  });

  it('кандидат: дубликат записи (массовое число + состояние) — ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([makeCandidate(), makeCandidate()]); }));
    expect(bad.some((e) => e.includes('дубликат записи-кандидата'))).toBe(true);
  });

  it('кандидат: единица периода полураспада без размерности времени (eV, kg, K) — ошибки', () => {
    for (const unit of ['eV', 'kg', 'K']) {
      const cand = makeCandidate();
      (cand as unknown as Record<string, unknown>).halfLife = knownValue(quantity(4.2, unit), { provenance: { ...PROVENANCE, recordId: 'test:A=1' } });
      const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
      expect(bad.some((e) => e.includes('должна иметь размерность времени')), 'unit ' + unit).toBe(true);
    }
  });

  it('кандидат: нулевой и отрицательный период полураспада — ошибки', () => {
    for (const value of [0, -4.2]) {
      const cand = makeCandidate();
      (cand as unknown as Record<string, unknown>).halfLife = knownValue(quantity(value, 'Ma'), { provenance: { ...PROVENANCE, recordId: 'test:A=1' } });
      const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
      expect(bad.some((e) => e.includes('строго положительным числом')), 'value ' + value).toBe(true);
    }
  });

  it('кандидат: недопустимые статусы периода полураспада (unknown, not_applicable, not_implemented, invalid) — ошибки', () => {
    const badValues = [
      { status: 'unknown', note: 'тест' },
      { status: 'not_applicable', reason: 'тест' },
      { status: 'not_implemented', note: 'тест' },
      { status: 'invalid', reason: 'тест' }
    ];
    for (const halfLife of badValues) {
      const cand = makeCandidate();
      (cand as unknown as Record<string, unknown>).halfLife = halfLife;
      const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
      expect(bad.some((e) => e.includes('обязан быть known/estimated')), 'status ' + halfLife.status).toBe(true);
    }
  });

  it('кандидат: невалидная неопределённость периода полураспада — ошибка', () => {
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).halfLife = {
      status: 'known',
      quantity: quantity(4.2, 'Ma'),
      uncertainty: { kind: 'stddev', sigma: -1 },
      provenance: PROVENANCE
    };
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('неопределённость периода полураспада'))).toBe(true);
    expect(bad.some((e) => e.includes('неотрицательным'))).toBe(true);
  });

  it('кандидат: все единицы времени реестра (y, ky, My, yr, ka, Ma, day, h, min, s, ms) проходят валидацию', () => {
    for (const unit of ['y', 'ky', 'My', 'yr', 'ka', 'Ma', 'day', 'h', 'min', 's', 'ms']) {
      const cand = makeCandidate();
      (cand as unknown as Record<string, unknown>).halfLife = knownValue(quantity(4.2, unit), { provenance: { ...PROVENANCE, recordId: 'test:A=1' } });
      const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
      expect(bad, 'unit ' + unit).toEqual([]);
    }
  });

  it('интервальный атомный вес с неположительными границами — ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => {
      const w = el.standardAtomicWeight as Record<string, unknown>;
      w.lower = -1.00784;
    }));
    expect(bad.some((e) => e.includes('строго положительными'))).toBe(true);
  });

  it('скобочный атомный вес: неположительное значение — ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => {
      el.standardAtomicWeight = {
        kind: 'value_with_uncertainty',
        value: -4.002602,
        uncertainty: 0.000002,
        rawNotation: '-4.002602(2)',
        provenance: PROVENANCE
      };
    }));
    expect(bad.some((e) => e.includes('стандартный атомный вес должен быть строго положительным'))).toBe(true);
  });

  it('not_assigned с числовыми полями — ошибка (отсутствие веса не превращается в число)', () => {
    const bad = validateChemicalElement(damaged((el) => {
      el.standardAtomicWeight = { kind: 'not_assigned', reason: 'тест: прочерк', provenance: PROVENANCE, value: 98 };
    }));
    expect(bad.some((e) => e.includes('не должен содержать числовых полей'))).toBe(true);
  });

  it('изотопная запись: A < Z владельца и повторяющиеся массовые числа — ошибки', () => {
    const abundance = (value: number, raw: string) => ({ kind: 'value', value, uncertainty: null, rawNotation: raw, provenance: { sourceName: 'тест', recordId: 'тест' } });
    const badA = validateChemicalElement(damaged((el) => {
      el.atomicNumber = 2;
      el.symbol = 'He';
      el.isotopicComposition = {
        status: 'known',
        records: [{ massNumber: 1, abundance: abundance(0.9999, '0.9999') }]
      };
    }));
    expect(badA.some((e) => e.includes('не может быть меньше атомного номера'))).toBe(true);
    const dup = validateChemicalElement(damaged((el) => {
      el.isotopicComposition = {
        status: 'known',
        records: [
          { massNumber: 1, abundance: abundance(0.75, '0.75') },
          { massNumber: 1, abundance: abundance(0.25, '0.25') }
        ]
      };
    }));
    expect(dup.some((e) => e.includes('повторяющееся массовое число'))).toBe(true);
  });

  it('строковые свойства: known без значения и unknown без причины — ошибки', () => {
    const known = validateChemicalElement(damaged((el) => { (el.electronConfiguration as Record<string, unknown>).status = 'known'; }));
    expect(known.some((e) => e.includes('electronConfiguration known требует непустое значение'))).toBe(true);
    const un = validateChemicalElement(damaged((el) => { el.oxidationStates = { status: 'unknown' }; }));
    expect(un.some((e) => e.includes('oxidationStates unknown требует причины unknownReason'))).toBe(true);
  });

  it('known числовое свойство без provenance — диагностическая ошибка', () => {
    const bad = validateChemicalElement(damaged((el) => { el.firstIonizationEnergy = knownValue(quantity(13.598, 'eV')); }));
    expect(bad.some((e) => e.includes('требует provenance с идентификацией источника'))).toBe(true);
  });

  it('unknown-значения не содержат числового содержимого (unknown НЕ равен нулю)', () => {
    const el = makeElement();
    expect(el.firstIonizationEnergy.status).toBe('unknown');
    expect('quantity' in el.firstIonizationEnergy).toBe(false);
    expect(el.density.status).toBe('unknown');
    expect('quantity' in el.density).toBe(false);
  });
});

describe('Stage 4.3.3 (модель): каталог элементов', () => {
  it('регистрация, поиск по атомному номеру и символу, count и list', () => {
    const catalog = createElementCatalog();
    const h = makeElement();
    const he = makeElement();
    he.atomicNumber = 2;
    he.symbol = 'He';
    catalog.register(h);
    catalog.register(he);
    expect(catalog.count()).toBe(2);
    expect(catalog.getByAtomicNumber(1)).toBe(h);
    expect(catalog.getBySymbol('He')).toBe(he);
    expect(catalog.hasSymbol('H')).toBe(true);
    expect(catalog.hasSymbol('O')).toBe(false);
    expect(catalog.list()).toEqual([h, he]);
  });

  it('дубликат атомного номера — ElementError duplicate_element', () => {
    const catalog = createElementCatalog();
    catalog.register(makeElement());
    const dup = makeElement();
    dup.symbol = 'He';
    let err: ElementError | null = null;
    try {
      catalog.register(dup);
    } catch (e) {
      err = e as ElementError;
    }
    expect(err).not.toBe(null);
    expect(err?.code).toBe('duplicate_element');
    expect(err?.message).toContain('уже зарегистрирован');
  });

  it('дубликат символа — ElementError duplicate_element', () => {
    const catalog = createElementCatalog();
    catalog.register(makeElement());
    const dup = makeElement();
    dup.atomicNumber = 2;
    let err: ElementError | null = null;
    try {
      catalog.register(dup);
    } catch (e) {
      err = e as ElementError;
    }
    expect(err).not.toBe(null);
    expect(err?.code).toBe('duplicate_element');
    expect(err?.subject).toBe('H');
  });

  it('невалидная запись — ElementError invalid_element с проблемами валидатора', () => {
    const catalog = createElementCatalog();
    const bad = makeElement();
    bad.atomicNumber = 0;
    let err: ElementError | null = null;
    try {
      catalog.register(bad);
    } catch (e) {
      err = e as ElementError;
    }
    expect(err?.code).toBe('invalid_element');
    expect(err?.message).toContain('не проходит валидацию');
    expect(err?.message).toContain('атомный номер должен быть целым числом');
  });

  it('незарегистрированные атомный номер и символ — null', () => {
    const catalog = createElementCatalog();
    expect(catalog.getByAtomicNumber(1)).toBe(null);
    expect(catalog.getBySymbol('H')).toBe(null);
    expect(catalog.count()).toBe(0);
    expect(catalog.list()).toEqual([]);
  });

  it('checkElementCountsReference разделяет известные и отсутствующие символы', () => {
    const catalog = createElementCatalog();
    catalog.register(makeElement());
    const report = checkElementCountsReference(catalog, { H: 2, O: 1, Xx: 3 });
    expect(report.knownSymbols).toEqual(['H']);
    expect(report.unknownSymbols).toEqual(['O', 'Xx']);
  });

  it('provenanceIdentifiesSource: идентификация источника по sourceName/sourceId/datasetId/reference', () => {
    expect(provenanceIdentifiesSource({ sourceName: 'CIAAW' })).toBe(true);
    expect(provenanceIdentifiesSource({ sourceId: 'ciaaw-saw' })).toBe(true);
    expect(provenanceIdentifiesSource({ datasetId: 'ciaaw-2024' })).toBe(true);
    expect(provenanceIdentifiesSource({ reference: 'https://ciaaw.org' })).toBe(true);
    expect(provenanceIdentifiesSource({ recordId: 'только запись без источника' })).toBe(false);
    expect(provenanceIdentifiesSource(null)).toBe(false);
    expect(provenanceIdentifiesSource('строка')).toBe(false);
    expect(provenanceIdentifiesSource(undefined)).toBe(false);
  });

  it('ELEMENT_COUNT = 118; реестры блоков и категорий', () => {
    expect(ELEMENT_COUNT).toBe(118);
    expect(ELEMENT_BLOCKS).toEqual(['s', 'p', 'd', 'f']);
    expect(ELEMENT_CATEGORIES).toHaveLength(10);
    expect(ELEMENT_CATEGORIES).toContain('lanthanoid');
    expect(ELEMENT_CATEGORIES).toContain('actinoid');
    expect(ELEMENT_CATEGORIES).toContain('noble_gas');
  });

  it('ElementError несёт код, компонент и субъект', () => {
    const e = new ElementError('unknown_element', 'тестовое сообщение', 'H');
    expect(e.code).toBe('unknown_element');
    expect(e.component).toBe('ChemicalElement');
    expect(e.subject).toBe('H');
    expect(e.message).toContain('[ChemicalElement]');
    expect(e.name).toBe('ElementError');
  });
});
