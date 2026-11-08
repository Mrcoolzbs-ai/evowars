// ============================================
// WORKLOADS — детерминированные нагрузки Rust/WASM benchmark
// Stage H (Rust/WASM Performance Pilot)
// ============================================
//
// Генераторы workload для сравнительного benchmark
// (scripts/benchmarks/rust-wasm-benchmark.bench.ts).
//
// КЛЮЧЕВОЕ СВОЙСТВО: один и тот же детерминированный PRNG
// (mulberry32) и один и тот же порядок вызовов rand() в тех же
// формулах, что и в Rust-бинарнике
// rust/evowars-sim-core/src/bin/evowars_bench.rs. Поэтому
// TypeScript-нагрузка, WASM-нагрузка и native Rust-нагрузка
// построены из одного потока псевдослучайных чисел. Различия
// возможны только на уровне ulp (Math.pow vs f64::powf между
// платформами) — на распределение и объём нагрузки они не влияют.

import type {
  ArrheniusParameters,
  FallOffParameters,
  KineticReactionRecord,
  RateConstantEvaluationOptions,
  RateConstantUnit
} from '../../src/modules/Core/kinetics';
import type { RateConstantData } from '../../src/modules/Core/kinetics';
import { quantity } from '../../src/modules/Core/physicalQuantity';
import type { PhysicalQuantity } from '../../src/modules/Core/physicalQuantity';
import type { ReactionRecord } from '../../src/modules/Core/reactionLedger';
import { createSpeciesCatalog } from '../../src/modules/Core/species';
import type { ScientificSpecies, SpeciesCatalog } from '../../src/modules/Core/species';

/** mulberry32: идентичные биты с Rust-реализацией (wrapping u32). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINETICS_SEED = 0x12345678;
const STOICH_SEED = 0x9abcdef0;

function benchProvenance(): { sourceName: string; method: string } {
  return {
    sourceName: 'синтетический benchmark workload (Stage H)',
    method: 'детерминированный генератор mulberry32 (фикция, не данные)'
  };
}

export interface KineticsWorkload {
  records: KineticReactionRecord[];
  temperatures: PhysicalQuantity[];
  options: Array<RateConstantEvaluationOptions | undefined>;
}

/**
 * Кинетическая нагрузка: ~25% fall-off записей, обе формы
 * энергетического параметра, разброс A/n/E/T/M. Порядок вызовов
 * rand() зеркалит build_kinetics_params в evowars_bench.rs.
 */
export function buildKineticsWorkload(n: number): KineticsWorkload {
  const rand = mulberry32(KINETICS_SEED);
  const records: KineticReactionRecord[] = [];
  const temperatures: PhysicalQuantity[] = [];
  const options: Array<RateConstantEvaluationOptions | undefined> = [];
  const arrheniusUnit: RateConstantUnit = 'cm3_per_molecule_per_s';
  const lowUnit: RateConstantUnit = 'cm6_per_molecule2_per_s';

  const mkArrhenius = (a: number, nExp: number, useEa: boolean, energy: number): ArrheniusParameters => ({
    preExponentialA: a,
    temperatureExponentN: nExp,
    energy: useEa
      ? { form: 'Ea_J_mol', valueJPerMol: energy }
      : { form: 'E_over_R', valueK: energy },
    temperatureRangeK: { min: 200, max: 2000 },
    unit: arrheniusUnit,
    provenance: benchProvenance()
  });

  for (let i = 0; i < n; i++) {
    const isFallOff = i % 4 === 0;
    const useEa = i % 2 === 0;
    const a = 10 ** (-12 + 6 * rand());
    const nExp = 3 * (rand() - 1);
    const energy = 6000 * (rand() - 0.3);
    const t = 250 + 1500 * rand();
    let rateConstant: RateConstantData;
    if (isFallOff) {
      const a0 = 10 ** (-32 + 4 * rand());
      const aInf = 10 ** (-12 + 4 * rand());
      const fc = 0.2 + 0.7 * rand();
      const nb = 0.5 + rand();
      const m = 10 ** (17 + 5 * rand());
      const lo: ArrheniusParameters = {
        ...mkArrhenius(a0, nExp, useEa, energy),
        unit: lowUnit
      };
      const hi = mkArrhenius(aInf, nExp, useEa, energy);
      const fallOff: FallOffParameters = {
        lowPressureLimit: lo,
        highPressureLimit: hi,
        centeringFactorFc: fc,
        broadeningN: nb,
        provenance: benchProvenance()
      };
      rateConstant = { status: 'known', parameters: { kind: 'fall_off', fallOff } };
      options.push({ thirdBodyConcentration: m });
    } else {
      rateConstant = {
        status: 'known',
        parameters: { kind: 'arrhenius', arrhenius: mkArrhenius(a, nExp, useEa, energy) }
      };
      options.push(undefined);
    }
    records.push({
      id: `bench-k${i}`,
      kind: 'elementary',
      overallOrder: 2,
      concentrationModel: 'molecule_cm3',
      rateConstant,
      provenance: benchProvenance()
    });
    temperatures.push(quantity(t, 'K'));
  }
  return { records, temperatures, options };
}

const STOICH_N_SPECIES = 26;

/** Состав слота вида: паттерн index % 7 (зеркалит species_composition в evowars_bench.rs). */
function benchComposition(index: number): Record<string, number> {
  switch (index % 7) {
    case 0: return { H: 2 };
    case 1: return { O: 2 };
    case 2: return { H: 2, O: 1 };
    case 3: return { C: 1, O: 2 };
    case 4: return { C: 1, H: 4 };
    case 5: return { N: 2 };
    default: return { H: 1, S: 1, C: 6 };
  }
}

export interface StoichWorkload {
  catalog: SpeciesCatalog;
  records: ReactionRecord[];
}

/**
 * Стехиометрическая нагрузка: 26 видов, реакции по 2-4 участника
 * на сторону, целые коэффициенты 1-3, половина реакций
 * сбалансированного стиля A → A. Порядок вызовов rand()
 * зеркалит build_stoich_buffers в evowars_bench.rs.
 */
export function buildStoichiometryWorkload(n: number): StoichWorkload {
  const rand = mulberry32(STOICH_SEED);
  const catalog = createSpeciesCatalog();
  const speciesIds: string[] = [];
  for (let s = 0; s < STOICH_N_SPECIES; s++) {
    const species: ScientificSpecies = {
      id: `bench-s${s}`,
      formula: `Bs${s}`,
      elements: benchComposition(s),
      charge: s >= STOICH_N_SPECIES - 2 ? 1 : 0,
      phase: s >= STOICH_N_SPECIES - 2 ? 'aqueous' : 'gas',
      molarMassKgMol: null,
      molarMassStatus: 'unknown',
      dataStatus: 'known'
    };
    catalog.register(species);
    speciesIds.push(species.id);
  }

  const records: ReactionRecord[] = [];
  for (let r = 0; r < n; r++) {
    const balanced = rand() < 0.5;
    const nReactants = 2 + Math.floor(rand() * 3);
    const usedLeft = new Set<string>();
    const reactants: Array<{ reservoirId: string; speciesId: string; coefficient: number }> = [];
    for (let k = 0; k < nReactants; k++) {
      const slot = Math.floor(rand() * STOICH_N_SPECIES);
      const coeff = 1 + Math.floor(rand() * 3);
      if (usedLeft.has(speciesIds[slot])) {
        continue;
      }
      usedLeft.add(speciesIds[slot]);
      reactants.push({ reservoirId: 'atm', speciesId: speciesIds[slot], coefficient: coeff });
    }
    let products: Array<{ reservoirId: string; speciesId: string; coefficient: number }>;
    if (balanced) {
      products = reactants.map((p) => ({ reservoirId: 'out', speciesId: p.speciesId, coefficient: p.coefficient }));
    } else {
      const nProducts = 2 + Math.floor(rand() * 3);
      const usedRight = new Set<string>();
      products = [];
      for (let k = 0; k < nProducts; k++) {
        const slot = Math.floor(rand() * STOICH_N_SPECIES);
        const coeff = 1 + Math.floor(rand() * 3);
        if (usedRight.has(speciesIds[slot])) {
          continue;
        }
        usedRight.add(speciesIds[slot]);
        products.push({ reservoirId: 'out', speciesId: speciesIds[slot], coefficient: coeff });
      }
    }
    records.push({
      id: `bench-r${r}`,
      reactionId: 'bench-reaction',
      reactants,
      products,
      extent: 1,
      extentBasis: 'amount',
      time: { segmentIndex: 0, localTimeS: 0 }
    });
  }
  return { catalog, records };
}
