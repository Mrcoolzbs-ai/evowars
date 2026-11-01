// ============================================
// THERMODYNAMIC CATALOG - Первая партия газовых веществ с реальными
// термодинамическими данными NASA Glenn CEA (Stage 4.3.2)
// ============================================
//
// Источник данных: NASA Glenn CEA Thermodynamic Database, файл
// data/thermo.inp, закреплённая версия - коммит nasa/cea
// 2f79a647e85737742fb08a127da00d1ea1d069da (git blob
// 5ddeb5b213701d0e8b79dbda7b48ede14e31404a, 1 234 323 байта,
// извлечено 2026-10-31). Научный первоисточник базы:
// NASA TP-2002-211556 (NTRS 20020085330); формат и процедура
// аппроксимации: CAP, NASA TP-2001-210959. Лицензия набора данных:
// Apache License 2.0 (текст - NASA_CEA_LICENSE.txt, уведомление -
// NASA_CEA_NOTICE.txt, атрибуция - nasaCeaAttribution.md; все рядом
// с этим файлом).
//
// Импортированы 20 газовых веществ (phase: gas, запись каталога =
// вид + фаза):
// - 12 видов легаси-каталога газов: идентичность (id, формула, имя,
//   элементный состав, заряд, фаза) переиспользована через
//   buildSpeciesCatalogFromLegacy(gases, elementCompositions);
//   в каталожный слой добавлены блок thermodynamics и молярная масса
//   из записи NASA CEA с собственным molarMassProvenance
//   (корректирующая ревизия Stage 4.3.2: ранее переиспользовалась
//   округлённая масса легаси-каталога: ne 20.18 -> 20.1797,
//   o2 32.00 -> 31.9988 г/моль);
// - 8 новых видов (so2, h2s, no, n2o, c2h2, c2h4, c3h8, ch3oh):
//   явные определения ScientificSpecies с элементным составом,
//   молярной массой и происхождением из записи базы.
//
// Что импортируется из каждой записи NASA CEA (и ничего сверх этого):
// - стандартная энтальпия образования при 298.15 K, Дж/моль -
//   числовое поле записи (known, origin reference_range;
//   неопределённость записью не приводится);
// - диапазоны температур сегментов (нижние границы 200/300 K - как
//   в записи; Snyder, обновление базы от 09.09.2021);
// - опубликованные коэффициенты NASA-7 Cp(T)/R - дословно, без
//   пересчёта (derivation.kind published; origin
//   numerical_approximation: аппроксимацию выполнял NASA Glenn,
//   не этот проект).
//
// Чего в записи НЕТ и что НЕ выдумывается:
// - S(298.15 K) и стандартная энергия Гиббса образования при
//   298.15 K: в записи нет табличных значений, а их вычисление из
//   интегральных констант требует вычислителя термодинамических
//   функций, который в этом подэтапе НЕ реализуется, поэтому
//   unknownValue с пояснением (не ноль, не подстановка);
// - исходная табличная Cp(T): в thermo.inp публикуется только
//   параметризация, поэтому tabulated отсутствует;
// - давление стандартного состояния: записью не задаётся, поэтому
//   в reference state не назначается (1 atm и 1 bar не
//   взаимозаменяемы).
//
// ФОРМА ЗАПИСИ NASA CEA (критично для будущего вычислителя):
// строка диапазона сегмента объявляет 7 коэффициентов при степенях
// T от -2 до +4 (7 -2.0 -1.0 0.0 1.0 2.0 3.0 4.0):
//   Cp(T)/R = a1*T^-2 + a2*T^-1 + a3 + a4*T + a5*T^2 + a6*T^3 + a7*T^4,
// за коэффициентами следуют две интегральные константы записи
// (a8: H/R и a9: S/R в нотации NASA CEA). Это форма NASA Glenn CEA,
// а НЕ классическая NASA-7/CHEMKIN-форма (5 коэффициентов Cp +
// 2 константы). Корректирующая ревизия Stage 4.3.2 кодирует форму
// типизированным полем form сегмента (nasa_cea; классическая форма
// - nasa7_classic): массив coefficients хранит [a1..a7] в порядке
// записи, а интегральные константы a8/a9 - в типизированном поле
// integralConstants сегмента (enthalpyConstantOverR,
// entropyConstantOverR); форма НЕ определяется по note или
// provenance.rawInput.
// Вычислитель NASA-7 (будущий подэтап) обязан учитывать члены T^-2
// и T^-1 - иначе значения будут неверны для большинства сегментов.
//
// Сверка с внешними справочниками (NIST WebBook SRD 69) в этом
// подэтапе выполняется как проверка качественного соответствия
// порядков величин; числа NIST в проект НЕ копируются. ATcT не
// импортируется.

import type { ScientificSpecies, SpeciesCatalog } from '../Core/species';
import { createSpeciesCatalog } from '../Core/species';
import { buildSpeciesCatalogFromLegacy } from '../Core/adapters';
import { knownValue, unknownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import type {
  Nasa7Polynomial,
  NasaCeaSegment,
  ThermodynamicProperties,
  ThermoDataProvenance
} from '../Core/thermodynamics';
import type { DataProvenance } from '../Core/scientificValue';
import gases from './gases';
import elementCompositions from './elementCompositions';

// ============================================
// 1. ИСТОЧНИК ДАННЫХ
// ============================================

/** Дескриптор источника NASA Glenn CEA (без origin: это не значение). */
export interface NasaCeaDataSource {
  sourceName: string;
  sourceId: string;
  datasetId: string;
  datasetVersion: string;
  license: string;
  reference: string;
  retrievedAt: string;
  note: string;
}

export const NASA_CEA_THERMO_SOURCE: NasaCeaDataSource = {
  sourceName: 'NASA Glenn CEA Thermodynamic Database',
  sourceId: 'nasa/cea',
  datasetId: 'data/thermo.inp',
  datasetVersion: '2f79a647e85737742fb08a127da00d1ea1d069da',
  license: 'Apache-2.0',
  reference:
    'NASA TP-2002-211556 (NTRS 20020085330), https://ntrs.nasa.gov/api/citations/20020085330/downloads/20020085330.pdf',
  retrievedAt: '2026-10-31',
  note:
    'закреплённая версия базы NASA CEA (blob 5ddeb5b213701d0e8b79dbda7b48ede14e31404a); лицензия и уведомления - NASA_CEA_LICENSE.txt, NASA_CEA_NOTICE.txt, nasaCeaAttribution.md рядом с этим файлом'
};

// ============================================
// 2. ДАННЫЕ ЗАПИСЕЙ (дословно из data/thermo.inp)
// ============================================
//
// Числа перенесены из записи без пересчёта: коэффициенты - в исходном
// E-формате (D-экспонента заменена на e), молярная масса записи (г/моль)
// переведена в кг/моль точной степенью 10 (литерал с e-3),
// стандартная энтальпия образования - исходное поле записи.

/** Один температурный сегмент записи NASA CEA. */
export interface NasaCeaSegmentData {
  /** Нижняя граница диапазона сегмента, K. */
  rangeMinK: number;
  /** Верхняя граница диапазона сегмента, K. */
  rangeMaxK: number;
  /**
   * Семь коэффициентов Cp(T)/R записи (a1..a7) при степенях T от -2
   * до +4 - в порядке записи, дословно.
   */
  coefficients: [number, number, number, number, number, number, number];
  /** Интегральная константа записи a8 (H/R). */
  enthalpyConstantOverR: number;
  /** Интегральная константа записи a9 (S/R). */
  entropyConstantOverR: number;
}

/** Данные одной записи газового вещества NASA CEA. */
export interface NasaCeaGasRecordData {
  /** Идентификатор записи в базе (имя вида в thermo.inp). */
  recordId: string;
  /** Код источника из строки записи (например g 8/99, tpis78). */
  sourceCode: string;
  /** Молярная масса записи, кг/моль (г/моль записи, умноженные на 1e-3). */
  molarMassKgMol: number;
  /** Стандартная энтальпия образования при 298.15 K, Дж/моль. */
  standardFormationEnthalpyJPerMol: number;
  /** Температурные сегменты записи (упорядочены, без пересечений). */
  segments: NasaCeaSegmentData[];
}

/** id 20 газовых веществ первой партии. */
export type NasaCeaGasRecordId =
  | 'ar' | 'he' | 'ne'
  | 'h2' | 'n2' | 'o2'
  | 'h2o' | 'co' | 'co2'
  | 'ch4' | 'nh3' | 'c2h6'
  | 'so2' | 'h2s' | 'no' | 'n2o'
  | 'c2h2' | 'c2h4' | 'c3h8' | 'ch3oh';

/** Записи NASA CEA первой партии, по id вида каталога. */
export const NASA_CEA_THERMO_DATA: Readonly<Record<NasaCeaGasRecordId, NasaCeaGasRecordData>> = {
  // Ar (каталожный id ar) - Аргон; код источника: g 3/98;
  // молярная масса по записи: 39.9480000 г/моль
  ar: {
    recordId: 'Ar',
    sourceCode: 'g 3/98',
    molarMassKgMol: 39.9480000e-3,
    standardFormationEnthalpyJPerMol: 0.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [0.000000000e+00, 0.000000000e+00, 2.500000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00],
        enthalpyConstantOverR: -7.453750000e+02,
        entropyConstantOverR: 4.379674910e+00
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [2.010538475e+01, -5.992661070e-02, 2.500069401e+00, -3.992141160e-08, 1.205272140e-11, -1.819015576e-15, 1.078576636e-19],
        enthalpyConstantOverR: -7.449939610e+02,
        entropyConstantOverR: 4.379180110e+00
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [-9.951265080e+08, 6.458887260e+05, -1.675894697e+02, 2.319933363e-02, -1.721080911e-06, 6.531938460e-11, -9.740147729e-16],
        enthalpyConstantOverR: -5.078300340e+06,
        entropyConstantOverR: 1.465298484e+03
      },
    ]
  },
  // He (каталожный id he) - Гелий; код источника: g 5/97;
  // молярная масса по записи: 4.0026020 г/моль
  he: {
    recordId: 'He',
    sourceCode: 'g 5/97',
    molarMassKgMol: 4.0026020e-3,
    standardFormationEnthalpyJPerMol: 0.000,
    segments: [
      {
        rangeMinK: 300.000,
        rangeMaxK: 1000.000,
        coefficients: [0.000000000e+00, 0.000000000e+00, 2.500000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00],
        enthalpyConstantOverR: -7.453750000e+02,
        entropyConstantOverR: 9.287239740e-01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [0.000000000e+00, 0.000000000e+00, 2.500000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00],
        enthalpyConstantOverR: -7.453750000e+02,
        entropyConstantOverR: 9.287239740e-01
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [3.396845420e+06, -2.194037652e+03, 3.080231878e+00, -8.068957550e-05, 6.252784910e-09, -2.574990067e-13, 4.429960218e-18],
        enthalpyConstantOverR: 1.650518960e+04,
        entropyConstantOverR: -4.048814390e+00
      },
    ]
  },
  // Ne (каталожный id ne) - Неон; код источника: g 5/97;
  // молярная масса по записи: 20.1797000 г/моль
  ne: {
    recordId: 'Ne',
    sourceCode: 'g 5/97',
    molarMassKgMol: 20.1797000e-3,
    standardFormationEnthalpyJPerMol: 0.000,
    segments: [
      {
        rangeMinK: 300.000,
        rangeMaxK: 1000.000,
        coefficients: [0.000000000e+00, 0.000000000e+00, 2.500000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00],
        enthalpyConstantOverR: -7.453750000e+02,
        entropyConstantOverR: 3.355322720e+00
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [0.000000000e+00, 0.000000000e+00, 2.500000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00, 0.000000000e+00],
        enthalpyConstantOverR: -7.453750000e+02,
        entropyConstantOverR: 3.355322720e+00
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [-1.238252746e+07, 6.958579580e+03, 1.016709287e+00, 1.424664555e-04, -4.803933930e-09, -1.170213183e-13, 8.415153652e-18],
        enthalpyConstantOverR: -5.663933630e+04,
        entropyConstantOverR: 1.648438697e+01
      },
    ]
  },
  // H2 (каталожный id h2) - Водород; код источника: tpis78;
  // молярная масса по записи: 2.0158800 г/моль
  h2: {
    recordId: 'H2',
    sourceCode: 'tpis78',
    molarMassKgMol: 2.0158800e-3,
    standardFormationEnthalpyJPerMol: 0.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [4.078323210e+04, -8.009186040e+02, 8.214702010e+00, -1.269714457e-02, 1.753605076e-05, -1.202860270e-08, 3.368093490e-12],
        enthalpyConstantOverR: 2.682484665e+03,
        entropyConstantOverR: -3.043788844e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [5.608128010e+05, -8.371504740e+02, 2.975364532e+00, 1.252249124e-03, -3.740716190e-07, 5.936625200e-11, -3.606994100e-15],
        enthalpyConstantOverR: 5.339824410e+03,
        entropyConstantOverR: -2.202774769e+00
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [4.966884120e+08, -3.147547149e+05, 7.984121880e+01, -8.414789210e-03, 4.753248350e-07, -1.371873492e-11, 1.605461756e-16],
        enthalpyConstantOverR: 2.488433516e+06,
        entropyConstantOverR: -6.695728110e+02
      },
    ]
  },
  // N2 (каталожный id n2) - Азот; код источника: tpis78;
  // молярная масса по записи: 28.0134000 г/моль
  n2: {
    recordId: 'N2',
    sourceCode: 'tpis78',
    molarMassKgMol: 28.0134000e-3,
    standardFormationEnthalpyJPerMol: 0.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [2.210371497e+04, -3.818461820e+02, 6.082738360e+00, -8.530914410e-03, 1.384646189e-05, -9.625793620e-09, 2.519705809e-12],
        enthalpyConstantOverR: 7.108460860e+02,
        entropyConstantOverR: -1.076003744e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [5.877124060e+05, -2.239249073e+03, 6.066949220e+00, -6.139685500e-04, 1.491806679e-07, -1.923105485e-11, 1.061954386e-15],
        enthalpyConstantOverR: 1.283210415e+04,
        entropyConstantOverR: -1.586640027e+01
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [8.310139160e+08, -6.420733540e+05, 2.020264635e+02, -3.065092046e-02, 2.486903333e-06, -9.705954110e-11, 1.437538881e-15],
        enthalpyConstantOverR: 4.938707040e+06,
        entropyConstantOverR: -1.672099740e+03
      },
    ]
  },
  // O2 (каталожный id o2) - Кислород; код источника: tpis89;
  // молярная масса по записи: 31.9988000 г/моль
  o2: {
    recordId: 'O2',
    sourceCode: 'tpis89',
    molarMassKgMol: 31.9988000e-3,
    standardFormationEnthalpyJPerMol: 0.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [-3.425563420e+04, 4.847000970e+02, 1.119010961e+00, 4.293889240e-03, -6.836300520e-07, -2.023372700e-09, 1.039040018e-12],
        enthalpyConstantOverR: -3.391454870e+03,
        entropyConstantOverR: 1.849699470e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [-1.037939022e+06, 2.344830282e+03, 1.819732036e+00, 1.267847582e-03, -2.188067988e-07, 2.053719572e-11, -8.193467050e-16],
        enthalpyConstantOverR: -1.689010929e+04,
        entropyConstantOverR: 1.738716506e+01
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [4.975294300e+08, -2.866106874e+05, 6.690352250e+01, -6.169959020e-03, 3.016396027e-07, -7.421416600e-12, 7.278175770e-17],
        enthalpyConstantOverR: 2.293554027e+06,
        entropyConstantOverR: -5.530621610e+02
      },
    ]
  },
  // H2O (каталожный id h2o) - Водяной пар; код источника: g 8/89;
  // молярная масса по записи: 18.0152800 г/моль
  h2o: {
    recordId: 'H2O',
    sourceCode: 'g 8/89',
    molarMassKgMol: 18.0152800e-3,
    standardFormationEnthalpyJPerMol: -241826.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [-3.947960830e+04, 5.755731020e+02, 9.317826530e-01, 7.222712860e-03, -7.342557370e-06, 4.955043490e-09, -1.336933246e-12],
        enthalpyConstantOverR: -3.303974310e+04,
        entropyConstantOverR: 1.724205775e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [1.034972096e+06, -2.412698562e+03, 4.646110780e+00, 2.291998307e-03, -6.836830480e-07, 9.426468930e-11, -4.822380530e-15],
        enthalpyConstantOverR: -1.384286509e+04,
        entropyConstantOverR: -7.978148510e+00
      },
    ]
  },
  // CO (каталожный id co) - Угарный газ; код источника: tpis79;
  // молярная масса по записи: 28.0101000 г/моль
  co: {
    recordId: 'CO',
    sourceCode: 'tpis79',
    molarMassKgMol: 28.0101000e-3,
    standardFormationEnthalpyJPerMol: -110535.196,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [1.489045326e+04, -2.922285939e+02, 5.724527170e+00, -8.176235030e-03, 1.456903469e-05, -1.087746302e-08, 3.027941827e-12],
        enthalpyConstantOverR: -1.303131878e+04,
        entropyConstantOverR: -7.859241350e+00
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [4.619197250e+05, -1.944704863e+03, 5.916714180e+00, -5.664282830e-04, 1.398814540e-07, -1.787680361e-11, 9.620935570e-16],
        enthalpyConstantOverR: -2.466261084e+03,
        entropyConstantOverR: -1.387413108e+01
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [8.868662960e+08, -7.500377840e+05, 2.495474979e+02, -3.956351100e-02, 3.297772080e-06, -1.318409933e-10, 1.998937948e-15],
        enthalpyConstantOverR: 5.701421130e+06,
        entropyConstantOverR: -2.060704786e+03
      },
    ]
  },
  // CO2 (каталожный id co2) - Углекислый газ; код источника: g 9/99;
  // молярная масса по записи: 44.0095000 г/моль
  co2: {
    recordId: 'CO2',
    sourceCode: 'g 9/99',
    molarMassKgMol: 44.0095000e-3,
    standardFormationEnthalpyJPerMol: -393510.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [4.943650540e+04, -6.264116010e+02, 5.301725240e+00, 2.503813816e-03, -2.127308728e-07, -7.689988780e-10, 2.849677801e-13],
        enthalpyConstantOverR: -4.528198460e+04,
        entropyConstantOverR: -7.048279440e+00
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [1.176962419e+05, -1.788791477e+03, 8.291523190e+00, -9.223156780e-05, 4.863676880e-09, -1.891053312e-12, 6.330036590e-16],
        enthalpyConstantOverR: -3.908350590e+04,
        entropyConstantOverR: -2.652669281e+01
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [-1.544423287e+09, 1.016847056e+06, -2.561405230e+02, 3.369401080e-02, -2.181184337e-06, 6.991420840e-11, -8.842351500e-16],
        enthalpyConstantOverR: -8.043214510e+06,
        entropyConstantOverR: 2.254177493e+03
      },
    ]
  },
  // CH4 (каталожный id ch4) - Метан; код источника: g 8/99;
  // молярная масса по записи: 16.0424600 г/моль
  ch4: {
    recordId: 'CH4',
    sourceCode: 'g 8/99',
    molarMassKgMol: 16.0424600e-3,
    standardFormationEnthalpyJPerMol: -74600.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [-1.766850998e+05, 2.786181020e+03, -1.202577850e+01, 3.917619290e-02, -3.619054430e-05, 2.026853043e-08, -4.976705490e-12],
        enthalpyConstantOverR: -2.331314360e+04,
        entropyConstantOverR: 8.904322750e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [3.730042760e+06, -1.383501485e+04, 2.049107091e+01, -1.961974759e-03, 4.727313040e-07, -3.728814690e-11, 1.623737207e-15],
        enthalpyConstantOverR: 7.532066910e+04,
        entropyConstantOverR: -1.219124889e+02
      },
    ]
  },
  // NH3 (каталожный id nh3) - Аммиак; код источника: tpis89;
  // молярная масса по записи: 17.0305200 г/моль
  nh3: {
    recordId: 'NH3',
    sourceCode: 'tpis89',
    molarMassKgMol: 17.0305200e-3,
    standardFormationEnthalpyJPerMol: -45940.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [-7.681226150e+04, 1.270951578e+03, -3.893229130e+00, 2.145988418e-02, -2.183766703e-05, 1.317385706e-08, -3.332322060e-12],
        enthalpyConstantOverR: -1.264886413e+04,
        entropyConstantOverR: 4.366014588e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [2.452389535e+06, -8.040894240e+03, 1.271346201e+01, -3.980186580e-04, 3.552502750e-08, 2.530923570e-12, -3.322700530e-16],
        enthalpyConstantOverR: 4.386191960e+04,
        entropyConstantOverR: -6.462330602e+01
      },
    ]
  },
  // C2H6 (каталожный id c2h6) - Этан; код источника: g 7/00;
  // молярная масса по записи: 30.0690400 г/моль
  c2h6: {
    recordId: 'C2H6',
    sourceCode: 'g 7/00',
    molarMassKgMol: 30.0690400e-3,
    standardFormationEnthalpyJPerMol: -83851.544,
    segments: [
      {
        rangeMinK: 300.000,
        rangeMaxK: 1000.000,
        coefficients: [-1.862044161e+05, 3.406191860e+03, -1.951705092e+01, 7.565835590e-02, -8.204173220e-05, 5.061135800e-08, -1.319281992e-11],
        enthalpyConstantOverR: -2.702932890e+04,
        entropyConstantOverR: 1.298140496e+02
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [5.025782130e+06, -2.033022397e+04, 3.322552930e+01, -3.836703410e-03, 7.238405860e-07, -7.319182500e-11, 3.065468699e-15],
        enthalpyConstantOverR: 1.115963950e+05,
        entropyConstantOverR: -2.039410584e+02
      },
    ]
  },
  // SO2 (каталожный id so2) - Диоксид серы; код источника: tpis89;
  // молярная масса по записи: 64.0638000 г/моль
  so2: {
    recordId: 'SO2',
    sourceCode: 'tpis89',
    molarMassKgMol: 64.0638000e-3,
    standardFormationEnthalpyJPerMol: -296810.000,
    segments: [
      {
        rangeMinK: 300.000,
        rangeMaxK: 1000.000,
        coefficients: [-5.310842140e+04, 9.090311670e+02, -2.356891244e+00, 2.204449885e-02, -2.510781471e-05, 1.446300484e-08, -3.369070940e-12],
        enthalpyConstantOverR: -4.113752080e+04,
        entropyConstantOverR: 4.045512519e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [-1.127640116e+05, -8.252261380e+02, 7.616178630e+00, -1.999327610e-04, 5.655631430e-08, -5.454316610e-12, 2.918294102e-16],
        enthalpyConstantOverR: -3.351308690e+04,
        entropyConstantOverR: -1.655776085e+01
      },
    ]
  },
  // H2S (каталожный id h2s) - Сероводород; код источника: g 4/01;
  // молярная масса по записи: 34.0808800 г/моль
  h2s: {
    recordId: 'H2S',
    sourceCode: 'g 4/01',
    molarMassKgMol: 34.0808800e-3,
    standardFormationEnthalpyJPerMol: -20600.000,
    segments: [
      {
        rangeMinK: 300.000,
        rangeMaxK: 1000.000,
        coefficients: [9.543808810e+03, -6.875175080e+01, 4.054921960e+00, -3.014557336e-04, 3.768497750e-06, -2.239358925e-09, 3.086859108e-13],
        enthalpyConstantOverR: -3.278457280e+03,
        entropyConstantOverR: 1.415194691e+00
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [1.430040220e+06, -5.284028650e+03, 1.016182124e+01, -9.703849960e-04, 2.154003405e-07, -2.169695700e-11, 9.318163070e-16],
        enthalpyConstantOverR: 2.908696214e+04,
        entropyConstantOverR: -4.349160391e+01
      },
    ]
  },
  // NO (каталожный id no) - Монооксид азота; код источника: tpis89;
  // молярная масса по записи: 30.0061000 г/моль
  no: {
    recordId: 'NO',
    sourceCode: 'tpis89',
    molarMassKgMol: 30.0061000e-3,
    standardFormationEnthalpyJPerMol: 91271.310,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [-1.143916503e+04, 1.536467592e+02, 3.431468730e+00, -2.668592368e-03, 8.481399120e-06, -7.685111050e-09, 2.386797655e-12],
        enthalpyConstantOverR: 9.098214410e+03,
        entropyConstantOverR: 6.728725490e+00
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [2.239018716e+05, -1.289651623e+03, 5.433936030e+00, -3.656034900e-04, 9.880966450e-08, -1.416076856e-11, 9.380184620e-16],
        enthalpyConstantOverR: 1.750317656e+04,
        entropyConstantOverR: -8.501669090e+00
      },
      {
        rangeMinK: 6000.000,
        rangeMaxK: 20000.000,
        coefficients: [-9.575303540e+08, 5.912434480e+05, -1.384566826e+02, 1.694339403e-02, -1.007351096e-06, 2.912584076e-11, -3.295109350e-16],
        enthalpyConstantOverR: -4.677501240e+06,
        entropyConstantOverR: 1.242081216e+03
      },
    ]
  },
  // N2O (каталожный id n2o) - Оксид диазота; код источника: g 4/99;
  // молярная масса по записи: 44.0128000 г/моль
  n2o: {
    recordId: 'N2O',
    sourceCode: 'g 4/99',
    molarMassKgMol: 44.0128000e-3,
    standardFormationEnthalpyJPerMol: 81600.000,
    segments: [
      {
        rangeMinK: 300.000,
        rangeMaxK: 1000.000,
        coefficients: [4.288225970e+04, -6.440118440e+02, 6.034351430e+00, 2.265394436e-04, 3.472782850e-06, -3.627748640e-09, 1.137969552e-12],
        enthalpyConstantOverR: 1.179405506e+04,
        entropyConstantOverR: -1.003128570e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [3.438448040e+05, -2.404557558e+03, 9.125636220e+00, -5.401667930e-04, 1.315124031e-07, -1.414215100e-11, 6.381066870e-16],
        enthalpyConstantOverR: 2.198632638e+04,
        entropyConstantOverR: -3.147805016e+01
      },
    ]
  },
  // C2H2,acetylene (каталожный id c2h2) - Ацетилен; код источника: g 1/91;
  // молярная масса по записи: 26.0372800 г/моль
  c2h2: {
    recordId: 'C2H2,acetylene',
    sourceCode: 'g 1/91',
    molarMassKgMol: 26.0372800e-3,
    standardFormationEnthalpyJPerMol: 228200.000,
    segments: [
      {
        rangeMinK: 300.000,
        rangeMaxK: 1000.000,
        coefficients: [1.598112089e+05, -2.216644118e+03, 1.265707813e+01, -7.979651080e-03, 8.054992750e-06, -2.433307673e-09, -7.529233180e-14],
        enthalpyConstantOverR: 3.712619060e+04,
        entropyConstantOverR: -5.244338900e+01
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [1.713847410e+06, -5.929106660e+03, 1.236127943e+01, 1.314186993e-04, -1.362764431e-07, 2.712655786e-11, -1.302066204e-15],
        enthalpyConstantOverR: 6.266578970e+04,
        entropyConstantOverR: -5.818960590e+01
      },
    ]
  },
  // C2H4 (каталожный id c2h4) - Этилен; код источника: g 1/00;
  // молярная масса по записи: 28.0531600 г/моль
  c2h4: {
    recordId: 'C2H4',
    sourceCode: 'g 1/00',
    molarMassKgMol: 28.0531600e-3,
    standardFormationEnthalpyJPerMol: 52500.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [-1.163605836e+05, 2.554851510e+03, -1.609746428e+01, 6.625779320e-02, -7.885081860e-05, 5.125224820e-08, -1.370340031e-11],
        enthalpyConstantOverR: -6.176191070e+03,
        entropyConstantOverR: 1.093338343e+02
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [3.408763670e+06, -1.374847903e+04, 2.365898074e+01, -2.423804419e-03, 4.431395660e-07, -4.352683390e-11, 1.775410633e-15],
        enthalpyConstantOverR: 8.820429380e+04,
        entropyConstantOverR: -1.371278108e+02
      },
    ]
  },
  // C3H8 (каталожный id c3h8) - Пропан; код источника: g 2/00;
  // молярная масса по записи: 44.0956200 г/моль
  c3h8: {
    recordId: 'C3H8',
    sourceCode: 'g 2/00',
    molarMassKgMol: 44.0956200e-3,
    standardFormationEnthalpyJPerMol: -104680.000,
    segments: [
      {
        rangeMinK: 300.000,
        rangeMaxK: 1000.000,
        coefficients: [-2.433144337e+05, 4.656270810e+03, -2.939466091e+01, 1.188952745e-01, -1.376308269e-04, 8.814823910e-08, -2.342987994e-11],
        enthalpyConstantOverR: -3.540335270e+04,
        entropyConstantOverR: 1.841749277e+02
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [6.420731680e+06, -2.659791134e+04, 4.534356840e+01, -5.020663920e-03, 9.471216940e-07, -9.575405230e-11, 4.009672880e-15],
        enthalpyConstantOverR: 1.455582459e+05,
        entropyConstantOverR: -2.818374734e+02
      },
    ]
  },
  // CH3OH (каталожный id ch3oh) - Метанол; код источника: g 7/00;
  // молярная масса по записи: 32.0418600 г/моль
  ch3oh: {
    recordId: 'CH3OH',
    sourceCode: 'g 7/00',
    molarMassKgMol: 32.0418600e-3,
    standardFormationEnthalpyJPerMol: -200940.000,
    segments: [
      {
        rangeMinK: 200.000,
        rangeMaxK: 1000.000,
        coefficients: [-2.416642886e+05, 4.032147190e+03, -2.046415436e+01, 6.903698070e-02, -7.598932690e-05, 4.598208360e-08, -1.158706744e-11],
        enthalpyConstantOverR: -4.433261170e+04,
        entropyConstantOverR: 1.400142190e+02
      },
      {
        rangeMinK: 1000.000,
        rangeMaxK: 6000.000,
        coefficients: [3.411570760e+06, -1.345500201e+04, 2.261407623e+01, -2.141029179e-03, 3.730050540e-07, -3.498846390e-11, 1.366073444e-15],
        enthalpyConstantOverR: 5.636081560e+04,
        entropyConstantOverR: -1.277814279e+02
      },
    ]
  },
};

// ============================================
// 3. СОСТАВ КАТАЛОГА: 12 ЛЕГАСИ + 8 НОВЫХ
// ============================================

/** 12 видов легаси-каталога газов: определения переиспользуются. */
const LEGACY_GAS_IDS: readonly NasaCeaGasRecordId[] = [
  'ch4', 'n2', 'c2h6', 'h2', 'nh3', 'co', 'co2', 'h2o', 'he', 'ar', 'ne', 'o2'
];

/** Явное определение нового вида, отсутствующего в легаси-каталоге. */
export interface NewGasSpeciesDefinition {
  id: NasaCeaGasRecordId;
  /** Формула в конвенции проекта (Unicode-подстрочные индексы). */
  formula: string;
  name: string;
  /** Элементный состав из строки записи NASA CEA (без парсера формул). */
  elements: Record<string, number>;
}

/**
 * 8 новых видов первой партии: в легаси-каталоге газов их нет,
 * определения строятся явно из записи базы.
 */
export const NEW_GAS_SPECIES: readonly NewGasSpeciesDefinition[] = [
  { id: 'so2', formula: 'SO₂', name: 'Диоксид серы', elements: { S: 1, O: 2 } },
  { id: 'h2s', formula: 'H₂S', name: 'Сероводород', elements: { H: 2, S: 1 } },
  { id: 'no', formula: 'NO', name: 'Монооксид азота', elements: { N: 1, O: 1 } },
  { id: 'n2o', formula: 'N₂O', name: 'Оксид диазота', elements: { N: 2, O: 1 } },
  { id: 'c2h2', formula: 'C₂H₂', name: 'Ацетилен', elements: { C: 2, H: 2 } },
  { id: 'c2h4', formula: 'C₂H₄', name: 'Этилен', elements: { C: 2, H: 4 } },
  { id: 'c3h8', formula: 'C₃H₈', name: 'Пропан', elements: { C: 3, H: 8 } },
  { id: 'ch3oh', formula: 'CH₃OH', name: 'Метанол', elements: { C: 1, H: 4, O: 1 } }
];

/** Все 20 id веществ термодинамического каталога. */
export const THERMODYNAMIC_CATALOG_SPECIES_IDS: readonly NasaCeaGasRecordId[] = [
  ...LEGACY_GAS_IDS,
  ...NEW_GAS_SPECIES.map((s) => s.id)
];

// ============================================
// 4. PROVENANCE И БЛОК ТЕРМОДИНАМИКИ
// ============================================

/** Базовый provenance значения из записи (origin задаётся по месту). */
function recordProvenance(record: NasaCeaGasRecordData): ThermoDataProvenance {
  return {
    origin: 'reference_range',
    sourceName: NASA_CEA_THERMO_SOURCE.sourceName,
    sourceId: NASA_CEA_THERMO_SOURCE.sourceId,
    datasetId: NASA_CEA_THERMO_SOURCE.datasetId,
    datasetVersion: NASA_CEA_THERMO_SOURCE.datasetVersion,
    recordId: record.recordId,
    reference: NASA_CEA_THERMO_SOURCE.reference + '; код записи NASA CEA: ' + record.sourceCode,
    retrievedAt: NASA_CEA_THERMO_SOURCE.retrievedAt,
    license: NASA_CEA_THERMO_SOURCE.license
  };
}

/** Метод публикации коэффициентов NASA-7 (для origin numerical_approximation). */
const NASA7_PUBLICATION_METHOD =
  'публикуемая аппроксимация Cp(T)/R NASA Glenn (метод наименьших квадратов, CAP - NASA TP-2001-210959; сводка - NASA TP-2002-211556); коэффициенты импортированы дословно, без пересчёта и подгонки';

/**
 * Блок термодинамических свойств из записи NASA CEA.
 * Стандартная энтальпия образования - known; S и энергия Гиббса -
 * unknown с пояснением; Cp - NASA-7 (published), исходной таблицы
 * у источника нет.
 */
export function buildNasaCeaThermodynamics(record: NasaCeaGasRecordData): ThermodynamicProperties {
  const segments: NasaCeaSegment[] = record.segments.map((seg): NasaCeaSegment => ({
    form: 'nasa_cea',
    quantity: 'Cp_over_R',
    rangeK: { min: quantity(seg.rangeMinK, 'K'), max: quantity(seg.rangeMaxK, 'K') },
    coefficients: [...seg.coefficients],
    integralConstants: {
      enthalpyConstantOverR: seg.enthalpyConstantOverR,
      entropyConstantOverR: seg.entropyConstantOverR
    },
    derivation: {
      kind: 'published',
      provenance: {
        ...recordProvenance(record),
        origin: 'numerical_approximation',
        method: NASA7_PUBLICATION_METHOD
      }
    }
  }));

  const nasa7: Nasa7Polynomial = {
    segments,
    note:
    'форма NASA Glenn CEA (form: nasa_cea, корректирующая ревизия Stage 4.3.2): семь коэффициентов Cp(T)/R при степенях T от -2 до +4 (строка диапазона записи: 7 -2.0 -1.0 0.0 1.0 2.0 3.0 4.0); интегральные константы записи a8 (H/R) и a9 (S/R) - в типизированном поле integralConstants каждого сегмента; это НЕ классическая NASA-7/CHEMKIN-форма (form: nasa7_classic, 5 коэффициентов Cp + константы a5/a6 в массиве coefficients) - будущий вычислитель обязан учитывать члены T^-2 и T^-1'
  };

  return {
    standardFormationEnthalpy: knownValue(quantity(record.standardFormationEnthalpyJPerMol, 'J_mol'), {
      provenance: {
        ...recordProvenance(record),
        note:
          'стандартная энтальпия образования при 298.15 K - числовое поле записи data/thermo.inp (последнее поле строки источника записи), Дж/моль; отнесение к 298.15 K подтверждается согласованием со справочными табличными значениями при 298.15 K; неопределённость записью не приводится - неопределённость неизвестна, а не ноль'
      }
    }),
    standardFormationGibbsEnergy: unknownValue(
      'стандартная энергия Гиббса образования при 298.15 K не предоставлена записью NASA CEA и не вычисляется: вычислитель термодинамических функций из коэффициентов NASA-7 в этом подэтапе не реализуется; табличное значение - Appendix B NASA TP-2002-211556',
      recordProvenance(record)
    ),
    standardEntropy: unknownValue(
      'стандартная энтропия при 298.15 K не предоставлена записью NASA CEA напрямую: в записи хранятся коэффициенты NASA-7 и интегральная константа a9, вычисление из которых требует вычислителя (в этом подэтапе не реализуется); табличное значение - Appendix B NASA TP-2002-211556',
      recordProvenance(record)
    ),
    heatCapacity: {
      status: 'known',
      nasa7,
      note:
        'исходная табличная Cp(T) записью NASA CEA не публикуется (в thermo.inp хранится только параметризация), а Appendix B NASA TP-2002-211556 недоступен для верифицированного импорта в этом подэтапе - tabulated не заполняется; импортирована опубликованная параметризация NASA-7'
    },
    referenceState: {
      temperature: quantity(298.15, 'K'),
      phase: 'gas',
      standardState:
        'газовая фаза (запись thermo.inp, код фазы g); стандартная энтальпия образования записи отнесена к 298.15 K; давление стандартного состояния записью не задаётся и не назначается (1 atm и 1 bar не взаимозаменяемы)',
      conditions:
        'коэффициенты NASA-7 применимы в диапазонах температур сегментов записи; стандартное состояние источника в записи дополнительно не описано'
    },
    provenance: {
      sourceName: NASA_CEA_THERMO_SOURCE.sourceName,
      sourceId: NASA_CEA_THERMO_SOURCE.sourceId,
      datasetId: NASA_CEA_THERMO_SOURCE.datasetId,
      datasetVersion: NASA_CEA_THERMO_SOURCE.datasetVersion,
      recordId: record.recordId,
      reference: NASA_CEA_THERMO_SOURCE.reference + '; код записи NASA CEA: ' + record.sourceCode,
      retrievedAt: NASA_CEA_THERMO_SOURCE.retrievedAt,
      license: NASA_CEA_THERMO_SOURCE.license,
      note:
        'блок термодинамики собран из записи NASA CEA thermo.inp; стандартная энтальпия образования - known, стандартные энтропия и энергия Гиббса - unknown с пояснениями; вычислитель NASA-7 не реализуется'
    },
    note: 'запись NASA CEA «' + record.recordId + '» (код источника ' + record.sourceCode + ')'
  };
}

// ============================================
// 4a. ПРОИСХОЖДЕНИЕ МОЛЯРНОЙ МАССЫ (КОРРЕКТИРУЮЩАЯ РЕВИЗИЯ 4.3.2)
// ============================================

/**
 * Происхождение молярной массы из записи NASA CEA: значение -
 * числовое поле строки источника записи (г/моль), переведённое в
 * кг/моль точной степенью 10; привязка к recordId обязательна.
 * Отдельно от provenance вида (формула/состав): масса может
 * происходить из другого источника.
 */
function nasaCeaMolarMassProvenance(record: NasaCeaGasRecordData): DataProvenance {
  return {
    sourceName: NASA_CEA_THERMO_SOURCE.sourceName,
    sourceId: NASA_CEA_THERMO_SOURCE.sourceId,
    datasetId: NASA_CEA_THERMO_SOURCE.datasetId,
    datasetVersion: NASA_CEA_THERMO_SOURCE.datasetVersion,
    recordId: record.recordId,
    reference: NASA_CEA_THERMO_SOURCE.reference + '; код записи NASA CEA: ' + record.sourceCode,
    retrievedAt: NASA_CEA_THERMO_SOURCE.retrievedAt,
    license: NASA_CEA_THERMO_SOURCE.license,
    note:
      'молярная масса - числовое поле строки источника записи NASA CEA thermo.inp (г/моль), переведена в кг/моль точной степенью 10 (x1e-3); исходная точность записи сохранена'
  };
}

// ============================================
// 5. СБОРКА КАТАЛОГА
// ============================================

/**
 * Научный каталог 20 газовых веществ с термодинамикой NASA CEA
 * (Stage 4.3.2). Единственный способ получить каталог первой
 * партии; детерминирован: без состояния и случайности.
 *
 * - 12 легаси-видов: идентичность (id, формула, имя, элементный
 *   состав, заряд, фаза, provenance вида) переиспользуется из
 *   buildSpeciesCatalogFromLegacy; добавляются thermodynamics и
 *   молярная масса из записи NASA CEA с собственным
 *   molarMassProvenance (корректирующая ревизия Stage 4.3.2);
 * - 8 новых видов: явные определения из записи базы.
 *
 * Каталог валидирует каждую запись при регистрации
 * (validateSpecies + validateThermodynamicProperties внутри
 * register): некорректные данные не попадают в каталог молча.
 */
export function buildThermodynamicCatalog(): SpeciesCatalog {
  const legacyCatalog = buildSpeciesCatalogFromLegacy(gases, elementCompositions);
  const catalog = createSpeciesCatalog();

  for (const id of LEGACY_GAS_IDS) {
    const base = legacyCatalog.get(id);
    if (base === null) {
      throw new Error(
        'легаси-вид «' + id + '» не найден в каталоге газов: термодинамический слой 4.3.2 не может его переиспользовать'
      );
    }
    const record = NASA_CEA_THERMO_DATA[id];
    // Корректирующая ревизия Stage 4.3.2: идентичность вида
    // (id, формула, состав, заряд, фаза) - из легаси-каталога;
    // молярная масса - из записи NASA CEA с собственным provenance
    // (легаси-масса округлена и уступает записи источника:
    // ne 20.18 -> 20.1797, o2 32.00 -> 31.9988 г/моль).
    catalog.register({
      ...base,
      molarMassKgMol: record.molarMassKgMol,
      molarMassStatus: 'known',
      molarMassProvenance: nasaCeaMolarMassProvenance(record),
      thermodynamics: buildNasaCeaThermodynamics(record)
    });
  }

  for (const definition of NEW_GAS_SPECIES) {
    const record = NASA_CEA_THERMO_DATA[definition.id];
    const species: ScientificSpecies = {
      id: definition.id,
      formula: definition.formula,
      name: definition.name,
      elements: { ...definition.elements },
      charge: 0,
      phase: 'gas',
      molarMassKgMol: record.molarMassKgMol,
      molarMassStatus: 'known',
      molarMassProvenance: nasaCeaMolarMassProvenance(record),
      dataStatus: 'known',
      provenance: {
        sourceName: NASA_CEA_THERMO_SOURCE.sourceName,
        sourceId: NASA_CEA_THERMO_SOURCE.sourceId,
        datasetId: NASA_CEA_THERMO_SOURCE.datasetId,
        datasetVersion: NASA_CEA_THERMO_SOURCE.datasetVersion,
        recordId: record.recordId,
        reference: NASA_CEA_THERMO_SOURCE.reference + '; код записи NASA CEA: ' + record.sourceCode,
        retrievedAt: NASA_CEA_THERMO_SOURCE.retrievedAt,
        license: NASA_CEA_THERMO_SOURCE.license,
        note:
          'определение вида построено из записи NASA CEA thermo.inp: элементный состав и молярная масса - из строки источника записи; заряд 0 - все вещества первой партии электронейтральны'
      },
      thermodynamics: buildNasaCeaThermodynamics(record)
    };
    catalog.register(species);
  }

  return catalog;
}
