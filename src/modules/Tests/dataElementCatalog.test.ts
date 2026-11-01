// ============================================
// STAGE 4.3.3 - Тесты данных каталога 118 химических элементов:
// полнота, веса CIAAW 2024, изотопные распространённости,
// кандидаты NUBASE2020, provenance, ElementCounts, детерминированность
// ============================================
//
// Проверяются фактические данные Data/elements.ts и
// Data/elementIsotopeCandidates.ts против зафиксированных значений
// источников: IUPAC PT (2022-05-04), CIAAW SAW 2024,
// CIAAW Isotopic Compositions 2024, NUBASE2020.
// Контрольные случаи: Tc/Pm/Po (нет веса), Bi/Th/Pa/U (вес есть,
// хотя элементы радиоактивны), Md-258/Lr/Mt/Lv (несколько кандидатов
// или изомеры), сверхтяжёлые элементы (неполнота данных).

import { describe, it, expect } from 'vitest';
import {
  buildElement,
  buildElementCatalog,
  elementCatalogCoverage,
  parseCiaawBracketUncertainty
} from '../Data/elements';
import { ELEMENTS_WITH_CANDIDATES, isotopeCandidateCoverage } from '../Data/elementIsotopeCandidates';
import { validateChemicalElement, checkElementCountsReference } from '../Core/elements';
import type { ChemicalElement, RepresentativeIsotopeCandidates } from '../Core/elements';
import { elementCompositions } from '../Data/elementCompositions';
import { buildThermodynamicCatalog, THERMODYNAMIC_CATALOG_SPECIES_IDS } from '../Data/thermodynamicCatalog';
import { toSI } from '../Core/physicalQuantity';

function allElements(): readonly ChemicalElement[] {
  return buildElementCatalog().list();
}

function expectKnownCandidates(el: ChemicalElement): RepresentativeIsotopeCandidates {
  const c = el.representativeIsotopeCandidates;
  if (c.status !== 'known') {
    throw new Error('у Z=' + el.atomicNumber + ' ожидались известные кандидаты, получен ' + c.status);
  }
  return c;
}

describe('Stage 4.3.3 (данные): полнота каталога 118 элементов', () => {
  it('в каталоге ровно 118 элементов, Z покрывают 1…118 без пропусков, порядок по Z', () => {
    const els = allElements();
    expect(els).toHaveLength(118);
    expect(els.map((e) => e.atomicNumber)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
  });

  it('атомные номера и символы уникальны', () => {
    const els = allElements();
    expect(new Set(els.map((e) => e.atomicNumber)).size).toBe(118);
    expect(new Set(els.map((e) => e.symbol)).size).toBe(118);
  });

  it('у каждого элемента непустые английское и русское названия', () => {
    for (const el of allElements()) {
      expect(el.nameEnglish.trim(), 'Z=' + el.atomicNumber).not.toBe('');
      expect(el.nameRussian.trim(), 'Z=' + el.atomicNumber).not.toBe('');
    }
  });

  it('поиск по атомному номеру и символу возвращает одну и ту же запись', () => {
    const catalog = buildElementCatalog();
    const els = catalog.list();
    for (const el of els) {
      expect(catalog.getByAtomicNumber(el.atomicNumber)).toBe(catalog.getBySymbol(el.symbol));
      expect(catalog.getBySymbol(el.symbol)).toBe(el);
    }
  });

  it('все 118 записей проходят validateChemicalElement без ошибок', () => {
    for (const el of allElements()) {
      expect(validateChemicalElement(el), 'Z=' + el.atomicNumber).toEqual([]);
    }
  });

  it('идентификация: спот-чеки названий и символов', () => {
    expect(buildElement(1).symbol).toBe('H');
    expect(buildElement(1).nameEnglish).toBe('Hydrogen');
    expect(buildElement(1).nameRussian).toBe('водород');
    expect(buildElement(53).nameRussian).toBe('иод');
    const nh = buildElement(113);
    expect(nh.nameEnglish).toBe('Nihonium');
    expect(nh.nameRussian).toBe('нихоний');
    const og = buildElement(118);
    expect(og.symbol).toBe('Og');
    expect(og.nameRussian).toBe('оганесон');
  });

  it('положение в таблице: группы, периоды, блоки; спорные случаи документированы', () => {
    const els = allElements();
    const h = buildElement(1).position;
    expect(h.group).toBe(1);
    expect(h.period).toBe(1);
    expect(h.block).toBe('s');
    const la = buildElement(57).position;
    expect(la.group).toBe(null);
    expect(la.groupNotAssignedReason ?? '').toContain('группы 3');
    expect(la.block).toBe(null);
    expect(la.blockUnknownReason ?? '').toContain('группы 3');
    const ce = buildElement(58).position;
    expect(ce.group).toBe(null);
    expect(ce.block).toBe('f');
    const og = buildElement(118).position;
    expect(og.group).toBe(18);
    expect(og.period).toBe(7);
    expect(og.block).toBe('p');
    const noGroup = els.filter((e) => e.position.group === null).map((e) => e.atomicNumber);
    expect(noGroup).toHaveLength(30);
    expect(new Set(noGroup)).toEqual(new Set([
      ...Array.from({ length: 15 }, (_, i) => 57 + i),
      ...Array.from({ length: 15 }, (_, i) => 89 + i)
    ]));
    const noBlock = els.filter((e) => e.position.block === null).map((e) => e.symbol);
    expect(noBlock).toEqual(['La', 'Lu', 'Ac', 'Lr']);
  });

  it('категории: 103 known, 15 unknown у Z=104…118; спорные классификации с оговорками', () => {
    const els = allElements();
    const cov = elementCatalogCoverage();
    expect(cov.categoryKnown).toBe(103);
    expect(cov.categoryUnknown).toBe(15);
    const unknownCats = els.filter((e) => e.category.status === 'unknown').map((e) => e.atomicNumber);
    expect(unknownCats).toHaveLength(15);
    expect(unknownCats[0]).toBe(104);
    expect(unknownCats[unknownCats.length - 1]).toBe(118);
    const po = buildElement(84).category;
    if (po.status !== 'known') throw new Error('у Po категория должна быть known');
    expect(po.notes?.join(' ') ?? '').toContain('спорна');
    const he = buildElement(2).category;
    if (he.status !== 'known') throw new Error('у He категория должна быть known');
    expect(he.category).toBe('noble_gas');
  });
});

describe('Stage 4.3.3 (данные): стандартные атомные веса CIAAW 2024', () => {
  it('H — интервальный вес [1.00784, 1.00811] с нотацией, сноской m и recordId', () => {
    const w = buildElement(1).standardAtomicWeight;
    if (w.kind !== 'interval') throw new Error('у H должен быть интервальный вес');
    expect(w.lower).toBe(1.00784);
    expect(w.upper).toBe(1.00811);
    expect(w.rawNotation).toBe('[1.00784,1.00811]');
    expect(w.note ?? '').toContain('сноска CIAAW m');
    expect(w.provenance.recordId).toBe('ciaaw-saw-2024:Z=1 H');
  });

  it('He — 4.002602(2): значение, неопределённость, сноски g и r', () => {
    const w = buildElement(2).standardAtomicWeight;
    if (w.kind !== 'value_with_uncertainty') throw new Error('у He должен быть вес со скобочной неопределённостью');
    expect(w.value).toBe(4.002602);
    expect(w.uncertainty).toBeCloseTo(0.000002, 12);
    expect(w.rawNotation).toBe('4.002602(2)');
    expect(w.note ?? '').toContain('сноска CIAAW g');
    expect(w.note ?? '').toContain('сноска CIAAW r');
  });

  it('Yb — 173.045(10): скобочная запись разбирается в неопределённость 0.01', () => {
    const w = buildElement(70).standardAtomicWeight;
    if (w.kind !== 'value_with_uncertainty') throw new Error('у Yb должен быть вес со скобочной неопределённостью');
    expect(w.value).toBe(173.045);
    expect(w.uncertainty).toBeCloseTo(0.01, 12);
    expect(w.rawNotation).toBe('173.045(10)');
  });

  it('покрытие весов: 14 интервальных, 70 со скобочной неопределённостью, 34 not_assigned', () => {
    const cov = elementCatalogCoverage();
    expect(cov.standardAtomicWeightsInterval).toBe(14);
    expect(cov.standardAtomicWeightsValueWithUncertainty).toBe(70);
    expect(cov.standardAtomicWeightsNotAssigned).toBe(34);
    expect(cov.standardAtomicWeightsInterval + cov.standardAtomicWeightsValueWithUncertainty + cov.standardAtomicWeightsNotAssigned).toBe(118);
  });

  it('Bi, Th, Pa, U — радиоактивные элементы со стандартным весом', () => {
    const expectSingleWeight = (z: number, value: number, uncertainty: number, rawNotation: string): void => {
      const w = buildElement(z).standardAtomicWeight;
      if (w.kind !== 'value_with_uncertainty') throw new Error('Z=' + z + ': ожидался вес со скобочной неопределённостью');
      expect(w.value, 'Z=' + z).toBe(value);
      expect(w.uncertainty, 'Z=' + z).toBeCloseTo(uncertainty, 12);
      expect(w.rawNotation, 'Z=' + z).toBe(rawNotation);
    };
    expectSingleWeight(83, 208.9804, 0.00001, '208.98040(1)');
    expectSingleWeight(90, 232.0377, 0.0004, '232.0377(4)');
    expectSingleWeight(91, 231.03588, 0.00001, '231.03588(1)');
    expectSingleWeight(92, 238.02891, 0.00003, '238.02891(3)');
  });

  it('Tc, Pm, Po — not_assigned с объяснением, без числовой подстановки', () => {
    for (const z of [43, 61, 84]) {
      const w = buildElement(z).standardAtomicWeight;
      if (w.kind !== 'not_assigned') throw new Error('Z=' + z + ': CIAAW 2024 ставит прочерк');
      expect(w.reason, 'Z=' + z).toContain('не назначается');
      expect(w.reason, 'Z=' + z).toContain('НЕ ноль');
      expect(w.provenance.recordId, 'Z=' + z).toContain('ciaaw-saw-2024');
    }
  });

  it('множество элементов без веса — ровно Z=43, 61, 84…89, 93…118', () => {
    const noWeight = allElements().filter((e) => e.standardAtomicWeight.kind === 'not_assigned').map((e) => e.atomicNumber);
    expect(noWeight).toHaveLength(34);
    const expected = new Set<number>([
      43, 61, 84, 85, 86, 87, 88, 89,
      ...Array.from({ length: 26 }, (_, i) => 93 + i)
    ]);
    expect(new Set(noWeight)).toEqual(expected);
  });

  it('все интервальные веса: lower < upper, конечны, rawNotation сохранён', () => {
    const intervals = allElements().filter((e) => e.standardAtomicWeight.kind === 'interval');
    expect(intervals).toHaveLength(14);
    for (const el of intervals) {
      const w = el.standardAtomicWeight;
      if (w.kind !== 'interval') continue;
      expect(Number.isFinite(w.lower)).toBe(true);
      expect(Number.isFinite(w.upper)).toBe(true);
      expect(w.lower < w.upper, 'Z=' + el.atomicNumber).toBe(true);
      expect(w.rawNotation).toContain('[');
    }
  });

  it('все скобочные веса: конечное значение, неопределённость неотрицательна и конечна', () => {
    const singles = allElements().filter((e) => e.standardAtomicWeight.kind === 'value_with_uncertainty');
    expect(singles).toHaveLength(70);
    for (const el of singles) {
      const w = el.standardAtomicWeight;
      if (w.kind !== 'value_with_uncertainty') continue;
      expect(Number.isFinite(w.value), 'Z=' + el.atomicNumber).toBe(true);
      expect(w.uncertainty >= 0, 'Z=' + el.atomicNumber).toBe(true);
      expect(Number.isFinite(w.uncertainty), 'Z=' + el.atomicNumber).toBe(true);
      expect(w.rawNotation.includes('(')).toBe(true);
    }
  });

  it('not_assigned не содержит числовых полей value/lower/upper', () => {
    for (const el of allElements()) {
      const w = el.standardAtomicWeight;
      if (w.kind !== 'not_assigned') continue;
      const rec = w as unknown as Record<string, unknown>;
      expect('value' in rec, 'Z=' + el.atomicNumber).toBe(false);
      expect('lower' in rec, 'Z=' + el.atomicNumber).toBe(false);
      expect('upper' in rec, 'Z=' + el.atomicNumber).toBe(false);
    }
  });

  it('parseCiaawBracketUncertainty корректно разбирает разрядность скобок', () => {
    expect(parseCiaawBracketUncertainty('4.002602', '2')).toBeCloseTo(0.000002, 12);
    expect(parseCiaawBracketUncertainty('173.045', '10')).toBeCloseTo(0.01, 12);
    expect(parseCiaawBracketUncertainty('40.078', '4')).toBeCloseTo(0.004, 12);
    expect(parseCiaawBracketUncertainty('232.0377', '4')).toBeCloseTo(0.0004, 12);
  });

  it('parseCiaawBracketUncertainty отвергает нецифровые скобки', () => {
    expect(() => parseCiaawBracketUncertainty('4.002602', 'аб')).toThrow();
    expect(() => parseCiaawBracketUncertainty('4.002602', 'x2')).toThrow();
  });
});

describe('Stage 4.3.3 (данные): изотопные распространённости CIAAW 2024', () => {
  it('H: две записи с интервальными распространённостями без пересчёта', () => {
    const iso = buildElement(1).isotopicComposition;
    if (iso.status !== 'known') throw new Error('у H должен быть known-состав');
    const rs = iso.records ?? [];
    expect(rs).toHaveLength(2);
    expect(rs[0].massNumber).toBe(1);
    if (rs[0].abundance.kind !== 'interval') throw new Error('1H — интервальная распространённость');
    expect(rs[0].abundance.lower).toBe(0.99972);
    expect(rs[0].abundance.upper).toBe(0.99999);
    expect(rs[0].abundance.rawNotation).toBe('[0.99972,0.99999]');
    expect(rs[0].abundance.provenance.recordId).toBe('ciaaw-iso-2024:Z=1 H A=1');
    expect(rs[1].massNumber).toBe(2);
    if (rs[1].abundance.kind !== 'interval') throw new Error('2H — интервальная распространённость');
    expect(rs[1].abundance.lower).toBe(0.00001);
    expect(rs[1].abundance.upper).toBe(0.00028);
  });

  it('He: записи 3 и 4 со значениями и скобочными неопределённостями', () => {
    const iso = buildElement(2).isotopicComposition;
    if (iso.status !== 'known') throw new Error('у He должен быть known-состав');
    const rs = iso.records ?? [];
    expect(rs).toHaveLength(2);
    expect(rs[0].massNumber).toBe(3);
    if (rs[0].abundance.kind !== 'value') throw new Error('3He — одиночное значение');
    expect(rs[0].abundance.value).toBe(0.000002);
    expect(rs[0].abundance.uncertainty).toBeCloseTo(0.000002, 12);
    expect(rs[1].massNumber).toBe(4);
    if (rs[1].abundance.kind !== 'value') throw new Error('4He — одиночное значение');
    expect(rs[1].abundance.value).toBe(0.999998);
    expect(rs[1].abundance.uncertainty).toBeCloseTo(0.000002, 12);
  });

  it('покрытие: 84 known, 34 not_applicable, 289 изотопных записей', () => {
    const cov = elementCatalogCoverage();
    expect(cov.isotopicKnown).toBe(84);
    expect(cov.isotopicNotApplicable).toBe(34);
    expect(cov.isotopeRecords).toBe(289);
    expect(cov.isotopicKnown + cov.isotopicNotApplicable).toBe(118);
  });

  it('все known-записи: целые массовые числа, распространённости в [0,1], recordId и rawNotation', () => {
    for (const el of allElements()) {
      const iso = el.isotopicComposition;
      if (iso.status !== 'known') continue;
      for (const rec of iso.records ?? []) {
        expect(Number.isInteger(rec.massNumber), 'Z=' + el.atomicNumber).toBe(true);
        expect(rec.massNumber > 0).toBe(true);
        const ab = rec.abundance;
        if (ab.kind === 'interval') {
          expect(ab.lower >= 0 && ab.upper <= 1, 'Z=' + el.atomicNumber + ' A=' + rec.massNumber).toBe(true);
          expect(ab.lower <= ab.upper, 'Z=' + el.atomicNumber + ' A=' + rec.massNumber).toBe(true);
        } else if (ab.kind === 'value') {
          expect(ab.value >= 0 && ab.value <= 1, 'Z=' + el.atomicNumber + ' A=' + rec.massNumber).toBe(true);
        }
        expect(ab.rawNotation.trim() !== '', 'Z=' + el.atomicNumber + ' A=' + rec.massNumber).toBe(true);
        expect(ab.provenance.recordId ?? '').toContain('ciaaw-iso-2024');
      }
    }
  });

  it('Tc — только массовое число (NA:97); Np — элемент отсутствует в таблице', () => {
    const tc = buildElement(43).isotopicComposition;
    if (tc.status !== 'not_applicable') throw new Error('у Tc изотопный состав not_applicable');
    expect(tc.reason).toContain('97');
    expect(tc.reason).toContain('массовое число');
    const np = buildElement(93).isotopicComposition;
    if (np.status !== 'not_applicable') throw new Error('у Np изотопный состав not_applicable');
    expect(np.reason).toContain('отсутствует в таблице');
  });

  it('нет веса — not_applicable, есть вес — known: выдуманных составов не появляется', () => {
    for (const el of allElements()) {
      const noWeight = el.standardAtomicWeight.kind === 'not_assigned';
      expect(el.isotopicComposition.status, 'Z=' + el.atomicNumber).toBe(noWeight ? 'not_applicable' : 'known');
    }
  });
});

describe('Stage 4.3.3 (данные): репрезентативные изотопы-кандидаты NUBASE2020', () => {
  it('покрытие: 34 элемента, 44 записи, 3 изомерных состояния, 43 уникальных нуклида; все experimental', () => {
    const cov = elementCatalogCoverage();
    const ic = isotopeCandidateCoverage();
    expect(ic.elements).toBe(34);
    expect(ic.candidateRecords).toBe(44);
    expect(ic.isomericStates).toBe(3);
    expect(ic.uniqueNuclides).toBe(43);
    expect(ic.experimental).toBe(44);
    expect(ic.completeElements).toBe(14);
    expect(ic.incompleteElements).toBe(20);
    expect(cov.candidateElements).toBe(ic.elements);
    expect(cov.candidateRecords).toBe(ic.candidateRecords);
    expect(cov.candidateUniqueNuclides).toBe(ic.uniqueNuclides);
    expect(cov.candidateIsomericStates).toBe(ic.isomericStates);
    expect(cov.candidateCompleteElements).toBe(ic.completeElements);
    expect(cov.candidateIncompleteElements).toBe(ic.incompleteElements);
    // изомерные состояния: Hs-277m, Mt-276m, Lv-293m (Md-258 — основное состояние, i=0)
    const isomers = allElements()
      .flatMap((e) => {
        const c = e.representativeIsotopeCandidates;
        return c.status === 'known' ? (c.candidates ?? []) : [];
      })
      .filter((x) => x.state === 'isomeric')
      .map((x) => x.nuclideNotation)
      .sort();
    expect(isomers).toEqual(['Hs-277m', 'Lv-293m', 'Mt-276m']);
    // Lv-293: одно массовое число — два состояния
    const lv = expectKnownCandidates(buildElement(116));
    expect((lv.candidates ?? []).map((x) => x.massNumber)).toEqual([293, 293]);
  });

  it('кандидаты — только у элементов без веса; с весом — not_applicable с причиной', () => {
    for (const el of allElements()) {
      const c = el.representativeIsotopeCandidates;
      if (el.standardAtomicWeight.kind === 'not_assigned') {
        expect(c.status, 'Z=' + el.atomicNumber).toBe('known');
      } else {
        expect(c.status, 'Z=' + el.atomicNumber).toBe('not_applicable');
        expect(c.notApplicableReason ?? '').toContain('стандартный атомный вес');
      }
    }
  });

  it('Z кандидатов совпадает с ELEMENTS_WITH_CANDIDATES в порядке Z', () => {
    const zsWithCand = allElements()
      .filter((e) => e.representativeIsotopeCandidates.status === 'known')
      .map((e) => e.atomicNumber);
    expect(zsWithCand).toEqual([...ELEMENTS_WITH_CANDIDATES]);
  });

  it('Tc: Tc-97 и Tc-98 — равноправные кандидаты, 1σ-интервалы перекрываются', () => {
    const c = expectKnownCandidates(buildElement(43));
    expect(c.completeness).toBe('complete');
    expect(c.completenessNote ?? '').toContain('полнота НЕ является доказательством');
    const cands = c.candidates ?? [];
    expect(cands).toHaveLength(2);
    const a97 = cands.find((x) => x.massNumber === 97);
    const a98 = cands.find((x) => x.massNumber === 98);
    if (!a97 || !a98) throw new Error('Tc-97 и Tc-98 должны быть кандидатами');
    expect(a97.nuclideNotation).toBe('Tc-97');
    expect(a97.state).toBe('ground');
    expect(a97.dataStatus).toBe('experimental');
    if (a97.halfLife.status !== 'known' || a98.halfLife.status !== 'known') {
      throw new Error('периоды полураспада Tc должны быть known');
    }
    expect(a97.halfLife.quantity.value).toBe(4.21);
    expect(a97.halfLife.quantity.unit).toBe('My');
    expect(a98.halfLife.quantity.value).toBe(4.2);
    const u97 = a97.halfLife.uncertainty;
    const u98 = a98.halfLife.uncertainty;
    if (!u97 || !u98 || u97.kind !== 'stddev' || u98.kind !== 'stddev') {
      throw new Error('неопределённости Tc должны быть stddev');
    }
    expect(4.21 - u97.sigma <= 4.2 + u98.sigma && 4.2 - u98.sigma <= 4.21 + u97.sigma).toBe(true);
    expect(a97.reason).toContain('равноправными');
  });

  it('Pm: единственный кандидат Pm-145, 17.7(4) y (год NUBASE2020), с recordId NUBASE2020', () => {
    const c = expectKnownCandidates(buildElement(61));
    expect(c.completeness).toBe('complete');
    const cands = c.candidates ?? [];
    expect(cands).toHaveLength(1);
    const pm = cands[0];
    expect(pm.massNumber).toBe(145);
    expect(pm.nuclideNotation).toBe('Pm-145');
    if (pm.halfLife.status !== 'known') throw new Error('17.7(4) y должно быть known');
    expect(pm.halfLife.quantity.value).toBe(17.7);
    expect(pm.halfLife.quantity.unit).toBe('y');
    expect(pm.halfLifeRawNotation).toBe('17.7(4) y');
    expect(pm.recordId).toBe('nubase2020:Z=61 Pm A=145 i=0');
  });

  it('Po: единственный кандидат Po-209, 124(3) y (год NUBASE2020)', () => {
    const c = expectKnownCandidates(buildElement(84));
    const cands = c.candidates ?? [];
    expect(cands).toHaveLength(1);
    const po = cands[0];
    expect(po.massNumber).toBe(209);
    if (po.halfLife.status !== 'known') throw new Error('124(3) y должно быть known');
    expect(po.halfLife.quantity.value).toBe(124);
    expect(po.halfLife.quantity.unit).toBe('y');
    expect(po.halfLifeRawNotation).toBe('124(3) y');
    expect(po.recordId).toBe('nubase2020:Z=84 Po A=209 i=0');
  });

  it('записи с годовыми единицами NUBASE2020: значения в y/ky/My, SI-секунды тропического года, σ сохранена', () => {
    const expectYear = (z: number, a: number, value: number, sigma: number, unit: 'y' | 'ky' | 'My', raw: string): void => {
      const c = expectKnownCandidates(buildElement(z));
      const cand = (c.candidates ?? []).find((x) => x.massNumber === a);
      if (!cand) throw new Error('Z=' + z + ' A=' + a + ': ожидался кандидат');
      if (cand.halfLife.status !== 'known') throw new Error('Z=' + z + ' A=' + a + ': период полураспада должен быть known');
      expect(cand.halfLife.quantity.value, 'Z=' + z + ' A=' + a).toBe(value);
      expect(cand.halfLife.quantity.unit, 'Z=' + z + ' A=' + a).toBe(unit);
      expect(cand.halfLifeRawNotation, 'Z=' + z + ' A=' + a).toBe(raw);
      const u = cand.halfLife.uncertainty;
      if (!u || u.kind !== 'stddev') throw new Error('Z=' + z + ' A=' + a + ': неопределённость должна быть stddev');
      expect(u.sigma, 'Z=' + z + ' A=' + a).toBe(sigma);
      // SI-секунды: тропический год NUBASE2020 (1 y = 31 556 926 с), без пересчёта значений
      const siFactor = unit === 'y' ? 31556926 : unit === 'ky' ? 31556926000 : 31556926000000;
      expect(toSI(cand.halfLife.quantity), 'Z=' + z + ' A=' + a).toBeCloseTo(value * siFactor, 3);
    };
    // исходные величины в y (год NUBASE2020)
    expectYear(61, 145, 17.7, 0.4, 'y', '17.7(4) y');
    expectYear(84, 209, 124, 3, 'y', '124(3) y');
    expectYear(89, 227, 21.772, 0.003, 'y', '21.772(3) y');
    expectYear(98, 251, 898, 44, 'y', '898(44) y');
    // исходные величины в ky
    expectYear(88, 226, 1.6, 0.007, 'ky', '1.600(7) ky');
    expectYear(95, 243, 7.35, 0.009, 'ky', '7.350(9) ky');
    expectYear(97, 247, 1.38, 0.25, 'ky', '1.38(25) ky');
    // исходные величины в My
    expectYear(43, 97, 4.21, 0.16, 'My', '4.21(16) My');
    expectYear(43, 98, 4.2, 0.3, 'My', '4.2(3) My');
    expectYear(93, 237, 2.144, 0.007, 'My', '2.144(7) My');
    expectYear(94, 244, 81.3, 0.3, 'My', '81.3(3) My');
    expectYear(96, 247, 15.6, 0.5, 'My', '15.6(5) My');
    // ни одна запись-кандидат не использует юлианские yr/ka/Ma
    // (физически некорректное приписывание значений NUBASE2020 устранено)
    for (const el of allElements()) {
      const c = el.representativeIsotopeCandidates;
      if (c.status !== 'known') continue;
      for (const cand of c.candidates ?? []) {
        if (cand.halfLife.status !== 'known') continue;
        expect(['yr', 'ka', 'Ma'].includes(cand.halfLife.quantity.unit), cand.nuclideNotation).toBe(false);
      }
    }
  });

  it('Bi, Th, Pa, U: кандидаты not_applicable (вес назначен)', () => {
    for (const z of [83, 90, 91, 92]) {
      const c = buildElement(z).representativeIsotopeCandidates;
      expect(c.status, 'Z=' + z).toBe('not_applicable');
    }
  });

  it('Md-258: основное состояние (строка i=0), звёздочка Isom.Unc, recordId без m', () => {
    const c = expectKnownCandidates(buildElement(101));
    const cands = c.candidates ?? [];
    expect(cands).toHaveLength(1);
    const md = cands[0];
    expect(md.state).toBe('ground');
    expect(md.nuclideNotation).toBe('Md-258');
    expect(md.stateNote ?? '').toContain('звёздочка');
    expect(md.stateNote ?? '').toContain('порядок');
    expect(md.recordId).toBe('nubase2020:Z=101 Md A=258 i=0');
    expect(md.stateIndex).toBe(0);
    expect(md.stateCode).toBe('');
    expect(md.halfLifeRawNotation).toBe('51.59(29) d');
    if (md.halfLife.status !== 'known') throw new Error('51.59(29) d должно быть known');
    expect(md.halfLife.quantity.value).toBe(51.59);
    expect(md.halfLife.quantity.unit).toBe('day');
    const u = md.halfLife.uncertainty;
    if (!u || u.kind !== 'stddev') throw new Error('неопределённость Md-258 должна быть stddev');
    expect(u.sigma).toBe(0.29);
  });

  it('точное состояние NUBASE2020 у всех 44 записей: stateIndex/stateCode согласованы, recordId строки источника', () => {
    let records = 0;
    for (const el of allElements()) {
      const c = el.representativeIsotopeCandidates;
      if (c.status !== 'known') continue;
      for (const cand of c.candidates ?? []) {
        records += 1;
        const where = 'Z=' + el.atomicNumber + ' ' + cand.nuclideNotation;
        // индекс состояния: целое 0…9; код: из множества NUBASE2020
        expect(Number.isInteger(cand.stateIndex) && cand.stateIndex >= 0 && cand.stateIndex <= 9, where).toBe(true);
        expect(['', 'm', 'n', 'p', 'q', 'r', 'x', 'i', 'j'].includes(cand.stateCode), where).toBe(true);
        // согласованность i ↔ s (NUBASE2020: 0↔'', 1↔m, 2↔n, 3↔p, 4↔q, 5↔r, 6↔x, 8↔i, 9↔j)
        const expectedCode = ['', 'm', 'n', 'p', 'q', 'r', 'x', undefined, 'i', 'j'][cand.stateIndex];
        expect(cand.stateCode, where).toBe(expectedCode);
        if (cand.state === 'ground') {
          // основное состояние — строка i=0 без суффикса и без s в recordId
          expect(cand.stateIndex, where).toBe(0);
          expect(cand.stateCode, where).toBe('');
          expect(cand.nuclideNotation, where).toBe(el.symbol + '-' + cand.massNumber);
          expect(cand.recordId.endsWith(' i=0'), where).toBe(true);
        } else {
          // изомер: возбуждённая строка (i>=1, s=m/n/p/q/r/x), обозначение с кодом
          expect(cand.stateIndex >= 1, where).toBe(true);
          expect(cand.nuclideNotation.endsWith(cand.stateCode), where).toBe(true);
          expect(cand.recordId.includes(' i=' + cand.stateIndex + ' s=' + cand.stateCode), where).toBe(true);
        }
        // recordId кандидата, provenance.recordId и recordId периода полураспада — одна строка источника
        expect(cand.provenance.recordId, where).toBe(cand.recordId);
        expect(cand.halfLife.provenance?.recordId, where).toBe(cand.recordId);
      }
    }
    expect(records).toBe(44);
  });

  it('Lr: 266Lr 22(14) h и приблизительный 262Lr ~4 h без неопределённости', () => {
    const c = expectKnownCandidates(buildElement(103));
    const cands = c.candidates ?? [];
    expect(cands).toHaveLength(2);
    const lr266 = cands.find((x) => x.massNumber === 266);
    const lr262 = cands.find((x) => x.massNumber === 262);
    if (!lr266 || !lr262) throw new Error('266Lr и 262Lr должны быть кандидатами');
    if (lr266.halfLife.status !== 'known' || lr262.halfLife.status !== 'known') {
      throw new Error('периоды полураспада Lr должны быть known');
    }
    expect(lr266.halfLife.quantity.value).toBe(22);
    expect(lr266.halfLife.quantity.unit).toBe('h');
    const u266 = lr266.halfLife.uncertainty;
    if (!u266 || u266.kind !== 'stddev') throw new Error('неопределённость 266Lr должна быть stddev');
    expect(u266.sigma).toBe(14);
    expect(lr262.halfLife.quantity.value).toBe(4);
    expect(lr262.halfLifeRawNotation).toBe('~4 h');
    expect(lr262.halfLife.uncertainty).toBeUndefined();
    expect(lr262.halfLife.provenance?.note ?? '').toContain('приблизительное');
  });

  it('Mt: три кандидата Mt-276m/Mt-277/Mt-278 с попарно перекрывающимися 1σ', () => {
    const c = expectKnownCandidates(buildElement(109));
    expect(c.completeness).toBe('incomplete');
    const cands = c.candidates ?? [];
    expect(cands).toHaveLength(3);
    expect(cands.map((x) => x.nuclideNotation).sort()).toEqual(['Mt-276m', 'Mt-277', 'Mt-278']);
    const mt276m = cands.find((x) => x.nuclideNotation === 'Mt-276m');
    if (!mt276m) throw new Error('Mt-276m должен быть кандидатом');
    expect(mt276m.stateNote ?? '', 'у 276Mt/276Mtm звёздочка Isom.Unc').toContain('звёздочка');
    const bounds = cands.map((x) => {
      if (x.halfLife.status !== 'known') throw new Error('период полураспада Mt должен быть known');
      const u = x.halfLife.uncertainty;
      const s = u && u.kind === 'stddev' ? u.sigma : 0;
      return { lo: x.halfLife.quantity.value - s, hi: x.halfLife.quantity.value + s };
    });
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        expect(bounds[i].lo <= bounds[j].hi && bounds[j].lo <= bounds[i].hi).toBe(true);
      }
    }
  });

  it('Lv: основное состояние Lv-293 и изомер Lv-293m — отдельные кандидаты', () => {
    const c = expectKnownCandidates(buildElement(116));
    const cands = c.candidates ?? [];
    expect(cands).toHaveLength(2);
    const ground = cands.find((x) => x.state === 'ground');
    const isomer = cands.find((x) => x.state === 'isomeric');
    if (!ground || !isomer) throw new Error('Lv-293 (ground) и Lv-293m (изомер) должны быть кандидатами');
    expect(ground.nuclideNotation).toBe('Lv-293');
    expect(isomer.nuclideNotation).toBe('Lv-293m');
    expect(ground.massNumber).toBe(293);
    expect(isomer.massNumber).toBe(293);
  });

  it('полнота: complete у 14 элементов (Z=43,61,84–89,93–98), incomplete у 20 (Z=99–118)', () => {
    const els = allElements();
    const known = els.filter((e) => e.representativeIsotopeCandidates.status === 'known');
    const completeZ = known
      .filter((e) => e.representativeIsotopeCandidates.completeness === 'complete')
      .map((e) => e.atomicNumber);
    const incompleteZ = known
      .filter((e) => e.representativeIsotopeCandidates.completeness === 'incomplete')
      .map((e) => e.atomicNumber);
    expect(completeZ).toEqual([43, 61, 84, 85, 86, 87, 88, 89, 93, 94, 95, 96, 97, 98]);
    expect(incompleteZ).toEqual(Array.from({ length: 20 }, (_, i) => 99 + i));
  });

  it('оценённые записи NUBASE (#) не включены: Rf — только 267Rf, оценки упомянуты в completenessNote', () => {
    for (const el of allElements()) {
      const c = el.representativeIsotopeCandidates;
      if (c.status !== 'known') continue;
      for (const cand of c.candidates ?? []) {
        expect(cand.halfLifeRawNotation.includes('#'), cand.nuclideNotation).toBe(false);
        expect(cand.recordId.includes('#'), cand.nuclideNotation).toBe(false);
      }
    }
    const rf = expectKnownCandidates(buildElement(104));
    expect((rf.candidates ?? []).map((x) => x.massNumber)).toEqual([267]);
    expect(rf.completenessNote ?? '').toContain('264Rf (1# ч)');
  });

  it('все кандидаты: Z владельца, целое массовое число, единицы времени, provenance nubase, experimental', () => {
    const TIME_UNITS = ['y', 'ky', 'My', 'yr', 'ka', 'Ma', 'day', 'h', 'min', 's', 'ms'];
    for (const el of allElements()) {
      const c = el.representativeIsotopeCandidates;
      if (c.status !== 'known') continue;
      for (const cand of c.candidates ?? []) {
        expect(cand.atomicNumber, cand.nuclideNotation).toBe(el.atomicNumber);
        expect(Number.isInteger(cand.massNumber) && cand.massNumber > 0, cand.nuclideNotation).toBe(true);
        expect(cand.state === 'ground' || cand.state === 'isomeric', cand.nuclideNotation).toBe(true);
        if (cand.halfLife.status !== 'known') {
          throw new Error(cand.nuclideNotation + ': период полураспада должен быть known');
        }
        expect(TIME_UNITS.includes(cand.halfLife.quantity.unit), cand.nuclideNotation).toBe(true);
        expect(cand.provenance.sourceId, cand.nuclideNotation).toBe('nubase');
        expect(cand.recordId.trim() !== '', cand.nuclideNotation).toBe(true);
        expect(cand.reason.trim() !== '', cand.nuclideNotation).toBe(true);
        expect(cand.halfLifeRawNotation.trim() !== '', cand.nuclideNotation).toBe(true);
        expect(cand.dataStatus, cand.nuclideNotation).toBe('experimental');
        expect(cand.halfLife.provenance?.recordId ?? '', cand.nuclideNotation).toContain('nubase2020');
      }
    }
  });

  it('девять элементов с несколькими кандидатами: неоднозначность не схлопнута', () => {
    const multi = allElements()
      .filter((e) => {
        const c = e.representativeIsotopeCandidates;
        return c.status === 'known' && (c.candidates ?? []).length > 1;
      })
      .map((e) => e.symbol);
    expect(multi).toEqual(['Tc', 'Lr', 'Sg', 'Bh', 'Mt', 'Cn', 'Nh', 'Mc', 'Lv']);
  });
});

describe('Stage 4.3.3 (данные): происхождение значений', () => {
  it('у H каждое свойство — собственный источник (IUPAC, CIAAW, номенклатура, категории)', () => {
    const h = buildElement(1);
    expect(h.nameEnglishProvenance.sourceId).toBe('iupac-pt');
    expect(h.nameRussianProvenance.sourceId).toBe('ru-element-nomenclature');
    expect(h.position.provenance.sourceId).toBe('iupac-pt');
    expect(h.category.provenance.sourceId).toBe('element-categories');
    const w = h.standardAtomicWeight;
    if (w.kind === 'interval') {
      expect(w.provenance.sourceId).toBe('ciaaw-saw');
    }
    expect(h.isotopicComposition.provenance?.sourceId).toBe('ciaaw-iso');
  });

  it('CIAAW provenance фиксирует область применимости (normal materials) и ограничения', () => {
    const h = buildElement(1);
    const saw = h.standardAtomicWeight.provenance;
    expect(saw.applicability ?? '').toContain('normal materials');
    expect(saw.applicability ?? '').toContain('НЕ универсальные');
    expect(saw.limitations ?? '').toContain('экзопланет');
    expect(saw.limitations ?? '').toContain('нуклеосинтеза');
    const iso = h.isotopicComposition.provenance;
    expect(iso?.applicability ?? '').toContain('normal materials');
    expect(iso?.applicability ?? '').toContain('представительные');
    expect(iso?.limitations ?? '').toContain('НЕ универсальные изотопные доли');
    expect(iso?.limitations ?? '').toContain('экзопланет');
  });

  it('все веса, изотопные записи и кандидаты несут recordId своего источника', () => {
    for (const el of allElements()) {
      const w = el.standardAtomicWeight;
      expect(w.provenance.recordId ?? '', 'Z=' + el.atomicNumber).toContain('ciaaw-saw-2024');
      const iso = el.isotopicComposition;
      if (iso.status === 'known') {
        for (const rec of iso.records ?? []) {
          expect(rec.abundance.provenance.recordId ?? '', 'Z=' + el.atomicNumber).toContain('ciaaw-iso-2024');
        }
      }
      const c = el.representativeIsotopeCandidates;
      if (c.status === 'known') {
        for (const cand of c.candidates ?? []) {
          expect(cand.provenance.recordId ?? '', cand.nuclideNotation).toContain('nubase2020');
        }
      }
    }
  });

  it('unknown-свойства честно неизвестны: 0 числовых known, 826 числовых unknown, 236 строковых unknown', () => {
    const cov = elementCatalogCoverage();
    expect(cov.numericKnown).toBe(0);
    expect(cov.numericUnknown).toBe(826);
    expect(cov.stringUnknown).toBe(236);
    for (const el of allElements()) {
      expect(el.firstIonizationEnergy.status, 'Z=' + el.atomicNumber).toBe('unknown');
      expect('quantity' in el.firstIonizationEnergy).toBe(false);
      expect(el.electronConfiguration.status, 'Z=' + el.atomicNumber).toBe('unknown');
      expect(el.electronConfiguration.value).toBeUndefined();
      expect(el.oxidationStates.status, 'Z=' + el.atomicNumber).toBe('unknown');
    }
  });

  it('оценка не выдаётся за измерение: все периоды полураспада known (не estimated), данные experimental', () => {
    for (const el of allElements()) {
      const c = el.representativeIsotopeCandidates;
      if (c.status !== 'known') continue;
      for (const cand of c.candidates ?? []) {
        expect(cand.halfLife.status, cand.nuclideNotation).toBe('known');
        expect(cand.dataStatus, cand.nuclideNotation).toBe('experimental');
      }
    }
  });
});

describe('Stage 4.3.3 (данные): элементные составы и вещества NASA CEA', () => {
  it('все символы elementCompositions существуют в каталоге; формулы не изменены', () => {
    const catalog = buildElementCatalog();
    const symbols = new Set<string>();
    for (const [id, comp] of Object.entries(elementCompositions)) {
      const report = checkElementCountsReference(catalog, comp.elements);
      expect(report.unknownSymbols, 'состав ' + id).toEqual([]);
      for (const s of Object.keys(comp.elements)) symbols.add(s);
    }
    expect([...symbols].sort()).toEqual(['C', 'H', 'N', 'O', 'S']);
    expect(elementCompositions['h2o']).toEqual({ formula: 'H2O', elements: { H: 2, O: 1 } });
    expect(elementCompositions['c2h6']).toEqual({ formula: 'C2H6', elements: { C: 2, H: 6 } });
    expect(elementCompositions['so2']).toEqual({ formula: 'SO2', elements: { S: 1, O: 2 } });
    expect(elementCompositions['he']).toEqual({ formula: 'He', elements: {} });
  });

  it('все 20 веществ NASA CEA ссылаются только на элементы каталога', () => {
    const catalog = buildElementCatalog();
    const thermo = buildThermodynamicCatalog();
    expect(THERMODYNAMIC_CATALOG_SPECIES_IDS).toHaveLength(20);
    for (const id of THERMODYNAMIC_CATALOG_SPECIES_IDS) {
      const sp = thermo.get(id);
      if (!sp) throw new Error('в термодинамическом каталоге нет вида ' + id);
      const report = checkElementCountsReference(catalog, sp.elements);
      expect(report.unknownSymbols, 'вид ' + id).toEqual([]);
    }
  });

  it('отсутствующий символ диагностируется как unknown', () => {
    const catalog = buildElementCatalog();
    const report = checkElementCountsReference(catalog, { H: 2, Xx: 1 });
    expect(report.knownSymbols).toEqual(['H']);
    expect(report.unknownSymbols).toEqual(['Xx']);
  });
});

describe('Stage 4.3.3 (данные): детерминированность', () => {
  it('два построения каталога возвращают одинаковые записи в одинаковом порядке', () => {
    const a = buildElementCatalog().list();
    const b = buildElementCatalog().list();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(JSON.stringify(a[i]), 'позиция ' + i).toBe(JSON.stringify(b[i]));
    }
    expect(a.map((e) => e.atomicNumber)).toEqual(b.map((e) => e.atomicNumber));
  });

  it('buildElement и функции покрытия стабильны при повторных вызовах', () => {
    expect(JSON.stringify(buildElement(43))).toBe(JSON.stringify(buildElement(43)));
    expect(elementCatalogCoverage()).toEqual(elementCatalogCoverage());
    expect(isotopeCandidateCoverage()).toEqual(isotopeCandidateCoverage());
  });
});
