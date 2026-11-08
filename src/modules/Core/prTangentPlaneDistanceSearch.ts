// ============================================================================
// Stage 4.4.4.4.2 — MULTI-START ПОИСК МИНИМУМОВ TANGENT-PLANE DISTANCE
// ----------------------------------------------------------------------------
// Оркестрация вокруг скалярного TPD-evaluator Stage 4.4.4.4.1:
// генерация детерминированных стартовых точек, пересчёт PR-состояний
// пробной фазы, successive substitution (SS) в ненормированных
// псевдомольных переменных Michelsen Y, интервальная классификация
// знака TPD и консервативные поисковые verdicts.
//
// Спецификация: docs/science/TPD_SEARCH_DESIGN.md (включая корректирующие
// ревизии 2026-11-06 и корректировку топологии корней 2026-11-07).
// Ключевые разделы: §1 (математика g/g*), §2 (старты, масштаб Y),
// §3 (ветви корня PR), §4.3–4.4 (единый источник истины, бюджет),
// §5 (грани симплекса), §6.1–6.6 (сходимость, классы C1–C4, verdicts),
// §7.1–7.2 (контракт API), §7.3 (тест-план).
//
// СТРОГИЕ СЛЕДСТВИЯ СПЕЦИФИКАЦИИ (§6.5, четвёртая ревизия):
//  - пока validated numerical error bound НЕ установлен, НИ одна
//    точка не классифицируется как C1/C4 и ЛЮБОЙ поиск возвращает
//    verdict `indeterminate` (консервативно и осознанно);
//  - observedErrorEnvelope — ТОЛЬКО диагностический ориентир,
//    он НИКОГДА автоматически не даёт validated bound;
//  - fallback (BFGS/Newton/якобиан/line-search) УДАЛЁН из объёма
//    4.4.4.4.2 (вариант A): только SS с фиксированным бюджетом.
//
// Границы модуля (не меняются): flash/VLE/LLE/solveEquilibrium/PPR78/
// конденсированные фазы — ВНЕ объёма; контракт evaluator 4.4.4.4.1 и
// смесевого вычислителя 4.4.4.3 НЕ меняется; статус `stable` не выдаётся
// ни при каких условиях.
// ============================================================================

import { computePengRobinsonMixture, validatePengRobinsonMixtureRequest } from './pengRobinsonMixture';
import type {
  PengRobinsonMixtureInputs,
  PengRobinsonMixtureRequest,
  PengRobinsonMixtureResult,
  PengRobinsonMixtureSuccess
} from './pengRobinsonMixture';
import { computePrTangentPlaneDistance } from './prTangentPlaneDistance';
import type { PengRobinsonEvidencePolicy, PengRobinsonRootBranch } from './pengRobinson';

// ============================================
// 1. КОНСТАНТЫ, СТАТУСЫ И КОДЫ ОТКАЗОВ
// ============================================

/**
 * Лимит SS-обновлений на попытку (§6.2, предварительное значение
 * спецификации): уникальный стартовый состав × ветвь поиска.
 * Несходимость после исчерпания → outcome `max_iterations`.
 */
export const PR_TPD_SEARCH_MAX_ITERATIONS = 300;

/**
 * Допуск стационарности (§6.1): r_stat = max_i |b_i − k̂|, где
 * b_i = ln w_i + lnPhi_i(w) − h_i, k̂ = SUM w_i b_i. Инженерный
 * допуск сходимости; НЕ погрешность вычисленного TPD (§6.5).
 */
export const PR_TPD_SEARCH_SIGMA_STAT = 1e-10;

/**
 * Критерий изменения состава (§6.3) в log-space (переменные Y):
 * max_i |ln Y_i^(k+1) − ln Y_i^(k)| <= sigma_w.
 */
export const PR_TPD_SEARCH_SIGMA_W = 1e-12;

/**
 * Критерий изменения TPD (§6.4): |TPD^(k+1) − TPD^(k)| <= sigma_tpd.
 * Дополнительный стоп-сигнал стагнации суммы; НЕ даёт права на
 * заключение без §6.1 (в реализации — обязательная часть критерия
 * сходимости, консервативно).
 */
export const PR_TPD_SEARCH_SIGMA_TPD = 1e-12;

/**
 * Предварительный operational margin отрицательности (§6.5):
 * НЕУТВЕРЖДЁННОЕ предварительное значение для тестов и первой
 * реализации, НЕ научно доказанная граница. Статус фиксируется
 * отдельно (PR_TPD_SEARCH_NEGATIVE_THRESHOLD_STATUS).
 */
export const PR_TPD_SEARCH_NEGATIVE_THRESHOLD = -1e-10;

/**
 * Статус порога отрицательности: предварительное предложение,
 * подлежащее количественному аудиту до утверждения (§6.5, §8 п. 6).
 */
export const PR_TPD_SEARCH_NEGATIVE_THRESHOLD_STATUS: 'provisional_pending_error_audit' =
  'provisional_pending_error_audit';

/**
 * Устойчивые коды отказов поиска (§7.1): существующие коды слоя.
 * Никаких новых кодов не вводится.
 */
export type PrTangentPlaneDistanceSearchErrorCode =
  | 'invalid_input'
  | 'incompatible_state'
  | 'support_violation'
  | 'numerical_failure';

/** Реестр кодов отказов поиска. */
export const PR_TPD_SEARCH_ERROR_CODES: readonly PrTangentPlaneDistanceSearchErrorCode[] = [
  'invalid_input',
  'incompatible_state',
  'support_violation',
  'numerical_failure'
];

/**
 * Границы модуля (фиксация; согласовано с SCOPE_NOTE 4.4.4.4.1).
 */
export const PR_TPD_SEARCH_SCOPE_NOTE: string = [
  'Stage 4.4.4.4.2: multi-start поиск минимумов TPD для PR-смесей.',
  'Оркестрация вокруг скалярного evaluator 4.4.4.4.1; контракт evaluator',
  'и смесевого вычислителя 4.4.4.3 не меняется. Только successive',
  'substitution (вариант A, fallback вне объёма). Верdicts:',
  'unstable_detected / no_instability_found_within_search / indeterminate;',
  'статус stable не выдаётся никогда. Строгие verdicts требуют доступного',
  'validated numerical error bound; до его установления — indeterminate.',
  'Глобальная устойчивость конечным multi-start не доказывается.'
].join(' ');

// ============================================
// 2. ТИПЫ: ВЕРДИКТЫ, ПОПЫТКИ, ТОЧКИ, ДОМЕНЫ
// ============================================

/** Поисковый verdict (§6.6; имена зафиксированы, поле `stable` отсутствует). */
export type PrTpdSearchVerdict =
  | 'unstable_detected'
  | 'no_instability_found_within_search'
  | 'indeterminate';

/**
 * Явная машинно-читаемая причина verdict (§6.6: indeterminate обязан
 * иметь причину). ДОКУМЕНТИРОВАННОЕ РАСШИРЕНИЕ §7.2 (сверхконтракт).
 */
export type PrTpdSearchVerdictReason =
  | 'c1_visited_point'
  | 'all_attempts_converged_all_points_c4'
  | 'numerical_failure_attempt'
  | 'max_iterations_attempt'
  | 'invalid_start_attempt'
  | 'root_discovery_failure'
  | 'branch_initial_failure'
  | 'branch_coverage_incomplete'
  | 'partial_face_enumeration'
  | 'c2_or_c3_visited_point'
  | 'validated_bound_not_available'
  | 'no_visited_points';

/** Исход попытки (§7.2). */
export type PrTpdSearchAttemptOutcome =
  | 'converged'
  | 'max_iterations'
  | 'numerical_failure'
  | 'invalid_start';

/** Статус эмпирического envelope в точке (§6.5, §7.2). */
export type PrTpdObservedEnvelopePointStatus =
  | 'observed_envelope_in_domain'
  | 'outside_audit_domain'
  | 'pending_audit';

/** Статус validated bound в точке (§6.5, §7.2). */
export type PrTpdValidatedBoundPointStatus =
  | 'validated_bound_in_domain'
  | 'outside_validated_domain'
  | 'not_established';

/** Статус эмпирического envelope на уровне результата (§7.2). */
export type PrTpdObservedEnvelopeResultStatus = 'pending_audit' | 'observed_envelope';

/** Статус validated bound на уровне результата (§7.2). */
export type PrTpdValidatedBoundResultStatus = 'pending_validation' | 'validated';

/** Внутренний verdict предиката audit-domain (§7.2 п. 4.3). */
export type PrTpdAuditDomainVerdict = 'inside' | 'outside' | 'pending';

/** Диапазон аудита (§7.2); границы включительны; null — не установлена. */
export interface PrTpdAuditDomainRange {
  readonly min: number | null;
  readonly max: number | null;
}

/**
 * Машино-проверяемый контракт области применимости аудита (§6.5, §7.2).
 * ЧИСЛЕННЫЕ ГРАНИЦЫ ОСТАЮТСЯ null до выполнения реального аудита.
 * Дескриптор с ЛЮБЫМ null-полем или null-секцией считается
 * НЕЗАДАННЫМ/неполным → все точки получают статус 'pending_audit'.
 */
export interface PrTpdAuditDomainDescriptor {
  readonly temperatureRangeK: PrTpdAuditDomainRange | null;
  readonly pressureRangePa: PrTpdAuditDomainRange | null;
  readonly componentCountRange: PrTpdAuditDomainRange | null;
  readonly compositionConstraints: {
    readonly minNonZeroMoleFraction: number | null;
    readonly maxLargestToSmallestRatio: number | null;
  } | null;
  readonly physicalRootMode: {
    readonly twoRootCovered: boolean | null;
    readonly nearRootMergeCovered: boolean | null;
    readonly nearMergeSeparationTolerance: number | null;
    readonly multiplicityModeAvailable: boolean | null;
  } | null;
  readonly bipPolicy: {
    readonly requiredEvidencePolicy: string | null;
    readonly allowedBipSources: readonly string[] | null;
    readonly allowedBipPairIds: readonly string[] | null;
  } | null;
  readonly componentPolicy: {
    readonly allowedComponentIds: readonly string[] | null;
    readonly allowedPrInputFingerprints: readonly string[] | null;
  } | null;
}

/** PR/TPD-состояние точки для предиката audit-domain (§7.2). */
export interface PrTpdAuditDomainPoint {
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly composition: readonly number[];
  readonly physicalRootCount: number;
  readonly minPhysicalRootSeparation: number | null;
  readonly componentIds: readonly string[];
  readonly prInputFingerprint: string;
  readonly bipPairIdsUsed: readonly string[];
  readonly bipSourcesUsed: readonly string[];
  readonly evidencePolicy: string;
  readonly discriminantSign?: number | null;
}

/** Посещённая точка траектории попытки (§2.4, §7.2). */
export interface PrTpdVisitedPoint {
  /** 0 = стартовая точка попытки. */
  readonly iterationIndex: number;
  /** Нормированный состав w (полная длина, канонический порядок). */
  readonly composition: readonly number[];
  /** Фактический физический корень кубики (Z) этой точки. */
  readonly selectedRoot: number;
  /**
   * Метки корня ЭТОЙ точки (§3 п. 6–7): при одном физическом корне —
   * ОБЕ метки одного корня; при 2–3 корнях — метка фактически
   * выбранной continuation-ветви попытки.
   */
  readonly rootLabels: readonly PengRobinsonRootBranch[];
  /** Фактическое число физических корней PR в этой точке: 1, 2 или 3. */
  readonly physicalRootCount: number;
  /** TPD-оценка (tpdEstimate, §6.5) существующего evaluator 4.4.4.4.1. */
  readonly tpd: number;
  readonly tpdContributions: readonly { component: string; contribution: number }[];
  /** Эмпирический диагностический ориентир (§6.5); null — неприменим. */
  readonly observedErrorEnvelope: number | null;
  readonly observedErrorEnvelopeStatus: PrTpdObservedEnvelopePointStatus;
  /** Доказанная граница ошибки (§6.5); ТОЛЬКО она даёт классы C1–C4. */
  readonly validatedErrorBound: number | null;
  readonly validatedErrorBoundStatus: PrTpdValidatedBoundPointStatus;
}

/** Попытка поиска: уникальный стартовый состав × ветвь поиска (§3, §7.2). */
export interface PrTpdSearchAttempt {
  readonly startId: string;
  /** Подмножество supp(z) (грань) каноническими ID компонентов. */
  readonly support: readonly string[];
  /**
   * Метки НАЧАЛЬНОЙ точки попытки (§3 п. 1): при single-root старте —
   * ОБЕ метки одного корня; описывает начальную эквивалентность.
   */
  readonly logicalLabels: readonly PengRobinsonRootBranch[];
  /** 'single' — попытка начата с единственного физического корня. */
  readonly initialBranch: 'vapor' | 'liquid' | 'single';
  /** Ветвь trial request попытки (root = continuationBranch, §7.1). */
  readonly continuationBranch: PengRobinsonRootBranch;
  /** Фактический физический корень кубики (Z) начальной точки. */
  readonly selectedRoot: number;
  /** Начальная точка попытки имела единственный физический корень. */
  readonly singlePhysicalRoot: boolean;
  readonly startComposition: readonly number[];
  readonly outcome: PrTpdSearchAttemptOutcome;
  /** Число выполненных SS-обновлений (§6.2; fallback отсутствует, §2.5). */
  readonly iterations: number;
  /** Фактические PR-вызовы попытки, включая отказные (§4.4). */
  readonly prEvaluations: number;
  /** Невязка стационарности §6.1 на финальной точке; null — нет точки. */
  readonly stationarityResidual: number | null;
  /** Полная траектория (расширение §7.2; принцип §2.4). */
  readonly visitedPoints: readonly PrTpdVisitedPoint[];
  /** Минимум TPD по ВСЕЙ траектории попытки (включая промежуточные). */
  readonly bestVisitedPoint: PrTpdVisitedPoint | null;
  /** Только при outcome = 'converged' (§6.1 И §6.3; §6.4 в реализации). */
  readonly finalStationaryPoint: PrTpdVisitedPoint | null;
  readonly failureReason?: string;
}

/** Результат эмпирического аудита (§6.5): envelope + audit-domain. */
export interface PrTpdObservedEnvelopeAuditInput {
  /** Наблюдаемый максимум ошибки на audit-матрице; конечное, >= 0. */
  readonly observedErrorEnvelope: number;
  readonly auditDomain: PrTpdAuditDomainDescriptor;
}

/** Результат отдельного validated-аудита (§6.5): bound + домен. */
export interface PrTpdValidatedErrorBoundAuditInput {
  /** Математически доказанная граница ошибки; конечное, >= 0. */
  readonly validatedErrorBound: number;
  readonly validatedDomain: PrTpdAuditDomainDescriptor;
}

/** Вход поиска (§4.3, §7.1): единый источник истины входов. */
export interface PrTangentPlaneDistanceSearchInput {
  readonly mixtureInputs: PengRobinsonMixtureInputs;
  /** T/P, ветвь FEED (feedRoot) и evidencePolicy (§7.1). */
  readonly request: PengRobinsonMixtureRequest;
  /** Необязательный результат эмпирического аудита (§6.5). */
  readonly observedEnvelopeAudit?: PrTpdObservedEnvelopeAuditInput | null;
  /** Необязательный результат отдельного validated-аудита (§6.5). */
  readonly validatedErrorBoundAudit?: PrTpdValidatedErrorBoundAuditInput | null;
}

/** Успех поиска (§7.2). */
export interface PrTangentPlaneDistanceSearchResultSuccess {
  readonly status: 'success';
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
  readonly feedComposition: readonly number[];
  readonly feedRoot: PengRobinsonRootBranch;
  /** Канонический порядок: подмножество → старт → уникальный корень. */
  readonly attempts: readonly PrTpdSearchAttempt[];
  /** Минимум по ВСЕМ корректно вычисленным посещённым точкам ВСЕХ попыток. */
  readonly bestVisitedTpd: number | null;
  readonly bestVisitedPoint: { attemptIndex: number; point: PrTpdVisitedPoint } | null;
  readonly searchVerdict: PrTpdSearchVerdict;
  /**
   * Явная машинно-читаемая причина verdict (§6.6: indeterminate обязан
   * иметь причину). ДОКУМЕНТИРОВАННОЕ РАСШИРЕНИЕ §7.2 (сверхконтракт).
   */
  readonly verdictReason: PrTpdSearchVerdictReason;
  readonly negativeThreshold: number;
  readonly negativeThresholdStatus: 'provisional_pending_error_audit';
  readonly branchCoverageComplete: boolean;
  readonly observedErrorEnvelope: number | null;
  readonly observedErrorEnvelopeStatus: PrTpdObservedEnvelopeResultStatus;
  readonly auditDomain: PrTpdAuditDomainDescriptor | null;
  readonly validatedErrorBound: number | null;
  readonly validatedErrorBoundStatus: PrTpdValidatedBoundResultStatus;
  readonly validatedDomain: PrTpdAuditDomainDescriptor | null;
  readonly faceEnumeration: 'complete' | 'partial';
  /**
   * Явный перечень обследованных подмножеств носителя каноническими ID
   * (§5 п. 4; полный носитель первым). РАСШИРЕНИЕ §7.2.
   */
  readonly examinedSubsets: readonly (readonly string[])[];
  readonly counts: {
    faceCount: number;
    attemptCount: number;
    prEvaluations: number;
    maxPrEvaluations: number;
  };
  readonly notes: readonly string[];
}

/** Отказ поиска (§7.1): существующие коды слоя. */
export interface PrTangentPlaneDistanceSearchResultFailure {
  readonly status: 'failure';
  readonly code: PrTangentPlaneDistanceSearchErrorCode;
  readonly message: string;
  readonly detail?: string;
}

/** Discriminated union результата поиска. */
export type PrTangentPlaneDistanceSearchResult =
  | PrTangentPlaneDistanceSearchResultSuccess
  | PrTangentPlaneDistanceSearchResultFailure;

// ============================================
// 3. SHA-256 И КАНОНИЧЕСКИЙ FINGERPRINT PR-ВХОДА
// ============================================
// (§7.2 п. 4.2: идентичность EOS/BIP-набора проверяется ТОЛЬКО
// побитовым равенством fingerprint канонической сериализации.)

/** Проверка «конечное число». */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isNonNullObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Компенсированная сумма Neumaier (та же схема, что в evaluator 4.4.4.4.1). */
function neumaierSum(values: readonly number[]): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const t = sum + value;
    if (Math.abs(sum) >= Math.abs(value)) {
      compensation += (sum - t) + value;
    } else {
      compensation += (value - t) + sum;
    }
    sum = t;
  }
  return sum + compensation;
}

/** UTF-8 кодирование строки в массив байтов (без TextEncoder). */
function utf8Bytes(message: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i += 1) {
    const code = message.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = i + 1 < message.length ? message.charCodeAt(i + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        const point = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f)
        );
        i += 1;
      } else {
        bytes.push(0xef, 0xbf, 0xbd);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes.push(0xef, 0xbf, 0xbd);
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

/** Циклический сдвиг 32-битного слова вправо. */
function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** SHA-256, hex (lowercase). Стандартная однопроходная реализация. */
export function prTpdSearchSha256Hex(message: string): string {
  const bytes = utf8Bytes(message);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  // big-endian 64-битная длина исходного сообщения в битах
  const lenBytes: number[] = [];
  let rem = bitLength;
  for (let i = 0; i < 8; i += 1) {
    lenBytes.unshift(rem & 0xff);
    rem = Math.floor(rem / 256);
  }
  bytes.push(...lenBytes);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Array(64);
  for (let block = 0; block < bytes.length; block += 64) {
    for (let t = 0; t < 16; t += 1) {
      w[t] =
        (bytes[block + t * 4] << 24) |
        (bytes[block + t * 4 + 1] << 16) |
        (bytes[block + t * 4 + 2] << 8) |
        bytes[block + t * 4 + 3];
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr32(w[t - 15], 7) ^ rotr32(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr32(w[t - 2], 17) ^ rotr32(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + PR_TPD_SEARCH_SHA256_K[t] + w[t]) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const hex = (x: number): string => x.toString(16).padStart(8, '0');
  return (
    hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7)
  );
}

/** Таблица констант раундов SHA-256 (K_t). */
const PR_TPD_SEARCH_SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

/** Канонический ключ пары компонентов («i|j», лексикографически). */
function canonicalPairKey(componentA: string, componentB: string): string {
  return componentA < componentB
    ? componentA + '|' + componentB
    : componentB + '|' + componentA;
}

/**
 * Канонический fingerprint ПОЛНОГО PR-входа (§7.2 п. 4.2):
 * компоненты сортируются по каноническому идентификатору; для каждого —
 * фактические Tc/Pc/omega (moleFraction НЕ входит: состав проверяется
 * отдельно compositionConstraints), per-field evidence, crossChecks и
 * limitations; binaryInteractions сортируются по каноническому pair ID
 * (kij, evidence, applicabilityRangeK). Каноническая сериализация —
 * JSON с фиксированным порядком ключей (JSON.stringify сохраняет
 * порядок вставки, числа — через Number.prototype.toString, без
 * локали); fingerprint = SHA-256 сериализованной строки.
 *
 * Контракт: вход предполагается ВАЛИДИРОВАННЫМ (конечные значения);
 * fingerprint некорректных входов не определяется (не используется).
 */
export function canonicalPrInputFingerprint(inputs: PengRobinsonMixtureInputs): string {
  const components = [...inputs.components].sort((left, right) =>
    left.component < right.component ? -1 : left.component > right.component ? 1 : 0
  );
  const binaryInteractions = [...inputs.binaryInteractions].sort((left, right) => {
    const keyLeft = canonicalPairKey(left.componentA, left.componentB);
    const keyRight = canonicalPairKey(right.componentA, right.componentB);
    return keyLeft < keyRight ? -1 : keyLeft > keyRight ? 1 : 0;
  });
  const canonical = {
    v: 1,
    components: components.map((component) => ({
      component: component.component,
      criticalTemperatureK: component.criticalTemperatureK,
      criticalPressurePa: component.criticalPressurePa,
      acentricFactor: component.acentricFactor,
      evidence: {
        criticalTemperatureK: component.evidence.criticalTemperatureK,
        criticalPressurePa: component.evidence.criticalPressurePa,
        acentricFactor: component.evidence.acentricFactor
      },
      crossChecks: component.crossChecks.map((check) => ({
        subject: check.subject,
        catalogValue: check.catalogValue,
        crossSource: check.crossSource,
        crossValue: check.crossValue,
        outcome: check.outcome,
        resolution: check.resolution
      })),
      limitations: [...component.limitations]
    })),
    binaryInteractions: binaryInteractions.map((bip) => ({
      pair: canonicalPairKey(bip.componentA, bip.componentB),
      kij: bip.kij,
      evidence: bip.evidence,
      applicabilityRangeK:
        bip.applicabilityRangeK === null
          ? null
          : {
              minTemperatureK: bip.applicabilityRangeK.minTemperatureK,
              maxTemperatureK: bip.applicabilityRangeK.maxTemperatureK
            }
    }))
  };
  return prTpdSearchSha256Hex(JSON.stringify(canonical));
}

// ============================================
// 4. ПРЕДИКАТ AUDIT-DOMAIN (§6.5, §7.2 п. 4.3)
// ============================================

/**
 * Полный (заданный и осмысленный) дескриптор домена аудита: все секции
 * не-null, числовые поля конечны. Уточнённый тип после guard-проверки
 * isCompleteAuditDomainDescriptor (type predicate): сужение для
 * strictNullChecks в evaluatePrTpdAuditDomain; runtime-значения
 * идентичны PrTpdAuditDomainDescriptor (проверка полноты — та же).
 */
interface PrTpdCompleteAuditDomainDescriptor {
  readonly temperatureRangeK: { readonly min: number; readonly max: number };
  readonly pressureRangePa: { readonly min: number; readonly max: number };
  readonly componentCountRange: { readonly min: number; readonly max: number };
  readonly compositionConstraints: {
    readonly minNonZeroMoleFraction: number;
    readonly maxLargestToSmallestRatio: number;
  };
  readonly physicalRootMode: {
    readonly twoRootCovered: boolean;
    readonly nearRootMergeCovered: boolean;
    readonly nearMergeSeparationTolerance: number;
    readonly multiplicityModeAvailable: boolean;
  };
  readonly bipPolicy: {
    readonly requiredEvidencePolicy: string;
    readonly allowedBipSources: readonly string[];
    readonly allowedBipPairIds: readonly string[];
  };
  readonly componentPolicy: {
    readonly allowedComponentIds: readonly string[];
    readonly allowedPrInputFingerprints: readonly string[];
  };
}

/**
 * Проверка полноты дескриптора домена аудита: ЛЮБОЕ null-поле или
 * null-секция (включая не-массивы там, где ожидается массив) делает
 * дескриптор незаданным → все точки получают 'pending'. Числовые
 * поля должны быть конечными и осмысленными (min <= max, допуск
 * слияния > 0, minNonZeroMoleFraction > 0, ratio-ограничение >= 1).
 */
function isCompleteAuditDomainDescriptor(domain: PrTpdAuditDomainDescriptor): domain is PrTpdCompleteAuditDomainDescriptor {
  if (
    domain.temperatureRangeK === null ||
    domain.pressureRangePa === null ||
    domain.componentCountRange === null ||
    domain.compositionConstraints === null ||
    domain.physicalRootMode === null ||
    domain.bipPolicy === null ||
    domain.componentPolicy === null
  ) {
    return false;
  }
  const temperatureRangeK = domain.temperatureRangeK;
  const pressureRangePa = domain.pressureRangePa;
  const componentCountRange = domain.componentCountRange;
  const compositionConstraints = domain.compositionConstraints;
  const physicalRootMode = domain.physicalRootMode;
  const bipPolicy = domain.bipPolicy;
  const componentPolicy = domain.componentPolicy;
  if (
    !isFiniteNumber(temperatureRangeK.min) ||
    !isFiniteNumber(temperatureRangeK.max) ||
    !isFiniteNumber(pressureRangePa.min) ||
    !isFiniteNumber(pressureRangePa.max) ||
    !isFiniteNumber(componentCountRange.min) ||
    !isFiniteNumber(componentCountRange.max)
  ) {
    return false;
  }
  if (
    temperatureRangeK.min > temperatureRangeK.max ||
    pressureRangePa.min > pressureRangePa.max ||
    componentCountRange.min > componentCountRange.max
  ) {
    return false;
  }
  if (
    !isFiniteNumber(compositionConstraints.minNonZeroMoleFraction) ||
    !isFiniteNumber(compositionConstraints.maxLargestToSmallestRatio) ||
    compositionConstraints.minNonZeroMoleFraction <= 0 ||
    compositionConstraints.maxLargestToSmallestRatio < 1
  ) {
    return false;
  }
  if (
    physicalRootMode.twoRootCovered === null ||
    physicalRootMode.nearRootMergeCovered === null ||
    !isFiniteNumber(physicalRootMode.nearMergeSeparationTolerance) ||
    physicalRootMode.nearMergeSeparationTolerance <= 0 ||
    physicalRootMode.multiplicityModeAvailable === null
  ) {
    return false;
  }
  if (
    bipPolicy.requiredEvidencePolicy === null ||
    !Array.isArray(bipPolicy.allowedBipSources) ||
    !Array.isArray(bipPolicy.allowedBipPairIds)
  ) {
    return false;
  }
  if (
    !Array.isArray(componentPolicy.allowedComponentIds) ||
    !Array.isArray(componentPolicy.allowedPrInputFingerprints)
  ) {
    return false;
  }
  return true;
}

/**
 * Строгий предикат принадлежности точки audit-domain (§6.5, §7.2 п. 4.3):
 *
 *  - 'pending': дескриптор не задан полностью/осмысленно (никакая точка
 *    не может быть классифицирована — статус точки pending_audit);
 *  - 'outside': точка ВЫПАДАЕТ из области применимости аудита
 *    (диагностический статус, не отказ вычисления);
 *  - 'inside': точка принадлежит домену.
 *
 * Порядок проверок: полнота дескриптора → конечность чисел точки →
 * T/P (положительные, внутри диапазонов включительно) → число
 * компонентов (целое, в диапазоне; состав согласован с ID) → состав
 * (без отрицательных долей; каждая ненулевая доля не меньше
 * minNonZeroMoleFraction; отношение наибольшей к наименьшей ненулевой
 * доле не превосходит maxLargestToSmallestRatio) → строгий режим
 * физических корней (см. ниже) → fingerprint PR-входа, ID компонентов,
 * пары и источники BIP побитово/множественно разрешены →
 * evidencePolicy совпадает с требуемой.
 *
 * Режим корней (депрессированный дискриминант D = (q/2)^2 + (p/3)^3
 * смесевого вычислителя: D>0 — ровно один действительный корень,
 * D=0 — кратный корень, D<0 — ровно три различных действительных):
 *  - count=3: разделение minPhysicalRootSeparation обязано быть
 *    конечным > 0; при sep >= tol требуется twoRootCovered=true,
 *    при sep < tol — nearRootMergeCovered=true;
 *  - count=1: minPhysicalRootSeparation ОБЯЗАН быть null; при
 *    multiplicityModeAvailable=true дополнительно по знаку D:
 *    D>0 — консистентно (внутри, если остальное прошло); D=0 —
 *    требуется nearRootMergeCovered=true; D<0 — 'outside'
 *    (консервативно: near-merge среди нефизических корней
 *    недоказуем);
 *  - count=2: minPhysicalRootSeparation ОБЯЗАН быть конечным; при
 *    multiplicityModeAvailable=true по знаку D: D>0 — 'outside'
 *    (противоречие: действительный корень один); D=0 — требуется
 *    nearRootMergeCovered=true; D<0 — тест разделения как для
 *    count=3 (между двумя физическими корнями);
 *  - при multiplicityModeAvailable=false режимы count=1/2 не
 *    покрываются аудитом → 'outside';
 *  - count вне {1,2,3} → 'outside'.
 */
export function evaluatePrTpdAuditDomain(
  point: PrTpdAuditDomainPoint,
  domain: PrTpdAuditDomainDescriptor
): PrTpdAuditDomainVerdict {
  if (!isCompleteAuditDomainDescriptor(domain)) {
    return 'pending';
  }
  const temperatureRangeK = domain.temperatureRangeK;
  const pressureRangePa = domain.pressureRangePa;
  const componentCountRange = domain.componentCountRange;
  const compositionConstraints = domain.compositionConstraints;
  const physicalRootMode = domain.physicalRootMode;
  const bipPolicy = domain.bipPolicy;
  const componentPolicy = domain.componentPolicy;

  // (2) конечность чисел точки; состав согласован с ID и не пуст.
  if (!isFiniteNumber(point.temperatureK) || !isFiniteNumber(point.pressurePa)) {
    return 'outside';
  }
  if (!Array.isArray(point.composition) || point.composition.length === 0) {
    return 'outside';
  }
  if (point.composition.length !== point.componentIds.length) {
    return 'outside';
  }
  for (let i = 0; i < point.composition.length; i += 1) {
    if (!isFiniteNumber(point.composition[i])) {
      return 'outside';
    }
  }
  const uniqueIds = new Set(point.componentIds);
  if (uniqueIds.size !== point.componentIds.length) {
    return 'outside';
  }

  // (4) положительные T/P внутри диапазонов (включительно).
  if (
    point.temperatureK <= 0 ||
    point.pressurePa <= 0 ||
    point.temperatureK < temperatureRangeK.min ||
    point.temperatureK > temperatureRangeK.max ||
    point.pressurePa < pressureRangePa.min ||
    point.pressurePa > pressureRangePa.max
  ) {
    return 'outside';
  }

  // (5) число компонентов: целое, в диапазоне.
  const componentCount = point.componentIds.length;
  if (
    !Number.isInteger(componentCount) ||
    componentCount < componentCountRange.min ||
    componentCount > componentCountRange.max
  ) {
    return 'outside';
  }

  // (6) ограничения состава: без отрицательных долей; каждая ненулевая
  // доля >= minNonZeroMoleFraction; max/min ненулевых долей <= лимита.
  let smallestNonZero = Number.POSITIVE_INFINITY;
  let largestNonZero = 0;
  for (let i = 0; i < point.composition.length; i += 1) {
    const fraction = point.composition[i];
    if (fraction < 0) {
      return 'outside';
    }
    if (fraction !== 0) {
      if (fraction < compositionConstraints.minNonZeroMoleFraction) {
        return 'outside';
      }
      if (fraction > largestNonZero) {
        largestNonZero = fraction;
      }
      if (fraction < smallestNonZero) {
        smallestNonZero = fraction;
      }
    }
  }
  if (largestNonZero === 0 || smallestNonZero === Number.POSITIVE_INFINITY) {
    return 'outside';
  }
  const largestToSmallestRatio = largestNonZero / smallestNonZero;
  if (largestToSmallestRatio > compositionConstraints.maxLargestToSmallestRatio) {
    return 'outside';
  }

  // (7) строгий режим топологии физических корней.
  const physicalRootCount = point.physicalRootCount;
  const separation = point.minPhysicalRootSeparation;
  if (physicalRootCount === 3) {
    if (!isFiniteNumber(separation) || separation <= 0) {
      return 'outside';
    }
    if (separation >= physicalRootMode.nearMergeSeparationTolerance) {
      if (physicalRootMode.twoRootCovered !== true) {
        return 'outside';
      }
    } else if (physicalRootMode.nearRootMergeCovered !== true) {
      return 'outside';
    }
  } else if (physicalRootCount === 1 || physicalRootCount === 2) {
    if (physicalRootMode.multiplicityModeAvailable !== true) {
      return 'outside';
    }
    if (physicalRootCount === 1 && separation !== null) {
      return 'outside';
    }
    if (physicalRootCount === 2 && !isFiniteNumber(separation)) {
      return 'outside';
    }
    const discriminantSign =
      point.discriminantSign === undefined ? null : point.discriminantSign;
    if (discriminantSign !== -1 && discriminantSign !== 0 && discriminantSign !== 1) {
      return 'outside';
    }
    if (discriminantSign === 0) {
      if (physicalRootMode.nearRootMergeCovered !== true) {
        return 'outside';
      }
    } else if (discriminantSign > 0) {
      if (physicalRootCount !== 1) {
        return 'outside';
      }
    } else {
      // D < 0: ровно три различных действительных корня, кратность
      // исключена (D != 0). Запас до поверхности D = 0 на непрерывной
      // области не проверяем ни при D > 0, ни при D < 0 — симметрично.
      if (physicalRootCount === 1) {
        // Единственный физический корень: near-merge определён по
        // min попарного расстояния ФИЗИЧЕСКИХ корней (п. 4.1), пар
        // физических корней нет — режим near-merge неприменим,
        // ветвь выбора единственна; нефизические корни (Z <= B) в
        // evaluator 4.4.4.4.1 не входят.
      } else {
        // physicalRootCount === 2: пара физических корней из трёх
        // действительных — режим проверяем по separation.
        if (!isFiniteNumber(separation) || separation <= 0) {
          return 'outside';
        }
        if (separation >= physicalRootMode.nearMergeSeparationTolerance) {
          if (physicalRootMode.twoRootCovered !== true) {
            return 'outside';
          }
        } else if (physicalRootMode.nearRootMergeCovered !== true) {
          return 'outside';
        }
      }
    }
  } else {
    return 'outside';
  }

  // (8) идентичность EOS/BIP-набора и политики: fingerprint побитово
  // входит в разрешённый список; ID компонентов, пары BIP и источники
  // BIP — подмножества разрешённых.
  if (!componentPolicy.allowedPrInputFingerprints.includes(point.prInputFingerprint)) {
    return 'outside';
  }
  for (const componentId of point.componentIds) {
    if (!componentPolicy.allowedComponentIds.includes(componentId)) {
      return 'outside';
    }
  }
  for (const pairId of point.bipPairIdsUsed) {
    if (!bipPolicy.allowedBipPairIds.includes(pairId)) {
      return 'outside';
    }
  }
  for (const source of point.bipSourcesUsed) {
    if (!bipPolicy.allowedBipSources.includes(source)) {
      return 'outside';
    }
  }

  // (9) политика доказательности совпадает с требуемой.
  if (point.evidencePolicy !== bipPolicy.requiredEvidencePolicy) {
    return 'outside';
  }

  return 'inside';
}

/**
 * Удобный булев предикат: точка полностью внутри audit-domain
 * (§7.2 п. 4.3; 'pending' здесь НЕ проходит — домен обязан быть
 * задан и точка обязана принадлежать ему).
 */
export function isWithinAuditDomain(
  point: PrTpdAuditDomainPoint,
  domain: PrTpdAuditDomainDescriptor
): boolean {
  return evaluatePrTpdAuditDomain(point, domain) === 'inside';
}

// ============================================
// 5. ИНТЕРВАЛЬНАЯ КЛАССИФИКАЦИЯ ЗНАКА TPD (§6.6)
// ============================================

/**
 * Класс интервала знака TPD (§6.6):
 *  - C1: U < t_neg — доказанная отрицательность;
 *  - C2: t_neg <= U < 0 — отрицательность без margin;
 *  - C3: L < 0 <= U — знак не определён;
 *  - C4: L >= 0 — доказанная неотрицательность;
 * где [L, U] = [tpd - bound, tpd + bound] при доступном validated
 * bound, иначе вырожденный интервал [tpd, tpd].
 */
export type PrTpdIntervalClass = 'C1' | 'C2' | 'C3' | 'C4';

/**
 * Классификация знака TPD по интервальной арифметике (§6.6).
 *
 * Контракт: tpd — конечное число; validatedErrorBound — null или
 * конечное >= 0 (некорректный bound трактуется как null); tNeg —
 * null/неконечный (тогда C2 недостижим: U < 0 → C1) или конечный.
 * Неконечный tpd классифицируется КОНСЕРВАТИВНО как C3 (никогда
 * не даёт ни C1, ни C4).
 */
export function classifyPrTpdInterval(
  tpd: number,
  validatedErrorBound: number | null,
  negativeThreshold: number | null
): PrTpdIntervalClass {
  if (!isFiniteNumber(tpd)) {
    return 'C3';
  }
  const bound =
    validatedErrorBound !== null &&
    isFiniteNumber(validatedErrorBound) &&
    validatedErrorBound >= 0
      ? validatedErrorBound
      : null;
  const lower = bound === null ? tpd : tpd - bound;
  const upper = bound === null ? tpd : tpd + bound;
  const tNeg = negativeThreshold !== null && isFiniteNumber(negativeThreshold)
    ? negativeThreshold
    : null;
  if (tNeg !== null ? upper < tNeg : upper < 0) {
    return 'C1';
  }
  if (upper < 0) {
    return 'C2';
  }
  if (lower < 0) {
    return 'C3';
  }
  return 'C4';
}

// ============================================
// 6. ПЕРЕЧИСЛЕНИЕ ПОДМНОЖЕСТВ НОСИТЕЛЯ И ГЕНЕРАЦИЯ СТАРТОВ (§2.1, §5)
// ============================================

/** Массив нулей заданной длины (без generic-конструкторов). */
function zeros(length: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < length; i += 1) {
    result.push(0);
  }
  return result;
}

/** Побитое сравнение составов одинаковой длины. */
function bitwiseEqualComposition(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

/** Число установленных битов маски. */
function popcount32(mask: number): number {
  let value = mask;
  let count = 0;
  while (value > 0) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

/** Рекурсивный генератор сочетаний в лексикографическом порядке. */
function combinationSuffixes(
  support: readonly string[],
  size: number,
  start: number,
  current: string[],
  out: string[][]
): void {
  if (current.length === size) {
    out.push([...current]);
    return;
  }
  for (let i = start; i < support.length; i += 1) {
    current.push(support[i]);
    combinationSuffixes(support, size, i + 1, current, out);
    current.pop();
  }
}

/**
 * Локальное перечисление подмножеств носителя supp(z) (§5):
 * полный носитель ВСЕГДА первым, затем непустые собственные
 * подмножества. s = |supp(z)| <= 5: полный обход масок (порядок —
 * убывание размера, внутри размера лексикографически), complete=true.
 * s > 5: только сочетания размеров s-1 и s-2 (лексикографически
 * внутри размера), complete=false (частичное перечисление).
 * s = 1: только сам носитель.
 */
function enumerateSubsetsLocal(
  support: readonly string[]
): { subsets: readonly (readonly string[])[]; complete: boolean } {
  const s = support.length;
  if (s === 0) {
    return { subsets: [], complete: true };
  }
  const subsets: string[][] = [];
  if (s <= 5) {
    const total = (1 << s) - 1;
    for (let size = s; size >= 1; size -= 1) {
      for (let mask = 1; mask <= total; mask += 1) {
        if (popcount32(mask) !== size) {
          continue;
        }
        const subset: string[] = [];
        for (let i = 0; i < s; i += 1) {
          if ((mask & (1 << i)) !== 0) {
            subset.push(support[i]);
          }
        }
        subsets.push(subset);
      }
    }
    return { subsets, complete: true };
  }
  subsets.push([...support]);
  for (let size = s - 1; size >= s - 2 && size >= 1; size -= 1) {
    combinationSuffixes(support, size, 0, [], subsets);
  }
  return { subsets, complete: false };
}

/** Стартовый кандидат (§2.1): состав w и лог-псевдомоли Y (масштаб Y). */
interface PrTpdStartCandidate {
  readonly startId: string;
  /** Нормированный состав полной длины (канонический порядок). */
  readonly w: readonly number[];
  /**
   * Логарифмы ненормированных псевдомолей Y (масштаб Y сохраняется
   * как переменная итерации; в PR/evaluator входит ТОЛЬКО w).
   */
  readonly lnY0: readonly number[];
  /** Предпочитаемая ветвь начального корня; null — нейтральный старт. */
  readonly intendedBranch: PengRobinsonRootBranch | null;
}

/** Противоположная ветвь. */
function oppositeBranch(branch: PengRobinsonRootBranch): PengRobinsonRootBranch {
  return branch === 'vapor' ? 'liquid' : 'vapor';
}

/**
 * Генерация стартовых кандидатов подмножества (§2.1, шесть видов):
 * feed (нормированное z|_S; на полном носителе — побитово z),
 * feed_alternative_branch (ТОЛЬКО полный носитель и только при
 * hasDistinctBranches у feed), wilson_z_times_k, wilson_z_over_k
 * (оба направления Wilson обязательны), uniform, pair_{i}_{j}
 * (лексикографические пары; только при |S| >= 2). Все имена
 * нейтральны; eps-подстановок нет. Wilson-кандидаты, чей Y0
 * переполняет binary64, пропускаются с комментарием в коде
 * (экстремальные Pc/T; для реальных смесей не встречается).
 */
function generateStartCandidates(
  subset: readonly string[],
  isFullSupport: boolean,
  z: readonly number[],
  lnK: readonly number[],
  componentCount: number,
  idToCanonicalIndex: ReadonlyMap<string, number>,
  feedRoot: PengRobinsonRootBranch,
  feedHasDistinctBranches: boolean
): PrTpdStartCandidate[] {
  const candidates: PrTpdStartCandidate[] = [];
  const activeIdx: number[] = [];
  for (const id of subset) {
    const canonicalIndex = idToCanonicalIndex.get(id);
    if (canonicalIndex !== undefined) {
      activeIdx.push(canonicalIndex);
    }
  }
  if (activeIdx.length === 0) {
    return candidates;
  }
  const subsetLabel = subset.join('+');

  // feed: z, ограниченное на S и нормированное; на полном носителе z
  // побитово (сумма носителя уже 1).
  const feedW = zeros(componentCount);
  const feedLnY = zeros(componentCount);
  let subsetSum = 0;
  for (const i of activeIdx) {
    subsetSum += z[i];
  }
  for (const i of activeIdx) {
    feedW[i] = isFullSupport ? z[i] : z[i] / subsetSum;
    feedLnY[i] = Math.log(feedW[i]);
  }
  candidates.push({
    startId: subsetLabel + ':feed',
    w: [...feedW],
    lnY0: [...feedLnY],
    intendedBranch: feedRoot
  });
  if (isFullSupport && feedHasDistinctBranches) {
    candidates.push({
      startId: subsetLabel + ':feed_alternative_branch',
      w: [...feedW],
      lnY0: [...feedLnY],
      intendedBranch: oppositeBranch(feedRoot)
    });
  }

  // Wilson z*K и z/K: ln Y_i = ln(z_i|_S) +/- ln K_i; в PR входит только
  // нормированный w = Y/sumY; масштаб Y сохраняется в lnY0.
  for (const direction of [1, -1]) {
    const wilsonW = zeros(componentCount);
    const wilsonLnY = zeros(componentCount);
    const yValues: number[] = [];
    for (const i of activeIdx) {
      wilsonLnY[i] = Math.log(z[i]) + direction * lnK[i];
      yValues.push(Math.exp(wilsonLnY[i]));
    }
    const sumY = neumaierSum(yValues);
    if (isFiniteNumber(sumY) && sumY > 0) {
      let finiteComposition = true;
      for (const i of activeIdx) {
        wilsonW[i] = Math.exp(wilsonLnY[i]) / sumY;
        if (!isFiniteNumber(wilsonW[i])) {
          finiteComposition = false;
          break;
        }
      }
      if (finiteComposition) {
        candidates.push({
          startId:
            subsetLabel + (direction === 1 ? ':wilson_z_times_k' : ':wilson_z_over_k'),
          w: wilsonW,
          lnY0: [...wilsonLnY],
          intendedBranch: null
        });
      }
      // Неконечный Wilson-старт (переполнение exp) пропускается:
      // eps-подстановки запрещены §2.1, состав не существует в binary64.
    }
  }

  // uniform.
  const uniformW = zeros(componentCount);
  const uniformLnY = zeros(componentCount);
  const uniformFraction = 1 / activeIdx.length;
  for (const i of activeIdx) {
    uniformW[i] = uniformFraction;
    uniformLnY[i] = Math.log(uniformFraction);
  }
  candidates.push({
    startId: subsetLabel + ':uniform',
    w: uniformW,
    lnY0: uniformLnY,
    intendedBranch: null
  });

  // pair_{i}_{j}: лексикографические пары подмножества, 0.5/0.5.
  if (subset.length >= 2) {
    for (let a = 0; a < subset.length; a += 1) {
      for (let b = a + 1; b < subset.length; b += 1) {
        const pairW = zeros(componentCount);
        const pairLnY = zeros(componentCount);
        const indexA = activeIdx[a];
        const indexB = activeIdx[b];
        pairW[indexA] = 0.5;
        pairW[indexB] = 0.5;
        pairLnY[indexA] = Math.log(0.5);
        pairLnY[indexB] = Math.log(0.5);
        candidates.push({
          startId: subsetLabel + ':pair_' + subset[a] + '_' + subset[b],
          w: pairW,
          lnY0: pairLnY,
          intendedBranch: null
        });
      }
    }
  }
  return candidates;
}

/**
 * Представитель уникального состава для ветви: ПЕРВЫЙ кандидат в
 * каноническом порядке с intendedBranch === null либо === branch
 * (feed → feedRoot-ветвь; feed_alternative_branch → противоположная
 * ветвь на полном носителе; uniform/wilson/pair — нейтральные).
 */
function findRepresentative(
  candidates: readonly PrTpdStartCandidate[],
  branch: PengRobinsonRootBranch
): PrTpdStartCandidate {
  for (const candidate of candidates) {
    if (candidate.intendedBranch === null || candidate.intendedBranch === branch) {
      return candidate;
    }
  }
  return candidates[0];
}

// ============================================
// 7. PR-ВЫЗОВЫ, ТОЧКА АУДИТА И ПОСТРОЕНИЕ ПОСЕЩЁННЫХ ТОЧЕК
// ============================================

/** Общий контекст поиска (§4.3: единый источник истины входов). */
interface PrTpdSearchContext {
  readonly mixtureInputs: PengRobinsonMixtureInputs;
  readonly request: PengRobinsonMixtureRequest;
  /** Канонические ID всех компонентов (лексикографически). */
  readonly canonicalIds: readonly string[];
  readonly idToCanonicalIndex: ReadonlyMap<string, number>;
  readonly feedState: PengRobinsonMixtureSuccess;
  readonly fingerprint: string;
  readonly bipPairIdsUsed: readonly string[];
  readonly bipSourcesUsed: readonly string[];
  readonly observedEnvelopeAudit: PrTpdObservedEnvelopeAuditInput | null;
  readonly validatedErrorBoundAudit: PrTpdValidatedErrorBoundAuditInput | null;
}

/**
 * Вызов смесевого вычислителя в пробном составе (канонический
 * порядок отображается на порядок components исходного входа;
 * состав — полной длины с нулями вне подмножества). Считается
 * отдельной PR-оценкой бюджета §4.4, включая отказные вызовы.
 */
function callMixtureAtComposition(
  context: PrTpdSearchContext,
  composition: readonly number[],
  root: PengRobinsonRootBranch
): PengRobinsonMixtureResult {
  const components = context.mixtureInputs.components.map((component) => {
    const canonicalIndex = context.idToCanonicalIndex.get(component.component);
    return {
      ...component,
      moleFraction:
        canonicalIndex === undefined ? component.moleFraction : composition[canonicalIndex]
    };
  });
  return computePengRobinsonMixture(
    { ...context.mixtureInputs, components },
    { ...context.request, root }
  );
}

/**
 * Точка предиката audit-domain из фактического PR-состояния пробы
 * (§7.2 п. 4.3): состав — канонический вектор полной длины, число
 * физических корней — distinctPhysicalRootCount, разделение —
 * минимальная разность соседних физических корней (null при
 * единственном), знак депрессированного дискриминанта — из
 * состояния смесевого вычислителя.
 */
function buildAuditDomainPoint(
  trialState: PengRobinsonMixtureSuccess,
  composition: readonly number[],
  context: PrTpdSearchContext
): PrTpdAuditDomainPoint {
  const physicalRoots = trialState.physicalRoots;
  let minPhysicalRootSeparation: number | null = null;
  if (physicalRoots.length >= 2) {
    minPhysicalRootSeparation = Number.POSITIVE_INFINITY;
    for (let i = 1; i < physicalRoots.length; i += 1) {
      const difference = physicalRoots[i] - physicalRoots[i - 1];
      if (difference < minPhysicalRootSeparation) {
        minPhysicalRootSeparation = difference;
      }
    }
  }
  return {
    temperatureK: trialState.temperatureK,
    pressurePa: trialState.pressurePa,
    composition,
    physicalRootCount: trialState.distinctPhysicalRootCount,
    minPhysicalRootSeparation,
    componentIds: context.canonicalIds,
    prInputFingerprint: context.fingerprint,
    bipPairIdsUsed: context.bipPairIdsUsed,
    bipSourcesUsed: context.bipSourcesUsed,
    evidencePolicy: trialState.evidencePolicy,
    discriminantSign: trialState.discriminantSign
  };
}

/** Статусы аудита точки, вычисляемые предикатом домена. */
interface PrTpdPointAuditFields {
  readonly observedErrorEnvelope: number | null;
  readonly observedErrorEnvelopeStatus: PrTpdObservedEnvelopePointStatus;
  readonly validatedErrorBound: number | null;
  readonly validatedErrorBoundStatus: PrTpdValidatedBoundPointStatus;
}

/**
 * Статусы аудита точки (§6.5): ОБЕ ветви (envelope и validated
 * bound) используют ОДИН И ТОТ ЖЕ строгий предикат домена
 * (isWithinAuditDomain: полные 9 проверок, включая fingerprint,
 * BIP-политику и evidencePolicy). 'pending' домена → точка
 * остаётся pending_audit/not_established; значение аудита
 * привязывается ТОЛЬКО к точкам 'inside'.
 */
function applyPointAudit(
  domainPoint: PrTpdAuditDomainPoint,
  observedEnvelopeAudit: PrTpdObservedEnvelopeAuditInput | null,
  validatedErrorBoundAudit: PrTpdValidatedErrorBoundAuditInput | null
): PrTpdPointAuditFields {
  let observedErrorEnvelope: number | null = null;
  let observedErrorEnvelopeStatus: PrTpdObservedEnvelopePointStatus = 'pending_audit';
  if (observedEnvelopeAudit !== null) {
    const verdict = evaluatePrTpdAuditDomain(domainPoint, observedEnvelopeAudit.auditDomain);
    if (verdict === 'inside') {
      observedErrorEnvelope = observedEnvelopeAudit.observedErrorEnvelope;
      observedErrorEnvelopeStatus = 'observed_envelope_in_domain';
    } else if (verdict === 'outside') {
      observedErrorEnvelopeStatus = 'outside_audit_domain';
    }
  }
  let validatedErrorBound: number | null = null;
  let validatedErrorBoundStatus: PrTpdValidatedBoundPointStatus = 'not_established';
  if (validatedErrorBoundAudit !== null) {
    const verdict = evaluatePrTpdAuditDomain(
      domainPoint,
      validatedErrorBoundAudit.validatedDomain
    );
    if (verdict === 'inside') {
      validatedErrorBound = validatedErrorBoundAudit.validatedErrorBound;
      validatedErrorBoundStatus = 'validated_bound_in_domain';
    } else if (verdict === 'outside') {
      validatedErrorBoundStatus = 'outside_validated_domain';
    }
  }
  return {
    observedErrorEnvelope,
    observedErrorEnvelopeStatus,
    validatedErrorBound,
    validatedErrorBoundStatus
  };
}

/** Исход построения посещённой точки. */
interface PrTpdPointBuild {
  readonly ok: boolean;
  readonly point: PrTpdVisitedPoint | null;
  readonly failureCode: string | null;
}

/**
 * Посещённая точка траектории (§2.4): фактическое PR-состояние
 * пробы, TPD существующего evaluator 4.4.4.4.1 (feed — опорное
 * состояние), статусы аудита по предикату домена. Метки корня
 * точки (§3 п. 6–7): единственный физический корень получает ОБЕ
 * метки; 2–3 корня — метка фактической continuation-ветви.
 */
function buildVisitedPoint(
  iterationIndex: number,
  trialState: PengRobinsonMixtureSuccess,
  composition: readonly number[],
  continuationBranch: PengRobinsonRootBranch,
  context: PrTpdSearchContext
): PrTpdPointBuild {
  const tpdResult = computePrTangentPlaneDistance({
    feed: context.feedState,
    trial: trialState
  });
  if (tpdResult.status !== 'success') {
    return { ok: false, point: null, failureCode: tpdResult.code };
  }
  const domainPoint = buildAuditDomainPoint(trialState, composition, context);
  const audit = applyPointAudit(
    domainPoint,
    context.observedEnvelopeAudit,
    context.validatedErrorBoundAudit
  );
  const rootLabels: PengRobinsonRootBranch[] =
    trialState.distinctPhysicalRootCount === 1
      ? ['vapor', 'liquid']
      : [continuationBranch];
  const point: PrTpdVisitedPoint = {
    iterationIndex,
    composition,
    selectedRoot: trialState.selectedRoot,
    rootLabels,
    physicalRootCount: trialState.distinctPhysicalRootCount,
    tpd: tpdResult.tpd,
    tpdContributions: tpdResult.contributions.map((contribution) => ({
      component: contribution.component,
      contribution: contribution.contribution
    })),
    observedErrorEnvelope: audit.observedErrorEnvelope,
    observedErrorEnvelopeStatus: audit.observedErrorEnvelopeStatus,
    validatedErrorBound: audit.validatedErrorBound,
    validatedErrorBoundStatus: audit.validatedErrorBoundStatus
  };
  return { ok: true, point, failureCode: null };
}

// ============================================
// 8. SS-ИСПОЛНИТЕЛЬ ПОПЫТКИ (§2, §6.1–6.4, §5.3)
// ============================================

/**
 * Одна попытка поиска: уникальный стартовый состав × ветвь
 * поиска (§3, §6). Successive substitution в ненормированных
 * псевдомолях Michelsen Y (§2.2): в PR и evaluator входит ТОЛЬКО
 * нормированный w = Y/sumY; масштаб Y — переменная итерации.
 *
 * Схема check-BEFORE-update (§6): критерии сходимости проверяются
 * на ТЕКУЩЕЙ точке; при сходимости обновление НЕ выполняется
 * (последняя точка = стационарная). Итерация 0 не может сойтись
 * (deltaTpd = +Infinity: истории ещё нет).
 *
 * Критерий сходимости (консервативная реализация §6.1+§6.3+§6.4):
 * r_stat <= sigma_stat И deltaW <= sigma_w И deltaTpd <= sigma_tpd,
 * где r_stat = max_i |b_i - khat|, b_i = ln w_i + lnPhi_i(w) - h_i,
 * khat = SUM w_i b_i (Neumaier), lnYnext_i = h_i - lnPhi_i(w),
 * deltaW = max_i |lnYnext - lnY|, deltaTpd = |tpd_k - tpd_{k-1}|.
 *
 * Отказы: sumY/состав неконечны или активная доля выродилась в
 * точный ноль → numerical_failure (§5.3: попытка завершается в
 * достигнутой точке, грань перечисляется отдельно; БЕЗ eps-
 * подстановок); отказ PR-вызова или evaluator → numerical_failure
 * (вызов входит в бюджет §4.4). Бифуркация (§3): попытка,
 * начатая с единственного физического корня, встретив точку с
 * >1 физическими корнями, НЕ порождает динамический форк: SS
 * продолжается на continuationBranch (feedRoot), вторая ветвь
 * остаётся необследованной (branchCoverageComplete=false на
 * уровне поиска).
 */
function runSsAttempt(
  context: PrTpdSearchContext,
  h: readonly number[],
  subset: readonly string[],
  activeIdx: readonly number[],
  candidate: PrTpdStartCandidate,
  initialState: PengRobinsonMixtureSuccess,
  initialBranch: 'vapor' | 'liquid' | 'single',
  continuationBranch: PengRobinsonRootBranch,
  initialPrCalls: number
): PrTpdSearchAttempt {
  const componentCount = context.canonicalIds.length;
  const singlePhysicalRoot = initialState.distinctPhysicalRootCount === 1;
  const visitedPoints: PrTpdVisitedPoint[] = [];
  let w: number[] = [...candidate.w];
  let lnY: number[] = [...candidate.lnY0];
  let state: PengRobinsonMixtureSuccess = initialState;
  let iterations = 0;
  let extraFailedCalls = 0;
  let outcome: PrTpdSearchAttemptOutcome = 'converged';
  let failureReason: string | undefined;
  let stationarityResidual: number | null = null;

  // Точка 0 из начального PR-состояния попытки.
  const point0 = buildVisitedPoint(0, state, w, continuationBranch, context);
  if (!point0.ok || point0.point === null) {
    return {
      startId: candidate.startId,
      support: subset,
      logicalLabels: singlePhysicalRoot ? ['vapor', 'liquid'] : [continuationBranch],
      initialBranch,
      continuationBranch,
      selectedRoot: initialState.selectedRoot,
      singlePhysicalRoot,
      startComposition: candidate.w,
      outcome: 'numerical_failure',
      iterations: 0,
      prEvaluations: initialPrCalls,
      stationarityResidual: null,
      visitedPoints: [],
      bestVisitedPoint: null,
      finalStationaryPoint: null,
      failureReason: 'tpd_evaluation_failure:' + String(point0.failureCode)
    };
  }
  visitedPoints.push(point0.point);

  while (true) {
    // lnPhi текущего состояния в каноническом порядке.
    const lnPhi = zeros(componentCount);
    for (const component of state.components) {
      const canonicalIndex = context.idToCanonicalIndex.get(component.component);
      if (canonicalIndex !== undefined) {
        lnPhi[canonicalIndex] = component.lnPhi;
      }
    }
    // Невязка стационарности §6.1.
    const b = zeros(componentCount);
    const weighted: number[] = [];
    for (const i of activeIdx) {
      b[i] = Math.log(w[i]) + lnPhi[i] - h[i];
      weighted.push(w[i] * b[i]);
    }
    const kHat = neumaierSum(weighted);
    let rStat = 0;
    for (const i of activeIdx) {
      const difference = Math.abs(b[i] - kHat);
      if (difference > rStat) {
        rStat = difference;
      }
    }
    stationarityResidual = rStat;
    // Кандидат следующего lnY (§2.2) и критерий §6.3.
    const lnYnext = zeros(componentCount);
    let deltaW = 0;
    for (const i of activeIdx) {
      lnYnext[i] = h[i] - lnPhi[i];
      const difference = Math.abs(lnYnext[i] - lnY[i]);
      if (difference > deltaW) {
        deltaW = difference;
      }
    }
    const deltaTpd =
      visitedPoints.length >= 2
        ? Math.abs(
            visitedPoints[visitedPoints.length - 1].tpd -
              visitedPoints[visitedPoints.length - 2].tpd
          )
        : Number.POSITIVE_INFINITY;
    // Проверка сходимости ДО обновления (§6).
    if (
      rStat <= PR_TPD_SEARCH_SIGMA_STAT &&
      deltaW <= PR_TPD_SEARCH_SIGMA_W &&
      deltaTpd <= PR_TPD_SEARCH_SIGMA_TPD
    ) {
      outcome = 'converged';
      break;
    }
    if (iterations >= PR_TPD_SEARCH_MAX_ITERATIONS) {
      outcome = 'max_iterations';
      break;
    }
    // Обновление Y (§2.2): масштаб сохраняется, PR получает w.
    lnY = lnYnext;
    const yValues: number[] = [];
    for (const i of activeIdx) {
      yValues.push(Math.exp(lnY[i]));
    }
    const sumY = neumaierSum(yValues);
    if (!isFiniteNumber(sumY) || sumY <= 0) {
      outcome = 'numerical_failure';
      failureReason = 'non_finite_sum_y';
      break;
    }
    const wNext = zeros(componentCount);
    let degenerated = false;
    for (const i of activeIdx) {
      wNext[i] = Math.exp(lnY[i]) / sumY;
      if (!isFiniteNumber(wNext[i])) {
        outcome = 'numerical_failure';
        failureReason = 'non_finite_composition';
        degenerated = true;
        break;
      }
      if (wNext[i] === 0) {
        // §5.3: граничная дегенерация — доля выродилась в точный
        // ноль в binary64; попытка завершается в достигнутой точке,
        // грань перечисляется отдельно. НЕ invalid_start, НЕ нормализация.
        outcome = 'numerical_failure';
        failureReason = 'boundary_degeneration_zero_mole_fraction';
        degenerated = true;
        break;
      }
    }
    if (degenerated) {
      break;
    }
    const callResult = callMixtureAtComposition(context, wNext, continuationBranch);
    if (callResult.status !== 'success') {
      // Отказной вызов входит в бюджет §4.4.
      extraFailedCalls = 1;
      outcome = 'numerical_failure';
      failureReason = 'pr_evaluation_failure:' + callResult.code;
      break;
    }
    state = callResult;
    w = wNext;
    iterations += 1;
    const point = buildVisitedPoint(iterations, state, w, continuationBranch, context);
    if (!point.ok || point.point === null) {
      outcome = 'numerical_failure';
      failureReason = 'tpd_evaluation_failure:' + String(point.failureCode);
      break;
    }
    visitedPoints.push(point.point);
  }

  let bestVisitedPoint: PrTpdVisitedPoint | null = null;
  for (const point of visitedPoints) {
    if (bestVisitedPoint === null || point.tpd < bestVisitedPoint.tpd) {
      bestVisitedPoint = point;
    }
  }
  const finalStationaryPoint =
    outcome === 'converged' && visitedPoints.length > 0
      ? visitedPoints[visitedPoints.length - 1]
      : null;

  return {
    startId: candidate.startId,
    support: subset,
    logicalLabels: singlePhysicalRoot ? ['vapor', 'liquid'] : [continuationBranch],
    initialBranch,
    continuationBranch,
    selectedRoot: initialState.selectedRoot,
    singlePhysicalRoot,
    startComposition: candidate.w,
    outcome,
    iterations,
    // Каждое обновление = ровно один PR-вызов (§4.4); отказной
    // финальный вызов также входит в счётчик попытки.
    prEvaluations: initialPrCalls + iterations + extraFailedCalls,
    stationarityResidual,
    visitedPoints,
    bestVisitedPoint,
    finalStationaryPoint,
    failureReason
  };
}

// ============================================
// 9. ГЛАВНАЯ ФУНКЦИЯ ПОИСКА (§4, §6.6)
// ============================================

/** Отказ поиска с существующими кодами слоя (§7.1). */
function searchFailure(
  code: PrTangentPlaneDistanceSearchErrorCode,
  message: string,
  detail: string | null
): PrTangentPlaneDistanceSearchResultFailure {
  // Поле detail объявлено readonly: failure-объект собирается ОДНИМ
  // выражением (присваивание полю после создания запрещено типом);
  // форма результата побитово та же: detail присутствует только при
  // ненулевом аргументе.
  if (detail !== null) {
    return { status: 'failure', code, message, detail };
  }
  return { status: 'failure', code, message };
}

/**
 * Отображение кодов отказов смесевого вычислителя (§7.1) на коды
 * слоя поиска: контракты входа → invalid_input; контракты
 * EOS/BIP-состояния → incompatible_state; численные отказы →
 * numerical_failure.
 */
function mapMixtureFailureCode(code: string): PrTangentPlaneDistanceSearchErrorCode {
  if (
    code === 'invalid_input' ||
    code === 'invalid_parameters' ||
    code === 'invalid_composition' ||
    code === 'unknown_component' ||
    code === 'parameter_evidence_not_accepted'
  ) {
    return 'invalid_input';
  }
  if (
    code === 'missing_binary_interaction' ||
    code === 'asymmetric_binary_interaction' ||
    code === 'binary_interaction_applicability' ||
    code === 'degenerate_attraction_limit'
  ) {
    return 'incompatible_state';
  }
  return 'numerical_failure';
}

/**
 * Multi-start поиск минимумов tangent-plane distance (§4, §6.6).
 *
 * Оркестрация: feed-вызов PR (бюджет 1) → канонизация состава →
 * перечисление подмножеств supp(z) (§5) → для каждого подмножества:
 * старты §2.1 → дедупликация уникальных составов (побитовая) →
 * root discovery по уникальному составу (feed-состав полного
 * носителя ПОВТОРНО ИСПОЛЬЗУЕТ feed-результат, §4.4 feedReuse)
 * → попытки по ветвям ('vapor','liquid'; единственный корень —
 * одна попытка 'single', continuation = feedRoot, §7.1) → SS
 * попытка (§6) → агрегация verdict §6.6.
 *
 * Верdict-приоритет (§6.6): C1-точка (bound в домене) →
 * unstable_detected; иначе все попытки сошлись, полное покрытие
 * ветвей и граней, каждая посещённая точка с bound в домене
 * класса C4 → no_instability_found_within_search; иначе
 * indeterminate с машинно-читаемой причиной (первое совпадение
 * по цепочке §6.6). Статус `stable` не выдаётся НИКОГДА.
 */
export function computePrTangentPlaneDistanceSearch(
  input: PrTangentPlaneDistanceSearchInput
): PrTangentPlaneDistanceSearchResult {
  // ---------- Валидация входа (§7.1) ----------
  if (!isNonNullObject(input)) {
    return searchFailure('invalid_input', 'вход поиска обязан быть непустым объектом', null);
  }
  const mixtureInputs = input.mixtureInputs;
  if (
    !isNonNullObject(mixtureInputs) ||
    !Array.isArray(mixtureInputs.components) ||
    !Array.isArray(mixtureInputs.binaryInteractions)
  ) {
    return searchFailure(
      'invalid_input',
      'mixtureInputs обязан содержать массивы components и binaryInteractions',
      null
    );
  }
  const request = input.request;
  if (!isNonNullObject(request)) {
    return searchFailure('invalid_input', 'request обязан быть непустым объектом', null);
  }
  const requestValidation = validatePengRobinsonMixtureRequest(request);
  if (requestValidation !== null) {
    return searchFailure(
      'invalid_input',
      'некорректный PR-запрос (T, P, ветвь, политика доказательности)',
      requestValidation.code + ': ' + requestValidation.message
    );
  }
  let observedEnvelopeAudit: PrTpdObservedEnvelopeAuditInput | null = null;
  const envelopeAuditRaw =
    input.observedEnvelopeAudit === undefined ? null : input.observedEnvelopeAudit;
  if (envelopeAuditRaw !== null) {
    if (
      !isNonNullObject(envelopeAuditRaw) ||
      !isFiniteNumber(envelopeAuditRaw.observedErrorEnvelope) ||
      envelopeAuditRaw.observedErrorEnvelope < 0 ||
      !isNonNullObject(envelopeAuditRaw.auditDomain)
    ) {
      return searchFailure(
        'invalid_input',
        'observedEnvelopeAudit требует конечный observedErrorEnvelope >= 0 и дескриптор auditDomain',
        null
      );
    }
    observedEnvelopeAudit = envelopeAuditRaw;
  }
  let validatedErrorBoundAudit: PrTpdValidatedErrorBoundAuditInput | null = null;
  const boundAuditRaw =
    input.validatedErrorBoundAudit === undefined ? null : input.validatedErrorBoundAudit;
  if (boundAuditRaw !== null) {
    if (
      !isNonNullObject(boundAuditRaw) ||
      !isFiniteNumber(boundAuditRaw.validatedErrorBound) ||
      boundAuditRaw.validatedErrorBound < 0 ||
      !isNonNullObject(boundAuditRaw.validatedDomain)
    ) {
      return searchFailure(
        'invalid_input',
        'validatedErrorBoundAudit требует конечный validatedErrorBound >= 0 и дескриптор validatedDomain',
        null
      );
    }
    validatedErrorBoundAudit = boundAuditRaw;
  }

  // ---------- Feed-вызов PR (бюджет: 1, §4.4) ----------
  const feedResult = computePengRobinsonMixture(mixtureInputs, request);
  let prEvaluations = 1;
  if (feedResult.status !== 'success') {
    return searchFailure(
      mapMixtureFailureCode(feedResult.code),
      'feed-состояние PR не вычислено: ' + feedResult.message,
      feedResult.code
    );
  }
  const feedState = feedResult;
  const feedRoot: PengRobinsonRootBranch = request.root;

  // ---------- Канонизация (§4.3) ----------
  const canonicalIds: string[] = [];
  for (const component of mixtureInputs.components) {
    canonicalIds.push(component.component);
  }
  canonicalIds.sort();
  const componentCount = canonicalIds.length;
  const idToCanonicalIndex = new Map<string, number>();
  for (let i = 0; i < componentCount; i += 1) {
    idToCanonicalIndex.set(canonicalIds[i], i);
  }
  const z = zeros(componentCount);
  for (const component of feedState.components) {
    const canonicalIndex = idToCanonicalIndex.get(component.component);
    if (canonicalIndex !== undefined) {
      z[canonicalIndex] = component.moleFraction;
    }
  }
  // h_i = ln z_i + lnPhi_i(z) (§1); определяется только на supp(z).
  const h = zeros(componentCount);
  for (const component of feedState.components) {
    const canonicalIndex = idToCanonicalIndex.get(component.component);
    if (canonicalIndex !== undefined && component.moleFraction > 0) {
      h[canonicalIndex] = Math.log(component.moleFraction) + component.lnPhi;
    }
  }
  // ln K_i (Wilson, §2.1): ln Pc_i - ln P + 5.373(1+omega_i)(1 - Tc_i/T).
  const lnK = zeros(componentCount);
  for (const component of mixtureInputs.components) {
    const canonicalIndex = idToCanonicalIndex.get(component.component);
    if (canonicalIndex !== undefined) {
      lnK[canonicalIndex] =
        Math.log(component.criticalPressurePa) -
        Math.log(request.pressurePa) +
        5.373 * (1 + component.acentricFactor) *
          (1 - component.criticalTemperatureK / request.temperatureK);
    }
  }
  // Идентичность EOS/BIP-набора (§7.2 п. 4.2).
  const fingerprint = canonicalPrInputFingerprint(mixtureInputs);
  const bipPairIdsUsed: string[] = [];
  const bipSourcesUsed: string[] = [];
  for (const bip of mixtureInputs.binaryInteractions) {
    bipPairIdsUsed.push(canonicalPairKey(bip.componentA, bip.componentB));
    bipSourcesUsed.push('evidence:' + bip.evidence);
  }

  const context: PrTpdSearchContext = {
    mixtureInputs,
    request,
    canonicalIds,
    idToCanonicalIndex,
    feedState,
    fingerprint,
    bipPairIdsUsed,
    bipSourcesUsed,
    observedEnvelopeAudit,
    validatedErrorBoundAudit
  };

  // ---------- Перечисление граней (§5) ----------
  const supportIds: string[] = [];
  for (let i = 0; i < componentCount; i += 1) {
    if (z[i] > 0) {
      supportIds.push(canonicalIds[i]);
    }
  }
  const enumeration = enumerateSubsetsLocal(supportIds);
  const faceCount = Math.pow(2, supportIds.length) - 2;

  // ---------- Основной цикл: подмножество → состав → ветвь ----------
  const attempts: PrTpdSearchAttempt[] = [];
  const examinedSubsets: (readonly string[])[] = [];
  let maxPrEvaluations = 1;
  let branchCoverageComplete = true;
  let discoveryFailure = false;
  let branchInitialFailure = false;

  for (const subset of enumeration.subsets) {
    examinedSubsets.push(subset);
    const isFullSupport = subset.length === supportIds.length;
    const candidates = generateStartCandidates(
      subset,
      isFullSupport,
      z,
      lnK,
      componentCount,
      idToCanonicalIndex,
      feedRoot,
      feedState.hasDistinctBranches
    );
    // Дедупликация уникальных составов (побитовая); порядок групп —
    // порядок первого появления (канонический порядок кандидатов).
    const groups: { w: readonly number[]; candidates: PrTpdStartCandidate[] }[] = [];
    const groupIndexByKey = new Map<string, number>();
    for (const candidate of candidates) {
      const key = candidate.w.join(',');
      const existingIndex = groupIndexByKey.get(key);
      if (existingIndex === undefined) {
        groupIndexByKey.set(key, groups.length);
        groups.push({ w: candidate.w, candidates: [candidate] });
      } else {
        groups[existingIndex].candidates.push(candidate);
      }
    }
    const activeIdx: number[] = [];
    for (const id of subset) {
      const canonicalIndex = idToCanonicalIndex.get(id);
      if (canonicalIndex !== undefined) {
        activeIdx.push(canonicalIndex);
      }
    }

    for (const group of groups) {
      // Root discovery (§4.4): feed-состав полного носителя повторно
      // использует feed-результат (feedReuse=1, побитово совместим).
      const isFeedComposition = isFullSupport && bitwiseEqualComposition(group.w, z);
      let feedReuse = 0;
      let discoveryState: PengRobinsonMixtureSuccess | null = null;
      if (isFeedComposition) {
        discoveryState = feedState;
        feedReuse = 1;
      } else {
        const discoveryResult = callMixtureAtComposition(context, group.w, feedRoot);
        prEvaluations += 1;
        if (discoveryResult.status !== 'success') {
          // Консервативный бюджетный резерв неудачного discovery:
          // до 2 начальных вызовов + 2 ветви по N_max (§4.4).
          discoveryFailure = true;
          branchCoverageComplete = false;
          maxPrEvaluations += 2 + 2 * PR_TPD_SEARCH_MAX_ITERATIONS;
          continue;
        }
        discoveryState = discoveryResult;
      }
      if (discoveryState === null) {
        continue;
      }
      const distinctPhysicalRootCount = discoveryState.distinctPhysicalRootCount;
      const searchBranchCount = Math.min(distinctPhysicalRootCount, 2);

      if (searchBranchCount <= 1) {
        // Единственный физический корень: ОДНА попытка 'single',
        // continuation = feedRoot (§7.1); обе логические метки.
        const initialPrCalls = 1 - feedReuse;
        maxPrEvaluations += initialPrCalls + PR_TPD_SEARCH_MAX_ITERATIONS;
        const attempt = runSsAttempt(
          context,
          h,
          subset,
          activeIdx,
          group.candidates[0],
          discoveryState,
          'single',
          feedRoot,
          initialPrCalls
        );
        attempts.push(attempt);
        prEvaluations += attempt.prEvaluations - initialPrCalls;
      } else {
        // Два физических корня и более: ДВЕ попытки, ветви
        // 'vapor','liquid' в каноническом порядке (§3).
        const initialBranchCalls = 2 - feedReuse;
        maxPrEvaluations += initialBranchCalls + 2 * PR_TPD_SEARCH_MAX_ITERATIONS;
        const branchOrder: PengRobinsonRootBranch[] = ['vapor', 'liquid'];
        for (const branch of branchOrder) {
          let initialState: PengRobinsonMixtureSuccess;
          let initialPrCalls: number;
          if (branch === feedRoot) {
            initialState = discoveryState;
            initialPrCalls = 1 - feedReuse;
          } else {
            const branchResult = callMixtureAtComposition(context, group.w, branch);
            prEvaluations += 1;
            if (branchResult.status !== 'success') {
              branchInitialFailure = true;
              branchCoverageComplete = false;
              continue;
            }
            initialState = branchResult;
            initialPrCalls = 1;
          }
          const representative = findRepresentative(group.candidates, branch);
          const attempt = runSsAttempt(
            context,
            h,
            subset,
            activeIdx,
            representative,
            initialState,
            branch,
            branch,
            initialPrCalls
          );
          attempts.push(attempt);
          prEvaluations += attempt.prEvaluations - initialPrCalls;
        }
      }
    }
  }

  // ---------- Агрегация verdict (§6.6) ----------
  let sawC1 = false;
  let sawC2C3 = false;
  let anyBoundUnavailable = false;
  let anyVisitedPoint = false;
  let allConverged = attempts.length > 0;
  let anyNumericalFailure = false;
  let anyMaxIterations = false;
  let anyInvalidStart = false;
  let anySinglePhysicalRoot = false;
  let anyBifurcation = false;
  let anyThreeRoots = false;
  for (const attempt of attempts) {
    if (attempt.outcome !== 'converged') {
      allConverged = false;
    }
    if (attempt.outcome === 'numerical_failure') {
      anyNumericalFailure = true;
    }
    if (attempt.outcome === 'max_iterations') {
      anyMaxIterations = true;
    }
    if (attempt.outcome === 'invalid_start') {
      anyInvalidStart = true;
    }
    if (attempt.singlePhysicalRoot) {
      anySinglePhysicalRoot = true;
    }
    for (const point of attempt.visitedPoints) {
      anyVisitedPoint = true;
      if (point.physicalRootCount >= 3) {
        anyThreeRoots = true;
      }
      if (attempt.singlePhysicalRoot && point.physicalRootCount > 1) {
        anyBifurcation = true;
      }
      if (point.validatedErrorBoundStatus === 'validated_bound_in_domain') {
        const intervalClass = classifyPrTpdInterval(
          point.tpd,
          point.validatedErrorBound,
          PR_TPD_SEARCH_NEGATIVE_THRESHOLD
        );
        if (intervalClass === 'C1') {
          sawC1 = true;
        } else if (intervalClass !== 'C4') {
          sawC2C3 = true;
        }
      } else {
        anyBoundUnavailable = true;
      }
    }
  }

  let searchVerdict: PrTpdSearchVerdict;
  let verdictReason: PrTpdSearchVerdictReason;
  if (sawC1) {
    searchVerdict = 'unstable_detected';
    verdictReason = 'c1_visited_point';
  } else if (
    allConverged &&
    branchCoverageComplete &&
    enumeration.complete &&
    !discoveryFailure &&
    !branchInitialFailure &&
    !anyBoundUnavailable &&
    !sawC2C3 &&
    anyVisitedPoint
  ) {
    searchVerdict = 'no_instability_found_within_search';
    verdictReason = 'all_attempts_converged_all_points_c4';
  } else {
    searchVerdict = 'indeterminate';
    if (sawC2C3) {
      verdictReason = 'c2_or_c3_visited_point';
    } else if (anyNumericalFailure) {
      verdictReason = 'numerical_failure_attempt';
    } else if (anyMaxIterations) {
      verdictReason = 'max_iterations_attempt';
    } else if (anyInvalidStart) {
      verdictReason = 'invalid_start_attempt';
    } else if (discoveryFailure) {
      verdictReason = 'root_discovery_failure';
    } else if (branchInitialFailure) {
      verdictReason = 'branch_initial_failure';
    } else if (!branchCoverageComplete) {
      verdictReason = 'branch_coverage_incomplete';
    } else if (!enumeration.complete) {
      verdictReason = 'partial_face_enumeration';
    } else if (anyBoundUnavailable) {
      verdictReason = 'validated_bound_not_available';
    } else if (!anyVisitedPoint) {
      verdictReason = 'no_visited_points';
    } else {
      verdictReason = 'validated_bound_not_available';
    }
  }

  // ---------- Примечания (детерминированный порядок, без дубликатов) ----------
  const notes: string[] = [];
  if (anySinglePhysicalRoot) {
    notes.push('single_physical_root');
  }
  if (anyBifurcation) {
    notes.push('single_physical_root_attempt_bifurcation');
  }
  if (anyThreeRoots) {
    notes.push('intermediate_physical_root_not_surveyed');
  }
  if (!enumeration.complete) {
    notes.push('partial_face_enumeration');
  }

  // ---------- Лучшие точки по всем попыткам ----------
  let bestVisitedTpd: number | null = null;
  let bestVisitedPoint: { attemptIndex: number; point: PrTpdVisitedPoint } | null = null;
  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    for (const point of attempts[attemptIndex].visitedPoints) {
      if (bestVisitedTpd === null || point.tpd < bestVisitedTpd) {
        bestVisitedTpd = point.tpd;
        bestVisitedPoint = { attemptIndex, point };
      }
    }
  }

  // ---------- Результат (§7.2) ----------
  const success: PrTangentPlaneDistanceSearchResultSuccess = {
    status: 'success',
    temperatureK: feedState.temperatureK,
    pressurePa: feedState.pressurePa,
    evidencePolicy: feedState.evidencePolicy,
    feedComposition: feedState.components.map((component) => component.moleFraction),
    feedRoot,
    attempts,
    bestVisitedTpd,
    bestVisitedPoint,
    searchVerdict,
    verdictReason,
    negativeThreshold: PR_TPD_SEARCH_NEGATIVE_THRESHOLD,
    negativeThresholdStatus: PR_TPD_SEARCH_NEGATIVE_THRESHOLD_STATUS,
    branchCoverageComplete,
    observedErrorEnvelope:
      observedEnvelopeAudit === null ? null : observedEnvelopeAudit.observedErrorEnvelope,
    observedErrorEnvelopeStatus:
      observedEnvelopeAudit === null ? 'pending_audit' : 'observed_envelope',
    auditDomain: observedEnvelopeAudit === null ? null : observedEnvelopeAudit.auditDomain,
    validatedErrorBound:
      validatedErrorBoundAudit === null ? null : validatedErrorBoundAudit.validatedErrorBound,
    validatedErrorBoundStatus:
      validatedErrorBoundAudit === null ? 'pending_validation' : 'validated',
    validatedDomain:
      validatedErrorBoundAudit === null ? null : validatedErrorBoundAudit.validatedDomain,
    faceEnumeration: enumeration.complete ? 'complete' : 'partial',
    examinedSubsets,
    counts: {
      faceCount,
      attemptCount: attempts.length,
      prEvaluations,
      maxPrEvaluations
    },
    notes
  };
  return success;
}
