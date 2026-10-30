// ============================================
// FLUX LEDGER - Учёт потоков вещества и энергии
// ============================================
//
// Единая система регистрации переносов между резервуарами и через
// внешнюю границу системы (Stage 4.1). Сами процессы (испарение,
// конденсация, вулканизм, ускользание атмосферы, ...) НЕ реализуются
// на этом этапе — реализуется их согласованный учёт.
//
// Главные правила:
// - три вида потоков, не смешиваемых между собой:
//   internal_transfer (между внутренними резервуарами),
//   external_input (поступление извне),
//   external_output (потеря системой); внешний поток нельзя
//   замаскировать под внутренний перенос;
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
// Материя не создаётся и не уничтожается «внутри системы»:
// изменение суммарного инвентаря допустимо ТОЛЬКО за счёт
// внешних потоков; внутренние переносы сохраняют итог.

import type { InventoryBasis, ReservoirRecord } from './reservoir';
import { addMaterial, removeMaterial, validateMaterialInventory } from './reservoir';
import type { ScientificSpecies, SpeciesCatalog } from './species';
import { elementTotals as speciesElementTotals, chargeTotal } from './species';

// ============================================
// 1. ТИПЫ ПОТОКОВ
// ============================================

/** Идентификатор внешней границы системы. */
export const EXTERNAL = 'external';

export type FluxKind = 'internal_transfer' | 'external_input' | 'external_output';

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
    | 'unknown_reservoir';
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
 * Применить поток к состоянию резервуаров.
 * Идемпотентность: pending-поток становится applied; повторное
 * применение applied/потока — ошибка already_applied (двойного
 * применения не бывает).
 *
 * Rate-потоки к инвентарю НЕ применяются (ошибка rate_not_applicable):
 * сначала integrateSubstanceRate/integratePower.
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

  // Энергетические потоки не меняют материальный инвентарь;
  // учёт энергии ведётся в энергетическом инвентаре резервуаров
  // (в Stage 4.1 — только фиксация факта передачи; накопление
  // энергии не моделируется, чтобы не выдавать интерфейс за модель).
  if (rec.subject.subjectType === 'energy') {
    return {
      ledger: {
        records: ledger.records.map((r) => (r.id === fluxId ? { ...r, status: 'applied' as FluxStatus } : r))
      },
      reservoirs: next
    };
  }

  const subject = rec.subject as Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }>;

  const checkBasis = (reservoirId: string): void => {
    const res = next[reservoirId];
    if (!res) {
      throw new FluxLedgerError('unknown_reservoir', `резервуар «${reservoirId}» не существует`, fluxId);
    }
    if (res.material && res.material.basis !== subject.basis) {
      throw new FluxLedgerError(
        'invalid_flux',
        `резервуар «${reservoirId}» хранит инвентарь в основании «${res.material.basis}», а поток «${fluxId}» — в «${subject.basis}»: основания несовместимы`,
        fluxId
      );
    }
    if (!res.material) {
      // Инвентаря нет — создаём пустой в основании потока.
      next[reservoirId] = { ...res, material: { basis: subject.basis, entries: {} } };
    }
  };

  if (rec.kind === 'internal_transfer') {
    checkBasis(rec.from);
    checkBasis(rec.to);
    const source = next[rec.from];
    if (source.material) {
      const available = source.material.entries[subject.speciesId] ?? 0;
      if (available < subject.amount) {
        throw new FluxLedgerError(
          'invalid_flux',
          `резервуар «${rec.from}» содержит ${available} «${subject.speciesId}», а перенос «${fluxId}» требует ${subject.amount}`,
          fluxId
        );
      }
    }
    // Атомарно: сначала убыль, затем прибавление; при ошибке
    // на любом шаге исключение прерывает применение до
    // записи applied-статуса.
    next[rec.from] = removeMaterial(next[rec.from], subject.speciesId, subject.amount);
    next[rec.to] = addMaterial(next[rec.to], subject.speciesId, subject.amount);
  } else if (rec.kind === 'external_input') {
    checkBasis(rec.to);
    next[rec.to] = addMaterial(next[rec.to], subject.speciesId, subject.amount);
  } else {
    checkBasis(rec.from);
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
  if (rec.subject.subjectType === 'energy') {
    return {
      ledger: { records: ledger.records.map((r) => (r.id === fluxId ? { ...r, status: 'reverted' as FluxStatus } : r)) },
      reservoirs
    };
  }
  const subject = rec.subject as Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }>;
  const next: Record<string, ReservoirRecord> = { ...reservoirs };

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

export interface BalanceDiscrepancy {
  key: string;
  expected: number;
  actual: number;
}

export interface ConservationAuditResult {
  /** Согласуется ли фактическое изменение с потоками. */
  balanced: boolean;
  /** Расхождения (пусто при balanced=true). */
  discrepancies: BalanceDiscrepancy[];
  /** Виды, исключённые из проверки (не зарегистрированы в каталоге). */
  excludedSpecies: string[];
  /** Абсолютный допуск сравнения (в единицах инвентаря). */
  tolerance: number;
}

/**
 * Суммарный инвентарь по веществам для набора резервуаров
 * (только резервуары с материальным инвентарём; основания
 * резервуаров должны быть согласованы вызывающим кодом —
 * аудит сравнивает резервуары с ОДНИМ основанием).
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
export function netExternalTransfers(ledger: FluxLedger): Record<string, number> {
  const net: Record<string, number> = {};
  for (const rec of ledger.records) {
    if (rec.status !== 'applied' || rec.subject.subjectType !== 'substance' || rec.subject.quantityKind !== 'integrated') continue;
    const sign = rec.kind === 'external_input' ? 1 : rec.kind === 'external_output' ? -1 : 0;
    if (sign === 0) continue;
    net[rec.subject.speciesId] = (net[rec.subject.speciesId] ?? 0) + sign * rec.subject.amount;
  }
  return net;
}

/**
 * Аудит сохранения вещества: сравнивает изменение суммарного
 * инвентаря системы между «до» и «после» с чистым внешним переносом.
 * Внутренние переносы не меняют итог — если меняют, это расхождение.
 */
export function auditSubstanceConservation(
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  tolerance = 1e-9
): ConservationAuditResult {
  const beforeTotals = totalInventory(before).totals;
  const afterTotals = totalInventory(after).totals;
  const net = netExternalTransfers(ledger);
  const discrepancies: BalanceDiscrepancy[] = [];
  const ids = new Set([...Object.keys(beforeTotals), ...Object.keys(afterTotals), ...Object.keys(net)]);
  for (const id of ids) {
    const expected = (beforeTotals[id] ?? 0) + (net[id] ?? 0);
    const actual = afterTotals[id] ?? 0;
    if (Math.abs(expected - actual) > tolerance) {
      discrepancies.push({ key: id, expected, actual });
    }
  }
  return { balanced: discrepancies.length === 0, discrepancies, excludedSpecies: [], tolerance };
}

/**
 * Аудит сохранения элементов: тот же принцип, но в пространстве
 * элементов (по каталогу видов). Виды с неизвестным составом
 * исключаются из подсчёта и перечисляются явно — их вклад
 * не выдумывается.
 */
export function auditElementConservation(
  catalog: SpeciesCatalog,
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  tolerance = 1e-9
): ConservationAuditResult {
  const beforeTotals = speciesElementTotals(catalog, totalInventory(before).totals);
  const afterTotals = speciesElementTotals(catalog, totalInventory(after).totals);
  // Внешние переносы в единицах элементов.
  const netExternal: Record<string, number> = {};
  const excluded = new Set<string>([...beforeTotals.excludedSpecies, ...afterTotals.excludedSpecies]);
  for (const rec of ledger.records) {
    if (rec.status !== 'applied' || rec.subject.subjectType !== 'substance' || rec.subject.quantityKind !== 'integrated') continue;
    if (rec.kind === 'internal_transfer') continue;
    const species: ScientificSpecies | null = catalog.get(rec.subject.speciesId);
    if (!species) {
      excluded.add(rec.subject.speciesId);
      continue;
    }
    const sign = rec.kind === 'external_input' ? 1 : -1;
    for (const [el, count] of Object.entries(species.elements)) {
      netExternal[el] = (netExternal[el] ?? 0) + sign * count * rec.subject.amount;
    }
  }
  const discrepancies: BalanceDiscrepancy[] = [];
  const elements = new Set([
    ...Object.keys(beforeTotals.totals),
    ...Object.keys(afterTotals.totals),
    ...Object.keys(netExternal)
  ]);
  for (const el of elements) {
    const expected = (beforeTotals.totals[el] ?? 0) + (netExternal[el] ?? 0);
    const actual = afterTotals.totals[el] ?? 0;
    if (Math.abs(expected - actual) > tolerance) {
      discrepancies.push({ key: el, expected, actual });
    }
  }
  return {
    balanced: discrepancies.length === 0,
    discrepancies,
    excludedSpecies: [...excluded],
    tolerance
  };
}

/**
 * Аудит сохранения электрического заряда: суммарный заряд системы
 * меняется только внешними потоками. Беззарядная химия даёт нули —
 * аудит всё равно проходит по общему контракту.
 */
export function auditChargeConservation(
  catalog: SpeciesCatalog,
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  tolerance = 1e-9
): ConservationAuditResult {
  const beforeCharge = chargeTotal(catalog, totalInventory(before).totals);
  const afterCharge = chargeTotal(catalog, totalInventory(after).totals);
  let externalCharge = 0;
  const excluded = new Set<string>([...beforeCharge.excludedSpecies, ...afterCharge.excludedSpecies]);
  for (const rec of ledger.records) {
    if (rec.status !== 'applied' || rec.subject.subjectType !== 'substance' || rec.subject.quantityKind !== 'integrated') continue;
    if (rec.kind === 'internal_transfer') continue;
    const species = catalog.get(rec.subject.speciesId);
    if (!species) {
      excluded.add(rec.subject.speciesId);
      continue;
    }
    externalCharge += (rec.kind === 'external_input' ? 1 : -1) * species.charge * rec.subject.amount;
  }
  const expected = beforeCharge.charge + externalCharge;
  const actual = afterCharge.charge;
  const discrepancies: BalanceDiscrepancy[] =
    Math.abs(expected - actual) > tolerance
      ? [{ key: 'charge', expected, actual }]
      : [];
  return {
    balanced: discrepancies.length === 0,
    discrepancies,
    excludedSpecies: [...excluded],
    tolerance
  };
}

/**
 * Аудит энергетического баланса: запас энергии системы меняется
 * только за счёт энергетических потоков (applied). Мощность (rate)
 * в балансе НЕ участвует — она не является переданной энергией,
 * пока не проинтегрирована и не зарегистрирована.
 */
export function auditEnergyConservation(
  ledger: FluxLedger,
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  tolerance = 1e-9
): ConservationAuditResult {
  const total = (reservoirs: Record<string, ReservoirRecord>): number => {
    let sum = 0;
    for (const res of Object.values(reservoirs)) {
      if (res.energy && res.energy.storedJ !== null) {
        sum += res.energy.storedJ;
      }
    }
    return sum;
  };
  let netEnergyJ = 0;
  for (const rec of ledger.records) {
    if (rec.status !== 'applied') continue;
    if (rec.subject.subjectType === 'energy' && rec.subject.quantityKind === 'integrated') {
      // Внутренний перенос энергии не меняет суммарный запас системы:
      // убыль источника равна прибавлению получателя. Меняют итог
      // только внешние энергетические потоки.
      if (rec.kind === 'internal_transfer') continue;
      netEnergyJ += rec.kind === 'external_input' ? rec.subject.energyJ : -rec.subject.energyJ;
    }
  }
  const expected = total(before) + netEnergyJ;
  const actual = total(after);
  const discrepancies: BalanceDiscrepancy[] =
    Math.abs(expected - actual) > tolerance ? [{ key: 'energy', expected, actual }] : [];
  return { balanced: discrepancies.length === 0, discrepancies, excludedSpecies: [], tolerance };
}

/**
 * Проверка целостности записей реестра относительно набора резервуаров:
 * все from/to (кроме EXTERNAL) должны существовать.
 * Возвращает список проблем (пустой = реестр согласован).
 */
export function validateLedgerReferences(
  ledger: FluxLedger,
  reservoirs: Record<string, ReservoirRecord>
): string[] {
  const problems: string[] = [];
  for (const rec of ledger.records) {
    for (const side of [rec.from, rec.to]) {
      if (side !== EXTERNAL && !(side in reservoirs)) {
        problems.push(`поток «${rec.id}» ссылается на несуществующий резервуар «${side}»`);
      }
    }
  }
  return problems;
}

/** Проверка валидности всех материальных инвентарей набора резервуаров. */
export function validateReservoirInventories(reservoirs: Record<string, ReservoirRecord>): string[] {
  const problems: string[] = [];
  for (const res of Object.values(reservoirs)) {
    if (res.material) {
      const check = validateMaterialInventory(res.material);
      if (!check.valid) {
        problems.push(`резервуар «${res.id}»: ${check.errors.join('; ')}`);
      }
    }
  }
  return problems;
}
