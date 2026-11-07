// ============================================
// STAGE 4.1 - Тесты научных значений: статусы, неопределённость,
// происхождение (provenance)
// Заключительная проверка валидатора 4.3.1: bounded-неопределённость
// требует направление direction ('above' | 'below') — отсутствие,
// null и посторонние значения отклоняются валидацией и конструкторами.
// ============================================

import { describe, it, expect } from 'vitest';
import {
  knownValue,
  estimatedValue,
  unknownValue,
  notApplicable,
  notImplemented,
  invalidValue,
  convertScientificValueUnit,
  expectQuantity,
  quantityOrNull,
  hasUsableQuantity,
  statusOf,
  validateUncertainty,
  ScientificValueError
} from '../Core/scientificValue';
import type { ScientificValue, Uncertainty } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';

describe('Stage 4.1 ScientificValue: семантика статусов', () => {
  it('Unknown — НЕ ноль: числовое значение извлечь нельзя', () => {
    const u: ScientificValue = unknownValue('масса ядра неизвестна');
    expect(statusOf(u)).toBe('unknown');
    expect(quantityOrNull(u)).toBeNull();
    expect(() => expectQuantity('тест', u)).toThrow(ScientificValueError);
    try {
      expectQuantity('тест', u);
      expect.unreachable('должна быть ошибка');
    } catch (e) {
      const err = e as ScientificValueError;
      expect(err.code).toBe('non_numeric_status');
      expect(err.message).toContain('unknown');
    }
  });

  it('NotApplicable и NotImplemented — разные статусы с разной семантикой', () => {
    const na = notApplicable('твёрдая кора неприменима к газовому гиганту в выбранной модели');
    const ni = notImplemented('давление рассчитывается будущим модулем атмосферной динамики');
    expect(statusOf(na)).toBe('not_applicable');
    expect(statusOf(ni)).toBe('not_implemented');
    expect(statusOf(na)).not.toBe(statusOf(ni));
    expect(quantityOrNull(na)).toBeNull();
    expect(quantityOrNull(ni)).toBeNull();
    // причина неприменимости сохраняется явно
    expect((na as { reason: string }).reason).toContain('газовому гиганту');
  });

  it('Invalid нельзя использовать как корректное значение', () => {
    const bad = invalidValue('отрицательная абсолютная температура', quantity(-5, 'K'));
    expect(statusOf(bad)).toBe('invalid');
    expect(quantityOrNull(bad)).toBeNull();
    expect(hasUsableQuantity(bad)).toBe(false);
    try {
      expectQuantity('тест', bad);
      expect.unreachable('должна быть ошибка');
    } catch (e) {
      expect((e as ScientificValueError).message).toContain('отклонены');
    }
  });

  it('Estimated сохраняет метод оценки', () => {
    const est = estimatedValue(quantity(288, 'K'), 'упрощённая модель серого тела');
    expect(statusOf(est)).toBe('estimated');
    if (est.status === 'estimated') {
      expect(est.method).toBe('упрощённая модель серого тела');
    }
    expect(quantityOrNull(est)).not.toBeNull();
    // оценка без метода не создаётся
    expect(() => estimatedValue(quantity(1, 'K'), '   ')).toThrow(ScientificValueError);
  });

  it('Known несёт числовое значение', () => {
    const k = knownValue(quantity(101325, 'Pa'), { provenance: { sourceName: 'определение атмосферы' } });
    expect(statusOf(k)).toBe('known');
    expect(hasUsableQuantity(k)).toBe(true);
    expect(expectQuantity('тест', k).value).toBe(101325);
  });

  it('hasUsableQuantity различает числовые и нечисловые статусы', () => {
    expect(hasUsableQuantity(knownValue(quantity(1, 'kg')))).toBe(true);
    expect(hasUsableQuantity(estimatedValue(quantity(1, 'kg'), 'оценка'))).toBe(true);
    expect(hasUsableQuantity(unknownValue())).toBe(false);
    expect(hasUsableQuantity(notApplicable('причина'))).toBe(false);
    expect(hasUsableQuantity(notImplemented())).toBe(false);
    expect(hasUsableQuantity(invalidValue('причина'))).toBe(false);
  });
});

describe('Stage 4.1 ScientificValue: неопределённость', () => {
  it('отсутствие uncertainty означает «неизвестна», а не «ноль»', () => {
    const v = knownValue(quantity(100, 'K'));
    // сужение union-типа: uncertainty есть только у числовых статусов
    if (v.status !== 'known') {
      throw new Error('knownValue должен возвращать статус known');
    }
    expect(v.uncertainty).toBeUndefined();
    // отсутствие ≠ нулевая погрешность: нулевую нужно задать явно
    const zero = knownValue(quantity(100, 'K'), { uncertainty: { kind: 'stddev', sigma: 0 } });
    if (zero.status === 'known') {
      expect(zero.uncertainty).toEqual({ kind: 'stddev', sigma: 0 });
    }
  });

  it('некорректный интервал [5, 3] отвергается', () => {
    const badInterval = { kind: 'interval' as const, lower: 5, upper: 3 };
    expect(validateUncertainty(badInterval).length).toBeGreaterThan(0);
    expect(() => knownValue(quantity(1, 'K'), { uncertainty: badInterval })).toThrow(ScientificValueError);
  });

  it('нестандартные значения неопределённости отвергаются', () => {
    expect(validateUncertainty({ kind: 'stddev', sigma: -1 }).length).toBeGreaterThan(0);
    expect(validateUncertainty({ kind: 'relative', fraction: -0.5 }).length).toBeGreaterThan(0);
    expect(validateUncertainty({ kind: 'stddev', sigma: 0.5 }).length).toBe(0);
    expect(validateUncertainty({ kind: 'interval', lower: 1, upper: 2 }).length).toBe(0);
  });

  it('интервал не заявляется доверительным без явного указания', () => {
    const v = knownValue(quantity(10, 'kg'), { uncertainty: { kind: 'interval', lower: 9, upper: 11 } });
    if (v.status === 'known' && v.uncertainty && v.uncertainty.kind === 'interval') {
      expect(v.uncertainty.interpretation).toBeUndefined();
    }
  });
});

describe('Stage 4.1 ScientificValue: provenance и преобразование единиц', () => {
  it('provenance сохраняется при преобразовании единиц', () => {
    const v = estimatedValue(quantity(1000, 'm'), 'лидарная съёмка рельефа', {
      uncertainty: { kind: 'interval', lower: 900, upper: 1100 },
      provenance: { sourceName: 'наблюдение X', datasetVersion: '2024-03', method: 'лидарная съёмка рельефа' }
    });
    const converted = convertScientificValueUnit(v, 'km');
    expect(statusOf(converted)).toBe('estimated');
    if (converted.status === 'estimated') {
      expect(converted.method).toBe('лидарная съёмка рельефа');
      expect(converted.quantity.value).toBe(1);
      expect(converted.quantity.unit).toBe('km');
      expect(converted.provenance?.sourceName).toBe('наблюдение X');
      expect(converted.provenance?.datasetVersion).toBe('2024-03');
      // неопределённость пересчитана в новые единицы, а не потеряна
      expect(converted.uncertainty?.kind).toBe('interval');
      if (converted.uncertainty?.kind === 'interval') {
        expect(converted.uncertainty.lower).toBeCloseTo(0.9, 12);
        expect(converted.uncertainty.upper).toBeCloseTo(1.1, 12);
      }
    }
  });

  it('относительная неопределённость инвариантна к единицам', () => {
    const v = knownValue(quantity(100, 'g'), { uncertainty: { kind: 'relative', fraction: 0.05 } });
    const converted = convertScientificValueUnit(v, 'kg');
    if (converted.status === 'known' && converted.uncertainty?.kind === 'relative') {
      expect(converted.uncertainty.fraction).toBe(0.05);
    }
  });

  it('преобразование единицы у Unknown не создаёт число', () => {
    const u = unknownValue('нет данных');
    const converted = convertScientificValueUnit(u, 'km');
    expect(statusOf(converted)).toBe('unknown');
    expect(quantityOrNull(converted)).toBeNull();
  });

  it('преобразование в несовместимую единицу отвергается', () => {
    const v = knownValue(quantity(1, 'kg'));
    expect(() => convertScientificValueUnit(v, 'K')).toThrow();
  });
});

// ============================================
// ЗАКЛЮЧИТЕЛЬНАЯ ПРОВЕРКА ВАЛИДАТОРА 4.3.1:
// BOUNDED-НЕОПРЕДЕЛЁННОСТЬ ТРЕБУЕТ НАПРАВЛЕНИЕ
// ============================================

describe('Stage 4.1 (заключительная проверка): bounded-неопределённость', () => {
  it('корректная bounded-неопределённость с направлением above принимается', () => {
    const u = { kind: 'bounded' as const, direction: 'above' as const, bound: 5 };
    expect(validateUncertainty(u)).toEqual([]);
    const v = knownValue(quantity(100, 'K'), { uncertainty: u });
    expect(v.status).toBe('known');
    if (v.status === 'known' && v.uncertainty && v.uncertainty.kind === 'bounded') {
      expect(v.uncertainty.direction).toBe('above');
      expect(v.uncertainty.bound).toBe(5);
    }
  });

  it('корректная bounded-неопределённость с направлением below принимается', () => {
    const u = { kind: 'bounded' as const, direction: 'below' as const, bound: 3 };
    expect(validateUncertainty(u)).toEqual([]);
    const v = knownValue(quantity(100, 'K'), { uncertainty: u });
    expect(v.status).toBe('known');
    if (v.status === 'known' && v.uncertainty && v.uncertainty.kind === 'bounded') {
      expect(v.uncertainty.direction).toBe('below');
    }
  });

  it('отсутствие direction — ошибка валидации', () => {
    // runtime-повреждение (данные из JSON): поле отсутствует
    const missing = { kind: 'bounded', bound: 5 } as unknown as Uncertainty;
    const issues = validateUncertainty(missing);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((e) => e.includes('above'))).toBe(true);
  });

  it('недопустимое значение direction — ошибка валидации', () => {
    const wrong = { kind: 'bounded', direction: 'вбок', bound: 5 } as unknown as Uncertainty;
    expect(validateUncertainty(wrong).some((e) => e.includes('направление'))).toBe(true);
    const nullDirection = { kind: 'bounded', direction: null, bound: 5 } as unknown as Uncertainty;
    expect(validateUncertainty(nullDirection).length).toBeGreaterThan(0);
  });

  it('конструкторы отклоняют некорректную bounded-неопределённость (ScientificValueError)', () => {
    const bad = { kind: 'bounded', bound: 5 } as unknown as Uncertainty;
    expect(() => knownValue(quantity(1, 'K'), { uncertainty: bad })).toThrow(ScientificValueError);
    try {
      knownValue(quantity(1, 'K'), { uncertainty: bad });
      expect.unreachable('knownValue должен отклонить bounded без direction');
    } catch (e) {
      const err = e as ScientificValueError;
      expect(err.code).toBe('invalid_uncertainty');
      expect(err.message).toContain('above');
    }
    expect(() => estimatedValue(quantity(1, 'K'), 'тестовая оценка', { uncertainty: bad })).toThrow(ScientificValueError);
    // существующая проверка конечности bound сохранена
    const nanBound = { kind: 'bounded' as const, direction: 'above' as const, bound: Number.NaN };
    expect(validateUncertainty(nanBound).some((e) => e.includes('конечным'))).toBe(true);
  });
});
