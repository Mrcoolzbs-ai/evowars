// ============================================
// STAGE 4.3.3 (аудит R3) — Тесты воспроизводимой утилиты аудита
// NUBASE2020: парсер фиксированных колонок, наблюдаемость строк,
// контекстная классификация (i, s), ранжирование и полнота
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
// 6-го порядка). Правило фактора 2 для ~v удалено (аудит R3):
// приближения и измеренные значения без опубликованной σ НЕ
// получают искусственной неопределённости — только точечное
// правило против нижней границы 1σ-интервала якоря.

import { describe, it, expect } from 'vitest';
import {
  NUBASE2020_AUDIT_SOURCE,
  NUBASE_AUDIT_RANKED_ELEMENTS,
  NUBASE_AUDIT_UNIT_SECONDS,
  nubaseAuditUnitSeconds,
  parseNubaseAuditLine,
  parseNubaseAuditText,
  auditNubaseElement,
  auditNubaseText
} from '../Data/nubaseAudit';

// Фикстуры — ДОСЛОВНЫЕ строки официального ASCII-файла NUBASE2020
// (сгенерированы из локально проверенной копии файла построчно;
// SHA-256 копии — NUBASE2020_AUDIT_SOURCE.localCopySha256).
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

function rowsOf(lines: readonly string[]): ReturnType<typeof parseNubaseAuditText> {
  return parseNubaseAuditText(lines.join('\n'));
}

function parseOrThrow(line: string): ReturnType<typeof parseNubaseAuditLine> {
  const row = parseNubaseAuditLine(line);
  if (row === null) {
    throw new Error('строка NUBASE2020 должна разбираться: ' + line.slice(0, 20));
  }
  return row;
}

function reportOrThrow(z: number, lines: readonly string[]): ReturnType<typeof auditNubaseElement> {
  return auditNubaseElement(z, rowsOf(lines));
}

function anchorOrThrow(report: ReturnType<typeof auditNubaseElement>): ReturnType<typeof parseNubaseAuditLine> {
  if (report.anchor === null) {
    throw new Error('в отчёте аудита должен быть якорь');
  }
  return report.anchor;
}

// Замена полей T/unit/dT (колонки 70-88 шапки NUBASE2020) в дословной
// строке файла для граничных тестов точечного правила аудита R3.
function replaceHalfLife(line: string, t: string, unit: string, dT: string): string {
  return line.slice(0, 69) + t.padStart(9) + unit.padEnd(2) + ' ' + dT.padStart(7) + line.slice(88);
}

describe('Stage 4.3.3 (аудит R3): парсер фиксированных колонок NUBASE2020', () => {
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

  it('аномалия файла: предел в позиции dT при пустом поле T — 85Tc <110 ns; 255Nop >100 ns в позиции T', () => {
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
});

describe('Stage 4.3.3 (аудит R3): группы (Z, A) и контекстная классификация состояний', () => {
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
    // n и p: верхние пределы <0.1 us ниже нижней границы якоря — исключены
    expect(r.reasons).toHaveLength(2);
    expect(r.reasons.map((x) => x.kind).sort()).toEqual(['upper_limit_excluded', 'upper_limit_excluded']);
    expect(r.reasons.map((x) => x.row.stateIndex).sort()).toEqual([2, 3]);
    for (const reason of r.reasons) {
      expect(reason.row.halfLifeSeconds).toBeCloseTo(1e-7, 12);
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
    // m, n, p, q — измеренные с σ, интервалы не пересекаются с якорем: причин нет
    expect(r.reasons).toHaveLength(0);
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
  });

  it('28Si — резонанс r (i=5 без цепочки) и IAS i/j не кандидаты; полнота no_anchor (ground stbl)', () => {
    const r = reportOrThrow(14, NUBASE_28SI_LINES);
    expect(r.observedRows).toBe(4);
    expect(r.grounds).toBe(1);
    expect(r.standardIsomers).toBe(0);
    expect(r.additionalIsomers).toBe(0);
    expect(r.levels).toBe(0);
    expect(r.resonances).toBe(1);
    expect(r.ias).toBe(2);
    expect(r.completeness).toBe('no_anchor');
    expect(r.anchor).toBeNull();
    expect(r.candidates).toHaveLength(0);
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
    expect(r.reasons).toHaveLength(0);
  });
});

describe('Stage 4.3.3 (аудит R3): ранжирование и статусы полноты', () => {
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
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('lower_limit_unbounded');
    expect(r.reasons[0].row.stateIndex).toBe(1);
    expect(r.reasons[0].row.stateCode).toBe('m');
    expect(r.reasons[0].row.halfLifeRaw).toBe('>93');
  });

  it('приближение ~v: 206Fr ~16 s точечно исключено против якоря 223Fr 22.00(7) m — БЕЗ выдуманной σ', () => {
    const rows = rowsOf([NUBASE_206FR_LINE, NUBASE_223FR_LINE]);
    const r = auditNubaseElement(87, rows);
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('223Fr');
    expect(anchor.halfLifeValue).toBe(22.0);
    expect(anchor.halfLifeUnit).toBe('m');
    expect(anchor.halfLifeSigma).toBe(0.07);
    expect(r.completeness).toBe('complete');
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('approx_point_excluded');
    expect(r.reasons[0].row.notation).toBe('206Fr');
    expect(r.reasons[0].row.halfLifeRaw).toBe('~16');
    expect(r.reasons[0].row.halfLifeUnit).toBe('s');
    expect(r.reasons[0].row.halfLifeSeconds).toBe(16);
    // искусственная неопределённость не вводится
    expect(r.reasons[0].row.halfLifeSigma).toBeNull();
  });

  it('приближение ~v ВЫШЕ границы якоря: полнота not_verifiable, значение остаётся приближением', () => {
    // ~1320 s против нижней границы якоря (22.00-0.07)*60 = 1315.8 s
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

  it('измеренное без σ: 187Pom 0.5 ms точечно исключено против 209Po 124(3) y — полнота complete', () => {
    const rows = rowsOf([NUBASE_187POM_LINE, NUBASE_209PO_LINE]);
    const r = auditNubaseElement(84, rows);
    const anchor = anchorOrThrow(r);
    expect(anchor.notation).toBe('209Po');
    expect(anchor.halfLifeValue).toBe(124);
    expect(anchor.halfLifeUnit).toBe('y');
    expect(anchor.halfLifeSigma).toBe(3);
    expect(r.completeness).toBe('complete');
    expect(r.candidates).toHaveLength(1);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0].kind).toBe('no_sigma_point_excluded');
    expect(r.reasons[0].row.stateIndex).toBe(1);
    expect(r.reasons[0].row.stateCode).toBe('m');
    expect(r.reasons[0].row.halfLifeRaw).toBe('0.5');
    expect(r.reasons[0].row.halfLifeUnit).toBe('ms');
    expect(r.reasons[0].row.halfLifeSigma).toBeNull();
  });

  it('измеренное без σ ВЫШЕ границы якоря: полнота not_verifiable (σ не подставляется)', () => {
    // 123 y: выше нижней границы 1σ-интервала якоря (124-3=121 y),
    // но ниже самого якоря 124 y — якорем остаётся 209Po
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
});

describe('Stage 4.3.3 (аудит R3): источник, единицы и детерминированность', () => {
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

  it('метаданные источника: цитирование, DOI, SHA-256 локальной копии, версия парсера, ограничения', () => {
    expect(NUBASE2020_AUDIT_SOURCE.citation).toContain('NUBASE2020');
    expect(NUBASE2020_AUDIT_SOURCE.citation).toContain('Chinese Physics C 45 (2021) 030001');
    expect(NUBASE2020_AUDIT_SOURCE.doi).toBe('10.1088/1674-1137/abddae');
    expect(NUBASE2020_AUDIT_SOURCE.amdcPageUrl).toBe('https://amdc.impcas.ac.cn/web/nubase_en.html');
    expect(NUBASE2020_AUDIT_SOURCE.retrievedAt).toBe('2026-11-01');
    expect(NUBASE2020_AUDIT_SOURCE.parserVersion).toBe('nubase-audit-r3/1.0.0');
    const sha = NUBASE2020_AUDIT_SOURCE.localCopySha256;
    expect(sha).toBe('5646189e91c9c04016005a12e34f74b73e4ea4dec57a14ed5d6d948fe0ee83ce');
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
    // хеш — локально проверенной копии, НЕ официальный хеш распределения
    expect(NUBASE2020_AUDIT_SOURCE.localCopySha256Note).toContain('НЕ заявляется');
    const limitations = NUBASE2020_AUDIT_SOURCE.limitations;
    expect(limitations.length).toBeGreaterThanOrEqual(3);
    for (const item of limitations) {
      expect(item.trim() !== '').toBe(true);
    }
    expect(limitations[0]).toContain('не включается в репозиторий');
  });

  it('детерминированность: повторные прогоны auditNubaseText идентичны, заголовки не разбираются', () => {
    const text = [
      NUBASE_HEADER_LINE,
      ...NUBASE_92TC_LINES,
      ...NUBASE_205PO_LINES,
      ...NUBASE_183AU_LINES
    ].join('\n');
    const a = auditNubaseText(text, [43, 84, 79]);
    const b = auditNubaseText(text, [43, 84, 79]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // 4 + 5 + 3 строки данных; строка заголовка не разбирается
    expect(a.parsedRows).toBe(12);
    expect(a.reports.map((x) => x.atomicNumber)).toEqual([43, 84, 79]);
    expect(a.source).toBe(NUBASE2020_AUDIT_SOURCE);
  });
});
