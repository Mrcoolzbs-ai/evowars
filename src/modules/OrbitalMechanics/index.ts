// ============================================
// ORBITAL MECHANICS - Орбитальная механика и физика центральных объектов
// ============================================
//
// Модуль этапа 3:
// - строит структурную модель центрального объекта (звезда, остаток,
//   джет — физически разные сущности, см. Data/starPhysical);
// - сэмплирует детерминированную орбитальную конфигурацию;
// - рассчитывает падающий поток F = L / (4πa²) и равновесную
//   температуру T_eq = [F(1-A)f / (4εσ)]^(1/4) с явными допущениями.
//
// ПРИНЦИПЫ:
// - если светимость или расстояние неизвестны, поток = null,
//   а не произвольное число;
// - динамическая устойчивость орбиты НЕ проверялась — это отмечено
//   явно (stabilityCheck: 'not_performed');
// - орбитальные диапазоны — модельные (design assumption), а не
//   результат N-тельного интегрирования.

import type {
  CentralObjectOption,
  CelestialBodyOption,
  EpochOption,
  OrbitalConfigurationData,
  CentralObjectSystem,
  PhysValue
} from '../../types';
import { getCentralObjectPhysics, getRepresentativeMassKg } from '../Data/starPhysical';
import {
  G,
  STEFAN_BOLTZMANN,
  AU_M,
  auToM,
  secondsToYears,
  earthRadiiToM
} from '../Units';
import type { DeterministicRandom } from '../Generator/random';

// ============================================
// 1. ОРБИТАЛЬНЫЕ ДИАПАЗОНЫ (МОДЕЛЬНЫЕ)
// ============================================
//
// Диапазоны больших полуосей для планет вокруг каждого класса
// центральных объектов. Это ИГРОВЫЕ модельные диапазоны
// (confidence: 'game_assumption'), согласованные с качественными
// compatibleOrbits каталога, но НЕ результат динамической проверки.

export interface OrbitBand {
  minAu: number;
  maxAu: number;
  note: string;
}

export const ORBIT_BANDS: Record<string, OrbitBand> = {
  orange_dwarf: { minAu: 0.3, maxAu: 2, note: 'модельный диапазон вокруг оранжевого карлика' },
  red_dwarf: { minAu: 0.05, maxAu: 0.5, note: 'модельный диапазон вокруг красного карлика' },
  yellow_dwarf: { minAu: 0.5, maxAu: 3, note: 'модельный диапазон вокруг жёлтого карлика' },
  blue_giant: { minAu: 5, maxAu: 50, note: 'модельный диапазон: далёкая орбита из-за экстремальной светимости' },
  white_dwarf: { minAu: 0.02, maxAu: 2, note: 'модельный диапазон вокруг остатка' },
  pulsar: { minAu: 0.05, maxAu: 1, note: 'модельный диапазон вокруг пульсара' },
  black_hole: { minAu: 0.1, maxAu: 10, note: 'модельный диапазон вокруг чёрной дыры' },
  brown_dwarf: { minAu: 0.02, maxAu: 1, note: 'модельный диапазон вокруг коричневого карлика' }
};

/** Диапазон орбит спутника вокруг родительской планеты, в радиусах родителя. */
export const MOON_ORBIT_BAND_PARENT_RADII = { min: 5, max: 60 };

// ============================================
// 2. СТРУКТУРНАЯ МОДЕЛЬ ЦЕНТРАЛЬНОГО ОБЪЕКТА
// ============================================

/**
 * Структурная модель центрального объекта из физического каталога.
 * Возвращает null, если объект не входит в каталог — тогда
 * физические параметры остаются неизвестными, а не выдумываются.
 */
export function buildCentralObjectSystem(centralObject: CentralObjectOption): CentralObjectSystem | null {
  return getCentralObjectPhysics(centralObject.id);
}

// ============================================
// 3. ЭНЕРГЕТИЧЕСКИЙ ПОТОК И РАВНОВЕСНАЯ ТЕМПЕРАТУРА
// ============================================

/**
 * Падающий поток звёздного излучения:
 *   F = L / (4πa²)
 * Возвращает null, если светимость или расстояние неизвестны —
 * поток НЕ подменяется произвольным значением.
 */
export function incidentFlux(luminosityW: number | null, semiMajorAxisM: number | null): number | null {
  if (luminosityW === null || semiMajorAxisM === null || semiMajorAxisM <= 0) {
    return null;
  }
  return luminosityW / (4 * Math.PI * semiMajorAxisM * semiMajorAxisM);
}

export interface EquilibriumTemperatureOptions {
  /** Альбедо Бонда (0..1); по умолчанию 0.3 — грубое типичное допущение */
  bondAlbedo?: number;
  /** Эмиссивность (по умолчанию 1 — допущение модели) */
  emissivity?: number;
  /** Коэффициент перераспределения тепла f (по умолчанию 1 — полное перераспределение) */
  redistribution?: number;
}

/**
 * Равновесная температура планеты:
 *   T_eq = [F(1-A)·f / (4εσ)]^(1/4)
 *
 * ЯВНЫЕ ДОПУЩЕНИЯ базовой модели:
 * - излучение переизлучается равномерно по всей поверхности (f = 1);
 * - эмиссивность ε = 1;
 * - альбедо Бонда задаётся отдельно (по умолчанию 0.3).
 *
 * T_eq НЕ равна температуре поверхности: парниковая модель
 * не реализована, разрыв фиксируется отдельно в EnergyBudget.
 */
export function equilibriumTemperature(
  fluxWm2: number | null,
  options: EquilibriumTemperatureOptions = {}
): number | null {
  if (fluxWm2 === null) {
    return null;
  }
  const albedo = options.bondAlbedo ?? 0.3;
  const emissivity = options.emissivity ?? 1;
  const redistribution = options.redistribution ?? 1;
  if (emissivity <= 0) {
    return null;
  }
  return Math.pow((fluxWm2 * (1 - albedo) * redistribution) / (4 * emissivity * STEFAN_BOLTZMANN), 0.25);
}

// ============================================
// 4. СЭМПЛИРОВАНИЕ ОРБИТЫ
// ============================================

const orbitBasisLabels: Record<string, string> = {
  orange_dwarf: 'орбита вокруг оранжевого карлика',
  red_dwarf: 'орбита вокруг красного карлика',
  yellow_dwarf: 'орбита вокруг жёлтого карлика',
  blue_giant: 'далёкая орбита вокруг голубого гиганта',
  white_dwarf: 'орбита вокруг белого карлика',
  pulsar: 'орбита вокруг пульсара',
  black_hole: 'орбита вокруг чёрной дыры',
  brown_dwarf: 'орбита вокруг коричневого карлика',
  lone_gas_giant: 'спутниковая система одинокого газового гиганта',
  relativistic_jet: 'система в высокоэнергетическом окружении релятивистского джета'
};

/** Лог-равномерное сэмплирование величины в диапазоне [min, max]. */
function sampleLogUniform(rng: DeterministicRandom, min: number, max: number): number {
  const lnMin = Math.log(min);
  const lnMax = Math.log(max);
  return Math.exp(lnMin + rng.next() * (lnMax - lnMin));
}

export interface SampleOrbitInput {
  centralObject: CentralObjectOption;
  celestialBody: CelestialBodyOption;
  /** Радиус родительской планеты для спутниковых орбит (м); null — неизвестен */
  parentBodyRadiusM?: number | null;
}

/**
 * Детерминированное сэмплирование орбитальной конфигурации.
 *
 * Физические рамки:
 * - планета вокруг звезды/остатка: a из модельного диапазона класса
 *   (лог-равномерно), e в [0, 0.4), период по III закону Кеплера
 *   с репрезентативной массой центра (иначе период = null);
 * - луна газового гиганта: орбита вокруг РОДИТЕЛЬСКОЙ ПЛАНЕТЫ,
 *   а не вокруг звезды (a в радиусах родителя);
 * - одинокий газовый гигант: свободно плавающая система, a = null;
 * - релятивистский джет: система вблизи джета, расстояние от
 *   источника сэмплируется, интенсивность неизвестна, планета
 *   может находиться вне основного конуса воздействия.
 */
export function sampleOrbit(rng: DeterministicRandom, input: SampleOrbitInput): OrbitalConfigurationData {
  const { centralObject, celestialBody } = input;
  const cid = centralObject.id;

  // --- Спутниковая орбита вокруг родительской планеты ---
  if (celestialBody.bodyType === 'moon') {
    const parentRadiusM = input.parentBodyRadiusM ?? earthRadiiToM(1);
    const radii = sampleLogUniform(rng, MOON_ORBIT_BAND_PARENT_RADII.min, MOON_ORBIT_BAND_PARENT_RADII.max);
    const semiMajorM = parentRadiusM * radii;
    const eccentricity = rng.nextFloatRange(0, 0.4);
    const parentMassKg = getRepresentativeMassKg(cid); // родительский объект каталога
    const periodS = parentMassKg !== null ? orbitalPeriodFromElements(semiMajorM, parentMassKg) : null;
    return {
      frame: 'around_parent_body',
      orbitalBasis: orbitBasisLabels[cid] ?? 'орбита вокруг родительской планеты',
      semiMajorAxis: semiMajorAxisValue(semiMajorM),
      eccentricity: eccentricityValue(eccentricity),
      orbitalPeriod: periodValue(periodS),
      inclination: unknownValue('наклонение орбиты не моделируется на данном этапе', 'rad'),
      tidalLocking: {
        value: 'possible',
        unit: 'статус',
        confidence: 'hypothetical',
        method: 'спутник массивной планеты — приливный захват вероятен',
        note: 'приливный захват оценивается качественно, не рассчитывается'
      },
      stabilityCheck: 'not_performed',
      stabilityNote:
        'орбита спутника задана в радиусах родительской планеты; устойчивость к возмущениям со стороны других спутников и резонансами строго не проверялась',
      radiativeConditions:
        'спутник освещается звездой (если она есть) и проходит через тень родительской планеты; поток в тени не моделируется',
      notes: [
        `большая полуось ≈ ${radii.toFixed(1)} радиусов родительской планеты`,
        'орбита спутника считается вокруг родительской планеты, а не вокруг звезды'
      ]
    };
  }

  // --- Одинокий газовый гигант: свободно плавающая система ---
  if (cid === 'lone_gas_giant') {
    return {
      frame: 'free_floating',
      orbitalBasis: orbitBasisLabels[cid],
      semiMajorAxis: unknownValue('свободно плавающая система: звёздной орбиты нет', 'm'),
      eccentricity: unknownValue('без центральной звезды эксцентриситет орбиты не определён', 'безразмерный'),
      orbitalPeriod: unknownValue('орбитальный период вокруг звезды неприменим', 's'),
      inclination: unknownValue('наклонение не определено', 'rad'),
      tidalLocking: {
        value: 'unknown',
        unit: 'статус',
        confidence: 'unknown',
        method: 'без звезды приливный захват к ней неприменим',
        note: 'внутренние приливные взаимодействия системы не моделируются'
      },
      stabilityCheck: 'not_performed',
      stabilityNote: 'динамическая проверка системы спутников не выполнялась',
      radiativeConditions:
        'звёздного излучения нет; доступно только внутреннее тепловыделение газового гиганта (конкретная мощность неизвестна)',
      notes: [
        'планета обращается вокруг общего центра масс системы газовый гигант — спутники',
        'падающий звёздный поток не определён (null), а не приравнен к нулю'
      ]
    };
  }

  // --- Релятивистский джет: высокоэнергетическое окружение ---
  if (cid === 'relativistic_jet') {
    const distanceAu = sampleLogUniform(rng, 0.1, 100);
    const semiMajorM = auToM(distanceAu);
    const eccentricity = rng.nextFloatRange(0, 0.4);
    // Масса компактного объекта-источника джета неизвестна:
    // орбитальный период НЕ выдумывается.
    const periodS = null;
    return {
      frame: 'jet_system',
      orbitalBasis: orbitBasisLabels[cid],
      semiMajorAxis: {
        value: semiMajorM,
        unit: 'm',
        confidence: 'game_assumption',
        method: 'расстояние до источника джета сэмплировано лог-равномерно из модельного диапазона 0.1–100 а.е.',
        parameters: { 'a (а.е.)': distanceAu },
        uncertainty: 'положение системы относительно источника джета задано игровым диапазоном',
        source: '',
        applicability: 'джет — не гравитационный центр; реальная орбита определяется компактным объектом-источником, чья масса неизвестна'
      },
      eccentricity: eccentricityValue(eccentricity),
      orbitalPeriod: periodValue(periodS),
      inclination: unknownValue('наклонение к оси джета не моделируется', 'rad'),
      tidalLocking: {
        value: 'unknown',
        unit: 'статус',
        confidence: 'unknown',
        method: 'приливный захват у источника джета не оценивался',
        note: 'требуется знание компактного объекта-источника'
      },
      stabilityCheck: 'not_performed',
      stabilityNote:
        'орбита вблизи джета не проверялась на устойчивость; гравитационным первичным объектом остаётся компактный объект-источник, масса которого не задана',
      radiativeConditions:
        'система находится в высокоэнергетическом окружении джета; интенсивность излучения неизвестна, пока не задана явно',
      notes: [
        'планета может находиться вне основного конуса воздействия джета (см. centralObjectSystem.planetCanAvoidMainBeam)',
        'поток излучения джета НЕ рассчитывается: интенсивность неизвестна (null)'
      ]
    };
  }

  // --- Обычная орбита вокруг звезды / компактного остатка ---
  const band = ORBIT_BANDS[cid];
  if (!band) {
    return {
      frame: 'around_star',
      orbitalBasis: orbitBasisLabels[cid] ?? 'орбита вокруг центрального объекта',
      semiMajorAxis: unknownValue('для этого класса центрального объекта орбитальный диапазон не задан', 'm'),
      eccentricity: unknownValue('эксцентриситет не определён', 'безразмерный'),
      orbitalPeriod: unknownValue('орбитальный период не определён', 's'),
      inclination: unknownValue('наклонение не моделируется', 'rad'),
      tidalLocking: {
        value: 'unknown',
        unit: 'статус',
        confidence: 'unknown',
        method: 'данных о классе центрального объекта недостаточно',
        note: 'приливный захват не оценён'
      },
      stabilityCheck: 'not_performed',
      stabilityNote: 'динамическая устойчивость не проверялась',
      radiativeConditions: 'не определены',
      notes: ['класс центрального объекта не входит в физический каталог']
    };
  }

  const aAu = sampleLogUniform(rng, band.minAu, band.maxAu);
  const semiMajorM = auToM(aAu);
  const eccentricity = rng.nextFloatRange(0, 0.4);
  const centerMassKg = getRepresentativeMassKg(cid);
  const periodS = centerMassKg !== null ? orbitalPeriodFromElements(semiMajorM, centerMassKg) : null;

  // Приливный захват: качественная оценка для близких орбит красных карликов.
  const tidalLocking: OrbitalConfigurationData['tidalLocking'] =
    cid === 'red_dwarf' && aAu < 0.1
      ? {
          value: 'possible',
          unit: 'статус',
          confidence: 'hypothetical',
          method: 'близкая орбита вокруг красного карлика (a < 0.1 а.е.)',
          note: 'время синхронизации не рассчитывается; оценка качественная'
        }
      : {
          value: 'unlikely',
          unit: 'статус',
          confidence: 'estimated',
          method: 'орбита достаточно далёкая для сохранения вращения',
          note: 'качественная оценка, расчёт времен синхронизации не выполнялся'
        };

  return {
    frame: 'around_star',
    orbitalBasis: orbitBasisLabels[cid] ?? 'орбита вокруг центрального объекта',
    semiMajorAxis: {
      value: semiMajorM,
      unit: 'm',
      confidence: 'game_assumption',
      method: `большая полуось сэмплирована лог-равномерно из модельного диапазона ${band.minAu}–${band.maxAu} а.е.`,
      parameters: { 'a (а.е.)': aAu },
      uncertainty: 'диапазон модельный; динамическая проверка не выполнялась',
      source: '',
      applicability: band.note
    },
    eccentricity: eccentricityValue(eccentricity),
    orbitalPeriod: periodValue(periodS),
    inclination: unknownValue('наклонение орбиты не моделируется на данном этапе', 'rad'),
    tidalLocking,
    stabilityCheck: 'not_performed',
    stabilityNote:
      'орбита сэмплирована из модельного диапазона; устойчивость к возмущениям (соседние планеты, резонансы) строго не проверялась',
    radiativeConditions:
      cid === 'black_hole' || cid === 'pulsar'
        ? 'радиационная обстановка зависит от аккреции компактного объекта и не гарантируется'
        : 'падающий поток рассчитывается из светимости класса центрального объекта (оценка)',
    notes: [
      `большая полуось ≈ ${aAu.toFixed(3)} а.е.`,
      `эксцентриситет ≈ ${eccentricity.toFixed(3)}`,
      centerMassKg !== null
        ? 'период рассчитан по III закону Кеплера с репрезентативной массой центра'
        : 'период не рассчитан: масса центрального объекта неизвестна'
    ]
  };
}

// ============================================
// 5. ОРБИТАЛЬНЫЙ ПЕРИОД (III ЗАКОН КЕПЛЕРА)
// ============================================

/**
 * Орбитальный период P = 2π·√(a³ / (G·M)).
 * Требует массу центрального тела; если она неизвестна, вернёт null.
 */
export function orbitalPeriodFromElements(semiMajorAxisM: number, centerMassKg: number): number | null {
  if (semiMajorAxisM <= 0 || centerMassKg <= 0) {
    return null;
  }
  return 2 * Math.PI * Math.sqrt((semiMajorAxisM ** 3) / (G * centerMassKg));
}

// ============================================
// 6. ОКНО СУЩЕСТВОВАНИЯ ОБЪЕКТА В ЭПОХЕ
// ============================================

/**
 * Может ли класс центрального объекта существовать в выбранную эпоху.
 * Сравнивается МИНИМАЛЬНЫЙ возраст Вселенной для класса с эпохой:
 *   эпоха допустима, если max возраст эпохи >= earliest.
 *
 * Время жизни отдельной звезды здесь НЕ используется:
 * короткоживущий голубой гигант может сформироваться и недавно
 * в древней Вселенной — предупреждение о недолгом окне
 * выдаётся отдельным правилом совместимости.
 */
export function existsInEpoch(epoch: EpochOption, earliestUniverseAgeGyr: number): boolean {
  return epoch.ageRange.max >= earliestUniverseAgeGyr;
}

// ============================================
// 7. ВСПОМОГАТЕЛЬНЫЕ ОБОЛОЧКИ PHYSVALUE
// ============================================

function semiMajorAxisValue(m: number): PhysValue {
  return {
    value: m,
    unit: 'm',
    confidence: 'derived',
    method: 'расчёт из сэмплированных параметров',
    formula: 'a = R_родителя × k (спутник) или a из модельного диапазона',
    uncertainty: 'сэмплировано детерминированно из диапазона'
  };
}

function eccentricityValue(e: number): PhysValue {
  return {
    value: e,
    unit: 'безразмерный',
    confidence: 'game_assumption',
    method: 'сэмплировано из диапазона [0, 0.4)',
    uncertainty: 'модельный диапазон эксцентриситетов'
  };
}

function periodValue(periodS: number | null): PhysValue {
  if (periodS === null) {
    return unknownValue('масса центрального тела неизвестна — период не рассчитан', 's');
  }
  return {
    value: periodS,
    unit: 's',
    confidence: 'derived',
    method: 'III закон Кеплера: P = 2π·√(a³/(G·M))',
    formula: 'P = 2π·√(a³ / (G·M))',
    parameters: { 'P (лет)': secondsToYears(periodS) },
    uncertainty: 'использована репрезентативная масса класса центрального объекта'
  };
}

export function unknownValue(note: string, unit: string): PhysValue {
  return {
    value: null,
    unit,
    confidence: 'unknown',
    method: 'значение не определяется при недостатке данных',
    note
  };
}

// ============================================
// 8. ЭКСПОРТ ФОРМУЛ ДЛЯ ПРОВЕРКИ В ТЕСТАХ
// ============================================

/**
 * Проверочная формула потока на terrestrial-орбите Земли:
 * Солнце (L = 3.828e26 Вт) на 1 а.е. даёт ~1361 Вт/м².
 */
export function solarConstantCheck(): number | null {
  return incidentFlux(3.828e26, AU_M);
}

export default {
  ORBIT_BANDS,
  MOON_ORBIT_BAND_PARENT_RADII,
  buildCentralObjectSystem,
  incidentFlux,
  equilibriumTemperature,
  sampleOrbit,
  orbitalPeriodFromElements,
  existsInEpoch,
  solarConstantCheck,
  unknownValue
};
