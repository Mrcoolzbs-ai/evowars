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
  getCentralObjectPhysics,
  getEarliestUniverseAgeGyr,
  getTypicalLifetimeGyr,
  getRepresentativeLuminosityW,
  getRepresentativeMassKg
} from './starPhysical';
export { getPhaseProperties } from './phaseProperties';
export { getElementComposition } from './elementCompositions';
