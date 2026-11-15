// ============================================
// STAGE 4.4.4.8-B2 - Тесты чистого Core-решателя
// PR reactive gas equilibrium
// ============================================
//
// Проверяются требования Stage 4.4.4.8-B2 (docs/science/
// PR_REACTIVE_EQUILIBRIUM_DESIGN.md):
// - внешний fixed-point цикл по компонентным ln(phi) поверх
//   НЕИЗМЕНЁННОГО идеальногазового решателя;
// - идеальногазовый предел (lnPhi -> 0 при P -> 0) совпадает с
//   обычным solveEquilibrium;
// - точный нулевой предел притяжения PR (a_i = 0 при T = T*) даёт
//   предельную формулу lnPhi без искусственной неидеальности;
// - однокомпонентный предел без бинарных параметров;
// - независимый 1-D оракул (бисекция стационарного уравнения
//   бинарной реакции A <=> B) совпадает с итерационным решателем;
// - PR-невязка стационарности = внутренняя (B1) невязка +
//   lnPhiTarget - lnPhiUsed (проверено при ненулевых lnPhi);
// - кандидат равновесия невозможен без сходимости внутреннего
//   решателя и без fixed-point остатка ниже допуска;
// - детерминированное адаптивное демпфирование (эскалация при
//   росте невязки, осцилляция через две итерации, пол minDamping);
// - stagnated / max_iterations по фактической причине; застой НЕ
//   выдаётся за сходимость;
// - fail-closed: отсутствие PR-параметров и kij (в том числе у пар
//   с нулевой текущей долей), непринятый evidence, температура вне
//   применимости BIP, неверные размерности, NaN/Infinity,
//   дубликаты, нарушение element/charge ограничений - без
//   молчаливых подстановок (kij = 0 запрещён) и без ln(0);
// - детерминизм и перестановочная инвариантность.
//
// Все PR-параметры в этих тестах - СИНТЕТИЧЕСКИЕ тестовые данные
// (не экспериментально подтверждённые данные каталога); это явно
// указано в limitations каждого вида.

import { describe, it, expect } from 'vitest';
import { quantity } from '../Core/physicalQuantity';
import type { PhysicalQuantity } from '../Core/physicalQuantity';
import {
  EquilibriumError,
  solveEquilibrium,
  solveEquilibriumWithDiagnostics
} from '../Core/equilibrium';
import type { EquilibriumProblem } from '../Core/equilibrium';
import { computePengRobinsonMixture } from '../Core/pengRobinsonMixture';
import type { PengRobinsonMixtureSuccess } from '../Core/pengRobinsonMixture';
import { computePengRobinsonPureParameters } from '../Core/pengRobinson';
import {
  PR_REACTIVE_GAS_EQUILIBRIUM_LIMITATION,
  prReactiveDampingUpdate,
  solveReactiveGasEquilibriumWithPengRobinson
} from '../Core/prReactiveEquilibrium';
import type {
  PrReactiveEquilibriumSpecies,
  PrReactiveGasEquilibriumRequest,
  PrReactiveGasEquilibriumFailure,
  PrReactiveGasEquilibriumResult,
  PrReactiveGasEquilibriumSuccess
} from '../Core/prReactiveEquilibrium';

const MIN_DAMPING_DEFAULT = 1 / 1024;

// ============================================
// Хелперы (синтетические тестовые PR-данные)
// ============================================

const VERIFIED_EVIDENCE = {
  criticalTemperatureK: 'VERIFIED',
  criticalPressurePa: 'VERIFIED',
  acentricFactor: 'VERIFIED'
} as const;

const PARTIAL_EVIDENCE = {
  criticalTemperatureK: 'PARTIALLY_VERIFIED',
  criticalPressurePa: 'PARTIALLY_VERIFIED',
  acentricFactor: 'PARTIALLY_VERIFIED'
} as const;

function syntheticEos(Tc: number, Pc: number, omega: number) {
  return {
    criticalTemperatureK: Tc,
    criticalPressurePa: Pc,
    acentricFactor: omega,
    evidence: VERIFIED_EVIDENCE,
    crossChecks: [],
    limitations: [
      'СИНТЕТИЧЕСКИЕ тестовые параметры (не экспериментально подтверждённые данные каталога EOS).'
    ]
  };
}

function bip(
  a: string,
  b: string,
  kij: number,
  range: { minTemperatureK: number; maxTemperatureK: number } | null = null
) {
  return {
    componentA: a,
    componentB: b,
    kij,
    evidence: 'VERIFIED' as const,
    applicabilityRangeK: range
  };
}

function spPR(
  id: string,
  elements: Record<string, number>,
  g: number,
  eos: ReturnType<typeof syntheticEos>,
  charge = 0
): PrReactiveEquilibriumSpecies {
  return { id, elements, charge, gStandardOverRT: g, eos };
}

/** Бинарная изомеризация A <=> B (синтетические PR-параметры). */
function abRequest(dg = 1, overrides: Record<string, unknown> = {}): PrReactiveGasEquilibriumRequest {
  return {
    temperature: quantity(400, 'K'),
    pressure: quantity(10, 'bar'),
    standardStatePressure: quantity(1, 'bar'),
    species: [
      spPR('A', { X: 1 }, 0, syntheticEos(300, 4e6, 0.1)),
      spPR('B', { X: 1 }, dg, syntheticEos(420, 3.4e6, 0.25))
    ],
    elementTotals: { X: 1 },
    chargeTotal: 0,
    binaryInteractions: [bip('A', 'B', 0.05)],
    evidencePolicy: 'verified_only',
    ...overrides
  } as PrReactiveGasEquilibriumRequest;
}

/** Три вида: A <=> B активны, C имеет нулевой итог элемента Z (исключается). */
function abcRequest(): PrReactiveGasEquilibriumRequest {
  return {
    temperature: quantity(400, 'K'),
    pressure: quantity(10, 'bar'),
    standardStatePressure: quantity(1, 'bar'),
    species: [
      spPR('A', { X: 1 }, 0, syntheticEos(300, 4e6, 0.1)),
      spPR('B', { X: 1 }, 1, syntheticEos(420, 3.4e6, 0.25)),
      spPR('C', { Z: 1 }, 2, syntheticEos(500, 3e6, 0.3))
    ],
    elementTotals: { X: 1, Z: 0 },
    chargeTotal: 0,
    binaryInteractions: [bip('A', 'B', 0.05), bip('A', 'C', 0.02), bip('B', 'C', 0.03)],
    evidencePolicy: 'verified_only'
  };
}

/** PR-вычислитель на заданном составе (для оракула и cross-checks). */
function prAt(
  species: readonly PrReactiveEquilibriumSpecies[],
  fractions: Readonly<Record<string, number>>,
  request: PrReactiveGasEquilibriumRequest
): PengRobinsonMixtureSuccess {
  const pr = computePengRobinsonMixture(
    {
      components: species.map((s) => ({
        component: s.id,
        moleFraction: fractions[s.id] ?? 0,
        ...s.eos
      })),
      binaryInteractions: request.binaryInteractions
    },
    {
      temperatureK: 400,
      pressurePa: 1e6,
      root: 'vapor',
      evidencePolicy: request.evidencePolicy
    }
  );
  if (pr.status !== 'success') {
    throw new Error(`PR-вычислитель отказал в тестовом oracle-вызове: ${pr.code} ${pr.message}`);
  }
  return pr;
}

function asSuccess(r: PrReactiveGasEquilibriumResult): PrReactiveGasEquilibriumSuccess {
  if (r.status !== 'candidate_converged') {
    const f = r as { code?: string; message?: string };
    throw new Error(`ожидался candidate_converged, получен ${r.status}: ${f.code} ${f.message}`);
  }
  return r;
}

function asFailure(
  r: PrReactiveGasEquilibriumResult,
  expectedStatus: PrReactiveGasEquilibriumFailure['status']
): PrReactiveGasEquilibriumFailure {
  expect(r.status).toBe(expectedStatus);
  if (r.status === 'candidate_converged') {
    throw new Error(`ожидался ${expectedStatus}, получен candidate_converged`);
  }
  return r;
}

function expectEquilibriumError(fn: () => unknown, code?: string): void {
  let thrown: unknown = null;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(EquilibriumError);
  if (code !== undefined) {
    expect((thrown as EquilibriumError).code).toBe(code);
  }
}

// ============================================
// Алгоритм и физические пределы
// ============================================

describe('Stage 4.4.4.8-B2: алгоритм и физические пределы', () => {
  it('1. идеальногазовый предел: при P -> 0 результат совпадает с обычным solveEquilibrium', () => {
    const request = abRequest(1, { pressure: quantity(1e-3, 'Pa') });
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(request));
    expect(r.model).toBe('peng_robinson_vapor');
    expect(r.root).toBe('vapor');
    const ideal = solveEquilibrium({
      temperature: quantity(400, 'K'),
      pressure: quantity(1e-3, 'Pa'),
      standardStatePressure: quantity(1, 'bar'),
      species: [
        { id: 'A', elements: { X: 1 }, charge: 0, gStandardOverRT: 0 },
        { id: 'B', elements: { X: 1 }, charge: 0, gStandardOverRT: 1 }
      ],
      elementTotals: { X: 1 },
      chargeTotal: 0
    });
    expect(r.moleFractions.B).toBeCloseTo(ideal.moleFractions.B, 9);
    expect(r.moleFractions.B).toBeCloseTo(0.2689414214, 8);
    // lnPhi при таком давлении пренебрежимо малы.
    expect(Math.abs(r.lnPhiUsed.A)).toBeLessThan(1e-6);
    expect(Math.abs(r.lnPhiUsed.B)).toBeLessThan(1e-6);
  });

  it('2. точный нулевой предел притяжения PR (a_i = 0): предельная формула lnPhi без искусственной неидеальности', () => {
    // kappa зависит только от omega; T* подбирается так, что alpha(T*) = 0 точно.
    const { kappa } = computePengRobinsonPureParameters(300, 4e6, 0.1, 400, 1e6);
    const tStar = 300 * Math.pow(1 + 1 / kappa, 2);
    const pure = computePengRobinsonPureParameters(300, 4e6, 0.1, tStar, 1e6);
    expect(pure.aPaM6PerMol2).toBe(0);

    const request = abRequest(1, {
      temperature: quantity(tStar, 'K'),
      species: [
        spPR('A', { X: 1 }, 0, syntheticEos(300, 4e6, 0.1)),
        spPR('B', { X: 1 }, 1, syntheticEos(300, 3.4e6, 0.1))
      ]
    });
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(request));
    const pr = prAt(request.species, r.moleFractions, request);
    // Притяжение отсутствует ровно: a_mix = 0, работает предельная (кавolume) форма.
    expect(pr.aMixPaM6PerMol2).toBe(0);
    const z = pr.Z;
    const bMix = pr.bMixM3PerMol;
    for (const c of pr.components) {
      // предельная форма: ln(phi_i) = (b_i/b)(Z - 1) - ln(Z - B)
      const expected = (c.bM3PerMol / bMix) * (z - 1) - Math.log(z - pr.dimensionlessB);
      expect(c.lnPhi).toBeCloseTo(expected, 10);
      expect(Number.isFinite(expected)).toBe(true);
    }
    // Fixed-point согласован: lnPhiUsed = lnPhiTarget на финальном составе.
    expect(r.lnPhiUsed.A).toBeCloseTo(pr.components.find((c) => c.component === 'A')!.lnPhi, 9);
    expect(r.lnPhiUsed.B).toBeCloseTo(pr.components.find((c) => c.component === 'B')!.lnPhi, 9);
  });

  it('3. однокомпонентный предел без бинарных параметров', () => {
    const request: PrReactiveGasEquilibriumRequest = {
      temperature: quantity(400, 'K'),
      pressure: quantity(10, 'bar'),
      standardStatePressure: quantity(1, 'bar'),
      species: [spPR('A', { X: 1 }, 0, syntheticEos(300, 4e6, 0.1))],
      elementTotals: { X: 1 },
      chargeTotal: 0,
      binaryInteractions: [],
      evidencePolicy: 'verified_only'
    };
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(request));
    expect(r.moleFractions.A).toBeCloseTo(1, 12);
    expect(r.totalMoles).toBeCloseTo(1, 12);
    expect(r.lnPhiFixedPointResidual).toBe(0);
    expect(r.outerIterations).toBeGreaterThanOrEqual(1);
    expect(r.outerIterations).toBeLessThanOrEqual(5);
    expect(r.binaryInteractionsUsed).toEqual([]);
  });

  it('4. двухкомпонентная реакция A <=> B: кандидат равновесия с PR-поправками', () => {
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(abRequest(1)));
    expect(r.model).toBe('peng_robinson_vapor');
    expect(r.root).toBe('vapor');
    expect(r.status).toBe('candidate_converged');
    // Контрольное значение прототипа (синтетические параметры).
    expect(r.moleFractions.B).toBeCloseTo(0.28448006885573, 9);
    expect(r.moleFractions.A).toBeCloseTo(1 - 0.28448006885573, 9);
    expect(r.lnPhiFixedPointResidual).toBeLessThan(1e-9);
    expect(r.outerIterations).toBeGreaterThanOrEqual(1);
    expect(r.outerIterations).toBeLessThanOrEqual(20);
    // Постоянное предупреждение об однофазном vapor-кандидате.
    expect(
      r.warnings.some((w) => w.code === 'single_phase_vapor_candidate_without_phase_stability')
    ).toBe(true);
    expect(r.interpretationLimitation).toBe(PR_REACTIVE_GAS_EQUILIBRIUM_LIMITATION);
    // Энергия Гиббса PR-задачи конечна и отличается от идеальногазового значения.
    expect(Number.isFinite(r.gibbsEnergy)).toBe(true);
    const ideal = solveEquilibrium({
      temperature: quantity(400, 'K'),
      pressure: quantity(10, 'bar'),
      standardStatePressure: quantity(1, 'bar'),
      species: [
        { id: 'A', elements: { X: 1 }, charge: 0, gStandardOverRT: 0 },
        { id: 'B', elements: { X: 1 }, charge: 0, gStandardOverRT: 1 }
      ],
      elementTotals: { X: 1 },
      chargeTotal: 0
    });
    expect(ideal.gibbsEnergy).not.toBeNull();
    expect(r.gibbsEnergy).not.toBeCloseTo(ideal.gibbsEnergy!.value, 3);
    // Использованные EOS/BIP-входы возвращены явно (не каталоговый provenance).
    expect(r.eosInputsUsed.map((e) => e.speciesId).sort()).toEqual(['A', 'B']);
    expect(r.eosInputsUsed[0].limitations.length).toBeGreaterThan(0);
    expect(r.binaryInteractionsUsed.length).toBe(1);
    // Элементный баланс выполнен по C2-критерию внутреннего решателя.
    expect(Math.abs(r.elementResiduals.X)).toBeLessThan(1e-12);
    expect(Math.abs(r.chargeResidual)).toBeLessThan(1e-12);
  });

  it('5. независимый 1-D оракул (бисекция стационарного уравнения) совпадает с решателем', () => {
    const request = abRequest(1);
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(request));
    // Стационарное уравнение бинарной реакции:
    // h(xB) = ln(xB/xA) + dg + lnPhiB(x) - lnPhiA(x) = 0.
    const h = (xB: number): number => {
      const pr = prAt(
        request.species,
        { A: 1 - xB, B: xB },
        request
      );
      const lnPhiA = pr.components.find((c) => c.component === 'A')!.lnPhi;
      const lnPhiB = pr.components.find((c) => c.component === 'B')!.lnPhi;
      return Math.log(xB / (1 - xB)) + 1 + lnPhiB - lnPhiA;
    };
    let lo = 1e-9;
    let hi = 1 - 1e-9;
    expect(h(lo)).toBeLessThan(0);
    expect(h(hi)).toBeGreaterThan(0);
    for (let i = 0; i < 100; i += 1) {
      const mid = 0.5 * (lo + hi);
      if (h(mid) < 0) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const oracle = 0.5 * (lo + hi);
    expect(Math.abs(oracle - r.moleFractions.B)).toBeLessThan(1e-10);
  });

  it('6. ненулевые PR-поправки: правильный знак lnPhiUsed и фиксированная точка на финальном составе', () => {
    const request = abRequest(1);
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(request));
    // При T=400 K оба вида сверхкритические: lnPhi отрицательны и ненулевые.
    expect(r.lnPhiUsed.A).toBeLessThan(0);
    expect(r.lnPhiUsed.B).toBeLessThan(0);
    // Fixed-point согласован: PR на финальном составе воспроизводит lnPhiUsed.
    const pr = prAt(request.species, r.moleFractions, request);
    for (const c of pr.components) {
      expect(r.lnPhiUsed[c.component]).toBeCloseTo(c.lnPhi, 9);
    }
    // И состав действительно отличается от идеальногазового (поправка работает).
    expect(Math.abs(r.moleFractions.B - 0.26894142136999)).toBeGreaterThan(1e-3);
  });

  it('7. перестановка видов и входных пар даёт тот же результат', () => {
    const direct = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(abRequest(1)));
    const swapped = abRequest(1, {
      species: [
        spPR('B', { X: 1 }, 1, syntheticEos(420, 3.4e6, 0.25)),
        spPR('A', { X: 1 }, 0, syntheticEos(300, 4e6, 0.1))
      ],
      binaryInteractions: [bip('B', 'A', 0.05)]
    });
    const permuted = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(swapped));
    expect(permuted.moleFractions.A).toBeCloseTo(direct.moleFractions.A, 12);
    expect(permuted.moleFractions.B).toBeCloseTo(direct.moleFractions.B, 12);
    expect(permuted.lnPhiUsed.A).toBeCloseTo(direct.lnPhiUsed.A, 10);
    expect(permuted.lnPhiUsed.B).toBeCloseTo(direct.lnPhiUsed.B, 10);
    expect(permuted.gibbsEnergy).toBeCloseTo(direct.gibbsEnergy, 6);
    expect(permuted.outerIterations).toBe(direct.outerIterations);
  });

  it('8. повторный вызов с идентичным входом - детерминированный результат', () => {
    const request = abRequest(1);
    const r1 = solveReactiveGasEquilibriumWithPengRobinson(request);
    const r2 = solveReactiveGasEquilibriumWithPengRobinson(request);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

// ============================================
// Сходимость
// ============================================

describe('Stage 4.4.4.8-B2: сходимость', () => {
  it('9. candidate_converged невозможен, когда внутренний решатель не сошёлся', () => {
    const innerStalled = asFailure(
      solveReactiveGasEquilibriumWithPengRobinson(
        abRequest(1, { options: { innerOptions: { maxIterations: 1 } } })
      ),
      'numerical_failure'
    );
    expect(innerStalled.status).toBe('numerical_failure');
    expect(innerStalled.code).toBe('inner:max_iterations');
    expect(innerStalled.innerStatus).toBe('max_iterations');
    expect(innerStalled.innerResultMessage).not.toBeNull();

    const innerFailed = asFailure(
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(5000)),
      'numerical_failure'
    );
    expect(innerFailed.status).toBe('numerical_failure');
    expect(innerFailed.code).toBe('inner:numerical_failure');
    expect(innerFailed.innerStatus).toBe('numerical_failure');
  });

  it('10. candidate_converged невозможен при fixed-point остатке выше допуска', () => {
    // Допуск ниже достижимого машинного пола остатка: бюджет
    // исчерпывается честно, состав не выдаётся за равновесный.
    const r = asFailure(
      solveReactiveGasEquilibriumWithPengRobinson(
        abRequest(1, { options: { outerTolerance: 1e-25, stagnationEpsilon: 1e-30, maxOuterIterations: 30 } })
      ),
      'max_iterations'
    );
    expect(r.status).toBe('max_iterations');
    expect(r.lastFixedPointResidual).not.toBeNull();
    expect(r.lastFixedPointResidual as number).toBeGreaterThanOrEqual(1e-25);
    expect(r.outerIterations).toBe(30);
  });

  it('11. PR stationarity residual = внутренняя (B1) невязка + lnPhiTarget - lnPhiUsed (при ненулевых lnPhi)', () => {
    const request = abRequest(1);
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(request));
    expect(r.lnPhiUsed.A).not.toBe(0);
    expect(r.lnPhiUsed.B).not.toBe(0);
    // Восстанавливаем внутреннюю задачу финальной итерации:
    // gEffective = g° + lnPhiUsed.
    const innerProblem: EquilibriumProblem = {
      temperature: quantity(400, 'K'),
      pressure: quantity(10, 'bar'),
      standardStatePressure: quantity(1, 'bar'),
      species: [
        { id: 'A', elements: { X: 1 }, charge: 0, gStandardOverRT: 0 + r.lnPhiUsed.A },
        { id: 'B', elements: { X: 1 }, charge: 0, gStandardOverRT: 1 + r.lnPhiUsed.B }
      ],
      elementTotals: { X: 1 },
      chargeTotal: 0
    };
    const inner = solveEquilibriumWithDiagnostics(innerProblem);
    expect(inner.result.status).toBe('converged');
    expect(inner.stationarityDiagnostics).not.toBeNull();
    expect(inner.result.moleFractions.B).toBeCloseTo(r.moleFractions.B, 12);
    // PR на финальном составе даёт lnPhiTarget.
    const pr = prAt(request.species, r.moleFractions, request);
    const lnPhiTarget: Record<string, number> = {};
    for (const c of pr.components) {
      lnPhiTarget[c.component] = c.lnPhi;
    }
    const diag = inner.stationarityDiagnostics!;
    for (const id of diag.activeSpeciesIds) {
      const expected = diag.stationarityResidualOverRT[id] + lnPhiTarget[id] - r.lnPhiUsed[id];
      expect(r.stationarityResidual[id]).toBeCloseTo(expected, 12);
    }
    let maxAbs = 0;
    for (const id of Object.keys(r.stationarityResidual)) {
      maxAbs = Math.max(maxAbs, Math.abs(r.stationarityResidual[id]));
    }
    expect(r.maxAbsStationarityResidual).toBeCloseTo(maxAbs, 15);
    expect(r.maxAbsStationarityResidual).toBeLessThan(1e-9);
  });

  it('12. детерминированное адаптивное демпфирование: эскалация, осцилляция через две итерации, пол minDamping', () => {
    // Рост невязки: lambda делится пополам.
    let d = prReactiveDampingUpdate(1, 0.5, 0.25, 9, MIN_DAMPING_DEFAULT);
    expect(d).toEqual({ lambda: 0.5, escalated: true, oscillation: false });
    // Осцилляция: невязка выросла после локального минимума два шага назад.
    d = prReactiveDampingUpdate(1, 1, 0.5, 0.75, MIN_DAMPING_DEFAULT);
    expect(d.lambda).toBe(0.25);
    expect(d.escalated).toBe(true);
    expect(d.oscillation).toBe(true);
    // Пол: lambda не опускается ниже minDamping.
    d = prReactiveDampingUpdate(MIN_DAMPING_DEFAULT, 2, 1, 0.5, MIN_DAMPING_DEFAULT);
    expect(d.lambda).toBe(MIN_DAMPING_DEFAULT);
    expect(d.escalated).toBe(true);
    expect(d.oscillation).toBe(false);
    // Без роста lambda не меняется.
    d = prReactiveDampingUpdate(0.5, 0.1, 0.2, 9, MIN_DAMPING_DEFAULT);
    expect(d).toEqual({ lambda: 0.5, escalated: false, oscillation: false });
    // В end-to-end прогоне флаги согласованы и детерминированы.
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(abRequest(1)));
    expect(r.oscillationDetected).toBe(false);
    expect(r.dampingEscalations).toBeGreaterThanOrEqual(0);
  });

  it('13. застой выше допуска даёт stagnated и НЕ выдаётся за сходимость', () => {
    // outerTolerance ниже достижимого пола остатка; когда изменение
    // вектора падает ниже stagnationEpsilon при остатке >= допуска,
    // решатель честно останавливается со статусом stagnated.
    const r = asFailure(
      solveReactiveGasEquilibriumWithPengRobinson(
        abRequest(1, {
          options: {
            outerTolerance: 1e-20,
            stagnationEpsilon: 1e-10,
            stagnationWindow: 5,
            maxOuterIterations: 100
          }
        })
      ),
      'stagnated'
    );
    expect(r.status).toBe('stagnated');
    expect(r.code).toBe('stagnated');
    expect(r.lastFixedPointResidual).not.toBeNull();
    expect(r.lastFixedPointResidual as number).toBeGreaterThanOrEqual(1e-20);
    expect(r.lastLnPhiUsed).not.toBeNull();
    expect(r.lastMoleFractions).not.toBeNull();
    expect(
      r.warnings.some((w) => w.code === 'single_phase_vapor_candidate_without_phase_stability')
    ).toBe(true);
  });

  it('14. исчерпание бюджета внешних итераций даёт max_iterations', () => {
    const r = asFailure(
      solveReactiveGasEquilibriumWithPengRobinson(
        abRequest(1, { options: { maxOuterIterations: 1 } })
      ),
      'max_iterations'
    );
    expect(r.status).toBe('max_iterations');
    expect(r.outerIterations).toBe(1);
    expect(r.lastFixedPointResidual).not.toBeNull();
    expect(r.innerStatus).toBe('converged');
  });

  it('15. адаптивное демпфирование не выходит за пределы [minDamping, 1]; невалидные опции отклоняются', () => {
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(abRequest(1)));
    expect(r.finalDamping).toBeLessThanOrEqual(1);
    expect(r.finalDamping).toBeGreaterThanOrEqual(MIN_DAMPING_DEFAULT);
    const capped = asSuccess(
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { options: { minDamping: 0.5 } }))
    );
    expect(capped.finalDamping).toBeGreaterThanOrEqual(0.5);
    expect(capped.finalDamping).toBeLessThanOrEqual(1);

    expect(() =>
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { options: { maxOuterIterations: 0 } }))
    ).toThrow(EquilibriumError);
    expect(() =>
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { options: { outerTolerance: 0 } }))
    ).toThrow(EquilibriumError);
    expect(() =>
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { options: { outerTolerance: -1e-10 } }))
    ).toThrow(EquilibriumError);
    expect(() =>
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { options: { minDamping: 2 } }))
    ).toThrow(EquilibriumError);
    expect(() =>
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { options: { minDamping: 0 } }))
    ).toThrow(EquilibriumError);
    expect(() =>
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { options: { stagnationWindow: 0 } }))
    ).toThrow(EquilibriumError);
    expect(() =>
      solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { options: { stagnationEpsilon: 0 } }))
    ).toThrow(EquilibriumError);
    expect(() =>
      solveReactiveGasEquilibriumWithPengRobinson(
        abRequest(1, { options: { maxOuterIterations: Number.NaN } })
      )
    ).toThrow(EquilibriumError);
  });
});

// ============================================
// Fail-closed и численная целостность
// ============================================

describe('Stage 4.4.4.8-B2: fail-closed и численная целостность', () => {
  it('16. отсутствие чистокомпонентного PR-параметра - unsupported_eos_data с полным списком', () => {
    const missing = abRequest(1);
    (missing.species[0] as { eos: Record<string, unknown> }).eos = {
      criticalTemperatureK: 300,
      criticalPressurePa: 4e6,
      evidence: VERIFIED_EVIDENCE,
      crossChecks: [],
      limitations: ['синтетические тестовые параметры']
    };
    const r = asFailure(solveReactiveGasEquilibriumWithPengRobinson(missing), 'unsupported_eos_data');
    expect(r.status).toBe('unsupported_eos_data');
    expect(r.deficiencies.length).toBeGreaterThan(0);
    expect(r.deficiencies.some((d) => d.kind === 'invalid_component_parameters' && d.subject === 'A')).toBe(true);

    const nanTc = abRequest(1);
    (nanTc.species[1] as { eos: Record<string, unknown> }).eos = syntheticEos(Number.NaN, 3.4e6, 0.25);
    const r2 = asFailure(solveReactiveGasEquilibriumWithPengRobinson(nanTc), 'unsupported_eos_data');
    expect(r2.status).toBe('unsupported_eos_data');
    expect(r2.deficiencies.some((d) => d.kind === 'invalid_component_parameters' && d.subject === 'B')).toBe(true);
  });

  it('17. отсутствующий kij - отказ, в том числе для пары с нулевой текущей долей', () => {
    // Полный набор пар (включая пары с видом C, исключаемым нулевым
    // итогом Z) проходит и даёт кандидата.
    const ok = solveReactiveGasEquilibriumWithPengRobinson(abcRequest());
    expect(ok.status).toBe('candidate_converged');

    // Убираем kij пары A-C: у C нулевая текущая доля, но итоговый
    // состав заранее неизвестен - молчаливый kij = 0 запрещён.
    const missing = abcRequest();
    const withoutAC = missing.binaryInteractions.filter(
      (b) => !((b.componentA === 'A' && b.componentB === 'C') || (b.componentA === 'C' && b.componentB === 'A'))
    );
    const r = asFailure(
      solveReactiveGasEquilibriumWithPengRobinson({ ...missing, binaryInteractions: withoutAC }),
      'unsupported_eos_data'
    );
    expect(r.status).toBe('unsupported_eos_data');
    expect(
      r.deficiencies.some(
        (d) => d.kind === 'missing_binary_interaction' && d.subject.includes('A') && d.subject.includes('C')
      )
    ).toBe(true);
  });

  it('18. непринятый evidence при заданной политике, в том числе у неактивного вида', () => {
    // Активный вид с PARTIALLY_VERIFIED при verified_only.
    const active = abRequest(1);
    (active.species[0] as { eos: Record<string, unknown> }).eos = syntheticEos(300, 4e6, 0.1);
    (active.species[0] as { eos: { evidence: unknown } }).eos.evidence = PARTIAL_EVIDENCE;
    const rActive = asFailure(solveReactiveGasEquilibriumWithPengRobinson(active), 'unsupported_eos_data');
    expect(rActive.status).toBe('unsupported_eos_data');
    expect(
      rActive.deficiencies.some((d) => d.kind === 'component_evidence_not_accepted' && d.subject === 'A')
    ).toBe(true);

    // Неактивный вид (нулевой итог Z) с непринятым evidence.
    const inactive = abcRequest();
    const cSpecies = inactive.species.find((s) => s.id === 'C') as PrReactiveEquilibriumSpecies;
    (cSpecies as { eos: unknown }).eos = { ...syntheticEos(500, 3e6, 0.3), evidence: PARTIAL_EVIDENCE };
    const rInactive = asFailure(solveReactiveGasEquilibriumWithPengRobinson(inactive), 'unsupported_eos_data');
    expect(rInactive.status).toBe('unsupported_eos_data');
    expect(
      rInactive.deficiencies.some((d) => d.kind === 'component_evidence_not_accepted' && d.subject === 'C')
    ).toBe(true);
  });

  it('19. температура вне применимости BIP, в том числе для пары с нулевой текущей долей', () => {
    const activePair = abRequest(1, {
      binaryInteractions: [bip('A', 'B', 0.05, { minTemperatureK: 500, maxTemperatureK: 600 })]
    });
    const rActive = asFailure(solveReactiveGasEquilibriumWithPengRobinson(activePair), 'unsupported_eos_data');
    expect(rActive.status).toBe('unsupported_eos_data');
    expect(
      rActive.deficiencies.some((d) => d.kind === 'binary_interaction_applicability')
    ).toBe(true);

    const inactivePair = abcRequest();
    const withRange = inactivePair.binaryInteractions.map((b) =>
      b.componentA === 'A' && b.componentB === 'C'
        ? { ...b, applicabilityRangeK: { minTemperatureK: 500, maxTemperatureK: 600 } }
        : b
    );
    const rInactive = asFailure(
      solveReactiveGasEquilibriumWithPengRobinson({ ...inactivePair, binaryInteractions: withRange }),
      'unsupported_eos_data'
    );
    expect(rInactive.status).toBe('unsupported_eos_data');
    expect(
      rInactive.deficiencies.some(
        (d) => d.kind === 'binary_interaction_applicability' && d.subject.includes('A') && d.subject.includes('C')
      )
    ).toBe(true);
  });

  it('20. неверная размерность температуры/давления - invalid_input без предположений', () => {
    expectEquilibriumError(
      () => solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { temperature: quantity(400, 'Pa') })),
      'invalid_input'
    );
    expectEquilibriumError(
      () => solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { pressure: quantity(10, 'K') })),
      'invalid_input'
    );
    expectEquilibriumError(
      () =>
        solveReactiveGasEquilibriumWithPengRobinson(
          abRequest(1, { standardStatePressure: quantity(1, 'J') })
        ),
      'invalid_input'
    );
    expectEquilibriumError(
      () =>
        solveReactiveGasEquilibriumWithPengRobinson(
          abRequest(1, { temperature: { value: 400, unit: 'furlong' } as unknown as PhysicalQuantity })
        ),
      'invalid_input'
    );
  });

  it('21. NaN, Infinity и повреждённые записи отклоняются', () => {
    expectEquilibriumError(
      () =>
        solveReactiveGasEquilibriumWithPengRobinson(
          abRequest(1, { temperature: { value: Number.NaN, unit: 'K' } as unknown as PhysicalQuantity })
        ),
      'invalid_input'
    );
    expectEquilibriumError(
      () =>
        solveReactiveGasEquilibriumWithPengRobinson(
          abRequest(1, { pressure: { value: Number.POSITIVE_INFINITY, unit: 'Pa' } as unknown as PhysicalQuantity })
        ),
      'invalid_input'
    );
    expectEquilibriumError(
      () => solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { elementTotals: { X: Number.NaN } })),
      'invalid_input'
    );
    expectEquilibriumError(
      () =>
        solveReactiveGasEquilibriumWithPengRobinson(
          abRequest(1, { elementTotals: { X: Number.POSITIVE_INFINITY } })
        ),
      'invalid_input'
    );
    expectEquilibriumError(
      () => solveReactiveGasEquilibriumWithPengRobinson(abRequest(1, { chargeTotal: Number.NaN })),
      'invalid_input'
    );
    // Повреждённая запись вида: g° бесконечен.
    const broken = abRequest(1);
    (broken.species[1] as { gStandardOverRT: number }).gStandardOverRT = Number.POSITIVE_INFINITY;
    expectEquilibriumError(() => solveReactiveGasEquilibriumWithPengRobinson(broken), 'invalid_input');
    // Повреждённая запись kij: NaN.
    const nanKij = abRequest(1, { binaryInteractions: [bip('A', 'B', Number.NaN)] });
    const r = asFailure(solveReactiveGasEquilibriumWithPengRobinson(nanKij), 'unsupported_eos_data');
    expect(r.status).toBe('unsupported_eos_data');
    expect(r.deficiencies.some((d) => d.kind === 'invalid_binary_interaction_parameters')).toBe(true);
  });

  it('22. дублированные species ID и пары отклоняются', () => {
    const dupSpecies = abRequest(1);
    (dupSpecies as unknown as { species: PrReactiveEquilibriumSpecies[] }).species = [
      spPR('A', { X: 1 }, 0, syntheticEos(300, 4e6, 0.1)),
      spPR('A', { X: 1 }, 1, syntheticEos(420, 3.4e6, 0.25))
    ];
    expectEquilibriumError(() => solveReactiveGasEquilibriumWithPengRobinson(dupSpecies), 'invalid_input');

    // Точная дубликация пары - даже при согласованном kij.
    const dupPair = abRequest(1, { binaryInteractions: [bip('A', 'B', 0.05), bip('A', 'B', 0.05)] });
    const rDup = asFailure(solveReactiveGasEquilibriumWithPengRobinson(dupPair), 'unsupported_eos_data');
    expect(rDup.status).toBe('unsupported_eos_data');
    expect(rDup.deficiencies.some((d) => d.kind === 'duplicate_binary_interaction')).toBe(true);

    // Обратный порядок той же пары - тоже дубликат (канонический смысл).
    const dupPairRev = abRequest(1, { binaryInteractions: [bip('A', 'B', 0.05), bip('B', 'A', 0.05)] });
    const rDupRev = asFailure(solveReactiveGasEquilibriumWithPengRobinson(dupPairRev), 'unsupported_eos_data');
    expect(rDupRev.status).toBe('unsupported_eos_data');
    expect(rDupRev.deficiencies.some((d) => d.kind === 'duplicate_binary_interaction')).toBe(true);

    // Противоречивый kij той же пары.
    const contradictory = abRequest(1, { binaryInteractions: [bip('A', 'B', 0.05), bip('B', 'A', 0.07)] });
    const rContr = asFailure(solveReactiveGasEquilibriumWithPengRobinson(contradictory), 'unsupported_eos_data');
    expect(rContr.status).toBe('unsupported_eos_data');
    expect(rContr.deficiencies.some((d) => d.kind === 'contradictory_binary_interaction')).toBe(true);

    // Неизвестный ID в паре.
    const unknown = abRequest(1, { binaryInteractions: [bip('A', 'Z', 0.05)] });
    const rUnknown = asFailure(solveReactiveGasEquilibriumWithPengRobinson(unknown), 'unsupported_eos_data');
    expect(rUnknown.status).toBe('unsupported_eos_data');
    expect(rUnknown.deficiencies.some((d) => d.kind === 'unknown_component_in_binary_interaction')).toBe(true);

    // Самопара.
    const selfPair = abRequest(1, { binaryInteractions: [bip('A', 'A', 0.05)] });
    const rSelf = asFailure(solveReactiveGasEquilibriumWithPengRobinson(selfPair), 'unsupported_eos_data');
    expect(rSelf.status).toBe('unsupported_eos_data');
    expect(rSelf.deficiencies.some((d) => d.kind === 'self_pair')).toBe(true);
  });

  it('23. нарушение element/charge ограничений честно отклоняется', () => {
    // Элемент в видах без явного итога - C1-гейт внутреннего решателя.
    const noTotal = abcRequest();
    (noTotal as { elementTotals: Record<string, number> }).elementTotals = { X: 1 };
    expectEquilibriumError(() => solveReactiveGasEquilibriumWithPengRobinson(noTotal), 'invalid_input');

    // Итог элемента, отсутствующего в видах, - неосуществимая задача.
    const infeasible = abRequest(1, { elementTotals: { X: 1, Y: 1 } });
    expectEquilibriumError(() => solveReactiveGasEquilibriumWithPengRobinson(infeasible), 'infeasible');

    // Зарядовый баланс: ионная задача с противоречивым chargeTotal.
    const ion: PrReactiveGasEquilibriumRequest = {
      temperature: quantity(400, 'K'),
      pressure: quantity(10, 'bar'),
      standardStatePressure: quantity(1, 'bar'),
      species: [
        spPR('Na', { Na: 1 }, 0, syntheticEos(1156, 2.55e7, 0.27), 1),
        spPR('Cl', { Cl: 1 }, 0, syntheticEos(417, 7.0e6, 0.19), -1)
      ],
      elementTotals: { Na: 1, Cl: 1 },
      chargeTotal: 1,
      binaryInteractions: [bip('Na', 'Cl', 0.02)],
      evidencePolicy: 'verified_only'
    };
    let thrown: unknown = null;
    try {
      solveReactiveGasEquilibriumWithPengRobinson(ion);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(EquilibriumError);
    expect(['infeasible', 'invalid_input']).toContain((thrown as EquilibriumError).code);
  });

  it('24. виды с нулевыми итогами элементов не получают фиктивной невязки через ln(0)', () => {
    const r = asSuccess(solveReactiveGasEquilibriumWithPengRobinson(abcRequest()));
    // Исключённый вид: ровно нулевые доля и количество.
    expect(r.moleFractions.C).toBe(0);
    expect(r.speciesMoles.C).toBe(0);
    // Никаких NaN/Infinity нигде в результате.
    for (const id of Object.keys(r.lnPhiUsed)) {
      expect(Number.isFinite(r.lnPhiUsed[id])).toBe(true);
    }
    for (const id of Object.keys(r.moleFractions)) {
      expect(Number.isFinite(r.moleFractions[id])).toBe(true);
    }
    for (const id of Object.keys(r.elementResiduals)) {
      expect(Number.isFinite(r.elementResiduals[id])).toBe(true);
    }
    // PR-невязка стационарности - только по АКТИВНЫМ видам: C отсутствует.
    expect(r.stationarityResidual.C).toBeUndefined();
    expect(Object.keys(r.stationarityResidual).sort()).toEqual(['A', 'B']);
    // Диагностика B1: C - inactive, без вычисленного ln(0).
    expect(r.stationarityDiagnostics.inactiveSpeciesIds).toContain('C');
    expect([...r.stationarityDiagnostics.activeSpeciesIds].sort()).toEqual(['A', 'B']);
    expect(r.stationarityDiagnostics.idealChemicalPotentialOverRT.C).toBeUndefined();
    // Предупреждение об исключённых видах присутствует.
    expect(r.warnings.some((w) => w.code === 'zero_element_total_species_excluded')).toBe(true);
  });

  it('25. отсутствующие поля каталога не заменяются приближениями', () => {
    // Отсутствующий acentricFactor НЕ подменяется нулём.
    const missing = abRequest(1);
    (missing.species[0] as { eos: Record<string, unknown> }).eos = {
      criticalTemperatureK: 300,
      criticalPressurePa: 4e6,
      evidence: VERIFIED_EVIDENCE,
      crossChecks: [],
      limitations: ['синтетические тестовые параметры']
    };
    const r = asFailure(solveReactiveGasEquilibriumWithPengRobinson(missing), 'unsupported_eos_data');
    expect(r.status).toBe('unsupported_eos_data');
    const deficiency = r.deficiencies.find((d) => d.subject === 'A');
    expect(deficiency).toBeDefined();
    expect(deficiency!.message).toContain('acentricFactor');
    // Отсутствующий evidence-объект тоже не заменяется «VERIFIED по умолчанию».
    const noEvidence = abRequest(1);
    (noEvidence.species[1] as { eos: Record<string, unknown> }).eos = {
      criticalTemperatureK: 420,
      criticalPressurePa: 3.4e6,
      acentricFactor: 0.25,
      crossChecks: [],
      limitations: ['синтетические тестовые параметры']
    };
    const r2 = asFailure(solveReactiveGasEquilibriumWithPengRobinson(noEvidence), 'unsupported_eos_data');
    expect(r2.status).toBe('unsupported_eos_data');
    expect(r2.deficiencies.some((d) => d.subject === 'B')).toBe(true);
  });
});
