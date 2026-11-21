// ============================================
// GEOCHEMICAL PROCESS CATALOG - геохимические процессы Stage 4.9a.1
// ============================================
//
// ДАННЫЕ, НЕ ЛОГИКА (корректирующая ревизия Stage 4.9a.1).
//
// КОРРЕКТИРУЕТ ПРОБЛЕМУ C предыдущей ревизии: несколько ХИМИЧЕСКИХ
// превращений были описаны как обычные переносы одного неизменного
// speciesId — физически некорректно (силикатное и карбонатное
// выветривание, растворение с фазовым переходом, осаждение CaCO3,
// окисление органики, дегазация). Разделение труда стало строгим:
// - ПЕРЕНОС одного и того же вещества — FluxLedger (mechanism 'transport');
// - ХИМИЧЕСКОЕ/ФАЗОВОЕ превращение — ReactionLedger (mechanism 'reaction');
// - сопряжённые «реакция → перенос» — только при явно описанной
//   атомарной последовательности (mechanism 'coupled' + couplingSequence).
//
// СТАТУСЫ ГОТОВНОСТИ: ни одно химическое превращение этого каталога
// не реализовано (карбонатная химия, кинетика, реальные скорости —
// последующие срезы Stage 4.9, см. раздел 7 технологических границ).
// Реакционные и сопряжённые процессы имеют implementationStatus
// 'reaction_required' / 'not_implemented' и НЕ создают потоков:
// executeGeochemicalProcess возвращает not_applied с unsupported
// механизмом, а отсутствие реализации НЕ изображается нулевой
// скоростью или переносом «похожего» вещества.
//
// ЧИСЛЕННЫЕ СКОРОСТИ: У ВСЕХ процессов каталога скорость — status
// 'unknown' с обязательной причиной; по контракту geochemicalFluxes.ts
// такой процесс не исполняется и не создаёт фиктивных записей потоков.
// Численные значения добавляются в последующих срезах Stage 4.9 ТОЛЬКО
// при подтверждённом происхождении (DataProvenance с идентифицированным
// источником).
//
// Остальные соглашения (см. Core/geochemicalFluxes.ts и
// docs/science/PHYSICS_ARCHITECTURE.md §7.4):
// - количество вещества: mol/m² (столбовые запасы, basis column_amount);
// - скорость: mol·m⁻²·yr⁻¹ (внешняя) → mol·m⁻²·s⁻¹ (ядро FluxLedger),
//   1 yr = 365.25 × 86400 s = 31 557 600 s (ровно);
// - направление: положительная скорость + явные from/to (или
//   external_input/external_output с явной границей);
// - сохранение элементов (прежде всего C, O, H, Ca, Mg, Si) —
//   существующий auditElementConservation, вторая система аудита
//   НЕ создаётся.
//
// Идентификаторы резервуаров — топология геохимической модели
// (Core/geochemicalReservoirs.ts, справочник резервуаров Stage 4.9a.1):
// отсутствующий резервуар делает процесс неисполнимым (fail-closed),
// автоматического создания и суррогатов легаси-резервуаров нет.

import type { GeochemicalProcessSpec } from '../Core/geochemicalFluxes';
import {
  GEOCHEMICAL_INVENTORY_BASIS,
  validateGeochemicalProcessCatalog as validateGeochemicalProcessCatalogOf
} from '../Core/geochemicalFluxes';
import { GEOCHEMICAL_RESERVOIR_DICTIONARY } from '../Core/geochemicalReservoirs';

/**
 * Происхождение самого каталога (описания и классификация; числовые скорости отсутствуют):
 * описания и классификация процессов — кураторская таксономия
 * геохимического углеродного цикла; любые ЧИСЛЕННЫЕ скорости (ныне
 * отсутствующие) будут нести собственный per-процессный provenance отдельными
 * записями. Классификация механизмов — ревизия 4.9a.1 (проблема C).
 */
export const GEOCHEMICAL_PROCESS_CATALOG_PROVENANCE = {
  sourceName: 'Каталог геохимических процессов Stage 4.9a.1 (внутренняя таксономия углеродного цикла с классификацией механизмов)',
  sourceId: 'evowars/stage-4.9a.1/geochemical-process-catalog',
  retrievedAt: '2026-11-21',
  method: 'кураторская таксономия (volcanic/metamorphic degassing, weathering, dissolution/precipitation, exchange, burial, oxidation, subduction) с явным разнесением переносов (transport) и превращений (reaction/coupled), без численных скоростей',
  applicability: 'фундамент геохимических потоков Stage 4.9; исполнимы ТОЛЬКО transport-процессы с подтверждённой скоростью (сейчас — ни одного); реакции — только после реализации через ReactionLedger',
  limitations: 'числовые скорости отсутствуют (rate.unknown) у всех процессов; карбонатная химия, кинетика и кислородный цикл — вне этого каталога; резервуары задаются вызывающей стороной через явный builder',
  note: 'файл содержит данные (описания процессов), а не расчётную логику'
} as const;

const UNKNOWN_RATE_REASON =
  'характеристическая скорость процесса не подтверждена источником: численные значения Stage 4.9 добавляются только при верифицированном происхождении (mol·m⁻²·yr⁻¹ с DataProvenance)';

/** Общая строка диагностики каталога (фиктивность-предохранитель). */
const CATALOG_DIAGNOSTIC_NOTE =
  'процесс каталога описан без численной скорости (rate: unknown) и без реализации превращения: исполнение через executeGeochemicalProcess возвращает not_applied, запись потока не создаётся';

// ============================================
// ТИПЫ КАТАЛОГА (только данные)
// ============================================

/** Идентификатор резервуара Stage 4.9 (совпадает со справочником ядра). */
export type GeochemicalReservoirId = 'atmosphere' | 'ocean' | 'crust' | 'mantle';

/** Идентификатор внешней границы Stage 4.9 (соглашение каталога). */
export type GeochemicalBoundaryId = 'space' | 'deep_earth';

/** Описание резервуара каталога (текст, не логика). */
export interface GeochemicalReservoirDescription {
  readonly id: GeochemicalReservoirId;
  readonly description: string;
}

/**
 * Стандартные резервуары углеродного цикла Stage 4.9 (описания).
 * Единственный источник истины — типизированный справочник ядра
 * GEOCHEMICAL_RESERVOIR_DICTIONARY (Core/geochemicalReservoirs.ts,
 * Stage 4.9a.1, проблема B): перечисление ниже — проекция справочника
 * в текстовый формат совместимости, никаких вторых определений.
 */
export const GEOCHEMICAL_RESERVOIRS: readonly GeochemicalReservoirDescription[] =
  GEOCHEMICAL_RESERVOIR_DICTIONARY.map((d) => ({
    id: d.id,
    description: `${d.role}: ${d.physicalDescription}`
  }));

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
// КАТАЛОГ ПРОЦЕССОВ (углеродный цикл)
// ============================================
//
// Классификация Stage 4.9a.1 (проблема C):
// - transport + executable: ТОЛЬКО процессы, которые действительно
//   переносят ОДНО И ТО ЖЕ вещество (совпадающие speciesId и семантика);
//   исполнение через FluxLedger допустимо (но остаётся заблокированным
//   rate: unknown до появления верифицированных скоростей);
// - reaction: превращение — фиксируется ТОЛЬКО ReactionLedger в следующих
//   срезах; через FluxLedger НЕ исполняется никогда;
// - coupled: атомарная последовательность «реакция → перенос» с явной
//   couplingSequence; через один FluxLedger НЕ исполняется.

/**
 * Каталог геохимических процессов Stage 4.9a.1 (углеродный цикл).
 * Все спецификации проходят runtime-валидацию
 * validateGeochemicalProcessSpec (проверяется тестом).
 */
export const GEOCHEMICAL_PROCESS_CATALOG: readonly GeochemicalProcessSpec[] = [
  {
    processId: 'geo.volcanic_degas.co2.mantle->atm',
    processType: 'volcanic_degas',
    description: 'Вулканическая дегазация: выход глубинного углерода мантии в атмосферу через вулканизм в форме CO2',
    mechanism: 'reaction',
    implementationStatus: 'not_implemented',
    reactionIntent: {
      note: 'химическая форма углерода МЕНЯЕТСЯ: глубинный углерод мантии (без зарегистрированной химической формы в каталоге видов — фиктивный species не вводится) превращается в атмосферный CO2; это превращение через FluxLedger не изображается',
      reactantsNote: 'глубинный углерод мантии — конкретная химическая форма (например, C-фазы в расплавах) в каталоге видов НЕ зарегистрирована и не придумывается',
      productsNote: 'co2 — газовая форма легаси-каталога (id co2, фаза gas)'
    },
    implementationNote: 'исполнение потребует записи ReactionLedger с формой глубинного углерода и верифицированной конверсии; назначение — последующие срезы Stage 4.9',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'mantle', toReservoirId: 'atmosphere' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'планета с активным вулканизмом и запасом глубинного углерода; площадь поверхности задана моделью',
    conditions: 'наличие резервуаров mantle и атмосферы (столбовые запасы); скорость зависит от тепловой эволюции недр (вне Stage 4.9a.1)',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; превращение (механизм reaction) через FluxLedger не исполняется (implementationStatus: not_implemented)'
  },
  {
    processId: 'geo.metamorphic_degas.co2.crust->atm',
    processType: 'metamorphic_degas',
    description: 'Метаморфическая дегазация: декарбонизация карбонатов коры при метаморфизме с выходом CO2 в атмосферу',
    mechanism: 'reaction',
    implementationStatus: 'not_implemented',
    reactionIntent: {
      note: 'химическая форма углерода МЕНЯЕТСЯ: карбонатный углерод коры превращается в атмосферный CO2 (декарбонизация силикатами; стехиометрия будет фиксироваться ReactionLedger)',
      reactantsNote: 'caco3 (зарегистрирован) + силикатные минералы (виды силикатов в каталоге НЕ зарегистрированы — фиктивные species не вводятся)',
      productsNote: 'co2 (атмосферная газовая форма); кальциевый силикат — вне текущего каталога видов'
    },
    implementationNote: 'исполнение потребует регистрации силикатных видов и записи ReactionLedger; назначение — последующие срезы Stage 4.9',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'atmosphere' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'кора, содержащая карбонаты, при метаморфических условиях',
    conditions: 'наличие резервуаров crust и атмосферы (столбовые запасы); скорость связана с тектоникой (вне Stage 4.9a.1)',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; превращение (механизм reaction) через FluxLedger не исполняется (implementationStatus: not_implemented)'
  },
  {
    processId: 'geo.silicate_weathering.co2_aq.atm->ocn',
    processType: 'silicate_weathering',
    description: 'Выветривание силикатов: атмосферный CO2 связывается при выветривании силикатных пород, продукты выносятся в океан (щелочность и растворённый углерод)',
    mechanism: 'coupled',
    implementationStatus: 'not_implemented',
    reactionIntent: {
      note: 'сопряжённая операция: химическое связывание атмосферного CO2 при выветривании силиката ЗАТЕМ перенос продуктов в океан; финальная форма углерода (co2_aq/карбонатные ионы) отличается от исходной газовой co2',
      reactantsNote: 'co2 (атмосферная газовая форма) + силикатный минерал + вода (силикатные виды и ионы карбонатной химии НЕ зарегистрированы — фиктивные species не вводятся)',
      productsNote: 'растворённый углерод океана; целевой вид в этом каталоге — co2_aq (водная форма); карбонатные ионы (HCO3-/CO3^2-) — Stage 4.9'
    },
    couplingSequence: '1) реакция: силикат + CO2 + H2O → карбонатная щёлочность + растворённый углерод (запись ReactionLedger; стехиометрия с зарегистрированными видами — Stage 4.9); 2) перенос продуктов реакции из зоны выветривания в океан (запись FluxLedger как co2_aq). Исполнение — только согласованной парой записей, единственный FluxLedger-перенос запрещён',
    implementationNote: 'карбонатная химия (HCO3-/CO3^2-) и кинетика выветривания не реализуются в этой ревизии (границы Stage 4.9a.1)',
    speciesId: 'co2_aq',
    direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие силикатного материала и жидкой воды; зависимость от температуры/осадков — в последующих промптах',
    conditions: 'совместное существование атмосферы и океана (столбовые запасы); стехиометрия выветривания будет фиксироваться ReactionLedger при введении превращений',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; сопряжённая операция (mechanism coupled) через единственный FluxLedger-перенос не исполняется (implementationStatus: not_implemented)'
  },
  {
    processId: 'geo.carbonate_weathering.co2_aq.atm->ocn',
    processType: 'carbonate_weathering',
    description: 'Выветривание карбонатов: атмосферный CO2 расходуется при растворении карбонатных пород, продукты выносятся в океан',
    mechanism: 'coupled',
    implementationStatus: 'not_implemented',
    reactionIntent: {
      note: 'сопряжённая операция: химическое растворение карбонатной породы атмосферным CO2 ЗАТЕМ перенос продуктов в океан; форма углерода меняется (карбонатный углерод породы + газовый CO2 → растворённые формы)',
      reactantsNote: 'caco3 (порода) + co2 (атмосферный газ) + вода; ионные формы (Ca2+, HCO3-) в каталоге видов НЕ зарегистрированы (карбонатная химия — Stage 4.9)',
      productsNote: 'растворённые продукты (Ca2+ + 2HCO3- как намеченное превращение); в текущем каталоге видов целевого ионного вида НЕТ — фиктивный species не вводится'
    },
    couplingSequence: '1) реакция: CaCO3 + CO2 + H2O → Ca2+ + 2HCO3- (запись ReactionLedger; требует регистрации ионных видов — Stage 4.9); 2) перенос продуктов в океан (запись FluxLedger). Исполнение — только согласованной парой записей',
    implementationNote: 'заблокировано отсутствием ионных видов и карбонатной химии; не подменяется переносом co2_aq (пример «перенос финального вида» скрывал бы реагенты)',
    speciesId: 'co2_aq',
    direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие карбонатного материала и жидкой воды',
    conditions: 'совместное существование атмосферы и океана (столбовые запасы); углерод карбоната учитывается при введении превращений',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; сопряжённая операция (mechanism coupled) через единственный FluxLedger-перенос не исполняется (implementationStatus: not_implemented)'
  },
  {
    processId: 'geo.dissolution.co2_aq.atm->ocn',
    processType: 'dissolution',
    description: 'Растворение атмосферного CO2 в поверхностном океане: ФАЗОВЫЙ переход co2 (газ) → co2_aq (водный раствор), химической реакции нет',
    mechanism: 'reaction',
    implementationStatus: 'reaction_required',
    reactionIntent: {
      note: 'фазовое превращение: исходный и конечный виды РАЗНЫЕ (co2, фаза gas → co2_aq, фаза aqueous), поэтому процесс не является переносом одного вещества через FluxLedger; физическая растворимость (закон Генри, зависимость от температуры) — вне Stage 4.9a.1 и фиксируется отдельным срезом',
      reactantsNote: 'co2 — газовая форма (легаси-каталог, атм. столб)',
      productsNote: 'co2_aq — водная форма (геохимический каталог видов Stage 4.9a.1, океан)'
    },
    implementationNote: 'запись ReactionLedger для фазового перехода потребует контракта фазовых операций ядра; числовая скорость (растворимость по Генри) НЕ реализуется в этой ревизии — граница промпта 4.9a.1',
    speciesId: 'co2_aq',
    direction: { kind: 'internal_transfer', fromReservoirId: 'atmosphere', toReservoirId: 'ocean' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие океана и атмосферы; растворимость CO2 (закон Генри, температура) — вне Stage 4.9a.1',
    conditions: 'совместное существование атмосферы и океана (столбовые запасы)',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; фазовый переход (механизм reaction) через FluxLedger не исполняется; полная карбонатная химия океана (HCO3-/CO3^2-) НЕ подключается'
  },
  {
    processId: 'geo.ocean_atm_exchange.co2.ocn->atm',
    processType: 'ocean_atmosphere_exchange',
    description: 'Выделение CO2 из океана в атмосферу: ФАЗОВЫЙ переход co2_aq (водный раствор) → co2 (газ) при неравновесии парциональных давлений',
    mechanism: 'reaction',
    implementationStatus: 'reaction_required',
    reactionIntent: {
      note: 'фазовое превращение, обратное растворению: исходный и конечный виды РАЗНЫЕ (co2_aq, фаза aqueous → co2, фаза gas); не является переносом одного вещества',
      reactantsNote: 'co2_aq — водная форма (геохимический каталог видов Stage 4.9a.1)',
      productsNote: 'co2 — газовая форма (легаси-каталог, атм. столб)'
    },
    implementationNote: 'запись ReactionLedger для фазового перехода потребует контракта фазовых операций ядра; реальные скорости обмена НЕ реализуются в этой ревизии',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'atmosphere' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие океана и атмосферы; неравновесие pCO2 — вне Stage 4.9a.1',
    conditions: 'совместное существование океана и атмосферы (столбовые запасы); обратное направление отдельным процессом (положительные скорости и явные from/to), а НЕ отрицательной скоростью dissolution',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; фазовый переход (механизм reaction) через FluxLedger не исполняется; обязательная пара к geo.dissolution.co2_aq.atm->ocn'
  },
  {
    processId: 'geo.precipitation.caco3.ocn->crust',
    processType: 'precipitation',
    description: 'Осаждение карбоната кальция из океана в осадочный слой коры (ионы Ca2+/CO3^2- → минерал caco3)',
    mechanism: 'reaction',
    implementationStatus: 'not_implemented',
    reactionIntent: {
      note: 'химическое превращение: ионы океана связываются в твёрдый минерал; исходные ионы и минерал — разные виды, переносом не изображается',
      reactantsNote: 'Ca2+ и CO3^2- (ионы в каталоге видов НЕ зарегистрированы — карбонатная химия Stage 4.9; фиктивные species не вводятся)',
      productsNote: 'caco3 — твёрдая форма (геохимический каталог видов Stage 4.9a.1)'
    },
    implementationNote: 'заблокировано отсутствием ионных видов; равновесие HCO3-/CO3^2- и насыщение не реализуются в этой ревизии',
    speciesId: 'caco3',
    direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'crust' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'океан с растворённым Ca2+ и CO3^2-; насыщение/глубина компенсации — вне Stage 4.9a.1',
    conditions: 'наличие резервуаров ocean и crust (столбовые запасы); вид caco3 должен быть зарегистрирован в каталоге видов',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; минеральное превращение (Ca2+ + CO3^2- → CaCO3) при введении будет задано через ReactionLedger'
  },
  {
    processId: 'geo.organic_carbon_burial.c_org.ocn->crust',
    processType: 'organic_carbon_burial',
    description: 'Захоронение органического углерода: перенос bookkeeping-компонента c_org из океанического пула в осадочный пул коры БЕЗ изменения химической формы',
    mechanism: 'transport',
    implementationStatus: 'executable',
    speciesId: 'c_org',
    direction: { kind: 'internal_transfer', fromReservoirId: 'ocean', toReservoirId: 'crust' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'наличие органического углерода в океане; биология НЕ подключается на этапе фундамента',
    conditions: 'наличие резервуаров ocean и crust (столбовые запасы); вид c_org должен быть зарегистрирован в каталоге видов (геохимический каталог Stage 4.9a.1)',
    implementationNote: 'исполнимо через FluxLedger ТОЛЬКО как перенос между пулами с СОВПАДАЮЩЕЙ bookkeeping-семантикой c_org («моли атомов углерода органического пула»): если семантика пулов расходится, перенос не применяется; никакая реальная молекула органики не подразумевается (см. ORGANIC_CARBON_NOTE в geochemicalSpeciesCatalog)',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; исполнение через FluxLedger допустимо (transport + executable), но остаётся заблокированным rate: unknown до появления верифицированных скоростей'
  },
  {
    processId: 'geo.oxidation.co2.crust->atm',
    processType: 'oxidation',
    description: 'Окисление захоронённого органического углерода при выходе на поверхность: возврат углерода в атмосферу как CO2',
    mechanism: 'reaction',
    implementationStatus: 'not_implemented',
    reactionIntent: {
      note: 'химическое превращение: органический углерод + кислород → CO2; исходная (c_org) и конечная (co2) формы РАЗНЫЕ виды',
      reactantsNote: 'c_org (bookkeeping-компонент органики) + O2 (легаси-газ окислителя; кислородный цикл — вне Stage 4.9a.1)',
      productsNote: 'co2 — газовая форма (легаси-каталог, атм. столб)'
    },
    implementationNote: 'заблокировано кислородным балансом (dO2/dt — вне Stage 4.9a.1) и стехиометрией c_org (см. ORGANIC_CARBON_NOTE); запись ReactionLedger — последующие срезы Stage 4.9',
    speciesId: 'co2',
    direction: { kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'atmosphere' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'кора с органическим углеродом при доступе окислителя; окислительный баланс O — вне Stage 4.9a.1',
    conditions: 'наличие резервуаров crust и атмосферы (столбовые запасы); стехиометрия окисления (O2) будет фиксироваться ReactionLedger при введении превращений',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; превращение (механизм reaction) через FluxLedger не исполняется (implementationStatus: not_implemented)'
  },
  {
    processId: 'geo.subduction.caco3.crust->mantle',
    processType: 'subduction',
    description: 'Субдукция карбонатного материала: перенос карбоната кальция из коры в мантию БЕЗ изменения химической формы (метаморфизм — отдельный процесс дегазации)',
    mechanism: 'transport',
    implementationStatus: 'executable',
    speciesId: 'caco3',
    direction: { kind: 'internal_transfer', fromReservoirId: 'crust', toReservoirId: 'mantle' },
    rate: { status: 'unknown', reason: UNKNOWN_RATE_REASON },
    basis: GEOCHEMICAL_INVENTORY_BASIS,
    applicability: 'планета с тектоникой плит; скорость субдукции — вне Stage 4.9a.1',
    conditions: 'наличие резервуаров crust и mantle (столбовые запасы); вид caco3 должен быть зарегистрирован в каталоге видов',
    implementationNote: 'физический перенос подтверждается: минерал субдуцирует без химического изменения в рамках этого процесса; последующая дегазация — отдельная реакционная операция geo.metamorphic_degas.co2.crust->atm',
    diagnosticsNote: CATALOG_DIAGNOSTIC_NOTE + '; замыкает углеродный контур mantle ← crust ← ocean ← atmosphere ← mantle'
  }
] as const;

/**
 * Runtime-валидация начального каталога (первая линия защиты данных):
 * массив описаний с уникальными stable-id, каждое из которых проходит
 * validateGeochemicalProcessSpec (включая классификацию механизмов
 * Stage 4.9a.1 и запрет «executable» у reaction/coupled). Вызывается
 * тестами и может вызываться валидатором сохранений.
 */
export function validateInitialGeochemicalProcessCatalog(): string[] {
  return validateGeochemicalProcessCatalogOf(GEOCHEMICAL_PROCESS_CATALOG);
}
