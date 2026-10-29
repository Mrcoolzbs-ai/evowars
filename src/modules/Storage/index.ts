// ============================================
// STORAGE - Модуль хранения данных
// ============================================

import type {
  GeneratedWorld,
  SavedWorld,
  GenerationSettings,
  Seed
} from '../../types';

const STORAGE_KEY = 'evowars_worlds';
const SETTINGS_KEY = 'evowars_settings';

// ============================================
// ФУНКЦИИ РАБОТЫ С LOCALSTORAGE
// ============================================

/**
 * Сохранение мира
 */
export function saveWorld(world: GeneratedWorld, settings: GenerationSettings): SavedWorld {
  const savedWorld: SavedWorld = {
    ...world,
    savedAt: new Date().toISOString(),
    version: '1.0',
    settings
  };

  // Получаем текущий список миров
  const worlds = getAllWorlds();
  
  // Добавляем новый мир
  worlds.unshift(savedWorld);
  
  // Сохраняем ограниченное количество миров (последние 50)
  const trimmedWorlds = worlds.slice(0, 50);
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedWorlds));
  
  return savedWorld;
}

/**
 * Получение всех сохраненных миров
 */
export function getAllWorlds(): SavedWorld[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Получение мира по ID
 */
export function getWorldById(id: string): SavedWorld | null {
  const worlds = getAllWorlds();
  return worlds.find(w => w.id === id) || null;
}

/**
 * Удаление мира по ID
 */
export function deleteWorld(id: string): boolean {
  const worlds = getAllWorlds();
  const index = worlds.findIndex(w => w.id === id);
  
  if (index === -1) return false;
  
  worlds.splice(index, 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(worlds));
  
  return true;
}

/**
 * Очистка всех миров
 */
export function clearAllWorlds(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Сохранение настроек
 */
export function saveSettings(settings: GenerationSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ошибка сохранения
  }
}

/**
 * Получение настроек
 */
export function getSettings(): GenerationSettings | null {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (!data) return null;
    
    const parsed = JSON.parse(data);
    return parsed as GenerationSettings;
  } catch {
    return null;
  }
}

/**
 * Удаление настроек
 */
export function deleteSettings(): void {
  localStorage.removeItem(SETTINGS_KEY);
}

/**
 * Сохранение последнего seed
 */
export function saveLastSeed(seed: Seed): void {
  try {
    localStorage.setItem('evowars_last_seed', seed);
  } catch {
    // Ошибка сохранения
  }
}

/**
 * Получение последнего seed
 */
export function getLastSeed(): Seed | null {
  try {
    return localStorage.getItem('evowars_last_seed');
  } catch {
    return null;
  }
}

// ============================================
// ЭКСПОРТ И ИМПОРТ
// ============================================

/**
 * Экспорт мира в JSON
 */
export function exportWorldToJSON(world: SavedWorld): string {
  return JSON.stringify(world, null, 2);
}

/**
 * Экспорт мира в Markdown
 */
export function exportWorldToMarkdown(world: SavedWorld): string {
  const lines: string[] = [];

  lines.push(`# ${world.cosmology.name} - ${world.epoch.name}`);
  lines.push('');
  lines.push(`**ID:** ${world.id}`);
  lines.push(`**Seed:** ${world.seed}`);
  lines.push(`**Дата создания:** ${new Date(world.createdAt).toLocaleString('ru-RU')}`);
  lines.push(`**Режим:** ${world.mode === 'anomalous' ? 'Аномальный' : 'Реалистичный'}`);
  lines.push('');

  lines.push('## Космология');
  lines.push('');
  lines.push(`- **Концепция:** ${world.cosmology.name}`);
  lines.push(`- **Описание:** ${world.cosmology.description}`);
  lines.push(`- **Научный статус:** ${formatScientificStatus(world.cosmology.scientificStatus)}`);
  lines.push('');

  lines.push('## Эпоха');
  lines.push('');
  lines.push(`- **Название:** ${world.epoch.name}`);
  lines.push(`- **Возраст:** ${world.epoch.ageRange.min}-${world.epoch.ageRange.max} млрд лет`);
  lines.push(`- **Описание:** ${world.epoch.description}`);
  lines.push('');

  lines.push('## Центральный объект');
  lines.push('');
  lines.push(`- **Название:** ${world.centralObject.name}`);
  lines.push(`- **Класс:** ${world.centralObject.objectClass}`);
  lines.push(`- **Роль:** ${world.centralObject.role}`);
  lines.push(`- **Источники энергии:** ${world.centralObject.potentialEnergySources.join(', ')}`);
  lines.push(`- **Угрозы:** ${world.centralObject.potentialThreats.join(', ')}`);
  lines.push('');

  lines.push('## Небесное тело');
  lines.push('');
  lines.push(`- **Название:** ${world.celestialBody.name}`);
  lines.push(`- **Тип:** ${world.celestialBody.bodyType}`);
  lines.push(`- **Класс размера:** ${world.celestialBody.sizeClass}`);
  lines.push(`- **Гравитация:** ${world.celestialBody.gravityDescription}`);
  lines.push(`- **Геологические свойства:** ${world.celestialBody.geologicalProperties.join(', ')}`);
  lines.push('');

  lines.push('## Колыбель жизни');
  lines.push('');
  lines.push(`- **Название:** ${world.cradle.name}`);
  lines.push(`- **Состояние вещества:** ${world.cradle.matterState}`);
  lines.push(`- **Температура:** ${world.cradle.requiredTemperatureRange.min}-${world.cradle.requiredTemperatureRange.max} K`);
  lines.push(`- **Давление:** ${world.cradle.requiredPressureRange.min}-${world.cradle.requiredPressureRange.max} atm`);
  lines.push(`- **Химические особенности:** ${world.cradle.chemicalFeatures.join(', ')}`);
  lines.push('');

  lines.push('## Атмосфера');
  lines.push('');
  if (world.atmosphere.components.length > 0) {
    lines.push('| Газ | Формула | % | Примечания |');
    lines.push('|-----|---------|---|------------|');
    
    for (const component of world.atmosphere.components) {
      lines.push(`| ${getGasName(component.gasId)} | ${getGasFormula(component.gasId)} | ${component.percentage.toFixed(4)}% | ${component.uncertainty} |`);
    }
  } else {
    lines.push('Атмосфера не определена.');
  }
  
  if (world.atmosphere.totalPressure) {
    lines.push(`- **Общее давление:** ${world.atmosphere.totalPressure} atm`);
  }
  if (world.atmosphere.temperature) {
    lines.push(`- **Температура:** ${world.atmosphere.temperature} K`);
  }
  lines.push('');

  lines.push('## Физические характеристики');
  lines.push('');
  const pc = world.physicalCharacteristics;
  if (pc.mass) lines.push(`- **Масса:** ${pc.mass} масс Земли`);
  if (pc.radius) lines.push(`- **Радиус:** ${pc.radius} радиусов Земли`);
  if (pc.surfaceGravity) lines.push(`- **Гравитация:** ${pc.surfaceGravity}g`);
  if (pc.surfaceTemperature) lines.push(`- **Температура поверхности:** ${pc.surfaceTemperature} K`);
  if (pc.atmosphericPressure) lines.push(`- **Атмосферное давление:** ${pc.atmosphericPressure} atm`);
  if (pc.geologicalActivity) lines.push(`- **Геологическая активность:** ${pc.geologicalActivity}`);
  lines.push('');

  lines.push('## Энергия');
  lines.push('');
  lines.push(`- **Основные источники:** ${world.energySources.primary.join(', ')}`);
  lines.push(`- **Вторичные источники:** ${world.energySources.secondary.join(', ')}`);
  lines.push('');

  lines.push('## Цепочка причинно-следственных связей');
  lines.push('');
  lines.push(`- **Космология:** ${world.causalChain.cosmology}`);
  lines.push(`- **Эпоха:** ${world.causalChain.epoch}`);
  lines.push(`- **Центральный объект:** ${world.causalChain.centralObject}`);
  lines.push(`- **Небесное тело:** ${world.causalChain.celestialBody}`);
  lines.push(`- **Колыбель:** ${world.causalChain.cradle}`);
  lines.push('');

  lines.push('## Эволюционные последствия');
  lines.push('');
  lines.push('### Возможные адаптации:');
  world.evolutionImplications.possibleAdaptations.forEach(a => lines.push(`- ${a}`));
  lines.push('');
  lines.push('### Ограничения:');
  world.evolutionImplications.constraints.forEach(c => lines.push(`- ${c}`));
  lines.push('');
  lines.push('### Возможности:');
  world.evolutionImplications.opportunities.forEach(o => lines.push(`- ${o}`));
  lines.push('');

  lines.push('## Предупреждения');
  lines.push('');
  if (world.warnings.length > 0) {
    world.warnings.forEach(w => {
      lines.push(`- **${w.severity.toUpperCase()}:** ${w.message}`);
      lines.push(`  - Категория: ${w.category}`);
      lines.push(`  - Предложения: ${w.suggestions.join(', ')}`);
    });
  } else {
    lines.push('Предупреждений нет.');
  }
  lines.push('');

  lines.push('## Научный статус');
  lines.push('');
  lines.push(`- **Статус:** ${formatScientificStatus(world.scientificStatus)}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Импорт мира из JSON
 */
export function importWorldFromJSON(json: string): SavedWorld | null {
  try {
    const parsed = JSON.parse(json);
    
    // Проверяем обязательные поля
    if (!parsed.id || !parsed.seed || !parsed.cosmology || !parsed.epoch || 
        !parsed.centralObject || !parsed.celestialBody || !parsed.cradle) {
      return null;
    }
    
    return parsed as SavedWorld;
  } catch {
    return null;
  }
}

/**
 * Форматирование научного статуса
 */
function formatScientificStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'established_fact': 'Установленный факт',
    'physically_plausible': 'Физически правдоподобно',
    'hypothetical': 'Гипотетически',
    'impossible_in_model': 'Невозможно в модели',
    'game_assumption': 'Игровое допущение',
    'anomalous_rule': 'Аномальное правило'
  };
  
  return statusMap[status] || status;
}

/**
 * Получение названия газа по ID
 */
function getGasName(gasId: string): string {
  // В будущем можно подгрузить из модуля Data
  const gasNames: Record<string, string> = {
    'ch4': 'Метан',
    'n2': 'Азот',
    'c2h6': 'Этан',
    'h2': 'Водород',
    'nh3': 'Аммиак',
    'co': 'Угарный газ',
    'co2': 'Углекислый газ',
    'h2o': 'Водяной пар',
    'he': 'Гелий',
    'ar': 'Аргон',
    'ne': 'Неон',
    'o2': 'Кислород',
    'unidentified': 'Неидентифицированный'
  };
  
  return gasNames[gasId] || gasId;
}

/**
 * Получение формулы газа по ID
 */
function getGasFormula(gasId: string): string {
  const gasFormulas: Record<string, string> = {
    'ch4': 'CH₄',
    'n2': 'N₂',
    'c2h6': 'C₂H₆',
    'h2': 'H₂',
    'nh3': 'NH₃',
    'co': 'CO',
    'co2': 'CO₂',
    'h2o': 'H₂O',
    'he': 'He',
    'ar': 'Ar',
    'ne': 'Ne',
    'o2': 'O₂',
    'unidentified': '?'
  };
  
  return gasFormulas[gasId] || gasId;
}

/**
 * Получение статистики хранения
 */
export function getStorageStats(): { total: number; lastSaved: string | null } {
  const worlds = getAllWorlds();
  const lastSaved = worlds.length > 0 ? worlds[0].savedAt : null;
  
  return {
    total: worlds.length,
    lastSaved
  };
}

export default {
  saveWorld,
  getAllWorlds,
  getWorldById,
  deleteWorld,
  clearAllWorlds,
  saveSettings,
  getSettings,
  deleteSettings,
  saveLastSeed,
  getLastSeed,
  exportWorldToJSON,
  exportWorldToMarkdown,
  importWorldFromJSON,
  getStorageStats
};
