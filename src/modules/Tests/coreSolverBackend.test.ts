// ============================================
// STAGE 4.1 - Тесты контракта численных решателей
// ============================================

import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_PROBLEM_KINDS,
  validateBackendContract,
  createSolverBackendRegistry
} from '../Core/solverBackend';
import type { SolverBackend, SolverProblem, SolverOutcome, PlannedBackendDescriptor } from '../Core/solverBackend';

/**
 * Честный backend-пустышка: заявленных методов НЕТ, solve() всегда
 * возвращает not_implemented. Это валидный контракт — дескриптор,
 * который не притворяется реализацией.
 */
function emptyBackend(id: string): SolverBackend {
  return {
    id,
    version: '0.1.0',
    capabilities: {
      problemKinds: ['ode'],
      implementedMethods: [],
      adaptiveStep: false,
      implicit: false,
      stiff: false,
      sparseJacobian: false,
      maxStateDimension: 100,
      deterministic: 'within_tolerance'
    },
    supports(problem: SolverProblem): boolean {
      return problem.kind === 'ode';
    },
    solve(problem: SolverProblem): SolverOutcome {
      return {
        status: 'not_implemented',
        diagnostics: { backendId: id, problemKind: problem.kind, message: 'методы не реализованы' }
      };
    }
  };
}

describe('Stage 4.1 SolverBackend: контракт', () => {
  it('поддерживаемые классы задач определены явно', () => {
    expect([...SUPPORTED_PROBLEM_KINDS]).toEqual(['ode', 'dae', 'algebraic_equilibrium', 'linear_system']);
  });

  it('честный backend без методов проходит контракт', () => {
    const issues = validateBackendContract(emptyBackend('ts-empty'));
    expect(issues).toEqual([]);
  });

  it('пустой id и некорректная версия отвергаются', () => {
    expect(validateBackendContract(emptyBackend(' ')).some((i) => i.code === 'empty_id')).toBe(true);
    const badVersion = { ...emptyBackend('x'), version: '1.0' };
    expect(validateBackendContract(badVersion).some((i) => i.code === 'invalid_version')).toBe(true);
  });

  it('пустой список классов задач и неизвестный класс отвергаются', () => {
    const noKinds: SolverBackend = {
      ...emptyBackend('y'),
      capabilities: { ...emptyBackend('y').capabilities, problemKinds: [] }
    };
    expect(validateBackendContract(noKinds).some((i) => i.code === 'empty_problem_kinds')).toBe(true);
    const fakeKind: SolverBackend = {
      ...emptyBackend('z'),
      capabilities: { ...emptyBackend('z').capabilities, problemKinds: ['nbody' as never] }
    };
    expect(validateBackendContract(fakeKind).some((i) => i.code === 'unknown_problem_kind')).toBe(true);
  });

  it('некорректная максимальная размерность отвергается', () => {
    const badDim: SolverBackend = {
      ...emptyBackend('d'),
      capabilities: { ...emptyBackend('d').capabilities, maxStateDimension: 0 }
    };
    expect(validateBackendContract(badDim).some((i) => i.code === 'invalid_max_dimension')).toBe(true);
  });

  it('ложное заявление о реализованном методе ловится фактическим вызовом', () => {
    const liar: SolverBackend = {
      ...emptyBackend('liar'),
      capabilities: { ...emptyBackend('liar').capabilities, implementedMethods: ['rk4', 'bdf2'] }
    };
    const issues = validateBackendContract(liar);
    expect(issues.some((i) => i.code === 'unsupported_kind_claim')).toBe(true);
    expect(issues.find((i) => i.code === 'unsupported_kind_claim')?.message).toContain('ложное');
  });

  it('supports() отражает capabilities', () => {
    const b = emptyBackend('ode-only');
    expect(b.supports({ kind: 'ode', stateDimension: 2 })).toBe(true);
    expect(b.supports({ kind: 'linear_system', stateDimension: 2 })).toBe(false);
  });
});

describe('Stage 4.1 SolverBackend: реестр', () => {
  it('реестр разделяет доступные и планируемые backend\'ы', () => {
    const registry = createSolverBackendRegistry();
    const honest = emptyBackend('ts-empty');
    const planned: PlannedBackendDescriptor = {
      id: 'wasm-rust',
      version: '0.0.0',
      status: 'planned',
      capabilities: {
        problemKinds: ['ode', 'dae'],
        implementedMethods: [], // у плана методов нет — и не притворяются
        adaptiveStep: true,
        implicit: true,
        stiff: true,
        sparseJacobian: true,
        maxStateDimension: null,
        deterministic: 'platform_dependent'
      },
      plannedMethods: ['bdf2', 'radau5'],
      note: 'будущая реализация; детерминизм между WASM и TS не гарантируется битово'
    };
    registry.registerAvailable(honest);
    registry.registerPlanned(planned);
    expect(registry.listAvailable().length).toBe(1);
    expect(registry.listPlanned().length).toBe(1);
    // планируемый НЕ выдаёт себя за доступный
    expect(registry.listAvailable().map((b) => b.id)).toEqual(['ts-empty']);
    expect(registry.findAvailable('wasm-rust')).toBeNull();
    expect(registry.findAvailable('ts-empty')?.id).toBe('ts-empty');
  });

  it('реестр отвергает нечестный контракт при регистрации', () => {
    const registry = createSolverBackendRegistry();
    const liar: SolverBackend = {
      ...emptyBackend('liar'),
      capabilities: { ...emptyBackend('liar').capabilities, implementedMethods: ['rk4'] }
    };
    expect(() => registry.registerAvailable(liar)).toThrowError(/некорректен/);
  });

  it('планируемый backend не может заявлять реализованные методы', () => {
    const registry = createSolverBackendRegistry();
    const dishonestPlan: PlannedBackendDescriptor = {
      id: 'fake-plan',
      version: '0.0.0',
      status: 'planned',
      capabilities: {
        problemKinds: ['ode'],
        implementedMethods: ['euler_forward'], // план не может быть реализацией
        adaptiveStep: false,
        implicit: false,
        stiff: false,
        sparseJacobian: false,
        maxStateDimension: null,
        deterministic: 'within_tolerance'
      },
      plannedMethods: []
    };
    expect(() => registry.registerPlanned(dishonestPlan)).toThrowError(/не может заявлять/);
  });

  it('solve() у backend\'а без методов обязан честно возвращать not_implemented', () => {
    const b = emptyBackend('ts-empty');
    const outcome = b.solve({ kind: 'ode', stateDimension: 1 });
    expect(outcome.status).toBe('not_implemented');
    if (outcome.status === 'not_implemented') {
      expect(outcome.diagnostics.backendId).toBe('ts-empty');
      expect(outcome.diagnostics.problemKind).toBe('ode');
    }
  });
});
