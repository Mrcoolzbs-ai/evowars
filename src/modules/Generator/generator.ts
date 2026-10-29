// ============================================
// GENERATOR - World generation functions
// ============================================

import { createRandom } from './random';
import type {
  GeneratedWorld,
  GenerationSettings,
  GenerationMode,
  CosmologyOption,
  EpochOption,
  CentralObjectOption,
  CelestialBodyOption,
  CradleOption,
  GenerationWarning,
  AtmosphereState,
  PhysicalCharacteristics,
  EnergySources,
  CausalChain,
  EvolutionImplications,
  FixedCategories
} from '../../types';
import { GENERATOR_VERSION } from '../../types';

import { cosmologies, epochs, centralObjects, celestialBodies, cradles } from '../Data';
import { checkCompatibility } from '../Compatibility';
import { createAtmosphere, normalizeAtmosphere } from '../Atmosphere';
import { calculatePhysicalCharacteristics } from '../WorldModel';

// ============================================
// GENERATION FUNCTIONS
// ============================================

export function generateWorld(settings: GenerationSettings): GeneratedWorld {
  const rng = createRandom(settings.seed);
  
  const cosmology = selectCosmology(rng, settings);
  const epoch = selectEpoch(rng, settings);
  const centralObject = selectCentralObject(rng, settings, epoch);
  const celestialBody = selectCelestialBody(rng, settings, centralObject);
  const cradle = selectCradle(rng, settings);
  
  const mode: GenerationMode = settings.mode || (cosmology.isAnomalous || isAnomalousCosmologySelected(settings) ? 'anomalous' : 'realistic');

  const compatibilityWarnings = checkCompatibility({
    cosmology,
    epoch,
    centralObject,
    celestialBody,
    cradle
  }, mode);

  const atmosphere = generateAtmosphere(rng, settings);
  const physicalCharacteristics = calculatePhysicalCharacteristics({
    centralObject,
    celestialBody,
    cradle,
    atmosphere
  });

  const energySources = determineEnergySources(centralObject, cradle);
  const causalChain = createCausalChain({
    cosmology,
    epoch,
    centralObject,
    celestialBody,
    cradle,
    atmosphere,
    physicalCharacteristics,
    energySources
  });

  const evolutionImplications = determineEvolutionImplications({
    cosmology,
    centralObject,
    celestialBody,
    cradle,
    atmosphere,
    physicalCharacteristics,
    energySources
  });

  const scientificStatus = determineScientificStatus({
    cosmology,
    epoch,
    centralObject,
    celestialBody,
    cradle,
    warnings: compatibilityWarnings
  });

  const worldId = rng.generateId('world');

  return {
    id: worldId,
    createdAt: new Date().toISOString(),
    seed: settings.seed,
    generatorVersion: GENERATOR_VERSION,
    mode,
    cosmology,
    epoch,
    centralObject,
    celestialBody,
    cradle,
    physicalCharacteristics,
    energySources,
    atmosphere,
    appliedRules: compatibilityWarnings.map(w => w.ruleId),
    warnings: compatibilityWarnings,
    scientificStatus,
    causalChain,
    evolutionImplications,
    userModifications: {}
  };
}

function selectCosmology(rng: any, settings: GenerationSettings): CosmologyOption {
  if (settings.fixedCategories?.cosmology) {
    const fixed = cosmologies.find((c) => c.id === settings.fixedCategories.cosmology);
    if (fixed) return fixed;
  }
  const weights = settings.weights?.cosmology || {};
  return rng.chooseWeighted(cosmologies, weights, (c: any) => c.id);
}

function selectEpoch(rng: any, settings: GenerationSettings): EpochOption {
  if (settings.fixedCategories?.epoch) {
    const fixed = epochs.find((e) => e.id === settings.fixedCategories.epoch);
    if (fixed) return fixed;
  }
  const weights = settings.weights?.epoch || {};
  return rng.chooseWeighted(epochs, weights, (e: any) => e.id);
}

function selectCentralObject(rng: any, settings: GenerationSettings, epoch: EpochOption): CentralObjectOption {
  if (settings.fixedCategories?.centralObject) {
    const fixed = centralObjects.find((o) => o.id === settings.fixedCategories.centralObject);
    if (fixed) return fixed;
  }
  const epochAge = epoch.ageRange;
  const compatibleObjects = centralObjects.filter((obj: any) => {
    if (obj.minAge === null && obj.maxAge === null) return true;
    if (obj.minAge !== null && epochAge.min < obj.minAge) return false;
    if (obj.maxAge !== null && epochAge.max > obj.maxAge) return false;
    return true;
  });
  if (compatibleObjects.length === 0) {
    console.warn('No central objects compatible with selected epoch, using all');
    return rng.chooseWeighted(centralObjects, settings.weights?.centralObject || {}, (o: any) => o.id);
  }
  const weights = settings.weights?.centralObject || {};
  return rng.chooseWeighted(compatibleObjects, weights, (o: any) => o.id);
}

function selectCelestialBody(rng: any, settings: GenerationSettings, centralObject: CentralObjectOption): CelestialBodyOption {
  if (settings.fixedCategories?.celestialBody) {
    const fixed = celestialBodies.find((b) => b.id === settings.fixedCategories.celestialBody);
    if (fixed) return fixed;
  }
  const compatibleBodies = celestialBodies.filter((body: any) => {
    if (body.compatibleCentralObjects.length === 0) return true;
    return body.compatibleCentralObjects.includes(centralObject.id);
  });
  if (compatibleBodies.length === 0) {
    console.warn('No celestial bodies compatible with selected central object, using all');
    return rng.chooseWeighted(celestialBodies, settings.weights?.celestialBody || {}, (b: any) => b.id);
  }
  const weights = settings.weights?.celestialBody || {};
  return rng.chooseWeighted(compatibleBodies, weights, (b: any) => b.id);
}

function selectCradle(rng: any, settings: GenerationSettings): CradleOption {
  if (settings.fixedCategories?.cradle) {
    const fixed = cradles.find((c) => c.id === settings.fixedCategories.cradle);
    if (fixed) return fixed;
  }
  const compatibleCradles = cradles.filter((_cradle: any) => true);
  if (compatibleCradles.length === 0) {
    console.warn("No cradles compatible, using all");
    return rng.chooseWeighted(cradles, settings.weights?.cradle || {}, (c: any) => c.id);
  }
  const weights = settings.weights?.cradle || {};
  return rng.chooseWeighted(compatibleCradles, weights, (c: any) => c.id);
}

function generateAtmosphere(rng: any, settings: GenerationSettings): AtmosphereState {
  if (settings.customAtmosphere) {
    return normalizeAtmosphere(settings.customAtmosphere);
  }
  if (settings.atmospherePreset) {
    return createAtmosphere(settings.atmospherePreset, rng);
  }
  return createAtmosphere('methane_ethane', rng);
}

function isAnomalousCosmologySelected(settings: GenerationSettings): boolean {
  if (settings.fixedCategories?.cosmology) {
    const cosmology = cosmologies.find((c) => c.id === settings.fixedCategories.cosmology);
    return cosmology?.isAnomalous || false;
  }
  return false;
}

function determineEnergySources(
  centralObject: CentralObjectOption,
  cradle: CradleOption
): EnergySources {
  const primary: EnergySources['primary'] = [];
  const secondary: EnergySources['secondary'] = [];
  centralObject.potentialEnergySources.forEach(source => {
    if (!primary.includes(source as any)) {
      primary.push(source as any);
    }
  });
  cradle.availableEnergySources.forEach(source => {
    if (!primary.includes(source) && !secondary.includes(source)) {
      secondary.push(source);
    }
  });
  if (!primary.includes('geothermal' as any) && !secondary.includes('geothermal' as any)) {
    secondary.push('geothermal' as any);
  }
  return {
    primary,
    secondary,
    description: `Main energy sources: ${primary.join(', ')}. Additional: ${secondary.join(', ')}.`
  };
}

function createCausalChain(params: {
  cosmology: CosmologyOption;
  epoch: EpochOption;
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
  atmosphere: AtmosphereState;
  physicalCharacteristics: PhysicalCharacteristics;
  energySources: EnergySources;
}): CausalChain {
  return {
    cosmology: `${params.cosmology.name}: ${params.cosmology.generationImpact}`,
    epoch: `${params.epoch.name} (${params.epoch.ageRange.min}-${params.epoch.ageRange.max} bln years): ${params.epoch.description}`,
    centralObject: `${params.centralObject.name} defines conditions: ${params.centralObject.characteristicConstraints.join(', ')}`,
    celestialBody: `${params.celestialBody.name} fits environment: ${params.celestialBody.geologicalProperties.join(', ')}`,
    cradle: `${params.cradle.name} fits conditions: ${params.cradle.chemicalFeatures.join(', ')}`,
    chemicalConstraints: params.cradle.chemicalConstraints,
    energySources: params.energySources.primary.map(s => s as string),
    lifeChallenges: [
      ...params.centralObject.potentialThreats,
      ...params.celestialBody.typicalConstraints,
      ...params.cradle.chemicalConstraints
    ],
    unknowns: [
      `Atmosphere params: ${params.atmosphere.notes || 'undefined'}`,
      `Geological activity: ${params.physicalCharacteristics.geologicalActivity || 'undefined'}`
    ]
  };
}

function determineEvolutionImplications(params: {
  cosmology: CosmologyOption;
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
  atmosphere: AtmosphereState;
  physicalCharacteristics: PhysicalCharacteristics;
  energySources: EnergySources;
}): EvolutionImplications {
  const possibleAdaptations: string[] = [];
  const constraints: string[] = [];
  const opportunities: string[] = [];
  const uncertainties: string[] = [];
  if (params.cradle.matterState === 'liquid') {
    possibleAdaptations.push('Adaptation to liquid environment');
  }
  if (params.cradle.matterState === 'supercritical_fluid') {
    possibleAdaptations.push('Adaptation to supercritical conditions');
    constraints.push('High temperature and pressure');
  }
  if (params.atmosphere.components.some(c => c.gasId === 'ch4' && c.percentage > 10)) {
    possibleAdaptations.push('Methanotrophic metabolism');
  }
  if (params.atmosphere.components.some(c => c.gasId === 'nh3' && c.percentage > 1)) {
    constraints.push('Ammonia toxicity');
  }
  if (params.energySources.primary.includes('stellar_radiation' as any)) {
    opportunities.push('Photosynthesis');
  }
  if (params.energySources.primary.includes('geothermal' as any) || 
      params.energySources.secondary.includes('geothermal' as any)) {
    opportunities.push('Chemosynthesis');
  }
  if (params.cosmology.isAnomalous) {
    uncertainties.push('Unstable physical laws');
  }
  return {
    possibleAdaptations,
    constraints,
    opportunities,
    uncertainties
  };
}

function determineScientificStatus(params: {
  cosmology: CosmologyOption;
  epoch: EpochOption;
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
  warnings: GenerationWarning[];
}): any {
  if (params.cosmology.isAnomalous) {
    return 'anomalous_rule';
  }
  if (params.warnings.some(w => w.severity === 'error')) {
    return 'impossible_in_model';
  }
  if (params.warnings.some(w => w.severity === 'warning')) {
    return 'hypothetical';
  }
  const statuses = [
    params.cosmology.scientificStatus,
    params.epoch.scientificStatus,
    params.centralObject.scientificStatus,
    params.celestialBody.scientificStatus,
    params.cradle.scientificStatus
  ];
  if (statuses.some(s => s === 'hypothetical')) {
    return 'hypothetical';
  }
  if (statuses.every(s => s === 'established_fact' || s === 'physically_plausible')) {
    return 'physically_plausible';
  }
  return 'physically_plausible';
}

export function generateMultipleWorlds(settings: GenerationSettings, count: number): GeneratedWorld[] {
  const worlds: GeneratedWorld[] = [];
  for (let i = 0; i < count; i++) {
    const worldSettings: GenerationSettings = {
      ...settings,
      seed: settings.seed + `_${i}`
    };
    worlds.push(generateWorld(worldSettings));
  }
  return worlds;
}

export function generateWorldWithFixedCategories(
  settings: GenerationSettings,
  fixedCategories: FixedCategories
): GeneratedWorld {
  const updatedSettings: GenerationSettings = {
    ...settings,
    fixedCategories: {
      ...settings.fixedCategories,
      ...fixedCategories
    }
  };
  return generateWorld(updatedSettings);
}

export function generateRandomSeed(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
