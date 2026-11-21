// ============================================
// ТЕСТЫ Stage 4.8.2.1: спектральная непрозрачность атмосферы
// ============================================
//
// 28 сценариев: 1-25 - обязательные сценарии ТЗ §9;
// 26 - реальные якоря molparam (массы/распространённости/Q296);
// 27 - линейная интерполяция partition sum внутри диапазона;
// 28 - независимый контроль профиля Фойгта квадратурой ядра K(x,y).
//
// ВСЕ спектральные линии в этом файле - синтетические фикстуры,
// явно помеченные provenance 'synthetic test fixture, NOT HITRAN'.
// Реальные записи линий HITRAN/HITEMP не подтверждены
// (HITRAN_LINE_LIST_STATUS, not_verifiable); синтетика НЕ подменяет
// этот референсный уровень.

import { describe, it, expect } from 'vitest';
import {
  computeSpectralOpacity,
  dopplerHwhmCm1,
  lorentzHwhmCm1,
  partitionSumAtTemperature,
  temperatureIntensityRatio,
  isotopeScaleFactor,
  voigtProfileCm,
  SPECTRAL_OPACITY_DEFAULTS,
  type SpectralLineRecord,
  type SpectralOpacityInput,
  type SpectralOpacitySpeciesSpec,
  type PartitionSumRecord
} from '../Core/spectralOpacity';
import {
  MOLPARAM_FRAGMENT_BY_ISO,
  HITRAN_SPECTRAL_CONSTANTS,
  HITRAN_LINE_LIST_STATUS
} from '../Data/spectralOpacityReferenceData';
import { ATM_TO_PA } from '../Units';

// ============================================
// СИНТЕТИЧЕСКИЕ ФИКСТУРЫ (НЕ HITRAN)
// ============================================

const SYNTHETIC_PROVENANCE = {
  sourceName: 'synthetic test fixture',
  sourceId: 'stage-4.8.2.1-tests',
  method: 'рукописные параметры для численных тестов; НЕ данные HITRAN/HITEMP; физическая валидность not_verifiable',
  limitations: 'см. HITRAN_LINE_LIST_STATUS'
} as const;

function syntheticLine(overrides: Partial<SpectralLineRecord> & { lineId: string }): SpectralLineRecord {
  return {
    moleculeId: 'TEST',
    isotopologueId: '161',
    wavenumberCm1: 1000,
    intensityCmPerMoleculeAtRef: 1e-20,
    lowerStateEnergyCm1: 0,
    broadening: {
      self: { gammaCm1PerAtmAtRef: 0.1, temperatureExponent: 0.5 },
      air: { gammaCm1PerAtmAtRef: 0.07, temperatureExponent: 0.68 },
      n2: { gammaCm1PerAtmAtRef: 0.08, temperatureExponent: 0.6 },
      o2: { gammaCm1PerAtmAtRef: 0.05, temperatureExponent: 0.65 },
      he: { gammaCm1PerAtmAtRef: 0.03, temperatureExponent: 0.7 }
    },
    pressureShift: {
      self: { shiftCm1PerAtmAtRef: -0.01 },
      air: { shiftCm1PerAtmAtRef: -0.005 }
    },
    intensityIncludesTerrestrialAbundance: true,
    provenance: SYNTHETIC_PROVENANCE,
    ...overrides
  };
}

function singlePointPartitionSum(iso: string): PartitionSumRecord {
  const mp = MOLPARAM_FRAGMENT_BY_ISO.get(iso);
  if (!mp) throw new Error(`нет molparam записи для ${iso}`);
  return {
    isotopologueId: iso,
    points: [{ temperatureK: 296, partitionSum: mp.partitionSumAt296K }],
    provenance: mp.provenance
  };
}

function rangedPartitionSum(iso: string, points: { temperatureK: number; partitionSum: number }[]): PartitionSumRecord {
  return { isotopologueId: iso, points, provenance: SYNTHETIC_PROVENANCE };
}

function speciesH2o(overrides: Partial<SpectralOpacitySpeciesSpec> = {}): SpectralOpacitySpeciesSpec {
  return {
    gasId: 'h2o',
    isotopologueId: '161',
    lines: [syntheticLine({ lineId: 'L1' })],
    partitionSum: singlePointPartitionSum('161'),
    ...overrides
  };
}

function baseInput(
  overrides: {
    pressurePa?: number;
    temperatureK?: number;
    species?: SpectralOpacitySpeciesSpec[];
    broadeners?: { gasId: string; moleFraction: number }[];
    grid?: SpectralOpacityInput['grid'];
    isotopicScaleMode?: 'terrestrial-assumption' | 'explicit-ratio';
  } = {}
): SpectralOpacityInput {
  return {
    pressurePa: overrides.pressurePa ?? ATM_TO_PA,
    temperatureK: overrides.temperatureK ?? 296,
    species: overrides.species ?? [speciesH2o()],
    broadeners:
      overrides.broadeners ??
      [
        { gasId: 'h2o', moleFraction: 0.01 },
        { gasId: 'n2', moleFraction: 0.75 },
        { gasId: 'o2', moleFraction: 0.24 }
      ],
    grid: overrides.grid ?? { startWavenumberCm1: 999.75, endWavenumberCm1: 1000.25, stepCm1: 0.001 },
    ...(overrides.isotopicScaleMode !== undefined ? { isotopicScaleMode: overrides.isotopicScaleMode } : {})
  };
}

const maxOf = (arr: readonly number[]): number => arr.reduce((m, v) => Math.max(m, v), -Infinity);

// ============================================
// 1-4: Температурная поправка интенсивности (S(T))
// ============================================

describe('Температурная поправка интенсивности (S(T))', () => {
  const ratioInput = (t: number, qT: number, qRef: number) => ({
    wavenumberCm1: 1000,
    lowerStateEnergyCm1: 50,
    temperatureK: t,
    referenceTemperatureK: 296,
    partitionSumAtT: qT,
    partitionSumAtRef: qRef
  });

  it('1. при T = T_ref возвращает исходную интенсивность', () => {
    const q = 1.7458e2;
    const ratio = temperatureIntensityRatio(ratioInput(296, q, q));
    // exp(-c2*E''*0) = 1; (1-exp(-c2*v/296))/(тот же) = 1; Q/Q = 1
    expect(ratio).toBe(1);
    // Ядро: расчёт при T_ref воспроизводит входную интенсивность.
    const result = computeSpectralOpacity(baseInput({ temperatureK: 296 }));
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.linesUsed[0].intensityCmPerMoleculeAtT).toBeCloseTo(1e-20, 25);
      expect(result.linesUsed[0].intensityCmPerMoleculeAtT).toBeGreaterThan(0);
    }
  });

  it('2. соответствует аналитической формуле при T != T_ref', () => {
    const c2 = 1.4387769;
    const nu = 1000;
    const epp = 50;
    const qT = 200;
    const qRef = 1.7458e2;
    const expected =
      (qRef / qT) *
      Math.exp(-c2 * epp * (1 / 250 - 1 / 296)) *
      ((1 - Math.exp((-c2 * nu) / 250)) / (1 - Math.exp((-c2 * nu) / 296)));
    expect(temperatureIntensityRatio(ratioInput(250, qT, qRef))).toBeCloseTo(expected, 13);
  });

  it('3. изменение partition sum корректно влияет на интенсивность', () => {
    const withQLow = temperatureIntensityRatio(ratioInput(250, 100, 1.7458e2));
    const withQHigh = temperatureIntensityRatio(ratioInput(250, 200, 1.7458e2));
    expect(withQHigh).toBeCloseTo(withQLow / 2, 12); // S ~ Q(Tref)/Q(T)
    const withQRefDoubled = temperatureIntensityRatio(ratioInput(250, 1.7458e2, 349.16));
    const withQRefBase = temperatureIntensityRatio(ratioInput(250, 1.7458e2, 1.7458e2));
    expect(withQRefDoubled).toBeCloseTo(withQRefBase * 2, 12);
  });

  it('4. температура за пределом данных partition sum блокируется', () => {
    const result = computeSpectralOpacity(
      baseInput({
        temperatureK: 296,
        species: [
          speciesH2o({
            partitionSum: rangedPartitionSum('161', [
              { temperatureK: 200, partitionSum: 100 },
              { temperatureK: 250, partitionSum: 150 }
            ])
          })
        ]
      })
    );
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.reason).toContain('вне диапазона');
      expect(result.missingParameters?.[0]).toContain('partition sum');
    }
  });
});

// ============================================
// 5-10: Уширения
// ============================================

describe('Уширение линий', () => {
  it('5. доплеровская ширина корректно зависит от T и массы', () => {
    const mass = 18.010565;
    // alpha_D ~ sqrt(T) при фиксированных nu, M
    const g273 = dopplerHwhmCm1({ wavenumberCm1: 1000, temperatureK: 273, molarMassGPerMol: mass });
    const g546 = dopplerHwhmCm1({ wavenumberCm1: 1000, temperatureK: 546, molarMassGPerMol: mass });
    expect(g546 / g273).toBeCloseTo(Math.sqrt(2), 12);
    // alpha_D ~ 1/sqrt(M) при фиксированных nu, T
    const gHeavier = dopplerHwhmCm1({ wavenumberCm1: 1000, temperatureK: 273, molarMassGPerMol: mass * 4 });
    expect(gHeavier).toBeCloseTo(g273 / 2, 12);
    // Абсолютное значение: alpha_D = nu/c * sqrt(2*R_u*T*ln2*1000/M)
    const expected =
      (1000 * Math.sqrt((2 * 8.31446261815324 * 273 * Math.LN2 * 1000) / mass)) / 2.99792458e8;
    expect(g273).toBeCloseTo(expected, 13);
  });

  it('6. лоренцева ширина пропорциональна парциальному давлению при неизменной T', () => {
    const widths = [0.1, 0.5, 1.0].map((pAtm) =>
      lorentzHwhmCm1({
        temperatureK: 296,
        referenceTemperatureK: 296,
        partials: [{ gammaCm1PerAtmAtRef: 0.07, temperatureExponent: 0.68, partialPressureAtm: pAtm }]
      })
    );
    expect(widths[1] / widths[0]).toBeCloseTo(5, 12);
    expect(widths[2] / widths[0]).toBeCloseTo(10, 12);
  });

  it('7. разные уширители дают разные ширины при разных коэффициентах', () => {
    const pAtm = 0.5;
    const gammaN2 = lorentzHwhmCm1({ temperatureK: 296, referenceTemperatureK: 296, partials: [{ gammaCm1PerAtmAtRef: 0.08, temperatureExponent: 0.6, partialPressureAtm: pAtm }] });
    const gammaHe = lorentzHwhmCm1({ temperatureK: 296, referenceTemperatureK: 296, partials: [{ gammaCm1PerAtmAtRef: 0.03, temperatureExponent: 0.7, partialPressureAtm: pAtm }] });
    expect(gammaN2 / gammaHe).toBeCloseTo(0.08 / 0.03, 12);
  });

  it('8. self-broadening и foreign-broadening не смешиваются', () => {
    const pAtm = 0.3;
    const selfOnly = computeSpectralOpacity(
      baseInput({ broadeners: [{ gasId: 'h2o', moleFraction: pAtm }] })
    );
    const foreignOnly = computeSpectralOpacity(
      baseInput({
        species: [
          speciesH2o({
            lines: [syntheticLine({ lineId: 'L1', broadening: { n2: { gammaCm1PerAtmAtRef: 0.08, temperatureExponent: 0.6 } } })]
          })
        ],
        // Доля h2o = 0: self-вклад отсутствует, концентрация поглотителя известна (ноль).
        broadeners: [{ gasId: 'h2o', moleFraction: 0 }, { gasId: 'n2', moleFraction: pAtm }]
      })
    );
    expect(selfOnly.status).toBe('completed');
    expect(foreignOnly.status).toBe('completed');
    if (selfOnly.status === 'completed' && foreignOnly.status === 'completed') {
      const selfLine = selfOnly.linesUsed[0];
      const foreignLine = foreignOnly.linesUsed[0];
      expect(selfLine.broadenersUsed).toHaveLength(1);
      expect(selfLine.broadenersUsed[0].gasId).toContain('self');
      expect(selfLine.broadenersUsed[0].gammaCm1).toBeCloseTo(0.1 * pAtm, 12);
      expect(foreignLine.broadenersUsed[0].gasId).toBe('n2');
      expect(foreignLine.broadenersUsed[0].gammaCm1).toBeCloseTo(0.08 * pAtm, 12);
      // Пики сечений строго различаются (gamma 0.03 vs 0.024 cm-1).
      const peakSelf = maxOf(selfOnly.crossSectionM2PerMolecule);
      const peakForeign = maxOf(foreignOnly.crossSectionM2PerMolecule);
      expect(Math.abs(peakSelf - peakForeign) / peakSelf).toBeGreaterThan(0.1);
    }
  });

  it('9. неизвестный коэффициент уширения НЕ заменяется air-broadening', () => {
    const result = computeSpectralOpacity(
      baseInput({
        species: [
          speciesH2o({
            lines: [syntheticLine({ lineId: 'L1', broadening: { self: { gammaCm1PerAtmAtRef: 0.1, temperatureExponent: 0.5 } } })]
          })
        ],
        broadeners: [
          { gasId: 'h2o', moleFraction: 0.01 },
          { gasId: 'co2', moleFraction: 0.5 }
        ]
      })
    );
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.reason).toContain('коэффициенты уширения');
      expect(result.missingParameters?.join(' ')).toContain('co2');
      // В отсутствующих параметрах нет замены на air-broadening.
      expect(result.missingParameters?.join(' ')).not.toContain('air');
    }
  });

  it('10.давленческий сдвиг работает только при известном коэффициенте', () => {
    const withShift = computeSpectralOpacity(
      baseInput({
        species: [
          speciesH2o({
            lines: [syntheticLine({ lineId: 'L1', pressureShift: { n2: { shiftCm1PerAtmAtRef: -0.02 } } })]
          })
        ]
      })
    );
    const withoutShift = computeSpectralOpacity(
      baseInput({
        species: [speciesH2o({ lines: [syntheticLine({ lineId: 'L1', pressureShift: undefined })] })]
      })
    );
    expect(withShift.status).toBe('completed');
    if (withShift.status === 'completed') {
      // pressureShift линии переопределён только ключом n2, поэтому вклад даёт
      // один n2: -0.02*0.75 = -0.015 cm-1 (self-коэффициент сдвига у этой линии не задан).
      expect(withShift.linesUsed[0].pressureShiftCm1).toBeCloseTo(-0.015, 12);
      expect(withShift.linesUsed[0].wavenumberCm1Shifted).toBeCloseTo(1000 - 0.015, 12);
      expect(withShift.applicabilityDiagnostics.join(' ')).not.toContain('коэффициенты сдвига давления в записи отсутствуют');
    }
    expect(withoutShift.status).toBe('completed');
    if (withoutShift.status === 'completed') {
      expect(withoutShift.linesUsed[0].pressureShiftCm1).toBe(0);
      expect(withoutShift.linesUsed[0].wavenumberCm1Shifted).toBe(1000);
      expect(withoutShift.applicabilityDiagnostics.join(' ')).toContain('не сдвигается');
    }
  });
});

// ============================================
// 11-15: Профиль Фойгта и аддитивность
// ============================================

describe('Профиль Фойгта', () => {
  it('11. конечен, положителен и нормирован (шаг <= gammaL/4, широкое окно)', () => {
    const alphaD = dopplerHwhmCm1({ wavenumberCm1: 1000, temperatureK: 296, molarMassGPerMol: 18.010565 });
    const gammaL = 0.02;
    const step = gammaL / 4;
    const halfWidth = 2000 * gammaL;
    let sum = 0;
    let allFinitePositive = true;
    for (let x = -halfWidth; x <= halfWidth + step / 2; x += step) {
      const f = voigtProfileCm({ offsetCm1: x, dopplerHwhmCm1: alphaD, lorentzHwhmCm1: gammaL });
      if (!Number.isFinite(f) || f <= 0) allFinitePositive = false;
      sum += f * step;
    }
    expect(allFinitePositive).toBe(true);
    // Хвост за окном ~3.2e-4 << допуск 1e-2; небольшая недокрытая часть
    // дисперсии трапецией не влияет на 2 знака.
    expect(sum).toBeCloseTo(1, 2);
  });

  it('12. доплеровский предел воспроизводит гауссов профиль', () => {
    const alphaD = 0.05;
    const sigma = alphaD / Math.sqrt(2 * Math.LN2);
    for (const x of [0, 0.01, 0.03, 0.07]) {
      const voigt = voigtProfileCm({ offsetCm1: x, dopplerHwhmCm1: alphaD, lorentzHwhmCm1: 1e-7 * alphaD });
      const gauss = (1 / (sigma * Math.sqrt(2 * Math.PI))) * Math.exp((-x * x) / (2 * sigma * sigma));
      expect(Math.abs(voigt - gauss) / gauss).toBeLessThan(1e-5);
    }
  });

  it('13. столкновительный предел воспроизводит лоренцев профиль', () => {
    const gammaL = 0.05;
    const alphaD = 1e-4 * gammaL;
    for (const x of [0, 0.02, 0.08, 0.15]) {
      const voigt = voigtProfileCm({ offsetCm1: x, dopplerHwhmCm1: alphaD, lorentzHwhmCm1: gammaL });
      const lorentz = gammaL / Math.PI / (x * x + gammaL * gammaL);
      expect(Math.abs(voigt - lorentz) / lorentz).toBeLessThan(1e-5);
    }
  });

  it('14. суммарный вклад нескольких линий аддитивен', () => {
    const l1 = syntheticLine({ lineId: 'L1', wavenumberCm1: 1000 });
    const l2 = syntheticLine({ lineId: 'L2', wavenumberCm1: 1000.2, intensityCmPerMoleculeAtRef: 5e-21 });
    const both = computeSpectralOpacity(baseInput({ species: [speciesH2o({ lines: [l1, l2] })] }));
    const only1 = computeSpectralOpacity(baseInput({ species: [speciesH2o({ lines: [l1] })] }));
    const only2 = computeSpectralOpacity(baseInput({ species: [speciesH2o({ lines: [l2] })] }));
    expect(both.status).toBe('completed');
    if (both.status === 'completed' && only1.status === 'completed' && only2.status === 'completed') {
      both.crossSectionM2PerMolecule.forEach((v, i) => {
        expect(v).toBeCloseTo(
          only1.crossSectionM2PerMolecule[i] + only2.crossSectionM2PerMolecule[i],
          14
        );
      });
    }
  });

  it('15. суммарный вклад нескольких газов аддитивен', () => {
    const h2o = speciesH2o();
    const co2 = speciesH2o({
      gasId: 'co2',
      isotopologueId: '626',
      partitionSum: singlePointPartitionSum('626'),
      lines: [
        syntheticLine({
          lineId: 'C1',
          wavenumberCm1: 1000.15,
          intensityCmPerMoleculeAtRef: 2e-21,
          moleculeId: 'TESTCO2',
          isotopologueId: '626'
        })
      ]
    });
    const both = computeSpectralOpacity(
      baseInput({
        species: [h2o, co2],
        broadeners: [
          // Обе доли ниже порога существенности 0.01: у фикс-линий нет
          // взаимных co2/h2o-коэффициентов, и sub-пороговый вклад легален.
          { gasId: 'h2o', moleFraction: 0.005 },
          { gasId: 'co2', moleFraction: 0.005 },
          { gasId: 'n2', moleFraction: 0.73 },
          { gasId: 'o2', moleFraction: 0.24 }
        ]
      })
    );
    // Одинаковый состав уширителей (n2, o2) в обоих прогонах: тогда sigma_h2o
    // в 'both' и 'h2oOnly' совпадает и сумма строго аддитивна. Доля co2 = 0.005
    // (ниже порога существенного уширителя 0.01): у линии h2o нет co2-коэффициента,
    // но при sub-пороговой доле отсутствие коэффициента не является ошибкой применимости.
    const h2oOnly = computeSpectralOpacity(
      baseInput({
        species: [h2o],
        broadeners: [
          { gasId: 'h2o', moleFraction: 0.005 },
          { gasId: 'n2', moleFraction: 0.73 },
          { gasId: 'o2', moleFraction: 0.24 }
        ]
      })
    );
    const co2Only = computeSpectralOpacity(
      baseInput({
        species: [co2],
        broadeners: [
          { gasId: 'co2', moleFraction: 0.005 },
          { gasId: 'n2', moleFraction: 0.73 },
          { gasId: 'o2', moleFraction: 0.24 }
        ]
      })
    );
    expect(both.status).toBe('completed');
    if (both.status === 'completed' && h2oOnly.status === 'completed' && co2Only.status === 'completed') {
      both.crossSectionM2PerMolecule.forEach((v, i) => {
        expect(v).toBeCloseTo(h2oOnly.crossSectionM2PerMolecule[i] + co2Only.crossSectionM2PerMolecule[i], 14);
      });
      expect(both.contributions).toHaveLength(2);
    }
  });
});

// ============================================
// 16-19: Сечения, коэффициенты, единицы
// ============================================

describe('Сечение и объёмный коэффициент поглощения', () => {
  function lorentzDominatedInput(): SpectralOpacityInput {
    return baseInput({
      pressurePa: ATM_TO_PA,
      temperatureK: 296,
      species: [
        speciesH2o({
          lines: [
            syntheticLine({
              lineId: 'L1',
              intensityCmPerMoleculeAtRef: 1e-20,
              lowerStateEnergyCm1: 0,
              broadening: { n2: { gammaCm1PerAtmAtRef: 100, temperatureExponent: 0.5 } }
            })
          ]
        })
      ],
      // Доля h2o = 0: self-вклад отсутствует, но концентрация поглотителя
      // известна (ноль), поэтому расчёт completed, а gamma идёт только от n2.
      broadeners: [{ gasId: 'h2o', moleFraction: 0 }, { gasId: 'n2', moleFraction: 1.0 }],
      grid: { startWavenumberCm1: 999.5, endWavenumberCm1: 1000.5, stepCm1: 0.0005 }
    });
  }

  it('16. сечение имеет правильную размерность и конверсию в SI', () => {
    const result = computeSpectralOpacity(lorentzDominatedInput());
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      const line = result.linesUsed[0];
      expect(line.gammaLorentzCm1).toBeCloseTo(100, 9); // 100 cm-1/atm * 1 atm
      // Пик лоренцева профиля f(0) = 1/(pi*gammaL) [cm]; sigma_peak = S*f [cm^2]; *1e-4 -> m^2.
      const expectedPeakM2 = (1e-20 / (Math.PI * line.gammaLorentzCm1)) * 1e-4;
      const centerIdx = 1000; // (1000 - 999.5)/0.0005
      const gotPeak = result.crossSectionM2PerMolecule[centerIdx];
      expect(Math.abs(gotPeak / expectedPeakM2 - 1)).toBeLessThan(1e-3);
      expect(gotPeak).toBeGreaterThan(0);
      // Прямая документированная конверсия; без скрытых 1e4/1e2/1e6.
      expect(result.unitConversions.join(' ')).toContain('1e-4 -> m^2/molecule');
      expect(result.unitConversions.join(' ')).not.toMatch(/1e\+?[246](?!\d)/);
    }
  });

  it('17. объёмный коэффициент поглощения соответствует n_i * sigma_i', () => {
    const result = computeSpectralOpacity(
      baseInput({
        pressurePa: 5e4,
        temperatureK: 250,
        // Partition sum с диапазоном, покрывающим и T = 250 K, и T_ref = 296 K.
        species: [
          speciesH2o({
            partitionSum: rangedPartitionSum('161', [
              { temperatureK: 200, partitionSum: 120 },
              { temperatureK: 300, partitionSum: 210 }
            ])
          })
        ],
        broadeners: [{ gasId: 'h2o', moleFraction: 0.02 }, { gasId: 'n2', moleFraction: 0.98 }]
      })
    );
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      const nTotal = 5e4 / (HITRAN_SPECTRAL_CONSTANTS.boltzmannJPerK * 250);
      expect(Math.abs(result.totalNumberDensityPerM3 / nTotal - 1)).toBeLessThan(1e-15);
      const c = result.contributions[0];
      expect(Math.abs(c.numberDensityPerM3 / (nTotal * 0.02) - 1)).toBeLessThan(1e-15);
      c.crossSectionM2PerMolecule.forEach((s, i) => {
        expect(Math.abs(c.absorptionCoefficientPerM[i] / (c.numberDensityPerM3 * s) - 1)).toBeLessThan(1e-12);
      });
      result.absorptionCoefficientPerM.forEach((a, i) => {
        expect(a).toBe(c.absorptionCoefficientPerM[i]);
      });
    }
  });

  it('18. удвоение концентрации поглотителя удваивает коэффициент поглощения', () => {
    // Двойная доля h2o (0.004 -> 0.008); доля n2 фиксирована (0.9): у линии НЕТ
    // self-коэффициента и сдвига, доля h2o ниже порога существенного уширителя,
    // поэтому частичные давления уширителей и форма sigma НЕ меняются,
    // меняется только n_i: alpha = n_i*sigma ровно удваивается на каждом узле.
    const low = computeSpectralOpacity(
      baseInput({
        species: [
          speciesH2o({
            lines: [
              syntheticLine({
                lineId: 'L1',
                pressureShift: undefined,
                broadening: { n2: { gammaCm1PerAtmAtRef: 0.08, temperatureExponent: 0.6 } }
              })
            ]
          })
        ],
        broadeners: [{ gasId: 'h2o', moleFraction: 0.004 }, { gasId: 'n2', moleFraction: 0.9 }]
      })
    );
    const high = computeSpectralOpacity(
      baseInput({
        species: [
          speciesH2o({
            lines: [
              syntheticLine({
                lineId: 'L1',
                pressureShift: undefined,
                broadening: { n2: { gammaCm1PerAtmAtRef: 0.08, temperatureExponent: 0.6 } }
              })
            ]
          })
        ],
        broadeners: [{ gasId: 'h2o', moleFraction: 0.008 }, { gasId: 'n2', moleFraction: 0.9 }]
      })
    );
    expect(low.status).toBe('completed');
    expect(high.status).toBe('completed');
    if (low.status === 'completed' && high.status === 'completed') {
      expect(Math.abs(high.contributions[0].numberDensityPerM3 / low.contributions[0].numberDensityPerM3 - 2)).toBeLessThan(1e-12);
      high.absorptionCoefficientPerM.forEach((a, i) => {
        expect(a / low.absorptionCoefficientPerM[i]).toBeCloseTo(2, 10);
      });
    }
  });

  it('19. изменение парциальной доли газа изменяет только его вклад', () => {
    // Меняется только доля h2o (0.005 -> 0.01): вклад n2 в gamma остаётся тем же,
    // self-вклад h2o удваивается, концентрация h2o удваивается.
    const run = (xH2o: number) =>
      computeSpectralOpacity(
        baseInput({
          species: [speciesH2o()],
          broadeners: [{ gasId: 'h2o', moleFraction: xH2o }, { gasId: 'n2', moleFraction: 0.98 }, { gasId: 'o2', moleFraction: 0.01 }]
        })
      );
    const r1 = run(0.005);
    const r2 = run(0.01);
    expect(r1.status).toBe('completed');
    expect(r2.status).toBe('completed');
    if (r1.status === 'completed' && r2.status === 'completed') {
      const g1 = r1.linesUsed[0].broadenersUsed;
      const g2 = r2.linesUsed[0].broadenersUsed;
      const self1 = g1.find((b) => b.gasId.includes('self'))!;
      const self2 = g2.find((b) => b.gasId.includes('self'))!;
      const n2_1 = g1.find((b) => b.gasId === 'n2')!;
      const n2_2 = g2.find((b) => b.gasId === 'n2')!;
      expect(self2.gammaCm1).toBeCloseTo(2 * self1.gammaCm1, 12);
      expect(n2_2.gammaCm1).toBe(n2_1.gammaCm1);
      expect(Math.abs(r2.contributions[0].numberDensityPerM3 / r1.contributions[0].numberDensityPerM3 - 2)).toBeLessThan(1e-12);
      expect(r1.contributions).toHaveLength(1);
      expect(r2.contributions).toHaveLength(1);
    }
  });
});

// ============================================
// 20-25: Валидация входа (fail-closed) и детерминизм
// ============================================

describe('Валидация входа', () => {
  it('20. некорректная или несортированная спектральная сетка отклоняется', () => {
    const zeroStep = computeSpectralOpacity(baseInput({ grid: { startWavenumberCm1: 1000, endWavenumberCm1: 1000.5, stepCm1: 0 } }));
    expect(zeroStep.status).toBe('invalid_input');
    const inverted = computeSpectralOpacity(baseInput({ grid: { startWavenumberCm1: 1000.5, endWavenumberCm1: 1000, stepCm1: 0.001 } }));
    expect(inverted.status).toBe('invalid_input');
    if (inverted.status === 'invalid_input') {
      expect(inverted.errors.join(' ')).toContain('строго больше');
    }
    const nanStep = computeSpectralOpacity(baseInput({ grid: { startWavenumberCm1: 1000, endWavenumberCm1: 1000.5, stepCm1: Number.NaN } }));
    expect(nanStep.status).toBe('invalid_input');
  });

  it('21. нулевые и отрицательные интенсивности и ширины отклоняются', () => {
    const zeroIntensity = computeSpectralOpacity(
      baseInput({ species: [speciesH2o({ lines: [syntheticLine({ lineId: 'L1', intensityCmPerMoleculeAtRef: 0 })] })] })
    );
    expect(zeroIntensity.status).toBe('invalid_input');
    const negativeIntensity = computeSpectralOpacity(
      baseInput({ species: [speciesH2o({ lines: [syntheticLine({ lineId: 'L1', intensityCmPerMoleculeAtRef: -1e-21 })] })] })
    );
    expect(negativeIntensity.status).toBe('invalid_input');
    const nanWidth = computeSpectralOpacity(
      baseInput({
        species: [
          speciesH2o({
            lines: [
              syntheticLine({
                lineId: 'L1',
                // self-коэффициент известен (доля h2o 0.01 существенна), а NaN
                // сидит в n2-коэффициенте: gamma_L = NaN -> numerical_failure.
                broadening: {
                  self: { gammaCm1PerAtmAtRef: 0.1, temperatureExponent: 0.5 },
                  n2: { gammaCm1PerAtmAtRef: Number.NaN, temperatureExponent: 0.5 },
                  o2: { gammaCm1PerAtmAtRef: 0.05, temperatureExponent: 0.65 }
                }
              })
            ]
          })
        ]
      })
    );
    // NaN-ширина не проходит расчёт малыми шагами: fail-closed (numerical_failure).
    expect(nanWidth.status).toBe('numerical_failure');
  });

  it('22. NaN/Infinity в параметрах отклоняются', () => {
    const nanT = computeSpectralOpacity(baseInput({ temperatureK: Number.NaN }));
    expect(nanT.status).toBe('invalid_input');
    const infP = computeSpectralOpacity(baseInput({ pressurePa: Number.POSITIVE_INFINITY }));
    expect(infP.status).toBe('invalid_input');
    const negativeX = computeSpectralOpacity(baseInput({ broadeners: [{ gasId: 'n2', moleFraction: -0.5 }] }));
    expect(negativeX.status).toBe('invalid_input');
    const overSum = computeSpectralOpacity(
      baseInput({ broadeners: [{ gasId: 'n2', moleFraction: 1.5 }, { gasId: 'o2', moleFraction: 1.5 }] })
    );
    expect(overSum.status).toBe('invalid_input');
    if (overSum.status === 'invalid_input') {
      expect(overSum.errors.join(' ')).toContain('НЕ выполняется');
    }
  });

  it('23. неизвестный газ блокирует физический расчёт', () => {
    const unknownAbsorber = computeSpectralOpacity(
      baseInput({ species: [speciesH2o({ gasId: 'unobtainium', isotopologueId: '999' })] })
    );
    expect(unknownAbsorber.status).toBe('out_of_applicability');
    if (unknownAbsorber.status === 'out_of_applicability') {
      expect(unknownAbsorber.reason).toContain('отсутствует в каталоге');
    }
    const unknownBroadener = computeSpectralOpacity(
      baseInput({ broadeners: [{ gasId: 'phlogiston', moleFraction: 0.5 }, { gasId: 'h2o', moleFraction: 0.01 }] })
    );
    expect(unknownBroadener.status).toBe('invalid_input');
  });

  it('24. превышение максимального размера спектральной сетки отклоняется', () => {
    const result = computeSpectralOpacity(
      baseInput({
        grid: { startWavenumberCm1: 0, endWavenumberCm1: 100000, stepCm1: 0.001 } // ~1e8 узлов >> 20001
      })
    );
    expect(result.status).toBe('invalid_input');
    if (result.status === 'invalid_input') {
      expect(result.errors[0]).toContain(String(SPECTRAL_OPACITY_DEFAULTS.maxGridPoints));
    }
  });

  it('25. повторный идентичный расчёт детерминирован', () => {
    const a = computeSpectralOpacity(baseInput());
    const b = computeSpectralOpacity(baseInput());
    expect(a).toEqual(b);
  });
});

// ============================================
// 26-28: Якоря реальных данных и независимые проверки
// ============================================

describe('Реальные данные и независимые проверки', () => {
  it('26. якоря molparam: массы, распространённости, Q(296 K) - точные значения', () => {
    const h2o161 = MOLPARAM_FRAGMENT_BY_ISO.get('161')!;
    expect(h2o161.molarMassGPerMol).toBeCloseTo(18.010565, 6);
    expect(h2o161.terrestrialAbundance).toBeCloseTo(0.997317, 6);
    expect(h2o161.partitionSumAt296K).toBeCloseTo(1.7458e2, 3);
    const co2626 = MOLPARAM_FRAGMENT_BY_ISO.get('626')!;
    expect(co2626.molarMassGPerMol).toBeCloseTo(43.98983, 5);
    expect(co2626.terrestrialAbundance).toBeCloseTo(0.984204, 6);
    const ch4211 = MOLPARAM_FRAGMENT_BY_ISO.get('211')!;
    expect(ch4211.partitionSumAt296K).toBeCloseTo(5.9053e2, 3);
    // Статус line-by-line: НЕ верифицирован, тестовые линии не HITRAN.
    expect(HITRAN_LINE_LIST_STATUS.verificationStatus).toBe('not_verifiable');
    expect(HITRAN_LINE_LIST_STATUS.note).toContain('синтетические');
  });

  it('27. линейная интерполяция partition sum внутри диапазона', () => {
    const record = rangedPartitionSum('161', [
      { temperatureK: 200, partitionSum: 100 },
      { temperatureK: 300, partitionSum: 300 },
      { temperatureK: 400, partitionSum: 700 }
    ]);
    expect(partitionSumAtTemperature(record, 200)).toBe(100);
    expect(partitionSumAtTemperature(record, 300)).toBe(300);
    expect(partitionSumAtTemperature(record, 250)).toBe(200);
    expect(partitionSumAtTemperature(record, 350)).toBe(500);
    // Вне диапазона - null (не экстраполируем).
    expect(partitionSumAtTemperature(record, 199.9)).toBeNull();
    expect(partitionSumAtTemperature(record, 400.1)).toBeNull();
    // Некорректные наборы - null.
    expect(partitionSumAtTemperature(rangedPartitionSum('161', []), 296)).toBeNull();
    expect(
      partitionSumAtTemperature(
        rangedPartitionSum('161', [
          { temperatureK: 300, partitionSum: 100 },
          { temperatureK: 200, partitionSum: 100 }
        ]),
        250
      )
    ).toBeNull();
  });

  it('28. профиль Фойгта против независимой квадратуры ядра K(x,y)', () => {
    // Независимый эталон: K(x,y) = (y/pi)*int e^{-t^2}/((x-t)^2+y^2) dt (Simpson),
    // f_V = K * sqrt(ln2/pi) / alpha_D, где x = sqrt(ln2)*(nu-nu0)/alpha_D,
    // т.е. смещение в cm-1: nu - nu0 = x * alpha_D / sqrt(ln2).
    const alphaD = 0.05;
    const gammaL = 0.05;
    const y = (gammaL / alphaD) * Math.sqrt(Math.LN2);
    const fK = (x: number): number => {
      const n = 4000;
      const a = -12;
      const b = 12;
      const h = (b - a) / n;
      const integrand = (t: number) => Math.exp(-t * t) / ((x - t) * (x - t) + y * y);
      let sum = integrand(a) + integrand(b);
      for (let i = 1; i < n; i++) {
        sum += integrand(a + i * h) * (i % 2 === 0 ? 2 : 4);
      }
      return ((y / Math.PI) * (sum * h)) / 3;
    };
    for (const x of [-1.2, -0.4, 0, 0.4, 1.2, 2.5]) {
      const reference = (fK(x) * Math.sqrt(Math.LN2 / Math.PI)) / alphaD;
      const ours = voigtProfileCm({
        offsetCm1: (x * alphaD) / Math.sqrt(Math.LN2),
        dopplerHwhmCm1: alphaD,
        lorentzHwhmCm1: gammaL
      });
      expect(Math.abs(ours - reference) / reference).toBeLessThan(1e-4);
    }
  });
});

// ============================================
// Дополнительные проверки контрактов
// ============================================

describe('Контракты изотопного масштаба и служебных формул', () => {
  it('isotopeScaleFactor: корректное отношение и отбраковка', () => {
    expect(isotopeScaleFactor(0.5, 0.984204)).toBeCloseTo(0.5 / 0.984204, 14);
    expect(isotopeScaleFactor(Number.NaN, 0.98)).toBeNaN();
    expect(isotopeScaleFactor(0.5, 0)).toBeNaN();
    expect(isotopeScaleFactor(-0.1, 0.98)).toBeNaN();
  });

  it('режим explicit-ratio без фактической распространённости -> out_of_applicability', () => {
    const result = computeSpectralOpacity(
      baseInput({
        species: [speciesH2o({ actualIsotopicAbundance: undefined })],
        isotopicScaleMode: 'explicit-ratio'
      })
    );
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.reason).toContain('explicit-ratio');
    }
  });

  it('режим explicit-ratio с подтверждённой распространённостью масштабирует S(T)', () => {
    const mp = MOLPARAM_FRAGMENT_BY_ISO.get('161')!;
    const terrestrial = computeSpectralOpacity(
      baseInput({ isotopicScaleMode: 'explicit-ratio', species: [speciesH2o({ actualIsotopicAbundance: mp.terrestrialAbundance })] })
    );
    const scaled = computeSpectralOpacity(
      baseInput({ isotopicScaleMode: 'explicit-ratio', species: [speciesH2o({ actualIsotopicAbundance: 0.5 })] })
    );
    expect(terrestrial.status).toBe('completed');
    expect(scaled.status).toBe('completed');
    if (terrestrial.status === 'completed' && scaled.status === 'completed') {
      const factor = isotopeScaleFactor(0.5, mp.terrestrialAbundance);
      scaled.crossSectionM2PerMolecule.forEach((v, i) => {
        expect(v).toBeCloseTo(terrestrial.crossSectionM2PerMolecule[i] * factor, 13);
      });
    }
  });

  it('отсутствие partition sum -> out_of_applicability с конкретным параметром', () => {
    const result = computeSpectralOpacity(baseInput({ species: [speciesH2o({ partitionSum: undefined })] }));
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.missingParameters?.[0]).toContain('partition sum');
    }
  });

  it('отсутствующая молярная масса изотополога -> out_of_applicability', () => {
    const result = computeSpectralOpacity(
      baseInput({
        species: [speciesH2o({ isotopologueId: '999', partitionSum: singlePointPartitionSum('161') })]
      })
    );
    expect(result.status).toBe('out_of_applicability');
    if (result.status === 'out_of_applicability') {
      expect(result.missingParameters?.[0]).toContain('молярной массы');
    }
  });

  it('высокое давление и неполнота набора линий видны в diagnostics', () => {
    const result = computeSpectralOpacity(baseInput({ pressurePa: 1e7 }));
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.applicabilityDiagnostics.join(' ')).toContain('50 atm');
      expect(result.applicabilityDiagnostics.join(' ')).toContain('неполнота набора линий');
      expect(result.assumptions.join(' ')).toContain('идеальный газ');
    }
  });
});
