/**
 * Stage 4.5.4 (ревизия 4.5.4.7) — тесты каталога кинетических записей KIDA/JPL.
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
 *
 * Уточнение per-record provenance (2026-11-08, четвёртая корректировка):
 * подтверждена библиографическая идентификация модельного источника №70
 * (Morris, AIAA 2004-0463, NASA NTRS 20040016354; Table 1 — вторичное
 * воспроизведение механизма Petersen–Hanson 1999, DOI 10.2514/2.5468;
 * collision efficiencies H₂ = 2.0, H₂O = 6.0, остальные = 1.0 — единичная
 * эффективность N₂ есть модельная конвенция, НЕ эксперимент); в markers
 * добавлены NIST-суффиксы записей (1983COH/WES531:43, 1977ZEL/ERL939:2,
 * 1988GOO/HAY745:2, 1983SCH/KOH361:4, 1987HSU/DUR1895:1) и
 * опубликованные диапазоны давлений измерений (№72: 0.004–0.0147 bar и
 * 0.12–0.17 bar, ошибки ~50% по первичному абстракту при отсутствии
 * неопределённости в NIST; №89: 0.0133–0.0735 bar; №106:
 * 0.0064–0.0401 bar); все записи остаются status='unknown', fail-closed
 * НЕ ослаблен; число тестов НЕ менялось.
 *
 * Ревизия Stage 4.5.4.6 (2026-11-09, реализация): запись №106
 * (H + O₂ + N₂ → HO₂ + N₂) — первая запись каталога с реализованной
 * N₂-специфической fall-off параметризацией (контракт 4.5.2 без
 * изменений): k0 — Michael et al. (2002), DOI 10.1021/jp020229w
 * (каталог использует округлённую форму, НЕ дословное уравнение);
 * k∞, Fc — Fernandes et al. (2008), DOI 10.1039/b804553d; N —
 * каноническая Troe/IUPAC-форма N(Fc) контракта 4.5.2;
 * подтверждённая область — пересечение диапазонов пределов [300, 400] K.
 * Корректировка научной атрибуции (2026-11-09, та же ревизия 4.5.4.6):
 * high-pressure limit — интерпретация/представление экспериментальных
 * fall-off данных Fernandes et al. (M = N₂, 300–900 K, 1.5–950 bar)
 * совместно с теоретическим моделированием (Troe, Ushakov (2008),
 * J. Chem. Phys. 128, 204307, DOI 10.1063/1.2917201), а НЕ единоличное
 * прямое измерение асимптотического предела; используемая форма k0 —
 * округление (опорная 300 K, показатель −1.2; опубликованы (T/298)^-1.232
 * у Michael et al. и (T/298)^-1.23 у Fernandes et al.); научные параметры
 * применимы для M = N₂, thirdBodyNote «M = N₂» — только описательная
 * метка: вычислитель 4.5.2 получает числовую [M] и НЕ проверяет химическую
 * идентичность третьего тела, обязанность передавать концентрацию именно
 * N₂ (не воздуха и не смеси) лежит на вызывающем коде; добавлены
 * регрессионные тесты атрибуции k∞/k0 и ограничения по третьему телу.
 * Тесты обновлены с разделением по записям: unknown-инварианты четырёх
 * записей сохранены; тесты лицензионной безопасности допускают ключи
 * контракта 4.5.2 ТОЛЬКО в записи №106 (KIDA-ключи запрещены во всём
 * каталоге); добавлена регрессионная группа №106: структура, точные
 * параметры и знаки показателей, единицы, Fc/N, контрольные значения
 * k(300 K, 1 bar N₂) и k(400 K, 1 bar N₂), fail-closed вне [300, 400] K,
 * зафиксированное (НЕ разрешённое) расхождение с N₂-серией Hsu 1987/1989,
 * отсутствие других третьих тел; четыре записи — без изменений.
 *
 * Ревизия Stage 4.5.4.7 (2026-11-09, реализация): запись №89
 * (O + NO + N₂ → NO₂ + N₂) — вторая запись каталога с реализованной
 * N₂-специфической fall-off параметризацией (контракт 4.5.2 без
 * изменений): k0 — ОЦЕНОЧНАЯ рекомендация по Whytock, Michael, Payne
 * (1976), DOI 10.1016/0009-2614(76)80655-0 и Schieferstein et al.
 * (1983), DOI 10.1002/bbpc.19830870419 (НЕ построена только на
 * N₂-экспериментах, с относительными эффективностями третьих тел);
 * k∞ — рекомендованное температурное представление оценки по Hippler
 * et al. (1999), Part I, DOI 10.1039/A806520I (полный текст Part I
 * в этой сессии НЕ получен, таблицы НЕ читались; Part II — только
 * качественная поддержка); Fc = 0.85, N — каноническая Troe/IUPAC-форма
 * N(Fc) контракта 4.5.2; подтверждённая область — пересечение
 * диапазонов пределов [200, 300] K. Контрольная точка IUPAC NOx1
 * (1.5×10⁻¹²) формулой 4.5.2 НЕ воспроизводится (вычисление даёт
 * ≈ 2.197×10⁻¹²): расхождение зафиксировано и НЕ разрешено, параметры
 * НЕ менялись ради согласования, 1.5×10⁻¹² НЕ используется как тестовый
 * oracle, вычисленное значение НЕ выдаётся за измерение, недоказанные
 * гипотезы о происхождении контрольной точки НЕ воспроизводятся.
 * Тесты обновлены с разделением по записям: unknown-инварианты трёх
 * записей (№1, №70, №72) сохранены; тесты лицензионной безопасности
 * допускают ключи контракта 4.5.2 в записях №89 и №106 (KIDA-ключи
 * запрещены во всём каталоге); добавлена регрессионная группа №89
 * (14 тестов): структура, точные параметры и знаки показателей,
 * единицы, Fc/N, контроль формулы 4.5.2 (Pr/F/k против независимо
 * вычисленных значений и контрольной точки), fail-closed вне
 * [200, 300] K, provenance-тесты предупреждения о контрольной точке
 * и научной атрибуции k0/k∞; записи №1, №70, №72, №106 — без изменений.
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
  1: ['1983COH/WES531:43', '10.1016/0010-2180(69)90005-4', '1.5 раза'],
  70: [
    '10.1063/1.555759',
    'AIAA 2004-0463',
    '20040016354',
    '10.2514/2.5468',
    'Petersen',
    'unresolved'
  ],
  72: [
    '1977ZEL/ERL939:2',
    '1988GOO/HAY745:2',
    '10.1039/F29888400745',
    '10.1021/jp711800z',
    'Fcent(N₂) = 0.73',
    '0.004–0.0147 bar',
    '0.12–0.17 bar',
    '50%'
  ],
  89: [
    '1983SCH/KOH361:4',
    '10.1002/bbpc.19830870419',
    '10.1039/A806520I',
    '0.0133–0.0735 bar',
    '«No change»',
    'ДЛЯ ВОЗДУХА'
  ],
  106: [
    '1987HSU/DUR1895:1',
    '10.1021/j100291a043',
    '0.0064–0.0401 bar',
    '«No change»',
    'ДЛЯ ВОЗДУХА'
  ]
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

  it('константы трёх записей — unknown без параметров; №89 и №106 — известные fall-off параметризации', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      if (record.id === 'kida-tb-2015-03-19-106' || record.id === 'kida-tb-2015-03-19-89') {
        expect(record.rateConstant.status).toBe('known');
        continue;
      }
      expect(record.rateConstant.status, 'запись ' + record.id).toBe('unknown');
      const rate = record.rateConstant as { status: 'unknown'; note?: string; parameters?: unknown };
      expect(rate.parameters, 'запись ' + record.id).toBeUndefined();
      expect(rate.note ?? '').not.toBe('');
    }
  });

  it('kind/порядок/модель концентраций: elementary, molecule_cm3; порядок null у unknown-записей, 2 у №89 и №106', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      expect(record.kind).toBe('elementary');
      expect(record.concentrationModel).toBe('molecule_cm3');
      expect(record.overallOrder, 'запись ' + record.id).toBe(
        record.id === 'kida-tb-2015-03-19-106' || record.id === 'kida-tb-2015-03-19-89' ? 2 : null
      );
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

  it('provenance каждой записи идентифицирует источник честно: KIDA unverified; №89 и №106 — параметры из первичных статей', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      const provenance = record.provenance;
      expect(provenance?.sourceName).toBe(KIDA_TB_EXPORT_SOURCE.sourceName);
      expect(provenance?.datasetId).toBe('kida_reac_tb_2015-03-19_1.csv');
      expect(provenance?.datasetVersion ?? '').toContain('d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd');
      expect(provenance?.datasetVersion ?? '').toContain('data/kida/');
      expect(provenance?.retrievedAt).toBe('2026-11-03');
      expect(provenance?.license ?? '').toContain('unverified');
      expect(provenance?.license ?? '').toContain('Legal Notices');
      if (record.id === 'kida-tb-2015-03-19-89') {
        expect(provenance?.recordId).toBe('kida-tb-2015-03-19:reaction=89');
        expect(provenance?.reference ?? '').toContain('10.1016/0009-2614(76)80655-0');
        expect(provenance?.reference ?? '').toContain('10.1002/bbpc.19830870419');
        expect(provenance?.reference ?? '').toContain('10.1039/A806520I');
        expect(provenance?.note ?? '').toContain('оценочной рекомендации');
        expect(provenance?.note ?? '').toContain('personal use only');
        continue;
      }
      if (record.id === 'kida-tb-2015-03-19-106') {
        expect(provenance?.recordId).toBe('kida-tb-2015-03-19:reaction=106');
        expect(provenance?.reference ?? '').toContain('10.1021/jp020229w');
        expect(provenance?.reference ?? '').toContain('10.1039/b804553d');
        expect(provenance?.note ?? '').toContain('первичным публикациям');
        expect(provenance?.note ?? '').toContain('personal use only');
        continue;
      }
      expect(provenance?.reference ?? '').toContain('Wakelam');
      const rateProvenance = rateProvenanceOf(record);
      const identity = KIDA_TB_RECORD_IDENTITIES.find(
        (i) => kidaTbRecordId(i.kidaReactionNumber) === record.id
      )!;
      expect(rateProvenance.recordId).toBe('kida-tb-2015-03-19:reaction=' + identity.kidaReactionNumber);
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
  it('evaluateRateConstant отклоняет три unknown-записи (no_kinetic_data); №89 и №106 — не no_kinetic_data', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      const error = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
      if (record.id === 'kida-tb-2015-03-19-106' || record.id === 'kida-tb-2015-03-19-89') {
        expect(error.code).toBe('invalid_third_body');
      } else {
        expect(error.code, 'запись ' + record.id).toBe('no_kinetic_data');
      }
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
  it('rawInput unknown-записей содержит только разрешённые ключи; №89 и №106 — без KIDA rawInput', () => {
    const allowedKeys = [
      'kidaReactionNumber',
      'reactant1',
      'reactant2',
      'reactant3',
      'product1',
      'product2'
    ];
    for (const record of KINETIC_CATALOG_DATA) {
      if (record.id === 'kida-tb-2015-03-19-106' || record.id === 'kida-tb-2015-03-19-89') {
        // параметры записей №89 и №106 — из первичных публикаций; KIDA-rawInput не применяется
        const serialized = JSON.stringify(record);
        expect(serialized.includes('rawInput'), 'запись ' + record.id + ' без rawInput').toBe(false);
        continue;
      }
      const rawInput = rateProvenanceOf(record).rawInput;
      expect(Object.keys(rawInput ?? {}).sort()).toEqual([...allowedKeys].sort());
    }
  });

  it('числа unknown-записей — только номера реакций KIDA; числа №89 и №106 — точные параметры первичных источников', () => {
    const collectNumeric = (node: unknown, path: string, into: { path: string; value: number }[]): void => {
      if (typeof node === 'number') {
        into.push({ path, value: node });
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, i) => collectNumeric(item, path + '[' + i + ']', into));
        return;
      }
      if (node !== null && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          collectNumeric(value, path + '.' + key, into);
        }
      }
    };
    for (const record of KINETIC_CATALOG_DATA) {
      const leaves: { path: string; value: number }[] = [];
      collectNumeric(record, 'record', leaves);
      expect(leaves.length, 'запись ' + record.id).toBeGreaterThan(0);
      if (record.id === 'kida-tb-2015-03-19-89') {
        const byPath = new Map(leaves.map((leaf) => [leaf.path, leaf.value]));
        const expected: ReadonlyArray<[string, number]> = [
          ['record.overallOrder', 2],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.preExponentialA', 1.0e-31],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.temperatureExponentN', -1.6],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.energy.valueK', 0],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.temperatureRangeK.min', 200],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.temperatureRangeK.max', 300],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.preExponentialA', 5.0e-11],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.temperatureExponentN', -0.3],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.energy.valueK', 0],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.temperatureRangeK.min', 200],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.temperatureRangeK.max', 400],
          ['record.rateConstant.parameters.fallOff.centeringFactorFc', 0.85],
          ['record.rateConstant.parameters.fallOff.broadeningN', 0.8396379643428482]
        ];
        expect(byPath.size, 'числовых листьев №89').toBe(expected.length);
        for (const [path, value] of expected) {
          expect(byPath.get(path), 'путь ' + path).toBe(value);
        }
        continue;
      }
      if (record.id === 'kida-tb-2015-03-19-106') {
        const byPath = new Map(leaves.map((leaf) => [leaf.path, leaf.value]));
        const expected: ReadonlyArray<[string, number]> = [
          ['record.overallOrder', 2],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.preExponentialA', 4.3e-32],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.temperatureExponentN', -1.2],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.energy.valueK', 0],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.temperatureRangeK.min', 300],
          ['record.rateConstant.parameters.fallOff.lowPressureLimit.temperatureRangeK.max', 900],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.preExponentialA', 9.5e-11],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.temperatureExponentN', 0.44],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.energy.valueK', 0],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.temperatureRangeK.min', 200],
          ['record.rateConstant.parameters.fallOff.highPressureLimit.temperatureRangeK.max', 400],
          ['record.rateConstant.parameters.fallOff.centeringFactorFc', 0.5],
          ['record.rateConstant.parameters.fallOff.broadeningN', 1.1323080944932562]
        ];
        expect(byPath.size, 'числовых листьев №106').toBe(expected.length);
        for (const [path, value] of expected) {
          expect(byPath.get(path), 'путь ' + path).toBe(value);
        }
        continue;
      }
      for (const leaf of leaves) {
        expect(Number.isInteger(leaf.value), 'путь ' + leaf.path).toBe(true);
        expect(
          KIDA_REACTION_NUMBERS.includes(leaf.value),
          'путь ' + leaf.path + ' (' + leaf.value + ') — допустимы только номера реакций KIDA'
        ).toBe(true);
      }
    }
    const identityLeaves: { path: string; value: number }[] = [];
    collectNumeric(KIDA_TB_RECORD_IDENTITIES, 'identities', identityLeaves);
    expect(identityLeaves.length).toBeGreaterThan(0);
    for (const leaf of identityLeaves) {
      expect(Number.isInteger(leaf.value), 'путь ' + leaf.path).toBe(true);
      expect(KIDA_REACTION_NUMBERS.includes(leaf.value), 'путь ' + leaf.path).toBe(true);
    }
  });

  it('сериализованный каталог не содержит KIDA-ключей; ключи контракта 4.5.2 — только в записях №89 и №106', () => {
    const kidaKeys = [
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
      'networkMultiplicity',
      'recommendation'
    ];
    const contractKeys = [
      'preExponentialA',
      'temperatureExponentN',
      'lowPressureLimit',
      'highPressureLimit',
      'centeringFactorFc',
      'broadeningN',
      'temperatureRangeK'
    ];
    for (const record of KINETIC_CATALOG_DATA) {
      const serialized = JSON.stringify(record);
      for (const key of kidaKeys) {
        expect(serialized.includes('"' + key + '"'), 'ключ ' + key + ' в ' + record.id).toBe(false);
      }
      for (const key of contractKeys) {
        const inRecord = serialized.includes('"' + key + '"');
        if (record.id === 'kida-tb-2015-03-19-106' || record.id === 'kida-tb-2015-03-19-89') {
          expect(inRecord, 'ключ ' + key + ' должен присутствовать в ' + record.id).toBe(true);
        } else {
          expect(inRecord, 'ключ ' + key + ' в ' + record.id).toBe(false);
        }
      }
    }
    const identitiesSerialized = JSON.stringify(KIDA_TB_RECORD_IDENTITIES);
    for (const key of [...kidaKeys, ...contractKeys]) {
      expect(identitiesSerialized.includes('"' + key + '"'), 'ключ ' + key + ' в identities').toBe(false);
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

  it('аудит: №1/№70/№72 не верифицированы (unknown); №89 и №106 — known по первичным источникам (не по JPL)', () => {
    for (const auditRecord of JPL_EVALUATION_20_ACCESS_AUDIT.records) {
      expect(auditRecord.coverage).toBe('not_established');
      const markers = AUDIT_RECORD_PROVENANCE_MARKERS[auditRecord.kidaReactionNumber] ?? [];
      for (const marker of markers) {
        expect(auditRecord.note, 'запись ' + auditRecord.kidaTbRecordId + ', маркер ' + marker).toContain(marker);
      }
      if (auditRecord.kidaReactionNumber === 89) {
        expect(auditRecord.parametersVerified).toBe(true);
        expect(auditRecord.statusAfterAudit).toBe('known');
        expect(auditRecord.note).toContain('10.1016/0009-2614(76)80655-0');
        expect(auditRecord.note).toContain('10.1002/bbpc.19830870419');
        expect(auditRecord.note).toContain('10.1039/A806520I');
        expect(auditRecord.note).toContain('[200, 300] K');
        expect(auditRecord.note).toContain('не верифицированы');
        continue;
      }
      if (auditRecord.kidaReactionNumber === 106) {
        expect(auditRecord.parametersVerified).toBe(true);
        expect(auditRecord.statusAfterAudit).toBe('known');
        expect(auditRecord.note).toContain('10.1021/jp020229w');
        expect(auditRecord.note).toContain('10.1039/b804553d');
        expect(auditRecord.note).toContain('[300, 400] K');
        expect(auditRecord.note).toContain('не верифицированы');
        continue;
      }
      expect(auditRecord.parametersVerified).toBe(false);
      expect(auditRecord.statusAfterAudit).toBe('unknown');
      expect(auditRecord.note).toContain('не верифицированы');
      expect(auditRecord.note).toContain('no_kinetic_data');
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

  it('fail-closed сохранён: 3 записи unknown/no_kinetic_data; №89 отказывает вне [200, 300] K; №106 — вне [300, 400] K', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      if (record.id === 'kida-tb-2015-03-19-89') {
        const error = kineticsError(() =>
          evaluateRateConstant(record, quantity(350, 'K'), { thirdBodyConcentration: 2.4e19 })
        );
        expect(error.code).toBe('temperature_out_of_range');
        continue;
      }
      if (record.id === 'kida-tb-2015-03-19-106') {
        const error = kineticsError(() =>
          evaluateRateConstant(record, quantity(500, 'K'), { thirdBodyConcentration: 2.4e19 })
        );
        expect(error.code).toBe('temperature_out_of_range');
        continue;
      }
      expect(record.rateConstant.status, 'запись ' + record.id).toBe('unknown');
      const error = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
      expect(error.code, 'запись ' + record.id).toBe('no_kinetic_data');
    }
    expect(KINETIC_CATALOG_BLOCKING_QUESTIONS.length).toBe(4);
    expect(
      KINETIC_CATALOG_BLOCKING_QUESTIONS.some(
        (q) => q.includes('JPL Evaluation No. 20') && q.includes('JPL_EVALUATION_20_ACCESS_AUDIT')
      )
    ).toBe(true);
  });
});


describe('Stage 4.5.4.6: N₂ fall-off параметризация записи №106 (Michael 2002 / Fernandes 2008)', () => {
  const record106 = KINETIC_CATALOG_DATA.find((r) => r.id === 'kida-tb-2015-03-19-106');
  if (record106 === undefined) {
    throw new Error('запись kida-tb-2015-03-19-106 отсутствует в каталоге');
  }
  const rate106 = record106.rateConstant;
  if (rate106.status !== 'known') {
    throw new Error('запись №106 должна иметь known-константу');
  }
  const params106 = rate106.parameters;
  if (params106.kind !== 'fall_off') {
    throw new Error('запись №106 должна быть fall_off');
  }
  const fallOff106 = params106.fallOff;

  it('структура: elementary, overallOrder = 2, molecule_cm3, третье тело M = N₂', () => {
    expect(record106.kind).toBe('elementary');
    expect(record106.overallOrder).toBe(2);
    expect(record106.concentrationModel).toBe('molecule_cm3');
    expect(fallOff106.thirdBodyNote).toBe('M = N₂');
    expect(record106.reaction).toBe('H + O2 + N2 → O2H + N2');
  });

  it('k0 = 4.3e-32·(T/300)^-1.2 (округлённая каталожная форма по Michael et al. 2002), [300, 900] K, cm6_per_molecule2_per_s', () => {
    const k0 = fallOff106.lowPressureLimit;
    expect(k0.preExponentialA).toBe(4.3e-32);
    expect(k0.temperatureExponentN).toBe(-1.2);
    expect(k0.temperatureExponentN).toBeLessThan(0);
    expect(k0.energy).toEqual({ form: 'E_over_R', valueK: 0 });
    expect(k0.temperatureRangeK).toEqual({ min: 300, max: 900 });
    expect(k0.unit).toBe('cm6_per_molecule2_per_s');
    expect(k0.provenance.reference ?? '').toContain('10.1021/jp020229w');
  });

  it('k∞ = 9.5e-11·(T/300)^+0.44 (положительный знак показателя), [200, 400] K, cm3_per_molecule_per_s (интерпретация fall-off данных Fernandes et al. 2008)', () => {
    const kInf = fallOff106.highPressureLimit;
    expect(kInf.preExponentialA).toBe(9.5e-11);
    expect(kInf.temperatureExponentN).toBe(0.44);
    expect(kInf.temperatureExponentN).toBeGreaterThan(0);
    expect(kInf.energy).toEqual({ form: 'E_over_R', valueK: 0 });
    expect(kInf.temperatureRangeK).toEqual({ min: 200, max: 400 });
    expect(kInf.unit).toBe('cm3_per_molecule_per_s');
    expect(kInf.provenance.reference ?? '').toContain('10.1039/b804553d');
  });

  it('единицы пределов различны: k0 — порядок 3 (overallOrder + 1), k∞ — порядок 2 (overallOrder)', () => {
    expect(fallOff106.lowPressureLimit.unit).not.toBe(fallOff106.highPressureLimit.unit);
    expect(fallOff106.lowPressureLimit.unit).toBe('cm6_per_molecule2_per_s');
    expect(fallOff106.highPressureLimit.unit).toBe('cm3_per_molecule_per_s');
    expect(record106.overallOrder).toBe(2);
  });

  it('Fc = 0.5; N = 0.75 − 1.27·log10(Fc) ≈ 1.1323 (каноническая Troe/IUPAC-форма контракта 4.5.2)', () => {
    expect(fallOff106.centeringFactorFc).toBe(0.5);
    expect(fallOff106.broadeningN).toBeGreaterThan(0);
    expect(fallOff106.broadeningN).toBeCloseTo(0.75 - 1.27 * Math.log10(0.5), 12);
  });

  it('подтверждённая область полной параметризации — пересечение диапазонов пределов [300, 400] K', () => {
    const at300 = evaluateRateConstant(record106, quantity(300, 'K'), { thirdBodyConcentration: 2.4e19 });
    expect(at300.appliedRangeK).toEqual({ min: 300, max: 400 });
    const at400 = evaluateRateConstant(record106, quantity(400, 'K'), { thirdBodyConcentration: 1.8e19 });
    expect(at400.appliedRangeK).toEqual({ min: 300, max: 400 });
    expect(at300.dataStatus).toBe('known');
    expect(at300.unit).toBe('cm3_per_molecule_per_s');
  });

  it('контрольные значения 4.5.2: k(300 K, 1 bar N₂) ≈ 8.636e-13; k(400 K, 1 bar N₂) ≈ 4.787e-13 см³ molecule⁻¹ s⁻¹', () => {
    const BOLTZMANN_J_PER_K = 1.380649e-23; // точная константа СИ 2019
    const n2At1Bar = (T: number): number => 1e5 / (BOLTZMANN_J_PER_K * T) / 1e6; // molecule/cm³
    const at300 = evaluateRateConstant(record106, quantity(300, 'K'), {
      thirdBodyConcentration: n2At1Bar(300)
    });
    const at400 = evaluateRateConstant(record106, quantity(400, 'K'), {
      thirdBodyConcentration: n2At1Bar(400)
    });
    expect(at300.value / 8.635754179684402e-13).toBeCloseTo(1, 9);
    expect(at400.value / 4.787381896833177e-13).toBeCloseTo(1, 9);
    expect(at300.fallOff?.reducedPressure ?? 0).toBeCloseTo(0.01092799060314795, 10);
    expect(at400.fallOff?.reducedPressure ?? 0).toBeCloseTo(0.005113309118672614, 10);
  });

  it('№106 больше не отказывает как no_kinetic_data: без [M] — invalid_third_body, с [M] — значение', () => {
    const withoutM = kineticsError(() => evaluateRateConstant(record106, quantity(300, 'K')));
    expect(withoutM.code).not.toBe('no_kinetic_data');
    expect(withoutM.code).toBe('invalid_third_body');
    const withM = evaluateRateConstant(record106, quantity(300, 'K'), { thirdBodyConcentration: 2.4e19 });
    expect(withM.value).toBeGreaterThan(0);
  });

  it('fail-closed №106: вне пересечения [300, 400] K — temperature_out_of_range (без экстраполяции)', () => {
    const below = kineticsError(() =>
      evaluateRateConstant(record106, quantity(250, 'K'), { thirdBodyConcentration: 2.4e19 })
    );
    expect(below.code).toBe('temperature_out_of_range');
    const mid = kineticsError(() =>
      evaluateRateConstant(record106, quantity(600, 'K'), { thirdBodyConcentration: 2.4e19 })
    );
    expect(mid.code).toBe('temperature_out_of_range');
    const above = kineticsError(() =>
      evaluateRateConstant(record106, quantity(950, 'K'), { thirdBodyConcentration: 2.4e19 })
    );
    expect(above.code).toBe('temperature_out_of_range');
  });

  it('расхождение с альтернативной N₂-серией Hsu 1987/1989 зафиксировано в provenance k0 и НЕ объявлено разрешённым', () => {
    const limitations = fallOff106.lowPressureLimit.provenance.limitations ?? '';
    expect(limitations).toContain('Hsu');
    expect(limitations).toContain('10.1021/j100291a043');
    expect(limitations).toContain('10.1021/j100340a003');
    expect(limitations).toContain('6.09e-32');
    expect(limitations).toContain('9.1e-33');
    expect(limitations).toContain('6.2e-32');
    expect(limitations).toContain('НЕ объявляется разрешённым');
    expect(limitations).toContain('ДЛЯ ВОЗДУХА');
    // JPL B1 (воздух) не используется как источник N₂-параметров
    const serialized106 = JSON.stringify(record106);
    expect(serialized106.includes('10.48577/jpl.KFQ0TZ')).toBe(false);
    // IUPAC HOx2 (personal use only) не копируется
    expect(fallOff106.provenance.limitations ?? '').toContain('personal use only');
  });

  it('научная атрибуция k∞: интерпретация fall-off данных Fernandes et al. совместно с Troe, Ushakov (2008); изолированное прямое измерение асимптотического предела НЕ заявляется', () => {
    const kInf = fallOff106.highPressureLimit;
    expect(kInf.provenance.reference ?? '').toContain('10.1039/b804553d');
    expect(kInf.provenance.reference ?? '').toContain('10.1063/1.2917201');
    expect(kInf.provenance.sourceName ?? '').toContain('fall-off');
    // прямое измерение асимптотического предела НЕ заявляется
    expect(kInf.provenance.sourceName ?? '').not.toContain('прямое измерение high-pressure limit');
    expect(kInf.provenance.limitations ?? '').toContain('интерпретация/представление');
    expect(kInf.provenance.limitations ?? '').toContain('1.5–950 bar');
    expect(kInf.provenance.limitations ?? '').toContain('10.1063/1.2917201');
    expect(kInf.provenance.limitations ?? '').toContain('совместно обосновывают');
    expect(kInf.provenance.limitations ?? '').toContain('НЕ заявляется');
  });

  it('используемая форма k0 — округление: опубликованные уравнения Michael/Fernandes с опорной 298 K зафиксированы, дословность НЕ заявляется', () => {
    const k0 = fallOff106.lowPressureLimit;
    expect(k0.provenance.limitations ?? '').toContain('округление');
    expect(k0.provenance.applicability ?? '').toContain('НЕ дословное опубликованное уравнение');
    expect(k0.provenance.applicability ?? '').toContain('(T/298)^-1.232');
    expect(k0.provenance.applicability ?? '').toContain('(T/298)^-1.23');
    expect(k0.preExponentialA).toBe(4.3e-32);
    expect(k0.temperatureExponentN).toBe(-1.2);
  });

  it('ограничение по третьему телу в provenance №106: параметры применимы для M = N₂; thirdBodyNote — описательная метка; идентичность третьего тела вычислителем НЕ проверяется', () => {
    const fo = fallOff106.provenance;
    expect(fo.applicability ?? '').toContain('научные параметры применимы для третьего тела M = N₂');
    expect(fo.limitations ?? '').toContain('только описательная метка');
    expect(fo.limitations ?? '').toContain('НЕ проверяет химическую идентичность третьего тела');
    expect(fo.limitations ?? '').toContain('именно N₂');
    expect(fo.limitations ?? '').toContain('воздуха');
    expect(fo.limitations ?? '').toContain('personal use only');
    // контракт вычислителя НЕ расширялся: thirdBodyNote остаётся единственной N₂-меткой,
    // runtime-проверки химической идентичности третьего тела НЕ появилось и НЕ утверждается
    expect(fallOff106.thirdBodyNote).toBe('M = N₂');
  });

  it('другие третьи тела не появились: thirdBodyNote только у №89 и №106 и равен M = N₂', () => {
    for (const record of KINETIC_CATALOG_DATA) {
      const serialized = JSON.stringify(record);
      if (record.id === 'kida-tb-2015-03-19-106' || record.id === 'kida-tb-2015-03-19-89') {
        expect(serialized).toContain('M = N₂');
        expect(serialized.includes('M = He')).toBe(false);
        expect(serialized.includes('M = Ar')).toBe(false);
        expect(serialized.includes('M = H2')).toBe(false);
      } else {
        expect(serialized.includes('thirdBodyNote'), 'запись ' + record.id).toBe(false);
      }
    }
  });

  it('записи №1, №70, №72 остаются unknown, fail-closed; числовых параметров у них нет', () => {
    const otherIds = ['kida-tb-2015-03-19-1', 'kida-tb-2015-03-19-70', 'kida-tb-2015-03-19-72'];
    for (const id of otherIds) {
      const record = KINETIC_CATALOG_DATA.find((r) => r.id === id);
      if (record === undefined) {
        throw new Error('запись ' + id + ' отсутствует');
      }
      expect(record.rateConstant.status, 'запись ' + id).toBe('unknown');
      expect(record.overallOrder).toBeNull();
      const error = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
      expect(error.code, 'запись ' + id).toBe('no_kinetic_data');
      const serialized = JSON.stringify(record);
      expect(serialized.includes('preExponentialA')).toBe(false);
      expect(serialized.includes('lowPressureLimit')).toBe(false);
    }
  });
});

describe('Stage 4.5.4.7: N₂ fall-off параметризация записи №89 (Whytock 1976 / Schieferstein 1983 / Hippler 1999)', () => {
  const record89 = KINETIC_CATALOG_DATA.find((r) => r.id === 'kida-tb-2015-03-19-89');
  if (record89 === undefined) {
    throw new Error('запись kida-tb-2015-03-19-89 отсутствует в каталоге');
  }
  const rate89 = record89.rateConstant;
  if (rate89.status !== 'known') {
    throw new Error('запись №89 должна иметь known-константу');
  }
  const params89 = rate89.parameters;
  if (params89.kind !== 'fall_off') {
    throw new Error('запись №89 должна быть fall_off');
  }
  const fallOff89 = params89.fallOff;

  it('структура: elementary, overallOrder = 2, molecule_cm3, третье тело M = N₂', () => {
    expect(record89.kind).toBe('elementary');
    expect(record89.overallOrder).toBe(2);
    expect(record89.concentrationModel).toBe('molecule_cm3');
    expect(fallOff89.thirdBodyNote).toBe('M = N₂');
    expect(record89.reaction).toBe('O + NO + N2 → NO2 + N2');
    expect(record89.id).toBe('kida-tb-2015-03-19-89');
  });

  it('k0 = 1.0e-31·(T/300)^-1.6 (оценочная рекомендация по Whytock 1976 / Schieferstein 1983), [200, 300] K, cm6_per_molecule2_per_s', () => {
    const k0 = fallOff89.lowPressureLimit;
    expect(k0.preExponentialA).toBe(1.0e-31);
    expect(k0.temperatureExponentN).toBe(-1.6);
    expect(k0.temperatureExponentN).toBeLessThan(0);
    expect(k0.energy).toEqual({ form: 'E_over_R', valueK: 0 });
    expect(k0.temperatureRangeK).toEqual({ min: 200, max: 300 });
    expect(k0.unit).toBe('cm6_per_molecule2_per_s');
    expect(k0.provenance.reference ?? '').toContain('10.1016/0009-2614(76)80655-0');
    expect(k0.provenance.reference ?? '').toContain('10.1002/bbpc.19830870419');
  });

  it('k∞ = 5.0e-11·(T/300)^-0.3 (отрицательный знак показателя), [200, 400] K, cm3_per_molecule_per_s (рекомендованное представление оценки по Hippler et al. 1999)', () => {
    const kInf = fallOff89.highPressureLimit;
    expect(kInf.preExponentialA).toBe(5.0e-11);
    expect(kInf.temperatureExponentN).toBe(-0.3);
    expect(kInf.temperatureExponentN).toBeLessThan(0);
    expect(kInf.energy).toEqual({ form: 'E_over_R', valueK: 0 });
    expect(kInf.temperatureRangeK).toEqual({ min: 200, max: 400 });
    expect(kInf.unit).toBe('cm3_per_molecule_per_s');
    expect(kInf.provenance.reference ?? '').toContain('10.1039/A806520I');
  });

  it('единицы пределов различны: k0 — порядок 3 (overallOrder + 1), k∞ — порядок 2 (overallOrder)', () => {
    expect(fallOff89.lowPressureLimit.unit).not.toBe(fallOff89.highPressureLimit.unit);
    expect(fallOff89.lowPressureLimit.unit).toBe('cm6_per_molecule2_per_s');
    expect(fallOff89.highPressureLimit.unit).toBe('cm3_per_molecule_per_s');
    expect(record89.overallOrder).toBe(2);
  });

  it('Fc = 0.85; N = 0.75 − 1.27·log10(Fc) ≈ 0.8396 (каноническая Troe/IUPAC-форма контракта 4.5.2)', () => {
    expect(fallOff89.centeringFactorFc).toBe(0.85);
    expect(fallOff89.broadeningN).toBe(0.8396379643428482);
    expect(fallOff89.broadeningN).toBeGreaterThan(0);
    expect(fallOff89.broadeningN).toBeCloseTo(0.75 - 1.27 * Math.log10(0.85), 12);
  });

  it('подтверждённая область полной параметризации — пересечение диапазонов пределов [200, 300] K', () => {
    const at200 = evaluateRateConstant(record89, quantity(200, 'K'), {
      thirdBodyConcentration: 2.4e19
    });
    expect(at200.appliedRangeK).toEqual({ min: 200, max: 300 });
    const at300 = evaluateRateConstant(record89, quantity(300, 'K'), {
      thirdBodyConcentration: 2.4e19
    });
    expect(at300.appliedRangeK).toEqual({ min: 200, max: 300 });
    expect(at300.dataStatus).toBe('known');
    expect(at300.unit).toBe('cm3_per_molecule_per_s');
  });

  it('контроль формулы 4.5.2: k(300 K, 1 bar N₂) ≈ 2.1973532691787948e-12; Pr ≈ 0.04828647010693281; F ≈ 0.9540791435051059; контрольная точка IUPAC NOx1 (1.5e-12) НЕ воспроизводится', () => {
    const BOLTZMANN_J_PER_K = 1.380649e-23; // точная константа СИ 2019
    const n2At1Bar = (T: number): number => 1e5 / (BOLTZMANN_J_PER_K * T) / 1e6; // molecule/cm³
    const at300 = evaluateRateConstant(record89, quantity(300, 'K'), {
      thirdBodyConcentration: n2At1Bar(300)
    });
    // 2.1973532691787948e-12 — ВЫЧИСЛЕНИЕ по формуле 4.5.2 с каталожными
    // параметрами (НЕ экспериментальное измерение); контрольная точка
    // IUPAC NOx1 = 1.5×10⁻¹² формулой НЕ воспроизводится (относительное
    // расхождение ≈ 46% > 40%) и НЕ используется как oracle
    expect(at300.value / 2.1973532691787948e-12).toBeCloseTo(1, 9);
    expect(at300.fallOff?.reducedPressure ?? 0).toBeCloseTo(0.04828647010693281, 10);
    expect(at300.fallOff?.broadeningFactor ?? 0).toBeCloseTo(0.9540791435051059, 10);
    const relDeviation = Math.abs(at300.value - 1.5e-12) / 1.5e-12;
    expect(relDeviation).toBeGreaterThan(0.4);
  });

  it('№89 больше не отказывает как no_kinetic_data: без [M] — invalid_third_body, с [M] — значение', () => {
    const withoutM = kineticsError(() => evaluateRateConstant(record89, quantity(300, 'K')));
    expect(withoutM.code).not.toBe('no_kinetic_data');
    expect(withoutM.code).toBe('invalid_third_body');
    const withM = evaluateRateConstant(record89, quantity(300, 'K'), { thirdBodyConcentration: 2.4e19 });
    expect(withM.value).toBeGreaterThan(0);
  });

  it('fail-closed №89: вне пересечения [200, 300] K — temperature_out_of_range (без экстраполяции)', () => {
    const below = kineticsError(() =>
      evaluateRateConstant(record89, quantity(150, 'K'), { thirdBodyConcentration: 2.4e19 })
    );
    expect(below.code).toBe('temperature_out_of_range');
    const mid = kineticsError(() =>
      evaluateRateConstant(record89, quantity(350, 'K'), { thirdBodyConcentration: 2.4e19 })
    );
    expect(mid.code).toBe('temperature_out_of_range');
    const above = kineticsError(() =>
      evaluateRateConstant(record89, quantity(500, 'K'), { thirdBodyConcentration: 2.4e19 })
    );
    expect(above.code).toBe('temperature_out_of_range');
  });

  it('ПРЕДУПРЕЖДЕНИЕ о контрольной точке зафиксировано в provenance fall-off параметров: 1.5×10⁻¹² формулой НЕ воспроизводится, расхождение НЕ разрешено', () => {
    const limitations = fallOff89.provenance.limitations ?? '';
    expect(limitations).toContain('ПРЕДУПРЕЖДЕНИЕ');
    expect(limitations).toContain('1.5×10⁻¹²');
    expect(limitations).toContain('2.197×10⁻¹²');
    expect(limitations).toContain('НЕ воспроизводится');
    expect(limitations).toContain('НЕ разрешено');
    expect(limitations).toContain('НЕ менялись ради согласования');
    expect(limitations).toContain('НЕ используется как тестовый oracle');
    expect(limitations).toContain('недоказанные гипотезы НЕ воспроизводятся');
  });

  it('provenance k0: оценочная рекомендация, НЕ построена ТОЛЬКО на N₂-экспериментах; относительные эффективности; JPL C1 (воздух) не использована', () => {
    const k0 = fallOff89.lowPressureLimit;
    expect(k0.provenance.sourceName ?? '').toContain('Оценочная');
    expect(k0.provenance.limitations ?? '').toContain('ОЦЕНОЧНАЯ рекомендация');
    expect(k0.provenance.limitations ?? '').toContain('НЕ построена ТОЛЬКО на N₂-экспериментах');
    expect(k0.provenance.limitations ?? '').toContain('относительных эффективностей');
    expect(k0.provenance.limitations ?? '').toContain('ДЛЯ ВОЗДУХА');
    expect(k0.provenance.license ?? '').toContain('personal use only');
    expect(k0.provenance.reference ?? '').toContain('10.1016/0009-2614(76)80655-0');
    expect(k0.provenance.reference ?? '').toContain('10.1002/bbpc.19830870419');
  });

  it('научная атрибуция k∞: рекомендованное температурное представление оценки по Hippler et al. (1999) Part I; полный текст НЕ получен; Part II — только качественная поддержка', () => {
    const kInf = fallOff89.highPressureLimit;
    expect(kInf.provenance.reference ?? '').toContain('O + NO + N₂');
    expect(kInf.provenance.reference ?? '').toContain('200–400 K, 2–200 bar N₂');
    expect(kInf.provenance.reference ?? '').toContain('5±1×10⁻¹¹');
    expect(kInf.provenance.reference ?? '').toContain('diffusion control');
    expect(kInf.provenance.reference ?? '').toContain('63–72');
    expect(kInf.provenance.limitations ?? '').toContain('рекомендованное температурное представление оценки');
    expect(kInf.provenance.limitations ?? '').toContain('полный текст Part I в этой сессии НЕ получен');
    expect(kInf.provenance.limitations ?? '').toContain('только КАЧЕСТВЕННАЯ');
    expect(kInf.provenance.limitations ?? '').toContain('НЕ выдаётся за экспериментальные измерения');
  });

  it('ограничение по третьему телу в provenance №89: параметры применимы для M = N₂; thirdBodyNote — описательная метка; идентичность третьего тела вычислителем НЕ проверяется', () => {
    const fo = fallOff89.provenance;
    expect(fo.applicability ?? '').toContain('научные параметры применимы для третьего тела M = N₂');
    expect(fo.applicability ?? '').toContain('[200, 300] K');
    expect(fo.limitations ?? '').toContain('только описательная метка');
    expect(fo.limitations ?? '').toContain('именно N₂');
    expect(fo.limitations ?? '').toContain('воздуха');
    expect(fo.limitations ?? '').toContain('personal use only');
    // контракт вычислителя НЕ расширялся: thirdBodyNote остаётся единственной N₂-меткой,
    // runtime-проверки химической идентичности третьего тела НЕ появилось и НЕ утверждается
    expect(fallOff89.thirdBodyNote).toBe('M = N₂');
  });

  it('записи №1, №70, №72 остаются unknown/no_kinetic_data; параметры №106 не изменились', () => {
    const unknownIds = ['kida-tb-2015-03-19-1', 'kida-tb-2015-03-19-70', 'kida-tb-2015-03-19-72'];
    for (const id of unknownIds) {
      const record = KINETIC_CATALOG_DATA.find((r) => r.id === id);
      if (record === undefined) {
        throw new Error('запись ' + id + ' отсутствует');
      }
      expect(record.rateConstant.status, 'запись ' + id).toBe('unknown');
      const error = kineticsError(() => evaluateRateConstant(record, quantity(300, 'K')));
      expect(error.code, 'запись ' + id).toBe('no_kinetic_data');
    }
    const record106 = KINETIC_CATALOG_DATA.find((r) => r.id === 'kida-tb-2015-03-19-106');
    if (record106 === undefined) {
      throw new Error('запись kida-tb-2015-03-19-106 отсутствует');
    }
    const rate106 = record106.rateConstant;
    if (rate106.status !== 'known') {
      throw new Error('запись №106 должна иметь known-константу');
    }
    const params106 = rate106.parameters;
    if (params106.kind !== 'fall_off') {
      throw new Error('запись №106 должна быть fall_off');
    }
    const fallOff106 = params106.fallOff;
    expect(fallOff106.lowPressureLimit.preExponentialA).toBe(4.3e-32);
    expect(fallOff106.lowPressureLimit.temperatureExponentN).toBe(-1.2);
    expect(fallOff106.highPressureLimit.preExponentialA).toBe(9.5e-11);
    expect(fallOff106.highPressureLimit.temperatureExponentN).toBe(0.44);
    expect(fallOff106.centeringFactorFc).toBe(0.5);
    expect(fallOff106.broadeningN).toBe(1.1323080944932562);
    expect(fallOff106.thirdBodyNote).toBe('M = N₂');
  });
});
