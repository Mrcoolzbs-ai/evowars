import type { DataProvenance } from '../Core/scientificValue';

// ============================================
// MARS INORGANIC GAS-PHASE REACTIONS — Taysum & Palmer (2020), Table B1
// ============================================
//
// Scope: only Table B1 reactions with an explicit bimolecular rate law.
// The paper's 1-D Mars submodule also contains termolecular reactions;
// those are deliberately excluded until CO2 bath-gas efficiencies and
// a compatible third-body contract are represented. One bimolecular row
// (e1) is excluded because Table B1 does not provide its rate expression.
// This is a source-backed reference mechanism, not a complete Mars network.

export type MarsInorganicSpeciesId =
  | 'O'
  | 'O1D'
  | 'O2'
  | 'O3'
  | 'H'
  | 'OH'
  | 'HO2'
  | 'H2'
  | 'H2O'
  | 'H2O2'
  | 'CO'
  | 'CO2'
  | 'CH4'
  | 'CH3'
  | 'CH3O'
  | 'HCHO';

export interface MarsInorganicStoichiometricTerm {
  readonly speciesId: MarsInorganicSpeciesId;
  readonly coefficient: number;
}

export interface MarsInorganicArrheniusRate {
  /** k(T) = A × exp(C/T), with A in cm3 molecule-1 s-1 and C in K. */
  readonly preExponentialA: number;
  readonly exponentNumeratorK: number;
  readonly unit: 'cm3 molecule-1 s-1';
  readonly publishedRateAt298K: number;
}

export interface MarsInorganicBimolecularReaction {
  readonly id: string;
  readonly tableKey: string;
  readonly label: string;
  /** Rate law uses [reactants[0]] × [reactants[1]]; repeated reactants are allowed. */
  readonly reactants: readonly [MarsInorganicSpeciesId, MarsInorganicSpeciesId];
  readonly products: readonly MarsInorganicStoichiometricTerm[];
  readonly rate: MarsInorganicArrheniusRate;
  readonly primaryReference: string;
  readonly provenance: DataProvenance;
}

const articleProvenance = (
  tableKey: string,
  primaryReference: string
): DataProvenance => ({
  sourceName: 'Taysum & Palmer (2020), Table B1, inorganic Martian photochemistry',
  sourceId: 'Taysum2020-Table-B1-' + tableKey,
  datasetId: 'DOI:10.1029/2020JE006491',
  recordId: tableKey,
  reference: 'https://doi.org/10.1029/2020JE006491',
  retrievedAt: '2026-11-24',
  method: 'Rate expression transcribed from the published Table B1; independent 298 K table value retained for regression verification',
  applicability: 'Part of the authors’ 1-D Martian photochemistry submodule; the paper studies the atmosphere from the surface to approximately 70 km. Table B1 does not specify a per-reaction numeric temperature interval.',
  limitations: 'Published rate uncertainty is not tabulated per reaction here. No extrapolation or scheduler coupling is implied. Third-body reactions are excluded from this module.',
  note: 'Primary reference cited for this Table B1 row: ' + primaryReference
});

function bimolecular(
  tableKey: string,
  label: string,
  reactants: readonly [MarsInorganicSpeciesId, MarsInorganicSpeciesId],
  products: readonly MarsInorganicStoichiometricTerm[],
  A: number,
  C: number,
  rateAt298: number,
  primaryReference: string
): MarsInorganicBimolecularReaction {
  return {
    id: 'taysum2020-b1-' + tableKey,
    tableKey,
    label,
    reactants,
    products,
    rate: {
      preExponentialA: A,
      exponentNumeratorK: C,
      unit: 'cm3 molecule-1 s-1',
      publishedRateAt298K: rateAt298
    },
    primaryReference,
    provenance: articleProvenance(tableKey, primaryReference)
  };
}

/** 24 explicit bimolecular rate laws from Table B1. No rate is synthesized. */
export const MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS: readonly MarsInorganicBimolecularReaction[] = [
  bimolecular('a3', 'O + O3 → O2 + O2',
    ['O', 'O3'], [{ speciesId: 'O2', coefficient: 2 }],
    8.00e-13, -2060, 7.96e-16, 'Sander et al. (2003)'),

  bimolecular('b1', 'O(1D) + CO2 → O + CO2',
    ['O1D', 'CO2'], [
      { speciesId: 'O', coefficient: 1 },
      { speciesId: 'CO2', coefficient: 1 }
    ], 7.40e-11, 120, 1.11e-10, 'Sander et al. (2003)'),
  bimolecular('b2', 'O(1D) + H2O → OH + OH',
    ['O1D', 'H2O'], [{ speciesId: 'OH', coefficient: 2 }],
    1.63e-10, 60, 1.99e-10, 'Sander et al. (2006)'),
  bimolecular('b3', 'O(1D) + H2 → OH + H',
    ['O1D', 'H2'], [
      { speciesId: 'OH', coefficient: 1 },
      { speciesId: 'H', coefficient: 1 }
    ], 1.20e-10, 0, 1.20e-10, 'Sander et al. (2011)'),
  bimolecular('b4', 'O(1D) + O2 → O + O2',
    ['O1D', 'O2'], [
      { speciesId: 'O', coefficient: 1 },
      { speciesId: 'O2', coefficient: 1 }
    ], 3.30e-11, 55, 3.97e-11, 'Sander et al. (2006)'),
  bimolecular('b5', 'O(1D) + O3 → O2 + O2',
    ['O1D', 'O3'], [{ speciesId: 'O2', coefficient: 2 }],
    1.20e-11, 0, 1.20e-11, 'Sander et al. (2003)'),
  bimolecular('b6', 'O(1D) + O3 → O2 + O + O',
    ['O1D', 'O3'], [
      { speciesId: 'O2', coefficient: 1 },
      { speciesId: 'O', coefficient: 2 }
    ], 1.20e-11, 0, 1.20e-11, 'Sander et al. (2003)'),
  bimolecular('b7', 'O(1D) + CH4 → CH3 + OH',
    ['O1D', 'CH4'], [
      { speciesId: 'CH3', coefficient: 1 },
      { speciesId: 'OH', coefficient: 1 }
    ], 0.75 * 1.75e-10, 0, 1.31e-10, 'Sander et al. (2003)'),
  bimolecular('b8', 'O(1D) + CH4 → CH3O + H',
    ['O1D', 'CH4'], [
      { speciesId: 'CH3O', coefficient: 1 },
      { speciesId: 'H', coefficient: 1 }
    ], 0.20 * 1.75e-10, 0, 3.50e-11, 'Sander et al. (2003)'),
  bimolecular('b9', 'O(1D) + CH4 → HCHO + H2',
    ['O1D', 'CH4'], [
      { speciesId: 'HCHO', coefficient: 1 },
      { speciesId: 'H2', coefficient: 1 }
    ], 0.05 * 1.75e-10, 0, 8.75e-12, 'Sander et al. (2003)'),

  bimolecular('c1', 'O + HO2 → OH + O2',
    ['O', 'HO2'], [
      { speciesId: 'OH', coefficient: 1 },
      { speciesId: 'O2', coefficient: 1 }
    ], 3.00e-11, 200, 5.87e-11, 'Sander et al. (2003)'),
  bimolecular('c2', 'O + OH → O2 + H',
    ['O', 'OH'], [
      { speciesId: 'O2', coefficient: 1 },
      { speciesId: 'H', coefficient: 1 }
    ], 1.80e-11, 180, 3.29e-11, 'Sander et al. (2011)'),
  bimolecular('c3', 'H + O3 → OH + O2',
    ['H', 'O3'], [
      { speciesId: 'OH', coefficient: 1 },
      { speciesId: 'O2', coefficient: 1 }
    ], 1.40e-10, -470, 2.89e-11, 'Sander et al. (2003)'),
  bimolecular('c4', 'H + HO2 → OH + OH',
    ['H', 'HO2'], [{ speciesId: 'OH', coefficient: 2 }],
    7.20e-11, 0, 7.20e-11, 'Sander et al. (2006)'),
  bimolecular('c5', 'H + HO2 → H2 + O2',
    ['H', 'HO2'], [
      { speciesId: 'H2', coefficient: 1 },
      { speciesId: 'O2', coefficient: 1 }
    ], 6.90e-12, 0, 6.90e-12, 'Sander et al. (2006)'),
  bimolecular('c6', 'H + HO2 → H2O + O',
    ['H', 'HO2'], [
      { speciesId: 'H2O', coefficient: 1 },
      { speciesId: 'O', coefficient: 1 }
    ], 1.60e-12, 0, 1.60e-12, 'Sander et al. (2006)'),
  bimolecular('c7', 'OH + HO2 → H2O + O2',
    ['OH', 'HO2'], [
      { speciesId: 'H2O', coefficient: 1 },
      { speciesId: 'O2', coefficient: 1 }
    ], 4.80e-11, 250, 1.11e-10, 'Sander et al. (2003)'),
  bimolecular('c8', 'HO2 + HO2 → H2O2 + O2',
    ['HO2', 'HO2'], [
      { speciesId: 'H2O2', coefficient: 1 },
      { speciesId: 'O2', coefficient: 1 }
    ], 1.50e-12, 19, 1.60e-12, 'Christensen et al. (2002)'),
  bimolecular('c9', 'OH + H2O2 → H2O + HO2',
    ['OH', 'H2O2'], [
      { speciesId: 'H2O', coefficient: 1 },
      { speciesId: 'HO2', coefficient: 1 }
    ], 1.80e-12, 0, 1.80e-12, 'Sander et al. (2006)'),
  bimolecular('c10', 'OH + H2 → H2O + H',
    ['OH', 'H2'], [
      { speciesId: 'H2O', coefficient: 1 },
      { speciesId: 'H', coefficient: 1 }
    ], 2.80e-12, -1800, 6.67e-15, 'Sander et al. (2006)'),
  bimolecular('c12', 'O + H2O2 → OH + HO2',
    ['O', 'H2O2'], [
      { speciesId: 'OH', coefficient: 1 },
      { speciesId: 'HO2', coefficient: 1 }
    ], 1.40e-12, -2000, 1.70e-15, 'Sander et al. (2003)'),
  bimolecular('c13', 'OH + OH → H2O + O',
    ['OH', 'OH'], [
      { speciesId: 'H2O', coefficient: 1 },
      { speciesId: 'O', coefficient: 1 }
    ], 1.80e-12, 0, 1.80e-12, 'Sander et al. (2006)'),
  bimolecular('c14', 'OH + O3 → HO2 + O2',
    ['OH', 'O3'], [
      { speciesId: 'HO2', coefficient: 1 },
      { speciesId: 'O2', coefficient: 1 }
    ], 1.50e-12, -880, 7.83e-14, 'Sander et al. (2003)'),
  bimolecular('c15', 'HO2 + O3 → OH + O2 + O2',
    ['HO2', 'O3'], [
      { speciesId: 'OH', coefficient: 1 },
      { speciesId: 'O2', coefficient: 2 }
    ], 1.00e-14, -490, 1.93e-15, 'Sander et al. (2003)')
] as const;

/** B1 records not executed in this bimolecular slice; kept explicit for coverage audits. */
export const MARS_TAYSUM_2020_INORGANIC_EXCLUDED_REACTIONS = [
  {
    tableKey: 'a1',
    label: 'O + O2 + M → O3 + M',
    reason: 'termolecular_CO2_bath_gas_not_modelled',
    rawRateExpression: '2.075 × 6.00E-34(T/300)^(-2.4)',
    note: 'The article states that all termolecular coefficients are multiplied by 2.5 for the enhanced CO2 bath-gas efficiency; the current kinetic mechanism contract uses an explicit N2 third body.'
  },
  {
    tableKey: 'a2',
    label: 'O + O + M → O2 + M',
    reason: 'termolecular_CO2_bath_gas_not_modelled',
    rawRateExpression: '2.50 × 9.46E-34 exp(485/T)'
  },
  {
    tableKey: 'c11',
    label: 'H + O2 + M → HO2 + M',
    reason: 'termolecular_CO2_bath_gas_not_modelled',
    rawRateExpression: 'k_3rd(2.5 × 4.4E-32, -1.3, 7.5E-11, 0.2)'
  },
  {
    tableKey: 'c16',
    label: 'HO2 + HO2 + M → H2O2 + O2 + M',
    reason: 'termolecular_CO2_bath_gas_not_modelled',
    rawRateExpression: '2.50 × 2.10E-33 exp(920/T)'
  },
  {
    tableKey: 'c17',
    label: 'OH + OH + M → H2O2 + M',
    reason: 'termolecular_CO2_bath_gas_not_modelled',
    rawRateExpression: 'k_3rd(2.5 × 6.9E-31, -1, 2.60E-11, 0)'
  },
  {
    tableKey: 'c18',
    label: 'H + H + M → H2 + M',
    reason: 'termolecular_CO2_bath_gas_not_modelled',
    rawRateExpression: '2.5 × 1.80E-30/T'
  },
  {
    tableKey: 'e1',
    label: 'OH + CO → CO2 + H',
    reason: 'rate_law_not_tabulated',
    rawRateExpression: null,
    note: 'Table B1 only says “Details in Joshi and Wang (2006)” and lists a value at 298 K; the temperature-dependent rate law is not supplied in this table.'
  },
  {
    tableKey: 'e2',
    label: 'O + CO + M → CO2 + M',
    reason: 'termolecular_CO2_bath_gas_not_modelled',
    rawRateExpression: '2.5 × 6.50E-33 exp(-2184/T)'
  }
] as const;

export interface MarsInorganicReactionEvaluationInput {
  readonly reactionId: string;
  readonly temperatureK: number;
  /** Explicit local number density for every reactant, particles cm^-3. */
  readonly concentrationsPerCm3: Readonly<Partial<Record<MarsInorganicSpeciesId, number>>>;
  /** Separate source for each reactant concentration. */
  readonly concentrationProvenance: Readonly<Partial<Record<MarsInorganicSpeciesId, DataProvenance>>>;
}

export interface MarsInorganicReactionEvaluation {
  readonly status: 'evaluated';
  readonly reactionId: string;
  readonly tableKey: string;
  readonly reaction: string;
  readonly temperatureK: number;
  readonly rateConstantCm3PerMoleculePerS: number;
  readonly eventRatePerCm3PerS: number;
  readonly netSpeciesRatesPerCm3PerS: Readonly<Partial<Record<MarsInorganicSpeciesId, number>>>;
  readonly formula: 'k(T) = A × exp(C/T); eventRate = k × [A] × [B]';
  readonly rateProvenance: DataProvenance;
  readonly concentrationProvenance: Readonly<Partial<Record<MarsInorganicSpeciesId, DataProvenance>>>;
  readonly uncertaintyStatus: 'not_quantified';
  readonly schedulerEligible: false;
  readonly applicabilityWarning: string;
}

export interface MarsInorganicReactionEvaluationRejection {
  readonly status: 'rejected';
  readonly reason:
    | 'invalid_input'
    | 'unknown_reaction'
    | 'invalid_temperature'
    | 'missing_concentration'
    | 'invalid_concentration'
    | 'missing_concentration_provenance'
    | 'numerical_failure';
  readonly speciesId?: MarsInorganicSpeciesId;
}

export type MarsInorganicReactionEvaluationResult =
  | MarsInorganicReactionEvaluation
  | MarsInorganicReactionEvaluationRejection;

function hasIdentifiedProvenance(value: unknown): value is DataProvenance {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const p = value as Record<string, unknown>;
  const reference = p.reference ?? p.sourceId ?? p.datasetId ?? p.recordId;
  return typeof p.sourceName === 'string' && p.sourceName.trim() !== '' &&
    typeof reference === 'string' && reference.trim() !== '';
}

/** Evaluate one published bimolecular channel; no inventory conversion, integration or Scheduler mutation. */
export function evaluateMarsInorganicBimolecularReaction(
  input: MarsInorganicReactionEvaluationInput
): MarsInorganicReactionEvaluationResult {
  if (
    typeof input !== 'object' || input === null || Array.isArray(input) ||
    typeof input.concentrationsPerCm3 !== 'object' || input.concentrationsPerCm3 === null ||
    Array.isArray(input.concentrationsPerCm3) ||
    typeof input.concentrationProvenance !== 'object' || input.concentrationProvenance === null ||
    Array.isArray(input.concentrationProvenance)
  ) {
    return { status: 'rejected', reason: 'invalid_input' };
  }

  const reaction = MARS_TAYSUM_2020_INORGANIC_BIMOLECULAR_REACTIONS.find(
    (candidate) => candidate.id === input.reactionId
  );
  if (reaction === undefined) return { status: 'rejected', reason: 'unknown_reaction' };

  if (!Number.isFinite(input.temperatureK) || input.temperatureK <= 0) {
    return { status: 'rejected', reason: 'invalid_temperature' };
  }

  const usedConcentrationProvenance: Partial<Record<MarsInorganicSpeciesId, DataProvenance>> = {};
  const reactantConcentrations: number[] = [];
  for (const speciesId of reaction.reactants) {
    if (!Object.prototype.hasOwnProperty.call(input.concentrationsPerCm3, speciesId)) {
      return { status: 'rejected', reason: 'missing_concentration', speciesId };
    }
    const concentration = input.concentrationsPerCm3[speciesId];
    if (typeof concentration !== 'number' || !Number.isFinite(concentration) || concentration < 0) {
      return { status: 'rejected', reason: 'invalid_concentration', speciesId };
    }
    const provenance = input.concentrationProvenance[speciesId];
    if (!hasIdentifiedProvenance(provenance)) {
      return { status: 'rejected', reason: 'missing_concentration_provenance', speciesId };
    }
    reactantConcentrations.push(concentration);
    usedConcentrationProvenance[speciesId] = { ...provenance };
  }

  const rateConstant =
    reaction.rate.preExponentialA *
    Math.exp(reaction.rate.exponentNumeratorK / input.temperatureK);
  const eventRate = rateConstant * reactantConcentrations[0]! * reactantConcentrations[1]!;
  if (!Number.isFinite(rateConstant) || rateConstant <= 0 || !Number.isFinite(eventRate)) {
    return { status: 'rejected', reason: 'numerical_failure' };
  }

  const net: Partial<Record<MarsInorganicSpeciesId, number>> = {};
  for (const speciesId of new Set([...reaction.reactants, ...reaction.products.map((p) => p.speciesId)])) {
    const reactantStoich = reaction.reactants.filter((id) => id === speciesId).length;
    const productStoich = reaction.products
      .filter((product) => product.speciesId === speciesId)
      .reduce((sum, product) => sum + product.coefficient, 0);
    net[speciesId] = (productStoich - reactantStoich) * eventRate;
  }

  return {
    status: 'evaluated',
    reactionId: reaction.id,
    tableKey: reaction.tableKey,
    reaction: reaction.label,
    temperatureK: input.temperatureK,
    rateConstantCm3PerMoleculePerS: rateConstant,
    eventRatePerCm3PerS: eventRate,
    netSpeciesRatesPerCm3PerS: net,
    formula: 'k(T) = A × exp(C/T); eventRate = k × [A] × [B]',
    rateProvenance: { ...reaction.provenance },
    concentrationProvenance: usedConcentrationProvenance,
    uncertaintyStatus: 'not_quantified',
    schedulerEligible: false,
    applicabilityWarning:
      'Только source-backed bimolecular rate law из Taysum & Palmer 2020 Table B1; таблица не публикует per-reaction T-range или 1σ для k. Трёхтельные каналы CO2-bath-gas и e1 без полного rate law исключены. Результат не является Scheduler-ready.'
  };
}
