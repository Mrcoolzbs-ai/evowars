// ============================================
// DATA MODULE - Экспорт всех данных
// ============================================

import cosmologies from './cosmologies';
import epochs from './epochs';
import centralObjects from './centralObjects';
import celestialBodies from './celestialBodies';
import cradles from './cradles';
import gases from './gases';
import chemicalReactions from './chemicalReactions';
import starPhysical from './starPhysical';
import phaseProperties from './phaseProperties';
import elementCompositions from './elementCompositions';
import {
  NASA_CEA_THERMO_SOURCE,
  NASA_CEA_THERMO_DATA,
  NEW_GAS_SPECIES,
  THERMODYNAMIC_CATALOG_SPECIES_IDS,
  buildThermodynamicCatalog,
  buildNasaCeaThermodynamics
} from './thermodynamicCatalog';

export {
  cosmologies,
  epochs,
  centralObjects,
  celestialBodies,
  cradles,
  gases,
  chemicalReactions
};
export { starPhysical, phaseProperties, elementCompositions };
export {
  NASA_CEA_THERMO_SOURCE,
  NASA_CEA_THERMO_DATA,
  NEW_GAS_SPECIES,
  THERMODYNAMIC_CATALOG_SPECIES_IDS,
  buildThermodynamicCatalog,
  buildNasaCeaThermodynamics
};
export type {
  NasaCeaDataSource,
  NasaCeaGasRecordId,
  NasaCeaGasRecordData,
  NasaCeaSegmentData,
  NewGasSpeciesDefinition
} from './thermodynamicCatalog';
export {
  getCentralObjectPhysics,
  getEarliestUniverseAgeGyr,
  getTypicalLifetimeGyr,
  getRepresentativeLuminosityW,
  getRepresentativeMassKg
} from './starPhysical';
export { getPhaseProperties } from './phaseProperties';
export { getElementComposition } from './elementCompositions';
