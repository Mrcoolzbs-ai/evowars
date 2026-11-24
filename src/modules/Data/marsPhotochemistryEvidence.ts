import type { DataProvenance } from '../Core/scientificValue';

// ============================================
// MARS PHOTOLYSIS EVIDENCE — Taysum & Palmer (2020), Table B2
// ============================================
//
// These are published *model look-up values*, not measurements or
// universal photolysis constants. The table is explicitly for SZA=0°
// and Ls=251° (perihelion), at exactly two tabulated altitudes.
// The underlying TUV/Mars look-up also depends on temperature, O3 and
// total columns, Sun-Mars distance and optical/dust opacity. Those
// dependencies are not reconstructible from the compact table; no
// interpolation, extrapolation, Scheduler injection or uncertainty
// quantification is performed here.

export type MarsPhotolysisSpeciesId =
  | 'o2' | 'o' | 'o1d' | 'co2' | 'co' | 'o3'
  | 'h2o' | 'h' | 'oh' | 'h2o2' | 'ho2';

export interface MarsPhotolysisStoichiometricTerm {
  readonly speciesId: MarsPhotolysisSpeciesId;
  readonly coefficient: number;
}

export interface MarsPhotolysisReferenceNode {
  /** Exact source table altitude, km. No implicit interpolation is supported. */
  readonly altitudeKm: 0.5 | 42.67;
  /** Published photolysis frequency J, s^-1. */
  readonly photolysisFrequencyPerS: number;
}

export interface MarsPhotolysisChannel {
  readonly id: string;
  readonly label: string;
  readonly reactant: MarsPhotolysisSpeciesId;
  readonly products: readonly MarsPhotolysisStoichiometricTerm[];
  readonly referenceNodes: readonly MarsPhotolysisReferenceNode[];
  readonly sourceTable: 'Taysum2020TableB2';
}

export const MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE: DataProvenance = {
  sourceName: 'Taysum & Palmer (2020), Photochemistry of Methane and Ethane in the Martian Atmosphere',
  sourceId: 'DOI:10.1029/2020JE006491',
  datasetId: 'Taysum2020-Table-B2',
  reference: 'https://doi.org/10.1029/2020JE006491',
  retrievedAt: '2026-11-24',
  method: 'Published photolysis frequencies interpolated from an offline look-up table constructed with a Mars-adapted TUV radiation model',
  modelVersion: 'Mars-adapted TUV look-up table as described by Taysum & Palmer (2020)',
  applicability: 'The table values are for solar zenith angle 0 degrees and solar longitude Ls=251 degrees (perihelion), at the exact tabulated altitudes 0.50 km and 42.67 km.',
  conditions: 'The underlying look-up table also varies with atmospheric temperature, O3 column abundance, total atmospheric column abundance, Sun-Mars distance and optical opacity/dust loading. Only the table reference scenario is retained here.',
  limitations: 'Model-derived lookup values, not observations or universally applicable J constants. The paper does not report a 1-sigma uncertainty for these tabulated frequencies. The compact table cannot reconstruct the full radiation field or its dependencies; no interpolation/extrapolation is provided. No automatic Scheduler use.',
  note: 'The paper describes 10 inorganic photolysis reactions in the text, while the accessible Table B2 lists the nine channels stored here. This module preserves the nine tabulated rows only and does not claim to be the complete 1-D photochemical mechanism.'
};

const nodePair = (
  lower: number,
  upper: number
): readonly MarsPhotolysisReferenceNode[] => [
  { altitudeKm: 0.5, photolysisFrequencyPerS: lower },
  { altitudeKm: 42.67, photolysisFrequencyPerS: upper }
];

/** Nine channels and values transcribed from Table B2 without filling omitted rows. */
export const MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS: readonly MarsPhotolysisChannel[] = [
  {
    id: 'o2_photolysis_to_o',
    label: 'O2 + hν → O + O',
    reactant: 'o2',
    products: [{ speciesId: 'o', coefficient: 2 }],
    referenceNodes: nodePair(2.95e-10, 5.16e-9),
    sourceTable: 'Taysum2020TableB2'
  },
  {
    id: 'o2_photolysis_to_o1d',
    label: 'O2 + hν → O + O(1D)',
    reactant: 'o2',
    products: [
      { speciesId: 'o', coefficient: 1 },
      { speciesId: 'o1d', coefficient: 1 }
    ],
    referenceNodes: nodePair(0, 0),
    sourceTable: 'Taysum2020TableB2'
  },
  {
    id: 'co2_photolysis_to_co_o',
    label: 'CO2 + hν → CO + O',
    reactant: 'co2',
    products: [
      { speciesId: 'co', coefficient: 1 },
      { speciesId: 'o', coefficient: 1 }
    ],
    referenceNodes: nodePair(3.79e-12, 1.02e-10),
    sourceTable: 'Taysum2020TableB2'
  },
  {
    id: 'co2_photolysis_to_co_o1d',
    label: 'CO2 + hν → CO + O(1D)',
    reactant: 'co2',
    products: [
      { speciesId: 'co', coefficient: 1 },
      { speciesId: 'o1d', coefficient: 1 }
    ],
    referenceNodes: nodePair(0, 0),
    sourceTable: 'Taysum2020TableB2'
  },
  {
    id: 'o3_photolysis_to_o1d',
    label: 'O3 + hν → O2 + O(1D)',
    reactant: 'o3',
    products: [
      { speciesId: 'o2', coefficient: 1 },
      { speciesId: 'o1d', coefficient: 1 }
    ],
    referenceNodes: nodePair(3.12e-3, 4.09e-3),
    sourceTable: 'Taysum2020TableB2'
  },
  {
    id: 'o3_photolysis_to_o',
    label: 'O3 + hν → O2 + O',
    reactant: 'o3',
    products: [
      { speciesId: 'o2', coefficient: 1 },
      { speciesId: 'o', coefficient: 1 }
    ],
    referenceNodes: nodePair(5.22e-4, 6.86e-4),
    sourceTable: 'Taysum2020TableB2'
  },
  {
    id: 'h2o_photolysis',
    label: 'H2O + hν → H + OH',
    reactant: 'h2o',
    products: [
      { speciesId: 'h', coefficient: 1 },
      { speciesId: 'oh', coefficient: 1 }
    ],
    referenceNodes: nodePair(1.28e-10, 4.67e-8),
    sourceTable: 'Taysum2020TableB2'
  },
  {
    id: 'h2o2_photolysis',
    label: 'H2O2 + hν → OH + OH',
    reactant: 'h2o2',
    products: [{ speciesId: 'oh', coefficient: 2 }],
    referenceNodes: nodePair(3.93e-5, 5.26e-5),
    sourceTable: 'Taysum2020TableB2'
  },
  {
    id: 'ho2_photolysis',
    label: 'HO2 + hν → O + OH',
    reactant: 'ho2',
    products: [
      { speciesId: 'o', coefficient: 1 },
      { speciesId: 'oh', coefficient: 1 }
    ],
    referenceNodes: nodePair(2.40e-4, 3.20e-4),
    sourceTable: 'Taysum2020TableB2'
  }
] as const;

export interface MarsPhotolysisEvaluationInput {
  readonly reactionId: string;
  /** Must be exactly one of the two source table altitude nodes. */
  readonly altitudeKm: number;
  /** Explicit local reactant number density, particles cm^-3. */
  readonly reactantNumberDensityPerCm3: number;
  readonly reactantDensityProvenance: DataProvenance;
}

export interface MarsPhotolysisEvaluation {
  readonly status: 'evaluated';
  readonly reactionId: string;
  readonly reaction: string;
  readonly altitudeKm: 0.5 | 42.67;
  readonly photolysisFrequencyPerS: number;
  readonly reactantNumberDensityPerCm3: number;
  /** Volumetric reaction-event rate J × n, particles cm^-3 s^-1. */
  readonly eventRatePerCm3PerS: number;
  /** Net rates (products positive, reactant negative), particles cm^-3 s^-1. */
  readonly netSpeciesRatesPerCm3PerS: Readonly<Partial<Record<MarsPhotolysisSpeciesId, number>>>;
  readonly formula: 'eventRate = J × reactantNumberDensity';
  readonly provenance: {
    readonly photolysis: DataProvenance;
    readonly reactantDensity: DataProvenance;
  };
  readonly uncertaintyStatus: 'not_quantified';
  readonly schedulerEligible: false;
  readonly applicabilityWarning: string;
}

export interface MarsPhotolysisEvaluationRejection {
  readonly status: 'rejected';
  readonly reason:
    | 'unknown_reaction'
    | 'unsupported_altitude'
    | 'invalid_density'
    | 'missing_density_provenance';
}

export type MarsPhotolysisEvaluationResult =
  | MarsPhotolysisEvaluation
  | MarsPhotolysisEvaluationRejection;

function hasIdentifiedProvenance(value: DataProvenance): boolean {
  const reference = value.reference ?? value.sourceId ?? value.datasetId ?? value.recordId;
  return typeof value.sourceName === 'string' && value.sourceName.trim() !== '' &&
    typeof reference === 'string' && reference.trim() !== '';
}

/**
 * Evaluate only the tabulated first-order photolysis loss at an exact source
 * node. The caller must supply a sourced local reactant density. No model
 * interpolation, vertical transfer, or Scheduler mutation is performed.
 */
export function evaluateMarsPhotolysisAtReferenceNode(
  input: MarsPhotolysisEvaluationInput
): MarsPhotolysisEvaluationResult {
  const channel = MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS.find(
    (candidate) => candidate.id === input.reactionId
  );
  if (channel === undefined) return { status: 'rejected', reason: 'unknown_reaction' };

  if (input.altitudeKm !== 0.5 && input.altitudeKm !== 42.67) {
    return { status: 'rejected', reason: 'unsupported_altitude' };
  }
  if (
    !Number.isFinite(input.reactantNumberDensityPerCm3) ||
    input.reactantNumberDensityPerCm3 < 0
  ) {
    return { status: 'rejected', reason: 'invalid_density' };
  }
  if (
    input.reactantDensityProvenance === null ||
    typeof input.reactantDensityProvenance !== 'object' ||
    !hasIdentifiedProvenance(input.reactantDensityProvenance)
  ) {
    return { status: 'rejected', reason: 'missing_density_provenance' };
  }

  const node = channel.referenceNodes.find((entry) => entry.altitudeKm === input.altitudeKm);
  if (node === undefined) return { status: 'rejected', reason: 'unsupported_altitude' };

  const eventRate = node.photolysisFrequencyPerS * input.reactantNumberDensityPerCm3;
  const netRates: Partial<Record<MarsPhotolysisSpeciesId, number>> = {
    [channel.reactant]: -eventRate
  };
  for (const product of channel.products) {
    netRates[product.speciesId] =
      (netRates[product.speciesId] ?? 0) + product.coefficient * eventRate;
  }

  return {
    status: 'evaluated',
    reactionId: channel.id,
    reaction: channel.label,
    altitudeKm: node.altitudeKm,
    photolysisFrequencyPerS: node.photolysisFrequencyPerS,
    reactantNumberDensityPerCm3: input.reactantNumberDensityPerCm3,
    eventRatePerCm3PerS: eventRate,
    netSpeciesRatesPerCm3PerS: netRates,
    formula: 'eventRate = J × reactantNumberDensity',
    provenance: {
      photolysis: { ...MARS_TAYSUM_2020_PHOTOLYSIS_PROVENANCE },
      reactantDensity: { ...input.reactantDensityProvenance }
    },
    uncertaintyStatus: 'not_quantified',
    schedulerEligible: false,
    applicabilityWarning:
      'Только табличный сценарий Taysum & Palmer 2020: SZA=0°, Ls=251°; J также зависит от T, колонок O3/атмосферы, расстояния Солнце–Марс и оптической/пылевой непрозрачности. Это не универсальный J и не Scheduler-источник.'
  };
}
