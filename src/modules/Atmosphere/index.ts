// ============================================
// ATMOSPHERE - Модуль атмосферы
// ============================================

import type {
  AtmosphereState,
  AtmosphereComponent,
  GasSpecies,
  ID
} from '../../types';

import gases from '../Data/gases';

// ============================================
// ПРЕСЕТЫ АТМОСФЕР
// ============================================

// Пресет "Метаново-этановая атмосфера"
const methaneEthanePreset: AtmosphereState = {
  components: [
    { gasId: 'ch4', percentage: 60, isTrace: false, uncertainty: 'Приблизительно', warnings: [] },
    { gasId: 'n2', percentage: 20, isTrace: false, uncertainty: 'Приблизительно', warnings: [] },
    { gasId: 'c2h6', percentage: 15, isTrace: false, uncertainty: 'Приблизительно', warnings: [] },
    { gasId: 'h2', percentage: 3, isTrace: false, uncertainty: 'Приблизительно', warnings: [] },
    { gasId: 'nh3', percentage: 0.5, isTrace: true, uncertainty: 'Следы', warnings: ['Токсичен в высоких концентрациях'] },
    { gasId: 'co', percentage: 0.3, isTrace: true, uncertainty: 'Следы', warnings: ['Ядовит'] },
    { gasId: 'co2', percentage: 0.2, isTrace: true, uncertainty: 'Следы', warnings: [] },
    { gasId: 'h2o', percentage: 0.1, isTrace: true, uncertainty: 'Следы', warnings: [] },
    { gasId: 'he', percentage: 0.05, isTrace: true, uncertainty: 'Следы', warnings: [] },
    { gasId: 'ar', percentage: 0.03, isTrace: true, uncertainty: 'Следы', warnings: [] },
    { gasId: 'ne', percentage: 0.02, isTrace: true, uncertainty: 'Следы', warnings: [] },
    { gasId: 'o2', percentage: 0.001, isTrace: true, uncertainty: 'Следы', warnings: ['Высоко реактивен'] }
  ],
  totalPressure: 1.5, // atm
  temperature: 95, // K (типично для Титана)
  notes: 'Метаново-этановая атмосфера, аналогичная атмосфере Титана'
};

// Пресет "Земная атмосфера"
const earthAtmospherePreset: AtmosphereState = {
  components: [
    { gasId: 'n2', percentage: 78.08, isTrace: false, uncertainty: 'Точно', warnings: [] },
    { gasId: 'o2', percentage: 20.95, isTrace: false, uncertainty: 'Точно', warnings: [] },
    { gasId: 'ar', percentage: 0.93, isTrace: true, uncertainty: 'Точно', warnings: [] },
    { gasId: 'co2', percentage: 0.04, isTrace: true, uncertainty: 'Изменчиво', warnings: ['Парниковый газ'] },
    { gasId: 'h2o', percentage: 0.001, isTrace: true, uncertainty: 'Изменчиво', warnings: [] },
    { gasId: 'ne', percentage: 0.0018, isTrace: true, uncertainty: 'Точно', warnings: [] },
    { gasId: 'he', percentage: 0.0005, isTrace: true, uncertainty: 'Точно', warnings: [] },
    { gasId: 'ch4', percentage: 0.00017, isTrace: true, uncertainty: 'Точно', warnings: ['Парниковый газ'] },
    { gasId: 'nh3', percentage: 0.00001, isTrace: true, uncertainty: 'Следы', warnings: ['Токсичен'] }
  ],
  totalPressure: 1.0, // atm
  temperature: 288, // K
  notes: 'Современная земная атмосфера'
};

// Пресет "Венера атмосфера"
const venusAtmospherePreset: AtmosphereState = {
  components: [
    { gasId: 'co2', percentage: 96.5, isTrace: false, uncertainty: 'Точно', warnings: ['Парниковый газ', 'Высокое давление'] },
    { gasId: 'n2', percentage: 3.5, isTrace: false, uncertainty: 'Точно', warnings: [] },
    { gasId: 'so2', percentage: 0.015, isTrace: true, uncertainty: 'Изменчиво', warnings: ['Токсичен', 'Кислотный'] },
    { gasId: 'ar', percentage: 0.007, isTrace: true, uncertainty: 'Точно', warnings: [] },
    { gasId: 'h2o', percentage: 0.002, isTrace: true, uncertainty: 'Изменчиво', warnings: [] },
    { gasId: 'co', percentage: 0.0017, isTrace: true, uncertainty: 'Точно', warnings: ['Ядовит'] },
    { gasId: 'he', percentage: 0.0012, isTrace: true, uncertainty: 'Точно', warnings: [] },
    { gasId: 'ne', percentage: 0.0007, isTrace: true, uncertainty: 'Точно', warnings: [] }
  ],
  totalPressure: 92, // atm
  temperature: 737, // K
  notes: 'Атмосфера Венеры - плотная CO2 атмосфера с высоким давлением'
};

// Пресет "Марс атмосфера"
const marsAtmospherePreset: AtmosphereState = {
  components: [
    { gasId: 'co2', percentage: 95.0, isTrace: false, uncertainty: 'Точно', warnings: ['Парниковый газ'] },
    { gasId: 'n2', percentage: 2.7, isTrace: false, uncertainty: 'Точно', warnings: [] },
    { gasId: 'ar', percentage: 1.6, isTrace: false, uncertainty: 'Точно', warnings: [] },
    { gasId: 'o2', percentage: 0.13, isTrace: true, uncertainty: 'Точно', warnings: [] },
    { gasId: 'co', percentage: 0.06, isTrace: true, uncertainty: 'Точно', warnings: ['Ядовит'] },
    { gasId: 'h2o', percentage: 0.03, isTrace: true, uncertainty: 'Изменчиво', warnings: [] },
    { gasId: 'ne', percentage: 0.00025, isTrace: true, uncertainty: 'Точно', warnings: [] }
  ],
  totalPressure: 0.006, // atm
  temperature: 210, // K
  notes: 'Тонкая атмосфера Марса'
};

// Хранилище пресетов
const atmospherePresets: Record<string, AtmosphereState> = {
  methane_ethane: methaneEthanePreset,
  earth: earthAtmospherePreset,
  venus: venusAtmospherePreset,
  mars: marsAtmospherePreset
};

// ============================================
// ФУНКЦИИ РАБОТЫ С АТМОСФЕРОЙ
// ============================================

/**
 * Создание атмосферы из пресета
 */
export function createAtmosphere(presetId: string, rng?: any): AtmosphereState {
  const preset = atmospherePresets[presetId];
  if (!preset) {
    throw new Error(`Unknown atmosphere preset: ${presetId}`);
  }

  // Если есть RNG, можно добавить небольшие случайные вариации
  if (rng) {
    return addRandomVariations(preset, rng);
  }

  return { ...preset };
}

/**
 * Добавление случайных вариаций к атмосфере
 */
function addRandomVariations(atmosphere: AtmosphereState, rng: any): AtmosphereState {
  const result: AtmosphereState = {
    ...atmosphere,
    components: atmosphere.components.map(component => {
      // Не изменяем основные компоненты
      if (!component.isTrace && component.percentage > 5) {
        return { ...component };
      }

      // Добавляем небольшие вариации к следовым компонентам
      const variation = (rng.next() - 0.5) * 0.2; // ±10%
      const newPercentage = component.percentage * (1 + variation);
      
      return {
        ...component,
        percentage: Math.max(0, newPercentage)
      };
    })
  };

  // Нормализуем проценты
  return normalizeAtmosphere(result);
}

/**
 * Нормализация атмосферы (приведение к 100%)
 */
export function normalizeAtmosphere(atmosphere: AtmosphereState): AtmosphereState {
  // Разделяем на основные и следовые компоненты
  const majorComponents = atmosphere.components.filter(c => !c.isTrace);
  const traceComponents = atmosphere.components.filter(c => c.isTrace);

  // Считаем сумму основных компонентов
  const majorSum = majorComponents.reduce((sum, c) => sum + c.percentage, 0);

  // Нормализуем основные компоненты
  const normalizedMajor = majorComponents.map(c => ({
    ...c,
    percentage: (c.percentage / majorSum) * 100
  }));

  // Для следовых компонентов оставляем их проценты как есть
  // но учитываем, что они должны быть меньше основных
  
  // Создаем "неуточненные минорные компоненты" для остатка
  const majorTotal = normalizedMajor.reduce((sum, c) => sum + c.percentage, 0);
  const traceTotal = traceComponents.reduce((sum, c) => sum + c.percentage, 0);
  const total = majorTotal + traceTotal;

  // Если есть остаток, добавляем его как неуточненные компоненты
  const unaccounted = 100 - total;

  const components: AtmosphereComponent[] = [...normalizedMajor, ...traceComponents];

  if (Math.abs(unaccounted) > 0.001) {
    // Добавляем неуточненные компоненты только если остаток значительный
    if (unaccounted > 0.01) {
      components.push({
        gasId: 'unidentified',
        percentage: unaccounted,
        isTrace: true,
        uncertainty: 'Неуточненные минорные компоненты',
        warnings: ['Содержит неидентифицированные газы']
      });
    }
  }

  return {
    ...atmosphere,
    components
  };
}

/**
 * Получение газа по ID
 */
export function getGasById(gasId: ID): GasSpecies | undefined {
  return gases.find(g => g.id === gasId);
}

/**
 * Проверка, что сумма компонентов атмосферы равна 100%
 */
export function validateAtmosphere(atmosphere: AtmosphereState): {
  valid: boolean;
  total: number;
  error: string | null;
} {
  const total = atmosphere.components.reduce((sum, c) => sum + c.percentage, 0);
  const isValid = Math.abs(total - 100) < 0.001;

  return {
    valid: isValid,
    total,
    error: isValid ? null : `Сумма компонентов: ${total.toFixed(6)}% (ожидалось 100%)`
  };
}

/**
 * Создание случайной атмосферы
 */
export function createRandomAtmosphere(rng: any, bodyType: string): AtmosphereState {
  // Выбираем пресет в зависимости от типа тела
  let presetId = 'methane_ethane';
  
  if (bodyType === 'earth_like' || bodyType === 'super_earth') {
    presetId = rng.choose(['earth', 'methane_ethane']);
  } else if (bodyType === 'small_planet') {
    presetId = rng.choose(['mars', 'methane_ethane']);
  }

  const preset = atmospherePresets[presetId];
  if (!preset) {
    return createAtmosphere('methane_ethane', rng);
  }

  return addRandomVariations(preset, rng);
}

/**
 * Получение всех пресетов
 */
export function getAllPresets(): Record<string, AtmosphereState> {
  return { ...atmospherePresets };
}

/**
 * Добавление нового пресета
 */
export function addPreset(id: string, preset: AtmosphereState): void {
  atmospherePresets[id] = preset;
}

/**
 * Удаление пресета
 */
export function removePreset(id: string): boolean {
  if (atmospherePresets[id]) {
    delete atmospherePresets[id];
    return true;
  }
  return false;
}

/**
 * Создание пустой атмосферы
 */
export function createEmptyAtmosphere(): AtmosphereState {
  return {
    components: [],
    totalPressure: null,
    temperature: null,
    notes: 'Пустая атмосфера'
  };
}

/**
 * Добавление компонента к атмосфере
 */
export function addComponent(
  atmosphere: AtmosphereState,
  gasId: ID,
  percentage: number,
  isTrace: boolean = false
): AtmosphereState {
  const existingIndex = atmosphere.components.findIndex(c => c.gasId === gasId);

  const newComponent: AtmosphereComponent = {
    gasId,
    percentage,
    isTrace,
    uncertainty: 'Пользовательский',
    warnings: []
  };

  let components: AtmosphereComponent[];
  
  if (existingIndex !== -1) {
    // Обновляем существующий компонент
    components = [...atmosphere.components];
    components[existingIndex] = newComponent;
  } else {
    // Добавляем новый компонент
    components = [...atmosphere.components, newComponent];
  }

  return normalizeAtmosphere({
    ...atmosphere,
    components
  });
}

/**
 * Удаление компонента из атмосферы
 */
export function removeComponent(atmosphere: AtmosphereState, gasId: ID): AtmosphereState {
  const components = atmosphere.components.filter(c => c.gasId !== gasId);
  
  return normalizeAtmosphere({
    ...atmosphere,
    components
  });
}

/**
 * Обновление процента компонента
 */
export function updateComponentPercentage(
  atmosphere: AtmosphereState,
  gasId: ID,
  newPercentage: number
): AtmosphereState {
  const components = atmosphere.components.map(c => {
    if (c.gasId === gasId) {
      return { ...c, percentage: newPercentage };
    }
    return c;
  });

  return normalizeAtmosphere({
    ...atmosphere,
    components
  });
}

export default {
  createAtmosphere,
  normalizeAtmosphere,
  validateAtmosphere,
  createRandomAtmosphere,
  getAllPresets,
  addPreset,
  removePreset,
  createEmptyAtmosphere,
  addComponent,
  removeComponent,
  updateComponentPercentage,
  getGasById
};
