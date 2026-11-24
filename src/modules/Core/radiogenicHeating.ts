import { tryGetRadiogenicNuclide, ELEMENT_TO_NUCLIDE_CONVERSIONS } from '../Data/radiogenicNuclides';
import type { RadiogenicNuclideId } from '../Data/radiogenicNuclides';

/**
 * ============================================================
 * РАДИОГЕННАЯ МОЩНОСТЬ (Stage 4.7.3, Часть A3/A4)
 * ============================================================
 *
 * Математическое ядро для известной массы родительского нуклида:
 *
 *   N_i(t) = (m_i(t) / M_i) · N_A
 *   lambda_i = ln2 / T_{1/2,i}          (из каталога данных)
 *   m_i(t) = m_i(t0) · exp(-lambda_i · (t - t0))
 *   Q_i(t) = N_i(t) · lambda_i · E_{heat,i}
 *
 *   - m_i   — масса РОДИТЕЛЬСКОГО нуклида, kg (не природного элемента);
 *   - M_i   — молярная масса изотопа, kg/mol (каталог);
 *   - N_A   — постоянная Авогадро 6.02214076e23 (точное определение SI);
 *   - E_heat — тепловая энергия на распад/цепочку, J (каталог:
 *     нейтрино исключены; U/Th — цепочка при secular equilibrium).
 *
 * ВРЕМЯ: ось в секундах, НЕТ зависимости от локальной даты/таймзоны.
 * Знак (t − t0) свободен: до опорной эпохи масса ЛОГАРИФМИЧЕСКИ
 * растёт в прошлое (exp > 0), после — убывает; отрицательная масса
 * невозможна ни при каком знаке dt. Это свойство проверяется тестами.
 *
 * ИНТЕГРАЛ МОЩНОСТИ (аналитический, для тепловой эволюции):
 *   E(tA, tB) = (m0 / M) · N_A · E_heat · (exp(-lambda·ΔA) − exp(-lambda·ΔB))
 *   где Δ = t − t0. Мощность не «замирает»: это точное
 *   решение дифференциального закона распада.
 *
 * БАЗЫ МАСС (критично, не смешиваются):
 *  - масса отдельного изотопа (238U, 235U, 40K, 232Th, 26Al, 60Fe);
 *  - масса природного элемента — ТОЛЬКО через явную функцию
 *    elementMassKgToNuclideMassesKg с подтверждёнными долями
 *    (ElementToNuclideConversions, Korenaga 2008).
 * Публикуемые удельные коэффициенты H (W/kg) НЕ используются
 * вычислителем — отдельный путь предусмотрен и документирован,
 * но не смешивается с энергий распада без доказательства.
 *
 * НЕИЗВЕСТНОЕ: если масса нуклида неизвестна (не в списке
 * входа), вклад НЕ считается нулём: он числится в missing
 * contributions, полнотой бюджета не является, и result
 * помечает неполноту явно.
 */

/** Постоянная Авогадро, моль^-1 (точное значение, определение SI 2019). */
export const AVOGADRO_NUMBER_MOL1 = 6.02214076e23;

/** keV -> J. */
const KEV_TO_J = 1.602176634e-16;

/** Масса родительского нуклида из входа. */
export interface RadiogenicMassEntry {
  /** Идентификатор нуклида каталога. */
  readonly nuclideId: RadiogenicNuclideId | string;
  /** Масса родительского нуклида, kg (строго > 0; конечная). */
  readonly massKg: number;
  /** Резервуар, к которому отнесена масса (для распределения источников). */
  readonly reservoirId?: string;
  /** Происхождение массы и состава — ОБЯЗАТЕЛЬНО по контракту. */
  readonly massProvenance: string;
  /** Неопределённость массы (относительная, доля от 1), если известна. */
  readonly massRelativeUncertainty?: number;
  /** Свободная пометка. */
  readonly note?: string;
}

/** Вклад одного нуклида. */
export interface RadiogenicContribution {
  readonly nuclideId: string;
  readonly status: 'computed' | 'missing_decay_energy' | 'unknown_nuclide' | 'numerical_overflow';
  readonly reservoirId: string | null;
  /** Масса на опорной эпохе, kg. */
  readonly massAtReferenceKg: number;
  /** Масса на момент вычисления, kg (exp-закон, без нулевой подстановки). */
  readonly massAtEvaluationKg: number;
  /** Мощность на момент вычисления, W. */
  readonly powerW: number | null;
  /** Относительная неопределённость мощности (сумма квадратов известных относительных вкладов). */
  readonly powerRelativeUncertainty: number | null;
  /** Причины, по которым вклад не мог быть рассчитан (fail-closed). */
  readonly blockingIssues?: readonly string[];
}

/** Результат расчёта радиогенной мощности. */
export type RadiogenicPowerResult =
  | {
      readonly status: 'completed';
      readonly referenceEpochSeconds: number;
      readonly evaluationTimeSeconds: number;
      readonly deltaSeconds: number;
      readonly contributions: readonly RadiogenicContribution[];
      /** Сумма ТОЛЬКО известных вкладов, W; НЕ полный бюджет при missing > 0. */
      readonly knownTotalPowerW: number;
      readonly completeness: {
        readonly computedCount: number;
        readonly missingCount: number;
        readonly missingIds: readonly string[];
        readonly note: string;
      };
      readonly provenance: readonly string[];
    }
  | {
      readonly status: 'invalid_input';
      readonly issues: readonly string[];
    };

/**
 * Мощность одного нуклида из массы родителя на момент dt = t − t0 (сек).
 * Низкоуровневое ядро: используется и в самостоятельном расчёте, и в
 * тепловой эволюцией (Q_rad(t)).
 */
export function nuclidePowerAtTime(
  molarMassKgPerMol: number,
  decayConstant_s1: number,
  heatEnergyJ: number,
  massAtReferenceKg: number,
  deltaSeconds: number
): number {
  const m = massAtReferenceKg * Math.exp(-decayConstant_s1 * deltaSeconds);
  const atomCount = (m / molarMassKgPerMol) * AVOGADRO_NUMBER_MOL1;
  return atomCount * decayConstant_s1 * heatEnergyJ;
}

/** Аналитический интеграл мощности нуклида по интервалу [t0+dtA, t0+dtB], J. */
export function nuclideEnergyIntegralJ(
  molarMassKgPerMol: number,
  decayConstant_s1: number,
  heatEnergyJ: number,
  massAtReferenceKg: number,
  deltaSecondsA: number,
  deltaSecondsB: number
): number {
  // m(t)·lambda·E_H интеграл по времени: (m0/M)·N_A·E_H·(e^{-λΔA} − e^{-λΔB})
  const scale = (massAtReferenceKg / molarMassKgPerMol) * AVOGADRO_NUMBER_MOL1 * heatEnergyJ;
  return scale * (Math.exp(-decayConstant_s1 * deltaSecondsA) - Math.exp(-decayConstant_s1 * deltaSecondsB));
}

/** Полярная конвертация: тепловая энергия записи каталога, J. */
function heatEnergyJ(record: { heatEffectiveDecayEnergyKeV: number }): number {
  return record.heatEffectiveDecayEnergyKeV * KEV_TO_J;
}

/**
 * Расчёт радиогенной мощности по массам родительских нуклидов.
 * Контракт входа (Часть A4): явные массы изотопов, опорная эпоха,
 * момент вычисления, принадлежность резервуарам. Если заданы только
 * концентрации ЭЛЕМЕНТОВ, их перевод — предварительным явным вызовом
 * elementMassKgToNuclideMassesKg; автоматическая подмена состава
 * запрещена (нельзя считать все тела земными).
 */
export function computeRadiogenicPower(input: {
  nuclideMasses: readonly RadiogenicMassEntry[];
  /** Опорная эпоха, с (ось проекта: секунды; напр. 0 — «настоящее» входа). */
  referenceEpochSeconds: number;
  /** Момент вычисления, с (может быть меньше/больше эпохи). */
  evaluationTimeSeconds: number;
}): RadiogenicPowerResult {
  const issues: string[] = [];
  if (!Array.isArray(input.nuclideMasses) || input.nuclideMasses.length === 0) {
    issues.push('nuclideMasses: пустой список — радиогенный бюджет не определён (unknown), а не ноль');
  }
  if (!Number.isFinite(input.referenceEpochSeconds)) {
    issues.push('referenceEpochSeconds: не конечное число');
  }
  if (!Number.isFinite(input.evaluationTimeSeconds)) {
    issues.push('evaluationTimeSeconds: не конечное число');
  }
  const seen = new Set<string>();
  input.nuclideMasses.forEach((entry, index) => {
    if (!Number.isFinite(entry.massKg) || entry.massKg <= 0) {
      issues.push(`nuclideMasses[${index}]: масса обязана быть конечной и > 0 (${String(entry.massKg)})`);
    }
    if (tryGetRadiogenicNuclide(String(entry.nuclideId)) === null) {
      issues.push(`nuclideMasses[${index}]: неизвестный nuclideId «${String(entry.nuclideId)}» (запись каталога отсутствует)`);
    }
    if (typeof entry.massProvenance !== 'string' || entry.massProvenance.trim().length === 0) {
      issues.push(`nuclideMasses[${index}]: massProvenance обязателен (происхождение массы и состава)`);
    }
    if (entry.massRelativeUncertainty !== undefined &&
        (!Number.isFinite(entry.massRelativeUncertainty) || entry.massRelativeUncertainty < 0)) {
      issues.push(`nuclideMasses[${index}]: massRelativeUncertainty обязано быть конечным ≥ 0`);
    }
    if (Number.isFinite(entry.massKg) && entry.massKg > 0) {
      const id = String(entry.nuclideId);
      if (seen.has(id)) {
        issues.push(`nuclideMasses[${index}]: повторный nuclideId «${id}» — объедините массы до вызова (не суммируем молча)`);
      } else {
        seen.add(id);
      }
    }
  });
  if (issues.length > 0) {
    return { status: 'invalid_input', issues };
  }

  const dt = input.evaluationTimeSeconds - input.referenceEpochSeconds;
  const contributions: RadiogenicContribution[] = [];
  const provenance: string[] = [];
  let knownTotal = 0;
  let computedCount = 0;
  const missing: string[] = [];

  for (const entry of input.nuclideMasses) {
    const record = tryGetRadiogenicNuclide(String(entry.nuclideId));
    if (record === null) {
      // достижимо только при рассогласовании с валидацией; безопасный пропуск
      continue;
    }
    const blocking: string[] = [];
    let powerW: number | null = null;
    // Каталог всегда содержит E_H для своих нуклидов; защита ниже —
    // структурная (fail-closed), если параметр когда-нибудь станет unknown.
    if (!Number.isFinite(record.heatEffectiveDecayEnergyKeV) || record.heatEffectiveDecayEnergyKeV <= 0) {
      blocking.push('тепловая энергия распада неизвестна (отсутствует подтверждённое значение E_H)');
      missing.push(String(entry.nuclideId));
      contributions.push({
        nuclideId: record.nuclideId,
        status: 'missing_decay_energy',
        reservoirId: entry.reservoirId ?? null,
        massAtReferenceKg: entry.massKg,
        massAtEvaluationKg: entry.massKg * Math.exp(-record.decayConstant_s1 * dt),
        powerW: null,
        powerRelativeUncertainty: null,
        blockingIssues: blocking
      });
      continue;
    }
    const massEval = entry.massKg * Math.exp(-record.decayConstant_s1 * dt);
    const relUnc = entry.massRelativeUncertainty ?? null;
    if (!Number.isFinite(massEval) || !Number.isFinite(dt)) {
      // экстремальный dt: exp-закон переполнен — отказ, а не молчаливый мусор
      contributions.push({
        nuclideId: record.nuclideId,
        status: 'numerical_overflow',
        reservoirId: entry.reservoirId ?? null,
        massAtReferenceKg: entry.massKg,
        massAtEvaluationKg: massEval,
        powerW: null,
        powerRelativeUncertainty: relUnc,
        blockingIssues: [`exp-закон распада не представим численно при dt = ${String(dt)} с (lambda = ${String(record.decayConstant_s1)} 1/с)`]
      });
      missing.push(String(entry.nuclideId));
      continue;
    }
    powerW = nuclidePowerAtTime(record.molarMassKgPerMol, record.decayConstant_s1, heatEnergyJ(record), entry.massKg, dt);
    contributions.push({
      nuclideId: record.nuclideId,
      status: 'computed',
      reservoirId: entry.reservoirId ?? null,
      massAtReferenceKg: entry.massKg,
      massAtEvaluationKg: massEval,
      powerW,
      powerRelativeUncertainty: relUnc
    });
    knownTotal += powerW;
    computedCount += 1;
    provenance.push(
      `${record.nuclideId}: масса/состав — ${entry.massProvenance}; `
      + `T1/2 — ${String(record.halfLifeProvenance.sourceName)}; `
      + `E_H — ${String(record.heatEnergyProvenance.sourceName)}`
    );
  }

  const missingIds = missing.length > 0 ? missing : [];
  // missing здесь — только вклады с невозможным вычислением энергии;
  // отсутствие нуклида во входе детектируется вызывающей стороной
  // (сравнением с ожидаемым составом) и отражается в notes.
  const completenessNote =
    missingIds.length > 0
      ? `сумма известных вкладов ${knownTotal.toExponential(6)} W НЕ является полным радиогенным бюджетом: ${missingIds.join(', ')} без подтверждённой энергии распада исключены из суммы`
      : 'все переданные нуклиды рассчитаны; сумма НЕ претендует на полный бюджет тел, чей полный список радионуклидов не задан входом';

  return {
    status: 'completed',
    referenceEpochSeconds: input.referenceEpochSeconds,
    evaluationTimeSeconds: input.evaluationTimeSeconds,
    deltaSeconds: dt,
    contributions,
    knownTotalPowerW: knownTotal,
    completeness: {
      computedCount,
      missingCount: missingIds.length,
      missingIds,
      note: completenessNote
    },
    provenance
  } as RadiogenicPowerResult;
}

/**
 * Перевод массы ПРИРОДНОГО ЭЛЕМЕНТА (U, Th, K) в массы изотопов
 * по ЯВНЫМ подтверждённым долям (Korenaga 2008; земные современные
 * значения). Использование оборота НЕ означает, что тело земное:
 * вызов функции должен сопровождаться происхождением состава.
 * Возвращает null для элемента без правил конвертации (fail-closed).
 */
export function elementMassKgToNuclideMassesKg(
  elementSymbol: string,
  elementMassKg: number
): { nuclideId: RadiogenicNuclideId; massKg: number }[] | null {
  const rules = ELEMENT_TO_NUCLIDE_CONVERSIONS[elementSymbol];
  if (!rules || rules.length === 0 || !Number.isFinite(elementMassKg) || elementMassKg <= 0) {
    return null;
  }
  // Каждая доля — конечное значение в (0, 1]. Сумма долей НЕ обязана
  // равняться 1: для U перечислен весь природный изотопный состав
  // (0.9928 + 0.0072 = 1, это снежется каталог-валидатором), для K —
  // только РАДИОГЕННАЯ доля 40K в природном калии (1.28e-4), а
  // нерадиогенные изотопы 39K/41K не участвуют в тепловом бюджете.
  for (const rule of rules) {
    if (!Number.isFinite(rule.fraction) || rule.fraction <= 0 || rule.fraction > 1) {
      return null;
    }
  }
  return rules.map((rule) => ({ nuclideId: rule.nuclideId, massKg: elementMassKg * rule.fraction }));
}

