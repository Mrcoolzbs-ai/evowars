// ============================================
// rustPreparedKineticsParity.test.ts — парити prepared-сессии
// Stage I (Persistent Rust/WASM Kinetics Session)
// ============================================
//
// Эквивалентность ТРЁХ архитектур вычисления k(T):
// 1. нативный публичный API evaluateRateConstant (Core/kinetics.ts);
// 2. prepared TS (preparedKineticsReplica.ts): валидация один раз,
//    тик — плоский цикл по подготовленным массивам;
// 3. Rust/WASM prepared-сессия (kinetics_session.rs через
//    rustKineticsSession.ts): параметры в памяти WASM, тик = T/M.
//
// Проверяются: обе формы Аррениуса, fall-off (+ диагностика),
// температурные границы (включительно), numerical_failure,
// invalid_third_body, invalid_input (в т.ч. arrhenius + [M],
// некорректная T), экстремумы, повторные тики, ИЗМЕНЕНИЕ T/M
// между тиками и lifecycle сессии (prepare/tick/dispose, лимит
// активных сессий, отказ после dispose).
//
// Самопропуск: без pkg-node (loadRustSimCore() → null) сьют
// пропускается целиком — как rustWasmParity.test.ts (Stage H).
//
// Допуски: относительный 1e-12 для значений (контракт не обещает
// побитовой идентичности Math.pow/exp vs f64::powf/exp), коды и
// статусы — точно. Stage H parity-тесты не ослабляются и не меняются.

import { describe, expect, it } from 'vitest';
import { KineticsError, evaluateRateConstant } from '../Core/kinetics';
import type {
  ArrheniusParameters,
  FallOffParameters,
  KineticReactionRecord,
  KineticsErrorCode,
  RateConstantEvaluation,
  RateConstantEvaluationOptions,
  RateConstantUnit
} from '../Core/kinetics';
import { quantity } from '../Core/physicalQuantity';
import type { PhysicalQuantity } from '../Core/physicalQuantity';
import type { DataProvenance } from '../Core/scientificValue';
import { loadRustSimCore } from '../RustSim/rustSimCore';
import type { RustSimCoreWasm } from '../RustSim/rustSimCore';
import {
  packPreparedKineticsParams,
  RustPreparedKineticsSession,
  MAX_ACTIVE_SESSIONS
} from '../RustSim/rustKineticsSession';
import type { PreparedKineticsOutcome } from '../RustSim/rustKineticsSession';
import { prepareTsKinetics, preparedStatusToCode } from '../RustSim/preparedKineticsReplica';

const wasm = await loadRustSimCore();
const core: RustSimCoreWasm = wasm as RustSimCoreWasm;
const maybe = wasm === null ? describe.skip : describe;

// --------------------------------------------
// Фикстуры (зеркалируют rustWasmParity.test.ts)
// --------------------------------------------

function fixtureProvenance(): DataProvenance {
  return {
    sourceName: 'тестовая фикстура (фикция для тестов)',
    method: 'синтетическая кинетическая параметризация (фикция)'
  };
}

function arrhenius(
  a: number,
  n: number,
  energyOverRK: number,
  unit: RateConstantUnit,
  minK = 200,
  maxK = 2000
): ArrheniusParameters {
  return {
    preExponentialA: a,
    temperatureExponentN: n,
    energy: { form: 'E_over_R', valueK: energyOverRK },
    temperatureRangeK: { min: minK, max: maxK },
    unit,
    provenance: fixtureProvenance()
  };
}

function arrheniusEa(a: number, n: number, eaJPerMol: number, unit: RateConstantUnit): ArrheniusParameters {
  return {
    preExponentialA: a,
    temperatureExponentN: n,
    energy: { form: 'Ea_J_mol', valueJPerMol: eaJPerMol },
    temperatureRangeK: { min: 200, max: 2000 },
    unit,
    provenance: fixtureProvenance()
  };
}

function withArrhenius(p: ArrheniusParameters, id = 'test-rxn'): KineticReactionRecord {
  return {
    id,
    kind: 'elementary',
    overallOrder: 2,
    concentrationModel: 'molecule_cm3',
    rateConstant: { status: 'known', parameters: { kind: 'arrhenius', arrhenius: p } },
    provenance: fixtureProvenance()
  };
}

function arrheniusReaction(overrides?: Partial<ArrheniusParameters>): KineticReactionRecord {
  const base: ArrheniusParameters = {
    preExponentialA: 1e-11,
    temperatureExponentN: 0,
    energy: { form: 'E_over_R', valueK: 0 },
    temperatureRangeK: { min: 200, max: 2000 },
    unit: 'cm3_per_molecule_per_s',
    provenance: fixtureProvenance()
  };
  return withArrhenius({ ...base, ...overrides });
}

function fallOffParameters(overrides?: Partial<FallOffParameters>): FallOffParameters {
  const base: FallOffParameters = {
    lowPressureLimit: arrhenius(2e-30, 0, 0, 'cm6_per_molecule2_per_s'),
    highPressureLimit: arrhenius(1e-10, 0, 0, 'cm3_per_molecule_per_s'),
    centeringFactorFc: 0.6,
    broadeningN: 1,
    thirdBodyNote: 'M = N2 + O2 (фикция фикстуры)',
    provenance: fixtureProvenance()
  };
  return { ...base, ...overrides };
}

function fallOffReaction(params?: FallOffParameters): KineticReactionRecord {
  return {
    id: 'test-falloff-1',
    kind: 'elementary',
    overallOrder: 2,
    concentrationModel: 'molecule_cm3',
    rateConstant: { status: 'known', parameters: { kind: 'fall_off', fallOff: params ?? fallOffParameters() } },
    provenance: fixtureProvenance()
  };
}

// --------------------------------------------
// Сессии и сверка трёх архитектур
// --------------------------------------------

/** Одна prepared-сессия WASM + соответствующий prepared TS. */
interface TripleSession {
  session: RustPreparedKineticsSession;
  ts: ReturnType<typeof prepareTsKinetics>;
  dispose(): void;
}

function openTriple(records: readonly KineticReactionRecord[]): TripleSession {
  const session = RustPreparedKineticsSession.prepare(core, records);
  const { params, kindMask } = packPreparedKineticsParams(records);
  const ts = prepareTsKinetics(params, kindMask);
  return {
    session,
    ts,
    dispose(): void {
      session.dispose();
    }
  };
}

type NativeOutcome =
  | { ok: true; evaluation: RateConstantEvaluation }
  | { ok: false; code: KineticsErrorCode };

function nativeOutcome(
  record: KineticReactionRecord,
  temperature: PhysicalQuantity,
  options?: RateConstantEvaluationOptions
): NativeOutcome {
  try {
    return { ok: true, evaluation: evaluateRateConstant(record, temperature, options) };
  } catch (e) {
    if (e instanceof KineticsError) {
      return { ok: false, code: e.code };
    }
    throw e;
  }
}

function expectRelClose(actual: number, expected: number, relTolerance = 1e-12): void {
  if (expected === 0) {
    expect(Math.abs(actual)).toBeLessThan(1e-300);
    return;
  }
  const diff = Math.abs(actual - expected) / Math.abs(expected);
  expect(diff).toBeLessThan(relTolerance);
}

/**
 * Сверка исхода сессии/реплики с нативом по (ok, код | значение +
 * fall-off диагностика). tickInputs задают T/[M] сессии (NaN-конвенция)
 * и эквивалентные нативные temperature/options.
 */
function expectOutcomeEquivalence(
  native: NativeOutcome,
  prepared: PreparedKineticsOutcome,
  tsStatus: number,
  tsValue: number
): void {
  // Сессия и prepared TS обязаны совпадать между собой по статусу и значению.
  const tsCode = tsStatus === 0 ? null : (preparedStatusToCode(tsStatus) as KineticsErrorCode);
  const tsOk = tsStatus === 0;
  if (prepared.ok) {
    expect(tsOk).toBe(true);
    expectRelClose(tsValue, prepared.value);
  } else {
    expect(tsOk).toBe(false);
    expect(tsCode).toBe(prepared.code);
  }
  // ... и совпадать с нативом.
  expect(prepared.ok).toBe(native.ok);
  if (!native.ok || !prepared.ok) {
    if (!native.ok && !prepared.ok) {
      expect(prepared.code).toBe(native.code);
    }
    return;
  }
  expectRelClose(prepared.value, native.evaluation.value);
  if (native.evaluation.fallOff !== undefined || prepared.fallOff !== undefined) {
    expect(prepared.fallOff).toBeDefined();
    expect(native.evaluation.fallOff).toBeDefined();
    expectRelClose(prepared.fallOff!.lowPressureLimit, native.evaluation.fallOff!.lowPressureLimit);
    expectRelClose(prepared.fallOff!.highPressureLimit, native.evaluation.fallOff!.highPressureLimit);
    expectRelClose(prepared.fallOff!.reducedPressure, native.evaluation.fallOff!.reducedPressure);
    expectRelClose(
      prepared.fallOff!.log10ReducedPressure,
      native.evaluation.fallOff!.log10ReducedPressure,
      1e-9
    );
    expectRelClose(prepared.fallOff!.broadeningFactor, native.evaluation.fallOff!.broadeningFactor);
  } else {
    expect(prepared.fallOff).toBeUndefined();
  }
}

/**
 * Полная сверка одной записи на одном тике: натив (через публичный
 * API с PhysicalQuantity и options) против сессии и prepared TS
 * (через T в K и [M] NaN-конвенции).
 */
function checkTripleTick(
  triple: TripleSession,
  record: KineticReactionRecord,
  temperature: PhysicalQuantity,
  m: number | undefined,
  temperatureK: number
): void {
  const options: RateConstantEvaluationOptions | undefined =
    m === undefined ? undefined : { thirdBodyConcentration: m };
  const native = nativeOutcome(record, temperature, options);
  const third = new Float64Array(1);
  third[0] = m === undefined ? Number.NaN : m;
  const temps = new Float64Array([temperatureK]);
  triple.session.tick(temps, third);
  triple.ts.tick(temps, third);
  expectOutcomeEquivalence(
    native,
    triple.session.outcomes()[0],
    triple.ts.outStatus[0],
    triple.ts.outK[0]
  );
}

// --------------------------------------------
// Парити prepared-сессии
// --------------------------------------------

maybe('RustPreparedKineticsSession: парити с нативом и prepared TS', () => {
  it('обе формы Аррениуса (E/R и Ea)', () => {
    const records = [
      withArrhenius(arrhenius(2.5e-12, 0.7, 180, 'cm3_per_molecule_per_s'), 'a-over-r'),
      withArrhenius(arrheniusEa(1.8e-11, -0.2, 15_000, 'cm3_per_molecule_per_s'), 'ea')
    ];
    const triple = openTriple(records);
    try {
      for (const [record, t] of [
        [records[0], quantity(450, 'K')],
        [records[1], quantity(950, 'K')]
      ] as Array<[KineticReactionRecord, PhysicalQuantity]>) {
        checkTripleTick(triple, record, t, undefined, t.value);
      }
    } finally {
      triple.dispose();
    }
  });

  it('fall-off: значение и полная диагностика', () => {
    const record = fallOffReaction();
    const triple = openTriple([record]);
    try {
      checkTripleTick(triple, record, quantity(300, 'K'), 5e19, 300);
      checkTripleTick(triple, record, quantity(800, 'K'), 1e17, 800);
      checkTripleTick(triple, record, quantity(1500, 'K'), 1e22, 1500);
    } finally {
      triple.dispose();
    }
  });

  it('температурные границы: включительно и вне диапазона', () => {
    const record = arrheniusReaction();
    const triple = openTriple([record]);
    try {
      checkTripleTick(triple, record, quantity(200, 'K'), undefined, 200);
      checkTripleTick(triple, record, quantity(2000, 'K'), undefined, 2000);
      checkTripleTick(triple, record, quantity(199.9999999, 'K'), undefined, 199.9999999);
      checkTripleTick(triple, record, quantity(2000.0000001, 'K'), undefined, 2000.0000001);
    } finally {
      triple.dispose();
    }
  });

  it('numerical_failure: переполнение и исчезновение порядка', () => {
    const overflow = arrheniusReaction({
      preExponentialA: 1e308,
      temperatureExponentN: 2
    });
    const underflow = arrheniusReaction({ energy: { form: 'E_over_R', valueK: 300000 } });
    const triple = openTriple([overflow, underflow]);
    try {
      checkTripleTick(triple, overflow, quantity(600, 'K'), undefined, 600);
      checkTripleTick(triple, underflow, quantity(300, 'K'), undefined, 300);
    } finally {
      triple.dispose();
    }
  });

  it('invalid_third_body: отсутствие и некорректный [M]', () => {
    const record = fallOffReaction();
    const triple = openTriple([record]);
    try {
      checkTripleTick(triple, record, quantity(300, 'K'), undefined, 300);
      checkTripleTick(triple, record, quantity(300, 'K'), 0, 300);
      checkTripleTick(triple, record, quantity(300, 'K'), -1e19, 300);
      checkTripleTick(triple, record, quantity(300, 'K'), Number.POSITIVE_INFINITY, 300);
      checkTripleTick(triple, record, quantity(300, 'K'), Number.NaN, 300);
    } finally {
      triple.dispose();
    }
  });

  it('arrhenius + переданный [M] → invalid_input (реплика TS-правила)', () => {
    const record = arrheniusReaction();
    const triple = openTriple([record]);
    try {
      // Натив: аррениусовская запись не принимает thirdBodyConcentration.
      checkTripleTick(triple, record, quantity(300, 'K'), 1e19, 300);
      // Конвенция: сессия получает конечный маркер 0 для arrhenius-слота.
      const third = new Float64Array(1);
      triple.session.fillThirdBodyConvention(third, [1e19]);
      expect(third[0]).toBe(0);
    } finally {
      triple.dispose();
    }
  });

  it('некорректная температура → invalid_input', () => {
    const record = arrheniusReaction();
    const triple = openTriple([record]);
    try {
      // quantity() отвергает NaN (assertFinite), поэтому NaN передаём
      // литералом: натив для не-конечной T даёт invalid_input (тот же
      // контракт, что и у сессии/реплики).
      const nanK: PhysicalQuantity = { value: Number.NaN, unit: 'K' };
      checkTripleTick(triple, record, quantity(0, 'K'), undefined, 0);
      checkTripleTick(triple, record, quantity(-50, 'K'), undefined, -50);
      checkTripleTick(triple, record, nanK, undefined, Number.NaN);
    } finally {
      triple.dispose();
    }
  });

  it('экстремальные значения', () => {
    const tiny = arrheniusReaction({ preExponentialA: 1e-300 });
    const huge = arrheniusReaction({ preExponentialA: 1e308, temperatureExponentN: 0 });
    const triple = openTriple([tiny, huge]);
    try {
      checkTripleTick(triple, tiny, quantity(300, 'K'), undefined, 300);
      checkTripleTick(triple, huge, quantity(300, 'K'), undefined, 300);
    } finally {
      triple.dispose();
    }
  });

  it('повторные тики детерминированы', () => {
    const record = fallOffReaction();
    const triple = openTriple([record]);
    try {
      const third = new Float64Array([5e19]);
      const temps = new Float64Array([450]);
      triple.session.tick(temps, third);
      const k1 = triple.session.outK[0];
      const diag1 = triple.session.outDiag.slice();
      triple.session.tick(temps, third);
      expect(triple.session.outK[0]).toBe(k1);
      expect(Array.from(triple.session.outDiag)).toEqual(Array.from(diag1));
      triple.ts.tick(temps, third);
      expectRelClose(triple.ts.outK[0], k1);
    } finally {
      triple.dispose();
    }
  });

  it('изменение T и [M] между тиками', () => {
    const arr = arrheniusReaction({ temperatureExponentN: 1 });
    const falloff = fallOffReaction();
    const triple = openTriple([arr, falloff]);
    try {
      // Тик 1: T=300, M=5e19.
      let temps = new Float64Array([300, 300]);
      let third = new Float64Array([Number.NaN, 5e19]);
      triple.session.tick(temps, third);
      triple.ts.tick(temps, third);
      expectOutcomeEquivalence(
        nativeOutcome(arr, quantity(300, 'K')),
        triple.session.outcomes()[0],
        triple.ts.outStatus[0],
        triple.ts.outK[0]
      );
      // Тик 2: T=900, M=1e22 — те же сессии, новые значения.
      temps = new Float64Array([900, 900]);
      third = new Float64Array([Number.NaN, 1e22]);
      triple.session.tick(temps, third);
      triple.ts.tick(temps, third);
      expectOutcomeEquivalence(
        nativeOutcome(falloff, quantity(900, 'K'), { thirdBodyConcentration: 1e22 }),
        triple.session.outcomes()[1],
        triple.ts.outStatus[1],
        triple.ts.outK[1]
      );
      // Первый слот тоже пересчитан (arrhenius n=1: k(900)=3e-11).
      expectOutcomeEquivalence(
        nativeOutcome(arr, quantity(900, 'K')),
        triple.session.outcomes()[0],
        triple.ts.outStatus[0],
        triple.ts.outK[0]
      );
    } finally {
      triple.dispose();
    }
  });

  it('смешанный workload: полная тройная эквивалентность', () => {
    const records: KineticReactionRecord[] = [];
    for (let i = 0; i < 24; i++) {
      if (i % 3 === 0) {
        records.push(arrheniusReaction({ preExponentialA: 10 ** (-13 + i % 5), temperatureExponentN: (i % 4) - 1 }));
      } else if (i % 3 === 1) {
        records.push(withArrhenius(arrheniusEa(10 ** (-12 + i % 4), 0.5 * (i % 3), 20000 * (i + 1), 'cm3_per_molecule_per_s'), `ea-${i}`));
      } else {
        records.push(fallOffReaction(fallOffParameters({
          lowPressureLimit: arrhenius(10 ** (-33 + i % 5), 0, 0, 'cm6_per_molecule2_per_s'),
          highPressureLimit: arrhenius(10 ** (-11 + i % 4), 0, 500, 'cm3_per_molecule_per_s'),
          centeringFactorFc: 0.3 + 0.4 * ((i % 7) / 7),
          broadeningN: 0.6 + 0.5 * ((i % 5) / 5)
        })));
      }
    }
    const triple = openTriple(records);
    try {
      const n = records.length;
      const temps = new Float64Array(n);
      const third = new Float64Array(n);
      const ms: Array<number | undefined> = [];
      for (let i = 0; i < n; i++) {
        temps[i] = 250 + 1400 * ((i * 37) % n) / n;
        ms.push(records[i].rateConstant.status === 'unknown' ? undefined : (i % 2 === 0 ? 10 ** (16 + (i % 6)) : undefined));
        third[i] = ms[i] === undefined ? Number.NaN : (ms[i] as number);
      }
      triple.session.tick(temps, third);
      triple.ts.tick(temps, third);
      const sessionOutcomes = triple.session.outcomes();
      for (let i = 0; i < n; i++) {
        const record = records[i];
        const m = ms[i];
        const options = m === undefined ? undefined : { thirdBodyConcentration: m };
        expectOutcomeEquivalence(
          nativeOutcome(record, quantity(temps[i], 'K'), options),
          sessionOutcomes[i],
          triple.ts.outStatus[i],
          triple.ts.outK[i]
        );
      }
    } finally {
      triple.dispose();
    }
  });

  it('lifecycle: prepare/tick/dispose, лимит сессий, fail-closed подготовка', () => {
    const record = arrheniusReaction();
    expect(RustPreparedKineticsSession.activeSessionCount()).toBe(0);

    // prepare → tick → dispose: счётчик и поведение после dispose.
    const s1 = RustPreparedKineticsSession.prepare(core, [record]);
    expect(RustPreparedKineticsSession.activeSessionCount()).toBe(1);
    expect(s1.memoryBytes()).toBeGreaterThan(0);
    const temps = new Float64Array([300]);
    const third = new Float64Array([Number.NaN]);
    s1.tick(temps, third);
    expect(s1.outStatus[0]).toBe(0);
    s1.dispose();
    expect(s1.disposed).toBe(true);
    expect(RustPreparedKineticsSession.activeSessionCount()).toBe(0);
    expect(() => s1.tick(temps, third)).toThrow();
    expect(() => s1.memoryBytes()).toThrow();
    s1.dispose(); // идемпотентно

    // fillThirdBodyConvention: NaN-конвенция и маркер arrhenius+[M].
    const s2 = RustPreparedKineticsSession.prepare(core, [record, fallOffReaction()]);
    expect(RustPreparedKineticsSession.activeSessionCount()).toBe(1);
    const third2 = new Float64Array(2);
    s2.fillThirdBodyConvention(third2, [undefined, 5e19]);
    expect(Number.isNaN(third2[0])).toBe(true);
    expect(third2[1]).toBe(5e19);
    s2.fillThirdBodyConvention(third2, [1e19, undefined]);
    expect(third2[0]).toBe(0); // конечный маркер → invalid_input в ядре
    expect(Number.isNaN(third2[1])).toBe(true);
    s2.dispose();

    // Лимит активных сессий: накопление до лимита → отказ; после
    // освобождения — prepare снова возможен.
    const pool: RustPreparedKineticsSession[] = [];
    for (let i = 0; i < MAX_ACTIVE_SESSIONS; i++) {
      pool.push(RustPreparedKineticsSession.prepare(core, [record]));
    }
    expect(RustPreparedKineticsSession.activeSessionCount()).toBe(MAX_ACTIVE_SESSIONS);
    expect(() => RustPreparedKineticsSession.prepare(core, [record])).toThrow(/лимит/);
    for (const s of pool) {
      s.dispose();
    }
    expect(RustPreparedKineticsSession.activeSessionCount()).toBe(0);
    const s3 = RustPreparedKineticsSession.prepare(core, [record]);
    s3.dispose();

    // Fail-closed подготовка: невалидная запись и unknown-константа.
    expect(() => RustPreparedKineticsSession.prepare(core, [
      arrheniusReaction({ temperatureRangeK: { min: 2000, max: 200 } })
    ])).toThrow();
    expect(() => RustPreparedKineticsSession.prepare(core, [
      {
        id: 'unknown-rxn',
        kind: 'elementary',
        overallOrder: 2,
        concentrationModel: 'molecule_cm3',
        rateConstant: { status: 'unknown', note: 'нет данных (фикция)' },
        provenance: fixtureProvenance()
      }
    ])).toThrow(/no_kinetic_data/);
    expect(RustPreparedKineticsSession.activeSessionCount()).toBe(0);
  });
});
