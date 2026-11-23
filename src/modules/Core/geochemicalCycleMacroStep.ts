// ============================================
// GEOCHEMICAL CYCLE MACRO STEP — детерминированная склейка геохимических
// фаз macro-шага поверх production-исполнителей Stage 4.9a/4.9d/4.9e/4.9f
// (Stage 4.9g)
// ============================================
//
// ЧТО ЭТО:
// - ОДИН детерминированный macro-шаг циклической последовательности
//   геохимических фаз: transport (FluxLedger, Stage 4.9a),
//   co2_phase_exchange (Stage 4.9e) и mineral_cycle (Stage 4.9f, поверх
//   coupled-исполнителя Stage 4.9d);
// - независимый элементно-зарядовый аудит состояния (elementTotals /
//   chargeTotal из species.ts, Stage 4.1) ДО и ПОСЛЕ macro-шага —
//   независимый оракул инвентарей, не доверяющий журналам;
// - макро-атомарность: все фазы применяются на одном макро-шаге или
//   ни одна (исполнители иммутабельны: при отказе любой фазы
//   возвращается ИСХОДНОЕ состояние).
//
// ЧТО ЭТО НЕ ЭТО:
// - НЕ второй реакционный движок, НЕ второй журнал и НЕ обходной путь
//   мимо аудита: каждая фаза идёт через существующие production-API с
//   их собственной атомарностью, анти-replay, stale-snapshot защитой,
//   стехиометрическим/элементным/зарядовым аудитом и финальной
//   validateWorldState;
// - НЕ планировщик: порядок фаз задаёт вызывающая сторона ЯВНЫМ
//   списком (детерминированная последовательность, эквивалентная
//   Lie-расщеплению Scheduler Stage 4.2.1); WorldClock/SimulationClock
//   продвигает вызывающая сторона; длительности фаз — явные входы;
// - НЕ источник скоростей: количество каждой фазы (extent/mol) либо
//   приходит из planGeochemicalKineticExtents (geochemicalKinetics.ts),
//   либо из явного входа с provenance; unknown-процессы в numerical
//   вклады не попадают.
//
// Единицы: столбовые запасы mol/m² (basis column_amount); длительности
// transport-фаз — секунды; кинетические скорости — mol·m⁻²·yr⁻¹;
// перевод года в секунды — только через GEOCHEMICAL_YEAR_S
// (geochemicalFluxes.ts). Второй системы единиц нет.

import type { CoreWorldState } from './worldState';
import { validateWorldState } from './worldState';
import type { SpeciesCatalog } from './species';
import { chargeTotal, elementTotals } from './species';
import type { FluxTime } from './fluxLedger';
import type { ReservoirRecord } from './reservoir';
import type { GeochemicalProcessSpec } from './geochemicalFluxes';
import { executeGeochemicalProcess } from './geochemicalFluxes';
import type { CO2PhaseExchangeInput } from './co2ExchangeExecution';
import { executeCO2PhaseExchange } from './co2ExchangeExecution';
import type { CarbonateMineralCycleInput } from './carbonateMineralExecution';
import { executeCarbonateMineralCycle } from './carbonateMineralExecution';

// ============================================
// 1. ЭЛЕМЕНТНЫЙ СНИМОК СОСТОЯНИЯ (независимый оракул)
// ============================================

export interface GeochemicalElementSnapshot {
  /** Суммарные атомные количества по элементам (все резервуары). */
  readonly totals: Record<string, number>;
  /** Суммарный модельный заряд инвентарей, единицы элементарного заряда. */
  readonly charge: number;
  /** Виды, отсутствующие в каталоге (состав неизвестен, НЕ заменён нулём). */
  readonly excludedSpecies: readonly string[];
  /** Резервуары без material и без 'not_applicable': запас НЕИЗВЕСТЕН. */
  readonly unknownMaterialReservoirs: readonly string[];
  /** Резервуары с non-column_amount базой (для строгих проверок). */
  readonly mismatchedBasis: readonly string[];
}

/**
 * Снимок суммарных элементных количеств и заряда состояния.
 * Слагает материальные инвентари ВСЕХ резервуаров; резервуар без
 * material не считается нулём: он попадает в unknownMaterialReservoirs
 * (если только не объявлен 'not_applicable' явно).
 */
export function geochemicalElementSnapshot(catalog: SpeciesCatalog, core: CoreWorldState): GeochemicalElementSnapshot {
  const counts: Record<string, number> = {};
  const excluded = new Set<string>();
  const unknownMaterial: string[] = [];
  const mismatched: string[] = [];
  const bases = new Set<string>();
  for (const reservoir of core.reservoirs) {
    if (reservoir.material === undefined) {
      if (reservoir.materialApplicability !== 'not_applicable') {
        unknownMaterial.push(reservoir.id);
      }
      continue;
    }
    if (reservoir.material.basis !== 'column_amount') {
      mismatched.push(reservoir.id + ':' + reservoir.material.basis);
    }
    bases.add(reservoir.material.basis);
    for (const [speciesId, amount] of Object.entries(reservoir.material.entries)) {
      counts[speciesId] = (counts[speciesId] ?? 0) + amount;
    }
  }
  const totals = elementTotals(catalog, counts);
  for (const id of totals.excludedSpecies) excluded.add(id);
  const charge = chargeTotal(catalog, counts);
  for (const id of charge.excludedSpecies) excluded.add(id);
  return {
    totals: totals.totals,
    charge: charge.charge,
    excludedSpecies: [...excluded].sort(),
    unknownMaterialReservoirs: unknownMaterial,
    mismatchedBasis: mismatched
  };
}

/**
 * Относительная и абсолютная невязки элементного баланса двух снимков
 * (independent oracle: сравнение фактических инвентарей, не журналов).
 */
export function geochemicalElementResidual(
  before: GeochemicalElementSnapshot,
  after: GeochemicalElementSnapshot
): { readonly absolute: Record<string, number>; readonly relative: Record<string, number> } {
  const absolute: Record<string, number> = {};
  const relative: Record<string, number> = {};
  const elements = new Set([...Object.keys(before.totals), ...Object.keys(after.totals)]);
  for (const element of elements) {
    const b = before.totals[element] ?? 0;
    const a = after.totals[element] ?? 0;
    absolute[element] = a - b;
    relative[element] = b !== 0 ? (a - b) / Math.abs(b) : (a === 0 ? 0 : (a - b) / Math.max(Math.abs(a), Number.MIN_VALUE));
  }
  return { absolute, relative };
}

// ============================================
// 2. ФАЗЫ MACRO-ШАГА И ИХ ИСПОЛНЕНИЕ
// ============================================

/**
 * Фаза macro-шага. Порядок фаз в списке — детерминированный порядок
 * применения (Lie-последовательность): каждая фаза применяется к
 * результату предыдущей; при отказе любой — шаг не применён целиком.
 */
export type GeochemicalMacroStepPhase =
  | {
      /** Перенос одного вида (FluxLedger, Stage 4.9a; production-путь каталога). */
      readonly kind: 'transport';
      readonly spec: GeochemicalProcessSpec;
      readonly fluxId: string;
      /** Длительность интегрирования переноса, с (> 0). */
      readonly durationS: number;
      readonly time?: FluxTime | null;
      readonly note?: string;
    }
  | {
      /** Фазовый переход CO2(г) ⇌ CO2(aq) (Stage 4.9e). */
      readonly kind: 'co2_phase_exchange';
      readonly input: CO2PhaseExchangeInput;
    }
  | {
      /** Минеральный цикл кальцита/арагонита (Stage 4.9f, поверх 4.9d). */
      readonly kind: 'mineral_cycle';
      readonly input: CarbonateMineralCycleInput;
    };

/** Результат одной применённой фазы (краткая сводка). */
export interface GeochemicalPhaseSummary {
  readonly kind: GeochemicalMacroStepPhase['kind'];
  readonly applied: true;
  readonly transactionIdOrFluxId: string;
  readonly processId: string | null;
}

/** Полный результат macro-шага. */
export type GeochemicalMacroStepResult =
  | {
      readonly status: 'applied';
      /** НОВОЕ состояние ядра (все фазы применены); вход не мутируется. */
      readonly core: CoreWorldState;
      readonly appliedPhases: readonly GeochemicalPhaseSummary[];
      readonly elementBefore: GeochemicalElementSnapshot;
      readonly elementAfter: GeochemicalElementSnapshot;
    }
  | {
      readonly status: 'not_applied';
      /** Индекс фазы, на которой шаг прерван (остальные не выполнялись). */
      readonly failedPhaseIndex: number;
      readonly failedKind: GeochemicalMacroStepPhase['kind'];
      readonly reasonKind: string;
      readonly reason: string;
      readonly issues: readonly string[];
      readonly error: string | null;
      /** ИСХОДНОЕ состояние (макро-атомарность: вход ссылочно не тронут). */
      readonly core: CoreWorldState;
      readonly appliedPhases: readonly GeochemicalPhaseSummary[];
    };

function reservoirsUpdated(core: CoreWorldState, updated: Record<string, ReservoirRecord>): CoreWorldState {
  return {
    ...core,
    reservoirs: core.reservoirs.map((reservoir) => (updated[reservoir.id] !== undefined && updated[reservoir.id] !== reservoir ? updated[reservoir.id] : reservoir))
  };
}

/**
 * Исполнить ОДИН макро-шаг из фиксированной последовательности фаз.
 *
 * Гарантии макро-атомарности:
 * - каждая фаза применяет production-исполнитель (атомарность, анти-replay,
 *   stale snapshot, стехиометрия, заряд, validateWorldState — внутри);
 * - при отказе фазы отдавать результат ИСХОДНОГО state (ссылочно
 *   неизменённого); промежуточные состояния не «протекают» наружу;
 * - ведущий журнал применённых фаз (appliedPhases) сверяется вызывающей
 *   стороной с дельтами ReactionLedger/FluxLedger/geochemicalTransactionLog
 *   (проверка двойного применения — в тестах 4.9g).
 */
export function runGeochemicalMacroStep(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  phases: readonly GeochemicalMacroStepPhase[]
): GeochemicalMacroStepResult {
  const elementBefore = geochemicalElementSnapshot(speciesCatalog, core);
  if (phases.length === 0) {
    return {
      status: 'not_applied',
      failedPhaseIndex: -1,
      failedKind: 'transport',
      reasonKind: 'not_executable',
      reason: 'macro-шаг без фаз: пустая последовательность не является применением',
      issues: [],
      error: null,
      core,
      appliedPhases: []
    };
  }
  let current = core;
  const appliedPhases: GeochemicalPhaseSummary[] = [];
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index];
    if (phase.kind === 'transport') {
      const result = executeGeochemicalProcess(phase.spec, {
        speciesCatalog,
        reservoirs: Object.fromEntries(current.reservoirs.map((r): [string, ReservoirRecord] => [r.id, r])),
        ledgerInput: current.fluxLedger
      }, {
        fluxId: phase.fluxId,
        durationS: phase.durationS,
        ...(phase.time !== undefined ? { time: phase.time } : {}),
        ...(phase.note !== undefined ? { note: phase.note } : {})
      });
      if (result.status !== 'applied') {
        return {
          status: 'not_applied',
          failedPhaseIndex: index,
          failedKind: phase.kind,
          reasonKind: 'not_executable',
          reason: result.reason,
          issues: result.issues,
          error: result.error,
          core,
          appliedPhases
        };
      }
      current = reservoirsUpdated(current, result.reservoirs);
      current = { ...current, fluxLedger: result.ledger };
      appliedPhases.push({ kind: phase.kind, applied: true, transactionIdOrFluxId: result.fluxId, processId: phase.spec.processId });
    } else if (phase.kind === 'co2_phase_exchange') {
      const result = executeCO2PhaseExchange(current, speciesCatalog, phase.input);
      if (result.status !== 'applied') {
        return {
          status: 'not_applied',
          failedPhaseIndex: index,
          failedKind: phase.kind,
          reasonKind: result.reasonKind,
          reason: result.reason,
          issues: result.issues,
          error: result.error,
          core,
          appliedPhases
        };
      }
      current = result.core;
      appliedPhases.push({ kind: phase.kind, applied: true, transactionIdOrFluxId: result.transactionId, processId: result.processId });
    } else {
      const result = executeCarbonateMineralCycle(current, speciesCatalog, phase.input);
      if (result.status !== 'applied') {
        return {
          status: 'not_applied',
          failedPhaseIndex: index,
          failedKind: phase.kind,
          reasonKind: result.reasonKind,
          reason: result.reason,
          issues: result.issues,
          error: result.error,
          core,
          appliedPhases
        };
      }
      current = result.core;
      appliedPhases.push({ kind: phase.kind, applied: true, transactionIdOrFluxId: result.transactionId, processId: result.processId });
    }
  }
  const finalCheck = validateWorldState(current);
  if (finalCheck.length > 0) {
    return {
      status: 'not_applied',
      failedPhaseIndex: phases.length - 1,
      failedKind: phases[phases.length - 1].kind,
      reasonKind: 'not_executable',
      reason: 'результирующее состояние macro-шага не прошло validateWorldState; применение откачено к исходному состоянию',
      issues: finalCheck.map((issue) => issue.code + ' (' + issue.component + '): ' + issue.message),
      error: null,
      core,
      appliedPhases
    };
  }
  const elementAfter = geochemicalElementSnapshot(speciesCatalog, current);
  return { status: 'applied', core: current, appliedPhases, elementBefore, elementAfter };
}

// ============================================
// 3. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// — transport-фазы собираются вызывающей стороной из spec каталога (или
//   идентифицированной фикстуры) с durationS ЯВНО; extent из
//   planGeochemicalKineticExtents передавать в инвентарь наобум
//   запрещено: transfer-фаза молча не «протаскивает» количество мимо
//   интегрирования скорости (stage 4.9a executor сам интегрирует rate × Δt);
// — co2_phase_exchange и mineral_cycle получают ВВОД адаптеров Stage
//   4.9e/4.9f без переупаковки: никакой второй семантики входов нет.
