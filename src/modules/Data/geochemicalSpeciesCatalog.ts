// ============================================
// GEOCHEMICAL SPECIES CATALOG - геохимические вещества (Stage 4.9a.1 + 4.9c)
// ============================================
//
// ДАННЫЕ, НЕ ЛОГИКА (корректирующая ревизия Stage 4.9a.1, проблема A;
// расширение Stage 4.9c — водные ионы карбонатной системы).
//
// Проблема предыдущей ревизии: каталог процессов ссылался на виды
// «caco3» и «c_org», которые отсутствуют в производственной среде
// (buildSpeciesCatalogFromLegacy строит SpeciesCatalog только из
// Data/gases.ts + Data/elementCompositions.ts), а тесты добавляли их
// вручную как синтетические виды — то есть проверяли искусственную
// среду, а не возможность реального исполнения процессов.
//
// РЕШЕНИЕ:
// - геохимические вещества описываются ОТДЕЛЬНЫМ каталогом данных
//   (этот файл) в структуре GeochemicalSpeciesDefinition, совместимой
//   с ScientificSpecies и SpeciesCatalog ядра; Data/gases.ts НЕ
//   расширяется минералами и органикой (это каталог газов);
// - объединённый производственный каталог строится АДДИТИВНО:
//   легаси-газы остаются как есть, геохимические виды добавляются
//   через mergeGeochemicalSpeciesIntoCatalog (Core/geochemicalSpecies);
// - фазовая идентичность: CO2(г) с id 'co2' (легаси) и CO2(aq) с id
//   'co2_aq' — РАЗНЫЕ виды с разными id и фазами;
// - формулы и элементные составы ниже — установленная химия (IUPAC);
//   они достаточны для элементного аудита; молярные массы —
//   справочные значения со своим provenance (перевод в кг возможен);
// - у органического углерода числовой молярной массы НЕТ: она
//   не назначается автоматически, и перевод органики в кг
//   заблокирован (неизвестная масса), при этом элементный учёт
//   углерода работает (см. ORGANIC_CARBON_NOTE).
//
// Stage 4.9c (водные ионы карбонатной системы): добавлены hco3_aq,
// co3_aq, hplus_aq, oh_aq и (для элементного баланса диссоциаций)
// растворитель h2o_aq с реальными формулами, зарядами и
// молярными массами (суммы стандартных атомных весов IUPAC 2021).
// Добавление АДДИТИВНО: ни одна существующая запись не изменена по
// существу; карбонатная химия (равновесное распределение DIC) —
// Core/carbonateChemistry.ts, не этот файл.
//
// Механизм сборки/слияния — Core/geochemicalSpecies.ts; контракт вида
// — ScientificSpecies (Core/species.ts); вторая система видов не
// создаётся.

import type { GeochemicalSpeciesDefinition } from '../Core/geochemicalSpecies';
import {
  buildSpeciesCatalogFromDefinitions,
  mergeGeochemicalSpeciesIntoCatalog,
  validateGeochemicalSpeciesDefinition as validateDefinition
} from '../Core/geochemicalSpecies';
import type { MergedSpeciesCatalog } from '../Core/geochemicalSpecies';
import type { SpeciesCatalog } from '../Core/species';

// ============================================
// 1. ПРОИСХОЖДЕНИЕ КАТАЛОГА
// ============================================

/**
 * Происхождение самого каталога (сами определения видов, не числовые
 * скорости): формулы и элементные составы — установленная химия;
 * молярные массы — расчёт по стандартным атомным весам IUPAC 2021
 * с собственным per-species provenance (molarMassProvenance каждой записи).
 */
export const GEOCHEMICAL_SPECIES_CATALOG_PROVENANCE = {
  sourceName: 'Геохимический каталог веществ Stage 4.9a.1 + 4.9c (формулы состава — стандартная химия, молярные массы — IUPAC 2021)',
  sourceId: 'evowars/stage-4.9a.1/geochemical-species-catalog',
  retrievedAt: '2026-11-22',
  method: 'кураторский минимальный набор видов углеродного цикла + водные ионы карбонатной системы (Stage 4.9c); фаза закодирована в id (модель «запись = вид + фаза» ядра)',
  applicability: 'аддитивное слияние с производственным каталогом видов (buildSpeciesCatalogFromLegacy + mergeGeochemicalSpeciesIntoCatalog); элементный аудит auditElementConservation; карбонатная химия Core/carbonateChemistry.ts (Stage 4.9c)',
  limitations: 'органический углерод — bookkeeping-компонент (см. ORGANIC_CARBON_NOTE); hplus_aq — учётная модель протона на выбранной шкале pH (см. note записи), а не конкретная сольватная форма; OH-/H3O+ ассоциаты и ионные пары морской воды этим каталогом не представляются',
  note: 'файл содержит данные (определения видов), а не расчётную логику; к Stage 4.9a.1 (co2_aq, caco3, c_org) Stage 4.9c добавил hco3_aq, co3_aq, hplus_aq, oh_aq'
} as const;

/** Общий фрагмент provenance молярных масс (источник атомных весов). */
const IUPAC_ATOMIC_WEIGHTS_2021 = {
  sourceName: 'IUPAC 2021 Технический отчёт: стандартные атомные веса элементов (Isotopic Compositions of the Elements 2021)',
  sourceId: 'iupac-atomic-weights-2021',
  retrievedAt: '2026-11-21',
  method: 'молярная масса = сумма стандартных атомных весов элементов по формуле вещества'
} as const;

// ============================================
// 2. ОПРЕДЕЛЕНИЯ ГЕОХИМИЧЕСКИХ ВИДОВ
// ============================================

/**
 * Органический углерод: честная bookkeeping-семантика.
 *
 * «c_org» — это НЕ универсальная молекула органического вещества:
 * реальная органика имеет переменный состав (типично ~CH2O и
 * вариации), и выдумывать конкретную формулу нельзя. Вместо этого
 * вид определяется как «моли АТОМОВ углерода в органическом пуле»:
 * - элементный состав {C: 1} честен: единица учёта — 1 моль атомов C;
 * - содержание H и O органики в этом виде НЕ представлено: кислород
 *   и водород, входящие в реальную органику, этим видом НЕ
 *   учитываются и НЕ переносятся (ограничение явно указано в note
 *   и limitations provenance — по кислороду и водороду элементный
 *   аудит пула c_org неполон и это отражается обязанностью
 *   вызывающей стороны);
 * - молярная масса численно соответствует атомному весу углерода,
 *   НО перевод пула в кг остаётся заблокированным: масса «моля
 *   органического вещества» не равна 12.011 г без знания его
 *   состава, поэтому molarMassKgMol: null и никакого перевода в кг;
 * - элементный аудит по углероду при этом корректен (формула и состав
 *   подтверждены как учёт атомов C — unknown масса не блокирует
 *   стехиометрический учёт, только перевод в массу).
 */
export const ORGANIC_CARBON_NOTE =
  'bookkeeping-компонент «моли атомов углерода в органическом пуле»: НЕ универсальная молекула органики; состав H и O органического вещества этим видом НЕ представлен (выдуманная формула вроде CH2O не подставляется); переносится/учитывается только углерод — внешние потоки O и H органики должны учитываться отдельно и явно; числовая молярная масса не назначается (масса «моля органики» ≠ атомный вес углерода), перевод в кг заблокирован; элементный аудит корректен только по углероду';

/** Создать molarMassProvenance конкретного вида (тот же источник, свой recordId). */
function iupacMassProvenance(recordId: string, applicability: string) {
  return {
    ...IUPAC_ATOMIC_WEIGHTS_2021,
    recordId,
    applicability
  } as const;
}

/** Справочные молярные массы (кг/моль) — суммы стандартных атомных весов IUPAC 2021. */
const CO2_MOLAR_MASS_KG_MOL = 44.009; // 12.011 + 2 × 15.999
const CACO3_MOLAR_MASS_KG_MOL = 100.086; // 40.078 + 12.011 + 3 × 15.999 (одинакова для кальцита и арагонита — полиморфы)
const CA2_MOLAR_MASS_KG_MOL = 40.078; // 1 × 40.078 (стандартный атомный вес Ca, IUPAC 2021)
const HCO3_MOLAR_MASS_KG_MOL = 61.016; // 1.008 + 12.011 + 3 × 15.999
const CO3_MOLAR_MASS_KG_MOL = 60.008; // 12.011 + 3 × 15.999
const HPLUS_MOLAR_MASS_KG_MOL = 1.008; // 1 × 1.008
const OH_MOLAR_MASS_KG_MOL = 17.007; // 15.999 + 1.008
const H2O_MOLAR_MASS_KG_MOL = 18.015; // 2 × 1.008 + 15.999

/**
 * Геохимические виды Stage 4.9a.1 + водные ионы Stage 4.9c:
 * - co2_aq — растворённый CO2 (водная фаза; газовой формой остаётся
 *   легаси-вид 'co2' из Data/gases.ts — фазы разные, id разные);
 * - caco3 — кальцит/карбонат кальция (твёрдая фаза);
 * - c_org — органический углерод (bookkeeping, см. ORGANIC_CARBON_NOTE);
 * - hco3_aq — ион гидрокарбоната HCO3- (заряд −1, водная фаза, Stage 4.9c);
 * - co3_aq — ион карбоната CO3^2- (заряд −2, водная фаза, Stage 4.9c);
 * - hplus_aq — протон H+ на выбранной шкале pH (заряд +1, водная фаза,
 *   учётная модель протона, Stage 4.9c);
 * - oh_aq — ион гидроксида OH- (заряд −1, водная фаза, Stage 4.9c);
 * - h2o_aq — вода H2O (заряд 0, водная фаза, Stage 4.9c): участник
 *   стехиометрии первой диссоциации CO2 + H2O ⇌ H+ + HCO3- и
 *   автопротолиза H2O ⇌ H+ + OH-; как РАСТВОРИТЕЛЬ (фон ~55.5
 *   mol/kg-SW) её концентрация считается закреплённой и физически
 *   НЕ переносится геохимическими потоками — переносится
 *   стехиометрия в записях ReactionLedger, а не запас растворителя
 *   океана;
 * - ca2_aq — растворённый ион кальция Ca2+ (Stage 4.9f): участник
 *   минеральных реакций карбонатов (не каталог газов);
 * - aragonite — арагонит (Stage 4.9f): полиморф CaCO3, САМОСТОЯТЕЛЬНЫЙ
 *   вид (та же стехиометрия, что у кальцита caco3, но другой id и
 *   другая стехиометрическая Ksp* по Mucci 1983); взаимозамена
 *   полиморфов запрещена.
 */
export const GEOCHEMICAL_SPECIES_DEFINITIONS: readonly GeochemicalSpeciesDefinition[] = [
  {
    id: 'co2_aq',
    formula: 'CO2',
    name: 'Растворённый диоксид углерода (CO2 в водной фазе)',
    elements: { C: 1, O: 2 },
    charge: 0,
    phase: 'aqueous',
    molarMassKgMol: CO2_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'co2_aq_molar_mass',
      'молярная масса молекулы CO2 одинакова для газовой и растворённой форм (фаза не меняет массу молекулы); переводы в кг допустимы'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия CO2 (формула и состав — установленная химия)',
      sourceId: 'evowars/stage-4.9a.1/geochemical-species-catalog',
      recordId: 'co2_aq_definition',
      retrievedAt: '2026-11-21',
      method: 'кураторское определение вида «CO2 в водной фазе» для различения фазовой идентичности (CO2(г) и CO2(aq) — разные записи каталога)',
      applicability: 'геохимические процессы Stage 4.9: растворение/выделение CO2 как РАЗНЫЕ виды',
      limitations: '«растворённый CO2» — физически растворённая молекула; ионные формы HCO3-/CO3^2- добавлены Stage 4.9c ОТДЕЛЬНЫМИ записями (hco3_aq, co3_aq), эта запись их не включает и не замещает'
    },
    note: 'фазовый двойник легаси-газа co2: та же молекула, ДРУГАЯ фаза — перенос co2 → co2_aq есть фазовый переход, а не перенос одного вида'
  },
  {
    id: 'caco3',
    formula: 'CaCO3',
    name: 'Карбонат кальция (кальцит)',
    elements: { Ca: 1, C: 1, O: 3 },
    charge: 0,
    phase: 'solid',
    molarMassKgMol: CACO3_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'caco3_molar_mass',
      'молярная масса формульной единицы CaCO3; минеральные примеси (доломит и др.) этим видом не покрываются'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия CaCO3 (формула и состав — установленная химия)',
      sourceId: 'evowars/stage-4.9a.1/geochemical-species-catalog',
      recordId: 'caco3_definition',
      retrievedAt: '2026-11-21',
      method: 'кураторское определение минерального вида «карбонат кальция» для карбонатных процессов углеродного цикла',
      applicability: 'осаждение карбоната (Stage 4.9), субдукция/метаморфизм карбонатного материала',
      limitations: 'НЕ покрывает CaMg(CO3)2 (доломит) и другие карбонаты; стехиометрия осаждения будет задаваться ReactionLedger'
    },
    note: 'с Stage 4.9f запись означает именно КАЛЬЦИТ: арагонит — ОТДЕЛЬНЫЙ вид aragonite (другая запись каталога, другая растворимость по Mucci 1983); взаимозамена id caco3 и aragonite запрещена'
  },
  {
    id: 'ca2_aq',
    formula: 'Ca',
    name: 'Ион кальция Ca2+ (водная фаза)',
    elements: { Ca: 1 },
    charge: 2,
    phase: 'aqueous',
    molarMassKgMol: CA2_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'ca2_aq_molar_mass',
      'молярная масса иона Ca2+ принята равной стандартному атомному весу Ca (масса электронов пренебрежимо мала относительно атомной); переводы в кг допустимы'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия Ca2+ (формула, состав и заряд — установленная химия)',
      sourceId: 'evowars/stage-4.9f/geochemical-species-catalog',
      recordId: 'ca2_aq_definition',
      retrievedAt: '2026-11-23',
      method: 'кураторское определение растворённого иона кальция для карбонатных минеральных реакций (Stage 4.9f, Core/carbonateMinerals.ts)',
      applicability: 'стехиометрия растворения/осаждения CaCO3(s) ⇌ Ca2+ + CO3^2- и насыщение Ω = [Ca2+]·[CO3^2-]/Ksp* (Mucci 1983, DOI 10.2475/ajs.283.7.780)',
      limitations: 'геохимический aqueous-вид, в каталог газов НЕ входит; концентрация — mol/kg-SW; фон сильных ионов морской воды (Na/Cl/S и др.) этим видом не описывается — компенсация модельного заряда только через StrongIonChargeCompensation Stage 4.9d'
    },
    note: 'участник минеральных реакций карбонатов (Stage 4.9f); равновесная концентрация Ca2+ морской воды решателем 4.9c НЕ вычисляется — приход/уход кальция только через минеральные реакции с ЯВНЫМ extent и provenance'
  },
  {
    id: 'aragonite',
    formula: 'CaCO3',
    name: 'Карбонат кальция (арагонит)',
    elements: { Ca: 1, C: 1, O: 3 },
    charge: 0,
    phase: 'solid',
    molarMassKgMol: CACO3_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'aragonite_molar_mass',
      'молярная масса формульной единицы CaCO3 одинакова для полиморфов (кальцит и арагонит различаются кристаллической решёткой, а не составом); переводы в кг допустимы'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия CaCO3 (формула и состав — установленная химия); различение полиморфов — Mucci (1983)',
      sourceId: 'evowars/stage-4.9f/geochemical-species-catalog',
      recordId: 'aragonite_definition',
      retrievedAt: '2026-11-23',
      method: 'кураторское определение арагонита как САМОСТОЯТЕЛЬНОГО вида (полиморф кальцита): одинаковая стехиометрия {Ca:1, C:1, O:3}, разные видовые записи и разные Ksp* (Mucci 1983, Am. J. Sci. 283:780-799, DOI 10.2475/ajs.283.7.780)',
      applicability: 'растворение/осаждение арагонита как отдельной минеральной фазы (Stage 4.9f, Core/carbonateMinerals.ts)',
      limitations: 'НЕ взаимозаменяем с кальцитом (caco3): id, запасы и реакции полиморфов раздельны; старые запасы caco3 НЕ переквалифицируются в арагонит задним числом; давление-зависимые превращения полиморфов (кальцит ⇌ арагонит) не моделируются'
    },
    note: 'полиморф CaCO3: стехиометрия реакций совпадает с кальцитом (CaCO3(s) ⇌ Ca2+ + CO3^2-), но внутрь реакций подставляется именно aragonite и стехиометрическая Ksp* арагонита — смешение полиморфов в одной реакции запрещено'
  },
  {
    id: 'c_org',
    formula: 'C',
    name: 'Органический углерод (bookkeeping-компонент)',
    elements: { C: 1 },
    charge: 0,
    phase: 'other',
    molarMassKgMol: null,
    molarMassStatus: 'unknown',
    dataStatus: 'estimated',
    provenance: {
      sourceName: 'Bookkeeping-конвенция органического углерода Stage 4.9a.1 (внутреннее соглашение модели)',
      sourceId: 'evowars/stage-4.9a.1/organic-carbon-bookkeeping',
      recordId: 'c_org_definition',
      retrievedAt: '2026-11-21',
      method: 'явная bookkeeping-семантика «моли атомов углерода в органическом пуле» вместо выдуманной формулы органики',
      applicability: 'учёт и перенос углерода органических пулов (захоронение, окисление — Stage 4.9); элементный аудит по углероду',
      limitations: 'состав H и O органического вещества НЕ представлен; числовая молярная масса не назначается и перевод в кг заблокирован; не является реальной молекулой и не может участвовать в стехиометрии как конкретное вещество'
    },
    note: ORGANIC_CARBON_NOTE
  },
  {
    id: 'hco3_aq',
    formula: 'HCO3',
    name: 'Гидрокарбонат-ион HCO3- (водная фаза)',
    elements: { H: 1, C: 1, O: 3 },
    charge: -1,
    phase: 'aqueous',
    molarMassKgMol: HCO3_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'hco3_aq_molar_mass',
      'молярная масса иона HCO3- как сумма атомных весов формульного состава; заряд иона не влияет на массу атомов состава'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия водного карбоната HCO3- (формула, состав и заряд — установленная химия)',
      sourceId: 'evowars/stage-4.9c/geochemical-species-catalog',
      recordId: 'hco3_aq_definition',
      retrievedAt: '2026-11-22',
      method: 'кураторское определение иона гидрокарбоната для карбонатной химии океана (Stage 4.9c, Core/carbonateChemistry.ts)',
      applicability: 'равновесное распределение DIC (CO2(aq)/HCO3-/CO3^2-) — Stage 4.9c; стехиометрия диссоциаций в ReactionLedger',
      limitations: 'ионные пары (NaHCO3^0, CaHCO3+ и т.п.) этой записью не представляются; приведение концентраций вида к mol/kg-SW на общепринятых дозировочных шкалах морской воды (mol/kg-SW) выполняет Stage 4.9c; HCO3- — не «половинка CO2» и не органика: перенос неорганического углерода в этой форме меняет и перенос C, и перенос H'
    },
    note: 'первая ступень диссоциации: CO2(aq) ⇌ H+ + HCO3- (константа K1); заряд −1 обязателен для макроскопического зарядового баланса раствора'
  },
  {
    id: 'co3_aq',
    formula: 'CO3',
    name: 'Карбонат-ион CO3^2- (водная фаза)',
    elements: { C: 1, O: 3 },
    charge: -2,
    phase: 'aqueous',
    molarMassKgMol: CO3_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'co3_aq_molar_mass',
      'молярная масса иона CO3^2- как сумма атомных весов формульного состава; заряд иона не влияет на массу атомов состава'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия водного карбоната CO3^2- (формула, состав и заряд — установленная химия)',
      sourceId: 'evowars/stage-4.9c/geochemical-species-catalog',
      recordId: 'co3_aq_definition',
      retrievedAt: '2026-11-22',
      method: 'кураторское определение иона карбоната для карбонатной химии океана (Stage 4.9c, Core/carbonateChemistry.ts)',
      applicability: 'равновесное распределение DIC (CO2(aq)/HCO3-/CO3^2-) — Stage 4.9c; вклад в карбонатную щёлочность считается с МНОЖИТЕЛЕМ 2 (двойной заряд)',
      limitations: 'ионные пары (NaCO3-, CaCO3^0 и т.п.) этой записью не представляются; стехиометрия осаждения CaCO3 — отдельные определения фактически, не эта запись'
    },
    note: 'вторая ступень диссоциации: HCO3- ⇌ H+ + CO3^2- (константа K2); заряд −2 учитывается в зарядовом балансе и в щёлочности весом 2'
  },
  {
    id: 'hplus_aq',
    formula: 'H',
    name: 'Протон H+ на шкале pH (водная фаза, учётная модель)',
    elements: { H: 1 },
    charge: 1,
    phase: 'aqueous',
    molarMassKgMol: HPLUS_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'hplus_aq_molar_mass',
      'молярная масса атома водорода 1.008 кг/моль по IUPAC 2021; реальная форма протона в воде (сольватация, H3O+) массу атомарного H как единицы учёта не меняет'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия протона/оксониевого равновесия + учётная конвенция шкалы pH Stage 4.9c (внутреннее соглашение модели для семантики величины)',
      sourceId: 'evowars/stage-4.9c/proton-accounting-convention',
      recordId: 'hplus_aq_definition',
      retrievedAt: '2026-11-22',
      method: 'кураторское определение «H+ на выбранной шкале pH» для записи балансов карбонатной системы (pH = -lg(a_H+); в режиме идеального разбавленного раствора активность отождествляется с концентрацией ЯВНО маркированным приближением); dataStatus \'known\' относится к ДАННЫМ состава и заряда (состав {H: 1}, заряд +1 — установленная химия водорода), а не к физической интерпретации величины на шкале pH (учётная конвенция — semantic ограничение ниже)',
      applicability: 'стехиометрия кислотно-основных реакций Stage 4.9c; pH-стехиометрия; НЕ протонные активности за пределами выбранной шкалы',
      limitations: 'НЕ конкретная сольватная форма (H3O+, H9O4+ и т.п.); физическая величина «H+ на шкале pH» определяется выбранной шкалой (free/total/seawater) — шкалы не смешиваются; конкретную семантику величины задаёт Stage 4.9c, а не эта запись'
    },
    note: 'учётная форма: H+ в реакции диссоциации CO2(aq) ⇌ H+ + HCO3- — единица переноса протона кислотно-основного равновесия, а не отдельная растворённая частица с собственной кинетикой'
  },
  {
    id: 'oh_aq',
    formula: 'OH',
    name: 'Гидроксид-ион OH- (водная фаза)',
    elements: { O: 1, H: 1 },
    charge: -1,
    phase: 'aqueous',
    molarMassKgMol: OH_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'oh_aq_molar_mass',
      'молярная масса иона OH- = 15.999 + 1.008 как сумма атомных весов формульного состава'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия гидроксид-иона OH- (формула, состав и заряд — установленная химия)',
      sourceId: 'evowars/stage-4.9c/geochemical-species-catalog',
      recordId: 'oh_aq_definition',
      retrievedAt: '2026-11-22',
      method: 'кураторское определение иона гидроксида для автопротолиза воды и макроскопического зарядового баланса (Stage 4.9c, Kw водного автопротолиза)',
      applicability: 'автопротолиз воды H2O ⇌ H+ + OH- (константа Kw) в charge-balance диагностике Stage 4.9c',
      limitations: 'ионные пары и ассоциаты OH- этой записью не представляются; щелочная ветвь кислотно-основного равновесия НЕ подменяет механическое «удаление лишних H+» из реакций'
    },
    note: 'самоионизация: Kw на шкале SWS — константа автопротолиза; OH- нужен для честного макроскопического зарядового баланса (H+ и OH- присутствуют в растворе одновременно)'
  },
  {
    id: 'h2o_aq',
    formula: 'H2O',
    name: 'Вода H2O (водная фаза, участник стехиометрии)',
    elements: { H: 2, O: 1 },
    charge: 0,
    phase: 'aqueous',
    molarMassKgMol: H2O_MOLAR_MASS_KG_MOL,
    molarMassStatus: 'known',
    molarMassProvenance: iupacMassProvenance(
      'h2o_aq_molar_mass',
      'молярная масса воды = 2 × 1.008 + 15.999 по IUPAC 2021'
    ),
    dataStatus: 'known',
    provenance: {
      sourceName: 'Стандартная химия воды H2O (формула, состав и заряд — установленная химия)',
      sourceId: 'evowars/stage-4.9c/solvent-water',
      recordId: 'h2o_aq_definition',
      retrievedAt: '2026-11-22',
      method: 'участник стехиометрии карбонатной системы: первая диссоциация CO2 + H2O ⇌ H+ + HCO3- и автопротолиз H2O ⇌ H+ + OH- (Stage 4.9c, Core/carbonateChemistry.ts)',
      applicability: 'элементный баланс реакций диссоциации в ReactionLedger; вода как РАСТВОРИТЕЛЬ океана',
      limitations: 'концентрация растворителя (~55.5 mol/kg-SW) считается закреплённой: h2o_aq не переносится геохимическими потоками и не является переменной состояния равновесного расчёта; вода не «входит в DIC»'
    },
    note: 'стехиометрический участник диссоциаций: без H2O реакция CO2 ⇌ H+ + HCO3- не сбалансирована по H и O; запись нужна для auditReactionStoichiometry, а не как переносимый запас'
  }
] as const;

// ============================================
// 3. ВАЛИДАЦИЯ ДАННЫХ КАТАЛОГА
// ============================================

/**
 * Runtime-валидация данных каталога геохимических видов: каждое
 * определение проходит validateGeochemicalSpeciesDefinition, id
 * уникальны. Возвращает список проблем (пустой = данные корректны
 * и могут быть собраны в SpeciesCatalog). Вызывается тестами и может
 * вызываться валидатором сохранений; провалидированные данные не
 * меняются (fail-closed, никаких «достроек»).
 */
export function validateGeochemicalSpeciesDefinitions(): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const def of GEOCHEMICAL_SPECIES_DEFINITIONS) {
    for (const issue of validateDefinition(def)) {
      issues.push(`${def.id ?? '<без id>'}: ${issue}`);
    }
    if (seen.has(def.id)) {
      issues.push(`дубликат вида «${def.id}»: id геохимических веществ должен быть уникальным`);
    }
    seen.add(def.id);
  }
  return issues;
}

// ============================================
// 4. СБОРКА И АДДИТИВНОЕ СЛИЯНИЕ КАТАЛОГОВ
// ============================================

/**
 * Самостоятельный каталог геохимических видов (для тестов и изолированных
 * расчётов геохимии): buildSpeciesCatalogFromDefinitions ядра.
 */
export function buildGeochemicalSpeciesCatalog(): SpeciesCatalog {
  return buildSpeciesCatalogFromDefinitions(GEOCHEMICAL_SPECIES_DEFINITIONS);
}

/**
 * Аддитивное слияние геохимических видов с производственным каталогом:
 * базовый каталог (обычно buildSpeciesCatalogFromLegacy()) не мутируется,
 * конфликты не перезаписывают легаси-виды. Функция возвращает результат
 * слияния с полными проблемами: вызывающая сторона обязана проверить
 * result.issues (непустой список = объединённый каталог неполон, часть
 * видов НЕ добавлена — fail-closed, а не «частично сойдёт»).
 */
export function addGeochemicalSpeciesToCatalog(base: SpeciesCatalog): MergedSpeciesCatalog {
  return mergeGeochemicalSpeciesIntoCatalog(base, GEOCHEMICAL_SPECIES_DEFINITIONS);
}


