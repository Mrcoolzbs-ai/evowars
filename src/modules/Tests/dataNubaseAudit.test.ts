// ============================================
// STAGE 4.3.3 (аудит R4) — Тесты воспроизводимой утилиты аудита
// NUBASE2020: строгий fail-closed парсер фиксированных колонок,
// наблюдаемость строк, контекстная классификация (i, s), ранжирование,
// полнота, SHA-256 фактического входа и метаданные запуска
// ============================================
//
// Утилита Data/nubaseAudit.ts делает результат аудита ранжирования
// ПОВТОРЯЕМЫМ: полный прогон выполняется на локально предоставленной
// копии официального ASCII-файла NUBASE2020 (полный файл в
// репозиторий не включается — лицензия AMDC не подтверждена).
// Контрольные примеры шапки файла: 92Tc p и 205Po p/q —
// дополнительные изомеры ДОКАЗАННОГО контекста; 183Au p и 255No p —
// уровни вне контекста (не превращаются в изомеры по букве); 28Si —
// резонанс и IAS; 98Y — полная цепочка m,n,p,q,r,x (x — изомер
// 6-го порядка). Политика неопределённостей аудита R4 (C1): точечное
// правило R3 УДАЛЕНО — приближения «~v», измеренные значения без
// опубликованной σ и оценки «v#» НЕ получают искусственной
// неопределённости и НЕ исключаются точечным предположением:
// отсутствие σ — отсутствие информации о неопределённости,
// номинал не доказывает положения истинного T1/2 относительно
// интервала якоря (not_verifiable: unresolved_approx /
// unresolved_no_sigma / unresolved_estimated); ground/isomer-состояние
// без собственного T1/2 — no_half_life_unresolved; стабильное
// состояние — stable_state_present. Исключение обосновано ТОЛЬКО
// опубликованными данными: непересечение 1σ-интервалов (у обеих строк
// есть σ) — interval_disjoint; верхний предел ниже нижней границы
// интервала якоря — upper_limit_excluded.
//
// Строгий парсер (C3): обрезанные, повреждённые и дублирующиеся записи
// НЕ теряются молча — каждая попадает в диагностику с номером строки
// и причиной; пустое поле массы НЕ трактуется как измеренная масса
// (регрессионный тест 181Pbm); предел в позиции dT при пустом поле T
// (аномалия файла: 85Tc «<110ns», 18B «<26 ns») разбирается как
// собственный T1/2; неподдерживаемая единица — предупреждение
// unsupported_unit без потери строки.
//
// Происхождение входа (C4): SHA-256 ФАКТИЧЕСКОГО входного текста
// вычисляется при каждом запуске (computeNubaseAuditTextSha256) и
// сверяется с SHA-256 локально проверенной копии официального файла
// (NUBASE2020_VERIFIED_SOURCE_SHA256); синтетические фрагменты
// получают sourceVerification 'unverified' и НЕ имитируют проверку
// полного официального файла.

import { describe, it, expect } from 'vitest';
import {
  NUBASE2020_BIBLIOGRAPHY,
  NUBASE2020_VERIFIED_SOURCE_SHA256,
  NUBASE2020_VERIFIED_SOURCE_BYTES,
  NUBASE2020_SOURCE_RETRIEVED_AT,
  NUBASE_AUDIT_PARSER_VERSION,
  NUBASE_AUDIT_RANKED_ELEMENTS,
  NUBASE_AUDIT_UNIT_SECONDS,
  nubaseAuditUnitSeconds,
  computeNubaseAuditTextSha256,
  parseNubaseAuditLine,
  parseNubaseAuditText,
  auditNubaseElement,
  auditNubaseText,
  NubaseAuditParseError
} from '../Data/nubaseAudit';
import type { NubaseAuditRow } from '../Data/nubaseAudit';

// Фикстуры — ДОСЛОВНЫЕ строки официального ASCII-файла NUBASE2020
// (сгенерированы из локально проверенной копии файла построчно;
// SHA-256 копии — NUBASE2020_VERIFIED_SOURCE_SHA256).
// 92Tc: ground, m, n, p — контрольный пример шапки NUBASE2020:
// p — дополнительное изомерное состояние (в группе есть m и n).
const NUBASE_92TC_LINES: readonly string[] = [
  '092 0430   92Tc   -78926          3                                     4.25   m 0.15   (8)+          12          1964 B+=100',
  '092 0431   92Tc m -78656          3         270.09       0.08           1.03  us 0.06   (4+)          12          1976 IT=100',
  '092 0432   92Tc n -78397          3         529.42       0.13          <0.1   us        (3+)          12          1976 IT=100',
  '092 0433   92Tc p -78215          3         711.33       0.15          <0.1   us        1+            12          1976 IT=100',
];
// 205Po: ground, m, n, p, q — p и q дополнительные изомеры (в группе m, n, p).
const NUBASE_205PO_LINES: readonly string[] = [
  '205 0840   205Po  -17521         10                                     1.74   h 0.08   5/2-*         20          1951 B+=99.960 12;A=0.040 12',
  '205 0841   205Pom -17378         10         143.166      0.015        310     ns 60     1/2-          20          1960 IT=100',
  '205 0842   205Pon -16641         10         880.31       0.04         645     us 20     13/2+         20          1962 IT=100',
  '205 0843   205Pop -16060         10        1461.21       0.21          57.4   ms 0.9    19/2-         20          1973 IT=100',
  '205 0844   205Poq -14434         10        3087.2        0.4          115     ns 10     29/2-         20          1985 IT=100',
];
// 183Au: ground, m (нижний предел >1 us), p — уровень: в группе нет (2, n).
const NUBASE_183AU_LINES: readonly string[] = [
  '183 0790   183Au  -30191          9                                    42.8    s 1.0    5/2-*         16          1968 B+=99.45 25;A=0.55 25',
  '183 0791   183Aum -30118          9          73.10       0.01          >1     us        (1/2)+        16          1984 IT=100',
  '183 0793   183Aup -29960          9         230.6        0.6           <1     us        (11/2)-       16          1984 IT=100',
];
// 255No: ground (измеренный), m (оценка 1# s — не наблюдавшаяся),
// p — уровень (нет (2, n)) с нижним пределом >100 ns.
const NUBASE_255NO_LINES: readonly string[] = [
  '255 1020   255No   86812         14                                     3.52   m 0.18   (1/2+)        13          1967 B+=70 5;A=30 5',
  '255 1021   255Nom  87020#       100#        210#       100#             1#     s        11/2-#                         IT ?; A ?',
  '255 1023   255Nop  86910#        70#        100#        70#      Nm  >100     ns        7/2+#                          IT ?',
];
// 28Si: ground (stbl), r — резонанс, i и j — IAS (у i измеренный 1.5 fs).
const NUBASE_28SI_LINES: readonly string[] = [
  '028 0140   28Si   -21492.7971     0.0005                              stbl              0+            13          1920 IS=92.2545 37',
  '028 0145   28Si r  -8951.75       0.05    12541.04       0.05    RQ                     (3+)          13               ',
  '028 0148   28Si i -12176.88       0.10     9315.92       0.10           1.5   fs 0.6    3+      T=1   13               ',
  '028 0149   28Si j  -6265.8        1.0     15227          1                              (0+)    T=2   13          1968 A=90 11;p=10 11',
];
// 98Y: полная цепочка m, n, p, q, r, x — x изомер 6-го порядка.
const NUBASE_98Y_LINES: readonly string[] = [
  '098 0390   98Y    -72289          8                                   548     ms 2      0-*           20          1970 B-=100;B-n=0.33 3',
  '098 0391   98Y  m -72118          8         170.78       0.05         615     ns 8      2-            20          1972 IT=100',
  '098 0392   98Y  n -71823          8         465.7        0.7     MD     2.32   s 0.08   (6,7)+        20          1977 B-~100;IT ?;B-n=3.44 95',
  '098 0393   98Y  p -71793          8         496.10       0.11           6.90  us 0.054  (4)-          20          1970 IT=100',
  '098 0394   98Y  q -71695         13         594         10            180     ns 7      (3-,4-)                   2017 IT=100',
  '098 0395   98Y  r -71317          8         972.17       0.20         450     ns 150    (8+)          20          2017 IT=100',
  '098 0396   98Y  x -71108          8        1181.50       0.18         762     ns 14     (10-)         20          1972 IT=100',
];
// 234Ac: ground, m (нижний предел >93 s), n (измеренный 180 s).
const NUBASE_234AC_LINES: readonly string[] = [
  '234 0890   234Ac   44841         14                                    45      s 2      1+#           07          1986 B-=100',
  '234 0891   234Acm  44980         30         140         30            >93      s                                  2008 B- ?;IT ?',
  '234 0892   234Acn  45460         30         620         30            180      s 70                               2008 B- ?;IT ?',
];
// 97Tc 4.21(16) My и 98Tc 4.2(3) My — перекрывающиеся 1σ-интервалы якоря и конкурента.
const NUBASE_97TC_LINE =
  '097 0430   97Tc   -87224          4                                     4.21  My 0.16   9/2+*         10          1946 EC=100';
const NUBASE_98TC_LINE =
  '098 0430   98Tc   -86432          3                                     4.2   My 0.3    6+*           20          1955 B-=100;B+=0';
// 206Fr ~16 s (приближение без σ) против якоря 223Fr 22.00(7) m.
const NUBASE_206FR_LINE =
  '206 0870   206Fr   -1247         28                                   ~16      s        3+*           08          1964 A=88.4 33;B+=11.6 33';
const NUBASE_223FR_LINE =
  '223 0870   223Fr   18382.3        1.9                                  22.00   m 0.07   3/2-*         01          1939 B-~100;A=0.006';
// 187Pom 0.5 ms (измеренное без σ) против якоря 209Po 124(3) y.
const NUBASE_187POM_LINE =
  '187 0841   187Pom   2830         40           4         27       AD*    0.5   ms        13/2+#                    2006 A~100;B+ ?';
const NUBASE_209PO_LINE =
  '209 0840   209Po  -16366.0        1.8                                 124      y 3      1/2-*         15          1949 A=99.546 7;B+=0.454 7';
// 85Tc: предел <110 ns записан в позиции dT при пустом поле T (аномалия файла).
const NUBASE_85TC_LINE =
  '085 0430   85Tc   -45850#       400#                                             <110ns 1/2-#         14               p ?';
// 262Lr ~4 h — приближение без σ (сохранено как приблизительное).
const NUBASE_262LR_LINE =
  '262 1030   262Lr  102110#       200#                                   ~4      h                      01          1987 B+=?;SF<10;A ?';
// 11B i: метка изоспина T=3/2 в позиции dT у IAS без собственного T1/2.
const NUBASE_11BI_LINE =
  '011 0058   11B  i  21228          9       12560          9       RQ              T=3/2  1/2+,(3/2+)   12          1963 ';
// 3Li: p-unst (предсказанно нестабилен) с оценённой массой (#).
const NUBASE_3LI_LINE =
  '003 0030   3Li     28670#      2000#                                  p-unst            3/2-#         98               p ?';
// 243Npp: масса без # (наблюдавшийся уровень без собственного T1/2); 83Tc: масса оценена, без T1/2.
const NUBASE_243NPP_LINE =
  '243 0933   243Npp  59926         10         120#        30#      Nm                     5/2-#               ';
const NUBASE_83TC_LINE =
  '083 0430   83Tc   -31320#       500#                                                    1/2-#                          p ?;B+ ?;B+p ?';
// Строка заголовка файла (не запись данных).
const NUBASE_HEADER_LINE =
  '# Nubase2020 citation: F.G. Kondev, M. Wang, W.J. Huang, S. Naimi, and G. Audi, Chin. Phys. C45, 030001 (2021)';
// 87Tcm: наблюдавшийся изомер с ОЦЕНЁННЫМ систематикой T1/2 «2# s» —
// номинал без опубликованной числовой σ не доказывает неконкурентность
// (аудит R4, причина unresolved_estimated).
const NUBASE_87TCM_LINE =
  '087 0431   87Tc m -57683          4           7          1         *    2#     s        1/2-#                          B+ ?;IT ?';
// 250Bk: ground, m, n (измеренные с σ) и p — наблюдавшийся дополнительный
// изомер БЕЗ собственного T1/2 (аудит R4, причина no_half_life_unresolved);
// якорь группы — 247Bk 1.38(25) ky.
const NUBASE_250BK_LINES: readonly string[] = [
  '247 0970   247Bk   65490          5                                     1.38  ky 0.25   3/2-          15          1965 A~100;SF ?',
  '250 0970   250Bk   72952.0        2.9                                   3.212  h 0.005  2-            01          1954 B-=100',
  '250 0971   250Bkm  72987.6        2.9        35.59       0.10          29     us 1      4+            01          1966 IT=100',
  '250 0972   250Bkn  73038          3          85.6        1.6          213     us 8      7+            01          1972 IT=100',
  '250 0973   250Bkp  73163.8        2.9       211.80       0.20                           2+            01               IT=100',
];
// 181Pbm: масса НЕ опубликована (поле пустое), энергия возбуждения
// non-exist, собственного T1/2 нет — единственная строка файла, чья
// наблюдаемость изменилась при исправлении дефекта пустого поля массы
// (аудит R4, C3): пустое поле массы НЕ трактуется как измеренная масса.
// Дословная строка: 119 символов, 25 хвостовых пробелов.
const NUBASE_181PBM_LINE =
  '181 0821   181Pbm                          non-exist             RN                     13/2+#                         ';
// 18B: верхний предел <26 ns записан в позиции dT при пустом поле T —
// с пробелом между значением и единицей (аудит R4, C3).
const NUBASE_18B_LINE =
  '018 0050   18B     51790        200                                              <26 ns (2-)          16          2010 n=100';
// 129Prm: ОЦЕНЁННОЕ систематикой «26#» с ОПУБЛИКОВАННОЙ σ оценки «11#»
// в dT — kind estimated, halfLifeSigma 11 (σ оценки публикуется файлом).
const NUBASE_129PRM_LINE =
  '129 0591   129Prm -69390         30         382.57       0.24          26#    us 11#    (11/2-)       14          1997 IT=100';
// 134Pmm: приближение ~5 s; Isom.Unc «*» И Isom.Inv «&» в одной строке —
// оба признака сохраняются отдельно и в ранжировании не используются.
const NUBASE_134PMM_LINE =
  '134 0611   134Pmm -66710#        60#         50#        50#        *&  ~5      s        (2+)          04          1988 B+=100';
// 206Frm: второй член пары 206Fr/206Frm ~16 s — приближение без σ (аудит R4, C1, Z=87).
const NUBASE_206FRM_LINE =
  '206 0871   206Frm  -1048         28         200         40       IT   ~16      s        7+*           08          1964 A=84.7 15;B+ ?;IT ?';
// 216Acn ~300 ns (приближение без σ, Z=89) и 218Acm >100# ns (оценка
// систематики: «#» определяет вид записи — estimated, Z=89).
const NUBASE_216ACN_LINE =
  '216 0892   216Acn   8570#       100#        422#       100#          ~300     ns                      07          2006 IT=100';
const NUBASE_218ACM_LINE =
  '218 0891   218Acm  10900         90          50         70         * >100#    ns        8-#                            IT ?;A ?;B+ ?';
// 237Cm >10# m (оценка систематики) и 244Cmn >500 ns (нижний предел) — Z=96.
const NUBASE_237CM_LINE =
  '237 0960   237Cm   49250         70                                   >10#     m        5/2+#         06          2002 B+ ?;A=?';
const NUBASE_244CMN_LINE =
  '244 0962   244Cmn  59550#       900#       1100#       900#          >500     ns                      17          1969 SF~100;IT ?';
// 249Cmm 23 us и 249Bkm 300 us — ИЗМЕРЕННЫЕ значения БЕЗ опубликованной σ
// (Z=96 и Z=97): отсутствие σ — отсутствие информации, а не нулевая σ.
const NUBASE_249CMM_LINE =
  '249 0961   249Cmm  70799.5        2.4        48.76       0.04          23     us        7/2+          11          1966 A=100';
const NUBASE_249BKM_LINE =
  '249 0971   249Bkm  69855.1        1.2         8.777      0.014        300     us        3/2-          11          1960 IT=100';
// 244Amp ~6.5 us — приближение без σ (аудит R4, C1, Z=95).
const NUBASE_244AMP_LINE =
  '244 0953   244Amp  62080#       200#       2200#       200#            ~6.5   us                      17          1969 SF~100;IT ?';

function rowsOf(lines: readonly string[]): readonly NubaseAuditRow[] {
  return parseNubaseAuditText(lines.join('\n')).rows;
}

function parseOrThrow(line: string): NubaseAuditRow {
  const row = parseNubaseAuditLine(line);
  if (row === null) {
    throw new Error('строка NUBASE2020 должна разбираться: ' + line.slice(0, 20));
  }
  return row;
}

function reportOrThrow(z: number, lines: readonly string[]): ReturnType<typeof auditNubaseElement> {
  return auditNubaseElement(z, rowsOf(lines));
}

function anchorOrThrow(report: ReturnType<typeof auditNubaseElement>): NubaseAuditRow {
  if (report.anchor === null) {
    throw new Error('в отчёте аудита должен быть якорь');
  }
  return report.anchor;
}

// Замена полей T/unit/dT (колонки 70-88 шапки NUBASE2020) в дословной
// строке файла для синтетических граничных тестов политики R4.
function replaceHalfLife(line: string, t: string, unit: string, dT: string): string {
  return line.slice(0, 69) + t.padStart(9) + unit.padEnd(2) + ' ' + dT.padStart(7) + line.slice(88);
}

describe('Stage 4.3.3 (аудит R4): парсер фиксированных колонок NUBASE2020', () => {
  it('205Po (ground): A, Z, i, s, обозначение, измеренный T1/2 1.74 h со σ 0.08, SI-секунды', () => {
    const row = parseOrThrow(NUBASE_205PO_LINES[0]);
    expect(row.massNumber).toBe(205);
    expect(row.atomicNumber).toBe(84);
    expect(row.stateIndex).toBe(0);
    expect(row.stateCode).toBe('');
    expect(row.notation).toBe('205Po');
    expect(row.halfLifeKind).toBe('measured');
    expect(row.halfLifeRaw).toBe('1.74');
    expect(row.halfLifeUnit).toBe('h');
    expect(row.halfLifeValue).toBe(1.74);
    expect(row.halfLifeSigma).toBe(0.08);
    expect(row.halfLifeSeconds).toBeCloseTo(6264, 6);
    expect(row.massEstimated).toBe(false);
    expect(row.excitationPresent).toBe(false);
    expect(row.excitationEstimated).toBe(false);
    expect(row.orderingUncertain).toBe(false);
    expect(row.observed).toBe(true);
  });

  it('признак # (систематика): 255Nom 1# s — не наблюдавшаяся строка; 83Tc — только оценённая масса', () => {
    const m = parseOrThrow(NUBASE_255NO_LINES[1]);
    expect(m.stateIndex).toBe(1);
    expect(m.stateCode).toBe('m');
    expect(m.notation).toBe('255No');
    expect(m.halfLifeKind).toBe('estimated');
    expect(m.halfLifeRaw).toBe('1#');
    expect(m.halfLifeUnit).toBe('s');
    expect(m.halfLifeValue).toBe(1);
    expect(m.halfLifeSigma).toBeNull();
    expect(m.massEstimated).toBe(true);
    expect(m.excitationPresent).toBe(true);
    expect(m.excitationEstimated).toBe(true);
    expect(m.observed).toBe(false);
    const tc83 = parseOrThrow(NUBASE_83TC_LINE);
    expect(tc83.halfLifeKind).toBe('none');
    expect(tc83.halfLifeRaw).toBe('');
    expect(tc83.halfLifeSeconds).toBeNull();
    expect(tc83.massEstimated).toBe(true);
    expect(tc83.excitationPresent).toBe(false);
    expect(tc83.observed).toBe(false);
  });

  it('признаки ~ и пределов: 262Lr ~4 h (приближение, σ нет), 234Acm >93 s, 92Tcn <0.1 us', () => {
    const lr = parseOrThrow(NUBASE_262LR_LINE);
    expect(lr.stateIndex).toBe(0);
    expect(lr.notation).toBe('262Lr');
    expect(lr.halfLifeKind).toBe('approx');
    expect(lr.halfLifeRaw).toBe('~4');
    expect(lr.halfLifeUnit).toBe('h');
    expect(lr.halfLifeValue).toBe(4);
    expect(lr.halfLifeSigma).toBeNull();
    expect(lr.halfLifeSeconds).toBe(14400);
    expect(lr.observed).toBe(true);
    expect(lr.massEstimated).toBe(true);
    const acm = parseOrThrow(NUBASE_234AC_LINES[1]);
    expect(acm.stateIndex).toBe(1);
    expect(acm.stateCode).toBe('m');
    expect(acm.notation).toBe('234Ac');
    expect(acm.halfLifeKind).toBe('lower_limit');
    expect(acm.halfLifeRaw).toBe('>93');
    expect(acm.halfLifeUnit).toBe('s');
    expect(acm.halfLifeValue).toBe(93);
    expect(acm.halfLifeSeconds).toBe(93);
    expect(acm.halfLifeSigma).toBeNull();
    expect(acm.observed).toBe(true);
    const tcn = parseOrThrow(NUBASE_92TC_LINES[2]);
    expect(tcn.stateIndex).toBe(2);
    expect(tcn.stateCode).toBe('n');
    expect(tcn.halfLifeKind).toBe('upper_limit');
    expect(tcn.halfLifeRaw).toBe('<0.1');
    expect(tcn.halfLifeUnit).toBe('us');
    expect(tcn.halfLifeValue).toBeCloseTo(0.1, 12);
    expect(tcn.halfLifeSeconds).toBeCloseTo(1e-7, 12);
    expect(tcn.halfLifeSigma).toBeNull();
  });

  it('аномалия файла: предел в позиции dT при пустом поле T — 85Tc <110ns; 18B <26 ns (с пробелом)', () => {
    const tc85 = parseOrThrow(NUBASE_85TC_LINE);
    expect(tc85.massNumber).toBe(85);
    expect(tc85.atomicNumber).toBe(43);
    expect(tc85.stateIndex).toBe(0);
    expect(tc85.stateCode).toBe('');
    expect(tc85.halfLifeKind).toBe('upper_limit');
    expect(tc85.halfLifeRaw).toBe('<110');
    expect(tc85.halfLifeUnit).toBe('ns');
    expect(tc85.halfLifeValue).toBe(110);
    expect(tc85.halfLifeSeconds).toBeCloseTo(1.1e-7, 12);
    expect(tc85.halfLifeSigma).toBeNull();
    expect(tc85.massEstimated).toBe(true);
    expect(tc85.excitationPresent).toBe(false);
    expect(tc85.observed).toBe(true);
    // 18B: «<26 ns» — предел в позиции dT с пробелом между значением и единицей
    const b18 = parseOrThrow(NUBASE_18B_LINE);
    expect(b18.massNumber).toBe(18);
    expect(b18.atomicNumber).toBe(5);
    expect(b18.stateIndex).toBe(0);
    expect(b18.stateCode).toBe('');
    expect(b18.notation).toBe('18B');
    expect(b18.halfLifeKind).toBe('upper_limit');
    expect(b18.halfLifeRaw).toBe('<26');
    expect(b18.halfLifeUnit).toBe('ns');
    expect(b18.halfLifeValue).toBe(26);
    expect(b18.halfLifeSeconds).toBeCloseTo(2.6e-8, 12);
    expect(b18.halfLifeSigma).toBeNull();
    expect(b18.halfLifeUncFieldRaw.trim()).toBe('<26 ns');
    expect(b18.observed).toBe(true);
    const nop = parseOrThrow(NUBASE_255NO_LINES[2]);
    expect(nop.stateIndex).toBe(3);
    expect(nop.stateCode).toBe('p');
    expect(nop.halfLifeKind).toBe('lower_limit');
    expect(nop.halfLifeRaw).toBe('>100');
    expect(nop.halfLifeUnit).toBe('ns');
    expect(nop.halfLifeSeconds).toBeCloseTo(1e-7, 12);
    expect(nop.observed).toBe(true);
  });

  it('не-T1/2 записи: метка изоспина T=3/2 не парсится как T1/2; stbl/p-unst; заголовки дают null', () => {
    const bi11 = parseOrThrow(NUBASE_11BI_LINE);
    expect(bi11.stateIndex).toBe(8);
    expect(bi11.stateCode).toBe('i');
    expect(bi11.halfLifeKind).toBe('none');
    expect(bi11.halfLifeRaw).toBe('');
    expect(bi11.halfLifeSeconds).toBeNull();
    expect(bi11.halfLifeSigma).toBeNull();
    expect(bi11.massEstimated).toBe(false);
    expect(bi11.excitationPresent).toBe(true);
    expect(bi11.excitationEstimated).toBe(false);
    expect(bi11.observed).toBe(true);
    const sir = parseOrThrow(NUBASE_28SI_LINES[1]);
    expect(sir.stateIndex).toBe(5);
    expect(sir.stateCode).toBe('r');
    expect(sir.halfLifeKind).toBe('none');
    expect(sir.halfLifeSeconds).toBeNull();
    expect(sir.observed).toBe(true);
    const li = parseOrThrow(NUBASE_3LI_LINE);
    expect(li.halfLifeKind).toBe('predicted_unstable');
    expect(li.halfLifeRaw).toBe('p-unst');
    expect(li.halfLifeSeconds).toBeNull();
    expect(li.massEstimated).toBe(true);
    expect(li.observed).toBe(false);
    expect(parseNubaseAuditLine(NUBASE_HEADER_LINE)).toBeNull();
    expect(parseNubaseAuditLine('')).toBeNull();
    expect(parseNubaseAuditLine('не запись данных NUBASE2020')).toBeNull();
  });

  it('наблюдаемость (правило 1): 243Npp наблюдался (масса без #), 83Tc — систематическая экстраполяция', () => {
    const npp = parseOrThrow(NUBASE_243NPP_LINE);
    expect(npp.stateIndex).toBe(3);
    expect(npp.stateCode).toBe('p');
    expect(npp.halfLifeKind).toBe('none');
    expect(npp.halfLifeSeconds).toBeNull();
    expect(npp.massEstimated).toBe(false);
    expect(npp.excitationPresent).toBe(true);
    expect(npp.excitationEstimated).toBe(true);
    expect(npp.observed).toBe(true);
    const tc83 = parseOrThrow(NUBASE_83TC_LINE);
    expect(tc83.observed).toBe(false);
  });

  it('181Pbm — регрессия пустого поля массы (C3): non-exist не даёт наблюдаемости', () => {
    // дословная строка файла: 119 символов, 25 хвостовых пробелов
    expect(NUBASE_181PBM_LINE).toHaveLength(119);
    const pbm = parseOrThrow(NUBASE_181PBM_LINE);
    expect(pbm.massNumber).toBe(181);
    expect(pbm.atomicNumber).toBe(82);
    expect(pbm.stateIndex).toBe(1);
    expect(pbm.stateCode).toBe('m');
    expect(pbm.notation).toBe('181Pb');
    // масса НЕ опубликована: пустое поле — отсутствие данных, а не измерение
    expect(pbm.massValid).toBe(false);
    expect(pbm.massEstimated).toBe(false);
    // энергия возбуждения non-exist: состояние не существует как связанное
    expect(pbm.excitationPresent).toBe(false);
    expect(pbm.excitationEstimated).toBe(false);
    expect(pbm.excitationNonExist).toBe(true);
    expect(pbm.halfLifeKind).toBe('none');
    expect(pbm.halfLifeSeconds).toBeNull();
    // наблюдаемость — ТОЛЬКО по валидным опубликованным данным
    expect(pbm.observed).toBe(false);
  });

  it('Isom.Unc «*» и Isom.Inv «&» сохраняются отдельно: 134Pmm, 218Acm, 187Pom', () => {
    const pmm = parseOrThrow(NUBASE_134PMM_LINE);
    expect(pmm.stateIndex).toBe(1);
    expect(pmm.stateCode).toBe('m');
    expect(pmm.notation).toBe('134Pm');
    expect(pmm.halfLifeKind).toBe('approx');
    expect(pmm.halfLifeRaw).toBe('~5');
    expect(pmm.halfLifeUnit).toBe('s');
    expect(pmm.halfLifeValue).toBe(5);
    expect(pmm.halfLifeSigma).toBeNull();
    expect(pmm.orderingUncertain).toBe(true);
    expect(pmm.orderingInverted).toBe(true);
    expect(pmm.observed).toBe(true);
    const acm = parseOrThrow(NUBASE_218ACM_LINE);
    expect(acm.stateCode).toBe('m');
    expect(acm.orderingUncertain).toBe(true);
    expect(acm.orderingInverted).toBe(false);
    const pom = parseOrThrow(NUBASE_187POM_LINE);
    expect(pom.orderingUncertain).toBe(true);
    expect(pom.orderingInverted).toBe(false);
  });

  it('оценка систематики с опубликованной σ оценки: 129Prm 26# us, σ 11#', () => {
    const prm = parseOrThrow(NUBASE_129PRM_LINE);
    expect(prm.stateIndex).toBe(1);
    expect(prm.stateCode).toBe('m');
    expect(prm.notation).toBe('129Pr');
    expect(prm.halfLifeKind).toBe('estimated');
    expect(prm.halfLifeRaw).toBe('26#');
    expect(prm.halfLifeUnit).toBe('us');
    expect(prm.halfLifeValue).toBe(26);
    // σ ОЦЕНКИ публикуется файлом («11#» в dT) — это не выдуманная σ
    expect(prm.halfLifeSigma).toBe(11);
    expect(prm.massValid).toBe(true);
    expect(prm.observed).toBe(true);
  });

  it('пределы и оценки Z=89/Z=96: 218Acm >100# ns (estimated), 216Acn ~300 ns (approx), 237Cm >10# m, 244Cmn >500 ns', () => {
    const acm = parseOrThrow(NUBASE_218ACM_LINE);
    expect(acm.halfLifeKind).toBe('estimated');
    expect(acm.halfLifeRaw).toBe('>100#');
    expect(acm.halfLifeUnit).toBe('ns');
    expect(acm.halfLifeValue).toBe(100);
    expect(acm.halfLifeSigma).toBeNull();
    expect(acm.observed).toBe(true);
    const acn = parseOrThrow(NUBASE_216ACN_LINE);
    expect(acn.halfLifeKind).toBe('approx');
    expect(acn.halfLifeRaw).toBe('~300');
    expect(acn.halfLifeUnit).toBe('ns');
    expect(acn.halfLifeSeconds).toBeCloseTo(3e-7, 12);
    expect(acn.halfLifeSigma).toBeNull();
    expect(acn.massEstimated).toBe(true);
    expect(acn.observed).toBe(true);
    const cm237 = parseOrThrow(NUBASE_237CM_LINE);
    expect(cm237.halfLifeKind).toBe('estimated');
    expect(cm237.halfLifeRaw).toBe('>10#');
    expect(cm237.halfLifeUnit).toBe('m');
    expect(cm237.halfLifeValue).toBe(10);
    expect(cm237.massValid).toBe(true);
    expect(cm237.observed).toBe(true);
    const cmn244 = parseOrThrow(NUBASE_244CMN_LINE);
    expect(cmn244.halfLifeKind).toBe('lower_limit');
    expect(cmn244.halfLifeRaw).toBe('>500');
    expect(cmn244.halfLifeUnit).toBe('ns');
    expect(cmn244.massEstimated).toBe(true);
    expect(cmn244.observed).toBe(true);
  });

  it('строки R4-C1: 206Fr/206Frm ~16 s и 244Amp ~6.5 us — приближения без σ; 249Cmm/249Bkm — измеренные без σ', () => {
    const fr = parseOrThrow(NUBASE_206FR_LINE);
    const frm = parseOrThrow(NUBASE_206FRM_LINE);
    for (const r of [fr, frm]) {
      expect(r.halfLifeKind).toBe('approx');
      expect(r.halfLifeRaw).toBe('~16');
      expect(r.halfLifeUnit).toBe('s');
      expect(r.halfLifeValue).toBe(16);
      expect(r.halfLifeSigma).toBeNull();
      expect(r.observed).toBe(true);
    }
    expect(fr.stateIndex).toBe(0);
    expect(frm.stateIndex).toBe(1);
    expect(frm.stateCode).toBe('m');
    const amp = parseOrThrow(NUBASE_244AMP_LINE);
    expect(amp.stateIndex).toBe(3);
    expect(amp.stateCode).toBe('p');
    expect(amp.notation).toBe('244Am');
    expect(amp.halfLifeKind).toBe('approx');
    expect(amp.halfLifeRaw).toBe('~6.5');
    expect(amp.halfLifeUnit).toBe('us');
    expect(amp.halfLifeValue).toBeCloseTo(6.5, 12);
    expect(amp.halfLifeSigma).toBeNull();
    expect(amp.observed).toBe(true);
    const cmm = parseOrThrow(NUBASE_249CMM_LINE);
    expect(cmm.stateIndex).toBe(1);
    expect(cmm.stateCode).toBe('m');
    expect(cmm.halfLifeKind).toBe('measured');
    expect(cmm.halfLifeRaw).toBe('23');
    expect(cmm.halfLifeUnit).toBe('us');
    expect(cmm.halfLifeValue).toBe(23);
    expect(cmm.halfLifeSeconds).toBeCloseTo(23e-6, 15);
    // измеренное значение БЕЗ опубликованной σ: σ не выдумывается
    expect(cmm.halfLifeSigma).toBeNull();
    expect(cmm.observed).toBe(true);
    const bkm = parseOrThrow(NUBASE_249BKM_LINE);
    expect(bkm.halfLifeKind).toBe('measured');
    expect(bkm.halfLifeRaw).toBe('300');
    expect(bkm.halfLifeUnit).toBe('us');
    expect(bkm.halfLifeSigma).toBeNull();
    expect(bkm.observed).toBe(true);
  });
});

describe('Stage 4.3.3 (аудит R4): fail-closed диагностика строгого парсера (C3)', () => {
  it('обрезанная строка (менее 75 символов) — too_short, запись не теряется молча', () => {
    const text = NUBASE_205PO_LINES[0].slice(0, 40);
    const r = parseNubaseAuditText(text);
    expect(r.lineStats).toEqual({
      totalLines: 1,
      nonDataLines: 0,
      dataLines: 1,
      parsedRows: 0,
      malformedRows: 1,
      duplicateRows: 0
    });
    expect(r.rows).toHaveLength(0);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].kind).toBe('too_short');
    expect(r.diagnostics[0].lineNumber).toBe(1);
    expect(r.diagnostics[0].reason).toContain('40');
    expect(r.diagnostics[0].sourceLine).toBe(text);
  });

  it('повреждённое поле AAA — malformed_aaa; заголовок — не запись данных', () => {
    const bad =
      '09A 0430   92Tc   -78926          3                                     4.25   m 0.15   (8)+          12          1964 B+=100';
    const r = parseNubaseAuditText([NUBASE_HEADER_LINE, bad].join('\n'));
    expect(r.lineStats.totalLines).toBe(2);
    expect(r.lineStats.nonDataLines).toBe(1);
    expect(r.lineStats.dataLines).toBe(1);
    expect(r.lineStats.parsedRows).toBe(0);
    expect(r.lineStats.malformedRows).toBe(1);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].kind).toBe('malformed_aaa');
    expect(r.diagnostics[0].lineNumber).toBe(2);
    expect(r.diagnostics[0].sourceLine).toBe(bad);
  });

  it('рассогласованный код состояния (i=0 с «m») — malformed_state_code', () => {
    const bad = NUBASE_205PO_LINES[0].slice(0, 16) + 'm' + NUBASE_205PO_LINES[0].slice(17);
    const r = parseNubaseAuditText(bad);
    expect(r.lineStats.parsedRows).toBe(0);
    expect(r.lineStats.malformedRows).toBe(1);
    expect(r.diagnostics[0].kind).toBe('malformed_state_code');
    expect(r.diagnostics[0].reason).toContain('i=0');
  });

  it('повреждённое поле массы — malformed_mass_field', () => {
    const bad = NUBASE_205PO_LINES[0].slice(0, 18) + 'zz' + NUBASE_205PO_LINES[0].slice(20);
    const r = parseNubaseAuditText(bad);
    expect(r.lineStats.parsedRows).toBe(0);
    expect(r.diagnostics[0].kind).toBe('malformed_mass_field');
  });

  it('повреждённое поле T1/2 — malformed_half_life_field', () => {
    const bad = NUBASE_205PO_LINES[0].slice(0, 69) + 'x' + NUBASE_205PO_LINES[0].slice(70);
    const r = parseNubaseAuditText(bad);
    expect(r.lineStats.parsedRows).toBe(0);
    expect(r.diagnostics[0].kind).toBe('malformed_half_life_field');
  });

  it('дубликат (Z, A, i, s) — duplicate_record: разбирается один раз, дубль диагностируется', () => {
    const r = parseNubaseAuditText([NUBASE_205PO_LINES[0], NUBASE_205PO_LINES[0]].join('\n'));
    expect(r.lineStats).toEqual({
      totalLines: 2,
      nonDataLines: 0,
      dataLines: 2,
      parsedRows: 1,
      malformedRows: 0,
      duplicateRows: 1
    });
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].kind).toBe('duplicate_record');
    expect(r.diagnostics[0].lineNumber).toBe(2);
    expect(r.diagnostics[0].reason).toContain('nubase2020:Z=084,A=205,i=0,s=');
    // дубликат не участвует в аудите дважды
    const report = auditNubaseElement(84, r.rows);
    expect(report.observedRows).toBe(1);
  });

  it('неподдерживаемая единица — предупреждение unsupported_unit, строка сохраняется', () => {
    const bad = NUBASE_205PO_LINES[0].slice(0, 78) + 'qz' + NUBASE_205PO_LINES[0].slice(80);
    const r = parseNubaseAuditText(bad);
    expect(r.lineStats.parsedRows).toBe(1);
    expect(r.lineStats.malformedRows).toBe(0);
    expect(r.rows[0].halfLifeUnit).toBe('qz');
    expect(r.rows[0].halfLifeSeconds).toBeNull();
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].kind).toBe('unsupported_unit');
    // в аудите против валидного якоря — причина unresolved_unit, полнота не доказуема
    const synthetic = replaceHalfLife(NUBASE_187POM_LINE, '0.5', 'qz', '');
    const rows = rowsOf([synthetic, NUBASE_209PO_LINE]);
    const report = auditNubaseElement(84, rows);
    expect(report.completeness).toBe('not_verifiable');
    expect(report.reasons.map((x) => x.kind)).toContain('unresolved_unit');
  });

  it('parseNubaseAuditLine выбрасывает NubaseAuditParseError с человекочитаемой диагностикой', () => {
    let error: unknown = null;
    try {
      parseNubaseAuditLine('09A 0430');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(NubaseAuditParseError);
    const diagnostic = (error as NubaseAuditParseError).diagnostic;
    expect(diagnostic.kind).toBe('too_short');
    expect(diagnostic.lineNumber).toBe(1);
    expect(diagnostic.sourceLine).toBe('09A 0430');
    expect((error as Error).message).toContain('too_short');
    expect((error as Error).message).toContain('строка 1');
  });
});

describe('Stage 4.3.3 (аудит R4): группы (Z, A) и контекстная классификация состояний', () => {
  it('92Tc — контрольный пример шапки NUBASE2020: p — ДОПОЛНИТЕЛЬНЫЙ изомер при (1, m) и (2, n) в группе', () => {
    const r = reportOrThrow(43, NUBASE_92TC_LINES);
    expect(r.observedRows).toBe(4);
    expect(r.grounds).toBe(1);
    expect(r.standardIsomers).toBe(2);
    expect(r.additionalIsomers).toBe(1);
    expect(r.levels).toBe(0);
    expect(r.resonances).toBe(0);
    expect(r.ias).toBe(0);
    expect(r.indeterminate).toBe(0);
    expect(r.completeness).toBe('complete');
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('92Tc');
    expect(anchor.stateIndex).toBe(0);
    expect(anchor.halfLifeRaw).toBe('4.25');
    expect(anchor.halfLifeUnit).toBe('m');
    expect(anchor.halfLifeValue).toBe(4.25);
    expect(anchor.halfLifeSigma).toBe(0.15);
    expect(anchor.halfLifeSeconds).toBe(255);
    expect(r.candidates).toHaveLength(1);
    // m: измеренный с σ, 1σ-интервал не пересекается с якорем — interval_disjoint;
    // n и p: верхние пределы <0.1 us ниже нижней границы якоря — upper_limit_excluded
    expect(r.reasons).toHaveLength(3);
    expect(r.reasons.map((x) => x.kind).sort()).toEqual([
      'interval_disjoint',
      'upper_limit_excluded',
      'upper_limit_excluded'
    ]);
    expect(r.reasons.map((x) => x.row.stateIndex).sort()).toEqual([1, 2, 3]);
    const disjoint = r.reasons.find((x) => x.kind === 'interval_disjoint');
    if (disjoint === undefined) throw new Error('нужна причина interval_disjoint для 92Tcm');
    expect(disjoint.row.stateIndex).toBe(1);
    expect(disjoint.row.halfLifeRaw).toBe('1.03');
    expect(disjoint.row.halfLifeSigma).toBe(0.06);
    for (const reason of r.reasons) {
      if (reason.kind === 'upper_limit_excluded') {
        expect(reason.row.halfLifeSeconds).toBeCloseTo(1e-7, 12);
      }
    }
  });

  it('205Po — p и q дополнительные изомеры при (1, m), (2, n), (3, p); остальные — ниже границы якоря', () => {
    const r = reportOrThrow(84, NUBASE_205PO_LINES);
    expect(r.observedRows).toBe(5);
    expect(r.grounds).toBe(1);
    expect(r.standardIsomers).toBe(2);
    expect(r.additionalIsomers).toBe(2);
    expect(r.levels).toBe(0);
    expect(r.completeness).toBe('complete');
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('205Po');
    expect(anchor.halfLifeRaw).toBe('1.74');
    expect(anchor.halfLifeUnit).toBe('h');
    expect(anchor.halfLifeSigma).toBe(0.08);
    expect(r.candidates).toHaveLength(1);
    // m, n, p, q — измеренные с σ, интервалы не пересекаются с якорем:
    // исключение обосновано опубликованными σ (interval_disjoint)
    expect(r.reasons).toHaveLength(4);
    expect(r.reasons.map((x) => x.kind).sort()).toEqual([
      'interval_disjoint',
      'interval_disjoint',
      'interval_disjoint',
      'interval_disjoint'
    ]);
    expect(r.reasons.map((x) => x.row.stateIndex).sort()).toEqual([1, 2, 3, 4]);
  });

  it('183Au — p УРОВЕНЬ (нет (2, n) в группе), не изомер и не конкурент; нижний предел m оспаривает полноту', () => {
    const r = reportOrThrow(79, NUBASE_183AU_LINES);
    expect(r.observedRows).toBe(3);
    expect(r.grounds).toBe(1);
    expect(r.standardIsomers).toBe(1);
    expect(r.additionalIsomers).toBe(0);
    expect(r.levels).toBe(1);
    expect(r.completeness).toBe('not_verifiable');
    const anchor = anchorOrThrow(r);
    expect(anchor.stateIndex).toBe(0);
    expect(anchor.halfLifeSeconds).toBeCloseTo(42.8, 9);
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('lower_limit_unbounded');
    expect(r.reasons[0].row.stateIndex).toBe(1);
    expect(r.reasons[0].row.stateCode).toBe('m');
    expect(r.reasons[0].row.halfLifeRaw).toBe('>1');
    expect(r.reasons[0].row.halfLifeUnit).toBe('us');
  });

  it('255No — уровень p с нижним пределом НЕ конкурент: полнота complete; оценка m не наблюдавшаяся', () => {
    const r = reportOrThrow(102, NUBASE_255NO_LINES);
    expect(r.observedRows).toBe(2);
    expect(r.grounds).toBe(1);
    expect(r.standardIsomers).toBe(0);
    expect(r.additionalIsomers).toBe(0);
    expect(r.levels).toBe(1);
    expect(r.completeness).toBe('complete');
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('255No');
    expect(anchor.halfLifeRaw).toBe('3.52');
    expect(anchor.halfLifeUnit).toBe('m');
    expect(anchor.halfLifeValue).toBe(3.52);
    expect(anchor.halfLifeSigma).toBe(0.18);
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(0);
    // уровень p имеет собственный нижний предел — учитывается без причин
    expect(r.nonCandidateStatesWithoutHalfLife).toBe(0);
  });

  it('28Si — резонанс r (i=5 без цепочки) и IAS i/j не кандидаты; полнота not_verifiable: stable ground без якоря', () => {
    const r = reportOrThrow(14, NUBASE_28SI_LINES);
    expect(r.observedRows).toBe(4);
    expect(r.grounds).toBe(1);
    expect(r.standardIsomers).toBe(0);
    expect(r.additionalIsomers).toBe(0);
    expect(r.levels).toBe(0);
    expect(r.resonances).toBe(1);
    expect(r.ias).toBe(2);
    // измеренного якоря нет, но стабильное ground-состояние оспаривает
    // полноту ранжирования: время жизни stbl не ограничено (аудит R4)
    expect(r.completeness).toBe('not_verifiable');
    expect(r.anchor).toBeNull();
    expect(r.candidates).toHaveLength(0);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('stable_state_present');
    expect(r.reasons[0].row.stateIndex).toBe(0);
    expect(r.reasons[0].row.halfLifeKind).toBe('stable');
    // резонанс r и IAS j без собственного T1/2 учтены явно, IAS i — с T1/2
    expect(r.nonCandidateStatesWithoutHalfLife).toBe(2);
    // IAS с измеренным T1/2 (28Si i, 1.5 fs) в отбор не попадает
    const iasRow = rowsOf(NUBASE_28SI_LINES).find((x) => x.stateIndex === 8);
    if (iasRow === undefined) throw new Error('IAS-строка 28Si i должна разбираться');
    expect(iasRow.halfLifeKind).toBe('measured');
  });

  it('98Y — полная цепочка m,n,p,q,r,x: x — изомер 6-го порядка, якорь 98Yn 2.32(8) s', () => {
    const r = reportOrThrow(39, NUBASE_98Y_LINES);
    expect(r.observedRows).toBe(7);
    expect(r.grounds).toBe(1);
    expect(r.standardIsomers).toBe(2);
    expect(r.additionalIsomers).toBe(4);
    expect(r.levels).toBe(0);
    expect(r.resonances).toBe(0);
    expect(r.completeness).toBe('complete');
    const anchor = anchorOrThrow(r);
    expect(anchor.stateIndex).toBe(2);
    expect(anchor.stateCode).toBe('n');
    expect(anchor.halfLifeRaw).toBe('2.32');
    expect(anchor.halfLifeUnit).toBe('s');
    expect(anchor.halfLifeSigma).toBe(0.08);
    expect(anchor.halfLifeSeconds).toBeCloseTo(2.32, 12);
    expect(r.candidates).toHaveLength(1);
    // ground, m, p, q, r, x — измеренные с σ, интервалы не пересекаются
    // с якорем: исключение обосновано опубликованными σ (interval_disjoint)
    expect(r.reasons).toHaveLength(6);
    expect(r.reasons.map((x) => x.kind).sort()).toEqual([
      'interval_disjoint',
      'interval_disjoint',
      'interval_disjoint',
      'interval_disjoint',
      'interval_disjoint',
      'interval_disjoint'
    ]);
    expect(r.reasons.map((x) => x.row.stateIndex).sort()).toEqual([0, 1, 3, 4, 5, 6]);
  });
});

describe('Stage 4.3.3 (аудит R4): ранжирование и статусы полноты', () => {
  it('Tc-97 4.21(16) My и Tc-98 4.2(3) My — перекрывающиеся 1σ-интервалы: 2 равноправных кандидата', () => {
    const r = auditNubaseElement(43, rowsOf([NUBASE_97TC_LINE, NUBASE_98TC_LINE]));
    expect(r.observedRows).toBe(2);
    expect(r.grounds).toBe(2);
    expect(r.completeness).toBe('complete');
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('97Tc');
    expect(anchor.halfLifeValue).toBe(4.21);
    expect(anchor.halfLifeUnit).toBe('My');
    expect(anchor.halfLifeSigma).toBe(0.16);
    expect(r.candidates.map((c) => c.notation)).toEqual(['97Tc', '98Tc']);
    const competitor = r.candidates.find((c) => c.notation === '98Tc');
    if (competitor === undefined) throw new Error('98Tc должен быть кандидатом');
    expect(competitor.halfLifeValue).toBe(4.2);
    expect(competitor.halfLifeSigma).toBe(0.3);
    expect(r.reasons).toHaveLength(0);
  });

  it('нижний предел без верхней границы: 234Acm >93 s — полнота not_verifiable', () => {
    const r = reportOrThrow(89, NUBASE_234AC_LINES);
    expect(r.completeness).toBe('not_verifiable');
    const anchor = anchorOrThrow(r);
    expect(anchor.stateIndex).toBe(2);
    expect(anchor.halfLifeValue).toBe(180);
    expect(anchor.halfLifeUnit).toBe('s');
    expect(anchor.halfLifeSigma).toBe(70);
    expect(anchor.halfLifeSeconds).toBe(180);
    expect(r.candidates).toHaveLength(1);
    // ground 45(2) s: 1σ-интервал [43, 47] s не пересекается с интервалом
    // якоря [110, 250] s — исключение обосновано опубликованными σ
    // (interval_disjoint); m >93 s — нижний предел без верхней границы
    expect(r.reasons).toHaveLength(2);
    expect(r.reasons[0].kind).toBe('interval_disjoint');
    expect(r.reasons[0].row.stateIndex).toBe(0);
    expect(r.reasons[0].row.halfLifeValue).toBe(45);
    expect(r.reasons[0].row.halfLifeSigma).toBe(2);
    expect(r.reasons[1].kind).toBe('lower_limit_unbounded');
    expect(r.reasons[1].row.stateIndex).toBe(1);
    expect(r.reasons[1].row.stateCode).toBe('m');
    expect(r.reasons[1].row.halfLifeRaw).toBe('>93');
  });

  it('приближение ~v: 206Fr ~16 s без σ НЕ исключается точкой против якоря 223Fr 22.00(7) m — полнота not_verifiable', () => {
    const rows = rowsOf([NUBASE_206FR_LINE, NUBASE_223FR_LINE]);
    const r = auditNubaseElement(87, rows);
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('223Fr');
    expect(anchor.halfLifeValue).toBe(22.0);
    expect(anchor.halfLifeUnit).toBe('m');
    expect(anchor.halfLifeSigma).toBe(0.07);
    // отсутствие σ — отсутствие информации: номинал ~16 s не принимается
    // точной точкой и не доказывает неконкурентность (аудит R4)
    expect(r.completeness).toBe('not_verifiable');
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('unresolved_approx');
    expect(r.reasons[0].row.notation).toBe('206Fr');
    expect(r.reasons[0].row.halfLifeRaw).toBe('~16');
    expect(r.reasons[0].row.halfLifeUnit).toBe('s');
    expect(r.reasons[0].row.halfLifeSeconds).toBe(16);
    // искусственная неопределённость не вводится
    expect(r.reasons[0].row.halfLifeSigma).toBeNull();
  });

  it('пара 206Fr/206Frm ~16 s (Z=87): обе строки без σ — две причины unresolved_approx, полнота not_verifiable', () => {
    const r = auditNubaseElement(
      87,
      rowsOf([NUBASE_206FR_LINE, NUBASE_206FRM_LINE, NUBASE_223FR_LINE])
    );
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('223Fr');
    expect(r.completeness).toBe('not_verifiable');
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(2);
    expect(r.reasons.map((x) => x.kind).sort()).toEqual(['unresolved_approx', 'unresolved_approx']);
    expect(r.reasons.map((x) => x.row.stateIndex).sort()).toEqual([0, 1]);
  });

  it('приближение ~v с номиналом ВЫШЕ границы якоря: та же причина unresolved_approx — полнота не зависит от положения номинала', () => {
    // ~1320 s против нижней границы якоря (22.00-0.07)*60 = 1315.8 s:
    // под положением номинала полнота не выводится ни в одну сторону
    const synthetic = replaceHalfLife(NUBASE_206FR_LINE, '~1320', 's', '');
    const r = auditNubaseElement(87, rowsOf([synthetic, NUBASE_223FR_LINE]));
    expect(r.completeness).toBe('not_verifiable');
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].notation).toBe('223Fr');
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('unresolved_approx');
    expect(r.reasons[0].row.halfLifeRaw).toBe('~1320');
    expect(r.reasons[0].row.halfLifeUnit).toBe('s');
    expect(r.reasons[0].row.halfLifeSeconds).toBe(1320);
    expect(r.reasons[0].row.halfLifeSigma).toBeNull();
  });

  it('измеренное без σ: 187Pom 0.5 ms НЕ исключается точкой против 209Po 124(3) y — полнота not_verifiable', () => {
    const rows = rowsOf([NUBASE_187POM_LINE, NUBASE_209PO_LINE]);
    const r = auditNubaseElement(84, rows);
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('209Po');
    expect(anchor.halfLifeValue).toBe(124);
    expect(anchor.halfLifeUnit).toBe('y');
    expect(anchor.halfLifeSigma).toBe(3);
    // отсутствие σ — отсутствие информации: номинал 0.5 ms не принимается
    // точной точкой и не доказывает неконкурентность (аудит R4)
    expect(r.completeness).toBe('not_verifiable');
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('unresolved_no_sigma');
    expect(r.reasons[0].row.stateIndex).toBe(1);
    expect(r.reasons[0].row.stateCode).toBe('m');
    expect(r.reasons[0].row.halfLifeRaw).toBe('0.5');
    expect(r.reasons[0].row.halfLifeUnit).toBe('ms');
    expect(r.reasons[0].row.halfLifeSigma).toBeNull();
  });

  it('измеренное без σ с номиналом ВЫШЕ границы якоря: та же причина unresolved_no_sigma (σ не подставляется)', () => {
    // 123 y: выше нижней границы 1σ-интервала якоря (124-3=121 y),
    // но ниже самого якоря 124 y — якорем остаётся 209Po; под положением
    // номинала полнота не выводится ни в одну сторону
    const synthetic = replaceHalfLife(NUBASE_187POM_LINE, '123', 'y', '');
    const r = auditNubaseElement(84, rowsOf([synthetic, NUBASE_209PO_LINE]));
    expect(r.completeness).toBe('not_verifiable');
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('209Po');
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('unresolved_no_sigma');
    expect(r.reasons[0].row.halfLifeRaw).toBe('123');
    expect(r.reasons[0].row.halfLifeUnit).toBe('y');
    expect(r.reasons[0].row.halfLifeSeconds).toBeCloseTo(123 * 31556926, 3);
    expect(r.reasons[0].row.halfLifeSigma).toBeNull();
  });

  it('оценка систематики: 87Tcm 2# s — наблюдавшийся изомер без числовой σ, полнота not_verifiable', () => {
    const r = auditNubaseElement(43, rowsOf([NUBASE_87TCM_LINE, NUBASE_97TC_LINE]));
    expect(r.observedRows).toBe(2);
    expect(r.grounds).toBe(1);
    expect(r.standardIsomers).toBe(1);
    expect(r.additionalIsomers).toBe(0);
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('97Tc');
    expect(anchor.halfLifeValue).toBe(4.21);
    expect(anchor.halfLifeUnit).toBe('My');
    expect(anchor.halfLifeSigma).toBe(0.16);
    // оценка «2# s» без опубликованной числовой σ: номинал не доказывает
    // неконкурентность, искусственная неопределённость не вводится
    expect(r.completeness).toBe('not_verifiable');
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('unresolved_estimated');
    expect(r.reasons[0].row.notation).toBe('87Tc');
    expect(r.reasons[0].row.stateIndex).toBe(1);
    expect(r.reasons[0].row.stateCode).toBe('m');
    expect(r.reasons[0].row.halfLifeKind).toBe('estimated');
    expect(r.reasons[0].row.halfLifeValue).toBe(2);
    expect(r.reasons[0].row.halfLifeSigma).toBeNull();
    expect(r.nonCandidateStatesWithoutHalfLife).toBe(0);
  });

  it('состояние без собственного T1/2: 250Bkp (доп. изомер) оспаривает полноту против якоря 247Bk 1.38(25) ky', () => {
    const r = reportOrThrow(97, NUBASE_250BK_LINES);
    expect(r.observedRows).toBe(5);
    expect(r.grounds).toBe(2);
    expect(r.standardIsomers).toBe(2);
    expect(r.additionalIsomers).toBe(1);
    expect(r.levels).toBe(0);
    expect(r.resonances).toBe(0);
    expect(r.ias).toBe(0);
    expect(r.indeterminate).toBe(0);
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('247Bk');
    expect(anchor.halfLifeValue).toBe(1.38);
    expect(anchor.halfLifeUnit).toBe('ky');
    expect(anchor.halfLifeSigma).toBe(0.25);
    // отсутствие опубликованного T1/2 не считается доказательством
    // короткого времени жизни (аудит R4)
    expect(r.completeness).toBe('not_verifiable');
    expect(r.candidates).toHaveLength(1);
    expect(r.nonCandidateStatesWithoutHalfLife).toBe(0);
    expect(r.reasons).toHaveLength(4);
    expect(r.reasons[0].kind).toBe('no_half_life_unresolved');
    expect(r.reasons[0].row.stateIndex).toBe(3);
    expect(r.reasons[0].row.stateCode).toBe('p');
    expect(r.reasons[0].row.notation).toBe('250Bk');
    expect(r.reasons[0].row.halfLifeKind).toBe('none');
    expect(r.reasons[0].row.halfLifeSeconds).toBeNull();
    // 250Bk ground, m, n — измеренные с σ, интервалы не пересекаются
    // с якорем 247Bk: исключение обосновано опубликованными σ
    expect(r.reasons.slice(1).map((x) => x.kind).sort()).toEqual([
      'interval_disjoint',
      'interval_disjoint',
      'interval_disjoint'
    ]);
    expect(r.reasons.slice(1).map((x) => x.row.stateIndex).sort()).toEqual([0, 1, 2]);
  });
});

describe('Stage 4.3.3 (аудит R4): SHA-256 фактического входа (C4)', () => {
  it('контрольные векторы FIPS/NIST SHA-256: пустой текст, abc, 448-битное сообщение', () => {
    expect(computeNubaseAuditTextSha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(computeNubaseAuditTextSha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(computeNubaseAuditTextSha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    );
  });

  it('многоблочное сообщение (300 символов, 5 блоков) — контрольный вектор реализации', () => {
    expect(computeNubaseAuditTextSha256('NUBASE2020'.repeat(30))).toBe(
      '940f29670bf764bfa1d71361df7f53589c50b7d304593f823d504ef1a9e1b413'
    );
  });

  it('не-ASCII вход отвергается ошибкой с позицией символа, а не хешируется молча', () => {
    let error: unknown = null;
    try {
      computeNubaseAuditTextSha256('NUBASE2020 α');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('ASCII');
    expect((error as Error).message).toContain('позиции 11');
  });

  it('константы локально проверенной копии: SHA-256, размер, дата получения, версия парсера', () => {
    expect(NUBASE2020_VERIFIED_SOURCE_SHA256).toBe(
      '1585a5eea86c5e17e90307c7e6e786d060049c4039e392a261ff6db977df9859'
    );
    expect(NUBASE2020_VERIFIED_SOURCE_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(NUBASE2020_VERIFIED_SOURCE_BYTES).toBe(761906);
    expect(NUBASE2020_SOURCE_RETRIEVED_AT).toBe('2026-11-01');
    expect(NUBASE_AUDIT_PARSER_VERSION).toBe('nubase-audit-r4/2.0.0');
  });

  it('библиография источника NUBASE2020: цитирование, DOI, страница AMDC, ограничения', () => {
    expect(NUBASE2020_BIBLIOGRAPHY.citation).toContain('NUBASE2020');
    expect(NUBASE2020_BIBLIOGRAPHY.citation).toContain('Chinese Physics C 45 (2021) 030001');
    expect(NUBASE2020_BIBLIOGRAPHY.doi).toBe('10.1088/1674-1137/abddae');
    expect(NUBASE2020_BIBLIOGRAPHY.amdcPageUrl).toBe('https://amdc.impcas.ac.cn/web/nubase_en.html');
    expect(NUBASE2020_BIBLIOGRAPHY.sourceVersion).toContain('NUBASE2020');
    const limitations = NUBASE2020_BIBLIOGRAPHY.limitations;
    expect(limitations.length).toBeGreaterThanOrEqual(3);
    for (const item of limitations) {
      expect(item.trim() !== '').toBe(true);
    }
    expect(limitations[0]).toContain('не включается в репозиторий');
  });

  it('recordId — ключ дедупликации строки (Z, A, i, s)', () => {
    const ground = parseOrThrow(NUBASE_205PO_LINES[0]);
    expect(ground.recordId).toBe('nubase2020:Z=084,A=205,i=0,s=');
    const pom = parseOrThrow(NUBASE_205PO_LINES[1]);
    expect(pom.recordId).toBe('nubase2020:Z=084,A=205,i=1,s=m');
    const amp = parseOrThrow(NUBASE_244AMP_LINE);
    expect(amp.recordId).toBe('nubase2020:Z=095,A=244,i=3,s=p');
  });
});

describe('Stage 4.3.3 (аудит R4): метаданные запуска и детерминированность (C4)', () => {
  it('синтетический фрагмент (fixture): unverified, вычисленный хеш входа, счётчики строк', () => {
    const text = [NUBASE_HEADER_LINE, ...NUBASE_92TC_LINES].join('\n');
    const a = auditNubaseText(text, [43], { fixtureLabel: 'тестовый фрагмент 92Tc' });
    expect(a.bibliography).toBe(NUBASE2020_BIBLIOGRAPHY);
    expect(a.verifiedSourceSha256).toBe(NUBASE2020_VERIFIED_SOURCE_SHA256);
    expect(a.run.parserVersion).toBe(NUBASE_AUDIT_PARSER_VERSION);
    expect(a.run.sourceVersion).toBe(NUBASE2020_BIBLIOGRAPHY.sourceVersion);
    // хеш ВЫЧИСЛЕН по фактическому входу и НЕ совпадает с константой копии
    expect(a.run.inputSha256).toBe(computeNubaseAuditTextSha256(text));
    expect(a.run.inputSha256).not.toBe(NUBASE2020_VERIFIED_SOURCE_SHA256);
    expect(a.run.inputBytes).toBe(text.length);
    // синтетический фрагмент НЕ имитирует проверку официального файла
    expect(a.run.sourceVerification).toBe('unverified');
    expect(a.run.verificationNote).toContain('синтетический');
    expect(a.run.retrievedAt).toBeNull();
    expect(a.run.fixtureLabel).toBe('тестовый фрагмент 92Tc');
    expect(a.run.parsedRows).toBe(4);
    expect(a.run.malformedRows).toBe(0);
    expect(a.run.duplicateRows).toBe(0);
    expect(a.run.skippedNonDataLines).toBe(1);
    expect(a.run.rankedElements).toEqual([43]);
    expect(a.reports.map((x) => x.atomicNumber)).toEqual([43]);
    expect(a.diagnostics).toHaveLength(0);
  });

  it('без метки fixture вход всё равно не подтверждён: сверка по SHA-256 и размеру', () => {
    const text = [...NUBASE_205PO_LINES].join('\n');
    const a = auditNubaseText(text, [84]);
    expect(a.run.sourceVerification).toBe('unverified');
    expect(a.run.verificationNote).toContain('SHA-256');
    expect(a.run.fixtureLabel).toBeNull();
    expect(a.run.retrievedAt).toBeNull();
    expect(a.run.inputSha256).toBe(computeNubaseAuditTextSha256(text));
    expect(a.run.parsedRows).toBe(5);
    expect(a.run.rankedElements).toEqual([84]);
  });

  it('детерминированность: повторные прогоны идентичны, заголовок не разбирается', () => {
    const text = [
      NUBASE_HEADER_LINE,
      ...NUBASE_92TC_LINES,
      ...NUBASE_205PO_LINES,
      ...NUBASE_183AU_LINES
    ].join('\n');
    const a = auditNubaseText(text, [43, 84, 79], { fixtureLabel: 'детерминированность' });
    const b = auditNubaseText(text, [43, 84, 79], { fixtureLabel: 'детерминированность' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 4 + 5 + 3 строки данных; строка заголовка не разбирается
    expect(a.run.parsedRows).toBe(12);
    expect(a.run.skippedNonDataLines).toBe(1);
    expect(a.reports.map((x) => x.atomicNumber)).toEqual([43, 84, 79]);
    expect(a.bibliography).toBe(NUBASE2020_BIBLIOGRAPHY);
  });

  it('единицы времени NUBASE2020: тропический год y = 31 556 926 с, точные ky и My', () => {
    expect(NUBASE_AUDIT_UNIT_SECONDS['y']).toBe(31556926);
    expect(NUBASE_AUDIT_UNIT_SECONDS['ky']).toBe(31556926000);
    expect(NUBASE_AUDIT_UNIT_SECONDS['My']).toBe(31556926000000);
    expect(nubaseAuditUnitSeconds('ms')).toBe(0.001);
    expect(nubaseAuditUnitSeconds('d')).toBe(86400);
    expect(nubaseAuditUnitSeconds('Gy')).toBeCloseTo(3.1556926e16, 6);
    // юлианские yr/ka/Ma — единицы каталога, НЕ парсера NUBASE2020
    expect(nubaseAuditUnitSeconds('yr')).toBeNull();
    expect(nubaseAuditUnitSeconds('zz')).toBeNull();
  });

  it('14 ранжируемых элементов зафиксированы: Z=43,61,84,85,86,87,88,89,93,94,95,96,97,98', () => {
    expect(NUBASE_AUDIT_RANKED_ELEMENTS).toEqual([43, 61, 84, 85, 86, 87, 88, 89, 93, 94, 95, 96, 97, 98]);
    expect(NUBASE_AUDIT_RANKED_ELEMENTS).toHaveLength(14);
  });
});
