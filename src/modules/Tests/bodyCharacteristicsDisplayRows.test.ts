// ============================================
// STAGE 4.2.4 - Тесты view-model характеристик тела для UI
// ============================================
//
// bodyCharacteristicsDisplayRows — единый канонический путь
// отображения характеристик тела: PhysValue → ScientificValue →
// строка по статусу. Неизвестные величины НЕ превращаются в ноль,
// легаси-значения помечаются как legacy-оценки, плотность старых
// сохранений задним числом не вычисляется.

import { describe, it, expect } from 'vitest';
import { bodyCharacteristicsDisplayRows } from '../Core/adapters';
import type { BodyPhysicalSample, PhysValue } from '../../types/physics';

function pv(value: number | null, unit: string, confidence: PhysValue['confidence'], extra?: Partial<PhysValue>): PhysValue {
  return { value, unit, confidence, ...extra };
}

function bodyPhysics(overrides: Partial<Record<'massKg' | 'radiusM' | 'densityKgM3' | 'surfaceGravityMs2', PhysValue>> = {}): BodyPhysicalSample {
  return {
    massKg: pv(5.972e24, 'кг', 'estimated', { method: 'сэмплирование из диапазона' }),
    radiusM: pv(6.371e6, 'м', 'estimated', { method: 'сэмплирование из диапазона' }),
    densityKgM3: pv(5514, 'кг/м³', 'derived', { formula: 'M/(4/3·π·R³)' }),
    surfaceGravityMs2: pv(9.81, 'м/с²', 'derived', { formula: 'g = G·M/R²' }),
    surfaceGravityInG: pv(1, 'g', 'derived', { formula: 'g/9.81' }),
    consistencyCheck: { plausible: true, densityRangeKgM3: { min: 5000, max: 6000 }, note: 'тест' },
    samplingMethod: 'тест',
    notes: [],
    ...overrides
  };
}

describe('Stage 4.2.4: bodyCharacteristicsDisplayRows — канонический путь отображения', () => {
  it('known/estimated значения показываются числом с единицей и меткой статуса', () => {
    const rows = bodyCharacteristicsDisplayRows({ bodyPhysics: bodyPhysics() });
    expect(rows.map((r) => r.key)).toEqual(['mass', 'radius', 'density', 'surfaceGravity']);
    for (const row of rows) {
      expect(row.status === 'known' || row.status === 'estimated').toBe(true);
      expect(row.display).toMatch(/\d\.\d{3}e\+\d+ /);
      expect(row.display).toContain('[');
      expect(row.display).not.toContain('legacy');
      expect(row.note).toBe('');
    }
    const mass = rows.find((r) => r.key === 'mass')!;
    expect(mass.display).toContain('kg');
    expect(mass.display).toContain('оценка');
    const density = rows.find((r) => r.key === 'density')!;
    expect(density.display).toContain('kg_m3');
    expect(density.display).toContain('установлено');
  });

  it('unknown значение (value = null) НЕ превращается в число или ноль', () => {
    const rows = bodyCharacteristicsDisplayRows({
      bodyPhysics: bodyPhysics({ massKg: pv(null, 'кг', 'unknown', { note: 'данных недостаточно' }) })
    });
    const mass = rows.find((r) => r.key === 'mass')!;
    expect(mass.status).toBe('unknown');
    expect(mass.display).toContain('неизвестно');
    expect(mass.display).not.toMatch(/\d/);
    expect(mass.note).toContain('данных недостаточно');
  });

  it('invalid значение (незарегистрированная единица) отображается текстом статуса без числа', () => {
    const rows = bodyCharacteristicsDisplayRows({
      bodyPhysics: bodyPhysics({ radiusM: pv(123, 'furlong', 'estimated', { method: 'тест' }) })
    });
    const radius = rows.find((r) => r.key === 'radius')!;
    expect(radius.status).toBe('invalid');
    expect(radius.display).toContain('непригодно');
    expect(radius.display).toContain('furlong');
    expect(radius.display).not.toMatch(/1\.23/);
  });

  it('легаси-значения без bodyPhysics помечаются как legacy-оценки, плотность — неизвестна', () => {
    const rows = bodyCharacteristicsDisplayRows({
      physicalCharacteristics: { mass: 0.8, radius: 1.1, surfaceGravity: 0.9 }
    });
    const mass = rows.find((r) => r.key === 'mass')!;
    expect(mass.status).toBe('estimated');
    expect(mass.display).toContain('0.8 масс Земли');
    expect(mass.display).toContain('legacy-оценка старого сохранения');
    const radius = rows.find((r) => r.key === 'radius')!;
    expect(radius.display).toContain('1.1 радиусов Земли');
    const gravity = rows.find((r) => r.key === 'surfaceGravity')!;
    expect(gravity.display).toContain('0.9 g');
    const density = rows.find((r) => r.key === 'density')!;
    expect(density.status).toBe('unknown');
    expect(density.display).toContain('неизвестно');
    expect(density.display).not.toMatch(/[1-9]/);
    expect(density.note).toContain('не вычисляется задним числом');
  });

  it('отсутствие и bodyPhysics, и легаси-значений: все строки неизвестны, нулей нет', () => {
    const rows = bodyCharacteristicsDisplayRows({ physicalCharacteristics: {} });
    for (const row of rows) {
      expect(row.status).toBe('unknown');
      expect(row.display).toContain('неизвестно');
      expect(row.display).not.toMatch(/[1-9]/);
    }
    const mass = rows.find((r) => r.key === 'mass')!;
    expect(mass.note).toContain('значение отсутствует');
  });

  it('ни одна ветвь не выдаёт подставленный ноль вместо неизвестного значения', () => {
    const variants = [
      bodyCharacteristicsDisplayRows({}),
      bodyCharacteristicsDisplayRows({ physicalCharacteristics: null }),
      bodyCharacteristicsDisplayRows({ bodyPhysics: bodyPhysics({ massKg: pv(null, 'кг', 'unknown') }) })
    ];
    for (const rows of variants) {
      for (const row of rows) {
        expect(row.display.trim()).not.toBe('0');
        expect(row.display).not.toBe('0.000e+0');
      }
    }
  });
});
