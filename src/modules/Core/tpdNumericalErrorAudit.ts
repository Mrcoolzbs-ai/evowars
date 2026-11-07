// ============================================================================
// Stage 4.4.4.4.1-A — ЧИСЛЕННЫЙ АУДИТ ОШИБОК: scalar TPD evaluator
// Детерминированная матрица сценариев + независимый оракул + отчёт
// ----------------------------------------------------------------------------
// НАЗНАЧЕНИЕ. Модуль — audit harness: он прогоняет ЗАМОРОЖЕННУЮ матрицу
// из 44 воспроизводимых сценариев через произвольный production-провайдер
// ( контракт TpdNumericalErrorAuditProvider ) и сравнивает production-цели
// ( PR coefficients, Z, ln(phi_i), вклады, scalar TPD ) со СТРОГИМИ
// enclosure-границами независимого оракула
// ( ./tpdNumericalErrorAuditOracle.ts ).
//
// НЕЗАВИСИМОСТЬ. Модуль НЕ импортирует production PR/TPD runtime: доступ к
// production-значениям — ТОЛЬКО через Provider, реализуемый снаружи
// ( CI-тест — через реальные фасады; replay-провайдер — через дамп ).
// Оракул не наследует точность production: enclosure строится из
// каталожных входов заново.
//
// ГРАНИЦЫ ( Stage 4.4.4.4.1-A ). Это ИНСТРУМЕНТ АУДИТА, не валидация PR
// как физической модели и не расширение evidence-статусов каталога.
// Результат per-scenario — либо 'audited' с измеренными границами
// |prod − exact| для ДАННОЙ точки, либо честный статус отказа
// ( expected_failure / unexpected_failure / oracle_inconclusive ).
// Континуальная validated bound НЕ выводится ( validatedErrorBoundStatus
// фиксируется в docs/science/TPD_NUMERICAL_ERROR_AUDIT.md ).
// ============================================================================

import {
  oracleCenter,
  oracleEncloseRoot,
  oracleErrorBound,
  oracleLnRatio,
  oracleMixtureState,
  oracleTpdBall,
  oracleTpdContribution,
  tsBall,
  tsLog,
  tsMulB,
  tsSqrt,
  type Ball,
  type OracleComponent,
  type OraclePureParams,
  type OracleState
} from './tpdNumericalErrorAuditOracle';

// ============================================
// 1. КОНСТАНТЫ АУДИТА ( каталожные значения — echo для отчёта )
// ============================================

/**
 * Универсальная газовая постоянная — то же ТОЧНОЕ double-значение, что и
 * в production ( UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K ). Аудит измеряет
 * ошибку ВЫЧИСЛЕНИЙ при заданных входах, а не вариативность констант.
 */
export const TPD_NUMERICAL_ERROR_AUDIT_R_J_PER_MOL_K = 8.31446261815324;

/** Каталожные параметры чистого CO2 ( Stage 4.4.4.1, VERIFIED ). */
export const TPD_NUMERICAL_ERROR_AUDIT_CO2: OraclePureParams = {
  criticalTemperatureK: 304.1282,
  criticalPressurePa: 7377300,
  acentricFactor: 0.22394
};

/** Каталожные параметры чистого N2 ( Stage 4.4.4.1 ). */
export const TPD_NUMERICAL_ERROR_AUDIT_N2: OraclePureParams = {
  criticalTemperatureK: 126.192,
  criticalPressurePa: 3395800,
  acentricFactor: 0.0372
};

/** kij пары CO2–N2 ( Stage 4.4.4.3, канонический лексикографический порядок ). */
export const TPD_NUMERICAL_ERROR_AUDIT_KIJ_CO2_N2 = -0.017;

/** Верифицированный диапазон применимости kij CO2–N2, K. */
export const TPD_NUMERICAL_ERROR_AUDIT_BIP_APPLICABILITY_K: readonly number[] = [
  228.15,
  273.15
];

// ============================================
// 2. ТИПЫ СПЕЦИФИКАЦИИ СЦЕНАРИЕВ
// ============================================

/** Компонент спецификации состояния: идентификатор + мольная доля. */
export interface TpdNumericalErrorAuditComponentSpec {
  readonly id: string;
  readonly x: number;
}

/** Спецификация состояния: ветвь + состав ( канонический порядок по id ). */
export interface TpdNumericalErrorAuditStateSpec {
  readonly branch: 'vapor' | 'liquid';
  readonly comps: readonly TpdNumericalErrorAuditComponentSpec[];
}

/**
 * Ожидаемый отказ сценария: токен, сопоставляемый с фактической меткой
 * отказа провайдера ( cubic_root_collapse -> метка содержит «схлопывани»,
 * support_violation -> метка содержит «support_violation»,
 * phi_overflow_guard -> метка содержит «numerical_failure» ).
 */
export type TpdNumericalErrorAuditExpectFailure =
  | null
  | 'cubic_root_collapse'
  | 'support_violation'
  | 'phi_overflow_guard';

/** Спецификация сценария аудита ( T/P общие для feed и trial ). */
export interface TpdNumericalErrorAuditScenarioSpec {
  readonly id: string;
  readonly group: string;
  readonly note: string;
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly feed: TpdNumericalErrorAuditStateSpec;
  /** null — identity-сценарий: trial совпадает с feed ( по ссылке ). */
  readonly trial: TpdNumericalErrorAuditStateSpec | null;
  readonly expectFailure: TpdNumericalErrorAuditExpectFailure;
}

// ============================================
// 3. МАТРИЦА СЦЕНАРИЕВ ( 44, детерминированная )
// ============================================

function mix(
  id1: string,
  x1: number,
  id2: string,
  x2: number,
  branch: 'vapor' | 'liquid'
): TpdNumericalErrorAuditStateSpec {
  return { branch, comps: [{ id: id1, x: x1 }, { id: id2, x: x2 }] };
}

const PURE_CO2_LIQUID: TpdNumericalErrorAuditStateSpec = {
  branch: 'liquid',
  comps: [{ id: 'co2', x: 1 }]
};
const PURE_CO2_VAPOR: TpdNumericalErrorAuditStateSpec = {
  branch: 'vapor',
  comps: [{ id: 'co2', x: 1 }]
};
const PURE_N2_VAPOR: TpdNumericalErrorAuditStateSpec = {
  branch: 'vapor',
  comps: [{ id: 'n2', x: 1 }]
};
const MIX_955_VAPOR: TpdNumericalErrorAuditStateSpec = mix(
  'co2', 0.95, 'n2', 0.05, 'vapor'
);
const MIX_955_LIQUID: TpdNumericalErrorAuditStateSpec = mix(
  'co2', 0.95, 'n2', 0.05, 'liquid'
);
const MIX_5050_VAPOR: TpdNumericalErrorAuditStateSpec = mix(
  'co2', 0.5, 'n2', 0.5, 'vapor'
);
const MIX_005095_VAPOR: TpdNumericalErrorAuditStateSpec = mix(
  'co2', 0.05, 'n2', 0.95, 'vapor'
);

// Near-merge-серия чистого CO2 при T = 250 K: давления подобраны так, что
// пара mid/vap корней сближается от sep~1e-4 до sep~1.13e-8, за которой
// следует первая точка с единственным корнем ( D = 0 ).
const P_MERGE_1E4 = 3343704.8307527793;
const P_MERGE_1E6 = 3343704.864302838;
const P_MERGE_1E7 = 3343704.86430616;
const P_MERGE_EDGE = 3343704.8643061933;
const P_D0_FIRST = 3343704.864306194;

function scenario(
  id: string,
  group: string,
  note: string,
  temperatureK: number,
  pressurePa: number,
  feed: TpdNumericalErrorAuditStateSpec,
  trial: TpdNumericalErrorAuditStateSpec | null,
  expectFailure: TpdNumericalErrorAuditExpectFailure
): TpdNumericalErrorAuditScenarioSpec {
  return {
    id,
    group,
    note,
    temperatureK,
    pressurePa,
    feed,
    trial,
    expectFailure
  };
}

/**
 * Матрица 44 сценариев. Группы: identity ( точное совпадение feed=trial ),
 * near ( почти совпадающие составы ), tiny ( малые ненулевые доли,
 * включая субнормали ), cancel ( cancellation-чувствительные нули TPD ),
 * support ( граничные составы и подмножества support ), topology
 * ( 1/2/3 физических корня, near-merge, Z ~ B ), cross ( смена ветви
 * feed/trial ), trange ( границы применимости BIP ).
 */
export const TPD_NUMERICAL_ERROR_AUDIT_SCENARIOS: readonly TpdNumericalErrorAuditScenarioSpec[] = [
  // --- identity: TPD обязан быть ровно +0 ---
  scenario('id_co2_liq', 'identity', 'чистый CO2, liquid, feed=trial',
    250, 1000000, PURE_CO2_LIQUID, null, null),
  scenario('id_co2_vap', 'identity', 'чистый CO2, vapor, feed=trial',
    250, 1000000, PURE_CO2_VAPOR, null, null),
  scenario('id_mix_vap', 'identity', 'смесь (0.95,0.05), vapor, feed=trial',
    250, 2000000, MIX_955_VAPOR, null, null),
  scenario('id_mix_liq', 'identity', 'смесь (0.95,0.05), liquid, feed=trial',
    250, 2000000, MIX_955_LIQUID, null, null),
  // --- near: почти совпадающие составы ( зона шума TPD ) ---
  scenario('near_1e9p', 'near', 'delta=+1e-9, TPD~1.9e-17 (шум)',
    250, 2000000, MIX_955_VAPOR,
    mix('co2', 0.9500000009999999, 'n2', 0.049999999, 'vapor'), null),
  scenario('near_1e9n', 'near', 'delta=-1e-9',
    250, 2000000, MIX_955_VAPOR,
    mix('co2', 0.949999999, 'n2', 0.050000001, 'vapor'), null),
  scenario('near_1e7', 'near', 'delta=1e-7, TPD~1.05e-13',
    250, 2000000, MIX_955_VAPOR,
    mix('co2', 0.9500000999999999, 'n2', 0.0499999, 'vapor'), null),
  scenario('near_1e6', 'near', 'delta=1e-6, TPD~1.04e-11',
    250, 2000000, MIX_955_VAPOR,
    mix('co2', 0.950001, 'n2', 0.049999, 'vapor'), null),
  scenario('near_1e3', 'near', 'delta=1e-3, TPD~1.05e-5',
    250, 2000000, MIX_955_VAPOR,
    mix('co2', 0.951, 'n2', 0.049, 'vapor'), null),
  // --- tiny: очень малые ненулевые доли ---
  scenario('tiny_1e12', 'tiny', 'x_n2: 1e-12 -> 2e-12',
    250, 2000000,
    mix('co2', 0.999999999999, 'n2', 1e-12, 'vapor'),
    mix('co2', 0.999999999998, 'n2', 2e-12, 'vapor'), null),
  scenario('tiny_1e15', 'tiny', 'x_n2: 1e-15 -> 3e-15',
    250, 2000000,
    mix('co2', 0.999999999999999, 'n2', 1e-15, 'vapor'),
    mix('co2', 0.999999999999997, 'n2', 3e-15, 'vapor'), null),
  scenario('subnormal', 'tiny', 'x_n2: 1e-320 -> 2e-320 (субнормаль)',
    250, 2000000,
    mix('co2', 1, 'n2', 1e-320, 'vapor'),
    mix('co2', 1, 'n2', 2e-320, 'vapor'), null),
  scenario('n2dom_1e9', 'tiny', 'N2-доминант, x_co2: 1e-9 -> 2e-9',
    250, 2000000,
    mix('co2', 1e-9, 'n2', 0.999999999, 'vapor'),
    mix('co2', 2e-9, 'n2', 0.999999998, 'vapor'), null),
  scenario('co2tiny_1e9', 'tiny', 'x_n2: 1e-9 -> 2e-9',
    250, 2000000,
    mix('co2', 0.999999999, 'n2', 1e-9, 'vapor'),
    mix('co2', 0.999999998, 'n2', 2e-9, 'vapor'), null),
  // --- cancel: cancellation-чувствительные TPD около нуля ---
  scenario('zero_hi', 'cancel', 'естественный ноль TPD, верхний double',
    250, 2000000, MIX_955_LIQUID,
    mix('co2', 0.969528299673221, 'n2', 0.03047170032677904, 'vapor'), null),
  scenario('zero_lo', 'cancel', 'соседний double, знак TPD меняется',
    250, 2000000, MIX_955_LIQUID,
    mix('co2', 0.9695282996732209, 'n2', 0.03047170032677915, 'vapor'), null),
  scenario('noise_3e8', 'cancel', 'delta=3e-8, TPD~9.5e-15 (зона шума)',
    250, 2000000, MIX_955_VAPOR,
    mix('co2', 0.95000003, 'n2', 0.049999970000000005, 'vapor'), null),
  // --- support: граничные составы и подмножества support ---
  scenario('support_co2only', 'support', 'trial = чистый CO2 (support subset)',
    250, 2000000, MIX_955_VAPOR,
    mix('co2', 1, 'n2', 0, 'vapor'), null),
  scenario('support_n2only', 'support', 'trial = чистый N2 (support subset)',
    250, 2000000, MIX_955_VAPOR,
    mix('co2', 0, 'n2', 1, 'vapor'), null),
  scenario('support_violation', 'support', 'feed без N2, trial с N2 -> support_violation',
    250, 2000000,
    mix('co2', 1, 'n2', 0, 'vapor'),
    mix('co2', 0.95, 'n2', 0.05, 'vapor'),
    'support_violation'),
  // --- topology: 1/2/3 корня, near-merge, Z ~ B ---
  scenario('n2_supercrit', 'topology', 'чистый N2, 1 корень (сверхкритично)',
    250, 1000000, PURE_N2_VAPOR, null, null),
  scenario('mix_1e7', 'topology', 'смесь, 1 корень при 10 МПа',
    250, 10000000, MIX_955_VAPOR, null, null),
  scenario('co2_1e9', 'topology', 'чистый CO2, 1 корень при 1 ГПа (zb~0.061)',
    250, 1000000000, PURE_CO2_VAPOR, null, null),
  scenario('nm1e4_vap', 'topology', 'near-merge sep~1e-4 (пара mid-vap)',
    250, P_MERGE_1E4, PURE_CO2_VAPOR, null, null),
  scenario('nm1e6_vap', 'topology', 'near-merge sep~1e-6',
    250, P_MERGE_1E6, PURE_CO2_VAPOR, null, null),
  scenario('nm1e7_vap', 'topology', 'near-merge sep~1e-7',
    250, P_MERGE_1E7, PURE_CO2_VAPOR, null, null),
  scenario('nmedge_vap', 'topology', 'последняя 3-корневая точка, sep=1.13e-8',
    250, P_MERGE_EDGE, PURE_CO2_VAPOR, null, null),
  scenario('d0_1root', 'topology', 'первая 1-корневая точка за D=0',
    250, P_D0_FIRST, PURE_CO2_VAPOR, null, null),
  scenario('lowp1_liq', 'topology', 'P=1 Па, liquid, низко-P near-merge без усиления',
    250, 1, PURE_CO2_LIQUID, null, null),
  scenario('lowp1_vap', 'topology', 'P=1 Па, vapor',
    250, 1, PURE_CO2_VAPOR, null, null),
  scenario('lowp_fail', 'topology', 'P=0.1 Па -> схлопывание корней',
    250, 0.1, PURE_CO2_VAPOR, null, 'cubic_root_collapse'),
  scenario('highzb_1e3', 'topology',
    'P=7.6e10: production fail-closed (phi=exp(lnPhi~970) переполняет binary64) -> ожидаемый numerical_failure',
    250, 76000000000, PURE_CO2_VAPOR, null, 'phi_overflow_guard'),
  scenario('highzb_1e14', 'topology',
    'P=1e14: production fail-closed (phi=exp(lnPhi~1.28e6) переполняет binary64) -> ожидаемый numerical_failure',
    250, 100000000000000, PURE_CO2_VAPOR, null, 'phi_overflow_guard'),
  // --- cross: смена ветви feed/trial ---
  scenario('cross_mix_liqfeed', 'cross', 'liquid feed -> vapor trial w=z, TPD~ -0.064',
    250, 2000000, MIX_955_LIQUID, MIX_955_VAPOR, null),
  scenario('cross_mix_vapfeed', 'cross', 'vapor feed -> liquid trial w=z',
    250, 2000000, MIX_955_VAPOR, MIX_955_LIQUID, null),
  scenario('cross_mix_far', 'cross', 'liquid feed -> vapor trial (0.5,0.5)',
    250, 2000000, MIX_955_LIQUID,
    mix('co2', 0.5, 'n2', 0.5, 'vapor'), null),
  scenario('cross_pure', 'cross', 'CO2 fixture: liquid feed -> vapor trial, TPD~ -0.478',
    250, 1000000, PURE_CO2_LIQUID, PURE_CO2_VAPOR, null),
  scenario('nm1e6_cross', 'cross', 'near-merge cross: liq -> vap при sep~1e-6',
    250, P_MERGE_1E6, PURE_CO2_LIQUID, PURE_CO2_VAPOR, null),
  scenario('nmedge_cross', 'cross', 'near-merge edge cross: liq -> vap',
    250, P_MERGE_EDGE, PURE_CO2_LIQUID, PURE_CO2_VAPOR, null),
  scenario('lowp1_cross', 'cross', 'P=1 Па cross: liq -> vap',
    250, 1, PURE_CO2_LIQUID, PURE_CO2_VAPOR, null),
  // --- trange: границы применимости BIP CO2–N2 ---
  scenario('t228', 'trange', 'T=228.15 (нижняя граница применимости)',
    228.15, 1000000, MIX_5050_VAPOR, null, null),
  scenario('t273', 'trange', 'T=273.15 (верхняя граница)',
    273.15, 1000000, MIX_5050_VAPOR, null, null),
  scenario('t250z50', 'trange', 'T=250, z=(0.5,0.5)',
    250, 1000000, MIX_5050_VAPOR, null, null),
  scenario('t250z005', 'trange', 'T=250, z=(0.05,0.95) N2-доминант',
    250, 1000000, MIX_005095_VAPOR, null, null)
];

// ============================================
// 4. КОНТРАКТ PRODUCTION-ПРОВАЙДЕРА
// ============================================

/** Production-состояние ( успех ): PR coefficients, корни, ln(phi_i). */
export interface TpdNumericalErrorAuditProdState {
  readonly dimensionlessA: number;
  readonly dimensionlessB: number;
  readonly Z: number;
  /** Все действительные корни кубики ( до фильтра Z > B ). */
  readonly realRoots: readonly number[];
  /** Физические корни ( Z > B ), отсортированные. */
  readonly physicalRoots: readonly number[];
  /** ln(phi_i) в каноническом порядке comps ( сортировка по id ). */
  readonly lnPhi: readonly number[];
}

/** Production-отказ: нормированная метка ( например «схлопывание корней» ). */
export interface TpdNumericalErrorAuditProdFailure {
  readonly failure: string;
}

/** Production-вклад компонента в TPD ( echo промежуточных значений ). */
export interface TpdNumericalErrorAuditProdContribution {
  readonly component: string;
  readonly w: number;
  readonly z: number;
  readonly lnRatio: number;
  readonly bracket: number;
  readonly contribution: number;
}

/** Production-результат scalar TPD. */
export interface TpdNumericalErrorAuditProdTpd {
  readonly tpd: number;
  readonly contributions: readonly TpdNumericalErrorAuditProdContribution[];
}

/**
 * Провайдер production-вычислений. Единственный канал, через который
 * audit harness получает production-значения; сам harness и оракул
 * production-кода не импортируют.
 */
export interface TpdNumericalErrorAuditProvider {
  readonly label: string;
  mixtureState(
    spec: TpdNumericalErrorAuditStateSpec,
    temperatureK: number,
    pressurePa: number
  ): TpdNumericalErrorAuditProdState | TpdNumericalErrorAuditProdFailure;
  tangentPlaneDistance(
    feedSpec: TpdNumericalErrorAuditStateSpec,
    trialSpec: TpdNumericalErrorAuditStateSpec,
    temperatureK: number,
    pressurePa: number
  ): TpdNumericalErrorAuditProdTpd | TpdNumericalErrorAuditProdFailure;
}

// ============================================
// 5. ТИПЫ ИЗМЕРЕНИЙ И ОТЧЁТА
// ============================================

/** Измерение одного состояния: production-значения + oracle-enclosure-ы. */
export interface TpdNumericalErrorAuditStateMeasurement {
  readonly branch: 'vapor' | 'liquid';
  readonly comps: readonly { readonly id: string; readonly x: number }[];
  readonly A: number;
  readonly B: number;
  readonly Z: number;
  readonly lnPhi: readonly number[];
  readonly rootsAll: readonly number[];
  readonly rootCount: number;
  readonly zb: number;
  readonly minSep: number | null;
  readonly Acenter: number;
  readonly rA: number;
  readonly Bcenter: number;
  readonly rB: number;
  readonly Zcenter: number;
  readonly rZ: number;
  readonly eA: number;
  readonly eB: number;
  readonly eZtotal: number;
  readonly eZsolverOnly: number;
  readonly ZsolverCenter: number;
  readonly lnPhiCenter: readonly number[];
  readonly rLnPhi: readonly number[];
  readonly eLnPhi: readonly number[];
  readonly eLnPhiMax: number;
  /** Доказанное оракулом число действительных корней кубики (1 | 3). */
  readonly oracleRealRootCount: 1 | 3;
  /** Доказанное оракулом число физических корней ( Z > B ). */
  readonly oraclePhysicalRootCount: number;
  /** Интервальный знак депрессированного дискриминанта ( 0 — не определён ). */
  readonly oracleDiscriminantSign: -1 | 0 | 1;
  /** Центр enclosure дискриминанта ( для отчётности ). */
  readonly oracleDiscriminantCenter: number;
  /** Радиус enclosure дискриминанта ( для отчётности ). */
  readonly oracleDiscriminantR: number;
  /** Согласованность независимой топологии с production ( число физических ). */
  readonly topologyMatch: boolean;
}

/** Измерение TPD: production-значения + oracle-enclosure итога и вкладов. */
export interface TpdNumericalErrorAuditTpdMeasurement {
  readonly tpd: number;
  readonly details: readonly {
    readonly comp: string;
    readonly w: number;
    readonly z: number;
    readonly lnRatio: number;
    readonly bracket: number;
    readonly contribution: number;
  }[];
  readonly oracleTpdCenter: number;
  readonly rTpd: number;
  readonly eTpd: number;
  readonly signDetermined: boolean;
  readonly perComp: readonly {
    readonly comp: string;
    readonly lnRatio: number;
    readonly eLnRatio: number;
    readonly contribution: number;
    readonly eContrib: number;
  }[];
}

/** Статус сценария. */
export type TpdNumericalErrorAuditScenarioStatus =
  | 'audited'
  | 'expected_failure'
  | 'unexpected_failure'
  | 'oracle_inconclusive';

/** Результат сценария ( поля null-измерений опускаются при сериализации ). */
export interface TpdNumericalErrorAuditScenarioResult {
  readonly id: string;
  readonly group: string;
  readonly note: string;
  readonly T: number;
  readonly P: number;
  readonly expectFailure: TpdNumericalErrorAuditExpectFailure;
  readonly feed: TpdNumericalErrorAuditStateMeasurement | undefined;
  readonly trial: TpdNumericalErrorAuditStateMeasurement | undefined;
  readonly tpd: TpdNumericalErrorAuditTpdMeasurement | undefined;
  readonly feedFailure: string | undefined;
  readonly trialFailure: string | undefined;
  readonly tpdFailure: string | undefined;
  /** Причина отказа оракула ( только при status = oracle_inconclusive ). */
  readonly oracleFailure: string | undefined;
  readonly status: TpdNumericalErrorAuditScenarioStatus;
}

/** Self-test оракула ( enclosure-валидность базовых операций ). */
export interface TpdNumericalErrorAuditSelfTest {
  readonly ln8_vs_3ln2: number;
  readonly sqrt2_bound: number;
  readonly log3_bound: number;
  readonly subnormalMul: {
    readonly center: number;
    readonly r: number;
    readonly coversTrue: boolean;
  };
  readonly lnRatio_identity: {
    readonly center: number;
    readonly r: number;
  };
}

/** Итог отчёта. */
export interface TpdNumericalErrorAuditSummary {
  readonly scenarioCount: number;
  readonly auditedCount: number;
  readonly expectedFailures: readonly { readonly id: string; readonly reason: string }[];
  readonly unexpectedFailures: readonly { readonly id: string; readonly reason: string }[];
  readonly oracleInconclusive: readonly { readonly id: string; readonly reason: string }[];
  readonly maxEz: number;
  readonly maxELnPhi: number;
  readonly maxETpd: number;
  readonly globals: {
    readonly R: number;
    readonly kij_co2_n2: number;
    readonly co2: { readonly Tc: number; readonly Pc: number; readonly omega: number };
    readonly n2: { readonly Tc: number; readonly Pc: number; readonly omega: number };
    readonly bipApplicabilityK: readonly number[];
    readonly engine: string;
  };
}

/** Полный отчёт аудита. */
export interface TpdNumericalErrorAuditReport {
  readonly selfTest: TpdNumericalErrorAuditSelfTest;
  readonly summary: TpdNumericalErrorAuditSummary;
  readonly results: readonly TpdNumericalErrorAuditScenarioResult[];
}

// ============================================
// 6. ЛОГИКА РАННЕРА
// ============================================

function isProdFailure(
  value: TpdNumericalErrorAuditProdState | TpdNumericalErrorAuditProdFailure
): value is TpdNumericalErrorAuditProdFailure {
  return typeof (value as TpdNumericalErrorAuditProdFailure).failure === 'string';
}

function isProdTpdFailure(
  value: TpdNumericalErrorAuditProdTpd | TpdNumericalErrorAuditProdFailure
): value is TpdNumericalErrorAuditProdFailure {
  return typeof (value as TpdNumericalErrorAuditProdFailure).failure === 'string';
}

/** Канонический порядок компонентов ( сортировка по id ). */
function canonicalComponents(
  spec: TpdNumericalErrorAuditStateSpec
): readonly { readonly id: string; readonly x: number }[] {
  return spec.comps
    .map((c) => ({ id: c.id, x: c.x }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** Маппинг каталожных параметров по идентификатору ( fail-closed ). */
function toOracleComponents(
  comps: readonly { readonly id: string; readonly x: number }[]
): OracleComponent[] {
  return comps.map((c) => {
    if (c.id === 'co2') {
      return { id: c.id, moleFraction: c.x, params: TPD_NUMERICAL_ERROR_AUDIT_CO2 };
    }
    if (c.id === 'n2') {
      return { id: c.id, moleFraction: c.x, params: TPD_NUMERICAL_ERROR_AUDIT_N2 };
    }
    throw new Error(`audit toOracleComponents: неизвестный компонент ${c.id}`);
  });
}

/** Минимальное попарное расстояние физических корней ( null при < 2 корнях ). */
function minSeparation(roots: readonly number[]): number | null {
  if (roots.length < 2) {
    return null;
  }
  let min = Infinity;
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      const d = Math.abs(roots[i] - roots[j]);
      if (d < min) {
        min = d;
      }
    }
  }
  return min;
}

/** Сопоставление токена ожидаемого отказа с фактической меткой провайдера. */
function failureMatches(expected: TpdNumericalErrorAuditExpectFailure, failure: string): boolean {
  if (expected === 'cubic_root_collapse') {
    return failure.includes('схлопывани');
  }
  if (expected === 'support_violation') {
    return failure.includes('support_violation');
  }
  if (expected === 'phi_overflow_guard') {
    return failure.includes('numerical_failure');
  }
  return false;
}

/**
 * Измерение состояния: production-значения + независимые enclosure-ы
 * ( A, B, корень ветви, ln(phi_i) ) + граница |prod − exact| на каждом
 * этапе: eA/eB ( коэффициенты ), eZtotal ( корень при oracle-входах ),
 * eZsolverOnly ( корень при ТОЧНЫХ production A, B — изолирует ошибку
 * решателя ), eLnPhi per comp. Топология корней ( число действительных,
 * число физических, интервальный знак дискриминанта ) — независимо
 * доказана оракулом и сверена с production ( topologyMatch ).
 */
function measureOracleState(
  spec: TpdNumericalErrorAuditStateSpec,
  temperatureK: number,
  pressurePa: number,
  provider: TpdNumericalErrorAuditProvider
): {
  measurement: TpdNumericalErrorAuditStateMeasurement;
  oracleState: OracleState;
  comps: readonly { readonly id: string; readonly x: number }[];
} {
  const prodResult = provider.mixtureState(spec, temperatureK, pressurePa);
  if (isProdFailure(prodResult)) {
    throw new ProdStateFailure(prodResult.failure);
  }
  const comps = canonicalComponents(spec);
  const oracleState = oracleMixtureState(
    toOracleComponents(comps),
    comps.length > 1 ? TPD_NUMERICAL_ERROR_AUDIT_KIJ_CO2_N2 : null,
    temperatureK,
    pressurePa,
    TPD_NUMERICAL_ERROR_AUDIT_R_J_PER_MOL_K,
    spec.branch,
    prodResult.physicalRoots
  );
  // Enclosure корня при ТОЧНЫХ production A, B: изолирует ошибку решателя
  // от ошибки вычисления самих коэффициентов.
  const solverEnclosure = oracleEncloseRoot(
    tsBall(prodResult.dimensionlessA),
    tsBall(prodResult.dimensionlessB),
    prodResult.Z,
    prodResult.physicalRoots
  );
  const lnPhiCenter: number[] = [];
  const rLnPhi: number[] = [];
  const eLnPhi: number[] = [];
  for (let i = 0; i < comps.length; i += 1) {
    lnPhiCenter.push(oracleCenter(oracleState.lnPhi[i]));
    rLnPhi.push(oracleState.lnPhi[i].r);
    eLnPhi.push(oracleErrorBound(prodResult.lnPhi[i], oracleState.lnPhi[i]));
  }
  let eLnPhiMax = 0;
  for (const e of eLnPhi) {
    if (e > eLnPhiMax) {
      eLnPhiMax = e;
    }
  }
  const minSep = minSeparation(prodResult.physicalRoots);
  const measurement: TpdNumericalErrorAuditStateMeasurement = {
    branch: spec.branch,
    comps,
    A: prodResult.dimensionlessA,
    B: prodResult.dimensionlessB,
    Z: prodResult.Z,
    lnPhi: prodResult.lnPhi,
    rootsAll: prodResult.realRoots,
    rootCount: prodResult.physicalRoots.length,
    zb: (prodResult.Z - prodResult.dimensionlessB) / prodResult.dimensionlessB,
    minSep,
    Acenter: oracleCenter(oracleState.A),
    rA: oracleState.A.r,
    Bcenter: oracleCenter(oracleState.B),
    rB: oracleState.B.r,
    Zcenter: oracleCenter(oracleState.root),
    rZ: oracleState.root.r,
    eA: oracleErrorBound(prodResult.dimensionlessA, oracleState.A),
    eB: oracleErrorBound(prodResult.dimensionlessB, oracleState.B),
    eZtotal: oracleErrorBound(prodResult.Z, oracleState.root),
    eZsolverOnly: oracleErrorBound(prodResult.Z, solverEnclosure.root),
    ZsolverCenter: oracleCenter(solverEnclosure.root),
    lnPhiCenter,
    rLnPhi,
    eLnPhi,
    eLnPhiMax,
    oracleRealRootCount: oracleState.realRootCount,
    oraclePhysicalRootCount: oracleState.physicalRootCount,
    oracleDiscriminantSign: oracleState.discriminantSign,
    oracleDiscriminantCenter: oracleCenter(oracleState.discriminant),
    oracleDiscriminantR: oracleState.discriminant.r,
    topologyMatch: oracleState.physicalRootCount === prodResult.physicalRoots.length
  };
  return { measurement, oracleState, comps };
}

/** Маркер отказа production-состояния ( ловится в runScenario ). */
class ProdStateFailure extends Error {
  constructor(failure: string) {
    super(failure);
    this.name = 'ProdStateFailure';
  }
}

/**
 * Прогон одного сценария: измерение feed ( и trial, если он не identity ),
 * затем TPD-этап ( production через провайдер + независимый oracle-балл ),
 * затем классификация статуса.
 */
function runScenario(
  sc: TpdNumericalErrorAuditScenarioSpec,
  provider: TpdNumericalErrorAuditProvider
): TpdNumericalErrorAuditScenarioResult {
  const identity = sc.trial === null;
  let feedFailure: string | undefined;
  let trialFailure: string | undefined;
  let tpdFailure: string | undefined;

  let feed: TpdNumericalErrorAuditStateMeasurement | undefined;
  let trial: TpdNumericalErrorAuditStateMeasurement | undefined;
  let tpd: TpdNumericalErrorAuditTpdMeasurement | undefined;
  let oracleInconclusiveReason: string | undefined;

  let feedOracle: OracleState | null = null;
  let trialOracle: OracleState | null = null;
  let feedComps: readonly { readonly id: string; readonly x: number }[] = [];
  let trialComps: readonly { readonly id: string; readonly x: number }[] = [];

  try {
    const feedM = measureOracleState(sc.feed, sc.temperatureK, sc.pressurePa, provider);
    feed = feedM.measurement;
    feedOracle = feedM.oracleState;
    feedComps = feedM.comps;
  } catch (error) {
    if (error instanceof ProdStateFailure) {
      feedFailure = error.message;
    } else {
      oracleInconclusiveReason =
        error instanceof Error ? error.message : 'неизвестная ошибка oracle-состояния';
    }
  }

  if (feedFailure === undefined && oracleInconclusiveReason === undefined && !identity) {
    try {
      const trialM = measureOracleState(
        sc.trial as TpdNumericalErrorAuditStateSpec,
        sc.temperatureK,
        sc.pressurePa,
        provider
      );
      trial = trialM.measurement;
      trialOracle = trialM.oracleState;
      trialComps = trialM.comps;
    } catch (error) {
      if (error instanceof ProdStateFailure) {
        trialFailure = error.message;
      } else {
        oracleInconclusiveReason =
          error instanceof Error ? error.message : 'неизвестная ошибка oracle-состояния';
      }
    }
  } else if (feedFailure === undefined && oracleInconclusiveReason === undefined && identity) {
    trialOracle = feedOracle;
    trialComps = feedComps;
  }

  if (
    feedFailure === undefined &&
    trialFailure === undefined &&
    oracleInconclusiveReason === undefined &&
    feedOracle !== null &&
    trialOracle !== null
  ) {
    const trialSpec = identity ? sc.feed : (sc.trial as TpdNumericalErrorAuditStateSpec);
    const prodTpd = provider.tangentPlaneDistance(
      sc.feed,
      trialSpec,
      sc.temperatureK,
      sc.pressurePa
    );
    if (isProdTpdFailure(prodTpd)) {
      tpdFailure = prodTpd.failure;
    } else {
      try {
        // Константы для narrowing: let-ссылки не сужаются внутри замыканий.
        const feedState = feedOracle;
        const trialState = trialOracle;
        // Канонические oracle-компоненты с ln(phi)-enclosure-ами.
        const feedOracleComps = feedComps.map((c, i) => ({
          id: c.id,
          moleFraction: c.x,
          lnPhi: feedState.lnPhi[i]
        }));
        const trialOracleComps = trialComps.map((c, i) => ({
          id: c.id,
          moleFraction: c.x,
          lnPhi: trialState.lnPhi[i]
        }));
        const tpdBall = oracleTpdBall(feedOracleComps, trialOracleComps);
        const feedLnById = new Map<string, Ball>();
        feedComps.forEach((c, i) => feedLnById.set(c.id, feedState.lnPhi[i]));
        const trialLnById = new Map<string, Ball>();
        trialComps.forEach((c, i) => trialLnById.set(c.id, trialState.lnPhi[i]));
        const perComp = prodTpd.contributions.map((c) => {
          const lnRatioBall = oracleLnRatio(c.w, c.z);
          const contribBall = oracleTpdContribution(
            c.w,
            c.z,
            trialLnById.get(c.component) as Ball,
            feedLnById.get(c.component) as Ball
          );
          return {
            comp: c.component,
            lnRatio: c.lnRatio,
            eLnRatio: oracleErrorBound(c.lnRatio, lnRatioBall),
            contribution: c.contribution,
            eContrib: oracleErrorBound(c.contribution, contribBall)
          };
        });
        const eTpd = oracleErrorBound(prodTpd.tpd, tpdBall);
        tpd = {
          tpd: prodTpd.tpd,
          details: prodTpd.contributions.map((c) => ({
            comp: c.component,
            w: c.w,
            z: c.z,
            lnRatio: c.lnRatio,
            bracket: c.bracket,
            contribution: c.contribution
          })),
          oracleTpdCenter: oracleCenter(tpdBall),
          rTpd: tpdBall.r,
          eTpd,
          signDetermined: Math.abs(prodTpd.tpd) > eTpd,
          perComp
        };
      } catch (error) {
        oracleInconclusiveReason =
          error instanceof Error ? error.message : 'неизвестная ошибка oracle-TPD';
      }
    }
  }

  let status: TpdNumericalErrorAuditScenarioStatus;
  if (feedFailure !== undefined) {
    status =
      sc.expectFailure !== null && failureMatches(sc.expectFailure, feedFailure)
        ? 'expected_failure'
        : 'unexpected_failure';
  } else if (trialFailure !== undefined) {
    status =
      sc.expectFailure !== null && failureMatches(sc.expectFailure, trialFailure)
        ? 'expected_failure'
        : 'unexpected_failure';
  } else if (tpdFailure !== undefined) {
    status =
      sc.expectFailure !== null && failureMatches(sc.expectFailure, tpdFailure)
        ? 'expected_failure'
        : 'unexpected_failure';
  } else if (oracleInconclusiveReason !== undefined) {
    status = 'oracle_inconclusive';
  } else {
    status = 'audited';
  }

  return {
    id: sc.id,
    group: sc.group,
    note: sc.note,
    T: sc.temperatureK,
    P: sc.pressurePa,
    expectFailure: sc.expectFailure,
    feed,
    trial,
    tpd,
    feedFailure,
    trialFailure,
    tpdFailure,
    oracleFailure: oracleInconclusiveReason,
    status
  };
}

/** Self-test оракула ( enclosure-валидность базовых операций ). */
function buildSelfTest(): TpdNumericalErrorAuditSelfTest {
  const ln8 = oracleCenter(tsLog(tsBall(8)));
  const ln2 = oracleCenter(tsLog(tsBall(2)));
  const sqrt2Ball = tsSqrt(tsBall(2));
  const subnormalBall = tsMulB(tsBall(1e-320), tsBall(1e-320));
  const identityBall = oracleLnRatio(0.95, 0.95);
  const subnormalCenter = oracleCenter(subnormalBall);
  return {
    ln8_vs_3ln2: Math.abs(ln8 - 3 * ln2),
    sqrt2_bound: oracleErrorBound(Math.SQRT2, sqrt2Ball),
    log3_bound: oracleErrorBound(Math.log(3), tsLog(tsBall(3))),
    subnormalMul: {
      center: subnormalCenter,
      r: subnormalBall.r,
      // Истинное произведение fl(1e-320)^2 ~ 1e-640 неотличимо от 0 в double:
      // enclosure обязан накрывать и его, и 0.
      coversTrue: subnormalCenter - subnormalBall.r <= 0 &&
        subnormalCenter + subnormalBall.r >= 0
    },
    lnRatio_identity: {
      center: oracleCenter(identityBall),
      r: identityBall.r
    }
  };
}

/**
 * Полный прогон матрицы через провайдера. Детерминирован: без дат,
 * генераторов случайности и обращений к среде; результат зависит только
 * от production-значений провайдера.
 */
export function runTpdNumericalErrorAudit(
  provider: TpdNumericalErrorAuditProvider
): TpdNumericalErrorAuditReport {
  const results = TPD_NUMERICAL_ERROR_AUDIT_SCENARIOS.map((sc) => runScenario(sc, provider));
  const audited: TpdNumericalErrorAuditScenarioResult[] = [];
  const expectedFailures: { id: string; reason: string }[] = [];
  const unexpectedFailures: { id: string; reason: string }[] = [];
  const oracleInconclusive: { id: string; reason: string }[] = [];
  let maxEz = 0;
  let maxELnPhi = 0;
  let maxETpd = 0;
  for (const r of results) {
    if (r.status === 'audited') {
      audited.push(r);
    } else if (r.status === 'expected_failure') {
      expectedFailures.push({
        id: r.id,
        reason:
          r.feedFailure !== undefined
            ? r.feedFailure
            : r.trialFailure !== undefined
              ? r.trialFailure
              : (r.tpdFailure as string)
      });
    } else if (r.status === 'unexpected_failure') {
      unexpectedFailures.push({
        id: r.id,
        reason:
          r.feedFailure !== undefined
            ? r.feedFailure
            : r.trialFailure !== undefined
              ? r.trialFailure
              : (r.tpdFailure as string)
      });
    } else {
      oracleInconclusive.push({
        id: r.id,
        reason: r.oracleFailure !== undefined ? r.oracleFailure : 'oracle_inconclusive'
      });
    }
  }
  for (const r of audited) {
    const states = [r.feed, r.trial];
    for (const s of states) {
      if (s === undefined) {
        continue;
      }
      if (s.eZtotal > maxEz) {
        maxEz = s.eZtotal;
      }
      if (s.eLnPhiMax > maxELnPhi) {
        maxELnPhi = s.eLnPhiMax;
      }
    }
    if (r.tpd !== undefined && r.tpd.eTpd > maxETpd) {
      maxETpd = r.tpd.eTpd;
    }
  }
  return {
    selfTest: buildSelfTest(),
    summary: {
      scenarioCount: results.length,
      auditedCount: audited.length,
      expectedFailures,
      unexpectedFailures,
      oracleInconclusive,
      maxEz,
      maxELnPhi,
      maxETpd,
      globals: {
        R: TPD_NUMERICAL_ERROR_AUDIT_R_J_PER_MOL_K,
        kij_co2_n2: TPD_NUMERICAL_ERROR_AUDIT_KIJ_CO2_N2,
        co2: {
          Tc: TPD_NUMERICAL_ERROR_AUDIT_CO2.criticalTemperatureK,
          Pc: TPD_NUMERICAL_ERROR_AUDIT_CO2.criticalPressurePa,
          omega: TPD_NUMERICAL_ERROR_AUDIT_CO2.acentricFactor
        },
        n2: {
          Tc: TPD_NUMERICAL_ERROR_AUDIT_N2.criticalTemperatureK,
          Pc: TPD_NUMERICAL_ERROR_AUDIT_N2.criticalPressurePa,
          omega: TPD_NUMERICAL_ERROR_AUDIT_N2.acentricFactor
        },
        bipApplicabilityK: TPD_NUMERICAL_ERROR_AUDIT_BIP_APPLICABILITY_K,
        engine: provider.label
      }
    },
    results
  };
}
