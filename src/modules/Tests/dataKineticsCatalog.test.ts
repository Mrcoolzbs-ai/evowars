// ============================================
// STAGE 4.5.4 — Тесты каталога кинетических записей JPL/KIDA
// ============================================
//
// Проверяются требования подэтапа 4.5.4:
// - базовый набор: 5 реакционных идентичностей из дословного экспорта
//   KIDA kida_reac_tb_2015-03-19_1.csv (копия SophiaAtmo/PATMO@d78ec8e2,
//   получена 2026-11-03), все записи валидны контрактом 4.5.1, ID
//   уникальны и стабильны;
// - константы всех записей — unknown БЕЗ параметров: блоки k0/k∞/Fc
//   экспорта сохранены ДОСЛОВНО в provenance.rawInput (спот-чек
//   литералов против строки CSV), но НЕ промоутированы в known;
// - атрибуция per-record: sourceName/datasetId/recordId/reference/
//   retrievedAt/license честны (лицензия KIDA — unverified);
// - fail-closed интеграция с вычислителем 4.5.2: evaluateRateConstant
//   отклоняет каждую запись (KineticsError no_kinetic_data);
// - блокирующие вопросы этапа зафиксированы явно (JPL Evaluation No. 20
//   недоступен автоматическому доступу; семантика Fc/уширения KIDA
//   неверифицируема; лицензия unverified);
// - детерминированность сборки каталога;
// - строгая сборка: невалидная запись и дубли ID — исключение
//   KineticsCatalogError (синтетические записи существуют только в
//   этом тесте и явно помечены SYNTHETIC);
// - ошибки схемы: kind, модель концентраций, единицы vs порядок,
//   T-диапазоны, Fc, пересечение диапазонов k0/k∞, provenance,
//   rawInput с нечисловыми значениями.

import { describe, expect, it } from 'vitest';
import {
  buildKineticsCatalog,
  buildKidaTbReactionRecord,
  kidaTbRecordId,
  KIDA_TB_RAW_RECORDS,
  KINETIC_CATALOG_DATA,
  KIDA_DATABASE_SOURCE,
  KIDA_TB_EXPORT_SOURCE,
  JPL_EVALUATION_SOURCE,
  KINETIC_CATALOG_BLOCKING_QUESTIONS,
  KineticsCatalogError
} from '../Data/kineticsCatalog';
import type { KineticReactionRecord, ArrheniusParameters, FallOffParameters } from '../Core/kinetics';
import {
  evaluateRateConstant,
  validateKineticReactionRecord,
  KineticsError
} from '../Core/kinetics';
import type { DataProvenance } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';

// ID базового набора (стабильные, в порядке KIDA_TB_RAW_RECORDS).
const EXPECTED_IDS: readonly string[] = [
  'kida-tb-2015-03-19-1',
  'kida-tb-2015-03-19-70',
  'kida-tb-2015-03-19-72',
  'kida-tb-2015-03-19-89',
  'kida-tb-2015-03-19-106'
];

// Дословная строка CSV реакции №1 (kida_reac_tb_2015-03-19_1.csv,
// копия SophiaAtmo/PATMO@d78ec8e2) — независимый контроль rawLine.
const RAW_LINE_REACTION_1 =
  'H;H;N2;H2;N2; ; ; ; ; 9.140e-33;-6.000e-01; 0.000e+00; 3.160e+00; 1.000e+02;logn;3; 1.000e-10; 0.000e+00; 0.000e+00; 2.000e+00; 1.000e+02;logn; 3; 0.000e+00; 1.000e+99; 1.000e-99; 1.000e+99; 0.000e+00;logn; 7;    50;   200; -9999;  9999; 6;    1;1 ;2';

/** Вызывает fn, ожидает KineticsError и возвращает её (не бросает дальше). */
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

/** Проверяет, что валидатор находит проблему, содержащую фрагмент текста. */
function expectProblem(record: unknown, fragment: string): void {
  const problems = validateKineticReactionRecord(record);
  expect(problems.some((p) => p.includes(fragment))).toBe(true);
}

// --------------------------------------------
// Синтетические фикстуры (только этот тест; НЕ данные JPL/KIDA)
// --------------------------------------------

/** Provenance синтетической фикстуры: явно помечена, не выдаётся за реальный источник. */
function syntheticProvenance(): DataProvenance {
  return {
    sourceName: 'SYNTHETIC: тестовая фикстура Stage 4.5.4 (не данные JPL/KIDA)',
    datasetId: 'synthetic-kinetics-fixture',
    recordId: 'synthetic:test',
    note: 'SYNTHETIC: запись существует только в тесте'
  };
}

/** Параметры Аррениуса SYNTHETIC-фикстуры (порядок 2, molecule_cm3). */
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

/** Параметры fall-off SYNTHETIC-фикстуры (порядок 2, Troe-форма). */
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

/** SYNTHETIC-запись с известной аррениусовской константой (порядок 2). */
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

/** SYNTHETIC-запись с известной fall-off константой (порядок 2). */
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

/** rawInput provenance константы записи каталога (универсальный доступ). */
function rawInputOf(record: KineticReactionRecord): Record<string, number | string | boolean | null> {
  if (record.rateConstant.status !== 'unknown') {
    throw new Error(`запись «${record.id}» должна иметь unknown-константу`);
  }
  const provenance = record.rateConstant.provenance;
  if (provenance === undefined || provenance.rawInput === undefined) {
    throw new Error(`запись «${record.id}» должна нести rawInput в provenance константы`);
  }
  return provenance.rawInput;
}

// --------------------------------------------
// 1. Базовый набор каталога
// --------------------------------------------

describe('Stage 4.5.4: каталог кинетических записей KIDA (базовый набор)', () => {
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
    const numbers = KIDA_TB_RAW_RECORDS.map((raw) => raw.kidaReactionNumber);
    expect(numbers).toEqual([1, 70, 72, 89, 106]);
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

  it('спот-чек дословных блоков k0/k∞/Fc экспорта в rawInput (литералы CSV)', () => {
    const byId = new Map(KINETIC_CATALOG_DATA.map((r) => [r.id, r]));
    const r1 = rawInputOf(byId.get('kida-tb-2015-03-19-1')!);
    expect(r1.k0Alpha).toBe(9.14e-33);
    expect(r1.k0Beta).toBe(-0.6);
    expect(r1.kInfAlpha).toBe(1.0e-10);
    expect(r1.tMinK).toBe(50);
    expect(r1.tMaxK).toBe(200);
    expect(r1.fcA).toBe(0);

    const r70 = rawInputOf(byId.get('kida-tb-2015-03-19-70')!);
    expect(r70.k0Alpha).toBe(4.33e-32);
    expect(r70.k0Beta).toBe(-1.0);

    const r72 = rawInputOf(byId.get('kida-tb-2015-03-19-72')!);
    expect(r72.k0Alpha).toBe(6.78e-31);
    expect(r72.k0Beta).toBe(-2.0);

    const r89 = rawInputOf(byId.get('kida-tb-2015-03-19-89')!);
    expect(r89.kInfAlpha).toBe(4.9e-11);
    expect(r89.kInfBeta).toBe(-0.4);
    expect(r89.fcA).toBe(0.2);
    expect(r89.fcUncertaintyFactor).toBe(0.067);
    expect(r89.tMinK).toBe(200);
    expect(r89.tMaxK).toBe(2200);
    expect(r89.networkMultiplicity).toBe(3);

    const r106 = rawInputOf(byId.get('kida-tb-2015-03-19-106')!);
    expect(r106.k0Alpha).toBe(4.4e-32);
    expect(r106.k0Beta).toBe(-1.3);
    expect(r106.kInfAlpha).toBe(7.5e-11);
    expect(r106.kInfBeta).toBe(0.2);
    expect(r106.fcA).toBe(0.4);
    expect(r106.tMinK).toBe(200);
    expect(r106.tMaxK).toBe(300);

    for (const record of KINETIC_CATALOG_DATA) {
      const raw = rawInputOf(record);
      expect(raw.recommendation).toBe(2);
      expect(raw.globalFormulaCode).toBe(6);
    }
  });

  it('rawLine каждой записи — дословная строка CSV (реакция №1 сверена полностью)', () => {
    const byId = new Map(KINETIC_CATALOG_DATA.map((r) => [r.id, r]));
    expect(rawInputOf(byId.get('kida-tb-2015-03-19-1')!).rawLine).toBe(RAW_LINE_REACTION_1);
    for (const raw of KIDA_TB_RAW_RECORDS) {
      // дословность: строка начинается с колонок реагентов и завершается
      // хвостовыми полями экспорта «№ реакции; множественность;
      // recommendation» (числа CSV выровнены пробелами — сверка полей
      // после split/trim, паддинг не переинтерпретируется)
      expect(raw.rawLine.startsWith(raw.reactants.join(';') + ';')).toBe(true);
      const tail = raw.rawLine.split(';').slice(-3).map((field) => field.trim());
      expect(tail).toEqual([
        String(raw.kidaReactionNumber),
        String(raw.networkMultiplicity),
        String(raw.recommendation)
      ]);
    }
    // сентинелы блока Fc «не задано» сохранены без переинтерпретации
    expect(rawInputOf(byId.get('kida-tb-2015-03-19-70')!).fcB).toBe(1e99);
    expect(rawInputOf(byId.get('kida-tb-2015-03-19-70')!).fcC).toBe(1e-99);
  });

  it('provenance каждой записи идентифицирует источник с честной лицензией unverified', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      const provenance = record.provenance;
      expect(provenance?.sourceName).toBe(KIDA_TB_EXPORT_SOURCE.sourceName);
      expect(provenance?.datasetId).toBe('kida_reac_tb_2015-03-19_1.csv');
      expect(provenance?.datasetVersion ?? '').toContain('d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd');
      expect(provenance?.retrievedAt).toBe('2026-11-03');
      expect(provenance?.license ?? '').toContain('unverified');
      expect(provenance?.reference ?? '').toContain('Wakelam');
      const rateProvenance =
        record.rateConstant.status === 'unknown' ? record.rateConstant.provenance : undefined;
      const recordNumber = KIDA_TB_RAW_RECORDS.find(
        (raw) => kidaTbRecordId(raw.kidaReactionNumber) === record.id
      )!.kidaReactionNumber;
      expect(rateProvenance?.recordId).toBe(`kida-tb-2015-03-19:reaction=${recordNumber}`);
      expect(rateProvenance?.limitations ?? '').toContain('KINETIC_CATALOG_BLOCKING_QUESTIONS');
    }
  });

  it('reaction-строки человекочитаемы и соответствуют составу записи', () => {
    const byId = new Map(KINETIC_CATALOG_DATA.map((r) => [r.id, r]));
    expect(byId.get('kida-tb-2015-03-19-1')!.reaction).toBe('H + H + N2 → H2 + N2');
    expect(byId.get('kida-tb-2015-03-19-70')!.reaction).toBe('O + H + N2 → OH + N2');
    expect(byId.get('kida-tb-2015-03-19-72')!.reaction).toBe('OH + H + N2 → H2O + N2');
    expect(byId.get('kida-tb-2015-03-19-89')!.reaction).toBe('O + NO + N2 → NO2 + N2');
    expect(byId.get('kida-tb-2015-03-19-106')!.reaction).toBe('H + O2 + N2 → O2H + N2');
  });

  it('детерминированность: повторная сборка каталога даёт идентичный результат', () => {
    const a = buildKineticsCatalog();
    const b = buildKineticsCatalog();
    expect(b.listIds()).toEqual([...a.listIds()]);
    for (const id of a.listIds()) {
      expect(JSON.stringify(b.get(id))).toBe(JSON.stringify(a.get(id)));
    }
    for (const raw of KIDA_TB_RAW_RECORDS) {
      expect(JSON.stringify(buildKidaTbReactionRecord(raw))).toBe(
        JSON.stringify(buildKidaTbReactionRecord(raw))
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

// --------------------------------------------
// 2. Fail-closed интеграция с вычислителем k(T) (4.5.2)
// --------------------------------------------

describe('Stage 4.5.4: fail-closed интеграция с вычислителем k(T)', () => {
  it('evaluateRateConstant отклоняет каждую запись каталога (no_kinetic_data)', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      const error = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
      expect(error.code, `запись ${record.id}`).toBe('no_kinetic_data');
    }
  });

  it('блокирующие вопросы этапа зафиксированы: Fc, JPL Evaluation No. 20, лицензия', () => {
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.length).toBeGreaterThanOrEqual(3);
    expect(
      KINETIC_CATALOG_BLOCKING_QUESTIONS.some((q) => q.includes('JPL Evaluation No. 20'))
    ).toBe(true);
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.some((q) => q.includes('Fc'))).toBe(true);
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.some((q) => q.includes('лицензия'))).toBe(true);
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
    expect(KIDA_TB_EXPORT_SOURCE.note ?? '').toContain('#MODIFIED');
    expect(JPL_EVALUATION_SOURCE.note ?? '').toContain('НЕ импортирован');
    expect(JPL_EVALUATION_SOURCE.citation).toContain('10.48577/jpl.KFQ0TZ');
  });
});

// --------------------------------------------
// 3. Строгая сборка каталога (синтетические записи — только здесь)
// --------------------------------------------

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

// --------------------------------------------
// 4. Ошибки схемы, единицы и диапазоны (валидатор 4.5.1)
// --------------------------------------------

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
