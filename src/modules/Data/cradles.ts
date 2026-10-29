// ============================================
// CRADLES - Life cradle environments
// ============================================

import type { CradleOption, EnergySourceClass } from '../../types';

const cradles: CradleOption[] = [
  {
    id: 'supercritical_water',
    name: 'Сверхкритическая вода',
    matterState: 'supercritical_fluid',
    requiredTemperatureRange: { min: 647, max: 1000 },
    requiredPressureRange: { min: 22.1, max: 500 },
    chemicalFeatures: ['High solubility', 'No phase boundary', 'High reactivity'] as string[],
    availableEnergySources: ['geothermal', 'chemical'] as EnergySourceClass[],
    chemicalConstraints: ['Requires high pressure and temperature', 'Organic molecules may be unstable'] as string[],
    solventTypes: ['Supercritical water'],
    compatibilityRequirements: ['Planet must have significant water content and internal heat source'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['water', 'high_pressure', 'high_temperature', 'supercritical']
  },
  {
    id: 'liquid_ammonia',
    name: 'Жидкий аммиак',
    matterState: 'liquid',
    requiredTemperatureRange: { min: 195, max: 405 },
    requiredPressureRange: { min: 1, max: 100 },
    chemicalFeatures: ['Good solvent for organic compounds', 'High nitrogen content', 'Alkaline properties'] as string[],
    availableEnergySources: ['geothermal', 'chemical'] as EnergySourceClass[],
    chemicalConstraints: ['Low temperature range', 'Ammonia toxicity', 'Requires nitrogen-rich environment'] as string[],
    solventTypes: ['Liquid ammonia'],
    compatibilityRequirements: ['Planet must have ammonia in significant quantities'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['ammonia', 'cryogenic', 'nitrogen']
  },
  {
    id: 'liquid_methane_ethane',
    name: 'Жидкий метан/этан',
    matterState: 'liquid',
    requiredTemperatureRange: { min: 90, max: 200 },
    requiredPressureRange: { min: 1, max: 50 },
    chemicalFeatures: ['Non-polar solvent', 'Hydrocarbon chemistry', 'Low temperature reactions'] as string[],
    availableEnergySources: ['geothermal', 'chemical'] as EnergySourceClass[],
    chemicalConstraints: ['Very low temperatures', 'Limited chemical diversity', 'Requires hydrocarbon-rich environment'] as string[],
    solventTypes: ['Liquid methane', 'Liquid ethane', 'Methane-ethane mixture'],
    compatibilityRequirements: ['Planet must have significant hydrocarbon content'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['hydrocarbon', 'cryogenic', 'titan_like']
  },
  {
    id: 'supercritical_co2',
    name: 'Сверхкритический CO₂',
    matterState: 'supercritical_fluid',
    requiredTemperatureRange: { min: 548, max: 1000 },
    requiredPressureRange: { min: 73.8, max: 500 },
    chemicalFeatures: ['High solubility for organic compounds', 'Non-polar properties', 'High diffusivity'] as string[],
    availableEnergySources: ['geothermal', 'chemical'] as EnergySourceClass[],
    chemicalConstraints: ['Requires high pressure and temperature', 'CO2-rich environment', 'Acidic properties'] as string[],
    solventTypes: ['Supercritical CO2'],
    compatibilityRequirements: ['Planet must have significant CO2 content and internal heat'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['co2', 'high_pressure', 'high_temperature', 'supercritical']
  },
  {
    id: 'h2o_co2_supercritical_mix',
    name: 'Смесь H₂O–CO₂ в сверхкритическом состоянии',
    matterState: 'supercritical_fluid',
    requiredTemperatureRange: { min: 647, max: 1000 },
    requiredPressureRange: { min: 100, max: 500 },
    chemicalFeatures: ['Complex solubility', 'Mixed polarity', 'High reactivity'] as string[],
    availableEnergySources: ['geothermal', 'chemical'] as EnergySourceClass[],
    chemicalConstraints: ['Requires very high pressure and temperature', 'Complex phase behavior'] as string[],
    solventTypes: ['Supercritical water-CO2 mixture'],
    compatibilityRequirements: ['Planet must have both water and CO2 in significant quantities with strong heat source'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['water', 'co2', 'mixed', 'high_pressure', 'high_temperature', 'supercritical']
  },
  {
    id: 'hydrogen_helium_aerosols',
    name: 'Водородно-гелиевая оболочка с аэрозолями',
    matterState: 'aerosol',
    requiredTemperatureRange: { min: 50, max: 500 },
    requiredPressureRange: { min: 0.1, max: 10 },
    chemicalFeatures: ['Low density', 'High reducing potential', 'Aerosol chemistry'] as string[],
    availableEnergySources: ['stellar_radiation', 'chemical'] as EnergySourceClass[],
    chemicalConstraints: ['Very low density', 'Difficult for complex chemistry', 'Requires constant replenishment'] as string[],
    solventTypes: ['Aerosol droplets'],
    compatibilityRequirements: ['Gas giant atmosphere or thick hydrogen-helium envelope'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['hydrogen', 'helium', 'aerosol', 'low_density', 'atmospheric']
  },
  {
    id: 'molten_salts',
    name: 'Расплавленные соли',
    matterState: 'liquid',
    requiredTemperatureRange: { min: 1000, max: 2000 },
    requiredPressureRange: { min: 1, max: 100 },
    chemicalFeatures: ['Ionic solvent', 'High temperature stability', 'Electrochemical potential'] as string[],
    availableEnergySources: ['geothermal', 'chemical'] as EnergySourceClass[],
    chemicalConstraints: ['Extremely high temperatures', 'Corrosive environment', 'Limited organic stability'] as string[],
    solventTypes: ['Molten salts (e.g., NaCl, KCl)'],
    compatibilityRequirements: ['Planet must have significant salt deposits and extreme internal heat'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['salt', 'high_temperature', 'ionic', 'molten']
  }
];

export default cradles;
