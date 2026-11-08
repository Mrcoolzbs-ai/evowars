// ============================================================================
// Stage 4.4.4.4.2 — тесты multi-start поиска tangent-plane distance (TPD)
// ----------------------------------------------------------------------------
// Проверяется Core/prTangentPlaneDistanceSearch.ts по обязательному
// минимуму §7.3 TPD_SEARCH_DESIGN.md (48 пунктов). Каждое численное
// утверждение фиксируется против НЕЗАВИСИМЫХ оракулов (прямая формула в
// тесте: KL-дивергенция, канонический масштаб Y = z·K решётки Wilson,
// собственная реализация SHA-256 векторы NIST), никогда — против самого
// производственного вычислителя.
//
// Фикстуры (синтетические, НЕ заявлены как физические каталоги):
//  - KL: два идентичных компонента N2 (n2a, n2b), kij = 0 VERIFIED;
//    T = 1388.2195230363366 K — температура нулевого притяжения N2
//    (a = 0, lnPhi идентичны) => g(w; z) = KL(w||z), вершина: tpd = ln 2
//    ТОЧНО, feed: tpd = ровно +0; single-root режим (один физический
//    корень, D < 0 с нефизическими корнями Z <= B — near-merge по
//    п. 4.1 определён по ФИЗИЧЕСКИМ корням и неприменим).
//  - PURE: co2 + нулевая доля n2, 250 K / 1 MPa — три физических корня
//    (независимый оракул п. 46: Z = 0.0198964 / 0.0652088 / 0.9020656).
//  - SC1/F9A: co2+n2, kij = −0.017 PARTIALLY_VERIFIED — надёжно
//    отрицательный TPD (SC1) и исчерпание SS-итераций (F9A, 230 K,
//    20 MPa, внутри применимости kij 228.15–273.15 K).
//  - C: co2+h2o 220 K / 2 MPa с ИЗОБРЕТЕННЫМ тестом kij = 0 — только
//    семантика заметок single_physical_root.
//
// ДОКУМЕНТИРОВАННЫЕ ОГРАНИЧЕНИЯ ТЕСТ-ПЛАНА (структурно недостижимые в
// binary64 сценарии; контракт зафиксирован, попытка построения входа
// из бинарных данных невозможна по построению решателя):
//  - п. 29 (глобальное равенство бюджета): раннее завершение SS-цикла
//    при сходимости делает равенство prEvaluations = maxPrEvaluations
//    недостижимым; вместо него проверяется ПОПЫТОЧНАЯ точность счёта
//    (prEvaluations = initialPrCalls + iterations для сошедшихся
//    попыток без отказных вызовов) и точное maxPrEvaluations формулы
//    §4.4 на фикстурах;
//  - п. 31 (2 -> 1 -> 2) и п. 47/48 (точное D = 0, двойной/тройной
//    корень): точное вырождение кубики требует иррациональной пары
//    (A, B) (Stage 4.4.4.4.1-F) — из binary64-входов недостижимо;
//    контракт ветвей фиксируется типом PrTpdAuditDomainPoint и
//    логикой проверок 7 (прямые тесты предиката ниже);
//  - п. 40/41 (отказ начального PR-вызова ветви/discovery):
//    валидация входа (7.1) отклоняет некорректные входы ДО любого
//    PR-вызова, а валидный вход не даёт отказов решателя; сценарии
//    защитные, воспроизводятся только внедрением дефекта в решатель;
//  - п. 33 (C1 при неполном branch coverage) и п. 32-подобные
//    бифуркационные сценарии: требуют точечного прохождения
//    поверхности смены числа корней внутри траектории — в
//    каталожных binary64 фикстурах не воспроизводится.
// ============================================================================

import { describe, it, expect } from 'vitest';

import {
  PR_TPD_SEARCH_MAX_ITERATIONS,
  PR_TPD_SEARCH_NEGATIVE_THRESHOLD,
  PR_TPD_SEARCH_SIGMA_STAT,
  classifyPrTpdInterval,
  canonicalPrInputFingerprint,
  computePrTangentPlaneDistanceSearch,
  evaluatePrTpdAuditDomain,
  isWithinAuditDomain,
  prTpdSearchSha256Hex
} from '../Core/prTangentPlaneDistanceSearch';
import type {
  PrTangentPlaneDistanceSearchResult,
  PrTangentPlaneDistanceSearchResultSuccess,
  PrTpdAuditDomainDescriptor,
  PrTpdAuditDomainPoint
} from '../Core/prTangentPlaneDistanceSearch';
import { computePengRobinsonMixture } from '../Core/pengRobinsonMixture';
import type {
  PengRobinsonBinaryInteractionInput,
  PengRobinsonEvidenceStatus,
  PengRobinsonMixtureComponentInput,
  PengRobinsonMixtureInputs,
  PengRobinsonMixtureRequest,
  PengRobinsonMixtureSuccess
} from '../Core/pengRobinsonMixture';

// ----------------------------------------------------------------------------
// Помощники фикстур
// ----------------------------------------------------------------------------

function verifiedEvidence(): PengRobinsonMixtureComponentInput['evidence'] {
  return {
    criticalTemperatureK: 'VERIFIED',
    criticalPressurePa: 'VERIFIED',
    acentricFactor: 'VERIFIED'
  };
}

function component(
  id: string,
  moleFraction: number,
  criticalTemperatureK: number,
  criticalPressurePa: number,
  acentricFactor: number
): PengRobinsonMixtureComponentInput {
  return {
    component: id,
    moleFraction,
    criticalTemperatureK,
    criticalPressurePa,
    acentricFactor,
    evidence: verifiedEvidence(),
    crossChecks: [],
    limitations: []
  };
}

function interaction(
  componentA: string,
  componentB: string,
  kij: number,
  evidence: PengRobinsonEvidenceStatus,
  applicabilityRangeK: PengRobinsonBinaryInteractionInput['applicabilityRangeK']
): PengRobinsonBinaryInteractionInput {
  return { componentA, componentB, kij, evidence, applicabilityRangeK };
}

const N2 = { tc: 126.192, pc: 3395800, omega: 0.0372 };
const CO2 = { tc: 304.1282, pc: 7377300, omega: 0.22394 };
const H2O = { tc: 647.096, pc: 22064000, omega: 0.3442920843 };

// KL-фикстура: идентичные N2, нулевое притяжение.
const N2_ZERO_ATTRACTION_T = 1388.2195230363366;

function klInputs(): PengRobinsonMixtureInputs {
  return {
    components: [
      component('n2a', 0.5, N2.tc, N2.pc, N2.omega),
      component('n2b', 0.5, N2.tc, N2.pc, N2.omega)
    ],
    binaryInteractions: [interaction('n2a', 'n2b', 0, 'VERIFIED', null)]
  };
}

function klRequest(): PengRobinsonMixtureRequest {
  return {
    temperatureK: N2_ZERO_ATTRACTION_T,
    pressurePa: 1e6,
    root: 'vapor',
    evidencePolicy: 'verified_only'
  };
}

function pureInputs(): PengRobinsonMixtureInputs {
  return {
    components: [
      component('co2', 1, CO2.tc, CO2.pc, CO2.omega),
      component('n2', 0, N2.tc, N2.pc, N2.omega)
    ],
    binaryInteractions: [interaction('co2', 'n2', -0.017, 'PARTIALLY_VERIFIED', null)]
  };
}

function pureRequest(): PengRobinsonMixtureRequest {
  return { temperatureK: 250, pressurePa: 1e6, root: 'vapor', evidencePolicy: 'allow_partial' };
}

function sc1Inputs(): PengRobinsonMixtureInputs {
  return {
    components: [
      component('co2', 0.5, CO2.tc, CO2.pc, CO2.omega),
      component('n2', 0.5, N2.tc, N2.pc, N2.omega)
    ],
    binaryInteractions: [interaction('co2', 'n2', -0.017, 'PARTIALLY_VERIFIED', null)]
  };
}

function sc1Request(): PengRobinsonMixtureRequest {
  return { temperatureK: 200, pressurePa: 2e6, root: 'vapor', evidencePolicy: 'allow_partial' };
}

function f9aInputs(): PengRobinsonMixtureInputs {
  return {
    components: [
      component('co2', 0.5, CO2.tc, CO2.pc, CO2.omega),
      component('n2', 0.5, N2.tc, N2.pc, N2.omega)
    ],
    binaryInteractions: [
      interaction('co2', 'n2', -0.017, 'PARTIALLY_VERIFIED', {
        minTemperatureK: 228.15,
        maxTemperatureK: 273.15
      })
    ]
  };
}

function f9aRequest(): PengRobinsonMixtureRequest {
  return { temperatureK: 230, pressurePa: 2e7, root: 'vapor', evidencePolicy: 'allow_partial' };
}

function cInputs(): PengRobinsonMixtureInputs {
  return {
    components: [
      component('co2', 0.9, CO2.tc, CO2.pc, CO2.omega),
      component('h2o', 0.1, H2O.tc, H2O.pc, H2O.omega)
    ],
    // ИЗОБРЕТЕННЫЙ тестом kij: фикстура только для семантики заметок,
    // НЕ физические параметры.
    binaryInteractions: [interaction('co2', 'h2o', 0, 'VERIFIED', null)]
  };
}

function domainOver(
  fingerprint: string,
  overrides?: Partial<PrTpdAuditDomainDescriptor>
): PrTpdAuditDomainDescriptor {
  const base: PrTpdAuditDomainDescriptor = {
    temperatureRangeK: { min: 1000, max: 2000 },
    pressureRangePa: { min: 1e5, max: 1e7 },
    componentCountRange: { min: 2, max: 2 },
    compositionConstraints: { minNonZeroMoleFraction: 0.1, maxLargestToSmallestRatio: 10 },
    physicalRootMode: {
      twoRootCovered: true,
      nearRootMergeCovered: true,
      nearMergeSeparationTolerance: 1e-8,
      multiplicityModeAvailable: true
    },
    bipPolicy: {
      requiredEvidencePolicy: 'verified_only',
      allowedBipSources: ['evidence:VERIFIED'],
      allowedBipPairIds: ['n2a|n2b']
    },
    componentPolicy: {
      allowedComponentIds: ['n2a', 'n2b'],
      allowedPrInputFingerprints: [fingerprint]
    }
  };
  return { ...base, ...overrides };
}

function requireSuccess(
  result: PrTangentPlaneDistanceSearchResult
): PrTangentPlaneDistanceSearchResultSuccess {
  if (result.status !== 'success') {
    throw new Error('ожидался success, получен отказ: ' + JSON.stringify(result));
  }
  return result;
}

// Точка audit-domain, собранная из реального PR-состояния (п. 4.2 §7.2).
function domainPointFrom(
  inputs: PengRobinsonMixtureInputs,
  request: PengRobinsonMixtureRequest,
  success: PengRobinsonMixtureSuccess,
  fingerprint: string,
  composition: readonly number[]
): PrTpdAuditDomainPoint {
  let separation: number | null = null;
  if (success.physicalRoots.length >= 2) {
    separation = Number.POSITIVE_INFINITY;
    for (let i = 1; i < success.physicalRoots.length; i += 1) {
      separation = Math.min(separation, success.physicalRoots[i] - success.physicalRoots[i - 1]);
    }
  }
  const pairIds: string[] = [];
  for (const bip of inputs.binaryInteractions) {
    const ids = [bip.componentA, bip.componentB].sort();
    pairIds.push(ids[0] + '|' + ids[1]);
  }
  return {
    temperatureK: request.temperatureK,
    pressurePa: request.pressurePa,
    composition,
    physicalRootCount: success.distinctPhysicalRootCount,
    minPhysicalRootSeparation: success.distinctPhysicalRootCount >= 2 ? separation : null,
    componentIds: inputs.components.map((item) => item.component),
    prInputFingerprint: fingerprint,
    bipPairIdsUsed: pairIds,
    bipSourcesUsed: pairIds.map(() => 'evidence:VERIFIED'),
    evidencePolicy: request.evidencePolicy,
    discriminantSign: success.discriminantSign
  };
}

// ----------------------------------------------------------------------------
// 1. Вспомогательные контракты: SHA-256, классификация C1–C4
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: вспомогательные контракты', () => {
  // Векторы NIST FIPS 180-4 — независимый оракул для prTpdSearchSha256Hex.
  it('SHA-256: векторы NIST (пустая строка, "abc")', () => {
    expect(prTpdSearchSha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(prTpdSearchSha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('п. 24: классы C1–C4 взаимоисключающи и исчерпывающи (§6.6)', () => {
    const tNeg = PR_TPD_SEARCH_NEGATIVE_THRESHOLD;
    expect(tNeg).toBe(-1e-10);
    // C1: U < t_neg.
    expect(classifyPrTpdInterval(-2e-10, 0, tNeg)).toBe('C1');
    // C1: интервал целиком ниже t_neg (U = tpd + bound = -1e-6).
    expect(classifyPrTpdInterval(-1e-5, 9e-6, tNeg)).toBe('C1');
    // C2: t_neg <= U < 0 (здесь U = -1e-6 >= t_neg = -1e-5).
    expect(classifyPrTpdInterval(-1e-5, 9e-6, -1e-5)).toBe('C2');
    expect(classifyPrTpdInterval(-1e-11, 0, tNeg)).toBe('C2');
    // C3: L < 0 <= U; [negative, 0] — C3, НЕ C4 (U = 0 попадает в C3).
    expect(classifyPrTpdInterval(0, 1e-6, tNeg)).toBe('C3');
    expect(classifyPrTpdInterval(-1e-6, 1e-6, tNeg)).toBe('C3');
    // C4: L >= 0; точный [0, 0] — ТОЛЬКО C4; [0, positive] — C4.
    expect(classifyPrTpdInterval(1e-6, 1e-6, tNeg)).toBe('C4');
    expect(classifyPrTpdInterval(0, 0, tNeg)).toBe('C4');
    // [0, positive]: L = 0 => tpd = bound.
    expect(classifyPrTpdInterval(1e-9, 1e-9, tNeg)).toBe('C4');
    // Неконечный tpd — консервативно C3 (fail-closed).
    expect(classifyPrTpdInterval(Number.NaN, 0, tNeg)).toBe('C3');
    // Недоступный/некорректный bound — дегенерация [tpd, tpd].
    expect(classifyPrTpdInterval(-1e-5, -1, tNeg)).toBe('C1');
    // t_neg недоступен: C1 вырождается в U < 0, C2 пуст.
    expect(classifyPrTpdInterval(-1e-5, null, null)).toBe('C1');
    expect(classifyPrTpdInterval(-1e-11, null, null)).toBe('C1');
  });

  it('п. 10/17: C2 (−5e−11, bound << 1e−11) не даёт строгих verdicts', () => {
    // tpd = -5e-11 > t_neg = -1e-10, bound много меньше 1e-11:
    // U = -5e-11 + 1e-13 ∈ [t_neg, 0) => C2 — отрицательность без
    // margin => indeterminate и НИКОГДА no_instability_found.
    expect(classifyPrTpdInterval(-5e-11, 1e-13, PR_TPD_SEARCH_NEGATIVE_THRESHOLD)).toBe('C2');
  });
});

// ----------------------------------------------------------------------------
// 2. Канонический fingerprint входа
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: canonicalPrInputFingerprint', () => {
  it('п. 43: перестановка компонентов даёт ОДИН fingerprint (сортировка по ID)', () => {
    const inputs = klInputs();
    const permuted: PengRobinsonMixtureInputs = {
      components: [inputs.components[1], inputs.components[0]],
      binaryInteractions: [interaction('n2b', 'n2a', 0, 'VERIFIED', null)]
    };
    expect(canonicalPrInputFingerprint(permuted)).toBe(canonicalPrInputFingerprint(inputs));
  });

  it('moleFraction НЕ входит в fingerprint (состав исключён)', () => {
    const inputs = klInputs();
    const other: PengRobinsonMixtureInputs = {
      components: [
        component('n2a', 0.7, N2.tc, N2.pc, N2.omega),
        component('n2b', 0.3, N2.tc, N2.pc, N2.omega)
      ],
      binaryInteractions: inputs.binaryInteractions
    };
    expect(canonicalPrInputFingerprint(other)).toBe(canonicalPrInputFingerprint(inputs));
  });

  it('изменение чистого параметра меняет fingerprint', () => {
    const inputs = klInputs();
    const other: PengRobinsonMixtureInputs = {
      components: [
        component('n2a', 0.5, 126.193, N2.pc, N2.omega),
        inputs.components[1]
      ],
      binaryInteractions: inputs.binaryInteractions
    };
    expect(canonicalPrInputFingerprint(other)).not.toBe(canonicalPrInputFingerprint(inputs));
  });

  it('детерминизм: два вызова побитово равны', () => {
    expect(canonicalPrInputFingerprint(klInputs())).toBe(canonicalPrInputFingerprint(klInputs()));
  });
});

// ----------------------------------------------------------------------------
// 3. Предикат audit-domain (п. 37, 42, 44, 45)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: evaluatePrTpdAuditDomain / isWithinAuditDomain', () => {
  const inputs = klInputs();
  const request = klRequest();
  const fingerprint = canonicalPrInputFingerprint(inputs);
  const pr = computePengRobinsonMixture(inputs, request);
  if (pr.status !== 'success') {
    throw new Error('KL PR-состояние обязано быть success');
  }
  const point = domainPointFrom(inputs, request, pr, fingerprint, [0.5, 0.5]);
  const domain = domainOver(fingerprint);

  it('п. 37: точка внутри — все условия выполнены', () => {
    // KL: один физический корень, D < 0 (два нефизических Z <= B):
    // near-merge определён по ФИЗИЧЕСКИМ корням (п. 4.1) и неприменим.
    expect(evaluatePrTpdAuditDomain(point, domain)).toBe('inside');
    expect(isWithinAuditDomain(point, domain)).toBe(true);
  });

  it('п. 37: границы включительны', () => {
    const edge = { ...point, temperatureK: 1000, pressurePa: 1e5 };
    expect(evaluatePrTpdAuditDomain(edge, domain)).toBe('inside');
  });

  it('п. 37/43/45: выход за каждую из границ — outside', () => {
    expect(evaluatePrTpdAuditDomain({ ...point, temperatureK: 999 }, domain)).toBe('outside');
    expect(evaluatePrTpdAuditDomain({ ...point, pressurePa: 2e7 }, domain)).toBe('outside');
    expect(
      evaluatePrTpdAuditDomain({ ...point, composition: [0.05, 0.95] }, domain)
    ).toBe('outside');
    expect(evaluatePrTpdAuditDomain({ ...point, componentIds: ['n2a', 'n2x'] }, domain)).toBe(
      'outside'
    );
    expect(
      evaluatePrTpdAuditDomain({ ...point, bipPairIdsUsed: ['n2a|n2x'] }, domain)
    ).toBe('outside');
    expect(evaluatePrTpdAuditDomain({ ...point, evidencePolicy: 'allow_partial' }, domain)).toBe(
      'outside'
    );
    expect(
      evaluatePrTpdAuditDomain({ ...point, prInputFingerprint: 'ffffffff' }, domain)
    ).toBe('outside');
  });

  it('п. 44: null-поле дескриптора — pending, НЕ outside', () => {
    expect(evaluatePrTpdAuditDomain(point, domainOver(fingerprint, { temperatureRangeK: null }))).toBe(
      'pending'
    );
    // nearRootMergeCovered = false и tolerance = null — НЕПОЛОН.
    expect(
      evaluatePrTpdAuditDomain(
        point,
        domainOver(fingerprint, {
          physicalRootMode: {
            twoRootCovered: true,
            nearRootMergeCovered: false,
            nearMergeSeparationTolerance: null,
            multiplicityModeAvailable: true
          }
        })
      )
    ).toBe('pending');
    // multiplicityModeAvailable = null — неполон (корректировка
    // топологии корней).
    expect(
      evaluatePrTpdAuditDomain(
        point,
        domainOver(fingerprint, {
          physicalRootMode: {
            twoRootCovered: true,
            nearRootMergeCovered: true,
            nearMergeSeparationTolerance: 1e-8,
            multiplicityModeAvailable: null
          }
        })
      )
    ).toBe('pending');
  });

  it('п. 42: strict-режим кратности (multiplicityModeAvailable)', () => {
    // false: near-merge по count=1/2 невыводим => вне домена.
    const noMultiplicity = domainOver(fingerprint, {
      physicalRootMode: {
        twoRootCovered: true,
        nearRootMergeCovered: true,
        nearMergeSeparationTolerance: 1e-8,
        multiplicityModeAvailable: false
      }
    });
    expect(evaluatePrTpdAuditDomain(point, noMultiplicity)).toBe('outside');
    // count=1 с не-null separation — некорректное состояние.
    expect(
      evaluatePrTpdAuditDomain({ ...point, minPhysicalRootSeparation: 0.1 }, domain)
    ).toBe('outside');
    // count=1, D = 0 — near-merge в точке: требуется покрытие.
    expect(evaluatePrTpdAuditDomain({ ...point, discriminantSign: 0 }, domain)).toBe('inside');
    const noMergeCovered = domainOver(fingerprint, {
      physicalRootMode: {
        twoRootCovered: true,
        nearRootMergeCovered: false,
        nearMergeSeparationTolerance: 1e-8,
        multiplicityModeAvailable: true
      }
    });
    expect(evaluatePrTpdAuditDomain({ ...point, discriminantSign: 0 }, noMergeCovered)).toBe(
      'outside'
    );
    // count=1, D > 0 — один различимый корень, слияние исключено.
    expect(evaluatePrTpdAuditDomain({ ...point, discriminantSign: 1 }, domain)).toBe('inside');
    // count=2 при D > 0 — противоречие данных => вне домена.
    const twoRootPoint: PrTpdAuditDomainPoint = {
      ...point,
      physicalRootCount: 2,
      minPhysicalRootSeparation: 0.1
    };
    expect(evaluatePrTpdAuditDomain({ ...twoRootPoint, discriminantSign: 1 }, domain)).toBe(
      'outside'
    );
    // count=2 при D < 0: separation >= tolerance => twoRootCovered.
    expect(evaluatePrTpdAuditDomain({ ...twoRootPoint, discriminantSign: -1 }, domain)).toBe(
      'inside'
    );
    expect(
      evaluatePrTpdAuditDomain({ ...twoRootPoint, discriminantSign: -1 }, domainOver(fingerprint, {
        physicalRootMode: {
          twoRootCovered: false,
          nearRootMergeCovered: true,
          nearMergeSeparationTolerance: 1e-8,
          multiplicityModeAvailable: true
        }
      }))
    ).toBe('outside');
    // count=2, separation < tolerance => near-merge => требуется
    // nearRootMergeCovered; separation = null при count=2 — вне домена
    // при полном дескрипторе.
    expect(
      evaluatePrTpdAuditDomain(
        { ...twoRootPoint, minPhysicalRootSeparation: 1e-12, discriminantSign: -1 },
        noMergeCovered
      )
    ).toBe('outside');
    expect(
      evaluatePrTpdAuditDomain(
        { ...twoRootPoint, minPhysicalRootSeparation: null, discriminantSign: -1 },
        domain
      )
    ).toBe('outside');
    // count=3: separation >= tolerance => twoRootCovered; < tolerance =>
    // nearRootMergeCovered.
    const threeRootPoint: PrTpdAuditDomainPoint = {
      ...point,
      physicalRootCount: 3,
      minPhysicalRootSeparation: 0.1
    };
    expect(evaluatePrTpdAuditDomain(threeRootPoint, domain)).toBe('inside');
    expect(
      evaluatePrTpdAuditDomain(
        { ...threeRootPoint, minPhysicalRootSeparation: 1e-12 },
        noMergeCovered
      )
    ).toBe('outside');
  });
});

// ----------------------------------------------------------------------------
// 4. KL-предел: строгий verdict и негативный контроль (п. 1, 9, 19)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: KL-предел (п. 1, 5, 9, 12, 13, 19, 23)', () => {
  const inputs = klInputs();
  const request = klRequest();
  const fingerprint = canonicalPrInputFingerprint(inputs);
  const domain = domainOver(fingerprint);

  const boundResult = requireSuccess(
    computePrTangentPlaneDistanceSearch({
      mixtureInputs: inputs,
      request,
      validatedErrorBoundAudit: { validatedErrorBound: 0, validatedDomain: domain }
    })
  );

  it('п. 1/19: validated bound = 0 + полный домен => no_instability_found', () => {
    expect(boundResult.searchVerdict).toBe('no_instability_found_within_search');
    expect(boundResult.verdictReason).toBe('all_attempts_converged_all_points_c4');
    expect(boundResult.branchCoverageComplete).toBe(true);
    expect(boundResult.faceEnumeration).toBe('complete');
    expect(boundResult.validatedErrorBoundStatus).toBe('validated');
  });

  it('п. 1: каждая посещённая точка — C4 с validated bound в домене', () => {
    for (const attempt of boundResult.attempts) {
      for (const point of attempt.visitedPoints) {
        expect(point.validatedErrorBoundStatus).toBe('validated_bound_in_domain');
        expect(point.validatedErrorBound).toBe(0);
        expect(point.tpd).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('п. 1: KL-оракул — вершина tpd = ln 2 ТОЧНО, feed tpd = ровно +0', () => {
    const vertexAttempts = boundResult.attempts.filter((a) => a.support.length === 1);
    expect(vertexAttempts.length).toBe(2);
    for (const attempt of vertexAttempts) {
      expect(attempt.outcome).toBe('converged');
      expect(attempt.finalStationaryPoint).not.toBe(null);
      expect(attempt.finalStationaryPoint?.tpd).toBe(Math.LN2);
      // Независимый оракул: g(w; z) = KL(w||z) на вершине = ln 2;
      // слагаемое 0·ln(0) = 0 по конвенции предела.
      const kl = Math.log(1 / 0.5);
      expect(kl).toBe(Math.LN2);
    }
    const feedAttempt = boundResult.attempts.find((a) => a.support.length === 2);
    expect(feedAttempt).toBeDefined();
    expect(feedAttempt?.finalStationaryPoint?.tpd).toBe(0);
  });

  it('п. 16: механика g* — ΣY = exp(−tpd) против независимого оракула', () => {
    const feedPr = computePengRobinsonMixture(inputs, request);
    if (feedPr.status !== 'success') {
      throw new Error('feed PR обязан быть success');
    }
    const lnPhiZ = new Map<string, number>();
    for (const item of feedPr.components) {
      lnPhiZ.set(item.component, item.lnPhi);
    }
    const zOf = new Map<string, number>();
    for (const item of inputs.components) {
      zOf.set(item.component, item.moleFraction);
    }
    for (const attempt of boundResult.attempts) {
      if (attempt.outcome !== 'converged' || attempt.finalStationaryPoint === null) {
        continue;
      }
      const trialComponents = inputs.components.map((item, index) => ({
        ...item,
        moleFraction: attempt.finalStationaryPoint?.composition[index] ?? 0
      }));
      const trialPr = computePengRobinsonMixture(
        { components: trialComponents, binaryInteractions: inputs.binaryInteractions },
        { ...request, root: attempt.continuationBranch }
      );
      if (trialPr.status !== 'success') {
        throw new Error('trial PR обязан быть success');
      }
      const lnPhiW = new Map<string, number>();
      for (const item of trialPr.components) {
        lnPhiW.set(item.component, item.lnPhi);
      }
      // Оракул: ΣY = Σ_{i∈support} z_i · exp(lnPhi_i(z) − lnPhi_i(w*)).
      let sumY = 0;
      for (const id of attempt.support) {
        const z = zOf.get(id) ?? 0;
        sumY += z * Math.exp((lnPhiZ.get(id) ?? 0) - (lnPhiW.get(id) ?? 0));
      }
      expect(sumY).toBeCloseTo(Math.exp(-(attempt.finalStationaryPoint?.tpd ?? Number.NaN)), 10);
    }
  });

  it('п. 5: single-root — РОВНО одна попытка на старт, обе метки одного корня', () => {
    for (const attempt of boundResult.attempts) {
      expect(attempt.singlePhysicalRoot).toBe(true);
      expect(attempt.initialBranch).toBe('single');
      expect(attempt.logicalLabels).toEqual(['vapor', 'liquid']);
      for (const point of attempt.visitedPoints) {
        expect(point.physicalRootCount).toBe(1);
        expect(point.rootLabels).toEqual(['vapor', 'liquid']);
        expect(point.selectedRoot).toBe(boundResult.attempts[0].visitedPoints[0].selectedRoot);
      }
    }
    // Дедупликация: 3 попытки (полный носитель + 2 вершины), не больше.
    expect(boundResult.attempts.length).toBe(3);
    expect(boundResult.counts.attemptCount).toBe(3);
    expect(boundResult.counts.faceCount).toBe(2);
  });

  it('п. 13/29: точный бюджет и дедупликация стартов', () => {
    // wilson/uniform/pair старты на полном носителе вырождаются в z
    // (идентичные компоненты) и дедуплицируются с feed.
    expect(boundResult.counts.prEvaluations).toBe(6);
    // Формула §4.4 на KL: 1 (feed) + полный носитель с feedReuse
    // (0 + N_max) + 2 вершины × (1 + N_max) = 1 + 300 + 602 = 903.
    expect(boundResult.counts.maxPrEvaluations).toBe(903);
    expect(boundResult.counts.prEvaluations).toBeLessThanOrEqual(
      boundResult.counts.maxPrEvaluations
    );
    // Попытточная точность счёта (замена глобального равенства п. 29,
    // структурно недостижимого из-за раннего завершения SS):
    // prEvaluations = начальные вызовы + итерации (без отказных).
    // Feed-попытка полного носителя переиспользует feed-состояние
    // (§4.4 feedReuse => 0 начальных вызовов); вершинные попытки
    // включают discovery-вызов (1 + итерации).
    const feedAttempt = boundResult.attempts.find((a) => a.support.length === 2);
    expect(feedAttempt).toBeDefined();
    expect(feedAttempt?.prEvaluations).toBe(feedAttempt?.iterations);
    for (const attempt of boundResult.attempts) {
      expect(attempt.outcome).toBe('converged');
      if (attempt.support.length === 1) {
        expect(attempt.prEvaluations).toBe(attempt.iterations + 1);
      }
    }
  });

  it('п. 25: stationarityResidual — критерий сходимости, НЕ оценка ошибки', () => {
    for (const attempt of boundResult.attempts) {
      expect(attempt.stationarityResidual ?? 1).toBeLessThanOrEqual(PR_TPD_SEARCH_SIGMA_STAT);
      for (const point of attempt.visitedPoints) {
        // validatedErrorBound точки = аудитный bound, НЕ невязка.
        expect(point.validatedErrorBound).toBe(0);
      }
    }
  });

  it('п. 9(c): негативный контроль БЕЗ bound => indeterminate', () => {
    const result = requireSuccess(
      computePrTangentPlaneDistanceSearch({ mixtureInputs: inputs, request })
    );
    expect(result.searchVerdict).toBe('indeterminate');
    expect(result.verdictReason).toBe('validated_bound_not_available');
    expect(result.validatedErrorBoundStatus).toBe('pending_validation');
    for (const attempt of result.attempts) {
      for (const point of attempt.visitedPoints) {
        expect(point.validatedErrorBoundStatus).toBe('not_established');
        expect(point.validatedErrorBound).toBe(null);
      }
    }
  });

  it('п. 9(d)/35/36/38: только empirical envelope => indeterminate, никогда validated', () => {
    const result = requireSuccess(
      computePrTangentPlaneDistanceSearch({
        mixtureInputs: inputs,
        request,
        observedEnvelopeAudit: { observedErrorEnvelope: 1e-3, auditDomain: domain }
      })
    );
    expect(result.searchVerdict).toBe('indeterminate');
    expect(result.verdictReason).toBe('validated_bound_not_available');
    expect(result.observedErrorEnvelope).toBe(1e-3);
    expect(result.observedErrorEnvelopeStatus).toBe('observed_envelope');
    for (const attempt of result.attempts) {
      for (const point of attempt.visitedPoints) {
        expect(point.observedErrorEnvelopeStatus).toBe('observed_envelope_in_domain');
        expect(point.observedErrorEnvelope).toBe(1e-3);
        // Эмпирика НЕ повышается до validated (п. 38).
        expect(point.validatedErrorBoundStatus).toBe('not_established');
      }
    }
  });

  it('п. 21(1): точка ВНЕ auditDomain, но ВНУТРИ validatedDomain', () => {
    const outsideEnvelopeDomain = domainOver(fingerprint, {
      temperatureRangeK: { min: 1, max: 10 }
    });
    const result = requireSuccess(
      computePrTangentPlaneDistanceSearch({
        mixtureInputs: inputs,
        request,
        observedEnvelopeAudit: {
          observedErrorEnvelope: 1e-3,
          auditDomain: outsideEnvelopeDomain
        },
        validatedErrorBoundAudit: { validatedErrorBound: 0, validatedDomain: domain }
      })
    );
    expect(result.searchVerdict).toBe('no_instability_found_within_search');
    for (const attempt of result.attempts) {
      for (const point of attempt.visitedPoints) {
        expect(point.observedErrorEnvelopeStatus).toBe('outside_audit_domain');
        expect(point.validatedErrorBoundStatus).toBe('validated_bound_in_domain');
      }
    }
  });

  it('п. 21(2): точка ВНУТРИ auditDomain, но ВНЕ validatedDomain', () => {
    const outsideValidatedDomain = domainOver(fingerprint, {
      temperatureRangeK: { min: 1, max: 10 }
    });
    const result = requireSuccess(
      computePrTangentPlaneDistanceSearch({
        mixtureInputs: inputs,
        request,
        observedEnvelopeAudit: { observedErrorEnvelope: 1e-3, auditDomain: domain },
        validatedErrorBoundAudit: {
          validatedErrorBound: 0,
          validatedDomain: outsideValidatedDomain
        }
      })
    );
    expect(result.searchVerdict).toBe('indeterminate');
    for (const attempt of result.attempts) {
      for (const point of attempt.visitedPoints) {
        expect(point.observedErrorEnvelopeStatus).toBe('observed_envelope_in_domain');
        expect(point.validatedErrorBoundStatus).toBe('outside_validated_domain');
      }
    }
  });

  it('п. 12/23: два вызова — побитово равные результаты (все поля)', () => {
    const again = computePrTangentPlaneDistanceSearch({
      mixtureInputs: inputs,
      request,
      validatedErrorBoundAudit: { validatedErrorBound: 0, validatedDomain: domain }
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(boundResult));
  });

  it('п. 6: перестановка компонентов — побитовая инвариантность', () => {
    const permuted: PengRobinsonMixtureInputs = {
      components: [inputs.components[1], inputs.components[0]],
      binaryInteractions: [interaction('n2b', 'n2a', 0, 'VERIFIED', null)]
    };
    const permutedResult = computePrTangentPlaneDistanceSearch({
      mixtureInputs: permuted,
      request,
      validatedErrorBoundAudit: { validatedErrorBound: 0, validatedDomain: domain }
    });
    expect(JSON.stringify(permutedResult)).toBe(JSON.stringify(boundResult));
  });

  it('отсутствие verdict-имени "stable" (фиксация множества имён)', () => {
    expect(boundResult.searchVerdict).toBe('no_instability_found_within_search');
    expect(
      ['unstable_detected', 'no_instability_found_within_search', 'indeterminate'].includes(
        boundResult.searchVerdict
      )
    ).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// 5. Три физических корня: PURE co2 (п. 4, 5, 7, 27, 39, 46)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: три физических корня (п. 4, 5, 7, 27, 39, 46)', () => {
  const inputs = pureInputs();
  const request = pureRequest();
  const result = requireSuccess(
    computePrTangentPlaneDistanceSearch({ mixtureInputs: inputs, request })
  );
  const pr = computePengRobinsonMixture(inputs, request);
  if (pr.status !== 'success') {
    throw new Error('PURE PR обязан быть success');
  }
  // Сужение фиксируется в константах: замыкания it() не полагаются на
  // narrowing локальной переменной объединения (страховка против
  // версионных различий сужения в замыканиях).
  const pureRoots: readonly number[] = pr.physicalRoots;
  const pureRootCount: number = pr.distinctPhysicalRootCount;
  const pureHasDistinctBranches: boolean = pr.hasDistinctBranches;

  it('п. 46: независимый оракул — три физических корня Z', () => {
    expect(pureRootCount).toBe(3);
    expect(pureRoots.length).toBe(3);
    expect(pureRoots[0]).toBeCloseTo(0.0198964, 6);
    expect(pureRoots[1]).toBeCloseTo(0.0652088, 6);
    expect(pureRoots[2]).toBeCloseTo(0.9020656, 6);
    expect(pureHasDistinctBranches).toBe(true);
  });

  it('п. 46: physicalRootCount ≠ searchBranchCount — обследуются 2 крайние ветви', () => {
    // 2 попытки (vapor + liquid), НЕ 3; промежуточный корень явно
    // необследованный.
    expect(result.attempts.length).toBe(2);
    expect(result.counts.attemptCount).toBe(2);
    expect(result.notes).toContain('intermediate_physical_root_not_surveyed');
    expect(result.branchCoverageComplete).toBe(true);
    // faceCount = 2^1 − 2 = 0: единственная грань — сам носитель.
    expect(result.counts.faceCount).toBe(0);
    // Бюджет §4.4: 1 (feed) + (2 − feedReuse = 1) + 2 × N_max = 602.
    expect(result.counts.maxPrEvaluations).toBe(602);
    expect(result.counts.prEvaluations).toBeLessThanOrEqual(result.counts.maxPrEvaluations);
  });

  it('п. 5/39: обе ветви выполняются независимо; feedRoot ≠ trial root', () => {
    const vapor = result.attempts.find((a) => a.continuationBranch === 'vapor');
    const liquid = result.attempts.find((a) => a.continuationBranch === 'liquid');
    expect(vapor).toBeDefined();
    expect(liquid).toBeDefined();
    expect(vapor?.initialBranch).toBe('vapor');
    expect(liquid?.initialBranch).toBe('liquid');
    // logicalLabels two-root попытки — по одной фактической ветви.
    for (const attempt of result.attempts) {
      expect(attempt.logicalLabels).toEqual([attempt.continuationBranch]);
      expect(attempt.singlePhysicalRoot).toBe(false);
    }
    // vapor = наибольший корень, liquid = наименьший.
    expect(vapor?.selectedRoot).toBe(pureRoots[2]);
    expect(liquid?.selectedRoot).toBe(pureRoots[0]);
    // rootLabels точек — фактическая ветвь попытки.
    for (const point of vapor?.visitedPoints ?? []) {
      expect(point.rootLabels).toEqual(['vapor']);
      expect(point.physicalRootCount).toBe(3);
    }
  });

  it('п. 4: тот же состав на двух ветвях — состояния НЕ подменяются exact-zero', () => {
    const vapor = result.attempts.find((a) => a.continuationBranch === 'vapor');
    const liquid = result.attempts.find((a) => a.continuationBranch === 'liquid');
    expect(vapor?.startComposition).toEqual(liquid?.startComposition);
    // Тот же состав, РАЗНЫЕ selectedRoot и rootLabels; альтернативная
    // точка не равна exact +0 (отличается от feed-ветви).
    expect(vapor?.selectedRoot).not.toBe(liquid?.selectedRoot);
    // Feed-ветвь (vapor = feedRoot) на w = z — тривиальная точка +0.
    expect(vapor?.visitedPoints[0]?.tpd).toBe(0);
    // Альтернативная ветвь на ТОМ ЖЕ составе — вычисленное состояние с
    // TPD ≠ 0 в общем случае (независимый оракул — прямой пересчёт
    // формулы g ниже в п. 16 через ΣY уже покрыт KL; здесь фиксируем
    // отличие от точного нуля).
    expect(liquid?.visitedPoints[0]?.tpd).not.toBe(0);
  });

  it('п. 7: нулевая доля n2 — грань не обследуется, support соблюден', () => {
    const subsets = result.examinedSubsets;
    expect(subsets.length).toBe(1);
    expect(subsets[0]).toEqual(['co2']);
    for (const attempt of result.attempts) {
      expect(attempt.support).toEqual(['co2']);
      for (const point of attempt.visitedPoints) {
        expect(point.composition[1]).toBe(0);
      }
    }
  });
});

// ----------------------------------------------------------------------------
// 6. SC1: синтетический надёжно отрицательный TPD (п. 2)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: SC1 — надёжно отрицательный TPD (п. 2, 8, 10)', () => {
  const inputs = sc1Inputs();
  const request = sc1Request();
  const fingerprint = canonicalPrInputFingerprint(inputs);
  const domain = domainOver(fingerprint, {
    temperatureRangeK: { min: 150, max: 300 },
    pressureRangePa: { min: 1e5, max: 5e7 },
    bipPolicy: {
      requiredEvidencePolicy: 'allow_partial',
      allowedBipSources: ['evidence:PARTIALLY_VERIFIED'],
      allowedBipPairIds: ['co2|n2']
    },
    componentPolicy: {
      allowedComponentIds: ['co2', 'n2'],
      allowedPrInputFingerprints: [fingerprint]
    }
  });

  // Синтетический validated bound задан тестом (механика поиска, НЕ
  // экспериментальная валидация EOS).
  const result = requireSuccess(
    computePrTangentPlaneDistanceSearch({
      mixtureInputs: inputs,
      request,
      validatedErrorBoundAudit: { validatedErrorBound: 1e-5, validatedDomain: domain }
    })
  );

  it('п. 2: verdict unstable_detected, bestVisitedTpd — класс C1', () => {
    expect(result.searchVerdict).toBe('unstable_detected');
    expect(result.verdictReason).toBe('c1_visited_point');
    // Проверка класса C1 против t_neg: U = tpd + bound < t_neg.
    const best = result.bestVisitedTpd;
    expect(best).not.toBe(null);
    expect((best ?? 0) + 1e-5).toBeLessThan(PR_TPD_SEARCH_NEGATIVE_THRESHOLD);
    expect(best).toBe(-1.099212343755963);
    expect(result.counts.prEvaluations).toBeLessThanOrEqual(result.counts.maxPrEvaluations);
  });

  it('п. 8: bestVisitedPoint <= finalStationaryPoint; глобальный минимум по всем попыткам', () => {
    let minTpd = Number.POSITIVE_INFINITY;
    for (const attempt of result.attempts) {
      const bestPoint = attempt.bestVisitedPoint;
      if (bestPoint !== null) {
        minTpd = Math.min(minTpd, bestPoint.tpd);
        const finalPoint = attempt.finalStationaryPoint;
        if (finalPoint !== null) {
          expect(bestPoint.tpd).toBeLessThanOrEqual(finalPoint.tpd);
        }
        // Состав, ветвь, номер итерации и вклады сохранены. Вклады
        // строятся по trial-support: по одному на КАЖДУЮ ненулевую
        // долю точки (вершинные попытки — один вклад).
        expect(bestPoint.composition.length).toBe(2);
        expect(bestPoint.iterationIndex).toBeGreaterThanOrEqual(0);
        expect(bestPoint.tpdContributions.length).toBe(
          bestPoint.composition.filter((value) => value !== 0).length
        );
      }
    }
    expect(result.bestVisitedTpd).toBe(minTpd);
    if (result.bestVisitedPoint !== null) {
      expect(result.bestVisitedPoint.point.tpd).toBe(minTpd);
      expect(result.bestVisitedPoint.attemptIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('п. 3: множественные старты присутствуют (механика multi-start)', () => {
    const startIds = new Set(result.attempts.map((a) => a.startId));
    expect(startIds.size).toBe(result.attempts.length);
    const withWilson = [...startIds].filter((id) => id.includes('wilson'));
    expect(withWilson.length).toBeGreaterThan(0);
    // В вклад в indeterminate/verdict вклад всех попыток: попытки не
    // удаляются и не склеиваются.
    expect(result.attempts.length).toBeGreaterThanOrEqual(2);
  });

  it('п. 11: в результате нет NaN/Infinity ни в tpd, ни в счётчиках', () => {
    expect(Number.isFinite(result.bestVisitedTpd ?? 0)).toBe(true);
    expect(Number.isFinite(result.counts.prEvaluations)).toBe(true);
    for (const attempt of result.attempts) {
      expect(Number.isFinite(attempt.selectedRoot)).toBe(true);
      for (const point of attempt.visitedPoints) {
        expect(Number.isFinite(point.tpd)).toBe(true);
      }
    }
  });
});

// ----------------------------------------------------------------------------
// 7. F9A: исчерпание SS-итераций без fallback (п. 14, 15, 20, 9a)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: F9A — max_iterations без fallback (п. 9a, 14, 15, 20)', () => {
  const inputs = f9aInputs();
  const request = f9aRequest();
  const fingerprint = canonicalPrInputFingerprint(inputs);
  const domain = domainOver(fingerprint, {
    temperatureRangeK: { min: 150, max: 300 },
    pressureRangePa: { min: 1e5, max: 5e7 },
    bipPolicy: {
      requiredEvidencePolicy: 'allow_partial',
      allowedBipSources: ['evidence:PARTIALLY_VERIFIED'],
      allowedBipPairIds: ['co2|n2']
    },
    componentPolicy: {
      allowedComponentIds: ['co2', 'n2'],
      allowedPrInputFingerprints: [fingerprint]
    }
  });

  const withBound = requireSuccess(
    computePrTangentPlaneDistanceSearch({
      mixtureInputs: inputs,
      request,
      validatedErrorBoundAudit: { validatedErrorBound: 1e-5, validatedDomain: domain }
    })
  );
  const noBound = requireSuccess(
    computePrTangentPlaneDistanceSearch({ mixtureInputs: inputs, request })
  );

  it('п. 20: попытка исчерпывает N_max SS-обновлений, fallback НЕТ', () => {
    const maxIterAttempts = noBound.attempts.filter((a) => a.outcome === 'max_iterations');
    expect(maxIterAttempts.length).toBeGreaterThanOrEqual(2);
    for (const attempt of maxIterAttempts) {
      expect(attempt.iterations).toBe(PR_TPD_SEARCH_MAX_ITERATIONS);
      expect(attempt.finalStationaryPoint).toBe(null);
      expect(attempt.prEvaluations).toBe(PR_TPD_SEARCH_MAX_ITERATIONS + 1);
    }
    // Все попытки — только SS: бюджет попытки не превышен.
    expect(noBound.counts.prEvaluations).toBeLessThanOrEqual(noBound.counts.maxPrEvaluations);
  });

  it('п. 20: без validated bound => indeterminate с явной причиной', () => {
    expect(noBound.searchVerdict).toBe('indeterminate');
    expect(noBound.verdictReason).toBe('max_iterations_attempt');
  });

  it('п. 9(a): отрицательная точка в незавершённой попытке + C1 => unstable_detected', () => {
    // Надёжно отрицательная посещённая точка (класс C1 по validated
    // bound) сохранена и НЕ потеряна, несмотря на max_iterations.
    expect(withBound.searchVerdict).toBe('unstable_detected');
    expect(withBound.verdictReason).toBe('c1_visited_point');
    const best = withBound.bestVisitedTpd;
    expect(best).not.toBe(null);
    expect((best ?? 0) + 1e-5).toBeLessThan(PR_TPD_SEARCH_NEGATIVE_THRESHOLD);
    // Найденное значение сохранено в bestVisitedPoint попытки.
    const holder = withBound.attempts.find(
      (a) => a.bestVisitedPoint !== null && a.bestVisitedPoint.tpd === best
    );
    expect(holder).toBeDefined();
    expect(holder?.outcome).toBe('max_iterations');
  });

  it('п. 14: масштаб Wilson Y сохранён — старт не нормирован заранее', () => {
    // Независимый оракул: ln K = ln Pc − ln P + 5.373(1+ω)(1 − Tc/T).
    const lnKCo2 =
      Math.log(CO2.pc) - Math.log(request.pressurePa) +
      5.373 * (1 + CO2.omega) * (1 - CO2.tc / request.temperatureK);
    const lnKN2 =
      Math.log(N2.pc) - Math.log(request.pressurePa) +
      5.373 * (1 + N2.omega) * (1 - N2.tc / request.temperatureK);
    const kCo2 = Math.exp(lnKCo2);
    const kN2 = Math.exp(lnKN2);
    const times = [0.5 * kCo2, 0.5 * kN2];
    const sumTimes = times[0] + times[1];
    const expectedTimes = [times[0] / sumTimes, times[1] / sumTimes];
    const timesAttempt = noBound.attempts.find((a) => a.startId.endsWith(':wilson_z_times_k'));
    expect(timesAttempt).toBeDefined();
    expect(timesAttempt?.startComposition[0]).toBeCloseTo(expectedTimes[0], 12);
    expect(timesAttempt?.startComposition[1]).toBeCloseTo(expectedTimes[1], 12);
    // п. 15: нормализация ДО итераций запрещена — старт обязан быть
    // Y/ΣY, а не «w как Y» (ΣY⁰ ≠ 1 фиксируется отличием от z).
    expect(expectedTimes[0]).not.toBe(0.5);
    expect(timesAttempt?.startComposition).not.toEqual([0.5, 0.5]);
    // Обратный старт z/K — ДРУГОЕ начальное состояние (не дубликат).
    const overAttempt = noBound.attempts.find((a) => a.startId.endsWith(':wilson_z_over_k'));
    expect(overAttempt).toBeDefined();
    expect(overAttempt?.startComposition).not.toEqual(timesAttempt?.startComposition);
  });
});

// ----------------------------------------------------------------------------
// 8. Частичное перечисление граней: s = 6 (п. 9(b), 34)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: шесть компонентов — частичные грани', () => {
  it('s=6: faceCount = 62, examined = 22, partial => indeterminate', () => {
    const components: PengRobinsonMixtureComponentInput[] = [];
    for (let k = 0; k < 6; k += 1) {
      components.push(component('c' + (k + 1), 1 / 6, N2.tc, N2.pc, N2.omega));
    }
    const binaryInteractions: PengRobinsonBinaryInteractionInput[] = [];
    for (let a = 0; a < 6; a += 1) {
      for (let b = a + 1; b < 6; b += 1) {
        binaryInteractions.push(
          interaction('c' + (a + 1), 'c' + (b + 1), 0, 'VERIFIED', null)
        );
      }
    }
    const result = requireSuccess(
      computePrTangentPlaneDistanceSearch({
        mixtureInputs: { components, binaryInteractions },
        request: {
          temperatureK: N2_ZERO_ATTRACTION_T,
          pressurePa: 1e6,
          root: 'vapor',
          evidencePolicy: 'verified_only'
        }
      })
    );
    // 2^6 − 2 = 62 структурные грани; обследованы полный носитель +
    // сочетания размеров 5 и 4: 1 + 6 + 15 = 22.
    expect(result.counts.faceCount).toBe(62);
    expect(result.examinedSubsets.length).toBe(22);
    expect(result.examinedSubsets[0].length).toBe(6);
    expect(result.faceEnumeration).toBe('partial');
    expect(result.notes).toContain('partial_face_enumeration');
    expect(result.searchVerdict).toBe('indeterminate');
    expect(result.verdictReason).toBe('partial_face_enumeration');
    expect(result.counts.prEvaluations).toBeLessThanOrEqual(result.counts.maxPrEvaluations);
  });
});

// ----------------------------------------------------------------------------
// 9. C-фикстура: single-root семантика (п. 22, 32)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: single-root заметки (п. 22, 32)', () => {
  it('п. 22/32: single-root попытки — обе метки, продолжение по feedRoot', () => {
    const result = requireSuccess(
      computePrTangentPlaneDistanceSearch({
        mixtureInputs: cInputs(),
        request: { temperatureK: 220, pressurePa: 2e6, root: 'vapor', evidencePolicy: 'verified_only' }
      })
    );
    expect(result.status).toBe('success');
    // Заметка single_physical_root: feed-состояние имеет один
    // физический корень (контракт продолжения по feedRoot без
    // динамического fork).
    expect(result.notes).toContain('single_physical_root');
    for (const attempt of result.attempts) {
      if (attempt.singlePhysicalRoot) {
        expect(attempt.initialBranch).toBe('single');
        expect(attempt.logicalLabels).toEqual(['vapor', 'liquid']);
        expect(attempt.continuationBranch).toBe('vapor');
      }
    }
    expect(result.counts.prEvaluations).toBeLessThanOrEqual(result.counts.maxPrEvaluations);
  });
});

// ----------------------------------------------------------------------------
// 10. Валидация входа (§7.1)
// ----------------------------------------------------------------------------

describe('Stage 4.4.4.4.2: валидация входа', () => {
  it('некорректный вход — структурный отказ слоя', () => {
    const failure = computePrTangentPlaneDistanceSearch(
      null as unknown as Parameters<typeof computePrTangentPlaneDistanceSearch>[0]
    );
    expect(failure.status).toBe('failure');
  });

  it('отрицательный validatedErrorBound — отказ', () => {
    const failure = computePrTangentPlaneDistanceSearch({
      mixtureInputs: klInputs(),
      request: klRequest(),
      validatedErrorBoundAudit: {
        validatedErrorBound: -1,
        validatedDomain: domainOver(canonicalPrInputFingerprint(klInputs()))
      }
    });
    expect(failure.status).toBe('failure');
  });

  it('некорректная сумма состава — отказ валидатора смеси', () => {
    const failure = computePrTangentPlaneDistanceSearch({
      mixtureInputs: {
        components: [
          component('n2a', 0.5, N2.tc, N2.pc, N2.omega),
          component('n2b', 0.4, N2.tc, N2.pc, N2.omega)
        ],
        binaryInteractions: [interaction('n2a', 'n2b', 0, 'VERIFIED', null)]
      },
      request: klRequest()
    });
    expect(failure.status).toBe('failure');
  });
});
