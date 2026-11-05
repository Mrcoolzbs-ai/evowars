// ============================================
// PENG–ROBINSON — фасад каталога над СМЕСЕВЫМ вычислителем Core
// ============================================
//
// Stage 4.4.4.3 (архитектурная граница Core/Data, паттерн
// Stage 4.4.4.2.1 Data/pengRobinsonFacade.ts).
//
// Разделение ответственности:
// - Core/pengRobinsonMixture.ts — ЧИСТАЯ математика PR смесей
//   (правила смешения, кубика смеси, компонентные ln(phi_i), phi_i,
//   f_i); импортов из Data НЕ имеет;
// - этот фасад (Data) — валидация состава, поиск чистокомпонентных
//   параметров по gasId в каталоге Stage 4.4.4.1
//   (getEosPureComponentParameters, fail-closed), поиск бинарных
//   параметров взаимодействия в каталоге Stage 4.4.4.3
//   (getBinaryInteractionParameter, fail-closed: unresolved-пары
//   дают ЯВНЫЙ отказ, kij = 0 молча НЕ подставляется), маппинг
//   записей каталога в входы Core (evidence per-field, диапазоны
//   применимости kij) и прикрепление ТОГО ЖЕ замороженного
//   provenance-дерева каталогов к успешному результату.
//
// Направление зависимостей: Data -> Core (обратно запрещено).
//
// Границы Stage 4.4.4.3: flash, VLE/LLE, фазовая устойчивость,
// PPR78, конденсированные фазы и интеграция с solveEquilibrium
// НЕ реализованы; выбор ветви кубики — математический выбор, не
// доказательство устойчивости фазы.

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

import {
  computePengRobinsonMixture,
  validatePengRobinsonMixtureRequest
} from '../Core/pengRobinsonMixture';
import type {
  PengRobinsonBinaryInteractionInput,
  PengRobinsonEvidencePolicy,
  PengRobinsonMixtureComponentInput,
  PengRobinsonMixtureFailure,
  PengRobinsonMixtureInputs,
  PengRobinsonMixtureRequest,
  PengRobinsonMixtureResult,
  PengRobinsonMixtureSuccess,
  PengRobinsonRootBranch
} from '../Core/pengRobinsonMixture';

// ============================================
// 1. ТИПЫ ПУБЛИЧНОГО API (gasId-ВЕРСИЯ)
// ============================================

/** Компонент смеси по gasId с мольной долей. */
export interface PengRobinsonMixtureCompositionEntry {
  readonly gasId: string;
  readonly moleFraction: number;
}

/**
 * Запрос к смесевому вычислителю PR через каталоги: состав (gasId +
 * мольные доли, сумма = 1 в допуске, молчаливая нормализация НЕ
 * выполняется), T, P, ветвь и ЯВНАЯ политика доказанности.
 */
export interface PengRobinsonMixtureCatalogRequest {
  readonly composition: readonly PengRobinsonMixtureCompositionEntry[];
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: PengRobinsonRootBranch;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
}

/** Provenance чистых параметров компонента смеси (каталог 4.4.4.1). */
export interface PengRobinsonMixtureComponentProvenance {
  readonly gasId: EosPureComponentGasId;
  readonly criticalTemperatureK: EosScalarParameter;
  readonly criticalPressurePa: EosScalarParameter;
  readonly acentricFactor: EosScalarParameter;
}

/** Provenance бинарного параметра взаимодействия (каталог 4.4.4.3). */
export interface PengRobinsonMixtureBinaryProvenance {
  readonly pairKey: string;
  readonly kij: EosScalarParameter;
  readonly applicabilityRangeK: Readonly<BinaryInteractionApplicability> | null;
}

/**
 * Успешный результат: результат Core плюс provenance-скаляры
 * каталогов 4.4.4.1 (чистые параметры) и 4.4.4.3 (kij) — та же
 * замороженная структура, без копирования.
 */
export interface PengRobinsonMixtureCatalogSuccess extends PengRobinsonMixtureSuccess {
  readonly componentParameters: readonly PengRobinsonMixtureComponentProvenance[];
  readonly binaryInteractionParameters: readonly PengRobinsonMixtureBinaryProvenance[];
}

/** Discriminated union результата фасада. */
export type PengRobinsonMixtureCatalogResult =
  | PengRobinsonMixtureCatalogSuccess
  | PengRobinsonMixtureFailure;

// ============================================
// 2. ФАСАД: СОСТАВ -> КАТАЛОГИ -> ВЫЧИСЛИТЕЛЬ CORE
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

/**
 * Смесевой вычислитель Peng–Robinson для co2/n2/ch4/h2o/ar через
 * каталоги Stage 4.4.4.1 (чистые параметры) и Stage 4.4.4.3 (kij):
 * a_mix/b_mix, кубика смеси, компонентные phi_i и f_i = x_i phi_i P.
 *
 * Контракт состава: непустой массив уникальных gasId с конечными
 * неотрицательными долями, сумма = 1 в допуске (молчаливой
 * нормализации нет — отклонение = отказ invalid_composition). Для
 * каждой пары компонентов с ПОЛОЖИТЕЛЬНЫМИ долями требуется
 * подтверждённая запись kij: пара unknown/unresolved из аудита
 * 4.4.4.3 (ar|ch4, ar|h2o, ch4|h2o, ch4|n2, co2|h2o) — ЯВНЫЙ отказ
 * missing_binary_interaction (kij = 0 молча НЕ подставляется).
 * Диапазоны применимости kij проверяются по T (отказ
 * binary_interaction_applicability за пределами верифицированного
 * диапазона). Успех никогда не содержит NaN/Infinity.
 */
export function computePengRobinsonMixtureFromCatalog(
  request: PengRobinsonMixtureCatalogRequest
): PengRobinsonMixtureCatalogResult {
  // --- Валидация запроса (T, P, ветвь, политика) ---
  const requestFailure = validatePengRobinsonMixtureRequest({
    temperatureK: request.temperatureK,
    pressurePa: request.pressurePa,
    root: request.root,
    evidencePolicy: request.evidencePolicy
  });
  if (requestFailure !== null) {
    return requestFailure;
  }

  // --- Валидация формы состава (детальная валидация долей — в Core) ---
  if (!Array.isArray(request.composition) || request.composition.length === 0) {
    return {
      status: 'failure',
      code: 'invalid_composition',
      message:
        'composition должен быть непустым массива записей {gasId, moleFraction}; ' +
        'каталоги: co2, n2, ch4, h2o, ar (h2 исключён)'
    };
  }
  for (const entry of request.composition) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof (entry as Record<string, unknown>).gasId !== 'string' ||
      ((entry as Record<string, unknown>).gasId as string).trim() === ''
    ) {
      return {
        status: 'failure',
        code: 'invalid_composition',
        message: 'каждая запись состава должна быть объектом {gasId: непустая строка, moleFraction: число}'
      };
    }
    if (typeof (entry as Record<string, unknown>).moleFraction !== 'number') {
      return {
        status: 'failure',
        code: 'invalid_composition',
        message: `moleFraction компонента «${String((entry as Record<string, unknown>).gasId)}» должен быть числом`
      };
    }
  }
  // Уникальность gasId: дублированный компонент — invalid_composition
  // (проверка ДО lookup параметров и kij; доли обязаны быть агрегированы
  // вызывающим кодом заранее — слияния дублей и нормализации нет).
  const seenGasIds = new Set<string>();
  for (const entry of request.composition) {
    if (seenGasIds.has(entry.gasId)) {
      return {
        status: 'failure',
        code: 'invalid_composition',
        message:
          `компонент «${entry.gasId}» встречается в составе более одного раза: ` +
          `состав должен содержать уникальные компоненты (дублирование не допускается; ` +
          `доли обязаны быть агрегированы заранее, нормализации нет)`
      };
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
          return {
            status: 'failure',
            code: 'unknown_component',
            message: error.message,
            detail:
              `компонент вне каталога Stage 4.4.4.1 не поддерживается смесевым PR; ` +
              `h2 исключён обоснованно (см. provenance каталога)`
          };
        }
        return {
          status: 'failure',
          code: 'invalid_parameters',
          message: error.message,
          detail: error.issues.join('; ')
        };
      }
      throw error;
    }
    componentRecords.push({ record, moleFraction: entry.moleFraction });
  }

  // --- Lookup бинарных параметров для пар с положительными долями ---
  const binaryRecords: BinaryInteractionAvailableRecord[] = [];
  for (let i = 0; i < componentRecords.length; i += 1) {
    for (let j = i + 1; j < componentRecords.length; j += 1) {
      if (
        componentRecords[i].moleFraction <= 0 ||
        componentRecords[j].moleFraction <= 0
      ) {
        continue; // нулевые доли не образуют взаимодействий (x_i x_j = 0)
      }
      let binaryRecord: BinaryInteractionAvailableRecord;
      try {
        binaryRecord = getBinaryInteractionParameter(
          componentRecords[i].record.gasId,
          componentRecords[j].record.gasId
        );
      } catch (error) {
        if (error instanceof BinaryInteractionError) {
          if (error.code === 'unresolved_binary_interaction') {
            return {
              status: 'failure',
              code: 'missing_binary_interaction',
              message: error.message,
              detail: error.pairKey
            };
          }
          if (error.code === 'unknown_gas') {
            return {
              status: 'failure',
              code: 'unknown_component',
              message: error.message,
              detail: error.pairKey
            };
          }
          if (error.code === 'same_component_pair') {
            return {
              status: 'failure',
              code: 'invalid_composition',
              message: error.message,
              detail: error.pairKey
            };
          }
          return {
            status: 'failure',
            code: 'invalid_parameters',
            message: error.message,
            detail: error.issues.join('; ')
          };
        }
        throw error;
      }
      binaryRecords.push(binaryRecord);
    }
  }

  // --- Сборка входов Core (evidence per-field из provenance) ---
  const inputs: PengRobinsonMixtureInputs = {
    components: componentRecords.map((c) => toComponentInput(c.record, c.moleFraction)),
    binaryInteractions: binaryRecords.map(toBinaryInteractionInput)
  };
  const coreRequest: PengRobinsonMixtureRequest = {
    temperatureK: request.temperatureK,
    pressurePa: request.pressurePa,
    root: request.root,
    evidencePolicy: request.evidencePolicy
  };

  const core: PengRobinsonMixtureResult = computePengRobinsonMixture(inputs, coreRequest);
  if (core.status === 'failure') {
    return core;
  }

  // --- Provenance-скаляры каталогов (та же замороженная структура) ---
  const success: PengRobinsonMixtureSuccess = core;
  return {
    ...success,
    componentParameters: componentRecords.map((c) => ({
      gasId: c.record.gasId as EosPureComponentGasId,
      criticalTemperatureK: c.record.criticalTemperatureK,
      criticalPressurePa: c.record.criticalPressurePa,
      acentricFactor: c.record.acentricFactor
    })),
    binaryInteractionParameters: binaryRecords.map((b) => ({
      pairKey: `${b.componentA < b.componentB ? b.componentA : b.componentB}|${b.componentA < b.componentB ? b.componentB : b.componentA}`,
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
// 4.4.4.3. Коды отказов и политики объявлены в
// Core/pengRobinsonMixture.ts (единый источник).
