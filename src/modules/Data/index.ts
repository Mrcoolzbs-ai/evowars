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
import {
  NUBASE2020_AUDIT_SOURCE,
  NUBASE_AUDIT_RANKED_ELEMENTS,
  NUBASE_AUDIT_UNIT_SECONDS,
  nubaseAuditUnitSeconds,
  parseNubaseAuditLine,
  parseNubaseAuditText,
  auditNubaseElement,
  auditNubaseText
} from './nubaseAudit';

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

// Stage 4.3.3 (аудит R3): воспроизводимая утилита аудита NUBASE2020 —
// парсер фиксированных колонок официального ASCII-файла, контекстная
// классификация состояний (i, s) и ранжирование кандидатов. Полный
// ASCII-файл NUBASE2020 в репозиторий не включается (отдельная
// лицензия файла AMDC не подтверждена): полный прогон выполняется на
// локально предоставленной копии официального файла.
export {
  NUBASE2020_AUDIT_SOURCE,
  NUBASE_AUDIT_RANKED_ELEMENTS,
  NUBASE_AUDIT_UNIT_SECONDS,
  nubaseAuditUnitSeconds,
  parseNubaseAuditLine,
  parseNubaseAuditText,
  auditNubaseElement,
  auditNubaseText
};
export type {
  NubaseAuditSource,
  NubaseAuditRow,
  NubaseAuditHalfLifeKind,
  NubaseAuditExclusion,
  NubaseAuditElementReport,
  NubaseAuditReport
} from './nubaseAudit';
