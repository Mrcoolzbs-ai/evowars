# Stage I — Persistent Rust/WASM Kinetics Session

Продолжение пилота [RUST_WASM_PILOT.md](RUST_WASM_PILOT.md) (Stage H, immutable
baseline). Stage H показал: числовое ядро Rust/WASM быстро (kernel-only
6–31× против TS), но полный цикл «упаковка + вызов + распаковка» на каждом
вызове медленнее исходного TS-API (e2e 0.48–1.05×). Stage I проверяет другую
архитектуру: параметры реакций загружаются в память WASM один раз, тик
передаёт только T и [M].

## Что добавлено

| Слой | Файл | Назначение |
|---|---|---|
| Rust-ядро | `rust/evowars-sim-core/src/kinetics_session.rs` | класс `KineticsPrepared`: хранит 17-слотовые параметры (без T/M) в WASM-памяти; `tick(temps, third, outK, outDiag, outStatus)` — пакетный расчёт k(T); `memory_bytes()`, `free()`; 14 unit-тестов |
| TS-адаптер | `src/modules/RustSim/rustKineticsSession.ts` | `RustPreparedKineticsSession.prepare/tick/dispose`, fail-closed валидация при подготовке (только known/estimated), лимит 64 активных сессий, FinalizationRegistry-страховка от утечек |
| Prepared TS | `src/modules/RustSim/preparedKineticsReplica.ts` | числовая реплика для честного сравнения: подготовка один раз, тик по плоским массивам, без пообъектных представлений в горячем цикле |
| Parity | `src/modules/Tests/rustPreparedKineticsParity.test.ts` | тройная сверка (публичный TS-API vs сессия vs реплика): обе формы Аррениуса, fall-off, границы, numerical_failure, invalid_third_body, arrhenius+[M], экстремумы, повторные тики, смена T/M, lifecycle |
| Node-benchmark | `scripts/benchmarks/prepared-kinetics.bench.ts` | 3 архитектуры на нагрузках 1e3–1e6: prep-стоимость, тик, totals по 1/10/100/1000 тиков, break-even, память; parity-гейт перед измерениями |
| Браузерный benchmark | `rust/bench-web/stage-i.{html,worker.js,shared.js}` | Chromium: Worker (init, prep, холодный/тёплый тик, transfer clone vs zero-copy, память), heartbeat-зонд главного потока + блокирующий контраст |
| Драйвер | `scripts/bench-browser/run-stage-i-browser.mjs` | headless Chrome через CDP без puppeteer; артефакты в `benchmark-artifacts/` |
| CI | `.github/workflows/rust-wasm-pilot.yml` | доп. шаги: `benchmark:prepared`, `benchmark:browser`, notices, расширенный Step Summary и артефакты |

## Архитектура сессии

- **Подготовка (один раз)**: TypeScript валидирует каждую
  `KineticReactionRecord` (`validateKineticReactionRecord`), проверяет
  provenance/единицы/статусы/диапазоны/fall-off. Неизменные A, n, E/R или Ea,
  Fc, N, kind передаются в Rust одним `Float64Array` (stride 17; слоты T/M не
  используются). Fail-closed: невалидная или unknown-запись — исключение,
  сессия не создаётся.
- **Тик (многократно)**: передаются только `temperaturesK` и `thirdBody`
  (NaN = «[M] не передан»; arrhenius + конечный [M] → `invalid_input` —
  реплика TS-правила; fall_off с NaN/≤0/∞ [M] → `invalid_third_body`).
  Выходы — плоские переиспользуемые буферы: `outK`, `outDiag` (5n),
  `outStatus`.
- **Завершение**: `dispose()` (идемпотентен) освобождает WASM-память;
  лимит 64 активных сессий; FinalizationRegistry — страховка от
  undisposed-сессий. Никаких неограниченных накоплений WASM-объектов.

## Протокол измерений

Нагрузки: 1 000 / 10 000 / 100 000 / 1 000 000 реакций (детерминированный
mulberry32, seed `0x12345678`, то же распределение, что в Stage H).
Повторные тики: totals для 1/10/100/1000 тиков. 3 прогрева, 12 выборок,
выборка ≥ 40 мс (адаптивный цикл, макс. 1000 итераций). Статистика:
median/p95 одного прогона, ops/s = 1000/median(ms).

Сравниваются три архитектуры:

1. `tsNative` — исходный публичный TS-API (контекст Stage H);
2. `preparedTS` — валидация/подготовка один раз, тик по плоским массивам
   (реплика формул `evaluateRateConstant`);
3. `wasmSession` — Rust/WASM-сессия, подготовка один раз.

Главный критерий — (2) против (3): обе архитектуры без стоимости упаковки в
горячем цикле. Дополнительно: стоимость подготовки (`prepTs`, `prepSession`),
break-even по числу тиков, память (точный `memory_bytes()` сессии + дельта
RSS), перенос данных в браузере (structured clone vs transfer).

Публикация чисел запрещена при нарушении parity: benchmark завершается
ошибкой, а не выдаёт несогласованные измерения.

## Запуск

```bash
npm run wasm:build            # pkg-node + pkg-web
npm run test                   # parity-сьюты (WASM-путь самопропускается без pkg-node)
npm run benchmark:prepared     # Node: 3 архитектуры, артефакты benchmark-artifacts/
npm run benchmark:browser      # Chromium headless: Worker + heartbeat + transfer
```

CI (`rust-wasm-pilot`) выполняет всё автоматически: cargo test → release →
wasm → tsc/lint/vitest → build → Stage H benchmark → Stage I Node benchmark →
Stage I browser benchmark → notices/summary/artifacts.

## Критерии GO/NO-GO

Для продолжения массового Rust/WASM-переноса в браузер требуется:

- parity всех сценариев сессии (vitest-сьют зелёный);
- реальный браузерный end-to-end benchmark (Chromium, Worker), не
  экстраполяция Node;
- **≥ 1.5× prepared Rust/WASM против prepared TS на нагрузках 100 000 и
  1 000 000 в браузере**;
- нет существенного проигрыша на малых нагрузках;
- память и lifecycle контролируемы (лимит сессий, dispose, memory_bytes);
- Worker не блокирует UI (heartbeat-зонд: зазоры главного потока в фазах
  Worker против блокирующего контраста).

При недостижении критериев — NO-GO для массового переноса: горячие функции
остаются в TS, альтернативы — native Rust для desktop/server или другая
модель хранения данных.

## Границы этапа

Stage H-реализации (`kinetics.rs`, `reaction_audit.rs`, Stage H benchmark,
`RUST_WASM_PILOT.md`) не изменяются. Не переносятся: PR solver,
certifiedLogarithm, TPD, NASA CEA, Radau IIA, EOS/BIP, reactionLedger, ODE
solver. App.tsx не интегрируется с новым путём: это отдельный performance
pilot. main не затрагивается, PR #1 не мержится.
