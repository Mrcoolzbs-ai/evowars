// ============================================
// STAR PHYSICAL - Физические параметры центральных объектов
// ============================================
//
// Структурированная модель центральных объектов (этап 3).
// Каждый объект каталога получает физическую модель с диапазонами,
// а не единственным значением: каталог описывает КЛАССЫ объектов.
//
// Ключевые разделения:
// - earliestUniverseAgeGyr — минимальный возраст Вселенной, при котором
//   объекты класса уже могут существовать;
// - typicalLifetimeGyr — время жизни ОТДЕЛЬНОЙ звезды класса.
//   Эти величины НЕ связаны: голубой гигант может сформироваться
//   в древней Вселенной, но просуществует миллионы лет.
//
// Значения — стандартные астрофизические диапазоны для классов
// (оценки по звёздной классификации), confidence: 'estimated',
// если не указано иное. Источники без библиографических выдумок:
// общие справочные диапазоны звёздной астрофизики.

import type {
  StarPhysicalModel,
  CompactRemnantModel,
  SubstellarModel,
  GasGiantSystemModel,
  JetSystemModel,
  CentralObjectSystem,
  PhysValue
} from '../../types';
import { M_SUN_KG, L_SUN_W, M_JUP_KG } from '../Units';

const STANDARD_SOURCE = 'стандартные астрофизические справочные диапазоны (оценка по звёздной классификации)';

// Масса и светимость хранятся диапазонами классов в единицах Солнца;
// физические величины в СИ вычисляются функциями доступа ниже.
const massRange = (min: number, max: number): PhysValue => ({
  value: null,
  unit: 'кг',
  range: { min: min * M_SUN_KG, max: max * M_SUN_KG },
  confidence: 'estimated',
  method: 'диапазон класса в массах Солнца, переведён в кг',
  parameters: { 'M/M☉ (min)': min, 'M/M☉ (max)': max },
  uncertainty: 'объект представляет класс, а не конкретное тело',
  source: STANDARD_SOURCE
});

const luminosityRange = (min: number, max: number): PhysValue => ({
  value: null,
  unit: 'Вт',
  range: { min: min * L_SUN_W, max: max * L_SUN_W },
  confidence: 'estimated',
  method: 'диапазон класса в светимостях Солнца, переведён в Вт',
  parameters: { 'L/L☉ (min)': min, 'L/L☉ (max)': max },
  uncertainty: 'светимость конкретной звезды неизвестна; для расчёта потока используется геометрическая середина диапазона',
  source: STANDARD_SOURCE
});

const temperatureRange = (min: number, max: number): PhysValue => ({
  value: null,
  unit: 'K',
  range: { min, max },
  confidence: 'estimated',
  method: 'диапазон эффективных температур класса',
  uncertainty: 'объект представляет класс',
  source: STANDARD_SOURCE
});

// ============================================
// ЗВЁЗДЫ ГЛАВНОЙ ПОСЛЕДОВАТЕЛЬНОСТИ
// ============================================

const yellowDwarf: StarPhysicalModel = {
  kind: 'star',
  spectralClass: 'G',
  massKg: massRange(0.8, 1.1),
  luminosityW: luminosityRange(0.6, 1.5),
  effectiveTemperatureK: temperatureRange(5300, 6000),
  earliestUniverseAgeGyr: 0.1,
  typicalLifetimeGyr: { min: 8, max: 15 },
  stageNote:
    'Звезда класса G проводит на главной последовательности ~10 млрд лет; ' +
    'оставшееся время конкретной звезды зависит от её возраста, который моделью не задаётся.',
  energyProcesses: ['термоядерный синтез водорода', 'фотосферное излучение'],
  threats: ['вспышки', 'постепенный рост светимости'],
  notes: [
    'Класс, а не конкретная звезда: Солнце — лишь один представитель.',
    'Время жизни звезды не равно возрасту Вселенной.'
  ]
};

const orangeDwarf: StarPhysicalModel = {
  kind: 'star',
  spectralClass: 'K',
  massKg: massRange(0.45, 0.8),
  luminosityW: luminosityRange(0.08, 0.6),
  effectiveTemperatureK: temperatureRange(3900, 5300),
  earliestUniverseAgeGyr: 0.1,
  typicalLifetimeGyr: { min: 15, max: 45 },
  stageNote:
    'Оранжевые карлики эволюционируют медленнее Солнца; характерное время на главной последовательности — десятки млрд лет.',
  energyProcesses: ['термоядерный синтез водорода', 'фотосферное излучение'],
  threats: ['вспышки', 'УФ-излучение'],
  notes: ['Класс объектов, а не конкретная звезда.']
};

const redDwarf: StarPhysicalModel = {
  kind: 'star',
  spectralClass: 'M',
  massKg: massRange(0.08, 0.45),
  luminosityW: luminosityRange(0.001, 0.06),
  effectiveTemperatureK: temperatureRange(2400, 3700),
  earliestUniverseAgeGyr: 0.1,
  typicalLifetimeGyr: { min: 1000, max: 10000 },
  stageNote:
    'Красные карлики живут тысячи млрд лет — дольше текущего возраста Вселенной; ни один красный карлик ещё не сошёл с главной последовательности.',
  energyProcesses: ['термоядерный синтез водорода', 'фотосферное излучение'],
  threats: ['интенсивные вспышки в молодости', 'возможный приливный захват близких планет'],
  notes: [
    'Класс объектов. Близкие орбиты могут быть приливно захвачены — модель отмечает это как возможность.'
  ]
};

const blueGiant: StarPhysicalModel = {
  kind: 'star',
  spectralClass: 'B/O',
  massKg: massRange(2.5, 10),
  luminosityW: luminosityRange(100, 10000),
  effectiveTemperatureK: temperatureRange(10000, 30000),
  earliestUniverseAgeGyr: 0.01,
  typicalLifetimeGyr: { min: 0.005, max: 0.5 },
  stageNote:
    'Голубые гиганты живут миллионы — сотни миллионов лет. Большой возраст Вселенной НЕ запрещает ' +
    'такую звезду: она могла сформироваться недавно. Ограничено лишь время, доступное для развития ' +
    'планетарной среды вокруг неё.',
  energyProcesses: ['термоядерный синтез водорода (CNO-цикл)', 'жёсткое УФ-излучение'],
  threats: ['жёсткое УФ-излучение', 'быстрая эволюция', 'возможность взрыва сверхновой'],
  notes: [
    'Класс объектов.',
    'Время жизни звезды и возраст Вселенной — независимые величины.'
  ]
};

// ============================================
// КОМПАКТНЫЕ ОСТАТКИ
// ============================================

const whiteDwarf: CompactRemnantModel = {
  kind: 'compact_remnant',
  remnantType: 'white_dwarf',
  massKg: massRange(0.5, 1.0),
  radiusM: {
    value: null,
    unit: 'м',
    range: { min: 5.5e6, max: 1.4e7 },
    confidence: 'estimated',
    method: 'типичные радиусы белых карликов (~0.008–0.02 R☉)',
    source: STANDARD_SOURCE
  },
  intrinsicLuminosityW: luminosityRange(1e-4, 1e-2),
  accretionDependent: false,
  accretionNote:
    'Собственное излучение — остаточное тепловое свечение при остывании; ядерных источников энергии нет. ' +
    'Аккреция может добавить излучение, но не гарантируется.',
  hawkingRadiationNote: null,
  earliestUniverseAgeGyr: 0.1,
  notes: [
    'Белый карлик — конечная стадия звезды малой/средней массы; планетная система могла пережить стадию красного гиганта с потерей внутренней части системы.'
  ]
};

const pulsar: CompactRemnantModel = {
  kind: 'compact_remnant',
  remnantType: 'neutron_star',
  massKg: massRange(1.1, 2.0),
  radiusM: {
    value: null,
    unit: 'м',
    range: { min: 1.0e4, max: 1.2e4 },
    confidence: 'estimated',
    method: 'типичные радиусы нейтронных звёзд (~10–12 км)',
    source: STANDARD_SOURCE
  },
  intrinsicLuminosityW: null,
  accretionDependent: true,
  accretionNote:
    'Излучение пульсара (магнитосферное, вращательное) зависит от периода вращения и магнитного поля; ' +
    'облучение планеты модельно-зависимо и в модели НЕ считается установленным источником потока.',
  hawkingRadiationNote: null,
  earliestUniverseAgeGyr: 0.01,
  notes: [
    'Планеты вокруг пульсаров наблюдаются, но энергетика их существования сложна; модель не назначает поток автоматически.'
  ]
};

const blackHole: CompactRemnantModel = {
  kind: 'compact_remnant',
  remnantType: 'black_hole',
  massKg: massRange(3, 100),
  radiusM: {
    value: null,
    unit: 'м',
    confidence: 'unknown',
    method: 'радиус Шварцшильда зависит от массы (≈3 км на 1 M☉); конкретная масса неизвестна',
    note: 'значение не вычисляется, пока масса конкретного объекта не задана'
  },
  intrinsicLuminosityW: null,
  accretionDependent: true,
  accretionNote:
    'Чёрная дыра не излучает сама по себе. Мощное излучение возможно ТОЛЬКО при наличии аккреционного ' +
    'материала и диска; наличие диска в модели неизвестно, поэтому энергетический поток не назначается.',
  hawkingRadiationNote:
    'Радиация Хокинга для астрофизических чёрных дыр ничтожно мала (для массы порядка звёздной — ' +
    'температура ~1e-8 K и ниже) и не рассматривается как источник планетарной энергии.',
  earliestUniverseAgeGyr: 0.01,
  notes: [
    'Гравитационный якорь без собственного излучения.',
    'Доступность аккреционной энергии не гарантирована.'
  ]
};

// ============================================
// СУБЗВЁЗДНЫЕ ОБЪЕКТЫ
// ============================================

const brownDwarf: SubstellarModel = {
  kind: 'substellar',
  massKg: {
    value: null,
    unit: 'кг',
    range: { min: 0.012 * M_SUN_KG, max: 0.075 * M_SUN_KG },
    confidence: 'estimated',
    method: 'диапазон класса (~13–80 масс Юпитера)',
    parameters: { 'M/M♃ (min)': 13, 'M/M♃ (max)': 80 },
    uncertainty: 'объект представляет класс',
    source: STANDARD_SOURCE
  },
  luminosityW: luminosityRange(1e-6, 1e-4),
  effectiveTemperatureK: temperatureRange(300, 2800),
  hasInternalHeat: true,
  earliestUniverseAgeGyr: 0.01,
  notes: [
    'Излучение коричневого карлика — преимущественно инфракрасное; остаточное тепло сжатия.',
    'Масса в единицах Солнца в записи диапазона переведена из масс Юпитера (1 M♃ = 1.898e27 кг).'
  ]
};

// ============================================
// ОДИНОКИЙ ГАЗОВЫЙ ГИГАНТ
// ============================================

const loneGasGiant: GasGiantSystemModel = {
  kind: 'gas_giant_system',
  massKg: {
    value: null,
    unit: 'кг',
    range: { min: M_JUP_KG, max: 13 * M_JUP_KG },
    confidence: 'estimated',
    method: 'диапазон масс планет-гигантов (1–13 масс Юпитера)',
    parameters: { 'M/M♃ (min)': 1, 'M/M♃ (max)': 13 },
    uncertainty: 'объект представляет класс; конкретная масса не задана',
    source: STANDARD_SOURCE
  },
  radiusM: {
    value: null,
    unit: 'м',
    range: { min: 5.8e7, max: 7.2e7 },
    confidence: 'estimated',
    method: 'диапазон радиусов известных газовых гигантов Солнечной системы (Сатурн ~58 232 км — Юпитер ~69 911 км, средние радиусы)',
    parameters: { 'R/R♃ (min)': 0.83, 'R/R♃ (max)': 1.03 },
    uncertainty: 'радиус класса, а не конкретной планеты; используется как масштаб орбит спутников родительского гиганта',
    source: STANDARD_SOURCE
  },
  internalHeatW: {
    value: null,
    unit: 'Вт',
    confidence: 'unknown',
    method: 'не вычислено',
    note: 'Внутреннее тепловыделение конкретного гиганта неизвестно; модель не назначает выдуманную мощность.'
  },
  moonSystem: {
    possible: true,
    orbitRangeParentRadii: { min: 5, max: 60 },
    tidalInteractions: 'possible',
    note: 'Возможна система спутников; диапазон орбит — предварительное модельное допущение (в радиусах родительской планеты). Приливные взаимодействия возможны, их мощность не вычисляется.'
  },
  earliestUniverseAgeGyr: 0.01,
  notes: [
    'Одинокий газовый гигант — самостоятельная система, не «звезда».',
    'Спутники обращаются вокруг РОДИТЕЛЬСКОЙ ПЛАНЕТЫ, а не вокруг звезды.'
  ]
};

// ============================================
// РЕЛЯТИВИСТСКИЙ ДЖЕТ
// ============================================

const relativisticJet: JetSystemModel = {
  kind: 'jet_system',
  sourceObjectTypes: ['black_hole', 'neutron_star'],
  direction: 'bipolar',
  collimationNote:
    'Релятивистский джет — направленный (коллимированный) высокоэнергетический поток, ' +
    'связанный с компактным объектом или активным ядром. Это НЕ обычный центральный ' +
    'гравитационный объект и не «ещё одна звезда».',
  intensityW: {
    value: null,
    unit: 'Вт',
    confidence: 'unknown',
    method: 'не задано',
    note: 'Интенсивность джета зависит от аккреции на источник и в модели не назначается автоматически.'
  },
  planetCanAvoidMainBeam: true,
  note:
    'Планета может находиться вне основного конуса воздействия джета; ' +
    'в модели это отражается отдельным флагом в орбитальной конфигурации.',
  earliestUniverseAgeGyr: 0.01,
  notes: [
    'Джет физически связан с компактным объектом-источником (чёрная дыра или нейтронная звезда).',
    'Гравитационным первичным объектом системы остаётся компактный объект-источник.'
  ]
};

// ============================================
// РЕЕСТР МОДЕЛЕЙ
// ============================================

const centralObjectPhysics: Record<string, CentralObjectSystem> = {
  yellow_dwarf: yellowDwarf,
  orange_dwarf: orangeDwarf,
  red_dwarf: redDwarf,
  blue_giant: blueGiant,
  white_dwarf: whiteDwarf,
  pulsar: pulsar,
  black_hole: blackHole,
  brown_dwarf: brownDwarf,
  lone_gas_giant: loneGasGiant,
  relativistic_jet: relativisticJet
};

/**
 * Физическая модель центрального объекта по его id.
 * Возвращает null для объектов вне каталога.
 */
export function getCentralObjectPhysics(objectId: string): CentralObjectSystem | null {
  return centralObjectPhysics[objectId] ?? null;
}

/**
 * Минимальный возраст Вселенной (млрд лет), при котором объекты класса
 * уже могут существовать. Для неизвестных объектов — 0 (не ограничиваем).
 */
export function getEarliestUniverseAgeGyr(objectId: string): number {
  const model = centralObjectPhysics[objectId];
  return model ? model.earliestUniverseAgeGyr : 0;
}

/**
 * Характерное время жизни ОТДЕЛЬНОГО объекта класса (млрд лет).
 * null, если понятие неприменимо (остатки, джеты) или класс живёт
 * дольше текущего возраста Вселенной без ограничения.
 */
export function getTypicalLifetimeGyr(objectId: string): { min: number; max: number } | null {
  const model = centralObjectPhysics[objectId];
  if (model && model.kind === 'star') {
    return model.typicalLifetimeGyr;
  }
  return null;
}

/**
 * Оценка светимости (Вт) для расчёта потока: геометрическая середина
 * диапазона класса. Светимость остаётся оценкой (confidence: estimated),
 * конкретная звезда не задаётся.
 * Возвращает null, если надёжная светимость недоступна
 * (нейтронные звёзды, чёрные дыры, джеты, свободное плавание).
 */
export function getRepresentativeLuminosityW(objectId: string): number | null {
  const model = centralObjectPhysics[objectId];
  if (!model) return null;
  if (model.kind === 'star' && model.luminosityW.range) {
    return Math.sqrt(model.luminosityW.range.min * model.luminosityW.range.max);
  }
  if (model.kind === 'compact_remnant') {
    if (model.remnantType === 'white_dwarf' && model.intrinsicLuminosityW?.range) {
      return Math.sqrt(model.intrinsicLuminosityW.range.min * model.intrinsicLuminosityW.range.max);
    }
    // Пульсары и чёрные дыры: поток зависит от аккреции — не назначаем.
    return null;
  }
  if (model.kind === 'substellar' && model.luminosityW?.range) {
    return Math.sqrt(model.luminosityW.range.min * model.luminosityW.range.max);
  }
  // Газовый гигант и джет: звёздного потока нет.
  return null;
}

/**
 * Оценка массы центрального объекта (кг) для расчёта орбитального периода:
 * арифметическая середина диапазона класса. null, если недоступна.
 */
export function getRepresentativeMassKg(objectId: string): number | null {
  const model = centralObjectPhysics[objectId];
  if (!model) return null;
  if (model.kind === 'star' && model.massKg.range) {
    return (model.massKg.range.min + model.massKg.range.max) / 2;
  }
  if (model.kind === 'compact_remnant' && model.massKg.range) {
    return (model.massKg.range.min + model.massKg.range.max) / 2;
  }
  if (model.kind === 'substellar' && model.massKg.range) {
    return (model.massKg.range.min + model.massKg.range.max) / 2;
  }
  if (model.kind === 'gas_giant_system' && model.massKg.range) {
    return (model.massKg.range.min + model.massKg.range.max) / 2;
  }
  return null;
}

/**
 * Репрезентативный радиус класса, м: середина диапазона каталога.
 * Возвращается только для классов с известным диапазоном радиусов,
 * иначе null. Масштаб орбит спутников вокруг РОДИТЕЛЬСКОЙ планеты;
 * не подменяет параметры самой луны и не выдумывает значений.
 */
export function getRepresentativeRadiusM(objectId: string): number | null {
  const model = centralObjectPhysics[objectId];
  if (!model) return null;
  if (model.kind === 'gas_giant_system' && model.radiusM?.range) {
    return (model.radiusM.range.min + model.radiusM.range.max) / 2;
  }
  return null;
}

export default centralObjectPhysics;
