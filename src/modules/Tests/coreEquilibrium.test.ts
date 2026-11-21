// ============================================
// STAGE 4.4.1 - Тесты решателя химического
// равновесия идеального газа (метод RAND)
// ============================================
//
// Проверяются требования Stage 4.4.1 (жёсткая зависимость
// Stage 4.4 «Химическое равновесие», roadmap §4.4):
// - аналитические равновесия: изомерия A<->B (логистика
//   x_B = 1/(1+e^dg)), димеризация 2X<->X2 (давление
//   сдвигает равновесие по Ле Шателье), ионная
//   электронейтральность как строка баланса, синтетическая
//   система с инертом;
// - станционарность: равенство химических потенциалов;
// - честные статусы несходимости: max_iterations,
//   numerical_failure - без ложного converged;
// - fail-closed вход: NaN, размерности, дубли id,
//   несовместные балансы - EquilibriumError с кодом;
// - редукция строк балансов (independentRowIndices);
// - адаптер каталога: сборка задачи, species_data_missing
//   всем списком отсутствующих видов;
// - детерминизм: повторный прогон идентичен;
// - корректирующая ревизия Stage 4.4.3 (C1, аудит): полнота
//   элементных ограничений - элемент видов без явного итога,
//   явные нулевые итоги и исключение видов из активной задачи,
//   нулевые итоги видов-кандидатов каталогного адаптера;
// - корректирующая ревизия Stage 4.4.3 (C2, аудит): критерий
//   совместности зависимых строк балансов согласован с
//   tolerance решателя, перед converged пересчитываются все
//   исходные строки элементов и заряда (включая исключённые
//   при редукции).

import { describe, it, expect } from 'vitest';
import { quantity } from '../Core/physicalQuantity';
import {
  EquilibriumError,
  buildEquilibriumProblemFromCatalog,
  elementTotalsFromCatalogAmounts,
  independentRowIndices,
  solveEquilibrium
} from '../Core/equilibrium';
import { buildThermodynamicCatalog } from '../Data/thermodynamicCatalog';

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

function abProblem(dg: number, options?: { maxIterations?: number; tolerance?: number }) {
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

/** Ожидаемое исключение решателя с данным кодом. */
function expectEquilibriumError(run: () => unknown, code: string): EquilibriumError {
  let error: EquilibriumError | null = null;
  try {
    run();
  } catch (e) {
    error = e as EquilibriumError;
  }
  expect(error, 'ожидалось исключение EquilibriumError').not.toBeNull();
  expect(error).toBeInstanceOf(EquilibriumError);
  expect(error!.code).toBe(code);
  return error!;
}

describe('Stage 4.4.1: синтетические равновесия', () => {
  it('изомерия A<->B, dg° = 0: симметричное равновесие 50/50', () => {
    const r = solveEquilibrium(abProblem(0));
    expect(r.status).toBe('converged');
    expect(r.model).toBe('ideal_gas');
    expect(r.iterations).toBeLessThan(20);
    expect(r.moleFractions.A).toBeCloseTo(0.5, 12);
    expect(r.moleFractions.B).toBeCloseTo(0.5, 12);
    expect(r.totalMoles).toBeCloseTo(1, 12);
    expect(Math.abs(r.elementResiduals.X)).toBeLessThan(1e-12);
    expect(r.gibbsEnergy).not.toBeNull();
    expect(r.gibbsEnergy!.unit).toBe('J');
    expect(r.gibbsEnergy!.value).toBeCloseTo(8.31446261815324 * 1000 * Math.log(0.5), 12);
  });

  it('изомерия A<->B, dg°/(RT) = 1: логистика x_B = 1/(1+e)', () => {
    const r = solveEquilibrium(abProblem(1));
    expect(r.status).toBe('converged');
    expect(r.moleFractions.B).toBeCloseTo(1 / (1 + Math.E), 12);
    expect(r.moleFractions.A).toBeCloseTo(Math.E / (1 + Math.E), 12);
    expect(r.totalMoles).toBeCloseTo(1, 12);
    const muA = Math.log(r.moleFractions.A);
    const muB = 1 + Math.log(r.moleFractions.B);
    expect(Math.abs(muB - muA), 'химические потенциалы равны').toBeLessThan(1e-10);
  });

  it('dg°/(RT) = 5: подавленный изомер x_B = 1/(1+e^5)', () => {
    const r = solveEquilibrium(abProblem(5));
    expect(r.status).toBe('converged');
    expect(r.moleFractions.B).toBeCloseTo(1 / (1 + Math.exp(5)), 12);
  });

  it('dg°/(RT) = 100: следовый изомер x_B = e^-100', () => {
    const r = solveEquilibrium(abProblem(100));
    expect(r.status).toBe('converged');
    expect(r.iterations).toBeLessThan(100);
    const exact = Math.exp(-100);
    expect(Math.abs(r.moleFractions.B - exact) / exact).toBeLessThan(1e-6);
  });

  it('maxIterations = 3: честный отказ max_iterations', () => {
    const r = solveEquilibrium(abProblem(100, { maxIterations: 3 }));
    expect(r.status).toBe('max_iterations');
    expect(r.iterations).toBe(3);
  });

  it('dg°/(RT) = 5000: numerical_failure при инициализации', () => {
    const r = solveEquilibrium(abProblem(5000));
    expect(r.status).toBe('numerical_failure');
    expect(r.iterations).toBe(0);
    expect(Number.isNaN(r.totalMoles)).toBe(true);
    expect(r.moleFractions).toEqual({});
    expect(r.gibbsEnergy).toBeNull();
    expect(r.elementResiduals.X).toBe(-1);
    expect(r.chargeResidual).toBe(0);
  });

  it('димеризация 2X<->X2 при 1 бар: x_X = (sqrt(5)-1)/2', () => {
    const r = solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('X', { X: 1 }, 0), sp('X2', { X: 2 }, 0)],
      elementTotals: { X: 1 },
      chargeTotal: 0
    });
    expect(r.status).toBe('converged');
    expect(r.moleFractions.X).toBeCloseTo((Math.sqrt(5) - 1) / 2, 12);
    expect(r.moleFractions.X2).toBeCloseTo((3 - Math.sqrt(5)) / 2, 12);
  });

  it('димеризация при 10 бар: давление сдвигает равновесие, x_X = (sqrt(41)-1)/20', () => {
    const r = solveEquilibrium({
      temperature: T1000,
      pressure: P10BAR,
      standardStatePressure: P1BAR,
      species: [sp('X', { X: 1 }, 0), sp('X2', { X: 2 }, 0)],
      elementTotals: { X: 1 },
      chargeTotal: 0
    });
    expect(r.status).toBe('converged');
    expect(r.moleFractions.X).toBeCloseTo((Math.sqrt(41) - 1) / 20, 12);
  });

  it('ионы Na+/Cl-/Ar: электронейтральность как строка баланса, x = 1/3', () => {
    const r = solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [
        sp('na+', { Na: 1 }, 0, 1),
        sp('cl-', { Cl: 1 }, 0, -1),
        sp('ar', { Ar: 1 }, 0)
      ],
      elementTotals: { Na: 1, Cl: 1, Ar: 1 },
      chargeTotal: 0
    });
    expect(r.status).toBe('converged');
    expect(r.moleFractions['na+']).toBeCloseTo(1 / 3, 12);
    expect(r.moleFractions['cl-']).toBeCloseTo(1 / 3, 12);
    expect(r.moleFractions.ar).toBeCloseTo(1 / 3, 12);
    expect(r.totalMoles).toBeCloseTo(3, 12);
    for (const v of Object.values(r.elementResiduals)) {
      expect(Math.abs(v)).toBeLessThan(1e-12);
    }
    expect(Math.abs(r.chargeResidual)).toBeLessThan(1e-12);
  });

  it('несовместный заряд (0.5) - infeasible', () => {
    const error = expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [
        sp('na+', { Na: 1 }, 0, 1),
        sp('cl-', { Cl: 1 }, 0, -1),
        sp('ar', { Ar: 1 }, 0)
      ],
      elementTotals: { Na: 1, Cl: 1, Ar: 1 },
      chargeTotal: 0.5
    }), 'infeasible');
    expect(error.details ?? '').toContain('charge');
  });

  it('синтетическая система с инертом: n_tot = 11, x_inert = 10/11, K = e^-10', () => {
    const r = solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [
        sp('ab', { A: 1, B: 1 }, 0),
        sp('a2', { A: 2 }, 5),
        sp('b2', { B: 2 }, 5),
        sp('inert', { I: 1 }, 0)
      ],
      elementTotals: { A: 1, B: 1, I: 10 },
      chargeTotal: 0
    });
    expect(r.status).toBe('converged');
    expect(r.totalMoles).toBeCloseTo(11, 10);
    expect(r.moleFractions.inert).toBeCloseTo(10 / 11, 10);
    const K = (r.moleFractions.a2 * r.moleFractions.b2)
      / (r.moleFractions.ab * r.moleFractions.ab);
    expect(K).toBeCloseTo(Math.exp(-10), 6);
  });

  it('детерминизм: повторный прогон идентичен', () => {
    const first = solveEquilibrium(abProblem(1));
    const second = solveEquilibrium(abProblem(1));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('Stage 4.4.1: fail-closed вход', () => {
  it('пустой список видов - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [],
      elementTotals: { X: 1 },
      chargeTotal: 0
    }), 'invalid_input');
  });

  it('дубли id видов - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0), sp('A', { X: 1 }, 1)],
      elementTotals: { X: 1 },
      chargeTotal: 0
    }), 'invalid_input');
  });

  it('g°/(RT) = NaN - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, Number.NaN)],
      elementTotals: { X: 1 },
      chargeTotal: 0
    }), 'invalid_input');
  });

  it('отрицательный итог элемента - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0)],
      elementTotals: { X: -1 },
      chargeTotal: 0
    }), 'invalid_input');
  });

  it('T = 0 K - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: quantity(0, 'K'),
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0)],
      elementTotals: { X: 1 },
      chargeTotal: 0
    }), 'invalid_input');
  });

  it('давление чужой размерности - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: quantity(1000, 'K'),
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0)],
      elementTotals: { X: 1 },
      chargeTotal: 0
    }), 'invalid_input');
  });

  it('tolerance = 0 - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium(abProblem(1, { tolerance: 0 })), 'invalid_input');
  });

  it('maxIterations = 0.5 - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium(abProblem(1, { maxIterations: 0.5 })), 'invalid_input');
  });

  it('элемент в итогах без видов - infeasible', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0)],
      elementTotals: { X: 1, Z: 1 },
      chargeTotal: 0
    }), 'infeasible');
  });

  it('итоговый заряд без заряженных видов - infeasible', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0)],
      elementTotals: { X: 1 },
      chargeTotal: 0.5
    }), 'infeasible');
  });

  it('нулевые итоги: задача без ограничений - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { X: 1 }, 0)],
      elementTotals: {},
      chargeTotal: 0
    }), 'invalid_input');
  });
});

describe('Stage 4.4.1: редукция строк балансов', () => {
  it('[[1,0],[0,1],[1,1]] - независимы первые две', () => {
    expect(independentRowIndices([[1, 0], [0, 1], [1, 1]])).toEqual([0, 1]);
  });

  it('[[1,0],[2,0]] - пропорциональные, остаётся первая', () => {
    expect(independentRowIndices([[1, 0], [2, 0]])).toEqual([0]);
  });
});

describe('Stage 4.4.1: адаптер каталога видов', () => {
  const catalog = buildThermodynamicCatalog();

  it('N2 + 3 H2 (невзаимодействующие элементы): доли 0.25/0.75', () => {
    const problem = buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2', 'h2'],
      amounts: { n2: 1, h2: 3 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    });
    const r = solveEquilibrium(problem);
    expect(r.status).toBe('converged');
    expect(r.iterations).toBeLessThan(20);
    expect(r.moleFractions.n2).toBeCloseTo(0.25, 12);
    expect(r.moleFractions.h2).toBeCloseTo(0.75, 12);
    expect(r.totalMoles).toBeCloseTo(4, 12);
    expect(r.speciesMoles.n2).toBeCloseTo(1, 10);
    expect(r.speciesMoles.h2).toBeCloseTo(3, 10);
  });

  it('отсутствующие виды - species_data_missing всем списком', () => {
    const error = expectEquilibriumError(() => buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2', 'no_such', 'ghost', 'phantom'],
      amounts: { n2: 1 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    }), 'species_data_missing');
    expect(error.details ?? '').toContain('no_such');
    expect(error.details ?? '').toContain('ghost');
    expect(error.details ?? '').toContain('phantom');
  });

  it('не-газовая фаза - species_data_missing', () => {
    const fakeCatalog = { get: () => ({ phase: 'liquid', thermodynamics: {} }) };
    expectEquilibriumError(() => buildEquilibriumProblemFromCatalog(fakeCatalog, {
      speciesIds: ['h2o'],
      amounts: { h2o: 1 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    }), 'species_data_missing');
  });

  it('amounts и elementTotals одновременно - invalid_input', () => {
    expectEquilibriumError(() => buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2'],
      amounts: { n2: 1 },
      elementTotals: { N: 2 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    }), 'invalid_input');
  });

  it('amounts вне speciesIds - invalid_input', () => {
    expectEquilibriumError(() => buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2'],
      amounts: { o2: 1 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    }), 'invalid_input');
  });

  it('температура вне диапазона сегментов каталога - invalid_input', () => {
    const error = expectEquilibriumError(() => buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2'],
      amounts: { n2: 1 },
      temperature: quantity(150, 'K'),
      pressure: P1BAR,
      standardStatePressure: P1BAR
    }), 'invalid_input');
    expect(error.details ?? '').toContain('150');
  });

  it('elementTotalsFromCatalogAmounts({h2o: 2}) - {H: 4, O: 2}, заряд 0', () => {
    const totals = elementTotalsFromCatalogAmounts(catalog, { h2o: 2 });
    expect(totals.elementTotals).toEqual({ H: 4, O: 2 });
    expect(totals.chargeTotal).toBe(0);
  });

  it('elementTotalsFromCatalogAmounts: отсутствующий вид - species_data_missing', () => {
    expectEquilibriumError(
      () => elementTotalsFromCatalogAmounts(catalog, { unobtainium: 1 }),
      'species_data_missing'
    );
  });
});

describe('Stage 4.4.3 (C1): полнота элементных ограничений', () => {
  const catalog = buildThermodynamicCatalog();

  it('элемент видов без явного итога - invalid_input, а не «не контролируем»', () => {
    const error = expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { A: 1 }, 0), sp('AB', { A: 1, B: 1 }, 0)],
      elementTotals: { A: 1 },
      chargeTotal: 0
    }), 'invalid_input');
    expect(error.message).toContain('B');
  });

  it('явный B: 0 - B-содержащий вид исключен, его количество - ровно ноль', () => {
    const r = solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('A', { A: 1 }, 0), sp('AB', { A: 1, B: 1 }, 0)],
      elementTotals: { A: 1, B: 0 },
      chargeTotal: 0
    });
    expect(r.status).toBe('converged');
    expect(r.moleFractions.A).toBeCloseTo(1, 12);
    // строго ноль, а не следовой экспоненциальный хвост
    expect(r.moleFractions.AB).toBe(0);
    expect(r.speciesMoles.AB).toBe(0);
    expect(r.elementResiduals.B).toBe(0);
    expect(r.assumptions).toContain('zero_element_total_species_excluded');
    expect(r.message).toContain('AB');
  });

  it('каталожный адаптер: кандидаты без начального количества дают явные нулевые итоги', () => {
    const problem = buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2', 'nh3'],
      amounts: { n2: 1 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    });
    expect(problem.elementTotals).toEqual({ N: 2, H: 0 });
    const r = solveEquilibrium(problem);
    expect(r.status).toBe('converged');
    expect(r.moleFractions.n2).toBeCloseTo(1, 12);
    // NH3 не может образоваться из ничего: H отсутствует в запасе
    expect(r.moleFractions.nh3).toBe(0);
    expect(r.speciesMoles.nh3).toBe(0);
    expect(r.elementResiduals.H).toBe(0);
  });

  it('адаптер + elementTotals без H при H-содержащем виде - invalid_input', () => {
    expectEquilibriumError(() => solveEquilibrium(buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2', 'nh3'],
      elementTotals: { N: 2 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    })), 'invalid_input');
  });

  it('все виды исключены нулевыми итогами, но итог ненулевой - infeasible', () => {
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('AB', { A: 1, B: 1 }, 0)],
      elementTotals: { A: 1, B: 0 },
      chargeTotal: 0
    }), 'infeasible');
  });

  it('позитивная смесь: все виды совместимы с итогами - converged без исключений', () => {
    const r = solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('ab', { A: 1, B: 1 }, 0), sp('a2', { A: 2 }, 5), sp('b2', { B: 2 }, 5)],
      elementTotals: { A: 1, B: 1 },
      chargeTotal: 0
    });
    expect(r.status).toBe('converged');
    expect(r.assumptions).not.toContain('zero_element_total_species_excluded');
    expect(r.message).not.toContain('исключены');
  });
});

describe('Stage 4.4.3 (C2): совместность зависимых строк и финальная проверка балансов', () => {
  it('несовместная зависимая строка (расхождение 5e-9) - infeasible, а не converged', () => {
    // Критерий совместности согласован с tolerance (по умолчанию
    // 1e-13): расхождение итогов 5e-9 на три порядка больше
    // критерия Stage 4.4 (1e-12); фиксированные 1e-8 маскировали
    // бы его и выдавали converged с невязкой B = -5e-9 моль.
    const error = expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('AB', { A: 1, B: 1 }, 0)],
      elementTotals: { A: 1, B: 1 + 5e-9 },
      chargeTotal: 0
    }), 'infeasible');
    expect(error.message).toContain('несовместны');
  });

  it('точные зависимые строки с совместными итогами решаются; все исходные невязки в критерии', () => {
    const r = solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('AB', { A: 1, B: 1 }, 0)],
      elementTotals: { A: 1, B: 1 },
      chargeTotal: 0
    });
    expect(r.status).toBe('converged');
    expect(r.moleFractions.AB).toBeCloseTo(1, 12);
    expect(r.totalMoles).toBeCloseTo(1, 12);
    // Обе исходные строки, включая исключённую при редукции,
    // удовлетворяют объявленному критерию tolerance·max(1, |итог|).
    expect(Math.abs(r.elementResiduals.A)).toBeLessThanOrEqual(1e-13);
    expect(Math.abs(r.elementResiduals.B)).toBeLessThanOrEqual(1e-13);
  });

  it('заряд: несовместная зависимая строка баланса заряда (5e-9) - infeasible', () => {
    // Строка заряда = строка Na - строка Cl (линейно зависима);
    // итог 5e-9 при элементных итогах 1/1 несовместен с
    // критерием tolerance·max(1, |итог|) = 1e-13.
    expectEquilibriumError(() => solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('na+', { Na: 1 }, 0, 1), sp('cl-', { Cl: 1 }, 0, -1)],
      elementTotals: { Na: 1, Cl: 1 },
      chargeTotal: 5e-9
    }), 'infeasible');
  });

  it('после converged все исходные elementResiduals и chargeResidual в объявленном критерии', () => {
    const r = solveEquilibrium({
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR,
      species: [sp('na+', { Na: 1 }, 0, 1), sp('cl-', { Cl: 1 }, 0, -1), sp('ar', { Ar: 1 }, 0)],
      elementTotals: { Na: 1, Cl: 1, Ar: 2 },
      chargeTotal: 0
    });
    expect(r.status).toBe('converged');
    expect(r.totalMoles).toBeCloseTo(4, 12);
    for (const name of ['Na', 'Cl', 'Ar']) {
      expect(Math.abs(r.elementResiduals[name])).toBeLessThanOrEqual(1e-13);
    }
    expect(Math.abs(r.chargeResidual)).toBeLessThanOrEqual(1e-13);
  });
});

describe('Stage 4.4.3 (C4): согласованность стандартного состояния данных', () => {
  const catalog = buildThermodynamicCatalog();

  it('каталог NASA CEA заявляет конвенцию p° = 1 бар', () => {
    const referenceState = catalog.get('n2')!.thermodynamics!.referenceState!;
    expect(referenceState.standardStatePressure?.value).toBe(1);
    expect(referenceState.standardStatePressure?.unit).toBe('bar');
    expect(referenceState.standardState).toContain('1 бар');
    expect(referenceState.standardState).toContain('TP-2002-211556');
    // pressure записи не заполняется: thermo.inp не задаёт p° построчно.
    expect(referenceState.pressure).toBeUndefined();
  });

  it('адаптер принимает p° задачи, совпадающий с конвенцией данных', () => {
    const problem = buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2', 'h2'],
      amounts: { n2: 1 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    });
    const r = solveEquilibrium(problem);
    expect(r.status).toBe('converged');
  });

  it('адаптер отвергает p° задачи 1 atm (101325 Па) для данных NASA CEA', () => {
    // 1 atm и 1 бар не взаимозаменяемы (S° отличается на
    // R·ln(101325/100000) ~ 0.11 Дж/(моль·К)); пересчёт g°
    // не реализован - несовместимое p° это invalid_input.
    const error = expectEquilibriumError(() => buildEquilibriumProblemFromCatalog(catalog, {
      speciesIds: ['n2'],
      amounts: { n2: 1 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: quantity(101325, 'Pa')
    }), 'invalid_input');
    expect(error.message).toContain('101325');
    expect(error.message).toContain('100000');
  });

  it('вид без заявленного p° данных - invalid_input (fail-closed)', () => {
    const fakeCatalog = {
      get: () => ({
        phase: 'gas',
        elements: { N: 2 },
        charge: 0,
        thermodynamics: {
          referenceState: { phase: 'gas', standardState: 'конвенция не заявлена' }
        }
      })
    };
    const error = expectEquilibriumError(() => buildEquilibriumProblemFromCatalog(fakeCatalog, {
      speciesIds: ['n2'],
      amounts: { n2: 1 },
      temperature: T1000,
      pressure: P1BAR,
      standardStatePressure: P1BAR
    }), 'invalid_input');
    expect(error.message).toContain('не заявлено');
  });
});
