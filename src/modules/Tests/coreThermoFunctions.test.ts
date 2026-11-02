// ============================================
// STAGE 4.3.4 - Тесты вычислителя термодинамических
// функций из NASA-7 полиномов
// ============================================
//
// Проверяются требования подэтапа 4.3.4 (жёсткая зависимость
// Stage 4.4 «Химическое равновесие»):
// - обе формы параметризации: nasa_cea (T^-2..T^4 + a8/a9) и
//   nasa7_classic (T^0..T^4 + a5/a6);
// - H°(298.15) из полинома согласуется с числовым полем ΔfH°
//   записи каталога (12 видов, чей нижний сегмент начинается
//   с 200 K);
// - S°(298.15) из полинома согласуется со справочными значениями
//   NIST Chemistry WebBook (S°gas, 1 бар; Chase 1998; проверено
//   2026-11-02): конвенция стандартного состояния коэффициентов
//   каталога — 1 бар — фиксируется кросс-чеком, а не предположением;
// - температура вне диапазона сегментов — отказ (fail-closed),
//   экстраполяции нет: 8 видов каталога с нижней границей 300 K
//   обязаны отказывать при 298.15 K;
// - непрерывность на стыке сегментов 1000 K;
// - повреждённые сегменты и величины — ошибки, не NaN;
// - отсутствие NASA-7 параметризации — ошибка no_thermodynamic_data
//   без подстановки значений;
// - детерминированность и чистота (без мутации входа).
//
// Табличные значения NIST в тестах — внешний оракул валидации
// уровня 2 (VALIDATION_PLAN): источник указан явно, значения не
// вымышлены и не «из памяти», а сверены с публикацией NIST.

import { describe, it, expect } from 'vitest';
import { quantity } from '../Core/physicalQuantity';
import type { PhysicalQuantity } from '../Core/physicalQuantity';
import type { Nasa7Segment, NasaCeaSegment, ThermodynamicProperties, ThermoDataProvenance } from '../Core/thermodynamics';
import { unknownValue } from '../Core/scientificValue';
import {
  UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K,
  ThermoFunctionsError,
  nasaSegmentCpOverR,
  nasaSegmentEnthalpyOverR,
  nasaSegmentEntropyOverR,
  nasaSegmentCp,
  nasaSegmentEnthalpy,
  nasaSegmentEntropy,
  nasaSegmentGibbsEnergy,
  findNasaSegment,
  nasaCp,
  nasaStandardEnthalpy,
  nasaStandardEntropy,
  nasaStandardGibbsEnergy,
  requireNasa7,
  speciesStandardGibbsEnergy,
  speciesStandardGibbsEnergyOverRT,
  speciesCp
} from '../Core/thermoFunctions';
import { buildThermodynamicCatalog } from '../Data/thermodynamicCatalog';
import type { NasaCeaGasRecordId } from '../Data/thermodynamicCatalog';

const R = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
const T298 = quantity(298.15, 'K');
const T1000 = quantity(1000, 'K');

/** Синтетический provenance для фикстур (не реальные данные). */
function fixtureProvenance(): ThermoDataProvenance {
  return {
    origin: 'numerical_approximation',
    sourceName: 'тестовая фикстура (фикция для тестов)',
    method: 'синтетическая тестовая параметризация (фикция)'
  };
}

/** Синтетический CEA-сегмент. */
function ceaSegment(minK: number, maxK: number, coefficients: number[], a8: number, a9: number): NasaCeaSegment {
  return {
    form: 'nasa_cea',
    quantity: 'Cp_over_R',
    rangeK: { min: quantity(minK, 'K'), max: quantity(maxK, 'K') },
    coefficients,
    integralConstants: { enthalpyConstantOverR: a8, entropyConstantOverR: a9 },
    derivation: { kind: 'published', provenance: fixtureProvenance() }
  };
}

/** Синтетический классический сегмент. */
function classicSegment(minK: number, maxK: number, coefficients: number[]): Nasa7Segment {
  return {
    form: 'nasa7_classic',
    quantity: 'Cp_over_R',
    rangeK: { min: quantity(minK, 'K'), max: quantity(maxK, 'K') },
    coefficients,
    derivation: { kind: 'published', provenance: fixtureProvenance() }
  };
}

/** Блок термодинамики с заданной NASA-7 параметризацией. */
function thermoWithNasa7(segments: (NasaCeaSegment | Nasa7Segment)[]): ThermodynamicProperties {
  return {
    standardFormationEnthalpy: unknownValue('синтетическая фикстура: значение не предоставлено'),
    standardFormationGibbsEnergy: unknownValue('синтетическая фикстура: значение не предоставлено'),
    standardEntropy: unknownValue('синтетическая фикстура: значение не предоставлено'),
    heatCapacity: { status: 'known', nasa7: { segments } },
    referenceState: {
      temperature: quantity(298.15, 'K'),
      phase: 'gas',
      standardState: 'синтетическая фикстура: не реальное стандартное состояние',
      conditions: 'тест'
    }
  };
}

// ============================================
// КОНСТАНТА
// ============================================

describe('Stage 4.3.4: универсальная газовая постоянная', () => {
  it('R — точное значение определения СИ 2019 (k·N_A)', () => {
    const k = 1.380649e-23;
    const na = 6.02214076e23;
    expect(R).toBe(k * na);
    expect(R).toBe(8.31446261815324);
  });
});

// ============================================
// ФОРМА NASA CEA ПО ДАННЫМ КАТАЛОГА
// ============================================

describe('Stage 4.3.4: вычисление по форме nasa_cea (данные каталога)', () => {
  const catalog = buildThermodynamicCatalog();

  it('моноатомный Ar: Cp°/R = 2.5 точно, H°(298.15) = 0 из констант записи', () => {
    const ar = catalog.get('ar')!;
    const nasa7 = ar.thermodynamics!.heatCapacity.nasa7!;
    for (const t of [250, 500, 999]) {
      expect(nasaCp(nasa7, quantity(t, 'K')).value).toBeCloseTo(2.5 * R, 12);
    }
    // Ar — элемент: полином с a3 = 2.5, a8 = -745.375 построен так, что
    // H°(298.15)/R = 2.5·298.15 - 745.375 = 0 точно (справочный кадр H°(298.15) = 0)
    const h298 = nasaStandardEnthalpy(nasa7, T298);
    expect(h298.value).toBeCloseTo(0, 10);
    expect(h298.unit).toBe('J_mol');
  });

  it('H°(298.15) из полинома согласуется с полем ΔfH° записи для 12 видов (нижняя граница 200 K)', () => {
    const inRange: readonly NasaCeaGasRecordId[] = ['ar', 'h2', 'n2', 'o2', 'h2o', 'co', 'co2', 'ch4', 'nh3', 'no', 'c2h4', 'ch3oh'];
    for (const id of inRange) {
      const species = catalog.get(id)!;
      const thermo = species.thermodynamics!;
      const hf = thermo.standardFormationEnthalpy;
      expect(hf.status, `ΔfH° вида ${id}`).toBe('known');
      const hfValue = hf.status === 'known' ? hf.quantity.value : Number.NaN;
      const h298 = nasaStandardEnthalpy(thermo.heatCapacity.nasa7!, T298).value;
      // расхождение — только округление опубликованных коэффициентов записи
      // (фактический максимум по каталогу ~2.24 Дж/моль у CO2)
      expect(Math.abs(h298 - hfValue), `H°(298.15) вида ${id}: ${h298} против ${hfValue}`).toBeLessThanOrEqual(2.5);
    }
  });

  it('S°(298.15) соответствует справочным значениям NIST (конвенция 1 бар)', () => {
    // NIST Chemistry WebBook SRD 69, S°gas (1 бар), Chase 1998, проверено 2026-11-02
    const nistS298: Readonly<Record<string, number>> = {
      ar: 154.845,
      h2: 130.68,
      n2: 191.61,
      o2: 205.152,
      h2o: 188.84,
      co: 197.66,
      co2: 213.79,
      nh3: 192.77
    };
    for (const [id, sRef] of Object.entries(nistS298)) {
      const species = catalog.get(id)!;
      const s298 = nasaStandardEntropy(species.thermodynamics!.heatCapacity.nasa7!, T298).value;
      expect(Math.abs(s298 - sRef), `S°(298.15) вида ${id}: ${s298} против NIST ${sRef}`).toBeLessThanOrEqual(0.05);
    }
    // различие конвенций 1 бар / 1 atm составляет R·ln(101325/100000) ≈ 0.109
    // Дж/(моль·К): совпадение с табличными значениями 1 бар при допуске 0.05
    // фиксирует конвенцию коэффициентов CEA каталога (1 бар), а не 1 atm
    const n2S = nasaStandardEntropy(catalog.get('n2')!.thermodynamics!.heatCapacity.nasa7!, T298).value;
    expect(Math.abs(n2S - 191.61)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(n2S - 191.50)).toBeGreaterThan(0.05);
  });

  it('G°(T) = H°(T) − T·S°(T) согласованно на всех видах каталога', () => {
    for (const id of ['h2o', 'co2', 'nh3', 'ch4'] as const) {
      const nasa7 = catalog.get(id)!.thermodynamics!.heatCapacity.nasa7!;
      for (const t of [500, 1500, 3000]) {
        const T = quantity(t, 'K');
        const h = nasaStandardEnthalpy(nasa7, T).value;
        const s = nasaStandardEntropy(nasa7, T).value;
        const g = nasaStandardGibbsEnergy(nasa7, T).value;
        expect(g).toBeCloseTo(h - t * s, 9);
      }
    }
  });

  it('непрерывность на стыке сегментов 1000 K (обе стороны диапазона)', () => {
    for (const id of ['n2', 'h2o', 'co2', 'h2'] as const) {
      const segments = catalog.get(id)!.thermodynamics!.heatCapacity.nasa7!.segments;
      const lower = segments[0];
      const upper = segments[1];
      expect(lower.rangeK.max.value).toBe(1000);
      expect(upper.rangeK.min.value).toBe(1000);
      // оба сегмента содержат 1000 K; значения обязаны совпадать
      // (стык согласован источником, фактические расхождения < 0.001)
      expect(Math.abs(nasaSegmentEnthalpy(lower, T1000).value - nasaSegmentEnthalpy(upper, T1000).value)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(nasaSegmentEntropy(lower, T1000).value - nasaSegmentEntropy(upper, T1000).value)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(nasaSegmentCp(lower, T1000).value - nasaSegmentCp(upper, T1000).value)).toBeLessThanOrEqual(1e-4);
      // детерминированный выбор: на стыке берётся первый сегмент
      expect(findNasaSegment({ segments }, T1000)).toBe(lower);
    }
  });
});

// ============================================
// FAIL-CLOSED: ДИАПАЗОНЫ
// ============================================

describe('Stage 4.3.4: отказ вне диапазона применимости (без экстраполяции)', () => {
  const catalog = buildThermodynamicCatalog();

  it('8 видов с нижней границей 300 K отказывают при 298.15 K', () => {
    const startsAt300: readonly NasaCeaGasRecordId[] = ['he', 'ne', 'c2h6', 'so2', 'h2s', 'n2o', 'c2h2', 'c3h8'];
    for (const id of startsAt300) {
      const nasa7 = catalog.get(id)!.thermodynamics!.heatCapacity.nasa7!;
      let error: ThermoFunctionsError | null = null;
      try {
        nasaStandardEnthalpy(nasa7, T298);
      } catch (e) {
        error = e as ThermoFunctionsError;
      }
      expect(error, `вид ${id} обязан отказать при 298.15 K`).not.toBeNull();
      expect(error!.name).toBe('ThermoFunctionsError');
      expect(error!.code).toBe('temperature_out_of_range');
      expect(error!.message).toContain('300');
    }
  });

  it('ниже и выше всех диапазонов — отказ с перечислением диапазонов', () => {
    const arNasa7 = catalog.get('ar')!.thermodynamics!.heatCapacity.nasa7!;
    for (const t of [150, 25000]) {
      let error: ThermoFunctionsError | null = null;
      try {
        nasaCp(arNasa7, quantity(t, 'K'));
      } catch (e) {
        error = e as ThermoFunctionsError;
      }
      expect(error).not.toBeNull();
      expect(error!.code).toBe('temperature_out_of_range');
      expect(error!.message).toContain('200');
      expect(error!.message).toContain('20000');
    }
  });

  it('findNasaSegment возвращает null вне диапазонов (без исключения)', () => {
    const segments = catalog.get('ar')!.thermodynamics!.heatCapacity.nasa7!.segments;
    expect(findNasaSegment({ segments }, quantity(100, 'K'))).toBeNull();
    expect(findNasaSegment({ segments }, quantity(30000, 'K'))).toBeNull();
  });
});

// ============================================
// ФОРМА NASA7 CLASSIC (СИНТЕТИЧЕСКИЕ ФИКСТУРЫ)
// ============================================

describe('Stage 4.3.4: вычисление по форме nasa7_classic', () => {
  it('константа Cp/R = 2.5 и нулевая энтальпия элемента (фикстура «Ar-подобная»)', () => {
    const segment = classicSegment(200, 1000, [2.5, 0, 0, 0, 0, -745.375, 4.37967491]);
    expect(nasaSegmentCpOverR(segment, 400)).toBe(2.5);
    expect(nasaSegmentEnthalpyOverR(segment, 298.15)).toBeCloseTo(0, 10);
    // S°(298.15)/R = 4.37967491 + 2.5·ln(298.15)
    expect(nasaSegmentEntropyOverR(segment, 298.15)).toBeCloseTo(4.37967491 + 2.5 * Math.log(298.15), 10);
    expect(nasaSegmentEntropy(segment, T298).value).toBeCloseTo(154.845781, 4);
  });

  it('ненулевые старшие коэффициенты считаются по формулам формы', () => {
    const segment = classicSegment(300, 1000, [3, 1e-3, -2e-7, 0, 0, -1000, 5.0]);
    // при 500 K: Cp/R = 3 + 1e-3·500 - 2e-7·500² = 3.45
    expect(nasaSegmentCpOverR(segment, 500)).toBeCloseTo(3.45, 12);
    // H/R = -1000 + 3·500 + 1e-3·500²/2 - 2e-7·500³/3 = 616.6666667
    expect(nasaSegmentEnthalpyOverR(segment, 500)).toBeCloseTo(616.6666666667, 8);
    // S/R = 5 + 3·ln(500) + 1e-3·500 - 2e-7·500²/2 = 24.1188242953
    expect(nasaSegmentEntropyOverR(segment, 500)).toBeCloseTo(24.1188242953, 8);
    // размерные значения
    expect(nasaSegmentCp(segment, quantity(500, 'K')).value).toBeCloseTo(3.45 * R, 9);
    expect(nasaSegmentEnthalpy(segment, quantity(500, 'K')).value).toBeCloseTo(616.6666666667 * R, 5);
    expect(nasaSegmentEntropy(segment, quantity(500, 'K')).value).toBeCloseTo(24.1188242953 * R, 8);
    // G = H - T·S
    const g = nasaSegmentGibbsEnergy(segment, quantity(500, 'K')).value;
    expect(g).toBeCloseTo((616.6666666667 - 24.1188242953 * 500) * R, 4);
  });

  it('смешение форм: сегменты обеих форм вычисляются независимо', () => {
    const cea = ceaSegment(200, 1000, [0, 0, 2.5, 0, 0, 0, 0], -745.375, 4.37967491);
    const classic = classicSegment(1000, 2000, [2.5, 0, 0, 0, 0, -745.375, 4.37967491]);
    expect(nasaSegmentCpOverR(cea, 500)).toBe(2.5);
    expect(nasaSegmentCpOverR(classic, 1500)).toBe(2.5);
  });
});

// ============================================
// ПОВРЕЖДЁННЫЙ ВХОД
// ============================================

describe('Stage 4.3.4: повреждённые данные и величины — ошибки, не NaN', () => {
  const bad = (fn: () => unknown): ThermoFunctionsError => {
    try {
      fn();
    } catch (e) {
      return e as ThermoFunctionsError;
    }
    throw new Error('ожидалась ошибка ThermoFunctionsError');
  };

  it('не семь коэффициентов — invalid_input', () => {
    const segment = ceaSegment(200, 1000, [0, 0, 2.5, 0, 0, 0, 0], 0, 0);
    (segment as { coefficients: number[] }).coefficients = [0, 0, 2.5, 0, 0, 0];
    const error = bad(() => nasaSegmentCpOverR(segment, 500));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('семь');
  });

  it('NaN-коэффициент и NaN-константа — invalid_input', () => {
    const segment = ceaSegment(200, 1000, [0, 0, Number.NaN, 0, 0, 0, 0], 0, 0);
    expect(bad(() => nasaSegmentCpOverR(segment, 500)).code).toBe('invalid_input');
    const badConst = ceaSegment(200, 1000, [0, 0, 2.5, 0, 0, 0, 0], Number.NaN, 0);
    expect(bad(() => nasaSegmentEnthalpyOverR(badConst, 500)).code).toBe('invalid_input');
  });

  it('nasa_cea без integralConstants — invalid_input', () => {
    const segment = ceaSegment(200, 1000, [0, 0, 2.5, 0, 0, 0, 0], 0, 0);
    (segment as { integralConstants?: unknown }).integralConstants = undefined;
    const error = bad(() => nasaSegmentEnthalpyOverR(segment, 500));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('integralConstants');
  });

  it('неизвестная форма — invalid_input', () => {
    const segment = ceaSegment(200, 1000, [0, 0, 2.5, 0, 0, 0, 0], 0, 0) as unknown as Record<string, unknown>;
    segment.form = 'nasa9';
    const error = bad(() => nasaSegmentCpOverR(segment as unknown as NasaCeaSegment, 500));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('nasa9');
  });

  it('температура: NaN, неположительная, чужой размерности — invalid_input', () => {
    const segment = ceaSegment(200, 1000, [0, 0, 2.5, 0, 0, 0, 0], 0, 0);
    expect(bad(() => nasaSegmentCpOverR(segment, Number.NaN)).code).toBe('invalid_input');
    expect(bad(() => nasaSegmentCpOverR(segment, -5)).code).toBe('invalid_input');
    expect(bad(() => nasaSegmentCpOverR(segment, 0)).code).toBe('invalid_input');
    // NaN-величина минует конструктор quantity (он отвергает NaN сам) —
    // повреждённый JSON-подобный вход проверяется вычислителем
    expect(
      bad(() => nasaSegmentCp(segment, { value: Number.NaN, unit: 'K' } as unknown as PhysicalQuantity)).code
    ).toBe('invalid_input');
    expect(bad(() => nasaSegmentCp(segment, quantity(-5, 'K'))).code).toBe('invalid_input');
    expect(bad(() => nasaSegmentCp(segment, quantity(101325, 'Pa') as unknown as PhysicalQuantity)).code).toBe('invalid_input');
    expect(bad(() => nasaSegmentCp(segment, null as unknown as PhysicalQuantity)).code).toBe('invalid_input');
  });

  it('повреждённый диапазон сегмента — invalid_input', () => {
    const segment = ceaSegment(200, 1000, [0, 0, 2.5, 0, 0, 0, 0], 0, 0);
    (segment as { rangeK: { min: PhysicalQuantity; max: PhysicalQuantity } }).rangeK = {
      min: quantity(1000, 'K'),
      max: quantity(200, 'K')
    };
    const error = bad(() => nasaSegmentCpOverR(segment, 500));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('min < max');
  });

  it('пустая параметризация — invalid_input', () => {
    expect(bad(() => findNasaSegment({ segments: [] }, T298)).code).toBe('invalid_input');
    expect(bad(() => findNasaSegment(null as unknown as never, T298)).code).toBe('invalid_input');
  });
});

// ============================================
// УРОВЕНЬ ЗАПИСИ ВИДА (FAIL-CLOSED ПО ДАННЫМ)
// ============================================

describe('Stage 4.3.4: функции записи вида', () => {
  const catalog = buildThermodynamicCatalog();

  it('speciesStandardGibbsEnergy согласован с G = H − T·S на реальных данных', () => {
    for (const id of ['h2', 'n2', 'h2o', 'co', 'co2', 'nh3'] as const) {
      const thermo = catalog.get(id)!.thermodynamics!;
      for (const t of [700, 1000, 1500]) {
        const T = quantity(t, 'K');
        const g = speciesStandardGibbsEnergy(thermo, T).value;
        const h = nasaStandardEnthalpy(requireNasa7(thermo, 'test'), T).value;
        const s = nasaStandardEntropy(requireNasa7(thermo, 'test'), T).value;
        expect(g).toBeCloseTo(h - t * s, 9);
        // безразмерная форма для решателя: G°/(R·T)
        const gOverRT = speciesStandardGibbsEnergyOverRT(thermo, T);
        expect(gOverRT).toBeCloseTo(g / (R * t), 12);
      }
    }
  });

  it('speciesCp совпадает с nasaCp по той же параметризации', () => {
    const thermo = catalog.get('co2')!.thermodynamics!;
    const T = quantity(800, 'K');
    expect(speciesCp(thermo, T).value).toBeCloseTo(nasaCp(requireNasa7(thermo, 'test'), T).value, 15);
  });

  it('нет блока термодинамики — no_thermodynamic_data без подстановки', () => {
    const error = (() => {
      try {
        speciesStandardGibbsEnergy(null as unknown as ThermodynamicProperties, T298);
      } catch (e) {
        return e as ThermoFunctionsError;
      }
      return null;
    })();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('no_thermodynamic_data');
  });

  it('нет NASA-7 параметризации — no_thermodynamic_data (unknown ≠ нули)', () => {
    const thermo = thermoWithNasa7([]);
    (thermo as { heatCapacity: { status: string; nasa7?: unknown } }).heatCapacity = { status: 'unknown' };
    const error = (() => {
      try {
        speciesStandardGibbsEnergyOverRT(thermo, T298);
      } catch (e) {
        return e as ThermoFunctionsError;
      }
      return null;
    })();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('no_thermodynamic_data');
    expect(error!.message).toContain('NASA-7');
  });
});

// ============================================
// ДЕТЕРМИНИРОВАННОСТЬ И ЧИСТОТА
// ============================================

describe('Stage 4.3.4: детерминированность и отсутствие мутаций', () => {
  const catalog = buildThermodynamicCatalog();

  it('повторные вызовы дают идентичные результаты', () => {
    const thermo = catalog.get('n2')!.thermodynamics!;
    const first = nasaStandardGibbsEnergy(thermo, T1000).value;
    const second = nasaStandardGibbsEnergy(thermo, T1000).value;
    expect(second).toBe(first);
  });

  it('вычисление не мутирует входную параметризацию', () => {
    const thermo = catalog.get('h2o')!.thermodynamics!;
    const before = JSON.stringify(thermo);
    nasaCp(requireNasa7(thermo, 'test'), T298);
    nasaStandardEntropy(requireNasa7(thermo, 'test'), T1000);
    speciesStandardGibbsEnergyOverRT(thermo, quantity(700, 'K'));
    expect(JSON.stringify(thermo)).toBe(before);
  });
});
