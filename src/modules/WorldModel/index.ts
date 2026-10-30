// ============================================
// WORLD MODEL - Модуль модели мира
// ============================================

import type {
  PhysicalCharacteristics,
  GeneratedWorld,
  CentralObjectOption,
  CelestialBodyOption,
  CradleOption,
  AtmosphereState,
  CradleLocalEnvironment,
  CradleLocationType,
  LocalEnvironmentComponent,
  EnergySourceClass
} from '../../types';

// ============================================
// ЛОКАЛЬНАЯ СРЕДА КОЛЫБЕЛИ ЖИЗНИ
// ============================================

// Расположение локальной среды для известных колыбелей.
// Среда возникновения жизни НЕ обязана совпадать с условиями
// на поверхности планеты: сверхкритическая вода может существовать
// в глубинном гидротермальном резервуаре при совершенно других
// поверхностных условиях, а аэрозольная жизнь — в слоях атмосферы.
const CRADLE_LOCATION_MAP: Record<string, { type: CradleLocationType; description: string }> = {
  supercritical_water: {
    type: 'subsurface_reservoir',
    description: 'Глубинный гидротермальный резервуар со сверхкритической водой'
  },
  supercritical_co2: {
    type: 'subsurface_reservoir',
    description: 'Глубинный резервуар со сверхкритическим CO₂'
  },
  h2o_co2_supercritical_mix: {
    type: 'subsurface_reservoir',
    description: 'Глубинный резервуар со смесью H₂O–CO₂ в сверхкритическом состоянии'
  },
  liquid_ammonia: {
    type: 'ocean',
    description: 'Резервуары жидкого аммиака (аммиачный океан или приповерхностные резервуары)'
  },
  liquid_methane_ethane: {
    type: 'ocean',
    description: 'Углеводородные моря и озёра жидкого метана и этана (аналог Титана)'
  },
  hydrogen_helium_aerosols: {
    type: 'atmosphere',
    description: 'Слои водородно-гелиевой оболочки с аэрозолями (атмосфера газового гиганта)'
  },
  molten_salts: {
    type: 'deep_planetary_layers',
    description: 'Глубинные слои планетной оболочки с расплавами солей'
  }
};

// Состав локальной среды для известных колыбелей.
// Описывает среду возникновения жизни, а не атмосферу планеты.
const CRADLE_COMPOSITION_MAP: Record<string, LocalEnvironmentComponent[]> = {
  supercritical_water: [
    { componentId: 'h2o', description: 'Сверхкритическая вода (H₂O) — растворитель среды' }
  ],
  supercritical_co2: [
    { componentId: 'co2', description: 'Сверхкритический CO₂ — растворитель среды' }
  ],
  h2o_co2_supercritical_mix: [
    { componentId: 'h2o', description: 'Сверхкритическая вода (H₂O)' },
    { componentId: 'co2', description: 'Сверхкритический CO₂' }
  ],
  liquid_ammonia: [
    { componentId: 'nh3', description: 'Жидкий аммиак (NH₃) — растворитель среды' }
  ],
  liquid_methane_ethane: [
    { componentId: 'ch4', description: 'Жидкий метан (CH₄) — растворитель среды' },
    { componentId: 'c2h6', description: 'Жидкий этан (C₂H₆) — растворитель среды' }
  ],
  hydrogen_helium_aerosols: [
    { componentId: 'h2', description: 'Водород (H₂) — несущий газ среды' },
    { componentId: 'he', description: 'Гелий (He) — несущий газ среды' },
    { componentId: 'aerosol_droplets', description: 'Аэрозольные капли — микрообитаемая среда' }
  ],
  molten_salts: [
    { componentId: 'molten_salts', description: 'Расплавы солей (например, NaCl, KCl) — ионный растворитель' }
  ]
};

/**
 * Определение типа расположения локальной среды колыбели жизни.
 * Для неизвестных колыбелей используется тип 'other'.
 */
export function getCradleLocationType(cradle: CradleOption): CradleLocationType {
  return CRADLE_LOCATION_MAP[cradle.id]?.type ?? 'other';
}

/**
 * Формирование локальной среды колыбели жизни.
 *
 * Структура отделена от глобальной атмосферы планеты и от её поверхности:
 * - точные температура и давление среды остаются null, если они неизвестны
 *   (НЕ подменяются произвольными числами);
 * - известные диапазоны требований колыбели сохраняются в
 *   temperatureRange / pressureRange;
 * - состав среды описывает растворитель/несущую среду колыбели,
 *   а не процентные доли атмосферы планеты.
 */
export function determineCradleLocalEnvironment(params: {
  cradle: CradleOption;
  celestialBody?: CelestialBodyOption;
  atmosphere?: AtmosphereState;
}): CradleLocalEnvironment {
  const { cradle } = params;
  const location = CRADLE_LOCATION_MAP[cradle.id] ?? {
    type: 'other' as CradleLocationType,
    description: `Локальная среда колыбели «${cradle.name}»`
  };

  // Состав среды: известный для колыбели либо производный от её растворителей.
  const composition: LocalEnvironmentComponent[] =
    CRADLE_COMPOSITION_MAP[cradle.id] ??
    cradle.solventTypes.map(solvent => ({
      componentId: solvent.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      description: solvent
    }));

  // Для атмосферной колыбели дополняем состав основными газами атмосферы,
  // если они известны — это реальные данные сгенерированного мира.
  if (location.type === 'atmosphere' && params.atmosphere) {
    for (const component of params.atmosphere.components) {
      if (!component.isTrace && component.percentage > 1 &&
          !composition.some(c => c.componentId === component.gasId)) {
        composition.push({
          componentId: component.gasId,
          description: `Атмосферный газ (${component.percentage.toFixed(4)}%)`
        });
      }
    }
  }

  const notes = [
    ...cradle.compatibilityRequirements,
    'Локальная среда колыбели не тождественна условиям на поверхности планеты: ' +
    'точные значения температуры и давления среды неизвестны и не подменяются произвольными числами.'
  ].join('; ');

  return {
    temperature: null,
    temperatureRange: { ...cradle.requiredTemperatureRange },
    pressure: null,
    pressureRange: { ...cradle.requiredPressureRange },
    composition,
    matterState: cradle.matterState,
    energySources: [...cradle.availableEnergySources] as EnergySourceClass[],
    chemicalConstraints: [...cradle.chemicalConstraints],
    locationType: location.type,
    locationDescription: location.description,
    notes
  };
}

// ============================================
// ФУНКЦИИ РАСЧЕТА ФИЗИЧЕСКИХ ХАРАКТЕРИСТИК
// ============================================

/**
 * Расчет физических характеристик, зависящих только от небесного тела,
 * центрального объекта и атмосферы (без колыбели жизни).
 *
 * ВАЖНО: температура поверхности и атмосферное давление берутся только
 * из известных данных атмосферы. Если данные неизвестны, поля остаются
 * незаданными — они НЕ подменяются характеристиками колыбели жизни,
 * потому что локальная среда возникновения жизни может существенно
 * отличаться от поверхности планеты.
 */
export function calculateBodyCharacteristics(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  atmosphere?: AtmosphereState;
}): PhysicalCharacteristics {
  const characteristics: PhysicalCharacteristics = {};

  // Расчет массы и радиуса
  const { mass, radius } = calculateMassAndRadius(params.celestialBody);
  if (mass) characteristics.mass = mass;
  if (radius) characteristics.radius = radius;

  // Расчет гравитации на поверхности
  const gravity = calculateSurfaceGravity(params.celestialBody);
  if (gravity) characteristics.surfaceGravity = gravity;

  // Температура поверхности: только известные данные атмосферы.
  // Не подменяем её температурой колыбели жизни.
  if (typeof params.atmosphere?.temperature === 'number') {
    characteristics.surfaceTemperature = params.atmosphere.temperature;
  }

  // Атмосферное давление: только известные данные атмосферы.
  if (typeof params.atmosphere?.totalPressure === 'number') {
    characteristics.atmosphericPressure = params.atmosphere.totalPressure;
  }

  // Определение орбитальной конфигурации
  characteristics.orbitalConfiguration = determineOrbitalConfiguration({
    centralObject: params.centralObject,
    celestialBody: params.celestialBody
  });

  // Определение геологической активности
  characteristics.geologicalActivity = determineGeologicalActivity(params.celestialBody);

  // Определение космических угроз
  characteristics.cosmicThreats = determineCosmicThreats({
    centralObject: params.centralObject,
    celestialBody: params.celestialBody
  });

  // Определение планетарных угроз
  characteristics.planetaryThreats = determinePlanetaryThreats({
    centralObject: params.centralObject,
    celestialBody: params.celestialBody
  });

  return characteristics;
}

/**
 * Расчет полных физических характеристик мира
 * (характеристики тела + характеристики, зависящие от колыбели).
 */
export function calculatePhysicalCharacteristics(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
  atmosphere?: AtmosphereState;
}): PhysicalCharacteristics {
  const characteristics = calculateBodyCharacteristics(params);

  // Определение резервуаров жидкости (зависит от колыбели)
  characteristics.liquidReservoirs = determineLiquidReservoirs({
    celestialBody: params.celestialBody,
    cradle: params.cradle
  });

  // Определение химических ограничений (зависит от колыбели)
  characteristics.chemicalConstraints = determineChemicalConstraints({
    celestialBody: params.celestialBody,
    cradle: params.cradle
  });

  return characteristics;
}

/**
 * Расчет массы и радиуса
 */
function calculateMassAndRadius(body: CelestialBodyOption): { mass?: number; radius?: number } {
  if (body.massRange) {
    // Возвращаем среднее значение диапазона
    const mass = (body.massRange.min + body.massRange.max) / 2;
    const radius = body.radiusRange ? (body.radiusRange.min + body.radiusRange.max) / 2 : undefined;
    return { mass, radius };
  }
  return {};
}

/**
 * Расчет гравитации на поверхности
 */
function calculateSurfaceGravity(body: CelestialBodyOption): number | undefined {
  // Используем описание гравитации
  const gravityMatch = body.gravityDescription.match(/(\d+\.?\d*)g/);
  if (gravityMatch) {
    return parseFloat(gravityMatch[1]);
  }

  // Для известных типов тел используем стандартные значения
  switch (body.id) {
    case 'earth_like':
      return 1.0;
    case 'small_planet':
      return 0.3;
    case 'super_earth':
      return 1.5;
    case 'mega_earth':
      return 3.0;
    case 'ocean_planet':
      return 1.0;
    case 'gas_giant_moon':
      return 0.5; // Среднее значение
    case 'carbon_planet':
      return 1.0;
    default:
      return undefined;
  }
}

/**
 * Определение орбитальной конфигурации
 */
function determineOrbitalConfiguration(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
}): string {
  const body = params.celestialBody;
  const central = params.centralObject;

  // Для луны газового гиганта
  if (body.id === 'gas_giant_moon') {
    return 'Орбита вокруг газового гиганта';
  }

  // Для одинокого газового гиганта
  if (central.id === 'lone_gas_giant') {
    return 'Свободное плавание или орбита вокруг звезды';
  }

  // Для релятивистского джета
  if (central.id === 'relativistic_jet') {
    return 'Специальная конфигурация вблизи джета';
  }

  // Для черной дыры
  if (central.id === 'black_hole') {
    return 'Орбита вокруг черной дыры (вне радиуса Шварцшильда)';
  }

  // Для пульсара
  if (central.id === 'pulsar') {
    return 'Орбита вокруг пульсара';
  }

  // Стандартная орбита
  return 'Круговая или эллиптическая орбита в зоне обитаемости';
}

/**
 * Определение геологической активности
 */
function determineGeologicalActivity(body: CelestialBodyOption): string {
  // Анализируем геологические свойства (регистронезависимо)
  const props = body.geologicalProperties.map(p => p.toLowerCase());

  if (props.some(p =>
    p.includes('active tectonic') ||
    p.includes('high tectonic') ||
    p.includes('extreme tectonic') ||
    p.includes('tidal heating')
  )) {
    return 'Высокая геологическая активность';
  }

  if (props.some(p => p.includes('low tectonic') || p.includes('minimal'))) {
    return 'Низкая геологическая активность';
  }

  // Стандартная активность
  return 'Умеренная геологическая активность';
}

/**
 * Определение резервуаров жидкости
 */
function determineLiquidReservoirs(params: {
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
}): string[] {
  const reservoirs: string[] = [];

  // На основе типа тела
  if (params.celestialBody.id === 'ocean_planet') {
    reservoirs.push('Глобальный океан');
  }

  // На основе колыбели
  switch (params.cradle.matterState) {
    case 'liquid':
      reservoirs.push(`Жидкость: ${params.cradle.name}`);
      break;
    case 'supercritical_fluid':
      reservoirs.push(`Сверхкритическая жидкость: ${params.cradle.name}`);
      break;
  }

  // Добавляем возможные подповерхностные резервуары
  if (params.celestialBody.geologicalProperties.some(p => p.includes('subsurface') || p.includes('underground'))) {
    reservoirs.push('Подповерхностные резервуары');
  }

  if (reservoirs.length === 0) {
    reservoirs.push('Не определено');
  }

  return reservoirs;
}

/**
 * Определение химических ограничений
 */
function determineChemicalConstraints(params: {
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
}): string[] {
  const constraints: string[] = [];

  // Добавляем ограничения из колыбели
  constraints.push(...params.cradle.chemicalConstraints);

  // Добавляем ограничения из тела
  constraints.push(...params.celestialBody.typicalConstraints);

  // Удаляем дубликаты
  return [...new Set(constraints)];
}

/**
 * Определение космических угроз
 */
function determineCosmicThreats(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
}): string[] {
  const threats: string[] = [];

  // Угрозы от центрального объекта
  threats.push(...params.centralObject.potentialThreats);

  // Дополнительные угрозы для специфических конфигураций
  if (params.centralObject.id === 'black_hole') {
    threats.push('Опасность пересечения горизонта событий');
    threats.push('Гравитационные приливные силы');
  }

  if (params.centralObject.id === 'pulsar') {
    threats.push('Высокоэнергетическое излучение');
    threats.push('Пульсарный ветер');
  }

  if (params.centralObject.id === 'blue_giant') {
    threats.push('Высокая ультрафиолетовая радиация');
    threats.push('Краткий срок жизни звезды');
  }

  return threats;
}

/**
 * Определение планетарных угроз
 */
function determinePlanetaryThreats(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
}): string[] {
  const threats: string[] = [];

  // Угрозы от типа тела
  threats.push(...params.celestialBody.typicalConstraints);

  // Дополнительные угрозы для специфических тел
  if (params.celestialBody.id === 'small_planet') {
    threats.push('Низкая гравитация');
    threats.push('Сложность удержания атмосферы');
  }

  if (params.celestialBody.id === 'mega_earth') {
    threats.push('Экстремальная гравитация');
    threats.push('Высокое давление');
  }

  if (params.celestialBody.id === 'gas_giant_moon') {
    threats.push('Приливные силы от родительской планеты');
    threats.push('Возможный нагрев от приливных сил');
  }

  return threats;
}

// ============================================
// ФУНКЦИИ ДЛЯ РАБОТЫ С МИРОМ
// ============================================

/**
 * Создание расширенного описания мира
 */
export function createWorldDescription(world: Partial<GeneratedWorld>): string {
  const parts: string[] = [];

  // Космология
  if (world.cosmology) {
    parts.push(`**Космология:** ${world.cosmology.name}`);
    parts.push(`- ${world.cosmology.description}`);
  }

  // Эпоха
  if (world.epoch) {
    parts.push(`**Эпоха:** ${world.epoch.name} (${world.epoch.ageRange.min}-${world.epoch.ageRange.max} млрд лет)`);
  }

  // Центральный объект
  if (world.centralObject) {
    parts.push(`**Центральный объект:** ${world.centralObject.name}`);
    parts.push(`- Класс: ${world.centralObject.objectClass}`);
    parts.push(`- Роль: ${world.centralObject.role}`);
  }

  // Небесное тело
  if (world.celestialBody) {
    parts.push(`**Небесное тело:** ${world.celestialBody.name}`);
    parts.push(`- Тип: ${world.celestialBody.bodyType}`);
    parts.push(`- Класс размера: ${world.celestialBody.sizeClass}`);
  }

  // Колыбель жизни
  if (world.cradle) {
    parts.push(`**Колыбель жизни:** ${world.cradle.name}`);
    parts.push(`- Состояние вещества: ${world.cradle.matterState}`);
    parts.push(`- Температура: ${world.cradle.requiredTemperatureRange.min}-${world.cradle.requiredTemperatureRange.max} K`);
    parts.push(`- Давление: ${world.cradle.requiredPressureRange.min}-${world.cradle.requiredPressureRange.max} atm`);
  }

  // Локальная среда колыбели жизни
  if (world.cradleLocalEnvironment) {
    const env = world.cradleLocalEnvironment;
    parts.push(`**Локальная среда колыбели:** ${env.locationDescription}`);
    parts.push(`- Тип расположения: ${env.locationType}`);
    parts.push(`- Диапазон температур среды: ${env.temperatureRange ? `${env.temperatureRange.min}-${env.temperatureRange.max} K` : 'неизвестно'}`);
    parts.push(`- Диапазон давлений среды: ${env.pressureRange ? `${env.pressureRange.min}-${env.pressureRange.max} atm` : 'неизвестно'}`);
  }

  // Физические характеристики
  if (world.physicalCharacteristics) {
    const pc = world.physicalCharacteristics;
    if (pc.mass) parts.push(`**Масса:** ${pc.mass} масс Земли`);
    if (pc.radius) parts.push(`**Радиус:** ${pc.radius} радиусов Земли`);
    if (pc.surfaceGravity) parts.push(`**Гравитация:** ${pc.surfaceGravity}g`);
    if (pc.surfaceTemperature) parts.push(`**Температура поверхности:** ${pc.surfaceTemperature} K`);
    if (pc.atmosphericPressure) parts.push(`**Атмосферное давление:** ${pc.atmosphericPressure} atm`);
    if (pc.geologicalActivity) parts.push(`**Геологическая активность:** ${pc.geologicalActivity}`);
  }

  return parts.join('\n');
}

/**
 * Создание краткого описания мира
 */
export function createShortDescription(world: Partial<GeneratedWorld>): string {
  const parts: string[] = [];

  if (world.cosmology) {
    parts.push(world.cosmology.name);
  }

  if (world.epoch) {
    parts.push(`${world.epoch.name}`);
  }

  if (world.centralObject) {
    parts.push(`около ${world.centralObject.name}`);
  }

  if (world.celestialBody) {
    parts.push(`на ${world.celestialBody.name}`);
  }

  if (world.cradle) {
    parts.push(`с колыбелью ${world.cradle.name}`);
  }

  return parts.join(', ') || 'Неопределенный мир';
}

/**
 * Обновление мира с новыми параметрами
 */
export function updateWorld(
  world: GeneratedWorld,
  updates: Partial<GeneratedWorld>
): GeneratedWorld {
  return {
    ...world,
    ...updates,
    // Обновляем временную метку
    createdAt: new Date().toISOString()
  };
}

export default {
  calculatePhysicalCharacteristics,
  calculateBodyCharacteristics,
  determineCradleLocalEnvironment,
  getCradleLocationType,
  createWorldDescription,
  createShortDescription,
  updateWorld
};
