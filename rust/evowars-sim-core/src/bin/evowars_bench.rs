//! evowars_bench — native Rust benchmark для Stage H.
//!
//! Тот же детерминированный workload (mulberry32 LCG), что и в
//! scripts/benchmarks/rust-wasm-benchmark.bench.ts (TS-сторона):
//! формулы генерации идентичны, различия возможны только на уровне
//! ulp из-за различий libm между платформами. Результаты native
//! Rust публикуются ОТДЕЛЬНЫМ измерением и НЕ выдаются за
//! производительность браузерного WASM.
//!
//! Использование:
//! ```text
//! evowars_bench --scenario kinetics|stoich --ops <N> --json
//! ```
//!
//! Протокол зеркалит TS-бенчмарк: 3 прогрева, затем >= 10 выборок,
//! каждая выборка повторяет полный workload до накопления >= 40 мс
//! (чтобы малые нагрузки не тонули в шуме таймера), статистика
//! median/p95 по длительности одного прогона workload.

use evowars_sim_core::kinetics::{kinetics_batch_impl, DIAG_STRIDE, KIN_STRIDE};
use evowars_sim_core::reaction_audit::stoichiometry_batch_impl;
use std::time::Instant;

struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    fn new(seed: u32) -> Self {
        Mulberry32 { state: seed }
    }
    fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B79F5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(1 | t);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t));
        t = t ^ (t >> 14);
        (t as f64) / 4294967296.0
    }
}

fn build_kinetics_params(n: usize) -> Vec<f64> {
    // Зеркалит buildKineticsWorkload в scripts/benchmarks/workloads.ts.
    let mut rng = Mulberry32::new(0x1234_5678);
    let mut params = Vec::with_capacity(n * KIN_STRIDE);
    for i in 0..n {
        let is_fall_off = i % 4 == 0;
        let use_ea = i % 2 == 0;
        let a = 10f64.powf(-12.0 + 6.0 * rng.next());
        let n_exp = 3.0 * (rng.next() - 1.0);
        let energy = 6000.0 * (rng.next() - 0.3);
        let t = 250.0 + 1500.0 * rng.next();
        let energy_form = if use_ea { 1.0 } else { 0.0 };
        if is_fall_off {
            let a0 = 10f64.powf(-32.0 + 4.0 * rng.next());
            let a_inf = 10f64.powf(-12.0 + 4.0 * rng.next());
            let fc = 0.2 + 0.7 * rng.next();
            let nb = 0.5 + rng.next();
            let m = 10f64.powf(17.0 + 5.0 * rng.next());
            params.extend_from_slice(&[
                1.0, t, m, a0, n_exp, energy_form, energy, 200.0, 2000.0, a_inf, n_exp,
                energy_form, energy, 200.0, 2000.0, fc, nb,
            ]);
        } else {
            params.extend_from_slice(&[
                0.0, t, 0.0, a, n_exp, energy_form, energy, 200.0, 2000.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0, 0.0,
            ]);
        }
    }
    params
}

struct StoichBuffers {
    species_status: Vec<i32>,
    species_charge: Vec<f64>,
    species_elem_offsets: Vec<u32>,
    elem_indices: Vec<u32>,
    elem_counts: Vec<f64>,
    left_offsets: Vec<u32>,
    right_offsets: Vec<u32>,
    part_species: Vec<u32>,
    part_coeff: Vec<f64>,
    tolerance: f64,
    union_total: usize,
    out_flags: Vec<i32>,
    out_left_charge: Vec<f64>,
    out_right_charge: Vec<f64>,
    out_elem_offsets: Vec<u32>,
    out_elem_index: Vec<u32>,
    out_elem_left: Vec<f64>,
    out_elem_right: Vec<f64>,
    out_elem_exceeds: Vec<i32>,
    out_elem_side: Vec<i32>,
}

const BENCH_ELEMENTS: [&str; 5] = ["H", "O", "C", "N", "S"];

fn species_composition(index: usize) -> Vec<(usize, f64)> {
    // Детерминированный состав по слоту: 2-3 элемента из 5.
    match index % 7 {
        0 => vec![(0, 2.0)],                                   // H2
        1 => vec![(1, 2.0)],                                   // O2
        2 => vec![(0, 2.0), (1, 1.0)],                         // H2O
        3 => vec![(2, 1.0), (1, 2.0)],                         // CO2
        4 => vec![(2, 1.0), (0, 4.0)],                         // CH4
        5 => vec![(3, 2.0)],                                   // N2
        _ => vec![(0, 1.0), (4, 1.0), (2, 6.0)],               // C6H6S-подобный
    }
}

fn build_stoich_buffers(n: usize) -> StoichBuffers {
    // Зеркалит buildStoichiometryWorkload в scripts/benchmarks/workloads.ts.
    let n_species = 26usize;
    let mut rng = Mulberry32::new(0x9ABC_DEF0);
    let mut elem_entries: Vec<(u32, f64)> = Vec::new();
    let mut species_elem_offsets = Vec::with_capacity(n_species + 1);
    let mut species_charge = Vec::new();
    for s in 0..n_species {
        species_elem_offsets.push(elem_entries.len() as u32);
        for (e, c) in species_composition(s) {
            elem_entries.push((e as u32, c));
        }
        species_charge.push(if s >= n_species - 2 { 1.0 } else { 0.0 });
    }
    species_elem_offsets.push(elem_entries.len() as u32);
    let elem_indices: Vec<u32> = elem_entries.iter().map(|&(e, _)| e).collect();
    let elem_counts: Vec<f64> = elem_entries.iter().map(|&(_, c)| c).collect();
    let species_status = vec![0i32; n_species];

    let mut left_offsets = Vec::with_capacity(n + 1);
    let mut right_offsets = Vec::with_capacity(n + 1);
    let mut part_species: Vec<u32> = Vec::new();
    let mut part_coeff: Vec<f64> = Vec::new();
    let mut union_total: usize = 0;
    left_offsets.push(0);
    right_offsets.push(0);
    for _ in 0..n {
        // Правило генерации зеркалит buildStoichiometryWorkload
        // в scripts/benchmarks/workloads.ts (одни и те же вызовы
        // LCG в том же порядке); слоты уникальны внутри стороны,
        // чтобы форма записи была валидна и для TS-пути.
        let balanced = rng.next() < 0.5;
        let n_reactants = 2 + (rng.next() * 3.0) as usize; // 2..4
        let left_start = part_species.len();
        let mut used: Vec<usize> = Vec::new();
        for r in 0..n_reactants {
            let slot = (rng.next() * n_species as f64) as usize;
            let coeff = 1.0 + (rng.next() * 3.0) as u32 as f64;
            if used.contains(&slot) {
                continue; // слот уже на этой стороне (форма записи)
            }
            used.push(slot);
            part_species.push(slot as u32);
            part_coeff.push(coeff);
        }
        left_offsets.push(part_species.len() as u32);

        let mut seen_elems: Vec<usize> = Vec::new();
        for j in left_start..part_species.len() {
            for (e, _) in species_composition(part_species[j] as usize) {
                if !seen_elems.contains(&e) {
                    seen_elems.push(e);
                }
            }
        }
        let mut union_here = seen_elems.len();

        if balanced {
            // Сбалансированный стиль: продукты = те же участники.
            let products: Vec<(u32, f64)> = part_species[left_start..]
                .iter()
                .zip(part_coeff[left_start..].iter())
                .map(|(&s, &c)| (s, c))
                .collect();
            for (slot, coeff) in products {
                part_species.push(slot);
                part_coeff.push(coeff);
            }
        } else {
            let n_products = 2 + (rng.next() * 3.0) as usize;
            let mut used_right: Vec<usize> = Vec::new();
            for _p in 0..n_products {
                let slot = (rng.next() * n_species as f64) as usize;
                let coeff = 1.0 + (rng.next() * 3.0) as u32 as f64;
                if used_right.contains(&slot) {
                    continue;
                }
                used_right.push(slot);
                part_species.push(slot as u32);
                part_coeff.push(coeff);
                for (e, _) in species_composition(slot) {
                    if !seen_elems.contains(&e) {
                        seen_elems.push(e);
                        union_here += 1;
                    }
                }
            }
        }
        right_offsets.push(part_species.len() as u32);
        union_total += union_here;
    }

    StoichBuffers {
        species_status,
        species_charge,
        species_elem_offsets,
        elem_indices,
        elem_counts,
        left_offsets,
        right_offsets,
        part_species,
        part_coeff,
        tolerance: 0.0,
        union_total,
        out_flags: Vec::new(),
        out_left_charge: Vec::new(),
        out_right_charge: Vec::new(),
        out_elem_offsets: Vec::new(),
        out_elem_index: Vec::new(),
        out_elem_left: Vec::new(),
        out_elem_right: Vec::new(),
        out_elem_exceeds: Vec::new(),
        out_elem_side: Vec::new(),
    }
}

impl StoichBuffers {
    fn allocate_outputs(&mut self, n_reactions: usize) {
        self.out_flags = vec![0i32; n_reactions];
        self.out_left_charge = vec![0.0f64; n_reactions];
        self.out_right_charge = vec![0.0f64; n_reactions];
        self.out_elem_offsets = vec![0u32; n_reactions + 1];
        self.out_elem_index = vec![0u32; self.union_total];
        self.out_elem_left = vec![0.0f64; self.union_total];
        self.out_elem_right = vec![0.0f64; self.union_total];
        self.out_elem_exceeds = vec![0i32; self.union_total];
        self.out_elem_side = vec![0i32; self.union_total];
    }
}

const WARMUP_RUNS: usize = 3;
const MIN_SAMPLE_MS: usize = 40;
const SAMPLES: usize = 12;

fn measure<F: FnMut()>(mut run_once: F) -> (f64, f64, f64) {
    for _ in 0..WARMUP_RUNS {
        run_once();
    }
    let mut durations: Vec<f64> = Vec::with_capacity(SAMPLES);
    for _ in 0..SAMPLES {
        let start = Instant::now();
        let mut iterations = 0usize;
        loop {
            run_once();
            iterations += 1;
            let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
            if elapsed_ms >= MIN_SAMPLE_MS as f64 || iterations >= 1000 {
                durations.push(elapsed_ms / iterations as f64);
                break;
            }
        }
    }
    durations.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = durations[durations.len() / 2];
    let p95_index = ((durations.len() as f64 * 0.95).ceil() as usize).clamp(1, durations.len()) - 1;
    let p95 = durations[p95_index];
    (median, p95, 1000.0 / median)
}

fn median_p95_json(median_ms: f64, p95_ms: f64, ops_per_sec: f64) -> String {
    format!(
        "{{\"medianMs\":{:.6},\"p95Ms\":{:.6},\"opsPerSec\":{:.3}}}",
        median_ms, p95_ms, ops_per_sec
    )
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let scenario = arg_or(&args, "--scenario", "kinetics");
    let ops: usize = arg_or(&args, "--ops", "10000").parse().expect("--ops must be an integer");
    let json = args.iter().any(|a| a == "--json");

    match scenario.as_str() {
        "kinetics" => {
            let params = build_kinetics_params(ops);
            let n = params.len() / KIN_STRIDE;
            let mut out_k = vec![0.0f64; n];
            let mut out_diag = vec![0.0f64; n * DIAG_STRIDE];
            let mut out_status = vec![0i32; n];
            let rc = kinetics_batch_impl(&params, &mut out_k, &mut out_diag, &mut out_status);
            assert_eq!(rc, 0, "kinetics ABI error");
            let ok_count = out_status.iter().filter(|&&s| s == 0).count();
            let (median, p95, ops_per_sec) = measure(|| {
                let rc = kinetics_batch_impl(&params, &mut out_k, &mut out_diag, &mut out_status);
                debug_assert_eq!(rc, 0);
            });
            if json {
                println!(
                    "{{\"scenario\":\"kinetics\",\"ops\":{},\"okCount\":{},\"median\":{}}}",
                    ops, ok_count, median_p95_json(median, p95, ops_per_sec)
                );
            } else {
                println!(
                    "kinetics: {} ops, {} ok, median {:.3} ms, p95 {:.3} ms, {:.0} ops/s",
                    ops, ok_count, median, p95, ops_per_sec
                );
            }
        }
        "stoich" => {
            let mut b = build_stoich_buffers(ops);
            let n_reactions = b.left_offsets.len() - 1;
            b.allocate_outputs(n_reactions);
            let rc = stoichiometry_batch_impl(
                &b.species_status, &b.species_charge, &b.species_elem_offsets,
                &b.elem_indices, &b.elem_counts, &b.left_offsets, &b.right_offsets,
                &b.part_species, &b.part_coeff, b.tolerance,
                &mut b.out_flags, &mut b.out_left_charge, &mut b.out_right_charge,
                &mut b.out_elem_offsets, &mut b.out_elem_index, &mut b.out_elem_left,
                &mut b.out_elem_right, &mut b.out_elem_exceeds, &mut b.out_elem_side,
            );
            assert_eq!(rc, 0, "stoichiometry ABI error");
            let flags_snapshot = b.out_flags.clone();
            let balanced_count = flags_snapshot.iter().filter(|&&f| f == 0).count();
            let (median, p95, ops_per_sec) = measure(|| {
                let rc = stoichiometry_batch_impl(
                    &b.species_status, &b.species_charge, &b.species_elem_offsets,
                    &b.elem_indices, &b.elem_counts, &b.left_offsets, &b.right_offsets,
                    &b.part_species, &b.part_coeff, b.tolerance,
                    &mut b.out_flags, &mut b.out_left_charge, &mut b.out_right_charge,
                    &mut b.out_elem_offsets, &mut b.out_elem_index, &mut b.out_elem_left,
                    &mut b.out_elem_right, &mut b.out_elem_exceeds, &mut b.out_elem_side,
                );
                debug_assert_eq!(rc, 0);
            });
            if json {
                println!(
                    "{{\"scenario\":\"stoich\",\"ops\":{},\"balancedCount\":{},\"median\":{}}}",
                    ops, balanced_count, median_p95_json(median, p95, ops_per_sec)
                );
            } else {
                println!(
                    "stoich: {} reactions, {} balanced, median {:.3} ms, p95 {:.3} ms, {:.0} ops/s",
                    ops, balanced_count, median, p95, ops_per_sec
                );
            }
        }
        other => {
            eprintln!("unknown scenario: {other}");
            std::process::exit(2);
        }
    }
}

fn arg_or(args: &[String], name: &str, default: &str) -> String {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == name {
            if let Some(v) = it.next() {
                return v.clone();
            }
        }
    }
    default.to_string()
}
