// ============================================
// GENERATOR - World generation functions
// ============================================
//
// Порядок генерации (исправлен по результатам аудита):
// 1. Космология и режим (аномальная космология принудительно
//    активирует аномальный режим).
// 2. Эпоха.
// 3. Центральный объект (с учётом возраста эпохи).
// 4. Небесное тело (с учётом центрального объекта).
// 5. Атмосфера.
// 6. Физические характеристики тела (только известные данные).
// 7. Колыбель жизни — с фильтром поддерживаемых вариантов;
//    если пользователь зафиксировал колыбель, она используется как есть,
//    а несовместимость отмечается предупреждениями.
// 8. Локальная среда колыбели (отдельно от атмосферы планеты).
// 9. Полные физические характеристики.
// 10. Источники энергии.
// 11. Проверка совместимости на реальных данных мира.
//
// Этап 3 — физическая модель (причинно-следственная цепочка):
// после выбора атмосферы сэмплируются физические параметры тела
// (масса/радиус/плотность/гравитация), строится система центрального
// объекта, орбита, атмосферная физическая модель (молярные доли,
// парциальные давления, столб), фазовый скрининг, геологический
// анализ, энергетический бюджет и начальное состояние химической
// эволюции. Каждый следующий этап использует данные предыдущих,
// а не независимую случайность.

import { createRandom } from './random';
import type {
  GeneratedWorld,
  GenerationSettings,
  GenerationMode,
  GenerationWarning,
  CosmologyOption,
  EpochOption,
  CentralObjectOption,
  CelestialBodyOption,
  CradleOption,
  AtmosphereState,
  PhysicalCharacteristics,
  EnergySources,
  CausalChain,
  EvolutionImplications,
  FixedCategories,
  CradleLocalEnvironment,
  EnergySourceClass,
  GeologicalAnalysis
} from '../../types';
import { GENERATOR_VERSION } from '../../types';

import { cosmologies, epochs, centralObjects, celestialBodies, cradles } from '../Data';
import { getEarliestUniverseAgeGyr } from '../Data/starPhysical';
import { checkCompatibility, CRADLE_RELATED_CATEGORIES } from '../Compatibility';
import { createAtmosphere, normalizeAtmosphere, computeAtmospherePhysicalModel } from '../Atmosphere';
import {
  calculatePhysicalCharacteristics,
  calculateBodyCharacteristics,
  determineCradleLocalEnvironment,
  sampleBodyPhysics
} from '../WorldModel';
import { buildCentralObjectSystem, sampleOrbit } from '../OrbitalMechanics';
import { analyzeAtmospherePhases } from '../PhaseEquilibrium';
import { analyzeGeology } from '../Geology';
import { computeEnergyBudget } from '../EnergyBalance';
import { createChemicalState } from '../ChemicalEvolution';

// ============================================
// ГЛАВНАЯ ФУНКЦИЯ ГЕНЕРАЦИИ
// ============================================

export function generateWorld(settings: GenerationSettings): GeneratedWorld {
  const rng = createRandom(settings.seed);

  // 1. Космология
  const cosmology = selectCosmology(rng, settings);

  // 2. Режим: аномальная космология ВСЕГДА активирует аномальный режим.
  // Заданный пользователем realistic не может молча перекрывать
  // требования аномальной космологии.
  const { mode, modeWarnings } = resolveMode(settings, cosmology);

  // 3. Эпоха
  const epoch = selectEpoch(rng, settings);

  // 4. Центральный объект
  const centralObject = selectCentralObject(rng, settings, epoch, mode);

  // 5. Небесное тело
  const celestialBody = selectCelestialBody(rng, settings, centralObject);

  // 6. Атмосфера
  const atmosphere = generateAtmosphere(rng, settings);

  // 6a. Физические параметры тела (этап 3): масса, радиус, плотность,
  // гравитация сэмплируются детерминированно из диапазонов каталога.
  const bodyPhysics = sampleBodyPhysics(celestialBody, rng);

  // 6b. Структурированная система центрального объекта (звезда /
  // остаток / субзвёздный объект / система гиганта / система джета).
  const centralObjectSystem = buildCentralObjectSystem(centralObject);

  // 6c. Орбитальная конфигурация: вокруг звезды, родительской планеты
  // (для спутников), свободное плавание или окрестность джета.
  const orbit = sampleOrbit(rng, {
    centralObject,
    celestialBody,
    parentBodyRadiusM: bodyPhysics.radiusM.value
  });

  // 7. Характеристики небесного тела, зависящие только от тела,
  // центрального объекта и атмосферы (без колыбели).
  // При наличии физической выборки используются её масса/радиус/гравитация.
  const bodyCharacteristics = calculateBodyCharacteristics({
    centralObject,
    celestialBody,
    atmosphere,
    bodyPhysics
  });

  // 8. Колыбель жизни: сначала варианты, поддерживаемые данным миром
  const { cradle, cradleWarnings } = selectCradle(rng, settings, {
    mode,
    centralObject,
    celestialBody,
    atmosphere,
    bodyCharacteristics
  });

  // 9. Локальная среда колыбели — отдельно от атмосферы планеты
  const cradleLocalEnvironment = determineCradleLocalEnvironment({
    cradle,
    celestialBody,
    atmosphere
  });

  // 10. Полные физические характеристики
  const physicalCharacteristics = calculatePhysicalCharacteristics({
    centralObject,
    celestialBody,
    cradle,
    atmosphere
  });

  // 10a. Физическая модель атмосферы (этап 3): молярные доли, давление
  // в Па, парциальные давления, атмосферный столб. Столб рассчитывается
  // только при известной гравитации сэмплированного тела.
  const atmospherePhysics = computeAtmospherePhysicalModel(atmosphere, {
    surfaceGravityMs2: bodyPhysics.surfaceGravityMs2.value
  });

  // 10b. Фазовый скрининг компонентов атмосферы при её температуре.
  const phaseAnalysis = analyzeAtmospherePhases(atmospherePhysics, atmosphere.temperature);

  // 10c. Геологический анализ: раздельные источники внутреннего тепла
  // (остаточное, радиогенное, приливное) без автоматической геотермы.
  const geologyAnalysis = analyzeGeology({ celestialBody, centralObject, orbit });

  // 10d. Энергетический бюджет: поток излучения и равновесная температура
  // из светимости класса и орбитального расстояния (или unknown).
  const energyBudget = computeEnergyBudget({
    centralObjectId: centralObject.id,
    centralObjectSystem: centralObjectSystem ?? undefined,
    orbit,
    geologyAnalysis
  });

  // 11. Источники энергии. Геотермальная энергия добавляется ТОЛЬКО
  // если геологический анализ подтвердил её доступность.
  const energySources = determineEnergySources(centralObject, cradle, geologyAnalysis);

  // 11a. Начальное состояние химической эволюции: инвентарь веществ
  // (моль/м² столба при известных данных, иначе нормированный игровой).
  const chemicalState = createChemicalState({
    atmospherePhysicalModel: atmospherePhysics,
    surfaceGravityMs2: bodyPhysics.surfaceGravityMs2.value
  });

  // 12. Проверка совместимости на РЕАЛЬНЫХ данных сгенерированного мира
  // (включая фазовый скрининг атмосферы)
  const compatibilityWarnings = checkCompatibility({
    mode,
    cosmology,
    epoch,
    centralObject,
    celestialBody,
    cradle,
    cradleLocalEnvironment,
    physicalCharacteristics,
    atmosphere,
    energySources,
    phaseAnalysis
  }, mode);

  const allWarnings = [...modeWarnings, ...cradleWarnings, ...compatibilityWarnings];

  const causalChain = createCausalChain({
    cosmology,
    epoch,
    centralObject,
    celestialBody,
    cradle,
    atmosphere,
    cradleLocalEnvironment,
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
    mode,
    warnings: allWarnings
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
    cradleLocalEnvironment,
    physicalCharacteristics,
    energySources,
    atmosphere,
    centralObjectSystem,
    orbit,
    bodyPhysics,
    atmospherePhysics,
    phaseAnalysis,
    geologyAnalysis,
    energyBudget,
    chemicalState,
    appliedRules: allWarnings.map(w => w.ruleId),
    warnings: allWarnings,
    scientificStatus,
    causalChain,
    evolutionImplications,
    userModifications: {}
  };
}

// ============================================
// ВЫБОР КАТЕГОРИЙ
// ============================================

function selectCosmology(rng: ReturnType<typeof createRandom>, settings: GenerationSettings): CosmologyOption {
  if (settings.fixedCategories?.cosmology) {
    const fixed = cosmologies.find((c) => c.id === settings.fixedCategories.cosmology);
    if (fixed) return fixed;
  }
  const weights = settings.weights?.cosmology || {};
  return rng.chooseWeighted(cosmologies, weights, (c) => c.id);
}

function selectEpoch(rng: ReturnType<typeof createRandom>, settings: GenerationSettings): EpochOption {
  if (settings.fixedCategories?.epoch) {
    const fixed = epochs.find((e) => e.id === settings.fixedCategories.epoch);
    if (fixed) return fixed;
  }
  const weights = settings.weights?.epoch || {};
  return rng.chooseWeighted(epochs, weights, (e) => e.id);
}

function selectCentralObject(
  rng: ReturnType<typeof createRandom>,
  settings: GenerationSettings,
  epoch: EpochOption,
  mode: GenerationMode
): CentralObjectOption {
  if (settings.fixedCategories?.centralObject) {
    const fixed = centralObjects.find((o) => o.id === settings.fixedCategories.centralObject);
    if (fixed) return fixed;
  }
  const epochAge = epoch.ageRange;
  // В аномальном режиме возрастные ограничения не применяются
  // (соответствует exemptInAnomalousMode правила age_central_object_compatibility).
  //
  // Этап 3: класс центрального объекта отсекается ТОЛЬКО если Вселенная
  // ещё слишком молода для формирования объектов этого класса
  // (например, белые карлики не существуют до появления звёзд-предшественниц).
  // Короткоживущая звезда (голубой гигант) НЕ запрещена в древней
  // Вселенной: она могла сформироваться недавно — это отмечается
  // предупреждением short_lived_star_recent_formation, а не фильтром.
  const ageCompatibleObjects = mode === 'anomalous'
    ? centralObjects
    : centralObjects.filter((obj) => {
        const earliest =
          obj.existenceWindow?.earliestUniverseAgeGyr ??
          getEarliestUniverseAgeGyr(obj.id);
        return epochAge.max >= earliest;
      });
  if (ageCompatibleObjects.length === 0) {
    console.warn('No central objects compatible with selected epoch, using all');
    const weights = settings.weights?.centralObject || {};
    return rng.chooseWeighted(centralObjects, weights, (o) => o.id);
  }
  const weights = settings.weights?.centralObject || {};
  return rng.chooseWeighted(ageCompatibleObjects, weights, (o) => o.id);
}

function selectCelestialBody(
  rng: ReturnType<typeof createRandom>,
  settings: GenerationSettings,
  centralObject: CentralObjectOption
): CelestialBodyOption {
  if (settings.fixedCategories?.celestialBody) {
    const fixed = celestialBodies.find((b) => b.id === settings.fixedCategories.celestialBody);
    if (fixed) return fixed;
  }
  const compatibleBodies = celestialBodies.filter((body) => {
    if (body.compatibleCentralObjects.length === 0) return true;
    return body.compatibleCentralObjects.includes(centralObject.id);
  });
  if (compatibleBodies.length === 0) {
    console.warn('No celestial bodies compatible with selected central object, using all');
    const weights = settings.weights?.celestialBody || {};
    return rng.chooseWeighted(celestialBodies, weights, (b) => b.id);
  }
  const weights = settings.weights?.celestialBody || {};
  return rng.chooseWeighted(compatibleBodies, weights, (b) => b.id);
}

/**
 * Выбор колыбели жизни.
 *
 * Для случайного выбора рассматриваются только колыбели, которые могут
 * быть поддержаны данным сочетанием (небесное тело + атмосфера +
 * центральный объект). Проверка выполняется теми же правилами
 * совместимости, что и итоговая проверка мира (без заглушек).
 *
 * Если пользователь зафиксировал колыбель вручную, она используется
 * как есть: несовместимость фиксируется предупреждениями совместимости.
 */
function selectCradle(
  rng: ReturnType<typeof createRandom>,
  settings: GenerationSettings,
  context: {
    mode: GenerationMode;
    centralObject: CentralObjectOption;
    celestialBody: CelestialBodyOption;
    atmosphere: AtmosphereState;
    bodyCharacteristics: PhysicalCharacteristics;
  }
): { cradle: CradleOption; cradleWarnings: GenerationWarning[] } {
  const cradleWarnings: GenerationWarning[] = [];

  // Пользователь зафиксировал колыбель: используем её без фильтра,
  // предупреждения совместимости покажут реальные проблемы.
  if (settings.fixedCategories?.cradle) {
    const fixed = cradles.find((c) => c.id === settings.fixedCategories.cradle);
    if (fixed) {
      return { cradle: fixed, cradleWarnings };
    }
  }

  const weights = settings.weights?.cradle || {};

  // Оцениваем каждую колыбель реальными правилами совместимости
  const supportedCradles = cradles.filter((cradle) =>
    isCradleSupportedOnWorld(cradle, context)
  );

  if (supportedCradles.length === 0) {
    // Ни одна колыбеля не поддерживается данным сочетанием условий:
    // выбираем из общего списка, а предупреждения совместимости
    // покажут, какие требования нарушены.
    console.warn('No cradles fully supported by this world configuration, using all cradles');
    cradleWarnings.push({
      id: 'warn_cradle_support_fallback',
      ruleId: 'cradle_support_fallback',
      category: 'matter_state',
      severity: 'warning',
      message: 'Ни одна колыбель жизни не поддерживается данным сочетанием условий; колыбель выбрана из общего списка — смотрите предупреждения совместимости.',
      suggestions: [
        'Измените атмосферу или небесное тело',
        'Зафиксируйте колыбель вручную',
        'Используйте аномальный режим для экзотических конфигураций'
      ],
      affectedFields: ['cradle']
    });
    return { cradle: rng.chooseWeighted(cradles, weights, (c) => c.id), cradleWarnings };
  }

  return { cradle: rng.chooseWeighted(supportedCradles, weights, (c) => c.id), cradleWarnings };
}

/**
 * Может ли колыбель быть поддержана данным миром.
 * Использует реальные правила совместимости (те же, что и итоговая
 * проверка): колыбель поддержана, если ни одно правило категорий,
 * относящихся к колыбели, не даёт ошибки.
 */
function isCradleSupportedOnWorld(
  cradle: CradleOption,
  context: {
    mode: GenerationMode;
    centralObject: CentralObjectOption;
    celestialBody: CelestialBodyOption;
    atmosphere: AtmosphereState;
    bodyCharacteristics: PhysicalCharacteristics;
  }
): boolean {
  const cradleLocalEnvironment = determineCradleLocalEnvironment({
    cradle,
    celestialBody: context.celestialBody,
    atmosphere: context.atmosphere
  });

  const warnings = checkCompatibility({
    mode: context.mode,
    centralObject: context.centralObject,
    celestialBody: context.celestialBody,
    atmosphere: context.atmosphere,
    cradle,
    cradleLocalEnvironment,
    physicalCharacteristics: context.bodyCharacteristics
  }, context.mode);

  // Ошибка в правилах, относящихся к колыбели, означает,
  // что эта колыбель не может быть поддержана данным миром.
  return !warnings.some(
    w => w.severity === 'error' && CRADLE_RELATED_CATEGORIES.includes(w.category)
  );
}

// ============================================
// РЕЖИМ ГЕНЕРАЦИИ
// ============================================

/**
 * Определение режима генерации.
 *
 * Аномальная космология («Пленение Чудовища», «Симуляция», «Сон»,
 * «Мир как тело») ВСЕГДА активирует аномальный режим, даже если
 * пользователь задал realistic: заданный режим не может молча
 * перекрывать требования выбранной аномальной космологии.
 */
function resolveMode(
  settings: GenerationSettings,
  cosmology: CosmologyOption
): { mode: GenerationMode; modeWarnings: GenerationWarning[] } {
  if (cosmology.isAnomalous) {
    const mode: GenerationMode = 'anomalous';
    const modeWarnings: GenerationWarning[] = [];

    if (settings.mode !== 'anomalous') {
      modeWarnings.push({
        id: 'warn_anomalous_cosmology_mode_automatic_activation',
        ruleId: 'anomalous_cosmology_mode_automatic_activation',
        category: 'cosmology_physics',
        severity: 'info',
        message: `Аномальная космология «${cosmology.name}» автоматически активировала аномальный режим генерации (запрошенный режим «${settings.mode}» перекрыт).`,
        suggestions: [
          'Выберите неаномальную космологию, чтобы использовать реалистичный режим',
          'Продолжайте в аномальном режиме: физические проверки колыбели и среды остаются активными'
        ],
        affectedFields: ['cosmology', 'mode']
      });
    }

    return { mode, modeWarnings };
  }

  const mode: GenerationMode = settings.mode === 'anomalous' ? 'anomalous' : 'realistic';
  return { mode, modeWarnings: [] };
}

// ============================================
// АТМОСФЕРА
// ============================================

function generateAtmosphere(rng: ReturnType<typeof createRandom>, settings: GenerationSettings): AtmosphereState {
  if (settings.customAtmosphere) {
    // Пользовательская атмосфера нормализуется в строгом режиме:
    // состав, превышающий 100%, считается ошибкой данных.
    return normalizeAtmosphere(settings.customAtmosphere, { mode: 'strict' });
  }
  if (settings.atmospherePreset) {
    return createAtmosphere(settings.atmospherePreset, rng);
  }
  return createAtmosphere('methane_ethane', rng);
}

// ============================================
// ПРОИЗВОДНЫЕ ДАННЫЕ МИРА
// ============================================

function determineEnergySources(
  centralObject: CentralObjectOption,
  cradle: CradleOption,
  geologyAnalysis?: GeologicalAnalysis
): EnergySources {
  const primary: EnergySources['primary'] = [];
  const secondary: EnergySources['secondary'] = [];
  centralObject.potentialEnergySources.forEach(source => {
    if (!primary.includes(source as EnergySourceClass)) {
      primary.push(source as EnergySourceClass);
    }
  });
  cradle.availableEnergySources.forEach(source => {
    if (!primary.includes(source) && !secondary.includes(source)) {
      secondary.push(source);
    }
  });
  // Геотермальная энергия НЕ добавляется автоматически каждому миру:
  // только если геологический анализ подтвердил наличие доступного
  // внутреннего тепла (этап 3).
  if (geologyAnalysis?.geothermalEnergyAvailable) {
    if (!primary.includes('geothermal') && !secondary.includes('geothermal')) {
      secondary.push('geothermal');
    }
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
  cradleLocalEnvironment: CradleLocalEnvironment;
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
      `Geological activity: ${params.physicalCharacteristics.geologicalActivity || 'undefined'}`,
      `Cradle local environment: ${params.cradleLocalEnvironment.locationDescription}; ` +
        `exact temperature/pressure of the medium are unknown and not substituted with arbitrary values`
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
  if (params.energySources.primary.includes('stellar_radiation')) {
    opportunities.push('Photosynthesis');
  }
  if (params.energySources.primary.includes('geothermal') ||
      params.energySources.secondary.includes('geothermal')) {
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
  mode: GenerationMode;
  warnings: GenerationWarning[];
}): GeneratedWorld['scientificStatus'] {
  if (params.cosmology.isAnomalous || params.mode === 'anomalous') {
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

// ============================================
// ПАКЕТНЫЕ ФУНКЦИИ
// ============================================

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

