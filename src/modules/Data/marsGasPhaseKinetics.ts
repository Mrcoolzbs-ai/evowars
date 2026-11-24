import type { DataProvenance } from '../Core/scientificValue';

// ============================================
// MARS GAS-PHASE KINETICS — Taysum & Palmer (2020), Appendix Table B1
// ============================================
//
// 32 source table records are represented: 29 have explicit Arrhenius
// expressions, 2 use a special k_3rd fall-off expression whose CO2
// efficiency convention is ambiguous across the reproduced formula,
// and 1 (e1) is only provided as a single 298 K value with no formula.
// Unsupported entries are preserved, never guessed.
//
// On Mars CO2 is the bath gas. For direct termolecular Arrhenius rows,
// the source's CO2 collision-efficiency multiplier (2.5, or 2.075 for
// a1) is already included in the stored pre-exponential coefficient.
// The caller must still supply the actual local [CO2] explicitly.
// No pressure-to-density conversion or inferred CO2 inventory occurs.

export type MarsGasSpeciesId =
  | 'O' | 'O1D' | 'O2' | 'O3'
  | 'CO2' | 'CO' | 'H' | 'H2' | 'H2O' | 'OH'
  | 'HO2' | 'H2O2'
  | 'CH4' | 'CH3' | 'CH3O' | 'HCHO';

export interface MarsGasStoichiometricTerm {
  readonly speciesId: MarsGasSpeciesId;
  readonly coefficient: number;
}

export type MarsGasRateExpression =
  | {
      readonly kind: 'arrhenius';
      /** k = A * (T / temperatureScaleK)^n * exp(exponentialTemperatureK / T). */
      readonly preExponentialA: number;
      readonly temperatureExponentN: number;
      readonly temperatureScaleK: number;
      /** Signed B in exp(B/T); positive B means a negative activation energy. */
      readonly exponentialTemperatureK: number;
      readonly unit: 'cm3_molecule_s';
    }
  | {
      readonly kind: 'termolecular_arrhenius';
      /** k0 = A * (T / temperatureScaleK)^n * exp(B/T), before multiplication by [CO2]. */
      readonly preExponentialA: number;
      readonly temperatureExponentN: number;
      readonly temperatureScaleK: number;
      readonly exponentialTemperatureK: number;
      readonly unit: 'cm6_molecule2_s';
      readonly bathGas: 'CO2';
      readonly efficiencyMultiplierIncludedInA: number;
    }
  | {
      readonly kind: 'falloff_not_evaluated';
      readonly publishedFormula: string;
      readonly reason: string;
      readonly bathGas: 'CO2';
    }
  | {
      readonly kind: 'single_temperature_value';
      readonly temperatureK: 298;
      readonly rateConstant: number;
      readonly unit: 'cm3_molecule_s';
      readonly limitation: string;
    };

export interface MarsGasPhaseReaction {
  readonly id: string;
  readonly label: string;
  readonly reactants: readonly MarsGasStoichiometricTerm[];
  readonly products: readonly MarsGasStoichiometricTerm[];
  /** Third body is not a stoichiometrically consumed species. */
  readonly thirdBody: 'CO2' | null;
  readonly rateExpression: MarsGasRateExpression;
  readonly citedRateSource: string;
  readonly taysumTable: 'B1';
  readonly sourceReference: 'https://doi.org/10.1029/2020JE006491';
  readonly publishedRateAt298?: number;
  readonly publishedRateAt298Unit?: 'cm3_molecule_s' | 'effective_cm3_molecule_s';
}

export const MARS_TAYSUM_2020_GAS_PHASE_PROVENANCE: DataProvenance = {
  sourceName: 'Taysum & Palmer (2020), Photochemistry of Methane and Ethane in the Martian Atmosphere',
  sourceId: 'DOI:10.1029/2020JE006491',
  datasetId: 'Taysum2020-Appendix-Table-B1',
  reference: 'https://doi.org/10.1029/2020JE006491',
  retrievedAt: '2026-11-24',
  method: 'Transcription of the 32 gas-phase inorganic reaction records in Appendix Table B1, preserving the published Arrhenius expressions and source attribution',
  applicability: 'Mars 1-D photochemistry model reaction scheme. The table gives no universal per-reaction temperature validity intervals; only e1 is explicitly restricted here to its single tabulated temperature of 298 K.',
  conditions: 'CO2 is the bath gas in the Mars model. Direct termolecular Arrhenius pre-exponentials include the source collision efficiency 2.5, except a1 which uses 2.075. Local CO2 number density remains an explicit caller input.',
  limitations: 'Table B1 provides no numerical 1-sigma uncertainties for the rates. c11 and c17 use k_3rd fall-off notation but no unambiguous implementation convention is imported because the 2.5 CO2 efficiency appears both in the tabulated arguments and in the reproduced k_3rd equation. e1 provides only one value at 298 K and no temperature formula. No Scheduler/ODE network is activated by this catalogue.',
  note: 'The catalogue contains 32 rows: 29 executable Arrhenius expressions, 2 explicitly preserved but unevaluated fall-off rows, and one 298 K-only rate value. These counts refer only to Appendix Table B1.'
};

const SOURCE = 'https://doi.org/10.1029/2020JE006491' as const;
const base = (id: string) => ({
  id,
  sourceReference: SOURCE,
  taysumTable: 'B1' as const
});

function bimolecular(
  id: string,
  label: string,
  reactants: readonly MarsGasStoichiometricTerm[],
  products: readonly MarsGasStoichiometricTerm[],
  a: number,
  n: number,
  scale: number,
  b: number,
  citedRateSource: string,
  publishedRateAt298?: number
): MarsGasPhaseReaction {
  return {
    ...base(id),
    label,
    reactants,
    products,
    thirdBody: null,
    rateExpression: {
      kind: 'arrhenius',
      preExponentialA: a,
      temperatureExponentN: n,
      temperatureScaleK: scale,
      exponentialTemperatureK: b,
      unit: 'cm3_molecule_s'
    },
    citedRateSource,
    ...(publishedRateAt298 === undefined ? {} : {
      publishedRateAt298,
      publishedRateAt298Unit: 'cm3_molecule_s' as const
    })
  };
}

function termolecular(
  id: string,
  label: string,
  reactants: readonly MarsGasStoichiometricTerm[],
  products: readonly MarsGasStoichiometricTerm[],
  a: number,
  n: number,
  scale: number,
  b: number,
  efficiencyMultiplierIncludedInA: number,
  citedRateSource: string,
  publishedRateAt298?: number
): MarsGasPhaseReaction {
  return {
    ...base(id),
    label,
    reactants,
    products,
    thirdBody: 'CO2',
    rateExpression: {
      kind: 'termolecular_arrhenius',
      preExponentialA: a,
      temperatureExponentN: n,
      temperatureScaleK: scale,
      exponentialTemperatureK: b,
      unit: 'cm6_molecule2_s',
      bathGas: 'CO2',
      efficiencyMultiplierIncludedInA
    },
    citedRateSource,
    ...(publishedRateAt298 === undefined ? {} : {
      publishedRateAt298,
      publishedRateAt298Unit: 'effective_cm3_molecule_s' as const
    })
  };
}

function falloff(
  id: string,
  label: string,
  reactants: readonly MarsGasStoichiometricTerm[],
  products: readonly MarsGasStoichiometricTerm[],
  publishedFormula: string,
  citedRateSource: string,
  publishedRateAt298: number
): MarsGasPhaseReaction {
  return {
    ...base(id),
    label,
    reactants,
    products,
    thirdBody: 'CO2',
    rateExpression: {
      kind: 'falloff_not_evaluated',
      publishedFormula,
      bathGas: 'CO2',
      reason: 'The paper reproduces a k_3rd expression with the factor 2.5 in the arguments, while the referenced Mars-model equation also applies the CO2 efficiency factor 2.5. The source text does not unambiguously resolve whether the factor is already folded into the k0 argument for this record; no double-counting or guessed interpretation is allowed.'
    },
    citedRateSource,
    publishedRateAt298,
    publishedRateAt298Unit: 'effective_cm3_molecule_s'
  };
}

const t = (speciesId: MarsGasSpeciesId, coefficient = 1): MarsGasStoichiometricTerm => ({
  speciesId,
  coefficient
});

/** The 32 gas-phase records in Appendix Table B1, in source order. */
export const MARS_TAYSUM_2020_GAS_PHASE_REACTIONS: readonly MarsGasPhaseReaction[] = [
  // Reactions with O
  termolecular('a1', 'O + O2 + CO2 → O3 + CO2',
    [t('O'), t('O2')], [t('O3')],
    2.075 * 6.00e-34, -2.4, 300, 0, 2.075, 'Sander et al. (2003)', 2.23e-16),
  termolecular('a2', 'O + O + CO2 → O2 + CO2',
    [t('O', 2)], [t('O2')],
    2.50 * 9.46e-34, 0, 300, 485, 2.5, 'Campbell & Gray (1973)', 2.10e-15),
  bimolecular('a3', 'O + O3 → O2 + O2',
    [t('O'), t('O3')], [t('O2', 2)],
    8.00e-13, 0, 300, -2060, 'Sander et al. (2003)', 7.96e-16),

  // Reactions with O(1D)
  bimolecular('b1', 'O(1D) + CO2 → O + CO2',
    [t('O1D'), t('CO2')], [t('O'), t('CO2')],
    7.40e-11, 0, 300, 120, 'Sander et al. (2003)', 1.11e-10),
  bimolecular('b2', 'O(1D) + H2O → OH + OH',
    [t('O1D'), t('H2O')], [t('OH', 2)],
    1.63e-10, 0, 300, 60, 'Sander et al. (2006)', 1.99e-10),
  bimolecular('b3', 'O(1D) + H2 → OH + H',
    [t('O1D'), t('H2')], [t('OH'), t('H')],
    1.20e-10, 0, 300, 0, 'Sander et al. (2011)', 1.20e-10),
  bimolecular('b4', 'O(1D) + O2 → O + O2',
    [t('O1D'), t('O2')], [t('O'), t('O2')],
    3.30e-11, 0, 300, 55, 'Sander et al. (2006)', 3.97e-11),
  bimolecular('b5', 'O(1D) + O3 → O2 + O2',
    [t('O1D'), t('O3')], [t('O2', 2)],
    1.20e-11, 0, 300, 0, 'Sander et al. (2003)', 1.20e-11),
  bimolecular('b6', 'O(1D) + O3 → O2 + O + O',
    [t('O1D'), t('O3')], [t('O2'), t('O', 2)],
    1.20e-11, 0, 300, 0, 'Sander et al. (2003)', 1.20e-11),
  bimolecular('b7', 'O(1D) + CH4 → CH3 + OH',
    [t('O1D'), t('CH4')], [t('CH3'), t('OH')],
    0.75 * 1.75e-10, 0, 300, 0, 'Sander et al. (2003)', 1.31e-10),
  bimolecular('b8', 'O(1D) + CH4 → CH3O + H',
    [t('O1D'), t('CH4')], [t('CH3O'), t('H')],
    0.20 * 1.75e-10, 0, 300, 0, 'Sander et al. (2003)', 3.50e-11),
  bimolecular('b9', 'O(1D) + CH4 → HCHO + H2',
    [t('O1D'), t('CH4')], [t('HCHO'), t('H2')],
    0.05 * 1.75e-10, 0, 300, 0, 'Sander et al. (2003)', 8.75e-12),

  // Reactions with hydrogen compounds
  bimolecular('c1', 'O + HO2 → OH + O2',
    [t('O'), t('HO2')], [t('OH'), t('O2')],
    3.00e-11, 0, 300, 200, 'Sander et al. (2003)', 5.87e-11),
  bimolecular('c2', 'O + OH → O2 + H',
    [t('O'), t('OH')], [t('O2'), t('H')],
    1.80e-11, 0, 300, 180, 'Sander et al. (2011)', 3.29e-11),
  bimolecular('c3', 'H + O3 → OH + O2',
    [t('H'), t('O3')], [t('OH'), t('O2')],
    1.40e-10, 0, 300, -470, 'Sander et al. (2003)', 2.89e-11),
  bimolecular('c4', 'H + HO2 → OH + OH',
    [t('H'), t('HO2')], [t('OH', 2)],
    7.20e-11, 0, 300, 0, 'Sander et al. (2006)', 7.20e-11),
  bimolecular('c5', 'H + HO2 → H2 + O2',
    [t('H'), t('HO2')], [t('H2'), t('O2')],
    6.90e-12, 0, 300, 0, 'Sander et al. (2006)', 6.90e-12),
  bimolecular('c6', 'H + HO2 → H2O + O',
    [t('H'), t('HO2')], [t('H2O'), t('O')],
    1.60e-12, 0, 300, 0, 'Sander et al. (2006)', 1.60e-12),
  bimolecular('c7', 'OH + HO2 → H2O + O2',
    [t('OH'), t('HO2')], [t('H2O'), t('O2')],
    4.80e-11, 0, 300, 250, 'Sander et al. (2003)', 1.11e-10),
  bimolecular('c8', 'HO2 + HO2 → H2O2 + O2',
    [t('HO2', 2)], [t('H2O2'), t('O2')],
    1.50e-12, 0, 300, 19, 'Christensen et al. (2002)', 1.60e-12),
  bimolecular('c9', 'OH + H2O2 → H2O + HO2',
    [t('OH'), t('H2O2')], [t('H2O'), t('HO2')],
    1.80e-12, 0, 300, 0, 'Sander et al. (2006)', 1.80e-12),
  bimolecular('c10', 'OH + H2 → H2O + H',
    [t('OH'), t('H2')], [t('H2O'), t('H')],
    2.80e-12, 0, 300, -1800, 'Sander et al. (2006)', 6.67e-15),
  falloff('c11', 'H + O2 + CO2 → HO2 + CO2',
    [t('H'), t('O2')], [t('HO2')],
    'k_3rd(2.5 × 4.4E-32, -1.3, 7.5E-11, 0.2)',
    'Sander et al. (2011)', 1.88e-14),
  bimolecular('c12', 'O + H2O2 → OH + HO2',
    [t('O'), t('H2O2')], [t('OH'), t('HO2')],
    1.40e-12, 0, 300, -2000, 'Sander et al. (2003)', 1.70e-15),
  bimolecular('c13', 'OH + OH → H2O + O',
    [t('OH', 2)], [t('H2O'), t('O')],
    1.80e-12, 0, 300, 0, 'Sander et al. (2006)', 1.80e-12),
  bimolecular('c14', 'OH + O3 → HO2 + O2',
    [t('OH'), t('O3')], [t('HO2'), t('O2')],
    1.50e-12, 0, 300, -880, 'Sander et al. (2003)', 7.83e-14),
  bimolecular('c15', 'HO2 + O3 → OH + O2 + O2',
    [t('HO2'), t('O3')], [t('OH'), t('O2', 2)],
    1.00e-14, 0, 300, -490, 'Sander et al. (2003)', 1.93e-15),
  termolecular('c16', 'HO2 + HO2 + CO2 → H2O2 + O2 + CO2',
    [t('HO2', 2)], [t('H2O2'), t('O2')],
    2.50 * 2.10e-33, 0, 300, 920, 2.5, 'Sander et al. (2011)', 2.01e-14),
  falloff('c17', 'OH + OH + CO2 → H2O2 + CO2',
    [t('OH', 2)], [t('H2O2')],
    'k_3rd(2.5 × 6.9E-31, -1, 2.60E-11, 0)',
    'Sander et al. (2003)', 2.70e-13),
  termolecular('c18', 'H + H + CO2 → H2 + CO2',
    [t('H', 2)], [t('H2')],
    2.50 * 1.80e-30, -1, 1, 0, 2.5, 'Baulch et al. (2005)', 2.64e-14),

  // Carbon compounds
  {
    ...base('e1'),
    label: 'OH + CO → CO2 + H',
    reactants: [t('OH'), t('CO')],
    products: [t('CO2'), t('H')],
    thirdBody: null,
    rateExpression: {
      kind: 'single_temperature_value',
      temperatureK: 298,
      rateConstant: 1.47e-13,
      unit: 'cm3_molecule_s',
      limitation: 'Joshi & Wang (2006) details are referenced but no temperature-dependent formula or validity interval is given in Table B1; this single point is evaluated only at exactly 298 K.'
    },
    citedRateSource: 'Joshi & Wang (2006)',
    publishedRateAt298: 1.47e-13,
    publishedRateAt298Unit: 'cm3_molecule_s'
  },
  termolecular('e2', 'O + CO + CO2 → CO2 + CO2',
    [t('O'), t('CO')], [t('CO2')],
    2.50 * 6.50e-33, 0, 300, -2184, 2.5, 'Tsang & Hampson (1986)', 1.87e-18)
] as const;

export const MARS_GAS_PHASE_SPECIES_ELEMENTS: Readonly<Record<MarsGasSpeciesId, Readonly<Record<string, number>>>> = {
  O: { O: 1 },
  O1D: { O: 1 },
  O2: { O: 2 },
  O3: { O: 3 },
  CO2: { C: 1, O: 2 },
  CO: { C: 1, O: 1 },
  H: { H: 1 },
  H2: { H: 2 },
  H2O: { H: 2, O: 1 },
  OH: { O: 1, H: 1 },
  HO2: { H: 1, O: 2 },
  H2O2: { H: 2, O: 2 },
  CH4: { C: 1, H: 4 },
  CH3: { C: 1, H: 3 },
  CH3O: { C: 1, H: 3, O: 1 },
  HCHO: { C: 1, H: 2, O: 1 }
};

export function validateMarsGasPhaseReactionBalance(
  reaction: MarsGasPhaseReaction
): readonly string[] {
  const net: Record<string, number> = {};
  const add = (term: MarsGasStoichiometricTerm, sign: number): void => {
    for (const [element, count] of Object.entries(MARS_GAS_PHASE_SPECIES_ELEMENTS[term.speciesId])) {
      net[element] = (net[element] ?? 0) + sign * term.coefficient * count;
    }
  };
  for (const term of reaction.reactants) add(term, -1);
  for (const term of reaction.products) add(term, 1);
  return Object.entries(net)
    .filter(([, amount]) => amount !== 0)
    .map(([element, amount]) => element + ' balance residual ' + amount);
}

export interface MarsGasPhaseEvaluationInput {
  readonly reactionId: string;
  readonly temperatureK: number;
  /** Explicit local number densities, particles cm^-3; missing reactants are rejected. */
  readonly concentrationsPerCm3: Readonly<Partial<Record<MarsGasSpeciesId, number>>>;
  /** Explicit local CO2 bath-gas density, particles cm^-3; required by termolecular rows. */
  readonly co2ThirdBodyConcentrationPerCm3?: number;
}

export type MarsGasPhaseEvaluationResult =
  | {
      readonly status: 'evaluated';
      readonly reactionId: string;
      readonly reaction: string;
      readonly temperatureK: number;
      readonly rateConstant: number;
      readonly rateConstantUnit: 'cm3_molecule_s' | 'cm6_molecule2_s';
      /** Event rate, particles cm^-3 s^-1. */
      readonly eventRatePerCm3PerS: number;
      readonly netSpeciesRatesPerCm3PerS: Readonly<Partial<Record<MarsGasSpeciesId, number>>>;
      readonly reactantConcentrationsPerCm3: Readonly<Partial<Record<MarsGasSpeciesId, number>>>;
      readonly co2ThirdBodyConcentrationPerCm3: number | null;
      readonly uncertaintyStatus: 'not_quantified';
      readonly temperatureValidity: 'source_interval_not_published';
      readonly provenance: DataProvenance;
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'unknown_reaction'
        | 'unsupported_falloff_expression'
        | 'temperature_not_supported'
        | 'invalid_temperature'
        | 'missing_reactant_concentration'
        | 'invalid_reactant_concentration'
        | 'missing_co2_third_body'
        | 'invalid_co2_third_body'
        | 'non_finite_rate';
    };

function evaluateArrhenius(
  temperatureK: number,
  expression: Extract<MarsGasRateExpression, { kind: 'arrhenius' | 'termolecular_arrhenius' }>
): number {
  return expression.preExponentialA *
    Math.pow(temperatureK / expression.temperatureScaleK, expression.temperatureExponentN) *
    Math.exp(expression.exponentialTemperatureK / temperatureK);
}

/**
 * Evaluate one Table B1 gas-phase reaction using explicit local densities.
 * The method evaluates the published rate expression only; it is not a
 * closed atmospheric chemical network and does not alter Scheduler state.
 */
export function evaluateMarsGasPhaseReaction(
  input: MarsGasPhaseEvaluationInput
): MarsGasPhaseEvaluationResult {
  const reaction = MARS_TAYSUM_2020_GAS_PHASE_REACTIONS.find(
    (candidate) => candidate.id === input.reactionId
  );
  if (reaction === undefined) return { status: 'rejected', reason: 'unknown_reaction' };

  const expression = reaction.rateExpression;
  if (expression.kind === 'falloff_not_evaluated') {
    return { status: 'rejected', reason: 'unsupported_falloff_expression' };
  }
  if (!Number.isFinite(input.temperatureK) || input.temperatureK <= 0) {
    return { status: 'rejected', reason: 'invalid_temperature' };
  }
  if (expression.kind === 'single_temperature_value' && input.temperatureK !== expression.temperatureK) {
    return { status: 'rejected', reason: 'temperature_not_supported' };
  }

  const reactantConcentrations: Partial<Record<MarsGasSpeciesId, number>> = {};
  let reactantProduct = 1;
  for (const term of reaction.reactants) {
    const density = input.concentrationsPerCm3[term.speciesId];
    if (density === undefined) return { status: 'rejected', reason: 'missing_reactant_concentration' };
    if (!Number.isFinite(density) || density < 0) {
      return { status: 'rejected', reason: 'invalid_reactant_concentration' };
    }
    reactantConcentrations[term.speciesId] = density;
    reactantProduct *= Math.pow(density, term.coefficient);
  }

  let thirdBodyDensity: number | null = null;
  let rateConstant: number;
  let rateConstantUnit: 'cm3_molecule_s' | 'cm6_molecule2_s';
  if (expression.kind === 'single_temperature_value') {
    rateConstant = expression.rateConstant;
    rateConstantUnit = expression.unit;
  } else {
    if (expression.kind === 'termolecular_arrhenius') {
      const bathDensity = input.co2ThirdBodyConcentrationPerCm3;
      if (bathDensity === undefined) return { status: 'rejected', reason: 'missing_co2_third_body' };
      if (!Number.isFinite(bathDensity) || bathDensity < 0) {
        return { status: 'rejected', reason: 'invalid_co2_third_body' };
      }
      thirdBodyDensity = bathDensity;
    }
    rateConstant = evaluateArrhenius(input.temperatureK, expression);
    rateConstantUnit = expression.unit;
  }

  const eventRate = expression.kind === 'termolecular_arrhenius'
    ? rateConstant * reactantProduct * (thirdBodyDensity ?? 0)
    : rateConstant * reactantProduct;
  if (!Number.isFinite(rateConstant) || rateConstant <= 0 || !Number.isFinite(eventRate) || eventRate < 0) {
    return { status: 'rejected', reason: 'non_finite_rate' };
  }

  const net: Partial<Record<MarsGasSpeciesId, number>> = {};
  for (const term of reaction.reactants) {
    net[term.speciesId] = (net[term.speciesId] ?? 0) - term.coefficient * eventRate;
  }
  for (const term of reaction.products) {
    net[term.speciesId] = (net[term.speciesId] ?? 0) + term.coefficient * eventRate;
  }

  return {
    status: 'evaluated',
    reactionId: reaction.id,
    reaction: reaction.label,
    temperatureK: input.temperatureK,
    rateConstant,
    rateConstantUnit,
    eventRatePerCm3PerS: eventRate,
    netSpeciesRatesPerCm3PerS: net,
    reactantConcentrationsPerCm3: reactantConcentrations,
    co2ThirdBodyConcentrationPerCm3: thirdBodyDensity,
    uncertaintyStatus: 'not_quantified',
    temperatureValidity: 'source_interval_not_published',
    provenance: {
      ...MARS_TAYSUM_2020_GAS_PHASE_PROVENANCE,
      recordId: 'Taysum2020-Table-B1-' + reaction.id,
      note: 'Rate source for this record: ' + reaction.citedRateSource + '. Rate uncertainty and a formal validity interval are not supplied by the Table B1 row.'
    }
  };
}
