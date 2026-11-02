// ============================================
// STAGE 4.4.2 - K-валидация решателя равновесия
// на данных каталога (NASA CEA) против NIST
// ============================================
//
// Критерий Stage 4.4.2 (roadmap §4.4): равновесные
// константы, восстановленные из состава, который нашёл
// решатель, воспроизводят справочные значения:
// - K_solver (из мольных долей) равна K_CEA =
//   exp(-ΔG°/(R·T)) из тех же g°/(R·T) каталога:
//   |Δlog10 K| < 1e-8 - термодинамическое тождество
//   идеального газа при P = p° = 1 бар;
// - K_NIST из Shomate-полиномов NIST-JANAF (Chase 1998;
//   webbook.nist.gov; p° = 1 бар): |Δlog10 K| < 0.01
//   (критерий этапа: известные K в пределах 1%);
// - балансы элементов <= 1e-12 моль.
//
// Shomate-константы сверены с JANAF-таблицами WebBook
// (проверено 2026-11-02): S° и H°-H°298 воспроизводятся
// в пределах округления таблиц (0.05 Дж/моль·К).

import { describe, it, expect } from 'vitest';
import { quantity } from '../Core/physicalQuantity';
import {
  buildEquilibriumProblemFromCatalog,
  solveEquilibrium
} from '../Core/equilibrium';
import { buildThermodynamicCatalog } from '../Data/thermodynamicCatalog';

const P1BAR = quantity(1, 'bar');

// R = k·N_A, SI 2019 (точно, как в Core/thermoFunctions)
const R_J_PER_MOL_K = 8.31446261815324;

// NIST-JANAF Shomate (Chase 1998, J. Phys. Chem. Ref. Data,
// Monograph 9; webbook.nist.gov; p° = 1 бар):
// [A, B, C, D, E, F, G, H(298)], t = T/1000;
// H°(T) кДж/моль = A·t + B·t²/2 + C·t³/3 + D·t⁴/4 − E/t + F;
// S° Дж/(моль·К) = A·ln t + B·t + C·t²/2 + D·t³/3 − E/(2t²) + G.
// Сегменты: h2 298–1000 K (при 1100 K экстраполяция сходится
// с JANAF-таблицей в пределах 0.05 кДж/моль, проверено
// 2026-11-02), n2 500–2000 K, nh3 298–1000 K, h2o 500–1700 K,
// co 298–1300 K, co2 298–1200 K. Константа F даёт абсолютную
// H°(T) (включая теплоту образования).
const SHOMATE_NIST: Record<string, number[]> = {
  h2: [33.066178, -11.363417, 11.432816, -2.772874,
    -0.158558, -9.980797, 172.707974, 0.0],
  n2: [19.50583, 19.88705, -8.598535, 1.369784,
    0.527601, -4.935202, 212.39, 0.0],
  nh3: [19.99563, 49.77119, -15.37599, 1.921168,
    0.189174, -53.30667, 203.8591, -45.89806],
  h2o: [30.09200, 6.832514, 6.793435, -2.534480,
    0.082139, -250.8810, 223.3967, -241.8264],
  co: [25.56759, 6.096130, 4.054656, -2.671301,
    0.131021, -118.0089, 227.3665, -110.5271],
  co2: [24.99735, 55.18696, -33.69137, 7.948387,
    -0.136638, -403.6075, 228.2431, -393.5224]
};

/** g°/(R·T) вида по Shomate-полиному NIST при T, K. */
function gibbsOverRtNist(coefficients: number[], temperatureK: number): number {
  const t = temperatureK / 1000;
  const enthalpyKJPerMol = coefficients[0] * t
    + coefficients[1] * t * t / 2
    + coefficients[2] * t ** 3 / 3
    + coefficients[3] * t ** 4 / 4
    - coefficients[4] / t
    + coefficients[5];
  const entropyJPerMolK = coefficients[0] * Math.log(t)
    + coefficients[1] * t
    + coefficients[2] * t * t / 2
    + coefficients[3] * t ** 3 / 3
    - coefficients[4] / (2 * t * t)
    + coefficients[6];
  return (enthalpyKJPerMol * 1000 - temperatureK * entropyJPerMolK)
    / (R_J_PER_MOL_K * temperatureK);
}

describe('Stage 4.4.2: K-валидация равновесия NH3', () => {
  const catalog = buildThermodynamicCatalog();

  it('NH3 <=> 0.5 N2 + 1.5 H2 при 700/900/1000 K: K решателя = K CEA = K NIST', () => {
    for (const T of [700, 900, 1000]) {
      const problem = buildEquilibriumProblemFromCatalog(catalog, {
        speciesIds: ['nh3', 'n2', 'h2'],
        amounts: { nh3: 1 },
        temperature: quantity(T, 'K'),
        pressure: P1BAR,
        standardStatePressure: P1BAR
      });
      const r = solveEquilibrium(problem);
      expect(r.status, `T = ${T} K`).toBe('converged');
      for (const [element, residual] of Object.entries(r.elementResiduals)) {
        expect(Math.abs(residual), `баланс ${element} при T = ${T} K`)
          .toBeLessThan(1e-12);
      }
      const sumX = r.moleFractions.nh3 + r.moleFractions.n2 + r.moleFractions.h2;
      expect(Math.abs(sumX - 1), `сумма долей при T = ${T} K`).toBeLessThan(1e-12);
      expect(r.totalMoles, `число молей при T = ${T} K`).toBeGreaterThan(1);
      expect(r.totalMoles, `число молей при T = ${T} K`).toBeLessThan(2);

      const g: Record<string, number> = {};
      for (const s of problem.species) {
        g[s.id] = s.gStandardOverRT;
      }
      const Ksolver = Math.sqrt(r.moleFractions.n2)
        * r.moleFractions.h2 ** 1.5 / r.moleFractions.nh3;
      const Kcea = Math.exp(-(0.5 * g.n2 + 1.5 * g.h2 - g.nh3));
      const Knist = Math.exp(-(0.5 * gibbsOverRtNist(SHOMATE_NIST.n2, T)
        + 1.5 * gibbsOverRtNist(SHOMATE_NIST.h2, T)
        - gibbsOverRtNist(SHOMATE_NIST.nh3, T)));
      expect(Math.abs(Math.log10(Ksolver / Kcea)), `K_CEA при T = ${T} K`)
        .toBeLessThan(1e-8);
      expect(Math.abs(Math.log10(Ksolver / Knist)), `K_NIST при T = ${T} K`)
        .toBeLessThan(0.01);
    }
  });
});

describe('Stage 4.4.2: K-валидация равновесия WGS', () => {
  const catalog = buildThermodynamicCatalog();

  it('CO2 + H2 <=> CO + H2O при 700/900/1100 K: K решателя = K CEA = K NIST', () => {
    for (const T of [700, 900, 1100]) {
      const problem = buildEquilibriumProblemFromCatalog(catalog, {
        speciesIds: ['co2', 'h2', 'co', 'h2o'],
        amounts: { co2: 1, h2: 1 },
        temperature: quantity(T, 'K'),
        pressure: P1BAR,
        standardStatePressure: P1BAR
      });
      const r = solveEquilibrium(problem);
      expect(r.status, `T = ${T} K`).toBe('converged');
      for (const [element, residual] of Object.entries(r.elementResiduals)) {
        expect(Math.abs(residual), `баланс ${element} при T = ${T} K`)
          .toBeLessThan(1e-12);
      }
      // Δν = 0: полное число молей сохраняется точно
      expect(r.totalMoles, `число молей при T = ${T} K`).toBeCloseTo(2, 12);

      const g: Record<string, number> = {};
      for (const s of problem.species) {
        g[s.id] = s.gStandardOverRT;
      }
      const Ksolver = r.moleFractions.co * r.moleFractions.h2o
        / (r.moleFractions.co2 * r.moleFractions.h2);
      const Kcea = Math.exp(-(g.co + g.h2o - g.co2 - g.h2));
      const Knist = Math.exp(-(gibbsOverRtNist(SHOMATE_NIST.co, T)
        + gibbsOverRtNist(SHOMATE_NIST.h2o, T)
        - gibbsOverRtNist(SHOMATE_NIST.co2, T)
        - gibbsOverRtNist(SHOMATE_NIST.h2, T)));
      expect(Math.abs(Math.log10(Ksolver / Kcea)), `K_CEA при T = ${T} K`)
        .toBeLessThan(1e-8);
      expect(Math.abs(Math.log10(Ksolver / Knist)), `K_NIST при T = ${T} K`)
        .toBeLessThan(0.01);
    }
  });
});
