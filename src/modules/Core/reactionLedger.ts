// ============================================
// REACTION LEDGER - Журнал реакционных транзакций
// ============================================
//
// Stage 4.2.3.2. Типизированный учёт многокомпонентных химических
// превращений и независимая стехиометрическая проверка записи.
//
// Превращение ≠ перенос (см. fluxLedger.ts):
// - FluxLedger остаётся журналом ПЕРЕНОСОВ (internal_transfer,
//   external_input, external_output); один FluxRecord — один субъект
//   (вещество или энергия); его семантика и API НЕ изменяются;
// - химическая реакция одновременно расходует несколько реагентов
//   и производит несколько продуктов; изображать её набором
//   независимых FluxRecord или маскировать превращение под внешний
//   поток нельзя — для этого существует ReactionLedger.
//
// Границы этапа 4.2.3.2 (интеграция НЕ выполнена и не объявляется):
// - ReactionLedger НЕ входит в CoreWorldState и пока не сохраняется;
// - Scheduler и InvariantAuditor его НЕ используют;
// - записи — журнал ЗАВЕРШЁННЫХ транзакций: статусов pending/applied
//   нет; ledger сам НЕ применяет реакцию к инвентарям резервуаров
//   (физическое изменение инвентарей — задача оператора процесса,
//   следующие этапы интеграции);
// - кинетика, решатели и реестр определений реакций НЕ реализованы:
//   reactionId — ссылка-строка, отдельного реестра пока нет;
// - пересчёта в массу/концентрацию/долю НЕ выполняется: молярная
//   масса, объём, площадь, плотность не выдумываются; основание
//   степени протекания задаётся полем extentBasis явно.
//
// Стехиометрический аудит (auditReactionStoichiometry) проверяет
// алгебраическое сохранение явно заданного состава и заряда по
// числу частиц: коэффициент — число частиц в уравнении, extent
// масштаб не меняет. Состав вида — словарь ПРОИЗВОЛЬНЫХ
// идентификаторов компонентов (не только реальная периодическая
// таблица): вымышленный компонент с явно объявленным составом
// (например ux:element_x) имеет точно проверяемый алгебраический
// баланс; реалистичность сущности и математическая сохранность
// заданного состава — независимые характеристики.
//
// Корректирующая ревизия Stage 4.2.3.2.1 (узкие дефекты реализации,
// БЕЗ расширения до Scheduler-интеграции):
// - time — ОБЯЗАТЕЛЬНОЕ поле: null | FluxTime; отсутствующее поле
//   (undefined) — invalid: registerReaction не превращает его в
//   отсутствующий ключ через object spread;
// - накопление состава — Map + Object.fromEntries: произвольные
//   идентификаторы компонентов ('constructor', 'toString',
//   'hasOwnProperty', '__proto__') — обычные ключи данных без
//   чтения/изменения свойств прототипа; компонент не исчезает из
//   отчёта и не даёт ложный balanced;
// - форма состава — только объектная запись (plain record, в т.ч.
//   с прототипом null): Map/Set/Date/RegExp/массив/экземпляр класса
//   → not_verifiable (Object.entries по ним молча пуст — состав не
//   считается известным пустым); численную пригодность подтверждают
//   только dataStatus 'known' | 'estimated';
// - NaN/Infinity в промежуточных итогах (переполнение произведения
//   или накопления при конечных входных числах) → not_verifiable с
//   диагностикой: NaN не трактуется как отсутствие расхождения;
// - tolerance — конечное неотрицательное число; NaN/±Infinity/
//   отрицательное → контролируемый invalid (единая политика для
//   аудита записи и журнала);
// - note, если задан, — непустая строка; пара (reservoirId,
//   speciesId) сравнивается однозначно через JSON.stringify —
//   конкатенация с пробелом допускала коллизии ('r x'+'y' против
//   'r'+'x y').

import type { ConservationStatus, FluxTime } from './fluxLedger';
import type { ScientificSpecies, SpeciesCatalog } from './species';

// ============================================
// 1. ТИПЫ
// ============================================

/** Основание степени протекания реакции. */
export type ReactionExtentBasis = 'amount' | 'column_amount';

/** Допустимые основания степени протекания. */
export const REACTION_EXTENT_BASES: readonly ReactionExtentBasis[] = ['amount', 'column_amount'];

/**
 * Один компонент реакции (реагент или продукт). Резервуар
 * указывается явно: реакция между компонентами разных резервуаров
 * и фаз описывается без изменения формата записи.
 */
export interface ReactionParticipant {
  /** Резервуар, в котором находится компонент. */
  reservoirId: string;
  /** Вид компонента. */
  speciesId: string;
  /**
   * Стехиометрический коэффициент: положительное конечное число,
   * целое ИЛИ рациональное (формульный парсер не вводится).
   * Коэффициент — число частиц в стехиометрическом уравнении,
   * а НЕ количество вещества: фактический масштаб задаёт extent.
   */
  coefficient: number;
}

/**
 * Одна завершённая реакционная транзакция. Ledger не применяет её
 * к инвентарям: физическое изменение резервуаров выполняет
 * оператор процесса (следующие этапы интеграции).
 */
export interface ReactionRecord {
  /** Уникальный id транзакции. */
  id: string;
  /** Ссылка на определение реакции (реестра определений пока нет). */
  reactionId: string;
  /** Расходуемые компоненты; минимум один. */
  reactants: ReactionParticipant[];
  /** Производимые компоненты; минимум один. */
  products: ReactionParticipant[];
  /**
   * Степень протекания: положительное конечное число. Нулевой или
   * неопределённый extent не регистрируется (реакция не произошла).
   */
  extent: number;
  /** Основание степени протекания. */
  extentBasis: ReactionExtentBasis;
  /** Момент привязки (как у FluxRecord); null — не привязан. */
  time: FluxTime | null;
  /** Необязательная ссылка на процесс Scheduler. */
  processId?: string;
  note?: string;
}

/** Журнал реакционных транзакций — сериализуемые данные, без методов. */
export interface ReactionLedger {
  records: ReactionRecord[];
}

// ============================================
// 2. ОШИБКИ
// ============================================

export class ReactionLedgerError extends Error {
  readonly code: 'invalid_reaction' | 'duplicate_reaction_id';
  readonly component = 'ReactionLedger';
  recordId: string | null;

  constructor(code: 'invalid_reaction' | 'duplicate_reaction_id', message: string, recordId: string | null) {
    super('[ReactionLedger] ' + message);
    this.name = 'ReactionLedgerError';
    this.code = code;
    this.recordId = recordId;
  }
}

// ============================================
// 3. ВАЛИДАЦИЯ
// ============================================

/**
 * Валидация одной записи реакции (unknown на входе — можно подавать
 * данные из сохранений). Возвращает список проблем (пустой = запись
 * корректна). Правила:
 * - id и reactionId — непустые строки;
 * - reactants и products — непустые массивы;
 * - участник: reservoirId и speciesId непусты; коэффициент —
 *   конечное положительное число; пара (reservoirId, speciesId) не
 *   повторяется на одной стороне — такие коэффициенты должны быть
 *   объединены заранее;
 * - один и тот же вид может быть и слева, и справа (катализатор);
 * - один и тот же вид в разных резервуарах допустим;
 * - extent — конечное положительное число;
 * - extentBasis — 'amount' | 'column_amount';
 * - time — ОБЯЗАТЕЛЬНОЕ поле: null или корректная метка FluxTime;
 *   отсутствующее поле (undefined) недопустимо;
 * - processId и note, если заданы, — непустые строки.
 */
export function validateReactionRecord(record: unknown): string[] {
  const problems: string[] = [];
  if (typeof record !== 'object' || record === null) {
    return ['запись реакции должна быть объектом'];
  }
  const r = record as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.trim() === '') {
    problems.push('id транзакции должен быть непустой строкой');
  }
  if (typeof r.reactionId !== 'string' || r.reactionId.trim() === '') {
    problems.push('reactionId должен быть непустой строкой');
  }
  validateSide(r.reactants, 'reactants', problems);
  validateSide(r.products, 'products', problems);
  if (typeof r.extent !== 'number' || !Number.isFinite(r.extent) || r.extent <= 0) {
    problems.push('extent должен быть конечным положительным числом, получено ' + String(r.extent));
  }
  if (typeof r.extentBasis !== 'string' || !(REACTION_EXTENT_BASES as readonly string[]).includes(r.extentBasis)) {
    problems.push('extentBasis должен быть одним из ' + REACTION_EXTENT_BASES.join(' | ') + ', получено «' + String(r.extentBasis) + '»');
  }
  if (r.time === undefined) {
    problems.push('time обязателен: null или корректная метка FluxTime — отсутствующее поле недопустимо');
  } else if (r.time !== null) {
    if (typeof r.time !== 'object') {
      problems.push('time должен быть объектом FluxTime или null');
    } else {
      const t = r.time as Record<string, unknown>;
      if (typeof t.segmentIndex !== 'number' || !Number.isInteger(t.segmentIndex) || t.segmentIndex < 0) {
        problems.push('time.segmentIndex должен быть неотрицательным целым числом');
      }
      if (typeof t.localTimeS !== 'number' || !Number.isFinite(t.localTimeS) || t.localTimeS < 0) {
        problems.push('time.localTimeS должен быть неотрицательным конечным числом');
      }
    }
  }
  if (r.processId !== undefined && (typeof r.processId !== 'string' || r.processId.trim() === '')) {
    problems.push('processId, если задан, должен быть непустой строкой');
  }
  if (r.note !== undefined && (typeof r.note !== 'string' || r.note.trim() === '')) {
    problems.push('note, если задан, должен быть непустой строкой');
  }
  return problems;
}

/**
 * Валидация одной стороны записи: непустой массив участников с
 * корректными полями и без повторов пары (reservoirId, speciesId).
 */
function validateSide(value: unknown, side: 'reactants' | 'products', problems: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    problems.push(side + ' должен быть непустым массивом участников');
    return;
  }
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      problems.push(side + '[' + index + '] должен быть объектом');
      return;
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.reservoirId !== 'string' || p.reservoirId.trim() === '') {
      problems.push(side + '[' + index + ']: reservoirId должен быть непустой строкой');
    }
    if (typeof p.speciesId !== 'string' || p.speciesId.trim() === '') {
      problems.push(side + '[' + index + ']: speciesId должен быть непустой строкой');
    }
    if (typeof p.coefficient !== 'number' || !Number.isFinite(p.coefficient) || p.coefficient <= 0) {
      problems.push(side + '[' + index + ']: коэффициент должен быть конечным положительным числом, получено ' + String(p.coefficient));
    }
    if (typeof p.reservoirId === 'string' && p.reservoirId.trim() !== '' && typeof p.speciesId === 'string' && p.speciesId.trim() !== '') {
      // Однозначное кодирование пары: конкатенация с пробелом
      // допускала коллизии ('r x' + 'y' против 'r' + 'x y').
      const key = JSON.stringify([p.reservoirId, p.speciesId]);
      if (seen.has(key)) {
        problems.push(side + ': пара резервуар «' + p.reservoirId + '» + вид «' + p.speciesId + '» встречается дважды — коэффициенты должны быть объединены заранее');
      } else {
        seen.add(key);
      }
    }
  });
}

/**
 * Валидация журнала реакций: форма журнала и каждой записи,
 * уникальность id транзакций и (при передаче reservoirIds) ссылки
 * участников на резервуары. Возвращает список проблем
 * (пустой = журнал корректен).
 */
export function validateReactionLedger(ledger: unknown, opts?: { reservoirIds?: readonly string[] }): string[] {
  const problems: string[] = [];
  if (typeof ledger !== 'object' || ledger === null) {
    return ['журнал реакций должен быть объектом с полем records'];
  }
  const rec = ledger as Record<string, unknown>;
  if (!Array.isArray(rec.records)) {
    return ['журнал реакций: поле records должно быть массивом'];
  }
  const seen = new Set<string>();
  const records = rec.records as unknown[];
  records.forEach((entry, index) => {
    const at = (message: string): string => 'запись #' + index + ': ' + message;
    for (const problem of validateReactionRecord(entry)) {
      problems.push(at(problem));
    }
    const r = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    if (r && typeof r.id === 'string' && r.id.trim() !== '') {
      if (seen.has(r.id)) {
        problems.push(at('дублирующийся id транзакции «' + r.id + '»'));
      } else {
        seen.add(r.id);
      }
    }
    const reservoirIds = opts?.reservoirIds;
    if (r && reservoirIds) {
      for (const side of ['reactants', 'products'] as const) {
        const participants = r[side];
        if (Array.isArray(participants)) {
          participants.forEach((p) => {
            if (typeof p === 'object' && p !== null) {
              const reservoirId = (p as Record<string, unknown>).reservoirId;
              if (typeof reservoirId === 'string' && !reservoirIds.includes(reservoirId)) {
                problems.push(at('ссылка на несуществующий резервуар «' + reservoirId + '»'));
              }
            }
          });
        }
      }
    }
  });
  return problems;
}

// ============================================
// 4. СОЗДАНИЕ И РЕГИСТРАЦИЯ
// ============================================

/** Пустой журнал реакций. */
export function createReactionLedger(): ReactionLedger {
  return { records: [] };
}

/**
 * Регистрация завершённой реакционной транзакции. Возвращает НОВЫЙ
 * журнал; исходный не мутируется. Запись сохраняется копией
 * (участники и метка времени), чтобы последующие изменения объекта
 * вызывающей стороны не искажали журнал. Дублирующийся id — ошибка
 * duplicate_reaction_id; некорректная форма — invalid_reaction.
 * Регистрация — чистая операция учёта: инвентари резервуаров
 * ledger НЕ изменяет.
 */
export function registerReaction(ledger: ReactionLedger, record: ReactionRecord): ReactionLedger {
  const problems = validateReactionRecord(record);
  const raw = record as unknown as Record<string, unknown> | null;
  const recordId = typeof raw === 'object' && raw !== null && typeof raw.id === 'string' ? raw.id : null;
  if (problems.length > 0) {
    const prefix = recordId === null ? 'запись реакции' : 'реакция «' + recordId + '»';
    throw new ReactionLedgerError('invalid_reaction', prefix + ' не проходит валидацию: ' + problems.join('; '), recordId);
  }
  if (ledger.records.some((r) => r.id === record.id)) {
    throw new ReactionLedgerError('duplicate_reaction_id', 'реакция «' + record.id + '» уже зарегистрирована', record.id);
  }
  const stored: ReactionRecord = {
    ...record,
    reactants: record.reactants.map((p) => ({ ...p })),
    products: record.products.map((p) => ({ ...p })),
    time: record.time === null ? null : { ...record.time }
  };
  return { records: [...ledger.records, stored] };
}

// ============================================
// 5. СТЕХИОМЕТРИЧЕСКИЙ АУДИТ
// ============================================

/** Политика tolerance, согласованная с Core-аудитами (fluxLedger). */
export const DEFAULT_REACTION_AUDIT_TOLERANCE = 1e-9;

/**
 * Единая политика tolerance для аудита записи и журнала: конечное
 * неотрицательное число. NaN, +Infinity, -Infinity и отрицательные
 * значения — контролируемый invalid (некорректный tolerance не
 * может привести к ложному balanced). Отсутствие значения —
 * политика по умолчанию DEFAULT_REACTION_AUDIT_TOLERANCE.
 */
function resolveAuditTolerance(value: number | undefined): { tolerance: number; problem: string | null } {
  if (value === undefined) {
    return { tolerance: DEFAULT_REACTION_AUDIT_TOLERANCE, problem: null };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return { tolerance: DEFAULT_REACTION_AUDIT_TOLERANCE, problem: 'tolerance должен быть конечным неотрицательным числом, получено ' + String(value) };
  }
  return { tolerance: value, problem: null };
}

/**
 * Статус проверки записи: различимые исходы, НЕ один boolean.
 * 'invalid' — запись не проходит валидацию формы (проверка состава
 * невозможна); остальные — существующая система ConservationStatus.
 */
export type ReactionStoichiometryStatus = ConservationStatus | 'invalid';

/** Результат стехиометрической проверки одной записи. */
export interface ReactionStoichiometryAudit {
  status: ReactionStoichiometryStatus;
  /** Структурные проблемы записи (status invalid). */
  formIssues: string[];
  /** Элементные расхождения слева/справа. */
  elementIssues: string[];
  /** Зарядовые расхождения слева/справа. */
  chargeIssues: string[];
  /** Виды, отсутствующие в каталоге: вклад неизвестен (НЕ нулевой состав). */
  missingSpecies: string[];
  /** Виды с непроверяемым описанием состава (dataStatus unknown/not_implemented/invalid/not_applicable или недопустимая форма состава). */
  unprovenSpecies: string[];
  /** Виды с оценочным описанием (dataStatus estimated): проверяемо численно, итог approximate. */
  estimatedSpecies: string[];
  /** Суммарный состав сторон по проверяемым видам (частичные данные при not_verifiable). */
  reactantElements: Record<string, number>;
  productElements: Record<string, number>;
  /** Суммарный заряд сторон по проверяемым видам. */
  reactantCharge: number;
  productCharge: number;
  /** Пояснения всех отличий от balanced. */
  diagnostics: string[];
}

/**
 * Проверка элементного и зарядового баланса одной реакции по
 * стехиометрическим коэффициентам (число частиц; extent масштаб не
 * меняет и в этой проверке не участвует, но валидируется формой).
 *
 * elementBalanceCheck() из species.ts здесь НЕ используется: его
 * boolean не различает реальный дисбаланс и непроверяемость.
 *
 * Правила честности:
 * - вид отсутствует в каталоге → not_verifiable: вклад неизвестен,
 *   а не нулевой состав;
 * - dataStatus 'unknown'/'not_implemented'/'invalid'/'not_applicable'
 *   или недопустимая форма состава → not_verifiable: пустые elements
 *   НЕ являются доказательством отсутствия атомов;
 * - при неполном наборе проверяемых видов расхождения известной
 *   части вычисляются и сохраняются как частичные диагностические
 *   данные, но статус — not_verifiable, не imbalanced: неизвестный
 *   участник может изменить результат;
 * - численное нарушение среди проверяемых видов → imbalanced;
 * - dataStatus 'estimated' при численно согласованном балансе →
 *   approximate;
 * - молярная масса не нужна: элементы и заряд считаются по числу
 *   частиц (сопоставление с массовым инвентарём — будущие этапы);
 * - NaN/Infinity в промежуточных итогах (переполнение произведения
 *   или накопления при конечных входных числах) → not_verifiable с
 *   диагностикой: NaN не трактуется как отсутствие расхождения;
 * - tolerance — конечное неотрицательное число; NaN, ±Infinity,
 *   отрицательное значение → invalid (единая политика с аудитом
 *   журнала).
 */
export function auditReactionStoichiometry(
  record: ReactionRecord,
  catalog: SpeciesCatalog,
  options?: { tolerance?: number }
): ReactionStoichiometryAudit {
  const { tolerance, problem: toleranceProblem } = resolveAuditTolerance(options?.tolerance);
  const audit: ReactionStoichiometryAudit = {
    status: 'not_verifiable',
    formIssues: [],
    elementIssues: [],
    chargeIssues: [],
    missingSpecies: [],
    unprovenSpecies: [],
    estimatedSpecies: [],
    reactantElements: {},
    productElements: {},
    reactantCharge: 0,
    productCharge: 0,
    diagnostics: []
  };

  if (toleranceProblem !== null) {
    audit.status = 'invalid';
    audit.formIssues.push(toleranceProblem);
    audit.diagnostics.push('некорректный tolerance: ' + toleranceProblem);
    return audit;
  }

  const formIssues = validateReactionRecord(record);
  if (formIssues.length > 0) {
    audit.status = 'invalid';
    audit.formIssues = formIssues;
    audit.diagnostics.push('запись не проходит валидацию формы: ' + formIssues.join('; '));
    return audit;
  }

  const side = (participants: ReactionParticipant[]): {
    elements: Record<string, number>;
    charge: number;
    missing: string[];
    unproven: string[];
    estimated: string[];
    nonFinite: boolean;
  } => {
    const counts = new Map<string, number>();
    for (const p of participants) {
      counts.set(p.speciesId, (counts.get(p.speciesId) ?? 0) + p.coefficient);
    }
    // Сумма коэффициентов одного вида из разных резервуаров может
    // переполниться при конечных слагаемых — конечность входных чисел
    // не гарантирует конечности результатов.
    let nonFinite = false;
    for (const sum of counts.values()) {
      if (!Number.isFinite(sum)) {
        nonFinite = true;
      }
    }
    // Накопление состава — Map: произвольные идентификаторы
    // компонентов ('constructor', '__proto__' и т.п.) обрабатываются
    // как обычные ключи данных, без чтения/изменения прототипа.
    const elements = new Map<string, number>();
    let charge = 0;
    const missing: string[] = [];
    const unproven: string[] = [];
    const estimated: string[] = [];
    for (const [speciesId, coefficient] of counts) {
      const species = catalog.get(speciesId);
      if (species === null) {
        missing.push(speciesId);
        continue;
      }
      const composition = readProvenComposition(species);
      if (composition === null) {
        unproven.push(speciesId);
        continue;
      }
      if (species.dataStatus === 'estimated') {
        estimated.push(speciesId);
      }
      for (const [element, count] of Object.entries(composition)) {
        const product = count * coefficient;
        const total = (elements.get(element) ?? 0) + product;
        elements.set(element, total);
        if (!Number.isFinite(product) || !Number.isFinite(total)) {
          nonFinite = true;
        }
      }
      const chargePart = species.charge * coefficient;
      charge += chargePart;
      if (!Number.isFinite(chargePart) || !Number.isFinite(charge)) {
        nonFinite = true;
      }
    }
    return { elements: safeElementsRecord(elements), charge, missing, unproven, estimated, nonFinite };
  };

  const left = side(record.reactants);
  const right = side(record.products);

  audit.reactantElements = left.elements;
  audit.productElements = right.elements;
  audit.reactantCharge = left.charge;
  audit.productCharge = right.charge;
  audit.missingSpecies = dedupe([...left.missing, ...right.missing]);
  audit.unprovenSpecies = dedupe([...left.unproven, ...right.unproven]);
  audit.estimatedSpecies = dedupe([...left.estimated, ...right.estimated]);

  // Переполнение (NaN/Infinity в промежуточных итогах при конечных
  // входных числах): численная проверка невозможна. Обе стороны,
  // равные Infinity, НЕ считаются сбалансированными (Infinity -
  // Infinity = NaN не трактуется как отсутствие расхождения).
  if (left.nonFinite || right.nonFinite) {
    audit.status = 'not_verifiable';
    audit.diagnostics.push('численная проверка невозможна: в промежуточных итогах состава/заряда NaN или Infinity (переполнение произведения/суммирования при конечных входных числах) — проблема вычислимости, а не физического баланса');
    if (audit.missingSpecies.length > 0) {
      audit.diagnostics.push('вид(ы) не зарегистрированы в каталоге — вклад неизвестен: ' + audit.missingSpecies.join(', '));
    }
    if (audit.unprovenSpecies.length > 0) {
      audit.diagnostics.push('описание состава непроверяемо (статус данных или форма состава): ' + audit.unprovenSpecies.join(', '));
    }
    return audit;
  }

  // Частичные расхождения по проверяемым видам (диагностические данные).
  const elementKeys = new Set([...Object.keys(left.elements), ...Object.keys(right.elements)]);
  for (const element of elementKeys) {
    const a = left.elements[element] ?? 0;
    const b = right.elements[element] ?? 0;
    if (Math.abs(a - b) > tolerance) {
      audit.elementIssues.push('элемент «' + element + '»: ' + a + ' слева против ' + b + ' справа');
    }
  }
  if (Math.abs(left.charge - right.charge) > tolerance) {
    audit.chargeIssues.push('заряд: ' + left.charge + ' слева против ' + right.charge + ' справа');
  }

  if (audit.missingSpecies.length > 0) {
    audit.diagnostics.push('вид(ы) не зарегистрированы в каталоге — вклад неизвестен: ' + audit.missingSpecies.join(', '));
  }
  if (audit.unprovenSpecies.length > 0) {
    audit.diagnostics.push('описание состава непроверяемо (статус данных или форма состава): ' + audit.unprovenSpecies.join(', '));
  }

  if (audit.missingSpecies.length > 0 || audit.unprovenSpecies.length > 0) {
    audit.status = 'not_verifiable';
    if (audit.elementIssues.length > 0 || audit.chargeIssues.length > 0) {
      audit.diagnostics.push('расхождения вычислены только по видам с проверяемым составом: ' + [...audit.elementIssues, ...audit.chargeIssues].join('; '));
    }
    return audit;
  }
  if (audit.elementIssues.length > 0 || audit.chargeIssues.length > 0) {
    audit.status = 'imbalanced';
    audit.diagnostics.push(...audit.elementIssues, ...audit.chargeIssues);
    return audit;
  }
  if (audit.estimatedSpecies.length > 0) {
    audit.status = 'approximate';
    audit.diagnostics.push('баланс численно согласован, но состав оценочный (dataStatus estimated): ' + audit.estimatedSpecies.join(', '));
    return audit;
  }
  audit.status = 'balanced';
  return audit;
}

/**
 * Доказательный численно пригодный состав вида или null, если состав
 * непроверяем. Правила:
 * - численную пригодность подтверждают ТОЛЬКО dataStatus 'known' и
 *   'estimated'; 'unknown', 'not_implemented', 'invalid',
 *   'not_applicable' и любой непредусмотренный runtime-статус →
 *   null (неизвестный статус не считается известным);
 * - форма состава — ТОЛЬКО настоящая объектная запись (plain record),
 *   в том числе с прототипом null: Map, Set, Date, RegExp, массивы и
 *   экземпляры пользовательских классов НЕ являются составом —
 *   Object.entries по ним молча даёт пустоту, и состав «исчезал» бы
 *   из аудита; такие формы → null (not_verifiable), без исключений;
 * - пустая запись {} легитимна (например электрон): доказательность
 *   решает dataStatus, а не непустота;
 * - ключи — непустые строки, значения — неотрицательные целые числа;
 *   заряд — целое число.
 */
function readProvenComposition(species: ScientificSpecies): Record<string, number> | null {
  if (species.dataStatus !== 'known' && species.dataStatus !== 'estimated') {
    return null;
  }
  if (!Number.isInteger(species.charge)) {
    return null;
  }
  const raw: unknown = species.elements;
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  for (const [element, count] of Object.entries(raw)) {
    if (element.trim() === '' || !Number.isInteger(count) || count < 0) {
      return null;
    }
  }
  return raw as Record<string, number>;
}

/**
 * Публичный состав сторон — объектная запись, построенная БЕЗ
 * обращения к свойствам прототипа: Object.fromEntries создаёт
 * СОБСТВЕННЫЕ свойства данных, включая ключи '__proto__',
 * 'constructor', 'toString', 'hasOwnProperty' — они сохраняются
 * буквально, не читаются и не изменяются через прототип.
 */
function safeElementsRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(map);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// ============================================
// 6. АУДИТ ЖУРНАЛА
// ============================================

/** Результат проверки одной записи в составе журнала. */
export interface ReactionRecordAudit {
  recordId: string | null;
  status: ReactionStoichiometryStatus;
  issues: string[];
}

/** Итог аудита журнала реакций. */
export interface ReactionLedgerAudit {
  status: ReactionStoichiometryStatus;
  /** Структурные проблемы журнала/записей (validateReactionLedger). */
  formIssues: string[];
  recordAudits: readonly ReactionRecordAudit[];
  diagnostics: readonly string[];
}

/**
 * Аудит журнала: форма (validateReactionLedger, включая дубликаты id
 * и ссылки на резервуары при передаче reservoirIds) + стехиометрия
 * каждой записи. Агрегация (нарушение > непроверяемость >
 * приблизительность): структурные проблемы → invalid; иначе любой
 * imbalanced → imbalanced; иначе любой not_verifiable →
 * not_verifiable; иначе любой approximate → approximate; иначе
 * balanced. Некорректный tolerance (NaN/±Infinity/отрицательное)
 * → invalid всего аудита без проверки записей. Аудит не изменяет
 * входные данные.
 */
export function auditReactionLedger(
  ledger: unknown,
  catalog: SpeciesCatalog,
  options?: { tolerance?: number; reservoirIds?: readonly string[] }
): ReactionLedgerAudit {
  const { problem: toleranceProblem } = resolveAuditTolerance(options?.tolerance);
  if (toleranceProblem !== null) {
    return {
      status: 'invalid',
      formIssues: [toleranceProblem],
      recordAudits: [],
      diagnostics: ['некорректный tolerance: ' + toleranceProblem]
    };
  }
  const formIssues = validateReactionLedger(ledger, { reservoirIds: options?.reservoirIds });
  const records = typeof ledger === 'object' && ledger !== null && Array.isArray((ledger as Record<string, unknown>).records)
    ? ((ledger as Record<string, unknown>).records as unknown[])
    : [];
  const recordAudits: ReactionRecordAudit[] = [];
  const diagnostics: string[] = [...formIssues];
  for (const entry of records) {
    const id = typeof entry === 'object' && entry !== null && typeof (entry as Record<string, unknown>).id === 'string'
      ? ((entry as Record<string, unknown>).id as string)
      : null;
    const result = auditReactionStoichiometry(entry as ReactionRecord, catalog, { tolerance: options?.tolerance });
    const issues = [...result.formIssues, ...result.elementIssues, ...result.chargeIssues];
    if (result.missingSpecies.length > 0) {
      issues.push('виды вне каталога: ' + result.missingSpecies.join(', '));
    }
    if (result.unprovenSpecies.length > 0) {
      issues.push('состав непроверяем: ' + result.unprovenSpecies.join(', '));
    }
    if (result.estimatedSpecies.length > 0) {
      issues.push('состав оценочный: ' + result.estimatedSpecies.join(', '));
    }
    recordAudits.push({ recordId: id, status: result.status, issues });
    if (result.status !== 'balanced' && issues.length > 0) {
      diagnostics.push((id ?? 'запись без id') + ': ' + issues.join('; '));
    }
  }
  let status: ReactionStoichiometryStatus = 'balanced';
  if (formIssues.length > 0 || recordAudits.some((a) => a.status === 'invalid')) {
    status = 'invalid';
  } else if (recordAudits.some((a) => a.status === 'imbalanced')) {
    status = 'imbalanced';
  } else if (recordAudits.some((a) => a.status === 'not_verifiable')) {
    status = 'not_verifiable';
  } else if (recordAudits.some((a) => a.status === 'approximate')) {
    status = 'approximate';
  }
  return { status, formIssues, recordAudits, diagnostics };
}
