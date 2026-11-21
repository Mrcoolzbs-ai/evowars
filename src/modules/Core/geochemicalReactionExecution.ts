// ============================================
// GEOCHEMICAL REACTION EXECUTION - атомарное применение геохимических реакций
// ============================================
//
// Stage 4.9b. Реальный оператор физического применения реакций к
// материальным инвентарям, которого не хватало фундаменту:
// ReactionLedger (Stage 4.2.3.2) валидирует записи, проверяет
// стехиометрию (auditReactionStoichiometry) и рассчитывает вклады
// (reactionInventoryDeltas), но сам инвентари НЕ изменяет — этот
// исполнитель закрывает пробел, НЕ заменяя и не дублируя ни один из
// существующих контрактов.
//
// ЧТО ЭТО И ЧТО ЭТО НЕ ЭТО:
// - это ОДИН ЛОГИЧЕСКИЙ ОПЕРАТОР атомарной транзакции «реакция»:
//   проверка определения → стехиометрический/зарядовый/фазовый аудит →
//   проверка среды (виды, резервуары, инвентари, основания) → вклады
//   (reactionInventoryDeltas) → достаточность реагентов → иммутабельные
//   обновления резервуаров (addMaterial/removeMaterial ядра) →
//   registerReaction → проверка результирующего журнала. При ЛЮБОЙ
//   ошибке возвращается not_applied с диагностикой и ни один входной
//   объект не изменяется;
// - это НЕ кинетическая модель и НЕ источник скоростей: исполнитель
//   принимает ЯВНО заданную ЗАВЕРШЁННУЮ степень протекания
//   (extentMolPerM2) с идентифицированным provenance. Отсутствие
//   extent или его источника — отказ от исполнения, а не нулевая
//   реакция. Никакие скорости и равновесия не вычисляются и не
//   выдумываются;
// - это НЕ исполнение coupled-процессов: атомарная реакция + отдельный
//   перенос — самостоятельная транзакция; имитация её двумя
//   независимыми успешными вызовами запрещена (см. §9 промпта и
//   CoupledTransactionPlan ниже: контракт объявлен, исполнение —
//   следующий этап);
// - стехиометрия выводится ТОЛЬКО из явных списков участников с
//   коэффициентами: автогенерация по названию процесса, тексту
//   описания или порядку участников запрещена и отсутствует.
//
// Повторное использование существующих контрактов (никаких дублей):
// validateReactionRecord / validateReactionLedger / registerReaction /
// auditReactionStoichiometry / reactionInventoryDeltas
// (Core/reactionLedger.ts), валидаторы и неизменяемые операции
// инвентарей (addMaterial/removeMaterial, validateMaterialInventory,
// validateReservoirRecord — Core/reservoir.ts), существующий
// SpeciesCatalog (Core/species.ts), DataProvenance
// (Core/scientificValue.ts). Вторая система единиц не создаётся:
// основание extent — геохимическая конвенция column_amount (mol/m²).

import { addMaterial, isPlainRecord, removeMaterial, validateMaterialInventory, validateReservoirRecord } from './reservoir';
import type { ReservoirRecord } from './reservoir';
import type { FluxTime } from './fluxLedger';
import type { ReactionLedger, ReactionParticipant, ReactionRecord } from './reactionLedger';
import {
  auditReactionStoichiometry,
  createReactionLedger,
  reactionInventoryDeltas,
  registerReaction,
  validateReactionLedger,
  validateReactionRecord
} from './reactionLedger';
import type { ReactionInventoryDeltas } from './reactionLedger';
import type { SpeciesCatalog } from './species';
import {
  GEOCHEMICAL_REACTION_CONTEXT_SCHEMA_VERSION,
  GEOCHEMICAL_REACTION_EXTENT_BASIS,
  GEOCHEMICAL_REACTION_EXTENT_UNIT,
  GEOCHEMICAL_REACTION_MECHANISM
} from './geochemicalReactionContext';
import type { GeochemicalReactionContext, ReactionDataProvenance } from './geochemicalReactionContext';

// ============================================
// 1. ОПРЕДЕЛЕНИЕ РЕАКЦИИ
// ============================================

/**
 * Сериализуемое определение геохимической реакции (данные, не логика):
 * явная стехиометрия с участниками, коэффициентами и резервуарами.
 * Коэффициенты — стехиометрические коэффициенты УРАВНЕНИЯ (число
 * частиц), не количества вещества; фактический масштаб задаёт extent
 * в момент исполнения (GeochemicalReactionExecutionInput).
 */
export interface GeochemicalReactionDefinition {
  /** Стабильный идентификатор определения реакции (реестра определений ещё нет — строка-ссылка). */
  readonly reactionId: string;
  /** Связанный идентификатор геохимического процесса каталога. */
  readonly processId: string;
  /** Человекочитаемое физическое описание (не источник стехиометрии). */
  readonly description: string;
  /** Расходуемые участники (минимум один): резервуар, вид, коэффициент. */
  readonly reactants: readonly ReactionParticipant[];
  /** Образующиеся участники (минимум один): резервуар, вид, коэффициент. */
  readonly products: readonly ReactionParticipant[];
  /** Основание extent исполнения: геохимическая конвенция column_amount (mol/m²). */
  readonly extentBasis: typeof GEOCHEMICAL_REACTION_EXTENT_BASIS;
  /** Происхождение ОПРЕДЕЛЕНИЯ (стехиометрия, описание, условия). Обязательно. */
  readonly definitionProvenance: ReactionDataProvenance;
  /** Диапазон применимости определения (необязателен). */
  readonly applicability?: string;
  /** Ограничения (что определение НЕ утверждает; необязательны). */
  readonly limitations?: string;
  /** Допущения, сопровождающие исполнение (необязательны). */
  readonly assumptions?: readonly string[];
}

/**
 * Runtime-валидация определения реакции (fail-closed): форма записи,
 * непустые идентификаторы, участники-plain-records с конечными
 * положительными коэффициентами, уникальность пары (резервуар, вид)
 * на каждой стороне (дубли должны быть объединены заранее, контракт
 * ReactionLedger), column_amount, идентифицированный provenance
 * определения. Возвращает список проблем (пустой = корректно).
 */
export function validateGeochemicalReactionDefinition(value: unknown): string[] {
  const issues: string[] = [];
  if (!isPlainRecord(value)) {
    return ['определение реакции должно быть объектом-записью (plain record), а не массивом/Date/Map/Set/RegExp/экземпляром класса или значением не-объектного типа'];
  }
  const d = value as Record<string, unknown>;
  for (const key of ['reactionId', 'processId', 'description'] as const) {
    if (typeof d[key] !== 'string' || (d[key] as string).trim() === '') {
      issues.push(`«${key}» должен быть непустой строкой`);
    }
  }
  if (d.extentBasis !== GEOCHEMICAL_REACTION_EXTENT_BASIS) {
    issues.push(`extentBasis определения должен быть «${GEOCHEMICAL_REACTION_EXTENT_BASIS}» (геохимическая конвенция mol/m²), получено «${String(d.extentBasis)}»`);
  }
  for (const side of ['reactants', 'products'] as const) {
    const valueSide = d[side];
    if (!Array.isArray(valueSide) || valueSide.length === 0) {
      issues.push(side + ' должен быть непустым массивом участников');
      continue;
    }
    const seen = new Set<string>();
    for (let index = 0; index < valueSide.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(valueSide, index)) {
        issues.push(side + '[' + index + '] отсутствует (разреженный массив): каждый индекс обязан содержать участника');
        continue;
      }
      const entry = valueSide[index];
      if (!isPlainRecord(entry)) {
        issues.push(side + '[' + index + '] должен быть объектом-записью участника (plain record)');
        continue;
      }
      const p = entry as Record<string, unknown>;
      for (const key of ['reservoirId', 'speciesId'] as const) {
        if (typeof p[key] !== 'string' || (p[key] as string).trim() === '') {
          issues.push(side + '[' + index + ']: «' + key + '» должен быть непустой строкой');
        }
      }
      if (typeof p.coefficient !== 'number' || !Number.isFinite(p.coefficient) || p.coefficient <= 0) {
        issues.push(side + '[' + index + ']: коэффициент должен быть конечным положительным числом, получено ' + String(p.coefficient));
      }
      if (typeof p.reservoirId === 'string' && typeof p.speciesId === 'string' && p.reservoirId.trim() !== '' && p.speciesId.trim() !== '') {
        const key = JSON.stringify([p.reservoirId, p.speciesId]);
        if (seen.has(key)) {
          issues.push(side + ': пара резервуар «' + p.reservoirId + '» + вид «' + p.speciesId + '» встречается дважды — коэффициенты должны быть объединены заранее');
        } else {
          seen.add(key);
        }
      }
    }
  }
  const prov = d.definitionProvenance;
  if (typeof prov !== 'object' || prov === null || Array.isArray(prov)) {
    issues.push('definitionProvenance обязателен (DataProvenance с идентифицированным источником: откуда стехиометрия)');
  } else {
    const p = prov as Record<string, unknown>;
    const identified =
      (typeof p.sourceName === 'string' && p.sourceName.trim() !== '') ||
      (typeof p.sourceId === 'string' && p.sourceId.trim() !== '') ||
      (typeof p.datasetId === 'string' && p.datasetId.trim() !== '') ||
      (typeof p.reference === 'string' && p.reference.trim() !== '');
    if (!identified) {
      issues.push('definitionProvenance должен идентифицировать источник (sourceName, sourceId, datasetId или reference)');
    }
  }
  for (const key of ['applicability', 'limitations'] as const) {
    const v = d[key];
    if (v !== undefined && typeof v !== 'string') {
      issues.push(`«${key}», если задан, должен быть строкой`);
    }
  }
  if (d.assumptions !== undefined) {
    if (!Array.isArray(d.assumptions)) {
      issues.push('assumptions, если заданы, должны быть массивом строк');
    } else {
      for (let i = 0; i < d.assumptions.length; i++) {
        const item = d.assumptions[i];
        if (typeof item !== 'string' || item.trim() === '') {
          issues.push(`assumptions[${i}] должен быть непустой строкой`);
        }
      }
    }
  }
  return issues;
}

// ============================================
// 2. СРЕДА ИСПОЛНЕНИЯ И ВХОД
// ============================================

/**
 * Среда исполнения: известные виды и резервуары даны извне (как у
 * геохимического исполнителя потоков). Ничего не достраивается:
 * отсутствующий резервуар/инвентарь — отказ исполнения (fail-closed).
 * Существующий журнал реакций (ledgerInput) НЕ мутируется: результат
 * несёт новый журнал с добавленной записью; незаданный журнал
 * эквивалентен пустому.
 */
export interface GeochemicalReactionExecutionEnvironment {
  readonly speciesCatalog: SpeciesCatalog;
  readonly reservoirs: Record<string, ReservoirRecord>;
  readonly ledgerInput?: ReactionLedger;
}

/**
 * Явно заданная ЗАВЕРШЁННАЯ степень протекания реакции. Это НЕ
 * кинетическая оценка: значение приходит извне с идентифицированным
 * provenance. Отсутствие extent или его источника — отказ исполнения.
 */
export interface GeochemicalReactionExecutionInput {
  /** Уникальный id транзакции (id записи в ReactionLedger). */
  readonly transactionId: string;
  /** Завершённая степень протекания, mol/m² (положительное конечное число). */
  readonly extentMolPerM2: number;
  /** Происхождение extent (идентифицированный источник) — обязательно. */
  readonly extentProvenance: ReactionDataProvenance;
  /** Привязка к моменту времени симуляции (необязательна; null — не привязана). */
  readonly time?: FluxTime | null;
  /** Служебная заметка в записи (не замена структурной атрибуции). */
  readonly note?: string;
}

// ============================================
// 3. ОШИБКИ И РЕЗУЛЬТАТЫ
// ============================================

/** Причина отказа исполнения (различимые исходы, не один строковый код). */
export type GeochemicalReactionBlockKind =
  /** Определение/вход структурно некорректны; реакция не описана. */
  | 'not_executable'
  /** Честная невозможность подтвердить: неизвестный вид/состав/extent/переполнение. */
  | 'not_verifiable'
  /** Определение корректно, но за пределами применимости исполнителя (например c_org). */
  | 'out_of_applicability';

export type GeochemicalReactionPlanResult =
  | {
      readonly status: 'ready';
      readonly reactionId: string;
      readonly processId: string;
      /** Кандидат записи, ещё НЕ зарегистрированный в журнале. */
      readonly record: ReactionRecord;
      readonly deltas: ReactionInventoryDeltas;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'blocked';
      readonly reasonKind: GeochemicalReactionBlockKind;
      readonly reactionId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
    };

export type GeochemicalReactionExecutionResult =
  | {
      readonly status: 'applied';
      readonly reactionId: string;
      readonly processId: string;
      readonly transactionId: string;
      /** Зарегистрированная запись (с геохимическим контекстом). */
      readonly record: ReactionRecord;
      /** НОВЫЙ журнал с РОВНО одной добавленной записью; входной не мутируется. */
      readonly ledger: ReactionLedger;
      /** НОВЫЕ резервуары; незатронутые разделяются по ссылке с входом. */
      readonly reservoirs: Record<string, ReservoirRecord>;
      readonly deltas: ReactionInventoryDeltas;
      readonly diagnostics: readonly string[];
    }
  | {
      readonly status: 'not_applied';
      readonly reasonKind: GeochemicalReactionBlockKind;
      readonly reactionId: string | null;
      readonly reason: string;
      readonly issues: readonly string[];
      /** Текст структурированной ошибки ядра, если отказ пришёл из register/валидатора. */
      readonly error: string | null;
    };

// ============================================
// 4. ПЛАНИРОВАНИЕ И ИСПОЛНЕНИЕ
// ============================================

/**
 * Особое правило organic-bookkeeping: вид 'c_org' — честный
 * bookkeeping-компонент «моли атомов углерода в органическом пуле»;
 * содержание H и O органического вещества НЕ задано. Он пригоден для
 * ПЕРЕНОСА углерода через FluxLedger, но НЕ пригоден для
 * стехиометрически точного превращения: элементный аудит увидит
 * только C, а состав органики был бы выдуман. Явное правило —
 * константа; система типов «bookkeeping-вид» появится отдельным
 * этапом с собственным контрактом.
 */
export const GEOCHEMICAL_ORGANIC_CARBON_SPECIES_ID = 'c_org';

/**
 * Построить план геохимической реакции: проверить определение, среду
 * и стехиометрию, рассчитать вклады применяемой транзакции. План НЕ
 * изменяет ни резервуары, ни журнал. Стадии:
 *
 *  1. форма определения (validateGeochemicalReactionDefinition);
 *  2. форма входа (transactionId, extent, provenance extent);
 *  3. особое правило c_org (bookkeeping-вид не превращается);
 *  4. candidate-запись (validateReactionRecord, включая
 *     геохимический контекст);
 *  5. стехиометрия (auditReactionStoichiometry): для реального
 *     применения требуется РОВНО 'balanced'; invalid/imbalanced/
 *     not_verifiable/approximate физическое применение не дают;
 *  6. вклады только НОВОЙ транзакции (reactionInventoryDeltas по
 *     одиночной записи: повторного применения всей истории журнала
 *     к уже обновлённым запасам нет);
 *  7. среда: существование каждого reservoirId, известность каждого
 *     speciesId в каталоге, наличие материального инвентаря с
 *     совместимым основанием во всех затронутых резервуарах.
 */
export function planGeochemicalReaction(
  definition: GeochemicalReactionDefinition,
  env: GeochemicalReactionExecutionEnvironment,
  input: GeochemicalReactionExecutionInput
): GeochemicalReactionPlanResult {
  const reactionIdOf = isPlainRecord(definition) && typeof definition.reactionId === 'string' ? definition.reactionId : null;

  // 1. Форма определения.
  const definitionIssues = validateGeochemicalReactionDefinition(definition);
  if (definitionIssues.length > 0) {
    return {
      status: 'blocked',
      reasonKind: 'not_executable',
      reactionId: reactionIdOf,
      reason: 'определение реакции не проходит runtime-валидацию (стехиометрия не может выводиться из названий или описаний)',
      issues: definitionIssues
    };
  }
  const reactionId = definition.reactionId;

  // 2. Форма входа.
  const inputIssues: string[] = [];
  const raw = input as unknown as Record<string, unknown> | undefined;
  if (!isPlainRecord(input)) {
    inputIssues.push('вход исполнения должен быть объектом-записью (plain record)');
  } else {
    if (typeof raw.transactionId !== 'string' || raw.transactionId.trim() === '') {
      inputIssues.push('transactionId должен быть непустой строкой');
    }
    if (typeof raw.extentMolPerM2 !== 'number' || !Number.isFinite(raw.extentMolPerM2) || raw.extentMolPerM2 <= 0) {
      inputIssues.push('extentMolPerM2 должен быть конечным положительным числом (степень протекания mol/m²); неизвестный extent не заменяется нулём и не угадывается, получено ' + String(raw.extentMolPerM2));
    }
    const p = raw.extentProvenance;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) {
      inputIssues.push('extentProvenance обязателен (DataProvenance с идентифицированным источником: откуда известно значение extent)');
    } else {
      const pp = p as Record<string, unknown>;
      const identified =
        (typeof pp.sourceName === 'string' && pp.sourceName.trim() !== '') ||
        (typeof pp.sourceId === 'string' && pp.sourceId.trim() !== '') ||
        (typeof pp.datasetId === 'string' && pp.datasetId.trim() !== '') ||
        (typeof pp.reference === 'string' && pp.reference.trim() !== '');
      if (!identified) {
        inputIssues.push('extentProvenance должен идентифицировать источник (sourceName, sourceId, datasetId или reference)');
      }
    }
  }
  if (inputIssues.length > 0) {
    return {
      status: 'blocked',
      reasonKind: typeof raw.extentMolPerM2 === 'number' && !Number.isFinite(raw.extentMolPerM2) ? 'not_verifiable' : 'not_executable',
      reactionId,
      reason: 'вход исполнения не проходит валидацию: extent должен быть известной завершённой величиной с происхождением',
      issues: inputIssues
    };
  }

  // 3. Особое правило c_org: bookkeeping-вид («моли атомов C в
  // органическом пуле», H/O не заданы) не участвует в стехиометрически
  // точных превращениях: перенос углерода — через FluxLedger, а
  // «окисление органики» требует явного состава окисляемого вещества.
  // Аудит при этом видел бы баланс только по C и мог бы дать ложный
  // balanced — правило стоит ДО стехиометрии.
  const organicParticipants = [...definition.reactants, ...definition.products].filter(
    (p) => p.speciesId === GEOCHEMICAL_ORGANIC_CARBON_SPECIES_ID
  );
  if (organicParticipants.length > 0) {
    return {
      status: 'blocked',
      reasonKind: 'out_of_applicability',
      reactionId,
      reason:
        'вид «c_org» — bookkeeping-компонент (моли атомов углерода в органическом пуле): содержание H и O органического вещества не задано, стехиометрически точное превращение/окисление органики не выполняется и не притворяется переносом атомов C; перенос углерода — через FluxLedger, реакции с явным составом органики — отдельный этап',
      issues: organicParticipants.map((p) => 'участник «c_org» (резервуар «' + p.reservoirId + '») не может участвовать в стехиометрически точной реакции при неизвестном H/O составе пула')
    };
  }

  // 4. Геохимический контекст атрибуции и candidate-запись.
  const context: GeochemicalReactionContext = {
    contextSchemaVersion: GEOCHEMICAL_REACTION_CONTEXT_SCHEMA_VERSION,
    processId: definition.processId,
    reactionId: definition.reactionId,
    mechanism: GEOCHEMICAL_REACTION_MECHANISM,
    extentMolPerM2: input.extentMolPerM2,
    extentUnit: GEOCHEMICAL_REACTION_EXTENT_UNIT,
    extentBasis: GEOCHEMICAL_REACTION_EXTENT_BASIS,
    extentProvenance: input.extentProvenance,
    definitionProvenance: definition.definitionProvenance,
    time: input.time !== undefined ? input.time : null,
    assumptions: definition.assumptions !== undefined ? [...definition.assumptions] : [],
    applicability: definition.applicability !== undefined ? definition.applicability : null,
    limitations:
      definition.limitations !== undefined
        ? definition.limitations
        : 'степень протекания задана явно; исполнение НЕ утверждает кинетику, равновесие или скорость реакции'
  };
  const candidate: ReactionRecord = {
    id: input.transactionId,
    reactionId: definition.reactionId,
    reactants: definition.reactants.map((p) => ({ ...p })),
    products: definition.products.map((p) => ({ ...p })),
    extent: input.extentMolPerM2,
    extentBasis: definition.extentBasis,
    time: input.time !== undefined ? input.time : null,
    processId: definition.processId,
    ...(input.note !== undefined ? { note: input.note } : {}),
    geochemical: context
  };
  const recordIssues = validateReactionRecord(candidate);
  if (recordIssues.length > 0) {
    return {
      status: 'blocked',
      reasonKind: 'not_executable',
      reactionId,
      reason: 'кандидат записи не проходит валидацию формы ReactionRecord (включая геохимический контекст)',
      issues: recordIssues
    };
  }

  // 5. Стехиометрический аудит: только 'balanced' применим физически.
  const audit = auditReactionStoichiometry(candidate, env.speciesCatalog);
  if (audit.status !== 'balanced') {
    const reasonByStatus: Record<string, { kind: GeochemicalReactionBlockKind; reason: string }> = {
      invalid: { kind: 'not_executable', reason: 'запись не проходит валидацию формы: стехиометрическая проверка невозможна' },
      imbalanced: { kind: 'not_executable', reason: 'элементный/зарядовый баланс нарушен: реакция с некорректной стехиометрией не применяется' },
      not_verifiable: { kind: 'not_verifiable', reason: 'элементный/зарядовый баланс непроверяем (вид вне каталога или состав непроверяем): проверка не превращается в успешное применение' },
      approximate: { kind: 'not_executable', reason: 'баланс подтверждён только по оценочному составу (dataStatus estimated): подтверждённой стехиометрии нет' }
    };
    const blocked = reasonByStatus[audit.status] ?? { kind: 'not_verifiable' as GeochemicalReactionBlockKind, reason: 'стехиометрический статус не подтверждает баланс' };
    const issues = [...audit.formIssues, ...audit.elementIssues, ...audit.chargeIssues];
    if (audit.missingSpecies.length > 0) issues.push('виды вне каталога: ' + audit.missingSpecies.join(', '));
    if (audit.unprovenSpecies.length > 0) issues.push('состав непроверяем: ' + audit.unprovenSpecies.join(', '));
    if (audit.estimatedSpecies.length > 0) issues.push('состав оценочный: ' + audit.estimatedSpecies.join(', '));
    return {
      status: 'blocked',
      reasonKind: blocked.kind,
      reactionId,
      reason: blocked.reason,
      issues
    };
  }

  // 6. Вклады ТОЛЬКО применяемой транзакции: полная история журнала
  // повторно к инвентарям не применяется (двойной учёт исключён
  // дизайном: инвентари уже содержат результат прошлых транзакций).
  const candidateDeltas = reactionInventoryDeltas({ records: [candidate] });
  if (candidateDeltas.formIssues.length > 0) {
    return {
      status: 'blocked',
      reasonKind: 'not_executable',
      reactionId,
      reason: 'кандидат не проходит валидацию журнала при расчёте вкладов',
      issues: [...candidateDeltas.formIssues]
    };
  }
  if (candidateDeltas.unverifiableIssues.length > 0) {
    return {
      status: 'blocked',
      reasonKind: 'not_verifiable',
      reactionId,
      reason: 'вклады транзакции непредставимы (переполнение произведения или смешение оснований): не подменяются нулём',
      issues: [...candidateDeltas.unverifiableIssues]
    };
  }

  // 7. Среда: резервуары, виды, инвентари, основания.
  const environmentIssues: string[] = [];
  for (const contribution of candidateDeltas.contributions) {
    if (!env.speciesCatalog.has(contribution.speciesId)) {
      environmentIssues.push('вид «' + contribution.speciesId + '» отсутствует в SpeciesCatalog: исполнение без известного вида невозможно');
    }
    const reservoir = env.reservoirs[contribution.reservoirId];
    if (reservoir === undefined) {
      environmentIssues.push('резервуар «' + contribution.reservoirId + '» отсутствует в среде: инвентарь не создаётся молча');
      continue;
    }
    if (!reservoir.material) {
      environmentIssues.push('резервуар «' + contribution.reservoirId + '» не содержит материального инвентаря: задайте его явно (setMaterialInventory)');
      continue;
    }
    if (reservoir.material.basis !== definition.extentBasis) {
      environmentIssues.push('резервуар «' + contribution.reservoirId + '» хранит инвентарь в основании «' + reservoir.material.basis + '», а extent транзакции — в «' + definition.extentBasis + '»: основания не смешиваются, пересчёт без данных не выполняется');
    }
  }
  if (environmentIssues.length > 0) {
    return {
      status: 'blocked',
      reasonKind: 'not_executable',
      reactionId,
      reason: 'среда исполнения неполна (вид/резервуар/инвентарь/основание)',
      issues: environmentIssues
    };
  }

  return {
    status: 'ready',
    reactionId,
    processId: definition.processId,
    record: candidate,
    deltas: candidateDeltas,
    diagnostics: [...audit.diagnostics, 'стехиометрия подтверждена (balanced): вклады рассчитаны по коэффициентам × extent новой транзакции']
  };
}

/**
 * Атомарно применить геохимическую реакцию: план → иммутабельные
 * обновления инвентарей → registerReaction → проверка результирующего
 * журнала. При ЛЮБОЙ ошибке — not_applied с диагностикой; все входные
 * объекты остаются нетронутыми даже при частичном отказе (все
 * изменения сначала строятся на копиях, исходные объекты в процесс
 * попадают только чтением).
 */
export function executeGeochemicalReaction(
  definition: GeochemicalReactionDefinition,
  env: GeochemicalReactionExecutionEnvironment,
  input: GeochemicalReactionExecutionInput
): GeochemicalReactionExecutionResult {
  let plan: GeochemicalReactionPlanResult;
  try {
    plan = planGeochemicalReaction(definition, env, input);
  } catch (error) {
    return {
      status: 'not_applied',
      reasonKind: 'not_executable',
      reactionId: isPlainRecord(definition) && typeof definition.reactionId === 'string' ? definition.reactionId : null,
      reason: 'планирование завершилось необработанной ошибкой: атомарность сохранена, состояние не изменено',
      issues: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
  if (plan.status !== 'ready') {
    return {
      status: 'not_applied',
      reasonKind: plan.reasonKind,
      reactionId: plan.reactionId,
      reason: plan.reason,
      issues: [...plan.issues],
      error: null
    };
  }

  try {
    // --- локальные кандидаты изменений (исходные объекты не трогаются) ---
    const mutated = new Set<string>();
    let work: Record<string, ReservoirRecord> = { ...env.reservoirs };
    for (const contribution of plan.deltas.contributions) {
      if (contribution.delta === 0) {
        // нетто-нулевой вклад (катализатор): применение пропускается,
        // чтобы не создавать/удалять ключи инвентаря без пользы
        continue;
      }
      const reservoir = work[contribution.reservoirId];
      const inventory = reservoir.material!;
      const current = inventory.entries[contribution.speciesId];
      if (contribution.delta < 0) {
        // Реагент: количество должно быть ИЗВЕСТНО и достаточно.
        // Отсутствующий ключ — неизвестное количество (не ноль): риск
        // изъять из неизвестности приравниванием к нулю не принимается.
        if (current === undefined) {
          return {
            status: 'not_applied',
            reasonKind: 'not_verifiable',
            reactionId: plan.reactionId,
            reason: 'исходное количество реагента НЕИЗВЕСТНО (записи вида нет в инвентаре): неизвестное количество не считается нулём, транзакция не применяется',
            issues: ['резервуар «' + contribution.reservoirId + '», вид «' + contribution.speciesId + '»: записи нет в инвентаре — достаточность недоказуема'],
            error: null
          };
        }
        const required = -contribution.delta;
        if (current < required) {
          return {
            status: 'not_applied',
            reasonKind: 'not_executable',
            reactionId: plan.reactionId,
            reason: 'недостаточно реагента: отрицательный запас ни при каких условиях не создаётся',
            issues: ['резервуар «' + contribution.reservoirId + '», вид «' + contribution.speciesId + '»: есть ' + String(current) + ', требуется ' + String(required)],
            error: null
          };
        }
        work[contribution.reservoirId] = removeMaterial(reservoir, contribution.speciesId, required);
      } else {
        // Продукт: прибавляется известным количеством (дельта известна
        // точно); новый ключ инвентаря создаётся как известный запас.
        const sum = (current === undefined ? 0 : current) + contribution.delta;
        if (!Number.isFinite(sum)) {
          return {
            status: 'not_applied',
            reasonKind: 'not_verifiable',
            reactionId: plan.reactionId,
            reason: 'накопленный запас непредставим (переполнение суммы при добавлении дельты): не подменяется насыщением/бесконечностью',
            issues: ['резервуар «' + contribution.reservoirId + '», вид «' + contribution.speciesId + '»: ' + String(current === undefined ? 0 : current) + ' + ' + String(contribution.delta) + ' не представимо'],
            error: null
          };
        }
        work[contribution.reservoirId] = addMaterial(reservoir, contribution.speciesId, contribution.delta);
      }
      mutated.add(contribution.reservoirId);
    }

    // --- проверка целостности кандидатов: хвалённая runtime-валидация ядра ---
    const validationIssues: string[] = [];
    for (const id of mutated) {
      const res = work[id]!;
      const inventoryCheck = validateMaterialInventory(res.material!);
      if (!inventoryCheck.valid) {
        validationIssues.push('резервуар «' + id + '»: инвентарь не прошли каноническую валидацию: ' + inventoryCheck.errors.join('; '));
      }
      const recordCheck = validateReservoirRecord(res);
      if (!recordCheck.valid) {
        validationIssues.push('резервуар «' + id + '»: не прошёл валидацию ReservoirRecord: ' + recordCheck.errors.join('; '));
      }
    }
    if (validationIssues.length > 0) {
      return {
        status: 'not_applied',
        reasonKind: 'not_executable',
        reactionId: plan.reactionId,
        reason: 'кандидаты изменений резервуаров не прошли каноническую валидацию: применение откачено (входные объекты не изменялись)',
        issues: validationIssues,
        error: null
      };
    }

    // --- регистрация транзакции штатным registerReaction ---
    const baseLedger = env.ledgerInput !== undefined ? env.ledgerInput : createReactionLedger();
    const baseLedgerIssues = validateReactionLedger(baseLedger);
    if (baseLedgerIssues.length > 0) {
      return {
        status: 'not_applied',
        reasonKind: 'not_executable',
        reactionId: plan.reactionId,
        reason: 'базовый журнал не валиден: регистрация невозможна',
        issues: baseLedgerIssues,
        error: null
      };
    }
    const registered = registerReaction(baseLedger, plan.record);
    const resultingIssues = validateReactionLedger(registered);
    if (resultingIssues.length > 0) {
      return {
        status: 'not_applied',
        reasonKind: 'not_executable',
        reactionId: plan.reactionId,
        reason: 'результирующий журнал не валиден: регистрация откачена (входной журнал не изменялся)',
        issues: resultingIssues,
        error: null
      };
    }

    return {
      status: 'applied',
      reactionId: plan.reactionId,
      processId: plan.processId,
      transactionId: plan.record.id,
      record: registered.records[registered.records.length - 1]!,
      ledger: registered,
      reservoirs: work,
      deltas: plan.deltas,
      diagnostics: plan.diagnostics
    };
  } catch (error) {
    // Любая исключительная ситуация: состояние входа не изменено
    // (все операции выше — иммутабельные конструкторы).
    return {
      status: 'not_applied',
      reasonKind: 'not_executable',
      reactionId: plan.reactionId,
      reason: 'исполнение прервано структурированной ошибкой ядра: входные объекты не изменены',
      issues: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ============================================
// 5. СОПРЯЖЁННЫЕ ПРОЦЕССЫ (coupled) — КОНТРАКТ БУДУЩЕГО ЭТАПА
// ============================================
//
// Атомарная coupled-транзакция («реакция + перенос» в ОДНОЙ атомарной
// операции) в этом этапе НЕ реализована и НЕ заявляется: нельзя
// объявлять атомарность coupled-процесса, если проверена атомарность
// только одиночной реакции. Ниже — типизированный КОНТРАКТ будущей
// атомарной транзакции; API исполнения для coupled остаётся
// неисполнимым: executeGeochemicalProcess продолжает возвращать
// not_applied для coupled-процессов (см. geochemicalFluxes), и
// имитировать coupled двумя независимыми успешными вызовами
// (executeGeochemicalReaction + executeGeochemicalProcess) ЗАПРЕЩЕНО.
//
// Контракт (обязательства будущего исполнителя coupled):
// - один общий transactionId на ВСЕ составляющие операции;
// - один общий временной интервал (единый time);
// - единая проверка исходных и конечных инвентарей (обе стороны
//   перехода строятся на одном снимке состояния);
// - общий rollback: любая ошибка любой составляющей отменяет ВСЮ
//   транзакцию без следов в журналах и инвентарях.

/**
 * Объявление (только тип-контракт, НЕ исполнимый API) будущей
 * атомарной coupled-транзакции: правая часть исполняется единым
 * оператором, который НЕ может быть сведён к независимым вызовам
 * executeGeochemicalReaction/executeGeochemicalProcess.
 */
export interface GeochemicalCoupledTransactionContract {
  /** Общий идентификатор атомарной coupled-транзакции. */
  readonly transactionId: string;
  /** Процесс каталога (mechanism 'coupled'). */
  readonly processId: string;
  /** Единый временной интервал либо null (не привязана). */
  readonly time: FluxTime | null;
  /** Идентификаторы сбалансированных реакций (ReactionRecord.id) в составе транзакции. */
  readonly reactionTransactionIds: readonly string[];
  /** Идентификаторы переносов (FluxRecord.id) в составе транзакции. */
  readonly fluxTransactionIds: readonly string[];
  /** Явная атомарность: единая проверка исходных/конечных инвентарей и общий rollback. */
  readonly atomicity: 'single_snapshot_and_rollback';
}
