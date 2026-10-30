// ============================================
// PHASE PROPERTIES - Фазовые свойства веществ
// ============================================
//
// Метаданные фазового поведения атмосферных компонентов:
// критические точки, тройные точки, нормальные точки кипения
// и коэффициенты уравнения Антуана.
//
// Коэффициенты Антуана для метана и этана взяты из
// NIST Chemistry WebBook (ссылки указаны в записях) вместе
// с экспериментальным диапазоном применимости каждого набора.
//
// Уравнение: log10(P) = A − B / (T + C), где P — давление
// насыщенного пара в барах, T — температура в Кельвинах
// (форма NIST, см. поля pressureUnit и correlation).
//
// Для остальных веществ корреляции Антуана не хранятся:
// состояние определяется по критическим точкам или остаётся
// неизвестным — давление насыщенного пара НЕ выдумывается.

import type { ScientificConfidence } from '../../types';

export interface AntoineSet {
  A: number;
  B: number;
  C: number;
  /** Экспериментальный диапазон применимости, K */
  tempRangeK: { min: number; max: number };
  /** Единица выходного давления корреляции */
  pressureUnit: 'bar';
  /** Название корреляции */
  correlation: string;
  /** Библиографическая ссылка на источник коэффициентов */
  reference: string;
  /** Ссылка на источник коэффициентов */
  sourceUrl: string;
}

export interface PhaseProperties {
  gasId: string;
  formula: string;
  name: string;
  confidence: ScientificConfidence;
  criticalPoint: { temperatureK: number; pressureBar: number } | null;
  triplePoint: { temperatureK: number; pressureBar: number } | null;
  /** Нормальная точка кипения при 1 атм, K (null для CO₂ — сублимация) */
  normalBoilingPointK: number | null;
  antoine: AntoineSet[];
  source: string;
  note?: string;
}

const CRITICAL_SOURCE =
  'критические точки — стандартные справочные данные (NIST Chemistry WebBook, Phase change data)';

// Метан CH₄: Antoine из NIST Chemistry WebBook.
// https://webbook.nist.gov/cgi/cbook.cgi?ID=C74828&Type=ANTOINE
const methaneAntoine: AntoineSet[] = [
  {
    A: 3.9895,
    B: 443.028,
    C: -0.49,
    tempRangeK: { min: 90.99, max: 189.99 },
    pressureUnit: 'bar',
    correlation: 'log10(P/bar) = A − B/(T + C)',
    reference:
      'Prydz, R.; Goodwin, R.D. Experimental Melting and Vapor Pressures of Methane. ' +
      'J. Chem. Thermodyn., 1972, 4, 127-133 (коэффициенты рассчитаны NIST по данным авторов)',
    sourceUrl: 'https://webbook.nist.gov/cgi/cbook.cgi?ID=C74828&Type=ANTOINE'
  }
];

// Этан C₂H₆: два набора Antoine из NIST Chemistry WebBook.
// https://webbook.nist.gov/cgi/cbook.cgi?ID=C74840&Type=ANTOINE
const ethaneAntoine: AntoineSet[] = [
  {
    A: 4.50706,
    B: 791.3,
    C: -6.422,
    tempRangeK: { min: 91.33, max: 144.13 },
    pressureUnit: 'bar',
    correlation: 'log10(P/bar) = A − B/(T + C)',
    reference:
      'Carruth, G.F.; Kobayashi, R. Vapor pressure of normal paraffins ethane through n-decane... ' +
      'J. Chem. Eng. Data, 1973, 18, 115-126 (коэффициенты рассчитаны NIST по данным авторов)',
    sourceUrl: 'https://webbook.nist.gov/cgi/cbook.cgi?ID=C74840&Type=ANTOINE'
  },
  {
    A: 3.93835,
    B: 659.739,
    C: -16.719,
    tempRangeK: { min: 135.74, max: 199.91 },
    pressureUnit: 'bar',
    correlation: 'log10(P/bar) = A − B/(T + C)',
    reference:
      'Loomis, A.G.; Walters, J.E. The Vapor Pressure of Ethane Near the Normal Boiling Point. ' +
      'J. Am. Chem. Soc., 1926, 48, 2051-2055 (коэффициенты рассчитаны NIST по данным авторов)',
    sourceUrl: 'https://webbook.nist.gov/cgi/cbook.cgi?ID=C74840&Type=ANTOINE'
  }
];

const phaseProperties: Record<string, PhaseProperties> = {
  ch4: {
    gasId: 'ch4',
    formula: 'CH₄',
    name: 'Метан',
    confidence: 'established',
    criticalPoint: { temperatureK: 190.56, pressureBar: 45.99 },
    triplePoint: { temperatureK: 90.69, pressureBar: 0.117 },
    normalBoilingPointK: 111.66,
    antoine: methaneAntoine,
    source: `${CRITICAL_SOURCE}; Antoine: NIST Chemistry WebBook (C74828), Prydz & Goodwin, 1972`
  },
  c2h6: {
    gasId: 'c2h6',
    formula: 'C₂H₆',
    name: 'Этан',
    confidence: 'established',
    criticalPoint: { temperatureK: 305.32, pressureBar: 48.72 },
    triplePoint: null,
    normalBoilingPointK: 184.55,
    antoine: ethaneAntoine,
    source: `${CRITICAL_SOURCE}; Antoine: NIST Chemistry WebBook (C74840), Carruth & Kobayashi 1973 и Loomis & Walters 1926`,
    note: 'Тройная точка этана в наборе данных не хранится; ниже диапазона корреляций состояние оценивается только по критической точке.'
  },
  n2: {
    gasId: 'n2',
    formula: 'N₂',
    name: 'Азот',
    confidence: 'established',
    criticalPoint: { temperatureK: 126.21, pressureBar: 33.98 },
    triplePoint: { temperatureK: 63.15, pressureBar: 0.1253 },
    normalBoilingPointK: 77.36,
    antoine: [],
    source: CRITICAL_SOURCE,
    note: 'Корреляция давления насыщенного пара не хранится; ниже критической температуры состояние остаётся неизвестным, если не задано.'
  },
  co2: {
    gasId: 'co2',
    formula: 'CO₂',
    name: 'Углекислый газ',
    confidence: 'established',
    criticalPoint: { temperatureK: 304.13, pressureBar: 73.8 },
    triplePoint: { temperatureK: 216.59, pressureBar: 5.185 },
    normalBoilingPointK: null,
    antoine: [],
    source: CRITICAL_SOURCE,
    note: 'При 1 атм CO₂ сублимируется (~194.7 K): жидкая фаза существует только под давлением выше тройной точки.'
  },
  h2o: {
    gasId: 'h2o',
    formula: 'H₂O',
    name: 'Водяной пар',
    confidence: 'established',
    criticalPoint: { temperatureK: 647.1, pressureBar: 220.64 },
    triplePoint: { temperatureK: 273.16, pressureBar: 0.00612 },
    normalBoilingPointK: 373.12,
    antoine: [],
    source: CRITICAL_SOURCE,
    note: 'Корреляция давления насыщенного пара воды не входит в набор данных этапа; конденсация пара оценивается только по критической точке.'
  },
  nh3: {
    gasId: 'nh3',
    formula: 'NH₃',
    name: 'Аммиак',
    confidence: 'established',
    criticalPoint: { temperatureK: 405.4, pressureBar: 113.5 },
    triplePoint: { temperatureK: 195.4, pressureBar: 0.0607 },
    normalBoilingPointK: 239.82,
    antoine: [],
    source: CRITICAL_SOURCE
  },
  co: {
    gasId: 'co',
    formula: 'CO',
    name: 'Угарный газ',
    confidence: 'established',
    criticalPoint: { temperatureK: 132.86, pressureBar: 34.99 },
    triplePoint: { temperatureK: 68.16, pressureBar: 0.1535 },
    normalBoilingPointK: 81.64,
    antoine: [],
    source: CRITICAL_SOURCE
  },
  h2: {
    gasId: 'h2',
    formula: 'H₂',
    name: 'Водород',
    confidence: 'established',
    criticalPoint: { temperatureK: 33.19, pressureBar: 13.13 },
    triplePoint: { temperatureK: 13.96, pressureBar: 0.072 },
    normalBoilingPointK: 20.28,
    antoine: [],
    source: CRITICAL_SOURCE
  },
  o2: {
    gasId: 'o2',
    formula: 'O₂',
    name: 'Кислород',
    confidence: 'established',
    criticalPoint: { temperatureK: 154.58, pressureBar: 50.43 },
    triplePoint: { temperatureK: 54.36, pressureBar: 0.0015 },
    normalBoilingPointK: 90.19,
    antoine: [],
    source: CRITICAL_SOURCE
  },
  so2: {
    gasId: 'so2',
    formula: 'SO₂',
    name: 'Диоксид серы',
    confidence: 'established',
    criticalPoint: { temperatureK: 430.8, pressureBar: 78.8 },
    triplePoint: null,
    normalBoilingPointK: 263.1,
    antoine: [],
    source: CRITICAL_SOURCE,
    note: 'Тройная точка в наборе данных не хранится.'
  },
  ar: {
    gasId: 'ar',
    formula: 'Ar',
    name: 'Аргон',
    confidence: 'established',
    criticalPoint: { temperatureK: 150.86, pressureBar: 48.98 },
    triplePoint: { temperatureK: 83.81, pressureBar: 0.6889 },
    normalBoilingPointK: 87.3,
    antoine: [],
    source: CRITICAL_SOURCE
  },
  ne: {
    gasId: 'ne',
    formula: 'Ne',
    name: 'Неон',
    confidence: 'established',
    criticalPoint: { temperatureK: 44.4, pressureBar: 26.8 },
    triplePoint: { temperatureK: 24.56, pressureBar: 0.4332 },
    normalBoilingPointK: 27.1,
    antoine: [],
    source: CRITICAL_SOURCE
  },
  he: {
    gasId: 'he',
    formula: 'He',
    name: 'Гелий',
    confidence: 'established',
    criticalPoint: { temperatureK: 5.2, pressureBar: 2.27 },
    triplePoint: null,
    normalBoilingPointK: 4.22,
    antoine: [],
    source: CRITICAL_SOURCE,
    note: 'При низких давлениях жидкий гелий не замерзает; классической тройной точки (жидкость–газ–твёрдое) при 1 атм нет.'
  }
  // 'unidentified' намеренно отсутствует: состав неизвестен,
  // фазовое состояние не определяется.
};

/**
 * Получить фазовые свойства вещества по gasId.
 * null — данных нет (вещество неизвестно модели).
 */
export function getPhaseProperties(gasId: string): PhaseProperties | null {
  return phaseProperties[gasId] ?? null;
}

export default phaseProperties;
