// ============================================
// STAGE 4.5.3 - Тесты Radau IIA ODE-решателя
// ============================================
//
// Проверяется реальная реализация жёсткого ODE-решателя
// (odeSolver.ts, Radau IIA, 3 стадии, порядок 5, L-stable):
// контракт backend'а, эталон Robertson, L-устойчивость,
// tEval, адаптивный шаг (step-doubling, делитель 31 = 2^5 − 1),
// неотрицательность без молчаливого clipping, линейные
// инварианты, диагностические коды ошибок и честность
// capabilities (фейковые ODE-бэкенды ловятся валидатором).
//
// Корректирующая ревизия 4.5.3 (по независимому аудиту):
// начальный шаг (Hairer/SciPy select_initial_step, без
// нулевых шагов при y0 = 0), численная устойчивость
// (NaN/Infinity не проходят в solved), строгие лимиты,
// неотрицательность y0, масштабируемый допуск инвариантов
// (atol/rtol/|expected|, опции absTolerance/relTolerance),
// статистика attemptedSteps = acceptedSteps + rejectedSteps.
//
// Этап 2 корректирующей ревизии: clamp h0 ≤ span до пробного
// вызова rhs, d2 = norm(f1 − f0)/h0 (SciPy), честный
// minorNegativeCount (только y0 и принятые состояния).
//
// Этап 3 корректирующей ревизии: условие h0 ДОСЛОВНО SciPy
// select_initial_step (d0 < 1e-5 || d1 < 1e-5 → 1e-6, иначе
// 0.01·d0/d1), начальный шаг проверяется по эталонной формуле
// через spy rhs (различает новый d2 и старое norm(f1)),
// регрессия minorNegativeCount: кандидат с малым минусом,
// отклонённый линейным инвариантом, не попадает в счётчик.
// Этап 4 корректирующей ревизии: minStep проверяется против
// эффективного максимума шага min(maxStep, tEnd − t0); ошибки
// rhs в конечных разностях численного якобиана диагностируются
// честно (rhs_* вместо jacobian_*), вызовы конечных разностей
// не учитываются в rhsEvaluations (задокументировано в
// OdeSolverStats).

import { describe, it, expect } from 'vitest';
import {
  createRadauIiaOdeBackend,
  solveOdeWithRadauIia,
  OdeSolverError,
  ODE_ERROR_CODES,
  RADAU_IIA_BACKEND_ID,
  RADAU_IIA_METHOD_ID,
  RADAU_IIA_MAX_STATE_DIMENSION,
  RADAU_IIA_MATRIX_A,
  RADAU_IIA_NODES,
  RADAU_IIA_WEIGHTS_B,
  STEP_DOUBLING_DIVISOR,
  luFactor,
  luSolve
} from '../Core/odeSolver';
import type { OdeErrorCode } from '../Core/odeSolver';
import { validateBackendContract, isOdeSolverBackend, createSolverBackendRegistry } from '../Core/solverBackend';
import type { SolverBackend, OdeSolverResult } from '../Core/solverBackend';

/** Ожидание OdeSolverError с точным диагностическим кодом. */
function expectOdeError(fn: () => unknown, code: OdeErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(OdeSolverError);
  expect((caught as OdeSolverError).code).toBe(code);
}

/** y' = -y на [0, 1]: минимальная контрольная задача. */
const decayProblem = {
  kind: 'ode' as const,
  stateDimension: 1,
  t0: 0,
  tEnd: 1,
  y0: [1],
  rhs: (_t: number, y: readonly number[]): number[] => [-y[0]]
};

/** Robertson: канонический жёсткий тест (Hairer & Wanner). */
const K1 = 0.04;
const K2 = 1e4;
const K3 = 3e7;
const robertsonRhs = (_t: number, y: readonly number[]): number[] => [
  -K1 * y[0] + K2 * y[1] * y[2],
  K1 * y[0] - K2 * y[1] * y[2] - K3 * y[1] * y[1],
  K3 * y[1] * y[1]
];
const robertsonJacobian = (_t: number, y: readonly number[]): number[][] => [
  [-K1, K2 * y[2], K2 * y[1]],
  [K1, -K2 * y[2] - 2 * K3 * y[1], -K2 * y[1]],
  [0, 2 * K3 * y[1], 0]
];
const robertsonProblem = {
  kind: 'ode' as const,
  stateDimension: 3,
  t0: 0,
  tEnd: 1e11,
  y0: [1, 0, 0],
  rhs: robertsonRhs,
  jacobian: robertsonJacobian,
  nonNegativeIndices: [0, 1, 2],
  linearInvariants: [{ coefficients: [1, 1, 1], expected: 1 }],
  description: 'Robertson stiff benchmark'
};

/**
 * Эталон Robertson: SciPy Radau rtol=1e-11, atol=[1e-14, 1e-22, 1e-14].
 * [t, x, y, z].
 */
const ROBERTSON_REF: readonly (readonly number[])[] = [
  [0.4, 9.8517211386099046e-1, 3.3863953789750567e-5, 1.4794022185220307e-2],
  [4, 9.0551867858422541e-1, 2.2404756875609944e-5, 9.4458916658899703e-2],
  [400, 4.5051866847090100e-1, 3.2229014416735150e-6, 5.4947810862765878e-1],
  [4e4, 3.8983377085461964e-2, 1.6217683159087002e-7, 9.6101646073770963e-1],
  [4e8, 5.2077021035790680e-6, 2.0830915594177213e-11, 9.9999479227706634e-1],
  [1e11, 2.0833401496820535e-8, 8.3333607702578175e-14, 9.9999997916651562e-1]
];

describe('Stage 4.5.3 Radau IIA: таблица Бутчера и константы', () => {
  it('матрица A имеет форму 3×3, узлы c оканчиваются на 1', () => {
    expect(RADAU_IIA_MATRIX_A.length).toBe(3);
    for (const row of RADAU_IIA_MATRIX_A) expect(row.length).toBe(3);
    expect(RADAU_IIA_NODES.length).toBe(3);
    expect(RADAU_IIA_NODES[2]).toBe(1);
  });

  it('метод stiffly accurate: веса b совпадают с последней строкой A и суммируются в 1', () => {
    expect(RADAU_IIA_WEIGHTS_B).toEqual(RADAU_IIA_MATRIX_A[2]);
    const sum = RADAU_IIA_WEIGHTS_B.reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-14);
  });

  it('делитель step-doubling равен 2^5 − 1 = 31 (порядок метода 5)', () => {
    expect(STEP_DOUBLING_DIVISOR).toBe(31);
    expect(STEP_DOUBLING_DIVISOR).toBe(Math.pow(2, 5) - 1);
  });

  it('идентификаторы и предел размерности зафиксированы', () => {
    expect(RADAU_IIA_BACKEND_ID).toBe('ts-radau-iia');
    expect(RADAU_IIA_METHOD_ID).toBe('radau_iia_5');
    expect(RADAU_IIA_MAX_STATE_DIMENSION).toBe(64);
  });

  it('набор диагностических кодов ошибок полный (14 кодов)', () => {
    expect([...ODE_ERROR_CODES]).toEqual([
      'invalid_input',
      't_eval_invalid',
      'rhs_callback_error',
      'rhs_dimension_mismatch',
      'rhs_non_finite',
      'jacobian_callback_error',
      'jacobian_invalid',
      'lu_singular',
      'newton_non_convergence',
      'max_steps_exceeded',
      'min_step_violated',
      'nonneg_violation',
      'invariant_violation',
      'numerical_failure'
    ]);
  });

  it('LU: сингулярная матрица детектируется, корректная решается точно', () => {
    expect(luFactor([[1, 2], [2, 4]])).toBeNull();
    expect(luFactor([[1, 2, 3], [2, 4, 6], [1, 1, 1]])).toBeNull();
    const M = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2]
    ];
    const F = luFactor(M);
    expect(F).not.toBeNull();
    const x = luSolve(F!, [6, 5, 3]);
    for (let i = 0; i < 3; i++) {
      let s = 0;
      for (let j = 0; j < 3; j++) s += M[i][j] * x[j];
      expect(Math.abs(s - [6, 5, 3][i])).toBeLessThan(1e-12);
    }
  });
});

describe('Stage 4.5.3 Radau IIA: capabilities честные', () => {
  it('заявляется ровно то, что реализовано', () => {
    const backend = createRadauIiaOdeBackend();
    expect(backend.id).toBe('ts-radau-iia');
    expect(backend.version).toBe('1.0.0');
    expect(backend.capabilities.problemKinds).toEqual(['ode']);
    expect(backend.capabilities.implementedMethods).toEqual(['radau_iia_5']);
    expect(backend.capabilities.adaptiveStep).toBe(true);
    expect(backend.capabilities.implicit).toBe(true);
    expect(backend.capabilities.stiff).toBe(true);
    // разреженные якобианы НЕ поддерживаются, BDF/DAE НЕ заявляются
    expect(backend.capabilities.sparseJacobian).toBe(false);
    expect(backend.capabilities.problemKinds).not.toContain('dae');
    expect(backend.capabilities.implementedMethods).not.toContain('bdf');
    expect(backend.capabilities.maxStateDimension).toBe(64);
    expect(backend.capabilities.deterministic).toBe('within_tolerance');
  });
});

describe('Stage 4.5.3 Radau IIA: supports()', () => {
  it('принимает ODE размерности 1..64, отвергает остальное', () => {
    const backend = createRadauIiaOdeBackend();
    expect(backend.supports({ kind: 'ode', stateDimension: 1 })).toBe(true);
    expect(backend.supports({ kind: 'ode', stateDimension: 3 })).toBe(true);
    expect(backend.supports({ kind: 'ode', stateDimension: 64 })).toBe(true);
    expect(backend.supports({ kind: 'ode', stateDimension: 65 })).toBe(false);
    expect(backend.supports({ kind: 'ode', stateDimension: 0 })).toBe(false);
    expect(backend.supports({ kind: 'dae', stateDimension: 3 })).toBe(false);
    expect(backend.supports({ kind: 'linear_system', stateDimension: 3 })).toBe(false);
  });
});

describe('Stage 4.5.3 Radau IIA: общий solve() не выполняет интегрирования', () => {
  it('solve() возвращает error с диагностикой «используйте solveOde»', () => {
    const backend = createRadauIiaOdeBackend();
    const outcome = backend.solve({ kind: 'ode', stateDimension: 1 });
    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') {
      expect(outcome.diagnostics.backendId).toBe('ts-radau-iia');
      expect(outcome.diagnostics.message).toContain('solveOde');
    }
    // никогда не 'solved' и не 'not_implemented': методов «через solve» нет,
    // но реализация есть — это не ложное заявление
    expect(outcome.status).not.toBe('solved');
    expect(outcome.status).not.toBe('not_implemented');
  });
});

describe('Stage 4.5.3 Radau IIA: контракт проходит валидатор', () => {
  it('validateBackendContract не находит проблем у реального backend', () => {
    const backend = createRadauIiaOdeBackend();
    expect(validateBackendContract(backend)).toEqual([]);
  });

  it('type guard распознаёт ODE-backend', () => {
    const backend = createRadauIiaOdeBackend();
    expect(isOdeSolverBackend(backend as SolverBackend)).toBe(true);
  });

  it('реестр регистрирует backend после проверки контракта', () => {
    const registry = createSolverBackendRegistry();
    registry.registerAvailable(createRadauIiaOdeBackend());
    expect(registry.findAvailable('ts-radau-iia')?.id).toBe('ts-radau-iia');
    expect(registry.listAvailable().map((b) => b.id)).toEqual(['ts-radau-iia']);
  });

  it('прямой вызов solveOdeWithRadauIia решает контрольную задачу', () => {
    const result = solveOdeWithRadauIia(decayProblem, { rtol: 1e-8, atol: 1e-12 });
    expect(result.status).toBe('solved');
    expect(Math.abs(result.y[0] - Math.exp(-1))).toBeLessThan(1e-6);
  });
});

describe('Stage 4.5.3 Radau IIA: валидатор ловит фальшивые ODE-бэкенды', () => {
  const goodOdeResult = (): OdeSolverResult => ({
    status: 'solved',
    method: 'fake',
    t0: 0,
    tEnd: 1,
    t: 1,
    y: [Math.exp(-1)],
    points: [],
    stats: {
      attemptedSteps: 1,
      acceptedSteps: 1,
      rejectedSteps: 0,
      newtonFailures: 0,
      rhsEvaluations: 1,
      jacobianEvaluations: 1,
      luFactorizations: 1,
      maxNewtonIterationsUsed: 1,
      maxAcceptedStepSize: 1,
      minAcceptedStepSize: 1
    },
    diagnostics: { backendId: 'fake-ode', method: 'fake', message: 'x', minorNegativeCount: 0, invariantChecks: 0 }
  });

  function fakeBackend(overrides: {
    capabilities?: Record<string, unknown>;
    solveOde?: (problem: unknown, options?: unknown) => OdeSolverResult;
  }): SolverBackend {
    return {
      id: 'fake-ode',
      version: '1.0.0',
      capabilities: {
        problemKinds: ['ode'],
        implementedMethods: ['fake'],
        adaptiveStep: true,
        implicit: true,
        stiff: true,
        sparseJacobian: false,
        maxStateDimension: 64,
        deterministic: 'within_tolerance',
        ...overrides.capabilities
      },
      supports: () => true,
      solve: () => ({
        status: 'error' as const,
        diagnostics: { backendId: 'fake-ode', problemKind: 'ode' as const, message: 'x' }
      }),
      solveOde: overrides.solveOde ?? (() => goodOdeResult())
    } as unknown as SolverBackend;
  }

  it('честный фейк с корректным решением проходит без issues', () => {
    expect(validateBackendContract(fakeBackend({}))).toEqual([]);
  });

  it('ODE-backend обязан заявлять класс ode', () => {
    const issues = validateBackendContract(fakeBackend({ capabilities: { problemKinds: ['linear_system'] } }));
    expect(issues.some((i) => i.code === 'ode_capabilities_invalid')).toBe(true);
  });

  it('ODE-backend обязан заявлять реализованные методы', () => {
    const issues = validateBackendContract(fakeBackend({ capabilities: { implementedMethods: [] } }));
    expect(issues.some((i) => i.code === 'ode_capabilities_invalid')).toBe(true);
  });

  it('stiff без implicit — противоречивые capabilities', () => {
    const issues = validateBackendContract(fakeBackend({ capabilities: { implicit: false } }));
    expect(issues.some((i) => i.code === 'ode_capabilities_invalid')).toBe(true);
  });

  it('неверное решение контрольной задачи y\' = -y ловится', () => {
    const issues = validateBackendContract(
      fakeBackend({ solveOde: () => ({ ...goodOdeResult(), y: [999] }) })
    );
    expect(issues.some((i) => i.code === 'ode_solution_invalid')).toBe(true);
  });

  it('solveOde, бросающий исключение, ловится', () => {
    const issues = validateBackendContract(
      fakeBackend({ solveOde: () => { throw new Error('boom'); } })
    );
    expect(issues.some((i) => i.code === 'ode_solution_invalid')).toBe(true);
  });
});

describe('Stage 4.5.3 Radau IIA: валидация входов (invalid_input)', () => {
  const backend = createRadauIiaOdeBackend();

  it('tEnd ≤ t0 отвергается', () => {
    expectOdeError(
      () => backend.solveOde({ ...decayProblem, t0: 0, tEnd: 0 }),
      'invalid_input'
    );
  });

  it('не-конечный y0 отвергается', () => {
    expectOdeError(
      () => backend.solveOde({ ...decayProblem, y0: [NaN] }),
      'invalid_input'
    );
  });

  it('rtol ≤ 0 отвергается', () => {
    expectOdeError(
      () => backend.solveOde(decayProblem, { rtol: 0 }),
      'invalid_input'
    );
  });

  it('atol-массив не той длины отвергается', () => {
    const problem = { ...decayProblem, stateDimension: 3, y0: [1, 0, 0], rhs: () => [0, 0, 0] };
    expectOdeError(
      () => backend.solveOde(problem, { atol: [1e-12, 1e-12] }),
      'invalid_input'
    );
  });

  it('stateDimension ≠ y0.length отвергается', () => {
    expectOdeError(
      () => backend.solveOde({ ...decayProblem, stateDimension: 3 }),
      'invalid_input'
    );
  });

  it('некорректный nonNegativeIndices отвергается', () => {
    expectOdeError(
      () => backend.solveOde({ ...decayProblem, nonNegativeIndices: [5] }),
      'invalid_input'
    );
  });

  it('размерность выше плотного предела (64) отвергается', () => {
    const bigY0 = new Array<number>(65).fill(0);
    const problem = {
      ...decayProblem,
      stateDimension: 65,
      y0: bigY0,
      rhs: (_t: number, y: readonly number[]): number[] => y.map(() => 0)
    };
    expectOdeError(() => backend.solveOde(problem), 'invalid_input');
  });
});

describe('Stage 4.5.3 Radau IIA: диагностические коды rhs', () => {
  const backend = createRadauIiaOdeBackend();

  it('исключение в rhs → rhs_callback_error', () => {
    expectOdeError(
      () =>
        backend.solveOde({
          ...decayProblem,
          rhs: () => {
            throw new Error('boom');
          }
        }),
      'rhs_callback_error'
    );
  });

  it('rhs вернул не ту размерность → rhs_dimension_mismatch', () => {
    expectOdeError(
      () => backend.solveOde({ ...decayProblem, rhs: () => [1, 2] }),
      'rhs_dimension_mismatch'
    );
  });

  it('rhs вернул NaN → rhs_non_finite', () => {
    expectOdeError(
      () => backend.solveOde({ ...decayProblem, rhs: () => [NaN] }),
      'rhs_non_finite'
    );
  });
});

describe('Stage 4.5.3 Radau IIA: диагностические коды якобиана', () => {
  const backend = createRadauIiaOdeBackend();

  it('исключение в якобиане → jacobian_callback_error', () => {
    expectOdeError(
      () =>
        backend.solveOde({
          ...decayProblem,
          jacobian: () => {
            throw new Error('boom');
          }
        }),
      'jacobian_callback_error'
    );
  });

  it('неправильная форма якобиана → jacobian_invalid', () => {
    expectOdeError(
      () => backend.solveOde({ ...decayProblem, jacobian: () => [[1, 2]] }),
      'jacobian_invalid'
    );
  });

  it('NaN в якобиане → jacobian_invalid', () => {
    expectOdeError(
      () => backend.solveOde({ ...decayProblem, jacobian: () => [[NaN]] }),
      'jacobian_invalid'
    );
  });
});

describe('Stage 4.5.3 Radau IIA: tEval', () => {
  const backend = createRadauIiaOdeBackend();

  it('неубывающий tEval → t_eval_invalid', () => {
    expectOdeError(
      () => backend.solveOde(decayProblem, { tEval: [0.5, 0.2] }),
      't_eval_invalid'
    );
  });

  it('tEval за пределами [t0, tEnd] → t_eval_invalid', () => {
    expectOdeError(
      () => backend.solveOde(decayProblem, { tEval: [0.5, 2] }),
      't_eval_invalid'
    );
  });

  it('валидный tEval: точки возвращаются ровно в заданные времена', () => {
    const result = backend.solveOde(decayProblem, { tEval: [0.25, 0.5, 1] });
    expect(result.points.length).toBe(3);
    expect(result.points.map((p) => p.t)).toEqual([0.25, 0.5, 1]);
    // точные значения e^-t в контрольных точках (rtol по умолчанию 1e-6)
    for (const p of result.points) {
      expect(Math.abs(p.y[0] - Math.exp(-p.t))).toBeLessThan(1e-6);
    }
    expect(result.t).toBe(1);
  });

  it('tEval может содержать t0', () => {
    const result = backend.solveOde(decayProblem, { tEval: [0, 0.5, 1] });
    expect(result.points.map((p) => p.t)).toEqual([0, 0.5, 1]);
    expect(result.points[0].y[0]).toBe(1);
  });

  it('без tEval в конце возвращается конечная точка', () => {
    const result = backend.solveOde(decayProblem, { tEval: [0.5] });
    expect(result.points.map((p) => p.t)).toEqual([0.5, 1]);
  });
});

describe('Stage 4.5.3 Radau IIA: эталон Robertson', () => {
  const backend = createRadauIiaOdeBackend();

  it('6 контрольных времён через tEval: точность, инвариант, неотрицательность', () => {
    const result = backend.solveOde(robertsonProblem, {
      rtol: 1e-8,
      atol: [1e-14, 1e-22, 1e-14],
      tEval: [0.4, 4, 400, 4e4, 4e8, 1e11]
    });
    expect(result.status).toBe('solved');
    expect(result.points.length).toBe(6);
    expect(result.t).toBe(1e11);
    for (let i = 0; i < 6; i++) {
      const p = result.points[i];
      const ref = ROBERTSON_REF[i];
      // t присваивается ровно заданному времени — никакой интерполяционной подмены
      expect(p.t).toBe(ref[0]);
      const relx = Math.abs(p.y[0] - ref[1]) / ref[1];
      const rely = Math.abs(p.y[1] - ref[2]) / ref[2];
      const relz = Math.abs(p.y[2] - ref[3]) / ref[3];
      expect(relx).toBeLessThanOrEqual(2e-6);
      expect(rely).toBeLessThanOrEqual(5e-4);
      expect(relz).toBeLessThanOrEqual(2e-6);
      // линейный инвариант x + y + z = 1
      expect(Math.abs(p.y[0] + p.y[1] + p.y[2] - 1)).toBeLessThanOrEqual(1e-8);
      // без существенных отрицательных
      for (const v of p.y) expect(v).toBeGreaterThanOrEqual(0);
    }
    // молчаливого clipping не было
    expect(result.diagnostics.minorNegativeCount).toBe(0);
    // инвариант проверялся после каждого принятого шага
    expect(result.diagnostics.invariantChecks).toBeGreaterThan(0);
    expect(result.stats.acceptedSteps).toBeGreaterThan(0);
    // честная статистика: каждая попытка шага заканчивается
    // принятием либо отказом; отказы Ньютона учтены в rejectedSteps
    expect(result.stats.attemptedSteps).toBe(result.stats.acceptedSteps + result.stats.rejectedSteps);
    expect(result.stats.rejectedSteps).toBeGreaterThanOrEqual(result.stats.newtonFailures);
    expect(result.stats.maxNewtonIterationsUsed).toBeLessThanOrEqual(10);
  });
});

describe('Stage 4.5.3 Radau IIA: сходимость по rtol', () => {
  const backend = createRadauIiaOdeBackend();
  const ref400 = ROBERTSON_REF[2];

  it('более строгий rtol даёт более точное решение', () => {
    const coarse = backend.solveOde(
      { ...robertsonProblem, tEnd: 400 },
      { rtol: 1e-3, atol: [1e-10, 1e-14, 1e-10], tEval: [400] }
    );
    const fine = backend.solveOde(
      { ...robertsonProblem, tEnd: 400 },
      { rtol: 1e-8, atol: [1e-14, 1e-22, 1e-14], tEval: [400] }
    );
    const coarseErr = Math.abs(coarse.points[0].y[0] - ref400[1]) / ref400[1];
    const fineErr = Math.abs(fine.points[0].y[0] - ref400[1]) / ref400[1];
    expect(coarseErr).toBeLessThan(1e-4);
    expect(fineErr).toBeLessThan(1e-6);
    expect(fineErr).toBeLessThan(coarseErr);
    // более строгий допуск требует больше шагов
    expect(fine.stats.acceptedSteps).toBeGreaterThan(coarse.stats.acceptedSteps);
  });
});

describe('Stage 4.5.3 Radau IIA: аналитический и численный якобиан', () => {
  const backend = createRadauIiaOdeBackend();
  const ref4e4 = ROBERTSON_REF[3];

  it('численный якобиан (конечные разности) даёт решение в тех же пределах точности', () => {
    const problem = {
      ...robertsonProblem,
      jacobian: undefined,
      tEnd: 4e4,
      nonNegativeIndices: undefined,
      linearInvariants: undefined
    };
    const numerical = backend.solveOde(problem, { rtol: 1e-8, atol: [1e-14, 1e-22, 1e-14], tEval: [4e4] });
    expect(numerical.stats.jacobianEvaluations).toBeGreaterThan(0);
    const relx = Math.abs(numerical.points[0].y[0] - ref4e4[1]) / ref4e4[1];
    expect(relx).toBeLessThanOrEqual(1e-6);
  });

  it('решения с аналитическим и численным якобианом близки', () => {
    const options = { rtol: 1e-8, atol: [1e-14, 1e-22, 1e-14], tEval: [4e4] } as const;
    const analytic = backend.solveOde({ ...robertsonProblem, tEnd: 4e4 }, options);
    const numerical = backend.solveOde(
      { ...robertsonProblem, jacobian: undefined, tEnd: 4e4, nonNegativeIndices: undefined, linearInvariants: undefined },
      options
    );
    for (let a = 0; a < 3; a++) {
      const diff = Math.abs(analytic.points[0].y[a] - numerical.points[0].y[a]);
      expect(diff).toBeLessThan(1e-6 * Math.max(Math.abs(ref4e4[a + 1]), 1e-12));
    }
  });
});

describe('Stage 4.5.3 Radau IIA: L-устойчивость на жёсткой задаче', () => {
  const backend = createRadauIiaOdeBackend();

  it('y\' = -1e6·y: монотонное затухание без осцилляций, maxStep соблюдён', () => {
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 10,
        y0: [1],
        rhs: (_t: number, y: readonly number[]): number[] => [-1e6 * y[0]]
      },
      { maxStep: 1, tEval: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }
    );
    expect(result.points.length).toBe(10);
    expect(result.stats.maxAcceptedStepSize).toBeLessThanOrEqual(1);
    // бесконечно жёсткая мода затухает: монотонность и положительность
    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i].y[0]).toBeLessThan(result.points[i - 1].y[0]);
      expect(result.points[i].y[0]).toBeGreaterThan(0);
    }
    // L-устойчивость: за t = 10 (λ·t = 1e7) решение на порядки ниже 1e-150
    expect(result.y[0]).toBeLessThan(1e-150);
  });
});

describe('Stage 4.5.3 Radau IIA: ограничение шага maxStep', () => {
  it('принятые шаги не превышают maxStep', () => {
    const backend = createRadauIiaOdeBackend();
    const result = backend.solveOde(decayProblem, { maxStep: 0.3 });
    expect(result.stats.maxAcceptedStepSize).toBeLessThanOrEqual(0.3);
    expect(result.stats.acceptedSteps).toBeGreaterThanOrEqual(3);
  });
});

describe('Stage 4.5.3 Radau IIA: лимиты решателя (fail-closed)', () => {
  const backend = createRadauIiaOdeBackend();

  it('maxSteps: превышение лимита попыток → max_steps_exceeded', () => {
    expectOdeError(
      () =>
        backend.solveOde(
          { ...robertsonProblem, nonNegativeIndices: undefined, linearInvariants: undefined },
          { maxSteps: 10, rtol: 1e-8, atol: [1e-14, 1e-22, 1e-14] }
        ),
      'max_steps_exceeded'
    );
  });

  it('minStep: невозможность уменьшить шаг для точности → min_step_violated', () => {
    // y' = -y, h вынужден быть ≥ 0.9, но ошибка шага при h = 0.9
    // (err ≈ 83 при rtol = 1e-8) требует уменьшения — fail-closed.
    expectOdeError(
      () => backend.solveOde(decayProblem, { rtol: 1e-8, minStep: 0.9 }),
      'min_step_violated'
    );
  });

  it('minStep + жёсткая нелинейность: Ньютон не может сойтись → newton_non_convergence', () => {
    // Robertson с minStep = 1e3: стартовый шаг поднят до minStep,
    // Ньютон на нём расходится, уменьшение ниже minStep невозможно.
    expectOdeError(
      () =>
        backend.solveOde(
          { ...robertsonProblem, tEnd: 1e11, nonNegativeIndices: undefined, linearInvariants: undefined },
          { minStep: 1e3, rtol: 1e-8, atol: [1e-14, 1e-22, 1e-14] }
        ),
      'newton_non_convergence'
    );
  });

  it('ограничение итераций Ньютона: newton_non_convergence', () => {
    expectOdeError(
      () =>
        backend.solveOde(
          { ...robertsonProblem, tEnd: 10, nonNegativeIndices: undefined, linearInvariants: undefined },
          { maxNewtonIterations: 1, minStep: 1e-2 }
        ),
      'newton_non_convergence'
    );
  });

  it('сингулярная система стадий: lu_singular (fail-closed, немедленно)', () => {
    // n = 1, y' = 0, J = 1: при h, равном собственному значению,
    // обратному вещественному λ(A), det(I − h·A) = 0.
    const muReal = 3 + Math.pow(3, 2 / 3) - Math.cbrt(3);
    expectOdeError(
      () =>
        backend.solveOde(
          {
            kind: 'ode',
            stateDimension: 1,
            t0: 0,
            tEnd: 10,
            y0: [1],
            rhs: () => [0],
            jacobian: () => [[1]]
          },
          { initialStep: muReal }
        ),
      'lu_singular'
    );
  });
});

describe('Stage 4.5.3 Radau IIA: неотрицательность без молчаливого clipping', () => {
  const backend = createRadauIiaOdeBackend();

  it('существенное отрицательное значение → nonneg_violation', () => {
    // y' = -1, y(0) = 0.5: решение уходит ниже нуля при t > 0.5,
    // продолжение невозможно без молчаливой коррекции вектора.
    expectOdeError(
      () =>
        backend.solveOde(
          {
            kind: 'ode',
            stateDimension: 1,
            t0: 0,
            tEnd: 1,
            y0: [0.5],
            rhs: () => [-1],
            nonNegativeIndices: [0]
          },
          { minStep: 1e-3 }
        ),
      'nonneg_violation'
    );
  });

  it('небольшое отрицательное в пределах допуска сохраняется как есть (с диагностикой)', () => {
    // y(0.50001) = -1e-5, atol = 1e-4: минус в пределах допуска —
    // значение сохранено БЕЗ clipping и явно посчитано в диагностике.
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 0.50001,
        y0: [0.5],
        rhs: () => [-1],
        nonNegativeIndices: [0]
      },
      { atol: 1e-4 }
    );
    expect(result.status).toBe('solved');
    expect(result.y[0]).toBeLessThan(0);
    expect(Math.abs(result.y[0] + 1e-5)).toBeLessThan(1e-9);
    expect(result.diagnostics.minorNegativeCount).toBeGreaterThanOrEqual(1);
  });
});

describe('Stage 4.5.3 Radau IIA: линейные инварианты', () => {
  const backend = createRadauIiaOdeBackend();

  it('инвариант, нарушенный уже на y0, → invariant_violation (без коррекции вектора)', () => {
    expectOdeError(
      () =>
        backend.solveOde({
          kind: 'ode',
          stateDimension: 2,
          t0: 0,
          tEnd: 1,
          y0: [1, 1],
          rhs: () => [0, 0],
          linearInvariants: [{ coefficients: [1, 1], expected: 1 }]
        }),
      'invariant_violation'
    );
  });

  it('rhs, разрушающий инвариант, → invariant_violation (fail-closed)', () => {
    // x растёт с постоянной скоростью 100: инвариант x + y = 2
    // нарушается на каждом шаге; minStep не даёт уменьшить шаг дальше.
    expectOdeError(
      () =>
        backend.solveOde(
          {
            kind: 'ode',
            stateDimension: 2,
            t0: 0,
            tEnd: 1,
            y0: [1, 1],
            rhs: () => [100, 0],
            linearInvariants: [{ coefficients: [1, 1], expected: 2 }]
          },
          { minStep: 1e-6 }
        ),
      'invariant_violation'
    );
  });

  it('сохраняющийся инвариант проверяется после принятых шагов и не мешает решению', () => {
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 2,
        t0: 0,
        tEnd: 1,
        y0: [1, 1],
        rhs: (_t: number, y: readonly number[]): number[] => [-y[0], -y[1]],
        linearInvariants: [{ coefficients: [1, -1], expected: 0 }]
      },
      { rtol: 1e-8 }
    );
    expect(result.status).toBe('solved');
    expect(result.diagnostics.invariantChecks).toBeGreaterThan(0);
    // x(t) − y(t) = 0 сохраняется
    expect(Math.abs(result.y[0] - result.y[1])).toBeLessThan(1e-9);
  });
});

// ============================================
// КОРРЕКТИРУЮЩАЯ РЕВИЗИЯ 4.5.3 (по независимому аудиту)
// ============================================

describe('Корректирующая ревизия 4.5.3: выбор начального шага', () => {
  const backend = createRadauIiaOdeBackend();

  it('y\' = 1 при y0 = [0]: нет нулевых шагов, y(1) = 1 точно', () => {
    // Вырожденный случай select_initial_step: d0 = 0 не должен
    // давать нулевой шаг (зацикливание) — fallback строго
    // положителен, линейная задача интегрируется точно.
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 1,
        y0: [0],
        rhs: () => [1]
      },
      { rtol: 1e-6, atol: 1e-12 }
    );
    expect(result.status).toBe('solved');
    expect(result.t).toBe(1);
    expect(result.y[0]).toBe(1);
    expect(result.stats.acceptedSteps).toBeGreaterThan(0);
    expect(result.stats.attemptedSteps).toBe(result.stats.acceptedSteps + result.stats.rejectedSteps);
  });

  it('все компоненты y0 нулевые: решение строится точно', () => {
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 3,
        t0: 0,
        tEnd: 1,
        y0: [0, 0, 0],
        rhs: () => [1, -2, 0.5]
      },
      { rtol: 1e-6, atol: 1e-12 }
    );
    expect(result.status).toBe('solved');
    expect(result.y[0]).toBe(1);
    expect(result.y[1]).toBe(-2);
    expect(result.y[2]).toBe(0.5);
  });

  it('первый шаг ограничен maxStep: maxAcceptedStepSize ≤ maxStep', () => {
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 1,
        y0: [0],
        rhs: () => [1]
      },
      { rtol: 1e-6, atol: 1e-12, maxStep: 0.01 }
    );
    expect(result.status).toBe('solved');
    expect(result.stats.maxAcceptedStepSize).toBeLessThanOrEqual(0.01);
    expect(result.stats.acceptedSteps).toBeGreaterThanOrEqual(100);
    // финальный шаг до tEnd дробный: допускаем ошибку округления double
    expect(result.y[0]).toBeCloseTo(1, 12);
  });
});

describe('Корректирующая ревизия 4.5.3: защита от NaN/Infinity', () => {
  const backend = createRadauIiaOdeBackend();

  it('переполняющая rhs (1e308) → numerical_failure, а не «solved» с Inf', () => {
    expectOdeError(
      () =>
        backend.solveOde({
          kind: 'ode',
          stateDimension: 1,
          t0: 0,
          tEnd: 1,
          y0: [1],
          rhs: () => [1e308]
        }),
      'numerical_failure'
    );
  });

  it('взрывная задача y\' = y² не возвращается как solved', () => {
    // Решение уходит в бесконечность при t = 1: интегратор обязан
    // бросить ошибку (любой численный код), а не вернуть «solved»
    // с NaN/Infinity в векторе состояния.
    let caught: unknown;
    try {
      backend.solveOde({
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 2,
        y0: [1],
        rhs: (_t: number, y: readonly number[]): number[] => [y[0] * y[0]]
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OdeSolverError);
  });

  it('luFactor отвергает не-конечные входы (null)', () => {
    expect(luFactor([[NaN, 1], [1, 1]])).toBeNull();
    expect(luFactor([[Infinity, 1], [1, 1]])).toBeNull();
  });

  it('luSolve с не-конечной правой частью → numerical_failure', () => {
    const F = luFactor([
      [4, 1],
      [1, 3]
    ]);
    expectOdeError(() => luSolve(F!, [NaN, 1]), 'numerical_failure');
    expectOdeError(() => luSolve(F!, [1, Infinity]), 'numerical_failure');
  });
});

describe('Корректирующая ревизия 4.5.3: строгая валидация лимитов', () => {
  const backend = createRadauIiaOdeBackend();

  it('maxSteps: только конечные целые ≥ 1 (иначе invalid_input)', () => {
    expectOdeError(() => backend.solveOde(decayProblem, { maxSteps: 2.5 }), 'invalid_input');
    expectOdeError(() => backend.solveOde(decayProblem, { maxSteps: 0 }), 'invalid_input');
    expectOdeError(() => backend.solveOde(decayProblem, { maxSteps: -5 }), 'invalid_input');
    expectOdeError(() => backend.solveOde(decayProblem, { maxSteps: NaN }), 'invalid_input');
    expectOdeError(() => backend.solveOde(decayProblem, { maxSteps: Infinity }), 'invalid_input');
  });

  it('maxNewtonIterations: только конечные целые ≥ 1 (иначе invalid_input)', () => {
    expectOdeError(() => backend.solveOde(decayProblem, { maxNewtonIterations: 1.5 }), 'invalid_input');
    expectOdeError(() => backend.solveOde(decayProblem, { maxNewtonIterations: 0 }), 'invalid_input');
    expectOdeError(() => backend.solveOde(decayProblem, { maxNewtonIterations: NaN }), 'invalid_input');
    expectOdeError(() => backend.solveOde(decayProblem, { maxNewtonIterations: Infinity }), 'invalid_input');
  });

  it('minStep > maxStep — противоречивые лимиты шага (invalid_input)', () => {
    expectOdeError(
      () => backend.solveOde(decayProblem, { minStep: 0.5, maxStep: 0.1 }),
      'invalid_input'
    );
  });

  it('minStep больше интервала (maxStep по умолчанию = span) — тоже противоречие', () => {
    expectOdeError(() => backend.solveOde(decayProblem, { minStep: 5 }), 'invalid_input');
  });
});

describe('Корректирующая ревизия 4.5.3: неотрицательность начального состояния', () => {
  const backend = createRadauIiaOdeBackend();

  it('существенно отрицательный y0 → nonneg_violation с диагностикой (без clipping)', () => {
    let caught: unknown;
    try {
      backend.solveOde({
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 1,
        y0: [-1],
        rhs: () => [0],
        nonNegativeIndices: [0]
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OdeSolverError);
    const err = caught as OdeSolverError;
    expect(err.code).toBe('nonneg_violation');
    expect(err.details?.index).toBe(0);
    expect(err.details?.value).toBe(-1);
    // допуск = atol + rtol·|v| = 1e-12 + 1e-6·1
    expect(err.details?.tolerance).toBeCloseTo(1.000001e-6, 12);
  });

  it('небольшой минус y0 в пределах допуска сохраняется без исправления', () => {
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 1,
        y0: [-1e-13],
        rhs: () => [0],
        nonNegativeIndices: [0]
      },
      { atol: 1e-12 }
    );
    expect(result.status).toBe('solved');
    // сохранён КАК ЕСТЬ, без молчаливого clipping
    expect(result.y[0]).toBe(-1e-13);
  });
});

describe('Корректирующая ревизия 4.5.3: масштабирование допуска инвариантов', () => {
  const backend = createRadauIiaOdeBackend();

  it('нарушение при малых концентрациях (~1e-18) видно (старый допуск max(1, ·) его не видел бы)', () => {
    // Инвариант y1 − y2 = 0 при y ~ 1e-20: дрейф 1e-18 за единицу
    // времени. Допуск масштабируется по данным (Σ|c_i|·atol_i +
    // rtol·Σ|c_i·y_i| ~ 2e-26), а не по max(1, ·) = 1e-6.
    expectOdeError(
      () =>
        backend.solveOde(
          {
            kind: 'ode',
            stateDimension: 2,
            t0: 0,
            tEnd: 1,
            y0: [1e-20, 1e-20],
            rhs: () => [0, 1e-18],
            linearInvariants: [{ coefficients: [1, -1], expected: 0 }]
          },
          { rtol: 1e-6, atol: 1e-30, minStep: 1e-6 }
        ),
      'invariant_violation'
    );
  });

  it('сохраняющийся инвариант при малых концентрациях решается (допуск масштабируется по данным)', () => {
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 2,
        t0: 0,
        tEnd: 1,
        y0: [1e-20, 1e-20],
        rhs: (_t: number, y: readonly number[]): number[] => [-y[0], -y[1]],
        linearInvariants: [{ coefficients: [1, -1], expected: 0 }]
      },
      { rtol: 1e-6, atol: 1e-30 }
    );
    expect(result.status).toBe('solved');
    expect(result.diagnostics.invariantChecks).toBeGreaterThan(0);
    // обе компоненты интегрируются идентично: дрейф нулевой
    expect(Math.abs(result.y[0] - result.y[1])).toBeLessThanOrEqual(1e-36);
  });

  it('relTolerance на инварианте расширяет допуск по масштабу данных', () => {
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 2,
        t0: 0,
        tEnd: 1,
        y0: [1, 1],
        rhs: () => [-1, 0],
        linearInvariants: [{ coefficients: [1, -1], expected: 0, relTolerance: 1 }]
      },
      { rtol: 1e-6 }
    );
    expect(result.status).toBe('solved');
    // дрейф x − y от 0 до −1 допускается relTolerance = 1
    expect(result.y[0] - result.y[1]).toBeLessThanOrEqual(0);
  });

  it('некорректные absTolerance/relTolerance инварианта → invalid_input', () => {
    const base = {
      kind: 'ode' as const,
      stateDimension: 2,
      t0: 0,
      tEnd: 1,
      y0: [1, 1],
      rhs: () => [0, 0]
    };
    expectOdeError(
      () =>
        backend.solveOde({
          ...base,
          linearInvariants: [{ coefficients: [1, -1], expected: 0, absTolerance: NaN }]
        }),
      'invalid_input'
    );
    expectOdeError(
      () =>
        backend.solveOde({
          ...base,
          linearInvariants: [{ coefficients: [1, -1], expected: 0, absTolerance: -1 }]
        }),
      'invalid_input'
    );
    expectOdeError(
      () =>
        backend.solveOde({
          ...base,
          linearInvariants: [{ coefficients: [1, -1], expected: 0, relTolerance: -0.5 }]
        }),
      'invalid_input'
    );
  });
});

describe('Корректирующая ревизия 4.5.3: честная статистика шагов', () => {
  const backend = createRadauIiaOdeBackend();

  it('Robertson: attemptedSteps === acceptedSteps + rejectedSteps, rejectedSteps ≥ newtonFailures', () => {
    const result = backend.solveOde(robertsonProblem, {
      rtol: 1e-8,
      atol: [1e-14, 1e-22, 1e-14],
      tEval: [0.4, 4, 400, 4e4, 4e8, 1e11]
    });
    expect(result.status).toBe('solved');
    expect(result.stats.attemptedSteps).toBe(result.stats.acceptedSteps + result.stats.rejectedSteps);
    expect(result.stats.rejectedSteps).toBeGreaterThanOrEqual(result.stats.newtonFailures);
  });

  it('отказы Ньютона учитываются и в rejectedSteps (сценарий с newtonFailures > 0)', () => {
    // Robertson с завышенным initialStep: первые попытки Ньютона
    // расходятся, шаг уменьшается — интегрирование завершается,
    // и каждый отказ Ньютона учтён и в newtonFailures, и в
    // rejectedSteps.
    const result = backend.solveOde(
      { ...robertsonProblem, tEnd: 1e3 },
      { rtol: 1e-8, atol: [1e-14, 1e-22, 1e-14], initialStep: 1e3 }
    );
    expect(result.status).toBe('solved');
    expect(result.stats.newtonFailures).toBeGreaterThan(0);
    expect(result.stats.rejectedSteps).toBeGreaterThanOrEqual(result.stats.newtonFailures);
    expect(result.stats.attemptedSteps).toBe(result.stats.acceptedSteps + result.stats.rejectedSteps);
  });
});

describe('Корректирующая ревизия 4.5.3 (этап 2): начальный шаг и honest minorNegativeCount', () => {
  const backend = createRadauIiaOdeBackend();

  it('короткий интервал: пробный вызов rhs не выходит за [t0, tEnd]', () => {
    // tEnd = 1e-6, y0 = [1], y' = 1: эвристика Hairer даёт пробный
    // шаг h0 = 0.01·d0/d1 = 0.01 >> span — без clamp h0 ≤ span rhs
    // вызывался бы при t = 0.01, вне [0, 1e-6]. Здесь rhs бросает
    // исключение при выходе за интервал: интегрирование обязано
    // завершиться без таких вызовов.
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 1e-6,
        y0: [1],
        rhs: (t) => {
          if (t < 0 || t > 1e-6) {
            throw new Error(`rhs вызван за пределами [0, 1e-6]: t = ${t}`);
          }
          return [1];
        }
      },
      { rtol: 1e-6, atol: 1e-12 }
    );
    expect(result.status).toBe('solved');
    expect(result.t).toBe(1e-6);
    expect(result.y[0]).toBeCloseTo(1.000001, 10);
    expect(result.stats.attemptedSteps).toBe(result.stats.acceptedSteps + result.stats.rejectedSteps);
  });

  it('времязависимая производная: d2 = norm(f1 − f0)/h0 задаёт начальный шаг ТОЧНО по формуле; точность против аналитики', () => {
    // y' = 1 + 10·sin(50t), y(0) = 1: аналитика
    // y = 1 + t + 0.2·(1 − cos(50t)). Производная сильно меняется
    // уже на пробном шаге: корректный d2 — норма ИЗМЕНЕНИЯ
    // производной (SciPy), а не норма самой f1. Итоговой точности
    // недостаточно для проверки d2 (адаптивный интегратор
    // достаёт её и с неверным начальным шагом), поэтому spy rhs
    // фиксирует пробный вызов (t0 + h0) и стадию первой попытки,
    // а ожидаемые значения считаются по эталонной формуле.
    const analytic = (t: number): number => 1 + t + 0.2 * (1 - Math.cos(50 * t));
    const rtol = 1e-8;
    const atol = 1e-12;
    // Эталонная формула SciPy select_initial_step; при n = 1
    // weightedRmsNorm(v, scale) = |v|/scale.
    const scale0 = atol + rtol * 1; // atol + rtol·|y0|
    const d0 = Math.abs(1) / scale0;
    const d1 = Math.abs(1) / scale0; // f(0) = 1
    const h0Exp = 0.01 * (d0 / d1); // d0, d1 ≥ 1e-5 → 0.01·d0/d1 = 0.01
    const f1Exp = 1 + 10 * Math.sin(50 * h0Exp);
    const d2 = Math.abs(f1Exp - 1) / scale0 / h0Exp; // norm(f1 − f0)/h0
    const h1Exp = Math.pow(0.01 / Math.max(d1, d2), 1 / 6);
    const hExp = Math.min(100 * h0Exp, h1Exp, 2, 2); // maxStep по умолчанию = span
    // Старое d2 = norm(f1) (без деления на h0) дало бы ДРУГОЙ шаг —
    // тест обязан различать формулы, а не только итоговую точность:
    const d2Old = Math.abs(f1Exp) / scale0;
    const h1Old = Math.pow(0.01 / Math.max(d1, d2Old), 1 / 6);
    const hOld = Math.min(100 * h0Exp, h1Old, 2, 2);
    expect(Math.abs(hExp - hOld)).toBeGreaterThan(1e-3);

    const rhsCalls: number[] = [];
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 2,
        y0: [1],
        rhs: (t: number) => {
          rhsCalls.push(t);
          return [1 + 10 * Math.sin(50 * t)];
        }
      },
      { rtol, atol, tEval: [0.5, 1, 1.5, 2] }
    );
    expect(result.status).toBe('solved');
    expect(result.points.length).toBe(4);
    for (const p of result.points) {
      expect(Math.abs(p.y[0] - analytic(p.t))).toBeLessThan(1e-6);
    }
    expect(Math.abs(result.y[0] - analytic(2))).toBeLessThan(1e-6);
    // Пробный вызов rhs — ровно при t0 + h0 (ветка 0.01·d0/d1):
    const probeT = rhsCalls.find((v) => v > 0);
    expect(probeT).toBeCloseTo(h0Exp, 12);
    // Первая попытка шага: стадия 1 полного шага при t0 + c1·h
    // (до неё rhs вызывался только при t0 и t0 + h0).
    const c1 = (4 - Math.sqrt(6)) / 10;
    const stage1T = rhsCalls.find((v: number) => v > 0 && Math.abs(v - h0Exp) > 1e-12);
    expect(stage1T).toBeDefined();
    const hFirst = (stage1T as number) / c1;
    // Начальный шаг РОВНО по эталонной формуле с d2 = norm(f1 − f0)/h0:
    expect(hFirst).toBeCloseTo(hExp, 10);
  });

  it('вырожденный случай: f0 ≈ 0 и Δf ≈ 0 — начальный шаг ТОЧНО по эталонной формуле (не h1 = Infinity)', () => {
    // y' = [0, 1e-30]: d1 ≈ 3.5e-25 < 1e-5 → h0 = 1e-6 (SciPy;
    // старая эвристика дала бы 1e-6·span = 5e-7 — пробный вызов
    // rhs это различает). d2 = 0, обе нормы вырождены (≤ 1e-15) →
    // h1 = max(1e-6, h0·1e-3) = 1e-6, итог
    // h = min(100·h0, h1, maxStep, span) = 1e-6 — РОВНО по
    // эталонной формуле, а не «любой шаг ≤ 1e-3». Ошибка шага
    // нулевая → первый шаг принят без отказов.
    const rhsCalls: number[] = [];
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 2,
        t0: 0,
        tEnd: 0.5,
        y0: [1, 2],
        rhs: (t: number) => {
          rhsCalls.push(t);
          return [0, 1e-30];
        }
      },
      { rtol: 1e-6, atol: 1e-12 }
    );
    expect(result.status).toBe('solved');
    expect(result.y[0]).toBe(1);
    expect(result.y[1]).toBe(2);
    // Пробный вызов rhs при t0 + h0 = 1e-6 (абсолютный fallback SciPy):
    const probeT = rhsCalls.find((v) => v > 0);
    expect(probeT).toBeCloseTo(1e-6, 12);
    // Первый принятый шаг — ровно 1e-6 = min(100·h0, max(1e-6, h0·1e-3), maxStep, span):
    expect(result.stats.minAcceptedStepSize).toBe(1e-6);
    expect(result.stats.rejectedSteps).toBe(0);
    expect(result.stats.minAcceptedStepSize).toBeGreaterThan(0);
    expect(result.stats.attemptedSteps).toBe(result.stats.acceptedSteps + result.stats.rejectedSteps);
  });

  it('minorNegativeCount: малый отрицательный y0 учтён ровно один раз, значение сохранено без clipping', () => {
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 1,
        y0: [-1e-13],
        rhs: () => [1],
        nonNegativeIndices: [0]
      },
      { rtol: 1e-6, atol: 1e-12, tEval: [0, 1] }
    );
    expect(result.status).toBe('solved');
    // y0 сохранён как есть (clipping запрещён)
    expect(result.points[0].y[0]).toBe(-1e-13);
    // y0 учтён; принятые состояния уже неотрицательны (rhs = 1
    // сразу уводит решение в плюс) — счётчик не завышен.
    expect(result.diagnostics.minorNegativeCount).toBe(1);
  });

  it('minorNegativeCount: считается по y0 и каждому принятому состоянию (rhs = 0)', () => {
    // Решение постоянно и чуть отрицательно: каждый принятый шаг
    // сохраняет малый минус — счётчик = 1 (y0) + acceptedSteps;
    // отклонённых проб нет (err = 0).
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 0.1,
        y0: [-1e-13],
        rhs: () => [0],
        nonNegativeIndices: [0]
      },
      { rtol: 1e-6, atol: 1e-12 }
    );
    expect(result.status).toBe('solved');
    expect(result.y[0]).toBe(-1e-13);
    expect(result.stats.rejectedSteps).toBe(0);
    expect(result.diagnostics.minorNegativeCount).toBe(1 + result.stats.acceptedSteps);
  });

  it('minorNegativeCount: кандидаты отклонённых попыток шага не учитываются', () => {
    // Robertson с завышенным initialStep: первые попытки Ньютона
    // расходятся и порождают «мусорные» кандидаты; принятая
    // траектория неотрицательна (эталон) — счётчик обязан
    // оставаться нулём, сколько бы отрицательных проб ни было.
    const result = backend.solveOde(
      { ...robertsonProblem, tEnd: 1e3 },
      { rtol: 1e-8, atol: [1e-14, 1e-22, 1e-14], initialStep: 1e3 }
    );
    expect(result.status).toBe('solved');
    expect(result.stats.rejectedSteps).toBeGreaterThan(0);
    expect(result.diagnostics.minorNegativeCount).toBe(0);
    expect(result.stats.attemptedSteps).toBe(result.stats.acceptedSteps + result.stats.rejectedSteps);
  });
});

describe('Корректирующая ревизия 4.5.3 (этап 3): точный select_initial_step SciPy и регрессия minorNegativeCount', () => {
  const backend = createRadauIiaOdeBackend();

  it('h0: d0 < 1e-5 → абсолютный fallback 1e-6 (НЕ 1e-6·span)', () => {
    // y0 = [0], y' = 1, span = 5: d0 = 0 < 1e-5 → h0 = 1e-6.
    // Старое условие по отношению d0/d1 = 0 < 1e-5 дало бы
    // fallback 1e-6·span = 5e-6 — пробный вызов rhs (первый вызов
    // с t > t0) это различает.
    const rhsCalls: number[] = [];
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 5,
        y0: [0],
        rhs: (t: number) => {
          rhsCalls.push(t);
          return [1];
        }
      },
      { rtol: 1e-6, atol: 1e-12 }
    );
    expect(result.status).toBe('solved');
    expect(result.t).toBe(5);
    expect(result.y[0]).toBeCloseTo(5, 10);
    const probeT = rhsCalls.find((v) => v > 0);
    expect(probeT).toBeCloseTo(1e-6, 12);
  });

  it('h0: d0, d1 ≥ 1e-5 при малом отношении → 0.01·d0/d1 (условие SciPy, а не отношение с fallback)', () => {
    // y0 = [1], y' = 1e8, span = 1e-3: d0 ≈ 1e6 и d1 ≈ 1e14 — обе
    // нормы ≥ 1e-5, но их отношение 1e-8 < 1e-5. SciPy использует
    // ветку 0.01·d0/d1 = 1e-10; старое условие по отношению ушло
    // бы в fallback 1e-6·span = 1e-9 — пробный вызов rhs различает.
    const rhsCalls: number[] = [];
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 1,
        t0: 0,
        tEnd: 1e-3,
        y0: [1],
        rhs: (t: number) => {
          rhsCalls.push(t);
          return [1e8];
        }
      },
      { rtol: 1e-6, atol: 1e-12 }
    );
    expect(result.status).toBe('solved');
    // y = 1 + 1e8·1e-3 = 100001 (константа интегрируется точно)
    expect(Math.abs(result.y[0] - 100001)).toBeLessThan(1e-6);
    const probeT = rhsCalls.find((v) => v > 0);
    expect(probeT).toBeCloseTo(1e-10, 12);
  });

  it('minorNegativeCount: кандидат с малым минусом, отклонённый ИНВАРИАНТОМ (не Ньютоном), не попадает в счётчик', () => {
    // Регрессия исходного дефекта: инкремент выполнялся в цикле
    // проверки неотрицательности кандидата ДО принятия шага,
    // поэтому минус кандидата, позже отклонённого инвариантом,
    // попадал в диагностику. Полностью детерминированный сценарий:
    // 1) rhs зависит только от t → якобиан нулевой, стадии решаются
    //    Ньютоном точно: newtonFailures = 0 (отказ не из-за Ньютона);
    // 2) initialStep = 1: первая попытка сэмплирует импульсы rhs
    //    только в моменты t = 0.5 (конец первого полушага) и t = 1
    //    (конец второго полушага и одновременно стадия-3 полного
    //    шага). Обе траектории (полный шаг и два полушага)
    //    накапливают ОДИНАКОВЫЙ вклад импульса (вес A_33 = 1/9 на
    //    каждый полушаг против A_33 = 1/9 на полный шаг) →
    //    step-doubling разность на уровне ulp, оценка ошибки
    //    проходит (отказ не из-за ошибки шага);
    // 3) кандидат yFine = [−1e-7, 2.1000001]: компонента 0 —
    //    небольшой минус в пределах допуска (atol + rtol·1 ≈ 1e-6)
    //    → проверка неотрицательности проходит;
    // 4) линейный инвариант y0 + y1 = 2 нарушен на 0.1 ≫ допуска
    //    → попытка отклонена именно инвариантом, h уменьшен до 0.3;
    // 5) все стадии последующих попыток (h = 0.3, затем рост ×5)
    //    НЕ попадают в окна импульсов → интегрирование завершается,
    //    принятые состояния положительны, траектория y = [1, 1];
    // 6) итог: minorNegativeCount = 0 — отвергнутый кандидат НЕ
    //    посчитан. Старый код (инкремент до проверок) дал бы 1.
    const W = 1e-9; // полуширина окна импульса
    const pulse = (t: number): boolean => Math.abs(t - 0.5) < W || Math.abs(t - 1) < W;
    const G = -9 * (1 + 1e-7); // вклад: 1 + (1/9)·G = −1e-7 (малый минус кандидата)
    const K = 0.9; // нарушение инварианта: (1/9)·K = 0.1
    const result = backend.solveOde(
      {
        kind: 'ode',
        stateDimension: 2,
        t0: 0,
        tEnd: 4,
        y0: [1, 1],
        rhs: (t: number) => (pulse(t) ? [G, -G + K] : [0, 0]),
        nonNegativeIndices: [0],
        linearInvariants: [{ coefficients: [1, 1], expected: 2 }]
      },
      { rtol: 1e-6, atol: 1e-12, initialStep: 1 }
    );
    expect(result.status).toBe('solved');
    expect(result.t).toBe(4);
    // отказ ровно один и именно по инварианту, а не по Ньютону:
    expect(result.stats.rejectedSteps).toBe(1);
    expect(result.stats.newtonFailures).toBe(0);
    // инвариант проверялся и на отклонённой попытке
    // (1 отклонённая + по одной на каждый принятый шаг):
    expect(result.diagnostics.invariantChecks).toBe(result.stats.acceptedSteps + 1);
    // РЕГРЕССИЯ: минус отвергнутого кандидата не в счётчике
    // (y0 и принятые состояния положительны):
    expect(result.diagnostics.minorNegativeCount).toBe(0);
    // после отказа импульсы не сэмплируются: y = [1, 1]
    expect(result.y[0]).toBe(1);
    expect(result.y[1]).toBe(1);
    expect(result.stats.attemptedSteps).toBe(result.stats.acceptedSteps + result.stats.rejectedSteps);
  });
});

describe('Корректирующая ревизия 4.5.3 (этап 4): minStep против эффективного максимума шага и диагностика rhs в численном якобиане', () => {
  const backend = createRadauIiaOdeBackend();

  it('minStep больше эффективного максимума шага min(maxStep, span) — invalid_input', () => {
    // Аудиторский пример: maxStep = 10 больше длины интервала (1),
    // поэтому старая проверка minStep > maxStep не срабатывала:
    // minStep = 2, maxStep = 10 на [0, 1]. Шаг длиннее tEnd − t0
    // невозможен — противоречие, а не разрешимая конфигурация.
    let caught: unknown;
    try {
      backend.solveOde(decayProblem, { minStep: 2, maxStep: 10 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OdeSolverError);
    expect((caught as OdeSolverError).code).toBe('invalid_input');
    expect((caught as OdeSolverError).details).toMatchObject({
      minStep: 2,
      maxStep: 10,
      effectiveMaxStep: 1,
      span: 1
    });
    // minStep ≤ эффективного максимума при maxStep > span — валидно:
    // проверка не перезажает допустимые конфигурации.
    const ok = backend.solveOde(decayProblem, { minStep: 0.25, maxStep: 10 });
    expect(ok.status).toBe('solved');
    expect(Math.abs(ok.y[0] - Math.exp(-1))).toBeLessThan(1e-6);
  });

  it('rhs бросает исключение на возмущённом состоянии конечных разностей → rhs_callback_error', () => {
    let baseCalls = 0;
    let perturbedCalls = 0;
    const problem = {
      ...decayProblem,
      rhs: (_t: number, y: readonly number[]): number[] => {
        // базовое состояние y0 = [1] валидно; возмущённое
        // (y[0] + sqrt(eps)·max(|y[0]|, 1e-8)) — бросает:
        // старый код превратил бы это в jacobian_callback_error
        if (y[0] === 1) {
          baseCalls++;
          return [-y[0]];
        }
        perturbedCalls++;
        throw new Error('rhs взорвался на возмущённом состоянии');
      }
    };
    expectOdeError(
      () => backend.solveOde(problem, { initialStep: 0.1 }),
      'rhs_callback_error'
    );
    // ошибка пришла именно из конечных разностей: базовых вызовов
    // ровно два (выбор начального шага + f0 численного якобиана),
    // возмущённых — один
    expect(baseCalls).toBe(2);
    expect(perturbedCalls).toBe(1);
  });

  it('rhs возвращает неверную размерность на возмущённом состоянии → rhs_dimension_mismatch', () => {
    const problem = {
      ...decayProblem,
      rhs: (_t: number, y: readonly number[]): number[] =>
        y[0] === 1 ? [-y[0]] : [0, 0] // длина 2 вместо 1
    };
    expectOdeError(
      () => backend.solveOde(problem, { initialStep: 0.1 }),
      'rhs_dimension_mismatch'
    );
  });

  it('rhs возвращает NaN на возмущённом состоянии → rhs_non_finite', () => {
    const problem = {
      ...decayProblem,
      rhs: (_t: number, y: readonly number[]): number[] =>
        y[0] === 1 ? [-y[0]] : [NaN]
    };
    expectOdeError(
      () => backend.solveOde(problem, { initialStep: 0.1 }),
      'rhs_non_finite'
    );
  });

  it('аналитический якобиан по-прежнему → jacobian_callback_error (регрессия passthrough)', () => {
    // пропуск ошибок rhs_* не должен съедать диагностику
    // пользовательского аналитического якобиана
    expectOdeError(
      () =>
        backend.solveOde({
          ...decayProblem,
          jacobian: () => {
            throw new Error('boom');
          }
        }),
      'jacobian_callback_error'
    );
  });
});

