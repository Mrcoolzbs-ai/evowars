// ============================================
// TESTS - Main test exports
// ============================================

export * from './generator.test';
export * from './random.test';
export * from './atmosphere.test';
export * from './compatibility.test';
export * from './units.test';
export * from './orbital.test';
export * from './planetPhysics.test';
export * from './atmospherePhysics.test';
export * from './phase.test';
export * from './chemical.test';
export * from './geology.test';
export * from './generatorPhysics.test';

// --- Научное ядро (Stage 4.1) ---
export * from './corePhysicalQuantity.test';
export * from './coreScientificValue.test';
export * from './coreSpecies.test';
export * from './coreReservoir.test';
export * from './coreFluxLedger.test';
export * from './coreSimulationClock.test';
export * from './coreWorldState.test';
export * from './coreSolverBackend.test';
export * from './corePersistence.test';

// --- Формы NASA-полиномов: типизированное разделение (корректирующая ревизия Stage 4.3.2) ---
export * from './coreNasaPolynomialForm.test';

// --- Термодинамика видов: каталог первой партии NASA CEA (Stage 4.3.2) ---
export * from './dataThermodynamicCatalog.test';
