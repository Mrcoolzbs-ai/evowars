// ============================================
// STAGE 4.1 - Тесты резервуаров: инвентарь, basis, энергия
// ============================================

import { describe, it, expect } from 'vitest';
import {
  createReservoir,
  setMaterialInventory,
  addMaterial,
  removeMaterial,
  getAmount,
  setProperty,
  getProperty,
  setEnergyInventory,
  validateMaterialInventory,
  validateEnergyInventory,
  validateReservoirRecord,
  isPlainRecord,
  amountToMass,
  massToAmount,
  ReservoirError
} from '../Core/reservoir';
import { knownValue, unknownValue, quantityOrNull } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { QuantityError } from '../Core/physicalQuantity';

describe('Stage 4.1 Reservoir: материальный инвентарь', () => {
  it('создание и задание инвентаря с явным основанием', () => {
    let ocean = createReservoir('ocean', 'ocean', { bodyId: 'planet' });
    expect(ocean.material).toBeUndefined();
    ocean = setMaterialInventory(ocean, 'amount', { h2o: 1000, co2: 5 });
    expect(ocean.material?.basis).toBe('amount');
    expect(getAmount(ocean, 'h2o')).toBe(1000);
    expect(getAmount(ocean, 'no2')).toBe(0);
    expect(ocean.bodyId).toBe('planet');
  });

  it('добавление и изъятие вещества', () => {
    let atm = setMaterialInventory(createReservoir('atm', 'atmosphere'), 'column_amount', { co2: 10 });
    atm = addMaterial(atm, 'co2', 5);
    expect(getAmount(atm, 'co2')).toBe(15);
    atm = removeMaterial(atm, 'co2', 15);
    expect(getAmount(atm, 'co2')).toBe(0);
  });

  it('отрицательный запас невозможен: изъятие больше имеющегося — ошибка', () => {
    let atm = setMaterialInventory(createReservoir('atm', 'atmosphere'), 'amount', { co2: 3 });
    try {
      atm = removeMaterial(atm, 'co2', 10);
      expect.unreachable('изъятие должно быть отклонено');
    } catch (e) {
      const err = e as ReservoirError;
      expect(err).toBeInstanceOf(ReservoirError);
      expect(err.code).toBe('insufficient_amount');
    }
    // состояние не изменилось: запас остался 3
    expect(getAmount(atm, 'co2')).toBe(3);
  });

  it('операции иммутабельны: исходный резервуар не изменяется', () => {
    const before = setMaterialInventory(createReservoir('ice', 'ice'), 'mass', { h2o: 50 });
    const after = addMaterial(before, 'h2o', 25);
    expect(getAmount(before, 'h2o')).toBe(50);
    expect(getAmount(after, 'h2o')).toBe(75);
  });

  it('basis явен и не смешивается: замена основания — ошибка basis_mismatch', () => {
    let mantle = setMaterialInventory(createReservoir('mantle', 'mantle'), 'mass', { silicate: 1e23 });
    expect(() => setMaterialInventory(mantle, 'amount', { silicate: 1e26 })).toThrowError(ReservoirError);
    try {
      mantle = setMaterialInventory(mantle, 'amount', {});
      expect.unreachable('замена основания должна быть отклонена');
    } catch (e) {
      expect((e as ReservoirError).code).toBe('basis_mismatch');
    }
    expect(mantle.material?.basis).toBe('mass');
  });

  it('добавление требует заданного инвентаря (unknown_basis)', () => {
    const empty = createReservoir('crust', 'crust');
    try {
      addMaterial(empty, 'si', 1);
      expect.unreachable('должна быть ошибка');
    } catch (e) {
      expect((e as ReservoirError).code).toBe('unknown_basis');
    }
  });

  it('нефизические количества в инвентаре отвергаются', () => {
    expect(validateMaterialInventory({ basis: 'amount', entries: { co2: -1 } }).valid).toBe(false);
    expect(validateMaterialInventory({ basis: 'amount', entries: { co2: Number.NaN } }).valid).toBe(false);
    expect(validateMaterialInventory({ basis: 'amount', entries: { co2: 0 } }).valid).toBe(true);
    expect(() => setMaterialInventory(createReservoir('r', 'test'), 'amount', { co2: -5 })).toThrow(ReservoirError);
    expect(() => addMaterial(setMaterialInventory(createReservoir('r2', 'test'), 'amount', {}), 'x', -1)).toThrow(ReservoirError);
  });

  it('игровые единицы честно помечены и несовместимы с физическими', () => {
    const game = setMaterialInventory(createReservoir('game-atm', 'atmosphere'), 'arbitrary_units', { ch4: 40 });
    expect(game.material?.basis).toBe('arbitrary_units');
    // произвольные единицы — не «моль» и не «кг»: никакого автоматического перевода
    expect(() => setMaterialInventory(game, 'amount', { ch4: 40 })).toThrowError(/basis_mismatch/);
  });
});

describe('Stage 4.1 Reservoir: научные характеристики', () => {
  it('характеристики — ScientificValue: неизвестная температура не становится числом', () => {
    let ocean = createReservoir('ocean', 'ocean');
    ocean = setProperty(ocean, 'temperature', unknownValue('температура океана не измерена'));
    ocean = setProperty(ocean, 'pressure', knownValue(quantity(1e5, 'Pa')));
    const temp = getProperty(ocean, 'temperature');
    expect(temp).not.toBeNull();
    expect(quantityOrNull(temp!)).toBeNull();
    const pressure = getProperty(ocean, 'pressure');
    expect(quantityOrNull(pressure!)?.value).toBe(1e5);
    expect(getProperty(ocean, 'volume')).toBeNull();
  });
});

describe('Stage 4.1 Reservoir: энергетический инвентарь', () => {
  it('энергия, мощность и поток — отдельные поля; null означает неизвестность', () => {
    let mantle = createReservoir('mantle', 'mantle');
    mantle = setEnergyInventory(mantle, {
      storedJ: null,          // запас неизвестен — НЕ ноль
      netPowerW: 1e13,        // мощность задана
      fluxW_m2: 0.05          // плотность потока — третья величина
    });
    expect(mantle.energy?.storedJ).toBeNull();
    expect(mantle.energy?.netPowerW).toBe(1e13);
    expect(mantle.energy?.fluxW_m2).toBe(0.05);
  });

  it('NaN в энергетических полях отвергается', () => {
    const mantle = createReservoir('mantle', 'mantle');
    expect(() => setEnergyInventory(mantle, { storedJ: Number.NaN, netPowerW: null, fluxW_m2: null })).toThrow(ReservoirError);
  });
});

describe('Stage 4.1 Reservoir: явные преобразования количества и массы', () => {
  it('моль → кг требует молярной массы и выполняется явно', () => {
    const mass = amountToMass(quantity(2, 'mol'), 0.018);
    expect(mass.value).toBeCloseTo(0.036, 12);
    expect(mass.unit).toBe('kg');
  });

  it('кг → моль: обратное преобразование восстанавливает значение', () => {
    const amount = massToAmount(amountToMass(quantity(3, 'mol'), 0.044), 0.044);
    expect(amount.value).toBeCloseTo(3, 9);
    expect(amount.unit).toBe('mol');
  });

  it('неверная размерность на входе отвергается', () => {
    expect(() => amountToMass(quantity(1, 'kg'), 0.018)).toThrow(QuantityError);
    expect(() => massToAmount(quantity(1, 'K'), 0.018)).toThrow(QuantityError);
  });

  it('молярная масса должна быть положительной', () => {
    expect(() => amountToMass(quantity(1, 'mol'), 0)).toThrow();
    expect(() => amountToMass(quantity(1, 'mol'), -0.01)).toThrow();
    expect(() => massToAmount(quantity(1, 'kg'), Number.NaN)).toThrow();
  });
});

describe('Stage 4.1.1 Reservoir: регрессия массовых преобразований (ISSUE 1)', () => {
  it('1000 г воды / 0.018 кг/моль = 55.5555... моль (до исправления делились сырые граммы)', () => {
    // Регрессия Issue 1: старый massToAmount делил сырое число (1000)
    // на 0.018 и получал 55555.6 «моль» — в 1000 раз больше
    // физического значения. Значение обязано переводиться в кг ДО деления.
    const amount = massToAmount(quantity(1000, 'g'), 0.018);
    expect(amount.value).toBeCloseTo(55.5555555556, 8);
    expect(amount.unit).toBe('mol');
  });

  it('1 кг воды / 0.018 кг/моль = 55.5555... моль', () => {
    const amount = massToAmount(quantity(1, 'kg'), 0.018);
    expect(amount.value).toBeCloseTo(55.5555555556, 8);
    expect(amount.unit).toBe('mol');
  });

  it('18 г воды = 1 моль; 18 кг воды = 1000 моль', () => {
    expect(massToAmount(quantity(18, 'g'), 0.018).value).toBeCloseTo(1, 12);
    expect(massToAmount(quantity(18, 'kg'), 0.018).value).toBeCloseTo(1000, 9);
  });

  it('обратное преобразование: 0.044 кг CO2 = 1 моль CO2', () => {
    const amount = massToAmount(quantity(0.044, 'kg'), 0.044);
    expect(amount.value).toBeCloseTo(1, 12);
    expect(amount.unit).toBe('mol');
    const back = amountToMass(amount, 0.044);
    expect(back.value).toBeCloseTo(0.044, 12);
    expect(back.unit).toBe('kg');
  });

  it('разные молярные массы дают физически разные результаты', () => {
    // 100 кг вещества: при 0.018 кг/моль (вода) и 0.044 кг/моль (CO2)
    expect(massToAmount(quantity(100, 'kg'), 0.018).value).toBeCloseTo(5555.5555555556, 8);
    expect(massToAmount(quantity(100, 'kg'), 0.044).value).toBeCloseTo(2272.7272727273, 8);
  });

  it('переполнение результата диагностируется QuantityError overflow', () => {
    // 1 кг / 1e-320 кг/моль непредставимо в double
    try {
      massToAmount(quantity(1, 'kg'), 1e-320);
      expect.unreachable('переполнение должно быть обнаружено');
    } catch (e) {
      expect(e).toBeInstanceOf(QuantityError);
      expect((e as QuantityError).code).toBe('overflow');
    }
    try {
      amountToMass(quantity(1e308, 'mol'), 10);
      expect.unreachable('переполнение должно быть обнаружено');
    } catch (e) {
      expect(e).toBeInstanceOf(QuantityError);
      expect((e as QuantityError).code).toBe('overflow');
    }
  });

  it('некорректная молярная масса (0, отрицательная, бесконечность) — QuantityError', () => {
    expect(() => massToAmount(quantity(1, 'kg'), 0)).toThrow(QuantityError);
    expect(() => massToAmount(quantity(1, 'kg'), -0.044)).toThrow(QuantityError);
    expect(() => massToAmount(quantity(1, 'kg'), Number.POSITIVE_INFINITY)).toThrow(QuantityError);
    expect(() => amountToMass(quantity(1, 'mol'), Number.NaN)).toThrow(QuantityError);
  });
});

describe('Stage 4.1.1 Reservoir: валидация энергетического инвентаря и записи', () => {
  it('validateEnergyInventory: storedJ null допустим, NaN и отрицательный запас — нет', () => {
    expect(validateEnergyInventory({ storedJ: null, netPowerW: null, fluxW_m2: null }).valid).toBe(true);
    expect(validateEnergyInventory({ storedJ: Number.NaN, netPowerW: null, fluxW_m2: null }).valid).toBe(false);
    expect(validateEnergyInventory({ storedJ: -5, netPowerW: null, fluxW_m2: null }).valid).toBe(false);
  });

  it('validateEnergyInventory: мощность и поток могут быть отрицательными (потеря энергии)', () => {
    expect(validateEnergyInventory({ storedJ: 100, netPowerW: -50, fluxW_m2: -200 }).valid).toBe(true);
    expect(validateEnergyInventory({ storedJ: 100, netPowerW: Number.POSITIVE_INFINITY, fluxW_m2: null }).valid).toBe(false);
  });

  it('setEnergyInventory отвергает отрицательный запас энергии', () => {
    const res = createReservoir('r', 'test');
    try {
      setEnergyInventory(res, { storedJ: -1, netPowerW: null, fluxW_m2: null });
      expect.unreachable('отрицательный запас должен быть отклонён');
    } catch (e) {
      expect((e as ReservoirError).code).toBe('invalid_amount');
    }
  });

  it('validateReservoirRecord принимает корректную запись', () => {
    const res = setMaterialInventory(createReservoir('ocean', 'ocean'), 'amount', { h2o: 10 });
    const check = validateReservoirRecord(res);
    expect(check.valid).toBe(true);
    expect(check.errors).toEqual([]);
  });

  it('validateReservoirRecord: пустой id/kind, отрицательный инвентарь, NaN storedJ', () => {
    expect(validateReservoirRecord({ id: '', kind: 'ocean', properties: {} }).valid).toBe(false);
    expect(validateReservoirRecord({ id: 'x', kind: '', properties: {} }).valid).toBe(false);
    expect(
      validateReservoirRecord({ id: 'x', kind: 'ocean', material: { basis: 'amount', entries: { h2o: -1 } }, properties: {} }).valid
    ).toBe(false);
    expect(
      validateReservoirRecord({ id: 'x', kind: 'ocean', energy: { storedJ: Number.NaN, netPowerW: null, fluxW_m2: null }, properties: {} }).valid
    ).toBe(false);
  });

  it('validateReservoirRecord: неизвестное основание инвентаря — ошибка', () => {
    const check = validateReservoirRecord({ id: 'x', kind: 'ocean', material: { basis: 'quarts', entries: {} }, properties: {} });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('основание'))).toBe(true);
  });

  it('validateReservoirRecord: storedJ null проходит (энергия неизвестна — не ошибка)', () => {
    const check = validateReservoirRecord({ id: 'x', kind: 'ocean', energy: { storedJ: null, netPowerW: null, fluxW_m2: null }, properties: {} });
    expect(check.valid).toBe(true);
  });

  it('validateReservoirRecord: scientific-свойства проверяются по форме', () => {
    const good = validateReservoirRecord({
      id: 'x', kind: 'ocean', properties: { temperature: { status: 'known', quantity: { value: 300, unit: 'K' } } }
    });
    expect(good.valid).toBe(true);
    // known без quantity — нарушение формы
    const bad = validateReservoirRecord({
      id: 'x', kind: 'ocean', properties: { temperature: { status: 'known' } as unknown as never }
    });
    expect(bad.valid).toBe(false);
    const badStatus = validateReservoirRecord({
      id: 'x', kind: 'ocean', properties: { temperature: { status: 'magic' } as unknown as never }
    });
    expect(badStatus.valid).toBe(false);
    const estimatedNoMethod = validateReservoirRecord({
      id: 'x', kind: 'ocean',
      properties: { temperature: { status: 'estimated', quantity: { value: 300, unit: 'K' } } as unknown as never }
    });
    expect(estimatedNoMethod.valid).toBe(false);
  });
});


// ============================================
// STAGE 4.1.1.2 — RESERVOIR: ОБЯЗАТЕЛЬНОСТЬ properties И ЯВНАЯ НЕПРИМЕНИМОСТЬ
// ============================================

describe('Stage 4.1.1.2 Reservoir: обязательность properties и явная неприменимость материи', () => {
  it('properties обязательны: отсутствие поля — ошибка, пустой объект — валиден', () => {
    const missing = validateReservoirRecord({ id: 'x', kind: 'ocean' });
    expect(missing.valid).toBe(false);
    expect(missing.errors.some((e) => e.includes('properties'))).toBe(true);
    const empty = validateReservoirRecord({ id: 'x', kind: 'ocean', properties: {} });
    expect(empty.valid).toBe(true);
    expect(empty.errors).toEqual([]);
  });

  it('materialApplicability not_applicable без material — валидная запись', () => {
    const check = validateReservoirRecord({ id: 'x', kind: 'buffer', properties: {}, materialApplicability: 'not_applicable' });
    expect(check.valid).toBe(true);
    expect(check.errors).toEqual([]);
  });

  it('конфликт material + not_applicable и мусорное значение маркера — ошибки', () => {
    const conflict = validateReservoirRecord({
      id: 'x', kind: 'buffer', properties: {}, materialApplicability: 'not_applicable',
      material: { basis: 'amount', entries: {} }
    });
    expect(conflict.valid).toBe(false);
    expect(conflict.errors.some((e) => e.includes('противоречат'))).toBe(true);
    const junk = validateReservoirRecord({ id: 'x', kind: 'buffer', properties: {}, materialApplicability: 'sometimes' });
    expect(junk.valid).toBe(false);
    expect(junk.errors.some((e) => e.includes('materialApplicability'))).toBe(true);
  });
});

// ============================================
// STAGE 4.1.1.3 — СЛОВАРИ, А НЕ МАССИВЫ (ISSUE B)
// ============================================

describe('Stage 4.1.1.3 Reservoir: словари — не массивы (ISSUE B)', () => {
  it('properties: [] — невалидная запись (массив не словарь)', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: [] });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('properties'))).toBe(true);
    expect(check.errors.some((e) => e.includes('массив'))).toBe(true);
  });

  it('properties: {} — валидная запись', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {} });
    expect(check.valid).toBe(true);
    expect(check.errors).toEqual([]);
  });

  it('material.entries: [] — невалидная запись (пустой массив ≠ известная пустота)', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: [] } });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('material.entries'))).toBe(true);
  });

  it('material.entries: {} — валидная запись (известный пустой инвентарь)', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: {} } });
    expect(check.valid).toBe(true);
    expect(check.errors).toEqual([]);
  });

  it('массив числовых значений не принимается как species-словарь', () => {
    const record = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: [5, 10] } });
    expect(record.valid).toBe(false);
    expect(record.errors.some((e) => e.includes('material.entries'))).toBe(true);
    const direct = validateMaterialInventory({ basis: 'amount', entries: [5, 10] } as unknown as never);
    expect(direct.valid).toBe(false);
  });

  it('известный ноль { co2: 0 } остаётся валидным', () => {
    const record = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: { co2: 0 } } });
    expect(record.valid).toBe(true);
    const direct = validateMaterialInventory({ basis: 'amount', entries: { co2: 0 } });
    expect(direct.valid).toBe(true);
  });

  it('корректный словарь { co2: 5, h2o: 10 } остаётся валидным', () => {
    const record = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: { co2: 5, h2o: 10 } } });
    expect(record.valid).toBe(true);
    const direct = validateMaterialInventory({ basis: 'amount', entries: { co2: 5, h2o: 10 } });
    expect(direct.valid).toBe(true);
  });

  it('validateMaterialInventory: entries = null и entries = [] — невалидны, {} — валиден', () => {
    expect(validateMaterialInventory({ basis: 'amount', entries: null } as unknown as never).valid).toBe(false);
    expect(validateMaterialInventory({ basis: 'amount', entries: [] } as unknown as never).valid).toBe(false);
    expect(validateMaterialInventory({ basis: 'amount', entries: {} }).valid).toBe(true);
  });

  it('setMaterialInventory отвергает массив entries с ReservoirError', () => {
    expect(() => setMaterialInventory(createReservoir('r', 'test'), 'amount', [] as unknown as Record<string, number>)).toThrow(ReservoirError);
  });

  it('material: [] и energy: [] — невалидные записи', () => {
    const material = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: [] });
    expect(material.valid).toBe(false);
    const energy = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, energy: [] });
    expect(energy.valid).toBe(false);
  });
});


// ============================================
// STAGE 4.1.1.3.1 — СТРОГАЯ ПРОВЕРКА ОБЪЕКТОВ-ЗАПИСЕЙ
// ============================================

/** Псевдо-словарь: typeof 'object', но прототип — не объектная запись. */
class PseudoInventory {
  co2 = 5;
  h2o = 10;
}

describe('Stage 4.1.1.3.1 Reservoir: строгая проверка объектов-записей (isPlainRecord)', () => {
  it('isPlainRecord принимает настоящие записи: {}, именованные ключи, Object.create(null)', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord({ co2: 5, h2o: 10 })).toBe(true);
    const nullProto = Object.create(null);
    nullProto.co2 = 5;
    expect(isPlainRecord(nullProto)).toBe(true);
  });

  it('isPlainRecord отвергает массивы, Map, Set, Date, RegExp, классы и прочие прототипы', () => {
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord([5, 10])).toBe(false);
    expect(isPlainRecord(new Map())).toBe(false);
    expect(isPlainRecord(new Map([['co2', 5]]))).toBe(false);
    expect(isPlainRecord(new Set())).toBe(false);
    expect(isPlainRecord(new Date())).toBe(false);
    expect(isPlainRecord(/pattern/)).toBe(false);
    expect(isPlainRecord(new PseudoInventory())).toBe(false);
    expect(isPlainRecord(Object.create({}))).toBe(false);
    expect(isPlainRecord('dict')).toBe(false);
    expect(isPlainRecord(42)).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord(undefined)).toBe(false);
  });

  it('properties: new Map() — невалидная запись (Map не словарь характеристик)', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: new Map() });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('properties') && e.includes('Map'))).toBe(true);
  });

  it('material.entries: new Map с данными — невалидная запись (не известный инвентарь)', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: new Map([['co2', 5]]) } });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('material.entries') && e.includes('Map'))).toBe(true);
  });

  it('material.entries: new Set() — невалидная запись (пустой Set ≠ известная пустота)', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: new Set() } });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('material.entries') && e.includes('Set'))).toBe(true);
  });

  it('material.entries: new Date() — невалидная запись', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: new Date() } });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('material.entries') && e.includes('Date'))).toBe(true);
  });

  it('material.entries — экземпляр пользовательского класса: невалидная запись', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: new PseudoInventory() } });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('material.entries') && e.includes('PseudoInventory'))).toBe(true);
  });

  it('validateMaterialInventory отвергает Map/Set/Date/RegExp/класс напрямую', () => {
    expect(validateMaterialInventory({ basis: 'amount', entries: new Map([['co2', 5]]) } as unknown as never).valid).toBe(false);
    expect(validateMaterialInventory({ basis: 'amount', entries: new Set() } as unknown as never).valid).toBe(false);
    expect(validateMaterialInventory({ basis: 'amount', entries: new Date() } as unknown as never).valid).toBe(false);
    expect(validateMaterialInventory({ basis: 'amount', entries: /pattern/ } as unknown as never).valid).toBe(false);
    expect(validateMaterialInventory({ basis: 'amount', entries: new PseudoInventory() } as unknown as never).valid).toBe(false);
  });

  it('setMaterialInventory отвергает Map-структуру с ReservoirError', () => {
    expect(() =>
      setMaterialInventory(createReservoir('r', 'test'), 'amount', new Map([['co2', 5]]) as unknown as Record<string, number>)
    ).toThrow(ReservoirError);
  });

  it('properties: {} и material.entries: {} — валидные записи (известная пустота сохранена)', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: {} } });
    expect(check.valid).toBe(true);
    expect(check.errors).toEqual([]);
  });

  it('material.entries: Object.create(null) с корректными ключами — валидная запись', () => {
    const nullProto: Record<string, number> = Object.create(null);
    nullProto.co2 = 5;
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: nullProto } });
    expect(check.valid).toBe(true);
    expect(check.errors).toEqual([]);
    expect(validateMaterialInventory({ basis: 'amount', entries: nullProto }).valid).toBe(true);
  });

  it('известный ноль { co2: 0 } остаётся валидным (семантика известности не изменилась)', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, material: { basis: 'amount', entries: { co2: 0 } } });
    expect(check.valid).toBe(true);
    expect(validateMaterialInventory({ basis: 'amount', entries: { co2: 0 } }).valid).toBe(true);
  });

  it('energy: new Map() — невалидная запись', () => {
    const check = validateReservoirRecord({ id: 'r1', kind: 'ocean', properties: {}, energy: new Map() });
    expect(check.valid).toBe(false);
    expect(check.errors.some((e) => e.includes('energy'))).toBe(true);
  });
});
