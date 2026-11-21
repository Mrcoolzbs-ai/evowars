// ============================================
// GEOCHEMICAL SPECIES CATALOG - геохимические вещества (Stage 4.9a.1)
// ============================================
//
// ДАННЫЕ, НЕ ЛОГИКА (корректирующая ревизия Stage 4.9a.1, проблема A).
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
  sourceName: 'Геохимический каталог веществ Stage 4.9a.1 (формулы состава — стандартная химия, молярные массы — IUPAC 2021)',
  sourceId: 'evowars/stage-4.9a.1/geochemical-species-catalog',
  retrievedAt: '2026-11-21',
  method: 'кураторский минимальный набор видов углеродного цикла; фаза закодирована в id (модель «запись = вид + фаза» ядра)',
  applicability: 'аддитивное слияние с производственным каталогом видов (buildSpeciesCatalogFromLegacy + mergeGeochemicalSpeciesIntoCatalog); элементный аудит auditElementConservation',
  limitations: 'органический углерод — bookkeeping-компонент (см. ORGANIC_CARBON_NOTE); ионные формы (HCO3-, CO3^2-) в этой ревизии не включаются (карбонатная химия — Stage 4.9)',
  note: 'файл содержит данные (определения видов), а не расчётную логику'
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
const CACO3_MOLAR_MASS_KG_MOL = 100.086; // 40.078 + 12.011 + 3 × 15.999

/**
 * Геохимические виды Stage 4.9a.1 (минимальный набор углеродного цикла):
 * - co2_aq — растворённый CO2 (водная фаза; газовой формой остаётся
 *   легаси-вид 'co2' из Data/gases.ts — фазы разные, id разные);
 * - caco3 — кальцит/карбонат кальция (твёрдая фаза);
 * - c_org — органический углерод (bookkeeping, см. ORGANIC_CARBON_NOTE).
 * Ионные формы (HCO3-, CO3^2-) НЕ включаются: карбонатная химия —
 * последующие части Stage 4.9.
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
      limitations: 'НЕ включает ионные формы HCO3-/CO3^2- и карбонатную химию (Stage 4.9); «растворённый CO2» здесь — физически растворённая молекула без гидратации/диссоциации'
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
      'молярная масса формульной единицы CaCO3; минеральные примеси (доломит, арагонит и др.) этим видом не покрываются'
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
    }
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
