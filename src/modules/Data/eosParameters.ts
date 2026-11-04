// ============================================
// EOS PARAMETERS — Чистокомпонентные параметры Peng–Robinson
// ============================================
//
// Stage 4.4.4.1 «Каталог чистокомпонентных параметров Peng–Robinson».
//
// Контракт подэтапа — ТОЛЬКО данные, их provenance, runtime-валидация
// и fail-closed lookup. В этом модуле НЕ реализуются:
// - формулы PR (a, b, alpha(T, omega)) — подэтап 4.4.4.2;
// - кубическое уравнение для Z, фугитивности и ln(phi) — 4.4.4.2;
// - правила смешения и бинарные параметры взаимодействия kij —
//   4.4.4.3: kij в каталоге НАМЕРЕННО отсутствуют; пара без kij —
//   это отказ (fail-closed), а НЕ kij = 0 (kij = 0 не нейтрален);
// - flash/VLE/LLE и интеграция с solveEquilibrium — вне 4.4.4.1
//   (равновесный решатель остаётся идеальногазовым, result.model
//   = 'ideal_gas' не меняется).
//
// Состав каталога: ровно пять идентификаторов СУЩЕСТВУЮЩЕЙ модели
// (co2, n2, ch4, h2o, ar — см. Data/gases.ts, Data/phaseProperties.ts).
// Водород h2 НАМЕРЕННО исключён (Stage 4.4.4.0: PARTIALLY_VERIFIED,
// вне минимального каталога): нормальный, пара- и ортоводород имеют
// разные критические константы, одного универсального «H2» без
// уточнения изомерного состава недостаточно, а применимость
// классического PR к квантовому компоненту требует отдельной
// оценки. Параметры H2 «на будущее» не импортируются.
//
// Происхождение значений — per-field, БЕЗ общей provenance-строки
// (антипаттерн phaseProperties.CRITICAL_SOURCE не воспроизводится):
// - Tc и pc — справочные значения критических точек фундаментальных
//   EOS из публикаций J. Phys. Chem. Ref. Data (origin: 'reported');
// - ацентрический фактор omega — поле INFO.acentric fluid-файлов
//   CoolProp (origin: 'software_dataset'); библиография значения
//   acentric в fluid-файле НЕ публикуется, поэтому доказательный
//   статус omega — PARTIALLY_VERIFIED, а для CH4 —
//   UNRESOLVED_CROSS_CHECK (независимый расчёт по определению
//   Питцера из Антуа-корреляции Prydz & Goodwin 1972, хранящейся в
//   phaseProperties.ts, даёт omega ≈ 0.00661 против 0.01142 в
//   CoolProp; см. crossChecks записи ch4).
//
// Известные расхождения фиксируются ЯВНО и НЕ маскируются:
// - CH4 omega: CoolProp 0.01142 против Antoine-расчёта ≈ 0.00661 —
//   UNRESOLVED_CROSS_CHECK (значение источника хранится как значение
//   этого источника, конфликт виден в provenance и crossChecks);
// - Ar критическая точка: легаси phaseProperties.ts хранит 150.86 K /
//   48.98 bar против 150.687 K / 4.863 MPa у Tegeler, Span & Wagner
//   (1999). Легаси-каталог в этом подэтапе НЕ меняется (историческое
//   состояние другого модуля до отдельного решения); источником
//   критической точки для будущего PR назначен ЭТОТ каталог с
//   per-field provenance.
//
// Лицензии: значения Tc/pc цитируются из публикаций JPCRD с
// атрибуцией (открытые NIST reprints, srd.nist.gov). CoolProp — пакет
// под лицензией MIT (LICENSE: «Copyright (c) 2012-2018 Ian H. Bell and
// other CoolProp developers»), однако лицензия ПАКЕТА не подтверждает
// автоматически происхождение и условия использования конкретных
// числовых значений его fluid-файлов: это разделено в provenance
// каждого omega (limitations) и в DATA_PROVENANCE.md §2.29.

import type { DataProvenance, Uncertainty } from '../Core/scientificValue';
import { validateUncertainty } from '../Core/scientificValue';

// ============================================
// 1. ТИПЫ: PROVENANCE, СТАТУСЫ, ЗНАЧЕНИЕ, ЗАПИСЬ
// ============================================

/**
 * Тип получения значения параметра EOS.
 * - reported:          значение опубликовано источником как есть;
 * - derived:           значение вычислено (из других данных, корреляций);
 * - software_dataset:  значение прочитано из датасета программного пакета.
 */
export type EosValueOrigin = 'reported' | 'derived' | 'software_dataset';

/** Runtime-реестр типов получения (данные могут приходить из JSON). */
export const EOS_VALUE_ORIGINS: readonly EosValueOrigin[] = [
  'reported',
  'derived',
  'software_dataset'
];

/**
 * Статус доказательства значения.
 * - VERIFIED:                подтверждено первичным источником (и, где
 *                           указано, независимой сверкой);
 * - PARTIALLY_VERIFIED:     источник идентифицирован, но полная
 *                           прослеживаемость до первичной публикации
 *                           не завершена;
 * - UNRESOLVED_CROSS_CHECK: существует задокументированное неразрешённое
 *                           расхождение с независимой сверкой;
 * - UNRESOLVED:              происхождение/допустимость не установлены,
 *                           значением пользоваться как подтверждённым
 *                           нельзя.
 */
export type EosEvidenceStatus =
  | 'VERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'UNRESOLVED_CROSS_CHECK'
  | 'UNRESOLVED';

/** Runtime-реестр статусов доказательства. */
export const EOS_EVIDENCE_STATUSES: readonly EosEvidenceStatus[] = [
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'UNRESOLVED_CROSS_CHECK',
  'UNRESOLVED'
];

/**
 * Проvenance параметра EOS: существующий проектный DataProvenance
 * (Core/scientificValue.ts) + типизированные origin и статус
 * доказательства (паттерн ThermoDataProvenance из Core/thermodynamics.ts:
 * расширяем, не дублируем систему provenance).
 */
export interface EosParameterProvenance extends DataProvenance {
  /** Тип получения значения — обязателен. */
  origin: EosValueOrigin;
  /** Статус доказательства значения — обязателен. */
  evidence: EosEvidenceStatus;
}

/** Результат сверки значения каталога с независимым источником. */
export type EosCrossCheckOutcome =
  | 'consistent'
  | 'consistent_within_rounding'
  | 'discrepancy';

/** Runtime-реестр исходов сверки. */
export const EOS_CROSS_CHECK_OUTCOMES: readonly EosCrossCheckOutcome[] = [
  'consistent',
  'consistent_within_rounding',
  'discrepancy'
];

/**
 * Задокументированная сверка параметров каталога с независимым
 * источником (включая обнаруженные расхождения — они НЕ скрываются).
 */
export interface EosCrossCheck {
  /** Что сверяется (например, 'критическая точка (Tc, pc)'). */
  subject: string;
  /** Значение/источник каталога EOS. */
  catalogValue: string;
  /** Независимый источник сверки. */
  crossSource: string;
  /** Значение независимого источника. */
  crossValue: string;
  /** Итог сверки. */
  outcome: EosCrossCheckOutcome;
  /** Объяснение и решение: что хранится и почему. */
  resolution: string;
}

/**
 * Числовое значение параметра EOS: значение + зарегистрированная
 * единица + СОБСТВЕННЫЙ provenance. uncertainty отсутствует, если
 * источник неопределённость не приводит (отсутствие = «неизвестна»,
 * НЕ «равна нулю» — конвенция ScientificValue).
 */
export interface EosScalarParameter {
  value: number;
  /** Единица реестра Core/physicalQuantity.ts: 'K' | 'Pa' | '1'. */
  unit: string;
  uncertainty?: Uncertainty;
  provenance: EosParameterProvenance;
}

/** Запись чистокомпонентных параметров Peng–Robinson. */
export interface EosPureComponentParameters {
  /** Идентификатор существующего вида модели (Data/gases.ts). */
  gasId: string;
  formula: string;
  name: string;
  /** Критическая температура, K (единица 'K', значение > 0). */
  criticalTemperatureK: EosScalarParameter;
  /** Критическое давление, Pa (единица 'Pa', значение > 0). */
  criticalPressurePa: EosScalarParameter;
  /** Ацентрический фактор, безразмерный (единица '1'; знак любой). */
  acentricFactor: EosScalarParameter;
  /** Задокументированные сверки с независимыми источниками. */
  crossChecks: readonly EosCrossCheck[];
  /** Ограничения применимости классического PR для вещества. */
  limitations: readonly string[];
}

// ============================================
// 2. ОГРАНИЧЕНИЯ ОБЛАСТИ КАТАЛОГА
// ============================================

/** gasId пяти компонентов каталога (ровно эти пять, Stage 4.4.4.1). */
export type EosPureComponentGasId = 'co2' | 'n2' | 'ch4' | 'h2o' | 'ar';

/**
 * Границы области каталога: наличие Tc/Pc/omega НЕ доказывает
 * применимость классического PR к произвольной смеси; kij нет
 * намеренно (fail-closed для пар); формулы PR не реализованы.
 */
export const EOS_CATALOG_SCOPE_NOTE: string =
  'Stage 4.4.4.1: каталог содержит ТОЛЬКО чистокомпонентные параметры ' +
  '(Tc, pc, omega) пяти веществ (co2, n2, ch4, h2o, ar) с per-field ' +
  'provenance. Наличие параметров чистых компонентов НЕ является ' +
  'доказательством применимости классического Peng–Robinson к ' +
  'произвольной смеси: без верифицированных бинарных kij и валидации ' +
  'EOS смесевые расчёты не выполняются (fail-closed). Формулы PR, Z, ' +
  'фугитивности, правила смешения и kij — последующие подэтапы ' +
  '(4.4.4.2, 4.4.4.3); kij = 0 как «нейтральное» значение не ' +
  'используется.';

/** Основание исключения водорода из каталога. */
export const EOS_H2_EXCLUSION_NOTE: string =
  'Водород h2 исключён из каталога Stage 4.4.4.1: нормальный, пара- и ' +
  'ортоводород имеют разные критические константы, одного ' +
  'универсального «H2» без уточнения изомерного состава недостаточно; ' +
  'классический PR требует отдельной оценки применимости к квантовому ' +
  'компоненту (Tr = 0.7 ≈ 23 K — вне области классического определения ' +
  'ацентрического фактора). Параметры H2 «на будущее» не импортируются ' +
  '(статус H2 в аудите Stage 4.4.4.0 — PARTIALLY_VERIFIED, вне ' +
  'минимального каталога).';

/** Основание отсутствия kij в каталоге этого подэтапа. */
export const EOS_NO_BINARY_INTERACTION_NOTE: string =
  'Бинарные параметры взаимодействия kij в Stage 4.4.4.1 намеренно ' +
  'отсутствуют: kij — подгоночные, зависят от T/P/состава и правил ' +
  'смешения; универсальных «константных» значений не существует. ' +
  'Отсутствие kij = отказ для пары (fail-closed), НЕ kij = 0 и НЕ ' +
  'молчаливая идеализация. Каталог kij с per-pair provenance — ' +
  'подэтап 4.4.4.3.';

// ============================================
// 3. ИСТОЧНИКИ ДАННЫХ (дескрипторы для provenance)
// ============================================

/** Дата обращения к источникам этой ревизии каталога. */
const EOS_PARAMETERS_RETRIEVED_AT = '2026-11-04';

/** Идентификация версии fluid-файлов CoolProp (обращение 2026-11-04). */
const COOLPROP_DATASET_VERSION =
  'master @ 8eb3b778ee672afaf9b8c95a2890be3edaf32937 (коммит после релиза v8.0.0 от 2026-06-28)';

/** Путь fluid-файла CoolProp для каждого компонента. */
const COOLPROP_FLUID_FILES: Record<EosPureComponentGasId, string> = {
  co2: 'dev/fluids/CarbonDioxide.json',
  n2: 'dev/fluids/Nitrogen.json',
  ch4: 'dev/fluids/Methane.json',
  h2o: 'dev/fluids/Water.json',
  ar: 'dev/fluids/Argon.json'
};

/**
 * Публикация JPCRD, из которой взяты Tc и pc (справочные значения
 * критической точки фундаментального EOS; reported). Значения
 * сверены с независимой реализацией этих же EOS в CoolProp
 * (STATES.critical; BibTeX_EOS — см. eosImplementation).
 */
interface EosCriticalPointPublication {
  sourceName: string;
  sourceId: string;
  datasetId: string;
  reference: string;
  /** BibTeX_EOS в fluid-файле CoolProp, реализующем этот EOS. */
  eosImplementation: string;
}

const CRITICAL_POINT_PUBLICATIONS: Record<EosPureComponentGasId, EosCriticalPointPublication> = {
  co2: {
    sourceName: 'Span & Wagner 1996, J. Phys. Chem. Ref. Data 25, 1509',
    sourceId: 'doi:10.1063/1.555991',
    datasetId: 'JPCRD 25: reference EOS CO2 (Span–Wagner 1996)',
    reference:
      'Span, R.; Wagner, W. A New Equation of State for Carbon Dioxide ' +
      'Covering the Region from the Triple-Point Temperature to 1100 K at ' +
      'Pressures up to 800 MPa. J. Phys. Chem. Ref. Data 25, 1509 (1996). ' +
      'DOI: 10.1063/1.555991',
    eosImplementation: 'CoolProp dev/fluids/CarbonDioxide.json: BibTeX_EOS Span-JPCRD-1996'
  },
  n2: {
    sourceName: 'Span, Lemmon, Jacobsen, Wagner & Yokozeki 2000, J. Phys. Chem. Ref. Data 29, 1361',
    sourceId: 'doi:10.1063/1.1349047',
    datasetId: 'JPCRD 29: reference EOS N2 (Span et al. 2000)',
    reference:
      'Span, R.; Lemmon, E. W.; Jacobsen, R. T.; Wagner, W.; Yokozeki, A. ' +
      'A Reference Equation of State for the Thermodynamic Properties of ' +
      'Nitrogen for Temperatures from 63.151 to 1000 K and Pressures to ' +
      '2200 MPa. J. Phys. Chem. Ref. Data 29, 1361 (2000). DOI: 10.1063/1.1349047',
    eosImplementation: 'CoolProp dev/fluids/Nitrogen.json: BibTeX_EOS Span-JPCRD-2000'
  },
  ch4: {
    sourceName: 'Setzmann & Wagner 1991, J. Phys. Chem. Ref. Data 20, 1061',
    sourceId: 'doi:10.1063/1.555912',
    datasetId: 'JPCRD 20: reference EOS CH4 (Setzmann–Wagner 1991)',
    reference:
      'Setzmann, U.; Wagner, W. A New Equation of State and Tables of ' +
      'Thermodynamic Properties for Methane Covering the Range from the ' +
      'Melting Line to 625 K at Pressures up to 1000 MPa. J. Phys. Chem. ' +
      'Ref. Data 20, 1061 (1991). DOI: 10.1063/1.555912',
    eosImplementation: 'CoolProp dev/fluids/Methane.json: BibTeX_EOS Setzmann-JPCRD-1991'
  },
  h2o: {
    sourceName: 'Wagner & Pruss 2002 (IAPWS-95), J. Phys. Chem. Ref. Data 31, 387',
    sourceId: 'doi:10.1063/1.1461829',
    datasetId: 'JPCRD 31: IAPWS-95 (Wagner–Pruss 2002)',
    reference:
      'Wagner, W.; Pruss, A. The IAPWS Formulation 1995 for the ' +
      'Thermodynamic Properties of Ordinary Water Substance for General ' +
      'and Scientific Use. J. Phys. Chem. Ref. Data 31, 387 (2002). ' +
      'DOI: 10.1063/1.1461829',
    eosImplementation: 'CoolProp dev/fluids/Water.json: BibTeX_EOS Wagner-JPCRD-2002'
  },
  ar: {
    sourceName: 'Tegeler, Span & Wagner 1999, J. Phys. Chem. Ref. Data 28, 779',
    sourceId: 'doi:10.1063/1.556037',
    datasetId: 'JPCRD 28: reference EOS Ar (Tegeler–Span–Wagner 1999)',
    reference:
      'Tegeler, Ch.; Span, R.; Wagner, W. A New Equation of State for ' +
      'Argon Covering the Fluid Region for Temperatures from the Melting ' +
      'Line to 700 K at Pressures up to 1000 MPa. J. Phys. Chem. Ref. ' +
      'Data 28, 779 (1999). DOI: 10.1063/1.556037',
    eosImplementation: 'CoolProp dev/fluids/Argon.json: BibTeX_EOS Tegeler-JPCRD-1999'
  }
};

/**
 * Собственный provenance критического параметра (Tc или pc).
 * Каждый вызов создаёт НОВЫЙ объект: параметры не наследуют общую
 * provenance-строку друг от друга (recordId различает поля).
 */
function criticalParameterProvenance(
  publication: EosCriticalPointPublication,
  parameter: 'Tc' | 'pc'
): EosParameterProvenance {
  const isTc = parameter === 'Tc';
  return {
    origin: 'reported',
    evidence: 'VERIFIED',
    sourceName: publication.sourceName,
    sourceId: publication.sourceId,
    datasetId: publication.datasetId,
    datasetVersion: 'публикация JPCRD (journal-статья; отдельная версия набора данных публикацией не версифицируется)',
    recordId: isTc ? 'критическая температура Tc' : 'критическое давление pc',
    reference: publication.reference,
    retrievedAt: EOS_PARAMETERS_RETRIEVED_AT,
    method: isTc
      ? 'справочное значение критической температуры, опубликованное авторами фундаментального EOS (reported); проектом не пересчитывалось'
      : 'справочное значение критического давления, опубликованное авторами фундаментального EOS (reported); проектом не пересчитывалось',
    applicability:
      'критическая точка — константа вещества, а не диапазон; собственная область применимости к параметру не применяется (валидность самого EOS — свойство EOS, не этого значения)',
    limitations:
      'неопределённость значения публикацией не приводится (отсутствие uncertainty = «неизвестна», не «ноль»); параметр фиксирует масштаб EOS, но не гарантирует точность классического PR в критической области',
    license:
      'статья J. Phys. Chem. Ref. Data (AIP Publishing); значение цитируется с атрибуцией; проверка — по открытому NIST reprint (srd.nist.gov/jpcrdreprint)',
    note:
      'независимая сверка: ' + publication.eosImplementation +
      ' — STATES.critical совпадает с хранимым значением дословно'
  };
}

/**
 * Собственный provenance ацентрического фактора (поле INFO.acentric
 * fluid-файла CoolProp). Библиография значения acentric в fluid-файле
 * НЕ публикуется — это отражено в evidence и limitations.
 */
function acentricFactorProvenance(
  gasId: EosPureComponentGasId,
  evidence: EosEvidenceStatus,
  note: string
): EosParameterProvenance {
  return {
    origin: 'software_dataset',
    evidence,
    sourceName: 'CoolProp — fluid JSON, поле INFO.acentric',
    sourceId: 'CoolProp/CoolProp (github.com/CoolProp/CoolProp)',
    datasetId: COOLPROP_FLUID_FILES[gasId],
    datasetVersion: COOLPROP_DATASET_VERSION,
    recordId: 'INFO.acentric',
    reference:
      'CoolProp, репозиторий https://github.com/CoolProp/CoolProp, файл ' +
      COOLPROP_FLUID_FILES[gasId] + ', поле "acentric" (модуль acentric_units: "-"); ' +
      'документация кубических EOS: https://coolprop.org/coolprop/Cubics.html',
    retrievedAt: EOS_PARAMETERS_RETRIEVED_AT,
    method:
      'значение прочитано из fluid-файла CoolProp как есть (software_dataset); проектом не пересчитывалось и не подгонялось',
    applicability:
      'определение Питцера: omega = -log10(P_sat(0.7·Tc)/pc) - 1; конвенция применима к классическим (неквантовым) жидкостям',
    limitations:
      'лицензия пакета CoolProp — MIT (LICENSE: Copyright (c) 2012-2018 Ian H. Bell and other CoolProp developers), но библиография числового значения acentric в fluid-файле НЕ публикуется: совпадение с конкретной первичной публикацией не подтверждено, поэтому полный статус VERIFIED не присваивается',
    license:
      'MIT (пакет CoolProp); лицензия пакета НЕ трактуется как подтверждение происхождения/условий использования конкретных числовых значений его данных',
    note
  };
}

// ============================================
// 4. ДАННЫЕ КАТАЛОГА
// ============================================

/**
 * Каталог чистокомпонентных параметров Peng–Robinson: ровно пять
 * компонентов. Значения:
 * - Tc/pc — справочные значения JPCRD (Pa; 1 MPa = 1e6 Pa);
 * - omega — INFO.acentric CoolProp (см. provenance каждого поля);
 * - неопределённости: источниками не приводятся (отсутствие = неизвестна).
 */
export const EOS_PURE_COMPONENT_PARAMETERS: Readonly<
  Record<EosPureComponentGasId, EosPureComponentParameters>
> = {
  co2: {
    gasId: 'co2',
    formula: 'CO₂',
    name: 'Углекислый газ',
    criticalTemperatureK: {
      value: 304.1282,
      unit: 'K',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.co2, 'Tc')
    },
    criticalPressurePa: {
      value: 7377300,
      unit: 'Pa',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.co2, 'pc')
    },
    acentricFactor: {
      value: 0.22394,
      unit: '1',
      provenance: acentricFactorProvenance(
        'co2',
        'PARTIALLY_VERIFIED',
        'значение совпадает с распространёнными справочными компиляциями, но per-value библиография в fluid-файле отсутствует'
      )
    },
    crossChecks: [
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 304.1282 K, pc = 7377300 Pa (Span & Wagner 1996)',
        crossSource: 'CoolProp dev/fluids/CarbonDioxide.json, STATES.critical @ 8eb3b778 (BibTeX_EOS Span-JPCRD-1996)',
        crossValue: 'T = 304.1282 K, p = 7377300.0 Pa',
        outcome: 'consistent',
        resolution: 'независимая реализация того же EOS; значения совпадают дословно'
      },
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 304.1282 K, pc = 7377300 Pa',
        crossSource: 'легаси phaseProperties.ts (per-field provenance отсутствует, общая строка CRITICAL_SOURCE)',
        crossValue: 'Tc = 304.13 K, pc = 73.8 bar = 7.38e6 Pa',
        outcome: 'consistent_within_rounding',
        resolution: 'легаси-значение — округление того же значения до 2 знаков; EOS-каталог хранит точное значение JPCRD с per-field provenance'
      }
    ],
    limitations: [
      'точность смесевых расчётов CO₂ с другими компонентами НЕ заявляется: без верифицированных бинарных kij классический PR к смесям CO₂ не применяется (fail-closed, подэтап 4.4.4.3)'
    ]
  },
  n2: {
    gasId: 'n2',
    formula: 'N₂',
    name: 'Азот',
    criticalTemperatureK: {
      value: 126.192,
      unit: 'K',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.n2, 'Tc')
    },
    criticalPressurePa: {
      value: 3395800,
      unit: 'Pa',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.n2, 'pc')
    },
    acentricFactor: {
      value: 0.0372,
      unit: '1',
      provenance: acentricFactorProvenance(
        'n2',
        'PARTIALLY_VERIFIED',
        'значение совпадает с распространёнными справочными компиляциями, но per-value библиография в fluid-файле отсутствует'
      )
    },
    crossChecks: [
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 126.192 K, pc = 3395800 Pa (Span et al. 2000)',
        crossSource: 'CoolProp dev/fluids/Nitrogen.json, STATES.critical @ 8eb3b778 (BibTeX_EOS Span-JPCRD-2000)',
        crossValue: 'T = 126.192 K, p = 3395800.0 Pa',
        outcome: 'consistent',
        resolution: 'независимая реализация того же EOS; значения совпадают дословно'
      },
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 126.192 K, pc = 3395800 Pa',
        crossSource: 'легаси phaseProperties.ts (per-field provenance отсутствует)',
        crossValue: 'Tc = 126.21 K, pc = 33.98 bar = 3.398e6 Pa',
        outcome: 'consistent_within_rounding',
        resolution: 'pc совпадает в пределах округления (33.98 bar ≈ 3.398 MPa против 3.3958 MPa); легаси Tc = 126.21 K отличается от 126.192 K на 0.018 K — совпадение в пределах разброса справочных компиляций, но строгим округлением значения Span et al. 2000 не является (provenance легаси-значения отсутствует); EOS-каталог хранит точное значение JPCRD'
      }
    ],
    limitations: []
  },
  ch4: {
    gasId: 'ch4',
    formula: 'CH₄',
    name: 'Метан',
    criticalTemperatureK: {
      value: 190.564,
      unit: 'K',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.ch4, 'Tc')
    },
    criticalPressurePa: {
      value: 4599200,
      unit: 'Pa',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.ch4, 'pc')
    },
    acentricFactor: {
      value: 0.01142,
      unit: '1',
      provenance: acentricFactorProvenance(
        'ch4',
        'UNRESOLVED_CROSS_CHECK',
        'конфликт с независимым Antoine-расчётом задокументирован в crossChecks записи и НЕ считается подтверждением согласованности; значение CoolProp хранится как значение этого источника'
      )
    },
    crossChecks: [
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 190.564 K, pc = 4599200 Pa (Setzmann & Wagner 1991)',
        crossSource: 'CoolProp dev/fluids/Methane.json, STATES.critical @ 8eb3b778 (BibTeX_EOS Setzmann-JPCRD-1991)',
        crossValue: 'T = 190.564 K, p = 4599200.0 Pa',
        outcome: 'consistent',
        resolution: 'независимая реализация того же EOS; значения совпадают дословно'
      },
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 190.564 K, pc = 4599200 Pa',
        crossSource: 'легаси phaseProperties.ts (per-field provenance отсутствует)',
        crossValue: 'Tc = 190.56 K, pc = 45.99 bar = 4.599e6 Pa',
        outcome: 'consistent_within_rounding',
        resolution: 'легаси-значения — округление того же значения (190.564 → 190.56; 4.5992 MPa → 45.99 bar); EOS-каталог хранит точное значение JPCRD'
      },
      {
        subject: 'acentricFactor',
        catalogValue: 'omega = 0.01142 (CoolProp, INFO.acentric dev/fluids/Methane.json)',
        crossSource:
          'независимый расчёт по определению Питцера из Антуа-корреляции Prydz & Goodwin 1972 ' +
          '(phaseProperties.ts: A = 3.9895, B = 443.028, C = -0.49, P в барах, диапазон 90.99–189.99 K; ' +
          '0.7·Tc = 133.395 K внутри диапазона)',
        crossValue: 'omega = -log10(P_sat(133.395 K)/pc) - 1 ≈ 0.00661 (P_sat ≈ 4.5298 бар против pc = 45.992 бар)',
        outcome: 'discrepancy',
        resolution:
          'UNRESOLVED_CROSS_CHECK: расхождение ≈ 0.005 не разрешено в рамках 4.4.4.1. ' +
          'Чувствительность конвенции Питцера к точности корреляции упругости пара велика: ' +
          'отклонение P_sat всего на ~1.2% даёт Delta(omega) ≈ 0.005, а коэффициенты Антуа ' +
          'округлены NIST до 4–5 значащих цифр. Antoine-расчёт НЕ выдаётся за подтверждение ' +
          'значения 0.01142, а значение CoolProp НЕ подменяется расчётным; конфликт остаётся ' +
          'видимым в provenance (evidence: UNRESOLVED_CROSS_CHECK) и в этой записи crossChecks'
      }
    ],
    limitations: []
  },
  h2o: {
    gasId: 'h2o',
    formula: 'H₂O',
    name: 'Водяной пар',
    criticalTemperatureK: {
      value: 647.096,
      unit: 'K',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.h2o, 'Tc')
    },
    criticalPressurePa: {
      value: 22064000,
      unit: 'Pa',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.h2o, 'pc')
    },
    acentricFactor: {
      value: 0.3442920843,
      unit: '1',
      provenance: acentricFactorProvenance(
        'h2o',
        'PARTIALLY_VERIFIED',
        'значение хранится дословно из fluid-файла (0.3442920843; распространённое округление 0.3443); для ассоциированных веществ конвенция Питцера ограниченно осмысленна'
      )
    },
    crossChecks: [
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 647.096 K, pc = 22064000 Pa (Wagner & Pruss 2002, IAPWS-95)',
        crossSource: 'CoolProp dev/fluids/Water.json, STATES.critical @ 8eb3b778 (BibTeX_EOS Wagner-JPCRD-2002)',
        crossValue: 'T = 647.096 K, p = 22064000.0 Pa',
        outcome: 'consistent',
        resolution: 'независимая реализация того же EOS (IAPWS-95); значения совпадают дословно'
      },
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 647.096 K, pc = 22064000 Pa',
        crossSource: 'легаси phaseProperties.ts (per-field provenance отсутствует)',
        crossValue: 'Tc = 647.1 K, pc = 220.64 bar = 2.2064e7 Pa',
        outcome: 'consistent_within_rounding',
        resolution: 'легаси-значения — округление того же значения (647.096 → 647.1); EOS-каталог хранит точное значение IAPWS-95'
      }
    ],
    limitations: [
      'вода — сильно полярная ассоциированная жидкость с водородными связями; классическое кубическое EOS без специальных модификаций не описывает её фазовое поведение с инженерной точностью',
      'параметры Tc/pc/omega воды НЕ являются разрешением использовать стандартный PR как точную модель водных бинарных смесей: Stage 4.4.4 НЕ поддерживает водные смеси (аудит Stage 4.4.4.0: для H₂O–CO₂ классический PR с константным kij недостаточен)',
      'включение H₂O в каталог чистых свойств не означает поддержки смесей H₂O–газ в Stage 4.4.4'
    ]
  },
  ar: {
    gasId: 'ar',
    formula: 'Ar',
    name: 'Аргон',
    criticalTemperatureK: {
      value: 150.687,
      unit: 'K',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.ar, 'Tc')
    },
    criticalPressurePa: {
      value: 4863000,
      unit: 'Pa',
      provenance: criticalParameterProvenance(CRITICAL_POINT_PUBLICATIONS.ar, 'pc')
    },
    acentricFactor: {
      value: -0.00219,
      unit: '1',
      provenance: acentricFactorProvenance(
        'ar',
        'PARTIALLY_VERIFIED',
        'отрицательное значение корректно для аргона (легкие вещества могут иметь omega < 0); per-value библиография в fluid-файле отсутствует'
      )
    },
    crossChecks: [
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 150.687 K, pc = 4863000 Pa (Tegeler, Span & Wagner 1999)',
        crossSource: 'CoolProp dev/fluids/Argon.json, STATES.critical @ 8eb3b778 (BibTeX_EOS Tegeler-JPCRD-1999)',
        crossValue: 'T = 150.687 K, p = 4863000.0 Pa',
        outcome: 'consistent',
        resolution: 'независимая реализация того же EOS; значения совпадают дословно'
      },
      {
        subject: 'критическая точка (Tc, pc)',
        catalogValue: 'Tc = 150.687 K, pc = 4863000 Pa',
        crossSource: 'легаси phaseProperties.ts (per-field provenance отсутствует, общая строка CRITICAL_SOURCE)',
        crossValue: 'Tc = 150.86 K, pc = 48.98 bar = 4.898e6 Pa',
        outcome: 'discrepancy',
        resolution:
          'РАСХОЖДЕНИЕ вне округления: 0.173 K по Tc и 35 кПа по pc. В 4.4.4.1 легаси-каталог ' +
          'НЕ редактируется (историческое состояние другого модуля до отдельного решения); ' +
          'источником критической точки для будущего PR назначен этот каталог: Tegeler, Span ' +
          '& Wagner 1999 — reference EOS аргона с per-field provenance, подтверждён ' +
          'независимой реализацией CoolProp. Расхождение НЕ маскируется'
      }
    ],
    limitations: []
  }
};

/** Идентификаторы компонентов каталога (порядок зафиксирован контрактом подэтапа). */
export const EOS_PURE_COMPONENT_IDS: readonly EosPureComponentGasId[] = [
  'co2',
  'n2',
  'ch4',
  'h2o',
  'ar'
];

// ============================================
// 5. RUNTIME-ВАЛИДАЦИЯ
// ============================================

/** Безопасная проверка «это объект» (данные могут приходить из JSON). */
function isNonNullObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/**
 * Идентифицирует ли provenance источник (паттерн hasSourceIdentification
 * из Core/thermodynamics.ts): минимум один непустой идентификатор.
 */
function hasSourceIdentification(p: DataProvenance): boolean {
  return (
    (typeof p.sourceName === 'string' && p.sourceName.trim() !== '') ||
    (typeof p.sourceId === 'string' && p.sourceId.trim() !== '') ||
    (typeof p.datasetId === 'string' && p.datasetId.trim() !== '') ||
    (typeof p.reference === 'string' && p.reference.trim() !== '')
  );
}

/** В ссылке есть DOI или URL (однозначный указатель upstream). */
function hasUpstreamPointer(p: DataProvenance): boolean {
  const reference = typeof p.reference === 'string' ? p.reference : '';
  const datasetId = typeof p.datasetId === 'string' ? p.datasetId : '';
  return (
    /\b10\.\d{4,9}\//.test(reference) ||
    /https?:\/\//.test(reference) ||
    datasetId.trim() !== ''
  );
}

function nonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim() !== '';
}

/**
 * Валидация provenance параметра EOS: собственный объект provenance
 * обязателен (общей строки недостаточно); origin и evidence — из
 * типизированных реестров; источник идентифицирован и указывает на
 * upstream; версия источника, дата обращения, применимость,
 * ограничения/комментарии и лицензия — обязательны. Возвращает список
 * проблем (пустой = корректно); исключений не выбрасывает.
 */
function provenanceIssues(path: string, provenance: unknown): string[] {
  const errors: string[] = [];
  if (provenance === undefined) {
    errors.push(`${path}: требуется собственный provenance параметра (общей provenance-строки недостаточно)`);
    return errors;
  }
  if (!isNonNullObject(provenance)) {
    errors.push(`${path}: provenance должен быть объектом`);
    return errors;
  }
  const rec = provenance as Partial<EosParameterProvenance>;
  if (!nonEmptyString(rec.origin)) {
    errors.push(`${path}: origin обязателен (reported | derived | software_dataset)`);
  } else if (!(EOS_VALUE_ORIGINS as readonly string[]).includes(rec.origin)) {
    errors.push(`${path}: неизвестный origin «${rec.origin}» (допустимы: ${EOS_VALUE_ORIGINS.join(', ')})`);
  }
  if (!nonEmptyString(rec.evidence)) {
    errors.push(`${path}: evidence обязателен (статус доказательства значения)`);
  } else if (!(EOS_EVIDENCE_STATUSES as readonly string[]).includes(rec.evidence)) {
    errors.push(`${path}: неизвестный статус доказательства «${rec.evidence}» (допустимы: ${EOS_EVIDENCE_STATUSES.join(', ')})`);
  }
  if (!hasSourceIdentification(rec as DataProvenance)) {
    errors.push(`${path}: provenance не идентифицирует источник (нужно sourceName, sourceId, datasetId или reference)`);
  }
  if (!hasUpstreamPointer(rec as DataProvenance)) {
    errors.push(`${path}: provenance не указывает upstream однозначно (DOI или URL в reference, либо путь файла в datasetId)`);
  }
  if (!nonEmptyString(rec.reference)) {
    errors.push(`${path}: обязательна библиографическая или dataset-идентификация (reference)`);
  }
  if (!nonEmptyString(rec.datasetVersion)) {
    errors.push(`${path}: обязательна версия источника данных (datasetVersion)`);
  }
  if (!nonEmptyString(rec.retrievedAt)) {
    errors.push(`${path}: обязательна дата обращения к источнику (retrievedAt)`);
  }
  if (!nonEmptyString(rec.applicability)) {
    errors.push(`${path}: обязателен диапазон применимости или явное указание его отсутствия (applicability)`);
  }
  if (!nonEmptyString(rec.limitations) && !nonEmptyString(rec.note)) {
    errors.push(`${path}: обязательны ограничения и/или комментарии (limitations или note)`);
  }
  if (!nonEmptyString(rec.license)) {
    errors.push(`${path}: обязательна лицензия источника или статус её определения (license)`);
  }
  return errors;
}

/**
 * Валидация числового параметра EOS: объект; конечное число (NaN и
 * Infinity отклоняются); при positive — строго больше нуля; единица
 * обязана точно совпадать с контрактом поля; uncertainty (если есть) —
 * валидна по конвенции ScientificValue; provenance — собственный и
 * полный. Отрицательный omega допускается (positive: false).
 */
export function validateEosScalarParameter(
  parameter: unknown,
  expectedUnit: string,
  path: string,
  options: { positive: boolean }
): string[] {
  const errors: string[] = [];
  if (!isNonNullObject(parameter)) {
    errors.push(`${path}: параметр должен быть объектом {value, unit, provenance}`);
    return errors;
  }
  const rec = parameter as Record<string, unknown>;
  if (typeof rec.value !== 'number' || !Number.isFinite(rec.value)) {
    errors.push(`${path}: значение должно быть конечным числом, получено ${String(rec.value)}`);
  } else if (options.positive && rec.value <= 0) {
    errors.push(`${path}: значение должно быть строго положительным, получено ${rec.value}`);
  }
  if (rec.unit !== expectedUnit) {
    errors.push(`${path}: единица должна быть «${expectedUnit}» (контракт поля), получено «${String(rec.unit)}»`);
  }
  if (rec.uncertainty !== undefined) {
    if (!isNonNullObject(rec.uncertainty)) {
      errors.push(`${path}: uncertainty должен быть объектом`);
    } else {
      const kinds = ['interval', 'stddev', 'relative', 'bounded'];
      const u = rec.uncertainty as Record<string, unknown>;
      if (typeof u.kind !== 'string' || !kinds.includes(u.kind)) {
        errors.push(`${path}: неизвестный вид неопределённости «${String(u.kind)}»`);
      } else {
        errors.push(...validateUncertainty(rec.uncertainty as Uncertainty).map((e) => `${path}: ${e}`));
      }
    }
  }
  errors.push(...provenanceIssues(`${path}: provenance`, rec.provenance));
  return errors;
}

/**
 * Структурная валидация записи чистокомпонентных параметров.
 * Проверяет форму и provenance; научную корректность значений
 * (соответствие конкретной публикации) проверяет сверка с
 * независимыми источниками (crossChecks), а не эта функция.
 */
export function validateEosPureComponentRecord(record: unknown): string[] {
  const errors: string[] = [];
  if (!isNonNullObject(record)) {
    return ['запись должна быть объектом'];
  }
  const rec = record as Record<string, unknown>;
  if (!nonEmptyString(rec.gasId)) {
    errors.push('gasId: обязателен (непустая строка)');
  } else {
    if (!nonEmptyString(rec.formula)) {
      errors.push(`${rec.gasId}: formula обязательна`);
    }
    if (!nonEmptyString(rec.name)) {
      errors.push(`${rec.gasId}: name обязательно`);
    }
    errors.push(...validateEosScalarParameter(rec.criticalTemperatureK, 'K', `${rec.gasId}.criticalTemperatureK`, { positive: true }));
    errors.push(...validateEosScalarParameter(rec.criticalPressurePa, 'Pa', `${rec.gasId}.criticalPressurePa`, { positive: true }));
    errors.push(...validateEosScalarParameter(rec.acentricFactor, '1', `${rec.gasId}.acentricFactor`, { positive: false }));
    if (!Array.isArray(rec.crossChecks)) {
      errors.push(`${rec.gasId}: crossChecks должны быть массивом`);
    } else {
      rec.crossChecks.forEach((cc: unknown, i: number) => {
        if (!isNonNullObject(cc)) {
          errors.push(`${rec.gasId}: crossChecks[${i}] должен быть объектом`);
          return;
        }
        const c = cc as Record<string, unknown>;
        for (const field of ['subject', 'catalogValue', 'crossSource', 'crossValue', 'resolution'] as const) {
          if (!nonEmptyString(c[field])) {
            errors.push(`${rec.gasId}: crossChecks[${i}].${field} обязателен (непустая строка)`);
          }
        }
        if (typeof c.outcome !== 'string' || !(EOS_CROSS_CHECK_OUTCOMES as readonly string[]).includes(c.outcome)) {
          errors.push(`${rec.gasId}: crossChecks[${i}].outcome должен быть одним из: ${EOS_CROSS_CHECK_OUTCOMES.join(', ')}`);
        }
      });
    }
    if (!Array.isArray(rec.limitations)) {
      errors.push(`${rec.gasId}: limitations должны быть массивом`);
    } else {
      rec.limitations.forEach((l: unknown, i: number) => {
        if (!nonEmptyString(l)) {
          errors.push(`${rec.gasId}: limitations[${i}] должна быть непустой строкой`);
        }
      });
    }
  }
  return errors;
}

/**
 * Валидация каталога целиком: каждая запись валидна, gasId записи
 * совпадает с ключом, дубликатов нет, состав каталога — ровно
 * EOS_PURE_COMPONENT_IDS (контракт Stage 4.4.4.1: пять компонентов).
 */
export function validateEosCatalog(catalog: unknown): string[] {
  const errors: string[] = [];
  if (!isNonNullObject(catalog)) {
    return ['каталог должен быть объектом'];
  }
  const seen = new Set<string>();
  for (const key of Object.keys(catalog)) {
    const issues = validateEosPureComponentRecord((catalog as Record<string, unknown>)[key]);
    errors.push(...issues.map((e) => `${key}: ${e}`));
    const record = (catalog as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
    if (isNonNullObject(record) && typeof record.gasId === 'string') {
      if (record.gasId !== key) {
        errors.push(`${key}: gasId записи («${record.gasId}») не совпадает с ключом каталога`);
      }
      if (seen.has(record.gasId)) {
        errors.push(`дублированный gasId в каталоге: ${record.gasId}`);
      }
      seen.add(record.gasId);
    }
  }
  const expected = new Set<string>(EOS_PURE_COMPONENT_IDS);
  for (const id of expected) {
    if (!(id in catalog)) {
      errors.push(`в каталоге отсутствует обязательный компонент: ${id}`);
    }
  }
  for (const key of Object.keys(catalog)) {
    if (!expected.has(key)) {
      errors.push(`в каталоге посторонний компонент «${key}» (контракт 4.4.4.1: только ${EOS_PURE_COMPONENT_IDS.join(', ')})`);
    }
  }
  return errors;
}

// ============================================
// 6. СТРУКТУРИРОВАННАЯ ОШИБКА И FAIL-CLOSED LOOKUP
// ============================================

/** Коды ошибок каталога параметров EOS. */
export type EosParametersErrorCode =
  | 'unknown_gas'          // идентификатор не входит в каталог
  | 'invalid_catalog_record'; // запись не прошла валидацию — отдаётся отказ

/**
 * Структурированная ошибка каталога EOS (по образцу ScientificValueError /
 * EquilibriumErrorCode): код, компонент, gasId, список проблем.
 */
export class EosParametersError extends Error {
  readonly code: EosParametersErrorCode;
  readonly component = 'EosParameters';
  readonly gasId: string;
  readonly issues: readonly string[];

  constructor(
    code: EosParametersErrorCode,
    message: string,
    gasId: string,
    issues: readonly string[] = []
  ) {
    super(`[EosParameters] ${message}`);
    this.name = 'EosParametersError';
    this.code = code;
    this.gasId = gasId;
    this.issues = issues;
  }
}

/**
 * Fail-closed lookup параметров чистого компонента. Отказ (не «полный
 * набор по умолчанию») происходит, если:
 * - идентификатор не входит в каталог (unknown_gas) — включая h2 и
 *   вещества вне пяти компонентов;
 * - запись не прошла структурную валидацию (invalid_catalog_record).
 * Возвращается только полностью валидная запись; «частично готовый»
 * набор не выдаётся.
 */
export function getEosPureComponentParameters(gasId: string): EosPureComponentParameters {
  if (typeof gasId !== 'string' || gasId.trim() === '') {
    throw new EosParametersError(
      'unknown_gas',
      `пустой идентификатор компонента; каталог 4.4.4.1 содержит: ${EOS_PURE_COMPONENT_IDS.join(', ')}`,
      String(gasId)
    );
  }
  const record = (EOS_PURE_COMPONENT_PARAMETERS as Record<string, EosPureComponentParameters | undefined>)[gasId];
  if (record === undefined) {
    throw new EosParametersError(
      'unknown_gas',
      `компонент «${gasId}» не входит в каталог параметров Peng–Robinson ` +
        `(Stage 4.4.4.1: ${EOS_PURE_COMPONENT_IDS.join(', ')}; ` +
        `h2 исключён: ${EOS_H2_EXCLUSION_NOTE})`,
      gasId
    );
  }
  const issues = validateEosPureComponentRecord(record);
  if (issues.length > 0) {
    throw new EosParametersError(
      'invalid_catalog_record',
      `запись «${gasId}» не прошла валидацию; параметры НЕ выдаются`,
      gasId,
      issues
    );
  }
  return record;
}

/** Список идентификаторов каталога (детерминированный порядок). */
export function listEosPureComponentIds(): readonly string[] {
  return EOS_PURE_COMPONENT_IDS;
}
