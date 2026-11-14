// ============================================
// PENG–ROBINSON FLASH — изотермо-изобарный двухфазный VLE flash
// смеси из произвольного числа компонентов n >= 2
// (Stage 4.4.4.6, обобщение бинарного среза 4.4.4.5)
// ============================================
//
// САМОСТОЯТЕЛЬНЫЙ публичный API Core: разделение смеси на жидкую и
// паровую фазы при заданных T, P, составе feed z и явной evidencePolicy.
// РЕИСПОЛЬЗУЕТ существующие реализации и НЕ создаёт вторую независимую
// реализацию кубики PR, правил смешения, kij или фугитивностей:
// - кубика смеси, правила смешения, Z, ln(phi_i), phi_i, f_i —
//   computePengRobinsonMixture (Core/pengRobinsonMixture.ts);
// - гейтинг evidencePolicy, наличие kij и диапазоны применимости —
//   тот же вычислитель (единый источник отказов);
// - скрининг фазовой устойчивости feed — существующий multi-start
//   поиск TPD (Core/prTangentPlaneDistanceSearch.ts) в рамках ЕГО
//   контракта: пороги не ослабляются, статус validated bound не
//   меняется.
//
// Алгоритм (обобщён на произвольное n >= 2):
// - инициализация K по Уилсону для каждого компонента;
// - уравнение Рачфорда–Райса g(beta) = SUM_i z_i (1 - K_i) /
//   (1 + beta (K_i - 1)) по АКТИВНЫМ компонентам (z_i > 0);
// - бисекция beta на [0, 1];
// - составы фаз x_i = z_i / (1 + beta (K_i - 1)), y_i = K_i x_i;
// - последовательные замены K_i = phi_i^L / phi_i^V до равенства
//   фугитивностей f_i^L = x_i phi_i^L P = y_i phi_i^V P = f_i^V;
// - демпфированное обновление в ln K с восстановлением после потери
//   корня Рачфорда–Райса (устойчивость последовательных замен).
//
// НУЛЕВЫЕ ДОЛИ: z_i = 0 трактуются как отсутствие компонента —
// x_i = y_i = 0 точно, компонент исключён из уравнения
// Рачфорда–Райса и из обновления K, ln(f_i^L / f_i^V) = 0 по
// определению (без log(0) и NaN).
//
// ЧЕСТНАЯ СЕМАНТИКА (обязательно):
// - сходимость flash НЕ доказывает глобальную фазовую устойчивость:
//   равенство фугитивностей — необходимое, но не достаточное условие;
//   TPD-поиск не располагает validated continuous error bound (статус
//   порога provisional_pending_error_audit), поэтому verdict 'stable'
//   НЕ возвращается НИКОГДА;
// - Wilson K-values — начальное приближение, а не доказательство
//   фазового состояния;
// - потеря корня Рачфорда–Райса ПОСЛЕ итерационного обновления —
//   сначала попытка восстановления демпфированием; неуспех —
//   convergence_failure, а НЕ доказанное однофазное состояние;
//   только потеря корня на СТАРТЕ (по Wilson K) честно даёт
//   no_two_phase_split с явной оговоркой;
// - двухфазный кандидат с beta практически 0 или 1 НЕ выдаётся;
// - составы фаз не клиппируются и не нормализуются молча: повреждённый
//   промежуточный результат — контролируемый отказ numerical_failure;
// - никакой подстановки kij = 0, CoolProp-default или расширения
//   диапазонов применимости: отсутствующий kij и вне диапазона —
//   отказы, а не молчаливые допущения;
// - новые чистокомпонентные параметры и бинарные коэффициенты НЕ
//   добавляются: только входы вызывающей стороны (каталог Data —
//   через фасад вызывающей стороной).
//
// Границы среза: только ДВЕ фазы (VLE), постоянный kij классического
// PR. LLE, PPR78, доказанная глобальная устойчивость и интеграция с
// solveEquilibrium/ChemicalEvolution — НЕ реализованы (отдельные
// шаги).

import type {
  PengRobinsonEvidencePolicy,
  PengRobinsonMixtureFailure,
  PengRobinsonMixtureInputs,
  PengRobinsonMixtureSuccess,
  PengRobinsonMixtureWarning
} from './pengRobinsonMixture';
import { computePengRobinsonMixture, PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE } from './pengRobinsonMixture';
import { computePrTangentPlaneDistanceSearch } from './prTangentPlaneDistanceSearch';

// ============================================
// 1. ПУБЛИЧНЫЕ ТИПЫ
// ============================================

/** Устойчивые машинно-читаемые коды отказов flash. */
export type PengRobinsonFlashErrorCode =
  | 'invalid_input'
  | 'missing_binary_interaction'
  | 'unsupported_binary_interaction'
  | 'parameter_evidence_rejected'
  | 'temperature_applicability'
  | 'no_two_phase_split'
  | 'convergence_failure'
  | 'numerical_failure';

/** Реестр кодов отказов flash. */
export const PENG_ROBINSON_FLASH_ERROR_CODES: readonly PengRobinsonFlashErrorCode[] = [
  'invalid_input',
  'missing_binary_interaction',
  'unsupported_binary_interaction',
  'parameter_evidence_rejected',
  'temperature_applicability',
  'no_two_phase_split',
  'convergence_failure',
  'numerical_failure'
];

/**
 * Статус фазовой устойчивости результата flash. Верdict 'stable'
 * ОТСУТСТВУЕТ СОЗНАТЕЛЬНО: глобальная устойчивость не доказана
 * (TPD-поиск без validated continuous error bound; равенство
 * фугитивностей не доказывает устойчивость).
 */
export type PengRobinsonFlashStabilityStatus =
  /** Глобальная устойчивость НЕ доказана (в т.ч. TPD не нашёл нестабильность). */
  | 'indeterminate'
  /** TPD-поиск обнаружил нестабильность feed (порог provisional_pending_error_audit). */
  | 'two_phase_split_indicated';

/** Состав фазы: компонент + молярная доля (порядок — порядок входа). */
export interface PengRobinsonFlashComposition {
  readonly component: string;
  readonly moleFraction: number;
}

/** Фазовая часть успешного результата (одна фаза). */
export interface PengRobinsonFlashPhaseResult {
  readonly root: 'vapor' | 'liquid';
  /** Коэффициент сжимаемости фазы (выбранная математическая ветвь PR). */
  readonly Z: number;
  /** a_mix фазы, Pa*m^6/mol^2. */
  readonly aMixPaM6PerMol2: number;
  /** b_mix фазы, m^3/mol. */
  readonly bMixM3PerMol: number;
  readonly dimensionlessA: number;
  readonly dimensionlessB: number;
  /** Компонентные результаты в порядке ВХОДА (включая нулевые доли). */
  readonly components: readonly {
    readonly component: string;
    readonly moleFraction: number;
    readonly lnPhi: number;
    readonly phi: number;
    /** f_i = x_i * phi_i * P, Pa (для z_i = 0 — точно 0). */
    readonly fugacityPa: number;
  }[];
}

/** Использованный бинарный коэффициент (прозрачность доказательств). */
export interface PengRobinsonFlashKijUsed {
  readonly componentA: string;
  readonly componentB: string;
  readonly kij: number;
  readonly evidence: PengRobinsonFlashKijEvidence;
  readonly applicabilityRangeK: Readonly<{
    minTemperatureK: number;
    maxTemperatureK: number;
  }> | null;
}

/** Статус доказательности kij (переиспользуется из смесевого слоя). */
export type PengRobinsonFlashKijEvidence = PengRobinsonMixtureSuccess['binaryInteractionsUsed'][number]['evidence'];

/** Успешный двухфазный кандидат равновесия (НЕ доказанная устойчивость). */
export interface PengRobinsonFlashTwoPhaseCandidate {
  readonly status: 'two_phase_candidate';
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
  /** Состав feed в порядке входа. */
  readonly feedComposition: readonly PengRobinsonFlashComposition[];
  /** Равновесный состав жидкой фазы (порядок входа). */
  readonly liquidComposition: readonly PengRobinsonFlashComposition[];
  /** Равновесный состав паровой фазы (порядок входа). */
  readonly vaporComposition: readonly PengRobinsonFlashComposition[];
  /** Молярная доля паровой фазы beta: z_i = (1-beta)*x_i + beta*y_i. */
  readonly vaporFractionBeta: number;
  /** PR-результаты жидкой фазы (состав x). */
  readonly liquid: PengRobinsonFlashPhaseResult;
  /** PR-результаты паровой фазы (состав y). */
  readonly vapor: PengRobinsonFlashPhaseResult;
  /** Использованные kij (каталожные значения, без подстановок). */
  readonly kijUsed: readonly PengRobinsonFlashKijUsed[];
  /** Объединённые предупреждения обеих фаз (без дубликатов). */
  readonly warnings: readonly PengRobinsonMixtureWarning[];
  /** Невязка равенства фугитивностей: max по АКТИВНЫМ i |ln(f_i^L / f_i^V)|. */
  readonly fugacityEqualityResidual: {
    readonly maxLnFugacityRatio: number;
    readonly tolerance: number;
    readonly perComponent: readonly {
      readonly component: string;
      /** Для z_i = 0 — 0 по определению (компонент вне равенства фугитивностей). */
      readonly lnFugacityRatio: number;
    }[];
  };
  /** Невязка материального баланса: max_i |(1-beta)*x_i + beta*y_i - z_i|. */
  readonly materialBalanceResidual: number;
  /** Число выполненных итераций последовательных замен. */
  readonly iterations: number;
  readonly convergence: {
    readonly status: 'converged';
    readonly fugacityTolerance: number;
  };
  /** Статус фазовой устойчивости: 'stable' не предусмотрен сознательно. */
  readonly stability: PengRobinsonFlashStabilityStatus;
  /** Пояснение статуса устойчивости (машинно-читаемая причина). */
  readonly stabilityNote: string;
  /**
   * Явное ограничение интерпретации: кандидат равновесия, а не
   * доказанная устойчивая фазовая диаграмма.
   */
  readonly interpretationLimitation: string;
}

/** Отказ flash: устойчивый код + диагностика. */
export interface PengRobinsonFlashFailure {
  readonly status: 'failure';
  readonly code: PengRobinsonFlashErrorCode;
  readonly message: string;
  readonly detail?: string;
}

/** Discriminated union результата flash. */
export type PengRobinsonFlashResult =
  | PengRobinsonFlashTwoPhaseCandidate
  | PengRobinsonFlashFailure;

/** Запрос flash. */
export interface PengRobinsonFlashRequest {
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
  /** Максимум итераций последовательных замен (по умолчанию 200). */
  readonly maxIterations?: number;
  /** Допуск сходимости по max|ln(f^L/f^V)| (по умолчанию 1e-10). */
  readonly fugacityTolerance?: number;
  /**
   * Скрининг устойчивости feed существующим TPD-поиском (по умолчанию
   * true). Отказ или неопределённость TPD дают stability 'indeterminate',
   * НИКОГДА 'stable'.
   */
  readonly stabilityScreening?: boolean;
}

/** Вход flash: те же структуры, что использует смесевой вычислитель. */
export interface PengRobinsonFlashInput {
  readonly mixtureInputs: PengRobinsonMixtureInputs;
  readonly request: PengRobinsonFlashRequest;
}

// ============================================
// 2. КОНСТАНТЫ И ХЕЛПЕРЫ
// ============================================

/** Пояснение ограничения интерпретации (одинаково для всех кандидатов). */
export const PENG_ROBINSON_FLASH_INTERPRETATION_LIMITATION: string =
  'Сошедшийся двухфазный результат — КАНДИДАТ равновесия VLE при заданных ' +
  'T, P и составе feed: равенство фугитивностей f_i^L = f_i^V и материальный ' +
  'баланс выполнены, но глобальная фазовая устойчивость НЕ доказана ' +
  '(равенство фугитивностей — необходимое, но не достаточное условие; ' +
  'TPD-поиск работает без validated continuous error bound, порог ' +
  'provisional_pending_error_audit). Верdict stable не выдаётся. Срез: ' +
  'произвольное число компонентов n >= 2 (в рамках доступных пар kij), ' +
  'только пар+жидкость (LLE не проверяется), постоянный kij классического PR.';

/** Пояснение по умолчанию для indeterminate-устойчивости. */
const STABILITY_NOTE_INDETERMINATE: string =
  'глобальная фазовая устойчивость не доказана: скрининг TPD не дал ' +
  'основания объявить нестабильность (no_instability_found_within_search / ' +
  'indeterminate / отказ скрининга), а validated error bound у TPD-поиска ' +
  'отсутствует — статус сознательно indeterminate, НЕ stable. ' +
  'no_instability_found_within_search НЕ является доказанной стабильностью.';

/** Пояснение для two_phase_split_indicated. */
const STABILITY_NOTE_SPLIT_INDICATED: string =
  'TPD-поиск обнаружил нестабильность гомогенного feed ' +
  '(unstable_detected); порог TPD остаётся provisional_pending_error_audit ' +
  '(validated continuous error bound отсутствует), поэтому статус ' +
  'двухфазного разделения — указание, а НЕ доказанная устойчивость';

/** Граница «практически чистая фаза» для beta: кандидат вне (eps, 1-eps) не выдаётся. */
const BETA_BOUND_EPS = 1e-9;

/** Минимальное демпфирование обновления ln K. */
const MIN_DAMPING = 1 / 1024;

/** Максимум шагов восстановления (деления демпфирования пополам). */
const MAX_DAMPING_RECOVERY_STEPS = 10;

function flashFailure(code: PengRobinsonFlashErrorCode, message: string, detail?: string): PengRobinsonFlashFailure {
  return detail === undefined ? { status: 'failure', code, message } : { status: 'failure', code, message, detail };
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Отображение кодов отказа смесевого вычислителя в коды flash. */
function mapMixtureFailure(failure: PengRobinsonMixtureFailure, context: string): PengRobinsonFlashFailure {
  switch (failure.code) {
    case 'missing_binary_interaction':
      return flashFailure(
        'missing_binary_interaction',
        context + ': ' + failure.message,
        failure.detail
      );
    case 'asymmetric_binary_interaction':
      return flashFailure(
        'unsupported_binary_interaction',
        context + ': ' + failure.message,
        failure.detail
      );
    case 'parameter_evidence_not_accepted':
      return flashFailure(
        'parameter_evidence_rejected',
        context + ': ' + failure.message,
        failure.detail
      );
    case 'binary_interaction_applicability':
      return flashFailure(
        'temperature_applicability',
        context + ': ' + failure.message,
        failure.detail
      );
    case 'invalid_input':
    case 'invalid_composition':
    case 'invalid_parameters':
    case 'unknown_component':
      return flashFailure('invalid_input', context + ': ' + failure.message, failure.detail);
    default:
      return flashFailure('numerical_failure', context + ': ' + failure.message, failure.detail);
  }
}

// ============================================
// 3. FLASH (многокомпонентный, n >= 2)
// ============================================

/**
 * Изотермо-изобарный двухфазный VLE flash смеси из n >= 2 компонентов.
 *
 * Возвращает two_phase_candidate (кандидат равновесия, stability НИКОГДА
 * не 'stable') или отказ с устойчивым машинно-читаемым кодом.
 */
export function computePengRobinsonFlash(input: PengRobinsonFlashInput): PengRobinsonFlashResult {
  // ---------- Валидация формы входа ----------
  if (typeof input !== 'object' || input === null || !('mixtureInputs' in input) || !('request' in input)) {
    return flashFailure('invalid_input', 'вход flash обязан быть объектом { mixtureInputs, request }');
  }
  const request = input.request;
  if (typeof request !== 'object' || request === null) {
    return flashFailure('invalid_input', 'request обязан быть непустым объектом');
  }
  const { temperatureK, pressurePa } = request;
  if (!isFiniteNumber(temperatureK) || temperatureK <= 0) {
    return flashFailure('invalid_input', 'temperatureK обязан быть конечным положительным числом');
  }
  if (!isFiniteNumber(pressurePa) || pressurePa <= 0) {
    return flashFailure('invalid_input', 'pressurePa обязан быть конечным положительным числом');
  }
  const policy = request.evidencePolicy;
  if (policy !== 'verified_only' && policy !== 'allow_partial' && policy !== 'allow_unresolved_cross_check') {
    return flashFailure(
      'invalid_input',
      'evidencePolicy обязана быть одной из: verified_only, allow_partial, allow_unresolved_cross_check'
    );
  }
  const maxIterations = request.maxIterations ?? 200;
  if (!isFiniteNumber(maxIterations) || maxIterations < 1 || !Number.isInteger(maxIterations)) {
    return flashFailure('invalid_input', 'maxIterations обязан быть целым числом >= 1');
  }
  const fugacityTolerance = request.fugacityTolerance ?? 1e-10;
  if (!isFiniteNumber(fugacityTolerance) || fugacityTolerance <= 0) {
    return flashFailure('invalid_input', 'fugacityTolerance обязана быть конечным положительным числом');
  }

  // ---------- Валидация состава feed (n >= 2, нулевые доли допустимы) ----------
  const mixtureInputs = input.mixtureInputs;
  if (
    typeof mixtureInputs !== 'object' ||
    mixtureInputs === null ||
    !Array.isArray(mixtureInputs.components) ||
    !Array.isArray(mixtureInputs.binaryInteractions)
  ) {
    return flashFailure(
      'invalid_input',
      'mixtureInputs обязан содержать массивы components и binaryInteractions'
    );
  }
  const components = mixtureInputs.components;
  if (components.length < 2) {
    return flashFailure(
      'invalid_input',
      'flash требует не менее двух компонентов, получено ' + String(components.length)
    );
  }
  const seen = new Set<string>();
  for (const c of components) {
    if (
      typeof c !== 'object' ||
      c === null ||
      typeof c.component !== 'string' ||
      c.component === ''
    ) {
      return flashFailure('invalid_input', 'каждый компонент обязан иметь непустое имя component');
    }
    if (seen.has(c.component)) {
      return flashFailure('invalid_input', 'компоненты обязаны иметь уникальные имена, дубликат «' + c.component + '»');
    }
    seen.add(c.component);
    if (!isFiniteNumber(c.criticalTemperatureK) || c.criticalTemperatureK <= 0) {
      return flashFailure('invalid_input', 'компонент «' + c.component + '»: criticalTemperatureK обязан быть конечным положительным числом');
    }
    if (!isFiniteNumber(c.criticalPressurePa) || c.criticalPressurePa <= 0) {
      return flashFailure('invalid_input', 'компонент «' + c.component + '»: criticalPressurePa обязан быть конечным положительным числом');
    }
    if (!isFiniteNumber(c.acentricFactor)) {
      return flashFailure('invalid_input', 'компонент «' + c.component + '»: acentricFactor обязан быть конечным числом');
    }
    if (!isFiniteNumber(c.moleFraction) || c.moleFraction < 0 || c.moleFraction >= 1) {
      return flashFailure(
        'invalid_input',
        'компонент «' + c.component + '»: доля feed обязана быть конечным числом в [0, 1) ' +
          '(точный ноль допустим и трактуется как отсутствие компонента), получено ' + String(c.moleFraction)
      );
    }
  }
  let feedSum = 0;
  let activeCount = 0;
  for (const c of components) {
    feedSum += c.moleFraction;
    if (c.moleFraction > 0) activeCount += 1;
  }
  if (Math.abs(feedSum - 1) > PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE) {
    return flashFailure(
      'invalid_input',
      'сумма долей feed обязана равняться 1 в допуске ' + String(PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE) +
        ' (без нормализации), получено ' + String(feedSum)
    );
  }
  if (activeCount < 2) {
    return flashFailure(
      'invalid_input',
      'менее двух активных компонентов (z_i > 0): вырожденные одно-компонентные feed — вне среза VLE, ' +
        'активных компонентов: ' + String(activeCount)
    );
  }

  // ---------- Гейтинг данных и политики: первый PR-вызов на feed ----------
  // Отсутствующий kij, отклонённая evidence, вне диапазона применимости
  // и т.п. всплывают здесь с кодами смесевого слоя и отображаются в
  // коды flash. Молчаливых подстановок нет. Смесевой слой требует kij
  // только для пар АКТИВНЫХ компонентов: нулевые доли пары не требуют.
  const gating = computePengRobinsonMixture(mixtureInputs, {
    temperatureK,
    pressurePa,
    root: 'vapor',
    evidencePolicy: policy
  });
  if (gating.status === 'failure') {
    return mapMixtureFailure(gating, 'проверка данных и политики доказательности feed');
  }

  // ---------- Инициализация K по Уилсону (начальное приближение) ----------
  const n = components.length;
  const z: number[] = components.map((c) => c.moleFraction);
  const activeIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (z[i]! > 0) activeIdx.push(i);
  }
  const lnK: number[] = components.map((c) =>
    Math.log(c.criticalPressurePa / pressurePa) +
    5.373 * (1 + c.acentricFactor) * (1 - c.criticalTemperatureK / temperatureK)
  );
  if (lnK.some((v) => !isFiniteNumber(v))) {
    return flashFailure(
      'numerical_failure',
      'инициализация K по Уилсону дала не конечное значение',
      'ln K = ' + lnK.map((v) => String(v)).join(', ')
    );
  }

  /** K из текущего lnK (только активные используются в расчётах). */
  const kOf = (i: number): number => Math.exp(lnK[i]!);

  /**
   * Рачфорда–Райс по активным компонентам:
   * g(beta) = SUM_{i: z_i > 0} z_i (1 - K_i) / (1 + beta (K_i - 1)).
   */
  const rr = (beta: number): number => {
    let sum = 0;
    for (const i of activeIdx) {
      const ki = kOf(i);
      sum += (z[i]! * (1 - ki)) / (1 + beta * (ki - 1));
    }
    return sum;
  };

  type RrRoot = { ok: true; beta: number; boundary: boolean } | { ok: false; degenerate: boolean; detail: string };

  /** Бисекция Рачфорда–Райса на [0, 1] при текущих K. */
  const solveRr = (): RrRoot => {
    const kSnapshot = activeIdx.map((i) => kOf(i));
    if (kSnapshot.some((k) => !isFiniteNumber(k) || k <= 0)) {
      return { ok: false, degenerate: false, detail: 'K не конечны или не положительны: ' + kSnapshot.map((v) => String(v)).join(', ') };
    }
    const g0 = rr(0);
    const g1 = rr(1);
    if (!isFiniteNumber(g0) || !isFiniteNumber(g1)) {
      return { ok: false, degenerate: false, detail: 'g(0) = ' + String(g0) + ', g(1) = ' + String(g1) };
    }
    if (g0 === 0 && g1 === 0) {
      return { ok: false, degenerate: true, detail: 'K-значения выродились в 1: ' + kSnapshot.map((v) => String(v)).join(', ') };
    }
    if (g0 * g1 > 0) {
      return {
        ok: false,
        degenerate: false,
        detail: 'корень Рачфорда–Райса отсутствует на [0, 1]: g(0) = ' + String(g0) + ', g(1) = ' + String(g1) +
          ', K = ' + kSnapshot.map((v) => String(v)).join(', ')
      };
    }
    let lo = 0;
    let hi = 1;
    for (let bisect = 0; bisect < 100; bisect++) {
      const mid = 0.5 * (lo + hi);
      const gm = rr(mid);
      if (!isFiniteNumber(gm)) {
        return { ok: false, degenerate: false, detail: 'бисекция встретила не конечное g при beta = ' + String(mid) };
      }
      if (g0 * gm <= 0) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    const beta = 0.5 * (lo + hi);
    const boundary = beta <= BETA_BOUND_EPS || beta >= 1 - BETA_BOUND_EPS;
    return { ok: true, beta, boundary };
  };

  /** Фазовые составы из beta при текущих K (без клиппинга; нулевые доли — точно 0). */
  const phaseCompositions = (beta: number): { x: number[]; y: number[] } | PengRobinsonFlashFailure => {
    const x: number[] = new Array<number>(n).fill(0);
    const y: number[] = new Array<number>(n).fill(0);
    for (const i of activeIdx) {
      const ki = kOf(i);
      const denom = 1 + beta * (ki - 1);
      if (!isFiniteNumber(denom) || denom === 0) {
        return flashFailure(
          'numerical_failure',
          'знаменатель Рачфорда–Райса выродился в ноль или не конечен',
          'beta = ' + String(beta) + ', K = ' + activeIdx.map((j) => String(kOf(j))).join(', ')
        );
      }
      const xi = z[i]! / denom;
      const yi = ki * xi;
      if (!isFiniteNumber(xi) || !isFiniteNumber(yi) || xi < 0 || yi < 0) {
        return flashFailure(
          'numerical_failure',
          'фазовый состав повреждён (не конечен или отрицателен); клиппинг и нормализация повреждённых результатов запрещены',
          'компонент «' + components[i]!.component + '»: x = ' + String(xi) + ', y = ' + String(yi)
        );
      }
      x[i] = xi;
      y[i] = yi;
    }
    let sumX = 0;
    let sumY = 0;
    for (const i of activeIdx) {
      sumX += x[i]!;
      sumY += y[i]!;
    }
    if (Math.abs(sumX - 1) > 1e-8 || Math.abs(sumY - 1) > 1e-8) {
      return flashFailure(
        'numerical_failure',
        'фазовые составы не нормированы (сумма активных компонент вне допуска 1e-8); молчаливая нормализация запрещена',
        'sum(x) = ' + String(sumX) + ', sum(y) = ' + String(sumY)
      );
    }
    return { x, y };
  };

  /** PR-вычисление фазы с отображением отказов. */
  const prPhase = (
    fractions: number[],
    root: 'vapor' | 'liquid',
    context: string
  ): PengRobinsonMixtureSuccess | PengRobinsonFlashFailure => {
    const phaseInputs: PengRobinsonMixtureInputs = {
      components: components.map((c, i) => ({ ...c, moleFraction: fractions[i]! })),
      binaryInteractions: mixtureInputs.binaryInteractions
    };
    const result = computePengRobinsonMixture(phaseInputs, {
      temperatureK,
      pressurePa,
      root,
      evidencePolicy: policy
    });
    if (result.status === 'failure') {
      return mapMixtureFailure(result, context);
    }
    return result;
  };

  // ---------- Итерации: RR beta → фазы → демпфированное обновление ln K ----------
  let iterations = 0;
  let damping = 1;
  let prevLnK: number[] | null = null;
  let targetLnK: number[] | null = null;
  let lastBeta: number | null = null;
  let lastX: number[] | null = null;
  let lastY: number[] | null = null;
  let liquidResult: PengRobinsonMixtureSuccess | null = null;
  let vaporResult: PengRobinsonMixtureSuccess | null = null;
  let maxResidual = Number.NaN;
  let perComponentResidual: number[] = [];

  /**
   * Попытка восстановления после потери корня RR (или граничного beta):
   * демпфирование обновления ln K от prevLnK к targetLnK. Возвращает
   * true, если корень восстановлен на неграничном beta.
   */
  const recoverRoot = (): boolean => {
    if (prevLnK === null || targetLnK === null) return false;
    for (let step = 0; step < MAX_DAMPING_RECOVERY_STEPS && damping > MIN_DAMPING; step++) {
      damping = damping / 2;
      if (damping < MIN_DAMPING) damping = MIN_DAMPING;
      for (const i of activeIdx) {
        lnK[i] = prevLnK[i]! + damping * (targetLnK[i]! - prevLnK[i]!);
        if (!isFiniteNumber(lnK[i]!)) {
          return false;
        }
      }
      const retry = solveRr();
      if (retry.ok && !retry.boundary) {
        return true;
      }
    }
    return false;
  };

  while (iterations < maxIterations) {
    const root = solveRr();
    if (!root.ok) {
      if (prevLnK === null) {
        // Потеря корня на СТАРТЕ (по Wilson K): честное однофазное
        // указание в рамках среза VLE — с явной оговоркой, что Wilson
        // K — начальное приближение, а не доказательство устойчивости.
        if (root.degenerate) {
          return flashFailure(
            'no_two_phase_split',
            'K-значения Уилсона выродились в 1: разделение фаз не определено (fugacity-коэффициенты фаз совпадают)',
            root.detail
          );
        }
        return flashFailure(
          'no_two_phase_split',
          'при начальных K-значениях Уилсона двухфазное разбиение Рачфорда–Райса не существует (g(0) и g(1) одного знака): состояние однофазное в рамках среза VLE; Wilson K — начальное приближение, а не доказательство фазового состояния',
          root.detail
        );
      }
      // Потеря корня ПОСЛЕ итерационного обновления: сначала восстановление.
      if (!recoverRoot()) {
        return flashFailure(
          'convergence_failure',
          'последовательные замены потеряли корень Рачфорда–Райса, восстановление демпфированием ln K не удалось в рамках бюджета: это НЕ доказанное однофазное состояние',
          root.detail
        );
      }
      continue;
    }
    if (root.boundary) {
      // Граничное beta (практически 0 или 1) не выдаётся как кандидат.
      if (prevLnK === null) {
        return flashFailure(
          'no_two_phase_split',
          'решение Рачфорда–Райса по K-значениям Уилсона лежит на границе beta ≈ 0 или beta ≈ 1: вырожденное разделение в рамках среза VLE; Wilson K — начальное приближение, а не доказательство фазового состояния',
          'beta = ' + String(root.beta)
        );
      }
      if (!recoverRoot()) {
        return flashFailure(
          'convergence_failure',
          'итерации сошлись к граничному beta ≈ 0 или beta ≈ 1; восстановление демпфированием не дало неграничного решения: двухфазный кандидат на границе не выдаётся, это НЕ доказанное однофазное состояние',
          'beta = ' + String(root.beta)
        );
      }
      continue;
    }
    const beta = root.beta;
    const compositions = phaseCompositions(beta);
    if ('status' in compositions) {
      return compositions;
    }
    const liquid = prPhase(compositions.x, 'liquid', 'PR жидкой фазы (итерация ' + String(iterations + 1) + ')');
    if (liquid.status === 'failure') {
      return liquid;
    }
    const vapor = prPhase(compositions.y, 'vapor', 'PR паровой фазы (итерация ' + String(iterations + 1) + ')');
    if (vapor.status === 'failure') {
      return vapor;
    }

    // Невязка равенства фугитивностей (по активным компонентам)
    // и демпфированное обновление ln K.
    iterations += 1;
    maxResidual = 0;
    perComponentResidual = new Array<number>(n).fill(0);
    const newTargetLnK: number[] = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (z[i]! === 0) {
        // Нулевая доля: x_i = y_i = 0, ln(f^L/f^V) = 0 по определению,
        // компонент исключён из обновления K (нет log(0), нет NaN).
        continue;
      }
      const lnPhiL = liquid.components.find((c) => c.component === components[i]!.component)!.lnPhi;
      const lnPhiV = vapor.components.find((c) => c.component === components[i]!.component)!.lnPhi;
      const residual = Math.log(compositions.x[i]!) + lnPhiL - (Math.log(compositions.y[i]!) + lnPhiV);
      if (!isFiniteNumber(residual)) {
        return flashFailure(
          'numerical_failure',
          'невязка равенства фугитивностей не конечна (нулевой или не конечный состав фазы); молчаливая обработка запрещена',
          'компонент «' + components[i]!.component + '»: residual = ' + String(residual)
        );
      }
      perComponentResidual[i] = residual;
      if (Math.abs(residual) > maxResidual) maxResidual = Math.abs(residual);
      const lnKNew = lnPhiL - lnPhiV;
      if (!isFiniteNumber(lnKNew)) {
        return flashFailure(
          'numerical_failure',
          'обновление ln K = ln(phi_L/phi_V) дало не конечное значение',
          'компонент «' + components[i]!.component + '»: ln K_new = ' + String(lnKNew)
        );
      }
      newTargetLnK[i] = lnKNew;
    }
    prevLnK = lnK.slice();
    targetLnK = newTargetLnK;
    for (const i of activeIdx) {
      lnK[i] = prevLnK[i]! + damping * (targetLnK[i]! - prevLnK[i]!);
      if (!isFiniteNumber(lnK[i]!)) {
        return flashFailure(
          'numerical_failure',
          'демпфированное обновление ln K дало не конечное значение',
          'компонент «' + components[i]!.component + '»: ln K = ' + String(lnK[i]!)
        );
      }
    }
    lastBeta = beta;
    lastX = compositions.x;
    lastY = compositions.y;
    liquidResult = liquid;
    vaporResult = vapor;
    if (maxResidual < fugacityTolerance) {
      break;
    }
  }

  if (lastBeta === null || lastX === null || lastY === null || liquidResult === null || vaporResult === null) {
    return flashFailure('convergence_failure', 'flash не выполнил ни одной полной итерации');
  }
  if (!(maxResidual < fugacityTolerance)) {
    return flashFailure(
      'convergence_failure',
      'последовательные замены не сошлись за maxIterations итераций: равенство фугитивностей не достигнуто в допуске',
      'итераций: ' + String(iterations) + ', max|ln(f^L/f^V)| = ' + String(maxResidual) +
        ', допуск: ' + String(fugacityTolerance)
    );
  }

  // ---------- Финальные невязки (материальный баланс) ----------
  let materialBalanceResidual = 0;
  for (let i = 0; i < n; i++) {
    const balance = (1 - lastBeta) * lastX[i]! + lastBeta * lastY[i]! - z[i]!;
    if (!isFiniteNumber(balance)) {
      return flashFailure('numerical_failure', 'невязка материального баланса не конечна');
    }
    if (Math.abs(balance) > materialBalanceResidual) materialBalanceResidual = Math.abs(balance);
  }
  if (materialBalanceResidual > 1e-8) {
    return flashFailure(
      'convergence_failure',
      'материальный баланс не сошёлся: max_i |(1-beta)*x_i + beta*y_i - z_i| вне допуска 1e-8',
      'невязка = ' + String(materialBalanceResidual)
    );
  }

  // ---------- Прозрачность kij и предупреждений ----------
  const kijUsed: PengRobinsonFlashKijUsed[] = liquidResult.binaryInteractionsUsed.map((k) => ({
    componentA: k.componentA,
    componentB: k.componentB,
    kij: k.kij,
    evidence: k.evidence,
    applicabilityRangeK: k.applicabilityRangeK === null ? null : { ...k.applicabilityRangeK }
  }));
  const warningMap = new Map<string, PengRobinsonMixtureWarning>();
  for (const warning of [...liquidResult.warnings, ...vaporResult.warnings]) {
    warningMap.set(warning.code + '|' + warning.message, warning);
  }

  // ---------- Скрининг устойчивости feed существующим TPD-поиском ----------
  // Контракт TPD не ослабляется; verdict 'stable' не существует ни в
  // TPD, ни здесь. Любой исход, кроме unstable_detected, честно даёт
  // 'indeterminate'.
  const stabilityScreening = request.stabilityScreening ?? true;
  let stability: PengRobinsonFlashStabilityStatus = 'indeterminate';
  let stabilityNote: string = STABILITY_NOTE_INDETERMINATE;
  if (stabilityScreening) {
    const tpd = computePrTangentPlaneDistanceSearch({
      mixtureInputs,
      request: { temperatureK, pressurePa, root: 'vapor', evidencePolicy: policy }
    });
    if (tpd.status === 'success' && tpd.searchVerdict === 'unstable_detected') {
      stability = 'two_phase_split_indicated';
      stabilityNote = STABILITY_NOTE_SPLIT_INDICATED;
    }
  }

  const toPhaseResult = (
    success: PengRobinsonMixtureSuccess,
    fractions: number[],
    root: 'vapor' | 'liquid'
  ): PengRobinsonFlashPhaseResult => ({
    root,
    Z: success.Z,
    aMixPaM6PerMol2: success.aMixPaM6PerMol2,
    bMixM3PerMol: success.bMixM3PerMol,
    dimensionlessA: success.dimensionlessA,
    dimensionlessB: success.dimensionlessB,
    components: components.map((c, i) => {
      const cr = success.components.find((r) => r.component === c.component)!;
      return {
        component: c.component,
        moleFraction: fractions[i]!,
        lnPhi: cr.lnPhi,
        phi: cr.phi,
        fugacityPa: cr.fugacityPa
      };
    })
  });

  return {
    status: 'two_phase_candidate',
    temperatureK,
    pressurePa,
    evidencePolicy: policy,
    feedComposition: components.map((c, i) => ({ component: c.component, moleFraction: z[i]! })),
    liquidComposition: components.map((c, i) => ({ component: c.component, moleFraction: lastX![i]! })),
    vaporComposition: components.map((c, i) => ({ component: c.component, moleFraction: lastY![i]! })),
    vaporFractionBeta: lastBeta,
    liquid: toPhaseResult(liquidResult, lastX!, 'liquid'),
    vapor: toPhaseResult(vaporResult, lastY!, 'vapor'),
    kijUsed,
    warnings: [...warningMap.values()],
    fugacityEqualityResidual: {
      maxLnFugacityRatio: maxResidual,
      tolerance: fugacityTolerance,
      perComponent: components.map((c, i) => ({
        component: c.component,
        lnFugacityRatio: perComponentResidual[i]!
      }))
    },
    materialBalanceResidual,
    iterations,
    convergence: { status: 'converged', fugacityTolerance },
    stability,
    stabilityNote,
    interpretationLimitation: PENG_ROBINSON_FLASH_INTERPRETATION_LIMITATION
  };
}
