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

// Stage 4.3.3 (аудит R4, C3/C4): воспроизводимая утилита аудита NUBASE2020 —
// строгий fail-closed парсер фиксированных колонок официального ASCII-файла
// (диагностика обрезанных, повреждённых и дублирующихся строк), контекстная
// классификация состояний (i, s), ранжирование кандидатов, SHA-256
// ФАКТИЧЕСКОГО входного текста (computeNubaseAuditTextSha256) и метаданные
// конкретного запуска (NubaseAuditRunMetadata). Полный ASCII-файл NUBASE2020
// в репозиторий не включается (отдельная лицензия файла AMDC не
// подтверждена): полный прогон выполняется на локально предоставленной
// копии официального файла, побайтово сверяемой по SHA-256.
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

// Stage 4.5.4 (ревизия 4.5.4.2): каталог кинетических записей (JPL/KIDA) —
// реакционные идентичности экспорта KIDA three-body
// (kida_reac_tb_2015-03-19_1.csv из копии SophiaAtmo/PATMO@d78ec8e2,
// директория data/kida/, обращение 2026-11-03); параметры закона НЕ
// промоутированы (все константы unknown — вычислитель 4.5.2 отказывает);
// дословные числовые параметры, исходные строки CSV и метаданные
// курирования (networkMultiplicity, recommendation) НЕ воспроизводятся
// (лицензия unverified — KIDA Legal Notices; решение 4.5.4.2 НЕ объявляет
// оставшиеся поля автоматически лицензионно очищенными); блокирующие
// вопросы — KINETIC_CATALOG_BLOCKING_QUESTIONS, источники —
// DATA_PROVENANCE.md §2.28.
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
  KineticsCatalogError
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
  KineticsCatalogError
};
export type {
  KineticsDataSourceDescriptor,
  KidaTbRecordIdentity,
  KineticsCatalog
} from './kineticsCatalog';


// Stage 4.4.4.1: каталог чистокомпонентных параметров Peng–Robinson
// (co2, n2, ch4, h2o, ar): Tc/Pc — справочные значения критических точек
// фундаментальных EOS из публикаций JPCRD (reported), omega — INFO.acentric
// fluid-файлов CoolProp (software_dataset, master @ 8eb3b778, обращение
// 2026-11-04); каждое поле — собственный per-field provenance (антипаттерн
// общей строки CRITICAL_SOURCE НЕ воспроизводится). h2 исключён (изомерный
// состав, квантовый компонент); kij НАМЕРЕННО отсутствуют — пара без kij
// это отказ (fail-closed), НЕ kij = 0; формулы PR/Z/фугитивности —
// последующие подэтапы (4.4.4.2+). Конфликт CH4-omega (CoolProp 0.01142
// против Antoine-расчёта ≈ 0.00661, UNRESOLVED_CROSS_CHECK) и расхождение
// Ar-critical (легаси 150.86 K / 48.98 bar против Tegeler–Span–Wagner
// 150.687 K / 4.863 MPa) НЕ маскируются; phaseProperties.ts не изменён.
// Источники и ограничения — DATA_PROVENANCE.md §2.29.
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
