// ============================================
// RESERVOIR - Материальные и энергетические резервуары
// ============================================
//
// Универсальный контракт резервуаров ядра (Stage 4.1).
//
// Резервуар — подсистема мира (атмосфера, океан, лёд, кора, мантия,
// ядро, аэрозоли, осадки, ...), между которыми переносятся вещество
// и энергия. Набор резервуаров расширяемый: kind — строка, а не
// закрытый enum, чтобы будущие типы планет не требовали переделки.
//
// Главные правила материального инвентаря:
// - основание представления количества (basis) задаётся ЯВНО и
//   единообразно для всего инвентаря одного резервуара;
// - разные basis НЕ складываются: моль ≠ кг, моль/м² ≠ моль,
//   концентрация ≠ полный запас;
// - перевод количества вещества в массу выполняется ТОЛЬКО явно
//   (amountToMass) и ТОЛЬКО при известной молярной массе;
// - концентрация НЕ переводится в полный запас автоматически:
//   для этого нужен объём/геометрия, которых контракт не изобретает;
// - запасы вещества неотрицательны: отрицательный остаток невозможен
//   (в отличие от потоков, где знак имеет физический смысл);
// - 'arbitrary_units' — нормированные игровые единицы легаси
//   химической эволюции: несовместимы ни с одним физическим basis
//   и существуют, чтобы честно представлять «абсолютное количество
//   неизвестно» вместо подмены физикой.
//
// Энергетический инвентарь отделён от материального:
// запас энергии (J) ≠ мощность (W) ≠ поток на площадь (W/m²) ≠
// энергия, переданная за интервал. Резервуар сам по себе материю
// не создаёт и не уничтожает: переносы фиксируются в FluxLedger.

import type { PhysicalQuantity } from './physicalQuantity';
import { assertDimension, convert, dimension, QuantityError } from './physicalQuantity';
import type { ScientificValue } from './scientificValue';
import { validateScientificValueShape } from './scientificValue';

// ============================================
// 1. ОСНОВАНИЯ ИНВЕНТАРЯ
// ============================================

/**
 * Основание представления количества вещества.
 * Каждое основание — своя физическая величина; они не взаимозаменяемы.
 */
export type InventoryBasis =
  | 'amount'               // полное количество вещества, моль
  | 'mass'                 // полная масса, кг
  | 'column_amount'        // количество вещества на площадь, моль/м²
  | 'column_mass'          // масса на площадь, кг/м²
  | 'molar_concentration'  // моль/м³
  | 'mass_concentration'   // кг/м³
  | 'molar_fraction'       // молярная доля, безразмерна
  | 'mass_fraction'        // массовая доля, безразмерна
  | 'arbitrary_units';     // нормированные игровые единицы (легаси); физике не соответствует

/** Физическая размерность, соответствующая основанию (для валидации). */
export const BASIS_DIMENSIONS: Partial<Record<InventoryBasis, { dimensionOf: ReturnType<typeof dimension>; unit: string }>> = {
  amount: { dimensionOf: dimension(0, 0, 0, 0, 0, 1), unit: 'mol' },
  mass: { dimensionOf: dimension(1), unit: 'kg' },
  column_amount: { dimensionOf: dimension(0, -2, 0, 0, 0, 1), unit: 'mol_m2' },
  column_mass: { dimensionOf: dimension(1, -2), unit: 'kg_m2' },
  molar_concentration: { dimensionOf: dimension(0, -3, 0, 0, 0, 1), unit: 'mol_m3' },
  mass_concentration: { dimensionOf: dimension(1, -3), unit: 'kg_m3' },
  molar_fraction: { dimensionOf: dimension(), unit: '1' },
  mass_fraction: { dimensionOf: dimension(), unit: '1' }
  // arbitrary_units: физической размерности нет — потому и несовместим
};

/**
 * Основания инвентаря, известные ядру (Stage 4.1.1).
 * Runtime-список для валидации данных из JSON: основание может
 * прийти из сохранения или внешнего источника и содержать мусор.
 */
export const INVENTORY_BASES: readonly InventoryBasis[] = [
  'amount',
  'mass',
  'column_amount',
  'column_mass',
  'molar_concentration',
  'mass_concentration',
  'molar_fraction',
  'mass_fraction',
  'arbitrary_units'
];

/** Известно ли основание инвентаря ядру. */
export function isKnownBasis(basis: string): basis is InventoryBasis {
  return (INVENTORY_BASES as readonly string[]).includes(basis);
}

/**
 * Проверка значения как объекта-записи (именованного словаря) для
 * runtime-данных (Stage 4.1.1.3, ISSUE B): у массива typeof тоже
 * 'object', поэтому массивы исключаются ЯВНО. properties и
 * material.entries — словари (speciesId → значение), а не массивы:
 * пустой массив не равен пустому словарю и не принимается за
 * «известную пустоту». Пустой обычный объект {} остаётся допустимым.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Проверка молярной массы перед преобразованием (Stage 4.1.1):
 * null/NaN/∞/отрицательная масса не пригодны для перевода
 * моль ↔ кг и не «зануляются».
 */
function requireMolarMass(molarMassKgMol: number, operation: string): void {
  if (!Number.isFinite(molarMassKgMol) || molarMassKgMol <= 0) {
    throw new QuantityError({
      code: 'invalid_number',
      component: 'Reservoir',
      operation,
      message: `молярная масса должна быть конечным положительным числом (кг/моль), получено ${molarMassKgMol}`
    });
  }
}

/**
 * Явное преобразование количества вещества (моль) в массу (кг).
 * Требует молярной массы; без неё преобразование невозможно.
 *
 * Stage 4.1.1: количество переводится в моли ЯВНО (convert) ДО
 * умножения — единица входа может быть любой когерентной единицей
 * количества вещества. Результат проверяется на переполнение.
 */
export function amountToMass(amount: PhysicalQuantity, molarMassKgMol: number): PhysicalQuantity {
  assertDimension(amount, dimension(0, 0, 0, 0, 0, 1), 'amountToMass', 'Reservoir');
  requireMolarMass(molarMassKgMol, 'amountToMass');
  const mol = convert(amount, 'mol').value;
  const value = mol * molarMassKgMol;
  if (!Number.isFinite(value)) {
    throw new QuantityError({
      code: 'overflow',
      component: 'Reservoir',
      operation: 'amountToMass',
      message: `результат непредставим: ${mol} моль × ${molarMassKgMol} кг/моль`
    });
  }
  return { value, unit: 'kg' };
}

/**
 * Явное обратное преобразование массы в количество вещества.
 *
 * Stage 4.1.1 (исправление Issue 1): масса переводится в килограммы
 * (convert) ДО деления на кг/моль. До исправления делилось сырое
 * число: 1000 г / 0.018 кг/моль давало «55555 моль» — в 1000 раз
 * больше физического значения (1000 г = 1 кг → 55.56 моль).
 * Переполнение результата диагностируется явно.
 */
export function massToAmount(mass: PhysicalQuantity, molarMassKgMol: number): PhysicalQuantity {
  assertDimension(mass, dimension(1), 'massToAmount', 'Reservoir');
  requireMolarMass(molarMassKgMol, 'massToAmount');
  const kg = convert(mass, 'kg').value;
  const value = kg / molarMassKgMol;
  if (!Number.isFinite(value)) {
    throw new QuantityError({
      code: 'overflow',
      component: 'Reservoir',
      operation: 'massToAmount',
      message: `результат непредставим: ${kg} кг / ${molarMassKgMol} кг/моль`
    });
  }
  return { value, unit: 'mol' };
}

// ============================================
// 2. МАТЕРИАЛЬНЫЙ ИНВЕНТАРЬ
// ============================================

/** Инвентарь химических видов в одном явном основании. */
export interface MaterialInventory {
  basis: InventoryBasis;
  /** speciesId → количество в единицах основания. */
  entries: Record<string, number>;
}

export interface MaterialInventoryValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Валидация материального инвентаря (Stage 4.1.1):
 * - основание известно реестру (данные из JSON могут содержать мусор);
 * - числа конечны и неотрицательны (отрицательный запас невозможен);
 * - для долей дополнительно: сумма долей не обязана быть 1
 *   (инвентарь может быть частичным), это не ошибка, а контракт поля;
 * - Stage 4.1.1.3 (ISSUE B): entries — объект-запись
 *   (speciesId → количество), НЕ массив: пустой массив не является
 *   «известным пустым инвентарём» и отвергается явно.
 */
export function validateMaterialInventory(inv: MaterialInventory): MaterialInventoryValidation {
  const errors: string[] = [];
  if (!isKnownBasis(inv.basis)) {
    errors.push(`неизвестное основание инвентаря «${String(inv.basis)}»`);
  }
  if (!isPlainRecord(inv.entries)) {
    errors.push(
      `material.entries должен быть объектом-словарём (speciesId → количество), а не массивом/null: получено ${
        inv.entries === null ? 'null' : Array.isArray(inv.entries) ? 'массив' : typeof inv.entries
      }`
    );
    return { valid: false, errors };
  }
  for (const [id, amount] of Object.entries(inv.entries as Record<string, number>)) {
    if (!Number.isFinite(amount)) {
      errors.push(`количество вида «${id}» должно быть конечным числом, получено ${amount}`);
    } else if (amount < 0) {
      errors.push(`отрицательный запас вида «${id}» невозможен: ${amount}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// ============================================
// 3. ЭНЕРГЕТИЧЕСКИЙ ИНВЕНТАРЬ
// ============================================

/**
 * Энергетический инвентарь. Величины с разными размерностями
 * хранятся в ОТДЕЛЬНЫХ полях и не сводятся к одному числу:
 * - storedJ — запас энергии (Дж);
 * - netPowerW — средняя мощность обмена (Вт): энергия в единицу
 *   времени, а не энергия;
 * - fluxW_m2 — плотность потока через границу (Вт/м²) — отдельная
 *   величина, не мощность резервуара.
 * null означает «неизвестно», а не ноль.
 */
export interface EnergyInventory {
  /** Запас энергии резервуара, Дж. null — неизвестен (не ноль). */
  storedJ: number | null;
  /** Средняя входящая+исходящая мощность (алгебраическая), Вт. null — неизвестна. */
  netPowerW: number | null;
  /** Плотность усреднённого энергетического потока на границе, Вт/м². null — неизвестна. */
  fluxW_m2: number | null;
  /** Происхождение и допущения энергетической модели, если задана. */
  note?: string;
}

export interface EnergyInventoryValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Валидация энергетического инвентаря (Stage 4.1.1):
 * - storedJ: null допустим (энергия не измерена), NaN/∞ — нет;
 *   отрицательный запас энергии невозможен;
 * - netPowerW / fluxW_m2: null допустим; значения конечны и могут
 *   быть отрицательными (потеря энергии — физика, а не ошибка).
 */
export function validateEnergyInventory(inv: EnergyInventory): EnergyInventoryValidation {
  const errors: string[] = [];
  if (inv.storedJ !== null) {
    if (!Number.isFinite(inv.storedJ)) {
      errors.push(`storedJ должен быть конечным числом или null, получено ${String(inv.storedJ)}`);
    } else if (inv.storedJ < 0) {
      errors.push(`отрицательный запас энергии невозможен: ${inv.storedJ} Дж`);
    }
  }
  if (inv.netPowerW !== null && !Number.isFinite(inv.netPowerW)) {
    errors.push(`netPowerW должен быть конечным числом или null, получено ${String(inv.netPowerW)}`);
  }
  if (inv.fluxW_m2 !== null && !Number.isFinite(inv.fluxW_m2)) {
    errors.push(`fluxW_m2 должен быть конечным числом или null, получено ${String(inv.fluxW_m2)}`);
  }
  return { valid: errors.length === 0, errors };
}

// ============================================
// 4. РЕЗЕРВУАР
// ============================================

/**
 * Запись резервуара. properties — научные характеристики
 * (температура, давление, объём, плотность, ...) как ScientificValue:
 * каждое со своим статусом известности, неопределённостью и
 * происхождением. Требовать все поля известными нельзя: может быть
 * известен запас воды, но неизвестны температура и объём — тогда
 * поля остаются Unknown и НЕ подменяются фиктивными значениями.
 */
export interface ReservoirRecord {
  id: string;
  /** Тип резервуара: atmosphere | ocean | ice | crust | mantle | core | ... Расширяемая строка. */
  kind: string;
  /** Тело, к которому относится резервуар (если иерархия тел задана). */
  bodyId?: string;
  material?: MaterialInventory;
  energy?: EnergyInventory;
  properties: Record<string, ScientificValue>;
  note?: string;
  /**
   * Явное указание, что резервуар по своей природе НЕ содержит материю
   * (Stage 4.1.1.2): например, чисто энергетический буфер. Только это
   * поле даёт право исключить резервуар из материального баланса.
   *
   * Семантика материального состояния (три РАЗНЫХ состояния):
   * - material задан — запас известен (entries = {} — известная пустота,
   *   entries[species] = 0 — известный ноль);
   * - material отсутствует И materialApplicability = 'not_applicable' —
   *   резервуар заведомо без материи: баланс вправе его не учитывать;
   * - material отсутствует без этого поля — запас НЕИЗВЕСТЕН:
   *   он не приравнивается к нулю и делает аудит непроверяемым.
   * Неприменимость НЕ выводится из отсутствия поля.
   */
  materialApplicability?: 'not_applicable';
}

// ============================================
// 5. ОПЕРАЦИИ (ИММУТАБЕЛЬНЫЕ)
// ============================================

export class ReservoirError extends Error {
  readonly code:
    | 'basis_mismatch'
    | 'insufficient_amount'
    | 'invalid_amount'
    | 'unknown_basis';
  readonly component = 'Reservoir';
  readonly reservoirId: string;

  constructor(code: ReservoirError['code'], reservoirId: string, message: string) {
    super(`[Reservoir/${code}] ${message}`);
    this.name = 'ReservoirError';
    this.code = code;
    this.reservoirId = reservoirId;
  }
}

/** Создать пустой резервуар (без инвентаря). */
export function createReservoir(id: string, kind: string, opts?: { bodyId?: string; note?: string }): ReservoirRecord {
  if (id.trim() === '') throw new ReservoirError('invalid_amount', id, 'id резервуара не может быть пустым');
  return { id, kind, bodyId: opts?.bodyId, properties: {}, note: opts?.note };
}

function withMaterial(res: ReservoirRecord, entries: Record<string, number>, basis: InventoryBasis): ReservoirRecord {
  const inv: MaterialInventory = { basis, entries };
  const check = validateMaterialInventory(inv);
  if (!check.valid) {
    throw new ReservoirError('invalid_amount', res.id, `некорректный инвентарь: ${check.errors.join('; ')}`);
  }
  return { ...res, material: inv };
}

/**
 * Задать материальный инвентарь целиком.
 * Если инвентарь уже был в другом основании — ошибка basis_mismatch:
 * бесшовная «конвертация» между основаниями не выполняется,
 * потому что для неё нужны данные (молярные массы, объём, площадь),
 * которые вызывающий код должен передать явно.
 */
export function setMaterialInventory(res: ReservoirRecord, basis: InventoryBasis, entries: Record<string, number>): ReservoirRecord {
  if (res.material && res.material.basis !== basis) {
    throw new ReservoirError(
      'basis_mismatch',
      res.id,
      `инвентарь резервуара уже задан в основании «${res.material.basis}»; установить «${basis}» напрямую нельзя — используйте явное преобразование с необходимыми данными`
    );
  }
  return withMaterial(res, entries, basis);
}

/**
 * Добавить количество вида. Основание должно совпадать с уже
 * заданным; количество — конечное неотрицательное число.
 * Возвращает новый резервуар (исходный не изменяется).
 */
export function addMaterial(res: ReservoirRecord, speciesId: string, amount: number): ReservoirRecord {
  const inv = res.material;
  if (!inv) {
    throw new ReservoirError('unknown_basis', res.id, 'материальный инвентарь не задан: сначала setMaterialInventory');
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ReservoirError('invalid_amount', res.id, `добавляемое количество вида «${speciesId}» должно быть неотрицательным конечным числом, получено ${amount}`);
  }
  const entries = { ...inv.entries, [speciesId]: (inv.entries[speciesId] ?? 0) + amount };
  return withMaterial(res, entries, inv.basis);
}

/**
 * Изъять количество вида. Невозможность изъять больше, чем есть,
 * защищается ошибкой insufficient_amount: отрицательный запас
 * не создаётся ни при каких условиях.
 */
export function removeMaterial(res: ReservoirRecord, speciesId: string, amount: number): ReservoirRecord {
  const inv = res.material;
  if (!inv) {
    throw new ReservoirError('unknown_basis', res.id, 'материальный инвентарь не задан');
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ReservoirError('invalid_amount', res.id, `изымаемое количество вида «${speciesId}» должно быть неотрицательным конечным числом, получено ${amount}`);
  }
  const current = inv.entries[speciesId] ?? 0;
  if (amount > current) {
    throw new ReservoirError(
      'insufficient_amount',
      res.id,
      `недостаточно вида «${speciesId}» в резервуаре: есть ${current}, требуется ${amount}`
    );
  }
  const remaining = current - amount;
  const entries = { ...inv.entries };
  if (remaining > 0) {
    entries[speciesId] = remaining;
  } else {
    delete entries[speciesId];
  }
  return withMaterial(res, entries, inv.basis);
}

/** Текущее количество вида (0, если вида нет; основание — у инвентаря). */
export function getAmount(res: ReservoirRecord, speciesId: string): number | null {
  if (!res.material) return null;
  return res.material.entries[speciesId] ?? 0;
}

/** Записать научную характеристику резервуара (температура, давление, ...). */
export function setProperty(res: ReservoirRecord, key: string, value: ScientificValue): ReservoirRecord {
  return { ...res, properties: { ...res.properties, [key]: value } };
}

/** Прочитать научную характеристику; null, если характеристика не задана. */
export function getProperty(res: ReservoirRecord, key: string): ScientificValue | null {
  return res.properties[key] ?? null;
}

/** Задать энергетический инвентарь (величины разных размерностей — в отдельных полях). */
export function setEnergyInventory(res: ReservoirRecord, energy: EnergyInventory): ReservoirRecord {
  const validation = validateEnergyInventory(energy);
  if (!validation.valid) {
    throw new ReservoirError('invalid_amount', res.id, `некорректный энергетический инвентарь: ${validation.errors.join('; ')}`);
  }
  return { ...res, energy };
}

export interface ReservoirRecordValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Валидация записи резервуара произвольной формы (Stage 4.1.1).
 * Проверяет запись из JSON или внешнего кода ДО регистрации
 * в состоянии мира. Диагностика точнее общей проверки объектов.
 *
 * Stage 4.1.1.3 (ISSUE B): properties и material.entries обязаны
 * быть объектами-записями: у массива typeof тоже 'object', поэтому
 * массив (включая пустой) отвергается явно — пустой массив НЕ
 * равен пустому словарю и не принимается за «известную пустоту».
 */
export function validateReservoirRecord(reservoir: unknown): ReservoirRecordValidation {
  const errors: string[] = [];
  if (typeof reservoir !== 'object' || reservoir === null) {
    return { valid: false, errors: ['резервуар должен быть объектом'] };
  }
  const rec = reservoir as Record<string, unknown>;
  if (typeof rec.id !== 'string' || rec.id.trim() === '') {
    errors.push('id резервуара должен быть непустой строкой');
  }
  if (typeof rec.kind !== 'string' || rec.kind.trim() === '') {
    errors.push('kind резервуара должен быть непустой строкой');
  }
  if (typeof rec.bodyId !== 'undefined' && typeof rec.bodyId !== 'string') {
    errors.push('bodyId резервуара должен быть строкой, если задан');
  }
  if (rec.material !== undefined) {
    if (!isPlainRecord(rec.material)) {
      errors.push('material резервуара должен быть объектом (basis + entries)');
    } else {
      const material = rec.material as Record<string, unknown>;
      if (typeof material.basis !== 'string' || !isKnownBasis(material.basis)) {
        errors.push(`material.basis должен быть известным основанием, получено «${String(material.basis)}»`);
      }
      if (!isPlainRecord(material.entries)) {
        errors.push('material.entries должен быть объектом-словарём (speciesId → количество), а не массивом/null');
      } else {
        for (const [id, amount] of Object.entries(material.entries as Record<string, unknown>)) {
          if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
            errors.push(`material.entries["${id}"] должен быть неотрицательным конечным числом, получено ${String(amount)}`);
          }
        }
      }
    }
  }
  if (rec.energy !== undefined && rec.energy !== null) {
    if (!isPlainRecord(rec.energy)) {
      errors.push('energy резервуара должен быть объектом-записью (не массивом) или null');
    } else {
      const energy = rec.energy as Record<string, unknown>;
      const storedJ = energy.storedJ;
      if (storedJ !== null && storedJ !== undefined && (typeof storedJ !== 'number' || !Number.isFinite(storedJ) || storedJ < 0)) {
        errors.push(`energy.storedJ должен быть неотрицательным конечным числом или null, получено ${String(storedJ)}`);
      }
      if (storedJ === undefined) {
        errors.push('energy.storedJ обязателен (число или null — энергия неизвестна)');
      }
      for (const key of ['netPowerW', 'fluxW_m2'] as const) {
        const value = energy[key];
        if (value !== null && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
          errors.push(`energy.${key} должен быть конечным числом или null, получено ${String(value)}`);
        }
      }
    }
  }
  if (rec.materialApplicability !== undefined) {
    if (rec.materialApplicability !== 'not_applicable') {
      errors.push(`materialApplicability должен быть 'not_applicable', если задан, получено «${String(rec.materialApplicability)}»`);
    } else if (rec.material !== undefined) {
      errors.push('material и materialApplicability = \'not_applicable\' противоречат друг другу: инвентарь не может быть одновременно задан и неприменим');
    }
  }
  if (rec.properties === undefined) {
    // Stage 4.1.1.2: properties — ОБЯЗАТЕЛЬНОЕ поле ReservoirRecord.
    // Раньше отсутствие поля проходило проверку молча (проверка была
    // условной); пустой объект {} допустим — «характеристик нет»
    // отличается от «характеристики не заданы структурно».
    errors.push('properties резервуара обязателен (объект ScientificValue; пустой объект допустим)');
  } else if (!isPlainRecord(rec.properties)) {
    // Stage 4.1.1.3 (ISSUE B): properties — именованный словарь
    // ScientificValue; массив (включая пустой []) — не словарь.
    errors.push('properties резервуара должен быть объектом-словарём (именованные ScientificValue), а не массивом');
  } else {
    for (const [key, value] of Object.entries(rec.properties as Record<string, unknown>)) {
      const issues = validateScientificValueShape(value);
      if (issues.length > 0) {
        errors.push(`properties["${key}"]: ${issues.join('; ')}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

