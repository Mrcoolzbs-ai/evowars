// ============================================
// STAGE 4.3.2 (КОРРЕКТИРУЮЩАЯ РЕВИЗИЯ) - Тесты типизированного
// разделения математических форм NASA-полиномов
// ============================================
//
// Проверяются требования корректирующей ревизии Stage 4.3.2:
// - математическая форма коэффициентов сегмента - типизированное
//   поле form (nasa7_classic | nasa_cea), НЕ текстовый note и НЕ
//   provenance.rawInput: отсутствие и неизвестность form отклоняются;
// - реестр NASA_POLYNOMIAL_FORMS не содержит NASA-9 (другая
//   параметризация, не смешивается ни с одной из форм);
// - базисы NASA_POLYNOMIAL_EXPONENTS математически различают формы:
//   классическая NASA-7/CHEMKIN - коэффициенты Cp при T^0..T^4
//   (a0..a4) + интегральные константы a5/a6 в массиве coefficients;
//   NASA Glenn CEA - семь коэффициентов Cp при T^-2..T^4 + константы
//   записи a8/a9 в отдельном поле integralConstants;
// - структура обязана соответствовать форме: nasa7_classic не
//   принимает integralConstants, nasa_cea требует их (конечные числа);
// - все сегменты одного полинома - одна форма (смешение отклоняется);
// - сегмент реального каталога NASA CEA нельзя молча
//   интерпретировать в другой форме.
//
// Вычислитель полиномов в этой ревизии НЕ тестируется (не реализуется).

import { describe, it, expect } from 'vitest';
import {
  validateThermodynamicProperties,
  NASA_POLYNOMIAL_FORMS,
  NASA_POLYNOMIAL_EXPONENTS
} from '../Core/thermodynamics';
import type {
  Nasa7Segment,
  NasaCeaSegment,
  NasaPolynomialSegment,
  ThermodynamicProperties,
  ThermoDataProvenance
} from '../Core/thermodynamics';
import { knownValue, unknownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { buildThermodynamicCatalog } from '../Data/thermodynamicCatalog';

const TEST_PROVENANCE: ThermoDataProvenance = {
  origin: 'reference_range',
  sourceName: 'тестовый источник (модель)',
  datasetId: 'test/thermo',
  datasetVersion: 'test-1',
  recordId: 'Test'
};

const SEGMENT_PROVENANCE: ThermoDataProvenance = {
  origin: 'numerical_approximation',
  sourceName: 'тестовый источник (модель)',
  datasetId: 'test/thermo',
  datasetVersion: 'test-1',
  recordId: 'Test',
  method: 'тестовая аппроксимация (модель)'
};

// a0..a4 (Cp при T^0..T^4) + a5/a6 (интегральные константы) - CHEMKIN-форма.
const CLASSIC_COEFFICIENTS = [3.5, -1.2e-3, 5.0e-6, -7.0e-9, 2.0e-12, -143.5, 23.7];

// a1..a7 записи CEA (Cp при T^-2..T^4).
const CEA_COEFFICIENTS = [1.0e5, -2.0e2, 4.1, 1.2e-3, -3.4e-7, 5.0e-11, -2.0e-15];

function classicSegment(): Nasa7Segment {
  return {
    form: 'nasa7_classic',
    quantity: 'Cp_over_R',
    rangeK: { min: quantity(300, 'K'), max: quantity(3500, 'K') },
    coefficients: [...CLASSIC_COEFFICIENTS],
    derivation: { kind: 'published', provenance: SEGMENT_PROVENANCE }
  };
}

function ceaSegment(): NasaCeaSegment {
  return {
    form: 'nasa_cea',
    quantity: 'Cp_over_R',
    rangeK: { min: quantity(300, 'K'), max: quantity(3500, 'K') },
    coefficients: [...CEA_COEFFICIENTS],
    integralConstants: { enthalpyConstantOverR: -104.5, entropyConstantOverR: 4.2 },
    derivation: { kind: 'published', provenance: SEGMENT_PROVENANCE }
  };
}

function makeThermo(segments: NasaPolynomialSegment[]): ThermodynamicProperties {
  return {
    standardFormationEnthalpy: knownValue(quantity(0, 'J_mol'), { provenance: TEST_PROVENANCE }),
    standardFormationGibbsEnergy: unknownValue('тест: значение не предоставлено'),
    standardEntropy: unknownValue('тест: значение не предоставлено'),
    heatCapacity: { status: 'known', nasa7: { segments } },
    referenceState: {
      temperature: quantity(298.15, 'K'),
      phase: 'gas',
      standardState: 'тестовое стандартное состояние'
    }
  };
}

function issuesOf(segments: NasaPolynomialSegment[]): string[] {
  return validateThermodynamicProperties(makeThermo(segments), { speciesId: 'test', expectedPhase: 'gas' });
}

describe('Stage 4.3.2 (корректирующая ревизия): типизированные формы NASA-полиномов', () => {
  it('реестр форм содержит ровно nasa7_classic и nasa_cea; NASA-9 не входит', () => {
    expect(NASA_POLYNOMIAL_FORMS).toEqual(['nasa7_classic', 'nasa_cea']);
    expect(NASA_POLYNOMIAL_FORMS).not.toContain('nasa9');
  });

  it('базисы форм математически различны: классика T^0..T^4 (5), CEA T^-2..T^4 (7)', () => {
    expect(NASA_POLYNOMIAL_EXPONENTS.nasa7_classic).toEqual([0, 1, 2, 3, 4]);
    expect(NASA_POLYNOMIAL_EXPONENTS.nasa_cea).toEqual([-2, -1, 0, 1, 2, 3, 4]);
    expect(NASA_POLYNOMIAL_EXPONENTS.nasa7_classic).not.toEqual(NASA_POLYNOMIAL_EXPONENTS.nasa_cea);
    expect(NASA_POLYNOMIAL_EXPONENTS.nasa7_classic).toHaveLength(5);
    expect(NASA_POLYNOMIAL_EXPONENTS.nasa_cea).toHaveLength(7);
  });

  it('валидный классический сегмент (a0-a4 Cp + a5/a6 в coefficients) проходит валидацию', () => {
    expect(issuesOf([classicSegment()])).toEqual([]);
  });

  it('валидный CEA-сегмент (a1-a7 Cp + integralConstants a8/a9) проходит валидацию', () => {
    expect(issuesOf([ceaSegment()])).toEqual([]);
  });

  it('классическая форма НЕ принимает интегральные константы записи CEA', () => {
    const bad = {
      ...classicSegment(),
      integralConstants: { enthalpyConstantOverR: -104.5, entropyConstantOverR: 4.2 }
    } as unknown as Nasa7Segment;
    const errors = issuesOf([bad]);
    expect(errors.some((e) => e.includes('integralConstants'))).toBe(true);
    expect(errors.some((e) => e.includes('nasa7_classic'))).toBe(true);
  });

  it('форма nasa_cea требует integralConstants: отсутствие отклоняется', () => {
    const bad = { ...ceaSegment() } as Record<string, unknown>;
    delete bad.integralConstants;
    const errors = issuesOf([bad as unknown as NasaCeaSegment]);
    expect(errors.some((e) => e.includes('integralConstants'))).toBe(true);
    expect(errors.some((e) => e.includes('nasa_cea'))).toBe(true);
  });

  it('нечисловые интегральные константы CEA отклоняются', () => {
    const bad = {
      ...ceaSegment(),
      integralConstants: { enthalpyConstantOverR: Number.NaN, entropyConstantOverR: 4.2 }
    };
    const errors = issuesOf([bad]);
    expect(errors.some((e) => e.includes('enthalpyConstantOverR'))).toBe(true);
    expect(errors.some((e) => e.includes('конечным числом'))).toBe(true);
  });

  it('отсутствие поля form отклоняется: форма не выводится из note или provenance.rawInput', () => {
    const bad = { ...ceaSegment() } as Record<string, unknown>;
    delete bad.form;
    const errors = issuesOf([bad as unknown as NasaCeaSegment]);
    expect(errors.some((e) => e.includes('типизированную математическую форму'))).toBe(true);
    expect(errors.some((e) => e.includes('не выводится из note или provenance.rawInput'))).toBe(true);
  });

  it('неизвестные формы отклоняются, NASA-9 назван отдельной параметризацией', () => {
    for (const form of ['nasa9', 'chemkin', 'shomate']) {
      const bad = { ...ceaSegment(), form } as unknown as NasaCeaSegment;
      const errors = issuesOf([bad]);
      expect(errors.some((e) => e.includes('неизвестная форма полинома')), 'форма ' + form).toBe(true);
    }
    const nasa9Errors = issuesOf([{ ...ceaSegment(), form: 'nasa9' } as unknown as NasaCeaSegment]);
    expect(nasa9Errors.some((e) => e.includes('NASA-9'))).toBe(true);
  });

  it('смешение форм в одном полиноме отклоняется', () => {
    const errors = issuesOf([classicSegment(), ceaSegment()]);
    expect(errors.some((e) => e.includes('одну математическую форму'))).toBe(true);
  });

  it('в обеих формах требуется ровно семь конечных коэффициентов', () => {
    const short = {
      ...classicSegment(),
      coefficients: CLASSIC_COEFFICIENTS.slice(0, 6)
    } as unknown as Nasa7Segment;
    expect(issuesOf([short]).some((e) => e.includes('ровно семь коэффициентов'))).toBe(true);
    const nonFinite = {
      ...classicSegment(),
      coefficients: [3.5, Number.NaN, 5.0e-6, -7.0e-9, 2.0e-12, -143.5, 23.7]
    } as unknown as Nasa7Segment;
    expect(issuesOf([nonFinite]).some((e) => e.includes('конечными числами'))).toBe(true);
  });

  it('CEA-сегмент реального каталога нельзя молча интерпретировать как классический (и наоборот)', () => {
    const catalog = buildThermodynamicCatalog();
    const h2o = catalog.get('h2o')!.thermodynamics!.heatCapacity.nasa7!.segments[0];
    expect(h2o.form).toBe('nasa_cea');
    // CEA-сегмент с его integralConstants, помеченный классической формой, отклоняется
    const mislabeledAsClassic = { ...h2o, form: 'nasa7_classic' } as unknown as Nasa7Segment;
    expect(issuesOf([mislabeledAsClassic]).some((e) => e.includes('integralConstants'))).toBe(true);
    // классический сегмент, помеченный nasa_cea, отклоняется: нет integralConstants
    const mislabeledAsCea = { ...classicSegment(), form: 'nasa_cea' } as unknown as NasaCeaSegment;
    expect(issuesOf([mislabeledAsCea]).some((e) => e.includes('nasa_cea требует интегральные константы'))).toBe(true);
  });
});
