// ============================================================================
// Stage 4.4.4.4.1 — СКАЛЯРНЫЙ TANGENT-PLANE DISTANCE (TPD) ДЛЯ PR-СМЕСЕЙ
// ----------------------------------------------------------------------------
// Вычисляет Michelsen tangent-plane distance
//
//   TPD(w; z) = SUM_{i: w_i > 0} w_i * [ ln(w_i) - ln(z_i)
//                                          + ln(phi_i(w)) - ln(phi_i(z)) ]
//
// для ДВУХ УЖЕ ВЫЧИСЛЕННЫХ состояний PR-смеси (feed с составом z и trial с
// составом w) из Core/pengRobinsonMixture.ts. Результат безразмерный
// (dG/RT). Повторных расчётов PR внутри модуля НЕТ: ln(phi_i) обоих
// состояний берутся из переданных результатов. Давление в формулу
// отдельным членом НЕ входит: T и P одинаковы в обоих состояниях (это
// проверяется) и сокращаются в разности ln(phi_i(w)) - ln(phi_i(z)).
//
// ГРАНИЦЫ ПОДЭТАПА 4.4.4.4.1 (жёсткие):
// - модуль возвращает ТОЛЬКО скалярное значение TPD (dG/RT) и вклады
//   компонентов; он НЕ возвращает verdict (stable/unstable/
//   unstable_detected/no_instability_found_within_search/indeterminate);
// - поиск минимумов TPD, successive substitution, Baker–Michelsen
//   search, multi-start, перебор граней симплекса и какие-либо
//   фазовые заключения НЕ реализованы;
// - семантика знака (исправление научной формулировки): надёжно
//   вычисленное TPD(w; z) < 0 для любой допустимой пробной точки w —
//   ДОСТАТОЧНОЕ свидетельство неустойчивости feed-фазы в рамках
//   выбранной PR-модели и принятых данных; неотрицательный TPD
//   (включая тривиальный w = z, где TPD = 0) сам по себе НЕ доказывает
//   глобальной устойчивости: положительное заключение требует
//   исключить отрицательные значения по всему допустимому пространству
//   пробных составов, что выходит за границы этого модуля; в реальном
//   численном поиске отрицательность отличают от численной погрешности
//   порогом — порог будет частью будущего search-stage (4.4.4.4.2),
//   НЕ этого модуля;
// - flash, VLE/LLE, фазовый split и интеграция с solveEquilibrium
//   НЕ реализованы.
//
// Сопоставление компонентов — ТОЛЬКО по идентификаторам (не по индексам
// массивов). Trial-состав может иметь меньший носитель, чем feed-состав:
// компоненты с w_i = 0 дают ровно нулевой вклад (выражение 0*ln(0) НЕ
// вычисляется), отсутствующие в trial feed-компоненты просто не входят
// в сумму. Положительная trial-доля компонента, отсутствующего в feed
// или имеющего z_i = 0, — структурный отказ support_violation (НЕ
// Infinity и НЕ NaN).
//
// Числовая дисциплина: вклады суммируются в каноническом порядке
// компонентов (лексикографическая сортировка идентификаторов), поэтому
// результат побитово инвариантен к перестановке входных массивов.
// Сумма — компенсированная (Neumaier): при взаимной компенсации вкладов
// малых TPD поглощение малых слагаемых восстанавливается (пример:
// вклады [1e16, 1, -1e16, +0] дают итог ровно 1, тогда как наивное
// накопление теряет единицу). ln(w/z) вычисляется устойчиво: w === z
// даёт ровно +0; близкие значения — Math.log1p относительной разности
// (без катаклизмического сокращения двух близких логарифмов); заметно
// различные — безопасная разность логарифмов (промежуточное
// переполнение (w - z)/z при subnormal z НЕ исключено и уходит в
// fallback разности логарифмов). Скобка вклада вычисляется
// сохраняющим малый composition-член порядком: сначала точная разность
// lnPhi(trial) - lnPhi(feed), затем прибавление ln(w/z) — большой
// одинаковый сдвиг lnPhi не поглощает малый composition-член.
// TPD(z; z) для одинаковых состояний даёт
// РОВНО +0; никакой epsilon-подмены состава и никакой автоматической
// нормализации. Неконечный вклад или итог — явный numerical_failure,
// не NaN/Infinity в успехе.
//
// Направление зависимостей: модуль живёт в Core, импортирует ТОЛЬКО
// './pengRobinsonMixture' (значение допуска суммы состава + типы);
// Data не импортируется. Core не зависит от Data.
// ============================================================================

import { PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE } from './pengRobinsonMixture';
import type {
  PengRobinsonEvidencePolicy,
  PengRobinsonMixtureBinaryInteractionUsed,
  PengRobinsonMixtureComponentResult,
  PengRobinsonMixtureSuccess,
  PengRobinsonRootBranch
} from './pengRobinsonMixture';

// ============================================
// 1. ТИПЫ И КОНСТАНТЫ
// ============================================

export type PrTangentPlaneDistanceErrorCode =
  | 'invalid_input'
  | 'incompatible_state'
  | 'support_violation'
  | 'numerical_failure';

/** Полный перечень кодов отказа (для аудита полноты enum). */
export const PR_TANGENT_PLANE_DISTANCE_ERROR_CODES: readonly PrTangentPlaneDistanceErrorCode[] =
  ['invalid_input', 'incompatible_state', 'support_violation', 'numerical_failure'];

/**
 * Примечание о границах: TPD — скаляр для двух уже вычисленных
 * состояний, НЕ verdict о фазовой устойчивости. Надёжно вычисленное
 * TPD < 0 для допустимой пробной точки — достаточное свидетельство
 * неустойчивости feed-фазы в рамках PR-модели; неотрицательный TPD
 * (включая w = z) глобальной устойчивости не доказывает.
 */
export const PR_TANGENT_PLANE_DISTANCE_SCOPE_NOTE =
  'TPD — безразмерный скаляр (dG/RT) для двух уже вычисленных состояний PR-смеси; ' +
  'это НЕ verdict о фазовой устойчивости: надёжно вычисленное TPD < 0 для ' +
  'допустимой пробной точки — достаточное свидетельство неустойчивости ' +
  'feed-фазы в рамках PR-модели, но поиск минимумов TPD, порог отличия ' +
  'отрицательности от численной погрешности и фазовые заключения ' +
  'не реализованы (границы Stage 4.4.4.4.1); давление не входит отдельным ' +
  'членом — оно одинаково в feed и trial состояниях и сокращается';

/**
 * Примечание о единственном физическом корне: при единственном корне
 * метки ветвей vapor/liquid ссылаются на один и тот же корень кубики.
 */
export const PR_TANGENT_PLANE_DISTANCE_SINGLE_ROOT_NOTE =
  'единственный физический корень: метки ветвей vapor/liquid ссылаются ' +
  'на один и тот же корень кубики и НЕ являются разными физическими ' +
  'состояниями';

/** Вклад одного компонента (для аудита; только w_i > 0). */
export interface PrTangentPlaneDistanceContribution {
  readonly component: string;
  readonly trialMoleFraction: number;
  readonly feedMoleFraction: number;
  readonly lnPhiTrial: number;
  readonly lnPhiFeed: number;
  readonly contribution: number;
}

/** Успех: скаляр TPD (dG/RT) и диагностические поля. Никаких verdicts. */
export interface PrTangentPlaneDistanceSuccess {
  readonly status: 'success';
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
  readonly feedRoot: PengRobinsonRootBranch;
  readonly trialRoot: PengRobinsonRootBranch;
  /** TPD(w; z) = dG/RT, безразмерный. */
  readonly tpd: number;
  /** Вклады компонентов в каноническом порядке (только w_i > 0). */
  readonly contributions: readonly PrTangentPlaneDistanceContribution[];
  /** Компактная копия состава feed (канонический порядок). */
  readonly feedComposition: readonly { component: string; moleFraction: number }[];
  /** Компактная копия состава trial (канонический порядок). */
  readonly trialComposition: readonly { component: string; moleFraction: number }[];
  readonly notes: readonly string[];
}

/** Отказ: устойчивый код + диагностика. */
export interface PrTangentPlaneDistanceFailure {
  readonly status: 'failure';
  readonly code: PrTangentPlaneDistanceErrorCode;
  readonly message: string;
  readonly detail?: string;
}

/** Discriminated union результата. */
export type PrTangentPlaneDistanceResult =
  | PrTangentPlaneDistanceSuccess
  | PrTangentPlaneDistanceFailure;

/** Вход: два уже вычисленных успешных состояния PR-смеси. */
export interface PrTangentPlaneDistanceInput {
  readonly feed: PengRobinsonMixtureSuccess;
  readonly trial: PengRobinsonMixtureSuccess;
}

// ============================================
// 2. ЛОКАЛЬНЫЕ HELPERS ВАЛИДАЦИИ
// ============================================

/** Проверка «конечное число». */
function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isNonNullObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function failure(
  code: PrTangentPlaneDistanceErrorCode,
  message: string,
  detail?: string
): PrTangentPlaneDistanceFailure {
  return detail === undefined
    ? { status: 'failure', code, message }
    : { status: 'failure', code, message, detail };
}

/** Канонический ключ пары (лексикографический порядок идентификаторов). */
function pairKey(componentA: string, componentB: string): string {
  return componentA < componentB
    ? `${componentA}|${componentB}`
    : `${componentB}|${componentA}`;
}

/**
 * Порог переключения форм ln(w/z): если относительная разность
 * (w - z)/z конечна и |(w - z)/z| <= 0.5, используется Math.log1p
 * относительной разности — аргумент хорошо обусловлен,
 * катаклизмического сокращения двух близких логарифмов нет. Если
 * относительная разность превосходит порог или переполнилась до
 * ±Infinity (например, при очень малом положительном z — доля может
 * быть subnormal), используется разность Math.log(w) - Math.log(z):
 * она не образует промежуточного отношения w/z и для конечных
 * положительных w и z остаётся конечной. w === z возвращает ровно +0
 * до любой арифметики. Критерий — условная граница двух областей
 * точности, НЕ epsilon-подмена значений; промежуточное переполнение
 * (w - z)/z НЕ исключено (доли не превосходят единицы, но z может быть
 * сколь угодно малым) и обрабатывается fallback-формой, а не
 * ограничением входов.
 */
const PR_TPD_LOG_RATIO_LOG1P_THRESHOLD = 0.5;

/**
 * Устойчивый ln(w/z) для конечных положительных w и z. w === z даёт
 * РОВНО +0 (тривиальный случай TPD(z; z) сохраняется побитово).
 * Возвращает null, если устойчивое вычисление невозможно (неконечный
 * результат), — вызывающий код переводит это в ЯВНЫЙ
 * numerical_failure. Никаких epsilon-подмен значений и молчаливой
 * нормализации.
 */
function stableLogRatio(w: number, z: number): number | null {
  if (w === z) {
    return 0;
  }
  const relativeDifference = (w - z) / z;
  if (Math.abs(relativeDifference) <= PR_TPD_LOG_RATIO_LOG1P_THRESHOLD) {
    const viaLog1p = Math.log1p(relativeDifference);
    return Number.isFinite(viaLog1p) ? viaLog1p : null;
  }
  const viaDifference = Math.log(w) - Math.log(z);
  return Number.isFinite(viaDifference) ? viaDifference : null;
}

/**
 * Состояние компенсированной суммы Neumaier: sum — текущая наивная
 * частичная сумма, compensation — накопленная невязка округлений.
 * Финальное значение = sum + compensation. Восстанавливает
 * поглощение малых вкладов при взаимной компенсации (малые TPD);
 * стандартный Kahan НЕ используется: на последовательности
 * [1e16, 1, -1e16] он может потерять единицу, Neumaier сохраняет итог 1.
 */
interface NeumaierSum {
  sum: number;
  compensation: number;
}

/** Один шаг компенсированного суммирования Neumaier. */
function neumaierAdd(state: NeumaierSum, value: number): void {
  const newSum = state.sum + value;
  if (Math.abs(state.sum) >= Math.abs(value)) {
    state.compensation += (state.sum - newSum) + value;
  } else {
    state.compensation += (value - newSum) + state.sum;
  }
  state.sum = newSum;
}

interface ValidatedComponents {
  /** Карта «идентификатор -> компонент». */
  readonly byId: ReadonlyMap<string, PengRobinsonMixtureComponentResult>;
  /** Компоненты в каноническом (лексикографическом) порядке. */
  readonly sorted: readonly PengRobinsonMixtureComponentResult[];
}

/**
 * Валидация массива components состояния: непустой массив, объекты с
 * непустым строковым идентификатором, конечной неотрицательной долей,
 * уникальные идентификаторы, сумма в допуске
 * PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE (без нормализации).
 */
function validateComponents(
  state: PengRobinsonMixtureSuccess,
  label: string
): ValidatedComponents | PrTangentPlaneDistanceFailure {
  const raw: unknown = state.components;
  if (!Array.isArray(raw) || raw.length === 0) {
    return failure(
      'invalid_input',
      `состояние ${label}: components должен быть непустым массивом`
    );
  }
  const byId = new Map<string, PengRobinsonMixtureComponentResult>();
  let sum = 0;
  for (const entry of raw) {
    if (!isNonNullObject(entry)) {
      return failure('invalid_input', `состояние ${label}: каждый компонент должен быть объектом`);
    }
    const component: unknown = entry.component;
    if (typeof component !== 'string' || component.length === 0) {
      return failure(
        'invalid_input',
        `состояние ${label}: идентификатор компонента должен быть непустой строкой`
      );
    }
    const moleFraction: unknown = entry.moleFraction;
    if (!isFiniteNumber(moleFraction) || moleFraction < 0) {
      return failure(
        'invalid_input',
        `состояние ${label}, компонент «${component}»: moleFraction должна быть ` +
          'конечным неотрицательным числом'
      );
    }
    if (byId.has(component)) {
      return failure(
        'invalid_input',
        `состояние ${label}: дублирующийся идентификатор компонента «${component}»`
      );
    }
    byId.set(component, entry as unknown as PengRobinsonMixtureComponentResult);
    sum += moleFraction;
  }
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE) {
    return failure(
      'invalid_input',
      `состояние ${label}: сумма mole fractions должна быть равна 1 в допуске ` +
        `${PENG_ROBINSON_MIXTURE_COMPOSITION_SUM_TOLERANCE}, получено: ${String(sum)}; ` +
        'нормализация не выполняется'
    );
  }
  const sorted = [...byId.values()].sort((left, right) =>
    left.component < right.component ? -1 : left.component > right.component ? 1 : 0
  );
  return { byId, sorted };
}

/**
 * Валидация массива binaryInteractionsUsed состояния: массив (может быть
 * пустым), записи — объекты с непустыми строковыми идентификаторами пары,
 * конечным kij, непустым evidence и applicabilityRangeK (null или объект
 * с конечными границами).
 */
function validateInteractions(
  state: PengRobinsonMixtureSuccess,
  label: string
): PrTangentPlaneDistanceFailure | undefined {
  const raw: unknown = state.binaryInteractionsUsed;
  if (!Array.isArray(raw)) {
    return failure(
      'invalid_input',
      `состояние ${label}: binaryInteractionsUsed должен быть массивом`
    );
  }
  for (const entry of raw) {
    if (!isNonNullObject(entry)) {
      return failure(
        'invalid_input',
        `состояние ${label}: каждая использованная бинарная запись должна быть объектом`
      );
    }
    const componentA: unknown = entry.componentA;
    const componentB: unknown = entry.componentB;
    if (
      typeof componentA !== 'string' ||
      componentA.length === 0 ||
      typeof componentB !== 'string' ||
      componentB.length === 0
    ) {
      return failure(
        'invalid_input',
        `состояние ${label}: идентификаторы пары должны быть непустыми строками`
      );
    }
    const kij: unknown = entry.kij;
    if (!isFiniteNumber(kij)) {
      return failure(
        'invalid_input',
        `состояние ${label}, пара «${componentA}|${componentB}»: kij должен быть конечным числом`
      );
    }
    const evidence: unknown = entry.evidence;
    if (typeof evidence !== 'string' || evidence.length === 0) {
      return failure(
        'invalid_input',
        `состояние ${label}, пара «${componentA}|${componentB}»: evidence должен быть непустой строкой`
      );
    }
    const range: unknown = entry.applicabilityRangeK;
    if (range !== null && !isNonNullObject(range)) {
      return failure(
        'invalid_input',
        `состояние ${label}, пара «${componentA}|${componentB}»: ` +
          'applicabilityRangeK должен быть null или объектом'
      );
    }
    if (isNonNullObject(range)) {
      const minTemperatureK: unknown = range.minTemperatureK;
      const maxTemperatureK: unknown = range.maxTemperatureK;
      if (!isFiniteNumber(minTemperatureK) || !isFiniteNumber(maxTemperatureK)) {
        return failure(
          'invalid_input',
          `состояние ${label}, пара «${componentA}|${componentB}»: границы ` +
            'applicabilityRangeK должны быть конечными числами'
        );
      }
    }
  }
  return undefined;
}

// ============================================
// 3. ГЛАВНАЯ ФУНКЦИЯ
// ============================================

/**
 * Скалярный tangent-plane distance TPD(w; z) для двух уже вычисленных
 * успешных состояний PR-смеси (feed = z, trial = w) при одинаковых
 * T, P и evidencePolicy. Возвращает ТОЛЬКО значение (dG/RT) и
 * вклады; никаких verdict о фазовой устойчивости. Семантика знака:
 * надёжно вычисленное TPD(w; z) < 0 — достаточное свидетельство
 * неустойчивости feed-фазы в рамках выбранной PR-модели и принятых
 * данных; неотрицательный TPD (включая w = z) глобальной устойчивости
 * не доказывает. Числа: устойчивый ln(w/z) (w === z — ровно +0;
 * близкие значения — log1p; заметно различные — разность логарифмов),
 * скобка вклада с разностью lnPhi ПЕРЕД прибавлением lnRatio и
 * компенсированная сумма Neumaier в каноническом порядке;
 * TPD(z; z) = ровно +0; неконечная разность lnPhi, скобка, вклад
 * или итог — явный numerical_failure.
 */
export function computePrTangentPlaneDistance(
  input: PrTangentPlaneDistanceInput
): PrTangentPlaneDistanceResult {
  // --- 3.1. Форма входа и статус обоих состояний -------------------------
  if (!isNonNullObject(input)) {
    return failure('invalid_input', 'вход должен быть объектом { feed, trial }');
  }
  const feedUnknown: unknown = input.feed;
  const trialUnknown: unknown = input.trial;
  if (
    !isNonNullObject(feedUnknown) ||
    feedUnknown.status !== 'success' ||
    !isNonNullObject(trialUnknown) ||
    trialUnknown.status !== 'success'
  ) {
    return failure(
      'invalid_input',
      'feed и trial должны быть результатами PR-смеси со статусом success; ' +
        'переданы состояния статусов: ' +
        `feed = ${isNonNullObject(feedUnknown) ? String(feedUnknown.status) : 'не объект'}, ` +
        `trial = ${isNonNullObject(trialUnknown) ? String(trialUnknown.status) : 'не объект'}`
    );
  }
  const feed = feedUnknown as unknown as PengRobinsonMixtureSuccess;
  const trial = trialUnknown as unknown as PengRobinsonMixtureSuccess;

  // --- 3.2. Конечность T/P и поля ветви ----------------------------------
  if (!isFiniteNumber(feed.temperatureK) || !isFiniteNumber(feed.pressurePa)) {
    return failure(
      'invalid_input',
      'состояние feed: temperatureK и pressurePa должны быть конечными числами'
    );
  }
  if (!isFiniteNumber(trial.temperatureK) || !isFiniteNumber(trial.pressurePa)) {
    return failure(
      'invalid_input',
      'состояние trial: temperatureK и pressurePa должны быть конечными числами'
    );
  }
  if (feed.root !== 'vapor' && feed.root !== 'liquid') {
    return failure('invalid_input', "состояние feed: root должен быть 'vapor' или 'liquid'");
  }
  if (trial.root !== 'vapor' && trial.root !== 'liquid') {
    return failure('invalid_input', "состояние trial: root должен быть 'vapor' или 'liquid'");
  }

  // --- 3.3. Совместность T, P и evidencePolicy ----------------------------
  if (feed.temperatureK !== trial.temperatureK) {
    return failure(
      'incompatible_state',
      'temperatureK состояний должны совпадать побитово: ' +
        `feed = ${String(feed.temperatureK)} K, trial = ${String(trial.temperatureK)} K`
    );
  }
  if (feed.pressurePa !== trial.pressurePa) {
    return failure(
      'incompatible_state',
      'pressurePa состояний должны совпадать побитово: ' +
        `feed = ${String(feed.pressurePa)} Pa, trial = ${String(trial.pressurePa)} Pa`
    );
  }
  if (feed.evidencePolicy !== trial.evidencePolicy) {
    return failure(
      'incompatible_state',
      'evidencePolicy состояний должны совпадать: ' +
        `feed = ${String(feed.evidencePolicy)}, trial = ${String(trial.evidencePolicy)}`
    );
  }
  if (typeof feed.hasDistinctBranches !== 'boolean' || typeof trial.hasDistinctBranches !== 'boolean') {
    return failure(
      'invalid_input',
      'hasDistinctBranches обоих состояний должен быть boolean (флаг числа ветвей корней)'
    );
  }

  // --- 3.4. Валидация массивов компонентов и kij --------------------------
  const feedComponents = validateComponents(feed, 'feed');
  if ('status' in feedComponents) {
    return feedComponents;
  }
  const trialComponents = validateComponents(trial, 'trial');
  if ('status' in trialComponents) {
    return trialComponents;
  }
  const feedInteractionIssue = validateInteractions(feed, 'feed');
  if (feedInteractionIssue !== undefined) {
    return feedInteractionIssue;
  }
  const trialInteractionIssue = validateInteractions(trial, 'trial');
  if (trialInteractionIssue !== undefined) {
    return trialInteractionIssue;
  }

  // --- 3.5. Носитель trial: presence, z_i > 0, a_i/b_i --------------------
  const feedById = feedComponents.byId;
  const trialSupport: PengRobinsonMixtureComponentResult[] = [];
  for (const trialComponent of trialComponents.sorted) {
    if (trialComponent.moleFraction === 0) {
      continue;
    }
    const feedComponent = feedById.get(trialComponent.component);
    if (feedComponent === undefined) {
      return failure(
        'support_violation',
        `компонент «${trialComponent.component}» имеет положительную trial-долю ` +
          `(${String(trialComponent.moleFraction)}), но отсутствует в feed-состоянии`
      );
    }
    if (feedComponent.moleFraction === 0) {
      return failure(
        'support_violation',
        `компонент «${trialComponent.component}» имеет положительную trial-долю ` +
          `(${String(trialComponent.moleFraction)}), но его feed-доля равна нулю`
      );
    }
    if (!isFiniteNumber(trialComponent.aPaM6PerMol2) || !isFiniteNumber(feedComponent.aPaM6PerMol2)) {
      return failure(
        'invalid_input',
        `a_i компонента «${trialComponent.component}» должен быть конечным числом в обоих состояниях: ` +
          `feed = ${String(feedComponent.aPaM6PerMol2)}, trial = ${String(trialComponent.aPaM6PerMol2)}`
      );
    }
    if (trialComponent.aPaM6PerMol2 !== feedComponent.aPaM6PerMol2) {
      return failure(
        'incompatible_state',
        `a_i компонента «${trialComponent.component}» различается между состояниями: ` +
          `feed = ${String(feedComponent.aPaM6PerMol2)}, trial = ${String(trialComponent.aPaM6PerMol2)} ` +
          'Pa*m^6/mol^2 (T и P совпадают — параметры обязаны совпадать)'
      );
    }
    if (!isFiniteNumber(trialComponent.bM3PerMol) || !isFiniteNumber(feedComponent.bM3PerMol)) {
      return failure(
        'invalid_input',
        `b_i компонента «${trialComponent.component}» должен быть конечным числом в обоих состояниях: ` +
          `feed = ${String(feedComponent.bM3PerMol)}, trial = ${String(trialComponent.bM3PerMol)}`
      );
    }
    if (trialComponent.bM3PerMol !== feedComponent.bM3PerMol) {
      return failure(
        'incompatible_state',
        `b_i компонента «${trialComponent.component}» различается между состояниями: ` +
          `feed = ${String(feedComponent.bM3PerMol)}, trial = ${String(trialComponent.bM3PerMol)} ` +
          'm^3/mol (T и P совпадают — параметры обязаны совпадать)'
      );
    }
    trialSupport.push(trialComponent);
  }

  // --- 3.6. Использованные trial-пары kij обязаны присутствовать в feed --
  const feedInteractions = new Map<string, PengRobinsonMixtureBinaryInteractionUsed>();
  for (const used of feed.binaryInteractionsUsed) {
    feedInteractions.set(pairKey(used.componentA, used.componentB), used);
  }
  for (const used of trial.binaryInteractionsUsed) {
    const key = pairKey(used.componentA, used.componentB);
    const feedUsed = feedInteractions.get(key);
    if (feedUsed === undefined) {
      return failure(
        'incompatible_state',
        `использованная trial-пара kij «${key}» отсутствует в feed-состоянии`
      );
    }
    if (used.kij !== feedUsed.kij) {
      return failure(
        'incompatible_state',
        `kij пары «${key}» различается между состояниями: ` +
          `feed = ${String(feedUsed.kij)}, trial = ${String(used.kij)}`
      );
    }
    if (used.evidence !== feedUsed.evidence) {
      return failure(
        'incompatible_state',
        `evidence пары «${key}» различается: feed = ${String(feedUsed.evidence)}, ` +
          `trial = ${String(used.evidence)}`
      );
    }
    const trialRange = used.applicabilityRangeK;
    const feedRange = feedUsed.applicabilityRangeK;
    if (trialRange === null || feedRange === null) {
      if (trialRange !== feedRange) {
        return failure(
          'incompatible_state',
          `applicabilityRangeK пары «${key}» различается: ` +
            `feed = ${feedRange === null ? 'null' : 'объект'}, ` +
            `trial = ${trialRange === null ? 'null' : 'объект'}`
        );
      }
    } else if (
      trialRange.minTemperatureK !== feedRange.minTemperatureK ||
      trialRange.maxTemperatureK !== feedRange.maxTemperatureK
    ) {
      return failure(
        'incompatible_state',
        `applicabilityRangeK пары «${key}» различается: feed = ` +
          `[${String(feedRange.minTemperatureK)}, ${String(feedRange.maxTemperatureK)}] K, ` +
          `trial = [${String(trialRange.minTemperatureK)}, ${String(trialRange.maxTemperatureK)}] K`
      );
    }
  }

  // --- 3.7. Вклады и компенсированная итоговая сумма ---------------------
  const contributions: PrTangentPlaneDistanceContribution[] = [];
  const total: NeumaierSum = { sum: 0, compensation: 0 };
  for (const trialComponent of trialSupport) {
    const feedComponent = feedById.get(trialComponent.component);
    if (feedComponent === undefined) {
      // Недостижимо после 3.5 (защита для тайпчекера).
      return failure('support_violation', `компонент «${trialComponent.component}» отсутствует в feed`);
    }
    const w = trialComponent.moleFraction;
    const z = feedComponent.moleFraction;
    const lnPhiTrial = trialComponent.lnPhi;
    const lnPhiFeed = feedComponent.lnPhi;
    if (!isFiniteNumber(lnPhiTrial) || !isFiniteNumber(lnPhiFeed)) {
      return failure(
        'numerical_failure',
        `lnPhi компонента «${trialComponent.component}» должен быть конечным: ` +
          `feed = ${String(lnPhiFeed)}, trial = ${String(lnPhiTrial)}`
      );
    }
    const lnRatio = stableLogRatio(w, z);
    if (lnRatio === null) {
      return failure(
        'numerical_failure',
        `устойчивое вычисление ln(w/z) для компонента «${trialComponent.component}» ` +
          `невозможно: w = ${String(w)}, z = ${String(z)}`
      );
    }
    const lnPhiDifference = lnPhiTrial - lnPhiFeed;
    if (!Number.isFinite(lnPhiDifference)) {
      return failure(
        'numerical_failure',
        `разность lnPhi компонента «${trialComponent.component}» неконечна`
      );
    }
    // Группировка скобки сохраняет малый composition-член: сначала
    // ТОЧНАЯ разность lnPhi (одинаковый большой сдвиг даёт ровно +0),
    // затем прибавление lnRatio. Лево-ассоциативная форма
    // (lnRatio + lnPhiTrial) - lnPhiFeed округляет малый lnRatio
    // до нуля при большом общем сдвиге lnPhi.
    const bracket = lnRatio + lnPhiDifference;
    if (!Number.isFinite(bracket)) {
      return failure(
        'numerical_failure',
        `скобочное выражение TPD компонента «${trialComponent.component}» неконечно`
      );
    }
    const contribution = w * bracket;
    if (!Number.isFinite(contribution)) {
      return failure(
        'numerical_failure',
        `вклад компонента «${trialComponent.component}» не конечен: ${String(contribution)}`
      );
    }
    neumaierAdd(total, contribution);
    contributions.push({
      component: trialComponent.component,
      trialMoleFraction: w,
      feedMoleFraction: z,
      lnPhiTrial,
      lnPhiFeed,
      contribution
    });
  }
  const tpd = total.sum + total.compensation;
  if (!Number.isFinite(tpd)) {
    return failure(
      'numerical_failure',
      `итоговая компенсированная сумма TPD не конечна: ${String(tpd)}`
    );
  }

  // --- 3.8. Сборка результата (без verdicts) ------------------------------
  const notes = [PR_TANGENT_PLANE_DISTANCE_SCOPE_NOTE];
  if (!feed.hasDistinctBranches || !trial.hasDistinctBranches) {
    notes.push(PR_TANGENT_PLANE_DISTANCE_SINGLE_ROOT_NOTE);
  }
  return {
    status: 'success',
    temperatureK: feed.temperatureK,
    pressurePa: feed.pressurePa,
    evidencePolicy: feed.evidencePolicy,
    feedRoot: feed.root,
    trialRoot: trial.root,
    tpd,
    contributions,
    feedComposition: feedComponents.sorted.map((component) => ({
      component: component.component,
      moleFraction: component.moleFraction
    })),
    trialComposition: trialComponents.sorted.map((component) => ({
      component: component.component,
      moleFraction: component.moleFraction
    })),
    notes
  };
}
