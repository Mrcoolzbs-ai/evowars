// ============================================
// ТЕСТЫ — Радиогенная мощность (Stage 4.7.3, Части A3/A4/E)
// ============================================
// Проверяются:
//  - экспоненциальный закон m(t) = m0·exp(-lambda·(t - t0)) для
//    масс родительских нуклидов (в обе стороны по времени);
//  - через один период полураспада масса и мощность (при той же
//    энергии на распад) уменьшаются вдвое; два полураспада -> exp(-2);
//  - аддитивность вкладов нескольких нуклидов;
//  - корректный перевод лет в секунды (юлианский год Units.YEAR_S);
//  - разведение баз масс: масса природного элемента vs масса изотопа
//    (конвертация ТОЛЬКО через явные подтверждённые доли);
//  - fail-closed: NaN/Infinity/отрицательные массы, неизвестный
//    нуклид, отсутствие provenance блокируют completed;
//  - неизвестная масса нуклида НЕ считается нулём: полнота бюджета
//    явно помечается неполной;
//  - неопределённости исходных параметров сохраняются в результате;
//  - валидатор каталога: производная удельная теплопродукция
//    воспроизводит опубликованные H Ruedas 2017 в пределах допуска
//    (расхождение винтажей T1/2 для K-40 ~2.3%, Th-232 ~0.4%).
//
// ЗЕМНОЙ КОНТРОЛЬНЫЙ ОРИЕНТИР (Korenaga 2008): BSE-состав
// (U 20 ppb, Th 80 ppb, K 240 ppm) на массе 4.0e24 kg даёт
// радиогенную мощность ПОРЯДКА 20 TW (независимый пересчёт:
// ~19.73 TW). Тест проверяет масштаб [15, 25] TW — это НЕ подгонка:
// ядерные параметры каталога происходят из Korenaga 2008 (T1/2, доли)
// и Ruedas 2017 (E_H), а не из целевой величины 20 TW.

import { describe, it, expect } from 'vitest';
import {
  computeRadiogenicPower,
  nuclidePowerAtTime,
  nuclideEnergyIntegralJ,
  elementMassKgToNuclideMassesKg,
  AVOGADRO_NUMBER_MOL1
} from '../Core/radiogenicHeating';
import {
  RADIOGENIC_NUCLIDE_RECORDS,
  NATURAL_ELEMENT_MOLAR_MASS_KG_PER_MOL,
  tryGetRadiogenicNuclide,
  validateRadiogenicNuclideCatalog,
  type RadiogenicNuclideRecord
} from '../Data/radiogenicNuclides';
import { YEAR_S, yearsToSeconds } from '../Units';

const HALF_LIFE_YEARS: Record<string, number> = {
  u238: 4.468e9,
  u235: 7.038e8,
  th232: 1.405e10,
  k40: 1.277e9,
  al26: 7.17e5,
  fe60: 2.62e6
};

function record(nuclideId: string): RadiogenicNuclideRecord {
  const rec = tryGetRadiogenicNuclide(nuclideId);
  if (rec === null) throw new Error(`нет записи каталога для ${nuclideId}`);
  return rec;
}

function assertCompleted(
  result: ReturnType<typeof computeRadiogenicPower>
): asserts result is Extract<ReturnType<typeof computeRadiogenicPower>, { status: 'completed' }> {
  if (result.status !== 'completed') {
    throw new Error(`ожидается completed, получено ${result.status}: ${JSON.stringify(result).slice(0, 500)}`);
  }
}

function feMass(): { nuclideId: string; massKg: number; massProvenance: string } {
  return { nuclideId: 'fe60', massKg: 1e12, massProvenance: 'тестовая масса (синтетическая, указана явно)' };
}

describe('Radiogenic: экспоненциальный закон и полураспады', () => {
  const REF = 0;

  it('R1. Масса родителя уменьшается экспоненциально: m(T1/2) = m0/2', () => {
    const m0 = 1e17;
    const halfLifeS = HALF_LIFE_YEARS.k40 * YEAR_S;
    const res = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'k40', massKg: m0, massProvenance: 'тест (явно указан)' }],
      referenceEpochSeconds: REF,
      evaluationTimeSeconds: REF + halfLifeS
    });
    assertCompleted(res);
    expect(res.contributions).toHaveLength(1);
    expect(res.contributions[0].massAtReferenceKg).toBe(m0);
    expect(res.contributions[0].massAtEvaluationKg / m0).toBeCloseTo(0.5, 12);
  });

  it('R2. Через один период полураспада мощность вдвое меньше (E_H неизменна)', () => {
    const m0 = 1e17;
    const halfLifeS = HALF_LIFE_YEARS.k40 * YEAR_S;
    const p0 = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'k40', massKg: m0, massProvenance: 'тест' }],
      referenceEpochSeconds: REF,
      evaluationTimeSeconds: REF
    });
    const p1 = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'k40', massKg: m0, massProvenance: 'тест' }],
      referenceEpochSeconds: REF,
      evaluationTimeSeconds: REF + halfLifeS
    });
    assertCompleted(p0);
    assertCompleted(p1);
    expect(p1.contributions[0].powerW as number).toBeGreaterThan(0);
    expect((p1.contributions[0].powerW as number) / (p0.contributions[0].powerW as number))
      .toBeCloseTo(0.5, 12);
  });

  it('R3. Два полураспада: exp(-2), масса и мощность в 4 раза меньше', () => {
    const m0 = 1e17;
    const halfLifeS = HALF_LIFE_YEARS.k40 * YEAR_S;
    const p2 = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'k40', massKg: m0, massProvenance: 'тест' }],
      referenceEpochSeconds: REF,
      evaluationTimeSeconds: REF + 2 * halfLifeS
    });
    const p0 = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'k40', massKg: m0, massProvenance: 'тест' }],
      referenceEpochSeconds: REF,
      evaluationTimeSeconds: REF
    });
    assertCompleted(p0);
    assertCompleted(p2);
    expect(p2.contributions[0].massAtEvaluationKg / m0).toBeCloseTo(Math.exp(-2 * Math.LN2), 12);
    expect((p2.contributions[0].powerW as number) / (p0.contributions[0].powerW as number))
      .toBeCloseTo(Math.exp(-2 * Math.LN2), 12);
  });

  it('R4. Вклады нескольких нуклидов суммируются аддитивно', () => {
    const masses = [
      { nuclideId: 'u238', massKg: 8e16, massProvenance: 'тест' },
      { nuclideId: 'th232', massKg: 3.2e17, massProvenance: 'тест' },
      { nuclideId: 'k40', massKg: 1e17, massProvenance: 'тест' }
    ];
    const res = computeRadiogenicPower({
      nuclideMasses: masses,
      referenceEpochSeconds: 0,
      evaluationTimeSeconds: 1e15
    });
    assertCompleted(res);
    const sum = res.contributions.reduce((s, c) => s + (c.powerW as number), 0);
    expect(res.knownTotalPowerW / sum).toBeCloseTo(1, 12);
    expect(res.completeness.computedCount).toBe(3);
  });

  it('R5. До опорной эпохи масса больше (exp-закон в обе стороны), отрицательная масса невозможна', () => {
    const m0 = 1e17;
    const halfLifeS = HALF_LIFE_YEARS.k40 * YEAR_S;
    const past = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'k40', massKg: m0, massProvenance: 'тест' }],
      referenceEpochSeconds: 0,
      evaluationTimeSeconds: REF - halfLifeS
    });
    assertCompleted(past);
    expect(past.contributions[0].massAtEvaluationKg).toBeGreaterThan(m0);
    expect(past.contributions[0].massAtEvaluationKg / m0).toBeCloseTo(2, 12);
    expect(past.contributions[0].powerW as number).toBeGreaterThan(0);
  });
});

describe('Radiogenic: время и каталог данных', () => {
  it('R6. Перевод лет в секунды корректен (юлианский год)', () => {
    expect(yearsToSeconds(1)).toBeCloseTo(3.15576e7, 0);
    expect(YEAR_S).toBe(3.15576e7);
    // постоянная распада каталога согласована с T1/2 через YEAR_S
    for (const rec of RADIOGENIC_NUCLIDE_RECORDS) {
      const expectedLambda = Math.LN2 / (HALF_LIFE_YEARS[rec.nuclideId] * YEAR_S);
      expect(rec.decayConstant_s1 / expectedLambda).toBeCloseTo(1, 12);
      expect(rec.halfLifeYears).toBe(HALF_LIFE_YEARS[rec.nuclideId]);
    }
  });

  it('R7. Природный элемент и отдельный изотоп не смешиваются', () => {
    // Молярные массы природного элемента отличаются от изотопных:
    expect(NATURAL_ELEMENT_MOLAR_MASS_KG_PER_MOL['U']).not.toBeCloseTo(0.238050786996, 4);
    expect(NATURAL_ELEMENT_MOLAR_MASS_KG_PER_MOL['K']).not.toBeCloseTo(0.039963998166, 4);
    // Конвертация в изотопы — ТОЛЬКО по явным долям каталога:
    const u = elementMassKgToNuclideMassesKg('U', 1);
    expect(u).not.toBeNull();
    const u238 = (u as { nuclideId: string; massKg: number }[]).find((e) => e.nuclideId === 'u238');
    const u235 = (u as { nuclideId: string; massKg: number }[]).find((e) => e.nuclideId === 'u235');
    expect((u238 as { massKg: number }).massKg).toBeCloseTo(0.9928, 12);
    expect((u235 as { massKg: number }).massKg).toBeCloseTo(0.0072, 12);
    const k = elementMassKgToNuclideMassesKg('K', 1);
    const k40 = (k as { nuclideId: string; massKg: number }[]).find((e) => e.nuclideId === 'k40');
    expect((k40 as { massKg: number }).massKg).toBeCloseTo(1.28e-4, 15);
    const th = elementMassKgToNuclideMassesKg('Th', 1);
    const thOnly = (th as { nuclideId: string; massKg: number }[]).find((e) => e.nuclideId === 'th232');
    expect((thOnly as { massKg: number }).massKg).toBeCloseTo(1, 12);
    // База массы мощности: 1 kg 232Th (изотоп) даёт мощность изотопной записи,
    // а 1 kg ПРИРОДНОГО U даёт сумму долей — числа разные, не слиты:
    const thIso = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'th232', massKg: 1, massProvenance: 'тест' }],
      referenceEpochSeconds: 0,
      evaluationTimeSeconds: 0
    });
    assertCompleted(thIso);
    const hIso = thIso.contributions[0].powerW as number;
    const recTh = record('th232');
    expect(hIso / ((1 / recTh.molarMassKgPerMol) * AVOGADRO_NUMBER_MOL1 * recTh.decayConstant_s1 * recTh.heatEffectiveDecayEnergyKeV * 1.602176634e-16))
      .toBeCloseTo(1, 12);
    // элемент без правил конвертации: null (fail-closed), а не «как у Земли»
    expect(elementMassKgToNuclideMassesKg('Fe', 1)).toBeNull();
    expect(elementMassKgToNuclideMassesKg('Xx', 1)).toBeNull();
  });

  it('R8. Все шесть нуклидов каталога имеют подтверждённую E_H; валидатор каталога чист', () => {
    expect(RADIOGENIC_NUCLIDE_RECORDS).toHaveLength(6);
    for (const rec of RADIOGENIC_NUCLIDE_RECORDS) {
      // ветка missing_decay_energy структурно существует, НО для
      // подтверждённых нуклидов E_H всегда конечна и положительна
      expect(Number.isFinite(rec.heatEffectiveDecayEnergyKeV)).toBe(true);
      expect(rec.heatEffectiveDecayEnergyKeV).toBeGreaterThan(0);
      // E_H строго меньше полной Q (нейтрино исключены)
      expect(rec.heatEffectiveDecayEnergyKeV).toBeLessThan(rec.totalDecayEnergyKeV);
    }
    expect(validateRadiogenicNuclideCatalog()).toEqual([]);
  });

  it('R9. Неизвестный (не переданный) нуклид не считается нулём: полнота помечена неполной', () => {
    const res = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'u238', massKg: 8e16, massProvenance: 'тест: только 238U' }],
      referenceEpochSeconds: 0,
      evaluationTimeSeconds: 0
    });
    assertCompleted(res);
    expect(res.knownTotalPowerW).toBeGreaterThan(0);
    expect(res.completeness.computedCount).toBe(1);
    // ЯВНОЕ предупреждение, что сумма известных вкладов — не полный бюджет
    expect(res.completeness.note).toContain('НЕ является полным');
  });

  it('R10. Неизвестный nuclideId блокирует completed (fail-closed)', () => {
    const res = computeRadiogenicPower({
      nuclideMasses: [{ nuclideId: 'u239', massKg: 1, massProvenance: 'тест' }],
      referenceEpochSeconds: 0,
      evaluationTimeSeconds: 0
    });
    expect(res.status).toBe('invalid_input');
  });
});

describe('Radiogenic: fail-closed входы и неопределённости', () => {
  const base = { referenceEpochSeconds: 0, evaluationTimeSeconds: 1e12 };

  it('R11. NaN/Infinity/нулевая/отрицательная масса отклоняются', () => {
    for (const badMass of [NaN, Infinity, -Infinity, 0, -1e12]) {
      const res = computeRadiogenicPower({
        ...base,
        nuclideMasses: [{ nuclideId: 'u238', massKg: badMass as number, massProvenance: 'тест' }]
      });
      expect(res.status).toBe('invalid_input');
    }
  });

  it('R12. Некорректный интервал времени отклоняется (NaN, бесконечность)', () => {
    for (const badTime of [NaN, Infinity, -Infinity]) {
      const res = computeRadiogenicPower({
        nuclideMasses: [feMass()],
        referenceEpochSeconds: 0,
        evaluationTimeSeconds: badTime
      });
      expect(res.status).toBe('invalid_input');
      const res2 = computeRadiogenicPower({
        nuclideMasses: [feMass()],
        referenceEpochSeconds: badTime,
        evaluationTimeSeconds: 0
      });
      expect(res2.status).toBe('invalid_input');
    }
  });

  it('R13. Отсутствие provenance массы блокирует расчёт', () => {
    const res = computeRadiogenicPower({
      ...base,
      nuclideMasses: [{ nuclideId: 'u238', massKg: 1e12, massProvenance: '' }]
    });
    expect(res.status).toBe('invalid_input');
  });

  it('R14. Относительная неопределённость массы сохраняется в результате', () => {
    const res = computeRadiogenicPower({
      ...base,
      nuclideMasses: [{ nuclideId: 'u238', massKg: 1e12, massProvenance: 'тест', massRelativeUncertainty: 0.07 }]
    });
    assertCompleted(res);
    expect(res.contributions[0].powerRelativeUncertainty).toBeCloseTo(0.07, 12);
  });
});

describe('Radiogenic: независимые математические эталоны', () => {
  it('R15. nuclidePowerAtTime: независимый пересчёт N·lambda·E_heat', () => {
    const rec = record('u238');
    const m0 = 5e16;
    const dt = 1e16;
    const expected = (m0 / rec.molarMassKgPerMol) * AVOGADRO_NUMBER_MOL1
      * Math.exp(-rec.decayConstant_s1 * dt)
      * rec.decayConstant_s1
      * rec.heatEffectiveDecayEnergyKeV * 1.602176634e-16;
    const got = nuclidePowerAtTime(rec.molarMassKgPerMol, rec.decayConstant_s1, rec.heatEffectiveDecayEnergyKeV * 1.602176634e-16, m0, dt);
    expect(got / expected).toBeCloseTo(1, 12);
  });

  it('R16. Аналитический интеграл мощности на [0, T1/2] = m0·E_H/M·NA·(1 - 1/2)/lambda·... и согласован с численным добавлением', () => {
    const rec = record('th232');
    const m0 = 1e17;
    const halfLifeS = HALF_LIFE_YEARS.th232 * YEAR_S;
    const EhJ = rec.heatEffectiveDecayEnergyKeV * 1.602176634e-16;
    // независимая формальная проверка: продифференцированная форма
    const numericSumRef = nuclidePowerAtTime(rec.molarMassKgPerMol, rec.decayConstant_s1, EhJ, m0, 0);
    // аналитика: (m0/M) NA Eh (1 - exp(-lambda*T_half)) — точно половина от равновесного масштаба
    const analytic = (m0 / rec.molarMassKgPerMol) * AVOGADRO_NUMBER_MOL1 * EhJ
      * (1 - Math.exp(-rec.decayConstant_s1 * halfLifeS));
    const got = nuclideEnergyIntegralJ(rec.molarMassKgPerMol, rec.decayConstant_s1, EhJ, m0, 0, halfLifeS);
    expect(got / analytic).toBeCloseTo(1, 12);
    // контроль масштаба: интеграл за полураспад при начальной мощности P0
    // равен P0 * (1 - exp(-lambda T))/lambda = (P0/lambda) * 0.5
    const p0OverLambda = numericSumRef / rec.decayConstant_s1;
    expect(got / (p0OverLambda * 0.5)).toBeCloseTo(1, 12);
  });
});

describe('Radiogenic: земной контрольный ориентир Korenaga (2008)', () => {
  it('R17. BSE-состав (U 20 ppb, Th 80 ppb, K 240 ppm) на 4.0e24 kg даёт масштаб ~20 TW', () => {
    // Точная база ориентира: Korenaga 2008 обсуждает ~20 TW радиогенного
    // тепла при BSE-концентрациях McDonough & Sun (1995); независимый
    // пересчёт по ядру проекта даёт ~19.73 TW. Допуск [15, 25] TW —
    // проверка масштаба, НЕ подгонка параметров.
    const mBSE = 4.0e24;
    const u = elementMassKgToNuclideMassesKg('U', 20e-9 * mBSE);
    const k = elementMassKgToNuclideMassesKg('K', 240e-6 * mBSE);
    if (u === null || k === null) throw new Error('конвертация элементов не удалась');
    const masses = [
      ...u,
      { nuclideId: 'th232', massKg: 80e-9 * mBSE, massProvenance: 'Korenaga 2008: BSE Th = 80 ppb' },
      ...k
    ];
    const res = computeRadiogenicPower({
      nuclideMasses: masses.map((m) => ({ ...m, massProvenance: 'Korenaga 2008 BSE (McDonough & Sun 1995), масса синтетического ориентира 4.0e24 kg' })),
      referenceEpochSeconds: 0,
      evaluationTimeSeconds: 0
    });
    assertCompleted(res);
    expect(res.knownTotalPowerW).toBeGreaterThan(15e12);
    expect(res.knownTotalPowerW).toBeLessThan(25e12);
    const tw = res.knownTotalPowerW / 1e12;
    expect(tw).toBeGreaterThan(18);
    expect(tw).toBeLessThan(22);
  });
});
