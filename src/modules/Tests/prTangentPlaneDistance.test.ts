// ============================================================================
// Stage 4.4.4.4.1 — тесты скалярного tangent-plane distance (TPD)
// ----------------------------------------------------------------------------
// Проверяется Core/prTangentPlaneDistance.ts:
//   - тривиальные и предельные случаи (TPD(z; z) = ровно +0);
//   - побитовое совпадение с независимым прямым пересчётом формулы
//     Michelsen на синтетических конечных lnPhi;
//   - KL-предел (идеальный: lnPhi(w) = lnPhi(z));
//   - нулевые trial-доли (нет 0*ln(0), нет NaN) и структурные отказы
//     support_violation;
//   - совместность состояний (T, P, evidencePolicy, a_i, b_i, kij);
//   - invalid_input / numerical_failure на некорректных входах;
//   - точный нулевой предел притяжения 4.4.4.3.1 через реальный
//     вычислитель Core;
//   - перестановочная инвариантность и сохранение feed/trial root;
//   - отсутствие verdict о фазовой устойчивости в результате.
//
// Реальные состояния PR-смесей строятся фасадом каталога 4.4.4.3
// (CO2–N2 при 250 K, 2 МПа — внутри верифицированного диапазона kij
// 228.15–273.15 K). Никаких «экспериментально подтверждённых
// отрицательных TPD-точек» из Table A4 Okoro 2024 здесь НЕ тестируется:
// точки Table A4 — контекст, а не количественный TPD-оракул.
// ============================================================================

import { describe, it, expect } from 'vitest';

import { computePengRobinsonMixtureFromCatalog } from '../Data/pengRobinsonMixtureFacade';
import type {
  PengRobinsonMixtureCatalogRequest,
  PengRobinsonMixtureCatalogSuccess
} from '../Data/pengRobinsonMixtureFacade';

import {
  PR_TANGENT_PLANE_DISTANCE_ERROR_CODES,
  PR_TANGENT_PLANE_DISTANCE_SCOPE_NOTE,
  PR_TANGENT_PLANE_DISTANCE_SINGLE_ROOT_NOTE,
  computePrTangentPlaneDistance
} from '../Core/prTangentPlaneDistance';
import type {
  PrTangentPlaneDistanceFailure,
  PrTangentPlaneDistanceResult
} from '../Core/prTangentPlaneDistance';
import type {
  PengRobinsonEvidencePolicy,
  PengRobinsonEvidenceStatus,
  PengRobinsonMixtureFailure,
  PengRobinsonMixtureSuccess,
  PengRobinsonRootBranch
} from '../Core/pengRobinsonMixture';

// ============================================
// 1. HELPERS: реальные состояния через фасад каталога
// ============================================

const REAL_TEMPERATURE_K = 250;
const REAL_PRESSURE_PA = 2000000;

function mixSuccess(
  request: PengRobinsonMixtureCatalogRequest
): PengRobinsonMixtureCatalogSuccess {
  const result = computePengRobinsonMixtureFromCatalog(request);
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`ожидался успех, получен отказ: ${JSON.stringify(result)}`);
  }
  return result;
}

function mixFailure(
  request: PengRobinsonMixtureCatalogRequest
): PengRobinsonMixtureFailure {
  const result = computePengRobinsonMixtureFromCatalog(request);
  expect(result.status).toBe('failure');
  if (result.status !== 'failure') {
    throw new Error(`ожидался отказ, получен успех: ${JSON.stringify(result)}`);
  }
  return result;
}

function entry(gasId: string, moleFraction: number) {
  return { gasId, moleFraction };
}

function co2n2Vapor(co2: number, n2: number, temperatureK = REAL_TEMPERATURE_K) {
  return mixSuccess({
    composition: [entry('co2', co2), entry('n2', n2)],
    temperatureK,
    pressurePa: REAL_PRESSURE_PA,
    root: 'vapor',
    evidencePolicy: 'allow_partial'
  });
}

// ============================================
// 2. HELPERS: синтетические состояния с явными lnPhi
// ============================================

interface SyntheticComponent {
  component: string;
  moleFraction: number;
  lnPhi: number;
  aPaM6PerMol2?: number;
  bM3PerMol?: number;
}

interface SyntheticInteraction {
  componentA: string;
  componentB: string;
  kij: number;
  evidence?: string;
  applicabilityRangeK?: { minTemperatureK: number; maxTemperatureK: number } | null;
}

interface SyntheticStateSpec {
  components: readonly SyntheticComponent[];
  temperatureK?: number;
  pressurePa?: number;
  root?: PengRobinsonRootBranch;
  evidencePolicy?: PengRobinsonEvidencePolicy;
  hasDistinctBranches?: boolean;
  interactions?: readonly SyntheticInteraction[];
}

/**
 * Полностью типизированное синтетическое состояние PR-смеси с явно
 * заданными lnPhi (для формульных тестов). Поля кубики/корней —
 * правдоподобные константы: TPD их не использует, кроме
 * hasDistinctBranches (примечание о единственном корне).
 */
function makeState(spec: SyntheticStateSpec): PengRobinsonMixtureSuccess {
  const temperatureK = spec.temperatureK ?? 250;
  const pressurePa = spec.pressurePa ?? REAL_PRESSURE_PA;
  const aMix = 0.35;
  const bMix = 3.0e-5;
  return {
    status: 'success',
    temperatureK,
    pressurePa,
    root: spec.root ?? 'vapor',
    evidencePolicy: spec.evidencePolicy ?? 'allow_partial',
    aMixPaM6PerMol2: aMix,
    bMixM3PerMol: bMix,
    dimensionlessA: (aMix * pressurePa) / (8.314462618 * 8.314462618 * temperatureK * temperatureK),
    dimensionlessB: (bMix * pressurePa) / (8.314462618 * temperatureK),
    Z: 0.9,
    selectedRoot: 0.9,
    realRoots: [0.05, 0.9],
    physicalRoots: [0.05, 0.9],
    distinctPhysicalRootCount: 2,
    hasDistinctBranches: spec.hasDistinctBranches ?? true,
    components: spec.components.map((component) => {
      const lnPhi = component.lnPhi;
      return {
        component: component.component,
        moleFraction: component.moleFraction,
        aPaM6PerMol2: component.aPaM6PerMol2 ?? 0.25,
        bM3PerMol: component.bM3PerMol ?? 2.7e-5,
        sIPaM6PerMol2: 0.25,
        lnPhi,
        phi: Math.exp(lnPhi),
        fugacityPa: component.moleFraction * Math.exp(lnPhi) * pressurePa
      };
    }),
    binaryInteractionsUsed: (spec.interactions ?? []).map((interaction) => ({
      componentA: interaction.componentA,
      componentB: interaction.componentB,
      kij: interaction.kij,
      evidence: (interaction.evidence ?? 'PARTIALLY_VERIFIED') as PengRobinsonEvidenceStatus,
      applicabilityRangeK:
        interaction.applicabilityRangeK === undefined
          ? { minTemperatureK: 228.15, maxTemperatureK: 273.15 }
          : interaction.applicabilityRangeK
    })),
    warnings: [],
    notes: []
  };
}

function failureOf(result: PrTangentPlaneDistanceResult): PrTangentPlaneDistanceFailure {
  expect(result.status).toBe('failure');
  if (result.status !== 'failure') {
    throw new Error(`ожидался отказ, получен успех: ${JSON.stringify(result)}`);
  }
  return result;
}

function successOf(result: PrTangentPlaneDistanceResult) {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`ожидался успех, получен отказ: ${JSON.stringify(result)}`);
  }
  return result;
}

// ============================================
// 3. Реестр кодов ошибок
// ============================================

describe('Stage 4.4.4.4.1: реестр кодов отказа TPD', () => {
  it('полный перечень кодов: invalid_input, incompatible_state, support_violation, numerical_failure', () => {
    expect(PR_TANGENT_PLANE_DISTANCE_ERROR_CODES).toEqual([
      'invalid_input',
      'incompatible_state',
      'support_violation',
      'numerical_failure'
    ]);
  });
});

// ============================================
// 4. Тривиальные и предельные случаи
// ============================================

describe('Stage 4.4.4.4.1: тривиальные и предельные случаи', () => {
  it('одно и то же состояние как feed и trial: TPD = ровно +0 (не -0, не близко к нулю)', () => {
    const state = co2n2Vapor(0.95, 0.05);
    const result = computePrTangentPlaneDistance({ feed: state, trial: state });
    const success = successOf(result);
    expect(Object.is(success.tpd, 0)).toBe(true);
    expect(success.tpd).toBe(0);
    for (const contribution of success.contributions) {
      expect(Object.is(contribution.contribution, 0)).toBe(true);
    }
  });

  it('два независимо вычисленных одинаковых состояния: TPD = ровно +0', () => {
    const feed = co2n2Vapor(0.5, 0.5);
    const trial = co2n2Vapor(0.5, 0.5);
    const success = successOf(computePrTangentPlaneDistance({ feed, trial }));
    expect(Object.is(success.tpd, 0)).toBe(true);
  });

  it('KL-предел: lnPhi(w) = lnPhi(z) воспроизводит SUM w_i ln(w_i/z_i)', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.5, lnPhi: 0.4 },
        { component: 'b', moleFraction: 0.5, lnPhi: -0.1 }
      ]
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.4 },
        { component: 'b', moleFraction: 0.75, lnPhi: -0.1 }
      ]
    });
    const success = successOf(computePrTangentPlaneDistance({ feed, trial }));
    // Независимый пересчёт KL-выражения SUM w_i ln(w_i/z_i).
    let expected = 0;
    expected += 0.25 * Math.log(0.25 / 0.5);
    expected += 0.75 * Math.log(0.75 / 0.5);
    expect(success.tpd).toBeCloseTo(expected, 12);
    // И та же форма с разностью логарифмов — побитово.
    let expectedExact = 0;
    expectedExact += 0.25 * (Math.log(0.25) - Math.log(0.5));
    expectedExact += 0.75 * (Math.log(0.75) - Math.log(0.5));
    expect(success.tpd).toBe(expectedExact);
    expect(success.tpd).toBeGreaterThan(0);
  });

  it('нулевой trial-компонент: ровно нулевой вклад, нет NaN, нет 0*ln(0)', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.5, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.5, lnPhi: -0.2 }
      ]
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 1, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0, lnPhi: -0.2 }
      ]
    });
    const success = successOf(computePrTangentPlaneDistance({ feed, trial }));
    expect(Number.isFinite(success.tpd)).toBe(true);
    expect(success.contributions).toHaveLength(1);
    expect(success.contributions[0]?.component).toBe('a');
    // Компонента с w_i = 0 нет и в компактном составе вкладов.
    expect(success.contributions.some((c) => c.component === 'b')).toBe(false);
  });

  it('компонент, отсутствующий в trial целиком: тот же результат побитово', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.5, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.5, lnPhi: -0.2 }
      ]
    });
    const trialWithZero = makeState({
      components: [
        { component: 'a', moleFraction: 1, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0, lnPhi: -0.2 }
      ]
    });
    const trialAbsent = makeState({
      components: [{ component: 'a', moleFraction: 1, lnPhi: 0.5 }]
    });
    const withZero = successOf(computePrTangentPlaneDistance({ feed, trial: trialWithZero }));
    const absent = successOf(computePrTangentPlaneDistance({ feed, trial: trialAbsent }));
    expect(absent.tpd).toBe(withZero.tpd);
  });
});

// ============================================
// 5. Независимый прямой пересчёт формулы
// ============================================

describe('Stage 4.4.4.4.1: побитовое совпадение с независимым прямым вычислением', () => {
  it('синтетические конечные lnPhi: TPD совпадает с прямым пересчётом формулы Michelsen', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ]
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    const success = successOf(computePrTangentPlaneDistance({ feed, trial }));
    // Независимый пересчёт с той же аккумуляцией (0 + вклад a + вклад b).
    let expected = 0;
    expected += 0.25 * (Math.log(0.25) - Math.log(0.4) + 0.5 - 0.3);
    expected += 0.75 * (Math.log(0.75) - Math.log(0.6) + 0.1 - -0.2);
    expect(success.tpd).toBe(expected);
    // Покомпонентная сверка вкладов.
    expect(success.contributions).toHaveLength(2);
    expect(success.contributions[0]?.component).toBe('a');
    expect(success.contributions[0]?.contribution).toBe(
      0.25 * (Math.log(0.25) - Math.log(0.4) + 0.5 - 0.3)
    );
    expect(success.contributions[1]?.component).toBe('b');
    expect(success.contributions[1]?.contribution).toBe(
      0.75 * (Math.log(0.75) - Math.log(0.6) + 0.1 - -0.2)
    );
  });

  it('интеграция с реальным вычислителем: TPD = независимый пересчёт по lnPhi состояний', () => {
    const feed = co2n2Vapor(0.95, 0.05);
    const trial = co2n2Vapor(0.5, 0.5);
    const success = successOf(computePrTangentPlaneDistance({ feed, trial }));
    // Канонический порядок: 'co2' < 'n2'.
    const feedCo2 = feed.components.find((c) => c.component === 'co2');
    const feedN2 = feed.components.find((c) => c.component === 'n2');
    const trialCo2 = trial.components.find((c) => c.component === 'co2');
    const trialN2 = trial.components.find((c) => c.component === 'n2');
    expect(feedCo2).toBeDefined();
    expect(feedN2).toBeDefined();
    expect(trialCo2).toBeDefined();
    expect(trialN2).toBeDefined();
    let expected = 0;
    expected +=
      (trialCo2?.moleFraction ?? 0) *
      (Math.log(trialCo2?.moleFraction ?? 0) -
        Math.log(feedCo2?.moleFraction ?? 0) +
        (trialCo2?.lnPhi ?? 0) -
        (feedCo2?.lnPhi ?? 0));
    expected +=
      (trialN2?.moleFraction ?? 0) *
      (Math.log(trialN2?.moleFraction ?? 0) -
        Math.log(feedN2?.moleFraction ?? 0) +
        (trialN2?.lnPhi ?? 0) -
        (feedN2?.lnPhi ?? 0));
    expect(success.tpd).toBe(expected);
    expect(Number.isFinite(success.tpd)).toBe(true);
  });

  it('перестановка порядка компонентов входных массивов не меняет результат побитово', () => {
    const forwardFeed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ]
    });
    const forwardTrial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    const reversedFeed = makeState({
      components: [
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 },
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 }
      ]
    });
    const reversedTrial = makeState({
      components: [
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 },
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 }
      ]
    });
    const forward = successOf(
      computePrTangentPlaneDistance({ feed: forwardFeed, trial: forwardTrial })
    );
    const reversed = successOf(
      computePrTangentPlaneDistance({ feed: reversedFeed, trial: reversedTrial })
    );
    expect(reversed.tpd).toBe(forward.tpd);
    expect(reversed.contributions).toEqual(forward.contributions);
  });
});

// ============================================
// 6. Отказы контракта
// ============================================

describe('Stage 4.4.4.4.1: отказы контракта', () => {
  const okFeed = makeState({
    components: [
      { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
      { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
    ]
  });
  const okTrial = makeState({
    components: [
      { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
      { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
    ]
  });

  it('не-объект на входе: invalid_input', () => {
    const result = computePrTangentPlaneDistance(null as unknown as {
      feed: PengRobinsonMixtureSuccess;
      trial: PengRobinsonMixtureSuccess;
    });
    expect(failureOf(result).code).toBe('invalid_input');
  });

  it('состояние отказа вместо success: invalid_input (реальный fail-closed фасада)', () => {
    // 300 K — вне верифицированного диапазона kij 228.15–273.15 K.
    const failed = mixFailure({
      composition: [entry('co2', 0.95), entry('n2', 0.05)],
      temperatureK: 300,
      pressurePa: REAL_PRESSURE_PA,
      root: 'vapor',
      evidencePolicy: 'allow_partial'
    });
    const result = computePrTangentPlaneDistance({
      feed: failed as unknown as PengRobinsonMixtureSuccess,
      trial: okTrial
    });
    expect(failureOf(result).code).toBe('invalid_input');
  });

  it('несовпадение temperatureK: incompatible_state', () => {
    const trial = makeState({
      temperatureK: 250.0000001,
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed: okFeed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('несовпадение pressurePa: incompatible_state', () => {
    const trial = makeState({
      pressurePa: 2000001,
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed: okFeed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('несовпадение evidencePolicy: incompatible_state', () => {
    const trial = makeState({
      evidencePolicy: 'verified_only',
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed: okFeed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('несовпадение a_i компонента: incompatible_state', () => {
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5, aPaM6PerMol2: 0.26 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed: okFeed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('несовпадение b_i компонента: incompatible_state', () => {
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5, bM3PerMol: 2.8e-5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed: okFeed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('trial-пара kij отсутствует в feed: incompatible_state', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ],
      interactions: []
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ],
      interactions: [{ componentA: 'a', componentB: 'b', kij: -0.017 }]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('несовпадение значения kij (trial -0.01322 против feed -0.017): incompatible_state', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ],
      interactions: [{ componentA: 'a', componentB: 'b', kij: -0.017 }]
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ],
      interactions: [{ componentA: 'a', componentB: 'b', kij: -0.01322 }]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('несовпадение evidence пары kij: incompatible_state', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ],
      interactions: [{ componentA: 'a', componentB: 'b', kij: -0.017, evidence: 'PARTIALLY_VERIFIED' }]
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ],
      interactions: [{ componentA: 'a', componentB: 'b', kij: -0.017, evidence: 'REPORTED' }]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('несовпадение applicabilityRangeK пары kij (null против объекта): incompatible_state', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ],
      interactions: [{ componentA: 'a', componentB: 'b', kij: -0.017 }]
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ],
      interactions: [
        { componentA: 'a', componentB: 'b', kij: -0.017, applicabilityRangeK: null }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('несовпадение границ applicabilityRangeK пары kij: incompatible_state', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ],
      interactions: [{ componentA: 'a', componentB: 'b', kij: -0.017 }]
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ],
      interactions: [
        {
          componentA: 'a',
          componentB: 'b',
          kij: -0.017,
          applicabilityRangeK: { minTemperatureK: 228.15, maxTemperatureK: 300 }
        }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed, trial })).code).toBe(
      'incompatible_state'
    );
  });

  it('положительная trial-доля компонента, отсутствующего в feed: support_violation', () => {
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.5, lnPhi: 0.5 },
        { component: 'x', moleFraction: 0.5, lnPhi: 0.1 }
      ]
    });
    const failure = failureOf(computePrTangentPlaneDistance({ feed: okFeed, trial }));
    expect(failure.code).toBe('support_violation');
    expect(failure.message).toContain('x');
  });

  it('положительная trial-доля при z_i = 0 в feed: support_violation (НЕ Infinity/NaN)', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 1, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0, lnPhi: -0.2 }
      ]
    });
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.5, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.5, lnPhi: 0.1 }
      ]
    });
    const failure = failureOf(computePrTangentPlaneDistance({ feed, trial }));
    expect(failure.code).toBe('support_violation');
    expect(failure.message).toContain('b');
  });

  it('дублирующийся идентификатор компонента в состоянии: invalid_input', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.3, lnPhi: 0.3 },
        { component: 'a', moleFraction: 0.7, lnPhi: -0.2 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed, trial: okTrial })).code).toBe(
      'invalid_input'
    );
  });

  it('сумма состава вне допуска: invalid_input (без нормализации)', () => {
    const feed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.5, lnPhi: -0.2 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed, trial: okTrial })).code).toBe(
      'invalid_input'
    );
  });

  it('отрицательная мольная доля: invalid_input', () => {
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 1.1, lnPhi: 0.5 },
        { component: 'b', moleFraction: -0.1, lnPhi: 0.1 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed: okFeed, trial })).code).toBe(
      'invalid_input'
    );
  });

  it('неконечный lnPhi используемого компонента: numerical_failure', () => {
    const trial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: Number.NaN },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    expect(failureOf(computePrTangentPlaneDistance({ feed: okFeed, trial })).code).toBe(
      'numerical_failure'
    );
  });
});

// ============================================
// 7. Нулевой предел притяжения 4.4.4.3.1 и реальный вычислитель
// ============================================

describe('Stage 4.4.4.4.1: нулевой предел притяжения (фикстура Stage 4.4.4.3.1)', () => {
  it('N2, T = 1388.2195230363366 K (alpha = 0 ровно): TPD конечен и равен ровно +0, без NaN', () => {
    const zeroAttractionT = 1388.2195230363366;
    const zeroLimitP = 1000000;
    const state = mixSuccess({
      composition: [entry('n2', 1)],
      temperatureK: zeroAttractionT,
      pressurePa: zeroLimitP,
      root: 'vapor',
      evidencePolicy: 'allow_partial'
    });
    const success = successOf(computePrTangentPlaneDistance({ feed: state, trial: state }));
    expect(Number.isFinite(success.tpd)).toBe(true);
    expect(Object.is(success.tpd, 0)).toBe(true);
    expect(success.contributions).toHaveLength(1);
    expect(success.contributions[0]?.component).toBe('n2');
  });
});

// ============================================
// 8. Метаданные результата и отсутствие verdicts
// ============================================

describe('Stage 4.4.4.4.1: метаданные результата и границы подэтапа', () => {
  it('feedRoot/trialRoot сохраняются и не подменяются выводом об устойчивости', () => {
    const feed = makeState({
      root: 'vapor',
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ]
    });
    const trial = makeState({
      root: 'liquid',
      temperatureK: 250,
      pressurePa: REAL_PRESSURE_PA,
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    const success = successOf(computePrTangentPlaneDistance({ feed, trial }));
    expect(success.feedRoot).toBe('vapor');
    expect(success.trialRoot).toBe('liquid');
    expect(success.temperatureK).toBe(250);
    expect(success.pressurePa).toBe(REAL_PRESSURE_PA);
    expect(success.evidencePolicy).toBe('allow_partial');
    // В результате НЕТ verdict-полей фазовой устойчивости.
    const keys = Object.keys(success).sort();
    expect(keys).toEqual(
      [
        'contributions',
        'evidencePolicy',
        'feedComposition',
        'feedRoot',
        'notes',
        'pressurePa',
        'status',
        'temperatureK',
        'tpd',
        'trialComposition',
        'trialRoot'
      ].sort()
    );
    expect(keys).not.toContain('verdict');
    expect(keys).not.toContain('stability');
    expect(success.notes).toContain(PR_TANGENT_PLANE_DISTANCE_SCOPE_NOTE);
    expect(
      success.notes.some((note) => note.includes('unstable_detected')) ||
        success.notes.some((note) => note.includes('no_instability_found_within_search'))
    ).toBe(false);
  });

  it('интеграция с реальными состояниями: feedRoot/trialRoot соответствуют ветвям фасада', () => {
    const feed = co2n2Vapor(0.95, 0.05);
    const trial = co2n2Vapor(0.5, 0.5);
    const success = successOf(computePrTangentPlaneDistance({ feed, trial }));
    expect(success.feedRoot).toBe('vapor');
    expect(success.trialRoot).toBe('vapor');
    expect(success.temperatureK).toBe(REAL_TEMPERATURE_K);
    expect(success.pressurePa).toBe(REAL_PRESSURE_PA);
    expect(success.evidencePolicy).toBe('allow_partial');
    expect(Number.isFinite(success.tpd)).toBe(true);
  });

  it('примечание о единственном корне добавляется только при hasDistinctBranches = false', () => {
    const singleRootState = makeState({
      hasDistinctBranches: false,
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ]
    });
    const twoBranchTrial = makeState({
      components: [
        { component: 'a', moleFraction: 0.25, lnPhi: 0.5 },
        { component: 'b', moleFraction: 0.75, lnPhi: 0.1 }
      ]
    });
    const withNote = successOf(
      computePrTangentPlaneDistance({ feed: singleRootState, trial: twoBranchTrial })
    );
    expect(withNote.notes).toContain(PR_TANGENT_PLANE_DISTANCE_SINGLE_ROOT_NOTE);
    const twoBranchFeed = makeState({
      components: [
        { component: 'a', moleFraction: 0.4, lnPhi: 0.3 },
        { component: 'b', moleFraction: 0.6, lnPhi: -0.2 }
      ]
    });
    const withoutNote = successOf(
      computePrTangentPlaneDistance({ feed: twoBranchFeed, trial: twoBranchTrial })
    );
    expect(withoutNote.notes).not.toContain(PR_TANGENT_PLANE_DISTANCE_SINGLE_ROOT_NOTE);
    expect(withoutNote.notes).toEqual([PR_TANGENT_PLANE_DISTANCE_SCOPE_NOTE]);
  });

  it('компактные составы feed/trial отражают состояния (канонический порядок)', () => {
    const feed = co2n2Vapor(0.95, 0.05);
    const trial = co2n2Vapor(0.5, 0.5);
    const success = successOf(computePrTangentPlaneDistance({ feed, trial }));
    expect(success.feedComposition).toEqual([
      { component: 'co2', moleFraction: 0.95 },
      { component: 'n2', moleFraction: 0.05 }
    ]);
    expect(success.trialComposition).toEqual([
      { component: 'co2', moleFraction: 0.5 },
      { component: 'n2', moleFraction: 0.5 }
    ]);
  });
});
