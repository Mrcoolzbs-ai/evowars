// ============================================
// INVARIANT AUDITOR - Общий аудит инвариантов перехода
// ============================================
//
// Stage 4.2.1. Единая точка проверки перехода состояния мира
// «before → процесс → after» перед фиксацией нового состояния.
// Аудитор ОБЪЕДИНЯЕТ существующие контрактные проверки Stage 4.1
// (вещественный, элементный, зарядовый и энергетический балансы,
// пофазовый аудит резервуаров, валидация реестра потоков, записей
// резервуаров и состояния мира) — новых правил физики не выдумывает.
//
// Статусы — существующая система ConservationStatus:
// - balanced:        полный аудит прошёл, расхождений нет;
// - imbalanced:      инвариант нарушен (или секция invalid);
// - approximate:     проверяемо, но с приближёнными вкладами
//                    (approximate НЕ является balanced);
// - not_verifiable:  есть непроверяемые вклады или неполная граница
//                    системы.
//
// Правила честности (Stage 4.1.1.2 / 4.1.1.3 сохраняются):
// - unknown не превращается в ноль: неизвестный запас делает итог
//   not_verifiable, а не balanced;
// - untimed-записи в ограниченной временной области не маскируются
//   как успешный результат (правила FluxAuditScope сохранены);
// - внутренние переносы, корректно отражённые в ledger, дисбалансом
//   НЕ являются; внешние источники и стоки учитываются явно;
// - balanced = true только при полном статусе balanced и полной
//   границе системы (boundary = 'complete').

import type { CoreWorldState } from './worldState';
import { validateWorldState } from './worldState';
import type { SpeciesCatalog } from './species';
import type { BalanceDiscrepancy, ConservationStatus, FluxAuditScope, FluxLedger } from './fluxLedger';
import {
  auditChargeConservation,
  auditElementConservation,
  auditEnergyConservation,
  auditReservoirFluxes,
  auditSubstanceConservation,
  validateFluxLedger,
  validateLedgerReferences,
  validateReservoirInventories
} from './fluxLedger';
import type { ReactionLedger } from './reactionLedger';
import { auditReactionLedger } from './reactionLedger';
import type { ReservoirRecord } from './reservoir';
import { comparePoints, now, validateClock } from './simulationClock';

// ============================================
// 1. ТИПЫ
// ============================================

/** Полнота границы системы для аудита. */
export type BoundaryCompleteness = 'complete' | 'unknown' | 'incomplete';

/** Секция аудита перехода: статус + конкретные проблемы. */
export interface WorldTransitionAuditSection {
  key:
    | 'substance'
    | 'element'
    | 'charge'
    | 'energy'
    | 'reservoir_fluxes'
    | 'nonnegativity'
    | 'ledger'
    | 'reactions'
    | 'state'
    | 'time';
  status: ConservationStatus | 'invalid';
  issues: string[];
}

/** Итог общего аудита перехода состояния мира. */
export interface WorldTransitionAudit {
  status: ConservationStatus;
  /** Истинно ТОЛЬКО при status === 'balanced'. */
  balanced: boolean;
  sections: readonly WorldTransitionAuditSection[];
  diagnostics: readonly string[];
  boundary: BoundaryCompleteness;
}

// ============================================
// 2. АУДИТ ПЕРЕХОДА
// ============================================

/**
 * Общий аудит перехода «before → процесс → after».
 *
 * ledger — записи потоков, относящиеся к проверяемому переходу
 * (например, добавленные за шаг планировщика): по ним аудиты балансов
 * объясняют изменения инвентарей. Внутренний перенос, корректно
 * отражённый в ledger, дисбалансом НЕ является; внешние источники и
 * стоки учитываются явно по kind записей.
 *
 * Секции:
 * 1. материальный инвентарь (вещества);
 * 2. элементный состав;
 * 3. электрический заряд;
 * 4. энергетические запасы;
 * 5. пофазовое изменение резервуаров;
 * 6. неотрицательность запасов (в состоянии «после»);
 * 7. согласованность FluxLedger (форма, ссылки, инвентари);
 * 8. реакционные транзакции (Stage 4.2.3.3): форма журнала и
 *    стехиометрический элементный/зарядовый баланс каждой записи —
 *    отдельно от потоков, без преобразования реакций в FluxRecord
 *    и без использования записей как объяснения изменений
 *    инвентарей;
 * 9. допустимость ссылок и состояний (validateWorldState);
 * 10. состояние времени (часы корректны, время не идёт назад).
 *
 * Агрегация: any invalid/imbalanced → imbalanced; иначе any
 * not_verifiable или неполная граница → not_verifiable; иначе any
 * approximate → approximate; иначе balanced. balanced = true только
 * при статусе balanced.
 */
export function auditWorldTransition(
  before: CoreWorldState,
  after: CoreWorldState,
  ledger: FluxLedger,
  opts: {
    speciesCatalog: SpeciesCatalog;
    /** Полнота границы системы: неполная граница не даёт balanced. */
    boundary: BoundaryCompleteness;
    tolerance?: number;
    scope?: FluxAuditScope;
    /**
     * Журнал реакционных транзакций перехода (Stage 4.2.3.3):
     * записи реакций, относящиеся к проверяемому переходу (аналог
     * позиционного ledger для потоков). Необязателен: отсутствие
     * означает «транзакций не было» (пустой журнал, не ошибка).
     */
    reactionLedger?: ReactionLedger;
  }
): WorldTransitionAudit {
  const sections: WorldTransitionAuditSection[] = [];
  const push = (key: WorldTransitionAuditSection['key'], status: WorldTransitionAuditSection['status'], issues: string[]): void => {
    sections.push({ key, status, issues });
  };
  const auditOpts = { tolerance: opts.tolerance, scope: opts.scope };
  const beforeReservoirs = reservoirsRecordOf(before);
  const afterReservoirs = reservoirsRecordOf(after);

  const conservationIssues = (result: {
    discrepancies: BalanceDiscrepancy[];
    exclusions: { key: string; reason: string }[];
    untimedRecords: string[];
    excludedSpecies?: string[];
  }): string[] => {
    const issues: string[] = [];
    for (const d of result.discrepancies) {
      issues.push(formatDiscrepancy(d));
    }
    for (const e of result.exclusions) {
      issues.push(e.key + ': ' + e.reason);
    }
    for (const speciesId of result.excludedSpecies ?? []) {
      issues.push('вид «' + speciesId + '» не зарегистрирован в каталоге: вклад неизвестен');
    }
    if (result.untimedRecords.length > 0) {
      issues.push('записи без привязки ко времени исключены из области: ' + result.untimedRecords.join(', '));
    }
    return issues;
  };

  const substance = auditSubstanceConservation(opts.speciesCatalog, ledger, beforeReservoirs, afterReservoirs, auditOpts);
  push('substance', substance.status, conservationIssues(substance));

  const element = auditElementConservation(opts.speciesCatalog, ledger, beforeReservoirs, afterReservoirs, auditOpts);
  push('element', element.status, conservationIssues(element));

  const charge = auditChargeConservation(opts.speciesCatalog, ledger, beforeReservoirs, afterReservoirs, auditOpts);
  push('charge', charge.status, conservationIssues(charge));

  const energy = auditEnergyConservation(ledger, beforeReservoirs, afterReservoirs, auditOpts);
  push('energy', energy.status, conservationIssues(energy));

  const reservoirFluxes = auditReservoirFluxes(ledger, beforeReservoirs, afterReservoirs, auditOpts);
  push('reservoir_fluxes', reservoirFluxes.status, conservationIssues(reservoirFluxes));

  // Неотрицательность запасов в состоянии «после».
  const negative: string[] = [];
  for (const res of after.reservoirs) {
    if (res.material !== undefined) {
      for (const [speciesId, amount] of Object.entries(res.material.entries)) {
        if (typeof amount === 'number' && amount < 0) {
          negative.push('резервуар «' + res.id + '», вид «' + speciesId + '»: отрицательный запас ' + String(amount));
        }
      }
    }
    if (res.energy !== undefined && res.energy.storedJ !== null && res.energy.storedJ < 0) {
      negative.push('резервуар «' + res.id + '»: отрицательный запас энергии ' + String(res.energy.storedJ) + ' Дж');
    }
  }
  push('nonnegativity', negative.length > 0 ? 'imbalanced' : 'balanced', negative);

  // Согласованность реестра потоков и инвентарей.
  const ledgerProblems: string[] = [
    ...validateFluxLedger(ledger),
    ...validateLedgerReferences(ledger, afterReservoirs),
    ...validateReservoirInventories(afterReservoirs)
  ];
  push('ledger', ledgerProblems.length > 0 ? 'invalid' : 'balanced', ledgerProblems);

  // Реакционные транзакции (Stage 4.2.3.3). Реакция —
  // многокомпонентное ПРЕВРАЩЕНИЕ, а не перенос: записи проверяются
  // ОТДЕЛЬНО от FluxLedger и никогда не преобразуются в потоки
  // (двойной счёт невозможен по построению). Секция объединяет форму
  // журнала (включая ссылки участников на резервуары) и
  // стехиометрический элементный/зарядовый баланс каждой записи —
  // баланс реакций учитывается в общем итоге аудита. Записи НЕ
  // считаются объяснением изменений инвентарей: ReactionLedger
  // фиксирует транзакции, но не применяет их к запасам, поэтому
  // инвентарные секции выше объясняются только потоками. Пустой
  // журнал/его отсутствие — не ошибка (balanced).
  const reactionAudit = auditReactionLedger(opts.reactionLedger ?? { records: [] }, opts.speciesCatalog, {
    tolerance: opts.tolerance,
    reservoirIds: Object.keys(afterReservoirs)
  });
  const reactionIssues: string[] = [...reactionAudit.formIssues];
  for (const recordAudit of reactionAudit.recordAudits) {
    if (recordAudit.status !== 'balanced' && recordAudit.issues.length > 0) {
      reactionIssues.push((recordAudit.recordId ?? 'запись без id') + ': ' + recordAudit.issues.join('; '));
    } else if (recordAudit.status !== 'balanced') {
      reactionIssues.push((recordAudit.recordId ?? 'запись без id') + ': статус ' + recordAudit.status);
    }
  }
  push('reactions', reactionAudit.status, reactionIssues);

  // Допустимость ссылок и состояний (до и после).
  const stateProblems: string[] = [];
  for (const issue of validateWorldState(before)) {
    stateProblems.push('before: [' + issue.code + '] ' + issue.message);
  }
  for (const issue of validateWorldState(after)) {
    stateProblems.push('after: [' + issue.code + '] ' + issue.message);
  }
  push('state', stateProblems.length > 0 ? 'invalid' : 'balanced', stateProblems);

  // Состояние времени: часы корректны, время не идёт назад.
  const beforeClockIssues = validateClock(before.clock);
  const afterClockIssues = validateClock(after.clock);
  if (beforeClockIssues.length > 0 || afterClockIssues.length > 0) {
    push('time', 'invalid', [
      ...beforeClockIssues.map((i) => 'before: ' + i),
      ...afterClockIssues.map((i) => 'after: ' + i)
    ]);
  } else if (comparePoints(now(after.clock), now(before.clock)) < 0) {
    push('time', 'imbalanced', ['время мира идёт назад: момент «после» раньше момента «до»']);
  } else {
    push('time', 'balanced', []);
  }

  // Агрегация: нарушения > непроверяемость > приближённость.
  let status: ConservationStatus;
  if (sections.some((s) => s.status === 'invalid' || s.status === 'imbalanced')) {
    status = 'imbalanced';
  } else if (sections.some((s) => s.status === 'not_verifiable') || opts.boundary !== 'complete') {
    status = 'not_verifiable';
  } else if (sections.some((s) => s.status === 'approximate')) {
    status = 'approximate';
  } else {
    status = 'balanced';
  }

  const diagnostics: string[] = [];
  for (const s of sections) {
    if (s.status !== 'balanced') {
      if (s.issues.length > 0) {
        for (const issue of s.issues) {
          diagnostics.push(s.key + ': ' + issue);
        }
      } else {
        diagnostics.push(s.key + ': статус ' + s.status);
      }
    }
  }
  if (opts.boundary !== 'complete') {
    diagnostics.push(
      'boundary: граница системы ' + (opts.boundary === 'unknown' ? 'неизвестна' : 'неполна') + ' — итог не может быть balanced'
    );
  }

  return { status, balanced: status === 'balanced', sections, diagnostics, boundary: opts.boundary };
}

// ============================================
// 3. ВСПОМОГАТЕЛЬНЫЕ
// ============================================

/** Записи резервуаров состояния мира как словарь id → запись (для аудитов). */
function reservoirsRecordOf(state: CoreWorldState): Record<string, ReservoirRecord> {
  const record: Record<string, ReservoirRecord> = {};
  for (const res of state.reservoirs) {
    record[res.id] = res;
  }
  return record;
}

function formatDiscrepancy(d: BalanceDiscrepancy): string {
  const place = d.reservoirId !== undefined ? ' (резервуар «' + d.reservoirId + '»)' : '';
  return d.key + place + ': ожидалось ' + String(d.expected) + ', фактически ' + String(d.actual);
}
