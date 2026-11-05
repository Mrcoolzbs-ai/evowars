// ============================================
// PENG–ROBINSON — чистокомпонентный EOS: Z, phi, фугитивность
// ============================================
//
// Stage 4.4.4.2 «Чистокомпонентный Peng–Robinson: Z, phi и фугитивность»,
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
// Проверки корректности (Stage 4.4.4.2.1, см. Tests/pengRobinson.test.ts
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

/** Результат низкоуровневого решателя: различимые действительные корни. */
export type PrCubicRealRootsResult =
  | { readonly ok: true; readonly roots: readonly number[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Действительные корни кубического уравнения PR (Stage 4.4.4.2.1:
 * исправлена классификация знака дискриминанта около кратных корней).
 *
 * Математика: для депрессированной формы y^3 + p*y + q (z = y + shift,
 * shift = (1-B)/3) дискриминант D = (q/2)^2 + (p/3)^3 задаёт число
 * действительных корней: D > 0 — ровно ОДИН (пара комплексных),
 * D < 0 — ровно ТРИ, D = 0 — кратный корень.
 *
 * Классификация по знаку с ЯВНОЙ границей ошибки (Stage 4.4.4.2.1).
 * Дискриминант вычисляется в double из коэффициентов c0..c2 и несёт
 * ошибку округления; его знак около нуля неопределим без оценки
 * границы. Раньше условие «D <= 1e-12 * scale» направляло и случаи с
 * уверенно ПОЛОЖИТЕЛЬНЫМ D в тригонометрическую ветвь, а кламп acos
 * создавал ФИКТИВНЫЙ повторный действительный корень: например, при
 * A = 0.13130582290411344, B = 0.01980480623881198 математически
 * существует ровно один действительный корень (0.88019…), а старый
 * решатель возвращал и второй «корень» у 0.05, который больше B и
 * становился ложной liquid-ветвью. Кламп аргумента acos допустим
 * ТОЛЬКО когда число корней = 3 уже доказано знаком D < -discErr.
 *
 * Граница ошибки D оценивается через дифференциалы: p несёт ошибку
 * ~8*eps*(|c1| + |c2^2/3|), q — ~8*eps*(2|c2^3|/27 + |c1*c2|/3 +
 * |c0|); тогда discErr = |p^2/9|*pErr + |q/2|*qErr + 8*eps*discScale,
 * discScale = |(q/2)^2| + |(p/3)^3|. Знак считается установленным
 * только при |D| > discErr: уверенно положительный D НЕ превращается
 * в ноль и мнимых действительных корней не создаёт.
 *
 * Ветви решателя:
 * - p < 0, D > discErr: ОДИН корень. |arg| >= 1 — гиперболический
 *   метод y = -2*sgn(q)*sqrt(-p/3)*cosh(acosh(|arg|)/3) (без
 *   катастрофического сокращения Cardano около кратных корней);
 *   |arg| < 1 (округление сместило аргумент при доказанном D > 0) —
 *   стабильный Cardano (см. ниже);
 * - p < 0, D < -discErr: ТРИ корня, тригонометрический метод; кламп
 *   аргумента в [-1, 1] допустим — число корней доказано знаком D;
 * - p < 0, |D| <= discErr: ПОЛОСА кратного корня — численно неопределимый
 *   знак. Мнимые корни не выдумываются и не теряются: кратный корень
 *   вычисляется как критическая точка полинома с меньшей |c(z)| из
 *   двух (z = (-c2 ± sqrt(c2^2 - 3c1))/3), третий корень — по Виету
 *   (-c2 - 2*z_double); при dd <= 0 (почти тройной корень) — центр
 *   кластера -c2/3. Корни в z-координатах, сдвиг shift НЕ добавляется.
 *   Дедупликация ниже схлопывает совпавшие в пределах точности корни;
 *   число РАЗЛИЧИМЫХ корней честно отражает численную разрешимость;
 * - p >= 0: D >= 0 всегда, СТАБИЛЬНЫЙ Cardano: из двух кубических
 *   корней выбирается больший по модулю (big = -q/2 + sqrt(D) при
 *   q <= 0, иначе -q/2 - sqrt(D)) — слагаемые одного знака без
 *   сокращения; второй корень по Виету: y = w - (p/3)/w. Прямой
 *   Cardano (cbrt(-q/2+sr) + cbrt(-q/2-sr)) при p -> 0+ теряет до
 *   ~1.5e-7 точности катастрофическим сокращением.
 *
 * Дополнительно: невязка полинома проверяется для КАЖДОГО корня
 * относительно масштаба коэффициентов (но невязка сама по себе НЕ
 * является доказательством действительности корня — у фиктивного
 * корня из тригонометрической ветви со сплющенным acos невязка тоже
 * мала; действительность гарантирует только классификация по знаку D
 * с границей ошибки); дедупликация кратных корней с допуском
 * 1e-8*max(1, |z_max|, B) (ошибка кратного корня в double ~
 * sqrt(eps) ~ 1.5e-8); неконечные A/B — отказ.
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
  const shift = (1 - dimensionlessB) / 3;

  const rawRoots: number[] = [];
  // Полоса кратного корня возвращает корни сразу в z-координатах;
  // остальные ветви — в y-координатах (требуется сдвиг shift).
  let rawRootsInZCoordinates = false;

  if (p < 0) {
    const arg = ((3 * q) / (2 * p)) * Math.sqrt(-3 / p);
    const qHalfSquared = (q / 2) * (q / 2);
    const pThirdCubed = (p / 3) * (p / 3) * (p / 3);
    const discScale = Math.abs(qHalfSquared) + Math.abs(pThirdCubed);
    const discriminant = qHalfSquared + pThirdCubed;
    // Границы ошибок округления p, q и дискриминанта (Stage 4.4.4.2.1).
    const pErr = 8 * Number.EPSILON * (Math.abs(c1) + Math.abs((c2 * c2) / 3));
    const qErr =
      8 * Number.EPSILON *
      ((2 * Math.abs(c2 * c2 * c2)) / 27 + Math.abs((c1 * c2) / 3) + Math.abs(c0));
    const discErr =
      Math.abs((p * p) / 9) * pErr + Math.abs(q / 2) * qErr +
      8 * Number.EPSILON * Math.max(discScale, 1e-300);

    if (discriminant > discErr) {
      // Уверенно ПОЛОЖИТЕЛЬНЫЙ дискриминант: ровно ОДИН действительный
      // корень. Никаких фиктивных повторных корней.
      const h = Math.abs(arg);
      if (h >= 1) {
        rawRoots.push(
          -2 * Math.sign(q) * Math.sqrt(-p / 3) * Math.cosh(Math.acosh(h) / 3)
        );
      } else {
        // Округление сместило arg < 1 при доказанном D > discErr:
        // стабильный Cardano (без клампа, сохраняющего один корень).
        const squareRoot = Math.sqrt(Math.max(0, discriminant));
        const big = q <= 0 ? -q / 2 + squareRoot : -q / 2 - squareRoot;
        if (big === 0) {
          rawRoots.push(0);
        } else {
          const w = Math.cbrt(big);
          rawRoots.push(w - (p / 3) / w);
        }
      }
    } else if (discriminant < -discErr) {
      // Уверенно ОТРИЦАТЕЛЬНЫЙ дискриминант: ровно ТРИ действительных
      // корня — кламп arg в [-1, 1] допустим (число корней доказано
      // знаком D), это защита только от округления аргумента.
      const clamped = Math.max(-1, Math.min(1, arg));
      const theta = Math.acos(clamped) / 3;
      const amplitude = 2 * Math.sqrt(-p / 3);
      for (let k = 0; k < 3; k += 1) {
        rawRoots.push(amplitude * Math.cos(theta - (2 * Math.PI * k) / 3));
      }
    } else {
      // ПОЛОСА кратного корня: |D| <= discErr — знак численно
      // неопределим. Кратный корень — критическая точка полинома
      // (меньшая |c(z)| из двух), третий корень — по Виету. Корни
      // сразу в z-координатах: сдвиг shift НЕ добавляется.
      rawRootsInZCoordinates = true;
      const derivativeDiscriminant = c2 * c2 - 3 * c1;
      if (derivativeDiscriminant > 0) {
        const sqrtDd = Math.sqrt(derivativeDiscriminant);
        // Корни производной 3z^2 + 2c2 z + c1: больший по модулю
        // выбирается без сокращения; второй — по Виету (c1/(3*z1)).
        const qq = c2 >= 0 ? -(c2 + sqrtDd) : -(c2 - sqrtDd);
        const zc1 = qq / 3;
        const zc2 = c1 / qq;
        const polynomial = (z: number): number => z * z * z + c2 * z * z + c1 * z + c0;
        const zDouble =
          Math.abs(polynomial(zc1)) <= Math.abs(polynomial(zc2)) ? zc1 : zc2;
        rawRoots.push(zDouble, -c2 - 2 * zDouble);
      } else {
        // Почти тройной корень: центр кластера (для PR = (1-B)/3).
        rawRoots.push(-c2 / 3);
      }
    }
  } else {
    // p >= 0: дискриминант неотрицателен, ровно один действительный
    // корень. Стабильный Cardano: слагаемые одного знака + Виет.
    const discriminant = (q / 2) * (q / 2) + (p / 3) * (p / 3) * (p / 3);
    const squareRoot = Math.sqrt(Math.max(0, discriminant));
    const big = q <= 0 ? -q / 2 + squareRoot : -q / 2 - squareRoot;
    if (big === 0) {
      // q = 0 и p = 0: тройной корень y = 0.
      rawRoots.push(0);
    } else {
      const w = Math.cbrt(big);
      rawRoots.push(w - (p / 3) / w);
    }
  }

  // Возврат к z (только для ветвей в y-координатах) и проверка невязки
  // каждого корня относительно масштаба коэффициентов.
  const candidates = rawRootsInZCoordinates
    ? rawRoots
    : rawRoots.map((y) => y + shift);
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
  const physical = prPhysicalRoots(cubic.roots, intermediate.dimensionlessB);
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

    warnings: resultWarnings,
    notes: [BRANCH_SELECTION_NOTE]
  };
}

// ============================================
// 6. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Stage 4.4.4.2/4.4.4.2.1 — чистая математика PR чистого компонента.
// Границы: смеси/kij/flash/фазовая устойчивость — 4.4.4.3+; lookup
// каталога и provenance-скаляры — Data/pengRobinsonFacade.ts;
// интеграция с solveEquilibrium — вне объёма подэтапа.
