// ============================================
// TESTS - Физическая модель атмосферы (этап 3)
// ============================================

import { describe, it, expect } from 'vitest';
import {
  createAtmosphere,
  getAllPresets,
  computeAtmospherePhysicalModel
} from '../Atmosphere';
import { createRandom } from '../Generator/random';
import { atmToPa, G_EARTH_MS2, atmToPa as toPa } from '../Units';

describe('Физическая модель атмосферы (этап 3)', () => {
  describe('молярный состав и парциальные давления', () => {
    it('молярные доли нормализованного состава суммируются в 1', () => {
      const atmosphere = createAtmosphere('titan_reference', createRandom('ignored_rng'));
      const model = computeAtmospherePhysicalModel(atmosphere);
      const sum = Object.values(model.molarFractions).reduce((s, x) => s + x, 0);
      expect(sum).toBeCloseTo(1, 10);
    });

    it('молярные доли находятся в диапазоне 0..1', () => {
      for (const presetId of ['methane_ethane', 'earth', 'venus', 'mars']) {
        const model = computeAtmospherePhysicalModel(getAllPresets()[presetId]);
        for (const x of Object.values(model.molarFractions)) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
        }
      }
    });

    it('парциальное давление p_i = x_i × P: азот земного пресета', () => {
      const earth = getAllPresets()['earth'];
      const model = computeAtmospherePhysicalModel(earth);
      const totalPa = atmToPa(earth.totalPressure as number);
      const pN2 = model.partialPressuresPa['n2'].value as number;
      expect(pN2).toBeCloseTo(model.molarFractions['n2'] * totalPa, 6);
      // Справочное значение: 78.08% от 1 атм.
      // Точность -1: нормализация долей (состав каталога 100.0035%) даёт ~0.003% сдвига
      expect(pN2).toBeCloseTo(0.7808 * 101325, -1);
    });

    it('парциальные давления суммируются в общее давление (идеальный газ)', () => {
      const model = computeAtmospherePhysicalModel(getAllPresets()['venus']);
      const totalPa = atmToPa(92);
      const sum = Object.values(model.partialPressuresPa)
        .reduce((s, p) => s + (p.value as number), 0);
      expect(sum).toBeCloseTo(totalPa, -2);
    });

    it('приближение идеального газа явно обозначено', () => {
      const model = computeAtmospherePhysicalModel(getAllPresets()['earth']);
      expect(model.idealGasAssumption).toBe(true);
      expect(model.idealGasNote).toContain('идеального газа');
      expect(model.fugacityNote).toContain('фугитивности');
    });
  });

  describe('атмосферный столб m = P/g, n = P/(g·M)', () => {
    it('масса столба земной атмосферы ≈ 10332 кг/м²', () => {
      const model = computeAtmospherePhysicalModel(getAllPresets()['earth'], {
        surfaceGravityMs2: G_EARTH_MS2
      });
      const column = model.columnMassKgM2?.value as number;
      expect(column).toBeCloseTo(101325 / 9.80665, 0);
      expect(column).toBeGreaterThan(10300);
      expect(column).toBeLessThan(10370);
    });

    it('количество вещества столба n = P/(g·M) считается только при известном составе', () => {
      const model = computeAtmospherePhysicalModel(getAllPresets()['earth'], {
        surfaceGravityMs2: G_EARTH_MS2
      });
      const n = model.columnMolM2?.value as number;
      const meanM = model.meanMolarMassKgMol?.value as number;
      expect(n).toBeCloseTo(101325 / (9.80665 * meanM), 0);
    });

    it('без известной гравитации столб не рассчитывается', () => {
      const model = computeAtmospherePhysicalModel(getAllPresets()['earth']);
      expect(model.columnMassKgM2).toBeNull();
      expect(model.columnMolM2).toBeNull();
    });

    it('изменение гравитации меняет атмосферный столб', () => {
      const atEarth = computeAtmospherePhysicalModel(getAllPresets()['earth'], {
        surfaceGravityMs2: G_EARTH_MS2
      });
      const atSuperEarth = computeAtmospherePhysicalModel(getAllPresets()['earth'], {
        surfaceGravityMs2: 2 * G_EARTH_MS2
      });
      expect((atSuperEarth.columnMassKgM2?.value as number))
        .toBeCloseTo((atEarth.columnMassKgM2?.value as number) / 2, 6);
    });

    it('компонент unidentified блокирует среднюю молярную массу и столб вещества', () => {
      // Сгенерированная метаново-этановая атмосфера содержит остаток unidentified.
      const atmosphere = createAtmosphere('methane_ethane', createRandom('chem_seed'));
      expect(atmosphere.components.some(c => c.gasId === 'unidentified')).toBe(true);
      const model = computeAtmospherePhysicalModel(atmosphere, { surfaceGravityMs2: G_EARTH_MS2 });
      expect(model.meanMolarMassKgMol).toBeNull();
      // Масса столба известна (не зависит от состава), вещество — нет.
      expect(model.columnMassKgM2).not.toBeNull();
      expect(model.columnMolM2).toBeNull();
    });
  });

  describe('сохранение исторических пресетов', () => {
    it('метаново-этановая атмосфера сохранена байт-в-байт с пометкой игровых допущений', () => {
      const preset = getAllPresets()['methane_ethane'];
      const expected: Array<[string, number]> = [
        ['ch4', 60], ['n2', 20], ['c2h6', 15], ['h2', 3],
        ['nh3', 0.5], ['co', 0.3], ['co2', 0.2], ['h2o', 0.1],
        ['he', 0.05], ['ar', 0.03], ['ne', 0.02], ['o2', 0.001]
      ];
      expect(preset.components.map(c => [c.gasId, c.percentage])).toEqual(expected);
      expect(preset.totalPressure).toBe(1.5);
      expect(preset.temperature).toBe(95);
      expect(preset.presetKind).toBe('historical_game');
      expect(preset.presetNotes).toContain('игровые допущения');
      // Пресет НЕ объявляется точной копией Титана.
      expect(preset.presetNotes).toContain('НЕ является');
    });

    it('пресет «Титан — наблюдательный ориентир» хранит только опубликованные данные', () => {
      const preset = getAllPresets()['titan_reference'];
      expect(preset.components).toHaveLength(2);
      expect(preset.components.find(c => c.gasId === 'n2')?.percentage).toBe(95);
      expect(preset.components.find(c => c.gasId === 'ch4')?.percentage).toBe(5);
      expect(preset.totalPressure).toBe(1.4804); // = 1.5 bar
      expect(toPa(preset.totalPressure as number) / 1e5).toBeCloseTo(1.5, 3);
      expect(preset.temperature).toBe(94);
      expect(preset.presetKind).toBe('observational_reference');
      expect(preset.presetNotes).toContain('Не является универсальным шаблоном');
    });

    it('справочный пресет Титана не рандомизируется', () => {
      const a = createAtmosphere('titan_reference', createRandom('seed_a'));
      const b = createAtmosphere('titan_reference', createRandom('seed_b'));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.stringify(a)).toBe(JSON.stringify(getAllPresets()['titan_reference']));
    });

    it('давление пресета переводится в Па моделью без изменения исходного значения', () => {
      const model = computeAtmospherePhysicalModel(getAllPresets()['titan_reference']);
      expect(model.surfacePressurePa?.value).toBeCloseTo(toPa(1.4804), 6);
      expect(model.surfacePressurePa?.unit).toBe('Па');
      // Исходное легаси-поле в atm не переписано.
      expect(getAllPresets()['titan_reference'].totalPressure).toBe(1.4804);
    });

    it('исторический пресет помечает давление как игровое допущение в физической модели', () => {
      const model = computeAtmospherePhysicalModel(getAllPresets()['methane_ethane']);
      expect(model.surfacePressurePa?.note).toContain('игровое допущение');
    });

    it('пресеты Венеры и Марса сохранены', () => {
      const venus = getAllPresets()['venus'];
      expect(venus.components.find(c => c.gasId === 'co2')?.percentage).toBe(96.5);
      expect(venus.totalPressure).toBe(92);
      const mars = getAllPresets()['mars'];
      expect(mars.components.find(c => c.gasId === 'co2')?.percentage).toBe(95.0);
      expect(mars.totalPressure).toBe(0.006);
    });
  });

  describe('различия атмосфер миров', () => {
    it('физические модели разных пресетов различаются', () => {
      const earth = computeAtmospherePhysicalModel(getAllPresets()['earth']);
      const venus = computeAtmospherePhysicalModel(getAllPresets()['venus']);
      expect(earth.molarFractions['n2']).not.toBe(venus.molarFractions['n2']);
      expect(earth.surfacePressurePa?.value).not.toBe(venus.surfacePressurePa?.value);
    });

    it('минимальная вертикальная структура: известен только приземный слой', () => {
      const model = computeAtmospherePhysicalModel(getAllPresets()['earth']);
      expect(model.layers).toHaveLength(1);
      expect(model.layers[0].layerId).toBe('surface_boundary');
      expect(model.layers[0].altitudeRangeM?.max ?? null).toBeNull();
      expect(model.layersNote).toContain('минимальна');
    });
  });
});
