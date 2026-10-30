// ============================================
// TESTS - PhaseEquilibrium (этап 3: фазовые переходы)
// ============================================

import { describe, it, expect } from 'vitest';
import {
  saturationPressure,
  checkComponentPhase,
  analyzeAtmospherePhases,
  createEmptyReservoirs,
  transferSubstance,
  totalSubstanceAmount,
  raoultScreening,
  MIXTURE_LIMITATION_MESSAGE,
  EOS_NOT_IMPLEMENTED_NOTE
} from '../PhaseEquilibrium';
import { computeAtmospherePhysicalModel } from '../Atmosphere';
import { createAtmosphere, getAllPresets } from '../Atmosphere';
import { createRandom } from '../Generator/random';

describe('PhaseEquilibrium (фазовые переходы, этап 3)', () => {
  describe('уравнение Антуана в пределах области применимости', () => {
    it('метан при 111.66 K (нормальная точка кипения) даёт P_sat ≈ 1 атм', () => {
      // Prydz & Goodwin 1972, диапазон 90.99–189.99 K (NIST C74828).
      const result = saturationPressure('ch4', 111.66);
      expect(result.pressurePa).not.toBeNull();
      expect(result.extrapolated).toBe(false);
      const atm = (result.pressurePa as number) / 101325;
      expect(atm).toBeGreaterThan(0.95);
      expect(atm).toBeLessThan(1.05);
      expect(result.source).toContain('webbook.nist.gov');
    });

    it('этан при 184.55 K даёт P_sat ≈ 1 атм (набор Loomis & Walters)', () => {
      const result = saturationPressure('c2h6', 184.55);
      expect(result.pressurePa).not.toBeNull();
      expect(result.extrapolated).toBe(false);
      const atm = (result.pressurePa as number) / 101325;
      expect(atm).toBeGreaterThan(0.95);
      expect(atm).toBeLessThan(1.05);
    });

    it('метан при 95 K даёт P_sat ≈ 0.2 бар (холодный мир)', () => {
      const result = saturationPressure('ch4', 95);
      expect(result.pressurePa).not.toBeNull();
      const bar = (result.pressurePa as number) / 1e5;
      expect(bar).toBeGreaterThan(0.18);
      expect(bar).toBeLessThan(0.22);
    });

    it('для вещества без корреляции давление насыщенного пара не выдумывается', () => {
      // У азота нет коэффициентов Антуана в справочнике модели.
      const result = saturationPressure('n2', 95);
      expect(result.pressurePa).toBeNull();
      expect(result.confidence).toBe('unknown');
    });
  });

  describe('поведение за пределами области применимости', () => {
    it('экстраполяция помечена: расчёт вне диапазона корреляции предупреждает', () => {
      // Метан при 250 K: выше диапазона Антуана (max 189.99 K), ниже критической (190.56 K).
      const result = saturationPressure('ch4', 189.99 + 0.1);
      expect(result.extrapolated).toBe(true);
      expect(result.warning).not.toBeNull();
      expect(result.warning).toContain('ВНЕ экспериментального диапазона');
      expect(result.confidence).toBe('estimated');
    });

    it('выше критической температуры жидкой фазы нет', () => {
      // Критическая точка метана ~190.56 K.
      const result = saturationPressure('ch4', 200);
      expect(result.pressurePa).toBeNull();
      expect(result.note).toContain('критической');
    });

    it('ниже тройной точки возможно выпадение твёрдой фазы', () => {
      // Тройная точка метана ~90.69 K.
      const result = saturationPressure('ch4', 85);
      expect(result.pressurePa).toBeNull();
      expect(result.warning).toContain('твёрдой фазы');
    });
  });

  describe('скрининг фазового состояния компонентов', () => {
    it('S = p_i / P_sat ≥ 1 обнаруживает потенциальную конденсацию', () => {
      // Метан: 60% от 1.5 атм = 0.9 атм при 95 K, P_sat ≈ 0.2 атм → S ≈ 4.5.
      const analysis = checkComponentPhase({
        gasId: 'ch4',
        partialPressurePa: 0.9 * 101325,
        temperatureK: 95
      });
      expect(analysis.state).toBe('potentially_condensing');
      expect(analysis.screeningRatio as number).toBeGreaterThan(4);
      expect(analysis.screeningRatio as number).toBeLessThan(5);
      // Точное количество конденсата НЕ заявляется.
      expect(analysis.message).toContain(MIXTURE_LIMITATION_MESSAGE);
      expect(analysis.message).toContain('не рассчитаны');
    });

    it('S < 1: газовая фаза (скрининговая оценка)', () => {
      // Метан с низким парциальным давлением при 111 K.
      const analysis = checkComponentPhase({
        gasId: 'ch4',
        partialPressurePa: 1000,
        temperatureK: 111.66
      });
      expect(analysis.state).toBe('gas');
      expect(analysis.screeningRatio as number).toBeLessThan(1);
    });

    it('ниже тройной точки сообщается о возможном выпадении твёрдой фазы', () => {
      const analysis = checkComponentPhase({
        gasId: 'ch4',
        partialPressurePa: 101325,
        temperatureK: 85
      });
      expect(analysis.state).toBe('potential_solid_deposition');
    });

    it('без парциального давления или температуры состояние неизвестно', () => {
      expect(checkComponentPhase({ gasId: 'ch4', partialPressurePa: null, temperatureK: 95 }).state)
        .toBe('unknown');
      expect(checkComponentPhase({ gasId: 'ch4', partialPressurePa: 101325, temperatureK: null }).state)
        .toBe('unknown');
      expect(checkComponentPhase({ gasId: 'unknown_gas', partialPressurePa: 101325, temperatureK: 95 }).state)
        .toBe('unknown');
    });

    it('скрининг не выдаёт точный расчёт жидкости для реальной смеси', () => {
      const analysis = checkComponentPhase({
        gasId: 'ch4',
        partialPressurePa: 0.9 * 101325,
        temperatureK: 95
      });
      expect(analysis.message).not.toMatch(/(масса|количество) конденсата: \d/);
      expect(EOS_NOT_IMPLEMENTED_NOTE).toContain('не реализовано');
    });
  });

  describe('скрининг полной атмосферы', () => {
    it('исторический метаново-этановый пресет даёт предупреждения о конденсации при 95 K', () => {
      const atmosphere = getAllPresets()['methane_ethane'];
      const model = computeAtmospherePhysicalModel(atmosphere, { surfaceGravityMs2: 9.8 });
      const analysis = analyzeAtmospherePhases(model, atmosphere.temperature ?? null);

      const ch4 = analysis.components.find(c => c.gasId === 'ch4');
      const c2h6 = analysis.components.find(c => c.gasId === 'c2h6');
      expect(ch4?.state).toBe('potentially_condensing');
      expect(c2h6?.state).toBe('potentially_condensing');
      expect(analysis.hasPotentialTransitions).toBe(true);
      expect(analysis.warnings.length).toBeGreaterThan(0);
      expect(analysis.mixtureNote).toContain('равновесия смеси');
    });

    it('изменение температуры меняет фазовые предупреждения', () => {
      const atmosphere = getAllPresets()['methane_ethane'];
      const model = computeAtmospherePhysicalModel(atmosphere, { surfaceGravityMs2: 9.8 });
      const cold = analyzeAtmospherePhases(model, 95);
      const hot = analyzeAtmospherePhases(model, 190.5);
      // У порога критической точки метана конденсация исчезает.
      expect(cold.hasPotentialTransitions).toBe(true);
      expect(hot.components.find(c => c.gasId === 'ch4')?.state).not.toBe('potentially_condensing');
    });

    it('сгенерированная атмосфера мира проходит фазовый скрининг целиком', () => {
      const atmosphere = createAtmosphere('methane_ethane', createRandom('phase_seed'));
      const model = computeAtmospherePhysicalModel(atmosphere, { surfaceGravityMs2: 9.8 });
      const analysis = analyzeAtmospherePhases(model, atmosphere.temperature ?? null);
      expect(analysis.components.length).toBe(Object.keys(model.partialPressuresPa).length);
      for (const component of analysis.components) {
        expect(['gas', 'potentially_condensing', 'potential_solid_deposition',
          'no_condensation_above_critical', 'unknown']).toContain(component.state);
      }
    });
  });

  describe('резервуары вещества и перенос между фазами', () => {
    it('перенос сохраняет общее количество вещества', () => {
      const reservoirs = {
        ...createEmptyReservoirs(),
        atmospheric: { ch4: 100 }
      };
      const result = transferSubstance(reservoirs, 'ch4', 'atmospheric', 'liquidSurface', 60);
      expect(result.success).toBe(true);
      expect(totalSubstanceAmount(result.reservoirs, 'ch4')).toBeCloseTo(100, 10);
      expect(result.reservoirs.atmospheric.ch4).toBeCloseTo(40, 10);
      expect(result.reservoirs.liquidSurface.ch4).toBeCloseTo(60, 10);
    });

    it('обратный перенос (испарение) возвращает вещество в атмосферу', () => {
      let reservoirs = {
        ...createEmptyReservoirs(),
        atmospheric: { ch4: 100 }
      };
      reservoirs = transferSubstance(reservoirs, 'ch4', 'atmospheric', 'liquidSurface', 60).reservoirs;
      reservoirs = transferSubstance(reservoirs, 'ch4', 'liquidSurface', 'atmospheric', 25).reservoirs;
      expect(totalSubstanceAmount(reservoirs, 'ch4')).toBeCloseTo(100, 10);
      expect(reservoirs.atmospheric.ch4).toBeCloseTo(65, 10);
      expect(reservoirs.liquidSurface.ch4).toBeCloseTo(35, 10);
    });

    it('перенос невозможен при недостатке вещества в источнике', () => {
      const reservoirs = {
        ...createEmptyReservoirs(),
        atmospheric: { ch4: 10 }
      };
      const result = transferSubstance(reservoirs, 'ch4', 'atmospheric', 'solidDeposits', 50);
      expect(result.success).toBe(false);
      expect(result.reason).toContain('недостаточно вещества');
      // Состояние не изменилось.
      expect(totalSubstanceAmount(result.reservoirs, 'ch4')).toBeCloseTo(10, 10);
    });

    it('отрицательный перенос запрещён', () => {
      const reservoirs = createEmptyReservoirs();
      const result = transferSubstance(reservoirs, 'ch4', 'atmospheric', 'liquidSurface', -5);
      expect(result.success).toBe(false);
    });

    it('сконденсированное вещество не исчезает: сумма по резервуарам постоянна при цепочке переходов', () => {
      let reservoirs = {
        ...createEmptyReservoirs(),
        atmospheric: { ch4: 1000, n2: 500 }
      };
      reservoirs = transferSubstance(reservoirs, 'ch4', 'atmospheric', 'liquidSurface', 300).reservoirs;
      reservoirs = transferSubstance(reservoirs, 'ch4', 'liquidSurface', 'solidDeposits', 100).reservoirs;
      reservoirs = transferSubstance(reservoirs, 'ch4', 'solidDeposits', 'subsurfaceLiquid', 40).reservoirs;
      expect(totalSubstanceAmount(reservoirs, 'ch4')).toBeCloseTo(1000, 10);
      expect(totalSubstanceAmount(reservoirs, 'n2')).toBeCloseTo(500, 10);
    });
  });

  describe('интерфейс расширенных моделей', () => {
    it('закон Рауля доступен с явным предупреждением об идеальности', () => {
      const result = raoultScreening('ch4', 0.5, 95);
      expect(result.raoultPartialPressurePa).not.toBeNull();
      expect((result.raoultPartialPressurePa as number)).toBeCloseTo(0.5 * (result.pressurePa as number), 8);
      expect(result.idealWarning).toContain('идеализированное приближение');
      expect(result.idealWarning).toContain('Peng–Robinson');
    });
  });
});
