// ============================================
// RUST REACTION AUDIT — TS-адаптер batch API числового ядра аудита
// Stage H (Rust/WASM Performance Pilot)
// ============================================
//
// Разделение ответственности (Stage H):
// - TypeScript (ЭТОТ адаптер): resolveAuditTolerance,
//   validateReactionRecord, каталог видов, readProvenComposition
//   (доказательность состава), списки missing/unproven/estimated,
//   диагностика (строки дословно из auditReactionStoichiometry),
//   итоговые статусы balanced/imbalanced/approximate/not_verifiable/
//   invalid. Произвольные идентификаторы видов и зарезервированные
//   JS-ключи ('constructor', '__proto__') НЕ передаются в Rust:
//   speciesId и имена элементов мапятся в стабильные числовые
//   индексы уже здесь;
// - Rust (reaction_audit.rs): числовое ядро — суммирование
//   коэффициентов, элементных вкладов и заряда, детекция
//   переполнения, разности с tolerance. Rust не может считать
//   неизвестный состав нулевым (missing/unproven помечены статусами
//   входа и исключены из накопления) и не может скрыть переполнение
//   (флаги non-finite → not_verifiable).
//
// ## ABI (см. rust/evowars-sim-core/src/reaction_audit.rs)
// Входы: species_status 0/1/2, species_charge, CSR-офсеты состава
// видов (elem_indices/elem_counts), CSR-офсеты участников
// (left_offsets/right_offsets → part_species/part_coeff), tolerance.
// Выходы: out_flags (биты 1/2/4/8), заряды сторон, CSR-таблица union
// элементов: индексы, суммы слева/справа, exceeds 0/1, биты
// присутствия (1=слева, 2=справа). Суммарный размер union адаптер
// вычисляет при упаковке и аллоцирует выходы точно; ядро сверяет.

import type { ReactionRecord, ReactionStoichiometryAudit } from '../Core/reactionLedger';
import {
  resolveAuditTolerance,
  validateReactionRecord
} from '../Core/reactionLedger';
import type { ScientificSpecies, SpeciesCatalog } from '../Core/species';
import type { RustSimCoreWasm } from './rustSimCore';

/**
 * Реплика приватной readProvenComposition из reactionLedger.ts
 * (того же файла, НЕ экспортированной): доказательность состава —
 * dataStatus known/estimated, целый заряд, plain-запись элементов
 * (прототип Object.prototype или null — Map/Date/RegExp/массивы
 * НЕ считаются составом), непустые ключи-строки, значения —
 * неотрицательные целые. Пустая запись {} легитимна (электрон).
 * Эквивалентность реплики нативу охраняется parity-тестами
 * (rustWasmParity.test.ts) на полных аудитах.
 */
function readProvenComposition(species: ScientificSpecies): Record<string, number> | null {
  if (species.dataStatus !== 'known' && species.dataStatus !== 'estimated') {
    return null;
  }
  if (!Number.isInteger(species.charge)) {
    return null;
  }
  const raw: unknown = species.elements;
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) {
    return null;
  }
  for (const [element, count] of Object.entries(raw)) {
    if (element.trim() === '' || !Number.isInteger(count) || count < 0) {
      return null;
    }
  }
  return raw as Record<string, number>;
}

const SPECIES_PROVEN = 0;
const SPECIES_MISSING = 1;
const SPECIES_UNPROVEN = 2;

const FLAG_NONFINITE_LEFT = 1;
const FLAG_NONFINITE_RIGHT = 2;
const FLAG_ELEMENT_DIFF = 4;
const FLAG_CHARGE_DIFF = 8;
const SIDE_LEFT_BIT = 1;
const SIDE_RIGHT_BIT = 2;

/** Слот вида: стабильный числовой индекс вместо произвольного идентификатора. */
interface SpeciesSlot {
  status: 0 | 1 | 2;
  estimated: boolean;
  charge: number;
  /** Элементные записи: [глобальный индекс элемента, число атомов]. */
  entries: Array<[number, number]>;
}

/** Агрегированная сторона одной записи (для списков TS). */
interface SideAggregation {
  /** speciesId в порядке первого появления (как Map в нативе). */
  speciesOrder: string[];
}

export interface PackedStoichiometryBatch {
  speciesStatus: Int32Array;
  speciesCharge: Float64Array;
  speciesElemOffsets: Uint32Array;
  elemIndices: Uint32Array;
  elemCounts: Float64Array;
  leftOffsets: Uint32Array;
  rightOffsets: Uint32Array;
  partSpecies: Uint32Array;
  partCoeff: Float64Array;
  tolerance: number;
  /** Проблема некорректного tolerance (если была) — все аудиты invalid. */
  toleranceProblem: string | null;
  expectedUnionTotal: number;
  outFlags: Int32Array;
  outLeftCharge: Float64Array;
  outRightCharge: Float64Array;
  outElemOffsets: Uint32Array;
  outElemIndex: Uint32Array;
  outElemLeft: Float64Array;
  outElemRight: Float64Array;
  outElemExceeds: Int32Array;
  outElemSide: Int32Array;
  /** Индексы валидных записей (попали в kernel-батч). */
  validIndices: number[];
  /** Имя элемента по глобальному индексу. */
  elementNames: string[];
  /** Для каждой kernel-записи: агрегация сторон для списков TS. */
  sides: Array<{ left: SideAggregation; right: SideAggregation }>;
  /** Слот вида по speciesId. */
  slotStatusById: Map<string, { status: 0 | 1 | 2; estimated: boolean }>;
}

/** Разобранный пакет: аудиты по индексам исходных записей. */

function emptyAudit(): ReactionStoichiometryAudit {
  return {
    status: 'not_verifiable',
    formIssues: [],
    elementIssues: [],
    chargeIssues: [],
    missingSpecies: [],
    unprovenSpecies: [],
    estimatedSpecies: [],
    reactantElements: {},
    productElements: {},
    reactantCharge: 0,
    productCharge: 0,
    diagnostics: []
  };
}

/**
 * Упаковка пакета аудита: валидация записей, разрешение tolerance,
 * слоты видов, глобальные индексы элементов, CSR-таблицы участников
 * и ТОЧНЫЙ суммарный размер union-выхода. Не вызывает WASM.
 */
export function packStoichiometryBatch(
  records: readonly ReactionRecord[],
  catalog: SpeciesCatalog,
  options?: { tolerance?: number }
): PackedStoichiometryBatch {
  const { tolerance, problem: toleranceProblem } = resolveAuditTolerance(options?.tolerance);

  const slotById = new Map<string, number>();
  const slotStatusById = new Map<string, { status: 0 | 1 | 2; estimated: boolean }>();
  const slots: SpeciesSlot[] = [];
  const elementIndex = new Map<string, number>();
  const elementNames: string[] = [];

  const resolveSlot = (speciesId: string): number => {
    const known = slotById.get(speciesId);
    if (known !== undefined) {
      return known;
    }
    const slotIndex = slots.length;
    slotById.set(speciesId, slotIndex);
    const species: ScientificSpecies | null = catalog.get(speciesId);
    if (species === null) {
      slots.push({ status: SPECIES_MISSING, estimated: false, charge: 0, entries: [] });
      slotStatusById.set(speciesId, { status: SPECIES_MISSING, estimated: false });
      return slotIndex;
    }
    const composition = readProvenComposition(species);
    if (composition === null) {
      slots.push({ status: SPECIES_UNPROVEN, estimated: false, charge: 0, entries: [] });
      slotStatusById.set(speciesId, { status: SPECIES_UNPROVEN, estimated: false });
      return slotIndex;
    }
    const estimated = species.dataStatus === 'estimated';
    const entries: Array<[number, number]> = [];
    for (const [element, count] of Object.entries(composition)) {
      let idx = elementIndex.get(element);
      if (idx === undefined) {
        idx = elementNames.length;
        elementNames.push(element);
        elementIndex.set(element, idx);
      }
      entries.push([idx, count]);
    }
    slots.push({ status: SPECIES_PROVEN, estimated, charge: species.charge, entries });
    slotStatusById.set(speciesId, { status: SPECIES_PROVEN, estimated });
    return slotIndex;
  };

  // Накопители CSR состава видов (заполняются лениво ниже).
  const speciesElemOffsets: number[] = [0];
  const elemIndices: number[] = [];
  const elemCounts: number[] = [];

  // Участники по валидным записям. CSR состава видов собирается
  // лениво: слоты добавляются по мере обхода участников.
  const validIndices: number[] = [];
  const sides: Array<{ left: SideAggregation; right: SideAggregation }> = [];
  const leftOffsetsNum: number[] = [0];
  const rightOffsetsNum: number[] = [0];
  const partSpecies: number[] = [];
  const partCoeff: number[] = [];
  let unionTotal = 0;

  /** Пересборка CSR состава видов после добавления новых слотов. */
  const rebuildSpeciesCsr = (): void => {
    speciesElemOffsets.length = 0;
    speciesElemOffsets.push(0);
    elemIndices.length = 0;
    elemCounts.length = 0;
    for (const slot of slots) {
      for (const [idx, count] of slot.entries) {
        elemIndices.push(idx);
        elemCounts.push(count);
      }
      speciesElemOffsets.push(elemIndices.length);
    }
  };

  const aggregateSide = (participants: readonly { speciesId: string }[]): SideAggregation => {
    // Порядок суммирования коэффициентов = порядок участников; порядок
    // видов = первое появление (зеркалит Map в нативном side()).
    const order: string[] = [];
    const seen = new Set<string>();
    for (const p of participants) {
      if (!seen.has(p.speciesId)) {
        seen.add(p.speciesId);
        order.push(p.speciesId);
      }
    }
    return { speciesOrder: order };
  };

  for (let r = 0; r < records.length; r++) {
    const record = records[r];
    const formIssues = validateReactionRecord(record);
    if (formIssues.length > 0 || toleranceProblem !== null) {
      // Невалидные записи (или некорректный tolerance) не попадают
      // в kernel-батч: их аудиты собираются в TS (как в нативе).
      continue;
    }
    validIndices.push(r);
    // Слоты всех участников (до записи офсетов).
    const leftSlots: Array<{ slot: number; coeff: number }> = [];
    for (const p of record.reactants) {
      leftSlots.push({ slot: resolveSlot(p.speciesId), coeff: p.coefficient });
    }
    const rightSlots: Array<{ slot: number; coeff: number }> = [];
    for (const p of record.products) {
      rightSlots.push({ slot: resolveSlot(p.speciesId), coeff: p.coefficient });
    }
    // Слоты могли добавиться: пересобрать CSR состава видов.
    if (speciesElemOffsets.length !== slots.length + 1) {
      rebuildSpeciesCsr();
    }
    // Участники слева.
    for (const p of leftSlots) {
      partSpecies.push(p.slot);
      partCoeff.push(p.coeff);
    }
    leftOffsetsNum.push(partSpecies.length);
    // Участники справа.
    for (const p of rightSlots) {
      partSpecies.push(p.slot);
      partCoeff.push(p.coeff);
    }
    rightOffsetsNum.push(partSpecies.length);

    // Точный размер union по proven-видам (как ядро).
    const unionHere = new Set<number>();
    for (const p of leftSlots) {
      const slot = slots[p.slot];
      if (slot.status === SPECIES_PROVEN) {
        for (const [idx] of slot.entries) {
          unionHere.add(idx);
        }
      }
    }
    for (const p of rightSlots) {
      const slot = slots[p.slot];
      if (slot.status === SPECIES_PROVEN) {
        for (const [idx] of slot.entries) {
          unionHere.add(idx);
        }
      }
    }
    unionTotal += unionHere.size;

    sides.push({
      left: aggregateSide(record.reactants),
      right: aggregateSide(record.products)
    });
  }

  const nSpecies = slots.length;
  const nReactions = validIndices.length;
  return {
    speciesStatus: Int32Array.from(slots.map((s) => s.status)),
    speciesCharge: Float64Array.from(slots.map((s) => s.charge)),
    speciesElemOffsets: Uint32Array.from(speciesElemOffsets),
    elemIndices: Uint32Array.from(elemIndices),
    elemCounts: Float64Array.from(elemCounts),
    leftOffsets: Uint32Array.from(leftOffsetsNum),
    rightOffsets: Uint32Array.from(rightOffsetsNum),
    partSpecies: Uint32Array.from(partSpecies),
    partCoeff: Float64Array.from(partCoeff),
    tolerance,
    toleranceProblem,
    expectedUnionTotal: unionTotal,
    outFlags: new Int32Array(nReactions),
    outLeftCharge: new Float64Array(nReactions),
    outRightCharge: new Float64Array(nReactions),
    outElemOffsets: new Uint32Array(nReactions + 1),
    outElemIndex: new Uint32Array(unionTotal),
    outElemLeft: new Float64Array(unionTotal),
    outElemRight: new Float64Array(unionTotal),
    outElemExceeds: new Int32Array(unionTotal),
    outElemSide: new Int32Array(unionTotal),
    validIndices,
    elementNames,
    sides,
    slotStatusById
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Сборка аудита kernel-записи из выходов Rust (дерево решений нативного auditReactionStoichiometry). */
function buildKernelAudit(
  packed: PackedStoichiometryBatch,
  kernelIndex: number
): ReactionStoichiometryAudit {
  const audit = emptyAudit();
  const flags = packed.outFlags[kernelIndex];
  const tolerance = packed.tolerance;

  // reactantElements/productElements: собственные суммы сторон
  // (Object.fromEntries по данным union с битами присутствия —
  // как safeElementsRecord в нативе, включая '__proto__'-ключи).
  const from = packed.outElemOffsets[kernelIndex];
  const to = packed.outElemOffsets[kernelIndex + 1];
  // Object.fromEntries (как safeElementsRecord в нативе): even
  // зарезервированные ключи ('__proto__') создаются как own-свойства.
  const leftEntries: Array<[string, number]> = [];
  const rightEntries: Array<[string, number]> = [];
  for (let e = from; e < to; e++) {
    const name = packed.elementNames[packed.outElemIndex[e]];
    const sideBits = packed.outElemSide[e];
    if ((sideBits & SIDE_LEFT_BIT) !== 0) {
      leftEntries.push([name, packed.outElemLeft[e]]);
    }
    if ((sideBits & SIDE_RIGHT_BIT) !== 0) {
      rightEntries.push([name, packed.outElemRight[e]]);
    }
  }
  audit.reactantElements = Object.fromEntries(leftEntries);
  audit.productElements = Object.fromEntries(rightEntries);
  audit.reactantCharge = packed.outLeftCharge[kernelIndex];
  audit.productCharge = packed.outRightCharge[kernelIndex];

  // Списки missing/unproven/estimated — из агрегации TS (та же
  // семантика, что у нативного side(): порядок первого появления
  // вида, левая сторона раньше правой, сквозная дедупликация).
  const sideInfo = packed.sides[kernelIndex];
  const missing: string[] = [];
  const unproven: string[] = [];
  const estimated: string[] = [];
  for (const side of [sideInfo.left, sideInfo.right]) {
    for (const speciesId of side.speciesOrder) {
      const status = packed.slotStatusById.get(speciesId);
      if (status === undefined) {
        continue;
      }
      if (status.status === SPECIES_MISSING) {
        missing.push(speciesId);
      } else if (status.status === SPECIES_UNPROVEN) {
        unproven.push(speciesId);
      } else if (status.estimated) {
        estimated.push(speciesId);
      }
    }
  }
  audit.missingSpecies = dedupe(missing);
  audit.unprovenSpecies = dedupe(unproven);
  audit.estimatedSpecies = dedupe(estimated);

  const nonFinite = (flags & FLAG_NONFINITE_LEFT) !== 0 || (flags & FLAG_NONFINITE_RIGHT) !== 0;
  if (nonFinite) {
    audit.status = 'not_verifiable';
    audit.diagnostics.push(
      'численная проверка невозможна: в промежуточных итогах состава/заряда NaN или Infinity (переполнение произведения/суммирования при конечных входных числах) — проблема вычислимости, а не физического баланса'
    );
    if (audit.missingSpecies.length > 0) {
      audit.diagnostics.push('вид(ы) не зарегистрированы в каталоге — вклад неизвестен: ' + audit.missingSpecies.join(', '));
    }
    if (audit.unprovenSpecies.length > 0) {
      audit.diagnostics.push('описание состава непроверяемо (статус данных или форма состава): ' + audit.unprovenSpecies.join(', '));
    }
    return audit;
  }

  // Частичные расхождения по проверяемым видам.
  const elementIssues: string[] = [];
  for (let e = from; e < to; e++) {
    if (packed.outElemExceeds[e] !== 0) {
      const name = packed.elementNames[packed.outElemIndex[e]];
      const a = packed.outElemLeft[e];
      const b = packed.outElemRight[e];
      elementIssues.push('элемент «' + name + '»: ' + a + ' слева против ' + b + ' справа');
    }
  }
  if ((flags & FLAG_CHARGE_DIFF) !== 0) {
    audit.chargeIssues.push('заряд: ' + audit.reactantCharge + ' слева против ' + audit.productCharge + ' справа');
  }
  audit.elementIssues = elementIssues;

  if (audit.missingSpecies.length > 0) {
    audit.diagnostics.push('вид(ы) не зарегистрированы в каталоге — вклад неизвестен: ' + audit.missingSpecies.join(', '));
  }
  if (audit.unprovenSpecies.length > 0) {
    audit.diagnostics.push('описание состава непроверяемо (статус данных или форма состава): ' + audit.unprovenSpecies.join(', '));
  }

  if (audit.missingSpecies.length > 0 || audit.unprovenSpecies.length > 0) {
    audit.status = 'not_verifiable';
    if (audit.elementIssues.length > 0 || audit.chargeIssues.length > 0) {
      audit.diagnostics.push('расхождения вычислены только по видам с проверяемым составом: ' + [...audit.elementIssues, ...audit.chargeIssues].join('; '));
    }
    return audit;
  }
  if (audit.elementIssues.length > 0 || audit.chargeIssues.length > 0) {
    audit.status = 'imbalanced';
    audit.diagnostics.push(...audit.elementIssues, ...audit.chargeIssues);
    return audit;
  }
  if (audit.estimatedSpecies.length > 0) {
    audit.status = 'approximate';
    audit.diagnostics.push('баланс численно согласован, но состав оценочный (dataStatus estimated): ' + audit.estimatedSpecies.join(', '));
    return audit;
  }
  audit.status = 'balanced';
  return audit;
}

/**
 * Вызов WASM-ядра на упакованном пакете и сборка аудитов.
 * Невалидные записи и некорректный tolerance обрабатываются в TS
 * (как в нативе). Бросает только при отказе самого ABI.
 */
export function runStoichiometryBatch(
  core: RustSimCoreWasm,
  packed: PackedStoichiometryBatch,
  records: readonly ReactionRecord[]
): ReactionStoichiometryAudit[] {
  const rc = core.evowars_stoichiometry_batch(
    packed.speciesStatus,
    packed.speciesCharge,
    packed.speciesElemOffsets,
    packed.elemIndices,
    packed.elemCounts,
    packed.leftOffsets,
    packed.rightOffsets,
    packed.partSpecies,
    packed.partCoeff,
    packed.tolerance,
    packed.outFlags,
    packed.outLeftCharge,
    packed.outRightCharge,
    packed.outElemOffsets,
    packed.outElemIndex,
    packed.outElemLeft,
    packed.outElemRight,
    packed.outElemExceeds,
    packed.outElemSide
  );
  if (rc !== 0) {
    throw new Error(`Rust stoichiometry batch ABI error: ${rc}`);
  }
  const results: ReactionStoichiometryAudit[] = new Array(records.length);
  const validSet = new Set(packed.validIndices);
  let kernelIndex = 0;
  for (let r = 0; r < records.length; r++) {
    if (!validSet.has(r)) {
      // Запись не попала в kernel-батч: некорректный tolerance
      // (как в нативе — возвращается ДО проверки формы) либо запись
      // не проходит валидацию формы. Дерево решений нативное.
      const audit = emptyAudit();
      audit.status = 'invalid';
      if (packed.toleranceProblem !== null) {
        audit.formIssues.push(packed.toleranceProblem);
        audit.diagnostics.push('некорректный tolerance: ' + packed.toleranceProblem);
        results[r] = audit;
        continue;
      }
      const formIssues = validateReactionRecord(records[r]);
      audit.formIssues = formIssues;
      audit.diagnostics.push('запись не проходит валидацию формы: ' + formIssues.join('; '));
      results[r] = audit;
      continue;
    }
    results[r] = buildKernelAudit(packed, kernelIndex);
    kernelIndex++;
  }
  return results;
}

/**
 * Полный batch-путь: упаковка → один вызов WASM → распаковка.
 * Аудиты по индексам эквивалентны нативному auditReactionStoichiometry.
 */
export function auditReactionStoichiometryRustBatch(
  core: RustSimCoreWasm,
  records: readonly ReactionRecord[],
  catalog: SpeciesCatalog,
  options?: { tolerance?: number }
): ReactionStoichiometryAudit[] {
  const packed = packStoichiometryBatch(records, catalog, options);
  return runStoichiometryBatch(core, packed, records);
}
