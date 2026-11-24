// Конфигурация vitest для Stage I prepared-kinetics benchmark.
// Запуск: npm run benchmark:prepared
//
// Отличия от vitest.bench.config.ts (Stage H):
// - включает prepared-kinetics.bench.ts (Stage I);
// - большие timeout: parity-гейт на 1e6 + полный протокол
//   warmup+12 выборок на 4 нагрузках × 5 измерений.
// Environment 'node', БЕЗ setupFiles (как Stage H).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/benchmarks/prepared-kinetics.bench.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
    teardownTimeout: 60_000
  }
});
