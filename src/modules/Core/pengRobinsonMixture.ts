// ============================================
// PENG–ROBINSON — многокомпонентные смеси: правила смешения,
// кубика смеси и компонентные фугитивности (Stage 4.4.4.3)
// ============================================
//
// Stage 4.4.4.3 «Peng–Robinson для многокомпонентных смесей»:
// классические правила смешения Peng–Robinson (vdW one-fluid) и
// КОМПОНЕНТНЫЕ фугитивности:
//
//   a_ij(T) = (1 - k_ij) * sqrt(a_i(T) * a_j(T)),   a_ii = a_i
//   a_mix(T, x) = SUM_i SUM_j x_i x_j a_ij(T)
//   b_mix(x) = SUM_i x_i b_i
//   A_mix = a_mix P / (R^2 T^2),   B_mix = b_mix P / (R T)
//   кубика смеси — та же PR-кубика с A_mix, B_mix;
//   S_i = SUM_j x_j a_ij
//   ln(phi_i) = (b_i/b_mix)(Z-1) - ln(Z - B_mix)
//               - A_mix/(2 sqrt(2) B_mix) * (2 S_i/a_mix - b_i/b_mix)
//                 * ln[(Z + (1+sqrt(2))B_mix)/(Z + (1-sqrt(2))B_mix)]
//   phi_i = exp(ln(phi_i)),   f_i = x_i phi_i P
//
// Чистокомпонентные a_i(T), b_i вычисляет СУЩЕСТВУЮЩИЙ проверенный
// вычислитель computePengRobinsonPureParameters (Stage 4.4.4.2);
// кубика смеси решается тем же проверенным решателем
// solvePrCubicRealRoots (DD + точный dyadic-BigInt-знак
// дискриминанта, ревизия 4.4.4.2.2) с тем же фильтром Z > B
// (prPhysicalRoots). Дублирования чистой математики нет.
//
// АРХИТЕКТУРА (граница Core/Data, как в 4.4.4.2.1): этот модуль —
// фундаментальный слой Core и НЕ импортирует runtime из Data.
// Валидированный состав, чистокомпонентные параметры, evidence и
// БИНАРНЫЕ параметры взаимодействия (со своими evidence-статусами)
// передаются на входе. Поиск по gasId в каталоге 4.4.4.1 и по парам в
// каталоге kij 4.4.4.3 выполняет фасад
// Data/pengRobinsonMixtureFacade.ts. Направление зависимостей:
// Data -> Core (обратно запрещено).
//
// ОДНОКОМПОНЕНТНЫЙ ПРЕДЕЛ: при одном компоненте x = 1 a_mix = a,
// b_mix = b, A_mix = A, B_mix = B, S_i = a, и результат совпадает с
// чистокомпонентным вычислителем computePengRobinsonFromComponent
// ПОБИТОВО (та же последовательность операций; см. тесты
// Stage 4.4.4.3 в Tests/pengRobinsonMixture.test.ts).
//
// ВАЛИДАЦИЯ СОСТАВА: конечные неотрицательные mole fractions,
// уникальные идентификаторы компонентов, сумма равна единице в
// явном численном допуске PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE.
// Молчаливой нормализации НЕТ: состав с суммой вне допуска — отказ
// invalid_composition, а не пересчёт долей.
//
// БИНАРНЫЕ ПАРАМЕТРЫ: передаются явно; для каждой пары компонентов с
// ПОЛОЖИТЕЛЬНЫМИ долями требуемая запись обязана присутствовать —
// отсутствие kij = отказ missing_binary_interaction (НЕ kij = 0:
// kij = 0 не нейтрален). Записи канонизируются (i-j и j-i — одна
// пара); разные значения для одной пары — отказ
// asymmetric_binary_interaction. Самопары (i-i) на входе не
// допускаются: a_ii = a_i по определению, k_ii не является
// пользовательским параметром. Верифицированный диапазон
// применимости kij (если назначен каталогом) проверяется по T:
// выход за диапазон — отказ binary_interaction_applicability.
//
// ВАЖНО о выборе ветви (как в 4.4.4.2): выбор корня 'vapor'
// (наибольший физически допустимый) или 'liquid' (наименьший) —
// выбор МАТЕМАТИЧЕСКОЙ ветви кубики смеси. Он НЕ доказывает
// термодинамическую устойчивость фазы и НЕ заменяет flash, VLE/LLE
// или сравнение энергий Гиббса/фугитивностей фаз. Все эти расчёты
// в Stage 4.4.4.3 НЕ реализованы. Компонентные фугитивности НЕ
// подменяются одной общей фугитивностью смеси.
//
// НЕ реализовано (границы Stage 4.4.4.3): flash, VLE/LLE, фазовая
// устойчивость, PPR78, конденсированные фазы, произвольные ternary
// interaction parameters, интеграция с solveEquilibrium (семантика
// ideal_gas равновесного решателя не меняется).

import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from './thermoFunctions';
import {
  computePengRobinsonPureParameters,
  prPhysicalRoots,
  solvePrCubicRealRoots,
  validatePengRobinsonComponentRequest
} from './pengRobinson';
import type {
  PengRobinsonCrossCheck,
  PengRobinsonEvidencePolicy,
  PengRobinsonEvidenceStatus,
  PengRobinsonParameterEvidence,
  PengRobinsonRootBranch
} from './pengRobinson';

// Реэкспорт общих типов PR для потребителей смесевого API (фасад
// Data/pengRobinsonMixtureFacade.ts и тесты): политики доказанности,
// статусы и ветви объявлены в ./pengRobinson (единый источник).
export type {
  PengRobinsonEvidencePolicy,
  PengRobinsonEvidenceStatus,
  PengRobinsonRootBranch
} from './pengRobinson';

// ============================================
// 1. ТИПЫ: КОДЫ, ПОЛИТИКА, ВХОДЫ, РЕЗУЛЬТАТ
// ============================================

/**
 * Устойчивые коды отказов смесевого вычислителя. Коды чистого
 * вычислителя (4.4.4.2) сохраняют смысл; добавлены смесевые:
 * invalid_composition (состав), missing_binary_interaction (нет kij),
 * asymmetric_binary_interaction (kij != kji), binary_interaction_
 * applicability (T вне верифицированного диапазона подгонки kij).
 */
export type PengRobinsonMixtureErrorCode =
  | 'invalid_input'
  | 'invalid_composition'
  | 'unknown_component'
  | 'invalid_parameters'
  | 'parameter_evidence_not_accepted'
  | 'missing_binary_interaction'
  | 'asymmetric_binary_interaction'
  | 'binary_interaction_applicability'
  | 'no_physical_root'
  | 'cubic_solver_failure'
  | 'logarithm_domain_error'
  | 'numerical_failure';

/** Реестр кодов отказов. */
export const PENG_ROBINSON_MIXTURE_ERROR_CODES: readonly PengRobinsonMixtureErrorCode[] = [
  'invalid_input',
  'invalid_composition',
  'unknown_component',
  'invalid_parameters',
  'parameter_evidence_not_accepted',
  'missing_binary_interaction',
  'asymmetric_binary_interaction',
  'binary_interaction_applicability',
  'no_physical_root',
  'cubic_solver_failure',
  'logarithm_domain_error',
  'numerical_failure'
];

/** Коды предупреждений смесевого вычислителя. */
export type PengRobinsonMixtureWarningCode =
  | 'partially_verified_parameter'
  | 'unresolved_cross_check_parameter'
  | 'partially_verified_binary_interaction'
  | 'h2o_classical_pr_limitations'
  | 'single_physical_root';

/** Реестр кодов предупреждений. */
export const PENG_ROBINSON_MIXTURE_WARNING_CODES: readonly PengRobinsonMixtureWarningCode[] = [
  'partially_verified_parameter',
  'unresolved_cross_check_parameter',
  'partially_verified_binary_interaction',
  'h2o_classical_pr_limitations',
  'single_physical_root'
];

/** Предупреждение результата: код + описание. */
export interface PengRobinsonMixtureWarning {
  readonly code: PengRobinsonMixtureWarningCode;
  readonly message: string;
}

/**
 * Численный допуск на сумму mole fractions: |SUM x_i - 1|.
 * Состав с суммой вне допуска — отказ invalid_composition;
 * нормализация НЕ выполняется.
 */
export const PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE = 1e-9;

/**
 * Дисклеймер о математическом характере выбора ветви (в каждом
 * успехе): выбор корня — НЕ фазовая устойчивость.
 */
export const PENG_ROBINSON_MIXTURE_BRANCH_NOTE: string =
  'Выбор ветви (vapor/liquid) — выбор математической ветви кубического ' +
  'уравнения PR смеси по физически допустимым корням (Z > B_mix); он НЕ ' +
  'доказывает термодинамическую устойчивость фазы и НЕ заменяет flash, ' +
  'VLE/LLE или сравнение энергий Гиббса/фугитивностей фаз (не реализовано ' +
  'в Stage 4.4.4.3).';

/**
 * Компонент смеси на входе Core: валидированные чистокомпонентные
 * параметры + доля + evidence (структура совместима с каталогом
 * Stage 4.4.4.1 через фасад Data).
 */
export interface PengRobinsonMixtureComponentInput {
  readonly component: string;
  readonly moleFraction: number;
  readonly criticalTemperatureK: number;
  readonly criticalPressurePa: number;
  readonly acentricFactor: number;
  readonly evidence: PengRobinsonParameterEvidence;
  readonly crossChecks: readonly PengRobinsonCrossCheck[];
  readonly limitations: readonly string[];
}

/**
 * Бинарный параметр взаимодействия на входе Core: значение kij,
 * evidence-статус и (если каталог верифицировал) диапазон
 * применимости по температуре. Симметрия: i-j и j-i — одна пара
 * (канонический порядок лексикографический).
 */
export interface PengRobinsonBinaryInteractionInput {
  readonly componentA: string;
  readonly componentB: string;
  readonly kij: number;
  readonly evidence: PengRobinsonEvidenceStatus;
  readonly applicabilityRangeK: Readonly<{
    minTemperatureK: number;
    maxTemperatureK: number;
  }> | null;
}

/** Входы смесевого вычислителя Core. */
export interface PengRobinsonMixtureInputs {
  readonly components: readonly PengRobinsonMixtureComponentInput[];
  readonly binaryInteractions: readonly PengRobinsonBinaryInteractionInput[];
}

/** Запрос: T, P, ветвь и ЯВНАЯ политика доказанности. */
export interface PengRobinsonMixtureRequest {
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: PengRobinsonRootBranch;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
}

/** Компонентный результат: ln(phi_i), phi_i, f_i и вклады. */
export interface PengRobinsonMixtureComponentResult {
  readonly component: string;
  readonly moleFraction: number;
  /** a_i(T), Pa*m^6/mol^2. */
  readonly aPaM6PerMol2: number;
  /** b_i, m^3/mol. */
  readonly bM3PerMol: number;
  /** S_i = SUM_j x_j a_ij, Pa*m^6/mol^2. */
  readonly sIPaM6PerMol2: number;
  readonly lnPhi: number;
  readonly phi: number;
  /** f_i = x_i * phi_i * P, Pa. */
  readonly fugacityPa: number;
}

/** Использованный бинарный параметр (канонический порядок). */
export interface PengRobinsonMixtureBinaryInteractionUsed {
  readonly componentA: string;
  readonly componentB: string;
  readonly kij: number;
  readonly evidence: PengRobinsonEvidenceStatus;
  readonly applicabilityRangeK: Readonly<{
    minTemperatureK: number;
    maxTemperatureK: number;
  }> | null;
}

/** Успешный результат смесевого вычислителя (NaN/Infinity исключены). */
export interface PengRobinsonMixtureSuccess {
  readonly status: 'success';
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: PengRobinsonRootBranch;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;

  /** a_mix(T, x), Pa*m^6/mol^2. */
  readonly aMixPaM6PerMol2: number;
  /** b_mix(x), m^3/mol. */
  readonly bMixM3PerMol: number;
  /** A_mix (безразмерный). */
  readonly dimensionlessA: number;
  /** B_mix (безразмерный). */
  readonly dimensionlessB: number;

  readonly Z: number;
  readonly selectedRoot: number;

  readonly realRoots: readonly number[];
  readonly physicalRoots: readonly number[];
  readonly distinctPhysicalRootCount: number;
  readonly hasDistinctBranches: boolean;

  /** Компонентные результаты (канонический порядок компонентов). */
  readonly components: readonly PengRobinsonMixtureComponentResult[];
  /** Использованные kij (канонический порядок пар). */
  readonly binaryInteractionsUsed: readonly PengRobinsonMixtureBinaryInteractionUsed[];

  readonly warnings: readonly PengRobinsonMixtureWarning[];
  readonly notes: readonly string[];
}

/** Отказ: устойчивый код + диагностика. */
export interface PengRobinsonMixtureFailure {
  readonly status: 'failure';
  readonly code: PengRobinsonMixtureErrorCode;
  readonly message: string;
  readonly detail?: string;
}

/** Discriminated union результата. */
export type PengRobinsonMixtureResult =
  | PengRobinsonMixtureSuccess
  | PengRobinsonMixtureFailure;

// ============================================
// 2. ВАЛИДАЦИЯ ЗАПРОСА И ВХОДОВ
// ============================================

/** Проверка «конечное число». */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isNonNullObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/**
 * Валидация запроса (T, P, ветвь, политика) — делегируется общей
 * проверке чистого вычислителя (единые сообщения и правила).
 */
export function validatePengRobinsonMixtureRequest(
  request: PengRobinsonMixtureRequest
): PengRobinsonMixtureFailure | null {
  const failure = validatePengRobinsonComponentRequest({
    temperatureK: request.temperatureK,
    pressurePa: request.pressurePa,
    root: request.root,
    evidencePolicy: request.evidencePolicy
  });
  return failure;
}

/** Канонический ключ пары (лексикографический порядок). */
function canonicalPairKey(a: string, b: string): string {
  const [first, second] = [a, b].sort();
  return first + '|' + second;
}

/**
 * Валидация и канонизация входов: уникальные компоненты, конечные
 * неотрицательные доли, сумма = 1 в допуске (БЕЗ нормализации),
 * бинарные записи с конечными kij, отсутствие самопар, попарная
 * согласованность (kij = kji). Возвращает отказ или канонизированные
 * данные: компоненты в лексикографическом порядке (детерминизм
 * сумм и симметрия результата при перестановке входа).
 */
function validateAndCanonicalizeInputs(
  inputs: PengRobinsonMixtureInputs
):
  | {
      ok: true;
      components: PengRobinsonMixtureComponentInput[];
      pairMap: Map<string, PengRobinsonBinaryInteractionInput>;
    }
  | { ok: false; failure: PengRobinsonMixtureFailure } {
  if (!isNonNullObject(inputs) || !Array.isArray(inputs.components)) {
    return {
      ok: false,
      failure: {
        status: 'failure',
        code: 'invalid_parameters',
        message: 'inputs.components должен быть массивом компонентов смеси'
      }
    };
  }
  if (inputs.components.length === 0) {
    return {
      ok: false,
      failure: {
        status: 'failure',
        code: 'invalid_composition',
        message: 'состав смеси пуст: требуется минимум один компонент'
      }
    };
  }

  // Компоненты: форма, уникальность, доли.
  const seen = new Set<string>();
  const checked: PengRobinsonMixtureComponentInput[] = [];
  for (const raw of inputs.components) {
    if (!isNonNullObject(raw)) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_composition',
          message: 'каждый компонент состава должен быть объектом {component, moleFraction, ...}'
        }
      };
    }
    const rec = raw as Record<string, unknown>;
    if (typeof rec.component !== 'string' || rec.component.trim() === '') {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_composition',
          message: `идентификатор компонента должен быть непустой строкой, получено: ${String(rec.component)}`
        }
      };
    }
    if (seen.has(rec.component)) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_composition',
          message: `дублированный компонент в составе: «${rec.component}» (компоненты должны быть уникальными)`
        }
      };
    }
    seen.add(rec.component);
    if (!isFiniteNumber(rec.moleFraction) || rec.moleFraction < 0) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_composition',
          message:
            `moleFraction компонента «${rec.component}» должен быть конечным неотрицательным числом, ` +
            `получено: ${String(rec.moleFraction)}`
        }
      };
    }
    // Чистокомпонентные параметры: конечность и положительность.
    if (!isFiniteNumber(rec.criticalTemperatureK) || rec.criticalTemperatureK <= 0) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message:
            `criticalTemperatureK компонента «${rec.component}» должен быть конечным положительным числом (K), ` +
            `получено: ${String(rec.criticalTemperatureK)}`
        }
      };
    }
    if (!isFiniteNumber(rec.criticalPressurePa) || rec.criticalPressurePa <= 0) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message:
            `criticalPressurePa компонента «${rec.component}» должен быть конечным положительным числом (Pa), ` +
            `получено: ${String(rec.criticalPressurePa)}`
        }
      };
    }
    if (!isFiniteNumber(rec.acentricFactor)) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message:
            `acentricFactor компонента «${rec.component}» должен быть конечным числом, ` +
            `получено: ${String(rec.acentricFactor)}`
        }
      };
    }
    const evidence = rec.evidence as unknown;
    if (
      !isNonNullObject(evidence) ||
      typeof (evidence as Record<string, unknown>).criticalTemperatureK !== 'string' ||
      typeof (evidence as Record<string, unknown>).criticalPressurePa !== 'string' ||
      typeof (evidence as Record<string, unknown>).acentricFactor !== 'string'
    ) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message:
            `evidence компонента «${rec.component}» должен содержать статусы доказанности всех трёх параметров`
        }
      };
    }
    if (!Array.isArray(rec.crossChecks) || !Array.isArray(rec.limitations)) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message: `crossChecks и limitations компонента «${rec.component}» должны быть массивами`
        }
      };
    }
    checked.push(raw as unknown as PengRobinsonMixtureComponentInput);
  }

  // Канонический порядок компонентов (лексикографический): все суммы
  // вычисляются в детерминированном порядке, результат инвариантен
  // перестановке входа (симметрия состава).
  const components = checked.slice().sort((x, y) => (x.component < y.component ? -1 : 1));

  // Сумма долей в допуске (БЕЗ нормализации).
  let sum = 0;
  for (const c of components) {
    sum += c.moleFraction;
  }
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE) {
    return {
      ok: false,
      failure: {
        status: 'failure',
        code: 'invalid_composition',
        message:
          `сумма mole fractions должна быть равна 1 в допуске ` +
          `${PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE}, получено: ${String(sum)}; ` +
          `молчаливая нормализация состава не выполняется`
      }
    };
  }

  // Бинарные параметры: форма, самопары, канонизация, согласованность.
  if (!Array.isArray(inputs.binaryInteractions)) {
    return {
      ok: false,
      failure: {
        status: 'failure',
        code: 'invalid_parameters',
        message: 'inputs.binaryInteractions должен быть массивом записей kij'
      }
    };
  }
  const pairMap = new Map<string, PengRobinsonBinaryInteractionInput>();
  for (const raw of inputs.binaryInteractions) {
    if (!isNonNullObject(raw)) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message: 'каждая запись binaryInteractions должна быть объектом {componentA, componentB, kij, ...}'
        }
      };
    }
    const rec = raw as Record<string, unknown>;
    if (typeof rec.componentA !== 'string' || rec.componentA.trim() === '') {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message: `componentA записи kij должен быть непустой строкой, получено: ${String(rec.componentA)}`
        }
      };
    }
    if (typeof rec.componentB !== 'string' || rec.componentB.trim() === '') {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message: `componentB записи kij должен быть непустой строкой, получено: ${String(rec.componentB)}`
        }
      };
    }
    if (rec.componentA === rec.componentB) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_input',
          message:
            `самопара «${rec.componentA}|${rec.componentB}» недопустима: a_ii = a_i по определению, ` +
            `k_ii не является пользовательским параметром`
        }
      };
    }
    if (!isFiniteNumber(rec.kij)) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message:
            `kij пары «${rec.componentA}|${rec.componentB}» должен быть конечным числом, получено: ${String(rec.kij)}`
        }
      };
    }
    if (
      typeof rec.evidence !== 'string' ||
      !(
        [
          'VERIFIED',
          'PARTIALLY_VERIFIED',
          'UNRESOLVED_CROSS_CHECK',
          'UNRESOLVED'
        ] as readonly string[]
      ).includes(rec.evidence)
    ) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'invalid_parameters',
          message:
            `evidence записи kij пары «${rec.componentA}|${rec.componentB}» должен быть статусом доказанности ` +
            `(VERIFIED | PARTIALLY_VERIFIED | UNRESOLVED_CROSS_CHECK | UNRESOLVED)`
        }
      };
    }
    const range = rec.applicabilityRangeK;
    if (range !== null && range !== undefined) {
      const rangeRecord = isNonNullObject(range) ? range : null;
      const minT: unknown = rangeRecord !== null ? rangeRecord.minTemperatureK : undefined;
      const maxT: unknown = rangeRecord !== null ? rangeRecord.maxTemperatureK : undefined;
      if (
        !isFiniteNumber(minT) ||
        !isFiniteNumber(maxT) ||
        minT <= 0 ||
        maxT <= 0 ||
        minT >= maxT
      ) {
        return {
          ok: false,
          failure: {
            status: 'failure',
            code: 'invalid_parameters',
            message:
              `applicabilityRangeK пары «${rec.componentA}|${rec.componentB}» должен быть null или ` +
              `{minTemperatureK, maxTemperatureK}: конечные положительные, min < max`
          }
        };
      }
    }
    const key = canonicalPairKey(rec.componentA, rec.componentB);
    const existing = pairMap.get(key);
    if (existing !== undefined && existing.kij !== (rec.kij as number)) {
      return {
        ok: false,
        failure: {
          status: 'failure',
          code: 'asymmetric_binary_interaction',
          message:
            `для пары «${key}» переданы РАЗНЫЕ значения kij: ${String(existing.kij)} и ${String(rec.kij)}; ` +
            `классические правила смешения требуют симметрии kij = kji`
        }
      };
    }
    if (existing === undefined) {
      pairMap.set(key, raw as unknown as PengRobinsonBinaryInteractionInput);
    }
  }

  return { ok: true, components, pairMap };
}

// ============================================
// 3. ПОЛИТИКА ДОКАЗАННОСТИ (компоненты и kij)
// ============================================

/**
 * Оценка статуса против политики (семантика 4.4.4.2): VERIFIED —
 * принято всегда; PARTIALLY_VERIFIED — кроме verified_only, с
 * предупреждением; UNRESOLVED_CROSS_CHECK — только по явной политике,
 * с предупреждением о конфликте; UNRESOLVED — никогда.
 */
function evaluateStatusAgainstPolicy(
  subject: string,
  field: string,
  status: PengRobinsonEvidenceStatus,
  policy: PengRobinsonEvidencePolicy,
  warningCode:
    | 'partially_verified_parameter'
    | 'unresolved_cross_check_parameter'
    | 'partially_verified_binary_interaction',
  crossChecks: readonly PengRobinsonCrossCheck[]
): { rejected: string | null; warning: PengRobinsonMixtureWarning | null } {
  if (status === 'VERIFIED') {
    return { rejected: null, warning: null };
  }
  if (status === 'PARTIALLY_VERIFIED') {
    if (policy === 'verified_only') {
      return { rejected: `${field}=PARTIALLY_VERIFIED`, warning: null };
    }
    return {
      rejected: null,
      warning: {
        code: warningCode,
        message:
          `${subject}: ${field} имеет статус PARTIALLY_VERIFIED и использован по политике «${policy}»; ` +
          `результат зависит от частично проверенного значения`
      }
    };
  }
  if (status === 'UNRESOLVED_CROSS_CHECK') {
    if (policy === 'allow_unresolved_cross_check') {
      const conflicts = crossChecks.filter((cc) => cc.outcome === 'discrepancy');
      const details = conflicts
        .map((cc) => `${cc.subject}: ${cc.catalogValue} против ${cc.crossSource}: ${cc.crossValue} (${cc.outcome}); ${cc.resolution}`)
        .join('; ');
      return {
        rejected: null,
        warning: {
          code: 'unresolved_cross_check_parameter',
          message:
            `${subject}: ${field} имеет статус UNRESOLVED_CROSS_CHECK и использован ТОЛЬКО по явному ` +
            `выбору политики «${policy}»` +
            (details !== '' ? `; зафиксированный конфликт: ${details}` : '; конфликт задокументирован в provenance')
        }
      };
    }
    return { rejected: `${field}=UNRESOLVED_CROSS_CHECK`, warning: null };
  }
  return { rejected: `${field}=UNRESOLVED`, warning: null };
}

// ============================================
// 4. ПУБЛИЧНЫЙ СМЕСЕВОЙ ВЫЧИСЛИТЕЛЬ CORE
// ============================================

/**
 * Смесевой вычислитель Peng–Robinson слоя Core (Stage 4.4.4.3):
 * принимает УЖЕ валидированные чистокомпонентные параметры,
 * состав и бинарные параметры взаимодействия — БЕЗ обращения к
 * каталогам Data. Поиск по gasId и парам выполняет фасад
 * Data/pengRobinsonMixtureFacade.ts.
 *
 * Контракт: состав — конечные неотрицательные доли, уникальные
 * компоненты, сумма = 1 в допуске (нормализации нет); для каждой
 * пары компонентов с положительными долями — обязательная запись
 * kij (отсутствие = отказ, НЕ kij = 0); симметрия kij = kji;
 * применимость по T проверяется по верифицированному диапазону.
 * Успех никогда не содержит NaN/Infinity. Результат инвариантен
 * перестановке компонентов входа (канонический порядок).
 */
export function computePengRobinsonMixture(
  inputs: PengRobinsonMixtureInputs,
  request: PengRobinsonMixtureRequest
): PengRobinsonMixtureResult {
  // --- Валидация запроса (invalid_input) ---
  const requestFailure = validatePengRobinsonMixtureRequest(request);
  if (requestFailure !== null) {
    return requestFailure;
  }

  // --- Валидация и канонизация входов ---
  const canonicalized = validateAndCanonicalizeInputs(inputs);
  if (!canonicalized.ok) {
    return canonicalized.failure;
  }
  const components = canonicalized.components;
  const pairMap = canonicalized.pairMap;
  const temperatureK = request.temperatureK;
  const pressurePa = request.pressurePa;

  // --- Политика доказанности: компоненты с положительными долями ---
  const warnings: PengRobinsonMixtureWarning[] = [];
  const rejectedComponents: string[] = [];
  for (const c of components) {
    if (c.moleFraction <= 0) {
      continue;
    }
    const fields: readonly [keyof PengRobinsonParameterEvidence, string][] = [
      ['criticalTemperatureK', 'criticalTemperatureK'],
      ['criticalPressurePa', 'criticalPressurePa'],
      ['acentricFactor', 'acentricFactor']
    ];
    for (const [field, label] of fields) {
      const { rejected, warning } = evaluateStatusAgainstPolicy(
        `компонент «${c.component}»`,
        label,
        c.evidence[field],
        request.evidencePolicy,
        'partially_verified_parameter',
        c.crossChecks
      );
      if (rejected !== null) {
        rejectedComponents.push(`${c.component}.${rejected}`);
      } else if (warning !== null) {
        warnings.push(warning);
      }
    }
  }
  if (rejectedComponents.length > 0) {
    return {
      status: 'failure',
      code: 'parameter_evidence_not_accepted',
      message:
        `политика «${request.evidencePolicy}» не принимает статусы доказанности параметров компонентов: ` +
        `${rejectedComponents.join(', ')}. Политики: verified_only — только VERIFIED; ` +
        `allow_partial — +PARTIALLY_VERIFIED; allow_unresolved_cross_check — ` +
        `+UNRESOLVED_CROSS_CHECK. Статус UNRESOLVED не принимается ни одной политикой. ` +
        `Статусы данных не повышаются: используйте явную политику или другой источник данных.`,
      detail: rejectedComponents.join(', ')
    };
  }

  // --- Требуемые пары (положительные доли) и полнота kij ---
  const active = components.filter((c) => c.moleFraction > 0);
  const requiredPairs: { a: PengRobinsonMixtureComponentInput; b: PengRobinsonMixtureComponentInput }[] = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      requiredPairs.push({ a: active[i], b: active[j] });
    }
  }
  const missing: string[] = [];
  for (const pair of requiredPairs) {
    const key = canonicalPairKey(pair.a.component, pair.b.component);
    if (!pairMap.has(key)) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    return {
      status: 'failure',
      code: 'missing_binary_interaction',
      message:
        `отсутствуют бинарные параметры взаимодействия для пар: ${missing.join(', ')}. ` +
        `Расчёт смеси без kij НЕ выполняется (fail-closed): kij = 0 не является «нейтральным» ` +
        `значением и молча не подставляется.`,
      detail: missing.join(', ')
    };
  }

  // --- Политика доказанности и применимость kij ---
  const rejectedPairs: string[] = [];
  const binaryInteractionsUsed: PengRobinsonMixtureBinaryInteractionUsed[] = [];
  for (const pair of requiredPairs) {
    const key = canonicalPairKey(pair.a.component, pair.b.component);
    const record = pairMap.get(key);
    if (record === undefined) {
      continue; // уже обработано missing выше
    }
    const { rejected, warning } = evaluateStatusAgainstPolicy(
      `бинарное взаимодействие «${key}»`,
      'kij',
      record.evidence,
      request.evidencePolicy,
      'partially_verified_binary_interaction',
      []
    );
    if (rejected !== null) {
      rejectedPairs.push(`${key}.${rejected}`);
    } else if (warning !== null) {
      warnings.push(warning);
    }
    if (
      record.applicabilityRangeK !== null &&
      (temperatureK < record.applicabilityRangeK.minTemperatureK ||
        temperatureK > record.applicabilityRangeK.maxTemperatureK)
    ) {
      return {
        status: 'failure',
        code: 'binary_interaction_applicability',
        message:
          `температура ${temperatureK} K вне верифицированного диапазона применимости kij пары «${key}» ` +
          `[${record.applicabilityRangeK.minTemperatureK}, ${record.applicabilityRangeK.maxTemperatureK}] K; ` +
          `применимость подгонки за пределами диапазона не верифицирована — отказ (fail-closed)`,
        detail: key
      };
    }
    binaryInteractionsUsed.push({
      componentA: record.componentA < record.componentB ? record.componentA : record.componentB,
      componentB: record.componentA < record.componentB ? record.componentB : record.componentA,
      kij: record.kij,
      evidence: record.evidence,
      applicabilityRangeK: record.applicabilityRangeK
    });
  }
  if (rejectedPairs.length > 0) {
    return {
      status: 'failure',
      code: 'parameter_evidence_not_accepted',
      message:
        `политика «${request.evidencePolicy}» не принимает статусы доказанности бинарных параметров: ` +
        `${rejectedPairs.join(', ')}. Статус UNRESOLVED не принимается ни одной политикой; ` +
        `kij PARTIALLY_VERIFIED требуют allow_partial или выше.`,
      detail: rejectedPairs.join(', ')
    };
  }
  binaryInteractionsUsed.sort((x, y) => (x.componentA + '|' + x.componentB < y.componentA + '|' + y.componentB ? -1 : 1));

  // --- Чистокомпонентные a_i(T), b_i (существующий вычислитель) ---
  const R = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
  const perComponent = components.map((c) => {
    const intermediate = computePengRobinsonPureParameters(
      c.criticalTemperatureK,
      c.criticalPressurePa,
      c.acentricFactor,
      temperatureK,
      pressurePa
    );
    return { component: c, a: intermediate.aPaM6PerMol2, b: intermediate.bM3PerMol };
  });
  for (const item of perComponent) {
    if (!Number.isFinite(item.a) || item.a < 0 || !Number.isFinite(item.b) || item.b <= 0) {
      return {
        status: 'failure',
        code: 'numerical_failure',
        message:
          `неконечные/недопустимые a_i или b_i для «${item.component.component}» при ` +
          `T=${temperatureK} K, P=${pressurePa} Pa; надёжный расчёт невозможен`
      };
    }
  }

  // --- Матрица a_ij (a_ii = a_i; a_ij = (1-kij) sqrt(a_i a_j)) ---
  const n = perComponent.length;
  const aIJ: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    aIJ[i][i] = perComponent[i].a;
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const xi = perComponent[i].component.moleFraction;
      const xj = perComponent[j].component.moleFraction;
      // Пары с нулевой долей хотя бы одного компонента в суммы не входят
      // (x_i x_j = 0, x_j a_ij = 0): их a_ij вносит ровно ноль и
      // значение kij для них НЕ требуется и НЕ используется.
      if (xi <= 0 || xj <= 0) {
        aIJ[i][j] = 0;
        aIJ[j][i] = 0;
        continue;
      }
      const key = canonicalPairKey(perComponent[i].component.component, perComponent[j].component.component);
      const record = pairMap.get(key);
      if (record === undefined) {
        return {
          status: 'failure',
          code: 'missing_binary_interaction',
          message:
            `отсутствует бинарный параметр взаимодействия для пары «${key}». ` +
            `Расчёт смеси без kij НЕ выполняется (fail-closed): kij = 0 не является «нейтральным» значением.`,
          detail: key
        };
      }
      const cross = (1 - record.kij) * Math.sqrt(perComponent[i].a * perComponent[j].a);
      if (!Number.isFinite(cross)) {
        return {
          status: 'failure',
          code: 'numerical_failure',
          message: `неконечное a_ij для пары «${key}»; надёжный расчёт невозможен`,
          detail: key
        };
      }
      aIJ[i][j] = cross;
      aIJ[j][i] = cross;
    }
  }

  // --- a_mix, b_mix (суммы в каноническом порядке), A_mix, B_mix ---
  let aMix = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      aMix += perComponent[i].component.moleFraction * perComponent[j].component.moleFraction * aIJ[i][j];
    }
  }
  let bMix = 0;
  for (let i = 0; i < n; i += 1) {
    bMix += perComponent[i].component.moleFraction * perComponent[i].b;
  }
  const dimensionlessA = (aMix * pressurePa) / (R * R * temperatureK * temperatureK);
  const dimensionlessB = (bMix * pressurePa) / (R * temperatureK);
  if (
    !Number.isFinite(aMix) || aMix < 0 ||
    !Number.isFinite(bMix) || bMix <= 0 ||
    !Number.isFinite(dimensionlessA) || dimensionlessA < 0 ||
    !Number.isFinite(dimensionlessB) || dimensionlessB <= 0
  ) {
    return {
      status: 'failure',
      code: 'numerical_failure',
      message:
        `неконечные/недопустимые величины смешения (a_mix=${String(aMix)}, b_mix=${String(bMix)}, ` +
        `A_mix=${String(dimensionlessA)}, B_mix=${String(dimensionlessB)}); надёжный расчёт невозможен`
    };
  }

  // --- Кубика смеси (тот же решатель и фильтр, что и в 4.4.4.2) ---
  const cubic = solvePrCubicRealRoots(dimensionlessA, dimensionlessB);
  if (!cubic.ok) {
    return {
      status: 'failure',
      code: 'cubic_solver_failure',
      message: `кубическое уравнение PR смеси не решено надёжно: ${cubic.reason}`
    };
  }
  const physical = prPhysicalRoots(cubic.roots, dimensionlessB);
  if (physical.length === 0) {
    return {
      status: 'failure',
      code: 'no_physical_root',
      message:
        `нет физически допустимых корней (Z > B_mix=${dimensionlessB}) для смеси при ` +
        `T=${temperatureK} K, P=${pressurePa} Pa`,
      detail: `действительные корни: ${cubic.roots.join(', ')}`
    };
  }

  // --- Выбор ветви ---
  const selectedRoot = request.root === 'vapor' ? physical[physical.length - 1] : physical[0];
  const hasDistinctBranches = physical.length >= 2;
  if (!hasDistinctBranches) {
    warnings.push({
      code: 'single_physical_root',
      message:
        `единственный физически допустимый корень (Z = ${selectedRoot}); ` +
        `отдельной альтернативной ветви нет — выбранная ветвь «${request.root}» использует тот же корень`
    });
  }
  if (components.some((c) => c.moleFraction > 0 && c.component === 'h2o')) {
    warnings.push({
      code: 'h2o_classical_pr_limitations',
      message:
        'H2O — полярный ассоциирующий компонент: классический PR без специальных модификаций ' +
        'ограниченно применим к водным смесям; результат — в рамках классической PR-модели и не ' +
        'является точным описанием водной смеси'
    });
  }

  // --- Компонентные ln(phi_i), phi_i, f_i ---
  const Z = selectedRoot;
  const lnZMinusB = Math.log(Z) + Math.log1p(-dimensionlessB / Z);
  const logRatio =
    Math.log1p(((1 + Math.SQRT2) * dimensionlessB) / Z) -
    Math.log1p(((1 - Math.SQRT2) * dimensionlessB) / Z);
  if (!Number.isFinite(lnZMinusB) || !Number.isFinite(logRatio)) {
    return {
      status: 'failure',
      code: 'logarithm_domain_error',
      message:
        `логарифмы ln(phi_i) вне области определения (Z=${Z}, B_mix=${dimensionlessB}); ` +
        `надёжный расчёт невозможен`
    };
  }
  const attractionFactor = dimensionlessA / (2 * Math.SQRT2 * dimensionlessB);
  const componentResults: PengRobinsonMixtureComponentResult[] = [];
  for (let i = 0; i < n; i += 1) {
    const c = perComponent[i].component;
    let sI = 0;
    for (let j = 0; j < n; j += 1) {
      sI += perComponent[j].component.moleFraction * aIJ[i][j];
    }
    const lnPhi =
      (perComponent[i].b / bMix) * (Z - 1) -
      lnZMinusB -
      attractionFactor * (2 * sI / aMix - perComponent[i].b / bMix) * logRatio;
    if (!Number.isFinite(lnPhi)) {
      return {
        status: 'failure',
        code: 'logarithm_domain_error',
        message:
          `ln(phi_i) вне области определения для компонента «${c.component}» ` +
          `(Z=${Z}, B_mix=${dimensionlessB})`
      };
    }
    const phi = Math.exp(lnPhi);
    const fugacityPa = c.moleFraction * phi * pressurePa;
    if (!Number.isFinite(phi) || phi <= 0 || !Number.isFinite(fugacityPa) || fugacityPa < 0) {
      return {
        status: 'failure',
        code: 'numerical_failure',
        message:
          `неконечный результат для компонента «${c.component}»: ln(phi_i)=${lnPhi}, ` +
          `phi_i=${String(phi)}, f_i=${String(fugacityPa)}; надёжный расчёт невозможен`
      };
    }
    componentResults.push({
      component: c.component,
      moleFraction: c.moleFraction,
      aPaM6PerMol2: perComponent[i].a,
      bM3PerMol: perComponent[i].b,
      sIPaM6PerMol2: sI,
      lnPhi,
      phi,
      fugacityPa
    });
  }

  return {
    status: 'success',
    temperatureK,
    pressurePa,
    root: request.root,
    evidencePolicy: request.evidencePolicy,
    aMixPaM6PerMol2: aMix,
    bMixM3PerMol: bMix,
    dimensionlessA,
    dimensionlessB,
    Z,
    selectedRoot,
    realRoots: cubic.roots,
    physicalRoots: physical,
    distinctPhysicalRootCount: physical.length,
    hasDistinctBranches,
    components: componentResults,
    binaryInteractionsUsed,
    warnings,
    notes: [PENG_ROBINSON_MIXTURE_BRANCH_NOTE]
  };
}

// ============================================
// 5. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Stage 4.4.4.3 — чистая математика PR смесей в слое Core. Границы:
// каталоги (чистых параметров и kij) — Data; flash, VLE/LLE, фазовая
// устойчивость, PPR78, конденсированные фазы, ternary-параметры и
// интеграция с solveEquilibrium — вне объёма подэтапа.
