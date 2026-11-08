// ============================================
// RUST SIM CORE — загрузчик WASM-модуля Rust-ядра
// Stage H (Rust/WASM Performance Pilot)
// ============================================
//
// Роль: асинхронная ленивая инициализация WASM-сборки крейта
// rust/evowars-sim-core (glue wasm-bindgen, target nodejs) и
// типизированный batch-доступ к двум числовым ядрам:
// - evowars_kinetics_batch — k(T) (kinetics.rs);
// - evowars_stoichiometry_batch — аудит стехиометрии (reaction_audit.rs).
//
// Контракт загрузки:
// - загрузка ТОЛЬКО асинхронная: ничего не блокирует старт
//   приложения; сам модуль приложения RustSim не импортирует —
//   при недоступности WASM игра работает как раньше;
// - загрузчик вернёт null (а не бросит) при любой недоступности:
//   нет Node (браузер), не собран pkg-node, недоступен WebAssembly,
//   нераспознанная форма glue-модуля;
// - результат кэшируется: повторные вызовы loadRustSimCore()
//   возвращают один и тот же промис (singleton);
// - здесь НЕТ JSON.stringify/parse и по-объектных вызовов: данные
//   ходят через Float64Array/Int32Array/Uint32Array (см. ABI
//   в rustKinetics.ts / rustReactionAudit.ts).
//
// Ограничение пилота: этот загрузчик — Node-путь (vitest и
// benchmark). Браузерный путь (pkg-web, ESM) подключается отдельно
// страницей rust/bench-web/index.html и НЕ интегрируется в
// интерфейс игры (решение Stage H: явный путь, без автопереключения).

export interface RustSimCoreWasm {
  /** Числовое ядро k(T): один вызов на пакет операций (ABI в rustKinetics.ts). */
  evowars_kinetics_batch(
    params: Float64Array,
    outK: Float64Array,
    outDiag: Float64Array,
    outStatus: Int32Array
  ): number;
  /** Числовое ядро аудита стехиометрии: один вызов на пакет реакций (ABI в rustReactionAudit.ts). */
  evowars_stoichiometry_batch(
    speciesStatus: Int32Array,
    speciesCharge: Float64Array,
    speciesElemOffsets: Uint32Array,
    elemIndices: Uint32Array,
    elemCounts: Float64Array,
    leftOffsets: Uint32Array,
    rightOffsets: Uint32Array,
    partSpecies: Uint32Array,
    partCoeff: Float64Array,
    tolerance: number,
    outFlags: Int32Array,
    outLeftCharge: Float64Array,
    outRightCharge: Float64Array,
    outElemOffsets: Uint32Array,
    outElemIndex: Uint32Array,
    outElemLeft: Float64Array,
    outElemRight: Float64Array,
    outElemExceeds: Int32Array,
    outElemSide: Int32Array
  ): number;
}

const PKG_RELATIVE_PATH = '../../../rust/evowars-sim-core/pkg-node/evowars_sim_core.js';

let cached: Promise<RustSimCoreWasm | null> | null = null;

/**
 * Асинхронная загрузка WASM-ядра; null — WASM недоступен
 * (не собран pkg-node, браузер без Node-инфраструктуры, любой сбой).
 * Повторные вызовы возвращают кэшированный промис.
 */
export function loadRustSimCore(): Promise<RustSimCoreWasm | null> {
  if (cached === null) {
    cached = initRustSimCore();
    // Любой сбой загрузки не должен остаться необработанным
    // отклонением: контракт — null, а не исключение.
    cached.catch(() => undefined);
  }
  return cached;
}

async function initRustSimCore(): Promise<RustSimCoreWasm | null> {
  try {
    const proc = (globalThis as { process?: { versions?: { node?: unknown } } }).process;
    if (proc?.versions?.node === undefined) {
      // Браузер: Node-путь загрузки не применим.
      return null;
    }
    // НЕ-литеральный динамический импорт: строка с 'node:' не должна
    // попадать в статические импорты бандла (tsconfig.app.json без
    // @types/node для src; vite-билд не должен тянуть node-модули).
    const nodeModuleSpecifier = 'node:' + 'module';
    const nodeModule = (await import(/* @vite-ignore */ nodeModuleSpecifier)) as unknown as {
      createRequire?: (filename: string) => (id: string) => unknown;
    };
    if (typeof nodeModule?.createRequire !== 'function') {
      return null;
    }
    const require = nodeModule.createRequire(import.meta.url);
    // pkg-node собирается отдельно (npm run wasm:build): в окружении
    // без сборки require отказывает — контракт null, а не исключение.
    const glue = require(PKG_RELATIVE_PATH) as unknown;
    return await resolveGlueExports(glue);
  } catch {
    // Любая недоступность WASM (не собран pkg-node, недоступен
    // WebAssembly, нераспознанная форма glue) — null: приложение
    // работает на TypeScript-реализациях.
    return null;
  }
}

/** Кандидат содержит оба batch API. */
function hasBatchApi(candidate: unknown): candidate is RustSimCoreWasm {
  if (candidate === null || typeof candidate !== 'object' && typeof candidate !== 'function') {
    return false;
  }
  const c = candidate as Record<string, unknown>;
  return typeof c.evowars_kinetics_batch === 'function' && typeof c.evowars_stoichiometry_batch === 'function';
}

/**
 * Smoke-тест числового ядра на минимальном валидном пакете
 * (одна аррениусовская операция): подтверждает, что WASM-инстанс
 * действительно инициализирован и вызовы проходной формы (glue
 * wasm-bindgen может прикреплять экспорты до init).
 */
function smokeTestBatchApi(candidate: RustSimCoreWasm): boolean {
  try {
    const params = new Float64Array(17);
    params[0] = 0; // kind: arrhenius
    params[1] = 300; // T, K
    params[3] = 1e-10; // A
    params[4] = 0; // n
    params[5] = 0; // energyForm: E_over_R
    params[6] = 0; // energyValue
    params[7] = 200; // rangeMin
    params[8] = 2000; // rangeMax
    const outK = new Float64Array(1);
    const outDiag = new Float64Array(5);
    const outStatus = new Int32Array(1);
    const rc = candidate.evowars_kinetics_batch(params, outK, outDiag, outStatus);
    return rc === 0 && outStatus[0] === 0 && outK[0] === 1e-10;
  } catch {
    return false;
  }
}

/**
 * Форма glue-модуля wasm-bindgen зависит от версии и target:
 * nodejs-цель может экспортировать init-функцию (__wbg_init),
 * прикреплять экспорты напрямую (после/до инициализации) или
 * упаковывать их в default. Резолвер:
 * 1) вызывает найденную init-функцию (повторный вызов безопасен);
 * 2) ищет объект с batch API (сам модуль, default, результат init);
 * 3) проверяет работоспособность smoke-тестом;
 * 4) возвращает null при любой нераспознаваемой/неработающей форме.
 */
async function resolveGlueExports(glue: unknown): Promise<RustSimCoreWasm | null> {
  const candidates: unknown[] = [];

  const collectFromObject = (container: Record<string, unknown>): void => {
    const initFn =
      container.__wbg_init ??
      container.init ??
      (typeof container.default === 'function' ? container.default : undefined);
    if (typeof initFn === 'function') {
      candidates.push(initFn);
    }
    candidates.push(container);
    if (container.default !== undefined && container.default !== null) {
      candidates.push(container.default);
    }
  };

  if (typeof glue === 'function') {
    candidates.push(glue);
  } else if (glue !== null && typeof glue === 'object') {
    collectFromObject(glue as Record<string, unknown>);
  }

  // Индексированный цикл с лимитом: кандидаты могут добавляться
  // по ходу (init возвращает объект экспортов), но зацикливание
  // исключено.
  for (let index = 0; index < candidates.length && index < 12; index++) {
    const candidate = candidates[index];
    let resolved: unknown = candidate;
    if (typeof candidate === 'function') {
      try {
        const maybeExports = await (candidate as (input?: unknown) => Promise<unknown> | unknown)();
        if (maybeExports !== undefined && maybeExports !== null) {
          candidates.push(maybeExports);
        }
        // Функция-инициализатор может прикреплять экспорты к себе.
        resolved = hasBatchApi(candidate) ? candidate : maybeExports;
      } catch {
        continue;
      }
    }
    if (hasBatchApi(resolved) && smokeTestBatchApi(resolved)) {
      return resolved;
    }
  }
  return null;
}
