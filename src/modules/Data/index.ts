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
import {
  buildElement,
  buildElementCatalog,
  elementCatalogCoverage,
  parseCiaawBracketUncertainty,
  IUPAC_PT_2022_PROVENANCE,
  CIAAW_SAW_2024_PROVENANCE,
  CIAAW_ISO_2024_PROVENANCE,
  RU_NOMENCLATURE_PROVENANCE,
  CATEGORY_PROVENANCE,
  UNKNOWN_PROPERTY_PROVENANCE
} from './elements';
import {
  ELEMENTS_WITH_CANDIDATES,
  NUBASE2020_PROVENANCE,
  isotopeCandidateCoverage
} from './elementIsotopeCandidates';

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

// Stage 4.3.3: периодическая таблица — 118 химических элементов
// (идентификация IUPAC, веса и распространённости CIAAW 2024,
// изотопы-кандидаты NUBASE2020; атрибуция — elementDataAttribution.md).
export {
  buildElement,
  buildElementCatalog,
  elementCatalogCoverage,
  parseCiaawBracketUncertainty,
  IUPAC_PT_2022_PROVENANCE,
  CIAAW_SAW_2024_PROVENANCE,
  CIAAW_ISO_2024_PROVENANCE,
  RU_NOMENCLATURE_PROVENANCE,
  CATEGORY_PROVENANCE,
  UNKNOWN_PROPERTY_PROVENANCE,
  ELEMENTS_WITH_CANDIDATES,
  NUBASE2020_PROVENANCE,
  isotopeCandidateCoverage
};
export type { ElementCatalogCoverage } from './elements';
export type { IsotopeCandidateCoverage } from './elementIsotopeCandidates';
