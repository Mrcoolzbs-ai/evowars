// ============================================
// VERTICAL EDDY DIFFUSION — CONSERVATIVE FINITE-VOLUME OPERATOR
// ============================================
//
// This is an explicit, stateless transport operator. It does not invent
// Kzz, infer missing species, alter the hydrostatic background, or run
// automatically as part of the chemistry Scheduler.
//
// Positive interface flux is defined from the lower layer to the upper
// layer. The top and bottom boundaries are closed (zero external flux).
// A backward-Euler finite-volume solve keeps the update stable for large
// diffusion time steps and conserves each selected column inventory.

import type {
  ChemicalPhysicalKineticLayer,
  ChemicalPhysicalLennardJonesTransportSpecies,
  ChemicalPhysicalMolecularDiffusionConfiguration,
  ChemicalPhysicalMolecularDiffusionSpecies
} from '../../types';
import type { DataProvenance } from '../Core/scientificValue';
import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';

const VERTICAL_DIFFUSION_MODEL_VERSION = 'stage-4.2-vertical-atmospheric-diffusion-2';
const TRACE_SPECIES_MAX_MOLE_FRACTION = 0.01;
const STANDARD_ATMOSPHERE_PRESSURE_PA = 101325;
const GRAMS_PER_KILOGRAM = 1000;
const SQUARE_METRES_PER_SQUARE_CENTIMETRE = 1e-4;
const MAX_INTERFACE_PRESSURE_RELATIVE_MISMATCH = 1e-6;
const MAX_INVENTORY_RELATIVE_ERROR = 1e-10;
const LOCAL_BALANCE_RELATIVE_TOLERANCE = 1e-9;
const MINOR_NEGATIVE_RELATIVE_TOLERANCE = 1e-12;

export interface VerticalEddyDiffusionInput {
  /** Contiguous, altitude-ordered layers with hydrostatic boundary states. */
  layers: readonly ChemicalPhysicalKineticLayer[];
  /** Species transported by this call. Missing layer inventories are unknown and rejected. */
  speciesIds: readonly string[];
  /** Physical integration duration, seconds. */
  durationS: number;
  /** Explicit Kzz in m²/s, either one value for every interface or one value per interface. */
  eddyDiffusivityM2S: number | readonly number[];
  /** Optional provenance; required by physical ChemicalEvolution Scheduler configuration. */
  diffusivityProvenance?: DataProvenance;
  /** Optional Chapman-Enskog molecular diffusion data; all collision and thermal data are explicit. */
  molecularDiffusion?: ChemicalPhysicalMolecularDiffusionConfiguration;
}

export interface VerticalEddyDiffusionLayerSpeciesAudit {
  initialColumnInventoryMolM2: number;
  finalColumnInventoryMolM2: number;
  initialMixingRatio: number;
  finalMixingRatio: number;
}

export interface VerticalEddyDiffusionLayerAudit {
  layerId: string;
  altitudeRangeM: { min: number; max: number };
  airColumnInventoryMolM2: number;
  species: Record<string, VerticalEddyDiffusionLayerSpeciesAudit>;
}

export interface VerticalEddyDiffusionInterfaceSpeciesAudit {
  /** Positive values mean net transfer from the lower layer to the upper layer. */
  /** Time-averaged flux reconstructed from the conservative cell inventory changes. */
  fluxMolM2S: number;
  /** Constitutive Kzz × air-density × mixing-ratio-gradient flux (round-off diagnostic). */
  constitutiveFluxMolM2S: number;
  /** Relative mismatch between the balance-closed and constitutive flux. */
  fluxClosureRelativeDeviation: number;
  transferredMolM2: number;
  eddyGradientFluxMolM2S?: number;
  molecularGradientFluxMolM2S?: number;
  molecularDriftFluxMolM2S?: number;
  molecularDiffusivityM2S?: number;
  binaryDiffusivitiesM2S?: Record<string, number>;
  barodiffusionVelocityMs?: number;
  thermalDiffusionVelocityMs?: number;
  molecularDriftVelocityMs?: number;
}

export interface VerticalEddyDiffusionInterfaceAudit {
  lowerLayerId: string;
  upperLayerId: string;
  interfaceHeightM: number;
  centerDistanceM: number;
  eddyDiffusivityM2S: number;
  interfacePressurePa: number;
  interfaceTemperatureK: number;
  airMolarDensityMolM3: number;
  /** Conductance multiplying the mixing-ratio difference, mol m⁻² s⁻¹. */
  conductanceMolM2S: number;
  species: Record<string, VerticalEddyDiffusionInterfaceSpeciesAudit>;
}

export interface VerticalEddyDiffusionAudit {
  method: 'backward_euler_finite_volume';
  boundaryCondition: 'closed_zero_flux';
  durationS: number;
  speciesIds: string[];
  diffusivityProvenance?: DataProvenance;
  molecularDiffusion?: {
    method: 'chapman_enskog_neufeld_effective_binary_trace_species';
    species: Record<string, ChemicalPhysicalMolecularDiffusionSpecies>;
    backgroundSpecies: Record<string, ChemicalPhysicalLennardJonesTransportSpecies>;
  };
  layers: VerticalEddyDiffusionLayerAudit[];
  interfaces: VerticalEddyDiffusionInterfaceAudit[];
  columnTotalsMolM2: Record<string, {
    before: number;
    after: number;
    absoluteDifference: number;
    relativeDeviation: number;
  }>;
  assumptions: string[];
}

export type VerticalEddyDiffusionResult =
  | {
      status: 'completed';
      layers: ChemicalPhysicalKineticLayer[];
      audit: VerticalEddyDiffusionAudit;
      diagnostics: string[];
    }
  | {
      status: 'rejected';
      diagnostics: string[];
    };

interface ValidatedLayer {
  layer: ChemicalPhysicalKineticLayer;
  centerHeightM: number;
  airColumnInventoryMolM2: number;
}

interface InterfaceGeometry {
  lowerLayerIndex: number;
  upperLayerIndex: number;
  heightM: number;
  centerDistanceM: number;
  eddyDiffusivityM2S: number;
  pressurePa: number;
  temperatureK: number;
  airMolarDensityMolM3: number;
  conductanceMolM2S: number;
  meanMolarMassKgMol: number;
  gravityMs2: number;
  temperatureGradientKPerM: number;
}

interface MolecularInterfaceState {
  diffusivityM2S: number;
  binaryDiffusivitiesM2S: Record<string, number>;
  barodiffusionVelocityMs: number;
  thermalDiffusionVelocityMs: number;
  driftVelocityMs: number;
  lowerFluxCoefficientMolM2S: number;
  upperFluxCoefficientMolM2S: number;
}

function hasIdentifiedProvenance(value: unknown): value is DataProvenance {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ['sourceName', 'sourceId', 'reference', 'datasetId', 'url']
    .some((key) => typeof record[key] === 'string' && (record[key] as string).trim() !== '');
}

function validateLennardJonesTransportSpecies(
  value: unknown
): value is ChemicalPhysicalLennardJonesTransportSpecies {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    isFinitePositive(record.molarMassKgMol) &&
    hasIdentifiedProvenance(record.molarMassProvenance) &&
    isFinitePositive(record.collisionDiameterAngstrom) &&
    isFinitePositive(record.characteristicEnergyOverKBK) &&
    hasIdentifiedProvenance(record.collisionParametersProvenance)
  );
}

/**
 * Chapman–Enskog binary diffusivity with the Neufeld collision-integral
 * correlation. Inputs use kg/mol, Angstrom, K and Pa; output is m²/s.
 * The conventional 0.0018583 prefactor returns cm²/s for g/mol, Angstrom,
 * atm and K, then is converted to SI.
 */
function computeChapmanEnskogBinaryDiffusivityM2S(args: {
  temperatureK: number;
  pressurePa: number;
  speciesA: ChemicalPhysicalLennardJonesTransportSpecies;
  speciesB: ChemicalPhysicalLennardJonesTransportSpecies;
}): number {
  const sigmaAngstrom =
    (args.speciesA.collisionDiameterAngstrom + args.speciesB.collisionDiameterAngstrom) / 2;
  const epsilonOverKBK = Math.sqrt(
    args.speciesA.characteristicEnergyOverKBK * args.speciesB.characteristicEnergyOverKBK
  );
  const reducedTemperature = args.temperatureK / epsilonOverKBK;
  const omega =
    1.06036 / Math.pow(reducedTemperature, 0.15610) +
    0.19300 * Math.exp(-0.47635 * reducedTemperature) +
    1.03587 * Math.exp(-1.52996 * reducedTemperature) +
    1.76474 * Math.exp(-3.89411 * reducedTemperature);
  const massA = args.speciesA.molarMassKgMol * GRAMS_PER_KILOGRAM;
  const massB = args.speciesB.molarMassKgMol * GRAMS_PER_KILOGRAM;
  const pressureAtm = args.pressurePa / STANDARD_ATMOSPHERE_PRESSURE_PA;
  const diffusivityCm2S =
    0.0018583 *
    Math.pow(args.temperatureK, 1.5) *
    Math.sqrt(1 / massA + 1 / massB) /
    (pressureAtm * sigmaAngstrom * sigmaAngstrom * omega);
  return diffusivityCm2S * SQUARE_METRES_PER_SQUARE_CENTIMETRE;
}

function rejected(message: string): VerticalEddyDiffusionResult {
  return { status: 'rejected', diagnostics: [message] };
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function relativeDifference(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), Number.MIN_VALUE);
}

function cloneHydrostaticState(
  state: NonNullable<ChemicalPhysicalKineticLayer['hydrostaticState']>
): NonNullable<ChemicalPhysicalKineticLayer['hydrostaticState']> {
  return {
    ...state,
    bottom: { ...state.bottom },
    representative: { ...state.representative },
    top: { ...state.top },
    molarFractions: { ...state.molarFractions },
    provenance: {
      pressure: { ...state.provenance.pressure },
      composition: { ...state.provenance.composition },
      model: { ...state.provenance.model }
    },
    thirdBodyConsistency: { ...state.thirdBodyConsistency }
  };
}

function cloneLayer(layer: ChemicalPhysicalKineticLayer): ChemicalPhysicalKineticLayer {
  return {
    ...layer,
    ...(layer.altitudeRangeM === undefined ? {} : { altitudeRangeM: { ...layer.altitudeRangeM } }),
    ...(layer.altitudeProvenance === undefined ? {} : { altitudeProvenance: { ...layer.altitudeProvenance } }),
    thicknessProvenance: { ...layer.thicknessProvenance },
    temperatureProvenance: { ...layer.temperatureProvenance },
    inventoryProvenance: { ...layer.inventoryProvenance },
    columnInventoriesMolM2: { ...layer.columnInventoriesMolM2 },
    ...(layer.hydrostaticState === undefined
      ? {}
      : { hydrostaticState: cloneHydrostaticState(layer.hydrostaticState) }),
    reactionIds: [...layer.reactionIds]
  };
}

/**
 * Solves a tridiagonal system with the Thomas algorithm.
 * The matrix generated by the backward-Euler diffusion operator is an
 * M-matrix for non-negative Kzz, so its pivots must remain positive.
 */
function solveTridiagonal(
  lower: readonly number[],
  diagonal: readonly number[],
  upper: readonly number[],
  rightHandSide: readonly number[]
): number[] {
  const count = diagonal.length;
  if (count === 0 || lower.length !== count || upper.length !== count || rightHandSide.length !== count) {
    throw new Error('внутренняя трёхдиагональная система имеет несовместимые размеры');
  }

  const modifiedUpper = new Array<number>(count).fill(0);
  const modifiedRight = new Array<number>(count).fill(0);
  const firstPivot = diagonal[0]!;
  if (!isFinitePositive(firstPivot)) {
    throw new Error('первый pivot диффузионной системы неположителен или неконечен');
  }
  modifiedUpper[0] = count > 1 ? upper[0]! / firstPivot : 0;
  modifiedRight[0] = rightHandSide[0]! / firstPivot;

  for (let index = 1; index < count; index++) {
    const pivot = diagonal[index]! - lower[index]! * modifiedUpper[index - 1]!;
    if (!isFinitePositive(pivot)) {
      throw new Error('pivot диффузионной системы неположителен или неконечен на индексе ' + index);
    }
    modifiedUpper[index] = index < count - 1 ? upper[index]! / pivot : 0;
    modifiedRight[index] =
      (rightHandSide[index]! - lower[index]! * modifiedRight[index - 1]!) / pivot;
    if (!Number.isFinite(modifiedUpper[index]!) || !Number.isFinite(modifiedRight[index]!)) {
      throw new Error('прямой ход диффузионной системы дал неконечное значение на индексе ' + index);
    }
  }

  const solution = new Array<number>(count).fill(0);
  solution[count - 1] = modifiedRight[count - 1]!;
  for (let index = count - 2; index >= 0; index--) {
    solution[index] = modifiedRight[index]! - modifiedUpper[index]! * solution[index + 1]!;
  }
  if (solution.some((value) => !Number.isFinite(value))) {
    throw new Error('обратный ход диффузионной системы дал неконечное значение');
  }
  return solution;
}

/**
 * Applies one conservative vertical eddy-diffusion step to explicitly
 * selected trace species. The function is pure: input layers are never
 * mutated. Each selected species is solved independently with a shared,
 * fixed hydrostatic background.
 *
 * This first implementation intentionally rejects N2 and O2: they define
 * the supplied dry-air hydrostatic background and its local-vs-average
 * consistency evidence. Transporting them requires a coupled update of
 * bulk composition and the hydrostatic solve, which is not part of this
 * operator.
 */
export function runVerticalEddyDiffusionStep(
  input: VerticalEddyDiffusionInput
): VerticalEddyDiffusionResult {
  if (input === null || typeof input !== 'object') {
    return rejected('вход вертикальной диффузии должен быть объектом');
  }
  if (!Array.isArray(input.layers) || input.layers.length < 2) {
    return rejected('вертикальная диффузия требует не менее двух явных слоёв');
  }
  if (!Array.isArray(input.speciesIds) || input.speciesIds.length === 0) {
    return rejected('для вертикальной диффузии требуется непустой явный список speciesIds');
  }
  if (!isFinitePositive(input.durationS)) {
    return rejected('durationS должен быть конечным положительным временем в секундах');
  }

  const speciesIds = [...input.speciesIds];
  if (
    speciesIds.some((speciesId) =>
      typeof speciesId !== 'string' ||
      speciesId.trim() === '' ||
      speciesId !== speciesId.trim() ||
      !/^[a-z][a-z0-9_]*$/.test(speciesId)
    ) ||
    new Set(speciesIds).size !== speciesIds.length
  ) {
    return rejected('speciesIds должны содержать уникальные канонические lowercase ID без пустых значений');
  }
  if (speciesIds.includes('n2') || speciesIds.includes('o2')) {
    return rejected('N2 и O2 являются гидростатическим bulk-фоном и не могут переноситься этим оператором; требуется связанный пересчёт гидростатики');
  }

  const layerCount = input.layers.length;
  let diffusivityValues: number[];
  if (typeof input.eddyDiffusivityM2S === 'number') {
    diffusivityValues = new Array<number>(layerCount - 1).fill(input.eddyDiffusivityM2S);
  } else if (Array.isArray(input.eddyDiffusivityM2S)) {
    diffusivityValues = [...input.eddyDiffusivityM2S];
  } else {
    return rejected('eddyDiffusivityM2S должен быть числом или массивом значений по интерфейсам');
  }
  if (
    diffusivityValues.length !== layerCount - 1 ||
    diffusivityValues.some((value) => !isFiniteNonNegative(value))
  ) {
    return rejected('eddyDiffusivityM2S должен содержать конечные неотрицательные значения ровно для каждого межслойного интерфейса');
  }

  const molecularConfiguration = input.molecularDiffusion;
  if (molecularConfiguration !== undefined) {
    if (
      molecularConfiguration === null ||
      typeof molecularConfiguration !== 'object' ||
      Array.isArray(molecularConfiguration) ||
      molecularConfiguration.species === null ||
      typeof molecularConfiguration.species !== 'object' ||
      Array.isArray(molecularConfiguration.species) ||
      molecularConfiguration.backgroundSpecies === null ||
      typeof molecularConfiguration.backgroundSpecies !== 'object' ||
      Array.isArray(molecularConfiguration.backgroundSpecies)
    ) {
      return rejected('molecularDiffusion должен содержать explicit species и backgroundSpecies records');
    }
    const configuredTraceSpecies = Object.keys(molecularConfiguration.species).sort();
    if (configuredTraceSpecies.join('|') !== [...speciesIds].sort().join('|')) {
      return rejected('molecularDiffusion.species должен задавать ровно свойства всех speciesIds переносимого вызова');
    }
    for (const speciesId of speciesIds) {
      const parameters = molecularConfiguration.species[speciesId];
      if (
        !validateLennardJonesTransportSpecies(parameters) ||
        !Number.isFinite(parameters.thermalDiffusionFactor) ||
        !hasIdentifiedProvenance(parameters.thermalDiffusionProvenance)
      ) {
        return rejected('для молекулярной диффузии вида «' + speciesId + '» требуются конечные молярная масса, Lennard-Jones параметры и thermal-diffusion factor, каждый с provenance');
      }
    }
    if (Object.keys(molecularConfiguration.backgroundSpecies).length === 0) {
      return rejected('molecularDiffusion.backgroundSpecies не может быть пустым');
    }
    for (const [backgroundId, parameters] of Object.entries(molecularConfiguration.backgroundSpecies)) {
      if (
        backgroundId.trim() === '' ||
        backgroundId !== backgroundId.trim() ||
        !validateLennardJonesTransportSpecies(parameters)
      ) {
        return rejected('backgroundSpecies «' + backgroundId + '» требует конечные molar mass / Lennard-Jones параметры и provenance');
      }
    }
  }

  const validatedLayers: ValidatedLayer[] = [];
  for (let index = 0; index < layerCount; index++) {
    const layer = input.layers[index]!;
    if (
      typeof layer.layerId !== 'string' ||
      layer.layerId.trim() === '' ||
      layer.altitudeRangeM === undefined ||
      !isFiniteNonNegative(layer.altitudeRangeM.min) ||
      !isFinitePositive(layer.altitudeRangeM.max) ||
      layer.altitudeRangeM.max <= layer.altitudeRangeM.min ||
      !isFinitePositive(layer.layerThicknessM) ||
      !Number.isFinite(layer.temperatureK) ||
      layer.temperatureK <= 0 ||
      layer.hydrostaticState === undefined
    ) {
      return rejected('слой ' + index + ' не содержит валидную геометрию, температуру и hydrostaticState');
    }
    const range = layer.altitudeRangeM;
    const hydrostatic = layer.hydrostaticState;
    const geometryTolerance = 1e-8 * Math.max(1, Math.abs(range.min), Math.abs(range.max));
    if (
      Math.abs((range.max - range.min) - layer.layerThicknessM) > geometryTolerance ||
      Math.abs(hydrostatic.bottom.heightM - range.min) > geometryTolerance ||
      Math.abs(hydrostatic.top.heightM - range.max) > geometryTolerance
    ) {
      return rejected('геометрия слоя «' + layer.layerId + '» не совпадает с гидростатическими boundary heights');
    }
    const bottom = hydrostatic.bottom;
    const top = hydrostatic.top;
    if (
      !isFinitePositive(bottom.pressurePa) ||
      !isFinitePositive(top.pressurePa) ||
      !isFinitePositive(bottom.temperatureK) ||
      !isFinitePositive(top.temperatureK) ||
      !isFiniteNonNegative(bottom.columnMolesPerM2) ||
      !isFinitePositive(top.columnMolesPerM2) ||
      top.columnMolesPerM2 <= bottom.columnMolesPerM2
    ) {
      return rejected('гидростатические границы слоя «' + layer.layerId + '» содержат некорректные P/T или немонотонный молярный столб');
    }
    if (
      layer.columnInventoriesMolM2 === null ||
      typeof layer.columnInventoriesMolM2 !== 'object' ||
      Array.isArray(layer.columnInventoriesMolM2)
    ) {
      return rejected('слой «' + layer.layerId + '» не содержит объект подстолбовых запасов');
    }
    const airColumnInventoryMolM2 = top.columnMolesPerM2 - bottom.columnMolesPerM2;
    if (molecularConfiguration !== undefined) {
      const fractions = hydrostatic.molarFractions;
      if (
        fractions === null ||
        typeof fractions !== 'object' ||
        Array.isArray(fractions) ||
        Object.keys(fractions).length === 0
      ) {
        return rejected('молекулярная диффузия требует явный hydrostatic molarFractions в слое «' + layer.layerId + '»');
      }
      const fractionValues = Object.values(fractions);
      const fractionSum = fractionValues.reduce((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
      if (
        fractionValues.some((value) => !isFinitePositive(value)) ||
        !Number.isFinite(fractionSum) ||
        Math.abs(fractionSum - 1) > 1e-6
      ) {
        return rejected('молярные доли background состава слоя «' + layer.layerId + '» должны быть положительными, конечными и суммироваться в единицу');
      }
      for (const backgroundId of Object.keys(fractions)) {
        if (!hasOwn(molecularConfiguration.backgroundSpecies, backgroundId)) {
          return rejected('для bulk-компонента «' + backgroundId + '» слоя «' + layer.layerId + '» отсутствуют explicit Lennard-Jones данные');
        }
      }
    }
    for (const speciesId of speciesIds) {
      if (!hasOwn(layer.columnInventoriesMolM2, speciesId)) {
        return rejected('в слое «' + layer.layerId + '» отсутствует явный inventory для вида «' + speciesId + '»; отсутствие не считается нулём');
      }
      const amount = layer.columnInventoriesMolM2[speciesId];
      if (!isFiniteNonNegative(amount)) {
        return rejected('запас вида «' + speciesId + '» в слое «' + layer.layerId + '» должен быть конечным и неотрицательным');
      }
      if (amount > airColumnInventoryMolM2 * (1 + 1e-8)) {
        return rejected('запас вида «' + speciesId + '» в слое «' + layer.layerId + '» превышает общий молярный столб сухого воздуха');
      }
    }
    validatedLayers.push({
      layer,
      centerHeightM: (range.min + range.max) / 2,
      airColumnInventoryMolM2
    });
  }

  for (let index = 1; index < validatedLayers.length; index++) {
    const lower = validatedLayers[index - 1]!;
    const upper = validatedLayers[index]!;
    const lowerRange = lower.layer.altitudeRangeM!;
    const upperRange = upper.layer.altitudeRangeM!;
    const boundaryToleranceM = 1e-8 * Math.max(1, Math.abs(lowerRange.max), Math.abs(upperRange.min));
    if (Math.abs(lowerRange.max - upperRange.min) > boundaryToleranceM) {
      return rejected('слои «' + lower.layer.layerId + '» и «' + upper.layer.layerId + '» должны быть смежными без вертикального разрыва или перекрытия');
    }
    const lowerPressure = lower.layer.hydrostaticState!.top.pressurePa;
    const upperPressure = upper.layer.hydrostaticState!.bottom.pressurePa;
    if (relativeDifference(lowerPressure, upperPressure) > MAX_INTERFACE_PRESSURE_RELATIVE_MISMATCH) {
      return rejected('гидростатическое давление разрывно на интерфейсе «' + lower.layer.layerId + '» / «' + upper.layer.layerId + '»');
    }
  }

  const interfaces: InterfaceGeometry[] = [];
  for (let index = 0; index < layerCount - 1; index++) {
    const lower = validatedLayers[index]!;
    const upper = validatedLayers[index + 1]!;
    const lowerEdge = lower.layer.hydrostaticState!.top;
    const upperEdge = upper.layer.hydrostaticState!.bottom;
    const centerDistanceM = upper.centerHeightM - lower.centerHeightM;
    if (!isFinitePositive(centerDistanceM)) {
      return rejected('центры соседних слоёв не образуют положительное вертикальное расстояние');
    }
    // Geometric means are symmetric in the two adjacent layer boundary values.
    const interfacePressurePa = Math.sqrt(lowerEdge.pressurePa * upperEdge.pressurePa);
    const interfaceTemperatureK = Math.sqrt(lowerEdge.temperatureK * upperEdge.temperatureK);
    const airMolarDensityMolM3 =
      interfacePressurePa /
      (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * interfaceTemperatureK);
    const eddyDiffusivityM2S = diffusivityValues[index]!;
    const conductanceMolM2S = eddyDiffusivityM2S * airMolarDensityMolM3 / centerDistanceM;
    if (
      !isFinitePositive(interfacePressurePa) ||
      !isFinitePositive(interfaceTemperatureK) ||
      !isFinitePositive(airMolarDensityMolM3) ||
      !isFiniteNonNegative(conductanceMolM2S)
    ) {
      return rejected('не удалось получить конечную положительную интерфейсную молярную плотность/проводимость');
    }
    interfaces.push({
      lowerLayerIndex: index,
      upperLayerIndex: index + 1,
      heightM: (lowerRangeMax(lower.layer) + upperRangeMin(upper.layer)) / 2,
      centerDistanceM,
      eddyDiffusivityM2S,
      pressurePa: interfacePressurePa,
      temperatureK: interfaceTemperatureK,
      airMolarDensityMolM3,
      conductanceMolM2S,
      meanMolarMassKgMol: Math.sqrt(
        lowerEdge.meanMolarMassKgPerMol * upperEdge.meanMolarMassKgPerMol
      ),
      gravityMs2: Math.sqrt(lowerEdge.gravityMs2 * upperEdge.gravityMs2),
      temperatureGradientKPerM:
        (upper.layer.hydrostaticState!.representative.temperatureK -
          lower.layer.hydrostaticState!.representative.temperatureK) / centerDistanceM
    });
  }

  const initialInventoriesBySpecies: Record<string, number[]> = {};
  const finalInventoriesBySpecies: Record<string, number[]> = {};
  const fluxesBySpecies: Record<string, number[]> = {};
  const transfersBySpecies: Record<string, number[]> = {};
  const constitutiveFluxesBySpecies: Record<string, number[]> = {};
  const fluxClosureBySpecies: Record<string, number[]> = {};

  for (const speciesId of speciesIds) {
    const initial = validatedLayers.map((entry) => entry.layer.columnInventoriesMolM2[speciesId]!);
    const initialTotal = initial.reduce((sum, value) => sum + value, 0);
    const totalAirColumnInventory = validatedLayers.reduce(
      (sum, entry) => sum + entry.airColumnInventoryMolM2,
      0
    );
    if (!Number.isFinite(initialTotal) || !isFinitePositive(totalAirColumnInventory)) {
      return rejected('общий столб вида «' + speciesId + '» или общий воздушный столб не является конечным');
    }

    // Solve for adjacent mixing-ratio differences rather than absolute
    // inventories. The diffusion operator has a conserved uniform-mixing
    // mode; removing that mode avoids the near-singular cancellation that
    // appears in (I - dt L) when dt*Kzz is very large.
    const initialMixingRatios = initial.map((amount, index) =>
      amount / validatedLayers[index]!.airColumnInventoryMolM2
    );

    const molecularStates: MolecularInterfaceState[] | undefined =
      molecularConfiguration === undefined
        ? undefined
        : interfaces.map((interfaceGeometry, interfaceIndex) => {
            const lower = validatedLayers[interfaceGeometry.lowerLayerIndex]!;
            const upper = validatedLayers[interfaceGeometry.upperLayerIndex]!;
            const lowerFractions = lower.layer.hydrostaticState!.molarFractions;
            const upperFractions = upper.layer.hydrostaticState!.molarFractions;
            const lowerIds = Object.keys(lowerFractions).sort();
            const upperIds = Object.keys(upperFractions).sort();
            if (lowerIds.join('|') !== upperIds.join('|')) {
              throw new Error('bulk composition species differ across molecular-diffusion interface ' + interfaceIndex);
            }
            const traceMoleFraction =
              (initialMixingRatios[interfaceGeometry.lowerLayerIndex]! +
                initialMixingRatios[interfaceGeometry.upperLayerIndex]!) / 2;
            if (
              !Number.isFinite(traceMoleFraction) ||
              traceMoleFraction < 0 ||
              traceMoleFraction > TRACE_SPECIES_MAX_MOLE_FRACTION
            ) {
              throw new Error(
                'молекулярная Chapman-Enskog смесь требует trace mixing ratio ≤ ' +
                TRACE_SPECIES_MAX_MOLE_FRACTION + ' для вида «' + speciesId +
                '» на интерфейсе ' + interfaceIndex
              );
            }
            const speciesParameters = molecularConfiguration.species[speciesId]!;
            const binaryDiffusivitiesM2S: Record<string, number> = {};
            let reciprocalMixtureDiffusivity = 0;
            for (const backgroundId of lowerIds) {
              const lowerFraction = lowerFractions[backgroundId]!;
              const upperFraction = upperFractions[backgroundId]!;
              const backgroundFraction = (lowerFraction + upperFraction) / 2;
              const backgroundParameters = molecularConfiguration.backgroundSpecies[backgroundId]!;
              const binaryDiffusivity = computeChapmanEnskogBinaryDiffusivityM2S({
                temperatureK: interfaceGeometry.temperatureK,
                pressurePa: interfaceGeometry.pressurePa,
                speciesA: speciesParameters,
                speciesB: backgroundParameters
              });
              if (!isFinitePositive(binaryDiffusivity)) {
                throw new Error('Chapman-Enskog D_ij неконечен для пары «' + speciesId + '/' + backgroundId + '»');
              }
              binaryDiffusivitiesM2S[backgroundId] = binaryDiffusivity;
              reciprocalMixtureDiffusivity += backgroundFraction / binaryDiffusivity;
            }
            const molecularDiffusivityM2S =
              (1 - traceMoleFraction) / reciprocalMixtureDiffusivity;
            const gravityGradientMInverse =
              (speciesParameters.molarMassKgMol - interfaceGeometry.meanMolarMassKgMol) *
              interfaceGeometry.gravityMs2 /
              (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * interfaceGeometry.temperatureK);
            const thermalGradientMInverse =
              speciesParameters.thermalDiffusionFactor *
              interfaceGeometry.temperatureGradientKPerM /
              interfaceGeometry.temperatureK;
            const barodiffusionVelocityMs = -molecularDiffusivityM2S * gravityGradientMInverse;
            const thermalDiffusionVelocityMs = -molecularDiffusivityM2S * thermalGradientMInverse;
            const driftVelocityMs = barodiffusionVelocityMs + thermalDiffusionVelocityMs;
            const totalGradientConductance =
              interfaceGeometry.airMolarDensityMolM3 *
              (interfaceGeometry.eddyDiffusivityM2S + molecularDiffusivityM2S) /
              interfaceGeometry.centerDistanceM;
            const driftFluxCoefficientMolM2S =
              interfaceGeometry.airMolarDensityMolM3 * driftVelocityMs;
            const lowerFluxCoefficientMolM2S =
              totalGradientConductance + Math.max(0, driftFluxCoefficientMolM2S);
            const upperFluxCoefficientMolM2S =
              -totalGradientConductance + Math.min(0, driftFluxCoefficientMolM2S);
            if (
              !isFinitePositive(molecularDiffusivityM2S) ||
              !Number.isFinite(gravityGradientMInverse) ||
              !Number.isFinite(thermalGradientMInverse) ||
              !Number.isFinite(barodiffusionVelocityMs) ||
              !Number.isFinite(thermalDiffusionVelocityMs) ||
              !Number.isFinite(driftVelocityMs) ||
              !Number.isFinite(lowerFluxCoefficientMolM2S) ||
              !Number.isFinite(upperFluxCoefficientMolM2S)
            ) {
              throw new Error('молекулярные интерфейсные коэффициенты неконечны для вида «' + speciesId + '»');
            }
            return {
              diffusivityM2S: molecularDiffusivityM2S,
              binaryDiffusivitiesM2S,
              barodiffusionVelocityMs,
              thermalDiffusionVelocityMs,
              driftVelocityMs,
              lowerFluxCoefficientMolM2S,
              upperFluxCoefficientMolM2S
            };
          });

    const initialDifferences = interfaces.map((_entry, index) =>
      initialMixingRatios[index]! - initialMixingRatios[index + 1]!
    );
    const differenceCount = layerCount - 1;
    const lowerDiagonal = new Array<number>(differenceCount).fill(0);
    const diagonal = new Array<number>(differenceCount).fill(1);
    const upperDiagonal = new Array<number>(differenceCount).fill(0);

    for (let index = 0; index < differenceCount; index++) {
      const interfaceConductance = interfaces[index]!.conductanceMolM2S;
      const lowerAirColumn = validatedLayers[index]!.airColumnInventoryMolM2;
      const upperAirColumn = validatedLayers[index + 1]!.airColumnInventoryMolM2;
      const integratedConductance = input.durationS * interfaceConductance;
      const currentCoupling =
        integratedConductance * (1 / lowerAirColumn + 1 / upperAirColumn);
      diagonal[index] = 1 + currentCoupling;

      if (index > 0) {
        const lowerConductance = interfaces[index - 1]!.conductanceMolM2S;
        lowerDiagonal[index] =
          -input.durationS * lowerConductance / lowerAirColumn;
      }
      if (index < differenceCount - 1) {
        const upperConductance = interfaces[index + 1]!.conductanceMolM2S;
        upperDiagonal[index] =
          -input.durationS * upperConductance / upperAirColumn;
      }
      if (
        !Number.isFinite(diagonal[index]!) ||
        !Number.isFinite(lowerDiagonal[index]!) ||
        !Number.isFinite(upperDiagonal[index]!)
      ) {
        return rejected('коэффициенты системы разностей mixing ratio переполнены на интерфейсе ' + index);
      }
    }

    let finalDifferences: number[];
    try {
      finalDifferences = solveTridiagonal(
        lowerDiagonal,
        diagonal,
        upperDiagonal,
        initialDifferences
      );
    } catch (error) {
      return rejected(error instanceof Error ? error.message : String(error));
    }

    // Reconstruct mixing ratios from their differences and the exactly
    // conserved column mean. This preserves the null-space (uniform mixing
    // ratio) analytically instead of asking a floating-point solve to retain it.
    const offsets = new Array<number>(layerCount).fill(0);
    for (let index = differenceCount - 1; index >= 0; index--) {
      offsets[index] = offsets[index + 1]! + finalDifferences[index]!;
    }
    const weightedOffsetMean = offsets.reduce(
      (sum, offset, index) =>
        sum + validatedLayers[index]!.airColumnInventoryMolM2 * offset,
      0
    ) / totalAirColumnInventory;
    const conservedMeanMixingRatio = initialTotal / totalAirColumnInventory;
    const final = offsets.map((offset, index) =>
      validatedLayers[index]!.airColumnInventoryMolM2 *
      (conservedMeanMixingRatio + offset - weightedOffsetMean)
    );

    for (let index = 0; index < final.length; index++) {
      const value = final[index]!;
      const negativeTolerance = MINOR_NEGATIVE_RELATIVE_TOLERANCE *
        Math.max(initialTotal, initial[index]!, Number.MIN_VALUE);
      if (value < -negativeTolerance) {
        return rejected('неявная диффузия дала отрицательный запас вида «' + speciesId + '» в слое ' + index);
      }
      if (value < 0) final[index] = 0;
      if (final[index]! > validatedLayers[index]!.airColumnInventoryMolM2 * (1 + 1e-8)) {
        return rejected('после диффузии mixing ratio вида «' + speciesId + '» превышает единицу в слое ' + index);
      }
    }

    const finalTotal = final.reduce((sum, value) => sum + value, 0);
    const conservationError = Math.abs(finalTotal - initialTotal);
    const conservationRelativeError = conservationError / Math.max(initialTotal, Number.MIN_VALUE);
    if (
      !Number.isFinite(finalTotal) ||
      !Number.isFinite(conservationRelativeError) ||
      conservationRelativeError > MAX_INVENTORY_RELATIVE_ERROR
    ) {
      return rejected('вертикальная диффузия не сохранила полный столб вида «' + speciesId + '» в пределах численного допуска');
    }

    const transfers = interfaces.map((interfaceGeometry, index) =>
      interfaceGeometry.conductanceMolM2S * finalDifferences[index]! * input.durationS
    );
    const fluxes = transfers.map((transfer) => transfer / input.durationS);
    const constitutiveFluxes = interfaces.map((interfaceGeometry, index) => {
      const lowerMixingRatio = final[index]! /
        validatedLayers[index]!.airColumnInventoryMolM2;
      const upperMixingRatio = final[index + 1]! /
        validatedLayers[index + 1]!.airColumnInventoryMolM2;
      return interfaceGeometry.conductanceMolM2S * (lowerMixingRatio - upperMixingRatio);
    });
    const fluxClosureRelativeDeviations = fluxes.map((flux, index) =>
      Math.abs(flux - constitutiveFluxes[index]!) /
      Math.max(Math.abs(flux), Math.abs(constitutiveFluxes[index]!), Number.MIN_VALUE)
    );
    if (
      fluxes.some((value) => !Number.isFinite(value)) ||
      transfers.some((value) => !Number.isFinite(value)) ||
      constitutiveFluxes.some((value) => !Number.isFinite(value)) ||
      fluxClosureRelativeDeviations.some((value) => !Number.isFinite(value) || value > 1e-4)
    ) {
      return rejected('интерфейсный поток не согласован с консервативным обновлением запасов для вида «' + speciesId + '»; проверьте жёсткость шага и разрешение чисел');
    }

    for (let index = 0; index < layerCount; index++) {
      const expected =
        initial[index]! +
        (index > 0 ? transfers[index - 1]! : 0) -
        (index < layerCount - 1 ? transfers[index]! : 0);
      const balanceError = Math.abs(final[index]! - expected);
      const balanceTolerance = LOCAL_BALANCE_RELATIVE_TOLERANCE *
        Math.max(initial[index]!, final[index]!, Math.abs(expected), initialTotal, Number.MIN_VALUE);
      if (balanceError > balanceTolerance) {
        return rejected('локальный материальный баланс не согласован для вида «' + speciesId + '», слой ' + index);
      }
    }

    initialInventoriesBySpecies[speciesId] = initial;
    finalInventoriesBySpecies[speciesId] = final;
    fluxesBySpecies[speciesId] = fluxes;
    transfersBySpecies[speciesId] = transfers;
    constitutiveFluxesBySpecies[speciesId] = constitutiveFluxes;
    fluxClosureBySpecies[speciesId] = fluxClosureRelativeDeviations;
  }

  const updatedLayers = validatedLayers.map((entry, layerIndex) => {
    const source = entry.layer;
    const updatedInventories = { ...source.columnInventoriesMolM2 };
    for (const speciesId of speciesIds) {
      updatedInventories[speciesId] = finalInventoriesBySpecies[speciesId]![layerIndex]!;
    }
    const cloned = cloneLayer(source);
    return {
      ...cloned,
      columnInventoriesMolM2: updatedInventories,
      inventoryProvenance: {
        ...cloned.inventoryProvenance,
        method: 'консервативная конечно-объёмная вертикальная турбулентная диффузия; неявный backward Euler',
        modelVersion: VERTICAL_DIFFUSION_MODEL_VERSION,
        applicability: 'Только явно выбранные следовые виды в заданной непрерывной гидростатической колонке',
        limitations: 'Kzz задан вызывающей стороной; нулевой внешний поток сверху и снизу; гидростатический фон фиксирован; не включены молекулярная диффузия, конвекция, химия и фотохимия; N2 и O2 этим оператором не переносятся.',
        rawInput: {
          ...(cloned.inventoryProvenance.rawInput ?? {}),
          vertical_transport_layer_id: source.layerId,
          vertical_transport_duration_s: input.durationS,
          vertical_transport_species_ids: speciesIds.join(','),
          vertical_transport_eddy_diffusivity_profile_m2_s: diffusivityValues.join(','),
          vertical_transport_air_column_mol_m2: entry.airColumnInventoryMolM2,
          vertical_transport_species_inventories_before_after: speciesIds.map((speciesId) =>
            speciesId + ':' +
            initialInventoriesBySpecies[speciesId]![layerIndex]! + '>' +
            finalInventoriesBySpecies[speciesId]![layerIndex]!
          ).join(';')
        },
        note: [
          cloned.inventoryProvenance.note,
          'Слои изменены вертикальным транспортом; значения до/после и межслойные потоки сохранены в VerticalEddyDiffusionAudit.'
        ].filter((value): value is string => typeof value === 'string' && value.trim() !== '').join('; ')
      }
    };
  });

  const layerAudits: VerticalEddyDiffusionLayerAudit[] = validatedLayers.map((entry, layerIndex) => ({
    layerId: entry.layer.layerId,
    altitudeRangeM: { ...entry.layer.altitudeRangeM! },
    airColumnInventoryMolM2: entry.airColumnInventoryMolM2,
    species: Object.fromEntries(speciesIds.map((speciesId) => {
      const initial = initialInventoriesBySpecies[speciesId]![layerIndex]!;
      const final = finalInventoriesBySpecies[speciesId]![layerIndex]!;
      return [speciesId, {
        initialColumnInventoryMolM2: initial,
        finalColumnInventoryMolM2: final,
        initialMixingRatio: initial / entry.airColumnInventoryMolM2,
        finalMixingRatio: final / entry.airColumnInventoryMolM2
      }];
    }))
  }));

  const interfaceAudits: VerticalEddyDiffusionInterfaceAudit[] = interfaces.map((entry, interfaceIndex) => ({
    lowerLayerId: validatedLayers[entry.lowerLayerIndex]!.layer.layerId,
    upperLayerId: validatedLayers[entry.upperLayerIndex]!.layer.layerId,
    interfaceHeightM: entry.heightM,
    centerDistanceM: entry.centerDistanceM,
    eddyDiffusivityM2S: entry.eddyDiffusivityM2S,
    interfacePressurePa: entry.pressurePa,
    interfaceTemperatureK: entry.temperatureK,
    airMolarDensityMolM3: entry.airMolarDensityMolM3,
    conductanceMolM2S: entry.conductanceMolM2S,
    species: Object.fromEntries(speciesIds.map((speciesId) => [
      speciesId,
      {
        fluxMolM2S: fluxesBySpecies[speciesId]![interfaceIndex]!,
        constitutiveFluxMolM2S: constitutiveFluxesBySpecies[speciesId]![interfaceIndex]!,
        fluxClosureRelativeDeviation: fluxClosureBySpecies[speciesId]![interfaceIndex]!,
        transferredMolM2: transfersBySpecies[speciesId]![interfaceIndex]!
      }
    ]))
  }));

  const columnTotalsMolM2 = Object.fromEntries(speciesIds.map((speciesId) => {
    const before = initialInventoriesBySpecies[speciesId]!.reduce((sum, value) => sum + value, 0);
    const after = finalInventoriesBySpecies[speciesId]!.reduce((sum, value) => sum + value, 0);
    return [speciesId, {
      before,
      after,
      absoluteDifference: Math.abs(after - before),
      relativeDeviation: Math.abs(after - before) / Math.max(before, Number.MIN_VALUE)
    }];
  }));

  const audit: VerticalEddyDiffusionAudit = {
    method: 'backward_euler_finite_volume',
    boundaryCondition: 'closed_zero_flux',
    durationS: input.durationS,
    speciesIds,
    ...(input.diffusivityProvenance === undefined
      ? {}
      : { diffusivityProvenance: { ...input.diffusivityProvenance } }),
    layers: layerAudits,
    interfaces: interfaceAudits,
    columnTotalsMolM2,
    assumptions: [
      'Kzz задан вызывающей стороной для каждого интерфейса; модель не выбирает и не оценивает Kzz автоматически.',
      'На верхней и нижней границах задан нулевой внешний поток; масса не поступает в атмосферный столб и не покидает его.',
      'Интерфейсные P и T рассчитаны как геометрические средние соседних гидростатических boundary значений.',
      'Гидростатический фон, общий молярный столб воздуха и геометрия слоёв фиксированы на протяжении шага.',
      'Переносятся только speciesIds; отсутствующий вид не считается нулевым, а N2/O2 остаются неподвижным bulk-фоном.',
      'Оператор не включает молекулярную диффузию, конвекцию, химические реакции или фотохимию и пока не подключён к ChemicalEvolution Scheduler.'
    ]
  };

  return {
    status: 'completed',
    layers: updatedLayers,
    audit,
    diagnostics: []
  };
}

function lowerRangeMax(layer: ChemicalPhysicalKineticLayer): number {
  return layer.altitudeRangeM!.max;
}

function upperRangeMin(layer: ChemicalPhysicalKineticLayer): number {
  return layer.altitudeRangeM!.min;
}
