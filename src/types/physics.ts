// ============================================
// PHYSICS TYPES - Типы физической модели мира (этап 3)
// ============================================
//
// Все новые структуры физической модели мира.
// Каждый физический параметр оборачивается в PhysValue, который хранит
// не только значение, но и степень научной достоверности, способ
// получения, формулу, источник и ограничения применимости.
//
// Файл содержит только типы — без runtime-значений.

// Stage 4.2.2: типизированная температура фазового скрининга.
import type { ScientificValue } from '../modules/Core/scientificValue';

// ============================================
// 1. СИСТЕМА НАУЧНОЙ ДОСТОВЕРНОСТИ
// ============================================

/**
 * Единая шкала научной достоверности физических параметров.
 *
 * - established  — экспериментально или наблюдательно установленное значение;
 * - derived       — рассчитано из известных параметров проверяемой формулой;
 * - estimated     — оценка в пределах обоснованного диапазона;
 * - hypothetical  — физически мотивированный, но гипотетический сценарий;
 * - game_assumption — специальное игровое допущение (не научное значение);
 * - unknown       — данных недостаточно; значение не определяется.
 */
export type ScientificConfidence =
  | 'established'
  | 'derived'
  | 'estimated'
  | 'hypothetical'
  | 'game_assumption'
  | 'unknown';

/**
 * Универсальная обёртка физического значения.
 * Если точное значение неизвестно, value = null и это явно отражается
 * в confidence — значение НЕ подменяется произвольным числом.
 */
export interface PhysValue<T = number> {
  value: T | null;
  unit: string;
  confidence: ScientificConfidence;
  /** Диапазон, если параметр известен как интервал (та же единица, что у value) */
  range?: { min: number; max: number };
  /** Способ получения значения */
  method?: string;
  /** Формула расчёта, если применимо */
  formula?: string;
  /** Исходные параметры расчёта */
  parameters?: Record<string, number | string>;
  /** Степень/характер неопределённости */
  uncertainty?: string;
  /** Источник данных или библиографическая ссылка; пусто, если источник неизвестен */
  source?: string;
  /** Ограничения применимости */
  applicability?: string;
  /** Дополнительное пояснение */
  note?: string;
}

// ============================================
// 2. СТРУКТУРНАЯ МОДЕЛЬ ЦЕНТРАЛЬНОГО ОБЪЕКТА
// ============================================
//
// Центральный объект каталога раскладывается на физически разные сущности:
// гравитационный первичный объект, источник излучения, родительское тело,
// дополнительные источники энергии и особенности высокоэнергетического
// окружения. Релятивистский джет моделируется отдельно от звёзд.

/** Модель звезды главной последовательности (класс, а не конкретная звезда). */
export interface StarPhysicalModel {
  kind: 'star';
  spectralClass: string;
  /** Масса в кг (диапазон класса, value = null) */
  massKg: PhysValue;
  /** Светимость в Вт (диапазон класса, value = null) */
  luminosityW: PhysValue;
  /** Эффективная температура в К (диапазон класса, value = null) */
  effectiveTemperatureK: PhysValue;
  /**
   * Минимальный возраст Вселенной (млрд лет), при котором объекты этого
   * класса уже могут существовать. НЕ связано со временем жизни объекта.
   */
  earliestUniverseAgeGyr: number;
  /**
   * Характерное время жизни ОТДЕЛЬНОЙ звезды класса (млрд лет).
   * Не равно возрасту Вселенной: голубой гигант может сформироваться
   * и в древней Вселенной, но просуществует недолго.
   */
  typicalLifetimeGyr: { min: number; max: number };
  /** Пояснение о текущей стадии и оставшемся времени стабильности */
  stageNote: string;
  /** Доступные энергетические процессы */
  energyProcesses: string[];
  /** Основные угрозы для планетарной среды */
  threats: string[];
  notes: string[];
}

/** Компактный остаток звезды: белый карлик, нейтронная звезда, чёрная дыра. */
export interface CompactRemnantModel {
  kind: 'compact_remnant';
  remnantType: 'white_dwarf' | 'neutron_star' | 'black_hole';
  massKg: PhysValue;
  radiusM: PhysValue | null;
  /**
   * Собственное излучение (Вт). У белого карлика — остаточное тепловое
   * свечение (диапазон, value = null). У нейтронной звезды и чёрной дыры —
   * null: излучение зависит от аккреции и вращения и не гарантируется.
   */
  intrinsicLuminosityW: PhysValue | null;
  /** Является ли мощное излучение зависящим от наличия аккреционного материала */
  accretionDependent: boolean;
  accretionNote: string;
  /** Пояснение про радиацию Хокинга (для чёрных дыр) */
  hawkingRadiationNote: string | null;
  earliestUniverseAgeGyr: number;
  notes: string[];
}

/** Субзвёздный объект: коричневый карлик. */
export interface SubstellarModel {
  kind: 'substellar';
  massKg: PhysValue;
  luminosityW: PhysValue | null;
  effectiveTemperatureK: PhysValue | null;
  /** Внутреннее тепловыделение (гравитационное сжатие) присуще классу */
  hasInternalHeat: boolean;
  earliestUniverseAgeGyr: number;
  notes: string[];
}

/** Одинокий газовый гигант как самостоятельная система со спутниками. */
export interface GasGiantSystemModel {
  kind: 'gas_giant_system';
  massKg: PhysValue;
  /**
   * Радиус класса газовых гигантов, м (value = null, задан диапазон).
   * Поле опционально для обратной совместимости старых сохранений.
   * Используется как масштаб орбит спутников РОДИТЕЛЬСКОЙ планеты,
   * а не как параметр самой луны.
   */
  radiusM?: PhysValue;
  /** Внутреннее тепловыделение в Вт: конкретное значение неизвестно (value = null) */
  internalHeatW: PhysValue | null;
  moonSystem: {
    possible: boolean;
    /** Диапазон орбит спутников в радиусах родительской планеты */
    orbitRangeParentRadii: { min: number; max: number } | null;
    tidalInteractions: 'possible' | null;
    note: string;
  };
  earliestUniverseAgeGyr: number;
  notes: string[];
}

/**
 * Релятивистский джет — НЕ центральный гравитационный объект,
 * а направленный высокоэнергетический поток, связанный с компактным
 * объектом (чёрной дырой или нейтронной звездой) активного ядра.
 */
export interface JetSystemModel {
  kind: 'jet_system';
  /** Классы компактных объектов, способных порождать джет */
  sourceObjectTypes: string[];
  /** Направленность джета */
  direction: 'bipolar';
  collimationNote: string;
  /** Интенсивность излучения: неизвестна, пока не задана явно (value = null) */
  intensityW: PhysValue;
  /** Возможно ли нахождение планеты вне основной зоны воздействия */
  planetCanAvoidMainBeam: boolean;
  note: string;
  earliestUniverseAgeGyr: number;
  notes: string[];
}

/** Структурная модель центрального объекта / системы. */
export type CentralObjectSystem =
  | StarPhysicalModel
  | CompactRemnantModel
  | SubstellarModel
  | GasGiantSystemModel
  | JetSystemModel;

// ============================================
// 3. ОРБИТАЛЬНАЯ КОНФИГУРАЦИЯ
// ============================================

export type OrbitalFrame =
  | 'around_star'          // планета вокруг звезды / компактного остатка
  | 'around_parent_body'   // спутник вокруг родительской планеты
  | 'free_floating'        // свободно плавающая система без звезды
  | 'jet_system';          // система вблизи релятивистского джета

export interface OrbitalConfigurationData {
  /** Относительно чего задаётся орбита */
  frame: OrbitalFrame;
  /** Тело, вокруг которого строится орбита (описание) */
  orbitalBasis: string;
  /** Большая полуось, м (value = null, если орбита не определена) */
  semiMajorAxis: PhysValue;
  /** Эксцентриситет (value = null, если не определён) */
  eccentricity: PhysValue;
  /** Орбитальный период, с (по III закону Кеплера; null, если масса центра неизвестна) */
  orbitalPeriod: PhysValue;
  /** Наклонение: не моделируется — value = null с пояснением */
  inclination: PhysValue;
  /** Приливный захват: 'possible' | 'unlikely' | 'unknown' */
  tidalLocking: PhysValue<string>;
  /** Динамическая устойчивость строго не проверялась */
  stabilityCheck: 'not_performed';
  stabilityNote: string;
  /** Радиационные условия орбиты (описание) */
  radiativeConditions: string;
  notes: string[];
}

// ============================================
// 4. ЭНЕРГЕТИЧЕСКИЙ БАЛАНС
// ============================================

export interface EnergyBudgetModel {
  /** Падающий энергетический поток, Вт/м² (null, если светимость/расстояние неизвестны) */
  incidentFlux: PhysValue;
  /** Равновесная температура, К (null без потока; не равна температуре поверхности) */
  equilibriumTemperature: PhysValue;
  /** Пояснение о парниковом разрыве T_eq и T_surface */
  greenhouseNote: string;
  /** Явные допущения модели (альбедо, эмиссивность, перераспределение тепла) */
  assumptions: string[];
  /** Уровень внутреннего тепловыделения из модуля Geology */
  internalHeatLevel: 'high' | 'moderate' | 'low' | 'none' | 'unknown';
  notes: string[];
}

// ============================================
// 5. ФИЗИЧЕСКИЕ ПАРАМЕТРЫ ПЛАНЕТЫ
// ============================================

export interface BodyPhysicalSample {
  /** Масса, кг (сэмплирована из диапазона каталога) */
  massKg: PhysValue;
  /** Радиус, м (сэмплирован из диапазона каталога) */
  radiusM: PhysValue;
  /** Средняя плотность, кг/м³ (derived: M / (4/3·π·R³)) */
  densityKgM3: PhysValue;
  /** Поверхностная гравитация, м/с² (derived: g = G·M/R²) */
  surfaceGravityMs2: PhysValue;
  /** Та же гравитация в земных g */
  surfaceGravityInG: PhysValue;
  /** Проверка физической согласованности массы, радиуса и плотности */
  consistencyCheck: {
    plausible: boolean;
    densityRangeKgM3: { min: number; max: number };
    note: string;
  };
  /** Описание метода сэмплирования */
  samplingMethod: string;
  notes: string[];
}

// ============================================
// 6. ФИЗИЧЕСКАЯ МОДЕЛЬ АТМОСФЕРЫ
// ============================================

/** Минимальная модель вертикального слоя атмосферы (расширяемая). */
export interface AtmosphereLayerModel {
  layerId: string;
  /** Диапазон высот, м (null — неизвестен) */
  altitudeRangeM: { min: number; max: number | null } | null;
  temperatureK: number | null;
  pressurePa: number | null;
  /** Качественный состав слоя */
  composition: string[];
  densityKgM3: number | null;
  /** Облачность: доля 0..1 или null (неизвестна) */
  cloudiness: number | null;
  radiativeConditions: string | null;
  note: string;
}

/**
 * Физическая модель атмосферы: молярные доли, парциальные давления
 * (Па), атмосферный столб и минимальная слоистая структура.
 * Строится по данным AtmosphereState и известной гравитации.
 */
export interface AtmospherePhysicalModel {
  /** Молярные доли x_i в диапазоне 0..1 (сумма = 1 для нормализованного состава) */
  molarFractions: Record<string, number>;
  /** Поверхностное давление, Па (derived из atm; null, если неизвестно) */
  surfacePressurePa: PhysValue | null;
  /** Средняя молярная масса смеси, кг/моль (null при неизвестном составе) */
  meanMolarMassKgMol: PhysValue | null;
  /** Парциальные давления p_i = x_i · P_total, Па */
  partialPressuresPa: Record<string, PhysValue>;
  /** Масса атмосферного столба на единицу площади m = P/g, кг/м² */
  columnMassKgM2: PhysValue | null;
  /** Количество вещества столба n = P/(g·M), моль/м² */
  columnMolM2: PhysValue | null;
  /** Признак приближения идеального газа */
  idealGasAssumption: boolean;
  idealGasNote: string;
  /** Предупреждение о неидеальности при высоких давлениях/низких температурах */
  fugacityNote: string;
  /** Минимальная слоистая структура (расширяемая) */
  layers: AtmosphereLayerModel[];
  layersNote: string;
  notes: string[];
}

// ============================================
// 7. ФАЗОВЫЕ СОСТОЯНИЯ И РЕЗЕРВУАРЫ ВЕЩЕСТВА
// ============================================

export type PhaseScreenState =
  | 'gas'                          // парциальное давление ниже давления насыщенного пара
  | 'potentially_condensing'      // S_i >= 1: возможна конденсация
  | 'potential_solid_deposition'  // ниже тройной точки: возможно выпадение твёрдой фазы
  | 'no_condensation_above_critical' // выше критической температуры жидкой фазы нет
  | 'unknown';                     // данных недостаточно

export interface PhaseComponentAnalysis {
  gasId: string;
  state: PhaseScreenState;
  /** Скрининговый показатель S_i = p_i / P_sat (null, если не вычислен) */
  screeningRatio: number | null;
  /** Давление насыщенного пара, Па (null, если не вычислено) */
  saturationPressurePa: number | null;
  /** Вычислено ли за пределами экспериментального диапазона корреляции */
  extrapolated: boolean;
  message: string;
  confidence: ScientificConfidence;
}

export interface AtmospherePhaseAnalysis {
  temperatureK: number | null;
  components: PhaseComponentAnalysis[];
  hasPotentialTransitions: boolean;
  warnings: string[];
  /** Итоговое предупреждение о границах модели смеси */
  mixtureNote: string;
  /**
   * Температура, на которой основан скрининг, как типизированное
   * значение с происхождением (Stage 4.2.2). temperatureK — то же
   * число безыдентификационно; temperatureBasis объясняет, ЧЬЯ это
   * температура и откуда она взялась (пресет атмосферы, а НЕ
   * температура поверхности и НЕ T_eq).
   */
  temperatureBasis?: PhaseTemperatureBasis;
  notes: string[];
}

/**
 * Осание температуры фазового скрининга (Stage 4.2.2): значение
 * ScientificValue (статус + число + provenance) и явное пояснение.
 * Скрининг без числовой температуры не подставляет T_eq или
 * температуру поверхности — компоненты остаются unknown.
 */
export interface PhaseTemperatureBasis {
  temperature: ScientificValue;
  note: string;
}

/** Резервуары вещества. Вещество не исчезает при фазовых переходах. */
export interface SubstanceReservoirs {
  /** Атмосферная газовая фаза */
  atmospheric: Record<string, number>;
  /** Жидкая фаза на поверхности */
  liquidSurface: Record<string, number>;
  /** Подповерхностная жидкость */
  subsurfaceLiquid: Record<string, number>;
  /** Твёрдые отложения */
  solidDeposits: Record<string, number>;
}

// ============================================
// 8. ХИМИЧЕСКАЯ ЭВОЛЮЦИЯ
// ============================================

/**
 * Режим инвентаря:
 * - column_inventory — моли вещества на м² атмосферного столба (физические единицы);
 * - game_normalized  — нормированный игровой инвентарь (абсолютное физическое
 *   количество неизвестно; явно помечается как игровое допущение).
 */
export type InventoryMode = 'column_inventory' | 'game_normalized';

export interface ChemicalStepRecord {
  stepNumber: number;
  reactionId: string;
  applied: boolean;
  mode: 'stoichiometric' | 'kinetic' | 'disabled';
  /** Степень превращения (количество реакции) за шаг */
  extent: number | null;
  limitingReactant: string | null;
  reason: string;
  /** Изменения количества веществ (моль/м² или игровые единицы) */
  changes: Record<string, number>;
  confidence: ScientificConfidence;
}

export interface ChemicalEvolutionState {
  mode: InventoryMode;
  unitsNote: string;
  /** Атмосферный инвентарь: газId -> количество (моль/м² или игровые единицы) */
  inventory: Record<string, number>;
  /** Все резервуары вещества (atmospheric синхронен с inventory) */
  reservoirs: SubstanceReservoirs;
  /** Молярные доли компонентов (0..1), пересчитываются после шагов */
  molarFractions: Record<string, number>;
  /** Текущее поверхностное давление, Па (пересчитывается в режиме column_inventory) */
  surfacePressurePa: number | null;
  /** Гравитация, использованная для столба (м/с²) */
  gravityMs2: number | null;
  /** Средняя молярная масса смеси, кг/моль */
  meanMolarMassKgMol: number | null;
  /** Модельное время, лет */
  modelTimeYears: number;
  /** Длительность шага, лет (игровое допущение, задаётся явно) */
  stepDurationYears: number;
  history: ChemicalStepRecord[];
  /**
   * Изменение количества O₂ за последний ЗАВЕРШЁННЫЙ глобальный шаг
   * (записывается только runChemicalEvolutionStep; отдельные реакции
   * поле не обновляют), в единицах режима инвентаря:
   * column_inventory — моль O₂/м² за шаг, game_normalized —
   * нормированные игровые единицы за шаг. Это итог дискретного
   * стехиометрического игрового шага, а НЕ кинетическая скорость
   * d(O₂)/dt: модель не содержит кинетических данных.
   */
  oxygenBalance: {
    production: number;
    consumption: number;
    net: number;
    note: string;
  };
  notes: string[];
}

/** Процесс-источник или сток в реестре потоков вещества. */
export interface ChemicalProcess {
  id: string;
  name: string;
  substance: string[];
  direction: 'source' | 'sink' | 'exchange';
  /** Количество за шаг (моль/м²); null — не определено */
  ratePerStep: number | null;
  enabled: boolean;
  timescaleNote: string;
  confidence: ScientificConfidence;
  source: string;
  note: string;
}

// ============================================
// 9. ГЕОЛОГИЯ И ВНУТРЕННЕЕ ТЕПЛО
// ============================================

export interface HeatSourceAnalysis {
  sourceId: 'primordial' | 'radiogenic' | 'tidal' | 'other';
  /** Уровень тепловыделения; null — не оценён (данных недостаточно) */
  level: 'high' | 'moderate' | 'low' | 'negligible' | null;
  /** potential — источник может существовать; not_estimated — не оценён */
  status: 'potential' | 'not_estimated';
  basis: string;
  confidence: ScientificConfidence;
  note: string;
}

export interface GeologicalAnalysis {
  primordialHeat: HeatSourceAnalysis;
  radiogenicHeat: HeatSourceAnalysis;
  tidalHeat: HeatSourceAnalysis;
  totalInternalHeat: 'high' | 'moderate' | 'low' | 'none';
  /** Доступна ли геотермальная энергия (НЕ добавляется автоматически) */
  geothermalEnergyAvailable: boolean;
  volcanism: boolean | null;
  hydrothermalSystems: boolean | null;
  subsurfaceLiquidReservoirs: boolean | null;
  geochemicalGradients: string[];
  notes: string[];
}
