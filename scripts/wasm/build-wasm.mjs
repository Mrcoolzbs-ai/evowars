#!/usr/bin/env node
// ============================================
// build-wasm.mjs — сборка Rust/WASM для Stage H
// ============================================
// Запуск: npm run wasm:build
//
// 1) cargo build --release --target wasm32-unknown-unknown
//    (crate rust/evowars-sim-core);
// 2) wasm-bindgen --target nodejs --out-dir pkg-node (для vitest
//    и Node-бенчмарка через createRequire в RustSim-адаптере);
// 3) wasm-bindgen --target web --out-dir pkg-web (для браузерной
//    bench-страницы rust/bench-web/index.html).
//
// Требования: cargo + target wasm32-unknown-unknown, wasm-bindgen-cli
// той же версии, что и крейт wasm-bindgen (=0.2.95).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const crateDir = join(process.cwd(), 'rust', 'evowars-sim-core');
const wasmPath = join(crateDir, 'target', 'wasm32-unknown-unknown', 'release', 'evowars_sim_core.wasm');
const BINDGEN_VERSION = '0.2.95';

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: crateDir,
    stdio: 'inherit'
  });
  if (result.error !== undefined) {
    console.error(`\n[build-wasm] не удалось запустить ${label}: ${String(result.error.message)}`);
    console.error(`[build-wasm] установка: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version ${BINDGEN_VERSION} --locked`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n[build-wasm] ${label} завершился с кодом ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

// Версия wasm-bindgen-cli должна совпадать с версией крейта.
const versionProbe = spawnSync('wasm-bindgen', ['--version'], { encoding: 'utf8' });
if (versionProbe.error !== undefined || versionProbe.status !== 0) {
  console.error('[build-wasm] wasm-bindgen-cli не найден.');
  console.error(`[build-wasm] установка: cargo install wasm-bindgen-cli --version ${BINDGEN_VERSION} --locked`);
  process.exit(1);
}
if (!String(versionProbe.stdout).includes(BINDGEN_VERSION)) {
  console.error(`[build-wasm] версия wasm-bindgen-cli должна быть ${BINDGEN_VERSION}, найдено: ${String(versionProbe.stdout).trim()}`);
  process.exit(1);
}

run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], 'cargo build (wasm32-unknown-unknown)');

if (!existsSync(wasmPath)) {
  console.error(`[build-wasm] ожидаемый артефакт сборки не найден: ${wasmPath}`);
  process.exit(1);
}

run(
  'wasm-bindgen',
  ['--target', 'nodejs', '--out-dir', 'pkg-node', 'target/wasm32-unknown-unknown/release/evowars_sim_core.wasm'],
  'wasm-bindgen (nodejs)'
);

run(
  'wasm-bindgen',
  ['--target', 'web', '--out-dir', 'pkg-web', 'target/wasm32-unknown-unknown/release/evowars_sim_core.wasm'],
  'wasm-bindgen (web)'
);

console.log('[build-wasm] готово: pkg-node (Node/vitest) и pkg-web (браузер).');
