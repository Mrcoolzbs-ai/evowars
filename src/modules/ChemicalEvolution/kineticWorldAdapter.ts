// ============================================
// KINETIC WORLD ADAPTER — пользовательский кинетический
// эксперимент №89/№106 в паспорте мира
// ============================================
//
// Stage 4.5.5, интеграционный срез (2026-11-10). Этот срез НЕ
// завершает 4.5.5 и НЕ закрывает блокирующие вопросы 4.5.4:
// записи №1/№70/№72 остаются unknown (no_kinetic_data) и в механизм
// не входят; совместный сегмент №89+№106 допустим только при 300 K.
//
// Эксперимент — ОТДЕЛЬНОЕ опциональное состояние мира
// (GeneratedWorld.kineticExperiment):
// - начальные запасы задаёт пользователь ЯВНО (все семь видов в
//   моль/м²): они НЕ заимствуются из chemicalState.inventory и не
//   извлекаются из атмосферного состава (радикалов O, NO, NO2, H,
//   HO2 в атмосферном каталоге нет);
// - толщина слоя НЕ выводится из давления, гравитации, молярной
//   массы или масштаба высоты;
// - запас N₂ НЕ выводится из доли азота, воздуха, смеси или
//   давления: он задаётся явно и строго положительным;
// - физическое время — сумма dtSeconds сегментов в физических
//   секундах; gameTime/extentFraction/gameSpeedCoefficient/игровые
//   годы НЕ участвуют;
// - режим A (applyReaction/runChemicalEvolutionStep) и
//   ChemicalEvolutionState НЕ меняются: эксперимент к ним не
//   подключён, стехиометрический и кинетический инвентари не
//   смешиваются.
//
// Контракт атомарности: состояние мира обновляется только после
// ПОЛНОГО успешного завершения траектории. При любой ошибке
// выбрасывается существующая KineticMechanismError; исходный мир
// не мутируется, частично обновлённый эксперимент не возвращается.
// Результаты эксперимента НЕ выдаются за рассчитанную эволюцию
// атмосферы планеты: перенос, диффузия, конвекция и пополнение
// вещества не моделируются.

import type {
  GeneratedWorld,
  KineticExperimentInventoryMolM2,
  KineticExperimentRunRecord,
  KineticExperimentState
} from '../../types';
import { KineticMechanismError } from './kineticMechanism';
import { runKineticCompartmentTrajectory } from './kineticTrajectory';
import type { KineticCompartmentTrajectorySegmentInput } from './kineticTrajectory';

/** Версия схемы состояния эксперимента (KineticExperimentState.schemaVersion). */
export const KINETIC_EXPERIMENT_SCHEMA_VERSION = '1.0.0';

/** Виды ограниченного механизма (в каноническом порядке каталога). */
export const KINETIC_EXPERIMENT_SPECIES = ['O', 'NO', 'NO2', 'H', 'O2', 'HO2', 'N2'] as const;

/** Идентификаторы реакций механизма №89/№106 (другие запрещены). */
const MECHANISM_REACTION_IDS = ['kida-tb-2015-03-19-89', 'kida-tb-2015-03-19-106'] as const;

/**
 * Явные начальные запасы при первичной настройке. Все семь полей
 * задаются пользователем: ОТСУТСТВУЮЩЕЕ поле — отсутствие значения,
 * а не ноль (ошибка настройки, а не молчаливый ноль). Явный ноль
 * допустим для реакционных видов; N₂ — конечный строго
 * положительный.
 */
export interface KineticExperimentInventoryInput {
  readonly O?: number;
  readonly NO?: number;
  readonly NO2?: number;
  readonly H?: number;
  readonly O2?: number;
  readonly HO2?: number;
  readonly N2?: number;
}

/** Явная первичная настройка эксперимента (только для первого запуска). */
export interface KineticExperimentSetupInput {
  /** Постоянная толщина однородного реакционного слоя, м (конечная, > 0; НЕ выводится из параметров мира). */
  readonly layerThicknessM: number;
  /** Явные начальные запасы всех семи видов, моль/м². */
  readonly initialInventoriesMolM2: KineticExperimentInventoryInput;
}

/**
 * Вход runWorldKineticTrajectory: расписание сегментов (контракт
 * существующего runKineticCompartmentTrajectory) и, только для
 * ПЕРВОГО запуска, явная настройка. При продолжении уже
 * настроенного эксперимента setup не принимается: для смены
 * начальных условий нужен явный сброс (resetWorldKineticExperiment)
 * и новая настройка.
 */
export interface WorldKineticTrajectoryInput {
  readonly segments: readonly KineticCompartmentTrajectorySegmentInput[];
  readonly setup?: KineticExperimentSetupInput;
}

// ============================================
// 1. ВАЛИДАЦИЯ СОСТОЯНИЯ ЭКСПЕРИМЕНТА
// ============================================

/**
 * Проблемы формы инвентаря эксперимента (семь явных видов).
 * Проверяются: присутствие всех семи ключей, конечность,
 * неотрицательность, строгая положительность N₂, отсутствие
 * unknown-ключей.
 */
function inventoryProblems(inventory: unknown, label: string): string[] {
  if (typeof inventory !== 'object' || inventory === null || Array.isArray(inventory)) {
    return [label + ': ожидается объект инвентаря с явными запасами семи видов, моль/м²'];
  }
  const record = inventory as Record<string, unknown>;
  const problems: string[] = [];
  for (const species of KINETIC_EXPERIMENT_SPECIES) {
    const value = record[species];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push(label + '.' + species + ': ожидается конечное число (моль/м²)');
      continue;
    }
    if (value < 0) {
      problems.push(label + '.' + species + ': отрицательный запас запрещён');
    }
    if (species === 'N2' && value <= 0) {
      problems.push(label + '.N2: запас N₂ обязан быть конечным и строго положительным (третье тело механизма)');
    }
  }
  const unknownKeys = Object.keys(record).filter(
    (key) => !(KINETIC_EXPERIMENT_SPECIES as readonly string[]).includes(key)
  );
  if (unknownKeys.length > 0) {
    problems.push(label + ': неизвестные ключи ' + unknownKeys.join(', ') + ' (механизм ограничен видами O, NO, NO2, H, O2, HO2, N2)');
  }
  return problems;
}

/**
 * Проверка формы состояния эксперимента (для состояний, пришедших
 * из сохранений/импорта, и перед продолжением эксперимента).
 * Аналогично валидации журнала реакций (4.2.3.3.1): некорректное
 * состояние НЕ «чинится» молча и не подменяется пустым — проблемы
 * возвращаются диагностикой. undefined — отсутствие эксперимента,
 * не ошибка; явный null — некорректная форма.
 */
export function kineticExperimentStateProblems(state: unknown): string[] {
  if (state === undefined) {
    return [];
  }
  if (state === null) {
    return ['состояние равно null: отсутствие эксперимента выражается отсутствием поля, а не null (некорректная форма)'];
  }
  if (typeof state !== 'object' || Array.isArray(state)) {
    const description = Array.isArray(state) ? 'массив' : 'значение типа ' + typeof state;
    return ['состояние должно быть объектом KineticExperimentState (или отсутствовать), получено: ' + description];
  }
  const record = state as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof record.schemaVersion !== 'string' || record.schemaVersion !== KINETIC_EXPERIMENT_SCHEMA_VERSION) {
    const got = typeof record.schemaVersion === 'string' ? record.schemaVersion : typeof record.schemaVersion;
    problems.push('schemaVersion: ожидается «' + KINETIC_EXPERIMENT_SCHEMA_VERSION + '», получено: ' + got + ' (состояние не мигрируется и не «чинится» автоматически)');
  }
  if (typeof record.layerThicknessM !== 'number' || !Number.isFinite(record.layerThicknessM) || record.layerThicknessM <= 0) {
    problems.push('layerThicknessM: ожидается конечная строго положительная толщина реакционного слоя, м');
  }
  problems.push(...inventoryProblems(record.currentInventoriesMolM2, 'currentInventoriesMolM2'));
  if (typeof record.elapsedSeconds !== 'number' || !Number.isFinite(record.elapsedSeconds) || record.elapsedSeconds < 0) {
    problems.push('elapsedSeconds: ожидается конечное неотрицательное накопленное физическое время, с');
  }
  if (typeof record.completedRuns !== 'number' || !Number.isInteger(record.completedRuns) || record.completedRuns < 0) {
    problems.push('completedRuns: ожидается неотрицательное целое число завершённых запусков');
  }
  if (!Array.isArray(record.history)) {
    problems.push('history: ожидается массив записей успешно завершённых запусков');
    return problems;
  }
  if (
    typeof record.completedRuns === 'number' &&
    Number.isInteger(record.completedRuns) &&
    record.completedRuns >= 0 &&
    record.history.length !== record.completedRuns
  ) {
    problems.push('history: длина истории (' + record.history.length + ') не совпадает с completedRuns (' + record.completedRuns + ')');
  }
  record.history.forEach((run, index) => {
    const label = 'history[' + index + ']';
    if (typeof run !== 'object' || run === null || Array.isArray(run)) {
      problems.push(label + ': запись запуска должна быть объектом KineticExperimentRunRecord');
      return;
    }
    const runRecord = run as Record<string, unknown>;
    if (runRecord.runIndex !== index) {
      problems.push(label + '.runIndex: ожидается ' + index + ' (последовательность запусков нарушена)');
    }
    problems.push(...inventoryProblems(runRecord.startInventoriesMolM2, label + '.startInventoriesMolM2'));
    problems.push(...inventoryProblems(runRecord.endInventoriesMolM2, label + '.endInventoriesMolM2'));
    for (const field of ['startElapsedSeconds', 'endElapsedSeconds'] as const) {
      const value = runRecord[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        problems.push(label + '.' + field + ': ожидается конечное неотрицательное накопленное время, с');
      }
    }
    if (
      typeof runRecord.startElapsedSeconds === 'number' &&
      typeof runRecord.endElapsedSeconds === 'number' &&
      runRecord.endElapsedSeconds < runRecord.startElapsedSeconds
    ) {
      problems.push(label + ': конечное накопленное время меньше начального');
    }
    if (!Array.isArray(runRecord.segments)) {
      problems.push(label + '.segments: ожидается массив записей сегментов расписания');
    } else {
      let expectedStart = 0;
      runRecord.segments.forEach((segment, segmentIndex) => {
        const segLabel = label + '.segments[' + segmentIndex + ']';
        if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) {
          problems.push(segLabel + ': запись сегмента должна быть объектом');
          return;
        }
        const seg = segment as Record<string, unknown>;
        if (typeof seg.temperatureK !== 'number' || !Number.isFinite(seg.temperatureK) || seg.temperatureK <= 0) {
          problems.push(segLabel + '.temperatureK: ожидается конечная строго положительная температура, K');
        }
        if (typeof seg.dtSeconds !== 'number' || !Number.isFinite(seg.dtSeconds) || seg.dtSeconds <= 0) {
          problems.push(segLabel + '.dtSeconds: ожидается конечная строго положительная длительность, с');
        }
        if (
          !Array.isArray(seg.reactionIds) ||
          seg.reactionIds.length === 0 ||
          seg.reactionIds.some((id) => typeof id !== 'string' || !(MECHANISM_REACTION_IDS as readonly string[]).includes(id))
        ) {
          problems.push(segLabel + '.reactionIds: ожидается непустой список реакций №89/№106 без дублей');
        }
        if (typeof seg.startTimeSeconds !== 'number' || !Number.isFinite(seg.startTimeSeconds)) {
          problems.push(segLabel + '.startTimeSeconds: ожидается конечное время начала сегмента, с');
        } else if (seg.startTimeSeconds !== expectedStart) {
          problems.push(segLabel + '.startTimeSeconds: ожидалось ' + expectedStart + ' (цепочка сегментов запуска нарушена)');
        }
        if (typeof seg.endTimeSeconds !== 'number' || !Number.isFinite(seg.endTimeSeconds)) {
          problems.push(segLabel + '.endTimeSeconds: ожидается конечное время конца сегмента, с');
        } else {
          expectedStart = seg.endTimeSeconds;
        }
      });
      // Перекрёстная сверка: накопленное время запуска обязано
      // совпадать с концом его последнего сегмента (сегменты
      // нумеруются от старта запуска).
      if (runRecord.segments.length > 0) {
        const last = runRecord.segments[runRecord.segments.length - 1];
        if (typeof last === 'object' && last !== null && !Array.isArray(last)) {
          const lastEnd = (last as Record<string, unknown>).endTimeSeconds;
          const runStart = runRecord.startElapsedSeconds;
          const runEnd = runRecord.endElapsedSeconds;
          if (
            typeof lastEnd === 'number' && Number.isFinite(lastEnd) &&
            typeof runStart === 'number' && Number.isFinite(runStart) &&
            typeof runEnd === 'number' && Number.isFinite(runEnd) &&
            runEnd !== runStart + lastEnd
          ) {
            problems.push(
              label + ': конечное накопленное время запуска не совпадает с концом его последнего сегмента (цепочка времени нарушена)'
            );
          }
        }
      }
    }
    for (const field of ['warnings', 'assumptions'] as const) {
      const value = runRecord[field];
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        problems.push(label + '.' + field + ': ожидается массив строк');
      }
    }
  });
  // Цепочка накопленного времени: запуск N начинается с конечного
  // времени запуска N−1; elapsedSeconds совпадает с концом последнего.
  if (record.history.length > 0) {
    let expectedElapsed = 0;
    record.history.forEach((run, index) => {
      if (typeof run !== 'object' || run === null || Array.isArray(run)) {
        return;
      }
      const runRecord = run as Record<string, unknown>;
      if (typeof runRecord.startElapsedSeconds === 'number' && runRecord.startElapsedSeconds !== expectedElapsed) {
        problems.push('history[' + index + '].startElapsedSeconds: ожидалось ' + expectedElapsed + ' (цепочка запусков нарушена)');
      }
      if (typeof runRecord.endElapsedSeconds === 'number' && Number.isFinite(runRecord.endElapsedSeconds)) {
        expectedElapsed = runRecord.endElapsedSeconds;
      }
    });
    if (typeof record.elapsedSeconds === 'number' && Number.isFinite(record.elapsedSeconds) && expectedElapsed !== record.elapsedSeconds) {
      problems.push('elapsedSeconds (' + record.elapsedSeconds + ') не совпадает с конечным накопленным временем последнего запуска (' + expectedElapsed + ')');
    }
  }
  return problems;
}

// ============================================
// 2. ПЕРВИЧНАЯ НАСТРОЙКА
// ============================================

/**
 * Разбор явной первичной настройки. Возвращает готовый инвентарь
 * (все семь видов) и/или список проблем: пустое поле — отсутствие
 * значения, а не ноль; реакционные нули допустимы; N₂ — конечный
 * строго положительный; неизвестные ключи запрещены.
 */
function parseSetup(setup: KineticExperimentSetupInput): { inventories: KineticExperimentInventoryMolM2 | null; problems: string[] } {
  const problems: string[] = [];
  if (typeof setup !== 'object' || setup === null || Array.isArray(setup)) {
    return { inventories: null, problems: ['настройка должна быть объектом KineticExperimentSetupInput'] };
  }
  if (typeof setup.layerThicknessM !== 'number' || !Number.isFinite(setup.layerThicknessM) || setup.layerThicknessM <= 0) {
    problems.push('layerThicknessM: ожидается конечная строго положительная толщина слоя, м (она не выводится из параметров мира)');
  }
  const raw = setup.initialInventoriesMolM2;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push('initialInventoriesMolM2: ожидается объект с явными запасами всех семи видов, моль/м²');
    return { inventories: null, problems };
  }
  const record = raw as Record<string, unknown>;
  const inventories: KineticExperimentInventoryMolM2 = { O: 0, NO: 0, NO2: 0, H: 0, O2: 0, HO2: 0, N2: 0 };
  for (const species of KINETIC_EXPERIMENT_SPECIES) {
    const value = record[species];
    if (value === undefined || value === null || value === '') {
      problems.push('initialInventoriesMolM2.' + species + ': начальный запас не задан (пустое поле — отсутствие значения, а не ноль; запасы не извлекаются из атмосферного состава)');
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problems.push('initialInventoriesMolM2.' + species + ': ожидается конечное число, моль/м²');
      continue;
    }
    if (value < 0) {
      problems.push('initialInventoriesMolM2.' + species + ': отрицательный запас запрещён');
      continue;
    }
    if (species === 'N2' && value <= 0) {
      problems.push('initialInventoriesMolM2.N2: запас N₂ обязан быть конечным и строго положительным (третье тело механизма; не выводится из доли азота или давления)');
      continue;
    }
    inventories[species] = value;
  }
  const unknownKeys = Object.keys(record).filter(
    (key) => !(KINETIC_EXPERIMENT_SPECIES as readonly string[]).includes(key)
  );
  if (unknownKeys.length > 0) {
    problems.push('initialInventoriesMolM2: неизвестные ключи ' + unknownKeys.join(', ') + ' (механизм ограничен видами O, NO, NO2, H, O2, HO2, N2)');
  }
  return { inventories: problems.length === 0 ? inventories : null, problems };
}

// ============================================
// 3. ЗАПУСК ТРАЕКТОРИИ НА МИРЕ
// ============================================

/**
 * Запуск кинетической траектории эксперимента на мире.
 *
 * Первый запуск (world.kineticExperiment отсутствует) требует
 * явную настройку: layerThicknessM и все семь начальных запасов в
 * моль/м². Последующие запуски используют сохранённые
 * currentInventoriesMolM2 и постоянную толщину слоя; новые
 * начальные запасы НЕ принимаются (нужен явный сброс).
 *
 * Возвращает НОВЫЙ мир с обновлённым kineticExperiment; исходный
 * мир не мутируется. Обновление состояния происходит только после
 * полного успешного завершения траектории: при любой ошибке
 * выбрасывается KineticMechanismError, запись истории не
 * добавляется, частично обновлённый эксперимент не возвращается.
 * Накопленное время суммируется в физических секундах, конечность
 * нового накопленного времени проверяется ДО выполнения
 * траектории. История не обрезается.
 */
export function runWorldKineticTrajectory(
  world: GeneratedWorld,
  input: WorldKineticTrajectoryInput
): GeneratedWorld {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new KineticMechanismError(
      'invalid_input',
      'вход должен быть объектом WorldKineticTrajectoryInput (segments +, при первом запуске, setup)'
    );
  }
  if (!Array.isArray(input.segments)) {
    throw new KineticMechanismError('invalid_input', 'segments: ожидается непустой массив сегментов расписания');
  }
  if (input.segments.length === 0) {
    throw new KineticMechanismError('invalid_input', 'segments: расписание не может быть пустым (добавьте хотя бы один сегмент)');
  }

  // --- Состояние эксперимента: продолжение или явная настройка ---
  const existing = world.kineticExperiment;
  let state: KineticExperimentState;
  if (existing !== undefined) {
    const stateProblems = kineticExperimentStateProblems(existing);
    if (stateProblems.length > 0) {
      throw new KineticMechanismError(
        'invalid_input',
        'состояние кинетического эксперимента мира некорректно (проверьте сохранение): ' + stateProblems.join('; ')
      );
    }
    if (input.setup !== undefined) {
      throw new KineticMechanismError(
        'invalid_input',
        'эксперимент уже настроен: новые начальные запасы и толщина слоя не принимаются; для смены начальных условий выполните явный сброс (resetWorldKineticExperiment) и настройте эксперимент заново'
      );
    }
    state = existing;
  } else {
    if (input.setup === undefined) {
      throw new KineticMechanismError(
        'invalid_input',
        'первый запуск требует явной настройки: layerThicknessM и все семь начальных запасов (O, NO, NO2, H, O2, HO2, N2) в моль/м²; запасы не извлекаются из атмосферного состава'
      );
    }
    const parsed = parseSetup(input.setup);
    if (parsed.inventories === null) {
      throw new KineticMechanismError(
        'invalid_input',
        'настройка кинетического эксперимента некорректна: ' + parsed.problems.join('; ')
      );
    }
    state = {
      schemaVersion: KINETIC_EXPERIMENT_SCHEMA_VERSION,
      layerThicknessM: input.setup.layerThicknessM,
      currentInventoriesMolM2: parsed.inventories,
      elapsedSeconds: 0,
      completedRuns: 0,
      history: []
    };
  }

  // --- Заблаговременная проверка конечности накопленного времени ---
  // Сумма dtSeconds расписания + уже накопленное время обязаны
  // оставаться конечными: переполнение отвергает ВЕСЬ запуск ещё
  // до выполнения траектории.
  let scheduledTotal = 0;
  for (let index = 0; index < input.segments.length; index++) {
    const segment = input.segments[index];
    const dt = typeof segment === 'object' && segment !== null ? segment.dtSeconds : undefined;
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ': dtSeconds должен быть конечным строго положительным числом (физические секунды)',
        { segmentIndex: index }
      );
    }
    const next = scheduledTotal + dt;
    if (!Number.isFinite(next)) {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ': сумма dtSeconds расписания переполняет Number; запуск отклонён целиком (ни один сегмент не выполнен)',
        { segmentIndex: index, elapsedSecondsBeforeSegment: scheduledTotal }
      );
    }
    scheduledTotal = next;
  }
  const newElapsed = state.elapsedSeconds + scheduledTotal;
  if (!Number.isFinite(newElapsed)) {
    throw new KineticMechanismError(
      'invalid_input',
      'накопленное физическое время эксперимента переполняет Number: запуск полностью отклонён (мир, инвентарь и история не изменены)',
      { elapsedSecondsBeforeRun: state.elapsedSeconds, scheduledTotalSeconds: scheduledTotal }
    );
  }

  // --- Выполнение траектории существующим механизмом ---
  const startInventories: KineticExperimentInventoryMolM2 = { ...state.currentInventoriesMolM2 };
  let result;
  try {
    result = runKineticCompartmentTrajectory({
      layerThicknessM: state.layerThicknessM,
      initialInventoriesMolM2: startInventories,
      segments: input.segments
    });
  } catch (error) {
    // Контролируемый отказ: существующая KineticMechanismError
    // пробрасывается как есть (с кодом и деталями механизма),
    // состояние мира не изменяется.
    if (error instanceof KineticMechanismError) {
      throw error;
    }
    throw new KineticMechanismError(
      'integration_failure',
      'кинетическая траектория не выполнена: ' + (error instanceof Error ? error.message : String(error))
    );
  }

  const finalElapsed = state.elapsedSeconds + result.totalTimeSeconds;
  if (!Number.isFinite(finalElapsed)) {
    // После предпроверки недостижимо, но контракт конечности
    // накопленного времени защищается явно: запуск отклонён целиком.
    throw new KineticMechanismError(
      'invalid_input',
      'накопленное физическое время эксперимента переполняет Number: запуск полностью отклонён (мир, инвентарь и история не изменены)'
    );
  }

  // --- Фиксация успешного результата ---
  const endInventories: KineticExperimentInventoryMolM2 = {
    O: result.finalInventoriesMolM2['O'],
    NO: result.finalInventoriesMolM2['NO'],
    NO2: result.finalInventoriesMolM2['NO2'],
    H: result.finalInventoriesMolM2['H'],
    O2: result.finalInventoriesMolM2['O2'],
    HO2: result.finalInventoriesMolM2['HO2'],
    N2: result.finalInventoriesMolM2['N2']
  };
  const runRecord: KineticExperimentRunRecord = {
    runIndex: state.completedRuns,
    startInventoriesMolM2: startInventories,
    endInventoriesMolM2: endInventories,
    startElapsedSeconds: state.elapsedSeconds,
    endElapsedSeconds: finalElapsed,
    segments: result.segments.map((segment) => ({
      index: segment.index,
      temperatureK: segment.temperatureK,
      dtSeconds: segment.dtSeconds,
      reactionIds: [...segment.reactionIds],
      startTimeSeconds: segment.startTimeSeconds,
      endTimeSeconds: segment.endTimeSeconds
    })),
    warnings: [...result.warnings],
    assumptions: [...result.assumptions]
  };
  const nextState: KineticExperimentState = {
    schemaVersion: state.schemaVersion,
    layerThicknessM: state.layerThicknessM,
    currentInventoriesMolM2: endInventories,
    elapsedSeconds: finalElapsed,
    completedRuns: state.completedRuns + 1,
    history: [...state.history, runRecord]
  };
  return { ...world, kineticExperiment: nextState };
}

// ============================================
// 4. ЯВНЫЙ СБРОС ЭКСПЕРИМЕНТА
// ============================================

/**
 * Явный сброс кинетического эксперимента: возвращает НОВЫЙ мир
 * без поля kineticExperiment («эксперимент не настроен»). Сброс —
 * отдельная операция пользователя: он НЕ происходит автоматически
 * при смене расписания, повторном запуске или ошибке. Исходный
 * мир не мутируется; сброс не настроенного эксперимента
 * идемпотентен.
 */
export function resetWorldKineticExperiment(world: GeneratedWorld): GeneratedWorld {
  const { kineticExperiment, ...rest } = world;
  void kineticExperiment;
  return rest;
}
