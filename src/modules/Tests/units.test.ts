// ============================================
// TESTS - Units module (этап 3: система единиц SI)
// ============================================

import { describe, it, expect } from 'vitest';
import {
  ATM_TO_PA,
  BAR_TO_PA,
  M_EARTH_KG,
  R_EARTH_M,
  G_EARTH_MS2,
  M_SUN_KG,
  L_SUN_W,
  AU_M,
  atmToPa,
  paToAtm,
  barToPa,
  paToBar,
  earthMassesToKg,
  kgToEarthMasses,
  earthRadiiToM,
  mToEarthRadii,
  ms2ToG,
  auToM,
  secondsToYears
} from '../Units';

describe('Units Module (система единиц, этап 3)', () => {
  describe('константы перевода давления', () => {
    it('1 atm = 101325 Pa (точно)', () => {
      expect(ATM_TO_PA).toBe(101325);
      expect(atmToPa(1)).toBe(101325);
    });

    it('1 bar = 100000 Pa (точно)', () => {
      expect(BAR_TO_PA).toBe(1e5);
      expect(barToPa(1)).toBe(1e5);
    });

    it('atm и bar НЕ смешиваются незаметно: 1 atm ≠ 1 bar', () => {
      // Разница между atm и bar составляет ~1.325%: смешение единиц
      // недопустимо.
      expect(atmToPa(1)).not.toBe(barToPa(1));
      expect(atmToPa(1) / barToPa(1)).toBeCloseTo(1.01325, 5);
    });

    it('обратное преобразование atmToPa/paToAtm восстанавливает значение', () => {
      for (const atm of [0.006, 1, 1.4804, 1.5, 92, 100]) {
        expect(paToAtm(atmToPa(atm))).toBeCloseTo(atm, 10);
      }
    });

    it('обратное преобразование barToPa/paToBar восстанавливает значение', () => {
      for (const bar of [0.01, 0.1, 1.5, 92, 500]) {
        expect(paToBar(barToPa(bar))).toBeCloseTo(bar, 10);
      }
    });

    it('справочное давление Титана: 1.4804 atm ≈ 1.5 bar', () => {
      // Пресет titan_reference хранит 1.4804 atm = 1.5 bar поверхности.
      expect(paToBar(atmToPa(1.4804))).toBeCloseTo(1.5, 3);
    });

    it('легаси-миграция: давление 92 atm Венеры переводится в Па без потерь', () => {
      expect(atmToPa(92)).toBeCloseTo(92 * 101325, 6);
    });
  });

  describe('астрономические и планетные единицы', () => {
    it('масса Земли: прямое и обратное преобразование', () => {
      expect(M_EARTH_KG).toBe(5.9722e24);
      expect(earthMassesToKg(1)).toBeCloseTo(M_EARTH_KG, 10);
      expect(kgToEarthMasses(M_EARTH_KG)).toBeCloseTo(1, 10);
      expect(kgToEarthMasses(earthMassesToKg(3.7))).toBeCloseTo(3.7, 10);
    });

    it('радиус Земли: прямое и обратное преобразование', () => {
      expect(R_EARTH_M).toBe(6.371e6);
      expect(earthRadiiToM(1)).toBeCloseTo(R_EARTH_M, 6);
      expect(mToEarthRadii(R_EARTH_M)).toBeCloseTo(1, 10);
    });

    it('земная гравитация: перевод между м/с² и g', () => {
      expect(G_EARTH_MS2).toBe(9.80665);
      expect(ms2ToG(9.80665)).toBeCloseTo(1, 10);
      expect(ms2ToG(19.6133)).toBeCloseTo(2, 10);
    });

    it('астрономическая единица: прямое и обратное преобразование', () => {
      expect(AU_M).toBeCloseTo(1.495978707e11, 0);
      expect(auToM(1)).toBeCloseTo(AU_M, 0);
    });

    it('светимость и масса Солнца — справочные значения', () => {
      expect(M_SUN_KG).toBe(1.989e30);
      expect(L_SUN_W).toBe(3.828e26);
    });

    it('секунды переводятся в годы явно (без скрытого смешения)', () => {
      expect(secondsToYears(3.15576e7)).toBeCloseTo(1, 5);
      expect(secondsToYears(3.15576e13)).toBeCloseTo(1e6, 0);
    });
  });

  describe('согласованность расчётных формул через единицы', () => {
    it('ускорение свободного падения g = G·M/R² для Земли даёт ~9.82 м/с²', () => {
      // Проверка согласованности единиц: масса в кг, радиус в м.
      const G = 6.67430e-11;
      const g = (G * M_EARTH_KG) / (R_EARTH_M * R_EARTH_M);
      expect(g).toBeGreaterThan(9.8);
      expect(g).toBeLessThan(9.84);
    });

    it('атмосферный столб Земли m = P/g ≈ 10332 кг/м²', () => {
      const columnMass = atmToPa(1) / G_EARTH_MS2;
      expect(columnMass).toBeCloseTo(10332.3, 0);
    });
  });
});
