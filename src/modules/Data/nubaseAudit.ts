// ============================================
// NUBASE2020 AUDIT UTILITY - воспроизводимый аудит ранжирования
// изотопов-кандидатов (Stage 4.3.3, аудит R4)
// ============================================
//
// Корректирующая ревизия R4.
//
// Часть C1 (политика неопределённостей): отсутствие опубликованной
// числовой σ — это отсутствие информации о неопределённости. Оно
// НЕ разрешает считать номинальное значение точной точкой и
// доказывать по нему полноту ранжирования. Точечное правило аудита
// R3 (исключение «~v» и измеренных значений без σ, чья точка ниже
// нижней границы 1σ-интервала якоря) УДАЛЕНО как не подтверждённое
// опубликованной методикой NUBASE2020 (Kondev et al., NUBASE2020,
// §3.2, DOI 10.1088/1674-1137/abddae): публикация описывает одну
// стандартную сигму, оценку неопределённости самими оценщиками и
// отдельную обработку опубликованных диапазонов — она не даёт
// права считать значение без σ точной точкой.
//
// Часть C3 (строгий парсер): парсер фиксированных колонок шапки
// файла СТРОГО валидирует каждую строку данных и fail-closed:
// обрезанные и повреждённые записи НЕ теряются молча, а попадают в
// диагностику с номером строки и причиной (NubaseParseDiagnostic);
// дубликаты по (Z, A, i, s) диагностируются и не участвуют в
// подсчёте изомерных состояний; пустое поле массы больше НЕ
// трактуется как экспериментально измеренная масса (наблюдаемость
// вычисляется только по валидным опубликованным данным: масса без
// «#», энергия возбуждения без «#», собственный T1/2); признак
// Isom.Inv («&») сохраняется отдельно (orderingInverted) и в
// ранжировании НЕ используется.
//
// Часть C4 (происхождение входа): библиография NUBASE2020 отделена
// от метаданных конкретного запуска (NubaseAuditRunMetadata).
// auditNubaseText вычисляет SHA-256 ФАКТИЧЕСКОГО входного текста
// (computeNubaseAuditTextSha256) и сверяет его с SHA-256 локально
// проверенной копии официального файла; синтетические фрагменты
// получают sourceVerification 'unverified' и НЕ имитируют проверку
// полного официального файла. Константа хеша — это хеш именно
// локально проверенной копии, а НЕ официальный контрольный хеш
// распределения (AMDC его не публикует).
//
// Назначение: сделать результат аудита ранжирования 14 элементов
// (Data/elementIsotopeCandidates.ts) ПОВТОРЯЕМЫМ. Утилита разбирает
// официальный ASCII-файл NUBASE2020 по фиксированным колонкам его
// шапки, группирует строки по (Z, A), классифицирует состояния
// контекстным правилом classifyNubaseState (Core/elements.ts, аудит
// R3) и выполняет ранжирование по правилам, зафиксированным в
// elementIsotopeCandidates.ts:
//   1) наблюдавшиеся строки: валидная масса без «#», ЛИБО валидная
//      энергия возбуждения без «#» (и не non-exist), ЛИБО собственный
//      T1/2 (значение, предел или приближение без «#»); строки, у
//      которых все эти величины оценены или отсутствуют, —
//      систематические экстраполяции;
//   2) кандидатами могут быть ТОЛЬКО строки, классифицированные как
//      ground или isomer; уровни, резонансы, IAS (s=i,j; i=8,9) и
//      неопределимые строки кандидатами не являются;
//   3) якорь — самый долгоживущий измеренный нуклид-кандидат;
//   4) кандидат — строка, чей 1σ-интервал пересекается с 1σ-
//      интервалом якоря; нижний предел «>x» не ограничен сверху и
//      исключению не подлежит (полнота не доказуема —
//      not_verifiable); верхний предел «<x» исключается, только
//      если x ниже нижней границы интервала якоря (исключение
//      обосновано ОПУБЛИКОВАННОЙ границей, а не точечным
//      предположением); приближение «~v», измеренное значение без
//      опубликованной σ и оценённое систематикой «v#» НЕ получают
//      искусственной неопределённости и НЕ исключаются точечным
//      правилом (аудит R4): номинальное значение без σ не
//      доказывает, что истинный T1/2 строки ниже нижней границы
//      интервала якоря — полнота НЕ ДОКАЗУЕМА (not_verifiable с
//      причинами unresolved_approx / unresolved_no_sigma /
//      unresolved_estimated); наблюдавшееся ground/isomer-состояние
//      без собственного T1/2 также не доказывает неконкурентность
//      (причина no_half_life_unresolved); отсутствие σ не
//      заменяется нулевой или выдуманной неопределённостью;
//   5) при перекрытии опубликованных 1σ-интервалов все
//      пересекающиеся кандидаты остаются РАВНОПРАВНЫМИ.
//
// ПОЛНЫЙ ASCII-файл NUBASE2020 НЕ включается в репозиторий: отдельная
// лицензия файла AMDC не подтверждена и не утверждается. Утилита —
// чистые детерминированные функции БЕЗ файлового и сетевого
// доступа: полный прогон выполняется на локально предоставленной
// копии официального файла (SHA-256 проверенной копии зафиксирован
// в NUBASE2020_VERIFIED_SOURCE_SHA256 и сверяется с фактическим
// входом при каждом запуске auditNubaseText).
//
// Ограничения (не замалчиваются):
// - утилита воспроизводит ранжирование 14 ранжируемых элементов
//   (NUBASE_AUDIT_RANKED_ELEMENTS); статусы incomplete (Z=99-118) —
//   решение каталога об области активных исследований, а не вывод
//   из файла: утилита вычисляет только complete / not_verifiable /
//   no_anchor;
// - колонки правее dT (Jpi, Ensdf, Year, Discovery, BR) парсером НЕ
//   валидируются: ранжирование их не использует, шапка файла не
//   задаёт их формата достаточно строго; содержание строки
//   сохраняется дословно (sourceLine);
// - построчная сверка с ENSDF не выполнялась: первичный источник
//   методики — сам файл NUBASE2020.

import { classifyNubaseState } from '../Core/elements';
import type { NubaseStateRowRef } from '../Core/elements';

// ============================================
// 1. БИБЛИОГРАФИЯ ИСТОЧНИКА И ВЕРСИИ МЕТОДИКИ
// ============================================

/**
 * Библиографическая информация об официальном источнике NUBASE2020.
 * Отдельна от метаданных конкретного запуска аудита
 * (NubaseAuditRunMetadata): библиография описывает публикацию,
 * а не то, какой файл подавался на вход в данном запуске.
 */
export interface NubaseBibliography {
  /** Цитирование официальной публикации NUBASE2020. */
  citation: string;
  /** DOI публикации. */
  doi: string;
  /** Официальная страница AMDC (файл получается с неё). */
  amdcPageUrl: string;
  /** Версия проверенного источника данных. */
  sourceVersion: string;
  /** Способ получения файла. */
  retrievalMethod: string;
  /** Ограничения методики. */
  limitations: readonly string[];
}

export const NUBASE2020_BIBLIOGRAPHY: NubaseBibliography = {
  citation:
    'F.G. Kondev, M. Wang, W.J. Huang, S. Naimi, G. Audi. The NUBASE2020 evaluation of nuclear physics properties. Chinese Physics C 45 (2021) 030001.',
  doi: '10.1088/1674-1137/abddae',
  amdcPageUrl: 'https://amdc.impcas.ac.cn/web/nubase_en.html',
  sourceVersion: 'NUBASE2020 (Chin. Phys. C 45, 030001, 2021), официальный ASCII-файл NUBASE2020',
  retrievalMethod:
    'официальная страница AMDC (nubase_en.html): ASCII-файл NUBASE2020 скачан локально и использован как первичный источник аудита',
  limitations: [
    'полный ASCII-файл NUBASE2020 не включается в репозиторий: отдельная лицензия файла AMDC не подтверждена; полный прогон утилиты требует локальной копии официального файла',
    'статусы incomplete (Z=99-118) назначены каталогом (область активных исследований) и утилитой не вычисляются',
    'построчная сверка с ENSDF не выполнялась'
  ]
};

/**
 * SHA-256 локально проверенной копии официального ASCII-файла
 * NUBASE2020 (761 906 байт, ASCII, 5 869 строк при разбиении по «\n»),
 * использованной при аудите. auditNubaseText вычисляет SHA-256
 * фактического входного текста и сверяет его с этим значением:
 * совпадение означает, что вход побайтово равен проверенной копии.
 * AMDC не публикует официальный контрольный хеш распределения —
 * значение НЕ заявляется как официальный хеш и не является хешем
 * какой-либо зеркальной копии.
 */
export const NUBASE2020_VERIFIED_SOURCE_SHA256 = '1585a5eea86c5e17e90307c7e6e786d060049c4039e392a261ff6db977df9859';

/** Размер в байтах локально проверенной копии официального файла. */
export const NUBASE2020_VERIFIED_SOURCE_BYTES = 761906;

/** Дата получения локально проверенной копии официального файла. */
export const NUBASE2020_SOURCE_RETRIEVED_AT = '2026-11-01';

/** Версия парсера и методики аудита (аудит R4: строгий парсер и метаданные запуска). */
export const NUBASE_AUDIT_PARSER_VERSION = 'nubase-audit-r4/2.0.0';

/** Атомные номера 14 ранжируемых элементов (без стабильных изотопов, до Z=98). */
export const NUBASE_AUDIT_RANKED_ELEMENTS: readonly number[] = [
  43, 61, 84, 85, 86, 87, 88, 89, 93, 94, 95, 96, 97, 98
];

// ============================================
// 2. ЕДИНИЦЫ ВРЕМЕНИ NUBASE2020
// ============================================

/**
 * Факторы перевода единиц времени NUBASE2020 в секунды. Год —
 * ОФИЦИАЛЬНОЕ определение NUBASE2020 (тропический год:
 * 1 y = 365.2422 сут = 31 556 926 с; y/ky/My — точные целые).
 * Gy…Yy выходят за пределы точного целого диапазона и заданы как
 * числа двойной точности: в ранжировании они встречаются только у
 * оценённых (не наблюдавшихся) записей и на отбор не влияют.
 * Обозначение «us» в файле — микросекунда (µs).
 */
export const NUBASE_AUDIT_UNIT_SECONDS: Readonly<Record<string, number>> = {
  ys: 1e-24,
  zs: 1e-21,
  as: 1e-18,
  fs: 1e-15,
  ps: 1e-12,
  ns: 1e-9,
  us: 1e-6,
  ms: 1e-3,
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  y: 31556926,
  ky: 31556926000,
  My: 31556926000000,
  Gy: 3.1556926e16,
  Ty: 3.1556926e19,
  Py: 3.1556926e22,
  Ey: 3.1556926e25,
  Zy: 3.1556926e28,
  Yy: 3.1556926e31
};

/** Фактор перевода единицы времени NUBASE2020 в секунды; null — единица не поддерживается. */
export function nubaseAuditUnitSeconds(unit: string): number | null {
  const factor = NUBASE_AUDIT_UNIT_SECONDS[unit];
  return typeof factor === 'number' ? factor : null;
}

// ============================================
// 3. СТРОГИЙ ПАРСЕР ФИКСИРОВАННЫХ КОЛОНОК
// ============================================

/**
 * Символы элементов Z=0…118 шапки файла NUBASE2020 (Z=0 — нейтрон
 * «n»). Согласованность обозначения нуклида в колонке «A El» с
 * атомным номером ZZZ проверяется парсером явно.
 */
const NUBASE_ELEMENT_SYMBOLS: readonly string[] =
  ('n H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br ' +
    'Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er ' +
    'Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md ' +
    'No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' ');

/**
 * Согласованность индекса состояния i и буквенного кода s шапки
 * файла: 0↔'', 1↔m, 2↔n, 3↔p, 4↔q, 5↔r, 6↔x, 8↔i, 9↔j. Парсер
 * проверяет пару (i, s) каждой строки и отказывается разбирать
 * рассогласованные комбинации.
 */
const NUBASE_STATE_CODE_BY_INDEX: Readonly<Record<number, string>> = {
  0: '',
  1: 'm',
  2: 'n',
  3: 'p',
  4: 'q',
  5: 'r',
  6: 'x',
  8: 'i',
  9: 'j'
};

/**
 * Минимальная длина строки данных: 5 843 строки официального файла
 * имеют длину от 75 до 217 символов; более короткая запись данных
 * считается обрезанной и попадает в диагностику too_short.
 */
const NUBASE_MIN_DATA_LINE_LENGTH = 75;

/** Строка, похожая на запись данных: необязательные пробелы, затем цифра. */
const NUBASE_DATA_LIKE_PATTERN = /^[ ]*[0-9]/;

/** Поле массы (колонки 19-31): пустое, либо число с опциональным «#» (оценка систематикой). */
const NUBASE_MASS_FIELD_PATTERN = /^[ ]*(|[+-]?[0-9]+([.][0-9]+)?#?)[ ]*$/;
/** Поле неопределённости массы (колонки 32-42): пустое, либо неотрицательное число с опциональным «#». */
const NUBASE_UNCERTAINTY_FIELD_PATTERN = /^[ ]*(|[+]?[0-9]+([.][0-9]+)?#?)[ ]*$/;
/** Поле энергии возбуждения (колонки 43-54): пустое, число с опциональным «#», либо пометка non-exist. */
const NUBASE_EXC_FIELD_PATTERN = /^[ ]*(|[+-]?[0-9]+([.][0-9]+)?#?|non-exist)[ ]*$/;
/** Поле «Origin» (колонки 66-67): пустое, либо 1-2 алфавитных символа. */
const NUBASE_ORIGIN_FIELD_PATTERN = /^[ ]*(|[0-9A-Za-z]{1,2})[ ]*$/;
/** Isom.Unc (колонка 68): пробел либо «*» (порядок gs/изомера не установлен). */
const NUBASE_ISOM_UNC_PATTERN = /^[ *]$/;
/** Isom.Inv (колонка 69): пробел либо «&» (инвертированный порядок перечисления). */
const NUBASE_ISOM_INV_PATTERN = /^[ &]$/;
/** Поле T1/2 (колонки 70-78): пустое, stbl, p-unst, значение/предел/приближение с опциональным «#». */
const NUBASE_HALF_LIFE_FIELD_PATTERN = /^[ ]*(|stbl|p-unst|[<>~]?[0-9]+([.][0-9]+)?#?)[ ]*$/;
/**
 * Поле dT (колонки 82-88): пустое; σ — число с опциональным «#»;
 * предел/приближение в позиции dT при пустом T (аномалия файла,
 * например 85Tc «<110ns», 18B «<26 ns»); метка изоспина «T=…»
 * у IAS-строк без собственного T1/2.
 */
const NUBASE_HALF_LIFE_UNC_FIELD_PATTERN =
  /^[ ]*([<>~][0-9]+([.][0-9]+)?#?[ ]*[a-zA-Z]{0,2}|T=[0-9]+\/[0-9]+|[0-9]+([.][0-9]+)?#?)?[ ]*$/;

/**
 * Вид записи T1/2 строки NUBASE2020:
 * measured — измеренное значение со скобочной σ;
 * approx — приближение «~v» (σ не опубликована);
 * lower_limit — нижний предел «>x» (верхней границы нет);
 * upper_limit — верхний предел «<x»;
 * estimated — оценка систематики «v#» (не наблюдавшееся);
 * stable — stbl; predicted_unstable — p-unst; none — T1/2 нет.
 */
export type NubaseAuditHalfLifeKind =
  | 'measured'
  | 'approx'
  | 'lower_limit'
  | 'upper_limit'
  | 'estimated'
  | 'stable'
  | 'predicted_unstable'
  | 'none';

/** Одна строка официального файла NUBASE2020. */
export interface NubaseAuditRow {
  /** Идентификатор строки источника (Z, A, i, s) — ключ дедупликации. */
  recordId: string;
  /** Номер строки в исходном тексте (1-based). */
  lineNumber: number;
  /** Атомный номер Z. */
  atomicNumber: number;
  /** Массовое число A (целое число нуклонов). */
  massNumber: number;
  /** Индекс состояния i (0 — основное; 1,2 — стандартные изомеры; …). */
  stateIndex: number;
  /** Буквенный код состояния s ('' — пустой). */
  stateCode: string;
  /** Поле «A El» файла (например '92Tc', '205Poq'). */
  notation: string;
  halfLifeKind: NubaseAuditHalfLifeKind;
  /** Нотация T1/2 (для предела в позиции dT — реконструированная). */
  halfLifeRaw: string;
  /** Поле T1/2 дословно (колонки 70-78, включая пробелы). */
  halfLifeFieldRaw: string;
  /** Поле dT дословно (колонки 82-88, включая пробелы). */
  halfLifeUncFieldRaw: string;
  /** Единица времени NUBASE2020. */
  halfLifeUnit: string;
  /** Числовое значение в исходной единице; null — значения нет. */
  halfLifeValue: number | null;
  /** 1 сигма в исходной единице; null — не опубликована. */
  halfLifeSigma: number | null;
  /** Значение в секундах; null — единица не поддерживается или значения нет. */
  halfLifeSeconds: number | null;
  /** Поле массы содержит валидное число без «#» (экспериментальная масса). */
  massValid: boolean;
  /** Масса оценена систематикой («#» в поле Mass). */
  massEstimated: boolean;
  /** Энергия возбуждения присутствует (числовое поле). */
  excitationPresent: boolean;
  /** Энергия возбуждения оценена систематикой («#» в поле Exc). */
  excitationEstimated: boolean;
  /** Строка помечена «non-exist» в поле Exc (состояние не существует как связанное). */
  excitationNonExist: boolean;
  /** Звёздочка NUBASE (Isom.Unc «*»): порядок gs/изомера не установлен. */
  orderingUncertain: boolean;
  /**
   * Признак Isom.Inv «&» (инвертированный порядок перечисления
   * основного и изомерного состояний). Сохраняется отдельно (аудит
   * R4, C3) и в ранжировании НЕ используется: методика не опирается
   * на него; потерянным молча не будет.
   */
  orderingInverted: boolean;
  /** Строка экспериментально наблюдавшаяся (правило 1 методики). */
  observed: boolean;
  /** Исходная строка файла (без перевода строки). */
  sourceLine: string;
}

/** Вид диагностики строгого парсера (аудит R4, C3). */
export type NubaseParseDiagnosticKind =
  | 'too_short'
  | 'malformed_aaa'
  | 'malformed_zzzi'
  | 'malformed_state_index'
  | 'malformed_state_code'
  | 'malformed_notation'
  | 'malformed_mass_field'
  | 'malformed_exc_field'
  | 'malformed_column'
  | 'malformed_half_life_field'
  | 'unsupported_unit'
  | 'non_representable_value'
  | 'duplicate_record';

/** Диагностика одной строки источника, не прошедшей строгую проверку. */
export interface NubaseParseDiagnostic {
  kind: NubaseParseDiagnosticKind;
  /** Номер строки в исходном тексте (1-based). */
  lineNumber: number;
  /** Человекочитаемая причина. */
  reason: string;
  /** Исходная строка (не теряется молча). */
  sourceLine: string;
}

/** Ошибка разбора строки данных (fail-closed парсер; аудит R4, C3). */
export class NubaseAuditParseError extends Error {
  /** Диагностика, объясняющая отказ. */
  readonly diagnostic: NubaseParseDiagnostic;
  constructor(diagnostic: NubaseParseDiagnostic) {
    super(
      `NUBASE2020: строка ${diagnostic.lineNumber} не проходит строгую проверку (${diagnostic.kind}): ${diagnostic.reason}`
    );
    this.name = 'NubaseAuditParseError';
    this.diagnostic = diagnostic;
  }
}

/** Счётчики строк строгого парсера (аудит R4, C3). */
export interface NubaseParseLineStats {
  /** Всего строк при разбиении текста по «\n» (включая пустую последнюю). */
  totalLines: number;
  /** Строки, не являющиеся записями данных (шапка «#», пустые, прочие). */
  nonDataLines: number;
  /** Строки, похожие на записи данных. */
  dataLines: number;
  /** Успешно разобранные записи. */
  parsedRows: number;
  /** Записи, отклонённые строгой проверкой (диагностика зафиксирована). */
  malformedRows: number;
  /** Записи-дубликаты по (Z, A, i, s), отклонённые с диагностикой. */
  duplicateRows: number;
}

/** Результат строгого разбора текста NUBASE2020 (аудит R4, C3). */
export interface NubaseParseResult {
  rows: readonly NubaseAuditRow[];
  /** Диагностика отклонённых строк и неподдерживаемых единиц (строки не теряются молча). */
  diagnostics: readonly NubaseParseDiagnostic[];
  lineStats: NubaseParseLineStats;
}

type NubaseLineParseOutcome =
  | { ok: true; row: NubaseAuditRow; warnings: readonly NubaseParseDiagnostic[] }
  | { ok: false; kind: NubaseParseDiagnosticKind; reason: string };

function parseDataLine(line: string, lineNumber: number): NubaseLineParseOutcome {
  if (line.length < NUBASE_MIN_DATA_LINE_LENGTH) {
    return {
      ok: false,
      kind: 'too_short',
      reason: `обрезанная запись данных: ${line.length} символов < ${NUBASE_MIN_DATA_LINE_LENGTH}`
    };
  }
  const aaa = line.slice(0, 3);
  if (!/^[0-9]{3}$/.test(aaa)) {
    return { ok: false, kind: 'malformed_aaa', reason: `поле AAA «${aaa}» не является трёхзначным числом` };
  }
  const zzzi = line.slice(4, 8);
  if (!/^[0-9]{4}$/.test(zzzi)) {
    return { ok: false, kind: 'malformed_zzzi', reason: `поле ZZZi «${zzzi}» не является четырёхзначным числом` };
  }
  const atomicNumber = Number(zzzi.slice(0, 3));
  const stateIndex = Number(zzzi.slice(3, 4));
  if (atomicNumber > 118) {
    return { ok: false, kind: 'malformed_zzzi', reason: `атомный номер ${atomicNumber} вне таблицы (Z<=118)` };
  }
  const stateCode = NUBASE_STATE_CODE_BY_INDEX[stateIndex];
  if (stateCode === undefined) {
    return { ok: false, kind: 'malformed_state_index', reason: `индекс состояния i=${stateIndex} не предусмотрен шапкой файла` };
  }
  const stateChar = line.slice(16, 17);
  if (stateChar !== (stateCode === '' ? ' ' : stateCode)) {
    return {
      ok: false,
      kind: 'malformed_state_code',
      reason: `буквенный код состояния «${stateChar}» не согласован с индексом i=${stateIndex} (ожидается «${stateCode === '' ? ' ' : stateCode}»)`
    };
  }
  const massNumber = Number(aaa);
  const notation = line.slice(11, 16);
  const notationMatch = /^[ ]*[0-9]{1,3}[A-Za-z]{1,2}[ ]*$/.exec(notation);
  const notationDigits = notationMatch !== null ? notation.replace(/[A-Za-z ]+$/, '') : '';
  const notationSymbol = notationMatch !== null ? notation.replace(/^[ ]*[0-9]+/, '').trim() : '';
  const expectedSymbol = NUBASE_ELEMENT_SYMBOLS[atomicNumber];
  if (
    notationMatch === null ||
    Number(notationDigits) !== massNumber ||
    notationSymbol !== expectedSymbol
  ) {
    return {
      ok: false,
      kind: 'malformed_notation',
      reason: `обозначение нуклида «${notation.trim()}» не согласовано с записью (ожидается «${massNumber}${expectedSymbol}»)`
    };
  }
  const massField = line.slice(18, 31);
  if (!NUBASE_MASS_FIELD_PATTERN.test(massField)) {
    return { ok: false, kind: 'malformed_mass_field', reason: `поле массы «${massField.trim()}» не соответствует формату NUBASE2020` };
  }
  const dMassField = line.slice(31, 42);
  if (!NUBASE_UNCERTAINTY_FIELD_PATTERN.test(dMassField)) {
    return { ok: false, kind: 'malformed_mass_field', reason: `поле неопределённости массы «${dMassField.trim()}» не соответствует формату NUBASE2020` };
  }
  const excField = line.slice(42, 54);
  if (!NUBASE_EXC_FIELD_PATTERN.test(excField)) {
    return { ok: false, kind: 'malformed_exc_field', reason: `поле энергии возбуждения «${excField.trim()}» не соответствует формату NUBASE2020` };
  }
  const dExcField = line.slice(54, 65);
  if (!NUBASE_UNCERTAINTY_FIELD_PATTERN.test(dExcField)) {
    return { ok: false, kind: 'malformed_exc_field', reason: `поле неопределённости энергии «${dExcField.trim()}» не соответствует формату NUBASE2020` };
  }
  const originField = line.slice(65, 67);
  if (!NUBASE_ORIGIN_FIELD_PATTERN.test(originField)) {
    return { ok: false, kind: 'malformed_column', reason: `поле Origin «${originField.trim()}» не соответствует формату NUBASE2020` };
  }
  const isomUncField = line.slice(67, 68);
  if (!NUBASE_ISOM_UNC_PATTERN.test(isomUncField)) {
    return { ok: false, kind: 'malformed_column', reason: `поле Isom.Unc «${isomUncField}» не является пробелом или «*»` };
  }
  const isomInvField = line.slice(68, 69);
  if (!NUBASE_ISOM_INV_PATTERN.test(isomInvField)) {
    return { ok: false, kind: 'malformed_column', reason: `поле Isom.Inv «${isomInvField}» не является пробелом или «&»` };
  }
  const halfLifeField = line.slice(69, 78);
  if (!NUBASE_HALF_LIFE_FIELD_PATTERN.test(halfLifeField)) {
    return { ok: false, kind: 'malformed_half_life_field', reason: `поле T1/2 «${halfLifeField.trim()}» не соответствует формату NUBASE2020` };
  }
  const halfLifeUncField = line.slice(81, 88);
  if (!NUBASE_HALF_LIFE_UNC_FIELD_PATTERN.test(halfLifeUncField)) {
    return { ok: false, kind: 'malformed_half_life_field', reason: `поле dT «${halfLifeUncField.trim()}» не соответствует формату NUBASE2020` };
  }
  const tTrim = halfLifeField.trim();
  const dTrim = halfLifeUncField.trim();
  let kind: NubaseAuditHalfLifeKind = 'none';
  let raw = tTrim;
  let effectiveUnit = '';
  let effectiveUnc = dTrim;
  if (tTrim === 'stbl') {
    kind = 'stable';
  } else if (tTrim === 'p-unst') {
    kind = 'predicted_unstable';
  } else if (tTrim === '') {
    // Аномалия файла: предел/приближение записано в позиции dT при
    // пустом поле T (например 85Tc «<110ns», 18B «<26 ns»).
    if (/^[<>~]/.test(dTrim)) {
      const m = /^([<>~])([0-9]+(?:[.][0-9]+)?)(#?)(?:[ ]*([a-zA-Z]{1,2}))?$/.exec(dTrim);
      if (m === null) {
        return { ok: false, kind: 'malformed_half_life_field', reason: `предел в позиции dT «${dTrim}» не разбирается` };
      }
      raw = m[1] + m[2];
      effectiveUnit = m[4] ?? '';
      effectiveUnc = '';
      kind =
        m[3] === '#'
          ? 'estimated'
          : m[1] === '<'
            ? 'upper_limit'
            : m[1] === '>'
              ? 'lower_limit'
              : 'approx';
    }
  } else if (tTrim.includes('#')) {
    kind = 'estimated';
  } else if (tTrim.startsWith('~')) {
    kind = 'approx';
  } else if (tTrim.startsWith('>')) {
    kind = 'lower_limit';
  } else if (tTrim.startsWith('<')) {
    kind = 'upper_limit';
  } else {
    kind = 'measured';
  }
  const unitColumn = line.slice(78, 80).trim();
  const hasValue =
    kind === 'measured' ||
    kind === 'approx' ||
    kind === 'lower_limit' ||
    kind === 'upper_limit' ||
    kind === 'estimated';
  if (!hasValue && unitColumn !== '') {
    return {
      ok: false,
      kind: 'malformed_half_life_field',
      reason: `единица «${unitColumn}» указана при отсутствии значения T1/2 («${tTrim}»)`
    };
  }
  if (hasValue && tTrim !== '') {
    if (unitColumn === '') {
      return {
        ok: false,
        kind: 'malformed_half_life_field',
        reason: `значение T1/2 «${tTrim}» опубликовано без единицы времени`
      };
    }
    effectiveUnit = unitColumn;
  }
  const row = buildRow(line, lineNumber, kind, raw, effectiveUnc, effectiveUnit, halfLifeField, halfLifeUncField);
  // Проверки представимости значений (fail-closed, аудит R4, C3).
  if (massNumber < 1 || massNumber < atomicNumber) {
    return { ok: false, kind: 'non_representable_value', reason: `массовое число A=${massNumber} недопустимо для Z=${atomicNumber}` };
  }
  if (row.halfLifeValue !== null && (!(row.halfLifeValue > 0) || row.halfLifeValue > 1e15)) {
    return { ok: false, kind: 'non_representable_value', reason: `значение T1/2 «${raw}» непредставимо (вне (0, 1e15])` };
  }
  if (row.halfLifeSigma !== null && (!(row.halfLifeSigma > 0) || !Number.isFinite(row.halfLifeSigma))) {
    return { ok: false, kind: 'non_representable_value', reason: `неопределённость dT «${effectiveUnc}» непредставима (обязана быть конечной положительной)` };
  }
  const massNumeric = /[0-9]/.test(massField);
  if (massNumeric) {
    const massValue = Number(massField.replace(/[ #]/g, ''));
    if (!Number.isFinite(massValue) || Math.abs(massValue) > 1e6) {
      return { ok: false, kind: 'non_representable_value', reason: `масса «${massField.trim()}» непредставима (|v| > 1e6 кэВ)` };
    }
  }
  // Запись хорошо сформирована. Если единица времени значения не
  // поддерживается реестром NUBASE2020, строка СОХРАНЯЕТСЯ (T1/2 в
  // секунды не переводится, в аудите — причина unresolved_unit), а в
  // диагностику попадает предупреждение unsupported_unit.
  const warnings: NubaseParseDiagnostic[] = [];
  if (hasValue && nubaseAuditUnitSeconds(effectiveUnit) === null) {
    warnings.push({
      kind: 'unsupported_unit',
      lineNumber,
      reason: `единица времени «${effectiveUnit}» не поддерживается реестром NUBASE2020: T1/2 не переводится в секунды, строка не может быть сверена с интервалом якоря`,
      sourceLine: line
    });
  }
  return { ok: true, row, warnings };
}

function buildRow(
  line: string,
  lineNumber: number,
  kind: NubaseAuditHalfLifeKind,
  raw: string,
  uncRaw: string,
  unit: string,
  halfLifeField: string,
  halfLifeUncField: string
): NubaseAuditRow {
  const aaa = line.slice(0, 3);
  const zzzi = line.slice(4, 8);
  const massNumber = Number(aaa);
  const atomicNumber = Number(zzzi.slice(0, 3));
  const stateIndex = Number(zzzi.slice(3, 4));
  const stateCode = NUBASE_STATE_CODE_BY_INDEX[stateIndex] ?? '';
  const value = raw !== '' && kind !== 'stable' && kind !== 'predicted_unstable'
    ? Number.parseFloat(raw.replace(/[~><#]/g, ''))
    : null;
  const sigma = uncRaw !== '' && /^[0-9]+([.][0-9]+)?#?$/.test(uncRaw)
    ? Number.parseFloat(uncRaw.replace('#', ''))
    : null;
  const factor = nubaseAuditUnitSeconds(unit);
  const seconds =
    value !== null && Number.isFinite(value) && factor !== null ? value * factor : null;
  const massField = line.slice(18, 31);
  const excField = line.slice(42, 54);
  const massEstimated = massField.includes('#');
  const excitationEstimated = excField.includes('#');
  const excitationPresent = /[0-9]/.test(excField);
  const excitationNonExist = excField.trim() === 'non-exist';
  const massValid = /[0-9]/.test(massField) && !massEstimated;
  const excValid = excitationPresent && !excitationEstimated;
  const ownHalfLife =
    kind === 'measured' || kind === 'approx' || kind === 'lower_limit' || kind === 'upper_limit';
  const recordId =
    `nubase2020:Z=${String(atomicNumber).padStart(3, '0')},A=${String(massNumber).padStart(3, '0')}` +
    `,i=${stateIndex},s=${stateCode}`;
  return {
    recordId,
    lineNumber,
    atomicNumber,
    massNumber,
    stateIndex,
    stateCode,
    notation: line.slice(11, 16).trim(),
    halfLifeKind: kind,
    halfLifeRaw: raw,
    halfLifeFieldRaw: halfLifeField,
    halfLifeUncFieldRaw: halfLifeUncField,
    halfLifeUnit: unit,
    halfLifeValue: value !== null && Number.isFinite(value) ? value : null,
    halfLifeSigma: sigma,
    halfLifeSeconds: seconds,
    massValid,
    massEstimated,
    excitationPresent,
    excitationEstimated,
    excitationNonExist,
    orderingUncertain: line.slice(67, 68) === '*',
    orderingInverted: line.slice(68, 69) === '&',
    observed: massValid || excValid || ownHalfLife,
    sourceLine: line
  };
}

/**
 * Разобрать одну строку официального файла NUBASE2020 по
 * фиксированным колонкам шапки (аудит R4, C3 — строгая fail-closed
 * проверка). Возвращает null для строк, не являющихся записями
 * данных (шапка «#», пустые, текст); для строк данных, не
 * проходящих строгую проверку, выбрасывает NubaseAuditParseError с
 * диагностикой — повреждённые записи НЕ возвращаются как частично
 * разобранные и не теряются молча. Особенности файла: при пустом
 * поле T предел/приближение может быть записан в позиции dT
 * (например 85Tc «<110ns») — разбирается как собственный T1/2;
 * метка изоспина «T=…» у IAS-строк НЕ интерпретируется как T1/2.
 */
export function parseNubaseAuditLine(line: string, lineNumber = 1): NubaseAuditRow | null {
  if (!NUBASE_DATA_LIKE_PATTERN.test(line)) {
    return null;
  }
  const outcome = parseDataLine(line, lineNumber);
  if (outcome.ok) {
    return outcome.row;
  }
  throw new NubaseAuditParseError({
    kind: outcome.kind,
    lineNumber,
    reason: outcome.reason,
    sourceLine: line
  });
}

/**
 * Строго разобрать весь текст файла NUBASE2020 (аудит R4, C3).
 * Детерминировано, в порядке строк. Обрезанные, повреждённые и
 * дублирующиеся записи НЕ теряются молча: каждая попадает в
 * diagnostics с номером строки, причиной и исходной строкой;
 * счётчики — в lineStats. Дубликатом считается повтор ключа
 * (Z, A, i, s): первый экземпляр разбирается, повтор — диагностика
 * duplicate_record (дубликаты не участвуют в подсчёте изомерных
 * состояний и не удовлетворяют цепное правило дважды). Строки с
 * непредвиденной единицей времени сохраняются с предупреждением
 * unsupported_unit (T1/2 не переводится в секунды).
 */
export function parseNubaseAuditText(text: string): NubaseParseResult {
  const lines = text.split('\n');
  const rows: NubaseAuditRow[] = [];
  const diagnostics: NubaseParseDiagnostic[] = [];
  const seen = new Set<string>();
  let nonDataLines = 0;
  let dataLines = 0;
  let malformedRows = 0;
  let duplicateRows = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (!NUBASE_DATA_LIKE_PATTERN.test(line)) {
      nonDataLines += 1;
      continue;
    }
    dataLines += 1;
    const outcome = parseDataLine(line, lineNumber);
    if (!outcome.ok) {
      malformedRows += 1;
      diagnostics.push({ kind: outcome.kind, lineNumber, reason: outcome.reason, sourceLine: line });
      continue;
    }
    if (seen.has(outcome.row.recordId)) {
      duplicateRows += 1;
      diagnostics.push({
        kind: 'duplicate_record',
        lineNumber,
        reason: `повтор записи источника ${outcome.row.recordId}: дубликаты строк NUBASE2020 не допускаются`,
        sourceLine: line
      });
      continue;
    }
    seen.add(outcome.row.recordId);
    rows.push(outcome.row);
    for (const warning of outcome.warnings) {
      diagnostics.push(warning);
    }
  }
  return {
    rows,
    diagnostics,
    lineStats: {
      totalLines: lines.length,
      nonDataLines,
      dataLines,
      parsedRows: rows.length,
      malformedRows,
      duplicateRows
    }
  };
}

// ============================================
// 4. SHA-256 ФАКТИЧЕСКОГО ВХОДНОГО ТЕКСТА
// ============================================

/** Таблица констант SHA-256 (FIPS 180-4). */
const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function sha256Rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256Ascii(text: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    bytes.push(text.charCodeAt(i));
  }
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  bytes.push(0, 0, 0, 0);
  bytes.push((bitLength >>> 24) & 0xff, (bitLength >>> 16) & 0xff, (bitLength >>> 8) & 0xff, bitLength & 0xff);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let t = 0; t < 16; t++) {
      const i = offset + t * 4;
      w[t] = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = sha256Rotr(w[t - 15], 7) ^ sha256Rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = sha256Rotr(w[t - 2], 17) ^ sha256Rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t++) {
      const s1 = sha256Rotr(e, 6) ^ sha256Rotr(e, 11) ^ sha256Rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const s0 = sha256Rotr(a, 2) ^ sha256Rotr(a, 13) ^ sha256Rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * SHA-256 фактического входного текста аудита (аудит R4, C4).
 * Вычисляется по байтам ПЕРЕДАННОГО текста, а не копируется из
 * константы: метаданные запуска обязаны описывать реальный вход.
 * Файл NUBASE2020 — ASCII: не-ASCII вход отвергается ошибкой, а не
 * хешируется молча.
 */
export function computeNubaseAuditTextSha256(text: string): string {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      throw new Error(
        `SHA-256 аудита NUBASE2020 принимает только ASCII-текст (официальный файл — ASCII); не-ASCII символ на позиции ${i + 1}`
      );
    }
  }
  return sha256Ascii(text);
}

// ============================================
// 5. АУДИТ ЭЛЕМЕНТА: КЛАССИФИКАЦИЯ И РАНЖИРОВАНИЕ
// ============================================

/**
 * Причина исключения строки из ранжирования или понижения полноты
 * (аудит R4). Значения без опубликованной числовой σ НИКОГДА не
 * исключаются точечным правилом: номинал без σ не доказывает
 * положения истинного значения относительно интервала якоря.
 */
export type NubaseAuditExclusionKind =
  | 'lower_limit_unbounded'
  | 'upper_limit_excluded'
  | 'unresolved_upper_limit'
  | 'unresolved_no_sigma'
  | 'unresolved_approx'
  | 'unresolved_estimated'
  | 'no_half_life_unresolved'
  | 'stable_state_present'
  | 'indeterminate_state_unresolved'
  | 'interval_disjoint'
  | 'anchor_without_sigma'
  | 'unresolved_unit';

/** Причина исключения строки из ранжирования или понижения полноты. */
export interface NubaseAuditExclusion {
  kind: NubaseAuditExclusionKind;
  /** Строка-обоснование (сама исключаемая/оспариваемая строка источника). */
  row: NubaseAuditRow;
  /** Объяснение правила. */
  explanation: string;
}

/** Отчёт аудита одного элемента. */
export interface NubaseAuditElementReport {
  atomicNumber: number;
  /** Число экспериментально наблюдавшихся строк (правило 1). */
  observedRows: number;
  /** Наблюдавшиеся основные состояния. */
  grounds: number;
  /** Наблюдавшиеся стандартные изомеры (i=1,m / i=2,n). */
  standardIsomers: number;
  /** Наблюдавшиеся дополнительные изомеры (i=3…6 / s=p,q,r,x при контексте). */
  additionalIsomers: number;
  /** Наблюдавшиеся уровни. */
  levels: number;
  /** Наблюдавшиеся резонансы. */
  resonances: number;
  /** Наблюдавшиеся IAS (s=i,j; i=8,9). */
  ias: number;
  /** Наблюдавшиеся строки с неопределимой классификацией. */
  indeterminate: number;
  /** Счётчики видов записи T1/2 среди наблюдавшихся строк. */
  halfLifeKinds: Readonly<Record<NubaseAuditHalfLifeKind, number>>;
  /** Якорь — самый долгоживущий измеренный нуклид-кандидат. */
  anchor: NubaseAuditRow | null;
  /** Кандидаты после отбора (якорь и пересекающиеся с ним по 1σ). */
  candidates: readonly NubaseAuditRow[];
  /** Полнота В ПРЕДЕЛАХ NUBASE2020 (статусы incomplete каталога здесь не вычисляются). */
  completeness: 'complete' | 'not_verifiable' | 'no_anchor';
  /**
   * Наблюдавшиеся уровни/резонансы/IAS/неопределимые строки без
   * собственного пригодного для ранжирования T1/2 (аудит R4,
   * явный учёт состояний без T1/2): кандидатами они не являются,
   * но отсутствие T1/2 не считается доказательством короткого
   * времени жизни и не теряется молча.
   */
  nonCandidateStatesWithoutHalfLife: number;
  /** Причины: пределы, приближения, значения без σ, несовместимые единицы. */
  reasons: readonly NubaseAuditExclusion[];
}

const EMPTY_HALF_LIFE_KINDS: Record<NubaseAuditHalfLifeKind, number> = {
  measured: 0,
  approx: 0,
  lower_limit: 0,
  upper_limit: 0,
  estimated: 0,
  stable: 0,
  predicted_unstable: 0,
  none: 0
};

/**
 * Аудит одного элемента: контекстная классификация состояний
 * (classifyNubaseState по ВСЕМ строкам групп (Z, A), а не только
 * кандидатам) и ранжирование наблюдавшихся строк по правилам
 * elementIsotopeCandidates.ts. Детерминировано: группы — по
 * возрастанию A, строки — по (i, s).
 */
export function auditNubaseElement(
  atomicNumber: number,
  rows: readonly NubaseAuditRow[]
): NubaseAuditElementReport {
  const elementRows = rows.filter((r) => r.atomicNumber === atomicNumber);
  const byA = new Map<number, NubaseAuditRow[]>();
  for (const r of elementRows) {
    const g = byA.get(r.massNumber);
    if (g !== undefined) {
      g.push(r);
    } else {
      byA.set(r.massNumber, [r]);
    }
  }
  const groups = [...byA.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, g]) =>
      [...g].sort(
        (x, y) =>
          x.stateIndex - y.stateIndex ||
          (x.stateCode < y.stateCode ? -1 : x.stateCode > y.stateCode ? 1 : 0)
      )
    );

  let observedRows = 0;
  let grounds = 0;
  let standardIsomers = 0;
  let additionalIsomers = 0;
  let levels = 0;
  let resonances = 0;
  let ias = 0;
  let indeterminate = 0;
  let nonCandidateStatesWithoutHalfLife = 0;
  const halfLifeKinds: Record<NubaseAuditHalfLifeKind, number> = { ...EMPTY_HALF_LIFE_KINDS };
  const eligible: NubaseAuditRow[] = [];
  const reasons: NubaseAuditExclusion[] = [];
  let unresolvedPresent = false;

  for (const group of groups) {
    const refs: NubaseStateRowRef[] = group.map((r) => ({
      stateIndex: r.stateIndex,
      stateCode: r.stateCode as NubaseStateRowRef['stateCode']
    }));
    for (let k = 0; k < group.length; k++) {
      const row = group[k];
      if (!row.observed) {
        continue;
      }
      observedRows += 1;
      halfLifeKinds[row.halfLifeKind] += 1;
      const cls = classifyNubaseState(refs[k], refs).classification;
      if (cls === 'ground') {
        grounds += 1;
      } else if (cls === 'isomer') {
        if (row.stateIndex === 1 || row.stateIndex === 2) {
          standardIsomers += 1;
        } else {
          additionalIsomers += 1;
        }
      } else if (cls === 'level') {
        levels += 1;
      } else if (cls === 'resonance') {
        resonances += 1;
      } else if (cls === 'ias') {
        ias += 1;
      } else {
        indeterminate += 1;
      }
      const ownRankedHalfLife =
        row.halfLifeKind === 'measured' ||
        row.halfLifeKind === 'approx' ||
        row.halfLifeKind === 'lower_limit' ||
        row.halfLifeKind === 'upper_limit';
      if (cls === 'ground' || cls === 'isomer') {
        if (ownRankedHalfLife) {
          eligible.push(row);
        } else if (row.halfLifeKind === 'estimated') {
          // Оценённое систематикой «v#» значение без опубликованной
          // числовой σ: номинал не доказывает неконкурентность (аудит R4).
          unresolvedPresent = true;
          reasons.push({
            kind: 'unresolved_estimated',
            row,
            explanation:
              'оценённое систематикой «v#» значение T1/2 без опубликованной числовой σ: номинал не доказывает, что истинный T1/2 состояния ниже нижней границы 1σ-интервала якоря, искусственная неопределённость не вводится — полнота не доказуема'
          });
        } else if (row.halfLifeKind === 'stable') {
          // Наблюдавшееся стабильное ground/isomer-состояние: ранжирование
          // измеренных значений не устанавливает самое долгоживущее
          // состояние элемента (аудит R4).
          unresolvedPresent = true;
          reasons.push({
            kind: 'stable_state_present',
            row,
            explanation:
              'наблюдавшееся стабильное состояние (stbl): его время жизни не ограничено, ранжирование измеренных T1/2 не устанавливает самое долгоживущее состояние элемента — полнота не доказуема'
          });
        } else {
          // Собственный T1/2 отсутствует (включая p-unst): отсутствие
          // опубликованного T1/2 НЕ считается доказательством короткого
          // времени жизни (аудит R4, Part II §5).
          unresolvedPresent = true;
          reasons.push({
            kind: 'no_half_life_unresolved',
            row,
            explanation:
              'наблюдавшееся ground/isomer-состояние без собственного опубликованного T1/2: источник не устанавливает, что оно не может конкурировать с якорем, — полнота не доказуема'
          });
        }
      } else {
        // Уровни, резонансы, IAS: кандидатами не являются, но отсутствие
        // собственного T1/2 учитывается явно, а не молча (аудит R4).
        if (!ownRankedHalfLife) {
          nonCandidateStatesWithoutHalfLife += 1;
        }
        if (cls === 'indeterminate') {
          // Неопределимая строка: научный тип состояния не выводится —
          // доказать, что она не является ground/isomer, нельзя (аудит R4).
          unresolvedPresent = true;
          reasons.push({
            kind: 'indeterminate_state_unresolved',
            row,
            explanation:
              'наблюдавшаяся строка с неопределимой классификацией состояния: доказать, что она не является ground/isomer-конкурентом якоря, нельзя — полнота не доказуема'
          });
        }
      }
    }
  }

  // Якорь — самый долгоживущий измеренный нуклид-кандидат.
  const measured = eligible.filter((r) => r.halfLifeKind === 'measured');
  let anchor: NubaseAuditRow | null = null;
  for (const r of measured) {
    if (
      r.halfLifeSeconds !== null &&
      (anchor === null ||
        (anchor.halfLifeSeconds as number) < (r.halfLifeSeconds as number))
    ) {
      anchor = r;
    }
  }
  if (anchor === null) {
    return {
      atomicNumber,
      observedRows,
      grounds,
      standardIsomers,
      additionalIsomers,
      levels,
      resonances,
      ias,
      indeterminate,
      nonCandidateStatesWithoutHalfLife,
      halfLifeKinds,
      anchor: null,
      candidates: [],
      completeness: unresolvedPresent ? 'not_verifiable' : 'no_anchor',
      reasons
    };
  }

  const anchorFactor = nubaseAuditUnitSeconds(anchor.halfLifeUnit);
  if (anchor.halfLifeSigma === null || anchorFactor === null) {
    reasons.push({
      kind: 'anchor_without_sigma',
      row: anchor,
      explanation:
        'у якорного нуклида не опубликована σ (или не поддерживается единица): строгий 1σ-рейтинг невозможен, полнота не доказуема'
    });
    return {
      atomicNumber,
      observedRows,
      grounds,
      standardIsomers,
      additionalIsomers,
      levels,
      resonances,
      ias,
      indeterminate,
      nonCandidateStatesWithoutHalfLife,
      halfLifeKinds,
      anchor,
      candidates: [anchor],
      completeness: 'not_verifiable',
      reasons
    };
  }
  const anchorLow =
    (anchor.halfLifeSeconds as number) - anchor.halfLifeSigma * anchorFactor;
  const anchorHigh =
    (anchor.halfLifeSeconds as number) + anchor.halfLifeSigma * anchorFactor;

  const candidates: NubaseAuditRow[] = [anchor];
  let completeness: 'complete' | 'not_verifiable' = unresolvedPresent
    ? 'not_verifiable'
    : 'complete';

  for (const r of eligible) {
    if (r === anchor) {
      continue;
    }
    if (r.halfLifeSeconds === null) {
      reasons.push({
        kind: 'unresolved_unit',
        row: r,
        explanation:
          'единица времени строки не поддерживается парсером: строка не может быть сверена с интервалом якоря, полнота не доказуема'
      });
      completeness = 'not_verifiable';
      continue;
    }
    if (r.halfLifeKind === 'measured') {
      if (r.halfLifeSigma === null) {
        // Измеренное значение без опубликованной σ: точечное правило
        // УДАЛЕНО (аудит R4) — номинал без σ не доказывает
        // неконкурентность ни при каком соотношении с якорем.
        reasons.push({
          kind: 'unresolved_no_sigma',
          row: r,
          explanation:
            'измеренное значение без опубликованной σ: отсутствие σ — отсутствие информации о неопределённости, номинальное значение не принимается точной точкой и не доказывает, что истинный T1/2 ниже нижней границы 1σ-интервала якоря — полнота не доказуема'
        });
        completeness = 'not_verifiable';
        continue;
      }
      const f = nubaseAuditUnitSeconds(r.halfLifeUnit);
      if (f === null) {
        reasons.push({
          kind: 'unresolved_unit',
          row: r,
          explanation:
            'единица времени строки не поддерживается парсером: строка не может быть сверена с интервалом якоря, полнота не доказуема'
        });
        completeness = 'not_verifiable';
        continue;
      }
      const low = (r.halfLifeSeconds as number) - r.halfLifeSigma * f;
      const high = (r.halfLifeSeconds as number) + r.halfLifeSigma * f;
      if (low <= anchorHigh && high >= anchorLow) {
        candidates.push(r);
      } else {
        // У строки и якоря опубликованные σ: непересечение интервалов
        // ДОКАЗЫВАЕТ неконкурентность (исключение обосновано).
        reasons.push({
          kind: 'interval_disjoint',
          row: r,
          explanation:
            '1σ-интервалы строки и якоря не пересекаются (у обеих строк опубликованы σ) — исключение обосновано опубликованными неопределённостями'
        });
      }
      continue;
    }
    if (r.halfLifeKind === 'approx') {
      // Приближение «~v»: σ не опубликована, искусственная
      // неопределённость не вводится; точечное правило УДАЛЕНО (аудит R4).
      reasons.push({
        kind: 'unresolved_approx',
        row: r,
        explanation:
          'приближение «~v» без опубликованной σ: отсутствие σ — отсутствие информации о неопределённости, номинальное значение не принимается точной точкой и не доказывает, что истинный T1/2 ниже нижней границы 1σ-интервала якоря — полнота не доказуема'
      });
      completeness = 'not_verifiable';
      continue;
    }
    if (r.halfLifeKind === 'lower_limit') {
      reasons.push({
        kind: 'lower_limit_unbounded',
        row: r,
        explanation:
          'нижний предел «>x» без верхней границы: истинный T1/2 не ограничен сверху, исключить строку из конкурентов якоря нельзя — полнота не доказуема'
      });
      completeness = 'not_verifiable';
      continue;
    }
    if (r.halfLifeKind === 'upper_limit') {
      if ((r.halfLifeSeconds as number) < anchorLow) {
        reasons.push({
          kind: 'upper_limit_excluded',
          row: r,
          explanation:
            'верхний предел «<x»: x ниже нижней границы 1σ-интервала якоря — исключено по опубликованному значению'
        });
      } else {
        reasons.push({
          kind: 'unresolved_upper_limit',
          row: r,
          explanation:
            'верхний предел «<x» не ниже нижней границы интервала якоря: исключить строку нельзя, полнота не доказуема'
        });
        completeness = 'not_verifiable';
      }
    }
  }

  return {
    atomicNumber,
    observedRows,
    grounds,
    standardIsomers,
    additionalIsomers,
    levels,
    resonances,
    ias,
    indeterminate,
    nonCandidateStatesWithoutHalfLife,
    halfLifeKinds,
    anchor,
    candidates,
    completeness,
    reasons
  };
}

// ============================================
// 6. ПОЛНЫЙ АУДИТ ТЕКСТА ФАЙЛА И МЕТАДАННЫЕ ЗАПУСКА
// ============================================

/** Опции запуска аудита (аудит R4, C4). */
export interface NubaseAuditOptions {
  /**
   * Метка синтетического фрагмента (fixture). Помечает вход как
   * НЕ являющийся официальным файлом: sourceVerification получает
   * 'unverified' независимо от совпадения хешей, полный аудит не
   * заявляется.
   */
  fixtureLabel?: string;
}

/** Метаданные конкретного запуска аудита (аудит R4, C4). */
export interface NubaseAuditRunMetadata {
  /** Версия парсера и методики (NUBASE_AUDIT_PARSER_VERSION). */
  parserVersion: string;
  /** Версия источника данных (библиография). */
  sourceVersion: string;
  /** SHA-256 ФАКТИЧЕСКОГО входного текста (вычислен, а не скопирован из константы). */
  inputSha256: string;
  /** Размер входного текста в байтах (ASCII: по одному байту на символ). */
  inputBytes: number;
  /** Подтверждено ли, что вход — локально проверенная копия официального файла. */
  sourceVerification: 'verified' | 'unverified';
  /** Пояснение статуса проверки (человекочитаемое). */
  verificationNote: string;
  /** Дата получения проверенной копии; null — вход не подтверждён. */
  retrievedAt: string | null;
  /** Метка fixture, если вход — синтетический фрагмент; null — метки нет. */
  fixtureLabel: string | null;
  /** Успешно разобранные строки данных. */
  parsedRows: number;
  /** Отклонённые строгой проверкой строки (диагностика зафиксирована). */
  malformedRows: number;
  /** Дубликаты (Z, A, i, s), отклонённые с диагностикой. */
  duplicateRows: number;
  /** Строки, не являющиеся записями данных (шапка, пустые). */
  skippedNonDataLines: number;
  /** Атомные номера, для которых выполнено ранжирование. */
  rankedElements: readonly number[];
}

/** Итог полного аудита текста файла (аудит R4, C4). */
export interface NubaseAuditReport {
  /** Библиография официального источника NUBASE2020. */
  bibliography: NubaseBibliography;
  /** SHA-256 локально проверенной копии официального файла (ожидание для сверки). */
  verifiedSourceSha256: string;
  /** Метаданные фактического запуска (хеш и размер входа, статусы строк). */
  run: NubaseAuditRunMetadata;
  /** Диагностика парсера (отклонённые строки не теряются молча). */
  diagnostics: readonly NubaseParseDiagnostic[];
  /** Отчёты по элементам в порядке запрошенных атомных номеров. */
  reports: readonly NubaseAuditElementReport[];
}

/**
 * Полный воспроизводимый аудит: строго разобрать текст входного
 * файла NUBASE2020 (fail-closed парсер, аудит R4 C3), вычислить
 * SHA-256 ФАКТИЧЕСКОГО входа (C4) и выполнить ранжирование для
 * каждого запрошенного атомного номера. Детерминировано: без
 * случайности, времени и состояния. sourceVerification 'verified'
 * означает, что входной текст побайтово равен локально проверенной
 * копии официального файла (SHA-256 и размер совпадают); любой
 * синтетический фрагмент — 'unverified' и не имитирует проверку
 * полного официального файла. Для ранжирования 14 элементов
 * передайте NUBASE_AUDIT_RANKED_ELEMENTS.
 */
export function auditNubaseText(
  text: string,
  atomicNumbers: readonly number[],
  options: NubaseAuditOptions = {}
): NubaseAuditReport {
  const parse = parseNubaseAuditText(text);
  const inputSha256 = computeNubaseAuditTextSha256(text);
  const isFixture = options.fixtureLabel !== undefined;
  const verified =
    !isFixture &&
    inputSha256 === NUBASE2020_VERIFIED_SOURCE_SHA256 &&
    text.length === NUBASE2020_VERIFIED_SOURCE_BYTES;
  const run: NubaseAuditRunMetadata = {
    parserVersion: NUBASE_AUDIT_PARSER_VERSION,
    sourceVersion: NUBASE2020_BIBLIOGRAPHY.sourceVersion,
    inputSha256,
    inputBytes: text.length,
    sourceVerification: verified ? 'verified' : 'unverified',
    verificationNote: verified
      ? 'входной текст побайтово совпадает с локально проверенной копией официального ASCII-файла NUBASE2020 (SHA-256 и размер совпадают)'
      : isFixture
        ? 'синтетический фрагмент (fixture): вход не является официальным файлом NUBASE2020, полный аудит источника не заявляется'
        : 'входной текст не совпадает с локально проверенной копией официального файла NUBASE2020 по SHA-256/размеру: источник не подтверждён, полный аудит не заявляется',
    retrievedAt: verified ? NUBASE2020_SOURCE_RETRIEVED_AT : null,
    fixtureLabel: options.fixtureLabel ?? null,
    parsedRows: parse.lineStats.parsedRows,
    malformedRows: parse.lineStats.malformedRows,
    duplicateRows: parse.lineStats.duplicateRows,
    skippedNonDataLines: parse.lineStats.nonDataLines,
    rankedElements: atomicNumbers
  };
  const reports = atomicNumbers.map((z) => auditNubaseElement(z, parse.rows));
  return {
    bibliography: NUBASE2020_BIBLIOGRAPHY,
    verifiedSourceSha256: NUBASE2020_VERIFIED_SOURCE_SHA256,
    run,
    diagnostics: parse.diagnostics,
    reports
  };
}
