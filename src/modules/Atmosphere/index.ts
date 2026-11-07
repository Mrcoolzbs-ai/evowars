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
// ВАЖНО: исходные концентрации и следовые компоненты пресета сохранены
// байт-в-байт (историческая модель original ВПИ); нормализация не должна
// переписывать эти значения.
// Параметры 1.5 atm и 95 K не имеют отдельного источника и помечены
// как неподтверждённые игровые допущения (presetKind: historical_game).
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
  totalPressure: 1.5, // atm (игровое допущение, см. presetNotes)
  temperature: 95, // K (игровое допущение, см. presetNotes)
  notes: 'Исторический игровой сценарий с метаново-этановой атмосферой',
  presetKind: 'historical_game',
  presetNotes:
    'Исторический игровой сценарий (исходная ВПИ). Параметры 1.5 atm и 95 K — ' +
    'неподтверждённые игровые допущения без отдельного источника. Пресет НЕ является ' +
    'точной копией атмосферы Титана; наблюдательный ориентир см. в пресете titan_reference.'
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
  notes: 'Современная земная атмосфера',
  presetKind: 'observational_reference',
  presetNotes: 'Наблюдательный справочный сценарий: значения соответствуют современной атмосфере Земли.'
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
  notes: 'Атмосфера Венеры - плотная CO2 атмосфера с высоким давлением',
  presetKind: 'observational_reference',
  presetNotes: 'Наблюдательный справочный сценарий: значения соответствуют атмосфере Венеры.'
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
  notes: 'Тонкая атмосфера Марса',
  presetKind: 'observational_reference',
  presetNotes: 'Наблюдательный справочный сценарий: значения соответствуют современной атмосфере Марса.'
};

// Пресет "Титан — наблюдательный ориентир" (этап 3, ТЗ §16).
// Справочные характеристики реального небесного тела:
// температура поверхности ~94 K, поверхностное давление ~1.5 bar
// (1.4804 atm), преимущественно азотная атмосфера (~95% N₂, ~5% CH₄).
// Минорные компоненты НЕ выдуманы: справочник хранит только
// опубликованные основные характеристики.
const titanReferencePreset: AtmosphereState = {
  components: [
    { gasId: 'n2', percentage: 95, isTrace: false, uncertainty: 'Приблизительно', warnings: [] },
    { gasId: 'ch4', percentage: 5, isTrace: false, uncertainty: 'Приблизительно', warnings: [] }
  ],
  totalPressure: 1.4804, // atm (= 1.5 bar; справочное давление поверхности Титана)
  temperature: 94, // K (справочная температура поверхности)
  notes: 'Титан — наблюдательный ориентир',
  presetKind: 'observational_reference',
  presetNotes:
    'Справочный ориентир на основе наблюдений реального небесного тела. ' +
    'Не является универсальным шаблоном для всех метановых планет. ' +
    'Минорные компоненты намеренно не указаны: опубликованные данные о них не входят в этот справочник.'
};

// Хранилище пресетов
const atmospherePresets: Record<string, AtmosphereState> = {
  methane_ethane: methaneEthanePreset,
  earth: earthAtmospherePreset,
  venus: venusAtmospherePreset,
  mars: marsAtmospherePreset,
  titan_reference: titanReferencePreset
};

// ============================================
// НОРМАЛИЗАЦИЯ АТМОСФЕРЫ
// ============================================

// Идентификатор компонента "неизвестные минорные компоненты".
// Неучтённый остаток обозначается именно так, а не произвольным газом.
export const UNIDENTIFIED_COMPONENT_ID = 'unidentified';

// Допустимая погрешность округления суммы компонентов (в процентах).
// Пресеты заданы с 2-4 значащими цифрами, поэтому отклонения до 0.05%
// считаются погрешностью округления, а не ошибкой состава.
export const DEFAULT_NORMALIZATION_TOLERANCE = 0.05;

// Режим нормализации:
// - 'strict' — по умолчанию: если сумма известных компонентов превышает 100%
//   сверх допустимой погрешности, выдаётся понятная ошибка;
// - 'proportional' — явно выбранный режим пропорциональной нормализации:
//   все компоненты пропорционально масштабируются к 100%.
export type NormalizeMode = 'strict' | 'proportional';

export interface NormalizeAtmosphereOptions {
  mode?: NormalizeMode;
  tolerance?: number;
}

/**
 * Нормализация атмосферы (приведение суммы компонентов к 100%).
 *
 * Алгоритм (исправлен по результатам аудита):
 *
 * 1. Сумма считается по ВСЕМ компонентам — основным и следовым.
 *    Следовые компоненты учитываются в общей сумме.
 * 2. Основные компоненты НЕ принудительно растягиваются до 100%,
 *    если в атмосфере присутствуют другие газы.
 * 3. Если сумма известна с точностью до погрешности округления (по
 *    умолчанию 0.05%) — исходные значения сохраняются без изменений.
 * 4. Если сумма меньше 100% — неучтённый остаток добавляется ОДИН раз
 *    как "неизвестные минорные компоненты" (gasId = 'unidentified').
 *    Повторная нормализация не приводит к двойному учёту остатка.
 * 5. Если сумма известных компонентов превышает 100% сверх погрешности:
 *    - режим 'strict' (по умолчанию) — понятная ошибка;
 *    - режим 'proportional' — явная пропорциональная нормализация.
 * 6. Отрицательные и нечисловые концентрации не допускаются — ошибка.
 * 7. Исходные значения, диапазоны (minRange/maxRange), пометка isTrace
 *    и неопределённость (uncertainty) сохраняются.
 */
export function normalizeAtmosphere(
  atmosphere: AtmosphereState,
  options: NormalizeAtmosphereOptions = {}
): AtmosphereState {
  const mode: NormalizeMode = options.mode ?? 'strict';
  const tolerance = options.tolerance ?? DEFAULT_NORMALIZATION_TOLERANCE;

  // Пустая атмосфера не нормализуется
  if (atmosphere.components.length === 0) {
    return { ...atmosphere, components: [] };
  }

  // 6. Проверка корректности концентраций: без отрицательных значений и NaN.
  for (const component of atmosphere.components) {
    if (typeof component.percentage !== 'number' || Number.isNaN(component.percentage)) {
      throw new Error(
        `Некорректная концентрация компонента ${component.gasId}: ${component.percentage}. ` +
        'Концентрация должна быть числом.'
      );
    }
    if (component.percentage < 0) {
      throw new Error(
        `Отрицательная концентрация компонента ${component.gasId}: ${component.percentage}%. ` +
        'Отрицательные концентрации не допускаются.'
      );
    }
  }

  // 1. Сумма по всем компонентам (основные + следовые + уже существующий остаток).
  const total = atmosphere.components.reduce((sum, c) => sum + c.percentage, 0);
  const remainder = 100 - total;

  // 3. Сумма уже равна 100% с учётом погрешности округления — ничего не меняем.
  if (Math.abs(remainder) <= tolerance) {
    return { ...atmosphere, components: atmosphere.components.map(c => ({ ...c })) };
  }

  // 5. Сумма известных компонентов превышает 100% сверх погрешности.
  if (remainder < 0) {
    if (mode === 'proportional') {
      // Явно выбранный режим пропорциональной нормализации:
      // масштабируем все компоненты пропорционально, сохраняя соотношения.
      const normalizedComponents = atmosphere.components.map(c => ({
        ...c,
        percentage: (c.percentage / total) * 100
      }));
      return { ...atmosphere, components: normalizedComponents };
    }
    throw new Error(
      `Сумма компонентов атмосферы превышает 100%: ${total.toFixed(6)}% ` +
      `(превышение ${Math.abs(remainder).toFixed(6)}%, допуск ${tolerance}%). ` +
      'Используйте режим пропорциональной нормализации ' +
      '(normalizeAtmosphere(atmosphere, { mode: \'proportional\' })) ' +
      'или исправьте состав.'
    );
  }

  // 4. Сумма меньше 100% — неучтённый остаток обозначается как
  // неизвестные минорные компоненты, а не как произвольный газ.
  // Если такой компонент уже существует, остаток добавляется к нему
  // (без двойного учёта).
  const existingUnidentifiedIndex = atmosphere.components.findIndex(
    c => c.gasId === UNIDENTIFIED_COMPONENT_ID
  );

  const components: AtmosphereComponent[] = atmosphere.components.map(c => ({ ...c }));

  if (existingUnidentifiedIndex !== -1) {
    const existing = components[existingUnidentifiedIndex];
    components[existingUnidentifiedIndex] = {
      ...existing,
      percentage: existing.percentage + remainder
    };
  } else {
    components.push({
      gasId: UNIDENTIFIED_COMPONENT_ID,
      percentage: remainder,
      isTrace: true,
      uncertainty: 'Неуточненные минорные компоненты',
      warnings: ['Содержит неидентифицированные газы']
    });
  }

  return { ...atmosphere, components };
}

// ============================================
// ПРОВЕРКА ВАЛИДНОСТИ СОСТАВА АТМОСФЕРЫ
// ============================================

export interface AtmosphereValidation {
  valid: boolean;
  total: number;
  error: string | null;
  issues: string[];
}

/**
 * Отдельная проверка валидности состава атмосферы.
 * Проверяет:
 * - отсутствие отрицательных и нечисловых концентраций;
 * - отсутствие дубликатов газов;
 * - сумму компонентов (100% с учётом допустимой погрешности округления).
 */
export function validateAtmosphere(
  atmosphere: AtmosphereState,
  tolerance: number = DEFAULT_NORMALIZATION_TOLERANCE
): AtmosphereValidation {
  const issues: string[] = [];
  const seen = new Set<ID>();
  let total = 0;

  for (const component of atmosphere.components) {
    if (typeof component.percentage !== 'number' || Number.isNaN(component.percentage)) {
      issues.push(`Компонент ${component.gasId}: концентрация не является числом (${component.percentage})`);
      continue;
    }
    if (component.percentage < 0) {
      issues.push(`Компонент ${component.gasId}: отрицательная концентрация (${component.percentage}%)`);
    }
    if (seen.has(component.gasId)) {
      issues.push(`Компонент ${component.gasId} указан более одного раза`);
    }
    seen.add(component.gasId);
    total += component.percentage;
  }

  const sumValid = Math.abs(total - 100) <= tolerance;
  if (!sumValid) {
    issues.push(`Сумма компонентов: ${total.toFixed(6)}% (ожидалось 100% с допуском ${tolerance}%)`);
  }

  const valid = issues.length === 0;

  return {
    valid,
    total,
    error: valid
      ? null
      : `Состав атмосферы невалиден: ${issues.join('; ')}`,
    issues
  };
}

// ============================================
// ФУНКЦИИ РАБОТЫ С АТМОСФЕРОЙ
// ============================================

/**
 * Создание атмосферы из пресета.
 * Исходные концентрации пресета сохраняются; неучтённый остаток
 * обозначается как неизвестные минорные компоненты.
 */
export function createAtmosphere(presetId: string, rng?: any): AtmosphereState {
  const preset = atmospherePresets[presetId];
  if (!preset) {
    throw new Error(`Unknown atmosphere preset: ${presetId}`);
  }

  // Работаем с копией, чтобы не изменять пресет
  const copy: AtmosphereState = {
    ...preset,
    components: preset.components.map(c => ({ ...c }))
  };

  // Наблюдательный справочный пресет не рандомизируется:
  // его значения — зафиксированные характеристики реального объекта.
  // Исторические и гипотетические пресеты сохраняют вариации этапа 2.
  if (presetId === 'titan_reference') {
    return normalizeAtmosphere(copy);
  }

  // Если есть RNG, добавляем небольшие случайные вариации
  if (rng) {
    return addRandomVariations(copy, rng);
  }

  return normalizeAtmosphere(copy);
}

/**
 * Добавление случайных вариаций к атмосфере.
 * Основные компоненты (> 5%, не следовые) не изменяются;
 * следовые компоненты варьируются в пределах ±10%.
 */
function addRandomVariations(atmosphere: AtmosphereState, rng: any): AtmosphereState {
  // Основные компоненты (не следовые, > 5%) не изменяются: их сумма
  // задаёт бюджет для вариаций следовых и минорных компонентов.
  const majorSum = atmosphere.components
    .filter(component => !component.isTrace && component.percentage > 5)
    .reduce((sum, component) => sum + component.percentage, 0);

  // Вариации не могут вывести сумму известных компонентов за 100%:
  // в противном случае строгая нормализация ниже обоснованно отклонила бы
  // состав. Бюджет гарантирует, что исходные концентрации сохраняются,
  // а неучтённый остаток обозначается как неизвестные минорные компоненты.
  let budget = Math.max(0, 100 - majorSum);

  const result: AtmosphereState = {
    ...atmosphere,
    components: atmosphere.components.map(component => {
      // Не изменяем основные компоненты
      if (!component.isTrace && component.percentage > 5) {
        return { ...component };
      }

      // Добавляем небольшие вариации к следовым и минорным компонентам
      const variation = (rng.next() - 0.5) * 0.2; // ±10%
      let newPercentage = component.percentage * (1 + variation);

      // Ограничиваем вариацию доступным остатком до 100%
      if (newPercentage > budget) {
        newPercentage = budget;
      }
      budget -= Math.max(0, newPercentage);

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
 * Получение газа по ID
 */
export function getGasById(gasId: ID): GasSpecies | undefined {
  return gases.find(g => g.id === gasId);
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
 * Добавление компонента к атмосфере.
 * Пользовательское редактирование использует явно выбранный
 * режим пропорциональной нормализации, чтобы новый компонент
 * помещался в состав без превышения 100%.
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

  return normalizeAtmosphere(
    { ...atmosphere, components },
    { mode: 'proportional' }
  );
}

/**
 * Удаление компонента из атмосферы.
 * Остаток неучтённой доли обозначается как неизвестные минорные компоненты.
 */
export function removeComponent(atmosphere: AtmosphereState, gasId: ID): AtmosphereState {
  const components = atmosphere.components.filter(c => c.gasId !== gasId);

  return normalizeAtmosphere({ ...atmosphere, components });
}

/**
 * Обновление процента компонента.
 * Пользовательское редактирование использует явно выбранный
 * режим пропорциональной нормализации.
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

  return normalizeAtmosphere(
    { ...atmosphere, components },
    { mode: 'proportional' }
  );
}

// ============================================
// ФИЗИЧЕСКАЯ МОДЕЛЬ АТМОСФЕРЫ (ЭТАП 3)
// ============================================

import type { AtmospherePhysicalModel, PhysValue } from '../../types';
import { atmToPa } from '../Units';

export interface ComputePhysicalModelOptions {
  /** Поверхностная гравитация, м/с²; null — неизвестна */
  surfaceGravityMs2?: number | null;
}

/**
 * Физическая модель атмосферы: молярные доли, поверхностное давление
 * (Па), парциальные давления p_i = x_i·P (приближение идеального газа),
 * атмосферный столб m = P/g и n = P/(g·M).
 *
 * НИЧЕГО не выдумывается:
 * - без давления → парциальные давления и столб неизвестны (null);
 * - без гравитации → столб неизвестен;
 * - при компоненте с неизвестной молярной массой (в том числе
 *   'unidentified') средняя молярная масса не рассчитывается;
 * - молярные доли хранятся в диапазоне 0..1 и не смешиваются
 *   с массовыми долями.
 */
export function computeAtmospherePhysicalModel(
  atmosphere: AtmosphereState,
  options: ComputePhysicalModelOptions = {}
): AtmospherePhysicalModel {
  const gravity = options.surfaceGravityMs2 ?? null;

  // 1. Молярные доли x_i = percentage_i / Σ percentage: доли обязаны
  // суммироваться в 1, даже если каталог задаёт состав с погрешностью
  // округления суммы процентов (например, справочный пресет Венеры 100.0276%).
  const percentageSum = atmosphere.components.reduce((sum, c) => sum + c.percentage, 0);
  const molarFractions: Record<string, number> = {};
  for (const component of atmosphere.components) {
    molarFractions[component.gasId] =
      percentageSum > 0 ? component.percentage / percentageSum : 0;
  }

  // 2. Поверхностное давление в Па (миграция легаси-поля atm → Pa).
  const totalPressureAtm = atmosphere.totalPressure;
  const surfacePressurePa: PhysValue | null =
    totalPressureAtm === null
      ? null
      : {
          value: atmToPa(totalPressureAtm),
          unit: 'Па',
          confidence: 'derived',
          method: 'перевод легаси-значения давления из atm в Па',
          formula: 'P(Па) = P(atm) × 101325',
          parameters: { 'P (atm)': totalPressureAtm },
          note:
            atmosphere.presetKind === 'historical_game'
              ? 'исходное давление — неподтверждённое игровое допущение исторического пресета'
              : undefined
        };

  const totalPressurePaValue = surfacePressurePa?.value ?? null;

  // 3. Средняя молярная масса смеси M = Σ x_i·M_i (кг/моль).
  // Не рассчитывается, если хотя бы один компонент неизвестен.
  let meanMolarMassKgMol: number | null = 0;
  for (const [gasId, x] of Object.entries(molarFractions)) {
    if (x <= 0) continue;
    const gas = gases.find(g => g.id === gasId);
    if (!gas || gas.molarMass === null) {
      meanMolarMassKgMol = null;
      break;
    }
    meanMolarMassKgMol += x * (gas.molarMass / 1000);
  }

  // 4. Парциальные давления p_i = x_i × P_total (идеальный газ).
  const partialPressuresPa: Record<string, PhysValue> = {};
  for (const [gasId, x] of Object.entries(molarFractions)) {
    partialPressuresPa[gasId] = {
      value: totalPressurePaValue === null ? null : x * totalPressurePaValue,
      unit: 'Па',
      confidence: totalPressurePaValue === null ? 'unknown' : 'derived',
      method: 'p_i = x_i × P_total (приближение идеального газа)',
      formula: 'p_i = x_i × P',
      parameters: { 'x_i': x }
    };
  }

  // 5. Атмосферный столб: m = P/g, n = P/(g·M) (гидростатическое приближение).
  const columnMassKgM2: PhysValue | null =
    totalPressurePaValue !== null && gravity !== null && gravity > 0
      ? {
          value: totalPressurePaValue / gravity,
          unit: 'кг/м²',
          confidence: 'derived',
          method: 'масса атмосферного столба на единицу площади',
          formula: 'm_column = P / g',
          parameters: { 'P (Па)': totalPressurePaValue, 'g (м/с²)': gravity }
        }
      : null;

  const columnMolM2: PhysValue | null =
    totalPressurePaValue !== null && gravity !== null && gravity > 0 && meanMolarMassKgMol !== null && meanMolarMassKgMol > 0
      ? {
          value: totalPressurePaValue / (gravity * meanMolarMassKgMol),
          unit: 'моль/м²',
          confidence: 'derived',
          method: 'количество вещества в атмосферном столбе на единицу площади',
          formula: 'n_column = P / (g × M)',
          parameters: {
            'P (Па)': totalPressurePaValue,
            'g (м/с²)': gravity,
            'M (кг/моль)': meanMolarMassKgMol
          }
        }
      : null;

  // 6. Минимальная вертикальная структура (расширяемая).
  const temperatureK = atmosphere.temperature;
  const layers = [
    {
      layerId: 'surface_boundary',
      altitudeRangeM: { min: 0, max: null },
      temperatureK,
      pressurePa: totalPressurePaValue,
      composition: atmosphere.components.map(c => c.gasId),
      densityKgM3: null,
      cloudiness: null,
      radiativeConditions: null,
      note:
        'известен только приземный слой; состав — молярные доли у поверхности. ' +
        'Тропосфера, стратосфера, мезосфера, термосфера и экзосфера на данном этапе не моделируются.'
    }
  ];

  // Средняя молярная масса как PhysValue: значение + степень достоверности.
  const meanMolarMassValue: PhysValue | null = meanMolarMassKgMol === null ? null : {
    value: meanMolarMassKgMol,
    unit: 'кг/моль',
    confidence: 'derived',
    method: 'средняя молярная масса смеси по молярным долям',
    formula: 'M = Σ x_i·M_i',
    note: 'не рассчитывается при компонентах с неизвестной молярной массой (в том числе unidentified)'
  };

  return {
    molarFractions,
    surfacePressurePa,
    meanMolarMassKgMol: meanMolarMassValue,
    partialPressuresPa,
    columnMassKgM2,
    columnMolM2,
    idealGasAssumption: true,
    idealGasNote:
      'используется приближение идеального газа: p_i = x_i·P. Для реальных газов при высоких ' +
      'давлениях и низких температурах это приближение неточно.',
    fugacityNote:
      'коэффициенты фугитивности и другие поправки на неидеальность НЕ учитываются: ' +
      'результаты при высоких давлениях (десятки бар и выше) и низких температурах — ' +
      'приближение, а не точный физический результат.',
    layers,
    layersNote:
      'модель вертикальной структуры минимальна: хранится только поверхностный слой. ' +
      'Полный профиль (тропосфера/стратосфера/мезосфера/термосфера/экзосфера) требует данных, ' +
      'которых генератор не имеет; слои добавляются по мере появления данных.',
    notes: [
      'молярные доли хранятся в диапазоне 0..1 и не смешиваются с массовыми долями',
      "компонент 'unidentified' входит в доли как неизвестный остаток: его молярная масса неизвестна, поэтому средняя молярная масса смеси не рассчитывается",
      'обмен с поверхностью и вертикальный перенос не моделируются'
    ]
  };
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
  getGasById,
  computeAtmospherePhysicalModel
};
