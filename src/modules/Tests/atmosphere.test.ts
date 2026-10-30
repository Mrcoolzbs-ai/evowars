// ============================================
// TESTS - Atmosphere module tests
// ============================================

import { describe, it, expect } from 'vitest';
import {
  createAtmosphere,
  normalizeAtmosphere,
  validateAtmosphere,
  getAllPresets,
  UNIDENTIFIED_COMPONENT_ID
} from '../Atmosphere';
import { createRandom } from '../Generator/random';
import type { AtmosphereState } from '../../types';

function findComponent(atmosphere: AtmosphereState, gasId: string) {
  return atmosphere.components.find(c => c.gasId === gasId);
}

function sumComponents(atmosphere: AtmosphereState): number {
  return atmosphere.components.reduce((sum, component) => sum + component.percentage, 0);
}

describe('Atmosphere Module', () => {
  describe('createAtmosphere', () => {
    it('should create methane-ethane atmosphere preset', () => {
      const rng = createRandom('test_seed');
      const atmosphere = createAtmosphere('methane_ethane', rng);

      expect(atmosphere).toBeDefined();
      expect(atmosphere.components).toBeInstanceOf(Array);
      expect(atmosphere.components.length).toBeGreaterThan(0);
      expect(atmosphere.totalPressure).toBe(1.5);
      expect(atmosphere.temperature).toBe(95);
    });

    it('сумма всех компонентов (включая следовые) составляет ровно 100%', () => {
      const rng = createRandom('test_seed');
      const atmosphere = createAtmosphere('methane_ethane', rng);

      expect(sumComponents(atmosphere)).toBeCloseTo(100, 8);
    });

    it('should include methane as primary component', () => {
      const rng = createRandom('test_seed');
      const atmosphere = createAtmosphere('methane_ethane', rng);

      const methaneComponent = findComponent(atmosphere, 'ch4');
      expect(methaneComponent).toBeDefined();
      // Основные компоненты не варьируются и не растягиваются до 100%
      expect(methaneComponent?.percentage).toBe(60);
    });

    it('should include ethane as primary component', () => {
      const rng = createRandom('test_seed');
      const atmosphere = createAtmosphere('methane_ethane', rng);

      const ethaneComponent = findComponent(atmosphere, 'c2h6');
      expect(ethaneComponent).toBeDefined();
      expect(ethaneComponent?.percentage).toBe(15);
    });
  });

  describe('normalizeAtmosphere — сохранение исходных данных', () => {
    it('сохраняет исходные концентрации метаново-этанового пресета без изменений', () => {
      const preset = getAllPresets().methane_ethane;
      const normalized = normalizeAtmosphere(preset);

      // Исходные концентрации сохранены байт-в-байт
      expect(findComponent(normalized, 'ch4')?.percentage).toBe(60);
      expect(findComponent(normalized, 'n2')?.percentage).toBe(20);
      expect(findComponent(normalized, 'c2h6')?.percentage).toBe(15);
      expect(findComponent(normalized, 'h2')?.percentage).toBe(3);
      // Следовые компоненты сохранены
      expect(findComponent(normalized, 'nh3')?.percentage).toBe(0.5);
      expect(findComponent(normalized, 'co')?.percentage).toBe(0.3);
      expect(findComponent(normalized, 'o2')?.percentage).toBe(0.001);
    });

    it('неучтённый остаток обозначается как неизвестные минорные компоненты', () => {
      const preset = getAllPresets().methane_ethane;
      const normalized = normalizeAtmosphere(preset);

      // Сумма пресета: 99.201% => остаток 0.799%
      const unidentified = normalized.components.filter(
        c => c.gasId === UNIDENTIFIED_COMPONENT_ID
      );
      expect(unidentified).toHaveLength(1);
      expect(unidentified[0].percentage).toBeCloseTo(0.799, 8);
      expect(unidentified[0].isTrace).toBe(true);
      // Остаток — не произвольный газ
      expect(normalized.components.every(c => c.gasId !== 'n2o' || c.percentage < 100)).toBe(true);
    });

    it('следовые компоненты учитываются в общей сумме', () => {
      const atmosphere: AtmosphereState = {
        components: [
          { gasId: 'ch4', percentage: 99, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'h2', percentage: 0.5, isTrace: true, uncertainty: '', warnings: [] },
          { gasId: 'co', percentage: 0.25, isTrace: true, uncertainty: '', warnings: [] }
        ],
        totalPressure: 1.0,
        temperature: 100,
        notes: 'Traces counted'
      };

      const normalized = normalizeAtmosphere(atmosphere);

      // 99 + 0.5 + 0.25 = 99.75 => остаток 0.25, а не растягивание ch4 до 100%
      expect(findComponent(normalized, 'ch4')?.percentage).toBe(99);
      expect(findComponent(normalized, 'unidentified')?.percentage).toBeCloseTo(0.25, 8);
      expect(sumComponents(normalized)).toBeCloseTo(100, 8);
    });

    it('повторная нормализация не приводит к двойному учёту остатка', () => {
      const preset = getAllPresets().methane_ethane;
      const once = normalizeAtmosphere(preset);
      const twice = normalizeAtmosphere(once);

      const unidentifiedOnce = once.components.filter(c => c.gasId === UNIDENTIFIED_COMPONENT_ID);
      const unidentifiedTwice = twice.components.filter(c => c.gasId === UNIDENTIFIED_COMPONENT_ID);

      expect(unidentifiedTwice).toHaveLength(1);
      expect(unidentifiedTwice[0].percentage).toBeCloseTo(unidentifiedOnce[0].percentage, 8);
      expect(sumComponents(twice)).toBeCloseTo(100, 8);
    });

    it('состав в пределах погрешности округления не изменяется (Венера)', () => {
      const preset = getAllPresets().venus;
      const normalized = normalizeAtmosphere(preset);

      // Сумма пресета Венеры: 100.0276% — в пределах допуска 0.05%
      expect(normalized.components.some(c => c.gasId === UNIDENTIFIED_COMPONENT_ID)).toBe(false);
      expect(normalized.components).toHaveLength(preset.components.length);
      expect(findComponent(normalized, 'co2')?.percentage).toBe(96.5);
    });

    it('сохраняет диапазоны и неопределённость компонентов', () => {
      const atmosphere: AtmosphereState = {
        components: [
          {
            gasId: 'ch4',
            percentage: 50,
            isTrace: false,
            minRange: 40,
            maxRange: 60,
            uncertainty: 'low',
            warnings: []
          }
        ],
        totalPressure: 1.0,
        temperature: 100,
        notes: 'Test'
      };

      const normalized = normalizeAtmosphere(atmosphere);
      const component = normalized.components[0];

      expect(component.gasId).toBe('ch4');
      expect(component.isTrace).toBe(false);
      expect(component.minRange).toBe(40);
      expect(component.maxRange).toBe(60);
      expect(component.uncertainty).toBe('low');
      expect(component.warnings).toEqual([]);
    });

    it('should handle empty components array', () => {
      const atmosphere: AtmosphereState = {
        components: [],
        totalPressure: 1.0,
        temperature: 200,
        notes: 'Empty atmosphere'
      };

      const normalized = normalizeAtmosphere(atmosphere);
      expect(normalized.components).toHaveLength(0);
    });
  });

  describe('normalizeAtmosphere — обработка некорректных составов', () => {
    const overSum: AtmosphereState = {
      components: [
        { gasId: 'ch4', percentage: 60, isTrace: false, uncertainty: '', warnings: [] },
        { gasId: 'co', percentage: 41, isTrace: false, uncertainty: '', warnings: [] }
      ],
      totalPressure: 1.0,
      temperature: 100,
      notes: 'Over 100'
    };

    it('состав свыше 100% выдаёт понятную ошибку в строгом режиме', () => {
      expect(() => normalizeAtmosphere(overSum)).toThrow(/превышает 100%/);
    });

    it('явно выбранный пропорциональный режим нормализует состав к 100%', () => {
      const normalized = normalizeAtmosphere(overSum, { mode: 'proportional' });

      expect(sumComponents(normalized)).toBeCloseTo(100, 8);
      // Соотношения сохранены: 60/101 и 41/101
      expect(findComponent(normalized, 'ch4')?.percentage).toBeCloseTo(60 / 101 * 100, 8);
      expect(findComponent(normalized, 'co')?.percentage).toBeCloseTo(41 / 101 * 100, 8);
    });

    it('отрицательные концентрации не допускаются', () => {
      const negative: AtmosphereState = {
        components: [
          { gasId: 'ch4', percentage: -5, isTrace: false, uncertainty: '', warnings: [] }
        ],
        totalPressure: 1.0,
        temperature: 100,
        notes: 'Negative'
      };

      expect(() => normalizeAtmosphere(negative)).toThrow(/Отрицательная концентрация/);
    });
  });

  describe('validateAtmosphere', () => {
    it('валидный нормализованный состав проходит проверку', () => {
      const normalized = normalizeAtmosphere(getAllPresets().methane_ethane);
      const validation = validateAtmosphere(normalized);

      expect(validation.valid).toBe(true);
      expect(validation.error).toBeNull();
      expect(validation.issues).toHaveLength(0);
      expect(validation.total).toBeCloseTo(100, 8);
    });

    it('состав с суммой больше 100% не проходит проверку', () => {
      const overSum: AtmosphereState = {
        components: [
          { gasId: 'ch4', percentage: 60, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'co', percentage: 41, isTrace: false, uncertainty: '', warnings: [] }
        ],
        totalPressure: 1.0,
        temperature: 100,
        notes: 'Over 100'
      };

      const validation = validateAtmosphere(overSum);

      expect(validation.valid).toBe(false);
      expect(validation.issues.some(issue => issue.includes('Сумма компонентов'))).toBe(true);
    });

    it('дубликаты газов отмечаются как ошибка', () => {
      const duplicated: AtmosphereState = {
        components: [
          { gasId: 'ch4', percentage: 50, isTrace: false, uncertainty: '', warnings: [] },
          { gasId: 'ch4', percentage: 50, isTrace: false, uncertainty: '', warnings: [] }
        ],
        totalPressure: 1.0,
        temperature: 100,
        notes: 'Duplicate'
      };

      const validation = validateAtmosphere(duplicated);

      expect(validation.valid).toBe(false);
      expect(validation.issues.some(issue => issue.includes('более одного раза'))).toBe(true);
    });
  });
});

describe('Atmosphere Composition Validation', () => {
  it('should create atmosphere with all required gases', () => {
    const rng = createRandom('test_seed');
    const atmosphere = createAtmosphere('methane_ethane', rng);

    const requiredGases = ['ch4', 'n2', 'c2h6', 'h2', 'nh3', 'co', 'co2', 'h2o'];
    const gasIds = atmosphere.components.map(c => c.gasId);

    requiredGases.forEach(gasId => {
      expect(gasIds).toContain(gasId);
    });
  });

  it('should have methane as dominant component', () => {
    const rng = createRandom('test_seed');
    const atmosphere = createAtmosphere('methane_ethane', rng);

    const methaneComponent = findComponent(atmosphere, 'ch4');
    expect(methaneComponent?.percentage).toBeGreaterThan(50);
  });

  it('should have nitrogen as second most abundant component', () => {
    const rng = createRandom('test_seed');
    const atmosphere = createAtmosphere('methane_ethane', rng);

    const nitrogenComponent = findComponent(atmosphere, 'n2');
    expect(nitrogenComponent?.percentage).toBeGreaterThan(10);
    expect(nitrogenComponent?.percentage).toBeLessThan(30);
  });

  it('should have trace components with low percentages', () => {
    const rng = createRandom('test_seed');
    const atmosphere = createAtmosphere('methane_ethane', rng);

    const traceComponents = atmosphere.components.filter(c => c.isTrace);
    expect(traceComponents.length).toBeGreaterThan(0);
    traceComponents.forEach(component => {
      expect(component.percentage).toBeLessThan(1);
    });
  });

  it('пресет Марса: неучтённый остаток добавляется как неизвестные минорные компоненты', () => {
    const atmosphere = createAtmosphere('mars', createRandom('mars_test'));

    expect(findComponent(atmosphere, UNIDENTIFIED_COMPONENT_ID)).toBeDefined();
    expect(sumComponents(atmosphere)).toBeCloseTo(100, 8);
    // Основные компоненты Марса не растягиваются
    expect(findComponent(atmosphere, 'co2')?.percentage).toBe(95);
  });
});
