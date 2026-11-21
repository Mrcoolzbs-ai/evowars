import type { HydrostaticLayer, HydrostaticInteriorResult, HydrostaticSolverOptions } from '../Core/hydrostaticInterior';
import { solveHydrostaticInterior } from '../Core/hydrostaticInterior';

/**
 * ============================================================
 * МОДЕЛЬ ПЛОТНОСТИ PREM (Stage 4.7.2)
 * ============================================================
 *
 * Первоисточник: Dziewonski, A. M., Anderson, D. L. (1981).
 * "Preliminary reference Earth model". Physics of the Earth and
 * Planetary Interiors, 25, 297-356. DOI: 10.1016/0031-9201(81)90046-7.
 * Оригинал статьи: https://lweb.cfa.harvard.edu/~lzeng/papers/PREM.pdf
 *
 * Table I задаёт кусочно-полиномиальную плотность (г/см³) в нормированной
 * координате x = r / a, a = 6371 км. Коэффициенты перенесены БЕЗ изменений:
 * округлённые средние плотности и собственная аппроксимация не используются.
 *
 * Опорные величины из первоисточника (НЕ результаты нашей интеграции):
 *  - Table II: центральное давление 3638.521 kbar = 363.8521 GPa;
 *  - раздел 3: масса 5.974e24 kg и I/(MR²) = 0.3308 как исходные
 *    ограничения (констрейнты) модели.
 *
 * ОГРАНИЧЕНИЕ: PREM — гидростатическая реконструкция по ЗАДАННОМУ
 * профилю плотности. Это НЕ EOS-предсказание: записи fe_hcp_300k и
 * mgso3_bridgmanite_300k (Stage 4.7.1) описывают ИЗОТЕРМИЧЕСКИЕ 300 K
 * конденсированные фазы и не описывают горячие недра Земли. EOS-driven
 * модель горячей Земли ещё не реализована.
 */

/** Средний радиус Земли PREM, a = 6371 км. */
export const PREM_MEAN_RADIUS_M = 6371000;

/** Опорное центральное давление PREM (Table II первоисточника): 3638.521 kbar. */
export const PREM_CENTRAL_PRESSURE_PUBLISHED_PA = 363.8521e9;

/** Масса Земли как исходное ограничение PREM (раздел 3): 5.974e24 kg. */
export const PREM_TOTAL_MASS_CONSTRAINT_KG = 5.974e24;

/** Нормированный момент инерции как исходное ограничение PREM (раздел 3): 0.3308. */
export const PREM_MOMENT_OF_INERTIA_FACTOR_CONSTRAINT = 0.3308;

/** Библиографическая запись первоисточника (фиксированная, без вариаций). */
export const PREM_REFERENCE_SOURCE = {
  sourceName: 'Dziewonski, A. M., Anderson, D. L. (1981). Preliminary reference Earth model',
  journal: 'Physics of the Earth and Planetary Interiors, 25, 297-356',
  doi: '10.1016/0031-9201(81)90046-7',
  url: 'https://lweb.cfa.harvard.edu/~lzeng/papers/PREM.pdf',
  dataTables: 'Table I (piecewise polynomials), Table II (central pressure 3638.521 kbar)',
  normalizedCoordinate: 'x = r / a, a = 6371 km',
  evidence: 'VERIFIED' as const
};

export interface PremLayerSpec {
  readonly id: string;
  readonly displayName: string;
  readonly radiusMinM: number;
  readonly radiusMaxM: number;
  /**
   * Коэффициенты ρ(x) = Σ c_k · x^k в г/см³, x = r / a, ПО СТРОГОМУ
   * переносу из Table I первоисточника (без пересчёта и округлений).
   */
  readonly densityPolyCoefficientsGcm3: readonly number[];
  readonly notes: string;
}

/**
 * Слои PREM Table I в порядке от центра к поверхности. Границы слоёв
 * (км, по первоисточнику): 0, 1221.5, 3480, 3630, 5600, 5701, 5771,
 * 5971, 6151, 6346.6, 6356, 6368, 6371.
 */
export const PREM_LAYERS: readonly PremLayerSpec[] = [
  {
    id: 'prem-inner-core',
    displayName: 'Внутреннее ядро (PREM Table I)',
    radiusMinM: 0,
    radiusMaxM: 1221500,
    densityPolyCoefficientsGcm3: [13.0885, 0, -8.8381],
    notes: 'Таблица I, слой до ICB 1221.5 км; полином по x = r/a.'
  },
  {
    id: 'prem-outer-core',
    displayName: 'Внешнее ядро (PREM Table I)',
    radiusMinM: 1221500,
    radiusMaxM: 3480000,
    densityPolyCoefficientsGcm3: [12.5815, -1.2638, -3.6426, -5.5281],
    notes: 'Таблица I, слой ICB-CMB (1221.5-3480 км).'
  },
  {
    id: 'prem-lower-mantle-dpp',
    displayName: 'Нижняя мантия, слой D″ (PREM Table I)',
    radiusMinM: 3480000,
    radiusMaxM: 3630000,
    densityPolyCoefficientsGcm3: [7.9565, -6.4761, 5.5283, -3.0807],
    notes: 'Таблица I, 3480-3630 км; тот же полином, что у слоёв 3630-5701 км.'
  },
  {
    id: 'prem-lower-mantle-main',
    displayName: 'Нижняя мантия, основная часть (PREM Table I)',
    radiusMinM: 3630000,
    radiusMaxM: 5600000,
    densityPolyCoefficientsGcm3: [7.9565, -6.4761, 5.5283, -3.0807],
    notes: 'Таблица I, 3630-5600 км.'
  },
  {
    id: 'prem-lower-mantle-top',
    displayName: 'Нижняя мантия, верхний слой (PREM Table I)',
    radiusMinM: 5600000,
    radiusMaxM: 5701000,
    densityPolyCoefficientsGcm3: [7.9565, -6.4761, 5.5283, -3.0807],
    notes: 'Таблица I, 5600-5701 км.'
  },
  {
    id: 'prem-transition-zone-1',
    displayName: 'Переходная зона, слой 5701-5771 км (PREM Table I)',
    radiusMinM: 5701000,
    radiusMaxM: 5771000,
    densityPolyCoefficientsGcm3: [5.3197, -1.4836],
    notes: 'Таблица I, 5701-5771 км.'
  },
  {
    id: 'prem-transition-zone-2',
    displayName: 'Переходная зона, слой 5771-5971 км (PREM Table I)',
    radiusMinM: 5771000,
    radiusMaxM: 5971000,
    densityPolyCoefficientsGcm3: [11.2494, -8.0298],
    notes: 'Таблица I, 5771-5971 км.'
  },
  {
    id: 'prem-lvz-lid-isotropic',
    displayName: 'LVZ+LID, гомогенизированный слой (PREM Table I)',
    radiusMinM: 5971000,
    radiusMaxM: 6151000,
    densityPolyCoefficientsGcm3: [7.1089, -3.8045],
    notes: 'Таблица I, 5971-6151 км. Изотропная запись: истинный PREM трансверсально-изотропен на 80-220 км (плотность не затронута).'
  },
  {
    id: 'prem-lid',
    displayName: 'LID (литосферная крышка, PREM Table I)',
    radiusMinM: 6151000,
    radiusMaxM: 6346600,
    densityPolyCoefficientsGcm3: [2.691, 0.6924],
    notes: 'Таблица I, 6151-6346.6 км.'
  },
  {
    id: 'prem-lower-crust',
    displayName: 'Нижняя кора (PREM Table I)',
    radiusMinM: 6346600,
    radiusMaxM: 6356000,
    densityPolyCoefficientsGcm3: [2.9],
    notes: 'Таблица I, 6346.6-6356 км; константная плотность.'
  },
  {
    id: 'prem-upper-crust',
    displayName: 'Верхняя кора (PREM Table I)',
    radiusMinM: 6356000,
    radiusMaxM: 6368000,
    densityPolyCoefficientsGcm3: [2.6],
    notes: 'Таблица I, 6356-6368 км; константная плотность.'
  },
  {
    id: 'prem-ocean',
    displayName: 'Океан (PREM Table I)',
    radiusMinM: 6368000,
    radiusMaxM: PREM_MEAN_RADIUS_M,
    densityPolyCoefficientsGcm3: [1.02],
    notes: 'Таблица I, 6368-6371 км; константная плотность океана.'
  }
];

/** Значение ρ(x) полинома слоя в г/см³ (схема Горнера). */
export function premDensityGcm3(x: number, coefficients: readonly number[]): number {
  let value = 0;
  for (let k = coefficients.length - 1; k >= 0; k--) {
    value = value * x + coefficients[k];
  }
  return value;
}

/** Плотность PREM кг/м³ по радиусу в метрах; null вне [0, a] и при нечисловом r. */
export function premDensityKgM3(radiusM: number): number | null {
  if (typeof radiusM !== 'number' || !Number.isFinite(radiusM)) return null;
  if (radiusM < 0 || radiusM > PREM_MEAN_RADIUS_M) return null;
  for (const layer of PREM_LAYERS) {
    if (radiusM <= layer.radiusMaxM) {
      const x = radiusM / PREM_MEAN_RADIUS_M;
      return premDensityGcm3(x, layer.densityPolyCoefficientsGcm3) * 1000;
    }
  }
  return null;
}

/**
 * Слоёвая модель PREM для гидростатического решателя (ядро Core,
 * зависимости Core → Data нет: Data определяет модель и вызывает solve).
 */
export function premHydrostaticLayers(): readonly HydrostaticLayer[] {
  return PREM_LAYERS.map((layer) => ({
    id: layer.id,
    displayName: layer.displayName,
    radiusMinM: layer.radiusMinM,
    radiusMaxM: layer.radiusMaxM,
    densityKgM3At: (radiusM: number): number => {
      const x = radiusM / PREM_MEAN_RADIUS_M;
      return premDensityGcm3(x, layer.densityPolyCoefficientsGcm3) * 1000;
    }
  }));
}

const PREM_CATALOG_SAMPLE_RATIOS = [0, 0.25, 0.5, 0.75, 1] as const;

/** Валидация каталога PREM: покрытие [0, a] без зазоров/пересечений, положительность плотности. */
export function validatePremCatalog(): readonly string[] {
  const issues: string[] = [];
  if (PREM_LAYERS.length === 0) {
    issues.push('каталог PREM пуст');
    return issues;
  }
  let cursor = 0;
  for (const layer of PREM_LAYERS) {
    if (layer.radiusMinM !== cursor) {
      issues.push(
        `слой ${layer.id}: начало ${layer.radiusMinM} м не совпадает с курсором ${cursor} м (зазор или пересечение)`
      );
    }
    if (layer.radiusMaxM <= layer.radiusMinM) {
      issues.push(`слой ${layer.id}: нулевая или отрицательная толщина`);
    }
    for (const s of PREM_CATALOG_SAMPLE_RATIOS) {
      const r = layer.radiusMinM + s * (layer.radiusMaxM - layer.radiusMinM);
      const x = r / PREM_MEAN_RADIUS_M;
      const rho = premDensityGcm3(x, layer.densityPolyCoefficientsGcm3) * 1000;
      if (!Number.isFinite(rho) || rho <= 0) {
        issues.push(`слой ${layer.id}: некорректная плотность ${String(rho)} kg/m³ при r = ${r} м`);
      }
    }
    cursor = layer.radiusMaxM;
  }
  if (cursor !== PREM_MEAN_RADIUS_M) {
    issues.push(`каталог PREM покрывает 0-${cursor} м, ожидается 0-${PREM_MEAN_RATIO_EXPECTED_M} м`);
  }
  return issues;
}

// Вспомогательная константа сообщения о неполном покрытии (см. validatePremCatalog).
const PREM_MEAN_RATIO_EXPECTED_M = PREM_MEAN_RADIUS_M;

/**
 * Гидростатическая реконструкция PREM (dm/dr = 4πr²ρ, dP/dr = −Gmρ/r²).
 * Возвращает статус решателя; ЭТО НЕ EOS-предсказание.
 */
export function solvePremHydrostaticInterior(
  options?: HydrostaticSolverOptions
): HydrostaticInteriorResult {
  const catalogIssues = validatePremCatalog();
  if (catalogIssues.length > 0) {
    return { status: 'numerical_failure', reason: 'каталог PREM не валиден', stage: 'catalog_validation' };
  }
  return solveHydrostaticInterior(premHydrostaticLayers(), options, {
    sourceName: PREM_REFERENCE_SOURCE.sourceName,
    sourceDetail:
      'PREM: Dziewonski & Anderson (1981), DOI 10.1016/0031-9201(81)90046-7, Table I. ' +
      'Гидростатическая реконструкция по заданному профилю плотности, НЕ EOS-предсказание.'
  });
}
