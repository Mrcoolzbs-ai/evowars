// ============================================
// EPOCHS - Возрастные эпохи вселенной
// ============================================

import type { EpochOption } from '../../types';

const epochs: EpochOption[] = [
  {
    id: 'first_water_era',
    name: 'Эра Первой Воды',
    ageRange: { min: 2, max: 4 },
    description: 'Ранний период формирования звезд и планет, когда вода начинает играть значительную роль в химических процессах.',
    baseWeight: 1,
    tags: ['early', 'water_formation', 'star_formation'],
    scientificStatus: 'physically_plausible',
    compatibilityNotes: 'Подходит для формирования первых звезд и планетных систем. Вода может существовать в виде льда или пара.'
  },
  {
    id: 'golden_middle',
    name: 'Золотая Середина',
    ageRange: { min: 5, max: 9 },
    description: 'Пик звездообразования и формирования сложных молекул. Оптимальный период для возникновения жизни.',
    baseWeight: 1,
    tags: ['optimal', 'life_potential', 'mature'],
    scientificStatus: 'physically_plausible',
    compatibilityNotes: 'Идеальный возраст для формирования обитаемых планет и сложных химических соединений.'
  },
  {
    id: 'ancient_cosmos',
    name: 'Древний Космос',
    ageRange: { min: 11, max: 13.8 },
    description: 'Поздний период эволюции вселенной, когда многие звезды уже прошли свой жизненный цикл.',
    baseWeight: 1,
    tags: ['late', 'stellar_evolution', 'aging'],
    scientificStatus: 'physically_plausible',
    compatibilityNotes: 'Подходит для старых звездных систем, белых карликов, нейтронных звезд и черных дыр.'
  }
];

export default epochs;
