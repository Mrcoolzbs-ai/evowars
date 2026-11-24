// ============================================
// PHASE EQUILIBRIUM — Stage 4.4.4.7: явный PR-based VLE анализ
// ============================================
//
// Интеграционный слой PhaseEquilibrium -> Data/pengRobinsonFlashFacade
// -> Core/pengRobinsonFlash (изотермо-изобарный VLE flash Peng–Robinson,
// Stage 4.4.4.6). Это НОВЫЙ ОТДЕЛЬНЫЙ ЯВНЫЙ API:
//
// - legacy Antoine-скрининг (saturationPressure, checkComponentPhase,
//   analyzeAtmospherePhases*) НЕ изменён и НЕ заменяется;
// - Peng–Robinson НЕ активируется автоматически: вызов — только явный;
// - отсутствующий бинарный параметр kij — fail-closed отказ фасада;
//   kij = 0 молча НЕ подставляется;
// - evidence-статусы каталогов НЕ повышаются; provenance чистых
//   параметров (4.4.4.1) и kij (4.4.4.3) передаётся как есть;
// - 'two_phase_candidate' — КАНДИДАТ равновесия, НЕ доказанный
//   стабильный результат; stability 'indeterminate' НЕ превращается
//   в 'stable'; статус stable НЕ предусмотрен вычислителем;
// - недоступные величины атмосферы (давление, состав) НЕ выводятся
//   из игровых допущений — явная диагностика, а не выдуманный результат.

import { computePengRobinsonFlashFromCatalog } from '../Data/pengRobinsonFlashFacade';
import type {
  PengRobinsonFlashCatalogRequest,
  PengRobinsonFlashCatalogResult,
  PengRobinsonFlashCatalogSuccess
} from '../Data/pengRobinsonFlashFacade';
import type { AtmospherePhysicalModel } from '../../types';

/** Явность API: PR не вызывается автоматически и не заменяет Antoine-скрининг. */
export const PR_VLE_EXPLICIT_API_NOTE =
  'Peng–Robinson VLE — отдельный ЯВНЫЙ API: он не вызывается автоматически ' +
  'и не заменяет Antoine-скрининг PhaseEquilibrium; legacy-поведение сохранено.';

/** Семантика кандидата: сходимость flash не доказывает глобальной устойчивости. */
export const PR_VLE_CANDIDATE_NOTE =
  'two_phase_candidate — кандидат равновесия по Peng–Robinson (сходимость flash, ' +
  'материальный баланс и равенство фугитивностей в допуске), НЕ доказанный ' +
  'глобально стабильный двухфазный результат: validated error bound TPD-скрининга ' +
  'не доказан, статус stable не выдаётся.';

/** Честная неопределённость: indeterminate не трактуется как stable. */
export const PR_VLE_INDETERMINATE_NOTE =
  'Устойчивость indeterminate: TPD-скрининг не дал доказательства неустойчивости, ' +
  'но и не подтвердил двухфазное расслоение; результат остаётся неопределённым ' +
  'и НЕ трактуется как стабильный или доказанно двухфазный.';

/** Происхождение параметров передаётся каталогами без повышения статусов. */
export const PR_VLE_PROVENANCE_NOTE =
  'Provenance чистокомпонентных параметров (каталог 4.4.4.1) и бинарных ' +
  'взаимодействий kij (каталог 4.4.4.3) передаётся из результата фасада без ' +
  'изменений; evidence-статусы каталогов не повышаются.';

export type PengRobinsonVleEvidencePolicy =
  PengRobinsonFlashCatalogRequest['evidencePolicy'];

/** Явный термодинамический вход PR-VLE анализа (без вывода величин из игровых допущений). */
export interface PengRobinsonVleRequest {
  /** Температура, K (конечное число) */
  temperatureK: number;
  /** Давление, Па (конечное число) */
  pressurePa: number;
  /** Молярный состав по gasId (сумма долей обязана равняться 1; без нормализации) */
  composition: readonly { gasId: string; moleFraction: number }[];
  /** Явная политика evidence каталогов */
  evidencePolicy: PengRobinsonVleEvidencePolicy;
  /** Настройки TPD-скрининга (передаются фасаду как есть) */
  stabilityScreening?: boolean;
  maxIterations?: number;
  fugacityTolerance?: number;
}

/**
 * Результат PR-VLE анализа. Успех — ТОЛЬКО кандидат равновесия
 * (two_phase_candidate) с полным результатом фасада (включая
 * provenance); отказ — явная диагностика без выдуманных значений.
 */
export type PengRobinsonVleResult =
  | {
      kind: 'peng_robinson_vle';
      status: 'two_phase_candidate';
      /** Полный успешный результат flash-фасада (с provenance каталогов). */
      flash: PengRobinsonFlashCatalogSuccess;
      /** Явные предупреждения интеграционного слоя. */
      warnings: string[];
    }
  | {
      kind: 'peng_robinson_vle';
      status: 'failure';
      /** Код отказа (фасада или интеграционного слоя). */
      code: string;
      message: string;
      detail?: string;
      warnings: string[];
    };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function failure(
  code: string,
  message: string,
  detail?: string
): PengRobinsonVleResult {
  return {
    kind: 'peng_robinson_vle',
    status: 'failure',
    code,
    message,
    ...(detail === undefined ? {} : { detail }),
    warnings: [PR_VLE_EXPLICIT_API_NOTE]
  };
}

function integrationWarnings(flash: PengRobinsonFlashCatalogResult): string[] {
  const warnings = [PR_VLE_EXPLICIT_API_NOTE, PR_VLE_PROVENANCE_NOTE];
  if (flash.status === 'two_phase_candidate') {
    warnings.push(PR_VLE_CANDIDATE_NOTE);
    if (flash.stability === 'indeterminate') {
      warnings.push(PR_VLE_INDETERMINATE_NOTE);
    }
  }
  return warnings;
}

/**
 * Явный PR-based VLE анализ по готовому термодинамическому входу.
 * Делегирует математику computePengRobinsonFlashFromCatalog (единственный
 * источник PR-математики — Core/pengRobinsonFlash.ts) и добавляет только
 * явные предупреждения интеграционного слоя. Никакой математики здесь нет.
 */
export function analyzeVleWithPengRobinson(
  request: PengRobinsonVleRequest
): PengRobinsonVleResult {
  if (!isFiniteNumber(request.temperatureK)) {
    return failure(
      'invalid_input',
      'temperatureK должен быть конечным числом; получено: ' + String(request.temperatureK)
    );
  }
  if (!isFiniteNumber(request.pressurePa)) {
    return failure(
      'invalid_input',
      'pressurePa должен быть конечным числом; получено: ' + String(request.pressurePa)
    );
  }
  if (!Array.isArray(request.composition) || request.composition.length === 0) {
    return failure(
      'invalid_input',
      'composition должен быть непустым массивом записей {gasId, moleFraction}'
    );
  }
  for (const entry of request.composition) {
    if (
      !entry ||
      typeof entry.gasId !== 'string' ||
      entry.gasId.length === 0 ||
      !isFiniteNumber(entry.moleFraction)
    ) {
      return failure(
        'invalid_input',
        'запись состава некорректна (gasId — непустая строка, moleFraction — конечное число); ' +
          'некорректные значения не подменяются: ' + JSON.stringify(entry ?? null)
      );
    }
  }

  const flash = computePengRobinsonFlashFromCatalog({
    composition: request.composition.map((e) => ({ gasId: e.gasId, moleFraction: e.moleFraction })),
    temperatureK: request.temperatureK,
    pressurePa: request.pressurePa,
    evidencePolicy: request.evidencePolicy,
    ...(request.maxIterations === undefined ? {} : { maxIterations: request.maxIterations }),
    ...(request.fugacityTolerance === undefined ? {} : { fugacityTolerance: request.fugacityTolerance }),
    ...(request.stabilityScreening === undefined ? {} : { stabilityScreening: request.stabilityScreening })
  });

  if (flash.status === 'failure') {
    return {
      kind: 'peng_robinson_vle',
      status: 'failure',
      code: flash.code,
      message: flash.message,
      ...(flash.detail === undefined ? {} : { detail: flash.detail }),
      warnings: [PR_VLE_EXPLICIT_API_NOTE]
    };
  }
  return {
    kind: 'peng_robinson_vle',
    status: 'two_phase_candidate',
    flash,
    warnings: integrationWarnings(flash)
  };
}

export interface AtmosphereVleOptions {
  stabilityScreening?: boolean;
  maxIterations?: number;
  fugacityTolerance?: number;
}

/**
 * Адаптер AtmospherePhysicalModel -> явный PR-VLE анализ.
 *
 * Состав берётся из model.molarFractions КАК ЕСТЬ (без нормализации:
 * некорректная сумма — отказ фасада); давление — ТОЛЬКО из явного
 * model.surfacePressurePa. Отсутствующее/некорректное давление и
 * некорректные доли — явная диагностика; величины НЕ выводятся из
 * игровых допущений. Температура передаётся вызывающим кодом явно.
 * Legacy-скрининг (analyzeAtmospherePhases) не вызывается и не меняется.
 */
export function analyzeAtmosphereVleWithPengRobinson(
  model: AtmospherePhysicalModel,
  temperatureK: number,
  evidencePolicy: PengRobinsonVleEvidencePolicy,
  options: AtmosphereVleOptions = {}
): PengRobinsonVleResult {
  if (!model || typeof model !== 'object') {
    return failure('invalid_input', 'модель атмосферы отсутствует или некорректна');
  }
  if (!isFiniteNumber(temperatureK)) {
    return failure(
      'invalid_input',
      'temperatureK должен быть конечным числом; получено: ' + String(temperatureK)
    );
  }
  const surface = model.surfacePressurePa;
  if (!surface || surface.value === null || !isFiniteNumber(surface.value)) {
    return failure(
      'atmosphere_pressure_unavailable',
      'Поверхностное давление атмосферы неизвестно (null/unknown): PR-VLE анализ не выполняется. ' +
        'Давление НЕ выводится из игровых допущений — используйте явный ' +
        'analyzeVleWithPengRobinson с явно заданным давлением.'
    );
  }
  const entries = Object.entries(model.molarFractions ?? {});
  if (entries.length === 0) {
    return failure(
      'invalid_input',
      'молярный состав атмосферы пуст: состав неизвестен, PR-VLE анализ не выполняется'
    );
  }
  const composition: { gasId: string; moleFraction: number }[] = [];
  for (const [gasId, fraction] of entries) {
    if (!isFiniteNumber(fraction) || fraction < 0) {
      return failure(
        'invalid_input',
        'молярная доля компонента ' + gasId + ' некорректна (' + String(fraction) + '): ' +
          'неизвестные/отрицательные доли не подменяются'
      );
    }
    composition.push({ gasId, moleFraction: fraction });
  }
  return analyzeVleWithPengRobinson({
    temperatureK,
    pressurePa: surface.value,
    composition,
    evidencePolicy,
    ...(options.stabilityScreening === undefined ? {} : { stabilityScreening: options.stabilityScreening }),
    ...(options.maxIterations === undefined ? {} : { maxIterations: options.maxIterations }),
    ...(options.fugacityTolerance === undefined ? {} : { fugacityTolerance: options.fugacityTolerance })
  });
}
