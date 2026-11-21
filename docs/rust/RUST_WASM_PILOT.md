# Rust/WASM Performance Pilot (Stage H)

Ограниченный пилот: два числовых ядра перенесены на Rust, математическая
эквивалентность проверена parity-тестами, производительность измерена
честным benchmark. Это НЕ переключение игры на Rust: все существующие
публичные TypeScript API остаются рабочими и дефолтными.

## Что перенесено

| Ядро | Rust | TypeScript (остаётся) |
| --- | --- | --- |
| `Core/kinetics.ts` → `kinetics.rs` | числовое вычисление k(T): обе формы Аррениуса, fall-off Lindemann + Troe (k0, k∞, Pr, log10 Pr, F, итог k), порядок числовых проверок | валидация записей, статусы known/estimated/unknown, температура в K, правила [M], единицы, provenance, uncertainty, appliedRangeK, сборка `RateConstantEvaluation`, коды ошибок |
| `Core/reactionLedger.ts` → `reaction_audit.rs` | суммирование коэффициентов, элементные вклады по сторонам, заряд, детекция переполнения/неконечных значений, разности с tolerance | `validateReactionRecord`, каталог, proven composition, статусы, missing/unproven/estimated, диагностика, итоговая классификация |

Rust не может считать неизвестный состав нулевым, превращать
not_verifiable в balanced или скрывать переполнение: числовые предпосылки
проверяются, при отказе возвращаются явные коды, а не фиктивные результаты.

## Структура

```
rust/evowars-sim-core/
  Cargo.toml, Cargo.lock        # rlib + cdylib; wasm-bindgen =0.2.95
  src/lib.rs                    # ABI-обёртки (batch API)
  src/kinetics.rs               # числовое ядро k(T) + нативные тесты
  src/reaction_audit.rs         # числовое ядро аудита + нативные тесты
  src/bin/evowars_bench.rs      # native benchmark-бинарник
rust/bench-web/index.html       # ручная браузерная bench-страница (pkg-web)
src/modules/RustSim/            # TS-адаптер: загрузка WASM, упаковка, batch API
scripts/wasm/build-wasm.mjs     # сборка pkg-node + pkg-web
scripts/benchmarks/              # workload-генераторы + benchmark-раннер
benchmark-artifacts/             # результаты (не коммитятся)
```

## ABI

Пакетный интерфейс на плоских typed arrays (без JSON, без по-объектных
вызовов): `Float64Array` для чисел, `Int32Array`/`Uint32Array` для
статусов и CSR-индексов. Один вызов WASM на пакет операций.

- `evowars_kinetics_batch(params, outK, outDiag, outStatus)` — 17 слотов
  f64 на операцию; статусы 0/1/2/3/4 зеркалят коды kinetics
  (ok, temperature_out_of_range, invalid_third_body, numerical_failure,
  invalid_input); `outDiag` — 5 значений fall-off диагностики.
- `evowars_stoichiometry_batch(...19 аргументов)` — CSR-таблицы видов и
  участников, стабильные числовые индексы элементов (JS-объекты не
  передаются, проблемные ключи вида `__proto__` невозможны по построению);
  выходы: флаги, заряды, union-таблицы элементов с разностями.

Точные раскладки и коды отказа ABI задокументированы в заголовках
`rustKinetics.ts` / `rustReactionAudit.ts`.

## Сборка и запуск

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.95 --locked
npm run wasm:build       # pkg-node (Node/vitest) + pkg-web (браузер)
cargo test --locked      # нативные Rust-тесты
npm run benchmark:rust    # сравнительный benchmark + артефакты
```

Результаты benchmark: `benchmark-artifacts/rust-wasm-pilot-report.json`
(машинно-читаемый) и `rust-wasm-pilot-summary.md`. CI публикует их
артефактами workflow `rust-wasm-pilot`.

## Протокол benchmark

Один и тот же детерминированный workload (mulberry32, одинаковые формулы
в TS и Rust) для всех путей; нагрузки 1000/10 000/100 000/1 000 000
(крупная — при допустимой памяти); 3 прогрева, 12 выборок по >= 40 мс,
median/p95, ops/s. Измеряются:

- `tsNative` — исходные публичные TS API;
- `wasmEndToEnd` — упаковка + TS пре-чеки + один вызов WASM + распаковка;
- `wasmPackOnly` — только подготовка данных (накладные расходы обмена);
- `wasmKernelOnly` — голый вызов WASM (включая копирование буферов glue);
- `nativeRust` — отдельное измерение native-сборки (НЕ браузерный WASM).

Перед замерами каждая нагрузка сверяется на эквивалентность TS/WASM:
при расхождении benchmark останавливается, а не публикует числа.
Speedup = median TS / median Rust-WASM; публикуются как есть, включая
результаты медленнее 1.

## Проверки

- Нативные Rust-тесты: `cargo test --locked`.
- Parity в vitest: `src/modules/Tests/rustWasmParity.test.ts`
  (самопропускается, если pkg-node не собран, например в основном CI);
  полный прогон с parity выполняет workflow `rust-wasm-pilot.yml`.
- Существующие тесты `coreKinetics.test.ts` / `coreReactionLedger.test.ts`
  не менялись и не ослаблялись.

## Границы пилота

Перенесены ТОЛЬКО эти два ядра. NASA CEA, Radau IIA, Peng-Robinson,
TPD-вычислители, EOS/BIP-каталоги и золотые baseline не переносились и
не менялись. Дальнейшие решения о переносе — по результатам benchmark.
