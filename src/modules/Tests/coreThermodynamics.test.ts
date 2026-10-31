// ============================================
// STAGE 4.3.1 - Тесты термодинамической модели вида:
// происхождение значений, reference state, Cp-таблицы, NASA-7,
// интеграция с каталогом видов
// ============================================
//
// Корректирующая ревизия Stage 4.3.1 (validator hardening):
// - reference state обязателен при любых числовых данных, включая
//   табличные Cp(T) и NASA-7 (не только скалярные ΔfH°/ΔfG°/S°);
// - безопасная runtime-валидация повреждённых JSON-подобных данных:
//   диагностики вместо исключений (null-поля, недостроенные
//   величины, битые сегменты и provenance);
// - per-value provenance отдельных Cp-точек (ThermoDataProvenance).
//
// Заключительная проверка валидатора 4.3.1:
// - повреждённая bounded-неопределённость (без direction) у
//   known/estimated-значений отклоняется;
// - величина с несовместимой размерностью вызывает диагностику и НЕ
//   используется в дальнейших проверках (порядок температур,
//   положительность, пересечение диапазонов, контрольные точки).
//
// Все значения в фикстурах — СИНТЕТИЧЕСКИЕ тестовые числа с
// фиктивными источниками («тестовый источник (фикция для тестов)»):
// это не реальные термохимические данные. Реальный импорт значений
// (NIST WebBook SRD 69 со сверкой с ATcT TN 1.228) — подэтап 4.3.2.

import { describe, it, expect } from 'vitest';
import { knownValue, estimatedValue, unknownValue, convertScientificValueUnit, ScientificValueError } from '../Core/scientificValue';
import type { ScientificValue } from '../Core/scientificValue';
import { quantity, convert, toSI, sameDimension, dimensionOf, QuantityError } from '../Core/physicalQuantity';
import type { PhysicalQuantity } from '../Core/physicalQuantity';
import type { ScientificSpecies } from '../Core/species';
import { createSpeciesCatalog, validateSpecies, SpeciesError } from '../Core/species';
import { buildSpeciesCatalogFromLegacy } from '../Core/adapters';
import { THERMO_VALUE_ORIGINS, validateThermodynamicProperties } from '../Core/thermodynamics';
import type {
  ThermodynamicProperties,
  ThermoDataProvenance,
  ThermoValueOrigin,
  Nasa7Segment,
  Nasa7Polynomial,
  CpTabulatedData,
  CpTablePoint
} from '../Core/thermodynamics';

// ============================================
// ФИКСТУРЫ (синтетические значения, не реальные данные)
// ============================================

function testProvenance(origin: ThermoValueOrigin, overrides: Partial<ThermoDataProvenance> = {}): ThermoDataProvenance {
  return { origin, sourceName: 'тестовый источник (фикция для тестов)', ...overrides };
}

function testCpTable(): CpTabulatedData {
  return {
    points: [
      { temperature: quantity(200, 'K'), cp: quantity(29.1, 'J_mol_K') },
      { temperature: quantity(298.15, 'K'), cp: quantity(33.6, 'J_mol_K') },
      { temperature: quantity(500, 'K'), cp: quantity(38.5, 'J_mol_K') }
    ],
    provenance: testProvenance('reference_range', { recordId: 'тест-таблица-1' })
  };
}

function validKnownThermo(): ThermodynamicProperties {
  return {
    standardFormationEnthalpy: knownValue(quantity(-241800, 'J_mol'), {
      provenance: testProvenance('experimental'),
      uncertainty: { kind: 'stddev', sigma: 40 }
    }),
    standardFormationGibbsEnergy: knownValue(quantity(-228600, 'J_mol'), {
      provenance: testProvenance('experimental')
    }),
    standardEntropy: knownValue(quantity(188.8, 'J_mol_K'), {
      provenance: testProvenance('experimental')
    }),
    heatCapacity: { status: 'known', tabulated: testCpTable() },
    referenceState: {
      temperature: quantity(298.15, 'K'),
      phase: 'gas',
      standardState: 'идеальный газ, 1 бар (объявлено тестовым источником)',
      conditions: 'тестовая фикция: значения синтетические, не реальные данные'
    },
    provenance: { sourceName: 'тестовый блок термодинамики (фикция)' },
    note: 'синтетическая тестовая запись, не реальное термохимическое значение'
  };
}

function unknownThermo(): ThermodynamicProperties {
  return {
    standardFormationEnthalpy: unknownValue('не предоставлено'),
    standardFormationGibbsEnergy: unknownValue('не предоставлено'),
    standardEntropy: unknownValue('не предоставлено'),
    heatCapacity: { status: 'unknown' }
  };
}

function nasa7Segment(minK: number, maxK: number): Nasa7Segment {
  return {
    quantity: 'Cp_over_R',
    rangeK: { min: quantity(minK, 'K'), max: quantity(maxK, 'K') },
    coefficients: [3.5, 1.2e-3, -5e-7, 2e-10, -4e-14, -1000, 3.2],
    derivation: {
      kind: 'published',
      provenance: testProvenance('reference_range', { sourceName: 'тестовый механизм (фикция)' })
    }
  };
}

function nasa7FittedSegment(): Nasa7Segment {
  return {
    quantity: 'Cp_over_R',
    rangeK: { min: quantity(200, 'K'), max: quantity(1000, 'K') },
    coefficients: [3.4, 1.3e-3, -4.8e-7, 1.9e-10, -3.9e-14, -990, 3.1],
    derivation: {
      kind: 'fitted',
      provenance: testProvenance('experimental'),
      method: 'метод наименьших квадратов по исходной таблице (тест)',
      checkPoints: [
        { temperature: quantity(300, 'K'), sourceCpOverR: 3.51, absoluteError: 0.01 },
        { temperature: quantity(800, 'K'), sourceCpOverR: 4.02 }
      ],
      approximationError: { maxAbsolute: 0.02, meanAbsolute: 0.01 }
    }
  };
}

let speciesCounter = 0;

function makeThermoSpecies(thermo: ThermodynamicProperties | undefined, overrides: Partial<ScientificSpecies> = {}): ScientificSpecies {
  speciesCounter += 1;
  const base: ScientificSpecies = {
    id: `test_species_${speciesCounter}`,
    formula: 'Xy2',
    name: 'тестовый вид (фикция)',
    elements: { Xy: 2 },
    charge: 0,
    phase: 'gas',
    molarMassKgMol: 0.044,
    molarMassStatus: 'known',
    dataStatus: 'known',
    thermodynamics: thermo
  };
  return { ...base, ...overrides };
}

// ============================================
// ПРОИСХОЖДЕНИЕ И ВАЛИДНАЯ ЗАПИСЬ
// ============================================

describe('Stage 4.3.1 Thermodynamics: происхождение значений', () => {
  it('реестр origin содержит восемь типизированных видов', () => {
    expect(THERMO_VALUE_ORIGINS).toHaveLength(8);
    expect(THERMO_VALUE_ORIGINS).toContain('observed');
    expect(THERMO_VALUE_ORIGINS).toContain('experimental');
    expect(THERMO_VALUE_ORIGINS).toContain('reference_range');
    expect(THERMO_VALUE_ORIGINS).toContain('derived_computed');
    expect(THERMO_VALUE_ORIGINS).toContain('numerical_approximation');
    expect(THERMO_VALUE_ORIGINS).toContain('theoretical_estimate');
    expect(THERMO_VALUE_ORIGINS).toContain('game_assumption');
    expect(THERMO_VALUE_ORIGINS).toContain('unknown');
  });

  it('валидная запись с известными значениями проходит без ошибок', () => {
    expect(validateThermodynamicProperties(validKnownThermo())).toEqual([]);
  });

  it('нечувствителен к не-объекту на входе', () => {
    expect(validateThermodynamicProperties(null as unknown as ThermodynamicProperties)).toEqual([
      'термодинамика: блок должен быть объектом'
    ]);
  });

  it('запись с оценочными значениями и методом проходит', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationEnthalpy = estimatedValue(quantity(-250000, 'J_mol'), 'теоретическая оценка тестовой моделью', {
      provenance: testProvenance('theoretical_estimate', { method: 'теоретическая оценка тестовой корреляцией' })
    });
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
  });

  it('unknown-блок без числовой подстановки проходит и не требует reference state', () => {
    const errors = validateThermodynamicProperties(unknownThermo());
    expect(errors).toEqual([]);
    // числового содержания нет ни в одном поле
    const thermo = unknownThermo();
    expect(thermo.standardFormationEnthalpy.status).toBe('unknown');
    expect(thermo.standardFormationGibbsEnergy.status).toBe('unknown');
    expect(thermo.standardEntropy.status).toBe('unknown');
    expect(thermo.heatCapacity.status).toBe('unknown');
  });

  it('known без собственного provenance — ошибка', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationEnthalpy = knownValue(quantity(-241800, 'J_mol'));
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('собственный provenance'))).toBe(true);
  });

  it('числовое значение с origin unknown — ошибка', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationGibbsEnergy = knownValue(quantity(-228600, 'J_mol'), {
      provenance: testProvenance('unknown')
    });
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.some((e) => e.includes('не может иметь происхождение unknown'))).toBe(true);
  });

  it('provenance без идентификации источника — ошибка', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationGibbsEnergy = knownValue(quantity(-228600, 'J_mol'), {
      provenance: { origin: 'experimental' } as ThermoDataProvenance
    });
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.some((e) => e.includes('не идентифицирует источник'))).toBe(true);
  });

  it('origin derived_computed требует метода; с методом — проходит', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationEnthalpy = knownValue(quantity(-241800, 'J_mol'), {
      provenance: { origin: 'derived_computed', sourceName: 'тест', datasetId: 'тест-набор' } as ThermoDataProvenance
    });
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('требует непустой метод'))
    ).toBe(true);
    thermo.standardFormationEnthalpy = knownValue(quantity(-241800, 'J_mol'), {
      provenance: {
        origin: 'derived_computed',
        sourceName: 'тест',
        datasetId: 'тест-набор',
        method: 'расчёт по тестовой корреляции'
      } as ThermoDataProvenance
    });
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
  });

  it('unknown, несущий quantity (runtime-нарушение формы) — ошибка', () => {
    const thermo = validKnownThermo();
    thermo.standardEntropy = {
      status: 'unknown',
      quantity: quantity(188.8, 'J_mol_K')
    } as unknown as ScientificValue;
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.some((e) => e.includes('не может нести числовое значение'))).toBe(true);
  });

  it('отсутствие uncertainty допустимо (это «неизвестна», не «ноль»); некорректная не создаётся и ловится валидатором', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationGibbsEnergy = knownValue(quantity(-228600, 'J_mol'), {
      provenance: testProvenance('experimental')
    });
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
    // конструктор не создаёт значение с некорректной неопределённостью
    expect(() =>
      knownValue(quantity(-228600, 'J_mol'), {
        provenance: testProvenance('experimental'),
        uncertainty: { kind: 'interval', lower: 10, upper: -10 }
      })
    ).toThrow(ScientificValueError);
    // runtime-нарушение (данные из JSON): валидатор обязан поймать
    const valid = knownValue(quantity(-228600, 'J_mol'), { provenance: testProvenance('experimental') });
    thermo.standardFormationGibbsEnergy = {
      ...valid,
      uncertainty: { kind: 'interval', lower: 10, upper: -10 }
    } as ScientificValue;
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('неопределённость'))
    ).toBe(true);
  });
});

// ============================================
// ЕДИНИЦЫ
// ============================================

describe('Stage 4.3.1 Thermodynamics: единицы J_mol / kJ_mol / J_mol_K', () => {
  it('энтальпия в J (не J/mol) — ошибка размерности', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationEnthalpy = knownValue(quantity(-241800, 'J'), {
      provenance: testProvenance('experimental')
    });
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.some((e) => e.includes('размерность'))).toBe(true);
  });

  it('энтропия в J_mol (не J/(mol·K)) — ошибка размерности', () => {
    const thermo = validKnownThermo();
    thermo.standardEntropy = knownValue(quantity(188.8, 'J_mol'), {
      provenance: testProvenance('experimental')
    });
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.some((e) => e.includes('размерность'))).toBe(true);
  });

  it('конверсия J/mol ↔ kJ/mol точна и обратима', () => {
    const dh = quantity(-241826, 'J_mol');
    const inKJ = convert(dh, 'kJ_mol');
    expect(inKJ.value).toBeCloseTo(-241.826, 12);
    expect(inKJ.unit).toBe('kJ_mol');
    const back = convert(inKJ, 'J_mol');
    expect(back.value).toBeCloseTo(-241826, 9);
    expect(toSI(quantity(1, 'kJ_mol'))).toBe(1000);
    expect(toSI(quantity(1, 'J_mol'))).toBe(1);
  });

  it('J_mol и J_mol_K несовместимы; J_mol не равен J_kg по размерности', () => {
    expect(() => convert(quantity(1, 'J_mol'), 'J_mol_K')).toThrow(QuantityError);
    expect(sameDimension(dimensionOf(quantity(1, 'J_mol')), dimensionOf(quantity(1, 'kJ_mol')))).toBe(true);
    expect(sameDimension(dimensionOf(quantity(1, 'J_mol')), dimensionOf(quantity(1, 'J_kg')))).toBe(false);
    expect(sameDimension(dimensionOf(quantity(1, 'J_mol_K')), dimensionOf(quantity(1, 'J_mol')))).toBe(false);
  });

  it('convertScientificValueUnit сохраняет статус и origin provenance', () => {
    const v = knownValue(quantity(-241826, 'J_mol'), { provenance: testProvenance('experimental') });
    const inKJ = convertScientificValueUnit(v, 'kJ_mol');
    expect(inKJ.status).toBe('known');
    if (inKJ.status !== 'known') throw new Error('knownValue должен вернуть known');
    expect(inKJ.quantity.value).toBeCloseTo(-241.826, 12);
    expect(inKJ.quantity.unit).toBe('kJ_mol');
    expect((inKJ.provenance as Partial<ThermoDataProvenance> | undefined)?.origin).toBe('experimental');
    expect(() => convertScientificValueUnit(v, 'J_mol_K')).toThrow(QuantityError);
  });
});

// ============================================
// REFERENCE STATE
// ============================================

describe('Stage 4.3.1 Thermodynamics: reference state', () => {
  it('числовое значение без reference state — ошибка', () => {
    const thermo = validKnownThermo();
    delete thermo.referenceState;
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.some((e) => e.includes('reference state обязателен'))).toBe(true);
  });

  it('пустое описание стандартного состояния — ошибка', () => {
    const thermo = validKnownThermo();
    const ref = thermo.referenceState;
    if (ref === undefined) throw new Error('фикстура должна содержать reference state');
    thermo.referenceState = { ...ref, standardState: '   ' };
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.some((e) => e.includes('стандартного состояния'))).toBe(true);
  });

  it('температура не в кельвинах и отрицательная температура — ошибки', () => {
    const thermo = validKnownThermo();
    const ref = thermo.referenceState;
    if (ref === undefined) throw new Error('фикстура должна содержать reference state');
    thermo.referenceState = { ...ref, temperature: quantity(101325, 'Pa') };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('температура'))
    ).toBe(true);
    thermo.referenceState = { ...ref, temperature: quantity(-5, 'K') };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('положительной'))
    ).toBe(true);
  });

  it('фаза reference state обязана совпадать с фазой записи (вид + фаза)', () => {
    const thermo = validKnownThermo();
    const ref = thermo.referenceState;
    if (ref === undefined) throw new Error('фикстура должна содержать reference state');
    thermo.referenceState = { ...ref, phase: 'liquid' };
    const species = makeThermoSpecies(thermo);
    const errors = validateSpecies(species);
    expect(errors.some((e) => e.startsWith('термодинамика:'))).toBe(true);
    expect(errors.some((e) => e.includes('не совпадает с фазой записи'))).toBe(true);
    // прямая валидация с expectedPhase тоже ловит несоответствие
    const direct = validateThermodynamicProperties(thermo, { speciesId: 'тест', expectedPhase: 'gas' });
    expect(direct.some((e) => e.includes('не совпадает с фазой записи'))).toBe(true);
  });
});

// ============================================
// CP-ТАБЛИЦЫ
// ============================================

describe('Stage 4.3.1 Thermodynamics: исходные Cp-таблицы', () => {
  it('пустая таблица — ошибка', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = {
      status: 'known',
      tabulated: { ...testCpTable(), points: [] }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('хотя бы одна точка'))
    ).toBe(true);
  });

  it('точки не по возрастанию и дубликат температуры — ошибки', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = {
      status: 'known',
      tabulated: {
        points: [
          { temperature: quantity(500, 'K'), cp: quantity(38.5, 'J_mol_K') },
          { temperature: quantity(300, 'K'), cp: quantity(33.6, 'J_mol_K') },
          { temperature: quantity(300, 'K'), cp: quantity(33.6, 'J_mol_K') }
        ],
        provenance: testProvenance('experimental')
      }
    };
    const errors = validateThermodynamicProperties(thermo);
    expect(errors.some((e) => e.includes('строго по возрастанию'))).toBe(true);
    expect(errors.some((e) => e.includes('дубликат температуры'))).toBe(true);
  });

  it('точка Cp в посторонней единице — ошибка', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = {
      status: 'known',
      tabulated: {
        points: [{ temperature: quantity(300, 'K'), cp: quantity(33.6, 'J_mol') }],
        provenance: testProvenance('experimental')
      }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('размерность'))
    ).toBe(true);
  });

  it('таблица без provenance — ошибка', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = {
      status: 'known',
      tabulated: {
        points: [{ temperature: quantity(300, 'K'), cp: quantity(33.6, 'J_mol_K') }]
      } as unknown as CpTabulatedData
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('собственный provenance'))
    ).toBe(true);
  });

  it('статус known без данных и unknown с данными — ошибки', () => {
    const thermoKnown = validKnownThermo();
    thermoKnown.heatCapacity = { status: 'known' };
    expect(
      validateThermodynamicProperties(thermoKnown).some((e) =>
        e.includes('требует исходной таблицы Cp(T) и/или NASA-7')
      )
    ).toBe(true);
    const thermoUnknown = validKnownThermo();
    thermoUnknown.heatCapacity = { status: 'unknown', tabulated: testCpTable() };
    expect(
      validateThermodynamicProperties(thermoUnknown).some((e) =>
        e.includes('не предоставляются')
      )
    ).toBe(true);
  });
});

// ============================================
// NASA-7
// ============================================

describe('Stage 4.3.1 Thermodynamics: NASA-7 параметризация', () => {
  it('published-сегмент без исходной таблицы проходит (коэффициенты — первичные данные)', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [nasa7Segment(200, 1000)] } };
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
  });

  it('fitted-сегмент без исходной Cp-таблицы — ошибка; с таблицей — проходит', () => {
    const withoutTable = validKnownThermo();
    withoutTable.heatCapacity = { status: 'known', nasa7: { segments: [nasa7FittedSegment()] } };
    expect(
      validateThermodynamicProperties(withoutTable).some((e) =>
        e.includes('fitted-полином заявлен, но исходные табличные')
      )
    ).toBe(true);
    const withTable = validKnownThermo();
    withTable.heatCapacity = {
      status: 'known',
      tabulated: testCpTable(),
      nasa7: { segments: [nasa7FittedSegment()] }
    };
    expect(validateThermodynamicProperties(withTable)).toEqual([]);
  });

  it('не семь коэффициентов и NaN-коэффициент — ошибки', () => {
    const thermo = validKnownThermo();
    const six = nasa7Segment(200, 1000);
    six.coefficients = [1, 2, 3, 4, 5, 6];
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [six] } };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('ровно семь'))
    ).toBe(true);
    const nan = nasa7Segment(200, 1000);
    nan.coefficients = [1, 2, 3, 4, 5, 6, Number.NaN];
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [nan] } };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('конечными'))
    ).toBe(true);
  });

  it('пересечение диапазонов и неупорядоченные сегменты — ошибки; стык проходит', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = {
      status: 'known',
      nasa7: { segments: [nasa7Segment(200, 1000), nasa7Segment(500, 1500)] }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('пересекается'))
    ).toBe(true);
    thermo.heatCapacity = {
      status: 'known',
      nasa7: { segments: [nasa7Segment(500, 1500), nasa7Segment(200, 1000)] }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('упорядочены'))
    ).toBe(true);
    // общая граница-стык допустима
    thermo.heatCapacity = {
      status: 'known',
      nasa7: { segments: [nasa7Segment(200, 1000), nasa7Segment(1000, 2000)] }
    };
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
  });

  it('fitted без метода и без ошибки аппроксимации — ошибки', () => {
    const thermo = validKnownThermo();
    const noMethod = nasa7FittedSegment();
    noMethod.derivation.method = undefined;
    thermo.heatCapacity = {
      status: 'known',
      tabulated: testCpTable(),
      nasa7: { segments: [noMethod] }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('метод аппроксимации'))
    ).toBe(true);
    const noError = nasa7FittedSegment();
    noError.derivation.approximationError = undefined;
    thermo.heatCapacity = {
      status: 'known',
      tabulated: testCpTable(),
      nasa7: { segments: [noError] }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('ошибку аппроксимации'))
    ).toBe(true);
    const meanAboveMax = nasa7FittedSegment();
    if (meanAboveMax.derivation.approximationError === undefined) {
      throw new Error('фикстура должна содержать approximationError');
    }
    meanAboveMax.derivation.approximationError = { maxAbsolute: 0.01, meanAbsolute: 0.05 };
    thermo.heatCapacity = {
      status: 'known',
      tabulated: testCpTable(),
      nasa7: { segments: [meanAboveMax] }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('не может превышать'))
    ).toBe(true);
  });

  it('контрольная точка вне диапазона сегмента — ошибка', () => {
    const thermo = validKnownThermo();
    const segment = nasa7FittedSegment();
    segment.derivation.checkPoints = [
      { temperature: quantity(1500, 'K'), sourceCpOverR: 4.5 }
    ];
    thermo.heatCapacity = {
      status: 'known',
      tabulated: testCpTable(),
      nasa7: { segments: [segment] }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('вне диапазона сегмента'))
    ).toBe(true);
  });
});

// ============================================
// ИНТЕГРАЦИЯ С КАТАЛОГОМ ВИДОВ
// ============================================

describe('Stage 4.3.1 Thermodynamics: интеграция с каталогом видов', () => {
  it('вид с корректной термодинамикой регистрируется и хранит блок', () => {
    const catalog = createSpeciesCatalog();
    const species = makeThermoSpecies(validKnownThermo());
    expect(validateSpecies(species)).toEqual([]);
    catalog.register(species);
    const stored = catalog.get(species.id);
    if (stored === null) throw new Error('вид не найден после регистрации');
    expect(stored.thermodynamics?.standardFormationEnthalpy.status).toBe('known');
    expect(catalog.size()).toBe(1);
  });

  it('вид с некорректной термодинамикой не регистрируется (SpeciesError)', () => {
    const catalog = createSpeciesCatalog();
    const thermo = validKnownThermo();
    thermo.standardEntropy = knownValue(quantity(188.8, 'J_mol'), {
      provenance: testProvenance('experimental')
    });
    const species = makeThermoSpecies(thermo);
    expect(() => catalog.register(species)).toThrow(SpeciesError);
    try {
      catalog.register(species);
      expect.unreachable('регистрация должна была упасть');
    } catch (e) {
      const err = e as SpeciesError;
      expect(err.code).toBe('invalid_species');
      expect(err.message).toContain('термодинамика');
    }
    expect(catalog.size()).toBe(0);
  });

  it('legacy-адаптер строит записи без термодинамики: отсутствие = не предоставлены, без fallback', () => {
    const catalog = buildSpeciesCatalogFromLegacy(
      [{ id: 'h2o_test', formula: 'H2O', name: 'вода', molarMass: 18.015, aggregateStates: ['gas'] }],
      { h2o_test: { formula: 'H2O', elements: { H: 2, O: 1 } } }
    );
    expect(catalog.size()).toBe(1);
    const species = catalog.get('h2o_test');
    if (species === null) throw new Error('легаси-вид не найден');
    // отсутствие thermodynamics — не ошибка и НЕ нули: свойства не предоставлены
    expect(species.thermodynamics).toBeUndefined();
    expect(validateSpecies(species)).toEqual([]);
    // никакого молчаливого fallback на качественные описания газов нет
    expect(species.thermodynamics).toBeUndefined();
  });

  it('записи каталога без термодинамики совместимы со старыми операциями', () => {
    const catalog = createSpeciesCatalog();
    const species = makeThermoSpecies(undefined);
    catalog.register(species);
    const stored = catalog.get(species.id);
    if (stored === null) throw new Error('вид не найден');
    expect(validateSpecies(stored)).toEqual([]);
    expect(stored.thermodynamics).toBeUndefined();
    expect(catalog.has(species.id)).toBe(true);
  });
});

// ============================================
// ДЕТЕРМИНИРОВАННОСТЬ И ЧИСТОТА
// ============================================

describe('Stage 4.3.1 Thermodynamics: детерминированность и отсутствие побочных эффектов', () => {
  it('повторная валидация той же записи даёт тот же список ошибок', () => {
    const thermo = validKnownThermo();
    thermo.standardEntropy = knownValue(quantity(188.8, 'J_mol'), {
      provenance: testProvenance('experimental')
    });
    const first = validateThermodynamicProperties(thermo);
    const second = validateThermodynamicProperties(thermo);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it('валидация не мутирует входную запись', () => {
    const thermo = validKnownThermo();
    const before = JSON.stringify(thermo);
    validateThermodynamicProperties(thermo);
    validateThermodynamicProperties(thermo, { speciesId: 'тест', expectedPhase: 'gas' });
    expect(JSON.stringify(thermo)).toBe(before);
  });
});

// ============================================
// КОРЕКТИРУЮЩАЯ РЕВИЗИЯ 4.3.1 (VALIDATOR HARDENING):
// REFERENCE STATE ДЛЯ ЧИСЛОВЫХ CP-ДАННЫХ
// ============================================

describe('Stage 4.3.1 (hardening): reference state при числовых Cp-данных', () => {
  it('все скаляры unknown + числовая Cp-таблица без reference state — ошибка', () => {
    const thermo = unknownThermo();
    thermo.heatCapacity = { status: 'known', tabulated: testCpTable() };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('reference state обязателен'))
    ).toBe(true);
  });

  it('все скаляры unknown + NASA-7 без reference state — ошибка', () => {
    const thermo = unknownThermo();
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [nasa7Segment(200, 1000)] } };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('reference state обязателен'))
    ).toBe(true);
  });

  it('скаляры unknown + таблица и NASA-7 одновременно без reference state — ошибка', () => {
    const thermo = unknownThermo();
    thermo.heatCapacity = {
      status: 'estimated',
      tabulated: testCpTable(),
      nasa7: { segments: [nasa7Segment(200, 1000)] }
    };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('reference state обязателен'))
    ).toBe(true);
  });

  it('те же записи с корректным reference state проходят', () => {
    const withTable = unknownThermo();
    withTable.heatCapacity = { status: 'known', tabulated: testCpTable() };
    withTable.referenceState = { phase: 'gas', standardState: 'идеальный газ, 1 бар (объявлено тестовым источником)' };
    expect(validateThermodynamicProperties(withTable)).toEqual([]);
    const withNasa = unknownThermo();
    withNasa.heatCapacity = { status: 'known', nasa7: { segments: [nasa7Segment(200, 1000)] } };
    withNasa.referenceState = { phase: 'gas', standardState: 'идеальный газ, 1 бар (объявлено тестовым источником)' };
    expect(validateThermodynamicProperties(withNasa)).toEqual([]);
    const withBoth = unknownThermo();
    withBoth.heatCapacity = {
      status: 'known',
      tabulated: testCpTable(),
      nasa7: { segments: [nasa7Segment(200, 1000)] }
    };
    withBoth.referenceState = { phase: 'gas', standardState: 'идеальный газ, 1 бар (объявлено тестовым источником)' };
    expect(validateThermodynamicProperties(withBoth)).toEqual([]);
  });

  it('несовпадение фазы reference state при единственных числовых данных Cp — ошибка', () => {
    const thermo = unknownThermo();
    thermo.heatCapacity = { status: 'known', tabulated: testCpTable() };
    thermo.referenceState = { phase: 'liquid', standardState: 'идеальный газ, 1 бар (объявлено тестовым источником)' };
    const direct = validateThermodynamicProperties(thermo, { speciesId: 'тест', expectedPhase: 'gas' });
    expect(direct.some((e) => e.includes('не совпадает с фазой записи'))).toBe(true);
    const species = makeThermoSpecies(thermo);
    expect(
      validateSpecies(species).some((e) => e.includes('не совпадает с фазой записи'))
    ).toBe(true);
  });

  it('reference state без температуры и давления допустим, если источник их не задаёт', () => {
    const thermo = unknownThermo();
    thermo.heatCapacity = { status: 'known', tabulated: testCpTable() };
    thermo.referenceState = {
      phase: 'gas',
      standardState: 'стандартное состояние описано тестовым источником явно',
      conditions: 'температура и давление источником не заданы — автоматически не назначаются'
    };
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
  });
});

// ============================================
// КОРЕКТИРУЮЩАЯ РЕВИЗИЯ 4.3.1 (VALIDATOR HARDENING):
// БЕЗОПАСНАЯ RUNTIME-ВАЛИДАЦИЯ ПОВРЕЖДЁННЫХ ДАННЫХ
// ============================================

describe('Stage 4.3.1 (hardening): безопасная runtime-валидация повреждённых данных', () => {
  it('null вместо ScientificValue — диагностики, не исключение', () => {
    const thermo = unknownThermo();
    thermo.standardFormationEnthalpy = null as unknown as ScientificValue;
    thermo.standardFormationGibbsEnergy = null as unknown as ScientificValue;
    thermo.standardEntropy = null as unknown as ScientificValue;
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors.some((e) => e.includes('энтальпия') && e.includes('должно быть объектом ScientificValue'))).toBe(true);
    expect(errors.some((e) => e.includes('энергия Гиббса') && e.includes('должно быть объектом ScientificValue'))).toBe(true);
    expect(errors.some((e) => e.includes('энтропия') && e.includes('должно быть объектом ScientificValue'))).toBe(true);
  });

  it('known без корректного объекта quantity — диагностики, не исключение', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationEnthalpy = { status: 'known' } as unknown as ScientificValue;
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('quantity должен быть объектом'))).toBe(true);
    expect(errors.some((e) => e.includes('величина должна быть объектом {value, unit}'))).toBe(true);
  });

  it('quantity без value/unit, с нечисловым и неконечным value — диагностики', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationEnthalpy = {
      status: 'known',
      quantity: { value: 1 }
    } as unknown as ScientificValue;
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('quantity.unit должен быть зарегистрированной единицей'))).toBe(true);
    expect(errors.some((e) => e.includes('единица должна быть строкой, получено undefined'))).toBe(true);
    thermo.standardFormationEnthalpy = {
      status: 'known',
      quantity: { value: 'много', unit: 'J_mol' }
    } as unknown as ScientificValue;
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('значение должно быть конечным числом, получено много'))).toBe(true);
    thermo.standardFormationEnthalpy = {
      status: 'known',
      quantity: { value: Number.NaN, unit: 'J_mol' },
      provenance: testProvenance('experimental')
    } as unknown as ScientificValue;
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('значение должно быть конечным числом, получено NaN'))).toBe(true);
  });

  it('null вместо reference state — диагностики при числовых данных', () => {
    const thermo = validKnownThermo();
    thermo.referenceState = null as unknown as ThermodynamicProperties['referenceState'];
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('reference state обязателен'))).toBe(true);
    expect(errors.some((e) => e.includes('reference state: должен быть объектом'))).toBe(true);
  });

  it('null вместо heatCapacity — диагностика, не исключение', () => {
    const thermo = unknownThermo();
    thermo.heatCapacity = null as unknown as ThermodynamicProperties['heatCapacity'];
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('теплоёмкость: блок должен быть объектом'))).toBe(true);
  });

  it('null вместо Cp-таблицы и null-точка в таблице — диагностики', () => {
    const thermo = unknownThermo();
    thermo.heatCapacity = { status: 'known', tabulated: null as unknown as CpTabulatedData };
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('Cp-таблица: таблица должна быть объектом'))).toBe(true);
    const withNullPoint = unknownThermo();
    withNullPoint.heatCapacity = {
      status: 'known',
      tabulated: {
        points: [
          null as unknown as CpTablePoint,
          { temperature: quantity(300, 'K'), cp: quantity(33.6, 'J_mol_K') }
        ],
        provenance: testProvenance('experimental')
      }
    };
    expect(() => {
      errors = validateThermodynamicProperties(withNullPoint);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('точка 0: точка должна быть объектом'))).toBe(true);
  });

  it('null температура/null Cp точки, NaN в Cp и неположительная температура — диагностики', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = {
      status: 'known',
      tabulated: {
        points: [
          { temperature: null as unknown as PhysicalQuantity, cp: quantity(33.6, 'J_mol_K') },
          { temperature: quantity(0, 'K'), cp: null as unknown as PhysicalQuantity },
          { temperature: quantity(400, 'K'), cp: { value: Number.NaN, unit: 'J_mol_K' } as unknown as PhysicalQuantity }
        ],
        provenance: testProvenance('experimental')
      }
    };
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('точка 0: температура') && e.includes('объектом {value, unit}'))).toBe(true);
    expect(errors.some((e) => e.includes('точка 1: температура') && e.includes('положительной'))).toBe(true);
    expect(errors.some((e) => e.includes('точка 1: Cp') && e.includes('объектом {value, unit}'))).toBe(true);
    expect(errors.some((e) => e.includes('точка 2: Cp') && e.includes('конечным числом, получено NaN'))).toBe(true);
  });

  it('null NASA-7 параметризация, null-сегмент и null rangeK — диагностики', () => {
    const thermo = unknownThermo();
    thermo.heatCapacity = { status: 'known', nasa7: null as unknown as Nasa7Polynomial };
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('NASA-7: параметризация должна быть объектом'))).toBe(true);
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [null as unknown as Nasa7Segment] } };
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('сегмент 0: сегмент должен быть объектом'))).toBe(true);
    const brokenRange = nasa7Segment(200, 1000);
    brokenRange.rangeK = null as unknown as Nasa7Segment['rangeK'];
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [brokenRange] } };
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('требуется диапазон применимости rangeK {min, max}'))).toBe(true);
    const brokenBounds = nasa7Segment(200, 1000);
    brokenBounds.rangeK = { min: null, max: null } as unknown as Nasa7Segment['rangeK'];
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [brokenBounds] } };
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('требуется диапазон применимости rangeK {min, max}'))).toBe(true);
  });

  it('null derivation и derivation без kind/provenance — диагностики', () => {
    const thermo = unknownThermo();
    const nullDerivation = nasa7Segment(200, 1000);
    nullDerivation.derivation = null as unknown as Nasa7Segment['derivation'];
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [nullDerivation] } };
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('derivation должен быть объектом'))).toBe(true);
    const emptyDerivation = nasa7Segment(200, 1000);
    emptyDerivation.derivation = {} as unknown as Nasa7Segment['derivation'];
    thermo.heatCapacity = { status: 'known', nasa7: { segments: [emptyDerivation] } };
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes("derivation.kind должен быть 'published' или 'fitted', получено «undefined»"))).toBe(true);
    expect(errors.some((e) => e.includes('provenance исходных данных') && e.includes('собственный provenance'))).toBe(true);
  });

  it('null per-value provenance и null точечный provenance — диагностики', () => {
    const thermo = validKnownThermo();
    const value = knownValue(quantity(-228600, 'J_mol'), { provenance: testProvenance('experimental') });
    thermo.standardFormationGibbsEnergy = {
      ...value,
      provenance: null
    } as unknown as ScientificValue;
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('provenance должен быть объектом'))).toBe(true);
    const table = testCpTable();
    table.points[0].provenance = null as unknown as ThermoDataProvenance;
    const thermoTable = validKnownThermo();
    thermoTable.heatCapacity = { status: 'known', tabulated: table };
    expect(() => {
      errors = validateThermodynamicProperties(thermoTable);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('точка 0: provenance: provenance должен быть объектом'))).toBe(true);
  });

  it('повреждённый блок через validateSpecies — префикс «термодинамика:», без исключения, детерминированно', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = null as unknown as ThermodynamicProperties['heatCapacity'];
    thermo.referenceState = null as unknown as ThermodynamicProperties['referenceState'];
    const species = makeThermoSpecies(thermo);
    let errors: string[] = [];
    expect(() => {
      errors = validateSpecies(species);
    }).not.toThrow();
    expect(errors.some((e) => e.startsWith('термодинамика:'))).toBe(true);
    expect(errors.some((e) => e.includes('теплоёмкость: блок должен быть объектом'))).toBe(true);
    expect(errors.some((e) => e.includes('reference state: должен быть объектом'))).toBe(true);
    // детерминированность на повреждённых данных
    expect(validateSpecies(species)).toEqual(errors);
  });
});

// ============================================
// КОРЕКТИРУЮЩАЯ РЕВИЗИЯ 4.3.1 (VALIDATOR HARDENING):
// PROVENANCE ОТДЕЛЬНЫХ CP-ТОЧЕК
// ============================================

describe('Stage 4.3.1 (hardening): provenance отдельных Cp-точек', () => {
  it('точка без собственного provenance наследует provenance таблицы — проходит', () => {
    const thermo = validKnownThermo();
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
  });

  it('точка с корректным собственным provenance проходит', () => {
    const thermo = validKnownThermo();
    const table = testCpTable();
    table.points[0].provenance = testProvenance('experimental', { recordId: 'тест-точка-1' });
    thermo.heatCapacity = { status: 'known', tabulated: table };
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
  });

  it('точечный provenance с origin unknown — ошибка (числовая точка)', () => {
    const thermo = validKnownThermo();
    const table = testCpTable();
    table.points[0].provenance = testProvenance('unknown');
    thermo.heatCapacity = { status: 'known', tabulated: table };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('не может иметь происхождение unknown'))
    ).toBe(true);
  });

  it('точечный provenance без идентификации источника — ошибка', () => {
    const thermo = validKnownThermo();
    const table = testCpTable();
    table.points[0].provenance = { origin: 'experimental' };
    thermo.heatCapacity = { status: 'known', tabulated: table };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('не идентифицирует источник'))
    ).toBe(true);
  });

  it('точечный provenance derived_computed без метода — ошибка; с методом — проходит', () => {
    const thermo = validKnownThermo();
    const table = testCpTable();
    table.points[0].provenance = { origin: 'derived_computed', sourceName: 'тест' };
    thermo.heatCapacity = { status: 'known', tabulated: table };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('требует непустой метод'))
    ).toBe(true);
    table.points[0].provenance = {
      origin: 'derived_computed',
      sourceName: 'тест',
      method: 'интерполяция тестовой таблицы'
    };
    expect(validateThermodynamicProperties(thermo)).toEqual([]);
  });

  it('точечный provenance с неизвестным origin — ошибка', () => {
    const thermo = validKnownThermo();
    const table = testCpTable();
    table.points[0].provenance = { origin: 'guesstimate' } as unknown as ThermoDataProvenance;
    thermo.heatCapacity = { status: 'known', tabulated: table };
    expect(
      validateThermodynamicProperties(thermo).some((e) => e.includes('неизвестный origin'))
    ).toBe(true);
  });
});

// ============================================
// ЗАКЛЮЧИТЕЛЬНАЯ ПРОВЕРКА ВАЛИДАТОРА 4.3.1:
// BOUNDED-НЕОПРЕДЕЛЁННОСТЬ И ЧУЖАЯ РАЗМЕРНОСТЬ
// ============================================

describe('Stage 4.3.1 (заключительная проверка): bounded-неопределённость и чужая размерность', () => {
  it('повреждённая bounded-неопределённость (без direction) у known-значения — диагностика', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationEnthalpy = {
      status: 'known',
      quantity: quantity(-241800, 'J_mol'),
      provenance: testProvenance('experimental'),
      uncertainty: { kind: 'bounded', bound: 1000 }
    } as unknown as ScientificValue;
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('неопределённость') && e.includes('above'))).toBe(true);
  });

  it('повреждённая bounded-неопределённость (посторонний direction) у estimated-значения — диагностика', () => {
    const thermo = validKnownThermo();
    thermo.standardEntropy = {
      status: 'estimated',
      quantity: quantity(188.8, 'J_mol_K'),
      method: 'тестовая оценка',
      provenance: testProvenance('theoretical_estimate', { method: 'тестовая корреляция' }),
      uncertainty: { kind: 'bounded', direction: 'вбок', bound: 5 }
    } as unknown as ScientificValue;
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('неопределённость') && e.includes('направление'))).toBe(true);
  });

  it('температура Cp-точки в чужой размерности — диагностика; значение не используется для порядка', () => {
    const thermo = validKnownThermo();
    thermo.heatCapacity = {
      status: 'known',
      tabulated: {
        points: [
          { temperature: quantity(300, 'Pa') as unknown as PhysicalQuantity, cp: quantity(33.6, 'J_mol_K') },
          { temperature: quantity(200, 'K'), cp: quantity(31.0, 'J_mol_K') }
        ],
        provenance: testProvenance('experimental')
      }
    };
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('точка 0: температура') && e.includes('размерность'))).toBe(true);
    // число в паскалях не используется как температура: ложных
    // ошибок порядка/дубликата от чужой размерности нет
    expect(errors.some((e) => e.includes('строго по возрастанию'))).toBe(false);
    expect(errors.some((e) => e.includes('дубликат температуры'))).toBe(false);
  });

  it('граница rangeK в чужой размерности — диагностика; границы не используются в дальнейших проверках', () => {
    const thermo = validKnownThermo();
    const segment = nasa7FittedSegment();
    segment.rangeK = { min: quantity(200, 'Pa') as unknown as PhysicalQuantity, max: quantity(1000, 'K') };
    // контрольная точка заведомо за пределами «числовых» границ:
    // если валидатор использовал бы значение в паскалях как
    // температуру, появилась бы ложная ошибка «вне диапазона»
    segment.derivation.checkPoints = [
      { temperature: quantity(1500, 'K'), sourceCpOverR: 4.5 }
    ];
    thermo.heatCapacity = {
      status: 'known',
      tabulated: testCpTable(),
      nasa7: { segments: [segment] }
    };
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('нижняя граница') && e.includes('размерность'))).toBe(true);
    // границы в чужой размерности не используются как числа: ложного
    // «вне диапазона» для контрольной точки и проверок стыка нет
    expect(errors.some((e) => e.includes('вне диапазона сегмента'))).toBe(false);
    expect(errors.some((e) => e.includes('пересекается'))).toBe(false);
    expect(errors.some((e) => e.includes('упорядочены'))).toBe(false);
  });

  it('температура reference state в чужой размерности — диагностика; положительность по ней не проверяется', () => {
    const thermo = validKnownThermo();
    const ref = thermo.referenceState;
    if (ref === undefined) throw new Error('фикстура должна содержать reference state');
    thermo.referenceState = { ...ref, temperature: quantity(-101325, 'Pa') as unknown as PhysicalQuantity };
    let errors: string[] = [];
    expect(() => {
      errors = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(errors.some((e) => e.includes('температура') && e.includes('размерность'))).toBe(true);
    // значение в паскалях не проверяется на положительность как
    // температура: диагностика — только о размерности
    expect(errors.some((e) => e.includes('положительной'))).toBe(false);
  });

  it('валидация таких повреждённых входов детерминирована и без исключений', () => {
    const thermo = validKnownThermo();
    thermo.standardFormationEnthalpy = {
      status: 'known',
      quantity: quantity(-241800, 'J_mol'),
      provenance: testProvenance('experimental'),
      uncertainty: { kind: 'bounded', bound: 1000 }
    } as unknown as ScientificValue;
    const table = testCpTable();
    table.points[0].temperature = quantity(300, 'Pa') as unknown as PhysicalQuantity;
    thermo.heatCapacity = { status: 'known', tabulated: table };
    let first: string[] = [];
    let second: string[] = [];
    expect(() => {
      first = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(() => {
      second = validateThermodynamicProperties(thermo);
    }).not.toThrow();
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
  });
});
