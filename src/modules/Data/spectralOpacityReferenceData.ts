// ============================================
// SPECTRAL OPACITY REFERENCE DATA - подтверждённые справочные данные
// спектральной непрозрачности (Stage 4.8.2.1)
// ============================================
//
// Здесь собраны ТОЛЬКО данные, происхождение которых подтверждено
// загрузкой из первоисточника в этой сессии (поле retrievedAt фиксирует
// дату получения). Ничего не придумано: чего нет в источниках — того нет
// и здесь, а соответствующая физическая валидация помечается
// not_verifiable (см. ReferenceVerificationStatus из atmosphericReferenceProfiles).
//
// Содержание:
//   1. HITRAN_SPECTRAL_CONSTANTS — константы формул HITRAN
//      (https://hitran.org/docs/definitions-and-units/);
//   2. MOLPARAM_FRAGMENT — верифицированный фрагмент molparam.txt
//      (https://hitran.org/media/molparam.txt): распространённость,
//      Q(296 K), вырождение, молярная масса изотополога;
//   3. HITRAN_LINE_LIST_STATUS — статус line-by-line записей (.par):
//      ПОЛНЫЕ записи линий HITRAN не подтверждены загрузкой -> not_verifiable;
//   4. HITRAN_CIA_CONTRACT / MT_CKD_CONTRACT — будущие интерфейсы
//      континуумов. БЕЗ коэффициентов. Расчётные вклады CIA/MT_CKD в
//      line-by-line ядро НЕ включены (риск двойного учёта крыльев).

import type { DataProvenance } from '../Core/scientificValue';

/**
 * Статус верификации спектральных справочных данных. Сознательно ЛОКАЛЬНЫЙ
 * тип: объединение ReferenceVerificationStatus (atmosphericReferenceProfiles)
 * описывает вертикальные профили и не содержит значения для этого случая;
 * здесь честный статус наборов линий/континуумов — только 'not_verifiable'
 * (та же конвенция, что в 4.8.1: не фабриковать табличные данные).
 */
export type SpectralReferenceStatus = 'not_verifiable';

const RETRIEVED_AT = '2026-11-21';

// ============================================
// 1. Константы формул HITRAN
// ============================================

/**
 * c2 = h*c/k = 1.4387769 cm*K — вторая радиационная постоянная в
 * спектроскопических единицах (HITRAN definitions-and-units).
 */
export const secondRadiationConstantCmK = 1.4387769;

/**
 * Константы для расчёта концентраций и доплеровской ширины.
 * kB и NA — фиксированные значения CODATA-2019 (SI, 26-я CGPM);
 * R_u = kB*NA = 8.31446261815324 J/(mol*K) берётся из
 * Core/thermoFunctions.ts (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K), здесь
 * НЕ дублируется.
 */
export const HITRAN_SPECTRAL_CONSTANTS = {
  /** Опорная температура HITRAN, K. */
  referenceTemperatureK: 296,
  /** c2 = hc/k, cm*K (HITRAN). */
  secondRadiationConstantCmK,
  /** Постоянная Больцмана, J/K (CODATA-2019, фиксированное значение). */
  boltzmannJPerK: 1.380649e-23,
  /** Число Авогадро, 1/mol (CODATA-2019, фиксированное значение). */
  avogadroPerMol: 6.02214076e23
} as const;

/** Скорость света в вакууме, m/s (точно, по определению СИ). */
export const speedOfLightMs = 2.99792458e8;

/** ln 2 — входит в формулу доплеровской ширины alpha_D = nu0/c*sqrt(2*kB*T*ln2/m). */
export const ln2 = Math.LN2;

/** sqrt(ln 2) — используется в пересчёте ширины Гаусса (HWHM <-> std). */
export const sqrtLn2 = Math.sqrt(Math.LN2);

export const HITRAN_CONSTANTS_PROVENANCE: DataProvenance = {
  sourceName: 'HITRAN definitions and units page',
  sourceId: 'hitran-definitions-and-units',
  reference: 'https://hitran.org/docs/definitions-and-units/',
  retrievedAt: RETRIEVED_AT,
  method: 'прямое чтение официальной страницы определений и единиц HITRAN',
  applicability:
    'c2 и формула S(T) применимы в рамках модели локального термодинамического равновесия HITRAN; кб/NA — фиксированные значения СИ'
};

// ============================================
// 2. Верифицированный фрагмент molparam.txt
// ============================================

/** Одна запись molparam: изотополог HITRAN. */
export interface MolparamIsotopologueRecord {
  /** gasId каталога данных проекта (Data/gases). */
  readonly gasId: string;
  /** Химическая формула изотополога. */
  readonly formula: string;
  /** Идентификатор изотополога в нотации HITRAN. */
  readonly isotopologueId: string;
  /** Порядковый номер изотополога в HITRAN (локальный id молекулы). */
  readonly hitranMoleculeNumber: number;
  /** Террестриальная (земная) изотопная распространённость, доля. */
  readonly terrestrialAbundance: number;
  /** Статистическая сумма при 296 K (колонка Q(296K) molparam). */
  readonly partitionSumAt296K: number;
  /** Статистический вес основного состояния (gj). */
  readonly groundStateDegeneracy: number;
  /** Молярная масса изотополога, г/моль. */
  readonly molarMassGPerMol: number;
  readonly provenance: DataProvenance;
}

const MOLPARAM_PROVENANCE: DataProvenance = {
  sourceName: 'HITRAN molparam.txt',
  sourceId: 'hitran-molparam',
  datasetId: 'molparam',
  reference: 'https://hitran.org/media/molparam.txt',
  retrievedAt: RETRIEVED_AT,
  method:
    'прямая загрузка molparam.txt; колонки: abundance, Q(296K), gj, Molar Mass (g/mol); перенесены без изменений',
  applicability:
    'распространённости — земные атмосферные; для других планет использовать только через явный изотопный масштаб (isotopicScaleMode)'
};

/** Верифицированный фрагмент molparam (8 изотопологов полностью). */
export const MOLPARAM_FRAGMENT: readonly MolparamIsotopologueRecord[] = [
  {
    gasId: 'h2o',
    formula: 'H2O',
    isotopologueId: '161',
    hitranMoleculeNumber: 1,
    terrestrialAbundance: 9.97317e-1,
    partitionSumAt296K: 1.7458e2,
    groundStateDegeneracy: 1,
    molarMassGPerMol: 18.010565,
    provenance: MOLPARAM_PROVENANCE
  },
  {
    gasId: 'co2',
    formula: 'CO2',
    isotopologueId: '626',
    hitranMoleculeNumber: 2,
    terrestrialAbundance: 9.84204e-1,
    partitionSumAt296K: 2.8609e2,
    groundStateDegeneracy: 1,
    molarMassGPerMol: 43.98983,
    provenance: MOLPARAM_PROVENANCE
  },
  {
    gasId: 'co2',
    formula: 'CO2',
    isotopologueId: '636',
    hitranMoleculeNumber: 2,
    terrestrialAbundance: 1.10574e-2,
    partitionSumAt296K: 5.7664e2,
    groundStateDegeneracy: 2,
    molarMassGPerMol: 44.993185,
    provenance: MOLPARAM_PROVENANCE
  },
  {
    gasId: 'co2',
    formula: 'CO2',
    isotopologueId: '628',
    hitranMoleculeNumber: 2,
    terrestrialAbundance: 3.94707e-3,
    partitionSumAt296K: 6.0781e2,
    groundStateDegeneracy: 1,
    molarMassGPerMol: 45.994076,
    provenance: MOLPARAM_PROVENANCE
  },
  {
    gasId: 'ch4',
    formula: 'CH4',
    isotopologueId: '211',
    hitranMoleculeNumber: 6,
    terrestrialAbundance: 9.88274e-1,
    partitionSumAt296K: 5.9053e2,
    groundStateDegeneracy: 1,
    molarMassGPerMol: 16.0313,
    provenance: MOLPARAM_PROVENANCE
  },
  {
    gasId: 'ch4',
    formula: 'CH4',
    isotopologueId: '311',
    hitranMoleculeNumber: 6,
    terrestrialAbundance: 1.11031e-2,
    partitionSumAt296K: 1.1811e3,
    groundStateDegeneracy: 2,
    molarMassGPerMol: 17.034655,
    provenance: MOLPARAM_PROVENANCE
  },
  {
    gasId: 'co',
    formula: 'CO',
    isotopologueId: '26',
    hitranMoleculeNumber: 5,
    terrestrialAbundance: 9.86544e-1,
    partitionSumAt296K: 1.0742e2,
    groundStateDegeneracy: 1,
    molarMassGPerMol: 27.994915,
    provenance: MOLPARAM_PROVENANCE
  },
  {
    gasId: 'co',
    formula: 'CO',
    isotopologueId: '36',
    hitranMoleculeNumber: 5,
    terrestrialAbundance: 1.10836e-2,
    partitionSumAt296K: 2.247e2,
    groundStateDegeneracy: 2,
    molarMassGPerMol: 28.99827,
    provenance: MOLPARAM_PROVENANCE
  }
] as const;

/** Индекс фрагмента по идентификатору изотополога HITRAN. */
export const MOLPARAM_FRAGMENT_BY_ISO: ReadonlyMap<string, MolparamIsotopologueRecord> = new Map(
  MOLPARAM_FRAGMENT.map((record) => [record.isotopologueId, record])
);

// ============================================
// 3. Статус line-by-line записей
// ============================================

/**
 * ПОЛНЫЕ записи спектральных линий (.par: центр, интенсивность, E'',
 * gamma_air/gamma_self, n, delta) НЕ подтверждены загрузкой в этой сессии
 * (выгрузка HITRAN требует сессионного запроса). Весь line-by-line уровень
 * помечается not_verifiable: физическая валидность конкретных линий из
 * тестов опирается на синтетические фикстуры с явной маркировкой.
 */
export const HITRAN_LINE_LIST_STATUS: { readonly verificationStatus: SpectralReferenceStatus; readonly note: string; readonly reference: string } = {
  verificationStatus: 'not_verifiable',
  note:
    'записи линий HITRAN/HITEMP (.par) не загружены и не сверены с первоисточником; все линии в тестах — синтетические фикстуры и НЕ являются данными HITRAN; partition sums в рамках верифицированного фрагмента ограничены точкой 296 K из molparam',
  reference: 'https://hitran.org/docs/definitions-and-units/'
};

// ============================================
// 4. Будущие интерфейсы континуумов (БЕЗ коэффициентов)
// ============================================

/**
 * Контракт HITRAN CIA (collision-induced absorption): наборы N2-N2,
 * N2-CH4, CO2-CO2 и др. публикуются ОТДЕЛЬНО от line-by-line. В Stage
 * 4.8.2.1 не реализован; коэффициенты НЕ включены (риска двойного учёта
 * с обрезанными крыльями линий избегают отдельным контрактом).
 */
export const HITRAN_CIA_CONTRACT: {
  readonly verificationStatus: SpectralReferenceStatus;
  readonly implemented: false;
  readonly pairs: readonly string[];
  readonly reference: string;
  readonly note: string;
} = {
  verificationStatus: 'not_verifiable',
  implemented: false,
  pairs: ['N2-N2', 'N2-CH4', 'CO2-CO2'],
  reference: 'https://hitran.org/cia/',
  note:
    'фиксация будущего интерфейса; расчётные вклады CIA в spectralOpacity не включены; двойной учёт с крыльями Фойгта исключается только при явном контракте обрезания крыльев'
};

/**
 * Контракт MT_CKD (водяной континуум): отдельная полуэмпирическая модель,
 * НЕ line-by-line; в Stage 4.8.2.1 не реализована, коэффициенты не включены.
 */
export const MT_CKD_CONTRACT: {
  readonly verificationStatus: SpectralReferenceStatus;
  readonly implemented: false;
  readonly reference: string;
  readonly note: string;
} = {
  verificationStatus: 'not_verifiable',
  implemented: false,
  reference: 'https://www.hitran.org/mtckd/',
  note:
    'фиксация будущего интерфейса водяного континуума; вклад MT_CKD не подмешивается в line-by-line сечение без контракта о совместном использовании (двойной учёт крыльев H2O запрещён)'
};
