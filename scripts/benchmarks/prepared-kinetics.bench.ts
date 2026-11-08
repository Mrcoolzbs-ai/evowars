// ============================================
// PREPARED KINETICS BENCHMARK — Stage I
// Persistent Rust/WASM Kinetics Session
// ============================================
//
// Запуск: npm run benchmark:prepared
// (vitest --config scripts/benchmarks/vitest.prepared.config.ts)
//
// Сравнение трёх архитектур на одних детерминированных данных
// (scripts/benchmarks/workloads.ts, seed KINETICS_SEED):
// 1. tsNative       — исходный публичный TS-API
//                    (evaluateRateConstant, пообъектный, каждый вызов
//                    валидирует запись) — контекст, тот же путь, что
//                    в Stage H;
// 2. preparedTS     — подготовленный TS: валидация и упаковка ОДИН раз
//                    (packPreparedKineticsParams), тик считает напрямую
//                    по плоским массивам (preparedKineticsReplica.ts),
//                    в горячем цикле нет пообъектных представлений;
// 3. wasmSession    — Rust/WASM KineticsPrepared сессия: параметры
//                    в памяти WASM с момента prepare, тик передаёт
//                    только T и [M] (rustKineticsSession.ts).
//
// ГЛАВНЫЙ критерий — preparedTS (2) vs wasmSession (3): обе
// архитектуры с preparation-once; сравнивается именно стоимость
// повторного вычисления, а не упаковки.
//
// Дополнительно:
// - prepSession / prepTs — стоимость первоначальной подготовки;
// - breakEvenTicks — за сколько тиков сессия окупает разницу
//   подготовки (формула: ceil((prepSession−prepTs)/max(0,
//   tickPreparedTs−tickSession)); null — если тик сессии не быстрее);
// - totals[T] для T ∈ {1,10,100,1000} — вычисляются ИЗ median-ов:
//   total = prep + T × tick (прямое измерение 1000 тиков той же
//   ценой; протокол эквивалентен);
// - память: точная параметрическая память сессии (memory_bytes) +
//   дельта RSS вокруг prepare/dispose (V8 не отдаёт память ОС
//   мгновенно; RSS — ориентир, параметрический объём — факт).
//
// Протокол (как Stage H): 3 прогрева, 12 выборок, каждая выборка
// крутится до >= 40 мс (макс. 1000 итераций); median/p95 одного
// прогона; ops/s = 1000/median(ms). T и [M] в рамках измерения тика
// КОНСТАНТНЫ (вариативность T/M между тиками покрывает parity-сьют
// rustPreparedKineticsParity.test.ts).
//
// Перед измерениями — parity-гейт: сессия vs preparedTS vs
// evaluateRateConstant по значениям/статусам/диагностике; benchmark
// не публикует числа при расхождении.
//
// Stage H baseline (rust-wasm-pilot-report.json) НЕ затирается:
// этот прогон пишет отдельные артефакты
// benchmark-artifacts/prepared-kinetics-report.json и
// benchmark-artifacts/prepared-kinetics-summary.md.

import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, release, totalmem, type as osType } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { evaluateRateConstant, KineticsError } from '../../src/modules/Core/kinetics';
import type {
  KineticReactionRecord,
  KineticsErrorCode,
  RateConstantEvaluation,
  RateConstantEvaluationOptions
} from '../../src/modules/Core/kinetics';
import { convert } from '../../src/modules/Core/physicalQuantity';
import type { PhysicalQuantity } from '../../src/modules/Core/physicalQuantity';
import { loadRustSimCore } from '../../src/modules/RustSim/rustSimCore';
import {
  packPreparedKineticsParams,
  RustPreparedKineticsSession
} from '../../src/modules/RustSim/rustKineticsSession';
import {
  KIN_DIAG_STRIDE,
  prepareTsKinetics
} from '../../src/modules/RustSim/preparedKineticsReplica';
import { buildKineticsWorkload } from './workloads';

const LOADS = [1_000, 10_000, 100_000, 1_000_000];
const TICK_COUNTS = [1, 10, 100, 1_000];
const MIN_TOTAL_MEM_FOR_1E6 = 4 * 1024 * 1024 * 1024;
const WARMUP_RUNS = 3;
const SAMPLES = 12;
const MIN_SAMPLE_MS = 40;
const MAX_ITERATIONS_PER_SAMPLE = 1000;

interface Measurement {
  medianMs: number;
  p95Ms: number;
  opsPerSec: number;
}

/** Полная стоимость T тиков с подготовкой (вычислено из median-ов). */
interface TickTotal {
  ticks: number;
  preparedTsTotalMs: number;
  wasmSessionTotalMs: number;
  speedup: number | null;
}

interface MemoryReport {
  /** Параметрическая память сессии (memory_bytes, факт). */
  sessionParamBytes: number | null;
  /** Дельта RSS сразу после prepare (ориентир). */
  rssDeltaPrepareBytes: number | null;
  /** Дельта RSS после dispose (ориентир, V8 не сразу отдаёт ОС). */
  rssDeltaAfterDisposeBytes: number | null;
}

interface LoadReport {
  ops: number;
  tsNative: Measurement | null;
  preparedTs: Measurement | null;
  wasmSession: Measurement | null;
  prepTs: Measurement | null;
  prepSession: Measurement | null;
  /** Главный критерий: во сколько раз тик сессии быстрее тика preparedTS. */
  speedupSessionVsPreparedTs: number | null;
  speedupSessionVsTsNative: number | null;
  breakEvenTicks: number | null;
  breakEvenNote: string | null;
  totals: TickTotal[];
  memory: MemoryReport;
  parityMismatchCount: number | null;
  skippedReason: string | null;
}

function measureSync(runOnce: () => void): Measurement {
  for (let w = 0; w < WARMUP_RUNS; w++) {
    runOnce();
  }
  const durations: number[] = [];
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
  const p95Ms = durations[p95Index];
  return { medianMs, p95Ms, opsPerSec: 1000 / medianMs };
}

function roundMeasurement(m: Measurement): Measurement {
  return {
    medianMs: Number(m.medianMs.toFixed(6)),
    p95Ms: Number(m.p95Ms.toFixed(6)),
    opsPerSec: Number(m.opsPerSec.toFixed(1))
  };
}

function ratio(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) {
    return null;
  }
  return Number((a / b).toFixed(3));
}

/** Нативный исход (натив бросает KineticsError). */
type NativeKineticsOutcome =
  | { ok: true; evaluation: RateConstantEvaluation }
  | { ok: false; code: KineticsErrorCode };

function nativeKineticsOutcome(
  record: KineticReactionRecord,
  temperature: PhysicalQuantity,
  options?: RateConstantEvaluationOptions
): NativeKineticsOutcome {
  try {
    return { ok: true, evaluation: evaluateRateConstant(record, temperature, options) };
  } catch (e) {
    if (e instanceof KineticsError) {
      return { ok: false, code: e.code };
    }
    throw e;
  }
}

function relClose(a: number, b: number, tol: number): boolean {
  if (a === b) {
    return true;
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
}

// --- Инициализация WASM (измеряется отдельно, один раз на процесс) ---
const initStart = performance.now();
const core = await loadRustSimCore();
const wasmInitMs = Number((performance.now() - initStart).toFixed(3));

if (core === null) {
  throw new Error(
    'Rust/WASM модуль не загрузился. Соберите pkg-node: npm run wasm:build (scripts/wasm/build-wasm.mjs). Benchmark требует собранный WASM-путь.'
  );
}

const report: {
  meta: Record<string, unknown>;
  verdict: Record<string, unknown>;
  loads: Record<string, LoadReport>;
} = {
  meta: {
    date: new Date().toISOString(),
    node: process.version,
    v8: process.versions.v8,
    os: `${osType()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    totalMem: totalmem(),
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    wasmInitMs,
    protocol: {
      warmupRuns: WARMUP_RUNS,
      samples: SAMPLES,
      minSampleMs: MIN_SAMPLE_MS,
      maxIterationsPerSample: MAX_ITERATIONS_PER_SAMPLE,
      statistic: 'median/p95 длительности одного прогона, ops/s = 1000/median(ms)',
      note:
        'preparedTS и wasmSession — обе архитектуры preparation-once; главный критерий — speedupSessionVsPreparedTs. totals[T] вычислены из median-ов: prep + T × tick. T и [M] константны в рамках измерения тика (вариативность покрывает parity-сьют).'
    }
  },
  verdict: {},
  loads: {}
};

it(
  'prepared kinetics: TS native vs preparedTS vs WASM session (preparation once)',
  () => {
    // DCE-гвард: суммы первых k тик-измерений должны быть конечны и ненулевые.
    let tickChecksum = 0;

    for (const ops of LOADS) {
      const loadReport: LoadReport = {
        ops,
        tsNative: null,
        preparedTs: null,
        wasmSession: null,
        prepTs: null,
        prepSession: null,
        speedupSessionVsPreparedTs: null,
        speedupSessionVsTsNative: null,
        breakEvenTicks: null,
        breakEvenNote: null,
        totals: [],
        memory: { sessionParamBytes: null, rssDeltaPrepareBytes: null, rssDeltaAfterDisposeBytes: null },
        parityMismatchCount: null,
        skippedReason: null
      };

      if (ops >= 1_000_000 && totalmem() < MIN_TOTAL_MEM_FOR_1E6) {
        loadReport.skippedReason = `недостаточно памяти для нагрузки ${ops} (totalmem ${totalmem()})`;
        report.loads[String(ops)] = loadReport;
        continue;
      }

      let wl;
      try {
        wl = buildKineticsWorkload(ops);
      } catch (error) {
        loadReport.skippedReason = `не удалось построить workload: ${String((error as Error).message ?? error)}`;
        report.loads[String(ops)] = loadReport;
        continue;
      }

      // --- Входы тика: T (K) и [M] (NaN = «не передан») ---
      const tempsK = new Float64Array(ops);
      for (let i = 0; i < ops; i++) {
        tempsK[i] = convert(wl.temperatures[i], 'K').value;
      }
      const third = new Float64Array(ops);
      for (let i = 0; i < ops; i++) {
        const m = wl.options[i]?.thirdBodyConcentration;
        third[i] = m === undefined ? Number.NaN : m;
      }

      // --- Parity-гейт: сессия vs preparedTS vs публичный TS-API ---
      const session = RustPreparedKineticsSession.prepare(core, wl.records);
      const packed = packPreparedKineticsParams(wl.records);
      const tsPrepared = prepareTsKinetics(packed.params, packed.kindMask);
      session.tick(tempsK, third);
      tsPrepared.tick(tempsK, third);

      let parityMismatchCount = 0;
      for (let i = 0; i < ops; i++) {
        const nativeOutcome = nativeKineticsOutcome(wl.records[i], wl.temperatures[i], wl.options[i]);
        const sStatus = session.outStatus[i];
        const tStatus = tsPrepared.outStatus[i];
        if (sStatus !== tStatus) {
          parityMismatchCount++;
          continue;
        }
        if (nativeOutcome.ok) {
          if (sStatus !== 0) {
            parityMismatchCount++;
            continue;
          }
          const nativeValue = nativeOutcome.evaluation.value;
          if (
            !relClose(nativeValue, session.outK[i], 1e-12) ||
            !relClose(nativeValue, tsPrepared.outK[i], 1e-12)
          ) {
            parityMismatchCount++;
            continue;
          }
        } else {
          // Нативный отказ: код ошибки по статусу (0 = ok невозможен здесь).
          if (sStatus === 0) {
            parityMismatchCount++;
            continue;
          }
          const codeByStatus = new Map<number, KineticsErrorCode>([
            [1, 'temperature_out_of_range'],
            [2, 'invalid_third_body'],
            [3, 'numerical_failure'],
            [4, 'invalid_input']
          ]);
          if (codeByStatus.get(sStatus) !== nativeOutcome.code) {
            parityMismatchCount++;
            continue;
          }
        }
        // Диагностика fall-off: сессия vs preparedTS.
        if (packed.kindMask[i] === 1 && sStatus === 0) {
          const d = i * KIN_DIAG_STRIDE;
          for (let j = 0; j < KIN_DIAG_STRIDE; j++) {
            const tol = j === 3 ? 1e-9 : 1e-12; // log10Pr — абсолютная шкала
            if (!relClose(session.outDiag[d + j], tsPrepared.outDiag[d + j], tol) && !(
              Number.isFinite(session.outDiag[d + j]) === false &&
              Number.isFinite(tsPrepared.outDiag[d + j]) === false
            )) {
              parityMismatchCount++;
              break;
            }
          }
        }
      }
      if (parityMismatchCount > 0) {
        session.dispose();
        throw new Error(
          `prepared kinetics parity нарушена на нагрузке ${ops}: ${parityMismatchCount} расхождений. Benchmark остановлен: публиковать несогласованные измерения нельзя.`
        );
      }
      loadReport.parityMismatchCount = parityMismatchCount;

      // --- 1. Исходный публичный TS-API (контекст Stage H) ---
      loadReport.tsNative = roundMeasurement(
        measureSync(() => {
          for (let i = 0; i < ops; i++) {
            evaluateRateConstant(wl.records[i], wl.temperatures[i], wl.options[i]);
          }
        })
      );

      // --- 2. Подготовка preparedTS (валидация + упаковка, один прогон) ---
      loadReport.prepTs = roundMeasurement(
        measureSync(() => {
          const p = packPreparedKineticsParams(wl.records);
          prepareTsKinetics(p.params, p.kindMask);
        })
      );

      // --- 3. Подготовка WASM-сессии (валидация + упаковка + new, один прогон) ---
      loadReport.prepSession = roundMeasurement(
        measureSync(() => {
          const s = RustPreparedKineticsSession.prepare(core, wl.records);
          s.dispose();
        })
      );

      // --- 4. Тик preparedTS (главный конкурент) ---
      loadReport.preparedTs = roundMeasurement(
        measureSync(() => {
          tsPrepared.tick(tempsK, third);
          tickChecksum += tsPrepared.outK[0];
        })
      );

      // --- 5. Тик WASM-сессии (главный кандидат) ---
      loadReport.wasmSession = roundMeasurement(
        measureSync(() => {
          session.tick(tempsK, third);
          tickChecksum += session.outK[0];
        })
      );

      if (!Number.isFinite(tickChecksum) || tickChecksum === 0) {
        session.dispose();
        throw new Error('DCE-гвард: тик-измерения не произвели значений (checksum пуст).');
      }

      // --- Итоги и break-even ---
      loadReport.speedupSessionVsPreparedTs = ratio(
        loadReport.preparedTs.medianMs,
        loadReport.wasmSession.medianMs
      );
      loadReport.speedupSessionVsTsNative = ratio(
        loadReport.tsNative.medianMs,
        loadReport.wasmSession.medianMs
      );

      const prepDiffMs = loadReport.prepSession.medianMs - loadReport.prepTs.medianMs;
      const tickDiffMs = loadReport.preparedTs.medianMs - loadReport.wasmSession.medianMs;
      if (tickDiffMs > 0) {
        loadReport.breakEvenTicks = prepDiffMs <= 0 ? 0 : Math.ceil(prepDiffMs / tickDiffMs);
      } else if (prepDiffMs <= 0) {
        loadReport.breakEvenTicks = 0;
      } else {
        loadReport.breakEvenTicks = null;
        loadReport.breakEvenNote = 'тик сессии не быстрее preparedTS — break-even недостижим';
      }

      for (const t of TICK_COUNTS) {
        const preparedTsTotalMs = loadReport.prepTs.medianMs + t * loadReport.preparedTs.medianMs;
        const wasmSessionTotalMs = loadReport.prepSession.medianMs + t * loadReport.wasmSession.medianMs;
        loadReport.totals.push({
          ticks: t,
          preparedTsTotalMs: Number(preparedTsTotalMs.toFixed(6)),
          wasmSessionTotalMs: Number(wasmSessionTotalMs.toFixed(6)),
          speedup: ratio(preparedTsTotalMs, wasmSessionTotalMs)
        });
      }

      // --- Память: точный объём параметров + дельта RSS prepare/dispose ---
      loadReport.memory.sessionParamBytes = session.memoryBytes();
      const rssBefore = process.memoryUsage().rss;
      const memProbeSession = RustPreparedKineticsSession.prepare(core, wl.records);
      const rssAfterPrepare = process.memoryUsage().rss;
      memProbeSession.dispose();
      const rssAfterDispose = process.memoryUsage().rss;
      loadReport.memory.rssDeltaPrepareBytes = rssAfterPrepare - rssBefore;
      loadReport.memory.rssDeltaAfterDisposeBytes = rssAfterDispose - rssBefore;

      session.dispose();
      report.loads[String(ops)] = loadReport;
    }

    // --- Вердикт по Node-прогону (браузерный вердикт — отдельный отчёт) ---
    const speedup100k = report.loads['100000']?.speedupSessionVsPreparedTs ?? null;
    const speedup1m = report.loads['1000000']?.speedupSessionVsPreparedTs ?? null;
    const haveBoth = speedup100k !== null && speedup1m !== null;
    report.verdict = {
      speedupSessionVsPreparedTs100k: speedup100k,
      speedupSessionVsPreparedTs1m: speedup1m,
      nodeMeetsThreshold1_5x: haveBoth ? speedup100k >= 1.5 && speedup1m >= 1.5 : null,
      note:
        'Node/V8-окружение. Браузерный критерий GO/NO-GO (>= 1.5× на 1e5/1e6 в Chromium) — stage-i-browser-report.json (npm run benchmark:browser).'
    };
  },
  3_600_000
);

it('запись артефактов prepared-kinetics benchmark', () => {
  const artifactsDir = join(process.cwd(), 'benchmark-artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  const reportPath = join(artifactsDir, 'prepared-kinetics-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const lines: string[] = [];
  lines.push('# Stage I — Prepared Kinetics Session: сводка benchmark (Node)');
  lines.push('');
  lines.push(`- Дата: ${report.meta.date}`);
  lines.push(`- Node: ${report.meta.node}, V8: ${report.meta.v8}`);
  lines.push(`- ОС: ${report.meta.os}; CPU: ${report.meta.cpu} × ${report.meta.cpuCount}`);
  lines.push(`- Инициализация WASM: ${wasmInitMs} мс`);
  lines.push('');
  lines.push('Главный критерий: тик WASM-сессии против тика preparedTS (обе — preparation-once).');
  lines.push('');
  lines.push('| ops | TS native, ms | prepTS, ms | prepSession, ms | tick preparedTS, ms | tick session, ms | session vs preparedTS | session vs TS native | break-even, тиков |');
  lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const ops of LOADS) {
    const row = report.loads[String(ops)];
    if (row === undefined || row.skippedReason !== null) {
      const reason = row?.skippedReason ?? 'нет данных';
      lines.push(`| ${ops} | пропущено: ${reason} | | | | | | | |`);
      continue;
    }
    const fmt = (m: Measurement | null): string => (m === null ? 'н/д' : m.medianMs.toFixed(4));
    lines.push(
      `| ${ops} | ${fmt(row.tsNative)} | ${fmt(row.prepTs)} | ${fmt(row.prepSession)} | ${fmt(row.preparedTs)} | ${fmt(row.wasmSession)} | ${row.speedupSessionVsPreparedTs ?? 'н/д'}× | ${row.speedupSessionVsTsNative ?? 'н/д'}× | ${row.breakEvenTicks ?? 'н/д'} |`
    );
  }
  lines.push('');
  lines.push('## Полная стоимость T тиков (prep + T × tick, из median-ов)');
  lines.push('');
  lines.push('| ops | T | preparedTS total, ms | session total, ms | speedup |');
  lines.push('|---:|---:|---:|---:|---:|');
  for (const ops of LOADS) {
    const row = report.loads[String(ops)];
    if (row === undefined || row.skippedReason !== null) {
      continue;
    }
    for (const t of row.totals) {
      lines.push(
        `| ${ops} | ${t.ticks} | ${t.preparedTsTotalMs.toFixed(4)} | ${t.wasmSessionTotalMs.toFixed(4)} | ${t.speedup ?? 'н/д'}× |`
      );
    }
  }
  lines.push('');
  lines.push('## Память');
  lines.push('');
  lines.push('| ops | параметры сессии, MB | ΔRSS после prepare, MB | ΔRSS после dispose, MB |');
  lines.push('|---:|---:|---:|---:|');
  const MB = 1024 * 1024;
  for (const ops of LOADS) {
    const row = report.loads[String(ops)];
    if (row === undefined || row.skippedReason !== null) {
      continue;
    }
    const m = row.memory;
    lines.push(
      `| ${ops} | ${m.sessionParamBytes === null ? 'н/д' : (m.sessionParamBytes / MB).toFixed(2)} | ${m.rssDeltaPrepareBytes === null ? 'н/д' : (m.rssDeltaPrepareBytes / MB).toFixed(2)} | ${m.rssDeltaAfterDisposeBytes === null ? 'н/д' : (m.rssDeltaAfterDisposeBytes / MB).toFixed(2)} |`
    );
  }
  lines.push('');
  lines.push(`Вердикт Node: ${String(report.verdict.nodeMeetsThreshold1_5x ?? 'н/д')} (speedup 1e5 = ${report.verdict.speedupSessionVsPreparedTs100k ?? 'н/д'}×, 1e6 = ${report.verdict.speedupSessionVsPreparedTs1m ?? 'н/д'}×).`);
  lines.push('Браузерный критерий GO/NO-GO — stage-i-browser-report.json.');
  lines.push('');
  lines.push('Полные данные (p95, ops/s, meta, память): prepared-kinetics-report.json.');
  lines.push('');
  lines.push('Stage H baseline не изменён: rust-wasm-pilot-report.json (отдельный прогон benchmark:rust).');
  lines.push('');

  const summaryPath = join(artifactsDir, 'prepared-kinetics-summary.md');
  writeFileSync(summaryPath, lines.join('\n'), 'utf8');
}, 120_000);
