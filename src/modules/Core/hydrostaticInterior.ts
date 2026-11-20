/**
 * ============================================================
 * ГИДРОСТАТИЧЕСКАЯ СТРУКТУРА СФЕРИЧЕСКИ-СИММЕТРИЧНОГО ТЕЛА
 * (Stage 4.7.2)
 * ============================================================
 *
 * Уравнения гидростатического равновесия в сферической геометрии:
 *
 *   dm/dr = 4π r² ρ(r)            (массовая функция)
 *   dP/dr = −G·m(r)·ρ(r) / r²     (гидростатика)
 *   g(r)  = G·m(r) / r²           (гравитационное ускорение)
 *
 * МЕТОД. Система не решается одной «стрельбой»: m задаётся задачей
 * Коши от центра (m(0) = 0), а P — краевым условием на поверхности
 * (P(R) = P_surface, по умолчанию 0). Вместо стрельбы используется
 * ДВУХПРОХОДНАЯ детерминированная схема без итераций согласования:
 *   1) прямой проход: m(r) и моментный интеграл I(r) интегрируются
 *      наружу классическим RK4 с фиксированным шагом;
 *   2) обратный проход: P интегрируется внутрь тем же RK4 (dr < 0),
 *      правая часть использует m(r) из прямого прохода: значения m на
 *      узлах и серединах шагов разделяются между проходами, схема
 *      согласована по сетке.
 *
 * ГРАНИЦЫ СЛОЁВ — обязательные точки разрыва сетки: шаги интегратора
 * никогда не пересекают границу слоя (никаких «мега-шагов» через
 * скачок плотности). Скачки плотности на границах допускаются; m и P
 * непрерывны (гарантируется построением и проверяется тестами), g
 * непрерывна как функция m и r.
 *
 * РЕГУЛЯРНОСТЬ ЦЕНТРА: в точности r = 0 правые части доопределены
 * (dP/dr = 0, g = 0), деления на ноль нет: m(r) ∝ r³, поэтому
 * G·m/r² → 0 при r → 0.
 *
 * ГРАВИТАЦИОННАЯ ПОСТОЯННАЯ: G = 6.6743e-11 м³·кг⁻¹·с⁻² (CODATA 2018,
 * Tiesinga et al., Rev. Mod. Phys. 93, 025010 (2021)). Единственное
 * место определения G в модуле; дублирования констант нет.
 *
 * СХОДИМОСТЬ: решение повторяется с измельчением шага
 * (refinementFactor); относительное изменение центрального давления и
 * полной массы сравнивается с tolerance. Сходимость РАПОРТУЕТСЯ, а не
 * навязывается: converged = |ΔPc| ≤ tol И |ΔM| ≤ tol.
 *
 * ОГРАНИЧЕНИЕ: это реконструкция по ЗАДАННОМУ профилю плотности, а не
 * EOS-модель. Архитектура расширяема до будущего EOS-driven слоистого
 * solver (слои с собственным уравнением состояния), но такой solver
 * ещё не реализован.
 */

/** Гравитационная постоянная G, м³·кг⁻¹·с⁻² (CODATA 2018). */
export const GRAVITATIONAL_CONSTANT_M3_KG_S2 = 6.6743e-11;

/** Слой модели: участок [radiusMinM, radiusMaxM] с заданной плотностью. */
export interface HydrostaticLayer {
  readonly id: string;
  readonly displayName: string;
  readonly radiusMinM: number;
  readonly radiusMaxM: number;
  /** Плотность кг/м³; обязана быть конечной и положительной внутри слоя. */
  readonly densityKgM3At: (radiusM: number) => number;
}

export interface HydrostaticSolverOptions {
  /** Шагов на слой (по умолчанию 512). */
  readonly stepsPerLayer?: number;
  /** Фактор измельчения для проверки сходимости (по умолчанию 2). */
  readonly refinementFactor?: number;
  /** Относительный допуск сходимости (по умолчанию 1e-6). */
  readonly convergenceRelativeTolerance?: number;
  /** Поверхностное давление, Па (по умолчанию 0). */
  readonly surfacePressurePa?: number;
}

export interface HydrostaticNode {
  readonly radiusM: number;
  readonly densityKgM3: number;
  readonly massKg: number;
  readonly gravityMS2: number;
  readonly pressurePa: number;
  readonly layerId: string;
  readonly onLayerBoundary: boolean;
}

export interface HydrostaticConvergence {
  readonly stepsPerLayer: number;
  readonly refinementFactor: number;
  readonly refinedStepsPerLayer: number;
  readonly relativeTolerance: number;
  readonly centralPressureRelativeChange: number;
  readonly totalMassRelativeChange: number;
  readonly converged: boolean;
}

export interface HydrostaticSource {
  readonly sourceName: string;
  readonly sourceDetail: string;
}

export interface HydrostaticCompleted {
  readonly status: 'completed';
  readonly nodes: readonly HydrostaticNode[];
  readonly centralPressurePa: number;
  readonly totalMassKg: number;
  /** Нормированный осевой момент инерции I/(M·R_outer²), безразмерный. */
  readonly momentOfInertiaFactor: number;
  readonly outerRadiusM: number;
  readonly meanDensityKgM3: number;
  readonly surfacePressurePa: number;
  readonly gravitationalConstantM3KgS2: number;
  readonly numericalMethod: string;
  readonly convergence: HydrostaticConvergence;
  readonly layerIds: readonly string[];
  readonly source: HydrostaticSource;
}

export interface HydrostaticInvalid {
  readonly status: 'invalid_input';
  readonly issues: readonly string[];
}

export interface HydrostaticOutOfApplicability {
  readonly status: 'out_of_applicability';
  readonly reason: string;
  readonly detail: Readonly<Record<string, number | string | boolean | null>>;
}

export interface HydrostaticNumericalFailure {
  readonly status: 'numerical_failure';
  readonly reason: string;
  readonly stage: string;
}

export type HydrostaticInteriorResult =
  | HydrostaticCompleted
  | HydrostaticInvalid
  | HydrostaticOutOfApplicability
  | HydrostaticNumericalFailure;

export const HYDROSTATIC_NUMERICAL_METHOD =
  'двухпроходный RK4 с фиксированным шагом: (m, I) наружу от центра, P внутрь от поверхности; ' +
  'масса середины шага уточняется двумя полушагами RK4 (иначе P-проход деградирует до 2-го порядка); ' +
  'границы слоёв — обязательные точки разрыва сетки; сходимость проверяется измельчением шага';

const DEFAULT_STEPS_PER_LAYER = 512;
const DEFAULT_REFINEMENT_FACTOR = 2;
const DEFAULT_TOLERANCE = 1e-6;
const MIN_STEPS_PER_LAYER = 4;
const MAX_STEPS_PER_LAYER = 100000;

/** Структура записи шага: узлы и середина с разделяемыми m-значениями. */
interface StepSample {
  readonly r0: number;
  readonly rm: number;
  readonly r1: number;
  readonly m0: number;
  readonly mm: number;
  readonly m1: number;
}

interface OutwardPass {
  /**
   * Сэмплы по слоям: слой li, шаг s → samples[li * stepsPerLayer + s].
   * Узловые массивы: слой li занимает indices [li*(N+1), (li+1)*(N+1) − 1];
   * первый узел слоя li (li > 0) — дубликат последнего узла слоя li − 1
   * (одна и та же радиальная точка, две стороны скачка плотности).
   */
  readonly samples: readonly StepSample[];
  readonly nodeRadiiM: readonly number[];
  readonly nodeMassKg: readonly number[];
  readonly nodeMomentInertiaKgM2: readonly number[];
  readonly totalMassKg: number;
  readonly totalMomentInertiaKgM2: number;
}

interface ResolvedHydrostaticOptions {
  readonly stepsPerLayer: number;
  readonly refinementFactor: number;
  readonly relativeTolerance: number;
  readonly surfacePressurePa: number;
}

function resolveHydrostaticOptions(
  options?: HydrostaticSolverOptions
): ResolvedHydrostaticOptions | readonly string[] {
  const issues: string[] = [];
  const stepsPerLayer = options?.stepsPerLayer ?? DEFAULT_STEPS_PER_LAYER;
  const refinementFactor = options?.refinementFactor ?? DEFAULT_REFINEMENT_FACTOR;
  const relativeTolerance = options?.convergenceRelativeTolerance ?? DEFAULT_TOLERANCE;
  const surfacePressurePa = options?.surfacePressurePa ?? 0;
  if (typeof stepsPerLayer !== 'number' || !Number.isInteger(stepsPerLayer) || stepsPerLayer < MIN_STEPS_PER_LAYER) {
    issues.push(`stepsPerLayer обязано быть целым ≥ ${MIN_STEPS_PER_LAYER}`);
  } else if (stepsPerLayer > MAX_STEPS_PER_LAYER) {
    issues.push(`stepsPerLayer не должно превышать ${MAX_STEPS_PER_LAYER}`);
  }
  if (typeof refinementFactor !== 'number' || !Number.isFinite(refinementFactor) || refinementFactor <= 1) {
    issues.push('refinementFactor обязано быть конечным числом > 1');
  }
  if (typeof relativeTolerance !== 'number' || !Number.isFinite(relativeTolerance) || relativeTolerance <= 0) {
    issues.push('convergenceRelativeTolerance обязано быть конечным числом > 0');
  }
  if (typeof surfacePressurePa !== 'number' || !Number.isFinite(surfacePressurePa)) {
    issues.push('surfacePressurePa обязано быть конечным числом');
  }
  if (issues.length > 0) return issues;
  return { stepsPerLayer, refinementFactor, relativeTolerance, surfacePressurePa };
}

/**
 * Прямой проход: m(r) и I(r) наружу, RK4 по слоям, границы слоёв — точки
 * разрыва сетки. КЛЮЧЕВОЙ момент корректности: масса слоя накапливается
 * от массы на его ВНУТРЕННЕЙ границе (в слое масса не начинается с нуля,
 * кроме самого центрального слоя).
 */
function integrateOutward(
  layers: readonly HydrostaticLayer[],
  stepsPerLayer: number
): OutwardPass | string {
  const samples: StepSample[] = [];
  const nodeRadiiM: number[] = [];
  const nodeMassKg: number[] = [];
  const nodeMomentInertiaKgM2: number[] = [];
  const pi = Math.PI;

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const h = (layer.radiusMaxM - layer.radiusMinM) / stepsPerLayer;
    // Масса и моментный интеграл на внутренней границе слоя: 0 только у
    // центрального слоя; каждый следующий слой НАСЛЕДУЕТ накопленное.
    let m = li === 0 ? 0 : nodeMassKg[nodeMassKg.length - 1];
    let inertia = li === 0 ? 0 : nodeMomentInertiaKgM2[nodeMomentInertiaKgM2.length - 1];
    let r = layer.radiusMinM;
    nodeRadiiM.push(r);
    nodeMassKg.push(m);
    nodeMomentInertiaKgM2.push(inertia);

    const massRate = (radius: number): number => {
      const rho = layer.densityKgM3At(radius);
      if (!Number.isFinite(rho) || rho <= 0) return NaN;
      return 4 * pi * radius * radius * rho;
    };
    const inertiaRate = (radius: number): number => {
      const rho = layer.densityKgM3At(radius);
      if (!Number.isFinite(rho) || rho <= 0) return NaN;
      return ((8 * pi) / 3) * Math.pow(radius, 4) * rho;
    };

    for (let s = 0; s < stepsPerLayer; s++) {
      const r0 = r;
      const rm = r0 + 0.5 * h;
      const r1 = r0 + h;
      const k1m = massRate(r0);
      const k2m = massRate(rm);
      const k4m = massRate(r1);
      const k1i = inertiaRate(r0);
      const k2i = inertiaRate(rm);
      const k4i = inertiaRate(r1);
      // Точная (до порядка схемы) масса середины шага: два полушага RK4 по
      // h/4. Эйлерова оценка m0 + (h/2)·k1m имеет ошибку O(h²), что
      // деградирует обратный P-проход до 2-го порядка; полушаги сохраняют
      // 4-й порядок всей двухпроходной схемы.
      const quarter = 0.25 * h;
      const rmQuarter = r0 + quarter;
      const rmEighth = r0 + 0.125 * h;
      const rm3Eighth = r0 + 0.375 * h;
      const q1 = massRate(r0);
      const q2 = massRate(rmEighth);
      const q4 = massRate(rmQuarter);
      const mQuarter = m + (quarter / 6) * (q1 + 4 * q2 + q4);
      const q5 = massRate(rmQuarter);
      const q6 = massRate(rm3Eighth);
      const q7 = massRate(rm);
      const mMid = mQuarter + (quarter / 6) * (q5 + 4 * q6 + q7);
      const mEnd = m + (h / 6) * (k1m + 4 * k2m + k4m);
      const inertiaEnd = inertia + (h / 6) * (k1i + 4 * k2i + k4i);
      if (!Number.isFinite(mMid) || !Number.isFinite(mEnd) || !Number.isFinite(inertiaEnd)) {
        return `некорректная плотность (не число или не положительна) в слое ${layer.id}: интегрирование массы прервано`;
      }
      samples.push({ r0, rm, r1, m0: m, mm: mMid, m1: mEnd });
      m = mEnd;
      inertia = inertiaEnd;
      r = r1;
      nodeRadiiM.push(r1);
      nodeMassKg.push(m);
      nodeMomentInertiaKgM2.push(inertia);
    }
  }
  return {
    samples,
    nodeRadiiM,
    nodeMassKg,
    nodeMomentInertiaKgM2,
    totalMassKg: nodeMassKg[nodeMassKg.length - 1],
    totalMomentInertiaKgM2: nodeMomentInertiaKgM2[nodeMomentInertiaKgM2.length - 1]
  };
}

/**
 * Обратный проход: P внутрь от поверхности (RK4, dr < 0) с m(r) из
 * прямого прохода. Возвращает давление во всех узлах (в том же порядке,
 * что nodeRadiiM) и центральное давление.
 */
function integratePressureInward(
  pass: OutwardPass,
  layers: readonly HydrostaticLayer[],
  stepsPerLayer: number,
  surfacePressurePa: number,
  gConst: number
): { nodePressurePa: number[]; centralPressurePa: number } | string {
  const layerCount = layers.length;
  const nodesPerLayer = stepsPerLayer + 1;
  const totalNodes = layerCount * nodesPerLayer;
  const nodePressurePa: number[] = new Array<number>(totalNodes).fill(0);

  // Правая часть dP/dr на интегрировании внутрь; регулярный центр r = 0.
  const pressureRate = (radius: number, massKg: number, layerIndex: number): number => {
    if (radius <= 0) {
      return 0; // m ∝ r³ → G·m/r² → 0: регулярный центр, деления на ноль нет
    }
    const rho = layers[layerIndex].densityKgM3At(radius);
    if (!Number.isFinite(rho) || rho <= 0) return NaN;
    return -(gConst * massKg * rho) / (radius * radius);
  };

  for (let li = layerCount - 1; li >= 0; li--) {
    const base = li * nodesPerLayer;
    // Давление на внешней границе слоя: поверхность для внешнего слоя,
    // иначе — уже вычисленное давление на общей границе (непрерывность P;
    // дублированный узел получает то же значение).
    const pOuterBoundary = li === layerCount - 1 ? surfacePressurePa : nodePressurePa[base + nodesPerLayer];
    nodePressurePa[base + stepsPerLayer] = pOuterBoundary;
    let pOuter = pOuterBoundary;
    for (let s = stepsPerLayer - 1; s >= 0; s--) {
      const sample = pass.samples[li * stepsPerLayer + s];
      const h = sample.r0 - sample.r1; // отрицательный
      const layerIndex = li;
      const k1 = pressureRate(sample.r1, sample.m1, layerIndex);
      const k2 = pressureRate(sample.rm, sample.mm, layerIndex);
      const k4 = pressureRate(sample.r0, sample.m0, layerIndex);
      const pInner = pOuter + (h / 6) * (k1 + 2 * k2 + 2 * k2 + k4);
      if (!Number.isFinite(pInner)) {
        return `барическая интеграция прервана: некорректная плотность или расходящийся шаг в слое ${layers[li].id}`;
      }
      nodePressurePa[base + s] = pInner;
      pOuter = pInner;
    }
  }
  return { nodePressurePa, centralPressurePa: nodePressurePa[0] };
}

/** Полное решение при заданном числе шагов на слой. */
function computeOnce(
  layers: readonly HydrostaticLayer[],
  stepsPerLayer: number,
  surfacePressurePa: number,
  gConst: number
): { nodes: HydrostaticNode[]; centralPressurePa: number; totalMassKg: number; momentOfInertiaFactor: number } | string {
  const outward = integrateOutward(layers, stepsPerLayer);
  if (typeof outward === 'string') return outward;
  const pressure = integratePressureInward(outward, layers, stepsPerLayer, surfacePressurePa, gConst);
  if (typeof pressure === 'string') return pressure;
  const nodes: HydrostaticNode[] = [];
  const nodesPerLayer = stepsPerLayer + 1;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    for (let j = 0; j < nodesPerLayer; j++) {
      const nodeIndex = li * nodesPerLayer + j;
      const r = outward.nodeRadiiM[nodeIndex];
      const m = outward.nodeMassKg[nodeIndex];
      const onBoundary = li > 0 && j === 0;
      const rho = layer.densityKgM3At(r);
      const gValue = r <= 0 ? 0 : (gConst * m) / (r * r);
      nodes.push({
        radiusM: r,
        densityKgM3: rho,
        massKg: m,
        gravityMS2: gValue,
        pressurePa: pressure.nodePressurePa[nodeIndex],
        layerId: layer.id,
        onLayerBoundary: onBoundary
      });
    }
  }
  const outerRadiusM = layers[layers.length - 1].radiusMaxM;
  const momentOfInertiaFactor =
    outward.totalMomentInertiaKgM2 /
    (outward.totalMassKg * outerRadiusM * outerRadiusM);
  return {
    nodes,
    centralPressurePa: pressure.centralPressurePa,
    totalMassKg: outward.totalMassKg,
    momentOfInertiaFactor
  };
}

/**
 * Главная функция: гидростатическая структура сферического тела по
 * заданному слоистому профилю плотности.
 */
export function solveHydrostaticInterior(
  layers: readonly HydrostaticLayer[],
  options?: HydrostaticSolverOptions,
  source?: HydrostaticSource
): HydrostaticInteriorResult {
  // 1. Валидация входа.
  if (!Array.isArray(layers) || layers.length === 0) {
    return { status: 'invalid_input', issues: ['список слоёв пуст'] };
  }
  const issues: string[] = [];
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (typeof layer?.id !== 'string' || layer.id.length === 0) {
      issues.push(`слой ${i}: id отсутствует`);
    }
    if (!(layer.radiusMaxM > layer.radiusMinM)) {
      issues.push(`слой ${i} (${String(layer?.id)}): radiusMaxM ≤ radiusMinM`);
    }
    if (i > 0 && layers[i - 1].radiusMaxM !== layer.radiusMinM) {
      issues.push(
        `слой ${i} (${String(layer?.id)}): начало ${String(layer.radiusMinM)} не совпадает с концом предыдущего слоя ${String(layers[i - 1].radiusMaxM)} (зазор или пересечение)`
      );
    }
    if (i === 0 && layer.radiusMinM !== 0) {
      issues.push(`слой ${i} (${String(layer?.id)}): первый слой обязан начинаться в центре r = 0`);
    }
    if (typeof layer?.densityKgM3At !== 'function') {
      issues.push(`слой ${i} (${String(layer?.id)}): densityKgM3At не функция`);
    }
  }
  if (issues.length > 0) return { status: 'invalid_input', issues };

  const resolved = resolveHydrostaticOptions(options);
  if (typeof resolved === 'string' || Array.isArray(resolved)) {
    return { status: 'invalid_input', issues: resolved as readonly string[] };
  }
  const gConst = GRAVITATIONAL_CONSTANT_M3_KG_S2;

  // 2. Базовое решение и измельчённое решение (по одинаковой сетке слоёв).
  const base = computeOnce(layers, resolved.stepsPerLayer, resolved.surfacePressurePa, gConst);
  if (typeof base === 'string') {
    return {
      status: 'out_of_applicability',
      reason: base,
      detail: { stage: 'density_model_evaluation', stepsPerLayer: resolved.stepsPerLayer }
    };
  }
  const refinedSteps = Math.min(resolved.stepsPerLayer * resolved.refinementFactor, 4 * MAX_STEPS_PER_LAYER);
  const refined = computeOnce(layers, refinedSteps, resolved.surfacePressurePa, gConst);
  if (typeof refined === 'string') {
    return {
      status: 'out_of_applicability',
      reason: refined,
      detail: { stage: 'density_model_evaluation_refined', refinedStepsPerLayer: refinedSteps }
    };
  }
  if (!Number.isFinite(base.centralPressurePa) || !Number.isFinite(base.totalMassKg)) {
    return { status: 'numerical_failure', reason: 'нечисловые значения в базовом решении', stage: 'finite_control' };
  }

  // 3. Сходимость: относительное изменение Pc и M при измельчении.
  const centralPressureRelativeChange = Math.abs(
    (refined.centralPressurePa - base.centralPressurePa) / Math.max(Math.abs(base.centralPressurePa), 1)
  );
  const totalMassRelativeChange = Math.abs(
    (refined.totalMassKg - base.totalMassKg) / Math.max(Math.abs(base.totalMassKg), 1)
  );
  const converged =
    centralPressureRelativeChange <= resolved.relativeTolerance &&
    totalMassRelativeChange <= resolved.relativeTolerance;

  const outerRadiusM = layers[layers.length - 1].radiusMaxM;
  const sourceInfo: HydrostaticSource = source ?? {
    sourceName: 'заданный слоистый профиль плотности',
    sourceDetail: 'реконструкция по пользовательскому callback-профилю плотности'
  };

  return {
    status: 'completed',
    nodes: base.nodes,
    centralPressurePa: base.centralPressurePa,
    totalMassKg: base.totalMassKg,
    momentOfInertiaFactor: base.momentOfInertiaFactor,
    outerRadiusM,
    meanDensityKgM3: base.totalMassKg / ((4 / 3) * Math.PI * Math.pow(outerRadiusM, 3)),
    surfacePressurePa: resolved.surfacePressurePa,
    gravitationalConstantM3KgS2: gConst,
    numericalMethod: HYDROSTATIC_NUMERICAL_METHOD,
    convergence: {
      stepsPerLayer: resolved.stepsPerLayer,
      refinementFactor: resolved.refinementFactor,
      refinedStepsPerLayer: refinedSteps,
      relativeTolerance: resolved.relativeTolerance,
      centralPressureRelativeChange,
      totalMassRelativeChange,
      converged
    },
    layerIds: layers.map((l) => l.id),
    source: sourceInfo
  };
}
