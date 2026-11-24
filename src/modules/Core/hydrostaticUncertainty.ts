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
// It does not propagate uncertainty to composition, gravity coefficients,
// or kinetic rates.

import type { DataProvenance } from './scientificValue';
import type {
  HydrostaticColumnCompleted,
  HydrostaticColumnInput,
  HydrostaticProfilePoint
} from './hydrostaticAtmosphere';
import { G } from '../Units';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from './thermoFunctions';

export interface HydrostaticPhysicalParameterUncertainty {
  /** Optional one-sigma uncertainty of body mass, kg. */
  readonly bodyMassSigmaKg?: number;
  /** Optional one-sigma uncertainty of reference radius, m. */
  readonly referenceRadiusSigmaM?: number;
  /** Optional one-sigma uncertainty of mixture mean molar mass, kg/mol. */
  readonly meanMolarMassSigmaKgPerMol?: number;
  /** Explicit approximation; correlations are never inferred. */
  readonly covariance: 'independent_diagonal';
  /** Source/method for the supplied uncertainty parameters. */
  readonly provenance: DataProvenance;
}

export interface MeasuredNodeUncertaintyInput {
  /** One-standard-deviation uncertainty of the pressure boundary, Pa. */
  readonly surfacePressureSigmaPa: number;
  /** One-standard-deviation temperature uncertainty for every measured node, K. */
  readonly temperatureNodeSigmaK: readonly number[];
  /** Optional sourced uncertainties of physical column parameters. */
  readonly physicalParameters?: HydrostaticPhysicalParameterUncertainty;
}

export interface HydrostaticPointUncertainty {
  readonly heightM: number;
  readonly temperatureSigmaK: number;
  readonly pressureSigmaPa: number;
  readonly pressureRelativeSigma: number;
  readonly densitySigmaKgPerM3: number;
  readonly densityRelativeSigma: number;
  /** First-order one-sigma uncertainty of integrated mass column, kg/m². */
  readonly columnMassSigmaKgPerM2: number;
  /** null at the zero-thickness lower boundary, where the relative error is undefined. */
  readonly columnMassRelativeSigma: number | null;
  /** First-order one-sigma uncertainty of integrated molar column, mol/m². */
  readonly columnMolesSigmaPerM2: number;
  /** null at the zero-thickness lower boundary, where the relative error is undefined. */
  readonly columnMolesRelativeSigma: number | null;
  readonly pressureLowerOneSigmaPa: number;
  readonly pressureUpperOneSigmaPa: number;
  readonly densityLowerOneSigmaKgPerM3: number;
  readonly densityUpperOneSigmaKgPerM3: number;
  readonly columnMassLowerOneSigmaKgPerM2: number;
  readonly columnMassUpperOneSigmaKgPerM2: number;
  readonly columnMolesLowerOneSigmaPerM2: number;
  readonly columnMolesUpperOneSigmaPerM2: number;
}

export interface HydrostaticUncertaintyEstimate {
  readonly status: 'estimated';
  readonly method: 'first_order_linearized_diagonal_covariance';
  readonly uncertaintyLevel: 'one_sigma';
  readonly covarianceAssumption: string;
  readonly conditionalOn: readonly string[];
  readonly limitations: readonly string[];
  /** Maximum |quadrature column mass - Core inventory| / max(1, |Core inventory|). */
  readonly columnIntegralConsistencyMaxRelativeDeviation: number;
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
  if (!Array.isArray(input.layers) || input.layers.length !== 1) {
    errors.push('поддерживается ровно один исходный measuredNodes слой; многослойная ковариация пока не реализована');
  }
  if (!Array.isArray(uncertainty.temperatureNodeSigmaK)) {
    return invalid('temperatureNodeSigmaK: требуется массив стандартных отклонений');
  }
  const sourceLayer = Array.isArray(input.layers) ? input.layers[0] : undefined;
  if (sourceLayer?.temperature?.kind !== 'measuredNodes') {
    errors.push('температурная модель должна быть measuredNodes с линейной интерполяцией');
  }
  const nodes: readonly { readonly heightM: number; readonly temperatureK: number }[] =
    sourceLayer?.temperature.kind === 'measuredNodes'
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
  const physicalParameters = uncertainty.physicalParameters;
  if (physicalParameters !== undefined) {
    const suppliedSigmas = [
      physicalParameters.bodyMassSigmaKg,
      physicalParameters.referenceRadiusSigmaM,
      physicalParameters.meanMolarMassSigmaKgPerMol
    ];
    if (suppliedSigmas.every((value) => value === undefined)) {
      errors.push('physicalParameters: требуется хотя бы одна явно заданная стандартная неопределённость');
    }
    if (physicalParameters.covariance !== 'independent_diagonal') {
      errors.push('physicalParameters.covariance: требуется явное independent_diagonal');
    }
    const source = physicalParameters.provenance;
    const hasSourceIdentity =
      (typeof source?.sourceName === 'string' && source.sourceName.trim().length > 0) ||
      (typeof source?.sourceId === 'string' && source.sourceId.trim().length > 0) ||
      (typeof source?.datasetId === 'string' && source.datasetId.trim().length > 0) ||
      (typeof source?.reference === 'string' && source.reference.trim().length > 0);
    if (!hasSourceIdentity) {
      errors.push('physicalParameters.provenance: требуется sourceName, sourceId, datasetId или reference');
    }
    const checkSigma = (value: number | undefined, name: string): void => {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        errors.push(name + ': требуется конечное неотрицательное значение');
      }
    };
    checkSigma(physicalParameters.bodyMassSigmaKg, 'physicalParameters.bodyMassSigmaKg');
    checkSigma(physicalParameters.referenceRadiusSigmaM, 'physicalParameters.referenceRadiusSigmaM');
    checkSigma(
      physicalParameters.meanMolarMassSigmaKgPerMol,
      'physicalParameters.meanMolarMassSigmaKgPerMol'
    );
    if (
      physicalParameters.bodyMassSigmaKg !== undefined &&
      Number.isFinite(input.body?.bodyMassKg) &&
      physicalParameters.bodyMassSigmaKg >= input.body.bodyMassKg
    ) {
      errors.push('physicalParameters.bodyMassSigmaKg: lower one-sigma mass bound must remain positive');
    }
    if (
      physicalParameters.referenceRadiusSigmaM !== undefined &&
      Number.isFinite(input.body?.referenceRadiusM) &&
      physicalParameters.referenceRadiusSigmaM >= input.body.referenceRadiusM
    ) {
      errors.push('physicalParameters.referenceRadiusSigmaM: lower one-sigma radius bound must remain positive');
    }
  }
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
  if (
    physicalParameters?.meanMolarMassSigmaKgPerMol !== undefined &&
    physicalParameters.meanMolarMassSigmaKgPerMol >= meanMolarMassKgPerMol
  ) {
    return invalid('physicalParameters.meanMolarMassSigmaKgPerMol: lower one-sigma molar-mass bound must remain positive');
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

  // Reconstruct the continuous hydrostatic solution on a union mesh made
  // from every source-temperature node and every solver output height.
  // This gives a quadrature path for d(Sigma)/d(T_j) without interpolating
  // the integrated inventory or treating intermediate PDS pressures as
  // independent boundary conditions.
  interface PartialSensitivityIntegral {
    readonly pressureExponent: number;
    readonly lowerTemperatureSensitivity: number;
    readonly upperTemperatureSensitivity: number;
    readonly referenceRadiusSensitivity: number;
  }
  interface IntegratedSensitivityState {
    readonly pressureTemperatureSensitivities: readonly number[];
    readonly columnMassTemperatureSensitivities: readonly number[];
    readonly pressureReferenceRadiusSensitivity: number;
    readonly columnMassBodyMassSensitivity: number;
    readonly columnMassReferenceRadiusSensitivity: number;
    readonly columnMassMeanMolarMassSensitivity: number;
    readonly reconstructedColumnMassKgPerM2: number;
    readonly reconstructedPressurePa: number;
  }

  const outputPointByHeight = new Map(orderedPoints.map((point) => [point.heightM, point]));
  const integrationHeights = Array.from(new Set([
    ...nodes.map((node) => node.heightM),
    ...orderedPoints.map((point) => point.heightM)
  ])).sort((a, b) => a - b);
  if (
    integrationHeights.length < 2 ||
    Math.abs(integrationHeights[0] - firstNode.heightM) > 1e-6 ||
    Math.abs(integrationHeights[integrationHeights.length - 1] - lastNode.heightM) > 1e-6
  ) {
    return invalid('не удалось построить общий интеграционный mesh по исходным узлам и точкам Core');
  }

  const integratedSensitivityByHeight = new Map<number, IntegratedSensitivityState>();
  const pressureTemperatureSensitivities = new Array<number>(nodes.length).fill(0);
  const columnMassTemperatureSensitivities = new Array<number>(nodes.length).fill(0);
  let pressureReferenceRadiusSensitivity = 0;
  let columnMassBodyMassSensitivity = 0;
  let columnMassReferenceRadiusSensitivity = 0;
  let columnMassMeanMolarMassSensitivity = 0;
  let reconstructedColumnMassKgPerM2 = 0;
  let logPressureAtCurrentHeight = Math.log(pressurePa);
  let sourceSegmentIndex = 0;

  const gravityAt = (heightM: number): number =>
    completed.gravitationMode === 'constant-gravity'
      ? constantGravityMs2
      : (G * bodyMassKg) / ((bodyRadiusM + heightM) * (bodyRadiusM + heightM));

  integratedSensitivityByHeight.set(integrationHeights[0], {
    pressureTemperatureSensitivities: [...pressureTemperatureSensitivities],
    columnMassTemperatureSensitivities: [...columnMassTemperatureSensitivities],
    pressureReferenceRadiusSensitivity: 0,
    columnMassBodyMassSensitivity: 0,
    columnMassReferenceRadiusSensitivity: 0,
    columnMassMeanMolarMassSensitivity: 0,
    reconstructedColumnMassKgPerM2: 0,
    reconstructedPressurePa: pressurePa
  });

  for (let intervalIndex = 1; intervalIndex < integrationHeights.length; intervalIndex += 1) {
    const intervalBottomM = integrationHeights[intervalIndex - 1];
    const intervalTopM = integrationHeights[intervalIndex];
    if (!(intervalTopM > intervalBottomM)) continue;

    while (
      sourceSegmentIndex < nodes.length - 2 &&
      intervalBottomM >= nodes[sourceSegmentIndex + 1].heightM
    ) {
      sourceSegmentIndex += 1;
    }
    const lowerNode = nodes[sourceSegmentIndex];
    const upperNode = nodes[sourceSegmentIndex + 1];
    if (
      intervalBottomM < lowerNode.heightM - 1e-6 ||
      intervalTopM > upperNode.heightM + 1e-6
    ) {
      return invalid(
        'интеграционный интервал [' + intervalBottomM + ', ' + intervalTopM +
        '] не принадлежит одному исходному температурному сегменту'
      );
    }

    const sourceSegmentWidthM = upperNode.heightM - lowerNode.heightM;
    const integratePartial = (endHeightM: number): PartialSensitivityIntegral => {
      const halfWidthM = (endHeightM - intervalBottomM) / 2;
      const midpointM = (endHeightM + intervalBottomM) / 2;
      let pressureExponent = 0;
      let lowerTemperatureSensitivity = 0;
      let upperTemperatureSensitivity = 0;
      let referenceRadiusSensitivity = 0;

      for (let q = 0; q < GAUSS_LEGENDRE_5_NODES.length; q += 1) {
        const z = midpointM + halfWidthM * GAUSS_LEGENDRE_5_NODES[q];
        const fraction = (z - lowerNode.heightM) / sourceSegmentWidthM;
        const temperatureK =
          lowerNode.temperatureK * (1 - fraction) + upperNode.temperatureK * fraction;
        const gravityMs2 = gravityAt(z);
        const weightedBase = halfWidthM * GAUSS_LEGENDRE_5_WEIGHTS[q] *
          gravityMs2 * meanMolarMassKgPerMol /
          (gasConstant * temperatureK);
        const weightedTemperatureSensitivity = weightedBase / temperatureK;
        const radiusDenominator = bodyRadiusM + (
          completed.gravitationMode === 'constant-gravity' ? bottomHeightM : z
        );

        pressureExponent += weightedBase;
        lowerTemperatureSensitivity += weightedTemperatureSensitivity * (1 - fraction);
        upperTemperatureSensitivity += weightedTemperatureSensitivity * fraction;
        referenceRadiusSensitivity += 2 * weightedBase / radiusDenominator;
      }

      return {
        pressureExponent,
        lowerTemperatureSensitivity,
        upperTemperatureSensitivity,
        referenceRadiusSensitivity
      };
    };

    const fullIntervalIntegral = integratePartial(intervalTopM);
    const intervalMassSensitivity = new Array<number>(nodes.length).fill(0);
    let intervalMassBodyMassSensitivity = 0;
    let intervalMassReferenceRadiusSensitivity = 0;
    let intervalMassMeanMolarMassSensitivity = 0;
    let intervalMassKgPerM2 = 0;
    const outerHalfWidthM = (intervalTopM - intervalBottomM) / 2;
    const outerMidpointM = (intervalTopM + intervalBottomM) / 2;

    for (let q = 0; q < GAUSS_LEGENDRE_5_NODES.length; q += 1) {
      const z = outerMidpointM + outerHalfWidthM * GAUSS_LEGENDRE_5_NODES[q];
      const outerWeightM = outerHalfWidthM * GAUSS_LEGENDRE_5_WEIGHTS[q];
      const fraction = (z - lowerNode.heightM) / sourceSegmentWidthM;
      const temperatureK =
        lowerNode.temperatureK * (1 - fraction) + upperNode.temperatureK * fraction;
      const partial = integratePartial(z);
      const logPressureAtQuadrature = logPressureAtCurrentHeight - partial.pressureExponent;
      const pressureAtQuadraturePa = Math.exp(logPressureAtQuadrature);
      const densityAtQuadratureKgPerM3 =
        pressureAtQuadraturePa * meanMolarMassKgPerMol /
        (gasConstant * temperatureK);
      const pressureExponentAtQuadrature =
        Math.log(pressurePa) - logPressureAtQuadrature;
      const pressureBodyMassSensitivity =
        -pressureExponentAtQuadrature / bodyMassKg;
      const pressureMeanMolarMassSensitivity =
        -pressureExponentAtQuadrature / meanMolarMassKgPerMol;
      const pressureRadiusSensitivity =
        pressureReferenceRadiusSensitivity + partial.referenceRadiusSensitivity;
      const densityMeanMolarMassSensitivity =
        pressureMeanMolarMassSensitivity + 1 / meanMolarMassKgPerMol;

      if (
        !Number.isFinite(pressureAtQuadraturePa) ||
        pressureAtQuadraturePa <= 0 ||
        !Number.isFinite(densityAtQuadratureKgPerM3) ||
        densityAtQuadratureKgPerM3 <= 0
      ) {
        return invalid('квадратура интегральной чувствительности дала неконечные P или rho');
      }

      intervalMassKgPerM2 += outerWeightM * densityAtQuadratureKgPerM3;
      intervalMassBodyMassSensitivity +=
        outerWeightM * densityAtQuadratureKgPerM3 * pressureBodyMassSensitivity;
      intervalMassReferenceRadiusSensitivity +=
        outerWeightM * densityAtQuadratureKgPerM3 * pressureRadiusSensitivity;
      intervalMassMeanMolarMassSensitivity +=
        outerWeightM * densityAtQuadratureKgPerM3 * densityMeanMolarMassSensitivity;
      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        const partialPressureSensitivity =
          nodeIndex === sourceSegmentIndex
            ? partial.lowerTemperatureSensitivity
            : nodeIndex === sourceSegmentIndex + 1
              ? partial.upperTemperatureSensitivity
              : 0;
        const pressureSensitivity =
          pressureTemperatureSensitivities[nodeIndex] + partialPressureSensitivity;
        const localTemperatureWeight =
          nodeIndex === sourceSegmentIndex
            ? 1 - fraction
            : nodeIndex === sourceSegmentIndex + 1
              ? fraction
              : 0;
        const logDensitySensitivity =
          pressureSensitivity - localTemperatureWeight / temperatureK;
        intervalMassSensitivity[nodeIndex] +=
          outerWeightM * densityAtQuadratureKgPerM3 * logDensitySensitivity;
      }
    }

    reconstructedColumnMassKgPerM2 += intervalMassKgPerM2;
    logPressureAtCurrentHeight -= fullIntervalIntegral.pressureExponent;
    pressureTemperatureSensitivities[sourceSegmentIndex] +=
      fullIntervalIntegral.lowerTemperatureSensitivity;
    pressureTemperatureSensitivities[sourceSegmentIndex + 1] +=
      fullIntervalIntegral.upperTemperatureSensitivity;
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      columnMassTemperatureSensitivities[nodeIndex] += intervalMassSensitivity[nodeIndex];
    }
    columnMassBodyMassSensitivity += intervalMassBodyMassSensitivity;
    columnMassReferenceRadiusSensitivity += intervalMassReferenceRadiusSensitivity;
    columnMassMeanMolarMassSensitivity += intervalMassMeanMolarMassSensitivity;
    pressureReferenceRadiusSensitivity += fullIntervalIntegral.referenceRadiusSensitivity;

    const outputPoint = outputPointByHeight.get(intervalTopM);
    if (outputPoint !== undefined) {
      const reconstructedPressurePa = Math.exp(logPressureAtCurrentHeight);
      if (!Number.isFinite(reconstructedPressurePa) || reconstructedPressurePa <= 0) {
        return invalid('восстановленное давление на высоте ' + intervalTopM + ' м некорректно');
      }

      const pressureRelativeMismatch =
        Math.abs(reconstructedPressurePa - outputPoint.pressurePa) / outputPoint.pressurePa;
      if (pressureRelativeMismatch > 5e-5) {
        return invalid(
          'квадратура гидростатического давления не согласуется с Core на высоте ' +
          intervalTopM + ' м (относительное расхождение ' + pressureRelativeMismatch + ')'
        );
      }

      const massAbsoluteMismatch = Math.abs(
        reconstructedColumnMassKgPerM2 - outputPoint.columnMassKgPerM2
      );
      const massConsistencyScale = Math.max(1, Math.abs(outputPoint.columnMassKgPerM2));
      if (massAbsoluteMismatch > Math.max(1e-6, massConsistencyScale * 5e-5)) {
        return invalid(
          'квадратура массового столба не согласуется с Core на высоте ' +
          intervalTopM + ' м (абсолютное расхождение ' + massAbsoluteMismatch + ' кг/м²)'
        );
      }

      integratedSensitivityByHeight.set(intervalTopM, {
        pressureTemperatureSensitivities: [...pressureTemperatureSensitivities],
        columnMassTemperatureSensitivities: [...columnMassTemperatureSensitivities],
        pressureReferenceRadiusSensitivity,
        columnMassBodyMassSensitivity,
        columnMassReferenceRadiusSensitivity,
        columnMassMeanMolarMassSensitivity,
        reconstructedColumnMassKgPerM2,
        reconstructedPressurePa
      });
    }
  }

  const points: HydrostaticPointUncertainty[] = [];
  let columnIntegralConsistencyMaxRelativeDeviation = 0;
  for (const point of orderedPoints) {
    const local = interpolateTemperatureSigma(nodes, uncertainty.temperatureNodeSigmaK, point.heightM);
    if (local === null) {
      return invalid('профиль результата содержит высоту вне measuredNodes: ' + point.heightM + ' м');
    }
    const integrated = integratedSensitivityByHeight.get(point.heightM);
    if (integrated === undefined) {
      return invalid('нет интегрированной чувствительности для высоты ' + point.heightM + ' м');
    }

    const massMismatch = Math.abs(
      integrated.reconstructedColumnMassKgPerM2 - point.columnMassKgPerM2
    );
    columnIntegralConsistencyMaxRelativeDeviation = Math.max(
      columnIntegralConsistencyMaxRelativeDeviation,
      massMismatch / Math.max(1, Math.abs(point.columnMassKgPerM2))
    );

    const boundaryLogPressureSensitivity = pressureSigmaPa / pressurePa;
    let pressureRelativeVariance =
      boundaryLogPressureSensitivity * boundaryLogPressureSensitivity;
    let densityRelativeVariance = pressureRelativeVariance;
    let columnMassVariance =
      (point.columnMassKgPerM2 / pressurePa * pressureSigmaPa) ** 2;
    let columnMolesVariance =
      (point.columnMolesPerM2 / pressurePa * pressureSigmaPa) ** 2;

    for (let i = 0; i < nodes.length; i += 1) {
      const sigmaSquared = uncertainty.temperatureNodeSigmaK[i] ** 2;
      const pressureSensitivity = integrated.pressureTemperatureSensitivities[i];
      pressureRelativeVariance += pressureSensitivity * pressureSensitivity * sigmaSquared;
      const localWeight =
        i === local.lowerNode ? 1 - local.upperWeight :
        i === local.lowerNode + 1 ? local.upperWeight : 0;
      const densitySensitivity = pressureSensitivity - localWeight / local.temperatureK;
      densityRelativeVariance += densitySensitivity * densitySensitivity * sigmaSquared;
      const columnMassSensitivity = integrated.columnMassTemperatureSensitivities[i];
      columnMassVariance += columnMassSensitivity * columnMassSensitivity * sigmaSquared;
      const columnMolesTemperatureSensitivity =
        columnMassSensitivity / meanMolarMassKgPerMol;
      columnMolesVariance +=
        columnMolesTemperatureSensitivity * columnMolesTemperatureSensitivity * sigmaSquared;
    }

    if (physicalParameters !== undefined) {
      const massSigmaKg = physicalParameters.bodyMassSigmaKg ?? 0;
      const radiusSigmaM = physicalParameters.referenceRadiusSigmaM ?? 0;
      const molarMassSigmaKgPerMol =
        physicalParameters.meanMolarMassSigmaKgPerMol ?? 0;
      const pressureExponentAtPoint = Math.log(pressurePa / point.pressurePa);
      const pressureBodyMassSensitivity = -pressureExponentAtPoint / bodyMassKg;
      const pressureMeanMolarMassSensitivity =
        -pressureExponentAtPoint / meanMolarMassKgPerMol;
      const pressureRadiusSensitivity =
        integrated.pressureReferenceRadiusSensitivity;
      const massVarianceContribution =
        (pressureBodyMassSensitivity * massSigmaKg) ** 2;
      const radiusVarianceContribution =
        (pressureRadiusSensitivity * radiusSigmaM) ** 2;
      const molarMassPressureVarianceContribution =
        (pressureMeanMolarMassSensitivity * molarMassSigmaKgPerMol) ** 2;

      pressureRelativeVariance +=
        massVarianceContribution +
        radiusVarianceContribution +
        molarMassPressureVarianceContribution;
      densityRelativeVariance +=
        massVarianceContribution +
        radiusVarianceContribution +
        ((pressureMeanMolarMassSensitivity + 1 / meanMolarMassKgPerMol) *
          molarMassSigmaKgPerMol) ** 2;

      columnMassVariance +=
        (integrated.columnMassBodyMassSensitivity * massSigmaKg) ** 2 +
        (integrated.columnMassReferenceRadiusSensitivity * radiusSigmaM) ** 2 +
        (integrated.columnMassMeanMolarMassSensitivity * molarMassSigmaKgPerMol) ** 2;

      const columnMolesBodyMassSensitivity =
        integrated.columnMassBodyMassSensitivity / meanMolarMassKgPerMol;
      const columnMolesReferenceRadiusSensitivity =
        integrated.columnMassReferenceRadiusSensitivity / meanMolarMassKgPerMol;
      const columnMolesMeanMolarMassSensitivity =
        integrated.columnMassMeanMolarMassSensitivity / meanMolarMassKgPerMol -
        point.columnMassKgPerM2 / (meanMolarMassKgPerMol * meanMolarMassKgPerMol);
      columnMolesVariance +=
        (columnMolesBodyMassSensitivity * massSigmaKg) ** 2 +
        (columnMolesReferenceRadiusSensitivity * radiusSigmaM) ** 2 +
        (columnMolesMeanMolarMassSensitivity * molarMassSigmaKgPerMol) ** 2;
    }

    const pressureRelativeSigma = Math.sqrt(pressureRelativeVariance);
    const densityRelativeSigma = Math.sqrt(densityRelativeVariance);
    const columnMassSigmaKgPerM2 = Math.sqrt(columnMassVariance);
    const pressureSigmaAtPointPa = point.pressurePa * pressureRelativeSigma;
    const densitySigmaAtPoint = point.densityKgPerM3 * densityRelativeSigma;
    const columnMassRelativeSigma = point.columnMassKgPerM2 > 0
      ? columnMassSigmaKgPerM2 / point.columnMassKgPerM2
      : null;

    // Nmol(z) = Sigma(z) / Mbar. When Mbar uncertainty is supplied,
    // its denominator sensitivity is propagated separately above.
    const columnMolesSigmaPerM2 = Math.sqrt(columnMolesVariance);
    const columnMolesRelativeSigma = point.columnMolesPerM2 > 0
      ? columnMolesSigmaPerM2 / point.columnMolesPerM2
      : null;

    points.push({
      heightM: point.heightM,
      temperatureSigmaK: local.sigmaK,
      pressureSigmaPa: pressureSigmaAtPointPa,
      pressureRelativeSigma,
      densitySigmaKgPerM3: densitySigmaAtPoint,
      densityRelativeSigma,
      columnMassSigmaKgPerM2,
      columnMassRelativeSigma,
      columnMolesSigmaPerM2,
      columnMolesRelativeSigma,
      pressureLowerOneSigmaPa: Math.max(0, point.pressurePa - pressureSigmaAtPointPa),
      pressureUpperOneSigmaPa: point.pressurePa + pressureSigmaAtPointPa,
      densityLowerOneSigmaKgPerM3: Math.max(0, point.densityKgPerM3 - densitySigmaAtPoint),
      densityUpperOneSigmaKgPerM3: point.densityKgPerM3 + densitySigmaAtPoint,
      columnMassLowerOneSigmaKgPerM2: Math.max(
        0,
        point.columnMassKgPerM2 - columnMassSigmaKgPerM2
      ),
      columnMassUpperOneSigmaKgPerM2:
        point.columnMassKgPerM2 + columnMassSigmaKgPerM2,
      columnMolesLowerOneSigmaPerM2: Math.max(
        0,
        point.columnMolesPerM2 - columnMolesSigmaPerM2
      ),
      columnMolesUpperOneSigmaPerM2:
        point.columnMolesPerM2 + columnMolesSigmaPerM2
    });
  }

  const suppliedPhysicalParameters = [
    physicalParameters?.bodyMassSigmaKg !== undefined ? 'body mass' : null,
    physicalParameters?.referenceRadiusSigmaM !== undefined ? 'reference radius' : null,
    physicalParameters?.meanMolarMassSigmaKgPerMol !== undefined ? 'mean molar mass' : null
  ].filter((value): value is string => value !== null);
  const fixedPhysicalParameters = [
    physicalParameters?.bodyMassSigmaKg === undefined ? 'body mass' : null,
    physicalParameters?.referenceRadiusSigmaM === undefined ? 'reference radius' : null,
    physicalParameters?.meanMolarMassSigmaKgPerMol === undefined ? 'mean molar mass/composition' : null
  ].filter((value): value is string => value !== null);
  const provenance: DataProvenance = {
    sourceName: 'First-order propagation of measured atmospheric profile uncertainties',
    method:
      'First-order hydrostatic sensitivities and integrated mass/molar-column sensitivities evaluated with nested 5-point Gauss-Legendre quadrature over the piecewise-linear measured temperature profile; optional body mass, radius and mean-molar-mass derivatives are included only when explicitly supplied',
    applicability: 'Single measuredNodes layer; original or adaptively subdivided hydrostatic result',
    rawInput: {
      physicalParameterCovariance: physicalParameters?.covariance ?? 'not_supplied',
      bodyMassSigmaKg: physicalParameters?.bodyMassSigmaKg ?? null,
      referenceRadiusSigmaM: physicalParameters?.referenceRadiusSigmaM ?? null,
      meanMolarMassSigmaKgPerMol: physicalParameters?.meanMolarMassSigmaKgPerMol ?? null
    },
    limitations:
      'Pressure-boundary and temperature-node errors are treated as mutually independent because their covariance matrix is unavailable. Optional physical-parameter errors use the caller-declared independent_diagonal approximation; correlations between mass, radius, composition, pressure and temperature are not inferred. Omitted parameter sigmas remain fixed/unknown, not known to be exact. Gravity harmonics, EOS model discrepancy and kinetic-rate uncertainty are not propagated.',
    note: 'Output intervals are linearized ±1σ estimates, not guaranteed physical bounds or a confidence interval with asserted coverage probability.'
  };

  return {
    status: 'estimated',
    method: 'first_order_linearized_diagonal_covariance',
    uncertaintyLevel: 'one_sigma',
    covarianceAssumption:
      'Pressure-boundary and measured-temperature-node errors are treated as independent, zero-mean inputs. If physicalParameters is supplied, its body mass, reference radius and mean molar mass errors are additionally treated as independent diagonal inputs; no correlations are inferred.',
    conditionalOn: [
      ...fixedPhysicalParameters.map((name) => name + ' held fixed because no explicit sigma was supplied'),
      suppliedPhysicalParameters.length > 0
        ? 'explicit one-sigma uncertainties included for ' + suppliedPhysicalParameters.join(', ')
        : 'body mass, reference radius and mean molar mass held fixed',
      'gravity model fixed to the selected hydrostatic solver mode',
      'piecewise-linear interpolation between measured temperature nodes',
      'single layer with fixed composition and mean molar mass parameter'
    ],
    limitations: [
      'No published cross-node or pressure-temperature covariance matrix is supplied to this propagation step.',
      'Integrated mass and molar column inventories are propagated by differentiating rho(z) and integrating their first-order sensitivities over height.',
      'Optional mass/radius/mean-molar-mass errors assume independent diagonal covariance; multi-layer composition covariance is not supported.',
      'Gravity harmonics, EOS model discrepancy and kinetic-rate uncertainty are not propagated.',
      'First-order linearization is not a nonlinear ensemble and does not provide guaranteed bounds.'
    ],
    columnIntegralConsistencyMaxRelativeDeviation,
    points,
    provenance
  };
}
