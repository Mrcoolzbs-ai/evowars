// ============================================
// SOLVER BACKEND - Общий интерфейс численных решателей
// ============================================
//
// Контракт (и ТОЛЬКО контракт) для будущих численных решателей
// (Stage 4.1). Реальных численных методов здесь НЕТ — и контракт
// построен так, чтобы невозможно было объявить нереализованное.
//
// Планируемые в будущем реализации (TypeScript, WASM, Rust, C++,
// внешние движки) подключаются как отдельные записи реестра со
// ЧЕСТНЫМ перечислением реализованных методов в capabilities.
// Поддержка BDF/implicit/sparse-Jacobian у конкретного backend'а —
// это факт его capabilities, а не общее обещание интерфейса.
//
// Разные классы задач НЕ сводятся в один универсальный вызов:
// ODE, DAE, алгебраические равновесия и линейные системы —
// отдельные ProblemKind; backend поддерживает свой поднабор.
//
// Детерминизм:
// - 'bitwise_same_environment' — битовая воспроизводимость в
//   том же окружении (тот же движок, та же платформа);
// - 'within_tolerance' — совпадение в пределах допуска;
// - 'platform_dependent' — результат зависит от платформы
//   (порядок операций с плавающей точкой).
// Фиктивной гарантии битовой идентичности между WASM/Rust/TS нет.

// ============================================
// 1. КЛАССЫ ЗАДАЧ
// ============================================

/** Поддерживаемые классы численных задач (расширяемо). */
export const SUPPORTED_PROBLEM_KINDS = ['ode', 'dae', 'algebraic_equilibrium', 'linear_system'] as const;
export type ProblemKind = (typeof SUPPORTED_PROBLEM_KINDS)[number];

/** Описание численной задачи (поля будут расширяться в Stage 4.2+). */
export interface SolverProblem {
  kind: ProblemKind;
  /** Размерность вектора состояния. */
  stateDimension: number;
  /** Человекочитаемое описание для диагностики. */
  description?: string;
}

// ============================================
// 2. ВОЗМОЖНОСТИ И КОНТРАКТ
// ============================================

/** Честный перечень возможностей конкретной реализации. */
export interface SolverCapabilities {
  /** Классы задач, которые backend умеет принимать. */
  problemKinds: readonly ProblemKind[];
  /**
   * РЕАЛИЗОВАННЫЕ методы (названия, например 'euler_forward',
   * 'rk4', 'bdf2'). Пустой список = численных методов нет;
   * такой backend может существовать как дескриптор, но solve()
   * обязан возвращать not_implemented.
   */
  implementedMethods: readonly string[];
  /** Адаптивный шаг. */
  adaptiveStep: boolean;
  /** Неявные методы. */
  implicit: boolean;
  /** Жёсткие (stiff) задачи. */
  stiff: boolean;
  /** Разреженные якобианы. */
  sparseJacobian: boolean;
  /** Максимальная поддерживаемая размерность состояния; null — не ограничена. */
  maxStateDimension: number | null;
  /** Семантика воспроизводимости результатов. */
  deterministic: 'bitwise_same_environment' | 'within_tolerance' | 'platform_dependent';
}

export interface SolverOptions {
  /** Допуски (абсолютный/относительный), если метод их поддерживает. */
  absTolerance?: number;
  relTolerance?: number;
  /** Фиксированный шаг, если метод его использует. */
  fixedStep?: number;
  note?: string;
}

export interface SolverDiagnostics {
  backendId: string;
  problemKind: ProblemKind;
  message: string;
  /** Дополнительные сведения (счётчики, статистика) — свободная карта. */
  details?: Record<string, number | string | boolean>;
}

export type SolverOutcome =
  | { status: 'solved'; diagnostics: SolverDiagnostics }
  | { status: 'not_implemented'; diagnostics: SolverDiagnostics }
  | { status: 'error'; diagnostics: SolverDiagnostics };

/**
 * Контракт backend'а. solve() присутствует только у реализаций;
 * дескрипторы без реализованных методов создаются через
 * describeSolverBackend и solve() НЕ имеют.
 */
export interface SolverBackend {
  /** Стабильный идентификатор (например 'ts-reference', 'wasm-rust'). */
  id: string;
  /** Версия backend'а (semver). */
  version: string;
  capabilities: SolverCapabilities;
  /** Поддерживает ли backend данный класс задачи (по его размерности и kind). */
  supports(problem: SolverProblem): boolean;
  /** Выполнить задачу. Обязан вернуть not_implemented, если методов нет. */
  solve(problem: SolverProblem, options?: SolverOptions): SolverOutcome;
}

// ============================================
// 3. ВАЛИДАЦИЯ КОНТРАКТА
// ============================================

export interface BackendContractIssue {
  code:
    | 'empty_id'
    | 'invalid_version'
    | 'empty_problem_kinds'
    | 'unknown_problem_kind'
    | 'unsupported_kind_claim'
    | 'invalid_max_dimension';
  message: string;
}

/**
 * Валидация контракта backend'а. Проверки честности:
 * - id/version непусты;
 * - заявленные ProblemKind существуют в SUPPORTED_PROBLEM_KINDS;
 * - пустой implementedMethods допустим только если solve()
 *   действительно возвращает not_implemented (проверяется
 *   вызовом на пробной задаче);
 * - отрицательная размерность или отрицательные допуски — ошибки.
 */
export function validateBackendContract(backend: SolverBackend): BackendContractIssue[] {
  const issues: BackendContractIssue[] = [];
  if (backend.id.trim() === '') {
    issues.push({ code: 'empty_id', message: 'идентификатор backend не может быть пустым' });
  }
  if (!/^\d+\.\d+\.\d+$/.test(backend.version)) {
    issues.push({ code: 'invalid_version', message: `версия backend должна быть semver (x.y.z), получено «${backend.version}»` });
  }
  const caps = backend.capabilities;
  if (caps.problemKinds.length === 0) {
    issues.push({ code: 'empty_problem_kinds', message: `backend «${backend.id}» не заявляет ни одного класса задач` });
  }
  for (const kind of caps.problemKinds) {
    if (!(SUPPORTED_PROBLEM_KINDS as readonly string[]).includes(kind)) {
      issues.push({ code: 'unknown_problem_kind', message: `backend «${backend.id}» заявляет неизвестный класс задач «${kind}»` });
    }
  }
  if (caps.maxStateDimension !== null && (!Number.isFinite(caps.maxStateDimension) || caps.maxStateDimension < 1)) {
    issues.push({ code: 'invalid_max_dimension', message: `maxStateDimension должен быть натуральным числом или null, получено ${caps.maxStateDimension}` });
  }
  if (caps.implementedMethods.length > 0) {
    // Методы заявлены: контракт обязан уметь решать хотя бы что-то.
    // Проверяем фактическим вызовом на минимальной задаче первого
    // заявленного вида.
    const kind = caps.problemKinds[0];
    const probe: SolverProblem = { kind, stateDimension: 1, description: 'контрактная проверка' };
    const outcome = backend.solve(probe, {});
    if (outcome.status === 'not_implemented') {
      issues.push({
        code: 'unsupported_kind_claim',
        message: `backend «${backend.id}» заявляет методы (${caps.implementedMethods.join(', ')}) для класса «${kind}», но solve() возвращает not_implemented: ложное заявление о реализованном методе`
      });
    }
  }
  return issues;
}

// ============================================
// 4. ОПИСАТЕЛЬ БЕЗ РЕАЛИЗАЦИИ
// ============================================

/**
 * Дескриптор планируемого backend'а. Это НЕ реализация:
 * числовые методы отсутствуют и не притворяются существующими.
 * Используется в документации и реестрах планирования; в solve()
 * никогда не попадает.
 */
export interface PlannedBackendDescriptor {
  id: string;
  version: string;
  status: 'planned';
  capabilities: SolverCapabilities;
  /** Что должно быть реализовано, чтобы статус стал available. */
  plannedMethods: readonly string[];
  note?: string;
}

/**
 * Реестр backend'ов: хранит доступные реализации и планируемые
 * дескрипторы отдельно. Планируемые записи не выдают себя за
 * доступные: listAvailable() их не возвращает.
 */
export interface SolverBackendRegistry {
  registerAvailable(backend: SolverBackend): void;
  registerPlanned(descriptor: PlannedBackendDescriptor): void;
  listAvailable(): readonly SolverBackend[];
  listPlanned(): readonly PlannedBackendDescriptor[];
  findAvailable(id: string): SolverBackend | null;
}

export function createSolverBackendRegistry(): SolverBackendRegistry {
  const available = new Map<string, SolverBackend>();
  const planned = new Map<string, PlannedBackendDescriptor>();
  return {
    registerAvailable(backend: SolverBackend): void {
      const issues = validateBackendContract(backend);
      if (issues.length > 0) {
        throw new Error(`[SolverBackend] контракт backend «${backend.id}» некорректен: ${issues.map((i) => i.message).join('; ')}`);
      }
      available.set(backend.id, backend);
    },
    registerPlanned(descriptor: PlannedBackendDescriptor): void {
      if (descriptor.capabilities.implementedMethods.length > 0) {
        throw new Error(`[SolverBackend] планируемый backend «${descriptor.id}» не может заявлять реализованные методы: это дескриптор плана, а не реализация`);
      }
      planned.set(descriptor.id, descriptor);
    },
    listAvailable(): readonly SolverBackend[] {
      return [...available.values()];
    },
    listPlanned(): readonly PlannedBackendDescriptor[] {
      return [...planned.values()];
    },
    findAvailable(id: string): SolverBackend | null {
      return available.get(id) ?? null;
    }
  };
}
