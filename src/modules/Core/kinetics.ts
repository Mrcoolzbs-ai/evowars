// ============================================
// KINETICS - Контракты кинетических записей и вычислитель k(T)
// Stage 4.5.1 + 4.5.2
// ============================================
//
// Контракт Stage 4.5 (docs/science/IMPLEMENTATION_ROADMAP.md §4.5,
// CHEMISTRY_ARCHITECTURE.md §4 «Химическая кинетика», §5.2 «Кинетика
// (ODE)», §5.3 «Расщепление равновесия и кинетики»):
// - 4.5.1: типизированные контракты кинетических записей — класс
//   реакции (elementary | overall_empirical), явный порядок закона
//   скорости, модель концентраций, типизированные единицы k,
//   параметризации Аррениуса и fall-off, статусы данных;
// - 4.5.2: вычислитель k(T) — модифицированная форма Аррениуса
//   k = A·(T/300)^n·exp(−Ea/(R·T)) и fall-off (Lindemann-ядро +
//   Troe-уширение), fail-closed вне диапазона применимости.
//
// Соседние подэтапы (НЕ часть этого модуля): ODE-решатель с
// интерфейсом якобиана (BDF/Radau, адаптивный шаг, контроль локальной
// ошибки) — 4.5.3; каталог JPL Evaluation No. 20 (JPL Publication
// 25-1, 2025, DOI 10.48577/jpl.KFQ0TZ) с per-record сверкой по
// таблицам публикации — 4.5.4 (требует исходный PDF); сборка механизмов
// (RHS, якобиан сети, инварианты шага, расширение runKineticStep без
// неявного solveEquilibrium) — 4.5.5.
//
// Принципы:
// - порядок закона скорости НЕ приравнивается автоматически к
//   стехиометрии: для elementary это молекулярность механизма, для
//   overall_empirical — из экспериментальных данных; порядок — явное
//   поле записи; поддержаны целые порядки 1..3 (реестр единиц k),
//   остальное требует расширения контракта, а не молчаливой замены;
// - энергетический параметр типизирован: JPL публикует E/R в
//   кельвинах, классическая форма — Ea в Дж/моль; вычислитель
//   применяет ту форму, которая заявлена, смешение не интерпретируется;
// - единицы k — часть контракта записи: локальные типизированные
//   идентификаторы, согласованные с порядком и моделью концентраций
//   (JPL: molecule/cm³; SI: mol/m³). molecule не входит в реестр
//   физических единиц проекта (количество вещества в ядре — моль),
//   поэтому кинетические единицы НЕ регистрируются в physicalQuantity,
//   а согласуются валидатором этого контракта;
// - диапазон применимости — часть данных: температура ВНЕ диапазона —
//   отказ temperature_out_of_range, а НЕ экстраполяция и НЕ
//   «ближайшее значение» (та же политика, что у термодинамических
//   сегментов NASA-7);
// - данных нет → статус unknown → ошибка no_kinetic_data «не
//   рассчитано»: вычислитель не подставляет ни нули, ни значения по
//   умолчанию; estimated-параметры обязаны иметь метод и вычисляются
//   с передачей статуса в результат;
// - fall-off: k([M],T) = [k0(T)·[M] / (1 + k0(T)·[M]/k∞(T))] ·
//   Fc^(1/(1+(log10(Pr)/N)²)), Pr = k0(T)·[M]/k∞(T). Форма
//   (Lindemann-ядро + Troe-уширение) подтверждена независимыми
//   открытыми источниками (документация MICM — параметризация с
//   явными Fc и N; IUPAC-форма — N = 0.75 − 1.27·log10(Fc);
//   JPL-панель публикует Fc = 0.6). Fc и N — ЯВНЫЕ числовые поля
//   записи с provenance; правило выбора N для JPL-записей сверяется
//   по самой публикации при импорте данных (4.5.4). Вычислитель не
//   подставляет «стандартные» Fc/N молча: их нет в записи — ошибка;
// - комбинирование неопределённостей k0 и k∞ в неопределённость
//   эффективной fall-off константы в этом подэтапе не моделируется:
//   в результате неопределённость честно не заполняется (не
//   выдумывается ни правило, ни число);
// - обратные реакции (термодинамическое согласование через K(T)),
//   фотохимические J-потоки и поверхностные реакции — по мере данных
//   в других подэтапах; solveEquilibrium из кинетики не вызывается
//   (§5.3: равновесный расчёт и кинетическое продвижение — разные
//   операции, никогда не вызывают друг друга неявно);
// - gameSpeedCoefficient — атрибут ТОЛЬКО легаси-игрового
//   стехиометрического режима (src/modules/Data/chemicalReactions.ts),
//   в научную кинетику не входит и сюда не переносится.

import type { PhysicalQuantity } from './physicalQuantity';
import { convert, dimension, dimensionOf, isKnownUnit, sameDimension } from './physicalQuantity';
import type { DataProvenance, Uncertainty } from './scientificValue';
import { validateUncertainty } from './scientificValue';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from './thermoFunctions';

// ============================================
// 1. КОНСТАНТЫ И РЕЕСТРЫ
// ============================================

/**
 * Постоянная Авогадро N_A, 1/моль. Точное значение определения
 * СИ 2019; согласована с точной универсальной газовой постоянной
 * R = k_B·N_A научного ядра (thermoFunctions): обе константы точные,
 * преобразование molecule ↔ mol не вносит погрешность констант.
 */
export const AVOGADRO_NUMBER_PER_MOL = 6.02214076e23;

/**
 * Опорная температура модифицированной формы Аррениуса, K. Это часть
 * ОПРЕДЕЛЕНИЯ формы k = A·(T/300)^n·exp(−Ea/(R·T)), а не подогнанное
 * значение: предэкспонента A каталога отнесена к 300 K.
 */
export const ARRHENIUS_REFERENCE_TEMPERATURE_K = 300;

/** Класс реакции: элементарная (молекулярность механизма) или суммарная эмпирическая. */
export type KineticReactionKind = 'elementary' | 'overall_empirical';

/** Runtime-реестр классов реакций (данные приходят из JSON). */
export const KINETIC_REACTION_KINDS: readonly KineticReactionKind[] = ['elementary', 'overall_empirical'];

/**
 * Модель концентраций, к которой отнесены k и концентрации сети:
 * molecule_cm3 — конвенция JPL (molecule/cm³), mol_m3 — SI (моль/м³).
 */
export type ConcentrationModel = 'molecule_cm3' | 'mol_m3';

/** Runtime-реестр моделей концентраций. */
export const CONCENTRATION_MODELS: readonly ConcentrationModel[] = ['molecule_cm3', 'mol_m3'];

/**
 * Единицы константы скорости — локальные типизированные идентификаторы
 * кинетического контракта (НЕ реестр физических единиц проекта:
 * molecule не входит в него, количество вещества в ядре — моль).
 * Идентификатор однозначно задаёт порядок и модель концентраций.
 */
export type RateConstantUnit =
  | 'per_s' // порядок 1 (единица не зависит от модели концентраций)
  | 'cm3_per_molecule_per_s' // порядок 2, molecule_cm3
  | 'cm6_per_molecule2_per_s' // порядок 3, molecule_cm3
  | 'm3_per_mol_per_s' // порядок 2, mol_m3
  | 'm6_per_mol2_per_s'; // порядок 3, mol_m3

/** Runtime-реестр единиц k. */
export const RATE_CONSTANT_UNITS: readonly RateConstantUnit[] = [
  'per_s',
  'cm3_per_molecule_per_s',
  'cm6_per_molecule2_per_s',
  'm3_per_mol_per_s',
  'm6_per_mol2_per_s'
];

/** Спецификация единицы k: порядок закона скорости и модель концентраций. */
interface RateConstantUnitSpec {
  order: number;
  model: ConcentrationModel | 'shared';
}

/** Спецификации единиц k; согласование с записью проверяет валидатор. */
const RATE_CONSTANT_UNIT_SPECS: Readonly<Record<RateConstantUnit, RateConstantUnitSpec>> = {
  'per_s': { order: 1, model: 'shared' },
  'cm3_per_molecule_per_s': { order: 2, model: 'molecule_cm3' },
  'cm6_per_molecule2_per_s': { order: 3, model: 'molecule_cm3' },
  'm3_per_mol_per_s': { order: 2, model: 'mol_m3' },
  'm6_per_mol2_per_s': { order: 3, model: 'mol_m3' }
};

/** Единица k для целого порядка 1..3 и модели концентраций; null — порядок вне реестра. */
export function rateConstantUnitForOrder(order: number, model: ConcentrationModel): RateConstantUnit | null {
  if (!Number.isInteger(order) || order < 1 || order > 3) {
    return null;
  }
  if (order === 1) {
    return 'per_s';
  }
  if (model === 'molecule_cm3') {
    return order === 2 ? 'cm3_per_molecule_per_s' : 'cm6_per_molecule2_per_s';
  }
  return order === 2 ? 'm3_per_mol_per_s' : 'm6_per_mol2_per_s';
}

// ============================================
// 2. ПАРАМЕТРИЗАЦИИ И ЗАПИСИ
// ============================================

/**
 * Энергетический параметр формы Аррениуса. Типизирован: таблицы JPL
 * публикуют E/R в кельвинах, классическая форма — Ea в Дж/моль.
 * Отрицательные значения допустимы (в таблицах JPL встречаются
 * отрицательные E/R); смешение форм не интерпретируется.
 */
export type EnergyParameter =
  | { form: 'E_over_R'; /** E/R, K (конвенция таблиц JPL). */ valueK: number }
  | { form: 'Ea_J_mol'; /** Ea, Дж/моль (классическая форма). */ valueJPerMol: number };

/** Параметры модифицированной формы Аррениуса k = A·(T/300)^n·exp(−Ea/(R·T)). */
export interface ArrheniusParameters {
  /** Предэкспонента A в единицах unit; физически положительна. */
  preExponentialA: number;
  /** Показатель T-зависимости n (безразмерный; 0 — классический Аррениус). */
  temperatureExponentN: number;
  /** Энергетический параметр (E/R в K или Ea в Дж/моль). */
  energy: EnergyParameter;
  /** Диапазон применимости параметризации, K (границы включаются). */
  temperatureRangeK: { min: number; max: number };
  /** Единица k, в которой опубликована A. */
  unit: RateConstantUnit;
  /** Неопределённость k (например, фактор JPL — kind: 'relative'). */
  uncertainty?: Uncertainty;
  /** Происхождение параметров — обязательно: константа без источника не используется. */
  provenance: DataProvenance;
}

/** Параметры fall-off (Lindemann-ядро + Troe-уширение). */
export interface FallOffParameters {
  /** Низкоплотностный предел k0(T): единица порядка overallOrder + 1. */
  lowPressureLimit: ArrheniusParameters;
  /** Высокоплотностный предел k∞(T): единица порядка overallOrder (эффективная единица k). */
  highPressureLimit: ArrheniusParameters;
  /** Центрирующий фактор Fc ∈ (0, 1] (JPL-панель публикует 0.6; явное поле записи). */
  centeringFactorFc: number;
  /** Параметр формы N > 0 (правило JPL сверяется по публикации при импорте; явное поле записи). */
  broadeningN: number;
  /** Третье тело, если источник его фиксирует (например «M = N2 + O2»); описательное поле. */
  thirdBodyNote?: string;
  /** Происхождение параметров — обязательно. */
  provenance: DataProvenance;
}

/** Параметризация константы скорости. */
export type RateConstantParameters =
  | { kind: 'arrhenius'; arrhenius: ArrheniusParameters }
  | { kind: 'fall_off'; fallOff: FallOffParameters };

/**
 * Константа скорости со статусом данных. Семантика статусов — как у
 * ScientificValue (scientificValue.ts), но числовое содержание несёт
 * локальные кинетические единицы, а не PhysicalQuantity реестра.
 */
export type RateConstantData =
  | { status: 'known'; parameters: RateConstantParameters }
  | { status: 'estimated'; /** Метод оценки обязателен: оценка без метода безследна. */ method: string; parameters: RateConstantParameters }
  | { status: 'unknown'; note?: string; provenance?: DataProvenance };

/** Запись кинетической реакции. */
export interface KineticReactionRecord {
  id: string;
  /** elementary | overall_empirical — определяет СМЫСЛ порядка. */
  kind: KineticReactionKind;
  /**
   * Суммарный порядок закона скорости: elementary — молекулярность
   * механизма; overall_empirical — из экспериментальных данных;
   * стехиометрией не заменяется. null допустим ТОЛЬКО при
   * rateConstant.status === 'unknown' (для «не рассчитано» порядок не
   * нужен); при известных данных порядок обязателен — на нём держится
   * согласование единиц k.
   */
  overallOrder: number | null;
  /** Модель концентраций, к которой отнесены k и [M]. */
  concentrationModel: ConcentrationModel;
  rateConstant: RateConstantData;
  /** Происхождение записи (таблица/строка источника). */
  provenance?: DataProvenance;
  /** Человекочитаемая реакция (для сообщений и журналов; стехиометрией не является). */
  reaction?: string;
  note?: string;
}

// ============================================
// 3. ОШИБКА
// ============================================

/** Коды ошибок кинетического вычислителя. */
export type KineticsErrorCode =
  | 'invalid_input' // повреждённая запись/вход (форма, NaN, единицы, согласование)
  | 'no_kinetic_data' // статус unknown: скорость «не рассчитано», данных нет
  | 'temperature_out_of_range' // T вне диапазона применимости параметризаций
  | 'invalid_third_body' // [M] не задана или неположительна для fall-off записи
  | 'numerical_failure'; // переполнение/исчезновение при вычислении k

/** Ошибка кинетического вычислителя (fail-closed: без подстановок). */
export class KineticsError extends Error {
  readonly code: KineticsErrorCode;
  readonly operation: string;
  readonly details?: string;

  constructor(args: { code: KineticsErrorCode; operation: string; message: string; details?: string }) {
    super(
      `[kinetics/${args.operation}] ${args.message}` +
        (args.details !== undefined ? ` (${args.details})` : '')
    );
    this.name = 'KineticsError';
    this.code = args.code;
    this.operation = args.operation;
    this.details = args.details;
  }
}

// ============================================
// 4. ВАЛИДАТОР ЗАПИСЕЙ (RUNTIME, JSON-ПРОИСХОЖДЕНИЕ)
// ============================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProvenanceLike(value: unknown): boolean {
  return isRecord(value);
}

const UNCERTAINTY_KINDS: readonly string[] = ['interval', 'stddev', 'relative', 'bounded'];

/**
 * Проверка параметров Аррениуса. expectedOrder/model === null —
 * согласование единиц пропускается (ошибка порядка/модели уже
 * зафиксирована в списке problems вызывающей стороной).
 */
function validateArrheniusParameters(
  value: unknown,
  expectedOrder: number | null,
  model: ConcentrationModel | null,
  errors: string[],
  label: string
): void {
  if (!isRecord(value)) {
    errors.push(`${label}: параметры Аррениуса должны быть объектом`);
    return;
  }
  const p = value;
  if (typeof p.preExponentialA !== 'number' || !Number.isFinite(p.preExponentialA) || p.preExponentialA <= 0) {
    errors.push(
      `${label}: предэкспонента A должна быть конечным положительным числом, получено ${String(p.preExponentialA)}`
    );
  }
  if (typeof p.temperatureExponentN !== 'number' || !Number.isFinite(p.temperatureExponentN)) {
    errors.push(`${label}: показатель n должен быть конечным числом, получено ${String(p.temperatureExponentN)}`);
  }
  const energy = p.energy;
  if (!isRecord(energy)) {
    errors.push(`${label}: энергетический параметр должен быть объектом {form, ...}`);
  } else if (energy.form === 'E_over_R') {
    if (typeof energy.valueK !== 'number' || !Number.isFinite(energy.valueK)) {
      errors.push(
        `${label}: E/R (valueK) должен быть конечным числом (отрицательные E/R допустимы), получено ${String(energy.valueK)}`
      );
    }
  } else if (energy.form === 'Ea_J_mol') {
    if (typeof energy.valueJPerMol !== 'number' || !Number.isFinite(energy.valueJPerMol)) {
      errors.push(`${label}: Ea (valueJPerMol) должно быть конечным числом, получено ${String(energy.valueJPerMol)}`);
    }
  } else {
    errors.push(
      `${label}: форма энергетического параметра должна быть E_over_R | Ea_J_mol, получено «${String(energy.form)}»`
    );
  }
  const range = p.temperatureRangeK;
  if (!isRecord(range) || typeof range.min !== 'number' || typeof range.max !== 'number') {
    errors.push(`${label}: temperatureRangeK должен содержать числовые min и max`);
  } else if (
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min <= 0 ||
    range.min >= range.max
  ) {
    errors.push(
      `${label}: диапазон применимости обязан удовлетворять 0 < min < max (K), получено [${range.min}, ${range.max}]`
    );
  }
  const unit = p.unit;
  if (typeof unit !== 'string' || !(RATE_CONSTANT_UNITS as readonly string[]).includes(unit)) {
    errors.push(`${label}: единица k должна быть из кинетического реестра, получено «${String(unit)}»`);
  } else if (expectedOrder !== null) {
    const spec = RATE_CONSTANT_UNIT_SPECS[unit as RateConstantUnit];
    if (spec.order !== expectedOrder) {
      errors.push(`${label}: единица «${unit}» отнесена к порядку ${spec.order}, запись заявляет ${expectedOrder}`);
    }
    if (model !== null && spec.model !== 'shared' && spec.model !== model) {
      errors.push(
        `${label}: единица «${unit}» отнесена к модели концентраций ${spec.model}, запись заявляет ${model}`
      );
    }
  }
  if (p.uncertainty !== undefined && p.uncertainty !== null) {
    if (!isRecord(p.uncertainty) || !UNCERTAINTY_KINDS.includes(String(p.uncertainty.kind))) {
      errors.push(`${label}: kind неопределённости должен быть interval | stddev | relative | bounded`);
    } else {
      for (const problem of validateUncertainty(p.uncertainty as Uncertainty)) {
        errors.push(`${label}: ${problem}`);
      }
    }
  }
  if (!isProvenanceLike(p.provenance)) {
    errors.push(`${label}: provenance обязателен (константа без источника не используется)`);
  }
}

/** Проверка параметров fall-off: пределы, Fc, N, пересечение диапазонов. */
function validateFallOffParameters(
  value: unknown,
  order: number | null,
  model: ConcentrationModel | null,
  errors: string[],
  label: string
): void {
  if (!isRecord(value)) {
    errors.push(`${label}: параметры fall-off должны быть объектом`);
    return;
  }
  if (order !== null && order > 2) {
    errors.push(
      `${label}: fall-off запись заявляет порядок ${order}, но единица k0 требует порядка ${order + 1} — вне реестра (1..3)`
    );
  }
  validateArrheniusParameters(value.lowPressureLimit, order === null ? null : order + 1, model, errors, `${label}.k0`);
  validateArrheniusParameters(value.highPressureLimit, order, model, errors, `${label}.kInf`);
  const fc = value.centeringFactorFc;
  if (typeof fc !== 'number' || !Number.isFinite(fc) || fc <= 0 || fc > 1) {
    errors.push(`${label}: центрирующий фактор Fc должен быть конечным числом в (0, 1], получено ${String(fc)}`);
  }
  const n = value.broadeningN;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    errors.push(`${label}: параметр формы N должен быть конечным положительным числом, получено ${String(n)}`);
  }
  if (value.thirdBodyNote !== undefined && typeof value.thirdBodyNote !== 'string') {
    errors.push(`${label}: thirdBodyNote должен быть строкой`);
  }
  if (!isProvenanceLike(value.provenance)) {
    errors.push(`${label}: provenance обязателен`);
  }
  const lo = value.lowPressureLimit;
  const hi = value.highPressureLimit;
  if (isRecord(lo) && isRecord(hi)) {
    const loRange = lo.temperatureRangeK;
    const hiRange = hi.temperatureRangeK;
    if (
      isRecord(loRange) &&
      isRecord(hiRange) &&
      typeof loRange.min === 'number' &&
      typeof loRange.max === 'number' &&
      typeof hiRange.min === 'number' &&
      typeof hiRange.max === 'number' &&
      Number.isFinite(loRange.min) &&
      Number.isFinite(loRange.max) &&
      Number.isFinite(hiRange.min) &&
      Number.isFinite(hiRange.max) &&
      Math.max(loRange.min, hiRange.min) >= Math.min(loRange.max, hiRange.max)
    ) {
      errors.push(
        `${label}: диапазоны применимости k0 [${loRange.min}, ${loRange.max}] K и k∞ [${hiRange.min}, ${hiRange.max}] K не пересекаются — применимых температур нет`
      );
    }
  }
}

/**
 * Проверка формы записи кинетической реакции произвольного
 * происхождения (JSON). Возвращает список проблем; пустой список =
 * запись корректна. Проверяются структурный контракт и согласование
 * (порядок ↔ единицы, модель концентраций, диапазоны, Fc/N).
 * Достоверность САМИХ чисел для конкретной реакции (истинность
 * A/n/E) этим валидатором НЕ устанавливается: её даёт только
 * per-record сверка с источником (4.5.4, JPL Publication 25-1).
 */
export function validateKineticReactionRecord(record: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(record)) {
    return ['запись должна быть объектом (не массивом и не null)'];
  }
  if (typeof record.id !== 'string' || record.id.trim() === '') {
    errors.push('id должен быть непустой строкой');
  }
  if (!(KINETIC_REACTION_KINDS as readonly string[]).includes(String(record.kind))) {
    errors.push(`kind должен быть elementary | overall_empirical, получено «${String(record.kind)}»`);
  }
  if (!(CONCENTRATION_MODELS as readonly string[]).includes(String(record.concentrationModel))) {
    errors.push(`concentrationModel должен быть molecule_cm3 | mol_m3, получено «${String(record.concentrationModel)}»`);
  }
  const model: ConcentrationModel | null =
    record.concentrationModel === 'mol_m3'
      ? 'mol_m3'
      : record.concentrationModel === 'molecule_cm3'
        ? 'molecule_cm3'
        : null;
  const order = record.overallOrder;
  const rc = record.rateConstant;
  const rcIsRecord = isRecord(rc);
  const rcStatus = rcIsRecord ? rc.status : undefined;
  const hasNumericRate = rcStatus === 'known' || rcStatus === 'estimated';
  if (order === null || order === undefined) {
    if (hasNumericRate) {
      errors.push('порядок закона скорости (overallOrder) обязателен при известных/оценённых параметрах константы');
    }
  } else if (typeof order !== 'number' || !Number.isInteger(order) || order < 1 || order > 3) {
    errors.push(
      `поддерживаются целые порядки закона скорости 1..3 (реестр единиц k), получено ${String(order)}; другие порядки требуют расширения контракта`
    );
  }
  if (!rcIsRecord) {
    errors.push('rateConstant должен быть объектом со статусом known | estimated | unknown');
  } else if (rcStatus === 'unknown') {
    if (rc.note !== undefined && typeof rc.note !== 'string') {
      errors.push('note константы должен быть строкой');
    }
  } else if (rcStatus === 'known' || rcStatus === 'estimated') {
    if (rcStatus === 'estimated' && (typeof rc.method !== 'string' || rc.method.trim() === '')) {
      errors.push('estimated-константа требует непустой method — оценка без метода безследна');
    }
    const params = rc.parameters;
    if (!isRecord(params)) {
      errors.push('parameters обязателен при статусе known/estimated');
    } else if (params.kind === 'arrhenius') {
      validateArrheniusParameters(
        params.arrhenius,
        typeof order === 'number' ? order : null,
        model,
        errors,
        'rateConstant.arrhenius'
      );
    } else if (params.kind === 'fall_off') {
      validateFallOffParameters(
        params.fallOff,
        typeof order === 'number' ? order : null,
        model,
        errors,
        'rateConstant.fallOff'
      );
    } else {
      errors.push(`kind параметризации должен быть arrhenius | fall_off, получено «${String(params.kind)}»`);
    }
  } else {
    errors.push(`статус константы скорости должен быть known | estimated | unknown, получено «${String(rcStatus)}»`);
  }
  if (record.provenance !== undefined && !isProvenanceLike(record.provenance)) {
    errors.push('provenance записи должен быть объектом');
  }
  if (record.reaction !== undefined && typeof record.reaction !== 'string') {
    errors.push('reaction должен быть строкой');
  }
  if (record.note !== undefined && typeof record.note !== 'string') {
    errors.push('note должен быть строкой');
  }
  return errors;
}

// ============================================
// 5. ВЫЧИСЛИТЕЛЬ k(T)
// ============================================

const TEMPERATURE_DIMENSION = dimension(0, 0, 0, 1);

/** Температура в кельвинах: величина, конечная, положительная, размерности K (fail-closed). */
function temperatureInKelvin(temperature: PhysicalQuantity, operation: string): number {
  if (temperature === null || typeof temperature !== 'object') {
    throw new KineticsError({
      code: 'invalid_input',
      operation,
      message: 'температура должна быть величиной {value, unit}'
    });
  }
  const q = temperature as PhysicalQuantity;
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    throw new KineticsError({
      code: 'invalid_input',
      operation,
      message: `значение температуры должно быть конечным числом, получено ${String(q.value)}`
    });
  }
  if (
    typeof q.unit !== 'string' ||
    !isKnownUnit(q.unit) ||
    !sameDimension(dimensionOf(q), TEMPERATURE_DIMENSION)
  ) {
    throw new KineticsError({
      code: 'invalid_input',
      operation,
      message: `температура должна иметь размерность кельвина, получена единица «${String(q.unit)}»`,
      details: 'ожидаемая единица: K'
    });
  }
  if (q.value <= 0) {
    throw new KineticsError({
      code: 'invalid_input',
      operation,
      message: `температура должна быть положительной, получено ${q.value} ${q.unit}`
    });
  }
  return convert(q, 'K').value;
}

/** k = A·(T/300)^n·exp(−Ea/(R·T)) по заявленной форме энергетического параметра. */
function arrheniusValue(p: ArrheniusParameters, temperatureK: number): number {
  const exponent =
    p.energy.form === 'E_over_R'
      ? p.energy.valueK / temperatureK
      : p.energy.valueJPerMol / (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * temperatureK);
  return (
    p.preExponentialA *
    Math.pow(temperatureK / ARRHENIUS_REFERENCE_TEMPERATURE_K, p.temperatureExponentN) *
    Math.exp(-exponent)
  );
}

/** Опции вычисления k. */
export interface RateConstantEvaluationOptions {
  /**
   * Концентрация третьего тела [M] в единицах concentrationModel записи
   * (molecule/cm³ или моль/м³). Обязательна для fall_off; запрещена для
   * arrhenius — аррениусовская запись не зависит от давления, давление-
   * зависимость выражается только fall_off параметризацией.
   */
  thirdBodyConcentration?: number;
}

/** Диагностика fall-off вычисления (вклады и аргументы формы). */
export interface FallOffDiagnostics {
  /** k0(T) в своей единице (порядок overallOrder + 1). */
  lowPressureLimit: number;
  /** k∞(T) в своей единице (порядок overallOrder — единица эффективной k). */
  highPressureLimit: number;
  /** Приведённое давление Pr = k0·[M]/k∞ (безразмерное). */
  reducedPressure: number;
  /** log10(Pr). */
  log10ReducedPressure: number;
  /** Фактор уширения F = Fc^(1/(1+(log10(Pr)/N)²)). */
  broadeningFactor: number;
}

/** Результат вычисления k(T) (или k([M],T) для fall_off). */
export interface RateConstantEvaluation {
  /** Эффективная константа скорости в единицах unit. */
  value: number;
  /** Единица k: для arrhenius — единица записи; для fall_off — единица k∞ (порядок overallOrder). */
  unit: RateConstantUnit;
  concentrationModel: ConcentrationModel;
  /** Статус данных known | estimated, перенесённый из записи. */
  dataStatus: 'known' | 'estimated';
  /** Метод оценки (заполняется только для estimated). */
  estimationMethod?: string;
  /** Температура, при которой вычислено значение, K. */
  temperatureK: number;
  /** Применённый диапазон применимости (для fall_off — пересечение диапазонов k0 и k∞). */
  appliedRangeK: { min: number; max: number };
  /** Неопределённость k записи (для fall_off не заполняется: комбинирование неопределённостей пределов не моделируется). */
  uncertainty?: Uncertainty;
  /** Происхождение применённой параметризации. */
  provenance?: DataProvenance;
  /** Для fall_off: вклады и аргументы формы. */
  fallOff?: FallOffDiagnostics;
}

/**
 * Вычисление константы скорости записи при заданной температуре
 * (и концентрации третьего тела для fall_off записей).
 *
 * Fail-closed: повреждённая запись — invalid_input со списком проблем;
 * unknown-константа — no_kinetic_data («не рассчитано»); температура
 * вне диапазона применимости — temperature_out_of_range без
 * экстраполяции; некорректная/отсутствующая [M] у fall-off записи —
 * invalid_third_body; неинтерпретируемый результат (0, NaN, ∞) —
 * numerical_failure. Фиктивных скоростей не возвращает.
 */
export function evaluateRateConstant(
  record: KineticReactionRecord,
  temperature: PhysicalQuantity,
  options?: RateConstantEvaluationOptions
): RateConstantEvaluation {
  const op = 'evaluateRateConstant';
  const problems = validateKineticReactionRecord(record);
  if (problems.length > 0) {
    throw new KineticsError({
      code: 'invalid_input',
      operation: op,
      message: 'запись кинетической реакции повреждена или не согласована',
      details: problems.join('; ')
    });
  }
  if (record.rateConstant.status === 'unknown') {
    const rate = record.rateConstant;
    throw new KineticsError({
      code: 'no_kinetic_data',
      operation: op,
      message:
        `скорость реакции «${record.id}» не рассчитана: данных нет` +
        (rate.note !== undefined ? ` (${rate.note})` : '')
    });
  }
  const rate = record.rateConstant;
  const dataStatus = rate.status;
  const estimationMethod = rate.status === 'estimated' ? rate.method : undefined;
  const T = temperatureInKelvin(temperature, op);
  const params = rate.parameters;
  if (params.kind === 'arrhenius') {
    if (options?.thirdBodyConcentration !== undefined) {
      throw new KineticsError({
        code: 'invalid_input',
        operation: op,
        message:
          'аррениусовская запись не зависит от давления: thirdBodyConcentration не применима ' +
          '(давление-зависимость выражается параметризацией fall_off)'
      });
    }
    const p = params.arrhenius;
    if (T < p.temperatureRangeK.min || T > p.temperatureRangeK.max) {
      throw new KineticsError({
        code: 'temperature_out_of_range',
        operation: op,
        message: `температура ${T} K вне диапазона применимости [${p.temperatureRangeK.min}, ${p.temperatureRangeK.max}] K записи «${record.id}»: экстраполяция запрещена`
      });
    }
    const k = arrheniusValue(p, T);
    if (!Number.isFinite(k) || k <= 0) {
      throw new KineticsError({
        code: 'numerical_failure',
        operation: op,
        message: `вычисление k(T) записи «${record.id}» при ${T} K дало неинтерпретируемое значение (${String(k)}): переполнение или исчезновение порядка`
      });
    }
    return {
      value: k,
      unit: p.unit,
      concentrationModel: record.concentrationModel,
      dataStatus,
      estimationMethod,
      temperatureK: T,
      appliedRangeK: { min: p.temperatureRangeK.min, max: p.temperatureRangeK.max },
      uncertainty: p.uncertainty,
      provenance: p.provenance
    };
  }
  const M = options?.thirdBodyConcentration;
  if (M === undefined) {
    throw new KineticsError({
      code: 'invalid_third_body',
      operation: op,
      message:
        `для fall-off записи «${record.id}» обязательна концентрация третьего тела [M] в единицах ` +
        (record.concentrationModel === 'molecule_cm3' ? 'molecule/cm³' : 'моль/м³')
    });
  }
  if (typeof M !== 'number' || !Number.isFinite(M) || M <= 0) {
    throw new KineticsError({
      code: 'invalid_third_body',
      operation: op,
      message: `концентрация третьего тела [M] должна быть конечным положительным числом, получено ${String(M)}`
    });
  }
  const fp = params.fallOff;
  const lo = fp.lowPressureLimit;
  const hi = fp.highPressureLimit;
  if (
    T < lo.temperatureRangeK.min ||
    T > lo.temperatureRangeK.max ||
    T < hi.temperatureRangeK.min ||
    T > hi.temperatureRangeK.max
  ) {
    throw new KineticsError({
      code: 'temperature_out_of_range',
      operation: op,
      message:
        `температура ${T} K вне диапазона применимости fall-off записи «${record.id}» ` +
        `(k0: [${lo.temperatureRangeK.min}, ${lo.temperatureRangeK.max}] K, k∞: [${hi.temperatureRangeK.min}, ${hi.temperatureRangeK.max}] K): экстраполяция запрещена`
    });
  }
  const k0 = arrheniusValue(lo, T);
  const kInf = arrheniusValue(hi, T);
  if (!Number.isFinite(k0) || k0 <= 0 || !Number.isFinite(kInf) || kInf <= 0) {
    throw new KineticsError({
      code: 'numerical_failure',
      operation: op,
      message: `вычисление пределов k0/k∞ записи «${record.id}» при ${T} K дало неинтерпретируемые значения (k0 = ${String(k0)}, k∞ = ${String(kInf)})`
    });
  }
  const pr = (k0 * M) / kInf;
  const log10Pr = Math.log10(pr);
  const f = Math.pow(fp.centeringFactorFc, 1 / (1 + (log10Pr / fp.broadeningN) ** 2));
  const k = ((k0 * M) / (1 + pr)) * f;
  if (!Number.isFinite(k) || k <= 0) {
    throw new KineticsError({
      code: 'numerical_failure',
      operation: op,
      message: `вычисление k([M],T) fall-off записи «${record.id}» дало неинтерпретируемое значение (${String(k)})`
    });
  }
  return {
    value: k,
    unit: hi.unit,
    concentrationModel: record.concentrationModel,
    dataStatus,
    estimationMethod,
    temperatureK: T,
    appliedRangeK: {
      min: Math.max(lo.temperatureRangeK.min, hi.temperatureRangeK.min),
      max: Math.min(lo.temperatureRangeK.max, hi.temperatureRangeK.max)
    },
    // Неопределённость эффективной fall-off константы из неопределённостей
    // пределов не выводится: правило комбинирования в 4.5.2 не
    // моделируется и не выдумывается — поле остаётся незаполненным.
    provenance: fp.provenance,
    fallOff: {
      lowPressureLimit: k0,
      highPressureLimit: kInf,
      reducedPressure: pr,
      log10ReducedPressure: log10Pr,
      broadeningFactor: f
    }
  };
}

// ============================================
// 6. ПРЕОБРАЗОВАНИЯ ЕДИНИЦ КИНЕТИЧЕСКОГО КОНТРАКТА
// ============================================

/**
 * Преобразование концентрации между моделями. Точная арифметика на
 * точной N_A: 1 molecule/cm³ = (1e6/N_A) моль/м³ (в 1 м³ — 1e6 см³, в
 * 1 моль — N_A частиц). Чистое преобразование единиц: знак и
 * величина не интерпретируются.
 */
export function convertConcentration(value: number, from: ConcentrationModel, to: ConcentrationModel): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new KineticsError({
      code: 'invalid_input',
      operation: 'convertConcentration',
      message: `значение концентрации должно быть конечным числом, получено ${String(value)}`
    });
  }
  if (
    !(CONCENTRATION_MODELS as readonly string[]).includes(String(from)) ||
    !(CONCENTRATION_MODELS as readonly string[]).includes(String(to))
  ) {
    throw new KineticsError({
      code: 'invalid_input',
      operation: 'convertConcentration',
      message: `модель концентраций должна быть molecule_cm3 | mol_m3, получено «${String(from)}» → «${String(to)}»`
    });
  }
  if (from === to) {
    return value;
  }
  return from === 'molecule_cm3' ? (value * 1e6) / AVOGADRO_NUMBER_PER_MOL : (value * AVOGADRO_NUMBER_PER_MOL) / 1e6;
}

/**
 * Преобразование константы скорости между единицами контракта.
 * Точная арифметика на точной N_A:
 * - порядок 2: 1 cm³/(molecule·s) = N_A·1e-6 м³/(моль·с)
 *   (1 см³ = 1e-6 м³; «на молекулу» = «на 1/N_A моля» ⇒ множитель N_A);
 * - порядок 3: 1 cm⁶/(molecule²·s) = N_A²·1e-12 м⁶/(моль²·с);
 * - порядок 1 (per_s): единица общая, преобразование — тождество.
 */
export function convertRateConstantUnit(value: number, from: RateConstantUnit, to: RateConstantUnit): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new KineticsError({
      code: 'invalid_input',
      operation: 'convertRateConstantUnit',
      message: `значение константы скорости должно быть конечным числом, получено ${String(value)}`
    });
  }
  if (
    !(RATE_CONSTANT_UNITS as readonly string[]).includes(String(from)) ||
    !(RATE_CONSTANT_UNITS as readonly string[]).includes(String(to))
  ) {
    throw new KineticsError({
      code: 'invalid_input',
      operation: 'convertRateConstantUnit',
      message: `единица k должна быть из кинетического реестра, получено «${String(from)}» → «${String(to)}»`
    });
  }
  if (from === to) {
    return value;
  }
  const fromSpec = RATE_CONSTANT_UNIT_SPECS[from as RateConstantUnit];
  const toSpec = RATE_CONSTANT_UNIT_SPECS[to as RateConstantUnit];
  if (fromSpec.order !== toSpec.order) {
    throw new KineticsError({
      code: 'invalid_input',
      operation: 'convertRateConstantUnit',
      message: `порядок не преобразуется: «${from}» — порядок ${fromSpec.order}, «${to}» — порядок ${toSpec.order}`
    });
  }
  const toMol = fromSpec.model === 'molecule_cm3' && toSpec.model === 'mol_m3';
  const toMolecule = fromSpec.model === 'mol_m3' && toSpec.model === 'molecule_cm3';
  if (!toMol && !toMolecule) {
    throw new KineticsError({
      code: 'invalid_input',
      operation: 'convertRateConstantUnit',
      message: `единицы «${from}» и «${to}» не сопоставимы прямым преобразованием`
    });
  }
  const factor =
    fromSpec.order === 2 ? AVOGADRO_NUMBER_PER_MOL * 1e-6 : AVOGADRO_NUMBER_PER_MOL ** 2 * 1e-12;
  return toMol ? value * factor : value / factor;
}

// ============================================
// 7. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Stage 4.5.1–4.5.2 — контракты записей и вычислитель k(T).
// ODE-решатель (BDF/Radau, адаптивный шаг, якобиан, контроль
// локальной ошибки, неотрицательность с журналированием,
// регистрация как SolverBackend) — 4.5.3. Каталог JPL Evaluation
// No. 20 с per-record сверкой по JPL Publication 25-1 — 4.5.4.
// Сборка механизмов (RHS/якобиан сети, инварианты на шаге,
// расширение runKineticStep без неявного solveEquilibrium) — 4.5.5.
// Обратные реакции через K(T) (термодинамическое согласование при
// наличии ΔG данных), фотохимия, поверхностные реакции — по мере
// данных в других подэтапах (см. docs/science/CHEMISTRY_ARCHITECTURE.md
// §4, §5.2, §5.3).
