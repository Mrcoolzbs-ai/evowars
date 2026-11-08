//! Числовое ядро аудита стехиометрии: Rust-порт числовой части
//! `auditReactionStoichiometry()` из
//! `src/modules/Core/reactionLedger.ts`.
//!
//! Rust выполняет ТОЛЬКО числовую часть: суммирование
//! коэффициентов участников по каждой стороне, накопление
//! элементных вкладов proven-состава, накопление заряда,
//! выявление переполнения/не-конечных промежуточных значений
//! и разности с заданным tolerance.
//!
//! ВСЯ семантика классификации остаётся в TypeScript
//! (адаптер `src/modules/RustSim/rustReactionAudit.ts`):
//! validateReactionRecord, каталог, proven composition,
//! статусы known/estimated/unknown/not_implemented/not_applicable,
//! missingSpecies/unprovenSpecies/estimatedSpecies,
//! диагностика, итоговые статусы
//! balanced / imbalanced / approximate / not_verifiable / invalid.
//! Rust НЕ имеет права считать неизвестный состав нулевым,
//! превращать not_verifiable в balanced или скрывать переполнение:
//! missing/unproven виды исключаются из накопления и помечаются
//! отдельными статусами входа, а любое переполнение возвращается
//! флагами non-finite и далее интерпретируется адаптером как
//! not_verifiable.
//!
//! ## Batch ABI (плоские буферы, стабильные индексы)
//!
//! Входы (все массивы согласованы по длине, проверяется на входе):
//! - `species_status`: Int32Array, 0 = proven, 1 = missing (нет в
//!   каталоге), 2 = unproven (состав не proven); индекс = слот вида
//!   (произвольные идентификаторы и зарезервированные JS-ключи
//!   вида `constructor`/`__proto__` НЕ передаются в Rust:
//!   TypeScript сам мапит speciesId → стабильный числовой слот);
//! - `species_charge`: Float64Array, заряд слота;
//! - `species_elem_offsets`: Uint32Array (n_species + 1) — CSR
//!   офсеты элементных записей вида;
//! - `elem_indices`/`elem_counts`: элементные записи (глобальный
//!   индекс элемента и его количество в составе); порядок записей
//!   вида = порядок Object.entries proven-состава;
//! - `left_offsets`/`right_offsets`: Uint32Array (n_reactions + 1)
//!   — CSR офсеты участников по сторонам;
//! - `part_species`/`part_coeff`: участники (слот вида, коэффициент)
//!   в исходном порядке записей реакции;
//! - `tolerance`: f64 (адаптер уже проверил её корректность).
//!
//! Выходы (по реакциям; `out_elem_offsets` — CSR по реакциям,
//! суммарный размер union-элементов передаётся адаптером заранее
//! и сверки длины обязательны):
//! - `out_flags`: Int32Array, биты: 1 = nonFiniteLeft, 2 =
//!   nonFiniteRight, 4 = elementDiff, 8 = chargeDiff;
//! - `out_left_charge`/`out_right_charge`: raw суммы заряда
//!   сторон (включая NaN/Infinity);
//! - `out_elem_index`: глобальные индексы элементов union
//!   (порядок: сначала элементы левой стороны в порядке первого
//!   появления, затем новые элементы правой — зеркалит
//!   `new Set([...left keys, ...right keys])`);
//! - `out_elem_left`/`out_elem_right`: численные суммы элемента
//!   на каждой стороне (0, если на стороне элемента нет);
//! - `out_elem_exceeds`: Int32Array 0/1 — |left-right| > tolerance
//!   (вычисляется ТОЛЬКО когда обе стороны конечны; иначе 0);
//! - `out_elem_side`: Int32Array, биты присутствия: 1 = слева,
//!   2 = справа (для реконструкции reactantElements/productElements
//!   без чужих нулей).
//!
//! Коды отказа ABI: -1 несовпадение длин входов, -2 несовпадение
//! длин выходов, -3 фактический размер union превысил переданный
//! буфер.

use wasm_bindgen::prelude::*;

pub const SPECIES_PROVEN: i32 = 0;
pub const SPECIES_MISSING: i32 = 1;
pub const SPECIES_UNPROVEN: i32 = 2;

pub const FLAG_NONFINITE_LEFT: i32 = 1;
pub const FLAG_NONFINITE_RIGHT: i32 = 2;
pub const FLAG_ELEMENT_DIFF: i32 = 4;
pub const FLAG_CHARGE_DIFF: i32 = 8;

pub const SIDE_LEFT_ONLY: i32 = 1;
pub const SIDE_RIGHT_ONLY: i32 = 2;
pub const SIDE_BOTH: i32 = 3;

struct SideScratch {
    sums: Vec<f64>,
    seen: Vec<bool>,
    touched: Vec<usize>,
    elem_totals: Vec<f64>,
    elem_seen: Vec<bool>,
    elem_touched: Vec<usize>,
}

struct SideOut {
    elems: Vec<(usize, f64)>,
    charge: f64,
    non_finite: bool,
}

impl SideScratch {
    fn new(n_species: usize, n_elements: usize) -> Self {
        SideScratch {
            sums: vec![0.0; n_species],
            seen: vec![false; n_species],
            touched: Vec::with_capacity(16),
            elem_totals: vec![0.0; n_elements],
            elem_seen: vec![false; n_elements],
            elem_touched: Vec::with_capacity(16),
        }
    }

    fn reset(&mut self) {
        for &sp in self.touched.iter() {
            self.seen[sp] = false;
            self.sums[sp] = 0.0;
        }
        self.touched.clear();
        for &e in self.elem_touched.iter() {
            self.elem_seen[e] = false;
            self.elem_totals[e] = 0.0;
        }
        self.elem_touched.clear();
    }
}

/// Обработка одной стороны. Порядок суммирования зеркалит TS:
/// коэффициенты в порядке участников (первое появление вида),
/// затем в порядке первого появления вида — вклады элементов в
/// порядке записей состава и заряд. missing/unproven виды входят
/// в суммирование коэффициентов и в non-finite флаг этих сумм,
/// но НЕ вносят ни элементы, ни заряд.
#[inline]
fn process_side(
    from: usize,
    to: usize,
    part_species: &[u32],
    part_coeff: &[f64],
    species_status: &[i32],
    species_charge: &[f64],
    species_elem_offsets: &[u32],
    elem_indices: &[u32],
    elem_counts: &[f64],
    scratch: &mut SideScratch,
) -> SideOut {
    scratch.reset();
    for i in from..to {
        let sp = part_species[i] as usize;
        let c = part_coeff[i];
        if !scratch.seen[sp] {
            scratch.seen[sp] = true;
            scratch.touched.push(sp);
            scratch.sums[sp] = 0.0;
        }
        scratch.sums[sp] += c;
    }

    let mut non_finite = false;
    for &sp in scratch.touched.iter() {
        if !scratch.sums[sp].is_finite() {
            non_finite = true;
        }
    }

    let mut charge = 0.0f64;
    for &sp in scratch.touched.iter() {
        if species_status[sp] != SPECIES_PROVEN {
            continue;
        }
        let coefficient = scratch.sums[sp];
        let lo = species_elem_offsets[sp] as usize;
        let hi = species_elem_offsets[sp + 1] as usize;
        for e in lo..hi {
            let elem = elem_indices[e] as usize;
            let count = elem_counts[e];
            let product = count * coefficient;
            if !scratch.elem_seen[elem] {
                scratch.elem_seen[elem] = true;
                scratch.elem_touched.push(elem);
                scratch.elem_totals[elem] = 0.0;
            }
            let total = scratch.elem_totals[elem] + product;
            scratch.elem_totals[elem] = total;
            if !product.is_finite() || !total.is_finite() {
                non_finite = true;
            }
        }
        let charge_part = species_charge[sp] * coefficient;
        charge += charge_part;
        if !charge_part.is_finite() || !charge.is_finite() {
            non_finite = true;
        }
    }

    let elems = scratch
        .elem_touched
        .iter()
        .map(|&e| (e, scratch.elem_totals[e]))
        .collect();
    SideOut { elems, charge, non_finite }
}

/// Числовое ядро батча аудита стехиометрии (используется
/// WASM-обёрткой, native-тестами и benchmark-бинарником).
#[allow(clippy::too_many_arguments)]
pub fn stoichiometry_batch_impl(
    species_status: &[i32],
    species_charge: &[f64],
    species_elem_offsets: &[u32],
    elem_indices: &[u32],
    elem_counts: &[f64],
    left_offsets: &[u32],
    right_offsets: &[u32],
    part_species: &[u32],
    part_coeff: &[f64],
    tolerance: f64,
    out_flags: &mut [i32],
    out_left_charge: &mut [f64],
    out_right_charge: &mut [f64],
    out_elem_offsets: &mut [u32],
    out_elem_index: &mut [u32],
    out_elem_left: &mut [f64],
    out_elem_right: &mut [f64],
    out_elem_exceeds: &mut [i32],
    out_elem_side: &mut [i32],
) -> i32 {
    let n_species = species_charge.len();
    if species_status.len() != n_species {
        return -1;
    }
    if species_elem_offsets.len() != n_species + 1 {
        return -1;
    }
    if elem_indices.len() != elem_counts.len() {
        return -1;
    }
    if elem_indices.len() != species_elem_offsets[n_species] as usize {
        return -1;
    }
    if left_offsets.is_empty() || right_offsets.len() != left_offsets.len() {
        return -1;
    }
    let n_reactions = left_offsets.len() - 1;
    // Массив участников общий: суммарно left + right.
    let n_participants =
        left_offsets[n_reactions] as usize + right_offsets[n_reactions] as usize;
    if part_species.len() != n_participants || part_coeff.len() != n_participants {
        return -1;
    }
    if right_offsets[n_reactions] as usize != n_participants {
        return -1;
    }
    // Слоты участников и CSR-офсеты обязаны быть в границах:
    // отказ кодом вместо паники при повреждённом пакете.
    for &sp in part_species.iter() {
        if sp as usize >= n_species {
            return -1;
        }
    }
    for w in species_elem_offsets.windows(2) {
        if w[0] > w[1] || w[1] as usize > elem_indices.len() {
            return -1;
        }
    }
    if out_flags.len() != n_reactions
        || out_left_charge.len() != n_reactions
        || out_right_charge.len() != n_reactions
        || out_elem_offsets.len() != n_reactions + 1
    {
        return -2;
    }
    if out_elem_index.len() != out_elem_left.len()
        || out_elem_index.len() != out_elem_right.len()
        || out_elem_index.len() != out_elem_exceeds.len()
        || out_elem_index.len() != out_elem_side.len()
    {
        return -2;
    }

    let n_elements = elem_indices
        .iter()
        .map(|&v| v as usize)
        .max()
        .map(|m| m + 1)
        .unwrap_or(0);
    let mut scratch = SideScratch::new(n_species, n_elements);
    let mut union_seen = vec![false; n_elements];
    let mut union_scratch: Vec<usize> = Vec::with_capacity(32);

    // Локальные накопители union-выхода: точный суммарный размер
    // известен адаптеру, поэтому в конце сверяем и копируем.
    let mut elem_offsets: Vec<u32> = Vec::with_capacity(n_reactions + 1);
    let mut elem_index: Vec<u32> = Vec::new();
    let mut elem_left: Vec<f64> = Vec::new();
    let mut elem_right: Vec<f64> = Vec::new();
    let mut elem_exceeds: Vec<i32> = Vec::new();
    let mut elem_side: Vec<i32> = Vec::new();
    elem_offsets.push(0u32);

    for r in 0..n_reactions {
        let left = process_side(
            left_offsets[r] as usize,
            left_offsets[r + 1] as usize,
            part_species,
            part_coeff,
            species_status,
            species_charge,
            species_elem_offsets,
            elem_indices,
            elem_counts,
            &mut scratch,
        );
        let right = process_side(
            right_offsets[r] as usize,
            right_offsets[r + 1] as usize,
            part_species,
            part_coeff,
            species_status,
            species_charge,
            species_elem_offsets,
            elem_indices,
            elem_counts,
            &mut scratch,
        );

        // Union элементов: сначала все левые (в порядке первого
        // появления), затем новые правые — зеркалит
        // new Set([...Object.keys(left), ...Object.keys(right)]).
        for &(e, _) in left.elems.iter() {
            if !union_seen[e] {
                union_seen[e] = true;
                union_scratch.push(e);
            }
        }
        for &(e, _) in right.elems.iter() {
            if !union_seen[e] {
                union_seen[e] = true;
                union_scratch.push(e);
            }
        }

        let both_finite = !left.non_finite && !right.non_finite;
        let mut flags = 0i32;
        if left.non_finite {
            flags |= FLAG_NONFINITE_LEFT;
        }
        if right.non_finite {
            flags |= FLAG_NONFINITE_RIGHT;
        }

        for &e in union_scratch.iter() {
            let mut lv = 0.0f64;
            let mut rv = 0.0f64;
            let mut l_present = false;
            let mut r_present = false;
            for &(ee, v) in left.elems.iter() {
                if ee == e {
                    lv = v;
                    l_present = true;
                    break;
                }
            }
            for &(ee, v) in right.elems.iter() {
                if ee == e {
                    rv = v;
                    r_present = true;
                    break;
                }
            }
            let exceeds = if both_finite {
                (lv - rv).abs() > tolerance
            } else {
                false
            };
            if exceeds {
                flags |= FLAG_ELEMENT_DIFF;
            }
            let side = if l_present {
                if r_present {
                    SIDE_BOTH
                } else {
                    SIDE_LEFT_ONLY
                }
            } else if r_present {
                SIDE_RIGHT_ONLY
            } else {
                0
            };
            elem_index.push(e as u32);
            elem_left.push(lv);
            elem_right.push(rv);
            elem_exceeds.push(if exceeds { 1 } else { 0 });
            elem_side.push(side);
        }

        if both_finite && (left.charge - right.charge).abs() > tolerance {
            flags |= FLAG_CHARGE_DIFF;
        }

        out_flags[r] = flags;
        out_left_charge[r] = left.charge;
        out_right_charge[r] = right.charge;
        elem_offsets.push(elem_index.len() as u32);

        // Сброс union-скретча.
        for &e in union_scratch.iter() {
            union_seen[e] = false;
        }
        union_scratch.clear();
    }

    if elem_index.len() != out_elem_index.len() {
        return -3;
    }
    out_elem_offsets.copy_from_slice(&elem_offsets);
    out_elem_index.copy_from_slice(&elem_index);
    out_elem_left.copy_from_slice(&elem_left);
    out_elem_right.copy_from_slice(&elem_right);
    out_elem_exceeds.copy_from_slice(&elem_exceeds);
    out_elem_side.copy_from_slice(&elem_side);
    0
}

/// WASM batch API: один вызов на пакет реакций.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn evowars_stoichiometry_batch(
    species_status: &[i32],
    species_charge: &[f64],
    species_elem_offsets: &[u32],
    elem_indices: &[u32],
    elem_counts: &[f64],
    left_offsets: &[u32],
    right_offsets: &[u32],
    part_species: &[u32],
    part_coeff: &[f64],
    tolerance: f64,
    out_flags: &mut [i32],
    out_left_charge: &mut [f64],
    out_right_charge: &mut [f64],
    out_elem_offsets: &mut [u32],
    out_elem_index: &mut [u32],
    out_elem_left: &mut [f64],
    out_elem_right: &mut [f64],
    out_elem_exceeds: &mut [i32],
    out_elem_side: &mut [i32],
) -> i32 {
    stoichiometry_batch_impl(
        species_status,
        species_charge,
        species_elem_offsets,
        elem_indices,
        elem_counts,
        left_offsets,
        right_offsets,
        part_species,
        part_coeff,
        tolerance,
        out_flags,
        out_left_charge,
        out_right_charge,
        out_elem_offsets,
        out_elem_index,
        out_elem_left,
        out_elem_right,
        out_elem_exceeds,
        out_elem_side,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Batch {
        species_status: Vec<i32>,
        species_charge: Vec<f64>,
        species_elem_offsets: Vec<u32>,
        elem_indices: Vec<u32>,
        elem_counts: Vec<f64>,
        left_offsets: Vec<u32>,
        right_offsets: Vec<u32>,
        part_species: Vec<u32>,
        part_coeff: Vec<f64>,
        union_total: usize,
    }

    // Каталог: 0 = H2 (H:2), 1 = O2 (O:2), 2 = H2O (H:2,O:1),
    // 3 = MISSING, 4 = UNPROVEN, 5 = H+ (заряд +1, без элементов).
    fn fixture() -> Batch {
        Batch {
            species_status: vec![0, 0, 0, 1, 2, 0],
            species_charge: vec![0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
            species_elem_offsets: vec![0, 1, 2, 4, 4, 4, 4],
            elem_indices: vec![0, 1, 0, 1],
            elem_counts: vec![2.0, 2.0, 2.0, 1.0],
            left_offsets: vec![0, 2],
            right_offsets: vec![0, 1],
            // Реакция: 2 H2 + O2 -> 2 H2O (участники: слоты/коэф).
            part_species: vec![0, 1, 2],
            part_coeff: vec![2.0, 1.0, 2.0],
            union_total: 2,
        }
    }

    fn run(b: &Batch, tolerance: f64) -> (Vec<i32>, Vec<f64>, Vec<f64>, Vec<u32>, Vec<u32>, Vec<f64>, Vec<f64>, Vec<i32>, Vec<i32>) {
        let n_reactions = b.left_offsets.len() - 1;
        let mut flags = vec![0i32; n_reactions];
        let mut lc = vec![0.0f64; n_reactions];
        let mut rc = vec![0.0f64; n_reactions];
        let mut eo = vec![0u32; n_reactions + 1];
        let mut ei = vec![0u32; b.union_total];
        let mut el = vec![0.0f64; b.union_total];
        let mut er = vec![0.0f64; b.union_total];
        let mut ex = vec![0i32; b.union_total];
        let mut sd = vec![0i32; b.union_total];
        let rc_code = stoichiometry_batch_impl(
            &b.species_status, &b.species_charge, &b.species_elem_offsets,
            &b.elem_indices, &b.elem_counts,
            &b.left_offsets, &b.right_offsets,
            &b.part_species, &b.part_coeff, tolerance,
            &mut flags, &mut lc, &mut rc, &mut eo,
            &mut ei, &mut el, &mut er, &mut ex, &mut sd,
        );
        assert_eq!(rc_code, 0);
        (flags, lc, rc, eo, ei, el, er, ex, sd)
    }

    #[test]
    fn balanced_reaction() {
        let b = fixture();
        let (flags, lc, rc, eo, ei, el, er, ex, sd) = run(&b, 0.0);
        assert_eq!(flags, vec![0]);
        assert_eq!(lc, vec![0.0]);
        assert_eq!(rc, vec![0.0]);
        assert_eq!(eo, vec![0, 2]);
        assert_eq!(ei, vec![0, 1]); // H, O
        assert_eq!(el, vec![4.0, 2.0]);
        assert_eq!(er, vec![4.0, 2.0]);
        assert_eq!(ex, vec![0, 0]);
        assert_eq!(sd, vec![SIDE_BOTH, SIDE_BOTH]);
    }

    #[test]
    fn element_imbalance_detected() {
        let mut b = fixture();
        // Справа 3 H2O: H справа = 6 против 4 слева.
        b.part_coeff = vec![2.0, 1.0, 3.0];
        let (flags, _, _, _, _, el, er, ex, _) = run(&b, 0.0);
        assert_eq!(flags, vec![FLAG_ELEMENT_DIFF]);
        assert_eq!(el, vec![4.0, 2.0]);
        assert_eq!(er, vec![6.0, 3.0]);
        assert_eq!(ex, vec![1, 1]);
    }

    #[test]
    fn charge_imbalance_detected() {
        let mut b = fixture();
        // Слева добавить H+ (слот 5, коэф 1): заряд 1 против 0.
        b.left_offsets = vec![0, 3];
        b.right_offsets = vec![0, 1];
        b.part_species = vec![0, 1, 5, 2];
        b.part_coeff = vec![2.0, 1.0, 1.0, 2.0];
        b.union_total = 2;
        let (flags, lc, rc, _, _, _, _, _, _) = run(&b, 0.0);
        assert_eq!(flags, vec![FLAG_CHARGE_DIFF]);
        assert_eq!(lc, vec![1.0]);
        assert_eq!(rc, vec![0.0]);
    }

    #[test]
    fn overflow_flags_nonfinite() {
        let mut b = fixture();
        // Коэф 1e308 у H2: сумма 2e308 → inf; product H: 2*inf = inf.
        b.part_coeff = vec![1e308, 1.0, 2.0];
        let (flags, _, _, eo, ei, el, _, ex, _) = run(&b, 0.0);
        assert_eq!(flags, vec![FLAG_NONFINITE_LEFT]);
        assert_eq!(eo, vec![0, 2]);
        assert_eq!(ei, vec![0, 1]);
        assert!(!el[0].is_finite());
        assert_eq!(el[1], 2.0);
        // exceeds не вычисляется при non-finite.
        assert_eq!(ex, vec![0, 0]);
    }

    #[test]
    fn missing_and_unproven_species_contribute_nothing() {
        let mut b = fixture();
        // Слева заменить O2 на MISSING-вид (слот 3): O слева нет,
        // но вид участвует в коэффициентных суммах (union: H left,
        // H,O right; элемент O присутствует только справа).
        b.part_species = vec![0, 3, 2];
        b.part_coeff = vec![2.0, 1.0, 2.0];
        let (flags, _, _, eo, ei, el, er, ex, sd) = run(&b, 0.0);
        assert_eq!(flags, vec![FLAG_ELEMENT_DIFF]); // O: 0 слева, 2 справа
        assert_eq!(eo, vec![0, 2]);
        assert_eq!(ei, vec![0, 1]);
        assert_eq!(el, vec![4.0, 0.0]);
        assert_eq!(er, vec![4.0, 2.0]);
        assert_eq!(ex, vec![0, 1]);
        assert_eq!(sd, vec![SIDE_BOTH, SIDE_RIGHT_ONLY]);
    }

    #[test]
    fn tolerance_zero_and_positive() {
        let mut b = fixture();
        // 2H2 + O2 -> 2H2O + 1e-12 H2O: при tolerance=0 →
        // дисбаланс, при tolerance=1e-6 → нет.
        b.right_offsets = vec![0, 1];
        b.part_species = vec![0, 1, 2];
        b.part_coeff = vec![2.0, 1.0, 2.0 + 1e-12];
        let (flags, ..) = run(&b, 0.0);
        assert_eq!(flags, vec![FLAG_ELEMENT_DIFF]);
        let (flags2, ..) = run(&b, 1e-6);
        assert_eq!(flags2, vec![0]);
    }

    #[test]
    fn repeated_species_coefficients_sum() {
        let mut b = fixture();
        // Два участника H2 (коэф 1 и 1) вместо одного с коэф 2:
        // суммирование в порядке участников даёт ту же сумму.
        b.left_offsets = vec![0, 3];
        b.right_offsets = vec![0, 1];
        b.part_species = vec![0, 0, 1, 2];
        b.part_coeff = vec![1.0, 1.0, 1.0, 2.0];
        b.union_total = 2;
        let (flags, _, _, _, _, el, er, ex, _) = run(&b, 0.0);
        assert_eq!(flags, vec![0]);
        assert_eq!(el, vec![4.0, 2.0]);
        assert_eq!(er, vec![4.0, 2.0]);
        assert_eq!(ex, vec![0, 0]);
    }

    #[test]
    fn empty_batch_is_valid() {
        let b = Batch {
            species_status: vec![],
            species_charge: vec![],
            species_elem_offsets: vec![0],
            elem_indices: vec![],
            elem_counts: vec![],
            left_offsets: vec![0],
            right_offsets: vec![0],
            part_species: vec![],
            part_coeff: vec![],
            union_total: 0,
        };
        let (flags, _, _, eo, ei, ..) = run(&b, 0.0);
        assert!(flags.is_empty());
        assert_eq!(eo, vec![0]);
        assert!(ei.is_empty());
    }

    #[test]
    fn abi_length_mismatch_codes() {
        let b = fixture();
        let mut flags = vec![0i32; 1];
        let mut lc = vec![0.0f64; 1];
        let mut rc = vec![0.0f64; 1];
        let mut eo = vec![0u32; 2];
        let mut ei = vec![0u32; b.union_total];
        let mut el = vec![0.0f64; b.union_total];
        let mut er = vec![0.0f64; b.union_total];
        let mut ex = vec![0i32; b.union_total];
        let mut sd = vec![0i32; b.union_total];
        // Неверная длина species_status.
        let mut bad_status = b.species_status.clone();
        bad_status.pop();
        assert_eq!(
            stoichiometry_batch_impl(
                &bad_status, &b.species_charge, &b.species_elem_offsets,
                &b.elem_indices, &b.elem_counts, &b.left_offsets, &b.right_offsets,
                &b.part_species, &b.part_coeff, 0.0,
                &mut flags, &mut lc, &mut rc, &mut eo,
                &mut ei, &mut el, &mut er, &mut ex, &mut sd,
            ),
            -1
        );
        // Неверный размер union-выхода.
        let mut short_ei = vec![0u32; b.union_total - 1];
        let mut short_el = vec![0.0f64; b.union_total - 1];
        let mut short_er = vec![0.0f64; b.union_total - 1];
        let mut short_ex = vec![0i32; b.union_total - 1];
        let mut short_sd = vec![0i32; b.union_total - 1];
        assert_eq!(
            stoichiometry_batch_impl(
                &b.species_status, &b.species_charge, &b.species_elem_offsets,
                &b.elem_indices, &b.elem_counts, &b.left_offsets, &b.right_offsets,
                &b.part_species, &b.part_coeff, 0.0,
                &mut flags, &mut lc, &mut rc, &mut eo,
                &mut short_ei, &mut short_el, &mut short_er, &mut short_ex, &mut short_sd,
            ),
            -3
        );
    }
}
