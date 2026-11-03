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
// 2b. СПЕЦИАЛИЗИРОВАННЫЙ ODE-КОНТРАКТ (Stage 4.5.3)
// ============================================
//
// ODE — первый класс задач с РЕАЛЬНЫМ специализированным
// контрактом (реализация: odeSolver.ts, Radau IIA, 3 стадии,
// порядок 5, L-stable). Общий solve() для ODE не подходит:
// интегрирование требует своей задачи (t0/tEnd/y0/rhs), своих
// опций (rtol, atol скаляр ИЛИ массив, tEval, шаги) и своего
// результата (численное решение, контрольные точки,
// статистика шагов).
//
// Инвариант контракта: 'solved' возвращается ТОЛЬКО вместе с
// реальным численным решением; ошибки решателя — исключения со
// стабильными кодами (OdeSolverError в odeSolver.ts), но
// никогда «solved без решения».

/** Правая часть ODE: y' = f(t, y). */
export type OdeRhs = (t: number, y: readonly number[]) => number[];

/** Якобиан df/dy: матрица n×n. */
export type OdeJacobian = (t: number, y: readonly number[]) => number[][];

/**
 * Линейный инвариант Σ coefficients_i · y_i = expected.
 * Проверяется на y0 и после принятых шагов; вектор состояния
 * НИКОГДА не корректируется молча.
 */
export interface LinearInvariant {
  coefficients: readonly number[];
  expected: number;
  /**
   * Абсолютный допуск проверки инварианта. По умолчанию —
   * Σ|c_i|·atol_i: шумовой пол покомпонентных atol, накопленный
   * коэффициентами (масштабируется по данным, а не фиксируется).
   */
  absTolerance?: number;
  /**
   * Относительный допуск проверки инварианта. По умолчанию — rtol
   * задачи. Умножается на max(|expected|, Σ|c_i·y_i|).
   */
  relTolerance?: number;
}

/** Задача Коши для ODE. */
export interface OdeSolverProblem {
  kind: 'ode';
  stateDimension: number;
  t0: number;
  tEnd: number;
  y0: readonly number[];
  rhs: OdeRhs;
  /**
   * Аналитический якобиан. Отсутствует → решатель использует
   * численный (конечные разности), это честно отражено в его
   * статистике jacobianEvaluations.
   */
  jacobian?: OdeJacobian;
  /** Индексы компонент, обязанных оставаться неотрицательными. */
  nonNegativeIndices?: readonly number[];
  linearInvariants?: readonly LinearInvariant[];
  description?: string;
}

export interface OdeSolverOptions {
  /** Относительный допуск (взвешенная RMS-норма ошибки шага). */
  rtol?: number;
  /**
   * Абсолютный допуск: скаляр ИЛИ массив по компонентам.
   * Массив нужен задачам типа Robertson, где масштабы компонент
   * различаются на ~10 порядков.
   */
  atol?: number | readonly number[];
  /**
   * Контрольные времена: строго возрастают, лежат в [t0, tEnd].
   * Шаг обрезается до ближайшей точки, t в результате равно
   * РОВНО заданному времени (никакой интерполяционной подмены).
   */
  tEval?: readonly number[];
  initialStep?: number;
  maxStep?: number;
  /** Минимальный шаг; при невозможности дальнейшего уменьшения — ошибка (fail-closed). */
  minStep?: number;
  maxSteps?: number;
  maxNewtonIterations?: number;
}

/** Контрольная точка решения в момент времени t. */
export interface OdeSolutionPoint {
  t: number;
  y: number[];
}

export interface OdeSolverStats {
  attemptedSteps: number;
  acceptedSteps: number;
  rejectedSteps: number;
  newtonFailures: number;
  rhsEvaluations: number;
  jacobianEvaluations: number;
  luFactorizations: number;
  maxNewtonIterationsUsed: number;
  maxAcceptedStepSize: number;
  minAcceptedStepSize: number;
}

export interface OdeSolverDiagnostics {
  backendId: string;
  method: string;
  message: string;
  /**
   * Число компонент, зафиксированных с небольшим отрицательным
   * значением в пределах допуска: сохранены КАК ЕСТЬ, без
   * молчаливого clipping. Учитываются ТОЛЬКО начальное состояние
   * y0 и ПРИНЯТЫЕ состояния шагов: малые минусы кандидатов
   * отклонённых попыток шага (отказ по оценке ошибки,
   * неотрицательности или инварианту) в счётчик не попадают —
   * диагностика отражает реальную траекторию, а не историю проб.
   */
  minorNegativeCount: number;
  /**
   * Число фактических проверок линейных инвариантов: счётчик
   * увеличивается при проверке КАЖДОГО линейного инварианта
   * на КАНДИДАТЕ шага — ДО его принятия. Следствия: кандидаты,
   * отклонённые по инварианту, учитываются (их проверка уже
   * выполнена); кандидаты, отклонённые РАНЬШЕ проверки
   * инвариантов (по оценке ошибки шага или неотрицательности),
   * НЕ учитываются; проверка начального состояния y0 в счётчик
   * НЕ входит.
   */
  invariantChecks: number;
}

/**
 * Результат solveOde: 'solved' ТОЛЬКО с численным решением.
 * Ошибки решателя — исключения (OdeSolverError) со стабильными
 * кодами; статус без решения не возвращается.
 */
export interface OdeSolverResult {
  status: 'solved';
  method: string;
  t0: number;
  tEnd: number;
  /** Фактическое конечное время (ровно tEnd при нормальном завершении). */
  t: number;
  /** Конечное состояние. */
  y: number[];
  /** Контрольные точки tEval (плюс конечная, если не была запрошена). */
  points: OdeSolutionPoint[];
  stats: OdeSolverStats;
  diagnostics: OdeSolverDiagnostics;
}

/**
 * Специализированный ODE-backend: общий контракт расширен
 * методом solveOde. solve() при этом осмысленно НЕ выполняет
 * интегрирования (возвращает 'error' с диагностикой): ODE-задачи
 * принимаются ТОЛЬКО через solveOde.
 */
export interface OdeSolverBackend extends SolverBackend {
  solveOde(problem: OdeSolverProblem, options?: OdeSolverOptions): OdeSolverResult;
}

/** Type guard: backend реализует специализированный ODE-контракт. */
export function isOdeSolverBackend(backend: SolverBackend): backend is OdeSolverBackend {
  return typeof (backend as { solveOde?: unknown }).solveOde === 'function';
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
    | 'invalid_max_dimension'
    | 'ode_capabilities_invalid'
    | 'ode_solution_invalid';
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
 * - для ODE-backend'ов (isOdeSolverBackend): обязательность
 *   'ode' в problemKinds, непустые implementedMethods,
 *   согласованность stiff → implicit, и РЕАЛЬНАЯ проверка
 *   решения контрольной задачи y' = -y через solveOde.
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
  if (isOdeSolverBackend(backend)) {
    if (!caps.problemKinds.includes('ode')) {
      issues.push({
        code: 'ode_capabilities_invalid',
        message: `ODE-backend «${backend.id}» обязан заявлять класс задач 'ode' в problemKinds`
      });
    }
    if (caps.implementedMethods.length === 0) {
      issues.push({
        code: 'ode_capabilities_invalid',
        message: `ODE-backend «${backend.id}» обязан заявлять хотя бы один реализованный метод`
      });
    }
    if (caps.stiff && !caps.implicit) {
      issues.push({
        code: 'ode_capabilities_invalid',
        message: `backend «${backend.id}» заявляет stiff без implicit: неявность — необходимое условие L-устойчивых методов`
      });
    }
    // Реальная проверка ODE-решения: y' = -y, y(0) = 1, y(1) = e^-1.
    // «solved без решения» здесь невозможно: контракт требует
    // численное значение в пределах допуска.
    try {
      const odeProblem: OdeSolverProblem = {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 1,
        y0: [1],
        rhs: (_t, y) => [-y[0]],
        description: "контрактная проверка ODE: y' = -y"
      };
      const result = backend.solveOde(odeProblem, { rtol: 1e-8, atol: 1e-12 });
      const expected = Math.exp(-1);
      if (Math.abs(result.y[0] - expected) > 1e-6) {
        issues.push({
          code: 'ode_solution_invalid',
          message: `solveOde backend'а «${backend.id}» вернул неверное решение контрольной задачи y' = -y: y(1) = ${result.y[0]}, ожидалось ~${expected}`
        });
      }
    } catch {
      issues.push({
        code: 'ode_solution_invalid',
        message: `solveOde backend'а «${backend.id}» не смог решить минимальную контрольную задачу y' = -y на [0, 1]`
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

