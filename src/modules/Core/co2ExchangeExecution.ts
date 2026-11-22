// ============================================
// CO2 PHASE EXCHANGE EXECUTION — атомарный фазовый переход CO2(г) ⇌ CO2(aq)
// ============================================
//
// Stage 4.9e. Тонкий ТРАНЗАКЦИОННЫЙ АДАПТЕР поверх атомарного
// исполнителя coupled-транзакций Stage 4.9d для фазового перехода
// углерода между атмосферой и океаном:
//
//   - направление 'dissolution'     : co2 (атм, газ) → co2_aq (океан);
//   - направление 'volatilisation'  : co2_aq (океан) → co2 (атм, газ).
//
// ЧТО ЭТО И ЧТО ЭТО НЕ ЭТО:
// - co2 и co2_aq — РАЗНЫЕ виды каталога (разные id и фазы): фазовый
//   переход описан явным определением реакции с реальными
//   участниками по обе стороны границы; НЕ создаются фиктивные
//   записи кинетических реакций, НЕ используются generic transfer API
//   так, словно species id совпадают, и НЕ переписывается
//   geochemicalCoupledExecution.ts — адаптер только собирает вход
//   отдельной coupled-транзакции;
// - количество обмена (extent, mol/m²) приходит ТОЛЬКО ЯВНО, с
//   идентифицированным provenance; типовой источник — результат
//   термодинамического равновесия Stage 4.9e
//   (evaluateAtmosphereOceanEquilibrium → co2PhaseExchangeFromEquilibrium);
//   МОДУЛЬ НЕ ВЫЧИСЛЯЕТ И НЕ ВЫДУМЫВАЕТ ни скоростей, ни коэффициентов
//   переноса, ни толщины пограничного слоя (кинетика газообмена —
//   следующий этап, Stage 4.9g);
// - ВСЯ атомарность, анти-replay (geochemicalTransactionLog),
//   stale-snapshot-защита, агрегирование дельт на одном снимке,
//   элементный/зарядовый аудит, побитовая неизменность входа при
//   отказе и финальная валидация CoreWorldState ДЕЛЕГИРОВАНЫ
//   исполнителю Stage 4.9d без изменений (никакой второй семантики
//   не создаётся);
// - процесс каталога: растворение → geo.dissolution.co2_aq.atm->ocn,
//   испарение → geo.ocean_atm_exchange.co2.ocn->atm. spec каталога в
//   транзакцию НЕ передаётся (processSpec: null): механизм каталога —
//   'reaction', а исполнитель coupled-транзакций требует от переданного
//   spec механизм 'coupled' (промпт 4.9d, проверка 1); происхождение
//   несут definitionProvenance/extentProvenance, а scope транзакции
//   зафиксирован в transactionScopeNote. Статусы каталога
//   ('reaction_required') не меняются этим модулем.
//
// Повторное использование существующих контрактов (никаких дублей):
// geochemicalCoupledExecution.ts (Stage 4.9d), geochemicalReactionExecution.ts
// (4.9b), geochemicalReactionContext.ts, co2Solubility.ts (Stage 4.9e),
// worldState.ts. Вторая система единиц не создаётся: column_amount (mol/m²).

import type { ReservoirRecord } from './reservoir';
import { isPlainRecord } from './reservoir';
import type { CoreWorldState } from './worldState';
import { validateWorldState } from './worldState';
import type { SpeciesCatalog } from './species';
import type { FluxTime } from './fluxLedger';
import type { ReactionDataProvenance } from './geochemicalReactionContext';
import { GEOCHEMICAL_REACTION_EXTENT_BASIS } from './geochemicalReactionContext';
import type { GeochemicalReactionDefinition } from './geochemicalReactionExecution';
import type { GeochemicalCoupledBalanceAudit } from './geochemicalCoupledExecution';
import type {
  GeochemicalCoupledBlockKind,
  GeochemicalCoupledExecutionEnvironment,
  GeochemicalCoupledPlanResult,
  GeochemicalCoupledTransactionInput
} from './geochemicalCoupledExecution';
import {
  executeGeochemicalCoupledTransaction,
  planGeochemicalCoupledTransaction,
  withTransactionLogApplied
} from './geochemicalCoupledExecution';
import type { CO2AtmosphereOceanEquilibriumResult } from './co2Solubility';// ============================================
// 1. КОНСТАНТЫ И ИДЕНТИФИКАЦИЯ ПРОЦЕССА
// ============================================

/** Направление фазового обмена CO2 между атмосферой и океаном. */
export type CO2PhaseExchangeDirection = 'dissolution' | 'volatilisation';

/** Процессы каталога геохимических процессов для направлений обмена. */
export const CO2_DISSOLUTION_PROCESS_ID = 'geo.dissolution.co2_aq.atm->ocn';
export const CO2_VOLATILISATION_PROCESS_ID = 'geo.ocean_atm_exchange.co2.ocn->atm';

/**
 * Допуск «перенос отсутствует» (mol/m²): величина обмена из равновесия
 * ниже этого модуля считается нулевой (равновесие уже достигнуто),
 * а не исполняется микротранзакция.
 */
export const CO2_PHASE_EXCHANGE_TRANSFER_TOLERANCE_MOL_M2 = 1e-12;

/**
 * Происхождение ОПРЕДЕЛЕНИЯ реакции фазового перехода: стехиометрия
 * следует из состава молекулы CO2 (co2 и co2_aq — {C:1, O:2}), связь с
 * атмосферно-океаническим обменом и величина — из Stage 4.9e.
 */
export const CO2_PHASE_EXCHANGE_DEFINITION_PROVENANCE: ReactionDataProvenance = {
  sourceName: 'Stage 4.9e: фазовый переход CO2(г) ⇌ CO2(aq) с количествами из термодинамического равновесия (co2Solubility.ts, Weiss 1974)',
  sourceId: 'doi:10.1016/0304-4203(74)90015-2',
  reference:
    'Weiss, R. F. (1974), Marine Chemistry 2:203-215; каталог evowars: geo.dissolution.co2_aq.atm->ocn / geo.ocean_atm_exchange.co2.ocn->atm',
  method: 'стехиометрия из состава молекулы CO2 (C:1, O:2); количество обмена — явно от вызывающей стороны (равновесие 4.9e или иной идентифицированный вход)',
  limitations:
    'определение НЕ утверждает кинетику газообмена, скорость переноса или время установления: исполнение — завершённое количество (extent), а не rate'
};

/**
 * Происхождение количества обмена по умолчанию при выводе из результата
 * замкнутого равновесия Stage 4.9e (co2PhaseExchangeFromEquilibrium).
 */
export const CO2_PHASE_EXCHANGE_EQUILIBRIUM_PROVENANCE: ReactionDataProvenance = {
  sourceName: 'Stage 4.9e: замкнутое равновесие атмосфера-океан (co2Solubility.ts: Weiss K0 + карбонатный решатель Stage 4.9c)',
  sourceId: 'doi:10.1016/0304-4203(74)90015-2',
  field: 'carbonTransferAtmToOceanMolPerM2',
  note:
    'величина обмена вычислена замкнутым равновесием Stage 4.9e при явных входах вызывающей стороны (сохранение общего углерода в допуске); равновесие — термодинамическая цель, НЕ скорость',
  reference: 'Weiss, R. F. (1974), Marine Chemistry 2:203-215; DOI 10.1016/0304-4203(74)90015-2'
};

export const CO2_PHASE_EXCHANGE_TRANSACTION_SCOPE_NOTE =
  'Stage 4.9e: фазовый переход CO2(г) ⇌ CO2(aq) между атмосферой и океаном. Спецификация каталога не передаётся (processSpec: null): механизм каталога «reaction», а coupled-исполнитель Stage 4.9d принимает только механизм «coupled»; исполнение идёт реакционной компонентой coupled-транзакции с extent из явного входа (типово — замкнутое равновесие Stage 4.9e); кинетика газообмена не реализована и не утверждается';

// ============================================
// 2. ОПРЕДЕЛЕНИЕ РЕАКЦИИ ФАЗОВОГО ПЕРЕХОДА
// ============================================

/**
 * Построить определение реакции фазового перехода для направления.
 * co2 и co2_aq — разные виды; пары (резервуар, вид) на каждой стороне
 * уникальны, заряд обеих сторон равен нулю, состав {C:1, O:2} —
 * стехиометрический баланс подтверждается исполнителем 4.9b.
 */
export function buildCO2PhaseExchangeReactionDefinition(args: {
  readonly direction: CO2PhaseExchangeDirection;
  readonly atmosphereReservoirId: string;
  readonly oceanReservoirId: string;
  readonly definitionProvenance?: ReactionDataProvenance;
}): GeochemicalReactionDefinition {
  const prov = args.definitionProvenance !== undefined ? args.definitionProvenance : CO2_PHASE_EXCHANGE_DEFINITION_PROVENANCE;
  if (args.direction === 'dissolution') {
    return {
      reactionId: 'co2.phase-exchange.atm->ocn',
      processId: CO2_DISSOLUTION_PROCESS_ID,
      description: 'CO2(г, атмосфера) -> CO2(aq, океан): фазовый переход на границе раздела (не химическая реакция и не физический перенос одного вида)',
      reactants: [{ reservoirId: args.atmosphereReservoirId, speciesId: 'co2', coefficient: 1 }],
      products: [{ reservoirId: args.oceanReservoirId, speciesId: 'co2_aq', coefficient: 1 }],
      extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
      definitionProvenance: { ...prov },
      applicability: 'столбовые запасы column_amount (mol/m²); количество обмена задано явно с provenance',
      limitations:
        'фазовый переход не есть кинетическая реакция и не перенос одного вида: extent — завершённое количество из равновесия/входа; запись в ReactionLedger атрибутирует количество, а НЕ скорость газообмена (кинетика — следующий этап)',
      assumptions: ['фазовая идентичность: co2 (gas) и co2_aq (aqueous) — разные виды каталога с одинаковым составом {C:1, O:2}']
    };
  }
  return {
    reactionId: 'co2.phase-exchange.ocn->atm',
    processId: CO2_VOLATILISATION_PROCESS_ID,
    description: 'CO2(aq, океан) -> CO2(г, атмосфера): обратный фазовый переход на границе раздела',
    reactants: [{ reservoirId: args.oceanReservoirId, speciesId: 'co2_aq', coefficient: 1 }],
    products: [{ reservoirId: args.atmosphereReservoirId, speciesId: 'co2', coefficient: 1 }],
    extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
    definitionProvenance: { ...prov },
    applicability: 'столбовые запасы column_amount (mol/m²); количество обмена задано явно с provenance',
    limitations:
      'фазовый переход не есть кинетическая реакция и не перенос одного вида: extent — завершённое количество из равновесия/входа; запись в ReactionLedger атрибутирует количество, а НЕ скорость газообмена (кинетика — следующий этап)',
    assumptions: ['фазовая идентичность: co2 (gas) и co2_aq (aqueous) — разные виды каталога с одинаковым составом {C:1, O:2}']
  };
}

// ============================================
// 3. ВХОД АДАПТЕРА И ЕГО ВАЛИДАЦИЯ
// ============================================

/** Вход фазового обмена CO2 (количество — ЯВНО, с provenance). */
export interface CO2PhaseExchangeInput {
  /** Единый id транзакции (анти-replay ядра). */
  readonly transactionId: string;
  /** Направление обмена. */
  readonly direction: CO2PhaseExchangeDirection;
  readonly atmosphereReservoirId: string;
  readonly oceanReservoirId: string;
  /**
   * Завершённое количество обмена (модуль переноса углерода), mol/m²:
   * для 'dissolution' — сколько co2 переходит в океан, для
   * 'volatilisation' — сколько co2_aq выходит в атмосферу.
   * НЕ скорость и НЕ оценка: значение с идентифицированным provenance.
   */
  readonly amountMolPerM2: number;
  /** Откуда известно количество (обязателен, идентифицирован). */
  readonly amountProvenance: ReactionDataProvenance;
  /** Единая отметка времени транзакции (null — не привязана). */
  readonly time?: FluxTime | null;
  /** Переопределение processId (по умолчанию — процесс каталога направления). */
  readonly processId?: string;
  /** Служебная заметка записи реакции. */
  readonly note?: string;
}

function provenanceIdentified(p: unknown): boolean {
  if (!isPlainRecord(p)) return false;
  const r = p as Record<string, unknown>;
  return (
    (typeof r.sourceName === 'string' && r.sourceName.trim() !== '') ||
    (typeof r.sourceId === 'string' && r.sourceId.trim() !== '') ||
    (typeof r.datasetId === 'string' && r.datasetId.trim() !== '') ||
    (typeof r.reference === 'string' && r.reference.trim() !== '')
  );
}

/** Валидация формы входа адаптера (fail-closed, до обращения к исполнителю). */
export function validateCO2PhaseExchangeInput(input: unknown): string[] {
  const issues: string[] = [];
  if (!isPlainRecord(input)) {
    return ['вход фазового обмена должен быть объектом-записью (plain record)'];
  }
  const r = input as Record<string, unknown>;
  if (typeof r.transactionId !== 'string' || r.transactionId.trim() === '') {
    issues.push('transactionId должен быть непустой строкой');
  }
  if (r.direction !== 'dissolution' && r.direction !== 'volatilisation') {
    issues.push('direction должен быть «dissolution» или «volatilisation»');
  }
  for (const key of ['atmosphereReservoirId', 'oceanReservoirId'] as const) {
    if (typeof r[key] !== 'string' || (r[key] as string).trim() === '') {
      issues.push('«' + key + '» должен быть непустой строкой');
    }
  }
  if (
    typeof r.atmosphereReservoirId === 'string' &&
    typeof r.oceanReservoirId === 'string' &&
    r.atmosphereReservoirId === r.oceanReservoirId
  ) {
    issues.push('атмосферный и океанский резервуары должны различаться: фазовый переход идёт МЕЖДУ фазами');
  }
  if (typeof r.amountMolPerM2 !== 'number' || !Number.isFinite(r.amountMolPerM2) || r.amountMolPerM2 <= 0) {
    issues.push('amountMolPerM2 должен быть конечным положительным числом (mol/m²); ноль/отрицательное/нефинитное — отсутствие обмена, а не транзакция');
  }
  if (!provenanceIdentified(r.amountProvenance)) {
    issues.push('amountProvenance обязателен и должен идентифицировать источник (sourceName, sourceId, datasetId или reference)');
  }
  if (r.processId !== undefined && (typeof r.processId !== 'string' || r.processId.trim() === '')) {
    issues.push('processId, если задан, должен быть непустой строкой');
  }
  if (r.note !== undefined && typeof r.note !== 'string') {
    issues.push('note, если задана, должна быть строкой');
  }
  return issues;
}

/** Сборка входа coupled-транзакции Stage 4.9d из входа адаптера. */
export function buildCO2PhaseExchangeTransactionInput(input: CO2PhaseExchangeInput): GeochemicalCoupledTransactionInput {
  const definition = buildCO2PhaseExchangeReactionDefinition(input);
  const processId = input.processId !== undefined ? input.processId : definition.processId;
  return {
    transactionId: input.transactionId,
    process: {
      processId,
      processSpec: null,
      transactionScopeNote: CO2_PHASE_EXCHANGE_TRANSACTION_SCOPE_NOTE
    },
    time: input.time !== undefined ? input.time : null,
    components: [
      {
        kind: 'reaction',
        definition,
        extentMolPerM2: input.amountMolPerM2,
        extentProvenance: input.amountProvenance,
        note: input.note
      }
    ]
  };
}

// ============================================
// 4. ВЫВОД ОБМЕНА ИЗ ЗАМКНУТОГО РАВНОВЕСИЯ STAGE 4.9e
// ============================================

export type CO2PhaseExchangeFromEquilibriumResult =
  | {
      readonly status: 'ready';
      readonly direction: CO2PhaseExchangeDirection;
      /** Количество обмена, mol/m² (|перенос|; > 0). */
      readonly amountMolPerM2: number;
      readonly amountProvenance: ReactionDataProvenance;
      readonly fCO2Atm: number;
      readonly pCO2Atm: number;
    }
  | {
      /** |перенос| в допуске: равновесие уже достигнуто, транзакции нет. */
      readonly status: 'no_transfer';
      readonly carbonTransferAtmToOceanMolPerM2: number;
      readonly transferToleranceMolPerM2: number;
    }
  | {
      /** Равновесие не сошлось или не проверяемо: обмена не предлагается. */
      readonly status: 'not_available';
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Вывести направление и количество фазового обмена из результата
 * замкнутого равновесия атмосфера-океан Stage 4.9e.
 * Знак carbonTransferAtmToOceanMolPerM2: > 0 — растворение (атм → окн),
 * < 0 — испарение (окн → атм); ноль в допуске — обмена нет.
 * НИКАКИХ неявных порогов/скоростей здесь не возникает.
 */
export function co2PhaseExchangeFromEquilibrium(
  result: CO2AtmosphereOceanEquilibriumResult,
  options?: {
    /** Допуск «обмена нет», mol/m² (по умолчанию CO2_PHASE_EXCHANGE_TRANSFER_TOLERANCE_MOL_M2). */
    readonly transferToleranceMolPerM2?: number;
    /** Переопределение provenance количества обмена. */
    readonly amountProvenance?: ReactionDataProvenance;
  }
): CO2PhaseExchangeFromEquilibriumResult {
  const tolerance = options?.transferToleranceMolPerM2 !== undefined ? options.transferToleranceMolPerM2 : CO2_PHASE_EXCHANGE_TRANSFER_TOLERANCE_MOL_M2;
  if (result.status === 'not_applied') {
    return { status: 'not_available', reason: result.reason, issues: [...result.issues] };
  }
  if (result.status === 'not_verifiable') {
    return { status: 'not_available', reason: result.reason, issues: [...result.missingInputs] };
  }
  const transfer = result.carbonTransferAtmToOceanMolPerM2;
  if (!Number.isFinite(transfer)) {
    return { status: 'not_available', reason: 'перенос углерода из равновесия непредставим', issues: [] };
  }
  if (Math.abs(transfer) <= tolerance) {
    return { status: 'no_transfer', carbonTransferAtmToOceanMolPerM2: transfer, transferToleranceMolPerM2: tolerance };
  }
  const prov = options?.amountProvenance !== undefined ? options.amountProvenance : CO2_PHASE_EXCHANGE_EQUILIBRIUM_PROVENANCE;
  return {
    status: 'ready',
    direction: transfer > 0 ? 'dissolution' : 'volatilisation',
    amountMolPerM2: Math.abs(transfer),
    amountProvenance: { ...prov },
    fCO2Atm: result.fCO2Atm,
    pCO2Atm: result.pCO2Atm
  };
}

// ============================================
// 5. ПЛАН И ИСПОЛНЕНИЕ (представитель Stage 4.9d)
// ============================================

/** План фазового обмена (готовый или заблокированный). */
export type CO2PhaseExchangePlanResult =
  | {
      readonly status: 'ready';
      readonly direction: CO2PhaseExchangeDirection;
      readonly processId: string;
      /** Готовый план coupled-исполнителя Stage 4.9d (со снимком). */
      readonly plan: GeochemicalCoupledPlanResult;
      /** Вход coupled-транзакции, которому план соответствует. */
      readonly transactionInput: GeochemicalCoupledTransactionInput;
    }
  | {
      readonly status: 'blocked';
      readonly reasonKind: GeochemicalCoupledBlockKind;
      readonly processId: string | null;
      readonly direction: CO2PhaseExchangeDirection | null;
      readonly reason: string;
      readonly issues: readonly string[];
    };

/** Результат исполнения фазового обмена (мировой уровень). */
export type CO2PhaseExchangeWorldResult =
  | {
      readonly status: 'applied';
      /** НОВОЕ состояние ядра; вход не мутируется. */
      readonly core: CoreWorldState;
      readonly transactionId: string;
      readonly processId: string;
      readonly direction: CO2PhaseExchangeDirection;
      readonly amountMolPerM2: number;
      readonly aggregatedDeltas: readonly { readonly reservoirId: string; readonly speciesId: string; readonly deltaMolM2: number }[];
      readonly audit: GeochemicalCoupledBalanceAudit;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: GeochemicalCoupledBlockKind;
      readonly processId: string | null;
      readonly direction: CO2PhaseExchangeDirection | null;
      readonly reason: string;
      readonly issues: readonly string[];
      readonly error: string | null;
    };

function environmentFromCore(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog
): { environment: GeochemicalCoupledExecutionEnvironment } | { environment: null; issues: string[] } {
  const reservoirsById: Record<string, ReservoirRecord> = {};
  for (const reservoir of core.reservoirs) {
    if (reservoirsById[reservoir.id] !== undefined) {
      return {
        environment: null,
        issues: ['в состоянии ядра резервуары с повторяющимся id — построение среды даёт отказ: перезапись дубликата молча запрещена (id «' + reservoir.id + '»)']
      };
    }
    reservoirsById[reservoir.id] = reservoir;
  }
  return {
    environment: {
      speciesCatalog,
      reservoirs: reservoirsById,
      reactionLedgerInput: core.reactionLedger,
      fluxLedgerInput: core.fluxLedger,
      appliedTransactionIds: core.geochemicalTransactionLog !== undefined ? core.geochemicalTransactionLog.appliedTransactionIds : []
    },
    issues: []
  };
}

/**
 * Построить план фазового обмена на текущем состоянии ядра.
 * План НЕ изменяет состояние; для защиты от устаревания держите план
 * и передавайте его в executeCO2PhaseExchangePrepared на ТОМ ЖЕ (или
 * тронутом — тогда честный stale_snapshot) состоянии.
 */
export function planCO2PhaseExchange(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: CO2PhaseExchangeInput
): CO2PhaseExchangePlanResult {
  const formIssues = validateCO2PhaseExchangeInput(input);
  if (formIssues.length > 0) {
    return {
      status: 'blocked',
      reasonKind: 'not_executable',
      processId: null,
      direction: isPlainRecord(input) && typeof (input as Record<string, unknown>).direction === 'string' ? ((input as Record<string, unknown>).direction as CO2PhaseExchangeDirection) : null,
      reason: 'вход фазового обмена не проходит валидацию формы',
      issues: formIssues
    };
  }
  if (core.schemaVersion !== '1.5.0' && core.schemaVersion !== '1.6.0') {
    return {
      status: 'blocked',
      reasonKind: 'not_executable',
      processId: null,
      direction: input.direction,
      reason: 'схема состояния ядра «' + core.schemaVersion + '» не поддерживается (поддерживаются 1.5.0 и 1.6.0): выполните миграцию сохранений',
      issues: []
    };
  }
  const envResult = environmentFromCore(core, speciesCatalog);
  if (envResult.environment === null) {
    return { status: 'blocked', reasonKind: 'not_executable', processId: null, direction: input.direction, reason: envResult.issues[0] ?? 'среда не построена', issues: envResult.issues };
  }
  const transactionInput = buildCO2PhaseExchangeTransactionInput(input);
  const plan = planGeochemicalCoupledTransaction(envResult.environment, transactionInput);
  if (plan.status !== 'ready') {
    return { status: 'blocked', reasonKind: plan.reasonKind, processId: plan.processId, direction: input.direction, reason: plan.reason, issues: [...plan.issues] };
  }
  return {
    status: 'ready',
    direction: input.direction,
    processId: transactionInput.process.processId,
    plan,
    transactionInput
  };
}

/**
 * Исполнить ПОДГОТОВЛЕННЫЙ план к ядру. Среда перестраивается из
 * переданного ядра: если состояние изменилось с момента плана,
 * исполнитель Stage 4.9d сам вернёт stale_snapshot (защита делегирована
 * без дублирования). При успехе — мировая сборка ядра теми же
 * шагами, что у executeGeochemicalCoupledTransactionOnWorld.
 */
export function executeCO2PhaseExchangePrepared(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  prepared: CO2PhaseExchangePlanResult
): CO2PhaseExchangeWorldResult {
  if (prepared.status !== 'ready') {
    return {
      status: 'not_applied',
      reasonKind: prepared.reasonKind,
      processId: prepared.processId,
      direction: prepared.direction,
      reason: prepared.reason,
      issues: [...prepared.issues],
      error: null
    };
  }
  const direction = prepared.direction;
  const envResult = environmentFromCore(core, speciesCatalog);
  if (envResult.environment === null) {
    return { status: 'not_applied', reasonKind: 'not_executable', processId: prepared.processId, direction, reason: envResult.issues[0] ?? 'среда не построена', issues: envResult.issues, error: null };
  }
  const execution = executeGeochemicalCoupledTransaction(envResult.environment, prepared.transactionInput, prepared.plan);
  if (execution.status !== 'applied') {
    return { status: 'not_applied', reasonKind: execution.reasonKind, processId: execution.processId, direction, reason: execution.reason, issues: [...execution.issues], error: execution.error };
  }

  // Мировая сборка — те же шаги, что у исполнителя Stage 4.9d
  // (executeGeochemicalCoupledTransactionOnWorld): порядок резервуаров,
  // журналы, журнал транзакций, финальная validateWorldState.
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
    return {
      status: 'not_applied',
      reasonKind: 'not_executable',
      processId: prepared.processId,
      direction,
      reason: 'результирующее состояние ядра не прошло validateWorldState: применение откачено (входное состояние не изменялось)',
      issues: coreIssues.map((issue) => `${issue.code} (${issue.component}): ${issue.message}`),
      error: null
    };
  }
  return {
    status: 'applied',
    core: updatedCore,
    transactionId: execution.transactionId,
    processId: execution.processId,
    direction,
    amountMolPerM2: prepared.transactionInput.components[0]?.kind === 'reaction' ? prepared.transactionInput.components[0].extentMolPerM2 : 0,
    aggregatedDeltas: execution.aggregatedDeltas,
    audit: execution.audit,
    diagnostics: execution.diagnostics
  };
}

/**
 * Однофазовый вызов: план на переданном ядре → исполнение к ядру.
 * Строится на том же состоянии, что исполняется, поэтому адаптер сам
 * не может «промахнуться» снимком: все проверки Stage 4.9d действуют.
 */
export function executeCO2PhaseExchange(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: CO2PhaseExchangeInput
): CO2PhaseExchangeWorldResult {
  const prepared = planCO2PhaseExchange(core, speciesCatalog, input);
  if (prepared.status !== 'ready') {
    return {
      status: 'not_applied',
      reasonKind: prepared.reasonKind,
      processId: prepared.processId,
      direction: prepared.direction,
      reason: prepared.reason,
      issues: [...prepared.issues],
      error: null
    };
  }
  return executeCO2PhaseExchangePrepared(core, speciesCatalog, prepared);
}
