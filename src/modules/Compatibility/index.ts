// ============================================
// COMPATIBILITY - Модуль проверки совместимости
// ============================================

import type {
  GeneratedWorld,
  GenerationWarning,
  CompatibilityRule,
  RuleCategory
} from '../../types';



// ============================================
// ПРАВИЛА СОВМЕСТИМОСТИ
// ============================================

// Создаем правила совместимости
const compatibilityRules: CompatibilityRule[] = [
  // Правило 1: Проверка возраста вселенной и центрального объекта
  {
    id: 'age_central_object_compatibility',
    category: 'age_central_object',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.epoch || !world.centralObject) return true;
      
      const epochAge = world.epoch.ageRange;
      const obj = world.centralObject as unknown as { minAge: number | null; maxAge: number | null };
      
      if (obj.minAge !== null && epochAge.min < obj.minAge) return false;
      if (obj.maxAge !== null && epochAge.max > obj.maxAge) return false;
      
      return true;
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Центральный объект не может существовать в выбранную эпоху вселенной.',
    resolutionSuggestions: [
      'Выберите другой центральный объект',
      'Выберите другую эпоху',
      'Используйте аномальный режим для игнорирования возрастных ограничений'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 2: Проверка совместимости центрального объекта и небесного тела
  {
    id: 'central_object_body_compatibility',
    category: 'central_object_environment',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.centralObject || !world.celestialBody) return true;
      
      const body = world.celestialBody as unknown as { compatibleCentralObjects: string[] };
      const obj = world.centralObject as unknown as { id: string };
      
      // Если у тела есть список совместимых центральных объектов
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

  // Правило 3: Проверка температурных ограничений колыбели
  {
    id: 'cradle_temperature_compatibility',
    category: 'cradle_temperature',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle || !world.celestialBody) return true;
      
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // В будущем можно добавить проверку
      return true;
    },
    result: 'compatible',
    severity: 'info',
    explanation: 'Температурные ограничения колыбели не проверены.',
    resolutionSuggestions: ['Добавьте данные о температуре небесного тела'],
    dependsOn: [],
    isActive: false // Пока отключено
  },

  // Правило 4: Проверка давления для колыбели
  {
    id: 'cradle_pressure_compatibility',
    category: 'cradle_pressure',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle || !world.atmosphere) return true;
      
      const cradle = world.cradle as unknown as { requiredPressureRange: { min: number; max: number } };
      const pressure = world.atmosphere.totalPressure;
      
      if (pressure === null) return true;
      
      // Проверяем, что давление находится в допустимом диапазоне
      return pressure >= cradle.requiredPressureRange.min && 
             pressure <= cradle.requiredPressureRange.max;
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation: 'Давление может не соответствовать требованиям колыбели.',
    resolutionSuggestions: [
      'Измените атмосферное давление',
      'Выберите другую колыбель',
      'Проверьте совместимость атмосферы'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 5: Аномальная космология активирует аномальный режим
  {
    id: 'anomalous_cosmology_requires_anomalous_mode',
    category: 'cosmology_physics',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cosmology) return true;
      
      // В аномальном режиме это правило не применяется
      if (world.mode === 'anomalous') return true;
      
      const cosmology = world.cosmology as unknown as { isAnomalous: boolean };
      return !cosmology.isAnomalous;
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Аномальная космология требует аномального режима генерации.',
    resolutionSuggestions: [
      'Активируйте аномальный режим',
      'Выберите неаномальную космологию'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 6: Релятивистский джет как центральный объект
  {
    id: 'relativistic_jet_special_handling',
    category: 'central_object_environment',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.centralObject) return true;
      
      // Релятивистский джет не может быть центральным объектом в стандартной конфигурации
      const obj = world.centralObject as unknown as { id: string };
      if (obj.id === 'relativistic_jet') {
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
    isActive: true
  },

  // Правило 7: Луна газового гиганта требует газового гиганта
  {
    id: 'gas_giant_moon_requires_parent',
    category: 'body_orbit',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.celestialBody || !world.centralObject) return true;
      
      const body = world.celestialBody as unknown as { id: string };
      const obj = world.centralObject as unknown as { id: string };
      if (body.id === 'gas_giant_moon') {
        // Проверяем, что центральный объект может иметь луны
        const validParents = ['lone_gas_giant', 'blue_giant', 'brown_dwarf'];
        return validParents.includes(obj.id);
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

  // Правило 8: Проверка совместимости сверхкритических сред
  {
    id: 'supercritical_environment_requirements',
    category: 'cradle_temperature',
    condition: (world: Partial<GeneratedWorld>) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cradle = world.cradle as unknown as { matterState: string };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      // Для сверхкритических сред нужны высокие температура и давление
      if (cradle.matterState === 'supercritical_fluid') {
        // Пока просто проверяем, что это сверхкритическая среда
        // В будущем можно добавить проверку температуры и давления
        return true;
      }
      
      return true;
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation: 'Сверхкритические среды требуют специальных условий температуры и давления.',
    resolutionSuggestions: [
      'Проверьте параметры температуры и давления',
      'Убедитесь, что планета может поддерживать такие условия'
    ],
    dependsOn: [],
    isActive: true
  }
];

// ============================================
// ФУНКЦИИ ПРОВЕРКИ
// ============================================

/**
 * Проверка совместимости мира
 */
export function checkCompatibility(
  world: Partial<GeneratedWorld>,
  mode: 'realistic' | 'anomalous' = 'realistic'
): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];
  
  for (const rule of compatibilityRules) {
    if (!rule.isActive) continue;
    
    // В аномальном режиме некоторые правила не применяются
    if (mode === 'anomalous' && rule.category === 'cosmology_physics') {
      // Но проверяем правила, которые явно не отключены
      if (rule.id === 'anomalous_cosmology_requires_anomalous_mode') {
        continue;
      }
    }
    
    const result = rule.condition(world);
    
    if (!result) {
      // Несовместимо
      warnings.push({
        id: `warn_${rule.id}_${Date.now()}`,
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        message: rule.explanation,
        suggestions: rule.resolutionSuggestions,
        affectedFields: getAffectedFields(rule.category)
      });
    } else if (rule.result === 'conditionally_compatible' && !result) {
      // Условно совместимо, но условие не выполнено
      warnings.push({
        id: `warn_${rule.id}_${Date.now()}`,
        ruleId: rule.id,
        category: rule.category,
        severity: 'warning',
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
    'cradle_temperature': ['cradle', 'celestialBody', 'atmosphere'],
    'cradle_pressure': ['cradle', 'atmosphere'],
    'chemical_composition': ['atmosphere', 'cradle'],
    'atmosphere': ['atmosphere'],
    'energy_sources': ['energySources', 'centralObject'],
    'matter_state': ['cradle', 'atmosphere']
  };
  
  return fieldMap[category] || [];
}

/**
 * Создание предупреждений на основе правил
 */
export function createCompatibilityWarnings(
  world: Partial<GeneratedWorld>,
  rules: CompatibilityRule[] = compatibilityRules
): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];
  
  for (const rule of rules) {
    if (!rule.isActive) continue;
    
    const result = rule.condition(world);
    
    if (!result) {
      warnings.push({
        id: `warn_${rule.id}_${Date.now()}`,
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
 * Проверка, совместим ли мир
 */
export function isWorldCompatible(world: Partial<GeneratedWorld>, mode: string = 'realistic'): boolean {
  const warnings = checkCompatibility(world, mode as any);
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
