// ============================================
// CHEMICAL ELEMENTS - Периодическая таблица: канонический реестр элементов
// ============================================
//
// Контракт Stage 4.3.3 «Periodic Table: 118 Chemical Elements».
//
// Научная иерархия проекта — ТРИ самостоятельных уровня, которые
// не смешиваются:
//   1) ChemicalElement — химический элемент периодической таблицы;
//   2) ScientificSpecies — химический вид: атом, молекула, ион,
//      соединение с определённым зарядом и фазой (species.ts);
//   3) смеси и среды — наборы видов с количественным составом
//      (будущие подэтапы).
//
// Химический элемент НЕ является ScientificSpecies: у элемента нет
// обязательной фазы, он не молекула и не вид. H — элемент; H (атом),
// H2, H+, H2O — виды; атмосфера из H2/N2/CO2 — смесь. Каталог
// элементов — канонический реестр СИМВОЛОВ для ElementCounts видов,
// но сам ничего не знает о видах и их формулах.
//
// Ключевые различения значений (не схлопываются ни в коде, ни
// в документации):
// - стандартный атомный вес (CIAAW 2024) — БЕЗРАЗМЕРНАЯ относительная
//   величина; это НЕ молярная масса (кг/моль, molarMassKgMol вида) и
//   НЕ масса конкретного изотопа;
// - интервальный атомный вес [a, b] НЕ сводится к среднему и не
//   округляется;
// - неопределённость в скобках (нотация CIAAW/NUBASE: стандартная
//   неопределённость последних разрядов, 1 сигма) НЕ отбрасывается;
// - массовое число A — ЦЕЛОЕ число нуклонов; это не относительная
//   атомная масса изотопа и не стандартный атомный вес элемента;
// - отсутствие назначенного стандартного атомного веса (прочерк
//   CIAAW 2024) — отдельный статус not_assigned: не «неизвестное
//   число», не ноль и не подстановка массового числа долгоживущего
//   изотопа;
// - наличие/отсутствие стандартного атомного веса определяется
//   ФАКТИЧЕСКОЙ записью элемента в таблице CIAAW 2024, а НЕ признаком
//   «есть стабильный изотоп»: Bi, Th, Pa, U радиоактивны, но имеют
//   стандартный атомный вес; у Tc, Pm, Po его нет.
//
// Provenance: каждое свойство элемента несёт СОБСТВЕННОЕ
// происхождение (DataProvenance). Запись в целом тоже имеет
// provenance идентификации, но он НЕ подменяет происхождение
// конкретных значений (правило 4.3.2: источник свойства не
// подменяется общим источником).
//
// Детерминизм: каталог строится только из зафиксированных локальных
// данных (Data-модуль); во время работы нет сетевых запросов,
// случайности и времени.

import type { DataProvenance, ScientificValue } from './scientificValue';
import { validateScientificValueShape, validateUncertainty } from './scientificValue';
import { getUnitDefinition, sameDimension, dimension } from './physicalQuantity';

// ============================================
// 1. ТИПЫ КЛАССИФИКАЦИИ
// ============================================

/** Число элементов действующей таблицы IUPAC (выпуск 4 мая 2022). */
export const ELEMENT_COUNT = 118;

/** Блок периодической таблицы. */
export type ElementBlock = 's' | 'p' | 'd' | 'f';

/** Runtime-реестр блоков (данные приходят из JSON — тип не проверяет). */
export const ELEMENT_BLOCKS: readonly ElementBlock[] = ['s', 'p', 'd', 'f'];

/**
 * Категория элемента. Заполняется ТОЛЬКО там, где классификация
 * общепринята или определена IUPAC; спорные случаи остаются
 * unknown с объяснением, а не выбираются молча.
 */
export type ElementCategory =
  | 'alkali_metal'
  | 'alkaline_earth_metal'
  | 'transition_metal'
  | 'post_transition_metal'
  | 'metalloid'
  | 'reactive_nonmetal'
  | 'halogen'
  | 'noble_gas'
  | 'lanthanoid'
  | 'actinoid';

/** Runtime-реестр категорий. */
export const ELEMENT_CATEGORIES: readonly ElementCategory[] = [
  'alkali_metal',
  'alkaline_earth_metal',
  'transition_metal',
  'post_transition_metal',
  'metalloid',
  'reactive_nonmetal',
  'halogen',
  'noble_gas',
  'lanthanoid',
  'actinoid'
];

/**
 * Положение элемента в периодической таблице (IUPAC, выпуск
 * 4 мая 2022). group = null — позиция группы не назначена
 * (f-строки макета: в таблице IUPAC место группы 3 для лантаноидов
 * и актиноидов оставлено диапазоном 57–71/89–103; вопрос группы 3
 * — La/Ac или Lu/Lr — открыт). block = null — блок спорен из-за
 * вопроса группы 3 (La, Lu, Ac, Lr).
 */
export interface ElementPosition {
  /** Группа 1–18; null — не назначена (f-строки, открытый вопрос группы 3). */
  group: number | null;
  /** Обязательное объяснение, когда группа не назначена. */
  groupNotAssignedReason?: string;
  /** Период 1–7. */
  period: number;
  /** Блок s/p/d/f; null — блок спорен (La, Lu, Ac, Lr — вопрос группы 3). */
  block: ElementBlock | null;
  /** Обязательное объяснение, когда блок спорен. */
  blockUnknownReason?: string;
  /** Собственное происхождение ПОЛОЖЕНИЯ (не записи в целом). */
  provenance: DataProvenance;
}

/**
 * Категория как отдельное свойство со статусом: категория может
 * быть неизвестна (сверхтяжёлые элементы, спорные границы), и это
 * не должно портить остальную запись.
 */
export interface ElementCategoryProperty {
  status: 'known' | 'unknown';
  category: ElementCategory | null;
  /** Обязательное объяснение, когда категория неизвестна. */
  unknownReason?: string;
  /** Оговорки классификации (спорные границы, предсказанный характер). */
  notes?: readonly string[];
  /** Собственное происхождение КАТЕГОРИИ. */
  provenance: DataProvenance;
}

// ============================================
// 2. СТАНДАРТНЫЙ АТОМНЫЙ ВЕС (CIAAW 2024)
// ============================================

/**
 * Стандартный атомный вес элемента по CIAAW 2024. Безразмерная
 * относительная величина — НЕ молярная масса и НЕ масса изотопа.
 * Три несводимых друг к другу формы записи таблицы CIAAW:
 * интервал, значение со стандартной неопределённостью в скобках,
 * отсутствие назначенного веса (прочерк).
 */
export type StandardAtomicWeight =
  | {
      kind: 'interval';
      /** Нижняя граница интервала (как в таблице, без округления). */
      lower: number;
      /** Верхняя граница интервала. */
      upper: number;
      /** Исходная нотация CIAAW (например '[1.007 84, 1.008 11]'). */
      rawNotation: string;
      note?: string;
      provenance: DataProvenance;
    }
  | {
      kind: 'value_with_uncertainty';
      /** Центральное значение (как в таблице, без округления). */
      value: number;
      /** Стандартная неопределённость (в скобках CIAAW, 1 сигма). */
      uncertainty: number;
      /** Исходная нотация CIAAW (например '4.002 602(2)'). */
      rawNotation: string;
      note?: string;
      provenance: DataProvenance;
    }
  | {
      /** CIAAW 2024 ставит прочерк: стандартный атомный вес не назначен. */
      kind: 'not_assigned';
      /** Объяснение (почему не назначен, чем является, чем НЕ является). */
      reason: string;
      provenance: DataProvenance;
    };

// ============================================
// 3. ИЗОТОПНЫЙ СОСТАВ (CIAAW 2024)
// ============================================

/**
 * Долевая изотопная распространённость одной изотопной строки
 * таблицы CIAAW «Isotopic Compositions of the Elements 2024».
 * Интервалы не пересчитываются, неопределённость сохраняется.
 */
export type IsotopeAbundance =
  | {
      kind: 'interval';
      lower: number;
      upper: number;
      rawNotation: string;
      provenance: DataProvenance;
    }
  | {
      kind: 'value';
      value: number;
      /** Стандартная неопределённость (в скобках); null — не опубликована. */
      uncertainty: number | null;
      rawNotation: string;
      provenance: DataProvenance;
    };

/** Одна изотопная строка таблицы CIAAW (массовое число + распространённость). */
export interface IsotopeRecord {
  /** Массовое число A — целое число нуклонов (НЕ атомная масса). */
  massNumber: number;
  abundance: IsotopeAbundance;
}

/**
 * Изотопный состав элемента. known — представительские распространённости
 * CIAAW 2024; not_applicable — у элемента нет стандартного атомного веса
 * и таблица CIAAW не назначает состав (строка с массовым числом в скобках
 * или отсутствие строки); unknown — данные не получены.
 */
export interface ElementIsotopicComposition {
  status: 'known' | 'not_applicable' | 'unknown';
  reason?: string;
  note?: string;
  provenance?: DataProvenance;
  /** Записи распространённостей; обязателен непустой список при known. */
  records?: readonly IsotopeRecord[];
}

// ============================================
// 4. РЕПРЕЗЕНТАТИВНЫЕ ИЗОТОПЫ-КАНДИДАТЫ (NUBASE2020 ЧЕРЕЗ CIAAW)
// ============================================

/**
 * Состояние нуклида: основное или изомерное. Кандидатами могут быть
 * только эти два вида; ядерные уровни, резонансы и IAS (изоаналоговые
 * состояния) по правилу отбора кандидатами не являются.
 */
export type NuclideStateKind = 'ground' | 'isomeric';

/**
 * Буквенный код состояния s из NUBASE2020: '' — основное состояние;
 * m, n, p, q, r, x — изомерные состояния (у одного нуклида их может
 * быть несколько: s=m,n — обычные изомеры, s=p,q,r,x — дополнительные
 * при более чем двух изомерных состояниях); i, j — изоаналоговые
 * состояния (IAS), кандидатами не являются.
 */
export type NuclideStateCode = '' | 'm' | 'n' | 'p' | 'q' | 'r' | 'x' | 'i' | 'j';

/**
 * Согласованность индекса состояния i и буквенного кода s NUBASE2020
 * (шапка официального файла): 0↔'', 1↔m, 2↔n, 3↔p, 4↔q, 5↔r, 6↔x,
 * 8↔i, 9↔j. Пара (i, s) идентифицирует КОНКРЕТНУЮ строку источника.
 */
export const NUBASE_STATE_CODE_BY_INDEX: Readonly<Record<number, NuclideStateCode>> = {
  0: '',
  1: 'm',
  2: 'n',
  3: 'p',
  4: 'q',
  5: 'r',
  6: 'x',
  8: 'i',
  9: 'j'
};

/** Статус ядерных данных: экспериментальные или оценочные (экстраполяция NUBASE). */
export type NuclideDataStatus = 'experimental' | 'estimated';

/**
 * Один кандидат в наиболее долгоживущие известные нуклиды элемента.
 * Массовое число — целое число нуклонов; период полураспада —
 * научное значение с единицей времени и неопределённостью.
 */
export interface NuclideCandidate {
  /** Атомный номер; обязан совпадать с элементом-владельцем. */
  atomicNumber: number;
  /** Массовое число A (целое, положительное). */
  massNumber: number;
  /** Обозначение нуклида (например 'Tc-97'). */
  nuclideNotation: string;
  /** Основное или изомерное состояние. */
  state: NuclideStateKind;
  /**
   * Индекс состояния i из NUBASE2020: 0 — основное состояние,
   * 1–6 — возбуждённые строки (изомеры либо уровни/резонансы),
   * 8/9 — IAS. Вместе с stateCode идентифицирует КОНКРЕТНУЮ строку
   * источника: у одного (Z, A) может быть несколько различных
   * изомерных состояний (аудит R2).
   */
  stateIndex: number;
  /** Буквенный код состояния s из NUBASE2020 ('' у основного состояния). */
  stateCode: NuclideStateCode;
  stateNote?: string;
  /** Идентификатор строки источника. */
  recordId: string;
  /** Период полураспада (known/estimated, единица времени, 1 сигма). */
  halfLife: ScientificValue;
  /** Исходная нотация (например '4.21(16) Ma'). */
  halfLifeRawNotation: string;
  /** Режим распада — если источник публикует; НЕ выдумывается. */
  decayMode?: string;
  /** Экспериментальные данные ≠ оценочные (NUBASE различает их). */
  dataStatus: NuclideDataStatus;
  /** Почему нуклид включён в список кандидатов. */
  reason: string;
  provenance: DataProvenance;
}

/**
 * Полнота отбора кандидатов. incomplete — известные сегодня нуклиды
 * не доказывают абсолютный максимум (сверхтяжёлые элементы);
 * not_verifiable — набор данных не позволяет оценить полноту.
 */
export type CandidateCompleteness = 'complete' | 'incomplete' | 'not_verifiable';

export const CANDIDATE_COMPLETENESS: readonly CandidateCompleteness[] = [
  'complete',
  'incomplete',
  'not_verifiable'
];

/**
 * Репрезентативные изотопы-кандидаты элемента. НЕ одно обязательное
 * поле representativeMassNumber, а СПИСОК равноправных кандидатов:
 * при перекрывающихся опубликованных 1σ-интервалах периодов
 * полураспада победитель не выбирается (перекрытие интервалов не
 * доказывает статистической эквивалентности значений). Для элементов со стандартным атомным весом —
 * not_applicable (кандидаты не требуются).
 */
export interface RepresentativeIsotopeCandidates {
  status: 'known' | 'not_applicable';
  /** Обязательное объяснение при not_applicable. */
  notApplicableReason?: string;
  /** Полнота отбора (обязательна при known). */
  completeness?: CandidateCompleteness;
  /** Обязательное пояснение полноты при known. */
  completenessNote?: string;
  /** Кандидаты; непустой список при known. */
  candidates?: readonly NuclideCandidate[];
  provenance?: DataProvenance;
}

// ============================================
// 5. СТРОКОВЫЕ СВОЙСТВА И ЗАПИСЬ ЭЛЕМЕНТА
// ============================================

/**
 * Строковое свойство элемента (электронная конфигурация, степени
 * окисления): known с собственным provenance или unknown с причиной.
 */
export interface ElementStringProperty {
  status: 'known' | 'unknown';
  value?: string;
  unknownReason?: string;
  provenance?: DataProvenance;
}

/**
 * ChemicalElement — самостоятельная запись каталога. Атомный номер
 * и символ — обязательные уникальные стабильные идентификаторы;
 * названия НЕ первичный ключ.
 */
export interface ChemicalElement {
  atomicNumber: number;
  symbol: string;
  nameEnglish: string;
  /** Собственное происхождение английского названия (IUPAC). */
  nameEnglishProvenance: DataProvenance;
  nameRussian: string;
  /**
   * Собственное происхождение русского названия. Перевод IUPAC
   * НЕ приписывается: заполняется редакционным происхождением
   * по общепринятой русской химической номенклатуре.
   */
  nameRussianProvenance: DataProvenance;
  position: ElementPosition;
  category: ElementCategoryProperty;
  standardAtomicWeight: StandardAtomicWeight;
  isotopicComposition: ElementIsotopicComposition;
  representativeIsotopeCandidates: RepresentativeIsotopeCandidates;
  electronConfiguration: ElementStringProperty;
  /** Первая энергия ионизации нейтрального атома, eV. */
  firstIonizationEnergy: ScientificValue;
  // Слоты дальнейших атомных свойств (Stage 4.3.3 не заполняет:
  // источник с подтверждённой лицензией не подключён — см.
  // elementDataAttribution.md; unknown ≠ ноль).
  electronAffinity: ScientificValue;
  electronegativity: ScientificValue;
  atomicRadius: ScientificValue;
  meltingPoint: ScientificValue;
  boilingPoint: ScientificValue;
  density: ScientificValue;
  oxidationStates: ElementStringProperty;
  /** Происхождение записи (идентификация) — не подменяет per-property. */
  provenance: DataProvenance;
}

// ============================================
// 6. ОШИБКА И ВСПОМОГАТЕЛЬНЫЕ ПРОВЕРКИ
// ============================================

/** Коды ошибок каталога элементов. */
export type ElementErrorCode = 'invalid_element' | 'duplicate_element' | 'unknown_element';

export class ElementError extends Error {
  readonly code: ElementErrorCode;
  readonly component = 'ChemicalElement';
  readonly subject: string;

  constructor(code: ElementErrorCode, message: string, subject: string) {
    super(`[ChemicalElement] ${message}`);
    this.name = 'ElementError';
    this.code = code;
    this.subject = subject;
  }
}

function isNonNullObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Источник идентифицирован, если provenance называет источник
 * (sourceName/sourceId/datasetId/reference). Правило 4.3.2:
 * числовые known/estimated значения без идентифицированного
 * источника — диагностическая ошибка.
 */
export function provenanceIdentifiesSource(provenance: unknown): boolean {
  if (!isNonNullObject(provenance)) return false;
  return (
    (typeof provenance.sourceName === 'string' && provenance.sourceName.trim() !== '') ||
    (typeof provenance.sourceId === 'string' && provenance.sourceId.trim() !== '') ||
    (typeof provenance.datasetId === 'string' && provenance.datasetId.trim() !== '') ||
    (typeof provenance.reference === 'string' && provenance.reference.trim() !== '')
  );
}

/** Непустая строка. */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

// ============================================
// 7. ВАЛИДАТОР ЗАПИСИ
// ============================================

/** Размерность времени (секунда): период полураспада обязан иметь её. */
const TIME_DIMENSION = dimension(0, 0, 1);

/**
 * Проверка ФОРМЫ записи элемента произвольного происхождения
 * (данные могут приходить из JSON). Возвращает список проблем;
 * пустой список = запись корректна. Проверяет структурный контракт:
 * уникальность atomic number и symbol проверяет КАТАЛОГ при
 * регистрации (валидатор отдельной записи их видеть не может).
 */
export function validateChemicalElement(element: unknown): string[] {
  const errors: string[] = [];
  if (!isNonNullObject(element)) {
    return ['запись элемента должна быть объектом'];
  }
  const el = element;
  const where = (topic: string): string =>
    `Z=${String(el.atomicNumber)} (${String(el.symbol)}): ${topic}`;

  // --- Идентификация ---
  if (typeof el.atomicNumber !== 'number' || !Number.isInteger(el.atomicNumber) || el.atomicNumber < 1 || el.atomicNumber > ELEMENT_COUNT) {
    errors.push(where(`атомный номер должен быть целым числом 1…${ELEMENT_COUNT}, получено ${String(el.atomicNumber)}`));
  }
  if (typeof el.symbol !== 'string' || !/^[A-Z][a-z]?$/.test(el.symbol)) {
    errors.push(where(`символ должен быть официальной записью IUPAC (прописная + строчная буква), получено «${String(el.symbol)}»`));
  }
  if (!isNonEmptyString(el.nameEnglish)) {
    errors.push(where('английское название не может быть пустым'));
  }
  if (!isNonEmptyString(el.nameRussian)) {
    errors.push(where('русское название не может быть пустым (или должно иметь документированное исключение — но в каталоге исключений нет)'));
  }
  if (!provenanceIdentifiesSource(el.nameEnglishProvenance)) {
    errors.push(where('происхождение английского названия должно идентифицировать источник (IUPAC)'));
  }
  if (!provenanceIdentifiesSource(el.nameRussianProvenance)) {
    errors.push(where('происхождение русского названия должно идентифицировать источник (редакционная номенклатура — НЕ перевод IUPAC)'));
  }
  if (!provenanceIdentifiesSource(el.provenance)) {
    errors.push(where('provenance записи (идентификация) должен идентифицировать источник'));
  }

  // --- Положение ---
  if (!isNonNullObject(el.position)) {
    errors.push(where('position должен быть объектом ElementPosition'));
  } else {
    const pos = el.position;
    if (typeof pos.period !== 'number' || !Number.isInteger(pos.period) || pos.period < 1 || pos.period > 7) {
      errors.push(where(`период должен быть целым числом 1…7, получено ${String(pos.period)}`));
    }
    if (pos.group !== null) {
      if (typeof pos.group !== 'number' || !Number.isInteger(pos.group) || pos.group < 1 || pos.group > 18) {
        errors.push(where(`группа должна быть целым числом 1…18 или null (не назначена), получено ${String(pos.group)}`));
      }
    } else if (!isNonEmptyString(pos.groupNotAssignedReason)) {
      errors.push(where('group = null требует объяснения groupNotAssignedReason (вопрос группы 3 IUPAC)'));
    }
    if (pos.block !== null) {
      if (typeof pos.block !== 'string' || !(ELEMENT_BLOCKS as readonly string[]).includes(pos.block)) {
        errors.push(where(`блок должен быть s/p/d/f или null (спорен), получено «${String(pos.block)}»`));
      }
    } else if (!isNonEmptyString(pos.blockUnknownReason)) {
      errors.push(where('block = null требует объяснения blockUnknownReason (вопрос группы 3 IUPAC)'));
    }
    if (!provenanceIdentifiesSource(pos.provenance)) {
      errors.push(where('происхождение положения должно идентифицировать источник (таблица IUPAC 4 мая 2022)'));
    }
  }

  // --- Категория ---
  if (!isNonNullObject(el.category)) {
    errors.push(where('category должен быть объектом ElementCategoryProperty'));
  } else {
    const cat = el.category;
    if (cat.status === 'known') {
      if (typeof cat.category !== 'string' || !(ELEMENT_CATEGORIES as readonly string[]).includes(cat.category)) {
        errors.push(where(`неизвестная категория: ${String(cat.category)}`));
      }
    } else if (cat.status === 'unknown') {
      if (!isNonEmptyString(cat.unknownReason)) {
        errors.push(where('категория unknown требует объяснения unknownReason'));
      }
    } else {
      errors.push(where(`статус категории должен быть known/unknown, получено ${String(cat.status)}`));
    }
    if (!provenanceIdentifiesSource(cat.provenance)) {
      errors.push(where('происхождение категории должно идентифицировать источник'));
    }
    if (cat.notes !== undefined) {
      if (!Array.isArray(cat.notes)) {
        errors.push(where('category.notes должен быть массивом строк-оговорок'));
      } else {
        for (const note of cat.notes) {
          if (!isNonEmptyString(note)) {
            errors.push(where('оговорки категории должны быть непустыми строками'));
          }
        }
      }
    }
  }

  // --- Стандартный атомный вес ---
  if (!isNonNullObject(el.standardAtomicWeight)) {
    errors.push(where('standardAtomicWeight должен быть заполнен (not_assigned — тоже запись)'));
  } else {
    const w = el.standardAtomicWeight;
    if (w.kind === 'interval') {
      if (typeof w.lower !== 'number' || !Number.isFinite(w.lower) || typeof w.upper !== 'number' || !Number.isFinite(w.upper)) {
        errors.push(where('границы интервального атомного веса должны быть конечными числами'));
      } else if (w.lower >= w.upper) {
        errors.push(where(`нижняя граница интервала должна быть меньше верхней, получено [${String(w.lower)}, ${String(w.upper)}]`));
      } else if (w.lower <= 0 || w.upper <= 0) {
        errors.push(where(`границы интервального атомного веса должны быть строго положительными, получено [${String(w.lower)}, ${String(w.upper)}]`));
      }
      if (!isNonEmptyString(w.rawNotation)) {
        errors.push(where('интервальный атомный вес обязан сохранять исходную нотацию CIAAW (rawNotation)'));
      }
    } else if (w.kind === 'value_with_uncertainty') {
      if (typeof w.value !== 'number' || !Number.isFinite(w.value)) {
        errors.push(where('центральное значение атомного веса должно быть конечным числом'));
      } else if (w.value <= 0) {
        errors.push(where(`стандартный атомный вес должен быть строго положительным, получено ${String(w.value)}`));
      }
      if (typeof w.uncertainty !== 'number' || !Number.isFinite(w.uncertainty) || w.uncertainty < 0) {
        errors.push(where(`стандартная неопределённость должна быть конечным неотрицательным числом, получено ${String(w.uncertainty)}`));
      }
      if (!isNonEmptyString(w.rawNotation)) {
        errors.push(where('атомный вес со скобочной неопределённостью обязан сохранять исходную нотацию CIAAW (rawNotation)'));
      }
    } else if (w.kind === 'not_assigned') {
      if (!isNonEmptyString(w.reason)) {
        errors.push(where('отсутствие стандартного атомного веса требует объяснения reason (не ноль, не подстановка массового числа)'));
      }
      const wNotAssigned = w as Record<string, unknown>;
      if ('value' in wNotAssigned || 'lower' in wNotAssigned || 'upper' in wNotAssigned) {
        errors.push(where('not_assigned (прочерк CIAAW) не должен содержать числовых полей value/lower/upper: отсутствие веса НЕ превращается в число или подстановку'));
      }
    } else {
      errors.push(where(`неизвестная форма стандартного атомного веса: ${String(w.kind)}`));
    }
    if (!provenanceIdentifiesSource(w.provenance)) {
      errors.push(where('происхождение стандартного атомного веса должно идентифицировать источник (CIAAW 2024)'));
    }
  }

  // --- Изотопный состав ---
  if (!isNonNullObject(el.isotopicComposition)) {
    errors.push(where('isotopicComposition должен быть объектом'));
  } else {
    const ic = el.isotopicComposition;
    if (ic.status === 'known') {
      if (!Array.isArray(ic.records) || ic.records.length === 0) {
        errors.push(where('изотопный состав known требует непустого списка записей'));
      } else {
        const seenIsotopeMassNumbers = new Set<number>();
        for (const rec of ic.records) {
          if (!isNonNullObject(rec)) {
            errors.push(where('изотопная запись должна быть объектом'));
            continue;
          }
          if (typeof rec.massNumber !== 'number' || !Number.isInteger(rec.massNumber) || rec.massNumber < 1) {
            errors.push(where(`массовое число должно быть целым положительным (число нуклонов), получено ${String(rec.massNumber)}`));
          } else if (typeof el.atomicNumber === 'number' && Number.isInteger(el.atomicNumber) && rec.massNumber < el.atomicNumber) {
            errors.push(where(`массовое число изотопной записи A=${String(rec.massNumber)} не может быть меньше атомного номера Z=${String(el.atomicNumber)}`));
          }
          if (typeof rec.massNumber === 'number' && Number.isInteger(rec.massNumber)) {
            if (seenIsotopeMassNumbers.has(rec.massNumber)) {
              errors.push(where(`повторяющееся массовое число в изотопном составе: ${String(rec.massNumber)}`));
            } else {
              seenIsotopeMassNumbers.add(rec.massNumber);
            }
          }
          const ab = rec.abundance;
          if (!isNonNullObject(ab)) {
            errors.push(where('изотопная запись требует abundance'));
            continue;
          }
          if (ab.kind === 'interval') {
            const abLower = ab.lower;
            const abUpper = ab.upper;
            if (typeof abLower !== 'number' || !Number.isFinite(abLower) || typeof abUpper !== 'number' || !Number.isFinite(abUpper)) {
              errors.push(where('границы интервала распространённости должны быть конечными числами'));
            } else {
              if (abLower > abUpper) {
                errors.push(where(`нижняя граница распространённости больше верхней: [${String(abLower)}, ${String(abUpper)}]`));
              }
              if (abLower < 0 || abUpper > 1) {
                errors.push(where(`долевая распространённость должна быть в [0, 1], получено [${String(abLower)}, ${String(abUpper)}]`));
              }
            }
          } else if (ab.kind === 'value') {
            if (typeof ab.value !== 'number' || !Number.isFinite(ab.value) || ab.value < 0 || ab.value > 1) {
              errors.push(where(`долевая распространённость должна быть числом в [0, 1], получено ${String(ab.value)}`));
            }
            if (ab.uncertainty != null && (typeof ab.uncertainty !== 'number' || !Number.isFinite(ab.uncertainty) || ab.uncertainty < 0)) {
              errors.push(where(`неопределённость распространённости должна быть неотрицательным числом или null, получено ${String(ab.uncertainty)}`));
            }
          } else {
            errors.push(where(`неизвестная форма распространённости: ${String(ab.kind)}`));
          }
          if (isNonNullObject(ab) && !isNonEmptyString(ab.rawNotation)) {
            errors.push(where('изотопная запись обязана сохранять исходную нотацию CIAAW (rawNotation)'));
          }
          if (isNonNullObject(ab) && !provenanceIdentifiesSource(ab.provenance)) {
            errors.push(where('изотопная запись должна идентифицировать источник (таблица CIAAW 2024)'));
          }
          if (isNonNullObject(ab)) {
            const abRec = ab.provenance as Record<string, unknown> | undefined;
            if (!isNonNullObject(abRec) || typeof abRec.recordId !== 'string' || abRec.recordId.trim() === '') {
              errors.push(where('изотопная запись должна ссылаться на строку источника: recordId — непустая строка (дисциплина 4.3.2)'));
            }
          }
        }
      }
    } else if (ic.status === 'not_applicable' || ic.status === 'unknown') {
      if (!isNonEmptyString(ic.reason)) {
        errors.push(where(`изотопный состав ${String(ic.status)} требует объяснения reason`));
      }
    } else {
      errors.push(where(`неизвестный статус изотопного состава: ${String(ic.status)}`));
    }
  }

  // --- Кандидаты ---
  if (!isNonNullObject(el.representativeIsotopeCandidates)) {
    errors.push(where('representativeIsotopeCandidates должен быть объектом'));
  } else {
    const cand = el.representativeIsotopeCandidates;
    if (cand.status === 'known') {
      if (typeof cand.completeness !== 'string' || !(CANDIDATE_COMPLETENESS as readonly string[]).includes(cand.completeness)) {
        errors.push(where(`полнота отбора должна быть complete/incomplete/not_verifiable, получено ${String(cand.completeness)}`));
      }
      if (!isNonEmptyString(cand.completenessNote)) {
        errors.push(where('known-кандидаты требуют пояснения полноты completenessNote'));
      }
      if (!Array.isArray(cand.candidates) || cand.candidates.length === 0) {
        errors.push(where('known-кандидаты требуют непустого списка нуклидов'));
      } else {
        const seenCandidateKeys = new Set<string>();
        for (const c of cand.candidates) {
          if (!isNonNullObject(c)) {
            errors.push(where('кандидат должен быть объектом'));
            continue;
          }
          const label = String(c.nuclideNotation ?? '?');
          if (typeof c.atomicNumber !== 'number' || c.atomicNumber !== el.atomicNumber) {
            errors.push(where(`кандидат ${label}: атомный номер кандидата (${String(c.atomicNumber)}) обязан совпадать с элементом-владельцем`));
          }
          if (typeof c.massNumber !== 'number' || !Number.isInteger(c.massNumber) || c.massNumber < 1) {
            errors.push(where(`кандидат ${label}: массовое число должно быть целым положительным, получено ${String(c.massNumber)}`));
          } else if (typeof c.massNumber === 'number' && typeof el.atomicNumber === 'number' && Number.isInteger(el.atomicNumber) && c.massNumber < el.atomicNumber) {
            errors.push(where(`кандидат ${label}: массовое число A=${String(c.massNumber)} не может быть меньше атомного номера Z=${String(el.atomicNumber)} элемента-владельца`));
          }
          if (!isNonEmptyString(c.nuclideNotation)) {
            errors.push(where(`кандидат ${label}: обозначение нуклида не может быть пустым`));
          }
          if (c.state !== 'ground' && c.state !== 'isomeric') {
            errors.push(where(`кандидат ${label}: состояние должно быть ground/isomeric, получено ${String(c.state)}`));
          }
          // Точное состояние NUBASE2020: индекс i и буквенный код s
          // согласованы между собой и с видом состояния (аудит R2).
          const stateIndexOk = typeof c.stateIndex === 'number' && Number.isInteger(c.stateIndex) && c.stateIndex >= 0 && c.stateIndex <= 9;
          if (!stateIndexOk) {
            errors.push(where(`кандидат ${label}: индекс состояния NUBASE2020 (stateIndex) должен быть целым числом 0…9, получено ${String(c.stateIndex)}`));
          }
          const stateCodeOk = typeof c.stateCode === 'string' && (Object.values(NUBASE_STATE_CODE_BY_INDEX) as readonly string[]).includes(c.stateCode);
          if (!stateCodeOk) {
            errors.push(where(`кандидат ${label}: буквенный код состояния NUBASE2020 (stateCode) должен быть одним из ''/m/n/p/q/r/x/i/j, получено ${String(c.stateCode)}`));
          }
          if (stateIndexOk && stateCodeOk && NUBASE_STATE_CODE_BY_INDEX[c.stateIndex as number] !== c.stateCode) {
            errors.push(where(`кандидат ${label}: индекс состояния i=${String(c.stateIndex)} и буквенный код s=${String(c.stateCode) === '' ? '(пусто)' : String(c.stateCode)} не согласованы (NUBASE2020: 0↔'', 1↔m, 2↔n, 3↔p, 4↔q, 5↔r, 6↔x, 8↔i, 9↔j)`));
          }
          if (stateIndexOk && c.state === 'ground' && c.stateIndex !== 0) {
            errors.push(where(`кандидат ${label}: основное состояние — это строка i=0 NUBASE2020, получен i=${String(c.stateIndex)}`));
          }
          if (stateIndexOk && c.state === 'isomeric' && (c.stateIndex === 0 || c.stateCode === 'i' || c.stateCode === 'j')) {
            errors.push(where(`кандидат ${label}: изомерное состояние — возбуждённая строка NUBASE2020 (i>=1, s=m/n/p/q/r/x), а не основная (i=0) и не IAS (s=i/j)`));
          }
          // Согласованность обозначения нуклида с элементом-владельцем:
          // символ владельца, массовое число и суффикс состояния —
          // буквенный код s NUBASE2020 (аудиты R1, R2).
          const ownerSymbolOk = typeof el.symbol === 'string' && /^[A-Z][a-z]?$/.test(el.symbol);
          const candMassOk = typeof c.massNumber === 'number' && Number.isInteger(c.massNumber) && c.massNumber >= 1;
          const candStateOk = c.state === 'ground' || c.state === 'isomeric';
          if (ownerSymbolOk && candMassOk && candStateOk && stateCodeOk && isNonEmptyString(c.nuclideNotation)) {
            const notation = c.nuclideNotation;
            const prefix = `${el.symbol as string}-`;
            if (!notation.startsWith(prefix)) {
              errors.push(where(`кандидат ${label}: обозначение нуклида обязано начинаться с символа элемента-владельца «${prefix}…», получено «${notation}»`));
            } else {
              const rest = notation.slice(prefix.length);
              // Суффикс обозначения — буквенный код состояния s NUBASE2020:
              // основное состояние (i=0) — без суффикса, изомер — с кодом
              // своей строки (m, n, p, q, ...): несколько изомеров одного A
              // различаются суффиксами (аудит R2).
              const expected = c.state === 'isomeric' ? `${c.massNumber}${String(c.stateCode)}` : String(c.massNumber);
              if (rest !== expected) {
                errors.push(where(`кандидат ${label}: ${c.state === 'isomeric' ? 'изомерное' : 'основное'} состояние требует обозначение «${prefix}${expected}»${c.state === 'isomeric' ? ' с суффиксом кода состояния NUBASE2020' : ' без суффикса изомера'}, получено «${notation}»`));
              }
            }
          }
          // Уникальность записи — по КОНКРЕТНОЙ строке источника NUBASE2020
          // (массовое число A + индекс состояния i + буквенный код s), а не
          // только по паре (A, состояние): несколько РАЗЛИЧНЫХ изомерных
          // состояний одного A легитимны и не являются дубликатом (аудит R2).
          if (typeof c.massNumber === 'number' && (c.state === 'ground' || c.state === 'isomeric')) {
            const dupKey = `${String(c.massNumber)}:i=${String(c.stateIndex)}:s=${String(c.stateCode)}`;
            if (seenCandidateKeys.has(dupKey)) {
              errors.push(where(`кандидат ${label}: дубликат записи-кандидата (строка источника NUBASE2020: A=${String(c.massNumber)}, i=${String(c.stateIndex)}, s=${String(c.stateCode)}): одна и та же строка источника не должна дублироваться`));
            } else {
              seenCandidateKeys.add(dupKey);
            }
          }
          if (c.dataStatus !== 'experimental' && c.dataStatus !== 'estimated') {
            errors.push(where(`кандидат ${label}: статус данных должен быть experimental/estimated, получено ${String(c.dataStatus)}`));
          }
          if (!isNonEmptyString(c.recordId)) {
            errors.push(where(`кандидат ${label}: recordId источника обязателен (дисциплина 4.3.2)`));
          }
          const candProv = isNonNullObject(c.provenance) ? (c.provenance as Record<string, unknown>) : undefined;
          const candProvRecordId = candProv?.recordId;
          if (typeof candProvRecordId !== 'string' || candProvRecordId.trim() === '') {
            errors.push(where(`кандидат ${label}: provenance.recordId обязателен — идентификатор строки источника не противоречит собственному происхождению (дисциплина 4.3.2)`));
          } else if (isNonEmptyString(c.recordId) && candProvRecordId !== c.recordId) {
            errors.push(where(`кандидат ${label}: recordId (${String(c.recordId)}) обязан совпадать с provenance.recordId (${String(candProvRecordId)}): идентификатор строки источника не должен противоречить собственному происхождению`));
          }
          if (!isNonEmptyString(c.halfLifeRawNotation)) {
            errors.push(where(`кандидат ${label}: исходная нотация периода полураспада обязательна`));
          }
          if (!isNonEmptyString(c.reason)) {
            errors.push(where(`кандидат ${label}: причина включения в список обязательна`));
          }
          if (!provenanceIdentifiesSource(c.provenance)) {
            errors.push(where(`кандидат ${label}: происхождение должно идентифицировать источник`));
          }
          const halfLifeIssues = validateScientificValueShape(c.halfLife);
          for (const issue of halfLifeIssues) {
            errors.push(where(`кандидат ${label}: период полураспада: ${issue}`));
          }
          if (isNonNullObject(c.halfLife) && (c.halfLife.status === 'known' || c.halfLife.status === 'estimated')) {
            const q = (c.halfLife as Record<string, unknown>).quantity as Record<string, unknown> | undefined;
            if (!isNonNullObject(q) || typeof q.unit !== 'string' || getUnitDefinition(q.unit) === null) {
              errors.push(where(`кандидат ${label}: период полураспада требует зарегистрированную единицу времени`));
            } else {
              // Размерность единицы — именно время (сравнение с размерностью
              // секунды через реестр physicalQuantity), а не просто наличие
              // единицы в реестре: eV, kg и K тоже зарегистрированы (аудит R1).
              const unitDef = getUnitDefinition(q.unit);
              if (unitDef === null || !sameDimension(unitDef.dimension, TIME_DIMENSION)) {
                errors.push(where(`кандидат ${label}: единица периода полураспада («${String(q.unit)}») должна иметь размерность времени`));
              }
            }
            // Значение конечно и строго положительно: нулевой и
            // отрицательный период полураспада физически невозможны (аудит R1).
            if (isNonNullObject(q) && (typeof q.value !== 'number' || !Number.isFinite(q.value) || q.value <= 0)) {
              errors.push(where(`кандидат ${label}: период полураспада должен быть конечным строго положительным числом, получено ${String(q.value)}`));
            }
            // Неопределённость, если присутствует, проходит собственную проверку.
            const hlUncertainty = (c.halfLife as Record<string, unknown>).uncertainty;
            if (hlUncertainty !== undefined && hlUncertainty !== null) {
              if (!isNonNullObject(hlUncertainty)) {
                errors.push(where(`кандидат ${label}: неопределённость периода полураспада должна быть объектом`));
              } else {
                for (const issue of validateUncertainty(hlUncertainty as Parameters<typeof validateUncertainty>[0])) {
                  errors.push(where(`кандидат ${label}: неопределённость периода полураспада: ${issue}`));
                }
              }
            }
            if (c.halfLife.status === 'estimated' && !isNonEmptyString((c.halfLife as Record<string, unknown>).method)) {
              errors.push(where(`кандидат ${label}: estimated-период полураспада требует непустой метод оценки`));
            }
            if (!provenanceIdentifiesSource((c.halfLife as Record<string, unknown>).provenance)) {
              errors.push(where(`кандидат ${label}: числовой период полураспада требует provenance с идентификацией источника`));
            }
            // (аудит R2) Значение периода полураспада и запись кандидата —
            // ОДНА строка источника NUBASE2020: provenance.recordId значения
            // обязан совпадать с recordId записи кандидата.
            const hlProv = (c.halfLife as Record<string, unknown>).provenance as Record<string, unknown> | undefined;
            const hlRecordId = isNonNullObject(hlProv) ? hlProv.recordId : undefined;
            if (typeof hlRecordId !== 'string' || hlRecordId.trim() === '') {
              errors.push(where(`кандидат ${label}: provenance.recordId периода полураспада обязателен — значение обязано идентифицировать ту же строку источника, что и запись кандидата`));
            } else if (isNonEmptyString(c.recordId) && hlRecordId !== c.recordId) {
              errors.push(where(`кандидат ${label}: provenance.recordId периода полураспада (${String(hlRecordId)}) обязан совпадать с recordId записи кандидата (${String(c.recordId)}): значение и запись происходят из одной строки источника NUBASE2020`));
            }
            // (аудит R2) Статусы не противоречат происхождению данных:
            // экспериментальная запись — известное значение, оценочная — оценка.
            if (c.dataStatus === 'experimental' && c.halfLife.status !== 'known') {
              errors.push(where(`кандидат ${label}: противоречие статусов — экспериментальная запись (dataStatus experimental) требует известного значения (halfLife known), получено ${String(c.halfLife.status)}`));
            }
            if (c.dataStatus === 'estimated' && c.halfLife.status !== 'estimated') {
              errors.push(where(`кандидат ${label}: противоречие статусов — оценочная запись (dataStatus estimated) требует оценённого значения (halfLife estimated), получено ${String(c.halfLife.status)}`));
            }
          } else if (isNonNullObject(c.halfLife) && (c.halfLife.status === 'unknown' || c.halfLife.status === 'not_applicable' || c.halfLife.status === 'not_implemented' || c.halfLife.status === 'invalid')) {
            errors.push(where(`кандидат ${label}: период полураспада уже отобранного кандидата обязан быть known/estimated, получено ${String((c.halfLife as Record<string, unknown>).status)} — данные либо известны, либо кандидат не включается`));
          }
          if (c.decayMode !== undefined && !isNonEmptyString(c.decayMode)) {
            errors.push(where(`кандидат ${label}: режим распада — непустая строка или отсутствие (не выдумывается)`));
          }
        }
      }
    } else if (cand.status === 'not_applicable') {
      if (!isNonEmptyString(cand.notApplicableReason)) {
        errors.push(where('not_applicable-кандидаты требуют объяснения notApplicableReason'));
      }
    } else {
      errors.push(where(`неизвестный статус кандидатов: ${String(cand.status)}`));
    }
  }

  // --- Электронная конфигурация и степени окисления ---
  for (const [propName, prop] of [
    ['electronConfiguration', el.electronConfiguration],
    ['oxidationStates', el.oxidationStates]
  ] as [string, unknown][]) {
    if (!isNonNullObject(prop)) {
      errors.push(where(`${propName} должен быть объектом ElementStringProperty`));
      continue;
    }
    if (prop.status === 'known') {
      if (!isNonEmptyString(prop.value)) {
        errors.push(where(`${propName} known требует непустое значение`));
      }
      if (!provenanceIdentifiesSource(prop.provenance)) {
        errors.push(where(`${propName} known требует provenance с идентификацией источника`));
      }
    } else if (prop.status === 'unknown') {
      if (!isNonEmptyString(prop.unknownReason)) {
        errors.push(where(`${propName} unknown требует причины unknownReason`));
      }
    } else {
      errors.push(where(`${propName}: неизвестный статус ${String(prop.status)}`));
    }
  }

  // --- Числовые научные значения ---
  const numericProps: [string, unknown][] = [
    ['firstIonizationEnergy', el.firstIonizationEnergy],
    ['electronAffinity', el.electronAffinity],
    ['electronegativity', el.electronegativity],
    ['atomicRadius', el.atomicRadius],
    ['meltingPoint', el.meltingPoint],
    ['boilingPoint', el.boilingPoint],
    ['density', el.density]
  ];
  for (const [propName, prop] of numericProps) {
    const shapeIssues = validateScientificValueShape(prop);
    for (const issue of shapeIssues) {
      errors.push(where(`${propName}: ${issue}`));
    }
    if (isNonNullObject(prop) && (prop.status === 'known' || prop.status === 'estimated')) {
      if (!provenanceIdentifiesSource(prop.provenance)) {
        errors.push(where(`${propName}: числовое значение (known/estimated) требует provenance с идентификацией источника`));
      }
    }
  }

  return errors;
}

// ============================================
// 8. КАТАЛОГ ЭЛЕМЕНТОВ
// ============================================

/** Читаемый интерфейс каталога элементов. */
export interface ElementCatalog {
  /** Зарегистрировать элемент; невалидная запись и дубликаты — ошибки. */
  register(element: ChemicalElement): void;
  /** Элемент по атомному номеру; null — не зарегистрирован. */
  getByAtomicNumber(atomicNumber: number): ChemicalElement | null;
  /** Элемент по символу (канонический реестр символов); null — нет. */
  getBySymbol(symbol: string): ChemicalElement | null;
  /** Есть ли символ в реестре. */
  hasSymbol(symbol: string): boolean;
  /** Все элементы, упорядоченные по атомному номеру (детерминированно). */
  list(): readonly ChemicalElement[];
  /** Число записей. */
  count(): number;
}

/** Пустой каталог элементов. */
export function createElementCatalog(): ElementCatalog {
  const byNumber = new Map<number, ChemicalElement>();
  const bySymbol = new Map<string, ChemicalElement>();
  return {
    register(element: ChemicalElement): void {
      const problems = validateChemicalElement(element);
      if (problems.length > 0) {
        throw new ElementError('invalid_element', `элемент «${String(element.symbol)}» не проходит валидацию: ${problems.join('; ')}`, String(element.symbol));
      }
      if (byNumber.has(element.atomicNumber)) {
        throw new ElementError('duplicate_element', `атомный номер ${element.atomicNumber} уже зарегистрирован`, String(element.symbol));
      }
      if (bySymbol.has(element.symbol)) {
        throw new ElementError('duplicate_element', `символ «${element.symbol}» уже зарегистрирован`, String(element.symbol));
      }
      byNumber.set(element.atomicNumber, element);
      bySymbol.set(element.symbol, element);
    },
    getByAtomicNumber(atomicNumber: number): ChemicalElement | null {
      return byNumber.get(atomicNumber) ?? null;
    },
    getBySymbol(symbol: string): ChemicalElement | null {
      return bySymbol.get(symbol) ?? null;
    },
    hasSymbol(symbol: string): boolean {
      return bySymbol.has(symbol);
    },
    list(): readonly ChemicalElement[] {
      return [...byNumber.entries()].sort((a, b) => a[0] - b[0]).map(([, el]) => el);
    },
    count(): number {
      return byNumber.size;
    }
  };
}

// ============================================
// 9. ССЫЛОЧНАЯ ЦЕЛОСТНОСТЬ ELEMENT COUNTS
// ============================================

/**
 * Отчёт о проверке ElementCounts против канонического реестра
 * символов. НЕ меняет validateSpecies и не внедряет обязательную
 * проверку в химический движок: это отдельная проверка ссылок
 * (точка интеграции Stage 4.3.3).
 */
export interface ElementCountsReferenceReport {
  /** Символы, присутствующие в реестре. */
  knownSymbols: readonly string[];
  /** Символы, отсутствующие в реестре (диагностируется, не угадывается). */
  unknownSymbols: readonly string[];
}

/**
 * Проверить элементный состав (символ → число атомов) на ссылочную
 * целостность: каждый символ обязан существовать в каталоге.
 * Сами составы и формулы НЕ проверяются и не меняются; парсер
 * формул не используется.
 */
export function checkElementCountsReference(
  catalog: ElementCatalog,
  counts: Record<string, number>
): ElementCountsReferenceReport {
  const knownSymbols: string[] = [];
  const unknownSymbols: string[] = [];
  for (const symbol of Object.keys(counts)) {
    if (catalog.hasSymbol(symbol)) {
      knownSymbols.push(symbol);
    } else {
      unknownSymbols.push(symbol);
    }
  }
  return { knownSymbols, unknownSymbols };
}


