// ============================================
// PENG–ROBINSON — фасад каталога над VLE FLASH вычислителем Core
// ============================================
//
// Stage 4.4.4.6 (архитектурная граница Core/Data, паттерн
// Data/pengRobinsonMixtureFacade.ts Stage 4.4.4.3).
//
// Разделение ответственности:
// - Core/pengRobinsonFlash.ts — ЧИСТАЯ математика изотермо-изобарного
//   двухфазного VLE flash (Wilson K, Рачфорд–Райс, последовательные
//   замены K с демпфированием, TPD-скрининг); импортов из Data НЕ имеет;
// - этот фасад (Data) — валидация состава и уникальности gasId, поиск
//   чистокомпонентных параметров по gasId в каталоге Stage 4.4.4.1
//   (getEosPureComponentParameters, fail-closed), поиск ВСЕХ необходимых
//   пар kij в каталоге Stage 4.4.4.3 (getBinaryInteractionParameter,
//   fail-closed: unresolved-пара даёт ЯВНЫЙ отказ, kij = 0 молча НЕ
//   подставляется), передача параметров и evidence в Core flash и
//   прикрепление provenance чистых параметров и всех использованных kij
//   к успешному результату.
//
// Направление зависимостей: Data -> Core (обратно запрещено).
//
// Честность источников сохраняется без изменений: ограничения
// источников, диапазоны применимости kij и evidence-статусы
// передаются как есть в Core и в provenance. Ограниченная
// применимость BIP (например, CO2-содержащие пары каталога
// верифицированы только в 228.15–273.15 K для CO2-rich смесей,
// а для n2-ar точный диапазон не верифицирован — null) НЕ скрывается:
// она отражается в kijUsed/warnings результата Core и в provenance.
// Никакой статус доказанности не повышается (PARTIALLY_VERIFIED остаётся
// PARTIALLY_VERIFIED). Фасад НЕ дублирует математику PR.

import { getEosPureComponentParameters, EosParametersError } from './eosParameters';
import type {
  EosPureComponentGasId,
  EosPureComponentParameters,
  EosScalarParameter
} from './eosParameters';

import { getBinaryInteractionParameter, BinaryInteractionError } from './binaryInteractionParameters';
import type {
  BinaryInteractionApplicability,
  BinaryInteractionAvailableRecord
} from './binaryInteractionParameters';

import { computePengRobinsonFlash } from '../Core/pengRobinsonFlash';
import type {
  PengRobinsonFlashFailure,
  PengRobinsonFlashTwoPhaseCandidate
} from '../Core/pengRobinsonFlash';
import type {
  PengRobinsonBinaryInteractionInput,
  PengRobinsonEvidencePolicy,
  PengRobinsonMixtureComponentInput,
  PengRobinsonMixtureInputs
} from '../Core/pengRobinsonMixture';

// ============================================
// 1. ТИПЫ ПУБЛИЧНОГО API (gasId-ВЕРСИЯ FLASH)
// ============================================

/** Компонент feed по gasId с мольной долей. */
export interface PengRobinsonFlashCompositionEntry {
  readonly gasId: string;
  readonly moleFraction: number;
}

/**
 * Запрос к VLE flash через каталоги: состав (gasId + мольные доли,
 * сумма = 1 в допуске, молчаливая нормализация НЕ выполняется), T, P,
 * ЯВНАЯ политика доказанности и опциональные параметры сходимости
 * (передаются в Core flash без изменений).
 */
export interface PengRobinsonFlashCatalogRequest {
  readonly composition: readonly PengRobinsonFlashCompositionEntry[];
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
  readonly maxIterations?: number;
  readonly fugacityTolerance?: number;
  readonly stabilityScreening?: boolean;
}

/** Provenance чистых параметров компонента feed (каталог 4.4.4.1). */
export interface PengRobinsonFlashComponentProvenance {
  readonly gasId: EosPureComponentGasId;
  readonly criticalTemperatureK: EosScalarParameter;
  readonly criticalPressurePa: EosScalarParameter;
  readonly acentricFactor: EosScalarParameter;
}

/** Provenance использованного бинарного параметра (каталог 4.4.4.3). */
export interface PengRobinsonFlashBinaryProvenance {
  readonly pairKey: string;
  readonly kij: EosScalarParameter;
  readonly applicabilityRangeK: Readonly<BinaryInteractionApplicability> | null;
}

/**
 * Успешный результат: кандидат равновесия Core (stability НИКОГДА не
 * 'stable') плюс provenance-скаляры каталогов 4.4.4.1 (чистые
 * параметры) и 4.4.4.3 (kij) — та же замороженная структура, без
 * копирования.
 */
export interface PengRobinsonFlashCatalogSuccess extends PengRobinsonFlashTwoPhaseCandidate {
  readonly componentParameters: readonly PengRobinsonFlashComponentProvenance[];
  readonly binaryInteractionParameters: readonly PengRobinsonFlashBinaryProvenance[];
}

/** Discriminated union результата фасада flash. */
export type PengRobinsonFlashCatalogResult =
  | PengRobinsonFlashCatalogSuccess
  | PengRobinsonFlashFailure;

// ============================================
// 2. ФАСАД: СОСТАВ -> КАТАЛОГИ -> FLASH CORE
// ============================================

/**
 * Запись каталога 4.4.4.1 -> компонентные входы Core. Значения и
 * статусы уже проверены lookup'ом (валидация записи каталога);
 * crossChecks/limitations передаются по ссылке (каталог глубоко
 * заморожен).
 */
function toComponentInput(
  record: EosPureComponentParameters,
  moleFraction: number
): PengRobinsonMixtureComponentInput {
  return {
    component: record.gasId,
    moleFraction,
    criticalTemperatureK: record.criticalTemperatureK.value,
    criticalPressurePa: record.criticalPressurePa.value,
    acentricFactor: record.acentricFactor.value,
    evidence: {
      criticalTemperatureK: record.criticalTemperatureK.provenance.evidence,
      criticalPressurePa: record.criticalPressurePa.provenance.evidence,
      acentricFactor: record.acentricFactor.provenance.evidence
    },
    crossChecks: record.crossChecks,
    limitations: record.limitations
  };
}

/** Доступная запись каталога kij -> вход Core. */
function toBinaryInteractionInput(
  record: BinaryInteractionAvailableRecord
): PengRobinsonBinaryInteractionInput {
  return {
    componentA: record.componentA,
    componentB: record.componentB,
    kij: record.kij.value,
    evidence: record.kij.provenance.evidence,
    applicabilityRangeK: record.applicabilityRangeK
  };
}

function facadeFailure(code: PengRobinsonFlashFailure['code'], message: string, detail?: string): PengRobinsonFlashFailure {
  return detail === undefined ? { status: 'failure', code, message } : { status: 'failure', code, message, detail };
}

/**
 * Изотермо-изобарный двухфазный VLE flash Peng–Robinson для смесей
 * co2/n2/ch4/h2o/ar через каталоги Stage 4.4.4.1 (чистые параметры) и
 * Stage 4.4.4.3 (kij).
 *
 * Контракт состава: непустой массив записей {gasId, moleFraction} с
 * УНИКАЛЬНЫМИ gasId; детальная валидация долей (конечные, в [0, 1),
 * сумма = 1 в допуске, нулевые доли = отсутствие компонента, не менее
 * двух активных) — в Core flash. Для каждой пары компонентов с
 * ПОЛОЖИТЕЛЬНЫМИ долями требуется запись kij: unresolved-пара — ЯВНЫЙ
 * отказ missing_binary_interaction (kij = 0 молча НЕ подставляется).
 * Диапазоны применимости kij и политика evidence гейтятся в Core
 * без ослабления. Успех — two_phase_candidate с полным provenance;
 * verdict 'stable' не предусмотрен ни в Core, ни здесь.
 */
export function computePengRobinsonFlashFromCatalog(
  request: PengRobinsonFlashCatalogRequest
): PengRobinsonFlashCatalogResult {
  // --- Валидация формы запроса ---
  if (typeof request !== 'object' || request === null) {
    return facadeFailure('invalid_input', 'запрос обязан быть непустым объектом');
  }
  const { temperatureK, pressurePa } = request;
  if (typeof temperatureK !== 'number' || !Number.isFinite(temperatureK) || temperatureK <= 0) {
    return facadeFailure('invalid_input', 'temperatureK обязан быть конечным положительным числом');
  }
  if (typeof pressurePa !== 'number' || !Number.isFinite(pressurePa) || pressurePa <= 0) {
    return facadeFailure('invalid_input', 'pressurePa обязан быть конечным положительным числом');
  }
  const policy = request.evidencePolicy;
  if (policy !== 'verified_only' && policy !== 'allow_partial' && policy !== 'allow_unresolved_cross_check') {
    return facadeFailure(
      'invalid_input',
      'evidencePolicy обязана быть одной из: verified_only, allow_partial, allow_unresolved_cross_check'
    );
  }

  // --- Валидация формы состава и уникальности gasId ---
  if (!Array.isArray(request.composition) || request.composition.length === 0) {
    return facadeFailure(
      'invalid_input',
      'composition обязан быть непустым массивом записей {gasId, moleFraction}; каталоги: co2, n2, ch4, h2o, ar (h2 исключён)'
    );
  }
  for (const entry of request.composition) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as Record<string, unknown>).gasId !== 'string' ||
      ((entry as Record<string, unknown>).gasId as string).trim() === ''
    ) {
      return facadeFailure('invalid_input', 'каждая запись состава обязана быть объектом {gasId: непустая строка, moleFraction: число}');
    }
    const fraction = (entry as Record<string, unknown>).moleFraction;
    if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
      return facadeFailure(
        'invalid_input',
        'moleFraction компонента «' + String((entry as Record<string, unknown>).gasId) + '» обязан быть конечным числом'
      );
    }
  }
  const seenGasIds = new Set<string>();
  for (const entry of request.composition) {
    if (seenGasIds.has(entry.gasId)) {
      return facadeFailure(
        'invalid_input',
        'компонент «' + entry.gasId + '» встречается в составе более одного раза: состав обязан содержать уникальные компоненты (доли агрегируются вызывающим кодом заранее, нормализации нет)'
      );
    }
    seenGasIds.add(entry.gasId);
  }

  // --- Lookup чистокомпонентных параметров (fail-closed) ---
  const componentRecords: { record: EosPureComponentParameters; moleFraction: number }[] = [];
  for (const entry of request.composition) {
    let record: EosPureComponentParameters;
    try {
      record = getEosPureComponentParameters(entry.gasId);
    } catch (error) {
      if (error instanceof EosParametersError) {
        if (error.code === 'unknown_gas') {
          return facadeFailure(
            'invalid_input',
            error.message,
            'компонент вне каталога Stage 4.4.4.1 не поддерживается PR flash; h2 исключён обоснованно (см. provenance каталога)'
          );
        }
        return facadeFailure('invalid_input', error.message, error.issues.join('; '));
      }
      throw error;
    }
    componentRecords.push({ record, moleFraction: entry.moleFraction });
  }

  // --- Lookup ВСЕХ пар kij для компонентов с положительными долями ---
  // Fail-closed: unresolved-пара — ЯВНЫЙ отказ, kij = 0 НЕ подставляется.
  const binaryRecords: BinaryInteractionAvailableRecord[] = [];
  for (let i = 0; i < componentRecords.length; i += 1) {
    for (let j = i + 1; j < componentRecords.length; j += 1) {
      if (componentRecords[i]!.moleFraction <= 0 || componentRecords[j]!.moleFraction <= 0) {
        continue; // нулевые доли не образуют взаимодействий (x_i * x_j = 0)
      }
      let binaryRecord: BinaryInteractionAvailableRecord;
      try {
        binaryRecord = getBinaryInteractionParameter(
          componentRecords[i]!.record.gasId,
          componentRecords[j]!.record.gasId
        );
      } catch (error) {
        if (error instanceof BinaryInteractionError) {
          if (error.code === 'unresolved_binary_interaction') {
            return facadeFailure('missing_binary_interaction', error.message, error.pairKey);
          }
          if (error.code === 'unknown_gas') {
            return facadeFailure('invalid_input', error.message, error.pairKey);
          }
          if (error.code === 'same_component_pair') {
            return facadeFailure('invalid_input', error.message, error.pairKey);
          }
          return facadeFailure('invalid_input', error.message, error.issues.join('; '));
        }
        throw error;
      }
      binaryRecords.push(binaryRecord);
    }
  }

  // --- Сборка входов Core (evidence per-field из provenance каталогов) ---
  const inputs: PengRobinsonMixtureInputs = {
    components: componentRecords.map((c) => toComponentInput(c.record, c.moleFraction)),
    binaryInteractions: binaryRecords.map(toBinaryInteractionInput)
  };

  const coreResult = computePengRobinsonFlash({
    mixtureInputs: inputs,
    request: {
      temperatureK,
      pressurePa,
      evidencePolicy: policy,
      ...(request.maxIterations === undefined ? {} : { maxIterations: request.maxIterations }),
      ...(request.fugacityTolerance === undefined ? {} : { fugacityTolerance: request.fugacityTolerance }),
      ...(request.stabilityScreening === undefined ? {} : { stabilityScreening: request.stabilityScreening })
    }
  });
  if (coreResult.status === 'failure') {
    return coreResult;
  }

  // --- Provenance-скаляры каталогов (та же замороженная структура) ---
  return {
    ...coreResult,
    componentParameters: componentRecords.map((c) => ({
      gasId: c.record.gasId as EosPureComponentGasId,
      criticalTemperatureK: c.record.criticalTemperatureK,
      criticalPressurePa: c.record.criticalPressurePa,
      acentricFactor: c.record.acentricFactor
    })),
    binaryInteractionParameters: binaryRecords.map((b) => ({
      pairKey:
        b.componentA < b.componentB
          ? b.componentA + '|' + b.componentB
          : b.componentB + '|' + b.componentA,
      kij: b.kij,
      applicabilityRangeK: b.applicabilityRangeK
    }))
  };
}

// ============================================
// 3. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Фасад НЕ содержит математики PR и НЕ расширяет систему provenance:
// все provenance-объекты принадлежат каталогам Stage 4.4.4.1 и
// 4.4.4.3. Коды отказов, политики и семантика устойчивости объявлены
// в Core/pengRobinsonFlash.ts (единый источник).
