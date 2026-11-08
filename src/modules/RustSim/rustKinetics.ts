// ============================================
// RUST KINETICS — TS-адаптер batch API числового ядра k(T)
// Stage H (Rust/WASM Performance Pilot)
// ============================================
//
// Разделение ответственности (Stage H):
// - TypeScript: validateKineticReactionRecord, статус unknown,
//   конвертация температуры в K, правила отсутствующих данных
//   (обязательность/запрещённость [M]), сборка RateConstantEvaluation
//   (единицы, dataStatus, provenance, uncertainty, appliedRangeK,
//   fall-off диагностика), коды ошибок — ВСЕ СУЩЕСТВУЮЩИЕ
//   публичные контракты kinetics.ts сохраняются;
// - Rust (kinetics.rs): числовое ядро — обе формы Аррениуса,
//   fall-off Lindemann+Troe, порядок числовых проверок и статусные
//   коды зеркалят evaluateRateConstant.
//
// Порядок пре-чеков адаптера = порядок нативного evaluateRateConstant:
// (1) валидация записи → invalid_input;
// (2) status unknown → no_kinetic_data;
// (3) температура в K (реплика temperatureInKelvin на публичном
//     API physicalQuantity) → invalid_input;
// (4) arrhenius + [M] → invalid_input; fall_off без [M] →
//     invalid_third_body; далее числовой путь в Rust.
//
// ## ABI (17 слотов f64 на операцию)
// [0] kind (0 = arrhenius, 1 = fall_off), [1] T, [2] M,
// [3..8] = низ/основная ветвь (A, n, energyForm 0/1, energyValue,
// rangeMin, rangeMax), [9..14] = ветвь k∞, [15] Fc, [16] N.
// Выходы: out_k (n), out_diag (5n: k0, kInf, Pr, log10Pr, F),
// out_status (n): 0 ok, 1 temperature_out_of_range,
// 2 invalid_third_body, 3 numerical_failure, 4 invalid_input.
// Коды отказа ABI: -1 длина params, -2 длины выходов.

import type {
  FallOffDiagnostics,
  KineticReactionRecord,
  KineticsErrorCode,
  RateConstantEvaluation,
  RateConstantEvaluationOptions
} from '../Core/kinetics';
import { validateKineticReactionRecord } from '../Core/kinetics';
import type { PhysicalQuantity } from '../Core/physicalQuantity';
import {
  convert,
  dimension,
  dimensionOf,
  isKnownUnit,
  sameDimension
} from '../Core/physicalQuantity';
import type { RustSimCoreWasm } from './rustSimCore';

export const KIN_STRIDE = 17;
export const KIN_DIAG_STRIDE = 5;

const TEMPERATURE_DIMENSION = dimension(0, 0, 0, 1);

/**
 * Реплика приватной temperatureInKelvin из kinetics.ts на публичном
 * API physicalQuantity (та же семантика и порядок отказов):
 * величина {value, unit}, конечное положительное число,
 * размерность кельвина; возвращает T в K.
 */
function temperatureInKelvin(temperature: PhysicalQuantity): { valueK: number } | { invalid: true } {
  if (temperature === null || typeof temperature !== 'object') {
    return { invalid: true };
  }
  const q = temperature as PhysicalQuantity;
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    return { invalid: true };
  }
  if (typeof q.unit !== 'string' || !isKnownUnit(q.unit) || !sameDimension(dimensionOf(q), TEMPERATURE_DIMENSION)) {
    return { invalid: true };
  }
  if (q.value <= 0) {
    return { invalid: true };
  }
  return { valueK: convert(q, 'K').value };
}

/** Результат одной операции batch-адаптера: успех или код отказа. */
export type RustRateConstantOutcome =
  | { ok: true; evaluation: RateConstantEvaluation }
  | { ok: false; code: KineticsErrorCode };

/** Упакованный пакет: плоские буферы + пре-чеки по каждой операции. */
export interface PackedKineticsBatch {
  params: Float64Array;
  outK: Float64Array;
  outDiag: Float64Array;
  outStatus: Int32Array;
  /** Индексы операций, дошедших до числового ядра (остальные — пре-чеки TS). */
  kernelIndices: number[];
  /** Коды отказа пре-чеков по индексу (undefined = попало в kernel). */
  precheckCodes: Array<KineticsErrorCode | undefined>;
  /** Контекст для сборки оценок: запись + T в K. */
  records: KineticReactionRecord[];
  temperaturesK: number[];
}

/**
 * Упаковка пакета кинетических операций: пре-чеки в нативном
 * порядке, затем 17 слотов f64 на операцию. Не вызывает WASM.
 */
export function packKineticsBatch(
  records: readonly KineticReactionRecord[],
  temperatures: readonly PhysicalQuantity[],
  options?: readonly (RateConstantEvaluationOptions | undefined)[]
): PackedKineticsBatch {
  const n = records.length;
  const params = new Float64Array(n * KIN_STRIDE);
  const precheckCodes: Array<KineticsErrorCode | undefined> = new Array(n).fill(undefined);
  const kernelIndices: number[] = [];
  const temperaturesK: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const record = records[i];
    const base = i * KIN_STRIDE;
    // (1) Валидация записи.
    const problems = validateKineticReactionRecord(record);
    if (problems.length > 0) {
      precheckCodes[i] = 'invalid_input';
      continue;
    }
    const rate = record.rateConstant;
    // (2) unknown → no_kinetic_data.
    if (rate.status === 'unknown') {
      precheckCodes[i] = 'no_kinetic_data';
      continue;
    }
    // (3) Температура в K.
    const t = temperatureInKelvin(temperatures[i]);
    if ('invalid' in t) {
      precheckCodes[i] = 'invalid_input';
      continue;
    }
    const temperatureK = t.valueK;
    temperaturesK[i] = temperatureK;
    // (4) Правила [M] по виду параметризации.
    const m = options?.[i]?.thirdBodyConcentration;
    const paramsKind = rate.parameters.kind;
    if (paramsKind === 'arrhenius') {
      if (m !== undefined) {
        precheckCodes[i] = 'invalid_input';
        continue;
      }
      const p = rate.parameters.arrhenius;
      const energyForm = p.energy.form === 'E_over_R' ? 0 : 1;
      const energyValue = p.energy.form === 'E_over_R' ? p.energy.valueK : p.energy.valueJPerMol;
      params[base + 0] = 0; // kind: arrhenius
      params[base + 1] = temperatureK;
      params[base + 2] = 0;
      params[base + 3] = p.preExponentialA;
      params[base + 4] = p.temperatureExponentN;
      params[base + 5] = energyForm;
      params[base + 6] = energyValue;
      params[base + 7] = p.temperatureRangeK.min;
      params[base + 8] = p.temperatureRangeK.max;
      for (let j = 9; j < KIN_STRIDE; j++) {
        params[base + j] = 0;
      }
      kernelIndices.push(i);
      continue;
    }
    // fall_off.
    if (m === undefined) {
      precheckCodes[i] = 'invalid_third_body';
      continue;
    }
    const fp = rate.parameters.fallOff;
    const lo = fp.lowPressureLimit;
    const hi = fp.highPressureLimit;
    params[base + 0] = 1; // kind: fall_off
    params[base + 1] = temperatureK;
    params[base + 2] = m;
    params[base + 3] = lo.preExponentialA;
    params[base + 4] = lo.temperatureExponentN;
    params[base + 5] = lo.energy.form === 'E_over_R' ? 0 : 1;
    params[base + 6] = lo.energy.form === 'E_over_R' ? lo.energy.valueK : lo.energy.valueJPerMol;
    params[base + 7] = lo.temperatureRangeK.min;
    params[base + 8] = lo.temperatureRangeK.max;
    params[base + 9] = hi.preExponentialA;
    params[base + 10] = hi.temperatureExponentN;
    params[base + 11] = hi.energy.form === 'E_over_R' ? 0 : 1;
    params[base + 12] = hi.energy.form === 'E_over_R' ? hi.energy.valueK : hi.energy.valueJPerMol;
    params[base + 13] = hi.temperatureRangeK.min;
    params[base + 14] = hi.temperatureRangeK.max;
    params[base + 15] = fp.centeringFactorFc;
    params[base + 16] = fp.broadeningN;
    kernelIndices.push(i);
  }

  return {
    params,
    outK: new Float64Array(n),
    outDiag: new Float64Array(n * KIN_DIAG_STRIDE),
    outStatus: new Int32Array(n),
    kernelIndices,
    precheckCodes,
    records: records.slice(),
    temperaturesK
  };
}

/** Статус Rust → код ошибки kinetics. */
const STATUS_TO_CODE: Record<number, KineticsErrorCode> = {
  1: 'temperature_out_of_range',
  2: 'invalid_third_body',
  3: 'numerical_failure',
  4: 'invalid_input'
};

/**
 * Вызов WASM-ядра на упакованном пакете и сборка исходов.
 * Все операции, отброшенные пре-чеками TS, получают свои коды;
 * операции числового ядра — статусы Rust. Бросает только при
 * отказе самого ABI (инфраструктурная ошибка, не контракт кинетики).
 */
export function runKineticsBatch(
  core: RustSimCoreWasm,
  packed: PackedKineticsBatch
): RustRateConstantOutcome[] {
  const rc = core.evowars_kinetics_batch(packed.params, packed.outK, packed.outDiag, packed.outStatus);
  if (rc !== 0) {
    throw new Error(`Rust kinetics batch ABI error: ${rc}`);
  }
  const n = packed.records.length;
  const outcomes: RustRateConstantOutcome[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const precheck = packed.precheckCodes[i];
    if (precheck !== undefined) {
      outcomes[i] = { ok: false, code: precheck };
      continue;
    }
    const status = packed.outStatus[i];
    if (status !== 0) {
      const code = STATUS_TO_CODE[status];
      if (code === undefined) {
        throw new Error(`Rust kinetics batch: неизвестный статус ${status} (операция ${i})`);
      }
      outcomes[i] = { ok: false, code };
      continue;
    }
    const record = packed.records[i];
    const rate = record.rateConstant;
    if (rate.status === 'unknown') {
      // Недостижимо после пре-чеков упаковки (unknown перехвачен
      // выше как no_kinetic_data), но сужение типа требуется здесь.
      outcomes[i] = { ok: false, code: 'no_kinetic_data' };
      continue;
    }
    const dataStatus = rate.status;
    const temperatureK = packed.temperaturesK[i];
    if (rate.parameters.kind === 'arrhenius') {
      const p = rate.parameters.arrhenius;
      const evaluation: RateConstantEvaluation = {
        value: packed.outK[i],
        unit: p.unit,
        concentrationModel: record.concentrationModel,
        dataStatus,
        estimationMethod: rate.status === 'estimated' ? rate.method : undefined,
        temperatureK,
        appliedRangeK: { min: p.temperatureRangeK.min, max: p.temperatureRangeK.max },
        uncertainty: p.uncertainty,
        provenance: p.provenance
      };
      outcomes[i] = { ok: true, evaluation };
      continue;
    }
    const fp = rate.parameters.fallOff;
    const lo = fp.lowPressureLimit;
    const hi = fp.highPressureLimit;
    const d = i * KIN_DIAG_STRIDE;
    const fallOff: FallOffDiagnostics = {
      lowPressureLimit: packed.outDiag[d],
      highPressureLimit: packed.outDiag[d + 1],
      reducedPressure: packed.outDiag[d + 2],
      log10ReducedPressure: packed.outDiag[d + 3],
      broadeningFactor: packed.outDiag[d + 4]
    };
    const evaluation: RateConstantEvaluation = {
      value: packed.outK[i],
      unit: hi.unit,
      concentrationModel: record.concentrationModel,
      dataStatus,
      estimationMethod: rate.status === 'estimated' ? rate.method : undefined,
      temperatureK,
      appliedRangeK: {
        min: Math.max(lo.temperatureRangeK.min, hi.temperatureRangeK.min),
        max: Math.min(lo.temperatureRangeK.max, hi.temperatureRangeK.max)
      },
      // Неопределённость эффективной fall-off константы не выводится
      // (правило комбинирования не моделируется) — как в 4.5.2.
      provenance: fp.provenance,
      fallOff
    };
    outcomes[i] = { ok: true, evaluation };
  }
  return outcomes;
}

/**
 * Полный batch-путь: упаковка (пре-чеки TS) → один вызов WASM →
 * распаковка. Для каждой операции — исход, эквивалентный нативному
 * evaluateRateConstant (значение или код отказа).
 */
export function evalRateConstantsRustBatch(
  core: RustSimCoreWasm,
  records: readonly KineticReactionRecord[],
  temperatures: readonly PhysicalQuantity[],
  options?: readonly (RateConstantEvaluationOptions | undefined)[]
): RustRateConstantOutcome[] {
  const packed = packKineticsBatch(records, temperatures, options);
  return runKineticsBatch(core, packed);
}
