// ============================================
// RUST KINETICS SESSION — TS-адаптер prepared-сессии k(T)
// Stage I (Persistent Rust/WASM Kinetics Session)
// ============================================
//
// Мотивация (Stage H): полный цикл «упаковка + вызов + распаковка»
// оказался медленнее исходного TS-API, потому что 17 параметров на
// реакцию пересылались при КАЖДОМ вызове. Сессия меняет архитектуру:
// - ПОДГОТОВКА (один раз): TypeScript валидирует KineticReactionRecord
//   (validateKineticReactionRecord), проверяет provenance, единицы,
//   статусы, диапазоны и fall-off параметры — всё, что проверяет
//   нативный evaluateRateConstant ДО числового ядра; неизменные
//   A, n, E/R|Ea, диапазоны, Fc, N, kind передаются в Rust ОДИН раз
//   (17-слотовая раскладка; слоты T/M не используются);
// - ТИК (многократно): только T (K) и [M] каждой реакции —
//   Rust выполняет пакетный расчёт и пишет плоские массивы
//   k/диагностика/статус в переиспользуемые буферы;
// - ОСВОБОЖДЕНИЕ: dispose() (явный lifecycle; страховка
//   FinalizationRegistry при утечке ссылки, лимит активных сессий
//   против неограниченного накопления WASM-объектов/памяти).
//
// Семантика тика зеркалит нативный evaluateRateConstant:
// - fail-closed: невалидная запись или unknown-константа
//   отвергаются ещё на подготовке (сессия принимает только
//   заведомо валидные known/estimated записи);
// - [M]-конвенция тика: NaN в thirdBody = «не передан»;
//   для arrhenius-реакции переданный [M] → invalid_input
//   (маркер 0.0, реплика TS-правила независимости от давления),
//   для fall_off — отсутствие/некорректность [M] → invalid_third_body;
// - остальные коды/порядок проверок — как в ядре kinetics.rs.
//
// Это performance pilot: путь НЕ интегрируется в App.tsx и не
// подменяет публичный TS API. Существующие Stage H адаптеры
// (rustKinetics.ts) не изменяются.

import type {
  FallOffDiagnostics,
  KineticReactionRecord,
  KineticsErrorCode
} from '../Core/kinetics';
import { validateKineticReactionRecord } from '../Core/kinetics';
import type { RustSimCoreWasm } from './rustSimCore';
import { KIN_DIAG_STRIDE, KIN_STRIDE } from './rustKinetics';

/** wasm-bindgen класс KineticsPrepared (glue pkg-node / pkg-web). */
export interface KineticsPreparedWasm {
  /** Один тик: T и M всех реакций → k/диагностика/статусы. */
  tick(
    temperatures: Float64Array,
    thirdBody: Float64Array,
    outK: Float64Array,
    outDiag: Float64Array,
    outStatus: Int32Array
  ): number;
  n_reactions(): number;
  /** Объём памяти параметров сессии (байты, оценка Rust-стороны). */
  memory_bytes(): number;
  /** Освобождение WASM-памяти (glue wasm-bindgen). */
  free(): void;
}

/** core + экспортированный класс сессии. */
type CoreWithPrepared = RustSimCoreWasm & {
  KineticsPrepared: new (params: Float64Array) => KineticsPreparedWasm;
};

/** Лимит одновременных сессий: защита от неограниченного накопления WASM-объектов. */
export const MAX_ACTIVE_SESSIONS = 64;

/** Приватный токен для FinalizationRegistry (НЕ держит ссылку на сессию). */
interface SessionToken {
  prepared: KineticsPreparedWasm;
}

/** Страховка от утечки undisposed-сессии: GC освобождает WASM-память. */
const sessionRegistry: FinalizationRegistry<SessionToken> | null =
  typeof FinalizationRegistry === 'function' ? new FinalizationRegistry<SessionToken>((token) => {
    try {
      token.prepared.free();
    } catch {
      // free() мог уже быть вызван явно: двойное освобождение
      // обработано в dispose(), здесь безопасно игнорировать.
    }
    activeSessionCount = Math.max(0, activeSessionCount - 1);
  }) : null;

let activeSessionCount = 0;

/** Исход одной реакции тика: значение k (+ fall-off диагностика) или код отказа. */
export type PreparedKineticsOutcome =
  | { ok: true; value: number; fallOff?: FallOffDiagnostics }
  | { ok: false; code: KineticsErrorCode };

/** Статус Rust → код ошибки кинетики (та же карта, что в rustKinetics.ts). */
const STATUS_TO_CODE: Record<number, KineticsErrorCode> = {
  1: 'temperature_out_of_range',
  2: 'invalid_third_body',
  3: 'numerical_failure',
  4: 'invalid_input'
};

/**
 * Упаковка подготовки: полная TS-валидация КАЖДОЙ записи (один раз),
 * затем 17-слотовые параметры без T/M (слоты [1]/[2] = 0; T и M
 * приходят аргументами тика). kindMask: 0 = arrhenius,
 * 1 = fall_off (для [M]-конвенции тика).
 *
 * Fail-closed: любая невалидная запись или unknown-константа —
 * исключение с индексом и списком проблем; сессия не создаётся.
 */
export function packPreparedKineticsParams(
  records: readonly KineticReactionRecord[]
): { params: Float64Array; kindMask: Int32Array } {
  const n = records.length;
  const params = new Float64Array(n * KIN_STRIDE);
  const kindMask = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const record = records[i];
    const problems = validateKineticReactionRecord(record);
    if (problems.length > 0) {
      throw new Error(
        `PreparedKinetics: запись ${i} невалидна (подготовка невозможна): ${problems.join('; ')}`
      );
    }
    const rate = record.rateConstant;
    if (rate.status === 'unknown') {
      throw new Error(
        `PreparedKinetics: запись ${i} (${record.id}) — no_kinetic_data: сессия принимает только known/estimated константы`
      );
    }
    const base = i * KIN_STRIDE;
    // Слоты [1] (T) и [2] (M) остаются 0: значения приходят на каждом тике.
    if (rate.parameters.kind === 'arrhenius') {
      kindMask[i] = 0;
      params[base + 0] = 0; // kind: arrhenius
      const p = rate.parameters.arrhenius;
      params[base + 3] = p.preExponentialA;
      params[base + 4] = p.temperatureExponentN;
      params[base + 5] = p.energy.form === 'E_over_R' ? 0 : 1;
      params[base + 6] = p.energy.form === 'E_over_R' ? p.energy.valueK : p.energy.valueJPerMol;
      params[base + 7] = p.temperatureRangeK.min;
      params[base + 8] = p.temperatureRangeK.max;
      continue;
    }
    kindMask[i] = 1;
    params[base + 0] = 1; // kind: fall_off
    const fp = rate.parameters.fallOff;
    const lo = fp.lowPressureLimit;
    const hi = fp.highPressureLimit;
    params[base + 3] = lo.preExponentialA;
    params[base + 4] = lo.temperatureExponentN;
    params[base + 5] = lo.energy.form === 'E_over_R' ? 0 : 1;
    params[base + 6] = lo.energy.form === 'E_over_R' ? lo.energy.valueK : lo.energy.valueJPerMol;
    params[base + 7] = lo.temperatureRangeK.min;
    params[base + 8] = lo.temperatureRangeK.max;
    params[base + 9] = hi.preExponentialA;
    params[base + 10] = hi.temperatureExponentN;
    params[base + 11] = hi.energy.form === 'E_over_R' ? 0 : 1;
    params[base + 12] = hi.energy.form === 'E_over_R' ? hi.energy.valueK : hi.energy.valueJPerMol;
    params[base + 13] = hi.temperatureRangeK.min;
    params[base + 14] = hi.temperatureRangeK.max;
    params[base + 15] = fp.centeringFactorFc;
    params[base + 16] = fp.broadeningN;
  }
  return { params, kindMask };
}

/**
 * Prepared-сессия кинетики. Горячий путь — tick(): два плоских
 * Float64Array на вход, переиспользуемые буферы на выходе, ноль
 * пообъектных представлений на реакцию. outcomes() материализует
 * исходы для parity/проверок и НЕ предназначен для горячего цикла.
 */
export class RustPreparedKineticsSession {
  private readonly prepared: KineticsPreparedWasm;
  private readonly kindMask: Int32Array;
  private readonly token: SessionToken;
  private _disposed = false;

  /** Число реакций сессии. */
  readonly n: number;
  /** Переиспользуемые выходные буферы тика (читаются после tick()). */
  readonly outK: Float64Array;
  readonly outDiag: Float64Array;
  readonly outStatus: Int32Array;

  private constructor(prepared: KineticsPreparedWasm, n: number, kindMask: Int32Array) {
    this.prepared = prepared;
    this.n = n;
    this.kindMask = kindMask;
    this.outK = new Float64Array(n);
    this.outDiag = new Float64Array(n * KIN_DIAG_STRIDE);
    this.outStatus = new Int32Array(n);
    this.token = { prepared };
  }

  /**
   * Подготовка сессии: валидация и передача параметров — один раз.
   * Бросает при невалидных записях, отсутствии класса в WASM-модуле
   * или превышении лимита активных сессий.
   */
  static prepare(
    core: RustSimCoreWasm,
    records: readonly KineticReactionRecord[]
  ): RustPreparedKineticsSession {
    const glue = core as CoreWithPrepared;
    if (typeof glue.KineticsPrepared !== 'function') {
      throw new Error(
        'PreparedKinetics: WASM-модуль не экспортирует класс KineticsPrepared (пересоберите pkg-node/pkg-web: npm run wasm:build)'
      );
    }
    if (activeSessionCount >= MAX_ACTIVE_SESSIONS) {
      throw new Error(
        `PreparedKinetics: превышен лимит активных сессий (${MAX_ACTIVE_SESSIONS}); освободите существующие через dispose()`
      );
    }
    const { params, kindMask } = packPreparedKineticsParams(records);
    const prepared = new glue.KineticsPrepared(params);
    activeSessionCount++;
    const session = new RustPreparedKineticsSession(prepared, records.length, kindMask);
    if (sessionRegistry !== null) {
      sessionRegistry.register(session, session.token, session.token);
    }
    return session;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  /** Число активных (не освобождённых) сессий в процессе. */
  static activeSessionCount(): number {
    return activeSessionCount;
  }

  /**
   * Один тик: T (K) и [M] всех реакций (NaN-конвенция, см.
   * fillThirdBodyConvention). Пишет в outK/outDiag/outStatus.
   */
  tick(temperaturesK: Float64Array, thirdBody: Float64Array): void {
    if (this._disposed) {
      throw new Error('PreparedKinetics: сессия уже освобождена (dispose())');
    }
    if (temperaturesK.length !== this.n || thirdBody.length !== this.n) {
      throw new Error(
        `PreparedKinetics: длины тика (${temperaturesK.length}/${thirdBody.length}) должны быть ${this.n}`
      );
    }
    const rc = this.prepared.tick(temperaturesK, thirdBody, this.outK, this.outDiag, this.outStatus);
    if (rc !== 0) {
      throw new Error(`PreparedKinetics tick ABI error: ${rc}`);
    }
  }

  /**
   * Заполнить буфер [M] NaN-конвенцией: undefined → NaN («не передан»);
   * fall_off-слот → значение как есть; arrhenius-слот с переданным
   * значением → конечный маркер 0.0 (ядро ответит invalid_input,
   * реплицируя TS-правило независимости от давления).
   */
  fillThirdBodyConvention(
    dest: Float64Array,
    values: ReadonlyArray<number | undefined>
  ): void {
    if (dest.length !== this.n || values.length !== this.n) {
      throw new Error(`PreparedKinetics: длины буфера [M] должны быть ${this.n}`);
    }
    for (let i = 0; i < this.n; i++) {
      const v = values[i];
      dest[i] = v === undefined ? Number.NaN : this.kindMask[i] === 0 ? 0 : v;
    }
  }

  /** Исходы последнего тика (для parity/проверок; не горячий путь). */
  outcomes(): PreparedKineticsOutcome[] {
    const result: PreparedKineticsOutcome[] = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const status = this.outStatus[i];
      if (status !== 0) {
        const code = STATUS_TO_CODE[status];
        if (code === undefined) {
          throw new Error(`PreparedKinetics: неизвестный статус ${status} (реакция ${i})`);
        }
        result[i] = { ok: false, code };
        continue;
      }
      if (this.kindMask[i] === 1) {
        const d = i * KIN_DIAG_STRIDE;
        result[i] = {
          ok: true,
          value: this.outK[i],
          fallOff: {
            lowPressureLimit: this.outDiag[d],
            highPressureLimit: this.outDiag[d + 1],
            reducedPressure: this.outDiag[d + 2],
            log10ReducedPressure: this.outDiag[d + 3],
            broadeningFactor: this.outDiag[d + 4]
          }
        };
        continue;
      }
      result[i] = { ok: true, value: this.outK[i] };
    }
    return result;
  }

  /** Объём памяти параметров сессии (байты, оценка Rust-стороны). */
  memoryBytes(): number {
    if (this._disposed) {
      throw new Error('PreparedKinetics: сессия уже освобождена (dispose())');
    }
    return this.prepared.memory_bytes();
  }

  /** Явное освобождение WASM-памяти. Идемпотентно. */
  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._disposed = true;
    if (sessionRegistry !== null) {
      sessionRegistry.unregister(this.token);
    }
    activeSessionCount = Math.max(0, activeSessionCount - 1);
    this.prepared.free();
  }
}
