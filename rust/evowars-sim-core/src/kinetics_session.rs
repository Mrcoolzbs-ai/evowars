//! Prepared-сессия кинетики k(T) (Stage I: Persistent Rust/WASM
//! Kinetics Session).
//!
//! Мотивация: Stage H доказал, что числовое ядро быстрое (6-31×
//! на ядре), но полный цикл «упаковка + вызов + распаковка»
//! оказался МЕДЛЕННЕЕ исходного TS-API (0.48-1.05×). Причина —
//! стоимость подготовки данных на каждый вызов. Сессия устраняет
//! её из горячего цикла: НЕИЗМЕННЫЕ параметры реакций хранятся
//! в памяти WASM; на каждом игровом тике передаются только T и M.
//!
//! Lifecycle:
//! - подготовка: `KineticsPrepared::new(params)` — один раз;
//! - вычисление: `tick(...)` — многократно, произвольное число тиков;
//! - освобождение: `free()` (glue wasm-bindgen) или
//!   `RustPreparedKineticsSession.dispose()` в TS-адаптере
//!   (rustKineticsSession.ts, лимит активных сессий + FinalizationRegistry).
//!
//! Раскладка параметров — та же 17-слотовая, что и в batch ABI
//! kinetics.rs; слоты [1] (T) и [2] (M) в сессии НЕ используются:
//! T и M приходят аргументами тика. Семантика тика зеркалит
//! `evaluate_item` (kinetics.rs) + TS пре-чек правил [M]:
//! - T не конечное или <= 0 → invalid_input;
//! - kind = arrhenius: конечный [M] в third_body → invalid_input
//!   (реплика TS-правила «аррениусовская запись не зависит от
//!   давления»; NaN-конвенция «[M] не передан» кодируется
//!   TS-адаптером: arrhenius-слот с переданным [M] получает
//!   конечный маркер 0.0);
//! - kind = fall_off: NaN / <= 0 / ∞ в [M] → invalid_third_body;
//! - порядок остальных проверок, диапазоны (включительно),
//!   k0/k∞, Troe-форма, «не-конечный или <= 0 результат →
//!   numerical_failure, k = NaN» — идентичны kinetics.rs.
//!
//! ABI: конструктор отвергает params с длиной, не кратной 17;
//! tick: -1 длины входов (temperatures/third_body != n),
//! -2 длины выходов. `memory_bytes()` — фактический объём
//! хранения параметров (байты, оценка: capacity×8 + размер
//! структуры) для отчётов по памяти.

use wasm_bindgen::prelude::*;
use crate::kinetics::{
    arrhenius_value, DIAG_STRIDE, ENERGY_FORM_E_OVER_R, ENERGY_FORM_EA_J_MOL, KIND_ARRHENIUS,
    KIND_FALL_OFF, KIN_STRIDE, STATUS_INVALID_INPUT, STATUS_INVALID_THIRD_BODY,
    STATUS_NUMERICAL_FAILURE, STATUS_OK, STATUS_TEMPERATURE_OUT_OF_RANGE,
};

/// Реплика приватного `arrhenius_params_finite` из kinetics.rs
/// (файл Stage H не изменяется; семантика идентична дословно).
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

/// Оценка одной реакции сессии: T и M приходят аргументами тика,
/// слоты params[1]/params[2] не читаются. Порядок проверок
/// зеркалит evaluate_item (kinetics.rs) + TS-правила [M].
#[inline]
fn evaluate_session_item(p: &[f64], t: f64, m: f64) -> (f64, [f64; DIAG_STRIDE], i32) {
    let mut diag = [f64::NAN; DIAG_STRIDE];
    let kind = p[0];

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
        // TS пре-чек: аррениусовская запись + переданный [M] →
        // invalid_input. «Не передан» = NaN, «передан» = конечное
        // число (маркер 0.0 для arrhenius-слотов, см. адаптер).
        if m.is_finite() {
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

/// Prepared-сессия кинетики: неизменные параметры реакций
/// в памяти WASM, тики передают только T и M.
#[wasm_bindgen]
pub struct KineticsPrepared {
    params: Vec<f64>,
    n: usize,
}

#[wasm_bindgen]
impl KineticsPrepared {
    /// Подготовка сессии из 17-слотовой раскладки батча (слоты
    /// T/M игнорируются). Семантические per-reaction проверки
    /// остаются на тике: невалидные параметры дают invalid_input
    /// по соответствующей реакции, а не отказ всей сессии.
    #[wasm_bindgen(constructor)]
    pub fn new(params: &[f64]) -> Result<KineticsPrepared, JsValue> {
        if params.len() % KIN_STRIDE != 0 {
            return Err(JsValue::from_str(
                "KineticsPrepared: длина params должна быть кратна 17 (17 слотов на реакцию)",
            ));
        }
        Ok(KineticsPrepared {
            params: params.to_vec(),
            n: params.len() / KIN_STRIDE,
        })
    }

    /// Число реакций сессии.
    pub fn n_reactions(&self) -> usize {
        self.n
    }

    /// Объём памяти параметров сессии (байты, оценка) — для отчётов.
    pub fn memory_bytes(&self) -> usize {
        self.params.capacity() * std::mem::size_of::<f64>() + std::mem::size_of::<Self>()
    }

    /// Один игровой тик: T и M всех реакций → k, диагностика
    /// fall-off (5 слотов) и статусы. Буферы выходов передаются
    /// адаптером и переиспользуются между тиками.
    pub fn tick(
        &self,
        temperatures: &[f64],
        third_body: &[f64],
        out_k: &mut [f64],
        out_diag: &mut [f64],
        out_status: &mut [i32],
    ) -> i32 {
        let n = self.n;
        if temperatures.len() != n || third_body.len() != n {
            return -1;
        }
        if out_k.len() != n || out_diag.len() != n * DIAG_STRIDE || out_status.len() != n {
            return -2;
        }
        for i in 0..n {
            let base = i * KIN_STRIDE;
            let (k, diag, status) = evaluate_session_item(
                &self.params[base..base + KIN_STRIDE],
                temperatures[i],
                third_body[i],
            );
            out_k[i] = k;
            for j in 0..DIAG_STRIDE {
                out_diag[i * DIAG_STRIDE + j] = diag[j];
            }
            out_status[i] = status;
        }
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arrhenius_row(a: f64, n_exp: f64, e_form: f64, e_val: f64) -> Vec<f64> {
        vec![
            0.0, 0.0, 0.0, a, n_exp, e_form, e_val, 200.0, 2000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
            0.0, 0.0,
        ]
    }

    fn falloff_row(a0: f64, a_inf: f64, fc: f64, nb: f64) -> Vec<f64> {
        vec![
            1.0, 0.0, 0.0, a0, 0.0, 0.0, 0.0, 200.0, 2000.0, a_inf, 0.0, 0.0, 0.0, 200.0, 2000.0,
            fc, nb,
        ]
    }

    fn session(rows: &[Vec<f64>]) -> KineticsPrepared {
        let flat: Vec<f64> = rows.concat();
        KineticsPrepared::new(&flat).expect("валидная раскладка")
    }

    fn tick_one(
        s: &KineticsPrepared,
        t: f64,
        m: f64,
    ) -> (f64, [f64; DIAG_STRIDE], i32) {
        let temps = vec![t];
        let thirds = vec![m];
        let mut k = vec![0.0f64; 1];
        let mut d = vec![0.0f64; DIAG_STRIDE];
        let mut st = vec![0i32; 1];
        assert_eq!(s.tick(&temps, &thirds, &mut k, &mut d, &mut st), 0);
        let mut diag = [f64::NAN; DIAG_STRIDE];
        diag.copy_from_slice(&d);
        (k[0], diag, st[0])
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
    fn arrhenius_reference_and_power() {
        // A=1e-11, n=0: k(300) = 1e-11; n=1: k(600) = 2e-11.
        let s = session(&[arrhenius_row(1e-11, 1.0, 0.0, 0.0)]);
        let (k1, _, s1) = tick_one(&s, 300.0, f64::NAN);
        assert_eq!((s1, k1), (crate::kinetics::STATUS_OK, 1e-11));
        let (k2, _, s2) = tick_one(&s, 600.0, f64::NAN);
        assert_eq!((s2, k2), (crate::kinetics::STATUS_OK, 2e-11));
    }

    #[test]
    fn arrhenius_with_third_body_is_invalid_input() {
        // Реплика TS пре-чека: arrhenius + переданный [M].
        let s = session(&[arrhenius_row(1e-11, 0.0, 0.0, 0.0)]);
        let (_, _, status) = tick_one(&s, 300.0, 1e19);
        assert_eq!(status, STATUS_INVALID_INPUT);
    }

    #[test]
    fn falloff_pr_equals_one() {
        // k0=2e-30, kInf=1e-10, M=5e19, Fc=0.6, N=1: Pr=1,
        // F=0.6, k=3e-11 (относительные допуски, см. kinetics.rs).
        let s = session(&[falloff_row(2e-30, 1e-10, 0.6, 1.0)]);
        let (k, diag, status) = tick_one(&s, 300.0, 5e19);
        assert_eq!(status, STATUS_OK);
        assert_rel_close(k, 3e-11, 1e-12);
        assert_rel_close(diag[2], 1.0, 1e-12);
        assert_rel_close(diag[4], 0.6, 1e-12);
    }

    #[test]
    fn falloff_third_body_rules() {
        let s = session(&[falloff_row(2e-30, 1e-10, 0.6, 1.0)]);
        // Не передан (NaN) → invalid_third_body.
        assert_eq!(tick_one(&s, 300.0, f64::NAN).2, STATUS_INVALID_THIRD_BODY);
        // 0 / отрицательный / ∞ → invalid_third_body.
        assert_eq!(tick_one(&s, 300.0, 0.0).2, STATUS_INVALID_THIRD_BODY);
        assert_eq!(tick_one(&s, 300.0, -1.0).2, STATUS_INVALID_THIRD_BODY);
        assert_eq!(tick_one(&s, 300.0, f64::INFINITY).2, STATUS_INVALID_THIRD_BODY);
    }

    #[test]
    fn range_checks_are_inclusive() {
        let s = session(&[arrhenius_row(1.0, 0.0, 0.0, 0.0)]);
        assert_eq!(tick_one(&s, 200.0, f64::NAN).2, STATUS_OK);
        assert_eq!(tick_one(&s, 2000.0, f64::NAN).2, STATUS_OK);
        assert_eq!(
            tick_one(&s, 199.9999999, f64::NAN).2,
            STATUS_TEMPERATURE_OUT_OF_RANGE
        );
        assert_eq!(
            tick_one(&s, 2000.0000001, f64::NAN).2,
            STATUS_TEMPERATURE_OUT_OF_RANGE
        );
    }

    #[test]
    fn overflow_and_underflow_are_numerical_failure() {
        // A=1e308, n=2, T=600: (2)^2×1e308 → inf.
        let s = session(&[arrhenius_row(1e308, 2.0, 0.0, 0.0)]);
        let (k, _, status) = tick_one(&s, 600.0, f64::NAN);
        assert_eq!(status, STATUS_NUMERICAL_FAILURE);
        assert!(!k.is_finite());
        // E/R=300000, T=300: exp(-1000)=0 → k=0 → отказ, k=NaN.
        let s2 = session(&[arrhenius_row(1e-11, 0.0, 0.0, 300000.0)]);
        let (k2, _, status2) = tick_one(&s2, 300.0, f64::NAN);
        assert_eq!(status2, STATUS_NUMERICAL_FAILURE);
        assert!(k2.is_nan());
    }

    #[test]
    fn invalid_temperature_is_invalid_input() {
        let s = session(&[arrhenius_row(1.0, 0.0, 0.0, 0.0)]);
        assert_eq!(tick_one(&s, f64::NAN, f64::NAN).2, STATUS_INVALID_INPUT);
        assert_eq!(tick_one(&s, 0.0, f64::NAN).2, STATUS_INVALID_INPUT);
        assert_eq!(tick_one(&s, -50.0, f64::NAN).2, STATUS_INVALID_INPUT);
    }

    #[test]
    fn unknown_kind_is_invalid_input() {
        let mut row = arrhenius_row(1.0, 0.0, 0.0, 0.0);
        row[0] = 2.0;
        let s = session(&[row]);
        assert_eq!(tick_one(&s, 300.0, f64::NAN).2, STATUS_INVALID_INPUT);
    }

    #[test]
    fn repeated_ticks_are_deterministic() {
        let s = session(&[falloff_row(2e-30, 1e-10, 0.6, 1.0)]);
        let (k1, d1, s1) = tick_one(&s, 450.0, 5e19);
        let (k2, d2, s2) = tick_one(&s, 450.0, 5e19);
        assert_eq!(s1, s2);
        assert_eq!(k1, k2);
        assert_eq!(d1, d2);
    }

    #[test]
    fn changing_t_and_m_between_ticks() {
        // Один и тот же тик-вызов пересчитывает по новым T/M:
        // arrhenius n=1: k(300)=1e-11, k(900)=3e-11.
        let s = session(&[arrhenius_row(1e-11, 1.0, 0.0, 0.0)]);
        let (k1, _, s1) = tick_one(&s, 300.0, f64::NAN);
        let (k2, _, s2) = tick_one(&s, 900.0, f64::NAN);
        assert_eq!((s1, k1), (STATUS_OK, 1e-11));
        assert_eq!((s2, k2), (STATUS_OK, 3e-11));
    }

    #[test]
    fn tick_length_error_codes() {
        let s = session(&[arrhenius_row(1.0, 0.0, 0.0, 0.0)]);
        let mut k = vec![0.0f64; 1];
        let mut d = vec![0.0f64; DIAG_STRIDE];
        let mut st = vec![0i32; 1];
        // Длина входа не равна n → -1.
        assert_eq!(s.tick(&[300.0, 400.0], &[f64::NAN], &mut k, &mut d, &mut st), -1);
        // Длина выхода не согласована → -2.
        assert_eq!(s.tick(&[300.0], &[f64::NAN], &mut k, &mut d, &mut [0i32; 2]), -2);
    }

    #[test]
    fn constructor_rejects_bad_length() {
        assert!(KineticsPrepared::new(&[0.0f64; 18]).is_err());
        assert!(KineticsPrepared::new(&[0.0f64; 34]).is_ok());
    }

    #[test]
    fn accessors_and_memory() {
        let rows = vec![arrhenius_row(1.0, 0.0, 0.0, 0.0), falloff_row(1.0, 1.0, 0.5, 1.0)];
        let s = session(&rows);
        assert_eq!(s.n_reactions(), 2);
        assert!(s.memory_bytes() >= 34 * std::mem::size_of::<f64>());
    }

    #[test]
    fn multi_reaction_batch_tick() {
        // Смешанный батч: arrhenius + fall-off в одной сессии,
        // выходы по индексам реакций.
        let s = session(&[
            arrhenius_row(1e-11, 0.0, 0.0, 0.0),
            falloff_row(2e-30, 1e-10, 0.6, 1.0),
        ]);
        let temps = [300.0, 300.0];
        let thirds = [f64::NAN, 5e19];
        let mut k = [0.0f64; 2];
        let mut d = [0.0f64; 2 * DIAG_STRIDE];
        let mut st = [0i32; 2];
        assert_eq!(s.tick(&temps, &thirds, &mut k, &mut d, &mut st), 0);
        assert_eq!(st, [STATUS_OK, STATUS_OK]);
        assert_eq!(k[0], 1e-11);
        assert_rel_close(k[1], 3e-11, 1e-12);
    }
}
