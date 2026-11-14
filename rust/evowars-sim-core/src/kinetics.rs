//! Числовое ядро k(T): Rust-порт числовой семантики
//! `src/modules/Core/kinetics.ts` (Stage 4.5.2).
//!
//! Поддерживаются обе существующие ветви:
//! - модифицированный Аррениус с энергетическим параметром
//!   E/R (К) или Ea (Дж/моль);
//! - fall-off: Lindemann-ядро + существующее Troe-уширение
//!   (k0, kInf, Pr = k0*M/kInf, log10 Pr, F = Fc^(1/(1+(log10Pr/N)^2)),
//!   k = (k0*M/(1+Pr))*F).
//!
//! Валидация записей, единицы, provenance, uncertainty,
//! evidence/dataStatus, правила температурной применимости
//! и правила отсутствующих данных остаются в TypeScript:
//! адаптер `src/modules/RustSim/rustKinetics.ts` выполняет их
//! ДО упаковки и передаёт в Rust только числовые предпосылки.
//! Порядок числовых проверок зеркалит TS-реализацию:
//! (1) T конечное и > 0, иначе invalid_input;
//! (2) kind = arrhenius: диапазон (включительно) →
//!     temperature_out_of_range, затем расчёт k;
//!     kind = fall_off: M конечное и > 0 → иначе
//!     invalid_third_body, затем параметры, затем диапазоны
//!     ОБЕИХ ветвей (включительно), затем k0/kInf,
//!     затем итоговое k;
//! (3) любой не-конечный или <= 0 результат → numerical_failure.
//!
//! ## Batch ABI (17 слотов f64 на операцию)
//!
//! ```text
//! [0]  kind: 0 = arrhenius, 1 = fall_off
//! [1]  temperatureK
//! [2]  thirdBodyConcentration M (только fall_off)
//! [3]  A (preExponentialA, низ/основная ветвь)
//! [4]  n (temperatureExponent)
//! [5]  energyForm: 0 = E_over_R, 1 = Ea_J_mol
//! [6]  energyValue (К или Дж/моль соответственно)
//! [7]  rangeMin (К, включительно)
//! [8]  rangeMax (К, включительно)
//! [9]  A_hi   (только fall_off)
//! [10] n_hi   (только fall_off)
//! [11] energyForm_hi (только fall_off)
//! [12] energyValue_hi (только fall_off)
//! [13] rangeMin_hi (только fall_off)
//! [14] rangeMax_hi (только fall_off)
//! [15] Fc (centeringFactorFc, только fall_off)
//! [16] N  (broadeningN, только fall_off)
//! ```
//!
//! Выходы: `out_k` (n), `out_diag` (5n: k0, kInf, Pr, log10Pr, F;
//! NaN для чистого Аррениуса и для отказов), `out_status` (n).
//! Статусы: 0 ok, 1 temperature_out_of_range,
//! 2 invalid_third_body, 3 numerical_failure, 4 invalid_input.
//! Коды отказа ABI: -1 длина params не кратна 17,
//! -2 несогласованные длины выходных буферов.

use wasm_bindgen::prelude::*;

pub const ARRHENIUS_REFERENCE_TEMPERATURE_K: f64 = 300.0;
pub const UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K: f64 = 8.31446261815324;

pub const STATUS_OK: i32 = 0;
pub const STATUS_TEMPERATURE_OUT_OF_RANGE: i32 = 1;
pub const STATUS_INVALID_THIRD_BODY: i32 = 2;
pub const STATUS_NUMERICAL_FAILURE: i32 = 3;
pub const STATUS_INVALID_INPUT: i32 = 4;

pub const KIND_ARRHENIUS: f64 = 0.0;
pub const KIND_FALL_OFF: f64 = 1.0;

pub const ENERGY_FORM_E_OVER_R: f64 = 0.0;
pub const ENERGY_FORM_EA_J_MOL: f64 = 1.0;

pub const KIN_STRIDE: usize = 17;
pub const DIAG_STRIDE: usize = 5;

/// Числовое ядро одной операции (5 слотов входа + вычисление).
/// Зеркалит arrheniusValue() TS: exponent = E/R/T или Ea/(R*T);
/// k = A * (T/300)^n * exp(-exponent), порядок умножения слева направо.
#[inline]
pub fn arrhenius_value(a: f64, n: f64, energy_form: f64, energy_value: f64, temperature_k: f64) -> f64 {
    let exponent = if energy_form == ENERGY_FORM_E_OVER_R {
        energy_value / temperature_k
    } else {
        energy_value / (UNIVERSAL_GAS_CONSTANT_J_PER_MOL_K * temperature_k)
    };
    a * (temperature_k / ARRHENIUS_REFERENCE_TEMPERATURE_K).powf(n) * (-exponent).exp()
}

/// Проверка числовых предпосылок одной Аррениус-ветви
/// (A, n, форма энергии, значение энергии, границы диапазона):
/// всё должно быть конечным, форма энергии — 0 или 1.
#[inline]
fn arrhenius_params_finite(p: &[f64]) -> bool {
    // p = [A, n, energyForm, energyValue, rangeMin, rangeMax]
    p[0].is_finite()
        && p[1].is_finite()
        && (p[2] == ENERGY_FORM_E_OVER_R || p[2] == ENERGY_FORM_EA_J_MOL)
        && p[3].is_finite()
        && p[4].is_finite()
        && p[5].is_finite()
}

/// Оценка одной операции по 17 слотам. Возвращает (k, diag, status).
fn evaluate_item(p: &[f64]) -> (f64, [f64; DIAG_STRIDE], i32) {
    let mut diag = [f64::NAN; DIAG_STRIDE];
    let kind = p[0];
    let t = p[1];

    if !t.is_finite() || t <= 0.0 {
        return (f64::NAN, diag, STATUS_INVALID_INPUT);
    }
    if !p[3..9].iter().all(|v| v.is_finite()) {
        return (f64::NAN, diag, STATUS_INVALID_INPUT);
    }
    if kind == KIND_ARRHENIUS {
        if !arrhenius_params_finite(&p[3..9]) {
            return (f64::NAN, diag, STATUS_INVALID_INPUT);
        }
        if t < p[7] || t > p[8] {
            return (f64::NAN, diag, STATUS_TEMPERATURE_OUT_OF_RANGE);
        }
        let k = arrhenius_value(p[3], p[4], p[5], p[6], t);
        if !k.is_finite() || k <= 0.0 {
            return (f64::NAN, diag, STATUS_NUMERICAL_FAILURE);
        }
        return (k, diag, STATUS_OK);
    }
    if kind != KIND_FALL_OFF {
        return (f64::NAN, diag, STATUS_INVALID_INPUT);
    }

    let m = p[2];
    if !m.is_finite() || m <= 0.0 {
        return (f64::NAN, diag, STATUS_INVALID_THIRD_BODY);
    }
    if !p[9..15].iter().all(|v| v.is_finite()) {
        return (f64::NAN, diag, STATUS_INVALID_INPUT);
    }
    if !arrhenius_params_finite(&p[9..15]) {
        return (f64::NAN, diag, STATUS_INVALID_INPUT);
    }
    let fc = p[15];
    let broadening = p[16];
    if !fc.is_finite() || fc <= 0.0 || fc > 1.0 || !broadening.is_finite() || broadening <= 0.0 {
        return (f64::NAN, diag, STATUS_INVALID_INPUT);
    }
    if t < p[7] || t > p[8] || t < p[13] || t > p[14] {
        return (f64::NAN, diag, STATUS_TEMPERATURE_OUT_OF_RANGE);
    }
    let k0 = arrhenius_value(p[3], p[4], p[5], p[6], t);
    let k_inf = arrhenius_value(p[9], p[10], p[11], p[12], t);
    if !k0.is_finite() || k0 <= 0.0 || !k_inf.is_finite() || k_inf <= 0.0 {
        return (f64::NAN, diag, STATUS_NUMERICAL_FAILURE);
    }
    let pr = (k0 * m) / k_inf;
    let log10_pr = pr.log10();
    let ratio = log10_pr / broadening;
    let f = fc.powf(1.0 / (1.0 + ratio * ratio));
    let k = ((k0 * m) / (1.0 + pr)) * f;
    diag = [k0, k_inf, pr, log10_pr, f];
    if !k.is_finite() || k <= 0.0 {
        return (f64::NAN, diag, STATUS_NUMERICAL_FAILURE);
    }
    (k, diag, STATUS_OK)
}

/// Числовое ядро батча кинетики (используется WASM-обёрткой,
/// native-тестами и benchmark-бинарником).
pub fn kinetics_batch_impl(
    params: &[f64],
    out_k: &mut [f64],
    out_diag: &mut [f64],
    out_status: &mut [i32],
) -> i32 {
    if params.len() % KIN_STRIDE != 0 {
        return -1;
    }
    let n = params.len() / KIN_STRIDE;
    if out_k.len() != n || out_diag.len() != n * DIAG_STRIDE || out_status.len() != n {
        return -2;
    }
    for i in 0..n {
        let base = i * KIN_STRIDE;
        let (k, diag, status) = evaluate_item(&params[base..base + KIN_STRIDE]);
        out_k[i] = k;
        for j in 0..DIAG_STRIDE {
            out_diag[i * DIAG_STRIDE + j] = diag[j];
        }
        out_status[i] = status;
    }
    0
}

/// WASM batch API: один вызов на пакет операций.
#[wasm_bindgen]
pub fn evowars_kinetics_batch(
    params: &[f64],
    out_k: &mut [f64],
    out_diag: &mut [f64],
    out_status: &mut [i32],
) -> i32 {
    kinetics_batch_impl(params, out_k, out_diag, out_status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slot(p: &[f64]) -> (f64, [f64; DIAG_STRIDE], i32) {
        assert_eq!(p.len(), KIN_STRIDE);
        evaluate_item(p)
    }

    fn arrhenius_slots(a: f64, n: f64, eform: f64, evalue: f64, t: f64) -> Vec<f64> {
        vec![0.0, t, 0.0, a, n, eform, evalue, 200.0, 2000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    }

    fn falloff_slots(a0: f64, ainf: f64, m: f64, fc: f64, nb: f64, t: f64) -> Vec<f64> {
        vec![
            1.0, t, m, a0, 0.0, 0.0, 0.0, 200.0, 2000.0, ainf, 0.0, 0.0, 0.0, 200.0, 2000.0, fc, nb,
        ]
    }

    #[test]
    fn arrhenius_e_over_r_reference_point() {
        // A=1e-11, n=0, E/R=0, T=300: k = A.
        let (k, _, status) = slot(&arrhenius_slots(1e-11, 0.0, 0.0, 0.0, 300.0));
        assert_eq!(status, STATUS_OK);
        assert_eq!(k, 1e-11);
    }

    #[test]
    fn arrhenius_temperature_power() {
        // n=1, T=600: (600/300)^1 = 2.
        let (k, _, status) = slot(&arrhenius_slots(1e-11, 1.0, 0.0, 0.0, 600.0));
        assert_eq!(status, STATUS_OK);
        assert_eq!(k, 2e-11);
    }

    #[test]
    fn arrhenius_ea_j_mol_form() {
        // Ea=0 при любой T даёт k=A (экспонента exp(0)=1).
        let (k, _, status) = slot(&arrhenius_slots(2.5, 0.0, 1.0, 0.0, 500.0));
        assert_eq!(status, STATUS_OK);
        assert_eq!(k, 2.5);
    }

    #[test]
    fn arrhenius_inclusive_range_bounds() {
        let (_, _, s_min) = slot(&arrhenius_slots(1.0, 0.0, 0.0, 0.0, 200.0));
        assert_eq!(s_min, STATUS_OK);
        let (_, _, s_max) = slot(&arrhenius_slots(1.0, 0.0, 0.0, 0.0, 2000.0));
        assert_eq!(s_max, STATUS_OK);
        let (_, _, s_below) = slot(&arrhenius_slots(1.0, 0.0, 0.0, 0.0, 199.9999999));
        assert_eq!(s_below, STATUS_TEMPERATURE_OUT_OF_RANGE);
        let (_, _, s_above) = slot(&arrhenius_slots(1.0, 0.0, 0.0, 0.0, 2000.0000001));
        assert_eq!(s_above, STATUS_TEMPERATURE_OUT_OF_RANGE);
    }

    fn assert_rel_close(actual: f64, expected: f64, rel_tol: f64) {
        if expected == 0.0 {
            assert!(actual.abs() < 1e-300, "expected ~0, got {actual}");
        } else {
            let diff = (actual - expected).abs() / expected.abs();
            assert!(diff < rel_tol, "expected {expected}, got {actual} (rel diff {diff})");
        }
    }

    #[test]
    fn falloff_pr_equals_one() {
        // k0=2e-30, kInf=1e-10, M=5e19: Pr=1, log10Pr=0,
        // F=Fc^(1/(1+0))=Fc=0.6, k=(2e-30*5e19)/(2)*0.6=3e-11.
        // Бинарные приближения сомножителей не обязаны давать
        // битово точные 1e-10/2/0.6, поэтому относительные допуски.
        let (k, diag, status) = slot(&falloff_slots(2e-30, 1e-10, 5e19, 0.6, 1.0, 300.0));
        assert_eq!(status, STATUS_OK);
        assert_rel_close(k, 3e-11, 1e-12);
        assert_rel_close(diag[0], 2e-30, 1e-15);
        assert_rel_close(diag[1], 1e-10, 1e-15);
        assert_rel_close(diag[2], 1.0, 1e-12);
        assert!(diag[3].abs() < 1e-12, "log10Pr ~ 0, got {}", diag[3]);
        assert_rel_close(diag[4], 0.6, 1e-12);
    }

    #[test]
    fn falloff_extremes_still_ok() {
        // Малое Pr: k близко к k0*M*F, где F = Fc^(1/(1+(log10Pr/N)^2)).
        // Для Pr=2e-10, N=1: log10Pr ~ -9.7, F ~ 0.6^(1/95) ~ 0.9947,
        // поэтому k отличается от k0*M примерно на 0.5%.
        let (k, diag, status) = slot(&falloff_slots(2e-30, 1e-10, 1e10, 0.6, 1.0, 300.0));
        assert_eq!(status, STATUS_OK);
        assert!(diag[2] < 1e-6);
        assert!((k - 2e-20).abs() / 2e-20 < 0.02);
        // Большое Pr: k близко к kInf*F.
        let (k2, diag2, status2) = slot(&falloff_slots(2e-30, 1e-10, 1e30, 0.6, 1.0, 300.0));
        assert_eq!(status2, STATUS_OK);
        assert!(diag2[2] > 1e6);
        assert!((k2 - 1e-10 * diag2[4]).abs() / (1e-10 * diag2[4]) < 1e-9);
    }

    #[test]
    fn overflow_yields_numerical_failure() {
        // A=1e308, n=2, T=600: (2)^2*1e308 = 4e308 → inf.
        let (k, _, status) = slot(&arrhenius_slots(1e308, 2.0, 0.0, 0.0, 600.0));
        assert_eq!(status, STATUS_NUMERICAL_FAILURE);
        assert!(!k.is_finite());
    }

    #[test]
    fn underflow_yields_numerical_failure() {
        // E/R=300000, T=300: exp(-1000)=0 → k=0 → отказ.
        // Контракт ядра: при numerical_failure выход k = NaN
        // (адаптер игнорирует значение, важен только статус).
        let (k, _, status) = slot(&arrhenius_slots(1e-11, 0.0, 0.0, 300000.0, 300.0));
        assert_eq!(status, STATUS_NUMERICAL_FAILURE);
        assert!(k.is_nan());
    }

    #[test]
    fn missing_third_body_is_invalid() {
        // kind=fall_off, M=0 (адаптер передаёт 0 только как
        // числовой маркер отсутствия/некорректности M).
        let (_, _, status) = slot(&falloff_slots(2e-30, 1e-10, 0.0, 0.6, 1.0, 300.0));
        assert_eq!(status, STATUS_INVALID_THIRD_BODY);
    }

    #[test]
    fn bad_energy_form_is_invalid_input() {
        let (_, _, status) = slot(&arrhenius_slots(1.0, 0.0, 2.0, 0.0, 300.0));
        assert_eq!(status, STATUS_INVALID_INPUT);
    }

    #[test]
    fn nonfinite_temperature_is_invalid_input() {
        let (_, _, status) = slot(&arrhenius_slots(1.0, 0.0, 0.0, 0.0, f64::NAN));
        assert_eq!(status, STATUS_INVALID_INPUT);
        let (_, _, status2) = slot(&arrhenius_slots(1.0, 0.0, 0.0, 0.0, -50.0));
        assert_eq!(status2, STATUS_INVALID_INPUT);
    }

    #[test]
    fn batch_impl_length_checks() {
        let mut k = [0.0f64; 2];
        let mut diag = [0.0f64; 2 * DIAG_STRIDE];
        let mut status = [0i32; 2];
        // Некратная длина → -1.
        let bad = [0.0f64; 18];
        assert_eq!(kinetics_batch_impl(&bad, &mut k, &mut diag, &mut status), -1);
        // Несогласованные выходы → -2.
        let good = [0.0f64; 34];
        assert_eq!(kinetics_batch_impl(&good, &mut k, &mut diag, &mut [0i32; 1]), -2);
        // Корректный батч из двух операций.
        let mut kk = [0.0f64; 2];
        let mut dd = [0.0f64; 2 * DIAG_STRIDE];
        let mut st = [0i32; 2];
        let mut params = Vec::new();
        params.extend_from_slice(&arrhenius_slots(1e-11, 0.0, 0.0, 0.0, 300.0));
        params.extend_from_slice(&falloff_slots(2e-30, 1e-10, 5e19, 0.6, 1.0, 300.0));
        assert_eq!(kinetics_batch_impl(&params, &mut kk, &mut dd, &mut st), 0);
        assert_eq!(st, [STATUS_OK, STATUS_OK]);
        assert_eq!(kk[0], 1e-11);
        assert_rel_close(kk[1], 3e-11, 1e-12);
    }
}
