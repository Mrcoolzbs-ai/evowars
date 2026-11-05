/**
 * Stage 4.4.4.3 — тесты каталога бинарных параметров взаимодействия kij
 * (Data/binaryInteractionParameters.ts).
 *
 * Проверяемый контракт (§2-§4 задачи Stage 4.4.4.3):
 *  - каталог содержит РОВНО все 10 пар пяти компонентов {co2, n2, ch4, h2o, ar}
 *    по одному разу (канонический ключ, без дублей i-j/j-i);
 *  - 5 пар available (Okoro et al. 2024; Köster, Thol & Vrabec 2018),
 *    5 пар unresolved с явным основанием аудита;
 *  - per-pair provenance: происхождение, DOI, дата обращения, применимость,
 *    лицензия; значения CoolProp НЕ импортированы;
 *  - fail-closed lookup: unknown_gas / same_component_pair /
 *    unresolved_binary_interaction / invalid_catalog_record;
 *  - kij = 0 НЕ нейтрален: отсутствие значения = явный отказ;
 *  - симметрия ключа и записи; runtime-иммутабельность каталога.
 *
 * Числовые литералы — опубликованные значения источников с указанием
 * первоисточника в комментарии.
 */

import { describe, it, expect } from 'vitest';

import {
  BINARY_INTERACTION_PARAMETERS,
  BINARY_INTERACTION_PAIR_KEYS,
  BINARY_INTERACTIONS_RETRIEVED_AT,
  BINARY_INTERACTIONS_SCOPE_NOTE,
  BINARY_NO_ZERO_DEFAULT_NOTE,
  BINARY_PAIR_STATUSES,
  canonicalBinaryPairKey,
  getBinaryInteractionCoverage,
  getBinaryInteractionParameter,
  listBinaryInteractionPairKeys,
  validateBinaryInteractionCatalog,
  validateBinaryInteractionPairRecord,
  BinaryInteractionError
} from '../Data/binaryInteractionParameters';

import type {
  BinaryInteractionAvailableRecord,
  BinaryInteractionPairRecord
} from '../Data/binaryInteractionParameters';

import { EOS_PURE_COMPONENT_IDS } from '../Data/eosParameters';

// ----------------------------------------------------------------------------
// Вспомогательные
// ----------------------------------------------------------------------------

type DeepMutable<T> = T extends readonly (infer U)[]
  ? DeepMutable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
    : T;

/** Глубокая mutable-копия записи для негативных тестов валидатора. */
function clonePairRecord(key: string): DeepMutable<BinaryInteractionPairRecord> {
  return JSON.parse(
    JSON.stringify(BINARY_INTERACTION_PARAMETERS[key])
  ) as DeepMutable<BinaryInteractionPairRecord>;
}

// ----------------------------------------------------------------------------
// 1. Состав каталога: ровно 10 канонических пар пяти компонентов
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: состав каталога kij', () => {
  it('содержит ровно 10 пар пяти компонентов, ключи канонические и уникальны', () => {
    const ids = EOS_PURE_COMPONENT_IDS;
    const expected: string[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        expected.push(canonicalBinaryPairKey(ids[i], ids[j]));
      }
    }
    expect(expected).toHaveLength(10);
    expect([...BINARY_INTERACTION_PAIR_KEYS].sort()).toEqual(expected.sort());
    expect(new Set(BINARY_INTERACTION_PAIR_KEYS).size).toBe(10);
    expect(listBinaryInteractionPairKeys()).toEqual(BINARY_INTERACTION_PAIR_KEYS);
  });

  it('канонический ключ: сортировка пары, один ключ на пару в любом порядке', () => {
    expect(canonicalBinaryPairKey('co2', 'n2')).toBe('co2|n2');
    expect(canonicalBinaryPairKey('n2', 'co2')).toBe('co2|n2');
    expect(canonicalBinaryPairKey('ar', 'h2o')).toBe('ar|h2o');
    expect(canonicalBinaryPairKey('h2o', 'ar')).toBe('ar|h2o');
    // Разные пары не дают коллизий ключа.
    expect(canonicalBinaryPairKey('co2', 'n2')).not.toBe(canonicalBinaryPairKey('co2', 'ar'));
  });

  it('компоненты пар — только из каталога 4.4.4.1 (h2 исключён)', () => {
    for (const key of BINARY_INTERACTION_PAIR_KEYS) {
      const rec = BINARY_INTERACTION_PARAMETERS[key];
      expect(EOS_PURE_COMPONENT_IDS).toContain(rec.componentA);
      expect(EOS_PURE_COMPONENT_IDS).toContain(rec.componentB);
      expect(rec.componentA).not.toBe('h2');
      expect(rec.componentB).not.toBe('h2');
    }
  });

  it('записи хранятся в каноническом порядке (componentA < componentB)', () => {
    for (const key of BINARY_INTERACTION_PAIR_KEYS) {
      const rec = BINARY_INTERACTION_PARAMETERS[key];
      expect(rec.componentA < rec.componentB).toBe(true);
      expect(canonicalBinaryPairKey(rec.componentA, rec.componentB)).toBe(key);
    }
  });
});

// ----------------------------------------------------------------------------
// 2. Покрытие: 5 available, 5 unresolved
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: покрытие каталога', () => {
  it('ровно 5 пар available и 5 пар unresolved', () => {
    const coverage = getBinaryInteractionCoverage();
    expect(coverage.totalPairs).toBe(10);
    expect(coverage.availablePairKeys).toHaveLength(5);
    expect(coverage.unresolvedPairKeys).toHaveLength(5);
    expect([...coverage.availablePairKeys].sort()).toEqual(
      ['ar|co2', 'ar|n2', 'ch4|co2', 'co2|n2', 'h2o|n2'].sort()
    );
    expect([...coverage.unresolvedPairKeys].sort()).toEqual(
      ['ar|ch4', 'ar|h2o', 'ch4|h2o', 'ch4|n2', 'co2|h2o'].sort()
    );
  });

  it('опубликованные значения kij соответствуют первоисточникам', () => {
    // Okoro et al. 2024, GHG: S&T 14, 829–858, doi:10.1002/ghg.2300,
    // Таблица 1, колонка «Original BIP».
    expect(
      (BINARY_INTERACTION_PARAMETERS['co2|n2'] as BinaryInteractionAvailableRecord).kij.value
    ).toBe(-0.017);
    expect(
      (BINARY_INTERACTION_PARAMETERS['ar|co2'] as BinaryInteractionAvailableRecord).kij.value
    ).toBe(0.129219);
    expect(
      (BINARY_INTERACTION_PARAMETERS['ch4|co2'] as BinaryInteractionAvailableRecord).kij.value
    ).toBe(0.09897);
    // Köster, Thol & Vrabec 2018, JCED 63(2), 305–320,
    // doi:10.1021/acs.jced.7b00706, Таблица 4 (kij PR).
    expect(
      (BINARY_INTERACTION_PARAMETERS['ar|n2'] as BinaryInteractionAvailableRecord).kij.value
    ).toBe(-0.0037);
    expect(
      (BINARY_INTERACTION_PARAMETERS['h2o|n2'] as BinaryInteractionAvailableRecord).kij.value
    ).toBe(-0.0501);
  });

  it('unresolved-пары содержат основание аудита и не имеют значения kij', () => {
    for (const key of getBinaryInteractionCoverage().unresolvedPairKeys) {
      const rec = BINARY_INTERACTION_PARAMETERS[key];
      expect(rec.status).toBe('unresolved');
      const unresolved = rec as { reason: unknown; auditNote: unknown };
      expect(typeof unresolved.reason).toBe('string');
      expect((unresolved.reason as string).length).toBeGreaterThan(0);
      expect(typeof unresolved.auditNote).toBe('string');
      expect((unresolved.auditNote as string).length).toBeGreaterThan(0);
      expect((rec as unknown as Record<string, unknown>).kij).toBeUndefined();
    }
  });
});

// ----------------------------------------------------------------------------
// 3. Provenance и применимость
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: per-pair provenance', () => {
  it('доступные записи имеют полный provenance с DOI и датой обращения', () => {
    for (const key of getBinaryInteractionCoverage().availablePairKeys) {
      const rec = BINARY_INTERACTION_PARAMETERS[key] as BinaryInteractionAvailableRecord;
      const prov = rec.kij.provenance;
      expect(prov.origin).toBe('reported');
      expect(prov.evidence).toBe('PARTIALLY_VERIFIED');
      expect(prov.retrievedAt).toBe(BINARY_INTERACTIONS_RETRIEVED_AT);
      expect(prov.reference).toMatch(/10\.\d{4,9}\//);
      expect((prov.sourceName ?? '').length).toBeGreaterThan(0);
      expect((prov.datasetVersion ?? '').length).toBeGreaterThan(0);
      expect((prov.applicability ?? '').length).toBeGreaterThan(0);
      expect((prov.license ?? '').length).toBeGreaterThan(0);
    }
  });

  it('пары Okoro 2024 ограничены верифицированным диапазоном 228.15–273.15 K', () => {
    for (const key of ['ar|co2', 'ch4|co2', 'co2|n2'] as const) {
      const rec = BINARY_INTERACTION_PARAMETERS[key] as BinaryInteractionAvailableRecord;
      expect(rec.applicabilityRangeK).not.toBeNull();
      expect(rec.applicabilityRangeK?.minTemperatureK).toBe(228.15);
      expect(rec.applicabilityRangeK?.maxTemperatureK).toBe(273.15);
      expect((rec.applicabilityRangeK?.basis ?? '').length).toBeGreaterThan(0);
    }
  });

  it('пары Köster 2018 без верифицированного диапазона имеют явный null', () => {
    for (const key of ['ar|n2', 'h2o|n2'] as const) {
      const rec = BINARY_INTERACTION_PARAMETERS[key] as BinaryInteractionAvailableRecord;
      // null — это «границы подгонки не верифицированы», а НЕ «применимо
      // всегда»: основание зафиксировано в provenance.applicability.
      expect(rec.applicabilityRangeK).toBeNull();
      expect(rec.kij.provenance.applicability).toMatch(/не верифицированы|не назначается/);
    }
  });

  it('статус PARTIALLY_VERIFIED НЕ повышается до VERIFIED (подгонки, не независимые данные)', () => {
    for (const key of getBinaryInteractionCoverage().availablePairKeys) {
      const rec = BINARY_INTERACTION_PARAMETERS[key] as BinaryInteractionAvailableRecord;
      expect(rec.kij.provenance.evidence).not.toBe('VERIFIED');
      expect(rec.kij.provenance.method).toMatch(/не\s*пересчитывалось|не\s*подгонялось|независимо не подтверждалось/);
    }
  });

  it('CoolProp-дефолты не импортированы; note/limitations фиксируют границы', () => {
    expect(BINARY_INTERACTIONS_SCOPE_NOTE).toMatch(/не реализуются|PPR78/);
    expect(BINARY_NO_ZERO_DEFAULT_NOTE).toMatch(/не является «нейтральным»/);
    expect(BINARY_NO_ZERO_DEFAULT_NOTE).toMatch(/fail-closed/);
    // Ни одна запись не ссылается на CoolProp как источник значения.
    for (const key of BINARY_INTERACTION_PAIR_KEYS) {
      const text = JSON.stringify(BINARY_INTERACTION_PARAMETERS[key]);
      // CoolProp упоминается только в отрицании (не импортируются);
      // проверяем отсутствие ссылки вида «источник: CoolProp».
      expect(text).not.toMatch(/"sourceName":[^,]*CoolProp[^,]*значени/);
    }
  });

  it('доступные записи симметричны по построению и имеют ограничения', () => {
    for (const key of getBinaryInteractionCoverage().availablePairKeys) {
      const rec = BINARY_INTERACTION_PARAMETERS[key] as BinaryInteractionAvailableRecord;
      expect(rec.symmetric).toBe(true);
      expect(rec.kij.unit).toBe('1');
      expect(Number.isFinite(rec.kij.value)).toBe(true);
      expect(rec.limitations.length).toBeGreaterThan(0);
      expect(Array.isArray(rec.crossChecks)).toBe(true);
    }
  });
});

// ----------------------------------------------------------------------------
// 4. Валидация каталога
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: валидация каталога', () => {
  it('канонический каталог проходит валидацию без ошибок', () => {
    expect(validateBinaryInteractionCatalog(BINARY_INTERACTION_PARAMETERS)).toEqual([]);
  });

  it('каждая запись каталога валидна по отдельности', () => {
    for (const key of BINARY_INTERACTION_PAIR_KEYS) {
      expect(validateBinaryInteractionPairRecord(BINARY_INTERACTION_PARAMETERS[key])).toEqual([]);
    }
  });

  it('посторонняя пара отклоняется (контракт: только пары пяти компонентов)', () => {
    const catalog = { ...BINARY_INTERACTION_PARAMETERS };
    catalog['ar|n2 '] = BINARY_INTERACTION_PARAMETERS['ar|n2'];
    const errors = validateBinaryInteractionCatalog(catalog);
    expect(errors.some((e) => e.includes('посторонняя пара'))).toBe(true);
  });

  it('отсутствие обязательной пары отклоняется', () => {
    const catalog: Partial<Record<string, BinaryInteractionPairRecord>> = {
      ...BINARY_INTERACTION_PARAMETERS
    };
    delete catalog['co2|n2'];
    const errors = validateBinaryInteractionCatalog(catalog);
    expect(errors.some((e) => e.includes('отсутствует обязательная пара'))).toBe(true);
  });

  it('запись с неканоническим ключом отклоняется', () => {
    const catalog: Record<string, unknown> = {
      ...BINARY_INTERACTION_PARAMETERS,
      'n2|co2': BINARY_INTERACTION_PARAMETERS['co2|n2']
    };
    delete catalog['co2|n2'];
    const errors = validateBinaryInteractionCatalog(catalog);
    expect(errors.some((e) => e.includes('не совпадает с каноническим ключом'))).toBe(true);
  });

  it('неконечный kij отклоняется валидатором записи', () => {
    const rec = clonePairRecord('co2|n2') as DeepMutable<BinaryInteractionAvailableRecord>;
    rec.kij.value = Number.NaN;
    const errors = validateBinaryInteractionPairRecord(rec);
    expect(errors.some((e) => e.includes('kij.value'))).toBe(true);
  });

  it('asymmetric-флаг, отличный от true, отклоняется', () => {
    const rec = clonePairRecord('ar|n2') as DeepMutable<BinaryInteractionAvailableRecord>;
    (rec as Record<string, unknown>).symmetric = false;
    const errors = validateBinaryInteractionPairRecord(rec);
    expect(errors.some((e) => e.includes('symmetric'))).toBe(true);
  });

  it('unresolved-запись без основания аудита отклоняется', () => {
    const rec = clonePairRecord('ar|ch4') as Record<string, unknown>;
    rec.reason = '';
    const errors = validateBinaryInteractionPairRecord(rec);
    expect(errors.some((e) => e.includes('reason'))).toBe(true);
  });

  it('provenance без DOI/URL/datasetId (нет upstream-указателя) отклоняется', () => {
    const rec = clonePairRecord('co2|n2') as DeepMutable<BinaryInteractionAvailableRecord>;
    rec.kij.provenance = {
      ...rec.kij.provenance,
      sourceId: '',
      datasetId: '',
      reference: 'источник без однозначного указателя'
    };
    const errors = validateBinaryInteractionPairRecord(rec);
    expect(errors.some((e) => e.includes('upstream'))).toBe(true);
  });

  it('неконечный диапазон применимости отклоняется', () => {
    const rec = clonePairRecord('ch4|co2') as DeepMutable<BinaryInteractionAvailableRecord>;
    rec.applicabilityRangeK = {
      minTemperatureK: 273.15,
      maxTemperatureK: 228.15,
      basis: 'перевёрнутый диапазон'
    };
    const errors = validateBinaryInteractionPairRecord(rec);
    expect(errors.some((e) => e.includes('minTemperatureK'))).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// 5. Fail-closed lookup
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: fail-closed lookup kij', () => {
  it('unresolved-пара даёт структурированный отказ (НЕ kij = 0)', () => {
    for (const [a, b] of [['h2o', 'ar'], ['co2', 'h2o'], ['ch4', 'n2']] as const) {
      try {
        getBinaryInteractionParameter(a, b);
        expect.unreachable(`ожидали отказ для пары ${a}|${b}`);
      } catch (error) {
        expect(error).toBeInstanceOf(BinaryInteractionError);
        const err = error as BinaryInteractionError;
        expect(err.code).toBe('unresolved_binary_interaction');
        expect(err.pairKey).toBe(canonicalBinaryPairKey(a, b));
        expect(err.message).toMatch(/unknown\/unresolved/i);
        // Отказ явно ссылается на запрет молчаливого нуля.
        expect(err.message).toMatch(/kij = 0/);
      }
    }
  });

  it('компонент вне каталога (включая h2) даёт unknown_gas', () => {
    for (const [a, b] of [['h2', 'co2'], ['co2', 'h2'], ['o2', 'n2'], ['methane', 'ar']] as const) {
      try {
        getBinaryInteractionParameter(a, b);
        expect.unreachable(`ожидали unknown_gas для ${a}|${b}`);
      } catch (error) {
        expect((error as BinaryInteractionError).code).toBe('unknown_gas');
      }
    }
  });

  it('самопара i-i даёт same_component_pair', () => {
    try {
      getBinaryInteractionParameter('co2', 'co2');
      expect.unreachable('ожидали same_component_pair');
    } catch (error) {
      const err = error as BinaryInteractionError;
      expect(err.code).toBe('same_component_pair');
      expect(err.pairKey).toBe('co2|co2');
    }
  });

  it('пустой идентификатор даёт unknown_gas', () => {
    expect(() => getBinaryInteractionParameter('', 'co2')).toThrowError(BinaryInteractionError);
    try {
      getBinaryInteractionParameter('co2', '   ');
      expect.unreachable('ожидали unknown_gas для пустого идентификатора');
    } catch (error) {
      expect((error as BinaryInteractionError).code).toBe('unknown_gas');
    }
  });

  it('lookup симметричен: (a, b) и (b, a) возвращают одну и ту же запись', () => {
    for (const [a, b] of [['co2', 'n2'], ['n2', 'co2'], ['h2o', 'n2'], ['n2', 'h2o']] as const) {
      const direct = getBinaryInteractionParameter(a, b);
      const reverse = getBinaryInteractionParameter(b, a);
      expect(direct).toBe(reverse);
      expect(direct.kij.value).toBe(reverse.kij.value);
    }
  });

  it('lookup доступной пары возвращает полную запись с provenance', () => {
    const rec = getBinaryInteractionParameter('co2', 'n2');
    expect(rec.status).toBe('available');
    expect(rec.componentA).toBe('co2');
    expect(rec.componentB).toBe('n2');
    expect(rec.kij.value).toBe(-0.017);
    expect(rec.kij.unit).toBe('1');
    expect(rec.kij.provenance.evidence).toBe('PARTIALLY_VERIFIED');
    expect(rec.applicabilityRangeK?.minTemperatureK).toBe(228.15);
    expect(rec.applicabilityRangeK?.maxTemperatureK).toBe(273.15);
    // Возвращается та же замороженная структура каталога (без копирования).
    expect(rec).toBe(BINARY_INTERACTION_PARAMETERS['co2|n2']);
  });
});

// ----------------------------------------------------------------------------
// 6. Runtime-иммутабельность
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: runtime-иммутабельность каталога kij', () => {
  it('каталог, ключи и реестры глубоко заморожены', () => {
    expect(Object.isFrozen(BINARY_INTERACTION_PARAMETERS)).toBe(true);
    expect(Object.isFrozen(BINARY_INTERACTION_PAIR_KEYS)).toBe(true);
    expect(Object.isFrozen(BINARY_PAIR_STATUSES)).toBe(true);
    for (const key of BINARY_INTERACTION_PAIR_KEYS) {
      const rec = BINARY_INTERACTION_PARAMETERS[key];
      expect(Object.isFrozen(rec)).toBe(true);
      if (rec.status === 'available') {
        expect(Object.isFrozen(rec.kij)).toBe(true);
        expect(Object.isFrozen(rec.kij.provenance)).toBe(true);
        expect(Object.isFrozen(rec.limitations)).toBe(true);
        expect(Object.isFrozen(rec.crossChecks)).toBe(true);
        if (rec.applicabilityRangeK !== null) {
          expect(Object.isFrozen(rec.applicabilityRangeK)).toBe(true);
        }
      }
    }
  });

  it('попытка изменить kij или provenance бросает TypeError', () => {
    const co2n2 = BINARY_INTERACTION_PARAMETERS['co2|n2'] as BinaryInteractionAvailableRecord;
    const mut = co2n2 as unknown as DeepMutable<BinaryInteractionAvailableRecord>;
    expect(() => {
      mut.kij.value = 0;
    }).toThrowError(TypeError);
    expect(() => {
      mut.kij.provenance.evidence = 'VERIFIED';
    }).toThrowError(TypeError);
    // Запрет молчаливого нуля не обходится и через подмену статуса.
    expect(co2n2.kij.value).toBe(-0.017);
    expect(co2n2.kij.provenance.evidence).toBe('PARTIALLY_VERIFIED');
  });

  it('попытка добавить «недостающую» пару не меняет замороженный каталог', () => {
    const mut = BINARY_INTERACTION_PARAMETERS as Record<string, unknown>;
    expect(() => {
      mut['ch4|n2'] = BINARY_INTERACTION_PARAMETERS['co2|n2'];
    }).toThrowError(TypeError);
    expect(BINARY_INTERACTION_PARAMETERS['ch4|n2'].status).toBe('unresolved');
  });

  it('замороженный каталог по-прежнему проходит валидацию', () => {
    expect(validateBinaryInteractionCatalog(BINARY_INTERACTION_PARAMETERS)).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// 7. Детерминизм
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: детерминизм', () => {
  it('повторные lookup и coverage стабильны', () => {
    expect(getBinaryInteractionParameter('n2', 'ar'))
      .toBe(getBinaryInteractionParameter('ar', 'n2'));
    expect(getBinaryInteractionCoverage()).toEqual(getBinaryInteractionCoverage());
    expect(listBinaryInteractionPairKeys()).toEqual(listBinaryInteractionPairKeys());
  });

  it('JSON round-trip не искажает запись', () => {
    const original = BINARY_INTERACTION_PARAMETERS['co2|n2'];
    const roundTripped = JSON.parse(
      JSON.stringify(original)
    ) as BinaryInteractionPairRecord;
    expect(roundTripped).toEqual(original);
  });
});
