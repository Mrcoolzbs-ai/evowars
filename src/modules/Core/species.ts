// ============================================
// SCIENTIFIC SPECIES - Формализованный химический вид
// ============================================
//
// Контракт химических видов ядра (Stage 4.1).
//
// Различение сущностей:
// - химический ВИД (H2O) — не резервуар и не место нахождения:
//   одна молекула воды может находиться в атмосфере, океане, льду
//   или гидротермальной системе; вид один, резервуары разные;
// - ФАЗОВОЕ состояние — явное поле вида (phase), но CO2(g) и CO2(aq)
//   в этой модели — РАЗНЫЕ записи каталога (phase входит в описание
//   записи), чтобы будущие равновесные и кинетические расчёты могли
//   однозначно определить, что именно они считают. Выбор модели
//   зафиксирован: «запись = вид + фаза», стабильный id кодирует оба;
// - вид ≠ материал, ≠ реакция, ≠ термодинамическое состояние.
//
// Элементный состав — явная запись (H2O → H:2, O:1), а не результат
// парсера формул. Парсер на этом этапе не реализуется и не
// притворяется реализованным.
//
// Расширяемость: ионы (заряд), радикалы, изотопы (дополнительные
// идентификаторы), электрон (elements: {}, charge: -1), комплексные
// виды и твёрдые фазы переменного состава (note) — всё выражается
// существующими полями без перестройки архитектуры.
//
// Каталог НЕ заменяет легаси Data/gases + Data/elementCompositions:
// createSpeciesCatalogFromLegacy() строит его из существующих данных,
// не дублируя значения вручную.
//
// Stage 4.3.1: опциональное поле thermodynamics — термодинамические
// свойства записи (вид + фаза): ΔfH°, ΔfG°, S°, Cp-таблицы и NASA-7
// с собственным происхождением каждого значения (см. thermodynamics.ts).
// Stage 4.3.2 (корректирующая): опциональное поле molarMassProvenance —
// собственное происхождение молярной массы, отдельно от происхождения
// формулы/состава (значение может прийти из другого источника).

import type { DataProvenance, DataStatus } from './scientificValue';
import type { ThermodynamicProperties } from './thermodynamics';
import { validateThermodynamicProperties } from './thermodynamics';

// ============================================
// 1. ТИПЫ
// ============================================

/** Фаза вида. Расширяемый набор, не только атмосферная газовая смесь. */
export type SpeciesPhase =
  | 'gas'
  | 'liquid'
  | 'solid'
  | 'aqueous'
  | 'plasma'
  | 'supercritical'
  | 'other';

/** Число атомов элемента: неотрицательное целое (0 = элемент не входит). */
export type ElementCounts = Record<string, number>;

export interface ScientificSpecies {
  /** Стабильный идентификатор вида+фазы (например 'h2o' или 'h2o_aq'). */
  id: string;
  /** Химическая формула (текст; не парсится автоматически). */
  formula: string;
  /** Человекочитаемое название. */
  name?: string;
  /** Элементный состав: символ элемента → число атомов в частице. */
  elements: ElementCounts;
  /**
   * Электрический заряд частицы в единицах элементарного заряда:
   * 0 — электронейтральная частица, -1 — анион, +2 — катион.
   * Электрон: elements = {}, charge = -1.
   */
  charge: number;
  /** Фаза, к которой относится запись вида. */
  phase: SpeciesPhase;
  /**
   * Молярная масса, кг/моль. null — неизвестна (НЕ ноль: нулевая
   * молярная масса физически невозможна, отсутствие данных — это
   * отсутствие данных). Числовое значение может также быть оценкой
   * с собственным статусом — для этого введён molarMassStatus.
   */
  molarMassKgMol: number | null;
  /** Статус значения молярной массы (как научного значения). */
  molarMassStatus: DataStatus;
  /**
   * Собственное происхождение молярной массы (корректирующая ревизия
   * Stage 4.3.2): значение может происходить из другого источника,
   * чем формула/состав вида (например, из записи NASA CEA), и тогда
   * обязано явно ссылаться на свою запись источника (recordId).
   * Отсутствие поля — обратная совместимость: легаси-виды и виды
   * без отдельного происхождения массы покрываются provenance вида.
   */
  molarMassProvenance?: DataProvenance;
  /** Дополнительные идентификаторы (CAS, InChIKey и т.п.). */
  aliases?: string[];
  /** Происхождение данных вида. */
  provenance?: DataProvenance;
  /** Статус данных самого описания вида. */
  dataStatus: DataStatus;
  /**
   * Термодинамические свойства записи (Stage 4.3.1). Отсутствие поля
   * означает, что термохимические свойства ещё не предоставлены:
   * это неизвестность, а НЕ нулевые значения и НЕ молчаливый
   * fallback на качественные описания легаси-каталога газов.
   */
  thermodynamics?: ThermodynamicProperties;
  /** Особые случаи: радикал, изотоп, переменный состав твёрдой фазы. */
  note?: string;
}

// ============================================
// 2. ВАЛИДАЦИЯ
// ============================================

export class SpeciesError extends Error {
  readonly code: 'invalid_species' | 'duplicate_species' | 'unknown_species';
  readonly component = 'ScientificSpecies';
  readonly speciesId: string | null;

  constructor(code: 'invalid_species' | 'duplicate_species' | 'unknown_species', message: string, speciesId: string | null) {
    super(`[ScientificSpecies] ${message}`);
    this.name = 'SpeciesError';
    this.code = code;
    this.speciesId = speciesId;
  }
}

/**
 * Валидация записи вида. Список ошибок (пустой = запись корректна).
 *
 * Правила:
 * - id и formula непусты;
 * - элементы — неотрицательные ЦЕЛЫЕ числа (половина атома невозможна);
 * - заряд — целое число;
 * - молярная масса — конечное положительное число, если задана.
 */
export function validateSpecies(species: ScientificSpecies): string[] {
  const errors: string[] = [];
  if (species.id.trim() === '') errors.push('id вида не может быть пустым');
  if (species.formula.trim() === '') errors.push('формула вида не может быть пустой');
  if (!Number.isInteger(species.charge)) {
    errors.push(`заряд должен быть целым числом, получено ${species.charge}`);
  }
  for (const [element, count] of Object.entries(species.elements)) {
    if (element.trim() === '') {
      errors.push('символ элемента не может быть пустым');
      continue;
    }
    if (!Number.isInteger(count) || count < 0) {
      errors.push(`количество атомов элемента ${element} должно быть неотрицательным целым, получено ${count}`);
    }
  }
  if (species.molarMassKgMol !== null) {
    const m = species.molarMassKgMol;
    if (!Number.isFinite(m) || m <= 0) {
      errors.push(`молярная масса должна быть конечным положительным числом, получено ${m}`);
    }
  }
  // Корректирующая ревизия Stage 4.3.2: собственный provenance
  // молярной массы — только при числовой массе и с идентификацией
  // источника; отсутствие поля — норма (обратная совместимость).
  // Финальная научная корректировка перед 4.3.3: обещанная в
  // описании поля ссылка на запись источника закреплена валидатором —
  // recordId обязан быть непустой строкой (null, пустая строка и
  // отсутствие recordId — диагностические ошибки).
  if (species.molarMassProvenance !== undefined) {
    if (species.molarMassKgMol === null) {
      errors.push('molarMassProvenance допустим только при числовой молярной массе: у неизвестного значения нет числового происхождения (описание неизвестности — в provenance вида)');
    }
    if (typeof species.molarMassProvenance !== 'object' || species.molarMassProvenance === null) {
      errors.push('molarMassProvenance должен быть объектом DataProvenance');
    } else {
      const massProvenance = species.molarMassProvenance as Record<string, unknown>;
      const identified =
        (typeof massProvenance.sourceName === 'string' && massProvenance.sourceName.trim() !== '') ||
        (typeof massProvenance.sourceId === 'string' && massProvenance.sourceId.trim() !== '') ||
        (typeof massProvenance.datasetId === 'string' && massProvenance.datasetId.trim() !== '') ||
        (typeof massProvenance.reference === 'string' && massProvenance.reference.trim() !== '');
      if (!identified) {
        errors.push('molarMassProvenance должен идентифицировать источник (sourceName, sourceId, datasetId или reference)');
      }
      const recordId = massProvenance.recordId;
      if (typeof recordId !== 'string' || recordId.trim() === '') {
        errors.push('molarMassProvenance должен ссылаться на запись источника: recordId — непустая строка (отсутствие поля, null, пустая или пробельная строка — диагностическая ошибка)');
      }
    }
  }
  if (species.thermodynamics !== undefined) {
    const thermoIssues = validateThermodynamicProperties(species.thermodynamics, {
      speciesId: species.id,
      expectedPhase: species.phase
    });
    for (const issue of thermoIssues) {
      errors.push(`термодинамика: ${issue}`);
    }
  }
  return errors;
}

// ============================================
// 3. КАТАЛОГ
// ============================================

/** Читаемый интерфейс каталога видов. */
export interface SpeciesCatalog {
  /** Зарегистрировать вид; повторный id — ошибка duplicate_species. */
  register(species: ScientificSpecies): void;
  /** Получить вид; null — не зарегистрирован. */
  get(id: string): ScientificSpecies | null;
  /** Есть ли вид с таким id. */
  has(id: string): boolean;
  /** Список всех id. */
  listIds(): readonly string[];
  /** Число записей. */
  size(): number;
  /**
   * Все записи с заданной формулой (любые фазы):
   * CO2 может существовать как gas и aqueous записи одновременно.
   */
  findByFormula(formula: string): readonly ScientificSpecies[];
}

/** Пустой каталог. */
export function createSpeciesCatalog(): SpeciesCatalog {
  const byId = new Map<string, ScientificSpecies>();
  const byFormula = new Map<string, ScientificSpecies[]>();
  return {
    register(species: ScientificSpecies): void {
      const problems = validateSpecies(species);
      if (problems.length > 0) {
        throw new SpeciesError('invalid_species', `вид «${species.id}» не проходит валидацию: ${problems.join('; ')}`, species.id);
      }
      if (byId.has(species.id)) {
        throw new SpeciesError('duplicate_species', `вид «${species.id}» уже зарегистрирован`, species.id);
      }
      byId.set(species.id, species);
      const same = byFormula.get(species.formula) ?? [];
      same.push(species);
      byFormula.set(species.formula, same);
    },
    get(id: string): ScientificSpecies | null {
      return byId.get(id) ?? null;
    },
    has(id: string): boolean {
      return byId.has(id);
    },
    listIds(): readonly string[] {
      return [...byId.keys()];
    },
    size(): number {
      return byId.size;
    },
    findByFormula(formula: string): readonly ScientificSpecies[] {
      return [...(byFormula.get(formula) ?? [])];
    }
  };
}

// ============================================
// 4. ЭЛЕМЕНТНЫЕ И ЗАРЯДОВЫЕ ИТОГИ
// ============================================

export interface ElementTotals {
  /** Суммарное число атомов каждого элемента. */
  totals: Record<string, number>;
  /** Виды, исключённые из подсчёта (не зарегистрированы в каталоге). */
  excludedSpecies: string[];
}

/**
 * Суммарное число атомов каждого элемента в наборе количеств видов.
 * Виды, отсутствующие в каталоге (состав неизвестен), в подсчёт
 * не входят и явно перечисляются: неизвестный состав не заменяется
 * нулём и не игнорируется молча.
 */
export function elementTotals(
  catalog: SpeciesCatalog,
  counts: Record<string, number>
): ElementTotals {
  const totals: Record<string, number> = {};
  const excluded: string[] = [];
  for (const [id, amount] of Object.entries(counts)) {
    const species = catalog.get(id);
    if (!species) {
      if (!excluded.includes(id)) excluded.push(id);
      continue;
    }
    for (const [element, count] of Object.entries(species.elements)) {
      totals[element] = (totals[element] ?? 0) + count * amount;
    }
  }
  return { totals, excludedSpecies: excluded };
}

/**
 * Суммарный электрический заряд набора количеств видов
 * (в единицах элементарного заряда). Для электронейтральных наборов
 * должен быть равен нулю.
 */
export function chargeTotal(
  catalog: SpeciesCatalog,
  counts: Record<string, number>
): { charge: number; excludedSpecies: string[] } {
  let charge = 0;
  const excluded: string[] = [];
  for (const [id, amount] of Object.entries(counts)) {
    const species = catalog.get(id);
    if (!species) {
      if (!excluded.includes(id)) excluded.push(id);
      continue;
    }
    charge += species.charge * amount;
  }
  return { charge, excludedSpecies: excluded };
}

/**
 * Проверка сохранения элементов между двумя наборами количеств
 * (реактанты и продукты). Возвращает null при точном совпадении,
 * иначе описание расхождения. Виды с неизвестным составом делают
 * проверку невозможной — это сообщается явно.
 */
export function elementBalanceCheck(
  catalog: SpeciesCatalog,
  left: Record<string, number>,
  right: Record<string, number>
): { balanced: boolean; reason: string } {
  const a = elementTotals(catalog, left);
  const b = elementTotals(catalog, right);
  const unknown = [...a.excludedSpecies, ...b.excludedSpecies];
  if (unknown.length > 0) {
    return {
      balanced: false,
      reason: `элементный баланс непроверяем: состав видов неизвестен (${[...new Set(unknown)].join(', ')})`
    };
  }
  const elements = new Set([...Object.keys(a.totals), ...Object.keys(b.totals)]);
  for (const element of elements) {
    if ((a.totals[element] ?? 0) !== (b.totals[element] ?? 0)) {
      return {
        balanced: false,
        reason: `элементный баланс нарушен для ${element}: ${a.totals[element] ?? 0} слева против ${b.totals[element] ?? 0} справа`
      };
    }
  }
  return { balanced: true, reason: 'элементный баланс соблюдён' };
}
