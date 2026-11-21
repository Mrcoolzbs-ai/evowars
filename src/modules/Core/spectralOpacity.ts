// ============================================
// SPECTRAL OPACITY - спектральная непрозрачность газовой смеси (Stage 4.8.2.1)
// ============================================
//
// Вычислительное ядро поглощения line-by-line для локального состояния
// атмосферного слоя (P, T, молярные доли). Компонент Stage 4.8.2,
// предназначенный для будущей радиационно-конвективной модели; сам по себе
// НЕ решает перенос: потоков, температур поверхности и климата здесь нет.
//
// Формулы (HITRAN, https://hitran.org/docs/definitions-and-units/):
//
//   S(T) = S(Tref) * Q(Tref)/Q(T)
//          * exp[-c2*E''*(1/T - 1/Tref)]
//          * (1 - exp(-c2*nu0/T)) / (1 - exp(-c2*nu0/Tref))
//
//   alpha_D (Доплер, HWHM) = nu0/c * sqrt(2*kB*T*ln2/m) =
//            = nu0/c * sqrt(2*R_u*T*ln2*1000/M_g_per_mol)
//   gamma_L(T,p) = sum_b gamma_b(Tref) * (p_b/p_ref) * (Tref/T)^{n_b}
//                  p_b = x_b * p;  p_ref = 1 atm = 101325 Pa
//   nu* = nu0 + sum_b delta_b * (p_b/p_ref)   (только при ИЗВЕСТНЫХ delta_b)
//
//   sigma(nu) [cm^2/molecule] = S(T) [cm/molecule] * f_V(nu) [cm]
//   sigma [m^2/molecule] = sigma [cm^2/molecule] * 1e-4
//   n_total = P/(kB*T);  n_i = x_i * n_total;  alpha = sum_i n_i * sigma_i
//
// Единицы. HITRAN хранит cgs-единицы: S - cm/molecule, gamma/delta -
// cm-1/atm при Tref = 296 K и p_ref = 1 atm, центр линии - см-1 (вакуум).
// Каждая конверсия в SI выполняется ЯВНО:
//   gamma: cm-1/atm * p_atm -> cm-1 (p_atm = p_Pa / 101325);
//   S: cm/molecule (конверсий не требует, уже линейная плотность сечения);
//   sigma: S*F даёт cm^2/molecule; в public-результат умножается на 1e-4
//   (1 cm^2 = 1e-4 m^2). Множители 1e4/1e2/1e6 в коде не появляются.
//
// Профиль Фойгта: алгоритм Humlicek (JQSRT 27, 437; 1982) в редакции
// R. J. Wells (JQSRT 62, 29; 1999), вариант кода ROOT TMath/voigt.c.
// Это настоящая свёртка Гаусса и Лоренца (не псевдо-Фойгт); рабочая
// относительная точность не хуже 1e-4 (внутренние численные тесты
// воспроизводят пределы Гаусса/Лоренца и независимую квадратуру ядра
// K(x,y) с отклонением <= 1e-4). Сложные профили (speed-dependent,
// Rautian и др.) не поддерживаются — это явное ограничение.
//
// Fail-closed принципы проекта:
//   - неизвестный gasId поглотителя или неизвестная молярная масса
//     изотополога -> out_of_applicability, а не ноль;
//   - отсутствующий коэффициент уширения НЕ замещается air-broadening;
//   - partition sum отсутствует или T вне её диапазона -> out_of_applicability;
//   - сумма молярных долей не нормализуется молча;
//   - NaN/Inf и отрицательные величины отклоняются на входе.
//
// НЕ реализовано в этом этапе (см. docs/science/IMPLEMENTATION_ROADMAP.md):
// РК-перенос, CIA-континуум (N2-N2, N2-CH4, CO2-CO2 — интерфейсы
// зафиксированы в Data/spectralOpacityReferenceData.ts, коэффициенты
// не включены), MT_CKD континуум воды, аэрозоли и рассеяние.

import { ATM_TO_PA } from '../Units';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from './thermoFunctions';
import type { DataProvenance } from './scientificValue';
import { tryGetGasSpecies } from '../Data/gases';
import {
  HITRAN_SPECTRAL_CONSTANTS,
  MOLPARAM_FRAGMENT_BY_ISO,
  ln2,
  speedOfLightMs
} from '../Data/spectralOpacityReferenceData';

// ============================================
// ТИПЫ
// ============================================

/** Спектральная сетка по волновому числу, cm-1 (строго возрастающая). */
export interface SpectralGridSpec {
  /** Начало сетки, cm-1. */
  readonly startWavenumberCm1: number;
  /** Конец сетки, cm-1 (строго больше начала). */
  readonly endWavenumberCm1: number;
  /** Положительный шаг сетки, cm-1. */
  readonly stepCm1: number;
}

/** Коэффициент уширения для КОНКРЕТНОГО уширителя (не взаимозаменяемы). */
export interface SpectralBroadeningCoefficient {
  /** HWHM при T_ref и p_ref = 1 atm, cm-1/atm. */
  readonly gammaCm1PerAtmAtRef: number;
  /** Температурный показатель n_b. */
  readonly temperatureExponent: number;
}

/** Коэффициент сдвига центра линии давлением, cm-1/atm при T_ref. */
export interface SpectralPressureShift {
  readonly shiftCm1PerAtmAtRef: number;
}

/**
 * Запись спектральной линии. Интенсивность и ширины — в HITRAN cgs.
 * Ключи broadening/pressureShift — идентичности уширителей: 'self',
 * 'air' (смесь земного воздуха — применяется ТОЛЬКО если она явно
 * задана в broadeners) или gasId каталога данных (например 'n2', 'co2',
 * 'h2', 'he'). Никакой автоподстановки несуществующего уширителя.
 */
export interface SpectralLineRecord {
  /** Идентификатор линии внутри набора (для трассировки). */
  readonly lineId: string;
  /** Идентификатор молекулы (например 'H2O', 'CO2'). */
  readonly moleculeId: string;
  /** Идентификатор изотополога в нотации HITRAN (например '161'). */
  readonly isotopologueId: string;
  /** Вакуумное волновое число центра линии, cm-1. */
  readonly wavenumberCm1: number;
  /** Интенсивность при T_ref, cm/molecule (398, HITRAN S_v, 296 K). */
  readonly intensityCmPerMoleculeAtRef: number;
  /** Энергия нижнего состояния E'', cm-1. */
  readonly lowerStateEnergyCm1: number;
  /** Коэффициенты уширения по уширителям (только известные). */
  readonly broadening: Readonly<Record<string, SpectralBroadeningCoefficient | undefined>>;
  /** Коэффициенты сдвига линии по уширителям (только известные). */
  readonly pressureShift?: Readonly<Record<string, SpectralPressureShift | undefined>>;
  /**
   * true — интенсивность уже включает земную изотопную распространённость
   * (стандарт HITRAN); при расчёте для неиземной планеты это ЯВНОЕ
   * допущение, либо применяется коррекция по фактической распространённости.
   */
  readonly intensityIncludesTerrestrialAbundance: boolean;
  /** Происхождение записи (набор, версия, диапазон применимости). */
  readonly provenance: DataProvenance;
}

/**
 * Статистическая сумма Q(T) из подтверждённого источника (TIPS/HITRAN или
 * другая явно указанная база). Одна точка допускается: тогда расчёт возможен
 * ТОЛЬКО при T, совпадающей с этой точкой (в пределах допуска).
 */
export interface PartitionSumRecord {
  readonly isotopologueId: string;
  readonly points: readonly { readonly temperatureK: number; readonly partitionSum: number }[];
  readonly provenance: DataProvenance;
}

/** Спецификация поглощающего компонента смеси. */
export interface SpectralOpacitySpeciesSpec {
  /** gasId из каталога данных (Data/gases); вне каталога -> out_of_applicability. */
  readonly gasId: string;
  /** HITRAN-идентификатор изотополога (например '161'). */
  readonly isotopologueId: string;
  /** Линии этого изотополога в заданном диапазоне. */
  readonly lines: readonly SpectralLineRecord[];
  /** Статистическая сумма; обязательна для приведения S(T). */
  readonly partitionSum?: PartitionSumRecord;
  /** Фактическая изотопная распространённость (для 'explicit-ratio'). */
  readonly actualIsotopicAbundance?: number;
  /**
   * Молярная масса изотополога, г/моль. Если не задана, берётся из
   * верифицированного фрагмента molparam (Data/spectralOpacityReferenceData);
   * при отсутствии и там -> out_of_applicability.
   */
  readonly isotopologueMassGPerMol?: number;
}

/** Уширитель. 'self' как gasId запрещён: self-уширение выводится из молярной доли самого поглощающего газа автоматически. */
export interface SpectralOpacityBroadenerSpec {
  /** gasId каталога данных либо 'air' (смесь земного воздуха). */
  readonly gasId: string;
  /** Молярная доля уширителя в смеси, 0..1. */
  readonly moleFraction: number;
}

/** Вход основной функции. Состояние одного локального слоя атмосферы. */
export interface SpectralOpacityInput {
  /** Давление слоя, Pa (> 0). */
  readonly pressurePa: number;
  /** Температура слоя, K (> 0). */
  readonly temperatureK: number;
  /** Поглощающие компоненты (>= 1). */
  readonly species: readonly SpectralOpacitySpeciesSpec[];
  /**
   * Полный состав смеси как столб столкновительных партнёров (включая сами
   * поглощающие газы — для self-broadening). НЕ нормализуется.
   */
  readonly broadeners: readonly SpectralOpacityBroadenerSpec[];
  /** Спектральная сетка, cm-1. */
  readonly grid: SpectralGridSpec;
  /**
   * Режим изотопной коррекции для линий с intensityIncludesTerrestrialAbundance:
   *  - 'terrestrial-assumption' (по умолчанию): коэффициент = 1, но допущение
   *    о земной распространённости ЗАПИСЫВАЕТСЯ в assumptions;
   *  - 'explicit-ratio': требуется actualIsotopicAbundance и опорная
   *    распространённость из molparam; иначе out_of_applicability.
   */
  readonly isotopicScaleMode?: 'terrestrial-assumption' | 'explicit-ratio';
}

// ============================================
// ПУБЛИЧНЫЙ РЕЗУЛЬТАТ
// ============================================

/** Использованная линия после расчёта всех величин при (p, T). */
export interface SpectralLineUsage {
  readonly lineId: string;
  readonly gasId: string;
  readonly isotopologueId: string;
  /** Центр линии со сдвигом (или без), cm-1. */
  readonly wavenumberCm1Shifted: number;
  /** Интенсивность S(T) после коррекции и изотопного масштаба, cm/molecule. */
  readonly intensityCmPerMoleculeAtT: number;
  /** Полный лоренцев HWHM смеси, cm-1. */
  readonly gammaLorentzCm1: number;
  /** Доплеровский HWHM, cm-1. */
  readonly gammaDopplerCm1: number;
  /** Приложенный сдвиг, cm-1 (0 — если коэффициент не подтверждён). */
  readonly pressureShiftCm1: number;
  /** Из каких уширителей собран gammaLorentzCm1. */
  readonly broadenersUsed: readonly {
    readonly gasId: string;
    readonly partialPressureAtm: number;
    readonly gammaCm1: number;
  }[];
}

/** Вклад одного поглощающего газа. */
export interface SpectralSpeciesContribution {
  readonly gasId: string;
  readonly isotopologueId: string;
  /** Концентрация молекул этого газа, m-3. */
  readonly numberDensityPerM3: number;
  /** Сечение sum_i S(T)*f_V по всем линиям, m2/molecule (на сетке). */
  readonly crossSectionM2PerMolecule: readonly number[];
  /** Объёмный коэффициент поглощения n_i*sigma_i, m-1 (на сетке). */
  readonly absorptionCoefficientPerM: readonly number[];
}

/** Успешный расчёт. */
export interface SpectralOpacityCompleted {
  readonly status: 'completed';
  /** Спектральная сетка, cm-1 (равномерная, start..end). */
  readonly gridCm1: readonly number[];
  /** Суммарное сечение смеси, m2/molecule (на сетке). */
  readonly crossSectionM2PerMolecule: readonly number[];
  /** Суммарный объёмный коэффициент поглощения, m-1 (на сетке). */
  readonly absorptionCoefficientPerM: readonly number[];
  /** Вклады по поглощающим газам. */
  readonly contributions: readonly SpectralSpeciesContribution[];
  /** Использованные линии. */
  readonly linesUsed: readonly SpectralLineUsage[];
  /** Полная концентрация молекул смеси P/(kB*T), m-3. */
  readonly totalNumberDensityPerM3: number;
  /** Явно перечисленные допущения (идеальный газ, окно, распространённость). */
  readonly assumptions: readonly string[];
  /** Диагностика применимости (не маскируется). */
  readonly applicabilityDiagnostics: readonly string[];
  /** Явные конверсии единиц (трассируемость cgs -> SI). */
  readonly unitConversions: readonly string[];
  readonly provenance: {
    readonly dataSets: readonly DataProvenance[];
    readonly module: string;
  };
}

export type SpectralOpacityResult =
  | SpectralOpacityCompleted
  | { readonly status: 'invalid_input'; readonly errors: readonly string[] }
  | {
      readonly status: 'out_of_applicability';
      readonly reason: string;
      readonly missingParameters?: readonly string[];
    }
  | { readonly status: 'numerical_failure'; readonly reason: string };

// ============================================
// ПАРАМЕТРЫ ПО УМОЛЧАНИЮ
// ============================================

export const SPECTRAL_OPACITY_DEFAULTS = {
  /** Опорная температура HITRAN, K. */
  referenceTemperatureK: 296,
  /** Жёсткий предел числа узлов сетки (защита от неограниченного расчёта). */
  maxGridPoints: 20001,
  /**
   * Ушитель считается «существенным»: при доле >= этого порога отсутствие
   * подтверждённого коэффициента уширения для линии означает
   * out_of_applicability, а не нулевой вклад.
   */
  significantBroadenerMoleFraction: 0.01,
  /** Допуск на сумму молярных долей (нормировка не выполняется). */
  moleFractionSumTolerance: 1e-6
} as const;

// ============================================
// АТОМНЫЕ ФОРМУЛЫ (экспортируются для тестов)
// ============================================

/**
 * Доплеровский HWHM (cm-1) по HITRAN:
 * alpha_D = nu0/c * sqrt(2*kB*T*ln2/m), m = M[kg/mol]/N_A.
 * Через универсальную газовую постоянную (kB*NA = R_u):
 * alpha_D = nu0/c * sqrt(2*R_u*T*ln2*1000/M[g/mol]).
 */
export function dopplerHwhmCm1(input: {
  wavenumberCm1: number;
  temperatureK: number;
  molarMassGPerMol: number;
}): number {
  if (input.wavenumberCm1 <= 0 || input.temperatureK <= 0 || input.molarMassGPerMol <= 0) {
    return NaN;
  }
  const velocityWidthMs = Math.sqrt(
    (2 * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * input.temperatureK * ln2 * 1000) / input.molarMassGPerMol
  );
  return (input.wavenumberCm1 * velocityWidthMs) / speedOfLightMs;
}

/**
 * Полный лоренцев HWHM смеси (cm-1) по парциальным давлениям:
 * gamma_L = sum_b gamma_b(Tref)*(p_b/p_ref)*(Tref/T)^{n_b}.
 * PARTIALS — уже в atm, p_ref = 1 atm у учтена в формуле как деление на 1.
 */
export function lorentzHwhmCm1({
  temperatureK,
  referenceTemperatureK,
  partials
}: {
  temperatureK: number;
  referenceTemperatureK: number;
  partials: readonly {
    readonly gammaCm1PerAtmAtRef: number;
    readonly temperatureExponent: number;
    readonly partialPressureAtm: number;
  }[];
}): number {
  let gamma = 0;
  for (const b of partials) {
    gamma += b.gammaCm1PerAtmAtRef * b.partialPressureAtm * Math.pow(referenceTemperatureK / temperatureK, b.temperatureExponent);
  }
  return gamma;
}

/** Профиль Фойгта, нормированный по волновому числу (cm). */
export function voigtProfileCm({
  offsetCm1,
  dopplerHwhmCm1: alphaD,
  lorentzHwhmCm1: gammaL
}: {
  offsetCm1: number;
  dopplerHwhmCm1: number;
  lorentzHwhmCm1: number;
}): number {
  const sigma = alphaD / Math.sqrt(2 * Math.LN2); // std гауссовой компоненты
  return voigtWells(offsetCm1, sigma, 2 * gammaL);
}

/**
 * Статистическая сумма Q(T) по подписанному набору точек: линейная
 * интерполяция СТРОГО внутри [min, max] диапазона (редкие сезонные
 * экстраполяции запрещены); null — T вне диапазона данных или набор
 * некорректен. Для единственной точки допускается только совпадение T.
 */
export function partitionSumAtTemperature(
  record: PartitionSumRecord,
  temperatureK: number
): number | null {
  const pts = record.points;
  if (pts.length === 0) return null;
  for (const p of pts) {
    if (!Number.isFinite(p.temperatureK) || !Number.isFinite(p.partitionSum) || p.temperatureK <= 0 || p.partitionSum <= 0) {
      return null;
    }
  }
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].temperatureK <= pts[i - 1].temperatureK) return null; // строго возрастающие
  }
  const minT = pts[0].temperatureK;
  const maxT = pts[pts.length - 1].temperatureK;
  if (temperatureK < minT || temperatureK > maxT) return null;
  if (pts.length === 1) {
    return Math.abs(temperatureK - minT) <= 1e-6 * minT ? pts[0].partitionSum : null;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (temperatureK <= b.temperatureK) {
      const frac = (temperatureK - a.temperatureK) / (b.temperatureK - a.temperatureK);
      return a.partitionSum + frac * (b.partitionSum - a.partitionSum);
    }
  }
  return pts[pts.length - 1].partitionSum;
}

/**
 * Температурная поправка S(T)/S(Tref) по формуле HITRAN (без изотопного
 * масштаба и без его учёта в Q): см. формулу в заголовке файла.
 */
export function temperatureIntensityRatio(input: {
  wavenumberCm1: number;
  lowerStateEnergyCm1: number;
  temperatureK: number;
  referenceTemperatureK: number;
  partitionSumAtT: number;
  partitionSumAtRef: number;
}): number {
  const c2 = HITRAN_SPECTRAL_CONSTANTS.secondRadiationConstantCmK;
  const { wavenumberCm1: nu0, lowerStateEnergyCm1: epp, temperatureK: t, referenceTemperatureK: tref } = input;
  const boltzmannPopulations = Math.exp(-c2 * epp * (1 / t - 1 / tref));
  const stimulated =
    (1 - Math.exp(-c2 * nu0 / t)) / (1 - Math.exp(-c2 * nu0 / tref));
  return (input.partitionSumAtRef / input.partitionSumAtT) * boltzmannPopulations * stimulated;
}

/** Изотопный масштаб к интенсивности: доля_факт / доля_опорная-земная (>= 0). */
export function isotopeScaleFactor(actualAbundance: number, terrestrialAbundance: number): number {
  if (!Number.isFinite(actualAbundance) || actualAbundance < 0) return NaN;
  if (!Number.isFinite(terrestrialAbundance) || terrestrialAbundance <= 0) return NaN;
  return actualAbundance / terrestrialAbundance;
}

// ============================================
// ПРОФИЛЬ ФОЙГТА: Humlicek/Wells
// ============================================
//
// Транскрипция voigt.c (ROOT TMath; авторы Miha D. Puc, ROOT team;
// алгоритм Humlicek JQSRT 21, 437 (1982) в редакции Wells JQSRT 62, 29
// (1999)); параметры: sigma — std гауссовой компоненты, lg — FWHM
// лоренцевой (вызывается как 2*HWHM). Возвращает нормированный профиль
// (интеграл по всем xx = 1). Рабочая относительная точность не хуже 1e-4.

function voigtWells(xx: number, sigma: number, lg: number): number {
  // Предельные ветви (в основном расчёте sigma > 0 и lg > 0 всегда:
  // T > 0 и (P > 0 или чисто доплеровский расчёт), но ветви сохранены
  // как документированное поведение алгоритма).
  if (sigma === 0) return (lg * 0.25) / (Math.PI * (xx * xx + (lg / 2) * (lg / 2)));
  if (lg === 0) {
    return 0.39894228 / sigma * Math.exp(-(xx * xx) / (2 * sigma * sigma));
  }
  if (sigma < 0 || lg < 0) return NaN;

  const rrtpi = 0.56418958; // 1/sqrt(pi)
  const y0 = 1.5;
  const y0q = y0 * y0;

  // Константы CPF12 (Humlicek 1979).
  const c = [1.0117281, -0.75197147, 0.012557727, 0.010022008, -0.00024206814, 0.00000050084806];
  const s = [1.393237, 0.23115241, -0.15535147, 0.0062183662, 0.000091908299, -0.00000062752596];
  const t = [0.31424038, 0.94778839, 1.5976826, 2.2795071, 3.0206370, 3.8897249];

  const r = 4; // целевая точность декад
  const r0 = 1.51 * Math.exp(1.144 * r);
  const r1 = 1.6 * Math.exp(0.554 * r);

  const x = xx / sigma / 1.41421356;
  const yv = lg / 2 / sigma / 1.41421356;
  const yqv = yv * yv;
  const yrrtpi = yv * rrtpi;

  const xlim0 = r0 - yv;
  let xlim1 = r1 - yv;
  const xlim3 = 3.097 * yv - 0.45;
  let xlim2 = 6.8 - yv;
  const xlim4 = 18.1 * yv + 1.65;
  if (yv <= 1e-6) {
    xlim1 = xlim0;
    xlim2 = xlim0;
  }

  const abx = Math.abs(x);
  const xq = abx * abx;
  let k: number;

  const mq: number[] = new Array(6);
  const pq: number[] = new Array(6);
  const xm: number[] = new Array(6);
  const xp: number[] = new Array(6);
  const ym: number[] = new Array(6);
  const yp: number[] = new Array(6);

  if (abx > xlim0) {
    // Region 0: далёкие крылья, асимптотика.
    k = yrrtpi / (xq + yqv);
  } else if (abx > xlim1) {
    // Humlicek W4 Region 1.
    const a0 = yqv + 0.5;
    const d0 = a0 * a0;
    const d2 = yqv + yqv - 1.0;
    const d = rrtpi / (d0 + xq * (d2 + xq));
    k = d * yv * (a0 + xq);
  } else if (abx > xlim2) {
    // Humlicek W4 Region 2.
    const h0 = 0.5625 + yqv * (4.5 + yqv * (10.5 + yqv * (6.0 + yqv)));
    const h2 = -4.5 + yqv * (9.0 + yqv * (6.0 + yqv * 4.0));
    const h4 = 10.5 - yqv * (6.0 - yqv * 6.0);
    const h6 = -6.0 + yqv * 4.0;
    const e0 = 1.875 + yqv * (8.25 + yqv * (5.5 + yqv));
    const e2 = 5.25 + yqv * (1.0 + yqv * 3.0);
    const e4 = 0.75 * h6;
    const d = rrtpi / (h0 + xq * (h2 + xq * (h4 + xq * (h6 + xq))));
    k = d * yv * (e0 + xq * (e2 + xq * (e4 + xq)));
  } else if (abx < xlim3) {
    // Humlicek W4 Region 3 (ядро линии).
    const z0 = 272.1014 + yv * (1280.829 + yv * (2802.870 + yv * (3764.966 + yv * (3447.629 + yv * (2256.981 + yv * (1074.409 + yv * (369.1989 + yv * (88.26741 + yv * (13.39880 + yv)))))))));
    const z2 = 211.678 + yv * (902.3066 + yv * (1758.336 + yv * (2037.310 + yv * (1549.675 + yv * (793.4273 + yv * (266.2987 + yv * (53.59518 + yv * 5.0)))))));
    const z4 = 78.86585 + yv * (308.1852 + yv * (497.3014 + yv * (479.2576 + yv * (269.2916 + yv * (80.39278 + yv * 10.0)))));
    const z6 = 22.03523 + yv * (55.02933 + yv * (92.75679 + yv * (53.59518 + yv * 10.0)));
    const z8 = 1.49646 + yv * (13.3988 + yv * 5.0);
    const p0 = 153.5168 + yv * (549.3954 + yv * (919.4955 + yv * (946.897 + yv * (662.8097 + yv * (328.2151 + yv * (115.3772 + yv * (27.93941 + yv * (4.264678 + yv * 0.3183291))))))));
    const p2 = -34.16955 + yv * (-1.322256 + yv * (124.5975 + yv * (189.773 + yv * (139.4665 + yv * (56.81652 + yv * (12.79458 + yv * 1.2733163))))));
    const p4 = 2.584042 + yv * (10.46332 + yv * (24.01655 + yv * (29.81482 + yv * (12.79568 + yv * 1.9099744))));
    const p6 = -0.07272979 + yv * (0.9377051 + yv * (4.266322 + yv * 1.273316));
    const p8 = 0.0005480304 + yv * 0.3183291;
    const d = 1.7724538 / (z0 + xq * (z2 + xq * (z4 + xq * (z6 + xq * (z8 + xq)))));
    k = d * (p0 + xq * (p2 + xq * (p4 + xq * (p6 + xq * p8))));
  } else {
    // Humlicek CPF12.
    const ypy0 = yv + y0;
    const ypy0q = ypy0 * ypy0;
    k = 0.0;
    for (let j = 0; j <= 5; j++) {
      let d = x - t[j];
      mq[j] = d * d;
      const mf = 1.0 / (mq[j] + ypy0q);
      xm[j] = mf * d;
      ym[j] = mf * ypy0;
      d = x + t[j];
      pq[j] = d * d;
      const pf = 1.0 / (pq[j] + ypy0q);
      xp[j] = pf * d;
      yp[j] = pf * ypy0;
    }
    if (abx <= xlim4) {
      // CPF12 Region I.
      for (let j = 0; j <= 5; j++) {
        k += c[j] * (ym[j] + yp[j]) - s[j] * (xm[j] - xp[j]);
      }
    } else {
      // CPF12 Region II.
      const yf = yv + 2 * y0;
      for (let j = 0; j <= 5; j++) {
        k +=
          (c[j] * (mq[j] * (1.0 / (mq[j] + ypy0q)) - y0 * ym[j]) + s[j] * yf * xm[j]) / (mq[j] + y0q) +
          (c[j] * (pq[j] * (1.0 / (pq[j] + ypy0q)) - y0 * yp[j]) - s[j] * yf * xp[j]) / (pq[j] + y0q);
      }
      k = yv * k + Math.exp(-xq);
    }
  }
  return k / 2.506628 / sigma;
}

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ
// ============================================

/**
 * Спектральное сечение поглощения и объёмный коэффициент поглощения
 * газовой смеси в локальном состоянии слоя (P, T, молярные доли).
 * Дискриминированный результат: completed | invalid_input |
 * out_of_applicability | numerical_failure.
 */
export function computeSpectralOpacity(input: SpectralOpacityInput): SpectralOpacityResult {
  const defaults = SPECTRAL_OPACITY_DEFAULTS;
  const errors: string[] = [];
  const tRef = defaults.referenceTemperatureK;

  // ---------- 1. Валидация входа ----------
  const { pressurePa, temperatureK } = input;
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    errors.push(`pressurePa должна быть конечной положительной, получено ${pressurePa}`);
  }
  if (!Number.isFinite(temperatureK) || temperatureK <= 0) {
    errors.push(`temperatureK должна быть конечной положительной, получено ${temperatureK}`);
  }

  const grid = input.grid;
  if (!Number.isFinite(grid.startWavenumberCm1) || !Number.isFinite(grid.endWavenumberCm1) || !Number.isFinite(grid.stepCm1)) {
    errors.push(`grid: startWavenumberCm1/endWavenumberCm1/stepCm1 должны быть конечными, получено ${grid.startWavenumberCm1}/${grid.endWavenumberCm1}/${grid.stepCm1}`);
  } else {
    if (grid.stepCm1 <= 0) {
      errors.push(`grid.stepCm1 должна быть положительной, получено ${grid.stepCm1} (сортировка определяется диапазоном, а не знаком шага)`);
    }
    if (grid.endWavenumberCm1 <= grid.startWavenumberCm1) {
      errors.push(`grid.endWavenumberCm1 (${grid.endWavenumberCm1}) должна быть строго больше grid.startWavenumberCm1 (${grid.startWavenumberCm1})`);
    }
  }

  if (!Array.isArray(input.species) || input.species.length === 0) {
    errors.push('species: нужен хотя бы один поглощающий компонент');
  }
  if (!Array.isArray(input.broadeners) || input.broadeners.length === 0) {
    errors.push('broadeners: состав столкновительных партнёров не задан (self-broadening без парциального давления не восстанавливается)');
  }

  let fractionSum = 0;
  for (const b of input.broadeners ?? []) {
    if (!Number.isFinite(b.moleFraction) || b.moleFraction < 0) {
      errors.push(`broadeners: доля газа "${b.gasId}" должна быть конечной неотрицательной, получено ${b.moleFraction}`);
    } else {
      fractionSum += b.moleFraction;
    }
    if (b.gasId === 'self') {
      errors.push('broadeners: идентичность "self" не задаётся вручную — self-уширение берётся из молярной доли самого поглощающего газа');
    }
  }
  if (fractionSum > 1 + defaults.moleFractionSumTolerance) {
    errors.push(
      `broadeners: сумма молярных долей = ${fractionSum}; молчаливая нормировка НЕ выполняется (допуск ${defaults.moleFractionSumTolerance})`
    );
  }

  if (errors.length > 0) {
    return { status: 'invalid_input', errors };
  }

  const nTotal = pressurePa / (HITRAN_SPECTRAL_CONSTANTS.boltzmannJPerK * temperatureK);

  // ---------- 2. Сетка ----------
  const span = grid.endWavenumberCm1 - grid.startWavenumberCm1;
  const pointCount = Math.floor(span / grid.stepCm1 + 1e-9) + 1;
  if (!Number.isFinite(pointCount) || pointCount > defaults.maxGridPoints) {
    return {
      status: 'invalid_input',
      errors: [
        `grid: расчёт даёт ${pointCount} узлов, превышение максимума ${defaults.maxGridPoints}; увеличьте шаг или сузьте диапазон`
      ]
    };
  }
  const gridCm1: number[] = new Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    gridCm1[i] = grid.startWavenumberCm1 + i * grid.stepCm1;
  }

  // ---------- 3. Состав и поглотители: fail-closed ----------
  const missingParameters: string[] = [];
  const assumptions: string[] = [];
  const applicabilityDiagnostics: string[] = [];
  const dataSets: DataProvenance[] = [];

  const significant = defaults.significantBroadenerMoleFraction;
  const partialAtmByGasId = new Map<string, number>();
  // Молярные доли (НЕ парциальные давления) — для концентраций n_i = x_i*n_total.
  const moleFractionByGasId = new Map<string, number>();
  for (const b of input.broadeners) {
    partialAtmByGasId.set(b.gasId, (b.moleFraction * pressurePa) / ATM_TO_PA);
    moleFractionByGasId.set(b.gasId, b.moleFraction);
  }

  const isotopeMode = input.isotopicScaleMode ?? 'terrestrial-assumption';

  // Проверка каталога данных для поглотителей и уширителей.
  for (const sp of input.species) {
    const species = tryGetGasSpecies(sp.gasId);
    if (species === null) {
      missingParameters.push(
        `поглотитель "${sp.gasId}": газ отсутствует в каталоге данных — масса и концентрация unknown, расчёт не выполняется (fail-closed)`
      );
    }
  }
  for (const b of input.broadeners) {
    if (b.gasId === 'air') continue; // смесь земного воздуха — явная идентичность
    if (partialAtmByGasId.get(b.gasId)! <= 0) continue;
    if (tryGetGasSpecies(b.gasId) === null) {
      errors.push(`broadeners: газ "${b.gasId}" отсутствует в каталоге данных — состав смеси не подтверждён`);
    }
  }
  if (errors.length > 0) {
    return { status: 'invalid_input', errors };
  }
  if (missingParameters.length > 0) {
    return {
      status: 'out_of_applicability',
      reason: 'поглощающий компонент отсутствует в каталоге данных; физический расчёт не определён',
      missingParameters
    };
  }

  // ---------- 4. Параметры линий при (p, T) ----------
  interface PreparedSpecies {
    gasId: string;
    isotopologueId: string;
    numberDensityPerM3: number;
    crossSectionCm2: Float64Array;
  }

  interface PreparedLine {
    lineId: string;
    gasId: string;
    isotopologueId: string;
    centerShifted: number;
    intensityAtT: number;
    gammaL: number;
    gammaD: number;
    shift: number;
    broadenersUsed: { gasId: string; partialPressureAtm: number; gammaCm1: number }[];
    crossSectionCm2: Float64Array;
  }

  const preparedLines: PreparedLine[] = [];
  const preparedSpecies: PreparedSpecies[] = [];

  for (const sp of input.species) {
    if (!Array.isArray(sp.lines) || sp.lines.length === 0) {
      return {
        status: 'invalid_input',
        errors: [`species "${sp.gasId}" (${sp.isotopologueId}): список линий пуст`]
      };
    }

    // Молярная масса изотополога: явная или из верифицированного molparam.
    let massGPerMol = sp.isotopologueMassGPerMol;
    let massFromMolparam = false;
    if (massGPerMol === undefined) {
      const mp = MOLPARAM_FRAGMENT_BY_ISO.get(sp.isotopologueId);
      if (mp !== undefined) {
        massGPerMol = mp.molarMassGPerMol;
        massFromMolparam = true;
      }
    }
    if (massGPerMol === undefined || !Number.isFinite(massGPerMol) || massGPerMol <= 0) {
      return {
        status: 'out_of_applicability',
        reason: `изотополог "${sp.isotopologueId}" (газ "${sp.gasId}"): молярная масса не задана и отсутствует в верифицированном фрагменте molparam`,
        missingParameters: [`нет молярной массы изотополога "${sp.isotopologueId}"`]
      };
    }

    // Partition sum.
    if (!sp.partitionSum) {
      return {
        status: 'out_of_applicability',
        reason: `изотополог "${sp.isotopologueId}": partition sum не предоставлена — S(T) не восстанавливается (придумывать Q запрещено)`,
        missingParameters: [`нет partition sum для "${sp.isotopologueId}"`]
      };
    }
    const qT = partitionSumAtTemperature(sp.partitionSum, temperatureK);
    const qRef = partitionSumAtTemperature(sp.partitionSum, tRef);
    if (qT === null) {
      return {
        status: 'out_of_applicability',
        reason: `изотополог "${sp.isotopologueId}": T = ${temperatureK} K вне диапазона данных partition sum [${sp.partitionSum.points[0]?.temperatureK}, ${sp.partitionSum.points[sp.partitionSum.points.length - 1]?.temperatureK}] K или данные некорректны`,
        missingParameters: [`partition sum для "${sp.isotopologueId}" не покрывает T = ${temperatureK} K`]
      };
    }
    if (qRef === null) {
      return {
        status: 'out_of_applicability',
        reason: `изотополог "${sp.isotopologueId}": опорная температура ${tRef} K вне диапазона данных partition sum`,
        missingParameters: [`partition sum для "${sp.isotopologueId}" не покрывает T_ref = ${tRef} K`]
      };
    }
    dataSets.push(sp.partitionSum.provenance);

    // Изотопный масштаб.
    let isotopeFactor = 1;
    if (isotopeMode === 'explicit-ratio') {
      if (sp.actualIsotopicAbundance === undefined || !Number.isFinite(sp.actualIsotopicAbundance) || sp.actualIsotopicAbundance < 0) {
        return {
          status: 'out_of_applicability',
          reason: `изотополог "${sp.isotopologueId}": режим 'explicit-ratio' требует фактическую изотопную распространённость (actualIsotopicAbundance)`,
          missingParameters: [`нет подтверждённой фактической изотопной распространённости для "${sp.isotopologueId}"`]
        };
      }
      const mp = MOLPARAM_FRAGMENT_BY_ISO.get(sp.isotopologueId);
      if (mp === undefined) {
        return {
          status: 'out_of_applicability',
          reason: `изотополог "${sp.isotopologueId}": опорная земная распространённость отсутствует в верифицированном molparam-фрагменте — отношение распространённостей не подтверждено`,
          missingParameters: [`нет опорной (земной) изотопной распространённости для "${sp.isotopologueId}"`]
        };
      }
      const factor = isotopeScaleFactor(sp.actualIsotopicAbundance, mp.terrestrialAbundance);
      if (!Number.isFinite(factor)) {
        return {
          status: 'numerical_failure',
          reason: `изотополог "${sp.isotopologueId}": изотопный масштаб некорректен (проверьте actualIsotopicAbundance и опорную распространённость molparam)`
        };
      }
      isotopeFactor = factor;
      applicabilityDiagnostics.push(
        `изотополог "${sp.isotopologueId}": применён масштаб распространённости ${sp.actualIsotopicAbundance}/${mp.terrestrialAbundance} = ${factor}`
      );
    }

    // Линии.
    for (const line of sp.lines) {
      // Валидация чисел линии.
      if (
        !Number.isFinite(line.wavenumberCm1) || line.wavenumberCm1 <= 0 ||
        !Number.isFinite(line.intensityCmPerMoleculeAtRef) || line.intensityCmPerMoleculeAtRef <= 0 ||
        !Number.isFinite(line.lowerStateEnergyCm1) || line.lowerStateEnergyCm1 < 0
      ) {
        return {
          status: 'invalid_input',
          errors: [
            `линия "${line.lineId}" (${sp.gasId}/${sp.isotopologueId}): wavenumberCm1>0, intensityCmPerMoleculeAtRef>0 и lowerStateEnergyCm1>=0 обязательны; получено ${line.wavenumberCm1}/${line.intensityCmPerMoleculeAtRef}/${line.lowerStateEnergyCm1}`
          ]
        };
      }

      // Сбор уширителей этой линии: только известные коэффициенты.
      const partials: {
        gasId: string;
        gammaCm1PerAtmAtRef: number;
        temperatureExponent: number;
        partialPressureAtm: number;
      }[] = [];
      const missingBroadeners: string[] = [];

      // (a) self — parциальная доля самого поглощающего газа.
      const selfPartialAtm = partialAtmByGasId.get(sp.gasId);
      if (selfPartialAtm !== undefined && selfPartialAtm > 0) {
        const selfCoef = line.broadening['self'];
        if (selfCoef) {
          partials.push({
            gasId: `${sp.gasId} (self)`,
            gammaCm1PerAtmAtRef: selfCoef.gammaCm1PerAtmAtRef,
            temperatureExponent: selfCoef.temperatureExponent,
            partialPressureAtm: selfPartialAtm
          });
        } else if (selfPartialAtm >= significant) {
          missingBroadeners.push(`self (парциальное давление ${selfPartialAtm} atm >= порога ${significant})`);
        }
      }

      // (b) остальные уширители из состава.
      for (const b of input.broadeners) {
        if (b.moleFraction <= 0) continue;
        const pAtm = partialAtmByGasId.get(b.gasId) ?? 0;
        if (b.gasId === sp.gasId) continue; // self уже учтён
        const hasAir = b.gasId === 'air';
        const coef = line.broadening[hasAir ? 'air' : b.gasId];
        if (coef) {
          partials.push({
            gasId: b.gasId,
            gammaCm1PerAtmAtRef: coef.gammaCm1PerAtmAtRef,
            temperatureExponent: coef.temperatureExponent,
            partialPressureAtm: pAtm
          });
          if (hasAir) {
            applicabilityDiagnostics.push(
              `линия "${line.lineId}": использованы air-коэффициенты для компонента "air"; это ДОПУЩЕНИЕ земного состава расширителей (пригодность для иного состава не подтверждена)`
            );
          }
        } else if (pAtm >= significant && b.gasId !== 'self') {
          const label = hasAir ? 'air' : b.gasId;
          missingBroadeners.push(`${label} (парциальное давление ${pAtm} atm >= порога ${significant})`);
        }
      }

      if (missingBroadeners.length > 0) {
        return {
          status: 'out_of_applicability',
          reason: `линия "${line.lineId}" (${sp.gasId}/${sp.isotopologueId}): отсутствуют коэффициенты уширения для существенных столкновительных партнёров; автоматическая замена на air-broadening ЗАПРЕЩЕНА`,
          missingParameters: missingBroadeners.map((m) => `нет коэффициента уширения: ${m} для линии "${line.lineId}"`)
        };
      }

      const gammaL =
        partials.length > 0
          ? lorentzHwhmCm1({ temperatureK, referenceTemperatureK: tRef, partials })
          : 0;
      const gammaDline = dopplerHwhmCm1({
        wavenumberCm1: line.wavenumberCm1,
        temperatureK,
        molarMassGPerMol: massGPerMol
      });
      if (!Number.isFinite(gammaDline) || gammaDline <= 0 || !Number.isFinite(gammaL) || gammaL < 0) {
        return { status: 'numerical_failure', reason: `линия "${line.lineId}": некорректная ширина при заданных p/T` };
      }

      // Сдвиг линии: только при подтверждённых коэффициентах.
      let shift = 0;
      if (line.pressureShift) {
        for (const p of partials) {
          const keyMatch = p.gasId.endsWith('(self)') ? 'self' : p.gasId;
          const shiftCoef = line.pressureShift[keyMatch];
          if (shiftCoef && Number.isFinite(shiftCoef.shiftCm1PerAtmAtRef)) {
            shift += shiftCoef.shiftCm1PerAtmAtRef * p.partialPressureAtm;
          }
        }
        if (shift === 0) {
          applicabilityDiagnostics.push(
            `линия "${line.lineId}": подтверждённых коэффициентов сдвига для фактических уширителей нет — сдвиг не приложен (в diagnostics)`
          );
        }
      } else {
        applicabilityDiagnostics.push(
          `линия "${line.lineId}": коэффициенты сдвига давления в записи отсутствуют — центр линии не сдвигается`
        );
      }
      if (!Number.isFinite(shift)) {
        return { status: 'numerical_failure', reason: `линия "${line.lineId}": некорректный сдвиг линии` };
      }

      // Температурная поправка интенсивности.
      const intensityAtT =
        line.intensityCmPerMoleculeAtRef *
        temperatureIntensityRatio({
          wavenumberCm1: line.wavenumberCm1,
          lowerStateEnergyCm1: line.lowerStateEnergyCm1,
          temperatureK,
          referenceTemperatureK: tRef,
          partitionSumAtT: qT,
          partitionSumAtRef: qRef
        }) *
        (line.intensityIncludesTerrestrialAbundance ? isotopeFactor : 1);
      if (!Number.isFinite(intensityAtT) || intensityAtT < 0) {
        return { status: 'numerical_failure', reason: `линия "${line.lineId}": некорректная интенсивность после коррекции` };
      }

      const centerShifted = line.wavenumberCm1 + shift;

      // Сечение по сетке.
      const crossSectionCm2 = new Float64Array(pointCount);
      for (let i = 0; i < pointCount; i++) {
        const f = voigtProfileCm({
          offsetCm1: gridCm1[i] - centerShifted,
          dopplerHwhmCm1: gammaDline,
          lorentzHwhmCm1: gammaL
        });
        if (!Number.isFinite(f)) {
          return {
            status: 'numerical_failure',
            reason: `линия "${line.lineId}": нечисловой профиль на узле i=${i} (nu = ${gridCm1[i]} cm-1)`
          };
        }
        crossSectionCm2[i] = intensityAtT * f;
      }

      preparedLines.push({
        lineId: line.lineId,
        gasId: sp.gasId,
        isotopologueId: sp.isotopologueId,
        centerShifted,
        intensityAtT,
        gammaL,
        gammaD: gammaDline,
        shift,
        broadenersUsed: partials.map((p) => ({
          gasId: p.gasId,
          partialPressureAtm: p.partialPressureAtm,
          gammaCm1:
            p.gammaCm1PerAtmAtRef *
            p.partialPressureAtm *
            Math.pow(tRef / temperatureK, p.temperatureExponent)
        })),
        crossSectionCm2
      });

      dataSets.push(line.provenance);
    }

    // Происхождение массы изотополога (если взята из molparam) — в dataSets.
    if (massFromMolparam) {
      const mp = MOLPARAM_FRAGMENT_BY_ISO.get(sp.isotopologueId);
      if (mp) dataSets.push(mp.provenance);
    }

    preparedSpecies.push({
      gasId: sp.gasId,
      isotopologueId: sp.isotopologueId,
      numberDensityPerM3: 0, // заполним ниже
      crossSectionCm2: new Float64Array(pointCount)
    });
  }

  // Молярная доля каждого поглотителя (для n_i) — из списка уширителей.
  for (const spRes of preparedSpecies) {
    const xSelf = moleFractionByGasId.get(spRes.gasId);
    if (xSelf === undefined) {
      return {
        status: 'invalid_input',
        errors: [
          `species "${spRes.gasId}": молярная доля поглотителя не задана в broadeners — концентрация n_i неизвестна (нормировать состав молча запрещено)`
        ]
      };
    }
    spRes.numberDensityPerM3 = nTotal * xSelf;
  }

  // ---------- 5. Суммирование и конверсия в SI ----------
  // sigma [cm^2/molecule] = S[T] * F; SI: * 1e-4. alpha = n_i * sigma_i.
  const totalCrossSection = new Float64Array(pointCount);
  const totalAbsorption = new Float64Array(pointCount);
  const contributions: SpectralSpeciesContribution[] = [];
  const CM2_TO_M2 = 1e-4;

  for (const spRes of preparedSpecies) {
    for (const line of preparedLines) {
      if (line.gasId !== spRes.gasId || line.isotopologueId !== spRes.isotopologueId) continue;
      for (let i = 0; i < pointCount; i++) {
        spRes.crossSectionCm2[i] += line.crossSectionCm2[i];
      }
    }
    for (let i = 0; i < pointCount; i++) {
      totalCrossSection[i] += spRes.crossSectionCm2[i];
    }
    const crossM2: number[] = new Array(pointCount);
    const absM1: number[] = new Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      crossM2[i] = spRes.crossSectionCm2[i] * CM2_TO_M2;
      absM1[i] = spRes.numberDensityPerM3 * crossM2[i];
      totalAbsorption[i] += absM1[i];
    }
    contributions.push({
      gasId: spRes.gasId,
      isotopologueId: spRes.isotopologueId,
      numberDensityPerM3: spRes.numberDensityPerM3,
      crossSectionM2PerMolecule: crossM2,
      absorptionCoefficientPerM: absM1
    });
  }
  for (let i = 0; i < pointCount; i++) {
    if (!Number.isFinite(totalCrossSection[i]) || !Number.isFinite(totalAbsorption[i])) {
      return { status: 'numerical_failure', reason: `нечисловой результат на узле i=${i}` };
    }
  }

  // ---------- 6. Допущения и диагностика ----------
  assumptions.push('идеальный газ: n_total = P/(kB*T) точным не является при высоких давлениях (см. applicabilityDiagnostics)');
  assumptions.push(
    `профиль Фойгта Humlicek/Wells с рабочей относительной точностью не хуже 1e-4; РЕАЛЬНАЯ форма (speed-dependent, Dicke narrowing, далёкие крылья) не моделируется`
  );
  if (isotopeMode === 'terrestrial-assumption') {
    const anyHitranAbundance = preparedSpecies.some((s) => input.species.find((q) => q.gasId === s.gasId && q.isotopologueId === s.isotopologueId)?.lines.some((l) => l.intensityIncludesTerrestrialAbundance));
    if (anyHitranAbundance) {
      assumptions.push(
        'все линии с intensityIncludesTerrestrialAbundance = true используются с земной изотопной распространённостью HITRAN (масштаб 1); для неиземной планеты это НЕПОДТВЕРЖДЁННОЕ допущение'
      );
    }
  }
  applicabilityDiagnostics.push(
    `неполнота набора линий: вне списка линий поглощение равно нулю; линии за пределами подтверждённого диапазона данных НЕ экстраполируются`
  );
  if (pressurePa > 5.066e6) {
    applicabilityDiagnostics.push(
      'давление выше 50 atm: формула суммирования gamma по парциальным давлениям и идеальный газ теряют точность'
    );
  }

  return {
    status: 'completed',
    gridCm1,
    crossSectionM2PerMolecule: Array.from(totalCrossSection, (v) => v * CM2_TO_M2),
    absorptionCoefficientPerM: Array.from(totalAbsorption),
    contributions,
    linesUsed: preparedLines.map((l) => ({
      lineId: l.lineId,
      gasId: l.gasId,
      isotopologueId: l.isotopologueId,
      wavenumberCm1Shifted: l.centerShifted,
      intensityCmPerMoleculeAtT: l.intensityAtT,
      gammaLorentzCm1: l.gammaL,
      gammaDopplerCm1: l.gammaD,
      pressureShiftCm1: l.shift,
      broadenersUsed: l.broadenersUsed
    })),
    totalNumberDensityPerM3: nTotal,
    unitConversions: [
      'gamma: gamma[Tref, 1 atm] * p_atm * (Tref/T)^n -> HWHM, cm-1; p_atm = p_Pa / 101325 (ATM_TO_PA)',
      'S(T) масштабируется безразмерными факторами Q и Больцмана; изотопный масштаб — отношение распространённостей',
      'sigma = S(T) * f_V: cm/molecule * cm = cm^2/molecule; в результат конвертируется: * 1e-4 -> m^2/molecule',
      'alpha = n_i * sigma_i: m-3 * m^2 = m-1; n_total = P/(kB*T), kB = 1.380649e-23 J/K (CODATA 2019 fixed value)'
    ],
    assumptions,
    applicabilityDiagnostics,
    provenance: {
      dataSets,
      module: 'src/modules/Core/spectralOpacity.ts (Stage 4.8.2.1)'
    }
  };
}
