// ============================================
// GEOCHEMICAL COUPLED EXECUTION — атомарное исполнение coupled-транзакций
// ============================================
//
// Stage 4.9d. Единый оператор атомарных связанных геохимических
// изменений («реакции + переносы» одной транзакцией) и подключение
// результатов карбонатной специации Stage 4.9c к реальным инвентарям.
// В 4.9b был объявлен ТОЛЬКО контракт GeochemicalCoupledTransactionContract
// без исполнителя; настоящий модуль реализует исполнение, НЕ заменяя
// и не дублируя ни один из существующих контрактов.
//
// ГЛАВНЫЙ ИНВАРИАНТ (промпт Stage 4.9d): либо применяются ВСЕ изменения
// одной транзакции, либо НЕ применяется НИ ОДНО. Последовательное
// выполнение нескольких операций с объявлением их «общей атомарной
// транзакцией» и надеждой на последующий rollback ЗАПРЕЩЕНО и здесь
// не выполняется: все изменения сначала агрегируются по парам
// (reservoirId, speciesId) на ОДНОМ снимке, финальные инвентари
// вычисляются до применения, применение идёт по иммутабельным копиям,
// а журналы строятся как новые объекты.
//
// ЧТО ЭТО И ЧТО ЭТО НЕ ЭТО:
// - это ОДИН ЛОГИЧЕСКИЙ ОПЕРАТОР план → validate → commit: проверка
//   процесса (mechanism 'coupled') → планирование каждой реакции
//   (planGeochemicalReaction 4.9b) и каждого переноса → агрегирование
//   всех дельт по парам (reservoirId, speciesId) → проверка финальных
//   инвентарей (отрицательный запас невозможен, неизвестные количества
//   не считаются нулём) → элементный и зарядовый аудит агрегата →
//   применение по копиям → registerReaction → валидация журналов и
//   validateWorldState. При ЛЮБОЙ ошибке — not_applied с причиной
//   и диагностикой; входные резервуары, ReactionLedger, FluxLedger и
//   CoreWorldState остаются побитово неизменными;
// - это НЕ кинетическая модель и НЕ источник скоростей: extent
//   реакций и количество переносов приходят ЯВНО с идентифицированным
//   provenance. Никакие скорости, extent'ы и равновесия здесь не
//   вычисляются и не выдумываются;
// - агрегированное применение переносов через общий дельта-маппинг —
//   ЕДИНСТВЕННЫЙ арифметически корректный путь: пофазное
//   registerFlux+applyFlux внутри одной транзакции может упереться в
//   промежуточный недостаток запаса при корректном финальном состоянии
//   (пример: ocn→atm −80 mol/m² и atm→ocn +80 при запасе 30 агрегируются
//   в чистый ноль, а последовательное применение даёт ложный отказ).
//   Записи потоков регистрируются в существующей форме FluxRecord
//   и проверяются штатным validateFluxLedger; эквивалентность
//   агрегированного применения пофазному проверяется тестами;
// - внешний перенос заряженного вида отклоняется (fail-closed): без
//   фоновых сильных ионов электронейтральность не подтверждается и
//   НЕ объявляется формально выполняющейся;
// - h2o_aq не создаётся и не переносится: растворитель по контракту
//   4.9c имеет закреплённую концентрацию (см. carbonateSpeciationExecution).
//
// Повторное использование существующих контрактов (никаких дублей):
// planGeochemicalReaction (Core/geochemicalReactionExecution.ts, 4.9b),
// validateGeochemicalProcessSpec (Core/geochemicalFluxes.ts),
// validateFluxLedger / EXTERNAL (Core/fluxLedger.ts),
// registerReaction / validateReactionLedger / createReactionLedger
// (Core/reactionLedger.ts), addMaterial / removeMaterial /
// validateMaterialInventory / validateReservoirRecord (Core/reservoir.ts),
// elementTotals / chargeTotal (Core/species.ts),
// CoreWorldState / validateWorldState (Core/worldState.ts).
// Вторая система единиц не создаётся: инвентари и переносы — в
// геохимической конвенции column_amount (mol/m²).

import type { ReservoirRecord } from './reservoir';
import { addMaterial, isPlainRecord, removeMaterial, validateMaterialInventory, validateReservoirRecord } from './reservoir';
import type { FluxLedger, FluxRecord, FluxSubject, FluxTime } from './fluxLedger';
import { EXTERNAL, validateFluxLedger } from './fluxLedger';
import type { CoreWorldState } from './worldState';
import { validateWorldState } from './worldState';
import type { ReactionLedger, ReactionRecord } from './reactionLedger';
import { createReactionLedger, registerReaction, validateReactionLedger } from './reactionLedger';
import type { SpeciesCatalog } from './species';
import { chargeTotal, elementTotals } from './species';
import { GEOCHEMICAL_INVENTORY_BASIS, validateGeochemicalProcessSpec } from './geochemicalFluxes';
import type { GeochemicalProcessSpec, GeochemicalTransferDirection } from './geochemicalFluxes';
import type {
  GeochemicalReactionDefinition,
  GeochemicalReactionBlockKind,
  GeochemicalReactionExecutionEnvironment
} from './geochemicalReactionExecution';
import { planGeochemicalReaction } from './geochemicalReactionExecution';
import type { GeochemicalCoupledTransactionContract } from './geochemicalReactionExecution';
import type { ReactionDataProvenance } from './geochemicalReactionContext';
import type { DataProvenance } from './scientificValue';

// ============================================
// 1. КОМПОНЕНТЫ ТРАНЗАКЦИИ
// ============================================

/**
 * Журнальный допуск агрегированных балансов (mol/m²): допуски нужны
 * только для арифметических невязок элементного/зарядового аудита
 * агрегата; запасы и количества проверяются БЕЗ допусков (unknown ≠ 0,
 * отрицательный инвентарь невозможен ни при каком допуске).
 */
export const GEOCHEMICAL_COUPLED_BALANCE_TOLERANCE = 1e-9;

/**
 * Компонента атомарной coupled-транзакции: реакция (extent задан ЯВНО
 * объявляющим кодом с provenance — executor extent'ы НЕ вычисляет) или
 * перенос завершённого количества (НЕ скорость: rate-переносы требуют
 * интеграции вне транзакции и в coupled-транзакцию не включаются).
 */
export type GeochemicalCoupledComponent =
  | {
      readonly kind: 'reaction';
      readonly definition: GeochemicalReactionDefinition;
      /** Завершённая степень протекания, mol/m² (конечное положительное число). */
      readonly extentMolPerM2: number;
      /** Происхождение extent (идентифицированный источник) — обязательно. */
      readonly extentProvenance: ReactionDataProvenance;
      /** Служебная заметка в записи реакции. */
      readonly note?: string;
    }
  | {
      readonly kind: 'transfer';
      /** Переносимое вещество (speciesId из SpeciesCatalog). */
      readonly speciesId: string;
      /** Направление переноса (семантика FluxKind). */
      readonly direction: GeochemicalTransferDirection;
      /** Завершённое количество переноса, mol/m² (конечное положительное число). */
      readonly amountMolPerM2: number;
      /** Происхождение количества (идентифицированный источник) — обязательно. */
      readonly amountProvenance: DataProvenance;
      /** Служебная заметка в записи потока. */
      readonly note?: string;
    };

/**
 * Идентификация процесса транзакции. Для транзакций из каталога
 * передаётся spec: executor проверяет, что он проходит
 * validateGeochemicalProcessSpec, что processId совпадает и что
 * механизм действительно 'coupled'. Для внутренних операций (например,
 * атомарного перераспределения DIC при применении карбонатной
 * специации Stage 4.9d внутри резервуара 'ocean') spec может
 * отсутствовать: форма GeochemicalProcessSpec описывает ПЕРЕНОС между
 * резервуарами (direction/rate/speciesId) и внутрирезервуарную
 * композицию не выражает; происхождение в этом случае несут
 * definitionProvenance / extentProvenance / amountProvenance компонент.
 */
export interface GeochemicalCoupledProcessDeclaration {
  /** Уникальный идентификатор процесса. */
  readonly processId: string;
  /**
   * Спецификация из каталога процессов (необязательна): если задана —
   * обязана проходить validateGeochemicalProcessSpec, совпадать по
   * processId и иметь механизм 'coupled'.
   */
  readonly processSpec?: GeochemicalProcessSpec | null;
  /** Человекочитаемое описание области транзакции (когда spec не задан). */
  readonly transactionScopeNote?: string;
}

/** Вход планирования/исполнения атомарной coupled-транзакции. */
export interface GeochemicalCoupledTransactionInput {
  /** Единый id транзакции для ВСЕХ составляющих операций. */
  readonly transactionId: string;
  /** Процесс транзакции. */
  readonly process: GeochemicalCoupledProcessDeclaration;
  /** Единый интервал времени (один на все компоненты); null — не привязана. */
  readonly time?: FluxTime | null;
  /** Участники транзакции (минимум один); порядок НЕ важен — канонизируется. */
  readonly components: readonly GeochemicalCoupledComponent[];
  /**
   * Допуск аудита агрегированных балансов, mol/m² (необязателен;
   * значение по умолчанию GEOCHEMICAL_COUPLED_BALANCE_TOLERANCE).
   */
  readonly balanceTolerance?: number;
}

/** Среда исполнения (та же дисциплина, что у исполнителя реакций 4.9b). */
export interface GeochemicalCoupledExecutionEnvironment {
  readonly speciesCatalog: SpeciesCatalog;
  readonly reservoirs: Record<string, ReservoirRecord>;
  /** Существующий журнал реакций (не обязателен; отсутствие = «не было»). */
  readonly reactionLedgerInput?: ReactionLedger;
  /** Существующий журнал потоков (обязателен у состояния ядра). */
  readonly fluxLedgerInput: FluxLedger;
  /** id уже применённых транзакций (журнал ядра; анти-replay). */
  readonly appliedTransactionIds?: readonly string[];
}

// ============================================
// 2. ОШИБКИ И РЕЗУЛЬТАТЫ
// ============================================

/** Причина отказа coupled-транзакции (расширение причин исполнителя реакций 4.9b). */
export type GeochemicalCoupledBlockKind =
  | GeochemicalReactionBlockKind
  /** Тот же transactionId уже применён (анти-replay). */
  | 'duplicate_transaction'
  /** План построен на устаревшем снимке состояния. */
  | 'stale_snapshot';

export interface GeochemicalCoupledAggregatedDelta {
  readonly reservoirId: string;
  readonly speciesId: string;
  /** Совокупное Δ по паре (reservoirId, speciesId), mol/m². */
  readonly deltaMolM2: number;
}

export interface GeochemicalCoupledElementResidual {
  readonly element: string;
  /** Внутренняя невязка элемента (должна быть 0 в допуске). */
  readonly internalResidual: number;
  /** Чистый внешний перенос элемента (обоснован границей). */
  readonly netExternal: number;
}

export interface GeochemicalCoupledBalanceAudit {
  /** 'balanced' — внутренние невязки в допуске; 'imbalanced' — нет. */
  readonly status: 'balanced' | 'imbalanced' | 'not_assessable';
  readonly tolerance: number;
  readonly elementResiduals: readonly GeochemicalCoupledElementResidual[];
  /** Совокупный модельный заряд дельт (должен быть 0 в допуске). */
  readonly chargeResidual: number;
  /** Виды с неизвестным зарядом/составом (пустой = всё проверяемо). */
  readonly excludedSpecies: readonly string[];
  /** Внешние границы, через которые прошли внешние переносы. */
  readonly boundaryJustifications: readonly string[];
}

export interface GeochemicalCoupledTransactionSnapshot {
  readonly reservoirInventories: Readonly<Record<string, { readonly basis: string; readonly entries: Readonly<Record<string, number>> }>>;
  readonly reservoirCount: number;
  readonly reactionLedgerSize: number | null;
  readonly fluxLedgerSize: number;
  readonly appliedTransactionIds: readonly string[];
}

export type GeochemicalCoupledPlanResult =
  | {
      readonly status: 'ready';
      readonly transactionId: string;
      readonly processId: string;
      readonly time: FluxTime | null;
      /** Кандидаты записей реакций (валидны, 'balanced', НЕ зарегистрированы). */
      readonly reactionRecords: readonly ReactionRecord[];
      /** Кандидаты записей потоков (форма FluxRecord); статус ставит commit. */
      readonly fluxRecords: readonly FluxRecord[];
      /** Дельты реакций по парам (из planGeochemicalReaction каждого кандидата). */
      readonly reactionContributions: readonly { readonly reservoirId: string; readonly speciesId: string; readonly delta: number; readonly recordId: string }[];
      /** Дельты переносов по парам. */
      readonly transferContributions: readonly { readonly reservoirId: string; readonly speciesId: string; readonly delta: number; readonly recordId: string }[];
      /** Совокупные Δ по парам (reservoirId, speciesId) — канонический порядок. */
      readonly aggregatedDeltas: readonly GeochemicalCoupledAggregatedDelta[];
      /** Аудит элементов и заряда агрегата. */
      readonly audit: GeochemicalCoupledBalanceAudit;
      /** Явные ограничения применимости. */
      readonly applicabilityConstraints: readonly string[];
      /** Сведения о происхождении определений/extent'ов/входных данных. */
      readonly provenanceSummary: readonly string[];
      readonly diagnostics: readonly string[];
      /** Снимок состояния, на котором построен план (защита от устаревания). */
      readonly transactionSnapshot: GeochemicalCoupledTransactionSnapshot;
    }
  | {
      readonly status: 'blocked';
      readonly reasonKind: GeochemicalCoupledBlockKind;
      readonly processId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
    };

export type GeochemicalCoupledExecutionResult =
  | {
      readonly status: 'applied';
      readonly transactionId: string;
      readonly processId: string;
      /** Новые резервуары (незатронутые разделяются по ссылке с входом). */
      readonly reservoirs: Record<string, ReservoirRecord>;
      /** НОВЫЙ журнал реакций (заданный вход не мутируется). */
      readonly reactionLedger: ReactionLedger;
      /** НОВЫЙ журнал потоков (заданный вход не мутируется). */
      readonly fluxLedger: FluxLedger;
      /** Согласованный контракт транзакции (форма контракта 4.9b совпадает). */
      readonly contract: GeochemicalCoupledTransactionContract;
      readonly aggregatedDeltas: readonly GeochemicalCoupledAggregatedDelta[];
      readonly audit: GeochemicalCoupledBalanceAudit;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: GeochemicalCoupledBlockKind;
      readonly processId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
      readonly error: string | null;
    };

export type GeochemicalCoupledWorldExecutionResult =
  | {
      readonly status: 'applied';
      /** НОВОЕ состояние ядра; входной CoreWorldState не мутируется. */
      readonly core: CoreWorldState;
      readonly transactionId: string;
      readonly processId: string;
      readonly contract: GeochemicalCoupledTransactionContract;
      readonly aggregatedDeltas: readonly GeochemicalCoupledAggregatedDelta[];
      readonly audit: GeochemicalCoupledBalanceAudit;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: GeochemicalCoupledBlockKind;
      readonly processId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
      readonly error: string | null;
    };

// ============================================
// 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function provenanceIdentified(p: unknown): boolean {
  if (!isPlainRecord(p)) return false;
  const sourceName = p.sourceName;
  const sourceId = p.sourceId;
  const datasetId = p.datasetId;
  const reference = p.reference;
  return (
    (typeof sourceName === 'string' && sourceName.trim() !== '') ||
    (typeof sourceId === 'string' && sourceId.trim() !== '') ||
    (typeof datasetId === 'string' && datasetId.trim() !== '') ||
    (typeof reference === 'string' && reference.trim() !== '')
  );
}

/**
 * Канонический порядок компонент: результат транзакции НЕ зависит от
 * порядка объявлений (детерминизм при перестановке участников).
 * Идентификаторы записей строятся по каноническому индексу:
 * transactionId::rx::i и transactionId::flux::i.
 */
function canonicalComponentKey(component: GeochemicalCoupledComponent): string {
  if (component.kind === 'reaction') {
    return JSON.stringify(['reaction', component.definition.reactionId, component.extentMolPerM2, component.note ?? null, component.definition]) +
      '|' + JSON.stringify(component.extentProvenance);
  }
  return JSON.stringify(['transfer', component.speciesId, component.direction, component.amountMolPerM2, component.note ?? null]) +
    '|' + JSON.stringify(component.amountProvenance);
}

export function canonicalCoupledComponents(components: readonly GeochemicalCoupledComponent[]): GeochemicalCoupledComponent[] {
  return [...components].sort((a, b) => {
    const ka = canonicalComponentKey(a);
    const kb = canonicalComponentKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/** Направление переноса → стороны формы FluxRecord. */
function transferSides(direction: GeochemicalTransferDirection): {
  kind: 'internal_transfer' | 'external_input' | 'external_output';
  from: string;
  to: string;
  boundaryId: string | null;
  boundaryJustification: string | null;
} {
  if (direction.kind === 'internal_transfer') {
    return { kind: 'internal_transfer', from: direction.fromReservoirId, to: direction.toReservoirId, boundaryId: null, boundaryJustification: null };
  }
  if (direction.kind === 'external_input') {
    return { kind: 'external_input', from: EXTERNAL, to: direction.reservoirId, boundaryId: direction.boundary.id, boundaryJustification: direction.boundary.physicalJustification };
  }
  return { kind: 'external_output', from: direction.reservoirId, to: EXTERNAL, boundaryId: direction.boundary.id, boundaryJustification: direction.boundary.physicalJustification };
}

/** Пара агрегирования: стабильный ключ reservoirId + '\u0000' + speciesId. */
const PAIR_SEPARATOR = '\u0000';
function pairKey(reservoirId: string, speciesId: string): string {
  return reservoirId + PAIR_SEPARATOR + speciesId;
}

interface MutableAggregated {
  readonly reservoirId: string;
  readonly speciesId: string;
  delta: number;
}

/**
 * Снять снимок состояния среды: копии инвентарей всех резервуаров,
 * размеры журналов и применённые transactionId. Сравнение снимка с
 * текущим состоянием при commit — защита от исполнения транзакции на
 * устаревшем снимке.
 */
export function captureCoupledTransactionSnapshot(env: GeochemicalCoupledExecutionEnvironment): GeochemicalCoupledTransactionSnapshot {
  const reservoirInventories: Record<string, { basis: string; entries: Record<string, number> }> = {};
  for (const [id, reservoir] of Object.entries(env.reservoirs)) {
    reservoirInventories[id] = {
      basis: reservoir.material !== undefined ? reservoir.material.basis : '(нет инвентаря)',
      entries: reservoir.material !== undefined ? { ...reservoir.material.entries } : {}
    };
  }
  return {
    reservoirInventories,
    reservoirCount: Object.keys(env.reservoirs).length,
    reactionLedgerSize: env.reactionLedgerInput !== undefined ? env.reactionLedgerInput.records.length : null,
    fluxLedgerSize: env.fluxLedgerInput.records.length,
    appliedTransactionIds: [...(env.appliedTransactionIds !== undefined ? env.appliedTransactionIds : [])]
  };
}

function inventoriesOfReservoirs(reservoirs: Record<string, ReservoirRecord>): Record<string, { basis: string; entries: Record<string, number> }> {
  const out: Record<string, { basis: string; entries: Record<string, number> }> = {};
  for (const [id, reservoir] of Object.entries(reservoirs)) {
    out[id] = {
      basis: reservoir.material !== undefined ? reservoir.material.basis : '(нет инвентаря)',
      entries: reservoir.material !== undefined ? { ...reservoir.material.entries } : {}
    };
  }
  return out;
}

/** Сравнить снимок плана с текущим состоянием среды (устарел ли). */
function snapshotIsStale(snapshot: GeochemicalCoupledTransactionSnapshot, env: GeochemicalCoupledExecutionEnvironment): boolean {
  if (snapshot.reservoirCount !== Object.keys(env.reservoirs).length) return true;
  if (snapshot.reactionLedgerSize !== (env.reactionLedgerInput !== undefined ? env.reactionLedgerInput.records.length : null)) return true;
  if (snapshot.fluxLedgerSize !== env.fluxLedgerInput.records.length) return true;
  const currentIds = JSON.stringify(env.appliedTransactionIds !== undefined ? env.appliedTransactionIds : []);
  const snapshotIds = JSON.stringify(snapshot.appliedTransactionIds);
  if (currentIds !== snapshotIds) return true;
  if (JSON.stringify(inventoriesOfReservoirs(env.reservoirs)) !== JSON.stringify(snapshot.reservoirInventories)) return true;
  return false;
}

/** Иммутабельно добавить transactionId в журнал применённых транзакций. */
export function withTransactionLogApplied(core: CoreWorldState, transactionId: string): CoreWorldState {
  const existing: readonly string[] = core.geochemicalTransactionLog !== undefined ? core.geochemicalTransactionLog.appliedTransactionIds : [];
  return {
    ...core,
    geochemicalTransactionLog: { appliedTransactionIds: [...existing, transactionId] }
  };
}

// ============================================
// 4. ПЛАНИРОВАНИЕ ТРАНЗАКЦИИ
// ============================================

/**
 * Построить план атомарной coupled-транзакции. План НЕ изменяет ни
 * резервуары, ни журналы. Стадии:
 *
 *  1. форма входа (transactionId, process, time, компоненты);
 *  2. анти-replay: transactionId не входит в appliedTransactionIds,
 *     производные идентификаторы записей не заняты в журналах;
 *  3. идентификация процесса: spec (если дан) проходит
 *     validateGeochemicalProcessSpec, совпадает по processId и имеет
 *     mechanism 'coupled' (промпт 4.9d, обязательная проверка 1);
 *  4. канонизация компонент (детерминизм при перестановке);
 *  5. планирование каждой реакции через planGeochemicalReaction (4.9b:
 *     форма определения → вход → c_org-правило → candidate-запись →
 *     auditReactionStoichiometry строго 'balanced' → вклады → среда);
 *  6. проверка каждого переноса: резервуары/инвентари/основания/
 *     направления/количество/provenance/границы; заряженный внешний
 *     перенос отклоняется (проверка 9 промпта 4.9d); вид, отсутствующий
 *     в SpeciesCatalog, НЕ отклоняется здесь, а доходит до аудита
 *     (шаг 9) и даёт честный not_verifiable — неизвестный состав
 *     не заменяется нулём и не «блокируется молча»;
 *  7. агрегирование всех дельт по парам (reservoirId, speciesId) на
 *     ОДНОМ снимке (промпт 4.9d: агрегирование ДО вычисления
 *     инвентарей, никакое применение по одному с повторным чтением);
 *  8. финальные инвентари: конечность, неотрицательность, unknown ≠ 0;
 *  9. элементный и зарядовый аудит агрегата: элементные счёты —
 *     elementTotals ядра, заряд — chargeTotal ядра (новые шкалы не
 *     вводятся); внутренние невязки = 0 в допуске, внешние переносится
 *     как netExternal с justification границы; при неизвестном
 *     заряде/составе — not_verifiable (не «электронейтрально»).
 */
export function planGeochemicalCoupledTransaction(
  env: GeochemicalCoupledExecutionEnvironment,
  input: GeochemicalCoupledTransactionInput
): GeochemicalCoupledPlanResult {
  const blocked = (reasonKind: GeochemicalCoupledBlockKind, processId: string | null, reason: string, issues: readonly string[]): GeochemicalCoupledPlanResult =>
    ({ status: 'blocked', reasonKind, processId, reason, issues });

  // --- 1. форма входа ---
  const raw = isPlainRecord(input) ? (input as unknown as Record<string, unknown>) : undefined;
  if (raw === undefined) {
    return blocked('not_executable', null, 'вход транзакции должен быть объектом-записью (plain record)', []);
  }
  const formIssues: string[] = [];
  if (typeof raw.transactionId !== 'string' || raw.transactionId.trim() === '') {
    formIssues.push('transactionId должен быть непустой строкой');
  }
  const processRaw = isPlainRecord(raw.process) ? raw.process : undefined;
  let processId: string | null = null;
  if (processRaw === undefined) {
    formIssues.push('process обязателен (processId + опциональная spec каталога)');
  } else if (typeof processRaw.processId !== 'string' || processRaw.processId.trim() === '') {
    formIssues.push('process.processId должен быть непустой строкой');
  } else {
    processId = processRaw.processId;
  }
  if (raw.time !== undefined && raw.time !== null && !isPlainRecord(raw.time)) {
    formIssues.push('time должен быть объектом (FluxTime) или null');
  }
  if (!Array.isArray(raw.components) || raw.components.length === 0) {
    formIssues.push('components должен быть непустым массивом компонент транзакции');
  }
  if (raw.balanceTolerance !== undefined && (typeof raw.balanceTolerance !== 'number' || !Number.isFinite(raw.balanceTolerance) || raw.balanceTolerance < 0)) {
    formIssues.push('balanceTolerance, если задан, должен быть конечным неотрицательным числом');
  }
  if (formIssues.length > 0) {
    return blocked('not_executable', processId, 'вход транзакции не проходит структурную валидацию', formIssues);
  }

  const transactionId = raw.transactionId as string;
  const time: FluxTime | null = raw.time === undefined || raw.time === null ? null : (raw.time as unknown as FluxTime);
  const balanceTolerance = raw.balanceTolerance !== undefined ? (raw.balanceTolerance as number) : GEOCHEMICAL_COUPLED_BALANCE_TOLERANCE;
  const componentsRaw = raw.components as unknown[];

  // --- 2. анти-replay ---
  const seenTransactionIds = env.appliedTransactionIds !== undefined ? env.appliedTransactionIds : [];
  if (seenTransactionIds.includes(transactionId)) {
    return blocked('duplicate_transaction', processId, 'заданный transactionId уже был применён: повторное применение одной транзакции запрещено (анти-replay, двойной учёт исключён)', [
      'повторный transactionId: «' + transactionId + '» уже в журнале применённых транзакций'
    ]);
  }
  const existingReactionRecordIds = new Set<string>(
    (env.reactionLedgerInput !== undefined ? env.reactionLedgerInput.records : []).map((r) => r.id)
  );
  const existingFluxRecordIds = new Set<string>(env.fluxLedgerInput.records.map((r) => r.id));

  // --- 3. идентификация процесса ---
  const processSpecValue = processRaw!.processSpec;
  if (processSpecValue !== undefined && processSpecValue !== null) {
    const specIssues = validateGeochemicalProcessSpec(processSpecValue);
    if (specIssues.length > 0) {
      return blocked('not_executable', processId, 'спецификация процесса не проходит validateGeochemicalProcessSpec', specIssues);
    }
    const spec = processSpecValue as GeochemicalProcessSpec;
    if (spec.processId !== processId!) {
      return blocked('not_executable', processId, 'processSpec.processId не совпадает с process.processId: происхождение процесса подменять нельзя', [
        'processSpec.processId = «' + spec.processId + '», process.processId = «' + processId + '»'
      ]);
    }
    if (spec.mechanism !== 'coupled') {
      return blocked('not_executable', processId, 'заданный процесс не имеет механизма «coupled»: атомарный coupled-исполнитель solo-процессы не исполняет (одиночные реакции — исполнитель 4.9b, переносы — executeGeochemicalProcess 4.9a)', [
        'mechanism = «' + spec.mechanism + '»'
      ]);
    }
  }

  // --- 4. канонизация компонент ---
  const componentFormIssues: string[] = [];
  for (let index = 0; index < componentsRaw.length; index++) {
    const c = componentsRaw[index];
    if (!isPlainRecord(c)) {
      componentFormIssues.push('components[' + index + '] должен быть объектом-записью');
      continue;
    }
    if (c.kind !== 'reaction' && c.kind !== 'transfer') {
      componentFormIssues.push(`components[${index}].kind должен быть 'reaction' или 'transfer', получено «${String(c.kind)}»`);
    }
  }
  if (componentFormIssues.length > 0) {
    return blocked('not_executable', processId, 'компоненты транзакции не проходят структурную валидацию', componentFormIssues);
  }
  const components = canonicalCoupledComponents(componentsRaw as unknown as GeochemicalCoupledComponent[]);

  // --- 5. планирование реакций (4.9b) на исходном снимке ---
  const reactionRecords: ReactionRecord[] = [];
  const reactionContributions: { reservoirId: string; speciesId: string; delta: number; recordId: string }[] = [];
  const provenanceSummary: string[] = [];
  const reactionEnv: GeochemicalReactionExecutionEnvironment = {
    speciesCatalog: env.speciesCatalog,
    reservoirs: env.reservoirs,
    ledgerInput: env.reactionLedgerInput
  };
  for (let index = 0; index < components.length; index++) {
    const component = components[index]!;
    if (component.kind !== 'reaction') continue;
    const recordId = transactionId + '::rx::' + String(index);
    if (existingReactionRecordIds.has(recordId) || existingFluxRecordIds.has(recordId)) {
      return blocked('duplicate_transaction', processId, 'производный идентификатор записи реакции конфликтует с существующей записью журнала: транзакция (или её фрагмент) уже применялась', [
        'конфликт id: ' + recordId
      ]);
    }
    const plan = planGeochemicalReaction(component.definition, reactionEnv, {
      transactionId: recordId,
      extentMolPerM2: component.extentMolPerM2,
      extentProvenance: component.extentProvenance,
      time,
      note: component.note !== undefined ? component.note : undefined
    });
    if (plan.status !== 'ready') {
      const issues = [...plan.issues];
      if (plan.status === 'blocked') {
        issues.unshift('компонента-реакция «' + component.definition.reactionId + '» (канонический индекс ' + String(index) + ') не проходит планирование исполнителя реакций 4.9b');
      }
      return blocked(plan.reasonKind, processId, 'компонента транзакции отклонена на планировании реакции — ВСЯ транзакция отклоняется (атомарность, не частичное применение): ' + plan.reason, issues);
    }
    reactionRecords.push(plan.record);
    provenanceSummary.push('компонента реакция «' + component.definition.reactionId + '»: стехиометрия — ' + JSON.stringify(component.definition.definitionProvenance) + ', extent provenance — ' + JSON.stringify(component.extentProvenance));
    for (const contribution of plan.deltas.contributions) {
      if (contribution.delta !== 0) {
        reactionContributions.push({ reservoirId: contribution.reservoirId, speciesId: contribution.speciesId, delta: contribution.delta, recordId });
      }
    }
  }

  // --- 6. проверки переносов ---
  const fluxRecords: FluxRecord[] = [];
  const transferContributions: { reservoirId: string; speciesId: string; delta: number; recordId: string }[] = [];
  /** Вклады, пересекающие внешнюю границу (элементный источник — вне системы). */
  const externalContributions: { speciesId: string; delta: number }[] = [];
  const boundaryJustifications: string[] = [];
  for (let index = 0; index < components.length; index++) {
    const component = components[index]!;
    if (component.kind !== 'transfer') continue;
    const recordId = transactionId + '::flux::' + String(index);
    if (existingReactionRecordIds.has(recordId) || existingFluxRecordIds.has(recordId)) {
      return blocked('duplicate_transaction', processId, 'производный идентификатор записи потока конфликтует с существующей записью журнала', ['конфликт id: ' + recordId]);
    }
    const transferIssues: string[] = [];
    // Неизвестный вид НЕ отклоняется здесь (not_executable): он доходит до
    // элементного/зарядового аудита (шаг 9), где elementTotals/chargeTotal
    // помечают его исключённым и транзакция получает честный not_verifiable —
    // неизвестный состав не заменяется нулём и не блокируется молча.
    if (!Number.isFinite(component.amountMolPerM2) || component.amountMolPerM2 <= 0) {
      transferIssues.push('amountMolPerM2 должен быть конечным положительным числом, получено ' + String(component.amountMolPerM2) + ' (скоростные переносы в coupled-транзакцию не включаются: скорость требует интеграции вне транзакции)');
    }
    if (!provenanceIdentified(component.amountProvenance)) {
      transferIssues.push('amountProvenance обязан идентифицировать источник (sourceName, sourceId, datasetId или reference)');
    }
    const sides = transferSides(component.direction);
    if (sides.kind === 'internal_transfer') {
      if (sides.from === EXTERNAL || sides.to === EXTERNAL) {
        transferIssues.push('internal_transfer не может пересекать внешнюю границу');
      } else {
        if (env.reservoirs[sides.from] === undefined) transferIssues.push('резервуар-источник «' + sides.from + '» отсутствует в среде');
        if (env.reservoirs[sides.to] === undefined) transferIssues.push('резервуар-получатель «' + sides.to + '» отсутствует в среде');
        if (sides.from === sides.to) transferIssues.push('перенос в самого себя не является переносом');
      }
    } else {
      const innerId = sides.from === EXTERNAL ? sides.to : sides.from;
      if (env.reservoirs[innerId] === undefined) {
        transferIssues.push('резервуар переноса «' + innerId + '» отсутствует в среде');
      }
      if (sides.boundaryId === null || sides.boundaryId.trim() === '' || sides.boundaryJustification === null || sides.boundaryJustification.trim() === '') {
        transferIssues.push('внешний перенос требует явной границы (boundary.id + boundary.physicalJustification)');
      } else {
        boundaryJustifications.push(sides.boundaryId + ': ' + sides.boundaryJustification);
      }
      // Промпт 4.9d (обязательная проверка 9): заряженный внешний перенос
      // без фоновых ионов не может гарантировать электронейтральность —
      // перенос отклоняется, а не объявляется нейтральным.
      const species = env.speciesCatalog.get(component.speciesId);
      if (species !== undefined && species !== null && species.charge !== 0) {
        transferIssues.push('внешний перенос заряженного вида «' + component.speciesId + '» (charge = ' + species.charge + ') не исполняется: изменение модельного заряда без фоновых ионов не может быть подтверждено (fail-closed)');
      }
    }
    for (const reservoirId of [sides.from, sides.to]) {
      if (reservoirId !== EXTERNAL) {
        const reservoir = env.reservoirs[reservoirId];
        if (reservoir !== undefined) {
          if (!reservoir.material) {
            transferIssues.push('резервуар «' + reservoirId + '» не содержит материального инвентаря: задайте его явно (setMaterialInventory)');
          } else if (reservoir.material.basis !== GEOCHEMICAL_INVENTORY_BASIS) {
            transferIssues.push('резервуар «' + reservoirId + '» хранит инвентарь в основании «' + reservoir.material.basis + '», а перенос — в «' + GEOCHEMICAL_INVENTORY_BASIS + '»: основания не смешиваются, автоматический пересчёт запрещён');
          }
        }
      }
    }
    if (transferIssues.length > 0) {
      return blocked('not_executable', processId, 'компонента-перенос не проходит проверку — ВСЯ транзакция отклоняется (атомарность, не частичное применение)', transferIssues);
    }
    // Форма записи потока: никакой «статистической» семантики не вводится —
    // форма та же, что создаёт registerFlux; корректность проверяет validateFluxLedger.
    const integrated: Extract<FluxSubject, { subjectType: 'substance'; quantityKind: 'integrated' }> = {
      subjectType: 'substance',
      speciesId: component.speciesId,
      quantityKind: 'integrated',
      amount: component.amountMolPerM2,
      basis: GEOCHEMICAL_INVENTORY_BASIS
    };
    const record: FluxRecord = {
      id: recordId,
      kind: sides.kind,
      from: sides.from,
      to: sides.to,
      subject: integrated,
      time,
      status: 'applied',
      note: component.note !== undefined ? component.note : undefined
    };
    fluxRecords.push(record);
    provenanceSummary.push('компонента перенос «' + component.speciesId + '» (' + sides.kind + ' ' + sides.from + ' → ' + sides.to + '), количество ' + String(component.amountMolPerM2) + ' ' + GEOCHEMICAL_INVENTORY_BASIS + ': provenance — ' + JSON.stringify(component.amountProvenance));
    // Дельты переноса: internal — −amount источнику и +amount получателю;
    // external_input — +amount получателю; external_output — −amount источнику.
    if (sides.kind === 'internal_transfer') {
      transferContributions.push({ reservoirId: sides.from, speciesId: component.speciesId, delta: -component.amountMolPerM2, recordId });
      transferContributions.push({ reservoirId: sides.to, speciesId: component.speciesId, delta: +component.amountMolPerM2, recordId });
    } else if (sides.kind === 'external_input') {
      transferContributions.push({ reservoirId: sides.to, speciesId: component.speciesId, delta: +component.amountMolPerM2, recordId });
      // Элементы входят СНАРУЖИ: это внешний перенос (netExternal с
      // обоснованной границей), а не внутренняя невязка — иначе честный
      // приток вещества не проходил бы элементный аудит вообще.
      externalContributions.push({ speciesId: component.speciesId, delta: +component.amountMolPerM2 });
    } else {
      transferContributions.push({ reservoirId: sides.from, speciesId: component.speciesId, delta: -component.amountMolPerM2, recordId });
      // Элементы уходят НАРУЖУ через обоснованную (validated) границу.
      externalContributions.push({ speciesId: component.speciesId, delta: -component.amountMolPerM2 });
    }
  }

  // --- 7. агрегирование дельт по парам (reservoirId, speciesId) ---
  const aggregated = new Map<string, MutableAggregated>();
  const pushDelta = (reservoirId: string, speciesId: string, delta: number): void => {
    const key = pairKey(reservoirId, speciesId);
    const entry = aggregated.get(key);
    if (entry === undefined) {
      aggregated.set(key, { reservoirId, speciesId, delta });
    } else {
      entry.delta = entry.delta + delta;
    }
  };
  for (const contribution of reactionContributions) pushDelta(contribution.reservoirId, contribution.speciesId, contribution.delta);
  for (const contribution of transferContributions) pushDelta(contribution.reservoirId, contribution.speciesId, contribution.delta);

  const aggregatedDeltas: GeochemicalCoupledAggregatedDelta[] = [...aggregated.values()]
    .filter((entry) => entry.delta !== 0)
    .sort((a, b) => {
      const ka = pairKey(a.reservoirId, a.speciesId);
      const kb = pairKey(b.reservoirId, b.speciesId);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .map((entry) => ({ reservoirId: entry.reservoirId, speciesId: entry.speciesId, deltaMolM2: entry.delta }));

  // --- 8. финальные инвентари на ОДНОМ снимке (до любого применения) ---
  const finalInventoryIssues: string[] = [];
  for (const delta of aggregatedDeltas) {
    const reservoir = env.reservoirs[delta.reservoirId];
    const current = reservoir.material !== undefined ? reservoir.material.entries[delta.speciesId] : undefined;
    if (!Number.isFinite(delta.deltaMolM2)) {
      finalInventoryIssues.push('пара «' + delta.reservoirId + '»/«' + delta.speciesId + '»: совокупная дельта непредставима (переполнение); не подменяется нулём');
      continue;
    }
    if (delta.deltaMolM2 < 0) {
      if (current === undefined) {
        finalInventoryIssues.push('пара «' + delta.reservoirId + '»/«' + delta.speciesId + '»: изымаемое количество НЕИЗВЕСТНО (записи вида нет в инвентаре) — неизвестное количество не считается нулём (unknown ≠ 0)');
        continue;
      }
      const after = current + delta.deltaMolM2;
      if (after < 0) {
        finalInventoryIssues.push('пара «' + delta.reservoirId + '»/«' + delta.speciesId + '»: итоговый запас отрицательный (' + String(after) + '): недостаточно реагента, отрицательный запас невозможен');
      }
    } else if (current !== undefined && !Number.isFinite(current + delta.deltaMolM2)) {
      finalInventoryIssues.push('пара «' + delta.reservoirId + '»/«' + delta.speciesId + '»: итоговый запас непредставим (переполнение: ' + String(current) + ' + ' + String(delta.deltaMolM2) + ')');
    }
  }
  if (finalInventoryIssues.length > 0) {
    return blocked('not_executable', processId, 'финальные инвентари транзакции некорректны (агрегат построен, применение не начато)', finalInventoryIssues);
  }

  // --- 9. элементный и зарядовый аудит агрегата ---
  const internalCounts: Record<string, number> = {};
  const externalCounts: Record<string, number> = {};
  // Реакции и внутренние переносы не пересекают границу: их совокупный
  // элементный/зарядовый вклад обязан сходиться в нуль. Внешние переносы
  // классифицируются по ФАКТУ пересечения границы (а не по резервуару,
  // хранящему дельту): внешний приток записан на внутренний резервуар,
  // но источник элементов — вне системы; это netExternal с границей,
  // а не внутренняя невязка.
  for (const contribution of reactionContributions) {
    internalCounts[contribution.speciesId] = (internalCounts[contribution.speciesId] ?? 0) + contribution.delta;
  }
  for (const contribution of transferContributions) {
    internalCounts[contribution.speciesId] = (internalCounts[contribution.speciesId] ?? 0) + contribution.delta;
  }
  for (const contribution of externalContributions) {
    externalCounts[contribution.speciesId] = (externalCounts[contribution.speciesId] ?? 0) + contribution.delta;
  }
  const internalElements = elementTotals(env.speciesCatalog, internalCounts);
  const externalElements = elementTotals(env.speciesCatalog, externalCounts);
  const internalCharge = chargeTotal(env.speciesCatalog, internalCounts);
  const externalCharge = chargeTotal(env.speciesCatalog, externalCounts);
  const excluded = [...new Set([...internalElements.excludedSpecies, ...internalCharge.excludedSpecies, ...externalElements.excludedSpecies, ...externalCharge.excludedSpecies])];
  if (excluded.length > 0) {
    return blocked('not_verifiable', processId, 'заряд/состав не всех участников агрегата известен: сохранение элементов и электронейтральность НЕ могут быть подтверждены и НЕ объявляются формально выполняющимися (fail-closed)', [
      'виды с неизвестным зарядом/составом в агрегате транзакции: ' + excluded.join(', ')
    ]);
  }
  const elementNames = [...new Set([...Object.keys(internalElements.totals), ...Object.keys(externalElements.totals)])].sort();
  const elementResiduals: GeochemicalCoupledElementResidual[] = [];
  const imbalanceIssues: string[] = [];
  for (const element of elementNames) {
    const internalResidual = internalElements.totals[element] ?? 0;
    const netExternal = externalElements.totals[element] ?? 0;
    elementResiduals.push({ element, internalResidual, netExternal });
    if (Math.abs(internalResidual) > balanceTolerance) {
      imbalanceIssues.push('элемент «' + element + '»: внутренняя невязка ' + String(internalResidual) + ' превышает допуск ' + String(balanceTolerance));
    }
  }
  const chargeResidual = internalCharge.charge + externalCharge.charge;
  if (Math.abs(chargeResidual) > balanceTolerance) {
    imbalanceIssues.push('зарядовая невязка агрегата ' + String(chargeResidual) + ' превышает допуск ' + String(balanceTolerance) + ': транзакция с нарушенным зарядовым балансом не применяется');
  }
  if (imbalanceIssues.length > 0) {
    return blocked('not_executable', processId, 'элементный/зарядовый аудит агрегата транзакции не сходится: транзакция не применяется', imbalanceIssues);
  }
  const audit: GeochemicalCoupledBalanceAudit = {
    status: 'balanced',
    tolerance: balanceTolerance,
    elementResiduals,
    chargeResidual,
    excludedSpecies: excluded,
    boundaryJustifications
  };

  // --- 10. ограничения применимости и происхождение ---
  const applicabilityConstraints: string[] = [
    'extent реакций и количество переносов заданы ЯВНО с provenance: исполнитель НЕ вычисляет скорости, extent и равновесие (это не кинетика и не равновесная модель)',
    'инвентари и переносы — в основании column_amount (mol/m²); смешение оснований и автоматический пересчёт запрещены',
    'применение атомарно: все изменения одной транзакции или ни одного; при not_applied входные объекты побитово неизменны'
  ];
  if (processSpecValue !== undefined && processSpecValue !== null) {
    const spec = processSpecValue as GeochemicalProcessSpec;
    provenanceSummary.push('процесс каталога «' + spec.processId + '» (mechanism coupled, implementationStatus «' + spec.implementationStatus + '»); описательная часть: ' + spec.description);
    if (spec.applicability !== undefined) applicabilityConstraints.push('применимость процесса каталога: ' + spec.applicability);
    if (spec.conditions !== undefined) applicabilityConstraints.push('условия процесса каталога: ' + spec.conditions);
  } else {
    provenanceSummary.push('spec каталога не задан: процесс определён своим processId «' + processId + '» и provenance компонент');
    if (processRaw!.transactionScopeNote !== undefined) {
      applicabilityConstraints.push('область транзакции (process.transactionScopeNote): ' + (processRaw!.transactionScopeNote as string));
    }
  }

  return {
    status: 'ready',
    transactionId,
    processId: processId!,
    time,
    reactionRecords,
    fluxRecords,
    reactionContributions,
    transferContributions,
    aggregatedDeltas,
    audit,
    applicabilityConstraints,
    provenanceSummary,
    diagnostics: [
      'план построен на одном снимке состояния: все дельты агрегированы по парам (reservoirId, speciesId) до вычисления финальных инвентарей',
      'аудит агрегата: элементов внутренней части — ' + String(elementResiduals.length) + ', все внутренние невязки в допуске ' + String(balanceTolerance) + '; зарядовая невязка ' + String(chargeResidual),
      ...applicabilityConstraints
    ],
    transactionSnapshot: captureCoupledTransactionSnapshot(env)
  };
}

// ============================================
// 5. ИСПОЛНЕНИЕ ТРАНЗАКЦИИ
// ============================================

/**
 * Атомарно исполнить готовый план:
 * проверка свежести снимка → анти-replay → применение агрегированных
 * дельт (сначала все ПОЛОЖИТЕЛЬНЫЕ, затем отрицательные по парам —
 * промежуточные состояния каждой пары не читаются повторно, изъятие
 * видит уже пополненный запас своей пары) → валидация кандидатов
 * (validateMaterialInventory, validateReservoirRecord) → регистрация
 * записей реакций (registerReaction, канонический порядок) → валидация
 * журналов (validateReactionLedger, validateFluxLedger). При любой
 * ошибке — not_applied, все входные объекты побитово неизменны
 * (все операции — иммутабельные конструкторы).
 */
export function executeGeochemicalCoupledTransaction(
  env: GeochemicalCoupledExecutionEnvironment,
  input: GeochemicalCoupledTransactionInput,
  plan: GeochemicalCoupledPlanResult
): GeochemicalCoupledExecutionResult {
  const notApplied = (reasonKind: GeochemicalCoupledBlockKind, reason: string, issues: readonly string[], error: string | null = null): GeochemicalCoupledExecutionResult =>
    ({ status: 'not_applied', reasonKind, processId: plan.status === 'ready' ? plan.processId : null, reason, issues, error });

  if (plan.status !== 'ready') {
    return notApplied(plan.reasonKind, 'план транзакции заблокирован: применение не начато. ' + plan.reason, plan.issues);
  }
  if (plan.transactionId !== input.transactionId) {
    return notApplied('not_executable', 'план построен для другого transactionId, чем заданный вход: подмена транзакции невозможна', [
      'plan.transactionId = «' + plan.transactionId + '», input.transactionId = «' + input.transactionId + '»'
    ]);
  }
  // Свежесть снимка: устаревший план не исполняется.
  if (snapshotIsStale(plan.transactionSnapshot, env)) {
    return notApplied('stale_snapshot', 'снимок состояния, на котором построен план, устарел (инвентари/журналы/применённые транзакции изменились): транзакция не применяется, постройте план заново на свежем снимке', []);
  }
  // Анти-replay при исполнении (журнал мог быть пополнен).
  const seenTransactionIds = env.appliedTransactionIds !== undefined ? env.appliedTransactionIds : [];
  if (seenTransactionIds.includes(input.transactionId)) {
    return notApplied('duplicate_transaction', 'transactionId уже был применён (проверено при исполнении): повторное применение одной транзакции запрещено', []);
  }

  try {
    const work: Record<string, ReservoirRecord> = { ...env.reservoirs };
    const mutated = new Set<string>();
    const positives = plan.aggregatedDeltas.filter((d) => d.deltaMolM2 > 0);
    const negatives = plan.aggregatedDeltas.filter((d) => d.deltaMolM2 < 0);
    for (const delta of [...positives, ...negatives]) {
      const reservoir = work[delta.reservoirId];
      if (reservoir === undefined || reservoir.material === undefined) {
        return notApplied('not_executable', 'резервуар «' + delta.reservoirId + '» отсутствует или не содержит материального инвентаря: применение не начато', []);
      }
      if (delta.deltaMolM2 > 0) {
        work[delta.reservoirId] = addMaterial(reservoir, delta.speciesId, delta.deltaMolM2);
      } else {
        work[delta.reservoirId] = removeMaterial(reservoir, delta.speciesId, -delta.deltaMolM2);
      }
      mutated.add(delta.reservoirId);
    }

    // Проверка кандидатов изменений штатными валидаторами ядра.
    const validationIssues: string[] = [];
    for (const id of mutated) {
      const res = work[id]!;
      const inventoryCheck = validateMaterialInventory(res.material!);
      if (!inventoryCheck.valid) {
        validationIssues.push('резервуар «' + id + '»: инвентарь не прошёл каноническую валидацию: ' + inventoryCheck.errors.join('; '));
      }
      const recordCheck = validateReservoirRecord(res);
      if (!recordCheck.valid) {
        validationIssues.push('резервуар «' + id + '»: не прошёл валидацию ReservoirRecord: ' + recordCheck.errors.join('; '));
      }
    }
    if (validationIssues.length > 0) {
      return notApplied('not_executable', 'кандидаты изменений резервуаров не прошли каноническую валидацию: применение откачено (входные объекты не изменялись)', validationIssues);
    }

    // Регистрация записей реакций (штатный registerReaction, канонический порядок).
    const baseLedger = env.reactionLedgerInput !== undefined ? env.reactionLedgerInput : createReactionLedger();
    let ledger = baseLedger;
    for (const record of plan.reactionRecords) {
      ledger = registerReaction(ledger, record);
    }
    const reservoirIds = Object.keys(work);
    const ledgerIssues = validateReactionLedger(ledger, { reservoirIds });
    if (ledgerIssues.length > 0) {
      return notApplied('not_executable', 'результирующий журнал реакций не проходит validateReactionLedger: регистрация откачена', ledgerIssues);
    }

    // Регистрация записей потоков: инвентарь уже применён атомарно из
    // агрегата, записи переносятся со статусом 'applied'. Форма записей
    // полностью проверяется validateFluxLedger (включая duplicate_flux_id).
    const nextFluxLedger: FluxLedger = { records: [...env.fluxLedgerInput.records, ...plan.fluxRecords] };
    const fluxIssues = validateFluxLedger(nextFluxLedger, { reservoirIds });
    if (fluxIssues.length > 0) {
      return notApplied('not_executable', 'результирующий журнал потоков не проходит validateFluxLedger: регистрация откачена', fluxIssues);
    }

    return {
      status: 'applied',
      transactionId: plan.transactionId,
      processId: plan.processId,
      reservoirs: work,
      reactionLedger: ledger,
      fluxLedger: nextFluxLedger,
      contract: {
        transactionId: plan.transactionId,
        processId: plan.processId,
        time: plan.time,
        reactionTransactionIds: plan.reactionRecords.map((r) => r.id),
        fluxTransactionIds: plan.fluxRecords.map((r) => r.id),
        atomicity: 'single_snapshot_and_rollback'
      },
      aggregatedDeltas: plan.aggregatedDeltas,
      audit: plan.audit,
      diagnostics: plan.diagnostics
    };
  } catch (error) {
    return notApplied('not_executable', 'исполнение прервано структурированной ошибкой ядра: входные объекты не изменены', [], error instanceof Error ? error.message : String(error));
  }
}

// ============================================
// 6. ИСПОЛНЕНИЕ К ЯДРУ МИРА (CoreWorldState)
// ============================================

/**
 * Иммутабельно исполнить атомарную coupled-транзакцию К ЯДРУ МИРА весь
 * целиком (план → исполнение → сборка нового состояния):
 * - порядок существующих резервуаров сохраняется; обновляются ТОЛЬКО
 *   затронутые резервуары (незатронутые разделяются по ссылке);
 * - reactionLedger/fluxLedger заменяются новыми (заданные не мутируются);
 * - журнал geochemicalTransactionLog дополняется единым transactionId
 *   (анти-replay: повторное исполнение той же транзакции отклоняется);
 * - ядро схемы 1.5.0 получает geochemicalTransactionLog (схема ядра
 *   результата — 1.6.0); ядро 1.6.0 — журнал дополняется; прочие
 *   версии — отказ (выполните миграцию сохранений);
 * - результирующее состояние проверяется штатной validateWorldState;
 *   любая проблема = not_applied, входное состояние не изменено.
 * Дубликат id резервуара в массиве ядра — явный отказ.
 */
export function executeGeochemicalCoupledTransactionOnWorld(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: GeochemicalCoupledTransactionInput
): GeochemicalCoupledWorldExecutionResult {
  const processIdOfInput = (): string | null => {
    if (input !== undefined && isPlainRecord(input)) {
      const process = (input as unknown as Record<string, unknown>).process;
      if (isPlainRecord(process) && typeof process.processId === 'string') return process.processId;
    }
    return null;
  };
  const notApplied = (reasonKind: GeochemicalCoupledBlockKind, reason: string, issues: readonly string[], error: string | null = null): GeochemicalCoupledWorldExecutionResult =>
    ({ status: 'not_applied', reasonKind, processId: processIdOfInput(), reason, issues, error });

  if (core.schemaVersion !== '1.5.0' && core.schemaVersion !== '1.6.0') {
    return notApplied('not_executable', 'схема состояния ядра «' + core.schemaVersion + '» не поддерживается исполнителем coupled-транзакций (поддерживаются 1.5.0 — полю geochemicalTransactionLog будет создано — и 1.6.0): выполните миграцию сохранений', []);
  }

  const reservoirsById: Record<string, ReservoirRecord> = {};
  for (const reservoir of core.reservoirs) {
    if (reservoirsById[reservoir.id] !== undefined) {
      return notApplied('not_executable', 'в состоянии ядра резервуары с повторяющимся id — построение словаря среды даёт отказ: перезапись дубликата молча запрещена', ['reservoirs: дублирующийся id резервуара «' + reservoir.id + '»']);
    }
    reservoirsById[reservoir.id] = reservoir;
  }

  const env: GeochemicalCoupledExecutionEnvironment = {
    speciesCatalog,
    reservoirs: reservoirsById,
    reactionLedgerInput: core.reactionLedger,
    fluxLedgerInput: core.fluxLedger,
    appliedTransactionIds: core.geochemicalTransactionLog !== undefined ? core.geochemicalTransactionLog.appliedTransactionIds : []
  };

  let plan: GeochemicalCoupledPlanResult;
  try {
    plan = planGeochemicalCoupledTransaction(env, input);
  } catch (error) {
    return notApplied('not_executable', 'планирование завершилось необработанной ошибкой: атомарность сохранена, состояние не изменено', [], error instanceof Error ? error.message : String(error));
  }

  const execution = executeGeochemicalCoupledTransaction(env, input, plan);
  if (execution.status !== 'applied') {
    return notApplied(execution.reasonKind, execution.reason, execution.issues, execution.error);
  }

  const updatedReservoirs: ReservoirRecord[] = core.reservoirs.map((reservoir) => {
    const updated = execution.reservoirs[reservoir.id];
    return updated !== undefined && updated !== reservoir ? updated : reservoir;
  });

  const coreWithLedgers: CoreWorldState = {
    ...core,
    schemaVersion: '1.6.0',
    reservoirs: updatedReservoirs,
    reactionLedger: execution.reactionLedger,
    fluxLedger: execution.fluxLedger
  };
  const updatedCore = withTransactionLogApplied(coreWithLedgers, execution.transactionId);

  const coreIssues = validateWorldState(updatedCore);
  if (coreIssues.length > 0) {
    return notApplied(
      'not_executable',
      'результирующее состояние ядра не прошло каноническую валидацию validateWorldState: применение откачено (входное состояние не изменялось)',
      coreIssues.map((issue) => `${issue.code} (${issue.component}): ${issue.message}`)
    );
  }

  return {
    status: 'applied',
    core: updatedCore,
    transactionId: execution.transactionId,
    processId: execution.processId,
    contract: execution.contract,
    aggregatedDeltas: execution.aggregatedDeltas,
    audit: execution.audit,
    diagnostics: execution.diagnostics
  };
}

