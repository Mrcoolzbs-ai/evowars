// ============================================
// DRY CONVECTIVE MIXING-LENGTH CLOSURE
// ============================================
//
// This module diagnoses dry static instability and derives a convective
// tracer diffusivity. It does NOT adjust temperature or re-solve hydrostatics.
//
// Virtual potential temperature uses local NASA CEA Cp(T), the documented
// 1 bar standard-state convention, and the hydrostatic mean molar mass.
// Kconv = Cmix * l^2 * sqrt(max(0, -N^2)), with
// l = min(alpha * sqrt(H_lower * H_upper), layer-centre distance).
//
// This is a transparent mixing-length closure, not a calibrated planetary
// convection model. All closure coefficients are explicit and provenance-backed.

import type {
  ChemicalPhysicalDryConvectiveMixingConfiguration,
  ChemicalPhysicalKineticLayer
} from '../../types';
import type { DataProvenance } from '../Core/scientificValue';
import { quantity } from '../Core/physicalQuantity';
import { buildThermodynamicCatalog } from '../Data/thermodynamicCatalog';
import { speciesCp, UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';

export const DRY_CONVECTIVE_REFERENCE_PRESSURE_PA = 100000;
const MAX_COMPOSITION_SUM_DEVIATION = 1e-6;
const MAX_MEAN_MOLAR_MASS_RELATIVE_DEVIATION = 1e-3;
const DRY_STABILITY_NUMERICAL_TOLERANCE_S2 = 1e-12;

export interface DryConvectiveInterfaceState {
  lowerLayerId: string;
  upperLayerId: string;
  centerDistanceM: number;
  virtualPotentialTemperatureLowerK: number;
  virtualPotentialTemperatureUpperK: number;
  bruntVaisalaFrequencySquaredS2: number;
  isDryConvectivelyUnstable: boolean;
  mixingLengthM: number;
  convectiveVelocityScaleMs: number;
  convectiveDiffusivityM2S: number;
}

export interface DryConvectiveMixingAudit {
  method: 'dry_mixing_length_virtual_potential_temperature';
  referencePressurePa: number;
  mixingLengthScaleHeightFraction: number;
  efficiencyCoefficient: number;
  provenance: DataProvenance;
  heatTransport: 'not_modelled';
  interfaces: DryConvectiveInterfaceState[];
}

export type DryConvectiveMixingResult =
  | { status: 'completed'; interfaces: DryConvectiveInterfaceState[]; audit: DryConvectiveMixingAudit; diagnostics: string[] }
  | { status: 'rejected'; diagnostics: string[] };

interface LayerThermodynamicState {
  virtualPotentialTemperatureK: number;
  meanMolarMassKgMol: number;
}

function rejected(message: string): DryConvectiveMixingResult {
  return { status: 'rejected', diagnostics: [message] };
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasIdentifiedProvenance(value: unknown): value is DataProvenance {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ['sourceName', 'sourceId', 'datasetId', 'reference', 'url']
    .some((key) => typeof record[key] === 'string' && (record[key] as string).trim() !== '');
}

function relativeDifference(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), Number.MIN_VALUE);
}

function deriveLayerThermodynamics(
  layer: ChemicalPhysicalKineticLayer
): LayerThermodynamicState | string {
  const hydro = layer.hydrostaticState;
  if (hydro === undefined) return 'слой «' + layer.layerId + '» не содержит hydrostaticState';
  const point = hydro.representative;
  if (
    !isFinitePositive(point.pressurePa) ||
    !isFinitePositive(point.temperatureK) ||
    !isFinitePositive(point.meanMolarMassKgPerMol) ||
    !isFinitePositive(point.gravityMs2) ||
    !isFinitePositive(point.scaleHeightM)
  ) {
    return 'слой «' + layer.layerId + '» содержит некорректные representative P/T/Mbar/g/H';
  }
  const fractions = hydro.molarFractions;
  if (fractions === null || typeof fractions !== 'object' || Array.isArray(fractions) || Object.keys(fractions).length === 0) {
    return 'слой «' + layer.layerId + '» не содержит явный hydrostatic molarFractions';
  }
  const entries = Object.entries(fractions);
  let fractionSum = 0;
  let mixtureMolarMassKgMol = 0;
  let mixtureCpJMolK = 0;
  const catalog = buildThermodynamicCatalog();
  for (const [speciesId, fraction] of entries) {
    if (!isFinitePositive(fraction)) {
      return 'молярная доля bulk-вида «' + speciesId + '» слоя «' + layer.layerId + '» должна быть конечной и положительной';
    }
    fractionSum += fraction;
    const species = catalog.get(speciesId);
    if (species === null) {
      return 'в NASA CEA термодинамическом каталоге отсутствует bulk-вид «' + speciesId + '»; Cp не выводится по формуле или названию';
    }
    if (species.phase !== 'gas' || species.molarMassKgMol === null || !isFinitePositive(species.molarMassKgMol)) {
      return 'bulk-вид «' + speciesId + '» не имеет известной газовой фазы и конечной молярной массы для сухой конвекции';
    }
    if (species.thermodynamics === undefined || species.thermodynamics.heatCapacity.status !== 'known' || species.thermodynamics.heatCapacity.nasa7 === undefined) {
      return 'bulk-вид «' + speciesId + '» не имеет известного NASA Cp(T); сухая конвективная оценка отклонена';
    }
    let cpJMolK: number;
    try {
      cpJMolK = speciesCp(species.thermodynamics, quantity(point.temperatureK, 'K')).value;
    } catch (error) {
      return 'NASA Cp(T) вида «' + speciesId + '» вне диапазона применимости или повреждена: ' +
        (error instanceof Error ? error.message : String(error));
    }
    if (!isFinitePositive(cpJMolK)) {
      return 'NASA Cp(T) вида «' + speciesId + '» не является конечной положительной теплоёмкостью';
    }
    mixtureMolarMassKgMol += fraction * species.molarMassKgMol;
    mixtureCpJMolK += fraction * cpJMolK;
  }
  if (!Number.isFinite(fractionSum) || Math.abs(fractionSum - 1) > MAX_COMPOSITION_SUM_DEVIATION) {
    return 'bulk mole fractions слоя «' + layer.layerId + '» не суммируются к единице';
  }
  if (relativeDifference(mixtureMolarMassKgMol, point.meanMolarMassKgPerMol) > MAX_MEAN_MOLAR_MASS_RELATIVE_DEVIATION) {
    return 'средняя молярная масса NASA CEA состава слоя «' + layer.layerId + '» не согласована с гидростатическим Mbar в пределах 0.1%';
  }
  if (!isFinitePositive(mixtureCpJMolK)) {
    return 'смесовая молярная теплоёмкость слоя «' + layer.layerId + '» некорректна';
  }

  const kappa = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K / mixtureCpJMolK;
  const referenceMolarMassKgMol = point.meanMolarMassKgPerMol;
  // The reference molar mass is a constant scale; it cancels in N² but
  // keeps the virtual-potential-temperature diagnostic dimensioned in K.
  const virtualPotentialTemperatureK =
    point.temperatureK *
    Math.pow(DRY_CONVECTIVE_REFERENCE_PRESSURE_PA / point.pressurePa, kappa) *
    (referenceMolarMassKgMol / mixtureMolarMassKgMol);
  if (!isFinitePositive(virtualPotentialTemperatureK)) {
    return 'виртуальная потенциальная температура слоя «' + layer.layerId + '» неконечна';
  }
  return {
    virtualPotentialTemperatureK,
    meanMolarMassKgMol: mixtureMolarMassKgMol
  };
}

/** Derive a dry-convective tracer diffusivity on each adjacent layer interface. */
export function diagnoseDryConvectiveMixing(
  layers: readonly ChemicalPhysicalKineticLayer[],
  configuration: ChemicalPhysicalDryConvectiveMixingConfiguration
): DryConvectiveMixingResult {
  if (!Array.isArray(layers) || layers.length < 2) {
    return rejected('сухая конвективная параметризация требует не менее двух слоёв');
  }
  if (
    configuration === null ||
    typeof configuration !== 'object' ||
    !Array.isArray(configuration.speciesIds) ||
    configuration.speciesIds.length === 0 ||
    configuration.speciesIds.some((id) => typeof id !== 'string' || id.trim() === '' || id !== id.trim()) ||
    new Set(configuration.speciesIds).size !== configuration.speciesIds.length
  ) {
    return rejected('dryConvectiveMixing.speciesIds должен содержать непустой список уникальных species ID');
  }
  if (configuration.speciesIds.some((id) => id === 'n2' || id === 'o2')) {
    return rejected('сухой конвективный tracer-оператор не может переносить bulk N2/O2 без связанного пересчёта состава и гидростатики');
  }
  if (
    !isFinitePositive(configuration.mixingLengthScaleHeightFraction) ||
    configuration.mixingLengthScaleHeightFraction > 1
  ) {
    return rejected('mixingLengthScaleHeightFraction должен быть в интервале (0, 1]');
  }
  if (
    !isFinitePositive(configuration.efficiencyCoefficient) ||
    configuration.efficiencyCoefficient > 1
  ) {
    return rejected('efficiencyCoefficient должен быть в интервале (0, 1]');
  }
  if (!hasIdentifiedProvenance(configuration.provenance)) {
    return rejected('dryConvectiveMixing.provenance обязан идентифицировать источник или сценарное обоснование параметров замыкания');
  }

  const layerStates: LayerThermodynamicState[] = [];
  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]!;
    if (
      layer.altitudeRangeM === undefined ||
      !isFinitePositive(layer.layerThicknessM) ||
      !isFinitePositive(layer.hydrostaticState?.bottom.pressurePa) ||
      !isFinitePositive(layer.hydrostaticState?.top.pressurePa)
    ) {
      return rejected('слой ' + index + ' не содержит непрерывную геометрию и гидростатические boundary pressure');
    }
    const range = layer.altitudeRangeM;
    if (
      !Number.isFinite(range.min) ||
      !Number.isFinite(range.max) ||
      range.min < 0 ||
      range.max <= range.min ||
      Math.abs((range.max - range.min) - layer.layerThicknessM) > 1e-8 * Math.max(1, range.max)
    ) {
      return rejected('слой «' + layer.layerId + '» имеет несогласованные высоты и геометрическую толщину');
    }
    const hydro = layer.hydrostaticState!;
    if (Math.abs(hydro.bottom.heightM - range.min) > 1e-8 * Math.max(1, range.max) ||
        Math.abs(hydro.top.heightM - range.max) > 1e-8 * Math.max(1, range.max)) {
      return rejected('слой «' + layer.layerId + '» имеет границы, не совпадающие с гидростатическими высотами');
    }
    const derived = deriveLayerThermodynamics(layer);
    if (typeof derived === 'string') return rejected(derived);
    layerStates.push(derived);
  }

  const interfaces: DryConvectiveInterfaceState[] = [];
  for (let index = 0; index < layers.length - 1; index++) {
    const lower = layers[index]!;
    const upper = layers[index + 1]!;
    const lowerRange = lower.altitudeRangeM!;
    const upperRange = upper.altitudeRangeM!;
    const heightToleranceM = 1e-8 * Math.max(1, Math.abs(lowerRange.max), Math.abs(upperRange.min));
    if (Math.abs(lowerRange.max - upperRange.min) > heightToleranceM) {
      return rejected('сухая конвекция требует смежные слои без вертикальных разрывов и перекрытий');
    }
    const pressureMismatch = relativeDifference(
      lower.hydrostaticState!.top.pressurePa,
      upper.hydrostaticState!.bottom.pressurePa
    );
    if (pressureMismatch > 1e-6) {
      return rejected('гидростатическое давление разрывно на интерфейсе «' + lower.layerId + '/' + upper.layerId + '»');
    }
    const lowerCentre = (lowerRange.min + lowerRange.max) / 2;
    const upperCentre = (upperRange.min + upperRange.max) / 2;
    const centreDistanceM = upperCentre - lowerCentre;
    if (!isFinitePositive(centreDistanceM)) {
      return rejected('сухая конвекция получила неположительное расстояние между центрами слоёв');
    }
    const lowerPoint = lower.hydrostaticState!.representative;
    const upperPoint = upper.hydrostaticState!.representative;
    const thetaLower = layerStates[index]!.virtualPotentialTemperatureK;
    const thetaUpper = layerStates[index + 1]!.virtualPotentialTemperatureK;
    const gravityMs2 = Math.sqrt(lowerPoint.gravityMs2 * upperPoint.gravityMs2);
    const bruntVaisalaFrequencySquaredS2 =
      gravityMs2 * Math.log(thetaUpper / thetaLower) / centreDistanceM;
    if (!Number.isFinite(bruntVaisalaFrequencySquaredS2)) {
      return rejected('сухая статическая устойчивость неконечна на интерфейсе «' + lower.layerId + '/' + upper.layerId + '»');
    }
    const isUnstable = bruntVaisalaFrequencySquaredS2 < -DRY_STABILITY_NUMERICAL_TOLERANCE_S2;
    const mixingLengthM = Math.min(
      configuration.mixingLengthScaleHeightFraction *
        Math.sqrt(lowerPoint.scaleHeightM * upperPoint.scaleHeightM),
      centreDistanceM
    );
    const convectiveVelocityScaleMs = isUnstable
      ? mixingLengthM * Math.sqrt(-bruntVaisalaFrequencySquaredS2)
      : 0;
    const convectiveDiffusivityM2S = isUnstable
      ? configuration.efficiencyCoefficient * mixingLengthM * convectiveVelocityScaleMs
      : 0;
    if (
      !isFinitePositive(mixingLengthM) ||
      !Number.isFinite(convectiveVelocityScaleMs) ||
      !Number.isFinite(convectiveDiffusivityM2S) ||
      convectiveDiffusivityM2S < 0
    ) {
      return rejected('коэффициенты mixing-length конвекции некорректны на интерфейсе «' + lower.layerId + '/' + upper.layerId + '»');
    }
    interfaces.push({
      lowerLayerId: lower.layerId,
      upperLayerId: upper.layerId,
      centerDistanceM,
      virtualPotentialTemperatureLowerK: thetaLower,
      virtualPotentialTemperatureUpperK: thetaUpper,
      bruntVaisalaFrequencySquaredS2,
      isDryConvectivelyUnstable: isUnstable,
      mixingLengthM,
      convectiveVelocityScaleMs,
      convectiveDiffusivityM2S
    });
  }

  const audit: DryConvectiveMixingAudit = {
    method: 'dry_mixing_length_virtual_potential_temperature',
    referencePressurePa: DRY_CONVECTIVE_REFERENCE_PRESSURE_PA,
    mixingLengthScaleHeightFraction: configuration.mixingLengthScaleHeightFraction,
    efficiencyCoefficient: configuration.efficiencyCoefficient,
    provenance: { ...configuration.provenance },
    heatTransport: 'not_modelled',
    interfaces: interfaces.map((entry) => ({ ...entry }))
  };
  return {
    status: 'completed',
    interfaces,
    audit,
    diagnostics: []
  };
}
