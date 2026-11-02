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

  it('набор диагностических кодов ошибок полный (13 кодов)', () => {
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
      'invariant_violation'
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
    expect(result.stats.attemptedSteps).toBeGreaterThanOrEqual(result.stats.acceptedSteps);
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
