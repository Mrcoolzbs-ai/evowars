// ============================================
// ТЕСТЫ — Обнаружение сближений и столкновений (Stage 4.6.1-B)
// ============================================
//
// Событийный слой поверх общего KDK-движка: обнаружение ВНУТРИ
// drift-отрезка каждого шага (не по snapshot'ам и не только по концам
// шага). Все сценарии детерминированы; эталонные числа в допусках —
// измеренные, не желаемые.
//
// Принципы: столкновение — терминальное событие (без слияния/отскока);
// radiusM null — неизвестный радиус, а не нулевой; отсутствие
// зарегистрированного столкновения у пар с неизвестным радиусом НЕ
// является доказательством безопасности; completed ≠ устойчивость.

import { describe, it, expect } from 'vitest';
import {
  integrateNBodyLeapfrog,
  integrateNBodyWithEvents,
  type NBodyInitialState,
  type OrbitalBodyState,
  type Vector3
} from '../OrbitalMechanics/dynamics';
import type {
  CloseApproachEvent,
  NBodyDetectionEvent,
  NBodyEventIntegrationResult
} from '../OrbitalMechanics/events';
import { G } from '../Units/index';

const M_SUN = 1.989e30;
const M_EARTH = 5.9722e24;
const AU = 1.495978707e11;
const MU = G * (M_SUN + M_EARTH);
const P_EARTH = 2 * Math.PI * Math.sqrt((AU * AU * AU) / MU);

function body(
  id: string,
  massKg: number,
  radiusM: number | null,
  positionM: Vector3,
  velocityMPerS: Vector3
): OrbitalBodyState {
  return { id, massKg, radiusM, positionM, velocityMPerS };
}

function closeApproaches(events: readonly NBodyDetectionEvent[]): CloseApproachEvent[] {
  return events.filter((e): e is CloseApproachEvent => e.type === 'close_approach');
}

function collisions(events: readonly NBodyDetectionEvent[]): NBodyDetectionEvent[] {
  return events.filter((e) => e.type === 'collision');
}

function requireCompleted(result: NBodyEventIntegrationResult) {
  if (result.status !== 'completed') {
    throw new Error(`ожидался статус completed, получен ${result.status}`);
  }
  return result;
}

function requireCollision(result: NBodyEventIntegrationResult) {
  if (result.status !== 'collision_detected') {
    throw new Error(`ожидался статус collision_detected, получен ${result.status}`);
  }
  return result;
}

function requireFailed(result: NBodyEventIntegrationResult) {
  if (result.status !== 'integration_failed') {
    throw new Error(`ожидался статус integration_failed, получен ${result.status}`);
  }
  return result;
}

// --- Сценарий fly-through: пара проходит порог ВНУТРИ одного шага ---
// Относительный отрезок шага: r0 = (−1.5e10, −1e8), d = (2.2e10, 0);
// концы отрезка |r0| ≈ 1.5e10 и |r1| ≈ 7.0e9 — вне порога 5e9, минимум
// на отрезке ≈ 1e8 — внутри порога (fly-through, оба конца мимо).
function flyThrough(radiusA: number | null = null, radiusB: number | null = null): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('a', 1e20, radiusA, { x: -7.5e9, y: -5e7, z: 0 }, { x: 1.1e4, y: 0, z: 0 }),
      body('b', 1e20, radiusB, { x: 7.5e9, y: 5e7, z: 0 }, { x: -1.1e4, y: 0, z: 0 })
    ]
  };
}

// --- Сценарий near miss: минимум ≈ 2e9 (порог 5e9, радиусы 3e8+3e8) ---
function nearMiss(radiusM: number | null = 3e8): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('a', 1e20, radiusM, { x: -7.5e9, y: -1e9, z: 0 }, { x: 1.1e4, y: 0, z: 0 }),
      body('b', 1e20, radiusM, { x: 7.5e9, y: 1e9, z: 0 }, { x: -1.1e4, y: 0, z: 0 })
    ]
  };
}

// --- Сценарий collision: лобовой контакт в первом шаге ---
// R_contact = 1e9; отрезок r0 = (−1e10, 0), d = (1.2e10, 0) пересекает
// контактную сферу при s ≈ 0.75, время контакта ≈ 7.5e5 с.
function collisionCourse(): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('a', 1e23, 5e8, { x: -5e9, y: 0, z: 0 }, { x: 6e3, y: 0, z: 0 }),
      body('b', 1e23, 5e8, { x: 5e9, y: 0, z: 0 }, { x: -6e3, y: 0, z: 0 })
    ]
  };
}

// --- Эксцентричная пара (a = 2e11, e = 0.5): перицентр 1e11, апоцентр
// 3e11; порог 1.5e11 пересекается дважды за ~1.7 периода ---
const ECC_A = 2e11;
const ECC_E = 0.5;
const ECC_M = 5e29;
const ECC_GM = G * (2 * ECC_M);
const ECC_P = 2 * Math.PI * Math.sqrt((ECC_A * ECC_A * ECC_A) / ECC_GM);
const ECC_QA = ECC_A * (1 + ECC_E);
const ECC_VAPO = Math.sqrt((ECC_GM * (1 - ECC_E)) / (ECC_A * (1 + ECC_E)));
function eccentricPair(): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('a', ECC_M, null, { x: -ECC_QA / 2, y: 0, z: 0 }, { x: 0, y: -ECC_VAPO / 2, z: 0 }),
      body('b', ECC_M, null, { x: ECC_QA / 2, y: 0, z: 0 }, { x: 0, y: ECC_VAPO / 2, z: 0 })
    ]
  };
}

// --- Три тела: две пары пересекают порог в одном шаге ---
function multiPair(): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('a', 1e15, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      body('b', 1e15, null, { x: -6e9, y: 1e8, z: 0 }, { x: 1.1e4, y: 0, z: 0 }),
      body('c', 1e15, null, { x: 6e9, y: -1e8, z: 0 }, { x: -1.1e4, y: 0, z: 0 })
    ]
  };
}

// --- Эллипс e=0.5 Солнце–Земля (baseline без событий) ---
function ellipse(): NBodyInitialState {
  const e = 0.5;
  const rp = AU * (1 - e);
  const vp = Math.sqrt((MU * (1 + e)) / (AU * (1 - e)));
  return {
    timeS: 0,
    bodies: [
      body('a', M_SUN, null, { x: -rp * (M_EARTH / (M_SUN + M_EARTH)), y: 0, z: 0 }, { x: 0, y: (-vp * M_EARTH) / (M_SUN + M_EARTH), z: 0 }),
      body('b', M_EARTH, null, { x: rp * (M_SUN / (M_SUN + M_EARTH)), y: 0, z: 0 }, { x: 0, y: (vp * M_SUN) / (M_SUN + M_EARTH), z: 0 })
    ]
  };
}

// ============================================
// 1. Fly-through внутри одного drift-шага
// ============================================
describe('fly-through: порог пересекается внутри одного шага', () => {
  const result = requireCompleted(
    integrateNBodyWithEvents(flyThrough(), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 5e9
    })
  );

  it('эпизод обнаружен, хотя оба конца шага вне порога', () => {
    expect(result.detection.closeApproachDetectionEnabled).toBe(true);
    const approaches = closeApproaches(result.events);
    expect(approaches).toHaveLength(1);
    const ev = approaches[0];
    expect([ev.pairIdA, ev.pairIdB]).toEqual(['a', 'b']);
    expect(ev.thresholdM).toBe(5e9);
    expect(ev.ongoingAtHorizon).toBe(false);
    expect(ev.exitTimeS).not.toBeNull();
  });

  it('вход, минимум и выход — разные времена внутри одного шага', () => {
    const ev = closeApproaches(result.events)[0];
    expect(ev.entryTimeS).toBeGreaterThan(0);
    expect(ev.entryTimeS).toBeLessThan(ev.minimumTimeS);
    expect(ev.minimumTimeS).toBeLessThan(ev.exitTimeS as number);
    expect(ev.exitTimeS as number).toBeLessThan(1e6);
  });

  it('минимум дистанции на отрезке измерен корректно', () => {
    const ev = closeApproaches(result.events)[0];
    // геометрический минимум смещения — 1e8 м (гравитация пренебрежима)
    expect(ev.minimumDistanceM).toBeGreaterThan(5e7);
    expect(ev.minimumDistanceM).toBeLessThan(2e8);
  });
});

// ============================================
// 2. Граница порога сближения: до / на / после
// ============================================
describe('граница порога сближения (dmin против порога)', () => {
  // Измеренный минимум прогоном с заведомо большим порогом.
  const probe = requireCompleted(
    integrateNBodyWithEvents(nearMiss(null), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 1e10
    })
  );
  const D = closeApproaches(probe.events)[0].minimumDistanceM;

  it('порог чуть меньше минимума: события нет', () => {
    const below = integrateNBodyWithEvents(nearMiss(null), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: D * (1 - 1e-9)
    });
    expect(below.status).toBe('completed');
    if (below.status !== 'completed') return;
    expect(closeApproaches(below.events)).toHaveLength(0);
  });

  it('порог равен минимуму: событие есть (внутри означает dmin <= порог)', () => {
    const exact = integrateNBodyWithEvents(nearMiss(null), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: D
    });
    expect(exact.status).toBe('completed');
    if (exact.status !== 'completed') return;
    const approaches = closeApproaches(exact.events);
    expect(approaches).toHaveLength(1);
    expect(approaches[0].minimumDistanceM).toBe(D);
    expect(approaches[0].thresholdM).toBe(D);
  });

  it('порог чуть больше минимума: событие есть', () => {
    const above = integrateNBodyWithEvents(nearMiss(null), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: D * (1 + 1e-9)
    });
    expect(above.status).toBe('completed');
    if (above.status !== 'completed') return;
    expect(closeApproaches(above.events)).toHaveLength(1);
  });
});

// ============================================
// 3. Физическое столкновение: терминальный результат
// ============================================
describe('физическое столкновение (терминальное)', () => {
  const result = integrateNBodyWithEvents(collisionCourse(), {
    timeStepS: 1e6,
    durationS: 2e6,
    closeApproachDistanceM: 5e9
  });

  it('статус collision_detected, пара и сумма радиусов корректны', () => {
    expect(result.status).toBe('collision_detected');
    const run = requireCollision(result);
    expect([run.pairIdA, run.pairIdB]).toEqual(['a', 'b']);
    const collisionEvents = collisions(run.events);
    expect(collisionEvents).toHaveLength(1);
    const ev = run.events.find((e) => e.type === 'collision');
    if (!ev || ev.type !== 'collision') throw new Error('нет события столкновения');
    expect(ev.contactRadiusM).toBe(1e9);
    expect(ev.pairIdA).toBe('a');
    expect(ev.pairIdB).toBe('b');
  });

  it('оценка первого контакта: s ≈ 0.75, t ≈ 7.5e5 с (измерено)', () => {
    const run = requireCollision(result);
    expect(run.contactStepFraction).toBeGreaterThan(0.7);
    expect(run.contactStepFraction).toBeLessThan(0.8);
    expect(Math.abs(run.contactTimeS - 7.5e5)).toBeLessThan(60);
    const ev = run.events.find((e) => e.type === 'collision');
    if (!ev || ev.type !== 'collision') throw new Error('нет события столкновения');
    expect(ev.minimumDistanceM).toBeLessThan(1e-3);
  });

  it('последнее завершённое состояние — начало контактного шага, не интерполяция', () => {
    const run = requireCollision(result);
    expect(run.lastCompletedState.timeS).toBe(0);
    const a = run.lastCompletedState.bodies.find((b) => b.id === 'a');
    if (!a) throw new Error('тело a не найдено');
    expect(a.positionM.x).toBe(-5e9);
    expect(a.velocityMPerS.x).toBe(6e3);
    expect(run.snapshots).toHaveLength(1);
  });
});

// ============================================
// 4. Сходимость оценки времени контакта по timestep
// ============================================
// Опорное значение — прогон с мелким шагом (dt = 1e3 с, 1200 шагов):
// t_ref ≈ 749989.17 с. Гравитация слегка ускоряет сближение, поэтому
// точное время контакта на ~11 с меньше линейной оценки 7.5e5 с.
// Измеренные ошибки относительно t_ref: dt=1.2e6 → 5.83 с, 6e5 → 4.44 с,
// 3e5 → 0.47 с, 3e4 → 0.081 с (порядок близок ко второму).
describe('сходимость времени контакта с уточнением шага', () => {
  const refRun = integrateNBodyWithEvents(collisionCourse(), {
    timeStepS: 1e3,
    durationS: 1.2e6,
    closeApproachDistanceM: 5e9
  });
  if (refRun.status !== 'collision_detected') {
    throw new Error('опорный прогон не достиг столкновения');
  }
  const tRef = refRun.contactTimeS;
  const errors: number[] = [];
  const cases: [number, number][] = [
    [1.2e6, 10],
    [6e5, 6],
    [3e5, 2],
    [3e4, 0.2]
  ];
  for (const [dt, bound] of cases) {
    const run = integrateNBodyWithEvents(collisionCourse(), {
      timeStepS: dt,
      durationS: 1.2e6,
      closeApproachDistanceM: 5e9
    });
    it(`dt = ${dt}: ошибка оценки времени контакта < ${bound} с`, () => {
      expect(run.status).toBe('collision_detected');
      const runCollision = requireCollision(run);
      const err = Math.abs(runCollision.contactTimeS - tRef);
      errors.push(err);
      expect(err).toBeLessThan(bound);
      // линейная оценка 7.5e5 с отличается от точной на ~11 с (гравитация)
      expect(Math.abs(runCollision.contactTimeS - 7.5e5)).toBeLessThan(15);
    });
  }
  it('ошибка падает при уточнении шага (dt=3e4 минимум в 10 раз точнее dt=1.2e6)', () => {
    expect(errors.length).toBe(4);
    expect(errors[3]).toBeLessThan(errors[0] / 10);
  });
});

// ============================================
// 5. Граница контакта: R_contact против dmin (до / на / после)
// ============================================
describe('граница контакта (dmin против суммы радиусов)', () => {
  const probe = requireCompleted(
    integrateNBodyWithEvents(nearMiss(null), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 1e10
    })
  );
  const D = closeApproaches(probe.events)[0].minimumDistanceM;

  it('R_contact чуть меньше dmin: near miss, без столкновения', () => {
    const r = (D / 2) * (1 - 1e-9);
    const run = integrateNBodyWithEvents(nearMiss(r), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 1e10
    });
    expect(run.status).toBe('completed');
    if (run.status !== 'completed') return;
    expect(collisions(run.events)).toHaveLength(0);
    expect(closeApproaches(run.events)).toHaveLength(1);
  });

  it('R_contact равен dmin: касание — столкновение', () => {
    const run = integrateNBodyWithEvents(nearMiss(D / 2), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 1e10
    });
    expect(run.status).toBe('collision_detected');
    const runCollision = requireCollision(run);
    expect(runCollision.events.find((e) => e.type === 'collision')?.contactRadiusM).toBe(D);
  });

  it('R_contact чуть больше dmin: столкновение', () => {
    const r = (D / 2) * (1 + 1e-9);
    const run = integrateNBodyWithEvents(nearMiss(r), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 1e10
    });
    expect(run.status).toBe('collision_detected');
  });
});

// ============================================
// 6. Near miss: сближение без столкновения
// ============================================
describe('near miss: минимум внутри порога, но больше суммы радиусов', () => {
  const result = requireCompleted(
    integrateNBodyWithEvents(nearMiss(3e8), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 5e9
    })
  );

  it('зарегистрировано сближение, столкновения нет', () => {
    expect(collisions(result.events)).toHaveLength(0);
    const approaches = closeApproaches(result.events);
    expect(approaches).toHaveLength(1);
    const ev = approaches[0];
    expect(ev.minimumDistanceM).toBeGreaterThan(1.5e9);
    expect(ev.minimumDistanceM).toBeLessThan(2.5e9);
    expect(ev.minimumDistanceM).toBeGreaterThan(6e8);
  });
});

// ============================================
// 7. Начало интегрирования уже внутри порога
// ============================================
describe('старт внутри порога сближения', () => {
  const startInside = (): NBodyInitialState => ({
    timeS: 0,
    bodies: [
      body('a', 1e20, null, { x: -1.5e9, y: 0, z: 0 }, { x: -200, y: 0, z: 0 }),
      body('b', 1e20, null, { x: 1.5e9, y: 0, z: 0 }, { x: 200, y: 0, z: 0 })
    ]
  });
  const result = requireCompleted(
    integrateNBodyWithEvents(startInside(), {
      timeStepS: 1e5,
      durationS: 1.5e7,
      closeApproachDistanceM: 5e9
    })
  );

  it('эпизод открыт в t0 и закрыт при выходе из порога', () => {
    const approaches = closeApproaches(result.events);
    expect(approaches).toHaveLength(1);
    const ev = approaches[0];
    expect(ev.entryTimeS).toBe(0);
    expect(ev.minimumTimeS).toBe(0);
    expect(ev.minimumDistanceM).toBe(3e9);
    expect(ev.exitTimeS).not.toBeNull();
    expect(Math.abs((ev.exitTimeS as number) - 5e6)).toBeLessThan(1);
    expect(ev.ongoingAtHorizon).toBe(false);
  });
});

// ============================================
// 8. Два раздельных эпизода одной пары
// ============================================
describe('повторные сближения — отдельные события', () => {
  const result = requireCompleted(
    integrateNBodyWithEvents(eccentricPair(), {
      timeStepS: ECC_P / 4000,
      durationS: 1.7 * ECC_P,
      closeApproachDistanceM: 1.5e11
    })
  );

  it('два отдельных эпизода, не слитые в один', () => {
    const approaches = closeApproaches(result.events);
    expect(approaches).toHaveLength(2);
    for (const ev of approaches) {
      expect([ev.pairIdA, ev.pairIdB]).toEqual(['a', 'b']);
      expect(ev.ongoingAtHorizon).toBe(false);
      expect(ev.exitTimeS).not.toBeNull();
      expect(ev.minimumDistanceM).toBeGreaterThan(0.9e11);
      expect(ev.minimumDistanceM).toBeLessThan(1.2e11);
    }
    expect(approaches[1].entryTimeS).toBeGreaterThan(approaches[0].exitTimeS as number);
  });

  it('времена входа соответствуют кеплеровскому прогнозу (±1%)', () => {
    const approaches = closeApproaches(result.events);
    // Вход в r = 1.5e11 = a(1 − e·cosE): cosE = 0.5, E = ±π/3,
    // M = E − e·sinE = ±0.6142 рад → t/P = 0.5 ∓ 0.0977
    expect(Math.abs(approaches[0].entryTimeS / ECC_P - 0.4023)).toBeLessThan(0.01);
    expect(Math.abs(approaches[1].entryTimeS / ECC_P - 1.4023)).toBeLessThan(0.01);
  });
});

// ============================================
// 9. Эпизод, открытый на конце горизонта
// ============================================
describe('незавершённый эпизод на конце горизонта', () => {
  const result = requireCompleted(
    integrateNBodyWithEvents(eccentricPair(), {
      timeStepS: ECC_P / 4000,
      durationS: 0.5 * ECC_P,
      closeApproachDistanceM: 1.5e11
    })
  );

  it('exitTimeS = null и явный признак незавершённости', () => {
    const approaches = closeApproaches(result.events);
    expect(approaches).toHaveLength(1);
    const ev = approaches[0];
    expect(ev.exitTimeS).toBeNull();
    expect(ev.ongoingAtHorizon).toBe(true);
    expect(ev.entryTimeS).toBeLessThan(ev.minimumTimeS);
    expect(ev.minimumDistanceM).toBeGreaterThan(0.9e11);
    expect(ev.minimumDistanceM).toBeLessThan(1.2e11);
  });
});

// ============================================
// 10. Неизвестный радиус: покрытие без выдумки
// ============================================
describe('неизвестный радиус не является нулевым', () => {
  const result = requireCompleted(
    integrateNBodyWithEvents(flyThrough(5e8, null), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 5e9
    })
  );

  it('пара в счётчике неизвестных радиусов, столкновение не ищется', () => {
    expect(result.detection.pairsCheckedTotal).toBe(1);
    expect(result.detection.pairsWithBothRadiiKnown).toBe(0);
    expect(result.detection.pairsWithUnknownRadius).toBe(1);
    expect(result.detection.collisionDetectionPossible).toBe(false);
    expect(collisions(result.events)).toHaveLength(0);
  });

  it('отсутствие collision-события не выдаётся за безопасность: сближение зафиксировано', () => {
    const approaches = closeApproaches(result.events);
    expect(approaches).toHaveLength(1);
    expect(approaches[0].minimumDistanceM).toBeLessThan(5e9);
  });
});

// ============================================
// 11. Столкновение при редких snapshot'ах
// ============================================
describe('обнаружение не зависит от частоты снимков', () => {
  const result = integrateNBodyWithEvents(collisionCourse(), {
    timeStepS: 1e6,
    durationS: 2e6,
    sampleEverySteps: 999999,
    closeApproachDistanceM: 5e9
  });

  it('collision_detected при одном снимке', () => {
    expect(result.status).toBe('collision_detected');
    const run = requireCollision(result);
    expect(run.snapshots).toHaveLength(1);
    expect(run.detection.stepsWithEventDetection).toBe(1);
    expect(Math.abs(run.contactTimeS - 7.5e5)).toBeLessThan(60);
  });
});

// ============================================
// 12. Сингулярность внутри шага (концы шага вне порога)
// ============================================
describe('пересечение порога сингулярности внутри шага', () => {
  const singularInsideStep = (): NBodyInitialState => ({
    timeS: 0,
    bodies: [
      body('a', 1e10, null, { x: -5e3, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }),
      body('b', 1e10, null, { x: 5e3, y: 0, z: 0 }, { x: -0.5, y: 0, z: 0 })
    ]
  });
  const options = { timeStepS: 1e4, durationS: 1e4, closeApproachDistanceM: 5e3 };

  it('событийный слой останавливает прогон на опасном отрезке', () => {
    const result = integrateNBodyWithEvents(singularInsideStep(), options);
    expect(result.status).toBe('integration_failed');
    const failed = requireFailed(result);
    expect(failed.failure.status).toBe('singular_configuration');
    if (failed.failure.status !== 'singular_configuration') return;
    expect([failed.failure.pairIdA, failed.failure.pairIdB]).toEqual(['a', 'b']);
    expect(failed.failure.distanceM).toBeLessThan(1e-6);
    expect(failed.failure.thresholdM).toBe(1e-6);
    expect(failed.failure.stepsCompleted).toBe(0);
    // оценка времени пересечения: s* ≈ 0.99993 → t ≈ 9999.3 с
    expect(failed.failure.timeS).toBeGreaterThan(9000);
    expect(failed.failure.timeS).toBeLessThan(1e4);
  });

  it('обычный интегратор по концам шага это пропуск: он завершает прогон', () => {
    const plain = integrateNBodyLeapfrog(singularInsideStep(), {
      timeStepS: 1e4,
      durationS: 1e4
    });
    // Проверка Stage 4.6.1-A смотрит только границы шагов: тела
    // пролетают сквозь сингулярность между концами шагов.
    expect(plain.status).toBe('completed');
  });
});

// ============================================
// 13. Перестановка тел не меняет события
// ============================================
describe('независимость от порядка входа', () => {
  it('обратный порядок тел даёт идентичные события и метаданные', () => {
    const direct = integrateNBodyWithEvents(nearMiss(3e8), {
      timeStepS: 1e6,
      durationS: 1e6,
      sampleEverySteps: 10,
      closeApproachDistanceM: 5e9
    });
    const reversed = integrateNBodyWithEvents(
      { timeS: 0, bodies: [...nearMiss(3e8).bodies].reverse() },
      { timeStepS: 1e6, durationS: 1e6, sampleEverySteps: 10, closeApproachDistanceM: 5e9 }
    );
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(direct));
    expect(direct.status).toBe('completed');
  });
});

// ============================================
// 14. Несколько пар в одном шаге: детерминированный порядок
// ============================================
describe('детерминированный порядок событий нескольких пар', () => {
  const result = requireCompleted(
    integrateNBodyWithEvents(multiPair(), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 5e9
    })
  );

  it('три эпизода упорядочены по времени, типу и каноническим ID', () => {
    const approaches = closeApproaches(result.events);
    expect(approaches).toHaveLength(3);
    const order = approaches.map((e) => `${e.pairIdA}-${e.pairIdB}`);
    expect(order).toEqual(['a-b', 'a-c', 'b-c']);
    for (const ev of approaches) {
      expect(ev.entryTimeS).toBeLessThan(ev.minimumTimeS);
      expect(ev.minimumTimeS).toBeLessThan(ev.exitTimeS as number);
    }
  });
});

// ============================================
// 15. Отказы сохраняют дискриминацию
// ============================================
describe('отказы интегратора не маскируются событиями', () => {
  it('invalid_input: отрицательный порог сближения', () => {
    const result = integrateNBodyWithEvents(nearMiss(3e8), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: -1
    });
    expect(result.status).toBe('integration_failed');
    const failed = requireFailed(result);
    expect(failed.failure.status).toBe('invalid_input');
    if (failed.failure.status !== 'invalid_input') return;
    expect(failed.failure.issues.map((i) => i.code)).toContain('invalid_close_approach_distance');
    expect(failed.events).toHaveLength(0);
  });

  it('invalid_input: нулевой порог сближения', () => {
    const result = integrateNBodyWithEvents(nearMiss(3e8), {
      timeStepS: 1e6,
      durationS: 1e6,
      closeApproachDistanceM: 0
    });
    expect(result.status).toBe('integration_failed');
    const failed = requireFailed(result);
    expect(failed.failure.status).toBe('invalid_input');
  });

  it('step_limit_exceeded сохраняет свои поля', () => {
    const result = integrateNBodyWithEvents(nearMiss(3e8), {
      timeStepS: 1e5,
      durationS: 1e7,
      maxSteps: 50,
      closeApproachDistanceM: 5e9
    });
    expect(result.status).toBe('integration_failed');
    const failed = requireFailed(result);
    expect(failed.failure.status).toBe('step_limit_exceeded');
    if (failed.failure.status !== 'step_limit_exceeded') return;
    expect(failed.failure.requiredSteps).toBe(100);
    expect(failed.failure.stepsCompleted).toBe(0);
    expect(failed.events).toHaveLength(0);
  });

  it('numerical_failure (переполнение) сохраняет причину', () => {
    const result = integrateNBodyWithEvents(
      {
        timeS: 0,
        bodies: [
          body('a', 1e300, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
          body('b', 1e300, null, { x: 1e10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
        ]
      },
      { timeStepS: 1, durationS: 100, closeApproachDistanceM: 5e9 }
    );
    expect(result.status).toBe('integration_failed');
    const failed = requireFailed(result);
    expect(failed.failure.status).toBe('numerical_failure');
    if (failed.failure.status !== 'numerical_failure') return;
    expect(failed.failure.reason).toBe('nonfinite_diagnostics');
    expect(failed.failure.stepsCompleted).toBe(0);
  });

  it('начальная сингулярная конфигурация: integration_failed с парой', () => {
    const result = integrateNBodyWithEvents(
      {
        timeS: 0,
        bodies: [
          body('b', 1, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
          body('a', 1, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
        ]
      },
      { timeStepS: 1, durationS: 100, closeApproachDistanceM: 5e9 }
    );
    expect(result.status).toBe('integration_failed');
    const failed = requireFailed(result);
    expect(failed.failure.status).toBe('singular_configuration');
    if (failed.failure.status !== 'singular_configuration') return;
    expect([failed.failure.pairIdA, failed.failure.pairIdB]).toEqual(['a', 'b']);
  });
});

// ============================================
// 16. Выключенная классификация сближений
// ============================================
describe('без порога классификация сближений выключена честно', () => {
  const result = requireCompleted(
    integrateNBodyWithEvents(flyThrough(), { timeStepS: 1e6, durationS: 1e6 })
  );

  it('метаданные явно отражают выключение, событий нет', () => {
    expect(result.detection.closeApproachDetectionEnabled).toBe(false);
    expect(result.detection.closeApproachThresholdM).toBeNull();
    expect(closeApproaches(result.events)).toHaveLength(0);
    expect(result.detection.pairsCheckedTotal).toBe(1);
  });
});

// ============================================
// 17. Baseline: без событий результаты совпадают с Stage 4.6.1-A
// ============================================
describe('численный baseline совпадает с обычным интегратором', () => {
  const options = { timeStepS: P_EARTH / 500, durationS: P_EARTH, sampleEverySteps: 25 };

  it('снимки и сохранение побитово совпадают (эллипс e=0.5, порог 1e9)', () => {
    const plain = integrateNBodyLeapfrog(ellipse(), options);
    expect(plain.status).toBe('completed');
    const events = integrateNBodyWithEvents(ellipse(), { ...options, closeApproachDistanceM: 1e9 });
    expect(events.status).toBe('completed');
    const evCompleted = requireCompleted(events);
    const plainCompleted = requireCompletedEvents(plain);
    expect(evCompleted.events).toEqual([]);
    expect(JSON.stringify(evCompleted.snapshots)).toBe(JSON.stringify(plainCompleted.snapshots));
    expect(JSON.stringify(evCompleted.conservation)).toBe(JSON.stringify(plainCompleted.conservation));
    expect(evCompleted.stepsCompleted).toBe(plainCompleted.stepsCompleted);
    expect(evCompleted.timeS).toBe(plainCompleted.timeS);
    expect(evCompleted.detection.closeApproachDetectionEnabled).toBe(true);
    expect(evCompleted.detection.pairsCheckedTotal).toBe(1);
    expect(evCompleted.detection.pairsWithUnknownRadius).toBe(1);
  });
});

function requireCompletedEvents(result: ReturnType<typeof integrateNBodyLeapfrog>) {
  if (result.status !== 'completed') {
    throw new Error(`ожидался статус completed, получен ${result.status}`);
  }
  return result;
}
