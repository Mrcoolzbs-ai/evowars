//! evowars-sim-core — Rust/WASM performance pilot (Stage H).
//!
//! Числовые ядра ровно двух вычислительных контрактов проекта:
//! - `kinetics` — вычислитель k(T) Stage 4.5.2 (модифицированный
//!   Аррениус + fall-off Lindemann/Troe) как числовое ядро
//!   `src/modules/Core/kinetics.ts`;
//! - `reaction_audit` — числовое ядро суммирования стехиометрии
//!   и заряда `auditReactionStoichiometry()` из
//!   `src/modules/Core/reactionLedger.ts`;
//! - `kinetics_session` (Stage I) — prepared-сессия k(T):
//!   неизменные параметры реакций хранятся в памяти WASM, тик
//!   передаёт только T и M (устранение стоимости упаковки
//!   из горячего цикла; lifecycle: prepare/tick/free).
//!
//! Границы: валидация, типизация, статусы данных, provenance,
//! диагностика и итоговая классификация остаются в TypeScript.
//! Rust получает структурно подготовленные и проверенные
//! TypeScript-ом плоские буферы (batch ABI), ДОПОЛНИТЕЛЬНО
//! проверяет числовые предпосылки и возвращает явные коды отказа,
//! а не фиктивные результаты. `unsafe` в коде крейта не
//! используется: весь ABI идёт через wasm-bindgen слайсы.
//!
//! Сборка:
//! - native: `cargo test --locked`, `cargo build --release`
//!   (юнит-тесты и benchmark-бинарник evowars_bench);
//! - WASM: `cargo build --release --target wasm32-unknown-unknown`
//!   + `wasm-bindgen` (glue для Node/браузера, см.
//!   scripts/wasm/build-wasm.mjs).

pub mod kinetics;
pub mod kinetics_session;
pub mod reaction_audit;
