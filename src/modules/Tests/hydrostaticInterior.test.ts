// ============================================
// ТЕСТЫ — Гидростатическая структура + PREM (Stage 4.7.2)
// ============================================
// Проверяются:
//  - уравнения dm/dr = 4πr²ρ, dP/dr = −G·m·ρ/r², g = G·m/r²;
//  - однородная сфера против аналитики Pc = (2π/3)·G·ρ²·R²;
//  - PREM: эталонные плотности Table I в характерных точках, масса и
//    момент инерции против ИСХОДНЫХ ОГРАНИЧЕНИЙ статьи (5.974e24 kg,
//    I/(MR²) = 0.3308);
//  - центральное давление: опубликовано 363.8521 GPa (Table II,
//    3638.521 kbar); собственная интеграция даёт ≈364.09 GPa
//    (G = 6.6743e-11 CODATA 2018); отклонение ≈0.065% — в пределах 1%.
//    Подгонка коэффициентов/алгоритма под 363.8521 GPa исключена:
//    значения интеграции и табличное значение СОПАВЛЯЮТСЯ, не отождествляются.
//  - непрерывность m и P на всех границах слоёв, допустимые скачки плотности;
//  - регулярный центр r = 0 без деления на ноль, g → 0 в центре;
//  - измельчение шага (сходимость по шагу), детерминизм;
//  - fail-closed: некорректные входы, дробная/нулевая плотность, зазоры слоёв.
//
// ОГРАНИЧЕНИЕ: гидростатическая реконструкция по ЗАДАННОМУ профилю
// плотности — НЕ EOS-предсказание горячей Земли.

import { describe, it, expect } from 'vitest';
import {
  solveHydrostaticInterior,
  GRAVITATIONAL_CONSTANT_M3_KG_S2,
  HYDROSTATIC_NUMERICAL_METHOD,
  type HydrostaticLayer
} from '../Core/hydrostaticInterior';
import {
  PREM_LAYERS,
  PREM_MEAN_RADIUS_M,
  PREM_CENTRAL_PRESSURE_PUBLISHED_PA,
  PREM_TOTAL_MASS_CONSTRAINT_KG,
  PREM_MOMENT_OF_INERTIA_FACTOR_CONSTRAINT,
  PREM_REFERENCE_SOURCE,
  premDensityKgM3,
  premDensityGcm3,
  validatePremCatalog,
  solvePremHydrostaticInterior
} from '../Data/premReference';

function assertRel(actual: number, expected: number, digits = 10): void {
  expect(actual / expected).toBeCloseTo(1, digits);
}

function assertCompleted(
  result: ReturnType<typeof solveHydrostaticInterior>
): asserts result is Extract<ReturnType<typeof solveHydrostaticInterior>, { status: 'completed' }> {
  if (result.status !== 'completed') {
    throw new Error(`ожидается completed, получено ${result.status}: ${JSON.stringify(result).slice(0, 500)}`);
  }
}

function uniformSphereLayer(rhoKgM3: number, radiusM: number): HydrostaticLayer {
  return {
    id: 'uniform-sphere',
    displayName: 'Однородная сфера (тестовый слой)',
    radiusMinM: 0,
    radiusMaxM: radiusM,
    densityKgM3At: () => rhoKgM3
  };
}

describe('Stage 4.7.2: однородная сфера (аналитическая эталон)', () => {
  it('сценарий H1: центральное давление однородной сферы = (2π/3)·G·ρ²·R²', () => {
    const rho = 5515; // кг/м³, иллюстративная средняя плотность
    const R = 6371000;
    const analyticPc = ((2 * Math.PI) / 3) * GRAVITATIONAL_CONSTANT_M3_KG_S2 * rho * rho * R * R;
    const result = solveHydrostaticInterior([uniformSphereLayer(rho, R)], { stepsPerLayer: 2048 });
    assertCompleted(result);
    // RK4, 2048 шагов: относительная ошибка < 1e-8
    expect(Math.abs(result.centralPressurePa - analyticPc) / analyticPc).toBeLessThan(1e-8);
    // масса: (4/3)πρR³
    const analyticMass = (4 / 3) * Math.PI * rho * Math.pow(R, 3);
    assertRel(result.totalMassKg, analyticMass, 9);
    // однородная сфера: I/(MR²) = 2/5
    assertRel(result.momentOfInertiaFactor, 0.4, 5);
    // g(R) = GM/R², g(0) = 0
    const nodes = result.nodes;
    assertRel(nodes[nodes.length - 1].gravityMS2, GRAVITATIONAL_CONSTANT_M3_KG_S2 * analyticMass / (R * R), 9);
    expect(nodes[0].gravityMS2).toBe(0);
    expect(nodes[0].radiusM).toBe(0);
    // P(R) = поверхностное, P монотонно растёт к центру (узлы — по
    // возрастанию радиуса, поэтому при росте индекса P строго убывает)
    expect(nodes[nodes.length - 1].pressurePa).toBe(0);
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i].onLayerBoundary) continue; // дубликаты границ имеют равное P
      expect(nodes[i].pressurePa).toBeLessThan(nodes[i - 1].pressurePa);
    }
  });

  it('сценарий H2: сходимость шага RK4 ~ h⁴ на неполиномиальном профиле плотности', () => {
    // ВАЖНО: для кусочно-полиномиальной плотности RK4 точен (правая часть —
    // полином ≤ 4-й степени), поэтому проверка сходимости по измельчению шага
    // выполняется на гладком НЕполиномиальном профиле ρ(r) = ρc·exp(−3r/R).
    // Порядок схемы 4: при измельчении шага в 4 раза ошибка падает в ~256 раз.
    const rhoC = 12000;
    const R = 6371000;
    const expLayer: HydrostaticLayer = {
      id: 'exp-profile',
      displayName: 'Экспоненциальный профиль плотности (тест сходимости)',
      radiusMinM: 0,
      radiusMaxM: R,
      densityKgM3At: (r: number) => rhoC * Math.exp((-3 * r) / R)
    };
    const coarse = solveHydrostaticInterior([expLayer], { stepsPerLayer: 32 });
    const mid = solveHydrostaticInterior([expLayer], { stepsPerLayer: 128 });
    const fine = solveHydrostaticInterior([expLayer], { stepsPerLayer: 512 });
    assertCompleted(coarse);
    assertCompleted(mid);
    assertCompleted(fine);
    const errCoarse = Math.abs(coarse.centralPressurePa - fine.centralPressurePa) / fine.centralPressurePa;
    const errMid = Math.abs(mid.centralPressurePa - fine.centralPressurePa) / fine.centralPressurePa;
    expect(errCoarse).toBeGreaterThan(1e-7);
    expect(errMid).toBeLessThan(1e-7);
    expect(errCoarse / errMid).toBeGreaterThan(32);
    expect(coarse.convergence.converged || mid.convergence.converged || fine.convergence.converged).toBe(true);
  });
});

describe('Stage 4.7.2: модуль PREM (данные Table I)', () => {
  it('сценарий H3: каталог PREM валиден и покрывает [0, a] без зазоров', () => {
    expect(validatePremCatalog()).toHaveLength(0);
    expect(PREM_LAYERS.length).toBe(12);
    expect(PREM_LAYERS[0].radiusMinM).toBe(0);
    expect(PREM_LAYERS[PREM_LAYERS.length - 1].radiusMaxM).toBe(PREM_MEAN_RADIUS_M);
    for (let i = 1; i < PREM_LAYERS.length; i++) {
      expect(PREM_LAYERS[i].radiusMinM).toBe(PREM_LAYERS[i - 1].radiusMaxM);
    }
  });

  it('сценарий H4: плотности PREM в характерных точках Table I', () => {
    // центр: 13.0885 г/см³ = 13088.5 кг/м³
    assertRel(premDensityKgM3(0) as number, 13088.5, 12);
    // CMB: скачок плотности по полиномам первоисточника (ядро → мантия)
    const rhoCoreSideCmb = premDensityGcm3(3480000 / PREM_MEAN_RADIUS_M, PREM_LAYERS[1].densityPolyCoefficientsGcm3) * 1000;
    const rhoMantleCmb = premDensityGcm3(3480000 / PREM_MEAN_RADIUS_M, PREM_LAYERS[2].densityPolyCoefficientsGcm3) * 1000;
    expect(rhoCoreSideCmb).toBeGreaterThan(rhoMantleCmb); // скачок плотности на CMB допустим
    assertRel(rhoCoreSideCmb, 9903.438401183957, 9);
    // поверхность (океан): 1.02 г/см³ = 1020 кг/м³
    assertRel(premDensityKgM3(PREM_MEAN_RADIUS_M) as number, 1020, 12);
    // ICB r=1221.5 км — граница внутреннего ядра по её полиному
    const xIcb = 1221500 / PREM_MEAN_RADIUS_M;
    assertRel(
      premDensityGcm3(xIcb, PREM_LAYERS[0].densityPolyCoefficientsGcm3) * 1000,
      (13.0885 - 8.8381 * xIcb * xIcb) * 1000,
      12
    );
    // внешние радиусы дают null
    expect(premDensityKgM3(-1)).toBeNull();
    expect(premDensityKgM3(PREM_MEAN_RADIUS_M + 1)).toBeNull();
    expect(premDensityKgM3(Number.NaN)).toBeNull();
  });

  it('сценарий H5: масса PREM против исходного ограничения статьи (5.974e24 kg)', () => {
    const result = solvePremHydrostaticInterior({ stepsPerLayer: 512 });
    assertCompleted(result);
    // Собственная интеграция: ≈5.97318e24 kg (см. независимый аналитический
    // пересчёт: 5.9731769e24). Ограничение статьи округлено: 5.974e24 →
    // сравнение с допуском 0.05% (точность публикации ограничения).
    expect(result.totalMassKg).toBeGreaterThan(0);
    assertRel(result.totalMassKg, 5.973176947921336e24, 9); // воспроизводимость собственного интегратора
    expect(Math.abs(result.totalMassKg - PREM_TOTAL_MASS_CONSTRAINT_KG) / PREM_TOTAL_MASS_CONSTRAINT_KG).toBeLessThan(5e-4);
  });

  it('сценарий H6: нормированный момент инерции PREM против ограничения (0.3308)', () => {
    const result = solvePremHydrostaticInterior({ stepsPerLayer: 512 });
    assertCompleted(result);
    // Собственная интеграция: ≈0.33079949 (аналитический пересчёт); ограничение статьи 0.3308.
    assertRel(result.momentOfInertiaFactor, 0.33079949, 7);
    expect(Math.abs(result.momentOfInertiaFactor - PREM_MOMENT_OF_INERTIA_FACTOR_CONSTRAINT)).toBeLessThan(5e-4);
  });

  it('сценарий H7: центральное давление PREM: опубликовано 363.8521 GPa, интеграция ≈364.09 GPa, отклонение ≤1%', () => {
    const result = solvePremHydrostaticInterior({ stepsPerLayer: 512 });
    assertCompleted(result);
    // Чёткое разделение ПУБЛИКУЕМОГО бенмарка и СОБСТВЕННОЙ интеграции:
    const publishedPa = PREM_CENTRAL_PRESSURE_PUBLISHED_PA; // Table II: 3638.521 kbar
    const ownPa = result.centralPressurePa;
    // собственное значение воспроизводимо и близко к аналитическому пересчёту
    assertRel(ownPa, 364.0899953977521e9, 9);
    // относительное отклонение от опубликованного ≤ 1% (фактически ≈0.065%)
    const relativeDeviation = Math.abs(ownPa - publishedPa) / publishedPa;
    expect(relativeDeviation).toBeLessThan(0.01);
    expect(relativeDeviation).toBeGreaterThan(0); // это НЕ одно и то же число
    expect(relativeDeviation).toBeLessThan(1e-3); // и не ошибка, а честная разница реконструкций
    // гравитационная константа солвера = CODATA 2018 (6.6743e-11)
    expect(result.gravitationalConstantM3KgS2).toBe(GRAVITATIONAL_CONSTANT_M3_KG_S2);
    expect(result.source.sourceDetail).toContain('10.1016/0031-9201(81)90046-7');
    // сходимость по шагу в пределах объявленного допуска
    expect(result.convergence.converged).toBe(true);
    expect(result.convergence.centralPressureRelativeChange).toBeLessThan(1e-6);
    expect(result.convergence.totalMassRelativeChange).toBeLessThan(1e-6);
  });

  it('сценарий H8: непрерывность m и P на всех границах слоёв; скачки плотности допустимы', () => {
    const result = solvePremHydrostaticInterior({ stepsPerLayer: 256 });
    assertCompleted(result);
    const nodes = result.nodes;
    // узлов: по (N+1) на слой
    expect(nodes.length).toBe(12 * 257);
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1];
      const cur = nodes[i];
      if (cur.onLayerBoundary) {
        // дубликат радиальной точки на границе слоя: m и P идентичны,
        // плотность может скачком меняться
        expect(cur.radiusM).toBe(prev.radiusM);
        assertRel(cur.massKg, prev.massKg, 12);
        assertRel(cur.pressurePa, prev.pressurePa, 12);
      } else {
        expect(cur.radiusM).toBeGreaterThan(prev.radiusM);
        // m строго монотонно растёт, P строго падает наружу
        expect(cur.massKg).toBeGreaterThanOrEqual(prev.massKg);
        expect(cur.pressurePa).toBeLessThanOrEqual(prev.pressurePa);
      }
      // g и плотность конечны
      expect(Number.isFinite(cur.gravityMS2)).toBe(true);
      expect(Number.isFinite(cur.densityKgM3)).toBe(true);
      expect(cur.densityKgM3).toBeGreaterThan(0);
    }
    // самый глубокий скачок — CMB: плотность падает от ядра к мантии
    const cmbTop = nodes[2 * 257 - 1]; // конец слоя внешнего ядра (слой 2, индекс 1 → 2*257−1)
    const cmbBottom = nodes[2 * 257]; // первый узел слоя-D″ (дубликат той же точки)
    expect(cmbBottom.layerId).toBe('prem-lower-mantle-dpp');
    // ВАЖНО: premDensityKgM3 на точной границе слоя приписывает значение
    // ВНЕШНЕМУ (предыдущему) слою (конвенция r <= radiusMaxM при скане от
    // центра), поэтому для узла D″ ожидаемая плотность берётся из полинома
    // самого D″-слоя в точке CMB, а для cmbTop — из полинома внешнего ядра
    // (то есть premDensityKgM3(3480000)).
    const dppLayer = PREM_LAYERS.find((l) => l.id === 'prem-lower-mantle-dpp');
    if (!dppLayer) throw new Error('слой prem-lower-mantle-dpp отсутствует в каталоге');
    const xCMB = 3480000 / PREM_MEAN_RADIUS_M;
    assertRel(cmbBottom.densityKgM3, premDensityGcm3(xCMB, dppLayer.densityPolyCoefficientsGcm3) * 1000, 12);
    assertRel(cmbTop.densityKgM3, 9903.438401183957, 9);
    // при этом m и P совпадают (непрерывны)
    assertRel(cmbTop.massKg, cmbBottom.massKg, 12);
    assertRel(cmbTop.pressurePa, cmbBottom.pressurePa, 12);
  });

  it('сценарий H9: регулярный центр: r = 0 корректен, g → 0, нет деления на ноль', () => {
    const result = solvePremHydrostaticInterior({ stepsPerLayer: 64 });
    assertCompleted(result);
    const center = result.nodes[0];
    expect(center.radiusM).toBe(0);
    expect(center.massKg).toBe(0);
    expect(center.gravityMS2).toBe(0);
    expect(Number.isFinite(center.pressurePa)).toBe(true);
    expect(center.pressurePa).toBe(result.centralPressurePa);
    // g мала вблизи центра и растёт наружу до максимума у CMB
    const near = result.nodes.slice(1, 4);
    for (const node of near) {
      expect(node.gravityMS2).toBeGreaterThan(0);
      expect(node.gravityMS2).toBeLessThan(11);
    }
    // максимум g внутри: у границы ядро-мантия (качественная проверка)
    const gCmbLayerNode = result.nodes[2 * 65 - 1];
    expect(gCmbLayerNode.gravityMS2).toBeGreaterThan(10);
    expect(gCmbLayerNode.gravityMS2).toBeLessThan(12);
  });

  it('сценарий H10: детерминизм — два независимых вызова дают побитово равный результат', () => {
    const a = solvePremHydrostaticInterior({ stepsPerLayer: 128 });
    const b = solvePremHydrostaticInterior({ stepsPerLayer: 128 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('сценарий H11: fail-closed: некорректные входы и опции', () => {
    // пустой список слоёв
    expect(solveHydrostaticInterior([]).status).toBe('invalid_input');
    // зазор между слоями
    const gapped: HydrostaticLayer[] = [
      uniformSphereLayer(5000, 1000000),
      { ...uniformSphereLayer(5000, 2000000), id: 'second', radiusMinM: 1500000 }
    ];
    const gapResult = solveHydrostaticInterior(gapped);
    expect(gapResult.status).toBe('invalid_input');
    if (gapResult.status === 'invalid_input') {
      expect(gapResult.issues.join(' ')).toContain('зазор');
    }
    // первый слой не из центра
    const offCenter: HydrostaticLayer[] = [{ ...uniformSphereLayer(5000, 1000000), radiusMinM: 1 }];
    expect(solveHydrostaticInterior(offCenter).status).toBe('invalid_input');
    // некорректные опции
    expect(solvePremHydrostaticInterior({ stepsPerLayer: 3 }).status).toBe('invalid_input');
    expect(solvePremHydrostaticInterior({ stepsPerLayer: Number.NaN }).status).toBe('invalid_input');
    expect(solvePremHydrostaticInterior({ refinementFactor: 1 }).status).toBe('invalid_input');
    expect(solvePremHydrostaticInterior({ surfacePressurePa: Number.POSITIVE_INFINITY }).status).toBe('invalid_input');
  });

  it('сценарий H12: сбои модели плотности → out_of_applicability, механические сбои и структурированная отчётность', () => {
    // callback возвращает нечисловую плотность: модель не применима
    const badLayer: HydrostaticLayer = {
      ...uniformSphereLayer(5000, 1000000),
      densityKgM3At: (r: number) => (r > 500000 ? Number.NaN : 5000)
    };
    const badResult = solveHydrostaticInterior([badLayer]);
    expect(badResult.status).toBe('out_of_applicability');
    if (badResult.status === 'out_of_applicability') {
      expect(badResult.detail.stage).toBe('density_model_evaluation');
    }
    // отрицательная плотность — тоже отказ (модель не применима), а не тихий расчёт
    const negLayer: HydrostaticLayer = {
      ...uniformSphereLayer(5000, 1000000),
      densityKgM3At: () => -1
    };
    expect(solveHydrostaticInterior([negLayer]).status).toBe('out_of_applicability');
    // отчётные поля completed: метод, источник, слои, конвергенция
    const ok = solvePremHydrostaticInterior({ stepsPerLayer: 64 });
    assertCompleted(ok);
    expect(ok.numericalMethod).toBe(HYDROSTATIC_NUMERICAL_METHOD);
    expect(ok.source.sourceName).toBe(PREM_REFERENCE_SOURCE.sourceName);
    expect(ok.layerIds).toEqual(PREM_LAYERS.map((l) => l.id));
    expect(ok.outerRadiusM).toBe(PREM_MEAN_RADIUS_M);
    // средняя плотность согласована с массой и радиусом
    const meanFromMass = ok.totalMassKg / ((4 / 3) * Math.PI * Math.pow(ok.outerRadiusM, 3));
    assertRel(ok.meanDensityKgM3, meanFromMass, 12);
    // поверхностное давление по умолчанию 0; ненулевое поверхностное смещает все P
    const withSurface = solvePremHydrostaticInterior({ stepsPerLayer: 64, surfacePressurePa: 1e5 });
    assertCompleted(withSurface);
    assertRel(withSurface.centralPressurePa, ok.centralPressurePa + 1e5, 12);
  });
});
