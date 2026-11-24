import type { DataProvenance } from '../Core/scientificValue';
import { solveOdeWithRadauIia } from '../Core/odeSolver';
import type {
  LinearInvariant,
  OdeSolverOptions,
  OdeSolverProblem,
  OdeSolverResult
} from '../Core/solverBackend';
import {
  MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS,
  evaluateMarsInorganicBimolecularReaction
} from '../Data/marsInorganicGasPhaseEvidence';
import type { MarsInorganicSpeciesId } from '../Data/marsInorganicGasPhaseEvidence';

export const MARS_INORGANIC_SPECIES_ORDER: readonly MarsInorganicSpeciesId[] = [
  'O', 'O1D', 'O2', 'O3', 'H', 'OH', 'HO2', 'H2',
  'H2O', 'H2O2', 'CO', 'CO2', 'CH4', 'CH3', 'CH3O', 'HCHO'
] as const;

const SPECIES_ELEMENTS: Readonly<Record<MarsInorganicSpeciesId, Readonly<Record<'C' | 'H' | 'O', number>>>> = {
  O: { C: 0, H: 0, O: 1 },
  O1D: { C: 0, H: 0, O: 1 },
  O2: { C: 0, H: 0, O: 2 },
  O3: { C: 0, H: 0, O: 3 },
  H: { C: 0, H: 1, O: 0 },
  OH: { C: 0, H: 1, O: 1 },
  HO2: { C: 0, H: 1, O: 2 },
  H2: { C: 0, H: 2, O: 0 },
  H2O: { C: 0, H: 2, O: 1 },
  H2O2: { C: 0, H: 2, O: 2 },
  CO: { C: 1, H: 0, O: 1 },
  CO2: { C: 1, H: 0, O: 2 },
  CH4: { C: 1, H: 4, O: 0 },
  CH3: { C: 1, H: 3, O: 0 },
  CH3O: { C: 1, H: 3, O: 1 },
  HCHO: { C: 1, H: 2, O: 1 }
};

export interface MarsInorganicMechanismInput {
  readonly temperatureK: number;
  readonly durationSeconds: number;
  /** All 16 state species must be supplied explicitly, including explicit zeros. */
  readonly initialConcentrationsPerCm3: Readonly<Record<MarsInorganicSpeciesId, number>>;
  /** Identified provenance for every initial concentration, including explicit zeros. */
  readonly concentrationProvenance: Readonly<Record<MarsInorganicSpeciesId, DataProvenance>>;
  /** Non-empty subset of the 24 explicitly tabulated bimolecular channels. */
  readonly reactionIds: readonly string[];
  readonly solverOptions?: OdeSolverOptions;
}

export interface MarsInorganicReactionRunSummary {
  readonly reactionId: string;
  readonly tableKey: string;
  readonly reaction: string;
  readonly rateConstantCm3PerMoleculePerS: number;
  readonly initialEventRatePerCm3PerS: number;
  readonly rateProvenance: DataProvenance;
  readonly reactantConcentrationProvenance: Readonly<Partial<Record<MarsInorganicSpeciesId, DataProvenance>>>;
}

export interface MarsInorganicElementBudget {
  readonly element: 'C' | 'H' | 'O';
  readonly initialParticlesPerCm3: number;
  readonly finalParticlesPerCm3: number;
  readonly absoluteDriftParticlesPerCm3: number;
  readonly relativeDrift: number;
}

export interface MarsInorganicMechanismResult {
  readonly status: 'applied';
  readonly modelScope: 'taysum_2020_table_b1_bimolecular_subset';
  readonly temperatureK: number;
  readonly durationSeconds: number;
  readonly reactionIds: readonly string[];
  readonly concentrationsPerCm3: Readonly<Record<MarsInorganicSpeciesId, number>>;
  readonly finalConcentrationsPerCm3: Readonly<Record<MarsInorganicSpeciesId, number>>;
  readonly reactions: readonly MarsInorganicReactionRunSummary[];
  readonly elementBudgets: readonly MarsInorganicElementBudget[];
  readonly integration: {
    readonly method: string;
    readonly result: OdeSolverResult;
  };
  readonly limitations: readonly string[];
}

export type MarsInorganicMechanismErrorCode =
  | 'invalid_input'
  | 'no_kinetic_data'
  | 'integration_failure';

export class MarsInorganicMechanismError extends Error {
  readonly code: MarsInorganicMechanismErrorCode;

  constructor(code: MarsInorganicMechanismErrorCode, message: string) {
    super('[MarsInorganicMechanism:' + code + '] ' + message);
    this.name = 'MarsInorganicMechanismError';
    this.code = code;
  }
}

function hasIdentifiedProvenance(value: unknown): value is DataProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  const reference = p.reference ?? p.sourceId ?? p.datasetId ?? p.recordId;
  return typeof p.sourceName === 'string' && p.sourceName.trim() !== '' &&
    typeof reference === 'string' && reference.trim() !== '';
}

function elementalTotals(state: readonly number[]): Record<'C' | 'H' | 'O', number> {
  const totals: Record<'C' | 'H' | 'O', number> = { C: 0, H: 0, O: 0 };
  MARS_INORGANIC_SPECIES_ORDER.forEach((speciesId, index) => {
    const composition = SPECIES_ELEMENTS[speciesId];
    totals.C += composition.C * state[index]!;
    totals.H += composition.H * state[index]!;
    totals.O += composition.O * state[index]!;
  });
  return totals;
}

function buildLinearInvariants(y0: readonly number[]): LinearInvariant[] {
  const elements: readonly ('C' | 'H' | 'O')[] = ['C', 'H', 'O'];
  return elements.map((element) => {
    const coefficients = MARS_INORGANIC_SPECIES_ORDER.map(
      (speciesId) => SPECIES_ELEMENTS[speciesId][element]
    );
    const expected = coefficients.reduce((sum, coefficient, index) => sum + coefficient * y0[index]!, 0);
    return { coefficients, expected };
  });
}

/**
 * Integrate the explicitly selected Table B1 bimolecular subset with the
 * shared Radau IIA solver. Initial concentrations and their provenance are
 * caller-supplied; this API does not create a planetary atmospheric state.
 */
export function runMarsInorganicBimolecularMechanism(
  input: MarsInorganicMechanismInput
): MarsInorganicMechanismResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new MarsInorganicMechanismError('invalid_input', 'expected a mechanism input object');
  }
  if (!Number.isFinite(input.temperatureK) || input.temperatureK <= 0) {
    throw new MarsInorganicMechanismError('invalid_input', 'temperatureK must be finite and positive');
  }
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new MarsInorganicMechanismError('invalid_input', 'durationSeconds must be finite and positive');
  }
  if (!Array.isArray(input.reactionIds) || input.reactionIds.length === 0) {
    throw new MarsInorganicMechanismError('invalid_input', 'reactionIds must be a non-empty explicit selection');
  }

  const allIds = new Set(MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS.map((reaction) => reaction.id));
  const selectedIds = new Set<string>();
  for (const reactionId of input.reactionIds) {
    if (typeof reactionId !== 'string' || reactionId.trim() === '' || !allIds.has(reactionId)) {
      throw new MarsInorganicMechanismError('no_kinetic_data', 'reaction ID is not part of the 24 imported Table B1 bimolecular records: ' + String(reactionId));
    }
    if (selectedIds.has(reactionId)) {
      throw new MarsInorganicMechanismError('invalid_input', 'duplicate reaction ID: ' + reactionId);
    }
    selectedIds.add(reactionId);
  }

  const rawConcentrations = input.initialConcentrationsPerCm3;
  const rawProvenance = input.concentrationProvenance;
  if (
    typeof rawConcentrations !== 'object' || rawConcentrations === null || Array.isArray(rawConcentrations) ||
    typeof rawProvenance !== 'object' || rawProvenance === null || Array.isArray(rawProvenance)
  ) {
    throw new MarsInorganicMechanismError('invalid_input', 'concentrations and per-species provenance must be objects');
  }

  const allowedKeys = new Set<string>(MARS_INORGANIC_SPECIES_ORDER);
  for (const key of Object.keys(rawConcentrations)) {
    if (!allowedKeys.has(key)) {
      throw new MarsInorganicMechanismError('invalid_input', 'unknown species key in concentrations: ' + key);
    }
  }
  for (const key of Object.keys(rawProvenance)) {
    if (!allowedKeys.has(key)) {
      throw new MarsInorganicMechanismError('invalid_input', 'unknown species key in concentration provenance: ' + key);
    }
  }

  const y0 = MARS_INORGANIC_SPECIES_ORDER.map((speciesId) => {
    if (!Object.prototype.hasOwnProperty.call(rawConcentrations, speciesId)) {
      throw new MarsInorganicMechanismError('invalid_input', 'missing explicit concentration for ' + speciesId + '; missing is not zero');
    }
    const value = rawConcentrations[speciesId];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new MarsInorganicMechanismError('invalid_input', 'concentration for ' + speciesId + ' must be finite and non-negative');
    }
    if (!hasIdentifiedProvenance(rawProvenance[speciesId])) {
      throw new MarsInorganicMechanismError('invalid_input', 'missing identified provenance for concentration of ' + speciesId);
    }
    return value;
  });

  const indexOf = new Map<MarsInorganicSpeciesId, number>(
    MARS_INORGANIC_SPECIES_ORDER.map((speciesId, index) => [speciesId, index])
  );
  const selected = MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS.filter(
    (reaction) => selectedIds.has(reaction.id)
  );

  const prepared = selected.map((reaction) => {
    const evaluated = evaluateMarsInorganicBimolecularReaction({
      reactionId: reaction.id,
      temperatureK: input.temperatureK,
      concentrationsPerCm3: rawConcentrations,
      concentrationProvenance: rawProvenance
    });
    if (evaluated.status !== 'evaluated') {
      throw new MarsInorganicMechanismError(
        'invalid_input',
        'rate evaluator rejected ' + reaction.tableKey + ': ' + evaluated.reason
      );
    }
    const delta = new Array<number>(MARS_INORGANIC_SPECIES_ORDER.length).fill(0);
    for (const speciesId of reaction.reactants) {
      delta[indexOf.get(speciesId)!] -= 1;
    }
    for (const product of reaction.products) {
      delta[indexOf.get(product.speciesId)!] += product.coefficient;
    }
    return {
      reaction,
      k: evaluated.rateConstantCm3PerMoleculePerS,
      delta,
      initialEventRate: evaluated.eventRatePerCm3PerS,
      rateProvenance: evaluated.rateProvenance,
      reactantConcentrationProvenance: evaluated.concentrationProvenance
    };
  });

  const rhs = (_time: number, y: readonly number[]): number[] => {
    const dy = new Array<number>(MARS_INORGANIC_SPECIES_ORDER.length).fill(0);
    for (const term of prepared) {
      const a = indexOf.get(term.reaction.reactants[0])!;
      const b = indexOf.get(term.reaction.reactants[1])!;
      const rate = term.k * y[a]! * y[b]!;
      for (let species = 0; species < dy.length; species++) {
        dy[species] += term.delta[species]! * rate;
      }
    }
    return dy;
  };

  const jacobian = (_time: number, y: readonly number[]): number[][] => {
    const n = MARS_INORGANIC_SPECIES_ORDER.length;
    const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const term of prepared) {
      const a = indexOf.get(term.reaction.reactants[0])!;
      const b = indexOf.get(term.reaction.reactants[1])!;
      const drDa = term.k * y[b]!;
      const drDb = term.k * y[a]!;
      for (let species = 0; species < n; species++) {
        const delta = term.delta[species]!;
        matrix[species]![a] += delta * drDa;
        matrix[species]![b] += delta * drDb;
      }
    }
    return matrix;
  };

  const problem: OdeSolverProblem = {
    kind: 'ode',
    stateDimension: MARS_INORGANIC_SPECIES_ORDER.length,
    t0: 0,
    tEnd: input.durationSeconds,
    y0,
    rhs,
    jacobian,
    nonNegativeIndices: MARS_INORGANIC_SPECIES_ORDER.map((_, index) => index),
    linearInvariants: buildLinearInvariants(y0),
    description:
      'Taysum & Palmer (2020) Table B1 24-channel bimolecular subset; T=' +
      input.temperatureK + ' K; dt=' + input.durationSeconds + ' s'
  };

  let solved: OdeSolverResult;
  try {
    solved = solveOdeWithRadauIia(problem, {
      rtol: 1e-8,
      atol: 1e-12,
      ...(input.solverOptions ?? {})
    });
  } catch (error) {
    throw new MarsInorganicMechanismError(
      'integration_failure',
      'Radau IIA rejected the full gas-phase integration; no partial result was committed: ' +
        (error instanceof Error ? error.message : String(error))
    );
  }

  const finalConcentrations = Object.fromEntries(
    MARS_INORGANIC_SPECIES_ORDER.map((speciesId, index) => [speciesId, solved.y[index]!])
  ) as Record<MarsInorganicSpeciesId, number>;
  const initialElements = elementalTotals(y0);
  const finalElements = elementalTotals(solved.y);
  const elementBudgets: MarsInorganicElementBudget[] = (['C', 'H', 'O'] as const).map((element) => {
    const initial = initialElements[element];
    const final = finalElements[element];
    const drift = final - initial;
    return {
      element,
      initialParticlesPerCm3: initial,
      finalParticlesPerCm3: final,
      absoluteDriftParticlesPerCm3: drift,
      relativeDrift: drift / Math.max(Math.abs(initial), Number.MIN_VALUE)
    };
  });

  return {
    status: 'applied',
    modelScope: 'taysum_2020_table_b1_bimolecular_subset',
    temperatureK: input.temperatureK,
    durationSeconds: input.durationSeconds,
    reactionIds: [...input.reactionIds],
    concentrationsPerCm3: { ...rawConcentrations },
    finalConcentrationsPerCm3: finalConcentrations,
    reactions: prepared.map((term) => ({
      reactionId: term.reaction.id,
      tableKey: term.reaction.tableKey,
      reaction: term.reaction.label,
      rateConstantCm3PerMoleculePerS: term.k,
      initialEventRatePerCm3PerS: term.initialEventRate,
      rateProvenance: { ...term.rateProvenance },
      reactantConcentrationProvenance: { ...term.reactantConcentrationProvenance }
    })),
    elementBudgets,
    integration: {
      method: solved.method,
      result: solved
    },
    limitations: [
      'Only 24 explicitly parameterized Table B1 bimolecular channels are integrated; seven CO2-bath-gas termolecular channels and e1 without a printed temperature law remain excluded.',
      'Table B1 provides no per-reaction temperature interval or numerical rate uncertainty; uncertainty is not quantified and arbitrary-temperature validity is not claimed.',
      'Photolysis Table B2 is not coupled to this gas-phase ODE network; no radiation/solar-geometry forcing is inferred.',
      'All 16 initial species concentrations and their provenance are explicit caller inputs; this module does not produce or normalize planetary initial inventories.',
      'No vertical transport, thermal feedback, condensation, Scheduler/world mutation or planetary integration is performed.'
    ]
  };
}
