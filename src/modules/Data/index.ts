// ============================================
// DATA MODULE - Ð­ÐºÑÐ¿Ð¾ÑÑ Ð²ÑÐµÑ  Ð´Ð°Ð½Ð½ÑÑ 
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
  NUBASE2020_BIBLIOGRAPHY,
  NUBASE2020_VERIFIED_SOURCE_SHA256,
  NUBASE2020_VERIFIED_SOURCE_BYTES,
  NUBASE2020_SOURCE_RETRIEVED_AT,
  NUBASE_AUDIT_PARSER_VERSION,
  NUBASE_AUDIT_RANKED_ELEMENTS,
  NUBASE_AUDIT_UNIT_SECONDS,
  nubaseAuditUnitSeconds,
  computeNubaseAuditTextSha256,
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

// Stage 4.3.3: Ð¿ÐµÑÐ¸Ð¾Ð´Ð¸ÑÐµÑÐºÐ°Ñ ÑÐ°Ð±Ð»Ð¸ÑÐ° â 118 Ñ Ð¸Ð¼Ð¸ÑÐµÑÐºÐ¸Ñ  ÑÐ»ÐµÐ¼ÐµÐ½ÑÐ¾Ð²
// (Ð¸Ð´ÐµÐ½ÑÐ¸ÑÐ¸ÐºÐ°ÑÐ¸Ñ IUPAC, Ð²ÐµÑÐ° Ð¸ ÑÐ°ÑÐ¿ÑÐ¾ÑÑÑÐ°Ð½ÑÐ½Ð½Ð¾ÑÑÐ¸ CIAAW 2024,
// Ð¸Ð·Ð¾ÑÐ¾Ð¿Ñ-ÐºÐ°Ð½Ð´Ð¸Ð´Ð°ÑÑ NUBASE2020; Ð°ÑÑÐ¸Ð±ÑÑÐ¸Ñ â elementDataAttribution.md).
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

// Stage 4.3.3 (Ð°ÑÐ´Ð¸Ñ R4, C3/C4): Ð²Ð¾ÑÐ¿ÑÐ¾Ð¸Ð·Ð²Ð¾Ð´Ð¸Ð¼Ð°Ñ ÑÑÐ¸Ð»Ð¸ÑÐ° Ð°ÑÐ´Ð¸ÑÐ° NUBASE2020 â
// ÑÑÑÐ¾Ð³Ð¸Ð¹ fail-closed Ð¿Ð°ÑÑÐµÑ ÑÐ¸ÐºÑÐ¸ÑÐ¾Ð²Ð°Ð½Ð½ÑÑ  ÐºÐ¾Ð»Ð¾Ð½Ð¾Ðº Ð¾ÑÐ¸ÑÐ¸Ð°Ð»ÑÐ½Ð¾Ð³Ð¾ ASCII-ÑÐ°Ð¹Ð»Ð°
// (Ð´Ð¸Ð°Ð³Ð½Ð¾ÑÑÐ¸ÐºÐ° Ð¾Ð±ÑÐµÐ·Ð°Ð½Ð½ÑÑ , Ð¿Ð¾Ð²ÑÐµÐ¶Ð´ÑÐ½Ð½ÑÑ  Ð¸ Ð´ÑÐ±Ð»Ð¸ÑÑÑÑÐ¸Ñ  ÑÑÑÐ¾Ðº), ÐºÐ¾Ð½ÑÐµÐºÑÑÐ½Ð°Ñ
// ÐºÐ»Ð°ÑÑÐ¸ÑÐ¸ÐºÐ°ÑÐ¸Ñ ÑÐ¾ÑÑÐ¾ÑÐ½Ð¸Ð¹ (i, s), ÑÐ°Ð½Ð¶Ð¸ÑÐ¾Ð²Ð°Ð½Ð¸Ðµ ÐºÐ°Ð½Ð´Ð¸Ð´Ð°ÑÐ¾Ð², SHA-256
// Ð¤ÐÐÐ¢ÐÐ§ÐÐ¡ÐÐÐÐ Ð²Ñ Ð¾Ð´Ð½Ð¾Ð³Ð¾ ÑÐµÐºÑÑÐ° (computeNubaseAuditTextSha256) Ð¸ Ð¼ÐµÑÐ°Ð´Ð°Ð½Ð½ÑÐµ
// ÐºÐ¾Ð½ÐºÑÐµÑÐ½Ð¾Ð³Ð¾ Ð·Ð°Ð¿ÑÑÐºÐ° (NubaseAuditRunMetadata). ÐÐ¾Ð»Ð½ÑÐ¹ ASCII-ÑÐ°Ð¹Ð» NUBASE2020
// Ð² ÑÐµÐ¿Ð¾Ð·Ð¸ÑÐ¾ÑÐ¸Ð¹ Ð½Ðµ Ð²ÐºÐ»ÑÑÐ°ÐµÑÑÑ (Ð¾ÑÐ´ÐµÐ»ÑÐ½Ð°Ñ Ð»Ð¸ÑÐµÐ½Ð·Ð¸Ñ ÑÐ°Ð¹Ð»Ð° AMDC Ð½Ðµ
// Ð¿Ð¾Ð´ÑÐ²ÐµÑÐ¶Ð´ÐµÐ½Ð°): Ð¿Ð¾Ð»Ð½ÑÐ¹ Ð¿ÑÐ¾Ð³Ð¾Ð½ Ð²ÑÐ¿Ð¾Ð»Ð½ÑÐµÑÑÑ Ð½Ð° Ð»Ð¾ÐºÐ°Ð»ÑÐ½Ð¾ Ð¿ÑÐµÐ´Ð¾ÑÑÐ°Ð²Ð»ÐµÐ½Ð½Ð¾Ð¹
// ÐºÐ¾Ð¿Ð¸Ð¸ Ð¾ÑÐ¸ÑÐ¸Ð°Ð»ÑÐ½Ð¾Ð³Ð¾ ÑÐ°Ð¹Ð»Ð°, Ð¿Ð¾Ð±Ð°Ð¹ÑÐ¾Ð²Ð¾ ÑÐ²ÐµÑÑÐµÐ¼Ð¾Ð¹ Ð¿Ð¾ SHA-256.
export {
  NUBASE2020_BIBLIOGRAPHY,
  NUBASE2020_VERIFIED_SOURCE_SHA256,
  NUBASE2020_VERIFIED_SOURCE_BYTES,
  NUBASE2020_SOURCE_RETRIEVED_AT,
  NUBASE_AUDIT_PARSER_VERSION,
  NUBASE_AUDIT_RANKED_ELEMENTS,
  NUBASE_AUDIT_UNIT_SECONDS,
  nubaseAuditUnitSeconds,
  computeNubaseAuditTextSha256,
  parseNubaseAuditLine,
  parseNubaseAuditText,
  auditNubaseElement,
  auditNubaseText
};
export type {
  NubaseBibliography,
  NubaseAuditRow,
  NubaseAuditHalfLifeKind,
  NubaseParseDiagnosticKind,
  NubaseParseDiagnostic,
  NubaseParseLineStats,
  NubaseParseResult,
  NubaseAuditExclusionKind,
  NubaseAuditExclusion,
  NubaseAuditElementReport,
  NubaseAuditOptions,
  NubaseAuditRunMetadata,
  NubaseAuditReport
} from './nubaseAudit';

// Stage 4.5.4 (ÑÐµÐ²Ð¸Ð·Ð¸Ñ 4.5.4.2): ÐºÐ°ÑÐ°Ð»Ð¾Ð³ ÐºÐ¸Ð½ÐµÑÐ¸ÑÐµÑÐºÐ¸Ñ  Ð·Ð°Ð¿Ð¸ÑÐµÐ¹ (JPL/KIDA) â
// ÑÐµÐ°ÐºÑÐ¸Ð¾Ð½Ð½ÑÐµ Ð¸Ð´ÐµÐ½ÑÐ¸ÑÐ½Ð¾ÑÑÐ¸ ÑÐºÑÐ¿Ð¾ÑÑÐ° KIDA three-body
// (kida_reac_tb_2015-03-19_1.csv Ð¸Ð· ÐºÐ¾Ð¿Ð¸Ð¸ SophiaAtmo/PATMO@d78ec8e2,
// Ð´Ð¸ÑÐµÐºÑÐ¾ÑÐ¸Ñ data/kida/, Ð¾Ð±ÑÐ°ÑÐµÐ½Ð¸Ðµ 2026-11-03); Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÑ Ð·Ð°ÐºÐ¾Ð½Ð° ÐÐ
// Ð¿ÑÐ¾Ð¼Ð¾ÑÑÐ¸ÑÐ¾Ð²Ð°Ð½Ñ (Ð²ÑÐµ ÐºÐ¾Ð½ÑÑÐ°Ð½ÑÑ unknown â Ð²ÑÑÐ¸ÑÐ»Ð¸ÑÐµÐ»Ñ 4.5.2 Ð¾ÑÐºÐ°Ð·ÑÐ²Ð°ÐµÑ);
// Ð´Ð¾ÑÐ»Ð¾Ð²Ð½ÑÐµ ÑÐ¸ÑÐ»Ð¾Ð²ÑÐµ Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÑ, Ð¸ÑÑ Ð¾Ð´Ð½ÑÐµ ÑÑÑÐ¾ÐºÐ¸ CSV Ð¸ Ð¼ÐµÑÐ°Ð´Ð°Ð½Ð½ÑÐµ
// ÐºÑÑÐ¸ÑÐ¾Ð²Ð°Ð½Ð¸Ñ (networkMultiplicity, recommendation) ÐÐ Ð²Ð¾ÑÐ¿ÑÐ¾Ð¸Ð·Ð²Ð¾Ð´ÑÑÑÑ
// (Ð»Ð¸ÑÐµÐ½Ð·Ð¸Ñ unverified â KIDA Legal Notices; ÑÐµÑÐµÐ½Ð¸Ðµ 4.5.4.2 ÐÐ Ð¾Ð±ÑÑÐ²Ð»ÑÐµÑ
// Ð¾ÑÑÐ°Ð²ÑÐ¸ÐµÑÑ Ð¿Ð¾Ð»Ñ Ð°Ð²ÑÐ¾Ð¼Ð°ÑÐ¸ÑÐµÑÐºÐ¸ Ð»Ð¸ÑÐµÐ½Ð·Ð¸Ð¾Ð½Ð½Ð¾ Ð¾ÑÐ¸ÑÐµÐ½Ð½ÑÐ¼Ð¸); Ð±Ð»Ð¾ÐºÐ¸ÑÑÑÑÐ¸Ðµ
// Ð²Ð¾Ð¿ÑÐ¾ÑÑ â KINETIC_CATALOG_BLOCKING_QUESTIONS, Ð¸ÑÑÐ¾ÑÐ½Ð¸ÐºÐ¸ â
// DATA_PROVENANCE.md Â§2.28.
// Ð ÐµÐ²Ð¸Ð·Ð¸Ñ 4.5.4.5 (08.11.2026): ÑÐºÑÐ¿Ð¾ÑÑ JPL_EVALUATION_20_ACCESS_AUDIT â per-record
// Ð°ÑÐ´Ð¸Ñ Ð´Ð¾ÑÑÑÐ¿Ð° JPL Evaluation No. 20; Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÑ ÐÐ Ð²ÐµÑÐ¸ÑÐ¸ÑÐ¸ÑÐ¾Ð²Ð°Ð½Ñ Ð¸ ÐÐ Ð¸Ð¼Ð¿Ð¾ÑÑÐ¸ÑÐ¾Ð²Ð°Ð½Ñ.
import {
  KIDA_DATABASE_SOURCE,
  KIDA_TB_EXPORT_SOURCE,
  JPL_EVALUATION_SOURCE,
  KIDA_TB_RECORD_IDENTITIES,
  KINETIC_CATALOG_DATA,
  KINETIC_CATALOG_BLOCKING_QUESTIONS,
  kidaTbRecordId,
  buildKidaTbReactionRecord,
  buildKineticsCatalog,
  KineticsCatalogError,
  JPL_EVALUATION_20_ACCESS_AUDIT
} from './kineticsCatalog';

export {
  KIDA_DATABASE_SOURCE,
  KIDA_TB_EXPORT_SOURCE,
  JPL_EVALUATION_SOURCE,
  KIDA_TB_RECORD_IDENTITIES,
  KINETIC_CATALOG_DATA,
  KINETIC_CATALOG_BLOCKING_QUESTIONS,
  kidaTbRecordId,
  buildKidaTbReactionRecord,
  buildKineticsCatalog,
  KineticsCatalogError,
  JPL_EVALUATION_20_ACCESS_AUDIT
};
export type {
  KineticsDataSourceDescriptor,
  KidaTbRecordIdentity,
  JplEvaluation20AccessAuditRecord,
  JplEvaluation20AccessAudit,
  KineticsCatalog
} from './kineticsCatalog';


// Stage 4.4.4.1: ÐºÐ°ÑÐ°Ð»Ð¾Ð³ ÑÐ¸ÑÑÐ¾ÐºÐ¾Ð¼Ð¿Ð¾Ð½ÐµÐ½ÑÐ½ÑÑ  Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÐ¾Ð² PengâRobinson
// (co2, n2, ch4, h2o, ar): Tc/Pc â ÑÐ¿ÑÐ°Ð²Ð¾ÑÐ½ÑÐµ Ð·Ð½Ð°ÑÐµÐ½Ð¸Ñ ÐºÑÐ¸ÑÐ¸ÑÐµÑÐºÐ¸Ñ  ÑÐ¾ÑÐµÐº
// ÑÑÐ½Ð´Ð°Ð¼ÐµÐ½ÑÐ°Ð»ÑÐ½ÑÑ  EOS Ð¸Ð· Ð¿ÑÐ±Ð»Ð¸ÐºÐ°ÑÐ¸Ð¹ JPCRD (reported), omega â INFO.acentric
// fluid-ÑÐ°Ð¹Ð»Ð¾Ð² CoolProp (software_dataset, master @ 8eb3b778, Ð¾Ð±ÑÐ°ÑÐµÐ½Ð¸Ðµ
// 2026-11-04); ÐºÐ°Ð¶Ð´Ð¾Ðµ Ð¿Ð¾Ð»Ðµ â ÑÐ¾Ð±ÑÑÐ²ÐµÐ½Ð½ÑÐ¹ per-field provenance (Ð°Ð½ÑÐ¸Ð¿Ð°ÑÑÐµÑÐ½
// Ð¾Ð±ÑÐµÐ¹ ÑÑÑÐ¾ÐºÐ¸ CRITICAL_SOURCE ÐÐ Ð²Ð¾ÑÐ¿ÑÐ¾Ð¸Ð·Ð²Ð¾Ð´Ð¸ÑÑÑ). h2 Ð¸ÑÐºÐ»ÑÑÑÐ½ (Ð¸Ð·Ð¾Ð¼ÐµÑÐ½ÑÐ¹
// ÑÐ¾ÑÑÐ°Ð², ÐºÐ²Ð°Ð½ÑÐ¾Ð²ÑÐ¹ ÐºÐ¾Ð¼Ð¿Ð¾Ð½ÐµÐ½Ñ); kij ÐÐÐÐÐ ÐÐÐÐ Ð¾ÑÑÑÑÑÑÐ²ÑÑÑ â Ð¿Ð°ÑÐ° Ð±ÐµÐ· kij
// ÑÑÐ¾ Ð¾ÑÐºÐ°Ð· (fail-closed), ÐÐ kij = 0; ÑÐ¾ÑÐ¼ÑÐ»Ñ PR/Z/ÑÑÐ³Ð¸ÑÐ¸Ð²Ð½Ð¾ÑÑÐ¸ â
// Ð¿Ð¾ÑÐ»ÐµÐ´ÑÑÑÐ¸Ðµ Ð¿Ð¾Ð´ÑÑÐ°Ð¿Ñ (4.4.4.2+). ÐÐ¾Ð½ÑÐ»Ð¸ÐºÑ CH4-omega (CoolProp 0.01142
// Ð¿ÑÐ¾ÑÐ¸Ð² Antoine-ÑÐ°ÑÑÑÑÐ° â 0.00661, UNRESOLVED_CROSS_CHECK) Ð¸ ÑÐ°ÑÑ Ð¾Ð¶Ð´ÐµÐ½Ð¸Ðµ
// Ar-critical (Ð»ÐµÐ³Ð°ÑÐ¸ 150.86 K / 48.98 bar Ð¿ÑÐ¾ÑÐ¸Ð² TegelerâSpanâWagner
// 150.687 K / 4.863 MPa) ÐÐ Ð¼Ð°ÑÐºÐ¸ÑÑÑÑÑÑ; phaseProperties.ts Ð½Ðµ Ð¸Ð·Ð¼ÐµÐ½ÑÐ½.
// ÐÑÑÐ¾ÑÐ½Ð¸ÐºÐ¸ Ð¸ Ð¾Ð³ÑÐ°Ð½Ð¸ÑÐµÐ½Ð¸Ñ â DATA_PROVENANCE.md Â§2.29.
import {
  EOS_PURE_COMPONENT_IDS,
  EOS_PURE_COMPONENT_PARAMETERS,
  EOS_VALUE_ORIGINS,
  EOS_EVIDENCE_STATUSES,
  EOS_CROSS_CHECK_OUTCOMES,
  EOS_CATALOG_SCOPE_NOTE,
  EOS_H2_EXCLUSION_NOTE,
  EOS_NO_BINARY_INTERACTION_NOTE,
  getEosPureComponentParameters,
  listEosPureComponentIds,
  validateEosScalarParameter,
  validateEosPureComponentRecord,
  validateEosCatalog,
  EosParametersError
} from './eosParameters';

export {
  EOS_PURE_COMPONENT_IDS,
  EOS_PURE_COMPONENT_PARAMETERS,
  EOS_VALUE_ORIGINS,
  EOS_EVIDENCE_STATUSES,
  EOS_CROSS_CHECK_OUTCOMES,
  EOS_CATALOG_SCOPE_NOTE,
  EOS_H2_EXCLUSION_NOTE,
  EOS_NO_BINARY_INTERACTION_NOTE,
  getEosPureComponentParameters,
  listEosPureComponentIds,
  validateEosScalarParameter,
  validateEosPureComponentRecord,
  validateEosCatalog,
  EosParametersError
};
export type {
  EosValueOrigin,
  EosEvidenceStatus,
  EosParameterProvenance,
  EosCrossCheckOutcome,
  EosCrossCheck,
  EosScalarParameter,
  EosPureComponentParameters,
  EosPureComponentGasId,
  EosParametersErrorCode
} from './eosParameters';

// Stage 4.4.4.2.1: ÑÐ°ÑÐ°Ð´ ÑÐ¸ÑÑÐ¾ÐºÐ¾Ð¼Ð¿Ð¾Ð½ÐµÐ½ÑÐ½Ð¾Ð³Ð¾ PengâRobinson Ð½Ð°Ð´ Core.
// ÐÑÑ Ð¸ÑÐµÐºÑÑÑÐ½Ð°Ñ Ð³ÑÐ°Ð½Ð¸ÑÐ° Core/Data (CORE_SCIENTIFIC_ENGINE.md):
// Core/pengRobinson.ts â ÑÐ¸ÑÑÐ°Ñ Ð¼Ð°ÑÐµÐ¼Ð°ÑÐ¸ÐºÐ° ÐÐÐ Ð¸Ð¼Ð¿Ð¾ÑÑÐ¾Ð² Ð¸Ð· Data
// (computePengRobinsonFromComponent Ð¿ÑÐ¸Ð½Ð¸Ð¼Ð°ÐµÑ Ð²Ð°Ð»Ð¸Ð´Ð¸ÑÐ¾Ð²Ð°Ð½Ð½ÑÐµ Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÑ
// Ð¸ evidence); Ð¿Ð¾Ð¸ÑÐº Ð¿Ð¾ gasId Ð² ÐºÐ°ÑÐ°Ð»Ð¾Ð³Ðµ 4.4.4.1, Ð¾Ð±ÑÐ°Ð±Ð¾ÑÐºÐ°
// EosParametersError Ð¸ Ð¿ÑÐ¸ÐºÑÐµÐ¿Ð»ÐµÐ½Ð¸Ðµ Ð¢ÐÐÐ ÐÐ Ð·Ð°Ð¼Ð¾ÑÐ¾Ð¶ÐµÐ½Ð½Ð¾Ð³Ð¾
// provenance-Ð´ÐµÑÐµÐ²Ð° ÐºÐ°ÑÐ°Ð»Ð¾Ð³Ð° Ðº ÑÐµÐ·ÑÐ»ÑÑÐ°ÑÑ Ð²ÑÐ¿Ð¾Ð»Ð½ÑÐµÑ Ð­Ð¢ÐÐ¢ ÑÐ»Ð¾Ð¹ Data
// (Data -> Core, Ð¾Ð±ÑÐ°ÑÐ½Ð¾Ðµ Ð½Ð°Ð¿ÑÐ°Ð²Ð»ÐµÐ½Ð¸Ðµ Ð·Ð°Ð¿ÑÐµÑÐµÐ½Ð¾; Ð¿ÑÐµÐ¶Ð½Ð¸Ð¹ ÑÐ¸ÐºÐ»
// Core -> Data -> Core ÑÑÑÑÐ°Ð½ÑÐ½). ÐÐµÐ·Ð°Ð²Ð¸ÑÐ¸Ð¼ÑÐ¹ CoolProp-benchmark â
// scripts/benchmarks/peng_robinson_coolprop.py (Ð¾ÑÐ´ÐµÐ»ÑÐ½ÑÐ¹ workflow,
// Ð² runtime-Ð·Ð°Ð²Ð¸ÑÐ¸Ð¼Ð¾ÑÑÐ¸ Ð¿ÑÐ¸Ð»Ð¾Ð¶ÐµÐ½Ð¸Ñ CoolProp ÐÐ Ð²Ñ Ð¾Ð´Ð¸Ñ); Ð¸ÑÑÐ¾ÑÐ½Ð¸ÐºÐ¸ Ð¸
// ÑÐµÐ·ÑÐ»ÑÑÐ°ÑÑ â DATA_PROVENANCE.md Â§2.30.
import { computePengRobinsonPure } from './pengRobinsonFacade';

export { computePengRobinsonPure };
export type {
  PengRobinsonPureRequest,
  PengRobinsonPureResult,
  PengRobinsonPureSuccess,
  PengRobinsonPureFailure
} from './pengRobinsonFacade';

// Stage 4.4.4.3: ÐºÐ°ÑÐ°Ð»Ð¾Ð³ Ð±Ð¸Ð½Ð°ÑÐ½ÑÑ  Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÐ¾Ð² Ð²Ð·Ð°Ð¸Ð¼Ð¾Ð´ÐµÐ¹ÑÑÐ²Ð¸Ñ kij
// PengâRobinson (Ð²ÑÐµ 10 Ð¿Ð°Ñ Ð¿ÑÑÐ¸ ÐºÐ¾Ð¼Ð¿Ð¾Ð½ÐµÐ½ÑÐ¾Ð² ÐºÐ°ÑÐ°Ð»Ð¾Ð³Ð° 4.4.4.1) Ñ
// per-pair provenance Ð¸ fail-closed lookup. ÐÑÐ´Ð¸Ñ Ð¸ÑÑÐ¾ÑÐ½Ð¸ÐºÐ¾Ð² Ð¸
// Ð¿Ð¾Ð»Ð¸ÑÐ¸ÐºÐ° ÐºÐ°ÑÐ°Ð»Ð¾Ð³Ð° â Ð·Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº Data/binaryInteractionParameters.ts Ð¸
// DATA_PROVENANCE.md Â§2.31; Ð¼Ð°ÑÐµÐ¼Ð°ÑÐ¸ÐºÐ° ÑÐ¼ÐµÑÐµÐ½Ð¸Ñ â
// Core/pengRobinsonMixture.ts, ÑÐ°ÑÐ°Ð´ Ð½Ð°Ð´ Ð¾Ð±Ð¾Ð¸Ð¼Ð¸ ÐºÐ°ÑÐ°Ð»Ð¾Ð³Ð°Ð¼Ð¸ â
// Data/pengRobinsonMixtureFacade.ts.
import {
  BINARY_INTERACTION_PARAMETERS,
  BINARY_INTERACTION_PAIR_KEYS,
  BINARY_INTERACTIONS_RETRIEVED_AT,
  BINARY_INTERACTIONS_SCOPE_NOTE,
  BINARY_NO_ZERO_DEFAULT_NOTE,
  BINARY_PAIR_STATUSES,
  canonicalBinaryPairKey,
  getBinaryInteractionCoverage,
  getBinaryInteractionParameter,
  listBinaryInteractionPairKeys,
  validateBinaryInteractionPairRecord,
  validateBinaryInteractionCatalog,
  BinaryInteractionError
} from './binaryInteractionParameters';

export {
  BINARY_INTERACTION_PARAMETERS,
  BINARY_INTERACTION_PAIR_KEYS,
  BINARY_INTERACTIONS_RETRIEVED_AT,
  BINARY_INTERACTIONS_SCOPE_NOTE,
  BINARY_NO_ZERO_DEFAULT_NOTE,
  BINARY_PAIR_STATUSES,
  canonicalBinaryPairKey,
  getBinaryInteractionCoverage,
  getBinaryInteractionParameter,
  listBinaryInteractionPairKeys,
  validateBinaryInteractionPairRecord,
  validateBinaryInteractionCatalog,
  BinaryInteractionError
};
export type {
  BinaryInteractionPairStatus,
  BinaryInteractionApplicability,
  BinaryInteractionAvailableRecord,
  BinaryInteractionUnresolvedRecord,
  BinaryInteractionPairRecord,
  BinaryInteractionErrorCode,
  BinaryInteractionCoverage
} from './binaryInteractionParameters';

// Stage 4.4.4.3: ÑÐ°ÑÐ°Ð´ ÑÐ¼ÐµÑÐµÐ²Ð¾Ð³Ð¾ PengâRobinson Ð½Ð°Ð´ Core.
// ÐÐ°Ð»Ð¸Ð´Ð°ÑÐ¸Ñ ÑÐ¾ÑÑÐ°Ð²Ð°, lookup ÑÐ¸ÑÑÑÑ  Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÐ¾Ð² (ÐºÐ°ÑÐ°Ð»Ð¾Ð³ 4.4.4.1) Ð¸
// Ð±Ð¸Ð½Ð°ÑÐ½ÑÑ  Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÐ¾Ð² Ð²Ð·Ð°Ð¸Ð¼Ð¾Ð´ÐµÐ¹ÑÑÐ²Ð¸Ñ kij (ÐºÐ°ÑÐ°Ð»Ð¾Ð³ 4.4.4.3, fail-closed:
// unresolved-Ð¿Ð°ÑÑ â ÑÐ²Ð½ÑÐ¹ Ð¾ÑÐºÐ°Ð·, kij = 0 Ð¼Ð¾Ð»ÑÐ° Ð½Ðµ Ð¿Ð¾Ð´ÑÑÐ°Ð²Ð»ÑÐµÑÑÑ),
// Ð²ÑÐ·Ð¾Ð² Core/pengRobinsonMixture.ts Ð¸ Ð¿ÑÐ¸ÐºÑÐµÐ¿Ð»ÐµÐ½Ð¸Ðµ Ð¢ÐÐÐ ÐÐ
// Ð·Ð°Ð¼Ð¾ÑÐ¾Ð¶ÐµÐ½Ð½Ð¾Ð³Ð¾ provenance-Ð´ÐµÑÐµÐ²Ð° ÐºÐ°ÑÐ°Ð»Ð¾Ð³Ð¾Ð² Ðº ÑÐµÐ·ÑÐ»ÑÑÐ°ÑÑ.
import { computePengRobinsonMixtureFromCatalog } from './pengRobinsonMixtureFacade';

export { computePengRobinsonMixtureFromCatalog };
export type {
  PengRobinsonMixtureCompositionEntry,
  PengRobinsonMixtureCatalogRequest,
  PengRobinsonMixtureCatalogResult,
  PengRobinsonMixtureCatalogSuccess,
  PengRobinsonMixtureComponentProvenance,
  PengRobinsonMixtureBinaryProvenance
} from './pengRobinsonMixtureFacade';


// Stage 4.4.4.6: ÑÐ°ÑÐ°Ð´ VLE flash PengâRobinson Ð½Ð°Ð´ Core.
// ÐÐ°Ð»Ð¸Ð´Ð°ÑÐ¸Ñ ÑÐ¾ÑÑÐ°Ð²Ð° Ð¸ ÑÐ½Ð¸ÐºÐ°Ð»ÑÐ½Ð¾ÑÑÐ¸ gasId, lookup ÑÐ¸ÑÑÑÑ  Ð¿Ð°ÑÐ°Ð¼ÐµÑÑÐ¾Ð²
// (ÐºÐ°ÑÐ°Ð»Ð¾Ð³ 4.4.4.1) Ð¸ ÐÐ¡ÐÐ¥ Ð¿Ð°Ñ kij Ð°ÐºÑÐ¸Ð²Ð½ÑÑ  ÐºÐ¾Ð¼Ð¿Ð¾Ð½ÐµÐ½ÑÐ¾Ð² (ÐºÐ°ÑÐ°Ð»Ð¾Ð³
// 4.4.4.3, fail-closed: unresolved-Ð¿Ð°ÑÐ° â ÑÐ²Ð½ÑÐ¹ Ð¾ÑÐºÐ°Ð·, kij = 0 Ð¼Ð¾Ð»ÑÐ°
// Ð½Ðµ Ð¿Ð¾Ð´ÑÑÐ°Ð²Ð»ÑÐµÑÑÑ), Ð²ÑÐ·Ð¾Ð² Core/pengRobinsonFlash.ts Ð¸ Ð¿ÑÐ¸ÐºÑÐµÐ¿Ð»ÐµÐ½Ð¸Ðµ
// provenance ÐºÐ°ÑÐ°Ð»Ð¾Ð³Ð¾Ð² Ðº ÑÐµÐ·ÑÐ»ÑÑÐ°ÑÑ. ÐÐ³ÑÐ°Ð½Ð¸ÑÐµÐ½Ð¸Ñ Ð¸ÑÑÐ¾ÑÐ½Ð¸ÐºÐ¾Ð² Ð¸
// Ð´Ð¸Ð°Ð¿Ð°Ð·Ð¾Ð½Ñ Ð¿ÑÐ¸Ð¼ÐµÐ½Ð¸Ð¼Ð¾ÑÑÐ¸ kij Ð½Ðµ ÑÐºÑÑÐ²Ð°ÑÑÑÑ; verdict 'stable'
// Ð½Ðµ Ð¿ÑÐµÐ´ÑÑÐ¼Ð¾ÑÑÐµÐ½.
import { computePengRobinsonFlashFromCatalog } from './pengRobinsonFlashFacade';

export { computePengRobinsonFlashFromCatalog };
export type {
  PengRobinsonFlashCompositionEntry,
  PengRobinsonFlashCatalogRequest,
  PengRobinsonFlashCatalogResult,
  PengRobinsonFlashCatalogSuccess,
  PengRobinsonFlashComponentProvenance,
  PengRobinsonFlashBinaryProvenance
} from './pengRobinsonFlashFacade';

// ============================================
// Stage 4.7.1: ÐºÐ°ÑÐ°Ð»Ð¾Ð³ EOS ÐºÐ¾Ð½Ð´ÐµÐ½ÑÐ¸ÑÐ¾Ð²Ð°Ð½Ð½ÑÑ  Ð¼Ð°ÑÐµÑÐ¸Ð°Ð»Ð¾Ð² Ð¿Ð»Ð°Ð½ÐµÑÐ½ÑÑ  Ð½ÐµÐ´Ñ.
// ÐÐ¾Ð²ÑÐ¹ Ð°Ð´Ð´Ð¸ÑÐ¸Ð²Ð½ÑÐ¹ Ð±Ð»Ð¾Ðº: Ð´Ð°Ð½Ð½ÑÐµ, per-parameter provenance, runtime
// -Ð²Ð°Ð»Ð¸Ð´Ð°ÑÐ¸Ñ Ð¸ fail-closed lookup. Ð¤Ð¾ÑÐ¼ÑÐ»Ñ BM3, Ð¿ÑÑÐ¼Ð°Ñ P(Ï) Ð¸ Ð¾Ð±ÑÐ°ÑÐ½Ð°Ñ
// Ï(P) Ð·Ð°Ð´Ð°ÑÐ¸ â Ð² Core/condensedMatterEos.ts. ÐÐ°Ð·Ð¾Ð²ÑÐ¹ ÐºÐ°ÑÐ°Ð»Ð¾Ð³
// PengâRobinson (eosParameters.ts) Ð½Ðµ Ð·Ð°ÑÑÐ¾Ð½ÑÑ Ð¸ Ð½Ðµ Ð¿ÐµÑÐµÐ¸ÑÐ¿Ð¾Ð»ÑÐ·ÑÐµÑÑÑ.
// ============================================
export {
  PlanetaryEosLookupError,
  PLANETARY_EOS_CATALOG_SCOPE_NOTE,
  PLANETARY_EOS_RECORDS,
  validatePlanetaryEosCatalog,
  listPlanetaryEosMaterialIds,
  getPlanetaryEosRecord,
  tryGetPlanetaryEosRecord
} from './planetaryEos';

// ============================================
// Stage 4.7.2: ÑÐ¿ÑÐ°Ð²Ð¾ÑÐ½Ð°Ñ Ð¼Ð¾Ð´ÐµÐ»Ñ Ð¿Ð»Ð¾ÑÐ½Ð¾ÑÑÐ¸ PREM (Dziewonski & Anderson,
// 1981, Table I) Ð¸ Ð³Ð¸Ð´ÑÐ¾ÑÑÐ°ÑÐ¸ÑÐµÑÐºÐ°Ñ ÑÐµÐºÐ¾Ð½ÑÑÑÑÐºÑÐ¸Ñ Ð¿Ð¾Ð²ÐµÑÑ  Ð½ÐµÑ ÑÐµÑÐµÐ·
// Core/hydrostaticInterior. Ð ÐµÐºÐ¾Ð½ÑÑÑÑÐºÑÐ¸Ñ Ð¿Ð¾ ÐÐÐÐÐÐÐÐÐ£ Ð¿ÑÐ¾ÑÐ¸Ð»Ñ Ð¿Ð»Ð¾ÑÐ½Ð¾ÑÑÐ¸,
// ÐÐ EOS-Ð¿ÑÐµÐ´ÑÐºÐ°Ð·Ð°Ð½Ð¸Ðµ Ð³Ð¾ÑÑÑÐµÐ¹ ÐÐµÐ¼Ð»Ð¸.
// ============================================
export {
  PREM_MEAN_RADIUS_M,
  PREM_CENTRAL_PRESSURE_PUBLISHED_PA,
  PREM_TOTAL_MASS_CONSTRAINT_KG,
  PREM_MOMENT_OF_INERTIA_FACTOR_CONSTRAINT,
  PREM_REFERENCE_SOURCE,
  PREM_LAYERS,
  premDensityGcm3,
  premDensityKgM3,
  premHydrostaticLayers,
  validatePremCatalog,
  solvePremHydrostaticInterior,
  type PremLayerSpec
} from './premReference';

// ============================================
// Stage 4.7.3: ÐºÐ°ÑÐ°Ð»Ð¾Ð³ ÑÐ°Ð´Ð¸Ð¾Ð³ÐµÐ½Ð½ÑÑ  Ð½ÑÐºÐ»Ð¸Ð´Ð¾Ð² (Korenaga 2008 Ð¿Ð¾Ð»ÑÑÐ°ÑÐ¿Ð°Ð´Ñ
// Ð¸ Ð¸Ð·Ð¾ÑÐ¾Ð¿Ð½ÑÐµ Ð´Ð¾Ð»Ð¸; Ruedas 2017 Table 4 ÑÐ½ÐµÑÐ³Ð¸Ð¸ ÑÐ°ÑÐ¿Ð°Ð´Ð°, Ð¼Ð¾Ð»ÑÑÐ½ÑÐµ Ð¼Ð°ÑÑÑ,
// ÑÐ´ÐµÐ»ÑÐ½ÑÐµ ÑÐµÐ¿Ð»Ð¾Ð¿ÑÐ¾Ð´ÑÐºÑÐ¸Ð¸). ÐÐµÐ¹ÑÑÐ¸Ð½Ð¾ Ð¸ÑÐºÐ»ÑÑÐµÐ½Ñ Ð¸Ð· E_H; Ð±Ð°Ð·Ñ Ð¼Ð°ÑÑ
// (Ð¸Ð·Ð¾ÑÐ¾Ð¿ vs Ð¿ÑÐ¸ÑÐ¾Ð´Ð½ÑÐ¹ ÑÐ»ÐµÐ¼ÐµÐ½Ñ) ÑÐ°Ð·Ð´ÐµÐ»ÐµÐ½Ñ.
// ============================================
export {
  RADIOGENIC_NUCLIDE_RECORDS,
  ELEMENT_TO_NUCLIDE_CONVERSIONS,
  NATURAL_ELEMENT_MOLAR_MASS_KG_PER_MOL,
  KORENAGA_2008_PROVENANCE,
  RUEDAS_2017_PROVENANCE,
  CHAIN_Q_CONFIRMATION_PROVENANCE,
  NUBASE2016_VIA_RUEDAS_PROVENANCE,
  tryGetRadiogenicNuclide,
  validateRadiogenicNuclideCatalog,
  type RadiogenicNuclideId,
  type HeatEnergyAccounting,
  type RadiogenicUncertaintyRecord,
  type RadiogenicNuclideRecord
} from './radiogenicNuclides';

// ============================================
// Stage 4.8.1: Ð²ÐµÑÑÐ¸ÐºÐ°Ð»ÑÐ½Ð°Ñ Ð³Ð¸Ð´ÑÐ¾ÑÑÐ°ÑÐ¸ÑÐµÑÐºÐ°Ñ ÑÑÑÑÐºÑÑÑÐ° Ð°ÑÐ¼Ð¾ÑÑÐµÑÑ.
// ÐÐ¾ÑÑÑÐ¿ Ðº ÐºÐ°ÑÐ°Ð»Ð¾Ð³Ñ Ð³Ð°Ð·Ð¾Ð² Ð¿Ð¾ gasId (null â Ð²Ð¸Ð´Ð° Ð½ÐµÑ, Ð½Ðµ Ð½ÑÐ»ÐµÐ²Ð°Ñ
// Ð¼Ð¾Ð»ÑÑÐ½Ð°Ñ Ð¼Ð°ÑÑÐ°) Ð¸ Ð½ÐµÐ·Ð°Ð²Ð¸ÑÐ¸Ð¼ÑÐµ ÑÐµÑÐµÑÐµÐ½ÑÐ½ÑÐµ Ð¿ÑÐ¾ÑÐ¸Ð»Ð¸/ÑÐºÐ¾ÑÑ
// (USSA 1976; ÐÐµÐ½ÐµÑÐ° VIRA-Ð¾ÑÐ¸ÐµÐ½ÑÐ¸ÑÑ not_verifiable; Ð¢Ð¸ÑÐ°Ð½ HASI).
// ============================================
export { tryGetGasSpecies } from './gases';
export {
  USSA_1976_PROVENANCE,
  USSA_1976_CONSTANTS,
  USSA_1976_LAYERS,
  USSA_1976_CHECK_NODES,
  USSA_1976_EQUIVALENT_BODY_MASS_KG,
  USSA_1976_DRY_AIR_COMPOSITION,
  VENUS_VIRA_ORIENTATION,
  TITAN_HASI_SURFACE_ANCHOR,
  geopotentialToGeometricM,
  type ReferenceVerificationStatus,
  type Ussa1976LayerRecord,
  type Ussa1976CheckNode
} from './atmosphericReferenceProfiles';

// ============================================
// Stage 4.8.2.1: ÑÐ¿ÐµÐºÑÑÐ°Ð»ÑÐ½Ð°Ñ Ð½ÐµÐ¿ÑÐ¾Ð·ÑÐ°ÑÐ½Ð¾ÑÑÑ - ÑÐ¿ÑÐ°Ð²Ð¾ÑÐ½ÑÐµ Ð´Ð°Ð½Ð½ÑÐµ.
// ÐÐ¾Ð½ÑÑÐ°Ð½ÑÑ ÑÐ¾ÑÐ¼ÑÐ» HITRAN (c2 Ð¸ Ð¿Ñ.), Ð²ÐµÑÐ¸ÑÐ¸ÑÐ¸ÑÐ¾Ð²Ð°Ð½Ð½ÑÐ¹ ÑÑÐ°Ð³Ð¼ÐµÐ½Ñ
// molparam.txt (ÑÐ°ÑÐ¿ÑÐ¾ÑÑÑÐ°Ð½ÑÐ½Ð½Ð¾ÑÑÑ, Q(296K), gj, Ð¼Ð¾Ð»ÑÑÐ½Ð°Ñ Ð¼Ð°ÑÑÐ°),
// ÑÑÐ°ÑÑÑ line-by-line Ð·Ð°Ð¿Ð¸ÑÐµÐ¹ (not_verifiable) Ð¸ ÐÐ£ÐÐ£Ð©ÐÐ ÐºÐ¾Ð½ÑÑÐ°ÐºÑÑ
// ÐºÐ¾Ð½ÑÐ¸Ð½ÑÑÐ¼Ð¾Ð² CIA/MT_CKD (Ð±ÐµÐ· ÐºÐ¾ÑÑÑÐ¸ÑÐ¸ÐµÐ½ÑÐ¾Ð²).
// ============================================
export {
  HITRAN_SPECTRAL_CONSTANTS,
  HITRAN_CONSTANTS_PROVENANCE,
  secondRadiationConstantCmK,
  speedOfLightMs,
  ln2,
  sqrtLn2,
  MOLPARAM_FRAGMENT,
  MOLPARAM_FRAGMENT_BY_ISO,
  HITRAN_LINE_LIST_STATUS,
  HITRAN_CIA_CONTRACT,
  MT_CKD_CONTRACT,
  type MolparamIsotopologueRecord,
  type SpectralReferenceStatus
} from './spectralOpacityReferenceData';
// ============================================
// Stage 4.9a: начальный каталог геохимических процессов (углеродный цикл).
// ТОЛЬКО данные: физические описания переносов между резервуарами
// (atmosphere/ocean/crust/mantle), все скорости unknown с обязательной
// причиной — числовые скорости добавятся в Stage 4.9 только при
// верифицированном происхождении. Контракт и исполнение — Core/geochemicalFluxes.
// ============================================
export {
  GEOCHEMICAL_PROCESS_CATALOG,
  GEOCHEMICAL_PROCESS_CATALOG_PROVENANCE,
  GEOCHEMICAL_RESERVOIRS,
  GEOCHEMICAL_BOUNDARIES,
  validateInitialGeochemicalProcessCatalog,

  type GeochemicalReservoirId,
  type GeochemicalBoundaryId,
  type GeochemicalReservoirDescription,
  type GeochemicalBoundaryDescription
} from './geochemicalProcessCatalog';


// ============================================
// Stage 4.9a.1 (корректирующая ревизия, проблема A): геохимические вещества —
// ОТДЕЛЬНЫЙ каталог данных (Data/gases.ts остаётся каталогом газов).
// Определения GeochemicalSpeciesDefinition (co2_aq, caco3, c_org), сборка
// самостоятельного каталога и АДДИТИВНОЕ слияние с производственным
// каталогом видов. Механизм — Core/geochemicalSpecies.
// ============================================
export {
  GEOCHEMICAL_SPECIES_DEFINITIONS,
  GEOCHEMICAL_SPECIES_CATALOG_PROVENANCE,
  ORGANIC_CARBON_NOTE,
  validateGeochemicalSpeciesDefinitions,
  buildGeochemicalSpeciesCatalog,
  addGeochemicalSpeciesToCatalog
} from './geochemicalSpeciesCatalog';


// Stage 4.2: source-backed Mars radio-occultation data (MGS PDS product 8028D38A).
export {
  MGS_MARS_8028D38A_METADATA,
  MGS_MARS_8028D38A_PROVENANCE,
  MGS_MARS_8028D38A_SAMPLES
} from './mgsMarsOccultation1998';
export type { MgsMarsOccultationSample } from './mgsMarsOccultation1998';


// Stage 4.2: source-separated Mars atmospheric composition and radical constraints.
export {
  MARS_SAM_GALE_CRATER_PROVENANCE,
  MARS_SAM_GALE_CRATER_ANNUAL_MEAN,
  assessMarsSamCompositionCoverage,
  MARS_HO2_ACS_UPPER_LIMITS,
  MARS_HO2_OPENMARS_DUSTY_SEASON_ESTIMATES
} from './marsAtmosphericChemistry';
export type {
  MarsAtmosphericSourceProvenance,
  MarsSamAnnualMeanRecord,
  MarsSamCompositionCoverage,
  MarsHo2UpperLimitPoint,
  MarsHo2ModelledRange
} from './marsAtmosphericChemistry';

// Stage 4.2: Taysum & Palmer (2020) model-tabulated Mars photolysis frequencies.
export {
  MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE,
  MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS,
  evaluateMarsPhotolysisAtReferenceNode
} from './marsPhotochemistryEvidence';
export type {
  MarsPhotolysisSpeciesId,
  MarsPhotolysisStoichiometricTerm,
  MarsPhotolysisReferenceNode,
  MarsPhotolysisChannel,
  MarsPhotolysisEvaluationInput,
  MarsPhotolysisEvaluation,
  MarsPhotolysisEvaluationRejection,
  MarsPhotolysisEvaluationResult
} from './marsPhotochemistryEvidence';



// Stage 4.2: source-backed gas-phase Mars photochemistry rates (Taysum & Palmer, 2020).
export {
  MARS_TAYSUM_2020_GAS_PHASE_PROVENANCE,
  MARS_TAYSUM_2020_GAS_PHASE_REACTIONS,
  MARS_GAS_PHASE_SPECIES_ELEMENTS,
  evaluateMarsGasPhaseReaction,
  validateMarsGasPhaseReactionBalance
} from './marsGasPhaseKinetics';
export type {
  MarsGasSpeciesId,
  MarsGasStoichiometricTerm,
  MarsGasRateExpression,
  MarsGasPhaseReaction,
  MarsGasPhaseEvaluationInput,
  MarsGasPhaseEvaluationResult
} from './marsGasPhaseKinetics';


// Stage 4.2: MAVEN IUVS published retrieval evidence and NGIMS L2 profile reader.
export {
  MAVEN_NGIMS_PDS_SIS_PROVENANCE,
  MAVEN_NGIMS_PDS_ARCHIVE,
  MAVEN_INSITU_KP_PDS_ARCHIVE,
  validateMavenNgimsL2NeutralRow,
  buildMavenNgimsNeutralProfile,
  buildMavenNgimsNeutralProfileFromMeasurements,
  buildMavenNgimsNeutralProfileFromCsvImport,
  parseMavenNgimsL2NeutralCsvRow,
  MAVEN_IUVS_NO_DAYGLOW_REFERENCE,
  MAVEN_IUVS_ATOMIC_OXYGEN_130KM_MODEL_CONSTRAINED_RATIOS
} from './mavenUpperAtmosphereEvidence';
export type {
  MavenUpperAtmosphereProvenance,
  MavenNgimsNeutralQuality,
  MavenNgimsFocusMode,
  MavenNgimsL2NeutralAbundanceRow,
  MavenNgimsNeutralMeasurement,
  MavenNgimsValidationError,
  MavenNgimsRowValidation,
  MavenNgimsImportPolicy,
  MavenNgimsProfileBuildResult,
  MavenNgimsProfileSelection
} from './mavenUpperAtmosphereEvidence';

export { parseMavenNgimsL2NeutralCsvText } from './mavenUpperAtmosphereEvidence';
export type {
  MavenNgimsL2CsvRowResult,
  MavenNgimsL2CsvImportResult
} from './mavenUpperAtmosphereEvidence';
