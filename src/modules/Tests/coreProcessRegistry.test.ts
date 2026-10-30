// ============================================
// STAGE 4.2.1 - Тесты реестра физических процессов
// ============================================
//
// Реестр ОПИСЫВАЕТ процессы, но не выполняет их: числовое τ — только
// с размерностью времени и provenance; неизвестное τ остаётся
// unknownValue и не превращается в число; текстовые timescaleNote
// не конвертируются; отключённые процессы и процессы без решателя
// не могут запускаться автоматически.

import { describe, it, expect } from 'vitest';
import {
  ProcessRegistryError,
  createProcessRegistry,
  heuristicStepSeconds,
  isProcessAutoRunnable,
  processAvailability,
  tauSeconds,
  validateProcessDescriptor
} from '../Core/processRegistry';
import type { ProcessDescriptor } from '../Core/processRegistry';
import { knownValue, unknownValue } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { chemicalProcessesToCoreDescriptors } from '../Core/adapters';
import { createDefaultProcessRegistry } from '../ChemicalEvolution';

function descriptor(overrides?: Partial<ProcessDescriptor>): ProcessDescriptor {
  return {
    id: 'test_process',
    name: 'Тестовый процесс',
    processKind: 'chemical',
    tau: knownValue(quantity(1000, 's')),
    stepPolicy: { kind: 'unspecified' },
    solverAvailability: 'available',
    enabled: true,
    ...overrides
  };
}

function expectRegistryError(fn: () => unknown, code: string): void {
  let thrown = false;
  let actual: string | null = null;
  try {
    fn();
  } catch (e) {
    if (e instanceof ProcessRegistryError) {
      thrown = true;
      actual = e.code;
    } else {
      throw e;
    }
  }
  expect(thrown).toBe(true);
  expect(actual).toBe(code);
}

describe('Stage 4.2.1 ProcessRegistry: валидация дескрипторов', () => {
  it('корректный дескриптор проходит валидацию', () => {
    expect(validateProcessDescriptor(descriptor())).toEqual([]);
  });

  it('пустые id/name и неизвестный processKind отклоняются', () => {
    expect(validateProcessDescriptor({ ...descriptor(), id: '' }).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor({ ...descriptor(), name: '  ' }).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor({ ...descriptor(), processKind: 'magic' }).length).toBeGreaterThan(0);
  });

  it('числовое tau обязано иметь размерность времени', () => {
    const bad = descriptor({ tau: knownValue(quantity(5, 'kg')) });
    const errors = validateProcessDescriptor(bad);
    expect(errors.some((e) => e.includes('размерность времени'))).toBe(true);
    // непереводимая размерность — как неизвестное τ для исполнения
    expect(tauSeconds(bad.tau)).toBeNull();
  });

  it('tauFraction только в (0, 1]: эвристика dt не назначает шаг сама', () => {
    expect(validateProcessDescriptor(descriptor({ stepPolicy: { kind: 'tau_heuristic', tauFraction: 0 } })).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor(descriptor({ stepPolicy: { kind: 'tau_heuristic', tauFraction: 1.5 } })).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor(descriptor({ stepPolicy: { kind: 'tau_heuristic', tauFraction: Number.NaN } })).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor(descriptor({ stepPolicy: { kind: 'tau_heuristic', tauFraction: 1 } }))).toEqual([]);
  });

  it('некорректные solverAvailability, enabled, provenance, dependencies отклоняются', () => {
    expect(validateProcessDescriptor({ ...descriptor(), solverAvailability: 'maybe' }).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor({ ...descriptor(), enabled: 'yes' }).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor({ ...descriptor(), provenance: ['не словарь'] }).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor({ ...descriptor(), dependencies: [''] }).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor({ ...descriptor(), dependencies: 'a' }).length).toBeGreaterThan(0);
    expect(validateProcessDescriptor({ ...descriptor(), timescaleNote: 5 }).length).toBeGreaterThan(0);
  });
});

describe('Stage 4.2.1 ProcessRegistry: реестр', () => {
  it('register/get/has/list: стабильный порядок регистрации', () => {
    const registry = createProcessRegistry();
    const a = descriptor({ id: 'a', name: 'Процесс A' });
    const b = descriptor({ id: 'b', name: 'Процесс B' });
    registry.register(a).register(b);
    expect(registry.has('a')).toBe(true);
    expect(registry.has('c')).toBe(false);
    expect(registry.get('b')).toBe(b);
    expect(registry.get('c')).toBeNull();
    expect(registry.list().map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('дублирующийся id — ошибка duplicate_id', () => {
    const registry = createProcessRegistry();
    registry.register(descriptor({ id: 'dup' }));
    expectRegistryError(() => registry.register(descriptor({ id: 'dup' })), 'duplicate_id');
  });

  it('невалидный дескриптор не регистрируется (invalid_descriptor)', () => {
    const registry = createProcessRegistry();
    expectRegistryError(() => registry.register(descriptor({ id: '' })), 'invalid_descriptor');
    expect(registry.list()).toEqual([]);
  });
});

describe('Stage 4.2.1 ProcessRegistry: tau и политика шага', () => {
  it('tauSeconds: известное τ в секундах; неизвестное и непригодное — null', () => {
    expect(tauSeconds(knownValue(quantity(1000, 's')))).toBe(1000);
    expect(tauSeconds(unknownValue('числовое τ неизвестно'))).toBeNull();
  });

  it('heuristicStepSeconds: предварительная эвристика, не обязательный шаг', () => {
    expect(heuristicStepSeconds(descriptor({ stepPolicy: { kind: 'tau_heuristic', tauFraction: 0.05 } }))).toBe(50);
    expect(heuristicStepSeconds(descriptor())).toBeNull();
    expect(
      heuristicStepSeconds(descriptor({ tau: unknownValue('числовое τ неизвестно'), stepPolicy: { kind: 'tau_heuristic', tauFraction: 0.05 } }))
    ).toBeNull();
  });
});

describe('Stage 4.2.1 ProcessRegistry: доступность процессов', () => {
  it('отключённый процесс недоступен независимо от τ и решателя', () => {
    const d = descriptor({ enabled: false });
    expect(processAvailability(d)).toBe('disabled');
    expect(isProcessAutoRunnable(d)).toBe(false);
  });

  it('статусы решателя различаются явно', () => {
    expect(processAvailability(descriptor({ solverAvailability: 'not_implemented' }))).toBe('not_implemented');
    expect(processAvailability(descriptor({ solverAvailability: 'scheduled' }))).toBe('scheduled');
    expect(processAvailability(descriptor({ solverAvailability: 'unknown' }))).toBe('unknown');
  });

  it('доступный решатель без числового tau — unknown, а не available', () => {
    const d = descriptor({ tau: unknownValue('числовое τ неизвестно') });
    expect(processAvailability(d)).toBe('unknown');
    expect(isProcessAutoRunnable(d)).toBe(false);
    expect(processAvailability(descriptor())).toBe('available');
    expect(isProcessAutoRunnable(descriptor())).toBe(true);
  });
});

describe('Stage 4.2.1 ProcessRegistry: мост легаси-химии (честное состояние)', () => {
  it('все легаси-процессы переносятся без выдуманных τ, констант и решателей', () => {
    const legacy = createDefaultProcessRegistry();
    expect(legacy.length).toBe(11);
    const descriptors = chemicalProcessesToCoreDescriptors(legacy);
    expect(descriptors.length).toBe(11);
    for (const d of descriptors) {
      expect(tauSeconds(d.tau)).toBeNull();
      expect(d.solverAvailability).toBe('not_implemented');
      expect(d.enabled).toBe(false);
      expect(d.processKind).toBe('chemical');
      expect(processAvailability(d)).toBe('disabled');
      expect(isProcessAutoRunnable(d)).toBe(false);
      expect(validateProcessDescriptor(d)).toEqual([]);
    }
  });

  it('мостовые дескрипторы регистрируются в реестре ядра в стабильном порядке', () => {
    const descriptors = chemicalProcessesToCoreDescriptors(createDefaultProcessRegistry());
    const registry = createProcessRegistry();
    for (const d of descriptors) registry.register(d);
    expect(registry.list().map((d) => d.id)).toEqual(descriptors.map((d) => d.id));
  });
});
