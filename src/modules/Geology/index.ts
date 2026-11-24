// ============================================
// GEOLOGY - Внутреннее тепло и геологическая активность
// ============================================
//
// Модель энергетического баланса недр (упрощённая, первая версия):
//   Q_internal = Q_primordial + Q_radiogenic + Q_tidal + Q_other
//
// Каждый источник тепла анализируется ОТДЕЛЬНО и честно:
// - существование потенциального источника;
// - доступность источника;
// - интенсивность (если может быть оценена);
// - возможность использования живыми организмами (выносится
//   в geothermalEnergyAvailable).
//
// ПРИНЦИПЫ:
// - геотермальная энергия НЕ добавляется каждому миру автоматически;
// - приливный нагрев без данных о Q/k2/Love numbers оценивается
//   только как ВОЗМОЖНЫЙ, мощность не вычисляется;
// - для спутников с неизвестным составом радиогенный нагрев
//   не оценивается вовсе (null), а не угадывается.

import type {
  CelestialBodyOption,
  CentralObjectOption,
  OrbitalConfigurationData,
  GeologicalAnalysis,
  HeatSourceAnalysis
} from '../../types';

const LEVEL_RANK: Record<NonNullable<HeatSourceAnalysis['level']>, number> = {
  negligible: 0,
  low: 1,
  moderate: 2,
  high: 3
};

const RANK_LEVEL: Record<number, GeologicalAnalysis['totalInternalHeat']> = {
  0: 'none',
  1: 'low',
  2: 'moderate',
  3: 'high'
};

/** Средняя точка диапазона масс (в массах Земли); null, если диапазон не задан. */
function massRangeMidpointEarthMasses(body: CelestialBodyOption): number | null {
  if (!body.massRange) return null;
  return (body.massRange.min + body.massRange.max) / 2;
}

// ============================================
// 1. ОСТАТОЧНОЕ ТЕПЛО ФОРМИРОВАНИЯ
// ============================================
//
// Оценка по массе: массивные тела дольше удерживают тепло аккреции
// (отношение площади поверхности к объёму падает с ростом размера).
// Это качественная оценка, а не расчёт тепловой истории.

function analyzePrimordialHeat(body: CelestialBodyOption): HeatSourceAnalysis {
  const mid = massRangeMidpointEarthMasses(body);
  if (mid === null) {
    return {
      sourceId: 'primordial',
      level: null,
      status: 'not_estimated',
      basis: 'диапазон масс тела не задан в каталоге',
      confidence: 'unknown',
      note: 'остаточное тепло формирования не оценивается без данных о массе'
    };
  }
  let level: NonNullable<HeatSourceAnalysis['level']>;
  if (mid < 0.05) {
    level = 'negligible';
  } else if (mid < 0.2) {
    level = 'low';
  } else if (mid <= 3) {
    level = 'moderate';
  } else {
    level = 'high';
  }
  return {
    sourceId: 'primordial',
    level,
    status: 'potential',
    basis: `средняя точка диапазона масс тела ≈ ${mid.toFixed(2)} M⊕: отношение площадь/объём определяет скорость остывания`,
    confidence: 'estimated',
    note: 'качественная оценка по массе, а не расчёт тепловой истории недр'
  };
}

// ============================================
// 2. РАДИОГЕННЫЙ НАГРЕВ
// ============================================
//
// Радиогенный нагрев (K-40, Th-232, U-235/238) присущ силикатным
// телам. Для спутников газовых гигантов состав недр неизвестен —
// оценка не производится (null), а не подменяется догадкой.

const MOON_LIKE_BODIES = new Set(['gas_giant_moon']);

function analyzeRadiogenicHeat(body: CelestialBodyOption): HeatSourceAnalysis {
  if (MOON_LIKE_BODIES.has(body.id)) {
    return {
      sourceId: 'radiogenic',
      level: null,
      status: 'not_estimated',
      basis: 'состав недр спутника газового гиганта в каталоге не задан',
      confidence: 'unknown',
      note: 'радиогенный нагрев не оценивается без данных о составе; наличие радиоизотопов не подтверждено'
    };
  }
  // Уровень масштабируется с массой: больше силикатного вещества —
  // больше радиоизотопов и медленнее остывание.
  const mid = massRangeMidpointEarthMasses(body);
  let level: NonNullable<HeatSourceAnalysis['level']>;
  if (mid === null) {
    level = 'moderate';
  } else if (mid < 0.2) {
    level = 'low';
  } else if (mid <= 3) {
    level = 'moderate';
  } else {
    level = 'high';
  }
  return {
    sourceId: 'radiogenic',
    level,
    status: 'potential',
    basis: `силикатное тело (средняя масса ≈ ${mid?.toFixed(2) ?? '?'} M⊕): радиогенный нагрев K-40, Th-232, U-235/238 принципиально присущ каменным планетам`,
    confidence: 'estimated',
    note: 'уровень оценён качественно по массе; концентрации радиоизотопов конкретного тела неизвестны'
  };
}

// ============================================
// 3. ПРИЛИВНЫЙ НАГРЕВ
// ============================================
//
// Приливный нагрев требует: массивного родительского тела,
// близкой орбиты и ненулевого эксцентриситета. Мощность пропорциональна
// (M_родителя² · R⁴ · e²)/(a⁶) и зависит от Q и k2 (чисел Лява),
// которые для сгенерированных тел неизвестны. Поэтому выдаётся
// только статус "возможен", без вычисленной мощности.

function analyzeTidalHeat(
  body: CelestialBodyOption,
  orbit: OrbitalConfigurationData | undefined
): HeatSourceAnalysis {
  const isMoon = body.bodyType === 'moon';
  const eccentricity = orbit?.eccentricity?.value ?? null;

  if (!isMoon) {
    return {
      sourceId: 'tidal',
      level: null,
      status: 'not_estimated',
      basis: 'тело не является спутником массивного родителя',
      confidence: 'unknown',
      note: 'приливный нагрев от звезды не оценивался (модель этапа 3 его не охватывает)'
    };
  }
  const frame = orbit?.frame;
  if (frame !== 'around_parent_body') {
    return {
      sourceId: 'tidal',
      level: null,
      status: 'not_estimated',
      basis: 'орбитальная рамка спутника не определена (around_parent_body)',
      confidence: 'unknown',
      note: 'приливный нагрев требует орбиты вокруг массивного родителя'
    };
  }
  if (eccentricity === null) {
    return {
      sourceId: 'tidal',
      level: null,
      status: 'potential',
      basis: 'спутник на орбите вокруг массивного родителя: приливный нагрев возможен',
      confidence: 'hypothetical',
      note: 'эксцентриситет неизвестен; мощность не вычисляется (неизвестны Q, k2, масса родителя)'
    };
  }
  if (eccentricity <= 0.05) {
    return {
      sourceId: 'tidal',
      level: 'negligible',
      status: 'potential',
      basis: `эксцентриситет орбиты мал (e ≈ ${eccentricity.toFixed(3)} ≤ 0.05): приливная диссипация слаба`,
      confidence: 'estimated',
      note: 'приливный нагрев зависит от e²; при круговой орбите он стремится к нулю'
    };
  }
  return {
    sourceId: 'tidal',
    level: null,
    status: 'potential',
    basis: `ненулевой эксцентриситет (e ≈ ${eccentricity.toFixed(3)}) на орбите вокруг массивного родителя`,
    confidence: 'hypothetical',
    note: 'возможен приливный нагрев; мощность НЕ вычисляется — неизвестны числа Q, k2 и точная масса родителя'
  };
}

// ============================================
// 4. СВОДНЫЙ АНАЛИЗ
// ============================================

export interface GeologyAnalysisInput {
  celestialBody: CelestialBodyOption;
  centralObject?: CentralObjectOption;
  orbit?: OrbitalConfigurationData;
}

/**
 * Полный анализ внутренних источников тепла.
 * Источники учитываются раздельно; суммарный уровень —
 * консервативная свёртка (см. notes результата).
 */
export function analyzeGeology(input: GeologyAnalysisInput): GeologicalAnalysis {
  const { celestialBody, orbit } = input;

  const primordialHeat = analyzePrimordialHeat(celestialBody);
  const radiogenicHeat = analyzeRadiogenicHeat(celestialBody);
  const tidalHeat = analyzeTidalHeat(celestialBody, orbit);

  const sources = [primordialHeat, radiogenicHeat, tidalHeat];

  // Суммарный уровень: максимум среди оценённых уровней,
  // усиленный на один шаг, если ДВА И БОЛЕЕ источников >= moderate.
  const levels = sources.map((s) => s.level).filter((l): l is NonNullable<HeatSourceAnalysis['level']> => l !== null);
  let total: GeologicalAnalysis['totalInternalHeat'];
  if (levels.length === 0) {
    total = 'none';
  } else {
    const maxRank = Math.max(...levels.map((l) => LEVEL_RANK[l]));
    const strongSources = levels.filter((l) => LEVEL_RANK[l] >= LEVEL_RANK.moderate).length;
    const totalRank = Math.min(3, strongSources >= 2 ? maxRank + 1 : maxRank);
    total = RANK_LEVEL[totalRank];
  }

  const geothermalEnergyAvailable = total === 'moderate' || total === 'high';

  // Вулканизм: high → возможен, moderate → неопределён, ниже → маловероятен.
  const volcanism: boolean | null =
    total === 'high' ? true : total === 'moderate' ? null : false;

  // Гидротермальные системы и подземные резервуары требуют данных
  // о воде/летучих и температуре недр, которых модель не имеет:
  // честно оставляем неопределёнными (null).
  const hydrothermalSystems: boolean | null = null;
  const subsurfaceLiquidReservoirs: boolean | null = null;

  const geochemicalGradients: string[] = [];
  if (primordialHeat.level && LEVEL_RANK[primordialHeat.level] >= LEVEL_RANK.moderate) {
    geochemicalGradients.push('температурный градиент недр за счёт остаточного тепла (потенциальный)');
  }
  if (radiogenicHeat.level && LEVEL_RANK[radiogenicHeat.level] >= LEVEL_RANK.moderate) {
    geochemicalGradients.push('геохимические градиенты, связанные с радиогенным нагревом (потенциальные)');
  }
  if (tidalHeat.status === 'potential') {
    geochemicalGradients.push('периодические приливные деформации как возможный источник геохимических градиентов');
  }
  if (geochemicalGradients.length === 0) {
    geochemicalGradients.push('значимых источников геохимических градиентов не выявлено');
  }

  return {
    primordialHeat,
    radiogenicHeat,
    tidalHeat,
    totalInternalHeat: total,
    geothermalEnergyAvailable,
    volcanism,
    hydrothermalSystems,
    subsurfaceLiquidReservoirs,
    geochemicalGradients,
    notes: [
      'модель энергетического баланса недр упрощённая (первая версия)',
      'суммарный уровень — консервативная свёртка: максимум среди источников с усилением при двух и более заметных источниках',
      'мощности источников в ваттах не вычисляются: отсутствуют данные о теплоёмкости, размерах недр и коэффициентах диссипации',
      'вывод о высокой тектонической активности НЕ делается только по названию типа планеты',
      'влияние внутреннего тепла на поверхностную температуру не моделируется'
    ]
  };
}

export default { analyzeGeology };
