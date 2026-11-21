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
  CradleLocationType,
  CentralObjectOption,
  AtmosphereState,
  PhysicalCharacteristics
} from '../../types';
import { getEarliestUniverseAgeGyr, getTypicalLifetimeGyr } from '../Data/starPhysical';
import { atmospherePresetTemperatureToScientificValue } from '../Core/adapters';
import { temperatureValueOrNull, resolveLocalReactionTemperature } from '../Core/thermalState';
import type { ScientificValue } from '../Core/scientificValue';

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

/**
 * Stage 4.2.2.4: соответствие типа расположения локальной среды
 * (CradleLocationType) ДОПУСТИМЫМ видам резервуаров ядра
 * (ReservoirRecord.kind), температура которых может ДОКАЗЫВАТЬ
 * температуру именно этой локальной области.
 *
 * Таксономия видов НЕ изобретается: ReservoirRecord.kind содержит
 * ДОКУМЕНТИРОВАННЫЕ семантические категории контракта
 * («atmosphere | ocean | ice | crust | mantle | core | ...» —
 * расширяемая строка); таблица соответствий намеренно
 * КОНСЕРВАТИВНА и зависит от типа локальной среды. Stage 4.2.2.5:
 * subsurface_reservoir принимает только вид 'crust'; вид 'ocean'
 * подземное расположение НЕ доказывает. Тесты и фикстуры (включая
 * используемые ими виды 'ocean', 'crust', 'mantle') сами по себе
 * научную таксономию НЕ устанавливают; новые виды резервуаров не
 * вводятся, соответствия не расширяются.
 *
 * - 'ocean': океанская локальная среда доказывается только
 *   резервуарами вида 'ocean';
 * - 'subsurface_reservoir': глубинная среда — ТОЛЬКО резервуарами
 *   вида 'crust' (задокументированный вид коровых резервуаров:
 *   глубинные гидротермальные системы живут в коре). Вид 'ocean'
 *   глубинную среду НЕ доказывает (Stage 4.2.2.5): схема
 *   ReservoirRecord не различает поверхностный и подземный
 *   океан, и допущение 'ocean' позволяло бы поверхностному
 *   океану «доказывать» глубинную среду; достаточных данных для
 *   такого соответствия нет — недоказанность (fail-closed).
 *   Тестовая фикстура физическим обоснованием таксономии НЕ
 *   является; новые виды резервуаров не вводятся;
 * - 'deep_planetary_layers': глубинные планетные слои —
 *   резервуарами видов 'mantle' и 'core' (задокументированные
 *   виды глубинных слоёв);
 * - 'surface': null — поверхность доказывается thermalState.
 *   surfaceTemperature тела, а не резервуаром;
 * - 'atmosphere': null — атмосферная среда читается отдельной
 *   веткой пресета и резервуарным доказательством не является;
 * - 'other': null — физическая природа области из одного ID
 *   не выводится: без документируемого соответствия доказательство
 *   недоступно (fail-closed).
 *
 * Несоответствие вида резервуара локальной области — НЕ физическая
 * ошибка, а НЕДОКАЗАННОСТЬ (fail-closed): температура резервуара
 * не используется ни как доказательство совместимости, ни как её
 * опровержение; другой резервуар автоматически не выбирается.
 */
export const LOCATION_TYPE_RESERVOIR_KINDS: Readonly<
  Record<CradleLocationType, readonly string[] | null>
> = {
  ocean: ['ocean'],
  subsurface_reservoir: ['crust'],
  deep_planetary_layers: ['mantle', 'core'],
  surface: null,
  atmosphere: null,
  other: null
};

/**
 * Stage 4.2.2.2: типизированная температура поверхности мира — ТОЛЬКО
 * из научного ядра (coreWorldState → тело 'planet' → thermalState.
 * surfaceTemperature) со статусом и provenance. Легаси-скаляр
 * physicalCharacteristics.surfaceTemperature (число без статуса,
 * метода и происхождения) измерением НЕ является: на old saves оно
 * могло быть скопировано из пресетной температуры атмосферы, и
 * принимать его за доказанную температуру поверхности запрещено.
 */
function typedSurfaceTemperatureOfWorld(world: Partial<GeneratedWorld>): ScientificValue | null {
  const surface = world.coreWorldState?.bodies
    .find((b) => b.id === 'planet')
    ?.thermalState?.surfaceTemperature;
  return surface ?? null;
}

/**
 * Stage 4.2.2.3: STRICT EVIDENCE GATE для типизированной температуры,
 * используемой как ДОКАЗАТЕЛЬСТВО физической совместимости колыбели.
 *
 * Статус 'known' сам по себе доказательством не является:
 * knownValue(quantity) допускает создание значения без provenance,
 * а temperatureValueOrNull проверяет пригодность ЧИСЛА, но не
 * доказательную обеспеченность. Гейт применяется ТОЛЬКО здесь —
 * при использовании значения как доказательства температурной
 * совместимости; глобальная семантика knownValue/ScientificValue
 * НЕ меняется (known без происхождения остаётся корректным данным
 * ядра — но не доказательством совместимости).
 *
 * СОДЕРЖАТЕЛЬНЫМ provenance для доказанной температуры считается
 * provenance, содержащее хотя бы одно непустое поле ИДЕНТИФИКАЦИИ
 * происхождения из существующих полей DataProvenance:
 * - sourceName    — название источника (измерение, наблюдение, каталог);
 * - sourceId      — идентификатор источника;
 * - datasetId     — идентификация набора данных (вместе с recordId);
 * - recordId      — идентификатор записи внутри набора;
 * - reference     — ссылка на первичный источник;
 * - method        — метод получения значения (измерение/расчёт/
 *                   интерполяция): проверяемый расчёт НЕ требует
 *                   библиографии, но требует заявленного метода;
 * - modelVersion  — версия модели, если значение рассчитано моделью;
 * - rawInput      — исходные параметры расчёта (непустой объект).
 *
 * НЕДОСТАТОЧНЫ сами по себе (метаданные использования, а не
 * происхождения): note, applicability, limitations, conditions,
 * license, retrievedAt, datasetVersion без datasetId, а также
 * пустой объект provenance {} или его отсутствие — произвольный
 * пустой объект и «голый» статус known доказательством не являются.
 *
 * estimated до known НЕ повышается ни при каких условиях.
 */
function nonEmptyProvenanceString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function hasSubstantiveTemperatureProvenance(v: ScientificValue): boolean {
  if (v.status === 'not_applicable' || v.status === 'not_implemented') {
    return false; // эти статусы provenance не несут
  }
  const p = (v as { provenance?: unknown }).provenance;
  if (typeof p !== 'object' || p === null) return false;
  const rec = p as Record<string, unknown>;
  if (
    nonEmptyProvenanceString(rec.sourceName) ||
    nonEmptyProvenanceString(rec.sourceId) ||
    nonEmptyProvenanceString(rec.datasetId) ||
    nonEmptyProvenanceString(rec.recordId) ||
    nonEmptyProvenanceString(rec.reference) ||
    nonEmptyProvenanceString(rec.method) ||
    nonEmptyProvenanceString(rec.modelVersion)
  ) {
    return true;
  }
  if (typeof rec.rawInput === 'object' && rec.rawInput !== null && Object.keys(rec.rawInput).length > 0) {
    return true;
  }
  return false;
}

/**
 * Пригодно ли значение как ДОКАЗАННАЯ температура локальной среды:
 * статус known + содержательный provenance + пригодное число
 * (temperatureValueOrNull: единица 'K', размерность, конечность,
 * неотрицательность, корректная форма — 4.2.2.1).
 * known без provenance, с пустым provenance, с непригодным числом
 * (invalid/NaN/отрицательное/не в K) — НЕ доказательство и НЕ
 * физическая ошибка: это недоказанность (cradle_temperature_unproven).
 */
function isProvenTemperatureEvidence(v: ScientificValue | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (v.status !== 'known') return false;
  if (!hasSubstantiveTemperatureProvenance(v)) return false;
  return temperatureValueOrNull(v) !== null;
}

/**
 * Stage 4.2.2.3: типизированная температура ИМЕННО указанной локальной
 * области колыбели. Поверхность и океан — РАЗНЫЕ области с раздельными
 * источниками температуры; подменять одну другой без явного
 * обоснования эквивалентности запрещено:
 *
 * - locationType 'surface': только thermalState.surfaceTemperature
 *   тела 'planet' научного ядра;
 * - locationType 'ocean' / 'subsurface_reservoir' /
 *   'deep_planetary_layers' / 'other': только температура КОНКРЕТНОГО
 *   резервуара по ЯВНОЙ ссылке env.localReservoirId, читаемая
 *   существующим resolver ядра (resolveLocalReactionTemperature:
 *     поиск по (bodyId 'planet', reservoirId), orphan-резервуары,
 *     чужие резервуары и резервуары других тел не читаются,
 *     неизвестная/непригодная температура не подменяется).
 *   Без явной ссылки на резервуар доказанной температуры нет:
 *   произвольный резервуар по совпадению kind НЕ выбирается,
 *   температура поверхности/T_eq/атмосферы/соседнего резервуара
 *   как fallback НЕ используется;
 * - Stage 4.2.2.4 (reservoir kind validation): вид (kind) резервуара
 *   должен СООТВЕТСТВОВАТЬ локальной среде (см.
 *   LOCATION_TYPE_RESERVOIR_KINDS): резервуар атмосферы температурой
 *   океана не является. Несовпадение вида — недоказанность
 *   (fail-closed), не физическая ошибка; другой резервуар
 *   автоматически не выбирается;
 * - Stage 4.2.2.5 / 4.2.2.5.1 (runtime safety): неизвестное
 *   runtime-значение locationType (вне CradleLocationType, из
 *   внешних данных, включая имена унаследованных свойств
 *   прототипа объекта) обрабатывается тем же fail-closed
 *   правилом: без исключений, без доказательства, без выбора
 *   другого резервуара — недоказанность;
 * - locationType 'atmosphere': обрабатывается отдельной веткой
 *   пресета (адаптер никогда не возвращает known) — здесь null.
 *
 * Возвращает ScientificValue | null; пригодность как доказательства
 * решает isProvenTemperatureEvidence, оценочный сценарий — правило 6b.
 */
function typedLocalTemperatureOfWorld(
  world: Partial<GeneratedWorld>,
  env: CradleLocalEnvironment
): ScientificValue | null {
  if (env.locationType === 'atmosphere') return null;
  if (env.locationType === 'surface') {
    return typedSurfaceTemperatureOfWorld(world);
  }
  // Океан, подземный резервуар, глубокие слои, иное расположение:
  // требуется явная ссылка на конкретный резервуар ядра.
  const reservoirId = env.localReservoirId;
  if (typeof reservoirId !== 'string' || reservoirId.trim() === '') {
    return null; // однозначная область не указана — доказательства нет
  }
  const core = world.coreWorldState;
  if (!core) return null;
  // Stage 4.2.2.4 (reservoir kind validation): температура резервуара
  // доказывает локальную среду ТОЛЬКО при принадлежности резервуара
  // телу 'planet' И согласованности его вида с locationType. Проверка
  // выполняется ДО признания known-значения доказательством.
  const reservoir = core.reservoirs.find(
    (r) => r.id === reservoirId && r.bodyId === 'planet'
  );
  if (!reservoir) {
    // Пары (тело 'planet', reservoirId) нет: чужие/несуществующие
    // резервуары не читаются — это недоказанность, не ошибка.
    return null;
  }
  // Stage 4.2.2.5 / 4.2.2.5.1 (runtime + prototype safety):
  // locationType приходит из внешних данных (среда колыбели
  // сохранений/фикстур) и во время исполнения может выйти за
  // CradleLocationType. LOCATION_TYPE_RESERVOIR_KINDS — обычный
  // объект, наследующий свойства Object.prototype: при обычном
  // lookup некорректные runtime-значения ('constructor',
  // 'toString', 'hasOwnProperty', '__proto__') вернули бы
  // УНАСЛЕДОВАННЫЕ свойства вместо undefined, а последующий
  // .includes() выбросил бы TypeError. Поэтому до чтения значения
  // проверяется, что locationType — СОБСТВЕННЫЙ ключ таблицы
  // (Object.prototype.hasOwnProperty.call): унаследованные
  // свойства прототипа списками допустимых видов НЕ являются.
  // Неизвестное или некорректное расположение, как и недопустимый
  // вид, доказательством не является — fail-closed (недоказанность,
  // НЕ ошибка), другой резервуар автоматически не выбирается.
  if (!Object.prototype.hasOwnProperty.call(LOCATION_TYPE_RESERVOIR_KINDS, env.locationType)) {
    // Не собственный ключ таблицы (в т.ч. имя унаследованного
    // свойства прототипа): доказательства нет (fail-closed).
    return null;
  }
  const admissibleKinds = LOCATION_TYPE_RESERVOIR_KINDS[env.locationType];
  if (admissibleKinds === null || !admissibleKinds.includes(reservoir.kind)) {
    // Вид резервуара не соответствует локальной области (например,
    // резервуар атмосферы как «доказательство» океана): температура
    // не используется ни как доказательство, ни как опровержение.
    // Fail-closed: cradle_temperature_unproven, НЕ incompatible/error;
    // другой резервуар автоматически НЕ выбирается.
    return null;
  }
  try {
    const resolution = resolveLocalReactionTemperature(core, { bodyId: 'planet', reservoirId });
    return resolution.temperature;
  } catch {
    // invalid_place и структурные ошибки resolver'а — область не задана
    // корректно; это не доказательство и не физическая ошибка.
    return null;
  }
}

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

  // Правило 6: Температура локальной среды колыбели жизни.
  // Stage 4.2.2.2: ОШИБКОЙ (incompatible/error) остаётся ТОЛЬКО
  // ДОКАЗАННОЕ нарушение — известное (known) значение локальной среды
  // вне требуемого диапазона. Оценка (estimated) и легаси-число без
  // происхождения исследуют сценарий, но измерением не являются:
  // их расхождение с диапазоном фиксируется ОТДЕЛЬНЫМ предупреждением
  // (cradle_temperature_estimate_outside_range), а не физической
  // ошибкой. Отсутствие данных — недоказанность (правило 6a).
  //
  // Stage 4.2.2.3 (provenance gate и location-specific evidence):
  // - известное (known) значение без СОДЕРЖАТЕЛЬНОГО provenance
  //   доказательством не является — см. isProvenTemperatureEvidence:
  //   статус known сам по себе не делает значение измерением;
  // - температура доказательства принадлежит ИМЕННО указанной
  //   локальной области: поверхность — surfaceTemperature ядра,
  //   океан/глубинные среды — температура конкретного резервуара
  //   по явной ссылке localReservoirId; температура поверхности
  //   температурой океана НЕ является (и наоборот).
  {
    id: 'cradle_temperature_compatibility',
    category: 'cradle_temperature',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle) return true;
      const env = world.cradleLocalEnvironment as CradleLocalEnvironment | undefined;
      if (!env) return true; // локальная среда не определена — проверка не применима

      const range = world.cradle.requiredTemperatureRange;

      // Среда в слоях атмосферы: Stage 4.2.2.2 — температура читается
      // как ТИПИЗИРОВАННОЕ значение с provenance (пресет — оценка/
      // допущение, НЕ измерение этого мира). Адаптер пресета никогда
      // не возвращает known: справочный ориентир (observational_reference)
      // остаётся оценкой. Ошибка — только известное (known) значение
      // СО содержательным provenance вне диапазона (evidence gate
      // Stage 4.2.2.3); оценочное расхождение — предупреждение
      // (cradle_temperature_estimate_outside_range).
      if (env.locationType === 'atmosphere') {
        const typed = atmospherePresetTemperatureToScientificValue(world.atmosphere ?? null);
        if (!isProvenTemperatureEvidence(typed)) return true; // оценка/неизвестность/known без происхождения — не доказанное противоречие
        return isInRange(temperatureValueOrNull(typed) as number, range);
      }

      // Поверхность, океан, подземный резервуар, глубокие слои:
      // доказанным значением служит ТОЛЬКО типизированная
      // known-температура ИМЕННО указанной локальной области
      // (поверхность — surfaceTemperature ядра; океан и прочие
      // области — температура конкретного резервуара по явной
      // ссылке localReservoirId) СО содержательным provenance
      // (Stage 4.2.2.2 + evidence gate Stage 4.2.2.3). known без
      // происхождения и температура соседней области (в т.ч.
      // поверхность для океана) доказательством не являются;
      // легаси-скаляр без происхождения оценочен: вне диапазона
      // он даёт предупреждение, не ошибку.
      const typed = typedLocalTemperatureOfWorld(world, env);
      if (!isProvenTemperatureEvidence(typed)) return true; // не доказано — отдельная диагностика
      return isInRange(temperatureValueOrNull(typed) as number, range);
    },
    result: 'incompatible',
    severity: 'error',
    explanation: 'Известная (доказанная) температура локальной среды колыбели выходит за пределы требуемого диапазона колыбели.',
    resolutionSuggestions: [
      'Выберите другую колыбель жизни',
      'Измените атмосферу (пресет с подходящей температурой)',
      'Выберите другое небесное тело'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 6a (Stage 4.2.2.1 / 4.2.2.2): локальная температура
  // колыбели НЕ ДОКАЗАНА. Главный принцип ревизии: отсутствие
  // локальной температуры — это отсутствие доказательства
  // совместимости, а не доказательство совместимости; оценка не
  // становится измерением только потому, что она числовая.
  //
  // Предупреждение (НЕ ошибка): неизвестность автоматически не
  // превращается в incompatible с severity error — выбор колыбели не
  // блокируется, но молчаливой «успешной проверки» больше нет.
  //
  // Stage 4.2.2.2: доказательством для поверхности/океана служит
  // ТОЛЬКО типизированная known-температура со статусом и
  // provenance; легаси-скаляр surfaceTemperature без происхождения
  // измерением НЕ является (old saves могли скопировать в него
  // пресетную температуру атмосферы).
  {
    id: 'cradle_temperature_unproven',
    category: 'cradle_temperature',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle) return true;
      const env = world.cradleLocalEnvironment as CradleLocalEnvironment | undefined;
      if (!env) return true; // локальная среда не определена — правило не применимо

      // Атмосфера: доказательство — известное (known) типизированное
      // значение СО содержательным provenance (адаптер пресета known
      // не выдаёт: справочный ориентир остаётся оценкой). Оценка
      // (пресет, включая observational_reference и game_assumption)
      // не является измерением ЭТОГО мира: оценочное расхождение с
      // диапазоном — предупреждение правила 6b, а здесь фиксируется,
      // что это оценка, а не измерение. unknown/not_applicable/invalid
      // — температура не доказана вовсе.
      if (env.locationType === 'atmosphere') {
        const typed = atmospherePresetTemperatureToScientificValue(world.atmosphere ?? null);
        return isProvenTemperatureEvidence(typed);
      }

      // Поверхность, океан, подземный резервуар, глубокие слои и
      // прочие среды: доказательство — ТОЛЬКО известное (known)
      // типизированное значение ИМЕННО указанной локальной области
      // СО содержательным provenance. Stage 4.2.2.3: известное число
      // без происхождения и температура соседней области (в т.ч.
      // поверхность для океана) измерением не считаются; легаси-число
      // без заявленного происхождения остаётся оценочным/неизвестным.
      const typed = typedLocalTemperatureOfWorld(world, env);
      return isProvenTemperatureEvidence(typed);
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation:
      'Совместимость колыбели по температуре НЕ ДОКАЗАНА: локальная температура неизвестна, не моделируется, является оценкой (пресетом) или числом без заявленного происхождения — это не доказательство совместимости; оценка не становится измерением, известное значение (known) без содержательного происхождения (provenance) или без принадлежности указанной локальной области доказательством также не является.',
    resolutionSuggestions: [
      'Учтите условный статус: проверка диапазона по оценке (пресету) не эквивалентна измерению',
      'Выберите колыбель с известной локальной температурой',
      'Задайте атмосферу с заявленной температурой (пресет)'
    ],
    dependsOn: [],
    isActive: true
  },

  // Правило 6b (Stage 4.2.2.2): ОЦЕНОЧНОЕ расхождение температуры
  // локальной среды с диапазоном колыбели. Оценка (estimated) и
  // легаси-число без происхождения могут помочь исследовать сценарий,
  // но НЕ доказывают физическое противоречие: вместо incompatible/error
  // создаётся ЯВНОЕ предупреждение. selectCradle не отбрасывает такую
  // колыбель как «доказанно несовместимую» (фильтрация идёт по
  // severity error): оценочный сценарий (например, венусоподобная
  // атмосфера 737 K при диапазоне 50–500 K) исключает колыбель из
  // автоматического выбора ТОЛЬКО при известном (known) значении.
  //
  // Stage 4.2.2.3 (приоритет типизированного значения): при наличии
  // пригодного typed known легаси-скаляр НЕ читается — доказанное
  // значение вне диапазона даёт одну ошибку правила 6 БЕЗ
  // дублирующего оценочного предупреждения; доказанное значение в
  // диапазоне не даёт ни ошибки, ни предупреждений; typed estimated
  // не подменяется легаси-числом. Легаси-скаляр — оценочный сценарий
  // ТОЛЬКО поверхности и ТОЛЬКО при отсутствии типизированного
  // значения; для океана/глубинных сред поверхностное число
  // температурой среды не является.
  {
    id: 'cradle_temperature_estimate_outside_range',
    category: 'cradle_temperature',
    condition: (world: Partial<GeneratedWorld>) => {
      if (!world.cradle) return true;
      const env = world.cradleLocalEnvironment as CradleLocalEnvironment | undefined;
      if (!env) return true; // локальная среда не определена — правило не применимо

      const range = world.cradle.requiredTemperatureRange;

      // Атмосфера: оценочная (estimated) пресетная температура вне
      // диапазона — предупреждение, не ошибка.
      if (env.locationType === 'atmosphere') {
        const typed = atmospherePresetTemperatureToScientificValue(world.atmosphere ?? null);
        if (typed.status !== 'estimated') return true; // known — правило 6; unknown — 6a
        const temperatureK = temperatureValueOrNull(typed);
        if (temperatureK === null) return true;
        return isInRange(temperatureK, range);
      }

      // Поверхность, океан и прочие локальные области: оценочный
      // сценарий строится по типизированному значению ИМЕННО указанной
      // области (поверхность — surfaceTemperature ядра; океан и
      // глубинные среды — температура резервуара по явной ссылке
      // localReservoirId). При наличии типизированного значения
      // легаси-скаляр НЕ читается (Stage 4.2.2.3).
      const typed = typedLocalTemperatureOfWorld(world, env);
      if (typed !== null) {
        if (typed.status === 'known') {
          // Известное значение: доказанное (содержательный provenance)
          // уже решено правилом 6 — дублирующего оценочного
          // предупреждения нет; известное значение БЕЗ содержательного
          // provenance — не оценка и не доказательство (недоказанность
          // фиксирует правило 6a), и легаси-скаляр при этом не читается.
          return true;
        }
        if (typed.status === 'estimated') {
          const temperatureK = temperatureValueOrNull(typed);
          if (temperatureK === null) return true; // нечисловая оценка — недоказанность (6a)
          return isInRange(temperatureK, range);
        }
        return true; // unknown и прочие статусы — недоказанность (6a)
      }

      // Типизированного значения нет: легаси-скаляр
      // physicalCharacteristics.surfaceTemperature может использоваться
      // ТОЛЬКО как оценочный сценарий и ТОЛЬКО для поверхностной
      // среды. Для океана и глубинных сред поверхностное число
      // температурой среды не является (запрет fallback); причиной
      // incompatible/error легаси-скаляр не бывает никогда.
      if (env.locationType === 'surface') {
        const pc = world.physicalCharacteristics as PhysicalCharacteristics | undefined;
        if (typeof pc?.surfaceTemperature === 'number' && Number.isFinite(pc.surfaceTemperature)) {
          // Число есть, но его происхождение неизвестно: оценка сценария.
          return isInRange(pc.surfaceTemperature, range);
        }
      }
      return true;
    },
    result: 'conditionally_compatible',
    severity: 'warning',
    explanation:
      'Оценочная температура локальной среды (пресет, оценка резервуара указанной области или число без заявленного происхождения) находится вне требуемого диапазона колыбели: это предупреждает об оценочном сценарии, но НЕ является доказанным физическим противоречием — оценка не становится измерением.',
    resolutionSuggestions: [
      'Учтите условный статус: оценочное расхождение не доказывает несовместимость',
      'Выберите колыбель с диапазоном, допускающим оценочную температуру сценария',
      'Задайте измеренную (known) локальную температуру, чтобы проверка стала доказанной'
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

