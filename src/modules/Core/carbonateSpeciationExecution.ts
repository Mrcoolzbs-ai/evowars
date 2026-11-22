// ============================================================
// CARBONATE SPECIATION EXECUTION — атомарное применение результатов
// карбонатной специации Stage 4.9c к инвентарю океана (Stage 4.9d)
// ============================================================
//
// ЧТО ЭТО: производственный исполнитель РАВНОВЕСНОГО ПЕРЕРАСПРЕДЕЛЕНИЯ
// неорганического углерода (co2_aq / hco3_aq / co3_aq) внутри ОДНОГО
// океанического резервуара. Перераспределение задаётся РАЗНОСТЬЮ двух
// согласованных равновесных распределений (baseline, target), полученных
// вызывающей стороной от Stage 4.9c (solveCarbonateEquilibrium, затем
// planCarbonateSpeciationTransfer). ВТОРОГО карбонатного решателя здесь
// НЕТ и не создаётся: модуль применяет готовый результат Stage 4.9c.
//
// ГЛАВНЫЕ ИНВАРИАНТЫ (атомарность «всё или ничего»):
// - план → полный набор проверок → применение; при ЛЮБОЙ проблеме —
//   not_applied с конкретной причиной, входное состояние побитово
//   неизменно (все операции иммутабельны);
// - один transactionId на всё перераспределение; анти-replay через
//   geochemicalTransactionLog (повторное применение отклоняется);
// - снимок состояния фиксируется при планировании; устаревший снимок
//   не исполняется (stale_snapshot);
// - НЕ создаётся ни одной записи ReactionLedger и FluxLedger:
//   перераспределение внутри одного резервуара не является переносом
//   между резервуарами, фиктивные потоки atmosphere → ocean запрещены;
// - h2o_aq — закреплённый растворитель Stage 4.9c: его инвентарь
//   НЕ изменяется (растворитель — не переносимый запас);
// - НЕ смешиваются co2 (газ) и co2_aq (водная форма): модуль касается
//   только co2_aq;
// - mol/kg-SW → mol/m² ТОЛЬКО умножением на ЯВНО заданную массу
//   водного столба seawaterColumnMassKgPerM2 (единица «kg-SW/m²»,
//   идентифицированный provenance, конечная положительная); масса
//   не вычисляется из произвольной глубины океана.
//
// ЗАРЯД И ПРОТОНЫ (честный fail-closed): план переноса
// planCarbonateSpeciationTransfer НЕ включает перенос H+ и OH-.
// Модуль восстанавливает изменения [H+] и [OH-] ТОЛЬКО из переданных
// распределений и ТОЛЬКО если обе стороны их предоставляют (oh_aq не
// null); если OH- доступна только с одной стороны — отказ
// not_verifiable: протонный перенос нельзя достоверно восстановить.
// Изменение модельного заряда перемещённых количеств обязано быть
// закрыто ЯВНО заданной компенсацией фона сильных ионов (с provenance);
// без неё электронейтральность НЕ объявляется выполняющейся.
// Элементные невязки C проверяются количественно (DIC); невязки H/O
// НЕ объявляются нулями: они закрыты растворителем (h2o_aq, инвентарь
// не меняется) и заявленным фоном, что фиксируется атрибуцией.
//
// ЭТО НЕ КИНЕТИКА: скорость растворения CO2, время установления
// равновесия и любые rates здесь не вычисляются. Равновесный сдвиг
// задаёт вызывающая сторона через результаты Stage 4.9c. Исполнимы
// только synthetic-фикстуры тестов и внутренний процесс
// geo.carbonate.speciation.stage-4.9c; кинетические coupled-процессы
// каталога (geo.silicate_weathering..., geo.carbonate_weathering...)
// остаются not_implemented — Stage 4.9 этим НЕ закрывается.

import type { CoreWorldState } from './worldState';
import { CORE_WORLD_STATE_SCHEMA_VERSION, validateWorldState } from './worldState';
import type { InventoryBasis, ReservoirRecord } from './reservoir';
import { isPlainRecord, setMaterialInventory, validateReservoirRecord } from './reservoir';
import type { DataProvenance } from './scientificValue';
import type { SpeciesCatalog } from './species';
import { chargeTotal, elementTotals } from './species';
import { GEOCHEMICAL_INVENTORY_BASIS } from './geochemicalFluxes';
import { withTransactionLogApplied } from './geochemicalCoupledExecution';
import type { CarbonateActivityModel, CarbonatePhScale } from './carbonateChemistry';
import { planCarbonateSpeciationTransfer } from './carbonateChemistry';

// ===================== 1. КОНСТАНТЫ =====================

/** Идентификатор внутреннего равновесного процесса (не кинетика). */
export const CARBONATE_SPECIATION_PROCESS_ID = 'geo.carbonate.speciation.stage-4.9c';

/**
 * Допуск сохранения DIC, mol/kg-SW (конвенция Stage 4.9c: невязки
 * DIC/TA 1e-12 mol/kg-SW). Элементная C-невязка в mol/m² проверяется
 * этим же допуском, пересчитанным через массу столба.
 */
export const CARBONATE_SPECIATION_DIC_TOLERANCE_MOL_PER_KG_SW = 1e-12;

/** Допуск зарядового баланса распределений, mol/kg-SW. */
export const CARBONATE_SPECIATION_CHARGE_TOLERANCE_MOL_PER_KG_SW = 1e-12;

/**
 * Допуск согласования baseline с фактическим инвентарём, mol/m²:
 * запись инвентаря обязана совпасть с концентрация × масса столба.
 */
export const CARBONATE_BASELINE_TOLERANCE_MOL_M2 = 1e-12;

/** Единица явно задаваемой массы водного столба. */
export const SEAWATER_COLUMN_MASS_UNIT = 'kg-SW/m²';

// ===================== 2. ВХОДНЫЕ КОНТРАКТЫ =====================

/**
 * Согласованное равновесное распределение (одна сторона сдвига).
 * Значения обязан дать Stage 4.9c; исполнитель равновесие не решает.
 */
export interface CarbonateSpeciationDistribution {
  readonly phScale: CarbonatePhScale;
  readonly activityModel: CarbonateActivityModel;
  readonly temperatureK: number;
  readonly salinityPSU: number;
  readonly pressurePa: number;
  readonly approximationKind: 'ideal_dilute';
  readonly concentrations: {
    readonly co2StarMolPerKgSw: number;
    readonly hco3MolPerKgSw: number;
    readonly co3MolPerKgSw: number;
    readonly hydrogenMolPerKgSw: number;
    readonly ohMolPerKgSw: number | null;
  };
  readonly provenance: DataProvenance;
}

/**
 * Масса столба морской воды, ЯВНО заданная вызывающей стороной.
 * Вычисление из произвольной глубины океана запрещено.
 */
export interface SeawaterColumnMass {
  readonly valueKgPerM2: number;
  readonly unit: typeof SEAWATER_COLUMN_MASS_UNIT;
  readonly provenance: DataProvenance;
}

/**
 * Компенсация изменения модельного заряда фоном сильных ионов
 * (Na+, Cl-, SO4^2-, ...), mol/kg-SW. Положительное значение — фон
 * добавляет положительный заряд. Без этой явной величины
 * электронейтральность изменения не доказывается (fail-closed).
 */
export interface StrongIonChargeCompensation {
  readonly deltaStrongIonChargeMolPerKgSw: number;
  readonly provenance: DataProvenance;
}

/** Вход атомарного применения карбонатной специации. */
export interface CarbonateSpeciationExecutionInput {
  /** Единый идентификатор транзакции (анти-replay через журнал ядра). */
  readonly transactionId: string;
  /** Идентификатор океанического резервуара. */
  readonly oceanReservoirId: string;
  /** Baseline-распределение (согласовано с текущим инвентарём). */
  readonly baseline: CarbonateSpeciationDistribution;
  /** Target-распределение (допустимый результат Stage 4.9c). */
  readonly target: CarbonateSpeciationDistribution;
  /** Явная масса водного столба. */
  readonly seawaterColumnMassKgPerM2: SeawaterColumnMass;
  /**
   * Компенсация заряда фоном сильных ионов; обязательна при любом
   * ненулевом изменении модельного заряда, иначе отказ (fail-closed).
   */
  readonly strongIonChargeCompensationMolPerKgSw?: StrongIonChargeCompensation;
  /**
   * Допуск сохранения DIC, mol/kg-SW (по умолчанию
   * CARBONATE_SPECIATION_DIC_TOLERANCE_MOL_PER_KG_SW).
   */
  readonly dicToleranceMolPerKgSw?: number;
}

// ===================== 3. РЕЗУЛЬТАТЫ =====================

export type CarbonateSpeciationDeltaSpecies =
  | 'co2_aq'
  | 'hco3_aq'
  | 'co3_aq'
  | 'hplus_aq'
  | 'oh_aq';

export interface CarbonateSpeciationDelta {
  readonly speciesId: CarbonateSpeciationDeltaSpecies;
  /** Дельта в единицах Stage 4.9c, mol/kg-SW. */
  readonly deltaMolPerKgSw: number;
  /** Дельта после пересчёта единиц, mol/m². */
  readonly deltaMolM2: number;
}

export type CarbonateSpeciationBlockKind =
  | 'not_executable'
  | 'not_verifiable'
  | 'out_of_applicability'
  | 'duplicate_transaction'
  | 'stale_snapshot'
  | 'baseline_inconsistent';

export interface CarbonateSpeciationElementResidual {
  readonly element: string;
  readonly residualMolM2: number;
  /** C — обязана сходиться в допуске (жёсткая проверка). */
  readonly conservationCritical: boolean;
  /** Чем закрыта или почему не нулевая (атрибуция, без обмана). */
  readonly attribution: string;
}

export interface CarbonateSpeciationChargeAudit {
  /** Суммарный модельный заряд перемещённых количеств, mol/m². */
  readonly modeledChargeResidualMolM2: number;
  /** Заявленная компенсация фона, пересчитанная в mol/m². */
  readonly strongIonCompensationMolM2: number;
  readonly totalResidualMolM2: number;
  readonly verdict: 'balanced' | 'imbalanced' | 'not_verifiable';
  readonly toleranceMolM2: number;
  readonly note: string;
}

export interface CarbonateSpeciationTransactionSnapshot {
  readonly oceanReservoirId: string;
  readonly reservoirCount: number;
  readonly oceanBasis: string | null;
  readonly oceanEntries: Readonly<Record<string, number>>;
  readonly fluxLedgerSize: number;
  readonly reactionLedgerSize: number | null;
  readonly appliedTransactionIds: readonly string[];
}

export type CarbonateSpeciationPlanResult =
  | {
      readonly status: 'ready';
      readonly transactionId: string;
      readonly processId: string;
      readonly oceanReservoirId: string;
      readonly deltas: readonly CarbonateSpeciationDelta[];
      readonly dicBeforeMolPerKgSw: number;
      readonly dicAfterMolPerKgSw: number;
      readonly dicConservationResidualMolPerKgSw: number;
      readonly dicBeforeMolM2: number;
      readonly dicAfterMolM2: number;
      readonly dicConservationResidualMolM2: number;
      readonly finalInventory: Readonly<Record<string, number>>;
      readonly elementResiduals: readonly CarbonateSpeciationElementResidual[];
      readonly chargeAudit: CarbonateSpeciationChargeAudit;
      readonly applicabilityConstraints: readonly string[];
      readonly provenanceSummary: readonly string[];
      readonly diagnostics: readonly string[];
      readonly warnings: readonly string[];
      readonly transactionSnapshot: CarbonateSpeciationTransactionSnapshot;
    }
  | {
      readonly status: 'blocked';
      readonly reasonKind: CarbonateSpeciationBlockKind;
      readonly processId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
    };

export type CarbonateSpeciationExecutionResult =
  | {
      readonly status: 'applied';
      readonly transactionId: string;
      readonly processId: string;
      /** НОВОЕ состояние ядра; входное состояние не мутируется. */
      readonly core: CoreWorldState;
      readonly changedReservoirs: readonly string[];
      readonly oceanReservoirAfter: ReservoirRecord;
      readonly deltas: readonly CarbonateSpeciationDelta[];
      readonly dicBeforeMolPerKgSw: number;
      readonly dicAfterMolPerKgSw: number;
      readonly dicConservationResidualMolPerKgSw: number;
      readonly dicBeforeMolM2: number;
      readonly dicAfterMolM2: number;
      readonly dicConservationResidualMolM2: number;
      readonly elementResiduals: readonly CarbonateSpeciationElementResidual[];
      readonly chargeAudit: CarbonateSpeciationChargeAudit;
      readonly applicabilityConstraints: readonly string[];
      readonly provenanceSummary: readonly string[];
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: CarbonateSpeciationBlockKind;
      readonly processId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
      readonly error: string | null;
    };

// ===================== 4. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====================

function provenanceIdentified(p: unknown): boolean {
  if (!isPlainRecord(p)) return false;
  const keys: readonly string[] = ['sourceName', 'sourceId', 'datasetId', 'reference'];
  for (const key of keys) {
    const v = (p as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim() !== '') return true;
  }
  return false;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

/**
 * Снять снимок состояния для защиты от устаревшего плана: инвентарь
 * затронутого резервуара, размеры журналов и применённые транзакции.
 */
export function captureSpeciationTransactionSnapshot(
  core: CoreWorldState,
  oceanReservoirId: string
): CarbonateSpeciationTransactionSnapshot {
  const ocean = core.reservoirs.find((r) => r.id === oceanReservoirId) ?? null;
  return {
    oceanReservoirId,
    reservoirCount: core.reservoirs.length,
    oceanBasis: ocean !== null && ocean.material !== undefined ? ocean.material.basis : null,
    oceanEntries: ocean !== null && ocean.material !== undefined ? { ...ocean.material.entries } : {},
    fluxLedgerSize: core.fluxLedger.records.length,
    reactionLedgerSize: core.reactionLedger !== undefined ? core.reactionLedger.records.length : null,
    appliedTransactionIds: core.geochemicalTransactionLog !== undefined
      ? [...core.geochemicalTransactionLog.appliedTransactionIds]
      : []
  };
}

function snapshotIsStale(snapshot: CarbonateSpeciationTransactionSnapshot, core: CoreWorldState): boolean {
  return JSON.stringify(snapshot) !== JSON.stringify(captureSpeciationTransactionSnapshot(core, snapshot.oceanReservoirId));
}

/** Форма дистрибуции: конечные положительные концентрации, provenance. */
function distributionIssues(label: string, dist: unknown, issues: string[]): boolean {
  if (!isPlainRecord(dist)) {
    issues.push(label + ': распределение должно быть объект-записью (результат Stage 4.9c)');
    return false;
  }
  const d = dist as Record<string, unknown>;
  let ok = true;
  for (const key of ['phScale', 'activityModel', 'approximationKind'] as const) {
    if (typeof d[key] !== 'string') {
      issues.push(label + ': поле ' + key + ' должно быть строкой, получено ' + text(d[key]));
      ok = false;
    }
  }
  for (const key of ['temperatureK', 'salinityPSU', 'pressurePa'] as const) {
    const v = d[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push(label + ': поле ' + key + ' должно быть конечным числом, получено ' + text(v));
      ok = false;
    }
  }
  const c = d.concentrations;
  if (!isPlainRecord(c)) {
    issues.push(label + ': concentrations должен быть объект-записью');
    return false;
  }
  const conc = c as Record<string, unknown>;
  for (const key of ['co2StarMolPerKgSw', 'hco3MolPerKgSw', 'co3MolPerKgSw', 'hydrogenMolPerKgSw'] as const) {
    const v = conc[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      issues.push(label + ': concentrations.' + key + ' должно быть конечным положительным числом, получено ' + text(v));
      ok = false;
    }
  }
  const oh = conc.ohMolPerKgSw;
  if (oh !== null && (typeof oh !== 'number' || !Number.isFinite(oh) || oh <= 0)) {
    issues.push(label + ': concentrations.ohMolPerKgSw должен быть null или конечным положительным числом, получено ' + text(oh));
    ok = false;
  }
  if (!provenanceIdentified(d.provenance)) {
    issues.push(label + ': provenance распределения обязан идентифицировать источник результата Stage 4.9c');
    ok = false;
  }
  return ok;
}

/** Атрибуция элементных невязок (без объявления их нулями). */
function elementAttribution(element: string): string {
  if (element === 'C') {
    return 'консервация углерода (DIC) проверена количественно и обязана сходиться в допуске';
  }
  return 'изменение элемента ' + element + ' закрыто растворителем h2o_aq (закреплённый растворитель Stage 4.9c, инвентарь не меняется) и заявленным фоном сильных ионов; прямая консервация перемещённых количеств НЕ утверждается';
}

// ===================== 5. ПЛАНИРОВАНИЕ (без эффектов) =====================

/**
 * Построить план атомарного применения: совместимость распределений,
 * масса столба, пересчёт единиц, согласование baseline с инвентарём,
 * восстановление H+/OH-, элементный и зарядовый аудит, финальные
 * инвентари. План НЕ изменяет состояние; при любой проблеме — blocked
 * с конкретным reasonKind (fail-closed).
 */
export function planCarbonateSpeciationExecution(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: CarbonateSpeciationExecutionInput
): CarbonateSpeciationPlanResult {
  const blocked = (
    reasonKind: CarbonateSpeciationBlockKind,
    processId: string | null,
    reason: string,
    issues: readonly string[]
  ): CarbonateSpeciationPlanResult => ({ status: 'blocked', reasonKind, processId, reason, issues });

  if (!isPlainRecord(input)) {
    return blocked('not_executable', null, 'вход должен быть объект-записью', []);
  }
  const formIssues: string[] = [];
  if (typeof input.transactionId !== 'string' || input.transactionId.trim() === '') {
    formIssues.push('transactionId должен быть непустой строкой');
  }
  if (typeof input.oceanReservoirId !== 'string' || input.oceanReservoirId.trim() === '') {
    formIssues.push('oceanReservoirId должен быть непустой строкой');
  }
  if (input.dicToleranceMolPerKgSw !== undefined &&
      (typeof input.dicToleranceMolPerKgSw !== 'number' || !Number.isFinite(input.dicToleranceMolPerKgSw) || input.dicToleranceMolPerKgSw < 0)) {
    formIssues.push('dicToleranceMolPerKgSw, если задан, должен быть конечным неотрицательным числом');
  }
  distributionIssues('baseline', input.baseline, formIssues);
  distributionIssues('target', input.target, formIssues);
  if (formIssues.length > 0) {
    return blocked('not_executable', null, 'вход применения специации не проходит структурную валидацию', formIssues);
  }
  // Дальше вход гарантированно имеет форму контрактов.
  const b = input.baseline as CarbonateSpeciationDistribution;
  const t = input.target as CarbonateSpeciationDistribution;
  const transactionId: string = input.transactionId;
  const oceanReservoirId: string = input.oceanReservoirId;

  // --- анти-replay: тот же transactionId уже применён ---
  const appliedIds = core.geochemicalTransactionLog !== undefined
    ? core.geochemicalTransactionLog.appliedTransactionIds
    : [];
  if (appliedIds.includes(transactionId)) {
    return blocked('duplicate_transaction', CARBONATE_SPECIATION_PROCESS_ID,
      'transactionId уже был применён: повторное применение одной транзакции запрещено (анти-replay)',
      ['transactionId ' + transactionId + ' уже присутствует в журнале применённых транзакций']);
  }

  // --- масса водного столба: fail-closed ---
  const cm = input.seawaterColumnMassKgPerM2;
  const columnIssues: string[] = [];
  if (!isPlainRecord(cm)) {
    columnIssues.push('seawaterColumnMassKgPerM2 должен быть объект-записью (value, unit, provenance)');
  } else {
    const mass = cm as unknown as SeawaterColumnMass;
    if (typeof mass.valueKgPerM2 !== 'number' || !Number.isFinite(mass.valueKgPerM2) || mass.valueKgPerM2 <= 0) {
      columnIssues.push('масса водного столба должна быть конечным ПОЛОЖИТЕЛЬНЫМ числом, получено ' + text(mass.valueKgPerM2));
    }
    if (mass.unit !== SEAWATER_COLUMN_MASS_UNIT) {
      columnIssues.push('единица массы водного столба должна быть ' + SEAWATER_COLUMN_MASS_UNIT + ', получено ' + text(mass.unit) + ': прочие единицы молча не конвертируются');
    }
    if (!provenanceIdentified(mass.provenance)) {
      columnIssues.push('provenance массы водного столба обязан идентифицировать источник (sourceName/sourceId/datasetId/reference)');
    }
  }
  if (columnIssues.length > 0) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'масса водного столба не прошла проверку (fail-closed): пересчёт mol/kg-SW → mol/m² невозможен, инвентари не изменяются',
      columnIssues);
  }
  const columnMass = (cm as unknown as SeawaterColumnMass).valueKgPerM2;

  // --- совместимость baseline и target ---
  const compat: string[] = [];
  if (b.phScale !== t.phScale) {
    compat.push('pH scale несовместим: baseline ' + b.phScale + ', target ' + t.phScale + ' (шкалы не смешиваются)');
  }
  if (b.activityModel !== t.activityModel) {
    compat.push('модель активности несовместима: baseline ' + b.activityModel + ', target ' + t.activityModel);
  }
  if (b.approximationKind !== t.approximationKind) {
    compat.push('вид приближения несовместим: baseline ' + b.approximationKind + ', target ' + t.approximationKind);
  }
  if (b.temperatureK !== t.temperatureK) {
    compat.push('температура различается: baseline ' + String(b.temperatureK) + ' K, target ' + String(t.temperatureK) + ' K (сдвиг между разными условиями не является заданным перераспределением)');
  }
  if (b.salinityPSU !== t.salinityPSU) {
    compat.push('солёность различается: baseline ' + String(b.salinityPSU) + ' PSU, target ' + String(t.salinityPSU) + ' PSU');
  }
  if (b.pressurePa !== t.pressurePa) {
    compat.push('давление различается: baseline ' + String(b.pressurePa) + ' Pa, target ' + String(t.pressurePa) + ' Pa');
  }
  if (compat.length > 0) {
    return blocked('out_of_applicability', CARBONATE_SPECIATION_PROCESS_ID,
      'baseline и target получены в несовместимых условиях: перераспределение определяется ТОЛЬКО как сдвиг при совместимых T/S/P, pH-шкале и модели активности (fail-closed)',
      compat);
  }

  // --- план переноса Stage 4.9c и сохранение DIC ---
  const dicTolerance = input.dicToleranceMolPerKgSw !== undefined
    ? input.dicToleranceMolPerKgSw
    : CARBONATE_SPECIATION_DIC_TOLERANCE_MOL_PER_KG_SW;
  const transferPlan = planCarbonateSpeciationTransfer(b.concentrations, t.concentrations);
  if (transferPlan.status !== 'planned_not_applied') {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'план переноса Stage 4.9c не построен: ' + text(transferPlan.reason), [...transferPlan.notes]);
  }
  const kgIssues: string[] = [];
  const transferDeltas = transferPlan.deltas;
  for (const delta of transferDeltas) {
    if (!Number.isFinite(delta.deltaMolPerKgSw)) {
      kgIssues.push(delta.speciesId + ': дельта mol/kg-SW не представима (' + String(delta.deltaMolPerKgSw) + ')');
    }
  }
  if (kgIssues.length > 0) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'распределения Stage 4.9c содержат непредставимые концентрации: план переноса отклонён',
      [...transferPlan.notes, ...kgIssues]);
  }
  if (!Number.isFinite(transferPlan.carbonConservationResidualMolPerKgSw) ||
      transferPlan.carbonConservationResidualMolPerKgSw > dicTolerance) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'сохранение DIC не подтверждено: невязка ' + String(transferPlan.carbonConservationResidualMolPerKgSw) + ' mol/kg-SW превышает допуск ' + String(dicTolerance),
      ['target обязан получаться из допустимого результата Stage 4.9c при ТОМ ЖЕ DIC, а не сочиняться исполнителем']);
  }

  // --- восстановление H+ и OH- (fail-closed при односторонней доступности) ---
  const ohB = b.concentrations.ohMolPerKgSw;
  const ohT = t.concentrations.ohMolPerKgSw;
  if ((ohB === null) !== (ohT === null)) {
    return blocked('not_verifiable', CARBONATE_SPECIATION_PROCESS_ID,
      'OH- доступна только с одной стороны сдвига: изменение протонного переноса нельзя достоверно восстановить и зарядовый баланс нельзя доказать (fail-closed)',
      ['baseline.ohMolPerKgSw = ' + String(ohB) + ', target.ohMolPerKgSw = ' + String(ohT)]);
  }
  const dOH = ohB !== null && ohT !== null ? ohT - ohB : 0;
  const dH = t.concentrations.hydrogenMolPerKgSw - b.concentrations.hydrogenMolPerKgSw;

  // --- полный набор дельт и пересчёт единиц ---
  const kgDeltas: readonly { speciesId: CarbonateSpeciationDeltaSpecies; deltaMolPerKgSw: number }[] = [
    { speciesId: 'co2_aq', deltaMolPerKgSw: transferDeltas[0]!.deltaMolPerKgSw },
    { speciesId: 'hco3_aq', deltaMolPerKgSw: transferDeltas[1]!.deltaMolPerKgSw },
    { speciesId: 'co3_aq', deltaMolPerKgSw: transferDeltas[2]!.deltaMolPerKgSw },
    { speciesId: 'hplus_aq', deltaMolPerKgSw: dH },
    { speciesId: 'oh_aq', deltaMolPerKgSw: dOH }
  ];
  const deltas: CarbonateSpeciationDelta[] = [];
  const co2StarDelta = t.concentrations.co2StarMolPerKgSw - b.concentrations.co2StarMolPerKgSw;
  if (Math.abs(kgDeltas[0]!.deltaMolPerKgSw - co2StarDelta) > 0) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'внутреннее сопоставление co2_aq и co2Star разошлось: газовая форма co2 не смешивается с co2_aq', []);
  }
  const unitIssues: string[] = [];
  for (const d of kgDeltas) {
    if (d.deltaMolPerKgSw === 0) continue;
    const molM2 = d.deltaMolPerKgSw * columnMass;
    if (!Number.isFinite(molM2)) {
      unitIssues.push(d.speciesId + ': результат пересчёта в mol/m² непредставим (' + String(d.deltaMolPerKgSw) + ' умножить на ' + String(columnMass) + ')');
      continue;
    }
    deltas.push({ speciesId: d.speciesId, deltaMolPerKgSw: d.deltaMolPerKgSw, deltaMolM2: molM2 });
  }
  if (unitIssues.length > 0) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'пересчёт mol/kg-SW → mol/m² даёт непредставимые значения: единственная конверсия deltaMolPerKgSw умножить на seawaterColumnMassKgPerM2 отказывает (fail-closed)',
      unitIssues);
  }
  if (deltas.length === 0) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'дельта пуста: применение не требуется и не регистрируется (нулевой транзакции нет)', []);
  }

  // --- проверка резервуара и согласование baseline с инвентарём ---
  const ocean = core.reservoirs.find((r) => r.id === oceanReservoirId) ?? null;
  if (ocean === null) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'резервуар ' + oceanReservoirId + ' отсутствует в состоянии ядра: инвентарь не создаётся молча', []);
  }
  if (ocean.material === undefined) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'резервуар ' + oceanReservoirId + ' не содержит материального инвентаря: задайте его явно (setMaterialInventory)', []);
  }
  if (ocean.material.basis !== GEOCHEMICAL_INVENTORY_BASIS) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'резервуар ' + oceanReservoirId + ' хранит инвентарь в основании ' + ocean.material.basis + ', а применение требует ' + GEOCHEMICAL_INVENTORY_BASIS + ': основания не смешиваются, автоматический пересчёт запрещён', []);
  }
  const entries = ocean.material.entries;
  const baselineIssues: string[] = [];
  const baselineChecks: readonly (readonly [CarbonateSpeciationDeltaSpecies, number])[] = [
    ['co2_aq', b.concentrations.co2StarMolPerKgSw],
    ['hco3_aq', b.concentrations.hco3MolPerKgSw],
    ['co3_aq', b.concentrations.co3MolPerKgSw]
  ];
  for (const pair of baselineChecks) {
    const speciesId = pair[0];
    const concentration = pair[1];
    const current = entries[speciesId];
    if (current === undefined) {
      baselineIssues.push(speciesId + ': записи нет в инвентаре, а baseline задаёт известную концентрацию (unknown не равно нулю)');
      continue;
    }
    const expected = concentration * columnMass;
    if (Math.abs(current - expected) > CARBONATE_BASELINE_TOLERANCE_MOL_M2) {
      baselineIssues.push(speciesId + ': инвентарь ' + String(current) + ' не совпадает с baseline умножить на массу столба ' + String(expected) + ' (допуск ' + String(CARBONATE_BASELINE_TOLERANCE_MOL_M2) + ' mol/m²): baseline не согласован с фактическим инвентарём');
    }
  }
  for (const d of deltas) {
    if (d.speciesId !== 'hplus_aq' && d.speciesId !== 'oh_aq') continue;
    const conc = d.speciesId === 'hplus_aq' ? b.concentrations.hydrogenMolPerKgSw : b.concentrations.ohMolPerKgSw;
    if (conc === null) continue;
    const current = entries[d.speciesId];
    if (current === undefined) {
      baselineIssues.push(d.speciesId + ': записи нет в инвентаре, а baseline задаёт известную концентрацию (unknown не равно нулю)');
      continue;
    }
    const expected = conc * columnMass;
    if (Math.abs(current - expected) > CARBONATE_BASELINE_TOLERANCE_MOL_M2) {
      baselineIssues.push(d.speciesId + ': инвентарь ' + String(current) + ' не совпадает с baseline умножить на массу столба ' + String(expected));
    }
  }
  if (baselineIssues.length > 0) {
    return blocked('baseline_inconsistent', CARBONATE_SPECIATION_PROCESS_ID,
      'baseline не соответствует текущему инвентарю океана после применения той же массы водного столба: применение не начато', baselineIssues);
  }

  // --- финальные инвентари (до применения: отрицательный запас невозможен) ---
  const finalIssues: string[] = [];
  const finalInventory: Record<string, number> = { ...entries };
  for (const d of deltas) {
    const current = entries[d.speciesId];
    const after = (current === undefined ? 0 : current) + d.deltaMolM2;
    if (!Number.isFinite(after)) {
      finalIssues.push(d.speciesId + ': итоговый запас непредставим (переполнение)');
      continue;
    }
    if (after < 0) {
      finalIssues.push(d.speciesId + ': итоговый запас отрицательный (' + String(after) + '): вещества недостаточно, отрицательный запас невозможен');
      continue;
    }
    if (after === 0) delete finalInventory[d.speciesId];
    else finalInventory[d.speciesId] = after;
  }
  // Инвентарь растворителя h2o_aq сознательно не трогается.
  if (finalIssues.length > 0) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'финальные инвентари некорректны: применение не начато (атомарность «всё или ничего»)', finalIssues);
  }

  // --- элементный и зарядовый аудит перемещённых количеств ---
  const counts: Record<string, number> = {};
  for (const d of deltas) counts[d.speciesId] = d.deltaMolM2;
  const elements = elementTotals(speciesCatalog, counts);
  const charge = chargeTotal(speciesCatalog, counts);
  if (elements.excludedSpecies.length > 0 || charge.excludedSpecies.length > 0) {
    const excluded = [...new Set([...elements.excludedSpecies, ...charge.excludedSpecies])];
    return blocked('not_verifiable', CARBONATE_SPECIATION_PROCESS_ID,
      'состав или заряд перемещённых видов неизвестен: элементный и зарядовый аудит невозможен и НЕ заменяется нулями (fail-closed)',
      ['виды без известного состава: ' + excluded.join(', ')]);
  }
  const dicToleranceM2 = dicTolerance * columnMass;
  const cResidual = elements.totals['C'] ?? 0;
  if (Math.abs(cResidual) > dicToleranceM2) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'элементная C-невязка ' + String(cResidual) + ' mol/m² превышает допуск ' + String(dicToleranceM2) + ': сохранение DIC нарушено, применение невозможно',
      ['сумма дельт углеродных видов обязана быть нулевой (масса столба одна и та же)']);
  }
  const elementResiduals: CarbonateSpeciationElementResidual[] = Object.keys(elements.totals).sort().map((element) => ({
    element,
    residualMolM2: elements.totals[element] ?? 0,
    conservationCritical: element === 'C',
    attribution: elementAttribution(element)
  }));
  const compensation = input.strongIonChargeCompensationMolPerKgSw;
  if (compensation === undefined) {
    return blocked('not_verifiable', CARBONATE_SPECIATION_PROCESS_ID,
      'компенсация фона сильных ионов не задана: изменение модельного заряда (' + String(charge.charge) + ' mol/m²) не может быть закрыто и электронейтральность НЕ объявляется выполняющейся (fail-closed)',
      ['задайте strongIonChargeCompensationMolPerKgSw с provenance или используйте распределения без изменения модельного заряда']);
  }
  if (!provenanceIdentified(compensation.provenance)) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'provenance компенсации фона сильных ионов обязан идентифицировать источник', []);
  }
  if (typeof compensation.deltaStrongIonChargeMolPerKgSw !== 'number' || !Number.isFinite(compensation.deltaStrongIonChargeMolPerKgSw)) {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'компенсация фона должна быть конечным числом, получено ' + String(compensation.deltaStrongIonChargeMolPerKgSw), []);
  }
  const compensationM2 = compensation.deltaStrongIonChargeMolPerKgSw * columnMass;
  const chargeToleranceM2 = CARBONATE_SPECIATION_CHARGE_TOLERANCE_MOL_PER_KG_SW * columnMass;
  const chargeTotalResidual = charge.charge + compensationM2;
  const chargeVerdict: 'balanced' | 'imbalanced' = Math.abs(chargeTotalResidual) <= chargeToleranceM2 ? 'balanced' : 'imbalanced';
  const chargeAudit: CarbonateSpeciationChargeAudit = {
    modeledChargeResidualMolM2: charge.charge,
    strongIonCompensationMolM2: compensationM2,
    totalResidualMolM2: chargeTotalResidual,
    verdict: chargeVerdict,
    toleranceMolM2: chargeToleranceM2,
    note: 'электронейтральность изменения доказывается ТОЛЬКО парой «модельный заряд + явная компенсация фона сильных ионов с provenance»; сохранение DIC само по себе электронейтральность не доказывает'
  };
  if (chargeVerdict !== 'balanced') {
    return blocked('not_executable', CARBONATE_SPECIATION_PROCESS_ID,
      'зарядовая невязка изменения ' + String(chargeTotalResidual) + ' mol/m² превышает допуск ' + String(chargeToleranceM2) + ': транзакция не применяется',
      ['модельный заряд ' + String(charge.charge) + ', компенсация фона ' + String(compensationM2)]);
  }

  // --- подписи применимости и происхождения ---
  const applicabilityConstraints: string[] = [
    'масса водного столба задана ЯВНО (seawaterColumnMassKgPerM2, единица ' + SEAWATER_COLUMN_MASS_UNIT + ') с provenance; из произвольной глубины океана масса не вычисляется',
    'mol/kg-SW → mol/m² только как deltaMolPerKgSw умножить на seawaterColumnMassKgPerM2; прочие конверсии единиц запрещены',
    'h2o_aq — закреплённый растворитель Stage 4.9c: его инвентарь не изменяется; растворитель — не переносимый запас',
    'затрагивается только co2_aq (водная форма); газовая запись co2 не смешивается с co2_aq',
    'это НЕ кинетика: равновесный сдвиг задаёт вызывающая сторона через результаты Stage 4.9c; скорости не вычисляются',
    'исполним только внутренний процесс ' + CARBONATE_SPECIATION_PROCESS_ID + '; кинетические coupled-процессы каталога остаются not_implemented и Stage 4.9 не закрывают'
  ];
  const provenanceSummary: string[] = [
    'baseline: ' + JSON.stringify(b.provenance),
    'target: ' + JSON.stringify(t.provenance),
    'масса водного столба (' + String(columnMass) + ' ' + SEAWATER_COLUMN_MASS_UNIT + '): ' + JSON.stringify(cm.provenance),
    'компенсация фона сильных ионов (' + String(compensation.deltaStrongIonChargeMolPerKgSw) + ' mol/kg-SW): ' + JSON.stringify(compensation.provenance),
    'план переноса Stage 4.9c: ' + text(transferPlan.reason)
  ];
  const warnings: string[] = [
    'невязки H/O не являются нулями: изменение протонного состава закрыто растворителем и фоном сильных ионов (см. атрибуцию элементных невязок)',
    'приближение ideal_dilute (Stage 4.9c): активности отождествлены концентрациям',
    'в перемещённых количествах не моделируются борат/фосфат/силикатные компоненты полной щёлочности, выходящие за рамки Stage 4.9c'
  ];

  const dicBefore = b.concentrations.co2StarMolPerKgSw + b.concentrations.hco3MolPerKgSw + b.concentrations.co3MolPerKgSw;
  const dicAfter = t.concentrations.co2StarMolPerKgSw + t.concentrations.hco3MolPerKgSw + t.concentrations.co3MolPerKgSw;

  return {
    status: 'ready',
    transactionId,
    processId: CARBONATE_SPECIATION_PROCESS_ID,
    oceanReservoirId,
    deltas,
    dicBeforeMolPerKgSw: dicBefore,
    dicAfterMolPerKgSw: dicAfter,
    dicConservationResidualMolPerKgSw: transferPlan.carbonConservationResidualMolPerKgSw,
    dicBeforeMolM2: dicBefore * columnMass,
    dicAfterMolM2: dicAfter * columnMass,
    dicConservationResidualMolM2: Math.abs(cResidual),
    finalInventory,
    elementResiduals,
    chargeAudit,
    applicabilityConstraints,
    provenanceSummary,
    diagnostics: [
      'план построен на одном снимке ядра; конечные инвентари вычислены до применения',
      'дельт: ' + String(deltas.length) + ' (углеродные co2_aq/hco3_aq/co3_aq и, при ненулевом сдвиге, протонные hplus_aq/oh_aq)',
      'зарядовый вердикт: ' + chargeVerdict + ' (суммарная невязка ' + String(chargeTotalResidual) + ' mol/m²)'
    ],
    warnings,
    transactionSnapshot: captureSpeciationTransactionSnapshot(core, oceanReservoirId)
  };
}

// ===================== 6. ИСПОЛНЕНИЕ К ЯДРУ МИРА =====================

/**
 * Иммутабельно исполнить готовый план к CoreWorldState: свежесть
 * снимка → анти-replay → применение дельт setMaterialInventory
 * (растворитель не трогается) → validateReservoirRecord → журнал
 * транзакций → validateWorldState. Любая проблема = not_applied,
 * входное состояние побитово неизменно.
 */
export function executeCarbonateSpeciationExecutionOnWorld(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: CarbonateSpeciationExecutionInput,
  plan: CarbonateSpeciationPlanResult
): CarbonateSpeciationExecutionResult {
  void speciesCatalog;
  const notApplied = (
    reasonKind: CarbonateSpeciationBlockKind,
    reason: string,
    issues: readonly string[],
    error: string | null = null
  ): CarbonateSpeciationExecutionResult =>
    ({ status: 'not_applied', reasonKind, processId: CARBONATE_SPECIATION_PROCESS_ID, reason, issues, error });

  if (plan.status !== 'ready') {
    return notApplied(plan.reasonKind, 'план заблокирован, применение не начато: ' + plan.reason, plan.issues);
  }
  if (plan.transactionId !== input.transactionId) {
    return notApplied('not_executable', 'план построен для другого transactionId: подмена транзакции невозможна', []);
  }
  if (plan.oceanReservoirId !== input.oceanReservoirId) {
    return notApplied('not_executable', 'план построен для другого резервуара: применение не начато', []);
  }
  if (snapshotIsStale(plan.transactionSnapshot, core)) {
    return notApplied('stale_snapshot',
      'снимок состояния устарел (инвентарь, журналы или применённые транзакции изменились): транзакция не применяется, постройте план заново', []);
  }
  const appliedIds = core.geochemicalTransactionLog !== undefined
    ? core.geochemicalTransactionLog.appliedTransactionIds
    : [];
  if (appliedIds.includes(input.transactionId)) {
    return notApplied('duplicate_transaction',
      'transactionId уже был применён (проверено при исполнении): повторное применение одной транзакции запрещено', []);
  }

  try {
    const ocean = core.reservoirs.find((r) => r.id === input.oceanReservoirId) ?? null;
    if (ocean === null || ocean.material === undefined) {
      return notApplied('not_executable', 'резервуар ' + input.oceanReservoirId + ' отсутствует или не содержит материального инвентаря', []);
    }
    const nextEntries: Record<string, number> = { ...ocean.material.entries };
    for (const d of plan.deltas) {
      const current = nextEntries[d.speciesId];
      const after = (current === undefined ? 0 : current) + d.deltaMolM2;
      if (!Number.isFinite(after) || after < 0) {
        return notApplied('not_executable', 'финальный инвентарь ' + d.speciesId + ' некорректен (' + String(after) + '): применение не начато', []);
      }
      if (after === 0) delete nextEntries[d.speciesId];
      else nextEntries[d.speciesId] = after;
    }
    // Растворитель h2o_aq и все прочие записи переносятся без изменений.
    const updatedOcean = setMaterialInventory(ocean, ocean.material.basis as InventoryBasis, nextEntries);
    const recordCheck = validateReservoirRecord(updatedOcean);
    if (!recordCheck.valid) {
      return notApplied('not_executable', 'затронутый резервуар не прошёл validateReservoirRecord: применение откачено, вход не изменялся', recordCheck.errors);
    }
    const updatedReservoirs: ReservoirRecord[] = core.reservoirs.map((r) => (r.id === input.oceanReservoirId ? updatedOcean : r));
    const coreWithReservoir: CoreWorldState = {
      ...core,
      schemaVersion: CORE_WORLD_STATE_SCHEMA_VERSION,
      reservoirs: updatedReservoirs
    };
    const coreWithLog = withTransactionLogApplied(coreWithReservoir, plan.transactionId);
    const worldIssues = validateWorldState(coreWithLog);
    if (worldIssues.length > 0) {
      return notApplied('not_executable',
        'результирующее состояние ядра не прошло validateWorldState: применение откачено, входное состояние не изменялось',
        worldIssues.map((i) => i.code + ' (' + i.component + '): ' + i.message));
    }
    return {
      status: 'applied',
      transactionId: plan.transactionId,
      processId: plan.processId,
      core: coreWithLog,
      changedReservoirs: [input.oceanReservoirId],
      oceanReservoirAfter: updatedOcean,
      deltas: plan.deltas,
      dicBeforeMolPerKgSw: plan.dicBeforeMolPerKgSw,
      dicAfterMolPerKgSw: plan.dicAfterMolPerKgSw,
      dicConservationResidualMolPerKgSw: plan.dicConservationResidualMolPerKgSw,
      dicBeforeMolM2: plan.dicBeforeMolM2,
      dicAfterMolM2: plan.dicAfterMolM2,
      dicConservationResidualMolM2: plan.dicConservationResidualMolM2,
      elementResiduals: plan.elementResiduals,
      chargeAudit: plan.chargeAudit,
      applicabilityConstraints: plan.applicabilityConstraints,
      provenanceSummary: plan.provenanceSummary,
      warnings: plan.warnings
    };
  } catch (error) {
    return notApplied('not_executable',
      'исполнение прервано структурированной ошибкой ядра: входное состояние не изменено', [],
      error instanceof Error ? error.message : String(error));
  }
}

/**
 * Согласованный вызов: план → исполнение (тот же контракт; при blocked
 * исполнитель возвращает honest not_applied).
 */
export function executeCarbonateSpeciationExecution(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: CarbonateSpeciationExecutionInput
): CarbonateSpeciationExecutionResult {
  const plan = planCarbonateSpeciationExecution(core, speciesCatalog, input);
  return executeCarbonateSpeciationExecutionOnWorld(core, speciesCatalog, input, plan);
}
