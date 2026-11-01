// ============================================
// ENERGY BALANCE - Энергетический бюджет планетарной системы
// ============================================
//
// Связывает орбитальную конфигурацию и физическую модель
// центрального объекта с падающим потоком и равновесной
// температурой:
//   F = L / (4πa²)
//   T_eq = [F(1-A)·f / (4εσ)]^(1/4)
//
// Все допущения модели (альбедо, эмиссивность, перераспределение
// тепла) фиксируются явно. Равновесная температура НЕ отождествляется
// с температурой поверхности: парниковая модель не реализована.

import type {
  CentralObjectSystem,
  OrbitalConfigurationData,
  GeologicalAnalysis,
  EnergyBudgetModel,
  PhysValue
} from '../../types';
import { getRepresentativeLuminosityW } from '../Data/starPhysical';
import { incidentFlux, equilibriumTemperature } from '../OrbitalMechanics';

export interface EnergyBudgetInput {
  /** id центрального объекта каталога (для репрезентативной светимости класса) */
  centralObjectId: string;
  centralObjectSystem?: CentralObjectSystem;
  orbit?: OrbitalConfigurationData;
  geologyAnalysis?: GeologicalAnalysis;
}

/** Допущения базовой модели равновесной температуры. */
export const ENERGY_BUDGET_ASSUMPTIONS = [
  'альбедо Бонда A = 0.3 — грубое типичное допущение, а не измерение конкретной планеты',
  'эмиссивность ε = 1 (излучение поверхности считается абсолютно серым телом)',
  'тепло перераспределяется равномерно по всей поверхности (f = 1)',
  'светимость центрального объекта — репрезентативная середина диапазона класса, а не конкретная звезда',
  'T_eq НЕ равна температуре поверхности: парниковая модель не реализована'
];

/**
 * Расчёт энергетического бюджета системы.
 * Если светимость класса или орбитальное расстояние неизвестны —
 * поток и T_eq остаются null (unknown), а не выдумываются.
 */
export function computeEnergyBudget(input: EnergyBudgetInput): EnergyBudgetModel {
  const { centralObjectId, orbit, geologyAnalysis } = input;

  const luminosityW = getRepresentativeLuminosityW(centralObjectId);
  // Освещение луны рассчитывается отдельно от её орбиты: большая
  // полуось спутниковой орбиты — это расстояние до РОДИТЕЛЬСКОЙ
  // планеты, а не до звезды, и подставлять её в F = L/(4πa²)
  // физически неверно. Расстояние от звезды до системы
  // «родительская планета — спутник» в текущей модели неизвестно,
  // поэтому поток не определяется (null), а не выдумывается.
  const isMoonSystem = orbit?.frame === 'around_parent_body';
  const semiMajorAxisM = isMoonSystem ? null : (orbit?.semiMajorAxis?.value ?? null);
  const flux = incidentFlux(luminosityW, semiMajorAxisM);

  const incidentFluxValue: PhysValue =
    flux === null
      ? {
          value: null,
          unit: 'Вт/м²',
          confidence: 'unknown',
          method: 'поток не определяется без светимости и расстояния',
          note:
            luminosityW === null
              ? 'светимость класса недоступна (аккреция/джет/свободное плавание) — поток не рассчитан, а не приравнен к нулю'
              : isMoonSystem
                ? 'спутниковая орбита задана вокруг родительской планеты: расстояние системы от звезды не моделируется — поток не рассчитан'
                : 'орбитальное расстояние неизвестно — поток не рассчитан'
        }
      : {
          value: flux,
          unit: 'Вт/м²',
          confidence: 'estimated',
          method: 'F = L / (4πa²), где L — репрезентативная светимость класса',
          formula: 'F = L / (4πa²)',
          parameters: {
            'L (Вт)': luminosityW as number,
            'a (м)': semiMajorAxisM as number
          },
          uncertainty: 'светимость конкретного объекта неизвестна; использована середина диапазона класса'
        };

  const tEq = equilibriumTemperature(flux);
  const equilibriumTemperatureValue: PhysValue =
    tEq === null
      ? {
          value: null,
          unit: 'K',
          confidence: 'unknown',
          method: 'равновесная температура не определяется без энергетического потока',
          note: 'T_eq не рассчитана; подстановка произвольной температуры запрещена'
        }
      : {
          value: tEq,
          unit: 'K',
          confidence: 'estimated',
          method: 'T_eq = [F(1-A)·f / (4εσ)]^(1/4) при A=0.3, f=1, ε=1',
          formula: 'T_eq = [F(1-A)·f / (4εσ)]^(1/4)',
          parameters: { 'A (альбедо Бонда)': 0.3, f: 1, ε: 1 },
          uncertainty: 'равновесная температура чувствительна к альбедо и перераспределению тепла',
          applicability: 'T_eq ≠ T_surface: парниковый эффект, облачность и теплоёмкость не учтены'
        };

  const internalHeatLevel: EnergyBudgetModel['internalHeatLevel'] =
    geologyAnalysis?.totalInternalHeat ?? 'unknown';

  return {
    incidentFlux: incidentFluxValue,
    equilibriumTemperature: equilibriumTemperatureValue,
    greenhouseNote:
      'T_eq — радиационная равновесная температура без атмосферы. Температура поверхности требует ' +
      'парниковой модели (состав, давление, облачность) и на данном этапе НЕ вычисляется: ' +
      'она остаётся неизвестной или оценкой с явными допущениями.',
    assumptions: [...ENERGY_BUDGET_ASSUMPTIONS],
    internalHeatLevel,
    notes: [
      'внутреннее тепловыделение не влияет на T_eq модели: вклад недр в поверхностный баланс не рассчитывается',
      internalHeatLevel === 'unknown'
        ? 'анализ геологии недоступен — внутренний тепловой уровень неизвестен'
        : `уровень внутреннего тепла: ${internalHeatLevel} (см. geologyAnalysis)`
    ]
  };
}

export default { computeEnergyBudget, ENERGY_BUDGET_ASSUMPTIONS };
