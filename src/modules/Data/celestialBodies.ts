// ============================================
// CELESTIAL BODIES - Типы небесных тел
// ============================================

import type { CelestialBodyOption } from '../../types';

const celestialBodies: CelestialBodyOption[] = [
  {
    id: 'small_planet',
    name: 'Маленькая планета',
    bodyType: 'planet',
    sizeClass: 'tiny',
    gravityDescription: 'Низкая гравитация (0.1-0.5g)',
    geologicalProperties: ['Low tectonic activity', 'Thin atmosphere', 'Small core'],
    typicalConstraints: ['Low atmospheric retention', 'Rapid cooling', 'Vulnerable to solar wind'],
    compatibleCentralObjects: ['orange_dwarf', 'red_dwarf', 'yellow_dwarf', 'white_dwarf', 'brown_dwarf'],
    scientificStatus: 'physically_plausible',
    baseWeight: 1,
    tags: ['planet', 'small', 'low_gravity'],
    massRange: { min: 0.01, max: 0.1 },
    radiusRange: { min: 0.2, max: 0.5 }
  },
  {
    id: 'earth_like',
    name: 'Землеподобная',
    bodyType: 'planet',
    sizeClass: 'earth_like',
    gravityDescription: 'Земная гравитация (0.8-1.2g)',
    geologicalProperties: ['Active tectonics', 'Dense atmosphere possible', 'Iron core'],
    typicalConstraints: ['Moderate atmospheric retention', 'Stable climate potential'],
    compatibleCentralObjects: ['orange_dwarf', 'red_dwarf', 'yellow_dwarf', 'white_dwarf'],
    scientificStatus: 'established_fact',
    baseWeight: 1,
    tags: ['planet', 'terrestrial', 'earth_like'],
    massRange: { min: 0.5, max: 2 },
    radiusRange: { min: 0.8, max: 1.2 }
  },
  {
    id: 'super_earth',
    name: 'Суперземля',
    bodyType: 'planet',
    sizeClass: 'super_earth',
    gravityDescription: 'Высокая гравитация (1.2-2.5g)',
    geologicalProperties: ['High tectonic activity', 'Thick atmosphere possible', 'Large iron core'],
    typicalConstraints: ['High atmospheric pressure', 'Strong gravity effects', 'Possible super-volcanism'],
    compatibleCentralObjects: ['orange_dwarf', 'red_dwarf', 'yellow_dwarf', 'white_dwarf', 'brown_dwarf'],
    scientificStatus: 'physically_plausible',
    baseWeight: 1,
    tags: ['planet', 'terrestrial', 'high_gravity', 'massive'],
    massRange: { min: 2, max: 10 },
    radiusRange: { min: 1.2, max: 2 }
  },
  {
    id: 'mega_earth',
    name: 'Мегаземля',
    bodyType: 'planet',
    sizeClass: 'mega_earth',
    gravityDescription: 'Очень высокая гравитация (2.5-5g)',
    geologicalProperties: ['Extreme tectonic activity', 'Very thick atmosphere', 'Massive core'],
    typicalConstraints: ['Very high atmospheric pressure', 'Extreme gravity effects', 'Possible diamond formation in mantle'],
    compatibleCentralObjects: ['orange_dwarf', 'red_dwarf', 'yellow_dwarf'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['planet', 'terrestrial', 'extreme_gravity', 'very_massive'],
    massRange: { min: 10, max: 20 },
    radiusRange: { min: 2, max: 3 }
  },
  {
    id: 'ocean_planet',
    name: 'Планета-океан',
    bodyType: 'planet',
    sizeClass: 'earth_like',
    gravityDescription: 'Земная или слегка повышенная гравитация (0.8-1.5g)',
    geologicalProperties: ['Global ocean', 'Possible ice layers', 'Rocky core'],
    typicalConstraints: ['High water pressure at depth', 'Possible subsurface life', 'Atmospheric composition depends on ocean chemistry'],
    compatibleCentralObjects: ['orange_dwarf', 'red_dwarf', 'yellow_dwarf', 'white_dwarf'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['planet', 'water_world', 'ocean'],
    massRange: { min: 0.5, max: 5 },
    radiusRange: { min: 0.8, max: 1.5 }
  },
  {
    id: 'gas_giant_moon',
    name: 'Луна газового гиганта',
    bodyType: 'moon',
    sizeClass: 'earth_like',
    gravityDescription: 'Варьируется в зависимости от размера (0.1-1.5g)',
    geologicalProperties: ['Tidal heating possible', 'Possible subsurface ocean', 'Various compositions'],
    typicalConstraints: ['Tidal forces from parent planet', 'Possible orbital resonance', 'Limited atmospheric retention'],
    compatibleCentralObjects: ['lone_gas_giant', 'blue_giant', 'brown_dwarf'],
    scientificStatus: 'physically_plausible',
    baseWeight: 1,
    tags: ['moon', 'satellite', 'tidal'],
    massRange: { min: 0.1, max: 5 },
    radiusRange: { min: 0.3, max: 1.5 }
  },
  {
    id: 'carbon_planet',
    name: 'Планета из углерода',
    bodyType: 'planet',
    sizeClass: 'earth_like',
    gravityDescription: 'Земная или слегка отличающаяся гравитация (0.8-1.3g)',
    geologicalProperties: ['Carbon-rich mantle', 'Possible diamond layers', 'Unique mineralogy'],
    typicalConstraints: ['Different geochemical cycles', 'Possible carbon-based life chemistry', 'Atmosphere may be CO2-rich'],
    compatibleCentralObjects: ['orange_dwarf', 'red_dwarf', 'yellow_dwarf', 'white_dwarf'],
    scientificStatus: 'hypothetical',
    baseWeight: 1,
    tags: ['planet', 'terrestrial', 'carbon_rich', 'exotic_geology'],
    massRange: { min: 0.5, max: 3 },
    radiusRange: { min: 0.8, max: 1.3 }
  }
];

export default celestialBodies;
