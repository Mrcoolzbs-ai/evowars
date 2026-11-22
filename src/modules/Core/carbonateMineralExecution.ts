// ============================================
// CARBONATE MINERAL EXECUTION — атомарное растворение/осаждение
// кальцита (caco3) и арагонита (aragonite) — Stage 4.9f
// ============================================
//
// Тонкий ТРАНЗАКЦИОННЫЙ АДАПТЕР поверх атомарного исполнителя
// coupled-транзакций Stage 4.9d для минеральных реакций карбоната
// кальция на границе океан ↔ кора:
//
//   - кальцит (вид caco3), растворение  : caco3 (кора) → ca2_aq + co3_aq (океан);
//   - кальцит (вид caco3), осаждение    : ca2_aq + co3_aq (океан) → caco3 (кора);
//   - арагонит (вид aragonite), растворение: aragonite (кора) → ca2_aq + co3_aq (океан);
//   - арагонит (вид aragonite), осаждение  : ca2_aq + co3_aq (океан) → aragonite (кора).
//
// ЧТО ЭТО И ЧТО ЭТО НЕ ЭТО:
// - минерал и ионы — РАЗНЫЕ виды каталога: превращение описано ЯВНЫМ
//   определением реакции с реальными участниками по обе стороны
//   границы (запись ReactionLedger); НЕ создаются FluxLedger-подмены
//   химического превращения, НЕ используется generic transfer API
//   так, словно стехиометрия «переносится»;
// - полиморфы НЕ смешиваются: для кальцита подставляется вид caco3 и
//   K*sp кальцита (Mucci 1983), для арагонита — вид aragonite и K*sp
//   арагонита; определение реакции полиморфа содержит ТОЛЬКО его вид;
// - количество реакции (extent, mol/m²) приходит ТОЛЬКО ЯВНО, с
//   идентифицированным provenance. ОНО НЕ ВЫЧИСЛЯЕТСЯ из Ω-вердикта,
//   НЕ выводится из gameSpeedCoefficient и НЕ назначается
//   произвольно: этот этап — термодинамика и стехиометрия, НЕ
//   кинетика (скорости — Stage 4.9g);
// - замкнутый равновесный расчёт extent (сколько CaCO3 растворится/
//   осядет) требует полного набора входов (запас минерала, [Ca2+],
//   DIC, карбонатная щёлочность, масса столба, T/S/P, все с
//   provenance) и возвращает not_verifiable при их отсутствии — см.
//   evaluateCarbonateMineralEquilibriumInputs; эвристические числа
//   НЕ подставляются;
// - ВСЯ атомарность, анти-replay (geochemicalTransactionLog),
//   stale-snapshot-защита, агрегирование дельт на одном снимке,
//   элементный/зарядовый аудит, побитовая неизменность входа при
//   отказе и финальная валидация CoreWorldState ДЕЛЕГИРОВАНЫ
//   исполнителю Stage 4.9d без изменений;
// - процесс каталога в coupled-транзакцию НЕ передаётся
//   (processSpec: null): механизм каталога — 'reaction', а
//   coupled-исполнитель принимает только 'coupled' (тот же статус,
//   что у адаптера фазового обмена 4.9e); статусы каталога
//   ('reaction_required') и rate: unknown этим модулем НЕ меняются.
//
// Составной путь «минеральная реакция → обновление DIC/TA_C →
// переспециация через Stage 4.9c → инвентарь океана» реализован как
// executeCarbonateMineralCycle: две последовательные атомарные
// транзакции Stage 4.9d; при отказе ЛЮБОЙ стадии составная операция
// возвращает not_applied с ИСХОДНЫМ (побитово неизменённым) состоянием
// ядра — промежуточное состояние отбрасывается, частичное применение
// невозможно. Глобальный H/O-баланс этим НЕ закрывается (ревизия
// 4.9e остаётся в силе).

import type { ReservoirRecord } from './reservoir';
import { isPlainRecord } from './reservoir';
import type { CoreWorldState } from './worldState';
import { validateWorldState } from './worldState';
import type { SpeciesCatalog } from './species';
import type { FluxTime } from './fluxLedger';
import type { DataProvenance } from './scientificValue';
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
import type { CarbonateSpeciationDistribution } from './carbonateSpeciationExecution';
import { executeCarbonateSpeciationExecution, SEAWATER_COLUMN_MASS_UNIT } from './carbonateSpeciationExecution';
import type { CarbonateMineralPolymorph } from './carbonateMinerals';
import {
  CARBONATE_MINERAL_SPECIES_ID,
  MUCCI_1983_KSP_PROVENANCE
} from './carbonateMinerals';
import type { CarbonateModelInput, CarbonateModelResult, CarbonateModelError } from './carbonateChemistry';
import { solveCarbonateEquilibrium } from './carbonateChemistry';

// ============================================
// 1. КОНСТАНТЫ И ИДЕНТИФИКАЦИЯ ПРОЦЕССОВ
// ============================================

/**
 * Направление минеральной реакции (стехиометрия одинакова, полиморфы
 * и их K*sp различаются).
 */
export type CarbonateMineralDirection = 'dissolve' | 'precipitate';

/** Процессы каталога геохимических процессов для минеральных реакций. */
export const CALCITE_DISSOLUTION_PROCESS_ID = 'geo.dissolution.caco3.crust->ocn';
export const CALCITE_PRECIPITATION_PROCESS_ID = 'geo.precipitation.caco3.ocn->crust';
export const ARAGONITE_DISSOLUTION_PROCESS_ID = 'geo.dissolution.aragonite.crust->ocn';
export const ARAGONITE_PRECIPITATION_PROCESS_ID = 'geo.precipitation.aragonite.ocn->crust';

export const CARBONATE_MINERAL_PROCESS_ID: Readonly<
  Record<CarbonateMineralPolymorph, Readonly<Record<CarbonateMineralDirection, string>>>
> = {
  calcite: { dissolve: CALCITE_DISSOLUTION_PROCESS_ID, precipitate: CALCITE_PRECIPITATION_PROCESS_ID },
  aragonite: { dissolve: ARAGONITE_DISSOLUTION_PROCESS_ID, precipitate: ARAGONITE_PRECIPITATION_PROCESS_ID }
};

/**
 * Происхождение ОПРЕДЕЛЕНИЙ минеральных реакций: стехиометрия
 * CaCO3(s) ⇌ Ca2+ + CO3^2- — установленная химия; различение полиморфов
 * и их растворимость — Mucci (1983).
 */
export const CARBONATE_MINERAL_REACTION_DEFINITION_PROVENANCE: ReactionDataProvenance = {
  sourceName:
    'Stage 4.9f: минеральные реакции CaCO3(s) ⇌ Ca2+ + CO3^2- для кальцита и арагонита с растворимостью по Mucci (1983)',
  sourceId: 'doi:10.2475/ajs.283.7.780',
  reference:
    'Mucci, A. (1983), American Journal of Science 283(7):780-799; каталог evowars: geo.dissolution.caco3.crust->ocn / geo.precipitation.caco3.ocn->crust / geo.dissolution.aragonite.crust->ocn / geo.precipitation.aragonite.ocn->crust',
  method:
    'стехиометрия из формульной единицы CaCO3 ({Ca:1, C:1, O:3} → Ca2+ + CO3^2-, заряд 0 = +2 − 2); количество реакции — явно от вызывающей стороны с provenance',
  limitations:
    'определение НЕ утверждает кинетику растворения/осаждения, нуклеацию и скорость кристаллизации: исполнение — завершённое количество (extent), а не rate; полиморфы не взаимозаменяемы'
};

export const CARBONATE_MINERAL_TRANSACTION_SCOPE_NOTE =
  'Stage 4.9f: минеральная реакция карбоната кальция (кальцит/арагонит ⇌ Ca2+ + CO3^2-) между корой и океаном. Спецификация каталога не передаётся (processSpec: null): механизм каталога «reaction», а coupled-исполнитель Stage 4.9d принимает только механизм «coupled»; количество реакции — ЯВНО с provenance (термодинамика насыщения — Core/carbonateMinerals.ts, Mucci 1983; кинетика НЕ реализуется)';

// ============================================
// 2. ОПРЕДЕЛЕНИЕ РЕАКЦИИ
// ============================================

/**
 * Построить определение минеральной реакции. Mineral species полиморфа,
 * ионы ca2_aq/co3_aq — aqueous-виды океана; стороны границы:
 * растворение из коры в океан, осаждение из океана в кору.
 * Элементный баланс: {Ca:1, C:1, O:3} обеих сторон; заряд: 0 = +2 + (−2).
 */
export function buildCarbonateMineralReactionDefinition(args: {
  readonly mineral: CarbonateMineralPolymorph;
  readonly direction: CarbonateMineralDirection;
  readonly oceanReservoirId: string;
  readonly crustReservoirId: string;
  readonly definitionProvenance?: ReactionDataProvenance;
}): GeochemicalReactionDefinition {
  const prov = args.definitionProvenance !== undefined ? args.definitionProvenance : CARBONATE_MINERAL_REACTION_DEFINITION_PROVENANCE;
  const mineralSpecies = CARBONATE_MINERAL_SPECIES_ID[args.mineral];
  const mineralLabel = args.mineral === 'calcite' ? 'кальцит (caco3)' : 'арагонит (aragonite)';
  const limitations =
    'минеральное превращение — НЕ перенос одного вида и НЕ силикатное выветривание и НЕ взаимодействие с атмосферным CO2; extent — завершённое количество из ЯВНОГО входа; запись в ReactionLedger НЕ утверждает скорость (кинетика — следующий этап); полиморф не смешивается с другими видами CaCO3';
  const applicability = 'столбовые запасы column_amount (mol/m²); ионы — mol/kg-SW основа океана; минерал — твёрдая фаза коры';
  const basis: 'calcite' | 'aragonite' = args.mineral;
  const reactionId = args.direction === 'dissolve'
    ? `caco3.${basis}.dissolution.crust->ocn`
    : `caco3.${basis}.precipitation.ocn->crust`;
  if (args.direction === 'dissolve') {
    return {
      reactionId,
      processId: CARBONATE_MINERAL_PROCESS_ID[args.mineral].dissolve,
      description: `${mineralLabel} (кора) -> Ca2+ + CO3^2- (океан): растворение минеральной фазы (термодинамика насыщения — Stage 4.9f, Mucci 1983)`,
      reactants: [{ reservoirId: args.crustReservoirId, speciesId: mineralSpecies, coefficient: 1 }],
      products: [
        { reservoirId: args.oceanReservoirId, speciesId: 'ca2_aq', coefficient: 1 },
        { reservoirId: args.oceanReservoirId, speciesId: 'co3_aq', coefficient: 1 }
      ],
      extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
      definitionProvenance: { ...prov },
      applicability,
      limitations,
      assumptions: [
        `фазовая идентичность: минерал ${mineralSpecies} (solid) и ионы ca2_aq/co3_aq (aqueous) — разные виды каталога; полиморф ${basis} не взаимозаменяем`,
        'карбонатная щёлочность океана меняется на +2 экв за моль растворённого CaCO3 (учёт в последующей переспециации)'
      ]
    };
  }
  return {
    reactionId,
    processId: CARBONATE_MINERAL_PROCESS_ID[args.mineral].precipitate,
    description: `Ca2+ + CO3^2- (океан) -> ${mineralLabel} (кора): осаждение минеральной фазы (термодинамика насыщения — Stage 4.9f, Mucci 1983)`,
    reactants: [
      { reservoirId: args.oceanReservoirId, speciesId: 'ca2_aq', coefficient: 1 },
      { reservoirId: args.oceanReservoirId, speciesId: 'co3_aq', coefficient: 1 }
    ],
    products: [{ reservoirId: args.crustReservoirId, speciesId: mineralSpecies, coefficient: 1 }],
    extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
    definitionProvenance: { ...prov },
    applicability,
    limitations,
    assumptions: [
      `фазовая идентичность: минерал ${mineralSpecies} (solid) и ионы ca2_aq/co3_aq (aqueous) — разные виды каталога; полиморф ${basis} не взаимозаменяем`,
      'карбонатная щёлочность океана меняется на −2 экв за моль осаждённого CaCO3; пересыщение (Ω > 1) — термодинамическое направление, НЕ гарантированное осаждение (нуклеация не моделируется)'
    ]
  };
}

// ============================================
// 3. ВХОД АДАПТЕРА И ЕГО ВАЛИДАЦИЯ
// ============================================

/** Вход минеральной реакции (количество — ЯВНО, с provenance). */
export interface CarbonateMineralReactionInput {
  /** Единый id транзакции (анти-replay ядра). */
  readonly transactionId: string;
  /** Полиморф: «calcite» (caco3) или «aragonite» (aragonite). */
  readonly mineral: CarbonateMineralPolymorph;
  /** Направление реакции. */
  readonly direction: CarbonateMineralDirection;
  readonly oceanReservoirId: string;
  readonly crustReservoirId: string;
  /** Завершённое количество реакции, mol/m² (НЕ скорость). */
  readonly amountMolPerM2: number;
  /** Откуда известно количество (обязателен, идентифицирован). */
  readonly amountProvenance: ReactionDataProvenance;
  readonly time?: FluxTime | null;
  /** Переопределение processId (по умолчанию — процесс каталога). */
  readonly processId?: string;
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

/** Валидация формы входа адаптера (fail-closed, до исполнителя). */
export function validateCarbonateMineralReactionInput(input: unknown): string[] {
  const issues: string[] = [];
  if (!isPlainRecord(input)) {
    return ['вход минеральной реакции должен быть объектом-записью (plain record)'];
  }
  const r = input as Record<string, unknown>;
  if (typeof r.transactionId !== 'string' || r.transactionId.trim() === '') {
    issues.push('transactionId должен быть непустой строкой');
  }
  if (r.mineral !== 'calcite' && r.mineral !== 'aragonite') {
    issues.push('mineral должен быть «calcite» или «aragonite»; полиморфы не смешиваются');
  }
  if (r.direction !== 'dissolve' && r.direction !== 'precipitate') {
    issues.push('direction должен быть «dissolve» или «precipitate»');
  }
  for (const key of ['oceanReservoirId', 'crustReservoirId'] as const) {
    if (typeof r[key] !== 'string' || (r[key] as string).trim() === '') {
      issues.push('«' + key + '» должен быть непустой строкой');
    }
  }
  if (
    typeof r.oceanReservoirId === 'string' &&
    typeof r.crustReservoirId === 'string' &&
    r.oceanReservoirId === r.crustReservoirId
  ) {
    issues.push('океанический и коровый резервуары должны различаться: минеральная реакция идёт МЕЖДУ фазами/резервуарами');
  }
  if (typeof r.amountMolPerM2 !== 'number' || !Number.isFinite(r.amountMolPerM2) || r.amountMolPerM2 <= 0) {
    issues.push('amountMolPerM2 должен быть конечным положительным числом (mol/m²); ноль/отрицательное/нефинитное — отсутствие реакции, а не транзакция');
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
export function buildCarbonateMineralReactionTransactionInput(input: CarbonateMineralReactionInput): GeochemicalCoupledTransactionInput {
  const definition = buildCarbonateMineralReactionDefinition(input);
  const processId = input.processId !== undefined ? input.processId : definition.processId;
  return {
    transactionId: input.transactionId,
    process: {
      processId,
      processSpec: null,
      transactionScopeNote: CARBONATE_MINERAL_TRANSACTION_SCOPE_NOTE
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
// 4. ЗАМКНУТЫЙ РАВНОВЕСНЫЙ РАСЧЁТ КОЛИЧЕСТВА (не верифицируем — честно)
// ============================================

/**
 * Полный набор входов, необходимый для ЗАМКНУТОГО равновесного расчёта
 * количества растворения/осаждения. Отсутствие ЛЮБОГО входа означает
 * not_verifiable: количество НЕ назначается даже при определённом
 * направлении по Ω-вердикту.
 */
export interface CarbonateMineralEquilibriumInputs {
  /** Запас минеральной фазы, mol/m² (в коровом резервуаре). */
  readonly mineralInventoryMolPerM2: number;
  /** Концентрация Ca2+, mol/kg-SW. */
  readonly calciumConcentrationMolPerKgSw: number;
  /** Целевое DIC после реакции, mol/kg-SW (из Stage 4.9c). */
  readonly dicTargetMolPerKgSw: number;
  /** Карбонатная щёлочность, mol/kg-SW. */
  readonly carbonateAlkalinityMolPerKgSw: number;
  /** Явная масса водного столба, kg-SW/m². */
  readonly seawaterColumnMassKgPerM2: number;
  readonly temperatureK: number;
  readonly salinityPSU: number;
  /** Общее давление, atm (параметризация применима только при 1 atm). */
  readonly pressureAtm: number;
  /** Provenance каждого входа — по записи (id входа → provenance). */
  readonly inputsProvenance: Readonly<Record<string, DataProvenance>>;
}

export type CarbonateMineralEquilibriumVerdict =
  | {
      /**
       * Замкнутый расчёт в этой ревизии НЕ реализован (требует
       * согласованной минерально-карбонатной задачи с барьером
       * насыщения и переспециацией на каждом шаге): статус честный,
       * отказ НЕ подменяется эвристическим числом.
       */
      readonly status: 'not_verifiable';
      readonly reason: string;
      /** Перечень обязательных входов и их состояние (present/missing). */
      readonly requiredInputs: readonly { readonly name: string; readonly present: boolean }[];
    };

/**
 * Диагностика полноты входов замкнутого равновесного расчёта. НИКАКОЙ
 * численный extent из Ω не назначается: направление термодинамически
 * благоприятно при отклонении Ω от 1, но КОЛИЧЕСТВО относится к
 * кинетике/равновесной задаче со следующими этапами (4.9g).
 */
export function evaluateCarbonateMineralEquilibriumInputs(
  inputs: CarbonateMineralEquilibriumInputs
): CarbonateMineralEquilibriumVerdict {
  const required: { name: string; present: boolean }[] = [
    { name: 'mineralInventoryMolPerM2', present: typeof inputs.mineralInventoryMolPerM2 === 'number' && Number.isFinite(inputs.mineralInventoryMolPerM2) && inputs.mineralInventoryMolPerM2 > 0 },
    { name: 'calciumConcentrationMolPerKgSw', present: typeof inputs.calciumConcentrationMolPerKgSw === 'number' && Number.isFinite(inputs.calciumConcentrationMolPerKgSw) && inputs.calciumConcentrationMolPerKgSw > 0 },
    { name: 'dicTargetMolPerKgSw', present: typeof inputs.dicTargetMolPerKgSw === 'number' && Number.isFinite(inputs.dicTargetMolPerKgSw) && inputs.dicTargetMolPerKgSw > 0 },
    { name: 'carbonateAlkalinityMolPerKgSw', present: typeof inputs.carbonateAlkalinityMolPerKgSw === 'number' && Number.isFinite(inputs.carbonateAlkalinityMolPerKgSw) && inputs.carbonateAlkalinityMolPerKgSw > 0 },
    { name: 'seawaterColumnMassKgPerM2', present: typeof inputs.seawaterColumnMassKgPerM2 === 'number' && Number.isFinite(inputs.seawaterColumnMassKgPerM2) && inputs.seawaterColumnMassKgPerM2 > 0 },
    { name: 'temperatureK', present: typeof inputs.temperatureK === 'number' && Number.isFinite(inputs.temperatureK) && inputs.temperatureK > 0 },
    { name: 'salinityPSU', present: typeof inputs.salinityPSU === 'number' && Number.isFinite(inputs.salinityPSU) && inputs.salinityPSU >= 0 },
    { name: 'pressureAtm', present: typeof inputs.pressureAtm === 'number' && Number.isFinite(inputs.pressureAtm) && Math.abs(inputs.pressureAtm - 1) <= 1e-12 },
    {
      name: 'inputsProvenance',
      present:
        typeof inputs.inputsProvenance === 'object' &&
        inputs.inputsProvenance !== null &&
        Object.entries(inputs.inputsProvenance).every(([, p]) => provenanceIdentified(p))
    }
  ];
  const missing = required.filter((r) => !r.present).map((r) => r.name);
  return {
    status: 'not_verifiable',
    reason:
      'замкнутый равновесный расчёт количества растворения/осаждения НЕ реализован в Stage 4.9f: минерально-карбонатная равновесная задача с барьером насыщения ограничена резервуаром минерала и требует переспециации DIC/TA_C на каждом шаге; количество НЕ назначается даже при определённом направлении Ω (кинетика/равновесный extent — следующий этап)' +
      (missing.length > 0 ? '; неполный набор входов: ' + missing.join(', ') : '; все обязательные входы перечислены, направление и K*sp доступны через Core/carbonateMinerals.ts'),
    requiredInputs: required
  };
}

// ============================================
// 5. ЦЕЛЕВОЕ СОСТОЯНИЕ ОКЕАНА ПОСЛЕ МИНЕРАЛЬНОЙ РЕАКЦИИ (Stage 4.9c)
// ============================================

/** Вход пересчёта целевой специации после минеральной реакции. */
export interface CarbonateMineralPostReactionTargetInput {
  /** Baseline-распределение (согласовано с инвентарём ДО реакции). */
  readonly baseline: CarbonateSpeciationDistribution;
  /** Полиморф и направление (стехиометрия определяет знак дельт). */
  readonly mineral: CarbonateMineralPolymorph;
  readonly direction: CarbonateMineralDirection;
  /** Завершённое количество реакции, mol/m². */
  readonly amountMolPerM2: number;
  /** Явная масса водного столба, kg-SW/m² (единица SEAWATER_COLUMN_MASS_UNIT). */
  readonly seawaterColumnMassKgPerM2: { readonly valueKgPerM2: number; readonly provenance: DataProvenance };
}

/** Промежуточная дельта стехиометрии (mol/kg-SW) до переспециации. */
export interface CarbonateMineralPostReactionDelta {
  /** ΔDIC, mol/kg-SW (+ растворение, − осаждение). */
  readonly deltaDicMolPerKgSw: number;
  /** ΔTA_C (карбонатная щёлочность), mol/kg-SW (± 2·extent/mass). */
  readonly deltaCarbonateAlkalinityMolPerKgSw: number;
  /** Δ[CO3^2-] мгновенного шага (до переспециации), mol/kg-SW. */
  readonly deltaImmediateCarbonateMolPerKgSw: number;
  /** Масса столба, использованная в пересчёте. */
  readonly seawaterColumnMassKgPerM2: number;
}

export type CarbonateMineralPostReactionTargetResult =
  | {
      readonly status: 'ready';
      /** Целевое равновесное распределение (Stage 4.9c, тот же T/S/P/шкала/модель). */
      readonly target: CarbonateSpeciationDistribution;
      /** Новый DIC, mol/kg-SW. */
      readonly dicMolPerKgSw: number;
      /** Новая карбонатная щёлочность, mol/kg-SW. */
      readonly carbonateAlkalinityMolPerKgSw: number;
      /** Промежуточная стехиометрия (диагностика). */
      readonly reactionDelta: CarbonateMineralPostReactionDelta;
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: 'invalid_input' | 'out_of_applicability' | 'no_solution' | 'unsupported_ph_scale' | 'unsupported_activity_model';
      readonly reason: string;
      readonly issues: readonly string[];
    };

/**
 * Стехиометрия Stage 4.9f: растворение 1 моль CaCO3 даёт +1 моль DIC
 * и +2 экв карбонатной щёлочности в пересчёте на кг морской воды
 * (ΔDIC = ±extent/mass, ΔTA_C = ±2·extent/mass); мгновенный шаг
 * добавляет карбонат как CO3^2- (+extent/mass), затем ПЕРЕСПЕЦИАЦИЯ
 * через существующий решатель Stage 4.9c (второй решатель НЕ создаётся)
 * при сохранении phScale/activityModel/T/S/P. Строгое равновесие 'target'
 * — термодинамическая ЦЕЛЬ; её применение — отдельная атомарная
 * транзакция Stage 4.9d (см. executeCarbonateMineralCycle).
 */
export function carbonateMineralPostReactionTarget(input: CarbonateMineralPostReactionTargetInput): CarbonateMineralPostReactionTargetResult {
  const notApplied = (reasonKind: 'invalid_input' | 'out_of_applicability' | 'no_solution' | 'unsupported_ph_scale' | 'unsupported_activity_model', reason: string, issues: readonly string[]): CarbonateMineralPostReactionTargetResult => {
    return { status: 'not_applied', reasonKind, reason, issues };
  };
  const issues: string[] = [];
  const mass = input.seawaterColumnMassKgPerM2.valueKgPerM2;
  if (typeof mass !== 'number' || !Number.isFinite(mass) || mass <= 0) {
    issues.push('seawaterColumnMassKgPerM2.valueKgPerM2 должен быть конечным положительным числом (kg-SW/m²), получено ' + String(mass));
  }
  if (!provenanceIdentified(input.seawaterColumnMassKgPerM2.provenance)) {
    issues.push('seawaterColumnMassKgPerM2.provenance обязателен и должен идентифицировать источник');
  }
  if (typeof input.amountMolPerM2 !== 'number' || !Number.isFinite(input.amountMolPerM2) || input.amountMolPerM2 < 0) {
    issues.push('amountMolPerM2 должен быть конечным неотрицательным числом (mol/m²), получено ' + String(input.amountMolPerM2));
  }
  if (input.mineral !== 'calcite' && input.mineral !== 'aragonite') {
    issues.push('mineral должен быть «calcite» или «aragonite»');
  }
  if (input.direction !== 'dissolve' && input.direction !== 'precipitate') {
    issues.push('direction должен быть «dissolve» или «precipitate»');
  }
  const b = input.baseline;
  if (typeof b !== 'object' || b === null) {
    issues.push('baseline должен быть объектом CarbonateSpeciationDistribution');
  } else {
    if (b.approximationKind !== 'ideal_dilute') {
      issues.push("baseline.approximationKind должен быть «ideal_dilute» (Stage 4.9c), получено «" + String(b.approximationKind) + "»");
    }
    const c = b.concentrations;
    if (typeof c !== 'object' || c === null) {
      issues.push('baseline.concentrations должен быть объектом концентраций (mol/kg-SW)');
    } else {
      for (const key of ['co2StarMolPerKgSw', 'hco3MolPerKgSw', 'co3MolPerKgSw', 'hydrogenMolPerKgSw'] as const) {
        const v = c[key];
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          issues.push(`baseline.concentrations.${key} должен быть конечным неотрицательным числом (mol/kg-SW), получено ${String(v)}`);
        }
      }
    }
  }
  if (issues.length > 0) {
    return notApplied('invalid_input', 'вход пересчёта целевой специации не проходит валидацию формы', issues);
  }

  const sign = input.direction === 'dissolve' ? 1 : -1;
  const perKg = input.amountMolPerM2 / mass;
  const deltaDic = sign * perKg;
  const deltaAlk = sign * 2 * perKg;
  const deltaImmediateCarbonate = sign * perKg;

  const dic = b.concentrations.co2StarMolPerKgSw + b.concentrations.hco3MolPerKgSw + b.concentrations.co3MolPerKgSw + deltaDic;
  const alkBaseline = b.concentrations.hco3MolPerKgSw + 2 * b.concentrations.co3MolPerKgSw;
  const alk = alkBaseline + deltaAlk;
  if (!(dic > 0) || !(alk > 0)) {
    return notApplied(
      'invalid_input',
      'стехиометрические дельты приводят к неположительному DIC или карбонатной щёлочности: составная операция не стартует (осаждение сверх запаса ионов — за пределами физической области)',
      ['DIC = ' + String(dic) + ', TA_C = ' + String(alk) + ' (mol/kg-SW)']
    );
  }

  const modelInput: CarbonateModelInput = {
    temperatureK: b.temperatureK,
    temperatureProvenance: undefined,
    salinityPSU: b.salinityPSU,
    pressurePa: b.pressurePa,
    dicMolPerKgSw: dic,
    carbonateAlkalinityMolPerKgSw: alk,
    phScale: b.phScale,
    activityModel: b.activityModel
  };
  const solved = solveCarbonateEquilibrium(modelInput);
  if (solved.status !== 'applied') {
    const err = solved as CarbonateModelError;
    return notApplied(err.reasonKind, 'решатель Stage 4.9c отказал: ' + err.reason, [...err.issues]);
  }
  const ms = solved as CarbonateModelResult;
  const warnings: string[] = [
    'переспециация выполнена существующим решателем Stage 4.9c при сохранении phScale/activityModel/T/S/P; второй решатель не создан',
    'приближение: ideal_dilute + эмпирическая K*sp Mucci (1983) — НЕ полноценная неидеальная термодинамика морской воды'
  ];
  if (ms.warnings.length > 0) warnings.push(...ms.warnings);

  return {
    status: 'ready',
    target: {
      phScale: ms.phScale,
      activityModel: ms.activityModel,
      temperatureK: ms.temperatureK,
      salinityPSU: ms.salinityPSU,
      pressurePa: ms.pressurePa,
      approximationKind: 'ideal_dilute',
      concentrations: {
        co2StarMolPerKgSw: ms.speciesMolPerKgSw.co2_aq,
        hco3MolPerKgSw: ms.speciesMolPerKgSw.hco3_aq,
        co3MolPerKgSw: ms.speciesMolPerKgSw.co3_aq,
        hydrogenMolPerKgSw: ms.hydrogenMolPerKgSw,
        // Доступность OH зеркалит baseline (Stage 4.9d запрещает одностороннюю OH):
        // если baseline задаёт OH известной, берём OH решателя Стадии 4.9c
        // (null на шкале «total» — тогда стадия переспециации честно вернёт not_verifiable);
        // если baseline не задаёт OH — неизвестность переносится (dOH = 0), изменения OH не моделируются.
        ohMolPerKgSw: b.concentrations.ohMolPerKgSw !== null ? ms.speciesMolPerKgSw.oh_aq : null
      },
      provenance: {
        sourceName: 'Stage 4.9f: целевая специация океана после минеральной реакции (решатель Stage 4.9c; стехиометрия ΔDIC = ±e/m, ΔTA_C = ±2e/m)',
        sourceId: 'doi:10.2475/ajs.283.7.780',
        recordId: 'carbonate_mineral_post_reaction_target',
        retrievedAt: '2026-11-23',
        method: 'solveCarbonateEquilibrium поверх стехиометрии растворения/осаждения ' + CARBONATE_MINERAL_SPECIES_ID[input.mineral],
        applicability: 'стохиометрия CaCO3(s) ⇌ Ca2+ + CO3^2- Mucci 1983; приближение ideal_dilute',
        limitations: 'равновесие — термодинамическая цель, НЕ скорость; H/O-баланс модели не закрывается этим расчётом'
      }
    },
    dicMolPerKgSw: dic,
    carbonateAlkalinityMolPerKgSw: alk,
    reactionDelta: {
      deltaDicMolPerKgSw: deltaDic,
      deltaCarbonateAlkalinityMolPerKgSw: deltaAlk,
      deltaImmediateCarbonateMolPerKgSw: deltaImmediateCarbonate,
      seawaterColumnMassKgPerM2: mass
    },
    warnings
  };
}

// ============================================
// 6. ПЛАН И ИСПОЛНЕНИЕ (представитель Stage 4.9d)
// ============================================

export type CarbonateMineralPlanResult =
  | {
      readonly status: 'ready';
      readonly mineral: CarbonateMineralPolymorph;
      readonly direction: CarbonateMineralDirection;
      readonly processId: string;
      readonly plan: GeochemicalCoupledPlanResult;
      readonly transactionInput: GeochemicalCoupledTransactionInput;
    }
  | {
      readonly status: 'blocked';
      readonly reasonKind: GeochemicalCoupledBlockKind;
      readonly processId: string | null;
      readonly mineral: CarbonateMineralPolymorph | null;
      readonly direction: CarbonateMineralDirection | null;
      readonly reason: string;
      readonly issues: readonly string[];
    };

export type CarbonateMineralWorldResult =
  | {
      readonly status: 'applied';
      readonly core: CoreWorldState;
      readonly transactionId: string;
      readonly processId: string;
      readonly mineral: CarbonateMineralPolymorph;
      readonly direction: CarbonateMineralDirection;
      readonly amountMolPerM2: number;
      readonly aggregatedDeltas: readonly { readonly reservoirId: string; readonly speciesId: string; readonly deltaMolM2: number }[];
      readonly audit: GeochemicalCoupledBalanceAudit;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: GeochemicalCoupledBlockKind;
      readonly processId: string | null;
      readonly mineral: CarbonateMineralPolymorph | null;
      readonly direction: CarbonateMineralDirection | null;
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
    }
  };
}

/**
 * Построить план минеральной реакции на текущем состоянии ядра.
 * План НЕ изменяет состояние.
 */
export function planCarbonateMineralReaction(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: CarbonateMineralReactionInput
): CarbonateMineralPlanResult {
  const formIssues = validateCarbonateMineralReactionInput(input);
  if (formIssues.length > 0) {
    return {
      status: 'blocked',
      reasonKind: 'not_executable',
      processId: null,
      mineral: isPlainRecord(input) && (input as Record<string, unknown>).mineral === 'calcite' ? 'calcite' : (isPlainRecord(input) && (input as Record<string, unknown>).mineral === 'aragonite' ? 'aragonite' : null),
      direction: isPlainRecord(input) && ((input as Record<string, unknown>).direction === 'dissolve' || (input as Record<string, unknown>).direction === 'precipitate') ? ((input as Record<string, unknown>).direction as CarbonateMineralDirection) : null,
      reason: 'вход минеральной реакции не проходит валидацию формы',
      issues: formIssues
    };
  }
  if (core.schemaVersion !== '1.5.0' && core.schemaVersion !== '1.6.0') {
    return {
      status: 'blocked',
      reasonKind: 'not_executable',
      processId: null,
      mineral: input.mineral,
      direction: input.direction,
      reason: 'схема состояния ядра «' + core.schemaVersion + '» не поддерживается (поддерживаются 1.5.0 и 1.6.0): выполните миграцию сохранений',
      issues: []
    };
  }
  const envResult = environmentFromCore(core, speciesCatalog);
  if (envResult.environment === null) {
    return { status: 'blocked', reasonKind: 'not_executable', processId: null, mineral: input.mineral, direction: input.direction, reason: envResult.issues[0] ?? 'среда не построена', issues: envResult.issues };
  }
  const transactionInput = buildCarbonateMineralReactionTransactionInput(input);
  const plan = planGeochemicalCoupledTransaction(envResult.environment, transactionInput);
  if (plan.status !== 'ready') {
    return { status: 'blocked', reasonKind: plan.reasonKind, processId: plan.processId, mineral: input.mineral, direction: input.direction, reason: plan.reason, issues: [...plan.issues] };
  }
  return {
    status: 'ready',
    mineral: input.mineral,
    direction: input.direction,
    processId: transactionInput.process.processId,
    plan,
    transactionInput
  };
}

/** Исполнить ПОДГОТОВЛЕННЫЙ план к ядру (защиты делегированы 4.9d). */
export function executeCarbonateMineralReactionPrepared(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  prepared: CarbonateMineralPlanResult
): CarbonateMineralWorldResult {
  if (prepared.status !== 'ready') {
    return {
      status: 'not_applied',
      reasonKind: prepared.reasonKind,
      processId: prepared.processId,
      mineral: prepared.mineral,
      direction: prepared.direction,
      reason: prepared.reason,
      issues: [...prepared.issues],
      error: null
    };
  }
  const envResult = environmentFromCore(core, speciesCatalog);
  if (envResult.environment === null) {
    return { status: 'not_applied', reasonKind: 'not_executable', processId: prepared.processId, mineral: prepared.mineral, direction: prepared.direction, reason: envResult.issues[0] ?? 'среда не построена', issues: envResult.issues, error: null };
  }
  const execution = executeGeochemicalCoupledTransaction(envResult.environment, prepared.transactionInput, prepared.plan);
  if (execution.status !== 'applied') {
    return { status: 'not_applied', reasonKind: execution.reasonKind, processId: execution.processId, mineral: prepared.mineral, direction: prepared.direction, reason: execution.reason, issues: [...execution.issues], error: execution.error };
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
    return {
      status: 'not_applied',
      reasonKind: 'not_executable',
      processId: prepared.processId,
      mineral: prepared.mineral,
      direction: prepared.direction,
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
    mineral: prepared.mineral,
    direction: prepared.direction,
    amountMolPerM2: prepared.transactionInput.components[0]?.kind === 'reaction' ? prepared.transactionInput.components[0].extentMolPerM2 : 0,
    aggregatedDeltas: execution.aggregatedDeltas,
    audit: execution.audit,
    diagnostics: execution.diagnostics
  };
}

/** Однофазовый вызов: план → исполнение (тот же снимок, защиты 4.9d). */
export function executeCarbonateMineralReaction(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: CarbonateMineralReactionInput
): CarbonateMineralWorldResult {
  const prepared = planCarbonateMineralReaction(core, speciesCatalog, input);
  if (prepared.status !== 'ready') {
    return {
      status: 'not_applied',
      reasonKind: prepared.reasonKind,
      processId: prepared.processId,
      mineral: prepared.mineral,
      direction: prepared.direction,
      reason: prepared.reason,
      issues: [...prepared.issues],
      error: null
    };
  }
  return executeCarbonateMineralReactionPrepared(core, speciesCatalog, prepared);
}

// ============================================
// 7. СОСТАВНОЙ ЦИКЛ: РЕАКЦИЯ → DIC/TA_C → ПЕРЕСПЕЦИАЦИЯ → ИНВЕНТАРЬ
// ============================================

/**
 * Вход составной атомарной операции: минеральная реакция + переспециация.
 * Оба transactionId обязаны быть ЯВНЫМИ и различными (каждый атакован
 * анти-replay независимо); при отказе любой стадии составная операция
 * возвращает not_applied с ИСХОДНЫМ состоянием ядра.
 */
export interface CarbonateMineralCycleInput {
  /** transactionId стадии минеральной реакции. */
  readonly transactionId: string;
  /** transactionId стадии переспециации (Stage 4.9d). */
  readonly speciationTransactionId: string;
  readonly mineral: CarbonateMineralPolymorph;
  readonly direction: CarbonateMineralDirection;
  readonly oceanReservoirId: string;
  readonly crustReservoirId: string;
  /** Количество реакции, mol/m² (ЯВНО, с provenance). */
  readonly amountMolPerM2: number;
  readonly amountProvenance: ReactionDataProvenance;
  /**
   * Baseline-распределение, согласованное с инвентарём ДО реакции
   * (та же семантика, что у Stage 4.9d).
   */
  readonly baseline: CarbonateSpeciationDistribution;
  /** Явная масса водного столба с provenance. */
  readonly seawaterColumnMassKgPerM2: { readonly valueKgPerM2: number; readonly provenance: DataProvenance };
  /** Компенсация изменения модельного заряда фоном (см. Stage 4.9d). */
  readonly strongIonChargeCompensationMolPerKgSw?: { readonly deltaStrongIonChargeMolPerKgSw: number; readonly provenance: DataProvenance };
  readonly time?: FluxTime | null;
  readonly note?: string;
}

export type CarbonateMineralCycleResult =
  | {
      readonly status: 'applied';
      /** НОВОЕ состояние ядра (обе стадии применены); вход не мутируется. */
      readonly core: CoreWorldState;
      readonly transactionId: string;
      readonly speciationTransactionId: string;
      readonly processId: string;
      readonly mineral: CarbonateMineralPolymorph;
      readonly direction: CarbonateMineralDirection;
      readonly amountMolPerM2: number;
      /** Дельты стадии реакции (минерал и ионы). */
      readonly reactionDeltas: readonly { readonly reservoirId: string; readonly speciesId: string; readonly deltaMolM2: number }[];
      /** Дельты стадии переспециации (carbonate forms), mol/m². */
      readonly speciationDeltas: readonly { readonly speciesId: string; readonly deltaMolPerKgSw: number; readonly deltaMolM2: number }[];
      readonly target: CarbonateSpeciationDistribution;
      /** Baseline стадии переспециации: post-реакционное распределение (co3 ± e/m). */
      readonly postReactionBaseline: CarbonateSpeciationDistribution;
      readonly dicBeforeMolPerKgSw: number;
      readonly dicAfterMolPerKgSw: number;
      readonly diagnostics: readonly string[];
      readonly warnings: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      /** Стадия, на которой операция прервана. */
      readonly failedStage: 'mineral_reaction' | 'speciation' | 'target_computation';
      readonly reasonKind: string;
      readonly reason: string;
      readonly issues: readonly string[];
      readonly error: string | null;
    };

/**
 * Составная атомарная операция Stage 4.9f:
 * 1) минеральная реакция (coupled-транзакция Stage 4.9d, extent ЯВНО);
 * 2) целевая специация через существующий решатель Stage 4.9c
 *    (стехиометрия ΔDIC = ±e/m, ΔTA_C = ±2e/m);
 * 3) переспециация через атомарный адаптер Stage 4.9d.
 * При отказе любой стадии возвращается ИСХОДНОЕ состояние ядра:
 * промежуточное состояние отбрасывается, частичное применение
 * исключено. Кинетика и произвольные количества НЕ используются.
 */
export function executeCarbonateMineralCycle(
  core: CoreWorldState,
  speciesCatalog: SpeciesCatalog,
  input: CarbonateMineralCycleInput
): CarbonateMineralCycleResult {
  const notApplied = (
    failedStage: 'mineral_reaction' | 'speciation' | 'target_computation',
    reasonKind: string,
    reason: string,
    issues: readonly string[],
    error: string | null = null
  ): CarbonateMineralCycleResult => ({ status: 'not_applied', failedStage, reasonKind, reason, issues, error });

  if (input.speciationTransactionId === input.transactionId) {
    return notApplied('mineral_reaction', 'not_executable', 'transactionId стадий должны различаться (у каждой стадии свой анти-replay)', []);
  }
  if (input.mineral !== 'calcite' && input.mineral !== 'aragonite') {
    return notApplied('mineral_reaction', 'not_executable', 'mineral должен быть «calcite» или «aragonite»; полиморфы не смешиваются', []);
  }

  // Стадия 1: минеральная реакция.
  const reaction = executeCarbonateMineralReaction(core, speciesCatalog, {
    transactionId: input.transactionId,
    mineral: input.mineral,
    direction: input.direction,
    oceanReservoirId: input.oceanReservoirId,
    crustReservoirId: input.crustReservoirId,
    amountMolPerM2: input.amountMolPerM2,
    amountProvenance: input.amountProvenance,
    time: input.time,
    note: input.note
  });
  if (reaction.status !== 'applied') {
    return notApplied('mineral_reaction', reaction.reasonKind, reaction.reason, [...reaction.issues], reaction.error);
  }

  // Стадия 2: целевая специация (решатель 4.9c).
  const target = carbonateMineralPostReactionTarget({
    baseline: input.baseline,
    mineral: input.mineral,
    direction: input.direction,
    amountMolPerM2: input.amountMolPerM2,
    seawaterColumnMassKgPerM2: input.seawaterColumnMassKgPerM2
  });
  if (target.status !== 'ready') {
    return notApplied('target_computation', target.reasonKind, target.reason, [...target.issues]);
  }

  // Стадия 3: переспециация (атомарный адаптер Stage 4.9d).
  // Baseline стадии 3 обязан быть согласован с инвентарём ПОСЛЕ стадии 1
  // (Stage 4.9d сверяет baseline × массу столба с фактическим инвентарём,
  // допуск CARBONATE_BASELINE_TOLERANCE_MOL_M2 = 1e-12 mol/m²). Минеральная
  // реакция уже добавила/изъяла co3_aq в количестве e/m, поэтому пост-
  // реакционный baseline отличается от входного только концентрацией CO3^2-.
  const cycleMass = input.seawaterColumnMassKgPerM2.valueKgPerM2;
  const cycleSign = input.direction === 'dissolve' ? 1 : -1;
  const postReactionBaseline: CarbonateSpeciationDistribution = {
    ...input.baseline,
    provenance: {
      ...input.baseline.provenance,
      note: 'пост-реакционный baseline Stage 4.9f: co3_aq сдвинута стехиометрией минеральной реакции (+' +
        String(input.direction === 'dissolve' ? 'e/m' : '−e/m') + ' mol/kg-SW относительно входного baseline), прочие формы без изменений'
    },
    concentrations: {
      ...input.baseline.concentrations,
      co3MolPerKgSw: input.baseline.concentrations.co3MolPerKgSw + cycleSign * (reaction.amountMolPerM2 / cycleMass)
    }
  };
  if (postReactionBaseline.concentrations.co3MolPerKgSw <= 0) {
    return notApplied('speciation', 'not_executable',
      'пост-реакционная концентрация co3_aq неположительна: осаждение сверх запаса ионов за пределами физической области',
      ['co3MolPerKgSw = ' + String(postReactionBaseline.concentrations.co3MolPerKgSw)]);
  }
  const baselineDic =
    input.baseline.concentrations.co2StarMolPerKgSw +
    input.baseline.concentrations.hco3MolPerKgSw +
    input.baseline.concentrations.co3MolPerKgSw;
  const speciation = executeCarbonateSpeciationExecution(reaction.core, speciesCatalog, {
    transactionId: input.speciationTransactionId,
    oceanReservoirId: input.oceanReservoirId,
    baseline: postReactionBaseline,
    target: target.target,
    seawaterColumnMassKgPerM2: {
      valueKgPerM2: input.seawaterColumnMassKgPerM2.valueKgPerM2,
      unit: SEAWATER_COLUMN_MASS_UNIT,
      provenance: input.seawaterColumnMassKgPerM2.provenance
    },
    ...(input.strongIonChargeCompensationMolPerKgSw !== undefined
      ? { strongIonChargeCompensationMolPerKgSw: input.strongIonChargeCompensationMolPerKgSw }
      : {})
  });
  if (speciation.status !== 'applied') {
    return notApplied('speciation', speciation.reasonKind, speciation.reason, [...speciation.issues], speciation.error);
  }

  const diagnostics = [
    'стадия 1: минеральная реакция ' + CARBONATE_MINERAL_SPECIES_ID[input.mineral] + ' ⇌ ca2_aq + co3_aq (coupled-транзакция Stage 4.9d, extent ЯВНО)',
    'стадия 2: ΔDIC = ' + (input.direction === 'dissolve' ? '+' : '−') + 'e/m, ΔTA_C = ' + (input.direction === 'dissolve' ? '+' : '−') + '2e/m (стехиометрия CaCO3; Mucci 1983, DOI ' + MUCCI_1983_KSP_PROVENANCE.sourceId + ')',
    'стадия 3: переспециация решателем Stage 4.9c применена адаптером Stage 4.9d с пост-реакционным baseline (co3 ± e/m), атомарно',
    'при отклонении любой стадии состояние ядра возвращается к исходному (побитово неизменному); глобальный H/O-баланс остаётся not_verifiable (ревизия 4.9e)'
  ];

  return {
    status: 'applied',
    core: speciation.core,
    transactionId: reaction.transactionId,
    speciationTransactionId: speciation.transactionId,
    processId: reaction.processId,
    mineral: input.mineral,
    direction: input.direction,
    amountMolPerM2: reaction.amountMolPerM2,
    reactionDeltas: reaction.aggregatedDeltas,
    speciationDeltas: speciation.deltas.map((d) => ({ speciesId: d.speciesId, deltaMolPerKgSw: d.deltaMolPerKgSw, deltaMolM2: d.deltaMolM2 })),
    target: target.target,
    postReactionBaseline,
    dicBeforeMolPerKgSw: baselineDic,
    dicAfterMolPerKgSw: target.dicMolPerKgSw,
    diagnostics,
    warnings: target.warnings
  };
}

