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
// Корректирующая ревизия Stage 4.2.3.3.2 (пограничные случаи
// append-only и валидации журнала):
// - отсутствие прежнего журнала не отменяет проверки формы нового:
//   появившийся журнал валидируется (records — массив, форма каждой
//   записи, дубликаты id); валидный пустой журнал допустим;
//   некорректная форма после шага — контролируемое нарушение
//   (отклонение шага), а не commit с битым журналом и не
//   необработанное исключение;
// - явный null журнала недопустим ни до, ни после шага: отсутствие
//   журнала выражается отсутствием поля (undefined), null —
//   некорректная форма (контракт CoreWorldState не допускает
//   ReactionLedger | null);
// - deepJsonEqual различает сериализуемые виды объектов: Date не
//   равна пустой записи (одинаковые Object.keys — не равенство
//   данных); прочие не-plain-объекты не равны ничему, кроме самих
//   себя — сравнение покрывает ВСЮ сохраняемую историю, включая
//   дополнительные поля записей, а не только известные поля.
//
// Корректирующая ревизия Stage 4.2.3.3.3 (fail-closed сравнение и
// строгая валидация массивов):
// - deepJsonEqual сравнивает КАЖДЫЙ индекс массива явно: every и
//   forEach пропускают отсутствующие индексы, из-за чего new Array(1)
//   ошибочно считалась равной [new Date(0)], хотя JSON различает [null]
//   и ISO-строку времени; появление определённого значения на месте
//   дырки — изменение, порядок элементов значим, отсутствующий индекс
//   равносилен явному undefined (оба сериализуются в массиве как null),
//   сравнение симметрично;
// - обход обнаруживает циклы по АКТИВНОМУ рекурсивному пути: повторный
//   вход в объект, сравниваемый выше по стеку, — недоказуемое
//   равенство, fail-closed — изменение, а не необработанный
//   RangeError; повторное использование той же ссылки в независимых
//   ветвях графа циклом НЕ считается;
// - строгая форма: журнал, запись и участник — только настоящие plain
//   records (прототип Object.prototype или null): массив и Date
//   проходят typeof === 'object', но сериализуемыми данными не
//   являются; дополнительные поля корректных записей допустимы
//   (вложенная Date сравнивается по времени, как в 4.2.3.3.2);
// - дырки в records/reactants/products — структурная ошибка, а не
//   отсутствие данных: каждый индекс обязан содержать существующую
//   корректную запись/участника (forEach пропускал отсутствующие
//   индексы, и undefined из дырки доходил до аудита с падением на
//   p.speciesId); аудит таких входов — контролируемый invalid с
//   диагностикой; правила стехиометрии, численные tolerance и статусы
//   известных/неизвестных составов не меняются.
//
// Корректирующая ревизия Stage 4.2.3.3.4 (собственные индексы
// массивов):
// - проверка наличия каждого индекса records/reactants/products
//   использует Object.prototype.hasOwnProperty.call, а не 'index in':
//   'in' учитывает prototype chain и принимал массив без собственного
//   элемента, если числовой индекс присутствовал в прототипе;
//   унаследованный индекс не заменяет собственный элемент — дырка
//   остаётся структурной ошибкой;
// - явный undefined как собственное значение остаётся некорректной
//   записью/участником; плотные массивы проходят как раньше;
// - семантика deepJsonEqual не меняется ('index in' при сравнении
//   значений массивов сохранён), стехиометрия, численные tolerance и
//   статусы аудита не меняются.
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
import { isPlainRecord } from './reservoir';
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
 * - запись — настоящий plain record (прототип Object.prototype или
 *   null): массив, Date, Map, Set, RegExp и экземпляры классов
 *   записью не являются (Stage 4.2.3.3.3);
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
  // Stage 4.2.3.3.3: запись — только настоящий plain record (прототип
  // Object.prototype или null): массив и Date проходят проверку
  // typeof === 'object', но сериализуемой записью истории не
  // являются; дополнительные поля корректной записи допустимы.
  if (!isPlainRecord(record)) {
    return ['запись реакции должна быть объектом-записью (plain record), а не массивом/Date/Map/Set/RegExp/экземпляром класса или значением не-объектного типа'];
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
  // Stage 4.2.3.3.3: forEach пропускает отсутствующие индексы —
  // дырка в reactants/products — структурная ошибка, а не отсутствие
  // данных: каждый индекс обязан содержать участника (undefined из
  // дырки прежде доходил до аудита и падал на обращении к
  // p.speciesId).
  // Stage 4.2.3.3.4: индекс обязан быть СОБСТВЕННЫМ свойством массива:
  // унаследованный из prototype chain числовой индекс элементом не
  // считается ('index in' учитывал прототип).
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      problems.push(side + '[' + index + '] отсутствует (разреженный массив): каждый индекс обязан содержать участника');
      continue;
    }
    const entry = value[index];
    // Stage 4.2.3.3.3: участник — только настоящий plain record:
    // массив и Date проходят typeof === 'object', но участником
    // реакции не являются.
    if (!isPlainRecord(entry)) {
      problems.push(side + '[' + index + '] должен быть объектом-записью участника (plain record), а не массивом/Date/Map/Set/RegExp/экземпляром класса');
      continue;
    }
    const p = entry;
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
  }
}

/**
 * Валидация журнала реакций: форма журнала и каждой записи,
 * уникальность id транзакций и (при передаче reservoirIds) ссылки
 * участников на резервуары. Возвращает список проблем
 * (пустой = журнал корректен).
 */
export function validateReactionLedger(ledger: unknown, opts?: { reservoirIds?: readonly string[] }): string[] {
  const problems: string[] = [];
  // Stage 4.2.3.3.3: журнал — только настоящий plain record (прототип
  // Object.prototype или null): массив и Date проходят проверку
  // typeof === 'object' с искусственно добавленными полями, но
  // сериализуемым журналом не являются.
  if (!isPlainRecord(ledger)) {
    return ['журнал реакций должен быть объектом-записью с полем records: массив, Date, Map, Set, RegExp и экземпляры классов журналом не являются'];
  }
  const rec = ledger;
  if (!Array.isArray(rec.records)) {
    return ['журнал реакций: поле records должно быть массивом'];
  }
  const seen = new Set<string>();
  const records = rec.records as unknown[];
  // Stage 4.2.3.3.3: forEach пропускал отсутствующие индексы — дырка
  // в records — структурная ошибка, а не отсутствие данных: каждый
  // индекс обязан содержать корректную запись.
  // Stage 4.2.3.3.4: индекс обязан быть СОБСТВЕННЫМ свойством массива:
  // унаследованный из prototype chain числовой индекс записью не
  // считается ('index in' учитывал прототип).
  for (let index = 0; index < records.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(records, index)) {
      problems.push('запись #' + index + ' отсутствует (разреженный массив records): каждый индекс обязан содержать запись');
      continue;
    }
    const entry = records[index];
    const at = (message: string): string => 'запись #' + index + ': ' + message;
    for (const problem of validateReactionRecord(entry)) {
      problems.push(at(problem));
    }
    const r = isPlainRecord(entry) ? entry : null;
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
  }
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

// ============================================
// 7. APPEND-ONLY КОНТРАКТ ЖУРНАЛА (Stage 4.2.3.3.1)
// ============================================

/**
 * Глубокое структурное сравнение JSON-подобных данных: порядок ключей
 * объектов не важен (запись, пересобранная с иным порядком ключей, но
 * тем же содержимым, изменением не считается), порядок массивов —
 * важен (порядок участников — часть данных записи). Собственные
 * свойства читаются без обращения к прототипу. Собственный ключ со
 * значением undefined равносилен отсутствию ключа (JSON-семантика:
 * сериализованный журнал не содержит undefined-значений); удаление
 * определённого значения или появление нового определённого
 * значения — изменение.
 *
 * Stage 4.2.3.3.2: одинаковый набор Object.keys сам по себе НЕ
 * доказывает равенства данных — у Date нет перечисляемых
 * собственных ключей, и пустая запись {} сравнивалась как равная
 * new Date(0) (равно как две Date с разным временем). Сравнение
 * различает сериализуемые виды объектов:
 * - Date равна только Date с тем же временем (JSON-представление
 *   Date — ISO-строка времени; structuredClone-копия записи с
 *   Date не считается изменённой);
 * - настоящая объектная запись (прототип Object.prototype или
 *   null) сравнивается по собственным ключам, порядок не важен;
 * - прочие объекты (Map, Set, RegExp, экземпляры классов) не
 *   равны ничему, кроме самих себя (ссылочное равенство проверено
 *   выше): их скрытое состояние ускользает и от Object.keys, и от
 *   JSON-сериализации, тихое приравнивание означало бы
 *   незамеченное изменение истории. Отказ в сторону безопасности
 *   (fail-closed): недоказанная неизменность — изменение, не
 *   наоборот.
 *
 * Stage 4.2.3.3.3: сравнение массивов — по каждому индексу явно
 * (every пропускал отсутствующие индексы: new Array(1) ошибочно
 * равнялась [new Date(0)], хотя JSON различает [null] и ISO-строку):
 * отсутствующий индекс равносилен явному undefined (оба
 * сериализуются как null), появление определённого значения на
 * месте дырки — изменение, порядок элементов значим, сравнение
 * симметрично. Обход обнаруживает циклы по АКТИВНОМУ рекурсивному
 * пути: повторный вход в объект, который уже сравнивается выше по
 * стеку, — недоказуемое равенство (fail-closed: изменение), а не
 * необработанный RangeError; повторное использование той же
 * ссылки в независимых ветвях графа циклом НЕ считается.
 *
 * Гарантия покрывает ВСЮ сохраняемую историю, а не только известные
 * типизированные поля: сравниваются все собственные перечисляемые
 * ключи, включая дополнительные поля записей (их запрет не
 * требуется: изменение дополнительного поля обнаруживается
 * сравнением так же, как изменение известного).
 */
function deepJsonEqual(a: unknown, b: unknown): boolean {
  return deepJsonEqualWithPaths(a, b, new Set(), new Set());
}

/**
 * Stage 4.2.3.3.3: обход с явной проверкой каждого индекса массива
 * и обнаружением циклов. activeA/activeB — объекты соответствующей
 * стороны, которые сравниваются СЕЙЧАС (активный рекурсивный путь),
 * а не «когда-либо посещённые»: повторное использование той же
 * ссылки в независимых ветвях графа циклом НЕ считается и
 * сравнивается повторно. Повторный вход в объект активного пути —
 * цикл: сериализуемое равенство недоказуемо, fail-closed —
 * изменение, а не необработанный RangeError.
 */
function deepJsonEqualWithPaths(a: unknown, b: unknown, activeA: Set<object>, activeB: Set<object>): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  if (activeA.has(a) || activeB.has(b)) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    activeA.add(a);
    activeB.add(b);
    // Stage 4.2.3.3.3: every пропускает отсутствующие индексы —
    // new Array(1) ошибочно считалась равной [new Date(0)], хотя
    // JSON-представления различаются ([null] против ISO-строки).
    // Каждый индекс сравнивается явно: отсутствующий индекс
    // равносилен явному undefined (оба сериализуются в массиве как
    // null), появление определённого значения — изменение; порядок
    // элементов значим; сравнение симметрично.
    let equal = true;
    for (let index = 0; index < a.length; index++) {
      const left = index in a ? a[index] : undefined;
      const right = index in b ? b[index] : undefined;
      if (!deepJsonEqualWithPaths(left, right, activeA, activeB)) {
        equal = false;
        break;
      }
    }
    activeA.delete(a);
    activeB.delete(b);
    return equal;
  }
  // Stage 4.2.3.3.2: вид объекта — часть данных. Date без
  // перечисляемых ключей не равна пустой записи; прочие
  // не-plain-объекты не равны ничему, кроме самих себя (ссылочное
  // равенство проверено выше) — недоказанная неизменность
  // трактуется как изменение, а не наоборот.
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (!isPlainRecord(a) || !isPlainRecord(b)) {
    return false;
  }
  activeA.add(a);
  activeB.add(b);
  const keysA = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined);
  const keysB = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined);
  let equal = keysA.length === keysB.length;
  for (const key of keysA) {
    if (
      !Object.prototype.hasOwnProperty.call(b, key) ||
      !deepJsonEqualWithPaths((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], activeA, activeB)
    ) {
      equal = false;
      break;
    }
  }
  activeA.delete(a);
  activeB.delete(b);
  return equal;
}

/** id записи для диагностики (null — если id нечитаем). */
function recordIdOf(record: unknown): string | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }
  const id = (record as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

/**
 * Проверка append-only контракта журнала реакций (Stage 4.2.3.3.1):
 * записи, существовавшие до macro-шага, обязаны остаться в журнале
 * НЕИЗМЕННЫМИ — по всему содержимому (участники, коэффициенты,
 * extent, extentBasis, time, processId, note), в том же порядке и в
 * том же количестве. Разрешено ТОЛЬКО добавление новых записей в
 * конец журнала. Одинаковый id НЕ считается доказательством
 * неизменности: подмена содержимого при сохранённом id, удаление,
 * перестановка и правка любых полей старой записи — нарушение.
 *
 * Семантика «до → после»: undefined до шага — журнала не было, все
 * записи «после» считаются новыми (нарушения нет); undefined после
 * шага при существовавшем журнале — нарушение (журнал исключён из
 * состояния мира). Некорректная форма журнала (records не массив) —
 * нарушение: контракт невозможно проверить.
 *
 * Stage 4.2.3.3.2: отсутствие прежнего журнала НЕ отменяет проверки
 * формы нового: появившийся журнал валидируется существующим
 * validateReactionLedger (records — массив, форма каждой записи,
 * дубликаты id; правила не дублируются); валидный пустой журнал
 * { records: [] } допустим. Явный null недопустим ни до, ни после
 * шага: отсутствие журнала выражается отсутствием поля (undefined),
 * а не null — null в любой стороне является контролируемым
 * нарушением (отклонением шага), а не необработанным исключением
 * при обращении к .records. Контракт для уже имеющейся истории
 * (позиционное сравнение записей) не меняется.
 *
 * Возвращает список нарушений (пустой = контракт соблюдён).
 * Функция чистая: входные данные не изменяются.
 */
export function reactionLedgerAppendOnlyIssues(
  before: ReactionLedger | undefined | null,
  after: ReactionLedger | undefined | null
): string[] {
  const issues: string[] = [];
  // Stage 4.2.3.3.2: null — некорректная форма журнала в любой
  // стороне; проверяется ПЕРВЫМ, чтобы обращение к .records у null
  // было контролируемым нарушением, а не необработанным
  // исключением.
  if (after === null) {
    issues.push('журнал реакций после шага равен null: отсутствие журнала выражается отсутствием поля (undefined), а не null — некорректная форма журнала');
    return issues;
  }
  if (before === null) {
    issues.push('журнал реакций до шага равен null: некорректная форма журнала (отсутствие выражается отсутствием поля, а не null) — append-only-контракт невозможно проверить');
    return issues;
  }
  if (before === undefined) {
    if (after === undefined) {
      // Журнала не было и не появилось — контракт соблюдён.
      return issues;
    }
    // Stage 4.2.3.3.2: журнал появился в этом шаге — все записи
    // новые, но форма нового журнала проверяется: ранний выход
    // пропускал records не-массив и битые записи (шаг мог
    // зафиксироваться с журналом, не являющимся журналом). Правила
    // формы не дублируются — validateReactionLedger; валидный
    // пустой журнал { records: [] } проходит.
    return validateReactionLedger(after).map((problem) => 'новый журнал реакций некорректен: ' + problem);
  }
  if (after === undefined) {
    issues.push('журнал реакций удалён из состояния мира: существовавший до шага журнал нельзя исключать');
    return issues;
  }
  if (!Array.isArray(before.records)) {
    issues.push('журнал реакций до шага некорректен (records не является массивом): append-only-контракт невозможно проверить');
    return issues;
  }
  if (!Array.isArray(after.records)) {
    issues.push('журнал реакций после шага некорректен (records не является массивом)');
    return issues;
  }
  if (after.records.length < before.records.length) {
    issues.push(
      'старые записи журнала реакций удалены: было ' + String(before.records.length) +
      ', стало ' + String(after.records.length) + ' — удаление истории запрещено'
    );
  }
  const limit = Math.min(before.records.length, after.records.length);
  for (let i = 0; i < limit; i++) {
    if (!deepJsonEqual(before.records[i], after.records[i])) {
      const id = recordIdOf(before.records[i]) ?? recordIdOf(after.records[i]) ?? ('запись #' + String(i));
      issues.push(
        'старая запись «' + id + '» (позиция ' + String(i) + ') изменена или сдвинута: содержимое, порядок и количество записей до шага обязаны сохраниться — сохранение id не является доказательством неизменности'
      );
    }
  }
  return issues;
}
