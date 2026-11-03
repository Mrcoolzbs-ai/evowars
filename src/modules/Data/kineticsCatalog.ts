// ============================================
// KINETIC CATALOG - Каталог кинетических записей реакций на основе
// проверяемых источников JPL/KIDA (Stage 4.5.4)
// ============================================
//
// Подэтап 4.5.4 (docs/science/IMPLEMENTATION_ROADMAP.md §4.5.4):
// типизированный каталог кинетических записей, совместимый с контрактами
// 4.5.1 (KineticReactionRecord, validateKineticReactionRecord —
// Core/kinetics.ts) и вычислителем k(T) 4.5.2 (evaluateRateConstant),
// подготовленный для подключения к ODE-интегратору 4.5.3 в 4.5.5.
//
// АУДИТ ИСТОЧНИКОВ (03.11.2026, проверено фактически):
// - JPL Evaluation No. 20 (JPL Publication 25-1, 2025, DOI
//   10.48577/jpl.KFQ0TZ): автоматический доступ к таблицам данных
//   ЗАБЛОКИРОВАН (jpldataeval.jpl.nasa.gov отдаёт отказ автоматическим
//   клиентам; dataverse.jpl.nasa.gov — Access Denied; текстовые PDF
//   предыдущих выпусков обрезаются при извлечении до таблиц).
//   Per-record импорт JPL НЕ выполнен; дескриптор источника оставлен
//   для следующей итерации (JPL_EVALUATION_SOURCE ниже).
// - KIDA (kida.astrochem-tools.org): поиск по сайту выполняется
//   клиентским JS, машиночитаемого API нет; форма уширения F для
//   трёхтелесных реакций опубликована в справке КАК ИЗОБРАЖЕНИЕ —
//   точная семантика Fc/уширения текстом НЕ верифицируема.
// - РЕАЛЬНЫЙ ЧИТАЕМЫЙ ИСТОЧНИК: экспорт трёхтелесной сети KIDA
//   kida_reac_tb_2015-03-19_1.csv (30 058 байт) + readme с полной
//   спецификацией 36 колонок (kida_readme_tb_2015-03-19_1.txt),both
//   получены 2026-11-03 из версионируемой копии SophiaAtmo/PATMO,
//   коммит d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd (полный текст CSV
//   получен и сверен; копия PATMO содержит помеченные правки
//   «#MODIFIED» — задокументированы в limitations provenance и
//   DATA_PROVENANCE.md §2.28).
//
// ПРИНЯТОЕ РЕШЕНИЕ (fail-closed, без выдумывания):
// - 5 реакций экспорта импортированы как записи РЕАКЦИОННОЙ
//   ИДЕНТИЧНОСТИ: состав реагентов/продуктов, номер реакции,
//   диапазон температуры и ВСЕ числовые блоки экспорта сохранены
//   ДОСЛОВНО (в provenance.rawInput, включая исходную строку rawLine);
// - rateConstant.status === 'unknown': параметры НЕ промоутированы в
//   known/estimated. Причины — блокирующие вопросы
//   (KINETIC_CATALOG_BLOCKING_QUESTIONS): (1) семантика Fc/уширения
//   KIDA неверифицируема (форма F — изображение; контракт 4.5.2
//   требует явные константные centeringFactorFc и broadeningN в
//   Troe-форме F = Fc^(1/(1+(log10(Pr)/N)^2)), а блок Fc экспорта
//   содержит сентинелы «не задано» (0; 1e99; 1e-99; 1e99) либо
//   T-зависимый Fc(T) из параметров Troe); (2) экспорт не содержит
//   per-record ссылок на первоисточники; (3) явная открытая лицензия
//   KIDA не публикуется (unverified). Молчаливые допущения о единицах
//   и формах запрещены задачей этапа.
// - evaluateRateConstant для каждой записи честно отклоняет расчёт
//   (KineticsError no_kinetic_data) — интеграция с 4.5.5 невозможна
//   до снятия блокировок.
//
// ГРАНИЦЫ: Radau IIA-решатель 4.5.3, NASA CEA, golden baseline и
// gameSpeedCoefficient этим модулем НЕ затрагиваются. Синтетические
// записи допустимы ТОЛЬКО в тестах (явная пометка SYNTHETIC).

import type { KineticReactionRecord } from '../Core/kinetics';
import { validateKineticReactionRecord } from '../Core/kinetics';

// ============================================
// 1. ДЕСКРИПТОРЫ ИСТОЧНИКОВ
// ============================================

/**
 * Дескриптор источника кинетических данных: стабильная, проверяемая
 * идентификация (название, идентификатор, URL, цитирование, лицензия,
 * дата обращения). Значения дескрипторов — константы ниже.
 */
export interface KineticsDataSourceDescriptor {
  /** Название источника. */
  readonly sourceName: string;
  /** Стабильный идентификатор источника. */
  readonly sourceId: string;
  /** Проверяемый URL (страница или версионируемая копия данных). */
  readonly url: string;
  /** Обязательное цитирование. */
  readonly citation: string;
  /** Лицензия или честный статус её определения. */
  readonly license: string;
  /** Дата обращения (ISO). */
  readonly retrievedAt: string;
  /** Свободное примечание (доступность, ограничения). */
  readonly note?: string;
}

/** База KIDA (сайт); per-record данные импортируются из экспорта ниже. */
export const KIDA_DATABASE_SOURCE: KineticsDataSourceDescriptor = {
  sourceName: 'KIDA — Kinetic Database for Astrochemistry',
  sourceId: 'kida.astrochem-tools.org',
  url: 'https://kida.astrochem-tools.org/',
  citation: 'Wakelam, V. et al. 2012, ApJS 199, 21 (KIDA)',
  license:
    'unverified: явная открытая лицензия на данные KIDA не публикуется; обязательно цитирование Wakelam et al. 2012, ApJS 199, 21',
  retrievedAt: '2026-11-03',
  note: 'справка по трёхтелесным реакциям (kida.astrochem-tools.org/help): форма уширения F опубликована как изображение — текстом не верифицируема; Fc по умолчанию 0.64 (политика JPL, Sander et al. 2006, по справке KIDA); поиск по сайту — клиентский JS, машиночитаемого API нет'
};

/** Экспорт трёхтелесной сети KIDA — фактический источник записей каталога. */
export const KIDA_TB_EXPORT_SOURCE: KineticsDataSourceDescriptor = {
  sourceName: 'KIDA three-body network export (kida_reac_tb_2015-03-19_1.csv)',
  sourceId: 'kida-tb-2015-03-19',
  url: 'https://raw.githubusercontent.com/SophiaAtmo/PATMO/d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd/data/kida/kida_reac_tb_2015-03-19_1.csv',
  citation: 'Wakelam, V. et al. 2012, ApJS 199, 21 (KIDA); формат колонок — kida_readme_tb_2015-03-19_1.txt',
  license:
    'unverified: данные получены из версионируемой копии SophiaAtmo/PATMO@d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd; явная открытая лицензия на данные KIDA не публикуется',
  retrievedAt: '2026-11-03',
  note: '30 058 байт, сеть 94 вида / 112 реакций (по шапке readme); 36 колонок специфицированы в readme; копия PATMO содержит помеченные правки «#MODIFIED»: у реакций 89/90 оставлена одна строка с максимальным диапазоном температуры, реакция 101 закомментирована («not clear from KIDA what is the correct rate»); экспорт не содержит per-record ссылок на первоисточники'
};

/**
 * JPL Evaluation No. 20 — целевой источник этапа 4.5, НЕ импортирован:
 * автоматический доступ к таблицам заблокирован (см. шапку модуля).
 * Дескриптор фиксирует проверяемую идентификацию для следующей итерации.
 */
export const JPL_EVALUATION_SOURCE: KineticsDataSourceDescriptor = {
  sourceName: 'NASA JPL Chemical Kinetics and Photochemical Data Evaluation, No. 20',
  sourceId: 'jpl-evaluation-20',
  url: 'https://science.jpl.nasa.gov/projects/data-evaluation/',
  citation: 'JPL Publication 25-1 (2025), DOI 10.48577/jpl.KFQ0TZ',
  license: 'government work; условия использования проверить',
  retrievedAt: '2026-11-03',
  note: 'НЕ импортирован в 4.5.4: jpldataeval.jpl.nasa.gov и dataverse.jpl.nasa.gov блокируют автоматический доступ; таблицы данных не верифицированы машиной — per-record импорт запрещён до получения проверяемого доступа'
};

// ============================================
// 2. ДОСЛОВНЫЕ ЗАПИСИ ЭКСПОРТА KIDA (3-BODY)
// ============================================

/**
 * Блок параметров k0 или k∞ экспорта KIDA (колонки 9–15 / 16–22):
 * alpha, beta, gamma (KIDA: k = alpha·(T/300)^beta·exp(gamma/T)),
 * неопределённость (фактор, температурная зависимость, тип
 * logn/norm/…) и код формулы. Значения дословные, сентинелы НЕ
 * переинтерпретируются.
 */
export interface KidaTbParameterBlock {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
  readonly uncertaintyFactor: number;
  readonly temperatureDependenceUncertainty: number;
  readonly uncertaintyType: string;
  readonly formulaCode: number;
}

/**
 * Блок центрирующего фактора Fc (колонки 23–28): a, b, c, d, фактор
 * неопределённости, тип, код формулы. Сентинелы экспорта (b = 1e99,
 * c = 1e-99, d = 1e99 при a = 0 — «Fc не задан») сохраняются как есть.
 */
export interface KidaTbFcBlock {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly uncertaintyFactor: number;
  readonly uncertaintyType: string;
  readonly formulaCode: number;
}

/**
 * Дословная запись строки экспорта kida_reac_tb_2015-03-19_1.csv
 * (все 36 колонок по спецификации kida_readme_tb_2015-03-19_1.txt;
 * rawLine — исходная строка CSV без изменений).
 */
export interface KidaTbRawRecord {
  /** Номер реакции в сети KIDA (колонка 34). */
  readonly kidaReactionNumber: number;
  /** Реагенты (колонки 1–3, имена видов KIDA). */
  readonly reactants: readonly string[];
  /** Продукты (колонки 4–8, имена видов KIDA, пустые колонки опущены). */
  readonly products: readonly string[];
  /** Низкоплотностный предел k0 (колонки 9–15). */
  readonly lowPressureLimitK0: KidaTbParameterBlock;
  /** Высокоплотностный предел k∞ (колонки 16–22). */
  readonly highPressureLimitKInf: KidaTbParameterBlock;
  /** Блок центрирующего фактора Fc (колонки 23–28). */
  readonly centeringFactorFc: KidaTbFcBlock;
  /** Диапазон применимости, K (колонки 29–30). */
  readonly temperatureRangeK: { readonly min: number; readonly max: number };
  /** Диапазон давления (колонки 31–32; -9999/9999 — «любое», по readme). */
  readonly pressureRange: { readonly min: number; readonly max: number };
  /** Код формулы глобальной константы скорости (колонка 33). */
  readonly globalFormulaCode: number;
  /** Сколько раз реакция присутствует в сети (колонка 35). */
  readonly networkMultiplicity: number;
  /** Рекомендация экспертов KIDA (колонка 36; 2 — валидировано по Trange). */
  readonly recommendation: number;
  /** Исходная строка CSV без изменений (дословно). */
  readonly rawLine: string;
}

/**
 * Пять реакций экспорта (выбор 4.5.4: только N2-коллайдер, одна строка
 * на реакцию, recommendation 2). Строки скопированы дословно из
 * kida_reac_tb_2015-03-19_1.csv (PATMO@d78ec8e2, получен 2026-11-03).
 */
export const KIDA_TB_RAW_RECORDS: readonly KidaTbRawRecord[] = [
  {
    kidaReactionNumber: 1,
    reactants: ['H', 'H', 'N2'],
    products: ['H2', 'N2'],
    lowPressureLimitK0: {
      alpha: 9.14e-33,
      beta: -0.6,
      gamma: 0,
      uncertaintyFactor: 3.16,
      temperatureDependenceUncertainty: 100,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    highPressureLimitKInf: {
      alpha: 1.0e-10,
      beta: 0,
      gamma: 0,
      uncertaintyFactor: 2.0,
      temperatureDependenceUncertainty: 100,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    centeringFactorFc: {
      a: 0,
      b: 1e99,
      c: 1e-99,
      d: 1e99,
      uncertaintyFactor: 0,
      uncertaintyType: 'logn',
      formulaCode: 7
    },
    temperatureRangeK: { min: 50, max: 200 },
    pressureRange: { min: -9999, max: 9999 },
    globalFormulaCode: 6,
    networkMultiplicity: 1,
    recommendation: 2,
    rawLine:
      'H;H;N2;H2;N2; ; ; ; ; 9.140e-33;-6.000e-01; 0.000e+00; 3.160e+00; 1.000e+02;logn;3; 1.000e-10; 0.000e+00; 0.000e+00; 2.000e+00; 1.000e+02;logn; 3; 0.000e+00; 1.000e+99; 1.000e-99; 1.000e+99; 0.000e+00;logn; 7;    50;   200; -9999;  9999; 6;    1;1 ;2'
  },
  {
    kidaReactionNumber: 70,
    reactants: ['O', 'H', 'N2'],
    products: ['OH', 'N2'],
    lowPressureLimitK0: {
      alpha: 4.33e-32,
      beta: -1.0,
      gamma: 0,
      uncertaintyFactor: 5.0,
      temperatureDependenceUncertainty: 100,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    highPressureLimitKInf: {
      alpha: 1.0e-10,
      beta: 0,
      gamma: 0,
      uncertaintyFactor: 2.0,
      temperatureDependenceUncertainty: 100,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    centeringFactorFc: {
      a: 0,
      b: 1e99,
      c: 1e-99,
      d: 1e99,
      uncertaintyFactor: 0,
      uncertaintyType: 'logn',
      formulaCode: 7
    },
    temperatureRangeK: { min: 50, max: 200 },
    pressureRange: { min: -9999, max: 9999 },
    globalFormulaCode: 6,
    networkMultiplicity: 1,
    recommendation: 2,
    rawLine:
      'O;H;N2;OH;N2; ; ; ; ; 4.330e-32;-1.000e+00; 0.000e+00; 5.000e+00; 1.000e+02;logn;3; 1.000e-10; 0.000e+00; 0.000e+00; 2.000e+00; 1.000e+02;logn; 3; 0.000e+00; 1.000e+99; 1.000e-99; 1.000e+99; 0.000e+00;logn; 7;    50;   200; -9999;  9999; 6;   70;1 ;2'
  },
  {
    kidaReactionNumber: 72,
    reactants: ['OH', 'H', 'N2'],
    products: ['H2O', 'N2'],
    lowPressureLimitK0: {
      alpha: 6.78e-31,
      beta: -2.0,
      gamma: 0,
      uncertaintyFactor: 2.0,
      temperatureDependenceUncertainty: 100,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    highPressureLimitKInf: {
      alpha: 1.0e-10,
      beta: 0,
      gamma: 0,
      uncertaintyFactor: 2.0,
      temperatureDependenceUncertainty: 100,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    centeringFactorFc: {
      a: 0,
      b: 1e99,
      c: 1e-99,
      d: 1e99,
      uncertaintyFactor: 0,
      uncertaintyType: 'logn',
      formulaCode: 7
    },
    temperatureRangeK: { min: 50, max: 200 },
    pressureRange: { min: -9999, max: 9999 },
    globalFormulaCode: 6,
    networkMultiplicity: 1,
    recommendation: 2,
    rawLine:
      'OH;H;N2;H2O;N2; ; ; ; ; 6.780e-31;-2.000e+00; 0.000e+00; 2.000e+00; 1.000e+02;logn;3; 1.000e-10; 0.000e+00; 0.000e+00; 2.000e+00; 1.000e+02;logn; 3; 0.000e+00; 1.000e+99; 1.000e-99; 1.000e+99; 0.000e+00;logn; 7;    50;   200; -9999;  9999; 6;   72;1 ;2'
  },
  {
    kidaReactionNumber: 89,
    reactants: ['O', 'NO', 'N2'],
    products: ['NO2', 'N2'],
    lowPressureLimitK0: {
      alpha: 1.0e-31,
      beta: -1.6,
      gamma: 0,
      uncertaintyFactor: 1.26,
      temperatureDependenceUncertainty: 0,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    highPressureLimitKInf: {
      alpha: 4.9e-11,
      beta: -0.4,
      gamma: 0,
      uncertaintyFactor: 1.26,
      temperatureDependenceUncertainty: 0,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    centeringFactorFc: {
      a: 0.2,
      b: 1e99,
      c: 1e-99,
      d: 1e99,
      uncertaintyFactor: 0.067,
      uncertaintyType: 'norm',
      formulaCode: 7
    },
    temperatureRangeK: { min: 200, max: 2200 },
    pressureRange: { min: -9999, max: 9999 },
    globalFormulaCode: 6,
    networkMultiplicity: 3,
    recommendation: 2,
    rawLine:
      'O;NO;N2;NO2;N2; ; ; ; ; 1.000e-31;-1.600e+00; 0.000e+00; 1.260e+00; 0.000e+00;logn;3; 4.900e-11;-4.000e-01; 0.000e+00; 1.260e+00; 0.000e+00;logn; 3; 2.000e-01; 1.000e+99; 1.000e-99; 1.000e+99; 6.700e-02;norm; 7;   200;  2200; -9999;  9999; 6;   89;3 ;2'
  },
  {
    kidaReactionNumber: 106,
    reactants: ['H', 'O2', 'N2'],
    products: ['O2H', 'N2'],
    lowPressureLimitK0: {
      alpha: 4.4e-32,
      beta: -1.3,
      gamma: 0,
      uncertaintyFactor: 1.3,
      temperatureDependenceUncertainty: 50,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    highPressureLimitKInf: {
      alpha: 7.5e-11,
      beta: 0.2,
      gamma: 0,
      uncertaintyFactor: 1.3,
      temperatureDependenceUncertainty: 50,
      uncertaintyType: 'logn',
      formulaCode: 3
    },
    centeringFactorFc: {
      a: 0.4,
      b: 1e99,
      c: 1e-99,
      d: 1e99,
      uncertaintyFactor: 0,
      uncertaintyType: 'norm',
      formulaCode: 7
    },
    temperatureRangeK: { min: 200, max: 300 },
    pressureRange: { min: -9999, max: 9999 },
    globalFormulaCode: 6,
    networkMultiplicity: 1,
    recommendation: 2,
    rawLine:
      'H;O2;N2;O2H;N2; ; ; ; ; 4.400e-32;-1.300e+00; 0.000e+00; 1.300e+00; 5.000e+01;logn;3; 7.500e-11; 2.000e-01; 0.000e+00; 1.300e+00; 5.000e+01;logn; 3; 4.000e-01; 1.000e+99; 1.000e-99; 1.000e+99; 0.000e+00;norm; 7;   200;   300; -9999;  9999; 6;  106;1 ;2'
  }
];

// ============================================
// 3. СБОРКА ЗАПИСЕЙ КАТАЛОГА
// ============================================

/**
 * Префикс стабильных ID записей каталога: экспорт зафиксирован датой
 * 2015-03-19, ID не зависят от порядка массива и будущих дополнений.
 */
const KIDA_TB_RECORD_ID_PREFIX = 'kida-tb-2015-03-19-';

/** Стабильный ID записи каталога для номера реакции экспорта. */
export function kidaTbRecordId(kidaReactionNumber: number): string {
  return `${KIDA_TB_RECORD_ID_PREFIX}${kidaReactionNumber}`;
}

/** Человекочитаемая реакция из состава записи экспорта (НЕ стехиометрия). */
function kidaTbReactionString(raw: KidaTbRawRecord): string {
  return `${raw.reactants.join(' + ')} → ${raw.products.join(' + ')}`;
}

/**
 * Provenance константы записи: идентификация источника (KIDA tb-экспорт),
 * диапазон применимости, честные ограничения и rawInput со ВСЕМИ
 * дословными полями строки CSV (включая исходную rawLine).
 */
function kidaTbRateConstantProvenance(raw: KidaTbRawRecord) {
  return {
    sourceName: KIDA_TB_EXPORT_SOURCE.sourceName,
    sourceId: KIDA_TB_EXPORT_SOURCE.sourceId,
    datasetId: 'kida_reac_tb_2015-03-19_1.csv',
    datasetVersion: 'экспорт 2015-03-19; копия SophiaAtmo/PATMO@d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd',
    recordId: `kida-tb-2015-03-19:reaction=${raw.kidaReactionNumber}`,
    reference: KIDA_TB_EXPORT_SOURCE.citation,
    retrievedAt: KIDA_TB_EXPORT_SOURCE.retrievedAt,
    applicability: `диапазон температуры по экспорту: ${raw.temperatureRangeK.min}–${raw.temperatureRangeK.max} K; давление: ${raw.pressureRange.min}/${raw.pressureRange.max} (сентинелы экспорта, не физические границы)`,
    limitations:
      'экспорт не содержит per-record ссылок на первоисточники; копия PATMO содержит помеченные правки «#MODIFIED» (у реакций 89/90 оставлена строка с максимальным диапазоном температуры); параметры не промоутированы в known — блокирующие причины в KINETIC_CATALOG_BLOCKING_QUESTIONS',
    license: KIDA_TB_EXPORT_SOURCE.license,
    rawInput: {
      kidaReactionNumber: raw.kidaReactionNumber,
      networkMultiplicity: raw.networkMultiplicity,
      recommendation: raw.recommendation,
      globalFormulaCode: raw.globalFormulaCode,
      reactant1: raw.reactants[0] ?? '',
      reactant2: raw.reactants[1] ?? '',
      reactant3: raw.reactants[2] ?? '',
      product1: raw.products[0] ?? '',
      product2: raw.products[1] ?? '',
      product3: raw.products[2] ?? '',
      product4: raw.products[3] ?? '',
      product5: raw.products[4] ?? '',
      k0Alpha: raw.lowPressureLimitK0.alpha,
      k0Beta: raw.lowPressureLimitK0.beta,
      k0Gamma: raw.lowPressureLimitK0.gamma,
      k0UncertaintyFactor: raw.lowPressureLimitK0.uncertaintyFactor,
      k0TemperatureDependenceUncertainty: raw.lowPressureLimitK0.temperatureDependenceUncertainty,
      k0UncertaintyType: raw.lowPressureLimitK0.uncertaintyType,
      k0FormulaCode: raw.lowPressureLimitK0.formulaCode,
      kInfAlpha: raw.highPressureLimitKInf.alpha,
      kInfBeta: raw.highPressureLimitKInf.beta,
      kInfGamma: raw.highPressureLimitKInf.gamma,
      kInfUncertaintyFactor: raw.highPressureLimitKInf.uncertaintyFactor,
      kInfTemperatureDependenceUncertainty: raw.highPressureLimitKInf.temperatureDependenceUncertainty,
      kInfUncertaintyType: raw.highPressureLimitKInf.uncertaintyType,
      kInfFormulaCode: raw.highPressureLimitKInf.formulaCode,
      fcA: raw.centeringFactorFc.a,
      fcB: raw.centeringFactorFc.b,
      fcC: raw.centeringFactorFc.c,
      fcD: raw.centeringFactorFc.d,
      fcUncertaintyFactor: raw.centeringFactorFc.uncertaintyFactor,
      fcUncertaintyType: raw.centeringFactorFc.uncertaintyType,
      fcFormulaCode: raw.centeringFactorFc.formulaCode,
      tMinK: raw.temperatureRangeK.min,
      tMaxK: raw.temperatureRangeK.max,
      pMin: raw.pressureRange.min,
      pMax: raw.pressureRange.max,
      rawLine: raw.rawLine
    }
  };
}

/**
 * Запись каталога из дословной записи экспорта: реакционная
 * идентичность + rateConstant.status 'unknown' (параметры сохранены
 * в provenance.rawInput, НЕ промоутированы — причины блокировки
 * зафиксированы в KINETIC_CATALOG_BLOCKING_QUESTIONS). Трёхтелесная
 * рекобинация — elementary; overallOrder null (допустим только при
 * unknown); модель концентраций экспорта KIDA — molecule_cm3.
 */
export function buildKidaTbReactionRecord(raw: KidaTbRawRecord): KineticReactionRecord {
  return {
    id: kidaTbRecordId(raw.kidaReactionNumber),
    kind: 'elementary',
    overallOrder: null,
    concentrationModel: 'molecule_cm3',
    rateConstant: {
      status: 'unknown',
      note:
        'k(T) не рассчитано: блоки k0/k∞/Fc экспорта KIDA сохранены дословно в provenance.rawInput (включая rawLine), но не промоутированы в параметры known — семантика Fc/уширения KIDA неверифицируема (форма F опубликована изображением; блок Fc содержит сентинелы «не задано» или T-зависимый Fc(T), а контракт 4.5.2 требует явные константные centeringFactorFc и broadeningN), экспорт не содержит per-record ссылок на первоисточники, лицензия unverified; вычислитель обязан отказывать (no_kinetic_data)',
      provenance: kidaTbRateConstantProvenance(raw)
    },
    provenance: {
      sourceName: KIDA_TB_EXPORT_SOURCE.sourceName,
      sourceId: KIDA_TB_EXPORT_SOURCE.sourceId,
      datasetId: 'kida_reac_tb_2015-03-19_1.csv',
      datasetVersion: 'экспорт 2015-03-19; копия SophiaAtmo/PATMO@d78ec8e2bcabc2c4071e71f12a9f817873ebd5dd',
      recordId: `kida-tb-2015-03-19:reaction=${raw.kidaReactionNumber}`,
      reference: KIDA_TB_EXPORT_SOURCE.citation,
      retrievedAt: KIDA_TB_EXPORT_SOURCE.retrievedAt,
      license: KIDA_TB_EXPORT_SOURCE.license,
      note: `реакционная идентичность записи KIDA №${raw.kidaReactionNumber} (recommendation 2 — валидировано экспертами по заявленному диапазону температуры)`
    },
    reaction: kidaTbReactionString(raw),
    note:
      'имена видов — номенклатура KIDA (O2H — HO2 в нотации KIDA); поле reaction человекочитаемо и НЕ является стехиометрией сети (сопряжение со стехиометрией видов — этап 4.5.5)'
  };
}

/** Записи каталога Stage 4.5.4 (реакционные идентичности KIDA, параметры unknown). */
export const KINETIC_CATALOG_DATA: readonly KineticReactionRecord[] =
  KIDA_TB_RAW_RECORDS.map((raw) => buildKidaTbReactionRecord(raw));

// ============================================
// 4. КАТАЛОГ: СТРОГАЯ СБОРКА С ВАЛИДАЦИЕЙ
// ============================================

/** Ошибка сборки каталога: невалидная запись или дублирующийся ID. */
export class KineticsCatalogError extends Error {
  constructor(message: string) {
    super(`[kineticsCatalog] ${message}`);
    this.name = 'KineticsCatalogError';
  }
}

/** Собранный каталог кинетических записей (только чтение). */
export interface KineticsCatalog {
  /** Стабильный список ID записей (в порядке исходного массива). */
  listIds(): readonly string[];
  /** Запись по ID; null — записи нет (без подмены и выдумывания). */
  get(id: string): KineticReactionRecord | null;
  /** Есть ли запись с данным ID. */
  has(id: string): boolean;
  /** Число записей. */
  size(): number;
}

/**
 * Сборка каталога из записей: каждая запись проходит строгую
 * валидацию контракта 4.5.1 (validateKineticReactionRecord — пустой
 * список проблем обязателен), дубли ID запрещены. Ошибки — исключение
 * KineticsCatalogError с полной диагностикой (fail-closed: повреждённая
 * запись не попадает в каталог молча).
 */
export function buildKineticsCatalog(
  records: readonly KineticReactionRecord[] = KINETIC_CATALOG_DATA
): KineticsCatalog {
  const byId = new Map<string, KineticReactionRecord>();
  const order: string[] = [];
  for (const record of records) {
    if (typeof record?.id !== 'string' || record.id.trim() === '') {
      throw new KineticsCatalogError('запись без id не может быть добавлена в каталог');
    }
    const issues = validateKineticReactionRecord(record);
    if (issues.length > 0) {
      throw new KineticsCatalogError(
        `запись «${record.id}» не проходит валидацию контракта 4.5.1: ${issues.join('; ')}`
      );
    }
    if (byId.has(record.id)) {
      throw new KineticsCatalogError(
        `дублирующийся id записи каталога: «${record.id}» (id обязан быть уникальным)`
      );
    }
    byId.set(record.id, record);
    order.push(record.id);
  }
  return {
    listIds: () => [...order],
    get: (id: string) => (byId.has(id) ? (byId.get(id) as KineticReactionRecord) : null),
    has: (id: string) => byId.has(id),
    size: () => order.length
  };
}

// ============================================
// 5. БЛОКИРУЮЩИЕ ВОПРОСЫ ЭТАПА (экспортируются явно)
// ============================================

/**
 * Блокирующие вопросы 4.5.4: до их решения параметры реакций KIDA НЕ
 * промоутируются в known/estimated, и каталог не подключается к
 * вычислителю k(T) (4.5.5 невозможна на этих записях).
 */
export const KINETIC_CATALOG_BLOCKING_QUESTIONS: readonly string[] = [
  'Семантика Fc/уширения KIDA: форма уширения F опубликована в справке KIDA как изображение (текстом не верифицируема); блок Fc экспорта содержит сентинелы «не задано» (a=0; b=1e99; c=1e-99; d=1e99) либо T-зависимый Fc(T) из параметров Troe, а контракт 4.5.2 (kinetics.ts) требует явные константные centeringFactorFc ∈ (0,1] и broadeningN > 0 в Troe-форме F = Fc^(1/(1+(log10(Pr)/N)^2)) — соответствие форм KIDA и проекта должно быть подтверждено публикацией KIDA или командой KIDA',
  'JPL Evaluation No. 20 (JPL Publication 25-1, 2025, DOI 10.48577/jpl.KFQ0TZ): автоматический доступ к таблицам данных заблокирован (jpldataeval.jpl.nasa.gov, dataverse.jpl.nasa.gov) — per-record импорт JPL требует проверяемого доступа (ручное извлечение таблиц или API)',
  'Экспорт KIDA не содержит per-record ссылок на первоисточники, а явная открытая лицензия на данные KIDA не публикуется (unverified): промоутинг параметров требует подтверждения первоисточников и условий использования у команды KIDA (цитирование Wakelam et al. 2012, ApJS 199, 21 обязательно)'
];
