// Конфигурация vitest для Rust/WASM performance benchmark (Stage H).
// Запуск: npm run benchmark:rust
//
// Отличия от основного vitest.config.ts:
// - environment 'node' (нет DOM);
// - только bench-файл, большие timeout (полный протокол
//   warmup+12 выборок на 4 нагрузках × 2 сценария);
// - БЕЗ setupFiles (моки console не нужны и искажали бы замеры).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/benchmarks/rust-wasm-benchmark.bench.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
    teardownTimeout: 60_000
  }
});
