// ============================================
// TYPES - Основные типы проекта "Эволюционные Войны"
// ============================================

import type {
  CentralObjectSystem,
  OrbitalConfigurationData,
  BodyPhysicalSample,
  AtmospherePhysicalModel,
  AtmospherePhaseAnalysis,
  GeologicalAnalysis,
  EnergyBudgetModel,
  ChemicalEvolutionState
} from './physics';

// ============================================
// 1. БАЗОВЫЕ ТИПЫ
// ============================================

export type Seed = string;
export type Version = string;
export type ID = string;

// Режимы генерации
export type GenerationMode = 'realistic' | 'anomalous';

// Научный статус
export type ScientificStatus = 
  | 'established_fact'
  | 'physically_plausible'
  | 'hypothetical'
  | 'impossible_in_model'
  | 'game_assumption'
  | 'anomalous_rule';

// Уровень серьезности правил совместимости
export type SeverityLevel = 'error' | 'warning' | 'info';

// Результат проверки совместимости
export type CompatibilityResult = 'compatible' | 'conditionally_compatible' | 'incompatible';

// ============================================
// 2. КОСМОЛОГИЧЕСКИЕ КОНЦЕПЦИИ
// ============================================

export interface CosmologyOption {
  id: ID;
  name: string;
  description: string;
  baseWeight: number;
  tags: string[];
  isAnomalous: boolean;
  compatibilityInfo: string;
  scientificStatus: ScientificStatus;
  specialRules: string[];
  generationImpact: string;
}

// ============================================
// 3. ВОЗРАСТНЫЕ ЭПОХИ
// ============================================

export interface EpochOption {
  id: ID;
  name: string;
  ageRange: { min: number; max: number }; // в миллиардах лет
  description: string;
  baseWeight: number;
  tags: string[];
  scientificStatus: ScientificStatus;
  compatibilityNotes: string;
}

// ============================================
// 4. ЦЕНТРАЛЬНЫЕ ОБЪЕКТЫ
// ============================================

export type CentralObjectClass = 
  | 'star'
  | 'compact_object'
  | 'stellar_remnant'
  | 'substellar_object'
  | 'exotic_object'
  | 'jet';

export type CentralObjectRole = 
  | 'primary_star'
  | 'gravitational_anchor'
  | 'energy_source'
  | 'radiation_source';

export interface CentralObjectOption {
  id: ID;
  name: string;
  objectClass: CentralObjectClass;
  role: CentralObjectRole;
  potentialEnergySources: string[];
  characteristicConstraints: string[];
  potentialThreats: string[];
  compatibleOrbits: string[];
  scientificStatus: ScientificStatus;
  baseWeight: number;
  tags: string[];
  minAge: number | null; // минимальный возраст вселенной в млрд лет
  maxAge: number | null; // максимальный возраст вселенной в млрд лет (легаси-семантика)
  /**
   * Окно существования объекта в истории Вселенной (млрд лет от Большого взрыва).
   * earliestUniverseAgeGyr — минимальный возраст Вселенной, при котором объекты
   * этого класса уже могут существовать.
   *
   * ВАЖНО: время жизни ОТДЕЛЬНОГО объекта здесь не хранится. Короткоживущая
   * звезда (например, голубой гигант) может сформироваться недавно даже в
   * древней Вселенной — большой возраст Вселенной её не запрещает.
   * Запрещён лишь объект, который не мог сформироваться к выбранной эпохе.
   */
  existenceWindow?: { earliestUniverseAgeGyr: number; note?: string };
}

// ============================================
// 5. ТИПЫ НЕБЕСНЫХ ТЕЛ
// ============================================

export type CelestialBodyType = 
  | 'planet'
  | 'moon'
  | 'dwarf_planet'
  | 'exotic_body';

export type SizeClass = 
  | 'tiny'
  | 'small'
  | 'earth_like'
  | 'super_earth'
  | 'mega_earth'
  | 'unknown';

export interface CelestialBodyOption {
  id: ID;
  name: string;
  bodyType: CelestialBodyType;
  sizeClass: SizeClass;
  gravityDescription: string;
  geologicalProperties: string[];
  typicalConstraints: string[];
  compatibleCentralObjects: ID[];
  scientificStatus: ScientificStatus;
  baseWeight: number;
  tags: string[];
  // Дополнительные физические параметры
  massRange?: { min: number; max: number }; // в массах Земли
  radiusRange?: { min: number; max: number }; // в радиусах Земли
}

// ============================================
// 6. КОЛЫБЕЛЬ ЖИЗНИ
// ============================================

export type MatterState = 
  | 'solid'
  | 'liquid'
  | 'gas'
  | 'supercritical_fluid'
  | 'plasma'
  | 'aerosol';

export type EnergySourceClass = 
  | 'stellar_radiation'
  | 'geothermal'
  | 'chemical'
  | 'tidal'
  | 'radioactive'
  | 'exotic';

export interface CradleOption {
  id: ID;
  name: string;
  matterState: MatterState;
  requiredTemperatureRange: { min: number; max: number }; // в Кельвинах
  requiredPressureRange: { min: number; max: number }; // в атмосферах
  chemicalFeatures: string[];
  availableEnergySources: EnergySourceClass[];
  chemicalConstraints: string[];
  solventTypes: string[];
  compatibilityRequirements: string[];
  scientificStatus: ScientificStatus;
  baseWeight: number;
  tags: string[];
}

// ============================================
// 6.1 ЛОКАЛЬНАЯ СРЕДА КОЛЫБЕЛИ ЖИЗНИ
// ============================================
//
// Отдельная структура локальных условий колыбели жизни.
// Она НЕ подменяет глобальную атмосферу планеты и температуру
// её поверхности: сверхкритическая водная среда может существовать
// в глубинном гидротермальном резервуаре, даже если на поверхности
// условия совершенно другие; жизнь в водородно-гелиевой оболочке
// живёт в слоях атмосферы, а не на твёрдой поверхности.
//
// Неизвестные значения остаются null / пустыми массивами —
// они НЕ подменяются произвольными числами.

// Тип расположения локальной среды колыбели жизни
export type CradleLocationType =
  | 'surface'                 // поверхность небесного тела
  | 'subsurface_reservoir'    // подземный резервуар (гидротермальный и т.п.)
  | 'ocean'                   // океан / глобальные жидкие резервуары
  | 'atmosphere'              // слои атмосферы
  | 'deep_planetary_layers'   // глубокие слои планетной оболочки
  | 'other';                  // иное расположение

// Описание компонента локальной среды (не процентная доля атмосферы,
// а качественный состав среды возникновения жизни)
export interface LocalEnvironmentComponent {
  componentId: ID;
  description: string;
}

export interface CradleLocalEnvironment {
  temperature: number | null; // в Кельвинах; null, если точное значение неизвестно
  temperatureRange: { min: number; max: number } | null; // известный диапазон требований, K
  pressure: number | null; // в атмосферах; null, если точное значение неизвестно
  pressureRange: { min: number; max: number } | null; // известный диапазон требований, atm
  composition: LocalEnvironmentComponent[]; // состав локальной среды
  matterState: MatterState; // агрегатное состояние среды
  energySources: EnergySourceClass[]; // доступные источники энергии
  chemicalConstraints: string[]; // химические ограничения среды
  locationType: CradleLocationType; // тип расположения среды
  locationDescription: string; // человекочитаемое описание расположения
  notes: string; // примечания и допущения
}

// ============================================
// 7. ХИМИЧЕСКИЕ ВЕЩЕСТВА
// ============================================

export type AggregateState = 'solid' | 'liquid' | 'gas' | 'supercritical' | 'plasma';

export interface GasSpecies {
  id: ID;
  formula: string;
  name: string;
  molarMass: number | null; // г/моль
  aggregateStates: AggregateState[];
  sources: string[];
  sinks: string[];
  participatingReactions: ID[];
  scientificComments: string;
  baseWeight: number;
  tags: string[];
}

// ============================================
// 8. АТМОСФЕРА
// ============================================

export interface AtmosphereComponent {
  gasId: ID;
  percentage: number; // процент
  isTrace: boolean;
  minRange?: number;
  maxRange?: number;
  uncertainty: string;
  warnings: string[];
}

export interface AtmosphereState {
  components: AtmosphereComponent[];
  totalPressure: number | null; // в атмосферах (легаси-поле, мигрировавшее из этапа 1)
  temperature: number | null; // в Кельвинах
  notes: string;
  /** Происхождение пресета: исторический игровой сценарий, наблюдательный справочник или гипотеза */
  presetKind?: 'historical_game' | 'observational_reference' | 'hypothetical';
  /** Явные пояснения о достоверности параметров пресета (давление, температура и т.п.) */
  presetNotes?: string;
}

// ============================================
// 9. ХИМИЧЕСКИЕ РЕАКЦИИ
// ============================================

export interface ReactionReactant {
  gasId: ID;
  coefficient: number;
}

export interface ReactionProduct {
  gasId: ID;
  coefficient: number;
}

export interface ChemicalReaction {
  id: ID;
  name: string;
  reactants: ReactionReactant[];
  products: ReactionProduct[];
  conditions: string[];
  uncertaintySources: string[];
  gameSpeedCoefficient: number;
  allowedRanges: { temperature?: { min: number; max: number }; pressure?: { min: number; max: number } };
  comments: string;
  isPhotochemical: boolean;
  isBiological: boolean;
}

// ============================================
// 10. ПРАВИЛА СОВМЕСТИМОСТИ
// ============================================

export type RuleCategory = 
  | 'cosmology_physics'
  | 'age_central_object'
  | 'central_object_environment'
  | 'body_orbit'
  | 'cradle_temperature'
  | 'cradle_pressure'
  | 'chemical_composition'
  | 'atmosphere'
  | 'phase_equilibrium'
  | 'energy_sources'
  | 'matter_state'
  | 'geological_requirements';

export interface CompatibilityRule {
  id: ID;
  category: RuleCategory;
  condition: (world: Partial<GeneratedWorld>) => boolean;
  result: CompatibilityResult;
  severity: SeverityLevel;
  explanation: string;
  resolutionSuggestions: string[];
  dependsOn: ID[];
  isActive: boolean;
  /**
   * Явное исключение для аномального режима.
   * Аномальный режим НЕ отключает все проверки подряд: отключаются
   * только правила, у которых этот флаг установлен, и каждое такое
   * исключение привязано к конкретному аномальному правилу.
   */
  exemptInAnomalousMode?: boolean;
}

// ============================================
// 11. ПРЕДУПРЕЖДЕНИЯ ГЕНЕРАЦИИ
// ============================================

export interface GenerationWarning {
  id: ID;
  ruleId: ID;
  category: RuleCategory;
  severity: SeverityLevel;
  message: string;
  suggestions: string[];
  affectedFields: string[];
}

// ============================================
// 12. СГЕНЕРИРОВАННЫЙ МИР
// ============================================

export interface PhysicalCharacteristics {
  surfaceGravity?: number; // в g
  surfaceTemperature?: number; // в К
  atmosphericPressure?: number; // в atm
  mass?: number; // в массах Земли
  radius?: number; // в радиусах Земли
  orbitalConfiguration?: string;
  geologicalActivity?: string;
  liquidReservoirs?: string[];
  chemicalConstraints?: string[];
  cosmicThreats?: string[];
  planetaryThreats?: string[];
}

export interface EnergySources {
  primary: EnergySourceClass[];
  secondary: EnergySourceClass[];
  description: string;
}

export interface EvolutionImplications {
  possibleAdaptations: string[];
  constraints: string[];
  opportunities: string[];
  uncertainties: string[];
}

export interface CausalChain {
  cosmology: string;
  epoch: string;
  centralObject: string;
  celestialBody: string;
  cradle: string;
  chemicalConstraints: string[];
  energySources: string[];
  lifeChallenges: string[];
  unknowns: string[];
}

export interface GeneratedWorld {
  id: ID;
  createdAt: string;
  seed: Seed;
  generatorVersion: Version;
  mode: GenerationMode;
  // Выбранные исходные категории
  cosmology: CosmologyOption;
  epoch: EpochOption;
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  cradle: CradleOption;
  // Локальная среда колыбели жизни — отдельно от глобальной атмосферы
  // планеты и температуры её поверхности
  cradleLocalEnvironment: CradleLocalEnvironment;
  // Расширенные характеристики
  physicalCharacteristics: PhysicalCharacteristics;
  energySources: EnergySources;
  atmosphere: AtmosphereState;
  // ===== Физическая модель (этап 3; опционально — старые миры
  // отображают эти параметры как неизвестные, а не пересоздаются) =====
  /** Структурная модель центрального объекта / системы (звезда, остаток, джет и т.п.) */
  centralObjectSystem?: CentralObjectSystem;
  /** Орбитальная конфигурация (сэмплирована детерминированно через PRNG) */
  orbit?: OrbitalConfigurationData;
  /** Сэмплированные масса/радиус/плотность/гравитация планеты (SI) */
  bodyPhysics?: BodyPhysicalSample;
  /** Физическая модель атмосферы: молярные доли, парциальные давления (Па), столб */
  atmospherePhysics?: AtmospherePhysicalModel;
  /** Фазовый скрининг атмосферных компонентов */
  phaseAnalysis?: AtmospherePhaseAnalysis;
  /** Анализ внутренних источников тепла (Geology) */
  geologyAnalysis?: GeologicalAnalysis;
  /** Энергетический бюджет: поток, равновесная температура, допущения */
  energyBudget?: EnergyBudgetModel;
  /** Начальное состояние химической эволюции (инвентарь + резервуары) */
  chemicalState?: ChemicalEvolutionState;
  // Правила и предупреждения
  appliedRules: ID[];
  warnings: GenerationWarning[];
  scientificStatus: ScientificStatus;
  // Объяснения
  causalChain: CausalChain;
  evolutionImplications: EvolutionImplications;
  // Пользовательские изменения
  userModifications: Record<string, unknown>;
}

// ============================================
// 13. НАСТРОЙКИ ГЕНЕРАЦИИ
// ============================================

export interface CategoryWeights {
  cosmology: Record<ID, number>;
  epoch: Record<ID, number>;
  centralObject: Record<ID, number>;
  celestialBody: Record<ID, number>;
  cradle: Record<ID, number>;
}

export interface FixedCategories {
  cosmology?: ID;
  epoch?: ID;
  centralObject?: ID;
  celestialBody?: ID;
  cradle?: ID;
}

export interface GenerationSettings {
  seed: Seed;
  mode: GenerationMode;
  weights: CategoryWeights;
  fixedCategories: FixedCategories;
  atmospherePreset?: ID;
  customAtmosphere?: AtmosphereState;
  enableChemicalEvolution: boolean;
  chemicalEvolutionSteps: number;
}

// ============================================
// 14. СОХРАНЕННЫЙ МИР
// ============================================

export interface SavedWorld extends GeneratedWorld {
  savedAt: string;
  version: Version;
  settings: GenerationSettings;
  /** Отметка о миграции из старого формата сохранения */
  migration?: { from: string; notes: string[] };
}

// ============================================
// 15. ХРАНИЛИЩЕ
// ============================================

export interface StorageState {
  worlds: SavedWorld[];
  lastSeed: Seed;
  settings: GenerationSettings;
}

// ============================================
// 16. СОБЫТИЯ
// ============================================

export interface ChemicalEvolutionStep {
  stepNumber: number;
  timestamp: string;
  reactionsTriggered: ID[];
  concentrationChanges: Record<ID, { old: number; new: number; delta: number }>;
  explanations: string[];
}

export interface GenerationHistory {
  worldId: ID;
  steps: ChemicalEvolutionStep[];
}

// ============================================
// 17. УТИЛИТЫ
// ============================================

export interface SelectOption<T> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

// ============================================
// 18. КОНСТАНТЫ
// ============================================

export const GENERATOR_VERSION = '0.3.0';
export const STORAGE_KEY = 'evowars_worlds';
export const SETTINGS_KEY = 'evowars_settings';

// ============================================
// 19. ТИПЫ ФИЗИЧЕСКОЙ МОДЕЛИ (ЭТАП 3)
// ============================================

export * from './physics';
