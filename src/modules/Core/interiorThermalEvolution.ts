import type { DataProvenance } from './scientificValue';
import {
  solveOdeWithRadauIia,
  OdeSolverError
} from './odeSolver';
import type { OdeSolverProblem, OdeSolverOptions } from './solverBackend';
import { tryGetRadiogenicNuclide } from '../Data/radiogenicNuclides';
import { nuclidePowerAtTime } from './radiogenicHeating';
import { YEAR_S, yearsToSeconds } from '../Units';

/**
 * ============================================================
 * ТЕПЛОВАЯ ЭВОЛЮЦИЯ ВНУТРЕННИХ РЕЗЕРВУАРОВ (Stage 4.7.3, Часть C)
 * ============================================================
 *
 * Многорезервуарная сосредоточенная (lumped) модель. Для каждого
 * резервуара i:
 *
 *   C_i dT_i/dt = Q_rad,i(t) + Q_tidal,i + sum_j K_ij (T_j - T_i)
 *                 - Q_loss,i - P_extLoss,i
 *
 *   C_i = M_i * c_p,i   (постоянная cp в объявленном диапазоне T)
 *   Q_rad,i(t) = sum_nuclides P_nuclide(t) — exp-закон распада
 *                m(t) = m0 exp(-lambda(t - t_ref)), нейтрино исключены;
 *   Q_tidal,i — режим constant_parameters_over_interval (объявленный
 *               и обоснованный; формулу приливной диссипации и её
 *               применимость см. Core/tidalHeating);
 *   Q_loss,i = K_i,s (T_i - T_s) — линейная связь с граничным
 *               резервуаром температуры T_s;
 *   P_extLoss,i — ЯВНАЯ внешняя мощность потерь (не изобретается).
 *
 * ПЕРВИЧНОЕ ТЕПЛО: остаточное тепло аккреции/формирования
 * отражается В НАЧАЛЬНОМ СОСТОЯНИИ (T_initial, т.е. начальной
 * тепловой энергии), а НЕ постоянным источником Q_primordial.
 * Отдельный механизм высвобождения первичного тепла не реализован
 * и не добавляется молча.
 *
 * ВНУТРЕННИЙ ОБМЕН: один и тот же перенос входит в уравнения
 * двух резервуаров с противоположными знаками; суммарный
 * внутренний перенос в энергетическом балансе системы
 * сокращается (sum_ij Q_ij = 0). Коэффициенты K_ij НЕ выводятся
 * из PREM или толщин слоёв без данных о теплопроводности — они
 * задаются входом с provenance.
 *
 * НЕИЗВЕСТНОЕ: пропуск массы, cp или начальной температуры
 * резервуара — это invalid_input с явным перечнем (никогда не
 * zeroes); типичные теплоёмкости камня/железа без источника
 * НЕ подставляются.
 *
 * ОСЬ ВРЕМЕНИ: секунды в вычислительном ядре; годы переводятся
 * ЯВНО через Units.yearsToSeconds (юлианский год, без
 * зависимости от локальной даты/таймзоны). Направление времени
 * строгое: endS > startS.
 *
 * СОЛВЕР: используется существующий жесткий решатель Radau IIA
 * (Core/odeSolver, порядок 5, L-устойчивый, адаптивный шаг,
 * аналитический якобиан предоставляется — система линейна по T
 * при постоянных cp и K). Дополнительно к температурам
 * интегрируются АККУМУЛЯТОРЫ энергий (radiogenic, tidal, ставки
 * парных/boundary-переносов, внешние потери): их значения дают
 * интегрированные энергии источников для энергетического
 * баланса. Инвариант баланса проверяется постфактум БЕЗ
 * искусственной коррекции температур; превышение объявленного
 * допуска => numerical_failure.
 *
 * ЛИМИТ РАЗМЕРНОСТИ: состояние = n_T + n_accumulators <= 64
 * (лимит solveOdeWithRadauIia; documented).
 */

// ============================================
// 1. ТИПЫ ВХОДА
// ============================================

/** Радиогенный источник резервуара: масса родительского нуклида. */
export interface ReservoirRadiogenicSource {
  readonly nuclideId: string;
  /** Масса родительского нуклида, kg. */
  readonly massKg: number;
  /** Происхождение массы и состава (обязательно). */
  readonly massProvenance: string;
  /** Неопределённость массы (относительная), если известна. */
  readonly massRelativeUncertainty?: number;
}

/** Постоянный приливный источник (объявленный режим, Часть B3). */
export interface ReservoirConstantTidalSource {
  readonly powerW: number;
  /** Происхождение мощности (обычно — результат computeSynchronousSatelliteTidalHeating). */
  readonly provenance: string;
  /** Режим фиксации параметров: обязателен по Части B3. */
  readonly mode: 'constant_parameters_over_interval';
  /** Обоснование постоянства параметров на интервале. */
  readonly justification: string;
}

/** Явная внешняя мощность потерь (не изобретается). */
export interface ReservoirConstantExternalLoss {
  readonly powerW: number;
  readonly provenance: string;
}

export interface ThermalReservoirSpec {
  readonly reservoirId: string;
  readonly displayName?: string;
  /** Масса, kg; undefined/null — НЕИЗВЕСТНО (fail-closed). */
  readonly massKg?: number | null;
  /** Удельная теплоёмкость, J/(kg·K); undefined/null — НЕИЗВЕСТНО. */
  readonly specificHeatJPerKgK?: number | null;
  /** Начальная температура, K; undefined/null — НЕИЗВЕСТНО. */
  readonly initialTemperatureK?: number | null;
  /** Подтверждённый диапазон температур (априорная область применимости cp и модели). */
  readonly confirmedTemperatureRangeK?: { readonly minK: number; readonly maxK: number; readonly provenance: string } | undefined;
  readonly radiogenicSources?: readonly ReservoirRadiogenicSource[];
  readonly constantTidalSource?: ReservoirConstantTidalSource | undefined;
  readonly constantExternalLoss?: ReservoirConstantExternalLoss | undefined;
}

/** Парная тепловая связь (внутренний перенос). */
export interface ReservoirPairLink {
  readonly reservoirIdA: string;
  readonly reservoirIdB: string;
  /** Тепловая проводимость lumped-связи, W/K (вход с provenance). */
  readonly conductanceWPerK: number;
  readonly conductanceProvenance: string;
}

/** Связь с граничным резервуаром фиксированной температуры (потери). */
export interface BoundaryReservoirLink {
  readonly reservoirId: string;
  /** Граничная температура T_s, K (явно заданная). */
  readonly boundaryTemperatureK: number;
  readonly conductanceWPerK: number;
  readonly conductanceProvenance: string;
  /** Идентификатор границы (например, 'surface'). */
  readonly boundaryId?: string;
}

export interface InteriorThermalTimeAxis {
  /** Начало интервала, с. */
  readonly startS: number;
  /** Конец интервала, с (> startS). */
  readonly endS: number;
  /** Контрольные времена отчёта, с (опционально; строго возрастают, внутри интервала). */
  readonly outputTimesS?: readonly number[];
}

export interface InteriorThermalIntegrationOptions {
  readonly rtol?: number;
  readonly atol?: number | readonly number[];
  readonly maxSteps?: number;
  /**
   * Допуск энергетического баланса (относительный, доли): при
   * |residual| > tolerance * energyScale — numerical_failure.
   * По умолчанию 1e-6.
   */
  readonly energyBalanceRelativeTolerance?: number;
}

/** Опорная эпоха радиогенных источников: время t_ref, с — ОБЯЗАТЕЛЬНА при радиогенных источниках. */
export interface InteriorThermalEvolutionInput {
  readonly reservoirs: readonly ThermalReservoirSpec[];
  readonly pairLinks?: readonly ReservoirPairLink[];
  readonly boundaryLinks?: readonly BoundaryReservoirLink[];
  readonly timeAxis: InteriorThermalTimeAxis;
  /** Опорная эпоха exp-закона распада, с (t радиогенных масс). */
  readonly radiogenicEpochReferenceS?: number;
  readonly integration?: InteriorThermalIntegrationOptions;
  /** Происхождение тепловой модели (пользовательский контекст). */
  readonly modelProvenance?: string;
  /** Дополнительные явные допущения пользователя. */
  readonly extraAssumptions?: readonly string[];
}

// ============================================
// 2. ТИПЫ РЕЗУЛЬТАТА
// ============================================

export interface ThermalReservoirReport {
  readonly reservoirId: string;
  readonly initialTemperatureK: number;
  readonly finalTemperatureK: number;
  readonly heatCapacityJK: number;
  /** Изменение теплосодержания резервуара, J. */
  readonly internalEnergyChangeJ: number;
  readonly radiogenicMassEntriesKg: readonly { readonly nuclideId: string; readonly massKg: number }[];
  readonly constantTidalPowerW: number | null;
  readonly constantExternalLossPowerW: number | null;
  readonly boundaryLinkIds: readonly string[];
  readonly pairLinksAsEndpoint: readonly string[];
}

export interface ThermalSourceEnergyReport {
  /** Интегрированная энергия радиогенных источников по резервуарам, J. */
  readonly radiogenicEnergyJByReservoir: Readonly<Record<string, number>>;
  /** Интегрированные приливные энергии, J. */
  readonly tidalEnergyJByReservoir: Readonly<Record<string, number>>;
  /** Интегрированные внутренние переносы (подписанные: положительное — приток в A), J. */
  readonly pairTransferEnergyJ: readonly { readonly a: string; readonly b: string; readonly energyJ: number }[];
  /** Интегрированные потери через граничные связи, J (положительно — отток). */
  readonly boundaryLossEnergyJ: readonly { readonly reservoirId: string; readonly boundaryId: string | null; readonly energyJ: number }[];
  /** Интегрированные явные внешние потери, J. */
  readonly externalLossEnergyJByReservoir: Readonly<Record<string, number>>;
}

export interface ThermalEvolutionCompleted {
  readonly status: 'completed';
  readonly reservoirs: readonly ThermalReservoirReport[];
  readonly initialTemperaturesK: Readonly<Record<string, number>>;
  readonly finalTemperaturesK: Readonly<Record<string, number>>;
  readonly timePointsS: readonly number[];
  readonly sources: ThermalSourceEnergyReport;
  /** Изменение теплосодержания всей системы, J (sum C_i dT_i). */
  readonly systemInternalEnergyChangeJ: number;
  /** Суммарная интегрированная подача источников, J. */
  readonly totalSourceEnergyJ: number;
  /** Суммарные потери (граница + явные внешние), J. */
  readonly totalLossEnergyJ: number;
  /** Числовой остаток баланса: dU - (sources - losses), J. */
  readonly energyBalanceResidualJ: number;
  /** Относительный остаток к масштабу энергетического бюджета. */
  readonly energyBalanceRelativeResidual: number;
  readonly energyBalanceTolerance: number;
  readonly energyBalanceSatisfied: boolean;
  readonly integratorStats: Readonly<Record<string, number>>;
  readonly numericalMethod: string;
  readonly assumptions: readonly string[];
  readonly provenance: readonly string[];
}

export type InteriorThermalEvolutionResult =
  | ThermalEvolutionCompleted
  | { readonly status: 'invalid_input'; readonly issues: readonly string[] }
  | {
      readonly status: 'out_of_applicability';
      readonly reason: string;
      readonly detail: Readonly<Record<string, number | string | boolean | null>>;
      // прозрачность: данные о достигнутых температурах сохраняются
      readonly finalTemperaturesK: Readonly<Record<string, number>> | null;
    }
  | { readonly status: 'numerical_failure'; readonly reason: string; readonly stage: string; readonly energyBalanceResidualJ?: number };

// ============================================
// 3. ОПИСАНИЕ МЕТОДА
// ============================================

export const THERMAL_EVOLUTION_NUMERICAL_METHOD =
  'Radau IIA (ядро odeSolver, порядок 5, L-устойчивый, адаптивный шаг) над расширенным состоянием: '
  + 'температуры резервуаров + аккумуляторы интегрированных энергий источников/потерь; '
  + 'аналитический якобиан линейной системы; энергетический баланс проверяется после интегрирования '
  + 'без коррекции температур';

const DEFAULT_ENERGY_BALANCE_REL_TOLERANCE = 1e-6;

/** Предел размерности состояния Radau IIA. */
export const THERMAL_STATE_DIMENSION_LIMIT = 64;

/** Атомный шаг проверки: ln2 и экспонента распада. */
function finite(x: number): boolean {
  return Number.isFinite(x);
}

// ============================================
// 4. РЕШАТЕЛЬ
// ============================================

/**
 * Решение многорезервуарной тепловой эволюции с балансом энергии.
 * Все неизвестные параметры — fail-closed (invalid_input с перечнем).
 */
export function solveInteriorThermalEvolution(input: InteriorThermalEvolutionInput): InteriorThermalEvolutionResult {
  const issues: string[] = [];
  const { reservoirs, pairLinks = [], boundaryLinks = [] } = input;

  if (!Array.isArray(reservoirs) || reservoirs.length === 0) {
    return { status: 'invalid_input', issues: ['reservoirs: список резервуаров пуст — тепловая модель не определена (unknown), а не ноль'] };
  }

  // --- 4.1. Резервуары: строгая обработка неизвестных cp, массы, температуры.
  const reservoirIndexById = new Map<string, number>();
  const capacities: number[] = [];
  const provenanceLines: string[] = [];
  const missingByReservoir: string[] = [];

  reservoirs.forEach((reservoir, index) => {
    const id = String(reservoir.reservoirId);
    if (id.length === 0) {
      issues.push(`reservoirs[${index}]: пустой reservoirId`);
      return;
    }
    if (reservoirIndexById.has(id)) {
      issues.push(`reservoirs[${index}]: повторный reservoirId «${id}»`);
      return;
    }
    reservoirIndexById.set(id, index);

    if (!finite(reservoir.massKg as number) || (reservoir.massKg as number) <= 0) {
      missingByReservoir.push(`${id}: масса (massKg) неизвестна — теплова ёмкость не определена; нулевая подстановка запрещена`);
    }
    if (!finite(reservoir.specificHeatJPerKgK as number) || (reservoir.specificHeatJPerKgK as number) <= 0) {
      missingByReservoir.push(`${id}: удельная теплоёмкость (specificHeatJPerKgK) неизвестна — типичное значение камня/железа НЕ подставляется`);
    }
    if (!finite(reservoir.initialTemperatureK as number) || (reservoir.initialTemperatureK as number) <= 0) {
      missingByReservoir.push(`${id}: начальная температура (initialTemperatureK) неизвестна или не положительна — начальная тепловая энергия не определена`);
    }
    const range = reservoir.confirmedTemperatureRangeK;
    if (range !== undefined) {
      if (!finite(range.minK) || !finite(range.maxK) || !(range.maxK > range.minK)) {
        issues.push(`${id}: confirmedTemperatureRangeK должен быть конечным и maxK > minK`);
      } else if (finite(reservoir.initialTemperatureK as number)) {
        const t0r = reservoir.initialTemperatureK as number;
        if (t0r < range.minK) {
          issues.push(`${id}: начальная температура ${String(t0r)} K ниже подтверждённого диапазона [${String(range.minK)}, ${String(range.maxK)}] K`);
        } else if (t0r > range.maxK) {
          issues.push(`${id}: начальная температура ${String(t0r)} K выше подтверждённого диапазона [${String(range.minK)}, ${String(range.maxK)}] K`);
        }
      }
    }
    capacities.push(NaN); // заполняется ниже после валидации
  });
  reservoirs.forEach((reservoir, index) => {
    capacities[index] = (reservoir.massKg as number) * (reservoir.specificHeatJPerKgK as number);
  });

  if (missingByReservoir.length > 0) {
    issues.push(...missingByReservoir);
  }

  // --- 4.2. Радиогенные источники: массы нуклидов, опорная эпоха.
  interface ResolvedRadSource {
    readonly reservoir: number;
    readonly nuclideId: string;
    readonly massKg: number;
    readonly molarMassKgPerMol: number;
    readonly decayConstant_s1: number;
    readonly heatEnergyJ: number;
    readonly massRelativeUncertainty: number | null;
  }
  const resolvedRad: ResolvedRadSource[] = [];
  let hasRadiogenic = false;
  reservoirs.forEach((reservoir, index) => {
    for (const src of reservoir.radiogenicSources ?? []) {
      hasRadiogenic = true;
      const id = String(reservoir.reservoirId);
      if (!finite(src.massKg) || src.massKg <= 0) {
        issues.push(`${id}: радиогенный источник ${String(src.nuclideId)}: масса обязана быть конечной > 0 (${String(src.massKg)})`);
        continue;
      }
      if (typeof src.massProvenance !== 'string' || src.massProvenance.trim().length === 0) {
        issues.push(`${id}: радиогенный источник ${String(src.nuclideId)}: massProvenance обязателен (происхождение массы и состава)`);
        continue;
      }
      const record = tryGetRadiogenicNuclide(String(src.nuclideId));
      if (!record) {
        issues.push(`${id}: радиогенный источник: неизвестный nuclideId «${String(src.nuclideId)}»`);
        continue;
      }
      if (!record.heatEffectiveDecayEnergyKeV || !Number.isFinite(record.heatEffectiveDecayEnergyKeV)) {
        issues.push(`${id}: нуклид ${String(src.nuclideId)}: тепловая энергия распада неизвестна — вклад не считается нулём и не вычисляется`);
        continue;
      }
      resolvedRad.push({
        reservoir: index,
        nuclideId: record.nuclideId,
        massKg: src.massKg,
        molarMassKgPerMol: record.molarMassKgPerMol,
        decayConstant_s1: record.decayConstant_s1,
        heatEnergyJ: record.heatEffectiveDecayEnergyKeV * 1.602176634e-16,
        massRelativeUncertainty: src.massRelativeUncertainty ?? null
      });
    }
  });
  if (hasRadiogenic && !finite(input.radiogenicEpochReferenceS as number)) {
    issues.push('radiogenicEpochReferenceS: обязано быть конечным числом, если радиогенные источники заданы (опорная эпоха не выбирается молча)');
  }

  // --- 4.3. Приливные и явные внешние источники.
  interface ConstTidal { readonly reservoir: number; readonly powerW: number; }
  const constTidal: ConstTidal[] = [];
  reservoirs.forEach((reservoir, index) => {
    const id = String(reservoir.reservoirId);
    const tidal = reservoir.constantTidalSource;
    if (tidal !== undefined) {
      if (!finite(tidal.powerW) || tidal.powerW < 0) {
        issues.push(`${id}: constantTidalSource.powerW обязано быть конечным >= 0 (${String(tidal.powerW)})`);
      }
      if (tidal.mode !== 'constant_parameters_over_interval') {
        issues.push(`${id}: приливный источник принимает только явно объявленный режим constant_parameters_over_interval`);
      }
      if (typeof tidal.justification !== 'string' || tidal.justification.trim().length === 0) {
        issues.push(`${id}: constantTidalSource.justification обязателен`);
      }
      if (typeof tidal.provenance !== 'string' || tidal.provenance.trim().length === 0) {
        issues.push(`${id}: constantTidalSource.provenance обязателен (происхождение мощности)`);
      }
      constTidal.push({ reservoir: index, powerW: tidal.powerW });
    }
    const ext = reservoir.constantExternalLoss;
    if (ext !== undefined) {
      if (!finite(ext.powerW) || ext.powerW < 0) {
        issues.push(`${id}: constantExternalLoss.powerW обязано быть конечным >= 0 (положительное значение — отток) (${String(ext.powerW)})`);
      }
      if (typeof ext.provenance !== 'string' || ext.provenance.trim().length === 0) {
        issues.push(`${id}: constantExternalLoss.provenance обязателен`);
      }
    }
  });

  // --- 4.4. Связи: симметрия знаков, ссылочная целостность, илиридные conductances.
  for (let li = 0; li < pairLinks.length; li++) {
    const link = pairLinks[li];
    const a = String(link.reservoirIdA);
    const b = String(link.reservoirIdB);
    if (a === b) {
      issues.push(`pairLinks[${li}]: резервуары совпадают (${a}) — самосвязь недопустима`);
    }
    if (!reservoirIndexById.has(a)) {
      issues.push(`pairLinks[${li}]: неизвестный reservoirIdA «${a}»`);
    }
    if (!reservoirIndexById.has(b)) {
      issues.push(`pairLinks[${li}]: неизвестный reservoirIdB «${b}»`);
    }
    if (!finite(link.conductanceWPerK) || link.conductanceWPerK < 0) {
      issues.push(`pairLinks[${li}]: conductanceWPerK обязано быть конечным >= 0 (${String(link.conductanceWPerK)})`);
    }
    if (typeof link.conductanceProvenance !== 'string' || link.conductanceProvenance.trim().length === 0) {
      issues.push(`pairLinks[${li}]: conductanceProvenance обязателен (коэффициент НЕ выводится из PREM без данных о теплопроводности)`);
    }
  }
  for (let bi = 0; bi < boundaryLinks.length; bi++) {
    const link = boundaryLinks[bi];
    const id = String(link.reservoirId);
    if (!reservoirIndexById.has(id)) {
      issues.push(`boundaryLinks[${bi}]: неизвестный reservoirId «${id}»`);
    }
    if (!finite(link.boundaryTemperatureK) || link.boundaryTemperatureK < 0) {
      issues.push(`boundaryLinks[${bi}]: boundaryTemperatureK обязано быть конечным >= 0 (${String(link.boundaryTemperatureK)})`);
    }
    if (!finite(link.conductanceWPerK) || link.conductanceWPerK < 0) {
      issues.push(`boundaryLinks[${bi}]: conductanceWPerK обязано быть конечным >= 0 (${String(link.conductanceWPerK)})`);
    }
    if (typeof link.conductanceProvenance !== 'string' || link.conductanceProvenance.trim().length === 0) {
      issues.push(`boundaryLinks[${bi}]: conductanceProvenance обязателен`);
    }
  }

  // --- 4.5. Ось времени (строгое направление, секунды).
  if (!finite(input.timeAxis.startS) || !finite(input.timeAxis.endS)) {
    issues.push('timeAxis: startS/endS обязаны быть конечными числами (секунды)');
  } else if (!(input.timeAxis.endS > input.timeAxis.startS)) {
    issues.push(`timeAxis: строгое направление времени нарушено (endS ${String(input.timeAxis.endS)} <= startS ${String(input.timeAxis.startS)})`);
  }
  if (input.timeAxis.outputTimesS !== undefined) {
    const times = input.timeAxis.outputTimesS;
    for (let idx = 0; idx < times.length; idx++) {
      if (!finite(times[idx])) {
        issues.push(`timeAxis.outputTimesS[${idx}]: не конечное число`);
        break;
      }
      if (times[idx] < input.timeAxis.startS - 0 || times[idx] > input.timeAxis.endS) {
        issues.push(`timeAxis.outputTimesS[${idx}]: вне [startS, endS] (${String(times[idx])})`);
        break;
      }
      if (idx > 0 && times[idx] <= times[idx - 1]) {
        issues.push(`timeAxis.outputTimesS[${idx}]: контрольные времена обязаны строго возрастать`);
        break;
      }
    }
  }

  // --- 4.6. Опции интеграции.
  const integration = input.integration ?? {};
  const rtol = integration.rtol ?? 1e-8;
  const atol = integration.atol ?? 1e-6;
  const energyBalanceTolerance = integration.energyBalanceRelativeTolerance ?? DEFAULT_ENERGY_BALANCE_REL_TOLERANCE;
  if (!finite(rtol) || rtol <= 0) {
    issues.push(`integration.rtol: конечное > 0 ожидалось (${String(rtol)})`);
  }
  if ((typeof atol === 'number' && !finite(atol)) || (typeof atol !== 'number' && (atol as readonly number[]).some((a) => !finite(a)))) {
    issues.push('integration.atol: конечное число или массив конечных чисел ожидался');
  }
  if (!finite(energyBalanceTolerance) || energyBalanceTolerance <= 0) {
    issues.push(`integration.energyBalanceRelativeTolerance: конечное > 0 ожидалось (${String(energyBalanceTolerance)})`);
  }
  if (integration.maxSteps !== undefined && (!finite(integration.maxSteps) || integration.maxSteps < 1)) {
    issues.push(`integration.maxSteps: конечное целое >= 1 ожидалось (${String(integration.maxSteps)})`);
  }
  if (typeof input.modelProvenance !== 'undefined' && (typeof input.modelProvenance !== 'string' || input.modelProvenance.trim().length === 0)) {
    issues.push('modelProvenance: строка обязана быть непустой');
  }
  input.extraAssumptions?.forEach((a, idx) => {
    if (typeof a !== 'string' || a.trim().length === 0) {
      issues.push(`extraAssumptions[${idx}]: непустая строка ожидалась`);
    }
  });

  if (issues.length > 0) {
    return { status: 'invalid_input', issues };
  }

  // --- 4.7. Расширенное состояние: [T_0..T_{n-1}, аccумуляторы].
  const nT = reservoirs.length;
  // аккумуляторы: радиогенные по резервуарам с источниками; приливные; парные переносы; потери границы; явные внешние.
  interface AccSpec {
    readonly kind: 'radiogenic' | 'tidal' | 'pair' | 'boundary_loss' | 'external_loss';
    readonly reservoir: number;
    readonly pairIndex?: number;
    readonly boundaryIndex?: number;
    readonly dir?: 1 | -1; // пара: +1 приток в A, -1 отток из B — для отчёта
  }
  const accSpecs: AccSpec[] = [];
  for (let i = 0; i < nT; i++) {
    const hasRad = (reservoirs[i].radiogenicSources ?? []).length > 0;
    if (hasRad) accSpecs.push({ kind: 'radiogenic', reservoir: i });
    if (reservoirs[i].constantTidalSource !== undefined) accSpecs.push({ kind: 'tidal', reservoir: i });
    if (reservoirs[i].constantExternalLoss !== undefined) accSpecs.push({ kind: 'external_loss', reservoir: i });
  }
  for (let p = 0; p < pairLinks.length; p++) {
    accSpecs.push({ kind: 'pair', reservoir: reservoirIndexById.get(String(pairLinks[p].reservoirIdA)) as number, pairIndex: p, dir: 1 });
  }
  for (let b = 0; b < boundaryLinks.length; b++) {
    accSpecs.push({
      kind: 'boundary_loss',
      reservoir: reservoirIndexById.get(String(boundaryLinks[b].reservoirId)) as number,
      boundaryIndex: b
    });
  }

  const dimension = nT + accSpecs.length;
  if (dimension > THERMAL_STATE_DIMENSION_LIMIT) {
    return {
      status: 'invalid_input',
      issues: [`размерность расширенного состояния ${dimension} превышает лимит решателя ${THERMAL_STATE_DIMENSION_LIMIT} (${nT} температур + ${accSpecs.length} аккумуляторов)`]
    };
  }

  const accOffset = nT; // смещение аккумуляторов в y
  const radAccIndexByReservoir = new Map<number, number>();
  const tidalAccIndexByReservoir = new Map<number, number>();
  const extLossAccIndexByReservoir = new Map<number, number>();
  const pairAccIndexByLink = new Map<number, number>();
  const boundaryAccIndexByLink = new Map<number, number>();
  accSpecs.forEach((spec, idx) => {
    const stateIndex = accOffset + idx;
    if (spec.kind === 'radiogenic') radAccIndexByReservoir.set(spec.reservoir, stateIndex);
    else if (spec.kind === 'tidal') tidalAccIndexByReservoir.set(spec.reservoir, stateIndex);
    else if (spec.kind === 'external_loss') extLossAccIndexByReservoir.set(spec.reservoir, stateIndex);
    else if (spec.kind === 'pair') pairAccIndexByLink.set(spec.pairIndex as number, stateIndex);
    else boundaryAccIndexByLink.set(spec.boundaryIndex as number, stateIndex);
  });

  const t0 = input.timeAxis.startS;
  const tEnd = input.timeAxis.endS;
  const dtRefEpoch = (input.radiogenicEpochReferenceS as number) - t0; // сдвиг опорной эпохи радиогенных масс

  const pairLinksResolved = pairLinks.map((link) => ({
    a: reservoirIndexById.get(String(link.reservoirIdA)) as number,
    b: reservoirIndexById.get(String(link.reservoirIdB)) as number,
    k: link.conductanceWPerK
  }));
  const boundaryLinksResolved = boundaryLinks.map((link) => ({
    reservoir: reservoirIndexById.get(String(link.reservoirId)) as number,
    ts: link.boundaryTemperatureK,
    k: link.conductanceWPerK
  }));

  // Радиогенный поток резервуара i на момент t (Вт), через ядра распада.
  const reservoirRadiogenicPowerW = (reservoir: number, tNow: number): number => {
    let sum = 0;
    for (const src of resolvedRad) {
      if (src.reservoir !== reservoir) continue;
      sum += nuclidePowerAtTime(src.molarMassKgPerMol, src.decayConstant_s1, src.heatEnergyJ, src.massKg, tNow - (t0 + dtRefEpoch));
    }
    return sum;
  };
  const reservoirConstantTidalW = (reservoir: number): number =>
    reservoirs[reservoir].constantTidalSource?.powerW ?? 0;
  const reservoirConstantExternalLossW = (reservoir: number): number =>
    reservoirs[reservoir].constantExternalLoss?.powerW ?? 0;

  // --- 4.8. ODE-задача: правая часть и аналитический якобиан.
  const stateDimension = dimension;
  const initialTemps = reservoirs.map((r) => r.initialTemperatureK as number);
  const y0: number[] = new Array<number>(stateDimension);
  initialTemps.forEach((t, i) => { y0[i] = t; });
  for (let accIdx = 0; accIdx < accSpecs.length; accIdx++) y0[accOffset + accIdx] = 0;

  const rhs = (t: number, y: readonly number[]): number[] => {
    const dy: number[] = new Array<number>(stateDimension);
    // температуры
    for (let i = 0; i < nT; i++) {
      let flux = reservoirRadiogenicPowerW(i, t) + reservoirConstantTidalW(i);
      for (const pair of pairLinksResolved) {
        if (pair.a === i) flux += pair.k * (y[pair.b] - y[pair.a]);
        else if (pair.b === i) flux -= pair.k * (y[pair.b] - y[pair.a]);
      }
      for (const bl of boundaryLinksResolved) {
        if (bl.reservoir === i) flux -= bl.k * (y[i] - bl.ts);
      }
      flux -= reservoirConstantExternalLossW(i);
      dy[i] = flux / capacities[i];
    }
    // аккумуляторы
    for (let idx = 0; idx < accSpecs.length; idx++) {
      const spec = accSpecs[idx];
      let rate: number;
      switch (spec.kind) {
        case 'radiogenic':
          rate = reservoirRadiogenicPowerW(spec.reservoir, t);
          break;
        case 'tidal':
          rate = reservoirConstantTidalW(spec.reservoir);
          break;
        case 'external_loss':
          rate = reservoirConstantExternalLossW(spec.reservoir);
          break;
        case 'pair': {
          const pair = pairLinksResolved[spec.pairIndex as number];
          rate = pair.k * (y[pair.b] - y[pair.a]);
          break;
        }
        case 'boundary_loss': {
          const bl = boundaryLinksResolved[spec.boundaryIndex as number];
          rate = bl.k * (y[bl.reservoir] - bl.ts);
          break;
        }
      }
      dy[accOffset + idx] = rate;
    }
    return dy;
  };

  // аналитический якобиан линейной системы: dT-блок квадратный по температурам,
  // dAcc/dT — производные потоков, при этом dAcc/dT_acc = 0.
  const jacobian = (_t: number, _y: readonly number[]): number[][] => {
    const J: number[][] = [];
    for (let i = 0; i < stateDimension; i++) J.push(new Array<number>(stateDimension).fill(0));
    // Температурный блок: пары (a,b) с проводимостью k:
    //   df_a/dy_a += -k/C_a; df_a/dy_b += +k/C_a;
    //   df_b/dy_a += +k/C_b; df_b/dy_b += -k/C_b
    for (const pair of pairLinksResolved) {
      const Ca = capacities[pair.a];
      const Cb = capacities[pair.b];
      J[pair.a][pair.a] += -pair.k / Ca;
      J[pair.a][pair.b] += pair.k / Ca;
      J[pair.b][pair.a] += pair.k / Cb;
      J[pair.b][pair.b] += -pair.k / Cb;
    }
    // Граничные связи: J[i][i] += -k/C_i
    for (const bl of boundaryLinksResolved) {
      J[bl.reservoir][bl.reservoir] += -bl.k / capacities[bl.reservoir];
    }
    for (let idx = 0; idx < accSpecs.length; idx++) {
      const spec = accSpecs[idx];
      const row = accOffset + idx;
      switch (spec.kind) {
        case 'pair': {
          const pair = pairLinksResolved[spec.pairIndex as number];
          J[row][pair.a] = -pair.k;
          J[row][pair.b] = pair.k;
          break;
        }
        case 'boundary_loss': {
          const bl = boundaryLinksResolved[spec.boundaryIndex as number];
          J[row][bl.reservoir] = bl.k;
          break;
        }
        case 'tidal': {
          J[row][accOffset + idx] = 0; // константный поток
          break;
        }
        case 'external_loss': {
          J[row][accOffset + idx] = 0;
          break;
        }
        case 'radiogenic': {
          J[row][accOffset + idx] = 0; // поток не зависит от самого аккумулятора
          break;
        }
      }
    }
    return J;
  };

  const nonNegativeTempIndices: number[] = Array.from({ length: nT }, (_, i) => i);

  const problem: OdeSolverProblem = {
    kind: 'ode',
    stateDimension,
    t0,
    tEnd,
    y0,
    rhs,
    jacobian,
    nonNegativeIndices: nonNegativeTempIndices,
    description: 'тепловая эволюция внутренних резервуаров (Stage 4.7.3)'
  };
  const options: OdeSolverOptions = {
    rtol,
    atol,
    ...(integration.maxSteps !== undefined ? { maxSteps: integration.maxSteps } : {}),
    ...(input.timeAxis.outputTimesS !== undefined ? { tEval: input.timeAxis.outputTimesS } : {})
  };

  let solved: ReturnType<typeof solveOdeWithRadauIia>;
  try {
    solved = solveOdeWithRadauIia(problem, options);
  } catch (err) {
    if (err instanceof OdeSolverError) {
      return { status: 'numerical_failure', reason: err.message, stage: String(err.code) };
    }
    return { status: 'numerical_failure', reason: String((err as Error)?.message ?? err), stage: 'unknown' };
  }

  const finalState = solved.y;
  const finalTemperatures: Record<string, number> = {};
  const initialTemperaturesMap: Record<string, number> = {};
  reservoirs.forEach((r, i) => {
    const id = String(r.reservoirId);
    finalTemperatures[id] = finalState[i];
    initialTemperaturesMap[id] = initialTemps[i];
  });

  // --- 4.9. Подтверждённые диапазоны температур: выход за них = выход
  // за область применимости модели cp (данные отчётуются прозрачно).
  for (let i = 0; i < nT; i++) {
    const range = reservoirs[i].confirmedTemperatureRangeK;
    if (range !== undefined && finite(range.minK) && finite(range.maxK)) {
      const tf = finalState[i];
      if (tf < range.minK || tf > range.maxK) {
        return {
          status: 'out_of_applicability',
          reason: `резервуар «${String(reservoirs[i].reservoirId)}»: конечная температура ${String(tf)} K вне подтверждённого диапазона [${String(range.minK)}, ${String(range.maxK)}] K (модель постоянной cp вне него не доказана)`,
          detail: {
            reservoirId: String(reservoirs[i].reservoirId),
            confirmedMinK: range.minK,
            confirmedMaxK: range.maxK
          },
          finalTemperaturesK: finalTemperatures
        };
      }
    }
  }

  // --- 4.10. Энергетический баланс (Часть C5).
  let systemDU = 0;
  const reservoirReports: ThermalReservoirReport[] = [];
  const radEnergyByRes: Record<string, number> = {};
  const tidalEnergyByRes: Record<string, number> = {};
  const extLossByRes: Record<string, number> = {};
  const pairEnergies: { a: string; b: string; energyJ: number }[] = [];
  const boundaryEnergies: { reservoirId: string; boundaryId: string | null; energyJ: number }[] = [];

  for (let i = 0; i < nT; i++) {
    const id = String(reservoirs[i].reservoirId);
    const dU = capacities[i] * (finalState[i] - initialTemps[i]);
    systemDU += dU;

    let radE = 0;
    const radAccIndex = radAccIndexByReservoir.get(i);
    if (radAccIndex !== undefined) {
      radE = finalState[radAccIndex];
      radEnergyByRes[id] = radE;
    }
    let tidE = 0;
    const tidAccIndex = tidalAccIndexByReservoir.get(i);
    if (tidAccIndex !== undefined) {
      tidE = finalState[tidAccIndex];
      tidalEnergyByRes[id] = tidE;
    }
    let extE = 0;
    const extIndex = extLossAccIndexByReservoir.get(i);
    if (extIndex !== undefined) {
      extE = finalState[extIndex];
      extLossByRes[id] = extE;
    }
    reservoirReports.push({
      reservoirId: id,
      initialTemperatureK: initialTemps[i],
      finalTemperatureK: finalState[i],
      heatCapacityJK: capacities[i],
      internalEnergyChangeJ: dU,
      radiogenicMassEntriesKg: ((reservoirs[i].radiogenicSources ?? []) as readonly { nuclideId?: string; massKg?: number | null }[])
        .filter((s) => finite(s.massKg as number) && (s.massKg as number) > 0)
        .map((s) => ({ nuclideId: String(s.nuclideId), massKg: s.massKg as number })),
      constantTidalPowerW: reservoirs[i].constantTidalSource?.powerW ?? null,
      constantExternalLossPowerW: reservoirs[i].constantExternalLoss?.powerW ?? null,
      boundaryLinkIds: boundaryLinks
        .map((bl, idx) => (String(bl.reservoirId) === id ? (bl.boundaryId ?? `boundaryLinks[${idx}]`) : null))
        .filter((v): v is string => v !== null),
      pairLinksAsEndpoint: pairLinks
        .map((pl) => {
          const a = String(pl.reservoirIdA);
          const b = String(pl.reservoirIdB);
          if (a === id) return b;
          if (b === id) return a;
          return null;
        })
        .filter((v): v is string => v !== null)
    });
  }
  for (let p = 0; p < pairLinks.length; p++) {
    const idx = pairAccIndexByLink.get(p);
    // Аккумулятор парной связи интегрирует приток К РЕЗЕРВУАРУ a:
    // rate_acc = k·(T_b − T_a). Для отчёта знак инвертируется:
    // energyJ — энергия, ПЕРЕДАННАЯ от a к b (k·(T_a − T_b) в
    // интеграле), положительная при физическом потоке a → b
    // (a горячее b) и отрицательная при обратном потоке.
    const accForLink = idx !== undefined ? finalState[idx] : 0;
    pairEnergies.push({
      a: String(pairLinks[p].reservoirIdA),
      b: String(pairLinks[p].reservoirIdB),
      energyJ: -accForLink
    });
  }
  for (let b = 0; b < boundaryLinks.length; b++) {
    const idx = boundaryAccIndexByLink.get(b);
    boundaryEnergies.push({
      reservoirId: String(boundaryLinks[b].reservoirId),
      boundaryId: boundaryLinks[b].boundaryId ?? null,
      energyJ: idx !== undefined ? finalState[idx] : 0
    });
  }

  let totalSources = 0;
  let totalLosses = 0;
  for (const key of Object.keys(radEnergyByRes)) totalSources += radEnergyByRes[key];
  for (const key of Object.keys(tidalEnergyByRes)) totalSources += tidalEnergyByRes[key];
  for (const key of Object.keys(extLossByRes)) totalLosses += extLossByRes[key];
  for (const bl of boundaryEnergies) totalLosses += bl.energyJ;

  // Внутренние парные переносы в суммарном балансе НЕ участвуют:
  // они входят в уравнения двух резервуаров с противоположными
  // знаками и обязаны сократиться (проверка ниже — численная).
  const residual = systemDU - (totalSources - totalLosses);

  // масштаб бюджета для относительного остатка: максимум из |dU|,
  // притоков, оттоков и ВЕЛИЧИНЫ внутренних парных переносов.
  // Величина парных переносов нужна в знаменателе для конфигураций
  // с чисто внутренним обменом (аналитически dU = 0 и приток/отток = 0):
  // без неё относительный остаток считался бы от почти нулевого dU и
  // мог бы дать фиктивный numerical_failure; фактический переносимый
  // объём энергии через систему — именно парные потоки.
  const internalPairTransferMagnitudeJ = pairEnergies.reduce((s, p) => s + Math.abs(p.energyJ), 0);
  const budgetScale = Math.max(
    Math.abs(systemDU),
    Math.abs(totalSources),
    Math.abs(totalLosses),
    internalPairTransferMagnitudeJ,
    Number.MIN_VALUE
  );
  const relResidual = Math.abs(residual) / Math.max(budgetScale, Number.EPSILON);

  if (!(relResidual <= energyBalanceTolerance)) {
    return {
      status: 'numerical_failure',
      reason: `остаток энергетического баланса |${residual.toExponential(6)}| J превышает объявленный допуск (относительный ${relResidual.toExponential(3)} > ${String(energyBalanceTolerance)}); искусственная коррекция температур запрещена`,
      stage: 'energy_balance_check',
      energyBalanceResidualJ: residual
    };
  }

  // время отчётных точек: как просил вызывающий (tEval) либо единая итоговая точка
  const timePointsS = solved.points.map((p) => p.t);

  const assumptions: string[] = [
    'постоянная удельная теплоёмкость cp каждого резервуара в пределах подтверждённого (или объявленного) диапазона температур; температурно-зависимая cp и фазовые переходы не реализованы',
    'первичное (остаточное аккреционное) тепло отражено В НАЧАЛЬНОМ СОСТОЯНИИ; постоянный источник Q_primordial НЕ добавляется',
    'внутренние переносы консервативны: одна связь входит в уравнения двух резервуаров с противоположными знаками',
    'коэффициенты связей K и внешние потери — ЯВНЫЙ вход с provenance; из PREM или толщин слоёв они не выводятся',
    'радиогенные массы — массы РОДИТЕЛЬСКИХ НУКЛИДОВ; распад по exp-закону с нейтрино-исключенной тепловой энергией (каталог radiogenicNuclides)',
    'оси времени — секунды; годы переводятся только через Units.yearsToSeconds (юлианский год)'
  ];
  if (constTidal.length > 0) {
    assumptions.push('приливные мощности заданы в режиме constant_parameters_over_interval с обоснованием; за пределами интервала постоянство не утверждается');
  }
  if (input.extraAssumptions !== undefined) assumptions.push(...input.extraAssumptions);

  const stats = solved.stats;
  provenanceLines.push(...resolvedRad.map((src) =>
    `${src.nuclideId} (резервуар «${String(reservoirs[src.reservoir].reservoirId)}»): m0 = ${String(src.massKg)} kg, lambda = ${String(src.decayConstant_s1)} 1/с, E_H = ${String(src.heatEnergyJ / 1.602176634e-13)} MeV/цепочку`
  ));
  for (const tidal of constTidal) {
    provenanceLines.push(`приливная мощность резервуара «${String(reservoirs[tidal.reservoir].reservoirId)}»: ${tidal.powerW} W — ${String(reservoirs[tidal.reservoir].constantTidalSource?.provenance ?? '')}`);
  }
  if (typeof input.modelProvenance === 'string') provenanceLines.push(`модель: ${input.modelProvenance}`);

  const integratorStats: Record<string, number> = {
    attemptedSteps: stats.attemptedSteps,
    acceptedSteps: stats.acceptedSteps,
    rejectedSteps: stats.rejectedSteps,
    newtonFailures: stats.newtonFailures,
    rhsEvaluations: stats.rhsEvaluations,
    jacobianEvaluations: stats.jacobianEvaluations,
    luFactorizations: stats.luFactorizations,
    maxNewtonIterationsUsed: stats.maxNewtonIterationsUsed,
    maxAcceptedStepSize: stats.maxAcceptedStepSize,
    minAcceptedStepSize: stats.minAcceptedStepSize
  };

  return {
    status: 'completed',
    reservoirs: reservoirReports,
    initialTemperaturesK: initialTemperaturesMap,
    finalTemperaturesK: finalTemperatures,
    timePointsS,
    sources: {
      radiogenicEnergyJByReservoir: radEnergyByRes,
      tidalEnergyJByReservoir: tidalEnergyByRes,
      pairTransferEnergyJ: pairEnergies,
      boundaryLossEnergyJ: boundaryEnergies,
      externalLossEnergyJByReservoir: extLossByRes
    },
    systemInternalEnergyChangeJ: systemDU,
    totalSourceEnergyJ: totalSources,
    totalLossEnergyJ: totalLosses,
    energyBalanceResidualJ: residual,
    energyBalanceRelativeResidual: relResidual,
    energyBalanceTolerance,
    energyBalanceSatisfied: true,
    integratorStats,
    numericalMethod: THERMAL_EVOLUTION_NUMERICAL_METHOD,
    assumptions,
    provenance: provenanceLines
  };
}

// ============================================
// 5. УТИЛИТЫ ВРЕМЕННОЙ ОСИ
// ============================================

/**
 * Явный перевод лет в секунды (юлианский год, Units.YEAR_S).
 * Проецируется в публичный API, чтобы годовые интервалы не превращались
 * в зависимость от локальной даты или таймзоны.
 */
export const thermalYearsToSeconds = yearsToSeconds;

/** Юлианский год, с (для тестов и документации). */
export const THERMAL_YEAR_S = YEAR_S;

/** Пере-экспорт типа provenance для документного контракта. */
export type { DataProvenance as ThermalProvenance };
