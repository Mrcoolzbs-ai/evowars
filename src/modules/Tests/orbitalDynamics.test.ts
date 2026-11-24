// ============================================
// ТЕСТЫ — N-body динамика: leapfrog KDK (Stage 4.6.1-A)
// ============================================
//
// 16 групп проверок этапа 4.6.1-A:
// физика (1-6), инварианты системы отсчёта (7-8), детерминизм (9-10),
// контракты отказов (11-14), гигиена и честные границы (15-16).
//
// Принципы: успешное завершение прогона НЕ трактуется как устойчивость;
// эталонные числа в допусках — измеренные, не желаемые.

import { describe, it, expect } from 'vitest';
import {
  integrateNBodyLeapfrog,
  computeStateDiagnostics,
  toBarycentricFrame,
  canonicalBodyOrder,
  NBODY_LEAPFROG_LIMITATION,
  type NBodyInitialState,
  type NBodyIntegrationResult,
  type OrbitalBodyState
} from '../OrbitalMechanics/dynamics';
import { integrateNBodyLeapfrog as reexportedIntegrate } from '../OrbitalMechanics';
import { G } from '../Units/index';

const M_SUN = 1.989e30;
const M_EARTH = 5.9722e24;
const M_MOON = 7.34767309e22;
const AU = 1.495978707e11;
const MU = G * (M_SUN + M_EARTH);
/** Период двухтельной задачи Солнце–Земля с суммарной массой. */
const P_EARTH = 2 * Math.PI * Math.sqrt((AU * AU * AU) / MU);
const V_REL = Math.sqrt(MU / AU);
const R_EARTH = AU * (M_SUN / (M_SUN + M_EARTH));
const R_SUN = AU * (M_EARTH / (M_SUN + M_EARTH));
const V_EARTH = V_REL * (M_SUN / (M_SUN + M_EARTH));
const V_SUN = V_REL * (M_EARTH / (M_SUN + M_EARTH));

function body(id: string, massKg: number, positionM: { x: number; y: number; z: number }, velocityMPerS: { x: number; y: number; z: number }): OrbitalBodyState {
  return { id, massKg, radiusM: null, positionM, velocityMPerS };
}

/** Барицентрическая круговая орбита Земли (относительный радиус = 1 а.е.). */
function sunEarthCircular(): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('earth', M_EARTH, { x: R_EARTH, y: 0, z: 0 }, { x: 0, y: V_EARTH, z: 0 }),
      body('sun', M_SUN, { x: -R_SUN, y: 0, z: 0 }, { x: 0, y: -V_SUN, z: 0 })
    ]
  };
}

/** Три тела: звезда + две планеты на круговых орбитах 1 и 2 а.е. */
function threeBody(): NBodyInitialState {
  const m1 = 1e24;
  const m2 = 1e24;
  const a1 = AU;
  const a2 = 2 * AU;
  return {
    timeS: 0,
    bodies: [
      body('star', M_SUN, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      body('p1', m1, { x: a1, y: 0, z: 0 }, { x: 0, y: Math.sqrt((G * M_SUN) / a1), z: 0 }),
      body('p2', m2, { x: a2, y: 0, z: 0 }, { x: 0, y: Math.sqrt((G * M_SUN) / a2), z: 0 })
    ]
  };
}

function requireCompleted(result: NBodyIntegrationResult): Extract<NBodyIntegrationResult, { status: 'completed' }> {
  if (result.status !== 'completed') {
    throw new Error(`ожидался статус completed, получен ${result.status}`);
  }
  return result;
}

function lastSnapshot(result: Extract<NBodyIntegrationResult, { status: 'completed' }>) {
  return result.snapshots[result.snapshots.length - 1];
}

// ============================================
// 1. Аналитическое ускорение
// ============================================
describe('аналитическое ускорение', () => {
  it('приращение скорости за один шаг равно a·dt с точностью кривизны', () => {
    const dt = 3600;
    const result = requireCompleted(
      integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: dt, durationS: dt })
    );
    const final = lastSnapshot(result);
    const earth = final.bodies.find((b) => b.id === 'earth');
    if (!earth) throw new Error('earth не найдена');
    const dvx = earth.velocityMPerS.x;
    const dvy = earth.velocityMPerS.y - V_EARTH;
    // Аналитическое ускорение Земли: a = G·M_SUN / AU²  (дистанция 1 а.е.)
    const aExpected = (G * M_SUN) / (AU * AU);
    const dvMagnitude = Math.sqrt(dvx * dvx + dvy * dvy);
    const relative = Math.abs(dvMagnitude - aExpected * dt) / (aExpected * dt);
    // KDK усредняет ускорение начала и конца шага; расхождение O((ω·dt)²)
    expect(relative).toBeLessThan(1e-5);
  });
});

// ============================================
// 2. Пары сил / третий закон Ньютона
// ============================================
describe('пары сил и третий закон Ньютона', () => {
  it('импульсы, набранные парой за шаг, равны и противоположны', () => {
    const dt = 3600;
    const result = requireCompleted(
      integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: dt, durationS: dt })
    );
    const final = lastSnapshot(result);
    const earth = final.bodies.find((b) => b.id === 'earth');
    const sun = final.bodies.find((b) => b.id === 'sun');
    if (!earth || !sun) throw new Error('тела не найдены');
    const dpEarth = { x: M_EARTH * earth.velocityMPerS.x, y: M_EARTH * (earth.velocityMPerS.y - V_EARTH) };
    const dpSun = { x: M_SUN * sun.velocityMPerS.x, y: M_SUN * (sun.velocityMPerS.y + V_SUN) };
    const sum = Math.hypot(dpEarth.x + dpSun.x, dpEarth.y + dpSun.y);
    const scale = Math.hypot(dpEarth.x, dpEarth.y);
    expect(sum / scale).toBeLessThan(1e-12);
  });
});

// ============================================
// 3. Центр масс движется равномерно
// ============================================
describe('центр масс движется равномерно', () => {
  it('COM(t) = COM0 + V0·t для 3-body на 10 периодах', () => {
    const P1 = 2 * Math.PI * Math.sqrt((AU * AU * AU) / (G * M_SUN));
    const result = requireCompleted(
      integrateNBodyLeapfrog(threeBody(), { timeStepS: P1 / 1000, durationS: 10 * P1, sampleEverySteps: 10 })
    );
    expect(result.conservation.maxCenterOfMassDriftM).toBeLessThan(1e-6);
  });
});

// ============================================
// 4. Круговая орбита (Солнце–Земля)
// ============================================
describe('круговая орбита Солнце–Земля', () => {
  const dt = P_EARTH / 1000;
  const result = requireCompleted(
    integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: dt, durationS: P_EARTH, sampleEverySteps: 1 })
  );

  it('фазовое отставание за период < 1e-4 рад (измерено 8.268e-5)', () => {
    const final = lastSnapshot(result);
    const earth = final.bodies.find((b) => b.id === 'earth');
    const sun = final.bodies.find((b) => b.id === 'sun');
    if (!earth || !sun) throw new Error('тела не найдены');
    const angle = Math.atan2(earth.positionM.y - sun.positionM.y, earth.positionM.x - sun.positionM.x);
    const phaseLag = angle; // ожидается 2π ≡ 0; отставание — малый отрицательный угол
    expect(phaseLag).toBeLessThan(0);
    expect(Math.abs(phaseLag)).toBeLessThan(1e-4);
  });

  it('максимальное отклонение радиуса < 1e-4 (измерено ~2e-5)', () => {
    let maxRadiusErr = 0;
    for (const snapshot of result.snapshots) {
      const earth = snapshot.bodies.find((b) => b.id === 'earth');
      const sun = snapshot.bodies.find((b) => b.id === 'sun');
      if (!earth || !sun) throw new Error('тела не найдены');
      const r = Math.hypot(earth.positionM.x - sun.positionM.x, earth.positionM.y - sun.positionM.y);
      maxRadiusErr = Math.max(maxRadiusErr, Math.abs(r - AU) / AU);
    }
    expect(maxRadiusErr).toBeLessThan(1e-4);
  });

  it('дрейф энергии на 1001 контрольной точке < 1e-9 (измерено 3.9e-10)', () => {
    expect(result.conservation.maxEnergyDriftRelative).toBeLessThan(1e-9);
    expect(result.conservation.controlStateCount).toBe(1001);
  });

  it('дрейф импульса и момента импульса на уровне машинной точности', () => {
    expect(result.conservation.maxMomentumDriftRelative).toBeLessThan(1e-12);
    expect(result.conservation.maxAngularMomentumDriftRelative).toBeLessThan(1e-12);
  });
});

// ============================================
// 5. Эллипс e=0.5: сходимость к Кеплеру (2-й порядок)
// ============================================
describe('эллипс e=0.5, сходимость к кеплеровой траектории', () => {
  const e = 0.5;
  const a = AU;
  const rp = a * (1 - e);
  const vp = Math.sqrt((MU * (1 + e)) / (a * (1 - e)));
  const ellipse = (): NBodyInitialState => ({
    timeS: 0,
    bodies: [
      body('a', M_SUN, { x: -rp * (M_EARTH / (M_SUN + M_EARTH)), y: 0, z: 0 }, { x: 0, y: (-vp * M_EARTH) / (M_SUN + M_EARTH), z: 0 }),
      body('b', M_EARTH, { x: rp * (M_SUN / (M_SUN + M_EARTH)), y: 0, z: 0 }, { x: 0, y: (vp * M_SUN) / (M_SUN + M_EARTH), z: 0 })
    ]
  });
  // Кеплер: M = E − e·sinE; позиция в перицентровой системе координат.
  function keplerPosition(t: number): { x: number; y: number } {
    const M = (2 * Math.PI * t) / P_EARTH;
    let E = M;
    for (let k = 0; k < 60; k++) {
      E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    return { x: a * (Math.cos(E) - e), y: a * Math.sqrt(1 - e * e) * Math.sin(E) };
  }
  const tCheck = P_EARTH / 4;
  const analytic = keplerPosition(tCheck);
  const errors: number[] = [];

  it('ошибка позиции падает пропорционально dt²', () => {
    for (const divisor of [500, 1000, 2000]) {
      const result = requireCompleted(
        integrateNBodyLeapfrog(ellipse(), { timeStepS: P_EARTH / divisor, durationS: tCheck })
      );
      const final = lastSnapshot(result);
      const rel = {
        x: final.bodies[1].positionM.x - final.bodies[0].positionM.x,
        y: final.bodies[1].positionM.y - final.bodies[0].positionM.y
      };
      errors.push(Math.hypot(rel.x - analytic.x, rel.y - analytic.y) / Math.hypot(analytic.x, analytic.y));
    }
    // измерено: 5.54e-4 → 1.39e-4 → 3.46e-5 (отношение ~4 при удвоении разрешения)
    expect(errors[0]).toBeLessThan(1e-3);
    expect(errors[1]).toBeLessThan(3e-4);
    expect(errors[2]).toBeLessThan(8e-5);
    expect(errors[0] / errors[1]).toBeGreaterThan(3.5);
    expect(errors[0] / errors[1]).toBeLessThan(4.5);
    expect(errors[1] / errors[2]).toBeGreaterThan(3.5);
    expect(errors[1] / errors[2]).toBeLessThan(4.5);
  });
});

// ============================================
// 6. Сохранение интегралов в 3-body задаче
// ============================================
describe('сохранение интегралов, 3-body, 10 периодов', () => {
  const P1 = 2 * Math.PI * Math.sqrt((AU * AU * AU) / (G * M_SUN));
  const result = requireCompleted(
    integrateNBodyLeapfrog(threeBody(), { timeStepS: P1 / 1000, durationS: 10 * P1, sampleEverySteps: 10 })
  );

  it('энергия: дрейф < 1e-9 (измерено 2.4e-10)', () => {
    expect(result.conservation.maxEnergyDriftRelative).toBeLessThan(1e-9);
  });
  it('импульс: дрейф < 1e-13 (измерено 1.7e-14)', () => {
    expect(result.conservation.maxMomentumDriftRelative).toBeLessThan(1e-13);
  });
  it('момент импульса: дрейф < 1e-13 (измерено 5.3e-15)', () => {
    expect(result.conservation.maxAngularMomentumDriftRelative).toBeLessThan(1e-13);
  });
  it('центр масс: дрейф < 1e-6 м (измерено 6.6e-8 м)', () => {
    expect(result.conservation.maxCenterOfMassDriftM).toBeLessThan(1e-6);
  });
});

// ============================================
// 7. Инвариантность к переносу начала координат
// ============================================
describe('инвариантность к переносу', () => {
  it('сдвиг системы не меняет траектории (порог 1e-9)', () => {
    const shift = { x: 1e11, y: -5e10, z: 3e10 };
    const shifted = (): NBodyInitialState => ({
      timeS: 0,
      bodies: sunEarthCircular().bodies.map((b) => ({
        ...b,
        positionM: { x: b.positionM.x + shift.x, y: b.positionM.y + shift.y, z: b.positionM.z + shift.z }
      }))
    });
    const base = requireCompleted(
      integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: P_EARTH / 1000, durationS: P_EARTH })
    );
    const moved = requireCompleted(
      integrateNBodyLeapfrog(shifted(), { timeStepS: P_EARTH / 1000, durationS: P_EARTH })
    );
    const baseFinal = lastSnapshot(base);
    const movedFinal = lastSnapshot(moved);
    let maxPosRel = 0;
    let maxVelRel = 0;
    for (let i = 0; i < baseFinal.bodies.length; i++) {
      const ba = baseFinal.bodies[i];
      const bb = movedFinal.bodies[i];
      const dp = Math.hypot(
        bb.positionM.x - shift.x - ba.positionM.x,
        bb.positionM.y - shift.y - ba.positionM.y,
        bb.positionM.z - shift.z - ba.positionM.z
      );
      const dv = Math.hypot(
        bb.velocityMPerS.x - ba.velocityMPerS.x,
        bb.velocityMPerS.y - ba.velocityMPerS.y,
        bb.velocityMPerS.z - ba.velocityMPerS.z
      );
      maxPosRel = Math.max(maxPosRel, dp / Math.max(1, Math.hypot(ba.positionM.x, ba.positionM.y, ba.positionM.z), Math.hypot(shift.x, shift.y, shift.z)));
      maxVelRel = Math.max(maxVelRel, dv / Math.max(1, Math.hypot(ba.velocityMPerS.x, ba.velocityMPerS.y, ba.velocityMPerS.z)));
    }
    expect(maxPosRel).toBeLessThan(1e-9);
    expect(maxVelRel).toBeLessThan(1e-9);
  });
});

// ============================================
// 8. Инвариантность к повороту на 90°
// ============================================
describe('инвариантность к повороту на 90°', () => {
  it('результат после обратного поворота побитово совпадает', () => {
    const rot90 = (v: { x: number; y: number; z: number }) => ({ x: -v.y, y: v.x, z: v.z });
    const unrot = (v: { x: number; y: number; z: number }) => ({ x: v.y, y: -v.x, z: v.z });
    const rotated = (): NBodyInitialState => ({
      timeS: 0,
      bodies: sunEarthCircular().bodies.map((b) => ({
        ...b,
        positionM: rot90(b.positionM),
        velocityMPerS: rot90(b.velocityMPerS)
      }))
    });
    const base = requireCompleted(
      integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: P_EARTH / 1000, durationS: P_EARTH })
    );
    const turned = requireCompleted(
      integrateNBodyLeapfrog(rotated(), { timeStepS: P_EARTH / 1000, durationS: P_EARTH })
    );
    const baseFinal = lastSnapshot(base);
    const turnedFinal = lastSnapshot(turned);
    for (let i = 0; i < baseFinal.bodies.length; i++) {
      const ba = baseFinal.bodies[i];
      const bt = turnedFinal.bodies[i];
      const pos = unrot(bt.positionM);
      const vel = unrot(bt.velocityMPerS);
      expect(pos.x).toBe(ba.positionM.x);
      expect(pos.y).toBe(ba.positionM.y);
      expect(pos.z).toBe(ba.positionM.z);
      expect(vel.x).toBe(ba.velocityMPerS.x);
      expect(vel.y).toBe(ba.velocityMPerS.y);
      expect(vel.z).toBe(ba.velocityMPerS.z);
    }
    // скалярные поля отчёта побитово равны
    expect(turned.conservation.maxEnergyDriftRelative).toBe(base.conservation.maxEnergyDriftRelative);
    expect(turned.conservation.maxCenterOfMassDriftM).toBe(base.conservation.maxCenterOfMassDriftM);
  });
});

// ============================================
// 9. Детерминизм
// ============================================
describe('детерминизм', () => {
  it('два одинаковых прогона побитово идентичны', () => {
    const run = () => integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: P_EARTH / 1000, durationS: P_EARTH, sampleEverySteps: 100 });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

// ============================================
// 10. Канонический порядок тел
// ============================================
describe('канонический порядок тел', () => {
  it('обратный порядок входа даёт побитово тот же результат', () => {
    const direct = integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: P_EARTH / 1000, durationS: P_EARTH, sampleEverySteps: 100 });
    const reversed = integrateNBodyLeapfrog(
      { timeS: 0, bodies: [...sunEarthCircular().bodies].reverse() },
      { timeStepS: P_EARTH / 1000, durationS: P_EARTH, sampleEverySteps: 100 }
    );
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(direct));
  });
  it('canonicalBodyOrder сортирует по id', () => {
    const ordered = canonicalBodyOrder(sunEarthCircular().bodies);
    expect(ordered.map((b) => b.id)).toEqual(['earth', 'sun']);
  });
});

// ============================================
// 11. Невалидные входы (13 кодов)
// ============================================
describe('невалидные входы', () => {
  it('все коды валидации присутствуют в одном сборном отказе', () => {
    const bad: NBodyInitialState = {
      timeS: -1,
      bodies: [
        { id: '', massKg: -5, radiusM: 0, positionM: { x: NaN, y: 0, z: 0 }, velocityMPerS: { x: Infinity, y: 0, z: 0 } },
        { id: 'x', massKg: 1, radiusM: null, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 } },
        { id: 'x', massKg: 1, radiusM: null, positionM: { x: 0, y: 0, z: 0 }, velocityMPerS: { x: 0, y: 0, z: 0 } }
      ]
    };
    const result = integrateNBodyLeapfrog(bad, { timeStepS: -1, durationS: NaN, sampleEverySteps: 1.5, maxSteps: 2.5 });
    expect(result.status).toBe('invalid_input');
    if (result.status !== 'invalid_input') return;
    const codes = result.issues.map((i) => i.code);
    for (const code of [
      'empty_id',
      'duplicate_id',
      'invalid_mass',
      'invalid_radius',
      'invalid_position',
      'invalid_velocity',
      'invalid_time',
      'invalid_time_step',
      'invalid_duration',
      'invalid_sample_every_steps',
      'invalid_max_steps'
    ]) {
      expect(codes).toContain(code);
    }
  });
  it('bodies_too_few: одно тело отклоняется', () => {
    const result = integrateNBodyLeapfrog(
      { timeS: 0, bodies: [body('only', 1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })] },
      { timeStepS: 1, durationS: 10 }
    );
    expect(result.status).toBe('invalid_input');
    if (result.status !== 'invalid_input') return;
    expect(result.issues.map((i) => i.code)).toContain('bodies_too_few');
  });
  it('steps_not_integer: горизонт не кратен шагу', () => {
    const result = integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: 1000, durationS: 1_000_500 });
    expect(result.status).toBe('invalid_input');
    if (result.status !== 'invalid_input') return;
    expect(result.issues.map((i) => i.code)).toContain('steps_not_integer');
  });
});

// ============================================
// 12. Сингулярная конфигурация
// ============================================
describe('сингулярная конфигурация', () => {
  it('совпадающие начальные позиции: отказ до первого шага, пара в каноническом порядке', () => {
    const result = integrateNBodyLeapfrog(
      {
        timeS: 0,
        bodies: [
          body('b', 1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
          body('a', 1, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
        ]
      },
      { timeStepS: 1, durationS: 100 }
    );
    expect(result.status).toBe('singular_configuration');
    if (result.status !== 'singular_configuration') return;
    expect([result.pairIdA, result.pairIdB]).toEqual(['a', 'b']);
    expect(result.stepsCompleted).toBe(0);
    expect(result.timeS).toBe(0);
  });
  it('лобовое сближение посреди шага: отказ на шаге 5, stepsCompleted = 4', () => {
    const result = integrateNBodyLeapfrog(
      {
        timeS: 0,
        bodies: [
          body('b', 1e-10, { x: 5, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }),
          body('a', 1e-10, { x: -5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
        ]
      },
      { timeStepS: 1, durationS: 10 }
    );
    expect(result.status).toBe('singular_configuration');
    if (result.status !== 'singular_configuration') return;
    expect([result.pairIdA, result.pairIdB]).toEqual(['a', 'b']);
    expect(result.stepsCompleted).toBe(4);
    expect(result.timeS).toBe(4);
    expect(result.distanceM).toBeLessThan(1e-6);
  });
});

// ============================================
// 13. Предел числа шагов
// ============================================
describe('предел числа шагов', () => {
  it('ровно maxSteps требуемых шагов — выполняется', () => {
    const result = integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: 1000, durationS: 1_000_000, maxSteps: 1000 });
    expect(result.status).toBe('completed');
  });
  it('на один шаг больше maxSteps — step_limit_exceeded до начала прогона', () => {
    const result = integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: 1000, durationS: 1_000_000, maxSteps: 999 });
    expect(result.status).toBe('step_limit_exceeded');
    if (result.status !== 'step_limit_exceeded') return;
    expect(result.requiredSteps).toBe(1000);
    expect(result.stepsCompleted).toBe(0);
    expect(result.timeS).toBe(0);
  });
});

// ============================================
// 14. Численное переполнение
// ============================================
describe('численное переполнение', () => {
  it('экстремальные массы: numerical_failure/nonfinite_diagnostics до первого шага', () => {
    const result = integrateNBodyLeapfrog(
      {
        timeS: 0,
        bodies: [
          body('a', 1e300, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
          body('b', 1e300, { x: 1e10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })
        ]
      },
      { timeStepS: 1, durationS: 100 }
    );
    expect(result.status).toBe('numerical_failure');
    if (result.status !== 'numerical_failure') return;
    expect(result.reason).toBe('nonfinite_diagnostics');
    expect(result.stepsCompleted).toBe(0);
  });
});

// ============================================
// 15. Отсутствие NaN/Inf в результатах
// ============================================
describe('отсутствие NaN/Inf в результатах', () => {
  it('все поля всех снимков конечны (2-body и 3-body)', () => {
    const P1 = 2 * Math.PI * Math.sqrt((AU * AU * AU) / (G * M_SUN));
    const runs = [
      integrateNBodyLeapfrog(sunEarthCircular(), { timeStepS: P_EARTH / 1000, durationS: P_EARTH, sampleEverySteps: 100 }),
      integrateNBodyLeapfrog(threeBody(), { timeStepS: P1 / 500, durationS: P1, sampleEverySteps: 50 })
    ];
    for (const run of runs) {
      const completed = requireCompleted(run);
      for (const snapshot of completed.snapshots) {
        expect(Number.isFinite(snapshot.timeS)).toBe(true);
        for (const b of snapshot.bodies) {
          expect(Number.isFinite(b.massKg)).toBe(true);
          expect(Number.isFinite(b.positionM.x)).toBe(true);
          expect(Number.isFinite(b.positionM.y)).toBe(true);
          expect(Number.isFinite(b.positionM.z)).toBe(true);
          expect(Number.isFinite(b.velocityMPerS.x)).toBe(true);
          expect(Number.isFinite(b.velocityMPerS.y)).toBe(true);
          expect(Number.isFinite(b.velocityMPerS.z)).toBe(true);
        }
        expect(Number.isFinite(snapshot.diagnostics.totalEnergyJ)).toBe(true);
        expect(Number.isFinite(snapshot.diagnostics.kineticEnergyJ)).toBe(true);
        expect(Number.isFinite(snapshot.diagnostics.potentialEnergyJ)).toBe(true);
      }
    }
  });
});

// ============================================
// 16. Честные границы, барицентр, ре-экспорт, Луна
// ============================================
describe('честные границы и вспомогательный API', () => {
  it('NBODY_LEAPFROG_LIMITATION явно запрещает трактовать завершение как устойчивость', () => {
    expect(NBODY_LEAPFROG_LIMITATION).toContain('устойчивост');
    expect(NBODY_LEAPFROG_LIMITATION.length).toBeGreaterThan(100);
  });

  it('toBarycentricFrame: COM и импульс обнуляются', () => {
    const bary = toBarycentricFrame(threeBody());
    const d = computeStateDiagnostics(bary);
    expect(Math.hypot(d.centerOfMassM.x, d.centerOfMassM.y, d.centerOfMassM.z)).toBeLessThan(1e-6);
    expect(Math.hypot(d.momentumKgMPerS.x, d.momentumKgMPerS.y, d.momentumKgMPerS.z)).toBeLessThan(1e-15);
  });

  it('ре-экспорт из index — та же функция', () => {
    expect(reexportedIntegrate).toBe(integrateNBodyLeapfrog);
  });

  it('Луна: кеплеров период по родителю и интегрированный период в пределах ±0.5% от 27.321661 d', () => {
    const A_MOON = 3.844e8;
    const P_SIDE = 27.321661 * 86400;
    // Кеплер по родителю (только масса Земли)
    const P_KEPLER = 2 * Math.PI * Math.sqrt((A_MOON * A_MOON * A_MOON) / (G * M_EARTH));
    expect(Math.abs(P_KEPLER / P_SIDE - 1)).toBeLessThan(0.005);
    // Интегрирование барицентрической пары Земля–Луна, круговая относительная орбита
    const vRel = Math.sqrt((G * (M_EARTH + M_MOON)) / A_MOON);
    const moonSystem = (): NBodyInitialState => ({
      timeS: 0,
      bodies: [
        body('earth', M_EARTH, { x: -A_MOON * (M_MOON / (M_EARTH + M_MOON)), y: 0, z: 0 }, { x: 0, y: (-vRel * M_MOON) / (M_EARTH + M_MOON), z: 0 }),
        body('moon', M_MOON, { x: A_MOON * (M_EARTH / (M_EARTH + M_MOON)), y: 0, z: 0 }, { x: 0, y: (vRel * M_EARTH) / (M_EARTH + M_MOON), z: 0 })
      ]
    });
    const horizon = 30 * 86400;
    const dt = horizon / 2000; // ровно 1296 с: горизонт кратен шагу
    const result = requireCompleted(
      integrateNBodyLeapfrog(moonSystem(), { timeStepS: dt, durationS: horizon, sampleEverySteps: 10 })
    );
    // Период относительной орбиты: раскрутка угла до 2π с линейной интерполяцией
    const relAngle = (snapshot: { bodies: OrbitalBodyState[] }): number => {
      const earth = snapshot.bodies.find((b) => b.id === 'earth');
      const moon = snapshot.bodies.find((b) => b.id === 'moon');
      if (!earth || !moon) throw new Error('тела не найдены');
      return Math.atan2(moon.positionM.y - earth.positionM.y, moon.positionM.x - earth.positionM.x);
    };
    const angles = result.snapshots.map(relAngle);
    const times = result.snapshots.map((s) => s.timeS);
    const unwrapped: number[] = [angles[0]];
    for (let i = 1; i < angles.length; i++) {
      let delta = angles[i] - angles[i - 1];
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      unwrapped.push(unwrapped[i - 1] + delta);
    }
    let periodS = NaN;
    for (let i = 1; i < unwrapped.length; i++) {
      if (unwrapped[i - 1] < 2 * Math.PI && unwrapped[i] >= 2 * Math.PI) {
        const frac = (2 * Math.PI - unwrapped[i - 1]) / (unwrapped[i] - unwrapped[i - 1]);
        periodS = times[i - 1] + frac * (times[i] - times[i - 1]);
        break;
      }
    }
    expect(Number.isFinite(periodS)).toBe(true);
    // измерено: 27.2846 d (−0.136%)
    expect(Math.abs(periodS / P_SIDE - 1)).toBeLessThan(0.005);
    expect(result.conservation.maxEnergyDriftRelative).toBeLessThan(1e-9);
  });
});
