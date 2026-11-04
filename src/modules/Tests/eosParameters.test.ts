/**
 * Stage 4.4.4.1 — тесты каталога чистокомпонентных параметров Peng–Robinson.
 *
 * Проверяемый контракт (docs/science/IMPLEMENTATION_ROADMAP.md, §4.4.4.1):
 *  - каталог содержит ровно пять компонентов (co2, n2, ch4, h2o, ar);
 *  - каждое из трёх полей (Tc, Pc, omega) имеет СОБСТВЕННЫЙ полный provenance;
 *  - lookup и валидация fail-closed;
 *  - конфликты CH4-omega и Ar-critical не маскируются;
 *  - h2 исключён; фиктивных kij и значений по умолчанию нет.
 *
 * Числовые литералы в тестах — только опубликованные значения с указанием
 * первоисточника в комментарии; для них используются явные допуски.
 */

import { describe, it, expect } from 'vitest';

import {
  EOS_PURE_COMPONENT_IDS,
  EOS_PURE_COMPONENT_PARAMETERS,
  EOS_VALUE_ORIGINS,
  EOS_EVIDENCE_STATUSES,
  EOS_CROSS_CHECK_OUTCOMES,
  EOS_CATALOG_SCOPE_NOTE,
  EOS_H2_EXCLUSION_NOTE,
  EOS_NO_BINARY_INTERACTION_NOTE,
  getEosPureComponentParameters,
  validateEosScalarParameter,
  validateEosPureComponentRecord,
  validateEosCatalog,
  listEosPureComponentIds,
  EosParametersError
} from '../Data/eosParameters';

import type {
  EosPureComponentParameters,
  EosScalarParameter
} from '../Data/eosParameters';

import { getPhaseProperties } from '../Data/phaseProperties';
import gases from '../Data/gases';

// ----------------------------------------------------------------------------
// Вспомогательные функции
// ----------------------------------------------------------------------------

const PLANNED_IDS = ['co2', 'n2', 'ch4', 'h2o', 'ar'] as const;

/** Глубокая копия записи каталога для негативных тестов валидатора. */
function cloneRecord(id: (typeof PLANNED_IDS)[number]): EosPureComponentParameters {
  return JSON.parse(
    JSON.stringify(EOS_PURE_COMPONENT_PARAMETERS[id])
  ) as EosPureComponentParameters;
}

/**
 * Сравнение с относительным допуском: для критических параметров источники
 * приводят значения с разной точностью, поэтому проверяем относительное
 * отклонение от опубликованного значения.
 */
function expectCloseToPublished(actual: number, expected: number, relTol: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  const relDeviation = Math.abs(actual - expected) / Math.abs(expected);
  expect(relDeviation).toBeLessThan(relTol);
}

// ----------------------------------------------------------------------------
// 1. Состав каталога: ровно пять компонентов, по одному разу
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: состав каталога', () => {
  it('содержит ровно пять запланированных идентификаторов', () => {
    expect(EOS_PURE_COMPONENT_IDS).toEqual(['co2', 'n2', 'ch4', 'h2o', 'ar']);
    expect([...EOS_PURE_COMPONENT_IDS].sort()).toEqual([...PLANNED_IDS].sort());
  });

  it('каждый идентификатор присутствует в каталоге ровно один раз', () => {
    const keys = Object.keys(EOS_PURE_COMPONENT_PARAMETERS);
    expect(keys.sort()).toEqual([...PLANNED_IDS].sort());
    // «ровно один раз»: ключи объекта уникальны по построению,
    // но проверяем и отсутствие дублей в списке идентификаторов.
    expect(new Set(EOS_PURE_COMPONENT_IDS).size).toBe(PLANNED_IDS.length);
    expect(new Set(keys).size).toBe(PLANNED_IDS.length);
    for (const id of PLANNED_IDS) {
      expect(EOS_PURE_COMPONENT_PARAMETERS[id]).toBeDefined();
    }
  });

  it('h2 исключён из каталога', () => {
    expect(EOS_PURE_COMPONENT_IDS).not.toContain('h2');
    expect(Object.keys(EOS_PURE_COMPONENT_PARAMETERS)).not.toContain('h2');
    // ...и не импортирован «на будущее» ни в одном другом виде.
    for (const id of EOS_PURE_COMPONENT_IDS) {
      expect(id).not.toBe('h2');
    }
  });

  it('listEosPureComponentIds возвращает тот же состав', () => {
    expect(listEosPureComponentIds()).toEqual([...EOS_PURE_COMPONENT_IDS]);
  });
});

// ----------------------------------------------------------------------------
// 2-3. Числовые значения: положительность, конечность, знак omega
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: числовые значения полей', () => {
  it('Tc и Pc всех компонентов положительны и конечны', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      expect(Number.isFinite(rec.criticalTemperatureK.value)).toBe(true);
      expect(rec.criticalTemperatureK.value).toBeGreaterThan(0);
      expect(Number.isFinite(rec.criticalPressurePa.value)).toBe(true);
      expect(rec.criticalPressurePa.value).toBeGreaterThan(0);
    }
  });

  it('omega всех компонентов конечен', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const omega = EOS_PURE_COMPONENT_PARAMETERS[id].acentricFactor.value;
      expect(Number.isFinite(omega)).toBe(true);
    }
  });

  it('отрицательный omega допустим: аргон проходит валидацию', () => {
    const ar = EOS_PURE_COMPONENT_PARAMETERS.ar;
    expect(ar.acentricFactor.value).toBeLessThan(0);
    // Валидатор не обязан rejecting отрицательный ацентрический фактор:
    // для аргона это опубликованное значение (CoolProp: −0.00219).
    expect(validateEosPureComponentRecord(ar)).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// Опубликованные значения с допусками (независимое основание для литералов)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: опубликованные значения', () => {
  it('CO2: Tc/Pc/omega соответствуют Span & Wagner 1996 и CoolProp', () => {
    const co2 = EOS_PURE_COMPONENT_PARAMETERS.co2;
    // Span & Wagner 1996, JPCRD 25, 1509, doi:10.1063/1.555991:
    // Tc = 304.1282 K, Pc = 7.3773 MPa.
    expectCloseToPublished(co2.criticalTemperatureK.value, 304.1282, 1e-6);
    expectCloseToPublished(co2.criticalPressurePa.value, 7377300, 1e-6);
    // CoolProp v8.0.0, dev/fluids/CarbonDioxide.json, INFO.acentric = 0.22394.
    expectCloseToPublished(co2.acentricFactor.value, 0.22394, 1e-4);
  });

  it('N2: Tc/Pc/omega соответствуют Span et al. 2000 и CoolProp', () => {
    const n2 = EOS_PURE_COMPONENT_PARAMETERS.n2;
    // Span, Lemmon, Jacobsen, Wagner, Yokozeki 2000, JPCRD 29, 1361,
    // doi:10.1063/1.1349047: Tc = 126.192 K, Pc = 3.3958 MPa.
    expectCloseToPublished(n2.criticalTemperatureK.value, 126.192, 1e-6);
    expectCloseToPublished(n2.criticalPressurePa.value, 3395800, 1e-6);
    // CoolProp v8.0.0, dev/fluids/Nitrogen.json, INFO.acentric = 0.0372.
    expectCloseToPublished(n2.acentricFactor.value, 0.0372, 1e-4);
  });

  it('CH4: Tc/Pc соответствуют Setzmann & Wagner 1991', () => {
    const ch4 = EOS_PURE_COMPONENT_PARAMETERS.ch4;
    // Setzmann & Wagner 1991, JPCRD 20, 1061, doi:10.1063/1.555912:
    // Tc = 190.564 K, Pc = 4.5992 MPa.
    expectCloseToPublished(ch4.criticalTemperatureK.value, 190.564, 1e-6);
    expectCloseToPublished(ch4.criticalPressurePa.value, 4599200, 1e-6);
  });

  it('H2O: Tc/Pc/omega соответствуют IAPWS-95 и CoolProp', () => {
    const h2o = EOS_PURE_COMPONENT_PARAMETERS.h2o;
    // Wagner & Pruss 2002, JPCRD 31, 387, doi:10.1063/1.1461829 (IAPWS-95):
    // Tc = 647.096 K, Pc = 22.064 MPa.
    expectCloseToPublished(h2o.criticalTemperatureK.value, 647.096, 1e-6);
    expectCloseToPublished(h2o.criticalPressurePa.value, 22064000, 1e-6);
    // CoolProp v8.0.0, dev/fluids/Water.json: INFO.acentric = 0.3442920843
    // (литературное округление 0.3443; допуск 5e-4 покрывает округление).
    expectCloseToPublished(h2o.acentricFactor.value, 0.3443, 5e-4);
  });

  it('Ar: Tc/Pc/omega соответствуют Tegeler, Span & Wagner 1999 и CoolProp', () => {
    const ar = EOS_PURE_COMPONENT_PARAMETERS.ar;
    // Tegeler, Span & Wagner 1999, JPCRD 28, 779, doi:10.1063/1.556037:
    // Tc = 150.687 K, Pc = 4.863 MPa.
    expectCloseToPublished(ar.criticalTemperatureK.value, 150.687, 1e-6);
    expectCloseToPublished(ar.criticalPressurePa.value, 4863000, 1e-6);
    // CoolProp v8.0.0, dev/fluids/Argon.json, INFO.acentric = −0.00219.
    expectCloseToPublished(ar.acentricFactor.value, -0.00219, 1e-3);
  });
});

// ----------------------------------------------------------------------------
// 4. Per-field provenance: собственная идентификация у каждого из 15 полей
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: per-field provenance', () => {
  it('у каждого из 15 параметров собственный объект provenance (15 различных ссылок)', () => {
    const provenances: unknown[] = [];
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      provenances.push(
        rec.criticalTemperatureK.provenance,
        rec.criticalPressurePa.provenance,
        rec.acentricFactor.provenance
      );
    }
    // Set различает объекты по ссылке: 15 различных объектов-provenance.
    expect(provenances).toHaveLength(15);
    expect(new Set(provenances).size).toBe(15);
  });

  it('provenance каждого поля непуста и идентифицирует источник', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      for (const field of [
        rec.criticalTemperatureK,
        rec.criticalPressurePa,
        rec.acentricFactor
      ] as const) {
        const prov = field.provenance;
        expect(prov).toBeDefined();
        expect((prov.sourceName ?? '').length).toBeGreaterThan(0);
        // Хотя бы один идентификатор источника непуст (паттерн
        // hasSourceIdentification из Core/scientificValue.ts).
        const hasId =
          (prov.sourceId ?? '').length > 0 ||
          (prov.datasetId ?? '').length > 0 ||
          (prov.reference ?? '').length > 0;
        expect(hasId).toBe(true);
        expect((prov.reference ?? '').length).toBeGreaterThan(0);
        expect((prov.datasetVersion ?? '').length).toBeGreaterThan(0);
        expect((prov.retrievedAt ?? '').length).toBeGreaterThan(0);
        expect((prov.applicability ?? '').length).toBeGreaterThan(0);
        expect((prov.license ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('происхождение и статус доказательства — из типизированных реестров', () => {
    expect(EOS_VALUE_ORIGINS).toEqual(['reported', 'derived', 'software_dataset']);
    expect(EOS_EVIDENCE_STATUSES).toEqual([
      'VERIFIED',
      'PARTIALLY_VERIFIED',
      'UNRESOLVED_CROSS_CHECK',
      'UNRESOLVED'
    ]);
    expect(EOS_CROSS_CHECK_OUTCOMES).toEqual([
      'consistent',
      'consistent_within_rounding',
      'discrepancy'
    ]);
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      for (const field of [
        rec.criticalTemperatureK,
        rec.criticalPressurePa,
        rec.acentricFactor
      ] as const) {
        expect(EOS_VALUE_ORIGINS).toContain(field.provenance.origin);
        expect(EOS_EVIDENCE_STATUSES).toContain(field.provenance.evidence);
        // Однозначный указатель на upstream: DOI/URL в reference или datasetId.
        const reference = field.provenance.reference ?? '';
        const datasetId = field.provenance.datasetId ?? '';
        const hasUpstream =
          /\b10\.\d{4,9}\//.test(reference) || /https?:\/\//.test(reference) || datasetId !== '';
        expect(hasUpstream).toBe(true);
      }
    }
  });

  it('критические параметры помечены как reported из JPCRD-публикаций', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      expect(rec.criticalTemperatureK.provenance.origin).toBe('reported');
      expect(rec.criticalPressurePa.provenance.origin).toBe('reported');
      // sourceId = DOI публикации (doi:10.1063/...), reference содержит ту же цитату.
      expect(rec.criticalTemperatureK.provenance.sourceId).toMatch(/10\.1063\//);
      expect(rec.criticalPressurePa.provenance.sourceId).toMatch(/10\.1063\//);
      expect(rec.criticalTemperatureK.provenance.reference).toMatch(/10\.1063\//);
      expect(rec.criticalPressurePa.provenance.reference).toMatch(/10\.1063\//);
    }
  });

  it('omega помечен как software_dataset из CoolProp с точным коммитом', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const omega = EOS_PURE_COMPONENT_PARAMETERS[id].acentricFactor;
      expect(omega.provenance.origin).toBe('software_dataset');
      // Идентификация dataset: не просто «CoolProp», а репозиторий + коммит.
      expect(omega.provenance.datasetId).toMatch(/dev\/fluids\//);
      expect(omega.provenance.datasetVersion).toMatch(/8eb3b778/);
      expect(omega.provenance.reference).toMatch(/github\.com\/CoolProp\/CoolProp/);
    }
  });
});

// ----------------------------------------------------------------------------
// 5. Единицы измерения
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: единицы измерения', () => {
  it('Tc в кельвинах, Pc в паскалях, omega безразмерный (unit \'1\')', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      expect(rec.criticalTemperatureK.unit).toBe('K');
      expect(rec.criticalPressurePa.unit).toBe('Pa');
      expect(rec.acentricFactor.unit).toBe('1');
    }
  });
});

// ----------------------------------------------------------------------------
// 6-7. Смешение источников и отказ при отсутствии provenance
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: смешение источников и fail-closed provenance', () => {
  it('смешение источников в записи допустимо только с явной provenance у каждого поля', () => {
    // Реальный каталог смешивает происхождения (Tc/Pc — JPCRD, omega — CoolProp),
    // но каждое поле несёт собственную полную provenance, поэтому запись валидна.
    for (const id of EOS_PURE_COMPONENT_IDS) {
      expect(validateEosPureComponentRecord(EOS_PURE_COMPONENT_PARAMETERS[id])).toEqual([]);
    }
    expect(validateEosCatalog(EOS_PURE_COMPONENT_PARAMETERS)).toEqual([]);
  });

  it('поле без идентификации источника не проходит валидацию', () => {
    const rec = cloneRecord('ch4');
    // Затираем ВСЕ идентификаторы источника у omega, оставляя само значение.
    rec.acentricFactor.provenance = {
      ...rec.acentricFactor.provenance,
      sourceName: '',
      sourceId: '',
      datasetId: '',
      reference: ''
    };
    const errors = validateEosPureComponentRecord(rec);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('идентифицирует'))).toBe(true);
  });

  it('отсутствие provenance любого из трёх параметров вызывает отказ', () => {
    for (const field of [
      'criticalTemperatureK',
      'criticalPressurePa',
      'acentricFactor'
    ] as const) {
      const rec = cloneRecord('n2');
      (rec[field] as EosScalarParameter).provenance = undefined as never;
      const errors = validateEosPureComponentRecord(rec);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('provenance'))).toBe(true);
    }
  });
});

// ----------------------------------------------------------------------------
// 8. Неизвестный идентификатор: структурированная ошибка
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: lookup fail-closed', () => {
  it('неизвестный ID h2 даёт структурированную ошибку unknown_gas', () => {
    try {
      getEosPureComponentParameters('h2');
      expect.unreachable('ожидали отказ для h2');
    } catch (error) {
      expect(error).toBeInstanceOf(EosParametersError);
      const err = error as EosParametersError;
      expect(err.code).toBe('unknown_gas');
      expect(err.gasId).toBe('h2');
      expect(err.message).toMatch(/h2/i);
    }
  });

  it('другие неизвестные ID тоже дают unknown_gas', () => {
    for (const id of ['c2h6', 'o2', 'ne', 'methane', '']) {
      expect(() => getEosPureComponentParameters(id as never)).toThrowError(EosParametersError);
      try {
        getEosPureComponentParameters(id as never);
      } catch (error) {
        expect((error as EosParametersError).code).toBe('unknown_gas');
      }
    }
  });

  it('пустой ID не возвращает запись', () => {
    expect(() => getEosPureComponentParameters('' as never)).toThrowError(/unknown_gas|пуст/);
  });

  it('валидный ID возвращает запись каталога (конвенция getPhaseProperties)', () => {
    // Lookup возвращает запись каталога напрямую — как getPhaseProperties
    // в phaseProperties.ts; каталог константен, копирование не выполняется.
    const rec = getEosPureComponentParameters('co2');
    expect(rec).toBe(EOS_PURE_COMPONENT_PARAMETERS.co2);
  });
});

// ----------------------------------------------------------------------------
// 9. Статусы доказательств: неполный/конфликтный набор не выдаётся за VERIFIED
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: честность статусов', () => {
  it('Tc/Pc всех компонентов — VERIFIED', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      expect(rec.criticalTemperatureK.provenance.evidence).toBe('VERIFIED');
      expect(rec.criticalPressurePa.provenance.evidence).toBe('VERIFIED');
    }
  });

  it('omega нигде не объявлен VERIFIED: CoolProp не даёт per-value библиографии', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      expect(rec.acentricFactor.provenance.evidence).not.toBe('VERIFIED');
      expect(EOS_EVIDENCE_STATUSES).toContain(rec.acentricFactor.provenance.evidence);
    }
  });

  it('omega четырёх компонентов — PARTIALLY_VERIFIED', () => {
    for (const id of ['co2', 'n2', 'h2o', 'ar'] as const) {
      expect(EOS_PURE_COMPONENT_PARAMETERS[id].acentricFactor.provenance.evidence)
        .toBe('PARTIALLY_VERIFIED');
    }
  });

  it('omega CH4 — UNRESOLVED_CROSS_CHECK (конфликт с Antoine-расчётом не закрыт)', () => {
    expect(EOS_PURE_COMPONENT_PARAMETERS.ch4.acentricFactor.provenance.evidence)
      .toBe('UNRESOLVED_CROSS_CHECK');
  });
});

// ----------------------------------------------------------------------------
// 10. Конфликты CH4 и Ar сохранены, а не скрыты
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: зафиксированные расхождения', () => {
  it('CH4: независимый Antoine-расчет даёт ~0.00661, а не 0.01142', () => {
    // Метод: определение Питцера omega = -log10(Psat(0.7*Tc)/Pc) - 1,
    // Psat — Antoine-корреляция Prydz & Goodwin 1972 (NIST Chemistry WebBook):
    // log10(P/bar) = 3.9895 - 443.028/(T/K - 0.49).
    // Tc = 190.564 K, Pc = 45.992 bar (Setzmann & Wagner 1991).
    const tcK = 190.564;
    const pcBar = 45.992;
    const t = 0.7 * tcK;
    const psatBar = Math.pow(10, 3.9895 - 443.028 / (t - 0.49));
    const antoineOmega = -Math.log10(psatBar / pcBar) - 1;

    // Независимый расчёт: omega ≈ 0.00661.
    expect(antoineOmega).toBeCloseTo(0.00661, 4);

    // Расхождение с хранимым значением CoolProp существенно и не замаскировано.
    const stored = EOS_PURE_COMPONENT_PARAMETERS.ch4.acentricFactor.value;
    expect(Math.abs(stored - antoineOmega)).toBeGreaterThan(0.004);
  });

  it('CH4: crossCheck фиксирует расхождение omega с Antoine-источником', () => {
    const ch4 = EOS_PURE_COMPONENT_PARAMETERS.ch4;
    const omegaCheck = ch4.crossChecks.find((c) => c.subject === 'acentricFactor');
    expect(omegaCheck).toBeDefined();
    expect(omegaCheck?.outcome).toBe('discrepancy');
    expect(omegaCheck?.crossValue).toContain('0.00661');
    expect(omegaCheck?.resolution).toContain('UNRESOLVED_CROSS_CHECK');
  });

  it('CH4: хранимое значение остаётся значением CoolProp, а не Antoine-подгонкой', () => {
    // CoolProp v8.0.0, dev/fluids/Methane.json, INFO.acentric = 0.01142.
    expectCloseToPublished(
      EOS_PURE_COMPONENT_PARAMETERS.ch4.acentricFactor.value,
      0.01142,
      1e-4
    );
  });

  it('Ar: crossCheck фиксирует расхождение критической точки с легаси-каталогом', () => {
    const ar = EOS_PURE_COMPONENT_PARAMETERS.ar;
    const legacyCheck = ar.crossChecks.find(
      (c) => c.crossSource.includes('phaseProperties')
    );
    expect(legacyCheck).toBeDefined();
    expect(legacyCheck?.outcome).toBe('discrepancy');
    // Легаси-значения фиксируются дословно: Tc = 150.86 K, pc = 48.98 bar.
    expect(legacyCheck?.crossValue).toContain('150.86');
    expect(legacyCheck?.crossValue).toContain('48.98');
    expect(legacyCheck?.resolution).toContain('РАСХОЖДЕНИЕ');
  });

  it('Ar: EOS-каталог хранит параметры Tegeler–Span–Wagner, а не легаси-округления', () => {
    // Tegeler, Span & Wagner 1999, doi:10.1063/1.556037:
    // Tc = 150.687 K, Pc = 4.863 MPa (= 4863000 Pa).
    const ar = EOS_PURE_COMPONENT_PARAMETERS.ar;
    expectCloseToPublished(ar.criticalTemperatureK.value, 150.687, 1e-6);
    expectCloseToPublished(ar.criticalPressurePa.value, 4863000, 1e-6);
    expect(ar.criticalTemperatureK.value).not.toBe(150.86);
    expect(ar.criticalPressurePa.value).not.toBe(4898000);
  });

  it('легаси phaseProperties не изменён: критическая точка Ar остаётся исторической', () => {
    // Stage 4.4.4.1 не редактирует phaseProperties.ts: старое значение
    // остаётся историческим состоянием другого модуля до отдельного решения.
    const legacyAr = getPhaseProperties('ar');
    expect(legacyAr).toBeDefined();
    expect(legacyAr?.criticalPoint?.temperatureK).toBe(150.86);
    expect(legacyAr?.criticalPoint?.pressureBar).toBe(48.98);
  });

  it('остальные компоненты: легаси-значения сверены и помечены consistent_within_rounding', () => {
    // Исторические значения phaseProperties.ts (округления/компиляции тех же
    // первоисточников): co2 304.13 K / 73.8 bar; n2 126.21 K / 33.98 bar;
    // ch4 190.56 K / 45.99 bar; h2o 647.1 K / 220.64 bar.
    const pairs = [
      { id: 'co2', tc: 304.13, pcBar: 73.8 },
      { id: 'n2', tc: 126.21, pcBar: 33.98 },
      { id: 'ch4', tc: 190.56, pcBar: 45.99 },
      { id: 'h2o', tc: 647.1, pcBar: 220.64 }
    ] as const;
    for (const { id, tc, pcBar } of pairs) {
      const legacy = getPhaseProperties(id);
      expect(legacy?.criticalPoint?.temperatureK).toBe(tc);
      expect(legacy?.criticalPoint?.pressureBar).toBe(pcBar);
      // Сверка с легаси зафиксирована в crossChecks с честным исходом.
      const legacyCheck = EOS_PURE_COMPONENT_PARAMETERS[id].crossChecks.find(
        (c) => c.crossSource.includes('phaseProperties')
      );
      expect(legacyCheck?.outcome).toBe('consistent_within_rounding');
    }
  });
});

// ----------------------------------------------------------------------------
// Негативные тесты валидатора скалярных параметров
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: валидатор скалярного параметра', () => {
  const validTc = (): EosScalarParameter =>
    JSON.parse(
      JSON.stringify(EOS_PURE_COMPONENT_PARAMETERS.co2.criticalTemperatureK)
    ) as EosScalarParameter;

  it('отклоняет неположительные и нечисловые Tc', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = validTc();
      p.value = bad;
      expect(
        validateEosScalarParameter(p, 'K', 'criticalTemperatureK', { positive: true }).length
      ).toBeGreaterThan(0);
    }
  });

  it('отклоняет отрицательное Pc', () => {
    const p = validTc();
    p.unit = 'Pa';
    p.value = -3395800;
    expect(
      validateEosScalarParameter(p, 'Pa', 'criticalPressurePa', { positive: true }).length
    ).toBeGreaterThan(0);
  });

  it('отклоняет NaN/Infinity у omega', () => {
    const p = validTc();
    p.unit = '1';
    p.value = Number.NaN;
    expect(
      validateEosScalarParameter(p, '1', 'acentricFactor', { positive: false }).length
    ).toBeGreaterThan(0);
    p.value = Number.POSITIVE_INFINITY;
    expect(
      validateEosScalarParameter(p, '1', 'acentricFactor', { positive: false }).length
    ).toBeGreaterThan(0);
  });

  it('отклоняет несовместимые единицы', () => {
    const p = validTc();
    p.unit = 'bar'; // Pc в барах нарушает контракт каталога (требуются Pa).
    expect(
      validateEosScalarParameter(p, 'Pa', 'criticalPressurePa', { positive: true }).length
    ).toBeGreaterThan(0);
    const q = validTc();
    q.unit = 'MPa';
    expect(
      validateEosScalarParameter(q, 'K', 'criticalTemperatureK', { positive: true }).length
    ).toBeGreaterThan(0);
  });

  it('отклоняет неизвестные origin и evidence', () => {
    const p = validTc();
    (p.provenance as { origin: string }).origin = 'measured';
    expect(
      validateEosScalarParameter(p, 'K', 'criticalTemperatureK', { positive: true }).length
    ).toBeGreaterThan(0);
    const q = validTc();
    (q.provenance as { evidence: string }).evidence = 'CONFIRMED';
    expect(
      validateEosScalarParameter(q, 'K', 'criticalTemperatureK', { positive: true }).length
    ).toBeGreaterThan(0);
  });

  it('отклоняет незаполненные обязательные поля provenance', () => {
    for (const key of [
      'datasetVersion',
      'retrievedAt',
      'applicability',
      'license'
    ] as const) {
      const p = validTc();
      ((p.provenance as unknown) as Record<string, unknown>)[key] = '';
      expect(
        validateEosScalarParameter(p, 'K', 'criticalTemperatureK', { positive: true }).length
      ).toBeGreaterThan(0);
    }
  });

  it('отклоняет provenance без upstream-указателя (DOI/URL/datasetId)', () => {
    const p = validTc();
    p.provenance = {
      ...p.provenance,
      // Убираем однозначный указатель: ни DOI, ни URL в reference, ни datasetId.
      datasetId: '',
      sourceId: '',
      reference: 'значение источника без однозначного указателя на upstream'
    };
    const errors = validateEosScalarParameter(p, 'K', 'criticalTemperatureK', {
      positive: true
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes('upstream'))).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// Негативные тесты валидатора записи и каталога
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: валидатор записи и каталога', () => {
  it('запись с невалидным полем не проходит валидацию целиком', () => {
    const rec = cloneRecord('h2o');
    rec.criticalPressurePa.value = Number.NaN;
    const errors = validateEosPureComponentRecord(rec);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('gasId, не совпадающий с ключом каталога, отклоняется', () => {
    const catalog: Record<string, EosPureComponentParameters> = {
      ...EOS_PURE_COMPONENT_PARAMETERS
    };
    catalog.ar = { ...cloneRecord('ar'), gasId: 'argon' };
    const errors = validateEosCatalog(catalog);
    expect(errors.some((e) => e.includes('не совпадает с ключом'))).toBe(true);
  });

  it('посторонний компонент в каталоге отклоняется', () => {
    const catalog: Record<string, EosPureComponentParameters> = {
      ...EOS_PURE_COMPONENT_PARAMETERS,
      ne: cloneRecord('ar')
    };
    const errors = validateEosCatalog(catalog);
    expect(errors.some((e) => e.includes('посторонний компонент'))).toBe(true);
  });

  it('отсутствие обязательного компонента отклоняется', () => {
    const catalog: Partial<Record<string, EosPureComponentParameters>> = {
      ...EOS_PURE_COMPONENT_PARAMETERS
    };
    delete catalog.ar;
    const errors = validateEosCatalog(catalog);
    expect(errors.some((e) => e.includes('отсутствует обязательный компонент'))).toBe(true);
  });

  it('валидный каталог не даёт ошибок', () => {
    expect(validateEosCatalog(EOS_PURE_COMPONENT_PARAMETERS)).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// Отсутствие фиктивных kij и значений по умолчанию
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: границы подэтапа', () => {
  it('записи не содержат фиктивных бинарных параметров', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const keys = Object.keys(EOS_PURE_COMPONENT_PARAMETERS[id]);
      expect(keys).not.toContain('kij');
      expect(keys).not.toContain('binaryInteractionParameter');
      expect(keys.join(' ')).not.toMatch(/kij/i);
    }
  });

  it('сопроводительные заметки фиксируют границы Stage 4.4.4.1', () => {
    // Заметка о составе каталога.
    expect(EOS_CATALOG_SCOPE_NOTE).toMatch(/пяти веществ/);
    expect(EOS_CATALOG_SCOPE_NOTE).toMatch(/co2, n2, ch4, h2o, ar/);
    expect(EOS_CATALOG_SCOPE_NOTE).toMatch(/fail-closed/);
    // Заметка об исключении h2.
    expect(EOS_H2_EXCLUSION_NOTE).toMatch(/изомер/);
    expect(EOS_H2_EXCLUSION_NOTE).toMatch(/квантов/);
    // Заметка об отсутствии kij.
    expect(EOS_NO_BINARY_INTERACTION_NOTE).toMatch(/kij/);
    expect(EOS_NO_BINARY_INTERACTION_NOTE).toMatch(/не существует/);
  });

  it('ограничения H2O зафиксированы в записи каталога', () => {
    const h2o = EOS_PURE_COMPONENT_PARAMETERS.h2o;
    expect(h2o.limitations.length).toBeGreaterThan(0);
    expect(h2o.limitations.some((l) => /полярн/i.test(l))).toBe(true);
    expect(h2o.limitations.some((l) => /ассоциац|водородн/i.test(l))).toBe(true);
    expect(
      h2o.limitations.some((l) => /смес|бинарн/i.test(l))
    ).toBe(true);
  });

  it('формулы и имена согласованы с существующим каталогом газов', () => {
    // Идентификаторы привязаны к существующей модели: 5 записей сверены с
    // Data/gases.ts (id/formula/name) — без дублирования химических сущностей.
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const rec = EOS_PURE_COMPONENT_PARAMETERS[id];
      const gas = gases.find((g) => g.id === id);
      expect(gas).toBeDefined();
      expect(rec.formula).toBe(gas?.formula);
      expect(rec.name).toBe(gas?.name);
    }
  });
});

// ----------------------------------------------------------------------------
// 11. Детерминизм
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.1: детерминизм', () => {
  it('повторные lookup дают идентичные результаты', () => {
    for (const id of EOS_PURE_COMPONENT_IDS) {
      const first = getEosPureComponentParameters(id);
      const second = getEosPureComponentParameters(id);
      expect(first).toEqual(second);
      // Конвенция проекта (как getPhaseProperties): lookup возвращает запись
      // каталога напрямую; результат стабилен между вызовами.
      expect(first).toBe(second);
    }
  });

  it('повторные валидации каталога детерминированы', () => {
    const first = validateEosCatalog(EOS_PURE_COMPONENT_PARAMETERS);
    const second = validateEosCatalog(EOS_PURE_COMPONENT_PARAMETERS);
    expect(first).toEqual(second);
    expect(first).toEqual([]);
  });

  it('JSON round-trip не искажает запись', () => {
    const original = getEosPureComponentParameters('n2');
    const roundTripped = JSON.parse(JSON.stringify(original)) as EosPureComponentParameters;
    expect(roundTripped).toEqual(original);
  });

  it('listEosPureComponentIds стабилен между вызовами', () => {
    expect(listEosPureComponentIds()).toEqual(listEosPureComponentIds());
  });
});
