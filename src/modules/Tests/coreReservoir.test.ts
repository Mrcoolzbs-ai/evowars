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
