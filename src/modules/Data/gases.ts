// ============================================
// GASES - Химические вещества для атмосферы
// ============================================

import type { GasSpecies } from '../../types';

const gases: GasSpecies[] = [
  {
    id: 'ch4',
    formula: 'CH₄',
    name: 'Метан',
    molarMass: 16.04,
    aggregateStates: ['gas', 'liquid', 'solid'],
    sources: ['Volcanic outgassing', 'Biological production', 'Hydrothermal vents'],
    sinks: ['Photochemical oxidation', 'Escape to space', 'Surface reactions'],
    participatingReactions: ['ch4_oxidation'],
    scientificComments: 'Основной компонент атмосфер газовых гигантов и некоторых землеподобных планет. Парниковый газ.',
    baseWeight: 1,
    tags: ['hydrocarbon', 'greenhouse', 'organic']
  },
  {
    id: 'n2',
    formula: 'N₂',
    name: 'Азот',
    molarMass: 28.02,
    aggregateStates: ['gas', 'liquid'],
    sources: ['Volcanic outgassing', 'Biological nitrogen fixation'],
    sinks: ['Biological uptake', 'Photochemical reactions', 'Escape to space'],
    participatingReactions: [],
    scientificComments: 'Инертный газ, основной компонент земной атмосферы. Важен для биологических процессов.',
    baseWeight: 1,
    tags: ['inert', 'atmospheric', 'biogenic']
  },
  {
    id: 'c2h6',
    formula: 'C₂H₆',
    name: 'Этан',
    molarMass: 30.07,
    aggregateStates: ['gas', 'liquid', 'solid'],
    sources: ['Hydrothermal synthesis', 'Photochemical reactions', 'Biological production'],
    sinks: ['Photochemical oxidation', 'Escape to space', 'Condensation'],
    participatingReactions: ['c2h6_oxidation'],
    scientificComments: 'Второй по распространенности углеводород в атмосферах газовых гигантов.',
    baseWeight: 1,
    tags: ['hydrocarbon', 'greenhouse', 'organic']
  },
  {
    id: 'h2',
    formula: 'H₂',
    name: 'Водород',
    molarMass: 2.016,
    aggregateStates: ['gas', 'liquid'],
    sources: ['Volcanic outgassing', 'Photodissociation of water', 'Primitive atmosphere retention'],
    sinks: ['Escape to space', 'Chemical reactions', 'Jeans escape'],
    participatingReactions: ['h2_oxidation'],
    scientificComments: 'Самый легкий и распространенный элемент во Вселенной. Легко теряется планетами с низкой гравитацией.',
    baseWeight: 1,
    tags: ['light', 'primordial', 'reactive']
  },
  {
    id: 'nh3',
    formula: 'NH₃',
    name: 'Аммиак',
    molarMass: 17.03,
    aggregateStates: ['gas', 'liquid', 'solid'],
    sources: ['Volcanic outgassing', 'Biological production', 'Hydrothermal synthesis'],
    sinks: ['Photochemical decomposition', 'Surface deposition', 'Chemical reactions'],
    participatingReactions: [],
    scientificComments: 'Важный источник азота для биологических процессов. Ядовит в высоких концентрациях.',
    baseWeight: 1,
    tags: ['nitrogen', 'toxic', 'basic']
  },
  {
    id: 'co',
    formula: 'CO',
    name: 'Угарный газ',
    molarMass: 28.01,
    aggregateStates: ['gas'],
    sources: ['Volcanic outgassing', 'Photochemical reactions', 'Incomplete combustion'],
    sinks: ['Photochemical oxidation', 'Surface reactions', 'Biological uptake'],
    participatingReactions: ['co_oxidation'],
    scientificComments: 'Ядовитый газ, важный в атмосферной химии. Может быть маркером вулканической активности.',
    baseWeight: 1,
    tags: ['toxic', 'carbon', 'reactive']
  },
  {
    id: 'co2',
    formula: 'CO₂',
    name: 'Углекислый газ',
    molarMass: 44.01,
    aggregateStates: ['gas', 'solid'],
    sources: ['Volcanic outgassing', 'Respiration', 'Combustion', 'Weathering'],
    sinks: ['Photosynthesis', 'Carbonate formation', 'Atmospheric escape', 'Ocean absorption'],
    participatingReactions: ['ch4_oxidation', 'c2h6_oxidation', 'co_oxidation'],
    scientificComments: 'Важный парниковый газ. Основной компонент атмосферы Венеры и Марса.',
    baseWeight: 1,
    tags: ['greenhouse', 'carbon', 'acidic']
  },
  {
    id: 'h2o',
    formula: 'H₂O',
    name: 'Водяной пар',
    molarMass: 18.015,
    aggregateStates: ['gas', 'liquid', 'solid'],
    sources: ['Evaporation', 'Volcanic outgassing', 'Sublimation'],
    sinks: ['Condensation', 'Precipitation', 'Photodissociation', 'Escape to space'],
    participatingReactions: ['ch4_oxidation', 'c2h6_oxidation', 'h2_oxidation'],
    scientificComments: 'Ключевой компонент для жизни. Важный парниковый газ.',
    baseWeight: 1,
    tags: ['water', 'greenhouse', 'polar']
  },
  {
    id: 'he',
    formula: 'He',
    name: 'Гелий',
    molarMass: 4.0026,
    aggregateStates: ['gas', 'liquid'],
    sources: ['Radioactive decay', 'Primitive atmosphere', 'Solar wind'],
    sinks: ['Escape to space', 'Diffusion through atmosphere'],
    participatingReactions: [],
    scientificComments: 'Инертный газ. Основной компонент атмосфер газовых гигантов. Легко теряется планетами.',
    baseWeight: 1,
    tags: ['noble_gas', 'inert', 'light']
  },
  {
    id: 'ar',
    formula: 'Ar',
    name: 'Аргон',
    molarMass: 39.948,
    aggregateStates: ['gas', 'liquid'],
    sources: ['Radioactive decay (K-40)', 'Primitive atmosphere'],
    sinks: ['Escape to space (slow)'],
    participatingReactions: [],
    scientificComments: 'Инертный газ. Накапливается в атмосферах планет с течением времени.',
    baseWeight: 1,
    tags: ['noble_gas', 'inert', 'accumulating']
  },
  {
    id: 'ne',
    formula: 'Ne',
    name: 'Неон',
    molarMass: 20.18,
    aggregateStates: ['gas', 'liquid'],
    sources: ['Primitive atmosphere', 'Solar wind'],
    sinks: ['Escape to space'],
    participatingReactions: [],
    scientificComments: 'Инертный газ. Редко встречается в планетарных атмосферах.',
    baseWeight: 1,
    tags: ['noble_gas', 'inert', 'rare']
  },
  {
    id: 'o2',
    formula: 'O₂',
    name: 'Свободный кислород',
    molarMass: 32.00,
    aggregateStates: ['gas', 'liquid', 'solid'],
    sources: ['Photosynthesis', 'Photodissociation of water'],
    sinks: ['Respiration', 'Oxidation reactions', 'Surface reactions'],
    participatingReactions: ['ch4_oxidation', 'c2h6_oxidation', 'h2_oxidation', 'co_oxidation'],
    scientificComments: 'Высоко реактивный газ. В больших количествах является маркером биологической активности.',
    baseWeight: 1,
    tags: ['reactive', 'biogenic', 'oxidizing']
  }
];

export default gases;
