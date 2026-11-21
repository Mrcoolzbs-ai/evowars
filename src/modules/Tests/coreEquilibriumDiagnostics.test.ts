// ============================================
// STAGE 4.4.4.8-B1 - Тесты диагностики
// стационарности равновесного решателя
// ============================================
//
// Проверяются требования Stage 4.4.4.8-B1 (docs/science/
// PR_REACTIVE_EQUILIBRIUM_DESIGN.md §6.4):
// - solveEquilibriumWithDiagnostics(...).result идентичен
//   solveEquilibrium на той же задаче (общий внутренний путь,
//   без дублирования алгоритма);
// - JSON-структура обычного EquilibriumResult не изменилась;
// - диагностика только при converged (max_iterations /
//   numerical_failure - null без фиктивных двойственных значений);
// - dualProjectionOverRT согласуется с прямым SUM pi_j·c_ji по
//   редуцированному базису (pi восстанавливается в ТЕСТЕ из
//   проекций, не в production-коде);
// - idealChemicalPotentialOverRT = g° + ln(x_i) + ln(P/p°)
//   (знак ln(P/p°) согласован с logPressureRatio = ln(p°/P));
// - stationarityResidual конечен и в обоснованном допуске;
// - линейно зависимые строки балансов используют именно
//   редуцированный базис решателя;
// - строка charge присутствует в базисе там, где она действительно
//   независима;
// - виды, исключённые нулевыми итогами элементов, - inactive, без
//   вычисленного ln(0);
// - детерминизм повторного вызова.
//
// Граница честности: диагностика проверяет стационарность
// ВНУТРЕННЕЙ идеальногазовой задачи с заданным effective g, а не
// полной PR-задачи. Существующие допуски и golden baseline не
// менялись; старые тесты идеальногазового решателя проходят
// без изменений.

import { describe, it, expect } from 'vitest';
import { quantity } from '../Core/physicalQuantity';
import {
  solveEquilibrium,
  solveEquilibriumWithDiagnostics
} from '../Core/equilibrium';
import type { EquilibriumProblem } from '../Core/equilibrium';

const T1000 = quantity(1000, 'K');
const P1BAR = quantity(1, 'bar');
const P10BAR = quantity(10, 'bar');

function sp(
  id: string,
  elements: Record<string, number>,
  g: number,
  charge = 0
) {
  return { id, elements, charge, gStandardOverRT: g };
}

function abProblem(dg: number, options?: { maxIterations?: number; tolerance?: number }): EquilibriumProblem {
  return {
    temperature: T1000,
    pressure: P1BAR,
    standardStatePressure: P1BAR,
    species: [sp('A', { X: 1 }, 0), sp('B', { X: 1 }, dg)],
    elementTotals: { X: 1 },
    chargeTotal: 0,
    options
  };
}

describe('Stage 4.4.4.8-B1: диагностика стационарности', () => {
  it('результат идентичен solveEquilibrium на одной задаче', () => {
    const problems = [
      abProblem(0),
      abProblem(1),
      abProblem(100),
      {
        temperature: T1000,
        pressure: P1BAR,
        standardStatePressure: P1BAR,
        species: [sp('Na', { Na: 1 }, 0, 1), sp('Cl', { Cl: 1 }, 0, -1), sp('Ar', { Ar: 1 }, 2)],
        elementTotals: { Na: 1, Cl: 1, Ar: 10 },
        chargeTotal: 0
      }
    ];
    for (const problem of problems) {
      const plain = solveEquilibrium(problem);
      const detailed = solveEquilibriumWithDiagnostics(problem);
      expect(detailed.result).toEqual(plain);
      expect(JSON.stringify(detailed.result)).toBe(JSON.stringify(plain));
    }
  });

  it('JSON-ключи и структура обычного EquilibriumResult не изменились', () => {
    const r = solveEquilibrium(abProblem(1));
    expect(Object.keys(r).sort()).toEqual(
      [
        'status',
        'model',
        'iterations',
        'totalMoles',
        'moleFractions',
        'speciesMoles',
        'elementResiduals',
        'chargeResidual',
        'gibbsEnergy',
        'assumptions',
        'message'
      ].sort()
    );
    expect(r.model).toBe('ideal_gas');
    const detailed = solveEquilibriumWithDiagnostics(abProblem(1));
    expect(Object.keys(detailed.result).sort()).toEqual(Object.keys(r).sort());
  });

  it('диагностика только при converged: max_iterations и numerical_failure дают null', () => {
    const stalled = solveEquilibriumWithDiagnostics(abProblem(100, { maxIterations: 3 }));
    expect(stalled.result.status).toBe('max_iterations');
    expect(stalled.stationarityDiagnostics).toBeNull();
    expect(stalled.diagnosticsUnavailableReason).toBe('status_not_converged');

    const failed = solveEquilibriumWithDiagnostics(abProblem(5000));
    expect(failed.result.status).toBe('numerical_failure');
    expect(failed.stationarityDiagnostics).toBeNull();
    expect(failed.diagnosticsUnavailableReason).toBe('status_not_converged');
  });

  it('все активные виды присутствуют в диагностике простой задачи', () => {
    const d = solveEquilibriumWithDiagnostics(abProblem(1));
    expect(d.result.status).toBe('converged');
    const diag = d.stationarityDiagnostics!;
    expect(diag.activeSpeciesIds).toEqual(['A', 'B']);
    expect(diag.inactiveSpeciesIds).toEqual([]);
    expect(Object.keys(diag.dualProjectionOverRT).sort()).toEqual(['A', 'B']);
    expect(Object.keys(diag.idealChemicalPotentialOverRT).sort()).toEqual(['A', 'B']);
    expect(Object.keys(diag.stationarityResidualOverRT).sort()).toEqual(['A', 'B']);
    expect(diag.basisRowNames).toEqual(['X']);
  });

  it('dualProjectionOverRT согласуется с прямым SUM pi_j·c_ji по редуцированному базису', () => {
    // Базис: строки X (1,0,1) и Y (0,1,1); проекции: A = pi_X,
    // B = pi_Y, AB = pi_X + pi_Y. pi восстанавливается в ТЕСТЕ
    // из проекций A и B, после чего предсказывается AB.
    const problem: EquilibriumProblem = {
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0), sp('B', { Y: 1 }, 0), sp('AB', { X: 1, Y: 1 }, 0)],
      elementTotals: { X: 1, Y: 1 },
      chargeTotal: 0
    };
    const d = solveEquilibriumWithDiagnostics(problem);
    expect(d.result.status).toBe('converged');
    const diag = d.stationarityDiagnostics!;
    expect(diag.basisRowNames).toEqual(['X', 'Y']);
    const piX = diag.dualProjectionOverRT.A;
    const piY = diag.dualProjectionOverRT.B;
    expect(diag.dualProjectionOverRT.AB).toBeCloseTo(piX + piY, 12);
    // Независимая перекрёстная проверка через параметризацию
    // решателя: proj_i = ln(x_i) + g_i - ln(p°/P).
    const lpr = Math.log(1 / 1);
    for (const id of ['A', 'B', 'AB']) {
      const expected =
        Math.log(d.result.moleFractions[id]) - lpr;
      expect(diag.dualProjectionOverRT[id]).toBeCloseTo(expected, 10);
    }
  });

  it('idealChemicalPotentialOverRT соответствует формуле g° + ln(x_i) + ln(P/p°) при P ≠ p°', () => {
    const problem: EquilibriumProblem = {
      temperature: T1000,
      pressure: P10BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0), sp('B', { X: 1 }, 1)],
      elementTotals: { X: 1 },
      chargeTotal: 0
    };
    const d = solveEquilibriumWithDiagnostics(problem);
    expect(d.result.status).toBe('converged');
    const diag = d.stationarityDiagnostics!;
    const lnPressureRatio = Math.log(10 / 1); // ln(P/p°) = +ln(10)
    for (const id of ['A', 'B']) {
      const g = id === 'A' ? 0 : 1;
      const expected = g + Math.log(d.result.moleFractions[id]) + lnPressureRatio;
      expect(diag.idealChemicalPotentialOverRT[id]).toBeCloseTo(expected, 12);
    }
  });

  it('stationarityResidual конечен, мал и maxAbs согласован', () => {
    const d = solveEquilibriumWithDiagnostics(abProblem(1));
    const diag = d.stationarityDiagnostics!;
    let maxAbs = 0;
    for (const id of diag.activeSpeciesIds) {
      const residual = diag.stationarityResidualOverRT[id];
      expect(Number.isFinite(residual), 'residual конечен').toBe(true);
      expect(Math.abs(residual)).toBeLessThan(1e-8);
      const expected =
        diag.idealChemicalPotentialOverRT[id] - diag.dualProjectionOverRT[id];
      expect(residual).toBeCloseTo(expected, 15);
      maxAbs = Math.max(maxAbs, Math.abs(residual));
    }
    expect(diag.maxAbsStationarityResidualOverRT).toBeCloseTo(maxAbs, 15);
    expect(Number.isFinite(diag.maxAbsStationarityResidualOverRT)).toBe(true);
  });

  it('линейно зависимые строки: используется редуцированный базис решателя', () => {
    // Единственный вид AB(X:1,Y:1): строки X (1) и Y (1) линейно
    // зависимы - редуцированный базис содержит ровно одну строку,
    // а не восстановленный полный базис из двух.
    const problem: EquilibriumProblem = {
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('AB', { X: 1, Y: 1 }, 0)],
      elementTotals: { X: 1, Y: 1 },
      chargeTotal: 0
    };
    const d = solveEquilibriumWithDiagnostics(problem);
    expect(d.result.status).toBe('converged');
    const diag = d.stationarityDiagnostics!;
    expect(diag.basisRowNames.length).toBe(1);
    expect(['X', 'Y']).toContain(diag.basisRowNames[0]);
    expect(diag.activeSpeciesIds).toEqual(['AB']);
    expect(diag.idealChemicalPotentialOverRT.AB).toBeCloseTo(0, 12); // g=0, ln(1)=0, P=p°
    expect(Math.abs(diag.stationarityResidualOverRT.AB)).toBeLessThan(1e-8);
  });

  it('строка charge сохраняется в базисе, когда она действительно независима', () => {
    // X(c:1,+1) и Y(c:1,-1): строка заряда (1,-1) не выражается
    // через строку элемента (1,1) - оба имени в базисе.
    const problem: EquilibriumProblem = {
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('X', { c: 1 }, 0, 1), sp('Y', { c: 1 }, 0, -1)],
      elementTotals: { c: 2 },
      chargeTotal: 0
    };
    const d = solveEquilibriumWithDiagnostics(problem);
    expect(d.result.status).toBe('converged');
    const diag = d.stationarityDiagnostics!;
    expect(diag.basisRowNames).toEqual(['c', 'charge']);
    expect(d.result.moleFractions.X).toBeCloseTo(0.5, 12);
    expect(d.result.moleFractions.Y).toBeCloseTo(0.5, 12);
    expect(Math.abs(diag.stationarityResidualOverRT.X)).toBeLessThan(1e-8);
    expect(Math.abs(diag.stationarityResidualOverRT.Y)).toBeLessThan(1e-8);
  });

  it('виды, исключённые нулевыми итогами элементов, - inactive, без ln(0)', () => {
    const problem: EquilibriumProblem = {
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0), sp('B', { Y: 1 }, 0), sp('AZ', { X: 1, Z: 1 }, 0)],
      elementTotals: { X: 1, Y: 1, Z: 0 },
      chargeTotal: 0
    };
    const d = solveEquilibriumWithDiagnostics(problem);
    expect(d.result.status).toBe('converged');
    const diag = d.stationarityDiagnostics!;
    expect(diag.inactiveSpeciesIds).toEqual(['AZ']);
    expect(diag.activeSpeciesIds).toEqual(['A', 'B']);
    expect(Object.keys(diag.dualProjectionOverRT)).not.toContain('AZ');
    expect(Object.keys(diag.idealChemicalPotentialOverRT)).not.toContain('AZ');
    expect(Object.keys(diag.stationarityResidualOverRT)).not.toContain('AZ');
    // Семантика исключённых видов прежняя: ровно ноль в результате.
    expect(d.result.moleFractions.AZ).toBe(0);
    expect(d.result.speciesMoles.AZ).toBe(0);
    expect(d.result.assumptions).toContain('zero_element_total_species_excluded');
  });

  it('несходимость внутреннего решателя не выдаёт diagnostics', () => {
    const problem = abProblem(100, { maxIterations: 1 });
    const plain = solveEquilibrium(problem);
    const d = solveEquilibriumWithDiagnostics(problem);
    expect(plain.status).toBe('max_iterations');
    expect(d.result).toEqual(plain);
    expect(d.stationarityDiagnostics).toBeNull();
  });

  it('повторный вызов детерминирован: идентичные входы - идентичная диагностика', () => {
    const problem = abProblem(1);
    const first = solveEquilibriumWithDiagnostics(problem);
    const second = solveEquilibriumWithDiagnostics(problem);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const ionProblem: EquilibriumProblem = {
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('Na', { Na: 1 }, 0, 1), sp('Cl', { Cl: 1 }, 0, -1), sp('Ar', { Ar: 1 }, 2)],
      elementTotals: { Na: 1, Cl: 1, Ar: 10 },
      chargeTotal: 0
    };
    const ionFirst = solveEquilibriumWithDiagnostics(ionProblem);
    const ionSecond = solveEquilibriumWithDiagnostics(ionProblem);
    expect(JSON.stringify(ionFirst)).toBe(JSON.stringify(ionSecond));
  });

  it('старые идеальногазовые результаты не изменились (аналитические значения)', () => {
    const symmetric = solveEquilibrium(abProblem(0));
    expect(symmetric.moleFractions.A).toBeCloseTo(0.5, 12);
    expect(symmetric.moleFractions.B).toBeCloseTo(0.5, 12);
    const shifted = solveEquilibrium(abProblem(1));
    expect(shifted.moleFractions.B).toBeCloseTo(1 / (1 + Math.E), 12);
    expect(shifted.moleFractions.A).toBeCloseTo(Math.E / (1 + Math.E), 12);
    expect(shifted.model).toBe('ideal_gas');
  });
});
