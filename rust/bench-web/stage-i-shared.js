// ============================================
// STAGE I — SHARED (браузерный benchmark)
// Persistent Rust/WASM Kinetics Session
// ============================================
//
// Общий модуль браузерного benchmark Stage I. Импортируется и
// модулем страницы rust/bench-web/stage-i.html (main-thread
// контраст: блокирующий тик на главном потоке), и модулем Worker
// rust/bench-web/stage-i-worker.js (основные измерения).
//
// JS-порт числовой реплики preparedKineticsReplica.ts: формулы и
// порядок проверок идентичны (parity с WASM-сессией проверяется
// в воркере перед каждым измерением). В горячем цикле — только
// плоские массивы, никаких пообъектных представлений реакций.

export const KIN_STRIDE = 17;
export const DIAG_STRIDE = 5;
export const WARMUP_RUNS = 3;
export const SAMPLES = 12;
export const MIN_SAMPLE_MS = 40;
export const MAX_ITERATIONS_PER_SAMPLE = 1000;

export const STATUS_OK = 0;
export const STATUS_TEMPERATURE_OUT_OF_RANGE = 1;
export const STATUS_INVALID_THIRD_BODY = 2;
export const STATUS_NUMERICAL_FAILURE = 3;
export const STATUS_INVALID_INPUT = 4;
const KIND_ARRHENIUS = 0;
const KIND_FALL_OFF = 1;

// --- mulberry32: тот же PRNG, что в workloads.ts / evowars_bench.rs ---
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Плоская нагрузка: та же последовательность rand(), что
 * buildKineticsParams в index.html (Stage H) и buildKineticsWorkload
 * (scripts/benchmarks/workloads.ts). Возвращает 17-слотовые
 * параметры с T/M в слотах [1]/[2] (для preparedTS) и отдельную
 * копию с обнулёнными T/M (для конструктора WASM-сессии: тик
 * принимает T и [M] аргументами).
 */
export function buildLoad(n) {
  const rand = mulberry32(0x12345678);
  const params = new Float64Array(n * KIN_STRIDE);
  const kindMask = new Int32Array(n);
  const temps = new Float64Array(n);
  const third = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const isFallOff = i % 4 === 0;
    const useEa = i % 2 === 0;
    const a = 10 ** (-12 + 6 * rand());
    const nExp = 3 * (rand() - 1);
    const energy = 6000 * (rand() - 0.3);
    const t = 250 + 1500 * rand();
    const energyForm = useEa ? 1 : 0;
    temps[i] = t;
    const base = i * KIN_STRIDE;
    if (isFallOff) {
      const a0 = 10 ** (-32 + 4 * rand());
      const aInf = 10 ** (-12 + 4 * rand());
      const fc = 0.2 + 0.7 * rand();
      const nb = 0.5 + rand();
      const m = 10 ** (17 + 5 * rand());
      third[i] = m;
      kindMask[i] = 1;
      params.set(
        [1, t, m, a0, nExp, energyForm, energy, 200, 2000, aInf, nExp, energyForm, energy, 200, 2000, fc, nb],
        base
      );
    } else {
      third[i] = Number.NaN; // [M] «не передан»
      kindMask[i] = 0;
      params.set([0, t, 0, a, nExp, energyForm, energy, 200, 2000, 0, 0, 0, 0, 0, 0, 0, 0], base);
    }
  }
  const sessionParams = new Float64Array(params);
  for (let i = 0; i < n; i++) {
    sessionParams[i * KIN_STRIDE + 1] = 0;
    sessionParams[i * KIN_STRIDE + 2] = 0;
  }
  return { params, sessionParams, kindMask, temps, third };
}

// --- JS-порт preparedKineticsReplica.ts (формулы идентичны) ---
const GAS_R = 8.31446261815324;
const REF_T = 300.0;

function arrheniusValueFlat(a, nExp, energyForm, energyValue, temperatureK) {
  const exponent =
    energyForm === 0 ? energyValue / temperatureK : energyValue / (GAS_R * temperatureK);
  return a * Math.pow(temperatureK / REF_T, nExp) * Math.exp(-exponent);
}

function arrheniusParamsFiniteFlat(a, nExp, energyForm, energyValue, rangeMin, rangeMax) {
  return (
    Number.isFinite(a) &&
    Number.isFinite(nExp) &&
    (energyForm === 0 || energyForm === 1) &&
    Number.isFinite(energyValue) &&
    Number.isFinite(rangeMin) &&
    Number.isFinite(rangeMax)
  );
}

/** Prepared TS: выделение буферов один раз; tick — только плоские массивы. */
export function prepareTsPort(params, kindMask) {
  const n = params.length / KIN_STRIDE;
  const outK = new Float64Array(n);
  const outDiag = new Float64Array(n * DIAG_STRIDE);
  const outStatus = new Int32Array(n);
  function tick(temperaturesK, thirdBody) {
    for (let i = 0; i < n; i++) {
      const base = i * KIN_STRIDE;
      const kind = params[base];
      const t = temperaturesK[i];
      const m = thirdBody[i];
      const d = i * DIAG_STRIDE;
      outK[i] = Number.NaN;
      outStatus[i] = STATUS_INVALID_INPUT;
      for (let j = 0; j < DIAG_STRIDE; j++) {
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
            params[base + 3], params[base + 4], params[base + 5],
            params[base + 6], params[base + 7], params[base + 8]
          )
        ) {
          continue;
        }
        if (Number.isFinite(m)) {
          continue; // аррениусовская запись + [M] → invalid_input
        }
        if (t < params[base + 7] || t > params[base + 8]) {
          outStatus[i] = STATUS_TEMPERATURE_OUT_OF_RANGE;
          continue;
        }
        const k = arrheniusValueFlat(params[base + 3], params[base + 4], params[base + 5], params[base + 6], t);
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
        !Number.isFinite(params[base + 9]) || !Number.isFinite(params[base + 10]) ||
        !Number.isFinite(params[base + 11]) || !Number.isFinite(params[base + 12]) ||
        !Number.isFinite(params[base + 13]) || !Number.isFinite(params[base + 14])
      ) {
        continue;
      }
      if (
        !arrheniusParamsFiniteFlat(
          params[base + 9], params[base + 10], params[base + 11],
          params[base + 12], params[base + 13], params[base + 14]
        )
      ) {
        continue;
      }
      const fc = params[base + 15];
      const broadening = params[base + 16];
      if (!Number.isFinite(fc) || fc <= 0 || fc > 1 || !Number.isFinite(broadening) || broadening <= 0) {
        continue;
      }
      if (
        t < params[base + 7] || t > params[base + 8] ||
        t < params[base + 13] || t > params[base + 14]
      ) {
        outStatus[i] = STATUS_TEMPERATURE_OUT_OF_RANGE;
        continue;
      }
      const k0 = arrheniusValueFlat(params[base + 3], params[base + 4], params[base + 5], params[base + 6], t);
      const kInf = arrheniusValueFlat(params[base + 9], params[base + 10], params[base + 11], params[base + 12], t);
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
  }
  return { n, outK, outDiag, outStatus, tick };
}

export function relClose(a, b, tol) {
  if (a === b) {
    return true;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
}

/** Протокол Stage H/I: 3 прогрева + 12 выборок >= 40 мс (макс. 1000 итераций). */
export function measure(runOnce) {
  for (let w = 0; w < WARMUP_RUNS; w++) {
    runOnce();
  }
  const durations = [];
  for (let s = 0; s < SAMPLES; s++) {
    const start = performance.now();
    let iterations = 0;
    do {
      runOnce();
      iterations++;
    } while (performance.now() - start < MIN_SAMPLE_MS && iterations < MAX_ITERATIONS_PER_SAMPLE);
    durations.push((performance.now() - start) / iterations);
  }
  durations.sort((a, b) => a - b);
  const medianMs = durations[Math.floor(durations.length / 2)];
  const p95Index = Math.min(Math.max(Math.ceil(durations.length * 0.95), 1), durations.length) - 1;
  return {
    medianMs: Number(medianMs.toFixed(6)),
    p95Ms: Number(durations[p95Index].toFixed(6)),
    opsPerSec: Number((1000 / medianMs).toFixed(1))
  };
}

export function roundMs(x) {
  return Number(x.toFixed(6));
}
