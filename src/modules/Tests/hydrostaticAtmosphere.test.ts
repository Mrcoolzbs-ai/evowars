// ============================================
// TESTS - Гидростатическая атмосфера (Stage 4.8.1)
// ============================================
//
// 28 обязательных сценариев ТЗ:
//   1-10  аналитические;
//   11-15 численные;
//   16-23 fail-closed;
//   24-28 референсная валидация (USSA 1976, Венера-ориентиры, HASI-Титан).

import { describe, it, expect } from 'vitest';
import {
  computeHydrostaticColumn,
  isothermalConstantGravityPressure,
  isothermalScaleHeight,
  isothermalSphericalRelationPressure,
  HYDROSTATIC_COLUMN_DEFAULTS,
  type AtmosphereLayerSpec,
  type HydrostaticColumnInput,
  type HydrostaticColumnCompleted
} from '../Core/hydrostaticAtmosphere';
import { tryGetGasSpecies } from '../Data/gases';
import {
  USSA_1976_CONSTANTS,
  USSA_1976_LAYERS,
  USSA_1976_CHECK_NODES,
  USSA_1976_PROVENANCE,
  USSA_1976_EQUIVALENT_BODY_MASS_KG,
  USSA_1976_DRY_AIR_COMPOSITION,
  VENUS_VIRA_ORIENTATION,
  TITAN_HASI_SURFACE_ANCHOR
} from '../Data/atmosphericReferenceProfiles';

// ============================================
// ПОМОЩНИКИ ВХОДА
// ============================================

const DRY_AIR = USSA_1976_DRY_AIR_COMPOSITION.gases.map((g) => ({ ...g }));

function isothermalLayer(
  layerId: string,
  bottomM: number,
  topM: number,
  temperatureK: number,
  gases = DRY_AIR
): AtmosphereLayerSpec {
  return {
    layerId,
    bottomHeightM: bottomM,
    topHeightM: topM,
    temperature: { kind: 'isothermal', temperatureK },
    composition: { gases, provenance: { sourceName: 'тестовый предположительный состав' } },
    provenance: { sourceName: 'аналитический тест-слой' }
  };
}

function isothermalInput(overrides?: {
  topM?: number;
  temperatureK?: number;
  mode?: 'spherical-gravity' | 'constant-gravity';
  atol?: number;
  rtol?: number;
  bodyMassKg?: number;
}): HydrostaticColumnInput {
  return {
    body: {
      bodyMassKg: overrides?.bodyMassKg ?? USSA_1976_EQUIVALENT_BODY_MASS_KG,
      referenceRadiusM: USSA_1976_CONSTANTS.r0M,
      provenance: { sourceName: 'USSA-согласованная масса g0*r0^2/G' }
    },
    surface: {
      surfacePressurePa: 101325,
      pressureProvenance: { sourceName: 'USSA 1976 уровень моря' }
    },
    layers: [
      isothermalLayer('iso_test', 0, overrides?.topM ?? 30000, overrides?.temperatureK ?? 250)
    ],
    requestedHeightsM: [1000, 5000, 15000, (overrides?.topM ?? 30000) - 1],
    numerics: {
      gravitationMode: overrides?.mode,
      rtol: overrides?.rtol ?? 1e-10,
      atol: overrides?.atol ?? 1e-12
    }
  };
}

/** Полный земной USSA-вход: 7 слоёв, узлы таблицы как T(z), сферическая g(z). */
function ussaEarthInput(pressureScale = 1, rtol?: number): HydrostaticColumnInput {
  const layers: AtmosphereLayerSpec[] = USSA_1976_LAYERS.map((l) => {
    // Знаковый dT/dh USSA: T_top = T_base + lapse * dh.
    const tTop = l.baseTemperatureK + (l.lapseRateKPerKm * (l.geopotentialTopM - l.geopotentialBottomM)) / 1000;
    return {
      layerId: `ussa_geo_l${l.layerIndex}`,
      bottomHeightM: l.geometricBottomM,
      topHeightM: l.geometricTopM,
      // Двухузловая линейная интерполяция T(z) в геометрических метрах:
      // границы слоя точно публикуемыми температурами (узлы таблицы).
      temperature: {
        kind: 'measuredNodes',
        interpolation: 'linear',
        nodes: [
          { heightM: l.geometricBottomM, temperatureK: l.baseTemperatureK },
          { heightM: l.geometricTopM, temperatureK: tTop }
        ]
      },
      composition: { gases: DRY_AIR, provenance: USSA_1976_DRY_AIR_COMPOSITION.provenance },
      provenance: USSA_1976_PROVENANCE,
      applicability: 'сухой стандартный воздух, без конденсации и озонной стратификации состава'
    };
  });
  return {
    body: {
      bodyMassKg: USSA_1976_EQUIVALENT_BODY_MASS_KG,
      referenceRadiusM: USSA_1976_CONSTANTS.r0M,
      provenance: {
        sourceName: 'USSA 1976: M = g0*r0^2/G, g(r0) = g0',
        method: 'выведено из констант документа и CODATA G'
      }
    },
    surface: {
      surfacePressurePa: 101325 * pressureScale,
      pressureProvenance: { sourceName: 'USSA 1976, p(0) = 101325 Па' }
    },
    layers,
    requestedHeightsM: USSA_1976_CHECK_NODES.map((n) => n.geometricHeightM),
    numerics: rtol !== undefined ? { rtol } : undefined
  };
}

function expectCompleted(res: ReturnType<typeof computeHydrostaticColumn>): HydrostaticColumnCompleted {
  expect(res.status).toBe('completed');
  return res as HydrostaticColumnCompleted;
}

function runEarth(rtol?: number): HydrostaticColumnCompleted {
  const res = computeHydrostaticColumn(ussaEarthInput(1, rtol));
  return expectCompleted(res);
}

function atHeight(res: HydrostaticColumnCompleted, targetM: number): HydrostaticColumnCompleted['profile'][number] {
  const point = res.profile.find((p) => Math.abs(p.heightM - targetM) < 0.5);
  expect(point, `точка профиля на высоте ${targetM} м`).toBeDefined();
  return point!;
}

// ============================================
// АНАЛИТИЧЕСКИЕ (1-10)
// ============================================

describe('Гидростатическая атмосфера 4.8.1: аналитические', () => {
  it('1. изотермическая атмосфера, постоянная g: P = P0*exp(-z/H)', () => {
    const res = expectCompleted(computeHydrostaticColumn(isothermalInput({ mode: 'constant-gravity' })));
    const H = isothermalScaleHeight({
      temperatureK: 250,
      meanMolarMassKgPerMol: res.profile[0].meanMolarMassKgPerMol,
      gravityMs2: res.profile[0].gravityMs2
    });
    for (const point of res.requestedHeightPoints) {
      const analytic = isothermalConstantGravityPressure({
        surfacePressurePa: 101325,
        scaleHeightM: H,
        heightDeltaM: point.heightM
      });
      expect(point.pressurePa / analytic).toBeCloseTo(1, 6);
    }
  });

  it('2. изотермическая атмосфера, сферическая g: аналитическое соотношение', () => {
    const res = expectCompleted(computeHydrostaticColumn(isothermalInput({ topM: 140000 })));
    for (const point of res.requestedHeightPoints) {
      const analytic = isothermalSphericalRelationPressure({
        surfacePressurePa: 101325,
        surfaceHeightM: 0,
        targetHeightM: point.heightM,
        meanMolarMassKgPerMol: res.profile[0].meanMolarMassKgPerMol,
        temperatureK: 250,
        bodyMassKg: USSA_1976_EQUIVALENT_BODY_MASS_KG,
        bodyRadiusM: USSA_1976_CONSTANTS.r0M
      });
      expect(point.pressurePa / analytic).toBeCloseTo(1, 6);
    }
  });

  it('3. давление монотонно убывает при положительных rho и g (полный USSA-профиль)', () => {
    const res = runEarth();
    for (let i = 1; i < res.profile.length; i++) {
      // Дубли на границах слоёв (обе стороны одной высоты) пропускаются:
      // давление там непрерывно по построению.
      if (res.profile[i].heightM === res.profile[i - 1].heightM) continue;
      expect(res.profile[i].pressurePa).toBeLessThan(res.profile[i - 1].pressurePa);
      expect(res.profile[i].densityKgPerM3).toBeGreaterThan(0);
      expect(res.profile[i].gravityMs2).toBeGreaterThan(0);
    }
  });

  it('4. массовый и молярный столбы монотонно возрастают', () => {
    const res = runEarth();
    for (let i = 1; i < res.profile.length; i++) {
      if (res.profile[i].heightM === res.profile[i - 1].heightM) continue;
      expect(res.profile[i].columnMassKgPerM2).toBeGreaterThan(res.profile[i - 1].columnMassKgPerM2);
      expect(res.profile[i].columnMolesPerM2).toBeGreaterThan(res.profile[i - 1].columnMolesPerM2);
    }
  });

  it('5. плотность рассчитывается по идеальному газу', () => {
    const res = runEarth();
    const R = 8.31446261815324;
    for (const p of res.profile) {
      const rhoIdeal = (p.pressurePa * p.meanMolarMassKgPerMol) / (R * p.temperatureK);
      expect(p.densityKgPerM3 / rhoIdeal).toBeCloseTo(1, 12);
      expect(p.densityKgPerM3).toBeGreaterThan(0);
    }
  });

  it('6. средняя молярная масса совпадает с независимым расчётом состава', () => {
    const res = runEarth();
    // Независимый расчёт: каталог г/моль -> кг/моль (конверсия x1e-3 вручную).
    const mbarIndependent =
      DRY_AIR.reduce((sum, g) => {
        const species = tryGetGasSpecies(g.gasId);
        expect(species).not.toBeNull();
        return sum + g.moleFraction * (species!.molarMass as number) * 1e-3;
      }, 0);
    for (const p of res.profile) {
      expect(Math.abs(p.meanMolarMassKgPerMol - mbarIndependent)).toBeLessThan(1e-15);
    }
    // Ориентир USSA M=28.9644 г/моль; каталог даёт близкое значение (в 1e-3).
    expect(Math.abs(res.profile[0].meanMolarMassKgPerMol / 0.0289644 - 1)).toBeLessThan(1e-3);
  });

  it('7. давление непрерывно на границах слоёв', () => {
    const res = runEarth();
    expect(res.layerBoundaries.length).toBe(USSA_1976_LAYERS.length);
    for (let i = 1; i < res.layerBoundaries.length; i++) {
      expect(res.layerBoundaries[i].bottom.pressurePa).toBeCloseTo(
        res.layerBoundaries[i - 1].top.pressurePa,
        12
      );
    }
  });

  it('8. физический скачок плотности при смене состава на границе допустим', () => {
    const lightGases = [
      { gasId: 'h2', moleFraction: 0.5 },
      { gasId: 'he', moleFraction: 0.5 }
    ];
    const input: HydrostaticColumnInput = {
      ...isothermalInput({ topM: 20000 }),
      layers: [isothermalLayer('heavy', 0, 10000, 250), isothermalLayer('light', 10000, 20000, 250, lightGases)]
    };
    const res = expectCompleted(computeHydrostaticColumn(input));
    const upperBottom = res.layerBoundaries[1].bottom;
    const lowerTop = res.layerBoundaries[0].top;
    // Давление одинаково, плотность испытывает физический скачок.
    expect(upperBottom.pressurePa).toBeCloseTo(lowerTop.pressurePa, 12);
    expect(upperBottom.temperatureK).toBe(lowerTop.temperatureK);
    const jump =
      Math.abs(upperBottom.densityKgPerM3 - lowerTop.densityKgPerM3) /
      Math.max(upperBottom.densityKgPerM3, lowerTop.densityKgPerM3);
    expect(jump).toBeGreaterThan(0.1);
    // Два состояния на одной высоте присутствуют в профиле.
    const atBoundary = res.profile.filter((p) => p.heightM === 10000);
    expect(atBoundary.length).toBe(2);
  });

  it('9. нулевая высота возвращает заданные поверхностные P и T', () => {
    const res = runEarth();
    const surface = res.profile[0];
    expect(surface.heightM).toBe(0);
    expect(surface.pressurePa).toBe(101325);
    expect(surface.temperatureK).toBe(288.15);
    expect(res.coverage.bottomHeightM).toBe(0);
  });

  it('10. увеличение планетной гравитации уменьшает масштабную высоту', () => {
    const base = expectCompleted(computeHydrostaticColumn(isothermalInput({ mode: 'constant-gravity' })));
    const heavier = expectCompleted(
      computeHydrostaticColumn(isothermalInput({ mode: 'constant-gravity', bodyMassKg: USSA_1976_EQUIVALENT_BODY_MASS_KG * 4 }))
    );
    expect(heavier.profile[0].scaleHeightM).toBeLessThan(base.profile[0].scaleHeightM);
    expect(base.profile[0].scaleHeightM / heavier.profile[0].scaleHeightM).toBeCloseTo(4, 6);
  });
});

// ============================================
// ЧИСЛЕННЫЕ (11-15)
// ============================================

describe('Гидростатическая атмосфера 4.8.1: численные', () => {
  it('11. ужесточение допуска даёт контролируемую сходимость к аналитике', () => {
    const mbar =
      0.7808 * 0.02802 + 0.2095 * 0.032 + 0.0093 * 0.039948 + 0.0004 * 0.04401;
    const maxErrorAt = (rtol: number): number => {
      const res = expectCompleted(computeHydrostaticColumn(isothermalInput({ topM: 140000, rtol })));
      let maxRel = 0;
      for (const p of res.requestedHeightPoints) {
        const analytic = isothermalSphericalRelationPressure({
          surfacePressurePa: 101325,
          surfaceHeightM: 0,
          targetHeightM: p.heightM,
          meanMolarMassKgPerMol: mbar,
          temperatureK: 250,
          bodyMassKg: USSA_1976_EQUIVALENT_BODY_MASS_KG,
          bodyRadiusM: USSA_1976_CONSTANTS.r0M
        });
        maxRel = Math.max(maxRel, Math.abs(p.pressurePa - analytic) / analytic);
      }
      return maxRel;
    };
    const coarse = maxErrorAt(3e-3);
    const fine = maxErrorAt(1e-10);
    expect(fine).toBeLessThan(1e-8);
    expect(coarse).toBeGreaterThan(1e-6);
    expect(fine).toBeLessThan(coarse);
  });

  it('12. результат детерминирован', () => {
    const a = runEarth();
    const b = runEarth();
    expect(JSON.stringify(a.profile)).toBe(JSON.stringify(b.profile));
    expect(JSON.stringify(a.solverStats)).toBe(JSON.stringify(b.solverStats));
  });

  it('13. ошибка интегратора корректно представлена', () => {
    const res = runEarth();
    expect(res.solverStats.acceptedSteps).toBeGreaterThan(0);
    expect(res.solverStats.rhsEvaluations).toBeGreaterThan(0);
    expect(res.solverStats.jacobianEvaluations).toBeGreaterThan(0);
    expect(res.tolerances.rtol).toBe(HYDROSTATIC_COLUMN_DEFAULTS.rtol);
    // Построчный баланс столба внутри слоёв: численный дрейф мал.
    expect(res.columnConsistencyMaxRelativeDeviation).toBeLessThan(1e-6);
    expect(res.assumptions.length).toBeGreaterThan(0);
  });

  it('14. нет численного вырождения при малой верхней плотности', () => {
    const res = runEarth();
    const top = res.profile[res.profile.length - 1];
    expect(Number.isFinite(top.densityKgPerM3)).toBe(true);
    expect(top.densityKgPerM3).toBeGreaterThan(0);
    expect(Number.isFinite(top.scaleHeightM)).toBe(true);
    expect(top.scaleHeightM).toBeGreaterThan(0);
    const h71 = USSA_1976_CHECK_NODES[6].geometricHeightM;
    const node71 = atHeight(res, h71);
    expect(top.pressurePa).toBeLessThan(node71.pressurePa);
  });

  it('15. корректная обработка радиуса/высоты и граничных значений', () => {
    const input: HydrostaticColumnInput = {
      ...isothermalInput({ topM: 15000 }),
      surface: {
        surfacePressurePa: 101325,
        pressureProvenance: { sourceName: 'USSA 1976 уровень моря' },
        bottomHeightM: 5000
      },
      layers: [isothermalLayer('shifted', 5000, 15000, 250)],
      requestedHeightsM: [5000, 5001, 15000]
    };
    const res = expectCompleted(computeHydrostaticColumn(input));
    expect(res.profile[0].heightM).toBe(5000);
    expect(res.profile[0].pressurePa).toBe(101325);
    // Контрольные высоты вне диапазона не экстраполируются.
    const below = computeHydrostaticColumn({
      ...isothermalInput({ topM: 15000 }),
      requestedHeightsM: [4999]
    });
    expect(below.status).toBe('out_of_applicability');
    const above = computeHydrostaticColumn({
      ...isothermalInput({ topM: 15000 }),
      requestedHeightsM: [0, 15000.5]
    });
    expect(above.status).toBe('out_of_applicability');
  });
});

// ============================================
// FAIL-CLOSED (16-23)
// ============================================

describe('Гидростатическая атмосфера 4.8.1: fail-closed', () => {
  function withComposition(gases: { gasId: string; moleFraction: number }[]): HydrostaticColumnInput {
    return {
      ...isothermalInput(),
      layers: [isothermalLayer('x', 0, 30000, 250, gases)]
    };
  }

  it('16. неизвестный gasId/"unidentified" блокирует расчёт без нулевой массы', () => {
    const resUnknown = computeHydrostaticColumn(
      withComposition([
        { gasId: 'unobtainium', moleFraction: 0.5 },
        { gasId: 'n2', moleFraction: 0.5 }
      ])
    );
    expect(resUnknown.status).toBe('out_of_applicability');
    if (resUnknown.status === 'out_of_applicability') {
      expect(resUnknown.missingParameters!.length).toBeGreaterThan(0);
    }
    const resUnidentified = computeHydrostaticColumn(
      withComposition([
        { gasId: 'unidentified', moleFraction: 0.1 },
        { gasId: 'n2', moleFraction: 0.9 }
      ])
    );
    expect(resUnidentified.status).toBe('out_of_applicability');
  });

  it('17. отрицательные и нулевые молярные доли отклоняются', () => {
    const negative = computeHydrostaticColumn(
      withComposition([
        { gasId: 'n2', moleFraction: 1.1 },
        { gasId: 'o2', moleFraction: -0.1 }
      ])
    );
    expect(negative.status).toBe('invalid_input');
    const zero = computeHydrostaticColumn(
      withComposition([
        { gasId: 'n2', moleFraction: 1.0 },
        { gasId: 'o2', moleFraction: 0 }
      ])
    );
    expect(zero.status).toBe('invalid_input');
  });

  it('18. сумма долей существенно не равна 1 — отказ без молчаливой нормировки', () => {
    const res = computeHydrostaticColumn(
      withComposition([
        { gasId: 'n2', moleFraction: 0.6 },
        { gasId: 'o2', moleFraction: 0.3 }
      ])
    );
    expect(res.status).toBe('invalid_input');
    if (res.status === 'invalid_input') {
      expect(res.errors.some((e) => e.includes('нормировка'))).toBe(true);
    }
  });

  it('19. отрицательная температура и пересечение 0 K в lapse-слое отклоняются', () => {
    const negative = computeHydrostaticColumn({
      ...isothermalInput(),
      layers: [isothermalLayer('cold', 0, 30000, -10)]
    });
    expect(negative.status).toBe('invalid_input');
    const crossing = computeHydrostaticColumn({
      ...isothermalInput(),
      layers: [
        {
          layerId: 'lapse',
          bottomHeightM: 0,
          topHeightM: 10000,
          temperature: { kind: 'lapseRate', bottomTemperatureK: 300, lapseRateKPerM: 0.04 },
          composition: { gases: DRY_AIR, provenance: { sourceName: 'тест' } },
          provenance: { sourceName: 'тест' }
        }
      ]
    });
    expect(crossing.status).toBe('invalid_input');
    if (crossing.status === 'invalid_input') {
      expect(crossing.errors.some((e) => e.includes('0 K'))).toBe(true);
    }
  });

  it('20. перекрывающиеся, разорванные слои и дубли ID отклоняются', () => {
    const overlap = computeHydrostaticColumn({
      ...isothermalInput(),
      layers: [isothermalLayer('a', 0, 20000, 250), isothermalLayer('b', 10000, 30000, 250)]
    });
    expect(overlap.status).toBe('invalid_input');
    const gap = computeHydrostaticColumn({
      ...isothermalInput(),
      layers: [isothermalLayer('a', 0, 10000, 250), isothermalLayer('b', 12000, 30000, 250)]
    });
    expect(gap.status).toBe('invalid_input');
    const duplicate = computeHydrostaticColumn({
      ...isothermalInput(),
      layers: [isothermalLayer('a', 0, 15000, 250), isothermalLayer('a', 15000, 30000, 250)]
    });
    expect(duplicate.status).toBe('invalid_input');
    if (duplicate.status === 'invalid_input') {
      expect(duplicate.errors.some((e) => e.includes('повторяющийся'))).toBe(true);
    }
  });

  it('21. нулевые/отрицательные масса, радиус, поверхностное давление отклоняются', () => {
    for (const bodyMassKg of [0, -5.9e24]) {
      expect(computeHydrostaticColumn(isothermalInput({ bodyMassKg })).status).toBe('invalid_input');
    }
    for (const referenceRadiusM of [0, -1]) {
      const input = isothermalInput();
      const bad: HydrostaticColumnInput = { ...input, body: { ...input.body, referenceRadiusM } };
      expect(computeHydrostaticColumn(bad).status).toBe('invalid_input');
    }
    for (const surfacePressurePa of [0, -101325]) {
      const input = isothermalInput();
      const bad: HydrostaticColumnInput = {
        ...input,
        surface: { ...input.surface, surfacePressurePa }
      };
      expect(computeHydrostaticColumn(bad).status).toBe('invalid_input');
    }
  });

  it('22. NaN/Infinity во всех входных полях отклоняются', () => {
    expect(computeHydrostaticColumn(isothermalInput({ bodyMassKg: NaN })).status).toBe('invalid_input');

    const withRadius = isothermalInput();
    expect(
      computeHydrostaticColumn({
        ...withRadius,
        body: { ...withRadius.body, referenceRadiusM: Infinity }
      }).status
    ).toBe('invalid_input');

    const withP = isothermalInput();
    expect(
      computeHydrostaticColumn({
        ...withP,
        surface: { ...withP.surface, surfacePressurePa: NaN }
      }).status
    ).toBe('invalid_input');

    const withHeight = isothermalInput();
    expect(
      computeHydrostaticColumn({
        ...withHeight,
        layers: [{ ...isothermalLayer('h', 0, 30000, 250), topHeightM: NaN }]
      }).status
    ).toBe('invalid_input');

    const withFraction = computeHydrostaticColumn(
      withComposition([
        { gasId: 'n2', moleFraction: NaN },
        { gasId: 'o2', moleFraction: 1 }
      ])
    );
    expect(withFraction.status).toBe('invalid_input');

    const withRequested = isothermalInput();
    expect(
      computeHydrostaticColumn({ ...withRequested, requestedHeightsM: [1000, Infinity] }).status
    ).toBe('invalid_input');
  });

  it('23. отсутствие температурного профиля не заменяется произвольным значением', () => {
    const layerWithTemperature = isothermalLayer('noT', 0, 30000, 250) as Record<string, unknown>;
    delete layerWithTemperature.temperature;
    const input = isothermalInput();
    const bad: HydrostaticColumnInput = {
      ...input,
      layers: [layerWithTemperature as unknown as AtmosphereLayerSpec]
    };
    const res = computeHydrostaticColumn(bad);
    expect(res.status).toBe('invalid_input');
    if (res.status === 'invalid_input') {
      expect(res.errors.some((e) => e.includes('НЕ подставляется'))).toBe(true);
    }
  });
});

// ============================================
// РЕФЕРЕНСНАЯ ВАЛИДАЦИЯ (24-28)
// ============================================

describe('Гидростатическая атмосфера 4.8.1: референсная валидация', () => {
  it('24. Земля: контроль опубликованных узлов USSA 1976 (P, T, rho)', () => {
    const res = runEarth();
    expect(USSA_1976_CHECK_NODES.length).toBe(8);
    for (let idx = 0; idx < USSA_1976_CHECK_NODES.length; idx++) {
      const node = USSA_1976_CHECK_NODES[idx];
      const p = atHeight(res, node.geometricHeightM);
      // Давление: гидростатическое интегрирование vs таблица.
      // Допуск 1e-2: каталог молярных масс даёт Mbar = 28.9736 г/моль
      // против 28.9644 документа; различие накапливается по ~11 H.
      expect(Math.abs(p.pressurePa / node.pressurePa - 1)).toBeLessThan(0.01);
      // Температура: на границах слоёв совпадает с публикуемыми
      // значениями; последний узел: таблица 186.87 K, piecewise-модель
      // 186.946 K (расхождение 4e-4 относительного — документировано).
      expect(Math.abs(p.temperatureK / node.temperatureK - 1)).toBeLessThan(idx === 7 ? 5e-3 : 1e-7);
      // Плотность: пересчитывается из P, T, Mbar.
      expect(Math.abs(p.densityKgPerM3 / node.densityKgPerM3 - 1)).toBeLessThan(0.02);
    }
  });

  it('25. Венера: гидростатическое сравнение с VIRA-ориентирами (таблица not_verifiable)', () => {
    const v = VENUS_VIRA_ORIENTATION;
    expect(v.verificationStatus).toBe('orientation_anchors_only_not_verifiable');
    const nodes: { heightM: number; temperatureK: number }[] = [
      { heightM: 0, temperatureK: 737 },
      { heightM: 48000, temperatureK: 360 },
      { heightM: 100000, temperatureK: 178 }
    ];
    const input: HydrostaticColumnInput = {
      body: {
        bodyMassKg: v.body.bodyMassKg,
        referenceRadiusM: v.body.referenceRadiusM,
        provenance: v.body.provenance
      },
      surface: {
        surfacePressurePa: v.surfacePressurePa,
        pressureProvenance: { sourceName: 'VIRA-ориентир ~9.2 МПа (не табличная величина)' }
      },
      layers: [
        {
          layerId: 'venus_orientation',
          bottomHeightM: 0,
          topHeightM: 100000,
          temperature: { kind: 'measuredNodes', interpolation: 'linear', nodes },
          composition: { gases: v.composition.gases.map((g) => ({ ...g })), provenance: v.composition.provenance },
          provenance: v.provenance,
          applicability:
            'грубая ориентир-интерполяция якорей, НЕ таблица VIRA; только порядок величины P(z)'
        }
      ],
      requestedHeightsM: [48000, 100000]
    };
    const res = computeHydrostaticColumn(input);
    expect(res.status).toBe('completed');
    const completed = res as HydrostaticColumnCompleted;
    // Поверхность: якоря.
    expect(completed.profile[0].pressurePa).toBe(v.surfacePressurePa);
    expect(completed.profile[0].temperatureK).toBe(737);
    // Монотонность по профилю.
    for (let i = 1; i < completed.profile.length; i++) {
      expect(completed.profile[i].pressurePa).toBeLessThan(completed.profile[i - 1].pressurePa);
    }
    // Ориентир "около 1 бар на ~50 км": P(48 км) порядка 1e5 Па — грубая
    // проверка порядка, НЕ assertion точной таблицы VIRA.
    const p48 = completed.requestedHeightPoints.find((p) => p.heightM === 48000)!;
    expect(p48.pressurePa).toBeGreaterThan(5e4);
    expect(p48.pressurePa).toBeLessThan(4e5);
    const p100 = completed.requestedHeightPoints.find((p) => p.heightM === 100000)!;
    expect(p100.pressurePa).toBeGreaterThan(0);
    expect(p100.pressurePa).toBeLessThan(p48.pressurePa);
    // Не маскировать ограничение идеального газа: диагностика при >1 МПа.
    expect(completed.applicabilityDiagnostics.some((d) => d.includes('idealGasHighPressure'))).toBe(true);
  });

  it('26. Титан: якорь поверхности HASI, масштабная высота, диапазон сравнения', () => {
    const t = TITAN_HASI_SURFACE_ANCHOR;
    expect(t.verificationStatus).toBe('surface_anchor_verified_profile_not_verifiable');
    const input: HydrostaticColumnInput = {
      body: {
        bodyMassKg: t.body.bodyMassKg,
        referenceRadiusM: t.body.referenceRadiusM,
        provenance: t.body.provenance
      },
      surface: {
        surfacePressurePa: t.surface.pressurePa,
        pressureProvenance: {
          sourceName: 'Fulchignoni et al. 2005 (HASI): P = 1467 +/- 1 гПа',
          conditions: 'якорь поверхности зонда Huygens'
        }
      },
      layers: [
        {
          layerId: 'titan_isothermal_assumption',
          bottomHeightM: 0,
          topHeightM: 30000,
          temperature: { kind: 'isothermal', temperatureK: t.surface.temperatureK },
          composition: {
            gases: t.nearSurfaceComposition.gases.map((g) => ({ ...g })),
            provenance: t.nearSurfaceComposition.provenance
          },
          provenance: {
            sourceName: 'ЯВНОЕ модельное допущение изотермы для проверки якоря',
            limitations: 'НЕ данные HASI выше поверхности; профиль HASI not_verifiable в этой сессии'
          }
        }
      ],
      requestedHeightsM: [20000]
    };
    const res = computeHydrostaticColumn(input);
    expect(res.status).toBe('completed');
    const completed = res as HydrostaticColumnCompleted;
    // Якорь поверхности HASI: T = 93.65 K, P = 1.467e5 Па.
    expect(completed.profile[0].temperatureK).toBe(93.65);
    expect(completed.profile[0].pressurePa).toBe(1.467e5);
    // Масштабная высота Титана: порядок 2e4 м (грубая проверка якоря и состава).
    const H = completed.profile[0].scaleHeightM;
    expect(H).toBeGreaterThan(15000);
    expect(H).toBeLessThan(27000);
    const p20 = completed.requestedHeightPoints[0];
    expect(p20.pressurePa).toBeGreaterThan(t.surface.pressurePa * 0.2);
    expect(p20.pressurePa).toBeLessThan(t.surface.pressurePa * 0.6);
  });

  it('27. сравнение выполняется по профилю P(z), не только по поверхности', () => {
    const res = runEarth();
    // Минимум 8 высот сравниваются гидростатически: границы всех семи слоёв.
    let compared = 0;
    for (const node of USSA_1976_CHECK_NODES) {
      const p = res.profile.find((q) => Math.abs(q.heightM - node.geometricHeightM) < 0.5);
      if (p !== undefined) compared += 1;
      expect(p !== undefined).toBe(true);
      if (node.geometricHeightM > 0) {
        const point = p!;
        expect(point.pressurePa).toBeLessThan(101325);
      }
    }
    expect(compared).toBeGreaterThanOrEqual(8);
  });

  it('28. P(z) предсказывается интегрированием, T(z) наблюдений не подгоняется', () => {
    // Методологическая проверка: масштабирование входного P0 ровно на 1.01
    // ровно во столько же раз масштабирует предсказанное P на ВСЕХ высотах:
    // давление вычисляется гидростатически, а не читается из таблицы.
    const base = runEarth();
    const scaled = expectCompleted(computeHydrostaticColumn(ussaEarthInput(1.01)));
    expect(scaled.profile.length).toBe(base.profile.length);
    for (let i = 0; i < base.profile.length; i++) {
      expect(scaled.profile[i].heightM).toBe(base.profile[i].heightM);
      expect(scaled.profile[i].pressurePa / base.profile[i].pressurePa).toBeCloseTo(1.01, 9);
      // Температура при этом НЕ изменилась: T(z) — вход, а не подгонка.
      expect(scaled.profile[i].temperatureK).toBe(base.profile[i].temperatureK);
    }
  });
});
