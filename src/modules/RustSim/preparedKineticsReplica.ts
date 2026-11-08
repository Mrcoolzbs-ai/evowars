// ============================================
// PREPARED KINETICS REPLICA — prepared TypeScript путь
// Stage I (Persistent Rust/WASM Kinetics Session)
// ============================================
//
// Prepared TS — вторая архитектура честного сравнения Stage I:
// валидация/подготовка выполняются ОДИН раз (общая упаковка
// packPreparedKineticsParams), на каждом тике вычисление идёт
// НЕПОСРЕДСТВЕННО по подготовленным плоским числовым массивам:
// в горячем цикле НЕ создаются пообъектные представления реакций.
//
// Формулы и порядок числовых проверок зеркалит:
// - evaluateRateConstant (src/modules/Core/kinetics.ts);
// - evaluate_session_item
//   (rust/evowars-sim-core/src/kinetics_session.rs).
// Это числовая реплика для benchmark и parity-тестов Stage I;
// публичным API проекта остаётся evaluateRateConstant.
//
// [M]-конвенция тика: NaN = «не передан»; для arrhenius-реакции
// конечный [M] → invalid_input; для fall_off NaN/<= 0/∞ →
// invalid_third_body — идентично Rust-сессии.

export const KIN_STRIDE = 17;
export const KIN_DIAG_STRIDE = 5;

const ARRHENIUS_REFERENCE_TEMPERATURE_K = 300.0;
const UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K = 8.31446261815324;

const STATUS_OK = 0;
const STATUS_TEMPERATURE_OUT_OF_RANGE = 1;
const STATUS_INVALID_THIRD_BODY = 2;
const STATUS_NUMERICAL_FAILURE = 3;
const STATUS_INVALID_INPUT = 4;

const KIND_ARRHENIUS = 0.0;
const KIND_FALL_OFF = 1.0;
const ENERGY_FORM_E_OVER_R = 0.0;
const ENERGY_FORM_EA_J_MOL = 1.0;

/** k = A·(T/300)^n·exp(−Ea/(R·T)) по заявленной форме параметра. */
function arrheniusValueFlat(
  a: number,
  nExp: number,
  energyForm: number,
  energyValue: number,
  temperatureK: number
): number {
  const exponent =
    energyForm === ENERGY_FORM_E_OVER_R
      ? energyValue / temperatureK
      : energyValue / (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * temperatureK);
  return (
    a * Math.pow(temperatureK / ARRHENIUS_REFERENCE_TEMPERATURE_K, nExp) * Math.exp(-exponent)
  );
}

/** Реплика arrhenius_params_finite (kinetics.rs): [A, n, form, value, rMin, rMax]. */
function arrheniusParamsFiniteFlat(
  a: number,
  nExp: number,
  energyForm: number,
  energyValue: number,
  rangeMin: number,
  rangeMax: number
): boolean {
  return (
    Number.isFinite(a) &&
    Number.isFinite(nExp) &&
    (energyForm === ENERGY_FORM_E_OVER_R || energyForm === ENERGY_FORM_EA_J_MOL) &&
    Number.isFinite(energyValue) &&
    Number.isFinite(rangeMin) &&
    Number.isFinite(rangeMax)
  );
}

/** Prepared TS сессия: плоские параметры + переиспользуемые буферы тика. */
export interface PreparedTsKinetics {
  /** Число реакций. */
  readonly n: number;
  /** 17-слотовая раскладка параметров (слоты T/M не используются). */
  readonly params: Float64Array;
  /** kindMask: 0 = arrhenius, 1 = fall_off ([M]-конвенция). */
  readonly kindMask: Int32Array;
  /** Переиспользуемые выходные буферы тика. */
  readonly outK: Float64Array;
  readonly outDiag: Float64Array;
  readonly outStatus: Int32Array;
  /** Один тик: пишет в outK/outDiag/outStatus. */
  tick(temperaturesK: Float64Array, thirdBody: Float64Array): void;
}

/**
 * Подготовка prepared TS из общей плоской раскладки
 * (packPreparedKineticsParams — валидация уже выполнена) и kindMask.
 * Буферы tick выделены один раз и переиспользуются.
 */
export function prepareTsKinetics(params: Float64Array, kindMask: Int32Array): PreparedTsKinetics {
  if (params.length % KIN_STRIDE !== 0) {
    throw new Error(`prepareTsKinetics: длина params должна быть кратна ${KIN_STRIDE}`);
  }
  const n = params.length / KIN_STRIDE;
  if (kindMask.length !== n) {
    throw new Error(`prepareTsKinetics: kindMask.length должен быть ${n}`);
  }
  const outK = new Float64Array(n);
  const outDiag = new Float64Array(n * KIN_DIAG_STRIDE);
  const outStatus = new Int32Array(n);

  const tick = (temperaturesK: Float64Array, thirdBody: Float64Array): void => {
    if (temperaturesK.length !== n || thirdBody.length !== n) {
      throw new Error(`prepareTsKinetics tick: длины должны быть ${n}`);
    }
    for (let i = 0; i < n; i++) {
      const base = i * KIN_STRIDE;
      const kind = params[base];
      const t = temperaturesK[i];
      const m = thirdBody[i];
      const d = i * KIN_DIAG_STRIDE;
      // Диагностика по умолчанию — NaN (зеркалит ядро Rust).
      outK[i] = Number.NaN;
      outStatus[i] = STATUS_INVALID_INPUT;
      for (let j = 0; j < KIN_DIAG_STRIDE; j++) {
        outDiag[d + j] = Number.NaN;
      }

      if (!Number.isFinite(t) || t <= 0) {
        continue;
      }
      if (
        !Number.isFinite(params[base + 3]) ||
        !Number.isFinite(params[base + 4]) ||
        !Number.isFinite(params[base + 5]) ||
        !Number.isFinite(params[base + 6]) ||
        !Number.isFinite(params[base + 7]) ||
        !Number.isFinite(params[base + 8])
      ) {
        continue;
      }
      if (kind === KIND_ARRHENIUS) {
        if (
          !arrheniusParamsFiniteFlat(
            params[base + 3],
            params[base + 4],
            params[base + 5],
            params[base + 6],
            params[base + 7],
            params[base + 8]
          )
        ) {
          continue;
        }
        // TS пре-чек: аррениусовская запись + переданный [M].
        if (Number.isFinite(m)) {
          continue;
        }
        if (t < params[base + 7] || t > params[base + 8]) {
          outStatus[i] = STATUS_TEMPERATURE_OUT_OF_RANGE;
          continue;
        }
        const k = arrheniusValueFlat(
          params[base + 3],
          params[base + 4],
          params[base + 5],
          params[base + 6],
          t
        );
        if (!Number.isFinite(k) || k <= 0) {
          outStatus[i] = STATUS_NUMERICAL_FAILURE;
          continue;
        }
        outK[i] = k;
        outStatus[i] = STATUS_OK;
        continue;
      }
      if (kind !== KIND_FALL_OFF) {
        continue;
      }
      if (!Number.isFinite(m) || m <= 0) {
        outStatus[i] = STATUS_INVALID_THIRD_BODY;
        continue;
      }
      if (
        !Number.isFinite(params[base + 9]) ||
        !Number.isFinite(params[base + 10]) ||
        !Number.isFinite(params[base + 11]) ||
        !Number.isFinite(params[base + 12]) ||
        !Number.isFinite(params[base + 13]) ||
        !Number.isFinite(params[base + 14])
      ) {
        continue;
      }
      if (
        !arrheniusParamsFiniteFlat(
          params[base + 9],
          params[base + 10],
          params[base + 11],
          params[base + 12],
          params[base + 13],
          params[base + 14]
        )
      ) {
        continue;
      }
      const fc = params[base + 15];
      const broadening = params[base + 16];
      if (
        !Number.isFinite(fc) ||
        fc <= 0 ||
        fc > 1 ||
        !Number.isFinite(broadening) ||
        broadening <= 0
      ) {
        continue;
      }
      if (
        t < params[base + 7] ||
        t > params[base + 8] ||
        t < params[base + 13] ||
        t > params[base + 14]
      ) {
        outStatus[i] = STATUS_TEMPERATURE_OUT_OF_RANGE;
        continue;
      }
      const k0 = arrheniusValueFlat(
        params[base + 3],
        params[base + 4],
        params[base + 5],
        params[base + 6],
        t
      );
      const kInf = arrheniusValueFlat(
        params[base + 9],
        params[base + 10],
        params[base + 11],
        params[base + 12],
        t
      );
      if (!Number.isFinite(k0) || k0 <= 0 || !Number.isFinite(kInf) || kInf <= 0) {
        outStatus[i] = STATUS_NUMERICAL_FAILURE;
        continue;
      }
      const pr = (k0 * m) / kInf;
      const log10Pr = Math.log10(pr);
      const ratio = log10Pr / broadening;
      const f = Math.pow(fc, 1 / (1 + ratio * ratio));
      const k = ((k0 * m) / (1 + pr)) * f;
      outDiag[d] = k0;
      outDiag[d + 1] = kInf;
      outDiag[d + 2] = pr;
      outDiag[d + 3] = log10Pr;
      outDiag[d + 4] = f;
      if (!Number.isFinite(k) || k <= 0) {
        outStatus[i] = STATUS_NUMERICAL_FAILURE;
        outK[i] = Number.NaN;
        continue;
      }
      outK[i] = k;
      outStatus[i] = STATUS_OK;
    }
  };

  return { n, params, kindMask, outK, outDiag, outStatus, tick };
}

/** Статус prepared TS → код ошибки кинетики (карта из rustKinetics.ts). */
const STATUS_TO_CODE: Record<number, string> = {
  1: 'temperature_out_of_range',
  2: 'invalid_third_body',
  3: 'numerical_failure',
  4: 'invalid_input'
};

/** Код ошибки по статусу prepared TS (для parity-сравнений). */
export function preparedStatusToCode(status: number): string {
  const code = STATUS_TO_CODE[status];
  if (code === undefined) {
    throw new Error(`prepareTsKinetics: неизвестный статус ${status}`);
  }
  return code;
}
