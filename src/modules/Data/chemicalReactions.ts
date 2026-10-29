// ============================================
// CHEMICAL REACTIONS - Химические реакции для атмосферной модели
// ============================================

import type { ChemicalReaction } from '../../types';

const chemicalReactions: ChemicalReaction[] = [
  {
    id: 'ch4_oxidation',
    name: 'Окисление метана',
    reactants: [
      { gasId: 'ch4', coefficient: 1 },
      { gasId: 'o2', coefficient: 2 }
    ],
    products: [
      { gasId: 'co2', coefficient: 1 },
      { gasId: 'h2o', coefficient: 2 }
    ],
    conditions: ['Presence of oxygen', 'Catalyst or high temperature', 'Photochemical initiation possible'],
    uncertaintySources: ['Reaction rate depends on temperature and catalysts', 'Photochemical pathways may differ'],
    gameSpeedCoefficient: 0.1,
    allowedRanges: {
      temperature: { min: 300, max: 2000 },
      pressure: { min: 0.1, max: 100 }
    },
    comments: 'Суммарная реакция. В реальности происходит через промежуточные радикалы.',
    isPhotochemical: false,
    isBiological: false
  },
  {
    id: 'c2h6_oxidation',
    name: 'Окисление этана',
    reactants: [
      { gasId: 'c2h6', coefficient: 1 },
      { gasId: 'o2', coefficient: 3.5 }
    ],
    products: [
      { gasId: 'co2', coefficient: 2 },
      { gasId: 'h2o', coefficient: 3 }
    ],
    conditions: ['Presence of oxygen', 'Catalyst or high temperature', 'Photochemical initiation possible'],
    uncertaintySources: ['Reaction rate depends on temperature and catalysts', 'Partial oxidation possible'],
    gameSpeedCoefficient: 0.05,
    allowedRanges: {
      temperature: { min: 400, max: 2000 },
      pressure: { min: 0.1, max: 100 }
    },
    comments: 'Суммарная реакция. В реальности может проходить через промежуточные продукты.',
    isPhotochemical: false,
    isBiological: false
  },
  {
    id: 'h2_oxidation',
    name: 'Окисление водорода',
    reactants: [
      { gasId: 'h2', coefficient: 1 },
      { gasId: 'o2', coefficient: 0.5 }
    ],
    products: [
      { gasId: 'h2o', coefficient: 1 }
    ],
    conditions: ['Presence of oxygen', 'Catalyst or spark', 'High temperature'],
    uncertaintySources: ['Reaction can be explosive under certain conditions', 'Rate depends on temperature and pressure'],
    gameSpeedCoefficient: 0.5,
    allowedRanges: {
      temperature: { min: 500, max: 3000 },
      pressure: { min: 0.1, max: 50 }
    },
    comments: 'Экзотермическая реакция. В атмосферах может происходить медленно без катализаторов.',
    isPhotochemical: false,
    isBiological: false
  },
  {
    id: 'co_oxidation',
    name: 'Окисление угарного газа',
    reactants: [
      { gasId: 'co', coefficient: 1 },
      { gasId: 'o2', coefficient: 0.5 }
    ],
    products: [
      { gasId: 'co2', coefficient: 1 }
    ],
    conditions: ['Presence of oxygen', 'Catalyst possible'],
    uncertaintySources: ['Reaction rate varies widely', 'Can occur photochemically'],
    gameSpeedCoefficient: 0.2,
    allowedRanges: {
      temperature: { min: 200, max: 2000 },
      pressure: { min: 0.1, max: 100 }
    },
    comments: 'Важная реакция в атмосферной химии. Может катализироваться металлами.',
    isPhotochemical: true,
    isBiological: false
  }
];

export default chemicalReactions;
