// ============================================
// PENG–ROBINSON — чистокомпонентный EOS: Z, phi, фугитивность
// ============================================
//
// Stage 4.4.4.2 «Чистокомпонентный Peng–Robinson: Z, phi и фугитивность».
//
// Реализованы ТОЛЬКО классические соотношения Peng–Robinson для ЧИСТОГО
// компонента (Peng & Robinson 1976, doi:10.1021/i160057a011):
//
//   a(T) = 0.45724 * R^2 * Tc^2 / pc * alpha(T)
//   b    = 0.07780 * R * Tc / pc
//   kappa = 0.37464 + 1.54226*omega - 0.26992*omega^2
//   alpha(T) = [1 + kappa*(1 - sqrt(T/Tc))]^2
//   A = a*P / (R^2*T^2),  B = b*P / (R*T)
//   Z^3 - (1-B)Z^2 + (A - 3B^2 - 2B)Z - (AB - B^2 - B^3) = 0
//   ln(phi) = Z - 1 - ln(Z - B)
//             - A/(2*sqrt(2)*B) * ln[(Z + (1+sqrt(2))B)/(Z + (1-sqrt(2))B)]
//   phi = exp(ln(phi)),  f = phi * P
//
// Все величины в SI: T — K, P — Pa, a — Pa*m^6/mol^2, b — m^3/mol,
// f — Pa; Z, A, B, kappa, alpha, phi — безразмерные.
//
// ВАЖНО о выборе ветви: выбор корня 'vapor' (наибольший физически
// допустимый корень) или 'liquid' (наименьший) — это выбор
// МАТЕМАТИЧЕСКОЙ ветви кубического уравнения. Он сам по себе НЕ
// доказывает глобальную термодинамическую устойчивость фазы и НЕ
// заменяет сравнение энергий Гиббса/фугитивностей фаз. Flash,
// VLE/LLE и фазовая устойчивость в этом подэтапе НЕ реализованы.
//
// Научная политика доказанности (evidence policy) — ЯВНАЯ:
//   verified_only                  — только поля со статусом VERIFIED;
//   allow_partial                  — + PARTIALLY_VERIFIED (с предупреждением);
//   allow_unresolved_cross_check   — + UNRESOLVED_CROSS_CHECK (только по
//                                    явному выбору вызывающего кода, с
//                                    предупреждением о конфликте).
// Статус UNRESOLVED не принимается НИ ПРИ КАКОЙ политике. Политика не
// подставляется молча: отсутствующая/неизвестная политика — отказ
// invalid_input. Статусы данных НЕ повышаются ради прохождения тестов:
// omega всех пяти компонентов каталога — PARTIALLY_VERIFIED (CH4 —
// UNRESOLVED_CROSS_CHECK), поэтому verified_only отказывает всем пяти,
// allow_partial разрешает co2/n2/h2o/ar, CH4 — только при явной политике
// allow_unresolved_cross_check.
//
// НЕ реализовано в этом подэтапе (границы Stage 4.4.4.2):
// - бинарные смеси, правила смешения, kij, PPR78 (4.4.4.3+);
// - фугитивность смесей, VLE/LLE flash, равновесная устойчивость фаз;
// - конденсированные фазы; интеграция с solveEquilibrium;
// - изменение result.model = 'ideal_gas' равновесного решателя.
//
// Независимый программный benchmark (CoolProp, backend 'PR') в среде
// разработки НЕ ВЫПОЛНЕН (нет доступа к CoolProp в рабочем окружении):
// зафиксирован блокер, выполнены аналитические проверки (идеальный
// предел, тройной корень критической точки, интегральное тождество
// ln(phi) = интеграл (Z-1)/P dP, равенство фугитивностей ветвей на
// PR-изобаре насыщения) — см. Tests/pengRobinson.test.ts и
// docs/science/DATA_PROVENANCE.md §2.30. Числовые значения закрытых
// пакетов НЕ копировались.

import { getEosPureComponentParameters, EosParametersError } from '../Data/eosParameters';

import type {
  EosPureComponentGasId,
  EosPureComponentParameters,
  EosScalarParameter,
  EosEvidenceStatus,
  EosCrossCheck
} from '../Data/eosParameters';

// ============================================
// 1. КОНСТАНТЫ И ТИПЫ
// ============================================

/**
 * Универсальная газовая постоянная, J/(mol*K).
 * CODATA 2018 / определение СИ-2019: R = 8.31446261815324… J/(mol*K)
 * (точное значение через N_A * k); хранится с 12 значащими цифрами.
 */
export const UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K = 8.314462618;

/** Константа члена притяжения a(T) классического PR (Peng & Robinson 1976). */
export const PR_OMEGA_A = 0.45724;

/** Константа co-volume b классического PR (Peng & Robinson 1976). */
export const PR_OMEGA_B = 0.0778;

/** Линейный член kappa(omega) классического PR. */
export const PR_KAPPA_C1 = 0.37464;

/** Квадратичный член kappa(omega) классического PR. */
export const PR_KAPPA_C2 = 1.54226;

/** Коэффициент при omega^2 в kappa(omega) классического PR. */
export const PR_KAPPA_C3 = 0.26992;

/** Ветка (математической) ветви корня кубического уравнения. */
export type PengRobinsonRootBranch = 'vapor' | 'liquid';

/** Реестр ветвей. */
export const PENG_ROBINSON_ROOT_BRANCHES: readonly PengRobinsonRootBranch[] = [
  'vapor',
  'liquid'
];

/**
 * Явная политика научной доказанности параметров. Политика передаётся
 * вызывающим кодом обязательно; молчаливой подстановки нет.
 */
export type PengRobinsonEvidencePolicy =
  | 'verified_only'
  | 'allow_partial'
  | 'allow_unresolved_cross_check';

/** Реестр политик доказанности. */
export const PENG_ROBINSON_EVIDENCE_POLICIES: readonly PengRobinsonEvidencePolicy[] = [
  'verified_only',
  'allow_partial',
  'allow_unresolved_cross_check'
];

/** Устойчивые коды отказов вычислителя PR. */
export type PengRobinsonErrorCode =
  | 'invalid_input'
  | 'unknown_component'
  | 'invalid_parameters'
  | 'parameter_evidence_not_accepted'
  | 'no_physical_root'
  | 'cubic_solver_failure'
  | 'logarithm_domain_error'
  | 'numerical_failure';

/** Реестр кодов отказов. */
export const PENG_ROBINSON_ERROR_CODES: readonly PengRobinsonErrorCode[] = [
  'invalid_input',
  'unknown_component',
  'invalid_parameters',
  'parameter_evidence_not_accepted',
  'no_physical_root',
  'cubic_solver_failure',
  'logarithm_domain_error',
  'numerical_failure'
];

/** Коды предупреждений о качестве данных и применимости. */
export type PengRobinsonWarningCode =
  | 'partially_verified_parameter'
  | 'unresolved_cross_check_parameter'
  | 'h2o_classical_pr_limitations'
  | 'single_physical_root';

/** Предупреждение результата: код + человекочитаемое описание. */
export interface PengRobinsonWarning {
  readonly code: PengRobinsonWarningCode;
  readonly message: string;
}

/**
 * Запрос к чистокомпонентному вычислителю PR. Политика доказанности
 * обязательна (её отсутствие — отказ invalid_input).
 */
export interface PengRobinsonPureRequest {
  readonly gasId: string;
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: PengRobinsonRootBranch;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
}

/** Фактические статусы доказанности использованных параметров. */
export interface PengRobinsonParameterEvidence {
  readonly criticalTemperatureK: EosEvidenceStatus;
  readonly criticalPressurePa: EosEvidenceStatus;
  readonly acentricFactor: EosEvidenceStatus;
}

/**
 * Успешный результат: значения, промежуточные величины, корни,
 * provenance и статусы использованных параметров, предупреждения.
 * NaN/Infinity в успешном результате исключены (проверены на выходе).
 */
export interface PengRobinsonPureSuccess {
  readonly status: 'success';
  readonly gasId: EosPureComponentGasId;
  readonly formula: string;
  readonly name: string;
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: PengRobinsonRootBranch;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;

  // Использованные параметры каталога (с per-field provenance).
  readonly criticalTemperatureK: EosScalarParameter;
  readonly criticalPressurePa: EosScalarParameter;
  readonly acentricFactor: EosScalarParameter;
  readonly evidence: PengRobinsonParameterEvidence;

  // Промежуточные величины PR (SI / безразмерные).
  readonly kappa: number;
  readonly alpha: number;
  readonly aPaM6PerMol2: number;
  readonly bM3PerMol: number;
  readonly dimensionlessA: number;
  readonly dimensionlessB: number;

  // Результат.
  readonly Z: number;
  readonly lnPhi: number;
  readonly phi: number;
  readonly fugacityPa: number;
  readonly selectedRoot: number;

  // Корни кубического уравнения.
  readonly realRoots: readonly number[];
  readonly physicalRoots: readonly number[];
  readonly distinctPhysicalRootCount: number;
  readonly hasDistinctBranches: boolean;

  // Предупреждения о применимости и качестве данных.
  readonly warnings: readonly PengRobinsonWarning[];
  // Дисклеймеры (в т.ч. о том, что выбор ветви — не фазовая устойчивость).
  readonly notes: readonly string[];
}

/** Отказ: устойчивый код + диагностика. */
export interface PengRobinsonPureFailure {
  readonly status: 'failure';
  readonly code: PengRobinsonErrorCode;
  readonly message: string;
  readonly gasId?: string;
  readonly detail?: string;
}

/** Discriminated union результата. */
export type PengRobinsonPureResult = PengRobinsonPureSuccess | PengRobinsonPureFailure;

// ============================================
// 2. КУБИЧЕСКОЕ УРАВНЕНИЕ PR (НИЗКОУРОВНЕВЫЕ ХЕЛПЕРЫ)
// ============================================

/** Коэффициенты кубического уравнения PR в форме z^3 + c2 z^2 + c1 z + c0. */
export interface PengRobinsonCubicCoefficients {
  readonly c0: number;
  readonly c1: number;
  readonly c2: number;
}

/**
 * Коэффициенты кубического уравнения PR
 * Z^3 - (1-B)Z^2 + (A-3B^2-2B)Z - (AB - B^2 - B^3) = 0
 * в форме z^3 + c2*z^2 + c1*z + c0.
 */
export function pengRobinsonCubicCoefficients(
  dimensionlessA: number,
  dimensionlessB: number
): PengRobinsonCubicCoefficients {
  const A = dimensionlessA;
  const B = dimensionlessB;
  return {
    c2: -(1 - B),
    c1: A - 3 * B * B - 2 * B,
    c0: B * B + B * B * B - A * B
  };
}

/** Результат низкоуровневого решателя: различимые действительные корни. */
export type PrCubicRealRootsResult =
  | { readonly ok: true; readonly roots: readonly number[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Действительные корни кубического уравнения PR.
 *
 * Численная устойчивость:
 * - приведение к депрессированному виду y^3 + p y + q (z = y + (1-B)/3);
 * - при p < 0 и |arg| <= 1 — тригонометрический метод (три корня);
 * - при p < 0 и |arg| > 1 — ГИПЕРБОЛИЧЕСКИЙ метод (единственный
 *   действительный корень): y = -2 sgn(q) sqrt(-p/3) cosh(acosh(|arg|)/3).
 *   Прямой Cardano здесь теряет точность из-за катастрофического
 *   сокращения в -q/2 +- sqrt(D) около кратных корней;
 * - масштабированный дискриминант: если D = (q/2)^2 + (p/3)^3
 *   близок к нулю относительно max((q/2)^2, |p/3|^3) (допуск 1e-12),
 *   используется тригонометрическая ветвь с клампом аргумента —
 *   почти кратные корни около критической области не «теряются»;
 * - при p >= 0 — Cardano (дискриминант неотрицателен, сокращение
 *   не катастрофично);
 * - невязка полинома проверяется для КАЖДОГО корня относительно
 *   масштаба коэффициентов; недопустимая невязка — отказ;
 * - дедупликация кратных корней с допуском
 *   1e-8 * max(1, |z_max|, B) (обоснование: ошибка кратного корня
 *   при двойной точности ~ sqrt(eps) ~ 1.5e-8);
 * - неконечные A/B дают отказ (не выдумываем значения).
 */
export function solvePrCubicRealRoots(
  dimensionlessA: number,
  dimensionlessB: number
): PrCubicRealRootsResult {
  if (!Number.isFinite(dimensionlessA) || !Number.isFinite(dimensionlessB)) {
    return { ok: false, reason: `неконечные параметры кубического уравнения: A=${String(dimensionlessA)}, B=${String(dimensionlessB)}` };
  }
  const { c0, c1, c2 } = pengRobinsonCubicCoefficients(dimensionlessA, dimensionlessB);
  const p = c1 - (c2 * c2) / 3;
  const q = (2 * c2 * c2 * c2) / 27 - (c1 * c2) / 3 + c0;

  const rawRoots: number[] = [];
  if (p < 0) {
    // Отношение, задающее тригонометрическую/гиперболическую ветвь.
    const arg = ((3 * q) / (2 * p)) * Math.sqrt(-3 / p);
    // Масштабированный дискриминант: почти кратные корни обрабатываются
    // тригонометрической ветвью с клампом аргумента.
    const qHalfSquared = (q / 2) * (q / 2);
    const pThirdCubed = (p / 3) * (p / 3) * (p / 3);
    const discScale = Math.max(Math.abs(qHalfSquared), Math.abs(pThirdCubed), 1e-300);
    const discriminant = qHalfSquared + pThirdCubed;
    if (Math.abs(arg) <= 1 || discriminant <= 1e-12 * discScale) {
      // Три действительных корня (кламп arg — только защита от округления).
      const clamped = Math.max(-1, Math.min(1, arg));
      const theta = Math.acos(clamped) / 3;
      const amplitude = 2 * Math.sqrt(-p / 3);
      for (let k = 0; k < 3; k += 1) {
        rawRoots.push(amplitude * Math.cos(theta - (2 * Math.PI * k) / 3));
      }
    } else {
      // Единственный действительный корень: гиперболический метод без
      // катастрофического сокращения (устойчив около кратных корней).
      const h = Math.abs(arg);
      rawRoots.push(
        -2 * Math.sign(q) * Math.sqrt(-p / 3) * Math.cosh(Math.acosh(h) / 3)
      );
    }
  } else {
    // p >= 0: дискриминант неотрицателен, Cardano устойчив.
    const discriminant = (q / 2) * (q / 2) + (p / 3) * (p / 3) * (p / 3);
    const squareRoot = Math.sqrt(discriminant);
    rawRoots.push(Math.cbrt(-q / 2 + squareRoot) + Math.cbrt(-q / 2 - squareRoot));
  }

  // Возврат к z и проверка невязки каждого корня.
  const shift = (1 - dimensionlessB) / 3;
  const candidates = rawRoots.map((y) => y + shift);
  const coefficientScale = Math.max(1, Math.abs(c2), Math.abs(c1), Math.abs(c0));
  for (const z of candidates) {
    if (!Number.isFinite(z)) {
      return { ok: false, reason: `неконечный корень: z=${String(z)}` };
    }
    const residual = Math.abs(z * z * z + c2 * z * z + c1 * z + c0);
    const tolerance = 1e-8 * coefficientScale * Math.pow(Math.max(1, Math.abs(z)), 3);
    if (!Number.isFinite(residual) || residual > tolerance) {
      return {
        ok: false,
        reason: `невязка полинома ${residual} превышает допуск ${tolerance} в корне z=${z}`
      };
    }
  }

  // Сортировка и дедупликация кратных (в пределах допуска) корней.
  const dedupTolerance = 1e-8 * Math.max(1, ...candidates.map((z) => Math.abs(z)), dimensionlessB);
  const sorted = candidates.slice().sort((x, y) => x - y);
  const distinct: number[] = [];
  for (const z of sorted) {
    if (distinct.length === 0 || Math.abs(z - distinct[distinct.length - 1]) > dedupTolerance) {
      distinct.push(z);
    }
  }
  return { ok: true, roots: distinct };
}

/**
 * Физически допустимые корни: Z > B (строго) — требование областей
 * определения логарифмов в ln(phi) (Z - B > 0 и Z + (1 - sqrt(2))B > 0,
 * что выполнено автоматически при Z > B, так как sqrt(2) - 1 < 1).
 * Возвращает отсортированный по возрастанию массив.
 */
export function prPhysicalRoots(roots: readonly number[], dimensionlessB: number): readonly number[] {
  return roots.filter((z) => Number.isFinite(z) && z > dimensionlessB).sort((x, y) => x - y);
}

// ============================================
// 3. ПАРАМЕТРЫ ЧИСТОГО КОМПОНЕНТА PR
// ============================================

/** Промежуточные величины PR чистого компонента (SI / безразмерные). */
export interface PengRobinsonPureIntermediate {
  readonly kappa: number;
  readonly alpha: number;
  /** a(T), Pa*m^6/mol^2. */
  readonly aPaM6PerMol2: number;
  /** b, m^3/mol. */
  readonly bM3PerMol: number;
  readonly dimensionlessA: number;
  readonly dimensionlessB: number;
}

/**
 * Классические величины PR для чистого компонента (Peng & Robinson
 * 1976). Игровые коэффициенты (gameSpeedCoefficient и т.п.) НЕ
 * используются. Возвращает NaN/Infinity-значения только при
 * неопределённых входах — вызывающий код обязан их отвергнуть.
 */
export function computePengRobinsonPureParameters(
  criticalTemperatureK: number,
  criticalPressurePa: number,
  acentricFactor: number,
  temperatureK: number,
  pressurePa: number
): PengRobinsonPureIntermediate {
  const R = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
  const kappa = PR_KAPPA_C1 + PR_KAPPA_C2 * acentricFactor - PR_KAPPA_C3 * acentricFactor * acentricFactor;
  const alpha =
    (1 + kappa * (1 - Math.sqrt(temperatureK / criticalTemperatureK))) ** 2;
  const a = (PR_OMEGA_A * R * R * criticalTemperatureK * criticalTemperatureK * alpha) / criticalPressurePa;
  const b = (PR_OMEGA_B * R * criticalTemperatureK) / criticalPressurePa;
  const dimensionlessA = (a * pressurePa) / (R * R * temperatureK * temperatureK);
  const dimensionlessB = (b * pressurePa) / (R * temperatureK);
  return { kappa, alpha, aPaM6PerMol2: a, bM3PerMol: b, dimensionlessA, dimensionlessB };
}

/**
 * ln(phi) для физически допустимого корня (Z > B). Численно устойчивая
 * форма: ln(Z - B) = ln(Z) + log1p(-B/Z), логарифмическое отношение
 * через log1p — нет неустойчивых выражений вида 0/0 при B -> 0;
 * предел A, B -> 0 (A/B = a/(bRT) — конечен) обрабатывается гладко.
 */
export function pengRobinsonLnPhi(
  z: number,
  dimensionlessA: number,
  dimensionlessB: number
): number {
  if (!(z > dimensionlessB) || !(z > 0)) {
    return Number.NaN;
  }
  const lnZMinusB = Math.log(z) + Math.log1p(-dimensionlessB / z);
  if (!Number.isFinite(lnZMinusB)) {
    return Number.NaN;
  }
  const logRatio =
    Math.log1p(((1 + Math.SQRT2) * dimensionlessB) / z) -
    Math.log1p(((1 - Math.SQRT2) * dimensionlessB) / z);
  const result =
    z - 1 - lnZMinusB -
    (dimensionlessA / (2 * Math.SQRT2 * dimensionlessB)) * logRatio;
  return result;
}

// ============================================
// 4. ПОЛИТИКА ДОКАЗАННОСТИ И ПРЕДУПРЕЖДЕНИЯ
// ============================================

/** Статусы параметров записи каталога. */
function parameterEvidence(record: EosPureComponentParameters): PengRobinsonParameterEvidence {
  return {
    criticalTemperatureK: record.criticalTemperatureK.provenance.evidence,
    criticalPressurePa: record.criticalPressurePa.provenance.evidence,
    acentricFactor: record.acentricFactor.provenance.evidence
  };
}

/** Описание параметра для диагностик. */
type EvidenceFieldName = 'criticalTemperatureK' | 'criticalPressurePa' | 'acentricFactor';

/** Проверка статуса параметра против политики; собирает отказы и предупреждения. */
function evaluateEvidencePolicy(
  record: EosPureComponentParameters,
  policy: PengRobinsonEvidencePolicy
): { rejected: readonly string[]; warnings: readonly PengRobinsonWarning[] } {
  const evidence = parameterEvidence(record);
  const rejected: string[] = [];
  const warnings: PengRobinsonWarning[] = [];
  const fields: readonly EvidenceFieldName[] = [
    'criticalTemperatureK',
    'criticalPressurePa',
    'acentricFactor'
  ];
  for (const field of fields) {
    const status = evidence[field];
    if (status === 'VERIFIED') {
      continue;
    }
    if (status === 'PARTIALLY_VERIFIED') {
      if (policy === 'verified_only') {
        rejected.push(`${field}=PARTIALLY_VERIFIED`);
      } else {
        warnings.push({
          code: 'partially_verified_parameter',
          message:
            `параметр ${field} имеет статус PARTIALLY_VERIFIED и использован ` +
            `по политике «${policy}»; результат зависит от частично проверенного значения`
        });
      }
      continue;
    }
    if (status === 'UNRESOLVED_CROSS_CHECK') {
      if (policy === 'allow_unresolved_cross_check') {
        const conflicts = record.crossChecks.filter(
          (cc: EosCrossCheck) => cc.outcome === 'discrepancy'
        );
        const conflictDetails = conflicts
          .map((cc) => `${cc.subject}: каталог ${cc.catalogValue} против ${cc.crossSource}: ${cc.crossValue} (исход ${cc.outcome}); ${cc.resolution}`)
          .join('; ');
        warnings.push({
          code: 'unresolved_cross_check_parameter',
          message:
            `параметр ${field} имеет статус UNRESOLVED_CROSS_CHECK и использован ` +
            `ТОЛЬКО по явному выбору политики «${policy}»; ` +
            (conflictDetails !== ''
              ? `зафиксированный конфликт: ${conflictDetails}`
              : 'конфликт задокументирован в provenance параметра')
        });
      } else {
        rejected.push(`${field}=UNRESOLVED_CROSS_CHECK`);
      }
      continue;
    }
    // UNRESOLVED — не принимается НИ ПРИ КАКОЙ политике.
    rejected.push(`${field}=UNRESOLVED`);
  }
  return { rejected, warnings };
}

// ============================================
// 5. ПУБЛИЧНЫЙ ВЫЧИСЛИТЕЛЬ
// ============================================

/** Дисклеймер о математическом характере выбора ветви (в каждом успехе). */
const BRANCH_SELECTION_NOTE =
  'Выбор ветви (vapor/liquid) — выбор математической ветви кубического ' +
  'уравнения PR по физически допустимым корням (Z > B); он НЕ доказывает ' +
  'глобальную термодинамическую устойчивость фазы и НЕ заменяет flash или ' +
  'сравнение фугитивностей/энергий Гиббса фаз (не реализовано в Stage 4.4.4.2).';

/** Проверка «конечное число». */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Чистокомпонентный вычислитель Peng–Robinson: Z, phi и фугитивность
 * для co2/n2/ch4/h2o/ar из каталога Stage 4.4.4.1.
 *
 * Требования к запросу: gasId — строка из каталога; T > 0 и P > 0
 * конечны; root — 'vapor' | 'liquid'; evidencePolicy — ЯВНО указана.
 * Отказы fail-closed: неизвестный компонент, непринятые статусы
 * доказанности, отсутствие физического корня, численные проблемы.
 * Успех никогда не содержит NaN/Infinity.
 */
export function computePengRobinsonPure(request: PengRobinsonPureRequest): PengRobinsonPureResult {
  // --- Валидация входа (invalid_input) ---
  if (typeof request.gasId !== 'string' || request.gasId.trim() === '') {
    return {
      status: 'failure',
      code: 'invalid_input',
      message:
        `gasId должен быть непустой строкой, получено: ${String(request.gasId)}; ` +
        `каталог PR 4.4.4.1: co2, n2, ch4, h2o, ar (h2 исключён)`
    };
  }
  if (!isFiniteNumber(request.temperatureK) || request.temperatureK <= 0) {
    return {
      status: 'failure',
      code: 'invalid_input',
      message: `temperatureK должен быть конечным положительным числом (K), получено: ${String(request.temperatureK)}`
    };
  }
  if (!isFiniteNumber(request.pressurePa) || request.pressurePa <= 0) {
    return {
      status: 'failure',
      code: 'invalid_input',
      message: `pressurePa должен быть конечным положительным числом (Pa), получено: ${String(request.pressurePa)}`
    };
  }
  if (!PENG_ROBINSON_ROOT_BRANCHES.includes(request.root)) {
    return {
      status: 'failure',
      code: 'invalid_input',
      message: `root должен быть 'vapor' или 'liquid', получено: ${String(request.root)}`
    };
  }
  // Политика доказанности обязательна и явна — молчаливой подстановки нет.
  if (!PENG_ROBINSON_EVIDENCE_POLICIES.includes(request.evidencePolicy)) {
    return {
      status: 'failure',
      code: 'invalid_input',
      message:
        `evidencePolicy обязателен и должен быть одним из: ` +
        `${PENG_ROBINSON_EVIDENCE_POLICIES.join(', ')}; получено: ${String(request.evidencePolicy)}`
    };
  }

  // --- Lookup каталога (fail-closed) ---
  let record: EosPureComponentParameters;
  try {
    record = getEosPureComponentParameters(request.gasId);
  } catch (error) {
    if (error instanceof EosParametersError) {
      if (error.code === 'unknown_gas') {
        return {
          status: 'failure',
          code: 'unknown_component',
          message: error.message,
          gasId: request.gasId,
          detail: `h2 и компоненты вне каталога Stage 4.4.4.1 не поддерживаются чистокомпонентным PR`
        };
      }
      return {
        status: 'failure',
        code: 'invalid_parameters',
        message: error.message,
        gasId: request.gasId,
        detail: error.issues.join('; ')
      };
    }
    throw error;
  }

  // --- Политика доказанности параметров ---
  const { rejected, warnings } = evaluateEvidencePolicy(record, request.evidencePolicy);
  if (rejected.length > 0) {
    return {
      status: 'failure',
      code: 'parameter_evidence_not_accepted',
      message:
        `политика «${request.evidencePolicy}» не принимает статусы доказанности ` +
        `параметров компонента «${request.gasId}»: ${rejected.join(', ')}. ` +
        `Политики: verified_only — только VERIFIED; allow_partial — +PARTIALLY_VERIFIED; ` +
        `allow_unresolved_cross_check — +UNRESOLVED_CROSS_CHECK. ` +
        `Статус UNRESOLVED не принимается ни одной политикой. ` +
        `Статусы данных не повышаются: используйте явную политику или другой источник данных.`,
      gasId: request.gasId,
      detail: rejected.join(', ')
    };
  }

  // --- Промежуточные величины PR ---
  const Tc = record.criticalTemperatureK.value;
  const Pc = record.criticalPressurePa.value;
  const omega = record.acentricFactor.value;
  const intermediate = computePengRobinsonPureParameters(Tc, Pc, omega, request.temperatureK, request.pressurePa);
  const finiteIntermediate =
    Number.isFinite(intermediate.kappa) &&
    Number.isFinite(intermediate.alpha) &&
    Number.isFinite(intermediate.aPaM6PerMol2) &&
    Number.isFinite(intermediate.bM3PerMol) &&
    Number.isFinite(intermediate.dimensionlessA) &&
    Number.isFinite(intermediate.dimensionlessB) &&
    intermediate.bM3PerMol > 0 &&
    intermediate.alpha >= 0 &&
    intermediate.dimensionlessA >= 0 &&
    intermediate.dimensionlessB > 0;
  if (!finiteIntermediate) {
    return {
      status: 'failure',
      code: 'numerical_failure',
      message:
        `неконечные промежуточные величины PR для «${request.gasId}» при ` +
        `T=${request.temperatureK} K, P=${request.pressurePa} Pa; надёжный расчёт невозможен`,
      gasId: request.gasId
    };
  }

  // --- Решение кубического уравнения ---
  const cubic = solvePrCubicRealRoots(intermediate.dimensionlessA, intermediate.dimensionlessB);
  if (!cubic.ok) {
    return {
      status: 'failure',
      code: 'cubic_solver_failure',
      message: `кубическое уравнение PR не решено надёжно для «${request.gasId}»: ${cubic.reason}`,
      gasId: request.gasId
    };
  }
  const physical = prPhysicalRoots(cubic.roots, intermediate.dimensionlessB);
  if (physical.length === 0) {
    return {
      status: 'failure',
      code: 'no_physical_root',
      message:
        `нет физически допустимых корней (Z > B=${intermediate.dimensionlessB}) ` +
        `для «${request.gasId}» при T=${request.temperatureK} K, P=${request.pressurePa} Pa`,
      gasId: request.gasId,
      detail: `действительные корни: ${cubic.roots.join(', ')}`
    };
  }

  // --- Выбор ветви ---
  const selectedRoot = request.root === 'vapor' ? physical[physical.length - 1] : physical[0];
  const hasDistinctBranches = physical.length >= 2;
  const resultWarnings: PengRobinsonWarning[] = [...warnings];
  if (!hasDistinctBranches) {
    resultWarnings.push({
      code: 'single_physical_root',
      message:
        `единственный физически допустимый корень (Z = ${selectedRoot}); ` +
        `отдельной альтернативной ветви нет — выбранная ветвь «${request.root}» использует тот же корень`
    });
  }
  // H2O: классический PR для полярного ассоциирующего компонента — всегда
  // с предупреждением (математический расчёт возможен, точным описанием
  // воды результат НЕ является).
  if (request.gasId === 'h2o') {
    resultWarnings.push({
      code: 'h2o_classical_pr_limitations',
      message:
        `H2O — полярный ассоциирующий компонент: классический PR без специальных ` +
        `модификаций ограниченно применим (ограничения каталога: ${record.limitations.join(' ')})`
    });
  }

  // --- ln(phi), phi, фугитивность ---
  const lnPhi = pengRobinsonLnPhi(selectedRoot, intermediate.dimensionlessA, intermediate.dimensionlessB);
  if (!Number.isFinite(lnPhi)) {
    return {
      status: 'failure',
      code: 'logarithm_domain_error',
      message:
        `ln(phi) вне области определения для «${request.gasId}» ` +
        `(корень Z=${selectedRoot}, B=${intermediate.dimensionlessB})`,
      gasId: request.gasId
    };
  }
  const phi = Math.exp(lnPhi);
  const fugacityPa = phi * request.pressurePa;
  if (!Number.isFinite(phi) || !Number.isFinite(fugacityPa) || phi <= 0 || fugacityPa <= 0) {
    return {
      status: 'failure',
      code: 'numerical_failure',
      message:
        `неконечный результат для «${request.gasId}»: ln(phi)=${lnPhi}, phi=${String(phi)}, ` +
        `f=${String(fugacityPa)}; надёжный расчёт невозможен`,
      gasId: request.gasId
    };
  }

  return {
    status: 'success',
    gasId: record.gasId as EosPureComponentGasId,
    formula: record.formula,
    name: record.name,
    temperatureK: request.temperatureK,
    pressurePa: request.pressurePa,
    root: request.root,
    evidencePolicy: request.evidencePolicy,

    criticalTemperatureK: record.criticalTemperatureK,
    criticalPressurePa: record.criticalPressurePa,
    acentricFactor: record.acentricFactor,
    evidence: parameterEvidence(record),

    kappa: intermediate.kappa,
    alpha: intermediate.alpha,
    aPaM6PerMol2: intermediate.aPaM6PerMol2,
    bM3PerMol: intermediate.bM3PerMol,
    dimensionlessA: intermediate.dimensionlessA,
    dimensionlessB: intermediate.dimensionlessB,

    Z: selectedRoot,
    lnPhi,
    phi,
    fugacityPa,
    selectedRoot,

    realRoots: cubic.roots,
    physicalRoots: physical,
    distinctPhysicalRootCount: physical.length,
    hasDistinctBranches,

    warnings: resultWarnings,
    notes: [BRANCH_SELECTION_NOTE]
  };
}
