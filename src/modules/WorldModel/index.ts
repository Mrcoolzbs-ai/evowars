// ============================================
// WORLD MODEL - Модуль модели мира
// ============================================

import type {
  PhysicalCharacteristics,
  GeneratedWorld,
  CentralObjectOption,
  CelestialBodyOption,
  CradleOption,
  AtmosphereState
} from '../../types';



// ============================================
// ФУНКЦИИ РАСЧЕТА ФИЗИЧЕСКИХ ХАРАКТЕРИСТИК
// ============================================

/**
 * Расчет физических характеристик мира
 */
export function calculatePhysicalCharacteristics(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
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

  // Расчет температуры поверхности
  const temperature = estimateSurfaceTemperature(params);
  if (temperature) characteristics.surfaceTemperature = temperature;

  // Расчет атмосферного давления
  const pressure = estimateAtmosphericPressure(params);
  if (pressure) characteristics.atmosphericPressure = pressure;

  // Определение орбитальной конфигурации
  characteristics.orbitalConfiguration = determineOrbitalConfiguration(params);

  // Определение геологической активности
  characteristics.geologicalActivity = determineGeologicalActivity(params.celestialBody);

  // Определение резервуаров жидкости
  characteristics.liquidReservoirs = determineLiquidReservoirs(params);

  // Определение химических ограничений
  characteristics.chemicalConstraints = determineChemicalConstraints(params);

  // Определение космических угроз
  characteristics.cosmicThreats = determineCosmicThreats(params);

  // Определение планетарных угроз
  characteristics.planetaryThreats = determinePlanetaryThreats(params);

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
 * Оценка температуры поверхности
 */
function estimateSurfaceTemperature(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
  atmosphere?: AtmosphereState;
}): number | undefined {
  // Если есть атмосфера с заданной температурой, используем ее
  if (params.atmosphere?.temperature) {
    return params.atmosphere.temperature;
  }

  // Для колыбели используем среднюю температуру диапазона
  const cradleTemp = (params.cradle.requiredTemperatureRange.min + 
                      params.cradle.requiredTemperatureRange.max) / 2;
  
  return cradleTemp;
}

/**
 * Оценка атмосферного давления
 */
function estimateAtmosphericPressure(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
  atmosphere?: AtmosphereState;
}): number | undefined {
  // Если есть атмосфера с заданным давлением, используем ее
  if (params.atmosphere?.totalPressure) {
    return params.atmosphere.totalPressure;
  }

  // Для колыбели используем среднее давление диапазона
  const cradlePressure = (params.cradle.requiredPressureRange.min + 
                          params.cradle.requiredPressureRange.max) / 2;
  
  return cradlePressure;
}

/**
 * Определение орбитальной конфигурации
 */
function determineOrbitalConfiguration(params: {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
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
  // Анализируем геологические свойства
  if (body.geologicalProperties.some(p => p.includes('Active') || p.includes('High'))) {
    return 'Высокая геологическая активность';
  }

  if (body.geologicalProperties.some(p => p.includes('Low') || p.includes('Minimal'))) {
    return 'Низкая геологическая активность';
  }

  // Стандартная активность
  return 'Умеренная геологическая активность';
}

/**
 * Определение резервуаров жидкости
 */
function determineLiquidReservoirs(params: {
  centralObject: CentralObjectOption;
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
  centralObject: CentralObjectOption;
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
  cradle: CradleOption;
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
  cradle: CradleOption;
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
  createWorldDescription,
  createShortDescription,
  updateWorld
};
