/**
 * Stage 4.5.4 (ревизия 4.5.4.2) — тесты каталога кинетических записей KIDA/JPL.
 *
 * Группы: базовый набор (идентичности, unknown-константы); fail-closed интеграция
 * с вычислителем 4.5.2 и блокирующие вопросы; ЛИЦЕНЗИОННАЯ БЕЗОПАСНОСТЬ —
 * структурные проверки без воспроизведения дословных данных экспорта KIDA
 * (ревизия 4.5.4.2: дословные числовые литералы из теста УДАЛЕНЫ; проверяются
 * разрешённые ключи rawInput, допустимые числовые значения и запрет ключей
 * параметров закона скорости и метаданных курирования); строгая сборка
 * каталога на SYNTHETIC-фикстурах; ошибки схемы/единиц/диапазонов валидатора
 * 4.5.1. Параметры JPL/KIDA НЕ промоутированы: все записи unknown — fail-closed.
 *
 * Ревизия Stage 4.5.4.5 (2026-11-08): добавлена группа тестов per-record аудита
 * доступа JPL Evaluation No. 20 (JPL_EVALUATION_20_ACCESS_AUDIT) — проверяются
 * структура аудита, согласованность с каталогом и сохранение fail-closed;
 * аудиту соответствует НЕ импорт параметров, а задокументированное его
 * отсутствие.
 *
 * Корректировка доказательной базы Stage 4.5.4 (2026-11-08, после ревизии
 * 4.5.4.5; БЕЗ импорта параметров): актуализированы access-only проверки:
 * полная форма уширения KIDA транскрибирована по официальным изображениям
 * (k = k∞·Pr/(1+Pr)·F; F-формула с c/N/d; Fc(T) из a/b/c/d; коллизия
 * обозначений), дескрипторы источников фиксируют прямые PDF-ссылки JPL
 * (science.jpl.nasa.gov/documents/1503/, NOAA CSL) и цитату copyright-нотиса
 * издания 25-1; все записи по-прежнему unknown, fail-closed НЕ ослаблен;
 * число тестов НЕ менялось.
 *
 * Уточнение provenance (2026-11-08, вторая корректировка аудита доступа):
 * зафиксированы фактические границы извлечённого текстового слоя JPL 25-1
 * (титул с copyright-нотисом, аннотация, оглавление, введение I.1–I.9,
 * детальное оглавление раздела 1; обрыв в начале подраздела 1.1 Introduction
 * раздела 1, страница 1-3); цитаты I.5 Data Formats и пункта 1.7.2 — из того
 * же слоя; число тестов НЕ менялось.
 *
 * Per-record provenance (2026-11-08, третья корректировка): per-record
 * источники пяти записей зафиксированы в records[].note аудита (DOIs,
 * NIST-записи, тип доказательства — прямое N₂-измерение / evaluated
 * review / теория / модель, третье тело, T/P-условия, неопределённости,
 * соответствие строкам JPL B1/C1 — рекомендации для воздуха);
 * добавлено 9-е наблюдение доступа (зеркало Evaluation No. 19 и границы
 * его извлечённого слоя); все записи остаются status='unknown',
 * fail-closed НЕ ослаблен; число тестов НЕ менялось.
 */
import { describe, expect, it } from 'vitest';
import {
  KIDA_DATABASE_SOURCE,
  KIDA_TB_EXPORT_SOURCE,
  JPL_EVALUATION_SOURCE,
  JPL_EVALUATION_20_ACCESS_AUDIT,
  KIDA_TB_RECORD_IDENTITIES,
  KINETIC_CATALOG_DATA,
  KINETIC_CATALOG_BLOCKING_QUESTIONS,
  kidaTbRecordId,
  buildKidaTbReactionRecord,
  buildKineticsCatalog,
  KineticsCatalogError
} from '../Data/kineticsCatalog';
import type { KineticReactionRecord, ArrheniusParameters, FallOffParameters } from '../Core/kinetics';
import { evaluateRateConstant, validateKineticReactionRecord, KineticsError } from '../Core/kinetics';
import type { DataProvenance } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';

const EXPECTED_IDS: readonly string[] = [
  'kida-tb-2015-03-19-1',
  'kida-tb-2015-03-19-70',
  'kida-tb-2015-03-19-72',
  'kida-tb-2015-03-19-89',
  'kida-tb-2015-03-19-106'
];

const KIDA_REACTION_NUMBERS: readonly number[] = [1, 70, 72, 89, 106];

const AUDIT_RECORD_PROVENANCE_MARKERS: Readonly<Record<number, readonly string[]>> = {
  1: ['1983COH/WES531', '10.1016/0010-2180(69)90005-4', '1.5 раза'],
  70: ['10.1063/1.555759', 'AIAA 2004-0463', 'unresolved'],
  72: ['1977ZEL/ERL939', '10.1039/F29888400745', '10.1021/jp711800z', 'Fcent(N₂) = 0.73'],
  89: ['1983SCH/KOH361', '10.1002/bbpc.19830870419', '10.1039/A806520I', '«No change»', 'ДЛЯ ВОЗДУХА'],
  106: ['1987HSU/DUR1895', '10.1021/j100291a043', '«No change»', 'ДЛЯ ВОЗДУХА']
};

function kineticsError(fn: () => unknown): KineticsError {
  try {
    fn();
  } catch (e) {
    if (e instanceof KineticsError) {
      return e;
    }
    throw new Error(`ожидалась KineticsError, получено: ${String(e)}`);
  }
  throw new Error('ожидалась KineticsError, вызов прошёл без ошибки');
}

function expectProblem(record: unknown, fragment: string): void {
  const problems = validateKineticReactionRecord(record);
  expect(problems.some((p) => p.includes(fragment))).toBe(true);
}

function syntheticProvenance(): DataProvenance {
  return {
    sourceName: 'SYNTHETIC: тестовая фикстура Stage 4.5.4 (не данные JPL/KIDA)',
    datasetId: 'synthetic-kinetics-fixture',
    recordId: 'synthetic:test',
    note: 'SYNTHETIC: запись существует только в тесте'
  };
}

function syntheticArrheniusParameters(overrides?: Partial<ArrheniusParameters>): ArrheniusParameters {
  return {
    preExponentialA: 1e-11,
    temperatureExponentN: 0,
    energy: { form: 'E_over_R', valueK: 0 },
    temperatureRangeK: { min: 200, max: 2000 },
    unit: 'cm3_per_molecule_per_s',
    provenance: syntheticProvenance(),
    ...overrides
  };
}

function syntheticFallOffParameters(overrides?: Partial<FallOffParameters>): FallOffParameters {
  return {
    lowPressureLimit: syntheticArrheniusParameters({ unit: 'cm6_per_molecule2_per_s' }),
    highPressureLimit: syntheticArrheniusParameters(),
    centeringFactorFc: 0.6,
    broadeningN: 1,
    thirdBodyNote: 'SYNTHETIC: M — фикция фикстуры',
    provenance: syntheticProvenance(),
    ...overrides
  };
}

function syntheticArrheniusRecord(id: string, params?: ArrheniusParameters): KineticReactionRecord {
  return {
    id,
    kind: 'elementary',
    overallOrder: 2,
    concentrationModel: 'molecule_cm3',
    rateConstant: {
      status: 'known',
      parameters: { kind: 'arrhenius', arrhenius: params ?? syntheticArrheniusParameters() }
    },
    provenance: syntheticProvenance()
  };
}

function syntheticFallOffRecord(id: string, params?: FallOffParameters): KineticReactionRecord {
  return {
    id,
    kind: 'elementary',
    overallOrder: 2,
    concentrationModel: 'molecule_cm3',
    rateConstant: {
      status: 'known',
      parameters: { kind: 'fall_off', fallOff: params ?? syntheticFallOffParameters() }
    },
    provenance: syntheticProvenance()
  };
}

function rateProvenanceOf(record: KineticReactionRecord): DataProvenance {
  if (record.rateConstant.status !== 'unknown') {
    throw new Error(`запись «${record.id}» должна иметь unknown-константу`);
  }
  const provenance = record.rateConstant.provenance;
  if (provenance === undefined) {
    throw new Error(`запись «${record.id}» должна нести provenance в константе`);
  }
  return provenance;
}

describe('Stage 4.5.4: базовый набор каталога KIDA (идентичности, unknown)', () => {
  it('содержит 5 реакционных идентичностей с уникальными стабильными ID', () => {
    const catalog = buildKineticsCatalog();
    expect(catalog.size()).toBe(5);
    expect(catalog.listIds()).toEqual([...EXPECTED_IDS]);
    for (const id of EXPECTED_IDS) {
      expect(catalog.has(id)).toBe(true);
      expect(catalog.get(id), `запись ${id}`).not.toBeNull();
    }
    expect(catalog.get('kida-tb-2015-03-19-9999')).toBeNull();
  });

  it('все записи каталога проходят строгую валидацию контракта 4.5.1', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      expect(validateKineticReactionRecord(record), `запись ${record.id}`).toEqual([]);
    }
  });

  it('ID строятся детерминированно из номера реакции KIDA', () => {
    expect(kidaTbRecordId(1)).toBe('kida-tb-2015-03-19-1');
    expect(kidaTbRecordId(106)).toBe('kida-tb-2015-03-19-106');
    const numbers = KIDA_TB_RECORD_IDENTITIES.map((i) => i.kidaReactionNumber);
    expect(numbers).toEqual([...KIDA_REACTION_NUMBERS]);
  });

  it('константы всех записей — unknown без параметров (параметры не промоутированы)', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      expect(record.rateConstant.status, `запись ${record.id}`).toBe('unknown');
      const rate = record.rateConstant as { status: 'unknown'; note?: string; parameters?: unknown };
      expect(rate.parameters, `запись ${record.id}`).toBeUndefined();
      expect(rate.note ?? '').not.toBe('');
    }
  });

  it('kind/порядок/модель концентраций записей: elementary, null-порядок, molecule_cm3', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      expect(record.kind).toBe('elementary');
      expect(record.overallOrder).toBeNull();
      expect(record.concentrationModel).toBe('molecule_cm3');
    }
  });

  it('reaction-строки соответствуют составу идентичностей KIDA', () => {
    const byId = new Map(KINETIC_CATALOG_DATA.map((r) => [r.id, r]));
    expect(byId.get('kida-tb-2015-03-19-1')!.reaction).toBe('H + H + N2 → H2 + N2');
    expect(byId.get('kida-tb-2015-03-19-70')!.reaction).toBe('O + H + N2 → OH + N2');
    expect(byId.get('kida-tb-2015-03-19-72')!.reaction).toBe('OH + H + N2 → H2O + N2');
    expect(byId.get('kida-tb-2015-03-19-89')!.reaction).toBe('O + NO + N2 → NO2 + N2');
    expect(byId.get('kida-tb-2015-03-19-106')!.reaction).toBe('H + O2 + N2 → O2H + N2');
    for (const identity of KIDA_TB_RECORD_IDENTITIES) {
      const record = buildKidaTbReactionRecord(identity);
      expect(record.reaction).toBe(`${identity.reactants.join(' + ')} → ${identity.products.join(' + ')}`);
    }
  });

  it('provenance каждой записи идентифицирует источник с честной лицензией unverified', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      const provenance = record.provenance;
      expect(provenance?.sourceName).toBe(KIDA_TB_EXPORT_SOURCE.sourceName);
      expect(provenance?.datasetId).toBe('kida_reac_tb_2015-03-19_1.csv');
      expect(provenance?.datasetVersion ?? '').toContain('d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd');
      expect(provenance?.datasetVersion ?? '').toContain('data/kida/');
      expect(provenance?.retrievedAt).toBe('2026-11-03');
      expect(provenance?.license ?? '').toContain('unverified');
      expect(provenance?.license ?? '').toContain('Legal Notices');
      expect(provenance?.reference ?? '').toContain('Wakelam');
      const rateProvenance = rateProvenanceOf(record);
      const identity = KIDA_TB_RECORD_IDENTITIES.find(
        (i) => kidaTbRecordId(i.kidaReactionNumber) === record.id
      )!;
      expect(rateProvenance.recordId).toBe(`kida-tb-2015-03-19:reaction=${identity.kidaReactionNumber}`);
      expect(rateProvenance.limitations ?? '').toContain('KINETIC_CATALOG_BLOCKING_QUESTIONS');
      expect(rateProvenance.limitations ?? '').toContain('НЕ воспроизводятся');
    }
  });

  it('детерминированность: повторная сборка каталога даёт идентичный результат', () => {
    const a = buildKineticsCatalog();
    const b = buildKineticsCatalog();
    expect(b.listIds()).toEqual([...a.listIds()]);
    for (const id of a.listIds()) {
      expect(JSON.stringify(b.get(id))).toBe(JSON.stringify(a.get(id)));
    }
    for (const identity of KIDA_TB_RECORD_IDENTITIES) {
      expect(JSON.stringify(buildKidaTbReactionRecord(identity))).toBe(
        JSON.stringify(buildKidaTbReactionRecord(identity))
      );
    }
  });

  it('отсутствующая запись не порождает выдуманных данных', () => {
    const catalog = buildKineticsCatalog();
    expect(catalog.get('kida-tb-2015-03-19-42')).toBeNull();
    const rebuilt = buildKineticsCatalog(KINETIC_CATALOG_DATA);
    expect(rebuilt.size()).toBe(5);
  });
});

describe('Stage 4.5.4: fail-closed интеграция и блокирующие вопросы 4.5.4.1/4.5.4.2', () => {
  it('evaluateRateConstant отклоняет каждую запись каталога (no_kinetic_data)', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      const error = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
      expect(error.code, `запись ${record.id}`).toBe('no_kinetic_data');
    }
  });

  it('блокирующие вопросы зафиксированы: форма уширения, размерности, JPL, лицензия', () => {
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.length).toBe(4);
    expect(
      KINETIC_CATALOG_BLOCKING_QUESTIONS.some((q) => q.includes('НЕ представима точно в контракте 4.5.2'))
    ).toBe(true);
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.some((q) => q.includes('cm6.molecule-2.s-1'))).toBe(true);
    expect(
      KINETIC_CATALOG_BLOCKING_QUESTIONS.some(
        (q) => q.includes('JPL Evaluation No. 20') && q.includes('публично предлагается')
      )
    ).toBe(true);
    expect(
      KINETIC_CATALOG_BLOCKING_QUESTIONS.some(
        (q) => q.includes('Legal Notices') && q.includes('распространение')
      )
    ).toBe(true);
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.some((q) => q.includes('networkMultiplicity'))).toBe(true);
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.some((q) => q.includes('k = k∞·Pr/(1+Pr)·F'))).toBe(true);
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.some((q) => q.includes('коллизия обозначений'))).toBe(true);
  });

  it('дескрипторы источников проверяемы: URL, цитирование, дата, честные статусы', () => {
    for (const descriptor of [KIDA_DATABASE_SOURCE, KIDA_TB_EXPORT_SOURCE, JPL_EVALUATION_SOURCE]) {
      expect(descriptor.sourceName).not.toBe('');
      expect(descriptor.sourceId).not.toBe('');
      expect(descriptor.url.startsWith('https://')).toBe(true);
      expect(descriptor.citation).not.toBe('');
      expect(descriptor.retrievedAt).toBe('2026-11-03');
    }
    expect(KIDA_TB_EXPORT_SOURCE.license).toContain('unverified');
    expect(KIDA_TB_EXPORT_SOURCE.url).toContain('data/kida/');
    expect(KIDA_TB_EXPORT_SOURCE.note ?? '').toContain('#MODIFIED');
    expect(KIDA_DATABASE_SOURCE.note ?? '').toContain('изображениями');
    expect(KIDA_DATABASE_SOURCE.note ?? '').toContain('3body-1.png');
    expect(JPL_EVALUATION_SOURCE.note ?? '').toContain('публично предлагается');
    expect(JPL_EVALUATION_SOURCE.note ?? '').toContain('НЕ импортированы');
    expect(JPL_EVALUATION_SOURCE.note ?? '').toContain('documents/1503/');
    expect(JPL_EVALUATION_SOURCE.note ?? '').toContain('NASAJPLDataEvaluation20.pdf');
    expect(JPL_EVALUATION_SOURCE.citation).toContain('10.48577/jpl.KFQ0TZ');
    expect(JPL_EVALUATION_SOURCE.citation).toContain('Burkholder');
  });
});

describe('Stage 4.5.4: лицензионная безопасность (структурные проверки без воспроизведения данных)', () => {
  it('rawInput каждой записи содержит только разрешённые идентификационные ключи', () => {
    const allowedKeys = [
      'kidaReactionNumber',
      'reactant1',
      'reactant2',
      'reactant3',
      'product1',
      'product2'
    ];
    for (const record of KINETIC_CATALOG_DATA) {
      const rawInput = rateProvenanceOf(record).rawInput;
      expect(Object.keys(rawInput ?? {}).sort()).toEqual([...allowedKeys].sort());
    }
  });

  it('числовые значения сериализованного каталога — только целочисленные номера реакций KIDA', () => {
    const numericLeaves: { path: string; value: number }[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'number') {
        numericLeaves.push({ path, value: node });
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}[${i}]`));
        return;
      }
      if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          walk(value, `${path}.${key}`);
        }
      }
    };
    walk(KINETIC_CATALOG_DATA, 'catalog');
    walk(KIDA_TB_RECORD_IDENTITIES, 'identities');
    expect(numericLeaves.length).toBeGreaterThan(0);
    for (const leaf of numericLeaves) {
      expect(Number.isInteger(leaf.value), `путь ${leaf.path}`).toBe(true);
      expect(Number.isFinite(leaf.value), `путь ${leaf.path}`).toBe(true);
      expect(
        KIDA_REACTION_NUMBERS.includes(leaf.value),
        `путь ${leaf.path} (${leaf.value}) — допустимы только номера реакций KIDA`
      ).toBe(true);
    }
  });

  it('сериализованный каталог не содержит ключей параметров закона скорости и метаданных курирования', () => {
    const serialized = JSON.stringify(KINETIC_CATALOG_DATA) + JSON.stringify(KIDA_TB_RECORD_IDENTITIES);
    const forbiddenKeys = [
      'k0Alpha',
      'k0Beta',
      'k0Gamma',
      'k0UncertaintyFactor',
      'kInfAlpha',
      'kInfBeta',
      'kInfGamma',
      'kInfUncertaintyFactor',
      'fcA',
      'fcB',
      'fcC',
      'fcD',
      'fcUncertaintyFactor',
      'formulaCode',
      'globalFormulaCode',
      'uncertaintyFactor',
      'temperatureDependenceUncertainty',
      'tMinK',
      'tMaxK',
      'pMin',
      'pMax',
      'rawLine',
      'preExponentialA',
      'temperatureExponentN',
      'lowPressureLimit',
      'highPressureLimit',
      'centeringFactorFc',
      'broadeningN',
      'networkMultiplicity',
      'recommendation'
    ];
    for (const key of forbiddenKeys) {
      expect(serialized.includes(`"${key}"`), `ключ ${key}`).toBe(false);
    }
  });
});

describe('Stage 4.5.4: строгая сборка каталога (SYNTHETIC-фикстуры)', () => {
  it('синтетическая валидная аррениусовская запись собирается в каталог', () => {
    const catalog = buildKineticsCatalog([syntheticArrheniusRecord('synthetic-arrhenius-1')]);
    expect(catalog.size()).toBe(1);
    expect(catalog.has('synthetic-arrhenius-1')).toBe(true);
  });

  it('синтетический валидный fall-off собирается в каталог', () => {
    const catalog = buildKineticsCatalog([syntheticFallOffRecord('synthetic-falloff-1')]);
    expect(catalog.size()).toBe(1);
    expect(catalog.get('synthetic-falloff-1')!.rateConstant.status).toBe('known');
  });

  it('пустой каталог собирается без ошибок', () => {
    const catalog = buildKineticsCatalog([]);
    expect(catalog.size()).toBe(0);
    expect(catalog.listIds()).toEqual([]);
  });

  it('запись без id отклоняется с диагностикой', () => {
    const broken = syntheticArrheniusRecord('  ');
    expect(() => buildKineticsCatalog([broken])).toThrow(KineticsCatalogError);
    expect(() => buildKineticsCatalog([broken])).toThrow(/без id/);
  });

  it('known-запись без порядка не проходит валидацию 4.5.1', () => {
    const problems = validateKineticReactionRecord({
      ...syntheticArrheniusRecord('synthetic-broken-order'),
      overallOrder: null
    });
    expect(problems.some((p) => p.includes('порядок закона скорости'))).toBe(true);
  });

  it('сборка каталога с невалидной записью бросает KineticsCatalogError с проблемами', () => {
    const broken = { ...syntheticArrheniusRecord('synthetic-broken-order'), overallOrder: null };
    expect(() => buildKineticsCatalog([broken])).toThrow(KineticsCatalogError);
    expect(() => buildKineticsCatalog([broken])).toThrow(/не проходит валидацию/);
  });

  it('дублирующийся id отклоняется', () => {
    const a = syntheticArrheniusRecord('synthetic-dup');
    const b = syntheticFallOffRecord('synthetic-dup');
    expect(() => buildKineticsCatalog([a, b])).toThrow(KineticsCatalogError);
    expect(() => buildKineticsCatalog([a, b])).toThrow(/дублирующийся id/);
  });

  it('базовый набор + синтетическая запись собираются вместе без конфликтов id', () => {
    const catalog = buildKineticsCatalog([
      ...KINETIC_CATALOG_DATA,
      syntheticArrheniusRecord('synthetic-extra-1')
    ]);
    expect(catalog.size()).toBe(6);
    expect(catalog.listIds()[5]).toBe('synthetic-extra-1');
  });
});

describe('Stage 4.5.4: ошибки схемы, единицы и диапазоны (валидатор 4.5.1)', () => {
  it('kind вне реестра отклоняется', () => {
    expectProblem(
      { ...syntheticArrheniusRecord('synthetic-bad-kind'), kind: 'photochemical' },
      'kind должен быть'
    );
  });

  it('concentrationModel вне реестра отклоняется', () => {
    expectProblem(
      { ...syntheticArrheniusRecord('synthetic-bad-model'), concentrationModel: 'molecule_m3' },
      'concentrationModel должен быть'
    );
  });

  it('единица k, не согласованная с порядком, отклоняется', () => {
    const record = syntheticArrheniusRecord(
      'synthetic-bad-unit',
      syntheticArrheniusParameters({ unit: 'per_s' })
    );
    expectProblem(record, 'отнесена к порядку');
  });

  it('единица k, не согласованная с моделью концентраций, отклоняется', () => {
    expectProblem(
      { ...syntheticArrheniusRecord('synthetic-bad-model-unit'), concentrationModel: 'mol_m3' },
      'модели концентраций'
    );
  });

  it('недопустимый диапазон температуры (min >= max) отклоняется', () => {
    const record = syntheticArrheniusRecord(
      'synthetic-bad-range',
      syntheticArrheniusParameters({ temperatureRangeK: { min: 500, max: 500 } })
    );
    expectProblem(record, 'диапазон применимости');
  });

  it('Fc вне (0, 1] отклоняется', () => {
    const record = syntheticFallOffRecord(
      'synthetic-bad-fc',
      syntheticFallOffParameters({ centeringFactorFc: 0 })
    );
    expectProblem(record, 'центрирующий фактор Fc');
  });

  it('диапазоны k0/k∞ без пересечения отклоняются', () => {
    const record = syntheticFallOffRecord(
      'synthetic-no-overlap',
      syntheticFallOffParameters({
        lowPressureLimit: syntheticArrheniusParameters({
          unit: 'cm6_per_molecule2_per_s',
          temperatureRangeK: { min: 200, max: 300 }
        }),
        highPressureLimit: syntheticArrheniusParameters({
          temperatureRangeK: { min: 400, max: 500 }
        })
      })
    );
    expectProblem(record, 'не пересекаются');
  });

  it('provenance без идентификации источника отклоняется', () => {
    expectProblem(
      { ...syntheticArrheniusRecord('synthetic-no-source'), provenance: {} },
      'не идентифицирует источник'
    );
  });

  it('rawInput с NaN отклоняется (нефинитные числа не несут данных)', () => {
    const record = syntheticArrheniusRecord(
      'synthetic-nan-raw',
      syntheticArrheniusParameters({
        provenance: { ...syntheticProvenance(), rawInput: { alpha: Number.NaN } }
      })
    );
    expectProblem(record, 'должен быть конечным числом');
  });
});

describe('Stage 4.5.4.5: per-record аудит доступа JPL Evaluation No. 20 (без импорта)', () => {
  it('структура аудита: дата, DOI, цитата источника, 9 наблюдений доступа', () => {
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.auditedAt).toBe('2026-11-08');
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.doi).toBe('10.48577/jpl.KFQ0TZ');
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.evaluationCitation).toBe(JPL_EVALUATION_SOURCE.citation);
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.accessFindings.length).toBe(9);
    for (const finding of JPL_EVALUATION_20_ACCESS_AUDIT.accessFindings) {
      expect(finding).not.toBe('');
    }
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.conclusion).toContain('no_kinetic_data');
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.conclusion).toContain('прямые PDF-ссылки');
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.conclusion).toContain('1.1 Introduction');
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.accessFindings.some((f) => f.includes('I.5 Data Formats'))).toBe(true);
    expect(
      JPL_EVALUATION_20_ACCESS_AUDIT.accessFindings.some((f) =>
        f.includes('1.7.2 Termolecular Reactions (Section 2)')
      )
    ).toBe(true);
    expect(
      JPL_EVALUATION_20_ACCESS_AUDIT.accessFindings.some((f) =>
        f.includes('science.jpl.nasa.gov/documents/1503/NASA_Data_Evaluation_20.pdf')
      )
    ).toBe(true);
    expect(
      JPL_EVALUATION_20_ACCESS_AUDIT.accessFindings.some((f) =>
        f.includes('csl.noaa.gov/groups/csl5/datasets/NASAJPLDataEvaluation20.pdf')
      )
    ).toBe(true);
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.accessFindings.some((f) => f.includes('Copyright 2025'))).toBe(true);
    expect(
      JPL_EVALUATION_20_ACCESS_AUDIT.accessFindings.some((f) =>
        f.includes('NASA-JPL_Evaluation_19-5.pdf')
      )
    ).toBe(true);
  });

  it('per-record согласованность с каталогом: номера, ID и строки реакций совпадают', () => {
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.records.length).toBe(KIDA_TB_RECORD_IDENTITIES.length);
    expect(JPL_EVALUATION_20_ACCESS_AUDIT.records.map((r) => r.kidaReactionNumber)).toEqual([
      ...KIDA_REACTION_NUMBERS
    ]);
    for (const auditRecord of JPL_EVALUATION_20_ACCESS_AUDIT.records) {
      const catalogRecord = KINETIC_CATALOG_DATA.find((r) => r.id === auditRecord.kidaTbRecordId);
      expect(catalogRecord, `запись ${auditRecord.kidaTbRecordId}`).toBeDefined();
      expect(catalogRecord?.reaction, `запись ${auditRecord.kidaTbRecordId}`).toBe(auditRecord.reaction);
    }
  });

  it('каждая запись аудита: покрытие не установлено, параметры не верифицированы, статус unknown', () => {
    for (const auditRecord of JPL_EVALUATION_20_ACCESS_AUDIT.records) {
      expect(auditRecord.coverage).toBe('not_established');
      expect(auditRecord.parametersVerified).toBe(false);
      expect(auditRecord.statusAfterAudit).toBe('unknown');
      expect(auditRecord.note).toContain('не верифицированы');
      expect(auditRecord.note).toContain('no_kinetic_data');
      const markers = AUDIT_RECORD_PROVENANCE_MARKERS[auditRecord.kidaReactionNumber] ?? [];
      for (const marker of markers) {
        expect(
          auditRecord.note,
          `запись ${auditRecord.kidaTbRecordId}, маркер ${marker}`
        ).toContain(marker);
      }
    }
  });

  it('числовой обход аудита содержит только 5 номеров реакций KIDA; запрещённые ключи отсутствуют', () => {
    const numericLeaves: number[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'number') {
        numericLeaves.push(node);
        return;
      }
      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item);
        }
        return;
      }
      if (node !== null && typeof node === 'object') {
        for (const value of Object.values(node)) {
          walk(value);
        }
      }
    };
    walk(JPL_EVALUATION_20_ACCESS_AUDIT);
    expect(numericLeaves).toEqual([...KIDA_REACTION_NUMBERS]);
    const serialized = JSON.stringify(JPL_EVALUATION_20_ACCESS_AUDIT);
    const forbiddenKeys = [
      'k0Alpha',
      'kInfAlpha',
      'fcA',
      'preExponentialA',
      'temperatureExponentN',
      'lowPressureLimit',
      'highPressureLimit',
      'centeringFactorFc',
      'broadeningN',
      'temperatureRangeK',
      'networkMultiplicity',
      'recommendation'
    ];
    for (const key of forbiddenKeys) {
      expect(serialized.includes(`"${key}"`), `ключ ${key}`).toBe(false);
    }
  });

  it('fail-closed сохранён: все записи unknown, no_kinetic_data, 4 блокирующих вопроса', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      expect(record.rateConstant.status).toBe('unknown');
      const error = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
      expect(error.code, `запись ${record.id}`).toBe('no_kinetic_data');
    }
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.length).toBe(4);
    expect(
      KINETIC_CATALOG_BLOCKING_QUESTIONS.some(
        (q) => q.includes('JPL Evaluation No. 20') && q.includes('JPL_EVALUATION_20_ACCESS_AUDIT')
      )
    ).toBe(true);
  });
});
