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
  ELEMENT_CATEGORIES,
  classifyNubaseState,
  NUBASE_STATE_CODE_BY_INDEX
} from '../Core/elements';
import type {
  ChemicalElement,
  NuclideCandidate,
  NubaseStateRowRef,
  StateClassificationBasis
} from '../Core/elements';
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
    classification: 'ground',
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
 * Аудит R3: изомерный кандидат несёт научную классификацию isomer;
 * для ДОПОЛНИТЕЛЬНЫХ изомеров (i>=3) основание classificationBasis
 * передаётся тестом явно — без него валидатор требует контекст.
 */
function makeStateCandidate(
  stateIndex: number,
  stateCode: string,
  classificationBasis?: StateClassificationBasis
): NuclideCandidate {
  const recordId = 'test:A=1 i=' + stateIndex + ' s=' + stateCode;
  return {
    ...makeCandidate(),
    state: 'isomeric',
    stateIndex,
    stateCode: stateCode as NuclideCandidate['stateCode'],
    classification: 'isomer',
    ...(classificationBasis !== undefined ? { classificationBasis } : {}),
    nuclideNotation: 'H-1' + stateCode,
    recordId,
    halfLife: knownValue(quantity(4.2, 'Ma'), { provenance: { ...PROVENANCE, recordId } }),
    provenance: { ...PROVENANCE, recordId }
  };
}

/**
 * Основание «дополнительный изомер при подтверждённом контексте»
 * (аудит R3; аудит R4, C5 — sibling-строки суть КОНКРЕТНЫЕ строки
 * источника: Z, A, пара (i, s) и СОБСТВЕННЫЙ recordId того же
 * нуклида (Z=1, A=1), что и кандидат makeStateCandidate).
 */
function contextBasis(refs: ReadonlyArray<[number, string]>): StateClassificationBasis {
  return {
    rule: 'context-more-than-two-isomers',
    siblingStates: refs.map(([i, s]) => ({
      atomicNumber: 1,
      massNumber: 1,
      stateIndex: i,
      stateCode: s as NuclideCandidate['stateCode'],
      recordId: 'test:A=1 i=' + i + ' s=' + s
    }))
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

  it('кандидат (R2/R3): согласованность пары (i, s); i=3↔p — дополнительный изомер ТОЛЬКО при подтверждённом контексте', () => {
    // i=1 с кодом p — рассогласование пары (i, s)
    const mismatch = makeStateCandidate(1, 'p');
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([mismatch]); }));
    expect(bad.some((e) => e.includes('не согласованы'))).toBe(true);
    // Аудит R3: i=3, s=p БЕЗ подтверждённого контекста НЕ проходит как
    // изомер автоматически — основание классификации обязательно
    const noBasis = makeStateCandidate(3, 'p');
    const res = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([noBasis]); }));
    expect(res.some((e) => e.includes('требуется classificationBasis'))).toBe(true);
    expect(res.some((e) => e.includes('контексте более двух изомерных состояний'))).toBe(true);
    // i=3, s=p с контекстом (sibling-строки m и n того же (Z, A)) — валиден
    const withBasis = makeStateCandidate(3, 'p', contextBasis([[1, 'm'], [2, 'n']]));
    const ok = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([withBasis]); }));
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

  it('кандидат (R2/R3): несколько РАЗЛИЧНЫХ изомерных состояний одного A — не дубликат (доп. изомер с контекстом)', () => {
    const m = makeStateCandidate(1, 'm');
    const p = makeStateCandidate(3, 'p', contextBasis([[1, 'm'], [2, 'n']]));
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

  it('кандидат (R2): provenance.recordId периода полураспада — та же строка источника, что и запись кандидата', () => {
    // положительный: recordId значения совпадает с recordId записи
    const ok = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([makeCandidate()]); }));
    expect(ok).toEqual([]);
    // отрицательный: значение приписано ДРУГОЙ строке источника
    const cand = makeCandidate();
    (cand as unknown as Record<string, unknown>).halfLife = knownValue(quantity(4.2, 'Ma'), { provenance: { ...PROVENANCE, recordId: 'test:other-row' } });
    const bad = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
    expect(bad.some((e) => e.includes('обязан совпадать с recordId записи кандидата'))).toBe(true);
    expect(bad.some((e) => e.includes('одной строки источника'))).toBe(true);
    // отрицательный: recordId у provenance значения отсутствует
    const cand2 = makeCandidate();
    (cand2 as unknown as Record<string, unknown>).halfLife = knownValue(quantity(4.2, 'Ma'), { provenance: { sourceName: 'тестовый источник' } });
    const bad2 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand2]); }));
    expect(bad2.some((e) => e.includes('provenance.recordId периода полураспада обязателен'))).toBe(true);
  });

  it('кандидат (R2): противоречие dataStatus и halfLife.status — ошибка; согласованное сочетание проходит', () => {
    // отрицательный: экспериментальная запись с оценённым значением
    const estimatedValue = makeCandidate();
    (estimatedValue as unknown as Record<string, unknown>).halfLife = {
      status: 'estimated',
      quantity: quantity(4.2, 'Ma'),
      method: 'тест: экстраполяция',
      provenance: { ...PROVENANCE, recordId: 'test:A=1' }
    };
    const bad1 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([estimatedValue]); }));
    expect(bad1.some((e) => e.includes('противоречие статусов'))).toBe(true);
    expect(bad1.some((e) => e.includes('experimental'))).toBe(true);
    // отрицательный: оценочная запись с известным значением
    const estimatedRecord = makeCandidate();
    (estimatedRecord as unknown as Record<string, unknown>).dataStatus = 'estimated';
    const bad2 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([estimatedRecord]); }));
    expect(bad2.some((e) => e.includes('противоречие статусов'))).toBe(true);
    expect(bad2.some((e) => e.includes('estimated'))).toBe(true);
    // положительный: оценочная запись с оценённым значением и методом
    const consistent = makeCandidate();
    (consistent as unknown as Record<string, unknown>).dataStatus = 'estimated';
    (consistent as unknown as Record<string, unknown>).halfLife = {
      status: 'estimated',
      quantity: quantity(4.2, 'Ma'),
      method: 'тест: экстраполяция по соседним нуклидам',
      provenance: { ...PROVENANCE, recordId: 'test:A=1' }
    };
    const ok = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([consistent]); }));
    expect(ok).toEqual([]);
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

  // ===== Аудит R3 (Stage 4.3.3): контекстная классификация состояний =====

  it('кандидат (R3): научная классификация обязательна; level/resonance/ias/indeterminate — не кандидаты', () => {
    const noCls = makeCandidate();
    delete (noCls as unknown as Record<string, unknown>).classification;
    const res1 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([noCls]); }));
    expect(res1.some((e) => e.includes('научная классификация состояния NUBASE2020 (classification) обязательна'))).toBe(true);
    for (const cls of ['level', 'resonance', 'ias', 'indeterminate']) {
      const cand = makeStateCandidate(1, 'm');
      (cand as unknown as Record<string, unknown>).classification = cls;
      const res = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([cand]); }));
      expect(res.some((e) => e.includes('кандидатами могут быть только строки, классифицированные как ground или isomer')), 'cls ' + cls).toBe(true);
    }
  });

  it('кандидат (R3): классификация согласована с видом состояния (ground/isomeric)', () => {
    const wrongGround = makeCandidate();
    (wrongGround as unknown as Record<string, unknown>).classification = 'isomer';
    const res1 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([wrongGround]); }));
    expect(res1.some((e) => e.includes('классификация isomer допустима только для изомерного состояния'))).toBe(true);
    const wrongIsomer = makeStateCandidate(1, 'm');
    (wrongIsomer as unknown as Record<string, unknown>).classification = 'ground';
    const res2 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([wrongIsomer]); }));
    expect(res2.some((e) => e.includes('классификация ground допустима только для основного состояния'))).toBe(true);
  });

  it('кандидат (R3): основание дополнительного изомера проверяется машинно (цепочка sibling-строк)', () => {
    // (4, q): контекст требует m, n И p — без p цепочка не доказана
    const qBad = makeStateCandidate(4, 'q', contextBasis([[1, 'm'], [2, 'n']]));
    const res1 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([qBad]); }));
    expect(res1.some((e) => e.includes('classificationBasis не доказывает контекст'))).toBe(true);
    // (4, q) с полной цепочкой m, n, p — валиден
    const qOk = makeStateCandidate(4, 'q', contextBasis([[1, 'm'], [2, 'n'], [3, 'p']]));
    const res2 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([qOk]); }));
    expect(res2).toEqual([]);
    // правило format не доказывает контекст дополнительного изомера
    const qFormat = makeStateCandidate(4, 'q', { rule: 'format' });
    const res3 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([qFormat]); }));
    expect(res3.some((e) => e.includes('обязан использовать правило context-more-than-two-isomers'))).toBe(true);
    // стандартный изомер с контекст-правилом — ошибка: его классифицирует сам формат
    const mCtx = makeStateCandidate(1, 'm', contextBasis([[1, 'm'], [2, 'n']]));
    const res4 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([mCtx]); }));
    expect(res4.some((e) => e.includes('classificationBasis допускается только с правилом format'))).toBe(true);
    // рассогласованная sibling-строка (2, m) в основании — ошибки
    const pBadSibling = makeStateCandidate(3, 'p', {
      rule: 'context-more-than-two-isomers',
      siblingStates: [
        { atomicNumber: 1, massNumber: 1, stateIndex: 1, stateCode: 'm', recordId: 'test:A=1 i=1 s=m' },
        { atomicNumber: 1, massNumber: 1, stateIndex: 2, stateCode: 'm', recordId: 'test:A=1 i=2 s=m' }
      ]
    });
    const res5 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([pBadSibling]); }));
    // (2, m) — рассогласованная пара: НЕ валидная строка источника (аудит R4)
    expect(res5.some((e) => e.includes('обязана быть ссылкой на конкретную строку NUBASE2020'))).toBe(true);
    expect(res5.some((e) => e.includes('требуются sibling-строки'))).toBe(true);
  });

  it('кандидат (R4, C5): sibling-строки основания — конкретные строки ТОГО ЖЕ (Z, A) нуклида', () => {
    // sibling ДРУГОГО нуклида (Z=2, A=4) — контекст не доказан
    const foreignSibling = makeStateCandidate(3, 'p', {
      rule: 'context-more-than-two-isomers',
      siblingStates: [
        { atomicNumber: 1, massNumber: 1, stateIndex: 1, stateCode: 'm', recordId: 'test:A=1 i=1 s=m' },
        { atomicNumber: 2, massNumber: 4, stateIndex: 2, stateCode: 'n', recordId: 'test:A=4 i=2 s=n' }
      ]
    });
    const res1 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([foreignSibling]); }));
    expect(res1.some((e) => e.includes('обязаны относиться к тому же (Z, A)'))).toBe(true);
    // дубликат sibling-строки (тот же recordId дважды) запрещён
    const dupSibling = makeStateCandidate(3, 'p', contextBasis([[1, 'm'], [1, 'm']]));
    const res2 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([dupSibling]); }));
    expect(res2.some((e) => e.includes('дубли sibling-строк запрещены'))).toBe(true);
    // дубликат пары (i, s) с ДРУГИМ recordId — тоже дубликат строки источника:
    // в NUBASE2020 каждая пара (i, s) нуклида представлена ровно один раз
    const dupPairSibling = makeStateCandidate(3, 'p', {
      rule: 'context-more-than-two-isomers',
      siblingStates: [
        { atomicNumber: 1, massNumber: 1, stateIndex: 1, stateCode: 'm', recordId: 'test:A=1 i=1 s=m' },
        { atomicNumber: 1, massNumber: 1, stateIndex: 1, stateCode: 'm', recordId: 'test:A=1 i=1 s=m:dup' }
      ]
    });
    const res2b = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([dupPairSibling]); }));
    expect(res2b.some((e) => e.includes('пара (i=1, s=m) того же (Z, A) повторяется'))).toBe(true);
    // самоссылка: sibling с recordId самого кандидата — не предшествующая строка
    const selfSibling = makeStateCandidate(3, 'p', {
      rule: 'context-more-than-two-isomers',
      siblingStates: [
        { atomicNumber: 1, massNumber: 1, stateIndex: 1, stateCode: 'm', recordId: 'test:A=1 i=1 s=m' },
        { atomicNumber: 1, massNumber: 1, stateIndex: 2, stateCode: 'n', recordId: 'test:A=1 i=3 s=p' }
      ]
    });
    const res3 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([selfSibling]); }));
    expect(res3.some((e) => e.includes('не может ссылаться сам на себя'))).toBe(true);
    // непредшествующая строка (i=4 при кандидате i=3) запрещена
    const lateSibling = makeStateCandidate(3, 'p', contextBasis([[1, 'm'], [4, 'q']]));
    const res4 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([lateSibling]); }));
    expect(res4.some((e) => e.includes('ПРЕДШЕСТВОВАТЬ'))).toBe(true);
    // sibling без recordId — не ссылка на строку источника
    const noIdSibling = makeStateCandidate(3, 'p', {
      rule: 'context-more-than-two-isomers',
      siblingStates: [
        { atomicNumber: 1, massNumber: 1, stateIndex: 1, stateCode: 'm' }
      ]
    } as unknown as StateClassificationBasis);
    const res5 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([noIdSibling]); }));
    expect(res5.some((e) => e.includes('обязана быть ссылкой на конкретную строку NUBASE2020'))).toBe(true);
    // валидное основание: конкретные строки (1, m) и (2, n) того же (Z=1, A=1)
    const okSibling = makeStateCandidate(3, 'p', contextBasis([[1, 'm'], [2, 'n']]));
    const res6 = validateChemicalElement(damaged((el) => { el.representativeIsotopeCandidates = candidatesWith([okSibling]); }));
    expect(res6).toEqual([]);
  });

  it('classifyNubaseState: контрольные примеры 92Tc p и 205Po p/q — дополнительные изомеры при контексте', () => {
    // Группа 92Tc NUBASE2020: ground (i=0), m (i=1), n (i=2), p (i=3).
    // Аудит R4, C5: строки группы — КОНКРЕТНЫЕ строки источника
    // (Z, A, i, s, recordId).
    const tc92: NubaseStateRowRef[] = [
      { atomicNumber: 43, massNumber: 92, stateIndex: 0, stateCode: '', recordId: 'nubase2020:Z=043,A=092,i=0,s=' },
      { atomicNumber: 43, massNumber: 92, stateIndex: 1, stateCode: 'm', recordId: 'nubase2020:Z=043,A=092,i=1,s=m' },
      { atomicNumber: 43, massNumber: 92, stateIndex: 2, stateCode: 'n', recordId: 'nubase2020:Z=043,A=092,i=2,s=n' },
      { atomicNumber: 43, massNumber: 92, stateIndex: 3, stateCode: 'p', recordId: 'nubase2020:Z=043,A=092,i=3,s=p' }
    ];
    expect(classifyNubaseState(tc92[0], tc92)).toEqual({ classification: 'ground' });
    expect(classifyNubaseState(tc92[1], tc92)).toEqual({ classification: 'isomer', basis: { rule: 'format' } });
    expect(classifyNubaseState(tc92[3], tc92)).toEqual({
      classification: 'isomer',
      basis: {
        rule: 'context-more-than-two-isomers',
        siblingStates: [tc92[1], tc92[2]]
      }
    });
    // Группа 205Po NUBASE2020: ground, m, n, p (i=3), q (i=4) — p и q
    // дополнительные изомеры (контрольный пример файла)
    const po205: NubaseStateRowRef[] = [
      { atomicNumber: 84, massNumber: 205, stateIndex: 0, stateCode: '', recordId: 'nubase2020:Z=084,A=205,i=0,s=' },
      { atomicNumber: 84, massNumber: 205, stateIndex: 1, stateCode: 'm', recordId: 'nubase2020:Z=084,A=205,i=1,s=m' },
      { atomicNumber: 84, massNumber: 205, stateIndex: 2, stateCode: 'n', recordId: 'nubase2020:Z=084,A=205,i=2,s=n' },
      { atomicNumber: 84, massNumber: 205, stateIndex: 3, stateCode: 'p', recordId: 'nubase2020:Z=084,A=205,i=3,s=p' },
      { atomicNumber: 84, massNumber: 205, stateIndex: 4, stateCode: 'q', recordId: 'nubase2020:Z=084,A=205,i=4,s=q' }
    ];
    expect(classifyNubaseState(po205[3], po205).classification).toBe('isomer');
    expect(classifyNubaseState(po205[3], po205).basis?.rule).toBe('context-more-than-two-isomers');
    expect(classifyNubaseState(po205[4], po205).classification).toBe('isomer');
    expect(classifyNubaseState(po205[4], po205).basis?.siblingStates).toEqual([
      po205[1],
      po205[2],
      po205[3]
    ]);
  });

  it('classifyNubaseState: 214Ra x — изомер при полной цепочке m,n,p,q,r; пары реестра детерминированы', () => {
    const ra214: NubaseStateRowRef[] = [
      { atomicNumber: 88, massNumber: 214, stateIndex: 0, stateCode: '', recordId: 'nubase2020:Z=088,A=214,i=0,s=' },
      { atomicNumber: 88, massNumber: 214, stateIndex: 1, stateCode: 'm', recordId: 'nubase2020:Z=088,A=214,i=1,s=m' },
      { atomicNumber: 88, massNumber: 214, stateIndex: 2, stateCode: 'n', recordId: 'nubase2020:Z=088,A=214,i=2,s=n' },
      { atomicNumber: 88, massNumber: 214, stateIndex: 3, stateCode: 'p', recordId: 'nubase2020:Z=088,A=214,i=3,s=p' },
      { atomicNumber: 88, massNumber: 214, stateIndex: 4, stateCode: 'q', recordId: 'nubase2020:Z=088,A=214,i=4,s=q' },
      { atomicNumber: 88, massNumber: 214, stateIndex: 5, stateCode: 'r', recordId: 'nubase2020:Z=088,A=214,i=5,s=r' },
      { atomicNumber: 88, massNumber: 214, stateIndex: 6, stateCode: 'x', recordId: 'nubase2020:Z=088,A=214,i=6,s=x' }
    ];
    const x = classifyNubaseState(ra214[6], ra214);
    expect(x.classification).toBe('isomer');
    expect(x.basis?.siblingStates).toHaveLength(5);
    // основание указывает на конкретные sibling-строки группы (аудит R4)
    expect(x.basis?.siblingStates).toEqual(ra214.slice(1, 6));
    // каждая пара реестра классифицируется детерминированно; вне
    // контекста изомерами остаются только стандартные строки (1, m), (2, n)
    for (const key of Object.keys(NUBASE_STATE_CODE_BY_INDEX)) {
      const i = Number(key);
      const row: NubaseStateRowRef = {
        atomicNumber: 88,
        massNumber: 214,
        stateIndex: i,
        stateCode: NUBASE_STATE_CODE_BY_INDEX[i],
        recordId: 'nubase2020:Z=088,A=214,i=' + i + ',s=' + NUBASE_STATE_CODE_BY_INDEX[i]
      };
      const alone = classifyNubaseState(row, [row]);
      expect(classifyNubaseState(row, [row]), 'i=' + i).toEqual(alone);
      if (i === 1 || i === 2) {
        expect(alone.classification, 'i=' + i).toBe('isomer');
      } else {
        expect(alone.classification, 'i=' + i).not.toBe('isomer');
      }
    }
  });

  it('classifyNubaseState: p/q без контекста — уровни, r без контекста — резонанс, x без цепочки — indeterminate, IAS и рассогласования', () => {
    // (3, p) без m, n в группе: уровень, а не изомер
    // (контрольный пример 183Au p — уровень вне контекста)
    const loneP: NubaseStateRowRef[] = [
      { atomicNumber: 79, massNumber: 183, stateIndex: 0, stateCode: '', recordId: 'nubase2020:Z=079,A=183,i=0,s=' },
      { atomicNumber: 79, massNumber: 183, stateIndex: 3, stateCode: 'p', recordId: 'nubase2020:Z=079,A=183,i=3,s=p' }
    ];
    expect(classifyNubaseState(loneP[1], loneP)).toEqual({ classification: 'level' });
    // 255No p — уровень вне контекста (в группе нет (2, n))
    const noP: NubaseStateRowRef[] = [
      { atomicNumber: 102, massNumber: 255, stateIndex: 0, stateCode: '', recordId: 'nubase2020:Z=102,A=255,i=0,s=' },
      { atomicNumber: 102, massNumber: 255, stateIndex: 3, stateCode: 'p', recordId: 'nubase2020:Z=102,A=255,i=3,s=p' }
    ];
    expect(classifyNubaseState(noP[1], noP)).toEqual({ classification: 'level' });
    // (4, q) с m, n, но без (3, p): цепочка разорвана — уровень
    const qNoP: NubaseStateRowRef[] = [
      { atomicNumber: 79, massNumber: 183, stateIndex: 1, stateCode: 'm', recordId: 'nubase2020:Z=079,A=183,i=1,s=m' },
      { atomicNumber: 79, massNumber: 183, stateIndex: 2, stateCode: 'n', recordId: 'nubase2020:Z=079,A=183,i=2,s=n' },
      { atomicNumber: 79, massNumber: 183, stateIndex: 4, stateCode: 'q', recordId: 'nubase2020:Z=079,A=183,i=4,s=q' }
    ];
    expect(classifyNubaseState(qNoP[2], qNoP)).toEqual({ classification: 'level' });
    // (5, r) без полной цепочки: резонанс (контрольный пример 28Si r)
    const siR: NubaseStateRowRef = { atomicNumber: 14, massNumber: 28, stateIndex: 5, stateCode: 'r', recordId: 'nubase2020:Z=014,A=028,i=5,s=r' };
    expect(classifyNubaseState(siR, [siR])).toEqual({ classification: 'resonance' });
    // (6, x) без полной цепочки: формат не задаёт тип x вне контекста — indeterminate, НЕ изомер
    const xAlone: NubaseStateRowRef = { atomicNumber: 88, massNumber: 214, stateIndex: 6, stateCode: 'x', recordId: 'nubase2020:Z=088,A=214,i=6,s=x' };
    expect(classifyNubaseState(xAlone, [xAlone])).toEqual({ classification: 'indeterminate' });
    // IAS: (8, i) и (9, j) — кандидатами не являются
    const iasI: NubaseStateRowRef = { atomicNumber: 5, massNumber: 11, stateIndex: 8, stateCode: 'i', recordId: 'nubase2020:Z=005,A=011,i=8,s=i' };
    expect(classifyNubaseState(iasI, [iasI])).toEqual({ classification: 'ias' });
    const iasJ: NubaseStateRowRef = { atomicNumber: 5, massNumber: 11, stateIndex: 9, stateCode: 'j', recordId: 'nubase2020:Z=005,A=011,i=9,s=j' };
    expect(classifyNubaseState(iasJ, [iasJ])).toEqual({ classification: 'ias' });
    // рассогласованная пара (1, p) — indeterminate, тип состояния не угадывается
    const mismatch: NubaseStateRowRef = { atomicNumber: 43, massNumber: 92, stateIndex: 1, stateCode: 'p' as NuclideCandidate['stateCode'], recordId: 'nubase2020:Z=043,A=092,i=1,s=p' };
    const validM: NubaseStateRowRef = { atomicNumber: 43, massNumber: 92, stateIndex: 1, stateCode: 'm', recordId: 'nubase2020:Z=043,A=092,i=1,s=m' };
    expect(classifyNubaseState(mismatch, [validM])).toEqual({ classification: 'indeterminate' });
  });

  it('classifyNubaseState (R4, C5): чужие (Z, A) строки, дубликаты recordId и отсутствие строки в группе — indeterminate', () => {
    const m = { atomicNumber: 43, massNumber: 92, stateIndex: 1, stateCode: 'm' as const, recordId: 'nubase2020:Z=043,A=092,i=1,s=m' };
    const n = { atomicNumber: 43, massNumber: 92, stateIndex: 2, stateCode: 'n' as const, recordId: 'nubase2020:Z=043,A=092,i=2,s=n' };
    const p = { atomicNumber: 43, massNumber: 92, stateIndex: 3, stateCode: 'p' as const, recordId: 'nubase2020:Z=043,A=092,i=3,s=p' };
    // валидная группа: p — дополнительный изомер, основание — конкретные строки
    expect(classifyNubaseState(p, [m, n, p]).classification).toBe('isomer');
    expect(classifyNubaseState(p, [m, n, p]).basis?.siblingStates).toEqual([m, n]);
    // sibling ДРУГОГО нуклида (Z=44): контекст группы не доказан
    const foreign = { atomicNumber: 44, massNumber: 92, stateIndex: 2, stateCode: 'n' as const, recordId: 'nubase2020:Z=044,A=092,i=2,s=n' };
    expect(classifyNubaseState(p, [m, foreign, p]).classification).toBe('indeterminate');
    // дубликат recordId в группе — indeterminate
    expect(classifyNubaseState(p, [m, n, p, { ...m }]).classification).toBe('indeterminate');
    // та же пара (i, s) с ДРУГИМ recordId — дубликат строки источника
    expect(classifyNubaseState(p, [m, n, p, { ...m, recordId: 'other:row' }]).classification).toBe('indeterminate');
    // классифицируемая строка отсутствует в собственной группе — indeterminate
    expect(classifyNubaseState(p, [m, n]).classification).toBe('indeterminate');
    // дубликаты не формируют цепочку искусственно: повтор строки (2, n)
    // не заменяет отсутствующую (1, m) и не доказывает контекст — группа
    // с дубликатом строки не соответствует реальному нуклиду, тип не угадывается
    const nDup = { ...n, recordId: 'nubase2020:Z=043,A=092,i=2,s=n:dup' };
    expect(classifyNubaseState(p, [n, nDup, p]).classification).toBe('indeterminate');
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
