/**
 * Stage 4.4.4.3 — тесты многокомпонентного Peng–Robinson:
 * правила смешения, кубика смеси, компонентные фугитивности.
 *
 * Проверяемый контракт (§3-§6 задачи Stage 4.4.4.3):
 *  - однокомпонентный предел ПОБИТОВО совпадает с чистым PR 4.4.4.2;
 *  - идеальный предел P -> 0: Z -> 1, phi_i -> 1;
 *  - бинарные/тернарные смеси с известными kij (каталог 4.4.4.3);
 *  - симметрия результата при перестановке компонентов состава;
 *  - правильность a_mix, b_mix, A_mix, B_mix против НЕЗАВИСИМОГО
 *    пересчёта в тесте (не кода Core);
 *  - компонентные ln(phi_i), phi_i, f_i = x_i phi_i P;
 *  - отказы: отсутствующий kij (fail-closed, НЕ kij = 0), невалидный
 *    состав, асимметричный kij, вне диапазона применимости, политика
 *    evidence, неизвестный компонент;
 *  - молчаливая нормализация состава НЕ выполняется.
 *
 * Числовые литералы параметров — опубликованные значения каталога
 * Stage 4.4.4.1 (первоисточники в Tests/eosParameters.test.ts).
 */

import { describe, it, expect } from 'vitest';

import { computePengRobinsonMixtureFromCatalog } from '../Data/pengRobinsonMixtureFacade';
import type {
  PengRobinsonMixtureCatalogRequest,
  PengRobinsonMixtureCatalogSuccess
} from '../Data/pengRobinsonMixtureFacade';

import { computePengRobinsonMixture } from '../Core/pengRobinsonMixture';
import type {
  PengRobinsonBinaryInteractionInput,
  PengRobinsonEvidenceStatus,
  PengRobinsonMixtureComponentInput,
  PengRobinsonMixtureFailure,
  PengRobinsonMixtureInputs,
  PengRobinsonMixtureResult,
  PengRobinsonMixtureSuccess
} from '../Core/pengRobinsonMixture';

import { computePengRobinsonPure } from '../Data/pengRobinsonFacade';
import type { PengRobinsonPureSuccess } from '../Data/pengRobinsonFacade';

import { UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K } from '../Core/thermoFunctions';

// ----------------------------------------------------------------------------
// Справочные значения каталога Stage 4.4.4.1 (независимые литералы теста)
// ----------------------------------------------------------------------------

interface PureParams {
  readonly tcK: number;
  readonly pcPa: number;
  readonly omega: number;
}

// CO2: Span & Wagner 1996 (Tc, Pc); omega CoolProp 8.0.0.
// N2: Span et al. 2000; omega CoolProp. CH4: Setzmann & Wagner 1991;
// omega CoolProp (UNRESOLVED_CROSS_CHECK в каталоге). H2O: IAPWS-95;
// omega CoolProp. Ar: Tegeler, Span & Wagner 1999; omega CoolProp.
const CATALOG_PARAMS: Readonly<Record<string, PureParams>> = {
  co2: { tcK: 304.1282, pcPa: 7377300, omega: 0.22394 },
  n2: { tcK: 126.192, pcPa: 3395800, omega: 0.0372 },
  ch4: { tcK: 190.564, pcPa: 4599200, omega: 0.01142 },
  h2o: { tcK: 647.096, pcPa: 22064000, omega: 0.3442920843 },
  ar: { tcK: 150.687, pcPa: 4863000, omega: -0.00219 }
};

// Опубликованные kij каталога 4.4.4.3 (Okoro et al. 2024;
// Köster, Thol & Vrabec 2018).
const KIJ_VALUES: Readonly<Record<string, number>> = {
  'ar|co2': 0.129219,
  'ar|n2': -0.0037,
  'ch4|co2': 0.09897,
  'co2|n2': -0.017,
  'h2o|n2': -0.0501
};

const R = UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K;

// ----------------------------------------------------------------------------
// Хелперы
// ----------------------------------------------------------------------------

function mixSuccess(
  request: PengRobinsonMixtureCatalogRequest
): PengRobinsonMixtureCatalogSuccess {
  const result = computePengRobinsonMixtureFromCatalog(request);
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`ожидался успех, получен отказ: ${JSON.stringify(result)}`);
  }
  return result;
}

function mixFailure(
  request: PengRobinsonMixtureCatalogRequest
): PengRobinsonMixtureFailure {
  const result = computePengRobinsonMixtureFromCatalog(request);
  expect(result.status).toBe('failure');
  if (result.status !== 'failure') {
    throw new Error(`ожидался отказ, получен успех: ${JSON.stringify(result)}`);
  }
  return result;
}

function entry(gasId: string, moleFraction: number) {
  return { gasId, moleFraction };
}

function vaporRequest(
  composition: { gasId: string; moleFraction: number }[],
  temperatureK: number,
  pressurePa: number,
  evidencePolicy: 'allow_partial' | 'allow_unresolved_cross_check' = 'allow_partial'
): PengRobinsonMixtureCatalogRequest {
  return { composition, temperatureK, pressurePa, root: 'vapor', evidencePolicy };
}

/** Относительная ошибка с явным допуском (независимые пересчёты). */
function expectRel(actual: number, expected: number, relTol: number, label: string): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Number.isFinite(expected)).toBe(true);
  const rel = Math.abs(actual - expected) / Math.abs(expected);
  if (rel >= relTol) {
    throw new Error(
      `${label}: относительная ошибка ${rel.toExponential(4)} >= ${relTol} ` +
        `(фактически ${actual}, ожидание ${expected})`
    );
  }
}

/** Универсальные структурные проверки успеха смесевого вычислителя. */
function expectSoundMixture(s: PengRobinsonMixtureSuccess | PengRobinsonMixtureCatalogSuccess): void {
  expect(Number.isFinite(s.aMixPaM6PerMol2)).toBe(true);
  expect(s.aMixPaM6PerMol2).toBeGreaterThan(0);
  expect(Number.isFinite(s.bMixM3PerMol)).toBe(true);
  expect(s.bMixM3PerMol).toBeGreaterThan(0);
  expect(Number.isFinite(s.dimensionlessA)).toBe(true);
  expect(Number.isFinite(s.dimensionlessB)).toBe(true);
  expect(s.dimensionlessA).toBeGreaterThan(0);
  expect(s.dimensionlessB).toBeGreaterThan(0);
  expect(s.Z).toBe(s.selectedRoot);
  expect(s.Z).toBeGreaterThan(s.dimensionlessB);
  for (const z of s.realRoots) {
    expect(Number.isFinite(z)).toBe(true);
  }
  for (const z of s.physicalRoots) {
    expect(z).toBeGreaterThan(s.dimensionlessB);
  }
  if (s.physicalRoots.length >= 2) {
    expect(s.Z).toBe(
      s.root === 'vapor'
        ? s.physicalRoots[s.physicalRoots.length - 1]
        : s.physicalRoots[0]
    );
    expect(s.hasDistinctBranches).toBe(true);
  }
  for (const c of s.components) {
    expect(Number.isFinite(c.aPaM6PerMol2)).toBe(true);
    expect(Number.isFinite(c.bM3PerMol)).toBe(true);
    expect(Number.isFinite(c.sIPaM6PerMol2)).toBe(true);
    expect(Number.isFinite(c.lnPhi)).toBe(true);
    expect(Number.isFinite(c.phi)).toBe(true);
    expect(c.phi).toBeGreaterThan(0);
    expect(Number.isFinite(c.fugacityPa)).toBe(true);
    expect(c.fugacityPa).toBeGreaterThanOrEqual(0);
    // Внутренняя согласованность: phi_i = exp(ln(phi_i)), f_i = x_i phi_i P.
    expect(c.phi).toBe(Math.exp(c.lnPhi));
    expect(c.fugacityPa).toBe(c.moleFraction * c.phi * s.pressurePa);
  }
  // Дисклеймер о математическом характере выбора ветви всегда присутствует.
  expect(s.notes.join(' ')).toMatch(/НЕ доказывает термодинамическую устойчивость/);
}

// --- Core-уровень: ручная сборка входов (без каталогов Data) ---

const ALL_VERIFIED: Readonly<{
  criticalTemperatureK: PengRobinsonEvidenceStatus;
  criticalPressurePa: PengRobinsonEvidenceStatus;
  acentricFactor: PengRobinsonEvidenceStatus;
}> = {
  criticalTemperatureK: 'VERIFIED',
  criticalPressurePa: 'VERIFIED',
  acentricFactor: 'VERIFIED'
};

function coreComponent(
  id: string,
  moleFraction: number,
  evidence: typeof ALL_VERIFIED = ALL_VERIFIED
): PengRobinsonMixtureComponentInput {
  const params = CATALOG_PARAMS[id];
  return {
    component: id,
    moleFraction,
    criticalTemperatureK: params.tcK,
    criticalPressurePa: params.pcPa,
    acentricFactor: params.omega,
    evidence,
    crossChecks: [],
    limitations: []
  };
}

function coreBinary(
  a: string,
  b: string,
  kij: number,
  evidence: PengRobinsonEvidenceStatus = 'PARTIALLY_VERIFIED',
  applicabilityRangeK: PengRobinsonBinaryInteractionInput['applicabilityRangeK'] = null
): PengRobinsonBinaryInteractionInput {
  return { componentA: a, componentB: b, kij, evidence, applicabilityRangeK };
}

// ----------------------------------------------------------------------------
// 1. Однокомпонентный предел: ПОБИТОВОЕ совпадение с чистым PR
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: однокомпонентный предел', () => {
  const cases = [
    { gasId: 'co2', temperatureK: 250, pressurePa: 2e6, root: 'vapor' },
    { gasId: 'co2', temperatureK: 250, pressurePa: 2e6, root: 'liquid' },
    { gasId: 'co2', temperatureK: 350, pressurePa: 1e7, root: 'vapor' },
    { gasId: 'n2', temperatureK: 400, pressurePa: 5e6, root: 'vapor' },
    { gasId: 'ar', temperatureK: 200, pressurePa: 1e6, root: 'vapor' },
    { gasId: 'h2o', temperatureK: 800, pressurePa: 2e7, root: 'vapor' }
  ] as const;

  for (const point of cases) {
    it(`${point.gasId} ${point.temperatureK} K / ${point.pressurePa} Pa (${point.root}): совпадает с чистым PR побитово`, () => {
      const mixture = mixSuccess({
        composition: [entry(point.gasId, 1.0)],
        temperatureK: point.temperatureK,
        pressurePa: point.pressurePa,
        root: point.root,
        evidencePolicy: 'allow_partial'
      });
      const pure = computePengRobinsonPure({
        gasId: point.gasId,
        temperatureK: point.temperatureK,
        pressurePa: point.pressurePa,
        root: point.root,
        evidencePolicy: 'allow_partial'
      });
      expect(pure.status).toBe('success');
      if (pure.status !== 'success') {
        throw new Error('ожидался успех чистого PR');
      }
      const p = pure as PengRobinsonPureSuccess;

      // Однокомпонентный предел: a_mix = a, b_mix = b, та же кубика.
      expect(mixture.components).toHaveLength(1);
      const c = mixture.components[0];
      expect(mixture.Z).toBe(p.Z);
      expect(mixture.selectedRoot).toBe(p.selectedRoot);
      expect(mixture.dimensionlessA).toBe(p.dimensionlessA);
      expect(mixture.dimensionlessB).toBe(p.dimensionlessB);
      expect(c.aPaM6PerMol2).toBe(p.aPaM6PerMol2);
      expect(c.bM3PerMol).toBe(p.bM3PerMol);
      expect(c.sIPaM6PerMol2).toBe(p.aPaM6PerMol2);
      expect(c.lnPhi).toBe(p.lnPhi);
      expect(c.phi).toBe(p.phi);
      expect(c.fugacityPa).toBe(p.fugacityPa);
      // Корни кубики те же (тот же решатель).
      expect([...mixture.realRoots]).toEqual([...p.realRoots]);
      expect([...mixture.physicalRoots]).toEqual([...p.physicalRoots]);
      // Предупреждения о частично проверенном omega и одиночном корне
      // сохраняют коды (порядок не сравниваем).
      expect(mixture.warnings.map((w) => w.code).sort())
        .toEqual(p.warnings.map((w) => w.code).sort());
      // Пары не требуются: single component не образует взаимодействий.
      expect(mixture.binaryInteractionsUsed).toEqual([]);
    });
  }

  it('х2 в однокомпонентном пределе: сумма долей обязана быть 1 (нормализации нет)', () => {
    const failure = mixFailure({
      composition: [entry('co2', 1.5)],
      temperatureK: 250,
      pressurePa: 2e6,
      root: 'vapor',
      evidencePolicy: 'allow_partial'
    });
    expect(failure.code).toBe('invalid_composition');
  });
});

// ----------------------------------------------------------------------------
// 2. Идеальный предел P -> 0
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: идеальный предел P -> 0', () => {
  it('co2 + n2 при 1 Па: Z -> 1, phi_i -> 1, f_i -> x_i P', () => {
    const s = mixSuccess(vaporRequest([entry('co2', 0.5), entry('n2', 0.5)], 250, 1));
    expectSoundMixture(s);
    expect(Math.abs(s.Z - 1)).toBeLessThan(1e-7);
    for (const c of s.components) {
      expect(Math.abs(c.lnPhi)).toBeLessThan(1e-7);
      expect(Math.abs(c.phi - 1)).toBeLessThan(1e-7);
      // f_i -> x_i P (phi_i -> 1).
      expect(Math.abs(c.fugacityPa - c.moleFraction * s.pressurePa))
        .toBeLessThan(1e-12);
    }
  });

  it('тернарная смесь при 1 Па: Z -> 1, все phi_i -> 1', () => {
    const s = mixSuccess(
      vaporRequest([entry('co2', 0.6), entry('n2', 0.3), entry('ar', 0.1)], 250, 1)
    );
    expect(Math.abs(s.Z - 1)).toBeLessThan(1e-7);
    for (const c of s.components) {
      expect(Math.abs(c.phi - 1)).toBeLessThan(1e-7);
    }
  });
});

// ----------------------------------------------------------------------------
// 3. Бинарные смеси с известными kij
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: бинарные смеси с известными kij', () => {
  it('co2 + n2 (0.7/0.3) 250 K / 2 MPa: успех, kij из каталога Okoro 2024', () => {
    const s = mixSuccess(vaporRequest([entry('co2', 0.7), entry('n2', 0.3)], 250, 2e6));
    expectSoundMixture(s);

    expect(s.components.map((c) => c.component)).toEqual(['co2', 'n2']);
    expect(s.binaryInteractionsUsed).toHaveLength(1);
    const pair = s.binaryInteractionsUsed[0];
    expect(pair.componentA).toBe('co2');
    expect(pair.componentB).toBe('n2');
    expect(pair.kij).toBe(KIJ_VALUES['co2|n2']);
    expect(pair.evidence).toBe('PARTIALLY_VERIFIED');
    expect(pair.applicabilityRangeK).not.toBeNull();
    expect(pair.applicabilityRangeK?.minTemperatureK).toBe(228.15);
    expect(pair.applicabilityRangeK?.maxTemperatureK).toBe(273.15);

    const codes = s.warnings.map((w) => w.code);
    expect(codes).toContain('partially_verified_parameter');
    expect(codes).toContain('partially_verified_binary_interaction');

    const facadePair = s.binaryInteractionParameters[0];
    expect(facadePair.pairKey).toBe('co2|n2');
    expect(facadePair.kij.value).toBe(KIJ_VALUES['co2|n2']);
    expect(facadePair.kij.provenance.evidence).toBe('PARTIALLY_VERIFIED');
    expect(facadePair.kij.provenance.reference).toMatch(/10\.1002\/ghg\.2300/);
  });

  it('co2 + ar (0.95/0.05) 250 K / 2 MPa: успех, kij 0.129219', () => {
    const s = mixSuccess(vaporRequest([entry('co2', 0.95), entry('ar', 0.05)], 250, 2e6));
    expectSoundMixture(s);
    const pair = s.binaryInteractionsUsed[0];
    // Канонический порядок пары: ar < co2.
    expect(pair.componentA).toBe('ar');
    expect(pair.componentB).toBe('co2');
    expect(pair.kij).toBe(KIJ_VALUES['ar|co2']);
  });

  it('n2 + ar (0.5/0.5) 150 K / 5 MPa: успех, kij Köster 2018, диапазон null', () => {
    const s = mixSuccess(vaporRequest([entry('n2', 0.5), entry('ar', 0.5)], 150, 5e6));
    expectSoundMixture(s);
    const pair = s.binaryInteractionsUsed[0];
    expect(pair.componentA).toBe('ar');
    expect(pair.componentB).toBe('n2');
    expect(pair.kij).toBe(KIJ_VALUES['ar|n2']);
    expect(pair.applicabilityRangeK).toBeNull();
    const facadePair = s.binaryInteractionParameters[0];
    expect(facadePair.pairKey).toBe('ar|n2');
    expect(facadePair.kij.provenance.reference).toMatch(/10\.1021\/acs\.jced\.7b00706/);
  });

  it('n2 + h2o (0.9/0.1) 400 K / 5 MPa: успех с предупреждением об ограничениях PR для H2O', () => {
    const s = mixSuccess(vaporRequest([entry('n2', 0.9), entry('h2o', 0.1)], 400, 5e6));
    expectSoundMixture(s);
    const pair = s.binaryInteractionsUsed[0];
    expect(pair.componentA).toBe('h2o');
    expect(pair.componentB).toBe('n2');
    expect(pair.kij).toBe(KIJ_VALUES['h2o|n2']);
    const codes = s.warnings.map((w) => w.code);
    expect(codes).toContain('h2o_classical_pr_limitations');
    expect(codes).toContain('partially_verified_binary_interaction');
  });

  it('co2 + ch4 (0.9/0.1) 250 K / 2 MPa: требует allow_unresolved_cross_check (omega CH4)', () => {
    const s = mixSuccess({
      composition: [entry('co2', 0.9), entry('ch4', 0.1)],
      temperatureK: 250,
      pressurePa: 2e6,
      root: 'vapor',
      evidencePolicy: 'allow_unresolved_cross_check'
    });
    expectSoundMixture(s);
    const pair = s.binaryInteractionsUsed[0];
    expect(pair.componentA).toBe('ch4');
    expect(pair.componentB).toBe('co2');
    expect(pair.kij).toBe(KIJ_VALUES['ch4|co2']);
    const codes = s.warnings.map((w) => w.code);
    expect(codes).toContain('unresolved_cross_check_parameter');
    expect(codes).toContain('partially_verified_binary_interaction');
    // Конфликт omega CH4 не маскируется: provenance прикреплён.
    const ch4Params = s.componentParameters.find((c) => c.gasId === 'ch4');
    expect(ch4Params).toBeDefined();
    expect(ch4Params?.acentricFactor.value).toBe(CATALOG_PARAMS.ch4.omega);
    expect(ch4Params?.acentricFactor.provenance.evidence).toBe('UNRESOLVED_CROSS_CHECK');
  });

  it('co2 + ch4 при verified_only: отказ parameter_evidence_not_accepted (omega CH4)', () => {
    const failure = mixFailure({
      composition: [entry('co2', 0.9), entry('ch4', 0.1)],
      temperatureK: 250,
      pressurePa: 2e6,
      root: 'vapor',
      evidencePolicy: 'verified_only'
    });
    expect(failure.code).toBe('parameter_evidence_not_accepted');
    expect(failure.message).toMatch(/UNRESOLVED_CROSS_CHECK/);
  });
});

// ----------------------------------------------------------------------------
// 4. Тернарная смесь
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: тернарная смесь', () => {
  it('co2 + n2 + ar (0.6/0.3/0.1) 250 K / 2 MPa: три пары kij, канонический порядок', () => {
    const s = mixSuccess(
      vaporRequest([entry('co2', 0.6), entry('n2', 0.3), entry('ar', 0.1)], 250, 2e6)
    );
    expectSoundMixture(s);

    expect(s.components.map((c) => c.component)).toEqual(['ar', 'co2', 'n2']);
    expect(s.binaryInteractionsUsed.map((p) => `${p.componentA}|${p.componentB}`))
      .toEqual(['ar|co2', 'ar|n2', 'co2|n2']);
    expect(s.binaryInteractionsUsed.map((p) => p.kij)).toEqual([
      KIJ_VALUES['ar|co2'],
      KIJ_VALUES['ar|n2'],
      KIJ_VALUES['co2|n2']
    ]);
    // Компонентные фугитивности: каждая конечна и положительна.
    for (const c of s.components) {
      expect(c.fugacityPa).toBeGreaterThan(0);
      expect(c.phi).toBeGreaterThan(0);
    }
  });
});

// ----------------------------------------------------------------------------
// 5. Симметрия результата при перестановке состава
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: симметрия при перестановке компонентов', () => {
  const compositionVariants = [
    [entry('co2', 0.6), entry('n2', 0.3), entry('ar', 0.1)],
    [entry('ar', 0.1), entry('n2', 0.3), entry('co2', 0.6)],
    [entry('n2', 0.3), entry('ar', 0.1), entry('co2', 0.6)]
  ] as const;

  it('Core: перестановка входа не меняет результат (toEqual всего результата)', () => {
    const request = {
      temperatureK: 250,
      pressurePa: 2e6,
      root: 'vapor' as const,
      evidencePolicy: 'allow_partial' as const
    };
    // Три перестановки ОДНОГО состава; бинарные записи тоже переставлены
    // (в т.ч. порядок пар i-j/j-i).
    const variants: PengRobinsonMixtureInputs[] = [
      {
        components: [
          coreComponent('co2', 0.6),
          coreComponent('n2', 0.3),
          coreComponent('ar', 0.1)
        ],
        binaryInteractions: [
          coreBinary('co2', 'n2', KIJ_VALUES['co2|n2']),
          coreBinary('n2', 'ar', KIJ_VALUES['ar|n2']),
          coreBinary('co2', 'ar', KIJ_VALUES['ar|co2'])
        ]
      },
      {
        components: [
          coreComponent('ar', 0.1),
          coreComponent('co2', 0.6),
          coreComponent('n2', 0.3)
        ],
        binaryInteractions: [
          coreBinary('ar', 'co2', KIJ_VALUES['ar|co2']),
          coreBinary('ar', 'n2', KIJ_VALUES['ar|n2']),
          coreBinary('n2', 'co2', KIJ_VALUES['co2|n2'])
        ]
      },
      {
        components: [
          coreComponent('n2', 0.3),
          coreComponent('ar', 0.1),
          coreComponent('co2', 0.6)
        ],
        binaryInteractions: [
          coreBinary('n2', 'co2', KIJ_VALUES['co2|n2']),
          coreBinary('co2', 'ar', KIJ_VALUES['ar|co2']),
          coreBinary('n2', 'ar', KIJ_VALUES['ar|n2'])
        ]
      }
    ];
    const results: PengRobinsonMixtureResult[] = variants.map((inputs) =>
      computePengRobinsonMixture(inputs, request)
    );
    for (const r of results) {
      expect(r.status).toBe('success');
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toEqual(results[2]);
  });

  it('фасад: перестановка состава даёт тот же расчёт (canonical core-часть)', () => {
    const first = mixSuccess(vaporRequest([...compositionVariants[0]], 250, 2e6));
    const second = mixSuccess(vaporRequest([...compositionVariants[1]], 250, 2e6));
    expect(second.Z).toBe(first.Z);
    expect(second.aMixPaM6PerMol2).toBe(first.aMixPaM6PerMol2);
    expect(second.bMixM3PerMol).toBe(first.bMixM3PerMol);
    expect(second.components).toEqual(first.components);
    expect(second.binaryInteractionsUsed).toEqual(first.binaryInteractionsUsed);
    // Provenance-список фасада следует порядку запроса, но содержит
    // те же пары/компоненты (как множество).
    expect(
      second.binaryInteractionParameters.map((p) => p.pairKey).sort()
    ).toEqual(first.binaryInteractionParameters.map((p) => p.pairKey).sort());
    expect(
      second.componentParameters.map((c) => c.gasId).sort()
    ).toEqual(first.componentParameters.map((c) => c.gasId).sort());
  });
});

// ----------------------------------------------------------------------------
// 6. Правильность a_mix, b_mix, A_mix, B_mix (независимый пересчёт)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: правила смешения против независимого пересчёта', () => {
  /** Независимый (отличный от Core) пересчёт a_i(T), b_i, a_mix, b_mix. */
  function independentMixing(
    ids: string[],
    fractions: number[],
    temperatureK: number,
    pressurePa: number,
    kijLookup: (a: string, b: string) => number
  ): {
    a: number[];
    b: number[];
    aMix: number;
    bMix: number;
    A: number;
    B: number;
    sI: number[];
  } {
    const a = ids.map((id) => {
      const p = CATALOG_PARAMS[id];
      const kappa = 0.37464 + 1.54226 * p.omega - 0.26992 * p.omega * p.omega;
      const alpha = (1 + kappa * (1 - Math.sqrt(temperatureK / p.tcK))) ** 2;
      return 0.45724 * R * R * p.tcK * p.tcK / p.pcPa * alpha;
    });
    const b = ids.map((id) => {
      const p = CATALOG_PARAMS[id];
      return 0.0778 * R * p.tcK / p.pcPa;
    });
    const n = ids.length;
    const aIJ: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
    for (let i = 0; i < n; i += 1) {
      aIJ[i][i] = a[i];
      for (let j = i + 1; j < n; j += 1) {
        const kij = kijLookup(ids[i], ids[j]);
        aIJ[i][j] = (1 - kij) * Math.sqrt(a[i] * a[j]);
        aIJ[j][i] = aIJ[i][j];
      }
    }
    let aMix = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        aMix += fractions[i] * fractions[j] * aIJ[i][j];
      }
    }
    let bMix = 0;
    for (let i = 0; i < n; i += 1) {
      bMix += fractions[i] * b[i];
    }
    const A = aMix * pressurePa / (R * R * temperatureK * temperatureK);
    const B = bMix * pressurePa / (R * temperatureK);
    const sI: number[] = [];
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let j = 0; j < n; j += 1) {
        s += fractions[j] * aIJ[i][j];
      }
      sI.push(s);
    }
    return { a, b, aMix, bMix, A, B, sI };
  }

  it('co2 + n2 (0.7/0.3) 250 K / 2 MPa: a_mix, b_mix, A_mix, B_mix верны', () => {
    const ids = ['co2', 'n2'];
    const fractions = [0.7, 0.3];
    const kijLookup = (a: string, b: string) =>
      KIJ_VALUES[[a, b].sort().join('|') as keyof typeof KIJ_VALUES];
    const expected = independentMixing(ids, fractions, 250, 2e6, kijLookup);
    const s = mixSuccess(vaporRequest([entry('co2', 0.7), entry('n2', 0.3)], 250, 2e6));

    expectRel(s.aMixPaM6PerMol2, expected.aMix, 1e-12, 'a_mix');
    expectRel(s.bMixM3PerMol, expected.bMix, 1e-12, 'b_mix');
    expectRel(s.dimensionlessA, expected.A, 1e-12, 'A_mix');
    expectRel(s.dimensionlessB, expected.B, 1e-12, 'B_mix');
    for (let i = 0; i < ids.length; i += 1) {
      expectRel(s.components[i].aPaM6PerMol2, expected.a[i], 1e-12, `a_${ids[i]}`);
      expectRel(s.components[i].bM3PerMol, expected.b[i], 1e-12, `b_${ids[i]}`);
      expectRel(s.components[i].sIPaM6PerMol2, expected.sI[i], 1e-12, `S_${ids[i]}`);
    }
  });

  it('тернарная смесь (0.6/0.3/0.1) 250 K / 2 MPa: смешение верно для трёх компонентов', () => {
    const ids = ['ar', 'co2', 'n2'];
    const fractions = [0.1, 0.6, 0.3];
    const kijLookup = (a: string, b: string) =>
      KIJ_VALUES[[a, b].sort().join('|') as keyof typeof KIJ_VALUES];
    const expected = independentMixing(ids, fractions, 250, 2e6, kijLookup);
    const s = mixSuccess(
      vaporRequest([entry('co2', 0.6), entry('n2', 0.3), entry('ar', 0.1)], 250, 2e6)
    );

    expectRel(s.aMixPaM6PerMol2, expected.aMix, 1e-12, 'a_mix (тернар)');
    expectRel(s.bMixM3PerMol, expected.bMix, 1e-12, 'b_mix (тернар)');
    expectRel(s.dimensionlessA, expected.A, 1e-12, 'A_mix (тернар)');
    expectRel(s.dimensionlessB, expected.B, 1e-12, 'B_mix (тернар)');
    // Порядок компонентов в результате канонический: ar, co2, n2.
    for (let i = 0; i < ids.length; i += 1) {
      expectRel(s.components[i].aPaM6PerMol2, expected.a[i], 1e-12, `a_${ids[i]}`);
      expectRel(s.components[i].sIPaM6PerMol2, expected.sI[i], 1e-12, `S_${ids[i]}`);
    }
  });

  it('kij влияет на a_mix: значение каталога действительно используется', () => {
    // Тот же состав без kij-влияния (Core-уровень, kij = 0 как КОНТРОЛЬ,
    // не как подстановка): a_mix обязан отличаться от каталогного kij.
    const request = {
      temperatureK: 250,
      pressurePa: 2e6,
      root: 'vapor' as const,
      evidencePolicy: 'allow_partial' as const
    };
    const components = [
      coreComponent('co2', 0.7),
      coreComponent('n2', 0.3)
    ];
    const withCatalogKij = computePengRobinsonMixture(
      { components, binaryInteractions: [coreBinary('co2', 'n2', KIJ_VALUES['co2|n2'])] },
      request
    );
    const withZeroKij = computePengRobinsonMixture(
      { components, binaryInteractions: [coreBinary('co2', 'n2', 0)] },
      request
    );
    expect(withCatalogKij.status).toBe('success');
    expect(withZeroKij.status).toBe('success');
    if (withCatalogKij.status !== 'success' || withZeroKij.status !== 'success') {
      throw new Error('ожидались успехи');
    }
    // kij = -0.017 < 0 => (1-kij) > 1 => a_mix больше, чем при kij = 0.
    expect(withCatalogKij.aMixPaM6PerMol2).toBeGreaterThan(withZeroKij.aMixPaM6PerMol2);
    // Расхождение существенно: не на уровне шума округления.
    const rel = Math.abs(
      withCatalogKij.aMixPaM6PerMol2 - withZeroKij.aMixPaM6PerMol2
    ) / withZeroKij.aMixPaM6PerMol2;
    expect(rel).toBeGreaterThan(1e-4);
  });
});

// ----------------------------------------------------------------------------
// 7. Компонентные ln(phi_i), phi_i, f_i
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: компонентные фугитивности', () => {
  it('phi_i и f_i согласованы с ln(phi_i) и различны между компонентами', () => {
    const s = mixSuccess(vaporRequest([entry('co2', 0.7), entry('n2', 0.3)], 250, 2e6));
    expectSoundMixture(s);
    const co2 = s.components.find((c) => c.component === 'co2');
    const n2 = s.components.find((c) => c.component === 'n2');
    if (co2 === undefined || n2 === undefined) {
      throw new Error('ожидались компонентные результаты co2 и n2');
    }
    // Компонентные phi_i НЕ подменены одной фугитивностью смеси.
    expect(co2.phi).not.toBe(n2.phi);
    expect(co2.fugacityPa).not.toBe(n2.fugacityPa);
    // f_i = x_i phi_i P.
    expect(co2.fugacityPa).toBe(0.7 * co2.phi * 2e6);
    expect(n2.fugacityPa).toBe(0.3 * n2.phi * 2e6);
  });

  it('S_i и ln(phi_i) меняются между компонентами (не одна общая величина)', () => {
    const s = mixSuccess(
      vaporRequest([entry('co2', 0.6), entry('n2', 0.3), entry('ar', 0.1)], 250, 2e6)
    );
    const values = s.components.map((c) => c.sIPaM6PerMol2);
    expect(new Set(values).size).toBe(3);
    const lnPhis = s.components.map((c) => c.lnPhi);
    expect(new Set(lnPhis).size).toBe(3);
  });

  it('нулевая доля: f_i = 0, phi_i конечен, kij для нулевых долей не требуется', () => {
    // co2 + h2o, где x_h2o = 0: пара co2|h2o unresolved, но доля нулевая
    // => взаимодействия нет => отказа быть НЕ должно.
    const s = mixSuccess(vaporRequest([entry('co2', 1.0), entry('h2o', 0.0)], 250, 2e6));
    expectSoundMixture(s);
    expect(s.components).toHaveLength(2);
    const h2o = s.components.find((c) => c.component === 'h2o');
    if (h2o === undefined) {
      throw new Error('ожидался компонентный результат h2o');
    }
    expect(h2o.moleFraction).toBe(0);
    expect(h2o.fugacityPa).toBe(0);
    expect(Number.isFinite(h2o.phi)).toBe(true);
    // H2O-предупреждение не выдаётся: доля нулевая.
    expect(s.warnings.map((w) => w.code)).not.toContain('h2o_classical_pr_limitations');
    expect(s.binaryInteractionsUsed).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// 8. Отказы: fail-closed поведение
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: отказы (fail-closed)', () => {
  it('h2o + ar: пара unresolved => missing_binary_interaction (НЕ kij = 0)', () => {
    const failure = mixFailure(vaporRequest([entry('h2o', 0.5), entry('ar', 0.5)], 250, 2e6));
    expect(failure.code).toBe('missing_binary_interaction');
    expect(failure.detail).toBe('ar|h2o');
    expect(failure.message).toMatch(/unknown\/unresolved/i);
    expect(failure.message).toMatch(/kij = 0/);
  });

  it('co2 + h2o: классический PR для пары не поддерживается => отказ', () => {
    const failure = mixFailure(vaporRequest([entry('co2', 0.5), entry('h2o', 0.5)], 250, 2e6));
    expect(failure.code).toBe('missing_binary_interaction');
    expect(failure.detail).toBe('co2|h2o');
  });

  it('Core: отсутствие записи kij для пары с положительными долями => отказ', () => {
    const result = computePengRobinsonMixture(
      {
        components: [coreComponent('co2', 0.7), coreComponent('n2', 0.3)],
        binaryInteractions: []
      },
      { temperatureK: 250, pressurePa: 2e6, root: 'vapor', evidencePolicy: 'allow_partial' }
    );
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') {
      throw new Error('ожидался отказ');
    }
    expect(result.code).toBe('missing_binary_interaction');
    expect(result.detail).toBe('co2|n2');
  });

  it('сумма долей 0.5 + 0.4 => invalid_composition (молчаливой нормализации нет)', () => {
    const failure = mixFailure(vaporRequest([entry('co2', 0.5), entry('n2', 0.4)], 250, 2e6));
    expect(failure.code).toBe('invalid_composition');
    expect(failure.message).toMatch(/нормализация/i);
  });

  it('отрицательная доля => invalid_composition', () => {
    const failure = mixFailure(
      vaporRequest([entry('co2', 1.5), entry('n2', -0.5)], 250, 2e6)
    );
    expect(failure.code).toBe('invalid_composition');
    expect(failure.message).toMatch(/неотрицательн/);
  });

  it('нечисловая доля => invalid_composition', () => {
    const failure = mixFailure({
      composition: [entry('co2', Number.NaN), entry('n2', 0.3)],
      temperatureK: 250,
      pressurePa: 2e6,
      root: 'vapor',
      evidencePolicy: 'allow_partial'
    });
    expect(failure.code).toBe('invalid_composition');
  });

  it('дублированный компонент => invalid_composition', () => {
    const failure = mixFailure(
      vaporRequest([entry('co2', 0.5), entry('co2', 0.5)], 250, 2e6)
    );
    expect(failure.code).toBe('invalid_composition');
    expect(failure.message).toMatch(/уникальн|дублирован/i);
  });

  it('пустой состав => invalid_composition', () => {
    const failure = mixFailure(vaporRequest([], 250, 2e6));
    expect(failure.code).toBe('invalid_composition');
  });

  it('Core: асимметричный kij (разные значения для i-j и j-i) => отказ', () => {
    const result = computePengRobinsonMixture(
      {
        components: [coreComponent('co2', 0.7), coreComponent('n2', 0.3)],
        binaryInteractions: [
          coreBinary('co2', 'n2', 0.1),
          coreBinary('n2', 'co2', 0.2)
        ]
      },
      { temperatureK: 250, pressurePa: 2e6, root: 'vapor', evidencePolicy: 'allow_partial' }
    );
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') {
      throw new Error('ожидался отказ');
    }
    expect(result.code).toBe('asymmetric_binary_interaction');
    expect(result.message).toMatch(/kij = kji/);
  });

  it('Core: повторная запись kij с тем же значением допустима (не асимметрия)', () => {
    const result = computePengRobinsonMixture(
      {
        components: [coreComponent('co2', 0.7), coreComponent('n2', 0.3)],
        binaryInteractions: [
          coreBinary('co2', 'n2', 0.1),
          coreBinary('n2', 'co2', 0.1)
        ]
      },
      { temperatureK: 250, pressurePa: 2e6, root: 'vapor', evidencePolicy: 'allow_partial' }
    );
    expect(result.status).toBe('success');
  });

  it('Core: самопара i-i во входе kij => invalid_input', () => {
    const result = computePengRobinsonMixture(
      {
        components: [coreComponent('co2', 0.7), coreComponent('n2', 0.3)],
        binaryInteractions: [coreBinary('co2', 'co2', 0.05)]
      },
      { temperatureK: 250, pressurePa: 2e6, root: 'vapor', evidencePolicy: 'allow_partial' }
    );
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') {
      throw new Error('ожидался отказ');
    }
    expect(result.code).toBe('invalid_input');
    expect(result.message).toMatch(/самопара/i);
  });

  it('Core: kij со статусом UNRESOLVED не принимается ни одной политикой', () => {
    for (const evidencePolicy of [
      'verified_only',
      'allow_partial',
      'allow_unresolved_cross_check'
    ] as const) {
      const result = computePengRobinsonMixture(
        {
          components: [coreComponent('co2', 0.7), coreComponent('n2', 0.3)],
          binaryInteractions: [coreBinary('co2', 'n2', 0.05, 'UNRESOLVED')]
        },
        { temperatureK: 250, pressurePa: 2e6, root: 'vapor', evidencePolicy }
      );
      expect(result.status).toBe('failure');
      if (result.status !== 'failure') {
        throw new Error('ожидался отказ');
      }
      expect(result.code).toBe('parameter_evidence_not_accepted');
      expect(result.detail).toContain('co2|n2');
    }
  });

  it('verified_only не принимает PARTIALLY_VERIFIED kij (компоненты VERIFIED)', () => {
    const result = computePengRobinsonMixture(
      {
        components: [coreComponent('co2', 0.7), coreComponent('n2', 0.3)],
        binaryInteractions: [coreBinary('co2', 'n2', KIJ_VALUES['co2|n2'])]
      },
      { temperatureK: 250, pressurePa: 2e6, root: 'vapor', evidencePolicy: 'verified_only' }
    );
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') {
      throw new Error('ожидался отказ');
    }
    expect(result.code).toBe('parameter_evidence_not_accepted');
    expect(result.message).toMatch(/бинарных параметров/);
    expect(result.detail).toContain('co2|n2.kij=PARTIALLY_VERIFIED');
  });

  it('фасад verified_only: co2 + n2 отклонён на omega PARTIALLY_VERIFIED', () => {
    const failure = mixFailure({
      composition: [entry('co2', 0.7), entry('n2', 0.3)],
      temperatureK: 250,
      pressurePa: 2e6,
      root: 'vapor',
      evidencePolicy: 'verified_only'
    });
    expect(failure.code).toBe('parameter_evidence_not_accepted');
    expect(failure.message).toMatch(/PARTIALLY_VERIFIED/);
  });

  it('T вне верифицированного диапазона kij => binary_interaction_applicability', () => {
    // Пары Okoro 2024 применимы в 228.15–273.15 K; 320 K вне диапазона.
    const failure = mixFailure(vaporRequest([entry('co2', 0.7), entry('n2', 0.3)], 320, 2e6));
    expect(failure.code).toBe('binary_interaction_applicability');
    expect(failure.detail).toBe('co2|n2');
    expect(failure.message).toMatch(/228\.15/);
    expect(failure.message).toMatch(/273\.15/);
  });

  it('нижняя граница диапазона также проверяется (200 K < 228.15 K)', () => {
    const failure = mixFailure(vaporRequest([entry('co2', 0.7), entry('n2', 0.3)], 200, 2e6));
    expect(failure.code).toBe('binary_interaction_applicability');
  });

  it('пары Köster без диапазона (null) не ограничивают T', () => {
    // ar|n2: applicabilityRangeK = null — числового ограничения нет.
    const s1 = mixSuccess(vaporRequest([entry('ar', 0.5), entry('n2', 0.5)], 150, 5e6));
    const s2 = mixSuccess(vaporRequest([entry('ar', 0.5), entry('n2', 0.5)], 300, 5e6));
    expectSoundMixture(s1);
    expectSoundMixture(s2);
  });

  it('неизвестный компонент (h2, o2) => unknown_component', () => {
    const failure = mixFailure(vaporRequest([entry('h2', 0.5), entry('n2', 0.5)], 250, 2e6));
    expect(failure.code).toBe('unknown_component');
    const failure2 = mixFailure(vaporRequest([entry('o2', 1.0)], 250, 2e6));
    expect(failure2.code).toBe('unknown_component');
  });

  it('невалидный запрос (T <= 0) => invalid_input', () => {
    const failure = mixFailure({
      composition: [entry('co2', 0.7), entry('n2', 0.3)],
      temperatureK: -5,
      pressurePa: 2e6,
      root: 'vapor',
      evidencePolicy: 'allow_partial'
    });
    expect(failure.code).toBe('invalid_input');
  });

  it('невалидная ветвь => invalid_input', () => {
    const result = computePengRobinsonMixture(
      {
        components: [coreComponent('co2', 1.0)],
        binaryInteractions: []
      },
      {
        temperatureK: 250,
        pressurePa: 2e6,
        root: 'supercritical' as never,
        evidencePolicy: 'allow_partial'
      }
    );
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') {
      throw new Error('ожидался отказ');
    }
    expect(result.code).toBe('invalid_input');
  });
});

// ----------------------------------------------------------------------------
// 9. Detached-проверка: запрет молчаливого kij = 0 в каталоге
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.3: запрет молчаливого kij = 0', () => {
  it('ни одна unresolved-пара не заменяется нулём: фасад всегда отказывает', () => {
    // Все 5 unresolved пар каталога: расчёт обязан завершиться отказом
    // missing_binary_interaction, а не подстановкой kij = 0.
    const unresolvedPairs: [string, number, string, number][] = [
      ['ar', 0.5, 'ch4', 0.5],
      ['ar', 0.5, 'h2o', 0.5],
      ['ch4', 0.5, 'h2o', 0.5],
      ['ch4', 0.5, 'n2', 0.5],
      ['co2', 0.5, 'h2o', 0.5]
    ];
    for (const [a, xa, b, xb] of unresolvedPairs) {
      const failure = mixFailure(
        vaporRequest([entry(a, xa), entry(b, xb)], 250, 2e6)
      );
      expect(failure.code).toBe('missing_binary_interaction');
      expect(failure.detail).toBe([a, b].sort().join('|'));
    }
  });
});
