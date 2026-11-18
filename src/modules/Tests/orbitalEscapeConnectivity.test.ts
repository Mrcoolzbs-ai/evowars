// ============================================
// ТЕСТЫ — Детекция выброса и связности системы (Stage 4.6.1-C)
// ============================================
//
// Проверяются два независимых диагностических слоя поверх событийного
// интегратора Stage 4.6.1-A/B:
//
// 1. Escape/ejection detection: выход тела за ЯВНО заданную границу
//    (escapeRadiusM) относительно ЯВНО заданного центрального тела
//    (primaryBodyId) с радиальной скоростью наружу и положительной
//    осциллирующей двухтельной энергией; подтверждение выброса
//    требует удержания условий на протяжении
//    escapeConfirmationDurationS. Одного пересечения недостаточно:
//    ejection_candidate — НЕ подтверждённый физический выброс.
// 2. Connectivity detection: pairwise osculating-binding граф
//    (ребро при eps_ij < −допуск, eps_ij — двухтельная удельная
//    энергия). ЭТО ДИАГНОСТИЧЕСКОЕ ПРИБЛИЖЕНИЕ: влияние остальных тел
//    в каждую двухтельную энергию не входит, результат не является
//    доказательством физической связанности или устойчивости.
//
// Все эталонные числа в допусках — измеренные на фиксированных
// детерминированных конфигурациях KDK leapfrog, не «желаемые».
// Отсутствие выбросов/событий связности НЕ доказывает устойчивость.

import { describe, it, expect } from 'vitest';
import {
  integrateNBodyWithEvents,
  type NBodyInitialState,
  type OrbitalBodyState,
  type Vector3
} from '../OrbitalMechanics/dynamics';
import {
  sortDetectionEvents,
  relativePairEnergy,
  bindingGraphEdges,
  componentsFromEdges,
  type NBodyDetectionEvent,
  type NBodyEventIntegrationResult,
  type EjectionEvent,
  type ConnectivityEvent
} from '../OrbitalMechanics/events';
import { G } from '../Units/index';

const M_SUN = 1.989e30;

function body(
  id: string,
  massKg: number,
  radiusM: number | null,
  positionM: Vector3,
  velocityMPerS: Vector3
): OrbitalBodyState {
  return { id, massKg, radiusM, positionM, velocityMPerS };
}

function requireCompleted(result: NBodyEventIntegrationResult) {
  if (result.status !== 'completed') {
    throw new Error(`ожидался статус completed, получен ${result.status}`);
  }
  return result;
}

function requireFailed(result: NBodyEventIntegrationResult) {
  if (result.status !== 'integration_failed') {
    throw new Error(`ожидался статус integration_failed, получен ${result.status}`);
  }
  return result;
}

function ejections(events: readonly NBodyDetectionEvent[]): EjectionEvent[] {
  return events.filter((e): e is EjectionEvent => e.type.startsWith('ejection_'));
}

function connectivity(events: readonly NBodyDetectionEvent[]): ConnectivityEvent[] {
  return events.filter((e): e is ConnectivityEvent => e.type.startsWith('connectivity_'));
}

// --- Гиперболический пролёт мимо звезды: ship с v > v_esc ---
// При r = 2e11: v_esc = sqrt(2·GM/r) ≈ 3.65e4 м/с; ship имеет 5.2e4 м/с.
// Двухтельная энергия консервативна и ≈ +6.88e8 Дж/кг > 0.
// Граница 4e11 пересекается наружу ≈ 4.18e6 с (измерено).
function hyperbolicState(): NBodyInitialState {
  return {
    timeS: 0,
    bodies: [
      body('sun', M_SUN, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      body('ship', 1e15, null, { x: 2e11, y: 0, z: 0 }, { x: 5.2e4, y: 0, z: 0 })
    ]
  };
}

// Звезда + тесная двойная подсистема на апоцентре барицентрической орбиты.
// Измерено: цикл «candidate → cancelled» при апоцентрных проходах.
function binaryAtApoapsis(): NBodyInitialState {
  const vb = Math.sqrt((G * M_SUN * (1 - 0.75)) / (2.4e11 * (1 + 0.75)));
  const vi = Math.sqrt((G * 6e29) / 5e9) / 2;
  return {
    timeS: 0,
    bodies: [
      body('sun', M_SUN, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      body('p', 3e29, null, { x: 4.2e11 - 2.5e9, y: 0, z: 0 }, { x: 0, y: vb + vi, z: 0 }),
      body('q', 3e29, null, { x: 4.2e11 + 2.5e9, y: 0, z: 0 }, { x: 0, y: vb - vi, z: 0 })
    ]
  };
}

describe('Stage 4.6.1-C: детекция выброса', () => {
  it('пересечение escape radius наружу при положительной энергии даёт ejection_candidate', () => {
    const result = requireCompleted(
      integrateNBodyWithEvents(hyperbolicState(), {
        timeStepS: 1e4,
        durationS: 5e6,
        primaryBodyId: 'sun',
        escapeRadiusM: 4e11,
        escapeConfirmationDurationS: 1e6
      })
    );
    const ej = ejections(result.events);
    expect(ej).toHaveLength(1);
    expect(ej[0].type).toBe('ejection_candidate');
    expect(ej[0].bodyId).toBe('ship');
    expect(ej[0].primaryBodyId).toBe('sun');
    // Измерено: crossing ≈ 4.17–4.19e6 с при dt = 1e4.
    expect(ej[0].crossingTimeS).toBeGreaterThan(4.0e6);
    expect(ej[0].crossingTimeS).toBeLessThan(4.35e6);
    expect(ej[0].escapeRadiusM).toBe(4e11);
    // Measured: eps ≈ +6.88e8 Дж/кг, v_r > 0 на пересечении.
    expect(ej[0].specificOrbitalEnergyAtCrossingJPerKg).toBeGreaterThan(1e8);
    expect(ej[0].radialVelocityAtCrossingMPerS).toBeGreaterThan(0);
    expect(ej[0].confirmationTimeS).toBeNull();
    expect(ej[0].cancelReason).toBeNull();
    expect(result.detection.escapeDetectionEnabled).toBe(true);
    expect(result.detection.primaryBodyId).toBe('sun');
    expect(result.detection.escapeRadiusM).toBe(4e11);
    expect(result.detection.escapeConfirmationDurationS).toBe(1e6);
    expect(result.detection.escapeEnergyToleranceJPerKg).toBe(0);
  });

  it('удержание условий весь confirmation duration подтверждает выброс', () => {
    const result = requireCompleted(
      integrateNBodyWithEvents(hyperbolicState(), {
        timeStepS: 1e4,
        durationS: 6e6,
        primaryBodyId: 'sun',
        escapeRadiusM: 4e11,
        escapeConfirmationDurationS: 1e6
      })
    );
    const cands = ejections(result.events).filter((e) => e.type === 'ejection_candidate');
    const confirmed = ejections(result.events).filter((e) => e.type === 'ejection_confirmed');
    expect(cands).toHaveLength(1);
    expect(confirmed).toHaveLength(1);
    // Измерено: подтверждение = пересечение + 1e6 c (на границе шага).
    expect(confirmed[0].confirmationTimeS).toBeGreaterThanOrEqual(
      cands[0].crossingTimeS + 1e6
    );
    expect(confirmed[0].confirmationTimeS).toBeLessThan(
      cands[0].crossingTimeS + 1e6 + 2e4
    );
    // Кандидат идёт в потоке раньше подтверждения.
    expect(result.events.indexOf(cands[0])).toBeLessThan(
      result.events.indexOf(confirmed[0])
    );
  });

  it('возврат внутрь границы до подтверждения отменяет кандидата с явной причиной', () => {
    // Двойная подсистема у апоцентра: тело несколько раз высовывается за
    // границу 4.193e11 и проваливается обратно; измерено: часть отмен
    // происходит из-за возврата внутрь радиуса.
    const result = requireCompleted(
      integrateNBodyWithEvents(binaryAtApoapsis(), {
        timeStepS: 1e4,
        durationS: 1e7,
        primaryBodyId: 'sun',
        escapeRadiusM: 4.193e11,
        escapeConfirmationDurationS: 1.5e6
      })
    );
    const cancelled = ejections(result.events).filter((e) => e.type === 'ejection_cancelled');
    expect(ejections(result.events).filter((e) => e.type === 'ejection_candidate').length).toBeGreaterThan(4);
    expect(cancelled.length).toBeGreaterThan(4);
    const reentry = cancelled.filter((e) => e.cancelReason === 'returned_within_escape_radius');
    expect(reentry.length).toBeGreaterThanOrEqual(1);
    for (const c of cancelled) {
      expect(c.confirmationTimeS).toBeNull();
    }
  });

  it('падение энергии до порога до подтверждения отменяет кандидата с явной причиной', () => {
    // Тот же сценарий, но с энергетическим допуском 2e8 Дж/кг: энергия
    // пары относительно sun осциллирует из-за тесной двойной и проваливается
    // ниже допуска; измерено: ВСЕ отмены — по энергии.
    const result = requireCompleted(
      integrateNBodyWithEvents(binaryAtApoapsis(), {
        timeStepS: 1e4,
        durationS: 1.4e7,
        primaryBodyId: 'sun',
        escapeRadiusM: 4e11,
        escapeConfirmationDurationS: 1.5e6,
        ejectionEnergyToleranceJPerKg: 2e8
      })
    );
    const cancelled = ejections(result.events).filter((e) => e.type === 'ejection_cancelled');
    expect(ejections(result.events).filter((e) => e.type === 'ejection_confirmed')).toHaveLength(0);
    expect(cancelled.length).toBeGreaterThanOrEqual(3);
    for (const c of cancelled) {
      expect(c.cancelReason).toBe('energy_not_above_threshold');
    }
  });

  it('горизонт раньше confirmation duration даёт ejection_pending_at_horizon, не confirmed', () => {
    const result = requireCompleted(
      integrateNBodyWithEvents(hyperbolicState(), {
        timeStepS: 1e4,
        durationS: 5e6,
        primaryBodyId: 'sun',
        escapeRadiusM: 4e11,
        escapeConfirmationDurationS: 4.25e6
      })
    );
    const types = ejections(result.events).map((e) => e.type);
    expect(types).toContain('ejection_candidate');
    expect(types).toContain('ejection_pending_at_horizon');
    expect(types).not.toContain('ejection_confirmed');
  });

  it('движение внутрь через границу не создаёт выброса', () => {
    // Связанная (eps < 0) орбита: тело пересекает 4e11 внутрь при
    // отрицательной радиальной скорости; возможно, пересечёт наружу позже,
    // но энергия отрицательна — условие выброса не выполнено ни разу.
    const result = requireCompleted(
      integrateNBodyWithEvents(
        {
          timeS: 0,
          bodies: [
            body('sun', M_SUN, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
            body(
              'ship',
              1e15,
              null,
              { x: 4.5e11, y: 0, z: 0 },
              { x: -2.2e4, y: 1e4, z: 0 }
            )
          ]
        },
        {
          timeStepS: 1e4,
          durationS: 1e7,
          primaryBodyId: 'sun',
          escapeRadiusM: 4e11,
          escapeConfirmationDurationS: 1e6
        }
      )
    );
    expect(ejections(result.events)).toHaveLength(0);
    expect(result.detection.escapeDetectionEnabled).toBe(true);
  });

  it('положительная энергия без пересечения границы наружу не даёт выброса', () => {
    // Гиперболическое тело (eps = +4.29e8 Дж/кг > 0) стартует ЗА границей
    // 4e11 и падает внутрь, но его минимальная дистанция ≈ 4.99e11
    // (измерено за 3e7 с) лежит ВНЕ границы: тело ни разу не пересекает
    // 4e11. Положительная энергия сама по себе не является выбросом —
    // ни одного события выброса.
    const result = requireCompleted(
      integrateNBodyWithEvents(
        {
          timeS: 0,
          bodies: [
            body('sun', M_SUN, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
            body('ship', 1e15, null, { x: 6e11, y: 0, z: 0 }, { x: -2e4, y: 3e4, z: 0 })
          ]
        },
        {
          timeStepS: 1e4,
          durationS: 3e7,
          primaryBodyId: 'sun',
          escapeRadiusM: 4e11,
          escapeConfirmationDurationS: 1e6
        }
      )
    );
    expect(ejections(result.events)).toHaveLength(0);
    expect(result.detection.escapeDetectionEnabled).toBe(true);
  });

  it('отсутствие/некорректность явных параметров даёт структурированный invalid_input', () => {
    const base = hyperbolicState();
    const issueCodes = (options: Record<string, unknown>): string[] => {
      const failed = requireFailed(integrateNBodyWithEvents(base, options as never));
      expect(failed.failure.status).toBe('invalid_input');
      if (failed.failure.status !== 'invalid_input') return [];
      return failed.failure.issues.map((i) => i.code);
    };

    // Только radius и duration без primaryBodyId — автоподбор primary
    // по массе запрещён.
    expect(
      issueCodes({ timeStepS: 1e4, durationS: 1e6, escapeRadiusM: 4e11, escapeConfirmationDurationS: 1e6 })
    ).toContain('missing_escape_option');

    // Неизвестный primary.
    expect(
      issueCodes({
        timeStepS: 1e4,
        durationS: 1e6,
        primaryBodyId: 'phantom',
        escapeRadiusM: 4e11,
        escapeConfirmationDurationS: 1e6
      })
    ).toContain('invalid_primary_body_id');

    // Некорректный radius.
    expect(
      issueCodes({
        timeStepS: 1e4,
        durationS: 1e6,
        primaryBodyId: 'sun',
        escapeRadiusM: 0,
        escapeConfirmationDurationS: 1e6
      })
    ).toContain('invalid_escape_radius_m');
    expect(
      issueCodes({
        timeStepS: 1e4,
        durationS: 1e6,
        primaryBodyId: 'sun',
        escapeRadiusM: -1,
        escapeConfirmationDurationS: 1e6
      })
    ).toContain('invalid_escape_radius_m');

    // Некорректный confirmation duration.
    expect(
      issueCodes({
        timeStepS: 1e4,
        durationS: 1e6,
        primaryBodyId: 'sun',
        escapeRadiusM: 4e11,
        escapeConfirmationDurationS: 0
      })
    ).toContain('invalid_escape_confirmation_duration_s');

    // Отрицательный энергетический допуск выброса.
    expect(
      issueCodes({
        timeStepS: 1e4,
        durationS: 1e6,
        primaryBodyId: 'sun',
        escapeRadiusM: 4e11,
        escapeConfirmationDurationS: 1e6,
        ejectionEnergyToleranceJPerKg: -1
      })
    ).toContain('invalid_ejection_energy_tolerance_j_per_kg');

    // Отрицательный допуск связности.
    expect(
      issueCodes({ timeStepS: 1e4, durationS: 1e6, bindingEnergyToleranceJPerKg: -1 })
    ).toContain('invalid_binding_energy_tolerance');

    // У структурно некорректных прогонов нет событий, а escape-детекция
    // честно помечена выключенной в метаданных.
    for (const options of [
      { timeStepS: 1e4, durationS: 1e6, escapeRadiusM: 4e11, escapeConfirmationDurationS: 1e6 },
      {
        timeStepS: 1e4,
        durationS: 1e6,
        primaryBodyId: 'phantom',
        escapeRadiusM: 4e11,
        escapeConfirmationDurationS: 1e6
      }
    ]) {
      const failed = requireFailed(integrateNBodyWithEvents(base, options as never));
      expect(failed.events).toHaveLength(0);
      expect(failed.detection.escapeDetectionEnabled).toBe(false);
    }
  });

  it('результаты детерминированы при перестановке тел во входном массиве', () => {
    const orders: NBodyInitialState[] = [
      binaryAtApoapsis(),
      {
        timeS: 0,
        bodies: [...binaryAtApoapsis().bodies].reverse()
      },
      {
        timeS: 0,
        bodies: [
          binaryAtApoapsis().bodies[2],
          binaryAtApoapsis().bodies[0],
          binaryAtApoapsis().bodies[1]
        ]
      }
    ];
    const options = {
      timeStepS: 1e4,
      durationS: 1.4e7,
      primaryBodyId: 'sun',
      escapeRadiusM: 4e11,
      escapeConfirmationDurationS: 1.5e6,
      ejectionEnergyToleranceJPerKg: 2e8
    };
    const results = orders.map((state) => requireCompleted(integrateNBodyWithEvents(state, options)));
    expect(results[0].events).toEqual(results[1].events);
    expect(results[0].events).toEqual(results[2].events);
    expect(results[0].detection).toEqual(results[1].detection);
  });
});

describe('Stage 4.6.1-C: связность системы', () => {
  it('связанная иерархическая система даёт одну компоненту и не создаёт событий', () => {
    // Планета с луной на круговой орбите вокруг звезды: все пары имеют
    // отрицательную двухтельную энергию (иерархия стабильна на горизонте).
    const planet = 1e26;
    const moon = 1e24;
    const rPlanet = 1e11;
    const vPlanet = Math.sqrt((G * M_SUN) / rPlanet);
    const rMoon = 1e9;
    const vMoonRel = Math.sqrt((G * (planet + moon)) / rMoon);
    const result = requireCompleted(
      integrateNBodyWithEvents(
        {
          timeS: 0,
          bodies: [
            body('sun', M_SUN, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
            body('planet', planet, null, { x: rPlanet, y: 0, z: 0 }, { x: 0, y: vPlanet, z: 0 }),
            body(
              'moon',
              moon,
              null,
              { x: rPlanet - rMoon, y: 0, z: 0 },
              { x: 0, y: vPlanet - vMoonRel, z: 0 }
            )
          ]
        },
        { timeStepS: 1e4, durationS: 5e6, bindingEnergyToleranceJPerKg: 1e3 }
      )
    );
    expect(connectivity(result.events)).toHaveLength(0);
    expect(result.detection.connectivityDetectionEnabled).toBe(true);
    expect(result.detection.connectivityEnergyToleranceJPerKg).toBe(1e3);
    expect(result.detection.initialConnectivityComponents).toBe(1);
    expect(result.detection.connectivityChecksTotal).toBeGreaterThan(1);
  });

  it('два независимых гравитационно связанных подграфа дают две компоненты', () => {
    // Две двойные подсистемы без общих рёбер: начальный граф распадается
    // на {p1,p2} и {q1,q2}; сближение происходит за горизонтом теста.
    const m = 5e29;
    const sep = 4e9;
    const vi = Math.sqrt((G * 2 * m) / sep) / 2;
    const result = requireCompleted(
      integrateNBodyWithEvents(
        {
          timeS: 0,
          bodies: [
            body('p1', m, null, { x: -2.5e11 - sep / 2, y: 1.5e10, z: 0 }, { x: 6e3, y: vi, z: 0 }),
            body('p2', m, null, { x: -2.5e11 + sep / 2, y: 1.5e10, z: 0 }, { x: 6e3, y: -vi, z: 0 }),
            body('q1', m, null, { x: 2.5e11 - sep / 2, y: -1.5e10, z: 0 }, { x: -6e3, y: vi, z: 0 }),
            body('q2', m, null, { x: 2.5e11 + sep / 2, y: -1.5e10, z: 0 }, { x: -6e3, y: -vi, z: 0 })
          ]
        },
        { timeStepS: 1e4, durationS: 1.5e7, bindingEnergyToleranceJPerKg: 2e8 }
      )
    );
    expect(connectivity(result.events)).toHaveLength(0);
    expect(result.detection.initialConnectivityComponents).toBe(2);
  });

  it('переход одной компоненты в несколько создаёт connectivity_lost с каноническими компонентами', () => {
    // Пара p-q летит к солнцу; связь пары с солнцем теряется и
    // восстанавливается при орбитальных проходах (первая потеря
    // измерена ≈ 13.76e6 c при dt = 1e4).
    const m = 1e29;
    const sep = 1e10;
    const vi = Math.sqrt((G * 2 * m) / sep) / 2;
    const result = requireCompleted(
      integrateNBodyWithEvents(
        {
          timeS: 0,
          bodies: [
            body('sun', M_SUN, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
            body('p', m, null, { x: 6e11 - sep / 2, y: 0, z: 0 }, { x: -1.1e4, y: vi, z: 0 }),
            body('q', m, null, { x: 6e11 + sep / 2, y: 0, z: 0 }, { x: -1.1e4, y: -vi, z: 0 })
          ]
        },
        { timeStepS: 1e4, durationS: 2.5e7, bindingEnergyToleranceJPerKg: 0 }
      )
    );
    const evs = connectivity(result.events);
    expect(evs.length).toBeGreaterThanOrEqual(2);
    const lost = evs.filter((e) => e.type === 'connectivity_lost');
    expect(lost.length).toBeGreaterThanOrEqual(1);
    const first = evs[0];
    expect(first.type).toBe('connectivity_lost');
    expect(first.componentsBefore).toEqual([['p', 'q', 'sun']]);
    expect(first.componentsAfter).toEqual([['p', 'q'], ['sun']]);
    expect(first.componentCountBefore).toBe(1);
    expect(first.componentCountAfter).toBe(2);
    expect(first.energyToleranceJPerKg).toBe(0);
    expect(first.criterionModel).toBe('pairwise_osculating_binding_energy');
    // Изменённые рёбра: каждое содержит пару в каноническом порядке.
    for (const e of evs) {
      for (const c of e.edgeChanges) {
        expect(c.bodyIdA < c.bodyIdB).toBe(true);
        expect(c.wasConnected).not.toBe(c.isConnected);
      }
    }
  });

  it('повторное связывание создаёт connectivity_restored и не стирает потерю', () => {
    const m = 1e29;
    const sep = 1e10;
    const vi = Math.sqrt((G * 2 * m) / sep) / 2;
    const result = requireCompleted(
      integrateNBodyWithEvents(
        {
          timeS: 0,
          bodies: [
            body('sun', M_SUN, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
            body('p', m, null, { x: 6e11 - sep / 2, y: 0, z: 0 }, { x: -1.1e4, y: vi, z: 0 }),
            body('q', m, null, { x: 6e11 + sep / 2, y: 0, z: 0 }, { x: -1.1e4, y: -vi, z: 0 })
          ]
        },
        { timeStepS: 1e4, durationS: 2.5e7, bindingEnergyToleranceJPerKg: 0 }
      )
    );
    const evs = connectivity(result.events);
    const firstLost = evs.findIndex((e) => e.type === 'connectivity_lost');
    const firstRestored = evs.findIndex((e) => e.type === 'connectivity_restored');
    expect(firstLost).toBeGreaterThanOrEqual(0);
    expect(firstRestored).toBeGreaterThan(firstLost);
    const lost = evs[firstLost];
    const restored = evs[firstRestored];
    // Составы до/после согласованы между собой.
    expect(restored.componentsBefore).toEqual(lost.componentsAfter);
    expect(restored.componentsAfter).toEqual(lost.componentsBefore);
    // Событие потери сохраняется в полном списке.
    expect(result.events).toContainEqual(lost);
  });

  it('изменение разбиения на компоненты без объединения в одну отражается отдельным типом', () => {
    // Две двойные подсистемы при встрече частично разрушаются:
    // измерено 2 компоненты {p1,p2},{q1,q2} → 4 одиночных тела
    // (изменение разбиения при count > 1 с обеих сторон).
    const m = 5e29;
    const sep = 4e9;
    const vi = Math.sqrt((G * 2 * m) / sep) / 2;
    const result = requireCompleted(
      integrateNBodyWithEvents(
        {
          timeS: 0,
          bodies: [
            body('p1', m, null, { x: -2.5e11 - sep / 2, y: 1.5e10, z: 0 }, { x: 6e3, y: vi, z: 0 }),
            body('p2', m, null, { x: -2.5e11 + sep / 2, y: 1.5e10, z: 0 }, { x: 6e3, y: -vi, z: 0 }),
            body('q1', m, null, { x: 2.5e11 - sep / 2, y: -1.5e10, z: 0 }, { x: -6e3, y: vi, z: 0 }),
            body('q2', m, null, { x: 2.5e11 + sep / 2, y: -1.5e10, z: 0 }, { x: -6e3, y: -vi, z: 0 })
          ]
        },
        { timeStepS: 1e4, durationS: 3e7, bindingEnergyToleranceJPerKg: 2e8 }
      )
    );
    const changed = connectivity(result.events).filter((e) => e.type === 'connectivity_changed');
    expect(changed.length).toBeGreaterThanOrEqual(1);
    const sample = changed[0];
    expect(sample.componentCountBefore).toBeGreaterThan(1);
    expect(sample.componentCountAfter).toBeGreaterThan(1);
    expect(sample.componentsBefore).toEqual([['p1', 'p2'], ['q1', 'q2']]);
    expect(sample.componentsBefore).not.toEqual(sample.componentsAfter);
  });

  it('начально несвязанная система не выдаёт ложную потерю связности на t = 0', () => {
    // Конфигурация с начальным разбиением {p,q},{sun}: фиксация
    // начального состояния не должна порождать connectivity_lost.
    const m = 5e29;
    const sep = 6e9;
    const vi = Math.sqrt((G * 2 * m) / sep) / 2;
    const result = requireCompleted(
      integrateNBodyWithEvents(
        {
          timeS: 0,
          bodies: [
            body('sun', M_SUN, null, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
            body('p', m, null, { x: 2.52e11 - sep / 2, y: 0, z: 0 }, { x: 0, y: vi + 12983.6, z: 0 }),
            body('q', m, null, { x: 2.52e11 + sep / 2, y: 0, z: 0 }, { x: 0, y: -vi + 12983.6, z: 0 })
          ]
        },
        { timeStepS: 1e4, durationS: 8e6, bindingEnergyToleranceJPerKg: 5e8 }
      )
    );
    expect(result.detection.initialConnectivityComponents).toBe(2);
    for (const e of connectivity(result.events)) {
      expect(e.eventTimeS).toBeGreaterThan(0);
    }
    // Первый переход (измерено ≈ 6.6e6 c) — восстановление одной
    // компоненты из двух, НЕ ложная «потеря» начального состояния.
    const evs = connectivity(result.events);
    expect(evs.length).toBeGreaterThanOrEqual(1);
    expect(evs[0].type).toBe('connectivity_restored');
    expect(evs[0].componentCountBefore).toBe(2);
    expect(evs[0].componentCountAfter).toBe(1);
    const lostAtStart = connectivity(result.events).filter(
      (e) => e.type === 'connectivity_lost' && e.eventTimeS === 0
    );
    expect(lostAtStart).toHaveLength(0);
  });

  it('канонический порядок компонент не зависит от порядка входных тел', () => {
    const m = 5e29;
    const sep = 4e9;
    const vi = Math.sqrt((G * 2 * m) / sep) / 2;
    const base = {
      timeStepS: 1e4,
      durationS: 3e7,
      bindingEnergyToleranceJPerKg: 2e8
    };
    const stateA: NBodyInitialState = {
      timeS: 0,
      bodies: [
        body('p1', m, null, { x: -2.5e11 - sep / 2, y: 1.5e10, z: 0 }, { x: 6e3, y: vi, z: 0 }),
        body('p2', m, null, { x: -2.5e11 + sep / 2, y: 1.5e10, z: 0 }, { x: 6e3, y: -vi, z: 0 }),
        body('q1', m, null, { x: 2.5e11 - sep / 2, y: -1.5e10, z: 0 }, { x: -6e3, y: vi, z: 0 }),
        body('q2', m, null, { x: 2.5e11 + sep / 2, y: -1.5e10, z: 0 }, { x: -6e3, y: -vi, z: 0 })
      ]
    };
    const reversed: NBodyInitialState = { timeS: 0, bodies: [...stateA.bodies].reverse() };
    const resultA = requireCompleted(integrateNBodyWithEvents(stateA, base));
    const resultB = requireCompleted(integrateNBodyWithEvents(reversed, base));
    expect(resultB.events).toEqual(resultA.events);
    expect(resultB.detection.initialConnectivityComponents).toBe(
      resultA.detection.initialConnectivityComponents
    );
  });

  it('граничные значения энергии относительно допуска проверены явно', () => {
    // Пара в покое на расстоянии d: eps = −G(m1+m2)/d ТОЧНО.
    // Толерантность = |eps|: ребро обязано отсутствовать (строгое
    // eps < −tol); чуть меньший толерантности — ребро есть; чуть
    // больший — ребра нет.
    const m = 1e12;
    const d = 100;
    const positions: Vector3[] = [
      { x: -d / 2, y: 0, z: 0 },
      { x: d / 2, y: 0, z: 0 }
    ];
    const velocities: Vector3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 }
    ];
    const pair = relativePairEnergy(m, m, positions[0], positions[1], velocities[0], velocities[1]);
    const eps = pair.specificOrbitalEnergyJPerKg;
    expect(eps).toBeLessThan(0);
    // Аналитическая проверка формулы на известной конфигурации.
    const analytic = -(G * (m + m)) / d;
    expect(Math.abs(eps - analytic)).toBeLessThanOrEqual(Math.abs(analytic) * 1e-12);

    const exactTol = -eps;
    expect(bindingGraphEdges(positions, velocities, [m, m], exactTol)).toEqual([false]);
    expect(bindingGraphEdges(positions, velocities, [m, m], exactTol * (1 - 1e-12))).toEqual([true]);
    expect(bindingGraphEdges(positions, velocities, [m, m], exactTol * (1 + 1e-12))).toEqual([false]);

    // Компоненты по рёбрам: полный граф — одна компонента, пустой — все
    // тела поодиночке, канонический порядок сохраняется.
    expect(componentsFromEdges(['b', 'a', 'c'], [true, true, true])).toEqual([['a', 'b', 'c']]);
    expect(componentsFromEdges(['b', 'a', 'c'], [false, false, false])).toEqual([
      ['a'],
      ['b'],
      ['c']
    ]);
    // Цепочка a—b, b—c, без a—c — одна компонента с членами в каноническом порядке.
    expect(componentsFromEdges(['b', 'a', 'c'], [false, true, true])).toEqual([['a', 'b', 'c']]);
  });
});

describe('Stage 4.6.1-C: детерминизм и сходимость', () => {
  it('сортировка событий детерминирована: время → приоритет типа → канонические ID', () => {
    const collision = {
      type: 'collision' as const,
      pairIdA: 'a',
      pairIdB: 'b',
      contactRadiusM: 1,
      contactTimeS: 2,
      contactStepFraction: 0.5,
      minimumDistanceM: 0.9
    };
    const approach = {
      type: 'close_approach' as const,
      pairIdA: 'a',
      pairIdB: 'b',
      thresholdM: 10,
      entryTimeS: 1,
      minimumTimeS: 2,
      minimumDistanceM: 5,
      exitTimeS: 3,
      ongoingAtHorizon: false
    };
    const connLost = {
      type: 'connectivity_lost' as const,
      eventTimeS: 2,
      componentsBefore: [['a', 'b', 'c']],
      componentsAfter: [['a', 'b'], ['c']],
      componentCountBefore: 1,
      componentCountAfter: 2,
      edgeChanges: [],
      energyToleranceJPerKg: 0,
      criterionModel: 'pairwise_osculating_binding_energy' as const
    };
    const connRestored = {
      type: 'connectivity_restored' as const,
      eventTimeS: 2,
      componentsBefore: [['a', 'b'], ['c']],
      componentsAfter: [['a', 'b', 'c']],
      componentCountBefore: 2,
      componentCountAfter: 1,
      edgeChanges: [],
      energyToleranceJPerKg: 0,
      criterionModel: 'pairwise_osculating_binding_energy' as const
    };
    const candidateP = {
      type: 'ejection_candidate' as const,
      bodyId: 'p',
      primaryBodyId: 'sun',
      crossingTimeS: 2,
      escapeRadiusM: 1e11,
      specificOrbitalEnergyAtCrossingJPerKg: 1,
      radialVelocityAtCrossingMPerS: 1,
      confirmationTimeS: null,
      eventTimeS: 2,
      cancelReason: null
    };
    const candidateQ = { ...candidateP, bodyId: 'q' };
    const cancelled = {
      type: 'ejection_cancelled' as const,
      bodyId: 'p',
      primaryBodyId: 'sun',
      crossingTimeS: 1,
      escapeRadiusM: 1e11,
      specificOrbitalEnergyAtCrossingJPerKg: 1,
      radialVelocityAtCrossingMPerS: 0,
      confirmationTimeS: null,
      eventTimeS: 2,
      cancelReason: 'radial_velocity_not_outward' as const
    };
    const confirmed = {
      type: 'ejection_confirmed' as const,
      bodyId: 'p',
      primaryBodyId: 'sun',
      crossingTimeS: 1,
      escapeRadiusM: 1e11,
      specificOrbitalEnergyAtCrossingJPerKg: 1,
      radialVelocityAtCrossingMPerS: 1,
      confirmationTimeS: 2,
      eventTimeS: 2,
      cancelReason: null
    };
    const input = [
      connRestored,
      confirmed,
      candidateQ,
      candidateP,
      connLost,
      cancelled,
      approach,
      collision
    ];
    const expected = [collision, approach, candidateP, candidateQ, cancelled, confirmed, connLost, connRestored];
    const sorted = sortDetectionEvents(input);
    expect(sorted).toEqual(expected);
    // Инверсия входа даёт тот же порядок.
    expect(sortDetectionEvents([...input].reverse())).toEqual(expected);
  });

  it('время пересечения escape radius сходится при уменьшении timestep', () => {
    const crossingAt = (dt: number): number => {
      const result = requireCompleted(
        integrateNBodyWithEvents(hyperbolicState(), {
          timeStepS: dt,
          durationS: 6e6,
          primaryBodyId: 'sun',
          escapeRadiusM: 4e11,
          escapeConfirmationDurationS: 1e6
        })
      );
      const cands = ejections(result.events).filter((e) => e.type === 'ejection_candidate');
      expect(cands).toHaveLength(1);
      return cands[0].crossingTimeS;
    };
    // Измерено: 4.176e6 (dt=8e3) → 4.180e6 → 4.182e6 → 4.183e6 (dt=1e3):
    // ошибка O(dt) и монотонно убывает.
    const t8k = crossingAt(8e3);
    const t4k = crossingAt(4e3);
    const t1k = crossingAt(1e3);
    const diffCoarse = Math.abs(t8k - t1k);
    const diffFine = Math.abs(t4k - t1k);
    expect(diffCoarse).toBeLessThanOrEqual(1e4);
    expect(diffFine).toBeLessThanOrEqual(diffCoarse);
    expect(diffFine).toBeGreaterThan(0);
  });

  it('время подтверждения выброса сходится при уменьшении timestep', () => {
    const confirmAt = (dt: number): number => {
      const result = requireCompleted(
        integrateNBodyWithEvents(hyperbolicState(), {
          timeStepS: dt,
          durationS: 6e6,
          primaryBodyId: 'sun',
          escapeRadiusM: 4e11,
          escapeConfirmationDurationS: 1e6
        })
      );
      const confirmed = ejections(result.events).filter((e) => e.type === 'ejection_confirmed');
      expect(confirmed).toHaveLength(1);
      return confirmed[0].confirmationTimeS as number;
    };
    // Подтверждение = пересечение + confirmation duration; сходимость
    // наследуется от сходимости времени пересечения (ошибка ≤ dt).
    const c8k = confirmAt(8e3);
    const c1k = confirmAt(1e3);
    expect(Math.abs(c8k - c1k)).toBeLessThanOrEqual(1e4);
  });
});
