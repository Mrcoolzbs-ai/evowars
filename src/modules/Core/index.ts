// ============================================
// CORE SCIENTIFIC ENGINE - публичный вход Stage 4.1
// ============================================
//
// Единое научное ядро проекта Evolution Wars:
// физические величины и размерности, научные значения с
// происхождением, химические виды, резервуары, учёт потоков,
// состояние мира, время симуляции, контракты решателей,
// версионирование данных и миграции, адаптеры к легаси-модулям.
//
// Логические слои ядра (см. docs/science/CORE_SCIENTIFIC_ENGINE.md):
//   physicalQuantity  — величины и размерностный контроль;
//   scientificValue   — семантика данных и provenance;
//   species           — каталог химических видов;
//   reservoir         — материальные и энергетические резервуары;
//   fluxLedger        — потоки и балансы сохранения;
//   simulationClock   — время симуляции;
//   worldState        — каноническое состояние мира;
//   solverBackend     — контракты численных решателей;
//   migrations        — версии схем, датасетов и миграции сохранений;
//   adapters          — мосты к существующим модулям (этап 1–3).

export * from './physicalQuantity';
export * from './scientificValue';
export * from './species';
export * from './reservoir';
export * from './fluxLedger';
export * from './simulationClock';
export * from './worldState';
export * from './solverBackend';
export * from './migrations';
export * from './adapters';
