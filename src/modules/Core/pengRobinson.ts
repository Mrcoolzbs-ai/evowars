// ============================================
// PENG–ROBINSON — чистокомпонентный EOS: Z, phi, фугитивность
// ============================================
//
// Stage 4.4.4.2 «Чистокомпонентный Peng–Robinson: Z, phi и фугитивность»,
// ревизия Stage 4.4.4.2.2 (строгая классификация знака дискриминанта;
// closeout: точный dyadic-BigInt-знак внутри полосы порога,
// исправленное DD-деление (Core/prDoubleDouble.ts), отказ вместо
// молчаливого схлопывания неразличимых корней),
// ревизия Stage 4.4.4.2.1 (классификация кратных корней + архитектура).
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
// АРХИТЕКТУРА (Stage 4.4.4.2.1, CORE_SCIENTIFIC_ENGINE.md): этот модуль
// — фундаментальный слой Core и НЕ импортирует runtime из слоя Data.
// Чистая математика PR принимает УЖЕ валидированные чистокомпонентные
// параметры и evidence через PengRobinsonComponentInputs
// (computePengRobinsonFromComponent); поиск по gasId в каталоге
// Stage 4.4.4.1, обработка EosParametersError и прикрепление
// provenance-скаляров каталога к результату находятся в фасаде
// src/modules/Data/pengRobinsonFacade.ts (computePengRobinsonPure).
// Направление зависимостей: Data -> Core (обратно запрещено);
// цикл Core -> Data -> Core (validateUncertainty) устранён.
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
// invalid_input. Статусы данных НЕ повышаются ради прохождения тестов.
//
// НЕ реализовано в этом подэтапе (границы Stage 4.4.4.2/4.4.4.2.1):
// - бинарные смеси, правила смешения, kij, PPR78 (4.4.4.3+);
// - фугитивность смесей, VLE/LLE flash, равновесная устойчивость фаз;
// - конденсированные фазы; интеграция с solveEquilibrium;
// - изменение result.model = 'ideal_gas' равновесного решателя.
//
// Проверки корректности (Stage 4.4.4.2.2, см. Tests/pengRobinson.test.ts
// и docs/science/DATA_PROVENANCE.md §2.30):
// 1) аналитические проверки (идеальный предел, тройной корень точных
//    констант Omega, сконструированные кратные корни);
// 2) внутренние проверки самосогласованности (интегральное тождество
//    ln(phi) = Int (Z-1)/P dP по самой кубике, равенство фугитивностей
//    ветвей на PR-изобаре насыщения) — рассчитаны из ТОЙ ЖЕ PR-модели
//    и независимым программным benchmark НЕ являются;
// 3) независимый CoolProp benchmark (backend 'PR', CoolProp==8.0.0,
//    GitHub Actions) — scripts/benchmarks/peng_robinson_coolprop.py;
//    выполняется отдельным workflow, в runtime-зависимости приложения
//    CoolProp НЕ входит.

import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from './thermoFunctions';

// Closeout Stage 4.4.4.2.2: арифметика double-double (~106 бит)
// выделена во ВНУТРЕННИЙ модуль Core/prDoubleDouble (НЕ входит в
// публичный контракт слоя: Core/index.ts его не реэкспортирует).
// Деление ddDiv исправлено на полный алгоритм QD: остаток
// r = a - q*b учитывает ОБЕ части знаменателя (DD-умножение),
// уточняющие шаги частного q1 -> q2 -> q3.
import {
  ddAbs,
  ddAdd,
  ddDiv,
  ddFromDouble,
  ddMul,
  ddNeg,
  ddSign,
  ddSub,
  ddToDouble
} from './prDoubleDouble';
import type { DoubleDouble } from './prDoubleDouble';

// Stage 4.4.4.4.1-C: сертифицированный производственный логарифм
// (certifiedLn / certifiedLog1p с доказанными enclosure-границами,
// БЕЗ платформенных логарифмов libm) для логарифмических членов
// ln(phi). Production использует только .value (см. certifiedLogValue):
// публичный API и NaN-семантика этого модуля не меняются.
import { certifiedLn, certifiedLog1p, certifiedLogValue } from './certifiedLogarithm';

// ============================================
// 1. КОНСТАНТЫ И ТИПЫ
// ============================================

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

/**
 * Статус доказанности параметра, принимаемый вычислителем Core.
 * Структурно совместим со статусами каталога Stage 4.4.4.1
 * (EosEvidenceStatus): Core НЕ импортирует типы Data и описывает
 * семантику статусов собственной декларацией — совпадение строковых
 * объединений обеспечивает структурную типизацию без зависимости
 * слоёв.
 */
export type PengRobinsonEvidenceStatus =
  | 'VERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'UNRESOLVED_CROSS_CHECK'
  | 'UNRESOLVED';

/** Runtime-реестр статусов доказанности (для валидации входа). */
export const PENG_ROBINSON_EVIDENCE_STATUSES: readonly PengRobinsonEvidenceStatus[] = [
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'UNRESOLVED_CROSS_CHECK',
  'UNRESOLVED'
];

/**
 * Задокументированная сверка параметра с независимым источником
 * (структурно совместима с EosCrossCheck каталога; outcome — строка,
 * распознаваемое значение 'discrepancy' включает диагностику конфликта
 * в предупреждение).
 */
export interface PengRobinsonCrossCheck {
  readonly subject: string;
  readonly catalogValue: string;
  readonly crossSource: string;
  readonly crossValue: string;
  readonly outcome: string;
  readonly resolution: string;
}

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

/** Фактические статусы доказанности использованных параметров. */
export interface PengRobinsonParameterEvidence {
  readonly criticalTemperatureK: PengRobinsonEvidenceStatus;
  readonly criticalPressurePa: PengRobinsonEvidenceStatus;
  readonly acentricFactor: PengRobinsonEvidenceStatus;
}

/**
 * Валидированные чистокомпонентные входы вычислителя Core (Stage
 * 4.4.4.2.1): числовые параметры + статусы доказанности + сверки +
 * ограничения применимости. Каталог Data (Stage 4.4.4.1) маппится в
 * эту структуру фасадом; Core сам по себе от каталога НЕ зависит и
 * может использоваться с любым проверенным источником параметров.
 */
export interface PengRobinsonComponentInputs {
  /** Идентификатор компонента (используется в диагностике и предупреждении H2O). */
  readonly gasId: string;
  readonly formula: string;
  readonly name: string;
  /** Критическая температура, K (> 0). */
  readonly criticalTemperatureK: number;
  /** Критическое давление, Pa (> 0). */
  readonly criticalPressurePa: number;
  /** Ацентричный фактор (безразмерный, конечный). */
  readonly acentricFactor: number;
  /** Статусы доказанности трёх используемых параметров. */
  readonly evidence: PengRobinsonParameterEvidence;
  /** Задокументированные сверки с независимыми источниками. */
  readonly crossChecks: readonly PengRobinsonCrossCheck[];
  /** Ограничения применимости классического PR для вещества. */
  readonly limitations: readonly string[];
}

/** Запрос к компонентному вычислителю Core: T, P, ветвь и политика. */
export interface PengRobinsonComponentRequest {
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: PengRobinsonRootBranch;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
}

/**
 * Успешный результат вычислителя Core: значения, промежуточные
 * величины, корни, статусы использованных параметров, предупреждения.
 * NaN/Infinity в успешном результате исключены (проверены на выходе).
 * Provenance-скаляры каталога (per-field) прикрепляет фасад Data.
 */
export interface PengRobinsonComponentSuccess {
  readonly status: 'success';
  readonly gasId: string;
  readonly formula: string;
  readonly name: string;
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: PengRobinsonRootBranch;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;

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

  // Метаданные топологии корней (Stage 4.4.4.4.1-D): знак дискриминанта
  // депрессированной формы и кратности, доказанные ветвью решателя.
  // realRootMultiplicities[i] относится к realRoots[i];
  // physicalRootMultiplicities[i] — к physicalRoots[i] (фильтр Z > B,
  // кратности не пересчитываются). distinctPhysicalRootCount остаётся
  // числом РАЗЛИЧНЫХ физических значений (не суммой кратностей);
  // семантика selectedRoot/hasDistinctBranches не меняется.
  readonly discriminantSign: PrDiscriminantSign;
  readonly realRootMultiplicities: readonly PrRootMultiplicity[];
  readonly physicalRootMultiplicities: readonly PrRootMultiplicity[];

  // Предупреждения о применимости и качестве данных.
  readonly warnings: readonly PengRobinsonWarning[];
  // Дисклеймеры (в т.ч. о том, что выбор ветви — не фазовая устойчивость).
  readonly notes: readonly string[];
}

/** Отказ: устойчивый код + диагностика. */
export interface PengRobinsonComponentFailure {
  readonly status: 'failure';
  readonly code: PengRobinsonErrorCode;
  readonly message: string;
  readonly gasId?: string;
  readonly detail?: string;
}

/** Discriminated union результата вычислителя Core. */
export type PengRobinsonComponentResult =
  | PengRobinsonComponentSuccess
  | PengRobinsonComponentFailure;

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

/**
 * Знак дискриминанта ДЕПРЕССИРОВАННОЙ формы D = (q/2)^2 + (p/3)^3,
 * который различает решатель: +1 / 0 / -1. Это НЕ знак полного
 * полиномиального дискриминанта кубики — знаки противоположны
 * (D > 0: ровно один действительный корень; D = 0: кратные корни;
 * D < 0: три различных действительных корня).
 */
export type PrDiscriminantSign = -1 | 0 | 1;

/** Кратность действительного корня кубики по доказанной ветви решателя. */
export type PrRootMultiplicity = 1 | 2 | 3;

/**
 * Результат низкоуровневого решателя: различимые действительные корни
 * + метаданные топологии (Stage 4.4.4.4.1-D). Источник метаданных —
 * ТОЛЬКО уже доказанный знак D (DD-полоса + dyadic-BigInt fallback) и
 * выбранная математическая ветвь: дискриминант НЕ вычисляется повторно,
 * кратности НЕ подгоняются по близости корней. rootMultiplicities[i]
 * относится к roots[i] (пары сортируются совместно); ветвь отказа
 * частичных метаданных НЕ несёт.
 */
export type PrCubicRealRootsResult =
  | {
      readonly ok: true;
      readonly roots: readonly number[];
      readonly discriminantSign: PrDiscriminantSign;
      readonly distinctRealRootCount: 1 | 2 | 3;
      readonly rootMultiplicities: readonly PrRootMultiplicity[];
    }
  | { readonly ok: false; readonly reason: string };

// ============================================
// 2a. DOUBLE-DOUBLE АРИФМЕТИКА (STAGE 4.4.4.2.2)
// ============================================
//
// Closeout Stage 4.4.4.2.2: весь DD-блок перенесён во ВНУТРЕННИЙ
// модуль Core/prDoubleDouble.ts (импорты в шапке), чтобы
// изолированные тесты DD-деления (Tests/pengRobinson.test.ts с
// НЕЗАВИСИМЫМ dyadic-BigInt-оракулом) проверяли тот же код, что и
// производственный решатель, БЕЗ тестового API в публичном
// Core/index.ts (index реэкспортирует этот модуль через export *).

/** Классификация кубического уравнения PR в double-double точности. */
interface PrCubicDdClassification {
  /** Свободный член c0 кубики z^3 + c2 z^2 + c1 z + c0. */
  readonly c0: DoubleDouble;
  readonly c1: DoubleDouble;
  readonly c2: DoubleDouble;
  /** Депрессированные коэффициенты p, q (форма y^3 + p y + q). */
  readonly p: DoubleDouble;
  readonly q: DoubleDouble;
  /** Сдвиг z = y + shift, shift = (1 - B)/3. */
  readonly shift: DoubleDouble;
  /** Дискриминант D = (q/2)^2 + (p/3)^3 — в double-double. */
  readonly discriminant: DoubleDouble;
  /** Масштаб слагаемых D: |(q/2)^2| + |(p/3)^3|. */
  readonly discScale: DoubleDouble;
  /** Порог уверенности знака D (граница ошибки DD-цепочки). */
  readonly discThreshold: number;
}

/**
 * Коэффициенты c0..c2, депрессированные p, q и дискриминант D
 * кубического уравнения PR в double-double арифметике из ТОЧНЫХ
 * binary64-значений входов A/B — без повторного обращения к их
 * десятичным представлениям (Stage 4.4.4.2.2). Деления на 2, 3, 27 —
 * ТОЧНЫЕ DD-деления, а не умножения на округлённые 1/3: цепочка
 * накапливает ошибку O(2^-100) от масштаба слагаемых D; порог
 * уверенности 2^-84*scale покрывает её с запасом ~9 порядков и при
 * этом на ~10 порядков ниже наименьшего физически значимого
 * |D|/scale (~1e-16 у границы кратного корня).
 */
function classifyPrCubicDd(
  dimensionlessA: number,
  dimensionlessB: number
): PrCubicDdClassification {
  const A = ddFromDouble(dimensionlessA);
  const B = ddFromDouble(dimensionlessB);
  const one = ddFromDouble(1);
  const two = ddFromDouble(2);
  const three = ddFromDouble(3);
  const c2 = ddSub(B, one);
  const bSquared = ddMul(B, B);
  const bCubed = ddMul(bSquared, B);
  const c1 = ddSub(ddSub(A, ddMul(bSquared, three)), ddMul(B, two));
  const c0 = ddAdd(ddAdd(bSquared, bCubed), ddNeg(ddMul(A, B)));
  const c2Squared = ddMul(c2, c2);
  const p = ddSub(c1, ddDiv(c2Squared, three));
  const c2Cubed = ddMul(c2Squared, c2);
  const q = ddAdd(
    ddSub(ddDiv(ddMul(c2Cubed, two), ddFromDouble(27)), ddDiv(ddMul(c1, c2), three)),
    c0
  );
  const shift = ddNeg(ddDiv(c2, three));
  const qHalf = ddDiv(q, two);
  const qHalfSquared = ddMul(qHalf, qHalf);
  const pThird = ddDiv(p, three);
  const pThirdCubed = ddMul(pThird, ddMul(pThird, pThird));
  const discriminant = ddAdd(qHalfSquared, pThirdCubed);
  const discScale = ddAdd(ddAbs(qHalfSquared), ddAbs(pThirdCubed));
  const discThreshold = Math.pow(2, -84) * Math.max(discScale.hi, 1e-300);
  return { c0, c1, c2, p, q, shift, discriminant, discScale, discThreshold };
}

// ============================================
// 2b. ТОЧНЫЙ ЗНАК ДИСКРИМИНАНТА (DYADIC BIGINT)
// ============================================
//
// Closeout Stage 4.4.4.2.2: DD-цепочка (~106 бит) не может доказать
// знак D внутри полосы |D| <= discThreshold, а допуск невязки знака
// НЕ доказывает (ненулевой дискриминант возможен у почти кратного
// корня). Точный знак для ТОЧНЫХ binary64-входов A/B вычисляет этот
// fallback: dyadic-BigInt-арифметика без единого округления.
// Fallback включается ТОЛЬКО внутри полосы порога — на обычных
// вызовах решателя затрат нет.

/** Точный dyadic rational: значение num * 2^exp, num — BigInt. */
interface PrDyadic {
  readonly num: bigint;
  readonly exp: number;
}

const PR_DYADIC_BUFFER = new ArrayBuffer(8);
const PR_DYADIC_VIEW = new DataView(PR_DYADIC_BUFFER);

/**
 * Точное разложение конечного binary64 в dyadic rational через битовое
 * представление IEEE-754 (включая субнормальные числа); ноль -> num = 0.
 */
function prDyadicFromDouble(x: number): PrDyadic {
  PR_DYADIC_VIEW.setFloat64(0, x);
  const bits = PR_DYADIC_VIEW.getBigUint64(0);
  const negative = (bits & 0x8000000000000000n) !== 0n;
  const biasedExponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = bits & 0x000fffffffffffffn;
  // Нормальные: мантисса с неявной единицей, экспонента be - 1075;
  // субнормальные (be = 0): без неявной единицы, экспонента -1074.
  const num = biasedExponent === 0 ? mantissa : mantissa | 0x0010000000000000n;
  const exp = biasedExponent === 0 ? -1074 : biasedExponent - 1075;
  return { num: negative ? -num : num, exp };
}

/** Точное dyadic-произведение: BigInt-умножение, экспоненты складываются. */
function prDyadicMul(a: PrDyadic, b: PrDyadic): PrDyadic {
  return { num: a.num * b.num, exp: a.exp + b.exp };
}

/** Точное dyadic-вычитание с выравниванием экспонент BigInt-сдвигами. */
function prDyadicSub(a: PrDyadic, b: PrDyadic): PrDyadic {
  const exp = Math.min(a.exp, b.exp);
  return {
    num: (a.num << BigInt(a.exp - exp)) - (b.num << BigInt(b.exp - exp)),
    exp
  };
}

/** Точное dyadic-сложение с выравниванием экспонент BigInt-сдвигами. */
function prDyadicAdd(a: PrDyadic, b: PrDyadic): PrDyadic {
  const exp = Math.min(a.exp, b.exp);
  return {
    num: (a.num << BigInt(a.exp - exp)) + (b.num << BigInt(b.exp - exp)),
    exp
  };
}

/**
 * ТОЧНЫЙ знак дискриминанта кубики z^3 + c2*z^2 + c1*z + c0 с
 * коэффициентами PR (c2 = B - 1, c1 = A - 3B^2 - 2B, c0 = B^2 + B^3 - AB)
 * для ТОЧНЫХ binary64-входов. Классический дискриминант
 * Delta = c2^2*c1^2 - 4*c1^3 - 4*c2^3*c0 - 27*c0^2 + 18*c2*c1*c0 связан
 * с депрессированным D = (q/2)^2 + (p/3)^3 соотношением Delta = -108*D,
 * поэтому sign(D) = -sign(Delta). Все коэффициенты — dyadic rational
 * (полиномы от binary64 A/B), слагаемые Delta приводятся к общему
 * степенному знаменателю и вычисляются точно в BigInt; ни одно
 * промежуточное значение не округляется в number до определения
 * знака. Возвращает +1 / -1 / 0 — ТОЧНЫЙ знак D.
 */
function prExactCubicDiscriminantSign(
  dimensionlessA: number,
  dimensionlessB: number
): number {
  const a = prDyadicFromDouble(dimensionlessA);
  const b = prDyadicFromDouble(dimensionlessB);
  const one = prDyadicFromDouble(1);
  const two = prDyadicFromDouble(2);
  const three = prDyadicFromDouble(3);
  const four = prDyadicFromDouble(4);
  const eighteen = prDyadicFromDouble(18);
  const twentySeven = prDyadicFromDouble(27);
  const c2 = prDyadicSub(b, one);
  const bSquared = prDyadicMul(b, b);
  const bCubed = prDyadicMul(bSquared, b);
  const c1 = prDyadicSub(
    prDyadicSub(a, prDyadicMul(bSquared, three)),
    prDyadicMul(b, two)
  );
  const c0 = prDyadicSub(prDyadicAdd(bSquared, bCubed), prDyadicMul(a, b));
  const c1Squared = prDyadicMul(c1, c1);
  const c1Cubed = prDyadicMul(c1Squared, c1);
  const c2Squared = prDyadicMul(c2, c2);
  const c2Cubed = prDyadicMul(c2Squared, c2);
  const c0Squared = prDyadicMul(c0, c0);
  // Delta = (c2^2*c1^2 + 18*c2*c1*c0) - (4*c1^3 + 4*c2^3*c0 + 27*c0^2).
  const delta = prDyadicSub(
    prDyadicAdd(
      prDyadicMul(c2Squared, c1Squared),
      prDyadicMul(prDyadicMul(eighteen, prDyadicMul(c2, c1)), c0)
    ),
    prDyadicAdd(
      prDyadicAdd(prDyadicMul(four, c1Cubed), prDyadicMul(prDyadicMul(four, c2Cubed), c0)),
      prDyadicMul(twentySeven, c0Squared)
    )
  );
  const deltaSign = delta.num > 0n ? 1 : delta.num < 0n ? -1 : 0;
  return -deltaSign;
}

/**
 * Действительные корни кубического уравнения PR (Stage 4.4.4.2.2:
 * строгая классификация знака дискриминанта в double-double).
 *
 * Математика: для депрессированной формы y^3 + p*y + q (z = y + shift,
 * shift = (1-B)/3) дискриминант D = (q/2)^2 + (p/3)^3 задаёт число
 * действительных корней: D > 0 — ровно ОДИН (пара комплексных),
 * D < 0 — ровно ТРИ, D = 0 — кратный корень.
 *
 * История исправлений. Ревизия 4.4.4.2.1 заменила наивное условие
 * «D <= 1e-12*scale» на полосу |D| <= discErr с границей ошибки, но
 * ОБРАБОТКА полосы осталась ошибочной (исправлено в 4.4.4.2.2):
 * критические точки ПРОИЗВОДНОЙ полинома выдавались за «два
 * различимых корня». Критическая точка производной НЕ обязана быть
 * корнем самого полинома: при A = 0.13130582290421344,
 * B = 0.01980480623881198 точный дискриминант ПОЛОЖИТЕЛЕН
 * (D/scale ~ +2.7e-16), математически существует ровно ОДИН
 * действительный корень 0.880195193761188 (пара 0.05 ± 5.23e-9 i —
 * комплексная), а решатель возвращал второй «корень» у 0.05 — он
 * больше B и формировал ФИКТИВНУЮ liquid-ветвь.
 *
 * Ревизия 4.4.4.2.2 (closeout): знак D доказывается ДВУМЯ
 * механизмами. Вне полосы |D| > discThreshold знак классифицирует
 * DD-цепочка classifyPrCubicDd (~106 бит) из ТОЧНЫХ binary64-входов
 * A/B. ВНУТРИ полосы знак неопределим даже в double-double, а допуск
 * невязки его НЕ доказывает (ненулевой дискриминант возможен у
 * почти кратного корня): точный знак вычисляет fallback
 * prExactCubicDiscriminantSign — dyadic-BigInt-арифметика по
 * ТОЧНЫМ binary64 A/B без единого округления. Семантика однозначна:
 * - ТОЧНЫЙ D > 0 — ровно ОДИН действительный корень;
 * - ТОЧНЫЙ D < 0 — ровно ТРИ действительных корня;
 * - ТОЧНЫЙ D = 0 — кратный корень закрытой формой (тройной
 *   z = (1-B)/3 при p = q = 0; иначе двойной y_d = -3q/(2p) и
 *   простой y_s = 3q/p) с ПОДТВЕРЖДЕНИЕМ невязкой полинома в
 *   double-double точности; неподтверждённый случай — структурный
 *   отказ, а НЕ приблизительная физическая ветвь. Кратная ветвь
 *   входится ТОЛЬКО по точному знаку 0. Критические точки
 *   производной корнями НЕ объявляются;
 * - если точный знак доказывает N различимых корней, а двойная
 *   реализация не может представить их различными в допуске
 *   дедупликации (например, пара тройки с расщеплением много
 *   меньше допуска) — структурный отказ, а НЕ молчаливое
 *   схлопывание числа корней и НЕ подмена пары кратным корнем.
 *
 * Ветви вычисления корней (двойная точность — классификация уже
 * доказана DD-знаком D):
 * - p < 0, D > 0: ОДИН корень. |arg| >= 1 — гиперболический метод
 *   y = -2*sgn(q)*sqrt(-p/3)*cosh(acosh(|arg|)/3) (без
 *   катастрофического сокращения Cardano около кратных корней);
 *   |arg| < 1 (округление сместило аргумент при доказанном D > 0) —
 *   стабильный Cardano (см. ниже);
 * - p < 0, D < 0: ТРИ корня, тригонометрический метод; кламп
 *   аргумента в [-1, 1] допустим — число корней доказано знаком D;
 * - p >= 0 (D >= 0 всегда): СТАБИЛЬНЫЙ Cardano: из двух кубических
 *   корней выбирается больший по модулю (big = -q/2 + sqrt(D) при
 *   q <= 0, иначе -q/2 - sqrt(D)) — слагаемые одного знака без
 *   сокращения; второй корень по Виету: y = w - (p/3)/w. Прямой
 *   Cardano (cbrt(-q/2+sr) + cbrt(-q/2-sr)) при p -> 0+ теряет до
 *   ~1.5e-7 точности катастрофическим сокращением.
 *
 * Дополнительно: невязка полинома проверяется для КАЖДОГО корня
 * относительно масштаба коэффициентов (допуск не ослабляется);
 * дедупликация кратных корней с допуском 1e-8*max(1, |z_max|, B)
 * (ошибка кратного корня в double ~ sqrt(eps) ~ 1.5e-8), причём
 * дедуплицированное число корней ОБЯЗАНО совпасть с числом,
 * доказанным точным знаком D (иначе структурный отказ); неконечные
 * A/B — отказ. Отказ решателя — надёжный fail-closed: приближённая
 * точка за корень НЕ выдаётся.
 */
export function solvePrCubicRealRoots(
  dimensionlessA: number,
  dimensionlessB: number
): PrCubicRealRootsResult {
  if (!Number.isFinite(dimensionlessA) || !Number.isFinite(dimensionlessB)) {
    return { ok: false, reason: `неконечные параметры кубического уравнения: A=${String(dimensionlessA)}, B=${String(dimensionlessB)}` };
  }
  const dd = classifyPrCubicDd(dimensionlessA, dimensionlessB);
  const pD = ddToDouble(dd.p);
  const qD = ddToDouble(dd.q);
  const shiftD = ddToDouble(dd.shift);
  const c0D = ddToDouble(dd.c0);
  const c1D = ddToDouble(dd.c1);
  const c2D = ddToDouble(dd.c2);
  const discD = ddToDouble(dd.discriminant);
  const discThreshold = dd.discThreshold;
  const pSign = ddSign(dd.p);

  // Точный знак D (closeout 4.4.4.2.2): вне полосы |D| > discThreshold
  // знак доказан DD-цепочкой (~106 бит). ВНУТРИ полосы знак неопределим
  // даже в double-double, а допуск невязки его НЕ доказывает: точный
  // знак вычисляет dyadic-BigInt fallback по исходным binary64 A/B.
  // Stage 4.4.4.4.1-D: знак типизирован как PrDiscriminantSign для
  // метаданных топологии; вычисление НЕ меняется (контракт
  // prExactCubicDiscriminantSign — ровно +1/-1/0; вызов fallback
  // остаётся ленивым — только внутри полосы порога).
  const signProven: PrDiscriminantSign =
    dd.discriminant.hi > discThreshold ? 1
      : dd.discriminant.hi < -discThreshold ? -1
        : (prExactCubicDiscriminantSign(dimensionlessA, dimensionlessB) as PrDiscriminantSign);

  const rawRoots: number[] = [];
  // Stage 4.4.4.4.1-D: кратности, назначенные выбранной математической
  // ветвью (параллельно rawRoots, теми же push в тех же местах):
  // D > 0 → [1]; D < 0 → [1, 1, 1]; D = 0, p = q = 0 → [3];
  // D = 0, p != 0 → [2, 1] (2 — корню zDouble, 1 — zSimple).
  const rawMultiplicities: PrRootMultiplicity[] = [];
  // Ветви классификации возвращают корни в y-координатах
  // (депрессированная форма, требуется сдвиг shift); ветвь кратного
  // корня — сразу в z-координатах.
  let rawRootsInZCoordinates = false;
  // Доказанное число РАЗЛИЧИМЫХ действительных корней: после
  // дедупликации обязано совпасть, иначе структурный отказ (см.
  // проверку в конце) — молчаливое схлопывание запрещено.
  let provenDistinctCount = 0;

  if (signProven === 0) {
    // ТОЧНЫЙ D = 0 (знак доказан dyadic-BigInt): кратный корень
    // закрытой формой с подтверждением невязкой в DD-точности;
    // неподтверждённый случай — структурный отказ, а НЕ
    // приблизительная физическая ветвь. Кратная ветвь входится
    // ТОЛЬКО по точному знаку 0 — невязка-допуск доказательством
    // D = 0 НЕ является.
    rawRootsInZCoordinates = true;
    const ddCoefficientScale = Math.max(1, Math.abs(c2D), Math.abs(c1D), Math.abs(c0D));
    const polyEval = (z: DoubleDouble): DoubleDouble =>
      ddAdd(ddAdd(ddAdd(ddMul(ddMul(z, z), z), ddMul(dd.c2, ddMul(z, z))), ddMul(dd.c1, z)), dd.c0);
    const residualTolerance = (z: DoubleDouble): number =>
      Math.pow(2, -90) * ddCoefficientScale * Math.pow(Math.max(1, Math.abs(ddToDouble(z))), 3);
    if (pSign === 0 && ddSign(dd.q) === 0) {
      // Тройной корень депрессированной формы: y = 0, z = shift.
      const zTriple = dd.shift;
      const residual = ddAbs(polyEval(zTriple));
      if (residual.hi > residualTolerance(zTriple)) {
        return {
          ok: false,
          reason: `точный знак дискриминанта D = 0 (dyadic-BigInt), но тройной корень не подтверждён невязкой полинома`
        };
      }
      rawRoots.push(ddToDouble(zTriple));
      rawMultiplicities.push(3);
      provenDistinctCount = 1;
    } else if (pSign !== 0) {
      // D = 0: двойной корень y_d = -3q/(2p) и простой y_s = 3q/p
      // (тождества депрессированной формы при D = 0).
      const yDouble = ddDiv(ddMul(ddFromDouble(-3), dd.q), ddMul(ddFromDouble(2), dd.p));
      const ySimple = ddDiv(ddMul(ddFromDouble(3), dd.q), dd.p);
      const zDouble = ddAdd(yDouble, dd.shift);
      const zSimple = ddAdd(ySimple, dd.shift);
      const residualDouble = ddAbs(polyEval(zDouble));
      const residualSimple = ddAbs(polyEval(zSimple));
      if (
        residualDouble.hi > residualTolerance(zDouble) ||
        residualSimple.hi > residualTolerance(zSimple)
      ) {
        return {
          ok: false,
          reason: `точный знак дискриминанта D = 0 (dyadic-BigInt), но кратный корень не подтверждён невязкой полинома в расширенной точности`
        };
      }
      rawRoots.push(ddToDouble(zDouble), ddToDouble(zSimple));
      rawMultiplicities.push(2, 1);
      provenDistinctCount = 2;
    } else {
      // p = 0, q != 0: математически D = (q/2)^2 > 0 — сюда попасть
      // нельзя при точном знаке 0; честный отказ вместо
      // приблизительной ветви.
      return {
        ok: false,
        reason: `точный знак дискриминанта D = 0 противоречит p = 0 при q != 0 (|D| <= ${discThreshold}); отказ`
      };
    }
  } else if (pSign < 0 && signProven > 0) {
    // ТОЧНО ПОЛОЖИТЕЛЬНЫЙ дискриминант: ровно ОДИН действительный
    // корень. Никаких фиктивных повторных корней.
    provenDistinctCount = 1;
    const arg = ((3 * qD) / (2 * pD)) * Math.sqrt(-3 / pD);
    const h = Math.abs(arg);
    if (h >= 1) {
      rawRoots.push(
        -2 * Math.sign(qD) * Math.sqrt(-pD / 3) * Math.cosh(Math.acosh(h) / 3)
      );
      rawMultiplicities.push(1);
    } else {
      // Округление сместило arg < 1 при доказанном D > 0: стабильный
      // Cardano (без клампа, сохраняющего один корень).
      const squareRoot = Math.sqrt(Math.max(0, discD));
      const big = qD <= 0 ? -qD / 2 + squareRoot : -qD / 2 - squareRoot;
      if (big === 0) {
        rawRoots.push(0);
        rawMultiplicities.push(1);
      } else {
        const w = Math.cbrt(big);
        rawRoots.push(w - (pD / 3) / w);
        rawMultiplicities.push(1);
      }
    }
  } else if (pSign < 0 && signProven < 0) {
    // ТОЧНО ОТРИЦАТЕЛЬНЫЙ дискриминант: ровно ТРИ действительных
    // корня — кламп arg в [-1, 1] допустим (число корней доказано
    // точным знаком D), это защита только от округления аргумента.
    provenDistinctCount = 3;
    const arg = ((3 * qD) / (2 * pD)) * Math.sqrt(-3 / pD);
    const clamped = Math.max(-1, Math.min(1, arg));
    const theta = Math.acos(clamped) / 3;
    const amplitude = 2 * Math.sqrt(-pD / 3);
    for (let k = 0; k < 3; k += 1) {
      rawRoots.push(amplitude * Math.cos(theta - (2 * Math.PI * k) / 3));
      rawMultiplicities.push(1);
    }
  } else if (pSign >= 0 && signProven > 0) {
    // p >= 0: дискриминант неотрицателен, ровно один действительный
    // корень. Стабильный Cardano: слагаемые одного знака + Виет.
    provenDistinctCount = 1;
    const squareRoot = Math.sqrt(Math.max(0, discD));
    const big = qD <= 0 ? -qD / 2 + squareRoot : -qD / 2 - squareRoot;
    if (big === 0) {
      // q = 0 и p = 0: тройной корень y = 0.
      rawRoots.push(0);
      rawMultiplicities.push(1);
    } else {
      const w = Math.cbrt(big);
      rawRoots.push(w - (pD / 3) / w);
      rawMultiplicities.push(1);
    }
  } else {
    // p >= 0 математически даёт D = (q/2)^2 + (p/3)^3 >= 0; точный
    // D < 0 при DD-знаке p >= 0 — противоречие округлений DD-цепочки
    // в недостижимой зоне: честный отказ вместо противоречивой ветви.
    return {
      ok: false,
      reason: `точный знак дискриминанта D < 0 противоречит p >= 0 (p=${pD}); отказ вместо противоречивой ветви`
    };
  }

  // Возврат к z (только для ветвей в y-координатах) и проверка невязки
  // каждого корня относительно масштаба коэффициентов. Stage 4.4.4.4.1-D:
  // пары (корень, кратность) переносятся совместно через возврат в
  // z-координаты, residual-контроль, сортировку и дедупликацию; кратность
  // берётся ТОЛЬКО из доказанной ветви (никакой подгонки по близости).
  const candidates: readonly {
    readonly z: number;
    readonly multiplicity: PrRootMultiplicity;
  }[] = rawRootsInZCoordinates
    ? rawRoots.map((z, i) => ({ z, multiplicity: rawMultiplicities[i] ?? 1 }))
    : rawRoots.map((y, i) => ({ z: y + shiftD, multiplicity: rawMultiplicities[i] ?? 1 }));
  const coefficientScale = Math.max(1, Math.abs(c2D), Math.abs(c1D), Math.abs(c0D));
  for (const candidate of candidates) {
    const z = candidate.z;
    if (!Number.isFinite(z)) {
      return { ok: false, reason: `неконечный корень: z=${String(z)}` };
    }
    const residual = Math.abs(z * z * z + c2D * z * z + c1D * z + c0D);
    const tolerance = 1e-8 * coefficientScale * Math.pow(Math.max(1, Math.abs(z)), 3);
    if (!Number.isFinite(residual) || residual > tolerance) {
      return {
        ok: false,
        reason: `невязка полинома ${residual} превышает допуск ${tolerance} в корне z=${z}`
      };
    }
  }

  // Сортировка и дедупликация кратных (в пределах допуска) корней.
  // Stage 4.4.4.4.1-D: сортировка и дедупликация — СОВМЕСТНЫЕ для пар
  // (корень, кратность); порядок кратностей соответствует отсортированным
  // корням: rootMultiplicities[i] относится к roots[i].
  const dedupTolerance = 1e-8 * Math.max(1, ...candidates.map((c) => Math.abs(c.z)), dimensionlessB);
  const sorted = candidates.slice().sort((a, b) => a.z - b.z);
  const distinct: number[] = [];
  const distinctMultiplicities: PrRootMultiplicity[] = [];
  for (const candidate of sorted) {
    if (distinct.length === 0 || Math.abs(candidate.z - distinct[distinct.length - 1]) > dedupTolerance) {
      distinct.push(candidate.z);
      distinctMultiplicities.push(candidate.multiplicity);
    }
  }
  // Контроль против схлопывания (closeout 4.4.4.2.2): дедуплицированное
  // число корней обязано совпасть с доказанным точным знаком D. Если
  // точный знак доказывает N различимых корней, а пара (например,
  // тройки) ближе допуска дедупликации, двойная реализация НЕ может
  // надёжно представить их различными — структурный отказ вместо
  // молчаливого схлопывания или подмены пары кратным корнем.
  if (distinct.length !== provenDistinctCount) {
    return {
      ok: false,
      reason: `точный знак дискриминанта доказывает ${provenDistinctCount} различимых действительных корней, но двойная реализация не может надёжно представить их различными в допуске дедупликации ${dedupTolerance}; отказ вместо молчаливого схлопывания корней или подмены пары кратным корнем`
    };
  }
  // Контроль выше гарантирует distinct.length === provenDistinctCount ∈ {1, 2, 3}.
  // Stage 4.4.4.4.1-D: канонизация нуля МЕТАДАННЫХ. Точный dyadic-BigInt
  // fallback (prExactCubicDiscriminantSign) возвращает -0 при точном D = 0
  // (унарный минус нуля в привязке знаков); для ветвления решателя -0 и +0
  // неразличимы, но метаданные топологии обязаны нести канонический +0
  // (Object.is в тестах и аудите различает нули, JSON-дампы — тоже).
  // signProven и вся логика выбора ветви НЕ изменяются.
  return {
    ok: true,
    roots: distinct,
    discriminantSign: signProven || 0,
    distinctRealRootCount: distinct.length as 1 | 2 | 3,
    rootMultiplicities: distinctMultiplicities
  };
}

/**
 * Пары (физический корень, кратность) — метаданные топологии
 * (Stage 4.4.4.4.1-D). Кратности НЕ пересчитываются: физический список
 * получается ФИЛЬТРОМ Z > B из доказанных кратностей решателя; пары
 * сортируются совместно, порядок корней — возрастающий (тот же, что у
 * prPhysicalRoots). При ok: true multiplicities[i] относится к roots[i].
 *
 * Stage 4.4.4.4.1-E (fail-closed контракт): массивы корней и кратностей
 * обязаны быть строго согласованной длины. Молчаливая подстановка
 * кратности 1 при более коротком массиве кратностей (бывшее
 * multiplicities[i] ?? 1) могла бы фабриковать правдоподобную, но
 * ложную топологию, поэтому удалена: несогласованность длин — ЯВНЫЙ
 * отказ { ok: false, reason } без каких-либо частичных метаданных
 * (стиль Core — результатные объекты, исключений нет). Наличие полей
 * кратностей само по себе доступностью топологии НЕ считается
 * (согласованность проверяется, см. TPD_SEARCH_DESIGN.md).
 */
export interface PrPhysicalRootsTopology {
  readonly ok: true;
  readonly roots: readonly number[];
  readonly multiplicities: readonly PrRootMultiplicity[];
}

/** Явный fail-closed отказ физического фильтра (Stage 4.4.4.4.1-E). */
export interface PrPhysicalRootsTopologyFailure {
  readonly ok: false;
  readonly reason: string;
}

export type PrPhysicalRootsTopologyResult =
  | PrPhysicalRootsTopology
  | PrPhysicalRootsTopologyFailure;

/**
 * Внутренний единый источник фильтра Z > B (Stage 4.4.4.4.1-D/E):
 * выжившие ИНДЕКСЫ корней в порядке возрастания корня. Оба публичных
 * контракта (prPhysicalRoots и prPhysicalRootsWithMultiplicities)
 * делегируют этой функции, поэтому включение/исключение корня никогда
 * не разойдётся между двумя реализациями. Roots-only контракт НЕ
 * обходит защиту кратностей пустым массивом кратностей.
 */
function prPhysicalIndices(roots: readonly number[], dimensionlessB: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < roots.length; i += 1) {
    const z = roots[i];
    if (Number.isFinite(z) && z > dimensionlessB) {
      indices.push(i);
    }
  }
  indices.sort((left, right) => roots[left] - roots[right]);
  return indices;
}

export function prPhysicalRootsWithMultiplicities(
  roots: readonly number[],
  multiplicities: readonly PrRootMultiplicity[],
  dimensionlessB: number
): PrPhysicalRootsTopologyResult {
  if (multiplicities.length !== roots.length) {
    return {
      ok: false,
      reason:
        `несогласованные длины массивов топологии: корней ${roots.length}, ` +
        `кратностей ${multiplicities.length}; fail-closed: кратности не ` +
        `синтезируются, частичные метаданные не возвращаются`
    };
  }
  const indices = prPhysicalIndices(roots, dimensionlessB);
  return {
    ok: true,
    roots: indices.map((index) => roots[index]),
    multiplicities: indices.map((index) => multiplicities[index])
  };
}

/**
 * Физически допустимые корни: Z > B (строго) — требование областей
 * определения логарифмов в ln(phi) (Z - B > 0 и Z + (1 - sqrt(2))B > 0,
 * что выполнено автоматически при Z > B, так как sqrt(2) - 1 < 1).
 * Возвращает отсортированный по возрастанию массив. Stage 4.4.4.4.1-E:
 * roots-only контракт БЕЗ фиктивного назначения кратностей; единый
 * источник фильтра — внутренняя prPhysicalIndices (общая с
 * prPhysicalRootsWithMultiplicities), чтобы фильтр Z > B никогда
 * не разошёлся между двумя контрактами.
 */
export function prPhysicalRoots(roots: readonly number[], dimensionlessB: number): readonly number[] {
  return prPhysicalIndices(roots, dimensionlessB).map((index) => roots[index]);
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
 *
 * Stage 4.4.4.4.1-C: платформенные логарифмы libm заменены на
 * сертифицированные certifiedLn / certifiedLog1p (enclosure-границы
 * доказаны; при отказе — NaN, прежняя семантика). Формулы, кубический
 * решатель и выбор корня НЕ изменены.
 */
export function pengRobinsonLnPhi(
  z: number,
  dimensionlessA: number,
  dimensionlessB: number
): number {
  if (!(z > dimensionlessB) || !(z > 0)) {
    return Number.NaN;
  }
  const lnZMinusB =
    certifiedLogValue(certifiedLn(z)) +
    certifiedLogValue(certifiedLog1p(-dimensionlessB / z));
  if (!Number.isFinite(lnZMinusB)) {
    return Number.NaN;
  }
  const logRatio =
    certifiedLogValue(certifiedLog1p(((1 + Math.SQRT2) * dimensionlessB) / z)) -
    certifiedLogValue(certifiedLog1p(((1 - Math.SQRT2) * dimensionlessB) / z));
  const result =
    z - 1 - lnZMinusB -
    (dimensionlessA / (2 * Math.SQRT2 * dimensionlessB)) * logRatio;
  return result;
}

// ============================================
// 4. ПОЛИТИКА ДОКАЗАННОСТИ И ПРЕДУПРЕЖДЕНИЯ
// ============================================

/** Описание параметра для диагностик. */
type EvidenceFieldName = 'criticalTemperatureK' | 'criticalPressurePa' | 'acentricFactor';

/** Проверка статуса параметра против политики; собирает отказы и предупреждения. */
function evaluateEvidencePolicy(
  inputs: PengRobinsonComponentInputs,
  policy: PengRobinsonEvidencePolicy
): { rejected: readonly string[]; warnings: readonly PengRobinsonWarning[] } {
  const evidence = inputs.evidence;
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
        const conflicts = inputs.crossChecks.filter(
          (cc: PengRobinsonCrossCheck) => cc.outcome === 'discrepancy'
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
// 5. ПУБЛИЧНЫЙ КОМПОНЕНТНЫЙ ВЫЧИСЛИТЕЛЬ CORE
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
 * Валидация запроса (T, P, ветвь, политика) — общая для компонентного
 * вычислителя Core и фасада Data (Stage 4.4.4.2.1): сообщения об
 * ошибках едины, дублирования текста нет. Возвращает отказ
 * invalid_input или null при корректном запросе. gasId проверяет
 * вызывающая сторона (фасад — с текстом каталога 4.4.4.1).
 */
export function validatePengRobinsonComponentRequest(
  request: PengRobinsonComponentRequest
): PengRobinsonComponentFailure | null {
  if (request === null || typeof request !== 'object') {
    return {
      status: 'failure',
      code: 'invalid_input',
      message: 'запрос должен быть объектом {temperatureK, pressurePa, root, evidencePolicy}'
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
  return null;
}

/**
 * Чистокомпонентный вычислитель Peng–Robinson слоя Core (Stage
 * 4.4.4.2.1): принимает УЖЕ валидированные числовые параметры
 * компонента и evidence — БЕЗ обращения к каталогу Data. Поиск по
 * gasId (каталог Stage 4.4.4.1) выполняет фасад
 * Data/pengRobinsonFacade.ts; Core может использоваться и с другими
 * проверенными источниками параметров.
 *
 * Контракт входов: gasId — непустая строка; Tc > 0, Pc > 0, omega —
 * конечны; evidence — три статуса из реестра; crossChecks/limitations —
 * массивы. Некорректные параметры — отказ invalid_parameters (fail-
 * closed: подстановок и «частично готовых» наборов нет).
 * Успех никогда не содержит NaN/Infinity.
 */
export function computePengRobinsonFromComponent(
  inputs: PengRobinsonComponentInputs,
  request: PengRobinsonComponentRequest
): PengRobinsonComponentResult {
  // --- Валидация запроса (invalid_input) ---
  const requestFailure = validatePengRobinsonComponentRequest(request);
  if (requestFailure !== null) {
    return requestFailure;
  }

  // --- Валидация параметров компонента (invalid_parameters) ---
  if (inputs === null || typeof inputs !== 'object') {
    return {
      status: 'failure',
      code: 'invalid_parameters',
      message: 'inputs должен быть объектом PengRobinsonComponentInputs'
    };
  }
  if (typeof inputs.gasId !== 'string' || inputs.gasId.trim() === '') {
    return {
      status: 'failure',
      code: 'invalid_parameters',
      message: `inputs.gasId должен быть непустой строкой, получено: ${String(inputs.gasId)}`
    };
  }
  if (!isFiniteNumber(inputs.criticalTemperatureK) || inputs.criticalTemperatureK <= 0) {
    return {
      status: 'failure',
      code: 'invalid_parameters',
      message: `criticalTemperatureK должен быть конечным положительным числом (K), получено: ${String(inputs.criticalTemperatureK)}`,
      gasId: inputs.gasId
    };
  }
  if (!isFiniteNumber(inputs.criticalPressurePa) || inputs.criticalPressurePa <= 0) {
    return {
      status: 'failure',
      code: 'invalid_parameters',
      message: `criticalPressurePa должен быть конечным положительным числом (Pa), получено: ${String(inputs.criticalPressurePa)}`,
      gasId: inputs.gasId
    };
  }
  if (!isFiniteNumber(inputs.acentricFactor)) {
    return {
      status: 'failure',
      code: 'invalid_parameters',
      message: `acentricFactor должен быть конечным числом (безразмерным), получено: ${String(inputs.acentricFactor)}`,
      gasId: inputs.gasId
    };
  }
  if (
    inputs.evidence === null || typeof inputs.evidence !== 'object' ||
    !PENG_ROBINSON_EVIDENCE_STATUSES.includes(inputs.evidence.criticalTemperatureK) ||
    !PENG_ROBINSON_EVIDENCE_STATUSES.includes(inputs.evidence.criticalPressurePa) ||
    !PENG_ROBINSON_EVIDENCE_STATUSES.includes(inputs.evidence.acentricFactor)
  ) {
    return {
      status: 'failure',
      code: 'invalid_parameters',
      message: 'evidence должен содержать статусы доказанности всех трёх параметров из реестра PENG_ROBINSON_EVIDENCE_STATUSES',
      gasId: inputs.gasId
    };
  }
  if (!Array.isArray(inputs.crossChecks) || !Array.isArray(inputs.limitations)) {
    return {
      status: 'failure',
      code: 'invalid_parameters',
      message: 'crossChecks и limitations должны быть массивами',
      gasId: inputs.gasId
    };
  }

  // --- Политика доказанности параметров ---
  const { rejected, warnings } = evaluateEvidencePolicy(inputs, request.evidencePolicy);
  if (rejected.length > 0) {
    return {
      status: 'failure',
      code: 'parameter_evidence_not_accepted',
      message:
        `политика «${request.evidencePolicy}» не принимает статусы доказанности ` +
        `параметров компонента «${inputs.gasId}»: ${rejected.join(', ')}. ` +
        `Политики: verified_only — только VERIFIED; allow_partial — +PARTIALLY_VERIFIED; ` +
        `allow_unresolved_cross_check — +UNRESOLVED_CROSS_CHECK. ` +
        `Статус UNRESOLVED не принимается ни одной политикой. ` +
        `Статусы данных не повышаются: используйте явную политику или другой источник данных.`,
      gasId: inputs.gasId,
      detail: rejected.join(', ')
    };
  }

  // --- Промежуточные величины PR ---
  const intermediate = computePengRobinsonPureParameters(
    inputs.criticalTemperatureK,
    inputs.criticalPressurePa,
    inputs.acentricFactor,
    request.temperatureK,
    request.pressurePa
  );
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
        `неконечные промежуточные величины PR для «${inputs.gasId}» при ` +
        `T=${request.temperatureK} K, P=${request.pressurePa} Pa; надёжный расчёт невозможен`,
      gasId: inputs.gasId
    };
  }

  // --- Решение кубического уравнения ---
  const cubic = solvePrCubicRealRoots(intermediate.dimensionlessA, intermediate.dimensionlessB);
  if (!cubic.ok) {
    return {
      status: 'failure',
      code: 'cubic_solver_failure',
      message: `кубическое уравнение PR не решено надёжно для «${inputs.gasId}»: ${cubic.reason}`,
      gasId: inputs.gasId
    };
  }
  const physicalTopology = prPhysicalRootsWithMultiplicities(
    cubic.roots,
    cubic.rootMultiplicities,
    intermediate.dimensionlessB
  );
  // Stage 4.4.4.4.1-E: решатель возвращает корни и кратности совместной
  // сборкой (равные длины инвариантны внутри ok-результата кубики), но
  // публичный helper больше НЕ синтезирует кратности: несогласованность —
  // явный fail-closed отказ, а не правдоподобные метаданные.
  if (!physicalTopology.ok) {
    return {
      status: 'failure',
      code: 'numerical_failure',
      message:
        `метаданные топологии корней PR несогласованы для «${inputs.gasId}»: ` +
        `${physicalTopology.reason}`,
      gasId: inputs.gasId
    };
  }
  const physical = physicalTopology.roots;
  if (physical.length === 0) {
    return {
      status: 'failure',
      code: 'no_physical_root',
      message:
        `нет физически допустимых корней (Z > B=${intermediate.dimensionlessB}) ` +
        `для «${inputs.gasId}» при T=${request.temperatureK} K, P=${request.pressurePa} Pa`,
      gasId: inputs.gasId,
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
  // воды результат НЕ является). Идентификация — по gasId входов;
  // ограничения применимости переданы вызывающей стороной (каталогом).
  if (inputs.gasId === 'h2o') {
    resultWarnings.push({
      code: 'h2o_classical_pr_limitations',
      message:
        `H2O — полярный ассоциирующий компонент: классический PR без специальных ` +
        `модификаций ограниченно применим (ограничения каталога: ${inputs.limitations.join(' ')})`
    });
  }

  // --- ln(phi), phi, фугитивность ---
  const lnPhi = pengRobinsonLnPhi(selectedRoot, intermediate.dimensionlessA, intermediate.dimensionlessB);
  if (!Number.isFinite(lnPhi)) {
    return {
      status: 'failure',
      code: 'logarithm_domain_error',
      message:
        `ln(phi) вне области определения для «${inputs.gasId}» ` +
        `(корень Z=${selectedRoot}, B=${intermediate.dimensionlessB})`,
      gasId: inputs.gasId
    };
  }
  const phi = Math.exp(lnPhi);
  const fugacityPa = phi * request.pressurePa;
  if (!Number.isFinite(phi) || !Number.isFinite(fugacityPa) || phi <= 0 || fugacityPa <= 0) {
    return {
      status: 'failure',
      code: 'numerical_failure',
      message:
        `неконечный результат для «${inputs.gasId}»: ln(phi)=${lnPhi}, phi=${String(phi)}, ` +
        `f=${String(fugacityPa)}; надёжный расчёт невозможен`,
      gasId: inputs.gasId
    };
  }

  return {
    status: 'success',
    gasId: inputs.gasId,
    formula: inputs.formula,
    name: inputs.name,
    temperatureK: request.temperatureK,
    pressurePa: request.pressurePa,
    root: request.root,
    evidencePolicy: request.evidencePolicy,

    evidence: inputs.evidence,

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

    discriminantSign: cubic.discriminantSign,
    realRootMultiplicities: cubic.rootMultiplicities,
    physicalRootMultiplicities: physicalTopology.multiplicities,

    warnings: resultWarnings,
    notes: [BRANCH_SELECTION_NOTE]
  };
}

// ============================================
// 6. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Stage 4.4.4.2/4.4.4.2.2 — чистая математика PR чистого компонента.
// Границы: смеси/kij/flash/фазовая устойчивость — 4.4.4.3+; lookup
// каталога и provenance-скаляры — Data/pengRobinsonFacade.ts;
// интеграция с solveEquilibrium — вне объёма подэтапа.


