// ============================================
// kineticCompartment.test.ts — тесты физически явного реакционного
// слоя (Stage 4.5.5, второй срез)
// ============================================
//
// Проверяется: чистые преобразования единиц моль/м² ↔ molecule/cm³
// на точной N_A; влияние толщины слоя; fail-closed вход (нулевая/
// отрицательная/неконечная толщина, отсутствующий обязательный вид,
// отсутствующий/нулевой N₂, отрицательные/NaN/Infinity запасы,
// неизвестные ключи); допустимость явного нуля реакционного вида;
// применение №89 и №106; совместный шаг только при 300 K;
// неизменность N₂; сохранение запасов невыбранных реакций;
// отсутствие мутации входа; отсутствие частичного результата при
// отказе; соответствие обновлённых запасов результату концентрационного
// механизма; компонентная трассируемость через слой.
//
// ВАЖНО: толщина слоя и все столбовые запасы в фикстурах —
// СИНТЕТИЧЕСКИЕ величины для проверки МАТЕМАТИКИ адаптера; они НЕ
// являются утверждением о параметрах какой-либо планетарной
// атмосферы. Толщина слоя НЕ выводится из давления или гравитации.

import { describe, expect, it } from 'vitest';
import {
  columnInventoryMolM2ToConcentrationMoleculeCm3,
  concentrationMoleculeCm3ToColumnInventoryMolM2,
  runKineticCompartmentStep
} from '../ChemicalEvolution/kineticCompartment';
import type { KineticCompartmentStepInput } from '../ChemicalEvolution/kineticCompartment';
import { KineticMechanismError } from '../ChemicalEvolution/kineticMechanism';
import { buildKineticsCatalog, kidaTbRecordId } from '../Data/kineticsCatalog';

const ID89 = 'kida-tb-2015-03-19-89';
const ID106 = 'kida-tb-2015-03-19-106';
const LAYER_M = 100; // синтетическая толщина слоя, м
const DT_FIXTURE_S = 0.1; // физические секунды
const T89_K = 250;
const T106_K = 350;
const N2_COLUMN_MOL_M2 = 4.2e3; // синтетика: [N₂] ≈ 2.53e19 molecule/cm³ при L = 100 м

function compartment89(temperatureK: number): KineticCompartmentStepInput {
  return {
    temperatureK,
    dtSeconds: DT_FIXTURE_S,
    layerThicknessM: LAYER_M,
    reactionIds: [ID89],
    columnInventoriesMolM2: { O: 1e-5, NO: 5e-6, NO2: 2e-7, N2: N2_COLUMN_MOL_M2 }
  };
}

function compartment106(temperatureK: number): KineticCompartmentStepInput {
  return {
    temperatureK,
    dtSeconds: DT_FIXTURE_S,
    layerThicknessM: LAYER_M,
    reactionIds: [ID106],
    columnInventoriesMolM2: { H: 8e-6, O2: 4e-5, HO2: 1e-8, N2: N2_COLUMN_MOL_M2 }
  };
}

function compartmentJoint(temperatureK: number): KineticCompartmentStepInput {
  return {
    temperatureK,
    dtSeconds: DT_FIXTURE_S,
    layerThicknessM: LAYER_M,
    reactionIds: [ID89, ID106],
    columnInventoriesMolM2: {
      O: 1e-5,
      NO: 5e-6,
      NO2: 2e-7,
      H: 8e-6,
      O2: 4e-5,
      HO2: 1e-8,
      N2: N2_COLUMN_MOL_M2
    }
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
// 1. Чистые преобразования единиц (точная N_A)
// --------------------------------------------

describe('преобразования единиц слоя (точная N_A)', () => {
  it('прямое преобразование моль/м² → molecule/cm³: [X] = C·N_A/(L·10⁶)', () => {
    // C = 1e-3 моль/м², L = 100 м → [X] = 1e-3·6.02214076e23/1e8 = 6.02214076e12.
    // Проверка по независимому литералу, а не по формуле реализации.
    const converted = columnInventoryMolM2ToConcentrationMoleculeCm3(1e-3, 100);
    expect(converted / 6.02214076e12).toBeCloseTo(1, 12);
    expect(columnInventoryMolM2ToConcentrationMoleculeCm3(0, 100)).toBe(0);
  });

  it('обратное преобразование molecule/cm³ → моль/м²: C = [X]·L·10⁶/N_A', () => {
    const back = concentrationMoleculeCm3ToColumnInventoryMolM2(6.02214076e12, 100);
    expect(back).toBeCloseTo(1e-3, 8);
  });

  it('round-trip в обе стороны сходится с точностью машинной арифметики', () => {
    for (const c of [1e-9, 1e-5, 1.66e-4, 4.2e3]) {
      const back = concentrationMoleculeCm3ToColumnInventoryMolM2(
        columnInventoryMolM2ToConcentrationMoleculeCm3(c, LAYER_M),
        LAYER_M
      );
      expect(back / c).toBeCloseTo(1, 12);
    }
    expect(
      concentrationMoleculeCm3ToColumnInventoryMolM2(
        columnInventoryMolM2ToConcentrationMoleculeCm3(0, LAYER_M),
        LAYER_M
      )
    ).toBe(0);
    for (const conc of [1e3, 6.02e10, 2.529e19]) {
      const backConc = columnInventoryMolM2ToConcentrationMoleculeCm3(
        concentrationMoleculeCm3ToColumnInventoryMolM2(conc, LAYER_M),
        LAYER_M
      );
      expect(backConc / conc).toBeCloseTo(1, 12);
    }
    expect(
      columnInventoryMolM2ToConcentrationMoleculeCm3(
        concentrationMoleculeCm3ToColumnInventoryMolM2(0, LAYER_M),
        LAYER_M
      )
    ).toBe(0);
  });

  it('при неизменном столбовом запасе удвоение толщины слоя уменьшает концентрацию вдвое', () => {
    const c = 4.2e3;
    const thin = columnInventoryMolM2ToConcentrationMoleculeCm3(c, LAYER_M);
    const thick = columnInventoryMolM2ToConcentrationMoleculeCm3(c, 2 * LAYER_M);
    expect(thick).toBeLessThan(thin);
    expect(thick / thin).toBeCloseTo(0.5, 12);
  });

  it('чистые функции отвергают неконечные/отрицательные величины и недопустимую толщину', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      expect(
        mechanismError(() => columnInventoryMolM2ToConcentrationMoleculeCm3(bad, LAYER_M)).code
      ).toBe('invalid_input');
      expect(
        mechanismError(() => concentrationMoleculeCm3ToColumnInventoryMolM2(bad, LAYER_M)).code
      ).toBe('invalid_input');
    }
    for (const badL of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        mechanismError(() => columnInventoryMolM2ToConcentrationMoleculeCm3(1e-3, badL)).code
      ).toBe('invalid_input');
      expect(
        mechanismError(() => concentrationMoleculeCm3ToColumnInventoryMolM2(1e12, badL)).code
      ).toBe('invalid_input');
    }
  });
});

// --------------------------------------------
// 2. Fail-closed вход реакционного слоя
// --------------------------------------------

describe('fail-closed вход реакционного слоя', () => {
  it('нулевая, отрицательная и неконечная толщина слоя — invalid_input', () => {
    for (const badL of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const broken = { ...compartment89(T89_K), layerThicknessM: badL };
      expect(mechanismError(() => runKineticCompartmentStep(broken)).code).toBe('invalid_input');
    }
  });

  it('temperatureK и dtSeconds: ноль, отрицательные, NaN, Infinity — invalid_input', () => {
    for (const t of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const broken = { ...compartment89(T89_K), temperatureK: t };
      expect(mechanismError(() => runKineticCompartmentStep(broken)).code).toBe('invalid_input');
    }
    for (const dt of [0, -1, Number.NaN]) {
      const broken = { ...compartment89(T89_K), dtSeconds: dt };
      expect(mechanismError(() => runKineticCompartmentStep(broken)).code).toBe('invalid_input');
    }
  });

  it('отсутствующий обязательный вид — ошибка входа, а не молчаливый ноль', () => {
    const broken = {
      temperatureK: T89_K,
      dtSeconds: DT_FIXTURE_S,
      layerThicknessM: LAYER_M,
      reactionIds: [ID89],
      columnInventoriesMolM2: { O: 1e-5, NO2: 2e-7, N2: N2_COLUMN_MOL_M2 } // нет NO
    };
    const error = mechanismError(() => runKineticCompartmentStep(broken));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('NO');
  });

  it('отсутствующий, нулевой и NaN запас N₂ — invalid_input (N₂ передаётся явно)', () => {
    const noN2 = {
      ...compartment89(T89_K),
      columnInventoriesMolM2: { O: 1e-5, NO: 5e-6, NO2: 2e-7 }
    };
    expect(mechanismError(() => runKineticCompartmentStep(noN2)).code).toBe('invalid_input');

    const zeroN2 = {
      ...compartment89(T89_K),
      columnInventoriesMolM2: { O: 1e-5, NO: 5e-6, NO2: 2e-7, N2: 0 }
    };
    expect(mechanismError(() => runKineticCompartmentStep(zeroN2)).code).toBe('invalid_input');

    const nanN2 = {
      ...compartment89(T89_K),
      columnInventoriesMolM2: { O: 1e-5, NO: 5e-6, NO2: 2e-7, N2: Number.NaN }
    };
    expect(mechanismError(() => runKineticCompartmentStep(nanN2)).code).toBe('invalid_input');
  });

  it('отрицательный, NaN и бесконечный запас реакционного вида — invalid_input', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1e-5]) {
      const broken = {
        ...compartment89(T89_K),
        columnInventoriesMolM2: { O: bad, NO: 5e-6, NO2: 2e-7, N2: N2_COLUMN_MOL_M2 }
      };
      expect(mechanismError(() => runKineticCompartmentStep(broken)).code).toBe('invalid_input');
    }
  });

  it('неизвестный ключ в столбовых запасах — invalid_input', () => {
    const broken = {
      ...compartment89(T89_K),
      columnInventoriesMolM2: { O: 1e-5, NO: 5e-6, NO2: 2e-7, N2: N2_COLUMN_MOL_M2, CO2: 1e-3 }
    };
    const error = mechanismError(() => runKineticCompartmentStep(broken));
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('CO2');
  });

  it('записи вне механизма и неизвестные идентификаторы — единая семантика ошибок механизма', () => {
    // №1 — known-запись каталога вне ограниченного механизма:
    const outside = { ...compartment89(T89_K), reactionIds: [kidaTbRecordId(1)] };
    expect(mechanismError(() => runKineticCompartmentStep(outside)).code).toBe('no_kinetic_data');

    const unknown = { ...compartment89(T89_K), reactionIds: ['нет-такой-записи'] };
    expect(mechanismError(() => runKineticCompartmentStep(unknown)).code).toBe('invalid_input');

    const empty = { ...compartment89(T89_K), reactionIds: [] };
    expect(mechanismError(() => runKineticCompartmentStep(empty)).code).toBe('invalid_input');

    const dup = { ...compartment89(T89_K), reactionIds: [ID89, ID89] };
    expect(mechanismError(() => runKineticCompartmentStep(dup)).code).toBe('invalid_input');
  });
});

// --------------------------------------------
// 3. Применение шага слоя
// --------------------------------------------

describe('применение шага слоя', () => {
  it('№89 применяется: реагенты убывают, продукт растёт (моль/м²)', () => {
    const input = compartment89(T89_K);
    const result = runKineticCompartmentStep(input);
    expect(result.status).toBe('applied');
    expect(result.appliedReactionIds).toEqual([ID89]);
    expect(result.updatedColumnInventoriesMolM2.O).toBeLessThan(input.columnInventoriesMolM2.O);
    expect(result.updatedColumnInventoriesMolM2.NO).toBeLessThan(input.columnInventoriesMolM2.NO);
    expect(result.updatedColumnInventoriesMolM2.NO2).toBeGreaterThan(
      input.columnInventoriesMolM2.NO2
    );
  });

  it('№106 применяется: реагенты убывают, продукт растёт (моль/м²)', () => {
    const input = compartment106(T106_K);
    const result = runKineticCompartmentStep(input);
    expect(result.status).toBe('applied');
    expect(result.appliedReactionIds).toEqual([ID106]);
    expect(result.updatedColumnInventoriesMolM2.H).toBeLessThan(input.columnInventoriesMolM2.H);
    expect(result.updatedColumnInventoriesMolM2.O2).toBeLessThan(input.columnInventoriesMolM2.O2);
    expect(result.updatedColumnInventoriesMolM2.HO2).toBeGreaterThan(
      input.columnInventoriesMolM2.HO2
    );
  });

  it('обновлённые запасы в точности соответствуют результату концентрационного механизма', () => {
    const result = runKineticCompartmentStep(compartmentJoint(300));
    for (const species of result.concentrationStep.speciesOrder) {
      expect(result.updatedColumnInventoriesMolM2[species]).toBe(
        concentrationMoleculeCm3ToColumnInventoryMolM2(
          result.concentrationStep.concentrations[species],
          LAYER_M
        )
      );
      // Обратное преобразование обновлённого запаса воспроизводит
      // концентрацию механизма:
      expect(
        columnInventoryMolM2ToConcentrationMoleculeCm3(
          result.updatedColumnInventoriesMolM2[species],
          LAYER_M
        ) / result.concentrationStep.concentrations[species]
      ).toBeCloseTo(1, 12);
    }
  });

  it('явный ноль реакционного вида допустим: состав не изменяется', () => {
    const input = {
      ...compartment89(T89_K),
      columnInventoriesMolM2: { O: 1e-5, NO: 0, NO2: 2e-7, N2: N2_COLUMN_MOL_M2 }
    };
    const result = runKineticCompartmentStep(input);
    expect(result.status).toBe('applied');
    // Реакция не идёт (скорость = 0): обновлённые запасы в точности
    // равны round-trip исходных запасов через преобразования единиц;
    // единственное возможное расхождение — машинное округление
    // round-trip моль/м² → molecule/cm³ → моль/м², а НЕ химическое
    // изменение состава.
    const roundTrip = (c: number): number =>
      concentrationMoleculeCm3ToColumnInventoryMolM2(
        columnInventoryMolM2ToConcentrationMoleculeCm3(c, LAYER_M),
        LAYER_M
      );
    expect(result.updatedColumnInventoriesMolM2.O).toBe(roundTrip(1e-5));
    expect(result.updatedColumnInventoriesMolM2.O / 1e-5).toBeCloseTo(1, 12);
    expect(result.updatedColumnInventoriesMolM2.NO).toBe(0);
    expect(result.updatedColumnInventoriesMolM2.NO2).toBe(roundTrip(2e-7));
    expect(result.updatedColumnInventoriesMolM2.NO2 / 2e-7).toBeCloseTo(1, 12);
  });
});

// --------------------------------------------
// 4. Совместный шаг и диапазоны применимости
// --------------------------------------------

describe('совместный шаг и диапазоны применимости', () => {
  it('совместный шаг №89+№106 допустим только при 300 K (пересечение диапазонов)', () => {
    expect(runKineticCompartmentStep(compartmentJoint(300)).status).toBe('applied');

    const cold = mechanismError(() => runKineticCompartmentStep(compartmentJoint(250)));
    expect(cold.code).toBe('temperature_out_of_range');
    expect((cold.details as { reactionId?: string } | undefined)?.reactionId).toBe(ID106);

    const hot = mechanismError(() => runKineticCompartmentStep(compartmentJoint(350)));
    expect(hot.code).toBe('temperature_out_of_range');
    expect((hot.details as { reactionId?: string } | undefined)?.reactionId).toBe(ID89);
  });

  it('общий диапазон 200–400 K для совместного шага НЕ заявляется: 200 и 400 K отказывают', () => {
    expect(mechanismError(() => runKineticCompartmentStep(compartmentJoint(200))).code).toBe(
      'temperature_out_of_range'
    );
    expect(mechanismError(() => runKineticCompartmentStep(compartmentJoint(400))).code).toBe(
      'temperature_out_of_range'
    );
  });

  it('отдельные шаги работают в своих диапазонах: №89 при 200–300 K, №106 при 300–400 K', () => {
    expect(runKineticCompartmentStep(compartment89(200)).status).toBe('applied');
    expect(runKineticCompartmentStep(compartment89(300)).status).toBe('applied');
    expect(runKineticCompartmentStep(compartment106(300)).status).toBe('applied');
    expect(runKineticCompartmentStep(compartment106(400)).status).toBe('applied');
  });
});

// --------------------------------------------
// 5. N₂, сохранение запасов, иммутабельность, отказы
// --------------------------------------------

describe('N₂, сохранение запасов и иммутабельность', () => {
  it('N₂ не расходуется: запас неизменен, consumedMolM2 = 0, концентрация вычислена из запаса', () => {
    const result = runKineticCompartmentStep(compartmentJoint(300));
    expect(result.thirdBody.speciesId).toBe('N2');
    expect(result.thirdBody.inventoryMolM2).toBe(N2_COLUMN_MOL_M2);
    expect(result.thirdBody.consumedMolM2).toBe(0);
    expect(result.thirdBody.concentrationMoleculeCm3).toBe(
      columnInventoryMolM2ToConcentrationMoleculeCm3(N2_COLUMN_MOL_M2, LAYER_M)
    );
    expect(result.updatedColumnInventoriesMolM2.N2).toBe(N2_COLUMN_MOL_M2);
    // N₂ — третье тело, НЕ изменяемый вид механизма:
    expect(result.concentrationStep.concentrations).not.toHaveProperty('N2');
  });

  it('запасы видов невыбранных реакций сохраняются без изменений', () => {
    const input = {
      ...compartment89(T89_K),
      columnInventoriesMolM2: {
        O: 1e-5,
        NO: 5e-6,
        NO2: 2e-7,
        H: 8e-6,
        O2: 4e-5,
        HO2: 1e-8,
        N2: N2_COLUMN_MOL_M2
      }
    };
    const result = runKineticCompartmentStep(input);
    expect(result.appliedReactionIds).toEqual([ID89]);
    expect(result.concentrationStep.speciesOrder).toEqual(['O', 'NO', 'NO2']);
    expect(result.updatedColumnInventoriesMolM2.H).toBe(8e-6);
    expect(result.updatedColumnInventoriesMolM2.O2).toBe(4e-5);
    expect(result.updatedColumnInventoriesMolM2.HO2).toBe(1e-8);
  });

  it('вход не мутируется; обновлённый инвентарь — новый объект', () => {
    const input = compartmentJoint(300);
    const snapshot = JSON.stringify(input);
    const result = runKineticCompartmentStep(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.updatedColumnInventoriesMolM2).not.toBe(input.columnInventoriesMolM2);
  });

  it('отказ концентрационного шага не оставляет частично обновлённого инвентаря', () => {
    const input = compartmentJoint(250); // №106 неприменима при 250 K
    const snapshot = JSON.stringify(input);
    const error = mechanismError(() => runKineticCompartmentStep(input));
    expect(error.code).toBe('temperature_out_of_range');
    expect(JSON.stringify(input)).toBe(snapshot);
    // Stateless: после отказа валидный вызов даёт полный результат.
    expect(runKineticCompartmentStep(compartmentJoint(300)).status).toBe('applied');
  });
});

// --------------------------------------------
// 6. Диагностика результата слоя
// --------------------------------------------

describe('диагностика результата слоя', () => {
  it('результат отражает температуру, шаг, толщину и идентификаторы реакций', () => {
    const result = runKineticCompartmentStep(compartmentJoint(300));
    expect(result.temperatureK).toBe(300);
    expect(result.dtSeconds).toBe(DT_FIXTURE_S);
    expect(result.layerThicknessM).toBe(LAYER_M);
    expect(result.appliedReactionIds).toEqual([ID89, ID106]);
  });

  it('предпосылки однородного слоя зафиксированы явно', () => {
    const result = runKineticCompartmentStep(compartment89(T89_K));
    expect(result.assumptions.some((a) => a.includes('однороден'))).toBe(true);
    expect(result.assumptions.some((a) => a.includes('изотермический'))).toBe(true);
    expect(result.assumptions.some((a) => a.includes('НЕ моделируются'))).toBe(true);
  });

  it('предупреждения: толщина слоя не выводится из параметров мира; предупреждения механизма перенесены', () => {
    const result = runKineticCompartmentStep(compartment89(T89_K));
    expect(result.warnings.some((w) => w.includes('НЕ выводится'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('IUPAC'))).toBe(true);
  });

  it('в заметках зафиксировано отсутствие подключения к состоянию мира', () => {
    const result = runKineticCompartmentStep(compartment89(T89_K));
    expect(result.notes.some((n) => n.includes('НЕ подключён'))).toBe(true);
  });

  it('компонентная трассируемость параметров fall-off доступна через концентрационный результат', () => {
    const result = runKineticCompartmentStep(compartment106(T106_K));
    const applied = result.concentrationStep.reactions[0];
    const catalog = buildKineticsCatalog();
    const record = catalog.get(ID106);
    if (record === null || record.rateConstant.status !== 'known') {
      throw new Error('запись №106 недоступна или не known');
    }
    const params = record.rateConstant.parameters;
    if (params.kind !== 'fall_off') {
      throw new Error('запись №106 не является fall-off');
    }
    expect(applied.parameterProvenance.lowPressureLimit).toBe(
      params.fallOff.lowPressureLimit.provenance
    );
    expect(applied.parameterProvenance.highPressureLimit).toBe(
      params.fallOff.highPressureLimit.provenance
    );
    expect(applied.parameterProvenance.broadening).toBe(params.fallOff.provenance);
  });
});

// --------------------------------------------
// 7. Численно устойчивые преобразования (корректирующий срез)
// --------------------------------------------
//
// Величины в граничных проверках — СИНТЕТИЧЕСКИЕ значения
// арифметики double: это проверка МАТЕМАТИКИ конвертеров, а НЕ
// утверждение о физических столбовых запасах. Ключевое различие:
// переполнение ПРОМЕЖУТОЧНОГО произведения НЕ равно непредставимости
// конечного итога; отказ invalid_input дают только непредставимые
// итоги (переполнение итога или underflow положительного входа
// в ноль).

describe('устойчивые конвертеры: представимый итог обязателен, промежуточное переполнение не ломает его', () => {
  it('прямое: промежуточное переполнение знаменателя НЕ отказ — итог представим (1e-3 моль/м², слой 1e305 м)', () => {
    // Математический итог 1e-3·N_A/(1e305·1e6) ≈ 6.02214076e-291
    // представим в Number; прежний порядок операций делил на
    // L·10⁶ = Infinity и молчаливо давал ноль.
    const result = columnInventoryMolM2ToConcentrationMoleculeCm3(1e-3, 1e305);
    expect(Number.isFinite(result)).toBe(true);
    expect(result > 0).toBe(true);
    expect(result / 6.02214076e-291).toBeCloseTo(1, 12);
  });

  it('обратное: промежуточное переполнение произведения НЕ отказ — итог представим (1e300 molecule/cm³, слой 1e10 м)', () => {
    // Математический итог 1e300·1e10·1e6/N_A ≈ 1.660539067e292
    // представим в Number; прежний порядок операций переполнялся на
    // произведении [X]·L·10⁶.
    const result = concentrationMoleculeCm3ToColumnInventoryMolM2(1e300, 1e10);
    expect(Number.isFinite(result)).toBe(true);
    expect(result > 0).toBe(true);
    expect(result / 1.6605390671738469e292).toBeCloseTo(1, 12);
  });

  it('прямое: действительное переполнение итога — invalid_input (1e300 моль/м², слой 1 м)', () => {
    // Итог 1e300·N_A/1e6 ≈ 6.0e317 не представим в Number ни при каком
    // порядке операций — в отличие от представимого случая со слоем
    // 1e305 м выше.
    const error = mechanismError(() =>
      columnInventoryMolM2ToConcentrationMoleculeCm3(1e300, 1)
    );
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('переполнение');
  });

  it('обратное: действительное переполнение итога — invalid_input (1e308 molecule/cm³, слой 1e20 м)', () => {
    // Итог 1e308·1e20·1e6/N_A ≈ 1.66e310 не представим ни при каком
    // порядке операций — в отличие от представимого случая 1e300
    // при слое 1e10 м выше.
    const error = mechanismError(() =>
      concentrationMoleculeCm3ToColumnInventoryMolM2(1e308, 1e20)
    );
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('переполнение');
  });

  it('прямое: действительный underflow положительного входа в ноль — invalid_input', () => {
    // Number.MIN_VALUE·N_A/(1e20·1e6) ≈ 3e-326 ниже минимального
    // субнормального числа double: итог не представим ни при каком
    // порядке операций.
    const error = mechanismError(() =>
      columnInventoryMolM2ToConcentrationMoleculeCm3(Number.MIN_VALUE, 1e20)
    );
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('underflow');
  });

  it('обратное: действительный underflow положительного входа в ноль — invalid_input', () => {
    // Number.MIN_VALUE·1e6/N_A ≈ 8e-342: итог не представим ни при
    // каком порядке операций.
    const error = mechanismError(() =>
      concentrationMoleculeCm3ToColumnInventoryMolM2(Number.MIN_VALUE, 1)
    );
    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('underflow');
  });

  it('явный ноль остаётся допустимым в обоих направлениях (0 → 0 без отказа)', () => {
    expect(columnInventoryMolM2ToConcentrationMoleculeCm3(0, LAYER_M)).toBe(0);
    expect(concentrationMoleculeCm3ToColumnInventoryMolM2(0, LAYER_M)).toBe(0);
  });

  it('тесты различают промежуточное переполнение и непредставимость итога', () => {
    // Прямое направление: слой 1e305 м — итог представим, возвращается
    // значение; слой 1 м с запасом 1e300 — итог непредставим, отказ.
    const representable = columnInventoryMolM2ToConcentrationMoleculeCm3(1e-3, 1e305);
    expect(representable / 6.02214076e-291).toBeCloseTo(1, 12);
    expect(
      mechanismError(() => columnInventoryMolM2ToConcentrationMoleculeCm3(1e300, 1)).code
    ).toBe('invalid_input');

    // Обратное направление: 1e300 при слое 1e10 м — итог представим;
    // 1e308 при слое 1e20 м — итог переполняет Number, отказ.
    const representableBack = concentrationMoleculeCm3ToColumnInventoryMolM2(1e300, 1e10);
    expect(representableBack / 1.6605390671738469e292).toBeCloseTo(1, 12);
    expect(
      mechanismError(() => concentrationMoleculeCm3ToColumnInventoryMolM2(1e308, 1e20)).code
    ).toBe('invalid_input');
  });

  it('шаг компартмента атомарно отказывает при непредставимом итоге преобразования запаса', () => {
    const input = {
      temperatureK: T89_K,
      dtSeconds: DT_FIXTURE_S,
      layerThicknessM: LAYER_M,
      reactionIds: [ID89],
      columnInventoriesMolM2: { O: 1e300, NO: 5e-6, NO2: 2e-7, N2: N2_COLUMN_MOL_M2 }
    };
    const snapshot = JSON.stringify(input);
    expect(mechanismError(() => runKineticCompartmentStep(input)).code).toBe('invalid_input');
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
