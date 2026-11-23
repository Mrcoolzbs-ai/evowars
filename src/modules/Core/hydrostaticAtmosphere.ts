// ============================================
// HYDROSTATIC ATMOSPHERE - вертикальная гидростатическая структура (Stage 4.8.1)
// ============================================
//
// Одномерная вертикальная модель атмосферной колонки: P(z), T(z),
// x_i(z), rho(z), Mbar(z), g(z), H(z).
//
// Уравнения:
//   dP/dz = -rho(z) * g(z)                         (гидростатика)
//   rho(z) = P(z)*Mbar(z) / (R_u*T(z))             (идеальный газ)
//   Mbar(z) = sum_i x_i(z)*M_i                      (средняя молярная масса)
//   H(z)   = R_u*T(z) / (Mbar(z)*g(z))              (локальная масштабная высота)
//   g(z)   = G*M_body / (R + z)^2                   (сферическая гравитация;
//                                                    постоянная g — ТОЛЬКО явный режим constant-gravity)
//
// ДОПОЛНИТЕЛЬНО интегрируются столбы:
//   Sigma(z)  = int_0^z rho dz   [kg/m^2]  (массовый столб)
//   Nmol(z)   = int_0^z rho/Mbar dz [mol/m^2] (молярный столб)
//
// Интегрирование — НОВОЙ решательной машины нет: используется
// существующий solveOdeWithRadauIia (Core/odeSolver, Radau IIA
// 3 стадии, порядок 5). Границы слоёв — контрольные точки tEval
// каждого послойного интегрирования, состояние (P, Sigma, Nmol)
// передаётся точно через границы: давление непрерывно, плотность
// может испытывать ФИЗИЧЕСКИЙ скачок при смене T/состава.
//
// Единицы: высота — м, температура — K, давление — Па. Время в
// этой подсистеме не используется.
//
// ПРЕДЕЛЫ (Чего НЕТ и что НЕ выдаётся за реализованное):
//   - радиационно-конвективный перенос, парниковая модель,
//     спектральные коэффициенты, облака/аэрозоли/конденсация;
//   - химия и фотохимия, молекулярная/турбулентная диффузия,
//     гомопауза и диффузионная сепарация, escape и экзосфера;
//   - вращательная/центробежная поправка, самогравитация столба;
//   - неидеальная EOS как универсальная модель: идеальный газ —
//     ЯВНОЕ предположение; при высоких давлениях (пример: Венера,
//     P0 ~ 9.2 MPa) результат несёт диагностику применимости, а
//     не скрытую заявку на реальную EOS-точность;
//   - выход за слойный профиль НЕ экстраполируется.
//
// «Нет параметра -> unknown/out_of_applicability, не ноль»:
// неизвестный газ/unidentified НЕ превращается в компонент с
// нулевой молярной массой — расчёт блокируется со статусом
// out_of_applicability и перечнем отсутствующих параметров.

import type { DataProvenance } from './scientificValue';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from './thermoFunctions';
import { solveOdeWithRadauIia, OdeSolverError } from './odeSolver';
import type { OdeSolverProblem, OdeSolverOptions } from './solverBackend';
import { G } from '../Units';
import { tryGetGasSpecies } from '../Data/gases';
import type { GasSpecies } from '../../types';

// ============================================
// ТИПЫ ВХОДА
// ============================================

/**
 * Г/моль -> кг/моль. Конвертация единиц каталога GasSpecies
 * (molarMass хранится в г/моль) выполняется РОВНО ОДИН РАЗ,
 * здесь.
 */
const G_PER_MOL_TO_KG_PER_MOL = 1e-3;

export const HYDROSTATIC_COLUMN_DEFAULTS = {
  /** Относительный допуск Радау IIA. */
  rtol: 1e-8,
  /**
   * Абсолютный допуск (скаляр для всех компонент состояния).
   * 1e-8 согласован с единицами компонент [Pa, kg/m^2, mol/m^2]
   * при нулевом старте аккумуляторов столба (иначе первый шаг
   * вырождается из-за чисто относительного критерия).
   */
  atol: 1e-8,
  /** Допуск на сумму молярных долей: |sum x_i - 1| <= tol. */
  moleFractionTolerance: 1e-6,
  /** Допуск на непрерывность слоёв (округление высот), м. */
  heightRoundoffToleranceM: 1e-6
} as const;

export type GravityMode = 'spherical-gravity' | 'constant-gravity';

/** Модель температуры внутри слоя. */
export type AtmosphereTemperatureModel =
  | { readonly kind: 'isothermal'; readonly temperatureK: number }
  | {
      readonly kind: 'lapseRate';
      /** Температура на нижней границе слоя, K. */
      readonly bottomTemperatureK: number;
      /** Lapse rate: dT/dz = -lapseRateKPerM (положительный rate = убывание T). */
      readonly lapseRateKPerM: number;
    }
  | {
      readonly kind: 'measuredNodes';
      /** Измеренные узлы (heightM, temperatureK); интерполяция — линейная, документирована. */
      readonly nodes: readonly { readonly heightM: number; readonly temperatureK: number }[];
      readonly interpolation: 'linear';
    }
  | {
      readonly kind: 'geopotentialLapseRate';
      /** Радиус преобразования геопотенциальной высоты h = R*z/(R+z), м. */
      readonly referenceRadiusM: number;
      /** Геопотенциальная высота нижней границы, м. */
      readonly bottomGeopotentialHeightM: number;
      /** Температура на нижней границе, K. */
      readonly bottomTemperatureK: number;
      /** Знаковый dT/dh в K/м; сохраняет исходную конвенцию источника. */
      readonly lapseRateKPerM: number;
    };

/** Молярная доля одного газа в слое. */
export interface GasMoleFraction {
  readonly gasId: string;
  readonly moleFraction: number;
}

/** Один слой атмосферной колонки. */
export interface AtmosphereLayerSpec {
  /** Уникальный идентификатор слоя. */
  readonly layerId: string;
  /** Нижняя высота слоя, м (геометрическая, от центра-относительной опоры входа). */
  readonly bottomHeightM: number;
  /** Верхняя высота слоя, м, строго > bottomHeightM. */
  readonly topHeightM: number;
  /** Модель температуры слоя. */
  readonly temperature: AtmosphereTemperatureModel;
  /** Кусочно-постоянный молярный состав; НЕ нормализуется молча. */
  readonly composition: {
    readonly gases: readonly GasMoleFraction[];
    /** Допуск суммы долей; по умолчанию HYDROSTATIC_COLUMN_DEFAULTS.moleFractionTolerance. */
    readonly moleFractionTolerance?: number;
    /** Происхождение состава и условия измерения/оценки. */
    readonly provenance: DataProvenance;
  };
  /** Область применимости слоя (свободный текст). */
  readonly applicability?: string;
  /** Происхождение данных слоя (структура T(z) и высот). */
  readonly provenance: DataProvenance;
  /** Исходный слой до адаптивного вертикального разбиения. */
  readonly parentLayerId?: string;
}

/** Вход модели гидростатической колонки (Stage 4.8.1). */
export interface HydrostaticColumnInput {
  /** Планета: масса и опорный радиус; оба — с provenance. */
  readonly body: {
    readonly bodyMassKg: number;
    readonly referenceRadiusM: number;
    readonly provenance: DataProvenance;
  };
  /** Поверхность: давление + источник; начальная высота профиля (по умолчанию 0 м). */
  readonly surface: {
    readonly surfacePressurePa: number;
    readonly pressureProvenance: DataProvenance;
    readonly bottomHeightM?: number;
  };
  /** Слои атмосферы: непрерывно покрывают заявленный диапазон снизу вверх. */
  readonly layers: readonly AtmosphereLayerSpec[];
  /** Явно заданные контрольные высоты (результат на границах слоёв даётся всегда). */
  readonly requestedHeightsM?: readonly number[];
  /** Численные параметры и режим гравитации. */
  readonly numerics?: {
    readonly rtol?: number;
    readonly atol?: number;
    /** 'spherical-gravity' (по умолчанию) или ЯВНАЯ аппроксимация 'constant-gravity'. */
    readonly gravitationMode?: GravityMode;
  };
}

// ============================================
// ТИПЫ РЕЗУЛЬТАТА
// ============================================

/** Точка профиля (на поверхности, границах слоёв и контрольных высотах). */
export interface HydrostaticProfilePoint {
  readonly heightM: number;
  readonly pressurePa: number;
  readonly temperatureK: number;
  readonly densityKgPerM3: number;
  readonly meanMolarMassKgPerMol: number;
  readonly gravityMs2: number;
  readonly scaleHeightM: number;
  /** Массовый столб Sigma(z), kg/m^2 (от начальной высоты профиля). */
  readonly columnMassKgPerM2: number;
  /** Молярный столб Nmol(z), mol/m^2 (от начальной высоты профиля). */
  readonly columnMolesPerM2: number;
  /** Слой, к которому отнесена точка (нижняя сторона для границ). */
  readonly layerId: string;
  /** Молярный состав на высоте (кусок слоя). */
  readonly moleFractions: readonly { readonly gasId: string; readonly moleFraction: number }[];
}

/** Границы слоя: снимки снизу и сверху. */
export interface HydrostaticLayerBoundary {
  readonly layerId: string;
  /** Исходный крупный слой, если эта граница создана adaptive refinement. */
  readonly parentLayerId?: string;
  readonly bottom: HydrostaticProfilePoint;
  readonly top: HydrostaticProfilePoint;
}

interface SolverStatsAccumulator {
  attemptedSteps: number;
  acceptedSteps: number;
  rejectedSteps: number;
  newtonFailures: number;
  rhsEvaluations: number;
  jacobianEvaluations: number;
  luFactorizations: number;
}

/** Успешный расчёт. */
export interface HydrostaticColumnCompleted {
  readonly status: 'completed';
  /** Профиль: границы всех слоёв (включая поверхность) + контрольные высоты. */
  readonly profile: readonly HydrostaticProfilePoint[];
  /** Снимки границ каждого слоя. */
  readonly layerBoundaries: readonly HydrostaticLayerBoundary[];
  /** Точки, попавшие на явно запрошенные контрольные высоты. */
  readonly requestedHeightPoints: readonly HydrostaticProfilePoint[];
  readonly coverage: { readonly bottomHeightM: number; readonly topHeightM: number };
  readonly tolerances: { readonly rtol: number; readonly atol: number };
  readonly gravitationMode: GravityMode;
  readonly solverStats: SolverStatsAccumulator;
  /**
   * Максимальное относительное расхождение построчного баланса
   * столба внутри слоя: |Delta Sigma - Mbar * Delta Nmol| / |Delta Sigma|
   * (в пределах постоянного Mbar слоя столбы связаны линейно).
   */
  readonly columnConsistencyMaxRelativeDeviation: number;
  /** Явно перечисленные физические допущения. */
  readonly assumptions: readonly string[];
  /** Диагностика применимости (не маскируется пустым completed). */
  readonly applicabilityDiagnostics: readonly string[];
  readonly provenance: {
    readonly body: DataProvenance;
    readonly surfacePressure: DataProvenance;
    readonly layers: readonly { readonly layerId: string; readonly provenance: DataProvenance }[];
    readonly module: string;
  };
}

export type HydrostaticColumnResult =
  | HydrostaticColumnCompleted
  | { readonly status: 'invalid_input'; readonly errors: readonly string[] }
  | {
      readonly status: 'out_of_applicability';
      readonly reason: string;
      readonly missingParameters?: readonly string[];
    }
  | { readonly status: 'numerical_failure'; readonly reason: string; readonly lastHeightM?: number };

// ============================================
// АНАЛИТИЧЕСКИЕ ЭТАЛОНЫ (для тестов; НЕ заменяют решатель)
// ============================================

/**
 * Изотермический слой, постоянная g: P = P0 * exp(-dz/H).
 * Отдельный аналитический предел, НЕ универсальный метод.
 */
export function isothermalConstantGravityPressure(input: {
  surfacePressurePa: number;
  scaleHeightM: number;
  heightDeltaM: number;
}): number {
  return input.surfacePressurePa * Math.exp(-input.heightDeltaM / input.scaleHeightM);
}

/** Масштабная высота при постоянной g: H = R*T/(Mbar*g). */
export function isothermalScaleHeight(input: {
  temperatureK: number;
  meanMolarMassKgPerMol: number;
  gravityMs2: number;
}): number {
  return (
    (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * input.temperatureK) /
    (input.meanMolarMassKgPerMol * input.gravityMs2)
  );
}

/**
 * Изотермический слой со СФЕРИЧЕСКОЙ гравитацией (независимый
 * аналитический эталон тестов):
 *   P(z) = P0 * exp[ -(G*M*Mbar)/(R_u*T) * (1/(R+z0) - 1/(R+z)) ]
 */
export function isothermalSphericalRelationPressure(input: {
  surfacePressurePa: number;
  surfaceHeightM: number;
  targetHeightM: number;
  meanMolarMassKgPerMol: number;
  temperatureK: number;
  bodyMassKg: number;
  bodyRadiusM: number;
}): number {
  const coefficient =
    (G * input.bodyMassKg * input.meanMolarMassKgPerMol) /
    (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * input.temperatureK);
  const term =
    1 / (input.bodyRadiusM + input.surfaceHeightM) -
    1 / (input.bodyRadiusM + input.targetHeightM);
  return input.surfacePressurePa * Math.exp(-coefficient * term);
}

// ============================================
// ТЕМПЕРАТУРА СЛОЯ
// ============================================

export function temperatureAtGeometricHeight(
  model: AtmosphereTemperatureModel,
  layerBottomM: number,
  z: number
): number {
  switch (model.kind) {
    case 'isothermal':
      return model.temperatureK;
    case 'lapseRate':
      return model.bottomTemperatureK - model.lapseRateKPerM * (z - layerBottomM);
    case 'geopotentialLapseRate': {
      const geopotentialHeightM =
        (model.referenceRadiusM * z) / (model.referenceRadiusM + z);
      return model.bottomTemperatureK +
        model.lapseRateKPerM * (geopotentialHeightM - model.bottomGeopotentialHeightM);
    }
    case 'measuredNodes': {
      const nodes = model.nodes;
      // Валидация гарантирует покрытие [bottom, top] и строгий рост высот.
      for (let i = 1; i < nodes.length; i++) {
        const hPrev = nodes[i - 1].heightM;
        if (z <= nodes[i].heightM) {
          const w = (z - hPrev) / (nodes[i].heightM - hPrev);
          return nodes[i - 1].temperatureK + w * (nodes[i].temperatureK - nodes[i - 1].temperatureK);
        }
      }
      return nodes[nodes.length - 1].temperatureK;
    }
  }
}

function validateTemperatureModel(
  model: AtmosphereTemperatureModel | undefined,
  layerId: string,
  bottomM: number,
  topM: number,
  tolM: number,
  errors: string[]
): void {
  if (model === undefined || model === null || typeof model !== 'object') {
    errors.push(`слой "${layerId}": модель температуры отсутствует — произвольное значение НЕ подставляется`);
    return;
  }
  if (model.kind === 'isothermal') {
    if (!Number.isFinite(model.temperatureK) || model.temperatureK <= 0) {
      errors.push(`слой "${layerId}": isothermal temperatureK должна быть конечной положительной`);
    }
    return;
  }
  if (model.kind === 'lapseRate') {
    if (!Number.isFinite(model.bottomTemperatureK) || model.bottomTemperatureK <= 0) {
      errors.push(`слой "${layerId}": lapseRate bottomTemperatureK должна быть конечной положительной`);
    }
    if (!Number.isFinite(model.lapseRateKPerM)) {
      errors.push(`слой "${layerId}": lapseRateKPerM должна быть конечной`);
    }
    const tTop = model.bottomTemperatureK - model.lapseRateKPerM * (topM - bottomM);
    if (tTop <= 0) {
      errors.push(
        `слой "${layerId}": линейная модель temperatureK пересекает 0 K внутри слоя (T(top) = ${tTop})`
      );
    }
    return;
  }
  if (model.kind === 'geopotentialLapseRate') {
    if (!Number.isFinite(model.referenceRadiusM) || model.referenceRadiusM <= 0) {
      errors.push(`слой "${layerId}": geopotentialLapseRate referenceRadiusM должна быть конечным положительным радиусом`);
    }
    if (
      !Number.isFinite(model.bottomGeopotentialHeightM) ||
      model.bottomGeopotentialHeightM < 0 ||
      model.bottomGeopotentialHeightM >= model.referenceRadiusM
    ) {
      errors.push(`слой "${layerId}": bottomGeopotentialHeightM должна быть конечной неотрицательной высотой меньше referenceRadiusM`);
    }
    if (!Number.isFinite(model.bottomTemperatureK) || model.bottomTemperatureK <= 0) {
      errors.push(`слой "${layerId}": geopotentialLapseRate bottomTemperatureK должна быть конечной положительной`);
    }
    if (!Number.isFinite(model.lapseRateKPerM)) {
      errors.push(`слой "${layerId}": geopotentialLapseRate lapseRateKPerM должна быть конечной`);
    }
    if (
      Number.isFinite(model.referenceRadiusM) && model.referenceRadiusM > 0 &&
      Number.isFinite(bottomM) && Number.isFinite(topM) &&
      Number.isFinite(model.bottomGeopotentialHeightM) &&
      Number.isFinite(model.bottomTemperatureK) &&
      Number.isFinite(model.lapseRateKPerM)
    ) {
      const geopotentialBottomM =
        (model.referenceRadiusM * bottomM) / (model.referenceRadiusM + bottomM);
      const geopotentialTopM =
        (model.referenceRadiusM * topM) / (model.referenceRadiusM + topM);
      if (Math.abs(geopotentialBottomM - model.bottomGeopotentialHeightM) > tolM) {
        errors.push(`слой "${layerId}": нижняя геопотенциальная высота модели не согласована с geometric bottomHeightM`);
      }
      const tTop = model.bottomTemperatureK +
        model.lapseRateKPerM * (geopotentialTopM - model.bottomGeopotentialHeightM);
      if (!Number.isFinite(tTop) || tTop <= 0) {
        errors.push(`слой "${layerId}": geopotential temperature law пересекает 0 K внутри слоя`);
      }
    }
    return;
  }
  if (model.kind === 'measuredNodes') {
    if (!Array.isArray(model.nodes) || model.nodes.length === 0) {
      errors.push(`слой "${layerId}": measuredNodes без узлов`);
      return;
    }
    if (model.interpolation !== 'linear') {
      errors.push(`слой "${layerId}": поддержана только документированная интерполяция 'linear'`);
    }
    for (let i = 0; i < model.nodes.length; i++) {
      const n = model.nodes[i];
      if (!Number.isFinite(n.heightM) || !Number.isFinite(n.temperatureK) || n.temperatureK <= 0) {
        errors.push(`слой "${layerId}": узел ${i} измеренной температуры нечисловой или T <= 0 K`);
        return;
      }
      if (i > 0 && n.heightM <= model.nodes[i - 1].heightM) {
        errors.push(`слой "${layerId}": узлы температуры должны строго возрастать по высоте`);
        return;
      }
    }
    if (model.nodes[0].heightM > bottomM + tolM || model.nodes[model.nodes.length - 1].heightM < topM - tolM) {
      errors.push(`слой "${layerId}": узлы температуры не покрывают интервал слоя`);
    }
    return;
  }
  errors.push(`слой "${layerId}": неизвестный вид модели температуры`);
}

// ============================================
// ГЛАВНАЯ ФУНКЦИЯ
// ============================================

/**
 * Гидростатическая атмосфера: послойное интегрирование dP/dz = -rho g
 * (плюс интегралы столбов) решателем Radau IIA от поверхности вверх.
 */
export function computeHydrostaticColumn(input: HydrostaticColumnInput): HydrostaticColumnResult {
  const errors: string[] = [];
  const defaults = HYDROSTATIC_COLUMN_DEFAULTS;
  const tolM = defaults.heightRoundoffToleranceM;

  // ---------- 1. Структурная валидация ----------
  if (!input || typeof input !== 'object') {
    return { status: 'invalid_input', errors: ['input отсутствует или не объект'] };
  }

  const bodyMassKg = input.body?.bodyMassKg;
  const bodyRadiusM = input.body?.referenceRadiusM;
  if (!Number.isFinite(bodyMassKg) || bodyMassKg <= 0) {
    errors.push(`body.bodyMassKg должна быть конечной положительной, получено ${bodyMassKg}`);
  }
  if (!Number.isFinite(bodyRadiusM) || bodyRadiusM <= 0) {
    errors.push(`body.referenceRadiusM должен быть конечным положительным, получено ${bodyRadiusM}`);
  }

  const surfacePressurePa = input.surface?.surfacePressurePa;
  if (!Number.isFinite(surfacePressurePa) || surfacePressurePa <= 0) {
    errors.push(`surface.surfacePressurePa должна быть конечной положительной, получено ${surfacePressurePa}`);
  }
  const bottomHeightM = input.surface?.bottomHeightM ?? 0;
  if (!Number.isFinite(bottomHeightM)) {
    errors.push(`surface.bottomHeightM должна быть конечной, получено ${bottomHeightM}`);
  }

  const layers = input.layers;
  if (!Array.isArray(layers) || layers.length === 0) {
    errors.push('layers: должен быть непустым массивом слоёв');
  } else {
    // Первый слой начинается на заданной нижней высоте.
    if (Number.isFinite(layers[0].bottomHeightM) && Math.abs(layers[0].bottomHeightM - bottomHeightM) > tolM) {
      errors.push(
        `первый слой ("${layers[0].layerId}") начинается на ${layers[0].bottomHeightM} м, а заданная нижняя высота профиля ${bottomHeightM} м`
      );
    }
    const seenIds = new Set<string>();
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (!layer || typeof layer !== 'object') {
        errors.push(`layers[${i}]: не объект`);
        continue;
      }
      if (typeof layer.layerId !== 'string' || layer.layerId.length === 0) {
        errors.push(`layers[${i}]: layerId должен быть непустой строкой`);
      } else if (seenIds.has(layer.layerId)) {
        errors.push(`layers[${i}]: повторяющийся layerId "${layer.layerId}"`);
      } else {
        seenIds.add(layer.layerId);
      }
      if (!Number.isFinite(layer.bottomHeightM) || !Number.isFinite(layer.topHeightM)) {
        errors.push(`слой "${layer.layerId}": высоты границ должны быть конечными`);
      } else if (layer.topHeightM <= layer.bottomHeightM) {
        errors.push(
          `слой "${layer.layerId}": верхняя высота (${layer.topHeightM} м) должна быть строго больше нижней (${layer.bottomHeightM} м)`
        );
      }
      const prev = i > 0 ? layers[i - 1] : undefined;
      if (prev && Number.isFinite(prev.topHeightM) && Number.isFinite(layer.bottomHeightM)) {
        if (layer.bottomHeightM < prev.topHeightM - tolM) {
          errors.push(
            `слои "${prev.layerId}" и "${layer.layerId}": пересечение (${layer.layerId} начинается ниже конца предыдущего)`
          );
        } else if (layer.bottomHeightM > prev.topHeightM + tolM) {
          errors.push(
            `слои "${prev.layerId}" и "${layer.layerId}": разрыв (${layer.bottomHeightM} м > верхней границы ${prev.topHeightM} м)`
          );
        }
      }
      validateTemperatureModel(layer.temperature, layer.layerId, layer.bottomHeightM, layer.topHeightM, tolM, errors);
      // Состав: конечные неотрицательные доли, сумма = 1 в пределах допуска.
      const composition = layer.composition;
      if (!composition || !Array.isArray(composition.gases) || composition.gases.length === 0) {
        errors.push(`слой "${layer.layerId}": состав отсутствует или пуст`);
      } else {
        const fracTol = composition.moleFractionTolerance ?? defaults.moleFractionTolerance;
        let sum = 0;
        for (const g of composition.gases) {
          if (!g || typeof g.gasId !== 'string' || g.gasId.length === 0) {
            errors.push(`слой "${layer.layerId}": композиция содержит запись без gasId`);
            continue;
          }
          // Строгий вариант ТЗ (обязательные тесты 4.8.1, п.17):
          // нулевая доля также отклоняется, компонент без вклада
          // в состав не включается в его список.
          if (!Number.isFinite(g.moleFraction) || g.moleFraction <= 0) {
            errors.push(
              `слой "${layer.layerId}": доля газа "${g.gasId}" должна быть конечной положительной, получено ${g.moleFraction}`
            );
          }
          sum += g.moleFraction;
        }
        if (!Number.isFinite(fracTol) || fracTol < 0) {
          errors.push(`слой "${layer.layerId}": moleFractionTolerance должна быть конечной неотрицательной`);
        } else if (Math.abs(sum - 1) > fracTol) {
          errors.push(
            `слой "${layer.layerId}": сумма молярных долей = ${sum}; отличие от 1 превышает допуск ${fracTol}; молчаливая нормировка НЕ выполняется`
          );
        }
      }
    }
  }

  const requested = input.requestedHeightsM ?? [];
  for (const h of requested) {
    if (!Number.isFinite(h)) {
      errors.push(`requestedHeightsM содержит не-конечное значение ${h}`);
    }
  }

  const rtol = input.numerics?.rtol ?? defaults.rtol;
  const atol = input.numerics?.atol ?? defaults.atol;
  const gravitationMode: GravityMode = input.numerics?.gravitationMode ?? 'spherical-gravity';
  if (!Number.isFinite(rtol) || rtol <= 0) {
    errors.push(`numerics.rtol должна быть конечной положительной, получено ${rtol}`);
  }
  if (!Number.isFinite(atol) || atol <= 0) {
    errors.push(`numerics.atol должна быть конечной положительной, получено ${atol}`);
  }

  if (errors.length > 0) {
    return { status: 'invalid_input', errors };
  }

  // ---------- 2. Доступность молярных масс (fail-closed, без нулей) ----------
  const missingParameters: string[] = [];
  const layerMolarMassKgPerMol: number[] = [];
  for (const layer of layers) {
    let mbarGPerMol = 0;
    for (const g of layer.composition.gases) {
      const species: GasSpecies | null = tryGetGasSpecies(g.gasId);
      if (species === null) {
        missingParameters.push(
          `слой "${layer.layerId}": газ "${g.gasId}" отсутствует в каталоге — молярная масса unknown, не ноль`
        );
        continue;
      }
      if (species.molarMass === null || !Number.isFinite(species.molarMass) || species.molarMass <= 0) {
        missingParameters.push(
          `слой "${layer.layerId}": газ "${g.gasId}" не имеет положительной молярной массы в каталоге — mass unknown`
        );
        continue;
      }
      mbarGPerMol += g.moleFraction * species.molarMass;
    }
    layerMolarMassKgPerMol.push(mbarGPerMol * G_PER_MOL_TO_KG_PER_MOL);
  }
  if (missingParameters.length > 0) {
    return {
      status: 'out_of_applicability',
      reason:
        'физический расчёт плотности/столбов требует известных положительных молярных масс всех компонентов; указанные компоненты unknown',
      missingParameters
    };
  }

  // ---------- 3. Область применимости контрольных высот ----------
  const coverBottomM = layers[0].bottomHeightM;
  const coverTopM = layers[layers.length - 1].topHeightM;
  for (const h of requested) {
    if (h < coverBottomM - tolM || h > coverTopM + tolM) {
      return {
        status: 'out_of_applicability',
        reason: `контрольная высота ${h} м вне покрытого слоями диапазона [${coverBottomM}, ${coverTopM}] м; экстраполяция за профиль не выполняется`
      };
    }
  }

  // ---------- 4. Послойное интегрирование Radau IIA ----------
  const R_UNIVERSAL = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
  const GM = G * bodyMassKg;
  // Постоянная гравитация — отдельный ЯВНЫЙ режим, g фиксируется на нижней высоте.
  const constantGravityMs2 = GM / ((bodyRadiusM + bottomHeightM) * (bodyRadiusM + bottomHeightM));

  interface LayerRun {
    readonly layerId: string;
    readonly mbarKgPerMol: number;
    readonly bottomM: number;
    readonly topM: number;
  }

  const runs: LayerRun[] = layers.map((layer, i) => ({
    layerId: layer.layerId,
    mbarKgPerMol: layerMolarMassKgPerMol[i],
    bottomM: layer.bottomHeightM,
    topM: layer.topHeightM
  }));

  const profile: HydrostaticProfilePoint[] = [];
  const layerBoundaries: HydrostaticLayerBoundary[] = [];
  const stats: SolverStatsAccumulator = {
    attemptedSteps: 0,
    acceptedSteps: 0,
    rejectedSteps: 0,
    newtonFailures: 0,
    rhsEvaluations: 0,
    jacobianEvaluations: 0,
    luFactorizations: 0
  };
  let columnConsistencyMaxRel = 0;

  let pressurePa = surfacePressurePa;
  let columnMass = 0;
  let columnMoles = 0;
  let lastHeightM = bottomHeightM;

  const makePoint = (z: number, y: readonly number[], run: LayerRun): HydrostaticProfilePoint => {
    const layer = layers.find((l) => l.layerId === run.layerId)!;
    const temperatureK = temperatureAtGeometricHeight(layer.temperature, run.bottomM, z);
    const gravityMs2 =
      gravitationMode === 'constant-gravity'
        ? constantGravityMs2
        : GM / ((bodyRadiusM + z) * (bodyRadiusM + z));
    const densityKgPerM3 = (y[0] * run.mbarKgPerMol) / (R_UNIVERSAL * temperatureK);
    const scaleHeightM = (R_UNIVERSAL * temperatureK) / (run.mbarKgPerMol * gravityMs2);
    return {
      heightM: z,
      pressurePa: y[0],
      temperatureK,
      densityKgPerM3,
      meanMolarMassKgPerMol: run.mbarKgPerMol,
      gravityMs2,
      scaleHeightM,
      columnMassKgPerM2: y[1],
      columnMolesPerM2: y[2],
      layerId: run.layerId,
      moleFractions: layer.composition.gases.map((g) => ({ gasId: g.gasId, moleFraction: g.moleFraction }))
    };
  };

  try {
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const layer = layers.find((l) => l.layerId === run.layerId)!;
      const mbar = run.mbarKgPerMol;

      const rhs = (z: number, y: readonly number[]): number[] => {
        const T = temperatureAtGeometricHeight(layer.temperature, run.bottomM, z);
        const grav =
          gravitationMode === 'constant-gravity'
            ? constantGravityMs2
            : GM / ((bodyRadiusM + z) * (bodyRadiusM + z));
        const rho = (y[0] * mbar) / (R_UNIVERSAL * T);
        const dN = rho / mbar;
        return [-rho * grav, rho, dN];
      };
      // Аналитический якобиан по P (T, g и Mbar от y не зависят).
      const jacobian = (z: number, _y: readonly number[]): number[][] => {
        const T = temperatureAtGeometricHeight(layer.temperature, run.bottomM, z);
        const grav =
          gravitationMode === 'constant-gravity'
            ? constantGravityMs2
            : GM / ((bodyRadiusM + z) * (bodyRadiusM + z));
        const dRhoDP = mbar / (R_UNIVERSAL * T);
        const row = grav !== 0 ? -dRhoDP * grav : 0;
        return [[row, 0, 0], [dRhoDP, 0, 0], [dRhoDP / mbar, 0, 0]];
      };

      // Контрольные высоты слоя: верхняя граница + запрошенные внутри,
      // строго возрастающие; нижняя граница передаётся состоянием y0.
      const tEvalSet = new Set<number>();
      tEvalSet.add(run.topM);
      for (const h of requested) {
        if (h > run.bottomM + tolM && h <= run.topM + tolM) {
          tEvalSet.add(Math.min(h, run.topM));
        }
      }
      const tEval = Array.from(tEvalSet).sort((a, b) => a - b);

      const problem: OdeSolverProblem = {
        kind: 'ode',
        stateDimension: 3,
        t0: run.bottomM,
        tEnd: run.topM,
        y0: [pressurePa, columnMass, columnMoles],
        rhs,
        jacobian,
        nonNegativeIndices: [0, 1, 2],
        description: `hydrostatic atmosphere layer "${run.layerId}": [P, Sigma, Nmol]`
      };
      const options: OdeSolverOptions = { rtol, atol, tEval };

      const solved = solveOdeWithRadauIia(problem, options);

      const s = solved.stats;
      stats.attemptedSteps += s.attemptedSteps;
      stats.acceptedSteps += s.acceptedSteps;
      stats.rejectedSteps += s.rejectedSteps;
      stats.newtonFailures += s.newtonFailures;
      stats.rhsEvaluations += s.rhsEvaluations;
      stats.jacobianEvaluations += s.jacobianEvaluations;
      stats.luFactorizations += s.luFactorizations;

      // Нижняя точка слоя — переданное через границу состояние y0;
      // обе стороны границы слоя попадают в профиль.
      const bottomPoint = makePoint(run.bottomM, problem.y0, run);
      profile.push(bottomPoint);
      let topPoint: HydrostaticProfilePoint | null = null;
      for (const p of solved.points) {
        if (p.t <= run.bottomM) continue;
        const point = makePoint(p.t, p.y, run);
        profile.push(point);
        if (p.t === run.topM) topPoint = point;
        lastHeightM = p.t;
      }
      if (topPoint === null) {
        throw new OdeSolverError('numerical_failure', `слой "${run.layerId}": решатель не вернул верхнюю границу`);
      }
      // Построчный баланс столба: при постоянном Mbar слоя
      // Delta Sigma = mbar * Delta Nmol ТОЧНО; расхождение — численный дрейф.
      const deltaSigma = topPoint.columnMassKgPerM2 - bottomPoint.columnMassKgPerM2;
      const deltaNmol = topPoint.columnMolesPerM2 - bottomPoint.columnMolesPerM2;
      const consistency = Math.abs(deltaSigma - mbar * deltaNmol) / Math.max(Math.abs(deltaSigma), 1e-300);
      columnConsistencyMaxRel = Math.max(columnConsistencyMaxRel, consistency);

      layerBoundaries.push({
        layerId: run.layerId,
        ...(layer.parentLayerId === undefined ? {} : { parentLayerId: layer.parentLayerId }),
        bottom: bottomPoint,
        top: topPoint
      });

      // Передача состояния на следующую границу (P непрерывно).
      pressurePa = solved.y[0];
      columnMass = solved.y[1];
      columnMoles = solved.y[2];
    }
  } catch (err) {
    if (err instanceof OdeSolverError) {
      return { status: 'numerical_failure', reason: `${err.code}: ${err.message}`, lastHeightM };
    }
    return { status: 'numerical_failure', reason: String(err), lastHeightM };
  }

  // ---------- 5. Контроль конечности ----------
  for (const p of profile) {
    if (
      !Number.isFinite(p.pressurePa) ||
      !Number.isFinite(p.densityKgPerM3) ||
      !Number.isFinite(p.columnMassKgPerM2) ||
      !Number.isFinite(p.columnMolesPerM2)
    ) {
      return { status: 'numerical_failure', reason: `не-конечный результат на высоте ${p.heightM} м`, lastHeightM };
    }
  }

  const requestedHeightPoints = profile.filter((p) => requested.includes(p.heightM));

  // ---------- 6. Допущения и диагностика применимости ----------
  const assumptions: string[] = [
    'гидростатическое равновесие dP/dz = -rho(z)*g(z)',
    'идеальный газ: rho = P*Mbar/(R_u*T); неидеальность (Z != 1) НЕ моделируется и НЕ компенсируется',
    gravitationMode === 'spherical-gravity'
      ? 'сферическая гравитация g = G*M/(R+z)^2; масса атмосферы, вращение и самогравитация столба пренебрежимы'
      : `явная аппроксимация постоянной гравитации g = ${constantGravityMs2} м/с^2 (значение на нижней высоте профиля)`,
    'состав кусочно-постоянен в пределах явно заданных слоёв; диффузия, гомопауза и диффузионная сепарация НЕ моделируются',
    'радиационно-конвективный перенос, облака, химия, escape НЕ входят в Stage 4.8.1',
    'выход за слойный профиль не экстраполируется'
  ];
  const applicabilityDiagnostics: string[] = [];
  if (surfacePressurePa > 1e6) {
    applicabilityDiagnostics.push(
      `idealGasHighPressure: поверхностное давление ${surfacePressurePa} Па > 1 МПа; для плотных атмосфер (пример: Венера) отклонения от идеального газа возможны и моделью не учитываются — результат НЕ заявляет подтверждённую реальную EOS-точность`
    );
  }

  return {
    status: 'completed',
    profile,
    layerBoundaries,
    requestedHeightPoints,
    coverage: { bottomHeightM: coverBottomM, topHeightM: coverTopM },
    tolerances: { rtol, atol },
    gravitationMode,
    solverStats: stats,
    columnConsistencyMaxRelativeDeviation: columnConsistencyMaxRel,
    assumptions,
    applicabilityDiagnostics,
    provenance: {
      body: input.body.provenance,
      surfacePressure: input.surface.pressureProvenance,
      layers: layers.map((l) => ({ layerId: l.layerId, provenance: l.provenance })),
      module: 'src/modules/Core/hydrostaticAtmosphere.ts (Stage 4.8.1)'
    }
  };
}
