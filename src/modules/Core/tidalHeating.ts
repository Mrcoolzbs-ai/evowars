import { G } from '../Units';

/**
 * ============================================================
 * ПРИЛИВНОЙ НАГРЕВ СИНХРОННОГО СПУТНИКА (Stage 4.7.3, Часть B)
 * ============================================================
 *
 * Первоисточник формулы: Cuk et al. (2024). "Long-Term Evolution
 * of the Saturnian System". Space Science Reviews, 220, 20.
 * DOI: 10.1007/s11214-024-01049-2.
 *
 *   E_tidal_dot = (3/2) * (n^5 * R^5 / G) * (k2/Q) * (7 e^2 + sin^2(theta))
 *
 *   n  — среднее движение спутника, rad/s (n = sqrt(G*M_p / a^3),
 *        если вычисляется из орбиты);
 *   R  — радиус спутника, m;
 *   k2 — потенциальное число Лява спутника (безразмерное);
 *   Q  — Добротность приливного диссипирования (tidal quality
 *        factor), безразмерная;
 *   e  — эксцентриситет;
 *   theta — наклон оси (obliquity), rad.
 *
 * ЕДИНИЦЫ: все входы SI, результат W.
 * G — единственная гравитационная константа проекта из Units
 * (6.67430e-11, CODATA 2018); второй константы НЕ создаётся.
 *
 * ОБЛАСТЬ ПРИМЕНИМОСТИ МОДЕЛИ (объявленные предположения, не
 * экстраполируются):
 *  - синхронное вращение спутника (omega = n; проверяется, если
 *    задан числовой спиновый режим);
 *  - малые возмущения: e <= MAX_ECCENTRICITY, theta <= MAX_OBLIQUITY_RAD;
 *  - k2/Q считаются фиксированными константами тела; температурная
 *    зависимость реологии и обратная связь k2/Q(T) НЕ реализованы;
 *  - при mode snapshot мощность НЕ утверждается постоянной во
 *    времени: орбита, T и диссипативные параметры могут меняться.
 *
 * ПРИНЦИП НЕЗНАНИЯ: отсутствие подтверждённого источника на Q, k2,
 * эксцентриситет или спиновый режим означает НЕ completed:
 * недостающие параметры перечисляются явно, значения с других
 * планет НЕ подставляются.
 */

/** Пределы малости возмущений, объявленные для формулы (артефакт модели). */
export const TIDAL_MODEL_APPLICABILITY_LIMITS = {
  maxEccentricity: 0.1,
  maxObliquityRad: 0.5,
  synchronousRelativeTolerance: 0.01
} as const;

/** Допустимый диапазон потенциального числа Лява: 0 < k2 <= 1.5. */
export const LOVE_NUMBER_K2_PHYSICAL_LIMIT = 1.5;

export interface TidalParameterSource {
  /** Человекочитаемое происхождение значения (обязательно). */
  readonly provenance: string;
}

export type TidalSpinState =
  | { readonly kind: 'synchronous_declared'; readonly source: TidalParameterSource }
  | { readonly kind: 'rotation_period_s'; readonly value: number; readonly source: TidalParameterSource };

export type TidalTimeMode =
  | { readonly kind: 'snapshot' }
  | {
      readonly kind: 'constant_parameters_over_interval';
      readonly startSeconds: number;
      readonly endSeconds: number;
      /** Обоснование постоянства параметров на интервале (обязательно). */
      readonly justification: string;
    };

export interface TidalHeatingInput {
  /** Среднее движение, rad/s (если известно); конфликтует с parentMassKg+semiMajorAxisM при рассогласовании. */
  readonly meanMotionRadS?: number | null;
  /** Масса родительского тела, kg (для вычисления n). */
  readonly parentMassKg?: number | null;
  /** Большая полуось, m (для вычисления n). */
  readonly semiMajorAxisM?: number | null;
  readonly satelliteRadiusM: number;
  readonly eccentricity: number;
  /** Obliquity, rad. */
  readonly obliquityRad: number;
  readonly spinState: TidalSpinState;
  readonly loveNumberK2: number | null;
  readonly qualityFactorQ: number | null;
  /** Происхождение R, e, obliquity — обязательные строки. */
  readonly orbitalProvenance: string;
  readonly rheologyProvenance: string;
  readonly timeMode?: TidalTimeMode;
}

export interface TidalHeatingCompleted {
  readonly status: 'completed';
  readonly tidalPowerW: number;
  readonly meanMotionRadS: number;
  /** Было ли n вычислено из орбиты. */
  readonly meanMotionComputedFromOrbit: boolean;
  readonly eccentricity: number;
  readonly obliquityRad: number;
  readonly factor7e2PlusSin2Theta: number;
  readonly timeMode: {
    readonly kind: 'snapshot' | 'constant_parameters_over_interval';
    /** Интегрированная энергия за интервал, J — только для constant_parameters_over_interval. */
    readonly intervalEnergyJ: number | null;
    readonly intervalSeconds: number | null;
  };
  /** Явно перечисленные допущения, при которых число имеет смысл. */
  readonly assumptions: readonly string[];
  /** Мощность НЕ постоянна во времени вне стабилизированных режимов — предупреждение контракта. */
  readonly timeDependenceDisclaimer: string;
}

export type TidalHeatingResult =
  | TidalHeatingCompleted
  | { readonly status: 'invalid_input'; readonly issues: readonly string[] }
  | {
      readonly status: 'out_of_applicability';
      readonly reason: string;
      readonly missingParameters: readonly string[];
      readonly detail: Readonly<Record<string, number | string | boolean | null>>;
    };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Приливная диссипация синхронного спутника (Cuk et al. 2024):
 * отсутствие подтверждённых Q, k2, e или спинового режима
 * возвращает НЕ completed (структурированный отказ), значения с
 * других тел не подставляются.
 */
export function computeSynchronousSatelliteTidalHeating(input: TidalHeatingInput): TidalHeatingResult {
  const issues: string[] = [];
  const missing: string[] = [];

  // --- спин: несинхронный режим блокирует (после вычисления n);
  let rotationPeriodS: number | null = null;
  if (input.spinState.kind === 'synchronous_declared') {
    // синхронность заявлена вместе с provenance (не дополняется ничем);
    // числовая проверка выполняется, если вместо неё задан период вращения
  } else if (input.spinState.kind === 'rotation_period_s') {
    if (!isFiniteNumber(input.spinState.value) || input.spinState.value <= 0) {
      issues.push(`spinState.rotation_period_s: обязано быть конечным > 0 (${String(input.spinState.value)})`);
    } else {
      rotationPeriodS = input.spinState.value;
    }
  } else {
    missing.push('спиновый режим спутника (synchronous_declared или rotation_period_s)');
  }

  // --- среднее движение: явное или из орбиты.
  const hasMeanMotion = isFiniteNumber(input.meanMotionRadS) && (input.meanMotionRadS as number) > 0;
  const parentMass = input.parentMassKg;
  const semiMajorAxis = input.semiMajorAxisM;
  const hasOrbit = isFiniteNumber(parentMass) && (parentMass as number) > 0 &&
                   isFiniteNumber(semiMajorAxis) && (semiMajorAxis as number) > 0;
  let meanMotion: number | null = null;
  let computedFromOrbit = false;
  if (hasMeanMotion && !hasOrbit) {
    meanMotion = input.meanMotionRadS as number;
  } else if (!hasMeanMotion && hasOrbit) {
    const pm = parentMass as number;
    const a = semiMajorAxis as number;
    if (pm <= 0 || a <= 0) {
      issues.push('родительская масса и большая полуось обязаны быть > 0');
    }
    meanMotion = Math.sqrt((G * pm) / (a * a * a));
    computedFromOrbit = true;
  } else if (hasMeanMotion && hasOrbit) {
    const pm = parentMass as number;
    const a = semiMajorAxis as number;
    const orbitN = Math.sqrt((G * pm) / (a * a * a));
    const givenN = input.meanMotionRadS as number;
    const relDiff = Math.abs(givenN - orbitN) / orbitN;
    if (relDiff > 1e-6) {
      issues.push(`meanMotionRadS (${String(givenN)}) не согласуется с sqrt(G*M_p/a^3) (${String(orbitN)}), относительное расхождение ${relDiff.toExponential(3)}`);
    }
    meanMotion = orbitN;
    computedFromOrbit = true;
  } else {
    missing.push('среднее движение (meanMotionRadS) ИЛИ пара (parentMassKg, semiMajorAxisM)');
  }

  // --- обязательные параметры и физическая валидация.
  if (!isFiniteNumber(input.satelliteRadiusM) || input.satelliteRadiusM <= 0) {
    issues.push(`satelliteRadiusM: обязано быть конечным > 0 (${String(input.satelliteRadiusM)})`);
  }
  const e = input.eccentricity;
  if (!isFiniteNumber(e) || e < 0 || e >= 1) {
    issues.push(`eccentricity: обязано быть конечным в [0, 1) (${String(e)})`);
  }
  const theta = input.obliquityRad;
  if (!isFiniteNumber(theta) || theta < 0 || theta > Math.PI) {
    issues.push(`obliquityRad: обязано быть конечным в [0, pi] (${String(theta)})`);
  }
  const k2 = input.loveNumberK2;
  if (!isFiniteNumber(k2) || k2 <= 0) {
    missing.push('потенциальное число Лява k2 (подтверждённый источник обязателен)');
  } else if (k2 > LOVE_NUMBER_K2_PHYSICAL_LIMIT) {
    issues.push(`loveNumberK2: физически недопустимое значение ${String(k2)} (потенциальное число Лява не превышает ${String(LOVE_NUMBER_K2_PHYSICAL_LIMIT)})`);
  }
  const q = input.qualityFactorQ;
  if (!isFiniteNumber(q) || q <= 0) {
    missing.push('приливная добротность Q (подтверждённый источник обязателен)');
  }
  if (typeof input.orbitalProvenance !== 'string' || input.orbitalProvenance.trim().length === 0) {
    issues.push('orbitalProvenance обязателен');
  }
  if (typeof input.rheologyProvenance !== 'string' || input.rheologyProvenance.trim().length === 0) {
    issues.push('rheologyProvenance обязателен');
  }

  const timeMode = input.timeMode ?? { kind: 'snapshot' as const };
  if (timeMode.kind === 'constant_parameters_over_interval') {
    if (!isFiniteNumber(timeMode.startSeconds) || !isFiniteNumber(timeMode.endSeconds)) {
      issues.push('timeMode.constant_parameters_over_interval: startSeconds/endSeconds обязаны быть конечными');
    } else if (timeMode.endSeconds <= timeMode.startSeconds) {
      issues.push('timeMode.constant_parameters_over_interval: endSeconds обязан быть > startSeconds (строгое направление времени)');
    }
    if (typeof timeMode.justification !== 'string' || timeMode.justification.trim().length === 0) {
      issues.push('timeMode.constant_parameters_over_interval: justification обязателен (обоснование постоянства параметров)');
    }
  }

  if (issues.length > 0) {
    return { status: 'invalid_input', issues };
  }
  if (meanMotion === null) {
    // недостижимо при непустом missing (среднее движение уже перечислено),
    // но оставляется как явная страховка типонаправления
    return {
      status: 'out_of_applicability',
      reason: 'среднее движение не определено (нет meanMotionRadS и нет согласующейся орбиты)',
      missingParameters: missing,
      detail: {}
    };
  }
  if (missing.length > 0) {
    return {
      status: 'out_of_applicability',
      reason: 'отсутствуют обязательные параметры приливной модели: значения с других тел не подставляются, мощность не вычисляется',
      missingParameters: missing,
      detail: {}
    };
  }

  // --- проверки применимости formula (после структурной валидации).
  const applicabilityNotes: string[] = [];
  const n = meanMotion as number;
  if (rotationPeriodS !== null) {
    const omega = (2 * Math.PI) / rotationPeriodS;
    const relSpinDiff = Math.abs(omega - n) / n;
    if (!(relSpinDiff <= TIDAL_MODEL_APPLICABILITY_LIMITS.synchronousRelativeTolerance)) {
      return {
        status: 'out_of_applicability',
        reason: `несинхронный спиновый режим: omega/n = ${(omega / n).toExponential(6)}, модель формулы требует синхронного вращения`,
        missingParameters: [],
        detail: { omegaRadS: omega, meanMotionRadS: n, relativeDifference: relSpinDiff }
      };
    }
    applicabilityNotes.push('синхронность подтверждена числовым периодом вращения');
  } else {
    applicabilityNotes.push('синхронность задана явным декларативным режимом (synchronous_declared)');
  }
  if (e > TIDAL_MODEL_APPLICABILITY_LIMITS.maxEccentricity) {
    return {
      status: 'out_of_applicability',
      reason: `эксцентриситет e = ${String(e)} за пределом малости модели (max ${String(TIDAL_MODEL_APPLICABILITY_LIMITS.maxEccentricity)}): экстраполяция формулы запрещена`,
      missingParameters: [],
      detail: { maxEccentricity: TIDAL_MODEL_APPLICABILITY_LIMITS.maxEccentricity }
    };
  }
  if (theta > TIDAL_MODEL_APPLICABILITY_LIMITS.maxObliquityRad) {
    return {
      status: 'out_of_applicability',
      reason: `obliquity theta = ${String(theta)} rad за пределом малости модели (max ${String(TIDAL_MODEL_APPLICABILITY_LIMITS.maxObliquityRad)} rad): экстраполяция запрещена`,
      missingParameters: [],
      detail: { maxObliquityRad: TIDAL_MODEL_APPLICABILITY_LIMITS.maxObliquityRad }
    };
  }

  const R = input.satelliteRadiusM;
  const excitation = 7 * e * e + Math.sin(theta) * Math.sin(theta);
  const tidalPowerW = (3 / 2) * ((Math.pow(n, 5) * Math.pow(R, 5)) / G) * (k2 as number) / (q as number) * excitation;

  const applicabilityLines = [
    'синхронное вращение спутника (omega = n) — предположение формулы Cuk et al. (2024)',
    `малые возмущения: e <= ${String(TIDAL_MODEL_APPLICABILITY_LIMITS.maxEccentricity)}, theta <= ${String(TIDAL_MODEL_APPLICABILITY_LIMITS.maxObliquityRad)} rad`,
    'k2 и Q фиксированы; температурная зависимость реологии и обратная связь k2/Q(T) не реализованы'
  ];
  let intervalEnergyJ: number | null = null;
  let intervalSeconds: number | null = null;
  if (timeMode.kind === 'constant_parameters_over_interval') {
    intervalSeconds = timeMode.endSeconds - timeMode.startSeconds;
    intervalEnergyJ = tidalPowerW * intervalSeconds;
    applicabilityLines.push(
      `параметры объявлены ФИКСИРОВАННЫМИ на интервале [${String(timeMode.startSeconds)}, ${String(timeMode.endSeconds)}] с: ${timeMode.justification}`
    );
  }

  return {
    status: 'completed',
    tidalPowerW,
    meanMotionRadS: n,
    meanMotionComputedFromOrbit: computedFromOrbit,
    eccentricity: e,
    obliquityRad: theta,
    factor7e2PlusSin2Theta: excitation,
    timeMode: {
      kind: timeMode.kind,
      intervalEnergyJ,
      intervalSeconds
    },
    assumptions: [...applicabilityLines, ...applicabilityNotes],
    timeDependenceDisclaimer:
      timeMode.kind === 'snapshot'
        ? 'мощность вычислена для текущих параметров; при изменении орбиты, температуры или k2/Q мощность НЕ постоянна во времени'
        : `энергия получена интегрированием мощности ${String(intervalSeconds)} с при объявленно-постоянных параметрах; за пределами интервала модель не утверждает постоянства`
  };
}
