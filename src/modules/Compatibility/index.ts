// ============================================
// COMPATIBILITY - Модуль проверки совместимости
// ============================================
//
// Все проверки используют реальные данные сгенерированного мира
// (атмосфера, физические характеристики, локальная среда колыбели,
// центральный объект). Правил-заглушек, пропускающих все варианты, нет.
//
// Аномальный режим НЕ отключает все проверки подряд: отключаются только
// правила с флагом exemptInAnomalousMode, и каждое такое исключение
// привязано к конкретному аномальному правилу (см. поле флага).

import type {
  GeneratedWorld,
  GenerationWarning,
  CompatibilityRule,
  RuleCategory,
  CradleLocalEnvironment,
  CentralObjectOption,
  AtmosphereState,
  PhysicalCharacteristics
} from '../../types';
import { getEarliestUniverseAgeGyr, getTypicalLifetimeGyr } from '../Data/starPhysical';

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ КОНСТАНТЫ И ФУНКЦИИ
// ============================================

/**
 * Источники энергии центрального объекта, способные заменить
 * прямое звёздное излучение для колыбели, требующей stellar_radiation.
 */
const RADIATIVE_ENERGY_SOURCES = [
  'stellar_radiation',
  'UV_radiation',
  'infrared_radiation',
  'electromagnetic_radiation',
  'thermal_radiation',
  'accretion_disk_radiation'
];

/**
 * Минимальная температура колыбели, при которой для поддержания среды
 * необходима высокая геологическая активность (сверхкритические среды,
 * расплавы солей). Такие среды не могут существовать на холодной,
  * геологически пассивной планете без глубинного источника тепла.
 */
const HIGH_GEOLOGY_TEMPERATURE_THRESHOLD = 500; // K

/**
 * Суммарная доля газов атмосферы по их id.
 */
function getGasShare(atmosphere: AtmosphereState | undefined, gasIds: string[]): number {
  if (!atmosphere) return 0;
  return atmosphere.components
    .filter(c => gasIds.includes(c.gasId))
    .reduce((sum, c) => sum + c.percentage, 0);
}

/**
 * Проверка температурного диапазона.
 */
function isInRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

/**
 * Доступен ли колыбели требуемый источник энергии от центрального объекта.
 * Требование stellar_radiation удовлетворяется любым электромагнитным
 * излучением центрального объекта из RADIATIVE_ENERGY_SOURCES.
 */
export function isEnergySourceAvailable(
  centralObject: CentralObjectOption | undefined,
  requiredSource: string
): boolean {
  if (!centralObject) return true; // данных нет — проверка не применима
  if (requiredSource !== 'stellar_radiation') return true; // геотермальная/химическая энергия доступна из среды
  return centralObject.potentialEnergySources.some(source =>
    RADIATIVE_ENERGY_SOURCES.includes(source)
  );
}

/**
 * Категории правил, относящиеся к выбору колыбели жизни.
 * Используются генератором для фильтрации колыбелей, которые могут
 * быть поддержаны данным небесным телом.
 */
export const CRADLE_RELATED_CATEGORIES: RuleCategory[] = [
  'cradle_temperature',
  'cradle_pressure',
  'chemical_composition',
  'matter_state',
  'geological_requirements',
  'energy_sources'
];

// ============================================
// ПРАВИЛА СОВМЕСТИМОСТИ
// ============================================

const compatibilityRules: CompatibilityRule[] = [
  // Правило 1: Окно существования центрального объекта в эпоху
  //
  // СЕМАНТИКА ЭТАПА 3: возраст Вселенной НЕ равен времени жизни звезды.
  // Запрещён ТОЛЬКО объект, класс которого не мог сформироваться
  // к выбранной эпохе (максимальный возраст эпохи меньше минимального
  // возраста Вселенной для класса). Короткоживущая звезда (голубой
  // гигант) может сформироваться недавно даже в древней Вселенной —
  // для неё действует отдельное предупреждение (правило 13), а НЕ
  // запрет: максимальное время жизни звезды не используется как
  // максимальный возраст существования Вселенной.
  {
    id: 'age_central_object_compatibility',
    category: 'age_central_object',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.epoch || !world.centralObject) return true;

      const epochAge = world.epoch.ageRange;
      const obj = world.centralObject;

      // Минимальный возраст Вселенной, при котором класс объекта
      // уже может существовать (окно существования этапа 3).
      const earliestUniverseAgeGyr =
        obj.existenceWindow?.earliestUniverseAgeGyr ??
        getEarliestUniverseAgeGyr(obj.id) ??
        obj.minAge ??
        0;

      // Вселенная слишком молода: объект этого класса ещё не мог
      // сформироваться к выбранной эпохе.
      if (epochAge.max < earliestUniverseAgeGyr) return false;

      return true;
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Центральный объект этого класса не мог сформироваться к выбранной эпохе: Вселенная ещё слишком молода.',
    resolutionSuggestions: [
      'Выберите более позднюю эпоху',
      'Выберите центральный объект, возможный в ранней Вселенной',
      'Используйте аномальный режим для игнорирования возрастных ограничений'
    ],
    dependsOn: [],
    isActive: true,
    // Аномальное правило: в аномальных космологиях («Сон», «Симуляция» и т.п.)
    // возрастные ограничения физической вселенной могут не действовать.
    exemptInAnomalousMode: true
  },

  // Правило 2: Проверка совместимости центрального объекта и небесного тела
  {
    id: 'central_object_body_compatibility',
    category: 'central_object_environment',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.centralObject || !world.celestialBody) return true;

      const body = world.celestialBody;
      const obj = world.centralObject;

      if (body.compatibleCentralObjects.length > 0) {
        return body.compatibleCentralObjects.includes(obj.id);
      }

      return true;
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation: 'Выбранное небесное тело может не быть оптимально совместимо с центральным объектом.',
    resolutionSuggestions: [
      'Выберите совместимое небесное тело',
      'Выберите другой центральный объект',
      'Проверьте орбитальную конфигурацию'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 3: Аномальная космология требует аномального режима
  {
    id: 'anomalous_cosmology_requires_anomalous_mode',
    category: 'cosmology_physics',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cosmology) return true;

      // В аномальном режиме требование выполнено автоматически
      if (world.mode === 'anomalous') return true;

      return !world.cosmology.isAnomalous;
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Аномальная космология требует аномального режима генерации.',
    resolutionSuggestions: [
      'Активируйте аномальный режим',
      'Выберите неаномальную космологию'
    ],
    dependsOn: [],
    isActive: true,
    // Само правило остаётся активным даже в аномальном режиме:
    // в аномальном режиме его условие выполнено по определению.
  },

  // Правило 4: Релятивистский джет как центральный объект
  {
    id: 'relativistic_jet_special_handling',
    category: 'central_object_environment',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.centralObject) return true;

      if (world.centralObject.id === 'relativistic_jet') {
        // В аномальном режиме это допустимо
        if (world.mode === 'anomalous') return true;
        return false;
      }

      return true;
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Релятивистский джет требует специальной конфигурации.',
    resolutionSuggestions: [
      'Используйте аномальный режим',
      'Выберите другой центральный объект'
    ],
    dependsOn: [],
    isActive: true,
    // Аномальное правило: джет как «центральный объект» —
    // игровое допущение аномального режима.
    exemptInAnomalousMode: true
  },

  // Правило 5: Луна газового гиганта требует газового гиганта
  {
    id: 'gas_giant_moon_requires_parent',
    category: 'body_orbit',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.celestialBody || !world.centralObject) return true;

      if (world.celestialBody.id === 'gas_giant_moon') {
        const validParents = ['lone_gas_giant', 'blue_giant', 'brown_dwarf'];
        return validParents.includes(world.centralObject.id);
      }

      return true;
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Луна газового гиганта должна обращаться вокруг газового гиганта или подобного объекта.',
    resolutionSuggestions: [
      'Выберите другой тип небесного тела',
      'Выберите подходящий центральный объект'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 6: Температура локальной среды колыбели жизни
  {
    id: 'cradle_temperature_compatibility',
    category: 'cradle_temperature',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle) return true;
      const env = world.cradleLocalEnvironment as CradleLocalEnvironment | undefined;
      if (!env) return true; // локальная среда не определена — проверка не применима

      const range = world.cradle.requiredTemperatureRange;

      // Среда на поверхности или в океане: температура задаётся
      // известными данными о поверхности планеты.
      if (env.locationType === 'surface' || env.locationType === 'ocean') {
        const pc = world.physicalCharacteristics as PhysicalCharacteristics | undefined;
        if (!pc || typeof pc.surfaceTemperature !== 'number') return true; // данных нет
        return isInRange(pc.surfaceTemperature, range);
      }

      // Среда в слоях атмосферы: используем известную температуру атмосферы.
      if (env.locationType === 'atmosphere') {
        if (typeof world.atmosphere?.temperature !== 'number') return true; // данных нет
        return isInRange(world.atmosphere.temperature, range);
      }

      // Подземный резервуар / глубокие слои: локальная температура не равна
      // поверхностной, поверхностные данные для проверки не применимы.
      return true;
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Температура известной среды колыбели выходит за пределы требуемого диапазона колыбели.',
    resolutionSuggestions: [
      'Выберите другую колыбель жизни',
      'Измените атмосферу (пресет с подходящей температурой)',
      'Выберите другое небесное тело'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 7: Давление локальной среды колыбели (поверхность/океан)
  {
    id: 'cradle_pressure_compatibility',
    category: 'cradle_pressure',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle) return true;
      const env = world.cradleLocalEnvironment as CradleLocalEnvironment | undefined;
      if (!env) return true;

      if (env.locationType !== 'surface' && env.locationType !== 'ocean') return true;

      const pc = world.physicalCharacteristics as PhysicalCharacteristics | undefined;
      if (!pc || typeof pc.atmosphericPressure !== 'number') return true; // данных нет

      return isInRange(pc.atmosphericPressure, world.cradle.requiredPressureRange);
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Атмосферное давление на поверхности выходит за пределы требуемого диапазона колыбели.',
    resolutionSuggestions: [
      'Измените атмосферу (пресет с подходящим давлением)',
      'Выберите другую колыбель жизни',
      'Проверьте совместимость атмосферы'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 8: Давление в слоях атмосферы для атмосферной колыбели
  {
    id: 'cradle_pressure_atmosphere_location',
    category: 'cradle_pressure',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle) return true;
      const env = world.cradleLocalEnvironment as CradleLocalEnvironment | undefined;
      if (!env || env.locationType !== 'atmosphere') return true;

      if (typeof world.atmosphere?.totalPressure !== 'number') return true; // данных нет

      return isInRange(world.atmosphere.totalPressure, world.cradle.requiredPressureRange);
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation: 'Полное давление атмосферы может не соответствовать слоям обитания колыбели.',
    resolutionSuggestions: [
      'Учтите, что жизнеспособные слои могут находиться на другой высоте с иным давлением',
      'Проверьте требования колыбели к давлению'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 9: Состав среды для колыбели
  {
    id: 'cradle_atmosphere_composition',
    category: 'chemical_composition',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle || !world.atmosphere) return true;
      const env = world.cradleLocalEnvironment as CradleLocalEnvironment | undefined;
      if (!env) return true;

      // Атмосферная колыбель нуждается в водородно-гелиевой среде
      if (env.locationType === 'atmosphere') {
        return getGasShare(world.atmosphere, ['h2', 'he']) >= 50;
      }

      // Океан углеводородов требует заметной доли метана и этана в атмосфере
      if (world.cradle.id === 'liquid_methane_ethane' &&
          (env.locationType === 'ocean' || env.locationType === 'surface')) {
        return getGasShare(world.atmosphere, ['ch4', 'c2h6']) >= 5;
      }

      // Аммиачный океан требует заметной доли аммиака
      if (world.cradle.id === 'liquid_ammonia' &&
          (env.locationType === 'ocean' || env.locationType === 'surface')) {
        return getGasShare(world.atmosphere, ['nh3']) >= 1;
      }

      return true;
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Состав атмосферы не содержит газов-носителей, необходимых для среды колыбели.',
    resolutionSuggestions: [
      'Выберите атмосферу с необходимыми газами-носителями',
      'Выберите другую колыбель жизни',
      'Используйте пользовательскую атмосферу с нужным составом'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 10: Геологические требования колыбели
  {
    id: 'cradle_geological_requirements',
    category: 'geological_requirements',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle) return true;

      // Горячие среды (сверхкритические среды, расплавы солей)
      // требуют мощного глубинного источника тепла.
      if (world.cradle.requiredTemperatureRange.min < HIGH_GEOLOGY_TEMPERATURE_THRESHOLD) {
        return true;
      }

      const pc = world.physicalCharacteristics as PhysicalCharacteristics | undefined;
      if (!pc || typeof pc.geologicalActivity !== 'string') return true; // данных нет

      return pc.geologicalActivity === 'Высокая геологическая активность';
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Колыбель с высокой требуемой температурой нуждается в высокой геологической активности планеты.',
    resolutionSuggestions: [
      'Выберите небесное тело с активной тектоникой',
      'Выберите колыбель с менее экстремальными требованиями',
      'Учтите, что глубинные среды требуют глубинных источников тепла'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 11: Доступность источников энергии колыбели
  {
    id: 'cradle_energy_sources_availability',
    category: 'energy_sources',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle || !world.centralObject) return true;

      // Каждое требование колыбели к энергии должно быть выполнимо
      // в окружении центрального объекта.
      return world.cradle.availableEnergySources.every(source =>
        isEnergySourceAvailable(world.centralObject, source)
      );
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Центральный объект не обеспечивает источники энергии, необходимые колыбели жизни.',
    resolutionSuggestions: [
      'Выберите центральный объект с подходящим излучением',
      'Выберите колыбель, не зависящую от звёздного излучения',
      'Используйте аномальный режим для экзотических конфигураций'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 12: Согласованность агрегатного состояния среды и её расположения
  {
    id: 'cradle_matter_state_location',
    category: 'matter_state',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle) return true;
      const env = world.cradleLocalEnvironment as CradleLocalEnvironment | undefined;
      if (!env) return true;

      const matterState = world.cradle.matterState;
      const condensed = ['solid', 'liquid', 'supercritical_fluid', 'plasma'];
      const gaseous = ['gas', 'aerosol'];

      // Конденсированная среда не может обитать в свободной атмосфере
      if (condensed.includes(matterState) && env.locationType === 'atmosphere') {
        return false;
      }

      // Газообразная/аэрозольная среда не располагается на твёрдой
      // поверхности или в подземном резервуаре
      if (gaseous.includes(matterState) &&
          (env.locationType === 'surface' || env.locationType === 'subsurface_reservoir')) {
        return false;
      }

      return true;
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation: 'Агрегатное состояние колыбели плохо согласуется с типом расположения её локальной среды.',
    resolutionSuggestions: [
      'Проверьте корректность сочетания колыбели и расположения среды',
      'Выберите другую колыбель жизни'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 13: Короткоживущая звезда в позднюю эпоху (этап 3)
  //
  // Короткоживущая звезда НЕ запрещена в древней Вселенной: она
  // могла сформироваться недавно. Но время, доступное для развития
  // планетарной среды, ограничено временем жизни звезды — это
  // УСЛОВНАЯ совместимость (предупреждение), а не ошибка.
  {
    id: 'short_lived_star_recent_formation',
    category: 'age_central_object',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.epoch || !world.centralObject) return true;

      const lifetime = getTypicalLifetimeGyr(world.centralObject.id);
      // Характерное время жизни определено только для звёзд.
      if (!lifetime) return true;

      // Звезда класса могла сформироваться недавно, только если
      // время её жизни короче возраста Вселенной к концу эпохи.
      // Тогда формирование вынужденно состоялось недавно, и окно
      // стабильных условий ограничено временем жизни звезды.
      return world.epoch.ageRange.max <= lifetime.max;
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation:
      'Время жизни звезды этого класса короче возраста Вселенной выбранной эпохи: звезда должна была сформироваться недавно, и время, доступное для развития планетарной среды, ограничено её временем жизни (а не возрастом Вселенной).',
    resolutionSuggestions: [
      'Учтите ограниченное окно стабильных условий вблизи короткоживущей звезды',
      'Выберите долгоживущий класс звезды для длительной эволюции среды',
      'Подтвердите осознанный выбор сценария быстрой эволюции'
    ],
    dependsOn: [],
    isActive: true
    // Специально БЕЗ exemptInAnomalousMode: ограничение времени жизни
    // звезды — физическое свойство самого объекта, не привязанное
    // к аномальной космологии.
  },

  // Правило 14: Фазовый скрининг атмосферных компонентов (этап 3)
  //
  // Потенциальная конденсация или выпадение твёрдой фазы компонентов
  // — не ошибка состава: вещество не удаляется и не нормализуется.
  // Предупреждение сообщает о потенциальном фазовом переходе и о том,
  // что точное распределение по фазам не рассчитано.
  {
    id: 'atmosphere_phase_screening',
    category: 'phase_equilibrium',
    condition: (world: Partial<GeneratedWorld>) => {
      // Физическая модель не построена (старые миры) — проверка не применима.
      if (!world.phaseAnalysis) return true;
      return !world.phaseAnalysis.hasPotentialTransitions;
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation:
      'Фазовый скрининг обнаружил компоненты с потенциалом конденсации или выпадения твёрдой фазы при заданных условиях. Компоненты не удаляются: точное распределение между фазами требует модели равновесия смеси.',
    resolutionSuggestions: [
      'Учтите возможное существование жидких/твёрдых резервуаров вещества',
      'Проверьте температуру и давление атмосферы',
      'Точный состав и количество конденсированной фазы не рассчитаны — требуется модель равновесия смеси'
    ],
    dependsOn: [],
    isActive: true
    // Специально БЕЗ exemptInAnomalousMode: фазовая физика вещества
    // не отменяется аномальной космологией.
  }
];

// ============================================
// ФУНКЦИИ ПРОВЕРКИ
// ============================================

/**
 * Проверка совместимости мира.
 *
 * В аномальном режиме отключаются ТОЛЬКО правила с флагом
 * exemptInAnomalousMode. Все остальные проверки остаются активными.
 */
export function checkCompatibility(
  world: Partial<GeneratedWorld>,
  mode: 'realistic' | 'anomalous' = 'realistic'
): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];

  for (const rule of compatibilityRules) {
    if (!rule.isActive) continue;

    // Аномальный режим отключает только явно исключённые правила,
    // каждое из которых привязано к конкретному аномальному правилу.
    if (mode === 'anomalous' && rule.exemptInAnomalousMode === true) continue;

    if (!rule.condition(world)) {
      warnings.push({
        id: `warn_${rule.id}`,
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        message: rule.explanation,
        suggestions: rule.resolutionSuggestions,
        affectedFields: getAffectedFields(rule.category)
      });
    }
  }

  return warnings;
}

/**
 * Получение списка затрагиваемых полей для категории
 */
function getAffectedFields(category: RuleCategory): string[] {
  const fieldMap: Record<RuleCategory, string[]> = {
    'cosmology_physics': ['cosmology', 'mode'],
    'age_central_object': ['epoch', 'centralObject'],
    'central_object_environment': ['centralObject', 'celestialBody'],
    'body_orbit': ['celestialBody', 'centralObject'],
    'cradle_temperature': ['cradle', 'cradleLocalEnvironment', 'physicalCharacteristics'],
    'cradle_pressure': ['cradle', 'cradleLocalEnvironment', 'physicalCharacteristics'],
    'chemical_composition': ['atmosphere', 'cradle', 'cradleLocalEnvironment'],
    'atmosphere': ['atmosphere'],
    'energy_sources': ['energySources', 'centralObject', 'cradle'],
    'matter_state': ['cradle', 'cradleLocalEnvironment'],
    'geological_requirements': ['cradle', 'physicalCharacteristics'],
    'phase_equilibrium': ['atmosphere', 'phaseAnalysis']
  };

  return fieldMap[category] || [];
}

/**
 * Создание предупреждений на основе заданного набора правил.
 * Идентификаторы предупреждений детерминированы (без Date.now()),
 * чтобы одинаковые миры давали одинаковые предупреждения.
 */
export function createCompatibilityWarnings(
  world: Partial<GeneratedWorld>,
  rules: CompatibilityRule[] = compatibilityRules
): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];

  for (const rule of rules) {
    if (!rule.isActive) continue;

    if (!rule.condition(world)) {
      warnings.push({
        id: `warn_${rule.id}`,
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        message: rule.explanation,
        suggestions: rule.resolutionSuggestions,
        affectedFields: getAffectedFields(rule.category)
      });
    }
  }

  return warnings;
}

/**
 * Проверка, совместим ли мир (нет предупреждений уровня error)
 */
export function isWorldCompatible(world: Partial<GeneratedWorld>, mode: string = 'realistic'): boolean {
  const warnings = checkCompatibility(world, mode as 'realistic' | 'anomalous');
  return warnings.every(w => w.severity !== 'error');
}

/**
 * Получение всех правил
 */
export function getAllRules(): CompatibilityRule[] {
  return [...compatibilityRules];
}

/**
 * Получение активных правил
 */
export function getActiveRules(): CompatibilityRule[] {
  return compatibilityRules.filter(r => r.isActive);
}

/**
 * Добавление нового правила
 */
export function addRule(rule: CompatibilityRule): void {
  compatibilityRules.push(rule);
}

/**
 * Удаление правила по ID
 */
export function removeRule(ruleId: string): boolean {
  const index = compatibilityRules.findIndex(r => r.id === ruleId);
  if (index !== -1) {
    compatibilityRules.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * Включение/отключение правила
 */
export function toggleRule(ruleId: string, isActive: boolean): boolean {
  const rule = compatibilityRules.find(r => r.id === ruleId);
  if (rule) {
    rule.isActive = isActive;
    return true;
  }
  return false;
}

export default {
  checkCompatibility,
  createCompatibilityWarnings,
  isWorldCompatible,
  getAllRules,
  getActiveRules,
  addRule,
  removeRule,
  toggleRule
};

