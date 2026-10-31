// ============================================
// STAGE 4.3.2 - Тесты термодинамического каталога первой
// партии: 20 газовых веществ с данными NASA Glenn CEA
// ============================================
//
// Проверяются требования подэтапа 4.3.2:
// - ровно 20 различных веществ, без дублей id и формул, все gas;
// - каждая запись валидна (validateSpecies и
//   validateThermodynamicProperties с expectedPhase gas);
// - ΔfH°(298.15 K) — known с provenance записи (known/estimated
//   значения без provenance запрещены моделью);
// - S°(298.15 K) и ΔfG°(298.15 K) — unknown без quantity и без
//   выдуманных нулей; ΔfG° НЕ вычисляется автоматически;
// - NASA-7: у каждого сегмента ровно 7 конечных коэффициентов,
//   сегменты published, диапазоны упорядочены и стыкуются;
// - коэффициенты и ΔfH° соответствуют записи источника
//   (спот-чек литералов из data/thermo.inp, коммит nasa/cea
//   2f79a647e85737742fb08a127da00d1ea1d069da);
// - reference state согласован с фазой записи;
// - записи не перемешаны (provenance каждого вида указывает на
//   его собственную запись источника);
// - детерминированность сборки;
// - отсутствие записи не порождает выдуманных данных.
//
// Числа в тестах взяты из записи NASA CEA thermo.inp (источник
// данных каталога), а НЕ из NIST/ATcT: внешние справочники не
// копируются.

import { describe, it, expect } from 'vitest';
import {
  buildThermodynamicCatalog,
  NASA_CEA_THERMO_DATA,
  NASA_CEA_THERMO_SOURCE,
  NEW_GAS_SPECIES,
  THERMODYNAMIC_CATALOG_SPECIES_IDS
} from '../Data/thermodynamicCatalog';
import type { NasaCeaGasRecordId } from '../Data/thermodynamicCatalog';
import { validateSpecies } from '../Core/species';
import { validateThermodynamicProperties } from '../Core/thermodynamics';

const IDS: readonly NasaCeaGasRecordId[] = THERMODYNAMIC_CATALOG_SPECIES_IDS;

// ΔfH°(298.15 K), Дж/моль — поля записей data/thermo.inp (nasa/cea@2f79a647).
const EXPECTED_HF: Record<NasaCeaGasRecordId, number> = {
  ar: 0,
  he: 0,
  ne: 0,
  h2: 0,
  n2: 0,
  o2: 0,
  h2o: -241826,
  co: -110535.196,
  co2: -393510,
  ch4: -74600,
  nh3: -45940,
  c2h6: -83851.544,
  so2: -296810,
  h2s: -20600,
  no: 91271.31,
  n2o: 81600,
  c2h2: 228200,
  c2h4: 52500,
  c3h8: -104680,
  ch3oh: -200940
};

// Молярные массы 8 новых видов, кг/моль — поля записей (г/моль × 1e-3).
const EXPECTED_MOLAR_MASS_NEW: Record<string, number> = {
  so2: 64.0638e-3,
  h2s: 34.08088e-3,
  no: 30.0061e-3,
  n2o: 44.0128e-3,
  c2h2: 26.03728e-3,
  c2h4: 28.05316e-3,
  c3h8: 44.09562e-3,
  ch3oh: 32.04186e-3
};

// Элементные составы 8 новых видов — из строк записей thermo.inp.
const EXPECTED_ELEMENTS_NEW: Record<string, Record<string, number>> = {
  so2: { S: 1, O: 2 },
  h2s: { H: 2, S: 1 },
  no: { N: 1, O: 1 },
  n2o: { N: 2, O: 1 },
  c2h2: { C: 2, H: 2 },
  c2h4: { C: 2, H: 4 },
  c3h8: { C: 3, H: 8 },
  ch3oh: { C: 1, H: 4, O: 1 }
};

describe('Stage 4.3.2: термодинамический каталог первой партии NASA CEA', () => {
  it('содержит ровно 20 газовых веществ без дублей id и формул', () => {
    const catalog = buildThermodynamicCatalog();
    const list = catalog.listIds();
    expect(list).toHaveLength(20);
    expect(new Set(list).size).toBe(20);
    expect(catalog.size()).toBe(20);
    const formulas = IDS.map((id) => catalog.get(id)?.formula);
    expect(new Set(formulas).size).toBe(20);
  });

  it('все записи — газовая фаза и проходят валидацию вида и термодинамики', () => {
    const catalog = buildThermodynamicCatalog();
    for (const id of IDS) {
      const species = catalog.get(id);
      expect(species, `вид ${id} должен быть в каталоге`).not.toBeNull();
      expect(species?.phase).toBe('gas');
      expect(species?.thermodynamics, `вид ${id} должен иметь блок термодинамики`).toBeDefined();
      expect(validateSpecies(species!)).toEqual([]);
      expect(
        validateThermodynamicProperties(species!.thermodynamics!, { speciesId: id, expectedPhase: 'gas' }),
        `термодинамика вида ${id} должна быть валидна`
      ).toEqual([]);
    }
  });

  it('ΔfH°(298.15 K) каждого вида — known с полным provenance записи NASA CEA', () => {
    const catalog = buildThermodynamicCatalog();
    for (const id of IDS) {
      const value = catalog.get(id)!.thermodynamics!.standardFormationEnthalpy;
      expect(value.status, `ΔfH° вида ${id}`).toBe('known');
      if (value.status !== 'known') continue;
      expect(value.quantity.unit).toBe('J_mol');
      expect(value.quantity.value).toBe(EXPECTED_HF[id]);
      const provenance = value.provenance;
      expect(provenance, `ΔfH° вида ${id} должна иметь provenance`).toBeDefined();
      expect(provenance!.sourceName).toBe(NASA_CEA_THERMO_SOURCE.sourceName);
      expect(provenance!.sourceId).toBe('nasa/cea');
      expect(provenance!.datasetId).toBe('data/thermo.inp');
      expect(provenance!.datasetVersion).toBe('2f79a647e85737742fb08a127da00d1ea1d069da');
      expect(provenance!.recordId).toBe(NASA_CEA_THERMO_DATA[id].recordId);
      expect(provenance!.license).toBe('Apache-2.0');
      expect(provenance!.reference ?? '').toContain('NASA TP-2002-211556');
    }
  });

  it('S° и ΔfG° — unknown без quantity и без подмены нулями', () => {
    const catalog = buildThermodynamicCatalog();
    for (const id of IDS) {
      const thermo = catalog.get(id)!.thermodynamics!;
      for (const label of ['standardEntropy', 'standardFormationGibbsEnergy'] as const) {
        const value = thermo[label];
        expect(value.status, `${label} вида ${id}`).toBe('unknown');
        expect((value as { quantity?: unknown }).quantity).toBeUndefined();
        expect((value as { note?: string }).note ?? '').not.toBe('');
      }
    }
  });

  it('ΔfG° не вычислена автоматически: пояснение описывает отсутствие вычислителя', () => {
    const catalog = buildThermodynamicCatalog();
    for (const id of IDS) {
      const value = catalog.get(id)!.thermodynamics!.standardFormationGibbsEnergy;
      expect(value.status).toBe('unknown');
      expect((value as { note?: string }).note ?? '').toContain('не вычисляется');
    }
  });

  it('Cp: NASA-7 с сегментами по 7 конечных коэффициентов, origin numerical_approximation', () => {
    const catalog = buildThermodynamicCatalog();
    for (const id of IDS) {
      const heatCapacity = catalog.get(id)!.thermodynamics!.heatCapacity;
      expect(heatCapacity.status).toBe('known');
      expect(heatCapacity.tabulated).toBeUndefined();
      const nasa7 = heatCapacity.nasa7;
      expect(nasa7, `NASA-7 вида ${id}`).toBeDefined();
      expect(nasa7!.segments.length).toBeGreaterThanOrEqual(2);
      for (const segment of nasa7!.segments) {
        expect(segment.quantity).toBe('Cp_over_R');
        expect(segment.coefficients).toHaveLength(7);
        for (const coefficient of segment.coefficients) {
          expect(Number.isFinite(coefficient)).toBe(true);
        }
        expect(segment.derivation.kind).toBe('published');
        expect(segment.derivation.provenance.origin).toBe('numerical_approximation');
        expect(segment.derivation.provenance.method ?? '').not.toBe('');
        expect(segment.derivation.provenance.recordId).toBe(NASA_CEA_THERMO_DATA[id].recordId);
      }
    }
  });

  it('диапазоны сегментов упорядочены, стыкуются и соответствуют записи источника', () => {
    const catalog = buildThermodynamicCatalog();
    for (const id of IDS) {
      const record = NASA_CEA_THERMO_DATA[id];
      const segments = catalog.get(id)!.thermodynamics!.heatCapacity.nasa7!.segments;
      expect(segments.length).toBe(record.segments.length);
      for (let i = 0; i < segments.length; i++) {
        expect(segments[i].rangeK.min.value).toBe(record.segments[i].rangeMinK);
        expect(segments[i].rangeK.max.value).toBe(record.segments[i].rangeMaxK);
        expect(segments[i].rangeK.min.unit).toBe('K');
        expect(segments[i].rangeK.max.value).toBeGreaterThan(segments[i].rangeK.min.value);
        if (i > 0) {
          expect(segments[i].rangeK.min.value).toBe(segments[i - 1].rangeK.max.value);
        }
      }
      // нижние границы записи — 200 или 300 K (обновление Snyder 09.09.2021),
      // верхняя граница первого сегмента — 1000 K
      expect([200, 300]).toContain(segments[0].rangeK.min.value);
      expect(segments[0].rangeK.max.value).toBe(1000);
      expect([6000, 20000]).toContain(segments[segments.length - 1].rangeK.max.value);
    }
  });

  it('коэффициенты NASA-7 соответствуют записи источника (спот-чек литералов)', () => {
    // N2, нижний сегмент 200-1000 K
    expect(NASA_CEA_THERMO_DATA.n2.segments[0].coefficients).toEqual([
      2.210371497e+04, -3.818461820e+02, 6.082738360e+00, -8.530914410e-03,
      1.384646189e-05, -9.625793620e-09, 2.519705809e-12
    ]);
    expect(NASA_CEA_THERMO_DATA.n2.segments[0].enthalpyConstantOverR).toBe(7.108460860e+02);
    expect(NASA_CEA_THERMO_DATA.n2.segments[0].entropyConstantOverR).toBe(-1.076003744e+01);
    // H2O, нижний сегмент 200-1000 K
    expect(NASA_CEA_THERMO_DATA.h2o.segments[0].coefficients).toEqual([
      -3.947960830e+04, 5.755731020e+02, 9.317826530e-01, 7.222712860e-03,
      -7.342557370e-06, 4.955043490e-09, -1.336933246e-12
    ]);
    // O2, нижний сегмент 200-1000 K
    expect(NASA_CEA_THERMO_DATA.o2.segments[0].coefficients).toEqual([
      -3.425563420e+04, 4.847000970e+02, 1.119010961e+00, 4.293889240e-03,
      -6.836300520e-07, -2.023372700e-09, 1.039040018e-12
    ]);
    // CO2, верхний сегмент 1000-6000 K
    expect(NASA_CEA_THERMO_DATA.co2.segments[1].coefficients).toEqual([
      1.176962419e+05, -1.788791477e+03, 8.291523190e+00, -9.223156780e-05,
      4.863676880e-09, -1.891053312e-12, 6.330036590e-16
    ]);
  });

  it('молярные массы новых видов соответствуют записи источника', () => {
    const catalog = buildThermodynamicCatalog();
    for (const definition of NEW_GAS_SPECIES) {
      const species = catalog.get(definition.id)!;
      expect(species.molarMassKgMol).toBe(EXPECTED_MOLAR_MASS_NEW[definition.id]);
      expect(species.molarMassStatus).toBe('known');
      expect(species.charge).toBe(0);
      expect(species.elements).toEqual(EXPECTED_ELEMENTS_NEW[definition.id]);
      expect(species.provenance?.recordId).toBe(NASA_CEA_THERMO_DATA[definition.id].recordId);
    }
    expect(NEW_GAS_SPECIES).toHaveLength(8);
  });

  it('reference state: газ, 298.15 K, стандартное состояние описано явно', () => {
    const catalog = buildThermodynamicCatalog();
    for (const id of IDS) {
      const referenceState = catalog.get(id)!.thermodynamics!.referenceState;
      expect(referenceState, `reference state вида ${id}`).toBeDefined();
      expect(referenceState!.phase).toBe('gas');
      expect(referenceState!.temperature?.value).toBe(298.15);
      expect(referenceState!.temperature?.unit).toBe('K');
      expect(referenceState!.pressure).toBeUndefined();
      expect(referenceState!.standardState.length).toBeGreaterThan(0);
    }
  });

  it('записи не перемешаны: каждый вид ссылается на свою запись источника', () => {
    const catalog = buildThermodynamicCatalog();
    for (const id of IDS) {
      const record = NASA_CEA_THERMO_DATA[id];
      const species = catalog.get(id)!;
      expect(species.thermodynamics!.provenance?.recordId).toBe(record.recordId);
      expect(species.thermodynamics!.note ?? '').toContain(record.recordId);
    }
    // co и co2 — разные вещества с разными ΔfH°
    const coHf = catalog.get('co')!.thermodynamics!.standardFormationEnthalpy;
    const co2Hf = catalog.get('co2')!.thermodynamics!.standardFormationEnthalpy;
    expect(coHf.status === 'known' ? coHf.quantity.value : null).toBe(-110535.196);
    expect(co2Hf.status === 'known' ? co2Hf.quantity.value : null).toBe(-393510);
  });

  it('идентификатор записи C2H2 сохраняет исходную форму источника', () => {
    expect(NASA_CEA_THERMO_DATA.c2h2.recordId).toBe('C2H2,acetylene');
    expect(NASA_CEA_THERMO_DATA.c2h2.sourceCode).toBe('g 1/91');
  });

  it('детерминированность: повторная сборка даёт идентичный каталог', () => {
    const first = buildThermodynamicCatalog();
    const second = buildThermodynamicCatalog();
    expect(first.listIds()).toEqual(second.listIds());
    for (const id of IDS) {
      expect(JSON.stringify(second.get(id))).toBe(JSON.stringify(first.get(id)));
    }
  });

  it('отсутствующая запись не порождает выдуманных данных', () => {
    const catalog = buildThermodynamicCatalog();
    expect(catalog.get('so3')).toBeNull();
    expect(catalog.has('so3')).toBe(false);
    expect(catalog.get('')).toBeNull();
    expect(catalog.size()).toBe(20);
  });
});
