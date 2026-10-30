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
import { assertDimension, dimension } from './physicalQuantity';
import type { ScientificValue } from './scientificValue';

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
 * Явное преобразование количества вещества (моль) в массу (кг).
 * Требует молярной массы; без неё преобразование невозможно.
 */
export function amountToMass(amount: PhysicalQuantity, molarMassKgMol: number): PhysicalQuantity {
  assertDimension(amount, dimension(0, 0, 0, 0, 0, 1), 'amountToMass', 'Reservoir');
  if (!Number.isFinite(molarMassKgMol) || molarMassKgMol <= 0) {
    throw new Error(`[Reservoir/amountToMass] молярная масса должна быть конечным положительным числом, получено ${molarMassKgMol}`);
  }
  return { value: amount.value * molarMassKgMol, unit: 'kg' };
}

/** Явное обратное преобразование массы в количество вещества. */
export function massToAmount(mass: PhysicalQuantity, molarMassKgMol: number): PhysicalQuantity {
  assertDimension(mass, dimension(1), 'massToAmount', 'Reservoir');
  if (!Number.isFinite(molarMassKgMol) || molarMassKgMol <= 0) {
    throw new Error(`[Reservoir/massToAmount] молярная масса должна быть конечным положительным числом, получено ${molarMassKgMol}`);
  }
  return { value: mass.value / molarMassKgMol, unit: 'mol' };
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
 * Валидация материального инвентаря:
 * - числа конечны и неотрицательны (отрицательный запас невозможен);
 * - для долей дополнительно: сумма долей не обязана быть 1
 *   (инвентарь может быть частичным), это не ошибка, а контракт поля.
 */
export function validateMaterialInventory(inv: MaterialInventory): MaterialInventoryValidation {
  const errors: string[] = [];
  for (const [id, amount] of Object.entries(inv.entries)) {
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
  const check = (v: number | null): boolean => v === null || Number.isFinite(v);
  if (!check(energy.storedJ) || !check(energy.netPowerW) || !check(energy.fluxW_m2)) {
    throw new ReservoirError('invalid_amount', res.id, 'энергетические величины должны быть конечными числами или null');
  }
  return { ...res, energy };
}
