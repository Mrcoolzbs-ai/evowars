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
// Статусы секций — существующая система ConservationStatus плюс
// 'invalid' (Stage 4.2.3.3.1 — документация устоявшейся семантики):
// - balanced:        секция проверена полностью, расхождений нет;
// - imbalanced:      численное нарушение проверяемого инварианта
//                    (физическое расхождение: дисбаланс элементов,
//                    заряда, отрицательный запас, время назад);
// - approximate:     проверяемо, но с приближёнными вкладами
//                    (approximate НЕ является balanced);
// - not_verifiable:  есть непроверяемые вклады или неполная граница
//                    системы — честное «неизвестно», не ноль и не
//                    успех;
// - invalid:         структурная некорректность данных (форма
//                    записи, ссылки, состояние) — проверка физики
//                    невозможна; это НЕ то же самое, что imbalanced.
//
// Агрегация общего статуса перехода — существующее правило: любая
// секция invalid или imbalanced даёт общий imbalanced. Следствие
// (4.2.3.3.1): общий imbalanced сам по себе НЕ доказывает
// физического нарушения закона сохранения — конкретную причину
// определяют секции и их диагностика (например, секция reactions
// может быть invalid из-за формы записи реакций). Секции со статусом
// not_verifiable или approximate НЕ превращаются ни в balanced, ни
// в imbalanced. Scheduler сохраняет прежнюю политику отклонения:
// шаг отклоняется по общему imbalanced (reject-правило не менялось).
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
//
// Корректирующая ревизия Stage 4.2.3.4.1 (секция reaction_inventory:
// prototype-safe speciesId, численная устойчивость, tolerance):
// - speciesId — произвольная непустая строка ('__proto__',
//   'constructor', 'toString'): количество вида в инвентаре
//   читается только по СОБСТВЕННОМУ ключу (ownEntryAmount) —
//   отсутствие собственного ключа означает известный ноль,
//   унаследованное свойство прототипа количеством не является;
// - конечность проверяется у потокового вклада, реакционного
//   вклада, их суммы, фактического изменения запаса и ожидаемого
//   итогового количества (до + ожидаемое Δ): непредставимое число —
//   честное not_verifiable с диагностикой, а не imbalanced —
//   NaN/Infinity не доказывают нарушения закона сохранения;
//   настоящий конечный дисбаланс сверх tolerance по-прежнему
//   imbalanced;
// - tolerance — конечное неотрицательное число (единая политика
//   resolveAuditTolerance с auditReactionLedger): NaN, ±Infinity и
//   отрицательные значения — контролируемый invalid, который не
//   может дать balanced даже при пустом журнале реакций.

import type { CoreWorldState } from './worldState';
import { validateWorldState } from './worldState';
import type { SpeciesCatalog } from './species';
import type { AuditOptions, BalanceDiscrepancy, ConservationStatus, FluxAuditScope, FluxLedger, FluxSubject } from './fluxLedger';
import {
  auditChargeConservation,
  auditElementConservation,
  auditEnergyConservation,
  auditReservoirFluxes,
  auditSubstanceConservation,
  excludedUntimed,
  ownEntryAmount,
  recordInScope,
  validateFluxLedger,
  validateLedgerReferences,
  validateReservoirInventories
} from './fluxLedger';
import type { ReactionInventoryDeltas, ReactionLedger } from './reactionLedger';
import { auditReactionLedger, reactionInventoryDeltas, resolveAuditTolerance } from './reactionLedger';
import type { ReservoirRecord } from './reservoir';
import { isPlainRecord } from './reservoir';
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
    | 'reaction_inventory'
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
 *    отдельно от потоков и без преобразования реакций в FluxRecord;
 * 9. согласование реакционных транзакций с материальными
 *    инвентарями (Stage 4.2.3.4, секция reaction_inventory):
 *    ожидаемые изменения ±coefficient × extent по паре
 *    (reservoirId, speciesId) сопоставляются с фактической разницей
 *    инвентарей «до»/«после» с учётом потоковых вкладов той же
 *    пары; реакции и потоки — раздельные источники объяснения,
 *    каждый вклад учитывается ровно один раз;
 * 10. допустимость ссылок и состояний (validateWorldState);
 * 11. состояние времени (часы корректны, время не идёт назад).
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
  // Stage 4.2.3.4: реакционные вклади ±coefficient × extent по паре
  // (reservoirId, speciesId) рассчитываются из записей ПЕРЕХОДА и
  // передаются аудитам инвентарей типизированным списком — реакции
  // НЕ превращаются в FluxRecord и в FluxLedger не попадают. Вклады
  // агрегированы по парам; структурные проблемы журнала дают invalid
  // секции reaction_inventory, непредставимые вклады — честный
  // not_verifiable без выдуманного нуля.
  const reactionDeltas = reactionInventoryDeltas(opts.reactionLedger ?? { records: [] });
  const auditOpts = { tolerance: opts.tolerance, scope: opts.scope, reactionDeltas: reactionDeltas.contributions };
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
  // фиксирует транзакции; их согласование с фактическими
  // изменениями инвентарей выполняет отдельная секция
  // reaction_inventory (Stage 4.2.3.4), а вклады реакций в
  // инвентарные аудиты передаются типизированным списком через
  // auditOpts. Пустой журнал/его отсутствие — не ошибка (balanced).
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

  // Согласование реакционных транзакций с материальными
  // инвентарями (Stage 4.2.3.4). Записи перехода описывают
  // ЗАВЕРШЁННЫЕ превращения: их ожидаемые изменения (вклады
  // ±coefficient × extent, агрегированные по паре (reservoirId,
  // speciesId)) обязаны совпадать с фактической разницей инвентарей
  // «до»/«после» с учётом потоковых вкладов той же пары — каждый
  // источник учитывается ровно один раз. Известное несовпадение —
  // imbalanced (Scheduler отклоняет шаг по общему правилу);
  // отсутствие инвентаря, несовпадение или смешение оснований,
  // непредставимые вклады — честное not_verifiable без пересчёта
  // между основаниями; структурные проблемы — invalid.
  const reactionInventoryAudit = auditReactionInventory(beforeReservoirs, afterReservoirs, ledger, reactionDeltas, auditOpts);
  push('reaction_inventory', reactionInventoryAudit.status, reactionInventoryAudit.issues);

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
// 2а. СОГЛАСОВАНИЕ РЕАКЦИЙ С ИНВЕНТАРЯМИ (STAGE 4.2.3.4)
// ============================================

/** Результат секции reaction_inventory. */
export interface ReactionInventoryAuditResult {
  status: ConservationStatus | 'invalid';
  issues: string[];
}

/**
 * Согласование реакционных транзакций перехода с фактическим
 * изменением материальных инвентарей (Stage 4.2.3.4).
 *
 * Для каждого вклада (пара reservoirId + speciesId, уже
 * агрегированного по всем участникам и записям) ожидаемое изменение
 * резервуара = потоковый вклад той же пары (в той же временной
 * области и основании) + реакционный вклад; оно сопоставляется с
 * фактической разницей инвентарей «до»/«после». Реакции и потоки
 * остаются раздельными механизмами: вклад каждого источника учтён
 * ровно один раз, фиктивные FluxRecord не создаются.
 *
 * Статусы:
 * - invalid — структурные проблемы записей (форма) или ссылка
 *   на резервуар, отсутствующий в состоянии; некорректный
 *   tolerance (NaN, ±Infinity, отрицательный) — тоже invalid:
 *   контролируемый отказ, а не ложный balanced (Stage 4.2.3.4.1,
 *   единая политика с auditReactionLedger);
 * - imbalanced — известное фактическое изменение не совпало с
 *   ожидаемым (в том числе неверный размер или знак изменения);
 * - not_verifiable — инвентарь не задан (запас неизвестен, а не
 *   ноль), основание записи не совпадает с основанием инвентаря
 *   (пересчёт между основаниями не выполняется), основание
 *   инвентаря изменилось, вклад непредставим или применённый
 *   untimed-поток касается той же пары;
 * - balanced — все вклады подтверждены инвентарями.
 */
export function auditReactionInventory(
  before: Record<string, ReservoirRecord>,
  after: Record<string, ReservoirRecord>,
  ledger: FluxLedger,
  deltas: ReactionInventoryDeltas,
  opts?: AuditOptions
): ReactionInventoryAuditResult {
  // Stage 4.2.3.4.1: tolerance — конечное неотрицательное число,
  // единая политика с auditReactionLedger (resolveAuditTolerance).
  // Некорректный tolerance не может дать balanced даже при пустом
  // журнале: проверка выполняется ДО каких-либо результатов.
  const { tolerance, problem: toleranceProblem } = resolveAuditTolerance(opts?.tolerance);
  if (toleranceProblem !== null) {
    return { status: 'invalid', issues: [toleranceProblem] };
  }
  if (deltas.formIssues.length > 0) {
    return { status: 'invalid', issues: [...deltas.formIssues] };
  }
  if (deltas.contributions.length === 0) {
    if (deltas.unverifiableIssues.length > 0) {
      return { status: 'not_verifiable', issues: [...deltas.unverifiableIssues] };
    }
    return { status: 'balanced', issues: [] };
  }
  const invalidIssues: string[] = [];
  const unverifiableIssues: string[] = [...deltas.unverifiableIssues];
  const discrepancies: string[] = [];
  for (const contribution of deltas.contributions) {
    if (!Number.isFinite(contribution.delta)) {
      unverifiableIssues.push('запись «' + contribution.recordId + '»: вклад вида «' + contribution.speciesId + '» в резервуаре «' + contribution.reservoirId + '» непредставим — сопоставление с инвентарём невозможно');
      continue;
    }
    const beforeRes = before[contribution.reservoirId];
    const afterRes = after[contribution.reservoirId];
    if (beforeRes === undefined || afterRes === undefined) {
      invalidIssues.push(
        'запись «' + contribution.recordId + '» ссылается на резервуар «' + contribution.reservoirId + '», отсутствующий в состоянии «' + (beforeRes === undefined ? 'до' : 'после') + '»: сопоставление вклада с инвентарём невозможно'
      );
      continue;
    }
    const beforeInv = beforeRes.material;
    const afterInv = afterRes.material;
    if (beforeInv === undefined || afterInv === undefined) {
      unverifiableIssues.push(
        'запись «' + contribution.recordId + '»: материальный инвентарь резервуара «' + contribution.reservoirId + '» не задан в состоянии «' + (beforeInv === undefined ? 'до' : 'после') + '» — реакционное изменение вида «' + contribution.speciesId + '» нечем подтвердить (запас неизвестен, а не ноль)'
      );
      continue;
    }
    if (!isPlainRecord(beforeInv.entries) || !isPlainRecord(afterInv.entries)) {
      unverifiableIssues.push(
        'запись «' + contribution.recordId + '»: material.entries резервуара «' + contribution.reservoirId + '» не является объектом-записью (speciesId → количество) — реакционное изменение вида «' + contribution.speciesId + '» непроверяемо'
      );
      continue;
    }
    if (beforeInv.basis !== afterInv.basis) {
      unverifiableIssues.push(
        'резервуар «' + contribution.reservoirId + '»: основание инвентаря изменилось («' + beforeInv.basis + '» → «' + afterInv.basis + '») — реакционное изменение вида «' + contribution.speciesId + '» непроверяемо'
      );
      continue;
    }
    if (contribution.basis !== beforeInv.basis) {
      unverifiableIssues.push(
        'запись «' + contribution.recordId + '»: основание реакции «' + contribution.basis + '» не совпадает с основанием инвентаря «' + beforeInv.basis + '» резервуара «' + contribution.reservoirId + '» — сопоставимость не доказуема, пересчёт между основаниями не выполняется'
      );
      continue;
    }
    const flux = reactionPairFluxDelta(ledger, opts?.scope, contribution.reservoirId, contribution.speciesId, beforeInv.basis);
    if (!flux.ok) {
      unverifiableIssues.push('запись «' + contribution.recordId + '»: ' + flux.reason);
      continue;
    }
    // Stage 4.2.3.4.1 (prototype-safe чтение): speciesId — произвольная
    // непустая строка. Отсутствие СОБСТВЕННОГО ключа entries означает
    // известный ноль; унаследованное свойство прототипа ('__proto__',
    // 'constructor', 'toString') количеством не является и чтением
    // не подменяется.
    const beforeAmount = ownEntryAmount(beforeInv.entries, contribution.speciesId);
    const afterAmount = ownEntryAmount(afterInv.entries, contribution.speciesId);
    // Stage 4.2.3.4.1 (численная устойчивость): конечность проверяется
    // у КАЖДОЙ составляющей — потокового вклада, реакционного вклада
    // (выше), их суммы, фактического изменения запаса и ожидаемого
    // итогового количества (до + ожидаемое Δ). Непредставимое число —
    // честное not_verifiable с диагностикой, а не imbalanced: NaN и
    // бесконечности не доказывают нарушения закона сохранения.
    if (!Number.isFinite(flux.delta)) {
      unverifiableIssues.push(
        'запись «' + contribution.recordId + '»: потоковый вклад вида «' + contribution.speciesId + '» в резервуаре «' + contribution.reservoirId + '» непредставим — сопоставление с инвентарём невозможно'
      );
      continue;
    }
    const expectedDelta = flux.delta + contribution.delta;
    if (!Number.isFinite(expectedDelta)) {
      unverifiableIssues.push(
        'запись «' + contribution.recordId + '»: суммарный ожидаемый вклад (поток + реакция) вида «' + contribution.speciesId + '» в резервуаре «' + contribution.reservoirId + '» непредставим (переполнение суммы)'
      );
      continue;
    }
    const actualDelta = afterAmount - beforeAmount;
    if (!Number.isFinite(actualDelta)) {
      unverifiableIssues.push(
        'запись «' + contribution.recordId + '»: фактическое изменение запаса вида «' + contribution.speciesId + '» в резервуаре «' + contribution.reservoirId + '» непредставимо (не числовое значение в инвентаре)'
      );
      continue;
    }
    const expectedAmount = beforeAmount + expectedDelta;
    if (!Number.isFinite(expectedAmount)) {
      unverifiableIssues.push(
        'запись «' + contribution.recordId + '»: ожидаемый итоговый запас вида «' + contribution.speciesId + '» в резервуаре «' + contribution.reservoirId + '» непредставим (переполнение суммы до + ожидаемое Δ) — сопоставление с фактическим запасом невозможно'
      );
      continue;
    }
    if (Math.abs(actualDelta - expectedDelta) > tolerance) {
      discrepancies.push(
        'резервуар «' + contribution.reservoirId + '», вид «' + contribution.speciesId + '» (запись «' + contribution.recordId + '»): ожидалось изменение ' + String(expectedDelta) + ', фактически ' + String(actualDelta)
      );
    }
  }
  if (invalidIssues.length > 0) {
    return { status: 'invalid', issues: invalidIssues };
  }
  if (discrepancies.length > 0) {
    return { status: 'imbalanced', issues: discrepancies };
  }
  if (unverifiableIssues.length > 0) {
    return { status: 'not_verifiable', issues: unverifiableIssues };
  }
  return { status: 'balanced', issues: [] };
}

/**
 * Потоковый вклад в изменение пары (резервуар, вид) в той же
 * временной области и основании, что и реакционный вклад
 * (Stage 4.2.3.4). Записи вне области относятся к другим
 * интервалам и пропускаются; применённый untimed-поток, исключённый
 * из ограниченной области и касающийся той же пары, делает
 * суммарный вклад непроверяемым, а не выдуманным.
 */
function reactionPairFluxDelta(
  ledger: FluxLedger,
  scope: FluxAuditScope | undefined,
  reservoirId: string,
  speciesId: string,
  inventoryBasis: string
): { ok: true; delta: number } | { ok: false; reason: string } {
  let delta = 0;
  for (const rec of ledger.records) {
    if (rec.status !== 'applied' || rec.subject.subjectType !== 'substance' || rec.subject.quantityKind !== 'integrated') continue;
    const subject = rec.subject as Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }>;
    if (subject.speciesId !== speciesId) continue;
    const side =
      rec.kind === 'internal_transfer'
        ? rec.from === reservoirId ? -1 : rec.to === reservoirId ? 1 : 0
        : rec.kind === 'external_input'
          ? rec.to === reservoirId ? 1 : 0
          : rec.from === reservoirId ? -1 : 0;
    if (side === 0) continue;
    if (!recordInScope(rec, scope)) {
      if (rec.time === null && excludedUntimed(scope)) {
        return {
          ok: false,
          reason: 'применённый поток «' + rec.id + '» без привязки ко времени касается той же пары (резервуар «' + reservoirId + '», вид «' + speciesId + '»): его вклад нельзя отнести к интервалу перехода'
        };
      }
      continue;
    }
    if (subject.basis !== inventoryBasis) {
      return {
        ok: false,
        reason: 'поток «' + rec.id + '» задаёт вклад вида «' + speciesId + '» в основании «' + subject.basis + '», не совпадающем с основанием инвентаря «' + inventoryBasis + '» — суммирование без пересчёта невозможно'
      };
    }
    const next = delta + side * subject.amount;
    if (!Number.isFinite(next)) {
      return {
        ok: false,
        reason: 'суммарный потоковый вклад вида «' + speciesId + '» в резервуаре «' + reservoirId + '» непредставим (переполнение суммы)'
      };
    }
    delta = next;
  }
  return { ok: true, delta };
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

