// ============================================
// GEOCHEMICAL PROCESS CATALOG - начальный каталог процессов Stage 4.9a
// ============================================
//
// ДАННЫЕ, НЕ ЛОГИКА: этот файл описывает типизированные спецификации
// геохимических процессов для фундамента Stage 4.9 «Геохимические циклы».
// Никаких расчётов, физических уравнений и ЧИСЛЕННЫХ скоростей здесь:
// характерные скорости выветривания, дегазации, растворения и
// захоронения НЕ придумываются — численные значения будут добавляться
// в последующих промптах Stage 4.9 ТОЛЬКО при подтверждённом
// происхождении (DataProvenance с идентифицированным источником).
//
// Поэтому У ВСЕХ процессов каталога скорость — status 'unknown' с
// обязательной причиной; по контракту geochemicalFluxes.ts такой
// процесс остаётся НЕИСПОЛНЯЕМЫМ и не создаёт фиктивных записей
// потоков. Это честная сериализация незнания: валидатор сохранений
// не превращают unknown в ноль, оценку или «тихий» пропуск.
//
// Соглашения Stage 4.9 (см. Core/geochemicalFluxes.ts и
// docs/science/PHYSICS_ARCHITECTURE.md §7.4):
// - количество вещества: mol/m² (столбовые запасы, basis column_amount);
// - скорость: mol·m⁻²·yr⁻¹ (внешняя) → mol·m⁻²·s⁻¹ (ядро FluxLedger),
//   1 yr = 365.25 × 86400 s = 31 557 600 s (ровно);
// - направление: положительная скорость + явные from/to (или
//   external_input/external_output с явной границей);
// - разделение труда: ПЕРЕНОС вещества — FluxLedger; ХИМИЧЕСКОЕ
//   превращение — ReactionLedger; reaction не изображается переносом
//   и наоборот. В этом каталоге — ТОЛЬКО переносы (превращения
//   углерода будут описываться через ReactionLedger в следующих
//   промптах Stage 4.9);
// - сохранение элементов (прежде всего C, O, H, Ca, Mg, Si) —
//   существующий auditElementConservation, вторая система аудита
//   НЕ создаётся.
//
// Идентификаторы резервуаров — названия состояний мира, а не
// зарезервированные номера: отсутствующий резервуар делает процесс
// неисполнимым (fail-closed), автоматического создания нет.

import type { GeochemicalProcessSpec } from '../Core/geochemicalFluxes';
import {
  GEOCHEMICAL_INVENTORY_BASIS,
  validateGeochemicalProcessCatalog as validateGeochemicalProcessCatalogOf
} from '../Core/geochemicalFluxes';

/**
 * Происхождение самого каталога (не чисел!): описания процессов —
 * общеизвестная таксономия геохимического углеродного цикла; любые
 * ЧИСЛЕННЫЕ скорости (ныне отсутствующие) будут нести собственный
 * per-процессный provenance отдельными записями.
 */
export const GEOCHEMICAL_PROCESS_CATALOG_PROVENANCE = {
  sourceName: 'Начальный каталог геохимических процессов Stage 4.9a (внутренняя таксономия переносов углеродного цикла)',
  sourceId: 'evowars/stage-4.9a/geochemical-process-catalog',
  retrievedAt: '2026-11-21',
  method: 'кураторская таксономия переносов (volcanic/metamorphic degassing, weathering, dissolution/precipitation, exchange, burial, oxidation, subduction) без численных скоростей',
  applicability: 'фундамент геохимических потоков Stage 4.9; исполнение возможно только после задания верифицированных скоростей',
  limitations: 'числовые скорости отсутствуют (rate.unknown); резервуары задаются вызывающей стороной; превращения — вне этого каталога (ReactionLedger)',
  note: 'файл содержит данные (описания процессов), а не расчётную логику'
} as const;

const UNKNOWN_RATE_REASON =
  'характеристическая скорость процесса не подтверждена источником: численные значения Stage 4.9 добавляются только при верифицированном происхождении (mol·m⁻²·yr⁻¹ с DataProvenance)';

/** Общие условия фиктивность-предохранителя каталога. */
const CATALOG_DIAGNOSTIC_NOTE =
  'процесс каталога описан без численной скорости (rate: unknown): исполнение через executeGeochemicalProcess возвращает not_applied, запись потока не создаётся';

// ============================================
// ТИПЫ КАТАЛОГА (только данные)
// ============================================

/** Идентификатор резервуара Stage 4.9 (соглашение каталога). */
export type GeochemicalReservoirId = 'atmosphere' | 'ocean' | 'crust' | 'mantle';

/** Идентификатор внешней границы Stage 4.9 (соглашение каталога). */
export type GeochemicalBoundaryId = 'space' | 'deep_earth';

/** Описание резервуара каталога (текст, не логика). */
export interface GeochemicalReservoirDescription {
  readonly id: GeochemicalReservoirId;
  readonly description: string;
}

/** Стандартные резервуары углеродного цикла Stage 4.9 (описания). */
export const GEOCHEMICAL_RESERVOIRS: readonly GeochemicalReservoirDescription[] = [
  { id: 'atmosphere', description: 'атмосферный столб (CO2 и другие газы), mol/m²' },
  { id: 'ocean', description: 'океан: растворённый неорганический и органический углерод, mol/m²' },
  { id: 'crust', description: 'земная кора: карбонаты, органический углерод осадков, mol/m²' },
  { id: 'mantle', description: 'мантия: глубинный углерод, mol/m²' }
] as const;

/** Описание внешней границы каталога. */
export interface GeochemicalBoundaryDescription {
  readonly id: GeochemicalBoundaryId;
  readonly description: string;
}

/** Стандартные границы Stage 4.9 (описания). */
export const GEOCHEMICAL_BOUNDARIES: readonly GeochemicalBoundaryDescription[] = [
  { id: 'space', description: 'верхняя граница атмосферы с космосом (поступления/потери вещества вне системы)' },
  { id: 'deep_earth', description: 'нижняя граница мантии: приток глубинного вещества из недр планеты' }
] as const;

// ============================================
// НАЧАЛЬНЫЙ КАТАЛОГ ПРОЦЕССОВ (углеродный цикл)
// ============================================
//
// Все спецификации проходят runtime-валидацию
// validateGeochemicalProcessSpec (проверяется тестом). Направления
// подобраны так, что внутренние переносы образуют замкнутый контур
// atm ⇄ ocn ⇄ crust ⇄ mantle; внешние процессы вне цикла не
// декларируются (внешний поток требует явной границы и обоснования).

/**
 * Начальный каталог процессов Stage 4.9a: минимальный набор переносов
 * углеродного цикла. Химические превращения (фотодиссоциация CO2,
 * окислительно-восстановительные реакции) в каталог НЕ входят.
 */
export const GEOCHEMICAL_PROCESS_CATALOG: readonly GeochemicalProcessSpec[] = [
  {
    processId: 'geo.volcanic_degas.co2.mantle->atm',
    processType: 'volcanic_degas',
    description: 'Вулканическая дегазация CO2: выделение глубинного углерода мантии в атмосферу через вулканизм',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'mantle', toReservoirId: 'atmosphere' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'планета с активным вулканизмом и запасом глубинного углерода; площадь поверхности задана моделью',
    conditions: 'наличие резервуаров mantle и атмосферы (столбовые запасы); скорость зависит от тепловой эволюции недр (вне Stage 4.9a)',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE
  },
  {
    processId: 'geo.metamorphic_degas.co2.crust->atm',
    processType: 'metamorphic_degas',
    description: 'Метаморфическая дегазация CO2: декарбонизация коры при метаморфизме с выходом CO2 в атмосферу',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'atmosphere' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'кора, содержащая карбонаты, при метаморфических условиях',
    conditions: 'наличие резервуаров crust и атмосферы (столбовые запасы); скорость связана с тектоникой (вне Stage 4.9a)',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE
  },
  {
    processId: 'geo.silicate_weathering.co2.atm->ocn',
    processType: 'silicate_weathering',
    description: 'Выветривание силикатов: атмосферный CO2 связывается при выветривании силикатных пород и выносится в океан (щелочность и растворённый углерод)',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие силикатного материала и жидкой воды; зависимость от температуры/осадков — в последующих промптах',
    conditions: 'совместное существование атмосферы и океана (столбовые запасы); стехиометрия выветривания будет фиксироваться ReactionLedger при введении превращений',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; перенос CO2 здесь — консервативное представление связывания углерода, превращение минерала описывается ReactionLedger отдельно'
  },
  {
    processId: 'geo.carbonate_weathering.co2.atm->ocn',
    processType: 'carbonate_weathering',
    description: 'Выветривание карбонатов: атмосферный CO2 расходуется при растворении карбонатных пород, продукты выносятся в океан',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие карбонатного материала и жидкой воды',
    conditions: 'совместное существование атмосферы и океана (столбовые запасы); углерод карбоната учитывается при введении превращений',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE
  },
  {
    processId: 'geo.dissolution.co2.atm->ocn',
    processType: 'dissolution',
    description: 'Растворение атмосферного CO2 в поверхностном океане (физическое растворение без химических превращений)',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие океана и атмосферы; растворимость CO2 (Henry, температура) — вне Stage 4.9a',
    conditions: 'совместное существование атмосферы и океана (столбовые запасы)',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; полная карбонатная химия океана (HCO3-/CO3^2-) НЕ подключается на этом этапе'
  },
  {
    processId: 'geo.ocean_atm_exchange.co2.ocn->atm',
    processType: 'ocean_atmosphere_exchange',
    description: 'Выделение CO2 из океана в атмосферу (физический обмен при неравновесии парциональных давлений)',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'atmosphere' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие океана и атмосферы; неравновесие pCO2 — вне Stage 4.9a',
    conditions: 'совместное существование океана и атмосферы (столбовые запасы); обратное направление отдельным процессом (положительные скорости и явные from/to), а НЕ отрицательной скоростью dissolution',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; обязательная пара к geo.dissolution.co2.atm->ocn'
  },
  {
    processId: 'geo.precipitation.caco3.ocn->crust',
    processType: 'precipitation',
    description: 'Осаждение карбоната кальция из океана в осадочный слой коры (поглощение растворённого углерода в минерал)',
    speciesId: 'caco3',
    direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'crust' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'океан с растворённым Ca2+ и CO3^2-; насыщение/глубина компенсации — вне Stage 4.9a',
    conditions: 'наличие резервуаров ocean и crust (столбовые запасы); вид caco3 должен быть зарегистрирован в каталоге видов',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; минеральное превращение (Ca2+ + CO3^2- → CaCO3) при введении будет задано через ReactionLedger'
  },
  {
    processId: 'geo.organic_carbon_burial.c.org->crust',
    processType: 'organic_carbon_burial',
    description: 'Захоронение органического углерода: органика из биосферы/океана консервируется в осадочном слое коры',
    speciesId: 'c_org',
    direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'crust' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие органического углерода в океане; биология НЕ подключается на этапе фундамента',
    conditions: 'наличие резервуаров ocean и crust (столбовые запасы); вид c_org должен быть зарегистрирован в каталоге видов',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE
  },
  {
    processId: 'geo.oxidation.c_org.crust->atm',
    processType: 'oxidation',
    description: 'Окисление захоронённого органического углерода при выходе на поверхность: возврат углерода в атмосферу (в основном как CO2)',
    speciesId: 'c_org',
    direction: { kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'atmosphere' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'кора с органическим углеродом при доступе окислителя; окислительный баланс O — вне Stage 4.9a',
    conditions: 'наличие резервуаров crust и атмосферы (столбовые запасы); стехиометрия окисления (O2) будет фиксироваться ReactionLedger при введении превращений',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE
  },
  {
    processId: 'geo.subduction.caco3.crust->mantle',
    processType: 'subduction',
    description: 'Субдукция: перенос карбонатного материала коры в мантию вместе с погружающейся плитой',
    speciesId: 'caco3',
    direction: { kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'mantle' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'планета с тектоникой плит; скорость субдукции — вне Stage 4.9a',
    conditions: 'наличие резервуаров crust и mantle (столбовые запасы); вид caco3 должен быть зарегистрирован в каталоге видов',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; замыкает углеродный контур mantle ← crust ← ocean ← atmosphere ← mantle'
  }
] as const;

/**
 * Runtime-валидация начального каталога (первая линия защиты данных):
 * массив описаний с уникальными stable-id, каждое из которых проходит
 * validateGeochemicalProcessSpec. Вызывается тестами и может вызываться
 * валидатором сохранений.
 */
export function validateInitialGeochemicalProcessCatalog(): string[] {
  return validateGeochemicalProcessCatalogOf(GEOCHEMICAL_PROCESS_CATALOG);
}
