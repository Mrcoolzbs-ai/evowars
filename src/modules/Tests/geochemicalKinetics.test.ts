// ============================================
// ТЕСТЫ Stage 4.9g: контракты кинетических записей геохимических
// процессов и планировщик extent (Core/geochemicalKinetics.ts)
// ============================================
//
// ВСЕ ЧИСЛОВЫЕ ЗНАЧЕНИЯ СКОРОСТЕЙ В ЭТОМ ФАЙЛЕ — synthetic test fixture:
// они проверяют КОНТРАКТЫ (fail-closed валидацию, арифметику extent,
// цепочку provenance, честное поведение unknown), а НЕ физику процессов.
// Production-каталог (geochemicalProcessCatalog.ts) остаётся с
// rate: unknown для всех процессов; синтетические скорости в
// production-данные не попадают.

import { describe, it, expect } from 'vitest';

import {
  GEOCHEMICAL_KINETIC_RATE_UNIT,
  GeochemicalKineticsError,
  planGeochemicalKineticExtents,
  validateGeochemicalKineticRateRecord,
  type GeochemicalKineticRateRecord,
  type GeochemicalKineticExtentPlan
} from '../Core/geochemicalKinetics';
import { GEOCHEMICAL_YEAR_S } from '../Core/geochemicalFluxes';
import type { DataProvenance } from '../Core/scientificValue';

const FIXTURE_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic test fixture: Stage 4.9g (тестовые числа)',
  sourceId: 'evowars/tests/stage-4.9g/geochemical-kinetics-fixture',
  recordId: 'synthetic-geochemical-kinetics-fixture'
};

const DURATION_PROVENANCE: DataProvenance = {
  sourceName: 'synthetic test fixture: Stage 4.9g (длительность macro-шага задана явно)',
  sourceId: 'evowars/tests/stage-4.9g/duration-fixture',
  recordId: 'synthetic-duration-fixture'
};

function knownRecord(overrides: Partial<GeochemicalKineticRateRecord> = {}): GeochemicalKineticRateRecord {
  return {
    processId: 'test.process.known',
    rateClass: 'constant_zero_order',
    status: 'known',
    rateMolPerM2PerYear: 2.5e-4,
    rateProvenance: FIXTURE_PROVENANCE,
    applicability: 'synthetic test fixture: физическая область применимости источником не подтверждена',
    ...overrides
  };
}

function unknownRecord(overrides: Partial<GeochemicalKineticRateRecord> = {}): GeochemicalKineticRateRecord {
  return {
    processId: 'test.process.unknown',
    rateClass: 'constant_zero_order',
    status: 'unknown',
    unknownReason: 'характеристическая скорость процесса не подтверждена источником (synthetic test fixture-причина)',
    ...overrides
  };
}

function planOf(records: readonly GeochemicalKineticRateRecord[], durationYears: number = 2): GeochemicalKineticExtentPlan {
  return planGeochemicalKineticExtents({ records, durationYears, durationProvenance: DURATION_PROVENANCE });
}

function expectKineticsError(fn: () => unknown, code: string): GeochemicalKineticsError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GeochemicalKineticsError);
    const err = e as GeochemicalKineticsError;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error('ожидался GeochemicalKineticsError(' + code + '), но ошибки не было');
}

// ============================================
// 1. ВАЛИДАЦИЯ KNOWN-ЗАПИСЕЙ
// ============================================

describe('Stage 4.9g кинетика: валидация known-записей', () => {
  it('корректная known-запись проходит валидацию без замечаний', () => {
    expect(validateGeochemicalKineticRateRecord(knownRecord())).toEqual([]);
  });

  it('известная скорость без идентифицированного provenance отклоняется', () => {
    const issues = validateGeochemicalKineticRateRecord(knownRecord({ rateProvenance: {} }));
    expect(issues.some((i) => i.includes('provenance') || i.includes('source'))).toBe(true);
  });

  it('отрицательная, нулевая и нефинитная скорости отклоняются (fail-closed)', () => {
    for (const bad of [-1e-3, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      const issues = validateGeochemicalKineticRateRecord(knownRecord({ rateMolPerM2PerYear: bad }));
      expect(issues.length).toBeGreaterThan(0);
    }
  });

  it('известная скорость без области применимости отклоняется', () => {
    const issues = validateGeochemicalKineticRateRecord(knownRecord({ applicability: undefined }));
    expect(issues.some((i) => i.includes('применимости'))).toBe(true);
  });

  it('unknownReason у известной скорости — противоречие формы', () => {
    const issues = validateGeochemicalKineticRateRecord(knownRecord({ unknownReason: 'не бывает у known' }));
    expect(issues.some((i) => i.includes('unknownReason'))).toBe(true);
  });
});

// ============================================
// 2. ВАЛИДАЦИЯ UNKNOWN-ЗАПИСЕЙ
// ============================================

describe('Stage 4.9g кинетика: валидация unknown-записей', () => {
  it('unknown с конкретной причиной проходит валидацию', () => {
    expect(validateGeochemicalKineticRateRecord(unknownRecord())).toEqual([]);
  });

  it('unknown с числовой скоростью отклоняется: неизвестность не завершается числом', () => {
    const issues = validateGeochemicalKineticRateRecord(unknownRecord({ rateMolPerM2PerYear: 1e-4 }));
    expect(issues.some((i) => i.includes('числовое') || i.includes('rateMolPerM2PerYear'))).toBe(true);
  });

  it('unknown с provenance числовой скорости отклоняется', () => {
    const issues = validateGeochemicalKineticRateRecord(unknownRecord({ rateProvenance: FIXTURE_PROVENANCE }));
    expect(issues.some((i) => i.includes('источник числовой'))).toBe(true);
  });

  it('unknown без причины отклоняется: молчаливая неизвестность запрещена', () => {
    const issues = validateGeochemicalKineticRateRecord(unknownRecord({ unknownReason: undefined }));
    expect(issues.some((i) => i.includes('unknownReason') || i.includes('причину'))).toBe(true);
  });

  it('неизвестный rateClass отклоняется: законы скорости без первоисточников не изображаются', () => {
    const issues = validateGeochemicalKineticRateRecord(unknownRecord({ rateClass: 'empirical_omega' as never }));
    expect(issues.some((i) => i.includes('constant_zero_order') || i.includes('rateClass'))).toBe(true);
  });
});

// ============================================
// 3. ПЛАНИРОВАНИЕ EXTENT
// ============================================

describe('Stage 4.9g кинетика: планирование extent (rate × Δt)', () => {
  it('единица скорости — столбовая mol_m2_yr (та же конвенция каталога Stage 4.9a)', () => {
    expect(GEOCHEMICAL_KINETIC_RATE_UNIT).toBe('mol_m2_yr');
  });

  it('extent = rate × durationYears; durationSeconds = durationYears × юлианский год (та же конверсия, что у Stage 4.9a)', () => {
    const plan = planOf([knownRecord({ rateMolPerM2PerYear: 2.5e-4 })], 2);
    expect(plan.status).toBe('planned');
    expect(plan.durationYears).toBe(2);
    expect(plan.durationSeconds).toBe(2 * GEOCHEMICAL_YEAR_S);
    expect(plan.durationSeconds).toBe(2 * 365.25 * 86400);
    expect(plan.extents.length).toBe(1);
    expect(plan.extents[0].extentMolPerM2).toBeCloseTo(5e-4, 15);
    expect(plan.extents[0].rateMolPerM2PerYear).toBe(2.5e-4);
  });

  it('extentProvenance несёт цепочку: запись расчёта + источник скорости + источник длительности', () => {
    const plan = planOf([knownRecord({ rateMolPerM2PerYear: 1e-6, processId: 'p.a' })], 3);
    const prov = plan.extents[0].extentProvenance as DataProvenance;
    expect(prov).toBeDefined();
    expect(String(prov.sourceName ?? '')).toContain('тестовые числа');    expect(String(prov.note ?? '')).toContain('0.000001');
    expect(String(prov.note ?? '')).toContain('3 yr');
    expect(String(prov.note ?? '')).toContain('длительность с provenance');
    expect(String(prov.recordId ?? '')).toBe('kinetic-extent:p.a');
  });

  it('unknown-процессы попадают в skipped с конкретной причиной и БЕЗ числовых вкладов', () => {
    const plan = planOf([
      knownRecord({ processId: 'p.known' }),
      unknownRecord({ processId: 'p.u1' }),
      unknownRecord({ processId: 'p.u2', unknownReason: 'нет опубликованной параметризации в пределах Stage 4.9' })
    ]);
    expect(plan.extents.map((e) => e.processId)).toEqual(['p.known']);
    expect(plan.skipped.map((s) => s.processId)).toEqual(['p.u1', 'p.u2']);
    expect(plan.skipped[1].reason).toContain('параметризации');
    expect(plan.diagnostics.some((d) => d.includes('2'))).toBe(true);
    // Проверка независимости: skipped-записи не содержат чисел скорости.
    expect(JSON.stringify(plan.skipped)).not.toContain('rateMolPerM2PerYear');
  });

  it('планирование детерминировано: два одинаковых вызова дают идентичные планы', () => {
    const records = [knownRecord({ processId: 'p.a', rateMolPerM2PerYear: 7.7e-6 }), unknownRecord({ processId: 'p.b' })];
    const a = planOf(records, 1.5);
    const b = planOf(records, 1.5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ============================================
// 4. FAIL-CLOSED ПЛАНИРОВЩИКА
// ============================================

describe('Stage 4.9g кинетика: fail-closed планировщика', () => {
  it('некорректная длительность (0, -1, NaN, Infinity) — ошибка invalid_input', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const err = expectKineticsError(() => planOf([knownRecord()], bad), 'invalid_input');
      expect(err.processId).toBeNull();
    }
  });

  it('длительность без идентифицированного provenance — ошибка invalid_input', () => {
    expectKineticsError(
      () => planGeochemicalKineticExtents({ records: [knownRecord()], durationYears: 1, durationProvenance: {} }),
      'invalid_input'
    );
  });

  it('невалидная кинетическая запись отклоняет весь план; processId нарушителя назван', () => {
    const err = expectKineticsError(
      () => planOf([knownRecord({ rateMolPerM2PerYear: 1e-6 }), knownRecord({ processId: 'bad.process', rateProvenance: {} })]),
      'invalid_input'
    );
    expect(err.processId).toBe('bad.process');
  });

  it('непредставимый extent (rate 1e308 на 10 годах) — ошибка unrepresentable_extent, а не молчаливое переполнение', () => {
    const err = expectKineticsError(
      () => planOf([knownRecord({ rateMolPerM2PerYear: 1e308 })], 10),
      'unrepresentable_extent'
    );
    expect(err.processId).toBe('test.process.known');
  });
});
