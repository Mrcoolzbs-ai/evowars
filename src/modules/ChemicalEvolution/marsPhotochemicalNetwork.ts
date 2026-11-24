import {
  MARS_GAS_PHASE_SPECIES_ELEMENTS,
  MARS_TAYSUM_2020_GAS_PHASE_REACTIONS,
  evaluateMarsGasPhaseReaction
} from '../Data/marsGasPhaseKinetics';
import type {
  MarsGasPhaseReaction,
  MarsGasSpeciesId
} from '../Data/marsGasPhaseKinetics';
import {
  MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS,
  evaluateMarsPhotolysisAtReferenceNode
} from '../Data/marsPhotochemistryEvidence';
import type { MarsPhotolysisSpeciesId } from '../Data/marsPhotochemistryEvidence';
import type { DataProvenance } from '../Core/scientificValue';
import { solveOdeWithRadauIia, OdeSolverError } from '../Core/odeSolver';
import type { OdeSolverProblem, LinearInvariant } from '../Core/solverBackend';

// ============================================
// MARS SINGLE-COMPARTMENT PHOTOCHEMICAL STEP
// ============================================
//
// This adapter couples only the source-backed gas-phase expressions
// from Taysum & Palmer (2020) Table B1 and photolysis J values from
// Table B2. It is intentionally a single homogeneous compartment:
// one explicit temperature, one table altitude node, one constant
// source radiation scenario (SZA=0°, Ls=251°), and one physical-seconds
// integration interval. It is not a vertical-column model.
//
// All 16 species concentrations are explicit initial inputs in
// particles cm^-3. CO2 is a dynamic species and, when a selected
// termolecular law needs a bath gas, its current state concentration
// is also used as [M]. No pressure, mixing ratio, or column inventory
// is converted into a concentration. No Scheduler/GeneratedWorld
// state or initial planetary reservoir is modified.

export const MARS_PHOTOCHEMICAL_SPECIES_ORDER: readonly MarsGasSpeciesId[] = [
  'O', 'O1D', 'O2', 'O3', 'CO2', 'CO', 'H', 'H2',
  'H2O', 'OH', 'HO2', 'H2O2', 'CH4', 'CH3', 'CH3O', 'HCHO'
] as const;

export type MarsPhotochemicalReactionKind = 'gas_phase' | 'photolysis';

export interface MarsPhotochemicalInitialConcentrations {
  readonly O: number;
  readonly O1D: number;
  readonly O2: number;
  readonly O3: number;
  readonly CO2: number;
  readonly CO: number;
  readonly H: number;
  readonly H2: number;
  readonly H2O: number;
  readonly OH: number;
  readonly HO2: number;
  readonly H2O2: number;
  readonly CH4: number;
  readonly CH3: number;
  readonly CH3O: number;
  readonly HCHO: number;
}

export interface MarsPhotochemicalNetworkInput {
  readonly temperatureK: number;
  readonly temperatureProvenance: DataProvenance;
  /** Exact Table B2 altitude node; no vertical interpolation is implemented. */
  readonly altitudeKm: 0.5 | 42.67;
  /** Gas reaction IDs from Appendix Table B1. Unsupported IDs fail the entire request. */
  readonly gasPhaseReactionIds: readonly string[];
  /** Photolysis channel IDs from Appendix Table B2. */
  readonly photolysisReactionIds: readonly string[];
  readonly dtSeconds: number;
  /** Complete explicit vector, including radical species; missing fields are not zeros. */
  readonly initialConcentrationsPerCm3: MarsPhotochemicalInitialConcentrations;
  /** Identifies the origin of all explicitly supplied initial concentrations. */
  readonly initialStateProvenance: DataProvenance;
}

export type MarsPhotochemicalNetworkErrorCode =
  | 'invalid_input'
  | 'missing_provenance'
  | 'unknown_reaction'
  | 'unsupported_reaction'
  | 'integration_failure';

export class MarsPhotochemicalNetworkError extends Error {
  readonly code: MarsPhotochemicalNetworkErrorCode;
  readonly details?: Record<string, number | string | boolean>;

  constructor(
    code: MarsPhotochemicalNetworkErrorCode,
    message: string,
    details?: Record<string, number | string | boolean>
  ) {
    super('[MarsPhotochemicalNetwork:' + code + '] ' + message);
    this.name = 'MarsPhotochemicalNetworkError';
    this.code = code;
    this.details = details;
  }
}

interface PreparedReaction {
  readonly id: string;
  readonly kind: MarsPhotochemicalReactionKind;
  readonly label: string;
  readonly rateCoefficient: number;
  readonly rateCoefficientUnit: 'cm3_molecule_s' | 'cm6_molecule2_s' | 'per_s';
  /** Positive reactant orders; includes CO2 once more for termolecular bath gas. */
  readonly kineticOrders: ReadonlyMap<MarsGasSpeciesId, number>;
  /** Net stoichiometry, product minus reactant, including only chemical species. */
  readonly netStoichiometry: ReadonlyMap<MarsGasSpeciesId, number>;
  readonly provenance: DataProvenance;
}

export interface MarsPhotochemicalPreparedReaction {
  readonly id: string;
  readonly kind: MarsPhotochemicalReactionKind;
  readonly label: string;
  readonly rateCoefficient: number;
  readonly rateCoefficientUnit: 'cm3_molecule_s' | 'cm6_molecule2_s' | 'per_s';
  readonly provenance: DataProvenance;
}

export interface MarsPhotochemicalNetworkBuildResult {
  readonly status: 'built';
  readonly problem: OdeSolverProblem;
  readonly speciesOrder: readonly MarsGasSpeciesId[];
  readonly initialConcentrationsPerCm3: MarsPhotochemicalInitialConcentrations;
  readonly temperatureK: number;
  readonly altitudeKm: 0.5 | 42.67;
  readonly dtSeconds: number;
  readonly reactions: readonly MarsPhotochemicalPreparedReaction[];
  readonly inputProvenance: {
    readonly temperature: DataProvenance;
    readonly initialState: DataProvenance;
  };
  readonly warnings: readonly string[];
}

function hasIdentifiedProvenance(value: unknown): value is DataProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  return (
    (typeof p.sourceName === 'string' && p.sourceName.trim() !== '') ||
    (typeof p.sourceId === 'string' && p.sourceId.trim() !== '') ||
    (typeof p.datasetId === 'string' && p.datasetId.trim() !== '') ||
    (typeof p.reference === 'string' && p.reference.trim() !== '')
  );
}

function addTerm(
  map: Map<MarsGasSpeciesId, number>,
  speciesId: MarsGasSpeciesId,
  coefficient: number
): void {
  map.set(speciesId, (map.get(speciesId) ?? 0) + coefficient);
}

function toNetStoichiometry(
  reactants: readonly { readonly speciesId: MarsGasSpeciesId; readonly coefficient: number }[],
  products: readonly { readonly speciesId: MarsGasSpeciesId; readonly coefficient: number }[]
): Map<MarsGasSpeciesId, number> {
  const net = new Map<MarsGasSpeciesId, number>();
  for (const term of reactants) addTerm(net, term.speciesId, -term.coefficient);
  for (const term of products) addTerm(net, term.speciesId, term.coefficient);
  return net;
}

function photolysisSpeciesToGasSpecies(species: MarsPhotolysisSpeciesId): MarsGasSpeciesId {
  switch (species) {
    case 'o': return 'O';
    case 'o1d': return 'O1D';
    case 'o2': return 'O2';
    case 'o3': return 'O3';
    case 'co2': return 'CO2';
    case 'co': return 'CO';
    case 'h': return 'H';
    case 'oh': return 'OH';
    case 'h2o': return 'H2O';
    case 'h2o2': return 'H2O2';
    case 'ho2': return 'HO2';
    default: {
      const exhaustive: never = species;
      throw new Error('Unsupported photolysis species: ' + String(exhaustive));
    }
  }
}

function validateInput(input: MarsPhotochemicalNetworkInput): void {
  if (!Number.isFinite(input.temperatureK) || input.temperatureK <= 0) {
    throw new MarsPhotochemicalNetworkError('invalid_input', 'temperatureK must be finite and > 0 K');
  }
  if (input.altitudeKm !== 0.5 && input.altitudeKm !== 42.67) {
    throw new MarsPhotochemicalNetworkError('invalid_input', 'altitudeKm must be an exact Table B2 node: 0.5 or 42.67 km');
  }
  if (!Number.isFinite(input.dtSeconds) || input.dtSeconds <= 0) {
    throw new MarsPhotochemicalNetworkError('invalid_input', 'dtSeconds must be finite and > 0');
  }
  if (!Array.isArray(input.gasPhaseReactionIds) || !Array.isArray(input.photolysisReactionIds)) {
    throw new MarsPhotochemicalNetworkError('invalid_input', 'reaction ID selectors must be arrays');
  }
  if (input.gasPhaseReactionIds.length + input.photolysisReactionIds.length === 0) {
    throw new MarsPhotochemicalNetworkError('invalid_input', 'at least one gas-phase or photolysis reaction must be selected explicitly');
  }
  if (
    new Set(input.gasPhaseReactionIds).size !== input.gasPhaseReactionIds.length ||
    new Set(input.photolysisReactionIds).size !== input.photolysisReactionIds.length
  ) {
    throw new MarsPhotochemicalNetworkError('invalid_input', 'duplicate reaction IDs are not allowed');
  }
  if (!hasIdentifiedProvenance(input.temperatureProvenance) || !hasIdentifiedProvenance(input.initialStateProvenance)) {
    throw new MarsPhotochemicalNetworkError('missing_provenance', 'temperature and initial concentrations both require identified provenance');
  }
  const state = input.initialConcentrationsPerCm3 as unknown as Record<string, unknown>;
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new MarsPhotochemicalNetworkError('invalid_input', 'initialConcentrationsPerCm3 must be a complete object');
  }
  const known = new Set<string>(MARS_PHOTOCHEMICAL_SPECIES_ORDER);
  const missing = MARS_PHOTOCHEMICAL_SPECIES_ORDER.filter((species) => !Object.prototype.hasOwnProperty.call(state, species));
  const unknown = Object.keys(state).filter((key) => !known.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new MarsPhotochemicalNetworkError(
      'invalid_input',
      'the concentration vector must contain all 16 species exactly; missing=' + missing.join(',') + '; unknown=' + unknown.join(',')
    );
  }
  for (const species of MARS_PHOTOCHEMICAL_SPECIES_ORDER) {
    const value = state[species];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new MarsPhotochemicalNetworkError(
        'invalid_input',
        'initial concentration ' + species + ' must be a finite non-negative value in particles cm^-3'
      );
    }
  }
  if (input.gasPhaseReactionIds.some((id) => !MARS_TAYSUM_2020_GAS_PHASE_REACTIONS.some((r) => r.id === id))) {
    throw new MarsPhotochemicalNetworkError('unknown_reaction', 'unknown gas-phase reaction ID selected');
  }
  if (input.photolysisReactionIds.some((id) => !MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS.some((r) => r.id === id))) {
    throw new MarsPhotochemicalNetworkError('unknown_reaction', 'unknown photolysis reaction ID selected');
  }
}

function powerProduct(
  y: readonly number[],
  speciesIndex: ReadonlyMap<MarsGasSpeciesId, number>,
  orders: ReadonlyMap<MarsGasSpeciesId, number>
): number {
  let product = 1;
  for (const [species, order] of orders) {
    product *= Math.pow(y[speciesIndex.get(species) as number], order);
  }
  return product;
}

function derivativeOfPowerProduct(
  y: readonly number[],
  speciesIndex: ReadonlyMap<MarsGasSpeciesId, number>,
  orders: ReadonlyMap<MarsGasSpeciesId, number>,
  species: MarsGasSpeciesId
): number {
  const order = orders.get(species) ?? 0;
  if (order === 0) return 0;
  let product = order;
  for (const [other, exponent] of orders) {
    const index = speciesIndex.get(other) as number;
    product *= Math.pow(y[index], exponent - (other === species ? 1 : 0));
  }
  return product;
}

/** Build a small stiff ODE problem with exact stoichiometry and analytical Jacobian. */
export function buildMarsPhotochemicalNetworkProblem(
  input: MarsPhotochemicalNetworkInput
): MarsPhotochemicalNetworkBuildResult {
  validateInput(input);

  const speciesOrder = [...MARS_PHOTOCHEMICAL_SPECIES_ORDER];
  const speciesIndex = new Map<MarsGasSpeciesId, number>(
    speciesOrder.map((species, index) => [species, index])
  );
  const y0 = speciesOrder.map((species) => input.initialConcentrationsPerCm3[species]);
  const prepared: PreparedReaction[] = [];

  for (const reactionId of input.gasPhaseReactionIds) {
    const sourceReaction = MARS_TAYSUM_2020_GAS_PHASE_REACTIONS.find((candidate) => candidate.id === reactionId) as MarsGasPhaseReaction;
    const initialResult = evaluateMarsGasPhaseReaction({
      reactionId,
      temperatureK: input.temperatureK,
      concentrationsPerCm3: input.initialConcentrationsPerCm3,
      co2ThirdBodyConcentrationPerCm3: input.initialConcentrationsPerCm3.CO2
    });
    if (initialResult.status !== 'evaluated') {
      throw new MarsPhotochemicalNetworkError(
        initialResult.reason === 'unknown_reaction' ? 'unknown_reaction' : 'unsupported_reaction',
        'gas-phase reaction ' + reactionId + ' cannot be included: ' + initialResult.reason,
        { reactionId }
      );
    }
    const expression = sourceReaction.rateExpression;
    const kineticOrders = new Map<MarsGasSpeciesId, number>();
    for (const term of sourceReaction.reactants) addTerm(kineticOrders, term.speciesId, term.coefficient);
    if (expression.kind === 'termolecular_arrhenius') {
      if (!(input.initialConcentrationsPerCm3.CO2 > 0)) {
        throw new MarsPhotochemicalNetworkError('invalid_input', 'selected termolecular reactions require strictly positive initial CO2 bath-gas density');
      }
      addTerm(kineticOrders, 'CO2', 1);
    }
    prepared.push({
      id: reactionId,
      kind: 'gas_phase',
      label: sourceReaction.label,
      rateCoefficient: initialResult.rateConstant,
      rateCoefficientUnit: initialResult.rateConstantUnit,
      kineticOrders,
      netStoichiometry: toNetStoichiometry(sourceReaction.reactants, sourceReaction.products),
      provenance: initialResult.provenance
    });
  }

  for (const reactionId of input.photolysisReactionIds) {
    const channel = MARS_TAYSUM_2020_PHOTOLYSIS_CHANNELS.find((candidate) => candidate.id === reactionId);
    if (channel === undefined) {
      throw new MarsPhotochemicalNetworkError('unknown_reaction', 'unknown photolysis reaction ID: ' + reactionId);
    }
    const parent = photolysisSpeciesToGasSpecies(channel.reactant);
    const evaluated = evaluateMarsPhotolysisAtReferenceNode({
      reactionId,
      altitudeKm: input.altitudeKm,
      reactantNumberDensityPerCm3: input.initialConcentrationsPerCm3[parent],
      reactantDensityProvenance: input.initialStateProvenance
    });
    if (evaluated.status !== 'evaluated') {
      throw new MarsPhotochemicalNetworkError('unsupported_reaction', 'photolysis reaction ' + reactionId + ' cannot be included: ' + evaluated.reason);
    }
    const net = new Map<MarsGasSpeciesId, number>();
    addTerm(net, parent, -1);
    for (const product of channel.products) {
      addTerm(net, photolysisSpeciesToGasSpecies(product.speciesId), product.coefficient);
    }
    prepared.push({
      id: reactionId,
      kind: 'photolysis',
      label: channel.label,
      rateCoefficient: evaluated.photolysisFrequencyPerS,
      rateCoefficientUnit: 'per_s',
      kineticOrders: new Map([[parent, 1]]),
      netStoichiometry: net,
      provenance: evaluated.provenance.photolysis
    });
  }

  // All reactions must conserve C, H and O before solving.
  const elements = ['C', 'H', 'O'] as const;
  const linearInvariants: LinearInvariant[] = elements.map((element) => {
    const coefficients = speciesOrder.map((species) =>
      MARS_GAS_PHASE_SPECIES_ELEMENTS[species][element] ?? 0
    );
    let expected = 0;
    for (let i = 0; i < y0.length; i++) expected += coefficients[i] * y0[i];
    return { coefficients, expected };
  });
  for (const reaction of prepared) {
    for (const element of elements) {
      let residual = 0;
      for (const [species, coefficient] of reaction.netStoichiometry) {
        residual += coefficient * (MARS_GAS_PHASE_SPECIES_ELEMENTS[species][element] ?? 0);
      }
      if (residual !== 0) {
        throw new MarsPhotochemicalNetworkError(
          'invalid_input',
          'reaction ' + reaction.id + ' violates ' + element + ' conservation (residual ' + residual + ')'
        );
      }
    }
  }

  const rhs = (_t: number, y: readonly number[]): number[] => {
    const dy = new Array<number>(speciesOrder.length).fill(0);
    for (const reaction of prepared) {
      const eventRate = reaction.rateCoefficient * powerProduct(y, speciesIndex, reaction.kineticOrders);
      for (const [species, coefficient] of reaction.netStoichiometry) {
        dy[speciesIndex.get(species) as number] += coefficient * eventRate;
      }
    }
    return dy;
  };

  const jacobian = (_t: number, y: readonly number[]): number[][] => {
    const matrix = Array.from({ length: speciesOrder.length }, () =>
      new Array<number>(speciesOrder.length).fill(0)
    );
    for (const reaction of prepared) {
      for (const [reactant, order] of reaction.kineticOrders) {
        if (order === 0) continue;
        const column = speciesIndex.get(reactant) as number;
        const derivative = reaction.rateCoefficient *
          derivativeOfPowerProduct(y, speciesIndex, reaction.kineticOrders, reactant);
        for (const [species, coefficient] of reaction.netStoichiometry) {
          const row = speciesIndex.get(species) as number;
          matrix[row][column] += coefficient * derivative;
        }
      }
    }
    return matrix;
  };

  const problem: OdeSolverProblem = {
    kind: 'ode',
    stateDimension: speciesOrder.length,
    t0: 0,
    tEnd: input.dtSeconds,
    y0,
    rhs,
    jacobian,
    nonNegativeIndices: speciesOrder.map((_, index) => index),
    linearInvariants,
    description:
      'Mars single-compartment source-backed photochemical network; T=' + input.temperatureK +
      ' K, z=' + input.altitudeKm + ' km, Δt=' + input.dtSeconds + ' s, SZA=0°, Ls=251°'
  };

  return {
    status: 'built',
    problem,
    speciesOrder,
    initialConcentrationsPerCm3: { ...input.initialConcentrationsPerCm3 },
    temperatureK: input.temperatureK,
    altitudeKm: input.altitudeKm,
    dtSeconds: input.dtSeconds,
    reactions: prepared.map((reaction) => ({
      id: reaction.id,
      kind: reaction.kind,
      label: reaction.label,
      rateCoefficient: reaction.rateCoefficient,
      rateCoefficientUnit: reaction.rateCoefficientUnit,
      provenance: { ...reaction.provenance }
    })),
    inputProvenance: {
      temperature: { ...input.temperatureProvenance },
      initialState: { ...input.initialStateProvenance }
    },
    warnings: [
      'Single homogeneous compartment only: no vertical/meridional transport, eddy diffusion, sedimentation, surface boundary or time-varying meteorology.',
      'Photolysis lookup values are restricted to SZA=0° and Ls=251° at the selected exact Table B2 altitude node; no radiative transfer/interpolation.',
      'Gas-phase Table B1 rows do not publish formal temperature-validity intervals or numerical 1σ rate uncertainties.',
      'No generated planet state, chemical inventory or Scheduler state is read or mutated.'
    ]
  };
}

export interface MarsPhotochemicalNetworkResult {
  readonly status: 'applied';
  readonly method: string;
  readonly temperatureK: number;
  readonly altitudeKm: 0.5 | 42.67;
  readonly dtSeconds: number;
  readonly initialConcentrationsPerCm3: MarsPhotochemicalInitialConcentrations;
  readonly finalConcentrationsPerCm3: MarsPhotochemicalInitialConcentrations;
  readonly reactions: readonly MarsPhotochemicalPreparedReaction[];
  readonly integration: {
    readonly stats: unknown;
    readonly invariantChecks: unknown;
    readonly minorNegativeCount: number;
  };
  readonly inputProvenance: {
    readonly temperature: DataProvenance;
    readonly initialState: DataProvenance;
  };
  readonly warnings: readonly string[];
}

/** Integrate one explicit local chemistry interval with Radau IIA; no partial result on failure. */
export function runMarsPhotochemicalConcentrationStep(
  input: MarsPhotochemicalNetworkInput
): MarsPhotochemicalNetworkResult {
  const built = buildMarsPhotochemicalNetworkProblem(input);
  try {
    const solved = solveOdeWithRadauIia(built.problem);
    const final = {} as Record<MarsGasSpeciesId, number>;
    built.speciesOrder.forEach((species, index) => {
      final[species] = solved.y[index];
    });
    return {
      status: 'applied',
      method: solved.method,
      temperatureK: built.temperatureK,
      altitudeKm: built.altitudeKm,
      dtSeconds: built.dtSeconds,
      initialConcentrationsPerCm3: { ...built.initialConcentrationsPerCm3 },
      finalConcentrationsPerCm3: final,
      reactions: built.reactions,
      integration: {
        stats: solved.stats,
        invariantChecks: solved.diagnostics.invariantChecks,
        minorNegativeCount: solved.diagnostics.minorNegativeCount
      },
      inputProvenance: built.inputProvenance,
      warnings: built.warnings
    };
  } catch (error) {
    if (error instanceof OdeSolverError) {
      throw new MarsPhotochemicalNetworkError(
        'integration_failure',
        'Radau IIA rejected the selected Mars chemistry step; no partial concentrations are returned: ' + error.message,
        { solverErrorCode: error.code }
      );
    }
    throw error;
  }
}
