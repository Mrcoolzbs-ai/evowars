/**
 * ============================================================
 * АДАПТЕР КЛАССИФИКАЦИИ ТЕПЛОВОГО БЮДЖЕТА (Stage 4.7.3, Часть D)
 * ============================================================
 *
 * АДДИТИВНЫЙ (существующий analyzeGeology() не затронут, его
 * качественные уровни не превращаются в ватты) проекционный
 * адаптер: переводит физическую тепловую мощность в
 * классификационный уровень ТОЛЬКО при явных порогах.
 *
 * Правила честности:
 *  - пороги передаются вызывающей стороной ЯВНО, с provenance
 *    и нормировкой (W/kg или W/m^3); сравнение абсолютных ватт
 *    разноразмерных тел КАК ЕДИНАЯ ШКАЛА запрещено;
 *  - без порогов (или без базы нормировки) результат
 *    not_classified — никаких выдуманных low/moderate/high;
 *  - геотермальная доступность, вулканизм и гидротермальные
 *    системы НЕ выводятся из суммы ватт (это остаются решениями
 *    качественной модели).
 */

export type HeatBudgetLevel = 'low' | 'moderate' | 'high';

/** Явный порог классификации с нормировкой. */
export interface HeatBudgetThreshold {
  /** Верхняя граница удельной мощности порога, W/kg или W/m^3 (в зависимости от basis). */
  readonly maxSpecificPower: number;
  readonly level: HeatBudgetLevel;
  /** Происхождение порога (обязательно). */
  readonly provenance: string;
}

export type HeatBudgetClassificationBasis = 'per_mass' | 'per_volume';

export interface HeatBudgetClassificationInput {
  /** Мощность источника, W (например, радиогенная или приливная для резервуара). */
  readonly powerW: number;
  /** Масса резервуара, kg — база W/kg (если классификация по массе). */
  readonly massKg?: number;
  /** Объём резервуара, m^3 — база W/m^3 (если классификация по объёму). */
  readonly volumeM3?: number;
  /** Пороги обязаны быть полной таблицей нижней границы high и т.д. */
  readonly thresholds: readonly HeatBudgetThreshold[] | null;
  readonly basis: HeatBudgetClassificationBasis;
  /** Необязательный идентификатор резервуара/источника для сопоставления. */
  readonly subjectId?: string;
}

export type HeatBudgetClassification =
  | {
      readonly status: 'classified';
      readonly level: HeatBudgetLevel;
      readonly specificPower: number;
      readonly unitBasis: 'W/kg' | 'W/m^3';
      readonly appliedThresholdMaxSpecificPower: number | null;
      readonly subjectId: string | null;
      readonly classificationBasis: HeatBudgetClassificationBasis;
      readonly provenance: readonly string[];
    }
  | {
      readonly status: 'not_classified';
      readonly reason: string;
      readonly subjectId: string | null;
      readonly classificationBasis: HeatBudgetClassificationBasis;
    };

/**
 * Классификация мощности по ЯВНЫМ порогам; без порогов или без
 * подтверждённой базы нормировки — not_classified (никаких
 * умолчательных «типичных» значений).
 */
export function classifyHeatBudgetByThresholds(input: HeatBudgetClassificationInput): HeatBudgetClassification {
  if (input.thresholds === null || input.thresholds.length === 0) {
    return {
      status: 'not_classified',
      reason: 'пороги классификации не заданы: без подтверждённых порогов уровень не присваивается',
      subjectId: input.subjectId ?? null,
      classificationBasis: input.basis
    };
  }
  if (!Number.isFinite(input.powerW)) {
    return {
      status: 'not_classified',
      reason: `мощность не конечное число (${String(input.powerW)})`,
      subjectId: input.subjectId ?? null,
      classificationBasis: input.basis
    };
  }
  let specificPower: number | null = null;
  if (input.basis === 'per_mass') {
    if (input.massKg === undefined || !Number.isFinite(input.massKg) || input.massKg <= 0) {
      return {
        status: 'not_classified',
        reason: `база W/kg недоступна: масса резервуара неизвестна или некорректна (${String(input.massKg ?? 'не задана')})`,
        subjectId: input.subjectId ?? null,
        classificationBasis: input.basis
      };
    }
    specificPower = input.powerW / input.massKg;
  } else {
    if (input.volumeM3 === undefined || !Number.isFinite(input.volumeM3) || input.volumeM3 <= 0) {
      return {
        status: 'not_classified',
        reason: `база W/m^3 недоступна: объём резервуара неизвестен или некорректен (${String(input.volumeM3 ?? 'не задан')})`,
        subjectId: input.subjectId ?? null,
        classificationBasis: input.basis
      };
    }
    specificPower = input.powerW / input.volumeM3;
  }

  // пороги: упорядочены по maxSpecificPower; первый порог, чья верхняя
  // граница достигнута, определяет уровень.
  const sorted = [...input.thresholds].sort((a, b) => a.maxSpecificPower - b.maxSpecificPower);
  const provenanceLines = sorted.map((t) => `${t.level}: <= ${String(t.maxSpecificPower)} (${t.provenance})`);
  let applied: HeatBudgetThreshold | null = null;
  for (const threshold of sorted) {
    if (specificPower <= threshold.maxSpecificPower) {
      applied = threshold;
      break;
    }
  }
  if (applied === null) {
    return {
      status: 'not_classified',
      reason: `удельная мощность ${specificPower.toExponential(6)} выше верхней границы самой сильной категории: шкала порогов не покрывает значение`,
      subjectId: input.subjectId ?? null,
      classificationBasis: input.basis
    };
  }
  return {
    status: 'classified',
    level: applied.level,
    specificPower,
    unitBasis: input.basis === 'per_mass' ? 'W/kg' : 'W/m^3',
    appliedThresholdMaxSpecificPower: applied.maxSpecificPower,
    subjectId: input.subjectId ?? null,
    classificationBasis: input.basis,
    provenance: provenanceLines
  } satisfies HeatBudgetClassification;
}

