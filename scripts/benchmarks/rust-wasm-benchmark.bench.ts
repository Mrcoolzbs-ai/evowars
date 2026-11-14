// ============================================
// RUST/WASM PILOT BENCHMARK — TS vs Rust-WASM vs native Rust
// Stage H (Rust/WASM Performance Pilot)
// ============================================
//
// Запуск: npm run benchmark:rust
//
// Протокол (зеркалит rust/evowars-sim-core/src/bin/evowars_bench.rs):
// - 3 прогрева, затем 12 выборок;
// - каждая выборка повторяет полный workload, пока не наберёт
//   >= 40 мс (максимум 1000 итераций) — малые нагрузки не тонут
//   в шуме таймера;
// - статистика median/p95 по длительности одного прогона;
// - ops/s = 1000 / median(ms).
//
// Измеряемые пути (одни и те же детерминированные данные):
// - tsNative      — исходные публичные TS-API
//                  (evaluateRateConstant / auditReactionStoichiometry);
// - wasmEndToEnd  — полный batch-путь: упаковка + пре-чеки TS +
//                  один вызов WASM + распаковка результатов;
// - wasmPackOnly  — только упаковка/пре-чеки (накладные расходы
//                  подготовки данных, без вычисления);
// - wasmKernelOnly — голый вызов WASM на предупакованных буферах
//                  (включая копирование аргументов glue-слоем
//                  wasm-bindgen при каждом вызове — такова цена
//                  обмена JS↔WASM, это честно учитывается);
// - nativeRust    — отдельное измерение native-бинарником
//                  evowars_bench (НЕ выдаётся за скорость браузерного
//                  WASM: без обмена данными и без glue).
//
// Перед измерением каждая нагрузка сверяется на эквивалентность
// (значения/статусы TS и WASM): benchmark не публикует числа,
// если результаты расходятся.
//
// Артефакты: benchmark-artifacts/rust-wasm-pilot-report.json,
// benchmark-artifacts/rust-wasm-pilot-summary.md.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, release, totalmem, type as osType } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import {
  evaluateRateConstant,
  KineticsError
} from '../../src/modules/Core/kinetics';
import type {
  KineticReactionRecord,
  KineticsErrorCode,
  RateConstantEvaluation,
  RateConstantEvaluationOptions
} from '../../src/modules/Core/kinetics';
import type { PhysicalQuantity } from '../../src/modules/Core/physicalQuantity';
import { auditReactionStoichiometry } from '../../src/modules/Core/reactionLedger';
import {
  evalRateConstantsRustBatch,
  packKineticsBatch
} from '../../src/modules/RustSim/rustKinetics';
import {
  auditReactionStoichiometryRustBatch,
  packStoichiometryBatch
} from '../../src/modules/RustSim/rustReactionAudit';
import { loadRustSimCore } from '../../src/modules/RustSim/rustSimCore';
import {
  buildKineticsWorkload,
  buildStoichiometryWorkload
} from './workloads';

const LOADS = [1_000, 10_000, 100_000, 1_000_000];
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

interface LoadReport {
  ops: number;
  tsNative: Measurement | null;
  wasmEndToEnd: Measurement | null;
  wasmPackOnly: Measurement | null;
  wasmKernelOnly: Measurement | null;
  nativeRust: Measurement | null;
  nativeRustNote: string | null;
  speedupEndToEnd: number | null;
  speedupKernelOnly: number | null;
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

const benchBinary = join(process.cwd(), 'rust/evowars-sim-core/target/release/evowars_bench');

/** Нативный исход evaluateRateConstant как union (натив бросает KineticsError). */
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

/** Детерминированная сериализация (ключи отсортированы) для строгого сравнения аудитов. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableJson(v)).join(',') + ']';
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableJson(record[k])).join(',') + '}';
}

function measureNativeRust(scenario: 'kinetics' | 'stoich', ops: number): { m: Measurement | null; note: string | null } {
  try {
    const stdout = execFileSync(benchBinary, ['--scenario', scenario, '--ops', String(ops), '--json'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    });
    const parsed = JSON.parse(stdout) as { median: { medianMs: number; p95Ms: number; opsPerSec: number } };
    return {
      m: {
        medianMs: parsed.median.medianMs,
        p95Ms: parsed.median.p95Ms,
        opsPerSec: parsed.median.opsPerSec
      },
      note: null
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') {
      return { m: null, note: 'native-бинарник evowars_bench не собран (cargo build --release)' };
    }
    return { m: null, note: `native-бенчмарк упал: ${String((error as Error).message ?? error)}` };
  }
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
  kinetics: Record<string, LoadReport>;
  stoichiometry: Record<string, LoadReport>;
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
      statistic: 'median/p95 длительности одного прогона workload, ops/s = 1000/median(ms)',
      note:
        'nativeRust — отдельное измерение native-сборки без обмена JS↔WASM; wasmKernelOnly включает копирование аргументов glue-слоем wasm-bindgen; wasmEndToEnd дополнительно включает упаковку, TS пре-чеки и распаковку результатов.'
    }
  },
  kinetics: {},
  stoichiometry: {}
};

function emptyLoadReport(ops: number): LoadReport {
  return {
    ops,
    tsNative: null,
    wasmEndToEnd: null,
    wasmPackOnly: null,
    wasmKernelOnly: null,
    nativeRust: null,
    nativeRustNote: null,
    speedupEndToEnd: null,
    speedupKernelOnly: null,
    parityMismatchCount: null,
    skippedReason: null
  };
}

function skipReasonIfAny(ops: number): string | null {
  if (ops >= 1_000_000 && totalmem() < MIN_TOTAL_MEM_FOR_1E6) {
    return `недостаточно памяти для нагрузки ${ops} (totalmem ${totalmem()})`;
  }
  return null;
}

it(
  'kinetics: TS native vs Rust/WASM (e2e, kernel-only) vs native Rust',
  () => {
    for (const ops of LOADS) {
      const loadReport = emptyLoadReport(ops);
      const skip = skipReasonIfAny(ops);
      if (skip !== null) {
        loadReport.skippedReason = skip;
        report.kinetics[String(ops)] = loadReport;
        continue;
      }

      let wl;
      try {
        wl = buildKineticsWorkload(ops);
      } catch (error) {
        loadReport.skippedReason = `не удалось построить workload: ${String((error as Error).message ?? error)}`;
        report.kinetics[String(ops)] = loadReport;
        continue;
      }

      // --- Parity-сверка (однократно, вне измерений) ---
      let parityMismatchCount = 0;
      const wasmOutcomes = evalRateConstantsRustBatch(core, wl.records, wl.temperatures, wl.options);
      for (let i = 0; i < ops; i++) {
        const tsOutcome = nativeKineticsOutcome(wl.records[i], wl.temperatures[i], wl.options[i]);
        const wasmOutcome = wasmOutcomes[i];
        if (tsOutcome.ok !== wasmOutcome.ok) {
          parityMismatchCount++;
          continue;
        }
        if (!tsOutcome.ok) {
          if (tsOutcome.code !== wasmOutcome.code) {
            parityMismatchCount++;
          }
          continue;
        }
        const tsValue = tsOutcome.evaluation.value;
        const wasmValue = wasmOutcome.evaluation.value;
        const same =
          tsValue === wasmValue ||
          (Number.isFinite(tsValue) &&
            Number.isFinite(wasmValue) &&
            Math.abs(tsValue - wasmValue) <= 1e-12 * Math.max(Math.abs(tsValue), Math.abs(wasmValue)));
        if (!same) {
          parityMismatchCount++;
        }
      }
      if (parityMismatchCount > 0) {
        throw new Error(
          `kinetics parity нарушена на нагрузке ${ops}: ${parityMismatchCount} расхождений TS/WASM. Benchmark остановлен: публиковать несогласованные измерения нельзя.`
        );
      }
      loadReport.parityMismatchCount = parityMismatchCount;

      // --- TS native ---
      loadReport.tsNative = roundMeasurement(
        measureSync(() => {
          for (let i = 0; i < ops; i++) {
            evaluateRateConstant(wl.records[i], wl.temperatures[i], wl.options[i]);
          }
        })
      );

      // --- WASM end-to-end (упаковка + пре-чеки + WASM + распаковка) ---
      loadReport.wasmEndToEnd = roundMeasurement(
        measureSync(() => {
          evalRateConstantsRustBatch(core, wl.records, wl.temperatures, wl.options);
        })
      );

      // --- Только упаковка (накладные расходы подготовки данных) ---
      loadReport.wasmPackOnly = roundMeasurement(
        measureSync(() => {
          packKineticsBatch(wl.records, wl.temperatures, wl.options);
        })
      );

      // --- WASM kernel-only на предупакованных буферах ---
      const packed = packKineticsBatch(wl.records, wl.temperatures, wl.options);
      loadReport.wasmKernelOnly = roundMeasurement(
        measureSync(() => {
          core.evowars_kinetics_batch(packed.params, packed.outK, packed.outDiag, packed.outStatus);
        })
      );

      // --- Native Rust (отдельное измерение) ---
      const native = measureNativeRust('kinetics', ops);
      loadReport.nativeRust = native.m === null ? null : roundMeasurement(native.m);
      loadReport.nativeRustNote = native.note;

      loadReport.speedupEndToEnd = ratio(loadReport.tsNative.medianMs, loadReport.wasmEndToEnd?.medianMs ?? null);
      loadReport.speedupKernelOnly = ratio(loadReport.tsNative.medianMs, loadReport.wasmKernelOnly?.medianMs ?? null);
      report.kinetics[String(ops)] = loadReport;
    }
  },
  3_600_000
);

it(
  'stoichiometry: TS native vs Rust/WASM (e2e, kernel-only) vs native Rust',
  () => {
    // tolerance = 0 во всех путях: числовое сравнение |a-b|>tol
    // идентично native-бинарнику (его tolerance тоже 0).
    for (const ops of LOADS) {
      const loadReport = emptyLoadReport(ops);
      const skip = skipReasonIfAny(ops);
      if (skip !== null) {
        loadReport.skippedReason = skip;
        report.stoichiometry[String(ops)] = loadReport;
        continue;
      }

      let wl;
      try {
        wl = buildStoichiometryWorkload(ops);
      } catch (error) {
        loadReport.skippedReason = `не удалось построить workload: ${String((error as Error).message ?? error)}`;
        report.stoichiometry[String(ops)] = loadReport;
        continue;
      }

      // --- Parity-сверка (однократно, вне измерений) ---
      let parityMismatchCount = 0;
      const wasmAudits = auditReactionStoichiometryRustBatch(core, wl.records, wl.catalog, { tolerance: 0 });
      for (let i = 0; i < ops; i++) {
        const tsAudit = auditReactionStoichiometry(wl.records[i], wl.catalog, { tolerance: 0 });
        const wasmAudit = wasmAudits[i];
        if (tsAudit.status !== wasmAudit.status) {
          parityMismatchCount++;
          continue;
        }
        if (stableJson(tsAudit) !== stableJson(wasmAudit)) {
          parityMismatchCount++;
        }
      }
      if (parityMismatchCount > 0) {
        throw new Error(
          `stoichiometry parity нарушена на нагрузке ${ops}: ${parityMismatchCount} расхождений TS/WASM. Benchmark остановлен.`
        );
      }
      loadReport.parityMismatchCount = parityMismatchCount;

      // --- TS native ---
      loadReport.tsNative = roundMeasurement(
        measureSync(() => {
          for (let i = 0; i < ops; i++) {
            auditReactionStoichiometry(wl.records[i], wl.catalog, { tolerance: 0 });
          }
        })
      );

      // --- WASM end-to-end ---
      loadReport.wasmEndToEnd = roundMeasurement(
        measureSync(() => {
          auditReactionStoichiometryRustBatch(core, wl.records, wl.catalog, { tolerance: 0 });
        })
      );

      // --- Только упаковка ---
      loadReport.wasmPackOnly = roundMeasurement(
        measureSync(() => {
          packStoichiometryBatch(wl.records, wl.catalog, { tolerance: 0 });
        })
      );

      // --- WASM kernel-only на предупакованных буферах ---
      const packed = packStoichiometryBatch(wl.records, wl.catalog, { tolerance: 0 });
      loadReport.wasmKernelOnly = roundMeasurement(
        measureSync(() => {
          core.evowars_stoichiometry_batch(
            packed.speciesStatus,
            packed.speciesCharge,
            packed.speciesElemOffsets,
            packed.elemIndices,
            packed.elemCounts,
            packed.leftOffsets,
            packed.rightOffsets,
            packed.partSpecies,
            packed.partCoeff,
            packed.tolerance,
            packed.outFlags,
            packed.outLeftCharge,
            packed.outRightCharge,
            packed.outElemOffsets,
            packed.outElemIndex,
            packed.outElemLeft,
            packed.outElemRight,
            packed.outElemExceeds,
            packed.outElemSide
          );
        })
      );

      // --- Native Rust ---
      const native = measureNativeRust('stoich', ops);
      loadReport.nativeRust = native.m === null ? null : roundMeasurement(native.m);
      loadReport.nativeRustNote = native.note;

      loadReport.speedupEndToEnd = ratio(loadReport.tsNative.medianMs, loadReport.wasmEndToEnd?.medianMs ?? null);
      loadReport.speedupKernelOnly = ratio(loadReport.tsNative.medianMs, loadReport.wasmKernelOnly?.medianMs ?? null);
      report.stoichiometry[String(ops)] = loadReport;
    }
  },
  3_600_000
);

it('запись артефактов benchmark', () => {
  const artifactsDir = join(process.cwd(), 'benchmark-artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  const reportPath = join(artifactsDir, 'rust-wasm-pilot-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const lines: string[] = [];
  lines.push('# Rust/WASM Performance Pilot — сводка benchmark');
  lines.push('');
  lines.push(`- Дата: ${report.meta.date}`);
  lines.push(`- Node: ${report.meta.node}, V8: ${report.meta.v8}`);
  lines.push(`- ОС: ${report.meta.os}; CPU: ${report.meta.cpu} × ${report.meta.cpuCount}`);
  lines.push(`- Инициализация WASM: ${wasmInitMs} мс`);
  lines.push('');
  lines.push('Скорость — это отношение median TS native к median Rust/WASM (больше 1 = Rust/WASM быстрее).');
  lines.push('');

  for (const [title, section] of [
    ['Кинетика (массовый расчёт констант скорости)', report.kinetics],
    ['Аудит стехиометрии', report.stoichiometry]
  ] as Array<[string, Record<string, LoadReport>]>) {
    lines.push(`## ${title}`);
    lines.push('');
    lines.push('| ops | TS native, ms | WASM e2e, ms | WASM kernel, ms | pack-only, ms | native Rust, ms | speedup e2e | speedup kernel |');
    lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const ops of LOADS) {
      const row = section[String(ops)];
      if (row === undefined || row.skippedReason !== null) {
        const reason = row?.skippedReason ?? 'нет данных';
        lines.push(`| ${ops} | пропущено: ${reason} | | | | | | |`);
        continue;
      }
      const fmt = (m: Measurement | null): string => (m === null ? 'н/д' : m.medianMs.toFixed(4));
      lines.push(
        `| ${ops} | ${fmt(row.tsNative)} | ${fmt(row.wasmEndToEnd)} | ${fmt(row.wasmKernelOnly)} | ${fmt(row.wasmPackOnly)} | ${fmt(row.nativeRust)} | ${row.speedupEndToEnd ?? 'н/д'} | ${row.speedupKernelOnly ?? 'н/д'} |`
      );
    }
    lines.push('');
  }

  lines.push('Полные данные (median/p95/ops/s по каждой выборке, meta среды): rust-wasm-pilot-report.json.');
  lines.push('');
  lines.push('native Rust — отдельное измерение native-сборки (без обмена JS↔WASM), не показатель браузерного WASM.');
  lines.push('');

  const summaryPath = join(artifactsDir, 'rust-wasm-pilot-summary.md');
  writeFileSync(summaryPath, lines.join('\n'), 'utf8');
}, 120_000);
