// ============================================
// FLUX LEDGER - Учёт потоков вещества и энергии
// ============================================
//
// Единая система регистрации переносов между резервуарами и через
// внешнюю границу системы (Stage 4.1; научная целостность аудитов
// и применения потоков исправлена в Stage 4.1.1).
//
// Главные правила:
// - три вида потоков, не смешиваемых между собой:
//   internal_transfer (между внутренними резервуарами),
//   external_input (поступление извне), external_output
//   (потеря системой); внешний поток нельзя замаскировать
//   под внутренний перенос;
// - РАЗДЕЛЕНИЕ rate и integrated amount:
//   скорость (моль/с, Вт) — НЕ перенесённое количество (моль, Дж);
//   rate-запись к инвентарю не применяется; чтобы применить поток,
//   скорость интегрируется по времени ЯВНЫМ вызовом integrateRate()
//   и регистрируется как integrated-поток;
// - каждая запись применяется к резервуарам ровно один раз
//   (идемпотентность: повторное применение той же записи — ошибка);
// - применение записи atomic: убыль из источника и прибавление
//   получателю происходят вместе либо не происходят вовсе;
// - применённая запись может быть корректно отменена (revert),
//   статус при этом сохраняется — история не переписывается;
// - балансные аудиты (элементный, зарядовый, по веществам,
//   энергетический) сверяют фактические инвентари с потока́ми.
//
// Stage 4.1.1 (исправление Issues 3-4 и связанных):
// - применение энергетического потока РЕАЛЬНО изменяет storedJ
//   резервуаров: зарегистрированный поток ≠ физически применённый,
//   но применённый поток обязан изменить запас энергии;
// - вещество не применяется к несуществующему инвентарю молча:
//   отсутствие инвентаря/несовместимость основания/нехватка запаса
//   диагностируются явно, а не обходятся;
// - аудиты проверяют каждый резервуар и каждый вид, а не только
//   суммарный запас системы: «вещество ушло не туда» теперь
//   ловится даже при сохранении общей суммы (auditReservoirFluxes);
// - аудиты подчиняются временной области (FluxAuditScope):
//   записи вне интервала и записи без привязки ко времени не
//   учитываются молча — они исключаются и перечисляются явно;
// - элементный/зарядовый/вещественный аудиты basis-aware:
//   массы переводятся в моли по молярной массе вида; невозможность
//   перевода — это 'not_verifiable', а не выдуманный ноль;
// - отсутствие знания (unknown storedJ, неизвестная молярная масса,
//   исключённые виды) никогда не трактуется как успешный баланс.
//
// Материя не создаётся и не уничтожается «внутри системы»:
// изменение суммарного инвентаря допустимо ТОЛЬКО за счёт
// внешних потоков; внутренние переносы сохраняют итог.

import type { InventoryBasis, MaterialInventory, ReservoirRecord } from './reservoir';
import { addMaterial, isKnownBasis, removeMaterial, validateMaterialInventory } from './reservoir';
import type { SpeciesCatalog } from './species';
import { chargeTotal, elementTotals as speciesElementTotals } from './species';
import { comparePoints } from './simulationClock';

// ============================================
// 1. ТИПЫ ПОТОКОВ
// ============================================

/** Идентификатор внешней границы системы. */
export const EXTERNAL = 'external';

export type FluxKind = 'internal_transfer' | 'external_input' | 'external_output';

export const FLUX_KINDS: readonly FluxKind[] = ['internal_transfer', 'external_input', 'external_output'];

export const FLUX_STATUSES: readonly FluxStatus[] = ['pending', 'applied', 'reverted'];

/**
 * Переносимый субъект потока.
 *
 * quantityKind:
 * - 'integrated' — количество, перенесённое ЗА ИНТЕРВАЛ
 *   (моль/м² столба, моль, кг, Дж): применяется к инвентарю;
 * - 'rate' — скорость переноса (моль/с, Вт): к инвентарю НЕ
 *   применяется; должна быть явно интегрирована по времени.
 */
export type FluxSubject =
  | {
      subjectType: 'substance';
      speciesId: string;
      quantityKind: 'integrated';
      /** Перенесённое количество в единицах основания. */
      amount: number;
      /** Основание количества (как у инвентаря резервуара). */
      basis: InventoryBasis;
    }
  | {
      subjectType: 'substance';
      speciesId: string;
      quantityKind: 'rate';
      /** Скорость переноса количества вещества в единицах basis за секунду. */
      ratePerSecond: number;
      basis: InventoryBasis;
      /** Семантика скорости (какая модель её дала), если задана. */
      note?: string;
    }
  | {
      subjectType: 'energy';
      quantityKind: 'integrated';
      /** Энергия, переданная за интервал, Дж. */
      energyJ: number;
    }
  | {
      subjectType: 'energy';
      quantityKind: 'rate';
      /** Мощность, Вт. НЕ равна переданной энергии. */
      powerW: number;
      note?: string;
    };

/** Привязка потока к моменту времени симуляции (SimulationClock). */
export interface FluxTime {
  segmentIndex: number;
  localTimeS: number;
}

export type FluxStatus = 'pending' | 'applied' | 'reverted';

/** Запись потока. */
export interface FluxRecord {
  id: string;
  kind: FluxKind;
  /** Источник: reservoirId (или EXTERNAL для external_input). */
  from: string;
  /** Получатель: reservoirId (или EXTERNAL для external_output). */
  to: string;
  subject: FluxSubject;
  /** Момент/интервал, к которому относится поток; null — не привязан. */
  time: FluxTime | null;
  status: FluxStatus;
  note?: string;
}

export interface FluxLedger {
  records: FluxRecord[];
}

// ============================================
// 2. ОШИБКИ И ВАЛИДАЦИЯ
// ============================================

export class FluxLedgerError extends Error {
  readonly code:
    | 'invalid_flux'
    | 'duplicate_flux_id'
    | 'unknown_flux'
    | 'already_applied'
    | 'not_applied'
    | 'rate_not_applicable'
    | 'unknown_reservoir'
    | 'unknown_inventory'
    | 'unknown_energy_inventory'
    | 'insufficient_energy'
    | 'incompatible_basis';
  readonly component = 'FluxLedger';
  readonly fluxId: string | null;

  constructor(code: FluxLedgerError['code'], message: string, fluxId: string | null) {
    super(`[FluxLedger/${code}] ${message}`);
    this.name = 'FluxLedgerError';
    this.code = code;
    this.fluxId = fluxId;
  }
}

/** Пустой реестр. */
export function createFluxLedger(): FluxLedger {
  return { records: [] };
}

function recordById(ledger: FluxLedger, id: string): FluxRecord {
  const rec = ledger.records.find((r) => r.id === id);
  if (!rec) {
    throw new FluxLedgerError('unknown_flux', `поток «${id}» не зарегистрирован`, id);
  }
  return rec;
}

function requireReservoir(reservoirs: Record<string, ReservoirRecord>, reservoirId: string, fluxId: string): ReservoirRecord {
  const res = reservoirs[reservoirId];
  if (!res) {
    throw new FluxLedgerError('unknown_reservoir', `резервуар «${reservoirId}» не существует`, fluxId);
  }
  return res;
}

/**
 * Регистрация потока. Проверки:
 * - internal_transfer: from и to — существующие внутренние резервуары
 *   и from ≠ to (перенос самому себе бессмыслен);
 * - external_input: from = EXTERNAL, to — внутренний резервуар;
 * - external_output: to = EXTERNAL, from — внутренний резервуар;
 * - integrated-количество — конечное положительное число
 *   (нулевой перенос не регистрируется как поток);
 * - rate — конечное положительное число.
 */
export function registerFlux(ledger: FluxLedger, record: {
  id: string;
  kind: FluxKind;
  from: string;
  to: string;
  subject: FluxSubject;
  time?: FluxTime | null;
  note?: string;
}): FluxLedger {
  if (record.id.trim() === '') {
    throw new FluxLedgerError('invalid_flux', 'id потока не может быть пустым', null);
  }
  if (ledger.records.some((r) => r.id === record.id)) {
    throw new FluxLedgerError('duplicate_flux_id', `поток «${record.id}» уже зарегистрирован`, record.id);
  }
  if (record.kind === 'internal_transfer') {
    if (record.from === EXTERNAL || record.to === EXTERNAL) {
      throw new FluxLedgerError('invalid_flux', `внутренний перенос «${record.id}» не может пересекать внешнюю границу (from=${record.from}, to=${record.to})`, record.id);
    }
    if (record.from === record.to) {
      throw new FluxLedgerError('invalid_flux', `перенос «${record.id}» в самого себя (${record.from}) не является переносом между резервуарами`, record.id);
    }
  } else if (record.kind === 'external_input') {
    if (record.from !== EXTERNAL || record.to === EXTERNAL) {
      throw new FluxLedgerError('invalid_flux', `external_input «${record.id}» требует from=external и внутреннего получателя`, record.id);
    }
  } else {
    if (record.to !== EXTERNAL || record.from === EXTERNAL) {
      throw new FluxLedgerError('invalid_flux', `external_output «${record.id}» требует to=external и внутреннего источника`, record.id);
    }
  }
  if (record.subject.subjectType === 'substance') {
    if (record.subject.speciesId.trim() === '') {
      throw new FluxLedgerError('invalid_flux', `поток «${record.id}»: speciesId не может быть пустым`, record.id);
    }
    const amount = record.subject.quantityKind === 'integrated' ? record.subject.amount : record.subject.ratePerSecond;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new FluxLedgerError('invalid_flux', `поток «${record.id}»: переносимое количество/скорость должно быть конечным положительным числом, получено ${amount}`, record.id);
    }
  } else if (record.subject.quantityKind === 'integrated') {
    if (!Number.isFinite(record.subject.energyJ) || record.subject.energyJ <= 0) {
      throw new FluxLedgerError('invalid_flux', `поток «${record.id}»: энергия должна быть конечным положительным числом, получено ${record.subject.energyJ}`, record.id);
    }
  } else {
    if (!Number.isFinite(record.subject.powerW) || record.subject.powerW <= 0) {
      throw new FluxLedgerError('invalid_flux', `поток «${record.id}»: мощность должна быть конечным положительным числом, получено ${record.subject.powerW}`, record.id);
    }
  }
  return {
    records: [
      ...ledger.records,
      { id: record.id, kind: record.kind, from: record.from, to: record.to, subject: record.subject, time: record.time ?? null, status: 'pending', note: record.note }
    ]
  };
}

/**
 * Явная интеграция скорости переноса по интервалу времени.
 * Возвращает integrated-субъект. Скорость НЕ применяется к инвентарю
 * сама по себе: без этой интеграции переноса не происходит.
 * Отрицательный интервал времени запрещён (нет режима обратного
 * интегрирования).
 */
export function integrateSubstanceRate(subject: Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'rate' }>, durationS: number): Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }> {
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new FluxLedgerError('invalid_flux', `интеграция скорости требует положительного интервала времени, получено ${durationS}`, null);
  }
  const amount = subject.ratePerSecond * durationS;
  if (!Number.isFinite(amount)) {
    throw new FluxLedgerError('invalid_flux', 'результат интеграции непредставим (переполнение)', null);
  }
  return { subjectType: 'substance', speciesId: subject.speciesId, quantityKind: 'integrated', amount, basis: subject.basis };
}

/**
 * Интеграция мощности по времени: энергия за интервал.
 * Мощность НЕ равна переданной энергии.
 */
export function integratePower(powerW: number, durationS: number): number {
  if (!Number.isFinite(powerW) || !Number.isFinite(durationS) || durationS <= 0) {
    throw new FluxLedgerError('invalid_flux', `интеграция мощности требует конечной мощности и положительного интервала (получено ${powerW} Вт, ${durationS} с)`, null);
  }
  const energyJ = powerW * durationS;
  if (!Number.isFinite(energyJ)) {
    throw new FluxLedgerError('invalid_flux', 'результат интеграции мощности непредставим (переполнение)', null);
  }
  return energyJ;
}

// ============================================
// 3. ПРИМЕНЕНИЕ И ОТМЕНА
// ============================================

/**
 * Применить Δ энергии к запасу резервуара (Stage 4.1.1).
 * Меняет ТОЛЬКО storedJ; остальные поля энергетического инвентаря
 * не трогаются (их пересчёт — задача энергетической модели).
 * Отсутствие знания (нет инвентаря / storedJ = null) — ошибка:
 * отсутствие знания не заменяется нулём.
 */
function applyEnergyDelta(res: ReservoirRecord, deltaJ: number, fluxId: string): ReservoirRecord {
  if (!res.energy || res.energy.storedJ === null) {
    throw new FluxLedgerError(
      'unknown_energy_inventory',
      `резервуар «${res.id}» не содержит известного запаса энергии (инвентарь отсутствует или storedJ = null): применение потока «${fluxId}» невозможно — отсутствие знания не заменяется нулём`,
      fluxId
    );
  }
  const nextStoredJ = res.energy.storedJ + deltaJ;
  if (!Number.isFinite(nextStoredJ)) {
    throw new FluxLedgerError('invalid_flux', `запас энергии резервуара «${res.id}» после применения потока «${fluxId}» непредставим (переполнение)`, fluxId);
  }
  if (nextStoredJ < 0) {
    throw new FluxLedgerError(
      'insufficient_energy',
      `резервуар «${res.id}» содержит ${res.energy.storedJ} Дж, а поток «${fluxId}» требует изъять ${-deltaJ} Дж: отрицательный запас энергии невозможен`,
      fluxId
    );
  }
  return { ...res, energy: { ...res.energy, storedJ: nextStoredJ } };
}

/**
 * Применить поток к состоянию резервуаров.
 * Идемпотентность: pending-поток становится applied; повторное
 * применение applied/потока — ошибка already_applied (двойного
 * применения не бывает).
 *
 * Rate-потоки к инвентарю НЕ применяются (ошибка rate_not_applicable):
 * сначала integrateSubstanceRate/integratePower.
 *
 * Stage 4.1.1:
 * - энергетический поток РЕАЛЬНО переносит storedJ между резервуарами
 *   (internal), из внешней среды (external_input) или наружу
 *   (external_output): до исправления статус менялся на applied без
 *   какого-либо изменения запаса — зарегистрированный поток не
 *   становился физически применённым;
 * - материальный поток требует СУЩЕСТВУЮЩЕГО инвентаря в том же
 *   основании: пустой инвентарь больше не создаётся молча
 *   (unknown_inventory), несовместимое основание — ошибка
 *   incompatible_basis, достаточность запаса проверяется всегда.
 *
 * Возвращает новые резервуары и реестр (иммутабельно).
 */
export function applyFlux(
  ledger: FluxLedger,
  reservoirs: Record<string, ReservoirRecord>,
  fluxId: string
): { ledger: FluxLedger; reservoirs: Record<string, ReservoirRecord> } {
  const rec = recordById(ledger, fluxId);
  if (rec.status === 'applied') {
    throw new FluxLedgerError('already_applied', `поток «${fluxId}» уже применён: повторное применение запрещено (двойной учёт)`, fluxId);
  }
  if (rec.status === 'reverted') {
    throw new FluxLedgerError('not_applied', `поток «${fluxId}» отменён и не может быть применён`, fluxId);
  }
  if (rec.subject.subjectType === 'substance' && rec.subject.quantityKind === 'rate') {
    throw new FluxLedgerError('rate_not_applicable', `поток «${fluxId}» — скорость переноса: инвентарь она не меняет, интегрируйте по времени (integrateSubstanceRate) и зарегистрируйте integrated-поток`, fluxId);
  }
  if (rec.subject.subjectType === 'energy' && rec.subject.quantityKind === 'rate') {
    throw new FluxLedgerError('rate_not_applicable', `поток «${fluxId}» — мощность (Вт), а не переданная энергия: интегрируйте по времени (integratePower)`, fluxId);
  }

  const next: Record<string, ReservoirRecord> = { ...reservoirs };

  // Энергетический поток: реальный перенос запаса энергии.
  if (rec.subject.subjectType === 'energy') {
    const subject = rec.subject as Extract<FluxSubject, { subjectType: 'energy'; quantityKind: 'integrated' }>;
    if (rec.kind === 'internal_transfer') {
      const from = requireReservoir(next, rec.from, fluxId);
      requireReservoir(next, rec.to, fluxId);
      next[rec.from] = applyEnergyDelta(from, -subject.energyJ, fluxId);
      next[rec.to] = applyEnergyDelta(next[rec.to], subject.energyJ, fluxId);
    } else if (rec.kind === 'external_input') {
      const to = requireReservoir(next, rec.to, fluxId);
      next[rec.to] = applyEnergyDelta(to, subject.energyJ, fluxId);
    } else {
      const from = requireReservoir(next, rec.from, fluxId);
      next[rec.from] = applyEnergyDelta(from, -subject.energyJ, fluxId);
    }
    return {
      ledger: {
        records: ledger.records.map((r) => (r.id === fluxId ? { ...r, status: 'applied' as FluxStatus } : r))
      },
      reservoirs: next
    };
  }

  const subject = rec.subject as Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }>;

  const requireInventory = (reservoirId: string): MaterialInventory => {
    const res = requireReservoir(next, reservoirId, fluxId);
    if (!res.material) {
      throw new FluxLedgerError(
        'unknown_inventory',
        `резервуар «${reservoirId}» не содержит материального инвентаря: применение потока «${fluxId}» не создаёт инвентарь молча — задайте его явно (setMaterialInventory)`,
        fluxId
      );
    }
    if (res.material.basis !== subject.basis) {
      throw new FluxLedgerError(
        'incompatible_basis',
        `резервуар «${reservoirId}» хранит инвентарь в основании «${res.material.basis}», а поток «${fluxId}» — в «${subject.basis}»: основания несовместимы без явного преобразования`,
        fluxId
      );
    }
    return res.material;
  };

  if (rec.kind === 'internal_transfer') {
    const fromInventory = requireInventory(rec.from);
    requireInventory(rec.to);
    const available = fromInventory.entries[subject.speciesId] ?? 0;
    if (available < subject.amount) {
      throw new FluxLedgerError(
        'invalid_flux',
        `резервуар «${rec.from}» содержит ${available} «${subject.speciesId}», а перенос «${fluxId}» требует ${subject.amount}`,
        fluxId
      );
    }
    // Атомарно: сначала убыль, затем прибавление; при ошибке
    // на любом шаге исключение прерывает применение до
    // записи applied-статуса.
    next[rec.from] = removeMaterial(next[rec.from], subject.speciesId, subject.amount);
    next[rec.to] = addMaterial(next[rec.to], subject.speciesId, subject.amount);
  } else if (rec.kind === 'external_input') {
    requireInventory(rec.to);
    next[rec.to] = addMaterial(next[rec.to], subject.speciesId, subject.amount);
  } else {
    const fromInventory = requireInventory(rec.from);
    const available = fromInventory.entries[subject.speciesId] ?? 0;
    if (available < subject.amount) {
      throw new FluxLedgerError(
        'invalid_flux',
        `резервуар «${rec.from}» содержит ${available} «${subject.speciesId}», а потеря «${fluxId}» требует ${subject.amount}`,
        fluxId
      );
    }
    next[rec.from] = removeMaterial(next[rec.from], subject.speciesId, subject.amount);
  }

  return {
    ledger: {
      records: ledger.records.map((r) => (r.id === fluxId ? { ...r, status: 'applied' as FluxStatus } : r))
    },
    reservoirs: next
  };
}

/**
 * Отменить применение потока (возврат перенесённого).
 * Отменять можно только applied-поток; статус становится reverted,
 * запись сохраняется в истории — учёт не переписывается задним числом.
 *
 * Stage 4.1.1: отмена ЭНЕРГЕТИЧЕСКОГО потока возвращает перенесённую
 * энергию (до исправления статус менялся на reverted без возврата).
 * Порядок: сначала вычитающие стороны, затем прибавляющие —
 * при нехватке энергии у вычитающей стороны исключение прерывает
 * отмену до каких-либо изменений (атомарность).
 */
export function revertFlux(
  ledger: FluxLedger,
  reservoirs: Record<string, ReservoirRecord>,
  fluxId: string
): { ledger: FluxLedger; reservoirs: Record<string, ReservoirRecord> } {
  const rec = recordById(ledger, fluxId);
  if (rec.status !== 'applied') {
    throw new FluxLedgerError('not_applied', `поток «${fluxId}» не применён (статус: ${rec.status}): отменять нечего`, fluxId);
  }
  const next: Record<string, ReservoirRecord> = { ...reservoirs };

  if (rec.subject.subjectType === 'energy') {
    const subject = rec.subject as Extract<FluxSubject, { subjectType: 'energy'; quantityKind: 'integrated' }>;
    if (rec.kind === 'internal_transfer') {
      requireReservoir(next, rec.from, fluxId);
      requireReservoir(next, rec.to, fluxId);
      next[rec.to] = applyEnergyDelta(next[rec.to], -subject.energyJ, fluxId);
      next[rec.from] = applyEnergyDelta(next[rec.from], subject.energyJ, fluxId);
    } else if (rec.kind === 'external_input') {
      next[rec.to] = applyEnergyDelta(next[rec.to], -subject.energyJ, fluxId);
    } else {
      next[rec.from] = applyEnergyDelta(next[rec.from], subject.energyJ, fluxId);
    }
    return {
      ledger: { records: ledger.records.map((r) => (r.id === fluxId ? { ...r, status: 'reverted' as FluxStatus } : r)) },
      reservoirs: next
    };
  }

  const subject = rec.subject as Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }>;

  if (rec.kind === 'internal_transfer') {
    next[rec.to] = removeMaterial(next[rec.to], subject.speciesId, subject.amount);
    next[rec.from] = addMaterial(next[rec.from], subject.speciesId, subject.amount);
  } else if (rec.kind === 'external_input') {
    next[rec.to] = removeMaterial(next[rec.to], subject.speciesId, subject.amount);
  } else {
    next[rec.from] = addMaterial(next[rec.from], subject.speciesId, subject.amount);
  }

  return {
    ledger: { records: ledger.records.map((r) => (r.id === fluxId ? { ...r, status: 'reverted' as FluxStatus } : r)) },
    reservoirs: next
  };
}

// ============================================
// 4. БАЛАНСОВЫЕ АУДИТЫ
// ============================================

/** Расхождение аудита; reservoirId указывает резервуар, если расхождение локализовано. */
export interface BalanceDiscrepancy {
  key: string;
  expected: number;
  actual: number;
  reservoirId?: string;
}

/**
 * Статус аудита сохранения (Stage 4.1.1):
 * - 'balanced' — проверка выполнена и выполнена положительно;
 * - 'approximate' — проверка выполнена на основе оценок
 *   (например, оценочные молярные массы): численного расхождения
 *   нет, но точность ограничена;
 * - 'imbalanced' — проверка выполнена и нашла расхождение;
 * - 'not_verifiable' — проверка НЕПРОВЕРЯЕМА: не хватает данных
 *   (неизвестные запасы, непереводимые основания, исключённые виды).
 *   НЕ является успехом и никогда не приравнивается к нулю.
 */
export type ConservationStatus = 'balanced' | 'imbalanced' | 'approximate' | 'not_verifiable';

/** Исключение из проверки с явной причиной. */
export interface AuditExclusion {
  key: string;
  reason: string;
}

export interface ConservationAuditResult {
  /** Статус проверки; balanced === true только при status 'balanced'. */
  status: ConservationStatus;
  /** Согласовано ли: ИСТИНА только при status === 'balanced'. */
  balanced: boolean;
  /** Расхождения (пусто при balanced=true). */
  discrepancies: BalanceDiscrepancy[];
  /** Виды, исключённые из проверки (не зарегистрированы в каталоге). */
  excludedSpecies: string[];
  /** Исключённые вклады/резервуары с причинами. */
  exclusions: AuditExclusion[];
  /** Абсолютный допуск сравнения (в единицах инвентаря). */
  tolerance: number;
  /** applied-записи без привязки ко времени, исключённые из проверки. */
  untimedRecords: string[];
}

/**
 * Временная область аудита (Stage 4.1.1). Аудит учитывает applied-
 * integrated-записи с временем t, удовлетворяющим after < t <= upTo
 * (сравнение по comparePoints, без потери порядка сегментов).
 * Записи без привязки ко времени (time = null) в ограниченной области
 * НЕ МОГУТ быть отнесены к интервалу: по умолчанию они исключаются
 * и перечисляются в untimedRecords; includeUntimed включает их
 * (на ответственности вызывающего кода). Без ограничений области
 * учитываются все записи, включая непривязанные.
 */
export interface FluxAuditScope {
  /** Нижняя граница (НЕ включается). */
  after?: FluxTime | null;
  /** Верхняя граница (включается). */
  upTo?: FluxTime | null;
  /** Включать ли applied-записи без привязки ко времени в ограниченной области. */
  includeUntimed?: boolean;
}

/** Ограничена ли область хотя бы одной границей. */
export function scopeIsBounded(scope?: FluxAuditScope): boolean {
  if (!scope) return false;
  return (scope.after != null) || (scope.upTo != null);
}

/** Попадает ли ПРИВЯЗАННЫЙ момент в область (after < t <= upTo). */
export function inTimeScope(time: FluxTime, scope?: FluxAuditScope): boolean {
  if (scope?.after != null && comparePoints(time, scope.after) <= 0) {
    return false;
  }
  if (scope?.upTo != null && comparePoints(time, scope.upTo) > 0) {
    return false;
  }
  return true;
}

/** Исключаются ли непривязанные записи в данной области. */
export function excludedUntimed(scope?: FluxAuditScope): boolean {
  return scopeIsBounded(scope) && scope?.includeUntimed !== true;
}

/** Учитывается ли запись (со статусом applied) во временной области аудита. */
export function recordInScope(rec: FluxRecord, scope?: FluxAuditScope): boolean {
  if (rec.time === null) {
    return !excludedUntimed(scope);
  }
  return inTimeScope(rec.time, scope);
}

/** id applied-integrated-записей, исключённых из области из-за отсутствия привязки. */
function untimedRecordsOf(ledger: FluxLedger, scope?: FluxAuditScope): string[] {
  if (!excludedUntimed(scope)) return [];
  const ids: string[] = [];
  for (const rec of ledger.records) {
    if (rec.status !== 'applied') continue;
    if (rec.subject.quantityKind !== 'integrated') continue;
    if (rec.time === null) ids.push(rec.id);
  }
  return ids;
}

/** Общие параметры аудитов. */
export interface AuditOptions {
  /** Абсолютный допуск сравнения (по умолчанию 1e-9). */
  tolerance?: number;
  /** Временная область аудита. */
  scope?: FluxAuditScope;
}

/** Рамка результата аудита при непроверяемости/исключениях. */
function auditFrame(
  status: ConservationStatus,
  exclusions: AuditExclusion[],
  untimedRecords: string[],
  tolerance: number,
  excludedSpecies: string[] = []
): ConservationAuditResult {
  return {
    status,
    balanced: status === 'balanced',
    discrepancies: [],
    excludedSpecies,
    exclusions,
    tolerance,
    untimedRecords
  };
}

/**
 * Суммарный инвентарь по веществам для набора резервуаров
 * (только резервуары с материальным инвентарём; основания
 * резервуаров должны быть согласованы вызывающим кодом —
 * аудит сравнивает резервуары с ОДНИМ основанием).
 * Референс-агрегат в сырых единицах основания; basis-aware аудиты
 * используют reservoirsToMolarCounts.
 */
export function totalInventory(reservoirs: Record<string, ReservoirRecord>): { basis: InventoryBasis | null; totals: Record<string, number> } {
  let basis: InventoryBasis | null = null;
  const totals: Record<string, number> = {};
  for (const res of Object.values(reservoirs)) {
    if (!res.material) continue;
    if (basis === null) {
      basis = res.material.basis;
    } else if (basis !== res.material.basis) {
      throw new FluxLedgerError('invalid_flux', `аудит объединяет резервуары с одним основанием: «${basis}» против «${res.material.basis}» (${res.id})`, null);
    }
    for (const [id, amount] of Object.entries(res.material.entries)) {
      totals[id] = (totals[id] ?? 0) + amount;
    }
  }
  return { basis, totals };
}

/** Чистый внешний перенос по веществам: входы − выходы (applied-потоки). */
export function netExternalTransfers(ledger: FluxLedger, scope?: FluxAuditScope): Record<string, number> {
  const net: Record<string, number> = {};
  for (const rec of ledger.records) {
    if (rec.status !== 'applied' || rec.subject.subjectType !== 'substance' || rec.subject.quantityKind !== 'integrated') continue;
    if (!recordInScope(rec, scope)) continue;
    const sign = rec.kind === 'external_input' ? 1 : rec.kind === 'external_output' ? -1 : 0;
    if (sign === 0) continue;
    net[rec.subject.speciesId] = (net[rec.subject.speciesId] ?? 0) + sign * rec.subject.amount;
  }
  return net;
}

// ============================================
// 4а. BASIS-AWARE МОЛЯРНАЯ СЕМАНТИКА
// ============================================

/**
 * Результат перевода запасов/потоков в молярные счёты.
 * scope: 'amount' — моли; 'column' — моли/м² (столбовые основания).
 * Смешение scope'ов в одном подсчёте недопустимо.
 */
export interface MolarCountResult {
  status: 'exact' | 'approximate' | 'not_verifiable';
  counts: Record<string, number>;
  exclusions: AuditExclusion[];
  scope: 'amount' | 'column' | null;
}

const BASIS_TO_MOLAR_SCOPE: Partial<Record<InventoryBasis, 'amount' | 'column'>> = {
  amount: 'amount',
  mass: 'amount',
  column_amount: 'column',
  column_mass: 'column'
};

/**
 * Молярная масса вида с учётом статуса данных (Stage 4.1.1):
 * отсутствие данных (null) или некорректный статус делают перевод
 * массы в моли НЕПРОВЕРЯЕМЫМ — молярная масса не подменяется нулём
 * или средним значением.
 */
function molarMassOf(catalog: SpeciesCatalog, speciesId: string): { status: 'exact' | 'approximate' | 'not_verifiable'; kgMol: number | null; reason?: string } {
  const species = catalog.get(speciesId);
  if (!species) {
    return { status: 'not_verifiable', kgMol: null, reason: `вид «${speciesId}» не зарегистрирован в каталоге` };
  }
  const m = species.molarMassKgMol;
  if (m === null) {
    return { status: 'not_verifiable', kgMol: null, reason: `молярная масса вида «${speciesId}» неизвестна` };
  }
  if (!Number.isFinite(m) || m <= 0) {
    return { status: 'not_verifiable', kgMol: null, reason: `молярная масса вида «${speciesId}» некорректна: ${m}` };
  }
  if (species.molarMassStatus === 'known') {
    return { status: 'exact', kgMol: m };
  }
  if (species.molarMassStatus === 'estimated') {
    return { status: 'approximate', kgMol: m };
  }
  return { status: 'not_verifiable', kgMol: null, reason: `статус молярной массы вида «${speciesId}» — «${species.molarMassStatus}»: перевод массы в моли непроверяем` };
}

/**
 * Перевод инвентаря в молярные счёты по видам (Stage 4.1.1).
 *
 * Основания:
 * - amount → моли (точно); column_amount → моли/м² (точно);
 * - mass / column_mass → моли через молярную массу вида:
 *   молярная масса unknown → непроверяемо; estimated → approximate;
 * - molar_concentration / mass_concentration → непроверяемо
 *   (требуется объём резервуара);
 * - molar_fraction / mass_fraction → непроверяемо (требуется
 *   общий запас системы: доля — не количество);
 * - arbitrary_units → непроверяемо (нет калибровки).
 */
export function inventoryToMolarCounts(catalog: SpeciesCatalog, inv: { basis: string; entries: Record<string, number> }): MolarCountResult {
  const basis = inv.basis;
  if (basis === 'amount') {
    return { status: 'exact', counts: { ...inv.entries }, exclusions: [], scope: 'amount' };
  }
  if (basis === 'column_amount') {
    return { status: 'exact', counts: { ...inv.entries }, exclusions: [], scope: 'column' };
  }
  if (basis === 'mass' || basis === 'column_mass') {
    const counts: Record<string, number> = {};
    let approximate = false;
    for (const [id, amount] of Object.entries(inv.entries)) {
      const mm = molarMassOf(catalog, id);
      if (mm.status === 'not_verifiable') {
        return {
          status: 'not_verifiable',
          counts: {},
          exclusions: [{ key: id, reason: `${mm.reason}: масса не переводится в моли` }],
          scope: null
        };
      }
      if (mm.status === 'approximate') approximate = true;
      counts[id] = amount / (mm.kgMol as number);
    }
    return {
      status: approximate ? 'approximate' : 'exact',
      counts,
      exclusions: [],
      scope: basis === 'mass' ? 'amount' : 'column'
    };
  }
  if (basis === 'molar_concentration' || basis === 'mass_concentration') {
    return {
      status: 'not_verifiable',
      counts: {},
      exclusions: [{ key: 'inventory', reason: `основание «${basis}» требует объёма резервуара для перевода в моли` }],
      scope: null
    };
  }
  if (basis === 'molar_fraction' || basis === 'mass_fraction') {
    return {
      status: 'not_verifiable',
      counts: {},
      exclusions: [{ key: 'inventory', reason: `основание-доля «${basis}» требует общего запаса системы для перевода в моли` }],
      scope: null
    };
  }
  if (basis === 'arbitrary_units') {
    return {
      status: 'not_verifiable',
      counts: {},
      exclusions: [{ key: 'inventory', reason: 'основание «arbitrary_units» не переводится в моли без калибровки' }],
      scope: null
    };
  }
  return {
    status: 'not_verifiable',
    counts: {},
    exclusions: [{ key: 'inventory', reason: `неизвестное основание инвентаря «${String(basis)}»` }],
    scope: null
  };
}

/**
 * Перевод количества одного потока в молярный счёт по его основанию.
 */
export function fluxAmountToMolarCount(
  catalog: SpeciesCatalog,
  speciesId: string,
  amount: number,
  basis: string
): { status: 'exact' | 'approximate' | 'not_verifiable'; count: number | null; scope: 'amount' | 'column' | null; reason?: string } {
  if (basis === 'amount') return { status: 'exact', count: amount, scope: 'amount' };
  if (basis === 'column_amount') return { status: 'exact', count: amount, scope: 'column' };
  if (basis === 'mass' || basis === 'column_mass') {
    const mm = molarMassOf(catalog, speciesId);
    if (mm.status === 'not_verifiable') {
      return { status: 'not_verifiable', count: null, scope: null, reason: `${mm.reason}: масса потока не переводится в моли` };
    }
    return { status: mm.status, count: amount / (mm.kgMol as number), scope: basis === 'mass' ? 'amount' : 'column' };
  }
  if (basis === 'molar_concentration' || basis === 'mass_concentration') {
    return { status: 'not_verifiable', count: null, scope: null, reason: `основание «${basis}» требует объёма для перевода в моли` };
  }
  if (basis === 'molar_fraction' || basis === 'mass_fraction') {
    return { status: 'not_verifiable', count: null, scope: null, reason: `основание-доля «${basis}» требует общего запаса системы для перевода в моли` };
  }
  if (basis === 'arbitrary_units') {
    return { status: 'not_verifiable', count: null, scope: null, reason: 'основание «arbitrary_units» не переводится в моли без калибровки' };
  }
  return { status: 'not_verifiable', count: null, scope: null, reason: `основание «${basis}» не переводится в моли` };
}

/** Слияние молярных счётов: исключения копятся, статусы объединяются. */
function mergeMolarCounts(results: MolarCountResult[]): MolarCountResult {
  const exclusions: AuditExclusion[] = [];
  const counts: Record<string, number> = {};
  let approximate = false;
  let scope: 'amount' | 'column' | null = null;
  for (const result of results) {
    exclusions.push(...result.exclusions);
    if (result.status === 'not_verifiable') {
      return { status: 'not_verifiable', counts: {}, exclusions, scope: null };
    }
    if (result.status === 'approximate') approximate = true;
    if (result.scope !== null) {
      if (scope === null) {
        scope = result.scope;
      } else if (scope !== result.scope) {
        exclusions.push({
          key: 'bases',
          reason: `смешение оснований: «${scope === 'amount' ? 'моли' : 'моли/м²'}» и «${result.scope === 'amount' ? 'моли' : 'моли/м²'}» не сопоставимы без площади`
        });
        return { status: 'not_verifiable', counts: {}, exclusions, scope: null };
      }
    }
    for (const [id, count] of Object.entries(result.counts)) {
      counts[id] = (counts[id] ?? 0) + count;
    }
  }
  return { status: approximate ? 'approximate' : 'exact', counts, exclusions, scope };
}

/** Молярные счёты системы резервуаров (basis-aware). */
export function reservoirsToMolarCounts(catalog: SpeciesCatalog, reservoirs: Record<string, ReservoirRecord>): MolarCountResult {
  const results: MolarCountResult[] = [];
  for (const res of Object.values(reservoirs)) {
    if (!res.material) continue;
    const converted = inventoryToMolarCounts(catalog, res.material);
    if (converted.status === 'not_verifiable') {
      results.push({
        ...converted,
        exclusions: converted.exclusions.map((excl) => ({ key: `${res.id}:${excl.key}`, reason: `резервуар «${res.id}»: ${excl.reason}` }))
      });
    } else {
      results.push(converted);
    }
  }
  return mergeMolarCounts(results);
}

/** Чистый внешний перенос в молярных счётах (basis-aware, по области). */
export function netExternalMolarCounts(catalog: SpeciesCatalog, ledger: FluxLedger, scope?: FluxAuditScope): MolarCountResult {
  const counts: Record<string, number> = {};
  const exclusions: AuditExclusion[] = [];
  let approximate = false;
  let countScope: 'amount' | 'column' | null = null;
  for (const rec of ledger.records) {
    if (rec.status !== 'applied' || rec.subject.subjectType !== 'substance' || rec.subject.quantityKind !== 'integrated') continue;
    if (!recordInScope(rec, scope)) continue;
    if (rec.kind === 'internal_transfer') continue;
    const subject = rec.subject as Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }>;
    const converted = fluxAmountToMolarCount(catalog, subject.speciesId, subject.amount, subject.basis);
    if (converted.status === 'not_verifiable') {
      exclusions.push({ key: rec.id, reason: `поток «${rec.id}»: ${converted.reason}` });
      return { status: 'not_verifiable', counts: {}, exclusions, scope: null };
    }
    if (converted.status === 'approximate') approximate = true;
    if (converted.scope !== null) {
      if (countScope === null) {
        countScope = converted.scope;
      } else if (countScope !== converted.scope) {
        exclusions.push({ key: 'bases', reason: 'смешение оснований: «моли» и «моли/м²» не сопоставимы без площади' });
        return { status: 'not_verifiable', counts: {}, exclusions, scope: null };
      }
    }
    const sign = rec.kind === 'external_input' ? 1 : -1;
    counts[subject.speciesId] = (counts[subject.speciesId] ?? 0) + sign * (converted.count as number);
  }
  return { status: approximate ? 'approximate' : 'exact', counts, exclusions, scope: countScope };
}

// ============================================
// 4б. АУДИТЫ СОХРАНЕНИЯ
// ============================================

function molarBasisOfAudit(catalog: SpeciesCatalog, ledger: FluxLedger, before: Record<string, ReservoirRecord>, after: Record<string, ReservoirRecord>, opts?: AuditOptions): { ok: true; before: MolarCountResult; after: MolarCountResult; net: MolarCountResult } | { ok: false; exclusions: AuditExclusion[] } {
  const beforeCounts = reservoirsToMolarCounts(catalog, before);
  const afterCounts = reservoirsToMolarCounts(catalog, after);
  const netCounts = netExternalMolarCounts(catalog, ledger, opts?.scope);
  if (beforeCounts.status === 'not_verifiable' || afterCounts.status === 'not_verifiable' || netCounts.status === 'not_verifiable') {
    return { ok: false, exclusions: [...beforeCounts.exclusions, ...afterCounts.exclusions, ...netCounts.exclusions] };
  }
  return { ok: true, before: beforeCounts, after: afterCounts, net: netCounts };
}

/**
 * Аудит сохранения вещества (Stage 4.1.1, basis-aware):
 * сравнивает изменение суммарного МОЛЯРНОГО счёта системы между
 * «до» и «после» с чистым внешним переносом. Массы переводятся
 * в моли по молярным массам видов; концентрации/доли/arbitrary_units
 * не переводятся — аудит сообщит not_verifiable, а не выдумает итог.
 * Внутренние переносы не меняют итог — если меняют, это расхождение.
 */
export function auditSubstanceConservation(
  catalog: SpeciesCatalog,
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  opts?: AuditOptions
): ConservationAuditResult {
  const tolerance = opts?.tolerance ?? 1e-9;
  const untimed = untimedRecordsOf(ledger, opts?.scope);
  const basis = molarBasisOfAudit(catalog, ledger, before, after, opts);
  if (!basis.ok) {
    return auditFrame('not_verifiable', basis.exclusions, untimed, tolerance);
  }
  const discrepancies: BalanceDiscrepancy[] = [];
  const ids = new Set([...Object.keys(basis.before.counts), ...Object.keys(basis.after.counts), ...Object.keys(basis.net.counts)]);
  for (const id of ids) {
    const expected = (basis.before.counts[id] ?? 0) + (basis.net.counts[id] ?? 0);
    const actual = basis.after.counts[id] ?? 0;
    if (Math.abs(expected - actual) > tolerance) {
      discrepancies.push({ key: id, expected, actual });
    }
  }
  if (discrepancies.length > 0) {
    return { status: 'imbalanced', balanced: false, discrepancies, excludedSpecies: [], exclusions: [], tolerance, untimedRecords: untimed };
  }
  const approximate = basis.before.status === 'approximate' || basis.after.status === 'approximate' || basis.net.status === 'approximate';
  return {
    status: approximate ? 'approximate' : 'balanced',
    balanced: !approximate,
    discrepancies: [],
    excludedSpecies: [],
    exclusions: [],
    tolerance,
    untimedRecords: untimed
  };
}

/**
 * Аудит сохранения элементов (Stage 4.1.1, basis-aware): тот же
 * принцип в пространстве элементов. Виды, не зарегистрированные
 * в каталоге (состав неизвестен), делают проверку НЕПРОВЕРЯЕМОЙ
 * и перечисляются явно: их вклад не выдумывается, «balanced» при
 * исключённых видах невозможен. Оценочные молярные массы дают
 * статус 'approximate' (численного расхождения нет, но итог
 * не выдаётся за точный).
 */
export function auditElementConservation(
  catalog: SpeciesCatalog,
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  opts?: AuditOptions
): ConservationAuditResult {
  const tolerance = opts?.tolerance ?? 1e-9;
  const untimed = untimedRecordsOf(ledger, opts?.scope);
  const basis = molarBasisOfAudit(catalog, ledger, before, after, opts);
  if (!basis.ok) {
    return auditFrame('not_verifiable', basis.exclusions, untimed, tolerance);
  }
  const beforeTotals = speciesElementTotals(catalog, basis.before.counts);
  const afterTotals = speciesElementTotals(catalog, basis.after.counts);
  const netTotals = speciesElementTotals(catalog, basis.net.counts);
  const excluded = new Set<string>([...beforeTotals.excludedSpecies, ...afterTotals.excludedSpecies, ...netTotals.excludedSpecies]);
  if (excluded.size > 0) {
    return auditFrame('not_verifiable', [], untimed, tolerance, [...excluded]);
  }
  const discrepancies: BalanceDiscrepancy[] = [];
  const elements = new Set([
    ...Object.keys(beforeTotals.totals),
    ...Object.keys(afterTotals.totals),
    ...Object.keys(netTotals.totals)
  ]);
  for (const el of elements) {
    const expected = (beforeTotals.totals[el] ?? 0) + (netTotals.totals[el] ?? 0);
    const actual = afterTotals.totals[el] ?? 0;
    if (Math.abs(expected - actual) > tolerance) {
      discrepancies.push({ key: el, expected, actual });
    }
  }
  if (discrepancies.length > 0) {
    return { status: 'imbalanced', balanced: false, discrepancies, excludedSpecies: [], exclusions: [], tolerance, untimedRecords: untimed };
  }
  const approximate = basis.before.status === 'approximate' || basis.after.status === 'approximate' || basis.net.status === 'approximate';
  return {
    status: approximate ? 'approximate' : 'balanced',
    balanced: !approximate,
    discrepancies: [],
    excludedSpecies: [],
    exclusions: [],
    tolerance,
    untimedRecords: untimed
  };
}

/**
 * Аудит сохранения электрического заряда (Stage 4.1.1, basis-aware):
 * суммарный заряд системы меняется только внешними потоками.
 * Беззарядная химия даёт нули — аудит всё равно проходит по общему
 * контракту. Исключённые виды или непереводимые основания делают
 * проверку непроверяемой, а не успешной.
 */
export function auditChargeConservation(
  catalog: SpeciesCatalog,
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  opts?: AuditOptions
): ConservationAuditResult {
  const tolerance = opts?.tolerance ?? 1e-9;
  const untimed = untimedRecordsOf(ledger, opts?.scope);
  const basis = molarBasisOfAudit(catalog, ledger, before, after, opts);
  if (!basis.ok) {
    return auditFrame('not_verifiable', basis.exclusions, untimed, tolerance);
  }
  const beforeCharge = chargeTotal(catalog, basis.before.counts);
  const afterCharge = chargeTotal(catalog, basis.after.counts);
  const netCharge = chargeTotal(catalog, basis.net.counts);
  const excluded = new Set<string>([...beforeCharge.excludedSpecies, ...afterCharge.excludedSpecies, ...netCharge.excludedSpecies]);
  if (excluded.size > 0) {
    return auditFrame('not_verifiable', [], untimed, tolerance, [...excluded]);
  }
  const expected = beforeCharge.charge + netCharge.charge;
  const actual = afterCharge.charge;
  const discrepancies: BalanceDiscrepancy[] =
    Math.abs(expected - actual) > tolerance
      ? [{ key: 'charge', expected, actual }]
      : [];
  if (discrepancies.length > 0) {
    return { status: 'imbalanced', balanced: false, discrepancies, excludedSpecies: [], exclusions: [], tolerance, untimedRecords: untimed };
  }
  const approximate = basis.before.status === 'approximate' || basis.after.status === 'approximate' || basis.net.status === 'approximate';
  return {
    status: approximate ? 'approximate' : 'balanced',
    balanced: !approximate,
    discrepancies: [],
    excludedSpecies: [],
    exclusions: [],
    tolerance,
    untimedRecords: untimed
  };
}

/**
 * Аудит энергетического баланса (Stage 4.1.1): запас энергии системы
 * меняется только за счёт внешних энергетических потоков (applied).
 * Мощность (rate) в балансе НЕ участвует — она не является
 * переданной энергией, пока не проинтегрирована и не зарегистрирована.
 *
 * КЛЮЧЕВОЕ: если запас энергии хотя бы одного резервуара неизвестен
 * (нет энергетического инвентаря или storedJ = null) в «до» или
 * «после», аудит возвращает not_verifiable. Отсутствие знания
 * НЕ приравнивается к нулю и не выдаётся за сбалансированность.
 */
export function auditEnergyConservation(
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  opts?: AuditOptions
): ConservationAuditResult {
  const tolerance = opts?.tolerance ?? 1e-9;
  const untimed = untimedRecordsOf(ledger, opts?.scope);
  const energyTotal = (reservoirs: Record<string, ReservoirRecord>): { value: number; problems: AuditExclusion[] } => {
    let sum = 0;
    const problems: AuditExclusion[] = [];
    for (const res of Object.values(reservoirs)) {
      if (!res.energy || res.energy.storedJ === null) {
        problems.push({
          key: res.id,
          reason: `запас энергии резервуара «${res.id}» неизвестен (нет инвентаря или storedJ = null): он не приравнивается к нулю`
        });
      } else {
        sum += res.energy.storedJ;
      }
    }
    return { value: sum, problems };
  };
  const beforeTotal = energyTotal(before);
  const afterTotal = energyTotal(after);
  const exclusions = [...beforeTotal.problems, ...afterTotal.problems];
  if (exclusions.length > 0) {
    return auditFrame('not_verifiable', exclusions, untimed, tolerance);
  }
  let netEnergyJ = 0;
  for (const rec of ledger.records) {
    if (rec.status !== 'applied') continue;
    if (rec.subject.subjectType !== 'energy' || rec.subject.quantityKind !== 'integrated') continue;
    if (!recordInScope(rec, opts?.scope)) continue;
    // Внутренний перенос энергии не меняет суммарный запас системы:
    // убыль источника равна прибавлению получателя. Меняют итог
    // только внешние энергетические потоки.
    if (rec.kind === 'internal_transfer') continue;
    netEnergyJ += rec.kind === 'external_input' ? rec.subject.energyJ : -rec.subject.energyJ;
  }
  const expected = beforeTotal.value + netEnergyJ;
  const actual = afterTotal.value;
  const discrepancies: BalanceDiscrepancy[] =
    Math.abs(expected - actual) > tolerance ? [{ key: 'energy', expected, actual }] : [];
  return {
    status: discrepancies.length === 0 ? 'balanced' : 'imbalanced',
    balanced: discrepancies.length === 0,
    discrepancies,
    excludedSpecies: [],
    exclusions: [],
    tolerance,
    untimedRecords: untimed
  };
}

// ============================================
// 4в. ПОФАЗОВЫЙ АУДИТ РЕЗЕРВУАРОВ
// ============================================

export interface ReservoirFluxAuditResult {
  status: ConservationStatus;
  balanced: boolean;
  discrepancies: BalanceDiscrepancy[];
  exclusions: AuditExclusion[];
  untimedRecords: string[];
  tolerance: number;
}

/**
 * Пофазовый аудит применения потоков (Stage 4.1.1): сверяет фактические
 * изменения каждого резервуара с ожидаемыми Δ от каждого applied-
 * потока в области. Ловит «вещество ушло не туда»: суммарный аудит
 * системы при этом остаётся сбалансированным, но пофазовый находит
 * неверного получателя/источник.
 *
 * Непроверяемые вклады (неизвестный запас энергии, отсутствующий
 * инвентарь, несовместимое основание) не заносятся в расхождения —
 * они исключаются с явной причиной.
 */
export function auditReservoirFluxes(
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  opts?: AuditOptions
): ReservoirFluxAuditResult {
  const tolerance = opts?.tolerance ?? 1e-9;
  const untimed = untimedRecordsOf(ledger, opts?.scope);

  interface ExpectedDelta {
    species: Record<string, { delta: number; basis: string }>;
    energyJ: number;
    hasEnergy: boolean;
  }
  const expected = new Map<string, ExpectedDelta>();
  const deltaOf = (reservoirId: string): ExpectedDelta => {
    let d = expected.get(reservoirId);
    if (!d) {
      d = { species: {}, energyJ: 0, hasEnergy: false };
      expected.set(reservoirId, d);
    }
    return d;
  };

  for (const rec of ledger.records) {
    if (rec.status !== 'applied' || rec.subject.quantityKind !== 'integrated') continue;
    if (!recordInScope(rec, opts?.scope)) continue;
    const sides: Array<{ reservoirId: string; sign: 1 | -1 }> =
      rec.kind === 'internal_transfer'
        ? [{ reservoirId: rec.from, sign: -1 }, { reservoirId: rec.to, sign: 1 }]
        : rec.kind === 'external_input'
          ? [{ reservoirId: rec.to, sign: 1 }]
          : [{ reservoirId: rec.from, sign: -1 }];
    if (rec.subject.subjectType === 'substance') {
      const subject = rec.subject as Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }>;
      for (const side of sides) {
        const d = deltaOf(side.reservoirId);
        const prev = d.species[subject.speciesId];
        if (prev && prev.basis !== subject.basis) {
          // несогласованные основания одного вида у одного резервуара
          d.species[subject.speciesId] = { delta: NaN, basis: prev.basis };
        } else {
          d.species[subject.speciesId] = { delta: (prev?.delta ?? 0) + side.sign * subject.amount, basis: subject.basis };
        }
      }
    } else {
      const subject = rec.subject as Extract<FluxSubject, { subjectType: 'energy'; quantityKind: 'integrated' }>;
      for (const side of sides) {
        const d = deltaOf(side.reservoirId);
        d.energyJ += side.sign * subject.energyJ;
        d.hasEnergy = true;
      }
    }
  }

  const discrepancies: BalanceDiscrepancy[] = [];
  const exclusions: AuditExclusion[] = [];

  for (const [reservoirId, delta] of expected) {
    const beforeRes = before[reservoirId];
    const afterRes = after[reservoirId];
    if (!beforeRes || !afterRes) {
      exclusions.push({ key: reservoirId, reason: `резервуар «${reservoirId}» отсутствует в состоянии «${!beforeRes ? 'до' : 'после'}»: пофазовая проверка невозможна` });
      continue;
    }
    for (const [speciesId, spec] of Object.entries(delta.species)) {
      if (Number.isNaN(spec.delta)) {
        exclusions.push({ key: `${reservoirId}:${speciesId}`, reason: `резервуар «${reservoirId}»: потоки вида «${speciesId}» имеют несовместимые основания` });
        continue;
      }
      const beforeInv = beforeRes.material;
      const afterInv = afterRes.material;
      if (!beforeInv || !afterInv) {
        exclusions.push({ key: `${reservoirId}:${speciesId}`, reason: `резервуар «${reservoirId}»: материальный инвентарь не задан в состоянии «${!beforeInv ? 'до' : 'после'}» — пофазовая проверка невозможна` });
        continue;
      }
      if (beforeInv.basis !== afterInv.basis || beforeInv.basis !== spec.basis) {
        exclusions.push({ key: `${reservoirId}:${speciesId}`, reason: `резервуар «${reservoirId}»: основание инвентаря («${beforeInv.basis}»/«${afterInv.basis}») не совпадает с основанием потока «${spec.basis}»` });
        continue;
      }
      const beforeAmount = beforeInv.entries[speciesId] ?? 0;
      const afterAmount = afterInv.entries[speciesId] ?? 0;
      const expectedAmount = beforeAmount + spec.delta;
      if (Math.abs(expectedAmount - afterAmount) > tolerance) {
        discrepancies.push({
