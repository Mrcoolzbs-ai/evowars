// ============================================
// KINETIC TRAJECTORY — последовательная кинетическая
// эволюция одного компартмента
// ============================================
//
// Stage 4.5.5, третий реализационный срез (2026-11-10). Этот срез
// НЕ завершает 4.5.5 и НЕ закрывает блокирующие вопросы 4.5.4:
// записи №1/№70/№72 остаются unknown (no_kinetic_data), JPL Table 2.1
// не извлечена, полная KIDA Troe-форма не реализована.
//
// Назначение модуля — отдельный STATELESS API поверх существующего
// runKineticCompartmentStep (второй срез 4.5.5): последовательная
// траектория ОДНОГО физически явного реакционного слоя по ЯВНОМУ
// расписанию сегментов.
//
// Контракт траектории:
// - расписание сегментов задаётся явно: для каждого сегмента
//   указываются своя температура, своя длительность (физические
//   секунды) и свой список реакций (№89/№106);
// - толщина слоя ОДНА общая постоянная величина на всей траектории
//   (явно переданная, НЕ выводимая из параметров мира);
// - состояние передаётся СТРОГО последовательно: конечный столбовый
//   инвентарь сегмента — начальный инвентарь следующего сегмента
//   (никакого параллельного ветвления и переиспользования начального
//   инвентаря);
// - время накапливается как сумма физических dtSeconds сегментов
//   (конечность СУММЫ проверяется заранее, до выполнения любого
//   сегмента): gameTime/extentFraction/gameSpeedCoefficient
//   НЕ участвуют;
// - отказ ЛЮБОГО сегмента — атомарный отказ ВСЕЙ траектории:
//   частично обновлённый инвентарь НЕ возвращается, диагностика
//   содержит индекс ошибочного сегмента (segmentIndex) и время,
//   пройденное до него (elapsedSecondsBeforeSegment).
//
// Физические предпосылки наследуются от реакционного слоя без
// ослабления: внутри каждого сегмента слой однороден, хорошо
// перемешан и изотермичен; температура изменяется только ДИСКРЕТНО
// между сегментами по явному расписанию (непрерывный профиль
// температуры НЕ моделируется); перенос, диффузия, конвекция,
// осаждение и внешнее пополнение веществ НЕ моделируются.
//
// Модуль НЕ подключён к GeneratedWorld/ChemicalEvolutionState/
// runChemicalEvolutionStep, не читает и не пишет состояние мира.
// Кинетические коэффициенты, RHS, якобиан, решатель Radau IIA,
// преобразования единиц и fail-closed правила НЕ дублируются:
// каждый сегмент делегируется существующему runKineticCompartmentStep,
// включая численно устойчивые конвертеры (отказ дают только
// непредставимые итоги: переполнение итога или underflow
// положительного входа в ноль).
// Отказы используют существующую семантику KineticMechanismError:
// вторая иерархия ошибок НЕ вводится.

import { KineticMechanismError } from './kineticMechanism';
import { runKineticCompartmentStep } from './kineticCompartment';
import type { KineticCompartmentStepResult } from './kineticCompartment';

// ============================================
// 1. ВХОДНОЙ КОНТРАКТ ТРАЕКТОРИИ
// ============================================

/** Один сегмент расписания: своя температура, длительность и реакции. */
export interface KineticCompartmentTrajectorySegmentInput {
  /** Постоянная температура слоя на всём сегменте, K (конечная, строго положительная, в диапазоне выбранных реакций). */
  readonly temperatureK: number;
  /** Длительность сегмента, физические секунды (конечная, строго положительная). */
  readonly dtSeconds: number;
  /** Непустой список идентификаторов разрешённых реакций (№89/№106), без дублей. */
  readonly reactionIds: readonly string[];
}

/**
 * Обратная совместимость (прежнее имя третьего среза): сегмент
 * расписания траектории. Публичный контракт задания —
 * KineticCompartmentTrajectorySegmentInput.
 */
export type KineticTrajectorySegment = KineticCompartmentTrajectorySegmentInput;

/** Вход stateless-траектории одного реакционного слоя. */
export interface KineticCompartmentTrajectoryInput {
  /** Общая постоянная толщина однородного реакционного слоя на ВСЕЙ траектории, м (конечная, строго положительная; НЕ выводится из параметров мира). */
  readonly layerThicknessM: number;
  /** Явные начальные столбовые запасы, моль/м² (все обязательные виды реакций первого сегмента и N₂ — как в контракте слоя). */
  readonly initialInventoriesMolM2: Readonly<Record<string, number>>;
  /** Непустое расписание сегментов: выполняются строго по порядку. */
  readonly segments: readonly KineticCompartmentTrajectorySegmentInput[];
}

/**
 * Обратная совместимость (прежнее имя третьего среза): вход
 * траектории. Публичный контракт задания —
 * KineticCompartmentTrajectoryInput.
 */
export type KineticTrajectoryInput = KineticCompartmentTrajectoryInput;

// ============================================
// 2. РЕЗУЛЬТАТ ТРАЕКТОРИИ
// ============================================

/** Итог одного выполненного сегмента траектории. */
export interface KineticCompartmentTrajectorySegmentResult {
  /** Индекс сегмента в расписании (с нуля). */
  readonly index: number;
  /** Время начала сегмента от старта траектории, физические секунды. */
  readonly startTimeSeconds: number;
  /** Время конца сегмента от старта траектории, физические секунды. */
  readonly endTimeSeconds: number;
  readonly temperatureK: number;
  readonly dtSeconds: number;
  readonly reactionIds: readonly string[];
  /** Полный результат шага реакционного слоя (второй срез 4.5.5), включая концентрационный результат. */
  readonly compartment: KineticCompartmentStepResult;
}

export interface KineticCompartmentTrajectoryResult {
  readonly status: 'completed';
  /** Общая постоянная толщина слоя, м. */
  readonly layerThicknessM: number;
  /** Число выполненных сегментов. */
  readonly segmentCount: number;
  /** Сумма dtSeconds всех сегментов, физические секунды (конечность суммы проверена заранее: гарантированно конечна). */
  readonly totalTimeSeconds: number;
  /** Столбовый инвентарь после последнего сегмента, моль/м² (новый объект; вход НЕ мутируется). */
  readonly finalInventoriesMolM2: Readonly<Record<string, number>>;
  /** Изменяемые виды механизма, участвовавшие хотя бы в одном сегменте (порядок первого появления). */
  readonly updatedSpecies: readonly string[];
  /** Итоги всех сегментов по порядку выполнения. */
  readonly segments: readonly KineticCompartmentTrajectorySegmentResult[];
  /** Явные предпосылки физической модели траектории. */
  readonly assumptions: readonly string[];
  /** Предупреждения всех сегментов с префиксом «[сегмент N]» + предупреждения траектории. */
  readonly warnings: readonly string[];
  readonly notes: readonly string[];
}

/**
 * Обратная совместимость (прежние имена третьего среза): результат
 * траектории и итог сегмента. Публичный контракт задания —
 * KineticCompartmentTrajectoryResult и
 * KineticCompartmentTrajectorySegmentResult.
 */
export type KineticTrajectoryResult = KineticCompartmentTrajectoryResult;
export type KineticTrajectorySegmentSummary = KineticCompartmentTrajectorySegmentResult;

// ============================================
// 3. ТРАЕКТОРИЯ ОДНОГО КОМПАРТМЕНТА
// ============================================

/**
 * Последовательная кинетическая эволюция одного реакционного слоя
 * по явному расписанию сегментов. Каждый сегмент выполняется
 * существующим runKineticCompartmentStep; конечный инвентарь
 * сегмента становится начальным инвентарём следующего.
 *
 * Fail-closed: всё расписание проверяется ДО выполнения любого
 * сегмента (структура, конечность, положительность, реакции и
 * конечность СУММЫ dtSeconds всех сегментов);
 * инвентарные правила (обязательные виды, N₂ > 0, запрет
 * NaN/Infinity/отрицательных, unknown-ключи) проверяются слоем
 * внутри каждого сегмента. Отказ любого сегмента — атомарный отказ
 * всей траектории: выбрасывается KineticMechanismError с исходным
 * кодом сегмента, дополненным segmentIndex и
 * elapsedSecondsBeforeSegment; частичный инвентарь НЕ возвращается.
 * Совместный сегмент №89+№106 допустим только при 300 K
 * (пересечение диапазонов применимости).
 */
export function runKineticCompartmentTrajectory(
  input: KineticCompartmentTrajectoryInput
): KineticCompartmentTrajectoryResult {
  // 1. Форма входа и общая толщина слоя.
  if (input === null || typeof input !== 'object') {
    throw new KineticMechanismError(
      'invalid_input',
      'вход траектории должен быть объектом KineticCompartmentTrajectoryInput'
    );
  }
  if (
    typeof input.layerThicknessM !== 'number' ||
    !Number.isFinite(input.layerThicknessM) ||
    input.layerThicknessM <= 0
  ) {
    throw new KineticMechanismError(
      'invalid_input',
      'layerThicknessM должен быть конечным строго положительным числом, получено: ' + String(input.layerThicknessM),
      { field: 'layerThicknessM', value: String(input.layerThicknessM) }
    );
  }
  const initial = input.initialInventoriesMolM2;
  if (initial === null || typeof initial !== 'object' || Array.isArray(initial)) {
    throw new KineticMechanismError(
      'invalid_input',
      'initialInventoriesMolM2 должен быть объектом «вид → запас, моль/м²»'
    );
  }
  const schedule = input.segments;
  if (!Array.isArray(schedule) || schedule.length === 0) {
    throw new KineticMechanismError(
      'invalid_input',
      'segments обязан быть непустым массивом сегментов расписания'
    );
  }

  // 2. Полная структурная проверка расписания ДО выполнения любого
  // сегмента: атомарность начинается с валидного расписания.
  // Включая конечность СУММЫ dtSeconds: каждый отдельный dtSeconds
  // конечен, но накопленная сумма может переполнить Number. Времена
  // начала сегментов вычисляются здесь же и переиспользуются в
  // цикле исполнения без пересчёта.
  let scheduledElapsed = 0;
  const startTimes: number[] = [];
  for (let index = 0; index < schedule.length; index += 1) {
    const segment = schedule[index];
    if (segment === null || typeof segment !== 'object') {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ' расписания должен быть объектом KineticCompartmentTrajectorySegmentInput',
        { segmentIndex: index }
      );
    }
    if (
      typeof segment.temperatureK !== 'number' ||
      !Number.isFinite(segment.temperatureK) ||
      segment.temperatureK <= 0
    ) {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ': temperatureK должен быть конечным строго положительным числом, получено: ' + String(segment.temperatureK),
        { segmentIndex: index, field: 'temperatureK', value: String(segment.temperatureK) }
      );
    }
    if (
      typeof segment.dtSeconds !== 'number' ||
      !Number.isFinite(segment.dtSeconds) ||
      segment.dtSeconds <= 0
    ) {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ': dtSeconds должен быть конечным строго положительным числом, получено: ' + String(segment.dtSeconds),
        { segmentIndex: index, field: 'dtSeconds', value: String(segment.dtSeconds) }
      );
    }
    if (!Array.isArray(segment.reactionIds) || segment.reactionIds.length === 0) {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ': reactionIds обязан быть непустым списком идентификаторов реакций',
        { segmentIndex: index, field: 'reactionIds' }
      );
    }
    for (const id of segment.reactionIds) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new KineticMechanismError(
          'invalid_input',
          'сегмент ' + index + ': reactionIds содержит не-строчный или пустой идентификатор',
          { segmentIndex: index, field: 'reactionIds' }
        );
      }
    }
    // Конечность накопленной суммы: переполнение суммы dtSeconds
    // отказывает ДО выполнения любого сегмента; время до сегмента
    // (elapsedSecondsBeforeSegment) конечно по построению, так как
    // все предыдущие суммы уже проверены.
    const nextElapsed = scheduledElapsed + segment.dtSeconds;
    if (!Number.isFinite(nextElapsed)) {
      throw new KineticMechanismError(
        'invalid_input',
        'сегмент ' + index + ': сумма dtSeconds расписания переполняет Number (время до сегмента ' + scheduledElapsed + ' c); ни один сегмент НЕ выполнен',
        {
          segmentIndex: index,
          elapsedSecondsBeforeSegment: scheduledElapsed,
          field: 'dtSeconds'
        }
      );
    }
    startTimes.push(scheduledElapsed);
    scheduledElapsed = nextElapsed;
  }

  // 3. Строгая последовательная передача состояния: конечный
  // инвентарь сегмента — начальный инвентарь следующего. Времена
  // начала/конца берутся из заранее рассчитанных на этапе
  // валидации конечных значений и НЕ пересчитываются в цикле.
  const steps: KineticCompartmentTrajectorySegmentResult[] = [];
  const updatedSpecies: string[] = [];
  let current: Readonly<Record<string, number>> = initial;

  for (let index = 0; index < schedule.length; index += 1) {
    const segment = schedule[index];
    const startTimeSeconds = startTimes[index];
    let step: KineticCompartmentStepResult;
    try {
      step = runKineticCompartmentStep({
        temperatureK: segment.temperatureK,
        dtSeconds: segment.dtSeconds,
        layerThicknessM: input.layerThicknessM,
        reactionIds: [...segment.reactionIds],
        columnInventoriesMolM2: current
      });
    } catch (caught) {
      if (caught instanceof KineticMechanismError) {
        // Атомарный отказ: исходный код и сообщение слоя сохраняются,
        // к ним добавляется диагностика позиции в траектории.
        const details: Record<string, number | string | boolean> = {};
        if (caught.details) {
          for (const [key, value] of Object.entries(caught.details)) {
            details[key] = value;
          }
        }
        details.segmentIndex = index;
        details.elapsedSecondsBeforeSegment = startTimeSeconds;
        throw new KineticMechanismError(
          caught.code,
          'сегмент ' + index + ' (начало t=' + startTimeSeconds + ' c) отказал: ' + caught.message,
          details
        );
      }
      throw caught;
    }
    for (const species of step.concentrationStep.speciesOrder) {
      if (!updatedSpecies.includes(species)) {
        updatedSpecies.push(species);
      }
    }
    steps.push({
      index,
      startTimeSeconds,
      endTimeSeconds: startTimeSeconds + segment.dtSeconds,
      temperatureK: segment.temperatureK,
      dtSeconds: segment.dtSeconds,
      reactionIds: [...segment.reactionIds],
      compartment: step
    });
    current = step.updatedColumnInventoriesMolM2;
  }

  // 4. Результат: предпосылки и ограничения фиксируются явно.
  const warnings: string[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    for (const warning of steps[index].compartment.warnings) {
      warnings.push('[сегмент ' + index + '] ' + warning);
    }
  }
  warnings.push(
    'температура слоя изменяется только ДИСКРЕТНО между сегментами по явному расписанию: непрерывный профиль температуры по времени и по высоте НЕ моделируется'
  );

  return {
    status: 'completed',
    layerThicknessM: input.layerThicknessM,
    segmentCount: steps.length,
    totalTimeSeconds: scheduledElapsed,
    finalInventoriesMolM2: current,
    updatedSpecies,
    segments: steps,
    assumptions: [
      'толщина слоя постоянна на ВСЕЙ траектории и задана явно (общая геометрическая величина, не выводимая из параметров мира)',
      'внутри каждого сегмента слой однороден, хорошо перемешан и изотермичен: температура постоянна на всём сегменте',
      'температура изменяется только между сегментами и только по явному расписанию траектории',
      'состояние передаётся строго последовательно: конечный инвентарь сегмента — начальный инвентарь следующего сегмента',
      'перенос, диффузия, конвекция, осаждение и внешнее пополнение веществ НЕ моделируются',
      'химический состав изменяется только реакциями механизма №89/№106 выбранных сегментов внутри слоя'
    ],
    warnings,
    notes: [
      'stateless API траектории: к GeneratedWorld/ChemicalEvolutionState/runChemicalEvolutionStep НЕ подключён; состояние мира не читается и не пишется; этап 4.5.5 этим срезом НЕ завершён',
      'время траектории — сумма физических dtSeconds сегментов (конечность суммы проверяется ДО выполнения любого сегмента: totalTimeSeconds гарантированно конечен); gameTime/extentFraction/gameSpeedCoefficient НЕ участвуют',
      'отказ любого сегмента — атомарный отказ всей траектории: частично обновлённый инвентарь НЕ возвращается; диагностика содержит segmentIndex и elapsedSecondsBeforeSegment',
      'N₂ — третье тело: запас передан явно в начальном инвентаре, стехиометрически не расходуется и сохраняется на всей траектории',
      'записи №1/№70/№72 остаются unknown (no_kinetic_data) и в механизм не входят; совместный сегмент №89+№106 допустим только при 300 K (пересечение диапазонов применимости, общий диапазон 200–400 K НЕ заявляется)',
      'все величины в фикстурах и результатах — проверка математики адаптера, а НЕ утверждение о составе какой-либо планетарной атмосферы'
    ]
  };
}
