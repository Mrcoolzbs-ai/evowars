// ============================================
// STORAGE - Модуль хранения данных
// ============================================

import type {
  GeneratedWorld,
  SavedWorld,
  GenerationSettings,
  Seed
} from '../../types';

// Миграции сохранений ведутся реестром научного ядра
// (Core/migrations.ts): цепочка 1.0 → 1.1 → 1.2 детерминирована,
// «нет поля» остаётся «неизвестно», provenance не теряется.
import {
  CURRENT_SAVE_SCHEMA_VERSION,
  migrateSavedWorld,
  SAVE_SCHEMA_VERSIONS
} from '../Core/migrations';

const STORAGE_KEY = 'evowars_worlds';
const SETTINGS_KEY = 'evowars_settings';

/**
 * Версия формата сохранения. Ведётся реестром миграций ядра.
 *
 * История версий:
 * - 1.0 — формат этапа 1–2 (без физической модели);
 * - 1.1 (этап 3) — опциональные поля физической модели
 *   (centralObjectSystem, orbit, bodyPhysics, atmospherePhysics,
 *   phaseAnalysis, geologyAnalysis, energyBudget, chemicalState);
 *   отсутствие поля означает «неизвестно», значения НЕ пересоздаются;
 * - 1.2 (этап 4.1) — опциональное поле coreWorldState (состояние
 *   научного ядра: часы, тела, резервуары, потоки); отсутствие поля
 *   означает «ядро не инициализировано», а не нулевое состояние.
 */
export const STORAGE_FORMAT_VERSION: string = CURRENT_SAVE_SCHEMA_VERSION;

/** Поддерживаемые схемы сохранений (для диагностики). */
export const SUPPORTED_SAVE_VERSIONS: readonly string[] = SAVE_SCHEMA_VERSIONS;

/**
 * Миграция мира из старой версии формата.
 *
 * Выполняется цепочкой реестра Core/migrations.ts:
 * - отсутствующие физические поля остаются «неизвестными»,
 *   значения не пересоздаются;
 * - легаси-давление totalPressure остаётся в atm и не переписывается
 *   (пересчёт в Па выполняется моделью на лету);
 * - поле coreWorldState не создаётся задним числом: ядру нужны данные,
 *   которых в старом сохранении нет;
 * - история миграций накапливается в world.migration.notes.
 */
function migrateWorld(world: SavedWorld): SavedWorld {
  if (world.version === CURRENT_SAVE_SCHEMA_VERSION) return world;
  return migrateSavedWorld(world).world;
}

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
    version: STORAGE_FORMAT_VERSION,
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
    if (!Array.isArray(parsed)) return [];

    // Миграция старых миров к актуальной версии формата.
    // Старые данные не удаляются и не пересоздаются.
    return parsed.map(migrateWorld);
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

  // --- Этап 3: физическая модель (опциональные поля) ---
  if (world.bodyPhysics) {
    lines.push('## Физическая модель тела (этап 3)');
    lines.push('');
    const bp = world.bodyPhysics;
    lines.push(`- **Масса:** ${formatPhysValue(bp.massKg)}`);
    lines.push(`- **Радиус:** ${formatPhysValue(bp.radiusM)}`);
    lines.push(`- **Плотность:** ${formatPhysValue(bp.densityKgM3)}`);
    lines.push(`- **Гравитация:** ${formatPhysValue(bp.surfaceGravityMs2)} (${bp.surfaceGravityInG.value?.toFixed(2) ?? '?'} g)`);
    lines.push(`- **Физическая согласованность:** ${bp.consistencyCheck.plausible ? 'правдоподобно' : 'ВНЕ ДИАПАЗОНА'} — ${bp.consistencyCheck.note}`);
    lines.push('');
  }

  if (world.orbit) {
    lines.push('## Орбитальная конфигурация (этап 3)');
    lines.push('');
    lines.push(`- **Система отсчёта:** ${world.orbit.orbitalBasis}`);
    if (world.orbit.semiMajorAxis.value !== null) {
      lines.push(`- **Большая полуось:** ${world.orbit.semiMajorAxis.value.toFixed(0)} м (${(world.orbit.semiMajorAxis.value / 1.495978707e11).toFixed(3)} а.е.)`);
    } else {
      lines.push(`- **Большая полуось:** неизвестно — ${world.orbit.semiMajorAxis.note ?? ''}`);
    }
    if (world.orbit.eccentricity.value !== null) {
      lines.push(`- **Эксцентриситет:** ${world.orbit.eccentricity.value.toFixed(3)}`);
    }
    if (world.orbit.orbitalPeriod.value !== null) {
      const years = world.orbit.orbitalPeriod.value / 3.15576e7;
      lines.push(`- **Орбитальный период:** ${world.orbit.orbitalPeriod.value.toFixed(0)} с (~${years.toFixed(2)} лет)`);
    }
    lines.push(`- **Проверка устойчивости:** ${world.orbit.stabilityCheck === 'not_performed' ? 'не выполнялась' : world.orbit.stabilityCheck}`);
    lines.push('');
  }

  if (world.energyBudget) {
    lines.push('## Энергетический бюджет (этап 3)');
    lines.push('');
    lines.push(`- **Падающий поток:** ${formatPhysValue(world.energyBudget.incidentFlux)}`);
    lines.push(`- **Равновесная температура:** ${formatPhysValue(world.energyBudget.equilibriumTemperature)}`);
    lines.push(`- **Внутреннее тепло:** ${world.energyBudget.internalHeatLevel}`);
    lines.push(`- Примечание: ${world.energyBudget.greenhouseNote}`);
    world.energyBudget.assumptions.forEach(a => lines.push(`  - допущение: ${a}`));
    lines.push('');
  }

  if (world.atmospherePhysics) {
    lines.push('## Физическая модель атмосферы (этап 3)');
    lines.push('');
    const ap = world.atmospherePhysics;
    if (ap.surfacePressurePa) lines.push(`- **Давление:** ${formatPhysValue(ap.surfacePressurePa)}`);
    if (ap.meanMolarMassKgMol) lines.push(`- **Средняя молярная масса:** ${(ap.meanMolarMassKgMol.value ?? 0).toFixed(4)} кг/моль`);
    if (ap.columnMassKgM2) lines.push(`- **Масса столба:** ${formatPhysValue(ap.columnMassKgM2)}`);
    if (ap.columnMolM2) lines.push(`- **Вещество столба:** ${formatPhysValue(ap.columnMolM2)}`);
    lines.push(`- ${ap.idealGasNote}`);
    lines.push('');
    lines.push('| Газ | Молярная доля | Парциальное давление, Па |');
    lines.push('|-----|---------------|--------------------------|');
    for (const [gasId, fraction] of Object.entries(ap.molarFractions)) {
      const partial = ap.partialPressuresPa[gasId]?.value;
      lines.push(`| ${getGasName(gasId)} | ${(fraction * 100).toFixed(4)}% | ${partial !== null && partial !== undefined ? partial.toExponential(3) : 'неизвестно'} |`);
    }
    lines.push('');
  }

  if (world.phaseAnalysis) {
    lines.push('## Фазовые состояния (этап 3)');
    lines.push('');
    for (const component of world.phaseAnalysis.components) {
      lines.push(`- **${getGasName(component.gasId)}:** ${formatPhaseState(component.state)}${component.screeningRatio !== null && component.screeningRatio !== undefined ? ` (S = ${component.screeningRatio.toFixed(2)})` : ''}${component.message ? ` — ${component.message}` : ''}`);
    }
    world.phaseAnalysis.warnings.forEach(w => lines.push(`- Предупреждение: ${w}`));
    if (world.phaseAnalysis.hasPotentialTransitions) {
      lines.push('- Точный состав и количество конденсированной фазы не рассчитаны: требуется модель равновесия смеси.');
    }
    lines.push('');
  }

  if (world.geologyAnalysis) {
    lines.push('## Внутреннее тепло (этап 3)');
    lines.push('');
    const ga = world.geologyAnalysis;
    lines.push(`- **Суммарный уровень:** ${formatHeatLevel(ga.totalInternalHeat)}`);
    lines.push(`- **Геотермальная энергия доступна:** ${ga.geothermalEnergyAvailable ? 'да' : 'нет'}`);
    lines.push(`- **Остаточное тепло формирования:** ${formatHeatSource(ga.primordialHeat)}`);
    lines.push(`- **Радиогенный нагрев:** ${formatHeatSource(ga.radiogenicHeat)}`);
    lines.push(`- **Приливный нагрев:** ${formatHeatSource(ga.tidalHeat)}`);
    if (ga.volcanism === true) lines.push('- **Вулканизм:** возможен');
    if (ga.volcanism === null) lines.push('- **Вулканизм:** неизвестно');
    lines.push('');
  }

  if (world.chemicalState) {
    lines.push('## Химическая эволюция (этап 3)');
    lines.push('');
    const cs = world.chemicalState;
    lines.push(`- **Режим инвентаря:** ${cs.mode === 'column_inventory' ? 'моль/м² атмосферного столба' : 'нормированный игровой (абсолютное количество неизвестно)'}`);
    lines.push(`- **Единицы:** ${cs.unitsNote}`);
    lines.push(`- **Модельное время:** ${cs.modelTimeYears.toExponential(2)} лет`);
    lines.push(`- **Шаг:** ${cs.stepDurationYears.toExponential(2)} лет (игровое допущение)`);
    if (cs.surfacePressurePa !== null && cs.surfacePressurePa !== undefined) {
      lines.push(`- **Давление:** ${cs.surfacePressurePa.toExponential(4)} Па`);
    }
    const steps = cs.history.length;
    lines.push(`- **Выполнено шагов реакций:** ${steps}`);
    lines.push('');
  }

  // --- Этап 4.1: научное ядро (опциональное поле) ---
  if (world.coreWorldState) {
    lines.push('## Научное ядро (этап 4.1)');
    lines.push('');
    const core = world.coreWorldState;
    lines.push(`- **Схема ядра:** ${core.schemaVersion}`);
    lines.push(`- **Сегмент времени:** ${core.clock.segmentIndex}, шагов: ${core.clock.stepCount}`);
    lines.push(`- **Локальное время симуляции, с:** ${core.clock.localTimeS}`);
    lines.push(`- **Тела:** ${core.bodies.length}; резервуары: ${core.reservoirs.length}; записи потоков: ${core.fluxLedger.records.length}`);
    if (core.note) lines.push(`- Примечание: ${core.note}`);
    lines.push('');
  }

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
    
    // Импортированный мир мигрируется к актуальной версии формата
    // (отсутствующие физические поля остаются неизвестными).
    return migrateWorld(parsed as SavedWorld);
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
 * Форматирование значения физической модели с указанием достоверности.
 * Показывает, где заканчивается известная физика и начинается
 * модельное предположение.
 */
function formatPhysValue(value: { value: number | null; unit: string; confidence: string; note?: string }): string {
  if (value.value === null) {
    return `неизвестно (${value.note ?? 'данных недостаточно'})`;
  }
  const confidenceLabels: Record<string, string> = {
    'established': 'установлено',
    'derived': 'рассчитано',
    'estimated': 'оценка',
    'hypothetical': 'гипотеза',
    'game_assumption': 'игровое допущение',
    'unknown': 'неизвестно'
  };
  const label = confidenceLabels[value.confidence] ?? value.confidence;
  return `${value.value.toExponential(3)} ${value.unit} [${label}]`;
}

/** Русская метка фазового состояния компонента. */
function formatPhaseState(state: string): string {
  const labels: Record<string, string> = {
    'gas': 'газ',
    'potentially_condensing': 'потенциальная конденсация',
    'potential_solid_deposition': 'возможно выпадение твёрдой фазы',
    'no_condensation_above_critical': 'выше критической температуры: жидкой фазы нет',
    'unknown': 'неизвестно'
  };
  return labels[state] ?? state;
}

/** Русская метка уровня внутреннего тепла. */
function formatHeatLevel(level: string): string {
  const labels: Record<string, string> = {
    'high': 'высокий',
    'moderate': 'умеренный',
    'low': 'низкий',
    'none': 'отсутствует',
    'unknown': 'неизвестно'
  };
  return labels[level] ?? level;
}

/** Описание отдельного источника внутреннего тепла. */
function formatHeatSource(source: { level: string | null; status: string; note: string }): string {
  if (source.level === null) {
    return `${source.status === 'potential' ? 'возможен, не оценён' : 'не оценён'} — ${source.note}`;
  }
  return `${formatHeatLevel(source.level)} — ${source.note}`;
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
