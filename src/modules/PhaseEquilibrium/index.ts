// ============================================
// PHASE EQUILIBRIUM - Фазовые состояния атмосферных компонентов
// ============================================
//
// Проверка фазового состояния веществ при заданных условиях:
//   1) вычислить парциальное давление p_i;
//   2) найти давление насыщенного пара P_sat,i;
//   3) сравнить скрининговым показателем S_i = p_i / P_sat,i.
//
// Источник корреляций: NIST Chemistry WebBook (уравнение Антуана
// для метана и этана) с явным диапазоном применимости каждого
// набора коэффициентов. За пределами экспериментального диапазона
// результат помечается как экстраполяция с предупреждением.
//
// ГЛАВНОЕ ОГРАНИЧЕНИЕ: S_i — только скрининговый показатель.
// Точный состав и количество конденсированной фазы для смеси
// не рассчитываются (нужны коэффициенты активности и фугитивности);
// интерфейс для закона Рауля и EOS (Peng–Robinson, SRK) оставлен
// расширяемым, но сами EOS не реализованы.

import type {
  AtmospherePhysicalModel,
  AtmospherePhaseAnalysis,
  PhaseComponentAnalysis,
  ScientificConfidence,
  SubstanceReservoirs
} from '../../types';
import { getPhaseProperties, type AntoineSet } from '../Data/phaseProperties';
import { BAR_TO_PA } from '../Units';
import { temperatureValueOrNull } from '../Core/thermalState';
import type { ScientificValue } from '../Core/scientificValue';

export const MIXTURE_LIMITATION_MESSAGE =
  'Обнаружен потенциальный фазовый переход. Точный состав и количество конденсированной фазы не рассчитаны.';

export const MIXTURE_MODEL_NOTE =
  'Для точного равновесия смеси необходимы коэффициенты активности в жидкой фазе и коэффициенты ' +
  'фугитивности газа. Модель равновесия смеси не реализована: выполнен только скрининг по давлению ' +
  'насыщенного пара чистых компонентов (идеальное приближение).';

// ============================================
// 1. ДАВЛЕНИЕ НАСЫЩЕННОГО ПАРА (УРАВНЕНИЕ АНТУАНА)
// ============================================

export interface SaturationPressureResult {
  /** Давление насыщенного пара, Па; null, если не вычислено */
  pressurePa: number | null;
  /** Вычислено ли за пределами экспериментального диапазона корреляции */
  extrapolated: boolean;
  /** Использованная корреляция */
  correlation: string | null;
  /** Источник коэффициентов */
  source: string | null;
  /** Пояснение результата */
  note: string;
  /** Предупреждение, если есть */
  warning: string | null;
  confidence: ScientificConfidence;
}

/**
 * Давление насыщенного пара по уравнению Антуана:
 *   log10(P/bar) = A − B / (T + C)
 *
 * Набор выбирается по экспериментальному диапазону применимости.
 * Вне диапазонов используется ближайший набор с пометкой
 * extrapolated = true и предупреждением.
 *
 * Возвращает null в pressurePa, если:
 * - ниже тройной точки: возможное выпадение твёрдой фазы (число не выдумывается);
 * - для вещества нет корреляции Антуана: состояние остаётся неизвестным.
 */
export function saturationPressure(gasId: string, temperatureK: number): SaturationPressureResult {
  const props = getPhaseProperties(gasId);
  if (!props) {
    return {
      pressurePa: null,
      extrapolated: false,
      correlation: null,
      source: null,
      note: 'фазовые свойства вещества неизвестны модели',
      warning: null,
      confidence: 'unknown'
    };
  }

  // Выше критической точки: жидкости нет, конденсация невозможна.
  if (props.criticalPoint && temperatureK >= props.criticalPoint.temperatureK) {
    return {
      pressurePa: null,
      extrapolated: false,
      correlation: null,
      source: props.source,
      note: `температура ${temperatureK} K не ниже критической (${props.criticalPoint.temperatureK} K): жидкой фазы не существует`,
      warning: null,
      confidence: 'established'
    };
  }

  // Ниже тройной точки: возможное выпадение твёрдой фазы,
  // давление насыщенного пара численно НЕ оценивается.
  if (props.triplePoint && temperatureK < props.triplePoint.temperatureK) {
    return {
      pressurePa: null,
      extrapolated: false,
      correlation: null,
      source: props.source,
      note: `температура ${temperatureK} K ниже тройной точки (${props.triplePoint.temperatureK} K): возможно выпадение твёрдой фазы; давление пара не оценивается`,
      warning: `Возможно образование твёрдой фазы ${props.formula} ниже тройной точки.`,
      confidence: 'established'
    };
  }

  if (props.antoine.length === 0) {
    return {
      pressurePa: null,
      extrapolated: false,
      correlation: null,
      source: props.source,
      note: 'для вещества не хранится корреляция давления насыщенного пара; значение не выдумывается',
      warning: null,
      confidence: 'unknown'
    };
  }

  // Набор, диапазон которого содержит температуру.
  const inside = props.antoine.find(
    (s) => temperatureK >= s.tempRangeK.min && temperatureK <= s.tempRangeK.max
  );
  let set: AntoineSet;
  let extrapolated: boolean;
  if (inside) {
    set = inside;
    extrapolated = false;
  } else {
    // Ближайший по расстоянию до середины диапазона.
    set = props.antoine.reduce((best, s) => {
      const dist = (s: AntoineSet) =>
        temperatureK < s.tempRangeK.min
          ? s.tempRangeK.min - temperatureK
          : temperatureK - s.tempRangeK.max;
      return dist(s) < dist(best) ? s : best;
    }, props.antoine[0]);
    extrapolated = true;
  }

  const log10P = set.A - set.B / (temperatureK + set.C);
  const pressurePa = Math.pow(10, log10P) * BAR_TO_PA;

  return {
    pressurePa,
    extrapolated,
    correlation: set.correlation,
    source: `${set.reference}. ${set.sourceUrl}`,
    note: extrapolated
      ? `температура ${temperatureK} K вне экспериментального диапазона корреляции (${set.tempRangeK.min}–${set.tempRangeK.max} K): результат — экстраполяция`
      : `значение в экспериментальном диапазоне корреляции (${set.tempRangeK.min}–${set.tempRangeK.max} K)`,
    warning: extrapolated
      ? `Расчёт для ${props.formula} при ${temperatureK} K выполнен ВНЕ экспериментального диапазона корреляции Антуана (${set.tempRangeK.min}–${set.tempRangeK.max} K). Результат — экстраполяция, требующая осторожности.`
      : null,
    confidence: extrapolated ? 'estimated' : 'established'
  };
}

// ============================================
// 2. ПРОВЕРКА ФАЗОВОГО СОСТОЯНИЯ КОМПОНЕНТА
// ============================================

export interface ComponentPhaseInput {
  gasId: string;
  /** Парциальное давление компонента, Па (null — неизвестно) */
  partialPressurePa: number | null;
  /** Температура среды, K (null — неизвестна) */
  temperatureK: number | null;
}

/**
 * Скрининговая проверка фазового состояния одного компонента.
 * S_i = p_i / P_sat,i — только индикатор потенциала конденсации,
 * не расчёт массы конденсата.
 */
export function checkComponentPhase(input: ComponentPhaseInput): PhaseComponentAnalysis {
  const { gasId, partialPressurePa, temperatureK } = input;
  const props = getPhaseProperties(gasId);
  const formula = props?.formula ?? gasId;

  if (!props || temperatureK === null || partialPressurePa === null) {
    return {
      gasId,
      state: 'unknown',
      screeningRatio: null,
      saturationPressurePa: null,
      extrapolated: false,
      message: !props
        ? 'Фазовые свойства вещества неизвестны: состояние не определяется.'
        : partialPressurePa === null
          ? 'Парциальное давление неизвестно: состояние не определяется.'
          : 'Температура неизвестна: состояние не определяется.',
      confidence: 'unknown'
    };
  }

  // Выше критической температуры жидкой фазы нет.
  if (props.criticalPoint && temperatureK >= props.criticalPoint.temperatureK) {
    return {
      gasId,
      state: 'no_condensation_above_critical',
      screeningRatio: null,
      saturationPressurePa: null,
      extrapolated: false,
      message: `${formula} при ${temperatureK} K выше критической температуры (${props.criticalPoint.temperatureK} K): конденсация в жидкость невозможна, сверхкритический флюид — за пределами модели.`,
      confidence: 'established'
    };
  }

  // Ниже тройной точки: возможное выпадение твёрдой фазы.
  if (props.triplePoint && temperatureK < props.triplePoint.temperatureK) {
    return {
      gasId,
      state: 'potential_solid_deposition',
      screeningRatio: null,
      saturationPressurePa: null,
      extrapolated: false,
      message: `${formula} при ${temperatureK} K ниже тройной точки (${props.triplePoint.temperatureK} K): возможно выпадение твёрдой фазы. ${MIXTURE_LIMITATION_MESSAGE}`,
      confidence: 'established'
    };
  }

  const sat = saturationPressure(gasId, temperatureK);

  if (sat.pressurePa === null) {
    return {
      gasId,
      state: 'unknown',
      screeningRatio: null,
      saturationPressurePa: null,
      extrapolated: false,
      message: sat.note,
      confidence: sat.confidence
    };
  }

  const screeningRatio = partialPressurePa / sat.pressurePa;
  const baseConfidence: ScientificConfidence = sat.extrapolated ? 'estimated' : 'established';

  if (screeningRatio >= 1) {
    return {
      gasId,
      state: 'potentially_condensing',
      screeningRatio,
      saturationPressurePa: sat.pressurePa,
      extrapolated: sat.extrapolated,
      message:
        `S = ${screeningRatio.toFixed(3)} ≥ 1: парциальное давление ${formula} превышает давление насыщенного пара. ` +
        MIXTURE_LIMITATION_MESSAGE,
      confidence: baseConfidence
    };
  }
  return {
    gasId,
    state: 'gas',
    screeningRatio,
    saturationPressurePa: sat.pressurePa,
    extrapolated: sat.extrapolated,
    message:
      `S = ${screeningRatio.toFixed(3)} < 1: ${formula} при данных условиях остаётся в газовой фазе (скрининговая оценка).` +
      (sat.extrapolated ? ' Расчёт давления пара — экстраполяция.' : ''),
    confidence: baseConfidence
  };
}

// ============================================
// 3. СКРИНИНГ ВСЕЙ АТМОСФЕРЫ
// ============================================

/**
 * Фазовый скрининг всех компонентов атмосферной модели.
 * Использует парциальные давления из AtmospherePhysicalModel.
 */
export function analyzeAtmospherePhases(
  model: AtmospherePhysicalModel,
  temperatureK: number | null
): AtmospherePhaseAnalysis {
  const warnings: string[] = [];
  const components: PhaseComponentAnalysis[] = [];

  for (const [gasId, pressureValue] of Object.entries(model.partialPressuresPa)) {
    const p = pressureValue?.value ?? null;
    const analysis = checkComponentPhase({ gasId, partialPressurePa: p, temperatureK });
    components.push(analysis);

    if (analysis.state === 'potentially_condensing') {
      warnings.push(
        `Компонент ${gasId} потенциально конденсируется при ${temperatureK ?? '?'} K (S = ${analysis.screeningRatio?.toFixed(2) ?? '?'}). ` +
          MIXTURE_LIMITATION_MESSAGE
      );
    }
    if (analysis.state === 'potential_solid_deposition') {
      warnings.push(`Компонент ${gasId} может выпадать в твёрдую фазу при ${temperatureK} K.`);
    }
  }

  // Компоненты без парциального давления (например, при отсутствии
  // давления) всё равно перечисляются с состоянием unknown.
  for (const gasId of Object.keys(model.molarFractions)) {
    if (!(gasId in model.partialPressuresPa)) {
      components.push(
        checkComponentPhase({ gasId, partialPressurePa: null, temperatureK })
      );
    }
  }

  const hasPotentialTransitions = components.some(
    (c) => c.state === 'potentially_condensing' || c.state === 'potential_solid_deposition'
  );

  return {
    temperatureK,
    components,
    hasPotentialTransitions,
    warnings,
    mixtureNote: MIXTURE_MODEL_NOTE,
    notes: [
      'выполнен только скрининг чистых компонентов; равновесие смеси не рассчитано',
      'предупреждения не удаляют компоненты из состава: вещество не исчезает при фазовых переходах'
    ]
  };
}

// ============================================
// 3a. ФАЗОВЫЙ СКРИНИНГ С ПРОИСХОЖДЕНИЕМ ТЕМПЕРАТУРЫ (STAGE 4.2.2)
// ============================================

/**
 * Фазовый скрининг по ТИПИЗИРОВАННОЙ температуре (Stage 4.2.2).
 *
 * Делегирует числовой analyzeAtmospherePhases и добавляет
 * temperatureBasis — исходное значение температуры с его статусом
 * и происхождением. Числовой результат идентичен легаси-вызову:
 * - пригодная температура → скрининг как раньше, происхождение
 *   сохранено в temperatureBasis;
 * - unknown/непригодная температура → скрининг без числа (все
 *   компоненты unknown), подстановка T_eq или температуры
 *   поверхности ЗАПРЕЩЕНА: отсутствие числа остаётся отсутствием
 *   числа.
 *
 * Численный API (analyzeAtmospherePhases) не изменён — регрессии
 * этапа 3 остаются в силе.
 */
export function analyzeAtmospherePhasesWithProvenance(
  model: AtmospherePhysicalModel,
  temperature: ScientificValue
): AtmospherePhaseAnalysis {
  const temperatureK = temperatureValueOrNull(temperature);
  const base = analyzeAtmospherePhases(model, temperatureK);
  const note =
    temperatureK === null
      ? `фазовый скрининг выполнен без числовой температуры (статус «${temperature.status}»): состояния компонентов остаются unknown — подстановка T_eq или температуры поверхности запрещена (Stage 4.2.2)`
      : `фазовый скрининг основан на температуре ${temperatureK} K; происхождение значения сохранено в temperatureBasis (Stage 4.2.2)`;
  return {
    ...base,
    temperatureBasis: { temperature, note }
  };
}

// ============================================
// 4. РЕЗЕРВУАРЫ ВЕЩЕСТВА И ПЕРЕНОС МЕЖДУ ФАЗАМИ
// ============================================

export type ReservoirKey = keyof SubstanceReservoirs;

export function createEmptyReservoirs(): SubstanceReservoirs {
  return { atmospheric: {}, liquidSurface: {}, subsurfaceLiquid: {}, solidDeposits: {} };
}

/** Суммарное количество вещества по всем резервуарам. */
export function totalSubstanceAmount(reservoirs: SubstanceReservoirs, gasId: string): number {
  return (
    (reservoirs.atmospheric[gasId] ?? 0) +
    (reservoirs.liquidSurface[gasId] ?? 0) +
    (reservoirs.subsurfaceLiquid[gasId] ?? 0) +
    (reservoirs.solidDeposits[gasId] ?? 0)
  );
}

export interface TransferResult {
  success: boolean;
  reservoirs: SubstanceReservoirs;
  reason: string;
}

/**
 * Перенос вещества между резервуарами с сохранением количества:
 * атомы не возникают из ничего и не исчезают. Перенос ограничен
 * доступным количеством в резервуаре-источнике; отрицательные
 * количества запрещены.
 */
export function transferSubstance(
  reservoirs: SubstanceReservoirs,
  gasId: string,
  from: ReservoirKey,
  to: ReservoirKey,
  amount: number
): TransferResult {
  if (amount < 0) {
    return { success: false, reservoirs, reason: 'количество переноса не может быть отрицательным' };
  }
  if (from === to) {
    return { success: false, reservoirs, reason: 'резервуар-источник совпадает с резервуаром-приёмником' };
  }
  const available = reservoirs[from][gasId] ?? 0;
  if (amount > available + 1e-12) {
    return {
      success: false,
      reservoirs,
      reason: `недостаточно вещества в резервуаре ${from}: доступно ${available}, запрошено ${amount}`
    };
  }
  const next: SubstanceReservoirs = {
    atmospheric: { ...reservoirs.atmospheric },
    liquidSurface: { ...reservoirs.liquidSurface },
    subsurfaceLiquid: { ...reservoirs.subsurfaceLiquid },
    solidDeposits: { ...reservoirs.solidDeposits }
  };
  const remaining = Math.max(0, available - amount);
  if (remaining === 0) {
    delete next[from][gasId];
  } else {
    next[from][gasId] = remaining;
  }
  next[to][gasId] = (next[to][gasId] ?? 0) + amount;
  return {
    success: true,
    reservoirs: next,
    reason: `перенесено ${amount} "${gasId}" из ${from} в ${to}; общее количество вещества сохранено`
  };
}

// ============================================
// 5. ИНТЕРФЕЙС ДЛЯ БОЛЕЕ СЛОЖНЫХ МОДЕЛЕЙ (РАСШИРЕНИЕ)
// ============================================

/**
 * Скрининг по закону Рауля (идеализированное приближение!):
 *   p_i = x_i(жидк.) · P_sat,i
 * Используется только с явным предупреждением об идеальности.
 * Коэффициенты активности и EOS (Peng–Robinson, SRK) не реализованы.
 */
export function raoultScreening(
  gasId: string,
  liquidMoleFraction: number,
  temperatureK: number
): SaturationPressureResult & { raoultPartialPressurePa: number | null; idealWarning: string } {
  const sat = saturationPressure(gasId, temperatureK);
  const raoultPartialPressurePa =
    sat.pressurePa === null ? null : liquidMoleFraction * sat.pressurePa;
  return {
    ...sat,
    raoultPartialPressurePa,
    idealWarning:
      'Закон Рауля — идеализированное приближение: активности компонентов в жидкой фазе приравнены ' +
      'к мольным долям. Для реальных смесей (особенно неполярных углеводородов при высоких давлениях) ' +
      'требуются коэффициенты активности; подключение EOS (Peng–Robinson, SRK) предусмотрено архитектурой, ' +
      'но не реализовано на данном этапе.'
  };
}

export const EOS_NOT_IMPLEMENTED_NOTE =
  'Уравнения состояния (Peng–Robinson, SRK) и модель равновесия смеси не реализованы: ' +
  'результаты фазового анализа являются скрининговыми оценками, а не точным расчётом.';

export default {
  saturationPressure,
  checkComponentPhase,
  analyzeAtmospherePhases,
  analyzeAtmospherePhasesWithProvenance,
  createEmptyReservoirs,
  totalSubstanceAmount,
  transferSubstance,
  raoultScreening,
  MIXTURE_LIMITATION_MESSAGE,
  MIXTURE_MODEL_NOTE,
  EOS_NOT_IMPLEMENTED_NOTE
};

