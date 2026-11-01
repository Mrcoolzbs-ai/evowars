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
//   elements          — каталог химических элементов периодической таблицы (4.3.3);
//   thermodynamics    — термодинамические свойства видов (4.3.1);
//   reservoir         — материальные и энергетические резервуары;
//   fluxLedger        — потоки и балансы сохранения;
//   reactionLedger    — журнал реакционных транзакций и стехиометрический аудит (4.2.3.2);
//   simulationClock   — время симуляции;
//   worldClock        — мировая временная система поверх часов;
//   processRegistry   — реестр физических процессов (τ, политики шага);
//   scheduler         — планировщик процессов (Lie/Strang, sub-cycling);
//   invariantAuditor  — аудит инвариантов перехода состояния;
//   thermalState      — температурная иерархия и происхождение (4.2.2);
//   worldState        — каноническое состояние мира;
//   solverBackend     — контракты численных решателей;
//   migrations        — версии схем, датасетов и миграции сохранений;
//   adapters          — мосты к существующим модулям (этап 1–3).

export * from './physicalQuantity';
export * from './scientificValue';
export * from './species';
export * from './elements';
export * from './thermodynamics';
export * from './reservoir';
export * from './fluxLedger';
export * from './reactionLedger';
export * from './simulationClock';
export * from './worldClock';
export * from './processRegistry';
export * from './scheduler';
export * from './invariantAuditor';
export * from './thermalState';
export * from './worldState';
export * from './solverBackend';
export * from './migrations';
export * from './adapters';

