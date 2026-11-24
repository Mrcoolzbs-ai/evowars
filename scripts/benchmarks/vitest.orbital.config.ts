// Конфигурация vitest для orbital-бенчмарка (Stage 4.6.1-A).
// Node-окружение, без setupFiles: чистые численные прогоны.
// Запуск: npm run benchmark:orbital

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['scripts/benchmarks/orbitalDynamics.bench.ts'],
    testTimeout: 3_600_000,
    globals: true
  }
});
