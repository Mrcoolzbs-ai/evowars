// ============================================
// THERMO FUNCTIONS - Вычислитель термодинамических функций
// из NASA-7 полиномов (Stage 4.3.4)
// ============================================
//
// Контракт Stage 4.3.4 (зависимость Stage 4.4 «Химическое
// равновесие», заявленная в дорожной карте как оставшийся пункт
// 4.3): вычислитель термодинамических функций Cp°(T), H°(T),
// S°(T), G°(T) из параметризации NASA-7 записи термодинамики
// вида.
//
// Принципы:
// - вычисляются ОБЕ математические формы параметризации:
//   nasa_cea (семь коэффициентов Cp°/R при степенях T от -2 до
//   +4 и отдельные интегральные константы a8/a9) и nasa7_classic
//   (пять коэффициентов Cp°/R при T^0..T^4 и константы a5/a6 в
//   хвосте массива coefficients); NASA-9 в реестре форм нет и
//   здесь не поддерживается;
// - диапазон применимости — это часть контракта данных, а не
//   деталь реализации: температура ВНЕ диапазона сегментов —
//   это отказ (fail-closed, ошибка temperature_out_of_range),
//   а НЕ экстраполяция и НЕ молчаливое ближайшее значение;
// - выбор сегмента детерминирован: первый по порядку сегмент,
//   чей диапазон содержит температуру (включительно); на общем
//   стыке сегментов это сегмент с меньшим диапазоном температур;
//   непрерывность на стыках проверяется тестами по данным
//   каталога, а не предполагается;
// - все значения возвращаются как размерные PhysicalQuantity:
//   Cp° и S° в J/(mol·K), H° и G° в J/mol; безразмерные
//   Cp°/R, H°/R, S°/R экспортируются отдельными функциями
//   (полезно для валидации и решателей);
// - G°(T) = H°(T) − T·S°(T) — стандартная энергия Гиббса при
//   температуре T и стандартном состоянии записи; ДАВЛЕНИЕ
//   стандартного состояния записью NASA CEA не задаётся, и
//   вычислитель его не изобретает: конвенция коэффициентов
//   каталога (S° при 1 бар) зафиксирована кросс-чеком S°(298.15)
//   против справочных значений (см. тесты);
// - вход проверяется на каждом вызове: температура — конечная
//   положительная величина размерности кельвина; сегмент —
//   известная форма, семь конечных коэффициентов, у nasa_cea
//   конечные интегральные константы; повреждённые данные —
//   ошибка invalid_input, а не NaN в ответе;
// - отсутствующие данные (нет блока термодинамики, нет NASA-7
//   параметризации) — ошибка no_thermodynamic_data: «решатель
//   без данных — генератор unknown» — вычислитель не подставляет
//   нули и не притворяется, что посчитал.
//
// Этот модуль НЕ меняет данные каталога: поля S°/ΔfG° записей
// остаются unknown со своими пояснениями (их заполнение —
// отдельный будущий подэтап); вычислитель считает функции из
// сегментов NASA-7 на лету.

import type { PhysicalQuantity } from './physicalQuantity';
import { quantity, convert, dimension, isKnownUnit, dimensionOf, sameDimension } from './physicalQuantity';
import type { NasaPolynomialSegment, Nasa7Polynomial, ThermodynamicProperties } from './thermodynamics';
import { NASA_POLYNOMIAL_FORMS } from './thermodynamics';

// ============================================
// 1. КОНСТАНТА И ОШИБКА
// ============================================

/**
 * Универсальная газовая постоянная R, Дж/(моль·К).
 * Точное значение по определению СИ 2019: постоянная Больцмана
 * k = 1.380649e-23 Дж/К и постоянная Авогадро N_A =
 * 6.02214076e23 1/моль определены точно, поэтому R = k·N_A
 * точно равна 8.31446261815324 Дж/(моль·К).
 */
export const UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K = 8.31446261815324;

/** Ожидаемая размерность температуры. */
const TEMPERATURE_DIMENSION = dimension(0, 0, 0, 1);

/** Коды ошибок вычислителя. */
export type ThermoFunctionsErrorCode =
  | 'invalid_input'          // повреждённые данные/вход (форма, коэффициенты, NaN, размерность)
  | 'temperature_out_of_range' // T вне диапазона применимости всех сегментов
  | 'no_thermodynamic_data'; // у вида нет NASA-7 параметризации/блока термодинамики

/** Ошибка вычислителя термодинамических функций. */
export class ThermoFunctionsError extends Error {
  readonly code: ThermoFunctionsErrorCode;
  readonly operation: string;
  readonly expected?: string;
  readonly actual?: string;

  constructor(args: {
    code: ThermoFunctionsErrorCode;
    operation: string;
    message: string;
    expected?: string;
    actual?: string;
  }) {
    super(
      `[thermoFunctions/${args.operation}] ${args.message}` +
        (args.expected !== undefined ? ` (ожидалось: ${args.expected})` : '') +
        (args.actual !== undefined ? ` (фактически: ${args.actual})` : '')
    );
    this.name = 'ThermoFunctionsError';
    this.code = args.code;
    this.operation = args.operation;
    this.expected = args.expected;
    this.actual = args.actual;
  }
}

// ============================================
// 2. ПРОВЕРКА ВХОДА
// ============================================

/**
 * Температура в кельвинах: конечная, положительная, размерности
 * температуры. Принимает величину в любой зарегистрированной
 * единице температурной размерности (в реестре проекта это K) и
 * возвращает число в кельвинах.
 */
function temperatureInKelvin(temperature: PhysicalQuantity, operation: string): number {
  if (temperature === null || typeof temperature !== 'object') {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation,
      message: 'температура должна быть величиной {value, unit}',
      actual: String(temperature)
    });
  }
  const q = temperature as PhysicalQuantity;
  if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation,
      message: `значение температуры должно быть конечным числом, получено ${String(q.value)}`
    });
  }
  if (typeof q.unit !== 'string' || !isKnownUnit(q.unit) || !sameDimension(dimensionOf(q), TEMPERATURE_DIMENSION)) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation,
      message: `температура должна иметь размерность кельвина, получена единица «${String(q.unit)}»`,
      expected: 'K'
    });
  }
  if (q.value <= 0) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation,
      message: `температура должна быть положительной, получено ${q.value}`,
      actual: `${q.value} ${q.unit}`
    });
  }
  const inK = convert(q, 'K');
  return inK.value;
}

/**
 * Проверка сегмента: известная форма, ровно семь конечных
 * коэффициентов, у nasa_cea — конечные интегральные константы,
 * конечный корректный диапазон. Бросает ThermoFunctionsError
 * (invalid_input) на повреждённом сегменте — вычислитель не
 * подставляет значения и не пропускает молча.
 */
function validateSegment(segment: NasaPolynomialSegment, operation: string): void {
  if (segment === null || typeof segment !== 'object') {
    throw new ThermoFunctionsError({ code: 'invalid_input', operation, message: 'сегмент должен быть объектом' });
  }
  if (segment.form !== 'nasa_cea' && segment.form !== 'nasa7_classic') {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation,
      message: `неизвестная форма полинома «${String((segment as { form?: unknown }).form)}»`,
      expected: NASA_POLYNOMIAL_FORMS.join(' | ')
    });
  }
  const coefficients = (segment as { coefficients?: unknown }).coefficients;
  if (!Array.isArray(coefficients) || coefficients.length !== 7) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation,
      message: `сегмент обязан иметь ровно семь коэффициентов, получено ${Array.isArray(coefficients) ? coefficients.length : 'не массив'}`
    });
  }
  for (let i = 0; i < 7; i++) {
    const c = coefficients[i] as unknown;
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      throw new ThermoFunctionsError({
        code: 'invalid_input',
        operation,
        message: `коэффициент ${i} обязан быть конечным числом, получено ${String(c)}`
      });
    }
  }
  if (segment.form === 'nasa_cea') {
    const ic = (segment as { integralConstants?: unknown }).integralConstants;
    if (ic === null || typeof ic !== 'object') {
      throw new ThermoFunctionsError({
        code: 'invalid_input',
        operation,
        message: 'форма nasa_cea требует объект integralConstants (a8/a9)'
      });
    }
    const rec = ic as Record<string, unknown>;
    for (const key of ['enthalpyConstantOverR', 'entropyConstantOverR']) {
      const v = rec[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new ThermoFunctionsError({
          code: 'invalid_input',
          operation,
          message: `интегральная константа ${key} обязана быть конечным числом, получено ${String(v)}`
        });
      }
    }
  }
  const range = (segment as { rangeK?: unknown }).rangeK;
  if (range === null || typeof range !== 'object') {
    throw new ThermoFunctionsError({ code: 'invalid_input', operation, message: 'сегмент обязан иметь диапазон rangeK {min, max}' });
  }
}

/** Границы диапазона сегмента в кельвинах (числа). */
function segmentRangeKelvin(segment: NasaPolynomialSegment, operation: string): { minK: number; maxK: number } {
  const range = (segment as { rangeK: { min: PhysicalQuantity; max: PhysicalQuantity } }).rangeK;
  const min = range && typeof range === 'object' ? range.min : null;
  const max = range && typeof range === 'object' ? range.max : null;
  if (min === null || min === undefined || max === null || max === undefined) {
    throw new ThermoFunctionsError({ code: 'invalid_input', operation, message: 'диапазон rangeK обязан содержать min и max' });
  }
  let minK: number, maxK: number;
  try {
    minK = convert(min as PhysicalQuantity, 'K').value;
    maxK = convert(max as PhysicalQuantity, 'K').value;
  } catch {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation,
      message: `границы диапазона сегмента обязаны быть величинами температурной размерности, получено «${String((min as PhysicalQuantity).unit)}»/«${String((max as PhysicalQuantity).unit)}»`,
      expected: 'K'
    });
  }
  if (!Number.isFinite(minK) || !Number.isFinite(maxK) || !(minK < maxK)) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation,
      message: `диапазон сегмента обязан удовлетворять min < max в кельвинах, получено [${minK}, ${maxK}]`
    });
  }
  return { minK, maxK };
}

// ============================================
// 3. ФУНКЦИИ СЕГМЕНТА (БЕЗРАЗМЕРНЫЕ)
// ============================================
//
// nasa_cea (коэффициенты a1..a7 при степенях T^-2..T^+4,
// интегральные константы a8 = enthalpyConstantOverR,
// a9 = entropyConstantOverR):
//   Cp°/R = Σ_{k=1..7} a_k·T^(k-3)
//   H°/R  = -a1/T + a2·lnT + a3·T + a4·T²/2 + a5·T³/3 + a6·T⁴/4 + a7·T⁵/5 + a8
//   S°/R  = -a1/(2T²) - a2/T + a3·lnT + a4·T + a5·T²/2 + a6·T³/3 + a7·T⁴/4 + a9
// nasa7_classic (коэффициенты a0..a4 при степенях T^0..T^4,
// константы a5 (энтальпийная) и a6 (энтропийная) в хвосте):
//   Cp°/R = a0 + a1·T + a2·T² + a3·T³ + a4·T⁴
//   H°/R  = a5 + a0·T + a1·T²/2 + a2·T³/3 + a3·T⁴/4 + a4·T⁵/5
//   S°/R  = a6 + a0·lnT + a1·T + a2·T²/2 + a3·T³/3 + a4·T⁴/4

/** Cp°(T)/R сегмента (безразмерное). T — в кельвинах, внутри диапазона. */
export function nasaSegmentCpOverR(segment: NasaPolynomialSegment, temperatureK: number): number {
  const op = 'nasaSegmentCpOverR';
  validateSegment(segment, op);
  if (typeof temperatureK !== 'number' || !Number.isFinite(temperatureK) || temperatureK <= 0) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation: op,
      message: `температура (К) должна быть конечным положительным числом, получено ${String(temperatureK)}`
    });
  }
  const a = (segment as { coefficients: number[] }).coefficients;
  if (segment.form === 'nasa_cea') {
    let v = 0;
    for (let k = 0; k < 7; k++) v += a[k] * Math.pow(temperatureK, k - 2);
    return v;
  }
  let v = 0;
  for (let k = 0; k < 5; k++) v += a[k] * Math.pow(temperatureK, k);
  return v;
}

/** H°(T)/R сегмента (безразмерное). */
export function nasaSegmentEnthalpyOverR(segment: NasaPolynomialSegment, temperatureK: number): number {
  const op = 'nasaSegmentEnthalpyOverR';
  validateSegment(segment, op);
  if (typeof temperatureK !== 'number' || !Number.isFinite(temperatureK) || temperatureK <= 0) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation: op,
      message: `температура (К) должна быть конечным положительным числом, получено ${String(temperatureK)}`
    });
  }
  const a = (segment as { coefficients: number[] }).coefficients;
  const T = temperatureK;
  if (segment.form === 'nasa_cea') {
    const ic = (segment as { integralConstants: { enthalpyConstantOverR: number } }).integralConstants;
    return (
      -a[0] / T + a[1] * Math.log(T) + a[2] * T + (a[3] * T * T) / 2 +
      (a[4] * Math.pow(T, 3)) / 3 + (a[5] * Math.pow(T, 4)) / 4 + (a[6] * Math.pow(T, 5)) / 5 +
      ic.enthalpyConstantOverR
    );
  }
  return (
    a[5] + a[0] * T + (a[1] * T * T) / 2 + (a[2] * Math.pow(T, 3)) / 3 +
    (a[3] * Math.pow(T, 4)) / 4 + (a[4] * Math.pow(T, 5)) / 5
  );
}

/** S°(T)/R сегмента (безразмерное). */
export function nasaSegmentEntropyOverR(segment: NasaPolynomialSegment, temperatureK: number): number {
  const op = 'nasaSegmentEntropyOverR';
  validateSegment(segment, op);
  if (typeof temperatureK !== 'number' || !Number.isFinite(temperatureK) || temperatureK <= 0) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation: op,
      message: `температура (К) должна быть конечным положительным числом, получено ${String(temperatureK)}`
    });
  }
  const a = (segment as { coefficients: number[] }).coefficients;
  const T = temperatureK;
  if (segment.form === 'nasa_cea') {
    const ic = (segment as { integralConstants: { entropyConstantOverR: number } }).integralConstants;
    return (
      -a[0] / (2 * T * T) - a[1] / T + a[2] * Math.log(T) + a[3] * T +
      (a[4] * T * T) / 2 + (a[5] * Math.pow(T, 3)) / 3 + (a[6] * Math.pow(T, 4)) / 4 +
      ic.entropyConstantOverR
    );
  }
  return (
    a[6] + a[0] * Math.log(T) + a[1] * T + (a[2] * T * T) / 2 +
    (a[3] * Math.pow(T, 3)) / 3 + (a[4] * Math.pow(T, 4)) / 4
  );
}

// ============================================
// 4. ФУНКЦИИ СЕГМЕНТА (РАЗМЕРНЫЕ)
// ============================================

/** Cp°(T) сегмента, Дж/(моль·К) (единица J_mol_K). */
export function nasaSegmentCp(segment: NasaPolynomialSegment, temperature: PhysicalQuantity): PhysicalQuantity {
  const T = temperatureInKelvin(temperature, 'nasaSegmentCp');
  return quantity(nasaSegmentCpOverR(segment, T) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K, 'J_mol_K');
}

/** H°(T) сегмента, Дж/моль (единица J_mol). */
export function nasaSegmentEnthalpy(segment: NasaPolynomialSegment, temperature: PhysicalQuantity): PhysicalQuantity {
  const T = temperatureInKelvin(temperature, 'nasaSegmentEnthalpy');
  return quantity(nasaSegmentEnthalpyOverR(segment, T) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K, 'J_mol');
}

/** S°(T) сегмента, Дж/(моль·К) (единица J_mol_K). */
export function nasaSegmentEntropy(segment: NasaPolynomialSegment, temperature: PhysicalQuantity): PhysicalQuantity {
  const T = temperatureInKelvin(temperature, 'nasaSegmentEntropy');
  return quantity(nasaSegmentEntropyOverR(segment, T) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K, 'J_mol_K');
}

/**
 * G°(T) сегмента, Дж/моль: G° = H° − T·S°. Возвращается в
 * единицах J_mol.
 */
export function nasaSegmentGibbsEnergy(segment: NasaPolynomialSegment, temperature: PhysicalQuantity): PhysicalQuantity {
  const T = temperatureInKelvin(temperature, 'nasaSegmentGibbsEnergy');
  const hOverR = nasaSegmentEnthalpyOverR(segment, T);
  const sOverR = nasaSegmentEntropyOverR(segment, T);
  return quantity((hOverR - sOverR * T) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K, 'J_mol');
}

// ============================================
// 5. ФУНКЦИИ ПАРАМЕТРИЗАЦИИ (ВЫБОР СЕГМЕНТА)
// ============================================

/**
 * Первый по порядку сегмент параметризации, чей диапазон содержит
 * температуру (границы включаются; на общем стыке — сегмент с
 * меньшими температурами). null, если температура вне всех
 * диапазонов. Детерминирован: порядок сегментов фиксирован
 * валидатором (упорядочены, без пересечений, кроме стыков).
 */
export function findNasaSegment(
  nasa7: Nasa7Polynomial,
  temperature: PhysicalQuantity
): NasaPolynomialSegment | null {
  const T = temperatureInKelvin(temperature, 'findNasaSegment');
  if (nasa7 === null || typeof nasa7 !== 'object' || !Array.isArray(nasa7.segments) || nasa7.segments.length === 0) {
    throw new ThermoFunctionsError({
      code: 'invalid_input',
      operation: 'findNasaSegment',
      message: 'параметризация NASA-7 обязана быть объектом с непустым массивом segments'
    });
  }
  for (const segment of nasa7.segments) {
    validateSegment(segment, 'findNasaSegment');
    const { minK, maxK } = segmentRangeKelvin(segment, 'findNasaSegment');
    if (T >= minK && T <= maxK) return segment;
  }
  return null;
}

/**
 * Универсальный вызов на уровне параметризации: выбирает сегмент
 * и вычисляет функцию; при температуре вне всех диапазонов —
 * ошибка temperature_out_of_range с перечислением диапазонов
 * (fail-closed: экстраполяции нет).
 */
function withSegment<T>(
  nasa7: Nasa7Polynomial,
  temperature: PhysicalQuantity,
  operation: string,
  compute: (segment: NasaPolynomialSegment, temperatureK: number) => T
): T {
  const segment = findNasaSegment(nasa7, temperature);
  if (segment === null) {
    const temperatureK = temperatureInKelvin(temperature, operation);
    const ranges = nasa7.segments
      .map((s) => {
        const { minK, maxK } = segmentRangeKelvin(s, operation);
        return `${minK}–${maxK} K`;
      })
      .join(', ');
    throw new ThermoFunctionsError({
      code: 'temperature_out_of_range',
      operation,
      message: `температура ${temperatureK} K вне диапазона применимости всех сегментов (${ranges}): экстраполяция запрещена`
    });
  }
  const temperatureK = temperatureInKelvin(temperature, operation);
  return compute(segment, temperatureK);
}

/** Cp°(T) из NASA-7 параметризации, Дж/(моль·К). */
export function nasaCp(nasa7: Nasa7Polynomial, temperature: PhysicalQuantity): PhysicalQuantity {
  return withSegment(nasa7, temperature, 'nasaCp', (s, T) =>
    quantity(nasaSegmentCpOverR(s, T) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K, 'J_mol_K')
  );
}

/** H°(T) из NASA-7 параметризации, Дж/моль. */
export function nasaStandardEnthalpy(nasa7: Nasa7Polynomial, temperature: PhysicalQuantity): PhysicalQuantity {
  return withSegment(nasa7, temperature, 'nasaStandardEnthalpy', (s, T) =>
    quantity(nasaSegmentEnthalpyOverR(s, T) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K, 'J_mol')
  );
}

/** S°(T) из NASA-7 параметризации, Дж/(моль·К). */
export function nasaStandardEntropy(nasa7: Nasa7Polynomial, temperature: PhysicalQuantity): PhysicalQuantity {
  return withSegment(nasa7, temperature, 'nasaStandardEntropy', (s, T) =>
    quantity(nasaSegmentEntropyOverR(s, T) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K, 'J_mol_K')
  );
}

/** G°(T) из NASA-7 параметризации, Дж/моль. */
export function nasaStandardGibbsEnergy(nasa7: Nasa7Polynomial, temperature: PhysicalQuantity): PhysicalQuantity {
  return withSegment(nasa7, temperature, 'nasaStandardGibbsEnergy', (s, T) =>
    quantity(
      (nasaSegmentEnthalpyOverR(s, T) - nasaSegmentEntropyOverR(s, T) * T) * UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K,
      'J_mol'
    )
  );
}

// ============================================
// 6. ФУНКЦИИ ЗАПИСИ ВИДА (FAIL-CLOSED)
// ============================================

/**
 * NASA-7 параметризация блока термодинамики вида или ошибка
 * no_thermodynamic_data: вычислитель не подставляет значения,
 * когда параметризации нет (unknown/отсутствует — это отсутствие
 * данных, а не нули).
 */
export function requireNasa7(thermo: ThermodynamicProperties, operation: string): Nasa7Polynomial {
  if (thermo === null || typeof thermo !== 'object') {
    throw new ThermoFunctionsError({
      code: 'no_thermodynamic_data',
      operation,
      message: 'блок термодинамики отсутствует или повреждён: вычисление невозможно без подстановки'
    });
  }
  const hc = (thermo as { heatCapacity?: { status?: unknown; nasa7?: unknown } }).heatCapacity;
  const nasa7 = hc && typeof hc === 'object' ? (hc as { nasa7?: Nasa7Polynomial }).nasa7 : undefined;
  if (nasa7 === null || nasa7 === undefined || typeof nasa7 !== 'object') {
    throw new ThermoFunctionsError({
      code: 'no_thermodynamic_data',
      operation,
      message: 'у вида нет NASA-7 параметризации теплоёмкости: термодинамические функции при произвольной T не предоставлены и не вычисляются'
    });
  }
  return nasa7;
}

/** G°(T) записи вида (из NASA-7), Дж/моль. */
export function speciesStandardGibbsEnergy(thermo: ThermodynamicProperties, temperature: PhysicalQuantity): PhysicalQuantity {
  const nasa7 = requireNasa7(thermo, 'speciesStandardGibbsEnergy');
  return nasaStandardGibbsEnergy(nasa7, temperature);
}

/**
 * G°(T)/(R·T) записи вида — безразмерный аргумент, которым оперирует
 * равновесный решатель (Stage 4.4): g_i°/(R·T) = H°/(R·T) − S°/R.
 */
export function speciesStandardGibbsEnergyOverRT(thermo: ThermodynamicProperties, temperature: PhysicalQuantity): number {
  const nasa7 = requireNasa7(thermo, 'speciesStandardGibbsEnergyOverRT');
  return withSegment(nasa7, temperature, 'speciesStandardGibbsEnergyOverRT', (s, T) =>
    nasaSegmentEnthalpyOverR(s, T) / T - nasaSegmentEntropyOverR(s, T)
  );
}

/** Cp°(T) записи вида (из NASA-7), Дж/(моль·К). */
export function speciesCp(thermo: ThermodynamicProperties, temperature: PhysicalQuantity): PhysicalQuantity {
  const nasa7 = requireNasa7(thermo, 'speciesCp');
  return nasaCp(nasa7, temperature);
}

/** H°(T) записи вида (из NASA-7), Дж/моль. */
export function speciesStandardEnthalpy(thermo: ThermodynamicProperties, temperature: PhysicalQuantity): PhysicalQuantity {
  const nasa7 = requireNasa7(thermo, 'speciesStandardEnthalpy');
  return nasaStandardEnthalpy(nasa7, temperature);
}

/** S°(T) записи вида (из NASA-7), Дж/(моль·К). */
export function speciesStandardEntropy(thermo: ThermodynamicProperties, temperature: PhysicalQuantity): PhysicalQuantity {
  const nasa7 = requireNasa7(thermo, 'speciesStandardEntropy');
  return nasaStandardEntropy(nasa7, temperature);
}
