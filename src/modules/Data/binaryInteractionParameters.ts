// ============================================
// BINARY INTERACTION PARAMETERS — каталог kij Peng–Robinson
// для пар компонентов (Stage 4.4.4.3)
// ============================================
//
// Stage 4.4.4.3 «Peng–Robinson для многокомпонентных смесей», подэтап 1:
// аудит источников бинарных параметров взаимодействия и каталог kij
// с per-pair provenance для ПАР пяти существующих компонентов
// (co2, n2, ch4, h2o, ar). H2 исключён из EOS-каталога Stage 4.4.4.1
// и в этот каталог пар НЕ входит.
//
// Контракт подэтапа — ТОЛЬКО данные, их provenance, runtime-валидация
// и fail-closed lookup. Математика смешения (a_ij, a_mix, b_mix,
// A_mix, B_mix, ln(phi_i)) — Core/pengRobinsonMixture.ts; фасад
// каталога + kij над вычислителем Core —
// Data/pengRobinsonMixtureFacade.ts. Flash, VLE/LLE, фазовая
// устойчивость, PPR78 и интеграция с solveEquilibrium НЕ реализуются.
//
// ИТОГ АУДИТА ИСТОЧНИКОВ (значения kij классического PR с классическими
// правилами смешения; поиск выполнен 2026-11-05):
//
// 1) Okoro et al. 2024, Greenhouse Gases: Science and Technology 14,
//    829–858, DOI 10.1002/ghg.2300 (открытый доступ, © 2024
//    The Author(s)). Таблица 1 «BIPs used in this work with PR-EoS and
//    classical mixing rules», колонка «Original BIP» (подгонка авторов
//    к литературным VLE-данным, рис. 1–4):
//      - co2–ch4: 0.09897
//      - co2–ar:  0.129219
//      - co2–n2:  -0.01700
//    «Adjusted» (температурно-зависимые квадратичные) версии той же
//    таблицы НЕ используются: это другая параметризация, а не
//    подтверждение константного значения. Собственные измерения
//    источника — CO2-rich смеси (95–99.5% CO2), 228.15–273.15 K,
//    давление до ~30 МПа; верифицированная применимость каталога
//    консервативно ограничена этим диапазоном температур.
//
// 2) Köster, Thol & Vrabec 2018, J. Chem. Eng. Data 63(2), 305–320,
//    DOI 10.1021/acs.jced.7b00706. Таблица 4 (kij для PR и PC-SAFT,
//    подобраны методом наименьших квадратов к экспериментальным
//    VLE/vapor pressure данным; в рассмотренном авторами диапазоне
//    значения температурно-независимы):
//      - n2–ar:   -0.0037
//      - n2–h2o:  -0.0501
//    Для h2o–ar PR-kij в этой публикации НЕ опубликован (только
//    combining-параметр xi = 1.05 молекулярной модели, который PR-kij
//    НЕ является и НЕ подставляется). Точные границы температурных
//    диапазонов подгонки в этой ревизии НЕ верифицированы (таблицы и
//    рисунки за пределами доступного фрагмента рукописи), поэтому
//    числовое ограничение применимости для этих пар НЕ назначается
//    (не выдумывается).
//
// 3) Остальные пары каталога (co2–h2o, ch4–n2, ch4–ar, ch4–h2o,
//    h2o–ar) — значения с подтверждённым происхождением в источниках
//    этой ревизии НЕ найдены: статус unresolved, ЯВНЫЙ отказ при
//    расчёте. Для co2–h2o классический PR с константным kij
//    недостаточен (аудит Stage 4.4.4.0). Для co2–n2 существует
//    дополнительный источник (группа Vrabec, Int. J. Thermophys. 2009,
//    рукопись 200902Henry_Kedia.pdf: PR-kij для N2+CO2 в Table 4),
//    но числовое значение в этой ревизии НЕ извлечено и НЕ
//    используется — подгонять/угадывать его запрещено.
//
// ПОЛИТИКА КАТАЛОГА:
// - значения CoolProp (встроенные дефолтные бинарные параметры PR
//   backend) за независимо подтверждённые экспериментальные данные
//   НЕ выдаются и в каталог НЕ импортируются;
// - kij = 0 НЕ является «нейтральным» значением: опубликованное
//   нулевое значение допустимо, молчаливая подстановка нуля — нет;
// - отсутствие/неподтверждённость kij = отказ (fail-closed), а не
//   kij = 0 и не идеализация;
// - все значения kij классического PR с классическими (vdW one-fluid)
//   правилами смешения предполагаются СИММЕТРИЧНЫМИ (kij = kji):
//   каталог хранит одну запись на канонический ключ пары;
// - evidence-статусы чистокомпонентного EOS-каталога Stage 4.4.4.1
//   НЕ повышаются; собственные статусы kij — PARTIALLY_VERIFIED
//   (значения опубликованы, но подогнаны авторами источников, а не
//   подтверждены первичными экспериментами независимо);
// - PPR78 и другие групповые модели НЕ реализуются и значения из них
//   НЕ импортируются.
//
// ИММУТАБИЛЬНОСТЬ (паттерн Stage 4.4.4.2): все структуры каталога
// глубоко заморожены (deepFreeze) — канонические значения нельзя
// изменить через lookup.

import type {
  EosCrossCheck,
  EosParameterProvenance,
  EosPureComponentGasId,
  EosScalarParameter
} from './eosParameters';
import {
  EOS_CROSS_CHECK_OUTCOMES,
  EOS_EVIDENCE_STATUSES,
  EOS_PURE_COMPONENT_IDS,
  EOS_VALUE_ORIGINS
} from './eosParameters';

// ============================================
// 1. ТИПЫ: КАНОНИЧЕСКИЙ КЛЮЧ, ЗАПИСЬ ПАРЫ
// ============================================

/** Дата обращения к источникам аудита этой ревизии каталога. */
export const BINARY_INTERACTIONS_RETRIEVED_AT = '2026-11-05';

/**
 * Канонический ключ пары компонентов: два РАЗНЫИХ идентификатора,
 * отсортированных лексикографически, соединённых '|'. Одна пара —
 * один ключ (дублей i-j/j-i нет). Идентификаторы каталога
 * (co2, n2, ch4, h2o, ar) символ '|' не содержат.
 */
export function canonicalBinaryPairKey(
  componentA: string,
  componentB: string
): string {
  const [first, second] = [componentA, componentB].sort();
  return first + '|' + second;
}

/** Статус пары: доступное значение или явное отсутствие (unknown). */
export type BinaryInteractionPairStatus = 'available' | 'unresolved';

/** Runtime-реестр статусов пар. */
export const BINARY_PAIR_STATUSES: readonly BinaryInteractionPairStatus[] = [
  'available',
  'unresolved'
];

/**
 * Верифицированный диапазон применимости константного kij по
 * температуре (K). Отсутствие диапазона — НЕ «применимо всегда»:
 * это «границы опубликованной подгонки в этой ревизии не
 * верифицированы» (см. basis записи и provenance.applicability).
 */
export interface BinaryInteractionApplicability {
  readonly minTemperatureK: number;
  readonly maxTemperatureK: number;
  /** Основание ограничения (какой диапазон источника верифицирован). */
  readonly basis: string;
}

/**
 * Пара с верифицированным значением kij: значение + per-pair
 * provenance (паттерн EosScalarParameter каталога 4.4.4.1).
 * Симметричность — по построению (классические правила смешения).
 */
export interface BinaryInteractionAvailableRecord {
  readonly status: 'available';
  readonly componentA: EosPureComponentGasId;
  readonly componentB: EosPureComponentGasId;
  /** kij (безразмерный, единица '1'; знак любой, конечность обязательна). */
  readonly kij: EosScalarParameter;
  /** Классические правила смешения используют симметричный kij = kji. */
  readonly symmetric: true;
  /** Верифицированный температурный диапазон или null (не верифицирован). */
  readonly applicabilityRangeK: Readonly<BinaryInteractionApplicability> | null;
  /** Задокументированные сверки с независимыми источниками. */
  readonly crossChecks: readonly EosCrossCheck[];
  /** Ограничения применимости значения. */
  readonly limitations: readonly string[];
}

/**
 * Пара БЕЗ подтверждённого значения: явный отказ, а не подстановка
 * нуля/идеализации. Основание фиксирует результат аудита источников.
 */
export interface BinaryInteractionUnresolvedRecord {
  readonly status: 'unresolved';
  readonly componentA: EosPureComponentGasId;
  readonly componentB: EosPureComponentGasId;
  /** Почему значение unknown/unresolved (результат аудита). */
  readonly reason: string;
  /** Какие источники рассмотрены и что в них есть/отсутствует. */
  readonly auditNote: string;
}

/** Запись пары: discriminated union по status. */
export type BinaryInteractionPairRecord =
  | BinaryInteractionAvailableRecord
  | BinaryInteractionUnresolvedRecord;

// ============================================
// 2. ОГРАНИЧЕНИЯ ОБЛАСТИ КАТАЛОГА
// ============================================

/** Границы области каталога пар. */
export const BINARY_INTERACTIONS_SCOPE_NOTE: string =
  'Stage 4.4.4.3: каталог содержит ТОЛЬКО бинарные параметры ' +
  'взаимодействия kij классического Peng–Robinson с классическими ' +
  '(vdW one-fluid) правилами смешения для пар пяти компонентов ' +
  '(co2, n2, ch4, h2o, ar). Значения — подгоночные константы из ' +
  'опубликованных источников с per-pair provenance; применимость ' +
  'подгонки ограничена диапазоном данных источника (для пар Okoro ' +
  '2024 — 228.15–273.15 K). PPR78, температурные корреляции ' +
  '(adjusted-версии Okoro) и групповые модели НЕ реализуются. ' +
  'Наличие kij НЕ является доказательством применимости PR к смеси: ' +
  'flash/VLE/LLE и фазовая устойчивость вне объёма Stage 4.4.4.3.';

/** Запрет молчаливого нуля (kij = 0 не нейтрален). */
export const BINARY_NO_ZERO_DEFAULT_NOTE: string =
  'Отсутствие или неподтверждённость kij для пары — ЯВНЫЙ отказ ' +
  '(fail-closed), а не kij = 0 и не молчаливая идеализация: ' +
  'kij = 0 не является «нейтральным» значением. Нулевой kij ' +
  'допустим ТОЛЬКО если он опубликован источником для данной пары ' +
  'с подтверждённым происхождением (в этой ревизии таких пар нет).';

// ============================================
// 3. ИСТОЧНИКИ ДАННЫХ (дескрипторы для provenance)
// ============================================

/** Публикация — источник значений kij (сохранённые дескрипторы). */
interface KijPublication {
  readonly sourceName: string;
  readonly sourceId: string;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly reference: string;
  readonly license: string;
}

/** Okoro et al. 2024 (GHG: S&T): Original BIP, PR-EoS + классические правила смешения. */
const OKORO_2024: KijPublication = {
  sourceName:
    'Okoro et al. 2024, Greenhouse Gases: Science and Technology 14, 829–858',
  sourceId: 'doi:10.1002/ghg.2300',
  datasetId:
    'Таблица 1 «BIPs used in this work with PR-EoS and classical mixing rules», ' +
    'колонка «Original BIP»',
  datasetVersion:
    'публикация GHG: S&T 14, 829–858 (2024); journal-статья, отдельная версия ' +
    'набора данных публикацией не версифицируется',
  reference:
    'Okoro et al. Greenhouse Gases: Science and Technology 14, 829–858 (2024). ' +
    'DOI: 10.1002/ghg.2300. Таблица 1 (PR-EoS с классическими правилами смешения, ' +
    'колонка «Original BIP» — подгонка к литературным VLE-данным, рис. 1–4); ' +
    'открытый доступ (© 2024 The Author(s))',
  license:
    'открытый доступ, © 2024 The Author(s), Greenhouse Gases: Science and ' +
    'Technology (Wiley); значения цитируются с атрибуцией'
};

/** Köster, Thol & Vrabec 2018 (JCED): Таблица 4, kij PR. */
const KOSTER_2018: KijPublication = {
  sourceName:
    'Köster, Thol & Vrabec 2018, J. Chem. Eng. Data 63(2), 305–320',
  sourceId: 'doi:10.1021/acs.jced.7b00706',
  datasetId:
    'Таблица 4 (kij для PR и PC-SAFT; метод наименьших квадратов по ' +
    'экспериментальным VLE/vapor pressure данным)',
  datasetVersion:
    'публикация J. Chem. Eng. Data 63(2), 305–320 (2018); авторская рукопись ' +
    'mb.uni-paderborn.de (quinaer.pdf)',
  reference:
    'Köster, A.; Thol, M.; Vrabec, J. Molecular Models for the Hydrogen Age: ' +
    'Hydrogen, Nitrogen, Oxygen, Argon, and Water. J. Chem. Eng. Data 63(2), ' +
    '305–320 (2018). DOI: 10.1021/acs.jced.7b00706. Таблица 4 (kij PR); ' +
    'авторская рукопись: mb.uni-paderborn.de/fileadmin-mb/tdy/Publikationen/' +
    'Veroeffentlichungen/quinaer.pdf',
  license:
    '© American Chemical Society (статья); авторская рукопись доступна ' +
    'публично на mb.uni-paderborn.de; значения цитируются с атрибуцией'
};

/**
 * Provenance значения kij из Okoro 2024: значение опубликовано
 * (reported), но подогнано авторами к литературным VLE-данным —
 * независимого подтверждения проектом не выполнялось, поэтому полный
 * статус VERIFIED НЕ присваивается (PARTIALLY_VERIFIED).
 */
function okoroKijProvenance(
  pairLabel: string,
  temperatureRangeNote: string
): EosParameterProvenance {
  return {
    origin: 'reported',
    evidence: 'PARTIALLY_VERIFIED',
    sourceName: OKORO_2024.sourceName,
    sourceId: OKORO_2024.sourceId,
    datasetId: OKORO_2024.datasetId,
    datasetVersion: OKORO_2024.datasetVersion,
    recordId: 'Таблица 1, Original BIP: ' + pairLabel,
    reference: OKORO_2024.reference,
    retrievedAt: BINARY_INTERACTIONS_RETRIEVED_AT,
    method:
      'значение опубликовано источником как есть (reported): подогнано авторами ' +
      'к литературным VLE-данным (рис. 1–4) для CO2-rich смесей в рамках PR-EoS ' +
      'с классическими правилами смешения; проектом не пересчитывалось, не ' +
      'подгонялось и независимо не подтверждалось',
    applicability: temperatureRangeNote,
    limitations:
      'константное значение, подогнанное к данным ограниченного диапазона; ' +
      'температурно-зависимая «adjusted» версия той же таблицы НЕ используется ' +
      '(другая параметризация, не подтверждение константы); симметрия kij = kji ' +
      'предполагается классическими правилами смешения источника',
    license: OKORO_2024.license,
    note:
      'контекст подгонки источника: собственные измерения CO2-rich смесей ' +
      '(95–99.5% CO2) при 228.15–273.15 K, давление до ~30 МПа; верифицированная ' +
      'применимость консервативно ограничена этим диапазоном температур'
  };
}

/**
 * Provenance значения kij из Köster 2018 (Таблица 4): наименьшие
 * квадраты по экспериментальным VLE/vapor pressure данным авторов
 * источников; температурно-независимое значение в рассмотренном
 * диапазоне.
 */
function koesterKijProvenance(
  pairLabel: string,
  applicabilityNote: string
): EosParameterProvenance {
  return {
    origin: 'reported',
    evidence: 'PARTIALLY_VERIFIED',
    sourceName: KOSTER_2018.sourceName,
    sourceId: KOSTER_2018.sourceId,
    datasetId: KOSTER_2018.datasetId,
    datasetVersion: KOSTER_2018.datasetVersion,
    recordId: 'Таблица 4, kij PR: ' + pairLabel,
    reference: KOSTER_2018.reference,
    retrievedAt: BINARY_INTERACTIONS_RETRIEVED_AT,
    method:
      'значение опубликовано источником как есть (reported): подобрано методом ' +
      'наименьших квадратов к экспериментальным VLE/vapor pressure данным; в ' +
      'рассмотренном авторами диапазоне температурно-независимо; проектом не ' +
      'пересчитывалось, не подгонялось и независимо не подтверждалось',
    applicability: applicabilityNote,
    limitations:
      'константное значение, подогнанное к экспериментальным данным ' +
      'ограниченного диапазона; точные границы температурного диапазона ' +
      'подгонки в этой ревизии НЕ верифицированы, числовое ограничение ' +
      'применимости НЕ назначается; симметрия kij = kji предполагается ' +
      'классическими правилами смешения',
    license: KOSTER_2018.license,
    note:
      'значение применимо в рамках данных источника; применимость вне ' +
      'диапазона подгонки не заявляется (fail-closed при отсутствии ' +
      'верифицированных границ — по применимости см. applicability)'
  };
}

// ============================================
// 4. ДАННЫЕ КАТАЛОГА (10 пар пяти компонентов)
// ============================================

/**
 * Каталог бинарных параметров взаимодействия: РОВНО все 10 пар
 * компонентов {co2, n2, ch4, h2o, ar}; ключ — канонический
 * (лексикографически отсортированная пара через '|'). Пары без
 * верифицированного значения присутствуют ЯВНО со статусом
 * unresolved и основанием аудита.
 */
export const BINARY_INTERACTION_PARAMETERS: Readonly<
  Record<string, BinaryInteractionPairRecord>
> = {
  'ar|ch4': {
    status: 'unresolved',
    componentA: 'ar',
    componentB: 'ch4',
    reason:
      'значение kij классического PR с подтверждённым происхождением для пары ' +
      'Ar–CH4 в источниках этой ревизии не найдено',
    auditNote:
      'рассмотрены Okoro et al. 2024 (только CO2-содержащие пары) и Köster, ' +
      'Thol & Vrabec 2018 (Ar–CH4 в Таблице 4 отсутствует); встроенные дефолты ' +
      'CoolProp за подтверждённые данные не выдаются и не импортируются'
  },
  'ar|co2': {
    status: 'available',
    componentA: 'ar',
    componentB: 'co2',
    kij: {
      value: 0.129219,
      unit: '1',
      provenance: okoroKijProvenance(
        'CO2–Ar',
        'верифицированный диапазон применимости: 228.15–273.15 K ' +
          '(собственные измерения источника, CO2-rich смеси); более широкая ' +
          'применимость подгонки к литературным данным не верифицирована'
      )
    },
    symmetric: true,
    applicabilityRangeK: {
      minTemperatureK: 228.15,
      maxTemperatureK: 273.15,
      basis:
        'собственные измерения Okoro et al. 2024: CO2-rich смеси (95–99.5% CO2), ' +
        '228.15–273.15 K, давление до ~30 МПа; консервативное ограничение ' +
        'верифицированного диапазона'
    },
    crossChecks: [],
    limitations: [
      'значение подогнано авторами источника к литературным VLE-данным в ' +
      'рамках CO2-rich смесей; применимость к произвольным составам Ar–CO2 ' +
      'отдельно не верифицирована'
    ]
  },
  'ar|h2o': {
    status: 'unresolved',
    componentA: 'ar',
    componentB: 'h2o',
    reason:
      'PR-kij для пары Ar–H2O не опубликован: в Köster, Thol & Vrabec 2018 ' +
      '(Таблица 4) для H2O–Ar значение PR/PC-SAFT отсутствует («-»)',
    auditNote:
      'в источнике приведён только combining-параметр xi = 1.05 молекулярной ' +
      'модели группы, который PR-kij НЕ является и НЕ подставляется; других ' +
      'источников с подтверждённым происхождением в этой ревизии не найдено'
  },
  'ar|n2': {
    status: 'available',
    componentA: 'ar',
    componentB: 'n2',
    kij: {
      value: -0.0037,
      unit: '1',
      provenance: koesterKijProvenance(
        'N2–Ar',
        'температурно-независимое значение в диапазоне экспериментальных ' +
          'данных источника (криогенные VLE N2–Ar); точные границы диапазона ' +
          'подгонки в этой ревизии не верифицированы — числовое ограничение ' +
          'применимости НЕ назначается (не выдумывается)'
      )
    },
    symmetric: true,
    applicabilityRangeK: null,
    crossChecks: [],
    limitations: [
      'значение применимо в рамках экспериментальных данных источника; ' +
      'применимость вне диапазона подгонки (в т.ч. к комнатным и высоким ' +
      'температурам) не верифицирована и не заявляется'
    ]
  },
  'ch4|co2': {
    status: 'available',
    componentA: 'ch4',
    componentB: 'co2',
    kij: {
      value: 0.09897,
      unit: '1',
      provenance: okoroKijProvenance(
        'CO2–CH4',
        'верифицированный диапазон применимости: 228.15–273.15 K ' +
          '(собственные измерения источника, CO2-rich смеси); более широкая ' +
          'применимость подгонки к литературным данным не верифицирована'
      )
    },
    symmetric: true,
    applicabilityRangeK: {
      minTemperatureK: 228.15,
      maxTemperatureK: 273.15,
      basis:
        'собственные измерения Okoro et al. 2024: CO2-rich смеси (95–99.5% CO2), ' +
        '228.15–273.15 K, давление до ~30 МПа; консервативное ограничение ' +
        'верифицированного диапазона'
    },
    crossChecks: [],
    limitations: [
      'значение подогнано авторами источника к литературным VLE-данным в ' +
      'рамках CO2-rich смесей; применимость к CH4-rich составам отдельно не ' +
      'верифицирована'
    ]
  },
  'ch4|h2o': {
    status: 'unresolved',
    componentA: 'ch4',
    componentB: 'h2o',
    reason:
      'значение kij классического PR с подтверждённым происхождением для пары ' +
      'CH4–H2O в источниках этой ревизии не найдено',
    auditNote:
      'классический PR для водных смесей ограниченно применим (аудит ' +
      'Stage 4.4.4.0); подгонка значения ради вычисления запрещена'
  },
  'ch4|n2': {
    status: 'unresolved',
    componentA: 'ch4',
    componentB: 'n2',
    reason:
      'значение kij классического PR с подтверждённым происхождением для пары ' +
      'CH4–N2 в источниках этой ревизии не найдено',
    auditNote:
      'пара широко изучена в литературе о природном газе, но верифицированное ' +
      'числовое значение PR-kij с идентифицированной публикацией в этой ревизии ' +
      'не извлечено; встроенные дефолты CoolProp не импортируются'
  },
  'co2|h2o': {
    status: 'unresolved',
    componentA: 'co2',
    componentB: 'h2o',
    reason:
      'для CO2–H2O классический PR с константным kij недостаточен (аудит ' +
      'Stage 4.4.4.0: требуются специализированные подходы); верифицированного ' +
      'константного значения в источниках этой ревизии не найдено',
    auditNote:
      'включение H2O в каталог чистых параметров 4.4.4.1 не означает поддержки ' +
      'смесей H2O–газ; поддержка водных смесей в Stage 4.4.4 НЕ заявляется'
  },
  'co2|n2': {
    status: 'available',
    componentA: 'co2',
    componentB: 'n2',
    kij: {
      value: -0.017,
      unit: '1',
      provenance: okoroKijProvenance(
        'CO2–N2',
        'верифицированный диапазон применимости: 228.15–273.15 K ' +
          '(собственные измерения источника, CO2-rich смеси); более широкая ' +
          'применимость подгонки к литературным данным не верифицирована'
      )
    },
    symmetric: true,
    applicabilityRangeK: {
      minTemperatureK: 228.15,
      maxTemperatureK: 273.15,
      basis:
        'собственные измерения Okoro et al. 2024: CO2-rich смеси (95–99.5% CO2), ' +
        '228.15–273.15 K, давление до ~30 МПа; консервативное ограничение ' +
        'верифицированного диапазона'
    },
    crossChecks: [],
    limitations: [
      'отрицательное значение kij корректно встречается в подгонках PR; ' +
      'значение подогнано к литературным VLE-данным CO2-rich смесей'
    ]
  },
  'h2o|n2': {
    status: 'available',
    componentA: 'h2o',
    componentB: 'n2',
    kij: {
      value: -0.0501,
      unit: '1',
      provenance: koesterKijProvenance(
        'N2–H2O',
        'температурно-независимое значение в диапазоне экспериментальных ' +
          'данных источника (растворимость/Henry-область N2–H2O); точные ' +
          'границы диапазона подгонки в этой ревизии не верифицированы — ' +
          'числовое ограничение применимости НЕ назначается (не выдумывается)'
      )
    },
    symmetric: true,
    applicabilityRangeK: null,
    crossChecks: [],
    limitations: [
      'вода — полярный ассоциированный компонент: классический PR без ' +
      'специальных модификаций ограниченно применим к водным смесям; ' +
      'результаты по этой паре — в рамках классической PR-модели и НЕ ' +
      'являются точным описанием водной смеси'
    ]
  }
};

// ============================================
// 4a. RUNTIME-ИММУТАБИЛЬНОСТЬ
// ============================================

/**
 * Глубокая runtime-заморозка (паттерн Stage 4.4.4.2): рекурсивный
 * Object.freeze по всем вложенным объектам и массивам. Канонические
 * значения нельзя изменить через lookup.
 */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      if (typeof child === 'object' && child !== null) {
        deepFreeze(child);
      }
    }
  }
  return Object.freeze(value);
}

deepFreeze(BINARY_INTERACTION_PARAMETERS);
deepFreeze(BINARY_PAIR_STATUSES);

/** Все канонические ключи каталога (детерминированный порядок). */
export const BINARY_INTERACTION_PAIR_KEYS: readonly string[] = Object.keys(
  BINARY_INTERACTION_PARAMETERS
).sort();

deepFreeze(BINARY_INTERACTION_PAIR_KEYS);

// ============================================
// 5. RUNTIME-ВАЛИДАЦИЯ
// ============================================

/** Безопасная проверка «это объект» (данные могут приходить из JSON). */
function isNonNullObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function nonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim() !== '';
}

/** Источник идентифицирован (минимум один непустой идентификатор). */
function hasSourceIdentification(p: EosParameterProvenance): boolean {
  return (
    nonEmptyString(p.sourceName) ||
    nonEmptyString(p.sourceId) ||
    nonEmptyString(p.datasetId) ||
    nonEmptyString(p.reference)
  );
}

/** Ссылка указывает на upstream однозначно (DOI/URL или datasetId). */
function hasUpstreamPointer(p: EosParameterProvenance): boolean {
  const reference = typeof p.reference === 'string' ? p.reference : '';
  const datasetId = typeof p.datasetId === 'string' ? p.datasetId : '';
  return (
    /\b10\.\d{4,9}\//.test(reference) ||
    /https?:\/\//.test(reference) ||
    datasetId.trim() !== ''
  );
}

/**
 * Валидация provenance значения kij (правила каталога 4.4.4.1:
 * собственный полный provenance обязателен; origin и evidence — из
 * реестров; источник идентифицирован и указывает на upstream).
 */
function kijProvenanceIssues(path: string, provenance: unknown): string[] {
  const errors: string[] = [];
  if (!isNonNullObject(provenance)) {
    errors.push(`${path}: provenance должен быть объектом`);
    return errors;
  }
  const rec = provenance as Partial<EosParameterProvenance>;
  if (!nonEmptyString(rec.origin)) {
    errors.push(`${path}: origin обязателен (reported | derived | software_dataset)`);
  } else if (!(EOS_VALUE_ORIGINS as readonly string[]).includes(rec.origin)) {
    errors.push(`${path}: неизвестный origin «${rec.origin}»`);
  }
  if (!nonEmptyString(rec.evidence)) {
    errors.push(`${path}: evidence обязателен (статус доказательства значения)`);
  } else if (!(EOS_EVIDENCE_STATUSES as readonly string[]).includes(rec.evidence)) {
    errors.push(`${path}: неизвестный статус доказательства «${rec.evidence}»`);
  }
  if (!hasSourceIdentification(rec as EosParameterProvenance)) {
    errors.push(`${path}: provenance не идентифицирует источник`);
  }
  if (!hasUpstreamPointer(rec as EosParameterProvenance)) {
    errors.push(`${path}: provenance не указывает upstream однозначно (DOI или URL в reference, либо datasetId)`);
  }
  if (!nonEmptyString(rec.reference)) {
    errors.push(`${path}: обязательна библиографическая идентификация (reference)`);
  }
  if (!nonEmptyString(rec.datasetVersion)) {
    errors.push(`${path}: обязательна версия источника данных (datasetVersion)`);
  }
  if (!nonEmptyString(rec.retrievedAt)) {
    errors.push(`${path}: обязательна дата обращения к источнику (retrievedAt)`);
  }
  if (!nonEmptyString(rec.applicability)) {
    errors.push(`${path}: обязательна применимость значения (applicability)`);
  }
  if (!nonEmptyString(rec.limitations) && !nonEmptyString(rec.note)) {
    errors.push(`${path}: обязательны ограничения и/или комментарии (limitations или note)`);
  }
  if (!nonEmptyString(rec.license)) {
    errors.push(`${path}: обязательна лицензия источника (license)`);
  }
  return errors;
}

/** Валидация диапазона применимости (если он назначен). */
function applicabilityIssues(path: string, range: unknown): string[] {
  const errors: string[] = [];
  if (!isNonNullObject(range)) {
    errors.push(`${path}: диапазон применимости должен быть объектом {minTemperatureK, maxTemperatureK, basis}`);
    return errors;
  }
  const rec = range as Record<string, unknown>;
  if (
    typeof rec.minTemperatureK !== 'number' ||
    !Number.isFinite(rec.minTemperatureK) ||
    rec.minTemperatureK <= 0
  ) {
    errors.push(`${path}: minTemperatureK должно быть конечным положительным числом`);
  }
  if (
    typeof rec.maxTemperatureK !== 'number' ||
    !Number.isFinite(rec.maxTemperatureK) ||
    rec.maxTemperatureK <= 0
  ) {
    errors.push(`${path}: maxTemperatureK должно быть конечным положительным числом`);
  }
  if (
    typeof rec.minTemperatureK === 'number' &&
    typeof rec.maxTemperatureK === 'number' &&
    Number.isFinite(rec.minTemperatureK) &&
    Number.isFinite(rec.maxTemperatureK) &&
    rec.minTemperatureK >= rec.maxTemperatureK
  ) {
    errors.push(`${path}: minTemperatureK должно быть строго меньше maxTemperatureK`);
  }
  if (!nonEmptyString(rec.basis)) {
    errors.push(`${path}: basis обязателен (основание ограничения применимости)`);
  }
  return errors;
}

/**
 * Структурная валидация записи пары. Проверяет форму и provenance;
 * научную корректность значения проверяет сверка с независимыми
 * источниками (crossChecks), а не эта функция.
 */
export function validateBinaryInteractionPairRecord(record: unknown): string[] {
  const errors: string[] = [];
  if (!isNonNullObject(record)) {
    return ['запись должна быть объектом'];
  }
  const rec = record as Record<string, unknown>;
  if (rec.status !== 'available' && rec.status !== 'unresolved') {
    return [`status должен быть 'available' или 'unresolved', получено: ${String(rec.status)}`];
  }
  if (!nonEmptyString(rec.componentA) || !nonEmptyString(rec.componentB)) {
    errors.push('componentA и componentB обязательны (непустые строки)');
    return errors;
  }
  const knownIds = EOS_PURE_COMPONENT_IDS as readonly string[];
  const a = rec.componentA as string;
  const b = rec.componentB as string;
  if (!knownIds.includes(a) || !knownIds.includes(b)) {
    errors.push(
      `пара «${a}|${b}» содержит компонент вне каталога 4.4.4.1 ` +
        `(допустимы: ${knownIds.join(', ')})`
    );
  }
  if (a === b) {
    errors.push(`пара «${a}|${b}»: компоненты должны быть РАЗНЫМИ (самопара недопустима)`);
  }
  if (a !== b && a > b) {
    errors.push(
      `пара хранится не в каноническом порядке: componentA «${a}» должен быть ` +
        `лексикографически меньше componentB «${b}»`
    );
  }
  if (rec.status === 'available') {
    if (!isNonNullObject(rec.kij)) {
      errors.push('available: kij должен быть объектом {value, unit, provenance}');
    } else {
      const kij = rec.kij as Record<string, unknown>;
      if (typeof kij.value !== 'number' || !Number.isFinite(kij.value)) {
        errors.push(`kij.value должно быть конечным числом (знак любой), получено: ${String(kij.value)}`);
      }
      if (kij.unit !== '1') {
        errors.push(`kij.unit должна быть «1» (контракт поля), получено: «${String(kij.unit)}»`);
      }
      errors.push(...kijProvenanceIssues('kij: provenance', kij.provenance));
    }
    if (rec.symmetric !== true) {
      errors.push('available: symmetric должен быть true (классические правила смешения: kij = kji)');
    }
    if (rec.applicabilityRangeK !== null && rec.applicabilityRangeK !== undefined) {
      errors.push(...applicabilityIssues('applicabilityRangeK', rec.applicabilityRangeK));
    }
    if (!Array.isArray(rec.crossChecks)) {
      errors.push('available: crossChecks должны быть массивом');
    } else {
      rec.crossChecks.forEach((cc: unknown, i: number) => {
        if (!isNonNullObject(cc)) {
          errors.push(`crossChecks[${i}] должен быть объектом`);
          return;
        }
        const c = cc as Record<string, unknown>;
        for (const field of ['subject', 'catalogValue', 'crossSource', 'crossValue', 'resolution'] as const) {
          if (!nonEmptyString(c[field])) {
            errors.push(`crossChecks[${i}].${field} обязателен (непустая строка)`);
          }
        }
        if (
          typeof c.outcome !== 'string' ||
          !(EOS_CROSS_CHECK_OUTCOMES as readonly string[]).includes(c.outcome)
        ) {
          errors.push(
            `crossChecks[${i}].outcome должен быть одним из: ${EOS_CROSS_CHECK_OUTCOMES.join(', ')}`
          );
        }
      });
    }
    if (!Array.isArray(rec.limitations)) {
      errors.push('available: limitations должны быть массивом');
    } else {
      rec.limitations.forEach((l: unknown, i: number) => {
        if (!nonEmptyString(l)) {
          errors.push(`limitations[${i}] должна быть непустой строкой`);
        }
      });
    }
  } else {
    if (!nonEmptyString(rec.reason)) {
      errors.push('unresolved: reason обязателен (основание статуса unknown)');
    }
    if (!nonEmptyString(rec.auditNote)) {
      errors.push('unresolved: auditNote обязателен (итог аудита источников)');
    }
  }
  return errors;
}

/**
 * Валидация каталога пар целиком: ровно все 10 канонических пар пяти
 * компонентов, ключи канонические, записи валидны, дублей нет.
 */
export function validateBinaryInteractionCatalog(catalog: unknown): string[] {
  const errors: string[] = [];
  if (!isNonNullObject(catalog)) {
    return ['каталог должен быть объектом'];
  }
  const expected = new Set<string>();
  const ids = EOS_PURE_COMPONENT_IDS;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      expected.add(canonicalBinaryPairKey(ids[i], ids[j]));
    }
  }
  const keys = Object.keys(catalog);
  for (const key of keys) {
    const record = (catalog as Record<string, unknown>)[key];
    const issues = validateBinaryInteractionPairRecord(record);
    errors.push(...issues.map((e) => `${key}: ${e}`));
    if (isNonNullObject(record)) {
      const rec = record as Record<string, unknown>;
      if (typeof rec.componentA === 'string' && typeof rec.componentB === 'string') {
        const actualKey = canonicalBinaryPairKey(rec.componentA, rec.componentB);
        if (actualKey !== key) {
          errors.push(
            `${key}: ключ записи не совпадает с каноническим ключом пары «${actualKey}»`
          );
        }
      }
    }
  }
  for (const key of expected) {
    if (!keys.includes(key)) {
      errors.push(`в каталоге отсутствует обязательная пара: ${key}`);
    }
  }
  for (const key of keys) {
    if (!expected.has(key)) {
      errors.push(`в каталоге посторонняя пара «${key}» (контракт 4.4.4.3: только пары пяти компонентов)`);
    }
  }
  return errors;
}

// ============================================
// 6. СТРУКТУРИРОВАННАЯ ОШИБКА И FAIL-CLOSED LOOKUP
// ============================================

/** Коды ошибок каталога бинарных параметров. */
export type BinaryInteractionErrorCode =
  | 'unknown_gas' // компонент вне каталога пяти компонентов
  | 'same_component_pair' // пара i-i (самопара)
  | 'invalid_catalog_record' // запись не прошла валидацию
  | 'unresolved_binary_interaction'; // значение unknown/unresolved — отказ

/** Структурированная ошибка каталога kij. */
export class BinaryInteractionError extends Error {
  readonly code: BinaryInteractionErrorCode;
  readonly component = 'BinaryInteractionParameters';
  readonly pairKey: string;
  readonly issues: readonly string[];

  constructor(
    code: BinaryInteractionErrorCode,
    message: string,
    pairKey: string,
    issues: readonly string[] = []
  ) {
    super(`[BinaryInteractionParameters] ${message}`);
    this.name = 'BinaryInteractionError';
    this.code = code;
    this.pairKey = pairKey;
    this.issues = issues;
  }
}

/**
 * Fail-closed lookup бинарного параметра взаимодействия пары.
 * Возвращает ТОЛЬКО полностью валидную available-запись. Отказы:
 * - unknown_gas — компонент вне каталога 4.4.4.1 (включая h2);
 * - same_component_pair — пара из одного компонента;
 * - unresolved_binary_interaction — значение пары unknown/unresolved
 *   (ЯВНЫЙ отказ, НЕ kij = 0: см. BINARY_NO_ZERO_DEFAULT_NOTE);
 * - invalid_catalog_record — запись не прошла валидацию.
 * Симметрия: lookup(a, b) и lookup(b, a) возвращают одну и ту же
 * запись (канонический ключ).
 */
export function getBinaryInteractionParameter(
  componentA: string,
  componentB: string
): BinaryInteractionAvailableRecord {
  if (typeof componentA !== 'string' || componentA.trim() === '') {
    throw new BinaryInteractionError(
      'unknown_gas',
      `пустой идентификатор первого компонента пары, получено: ${String(componentA)}`,
      String(componentA)
    );
  }
  if (typeof componentB !== 'string' || componentB.trim() === '') {
    throw new BinaryInteractionError(
      'unknown_gas',
      `пустой идентификатор второго компонента пары, получено: ${String(componentB)}`,
      String(componentB)
    );
  }
  const knownIds = EOS_PURE_COMPONENT_IDS as readonly string[];
  if (componentA === componentB) {
    throw new BinaryInteractionError(
      'same_component_pair',
      `пара «${componentA}|${componentB}» состоит из одного компонента: kij определяется только для РАЗНЫХ компонентов`,
      canonicalBinaryPairKey(componentA, componentB)
    );
  }
  if (!knownIds.includes(componentA) || !knownIds.includes(componentB)) {
    throw new BinaryInteractionError(
      'unknown_gas',
      `пара «${componentA}|${componentB}» содержит компонент вне каталога ` +
        `параметров Peng–Robinson (Stage 4.4.4.1: ${knownIds.join(', ')}; h2 исключён)`,
      canonicalBinaryPairKey(componentA, componentB)
    );
  }
  const key = canonicalBinaryPairKey(componentA, componentB);
  const record = (BINARY_INTERACTION_PARAMETERS as Record<string, BinaryInteractionPairRecord | undefined>)[key];
  if (record === undefined) {
    throw new BinaryInteractionError(
      'invalid_catalog_record',
      `в каталоге отсутствует пара «${key}» (контракт 4.4.4.3: все пары пяти компонентов присутствуют явно)`,
      key
    );
  }
  const issues = validateBinaryInteractionPairRecord(record);
  if (issues.length > 0) {
    throw new BinaryInteractionError(
      'invalid_catalog_record',
      `запись пары «${key}» не прошла валидацию; значение kij НЕ выдаётся`,
      key,
      issues
    );
  }
  if (record.status === 'unresolved') {
    throw new BinaryInteractionError(
      'unresolved_binary_interaction',
      `бинарный параметр взаимодействия для пары «${key}» — ` +
        `unknown/unresolved: ${record.reason}. ${BINARY_NO_ZERO_DEFAULT_NOTE}`,
      key
    );
  }
  return record;
}

/** Список канонических ключей каталога (детерминированный порядок). */
export function listBinaryInteractionPairKeys(): readonly string[] {
  return BINARY_INTERACTION_PAIR_KEYS;
}

/**
 * Итог аудита для отчётности и тестов: покрытие каталога парами с
 * верифицированным значением и парами с явным отказом.
 */
export interface BinaryInteractionCoverage {
  readonly totalPairs: number;
  readonly availablePairKeys: readonly string[];
  readonly unresolvedPairKeys: readonly string[];
}

/** Покрытие каталога (какие пары вычислимы, какие — отказ). */
export function getBinaryInteractionCoverage(): BinaryInteractionCoverage {
  const availablePairKeys: string[] = [];
  const unresolvedPairKeys: string[] = [];
  for (const key of BINARY_INTERACTION_PAIR_KEYS) {
    const record = BINARY_INTERACTION_PARAMETERS[key];
    if (record.status === 'available') {
      availablePairKeys.push(key);
    } else {
      unresolvedPairKeys.push(key);
    }
  }
  return {
    totalPairs: BINARY_INTERACTION_PAIR_KEYS.length,
    availablePairKeys,
    unresolvedPairKeys
  };
}

// ============================================
// 7. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Этот модуль — ТОЛЬКО каталог данных с per-pair provenance.
// Математика смешения (a_ij, a_mix, b_mix, кубика смеси, ln(phi_i))
// — Core/pengRobinsonMixture.ts (Stage 4.4.4.3); фасад над обоими
// каталогами — Data/pengRobinsonMixtureFacade.ts. Flash, VLE/LLE,
// фазовая устойчивость, PPR78, ternary-параметры и интеграция с
// solveEquilibrium НЕ реализуются (вне объёма Stage 4.4.4.3).
