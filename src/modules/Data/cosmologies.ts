// ============================================
// COSMOLOGIES - Космологические концепции
// ============================================

import type { CosmologyOption } from '../../types';

const cosmologies: CosmologyOption[] = [
  {
    id: 'big_bang',
    name: 'Большой взрыв',
    description: 'Стандартная космологическая модель, предполагающая расширение Вселенной из плотного и горячего начального состояния.',
    baseWeight: 1,
    tags: ['standard', 'scientific', 'expanding_universe'],
    isAnomalous: false,
    compatibilityInfo: 'Совместима со всеми стандартными физическими законами. Подходит для всех возрастов вселенной.',
    scientificStatus: 'established_fact',
    specialRules: [],
    generationImpact: 'Определяет стандартные физические константы и эволюцию вселенной.'
  },
  {
    id: 'quantum_fluctuation',
    name: 'Квантовая флуктуация',
    description: 'Вселенная возникла как квантовая флуктуация в вакууме или мультивселенной.',
    baseWeight: 1,
    tags: ['quantum', 'multiverse', 'hypothetical'],
    isAnomalous: false,
    compatibilityInfo: 'Совместима со стандартной физикой, но требует наличия квантового вакуума.',
    scientificStatus: 'hypothetical',
    specialRules: [],
    generationImpact: 'Может подразумевать существование других вселенных.'
  },
  {
    id: 'branes',
    name: 'Браны',
    description: 'Вселенная существует на бране в многомерном пространстве (теория струн).',
    baseWeight: 1,
    tags: ['string_theory', 'extra_dimensions', 'theoretical'],
    isAnomalous: false,
    compatibilityInfo: 'Совместима со стандартной физикой в пределах браны.',
    scientificStatus: 'hypothetical',
    specialRules: [],
    generationImpact: 'Могут существовать дополнительные измерения и взаимодействия между бранами.'
  },
  {
    id: 'false_vacuum',
    name: 'Ложный вакуум',
    description: 'Вселенная возникла в результате распада ложного вакуума в истинный.',
    baseWeight: 1,
    tags: ['quantum_field', 'vacuum_decay', 'theoretical'],
    isAnomalous: false,
    compatibilityInfo: 'Совместима со стандартной квантовой теорией поля.',
    scientificStatus: 'hypothetical',
    specialRules: [],
    generationImpact: 'Может подразумевать нестабильность вакуума и возможный распад.'
  },
  {
    id: 'world_as_body',
    name: 'Мир как тело',
    description: 'Вселенная является живым организмом или телом некой сущности.',
    baseWeight: 1,
    tags: ['anomalous', 'organic', 'philosophical'],
    isAnomalous: true,
    compatibilityInfo: 'Несовместима со стандартной физикой. Требует специальных правил.',
    scientificStatus: 'anomalous_rule',
    specialRules: [
      'Физические законы могут быть адаптированы под биологические аналогии',
      'Вселенная может иметь "органы" и "системы"',
      'Время может быть цикличным или линейным в зависимости от "физиологии"'
    ],
    generationImpact: 'Физические параметры интерпретируются как биологические характеристики.'
  },
  {
    id: 'dream',
    name: 'Сон',
    description: 'Вселенная является сном некой сущности или коллективным сновидением.',
    baseWeight: 1,
    tags: ['anomalous', 'subjective', 'psychological'],
    isAnomalous: true,
    compatibilityInfo: 'Несовместима со стандартной физикой. Законы реальности могут быть нестабильны.',
    scientificStatus: 'anomalous_rule',
    specialRules: [
      'Физические законы могут изменяться',
      'Время и пространство могут быть нелинейны',
      'События могут зависеть от наблюдения или веры'
    ],
    generationImpact: 'Параметры мира могут изменяться спонтанно или под воздействием "сновидца".'
  },
  {
    id: 'world_axis',
    name: 'Ось Мира',
    description: 'Вселенная структурирована вокруг центральной оси или дерева.',
    baseWeight: 1,
    tags: ['mythological', 'cosmic_structure', 'hierarchical'],
    isAnomalous: false,
    compatibilityInfo: 'Может быть совместима со стандартной физикой при соответствующей интерпретации.',
    scientificStatus: 'hypothetical',
    specialRules: [],
    generationImpact: 'Пространство может иметь иерархическую структуру.'
  },
  {
    id: 'simulation',
    name: 'Симуляция',
    description: 'Вселенная является компьютерной симуляцией, созданной некой цивилизацией.',
    baseWeight: 1,
    tags: ['anomalous', 'digital', 'artificial'],
    isAnomalous: true,
    compatibilityInfo: 'Несовместима со стандартной физикой. Законы ограничены вычислительными ресурсами.',
    scientificStatus: 'anomalous_rule',
    specialRules: [
      'Физические константы могут быть "настроены"',
      'Может существовать "пикселизация" на малых масштабах',
      'Время может дискретизироваться',
      'Вычислительные ограничения могут влиять на физические процессы'
    ],
    generationImpact: 'Физические параметры ограничены вычислительными ресурсами симуляции.'
  },
  {
    id: 'cyclic_universe',
    name: 'Циклическая вселенная',
    description: 'Вселенная проходит через бесконечные циклы расширения и сжатия.',
    baseWeight: 1,
    tags: ['cyclic', 'big_bounce', 'cosmological'],
    isAnomalous: false,
    compatibilityInfo: 'Совместима со стандартной физикой при соответствующих условиях.',
    scientificStatus: 'hypothetical',
    specialRules: [],
    generationImpact: 'Возраст вселенной может интерпретироваться как время текущего цикла.'
  },
  {
    id: 'monster_imprisonment',
    name: 'Пленение Чудовища',
    description: 'Вселенная создана для удержания или изоляции некой могущественной сущности.',
    baseWeight: 1,
    tags: ['anomalous', 'confinement', 'mythological'],
    isAnomalous: true,
    compatibilityInfo: 'Несовместима со стандартной физикой. Физические законы могут быть "настроены" для удержания.',
    scientificStatus: 'anomalous_rule',
    specialRules: [
      'Физические законы могут ограничивать Чудовище',
      'Вселенная может иметь "границы" или "барьеры"',
      'Энергия и материя могут быть ограничены'
    ],
    generationImpact: 'Физические параметры оптимизированы для удержания Чудовища.'
  }
];

export default cosmologies;
