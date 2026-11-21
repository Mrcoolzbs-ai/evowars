// ============================================
// ATMOSPHERIC REFERENCE PROFILES - независимые контрольные профили (Stage 4.8.1)
// ============================================
//
// Набор референсных данных для проверки гидростатической колонки
// (Core/hydrostaticAtmosphere). Правила честности данных:
//
//  - ТОЧНЫЕ табличные значения хранятся только там, где они
//    перепроверены (USSA 1976: узлы верхней части таблицы слоёв);
//  - общий ориентир и абстрактные значения НЕ превращаются в
//    табличные benchmark-assertions: если точные точки подтвердить
//    нельзя, блок помечен verificationStatus: 'not_verifiable'
//    и используется грубый ориентир (порядок величины), а не
//    фабрикация таблиц;
//  - геопотенциальная и геометрическая высота РАЗДЕЛЕНЫ:
//    z_geo = r0*h_gp / (r0 - h_gp), r0 = 6 356 766 м —
//    исходное определение USSA 1976; обе величины хранятся
//    в исходных единицах и с явной меткой;
//  - наблюдательный профиль НЕ смешивается с идеализированным.
//
// ИСТОЧНИКИ:
//  - Земля: U.S. Standard Atmosphere 1976 (NASA/NOAA/USAF,
//    NASA TM-X-74335). Внимание: USSA использует R*=8.31432
//    J/(mol*K) и M=28.9644 г/моль; код переиспользует
//    UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K и молярные массы каталога
//    Data/gases, поэтому достижимая точность сравнения с
//    опубликованными узлами ограничена (задокументировано в тестах).
//  - Венера: VIRA (1985) и Seiff et al. (1979), DOI 10.1126/science.203.4382.787
//    — здесь только ЯВНЫЕ ориентиры из известной литературы
//    (поверхность ~737 K / ~9.2 МПа; облачный слой 47.5-49 км ~360 K;
//    ~100 км ~175-180 K). Точные табличные узлы VIRA в этой сессии
//    НЕ подтверждены — блок not_verifiable, таблицы не фабрикуются.
//  - Титан: Huygens HASI, Fulchignoni et al. (2005), Nature 438,
//    785-791, DOI 10.1038/nature04314; PDS dataset HASI v1.1.
//    Подтверждён якорь поверхности: T = 93.65 +/- 0.25 K,
//    P = 1467 +/- 1 гПа. Полный профиль HASI (1400 км -> поверхность)
//    в цифровом виде не подключён — mid-profile сравнение
//    not_verifiable.

import type { DataProvenance } from '../Core/scientificValue';
import { G } from '../Units';

// ============================================
// ЗЕМЛЯ: U.S. Standard Atmosphere 1976
// ============================================

export const USSA_1976_PROVENANCE: DataProvenance = {
  sourceName: 'U.S. Standard Atmosphere 1976 (NASA/NOAA/USAF)',
  sourceId: 'NASA TM-X-74335',
  datasetId: 'ussa-1976-main-layers',
  datasetVersion: '1976',
  method: 'piecewise-linear temperature vs geopotential height; published table nodes',
  applicability: 'нижняя и средняя атмосфера Земли до 84.852 km геопотенциальной высоты (86 km геометрической)',
  limitations:
    'геопотенциальная высота; средние, климатологические условия; R*=8.31432 J/(mol*K), M=28.9644 g/mol в исходном документе',
  conditions: 'latitude ~45 deg, annual mean',
  note: 'узлы перепроверены независимым пересчётом piecewise-модели (P до 1.8e-4 относительного)'
};

/** Константы USSA 1976 (исходные единицы документа). */
export const USSA_1976_CONSTANTS = {
  /** Эффективный радиус геопотенциального преобразования, м. */
  r0M: 6356766,
  /** Стандартное ускорение свободного падения, м/с^2. */
  g0Ms2: 9.80665,
  /** Средняя молярная масса сухого воздуха документа, г/моль. */
  meanMolarMassGPerMol: 28.9644
} as const;

/** Геопотенциальная -> геометрическая высота (исходное определение USSA 1976). */
export function geopotentialToGeometricM(geopotentialHeightM: number): number {
  const r0 = USSA_1976_CONSTANTS.r0M;
  return (r0 * geopotentialHeightM) / (r0 - geopotentialHeightM);
}

/** Семь основных слоёв USSA 1976 (температура линейна по геопотенциальной высоте). */
export interface Ussa1976LayerRecord {
  readonly layerIndex: number;
  /** Нижняя граница, м геопотенциальной высоты. */
  readonly geopotentialBottomM: number;
  /** Верхняя граница, м геопотенциальной высоты. */
  readonly geopotentialTopM: number;
  /** Нижняя граница, м геометрической высоты (преобразование по определению документа). */
  readonly geometricBottomM: number;
  readonly geometricTopM: number;
  /** Базовая температура слоя на нижней границе, K. */
  readonly baseTemperatureK: number;
  /**
   * Lapse rate по геопотенциальной высоте, K/км; ЗНАКОВЫЙ градиент
   * dT/dh в конвенции USSA 1976 (отрицательный = T убывает с высотой).
   */
  readonly lapseRateKPerKm: number;
}

function ussaLayer(
  layerIndex: number,
  geopotentialBottomM: number,
  geopotentialTopM: number,
  baseTemperatureK: number,
  lapseRateKPerKm: number
): Ussa1976LayerRecord {
  return {
    layerIndex,
    geopotentialBottomM,
    geopotentialTopM,
    geometricBottomM: geopotentialToGeometricM(geopotentialBottomM),
    geometricTopM: geopotentialToGeometricM(geopotentialTopM),
    baseTemperatureK,
    lapseRateKPerKm
  };
}

export const USSA_1976_LAYERS: readonly Ussa1976LayerRecord[] = [
  ussaLayer(0, 0, 11000, 288.15, -6.5),
  ussaLayer(1, 11000, 20000, 216.65, 0),
  ussaLayer(2, 20000, 32000, 216.65, 1.0),
  ussaLayer(3, 32000, 47000, 228.65, 2.8),
  ussaLayer(4, 47000, 51000, 270.65, 0),
  ussaLayer(5, 51000, 71000, 270.65, -2.8),
  ussaLayer(6, 71000, 84852, 214.65, -2.0)
];

/** Опубликованный контрольный узел USSA 1976 (границы слоёв). */
export interface Ussa1976CheckNode {
  /** Геопотенциальная высота, м. */
  readonly geopotentialHeightM: number;
  /** Геометрическая высота, м (той же строки таблицы). */
  readonly geometricHeightM: number;
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly densityKgPerM3: number;
}

/**
 * Опубликованные узлы верхней части таблицы слоёв USSA 1976
 * (включая поверхность). Последний узел: таблица даёт 186.87 K
 * на 86 km геометрической; pure piecewise-модель даёт 186.946 K
 * (расхождение 4e-4 относительного — задокументировано).
 */
export const USSA_1976_CHECK_NODES: readonly Ussa1976CheckNode[] = [
  { geopotentialHeightM: 0, geometricHeightM: 0, temperatureK: 288.15, pressurePa: 101325, densityKgPerM3: 1.2250 },
  {
    geopotentialHeightM: 11000,
    geometricHeightM: geopotentialToGeometricM(11000),
    temperatureK: 216.65,
    pressurePa: 22632.06,
    densityKgPerM3: 0.36391
  },
  {
    geopotentialHeightM: 20000,
    geometricHeightM: geopotentialToGeometricM(20000),
    temperatureK: 216.65,
    pressurePa: 5474.89,
    densityKgPerM3: 0.088035
  },
  {
    geopotentialHeightM: 32000,
    geometricHeightM: geopotentialToGeometricM(32000),
    temperatureK: 228.65,
    pressurePa: 868.019,
    densityKgPerM3: 0.013225
  },
  {
    geopotentialHeightM: 47000,
    geometricHeightM: geopotentialToGeometricM(47000),
    temperatureK: 270.65,
    pressurePa: 110.906,
    densityKgPerM3: 1.42753e-3
  },
  {
    geopotentialHeightM: 51000,
    geometricHeightM: geopotentialToGeometricM(51000),
    temperatureK: 270.65,
    pressurePa: 66.9389,
    densityKgPerM3: 8.61017e-4
  },
  {
    geopotentialHeightM: 71000,
    geometricHeightM: geopotentialToGeometricM(71000),
    temperatureK: 214.65,
    pressurePa: 3.95642,
    densityKgPerM3: 6.42110e-5
  },
  {
    geopotentialHeightM: 84852,
    geometricHeightM: geopotentialToGeometricM(84852),
    temperatureK: 186.87,
    pressurePa: 0.3734,
    densityKgPerM3: 6.958e-6
  }
];

/**
 * Эквивалентная масса Земли, согласующая g(z=r0)=g0:
 * M = g0 * r0^2 / G (G из Units/CODATA). Даёт гравитацию,
 * неотличимую от собственной зависимости g(z) USSA.
 */
export const USSA_1976_EQUIVALENT_BODY_MASS_KG: number =
  (USSA_1976_CONSTANTS.g0Ms2 * USSA_1976_CONSTANTS.r0M * USSA_1976_CONSTANTS.r0M) / G;

/** Состав сухого воздуха (молярные доли); источник — стандартный сухой воздух USSA 1976 гл. 1. */
export const USSA_1976_DRY_AIR_COMPOSITION = {
  gases: [
    { gasId: 'n2', moleFraction: 0.7808 },
    { gasId: 'o2', moleFraction: 0.2095 },
    { gasId: 'ar', moleFraction: 0.0093 },
    { gasId: 'co2', moleFraction: 0.0004 }
  ],
  provenance: {
    sourceName: 'U.S. Standard Atmosphere 1976, сухой воздух',
    sourceId: 'NASA TM-X-74335',
    method: 'штатный молярный состав сухого воздуха, приближение постоянства по высоте',
    limitations:
      'реальный состав меняется по высоте (озон выше 10 км, водяной пар ниже); кусочно-постоянное допущение без диффузионной сепарации',
    conditions: 'сухой воздух, без конденсации'
  } as DataProvenance
} as const;

// ============================================
// ВЕНЕРА: VIRA-ориентиры (NOT_VERIFIABLE таблично)
// ============================================

export type ReferenceVerificationStatus =
  | 'published_table_nodes'
  | 'orientation_anchors_only_not_verifiable'
  | 'surface_anchor_verified_profile_not_verifiable';

export const VENUS_VIRA_ORIENTATION = {
  bodyId: 'venus',
  verificationStatus: 'orientation_anchors_only_not_verifiable' as ReferenceVerificationStatus,
  body: {
    bodyMassKg: 4.8675e24,
    referenceRadiusM: 6.0518e6,
    provenance: {
      sourceName: 'NASA Planetary Fact Sheet (Venus)',
      method: 'стандартные планетарные constants (IAU/факт-лист)',
      limitations: 'опорный радиус среднего уровня; гидростатическая модель без сплюснутости'
    } as DataProvenance
  },
  /** Явные ориентиры (НЕ табличные узлы VIRA). */
  orientationAnchors: [
    { label: 'surface', heightM: 0, temperatureK: 737, note: 'поверхность, порядок 735-737 K' },
    { label: 'cloud_deck', heightMinM: 47500, heightMaxM: 49000, temperatureK: 360, note: 'облачный слой ~360 K' },
    { label: 'upper_level', heightM: 100000, temperatureK: 178, note: '~100 км, 175-180 K (ориентир)' }
  ],
  /** Явные ориентиры поверхностного давления. */
  surfacePressurePa: 9.2e6,
  surfacePressureNote: 'порядок 9.2 МПа (не точная табличная величина)',
  /** Объёмный состав нижней атмосферы (VIRA, ориентир постоянства по высоте). */
  composition: {
    gases: [
      { gasId: 'co2', moleFraction: 0.965 },
      { gasId: 'n2', moleFraction: 0.035 }
    ],
    provenance: {
      sourceName: 'VIRA (1985), объёмный состав нижней атмосферы',
      method: 'bulk composition; допущение кусочной постоянства по высоте не оправдано выше гомопаузы',
      limitations: 'точный вертикальный состав VIRA не подключён; допущение ЯВНОЕ'
    } as DataProvenance
  },
  provenance: {
    sourceName: 'Venus International Reference Atmosphere (VIRA, 1985); Seiff et al. 1979',
    sourceId: 'DOI 10.1126/science.203.4382.787',
    datasetId: 'vira-1985-orientation',
    verification: 'точные табличные узлы в этой сессии не подтверждены; только ориентиры',
    limitations: 'не смешивать ориентиры с точными табличными данными VIRA'
  } as DataProvenance
} as const;

// ============================================
// ТИТАН: Huygens HASI (якорь поверхности подтверждён)
// ============================================

export const TITAN_HASI_SURFACE_ANCHOR = {
  bodyId: 'titan',
  verificationStatus: 'surface_anchor_verified_profile_not_verifiable' as ReferenceVerificationStatus,
  body: {
    bodyMassKg: 1.3452e23,
    referenceRadiusM: 2.5747e6,
    provenance: {
      sourceName: 'NASA Planetary Fact Sheet (Titan)',
      method: 'стандартные планетарные constants (IAU/факт-лист)',
      limitations: 'опорный радиус; гидростатическая модель без сплюснутости'
    } as DataProvenance
  },
  surface: {
    temperatureK: 93.65,
    temperatureUncertaintyK: 0.25,
    pressureHpa: 1467,
    pressureUncertaintyHpa: 1,
    pressurePa: 1.467e5
  },
  /** Приземный состав (N2 + CH4); параметр при 5% CH4 — ориентир GCMS. */
  nearSurfaceComposition: {
    gases: [
      { gasId: 'n2', moleFraction: 0.95 },
      { gasId: 'ch4', moleFraction: 0.05 }
    ],
    provenance: {
      sourceName: 'Niemann et al. 2005 (Huygens GCMS), ориентир приземного состава',
      method: 'bulk приземный состав; ~5% CH4 у поверхности',
      limitations:
        'вертикальный состав Титана переменен (CH4 падает в стратосфере); постоянство по высоте — ЯВНОЕ допущение, не измерение'
    } as DataProvenance
  },
  provenance: {
    sourceName: 'Fulchignoni et al. (2005), Nature 438, 785-791 (Huygens HASI)',
    sourceId: 'DOI 10.1038/nature04314',
    datasetId: 'huygens-hasi-atmos-structure',
    datasetVersion: 'PDS v1.1',
    method: 'in-situ измерения профиля при спуске зонда',
    conditions: 'точка посадки, нисходящий зонд; время и координаты заданы датасетом HASI',
    limitations:
      'измерение охватывает спуск от ~1400 км до поверхности; нижние 60 км НЕ есть полный профиль атмосферы до экзобазы; цифровой таблицы в этой сессии не подключено',
    note: 'якорь поверхности подтверждён публикацией; mid-profile узлы не подтверждены'
  } as DataProvenance
} as const;
