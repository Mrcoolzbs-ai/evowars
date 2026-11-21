// ============================================
// GEOCHEMICAL SPECIES - аддитивная модель геохимических веществ (Stage 4.9a.1)
// ============================================
//
// КОРРЕКТИРУЮЩАЯ РЕВИЗИЯ Stage 4.9a.1 (проблема A).
//
// Проблема предыдущей ревизии: каталог процессов Stage 4.9a ссылался
// на виды «caco3» и «c_org», которые НЕ существуют в производственной
// среде: buildSpeciesCatalogFromLegacy() строит SpeciesCatalog только
// из Data/gases.ts + Data/elementCompositions.ts (фаза 'gas').
// Тесты добавляли их вручную как синтетические виды — то есть
// проверяли искусственную среду, а не возможность реального исполнения.
//
// РЕШЕНИЕ (этот модуль — МЕХАНИЗМ, данные — Data/geochemicalSpeciesCatalog.ts):
// - геохимические вещества описываются как GeochemicalSpeciesDefinition,
//   совместимые с ScientificSpecies и регистрируются в СУЩЕСТВУЮЩЕМ
//   SpeciesCatalog (вторая система видов НЕ создаётся);
// - фазовая идентичность: газ, водный раствор, жидкость и твёрдое
//   вещество — РАЗНЫЕ записи каталога (модель «запись = вид + фаза»
//   из Core/species.ts): CO2(г) и CO2(aq) — разные id;
// - объединённый каталог строится АДДИТИВНО: легаси-газы остаются как
//   есть, геохимические виды добавляются отдельным каталогом,
//   Data/gases.ts НЕ расширяется минералами/органикой (это каталог
//   газов);
// - дубликаты id и несовместимые определения выявляются ЯВНО
//   (fail-closed): повторная регистрация одного id — ошибка
//   duplicate_species существующего контракта SpeciesCatalog;
//   конфликтующее (несовместимое) определение при слиянии — issue,
//   а не молчаливая перезапись существующего вида;
// - молярная масса: числовое значение только с provenance (контракт
//   validateSpecies); неизвестная масса — null + molarMassStatus
//   'unknown' и НЕ назначается автоматически. Неизвестная масса
//   НЕ блокирует элементный аудит (состав {C:1,O:2} — установленная
//   химия), но БЛОКИРУЕТ перевод в кг (нет коэффициента mol → kg).
//
// Органический углерод: честная bookkeeping-семантика — «моли атомов
// углерода в органическом пуле», формула 'C', элементы {C:1}. Это
// НЕ универсальная молекула органики: содержание H и O органического
// вещества НЕ представлено (никакая выдуманная формула CH2O не
// подставляется). Конкретные текстовые ограничения — в определении
// вида (Data/geochemicalSpeciesCatalog.ts, ORGANIC_CARBON_NOTE).

import type { DataProvenance, DataStatus } from './scientificValue';
import type { ElementCounts, SpeciesPhase, ScientificSpecies } from './species';
import { createSpeciesCatalog, SpeciesError } from './species';
import type { SpeciesCatalog } from './species';

// ============================================
// 1. ОПРЕДЕЛЕНИЕ ГЕОХИМИЧЕСКОГО ВИДА
// ============================================

/**
 * Сериализуемое определение геохимического вещества (данные, не логика):
 * структурно соответствует ScientificSpecies, но объявляется отдельно —
 * чтобы производственный каталог видов МОЖНО было строить аддитивно
 * (легаси-газы + геохимические виды), не редактируя Data/gases.ts.
 */
export interface GeochemicalSpeciesDefinition {
  /** Стабильный идентификатор вида+фазы (id кодирует фазу, например 'co2_aq'). */
  readonly id: string;
  /** Химическая формула (текст; для bookkeeping-компонентов — честная пометка в note). */
  readonly formula: string;
  /** Человекочитаемое название. */
  readonly name?: string;
  /** Элементный состав: символ элемента → число атомов в частице/компоненте. */
  readonly elements: ElementCounts;
  /** Электрический заряд в единицах элементарного заряда. */
  readonly charge: number;
  /** Фаза записи: газ/водный раствор/жидкость/твёрдое — РАЗНЫЕ виды. */
  readonly phase: SpeciesPhase;
  /** Молярная масса, кг/моль; null — неизвестна (НЕ назначается автоматически). */
  readonly molarMassKgMol: number | null;
  /** Статус значения молярной массы. */
  readonly molarMassStatus: DataStatus;
  /** Собственное происхождение молярной массы (только при числовой массе). */
  readonly molarMassProvenance?: DataProvenance;
  /** Дополнительные идентификаторы. */
  readonly aliases?: readonly string[];
  /** Происхождение данных вида. */
  readonly provenance?: DataProvenance;
  /** Статус данных самого описания вида. */
  readonly dataStatus: DataStatus;
  /** Особые случаи: bookkeeping-семантика, переменный состав и т.п. */
  readonly note?: string;
}

// ============================================
// 2. ВАЛИДАЦИЯ ОПРЕДЕЛЕНИЯ (runtime, данные могут прийти из JSON)
// ============================================

/**
 * Runtime-валидация определения вида. Возвращает список проблем
 * (пустой = определение валидно и может быть переведено в
 * ScientificSpecies). Проверяет форму и согласованность обязательных
 * частей: id/формула/фаза/состав/статусы, согласованность числовой
 * молярной массы с provenance (контракт validateSpecies ядра).
 */
export function validateGeochemicalSpeciesDefinition(def: unknown): string[] {
  const errors: string[] = [];
  if (typeof def !== 'object' || def === null || Array.isArray(def)) {
    return ['определение вида должно быть объектом, получено ' + (def === null ? 'null' : typeof def)];
  }
  const d = def as Record<string, unknown>;
  if (typeof d.id !== 'string' || d.id.trim() === '') {
    errors.push('id вида должен быть непустой строкой');
  }
  if (typeof d.formula !== 'string' || d.formula.trim() === '') {
    errors.push('формула вида не может быть пустой');
  }
  if (typeof d.phase !== 'string' || d.phase.trim() === '') {
    errors.push('фаза вида обязательна (газ/водный раствор/жидкость/твёрдое — разные виды)');
  }
  if (typeof d.elements !== 'object' || d.elements === null || Array.isArray(d.elements)) {
    errors.push('elements должен быть объектом (символ элемента → число атомов)');
  } else {
    for (const [element, count] of Object.entries(d.elements)) {
      if (typeof element !== 'string' || element.trim() === '') {
        errors.push('символ элемента не может быть пустым');
      }
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        errors.push(`количество атомов элемента ${element} должно быть неотрицательным целым числом, получено ${String(count)}`);
      }
    }
  }
  if (typeof d.charge !== 'number' || !Number.isInteger(d.charge)) {
    errors.push(`заряд должен быть целым числом, получено ${String(d.charge)}`);
  }
  if (d.molarMassKgMol !== null) {
    if (typeof d.molarMassKgMol !== 'number' || !Number.isFinite(d.molarMassKgMol) || d.molarMassKgMol <= 0) {
      errors.push(`молярная масса должна быть конечным положительным числом или null (неизвестна), получено ${String(d.molarMassKgMol)}`);
    }
    if (d.molarMassProvenance === undefined) {
      errors.push('числовая молярная масса обязана нести molarMassProvenance (идентифицированный источник + recordId)');
    }
  } else if (d.molarMassStatus === 'known') {
    errors.push('molarMassStatus «known» противоречит отсутствию числового значения (molarMassKgMol: null)');
  }
  if (d.molarMassProvenance !== undefined) {
    if (d.molarMassKgMol === null) {
      errors.push('molarMassProvenance допустим только при числовой молярной массе (у неизвестного значения нет числового происхождения)');
    }
    if (typeof d.molarMassProvenance !== 'object' || d.molarMassProvenance === null) {
      errors.push('molarMassProvenance должен быть объектом DataProvenance');
    } else {
      const p = d.molarMassProvenance as Record<string, unknown>;
      const identified =
        (typeof p.sourceName === 'string' && p.sourceName.trim() !== '') ||
        (typeof p.sourceId === 'string' && p.sourceId.trim() !== '') ||
        (typeof p.datasetId === 'string' && p.datasetId.trim() !== '') ||
        (typeof p.reference === 'string' && p.reference.trim() !== '');
      if (!identified) {
        errors.push('molarMassProvenance должен идентифицировать источник (sourceName, sourceId, datasetId или reference)');
      }
      if (typeof p.recordId !== 'string' || p.recordId.trim() === '') {
        errors.push('molarMassProvenance должен ссылаться на запись источника: recordId — непустая строка');
      }
    }
  }
  if (typeof d.dataStatus !== 'string' || d.dataStatus.trim() === '') {
    errors.push('dataStatus вида обязателен (known | estimated | unknown | not_applicable | not_implemented | invalid)');
  }
  if (d.provenance !== undefined && (typeof d.provenance !== 'object' || d.provenance === null)) {
    errors.push('provenance вида должен быть объектом DataProvenance или отсутствовать');
  }
  for (const key of ['note', 'name'] as const) {
    if (d[key] !== undefined && typeof d[key] !== 'string') {
      errors.push(`«${key}» должен быть строкой, если задан`);
    }
  }
  return errors;
}

// ============================================
// 3. ОПРЕДЕЛЕНИЕ → ScientificSpecies
// ============================================

/**
 * Перевод определения в запись ScientificSpecies (контракт ядра).
 * Инвалиды и дубликаты здесь НЕ «чинятся»: определение обязано
 * пройти validateGeochemicalSpeciesDefinition, регистрация проходит
 * через существующий SpeciesCatalog.register (валидация ядра).
 */
export function geochemicalSpeciesToScientific(def: GeochemicalSpeciesDefinition): ScientificSpecies {
  return {
    id: def.id,
    formula: def.formula,
    name: def.name,
    elements: { ...def.elements },
    charge: def.charge,
    phase: def.phase,
    molarMassKgMol: def.molarMassKgMol,
    molarMassStatus: def.molarMassStatus,
    ...(def.molarMassProvenance !== undefined ? { molarMassProvenance: def.molarMassProvenance } : {}),
    ...(def.aliases !== undefined ? { aliases: [...def.aliases] } : {}),
    ...(def.provenance !== undefined ? { provenance: def.provenance } : {}),
    dataStatus: def.dataStatus,
    ...(def.note !== undefined ? { note: def.note } : {})
  };
}

// ============================================
// 4. СБОРКА КАТАЛОГА ИЗ ОПРЕДЕЛЕНИЙ
// ============================================

/**
 * Построить SpeciesCatalog ИЗ геохимических определений (самостоятельный
 * каталог геохимических видов). Существующий SpeciesCatalog ядра
 * переиспользуется как хранилище; дубликаты id внутри определений
 * отклоняются ошибкой duplicate_species, инвалидные определения —
 * invalid_species (оба кода — существующий контракт ядра).
 */
export function buildSpeciesCatalogFromDefinitions(defs: readonly GeochemicalSpeciesDefinition[]): SpeciesCatalog {
  // Ранняя проверка дубликатов id внутри самих определений: ошибка
  // duplicate_species без попытки «потерпеть» обе записи.
  const seen = new Set<string>();
  for (const def of defs) {
    if (seen.has(def.id)) {
      throw new SpeciesError('duplicate_species', `геохимическое вещество «${def.id}» определено более одного раза`, def.id);
    }
    seen.add(def.id);
  }
  const catalog = createSpeciesCatalog();
  for (const def of defs) {
    catalog.register(geochemicalSpeciesToScientific(def));
  }
  return catalog;
}

// ============================================
// 5. АДДИТИВНОЕ СЛИЯНИЕ С ПРОИЗВОДСТВЕННЫМ КАТАЛОГОМ
// ============================================

export interface MergedSpeciesCatalog {
  /** НОВЫЙ каталог: легаси-виды + добавленные геохимические (базовый каталог не мутируется). */
  readonly catalog: SpeciesCatalog;
  /** Геохимические виды, добавленные в объединённый каталог. */
  readonly added: readonly string[];
  /** Геохимические виды, уже присутствовавшие с ИДЕНТИЧНЫМ определением (перерегистрации нет). */
  readonly skipped: readonly string[];
  /** Геохимические виды с НЕСОВМЕСТИМЫМ определением против базового каталога (добавлены НЕ были). */
  readonly conflicts: readonly string[];
  /** Все проблемы слияния (несовместимые определения, инвалидные определения). */
  readonly issues: readonly string[];
}

/**
 * Аддитивное слияние: геохимические определения добавляются к существующему
 * каталогу (обычно производственному buildSpeciesCatalogFromLegacy).
 *
 - id уже есть и определение СОВПАДАЕТ по формуле/составу/заряду/фазе →
   skip: запись та же, дубликат не создаётся (совместимость легаси и
   геохимических данных не перезаписывает чужие данные);
 - id уже есть и определение РАСХОДИТСЯ → конфликт: вид НЕ добавляется,
   issue с точным перечнем расхождений (fail-closed, молчаливой
   перезаписи легаси-вида нет);
 - id новый → add (с полной валидацией, как в register ядра);
 - само определение не проходит валидацию → issue, вид НЕ добавляется.
 *
 * Базовый каталог НЕ мутируется: строится новый объединённый каталог.
 */
export function mergeGeochemicalSpeciesIntoCatalog(
  base: SpeciesCatalog,
  defs: readonly GeochemicalSpeciesDefinition[]
): MergedSpeciesCatalog {
  const added: string[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];
  const issues: string[] = [];
  const accepted: GeochemicalSpeciesDefinition[] = [];

  for (const def of defs) {
    const definitionIssues = validateGeochemicalSpeciesDefinition(def);
    if (definitionIssues.length > 0) {
      issues.push(`геохимическое вещество «${'id' in (def ?? {}) && typeof (def as { id?: unknown }).id === 'string' ? (def as { id: string }).id : '<без id>'}» не проходит валидацию: ${definitionIssues.join('; ')}`);
      continue;
    }
    const existing = base.get(def.id);
    if (existing) {
      // Сравнение с уже зарегистрированной записью: разрешён ТОЛЬКО
      // полный аналог (та же формула, состав, заряд, фаза, масса).
      const compatible =
        existing.formula === def.formula &&
        existing.phase === def.phase &&
        existing.charge === def.charge &&
        existing.molarMassKgMol === def.molarMassKgMol &&
        JSON.stringify(existing.elements) === JSON.stringify({ ...def.elements });
      if (compatible) {
        skipped.push(def.id);
      } else {
        conflicts.push(def.id);
        const diffs: string[] = [];
        if (existing.formula !== def.formula) diffs.push(`формула: «${existing.formula}» против «${def.formula}»`);
        if (existing.phase !== def.phase) diffs.push(`фаза: «${existing.phase}» против «${def.phase}»`);
        if (existing.charge !== def.charge) diffs.push(`заряд: ${existing.charge} против ${def.charge}`);
        if (existing.molarMassKgMol !== def.molarMassKgMol) diffs.push(`молярная масса: ${String(existing.molarMassKgMol)} против ${String(def.molarMassKgMol)}`);
        if (JSON.stringify(existing.elements) !== JSON.stringify({ ...def.elements })) diffs.push(`состав: ${JSON.stringify(existing.elements)} против ${JSON.stringify({ ...def.elements })}`);
        issues.push(`геохимическое вещество «${def.id}» расходится с уже зарегистрированным видом (${diffs.join('; ')}): определить, какая запись верна, и «перезаписать» существующий вид молча нельзя (fail-closed)`);
      }
      continue;
    }
    accepted.push(def);
    added.push(def.id);
  }

  // Новый каталог: сначала все записи базового (их форму переносим как
  // есть, без правок), затем принятые геохимические определения.
  const merged = createSpeciesCatalog();
  for (const id of base.listIds()) {
    const species = base.get(id);
    if (species) merged.register(species);
  }
  for (const def of accepted) {
    merged.register(geochemicalSpeciesToScientific(def));
  }

  return { catalog: merged, added, skipped, conflicts, issues };
}
