// ============================================
// STAGE 4.1 - Тесты физических величин и размерностей
// ============================================

import { describe, it, expect } from 'vitest';
import {
  quantity,
  tryQuantity,
  convert,
  toSI,
  add,
  sub,
  scale,
  compare,
  approxEqual,
  assertDimension,
  dimension,
  dimensionOf,
  dimensionToString,
  isKnownUnit,
  isZero,
  isNegative,
  sameDimension,
  getUnitDefinition,
  QuantityError
} from '../Core/physicalQuantity';

describe('Stage 4.1 PhysicalQuantity: преобразование единиц', () => {
  it('км → м: множитель 1000', () => {
    const q = convert(quantity(2, 'km'), 'm');
    expect(q.value).toBe(2000);
    expect(q.unit).toBe('m');
  });

  it('bar → Pa и atm → Pa', () => {
    expect(convert(quantity(1, 'bar'), 'Pa').value).toBe(1e5);
    expect(convert(quantity(1, 'atm'), 'Pa').value).toBe(101325);
  });

  it('г → кг, сутки → с, юлианский год → с, AU → м', () => {
    expect(convert(quantity(500, 'g'), 'kg').value).toBe(0.5);
    expect(convert(quantity(1, 'day'), 's').value).toBe(86400);
    expect(convert(quantity(1, 'yr'), 's').value).toBe(3.15576e7);
    expect(convert(quantity(1, 'AU'), 'm').value).toBeCloseTo(1.495978707e11, 6);
  });

  it('обратное преобразование восстанавливает значение (round-trip)', () => {
    const original = quantity(123.456, 'km');
    const back = convert(convert(original, 'm'), 'km');
    expect(back.value).toBeCloseTo(123.456, 9);
    expect(back.unit).toBe('km');
  });

  it('безразмерные и углы: deg → rad', () => {
    expect(convert(quantity(180, 'deg'), 'rad').value).toBeCloseTo(Math.PI, 12);
  });

  it('toSI даёт значение в когерентной единице SI', () => {
    expect(toSI(quantity(2, 'km'))).toBe(2000);
    expect(toSI(quantity(1, 'atm'))).toBe(101325);
  });
});

describe('Stage 4.1 PhysicalQuantity: размерностный контроль', () => {
  it('массу и температуру складывать нельзя', () => {
    expect(() => add(quantity(1, 'kg'), quantity(2, 'K'))).toThrow(QuantityError);
    try {
      add(quantity(1, 'kg'), quantity(2, 'K'));
      expect.unreachable('операция должна быть отклонена');
    } catch (e) {
      const err = e as QuantityError;
      expect(err.code).toBe('incompatible_dimension');
      expect(err.expected).toBe('kg');
      expect(err.actual).toBe('K');
    }
  });

  it('давление нельзя преобразовать в энергию', () => {
    expect(() => convert(quantity(1, 'Pa'), 'J')).toThrowError(/разные размерности/);
  });

  it('скорость и ускорение несовместимы', () => {
    expect(() => sub(quantity(1, 'm_s'), quantity(1, 'm_s2'))).toThrow(QuantityError);
  });

  it('сложение совместимых размерностей с разными единицами', () => {
    const sum = add(quantity(1, 'km'), quantity(500, 'm'));
    expect(sum.value).toBe(1.5);
    expect(sum.unit).toBe('km');
  });

  it('энергия, мощность, поток и удельная энергия — РАЗНЫЕ размерности', () => {
    const energy = dimensionOf(quantity(1, 'J'));
    const power = dimensionOf(quantity(1, 'W'));
    const flux = dimensionOf(quantity(1, 'W_m2'));
    const specific = dimensionOf(quantity(1, 'J_kg'));
    expect(sameDimension(energy, power)).toBe(false);
    expect(sameDimension(power, flux)).toBe(false);
    expect(sameDimension(energy, specific)).toBe(false);
    expect(dimensionToString(power)).toBe('kg·m^2·s^-3');
    expect(dimensionToString(flux)).toBe('kg·s^-3');
  });

  it('количество вещества (моль) — не масса и не молярная концентрация', () => {
    expect(sameDimension(dimensionOf(quantity(1, 'mol')), dimensionOf(quantity(1, 'kg')))).toBe(false);
    expect(sameDimension(dimensionOf(quantity(1, 'mol')), dimensionOf(quantity(1, 'mol_m3')))).toBe(false);
  });

  it('составные размерности: сравнение и строка', () => {
    const d = dimension(1, -1, -2); // Pa
    expect(dimensionToString(d)).toBe('kg·m^-1·s^-2');
    expect(sameDimension(d, dimensionOf(quantity(1, 'bar')))).toBe(true);
  });

  it('compare и approxEqual требуют одной размерности', () => {
    expect(compare(quantity(1, 'km'), quantity(999, 'm'))).toBe(1);
    expect(compare(quantity(1, 'km'), quantity(1001, 'm'))).toBe(-1);
    expect(compare(quantity(1, 'km'), quantity(1000, 'm'))).toBe(0);
    expect(approxEqual(quantity(1, 'km'), quantity(1000.001, 'm'), 0.01)).toBe(true);
    expect(() => compare(quantity(1, 'kg'), quantity(1, 's'))).toThrow(QuantityError);
  });

  it('assertDimension отвергает несовместимую величину', () => {
    expect(() => assertDimension(quantity(1, 'kg'), dimension(0, 0, 0, 0, 0, 1), 'test', 'Test')).toThrow(QuantityError);
    expect(() => assertDimension(quantity(2, 'mol'), dimension(0, 0, 0, 0, 0, 1), 'test', 'Test')).not.toThrow();
  });
});

describe('Stage 4.1 PhysicalQuantity: особые случаи', () => {
  it('NaN и бесконечности запрещены', () => {
    expect(() => quantity(NaN, 'kg')).toThrowError(/конечным/);
    expect(() => quantity(Number.POSITIVE_INFINITY, 'kg')).toThrow(QuantityError);
    expect(() => quantity(Number.NEGATIVE_INFINITY, 'm')).toThrow(QuantityError);
    expect(tryQuantity(NaN, 'kg')).toBeNull();
    expect(tryQuantity(Number.POSITIVE_INFINITY, 'kg')).toBeNull();
  });

  it('неизвестная единица отвергается', () => {
    expect(() => quantity(1, 'furlong')).toThrowError(/не зарегистрирована/);
    expect(tryQuantity(1, 'furlong')).toBeNull();
    expect(isKnownUnit('furlong')).toBe(false);
    // русские легаси-единицы в реестре ядра НЕ живут (для них — адаптер)
    expect(isKnownUnit('кг')).toBe(false);
    expect(isKnownUnit('kg')).toBe(true);
  });

  it('нулевые значения допустимы', () => {
    const q = quantity(0, 'kg');
    expect(isZero(q)).toBe(true);
    expect(isNegative(q)).toBe(false);
  });

  it('отрицательные значения не запрещены: знак может иметь физический смысл', () => {
    const flux = quantity(-5, 'J');
    expect(isNegative(flux)).toBe(true);
    expect(isZero(flux)).toBe(false);
    // сама величина отрицательный знак допускает; запреты — на уровне инвентаря
    expect(() => quantity(-100, 'Pa')).not.toThrow();
  });

  it('переполнение при преобразовании обнаруживается', () => {
    const huge = quantity(1e307, 'km');
    expect(() => convert(huge, 'm')).toThrow(QuantityError);
  });

  it('scale требует конечный коэффициент', () => {
    expect(() => scale(quantity(1, 'kg'), Number.POSITIVE_INFINITY)).toThrow(QuantityError);
    expect(scale(quantity(2, 'kg'), 3).value).toBe(6);
  });
});

describe('Stage 4.3.3 R2 PhysicalQuantity: единицы года NUBASE2020 (тропический год)', () => {
  it('y, ky, My зарегистрированы с официальным определением года NUBASE2020', () => {
    const y = getUnitDefinition('y');
    const ky = getUnitDefinition('ky');
    const my = getUnitDefinition('My');
    if (!y || !ky || !my) throw new Error('единицы NUBASE2020 y/ky/My обязаны быть зарегистрированы');
    // официальное определение года NUBASE2020: 365.2422 сут = 31 556 926 с
    expect(y.factor).toBe(31556926);
    expect(ky.factor).toBe(31556926000);
    expect(my.factor).toBe(31556926000000);
    expect(sameDimension(dimensionOf(quantity(1, 'y')), dimensionOf(quantity(1, 's')))).toBe(true);
    expect(y.note ?? '').toContain('365.2422');
    expect(isKnownUnit('y')).toBe(true);
    expect(isKnownUnit('ky')).toBe(true);
    expect(isKnownUnit('My')).toBe(true);
  });

  it('тропический год NUBASE2020 отличается от юлианского yr (не равен и не подменяет его)', () => {
    expect(convert(quantity(1, 'yr'), 's').value).toBe(3.15576e7);
    expect(convert(quantity(1, 'y'), 's').value).toBe(31556926);
    const yInYr = convert(quantity(1, 'y'), 'yr').value;
    expect(yInYr).not.toBe(1);
    // отношение NUBASE2020: 31 556 926 с / 31 557 600 с
    expect(yInYr).toBeCloseTo(31556926 / 31557600, 12);
  });

  it('кратные тропического года: ky = 1000 y, My = 1 000 000 y, SI-секунды', () => {
    expect(convert(quantity(1, 'ky'), 'y').value).toBe(1000);
    expect(convert(quantity(1, 'My'), 'y').value).toBe(1e6);
    expect(toSI(quantity(2, 'y'))).toBe(2 * 31556926);
    expect(toSI(quantity(2, 'ky'))).toBe(2 * 31556926000);
    expect(toSI(quantity(3, 'My'))).toBe(3 * 31556926000000);
  });

  it('юлианские yr/ka/Ma остаются прежними (легаси Units.YEAR_S не затронут)', () => {
    expect(convert(quantity(1, 'yr'), 's').value).toBe(3.15576e7);
    expect(convert(quantity(1, 'ka'), 'yr').value).toBe(1000);
    expect(convert(quantity(1, 'Ma'), 'yr').value).toBe(1e6);
    expect(getUnitDefinition('yr')?.factor).toBe(3.15576e7);
  });
});
