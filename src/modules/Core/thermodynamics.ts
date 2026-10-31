// ============================================
// THERMODYNAMICS - Термодинамические свойства химических видов
// ============================================
//
// Контракт Stage 4.3.1 «Каталог веществ и термодинамических
// данных»: типизированная, валидируемая и расширяемая основа
// хранения термодинамических свойств химического вида.
//
// Принципы:
// - каждое известное (known) или оценочное (estimated) термодинами-
//   ческое значение несёт СОБСТВЕННОЕ происхождение с типизирован-
//   ным origin, а не только общую ссылку на источник вещества;
// - числовое значение существует только у known/estimated;
//   unknown — это отсутствие данных, а не ноль и не подстановка:
//   для unknown числовое значение не создаётся вовсе;
// - отсутствие uncertainty означает «неопределённость неизвестна»,
//   а НЕ нулевую погрешность;
// - одинаковые единицы НЕ делают данные сопоставимыми: числовые
//   термодинамические значения требуют явного reference state
//   (температура, давление, фаза, стандартное состояние, конвенции);
//   1 bar, 1 atm и 298.15 K автоматически не назначаются, если
//   источник их не задаёт;
// - запись каталога = вид + фаза: reference state относится к фазе
//   записи; газовые, жидкие, твёрдые и aqueous-состояния одного
//   вещества не смешиваются в одну запись;
// - исходная табличная Cp(T) — первоисточник; NASA-7 — производная
//   аппроксимация: она хранится отдельно, не заменяет таблицу, и
//   fitted-полином без исходных таблиц структурно некорректен;
// - вычислитель NASA-7 и процедура подбора коэффициентов в этом
//   подэтапе НЕ реализуются: только модель данных и валидация;
// - универсальные физические ограничения не вводятся там, где они
//   не доказаны для всех классов веществ; исключения — строгие
//   знаки термодинамической температуры и давления (положительны);
// - reference state обязателен при ЛЮБЫХ числовых термодинамических
//   данных: не только скалярных ΔfH°/ΔfG°/S° (known/estimated), но
//   и табличных Cp(T), и NASA-7 параметризации; сами температура,
//   давление и стандартное состояние автоматически не назначаются —
//   допустимо лишь явное описание;
// - валидация безопасна на повреждённых JSON-подобных данных
//   (null, недостроенные объекты, нечисловые поля): она возвращает
//   конкретные диагностические сообщения и продолжает проверять
//   независимые поля, а не бросает TypeError; широкие try/catch,
//   маскирующие ошибки, не используются.
//
// Согласование с DATA_PROVENANCE §1 (целевая схема ProvenancedValue):
// - origin: ThermoValueOrigin (observed | experimental |
//   reference_range | derived_computed | numerical_approximation |
//   theoretical_estimate | game_assumption | unknown);
// - sourceVersion → datasetVersion (существующее поле DataProvenance);
// - sourceId, datasetId, recordId — существующие поля;
// - checkedAt → retrievedAt; uncertaintyKind → Uncertainty
//   (существующий тип; дублирующие поля не вводятся);
// - ScientificValue / DataProvenance / Uncertainty расширяются,
//   а не дублируются: ThermoDataProvenance = DataProvenance + origin.
//
// Импорт фактических термохимических значений (NIST WebBook SRD 69,
// сверка с ATcT TN 1.228) — следующий подэтап (4.3.2): идентифика-
// торы записей, версии, даты и неопределённости не выдумываются.

import type { DataProvenance, ScientificValue, Uncertainty } from './scientificValue';
import { validateScientificValueShape, validateUncertainty } from './scientificValue';
import type { Dimension, PhysicalQuantity } from './physicalQuantity';
import { dimension, dimensionToString, getUnitDefinition, sameDimension } from './physicalQuantity';
import type { SpeciesPhase } from './species';

// ============================================
// 1. ПРОИСХОЖДЕНИЕ ТЕРМОДИНАМИЧЕСКОГО ЗНАЧЕНИЯ
// ============================================

/**
 * Типизированное происхождение термодинамического значения
 * (DATA_PROVENANCE §1). Отличается от статуса ScientificValue:
 * статус говорит, можно ли пользоваться числом; origin — откуда
 * это число взялось.
 */
export type ThermoValueOrigin =
  | 'observed'               // наблюдаемое значение (измерение, наблюдение)
  | 'experimental'           // экспериментальное определение
  | 'reference_range'        // справочный диапазон/справочное значение
  | 'derived_computed'       // выведено расчётом из других данных
  | 'numerical_approximation'// численная аппроксимация (например, фит полинома)
  | 'theoretical_estimate'   // теоретическая оценка (модель, корреляция)
  | 'game_assumption'        // игровое допущение (явно, не наука)
  | 'unknown';               // происхождение неизвестно

/** Runtime-реестр допустимых origin (данные приходят из JSON). */
export const THERMO_VALUE_ORIGINS: readonly ThermoValueOrigin[] = [
  'observed',
  'experimental',
  'reference_range',
  'derived_computed',
  'numerical_approximation',
  'theoretical_estimate',
  'game_assumption',
  'unknown'
];

/**
 * Происхождение термодинамического значения: DataProvenance +
 * типизированный origin. Поля DATA_PROVENANCE §1 отображены на
 * существующие (datasetVersion, sourceId, datasetId, recordId,
 * retrievedAt, Uncertainty) — дублирования не вводится.
 */
export interface ThermoDataProvenance extends DataProvenance {
  origin: ThermoValueOrigin;
}

// ============================================
// 2. REFERENCE STATE
// ============================================

/**
 * Reference state термодинамических данных. Одинаковых единиц
 * недостаточно для сопоставимости: сопоставимы только данные с
 * явно описанными условиями. Автоматически 1 bar / 1 atm / 298.15 K
 * не назначаются — если источник условия не задаёт, поле не
 * заполняется фикцией.
 */
export interface ThermoReferenceState {
  /** Температура reference state (размерность кельвина), если источник её задаёт. */
  temperature?: PhysicalQuantity;
  /** Давление (размерность паскаля), если применимо и указано источником. */
  pressure?: PhysicalQuantity;
  /** Фаза, к которой относятся данные; совпадает с фазой записи (вид + фаза). */
  phase: SpeciesPhase;
  /** Описание стандартного состояния и конвенции источника; непусто. */
  standardState: string;
  /** Описание условий и конвенций. */
  conditions?: string;
}

// ============================================
// 3. ТЕПЛОЁМКОСТЬ: ИСХОДНЫЕ ТАБЛИЦЫ И NASA-7
// ============================================

/** Одна точка исходной табличной зависимости Cp(T). */
export interface CpTablePoint {
  /** Температура точки (размерность кельвина). */
  temperature: PhysicalQuantity;
  /** Cp°(T) в точке (размерность J/(mol·K)). */
  cp: PhysicalQuantity;
  /** Неопределённость значения в точке (отсутствие = неизвестна, НЕ ноль). */
  uncertainty?: Uncertainty;
  /**
   * Собственное происхождение точки (иначе наследуется от таблицы).
   * Если присутствует — проходит ту же проверку, что и provenance
   * других термодинамических значений: типизированный origin
   * (unknown для числовой точки запрещён), идентификация источника,
   * метод для вычислительных происхождений.
   */
  provenance?: ThermoDataProvenance;
}

/**
 * Исходная табличная Cp(T) — первоисточник. Точки строго по
 * возрастанию температуры, без дубликатов. Интерполяция между
 * точками — забота будущего вычислителя, не этой модели.
 */
export interface CpTabulatedData {
  /** Точки по возрастанию температуры. */
  points: CpTablePoint[];
  /** Происхождение таблицы (обязательно, с origin). */
  provenance: ThermoDataProvenance;
  note?: string;
}

/** Как получены коэффициенты NASA-7 сегмента. */
export type Nasa7DerivationKind =
  | 'published' // коэффициенты взяты из публикации как первичные данные
  | 'fitted';   // коэффициенты подобраны аппроксимацией исходных данных

/**
 * Контрольная точка аппроксимации: значение Cp°/R из исходных данных
 * в точке и сохранённая процедурой подбора ошибка. Вычислитель
 * полинома в Stage 4.3.1 не реализуется, поэтому ошибка хранится
 * как данные процедуры подбора, а не пересчитывается здесь.
 */
export interface Nasa7CheckPoint {
  /** Температура контрольной точки (размерность кельвина), внутри диапазона сегмента. */
  temperature: PhysicalQuantity;
  /** Cp°(T)/R из исходных данных в этой точке (безразмерное). */
  sourceCpOverR: number;
  /** Абсолютная ошибка аппроксимации в точке (сохранена процедурой подбора). */
  absoluteError?: number;
}

/** Численная ошибка аппроксимации сегмента (в единицах Cp°/R). */
export interface Nasa7ApproximationError {
  /** Максимальная абсолютная ошибка по контрольным точкам. */
  maxAbsolute: number;
  /** Средняя абсолютная ошибка по контрольным точкам. */
  meanAbsolute?: number;
  note?: string;
}

/**
 * Сегмент NASA-7: полином Cp°(T)/R = a0 + a1·T + a2·T² + a3·T³ +
 * a4·T⁴ в заданном диапазоне температур. Семь коэффициентов
 * (a0…a6) — стандартная форма; a5, a6 относятся к интегральным
 * выражениям энтальпии и энтропии, которые задают форму, но в этом
 * подэтапе не вычисляются.
 */
export interface Nasa7Segment {
  /** Что задают коэффициенты сегмента: Cp°(T)/R (безразмерное). */
  quantity: 'Cp_over_R';
  /** Диапазон применимости сегмента (размерность кельвина), min < max. */
  rangeK: { min: PhysicalQuantity; max: PhysicalQuantity };
  /** Ровно семь конечных коэффициентов a0…a6. */
  coefficients: number[];
  /** Происхождение коэффициентов. */
  derivation: {
    kind: Nasa7DerivationKind;
    /** Происхождение исходных данных (обязательно, с origin). */
    provenance: ThermoDataProvenance;
    /** Метод аппроксимации; обязателен для fitted. */
    method?: string;
    /** Контрольные точки; обязательны для fitted. */
    checkPoints?: Nasa7CheckPoint[];
    /** Численная ошибка; обязательна для fitted. */
    approximationError?: Nasa7ApproximationError;
  };
}

/**
 * NASA-7 параметризация Cp°(T): сегменты упорядочены по возрастанию
 * температуры, без пересечений (общая граница-стык допустима).
 * Полином — производная аппроксимация: для fitted-сегментов
 * исходные табличные данные обязаны храниться рядом.
 */
export interface Nasa7Polynomial {
  segments: Nasa7Segment[];
  note?: string;
}

/** Runtime-реестр допустимых статусов данных о теплоёмкости. */
export const HEAT_CAPACITY_STATUSES: readonly HeatCapacityData['status'][] = [
  'known',
  'estimated',
  'unknown',
  'not_applicable',
  'not_implemented'
];

/**
 * Данные о теплоёмкости вида. Исходные таблицы и NASA-7 хранятся
 * отдельно и могут присутствовать одновременно; статус относится к
 * данным теплоёмкости как к научному значению.
 */
export interface HeatCapacityData {
  status: 'known' | 'estimated' | 'unknown' | 'not_applicable' | 'not_implemented';
  /** Исходная табличная Cp(T) — первоисточник. */
  tabulated?: CpTabulatedData;
  /** NASA-7 параметризация (производная аппроксимация). */
  nasa7?: Nasa7Polynomial;
  note?: string;
}

// ============================================
// 4. ТЕРМОДИНАМИЧЕСКИЕ СВОЙСТВА ВИДА
// ============================================

/**
 * Термодинамические свойства записи вида+фазы. Все скалярные поля
 * обязательны: запись явно говорит unknownValue(), а не молчит.
 * Блок целиком опционален на ScientificSpecies: его отсутствие —
 * термохимические свойства ещё не предоставлены (неизвестность,
 * НЕ нули и НЕ молчаливый fallback на качественные описания
 * легаси-каталога газов).
 */
export interface ThermodynamicProperties {
  /** Стандартная энтальпия образования ΔfH°, J/mol (размерность J_mol). */
  standardFormationEnthalpy: ScientificValue;
  /** Стандартная энергия Гиббса образования ΔfG°, J/mol (размерность J_mol). */
  standardFormationGibbsEnergy: ScientificValue;
  /** Стандартная молярная энтропия S°, J/(mol·K) (размерность J_mol_K). */
  standardEntropy: ScientificValue;
  /** Теплоёмкость: исходные таблицы и/или NASA-7. */
  heatCapacity: HeatCapacityData;
  /** Reference state; обязателен при любых числовых данных (ΔfH°/ΔfG°/S° known/estimated, табличные Cp(T), NASA-7). */
  referenceState?: ThermoReferenceState;
  /** Происхождение блока (не заменяет собственный provenance значений). */
  provenance?: DataProvenance;
  note?: string;
}

// ============================================
// 5. ВАЛИДАЦИЯ
// ============================================

/** Контекст валидации: запись каталога (вид + фаза). */
export interface ThermoValidationContext {
  /** id записи вида (для сообщений об ошибках). */
  speciesId?: string;
  /** Фаза записи: reference state обязан ей соответствовать. */
  expectedPhase?: SpeciesPhase;
}

// Ожидаемые размерности.
const FORMATION_ENERGY_DIMENSION: Dimension = dimension(1, 2, -2, 0, 0, -1); // J/mol
const MOLAR_ENTROPY_DIMENSION: Dimension = dimension(1, 2, -2, -1, 0, -1);    // J/(mol·K)
const TEMPERATURE_DIMENSION: Dimension = dimension(0, 0, 0, 1);               // K
const PRESSURE_DIMENSION: Dimension = dimension(1, -1, -2);                   // Pa

// Origin, для которых обязателен непустой метод получения/расчёта.
const ORIGINS_REQUIRING_METHOD: readonly ThermoValueOrigin[] = [
  'derived_computed',
  'numerical_approximation',
  'theoretical_estimate',
  'game_assumption'
];

/**
 * Безопасная проверка «это вообще объект». Данные приходят не только
 * из конструкторов, но и из сохранений/внешних источников, где на
 * месте вложенной структуры может стоять null, число или строка.
 */
function isNonNullObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function hasSourceIdentification(p: DataProvenance): boolean {
  return (
    (typeof p.sourceName === 'string' && p.sourceName.trim() !== '') ||
    (typeof p.sourceId === 'string' && p.sourceId.trim() !== '') ||
    (typeof p.datasetId === 'string' && p.datasetId.trim() !== '') ||
    (typeof p.reference === 'string' && p.reference.trim() !== '')
  );
}

/**
 * Безопасная структурная проверка физической величины ДО любого
 * обращения к её полям: объект, конечное числовое value, строковая
 * зарегистрированная unit; при expected !== null — совпадение
 * размерности. Возвращает true, только если величину можно
 * использовать в дальнейших проверках (порядок, положительность);
 * в противном случае диагностическое сообщение уже добавлено.
 * Никогда не выбрасывает исключений.
 */
function checkQuantityShape(
  path: string,
  q: unknown,
  expected: Dimension | null,
  errors: string[]
): boolean {
  if (!isNonNullObject(q)) {
    errors.push(`${path}: величина должна быть объектом {value, unit}`);
    return false;
  }
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    errors.push(`${path}: значение должно быть конечным числом, получено ${String(q.value)}`);
    return false;
  }
  if (typeof q.unit !== 'string') {
    errors.push(`${path}: единица должна быть строкой, получено ${String(q.unit)}`);
    return false;
  }
  if (expected !== null) {
    const def = getUnitDefinition(q.unit);
    if (def === null) {
      errors.push(`${path}: единица «${q.unit}» не зарегистрирована`);
      return false;
    }
    if (!sameDimension(def.dimension, expected)) {
      errors.push(
        `${path}: единица «${q.unit}» имеет размерность ${dimensionToString(def.dimension)}, ожидалась ${dimensionToString(expected)}`
      );
      // Величина с неверной размерностью не может использоваться в
      // дальнейших проверках (положительность, порядок температур,
      // пересечение диапазонов, контрольные точки): её числовое
      // значение в чужой размерности — не температура и не граница.
      // Преобразование единиц здесь НЕ выполняется: конверсия —
      // отдельная явная операция.
      return false;
    }
  }
  return true;
}

/**
 * Валидация происхождения термодинамического значения: origin
 * обязателен, принадлежит реестру, числовые значения не могут иметь
 * происхождение unknown; источник идентифицируется (название,
 * идентификатор или ссылка); вычислительные происхождения требуют
 * метода. Безопасна к null и повреждённым объектам provenance.
 */
function provenanceIssues(
  path: string,
  provenance: Partial<ThermoDataProvenance> | undefined | null
): string[] {
  const errors: string[] = [];
  if (provenance === undefined) {
    errors.push(`${path}: требуется собственный provenance значения (общей ссылки на источник вещества недостаточно)`);
    return errors;
  }
  if (!isNonNullObject(provenance)) {
    errors.push(`${path}: provenance должен быть объектом`);
    return errors;
  }
  const origin = provenance.origin;
  if (typeof origin !== 'string') {
    errors.push(`${path}: provenance требует типизированное происхождение origin`);
    return errors;
  }
  if (!(THERMO_VALUE_ORIGINS as readonly string[]).includes(origin)) {
    errors.push(`${path}: неизвестный origin «${origin}» (допустимы: ${THERMO_VALUE_ORIGINS.join(', ')})`);
    return errors;
  }
  if (origin === 'unknown') {
    errors.push(`${path}: числовое термодинамическое значение не может иметь происхождение unknown`);
    return errors;
  }
  if (!hasSourceIdentification(provenance as DataProvenance)) {
    errors.push(`${path}: provenance не идентифицирует источник (нужно sourceName, sourceId, datasetId или reference)`);
  }
  if (
    ORIGINS_REQUIRING_METHOD.includes(origin) &&
    (typeof provenance.method !== 'string' || provenance.method.trim() === '')
  ) {
    errors.push(`${path}: происхождение «${origin}» требует непустой метод получения/расчёта (method)`);
  }
  return errors;
}

/**
 * Валидация скалярного термодинамического значения: форма
 * ScientificValue, размерность единицы, собственный provenance
 * для known/estimated, отсутствие числового содержания у unknown.
 * Размерность проверяется только на корректном объекте величины;
 * на повреждённых данных возвращаются диагностики, не исключения.
 */
function scalarIssues(
  path: string,
  value: ScientificValue | undefined,
  expected: Dimension
): string[] {
  const errors: string[] = [];
  if (value === undefined) {
    errors.push(`${path}: поле обязательно (для неизвестного значения используйте unknownValue(), а не отсутствие поля)`);
    return errors;
  }
  for (const issue of validateScientificValueShape(value)) {
    errors.push(`${path}: ${issue}`);
  }
  if (!isNonNullObject(value)) {
    errors.push(`${path}: значение должно быть объектом ScientificValue`);
    return errors;
  }
  const status = value.status;
  if (typeof status !== 'string') {
    return errors; // статус отсутствует — ошибка формы уже добавлена выше
  }
  switch (status) {
    case 'known':
    case 'estimated': {
      // Размерность — только на корректном объекте величины.
      checkQuantityShape(path, value.quantity, expected, errors);
      errors.push(...provenanceIssues(path, value.provenance as Partial<ThermoDataProvenance> | undefined | null));
      if (value.uncertainty !== undefined) {
        if (!isNonNullObject(value.uncertainty)) {
          errors.push(`${path}: неопределённость должна быть объектом`);
        } else {
          const u = value.uncertainty as Record<string, unknown>;
          if (u.kind !== 'interval' && u.kind !== 'stddev' && u.kind !== 'relative' && u.kind !== 'bounded') {
            errors.push(`${path}: неопределённость требует kind ('interval' | 'stddev' | 'relative' | 'bounded'), получено «${String(u.kind)}»`);
          } else {
            for (const issue of validateUncertainty(value.uncertainty as unknown as Uncertainty)) {
              errors.push(`${path}: неопределённость: ${issue}`);
            }
          }
        }
      }
      break;
    }
    case 'invalid': {
      if (value.quantity !== undefined) {
        checkQuantityShape(path, value.quantity, expected, errors);
      }
      break;
    }
    case 'unknown':
    case 'not_applicable':
    case 'not_implemented': {
      // У этих статусов в типе ScientificValue поля quantity нет; для
      // runtime-проверки повреждённых данных читаем его безопасно.
      const quantityUnknown: unknown = (value as unknown as Record<string, unknown>).quantity;
      if (quantityUnknown !== undefined) {
        errors.push(`${path}: статус «${status}» не может нести числовое значение (для unknown числовое значение не создаётся)`);
      }
      break;
    }
    default:
      break; // неизвестный статус — ошибка формы уже добавлена выше
  }
  return errors;
}

/**
 * Валидация reference state. Температура и давление не назначаются
 * автоматически: их отсутствие допустимо, когда источник их не
 * задаёт; но описание стандартного состояния и фаза обязательны.
 * Безопасна к повреждённым величинам (diagnostics вместо throw).
 */
function referenceStateIssues(
  ref: ThermoReferenceState,
  context: ThermoValidationContext
): string[] {
  const errors: string[] = [];
  const path = 'reference state';
  if (typeof ref.standardState !== 'string' || ref.standardState.trim() === '') {
    errors.push(`${path}: описание стандартного состояния обязательно (пусто — не описание)`);
  }
  if (typeof ref.phase !== 'string' || ref.phase.trim() === '') {
    errors.push(`${path}: фаза обязательна`);
  } else if (context.expectedPhase !== undefined && ref.phase !== context.expectedPhase) {
    errors.push(
      `${path}: фаза «${ref.phase}» не совпадает с фазой записи «${context.expectedPhase}» (запись каталога = вид + фаза; состояния одного вещества не смешиваются)`
    );
  }
  if (ref.temperature !== undefined) {
    const ok = checkQuantityShape(`${path}: температура`, ref.temperature, TEMPERATURE_DIMENSION, errors);
    if (ok && !(ref.temperature.value > 0)) {
      errors.push(`${path}: термодинамическая температура должна быть положительной, получено ${ref.temperature.value}`);
    }
  }
  if (ref.pressure !== undefined) {
    const ok = checkQuantityShape(`${path}: давление`, ref.pressure, PRESSURE_DIMENSION, errors);
    if (ok && !(ref.pressure.value > 0)) {
      errors.push(`${path}: давление должно быть положительным, получено ${ref.pressure.value}`);
    }
  }
  return errors;
}

/**
 * Валидация исходной табличной Cp(T). Безопасна к null-таблицам,
 * null-точкам и повреждённым величинам; собственный provenance
 * точки, если присутствует, проходит ту же проверку происхождения,
 * что и остальные значения (отсутствие — наследование таблицы).
 */
function tabulatedIssues(table: CpTabulatedData | undefined): string[] {
  const errors: string[] = [];
  if (table === undefined) return errors;
  const path = 'Cp-таблица';
  if (!isNonNullObject(table)) {
    errors.push(`${path}: таблица должна быть объектом`);
    return errors;
  }
  const points = table.points;
  if (!Array.isArray(points) || points.length === 0) {
    errors.push(`${path}: требуется хотя бы одна точка Cp(T)`);
    return errors;
  }
  errors.push(...provenanceIssues(path, table.provenance as Partial<ThermoDataProvenance> | undefined | null));
  let prevTemperature: number | null = null;
  for (const [index, point] of points.entries()) {
    const pointPath = `${path} точка ${index}`;
    if (!isNonNullObject(point)) {
      errors.push(`${pointPath}: точка должна быть объектом`);
      continue;
    }
    const temperatureOk = checkQuantityShape(`${pointPath}: температура`, point.temperature, TEMPERATURE_DIMENSION, errors);
    checkQuantityShape(`${pointPath}: Cp`, point.cp, MOLAR_ENTROPY_DIMENSION, errors);
    if (temperatureOk) {
      const temperature = (point.temperature as PhysicalQuantity).value;
      if (!(temperature > 0)) {
        errors.push(`${pointPath}: температура должна быть положительной, получено ${temperature}`);
      }
      if (prevTemperature !== null) {
        if (temperature === prevTemperature) {
          errors.push(`${pointPath}: дубликат температуры ${temperature} K`);
        } else if (temperature < prevTemperature) {
          errors.push(`${pointPath}: точки должны идти строго по возрастанию температуры (${temperature} K после ${prevTemperature} K)`);
        }
      }
      prevTemperature = temperature;
    }
    if (point.uncertainty !== undefined) {
      if (!isNonNullObject(point.uncertainty)) {
        errors.push(`${pointPath}: неопределённость должна быть объектом`);
      } else {
        const u = point.uncertainty as Record<string, unknown>;
        if (u.kind !== 'interval' && u.kind !== 'stddev' && u.kind !== 'relative' && u.kind !== 'bounded') {
          errors.push(`${pointPath}: неопределённость требует kind ('interval' | 'stddev' | 'relative' | 'bounded'), получено «${String(u.kind)}»`);
        } else {
          for (const issue of validateUncertainty(point.uncertainty as unknown as Uncertainty)) {
            errors.push(`${pointPath}: неопределённость: ${issue}`);
          }
        }
      }
    }
    // Собственный provenance точки: та же проверка, что у остальных
    // значений; отсутствие — наследование provenance таблицы.
    if (point.provenance !== undefined) {
      errors.push(...provenanceIssues(`${pointPath}: provenance`, point.provenance as Partial<ThermoDataProvenance> | undefined | null));
    }
  }
  return errors;
}

/**
 * Валидация NASA-7 параметризации. Безопасна к null-сегментам,
 * повреждённым rangeK/derivation/контрольным точкам и ошибкам
 * аппроксимации: конкретные диагностики, продолжение проверки
 * независимых полей, никаких исключений.
 */
function nasa7Issues(
  poly: Nasa7Polynomial | undefined,
  table: CpTabulatedData | undefined
): string[] {
  const errors: string[] = [];
  if (poly === undefined) return errors;
  const path = 'NASA-7';
  if (!isNonNullObject(poly)) {
    errors.push(`${path}: параметризация должна быть объектом`);
    return errors;
  }
  if (!Array.isArray(poly.segments) || poly.segments.length === 0) {
    errors.push(`${path}: требуется хотя бы один сегмент`);
    return errors;
  }
  let prev: { min: number; max: number } | null = null;
  let anyFitted = false;
  for (const [index, segment] of poly.segments.entries()) {
    const segPath = `${path} сегмент ${index}`;
    if (!isNonNullObject(segment)) {
      errors.push(`${segPath}: сегмент должен быть объектом`);
      continue;
    }
    if (segment.quantity !== 'Cp_over_R') {
      errors.push(`${segPath}: коэффициенты должны объявляться как задающие Cp°(T)/R (quantity: 'Cp_over_R')`);
    }
    if (!Array.isArray(segment.coefficients) || segment.coefficients.length !== 7) {
      errors.push(`${segPath}: требуется ровно семь коэффициентов a0…a6, получено ${Array.isArray(segment.coefficients) ? segment.coefficients.length : 'не массив'}`);
    } else if (!(segment.coefficients as unknown[]).every((c) => Number.isFinite(c))) {
      errors.push(`${segPath}: все коэффициенты должны быть конечными числами`);
    }
    const rangeRec: unknown = segment.rangeK;
    let rangeBounds: { min: number; max: number } | null = null;
    if (!isNonNullObject(rangeRec) || !isNonNullObject(rangeRec.min) || !isNonNullObject(rangeRec.max)) {
      errors.push(`${segPath}: требуется диапазон применимости rangeK {min, max}`);
    } else {
      const minOk = checkQuantityShape(`${segPath}: нижняя граница`, rangeRec.min, TEMPERATURE_DIMENSION, errors);
      const maxOk = checkQuantityShape(`${segPath}: верхняя граница`, rangeRec.max, TEMPERATURE_DIMENSION, errors);
      if (minOk && maxOk) {
        // checkQuantityShape уже подтвердил форму и размерность;
        // сужение isNonNullObject оставляет Record<string, unknown>,
        // поэтому двойное приведение — единственный честный путь.
        const tMin = (rangeRec.min as unknown as PhysicalQuantity).value;
        const tMax = (rangeRec.max as unknown as PhysicalQuantity).value;
        rangeBounds = { min: tMin, max: tMax };
        if (!(tMin > 0)) {
          errors.push(`${segPath}: нижняя граница диапазона должна быть положительной, получено ${tMin}`);
        }
        if (tMin >= tMax) {
          errors.push(`${segPath}: нижняя граница диапазона (${tMin} K) должна быть меньше верхней (${tMax} K)`);
        }
        if (prev !== null) {
          if (tMin < prev.min) {
            errors.push(`${segPath}: сегменты должны быть упорядочены по возрастанию температуры`);
          }
          if (tMin < prev.max) {
            errors.push(`${segPath}: диапазон пересекается с предыдущим сегментом (стык — равная граница — допустим, наложение — нет)`);
          }
        }
        prev = { min: tMin, max: tMax };
      }
    }
    const derivation: unknown = segment.derivation;
    if (derivation === undefined) {
      errors.push(`${segPath}: требуется происхождение коэффициентов (derivation)`);
      continue;
    }
    if (!isNonNullObject(derivation)) {
      errors.push(`${segPath}: derivation должен быть объектом`);
      continue;
    }
    const kind = derivation.kind;
    if (kind !== 'published' && kind !== 'fitted') {
      errors.push(`${segPath}: derivation.kind должен быть 'published' или 'fitted', получено «${String(kind)}»`);
    }
    errors.push(...provenanceIssues(`${segPath}: provenance исходных данных`, derivation.provenance as Partial<ThermoDataProvenance> | undefined | null));
    if (kind === 'fitted') {
      anyFitted = true;
      if (typeof derivation.method !== 'string' || derivation.method.trim() === '') {
        errors.push(`${segPath}: fitted-сегмент требует непустой метод аппроксимации (derivation.method)`);
      }
      if (!Array.isArray(derivation.checkPoints) || derivation.checkPoints.length === 0) {
        errors.push(`${segPath}: fitted-сегмент требует контрольных точек (derivation.checkPoints)`);
      }
      const err: unknown = derivation.approximationError;
      if (err === undefined) {
        errors.push(`${segPath}: fitted-сегмент требует численную ошибку аппроксимации (derivation.approximationError)`);
      } else if (!isNonNullObject(err)) {
        errors.push(`${segPath}: approximationError должен быть объектом`);
      } else {
        const maxAbsolute = err.maxAbsolute;
        if (!Number.isFinite(maxAbsolute) || (maxAbsolute as number) < 0) {
          errors.push(`${segPath}: maxAbsolute должен быть конечным неотрицательным числом, получено ${String(maxAbsolute)}`);
        }
        const meanAbsolute = err.meanAbsolute;
        if (meanAbsolute !== undefined && (!Number.isFinite(meanAbsolute) || (meanAbsolute as number) < 0)) {
          errors.push(`${segPath}: meanAbsolute должен быть конечным неотрицательным числом, получено ${String(meanAbsolute)}`);
        }
        if (
          Number.isFinite(maxAbsolute) && (maxAbsolute as number) >= 0 &&
          meanAbsolute !== undefined && Number.isFinite(meanAbsolute) &&
          (meanAbsolute as number) > (maxAbsolute as number)
        ) {
          errors.push(`${segPath}: средняя ошибка (${String(meanAbsolute)}) не может превышать максимальную (${String(maxAbsolute)})`);
        }
      }
    }
    if (Array.isArray(derivation.checkPoints)) {
      for (const [cpIndex, checkPoint] of (derivation.checkPoints as unknown[]).entries()) {
        const cpPath = `${segPath} контрольная точка ${cpIndex}`;
        if (!isNonNullObject(checkPoint)) {
          errors.push(`${cpPath}: контрольная точка должна быть объектом`);
          continue;
        }
        const temperatureOk = checkQuantityShape(`${cpPath}: температура`, checkPoint.temperature, TEMPERATURE_DIMENSION, errors);
        if (temperatureOk) {
          const temperature = (checkPoint.temperature as PhysicalQuantity).value;
          if (!(temperature > 0)) {
            errors.push(`${cpPath}: температура должна быть положительной, получено ${temperature}`);
          }
          if (rangeBounds !== null && (temperature < rangeBounds.min || temperature > rangeBounds.max)) {
            errors.push(`${cpPath}: температура ${temperature} K вне диапазона сегмента [${rangeBounds.min}, ${rangeBounds.max}] K`);
          }
        }
        const sourceCpOverR = checkPoint.sourceCpOverR;
        if (!Number.isFinite(sourceCpOverR)) {
          errors.push(`${cpPath}: sourceCpOverR должен быть конечным числом, получено ${String(sourceCpOverR)}`);
        }
        const absoluteError = checkPoint.absoluteError;
        if (absoluteError !== undefined && (!Number.isFinite(absoluteError) || (absoluteError as number) < 0)) {
          errors.push(`${cpPath}: absoluteError должен быть конечным неотрицательным числом, получено ${String(absoluteError)}`);
        }
      }
    }
  }
  const tableRec: unknown = table;
  if (anyFitted && (!isNonNullObject(tableRec) || !Array.isArray(tableRec.points) || (tableRec.points as unknown[]).length === 0)) {
    errors.push(`${path}: fitted-полином заявлен, но исходные табличные Cp-данные не предоставлены (полином — аппроксимация, а не замена первоисточника)`);
  }
  return errors;
}

/**
 * Валидация данных о теплоёмкости. Безопасна к null-блоку и
 * повреждённым вложенным структурам.
 */
function heatCapacityIssues(cp: HeatCapacityData | undefined): string[] {
  const errors: string[] = [];
  const path = 'теплоёмкость';
  if (cp === undefined) {
    errors.push(`${path}: блок обязателен (для неизвестных данных используйте status: 'unknown', а не отсутствие поля)`);
    return errors;
  }
  if (!isNonNullObject(cp)) {
    errors.push(`${path}: блок должен быть объектом`);
    return errors;
  }
  const status = cp.status;
  if (typeof status !== 'string' || !(HEAT_CAPACITY_STATUSES as readonly string[]).includes(status)) {
    errors.push(`${path}: неизвестный статус «${String(status)}»`);
    return errors;
  }
  const numeric = status === 'known' || status === 'estimated';
  const hasTabulated = cp.tabulated !== undefined;
  const hasNasa7 = cp.nasa7 !== undefined;
  if (numeric && !hasTabulated && !hasNasa7) {
    errors.push(`${path}: статус known/estimated требует исходной таблицы Cp(T) и/или NASA-7 параметризации`);
  }
  if (!numeric && (hasTabulated || hasNasa7)) {
    errors.push(`${path}: при статусе unknown/not_applicable/not_implemented данные теплоёмкости не предоставляются`);
  }
  errors.push(...tabulatedIssues(cp.tabulated));
  errors.push(...nasa7Issues(cp.nasa7, cp.tabulated));
  return errors;
}

/**
 * Валидация термодинамических свойств записи вида+фазы.
 * Возвращает список ошибок (пустой = блок корректен).
 *
 * Проверяется структурная корректность и полнота происхождения;
 * научная достоверность значений (согласие с источниками,
 * перекрёстная проверка NIST ↔ ATcT) — содержание следующего
 * подэтапа (4.3.2), не этой функции. Универсальные физические
 * ограничения сверх доказанных не вводятся.
 *
 * Reference state обязателен при ЛЮБЫХ числовых данных: скалярные
 * ΔfH°/ΔfG°/S° (known/estimated), табличные Cp(T) и NASA-7
 * (status known/estimated с фактическими данными). Функция
 * безопасна на повреждённых JSON-подобных входах: конкретные
 * диагностики вместо исключений, независимые поля проверяются
 * дальше, где это возможно.
 */
export function validateThermodynamicProperties(
  thermo: ThermodynamicProperties,
  context: ThermoValidationContext = {}
): string[] {
  const errors: string[] = [];
  if (typeof thermo !== 'object' || thermo === null) {
    return ['термодинамика: блок должен быть объектом'];
  }
  errors.push(...scalarIssues('стандартная энтальпия образования (standardFormationEnthalpy)', thermo.standardFormationEnthalpy, FORMATION_ENERGY_DIMENSION));
  errors.push(...scalarIssues('стандартная энергия Гиббса образования (standardFormationGibbsEnergy)', thermo.standardFormationGibbsEnergy, FORMATION_ENERGY_DIMENSION));
  errors.push(...scalarIssues('стандартная молярная энтропия (standardEntropy)', thermo.standardEntropy, MOLAR_ENTROPY_DIMENSION));
  const scalarValues: unknown[] = [
    thermo.standardFormationEnthalpy,
    thermo.standardFormationGibbsEnergy,
    thermo.standardEntropy
  ];
  const scalarNumericPresent = scalarValues.some(
    (v) => isNonNullObject(v) && (v.status === 'known' || v.status === 'estimated')
  );
  // Числовые данные теплоёмкости: status known/estimated с непустой
  // таблицей Cp(T) и/или непустой NASA-7 параметризацией. Повреждённые
  // структуры сюда не попадают — их диагностируют tabulatedIssues и
  // nasa7Issues; отсутствие reference state при них не маскируется.
  const hcRec: unknown = thermo.heatCapacity;
  const hcStatus = isNonNullObject(hcRec) ? hcRec.status : undefined;
  const hcTabulated: unknown = isNonNullObject(hcRec) ? hcRec.tabulated : undefined;
  const hcNasa7: unknown = isNonNullObject(hcRec) ? hcRec.nasa7 : undefined;
  const hcNumericData =
    (hcStatus === 'known' || hcStatus === 'estimated') &&
    ((isNonNullObject(hcTabulated) && Array.isArray(hcTabulated.points) && hcTabulated.points.length > 0) ||
     (isNonNullObject(hcNasa7) && Array.isArray(hcNasa7.segments) && hcNasa7.segments.length > 0));
  const numericPresent = scalarNumericPresent || hcNumericData;
  if (numericPresent && (thermo.referenceState === undefined || thermo.referenceState === null)) {
    errors.push('reference state обязателен при любых числовых термодинамических данных (ΔfH°/ΔfG°/S° known/estimated, табличные Cp(T), NASA-7): одинаковых единиц недостаточно для сопоставимости');
  }
  if (thermo.referenceState !== undefined) {
    if (!isNonNullObject(thermo.referenceState)) {
      errors.push('reference state: должен быть объектом (при числовых данных явное описание состояния обязательно)');
    } else {
      errors.push(...referenceStateIssues(thermo.referenceState, context));
    }
  }
  errors.push(...heatCapacityIssues(thermo.heatCapacity));
  return errors;
}
