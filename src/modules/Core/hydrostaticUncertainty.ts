// ============================================
// HYDROSTATIC UNCERTAINTY — measured-node first-order propagation
// ============================================
//
// This module propagates one-sigma uncertainties for a single measured
// temperature profile through the hydrostatic pressure equation:
//
//   d ln(P)/dz = -g(z) * Mbar / (R_u * T(z))
//
// Temperature-node sensitivities are integrated with 5-point
// Gauss-Legendre quadrature over the same piecewise-linear basis used by
// HydrostaticColumnInput.measuredNodes. The propagated pressure and
// density uncertainties are first-order (linearized), conditional on
// fixed body mass, radius, composition and gravity model.
//
// The source PDS product does not provide the node-to-node covariance
// matrix. This implementation therefore uses an explicitly documented
// diagonal covariance approximation (independent one-sigma node errors).
// It does not propagate uncertainty to integrated column inventories,
// composition, gravity coefficients, or kinetic rates.

import type { DataProvenance } from './scientificValue';
import {
  temperatureAtGeometricHeight,
  type HydrostaticColumnCompleted,
  type HydrostaticColumnInput,
  type HydrostaticProfilePoint
} from './hydrostaticAtmosphere';
import { G } from '../Units';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from './thermoFunctions';

export interface MeasuredNodeUncertaintyInput {
  /** One-standard-deviation uncertainty of the pressure boundary, Pa. */
  readonly surfacePressureSigmaPa: number;
  /** One-standard-deviation temperature uncertainty for every measured node, K. */
  readonly temperatureNodeSigmaK: readonly number[];
}

export interface HydrostaticPointUncertainty {
  readonly heightM: number;
  readonly temperatureSigmaK: number;
  readonly pressureSigmaPa: number;
  readonly pressureRelativeSigma: number;
  readonly densitySigmaKgPerM3: number;
  readonly densityRelativeSigma: number;
  readonly pressureLowerOneSigmaPa: number;
  readonly pressureUpperOneSigmaPa: number;
  readonly densityLowerOneSigmaKgPerM3: number;
  readonly densityUpperOneSigmaKgPerM3: number;
}

export interface HydrostaticUncertaintyEstimate {
  readonly status: 'estimated';
  readonly method: 'first_order_linearized_diagonal_covariance';
  readonly uncertaintyLevel: 'one_sigma';
  readonly covarianceAssumption: string;
  readonly conditionalOn: readonly string[];
  readonly limitations: readonly string[];
  readonly points: readonly HydrostaticPointUncertainty[];
  readonly provenance: DataProvenance;
}

export type HydrostaticUncertaintyResult =
  | HydrostaticUncertaintyEstimate
  | { readonly status: 'invalid_input'; readonly errors: readonly string[] };

const GAUSS_LEGENDRE_5_NODES = [
  -0.906179845938664,
  -0.5384693101056831,
  0,
  0.5384693101056831,
  0.906179845938664
] as const;

const GAUSS_LEGENDRE_5_WEIGHTS = [
  0.2369268850561891,
  0.4786286704993665,
  0.5688888888888889,
  0.4786286704993665,
  0.2369268850561891
] as const;

function invalid(...errors: string[]): HydrostaticUncertaintyResult {
  return { status: 'invalid_input', errors };
}

function interpolateTemperatureSigma(
  nodes: readonly { readonly heightM: number; readonly temperatureK: number }[],
  sigmaK: readonly number[],
  heightM: number
): { readonly temperatureK: number; readonly sigmaK: number; readonly lowerNode: number; readonly upperWeight: number } | null {
  if (heightM < nodes[0].heightM || heightM > nodes[nodes.length - 1].heightM) return null;
  if (heightM === nodes[nodes.length - 1].heightM) {
    const lowerNode = nodes.length - 2;
    return {
      temperatureK: nodes[nodes.length - 1].temperatureK,
      sigmaK: sigmaK[nodes.length - 1],
      lowerNode,
      upperWeight: 1
    };
  }

  let lowerNode = 0;
  while (lowerNode < nodes.length - 2 && heightM > nodes[lowerNode + 1].heightM) {
    lowerNode += 1;
  }
  const lower = nodes[lowerNode];
  const upper = nodes[lowerNode + 1];
  const upperWeight = (heightM - lower.heightM) / (upper.heightM - lower.heightM);
  const lowerWeight = 1 - upperWeight;
  const temperatureK = lower.temperatureK * lowerWeight + upper.temperatureK * upperWeight;
  const sigmaAtHeightK = Math.sqrt(
    lowerWeight * lowerWeight * sigmaK[lowerNode] * sigmaK[lowerNode] +
    upperWeight * upperWeight * sigmaK[lowerNode + 1] * sigmaK[lowerNode + 1]
  );
  return { temperatureK, sigmaK: sigmaAtHeightK, lowerNode, upperWeight };
}

/**
 * Propagate boundary-pressure and measured-temperature-node standard
 * deviations to P(z) and rho(z) of a completed hydrostatic column.
 *
 * Scope is intentionally limited to one measuredNodes layer. This
 * matches a single occultation profile and remains valid when that
 * source layer has first been adaptively subdivided: pass the ORIGINAL
 * input and the completed refined column.
 */
export function propagateMeasuredNodeHydrostaticUncertainty(
  input: HydrostaticColumnInput,
  completed: HydrostaticColumnCompleted,
  uncertainty: MeasuredNodeUncertaintyInput
): HydrostaticUncertaintyResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') return invalid('input: требуется HydrostaticColumnInput');
  if (!completed || completed.status !== 'completed') {
    return invalid('completed: требуется успешно рассчитанная гидростатическая колонка');
  }
  if (!uncertainty || typeof uncertainty !== 'object') {
    return invalid('uncertainty: отсутствует входная неопределённость');
  }
  if (input.layers.length !== 1) {
    errors.push('поддерживается ровно один исходный measuredNodes слой; многослойная ковариация пока не реализована');
  }
  const sourceLayer = input.layers[0];
  if (sourceLayer?.temperature.kind !== 'measuredNodes') {
    errors.push('температурная модель должна быть measuredNodes с линейной интерполяцией');
  }
  const nodes = sourceLayer?.temperature.kind === 'measuredNodes'
    ? sourceLayer.temperature.nodes
    : [];
  if (nodes.length < 2) errors.push('measuredNodes: требуется не менее двух узлов');
  if (uncertainty.temperatureNodeSigmaK.length !== nodes.length) {
    errors.push(
      'temperatureNodeSigmaK: число неопределённостей (' +
      uncertainty.temperatureNodeSigmaK.length +
      ') должно совпадать с числом температурных узлов (' + nodes.length + ')'
    );
  }

  const pressurePa = input.surface?.surfacePressurePa;
  const pressureSigmaPa = uncertainty.surfacePressureSigmaPa;
  if (!Number.isFinite(pressureSigmaPa) || pressureSigmaPa < 0) {
    errors.push('surfacePressureSigmaPa: требуется конечное неотрицательное стандартное отклонение');
  } else if (Number.isFinite(pressurePa) && pressureSigmaPa >= pressurePa) {
    errors.push('surfacePressureSigmaPa: one-sigma lower bound must remain positive');
  }
  for (let i = 0; i < uncertainty.temperatureNodeSigmaK.length; i += 1) {
    const sigma = uncertainty.temperatureNodeSigmaK[i];
    const temperature = nodes[i]?.temperatureK;
    if (!Number.isFinite(sigma) || sigma < 0) {
      errors.push('temperatureNodeSigmaK[' + i + ']: требуется конечное неотрицательное стандартное отклонение');
    } else if (Number.isFinite(temperature) && sigma >= temperature) {
      errors.push('temperatureNodeSigmaK[' + i + ']: one-sigma lower temperature bound must remain positive');
    }
  }

  if (!Number.isFinite(input.body?.bodyMassKg) || input.body.bodyMassKg <= 0) {
    errors.push('body.bodyMassKg: требуется конечная положительная масса');
  }
  if (!Number.isFinite(input.body?.referenceRadiusM) || input.body.referenceRadiusM <= 0) {
    errors.push('body.referenceRadiusM: требуется конечный положительный радиус');
  }
  if (!Number.isFinite(pressurePa) || pressurePa <= 0) {
    errors.push('surface.surfacePressurePa: требуется конечное положительное давление');
  }
  if (errors.length > 0) return { status: 'invalid_input', errors };

  const firstNode = nodes[0];
  const lastNode = nodes[nodes.length - 1];
  const bottomHeightM = input.surface.bottomHeightM ?? 0;
  if (
    Math.abs(firstNode.heightM - bottomHeightM) > 1e-6 ||
    Math.abs(completed.coverage.bottomHeightM - firstNode.heightM) > 1e-6 ||
    Math.abs(completed.coverage.topHeightM - lastNode.heightM) > 1e-6
  ) {
    return invalid(
      'геометрия measuredNodes должна точно покрывать исходную гидростатическую колонку без экстраполяции'
    );
  }
  if (completed.gravitationMode !== (input.numerics?.gravitationMode ?? 'spherical-gravity')) {
    return invalid('режим гравитации результата не совпадает с исходным HydrostaticColumnInput');
  }

  const sourceProfile = completed.profile;
  if (sourceProfile.length === 0) return invalid('completed.profile: нет точек для распространения неопределённости');
  const meanMolarMassKgPerMol = sourceProfile[0].meanMolarMassKgPerMol;
  if (!Number.isFinite(meanMolarMassKgPerMol) || meanMolarMassKgPerMol <= 0) {
    return invalid('mean molar mass: в результате отсутствует конечная положительная молярная масса смеси');
  }
  if (sourceProfile.some((point) =>
    Math.abs(point.meanMolarMassKgPerMol - meanMolarMassKgPerMol) >
    Math.max(1e-14, meanMolarMassKgPerMol * 1e-10)
  )) {
    return invalid('состав/средняя молярная масса изменяются по высоте; однослойная модель неопределённости неприменима');
  }

  const gasConstant = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;
  const bodyMassKg = input.body.bodyMassKg;
  const bodyRadiusM = input.body.referenceRadiusM;
  const constantGravityMs2 =
    (G * bodyMassKg) / ((bodyRadiusM + bottomHeightM) * (bodyRadiusM + bottomHeightM));

  const uniquePoints = new Map<number, HydrostaticProfilePoint>();
  for (const point of sourceProfile) {
    if (!uniquePoints.has(point.heightM)) uniquePoints.set(point.heightM, point);
  }
  const orderedPoints = Array.from(uniquePoints.values()).sort((a, b) => a.heightM - b.heightM);

  const points: HydrostaticPointUncertainty[] = [];
  for (const point of orderedPoints) {
    const local = interpolateTemperatureSigma(nodes, uncertainty.temperatureNodeSigmaK, point.heightM);
    if (local === null) {
      return invalid('профиль результата содержит высоту вне measuredNodes: ' + point.heightM + ' м');
    }

    // d ln(P(z)) / d T_j = integral[g*Mbar/(R*T^2) * phi_j(z)] dz.
    // The piecewise-linear measuredNodes basis has only two nonzero
    // hat functions inside any one interval.
    const logPressureSensitivity = new Array<number>(nodes.length).fill(0);
    for (let i = 0; i < nodes.length - 1; i += 1) {
      const lower = nodes[i];
      const upper = nodes[i + 1];
      const segmentEndM = Math.min(upper.heightM, point.heightM);
      if (segmentEndM <= lower.heightM) continue;

      const segmentWidthM = upper.heightM - lower.heightM;
      const halfWidthM = (segmentEndM - lower.heightM) / 2;
      const midpointM = (segmentEndM + lower.heightM) / 2;
      for (let q = 0; q < GAUSS_LEGENDRE_5_NODES.length; q += 1) {
        const z = midpointM + halfWidthM * GAUSS_LEGENDRE_5_NODES[q];
        const fraction = (z - lower.heightM) / segmentWidthM;
        const temperatureK =
          lower.temperatureK * (1 - fraction) + upper.temperatureK * fraction;
        const gravityMs2 = completed.gravitationMode === 'constant-gravity'
          ? constantGravityMs2
          : (G * bodyMassKg) / ((bodyRadiusM + z) * (bodyRadiusM + z));
        const integrand = halfWidthM * GAUSS_LEGENDRE_5_WEIGHTS[q] *
          gravityMs2 * meanMolarMassKgPerMol /
          (gasConstant * temperatureK * temperatureK);
        logPressureSensitivity[i] += integrand * (1 - fraction);
        logPressureSensitivity[i + 1] += integrand * fraction;
      }
      if (point.heightM <= upper.heightM) break;
    }

    const boundaryLogPressureSensitivity = pressureSigmaPa / pressurePa;
    let pressureRelativeVariance =
      boundaryLogPressureSensitivity * boundaryLogPressureSensitivity;
    let densityRelativeVariance = pressureRelativeVariance;
    for (let i = 0; i < nodes.length; i += 1) {
      const sigmaSquared = uncertainty.temperatureNodeSigmaK[i] ** 2;
      const pressureSensitivity = logPressureSensitivity[i];
      pressureRelativeVariance += pressureSensitivity * pressureSensitivity * sigmaSquared;
      const localWeight =
        i === local.lowerNode ? 1 - local.upperWeight :
        i === local.lowerNode + 1 ? local.upperWeight : 0;
      const densitySensitivity = pressureSensitivity - localWeight / local.temperatureK;
      densityRelativeVariance += densitySensitivity * densitySensitivity * sigmaSquared;
    }

    const pressureRelativeSigma = Math.sqrt(pressureRelativeVariance);
    const densityRelativeSigma = Math.sqrt(densityRelativeVariance);
    const pressureSigmaAtPointPa = point.pressurePa * pressureRelativeSigma;
    const densitySigmaAtPoint = point.densityKgPerM3 * densityRelativeSigma;

    points.push({
      heightM: point.heightM,
      temperatureSigmaK: local.sigmaK,
      pressureSigmaPa: pressureSigmaAtPointPa,
      pressureRelativeSigma,
      densitySigmaKgPerM3: densitySigmaAtPoint,
      densityRelativeSigma,
      pressureLowerOneSigmaPa: Math.max(0, point.pressurePa - pressureSigmaAtPointPa),
      pressureUpperOneSigmaPa: point.pressurePa + pressureSigmaAtPointPa,
      densityLowerOneSigmaKgPerM3: Math.max(0, point.densityKgPerM3 - densitySigmaAtPoint),
      densityUpperOneSigmaKgPerM3: point.densityKgPerM3 + densitySigmaAtPoint
    });
  }

  const provenance: DataProvenance = {
    sourceName: 'First-order propagation of measured atmospheric profile uncertainties',
    method:
      'Linearized hydrostatic sensitivities integrated with 5-point Gauss-Legendre quadrature over piecewise-linear measured temperature nodes; pressure and density use first-order standard-error propagation',
    applicability: 'Single measuredNodes layer with fixed body mass, radius and composition; original or adaptively subdivided hydrostatic result',
    limitations:
      'Diagonal covariance approximation: pressure-boundary and temperature-node one-sigma errors are treated as mutually independent because their covariance matrix is unavailable. Density includes the local temperature contribution and its covariance with pressure through the shared temperature nodes. Nonlinear higher-order effects, composition, gravity-field, radius, mass, column-integral and kinetic-rate uncertainties are not propagated.',
    note: 'Output intervals are linearized ±1σ estimates, not guaranteed physical bounds or a confidence interval with asserted coverage probability.'
  };

  return {
    status: 'estimated',
    method: 'first_order_linearized_diagonal_covariance',
    uncertaintyLevel: 'one_sigma',
    covarianceAssumption:
      'Pressure-boundary error and every temperature-node error are treated as independent, zero-mean inputs; temperature errors between measured nodes use the same diagonal covariance assumption.',
    conditionalOn: [
      'body mass and reference radius fixed',
      'atmospheric composition and mean molar mass fixed',
      'gravity model fixed to the selected hydrostatic solver mode',
      'piecewise-linear interpolation between measured temperature nodes'
    ],
    limitations: [
      'No published cross-node or pressure-temperature covariance matrix is supplied to this propagation step.',
      'Uncertainty of integrated mass and molar column inventories is not propagated.',
      'No uncertainty is assigned to body mass, local radius, gravity harmonics, composition or ideal-gas EOS applicability.',
      'First-order linearization is not a nonlinear ensemble and does not provide guaranteed bounds.'
    ],
    points,
    provenance
  };
}
