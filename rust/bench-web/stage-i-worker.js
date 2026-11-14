// ============================================
// STAGE I — BROWSER WORKER (prepared kinetics)
// Persistent Rust/WASM Kinetics Session
// ============================================
//
// Модульный Worker браузерного benchmark Stage I
// (rust/bench-web/stage-i.html). Запускается только через
// статический сервер КОРНЯ репозитория (pkg-web не грузится с
// file://): /rust/bench-web/stage-i-worker.js.
//
// Сравнивает в ОДНОЙ браузерной среде (один и тот же воркер):
// - preparedTS  — JS-порт числовой реплики preparedKineticsReplica.ts
//                 (stage-i-shared.js; формулы и порядок проверек
//                 идентичны; в горячем цикле только плоские массивы);
// - wasmSession — класс KineticsPrepared (pkg-web): параметры в
//                 памяти WASM, тик передаёт только T и [M].
//
// Parity mini-check перед измерениями каждой нагрузки: тик сессии
// против тика JS-порта (значения/статусы/диагностика). При
// расхождении benchmark падает — числа не публикуются. Полный
// parity против публичного TS-API выполняет vitest-сьют в Node
// (src/modules/Tests/rustPreparedKineticsParity.test.ts).
//
// Протокол как в Node-benchmark (stage-i-shared.js: 3 прогрева +
// 12 выборок >= 40 мс). Отдельно измеряются: инициализация WASM,
// подготовка (конструктор сессии), холодный первый тик, перенос
// данных (structured clone vs transfer) и память параметров
// сессии (memory_bytes).

'use strict';

import {
  KIN_STRIDE,
  DIAG_STRIDE,
  STATUS_OK,
  buildLoad,
  prepareTsPort,
  relClose,
  measure,
  roundMs
} from '/rust/bench-web/stage-i-shared.js';

const LOADS = [1000, 10000, 100000, 1000000];

/**
 * Перенос данных T/[M] (2×8n байт) между потоками:
 * - clonePerMessageMs — structuredClone двух typed arrays
 *   (семантика копии postMessage без transfer);
 * - zeroCopyPerMessageMs — postMessage с transfer-list (без копии;
 *   после transfer буферы отсоединяются, поэтому fresh-пара на
 *   итерацию; фиксированный протокол: 200 итераций, один проход,
 *   ms/итерация — transfer не гоняется в adaptive-цикле).
 */
function measureTransfer(temps, third, n) {
  const bytes = temps.byteLength + third.byteLength;
  const clone = measure(() => {
    structuredClone({ temps, third });
  });
  const channel = new MessageChannel();
  const ITER = 200;
  const start = performance.now();
  for (let k = 0; k < ITER; k++) {
    const a = new Float64Array(n);
    const b = new Float64Array(n);
    channel.port1.postMessage({ temps: a, third: b }, [a.buffer, b.buffer]);
  }
  const zeroCopyMs = (performance.now() - start) / ITER;
  return {
    clonePerMessageMs: clone.medianMs,
    zeroCopyPerMessageMs: Number(zeroCopyMs.toFixed(6)),
    bytes,
    zeroCopyIterations: ITER,
    note: 'clone — structuredClone (семантика копии postMessage); zero-copy — postMessage с transfer, fresh-буферы на итерацию, фиксированные 200 итераций.'
  };
}

async function main() {
  postMessage({ type: 'phase', phase: 'wasmInit' });
  const mod = await import('/rust/evowars-sim-core/pkg-web/evowars_sim_core.js');
  const initStart = performance.now();
  const init = mod.default;
  if (typeof init === 'function') {
    await init();
  } else if (typeof mod.KineticsPrepared !== 'function') {
    throw new Error('pkg-web glue не экспортирует init()/KineticsPrepared: пересоберите pkg-web (npm run wasm:build)');
  }
  const wasmInitMs = roundMs(performance.now() - initStart);
  const KineticsPrepared = mod.KineticsPrepared;
  if (typeof KineticsPrepared !== 'function') {
    throw new Error('pkg-web glue не экспортирует класс KineticsPrepared');
  }

  const loads = {};
  for (const n of LOADS) {
    postMessage({ type: 'phase', phase: 'load' + n });
    const wl = buildLoad(n);

    // --- Подготовка сессии (конструктор: копия параметров в WASM) ---
    const prepSession = measure(() => {
      const s = new KineticsPrepared(wl.sessionParams);
      s.free();
    });

    const session = new KineticsPrepared(wl.sessionParams);
    const sessionOutK = new Float64Array(n);
    const sessionOutDiag = new Float64Array(n * DIAG_STRIDE);
    const sessionOutStatus = new Int32Array(n);

    // --- Подготовка preparedTS (выделение буферов) ---
    const prepTs = measure(() => {
      prepareTsPort(wl.params, wl.kindMask);
    });
    const ts = prepareTsPort(wl.params, wl.kindMask);

    // --- Холодный первый тик сессии (до прогрева) ---
    const coldStart = performance.now();
    session.tick(wl.temps, wl.third, sessionOutK, sessionOutDiag, sessionOutStatus);
    const coldFirstTickSessionMs = roundMs(performance.now() - coldStart);

    // --- Parity mini-check: сессия vs JS-порт ---
    ts.tick(wl.temps, wl.third);
    let parityMismatch = 0;
    for (let i = 0; i < n; i++) {
      if (sessionOutStatus[i] !== ts.outStatus[i]) {
        parityMismatch++;
        continue;
      }
      if (sessionOutStatus[i] === STATUS_OK) {
        if (!relClose(sessionOutK[i], ts.outK[i], 1e-12)) {
          parityMismatch++;
          continue;
        }
        if (wl.kindMask[i] === 1) {
          const d = i * DIAG_STRIDE;
          for (let j = 0; j < DIAG_STRIDE; j++) {
            const tol = j === 3 ? 1e-9 : 1e-12; // log10Pr — абсолютная шкала
            if (
              !relClose(sessionOutDiag[d + j], ts.outDiag[d + j], tol) &&
              !(!Number.isFinite(sessionOutDiag[d + j]) && !Number.isFinite(ts.outDiag[d + j]))
            ) {
              parityMismatch++;
              break;
            }
          }
        }
      }
    }
    if (parityMismatch > 0) {
      session.free();
      throw new Error('parity нарушена (браузер): ' + parityMismatch + ' расхождений сессии и preparedTS на n=' + n);
    }

    // --- Тики: сессия и preparedTS (главное сравнение) ---
    postMessage({ type: 'phase', phase: 'tickSession' + n });
    const tickSession = measure(() => {
      session.tick(wl.temps, wl.third, sessionOutK, sessionOutDiag, sessionOutStatus);
    });
    postMessage({ type: 'phase', phase: 'tickPreparedTs' + n });
    const tickPreparedTs = measure(() => {
      ts.tick(wl.temps, wl.third);
    });

    // --- Перенос данных (2×8n байт, structured clone vs transfer) ---
    postMessage({ type: 'phase', phase: 'transfer' + n });
    const transfer = measureTransfer(wl.temps, wl.third, n);

    const speedup = Number((tickPreparedTs.medianMs / tickSession.medianMs).toFixed(3));
    const prepDiffMs = prepSession.medianMs - prepTs.medianMs;
    const tickDiffMs = tickPreparedTs.medianMs - tickSession.medianMs;
    let breakEvenTicks;
    if (tickDiffMs > 0) {
      breakEvenTicks = prepDiffMs <= 0 ? 0 : Math.ceil(prepDiffMs / tickDiffMs);
    } else if (prepDiffMs <= 0) {
      breakEvenTicks = 0;
    } else {
      breakEvenTicks = null;
    }

    loads[String(n)] = {
      ops: n,
      prepSession,
      prepTs,
      coldFirstTickSessionMs,
      tickSession,
      tickPreparedTs,
      speedupSessionVsPreparedTs: speedup,
      breakEvenTicks,
      transfer,
      memory: {
        sessionParamBytes: session.memory_bytes(),
        jsBufferBytes: n * (KIN_STRIDE + 2 + 1 + DIAG_STRIDE) * 8 + n * 8,
        jsBufferNote: 'оценка плоских буферов TS-стороны (params/temps/third/outK/outDiag + kindMask/outStatus); heap-метрика в воркере недоступна.'
      },
      parityMismatchCount: 0,
      note:
        'prep в браузере — конструктор сессии / выделение буферов (TS-валидация записей исключена из обоих путей одинаково; prep с валидацией — Node-отчёт).'
    };
    session.free();
    postMessage({ type: 'progress', load: n, speedup });
  }

  const speedup1e5 = loads['100000'].speedupSessionVsPreparedTs;
  const speedup1e6 = loads['1000000'].speedupSessionVsPreparedTs;
  const result = {
    meta: {
      date: new Date().toISOString(),
      ua: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      worker: true,
      wasmInitMs,
      protocol: {
        warmupRuns: 3,
        samples: 12,
        minSampleMs: 40,
        statistic: 'median/p95 одного прогона, ops/s = 1000/median(ms)'
      }
    },
    loads,
    verdict: {
      speedupSessionVsPreparedTs100k: speedup1e5,
      speedupSessionVsPreparedTs1m: speedup1e6,
      browserMeetsThreshold1_5x: speedup1e5 >= 1.5 && speedup1e6 >= 1.5
    }
  };
  postMessage({ type: 'done', result });
}

main().catch((e) => {
  postMessage({ type: 'error', error: String((e && e.stack) || e) });
});
