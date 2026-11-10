// ============================================
// kineticTrajectory.test.ts — тесты последовательной кинетической
// траектории одного компартмента (Stage 4.5.5, третий срез)
// ============================================
//
// Проверяется: fail-closed расписание (структура, конечность,
// положительность, реакции, индекс сегмента в диагностике);
// одно- и многосегментные траектории; СТРОГО последовательная
// передача конечного инвентаря сегмента в начальный инвентарь
// следующего; накопление времени и конечность суммы dtSeconds
// расписания; атомарный отказ всей траектории
// с segmentIndex и elapsedSecondsBeforeSegment; неизменность N₂
// на всей траектории; сохранение запасов невыбранных реакций;
// отсутствие мутации входа; диагностика результата (предпосылки,
// предупреждения с префиксом «[сегмент N]», заметки).
//
// ВАЖНО: толщина слоя и все столбовые запасы в фикстурах —
// СИНТЕТИЧЕСКИЕ величины для проверки МАТЕМАТИКИ адаптера; они НЕ
// являются утверждением о параметрах какой-либо планетарной
// атмосферы. Эталон многосегментной траектории строится ручной
// цепочкой независимых вызовов runKineticCompartmentStep.

import { describe, expect, it } from 'vitest';
import { runKineticCompartmentTrajectory } from '../ChemicalEvolution/kineticTrajectory';
import type {
  KineticCompartmentTrajectoryInput,
  KineticCompartmentTrajectoryResult,
  KineticCompartmentTrajectorySegmentInput,
  KineticCompartmentTrajectorySegmentResult,
  KineticTrajectoryInput,
  KineticTrajectoryResult,
  KineticTrajectorySegment,
  KineticTrajectorySegmentSummary
} from '../ChemicalEvolution/kineticTrajectory';
import { runKineticCompartmentStep } from '../ChemicalEvolution/kineticCompartment';
import type { KineticCompartmentStepInput } from '../ChemicalEvolution/kineticCompartment';
import { KineticMechanismError } from '../ChemicalEvolution/kineticMechanism';

const ID89 = 'kida-tb-2015-03-19-89';
const ID106 = 'kida-tb-2015-03-19-106';
const LAYER_M = 100; // синтетическая толщина слоя, м
const DT_FIXTURE_S = 0.1; // физические секунды
const N2_COLUMN_MOL_M2 = 4e3; // синтетика: [N₂] ≈ 2.41e19 molecule/cm³ при L = 100 м
const BASE_INVENTORIES = {
  O: 1e-5,
  NO: 1e-5,
  NO2: 2e-7,
  H: 5e-6,
  O2: 1e-5,
  HO2: 1e-7,
  N2: N2_COLUMN_MOL_M2
};

function segment(
  temperatureK: number,
  dtSeconds: number,
  reactionIds: string[]
): KineticCompartmentTrajectorySegmentInput {
  return { temperatureK, dtSeconds, reactionIds };
}

function trajectoryInput(
  segments: KineticCompartmentTrajectorySegmentInput[],
  initialInventoriesMolM2: Readonly<Record<string, number>> = BASE_INVENTORIES,
  layerThicknessM: number = LAYER_M
): KineticCompartmentTrajectoryInput {
  return { layerThicknessM, initialInventoriesMolM2, segments };
}

function compartmentInput(
  temperatureK: number,
  dtSeconds: number,
  reactionIds: string[],
  columnInventoriesMolM2: Readonly<Record<string, number>>
): KineticCompartmentStepInput {
  return {
    temperatureK,
    dtSeconds,
    layerThicknessM: LAYER_M,
    reactionIds,
    columnInventoriesMolM2
  };
}

/** Вызывает fn, ожидает KineticMechanismError, возвращает пойманную ошибку. */
function mechanismError(fn: () => unknown): KineticMechanismError {
  try {
    fn();
  } catch (caught) {
    if (caught instanceof KineticMechanismError) {
      return caught;
    }
    throw new Error('ожидалась KineticMechanismError, получено: ' + String(caught));
  }
  throw new Error('ожидалась KineticMechanismError, вызов прошёл без ошибки');
}

// --------------------------------------------
// 1. Fail-closed расписание траектории
// --------------------------------------------

describe('fail-closed расписание траектории', () => {
  it('вход не объект, segments не массив или пуст — invalid_input', () => {
    expect(mechanismError(() => runKineticCompartmentTrajectory(null as never)).code).toBe(
      'invalid_input'
    );
    expect(
      mechanismError(() =>
        runKineticCompartmentTrajectory(trajectoryInput([], undefined as never))
      ).code
    ).toBe('invalid_input');
    expect(
      mechanismError(() =>
        runKineticCompartmentTrajectory({
          ...trajectoryInput([segment(250, DT_FIXTURE_S, [ID89])]),
          segments: 'не массив' as never
        })
      ).code
    ).toBe('invalid_input');
  });

  it('layerThicknessM нулевой, отрицательный, NaN, Infinity — invalid_input', () => {
    for (const badL of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = mechanismError(() =>
        runKineticCompartmentTrajectory(
          trajectoryInput([segment(250, DT_FIXTURE_S, [ID89])], BASE_INVENTORIES, badL)
        )
      );
      expect(error.code).toBe('invalid_input');
      expect(error.message).toContain('layerThicknessM');
    }
  });

  it('initialInventoriesMolM2 null или массив — invalid_input', () => {
    expect(
      mechanismError(() =>
        runKineticCompartmentTrajectory(
          trajectoryInput([segment(250, DT_FIXTURE_S, [ID89])], null as never)
        )
      ).code
    ).toBe('invalid_input');
    expect(
      mechanismError(() =>
        runKineticCompartmentTrajectory(
          trajectoryInput([segment(250, DT_FIXTURE_S, [ID89])], [] as never)
        )
      ).code
    ).toBe('invalid_input');
  });

  it('сегмент не объект, без temperatureK, NaN/Infinity/нулевая температура — invalid_input с индексом', () => {
    const notObject = mechanismError(() =>
      runKineticCompartmentTrajectory(
        trajectoryInput([segment(250, DT_FIXTURE_S, [ID89]), null as never])
      )
    );
    expect(notObject.code).toBe('invalid_input');
    expect(notObject.message).toContain('сегмент 1');
    expect((notObject.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(1);

    for (const badT of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      const error = mechanismError(() =>
        runKineticCompartmentTrajectory(trajectoryInput([segment(badT, DT_FIXTURE_S, [ID89])]))
      );
      expect(error.code).toBe('invalid_input');
      expect(error.message).toContain('temperatureK');
    }
  });

  it('dtSeconds нулевой, NaN, Infinity — invalid_input с индексом сегмента', () => {
    for (const badDt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const error = mechanismError(() =>
        runKineticCompartmentTrajectory(
          trajectoryInput([segment(250, DT_FIXTURE_S, [ID89]), segment(300, badDt, [ID106])])
        )
      );
      expect(error.code).toBe('invalid_input');
      expect(error.message).toContain('сегмент 1');
      expect(error.message).toContain('dtSeconds');
      expect((error.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(1);
    }
  });

  it('reactionIds пусто, не массив, не-строка — invalid_input с индексом сегмента', () => {
    const empty = mechanismError(() =>
      runKineticCompartmentTrajectory(trajectoryInput([segment(250, DT_FIXTURE_S, [])]))
    );
    expect(empty.code).toBe('invalid_input');
    expect(empty.message).toContain('сегмент 0');

    const notArray = mechanismError(() =>
      runKineticCompartmentTrajectory(
        trajectoryInput([segment(250, DT_FIXTURE_S, 'не массив' as never)])
      )
    );
    expect(notArray.code).toBe('invalid_input');

    const notString = mechanismError(() =>
      runKineticCompartmentTrajectory(
        trajectoryInput([segment(250, DT_FIXTURE_S, [ID89, 42 as never])])
      )
    );
    expect(notString.code).toBe('invalid_input');
    expect(notString.message).toContain('сегмент 0');
  });

  it('инвентарные правила слоя действуют с индексом сегмента: неизвестный ключ, отсутствующий вид, отсутствующий N₂', () => {
    const unknownKey = mechanismError(() =>
      runKineticCompartmentTrajectory(
        trajectoryInput([segment(250, DT_FIXTURE_S, [ID89])], {
          ...BASE_INVENTORIES,
          CO2: 1e-3
        })
      )
    );
    expect(unknownKey.code).toBe('invalid_input');
    expect((unknownKey.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(0);

    const noN2 = mechanismError(() =>
      runKineticCompartmentTrajectory(trajectoryInput([segment(250, DT_FIXTURE_S, [ID89])], {
        O: 1e-5,
        NO: 1e-5,
        NO2: 2e-7
      }))
    );
    expect(noN2.code).toBe('invalid_input');
    expect((noN2.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(0);
  });

  it('сумма dtSeconds переполняет Number — invalid_input с индексом сегмента переполнения ДО выполнения любого шага', () => {
    // Каждый dtSeconds конечен и строго положителен, но сумма двух
    // Number.MAX_VALUE переполняет double: отказ обязан произойти
    // на этапе валидации расписания, а не позднего вычисления шага.
    const max = Number.MAX_VALUE;
    const input = trajectoryInput([segment(250, max, [ID89]), segment(300, max, [ID89])]);
    const snapshot = JSON.stringify(input);
    const error = mechanismError(() => runKineticCompartmentTrajectory(input));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('сегмент 1');
    expect(error.message).toContain('dtSeconds');
    expect((error.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(1);
    expect(
      (error.details as { elapsedSecondsBeforeSegment?: number } | undefined)
        ?.elapsedSecondsBeforeSegment
    ).toBe(max);
    // Отказ произошёл до выполнения любого сегмента: вход не мутирован.
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

// --------------------------------------------
// 2. Односегментная траектория
// --------------------------------------------

describe('односегментная траектория', () => {
  it('эквивалентна одиночному шагу компартмента', () => {
    const input = trajectoryInput([segment(250, DT_FIXTURE_S, [ID89])]);
    const result = runKineticCompartmentTrajectory(input);
    const manual = runKineticCompartmentStep(
      compartmentInput(250, DT_FIXTURE_S, [ID89], BASE_INVENTORIES)
    );

    expect(result.status).toBe('completed');
    expect(result.segmentCount).toBe(1);
    expect(result.totalTimeSeconds).toBe(DT_FIXTURE_S);
    expect(result.layerThicknessM).toBe(LAYER_M);
    expect(result.segments[0].index).toBe(0);
    expect(result.segments[0].startTimeSeconds).toBe(0);
    expect(result.segments[0].endTimeSeconds).toBe(DT_FIXTURE_S);
    expect(result.segments[0].temperatureK).toBe(250);
    expect(result.segments[0].reactionIds).toEqual([ID89]);
    expect(result.segments[0].compartment).toEqual(manual);
    expect(result.finalInventoriesMolM2).toEqual(manual.updatedColumnInventoriesMolM2);
    expect(result.finalInventoriesMolM2.N2).toBe(N2_COLUMN_MOL_M2);
    expect(result.updatedSpecies).toEqual(['O', 'NO', 'NO2']);
  });

  it('запасы видов невыбранных реакций сохраняются без изменений', () => {
    const result = runKineticCompartmentTrajectory(
      trajectoryInput([segment(250, DT_FIXTURE_S, [ID89])])
    );
    expect(result.finalInventoriesMolM2.H).toBe(5e-6);
    expect(result.finalInventoriesMolM2.O2).toBe(1e-5);
    expect(result.finalInventoriesMolM2.HO2).toBe(1e-7);
    expect(result.updatedSpecies).not.toContain('H');
  });
});

// --------------------------------------------
// 3. Многосегментная траектория: последовательная
//    передача состояния и накопление времени
// --------------------------------------------

describe('многосегментная траектория с последовательной передачей состояния', () => {
  const SEGMENTS: KineticCompartmentTrajectorySegmentInput[] = [
    segment(250, 0.1, [ID89]),
    segment(350, 0.2, [ID106]),
    segment(300, 0.1, [ID89, ID106])
  ];

  it('совпадает с ручной цепочкой независимых шагов компартмента', () => {
    const result = runKineticCompartmentTrajectory(trajectoryInput(SEGMENTS));

    // Эталон: строгая ручная цепочка — конечный инвентарь каждого
    // шага подаётся на вход следующего.
    const step1 = runKineticCompartmentStep(compartmentInput(250, 0.1, [ID89], BASE_INVENTORIES));
    const step2 = runKineticCompartmentStep(
      compartmentInput(350, 0.2, [ID106], step1.updatedColumnInventoriesMolM2)
    );
    const step3 = runKineticCompartmentStep(
      compartmentInput(300, 0.1, [ID89, ID106], step2.updatedColumnInventoriesMolM2)
    );

    expect(result.segmentCount).toBe(3);
    expect(result.segments[0].compartment).toEqual(step1);
    expect(result.segments[1].compartment).toEqual(step2);
    expect(result.segments[2].compartment).toEqual(step3);
    expect(result.finalInventoriesMolM2).toEqual(step3.updatedColumnInventoriesMolM2);
  });

  it('время накапливается: totalTimeSeconds — сумма dtSeconds, времена начала/конца последовательны', () => {
    const result = runKineticCompartmentTrajectory(trajectoryInput(SEGMENTS));
    expect(result.totalTimeSeconds).toBeCloseTo(0.4, 12);
    // totalTimeSeconds гарантированно конечен: конечность суммы
    // проверяется валидацией расписания заранее.
    expect(Number.isFinite(result.totalTimeSeconds)).toBe(true);
    expect(result.segments[0].startTimeSeconds).toBe(0);
    expect(result.segments[0].endTimeSeconds).toBeCloseTo(0.1, 12);
    expect(result.segments[1].startTimeSeconds).toBeCloseTo(0.1, 12);
    expect(result.segments[1].endTimeSeconds).toBeCloseTo(0.3, 12);
    expect(result.segments[2].startTimeSeconds).toBeCloseTo(0.3, 12);
    expect(result.segments[2].endTimeSeconds).toBeCloseTo(0.4, 12);

    const uneven = runKineticCompartmentTrajectory(
      trajectoryInput([segment(250, 0.25, [ID89]), segment(350, 1.75, [ID106])])
    );
    expect(uneven.totalTimeSeconds).toBe(2);
  });

  it('обновляемые виды собираются в порядке первого появления по сегментам', () => {
    const result = runKineticCompartmentTrajectory(trajectoryInput(SEGMENTS));
    expect(result.updatedSpecies).toEqual(['O', 'NO', 'NO2', 'H', 'O2', 'HO2']);
  });

  it('состояние передаётся строго последовательно: второй сегмент стартует с итога первого, а не с начального инвентаря', () => {
    // Два сегмента №89: первый меняет O/NO/NO2, поэтому второй сегмент
    // обязан стартовать с ИЗМЕНЁННЫМ инвентарём, а не с BASE_INVENTORIES.
    const two = runKineticCompartmentTrajectory(
      trajectoryInput([segment(250, 0.1, [ID89]), segment(300, 0.1, [ID89])])
    );
    const manualFirst = runKineticCompartmentStep(
      compartmentInput(250, 0.1, [ID89], BASE_INVENTORIES)
    );
    const manualSecond = runKineticCompartmentStep(
      compartmentInput(300, 0.1, [ID89], manualFirst.updatedColumnInventoriesMolM2)
    );
    expect(two.segments[1].compartment).toEqual(manualSecond);

    // Контроль-эталон: свежий шаг №89 при 300 K прямо из начального
    // инвентаря обязан ОТЛИЧАТЬСЯ от второго сегмента траектории.
    const freshSecond = runKineticCompartmentStep(
      compartmentInput(300, 0.1, [ID89], BASE_INVENTORIES)
    );
    expect(two.segments[1].compartment.concentrationStep.concentrations).not.toEqual(
      freshSecond.concentrationStep.concentrations
    );
  });
});

// --------------------------------------------
// 4. Атомарный отказ траектории
// --------------------------------------------

describe('атомарный отказ всей траектории', () => {
  it('отказ сегмента 1: код сохранён, segmentIndex и elapsedSecondsBeforeSegment в диагностике', () => {
    const input = trajectoryInput([
      segment(250, 0.1, [ID89]),
      segment(400, 0.1, [ID89]), // №89 неприменима при 400 K
      segment(350, 0.1, [ID106])
    ]);
    const snapshot = JSON.stringify(input);
    const error = mechanismError(() => runKineticCompartmentTrajectory(input));

    expect(error.code).toBe('temperature_out_of_range');
    expect(error.message).toContain('сегмент 1');
    expect((error.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(1);
    expect(
      (error.details as { elapsedSecondsBeforeSegment?: number } | undefined)
        ?.elapsedSecondsBeforeSegment
    ).toBe(0.1);
    // Вход не мутирован отказом.
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('отказ сегмента 0: elapsedSecondsBeforeSegment = 0', () => {
    const error = mechanismError(() =>
      runKineticCompartmentTrajectory(trajectoryInput([segment(250, 0.1, [ID106])]))
    );
    expect(error.code).toBe('temperature_out_of_range');
    expect((error.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(0);
    expect(
      (error.details as { elapsedSecondsBeforeSegment?: number } | undefined)
        ?.elapsedSecondsBeforeSegment
    ).toBe(0);
  });

  it('отсутствующий вид для позднего сегмента — invalid_input с индексом этого сегмента', () => {
    const noH: Record<string, number> = { ...BASE_INVENTORIES };
    delete noH['H'];
    const error = mechanismError(() =>
      runKineticCompartmentTrajectory(trajectoryInput([segment(250, 0.1, [ID89]), segment(350, 0.1, [ID106])], noH))
    );
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('сегмент 1');
    expect((error.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(1);
  });

  it('совместный сегмент №89+№106 вне 300 K отказывает как в одиночном шаге', () => {
    const cold = mechanismError(() =>
      runKineticCompartmentTrajectory(trajectoryInput([segment(250, 0.1, [ID89, ID106])]))
    );
    expect(cold.code).toBe('temperature_out_of_range');
    expect((cold.details as { segmentIndex?: number } | undefined)?.segmentIndex).toBe(0);
  });

  it('stateless: после отказа валидная траектория выполняется полностью', () => {
    const failing = trajectoryInput([segment(250, 0.1, [ID89]), segment(400, 0.1, [ID89])]);
    expect(mechanismError(() => runKineticCompartmentTrajectory(failing)).code).toBe(
      'temperature_out_of_range'
    );
    const valid = runKineticCompartmentTrajectory(
      trajectoryInput([segment(250, 0.1, [ID89]), segment(300, 0.1, [ID89, ID106])])
    );
    expect(valid.status).toBe('completed');
    expect(valid.segmentCount).toBe(2);
  });
});

// --------------------------------------------
// 5. N₂ и иммутабельность входа
// --------------------------------------------

describe('N₂ и иммутабельность входа траектории', () => {
  const SEGMENTS: KineticCompartmentTrajectorySegmentInput[] = [
    segment(250, 0.1, [ID89]),
    segment(350, 0.2, [ID106]),
    segment(300, 0.1, [ID89, ID106])
  ];

  it('N₂ не расходуется ни в одном сегменте и в итоге траектории', () => {
    const result = runKineticCompartmentTrajectory(trajectoryInput(SEGMENTS));
    for (const summary of result.segments) {
      expect(summary.compartment.updatedColumnInventoriesMolM2.N2).toBe(N2_COLUMN_MOL_M2);
      expect(summary.compartment.thirdBody.consumedMolM2).toBe(0);
    }
    expect(result.finalInventoriesMolM2.N2).toBe(N2_COLUMN_MOL_M2);
  });

  it('вход не мутируется; итоговый инвентарь — новый объект; reactionIds сегментов скопированы', () => {
    const input = trajectoryInput(SEGMENTS);
    const snapshot = JSON.stringify(input);
    const result = runKineticCompartmentTrajectory(input);

    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.finalInventoriesMolM2).not.toBe(input.initialInventoriesMolM2);
    expect(result.segments[0].reactionIds).not.toBe(input.segments[0].reactionIds);
    expect(result.segments[0].reactionIds).toEqual(input.segments[0].reactionIds);
  });
});

// --------------------------------------------
// 6. Диагностика результата траектории
// --------------------------------------------

describe('диагностика результата траектории', () => {
  it('предпосылки фиксируют общую постоянную толщину и дискретное расписание температуры', () => {
    const result = runKineticCompartmentTrajectory(
      trajectoryInput([segment(250, 0.1, [ID89]), segment(350, 0.1, [ID106])])
    );
    expect(result.assumptions.some((a) => a.includes('постоянна'))).toBe(true);
    expect(result.assumptions.some((a) => a.includes('расписанию'))).toBe(true);
    expect(result.assumptions.some((a) => a.includes('строго последовательно'))).toBe(true);
  });

  it('предупреждения сегментов агрегированы с префиксом «[сегмент N]»', () => {
    const result = runKineticCompartmentTrajectory(
      trajectoryInput([segment(250, 0.1, [ID89]), segment(350, 0.1, [ID106])])
    );
    expect(result.warnings.some((w) => w.includes('[сегмент 0]'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('[сегмент 1]'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('IUPAC'))).toBe(true);
    expect(result.warnings.every((w) => w.includes('[сегмент ') || w.includes('расписанию'))).toBe(
      true
    );
  });

  it('заметки фиксируют отсутствие подключения к миру, сумму физических dt и атомарность', () => {
    const result = runKineticCompartmentTrajectory(
      trajectoryInput([segment(250, 0.1, [ID89])])
    );
    expect(result.notes.some((n) => n.includes('НЕ подключён'))).toBe(true);
    expect(result.notes.some((n) => n.includes('dtSeconds'))).toBe(true);
    expect(result.notes.some((n) => n.includes('segmentIndex'))).toBe(true);
  });
});

// --------------------------------------------
// 7. Совместимость имён публичных типов
// --------------------------------------------

describe('совместимость имён публичных типов траектории', () => {
  it('новый контракт задания и прежние имена (третий срез) ссылаются на один публичный контракт', () => {
    // Оба набора имён импортируемы и взаимно совместимы по
    // присваиванию (проверяется компилятором TypeScript в CI):
    // прежние имена — экспортируемые алиасы нового контракта.
    const legacySegment: KineticTrajectorySegment = segment(250, DT_FIXTURE_S, [ID89]);
    const freshSegment: KineticCompartmentTrajectorySegmentInput = legacySegment;
    const legacyInput: KineticTrajectoryInput = trajectoryInput([legacySegment]);
    const freshInput: KineticCompartmentTrajectoryInput = legacyInput;

    expect(freshSegment.reactionIds).toEqual(freshInput.segments[0].reactionIds);

    const result: KineticCompartmentTrajectoryResult = runKineticCompartmentTrajectory(freshInput);
    const legacyResult: KineticTrajectoryResult = result;
    expect(legacyResult.status).toBe('completed');

    const legacySummaryKey: keyof KineticTrajectorySegmentSummary = 'startTimeSeconds';
    const freshSummaryKey: keyof KineticCompartmentTrajectorySegmentResult = 'startTimeSeconds';
    expect(result.segments[0][legacySummaryKey]).toBe(0);
    expect(result.segments[0][freshSummaryKey]).toBe(0);
  });
});
