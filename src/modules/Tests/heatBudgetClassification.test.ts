// ============================================
// ТЕСТЫ — Адаптер классификации теплового бюджета (Stage 4.7.3, Часть D)
// ============================================
// Правила честности Части D:
//  - без явных порогов => not_classified (никаких выдуманных уровней);
//  - без базы нормировки (масса/объём) => not_classified;
//  - пороги с provenance и ЯВНОЙ нормировкой W/kg или W/m^3;
//  - значение выше верхней границы шкалы => not_classified, а не «high».

import { describe, it, expect } from 'vitest';
import { classifyHeatBudgetByThresholds } from '../Core/heatBudgetClassification';

const THRESHOLD_PROVENANCE = 'тестовые пороги (синтетическая калибровка, указана явно)';

function thresholds() {
  return [
    { maxSpecificPower: 1e-12, level: 'low' as const, provenance: THRESHOLD_PROVENANCE },
    { maxSpecificPower: 1e-10, level: 'moderate' as const, provenance: THRESHOLD_PROVENANCE },
    { maxSpecificPower: 1e-8, level: 'high' as const, provenance: THRESHOLD_PROVENANCE }
  ];
}

describe('HeatBudgetClassification: честность классификации', () => {
  it('D1. Без порогов => not_classified, никаких выдуманных low/moderate/high', () => {
    const res = classifyHeatBudgetByThresholds({
      powerW: 1e12, massKg: 4e24, thresholds: null, basis: 'per_mass'
    });
    expect(res.status).toBe('not_classified');
    if (res.status === 'not_classified') expect(res.reason).toContain('не заданы');
  });

  it('D2. Без базы нормировки => not_classified', () => {
    const res = classifyHeatBudgetByThresholds({
      powerW: 1e12, massKg: undefined, thresholds: thresholds(), basis: 'per_mass'
    });
    expect(res.status).toBe('not_classified');
    const res2 = classifyHeatBudgetByThresholds({
      powerW: 1e12, volumeM3: NaN, thresholds: thresholds(), basis: 'per_volume'
    });
    expect(res2.status).toBe('not_classified');
  });

  it('D3. Явные пороги + база W/kg дают уровень с provenance', () => {
    const res = classifyHeatBudgetByThresholds({
      powerW: 20e12, massKg: 4e24, thresholds: thresholds(), basis: 'per_mass', subjectId: 'bse'
    });
    expect(res.status).toBe('classified');
    if (res.status === 'classified') {
      expect(res.unitBasis).toBe('W/kg');
      expect(res.level).toBe('moderate'); // 5e-12 W/kg: между 1e-12 и 1e-10
      expect(res.provenance.every((p) => p.includes(THRESHOLD_PROVENANCE))).toBe(true);
      expect(res.subjectId).toBe('bse');
    }
  });

  it('D4. Нормировка per_volume отличима от per_mass', () => {
    const res = classifyHeatBudgetByThresholds({
      // 5e10 / 1e22 = 5e-12 W/m^3 — в пределах шкалы порогов (moderate:
      // между 1e-12 и 1e-10; значение обязано лежать НИЖЕ верхней границы
      // самой сильной категории per-volume, иначе not_classified)
      powerW: 5e10, volumeM3: 1e22, thresholds: thresholds(), basis: 'per_volume'
    });
    expect(res.status).toBe('classified');
    if (res.status === 'classified') {
      expect(res.unitBasis).toBe('W/m^3');
      expect(res.level).toBe('moderate');
    }
  });

  it('D5. Значение выше шкалы порогов => not_classified, а не «high»', () => {
    const res = classifyHeatBudgetByThresholds({
      powerW: 1e20, massKg: 1, thresholds: thresholds(), basis: 'per_mass'
    });
    expect(res.status).toBe('not_classified');
    if (res.status === 'not_classified') expect(res.reason).toContain('не покрывает');
  });

  it('D6. Не-конечная мощность => not_classified', () => {
    for (const bad of [NaN, Infinity, -Infinity] as number[]) {
      const res = classifyHeatBudgetByThresholds({
        powerW: bad, massKg: 4e24, thresholds: thresholds(), basis: 'per_mass'
      });
      expect(res.status).toBe('not_classified');
    }
  });
});
