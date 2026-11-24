// ============================================
// PENG–ROBINSON — фасад каталога над вычислителем Core
// ============================================
//
// Stage 4.4.4.2.1 (архитектурная граница Core/Data).
//
// CORE_SCIENTIFIC_ENGINE.md: зависимости между слоями ацикличны, и
// фундаментальное ядро (Core) не получает runtime из слоя данных —
// слой данных строит каталог ПОВЕРХ контрактов Core (паттерн Stage
// 4.3.2). До этой ревизии Core/pengRobinson.ts сам импортировал
// getEosPureComponentParameters и EosParametersError из
// Data/eosParameters.ts, а eosParameters.ts импортирует
// validateUncertainty из Core — это создавало цикл Core -> Data ->
// Core и заставляло фундаментальную математику зависеть от каталога.
//
// Разделение ответственности (ревизия 4.4.4.2.1):
// - Core/pengRobinson.ts — ЧИСТАЯ математика PR: принимает уже
//   валидированные параметры и evidence (PengRobinsonComponentInputs,
//   computePengRobinsonFromComponent); импортов из Data НЕ имеет;
// - этот фасад (Data) — поиск по gasId в каталоге Stage 4.4.4.1
//   (fail-closed: unknown_gas / invalid_catalog_record), маппинг записи
//   каталога в компонентные входы Core, вызов вычислителя и
//   прикрепление ТОГО ЖЕ (замороженного) provenance-дерева каталога
//   (per-field EosScalarParameter) к успешному результату.
//
// Публичный API сохранён: computePengRobinsonPure(request) с тем же
// контрактом и кодами отказов, что и до ревизии 4.4.4.2.1.
//
// Границы: смеси/kij/flash — 4.4.4.3+; конденсированные фазы и
// интеграция с solveEquilibrium — вне объёма подэтапа.

import { getEosPureComponentParameters, EosParametersError } from './eosParameters';
import type {
  EosPureComponentGasId,
  EosPureComponentParameters,
  EosScalarParameter
} from './eosParameters';

import {
  computePengRobinsonFromComponent,
  validatePengRobinsonComponentRequest
} from '../Core/pengRobinson';
import type {
  PengRobinsonComponentFailure,
  PengRobinsonComponentInputs,
  PengRobinsonComponentResult,
  PengRobinsonComponentSuccess,
  PengRobinsonEvidencePolicy,
  PengRobinsonRootBranch
} from '../Core/pengRobinson';

// ============================================
// 1. ТИПЫ ПУБЛИЧНОГО API (gasId-ВЕРСИЯ)
// ============================================

/**
 * Запрос к чистокомпонентному вычислителю PR через каталог. Политика
 * доказанности обязательна (её отсутствие — отказ invalid_input).
 */
export interface PengRobinsonPureRequest {
  readonly gasId: string;
  readonly temperatureK: number;
  readonly pressurePa: number;
  readonly root: PengRobinsonRootBranch;
  readonly evidencePolicy: PengRobinsonEvidencePolicy;
}

/**
 * Успешный результат: результат Core плюс provenance-скаляры каталога
 * (ТО ЖЕ замороженное per-field дерево Stage 4.4.4.1 — идентичность
 * объектов сохраняется) и уточнённый gasId.
 */
export interface PengRobinsonPureSuccess extends PengRobinsonComponentSuccess {
  readonly gasId: EosPureComponentGasId;
  readonly criticalTemperatureK: EosScalarParameter;
  readonly criticalPressurePa: EosScalarParameter;
  readonly acentricFactor: EosScalarParameter;
}

/** Отказ: устойчивый код + диагностика (контракт Core). */
export type PengRobinsonPureFailure = PengRobinsonComponentFailure;

/** Discriminated union результата. */
export type PengRobinsonPureResult = PengRobinsonPureSuccess | PengRobinsonPureFailure;

// ============================================
// 2. ФАСАД: LOOKUP КАТАЛОГА + ВЫЧИСЛИТЕЛЬ CORE
// ============================================

/**
 * Запись каталога -> валидированные компонентные входы Core. Значения
 * и статусы уже проверены lookup'ом (validateEosPureComponentRecord);
 * маппинг структурный: crossChecks/limitations передаются по ссылке
 * (каталог глубоко заморожен — мутация невозможна).
 */
function toComponentInputs(record: EosPureComponentParameters): PengRobinsonComponentInputs {
  return {
    gasId: record.gasId,
    formula: record.formula,
    name: record.name,
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

/**
 * Чистокомпонентный вычислитель Peng–Robinson для co2/n2/ch4/h2o/ar
 * из каталога Stage 4.4.4.1: Z, phi и фугативность.
 *
 * Требования к запросу: gasId — строка из каталога; T > 0 и P > 0
 * конечны; root — 'vapor' | 'liquid'; evidencePolicy — ЯВНО указана.
 * Отказы fail-closed: неизвестный компонент (unknown_component),
 * некорректная запись каталога (invalid_parameters), непринятые
 * статусы доказанности (parameter_evidence_not_accepted), отсутствие
 * физического корня, численные проблемы. Успех никогда не содержит
 * NaN/Infinity; provenance-скаляры каталога прикрепляются БЕЗ
 * копирования (та же замороженная структура).
 */
export function computePengRobinsonPure(request: PengRobinsonPureRequest): PengRobinsonPureResult {
  // --- Валидация входа (invalid_input), порядок как в Stage 4.4.4.2 ---
  if (typeof request.gasId !== 'string' || request.gasId.trim() === '') {
    return {
      status: 'failure',
      code: 'invalid_input',
      message:
        `gasId должен быть непустой строкой, получено: ${String(request.gasId)}; ` +
        `каталог PR 4.4.4.1: co2, n2, ch4, h2o, ar (h2 исключён)`
    };
  }
  const requestFailure = validatePengRobinsonComponentRequest({
    temperatureK: request.temperatureK,
    pressurePa: request.pressurePa,
    root: request.root,
    evidencePolicy: request.evidencePolicy
  });
  if (requestFailure !== null) {
    return requestFailure;
  }

  // --- Lookup каталога (fail-closed) ---
  let record: EosPureComponentParameters;
  try {
    record = getEosPureComponentParameters(request.gasId);
  } catch (error) {
    if (error instanceof EosParametersError) {
      if (error.code === 'unknown_gas') {
        return {
          status: 'failure',
          code: 'unknown_component',
          message: error.message,
          gasId: request.gasId,
          detail: `h2 и компоненты вне каталога Stage 4.4.4.1 не поддерживаются чистокомпонентным PR`
        };
      }
      return {
        status: 'failure',
        code: 'invalid_parameters',
        message: error.message,
        gasId: request.gasId,
        detail: error.issues.join('; ')
      };
    }
    throw error;
  }

  // --- Вычислитель Core на валидированных входах ---
  const core: PengRobinsonComponentResult = computePengRobinsonFromComponent(
    toComponentInputs(record),
    {
      temperatureK: request.temperatureK,
      pressurePa: request.pressurePa,
      root: request.root,
      evidencePolicy: request.evidencePolicy
    }
  );
  if (core.status === 'failure') {
    return core;
  }

  // --- Provenance-скаляры каталога (та же замороженная структура) ---
  return {
    ...core,
    gasId: record.gasId as EosPureComponentGasId,
    criticalTemperatureK: record.criticalTemperatureK,
    criticalPressurePa: record.criticalPressurePa,
    acentricFactor: record.acentricFactor
  };
}

// ============================================
// 3. ГРАНИЦЫ МОДУЛЯ
// ============================================
//
// Фасад НЕ содержит математики PR и НЕ расширяет систему provenance:
// все provenance-объекты принадлежат каталогу Stage 4.4.4.1. Полный
// реэкспорт типа PengRobinsonErrorCode здесь не производится — коды
// и политики объявлены в Core/pengRobinson.ts (единый источник).
