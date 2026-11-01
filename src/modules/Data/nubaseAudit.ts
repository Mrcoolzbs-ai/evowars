// ============================================
// NUBASE2020 AUDIT UTILITY - воспроизводимый аудит ранжирования
// изотопов-кандидатов (Stage 4.3.3, аудит R4)
// ============================================
//
// Корректирующая ревизия R4 (политика неопределённостей): отсутствие
// опубликованной числовой σ — это отсутствие информации о
// неопределённости. Оно НЕ разрешает считать номинальное значение
// точной точкой и доказывать по нему полноту ранжирования.
// Точечное правило аудита R3 (исключение «~v» и измеренных значений
// без σ, чья точка ниже нижней границы 1σ-интервала якоря) УДАЛЕНО
// как не подтверждённое опубликованной методикой NUBASE2020.
//
// Назначение: сделать результат аудита ранжирования 14 элементов
// (Data/elementIsotopeCandidates.ts) ПОВТОРЯЕМЫМ. Утилита разбирает
// официальный ASCII-файл NUBASE2020 по фиксированным колонкам его
// шапки, группирует строки по (Z, A), классифицирует состояния
// контекстным правилом classifyNubaseState (Core/elements.ts, аудит
// R3) и выполняет ранжирование по правилам, зафиксированным в
// elementIsotopeCandidates.ts:
//   1) наблюдавшиеся строки: масса без «#», ЛИБО энергия возбуждения
//      без «#», ЛИБО собственный T1/2 (значение, предел или
//      приближение без «#»); строки, у которых все эти величины
//      оценены или отсутствуют, — систематические экстраполяции;
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
// копии официального файла. Версия проверенной копии зафиксирована
// в NUBASE2020_AUDIT_SOURCE, включая SHA-256 локально проверенной
// копии — это хеш именно локально проверенного файла, а НЕ
// официальный контрольный хеш распределения (AMDC его не публикует)
// и НЕ хеш какой-либо зеркальной копии.
//
// Ограничения (не замалчиваются):
// - утилита воспроизводит ранжирование 14 ранжируемых элементов
//   (NUBASE_AUDIT_RANKED_ELEMENTS); статусы incomplete (Z=99-118) —
//   решение каталога об области активных исследований, а не вывод
//   из файла: утилита вычисляет только complete / not_verifiable /
//   no_anchor;
// - парсер покрывает фиксированные колонки по шапке файла и две
//   задокументированные особенности официального файла: пределы и
//   приближения в позиции dT при пустом поле T (например 85Tc
//   «<110ns») и метки изоспина «T=…» в этой же позиции у IAS-строк
//   без собственного T1/2; строки с иными непредусмотренными
//   особенностями разбираются с неполными данными (seconds = null,
//   причина фиксируется), а не интерпретируются молча;
// - построчная сверка с ENSDF не выполнялась: первичный источник
//   методики — сам файл NUBASE2020.

import { classifyNubaseState } from '../Core/elements';
import type { NubaseStateRowRef } from '../Core/elements';

// ============================================
// 1. ИСТОЧНИК И ВЕРСИИ
// ============================================

/** Метаданные источника и версии методики аудита. */
export interface NubaseAuditSource {
  /** Цитирование официальной публикации NUBASE2020. */
  citation: string;
  /** DOI публикации. */
  doi: string;
  /** Официальная страница AMDC (файл получается с неё). */
  amdcPageUrl: string;
  /** Версия проверенного источника данных. */
  sourceVersion: string;
  /** Дата получения проверенной копии файла. */
  retrievedAt: string;
  /** Способ получения файла. */
  retrievalMethod: string;
  /** SHA-256 локально проверенной копии файла. */
  localCopySha256: string;
  /** Пояснение статуса хеша (не официальный хеш распределения). */
  localCopySha256Note: string;
  /** Версия парсера/методики аудита. */
  parserVersion: string;
  /** Ограничения методики. */
  limitations: readonly string[];
}

export const NUBASE2020_AUDIT_SOURCE: NubaseAuditSource = {
  citation:
    'F.G. Kondev, M. Wang, W.J. Huang, S. Naimi, G. Audi. The NUBASE2020 evaluation of nuclear physics properties. Chinese Physics C 45 (2021) 030001.',
  doi: '10.1088/1674-1137/abddae',
  amdcPageUrl: 'https://amdc.impcas.ac.cn/web/nubase_en.html',
  sourceVersion: 'NUBASE2020 (Chin. Phys. C 45, 030001, 2021), официальный ASCII-файл NUBASE2020',
  retrievedAt: '2026-11-01',
  retrievalMethod:
    'официальная страница AMDC (nubase_en.html): ASCII-файл NUBASE2020 скачан локально и использован как первичный источник аудита',
  localCopySha256: '5646189e91c9c04016005a12e34f74b73e4ea4dec57a14ed5d6d948fe0ee83ce',
  localCopySha256Note:
    'SHA-256 вычислен для локально проверенной копии файла, использованной при аудите; AMDC не публикует официальный контрольный хеш распределения — значение НЕ заявляется как официальный хеш и не является хешем зеркальной копии',
  parserVersion: 'nubase-audit-r4/1.0.0',
  limitations: [
    'полный ASCII-файл NUBASE2020 не включается в репозиторий: отдельная лицензия файла AMDC не подтверждена; полный прогон утилиты требует локальной копии официального файла',
    'статусы incomplete (Z=99-118) назначены каталогом (область активных исследований) и утилитой не вычисляются',
    'построчная сверка с ENSDF не выполнялась'
  ]
};

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
// 3. ПАРСЕР ФИКСИРОВАННЫХ КОЛОНОК
// ============================================

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
  /** Нотация T1/2 дословно (для предела в позиции dT — реконструированная). */
  halfLifeRaw: string;
  /** Единица времени NUBASE2020. */
  halfLifeUnit: string;
  /** Числовое значение в исходной единице; null — значения нет. */
  halfLifeValue: number | null;
  /** 1 сигма в исходной единице; null — не опубликована. */
  halfLifeSigma: number | null;
  /** Значение в секундах; null — единица не поддерживается или значения нет. */
  halfLifeSeconds: number | null;
  /** Масса оценена систематикой («#» в поле Mass). */
  massEstimated: boolean;
  /** Энергия возбуждения присутствует. */
  excitationPresent: boolean;
  /** Энергия возбуждения оценена систематикой («#» в поле Exc). */
  excitationEstimated: boolean;
  /** Звёздочка NUBASE (Isom.Unc «*»): порядок gs/изомера не установлен. */
  orderingUncertain: boolean;
  /** Строка экспериментально наблюдавшаяся (правило 1 методики). */
  observed: boolean;
  /** Исходная строка файла (без перевода строки). */
  sourceLine: string;
}

/**
 * Разобрать одну строку официального файла NUBASE2020 по
 * фиксированным колонкам шапки файла (колонки 1-3 A; 5-8 ZZZi;
 * 12-16 «A El»; 17 s; 19-31 Mass; 43-54 Exc; 68 Isom.Unc;
 * 70-78 T; 79-80 unit; 82-88 dT). Возвращает null для строк
 * заголовка и строк, не являющихся записями данных.
 * Особенности файла: при пустом поле T предел/приближение может
 * быть записан в позиции dT (например 85Tc «<110ns») — разбирается
 * как собственный T1/2; метка изоспина «T=…» в этой же позиции
 * (IAS-строки без T1/2) НЕ интерпретируется как T1/2.
 */
export function parseNubaseAuditLine(line: string): NubaseAuditRow | null {
  if (!/^ *[0-9]/.test(line)) {
    return null;
  }
  const massNumber = Number.parseInt(line.slice(0, 3), 10);
  const atomicNumber = Number.parseInt(line.slice(4, 7), 10);
  const stateIndex = Number.parseInt(line.slice(7, 8), 10);
  if (
    !Number.isInteger(massNumber) ||
    massNumber < 1 ||
    !Number.isInteger(atomicNumber) ||
    atomicNumber < 0 ||
    !Number.isInteger(stateIndex) ||
    stateIndex < 0
  ) {
    return null;
  }
  const stateCode = line.slice(16, 17).trim();
  const notation = line.slice(11, 16).trim();
  const massField = line.slice(18, 31);
  const excField = line.slice(42, 54);
  const orderingUncertain = line.slice(67, 68) === '*';
  let t = line.slice(69, 78).trim();
  let unit = line.slice(78, 80).trim();
  let dT = line.slice(81, 88).trim();
  let kind: NubaseAuditHalfLifeKind = 'none';
  let raw = t;
  if (t === 'stbl') {
    kind = 'stable';
  } else if (t === 'p-unst') {
    kind = 'predicted_unstable';
  } else if (t === '' && (dT.startsWith('<') || dT.startsWith('>') || dT.startsWith('~'))) {
    // Особенность файла: предел/приближение в позиции dT при пустом T.
    const m = /^([<>~])([0-9.]+) *([a-z]{1,2})?$/.exec(dT);
    if (m !== null) {
      raw = m[1] + m[2];
      unit = m[3] ?? '';
      dT = '';
      kind = m[1] === '<' ? 'upper_limit' : m[1] === '>' ? 'lower_limit' : 'approx';
    }
  } else if (t !== '') {
    if (t.includes('#')) {
      kind = 'estimated';
    } else if (t.startsWith('~')) {
      kind = 'approx';
    } else if (t.startsWith('>')) {
      kind = 'lower_limit';
    } else if (t.startsWith('<')) {
      kind = 'upper_limit';
    } else if (/^[0-9]/.test(t)) {
      kind = 'measured';
    }
  }
  const value = raw !== '' ? Number.parseFloat(raw.replace(/[~><#]/g, '')) : null;
  const sigma = dT !== '' && /^[0-9.]+$/.test(dT) ? Number.parseFloat(dT) : null;
  const factor = nubaseAuditUnitSeconds(unit);
  const seconds =
    value !== null && Number.isFinite(value) && factor !== null ? value * factor : null;
  const excitationPresent = /[0-9]/.test(excField);
  const ownHalfLife =
    kind === 'measured' || kind === 'approx' || kind === 'lower_limit' || kind === 'upper_limit';
  const observed =
    !massField.includes('#') || (excitationPresent && !excField.includes('#')) || ownHalfLife;
  return {
    atomicNumber,
    massNumber,
    stateIndex,
    stateCode,
    notation,
    halfLifeKind: kind,
    halfLifeRaw: raw,
    halfLifeUnit: unit,
    halfLifeValue: Number.isFinite(value as number) ? (value as number) : null,
    halfLifeSigma: sigma,
    halfLifeSeconds: seconds,
    massEstimated: massField.includes('#'),
    excitationPresent,
    excitationEstimated: excField.includes('#'),
    orderingUncertain,
    observed,
    sourceLine: line
  };
}

/** Разобрать весь текст файла NUBASE2020 (детерминированно, в порядке строк). */
export function parseNubaseAuditText(text: string): readonly NubaseAuditRow[] {
  const rows: NubaseAuditRow[] = [];
  for (const line of text.split('\n')) {
    const row = parseNubaseAuditLine(line);
    if (row !== null) {
      rows.push(row);
    }
  }
  return rows;
}

// ============================================
// 4. АУДИТ ЭЛЕМЕНТА: КЛАССИФИКАЦИЯ И РАНЖИРОВАНИЕ
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
// 5. ПОЛНЫЙ АУДИТ ТЕКСТА ФАЙЛА
// ============================================

/** Итог аудита: счётчик разобранных строк и отчёты по запрошенным элементам. */
export interface NubaseAuditReport {
  /** Число разобранных строк данных. */
  parsedRows: number;
  /** Отчёты по элементам в порядке запрошенных атомных номеров. */
  reports: readonly NubaseAuditElementReport[];
  /** Метаданные источника и версии методики. */
  source: NubaseAuditSource;
}

/**
 * Полный воспроизводимый аудит: разобрать текст официального файла
 * NUBASE2020 и выполнить ранжирование для каждого запрошенного
 * атомного номера. Детерминировано: без случайности, времени и
 * состояния. Для ранжирования 14 элементов передайте
 * NUBASE_AUDIT_RANKED_ELEMENTS.
 */
export function auditNubaseText(
  text: string,
  atomicNumbers: readonly number[]
): NubaseAuditReport {
  const rows = parseNubaseAuditText(text);
  const reports = atomicNumbers.map((z) => auditNubaseElement(z, rows));
  return { parsedRows: rows.length, reports, source: NUBASE2020_AUDIT_SOURCE };
}
